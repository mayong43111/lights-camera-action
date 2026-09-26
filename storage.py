from contextlib import contextmanager
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import sqlite3
import uuid

from PIL import Image, ImageOps


class StorageError(Exception):
    def __init__(self, code='storage_failed', status=500):
        self.code = code
        self.status = status


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
        if name not in ('scene', 'retouch'):
            raise StorageError('invalid_request', 400)
        with self.connect() as connection:
            row = connection.execute('SELECT value, revision FROM settings WHERE name = ?', (name,)).fetchone()
            return {'value': json.loads(row['value']), 'revision': row['revision']} if row else {'value': None, 'revision': 0}

    def save_settings(self, name, value, revision):
        if name not in ('scene', 'retouch') or not isinstance(value, dict) or type(revision) is not int or revision < 0:
            raise StorageError('invalid_request', 400)
        if name == 'scene':
            valid = set(value) == {'version', 'state'} and type(value['version']) is int and value['version'] in (1, 2) and isinstance(value['state'], dict)
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