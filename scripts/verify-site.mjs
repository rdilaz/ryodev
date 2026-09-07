import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';
import { chromium } from 'playwright-core';
import { staticCsp } from './static-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const playwrightVersion = createRequire(import.meta.url)('playwright-core/package.json').version;
const storeKey = 'ryodev-invented-demo-v1';

// Independent publication contract: never derive this from the builder's allowlist.
export const expectedFiles = new Map([
  ['index.html', 'text/html'],
  ['src/app.js', 'text/javascript'],
  ['src/model.js', 'text/javascript'],
  ['src/fixtures.js', 'text/javascript'],
  ['src/styles.css', 'text/css'],
  ['assets/workstation.svg', 'image/svg+xml'],
  ['manifest.webmanifest', 'application/manifest+json'],
  ['assets/icon.svg', 'image/svg+xml'],
  ['assets/apple-touch-icon.png', 'image/png'],
  ['assets/icon-192.png', 'image/png'],
  ['assets/icon-512.png', 'image/png'],
  ['.nojekyll', 'text/plain'],
]);
export const pngSizes = new Map([
  ['assets/apple-touch-icon.png', 180], ['assets/icon-192.png', 192], ['assets/icon-512.png', 512],
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const crc32 = bytes => {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(bytes);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export function validatePng(bytes, size, label) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${label}: full PNG signature`);
  let offset = 8;
  let channels;
  let ended = false;
  let dataEnded = false;
  const chunks = [];
  const compressed = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, `${label}: truncated chunk header`);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    assert.ok(end <= bytes.length && /^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type), `${label}: invalid ${type} chunk`);
    assert.equal(bytes.readUInt32BE(end - 4), crc32(bytes.subarray(offset + 4, end - 4)), `${label}: ${type} CRC`);
    assert.ok(chunks.length || type === 'IHDR', `${label}: IHDR must be first`);
    const data = bytes.subarray(offset + 8, end - 4);
    if (type === 'IHDR') {
      assert.equal(chunks.length, 0, `${label}: duplicate IHDR`);
      assert.equal(length, 13, `${label}: IHDR length`);
      assert.deepEqual([data.readUInt32BE(0), data.readUInt32BE(4)], [size, size], `${label}: dimensions`);
      assert.ok(data[8] === 8 && [2, 6].includes(data[9]), `${label}: reviewed 8-bit RGB/RGBA asset`);
      assert.deepEqual([...data.subarray(10)], [0, 0, 0], `${label}: compression, filter and non-interlaced encoding`);
      channels = data[9] === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      assert.equal(dataEnded, false, `${label}: IDAT chunks must be contiguous`);
      compressed.push(data);
    } else if (type === 'IEND') {
      assert.equal(length, 0, `${label}: empty IEND`);
      assert.equal(end, bytes.length, `${label}: no trailing payload`);
      ended = true;
    } else {
      assert.ok(/^[a-z]/.test(type), `${label}: unsupported critical chunk ${type}`);
      assert.notEqual(type, 'acTL', `${label}: icons must be static`);
    }
    if (compressed.length && type !== 'IDAT') dataEnded = true;
    chunks.push(type);
    offset = end;
  }
  assert.ok(ended && compressed.length, `${label}: IDAT and IEND required`);
  const stride = size * channels + 1;
  const pixels = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: stride * size });
  assert.equal(pixels.length, stride * size, `${label}: decoded scanline length`);
  for (let row = 0; row < size; row++) assert.ok(pixels[row * stride] <= 4, `${label}: row ${row} filter`);
  return { path: label, width: size, height: size, chunks, sha256: sha256(bytes) };
}

const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
  .map(([, name, double, single, bare]) => [name.toLowerCase(), double ?? single ?? bare]));

export function validateStaticFiles(files) {
  assert.deepEqual([...files.keys()].sort(), [...expectedFiles.keys()].sort(), 'Exactly twelve independently named public files');
  const html = files.get('index.html').toString('utf8');
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0]));
  const policies = metas.filter(meta => meta['http-equiv']?.toLowerCase() === 'content-security-policy');
  assert.equal(policies.length, 1, 'Exactly one static meta CSP');
  assert.equal(policies[0].content, staticCsp, 'Static meta CSP matches the preview contract');
  assert.deepEqual(policies[0].content.split(';').map(d => d.trim()).sort(), [
    "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "manifest-src 'self'",
    "connect-src 'none'", "object-src 'none'", "frame-src 'none'", "child-src 'none'", "worker-src 'none'",
    "base-uri 'none'", "form-action 'none'",
  ].sort(), 'No unsafe-inline, eval, reporting endpoint or relaxed policy');
  assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.search(/<(?:link|script)\b/i), 'Meta CSP precedes resources');
  assert.equal(metas.find(meta => meta.name === 'viewport')?.content, 'width=device-width, initial-scale=1, viewport-fit=cover');
  assert.equal(metas.find(meta => meta.name === 'apple-mobile-web-app-capable')?.content, 'yes');
  assert.equal(metas.find(meta => meta.name === 'apple-mobile-web-app-title')?.content, 'RyoDev Demo');
  assert.equal(metas.find(meta => meta.name === 'apple-mobile-web-app-status-bar-style')?.content, 'black-translucent');
  const apple = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0])).filter(link => link.rel === 'apple-touch-icon');
  assert.deepEqual(apple, [{ rel: 'apple-touch-icon', sizes: '180x180', href: './assets/apple-touch-icon.png' }]);

  const manifest = JSON.parse(files.get('manifest.webmanifest'));
  assert.deepEqual(manifest, {
    name: 'RyoDev Demo', short_name: 'RyoDev Demo',
    description: 'Invented-data visual demo. No real sessions connected. Seen is not approved.',
    lang: 'en', start_url: './', scope: './', display: 'standalone', orientation: 'any',
    background_color: '#11172c', theme_color: '#11172c',
    icons: [192, 512].map(size => ({ src: `./assets/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
  }, 'Manifest has only the reviewed standalone demo identity and icon keys');

  const base = new URL('https://publication.invalid/ryodev/');
  const references = [];
  const reference = (value, file) => {
    assert.ok(value && !/[\\\s%&?]/.test(value), `${file}: ambiguous or encoded reference ${value}`);
    if (value.startsWith('#')) {
      assert.match(files.get(file).toString(), new RegExp(`\\bid=["']${value.slice(1)}["']`), `${file}: fragment ${value} exists`);
    } else assert.match(value, /^\.\.?\//, `${file}: references must be explicitly relative: ${value}`);
    const resolved = new URL(value, new URL(file, base));
    assert.ok(resolved.origin === base.origin && (resolved.pathname === base.pathname || expectedFiles.has(resolved.pathname.slice(base.pathname.length))) && resolved.pathname.startsWith(base.pathname), `${file}: reference escapes the twelve public paths: ${value}`);
    references.push({ from: file, reference: value, path: resolved.pathname });
  };
  for (const [file, bytes] of files) {
    if (!/\.(?:html|css|js|svg)$/.test(file)) continue;
    const text = bytes.toString('utf8');
    const withoutNamespace = text.replace(/\bxmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
    assert.doesNotMatch(withoutNamespace, /(?:https?|wss?|ftp):\/\/|["'(]\s*\/\//i, `${file}: no external URL except the SVG namespace`);
    assert.doesNotMatch(text, /sourceMappingURL|sourceURL\s*=/i, `${file}: no source maps or development source references`);
    if (file.endsWith('.js')) {
      assert.doesNotMatch(text, /\b(?:fetch|XMLHttpRequest|WebSocket|WebTransport|EventSource|sendBeacon|Worker|SharedWorker|serviceWorker|importScripts|RTCPeerConnection|webkitRTCPeerConnection|cookieStore|caches|eval)\b|\bdocument\s*(?:\.\s*cookie\b|\[\s*['"]cookie['"])|\bnew\s+(?:Function|URL)\s*\(|\bimport\s*\(/i, `${file}: no application network, cookie, worker, dynamic-code or cache API surface`);
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*)(['"])([^'"]+)\1/g)) reference(match[2], file);
    }
    for (const match of text.matchAll(/<[a-z][^>]*>/gi)) {
      assert.doesNotMatch(match[0], /^<(?:form|iframe|frame|object|embed|base|portal)\b|\son\w+\s*=|\s(?:style|srcdoc|ping|action|formaction)\s*=/i, `${file}: no operational or inline-executable markup`);
      for (const [name, value] of Object.entries(attributes(match[0]))) {
        if (['href', 'src', 'xlink:href', 'poster', 'data'].includes(name)) reference(value, file);
        if (name === 'srcset') for (const candidate of value.split(',')) reference(candidate.trim().split(/\s+/)[0], file);
      }
    }
    for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.ok(file.endsWith('.html') && attributes(match[1]).src && !match[2].trim(), `${file}: only external module scripts`);
    }
    assert.doesNotMatch(text, /<(?:style|foreignObject)\b|<!ENTITY|<!DOCTYPE\s+svg/i, `${file}: no inline CSS or active SVG content`);
    const urls = [...text.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)];
    assert.equal(urls.length, [...text.matchAll(/\burl\s*\(/gi)].length, `${file}: no unparsed CSS/SVG URL`);
    for (const match of urls) reference(match[2], file);
    const imports = [...text.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi)];
    assert.equal(imports.length, [...text.matchAll(/@import\b/gi)].length, `${file}: no unparsed stylesheet import`);
    for (const match of imports) reference(match[2], file);
  }
  // An omitted id inherits start_url. An explicit './' id instead resolves at the origin root.
  for (const key of ['scope', 'start_url']) reference(manifest[key], 'manifest.webmanifest');
  for (const icon of manifest.icons) reference(icon.src, 'manifest.webmanifest');
  assert.equal(files.get('.nojekyll').length, 0, 'Empty .nojekyll marker');
  const icons = [...pngSizes].map(([file, size]) => validatePng(files.get(file), size, file));
  return { references, icons, manifest };
}

export function siteUrl(value) {
  const url = new URL(value);
  assert.ok(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'), 'HTTPS publication or explicit loopback preview required');
  assert.equal(url.pathname, '/ryodev/', 'Use the canonical /ryodev/ directory URL, including its trailing slash');
  assert.ok(!url.username && !url.password && !url.search && !url.hash, 'No credentials, query or fragment in the verification target');
  return url;
}

function requestProblem(request, base) {
  const url = new URL(request.url());
  const file = url.pathname === base.pathname ? 'index.html' : url.pathname.slice(base.pathname.length);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || !expectedFiles.has(file) || url.search) return 'outside the explicit public paths';
  if (request.method() !== 'GET') return `non-read-only method ${request.method()}`;
  const types = file.endsWith('.html') ? ['document'] : file.endsWith('.js') ? ['script'] : file.endsWith('.css') ? ['stylesheet']
    : file.endsWith('.webmanifest') ? ['manifest', 'other'] : /\.(png|svg)$/.test(file) ? ['image', 'other'] : [];
  if (!types.includes(request.resourceType())) return `unexpected resource type ${request.resourceType()}`;
  if (request.redirectedFrom()) return 'redirected browser request';
  return null;
}

function checkMime(actual, expected, label) {
  const essence = actual?.split(';')[0].trim().toLowerCase();
  assert.ok(essence === expected || (expected === 'text/javascript' && essence === 'application/javascript'), `${label}: MIME ${actual}, expected ${expected}`);
}

export async function watchContext(context, baseValue, { metaOnly = false } = {}) {
  const base = siteUrl(baseValue);
  const audit = { requests: [], responses: [], unexpectedRequests: [], requestFailures: [], consoleFailures: [], pageErrors: [], workers: [] };
  const pending = new Set();
  const track = promise => {
    const handled = promise.catch(error => audit.pageErrors.push(error.message)).finally(() => pending.delete(handled));
    pending.add(handled);
  };
  context.on('request', request => {
    audit.requests.push({ path: new URL(request.url()).pathname, method: request.method(), type: request.resourceType() });
    const problem = requestProblem(request, base);
    if (problem) audit.unexpectedRequests.push(`${request.url()}: ${problem}`);
  });
  context.on('response', response => track((async () => {
    const request = response.request();
    const url = new URL(response.url());
    const headers = await response.allHeaders();
    audit.responses.push({ path: url.pathname, status: response.status(), mime: headers['content-type'] ?? null });
    assert.equal(response.status(), 200, `${response.url()}: resource status`);
    assert.equal(headers['set-cookie'], undefined, `${response.url()}: no Set-Cookie`);
    const file = url.pathname === base.pathname ? 'index.html' : url.pathname.slice(base.pathname.length);
    checkMime(headers['content-type'], expectedFiles.get(file), response.url());
    if (metaOnly && request.resourceType() === 'document') assert.equal(headers['content-security-policy'], undefined, 'Preview must test meta-only CSP, not protection from a header');
  })()));
  context.on('console', message => {
    if (['error', 'warning'].includes(message.type())) audit.consoleFailures.push(`${message.type()}: ${message.text()}`);
  });
  context.on('weberror', error => audit.pageErrors.push(error.error().message));
  context.on('requestfailed', request => audit.requestFailures.push(`${request.url()}: ${request.failure()?.errorText}`));
  context.on('serviceworker', worker => audit.workers.push(`service worker: ${worker.url()}`));
  context.on('page', page => {
    page.on('worker', worker => audit.workers.push(`worker: ${worker.url()}`));
    page.on('websocket', socket => audit.unexpectedRequests.push(`websocket: ${socket.url()}`));
  });
  // Fail closed as well as reporting: a regressed build must not contact an offsite host.
  await context.route('**/*', route => requestProblem(route.request(), base) ? route.abort('blockedbyclient') : route.continue());
  await context.routeWebSocket('**/*', socket => {
    audit.unexpectedRequests.push(`websocket: ${socket.url()}`);
    socket.close();
  });
  return {
    audit,
    async assertClean() {
      await Promise.all([...pending]);
      for (const field of ['unexpectedRequests', 'requestFailures', 'consoleFailures', 'pageErrors', 'workers']) assert.deepEqual(audit[field], [], `${field}: ${JSON.stringify(audit)}`);
    },
  };
}

export async function assertPrivateContext(context, page) {
  assert.deepEqual(await context.cookies(), [], 'No browser cookies');
  const storage = await page.evaluate(async () => ({
    cookies: document.cookie,
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
    controlled: navigator.serviceWorker.controller !== null,
    caches: await caches.keys(),
    localKeys: Object.keys(localStorage).sort(),
    sessionKeys: Object.keys(sessionStorage),
    operationalElements: document.querySelectorAll('form, iframe, frame, object, embed, input, textarea, [contenteditable], [ping]').length,
  }));
  assert.deepEqual(storage, { cookies: '', serviceWorkers: 0, controlled: false, caches: [], localKeys: storage.localKeys, sessionKeys: [], operationalElements: 0 });
  assert.ok(storage.localKeys.length === 0 || JSON.stringify(storage.localKeys) === JSON.stringify([storeKey]), 'Only the bounded viewer-preferences localStorage key');
}

export async function assertDemoPage(page) {
  assert.equal(await page.locator('.demo-label').innerText(), 'DEMO \u2014 invented data');
  assert.equal(await page.locator('#scenario option').count(), 30, 'All thirty built-in scenarios survive publication');
  assert.deepEqual(await page.locator('main > section').evaluateAll(elements => elements.map(el => el.getAttribute('aria-labelledby'))),
    ['needs-heading', 'projects-heading', 'machines-heading', 'usage-heading']);
  assert.equal(await page.locator('footer > p').innerText(), 'Invented data. No real sessions connected.');
  assert.match(await page.locator('#about-demo').textContent(), /All states, assignments, models, accounts, timestamps and usage are invented/);
  assert.match(await page.locator('[data-detail="project-ryomap"]').textContent(), /Release not accepted/);
  assert.equal(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), staticCsp);
  assert.equal(await page.locator('.demo-label').evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), true, 'Permanent demo boundary stays visible and unobscured');
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.content <= size.viewport, `No horizontal overflow: ${JSON.stringify(size)}`);
}

export async function verifySite(value, { directory, screenshotPrefix = 'live', metaOnly = false, onCheck = () => {} } = {}) {
  const base = siteUrl(value);
  assert.match(screenshotPrefix, /^(?:live|pages)(?:-[a-z0-9]+)*$/, 'Screenshot prefix must remain in ignored live-*.png or pages-*.png paths');
  const report = {
    target: base.href, node: process.version, playwright: playwrightVersion, browserChannel: process.env.RYODEV_BROWSER_CHANNEL ?? 'msedge',
    browser: null, referenceDirectory: null, checks: [], assets: [], screenshots: [], contexts: [],
  };
  let browser;
  const check = async (name, run) => { await run(); report.checks.push(name); onCheck(name); };
  try {
    if (!directory) {
      const staged = path.join(root, 'dist');
      try { directory = (await lstat(staged)).isDirectory() ? staged : root; }
      catch (error) { if (error.code !== 'ENOENT') throw error; directory = root; }
    }
    report.referenceDirectory = path.resolve(directory);
    const files = new Map();
    await check('local reference bytes, static references, meta CSP, manifest and PNG integrity', async () => {
      for (const file of expectedFiles.keys()) {
        const source = await readFile(path.join(root, file));
        const reference = await readFile(path.join(directory, file));
        assert.deepEqual(reference, source, `${file}: reference artifact must equal current source`);
        files.set(file, reference);
      }
      const staticReport = validateStaticFiles(files);
      report.icons = staticReport.icons;
      report.referenceCount = staticReport.references.length;
    });
    await check('thirteen read-only HTTP byte comparisons: canonical entry plus twelve known assets', async () => {
      for (const [relative, file] of [['', 'index.html'], ...[...expectedFiles.keys()].map(file => [file, file])]) {
        const url = new URL(relative, base);
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'Cache-Control': 'no-cache' } });
        assert.equal(response.status, 200, `${url}: HTTP ${response.status}; redirect ${response.headers.get('location') ?? 'none'}`);
        assert.equal(response.url, url.href, `${url}: no redirect`);
        assert.equal(response.headers.get('set-cookie'), null, `${url}: no Set-Cookie`);
        if (metaOnly) assert.equal(response.headers.get('content-security-policy'), null, `${url}: meta-only publication preview`);
        checkMime(response.headers.get('content-type'), expectedFiles.get(file), url.href);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(bytes, files.get(file), `${url}: deployed bytes differ from ${path.join(directory, file)}`);
        report.assets.push({ path: url.pathname, status: response.status, bytes: bytes.length, sha256: sha256(bytes) });
      }
    });
    await mkdir(path.join(root, 'screenshots'), { recursive: true });
    browser = await chromium.launch({ channel: report.browserChannel, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
    report.browser = browser.version();
    for (const width of [390, 320, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, deviceScaleFactor: 1,
        isMobile: width < 760, hasTouch: width < 760, locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce' });
      const watcher = await watchContext(context, base.href, { metaOnly });
      report.contexts.push({ width, ...watcher.audit });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        const load = async (target = base.href) => {
          const response = await page.goto(target, { waitUntil: 'networkidle' });
          assert.equal(response.status(), 200, 'Browser entry status');
          await page.locator('#projects .project-card').first().waitFor();
        };
        const capture = async name => {
          const relative = `screenshots/${screenshotPrefix}-${name}.png`;
          await page.screenshot({ path: path.join(root, relative), fullPage: width === 1440 });
          report.screenshots.push(relative);
        };
        await check(`${width}px isolated browser: honest demo, layouts and actual image decoding`, async () => {
          await load();
          assert.equal(await page.evaluate(key => localStorage.getItem(key), storeKey), null, 'Fresh temporary context, not the user profile');
          await capture(String(width));
          await assertDemoPage(page);
          const cdp = await context.newCDPSession(page);
          try {
            const parsed = await cdp.send('Page.getAppManifest');
            assert.deepEqual(parsed.errors, [], 'Browser parses a valid manifest');
            assert.equal(parsed.manifest.id, base.href, 'Browser app identity must not escape to the origin root');
            assert.equal(parsed.manifest.startUrl, base.href, 'Browser launch URL stays beneath the project');
            assert.equal(parsed.manifest.scope, base.href, 'Browser manifest scope stays beneath the project');
            assert.equal((await cdp.send('Page.getAppId')).appId, base.href, 'Effective installed app identity is project-scoped');
          } finally { await cdp.detach(); }
          const images = await page.evaluate(async icons => {
            const decoded = [];
            for (const [file, size] of icons) {
              const image = new Image(); image.src = new URL(file, location.href).href;
              await image.decode();
              decoded.push([file, image.naturalWidth, image.naturalHeight, size]);
            }
            const artwork = document.querySelector('.workstation-art');
            await artwork.decode();
            return { decoded, artwork: [artwork.naturalWidth, artwork.naturalHeight] };
          }, [...pngSizes]);
          assert.deepEqual(images.decoded, [...pngSizes].map(([file, size]) => [file, size, size, size]));
          assert.deepEqual(images.artwork, [620, 300]);
          await page.locator('footer').scrollIntoViewIfNeeded();
          await assertDemoPage(page);
          await assertPrivateContext(context, page);
        });
        if (width === 390) await check('local viewer choices survive reload and direct entry without acceptance', async () => {
          await page.locator('#demo-controls > summary').click();
          await page.locator('#scenario').selectOption('finished');
          await page.locator('#advance-61').click();
          const clock = await page.locator('#demo-clock').getAttribute('datetime');
          assert.equal(clock, '2026-09-06T14:01:01.000Z');
          await page.locator('#demo-controls > summary').press('Escape');
          assert.match(await page.locator('#attention-count').innerText(), /1 new result/);
          await page.locator('#attention summary').click();
          await page.getByRole('button', { name: 'Mark seen here', exact: true }).click();
          const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storeKey);
          assert.deepEqual(Object.keys(saved).sort(), ['now', 'scenario', 'seen']);
          assert.equal(saved.scenario, 'finished');
          assert.equal(saved.now, Date.parse(clock));
          assert.equal(saved.seen.length, 1);
          const persisted = async current => {
            assert.equal(await current.locator('#scenario').inputValue(), 'finished');
            assert.equal(await current.locator('#demo-clock').getAttribute('datetime'), clock);
            assert.match(await current.locator('#attention-count').innerText(), /0 new results/);
            assert.match(await current.locator('#attention').textContent(), /Turn finished.*review pending/s);
            assert.match(await current.locator('#attention').textContent(), /not answered, approved or accepted/);
            assert.equal(await current.getByRole('button', { name: 'Seen here (not approved)', exact: true, includeHidden: true }).getAttribute('aria-pressed'), 'true');
            assert.deepEqual(await current.evaluate(key => JSON.parse(localStorage.getItem(key)), storeKey), saved);
            await assertDemoPage(current);
            await assertPrivateContext(context, current);
          };
          await page.evaluate(() => scrollTo(0, 0));
          await capture('seen-390');
          await persisted(page);
          await page.reload({ waitUntil: 'networkidle' });
          await persisted(page);
          const direct = await context.newPage();
          await direct.goto(new URL('index.html', base).href, { waitUntil: 'networkidle' });
          await persisted(direct);
          await direct.close();
        });
        await check(`${width}px context-wide request, response, console and privacy audit`, async () => {
          const requested = new Set(watcher.audit.requests.map(request => request.path));
          for (const file of ['', 'src/app.js', 'src/styles.css', 'src/model.js', 'src/fixtures.js', 'assets/workstation.svg', ...pngSizes.keys()]) assert.ok(requested.has(new URL(file, base).pathname), `Required browser resource ${file || '/ryodev/'}`);
          await assertPrivateContext(context, page);
          await watcher.assertClean();
        });
      } finally { await context.close(); await watcher.assertClean(); }
    }
    for (const context of report.contexts) for (const field of ['requests', 'responses']) {
      context[field].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
    }
    report.checkCount = report.checks.length;
    report.assetCount = expectedFiles.size;
    report.httpComparisons = report.assets.length;
    report.browserRequestCount = report.contexts.reduce((sum, context) => sum + context.requests.length, 0);
    return report;
  } catch (error) {
    error.verificationReport = report;
    throw error;
  } finally { await browser?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [target, ...args] = process.argv.slice(2);
    assert.ok(target, 'Usage: node scripts/verify-site.mjs https://rdilaz.github.io/ryodev/ [--screenshots=live-release] [--directory=dist]');
    const options = {};
    for (const arg of args) {
      if (arg.startsWith('--screenshots=')) options.screenshotPrefix = arg.slice('--screenshots='.length);
      else if (arg.startsWith('--directory=')) options.directory = path.resolve(arg.slice('--directory='.length));
      else throw new Error(`Unknown option: ${arg}`);
    }
    const report = await verifySite(target, options);
    console.log(JSON.stringify({ result: 'PASS', ...report }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ result: 'FAIL', message: error.message, report: error.verificationReport ?? null }, null, 2));
    process.exitCode = 1;
  }
}
