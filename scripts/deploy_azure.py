import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import zipfile

from dotenv import dotenv_values
import requests


ROOT = Path(__file__).resolve().parents[1]


def package():
    npm = shutil.which('npm')
    if not npm:
        raise RuntimeError('Node.js and npm are required to build the frontend. Run npm ci first.')
    subprocess.run([npm, 'run', 'build'], cwd=ROOT, check=True)
    target = ROOT / '.studio-data' / 'deploy' / 'studio.zip'
    target.parent.mkdir(parents=True, exist_ok=True)
    names = ['server.py', 'storage.py', 'scene_schema.py', 'auth.py', 'requirements.txt',
             'dist/index.html', 'auth.css']
    for directory in ('dist/static', 'templates', 'assets'):
        names.extend(path.relative_to(ROOT).as_posix() for path in (ROOT / directory).rglob('*')
                     if path.is_file() and (directory != 'assets' or 'screenshots' not in path.parts
                         or path.name == 'shot-presets-contact-sheet.png'))
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(names):
            archive.write(ROOT / name, name)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None or any(name.startswith('.') for name in archive.namelist()):
            raise RuntimeError('Invalid deployment package')
    print(f'Package verified: {len(names)} files, {target.stat().st_size} bytes', flush=True)
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package-only', action='store_true')
    for name in ('subscription', 'group', 'app', 'tenant', 'client', 'application-object', 'admin'):
        parser.add_argument('--' + name)
    args = parser.parse_args()
    target = package()
    if args.package_only:
        return
    if not all(getattr(args, name) for name in ('subscription', 'group', 'app', 'tenant', 'client', 'application_object', 'admin')):
        parser.error('All Azure identity and hosting arguments are required')
    executable = shutil.which('az')
    if not executable:
        raise RuntimeError('Azure CLI is required')

    def cli(*arguments):
        result = subprocess.run([executable, *arguments, '--subscription', args.subscription, '-o', 'json'],
                                capture_output=True, text=True, encoding='utf-8')
        if result.returncode:
            raise RuntimeError(f'Azure CLI operation failed: {arguments[0]} {arguments[1]}; exit {result.returncode}')
        return json.loads(result.stdout) if result.stdout.strip() else None

    arm_token = cli('account', 'get-access-token', '--resource', 'https://management.azure.com/')
    if arm_token['tenant'] != args.tenant:
        raise RuntimeError('Azure account tenant does not match the requested login tenant')
    graph_token = cli('account', 'get-access-token', '--resource', 'https://graph.microsoft.com/')
    http = requests.Session()
    site = (f'https://management.azure.com/subscriptions/{args.subscription}/resourceGroups/{args.group}'
            f'/providers/Microsoft.Web/sites/{args.app}')
    api_version = '?api-version=2024-11-01'

    def rest(method, url, body=None):
        token = graph_token if url.startswith('https://graph.microsoft.com/') else arm_token
        response = http.request(method, url, json=body, headers={'Authorization': 'Bearer ' + token['accessToken']},
                                timeout=(20, 180), allow_redirects=False)
        if not response.ok:
            raise RuntimeError(f'Azure {method} failed with HTTP {response.status_code}')
        return response.json() if response.content else {}

    current = rest('GET', site + api_version)['properties']
    plan = rest('GET', 'https://management.azure.com' + current['serverFarmId'] + api_version)
    if plan['sku']['tier'] != 'Free':
        raise RuntimeError('Refusing to deploy: expected a Free App Service plan')
    host = current['defaultHostName']
    application_url = 'https://graph.microsoft.com/v1.0/applications/' + args.application_object
    registered = rest('GET', application_url)
    if registered['appId'] != args.client or registered['signInAudience'] != 'AzureADMyOrg':
        raise RuntimeError('Unexpected Entra application registration')
    callback = f'https://{host}/auth/callback'
    if callback not in registered['web']['redirectUris']:
        raise RuntimeError('Entra callback has not been registered')
    settings_url = site + '/config/appsettings'
    settings = rest('POST', settings_url + '/list' + api_version).get('properties', {})
    if not settings.get('ENTRA_CLIENT_SECRET'):
        expiration = (datetime.now(timezone.utc) + timedelta(days=180)).isoformat()
        credential = rest('POST', application_url + '/addPassword',
                          {'passwordCredential': {'displayName': 'Studio web login', 'endDateTime': expiration}})
        settings['ENTRA_CLIENT_SECRET'] = credential['secretText']
        print('Entra credential created; expires ' + credential['endDateTime'], flush=True)
    settings.setdefault('STUDIO_SECRET_KEY', secrets.token_urlsafe(48))
    local = dotenv_values(ROOT / '.env', encoding='utf-8-sig')
    for name in ('AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_IMAGE_DEPLOYMENT',
                 'AZURE_OPENAI_API_VERSION', 'AZURE_OPENAI_VISION_DEPLOYMENT', 'AZURE_OPENAI_VISION_API_VERSION'):
        if local.get(name):
            settings[name] = local[name]
    settings.update(ENTRA_TENANT_ID=args.tenant, ENTRA_CLIENT_ID=args.client, ENTRA_ADMIN_USER_IDS=args.admin,
                    STUDIO_DATA='/home/studio', SCM_DO_BUILD_DURING_DEPLOYMENT='true', ENABLE_ORYX_BUILD='true',
                    WEBSITES_ENABLE_APP_SERVICE_STORAGE='true', WEB_CONCURRENCY='1')
    rest('PUT', settings_url + api_version, {'properties': settings})
    verified = rest('POST', settings_url + '/list' + api_version)['properties']
    if any(verified.get(name) != value for name, value in settings.items()):
        raise RuntimeError('App setting verification failed')
    print('Authentication and persistent storage settings verified; secret values suppressed', flush=True)
    rest('PATCH', site + api_version, {'properties': {'httpsOnly': True}})
    rest('PATCH', site + '/config/web' + api_version, {'properties': {
        'linuxFxVersion': 'PYTHON|3.12', 'alwaysOn': False, 'ftpsState': 'Disabled', 'minTlsVersion': '1.2',
        'appCommandLine': 'gunicorn --bind 0.0.0.0:8000 --workers 1 --threads 4 --timeout 300 server:app'}})
    platform = rest('GET', site + '/config/authsettingsV2' + api_version).get('properties', {})
    if platform.get('platform', {}).get('enabled'):
        raise RuntimeError('Platform authentication is enabled; refusing to change an existing authentication boundary')
    print('Uploading verified application package', flush=True)
    result = cli('webapp', 'deploy', '--resource-group', args.group, '--name', args.app,
                 '--src-path', str(target), '--type', 'zip', '--timeout', '1800000')
    print('Deployment command completed: ' + str(result.get('status', result.get('properties', {}).get('status', 'see Azure deployment status'))), flush=True)
    print('URL: https://' + host, flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, requests.RequestException, subprocess.CalledProcessError) as error:
        message = str(error) if isinstance(error, RuntimeError) else 'Frontend build failed.' if isinstance(error, subprocess.CalledProcessError) else 'Azure network request failed; secrets suppressed'
        raise SystemExit(message) from None