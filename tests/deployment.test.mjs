import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { build, dist } from '../scripts/build.mjs';
import { startPreview } from '../scripts/preview.mjs';
import { publicFiles } from '../scripts/static-files.mjs';
import { assertDemoPage, assertPrivateContext, expectedFiles, pngSizes, validatePng, validateStaticFiles, verifySite, watchContext } from '../scripts/verify-site.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const planHash = 'ff4a60cf1da8d96c05a37cced964ee88f0a56a36b11623190acfea09e86e66dd';
let server;
let browser;
let base;
let temporary;
const sourceFiles = new Map();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

before(async () => {
  for (const file of expectedFiles.keys()) {
    try { sourceFiles.set(file, await readFile(path.join(root, file))); }
    catch (error) { throw new Error(`Publication input missing or unreadable: ${file}. Parent must finish the reviewed assets before rerunning npm run test:deployment.`, { cause: error }); }
  }
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  temporary = await mkdtemp(path.join(root, 'artifacts', 'publication-'));
  await build();
  server = await startPreview(0, { directory: dist, basePath: '/ryodev/', cspHeader: false });
  base = `http://127.0.0.1:${server.address().port}/ryodev/`;
  browser = await chromium.launch({ channel: process.env.RYODEV_BROWSER_CHANNEL ?? 'msedge', headless: true,
    args: ['--disable-background-networking', '--no-first-run'] });
});

after(async () => {
  try { await browser?.close(); }
  finally {
    server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
});

async function tree(directory, prefix = '') {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const relative = prefix + name;
    const target = path.join(directory, name);
    const info = await lstat(target);
    assert.equal(info.isSymbolicLink(), false, `${relative}: staged links are forbidden`);
    assert.ok(info.isDirectory() || (info.isFile() && info.nlink === 1), `${relative}: regular independent files only`);
    entries.push({ path: relative + (info.isDirectory() ? '/' : ''), mode: info.mode & 0o777, mtime: info.mtimeMs,
      ...(info.isFile() ? { size: info.size, sha256: digest(await readFile(target)) } : {}) });
    if (info.isDirectory()) entries.push(...await tree(target, relative + '/'));
  }
  return entries;
}

async function mirror(name) {
  const directory = path.join(temporary, name);
  for (const file of [...expectedFiles.keys(), 'scripts/build.mjs', 'scripts/static-files.mjs']) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await copyFile(path.join(root, file), path.join(directory, file));
  }
  const builder = await import(pathToFileURL(path.join(directory, 'scripts/build.mjs')).href);
  return { directory, ...builder };
}

async function localPage(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce' });
  const watcher = await watchContext(context, base, { metaOnly: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#projects .project-card').first().waitFor();
  return { context, page, watcher };
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(root, 'screenshots', `pages-${name}.png`) });
}

test('publication 01: independent exact twelve-file contract and original implementation plan', async () => {
  assert.equal(expectedFiles.size, 12);
  assert.deepEqual([...publicFiles].map(([file, mime]) => [file, mime.split(';')[0]]).sort(), [...expectedFiles].sort());
  assert.equal(digest(await readFile(path.join(root, 'RyoDev-V0-Implementation-Plan.md'))), planHash, 'Original plan bytes are immutable');
  const entries = await tree(dist);
  assert.deepEqual(entries.filter(entry => !entry.path.endsWith('/')).map(entry => entry.path).sort(), [...expectedFiles.keys()].sort());
  assert.deepEqual(entries.filter(entry => entry.path.endsWith('/')).map(entry => entry.path), ['assets/', 'src/']);
  for (const file of expectedFiles.keys()) assert.deepEqual(await readFile(path.join(dist, file)), sourceFiles.get(file), `${file}: staged bytes equal source`);
});

test('publication 02: deterministic clean builds remove adversarial private and development artifacts', async t => {
  const isolated = await mirror('determinism');
  await isolated.build();
  const original = await tree(isolated.dist);
  for (const file of ['README.md', '.env', '.git/config', 'tests/private.test.mjs', 'scripts/dev.mjs', 'src/app.js.map', 'assets/secret.txt', 'sessions/state.json', 'nested/.hidden']) {
    await mkdir(path.dirname(path.join(isolated.dist, file)), { recursive: true });
    await writeFile(path.join(isolated.dist, file), 'Private canary: never publish');
    await mkdir(path.dirname(path.join(isolated.directory, file)), { recursive: true });
    await writeFile(path.join(isolated.directory, file), 'Private source canary: never publish');
  }
  await writeFile(path.join(isolated.dist, 'src/app.js'), 'Corrupted previous artifact');
  await isolated.build();
  assert.deepEqual(await tree(isolated.dist), original, 'A dirty output and unrelated source files cannot change the artifact');
  await isolated.build();
  assert.deepEqual(await tree(isolated.dist), original, 'Third build has identical paths, bytes, modes and timestamps');
  const rootInfo = await lstat(isolated.dist);
  for (const entry of [...original, { path: '/', mode: rootInfo.mode & 0o777, mtime: rootInfo.mtimeMs }]) {
    assert.equal(entry.mtime, 0, `${entry.path}: epoch mtime`);
    const isDirectory = entry.path.endsWith('/');
    assert.equal(entry.mode, process.platform === 'win32' ? 0o666 : (isDirectory ? 0o755 : 0o644), `${entry.path}: normalized platform mode`);
  }
  t.diagnostic('Three clean-equivalent builds; POSIX 644/755 requested by builder, Windows lstat exposes both as writable mode 666.');
});

test('publication 03: stale output junctions cannot delete or copy their external targets', async () => {
  const isolated = await mirror('output-links');
  const outside = path.join(temporary, 'output-link-target');
  await mkdir(outside);
  const sentinel = path.join(outside, 'private.txt');
  await writeFile(sentinel, 'Outside target must remain untouched');
  await symlink(outside, isolated.dist, process.platform === 'win32' ? 'junction' : 'dir');
  await isolated.build();
  assert.equal(await readFile(sentinel, 'utf8'), 'Outside target must remain untouched');
  await symlink(outside, path.join(isolated.dist, 'leaked-directory'), process.platform === 'win32' ? 'junction' : 'dir');
  await isolated.build();
  assert.equal(await readFile(sentinel, 'utf8'), 'Outside target must remain untouched');
  assert.deepEqual((await tree(isolated.dist)).filter(entry => !entry.path.endsWith('/')).map(entry => entry.path).sort(), [...expectedFiles.keys()].sort());
});

test('publication 04: hardlinked inputs and linked source directories are rejected before cleaning', async () => {
  const isolated = await mirror('input-links');
  await isolated.build();
  const original = await tree(isolated.dist);
  const source = path.join(isolated.directory, 'src/app.js');
  const copy = path.join(isolated.directory, 'app-original.js');
  await rename(source, copy);
  await link(copy, source);
  assert.equal((await lstat(source)).nlink, 2, 'Unprivileged hardlink adversary really exists');
  await assert.rejects(isolated.build(), /Public files must be regular files, never links: src\/app\.js/);
  assert.deepEqual(await tree(isolated.dist), original, 'Rejected input leaves existing output untouched');
  await rm(source);
  await rename(copy, source);
  const assets = path.join(isolated.directory, 'assets');
  const moved = path.join(isolated.directory, 'assets-original');
  await rename(assets, moved);
  await symlink(moved, assets, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await lstat(assets)).isSymbolicLink(), true, 'Directory junction/symlink adversary really exists');
  await assert.rejects(isolated.build(), /Public files must be regular files, never links: assets\//);
  assert.deepEqual(await tree(isolated.dist), original);
  assert.deepEqual(await readFile(path.join(moved, 'icon.svg')), sourceFiles.get('assets/icon.svg'));
});

test('publication 05: manifest, app identity, static references, privacy surface and full PNG validation', () => {
  const report = validateStaticFiles(sourceFiles);
  assert.ok(report.references.length >= 12, 'HTML, CSS/SVG fragments, JS imports and manifest references were inspected');
  assert.equal(report.icons.length, 3);
  const rootIdentity = new Map(sourceFiles);
  rootIdentity.set('manifest.webmanifest', Buffer.from(JSON.stringify({ ...report.manifest, id: './' })));
  assert.throws(() => validateStaticFiles(rootIdentity), /reviewed standalone demo identity/, 'An explicit origin-root app identity is forbidden');
  for (const [file, mutation, error] of [
    ['index.html', '\n<img src="/assets/icon.svg">', /explicitly relative/],
    ['src/styles.css', '\nbody { background:url(../../private.png); }', /escapes/],
    ['src/app.js', '\nimport "https://offsite.invalid/code.js";', /external URL/],
    ['src/app.js', '\nwindow["fetch"]("./private");', /API surface/],
    ['assets/icon.svg', '\n<script>doSomething()</script>', /external module scripts/],
  ]) {
    const unsafe = new Map(sourceFiles);
    unsafe.set(file, Buffer.concat([sourceFiles.get(file), Buffer.from(mutation)]));
    assert.throws(() => validateStaticFiles(unsafe), error, `${file}: the verifier rejects an adversarial source reference or capability`);
  }
  for (const [file, size] of pngSizes) {
    const png = sourceFiles.get(file);
    const signature = Buffer.from(png); signature[7] ^= 1;
    assert.throws(() => validatePng(signature, size, file), /signature/);
    const crc = Buffer.from(png); crc[29] ^= 1;
    assert.throws(() => validatePng(crc, size, file), /CRC/);
    assert.throws(() => validatePng(png.subarray(0, -1), size, file), /truncated|invalid/);
    assert.throws(() => validatePng(Buffer.concat([png, Buffer.from('hidden payload')]), size, file), /trailing payload/);
    assert.throws(() => validatePng(png, size + 1, file), /dimensions/);
  }
});

test('publication 06: subpath preview serves only GET/HEAD public paths without a CSP header', async () => {
  assert.equal(server.address().address, '127.0.0.1');
  for (const file of ['', ...expectedFiles.keys()]) {
    const response = await fetch(new URL(file, base), { method: 'HEAD', redirect: 'manual' });
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get('content-security-policy'), null, 'GitHub Pages meta-only CSP model');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.arrayBuffer()).byteLength, 0, `${file}: HEAD has no body`);
  }
  for (const target of ['/src/app.js', '/assets/icon.svg', '/ryodev/README.md', '/ryodev/.git/config', '/ryodev/package.json', '/ryodev/tests/browser.test.mjs', '/ryodev/session/status', '/ryodev/src/app.js.map', '/ryodev/assets/%2e%2e%2fREADME.md']) {
    assert.equal((await fetch(new URL(target, base), { redirect: 'manual' })).status, 404, target);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await fetch(base, { method })).status, 405, method);
  const redirect = await fetch(base.slice(0, -1), { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/ryodev/');
  const queryRedirect = await fetch(`${base.slice(0, -1)}?demo=1`, { redirect: 'manual' });
  assert.equal(queryRedirect.status, 301);
  assert.equal(queryRedirect.headers.get('location'), '/ryodev/?demo=1');
  const forbiddenHost = await new Promise((resolve, reject) => {
    const request = httpRequest(base, { headers: { Host: 'offsite.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(forbiddenHost, 403);
});

test('publication 07: reusable verifier against staged meta-only /ryodev/ with actual screenshots', async t => {
  const report = await verifySite(base, { directory: dist, screenshotPrefix: 'pages', metaOnly: true, onCheck: name => t.diagnostic(`PASS ${name}`) });
  assert.equal(report.checkCount, 9);
  assert.equal(report.assetCount, 12);
  assert.equal(report.httpComparisons, 13);
  assert.equal(report.screenshots.length, 4);
  t.diagnostic(JSON.stringify({ node: report.node, playwright: report.playwright, browser: report.browser, checks: report.checkCount,
    publicAssets: report.assetCount, httpComparisons: report.httpComparisons, browserRequests: report.browserRequestCount,
    paths: report.assets.map(asset => asset.path), contexts: report.contexts.map(context => ({ width: context.width,
      requests: context.requests.length, unexpectedRequests: context.unexpectedRequests, requestFailures: context.requestFailures,
      consoleFailures: context.consoleFailures, pageErrors: context.pageErrors, workers: context.workers })), screenshots: report.screenshots }));
});

test('publication 08: official pinned Pages workflow gates main-only dist upload and least-privilege deployment', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  const buildJob = workflow.match(/^  test-and-build:\r?\n([\s\S]*?)(?=^  deploy:)/m)?.[1];
  const deployJob = workflow.match(/^  deploy:\r?\n([\s\S]*)/m)?.[1];
  assert.ok(buildJob && deployJob, 'Separate gated build and deployment jobs');
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.equal([...workflow.matchAll(/^\s*permissions:/gm)].length, 3, 'No additional permission grants');
  assert.match(workflow, /^  group: .*github\.event_name == 'pull_request'.*github\.ref.*'production'/m);
  assert.match(workflow, /^  cancel-in-progress: false$/m, 'Production deployments cannot cancel one another');
  const permissions = job => job.match(/^    permissions:\r?\n((?:      [^\r\n]+\r?\n)+)/m)?.[1].trim().split(/\r?\n/).map(line => line.trim()).sort();
  assert.deepEqual(permissions(buildJob), ['contents: read']);
  assert.deepEqual(permissions(deployJob), ['id-token: write', 'pages: write']);
  assert.match(buildJob, /^    runs-on: windows-2025$/m);
  assert.match(buildJob, /^        shell: cmd$/m);
  assert.match(buildJob, /^      RYODEV_BROWSER_CHANNEL: msedge$/m);
  assert.match(buildJob, /^          node-version: '24'$/m);
  assert.match(buildJob, /^          persist-credentials: false$/m);
  assert.match(buildJob, /^        run: npm ci --ignore-scripts --no-audit --no-fund$/m);
  const gate = buildJob.indexOf('run: npm run check');
  const buildStep = buildJob.indexOf('run: npm run build');
  const uploadStep = buildJob.indexOf('uses: actions/upload-pages-artifact@');
  assert.ok(gate >= 0 && buildStep > gate && uploadStep > buildStep, 'Tests finish before clean build and artifact upload');
  assert.match(buildJob.slice(buildStep), /^        if: github.ref == 'refs\/heads\/main' && github.event_name != 'pull_request'$/m);
  assert.match(buildJob.slice(uploadStep), /^          path: dist$/m);
  assert.match(buildJob.slice(uploadStep), /^          include-hidden-files: true$/m, '.nojekyll survives artifact upload');
  assert.match(deployJob, /^    needs: test-and-build$/m);
  assert.match(deployJob, /^    if: github.ref == 'refs\/heads\/main' && github.event_name != 'pull_request'$/m);
  assert.match(deployJob, /^      name: github-pages$/m);
  assert.deepEqual([...workflow.matchAll(/\buses:\s*([^\s#]+)/g)].map(match => match[1]), [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9',
    'actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d',
    'actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346',
  ], 'Only reviewed official actions at immutable full SHAs');
  const { scripts, devDependencies } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(scripts.check, 'npm test && npm run test:browser && npm run test:deployment');
  assert.equal(scripts['verify:live'], 'node scripts/verify-site.mjs https://rdilaz.github.io/ryodev/');
  assert.equal(devDependencies['playwright-core'], '1.63.0');
});

test('publication 09: reusable verifier fails closed on redirects, HTTP errors, cookies, MIME and changed bytes', async () => {
  let fault;
  const requested = [];
  const badServer = createServer((request, response) => {
    requested.push(request.url);
    response.writeHead(fault.status ?? 200, { 'Content-Type': 'text/html', ...fault.headers });
    response.end(fault.body ?? sourceFiles.get('index.html'));
  });
  await new Promise((resolve, reject) => { badServer.once('error', reject); badServer.listen(0, '127.0.0.1', resolve); });
  try {
    for (fault of [
      { status: 302, headers: { Location: 'https://offsite.invalid/never-follow' }, error: /HTTP 302/ },
      { status: 500, error: /HTTP 500/ },
      { headers: { 'Set-Cookie': 'publication-probe=forbidden' }, error: /no Set-Cookie/ },
      { headers: { 'Content-Type': 'text/plain' }, error: /MIME text\/plain/ },
      { body: 'Changed publication bytes', error: /deployed bytes differ/ },
    ]) {
      await assert.rejects(verifySite(`http://127.0.0.1:${badServer.address().port}/ryodev/`, { directory: dist, screenshotPrefix: 'pages-rejected' }), error => {
        assert.match(error.message, fault.error);
        assert.equal(error.verificationReport.browser, null, 'Do not open a browser on an unverified publication');
        assert.equal(error.verificationReport.assets.length, 0, 'Stop at the failed canonical entry');
        return true;
      });
    }
    assert.deepEqual(requested, Array(5).fill('/ryodev/'), 'Only the known canonical entry is requested in each rejected run');
  } finally {
    badServer.closeAllConnections();
    await new Promise(resolve => badServer.close(resolve));
  }
});

for (const [width, height, insets] of [
  [390, 844, { top: 47, right: 29, bottom: 34, left: 31 }],
  [320, 844, { top: 47, right: 29, bottom: 34, left: 31 }],
  [844, 390, { top: 0, right: 44, bottom: 21, left: 44 }],
  [568, 320, { top: 0, right: 44, bottom: 21, left: 44 }],
]) test(`publication safe-area ${width}x${height}: actual CDP env, sticky label, gutters and utility reachability`, async t => {
  const { context, page, watcher } = await localPage({ width, height });
  const cdp = await context.newCDPSession(page);
  try {
    try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }); }
    catch (error) { throw new Error(`Edge ${browser.version()} must support real safe-area emulation; no skipped or synthetic substitute checks. ${error.message}`); }
    const measured = await page.evaluate(() => {
      const probe = document.createElement('div'); probe.id = 'publication-env-probe';
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('#publication-env-probe { position:fixed; visibility:hidden; padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }');
      document.adoptedStyleSheets = [sheet]; document.body.append(probe);
      const style = getComputedStyle(probe);
      const actual = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, parseFloat(style.getPropertyValue(`padding-${side}`))]));
      probe.remove(); document.adoptedStyleSheets = [];
      const header = getComputedStyle(document.querySelector('.brandbar'));
      const inner = getComputedStyle(document.querySelector('.brand-inner'));
      const page = getComputedStyle(document.querySelector('.page'));
      return { actual, headerTop: parseFloat(header.paddingTop), headerLeft: parseFloat(inner.paddingLeft), headerRight: parseFloat(inner.paddingRight),
        pageLeft: parseFloat(page.paddingLeft), pageRight: parseFloat(page.paddingRight), pageBottom: parseFloat(page.paddingBottom) };
    });
    await capture(page, `safe-${width}x${height}`);
    assert.deepEqual(measured.actual, insets, 'CDP changes actual CSS env() values, not replacement CSS variables');
    assert.equal(measured.headerTop, insets.top);
    assert.equal(measured.pageBottom, 28 + insets.bottom);
    for (const side of ['Left', 'Right']) {
      const expected = Math.max(width < 359 ? 14 : 20, insets[side.toLowerCase()]);
      assert.equal(measured[`page${side}`], expected, `Page ${side} gutter`);
      assert.equal(measured[`header${side}`], expected, `Header ${side} gutter`);
    }
    await assertDemoPage(page);
    await page.locator('footer').scrollIntoViewIfNeeded();
    await assertDemoPage(page);
    assert.ok((await page.locator('footer').boundingBox()).y + (await page.locator('footer').boundingBox()).height <= height - insets.bottom, 'Footer clears the home indicator');
    await page.locator('#demo-controls > summary').click();
    await capture(page, `safe-lab-${width}x${height}`);
    await assertDemoPage(page);
    const panel = await page.locator('.controls-body').boundingBox();
    assert.ok(panel.x >= insets.left && panel.x + panel.width <= width - insets.right, `Utility panel clears side insets: ${JSON.stringify(panel)}`);
    assert.ok(panel.y + panel.height <= height - insets.bottom + 1, `Utility panel clears bottom inset: ${JSON.stringify(panel)}`);
    await page.locator('#reset').scrollIntoViewIfNeeded();
    await page.locator('#reset').click();
    assert.match(await page.locator('#demo-message').textContent(), /Demo reset/);
    await page.locator('#demo-controls > summary').press('Escape');
    await assertPrivateContext(context, page);
    await watcher.assertClean();
    t.diagnostic(`Edge ${browser.version()}; env=${JSON.stringify(measured.actual)}; screenshots/pages-safe[-lab]-${width}x${height}.png`);
  } finally { await cdp.detach(); await context.close(); await watcher.assertClean(); }
});

test('publication accessibility: larger text, reduced motion and forced colors remain intact under /ryodev/', async () => {
  const { context, page, watcher } = await localPage({ width: 320, height: 844 });
  try {
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(':root { font-size:200%; }'); document.adoptedStyleSheets = [sheet];
      document.querySelectorAll('#screen details').forEach(el => { el.open = true; });
    });
    await capture(page, 'large-text-320');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '32px');
    await assertDemoPage(page);
    assert.match(await page.locator('[data-detail="project-ryomap"] .detail-body').innerText(), /Release not accepted/);
    await page.locator('#demo-controls > summary').click();
    await capture(page, 'large-text-lab-320');
    await assertDemoPage(page);
    await page.locator('#reset').scrollIntoViewIfNeeded();
    await page.locator('#reset').click();
    await page.locator('#demo-controls > summary').press('Escape');
    await page.reload({ waitUntil: 'networkidle' });
    const motion = await page.locator('button, summary, .chevron').evaluateAll(elements => elements.map(el => {
      const style = getComputedStyle(el); return [style.animationName, style.transitionDuration];
    }));
    assert.ok(motion.length > 10 && motion.every(([animation, duration]) => animation === 'none' && duration === '0s'), 'Reduced motion removes all tested animations and transitions');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.locator('#attention summary').first().focus();
    await capture(page, 'forced-colors-390');
    await assertDemoPage(page);
    assert.equal(await page.locator('.workstation').isVisible(), false);
    assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    const focus = await page.locator('#attention summary').first().evaluate(el => ({ width: getComputedStyle(el).outlineWidth, style: getComputedStyle(el).outlineStyle }));
    assert.deepEqual(focus, { width: '3px', style: 'solid' });
    await assertPrivateContext(context, page);
    await watcher.assertClean();
  } finally { await context.close(); await watcher.assertClean(); }
});

test('publication CSP: local-only connect/object/frame/worker/form probes are enforced by static meta', async t => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const attempts = [];
  const wireRequests = [];
  const blockedResponses = [];
  const failures = [];
  const consoleMessages = [];
  const errors = [];
  const marker = '__publication_csp_probe__';
  const recordWire = request => { if (request.url?.includes(marker)) wireRequests.push(request.url); };
  server.on('request', recordWire);
  context.on('request', request => { if (request.url().includes(marker)) attempts.push(request.url()); });
  context.on('response', response => { if (response.url().includes(marker)) blockedResponses.push(response.url()); });
  context.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure()?.errorText }));
  context.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.push(message.text()); });
  context.on('weberror', error => errors.push(error.error().message));
  try {
    const response = await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(response.headers()['content-security-policy'], undefined);
    await assertDemoPage(page);
    assert.deepEqual(consoleMessages, []);
    const result = await page.evaluate(async marker => {
      const expected = new Set(['connect-src', 'object-src', 'frame-src', 'worker-src', 'form-action']);
      const violations = [];
      const nodes = [];
      let worker;
      let timer;
      let listener;
      try {
        const observed = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Missing CSP directives: ${[...expected].join(', ')}`)), 5000);
          listener = event => {
            if (!event.blockedURI.includes(marker)) return;
            violations.push({ directive: event.effectiveDirective, disposition: event.disposition, blockedURI: event.blockedURI });
            expected.delete(event.effectiveDirective);
            if (!expected.size) resolve();
          };
          document.addEventListener('securitypolicyviolation', listener);
        });
        const target = kind => new URL(`${marker}/${kind}`, location.href).href;
        const connect = fetch(target('connect')).then(() => 'UNEXPECTED SUCCESS', error => error.name);
        const object = document.createElement('object'); object.type = 'text/html'; object.data = target('object'); document.body.append(object); nodes.push(object);
        const frame = document.createElement('iframe'); frame.name = 'publication-csp-target'; frame.src = target('frame'); document.body.append(frame); nodes.push(frame);
        try { worker = new Worker(target('worker')); worker.onerror = event => event.preventDefault(); } catch (error) { if (error.name !== 'SecurityError') throw error; }
        const form = document.createElement('form'); form.action = target('form'); form.method = 'post'; form.target = frame.name; document.body.append(form); nodes.push(form); form.submit();
        await observed;
        return { violations, connect: await connect, href: location.href };
      } finally {
        clearTimeout(timer); document.removeEventListener('securitypolicyviolation', listener);
        worker?.terminate(); nodes.forEach(node => node.remove());
      }
    }, marker);
    assert.deepEqual([...new Set(result.violations.map(event => event.directive))].sort(), ['connect-src', 'object-src', 'frame-src', 'worker-src', 'form-action'].sort());
    assert.ok(result.violations.every(event => event.disposition === 'enforce' && new URL(event.blockedURI).origin === new URL(base).origin));
    assert.equal(result.connect, 'TypeError');
    assert.equal(result.href, base, 'Blocked form cannot navigate');
    assert.deepEqual(wireRequests, [], 'CSP probes never reach the loopback HTTP server');
    assert.deepEqual(blockedResponses, [], 'No blocked probe gets a response');
    assert.ok(failures.every(failure => failure.url.includes(marker) && /blocked|CSP/i.test(failure.error)), JSON.stringify(failures));
    assert.ok(consoleMessages.length >= 5 && consoleMessages.every(message => /Content Security Policy|content security policy/i.test(message)), JSON.stringify(consoleMessages));
    assert.deepEqual(errors, []);
    await assertDemoPage(page);
    await assertPrivateContext(context, page);
    t.diagnostic(JSON.stringify({ enforced: result.violations, browserAttempts: attempts, requestFailures: failures, wireRequests, expectedConsoleViolations: consoleMessages.length }));
  } finally { server.off('request', recordWire); await context.close(); }
});
