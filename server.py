import argparse
import base64
import binascii
import io
import json
import os
from pathlib import Path
import secrets
import threading
from urllib.parse import quote, urlsplit
import warnings
import webbrowser

from dotenv import dotenv_values
from flask import Flask, jsonify, request, send_file
from PIL import Image, UnidentifiedImageError
import requests
from werkzeug.exceptions import HTTPException
from werkzeug.serving import make_server


ROOT = Path(__file__).resolve().parent
MAX_IMAGE_BYTES = 8 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_000_000
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 24 * 1024 * 1024
app.config['STUDIO_ORIGIN'] = 'http://127.0.0.1:4173'
TOKEN = secrets.token_urlsafe(32)
EDIT_LOCK = threading.Lock()


class EditError(Exception):
    def __init__(self, code, status=400):
        self.code = code
        self.status = status


def configuration():
    values = {**dotenv_values(ROOT / '.env', encoding='utf-8-sig'), **os.environ}
    endpoint = (values.get('AZURE_OPENAI_ENDPOINT') or '').strip().rstrip('/')
    key = (values.get('AZURE_OPENAI_API_KEY') or '').strip()
    deployment = (values.get('AZURE_OPENAI_IMAGE_DEPLOYMENT') or 'gpt-image-2').strip()
    version = (values.get('AZURE_OPENAI_API_VERSION') or '2025-04-01-preview').strip()
    parsed = urlsplit(endpoint)
    valid = bool(key and deployment and parsed.scheme == 'https' and parsed.hostname
                 and parsed.path in ('', '/') and not parsed.query and not parsed.fragment
                 and not parsed.username and not parsed.password)
    return {'endpoint': endpoint, 'key': key, 'deployment': deployment,
            'version': version, 'configured': valid}


def decode_image(data_url, max_bytes=MAX_IMAGE_BYTES):
    if not isinstance(data_url, str) or len(data_url) > max_bytes * 4 // 3 + 100:
        raise EditError('invalid_image')
    header, separator, encoded = data_url.partition(',')
    expected = {'data:image/png;base64': ('PNG', 'image/png', 'png'),
                'data:image/jpeg;base64': ('JPEG', 'image/jpeg', 'jpg')}.get(header)
    if not separator or not expected:
        raise EditError('invalid_image')
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > max_bytes:
            raise EditError('invalid_image')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != expected[0] or image.width * image.height > Image.MAX_IMAGE_PIXELS:
                    raise EditError('invalid_image')
                image.verify()
    except (binascii.Error, ValueError, OSError, UnidentifiedImageError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise EditError('invalid_image') from None
    return raw, expected[1], expected[2]


def edit_image(payload, config):
    if not isinstance(payload, dict):
        raise EditError('invalid_request')
    prompt = payload.get('prompt')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000:
        raise EditError('invalid_prompt')
    quality = payload.get('quality', 'medium')
    size = payload.get('size', 'auto')
    if quality not in ('low', 'medium', 'high') or size not in ('auto', '1024x1024', '1536x1024', '1024x1536'):
        raise EditError('invalid_options')
    source, source_type, source_extension = decode_image(payload.get('image'))
    files = [('image[]', (f'studio.{source_extension}', source, source_type))]
    instruction = 'Edit image 1, the studio photograph. Preserve its pose, framing and lighting unless the user requests changes. '
    if payload.get('reference') is not None:
        reference, reference_type, reference_extension = decode_image(payload['reference'])
        files.append(('image[]', (f'reference.{reference_extension}', reference, reference_type)))
        instruction += 'Image 2 is a character/appearance reference. Use its appearance as requested, while using image 1 as the composition and pose source. '
    if not config['configured']:
        raise EditError('not_configured', 503)
    url = (f"{config['endpoint']}/openai/deployments/{quote(config['deployment'], safe='')}"
           f"/images/edits?api-version={quote(config['version'], safe='')}")
    fields = {'model': config['deployment'], 'prompt': instruction + '\nUser request:\n' + prompt.strip(),
              'n': '1', 'quality': quality, 'size': size, 'output_format': 'png'}
    try:
        with requests.post(url, headers={'api-key': config['key']}, data=fields, files=files,
                           timeout=(15, 240), allow_redirects=False, stream=True) as response:
            if response.status_code != 200:
                code = {400: 'azure_rejected', 401: 'azure_auth', 403: 'azure_forbidden',
                        404: 'azure_deployment', 429: 'azure_rate_limit'}.get(response.status_code, 'azure_failed')
                raise EditError(code, 502)
            content = bytearray()
            for chunk in response.iter_content(65536):
                content.extend(chunk)
                if len(content) > 48 * 1024 * 1024:
                    raise EditError('invalid_result', 502)
        result = json.loads(content)
        encoded = result['data'][0]['b64_json']
        if not isinstance(encoded, str):
            raise EditError('invalid_result', 502)
        data_url = 'data:image/png;base64,' + encoded
        try:
            decode_image(data_url, 32 * 1024 * 1024)
        except EditError:
            raise EditError('invalid_result', 502) from None
        return {'image': data_url}
    except requests.Timeout:
        raise EditError('azure_timeout', 504) from None
    except requests.RequestException:
        raise EditError('azure_network', 502) from None
    except (ValueError, KeyError, IndexError, TypeError):
        raise EditError('invalid_result', 502) from None


@app.before_request
def protect_local_server():
    origin = app.config['STUDIO_ORIGIN']
    if request.host != urlsplit(origin).netloc:
        raise EditError('invalid_host', 403)
    if request.path.startswith('/api/'):
        if request.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise EditError('invalid_origin', 403)
        if request.headers.get('Origin') not in (None, origin):
            raise EditError('invalid_origin', 403)
        if request.method == 'POST' and not secrets.compare_digest(request.headers.get('X-Studio-Token', ''), TOKEN):
            raise EditError('invalid_token', 403)


@app.after_request
def response_headers(response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cross-Origin-Resource-Policy'] = 'same-origin'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return response


@app.errorhandler(EditError)
def edit_error(error):
    return jsonify(error=error.code), error.status


@app.errorhandler(HTTPException)
def http_error(error):
    return jsonify(error='request_too_large' if error.code == 413 else 'invalid_request'), error.code


@app.get('/api/ai/status')
def ai_status():
    config = configuration()
    return jsonify(configured=config['configured'], deployment=config['deployment'], token=TOKEN)


@app.post('/api/ai/edit')
def ai_edit():
    if not request.is_json:
        raise EditError('invalid_request')
    if not EDIT_LOCK.acquire(blocking=False):
        raise EditError('busy', 409)
    try:
        return jsonify(edit_image(request.get_json(), configuration()))
    finally:
        EDIT_LOCK.release()


@app.get('/')
@app.get('/<path:relative>')
def static_asset(relative='index.html'):
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT) or any(part.startswith('.') for part in Path(relative).parts):
        raise EditError('not_found', 404)
    allowed = relative in ('index.html', 'styles.css')
    allowed |= path == ROOT / 'assets' / 'poses' / 'library.json'
    allowed |= path.is_relative_to(ROOT / 'src') and path.suffix == '.js'
    allowed |= path.is_relative_to(ROOT / 'assets') and path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.svg', '.vrm', '.glb')
    if not allowed or not path.is_file():
        raise EditError('not_found', 404)
    mime = {'.js': 'text/javascript', '.vrm': 'application/octet-stream', '.glb': 'model/gltf-binary'}.get(path.suffix)
    return send_file(path, mimetype=mime, conditional=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    for port in range(args.port, min(args.port + 20, 65536)):
        try:
            server = make_server('127.0.0.1', port, app, threaded=True)
            break
        except SystemExit:
            continue
    else:
        raise SystemExit('No available local port.')
    app.config['STUDIO_ORIGIN'] = f'http://127.0.0.1:{server.server_port}'
    print(f"Studio running at {app.config['STUDIO_ORIGIN']}/", flush=True)
    if not args.no_browser:
        webbrowser.open(app.config['STUDIO_ORIGIN'])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()