// Tower lattice extents by height (relative to the foot), to see where the boom and the mast stick out.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const step = Number(process.argv[3] ?? 5);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.walls, null, { polling: 100, timeout: 120000 });
const out = await page.evaluate((step) => {
  const e = window.__explore;
  const V = e.foot.constructor;
  const f = e.foot;
  const res = {};
  for (const name of ['towerStatic_lattice', 'towerStatic_carriage', 'towerStatic_concrete']) {
    const m = e.view.scene.getObjectByName(name);
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position;
    const v = new V();
    const bands = {};
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const y = Math.floor(v.y / step) * step;
      const b = (bands[y] ??= [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
      const x = v.x - f.x;
      const z = v.z - f.z;
      b[0] = Math.min(b[0], x);
      b[1] = Math.max(b[1], x);
      b[2] = Math.min(b[2], z);
      b[3] = Math.max(b[3], z);
      b[4] = Math.min(b[4], v.y);
      b[5] = Math.max(b[5], v.y);
    }
    res[name] = Object.entries(bands)
      .sort((a, b) => a[0] - b[0])
      .map(([y, b]) => `${y}: x ${b[0].toFixed(2)}..${b[1].toFixed(2)} z ${b[2].toFixed(2)}..${b[3].toFixed(2)} y ${b[4].toFixed(2)}..${b[5].toFixed(2)}`);
  }
  return res;
}, step);
for (const [k, v] of Object.entries(out)) {
  console.log(k);
  for (const l of v) console.log('  ' + l);
}
await browser.close();
