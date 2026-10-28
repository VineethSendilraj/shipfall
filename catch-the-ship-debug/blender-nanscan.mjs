// Steps the deterministic demo (capture mode) frame by frame and counts pure-black pixels (r+g+b < 3, same
// rule as black.mjs) on every rendered frame. Usage:
//   node blender-nanscan.mjs <base-url> <glb|procedural> [headless|headed] [step=1] [maxFrame=1700]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, which = 'glb', mode = 'headless', step = '1', maxFrame = '1700'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: mode === 'headless', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
if (which === 'procedural') await page.route('**/models/*.glb', (route) => route.abort());
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
const res = await page.evaluate(
  async ({ step, maxFrame }) => {
    const canvas = document.getElementById('gl');
    const tmp = new OffscreenCanvas(128, Math.round((128 * canvas.height) / canvas.width));
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    const hits = [];
    let worst = 0;
    let frame = 0;
    while (frame < maxFrame) {
      const r = window.__advance(step, true);
      frame = r.frame;
      ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
      const d = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
      let black = 0;
      for (let j = 0; j < d.length; j += 4) if (d[j] + d[j + 1] + d[j + 2] < 3) black++;
      const f = black / (d.length / 4);
      if (f > worst) worst = f;
      if (f > 0.005) hits.push([frame, +f.toFixed(3)]);
      if (r.done) break;
    }
    return { frames: frame, worst: +worst.toFixed(3), hits: hits.slice(0, 40), hitCount: hits.length };
  },
  { step: Number(step), maxFrame: Number(maxFrame) },
);
console.log(base, which, mode, JSON.stringify(res));
await browser.close();
