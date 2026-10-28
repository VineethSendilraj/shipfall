import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url, w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2 });
await page.goto(url);
await page.waitForTimeout(1500);
await page.mouse.click(Number(w) / 2, Number(h) / 2);
const r = await page.evaluate(
  () =>
    new Promise((done) => {
      const times = [];
      let last = performance.now();
      const end = last + 15000;
      const tick = (t) => {
        times.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(tick);
        else {
          times.sort((a, b) => a - b);
          const p = (q) => times[Math.floor(q * (times.length - 1))];
          done({ frames: times.length, fps: (times.length / 15).toFixed(1), p50: p(0.5).toFixed(1), p95: p(0.95).toFixed(1), p99: p(0.99).toFixed(1) });
        }
      };
      requestAnimationFrame(tick);
    }),
);
console.log(url, JSON.stringify(r));
await browser.close();
