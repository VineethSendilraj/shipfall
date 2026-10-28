// Clearance scan for explore mode: frame-steps the real Explore.frame() through every preset's turntable, the
// preset-to-preset glides, and glides from poses a user could reach (each preset orbited or zoomed), and measures
// the exact distance from the camera path (each 60 fps frame, with points every 0.6 m between frames) to the
// nearest triangle. "Model" is the stack, the tower with its carriage and arms, and the launch mount; anything
// else is "other". Also records the largest correction the per-frame clamp made and how long route() took.
// Usage: node explore-clear.mjs <base-url> [turntable-seconds] [sections: turn,pairs,free] [query, e.g. map=mars]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const spinS = Number(process.argv[3] ?? 70);
const sections = (process.argv[4] ?? 'turn,pairs,free').split(',');
const query = process.argv[5] ?? '';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1${query ? `&${query}` : ''}`, { timeout: 240000 });
page.setDefaultTimeout(240000);
await page.waitForFunction(() => window.__explore?.shapes?.length, null, { polling: 100, timeout: 240000 });
await page.waitForTimeout(500);

const setup = await page.evaluate(() => {
  const e = window.__explore;
  const V = e.foot.constructor;
  const f = e.foot;
  const R = 1.5;
  const CELL = 2;
  e.view.scene.updateMatrixWorld(true);
  const roots = new Set([e.stack.root, e.view.towers[0].root]);
  // The mount's leg mesh is a moved clone of props_concrete; the original stays at the origin.
  const isModel = (m) => {
    for (let o = m; o; o = o.parent) if (roots.has(o)) return true;
    return m.name === 'props_mountSteel' || m.name === 'props_dark' || (m.name === 'props_concrete' && m.position.lengthSq() > 0);
  };
  const visible = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const tris = [];
  const meta = [];
  const names = [];
  const grid = new Map();
  const key = (ix, iy, iz) => ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  const v = [new V(), new V(), new V()];
  let skippedBig = 0;
  let meshes = 0;
  e.view.scene.traverse((m) => {
    if (!m.isMesh || !visible(m)) return;
    if (m.material.transparent && !m.material.depthWrite) return; // light beams and haze, not solid
    const g = m.geometry;
    g.computeBoundingBox();
    const size = g.boundingBox.getSize(new V()).multiply(new V().setFromMatrixScale(m.matrixWorld));
    if (Math.max(size.x, size.y, size.z) > 1500) return; // sky, ground, sea
    meshes++;
    const model = isModel(m);
    const nameId = names.push(m.name || m.parent?.name || g.type) - 1;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const inst = m.isInstancedMesh ? m.count : 1;
    const im = new m.matrixWorld.constructor();
    for (let k = 0; k < inst; k++) {
      if (m.isInstancedMesh) m.getMatrixAt(k, im);
      for (let i = 0; i + 2 < n; i += 3) {
        for (let c = 0; c < 3; c++) {
          v[c].fromBufferAttribute(pos, idx ? idx.getX(i + c) : i + c);
          if (m.isInstancedMesh) v[c].applyMatrix4(im);
          v[c].applyMatrix4(m.matrixWorld);
        }
        const lo = [0, 1, 2].map((ax) => Math.floor((Math.min(v[0].getComponent(ax), v[1].getComponent(ax), v[2].getComponent(ax)) - R) / CELL));
        const hi = [0, 1, 2].map((ax) => Math.floor((Math.max(v[0].getComponent(ax), v[1].getComponent(ax), v[2].getComponent(ax)) + R) / CELL));
        if (lo.some((x) => x < -500) || hi.some((x) => x > 500)) continue;
        if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 20000) {
          skippedBig++;
          continue;
        }
        const t = tris.length / 9;
        for (const p of v) tris.push(p.x, p.y, p.z);
        meta.push(model ? nameId : -1 - nameId);
        for (let ix = lo[0]; ix <= hi[0]; ix++) {
          for (let iy = lo[1]; iy <= hi[1]; iy++) {
            for (let iz = lo[2]; iz <= hi[2]; iz++) {
              const kk = key(ix, iy, iz);
              let list = grid.get(kk);
              if (!list) grid.set(kk, (list = []));
              list.push(t);
            }
          }
        }
      }
    }
  });
  const T = new Float64Array(tris);

  // Squared distance from p to triangle t (Ericson, Real-Time Collision Detection 5.1.5).
  const d2 = (px, py, pz, t) => {
    const o = t * 9;
    const ax = T[o], ay = T[o + 1], az = T[o + 2];
    const bx = T[o + 3], by = T[o + 4], bz = T[o + 5];
    const cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const sq = (x, y, z) => x * x + y * y + z * z;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2_ = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2_ <= 0) return sq(apx, apy, apz);
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz);
    const vc = d1 * d4 - d3 * d2_;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const w = d1 / (d1 - d3);
      return sq(apx - w * abx, apy - w * aby, apz - w * abz);
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz);
    const vb = d5 * d2_ - d1 * d6;
    if (vb <= 0 && d2_ >= 0 && d6 <= 0) {
      const w = d2_ / (d2_ - d6);
      return sq(apx - w * acx, apy - w * acy, apz - w * acz);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return sq(bpx - w * (cx - bx), bpy - w * (cy - by), bpz - w * (cz - bz));
    }
    const s = va + vb + vc;
    if (!(s > 0)) return Math.min(sq(apx, apy, apz), sq(bpx, bpy, bpz), sq(cpx, cpy, cpz));
    const vv = vb / s;
    const ww = vc / s;
    return sq(apx - abx * vv - acx * ww, apy - aby * vv - acy * ww, apz - abz * vv - acz * ww);
  };
  /** Nearest model and other triangles within R of p: {model: [d, name], other: [d, name]}. */
  const nearest = (p) => {
    const list = grid.get(key(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL)));
    const best = { model: [Infinity, null], other: [Infinity, null] };
    if (!list) return best;
    for (const t of list) {
      const dd = d2(p.x, p.y, p.z, t);
      const slot = meta[t] >= 0 ? best.model : best.other;
      if (dd < slot[0]) {
        slot[0] = dd;
        slot[1] = t;
      }
    }
    for (const slot of [best.model, best.other]) {
      slot[0] = Math.sqrt(slot[0]);
      if (slot[1] !== null) slot[1] = names[meta[slot[1]] >= 0 ? meta[slot[1]] : -1 - meta[slot[1]]];
    }
    return best;
  };
  const rel = (p) => [p.x - f.x, p.y, p.z - f.z].map((n) => Math.round(n * 10) / 10);

  /** Closest model and other approaches along a camera path (points every 0.6 m between frames). */
  window.__clear = (path) => {
    const res = { samples: 0, model: { d: Infinity }, other: { d: Infinity }, modelUnder: 0, otherUnder: 0 };
    const q = new V();
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const next = path[i + 1];
      const steps = next ? Math.max(1, Math.ceil(p.distanceTo(next) / 0.6)) : 1;
      for (let s = 0; s < steps; s++) {
        q.lerpVectors(p, next ?? p, s / steps);
        res.samples++;
        const b = nearest(q);
        for (const kind of ['model', 'other']) {
          const [d, name] = b[kind];
          if (d < R) res[`${kind}Under`]++;
          if (d < res[kind].d) res[kind] = { d: Math.round(d * 100) / 100, name, at: rel(q), where: +(i / path.length).toFixed(2) };
        }
      }
    }
    return res;
  };

  /** Steps frame() with rendering stubbed out; records camera positions and the clamp's largest shape correction. */
  window.__step = (n, until = null) => {
    const render = e.view.render;
    const clamp = e.clamp;
    const cam = e.view.camera.position;
    let push = 0;
    e.view.render = () => {};
    e.clamp = function () {
      const before = cam.clone();
      clamp.call(this);
      // Only the shape push, not the floor or the site edge.
      before.y = Math.max(1.5, before.y);
      push = Math.max(push, before.distanceTo(cam));
    };
    const path = [];
    try {
      for (let k = 0; k < n; k++) {
        e.frame(1 / 60);
        path.push(cam.clone());
        if (until?.()) break;
      }
    } finally {
      e.view.render = render;
      e.clamp = clamp;
    }
    path.corr = push;
    return path;
  };
  window.__key = (n) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(n), code: `Digit${n}`, bubbles: true }));
  /** Presses key n and times the focus() call, which routes the glide. */
  window.__glide = (n) => {
    const t0 = performance.now();
    window.__key(n);
    return performance.now() - t0;
  };
  return { meshes, tris: T.length / 9, cells: grid.size, skippedBig, shapes: e.shapes.length };
});
console.log('setup:', JSON.stringify(setup));

const names = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
const fmt = (r) => `model ${r.model.d} (${r.model.name ?? '-'})${r.modelUnder ? ` at ${JSON.stringify(r.model.at)} where ${r.model.where}` : ''}, other ${r.other.d} (${r.other.name ?? '-'})${r.otherUnder ? ` at ${JSON.stringify(r.other.at)}` : ''}, push ${r.push}`;
const stats = { model: 0, other: 0, push: 0, pushMax: 0, routeMs: [] };
const tally = (label, r) => {
  const flag = r.modelUnder ? 'MODEL' : r.otherUnder ? 'other' : 'ok';
  if (r.modelUnder) stats.model++;
  if (r.otherUnder) stats.other++;
  if (r.push > 0.3) stats.push++;
  stats.pushMax = Math.max(stats.pushMax, r.push);
  if (r.ms !== undefined) stats.routeMs.push(r.ms);
  if (flag !== 'ok' || r.push > 0.3) console.log(`${flag} ${label}: ${fmt(r)}${r.ms !== undefined ? `, route ${r.ms.toFixed(1)} ms` : ''}`);
  else console.log(`ok ${label}: model ${r.model.d}, push ${r.push}${r.ms !== undefined ? `, route ${r.ms.toFixed(1)} ms` : ''}`);
};

for (let k = 1; k <= 9 && sections.includes('turn'); k++) {
  const r = await page.evaluate(({ k, spinS }) => {
    const e = window.__explore;
    window.__key(k);
    window.__step(900, () => !e.flight);
    e.idle = 9;
    let reversals = 0;
    let sign = Math.sign(e.controls.autoRotateSpeed);
    const path = window.__step(Math.round(spinS * 60), () => {
      const s = Math.sign(e.controls.autoRotateSpeed);
      if (s !== sign) reversals++;
      sign = s;
      return false;
    });
    const t = e.controls.target;
    const az = path.map((p) => Math.atan2(p.x - t.x, p.z - t.z));
    let sweep = 0;
    for (let i = 1; i < az.length; i++) sweep += Math.abs(((az[i] - az[i - 1] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    return { spinning: e.controls.autoRotate, reversals, sweptDeg: Math.round((sweep * 180) / Math.PI), push: Math.round(path.corr * 100) / 100, ...window.__clear(path) };
  }, { k, spinS });
  tally(`turntable ${names[k - 1]} (spinning ${r.spinning}, swept ${r.sweptDeg} deg, ${r.reversals} reversals)`, r);
}

let glides = 0;
if (sections.includes('pairs')) {
  const entry = await page.evaluate(() => {
    const e = window.__explore;
    e.exit();
    e.enter();
    const path = window.__step(900, () => !e.flight);
    return { push: Math.round(path.corr * 100) / 100, ...window.__clear(path) };
  });
  tally('glide title -> stack (entry)', entry);
  for (let i = 1; i <= 9; i++) {
    for (let j = 1; j <= 9; j++) {
      if (i === j) continue;
      const r = await page.evaluate(({ i, j }) => {
        const e = window.__explore;
        window.__key(i);
        window.__step(900, () => !e.flight);
        const ms = window.__glide(j);
        const path = window.__step(900, () => !e.flight);
        return { ms, frames: path.length, push: Math.round(path.corr * 100) / 100, ...window.__clear(path) };
      }, { i, j });
      glides++;
      tally(`glide ${names[i - 1]} -> ${names[j - 1]}`, r);
    }
  }
}

let free = 0;
let startsInside = 0;
if (sections.includes('free')) {
  // Orbit by dTheta degrees and scale the distance, around the preset's own pivot. Env POSES (JSON), FROM and TO
  // (preset numbers, comma-separated) narrow the scan.
  const POSES = process.env.POSES ? JSON.parse(process.env.POSES) : [[80, 1], [-80, 1], [160, 1], [0, 0.5], [0, 2]];
  const only = (env) => (process.env[env] ? process.env[env].split(',').map(Number) : null);
  const from = only('FROM');
  const to = only('TO');
  for (let i = 1; i <= 9; i++) {
    if (from && !from.includes(i)) continue;
    for (const [dTheta, scale] of POSES) {
      for (let j = 1; j <= 9; j++) {
        if (i === j || (to && !to.includes(j))) continue;
        const r = await page.evaluate(({ i, j, dTheta, scale }) => {
          const e = window.__explore;
          window.__key(i);
          window.__step(900, () => !e.flight);
          const cam = e.view.camera.position;
          const t = e.controls.target;
          const o = cam.clone().sub(t);
          const rad = o.length();
          const theta = Math.atan2(o.x, o.z) + (dTheta * Math.PI) / 180;
          const phi = Math.acos(o.y / rad);
          cam.set(t.x + rad * scale * Math.sin(phi) * Math.sin(theta), t.y + rad * scale * Math.cos(phi), t.z + rad * scale * Math.sin(phi) * Math.cos(theta));
          // One frame, as when the user lets go: it settles the pose, and the clamp moves it out of the model.
          const settle = window.__step(1);
          const start = window.__clear([cam.clone()]);
          const ms = window.__glide(j);
          const path = window.__step(900, () => !e.flight);
          return { ms, frames: path.length, settle: Math.round(settle.corr * 100) / 100, startModel: start.model.d, push: Math.round(path.corr * 100) / 100, ...window.__clear(path) };
        }, { i, j, dTheta, scale });
        free++;
        if (r.startModel < 1.5) startsInside++;
        tally(`free ${names[i - 1]}(${dTheta},${scale}) -> ${names[j - 1]} (start push ${r.settle}, start model ${r.startModel})`, r);
      }
    }
  }
}
const ms = stats.routeMs.sort((a, b) => a - b);
const pct = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))].toFixed(1) : '-');
console.log(`${glides} preset glides, ${free} free-pose glides (${startsInside} starts within 1.5 m of the model after the clamp)`);
console.log(`route time ms: p50 ${pct(0.5)} p95 ${pct(0.95)} max ${pct(1)}`);
console.log(`clamp corrections over 0.3 m in a frame: ${stats.push} paths, largest ${stats.pushMax.toFixed(2)} m`);
console.log(`paths within 1.5 m of the model: ${stats.model}; of other scenery: ${stats.other}`);
console.log('CLEAR_DONE');
await browser.close();
