// Explore mode screenshots (headless, real GPU): the entry view, then each focus preset by its 1-9 key.
// Usage: node explore-shots.mjs <base-url> <prefix> [w] [h] [path] [preset,preset,...]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, w = '1280', h = '720', path = '/', only = ''] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const IDS = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(m.type(), m.text()));
await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}explore=1&quality=high`, { timeout: 240000 });
const settled = () => page.waitForFunction(() => window.__explore?.stack && !window.__explore.flight, null, { timeout: 240000, polling: 100 });
const shot = async (name) => {
  const file = `${D}/${prefix}-${name}.jpg`;
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  const q = await page.evaluate(() => window.__quality);
  console.log(name, JSON.stringify(q), file);
};
await settled();
await page.waitForTimeout(600);
await shot('entry');
for (let i = 0; i < IDS.length; i++) {
  if (only && !only.split(',').includes(IDS[i])) continue;
  await page.keyboard.press(String(i + 1));
  await settled();
  await page.waitForTimeout(400);
  await shot(IDS[i]);
}
await browser.close();
