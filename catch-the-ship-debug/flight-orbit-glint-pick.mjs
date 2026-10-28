// What the glint sample is: steps to a frame, casts rays through a pixel's four 4x MSAA sample positions into the
// vehicles, and reports the mesh, the hit's local position (radius from the axis), and both the triangle's own normal
// (from its winding) and the interpolated vertex normal, each as N.V and against the outward radial direction.
// Usage: node flight-orbit-glint-pick.mjs <base-url> <demo|flight> <frame> <x> <y>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, mode, frame, x, y] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?${mode}=1&capture=1`, { timeout: 600000 });
await page.waitForFunction((m) => window[m === 'demo' ? '__demoReady' : '__flightReady'] === true, mode, { timeout: 600000 });
const out = await page.evaluate(
  async ([target, px, py]) => {
    const THREE = await import(performance.getEntriesByType('resource').find((e) => /\/deps\/three\.js(\?|$)/.test(e.name)).name);
    const v = window.__view;
    const { renderer, camera } = v;
    let s = { frame: 0 };
    while (s.frame < target) s = window.__advance(1, true);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const ray = new THREE.Raycaster();
    const roots = v.pool.map((p) => p.root);
    const res = [];
    for (const [ox, oy] of [[0.375, 0.125], [0.875, 0.375], [0.125, 0.625], [0.625, 0.875]]) {
      ray.setFromCamera(new THREE.Vector2(((px + ox) / size.x) * 2 - 1, -((py + oy) / size.y) * 2 + 1), camera);
      const hit = ray.intersectObjects(roots, true)[0];
      if (!hit) {
        res.push({ sample: [ox, oy], hit: null });
        continue;
      }
      const o = hit.object;
      const g = o.geometry;
      const local = o.worldToLocal(hit.point.clone());
      const toEye = camera.position.clone().sub(hit.point).normalize();
      const nAttr = g.attributes.normal;
      const vn = new THREE.Vector3();
      const bary = THREE.Triangle.getBarycoord(local, ...[hit.face.a, hit.face.b, hit.face.c].map((i) => new THREE.Vector3().fromBufferAttribute(g.attributes.position, i)), new THREE.Vector3());
      [hit.face.a, hit.face.b, hit.face.c].forEach((i, k) => vn.addScaledVector(new THREE.Vector3().fromBufferAttribute(nAttr, i), bary.getComponent(k)));
      vn.normalize();
      const radial = new THREE.Vector3(local.x, 0, local.z).normalize();
      const world = (n) => n.clone().transformDirection(o.matrixWorld);
      const r3 = (vec) => vec.toArray().map((q) => +q.toFixed(3));
      res.push({
        sample: [ox, oy],
        mesh: `${o.parent?.name}/${o.name}`,
        role: o.userData.role,
        local: r3(local),
        radius: +Math.hypot(local.x, local.z).toFixed(3),
        faceN: r3(hit.face.normal),
        vertN: r3(vn),
        faceNdotV: +world(hit.face.normal).dot(toEye).toFixed(3),
        vertNdotV: +world(vn).dot(toEye).toFixed(3),
        faceNdotRadial: +hit.face.normal.dot(radial).toFixed(3),
        vertNdotRadial: +vn.dot(radial).toFixed(3),
      });
    }
    return { frame: s.frame, res };
  },
  [Number(frame), Number(x), Number(y)],
);
console.log(JSON.stringify(out, null, 1));
await browser.close();
