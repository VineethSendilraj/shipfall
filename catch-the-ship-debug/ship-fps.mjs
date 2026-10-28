// Uncapped headless frame rate over the real-time ?demo=1 showcase (both single rounds and the double round with
// the ship). Prints fps and frame-time percentiles overall and for the double round (demo seconds 18-27).
// Usage: node ship-fps.mjs <url> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url, w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(url, { timeout: 600000 });
await page.waitForFunction(() => (window.__demoFrame ?? 0) > 1, null, { timeout: 600000 });
const r = await page.evaluate(
  () =>
    new Promise((done) => {
      const samples = [];
      let last = performance.now();
      const tick = (t) => {
        samples.push([window.__demoFrame, t - last]);
        last = t;
        if (!window.__demoDone) requestAnimationFrame(tick);
        else done(samples);
      };
      requestAnimationFrame(tick);
    }),
);
const stats = (xs) => {
  const d = xs.map((s) => s[1]).sort((a, b) => a - b);
  const p = (q) => d[Math.floor(q * (d.length - 1))].toFixed(2);
  const total = d.reduce((a, b) => a + b, 0) / 1000;
  return { frames: d.length, fps: (d.length / total).toFixed(1), p50: p(0.5), p95: p(0.95), p99: p(0.99) };
};
const dbl = r.filter(([f]) => f >= 1080 && f < 1620);
console.log(url, w + 'x' + h, JSON.stringify({ all: stats(r.slice(5)), double: stats(dbl) }));
await browser.close();
