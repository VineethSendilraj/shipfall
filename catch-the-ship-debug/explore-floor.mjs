// Explore's camera floor against the real ground mesh (raycast), on the current map.
// 1. Drops the camera to y 0.2 at 40 seeded spots across the reachable area (pivot 50 m toward the site middle) and
//    steps one frame: the clamp must lift it to about FLOOR_Y (1.5 m) over the mesh.
// 2. Puts the camera low over the highest ground found and lets the turntable run 10 s: the lowest clearance over
//    the mesh, frame by frame.
// Usage: node explore-floor.mjs <base-url> <query, e.g. map=mars>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, query = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(240000);
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`${m.type()}: ${m.text()}`));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__hold = false;
  const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
  window.requestAnimationFrame = wrap;
});
await page.goto(`${base}/?explore=1&quality=low${query ? `&${query}` : ''}`, { timeout: 240000 });
await page.waitForFunction(() => window.__explore?.shapes?.length && !window.__explore.flight, null, { polling: 100, timeout: 240000 });
const out = await page.evaluate(() => {
  window.__hold = true;
  const x = window.__explore;
  const { view } = x;
  const V = view.camera.position.constructor;
  const root = view.scene.getObjectByName(`world-${view.world.map}`);
  let ground = null;
  let groundW = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.receiveShadow || o.isInstancedMesh) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    if (b.max.y - b.min.y < 300 && w > groundW) [ground, groundW] = [o, w];
  });
  const rc = new x.raycaster.constructor();
  const down = new V(0, -1, 0);
  const mesh = (px, pz) => {
    rc.set(new V(px, 3000, pz), down);
    return rc.intersectObject(ground, false)[0]?.point.y ?? NaN;
  };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const p = view.camera.position;
  const t = x.controls.target;
  const drops = [];
  let highest = null;
  for (let i = 0; i < 40; i++) {
    const r = 220 + 330 * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const px = r * Math.cos(a);
    const pz = -60 + r * Math.sin(a);
    p.set(px, 0.2, pz);
    t.set(px * 0.9, 0, -60 + (pz + 60) * 0.9);
    x.idle = -1e9;
    x.frame(1 / 60);
    const g = mesh(p.x, p.z);
    drops.push({ ground: g, clear: p.y - g, fn: view.world.groundHeight(p.x, p.z) - g });
    if (!highest || g > highest.g) highest = { g, px, pz };
  }
  const clears = drops.map((d) => d.clear);
  const fnErr = drops.map((d) => Math.abs(d.fn));
  // Turntable from low over the highest spot: pivot 60 m toward the site middle, 8 m up.
  p.set(highest.px, 0.2, highest.pz);
  const toward = new V(-highest.px, 0, -60 - highest.pz).normalize();
  t.set(highest.px + 60 * toward.x, 8, highest.pz + 60 * toward.z);
  x.idle = 9;
  let low = Infinity;
  let rotating = 0;
  for (let k = 0; k < 600; k++) {
    x.frame(1 / 60);
    if (x.controls.autoRotate) rotating++;
    low = Math.min(low, p.y - mesh(p.x, p.z));
  }
  return {
    map: view.world.map,
    drops: { n: drops.length, maxGround: Math.max(...drops.map((d) => d.ground)).toFixed(1), minClear: Math.min(...clears).toFixed(2), maxClear: Math.max(...clears).toFixed(2), fnVsMeshMax: Math.max(...fnErr).toFixed(2) },
    turntable: { startGround: highest.g.toFixed(1), framesRotating: rotating, lowestClear: low.toFixed(2) },
  };
});
console.log(JSON.stringify(out));
console.log(problems.length ? problems.join('\n') : 'no console errors or warnings');
await browser.close();
