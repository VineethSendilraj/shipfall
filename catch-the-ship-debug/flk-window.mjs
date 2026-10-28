// Flicker scan over chosen showcase frame windows only (fast A/B of a suspected cause). Optionally runs a
// JS tweak in the page first (e.g. "window.__view.world.keyLight.intensity = 0").
// Usage: node flk-window.mjs <base> <w> <h> <extraQuery|-> <ranges "440-520,880-930"> [tweakJs] [shotPrefix]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, extraArg, rangesArg, tweak = '', shot = ''] = process.argv.slice(2);
const extra = extraArg === '-' ? '' : extraArg;
const ranges = rangesArg.split(',').map((r) => r.split('-').map(Number));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1${extra}`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
if (tweak) await page.evaluate(tweak);
const sample = (n) =>
  page.evaluate((n) => {
    const GW = 16, GH = 9, SW = 640, SH = 360, BW = SW / GW, BH = SH / GH;
    if (!window.__small) {
      const c = document.createElement('canvas');
      c.width = SW;
      c.height = SH;
      window.__small = c.getContext('2d', { willReadFrequently: true });
    }
    const ctx = window.__small, gl = document.getElementById('gl'), res = [];
    for (let i = 0; i < n; i++) {
      const r = window.__advance(1, true);
      ctx.drawImage(gl, 0, 0, SW, SH);
      const px = ctx.getImageData(0, 0, SW, SH).data, sum = new Float64Array(GW * GH);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const o = (y * SW + x) * 4;
        sum[Math.floor(y / BH) * GW + Math.floor(x / BW)] += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
      }
      res.push({ f: r.frame, lum: Array.from(sum, (v) => v / (BW * BH * 255)) });
    }
    return res;
  }, n);
const events = [];
for (const [a, b] of ranges) {
  const cur = await page.evaluate(() => window.__demoFrame);
  if (a - cur > 4) await page.evaluate((n) => window.__advance(n, false), a - cur - 4);
  while ((await page.evaluate(() => window.__demoFrame)) < a - 1) await page.evaluate(() => window.__advance(1, true));
  const frames = await sample(b - a + 1);
  if (shot) await page.screenshot({ path: `${shot}-${b}.jpg`, type: 'jpeg', quality: 90 });
  for (let k = 1; k < frames.length - 1; k++) {
    const p = frames[k - 1].lum, q = frames[k].lum, s = frames[k + 1].lum;
    for (let i = 0; i < q.length; i++) {
      const d1 = q[i] - p[i], d2 = s[i] - q[i];
      if (Math.abs(d1) > 0.06 && Math.abs(d2) > 0.06 && Math.sign(d1) !== Math.sign(d2) && Math.abs(s[i] - p[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2)))
        events.push({ f: frames[k].f, x: i % 16, y: Math.floor(i / 16), amp: +Math.min(Math.abs(d1), Math.abs(d2)).toFixed(3) });
    }
  }
}
await browser.close();
const byFrame = new Set(events.map((e) => e.f));
console.log(JSON.stringify({ tweak: tweak || 'none', spikeFrames: byFrame.size, maxAmp: Math.max(0, ...events.map((e) => e.amp)), events: events.slice(0, 12) }));
