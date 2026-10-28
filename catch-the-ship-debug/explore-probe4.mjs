// Extents of the parts that stick out past the hull (r > 5.2): grid fins, catch pins and flaps, in each part's own
// radial frame (radial distance, tangential offset, height), so they can be bounded by turned boxes.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.stack, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const e = window.__explore;
  const V = e.foot.constructor;
  const f = e.foot;
  const v = new V();
  // Group outlying vertices by the nearest of 8 directions (E, NE, N, ...), then by height band.
  const groups = {};
  e.stack.root.updateMatrixWorld(true);
  e.stack.root.traverse((m) => {
    if (!m.isMesh && !m.isInstancedMesh) return;
    const pos = m.geometry.attributes.position;
    const inst = m.isInstancedMesh ? m.count : 1;
    const im = new m.matrixWorld.constructor();
    for (let k = 0; k < inst; k++) {
      if (m.isInstancedMesh) m.getMatrixAt(k, im);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (m.isInstancedMesh) v.applyMatrix4(im);
        v.applyMatrix4(m.matrixWorld);
        const x = v.x - f.x;
        const z = v.z - f.z;
        const r = Math.hypot(x, z);
        if (r < 5.2) continue;
        const sector = ((Math.round(Math.atan2(z, x) / (Math.PI / 4)) % 8) + 8) % 8;
        const a = (sector * Math.PI) / 4;
        const radial = x * Math.cos(a) + z * Math.sin(a);
        const tang = -x * Math.sin(a) + z * Math.cos(a);
        const key = `${sector}`;
        const g = (groups[key] ??= { y: [Infinity, -Infinity], radial: [Infinity, -Infinity], tang: [Infinity, -Infinity], n: 0, byY: {} });
        g.n++;
        const yb = Math.floor(v.y);
        const b = (g.byY[yb] ??= { radial: [Infinity, -Infinity], tang: [Infinity, -Infinity] });
        for (const [arr, val] of [[g.y, v.y], [g.radial, radial], [g.tang, tang], [b.radial, radial], [b.tang, tang]]) {
          arr[0] = Math.min(arr[0], val);
          arr[1] = Math.max(arr[1], val);
        }
      }
    }
  });
  const fmt = (a) => a.map((n) => n.toFixed(2)).join('..');
  const res = [];
  for (const [k, g] of Object.entries(groups)) {
    res.push(`sector ${k} (${['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][k]}): n ${g.n} y ${fmt(g.y)} radial ${fmt(g.radial)} tang ${fmt(g.tang)}`);
    for (const [y, b] of Object.entries(g.byY).sort((a, b) => a[0] - b[0])) res.push(`   y ${y}: radial ${fmt(b.radial)} tang ${fmt(b.tang)}`);
  }
  return res;
});
for (const l of out) console.log(l);
await browser.close();
