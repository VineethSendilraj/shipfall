// Lists visible CylinderGeometry meshes in explore mode with their material and world box (relative to the foot).
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.walls, null, { polling: 100, timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__explore;
  const Box = e.walls[0].constructor;
  const out = {};
  e.view.scene.traverse((m) => {
    if (!m.isMesh || m.geometry.type !== 'CylinderGeometry') return;
    for (let o = m; o; o = o.parent) if (!o.visible) return;
    const chain = [];
    for (let o = m; o && o !== e.view.scene; o = o.parent) chain.push(o.name || o.type);
    const mat = m.material;
    const b = new Box().setFromObject(m);
    const key = `${chain.join('<')} | ${mat.type} transparent=${mat.transparent} blending=${mat.blending} depthWrite=${mat.depthWrite} opacity=${mat.opacity}`;
    (out[key] ??= []).push([b.min.x - e.foot.x, b.min.y, b.min.z, b.max.x - e.foot.x, b.max.y, b.max.z].map((n) => Math.round(n)));
  });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.length, first: v.slice(0, 3) }]));
}), null, 1));
await browser.close();
