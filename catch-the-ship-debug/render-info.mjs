// Prints three.js renderer.info (draw calls, triangles, programs, memory) for a page after it settles,
// plus a per-object count of what the scene draws. Usage: node render-info.mjs <url> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url, w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(url);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
await page.waitForTimeout(5000);
const r = await page.evaluate(async () => {
  const v = window.__view;
  const info = v.renderer.info;
  // One whole frame (all composer passes): reset after the page's own render, read after the next one.
  info.autoReset = false;
  await new Promise((done) => requestAnimationFrame(() => (info.reset(), requestAnimationFrame(done))));
  let meshes = 0;
  let visible = 0;
  let lights = 0;
  v.scene.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) meshes++;
    if ((o.isMesh || o.isPoints || o.isLine) && o.visible) visible++;
    if (o.isLight) lights++;
  });
  return { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs.length, geo: info.memory.geometries, tex: info.memory.textures, meshes, visible, lights, quality: window.__quality };
});
console.log(url, JSON.stringify(r));
await browser.close();
