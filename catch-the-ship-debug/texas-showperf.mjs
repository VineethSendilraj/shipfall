// Showcase cost, two phases.
//  1. Real time (?demo=1, vsync capped): frame gaps and main-thread JS per frame, like perf2.mjs.
//  2. Capture (?demo=1&capture=1): steps the whole showcase, rendering every frame and draining the GPU every
//     20 frames (readPixels), so ms/frame ~ max(CPU, GPU) per frame. Reports percentiles and the worst windows.
// Usage: node texas-showperf.mjs <base> [w] [h] [dpr] [secs] [extraQuery]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w = '1280', h = '720', dpr = '2', secs = '20', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.floor(p * (s.length - 1))].toFixed(2);
};

const live = await (async () => {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const P = (window.__p = { frames: [], on: false, last: 0 });
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        const s = performance.now();
        cb(t);
        if (P.on) P.frames.push({ gap: P.last ? t - P.last : 0, js: performance.now() - s });
        P.last = t;
      });
  });
  await page.goto(`${base}/?demo=1${extra}`);
  await page.waitForFunction(() => (window.__demoFrame ?? 0) > 30, null, { timeout: 90000 });
  await page.evaluate(() => (window.__p.on = true));
  await page.waitForTimeout(+secs * 1000);
  const f = await page.evaluate(() => window.__p.frames.slice(1));
  await page.close();
  const gaps = f.map((x) => x.gap);
  const js = f.map((x) => x.js);
  return { frames: f.length, gap: { p50: q(gaps, 0.5), p95: q(gaps, 0.95), p99: q(gaps, 0.99), max: q(gaps, 1) }, js: { p50: q(js, 0.5), p95: q(js, 0.95) }, missed: gaps.filter((g) => g > 25).length };
})();

const steps = await (async () => {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/?demo=1&capture=1${extra}`);
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 90000 });
  const r = await page.evaluate(() => {
    const v = window.__view;
    const gl = v.renderer.getContext();
    const px = new Uint8Array(4);
    const N = 20;
    const windows = [];
    for (let k = 0; k < 2000; k++) {
      const t0 = performance.now();
      let res;
      for (let i = 0; i < N; i++) res = window.__advance(1, true);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      windows.push({ frame: res.frame, ms: (performance.now() - t0) / N, calls: v.renderer.info.render.calls, tris: v.renderer.info.render.triangles });
      if (res.done) break;
    }
    return { canvas: [v.renderer.domElement.width, v.renderer.domElement.height], windows };
  });
  await page.close();
  const ms = r.windows.slice(1).map((x) => x.ms);
  const worst = [...r.windows.slice(1)].sort((a, b) => b.ms - a.ms).slice(0, 5).map((x) => ({ frame: x.frame, ms: +x.ms.toFixed(2), calls: x.calls }));
  const at = (f) => r.windows.find((x) => x.frame >= f);
  const pick = Object.fromEntries([130, 366, 700, 1466].map((f) => [f, { ms: +at(f).ms.toFixed(2), calls: at(f).calls, tris: at(f).tris }]));
  return { canvas: r.canvas, frames: r.windows.at(-1).frame, msPerFrame: { p50: q(ms, 0.5), p95: q(ms, 0.95), max: q(ms, 1) }, worst, at: pick };
})();

console.log(JSON.stringify({ base, size: `${w}x${h}@${dpr}`, live, steps }));
await browser.close();
