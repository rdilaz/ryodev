import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

// Fallback for this workspace's unavailable embedded Browser panel. Uses a new,
// temporary browser context, never an existing profile, account or cookie store.
const browser = await chromium.launch({
  ...browserOptions(), headless: false,
  args: ['--disable-background-networking', '--no-first-run', '--window-size=450,980'],
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await browser.close(); process.exit(0); });
browser.on('disconnected', () => process.exit(process.exitCode ?? 0));
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#projects .project-card').first().waitFor();
  console.log('RyoDev isolated browser preview open at http://127.0.0.1:4173 (390x844). Close this window or Ctrl+C to stop this browser only.');
} catch (error) {
  process.exitCode = 1;
  console.error('RyoDev preview could not open:', error.message);
  await browser.close();
}
