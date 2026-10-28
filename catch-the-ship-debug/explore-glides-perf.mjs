// Explore glide frame times (headless, real GPU, vsync-capped): every preset-to-preset glide by its 1-9 key, with the
// rAF gaps during the glides and the main-thread time of each focus() call, where route() runs.
// Usage: node explore-glides-perf.mjs <base-url> [w] [h] [dpr] [quality: '' = auto]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41830', w = '1280', h = '720', dpr = '1', quality = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(dpr) });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const P = (window.__p = { frames: [], focus: [], on: false, last: 0 });
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = performance.now();
    cb(t);
    if (P.on) P.frames.push({ t, gap: P.last ? t - P.last : 0, js: performance.now() - s });
    P.last = t;
  });
});
await page.goto(`${base}/?explore=1${quality ? `&quality=${quality}` : ''}`, { timeout: 120000 });
const landed = () => page.waitForFunction(() => window.__explore?.stack && window.__explore.shapes.length && !window.__explore.flight, null, { timeout: 120000, polling: 100 });
await landed();
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const ex = window.__explore;
  const focus = ex.focus.bind(ex);
  ex.focus = (p, instant) => {
    const s = performance.now();
    focus(p, instant);
    window.__p.focus.push({ at: s, ms: performance.now() - s, id: p.id });
  };
});
const glides = [];
for (let i = 1; i <= 9; i++)
  for (let j = 1; j <= 9; j++) {
    if (i === j) continue;
    await page.keyboard.press(String(i));
    await landed();
    await page.waitForTimeout(150);
    await page.evaluate(() => Object.assign(window.__p, { frames: [], focus: [], on: true, last: 0 }));
    await page.keyboard.press(String(j));
    await landed();
    glides.push(
      await page.evaluate(([i, j]) => {
        const P = window.__p;
        P.on = false;
        const f = P.frames.slice(1);
        const at = P.focus[0]?.at ?? 0;
        // A frame is missed when its gap spans two vsyncs; "start" ones land within 50 ms of the key press.
        const missed = f.filter((x) => x.gap > 25);
        return { from: i, to: j, frames: f.length, maxGap: Math.max(...f.map((x) => x.gap)), maxJs: Math.max(...f.map((x) => x.js)), missed: missed.length, atStart: missed.filter((x) => x.t - at < 50).length, focusMs: P.focus[0]?.ms ?? 0 };
      }, [i, j]),
    );
  }
const q = (a, p) => +[...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))].toFixed(1);
const fm = glides.map((g) => g.focusMs);
const gaps = glides.map((g) => g.maxGap);
console.log(
  JSON.stringify({
    glides: glides.length,
    frames: glides.reduce((s, g) => s + g.frames, 0),
    missed: glides.reduce((s, g) => s + g.missed, 0),
    missedAtStart: glides.reduce((s, g) => s + g.atStart, 0),
    glidesWithMiss: glides.filter((g) => g.missed).length,
    maxGap: { p50: q(gaps, 0.5), p95: q(gaps, 0.95), max: q(gaps, 1) },
    focusMs: { p50: q(fm, 0.5), p95: q(fm, 0.95), max: q(fm, 1) },
    maxJs: q(glides.map((g) => g.maxJs), 1),
    quality: await page.evaluate(() => window.__quality),
  }),
);
for (const g of glides.filter((g) => g.missed)) console.log('miss', JSON.stringify(g));
await browser.close();
