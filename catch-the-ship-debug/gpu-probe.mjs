import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const probe = async (label, opts) => {
  const browser = await chromium.launch(opts);
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const info = await page.evaluate(() => {
    const gl = document.getElementById('c').getContext('webgl2');
    if (!gl) return 'no webgl2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  });
  const fps = await page.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => (++n < 60 ? requestAnimationFrame(f) : done(Math.round(60000 / (performance.now() - t0)))); requestAnimationFrame(f); }));
  console.log(label.padEnd(34), info, `| rAF ~${fps}/s`);
  await browser.close();
};
const metal = ['--use-angle=metal', '--ignore-gpu-blocklist'];
await probe('chrome channel, headless', { channel: 'chrome', headless: true, args: metal });
await probe('bundled headless shell', { headless: true, args: metal });
