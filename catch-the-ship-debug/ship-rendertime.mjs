// GPU-synced render time of fixed demo frames: steps the capture-mode showcase to each frame and times repeated
// renders of it, each followed by a 1-pixel readPixels so the GPU work is included. Optional runtime variants.
// Usage: node ship-rendertime.mjs <base> <w> <h> f1,f2,... [variant]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, list, variant = 'default'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
const out = [];
for (const f of list.split(',').map(Number)) {
  const ms = await page.evaluate(
    ({ f, variant }) => {
      const v = window.__view;
      window.__advance(f - window.__demoFrame, true);
      if (variant === 'noshadow') v.renderer.shadowMap.autoUpdate = false;
      const gl = v.renderer.getContext();
      const px = new Uint8Array(4);
      const times = [];
      for (let i = 0; i < 160; i++) {
        const t0 = performance.now();
        v.composer.render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return times[Math.floor(times.length / 2)];
    },
    { f, variant },
  );
  out.push(`f${f}:${ms.toFixed(2)}ms`);
}
console.log(base, variant, w + 'x' + h, out.join(' '));
await browser.close();
