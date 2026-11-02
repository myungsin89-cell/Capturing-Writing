import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'local-spellcheck-api',
    async configureServer(server) {
      const { default: handler } = await import('./api/spellcheck.js');
      server.middlewares.use('/api/spellcheck', (req, res) => {
        let body = ''; let oversized = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (oversized) return;
          body += chunk;
          if (Buffer.byteLength(body) > 100000) { oversized = true; body = ''; }
        });
        req.on('end', () => {
          req.body = oversized ? null : body;
          res.status = (status) => { res.statusCode = status; return res; };
          res.json = (value) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
          handler(req, res).catch(() => { if (!res.writableEnded) res.status(500).json({ error: '잠시 뒤 다시 검사해 주세요.' }); });
        });
      });
    }
  }],
});
