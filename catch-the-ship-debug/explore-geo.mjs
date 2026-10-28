// Dumps tower, carriage and arm extents relative to the foot of the stack in explore mode.
// Usage: node explore-geo.mjs <base-url>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.stack, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const e = window.__explore;
  const f = e.foot;
  const tw = e.view.towers[0];
  // Walks every mesh vertex under obj in world space and reports extents relative to the foot.
  const scan = (obj) => {
    let minR = Infinity;
    let maxR = 0;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    obj.updateWorldMatrix(true, true);
    obj.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      const pos = m.geometry.attributes.position;
      const v = m.position.clone();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const x = v.x - f.x;
        const z = v.z - f.z;
        const r = Math.hypot(x, z);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        [x, v.y, z].forEach((c, k) => {
          lo[k] = Math.min(lo[k], c);
          hi[k] = Math.max(hi[k], c);
        });
      }
    });
    const r1 = (n) => Math.round(n * 10) / 10;
    return { minR: r1(minR), maxR: r1(maxR), lo: lo.map(r1), hi: hi.map(r1) };
  };
  const res = { foot: [f.x, f.y, f.z], towerRoot: tw.root.position.toArray().map((n) => n - (n === tw.root.position.x ? f.x : 0)) };
  res.carriageY = tw.carriage.position.y;
  res.carriage = scan(tw.carriage);
  const static_ = tw.root.children.filter((c) => c !== tw.carriage);
  res.structure = static_.map((c) => ({ name: c.name || c.type, ...scan(c) }));
  res.arms = tw.carriage.children.filter((c) => c.type === 'Group' || c.isObject3D).map((c) => ({ name: c.name || c.type, ...scan(c) }));
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
