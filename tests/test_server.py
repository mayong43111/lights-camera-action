import base64
import hashlib
import io
import json
import unittest
from unittest.mock import patch, MagicMock

from PIL import Image
import requests
import server


class ImageEditTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.origin = server.app.config['STUDIO_ORIGIN']
        image = io.BytesIO()
        Image.new('RGB', (32, 32), 'white').save(image, format='PNG')
        self.encoded = base64.b64encode(image.getvalue()).decode()
        self.image = 'data:image/png;base64,' + self.encoded
        self.payload = {'prompt': 'Preserve the pose, change the outfit.', 'image': self.image}
        self.config = {'endpoint': 'https://example.openai.azure.com', 'key': 'test-secret',
                       'deployment': 'gpt-image-2', 'version': '2025-04-01-preview', 'configured': True}

    def post(self, payload=None, headers=None):
        return self.client.post('/api/ai/edit', base_url=self.origin,
                                json=self.payload if payload is None else payload,
                                headers={'X-Studio-Token': server.TOKEN, **(headers or {})})

    def azure_response(self, status=200, data=None):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = status
        response.iter_content.return_value = [json.dumps(data or {'data': [{'b64_json': self.encoded}]}).encode()]
        return response

    def test_single_image_and_reference_order(self):
        for reference in (None, self.image):
            with self.subTest(reference=bool(reference)), patch('server.requests.post', return_value=self.azure_response()) as upstream:
                payload = {**self.payload, 'reference': reference}
                result = server.edit_image(payload, self.config)
                self.assertEqual(result['image'], self.image)
                args, kwargs = upstream.call_args
                self.assertIn('/deployments/gpt-image-2/images/edits?', args[0])
                self.assertEqual(kwargs['headers'], {'api-key': 'test-secret'})
                self.assertEqual(kwargs['files'][0][1][0], 'studio.png')
                self.assertEqual(len(kwargs['files']), 2 if reference else 1)
                self.assertEqual(kwargs['data']['n'], '1')
                self.assertFalse(kwargs['allow_redirects'])
                if reference:
                    self.assertEqual(kwargs['files'][1][1][0], 'reference.png')
                    self.assertIn('Image 2', kwargs['data']['prompt'])

    def test_invalid_inputs_never_call_azure(self):
        invalid = [None, [], {**self.payload, 'prompt': ''}, {**self.payload, 'prompt': 'x' * 4001},
                   {**self.payload, 'image': 'data:image/png;base64,bm90IGFuIGltYWdl'},
                   {**self.payload, 'image': self.image.replace('image/png', 'image/jpeg')},
                   {**self.payload, 'reference': 'https://example.com/image.png'},
                   {**self.payload, 'quality': 'invalid'}, {**self.payload, 'size': '999999x999999'}]
        with patch('server.requests.post') as upstream:
            for payload in invalid:
                with self.subTest(payload=type(payload).__name__), self.assertRaises(server.EditError):
                    server.edit_image(payload, self.config)
            upstream.assert_not_called()

    def test_origin_token_and_host(self):
        self.assertEqual(self.post(headers={'Origin': 'https://other.example'}).status_code, 403)
        self.assertEqual(self.post(headers={'X-Studio-Token': 'wrong'}).status_code, 403)
        self.assertEqual(self.post(headers={'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        self.assertEqual(self.client.get('/api/ai/status', base_url='http://other.example').status_code, 403)

    def test_status_never_exposes_credentials(self):
        with patch('server.configuration', return_value=self.config):
            response = self.client.get('/api/ai/status', base_url=self.origin)
        self.assertEqual(set(response.json), {'configured', 'deployment', 'token'})
        self.assertNotIn('test-secret', response.text)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_private_files_and_traversal(self):
        for path in ('/.env', '/.env.example', '/server.py', '/requirements.txt', '/.git/config',
                     '/assets/../.env', '/src/../../server.py', '/assets/characters/README.md'):
            self.assertEqual(self.client.get(path, base_url=self.origin).status_code, 404, path)
        with self.client.get('/', base_url=self.origin) as response:
            self.assertEqual(response.status_code, 200)
        with self.client.head('/src/main.js', base_url=self.origin) as response:
            self.assertEqual(response.status_code, 200)

    def test_azure_errors_are_sanitized(self):
        for status in (400, 401, 403, 404, 429, 500, 302):
            with patch('server.configuration', return_value=self.config), patch('server.requests.post', return_value=self.azure_response(status)):
                response = self.post()
                self.assertEqual(response.status_code, 502)
                self.assertNotIn('test-secret', response.text)

    def test_timeout_and_invalid_output(self):
        with patch('server.requests.post', side_effect=requests.Timeout('test-secret')):
            with self.assertRaises(server.EditError) as raised:
                server.edit_image(self.payload, self.config)
            self.assertEqual(raised.exception.code, 'azure_timeout')
        with patch('server.requests.post', return_value=self.azure_response(data={'data': []})):
            with self.assertRaises(server.EditError) as raised:
                server.edit_image(self.payload, self.config)
            self.assertEqual(raised.exception.code, 'invalid_result')

    def test_missing_configuration_and_concurrent_request(self):
        with patch('server.configuration', return_value={**self.config, 'configured': False}):
            self.assertEqual(self.post().json['error'], 'not_configured')
        server.EDIT_LOCK.acquire()
        try:
            self.assertEqual(self.post().status_code, 409)
        finally:
            server.EDIT_LOCK.release()

    def test_request_size_limit(self):
        with patch.dict(server.app.config, MAX_CONTENT_LENGTH=100):
            self.assertEqual(self.post().status_code, 413)

    def test_pose_catalog_is_public_but_other_json_is_private(self):
        with self.client.get('/assets/poses/library.json', base_url=self.origin) as response:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, 'application/json')
            catalog = response.json
            self.assertEqual(catalog['version'], 1)
            self.assertEqual(catalog['units'], 'radians')
            identifiers = [pose['id'] for pose in catalog['poses']]
            self.assertEqual(len(identifiers), len(set(identifiers)))
            self.assertIn(catalog['defaultPose'], identifiers)
        for path in ('/assets/poses/private.json', '/assets/poses/../../.env', '/tests/config.json', '/tests/frontend.test.js'):
            self.assertEqual(self.client.get(path, base_url=self.origin).status_code, 404)

    def test_vendored_dependencies_are_complete_and_public(self):
        vendor = server.ROOT / 'assets' / 'vendor'
        manifest = json.loads((vendor / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(set(manifest), {'three', 'three-vrm', 'lucide'})
        for folder, package in manifest.items():
            self.assertTrue(any(name.lower().startswith('license') for name in package['files']))
            for name, digest in package['files'].items():
                with self.subTest(package=folder, file=name):
                    asset = vendor / folder / name
                    self.assertEqual(hashlib.sha256(asset.read_bytes()).hexdigest(), digest)
                    if asset.suffix in ('.js', '.map'):
                        with self.client.get(f'/assets/vendor/{folder}/{name}', base_url=self.origin) as response:
                            self.assertEqual(response.status_code, 200)
                            if asset.suffix == '.js':
                                self.assertEqual(response.mimetype, 'text/javascript')
        for path in ('/assets/vendor/manifest.json', '/scripts/vendor_dependencies.py',
                     '/assets/vendor/../../.env', '/assets/vendor/../../../server.py'):
            self.assertEqual(self.client.get(path, base_url=self.origin).status_code, 404)
        with self.client.get('/', base_url=self.origin) as response:
            self.assertNotIn('https://', response.text)
            for entrypoint in ('three/build/three.module.js', 'three/examples/jsm/',
                               'three-vrm/lib/three-vrm.module.min.js', 'lucide/dist/umd/lucide.min.js'):
                self.assertIn(f'./assets/vendor/{entrypoint}', response.text)

    def test_dotenv_and_environment_precedence(self):
        with patch('server.dotenv_values', return_value={'AZURE_OPENAI_ENDPOINT': self.config['endpoint'], 'AZURE_OPENAI_API_KEY': 'file-key'}), patch.dict(server.os.environ, {}, clear=True):
            self.assertTrue(server.configuration()['configured'])
            with patch.dict(server.os.environ, {'AZURE_OPENAI_API_KEY': 'env-key'}):
                self.assertEqual(server.configuration()['key'], 'env-key')


if __name__ == '__main__':
    unittest.main()