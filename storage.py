from contextlib import contextmanager
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import sqlite3
import struct
import uuid

from PIL import Image, ImageOps
from scene_schema import valid_preset


class StorageError(Exception):
    def __init__(self, code='storage_failed', status=500):
        self.code = code
        self.status = status


def valid_character_parts(parts):
    def identifier(value):
        return isinstance(value, str) and re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_-]{0,63}', value)

    def label(value):
        return isinstance(value, str) and 0 < len(value.strip()) <= 160 and len(value) <= 160 and not any(ord(char) < 32 for char in value)

    if not isinstance(parts, dict) or set(parts) != {'catalog', 'selected'}:
        return False
    catalog, selected = parts['catalog'], parts['selected']
    if (not isinstance(catalog, dict) or set(catalog) != {'version', 'groups'} or type(catalog['version']) is not int
            or catalog['version'] != 1 or not isinstance(catalog['groups'], list) or not 1 <= len(catalog['groups']) <= 32
            or not isinstance(selected, dict)):
        return False
    groups, options, meshes, chosen = set(), {}, set(), []
    for group in catalog['groups']:
        if (not isinstance(group, dict) or set(group) != {'id', 'name', 'required', 'options'}
                or not identifier(group['id']) or group['id'] in groups or not label(group['name'])
                or type(group['required']) is not bool or not isinstance(group['options'], list) or not 1 <= len(group['options']) <= 32):
            return False
        groups.add(group['id'])
        group_options = set()
        for option in group['options']:
            if (not isinstance(option, dict) or set(option) != {'id', 'name', 'meshes', 'excludes'}
                    or not identifier(option['id']) or option['id'] in options or not label(option['name'])
                    or not isinstance(option['meshes'], list) or not 1 <= len(option['meshes']) <= 32
                    or not isinstance(option['excludes'], list) or len(option['excludes']) > 128
                    or not all(identifier(excluded) for excluded in option['excludes'])):
                return False
            for name in option['meshes']:
                if not label(name) or name in meshes:
                    return False
                meshes.add(name)
            options[option['id']] = option
            group_options.add(option['id'])
        current = selected.get(group['id'])
        if current is None:
            if group['required']:
                return False
        elif not isinstance(current, str) or current not in group_options:
            return False
        else:
            chosen.append(current)
    if len(options) > 128 or len(meshes) > 512 or set(selected) - groups:
        return False
    for option in options.values():
        if any(excluded not in options or excluded == option['id'] for excluded in option['excludes']):
            return False
    return not any(excluded in chosen for current in chosen for excluded in options[current]['excludes'])


class StudioStore:
    def __init__(self, directory):
        self.directory = Path(directory)

    @contextmanager
    def connect(self):
        connection = None
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(self.directory / 'studio.sqlite3', timeout=20)
            connection.row_factory = sqlite3.Row
            connection.execute('CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, created TEXT NOT NULL, mime TEXT NOT NULL, width INTEGER, height INTEGER, content BLOB NOT NULL, thumbnail BLOB NOT NULL, metadata TEXT NOT NULL)')
            connection.execute('CREATE INDEX IF NOT EXISTS assets_kind_created ON assets (kind, created DESC, id DESC)')
            connection.execute('CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL, content BLOB NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS character_variants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL, base TEXT NOT NULL, appearance TEXT NOT NULL)')
            with connection:
                yield connection
        except (sqlite3.Error, OSError) as error:
            raise StorageError() from error
        finally:
            if connection is not None:
                connection.close()

    @staticmethod
    def record(row):
        return {**{key: row[key] for key in ('id', 'kind', 'name', 'created', 'mime', 'width', 'height')},
                'metadata': json.loads(row['metadata'])}

    def add(self, kind, name, content, mime, metadata=None):
        if kind not in ('photo', 'result', 'person', 'garment'):
            raise StorageError('invalid_request', 400)
        if not isinstance(name, str) or not name.strip() or len(name) > 160 or any(ord(char) < 32 for char in name):
            raise StorageError('invalid_request', 400)
        identifier = uuid.uuid4().hex
        created = datetime.now(timezone.utc).isoformat()
        with Image.open(io.BytesIO(content)) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            image.thumbnail((320, 320))
            background = Image.new('RGB', image.size, '#eef2f4')
            if image.mode == 'RGBA':
                background.paste(image, mask=image.getchannel('A'))
            else:
                background.paste(image.convert('RGB'))
            thumbnail = io.BytesIO()
            background.save(thumbnail, format='JPEG', quality=85)
        with self.connect() as connection:
            connection.execute('INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                               (identifier, kind, name.strip(), created, mime, width, height,
                                content, thumbnail.getvalue(), json.dumps(metadata or {}, ensure_ascii=False)))
            return self.record(connection.execute('SELECT id, kind, name, created, mime, width, height, metadata FROM assets WHERE id = ?', (identifier,)).fetchone())

    def list(self, kind, offset=0):
        if kind not in ('photo', 'result', 'person', 'garment') or not 0 <= offset <= 2_147_483_647:
            raise StorageError('invalid_request', 400)
        with self.connect() as connection:
            rows = connection.execute('SELECT id, kind, name, created, mime, width, height, metadata FROM assets WHERE kind = ? ORDER BY created DESC, id DESC LIMIT 40 OFFSET ?', (kind, offset)).fetchall()
            total = connection.execute('SELECT COUNT(*) FROM assets WHERE kind = ?', (kind,)).fetchone()[0]
            return {'items': [self.record(row) for row in rows], 'total': total}

    def get(self, identifier, thumbnail=False):
        if not re.fullmatch('[a-f0-9]{32}', identifier):
            raise StorageError('not_found', 404)
        column = 'thumbnail' if thumbnail else 'content'
        with self.connect() as connection:
            row = connection.execute(f'SELECT id, kind, name, created, mime, width, height, metadata, {column} AS image_data FROM assets WHERE id = ?', (identifier,)).fetchone()
            if row is None:
                raise StorageError('not_found', 404)
            return (row['image_data'],
                    'image/jpeg' if thumbnail else row['mime'], self.record(row))

    def delete(self, identifier):
        with self.connect() as connection:
            if not connection.execute('DELETE FROM assets WHERE id = ?', (identifier,)).rowcount:
                raise StorageError('not_found', 404)

    def settings(self, name):
        if name not in ('scene', 'retouch', 'shots'):
            raise StorageError('invalid_request', 400)
        with self.connect() as connection:
            row = connection.execute('SELECT value, revision FROM settings WHERE name = ?', (name,)).fetchone()
            return {'value': json.loads(row['value']), 'revision': row['revision']} if row else {'value': None, 'revision': 0}

    def add_character(self, name, content):
        if not isinstance(name, str) or not name.strip() or len(name) > 160 or any(ord(char) < 32 for char in name):
            raise StorageError('invalid_request', 400)
        if not 20 <= len(content) <= 40 * 1024 * 1024:
            raise StorageError('invalid_character', 400)
        magic, version, length, json_length, chunk_type = struct.unpack_from('<5I', content)
        if magic != 0x46546C67 or version != 2 or length != len(content) or chunk_type != 0x4E4F534A or json_length > len(content) - 20:
            raise StorageError('invalid_character', 400)
        try:
            document = json.loads(content[20:20 + json_length])
        except (ValueError, UnicodeError):
            raise StorageError('invalid_character', 400) from None
        extensions = document.get('extensions') if isinstance(document, dict) else None
        if not isinstance(extensions, dict) or not any(isinstance(extensions.get(key), dict) for key in ('VRM', 'VRMC_vrm')):
            raise StorageError('invalid_character', 400)
        for key in ('buffers', 'images'):
            resources = document.get(key, [])
            if not isinstance(resources, list):
                raise StorageError('invalid_character', 400)
            for resource in resources:
                if not isinstance(resource, dict):
                    raise StorageError('invalid_character', 400)
                uri = resource.get('uri')
                if uri is not None and (not isinstance(uri, str) or not uri.startswith('data:')):
                    raise StorageError('invalid_character', 400)
        identifier = uuid.uuid4().hex
        created = datetime.now(timezone.utc).isoformat()
        with self.connect() as connection:
            connection.execute('INSERT INTO characters VALUES (?, ?, ?, ?)', (identifier, name.strip(), created, content))
        return {'id': identifier, 'name': name.strip(), 'created': created, 'size': len(content)}

    def list_characters(self):
        with self.connect() as connection:
            rows = connection.execute('SELECT id, name, created, length(content) AS size FROM characters ORDER BY created DESC, id DESC').fetchall()
            variants = connection.execute('SELECT id, name, created, base, appearance FROM character_variants').fetchall()
            items = [dict(row) for row in rows]
            items.extend({**dict(row), 'size': 0, 'appearance': json.loads(row['appearance'])} for row in variants)
            return sorted(items, key=lambda item: (item['created'], item['id']), reverse=True)

    def create_character(self, name, base, appearance):
        if not isinstance(name, str) or not name.strip() or len(name) > 160 or any(ord(char) < 32 for char in name):
            raise StorageError('invalid_request', 400)
        if (not isinstance(base, str) or not isinstance(appearance, dict)
                or set(appearance) not in ({'height', 'width', 'colors', 'morphs'}, {'height', 'width', 'colors', 'morphs', 'parts'})):
            raise StorageError('invalid_request', 400)
        if 'parts' in appearance and not valid_character_parts(appearance['parts']):
            raise StorageError('invalid_request', 400)
        if not all(type(appearance[key]) in (int, float) and 0.5 <= appearance[key] <= 1.5 for key in ('height', 'width')):
            raise StorageError('invalid_request', 400)
        colors, morphs = appearance['colors'], appearance['morphs']
        if (not isinstance(colors, dict) or len(colors) > 256 or not all(
                re.fullmatch(r'[0-9]{1,5}', key) and isinstance(value, str) and re.fullmatch(r'#[a-fA-F0-9]{6}', value)
                for key, value in colors.items())):
            raise StorageError('invalid_request', 400)
        if (not isinstance(morphs, dict) or len(morphs) > 256 or not all(
                re.fullmatch(r'[0-9]{1,5}:[0-9]{1,5}', key) and type(value) in (int, float) and 0 <= value <= 1
                for key, value in morphs.items())):
            raise StorageError('invalid_request', 400)
        identifier = uuid.uuid4().hex
        created = datetime.now(timezone.utc).isoformat()
        with self.connect() as connection:
            if base not in ('mannequin', 'mannequinFemale', 'quaternius', 'humanFemale', 'humanMale'):
                if not re.fullmatch(r'custom:[a-f0-9]{32}', base) or not connection.execute('SELECT 1 FROM characters WHERE id = ?', (base[7:],)).fetchone():
                    raise StorageError('not_found', 404)
            connection.execute('INSERT INTO character_variants VALUES (?, ?, ?, ?, ?)',
                               (identifier, name.strip(), created, base, json.dumps(appearance)))
        return {'id': identifier, 'name': name.strip(), 'created': created, 'base': base, 'appearance': appearance, 'size': 0}

    def get_character(self, identifier):
        if not re.fullmatch('[a-f0-9]{32}', identifier):
            raise StorageError('not_found', 404)
        with self.connect() as connection:
            row = connection.execute('SELECT name, content FROM characters WHERE id = ?', (identifier,)).fetchone()
            if row is None:
                raise StorageError('not_found', 404)
            return row['content'], row['name']

    def delete_character(self, identifier):
        with self.connect() as connection:
            if connection.execute('SELECT 1 FROM character_variants WHERE base = ?', ('custom:' + identifier,)).fetchone():
                raise StorageError('character_in_use', 409)
            if connection.execute('DELETE FROM character_variants WHERE id = ?', (identifier,)).rowcount:
                return
            if not connection.execute('DELETE FROM characters WHERE id = ?', (identifier,)).rowcount:
                raise StorageError('not_found', 404)

    def save_settings(self, name, value, revision):
        if name not in ('scene', 'retouch', 'shots') or not isinstance(value, dict) or type(revision) is not int or revision < 0:
            raise StorageError('invalid_request', 400)
        if name == 'scene':
            valid = set(value) == {'version', 'state'} and value['version'] == 1 and isinstance(value['state'], dict)
        elif name == 'shots':
            valid = (set(value) == {'version', 'items'} and type(value['version']) is int and value['version'] == 1
                     and isinstance(value['items'], list) and len(value['items']) <= 100
                     and all(valid_preset(item) for item in value['items'])
                     and len({item['id'] for item in value['items']}) == len(value['items']))
        else:
            valid = (set(value) == {'prompt', 'quality', 'size', 'referenceId', 'garmentId'}
                     and isinstance(value['prompt'], str) and len(value['prompt']) <= 4000
                     and value['quality'] in ('low', 'medium', 'high')
                     and value['size'] in ('auto', '1024x1024', '1536x1024', '1024x1536')
                     and all(value[key] is None or isinstance(value[key], str) and re.fullmatch('[a-f0-9]{32}', value[key]) for key in ('referenceId', 'garmentId')))
        if not valid:
            raise StorageError('invalid_request', 400)
        encoded = json.dumps(value, ensure_ascii=False)
        if len(encoded.encode('utf-8')) > 14 * 1024 * 1024:
            raise StorageError('request_too_large', 413)
        with self.connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            current = connection.execute('SELECT revision FROM settings WHERE name = ?', (name,)).fetchone()
            if (current['revision'] if current else 0) != revision:
                raise StorageError('settings_conflict', 409)
            connection.execute('INSERT INTO settings VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, revision = excluded.revision', (name, encoded, revision + 1))
        return {'revision': revision + 1}