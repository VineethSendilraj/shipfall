// Deterministic crash scan of a real game (not the showcase): seeds Math.random, starts a flight with the
// page's own Play button, then takes over the game loop and steps the sim one 1/60 s frame at a time with no
// input, so the booster falls untouched and crashes. Samples a 16x9 luma grid every frame and reports cells
// that jump and come straight back (one-frame flashes), plus screenshots at chosen frames after impact.
// Usage: node crash-scan.mjs <base-url> <w> <h> <map|-> [shotPrefix] [shotOffsetsCsv] [embed]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w = '1280', h = '720', map = '-', prefix = '', offsetsCsv = '', embed = ''] = process.argv.slice(2);
const offsets = offsetsCsv ? offsetsCsv.split(',').map(Number) : [];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await page.addInitScript(() => {
  try {
    localStorage.setItem('ctb-coached', '1');
  } catch {}
});
const q = map === '-' ? '' : `?map=${map}`;
await page.goto(`${base}${embed ? '/embed/' : '/'}${q}`);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
await page.waitForTimeout(4000);
// TWEAK='js': runs in the page before the flight (A/B of a suspected cause).
if (process.env.TWEAK) await page.evaluate(process.env.TWEAK);
// Seeded right before Play, so the flight's seed doesn't depend on how many objects three.js created
// (every uuid draws from Math.random).
await page.evaluate(() => {
  let a = 1234567;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
await page.click(embed ? '#quick-play' : '#play');
await page.waitForTimeout(300);
// Stop the page's own loop: its next scheduling call is swallowed, so from here on only we step and render.
await page.evaluate(() => {
  window.requestAnimationFrame = () => 0;
});
await page.waitForTimeout(200);
// SHIP=1: fly the ship instead of the booster (its dims drive the sim; the view re-picks a ship slot).
if (process.env.SHIP) {
  const n = await page.evaluate(() => {
    const g = window.__game;
    for (const p of g.params ?? []) p.kind = 'ship';
    for (const b of g.boosters) b.kind = 'ship';
    for (const s of window.__view.pool) s.id = null;
    return { params: g.params?.length ?? 0, boosters: g.boosters.length, states: g.boosters.map((b) => b.state) };
  });
  console.log('ship hack', JSON.stringify(n));
}
await page.addStyleTag({ content: '#hud, #popups, #banner, #touch, #sound, .disclaimer { visibility: hidden !important; }' });

const step = (n, sample) =>
  page.evaluate(
    ({ n, sample }) => {
      const GW = 16, GH = 9;
      const SW = 640, SH = 360, BW = SW / GW, BH = SH / GH;
      if (!window.__small) {
        const c = document.createElement('canvas');
        c.width = SW;
        c.height = SH;
        window.__small = c.getContext('2d', { willReadFrequently: true });
      }
      const g = window.__game, v = window.__view, ctx = window.__small, gl = document.getElementById('gl');
      const res = [];
      for (let i = 0; i < n; i++) {
        g.events.length = 0;
        g.step();
        v.stepCamera(g);
        v.render(g);
        const crashed = g.boosters.some((b) => b.state === 'crashed') || g.stats.misses > 0;
        if (!sample) {
          res.push({ f: g.frame, crashed });
          continue;
        }
        ctx.drawImage(gl, 0, 0, SW, SH);
        const px = ctx.getImageData(0, 0, SW, SH).data, sum = new Float64Array(GW * GH);
        for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
          const o = (y * SW + x) * 4;
          sum[Math.floor(y / BH) * GW + Math.floor(x / BW)] += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
        }
        res.push({ f: g.frame, crashed, lum: Array.from(sum, (s) => +(s / (BW * BH * 255)).toFixed(4)) });
      }
      return res;
    },
    { n, sample },
  );

// Fall untouched until 40 frames before impact, then sample every frame through the explosion.
let crashF = -1;
let guard = 0;
const pre = [];
while (crashF < 0 && guard++ < 4000) {
  const r = await step(1, true);
  pre.push(r[0]);
  if (pre.length > 40) pre.shift();
  if (r[0].crashed) crashF = r[0].f;
}
if (prefix && offsets.includes(0)) await page.screenshot({ path: `${prefix}-c000.jpg`, type: 'jpeg', quality: 88 });
console.log('impact at sim frame', crashF);
const frames = [...pre];
const shots = new Set(offsets.map((o) => crashF + o));
const last = crashF + Math.max(420, ...offsets);
let f = crashF;
while (f < last) {
  const r = await step(1, true);
  frames.push(r[0]);
  f = r[0].f;
  if (prefix && shots.has(f)) await page.screenshot({ path: `${prefix}-c${String(f - crashF).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 88 });
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
  if (cells.length) events.push({ f: frames[k].f - crashF, n: cells.length, amp: Math.max(...cells.map((x) => x.amp)), cells: cells.slice(0, 3) });
}
// Largest frame-to-frame rise of the whole-frame mean, and of any single cell (how abrupt the brightening is).
let maxMeanRise = { d: 0, f: 0 }, maxCellRise = { d: 0, f: 0 };
for (let k = 1; k < frames.length; k++) {
  const a = frames[k - 1].lum, b = frames[k].lum;
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  if (mb - ma > maxMeanRise.d) maxMeanRise = { d: +(mb - ma).toFixed(4), f: frames[k].f - crashF };
  for (let i = 0; i < a.length; i++) if (b[i] - a[i] > maxCellRise.d) maxCellRise = { d: +(b[i] - a[i]).toFixed(3), f: frames[k].f - crashF, cell: i };
}
const trace = (cell) => frames.filter((f) => f.f - crashF >= -2 && f.f - crashF <= 12).map((f) => `${f.f - crashF}:${f.lum[cell].toFixed(3)}`).join(' ');
const meanTrace = frames.filter((f) => f.f - crashF >= -2 && f.f - crashF <= 12).map((f) => `${f.f - crashF}:${(f.lum.reduce((s, x) => s + x, 0) / f.lum.length).toFixed(3)}`).join(' ');
console.log(JSON.stringify({ map, size: `${w}x${h}`, frames: frames.length, oneFrameFlashes: events.length, maxMeanRise, maxCellRise, events: events.slice(0, 12) }));
console.log('mean   ', meanTrace);
console.log(`cell ${maxCellRise.cell}`, trace(maxCellRise.cell ?? 0));
