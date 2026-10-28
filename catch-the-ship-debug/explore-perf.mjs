// Explore mode frame times (headless, real GPU, vsync-capped): rAF gaps and main-thread cost per frame while orbiting
// close around the engines and the ship's tiles, and while the turntable turns the whole site from max distance.
// Usage: node explore-perf.mjs <base-url> [w] [h] [dpr] [quality: '' = auto] [seconds per case] [map]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41830', w = '1280', h = '720', dpr = '1', quality = '', secs = '12', map = 'starbase'] = process.argv.slice(2);
const W = Number(w);
const H = Number(h);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(dpr) });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const P = (window.__p = { frames: [], on: false, last: 0 });
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = performance.now();
    cb(t);
    if (P.on) P.frames.push({ gap: P.last ? t - P.last : 0, js: performance.now() - s });
    P.last = t;
  });
});
await page.goto(`${base}/?explore=1&map=${map}${quality ? `&quality=${quality}` : ''}`, { timeout: 240000 });
const landed = () => page.waitForFunction(() => window.__explore?.stack && window.__explore.shapes.length && !window.__explore.flight, null, { timeout: 240000, polling: 100 });
await landed();
// Shader compiles and AutoQuality's first windows.
await page.waitForTimeout(4000);

const measure = async (label, act) => {
  await page.evaluate(() => Object.assign(window.__p, { frames: [], on: true, last: 0 }));
  const t0 = Date.now();
  await act();
  const ms = Date.now() - t0;
  const r = await page.evaluate(() => {
    const P = window.__p;
    P.on = false;
    const f = P.frames.slice(1);
    const q = (k, p) => {
      const s = f.map((x) => x[k]).sort((a, b) => a - b);
      return +s[Math.floor(p * (s.length - 1))].toFixed(1);
    };
    return { frames: f.length, gap: { p50: q('gap', 0.5), p95: q('gap', 0.95), p99: q('gap', 0.99), max: q('gap', 1) }, js: { p50: q('js', 0.5), p95: q('js', 0.95) }, missed: f.filter((x) => x.gap > 25).length, quality: window.__quality, cam: window.__explore.view.camera.position.distanceTo(window.__explore.controls.target).toFixed(1) };
  });
  console.log(label, JSON.stringify({ fps: +((r.frames * 1000) / ms).toFixed(1), ...r }));
};

const zoom = async (x, y, steps, dir) => {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dir * 100);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(600);
};
const orbit = async (seconds) => {
  await page.mouse.move(W * 0.3, H * 0.5);
  await page.mouse.down();
  const end = Date.now() + seconds * 1000;
  for (let i = 0; Date.now() < end; i++) {
    // Back and forth across the middle of the view.
    const s = Math.sin(i / 40);
    await page.mouse.move(W * (0.5 + 0.25 * s), H * (0.5 + 0.08 * Math.cos(i / 55)));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};

await page.keyboard.press('2');
await landed();
await zoom(W / 2, H * 0.42, 10, -1);
await measure('close orbit, engines', () => orbit(Number(secs)));

await page.keyboard.press('5');
await landed();
await zoom(W * 0.45, H * 0.55, 14, -1);
await measure('close orbit, tiles', () => orbit(Number(secs)));

await page.keyboard.press('1');
await landed();
await zoom(W / 2, H / 2, 30, 1);
await page.evaluate(() => (window.__explore.idle = 9));
await page.waitForTimeout(500);
await measure('whole site, turntable', () => page.waitForTimeout(Number(secs) * 1000));
await browser.close();
