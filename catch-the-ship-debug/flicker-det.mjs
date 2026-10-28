// Deterministic flicker scan over the whole ?demo=1&capture=1 showcase: steps one sim frame at a time,
// samples a 16x9 luma grid of the canvas, and reports cells that jump and come straight back.
// Usage: node flicker-det.mjs <base-url> [w] [h] [outJson] [extraQuery, e.g. &map=mars]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';

const [base, w = '1280', h = '720', out = '', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1${extra}`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
const frames = [];
for (;;) {
  const chunk = await page.evaluate(() => {
    const GW = 16, GH = 9;
    const SW = 640, SH = 360, BW = SW / GW, BH = SH / GH;
    if (!window.__small) {
      const c = document.createElement('canvas');
      c.width = SW; c.height = SH;
      window.__small = c.getContext('2d', { willReadFrequently: true });
    }
    const ctx = window.__small, gl = document.getElementById('gl'), res = [];
    for (let i = 0; i < 120; i++) {
      const r = window.__advance(1, true);
      // 2x downscale (exact 2x2 average), then true block means: a bare 16x9 drawImage point-samples.
      ctx.drawImage(gl, 0, 0, SW, SH);
      const px = ctx.getImageData(0, 0, SW, SH).data, sum = new Float64Array(GW * GH);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const o = (y * SW + x) * 4;
        sum[Math.floor(y / BH) * GW + Math.floor(x / BW)] += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
      }
      const lum = Array.from(sum, (v) => +(v / (BW * BH * 255)).toFixed(4));
      res.push({ f: r.frame, lum });
      if (r.done) return { res, done: true };
    }
    return { res, done: false };
  });
  frames.push(...chunk.res);
  if (chunk.done) break;
}
await browser.close();

const T = 0.06, events = [];
for (let k = 1; k < frames.length - 1; k++) {
  const a = frames[k - 1].lum, b = frames[k].lum, c = frames[k + 1].lum;
  const cells = [];
  for (let i = 0; i < b.length; i++) {
    const d1 = b[i] - a[i], d2 = c[i] - b[i];
    if (Math.abs(d1) > T && Math.abs(d2) > T && Math.sign(d1) !== Math.sign(d2) && Math.abs(c[i] - a[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2)))
      cells.push({ x: i % 16, y: Math.floor(i / 16), amp: +Math.min(Math.abs(d1), Math.abs(d2)).toFixed(3), abc: [a[i], b[i], c[i]] });
  }
  if (cells.length) events.push({ f: frames[k].f, n: cells.length, amp: Math.max(...cells.map((x) => x.amp)), cells });
}
const perSec = {};
for (const e of events) {
  const s = Math.floor(e.f / 60);
  perSec[s] ??= { frames: 0, maxAmp: 0 };
  perSec[s].frames++;
  perSec[s].maxAmp = Math.max(perSec[s].maxAmp, e.amp);
}
const top = [...events].sort((p, q) => q.amp - p.amp).slice(0, 25).map((e) => ({ f: e.f, n: e.n, amp: e.amp, cell: e.cells.sort((p, q) => q.amp - p.amp)[0] }));
console.log(JSON.stringify({ frames: frames.length, spikeFrames: events.length, perSec, top }, null, 0));
if (out) writeFileSync(out, JSON.stringify({ frames, events }));
