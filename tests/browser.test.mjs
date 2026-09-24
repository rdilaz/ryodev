import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { get as httpGet } from 'node:http';
import { chromium } from 'playwright-core';
import { startPreview } from '../scripts/preview.mjs';
import { browserOptions } from '../scripts/browser-options.mjs';
import { scenarios } from '../src/fixtures.js';
import { screenshotPixels, contrastRatio } from './png.mjs';

const screenshotDirectory = fileURLToPath(new URL('../screenshots/', import.meta.url));
const screenshotPath = name => fileURLToPath(new URL(`../screenshots/${name}`, import.meta.url));

test('real browser: layout, interactions, demo boundary and static preview lifecycle', async t => {
  await mkdir(screenshotDirectory, { recursive: true });
  let server = await startPreview(0);
  let browser;
  t.after(async () => {
    try { await browser?.close(); }
    finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ ...browserOptions(), headless: true,
    args: ['--disable-background-networking', '--no-first-run'] });
  const errors = [];
  const unexpectedRequests = [];
  // System fonts only: no web font is ever requested.
  const allowedRoutes = new Set(['/', '/src/app.js', '/src/styles.css', '/src/model.js', '/src/fixtures.js', '/assets/icon.svg']);
  const requestedRoutes = new Set();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== origin || !allowedRoutes.has(url.pathname)) unexpectedRequests.push(request.url());
    requestedRoutes.add(url.pathname);
  });
  const load = async (scenario = 'overview') => {
    await page.goto(origin);
    await page.locator('#projects .project-card').first().waitFor();
    await page.locator('#demo-controls').evaluate(el => { el.open = true; });
    await page.locator('#scenario').selectOption(scenario);
    await page.locator('#demo-controls').evaluate(el => { el.open = false; });
    await page.evaluate(() => scrollTo(0, 0));
  };
  const noOverflow = async label => {
    const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(size.content <= size.viewport, `${label}: ${size.content}px exceeds ${size.viewport}px`);
  };
  const modeUnobscured = async () => {
    assert.equal(await page.locator('.demo-label').evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }), true, 'Permanent demo label is in view and not covered by a utility panel');
  };

  await t.test('390x844 shows mode, attention and complete first project without scrolling', async () => {
    await load();
    await page.screenshot({ path: screenshotPath('phone-390.png') });
    assert.equal(await page.locator('.demo-label').innerText(), 'DEMO \u2014 invented data');
    const project = await page.locator('[data-detail="project-ryomap"] > summary').boundingBox();
    assert.ok(project.y + project.height <= 844, `First project ends at ${project.y + project.height}`);
    assert.match(await page.locator('#attention').innerText(), /Riff.*Gigabyte Aero/s);
    assert.match(await page.locator('#attention').innerText(), /Observed 20s ago/);
    assert.match(await page.locator('#attention-count').innerText(), /1 current \u00b7 1 new result/);
    assert.match(await page.locator('#hero-title').innerText(), /1 request needs you/);
    assert.match(await page.locator('#state-legend').innerText(), /1 waiting.*1 running.*1 new result.*3 unknown or stale/s);
    const hero = await page.locator('.hero').boundingBox();
    const header = await page.locator('.brandbar').boundingBox();
    assert.ok(hero.y >= header.y + header.height, 'Summary clears the sticky header');
    assert.ok(hero.height <= 240, `Summary does not consume the phone viewport: ${hero.height}`);
    await noOverflow('390 default');
    await page.screenshot({ path: screenshotPath('phone-390.png') });
  });

  await t.test('320px and desktop actual screenshots, without horizontal scrolling', async () => {
    await page.setViewportSize({ width: 320, height: 844 });
    await load(); await noOverflow('320 default');
    await page.screenshot({ path: screenshotPath('phone-320.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await load(); await noOverflow('1440 default');
    await page.screenshot({ path: screenshotPath('desktop-1440.png'), fullPage: true });
    assert.ok((await page.locator('.projects-section').boundingBox()).x < (await page.locator('.machines-section').boundingBox()).x);
    assert.ok((await page.locator('.hero').boundingBox()).y >= (await page.locator('.brandbar').boundingBox()).height, 'Desktop summary is not cropped by the header');
  });

  await t.test('every scenario remains demo-labelled at 320px, including expanded details', async () => {
    await page.setViewportSize({ width: 320, height: 844 });
    for (const scenario of scenarios) {
      await load(scenario.id);
      await noOverflow(scenario.id);
      assert.equal(await page.locator('.demo-label').isVisible(), true, scenario.id);
      assert.match(await page.locator('footer > p').innerText(), /Invented data. No real sessions connected/);
      assert.match(await page.locator('#about-demo').textContent(), /All states, assignments, models, accounts, timestamps and usage are invented/);
      await page.locator('#screen details').evaluateAll(elements => elements.forEach(el => { el.open = true; }));
      await noOverflow(`${scenario.id} expanded`);
      await page.locator('footer').scrollIntoViewIfNeeded();
      const label = await page.locator('.demo-label').boundingBox();
      assert.ok(label.y >= 0 && label.y + label.height < 844, `${scenario.id}: sticky mode visible after scroll`);
      await modeUnobscured();
      await page.locator('#screen details').evaluateAll(elements => elements.forEach(el => { el.open = false; }));
    }
  });

  await t.test('clock advance, reload and duplicate import retain old times and stale state', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load('user-wait');
    await page.locator('#demo-controls').evaluate(el => { el.open = true; });
    await page.locator('#advance-61').click();
    assert.match(await page.locator('#attention-count').innerText(), /0 current.*1 last seen/);
    assert.match(await page.locator('#attention').innerText(), /Earlier request.*current status unknown/s);
    assert.match(await page.locator('#attention').innerText(), /Stale/);
    assert.match(await page.locator('[data-detail="project-riff"]').innerText(), /Status unknown/);
    const time = await page.locator('#demo-clock').getAttribute('datetime');
    await page.reload();
    await page.locator('#projects .project-card').first().waitFor();
    assert.equal(await page.locator('#demo-clock').getAttribute('datetime'), time);
    await page.locator('#demo-controls').evaluate(el => { el.open = true; });
    await page.locator('#reimport').click();
    assert.match(await page.locator('#attention').innerText(), /Observed 81s ago/);
    assert.equal(await page.locator('#attention .attention-card').count(), 1);
    await page.locator('#demo-controls').evaluate(el => { el.open = false; });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: screenshotPath('stale-request-390.png') });
  });

  await t.test('seen only marks the viewer and survives reload without approval or resolution', async () => {
    await load('user-wait');
    await page.locator('#attention summary').click();
    await page.getByRole('button', { name: 'Mark seen here', exact: true }).click();
    assert.match(await page.locator('#attention-count').innerText(), /1 current/);
    assert.equal(await page.getByRole('button', { name: 'Seen here (not approved)', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#attention details').getAttribute('open'), '');
    await page.reload();
    await page.locator('#attention summary').click();
    assert.equal(await page.getByRole('button', { name: 'Seen here (not approved)', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#attention-count').innerText(), /1 current/);
  });

  await t.test('seen completion changes new-result count without implying review or acceptance', async () => {
    await load('finished');
    assert.match(await page.locator('#attention-count').innerText(), /1 new result/);
    await page.locator('#attention summary').click();
    await page.getByRole('button', { name: 'Mark seen here', exact: true }).click();
    assert.match(await page.locator('#attention-count').innerText(), /0 new results/);
    assert.match(await page.locator('#attention').innerText(), /Turn finished.*review pending/s);
    assert.match(await page.locator('#attention').innerText(), /not answered, approved or accepted/);
    await page.reload();
    assert.match(await page.locator('#attention-count').innerText(), /0 new results/);
    assert.match(await page.locator('#attention').innerText(), /review pending/);
  });

  await t.test('unavailable storage stays visible after actions and cannot falsely persist seen', async () => {
    const temporary = await browser.newContext({ viewport: { width: 320, height: 844 } });
    try {
      await temporary.addInitScript(() => {
        Storage.prototype.setItem = function () { throw new DOMException('Storage disabled', 'QuotaExceededError'); };
      });
      const p = await temporary.newPage();
      await p.goto(origin);
      await p.locator('#projects .project-card').first().waitFor();
      await p.locator('#demo-controls > summary').click();
      await p.locator('#scenario').selectOption('finished');
      assert.equal(await p.locator('#storage-warning').isVisible(), true);
      await p.locator('#advance-61').click();
      assert.match(await p.locator('#demo-message').innerText(), /advanced 61 seconds/);
      assert.equal(await p.locator('#storage-warning').isVisible(), true);
      await p.locator('#demo-controls > summary').press('Escape');
      await p.locator('#attention summary').click();
      await p.getByRole('button', { name: 'Mark seen here', exact: true }).click();
      assert.match(await p.locator('#storage-warning').innerText(), /Reload may lose changes/);
      assert.equal(await p.evaluate(() => localStorage.getItem('ryodev-invented-demo-v1')), null);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } finally { await temporary.close(); }
  });

  await t.test('demo clock renders the actual UTC date across midnight', async () => {
    await load();
    await page.evaluate(() => {
      const key = 'ryodev-invented-demo-v1';
      const value = JSON.parse(localStorage.getItem(key));
      value.now = Date.parse('2026-09-06T23:59:30.000Z');
      localStorage.setItem(key, JSON.stringify(value));
    });
    await page.reload();
    await page.locator('#demo-controls > summary').click();
    await page.locator('#advance-61').click();
    assert.equal(await page.locator('#demo-clock').getAttribute('datetime'), '2026-09-07T00:00:31.000Z');
    assert.equal(await page.locator('#demo-clock').innerText(), '00:00:31 UTC, 7 Sept 2026');
  });

  await t.test('shared allowance, separate windows, conflicts, nulls and passed resets render honestly', async () => {
    await load('shared-account');
    assert.equal(await page.locator('.usage-card').count(), 1);
    assert.match(await page.locator('#usage').innerText(), /38% remaining/);
    assert.match(await page.locator('#usage').innerText(), /4 machines sharing/);
    await load('usage-windows');
    assert.equal(await page.locator('.usage-card').count(), 4);
    assert.match(await page.locator('#usage').innerText(), /72.50%/);
    assert.match(await page.locator('#usage').innerText(), /12450 tokens used/);
    await load('usage-conflict');
    assert.match(await page.locator('#usage').innerText(), /Allowance unavailable/);
    assert.match(await page.locator('#usage').innerText(), /Conflicting reports/);
    assert.doesNotMatch(await page.locator('#usage summary').innerText(), /EXACT/);
    await page.locator('#usage-heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath('usage-conflict-390.png') });
    await page.locator('#usage summary').click();
    assert.match(await page.locator('#usage .detail-body').innerText(), /38% remaining \/ EXACT.*41% remaining \/ EXACT/s);
    await load('passed-reset');
    assert.match(await page.locator('#usage').innerText(), /Allowance unavailable/);
    assert.match(await page.locator('#usage').innerText(), /Last known: 38% remaining/);
    assert.match(await page.locator('#usage').innerText(), /Reset passed.*refresh needed/s);
    assert.doesNotMatch(await page.locator('#usage').innerText(), /100%/);
    await load('usage-unavailable');
    await page.locator('#usage summary').click();
    assert.match(await page.locator('#usage').innerText(), /UNAVAILABLE/);
    assert.match(await page.locator('#usage').innerText(), /38% remaining.*EXACT/s);
    await load('missing-attribution');
    assert.match(await page.locator('#projects').innerText(), /Unknown model \u00b7 Unknown account/);
    assert.match(await page.locator('#usage').innerText(), /null, not zero/);
    await load('ambiguous-account');
    assert.equal(await page.locator('.usage-card').count(), 2, 'Unverified account observations stay separate');
    assert.match(await page.locator('#usage').innerText(), /Account identity unverified/);
    assert.ok((await page.locator('.usage-provider').allTextContents()).every(text => /4 machines referenced/.test(text) && !/sharing/.test(text)), 'Unverified identity cannot imply a shared allowance');
  });

  await t.test('keyboard, focus, touch targets, landmark order and reduced motion', async () => {
    await load();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.wordmark').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#demo-controls > summary').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#demo-controls').getAttribute('open'), '');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#scenario').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#demo-controls').getAttribute('open'), null);
    assert.equal(await page.locator('#demo-controls > summary').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    for (const id of ['scenario', 'advance-61', 'advance-300', 'reimport', 'reset']) {
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(`#${id}`).evaluate(el => el === document.activeElement), true, `Keyboard order: ${id}`);
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#demo-controls').getAttribute('open'), null, 'Tab beyond the last utility control dismisses the panel');
    assert.equal(await page.locator('#attention summary').first().evaluate(el => {
      const r = el.getBoundingClientRect();
      return el === document.activeElement && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), true, 'Next focused attention row is not obscured');
    const summary = page.locator('[data-detail="project-ryomap"] > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-detail="project-ryomap"]').getAttribute('open'), '');
    const style = await summary.evaluate(el => ({ outline: getComputedStyle(el).outlineWidth, animation: getComputedStyle(el).animationName, transition: getComputedStyle(el).transitionDuration }));
    assert.equal(style.outline, '3px');
    assert.equal(style.animation, 'none');
    assert.equal(style.transition, '0s');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-detail="project-ryomap"]').getAttribute('open'), null);
    await page.locator('#demo-controls').evaluate(el => { el.open = true; });
    const smallTargets = await page.locator('summary, button, select, .wordmark').evaluateAll(elements => elements.filter(el => {
      const r = el.getBoundingClientRect(); return r.height > 0 && (r.height < 44 || r.width < 44);
    }).map(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
    assert.deepEqual(smallTargets, []);
    assert.equal(await page.getByLabel('Built-in scenario', { exact: true }).count(), 1);
    assert.deepEqual(await page.locator('main > section').evaluateAll(el => el.map(e => e.getAttribute('aria-labelledby'))),
      ['needs-heading', 'projects-heading', 'machines-heading', 'usage-heading']);
    await page.locator('#demo-controls').evaluate(el => { el.open = false; });
    await load('user-wait');
    const notice = page.locator('#attention > details');
    await notice.locator('summary').focus(); await page.keyboard.press('Enter');
    // Edge exposes native summary as DisclosureTriangle; Playwright's synthetic
    // ARIA snapshot flattens it. Verify the browser's actual accessibility tree.
    const accessibility = await context.newCDPSession(page);
    try {
      const tree = await accessibility.send('Accessibility.getFullAXTree');
      const disclosure = tree.nodes.find(node => ['DisclosureTriangle', 'button'].includes(node.role?.value) && /Riff Answer needed Gigabyte Aero.*Observed 20s ago/.test(node.name?.value));
      assert.ok(disclosure, 'Native disclosure has the project, reason, machine and age in its accessible name');
      assert.equal(disclosure.properties.find(property => property.name === 'expanded')?.value.value, true);
    } finally { await accessibility.detach(); }
    await page.getByRole('button', { name: 'Mark seen here', exact: true }).focus();
    await page.keyboard.press('Space');
    assert.equal(await page.getByRole('button', { name: 'Seen here (not approved)', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.match(await page.locator('#attention-count').innerText(), /1 current/);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: screenshotPath('expanded-evidence-390.png') });
  });

  await t.test('rendered-composite text contrast at light, dark and utility surfaces', async () => {
    let checks = 0; let minimum = Infinity;
    const sample = async label => {
      const pairs = await page.evaluate(() => {
        const elements = [...document.querySelectorAll('.eyebrow, .legend li, .golive-lead, .steps strong, .connect label, .all-set, .text-link, .demo-label, .coverage-label, .wordmark-name, .project-tally, h1, h2, h3, .muted, .row-meta, .identity, .attention-reason, .attribution-preview, .acceptance-note, .badge, .section-count, .usage-value, .usage-reason, .historical-value, .usage-provider, .machine-state, .project-title > strong, .machine-card summary strong, .status-check strong, .facts dt, .facts dd, .controls-body label, .clock-readout, button, select, #demo-controls > summary > span:first-child, footer > p, #about-demo > summary > span:first-child')];
        const pairs = elements.flatMap(el => {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return [];
          const color = getComputedStyle(el).color.match(/[\d.]+/g).map(Number);
          let opacity = color[3] ?? 1;
          for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
          color[3] = opacity;
          const points = [.15, .5, .85].map(fraction => [Math.floor(r.x + r.width * fraction), Math.floor(r.y + r.height / 2)])
            .filter(([x, y]) => x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && el.contains(document.elementFromPoint(x, y)));
          if (!points.length) return [];
          el.setAttribute('data-contrast-probe', '');
          return [{ text: el.textContent.slice(0, 70), color, points }];
        });
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('[data-contrast-probe], [data-contrast-probe] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }');
        document.adoptedStyleSheets = [sheet];
        return pairs;
      });
      let pixels;
      try { pixels = screenshotPixels(await page.screenshot()); }
      finally { await page.evaluate(() => { document.adoptedStyleSheets = []; document.querySelectorAll('[data-contrast-probe]').forEach(el => el.removeAttribute('data-contrast-probe')); }); }
      assert.ok(pixels.at(0, 0).every(channel => channel < 40), `PNG decoder sees the dark page corner: ${pixels.at(0, 0)}`);
      for (const pair of pairs) for (const [x, y] of pair.points) {
        const ratio = contrastRatio(pair.color, pixels.at(x, y));
        checks++; minimum = Math.min(minimum, ratio);
        assert.ok(ratio >= 4.5, `${label}: ${pair.text}, composite contrast ${ratio.toFixed(2)} at ${x},${y}`);
      }
    };
    for (const scenario of ['overview', 'usage-conflict', 'usage-estimated', 'passed-reset']) {
      await load(scenario); await sample(`${scenario} top`);
      await page.locator('#usage-heading').scrollIntoViewIfNeeded(); await sample(`${scenario} usage`);
    }
    await load('user-wait');
    await page.locator('#attention summary').click();
    await page.getByRole('button', { name: 'Mark seen here', exact: true }).scrollIntoViewIfNeeded();
    await sample('expanded evidence and seen control');
    await load();
    await page.locator('#demo-controls > summary').click(); await sample('open demo lab');
    await page.keyboard.press('Escape');
    assert.ok(checks >= 150, `${checks} rendered points sampled`);
    t.diagnostic(`${checks} rendered-background samples; minimum normal-text contrast ${minimum.toFixed(2)}:1`);
  });

  await t.test('UI indicators and focus retain at least 3:1 contrast', async () => {
    await load();
    const colors = await page.locator('#attention .chevron, .project-card .chevron, .machine-card .chevron, .usage-card .chevron').evaluateAll(elements => elements.map(el => getComputedStyle(el).color.match(/[\d.]+/g).map(Number)));
    // [14, 14, 15] is --panel (white at .035) over the #050506 page; [5, 5, 6] is the page itself.
    for (const color of colors) assert.ok(contrastRatio(color, [14, 14, 15]) >= 3);
    const control = await page.locator('#demo-controls').evaluate(el => getComputedStyle(el).borderTopColor.match(/[\d.]+/g).map(Number));
    assert.ok(contrastRatio(control, [5, 5, 6]) >= 3, 'Demo lab boundary is visible against the page');
    for (const selector of ['#needs-heading', '#status-check summary', '#attention summary', '[data-detail="project-ryomap"] > summary', '#usage summary', '#demo-controls > summary']) {
      const target = page.locator(selector).first();
      await target.focus();
      const outline = await target.evaluate(el => {
        const style = getComputedStyle(el); const r = el.getBoundingClientRect();
        const outline = { color: style.outlineColor.match(/[\d.]+/g).map(Number), width: parseFloat(style.outlineWidth),
          x: Math.floor(r.x + r.width / 2), y: Math.floor(r.y - parseFloat(style.outlineOffset) - parseFloat(style.outlineWidth) / 2) };
        el.setAttribute('data-focus-probe', '');
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('[data-focus-probe], [data-focus-probe] * { outline-color: transparent !important; color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }');
        document.adoptedStyleSheets = [sheet];
        return outline;
      });
      let pixels;
      try { pixels = screenshotPixels(await page.screenshot()); }
      finally { await page.evaluate(() => { document.adoptedStyleSheets = []; document.querySelectorAll('[data-focus-probe]').forEach(el => el.removeAttribute('data-focus-probe')); }); }
      assert.equal(outline.width, 3, selector);
      const ratio = contrastRatio(outline.color, pixels.at(outline.x, outline.y));
      assert.ok(ratio >= 3, `${selector}: computed outline / actual adjacent surface contrast ${ratio.toFixed(2)}`);
    }
  });

  await t.test('200% text enlargement reflows without hiding data or horizontal overflow', async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await load();
      await page.evaluate(() => {
        const sheet = new CSSStyleSheet(); sheet.replaceSync(':root { font-size: 200%; }'); document.adoptedStyleSheets = [sheet];
      });
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '32px');
      await noOverflow(`${width}px at 200% text`);
      assert.equal(await page.locator('.demo-label').isVisible(), true);
      await page.locator('#screen details').evaluateAll(elements => elements.forEach(el => { el.open = true; }));
      await noOverflow(`${width}px enlarged expanded evidence`);
      assert.match(await page.locator('[data-detail="project-ryomap"] .detail-body').innerText(), /Release not accepted/);
      await page.locator('#screen details').evaluateAll(elements => elements.forEach(el => { el.open = false; }));
      await page.locator('#demo-controls > summary').click();
      await noOverflow(`${width}px enlarged demo lab`);
      await modeUnobscured();
      await page.locator('#reimport').scrollIntoViewIfNeeded();
      assert.ok((await page.locator('#reimport').boundingBox()).height >= 44);
      await page.locator('#demo-controls > summary').focus(); await page.keyboard.press('Escape');
      await page.evaluate(() => scrollTo(0, 0));
      if (width === 320) await page.screenshot({ path: screenshotPath('enlarged-text-320.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 }); await load();
  });

  await t.test('forced colors and no-blur fallbacks retain readable data and controls', async () => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await load('user-wait');
    assert.equal(await page.locator('.brandbar').evaluate(el => getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number)[3] ?? 1), 1, 'Header is an opaque Canvas bar in forced colors');
    await noOverflow('forced colors');
    await page.locator('#attention summary').focus();
    assert.notEqual(await page.locator('#attention summary').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    assert.match(await page.locator('#attention').innerText(), /Answer needed/);
    await page.screenshot({ path: screenshotPath('forced-colors-390.png') });
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
    await load();
    await page.evaluate(() => { const sheet = new CSSStyleSheet(); sheet.replaceSync('*, *::before, *::after { backdrop-filter: none !important; }'); document.adoptedStyleSheets = [sheet]; });
    for (const selector of ['.brand-pill', '#demo-controls > summary', '.controls-body']) assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).backdropFilter), 'none', selector);
    await page.locator('#demo-controls > summary').click();
    await noOverflow('no blur');
    await modeUnobscured();
    assert.equal(await page.getByLabel('Built-in scenario', { exact: true }).isVisible(), true);
    await page.screenshot({ path: screenshotPath('no-blur-390.png'), animations: 'disabled' });
    await page.waitForTimeout(1000);
    const idleMotion = await page.evaluate(() => document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity || a.playState === 'running').map(a => a.animationName ?? String(a)));
    assert.deepEqual(idleMotion, [], 'Nothing keeps moving once the entrance has played');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await load();
  });

  await t.test('system font stack only: no web font is declared, requested or allowed by CSP', async () => {
    await load();
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return { declared: [...document.fonts].map(f => f.family), body: getComputedStyle(document.body).fontFamily, title: getComputedStyle(document.querySelector('#hero-title')).fontFamily };
    });
    assert.deepEqual(fonts.declared, [], 'No @font-face rules');
    assert.equal(fonts.body, 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    assert.equal(fonts.title, fonts.body, 'Display type uses the same system stack; no serif accent face');
    assert.equal(await page.locator('.hero-title em').evaluate(el => getComputedStyle(el).fontStyle), 'normal', 'Accent phrase is not an italic serif');
    for (const route of ['/assets/fonts/geist-latin-wght-normal.woff2', '/assets/fonts/missing.woff2', '/assets/fonts/LICENSE-Geist.txt', '/assets/../README.md', '/assets/%2e%2e%2fREADME.md']) assert.equal((await fetch(origin + route)).status, 404, route);
    const probePage = await context.newPage();
    const wire = [];
    const recordWire = request => { if (request.url.includes('__font_probe__')) wire.push(request.url); };
    try {
      const scriptErrors = [];
      server.on('request', recordWire);
      probePage.on('pageerror', error => scriptErrors.push(error.message));
      await probePage.goto(origin);
      await probePage.locator('#projects .project-card').first().waitFor();
      const blocked = probePage.waitForEvent('requestfailed', { predicate: request => request.url().includes('__font_probe__'), timeout: 5000 });
      // CSP has no font-src, so default-src 'none' blocks even a same-origin font.
      assert.equal(await probePage.evaluate(async () => {
        try { await new FontFace('Probe', 'url(./__font_probe__.woff2)').load(); return 'loaded'; } catch (error) { return error.name; }
      }), 'NetworkError');
      assert.match((await blocked).failure()?.errorText ?? '', /blocked|CSP/i, 'CSP blocks the font request');
      assert.deepEqual(wire, [], 'The blocked font never reaches the server');
      assert.equal(await probePage.locator('.demo-label').isVisible(), true);
      assert.match(await probePage.locator('#attention').innerText(), /Answer needed/);
      await probePage.locator('#attention summary').first().click();
      assert.equal(await probePage.getByRole('button', { name: 'Mark seen here', exact: true }).isVisible(), true);
      await probePage.locator('#attention summary').first().click();
      assert.equal(await probePage.locator('#attention summary').first().evaluate(el => getComputedStyle(el).borderRadius), '20px', 'Collapsed native disclosure keeps its rounded corners');
      assert.deepEqual(scriptErrors, []);
      assert.equal(await probePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await probePage.evaluate(() => scrollTo(0, 0));
      await probePage.screenshot({ path: screenshotPath('system-font-390.png') });
    } finally { server.off('request', recordWire); await probePage.close(); }
  });

  await t.test('live mode: explicit connect, honest sync labels, local review and server-side clear', async () => {
    const live = await context.newPage();
    const liveErrors = [];
    live.on('pageerror', error => liveErrors.push(error.message));
    const calls = [];
    const ago = seconds => new Date(Date.now() - seconds * 1000).toISOString();
    const session = (machine, tool, id, project, state, age, detail = null) => ({ key: `${machine}/${tool}/${id}`, machine, tool, session: id, project, state, detail,
      since: ago(age), updated: ago(age), received: ago(age - 1), clock_skew: false });
    let stateStatus = 200;
    let body = { v: 1, server_time: ago(0), events: [],
      sessions: [session('dell', 'claude-code', 'aaa111', 'ryodev', 'needs_input', 90, 'Needs permission: Bash'), session('mac', 'codex', 'bbb222', 'riff', 'finished', 300),
        session('aero', 'claude-code', 'ccc333', 'visualizer', 'running', 3600), session('hp', 'claude-code', 'ddd444', 'ryomap', 'running', 30)],
      machines: [['dell', 90], ['mac', 300], ['aero', 3600], ['hp', 30]].map(([machine, age]) => ({ machine, last_seen: ago(age) })) };
    await live.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      calls.push(`${request.method()} ${url.pathname} ${request.headers().authorization ?? '-'}`);
      if (url.pathname === '/api/health') return route.fulfill({ json: { ok: true, v: 1, service: 'ryodev' } });
      if (request.headers().authorization !== 'Bearer view-key-123') return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      if (url.pathname === '/api/state') return route.fulfill({ status: stateStatus, json: stateStatus === 200 ? body : { error: 'boom' } });
      if (url.pathname === '/api/forget' && request.method() === 'POST') {
        const { key } = request.postDataJSON();
        body = { ...body, sessions: body.sessions.filter(s => s.key !== key) };
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ status: 404, json: { error: 'not found' } });
    });
    try {
      await live.goto(origin);
      await live.locator('#projects .project-card').first().waitFor();
      assert.deepEqual(calls, [], 'The demo makes no API request before an explicit connect');
      await live.locator('#view-key').fill('wrong-key');
      await live.locator('#connect').click();
      await live.locator('#connect-message').filter({ hasText: /rejected/ }).waitFor();
      assert.equal(await live.locator('.demo-label').isVisible(), true, 'A rejected key never leaves demo mode');
      await live.locator('#view-key').fill('view-key-123');
      await live.locator('#connect').click();
      await live.locator('#live-label').filter({ hasText: /Synced \d+s ago/ }).waitFor();
      assert.equal(await live.locator('.demo-label').isVisible(), false);
      assert.equal(await live.locator('#demo-controls').isVisible(), false, 'Demo controls disappear in live mode');
      assert.match(await live.locator('#hero-title').innerText(), /1 session needs you/);
      assert.match(await live.locator('#attention-count').innerText(), /1 waiting \u00b7 1 to review/);
      const attention = await live.locator('#attention').innerText();
      assert.match(attention, /ryodev.*Needs permission: Bash.*Dell.*Claude Code/s);
      assert.match(attention, /riff.*Turn finished.*review.*Mac.*Codex/s);
      assert.ok(attention.indexOf('ryodev') < attention.indexOf('riff'), 'Waiting sorts before finished');
      assert.match(await live.locator('#status-check').innerText(), /1 quiet session/);
      assert.doesNotMatch(await live.locator('#screen').innerText(), /offline/i, 'Quiet is never shown as offline');
      assert.match(await live.locator('#machines').innerText(), /HP.*Reporting/s);
      assert.match(await live.locator('#usage').innerText(), /Usage not collected yet/);
      assert.equal(await live.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await live.evaluate(() => scrollTo(0, 0));
      await live.screenshot({ path: screenshotPath('connected-390.png') });
      await live.locator('#attention details', { hasText: 'riff' }).locator('summary').click();
      await live.getByRole('button', { name: 'Mark reviewed' }).click();
      assert.match(await live.locator('#attention-count').innerText(), /0 to review/);
      assert.ok(calls.every(call => !call.startsWith('POST /api/seen')), 'Reviewed is local only');
      await live.locator('#attention details', { hasText: 'ryodev' }).locator('summary').click();
      await live.getByRole('button', { name: 'Clear this row' }).click();
      await live.locator('#hero-title').filter({ hasText: /Nothing waiting on you/ }).waitFor();
      assert.ok(calls.includes('POST /api/forget Bearer view-key-123'));
      await live.reload();
      await live.locator('#live-label').filter({ hasText: /Synced/ }).waitFor();
      assert.match(await live.locator('#attention').innerText(), /Nothing is waiting on you/);
      stateStatus = 500;
      await live.locator('#refresh').click();
      await live.locator('#sync-warning').filter({ hasText: /Worker answered 500/ }).waitFor();
      assert.match(await live.locator('#live-label').innerText(), /Sync failed/);
      assert.match(await live.locator('#projects').innerText(), /visualizer/, 'The last good sync stays visible, never blanked or refreshed');
      await live.locator('#disconnect').click();
      assert.equal(await live.locator('.demo-label').isVisible(), true);
      assert.equal(await live.evaluate(() => JSON.parse(localStorage.getItem('ryodev-live-v1')).key), null, 'Disconnect forgets the key');
      assert.deepEqual(liveErrors, []);
    } finally { await live.close(); }
  });

  await t.test('no operational input, service worker, unexpected requests or browser errors', async () => {
    assert.equal(await page.locator('input[type="file"], input[type="url"], iframe').count(), 0);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
    assert.deepEqual(unexpectedRequests, []);
    assert.deepEqual([...requestedRoutes].sort(), [...allowedRoutes].sort());
    assert.deepEqual(errors, []);
    const response = await fetch(origin);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.doesNotMatch(response.headers.get('content-security-policy'), /font-src/, 'No web-font source: default-src none blocks fonts');
    assert.match(response.headers.get('content-security-policy'), /worker-src 'none'/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    for (const route of ['/.git/config', '/package.json', '/docs/history/RyoDev-V0-Implementation-Plan.md', '/session/status', '/api/state', '/worker/index.mjs', '/unknown']) {
      assert.equal((await fetch(origin + route)).status, 404, route);
    }
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
    const untrustedHostStatus = await new Promise((resolve, reject) => {
      httpGet(origin, { headers: { Host: 'untrusted.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(untrustedHostStatus, 403);
    assert.equal(server.address().address, '127.0.0.1');
  });

  await t.test('preview stops, releases its port and reopens at the same address', async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await assert.rejects(fetch(origin));
    server = await startPreview(port);
    assert.equal((await fetch(origin)).status, 200);
    await page.goto(origin);
    await page.locator('#projects .project-card').first().waitFor();
  });
});
