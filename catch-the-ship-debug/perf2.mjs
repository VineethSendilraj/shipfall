// Main-thread cost per frame in the real game (vsync-capped headless), split into sim step / render, with the longest frames.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url, w = '1512', h = '982', dpr = '2', secs = '25'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const P = (window.__p = { frames: [], cur: null, on: false, last: 0 });
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = performance.now();
    P.cur = { step: 0, render: 0 };
    cb(t);
    if (P.on) P.frames.push({ t: Math.round(t), gap: P.last ? t - P.last : 0, total: performance.now() - s, ...P.cur });
    P.last = t;
  });
});
await page.goto(url);
await page.waitForTimeout(2500);
await page.click('#play');
await page.evaluate(() => {
  const P = window.__p, v = window.__view, G = Object.getPrototypeOf(window.__game);
  const r0 = v.render.bind(v);
  v.render = (g) => { const s = performance.now(); r0(g); P.cur.render += performance.now() - s; };
  const s0 = G.step;
  G.step = function (...a) { const s = performance.now(); const out = s0.apply(this, a); P.cur.step += performance.now() - s; return out; };
  P.on = true;
});
await page.waitForTimeout(+secs * 1000);
const r = await page.evaluate(() => {
  const f = window.__p.frames.slice(1);
  const q = (k, p) => { const s = f.map((x) => x[k]).sort((a, b) => a - b); return +s[Math.floor(p * (s.length - 1))].toFixed(2); };
  const long = [...f].sort((a, b) => b.gap - a.gap).slice(0, 8).map((x) => ({ t: x.t, gap: +x.gap.toFixed(1), js: +x.total.toFixed(1), render: +x.render.toFixed(1), step: +x.step.toFixed(1) }));
  return { frames: f.length, gap: { p50: q('gap', 0.5), p95: q('gap', 0.95), p99: q('gap', 0.99) }, js: { p50: q('total', 0.5), p95: q('total', 0.95), p99: q('total', 0.99) }, render: { p50: q('render', 0.5), p95: q('render', 0.95) }, step: { p50: q('step', 0.5), p95: q('step', 0.95) }, missed: f.filter((x) => x.gap > 25).length, long };
});
console.log(JSON.stringify(r));
await browser.close();
