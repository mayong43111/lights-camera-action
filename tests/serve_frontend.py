import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ROOT, app, main, send_file


@app.get('/tests/frontend.test.js')
def frontend_tests():
    return send_file(ROOT / 'tests' / 'frontend.test.js', mimetype='text/javascript')


if os.environ.get('QUATERNIUS_TEST_SOURCE'):
    @app.get('/tests/quaternius-trial.js')
    def quaternius_trial():
        return send_file(ROOT / 'tests' / 'quaternius-trial.js', mimetype='text/javascript')

    @app.get('/tests/quaternius-source.glb')
    def quaternius_source():
        return send_file(Path(os.environ['QUATERNIUS_TEST_SOURCE']).resolve(), mimetype='model/gltf-binary')

if __name__ == '__main__':
    main()