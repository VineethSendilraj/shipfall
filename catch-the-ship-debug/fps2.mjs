// Uncapped headless frame-rate probe, like fps.mjs, but it doesn't click the page and can measure a flight:
// mode "title" measures the title screen; mode "flight" presses Play and measures 15 s of a flight flown with
// no input (the booster falls, crashes and explodes, then the next round starts).
// Usage: node fps2.mjs <url> [title|flight] [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url, mode = 'title', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  try {
    localStorage.setItem('ctb-coached', '1');
  } catch {}
});
await page.goto(url);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
await page.waitForTimeout(4000);
if (mode === 'flight') {
  await page.evaluate(() => (document.querySelector('#play:not(.hidden)') && getComputedStyle(document.getElementById('title-screen')).display !== 'none' ? document.getElementById('play') : document.getElementById('quick-play')).click());
}
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
          const crashed = !!window.__game?.stats?.misses;
          times.sort((a, b) => a - b);
          const p = (q) => times[Math.floor(q * (times.length - 1))];
          done({ frames: times.length, fps: +(times.length / 15).toFixed(1), p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), p99: +p(0.99).toFixed(1), crashed, quality: window.__quality });
        }
      };
      requestAnimationFrame(tick);
    }),
);
console.log(url, mode, JSON.stringify(r));
await browser.close();
