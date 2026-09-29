import io
import os
from pathlib import Path
import secrets
import threading
from urllib.parse import urlsplit

from dotenv import dotenv_values
from flask import Flask, jsonify, request, send_file
from flask_login import current_user
from werkzeug.exceptions import HTTPException

from ai_service import EditError, analyze_image, configuration, decode_image, edit_image, vision_configuration
from auth import configure_auth, csrf_token, user_directory
from storage import StorageError, StudioStore


ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 46 * 1024 * 1024
app.config['STUDIO_ORIGIN'] = 'http://127.0.0.1:4173'
app.config['STUDIO_DATA'] = ROOT / '.studio-data'
configure_auth(app, {**dotenv_values(ROOT / '.env', encoding='utf-8-sig'), **os.environ})
TOKEN = secrets.token_urlsafe(32)
EDIT_LOCK = threading.Lock()


@app.before_request
def protect_local_server():
    if request.path == '/healthz':
        return None
    origin = app.config['STUDIO_ORIGIN']
    if request.host != urlsplit(origin).netloc:
        raise EditError('invalid_host', 403)
    if request.path.startswith('/api/'):
        if request.path == '/api/auth/session':
            return None
        if app.config.get('STUDIO_AUTH_ENABLED') and not current_user.is_authenticated:
            raise EditError('authentication_required', 401)
        if request.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise EditError('invalid_origin', 403)
        if request.headers.get('Origin') not in (None, origin):
            raise EditError('invalid_origin', 403)
        expected_token = csrf_token() if app.config['STUDIO_AUTH_ENABLED'] else TOKEN
        if (request.method == 'POST' or request.path.startswith('/api/data/')) and not secrets.compare_digest(request.headers.get('X-Studio-Token', ''), expected_token):
            raise EditError('invalid_token', 403)


@app.after_request
def response_headers(response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin' if request.path in ('/login', '/auth/login', '/account', '/account/users') else 'no-referrer'
    response.headers['Cross-Origin-Resource-Policy'] = 'same-origin'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return response


@app.errorhandler(EditError)
@app.errorhandler(StorageError)
def edit_error(error):
    return jsonify(error=error.code), error.status


@app.errorhandler(HTTPException)
def http_error(error):
    return jsonify(error='request_too_large' if error.code == 413 else 'invalid_request'), error.code


@app.get('/api/ai/status')
def ai_status():
    config = configuration()
    return jsonify(configured=config['configured'], deployment=config['deployment'], token=csrf_token() if app.config['STUDIO_AUTH_ENABLED'] else TOKEN)


@app.post('/api/ai/edit')
def ai_edit():
    if not request.is_json:
        raise EditError('invalid_request')
    if not EDIT_LOCK.acquire(blocking=False):
        raise EditError('busy', 409)
    try:
        payload = request.get_json()
        result = edit_image(payload, configuration())
        try:
            content, mime, extension = decode_image(result['image'], 32 * 1024 * 1024)
            result['asset'] = local_store().add('result', 'AI-' + secrets.token_hex(4) + '.' + extension,
                                              content, mime, {key: payload.get(key, default) for key, default in
                                                              (('prompt', ''), ('quality', 'medium'), ('size', 'auto'))})
        except (StorageError, OSError):
            result['storageError'] = 'storage_failed'
        return jsonify(result)
    finally:
        EDIT_LOCK.release()


@app.get('/api/ai/analyze/status')
def analysis_status():
    config = vision_configuration()
    return jsonify(configured=config['configured'], deployment=config['deployment'], token=csrf_token() if app.config['STUDIO_AUTH_ENABLED'] else TOKEN)


@app.post('/api/ai/analyze')
def ai_analyze():
    if not request.is_json:
        raise EditError('invalid_request')
    if not EDIT_LOCK.acquire(blocking=False):
        raise EditError('busy', 409)
    try:
        return jsonify(preset=analyze_image(request.get_json(), vision_configuration()))
    finally:
        EDIT_LOCK.release()


def local_store():
    directory = app.config['STUDIO_DATA']
    return StudioStore(user_directory(directory) if app.config['STUDIO_AUTH_ENABLED'] else directory)


@app.get('/api/data/assets')
def list_assets():
    try:
        offset = int(request.args.get('offset', '0'))
    except ValueError:
        raise EditError('invalid_request') from None
    return jsonify(local_store().list(request.args.get('kind'), offset))


@app.post('/api/data/assets')
def add_asset():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or payload.get('kind') not in ('photo', 'result', 'person', 'garment'):
        raise EditError('invalid_request')
    limit = 8 if payload['kind'] in ('person', 'garment') else 32
    content, mime, _ = decode_image(payload.get('image'), limit * 1024 * 1024)
    return jsonify(local_store().add(payload['kind'], payload.get('name'), content, mime)), 201


@app.get('/api/data/assets/<identifier>')
def get_asset(identifier):
    content, mime, asset = local_store().get(identifier, request.args.get('thumbnail') == '1')
    return send_file(io.BytesIO(content), mimetype=mime, download_name=asset['name'])


@app.post('/api/data/assets/<identifier>/delete')
def delete_asset(identifier):
    local_store().delete(identifier)
    return jsonify(deleted=True)


@app.route('/api/data/settings/<name>', methods=['GET', 'POST'])
def saved_settings(name):
    if request.method == 'GET':
        return jsonify(local_store().settings(name))
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise EditError('invalid_request')
    return jsonify(local_store().save_settings(name, payload.get('value'), payload.get('revision')))


@app.route('/api/data/characters', methods=['GET', 'POST'])
def characters():
    if request.method == 'GET':
        return jsonify(items=local_store().list_characters())
    if request.mimetype != 'model/gltf-binary':
        raise EditError('invalid_request')
    return jsonify(local_store().add_character(request.args.get('name'), request.get_data())), 201


@app.get('/api/data/characters/<identifier>')
def get_character(identifier):
    content, name = local_store().get_character(identifier)
    return send_file(io.BytesIO(content), mimetype='model/gltf-binary', download_name=name, as_attachment=True)


@app.post('/api/data/characters/variants')
def create_character():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise EditError('invalid_request')
    return jsonify(local_store().create_character(payload.get('name'), payload.get('base'), payload.get('appearance'))), 201


@app.post('/api/data/characters/<identifier>/delete')
def delete_character(identifier):
    local_store().delete_character(identifier)
    return jsonify(deleted=True)


@app.get('/')
@app.get('/<path:relative>')
def static_asset(relative='index.html'):
    if relative == 'index.html':
        entry = ROOT / 'dist' / 'index.html'
        if not entry.is_file():
            return 'Frontend is not built. Run npm ci and npm run build, or use npm run dev.', 503
        return send_file(entry, mimetype='text/html', conditional=False)
    if relative.startswith('static/'):
        build_root = (ROOT / 'dist' / 'static').resolve()
        compiled = (ROOT / 'dist' / relative).resolve()
        if (not compiled.is_relative_to(build_root) or any(part.startswith('.') for part in Path(relative).parts)
                or compiled.suffix not in ('.js', '.css', '.json', '.woff', '.woff2') or not compiled.is_file()):
            raise EditError('not_found', 404)
        mime = {'.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'}.get(compiled.suffix)
        return send_file(compiled, mimetype=mime, conditional=False)
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT) or any(part.startswith('.') for part in Path(relative).parts):
        raise EditError('not_found', 404)
    allowed = relative == 'styles.css'
    allowed |= path == ROOT / 'assets' / 'poses' / 'library.json'
    allowed |= path == ROOT / 'assets' / 'shots' / 'thumbnails.json'
    allowed |= path.is_relative_to(ROOT / 'src') and path.suffix == '.js'
    allowed |= path.is_relative_to(ROOT / 'assets' / 'vendor') and path.suffix in ('.js', '.map')
    allowed |= path.is_relative_to(ROOT / 'assets') and path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.svg', '.vrm', '.glb')
    if not allowed or not path.is_file():
        raise EditError('not_found', 404)
    mime = {'.js': 'text/javascript', '.vrm': 'application/octet-stream', '.glb': 'model/gltf-binary'}.get(path.suffix)
    return send_file(path, mimetype=mime, conditional=False)