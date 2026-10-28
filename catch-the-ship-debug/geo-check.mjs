// Reads three.js GPU resource counts on the title screen over time (to see when models finish loading), then
// optionally flips the map picker Starbase -> Mars -> Starbase and reads them again. Headless only.
// Usage: node geo-check.mjs <base> [flip]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, flip = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
    10|await page.goto(`${base}/`);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
const info = (label) =>
  page.evaluate((label) => {
    const v = window.__view;
    const r = v.renderer.info;
    let meshes = 0;
    v.scene.traverse((o) => o.isMesh && meshes++);
    return { label, map: v.world?.map ?? '-', geo: r.memory.geometries, tex: r.memory.textures, prog: r.programs.length, meshes };
  }, label);
for (const s of [2, 5, 10, 20, 30]) {
  await page.waitForTimeout(s === 2 ? 2000 : (s - [2, 5, 10, 20, 30][[2, 5, 10, 20, 30].indexOf(s) - 1]) * 1000);
  console.log(JSON.stringify(await info(`t=${s}s`)));
}
if (flip) {
  for (const m of ['mars', 'starbase']) {
    await page.click(`#title-screen .map-pick button[data-map="${m}"]`);
    await page.waitForTimeout(3000);
    console.log(JSON.stringify(await info(`after ${m}`)));
  }
}
await browser.close();
