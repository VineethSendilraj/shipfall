// Keep-out coverage: every vertex of the stack, the tower (with carriage and arms) and the launch mount should lie
// inside Explore's keep-out shapes. Reports, per mesh, the vertices outside and the largest distance outside.
// Also prints the shape count and the presets' distances to the shapes, and flags carriage meshes that tilt.
// Usage: node explore-cover.mjs <base-url>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const e = window.__explore;
  const V = e.foot.constructor;
  const f = e.foot;
  const v = new V();
  const res = { shapes: e.shapes.length, meshes: [], tilted: [], presets: {} };
  e.view.scene.updateMatrixWorld(true);
  const scan = (m, group, keep = () => true) => {
    const g = m.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const inst = m.isInstancedMesh ? m.count : 1;
    const im = new m.matrixWorld.constructor();
    const seen = new Set();
    const r = { group, name: m.name || m.parent?.name || g.type, verts: 0, outside: 0, max: -Infinity, at: null };
    for (let k = 0; k < inst; k++) {
      if (m.isInstancedMesh) m.getMatrixAt(k, im);
      seen.clear();
      for (let i = 0; i < n; i++) {
        const vi = idx ? idx.getX(i) : i;
        if (seen.has(vi)) continue;
        seen.add(vi);
        v.fromBufferAttribute(pos, vi);
        if (m.isInstancedMesh) v.applyMatrix4(im);
        v.applyMatrix4(m.matrixWorld);
        if (!keep(v)) continue;
        r.verts++;
        const d = e.toModel(v);
        if (d > 0.02) r.outside++;
        if (d > r.max) {
          r.max = d;
          r.at = [v.x - f.x, v.y, v.z - f.z].map((x) => Math.round(x * 100) / 100);
        }
      }
    }
    if (r.verts) res.meshes.push({ ...r, max: Math.round(r.max * 100) / 100 });
  };
  const visible = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  e.stack.root.traverse((m) => (m.isMesh || m.isInstancedMesh) && visible(m) && scan(m, 'stack'));
  const tw = e.view.towers[0];
  tw.root.traverse((m) => (m.isMesh || m.isInstancedMesh) && visible(m) && scan(m, 'tower'));
  tw.carriage.traverse((m) => {
    if (!m.isMesh) return;
    const el = m.matrixWorld.elements;
    const tilt = Math.max(Math.abs(el[1]), Math.abs(el[4]), Math.abs(el[6]), Math.abs(el[9]));
    if (tilt > 1e-4 || m.isInstancedMesh) res.tilted.push({ name: m.name, tilt, instanced: !!m.isInstancedMesh });
  });
  const nearMount = (p) => Math.hypot(p.x - f.x, p.z - f.z) < 20 && p.y < 30;
  for (const name of ['props_mountSteel', 'props_dark', 'props_concrete']) {
    e.view.scene.traverse((m) => m.isMesh && m.name === name && visible(m) && scan(m, 'mount', nearMount));
  }
  // Each preset's camera distance to the keep-out shapes.
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(k), code: `Digit${k}`, bubbles: true }));
    const fl = e.flight;
    const p = fl.to.position;
    res.presets[k] = Math.round(e.toModel(p) * 100) / 100;
    e.flight = null;
  }
  return res;
});
console.log('shapes:', out.shapes);
console.log('tilted or instanced carriage meshes:', JSON.stringify(out.tilted));
console.log('preset camera distance to the shapes:', JSON.stringify(out.presets));
let worst = -Infinity;
for (const m of out.meshes) {
  worst = Math.max(worst, m.max);
  const flag = m.outside ? 'OUTSIDE' : 'ok';
  console.log(`${flag} ${m.group} ${m.name}: ${m.verts} verts, ${m.outside} outside by > 2 cm, max ${m.max} at ${JSON.stringify(m.at)}`);
}
console.log(`largest distance outside the shapes: ${worst} m`);
await browser.close();
