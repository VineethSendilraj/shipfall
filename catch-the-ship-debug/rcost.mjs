// GPU cost of one full frame (render + post) in the real game at a given size: renders N times, then forces the GPU to finish.
// Usage: node rcost.mjs <url> [w] [h] [dpr] [exp]   exp: dpr=<n>,noshadow,nobloom,nomsaa (comma list)
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url, w = '1512', h = '982', dpr = '2', exp = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(url);
await page.waitForTimeout(2500);
await page.click('#play');
await page.waitForTimeout(4000);
const r = await page.evaluate((exp) => {
  const v = window.__view, game = window.__game, gl = v.renderer.getContext();
  for (const e of exp.split(',').filter(Boolean)) {
    const [k, val] = e.split('='), q = { ...v.quality };
    if (k === 'dpr') q.maxDpr = +val;
    if (k === 'noshadow') q.shadows = false;
    if (k === 'nobloom') q.bloom = 0;
    if (k === 'nomsaa') q.msaa = 0;
    v.setQuality(q);
  }
  const px = new Uint8Array(4);
  const run = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) v.render(game); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; };
  run(5);
  const samples = [run(20), run(20), run(20)].sort((a, b) => a - b);
  const info = v.renderer.info.render;
  return { msPerFrame: +samples[1].toFixed(2), spread: samples.map((x) => +x.toFixed(2)), canvas: [v.renderer.domElement.width, v.renderer.domElement.height], quality: v.quality.name, dpr: v.pixelRatio, calls: info.calls, tris: info.triangles };
}, exp);
console.log(JSON.stringify({ url, size: `${w}x${h}@${dpr}`, exp, ...r }));
await browser.close();
