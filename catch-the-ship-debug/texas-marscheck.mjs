// Where an establishing shot puts the tower, the domes and the horizon at each title size, using the director's
// narrow-screen rule and the tall-screen view offset.
// Usage: node texas-marscheck.mjs "px,py,pz>tx,ty,tz@fov" [focus=45,0,0]
import * as THREE from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/build/three.module.js';

const [poseArg, focusArg = '45,0,0'] = process.argv.slice(2);
const [p, rest] = poseArg.split('>');
const [t, fovS] = rest.split('@');
const shot = { pos: p.split(',').map(Number), tgt: t.split(',').map(Number), focus: focusArg.split(',').map(Number), fov: Number(fovS) };
const SIZES = [
  { name: '1280x720', w: 1280, h: 720, clear: 'card x .29-.71 y .18-.82' },
  { name: '480x480', w: 480, h: 480, clear: 'clear above y .44' },
  { name: '390x844', w: 390, h: 844, clear: 'clear above y .23' },
];
for (const s of SIZES) {
  const lift = s.w / s.h < 0.8 ? 0.35 : 0;
  const aspect = s.w / (s.h * (1 + lift));
  const narrow = Math.max(1, 16 / 9 / aspect);
  const [fx, fy, fz] = shot.focus;
  const place = ([x, , z], scale, y) => new THREE.Vector3(fx + (x - fx) * scale, y, fz + (z - fz) * scale);
  const pos = place(shot.pos, narrow ** 0.4, shot.pos[1]);
  const tgt = place(shot.tgt, 1 / narrow, fy + (shot.tgt[1] - fy) / narrow);
  const cam = new THREE.PerspectiveCamera(shot.fov * narrow ** 0.15, s.w / s.h, 1, 20000);
  if (lift > 0) cam.setViewOffset(s.w, s.h * (1 + lift), 0, s.h * lift, s.w, s.h);
  cam.position.copy(pos);
  cam.lookAt(tgt);
  cam.updateMatrixWorld();
  const pr = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return `${((v.x + 1) / 2).toFixed(2)},${((1 - v.y) / 2).toFixed(2)}`;
  };
  const dir = new THREE.Vector3().subVectors(tgt, pos).setY(0).normalize();
  const far = (d, y) => pr(pos.x + dir.x * d, y, pos.z + dir.z * d);
  console.log(
    `${s.name} fov ${cam.fov.toFixed(1)} cam ${pos.toArray().map((n) => n.toFixed(0))} | tower top ${pr(44.75, 148, 0)} foot ${pr(44.75, 0, 0)} | domes ${pr(-170, 6, -254)} lander ${pr(372, 5, -262)} | horizon(3000,0) ${far(3000, 0)} mesa(1350,100) ${far(1350, 100)} | ${s.clear}`,
  );
}
