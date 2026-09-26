import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

from PIL import Image
import requests
import server


class ImageEditTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        storage_config = patch.dict(server.app.config, STUDIO_DATA=Path(directory.name))
        storage_config.start()
        self.addCleanup(storage_config.stop)
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
                   {**self.payload, 'garment': 'https://example.com/garment.png'},
                   {**self.payload, 'garment': ''}, {**self.payload, 'garment': 123},
                   {**self.payload, 'garment': self.image.replace('image/png', 'image/jpeg')},
                   {**self.payload, 'quality': 'invalid'}, {**self.payload, 'size': '999999x999999'}]
        with patch('server.requests.post') as upstream:
            for payload in invalid:
                with self.subTest(payload=type(payload).__name__), self.assertRaises(server.EditError):
                    server.edit_image(payload, self.config)
            upstream.assert_not_called()

    def test_person_and_garment_roles_and_order(self):
        garment_bytes = io.BytesIO()
        Image.new('RGB', (32, 32), 'blue').save(garment_bytes, format='PNG')
        garment = 'data:image/png;base64,' + base64.b64encode(garment_bytes.getvalue()).decode()
        for with_person in (False, True):
            with self.subTest(with_person=with_person), patch('server.requests.post', return_value=self.azure_response()) as upstream:
                payload = {**self.payload, 'garment': garment}
                if with_person:
                    payload['reference'] = self.image
                server.edit_image(payload, self.config)
                fields = upstream.call_args.kwargs['data']
                files = upstream.call_args.kwargs['files']
                self.assertEqual([item[1][0] for item in files],
                                 ['studio.png', 'reference.png', 'garment.png'] if with_person
                                 else ['studio.png', 'garment.png'])
                self.assertEqual(files[-1][1][1], garment_bytes.getvalue())
                self.assertIn(f'Image {len(files)} is the garment reference', fields['prompt'])
                self.assertIn('garment reference takes precedence', fields['prompt'])
                self.assertIn('Image 2 is the person reference' if with_person
                              else 'Preserve the identity and hairstyle', fields['prompt'])
        self.assertGreater(server.app.config['MAX_CONTENT_LENGTH'], 3 * 8 * 1024 * 1024 * 4 // 3 + 16000)

    def test_three_maximum_size_images_and_oversized_garment(self):
        raw = base64.b64decode(self.encoded)
        padded = raw + bytes(server.MAX_IMAGE_BYTES - len(raw))
        image = 'data:image/png;base64,' + base64.b64encode(padded).decode()
        with patch('server.configuration', return_value=self.config), patch('server.requests.post', return_value=self.azure_response()) as upstream:
            response = self.post({**self.payload, 'image': image, 'reference': image, 'garment': image})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(upstream.call_args.kwargs['files']), 3)
        oversized = 'data:image/png;base64,' + base64.b64encode(padded + b'!').decode()
        with patch('server.requests.post') as upstream:
            with self.assertRaises(server.EditError) as raised:
                server.edit_image({**self.payload, 'garment': oversized}, self.config)
            self.assertEqual(raised.exception.code, 'invalid_image')
            upstream.assert_not_called()

    def data_request(self, path, payload=None):
        method = self.client.get if payload is None else self.client.post
        options = {} if payload is None else {'json': payload}
        return method('/api/data/' + path, base_url=self.origin,
                      headers={'X-Studio-Token': server.TOKEN}, **options)

    def test_library_persists_images_and_deletes_explicitly(self):
        for kind in ('photo', 'result', 'person', 'garment'):
            saved = self.data_request('assets', {'kind': kind, 'name': kind + '.png', 'image': self.image})
            self.assertEqual(saved.status_code, 201)
            identifier = saved.json['id']
            self.assertEqual(server.local_store().list(kind)['total'], 1)
            with self.data_request('assets/' + identifier) as original:
                self.assertEqual(original.data, base64.b64decode(self.encoded))
            with self.data_request('assets/' + identifier + '?thumbnail=1') as thumbnail:
                self.assertEqual(thumbnail.mimetype, 'image/jpeg')
            self.assertEqual(self.data_request('assets/' + identifier + '/delete', {}).status_code, 200)
            self.assertEqual(self.data_request('assets/' + identifier).status_code, 404)

    def test_library_reopens_in_another_process_and_pages_without_duplicates(self):
        content = base64.b64decode(self.encoded)
        store = server.local_store()
        for index in range(41):
            store.add('photo', f'photo-{index}.png', content, 'image/png')
        first = self.data_request('assets?kind=photo').json
        second = self.data_request('assets?kind=photo&offset=40').json
        self.assertEqual(first['total'], 41)
        self.assertEqual(len(first['items']), 40)
        self.assertEqual(len(second['items']), 1)
        self.assertEqual(len({item['id'] for item in first['items'] + second['items']}), 41)
        value = {'version': 1, 'state': {'pose': 'fashionFront'}}
        store.save_settings('scene', value, 0)
        output = subprocess.check_output([sys.executable, '-c',
            "import json,sys; from storage import StudioStore; store=StudioStore(sys.argv[1]); print(json.dumps({'total':store.list('photo')['total'],'scene':store.settings('scene')['value']}))",
            str(server.app.config['STUDIO_DATA'])], cwd=server.ROOT, text=True)
        self.assertEqual(json.loads(output), {'total': 41, 'scene': value})
        self.assertEqual(self.data_request('assets?kind=photo&offset=999999999999999999999').status_code, 400)

    def test_library_requires_token_and_blocks_database_download(self):
        self.assertEqual(self.client.get('/api/data/assets?kind=photo', base_url=self.origin).status_code, 403)
        self.assertEqual(self.client.get('/api/data/settings/scene', base_url=self.origin).status_code, 403)
        self.assertEqual(self.client.get('/.studio-data/studio.sqlite3', base_url=self.origin).status_code, 404)
        self.assertEqual(self.data_request('assets?kind=invalid').status_code, 400)
        self.assertEqual(self.data_request('assets', {'kind': 'person', 'name': 'invalid.png', 'image': 'invalid'}).status_code, 400)

    def test_settings_persistence_and_stale_writer_protection(self):
        values = {'scene': {'version': 1, 'state': {'pose': 'fashionFront'}},
                  'retouch': {'prompt': 'Studio', 'quality': 'medium', 'size': 'auto', 'referenceId': None, 'garmentId': None}}
        for name, value in values.items():
            self.assertEqual(self.data_request('settings/' + name).json, {'value': None, 'revision': 0})
            self.assertEqual(self.data_request('settings/' + name, {'value': value, 'revision': 0}).json, {'revision': 1})
            self.assertEqual(server.local_store().settings(name), {'value': value, 'revision': 1})
            self.assertEqual(self.data_request('settings/' + name, {'value': value, 'revision': 0}).status_code, 409)
        self.assertEqual(self.data_request('settings/retouch', {'value': {'token': 'secret'}, 'revision': 1}).status_code, 400)

    def test_generated_history_survives_without_browser_and_storage_failure_keeps_image(self):
        with patch('server.configuration', return_value=self.config), patch('server.requests.post', return_value=self.azure_response()):
            response = self.post()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['asset']['kind'], 'result')
            self.assertEqual(server.local_store().list('result')['items'][0]['metadata']['prompt'], self.payload['prompt'])
            with patch('server.StudioStore.add', side_effect=server.StorageError()):
                failed_save = self.post()
            self.assertEqual(failed_save.status_code, 200)
            self.assertEqual(failed_save.json['image'], self.image)
            self.assertEqual(failed_save.json['storageError'], 'storage_failed')

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