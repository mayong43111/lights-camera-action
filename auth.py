from contextlib import contextmanager
from datetime import timedelta
import hashlib
from pathlib import Path
import re
import secrets
import sqlite3
import time
from urllib.parse import urlsplit
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from cachelib import FileSystemCache
from flask import abort, current_app, jsonify, redirect, render_template, request, send_file, session
from flask_limiter import Limiter
from flask_login import LoginManager, UserMixin, current_user, login_user, logout_user
from flask_session import Session
import msal
import requests


PASSWORDS = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1)
DUMMY_HASH = PASSWORDS.hash(secrets.token_urlsafe(32))
PUBLIC_PATHS = {'/healthz', '/login', '/auth.css',
                '/api/auth/session', '/auth/login', '/auth/entra', '/auth/callback'}


class User(UserMixin):
    def __init__(self, row):
        self.id = row['id']
        self.name = row['name']
        self.provider = row['provider']
        self.version = row['version']

    def get_id(self):
        return f'{self.id}|{self.version}'

    @property
    def admin(self):
        return self.provider == 'entra' and self.id in {
            f"entra:{current_app.config['ENTRA_TENANT_ID']}:{identifier}"
            for identifier in current_app.config['ENTRA_ADMIN_USER_IDS']}


@contextmanager
def database():
    directory = Path(current_app.config['STUDIO_DATA'])
    directory.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(directory / 'auth.sqlite3', timeout=20)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT NOT NULL, provider TEXT NOT NULL, password_hash TEXT, version INTEGER NOT NULL DEFAULT 1)')
        with connection:
            yield connection
    finally:
        connection.close()


def csrf_token():
    if 'csrf' not in session:
        session['csrf'] = secrets.token_urlsafe(32)
    return session['csrf']


def establish(user):
    session['rotation'] = True
    current_app.session_interface.regenerate(session)
    session.clear()
    session.permanent = True
    session['expires'] = time.time() + 12 * 60 * 60
    csrf_token()
    login_user(user)


def entra_client():
    config = current_app.config
    return msal.ConfidentialClientApplication(
        config['ENTRA_CLIENT_ID'], client_credential=config['ENTRA_CLIENT_SECRET'],
        authority=f"https://login.microsoftonline.com/{config['ENTRA_TENANT_ID']}",
        exclude_scopes=['offline_access'], timeout=20)


def configure_auth(app, values):
    hosted = bool(values.get('WEBSITE_HOSTNAME'))
    origin = (f"https://{values['WEBSITE_HOSTNAME']}" if hosted else values.get('AUTH_ORIGIN', ''))
    enabled = bool(origin)
    if origin:
        parsed = urlsplit(origin)
        if (parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.username
                or not parsed.hostname or (parsed.scheme != 'https' and not
                    (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1') and not hosted))):
            raise ValueError('Authentication requires HTTPS or a loopback development origin')
        app.config['STUDIO_ORIGIN'] = origin.rstrip('/')
    if hosted and (len(values.get('STUDIO_SECRET_KEY', '')) < 32 or not all(values.get(key) for key in
            ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET'))):
        raise ValueError('Cloud authentication configuration is incomplete')
    if values.get('STUDIO_DATA'):
        app.config['STUDIO_DATA'] = Path(values['STUDIO_DATA'])
    elif hosted:
        app.config['STUDIO_DATA'] = Path('/home/studio')
    for key in ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID'):
        value = values.get(key, '')
        if value:
            uuid.UUID(value)
        app.config[key] = value
    app.config['ENTRA_CLIENT_SECRET'] = values.get('ENTRA_CLIENT_SECRET', '')
    admins = [value.strip() for value in values.get('ENTRA_ADMIN_USER_IDS', '').split(',') if value.strip()]
    for identifier in admins:
        uuid.UUID(identifier)
    app.config.update(
        STUDIO_AUTH_ENABLED=enabled, ENTRA_ADMIN_USER_IDS=admins,
        SECRET_KEY=values.get('STUDIO_SECRET_KEY') or secrets.token_hex(32),
        SESSION_TYPE='cachelib', SESSION_COOKIE_NAME='__Host-studio-session' if origin.startswith('https:') else 'studio-session',
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SECURE=origin.startswith('https:'),
        SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_PATH='/',
        SESSION_REFRESH_EACH_REQUEST=False, PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        SESSION_CACHELIB=FileSystemCache(str(Path(app.config['STUDIO_DATA']) / 'sessions'), threshold=10000))
    Session(app)
    manager = LoginManager(app)
    limiter = Limiter(key_func=lambda: 'studio', app=app, storage_uri='memory://')

    @manager.user_loader
    def load_user(identifier):
        user_id, separator, version = identifier.rpartition('|')
        if not separator or session.get('expires', 0) <= time.time():
            return None
        with database() as connection:
            row = connection.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
        if row is None or str(row['version']) != version:
            return None
        if row['provider'] == 'entra' and not row['id'].startswith(f"entra:{app.config['ENTRA_TENANT_ID']}:"):
            return None
        return User(row)

    @app.before_request
    def protect_auth():
        if request.path == '/healthz':
            return None
        origin = app.config['STUDIO_ORIGIN']
        if request.host != urlsplit(origin).netloc:
            return jsonify(error='invalid_host'), 403
        if not app.config['STUDIO_AUTH_ENABLED']:
            if request.path in PUBLIC_PATHS - {'/api/auth/session', '/healthz'} or request.path.startswith('/account') or request.path == '/auth/logout':
                return redirect('/')
            return None
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.headers.get('Origin') != origin or request.headers.get('Sec-Fetch-Site') == 'cross-site':
                return jsonify(error='invalid_origin'), 403
            if request.path.startswith(('/auth/', '/account')) and (request.content_length or 0) > 16384:
                abort(413)
            token = request.headers.get('X-Studio-Token') or request.form.get('csrf', '')
            if not session.get('csrf') or not secrets.compare_digest(token, session['csrf']):
                return jsonify(error='invalid_token'), 403
        if request.path not in PUBLIC_PATHS and not current_user.is_authenticated:
            if request.path.startswith('/api/'):
                return jsonify(error='authentication_required'), 401
            return redirect('/login')
        identity = request.headers.get('X-Studio-User')
        if identity and current_user.is_authenticated and identity != current_user.id:
            return jsonify(error='session_changed'), 409, {'X-Studio-Session-Changed': '1'}

    @app.get('/healthz')
    def health():
        return jsonify(status='ok')

    @app.get('/api/auth/session')
    def auth_session():
        if not app.config['STUDIO_AUTH_ENABLED']:
            return jsonify(enabled=False, user=None)
        user = current_user
        return jsonify(enabled=True, user={'id': user.id, 'name': user.name, 'provider': user.provider,
                       'admin': user.admin} if user.is_authenticated else None)

    def login_page(error='', status=200):
        return render_template('auth.html', mode='login', error=error, csrf=csrf_token(),
                               entra=all(app.config[key] for key in ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET'))), status

    @app.get('/login')
    def login():
        if current_user.is_authenticated:
            return redirect('/')
        return login_page('Microsoft 登录未完成，请重试。' if request.args.get('failed') else '')

    @app.get('/auth.css')
    def auth_css():
        return send_file(Path(app.root_path) / 'auth.css')

    @app.post('/auth/login')
    @limiter.limit('8 per 15 minutes')
    def password_login():
        username = request.form.get('username', '').strip().lower()
        password = request.form.get('password', '')
        if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,63}', username) or not 1 <= len(password) <= 256:
            return login_page('账号或密码不正确。', 401)
        with database() as connection:
            row = connection.execute("SELECT * FROM users WHERE username = ? AND provider = 'local'", (username,)).fetchone()
        try:
            PASSWORDS.verify(row['password_hash'] if row else DUMMY_HASH, password)
        except VerificationError:
            return login_page('账号或密码不正确。', 401)
        if row is None:
            return login_page('账号或密码不正确。', 401)
        establish(User(row))
        return redirect('/')

    @app.get('/auth/entra')
    @limiter.limit('20 per 15 minutes')
    def entra_login():
        if not all(app.config[key] for key in ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET')):
            abort(503)
        try:
            flow = entra_client().initiate_auth_code_flow(scopes=[], redirect_uri=app.config['STUDIO_ORIGIN'] + '/auth/callback', prompt='select_account')
            session['flow'] = flow
            session['flow_expires'] = time.time() + 600
            return redirect(flow['auth_uri'])
        except (ValueError, requests.RequestException):
            return redirect('/login?failed=1')

    @app.get('/auth/callback')
    def entra_callback():
        flow = session.pop('flow', None)
        expires = session.pop('flow_expires', 0)
        if not flow or expires <= time.time():
            return redirect('/login?failed=1')
        try:
            result = entra_client().acquire_token_by_auth_code_flow(flow, request.args.to_dict())
            claims = result.get('id_token_claims', {})
            tenant = app.config['ENTRA_TENANT_ID']
            if (claims.get('tid') != tenant or claims.get('aud') != app.config['ENTRA_CLIENT_ID']
                    or claims.get('iss') != f'https://login.microsoftonline.com/{tenant}/v2.0'
                    or not isinstance(claims.get('exp'), (int, float)) or claims['exp'] <= time.time()):
                raise ValueError('Identity rejected')
            identifier = f"entra:{tenant}:{uuid.UUID(claims['oid'])}"
            name = claims.get('name') if isinstance(claims.get('name'), str) else 'Microsoft user'
            with database() as connection:
                connection.execute("INSERT INTO users (id, name, provider) VALUES (?, ?, 'entra') ON CONFLICT(id) DO UPDATE SET name = excluded.name", (identifier, name[:80]))
                row = connection.execute('SELECT * FROM users WHERE id = ?', (identifier,)).fetchone()
            establish(User(row))
            return redirect('/')
        except (ValueError, KeyError, TypeError, RuntimeError, requests.RequestException):
            return redirect('/login?failed=1')

    @app.post('/auth/logout')
    def logout():
        logout_user()
        session.clear()
        return redirect('/login')

    def account_page(error='', status=200, message=''):
        accounts = []
        if current_user.admin:
            with database() as connection:
                accounts = connection.execute("SELECT username, name FROM users WHERE provider = 'local' ORDER BY username").fetchall()
        return render_template('auth.html', mode='account', error=error, message=message,
                               csrf=csrf_token(), accounts=accounts), status

    @app.get('/account')
    def account():
        return account_page()

    @app.post('/account/users')
    @limiter.limit('20 per 15 minutes')
    def accounts_save():
        if not current_user.admin:
            abort(403)
        username = request.form.get('username', '').strip().lower()
        password = request.form.get('password', '')
        name = request.form.get('name', '').strip()
        reset = request.form.get('reset') == 'on'
        if (not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,63}', username) or not 12 <= len(password) <= 256
                or not 1 <= len(name) <= 80):
            return account_page('账号须为 3–64 位字母、数字或 ._-；密码须为 12–256 位。', 400)
        with database() as connection:
            existing = connection.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
            if bool(existing) != reset:
                return account_page('账号已存在，请明确选择重置密码。' if existing else '账号不存在。', 409)
            encoded = PASSWORDS.hash(password)
            if existing:
                connection.execute('UPDATE users SET name = ?, password_hash = ?, version = version + 1 WHERE id = ?', (name, encoded, existing['id']))
            else:
                connection.execute("INSERT INTO users (id, username, name, provider, password_hash) VALUES (?, ?, ?, 'local', ?)",
                                   ('local:' + uuid.uuid4().hex, username, name, encoded))
        return redirect('/account?saved=1')

    @app.errorhandler(429)
    def throttled(error):
        return render_template('auth.html', mode='login', error='尝试次数过多，请 15 分钟后重试。',
                               csrf=csrf_token(), entra=bool(app.config['ENTRA_CLIENT_ID'])), 429


def user_directory(directory):
    if not current_app.config.get('STUDIO_AUTH_ENABLED'):
        return Path(directory)
    if not current_user.is_authenticated:
        abort(401)
    return Path(directory) / 'users' / hashlib.sha256(current_user.id.encode()).hexdigest()