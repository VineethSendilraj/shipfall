// Steps the capture showcase rendering every frame (as flicker-det.mjs does, so the random state matches) and
// saves a crop round one 16x9 grid cell (the cell plus one cell each side) at the listed frames.
// Usage: node texas-cell.mjs <base> <w> <h> <framesCsv> <cellX> <cellY> <outPrefix> [extraQuery]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, framesCsv, cx, cy, prefix, extra = ''] = process.argv.slice(2);
const frames = framesCsv.split(',').map(Number).sort((a, b) => a - b);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1${extra}`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 90000 });
const cw = +w / 16;
const ch = +h / 9;
const clip = { x: Math.max(0, (+cx - 1) * cw), y: Math.max(0, (+cy - 1) * ch), width: 0, height: 0 };
clip.width = Math.min(+w, (+cx + 2) * cw) - clip.x;
clip.height = Math.min(+h, (+cy + 2) * ch) - clip.y;
for (const f of frames) {
  await page.evaluate((f) => {
    while (window.__demoFrame < f) window.__advance(1, true);
  }, f);
  await page.screenshot({ path: `${prefix}-f${f}.png`, clip });
}
console.log('clip', JSON.stringify(clip));
await browser.close();
