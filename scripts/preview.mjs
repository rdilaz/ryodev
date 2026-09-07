import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/src/styles.css', ['src/styles.css', 'text/css; charset=utf-8']],
  ['/assets/workstation.svg', ['assets/workstation.svg', 'image/svg+xml; charset=utf-8']],
  ...['app', 'model', 'fixtures'].map(name => [`/src/${name}.js`, [`src/${name}.js`, 'text/javascript; charset=utf-8']]),
]);

// Static allowlist only: no directory browsing, fixture API, proxy or runtime access.
export async function startPreview(port = 4173) {
  const server = http.createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'",
    };
    const allowedHosts = [`127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`];
    if (!allowedHosts.includes(request.headers.host)) { response.writeHead(403, headers).end('Loopback host required'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end('Read-only static preview'); return; }
    const file = files.get(request.url?.split('?')[0]);
    if (!file) { response.writeHead(404, headers).end('Not found'); return; }
    try {
      const content = await readFile(path.join(root, file[0]));
      response.writeHead(200, { ...headers, 'Content-Type': file[1] }).end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(500, headers).end('Static file unavailable'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535');
  const server = await startPreview(port);
  console.log(`RyoDev invented-data preview: http://127.0.0.1:${server.address().port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
