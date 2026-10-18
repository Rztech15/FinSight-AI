// Zero-dependency local server: serves /public and mounts the /api handlers exactly as Vercel would.
//   npm run dev            → http://localhost:3000
//   PORT=4000 npm run dev
// Reads variables from a local .env file if present (never committed).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pub = join(root, 'public');

if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function readBody(req, limit = 256 * 1024) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function shim(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
  return res;
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
        const file = join(root, 'api', `${name}.js`);
        if (!existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
        const mod = await import(pathToFileURL(file).href);
        if (req.method === 'POST') {
          const raw = await readBody(req);
          try { req.body = raw ? JSON.parse(raw) : undefined; } catch { res.statusCode = 400; return res.end('{"error":"Invalid JSON"}'); }
        }
        return mod.default(req, shim(res));
      }
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (!rel || rel.endsWith('/')) rel = join(rel, 'index.html');
      const full = join(pub, rel);
      if (!full.startsWith(pub)) { res.statusCode = 403; return res.end('Forbidden'); }
      let target = full;
      try { if ((await stat(full)).isDirectory()) target = join(full, 'index.html'); } catch { /* handled below */ }
      const data = await readFile(target);
      res.setHeader('Content-Type', MIME[extname(target)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(data);
    } catch (err) {
      if (err.code === 'ENOENT') { res.statusCode = 404; res.end('Not found'); } else { res.statusCode = 500; res.end('Server error'); }
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`FinSight AI running at http://localhost:${port}`));
}
