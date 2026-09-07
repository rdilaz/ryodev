import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Maintainer-only rasterization. Deployment copies the reviewed PNG bytes as-is.
const artwork = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.RYODEV_BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route('**/*', route => route.abort());
  for (const [name, size] of [['apple-touch-icon', 180], ['icon-192', 192], ['icon-512', 512]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body { margin:0; } svg { display:block; width:100vw; height:100vh; }</style>${artwork}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../assets/${name}.png`, import.meta.url)) });
  }
} finally { await browser.close(); }
