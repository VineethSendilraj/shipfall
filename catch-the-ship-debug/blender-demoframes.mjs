// Frame-exact demo shots with the game's own director camera (capture mode, fixed 1/60 s steps), so two
// builds can be compared at identical simulation frames. Usage:
//   node blender-demoframes.mjs <base-url> <out-prefix> <frame,frame,...> [w=1280] [h=720] [path=/]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, list, w = '1280', h = '720', path = '/'] = process.argv.slice(2);
const frames = list.split(',').map(Number).sort((a, b) => a - b);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}${path}?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
let at = 0;
for (const f of frames) {
  await page.evaluate((n) => window.__advance(n, true), f - at);
  at = f;
  const out = `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/${prefix}-f${f}.jpg`;
  await page.screenshot({ path: out, type: 'jpeg', quality: 85 });
  console.log(out);
}
await browser.close();
