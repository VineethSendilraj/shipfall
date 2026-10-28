// Replays one free-pose glide from explore-clear.mjs (preset i orbited by dTheta and scaled, then key j), and reports
// per-frame motion (largest step, largest change of step), height over the ground, the clamp's lift, and the nearest
// non-model triangle within 3 m with its mesh. Renders the frames around the closest approach (or the largest lift)
// into <out-dir>.
// Usage: node explore-graze.mjs <base> <out-dir> <query> <i> <dTheta> <scale> <j> [w] [h]
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, out, query, i, dTheta, scale, j] = process.argv.slice(2);
const w = Number(process.argv[9] ?? 1280);
const h = Number(process.argv[10] ?? 720);
const tag = `${query || 'starbase'}-${i}-${dTheta}-${scale}-${j}`.replace(/[^a-z0-9.-]/gi, '_');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1${query ? `&${query}` : ''}`, { timeout: 240000 });
await page.waitForFunction(() => window.__explore?.shapes?.length, null, { polling: 100, timeout: 240000 });
await page.waitForTimeout(500);

const r = await page.evaluate(({ i, dTheta, scale, j }) => {
  const e = window.__explore;
  const V = e.foot.constructor;
  const cam = e.view.camera.position;
  const key = (n) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(n), code: `Digit${n}`, bubbles: true }));
  const render = e.view.render;
  const clamp = e.clamp;
  e.view.render = () => {};
  const planned = [];
  e.clamp = function () {
    planned.push(cam.clone());
    clamp.call(this);
  };
  const step = (n, until) => {
    for (let k = 0; k < n; k++) {
      e.frame(1 / 60);
      if (until?.()) break;
    }
  };
  key(i);
  step(900, () => !e.flight);
  const t = e.controls.target;
  const o = cam.clone().sub(t);
  const rad = o.length();
  const theta = Math.atan2(o.x, o.z) + (dTheta * Math.PI) / 180;
  const phi = Math.acos(o.y / rad);
  cam.set(t.x + rad * scale * Math.sin(phi) * Math.sin(theta), t.y + rad * scale * Math.cos(phi), t.z + rad * scale * Math.sin(phi) * Math.cos(theta));
  step(1);
  const start = cam.clone();
  planned.length = 0;
  key(j);
  const states = [];
  const path = [];
  for (let k = 0; k < 900; k++) {
    e.frame(1 / 60);
    path.push(cam.clone());
    states.push({ p: cam.clone(), q: e.view.camera.quaternion.clone(), fov: e.view.camera.fov });
    if (!e.flight) break;
  }
  e.view.render = render;
  e.clamp = clamp;

  // Non-model meshes, as explore-clear.mjs counts them, as world-space triangles.
  e.view.scene.updateMatrixWorld(true);
  const roots = new Set([e.stack.root, e.view.towers[0].root]);
  const isModel = (m) => {
    for (let x = m; x; x = x.parent) if (roots.has(x)) return true;
    return m.name === 'props_mountSteel' || m.name === 'props_dark' || (m.name === 'props_concrete' && m.position.lengthSq() > 0);
  };
  const visible = (x) => {
    for (let y = x; y; y = y.parent) if (!y.visible) return false;
    return true;
  };
  const NEAR = 3;
  const lo = new V().setScalar(Infinity);
  const hi = new V().setScalar(-Infinity);
  for (const p of path) {
    lo.min(p);
    hi.max(p);
  }
  lo.subScalar(NEAR);
  hi.addScalar(NEAR);
  const meshes = [];
  const v = new V();
  const im = new e.view.camera.matrixWorld.constructor();
  const mw = new e.view.camera.matrixWorld.constructor();
  e.view.scene.traverse((m) => {
    if (!m.isMesh || !visible(m) || isModel(m)) return;
    if (m.material.transparent && !m.material.depthWrite) return;
    const g = m.geometry;
    g.computeBoundingBox();
    const size = g.boundingBox.getSize(new V()).multiply(new V().setFromMatrixScale(m.matrixWorld));
    if (Math.max(size.x, size.y, size.z) > 1500) return;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const inst = m.isInstancedMesh ? m.count : 1;
    const tris = [];
    for (let s = 0; s < inst; s++) {
      mw.copy(m.matrixWorld);
      if (m.isInstancedMesh) mw.multiply(m.getMatrixAt(s, im));
      for (let q = 0; q + 2 < n; q += 3) {
        const vs = [];
        for (let c = 0; c < 3; c++) vs.push(...v.fromBufferAttribute(pos, idx ? idx.getX(q + c) : q + c).applyMatrix4(mw).toArray());
        if (Math.max(vs[0], vs[3], vs[6]) < lo.x || Math.min(vs[0], vs[3], vs[6]) > hi.x) continue;
        if (Math.max(vs[1], vs[4], vs[7]) < lo.y || Math.min(vs[1], vs[4], vs[7]) > hi.y) continue;
        if (Math.max(vs[2], vs[5], vs[8]) < lo.z || Math.min(vs[2], vs[5], vs[8]) > hi.z) continue;
        tris.push(...vs, s);
      }
    }
    if (tris.length) meshes.push({ m, tris });
  });
  const A = new V(), B = new V(), C = new V();
  const triD = (p, a, b, c) => {
    // Closest point on triangle (Ericson 5.1.5).
    const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a);
    const d1 = ab.dot(ap), d2 = ac.dot(ap);
    if (d1 <= 0 && d2 <= 0) return a.distanceTo(p);
    const bp = p.clone().sub(b);
    const d3 = ab.dot(bp), d4 = ac.dot(bp);
    if (d3 >= 0 && d4 <= d3) return b.distanceTo(p);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().addScaledVector(ab, d1 / (d1 - d3)).distanceTo(p);
    const cp = p.clone().sub(c);
    const d5 = ab.dot(cp), d6 = ac.dot(cp);
    if (d6 >= 0 && d5 <= d6) return c.distanceTo(p);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().addScaledVector(ac, d2 / (d2 - d6)).distanceTo(p);
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b.clone().addScaledVector(c.clone().sub(b), (d4 - d3) / (d4 - d3 + (d5 - d6))).distanceTo(p);
    const s = va + vb + vc;
    return a.clone().addScaledVector(ab, vb / s).addScaledVector(ac, vc / s).distanceTo(p);
  };
  let best = { d: Infinity };
  path.forEach((p, k) => {
    for (const { m, tris } of meshes) {
      for (let q = 0; q < tris.length; q += 10) {
        if (Math.min(tris[q], tris[q + 3], tris[q + 6]) - NEAR > p.x || Math.max(tris[q], tris[q + 3], tris[q + 6]) + NEAR < p.x) continue;
        if (Math.min(tris[q + 1], tris[q + 4], tris[q + 7]) - NEAR > p.y || Math.max(tris[q + 1], tris[q + 4], tris[q + 7]) + NEAR < p.y) continue;
        if (Math.min(tris[q + 2], tris[q + 5], tris[q + 8]) - NEAR > p.z || Math.max(tris[q + 2], tris[q + 5], tris[q + 8]) + NEAR < p.z) continue;
        A.fromArray(tris, q);
        B.fromArray(tris, q + 3);
        C.fromArray(tris, q + 6);
        const d = triD(p, A, B, C);
        if (d < best.d) {
          const chain = [];
          for (let x = m; x; x = x.parent) chain.push(x.name || x.type);
          const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
          best = {
            d: +d.toFixed(3), frame: k, of: path.length, cam: p.toArray().map((x) => +x.toFixed(2)),
            mesh: chain.join(' < '), instance: m.isInstancedMesh ? tris[q + 9] : null, geometry: m.geometry.type,
            color: m.material.color?.getHexString(), meshBox: [bb.min.toArray().map((x) => +x.toFixed(1)), bb.max.toArray().map((x) => +x.toFixed(1))],
            tri: [A, B, C].map((x) => x.toArray().map((y) => +y.toFixed(2))),
          };
        }
      }
    }
  });

  // Motion: per-frame step, change of step (the jolt a viewer sees), height over the ground, and the clamp's lift.
  let maxStep = 0, maxJolt = 0, joltAt = -1, maxYJolt = 0, minAGL = Infinity, maxLift = 0, liftAt = -1;
  const all = [start, ...path];
  for (let k = 1; k < all.length; k++) maxStep = Math.max(maxStep, all[k].distanceTo(all[k - 1]));
  for (let k = 2; k < all.length; k++) {
    const jolt = all[k].clone().sub(all[k - 1]).sub(all[k - 1].clone().sub(all[k - 2])).length();
    if (jolt > maxJolt) [maxJolt, joltAt] = [jolt, k - 1];
    maxYJolt = Math.max(maxYJolt, Math.abs(all[k].y - 2 * all[k - 1].y + all[k - 2].y));
  }
  path.forEach((p, k) => {
    minAGL = Math.min(minAGL, p.y - e.view.world.groundHeight(p.x, p.z));
    const lift = p.y - planned[k].y;
    if (lift > maxLift) [maxLift, liftAt] = [lift, k];
  });
  window.__states = states;
  return {
    frames: path.length, start: start.toArray().map((x) => +x.toFixed(2)), foot: e.foot.toArray(), meshesNear: meshes.length,
    maxStep: +maxStep.toFixed(2), maxJolt: +maxJolt.toFixed(3), joltAt, maxYJolt: +maxYJolt.toFixed(3),
    minAGL: +minAGL.toFixed(2), maxLift: +maxLift.toFixed(2), liftAt, nearest: best,
  };
}, { i: Number(i), dTheta: Number(dTheta), scale: Number(scale), j: Number(j) });
console.log(JSON.stringify(r, null, 1));

const at = Number.isFinite(r.nearest.d) ? r.nearest.frame : r.liftAt;
const picks = [...new Set([at - 6, at - 2, at, at + 2, r.liftAt].filter((k) => k >= 0 && k < r.frames))];
for (const k of picks) {
  const url = await page.evaluate((k) => {
    const e = window.__explore;
    const s = window.__states[k];
    const c = e.view.camera;
    e.flight = null;
    e.controls.enabled = false;
    c.position.copy(s.p);
    c.quaternion.copy(s.q);
    c.fov = s.fov;
    c.updateProjectionMatrix();
    e.light();
    e.view.render(e.game);
    return e.view.renderer.domElement.toDataURL('image/jpeg', 0.85);
  }, k);
  const file = `${out}/graze-${tag}-f${k}.jpg`;
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', file);
}
await browser.close();
console.log('GRAZE_DONE');
