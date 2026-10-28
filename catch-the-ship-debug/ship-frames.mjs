// Steps the deterministic ?demo=1&capture=1 showcase to the given frames and screenshots each (headless, real GPU).
// Usage: node ship-frames.mjs <base-url> <prefix> <w> <h> f1,f2,... [--log]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, w = '1280', h = '720', list = '', flag = ''] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console:', m.text()));
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 60000 });
const targets = list ? list.split(',').map(Number).sort((a, b) => a - b) : [];
if (flag === '--log') {
  const log = await page.evaluate(() => {
    const out = [];
    for (;;) {
      const r = window.__advance(1, false);
      const g = window.__view && window.__game;
      if (r.frame % 10 === 0 || r.done) out.push(r.frame);
      if (r.done) break;
    }
    return out.length;
  });
  console.log('frames', log);
}
let frame = await page.evaluate(() => window.__demoFrame);
for (const f of targets) {
  if (f > frame) frame = (await page.evaluate((n) => window.__advance(n, true), f - frame)).frame;
  const path = `${D}/${prefix}-f${f}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 88 });
  console.log(path);
}
await browser.close();
