// Prints the stack's world box relative to the foot and any hidden meshes under it.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.stack, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(500);
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__explore;
  const THREE = Object.getPrototypeOf(e.raycaster.ray.origin).constructor; // Vector3
  const r1 = (v) => [v.x - e.foot.x, v.y, v.z - e.foot.z].map((n) => Math.round(n * 10) / 10);
  const box = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  const hidden = [];
  let tris = 0;
  e.stack.root.updateWorldMatrix(true, true);
  e.stack.root.traverse((m) => {
    if (!m.isMesh) return;
    let vis = true;
    for (let o = m; o && o !== e.stack.root; o = o.parent) vis &&= o.visible;
    if (!vis) hidden.push(m.name || m.geometry.type);
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    for (const k of ['x', 'y', 'z']) { box.min[k] = Math.min(box.min[k], bb.min[k]); box.max[k] = Math.max(box.max[k], bb.max[k]); }
  });
  let towerTris = 0;
  e.view.towers[0].root.traverse((m) => { if (m.isMesh) towerTris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
  return { min: r1(box.min), max: r1(box.max), hidden, stackTris: Math.round(tris), towerTris: Math.round(towerTris) };
})));
await browser.close();
