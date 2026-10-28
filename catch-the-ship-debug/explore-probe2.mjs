// Geometry probe for keep-out shapes: the stack's radius by height, the tower's parts and arms (local boxes and
// transforms), and the mount's parts near the foot. Coordinates are relative to the foot of the stack.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.walls, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(300);
const out = await page.evaluate(() => {
  const e = window.__explore;
  const V = e.foot.constructor;
  const Box = e.walls[0].constructor;
  const f = e.foot;
  const r1 = (n) => Math.round(n * 100) / 100;
  const visible = (m) => {
    for (let o = m; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  const eachVertex = (root, fn) => {
    root.updateWorldMatrix(true, true);
    const v = new V();
    root.traverse((m) => {
      if (!m.isMesh || !visible(m)) return;
      const pos = m.geometry.attributes.position;
      const idx = m.geometry.index;
      // Only vertices that a drawn triangle uses (split geometries share buffers).
      const used = idx ? new Set(Array.from(idx.array)) : null;
      if (m.isInstancedMesh) {
        const im = new m.matrixWorld.constructor();
        for (let k = 0; k < m.count; k++) {
          m.getMatrixAt(k, im);
          im.premultiply(m.matrixWorld);
          for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i).applyMatrix4(im), m);
        }
        return;
      }
      for (let i = 0; i < pos.count; i++) if (!used || used.has(i)) fn(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld), m);
    });
  };
  // Stack: max radius per 1 m band, and per 45 degree sector in bands where it exceeds 4.7 m.
  const bands = {};
  eachVertex(e.stack.root, (v) => {
    const y = Math.floor(v.y);
    const x = v.x - f.x;
    const z = v.z - f.z;
    const r = Math.hypot(x, z);
    const s = (Math.round((Math.atan2(z, x) * 180) / Math.PI / 45) + 8) % 8;
    const b = (bands[y] ??= { r: 0, sec: [0, 0, 0, 0, 0, 0, 0, 0] });
    b.r = Math.max(b.r, r);
    b.sec[s] = Math.max(b.sec[s], r);
  });
  const stack = Object.entries(bands)
    .map(([y, b]) => [Number(y), r1(b.r), b.r > 4.7 ? b.sec.map((n) => Math.round(n * 10) / 10).join(' ') : ''])
    .sort((a, b) => a[0] - b[0]);
  // Tower: every mesh's world box, and the carriage's children with local boxes and world transform.
  const tw = e.view.towers[0];
  const towerMeshes = [];
  tw.root.updateWorldMatrix(true, true);
  tw.root.traverse((m) => {
    if (!m.isMesh || !visible(m)) return;
    const b = new Box().setFromObject(m);
    const chain = [];
    for (let o = m; o && o !== tw.root; o = o.parent) chain.push(o.name || o.type);
    towerMeshes.push({ chain: chain.join('<'), inst: m.isInstancedMesh ? m.count : 0, min: [b.min.x - f.x, b.min.y, b.min.z - f.z].map(r1), max: [b.max.x - f.x, b.max.y, b.max.z - f.z].map(r1) });
  });
  const carriage = tw.carriage;
  const tree = (o, depth = 0) => {
    const lb = new Box();
    if (o.isMesh) {
      o.geometry.computeBoundingBox();
      lb.copy(o.geometry.boundingBox);
    }
    const p = new V();
    o.getWorldPosition(p);
    const q = o.getWorldQuaternion(new o.quaternion.constructor());
    const s = o.getWorldScale(new V());
    const node = { name: o.name || o.type, mesh: !!o.isMesh, pos: [p.x - f.x, p.y, p.z - f.z].map(r1), quat: q.toArray().map(r1), scale: s.toArray().map(r1), local: o.isMesh ? [lb.min.toArray().map(r1), lb.max.toArray().map(r1)] : null };
    if (depth < 4 && o.children.length) node.children = o.children.map((c) => tree(c, depth + 1));
    return node;
  };
  const tower = { root: tree(tw.root, 0) };
  // Props near the foot (within 40 m horizontally): per-mesh boxes of only the vertices near the foot.
  const props = e.view.scene.getObjectByName('props');
  const near = {};
  eachVertex(props, (v, m) => {
    const x = v.x - f.x;
    const z = v.z - f.z;
    if (Math.hypot(x, z) > 40) return;
    const k = m.name;
    const b = (near[k] ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], n: 0 });
    [x, v.y, z].forEach((c, i) => {
      b.min[i] = Math.min(b.min[i], c);
      b.max[i] = Math.max(b.max[i], c);
    });
    b.n++;
  });
  for (const b of Object.values(near)) {
    b.min = b.min.map(r1);
    b.max = b.max.map(r1);
  }
  // Mount radius profile per 1 m band (props_mountSteel and props_dark near the foot).
  const mband = {};
  eachVertex(props, (v, m) => {
    const x = v.x - f.x;
    const z = v.z - f.z;
    const r = Math.hypot(x, z);
    if (r > 40) return;
    const y = Math.floor(v.y);
    const k = `${m.name}`;
    const b = ((mband[k] ??= {})[y] ??= { rmin: Infinity, rmax: 0 });
    b.rmin = Math.min(b.rmin, r);
    b.rmax = Math.max(b.rmax, r);
  });
  for (const k in mband) mband[k] = Object.entries(mband[k]).map(([y, b]) => `${y}:${r1(b.rmin)}-${r1(b.rmax)}`).join(' ');
  return { stack, towerMeshes, tower, near, mband };
});
console.log('STACK (y, rmax, sectors E,NE,N,... when > 4.7)');
for (const row of out.stack) console.log(row.join('\t'));
console.log('TOWER MESHES');
for (const m of out.towerMeshes) console.log(JSON.stringify(m));
console.log('TOWER TREE');
console.log(JSON.stringify(out.tower, null, 1));
console.log('PROPS NEAR FOOT');
console.log(JSON.stringify(out.near, null, 1));
console.log('MOUNT BANDS');
for (const [k, v] of Object.entries(out.mband)) console.log(k, v);
await browser.close();
