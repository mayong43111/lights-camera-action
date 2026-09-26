import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ROOT, app, main, send_file


@app.get('/tests/frontend.test.js')
def frontend_tests():
    return send_file(ROOT / 'tests' / 'frontend.test.js', mimetype='text/javascript')


if __name__ == '__main__':
    main()