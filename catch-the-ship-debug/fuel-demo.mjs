// Plays the showcase in frame-stepped capture mode (as scripts/record.mjs does) and prints its final stats.
// Usage: node fuel-demo.mjs <base url> [end screenshot path]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, shot] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
const catches = [];
let last = 0;
for (;;) {
  const r = await page.evaluate(() => window.__advance(30, false));
  if (r.score !== last) {
    catches.push({ frame: r.frame, score: r.score });
    last = r.score;
  }
  if (r.done) break;
}
await page.evaluate(() => window.__advance(0, true));
const info = await page.evaluate(() => ({ ...window.__demoInfo, done: window.__demoDone === true }));
console.log(JSON.stringify({ info, scoreSteps: catches }));
if (shot) await page.screenshot({ path: shot, type: 'jpeg', quality: 85, timeout: 120000 });
await browser.close();
