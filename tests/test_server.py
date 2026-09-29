import base64
import hashlib
import io
import json
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import re
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch, MagicMock

from PIL import Image
import requests
import ai_service
import studio_app as server
import auth
from cachelib import FileSystemCache
import msal


@unittest.skip('Unit tests are disabled by project policy')
class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.origin = 'https://studio.test'
        self.tenant = '11111111-1111-4111-8111-111111111111'
        self.application = '22222222-2222-4222-8222-222222222222'
        self.owner = '33333333-3333-4333-8333-333333333333'
        config = patch.dict(server.app.config, STUDIO_DATA=Path(directory.name), STUDIO_AUTH_ENABLED=True,
                            STUDIO_ORIGIN=self.origin, SESSION_COOKIE_SECURE=True,
                            SESSION_COOKIE_NAME='__Host-studio-session', ENTRA_TENANT_ID=self.tenant,
                            ENTRA_CLIENT_ID=self.application, ENTRA_CLIENT_SECRET='offline-test-secret',
                            ENTRA_ADMIN_USER_IDS=[self.owner])
        config.start()
        self.addCleanup(config.stop)
        cache = patch.object(server.app.session_interface, 'cache', FileSystemCache(directory.name + '/sessions'))
        cache.start()
        self.addCleanup(cache.stop)
        for limiter in server.app.extensions['limiter']:
            limiter.reset()
        self.client = server.app.test_client()

    def form(self, client=None):
        response = (client or self.client).get('/login', base_url=self.origin)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Referrer-Policy'], 'same-origin')
        self.assertNotIn('auth-preview.png', response.text)
        self.assertNotIn('class="preview"', response.text)
        self.assertIn('/auth/entra', response.text)
        self.assertIn('type="password"', response.text)
        return re.search(r'name="csrf" value="([^"]+)"', response.text).group(1)

    def create_user(self, username='test-user'):
        with server.app.app_context(), auth.database() as connection:
            connection.execute("INSERT INTO users (id, username, name, provider, password_hash) VALUES (?, ?, ?, 'local', ?)",
                               ('local:' + username, username, username, auth.PASSWORDS.hash('test-password-123')))

    def login(self, username='test-user', client=None):
        client = client or self.client
        csrf = self.form(client)
        result = client.post('/auth/login', base_url=self.origin, headers={'Origin': self.origin},
                             data={'csrf': csrf, 'username': username, 'password': 'test-password-123'})
        self.assertEqual(result.status_code, 302)
        token = client.get('/api/ai/status', base_url=self.origin).json['token']
        return {'Origin': self.origin, 'X-Studio-Token': token}

    def test_anonymous_and_forged_platform_headers_are_rejected(self):
        for path in ('/api/ai/status', '/api/ai/analyze/status', '/api/data/assets?kind=photo'):
            response = self.client.get(path, base_url=self.origin, headers={'X-MS-CLIENT-PRINCIPAL': 'forged'})
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.get('/', base_url=self.origin).location, '/login')
        self.assertEqual(self.client.get('/healthz', base_url='http://internal-probe').status_code, 200)

    def test_password_origin_csrf_rotation_logout_and_replay(self):
        self.create_user()
        csrf = self.form()
        old_cookie = self.client.get_cookie('__Host-studio-session', domain='studio.test').value
        payload = {'csrf': csrf, 'username': 'test-user', 'password': 'test-password-123'}
        self.assertEqual(self.client.post('/auth/login', base_url=self.origin, data=payload).status_code, 403)
        self.assertEqual(self.client.post('/auth/login', base_url=self.origin, headers={'Origin': self.origin}, data={**payload, 'csrf': 'bad'}).status_code, 403)
        headers = self.login()
        cookie = self.client.get_cookie('__Host-studio-session', domain='studio.test')
        self.assertNotEqual(cookie.value, old_cookie)
        self.assertTrue(cookie.secure)
        self.assertTrue(cookie.http_only)
        self.assertEqual(cookie.same_site, 'Lax')
        self.assertEqual(self.client.get('/api/data/settings/scene', base_url=self.origin).status_code, 403)
        self.assertEqual(self.client.post('/auth/logout', base_url=self.origin, headers=headers).status_code, 302)
        self.client.set_cookie('__Host-studio-session', cookie.value, domain='studio.test')
        self.assertEqual(self.client.get('/api/ai/status', base_url=self.origin).status_code, 401)

    def test_wrong_password_and_login_rate_limit(self):
        self.create_user()
        csrf = self.form()
        for attempt in range(8):
            response = self.client.post('/auth/login', base_url=self.origin, headers={'Origin': self.origin},
                                        data={'csrf': csrf, 'username': 'test-user', 'password': 'wrong'})
            self.assertEqual(response.status_code, 401)
        response = self.client.post('/auth/login', base_url=self.origin, headers={'Origin': self.origin},
                                    data={'csrf': csrf, 'username': 'test-user', 'password': 'wrong'})
        self.assertEqual(response.status_code, 429)

    def test_user_settings_assets_and_stale_page_are_isolated(self):
        self.create_user('user-one')
        self.create_user('user-two')
        first = self.login('user-one')
        second_client = server.app.test_client()
        second = self.login('user-two', second_client)
        payload = {'revision': 0, 'value': {'version': 1, 'state': {'private': True}}}
        self.assertEqual(self.client.post('/api/data/settings/scene', base_url=self.origin, headers=first, json=payload).status_code, 200)
        self.assertIsNone(second_client.get('/api/data/settings/scene', base_url=self.origin, headers=second).json['value'])
        image = io.BytesIO()
        Image.new('RGB', (8, 8), 'white').save(image, format='PNG')
        uploaded = self.client.post('/api/data/assets', base_url=self.origin, headers=first,
                                   json={'kind': 'photo', 'name': 'private.png', 'image': 'data:image/png;base64,' + base64.b64encode(image.getvalue()).decode()})
        identifier = uploaded.json['id']
        self.assertEqual(second_client.get('/api/data/assets/' + identifier, base_url=self.origin, headers=second).status_code, 404)
        self.assertEqual(second_client.post('/api/data/assets/' + identifier + '/delete', base_url=self.origin, headers=second, json={}).status_code, 404)
        response = second_client.get('/api/ai/status', base_url=self.origin, headers={'X-Studio-User': 'local:user-one'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.headers['X-Studio-Session-Changed'], '1')

    def test_admin_create_reset_and_session_revocation(self):
        self.create_user()
        headers = self.login()
        payload = {'username': 'created-user', 'name': 'Created', 'password': 'another-password-123'}
        self.assertEqual(self.client.post('/account/users', base_url=self.origin, headers=headers, data=payload).status_code, 403)
        admin = server.app.test_client()
        identifier = 'entra:' + self.tenant + ':' + self.owner
        with server.app.app_context(), auth.database() as connection:
            connection.execute("INSERT INTO users (id, name, provider) VALUES (?, 'Admin', 'entra')", (identifier,))
        with admin.session_transaction(base_url=self.origin) as state:
            state.update(_user_id=identifier + '|1', expires=time.time() + 1000, csrf='admin-test-csrf')
        admin_headers = {'Origin': self.origin, 'X-Studio-Token': 'admin-test-csrf'}
        self.assertEqual(admin.post('/account/users', base_url=self.origin, headers=admin_headers, data=payload).status_code, 302)
        self.assertEqual(admin.post('/account/users', base_url=self.origin, headers=admin_headers, data=payload).status_code, 409)
        self.assertEqual(admin.post('/account/users', base_url=self.origin, headers=admin_headers,
                                    data={**payload, 'username': 'test-user', 'reset': 'on'}).status_code, 302)
        self.assertEqual(self.client.get('/api/ai/status', base_url=self.origin).status_code, 401)

    def test_real_msal_pkce_nonce_state_tenant_and_replay(self):
        fixture = self
        class IdentityHttp:
            nonce = ''
            bad_nonce = False
            bad_tenant = False
            calls = 0

            def get(self, url, **kwargs):
                authority = f'https://login.microsoftonline.com/{fixture.tenant}/v2.0'
                return MagicMock(status_code=200, text=json.dumps({'authorization_endpoint': authority + '/authorize',
                    'token_endpoint': authority + '/token', 'issuer': authority}))

            def post(self, url, **kwargs):
                self.calls += 1
                claims = {'aud': fixture.application, 'iss': f'https://login.microsoftonline.com/{fixture.tenant}/v2.0',
                          'iat': int(time.time()), 'exp': int(time.time()) + 600, 'sub': fixture.owner, 'oid': fixture.owner,
                          'tid': 'wrong' if self.bad_tenant else fixture.tenant, 'nonce': 'wrong' if self.bad_nonce else self.nonce}
                encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
                token = encode({'alg': 'RS256'}) + '.' + encode(claims) + '.c2ln'
                return MagicMock(status_code=200, text=json.dumps({'id_token': token, 'access_token': 'offline-fixture', 'token_type': 'Bearer', 'expires_in': 600}))

        transport = IdentityHttp()
        client = msal.ConfidentialClientApplication(self.application, authority=f'https://login.microsoftonline.com/{self.tenant}',
                                                  client_credential='fixture', http_client=transport, instance_discovery=False)
        with patch('auth.entra_client', return_value=client):
            for bad in ('state', 'nonce', 'tenant', None):
                transport.bad_nonce = bad == 'nonce'
                transport.bad_tenant = bad == 'tenant'
                start = self.client.get('/auth/entra', base_url=self.origin)
                query = parse_qs(urlsplit(start.location).query)
                self.assertEqual(query['code_challenge_method'], ['S256'])
                transport.nonce = query['nonce'][0]
                callback = '/auth/callback?code=fixture&state=' + ('wrong' if bad == 'state' else query['state'][0])
                outsider = server.app.test_client()
                self.assertIn('failed', outsider.get(callback, base_url=self.origin).location)
                response = self.client.get(callback, base_url=self.origin)
                if bad:
                    self.assertIn('failed', response.location)
                    self.assertEqual(self.client.get('/api/ai/status', base_url=self.origin).status_code, 401)
                else:
                    self.assertEqual(response.location, '/')
                    self.assertTrue(self.client.get('/api/auth/session', base_url=self.origin).json['user']['admin'])
                self.assertIn('failed', self.client.get(callback, base_url=self.origin).location)

    def test_cloud_startup_refuses_missing_auth_configuration(self):
        from flask import Flask
        with self.assertRaises(ValueError):
            auth.configure_auth(Flask('incomplete'), {'WEBSITE_HOSTNAME': 'studio.azurewebsites.net'})


@unittest.skip('Unit tests are disabled by project policy')
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

    def test_hosted_anonymous_clients_cannot_obtain_api_tokens(self):
        with patch.dict(server.app.config, STUDIO_AUTH_ENABLED=True):
            response = self.client.get('/api/ai/status', base_url=self.origin)
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('token', response.get_json())

    def azure_response(self, status=200, data=None):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = status
        response.iter_content.return_value = [json.dumps(data or {'data': [{'b64_json': self.encoded}]}).encode()]
        return response

    def test_single_image_and_reference_order(self):
        for reference in (None, self.image):
            with self.subTest(reference=bool(reference)), patch('ai_service.requests.post', return_value=self.azure_response()) as upstream:
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

    def analysis_result(self):
        return {'personCount': 1, 'name': '测试单人', 'category': '肖像', 'notes': '模拟响应，非真实 AI 分析。', 'scene': {
            'jointPose': {'format': 'studio-pose', 'version': 1, 'units': 'radians', 'rotation': 0,
                          'placement': {'grounded': True, 'height': 0}, 'joints': {'head': [0, 0, 0]}},
            'cameraPosition': [0, 2, 8], 'target': [0, 1.6, 0], 'focal': 50, 'aspect': '1.5',
            'exposure': 0.5, 'backdrop': '#edf4f6', 'props': [],
            'lights': {name: {'enabled': True, 'intensity': 3, 'color': '#ffffff', 'position': 0, 'height': 3, 'depth': 2}
                       for name in ('key', 'fill', 'rim')}}}

    def analysis_response(self, result=None):
        return self.azure_response(data={'choices': [{'finish_reason': 'stop', 'message': {
            'content': json.dumps(self.analysis_result() if result is None else result)}}]})

    def test_analysis_uses_configured_vision_and_returns_valid_scene(self):
        payload = {'image': self.image, 'sourceName': 'reference.png', 'consent': True}
        with patch('ai_service.requests.post', return_value=self.analysis_response()) as upstream:
            result = server.analyze_image(payload, {**self.config, 'deployment': 'vision-deployment'})
        self.assertEqual(result['scene'], {**self.analysis_result()['scene'], 'backdrop': '#eef2f4'})
        self.assertTrue(result['id'].startswith('shot-'))
        args, options = upstream.call_args
        self.assertIn('/deployments/vision-deployment/chat/completions?', args[0])
        self.assertEqual(options['json']['messages'][1]['content'][1]['image_url']['url'], self.image)
        response_format = options['json']['response_format']
        self.assertEqual(response_format['type'], 'json_schema')
        self.assertTrue(response_format['json_schema']['strict'])
        schema = response_format['json_schema']['schema']
        self.assertEqual(schema['properties']['name']['type'], 'string')
        self.assertEqual(schema['properties']['category']['type'], 'string')
        scene_schema = schema['properties']['scene']['anyOf'][0]
        self.assertEqual(scene_schema['properties']['aspect']['enum'], ['1.5', '1.333333', '1', '0.5625'])
        self.assertEqual(scene_schema['properties']['backdrop']['enum'], ['#eef2f4'])
        joint_schema = scene_schema['properties']['jointPose']['properties']['joints']['properties']
        self.assertEqual(len(joint_schema), 21)
        self.assertEqual(joint_schema['leftLowerArm']['type'], 'number')
        self.assertFalse(scene_schema['additionalProperties'])
        self.assertEqual(set(scene_schema['required']), set(self.analysis_result()['scene']))
        self.assertFalse(options['allow_redirects'])
        self.assertNotIn('test-secret', json.dumps(result))

    def test_analysis_maps_anatomical_hinges_without_guessing_hidden_fingers(self):
        payload = {'image': self.image, 'sourceName': 'reference.png', 'consent': True}
        response = self.analysis_result()
        response['scene']['jointPose']['joints'].update({
            'leftLowerArm': 1.2, 'rightLowerArm': 0.8, 'leftLowerLeg': 0.4, 'rightLowerLeg': 0.6,
        })
        with patch('ai_service.requests.post', return_value=self.analysis_response(response)):
            result = server.analyze_image(payload, self.config)
        joints = result['scene']['jointPose']['joints']
        self.assertEqual(joints['leftLowerArm'], [0, -1.2, 0])
        self.assertEqual(joints['rightLowerArm'], [0, 0.8, 0])
        self.assertEqual(joints['leftLowerLeg'], [0.4, 0, 0])
        self.assertEqual(joints['rightLowerLeg'], [0.6, 0, 0])
        self.assertNotIn('leftIndexProximal', joints)
        self.assertEqual(response['scene']['jointPose']['joints']['leftLowerArm'], 1.2)
        for bend in (-0.1, 2.66, True, [0, 1, 0]):
            response['scene']['jointPose']['joints']['leftLowerArm'] = bend
            with patch('ai_service.requests.post', return_value=self.analysis_response(response)), self.assertRaises(server.EditError) as raised:
                server.analyze_image(payload, self.config)
            self.assertEqual(raised.exception.code, 'invalid_result')

    def test_analysis_rejects_multiple_people_invalid_data_and_missing_consent(self):
        payload = {'image': self.image, 'sourceName': 'reference.png', 'consent': True}
        for count in (0, 2, 5):
            with patch('ai_service.requests.post', return_value=self.analysis_response({'personCount': count})), self.assertRaises(server.EditError) as raised:
                server.analyze_image(payload, self.config)
            self.assertEqual(raised.exception.code, 'single_person_required')
        invalid = self.analysis_result()
        invalid['scene']['cameraPosition'] = invalid['scene']['target']
        with patch('ai_service.requests.post', return_value=self.analysis_response(invalid)), self.assertRaises(server.EditError) as raised:
            server.analyze_image(payload, self.config)
        self.assertEqual(raised.exception.code, 'invalid_result')
        invalid = self.analysis_result()
        invalid['scene']['aspect'] = '0.666667'
        with patch('ai_service.requests.post', return_value=self.analysis_response(invalid)), self.assertRaises(server.EditError) as raised:
            server.analyze_image(payload, self.config)
        self.assertEqual(raised.exception.code, 'invalid_result')
        with patch('ai_service.requests.post') as upstream:
            for bad in ({**payload, 'consent': False}, {**payload, 'image': 'https://example.com/photo.png'}):
                with self.assertRaises(server.EditError):
                    server.analyze_image(bad, self.config)
            upstream.assert_not_called()

    def test_analysis_configuration_status_and_protected_route(self):
        with patch('ai_service.dotenv_values', return_value={'AZURE_OPENAI_VISION_DEPLOYMENT': 'vision-model'}), patch.dict('ai_service.os.environ', {}, clear=True), patch('ai_service.configuration', return_value=self.config):
            config = server.vision_configuration()
        self.assertEqual(config['deployment'], 'vision-model')
        self.assertEqual(config['version'], '2024-10-21')
        with patch('studio_app.vision_configuration', return_value=config):
            status = self.client.get('/api/ai/analyze/status', base_url=self.origin)
            self.assertEqual(set(status.json), {'configured', 'deployment', 'token'})
            self.assertNotIn('test-secret', status.text)
            self.assertEqual(self.client.post('/api/ai/analyze', base_url=self.origin, json={}).status_code, 403)
            with patch('ai_service.requests.post', return_value=self.analysis_response()):
                response = self.client.post('/api/ai/analyze', base_url=self.origin,
                                            json={'image': self.image, 'sourceName': 'reference.png', 'consent': True},
                                            headers={'X-Studio-Token': server.TOKEN})
                self.assertEqual(response.status_code, 200)

    def test_analysis_errors_never_leak_keys_and_do_not_retry(self):
        payload = {'image': self.image, 'sourceName': 'reference.png', 'consent': True}
        for error, expected in ((requests.Timeout('test-secret'), 'azure_timeout'), (requests.ConnectionError('test-secret'), 'azure_network')):
            with patch('ai_service.requests.post', side_effect=error) as upstream, self.assertRaises(server.EditError) as raised:
                server.analyze_image(payload, self.config)
            self.assertEqual(raised.exception.code, expected)
            self.assertEqual(upstream.call_count, 1)
        with patch('ai_service.requests.post') as upstream, self.assertRaises(server.EditError) as raised:
            server.analyze_image(payload, {**self.config, 'configured': False})
        self.assertEqual(raised.exception.code, 'vision_not_configured')
        upstream.assert_not_called()

    def test_analysis_presets_persist_with_validation_and_conflict_protection(self):
        preset = {'id': 'shot-' + 'a' * 32, 'name': '测试', 'category': '肖像', 'notes': '模拟数据',
                  'sourceName': 'test.png', 'scene': self.analysis_result()['scene'],
                  'thumbnail': 'data:image/jpeg;base64,AAAA'}
        value = {'version': 1, 'items': [preset]}
        self.assertEqual(self.data_request('settings/shots', {'value': value, 'revision': 0}).status_code, 200)
        self.assertEqual(self.data_request('settings/shots').json['value'], value)
        self.assertEqual(self.data_request('settings/shots', {'value': value, 'revision': 0}).status_code, 409)
        for bad in ({'version': 1, 'items': [preset, preset]}, {'version': 1, 'items': [{**preset, 'category': 'unknown'}]},
                    {'version': 1, 'items': [{**preset, 'thumbnail': 'https://example.com/image.jpg'}]}):
            self.assertEqual(self.data_request('settings/shots', {'value': bad, 'revision': 1}).status_code, 400)
        self.assertEqual(self.data_request('settings/shots').json['value'], value)

    def test_invalid_inputs_never_call_azure(self):
        invalid = [None, [], {**self.payload, 'prompt': ''}, {**self.payload, 'prompt': 'x' * 4001},
                   {**self.payload, 'image': 'data:image/png;base64,bm90IGFuIGltYWdl'},
                   {**self.payload, 'image': self.image.replace('image/png', 'image/jpeg')},
                   {**self.payload, 'reference': 'https://example.com/image.png'},
                   {**self.payload, 'garment': 'https://example.com/garment.png'},
                   {**self.payload, 'garment': ''}, {**self.payload, 'garment': 123},
                   {**self.payload, 'garment': self.image.replace('image/png', 'image/jpeg')},
                   {**self.payload, 'quality': 'invalid'}, {**self.payload, 'size': '999999x999999'}]
        with patch('ai_service.requests.post') as upstream:
            for payload in invalid:
                with self.subTest(payload=type(payload).__name__), self.assertRaises(server.EditError):
                    server.edit_image(payload, self.config)
            upstream.assert_not_called()

    def test_person_and_garment_roles_and_order(self):
        garment_bytes = io.BytesIO()
        Image.new('RGB', (32, 32), 'blue').save(garment_bytes, format='PNG')
        garment = 'data:image/png;base64,' + base64.b64encode(garment_bytes.getvalue()).decode()
        for with_person in (False, True):
            with self.subTest(with_person=with_person), patch('ai_service.requests.post', return_value=self.azure_response()) as upstream:
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
        padded = raw + bytes(ai_service.MAX_IMAGE_BYTES - len(raw))
        image = 'data:image/png;base64,' + base64.b64encode(padded).decode()
        with patch('studio_app.configuration', return_value=self.config), patch('ai_service.requests.post', return_value=self.azure_response()) as upstream:
            response = self.post({**self.payload, 'image': image, 'reference': image, 'garment': image})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(upstream.call_args.kwargs['files']), 3)
        oversized = 'data:image/png;base64,' + base64.b64encode(padded + b'!').decode()
        with patch('ai_service.requests.post') as upstream:
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
        with patch('studio_app.configuration', return_value=self.config), patch('ai_service.requests.post', return_value=self.azure_response()):
            response = self.post()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['asset']['kind'], 'result')
            self.assertEqual(server.local_store().list('result')['items'][0]['metadata']['prompt'], self.payload['prompt'])
            with patch('studio_app.StudioStore.add', side_effect=server.StorageError()):
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
        with patch('studio_app.configuration', return_value=self.config):
            response = self.client.get('/api/ai/status', base_url=self.origin)
        self.assertEqual(set(response.json), {'configured', 'deployment', 'token'})
        self.assertNotIn('test-secret', response.text)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_private_files_and_traversal(self):
        for path in ('/.env', '/.env.example', '/server.py', '/requirements.txt', '/.git/config',
                     '/assets/../.env', '/src/../../server.py', '/assets/characters/README.md',
                     '/src/main.js', '/src/main.tsx', '/src/studio-controller.ts'):
            self.assertEqual(self.client.get(path, base_url=self.origin).status_code, 404, path)
        with self.client.get('/', base_url=self.origin) as response:
            self.assertEqual(response.status_code, 200)
        with self.client.head('/src/main.js', base_url=self.origin) as response:
            self.assertEqual(response.status_code, 404)

    def test_compiled_frontend_allowlist_and_missing_build(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'ROOT', Path(directory)):
            self.assertEqual(self.client.get('/', base_url=self.origin).status_code, 503)
            build = Path(directory) / 'dist'
            (build / 'static').mkdir(parents=True)
            (build / 'index.html').write_text('<div id="root"></div>', encoding='utf-8')
            (build / 'static' / 'app.js').write_text('export {};', encoding='utf-8')
            (build / 'static' / '.secret.js').write_text('private', encoding='utf-8')
            with self.client.get('/', base_url=self.origin) as response:
                self.assertEqual(response.status_code, 200)
                self.assertIn('id="root"', response.text)
            with self.client.get('/static/app.js', base_url=self.origin) as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.mimetype, 'text/javascript')
            for path in ('/static/.secret.js', '/static/../index.html', '/static/missing.js', '/dist/index.html'):
                self.assertEqual(self.client.get(path, base_url=self.origin).status_code, 404, path)

    def test_azure_errors_are_sanitized(self):
        for status in (400, 401, 403, 404, 429, 500, 302):
            with patch('studio_app.configuration', return_value=self.config), patch('ai_service.requests.post', return_value=self.azure_response(status)):
                response = self.post()
                self.assertEqual(response.status_code, 502)
                self.assertNotIn('test-secret', response.text)

    def test_timeout_and_invalid_output(self):
        with patch('ai_service.requests.post', side_effect=requests.Timeout('test-secret')):
            with self.assertRaises(server.EditError) as raised:
                server.edit_image(self.payload, self.config)
            self.assertEqual(raised.exception.code, 'azure_timeout')
        with patch('ai_service.requests.post', return_value=self.azure_response(data={'data': []})):
            with self.assertRaises(server.EditError) as raised:
                server.edit_image(self.payload, self.config)
            self.assertEqual(raised.exception.code, 'invalid_result')

    def test_missing_configuration_and_concurrent_request(self):
        with patch('studio_app.configuration', return_value={**self.config, 'configured': False}):
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
        with self.client.get('/assets/shots/thumbnails.json', base_url=self.origin) as response:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, 'application/json')
            self.assertEqual(len(response.json), 20)
            for thumbnail in response.json.values():
                self.assertTrue(thumbnail.startswith('data:image/jpeg;base64,'))
        for path in ('/assets/poses/private.json', '/assets/shots/private.json', '/assets/poses/../../.env', '/tests/config.json', '/tests/frontend.test.js'):
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
            class Entrypoints(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.paths = []

                def handle_starttag(self, tag, attributes):
                    attributes = dict(attributes)
                    if tag == 'script' and attributes.get('type') == 'module':
                        self.paths.append(attributes['src'])
                    if tag == 'link' and attributes.get('rel') == 'stylesheet':
                        self.paths.append(attributes['href'])

            parser = Entrypoints()
            parser.feed(response.text)
            self.assertGreaterEqual(len(parser.paths), 2)
            for entrypoint in parser.paths:
                self.assertTrue(entrypoint.startswith('/static/'))
                with self.client.get(entrypoint, base_url=self.origin) as compiled:
                    self.assertEqual(compiled.status_code, 200)

    def test_dotenv_and_environment_precedence(self):
        with patch('ai_service.dotenv_values', return_value={'AZURE_OPENAI_ENDPOINT': self.config['endpoint'], 'AZURE_OPENAI_API_KEY': 'file-key'}), patch.dict(server.os.environ, {}, clear=True):
            self.assertTrue(server.configuration()['configured'])
            with patch.dict(server.os.environ, {'AZURE_OPENAI_API_KEY': 'env-key'}):
                self.assertEqual(server.configuration()['key'], 'env-key')


if __name__ == '__main__':
    unittest.main()