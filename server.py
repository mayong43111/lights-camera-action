import argparse
import os
import webbrowser

from werkzeug.serving import make_server

from studio_app import app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--reload', action='store_true')
    parser.add_argument('--strict-port', action='store_true')
    args = parser.parse_args()
    if args.reload:
        if not app.config['STUDIO_AUTH_ENABLED']:
            app.config['STUDIO_ORIGIN'] = f'http://127.0.0.1:{args.port}'
        if not args.no_browser and not os.environ.get('WERKZEUG_RUN_MAIN'):
            webbrowser.open(app.config['STUDIO_ORIGIN'])
        app.run(host='127.0.0.1', port=args.port, debug=False, use_reloader=True,
                use_debugger=False, threaded=True,
                exclude_patterns=['*/.studio-data/*', '*/.venv/*', '*/node_modules/*',
                                  '*/dist/*', '*/test-results/*', '*/.git/*'])
        return
    ports = [args.port] if args.strict_port else range(args.port, min(args.port + 20, 65536))
    for port in ports:
        try:
            server = make_server('127.0.0.1', port, app, threaded=True)
            break
        except SystemExit:
            continue
    else:
        raise SystemExit('No available local port.')
    if not app.config['STUDIO_AUTH_ENABLED']:
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