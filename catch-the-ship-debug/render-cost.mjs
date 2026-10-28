// Measures the CPU time of View.render per frame (wrapping it) and the frame interval, on the title screen.
// Usage: node render-cost.mjs <url> [seconds]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url, secs = '8'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto(url);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
await page.waitForTimeout(4000);
const r = await page.evaluate(
  (secs) =>
    new Promise((done) => {
      const v = window.__view;
      const orig = v.render.bind(v);
      const cpu = [];
      v.render = (...a) => {
        const t0 = performance.now();
        orig(...a);
        // Force the GPU work to finish so the measured time includes it (readPixels of one pixel stalls).
        const gl = v.renderer.getContext();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        cpu.push(performance.now() - t0);
      };
      setTimeout(() => {
        v.render = orig;
        cpu.sort((a, b) => a - b);
        const p = (q) => +cpu[Math.floor(q * (cpu.length - 1))].toFixed(2);
        done({ frames: cpu.length, p50: p(0.5), p90: p(0.9), min: p(0) });
      }, secs * 1000);
    }),
  Number(secs),
);
console.log(url, 'render+gpu ms', JSON.stringify(r));
await browser.close();
