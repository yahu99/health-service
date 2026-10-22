import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ...['app.js', 'api.js'].map(name => [`/${name}`, [name, 'text/javascript; charset=utf-8']]),
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const routes = [
  ['POST', /^\/auth\/(register|login|logout)$/],
  ['GET', /^\/(health\/(live|ready)|products|products\/[1-9]\d*\/stock|delivery\/slots|billing\/account|orders\/[1-9]\d*|notifications|profile\/[1-9]\d*)$/],
  ['PUT', /^\/profile\/[1-9]\d*$/],
  ['POST', /^\/(billing\/deposits|orders)$/],
];
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createServer({ apiBaseUrl = process.env.API_BASE_URL || 'http://arch.homework:8081', timeoutMs = 20000 } = {}) {
  const target = new URL(apiBaseUrl);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== '/') {
    throw new Error('API_BASE_URL must be an HTTP(S) origin, for example http://arch.homework:8081');
  }
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/config' && req.method === 'GET') return json(res, 200, { apiBaseUrl: target.origin });
    if (url.pathname.startsWith('/api/')) {
      // Only the configured Gateway is reachable. Never forward client-supplied identity headers.
      const path = url.pathname.slice(4);
      if (!routes.some(([method, pattern]) => method === req.method && pattern.test(path))) return json(res, 404, { message: 'Unknown API route' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { message: 'Cross-origin request rejected' });
      let body;
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) { json(res, 413, { message: 'Request body too large' }); req.resume(); return; }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      } catch { return json(res, 400, { message: 'Could not read request' }); }
      const headers = { accept: 'application/json' };
      for (const name of ['content-type', 'cookie', 'idempotency-key']) if (req.headers[name]) headers[name] = req.headers[name];
      if (body.length) headers['content-length'] = body.length;
      const upstream = (target.protocol === 'https:' ? https : http).request(new URL(path + url.search, target), {
        method: req.method, headers, timeout: timeoutMs,
      }, response => {
        res.statusCode = response.statusCode;
        res.setHeader('Cache-Control', 'no-store');
        for (const name of ['content-type', 'location']) if (response.headers[name]) res.setHeader(name, response.headers[name]);
        if (response.headers['set-cookie']) res.setHeader('Set-Cookie', response.headers['set-cookie'].map(cookie => cookie.replace(/;\s*Domain=[^;]+/gi, '')));
        response.on('error', () => res.destroy());
        response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      upstream.on('error', error => {
        if (res.headersSent || res.destroyed) return;
        json(res, error.code === 'ETIMEDOUT' ? 504 : 502, {
          code: 'GATEWAY_UNAVAILABLE',
          message: `Нет соединения с ${target.origin}. Проверьте API_BASE_URL и port-forward к Ingress.`,
        });
      });
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      upstream.end(body);
      return;
    }
    const asset = assets.get(url.pathname);
    if (!asset || !['GET', 'HEAD'].includes(req.method)) return json(res, 404, { message: 'Not found' });
    try {
      const content = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, {
        'Content-Type': asset[1], 'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { json(res, 500, { message: 'Could not read frontend asset' }); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5173);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => console.log(`Frontend: http://${host}:${port}\nGateway: ${process.env.API_BASE_URL || 'http://arch.homework:8081'}`));
}
