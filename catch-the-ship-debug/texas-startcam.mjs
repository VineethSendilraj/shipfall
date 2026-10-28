// Play mode: title, then Enter, then screenshots as the establishing shot gives way to the play camera.
// Usage: node texas-startcam.mjs <base> <w> <h> <prefix> [timesCsv] [query]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, prefix, timesCsv = '0.1,0.4,0.7,1.0,1.4', q = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/${q ? `?${q}` : ''}`);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-title.jpg`, type: 'jpeg', quality: 85 });
await page.keyboard.press('Enter');
for (const t of timesCsv.split(',').map(Number)) {
  await page.waitForFunction((t) => window.__game.phase !== 'ready' && window.__game.t >= t, t, { timeout: 30000 });
  const real = await page.evaluate(() => window.__game.t.toFixed(2));
  await page.screenshot({ path: `${prefix}-t${t}.jpg`, type: 'jpeg', quality: 85 });
  console.log('shot t', t, 'game.t', real);
}
await browser.close();
