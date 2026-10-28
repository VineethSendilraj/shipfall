// Search Mars establishing poses that frame well at 1280x720, 480x480 and 390x844 under the director's narrow rule.
import * as THREE from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/build/three.module.js';

const focus = [45, 0, 0];
const SIZES = [
  { w: 1280, h: 720 },
  { w: 480, h: 480 },
  { w: 390, h: 844 },
];
const cams = SIZES.map((s) => {
  const lift = s.w / s.h < 0.8 ? 0.35 : 0;
  const cam = new THREE.PerspectiveCamera(40, s.w / s.h, 1, 20000);
  if (lift > 0) cam.setViewOffset(s.w, s.h * (1 + lift), 0, s.h * lift, s.w, s.h);
  return { cam, narrow: Math.max(1, 16 / 9 / (s.w / (s.h * (1 + lift)))) };
});
const v = new THREE.Vector3();
const dir = new THREE.Vector3();
function frame(shot, i) {
  const { cam, narrow } = cams[i];
  const [fx, fy, fz] = focus;
  const k = narrow ** 0.4;
  const j = 1 / narrow;
  cam.position.set(fx + (shot.pos[0] - fx) * k, shot.pos[1], fz + (shot.pos[2] - fz) * k);
  const tgt = new THREE.Vector3(fx + (shot.tgt[0] - fx) * j, fy + (shot.tgt[1] - fy) * j, fz + (shot.tgt[2] - fz) * j);
  cam.fov = shot.fov * narrow ** 0.15;
  cam.updateProjectionMatrix();
  cam.lookAt(tgt);
  cam.updateMatrixWorld();
  dir.subVectors(tgt, cam.position).setY(0).normalize();
  const pr = (x, y, z) => {
    v.set(x, y, z).project(cam);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, z: v.z };
  };
  return {
    top: pr(44.75, 160, 0),
    foot: pr(44.75, 0, 0),
    domes: pr(-170, 6, -254),
    lander: pr(372, 5, -262),
    padNE: pr(262, 0, -172),
    mesa: pr(cam.position.x + dir.x * 1350, 60, cam.position.z + dir.z * 1350),
  };
}
const out = [];
for (let px = 150; px <= 350; px += 20)
  for (const py of [150, 180, 210, 240, 270, 300])
    for (let pz = 380; pz <= 640; pz += 20)
      for (let tx = 60; tx <= 220; tx += 20)
        for (const ty of [0, 15, 30])
          for (let tz = -340; tz <= -200; tz += 20)
            for (const fov of [34, 36, 38, 40, 42, 44]) {
              if (Math.hypot(px, pz) < 300) continue;
              const shot = { pos: [px, py, pz], tgt: [tx, ty, tz], fov };
              const a = frame(shot, 0);
              if (a.top.x < 0.13 || a.top.x > 0.25 || a.foot.x > 0.26 || a.top.y < 0.08 || a.foot.y > 0.86) continue;
              if (a.mesa.y < 0.05 || a.mesa.y > 0.16) continue;
              if (!(a.domes.x > 0.02 && a.domes.x < 0.27)) continue;
              const b = frame(shot, 1);
              if (b.top.y < 0.08 || b.mesa.y < 0.05 || b.mesa.y > 0.3 || b.top.x < 0.12) continue;
              const c = frame(shot, 2);
              if (c.top.y < 0.09 || c.top.y > 0.22 || c.mesa.y < 0.05 || c.mesa.y > 0.2) continue;
              let score = 0;
              if (a.lander.x < 0.96 && a.lander.x > 0.71) score += 1;
              if (a.padNE.x < 0.96 && a.padNE.x > 0.71) score += 1;
              if (b.domes.x > 0.02 && b.domes.y < 0.44) score += 1;
              if (c.domes.x > 0.02 && c.domes.y < 0.23) score += 1;
              const towerH = a.foot.y - a.top.y;
              score += Math.min(towerH, 0.6);
              out.push({ score, shot, a, b, c });
            }
out.sort((p, q) => q.score - p.score);
const f = (o) => `${o.x.toFixed(2)},${o.y.toFixed(2)}`;
for (const o of out.slice(0, 15)) {
  const { pos, tgt, fov } = o.shot;
  console.log(
    o.score.toFixed(2),
    `${pos}>${tgt}@${fov}`,
    `| 1280 top ${f(o.a.top)} foot ${f(o.a.foot)} domes ${f(o.a.domes)} lander ${f(o.a.lander)} mesa ${f(o.a.mesa)}`,
    `| 480 top ${f(o.b.top)} domes ${f(o.b.domes)} mesa ${f(o.b.mesa)}`,
    `| tall top ${f(o.c.top)} domes ${f(o.c.domes)} mesa ${f(o.c.mesa)}`,
  );
}
console.log('n', out.length);
