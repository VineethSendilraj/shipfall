// Real-time showcase (?demo=1): every frame gap over 20 ms, with the demo frame, the main-thread JS of that
// callback and the shader programs it added.
// Usage: node texas-livehitch.mjs <base> [w] [h] [dpr] [secs] [extraQuery]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w = '1280', h = '720', dpr = '2', secs = '28', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const P = (window.__p = { long: [], n: 0, on: false, last: 0, prevJs: 0, prevAdded: 0, prevFrame: 0 });
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const before = window.__view?.renderer.info.programs.length ?? window.__progs?.() ?? 0;
      const s = performance.now();
      cb(t);
      const js = performance.now() - s;
      const after = window.__progs?.() ?? 0;
      if (P.on) {
        P.n++;
        const gap = P.last ? t - P.last : 0;
        // A long gap follows the slow callback, so report the previous callback's cost with it.
        if (gap > 20) P.long.push({ gap: +gap.toFixed(1), frame: window.__demoFrame, prevFrame: P.prevFrame, prevJs: +P.prevJs.toFixed(1), prevAdded: P.prevAdded });
      }
      P.prevJs = js;
      P.prevAdded = after - before;
      P.prevFrame = window.__demoFrame;
      P.last = t;
    });
});
await page.goto(`${base}/?demo=1${extra}`);
// The real-time showcase does not expose the view; find the renderer through the canvas' WebGL context.
await page.waitForFunction(() => (window.__demoFrame ?? 0) > 30, null, { timeout: 90000 });
await page.evaluate(() => {
  window.__p.on = true;
});
await page.waitForTimeout(+secs * 1000);
const r = await page.evaluate(() => ({ frames: window.__p.n, lastFrame: window.__demoFrame, long: window.__p.long }));
console.log(JSON.stringify({ base, ...r }));
await browser.close();
