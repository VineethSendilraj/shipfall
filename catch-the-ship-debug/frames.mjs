import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url = 'http://127.0.0.1:41730/?demo=1', prefix = 'base', w = '1280', h = '720'] = process.argv.slice(2);
const times = [1.5, 4, 7, 10, 13, 17, 22];
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await page.goto(url);
await page.waitForTimeout(800);
await page.mouse.click(Number(w) / 2, Number(h) / 2);
const t0 = Date.now();
for (const t of times) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  const p = `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/${prefix}-${String(t).replace('.', '_')}.jpg`;
  await page.screenshot({ path: p, type: 'jpeg', quality: 80 });
}
console.log('fps/quality', JSON.stringify(await page.evaluate(() => window.__quality ?? null)));
await browser.close();
