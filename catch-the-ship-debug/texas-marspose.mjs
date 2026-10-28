// Grid search for a Mars title pose: tower in the left third, base pieces outside the title card, mesas on top.
// Usage: node texas-marspose.mjs [aspect=1.7778]
import * as THREE from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/build/three.module.js';

const aspect = Number(process.argv[2] ?? 16 / 9);
const CARD = { x0: 0.29, x1: 0.71, y0: 0.18, y1: 0.82 };
const feats = {
  domeA: [-190, 8, -256], domeB: [-156, 5, -236], domeC: [-168, 6, -284], greenhouse: [-92, 3, -312],
  solarW: [120, 2, -240], solarE: [185, 2, -270], dish: [30, 13, -262], padNE: [262, 0, -172], lander: [372, 5, -262],
  padW: [-282, 0, -158], cargoE: [228, 1, -146], cargoN: [92, 1, -226], mastN: [64, 25, -350], mastE: [318, 30, -372],
};
const cam = new THREE.PerspectiveCamera(42, aspect, 1, 10000);
const v = new THREE.Vector3();
function project(p) {
  v.set(...p).project(cam);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, z: v.z };
}
const onScreen = (s, m = 0.03) => s.z < 1 && s.x > m && s.x < 1 - m && s.y > m && s.y < 1 - m;
const inCard = (s) => s.x > CARD.x0 && s.x < CARD.x1 && s.y > CARD.y0 && s.y < CARD.y1;

const SUN = new THREE.Vector3(0.257, 0, -0.959).normalize();
const north = process.argv[3] === 'north';
const out = [];
const fovs = (process.argv[4] ?? '42').split(',').map(Number);
for (const fov of fovs) {
  cam.fov = fov;
  for (let cx = -600; cx <= 600; cx += 50)
    for (let cz = north ? -950 : 150; cz <= (north ? -350 : 1150); cz += 50)
      for (const cy of [130, 170, 220])
        for (let tx = -450; tx <= 500; tx += 50)
          for (let tz = -600; tz <= 300; tz += 50) {
            const r = Math.hypot(cx, cz);
            if (r < 300) continue;
            const ty = 0;
            cam.position.set(cx, cy, cz);
            cam.lookAt(tx, ty, tz);
            cam.updateProjectionMatrix();
            cam.updateMatrixWorld();
            const top = project([44.75, 148, 0]);
            const foot = project([44.75, 0, 0]);
            if (!onScreen(top) || !onScreen(foot)) continue;
            if (top.x > 0.27 || foot.x > 0.27 || top.x < 0.08 || foot.x < 0.08) continue;
            // Mesa line: a point 1350 m out along the view, 100 m up.
            const dir = new THREE.Vector3(tx - cx, 0, tz - cz).normalize();
            const mesa = project([cx + dir.x * 1350, 100, cz + dir.z * 1350]);
            if (mesa.y < 0.04 || mesa.y > 0.17) continue;
            let n = 0;
            const seen = [];
            for (const [k, p] of Object.entries(feats)) {
              const s = project(p);
              if (onScreen(s, 0.02) && !inCard(s)) {
                n++;
                seen.push(k);
              }
            }
            // Apparent dome size (px at 720 high) as a readability score.
            const d0 = project([-190, 0, -256]);
            const d1 = project([-190, 14, -256]);
            const domePx = Math.abs(d1.y - d0.y) * 720;
            n += Math.min(domePx, 20) / 10;
            const towerLen = Math.hypot(top.x - foot.x, (top.y - foot.y) / aspect);
            if (towerLen < 0.2 || towerLen > 0.4) continue;
            const sun = dir.dot(SUN).toFixed(2);
            out.push({ n, pose: `${cx},${cy},${cz}>${tx},${ty},${tz}@${fov}`, top: [top.x.toFixed(2), top.y.toFixed(2)], foot: [foot.x.toFixed(2), foot.y.toFixed(2)], towerLen: towerLen.toFixed(2), mesaY: mesa.y.toFixed(2), seen: `${seen.join(' ')} sun ${sun}` });
          }
}
out.sort((a, b) => b.n - a.n);
for (const o of out.slice(0, 25)) console.log(o.n.toFixed(1), o.pose, 'top', o.top.join(','), 'foot', o.foot.join(','), 'len', o.towerLen, 'mesaY', o.mesaY, '|', o.seen);
console.log('candidates', out.length);
