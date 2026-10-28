import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://127.0.0.1:41730/');
await page.waitForTimeout(1200);
await page.click('#play');
let last = '';
const t0 = Date.now();
while (Date.now() - t0 < 14000) {
  const v = await page.textContent('#h-engine');
  if (v !== last) { console.log(((Date.now() - t0) / 1000).toFixed(2), v); last = v; }
  await page.waitForTimeout(50);
}
await browser.close();
