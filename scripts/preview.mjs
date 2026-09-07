import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { publicFiles, staticCsp } from './static-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// Static allowlist only: no directory browsing, fixture API, proxy or runtime access.
export async function startPreview(port = 4173, { directory = root, basePath = '/', cspHeader = true } = {}) {
  if (!/^\/(?:[a-z0-9-]+\/)*$/.test(basePath)) throw new Error('A bounded directory base path is required');
  const files = new Map([...publicFiles].map(([file, mime]) => [basePath + file, [file, mime]]));
  files.set(basePath, ['index.html', publicFiles.get('index.html')]);
  const server = http.createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      ...(cspHeader ? { 'Content-Security-Policy': `${staticCsp}; frame-ancestors 'none'` } : {}),
    };
    const allowedHosts = [`127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`];
    if (!allowedHosts.includes(request.headers.host)) { response.writeHead(403, headers).end('Loopback host required'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end('Read-only static preview'); return; }
    const pathname = request.url?.split('?')[0];
    if (basePath !== '/' && pathname === basePath.slice(0, -1)) { response.writeHead(301, { ...headers, Location: basePath + request.url.slice(pathname.length) }).end(); return; }
    const file = files.get(pathname);
    if (!file) { response.writeHead(404, headers).end('Not found'); return; }
    try {
      const content = await readFile(path.join(directory, file[0]));
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
