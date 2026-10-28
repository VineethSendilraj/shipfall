// Frame pacing of the real-time free flight flown by the scripted pilot (vsync-capped headless), per mission phase.
// Usage: node flight-orbit-perf.mjs <base-url> [w] [h] [dpr] [secs]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w = '1280', h = '720', dpr = '1', secs = '262'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const P = (window.__p = { frames: [], cur: null, on: false, last: 0 });
  const bucket = (f) => {
    if (f.phase === 'pad') return 'pad';
    if (f.phase === 'over') return 'over';
    if (f.cut) return 'catch-cut';
    const m = f.ship.mode;
    if (m === 'stacked') return 'ascent';
    if (m === 'free') return f.marks.orbit == null ? 'stage-climb' : f.warp > 1.01 ? 'orbit-warp' : 'orbit';
    return m === 'aero' ? 'reentry' : 'landing';
  };
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = performance.now();
    P.cur = { step: 0, render: 0 };
    cb(t);
    if (P.on && window.__flight) {
      P.frames.push({ t: Math.round(t), gap: P.last ? t - P.last : 0, total: performance.now() - s, ...P.cur, b: bucket(window.__flight), q: window.__quality?.level, real: +window.__flight.real.toFixed(1) });
    }
    P.last = t;
  });
});
await page.goto(`${base}/?flight=1&pilot=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flight && window.__flightView, null, { timeout: 120000 });
await page.evaluate(() => {
  const P = window.__p, v = window.__flightView, F = Object.getPrototypeOf(window.__flight);
  const r0 = v.render.bind(v);
  v.render = (...a) => { const s = performance.now(); r0(...a); P.cur.render += performance.now() - s; };
  const s0 = F.step;
  F.step = function (...a) { const s = performance.now(); const out = s0.apply(this, a); P.cur.step += performance.now() - s; return out; };
  P.on = true;
});
await page.waitForTimeout(+secs * 1000);
const r = await page.evaluate(() => {
  const all = window.__p.frames.slice(1);
  const q = (f, k, p) => { const s = f.map((x) => x[k]).sort((a, b) => a - b); return +s[Math.floor(p * (s.length - 1))].toFixed(1); };
  const stats = (f) => ({ n: f.length, gap50: q(f, 'gap', 0.5), gap95: q(f, 'gap', 0.95), gap99: q(f, 'gap', 0.99), js95: q(f, 'total', 0.95), render95: q(f, 'render', 0.95), missed: f.filter((x) => x.gap > 25).length });
  const buckets = {};
  for (const name of [...new Set(all.map((x) => x.b))]) buckets[name] = stats(all.filter((x) => x.b === name));
  const levels = {};
  for (const x of all) levels[x.q] = (levels[x.q] || 0) + 1;
  const long = [...all].sort((a, b) => b.gap - a.gap).slice(0, 10).map((x) => ({ real: x.real, b: x.b, gap: +x.gap.toFixed(1), js: +x.total.toFixed(1), render: +x.render.toFixed(1), step: +x.step.toFixed(1) }));
  return { all: stats(all), buckets, levels, long, end: { real: window.__flight.real, phase: window.__flight.phase } };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
