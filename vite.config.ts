import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), {
    name: 'studio-assets',
    handleHotUpdate({ file, server }) {
      const path = normalizePath(relative(server.config.root, file));
      const isFrontend = path.startsWith('src/')
        || /^(index\.html|styles\.css|auth\.css)$/.test(path)
        || /^assets\/(characters|poses|shots|vendor)\//.test(path);
      if (!isFrontend) return [];
      if (path.startsWith('assets/') || path === 'auth.css') {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
    closeBundle() {
      cpSync(resolve('assets'), resolve('dist/assets'), { recursive: true });
    },
  }],
  publicDir: false,
  server: {
    port: 4178,
    strictPort: true,
    watch: {
      ignored: ['**/.studio-data/**', '**/.venv/**', '**/dist/**', '**/tests/**', '**/test-results/**', '**/playwright-report/**'],
    },
    fs: {
      deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/.studio-data/**', '**/.venv/**'],
    },
    proxy: Object.fromEntries(
      ['/api', '/auth', '/account', '/login', '/logout', '/auth.css'].map(path => [path, {
        target: process.env.STUDIO_API_URL ?? 'http://127.0.0.1:4173',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            if (incoming.headers.origin === `http://${incoming.headers.host}`) {
              outgoing.setHeader('Origin', process.env.STUDIO_API_URL ?? 'http://127.0.0.1:4173');
            }
          });
        },
      }]),
    ),
  },
  build: {
    target: 'es2022',
    assetsDir: 'static',
  },
});