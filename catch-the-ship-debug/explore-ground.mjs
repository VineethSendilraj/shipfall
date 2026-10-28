// Ground height under Explore's camera on one map, read by raycasting the world's ground mesh.
// Per preset: the camera's height over the ground at the preset, and the lowest it gets over the turntable's circle
// (the idle orbit keeps the camera's height and its distance from the pivot). Then the ground height over the area
// the camera can reach (within 560 m of the site middle), ring by ring.
// Usage: node explore-ground.mjs <base-url> <query, e.g. map=mars>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, query = ''] = process.argv.slice(2);
const IDS = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__hold = false;
  const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
  window.requestAnimationFrame = wrap;
});
await page.goto(`${base}/?explore=1&quality=low${query ? `&${query}` : ''}`, { timeout: 240000 });
await page.waitForFunction(() => window.__explore?.shapes?.length && !window.__explore.flight, null, { polling: 100, timeout: 240000 });
const out = await page.evaluate((IDS) => {
  window.__hold = true;
  const x = window.__explore;
  const { view } = x;
  const V = view.camera.position.constructor;
  const root = view.scene.getObjectByName(`world-${view.world.map}`);
  // The ground is the widest shadow-receiving mesh under 300 m tall (world space).
  let ground = null;
  let groundW = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.receiveShadow || o.isInstancedMesh) return;
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    if (b.max.y - b.min.y < 300 && w > groundW) [ground, groundW] = [o, w];
  });
  const rc = new x.raycaster.constructor();
  const down = new V(0, -1, 0);
  const at = (px, pz) => {
    rc.set(new V(px, 3000, pz), down);
    return rc.intersectObject(ground, false)[0]?.point.y ?? NaN;
  };
  const presets = [];
  for (const id of IDS) {
    x.enter(id);
    x.idle = -1e9;
    x.frame(1 / 60);
    const p = view.camera.position.clone();
    const t = x.controls.target.clone();
    const r = Math.hypot(p.x - t.x, p.z - t.z);
    const a0 = Math.atan2(p.z - t.z, p.x - t.x);
    let low = { clear: Infinity };
    for (let k = 0; k < 72; k++) {
      const a = a0 + (k * Math.PI) / 36;
      const h = at(t.x + r * Math.cos(a), t.z + r * Math.sin(a));
      if (p.y - h < low.clear) low = { clear: +(p.y - h).toFixed(1), ground: +h.toFixed(1), deg: k * 5 };
    }
    presets.push({ id, camY: +p.y.toFixed(1), groundHere: +at(p.x, p.z).toFixed(2), circleR: +r.toFixed(0), turntableLowest: low });
  }
  const rings = [];
  for (let rr = 0; rr <= 560; rr += 40) {
    let max = -Infinity;
    let maxAt = null;
    let over = 0;
    const n = rr ? 72 : 1;
    for (let k = 0; k < n; k++) {
      const a = (k * Math.PI) / 36;
      const px = rr * Math.cos(a);
      const pz = -60 + rr * Math.sin(a);
      const h = at(px, pz);
      if (h > 0.5) over++;
      if (h > max) {
        max = h;
        maxAt = [Math.round(px), Math.round(pz)];
      }
    }
    rings.push({ r: rr, maxGround: +max.toFixed(1), maxAt, overHalfMeter: `${over}/${n}` });
  }
  return { map: view.world.map, groundVerts: ground.geometry.attributes.position.count, groundR: Math.round(ground.geometry.boundingSphere.radius), foot: x.foot.toArray().map(Math.round), presets, rings };
}, IDS);
console.log(`map ${out.map} ground mesh ${out.groundVerts} verts r ${out.groundR} m, stack foot ${out.foot}`);
for (const p of out.presets) console.log(`${p.id.padEnd(11)} camera y ${String(p.camY).padStart(6)} ground ${String(p.groundHere).padStart(6)} | turntable r ${String(p.circleR).padStart(4)}: lowest clearance ${p.turntableLowest.clear} (ground ${p.turntableLowest.ground} at +${p.turntableLowest.deg} deg)`);
for (const r of out.rings) console.log(`ring ${String(r.r).padStart(3)} m: max ground ${String(r.maxGround).padStart(5)} at ${r.maxAt}, samples over 0.5 m: ${r.overHalfMeter}`);
await browser.close();
