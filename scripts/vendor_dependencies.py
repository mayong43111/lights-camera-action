import argparse
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

import requests


ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {
    'three': ('three', '0.180.0', [
        'build/three.module.js',
        'examples/jsm/controls/OrbitControls.js',
        'examples/jsm/controls/TransformControls.js',
        'examples/jsm/loaders/GLTFLoader.js',
        'examples/jsm/animation/CCDIKSolver.js',
        'examples/jsm/postprocessing/EffectComposer.js',
        'examples/jsm/postprocessing/RenderPass.js',
        'examples/jsm/postprocessing/BokehPass.js',
        'examples/jsm/postprocessing/OutputPass.js',
        'examples/jsm/environments/RoomEnvironment.js',
    ]),
    'three-vrm': ('@pixiv/three-vrm', '3.5.5', ['lib/three-vrm.module.min.js']),
    'lucide': ('lucide', '0.468.0', ['dist/umd/lucide.min.js']),
}
IMPORTS = re.compile(r'''(?:^|[;\n])\s*(?:import|export)\s*(?:[^;]*?\bfrom\s*)?['"]([^'"]+)['"]''')


def download_dependencies(proxy):
    manifest = {}
    with requests.Session() as session:
        session.trust_env = False
        session.proxies = {'http': proxy, 'https': proxy}
        for folder, (package, version, entrypoints) in PACKAGES.items():
            response = session.get(f'https://registry.npmjs.org/{package}/{version}', timeout=(15, 120))
            response.raise_for_status()
            distribution = response.json()['dist']
            response = session.get(distribution['tarball'], timeout=(15, 120))
            response.raise_for_status()
            archive_bytes = response.content
            algorithm, expected = distribution['integrity'].split('-', 1)
            actual = base64.b64encode(hashlib.new(algorithm, archive_bytes).digest()).decode('ascii')
            if actual != expected:
                raise ValueError(f'Integrity mismatch: {package}@{version}')
            with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:gz') as archive:
                members = {member.name.removeprefix('package/'): member
                           for member in archive.getmembers() if member.isfile()}
                pending = list(entrypoints)
                pending.extend(name for name in members
                               if '/' not in name and name.lower().startswith('license'))
                if not any(name.lower().startswith('license') for name in pending):
                    raise ValueError(f'Missing license: {package}')
                files = {}
                while pending:
                    relative = pending.pop()
                    if relative in files:
                        continue
                    if '..' in PurePosixPath(relative).parts or PurePosixPath(relative).is_absolute():
                        raise ValueError(f'Unsafe package path: {relative}')
                    with archive.extractfile(members[relative]) as source:
                        content = source.read()
                    if relative.endswith('.js'):
                        for specifier in IMPORTS.findall(content.decode('utf-8')):
                            if specifier.startswith('.'):
                                resolved = (ROOT / relative).parent.joinpath(specifier).resolve()
                                pending.append(resolved.relative_to(ROOT).as_posix())
                            elif specifier != 'three':
                                raise ValueError(f'Unmapped import in {relative}: {specifier}')
                        source_map = re.search(rb'//# sourceMappingURL=([^\s]+)', content)
                        if source_map:
                            map_path = str(PurePosixPath(relative).parent / source_map[1].decode('utf-8'))
                            pending.append(map_path)
                    files[relative] = content
            destination = ROOT / 'assets' / 'vendor' / folder
            for relative, content in sorted(files.items()):
                path = destination / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            manifest[folder] = {
                'package': package, 'version': version,
                'source': distribution['tarball'], 'integrity': distribution['integrity'],
                'files': {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())},
            }
            print(f'{package}@{version}: {len(files)} files', flush=True)
    (ROOT / 'assets' / 'vendor' / 'manifest.json').write_text(
        json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Vendor pinned browser dependencies through an HTTP proxy.')
    parser.add_argument('--proxy', default='http://127.0.0.1:1080')
    download_dependencies(parser.parse_args().proxy)