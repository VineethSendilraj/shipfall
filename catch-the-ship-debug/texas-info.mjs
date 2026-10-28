// Draw calls and triangles for one whole frame (every composer pass and the shadow map, summed), plus the
// GPU memory and program counts, at given showcase frames.
// Usage: node texas-info.mjs <base> <w> <h> <framesCsv> [extraQuery]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, framesCsv, extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1${extra}`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 90000 });
const out = {};
for (const f of framesCsv.split(',').map(Number)) {
  out[f] = await page.evaluate((f) => {
    const cur = window.__demoFrame;
    if (f - cur > 3) window.__advance(f - cur - 3, false);
    while (window.__demoFrame < f) window.__advance(1, true);
    const info = window.__view.renderer.info;
    info.autoReset = false;
    info.reset();
    window.__advance(0, true);
    const r = { calls: info.render.calls, tris: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs.length };
    info.autoReset = true;
    return r;
  }, f);
}
console.log(JSON.stringify({ base, extra, ...out }));
await browser.close();
