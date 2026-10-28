import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const R = 4.5;
const BODY_TOP = 8;
const BODY_BOTTOM = -63;
export const ENGINE_Y = -67.6;

function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function gridFinGeometry() {
  const w = 4.4;
  const h = 5.6;
  const d = 0.75;
  const f = 0.32;
  const b = 0.14;
  const parts = [box(w, f, d, w / 2, h / 2 - f / 2), box(w, f, d, w / 2, -h / 2 + f / 2), box(f, h, d, f / 2), box(f, h, d, w - f / 2)];
  // Diagonal lattice bars, each clipped to the frame rectangle.
  const x0 = 0;
  const x1 = w;
  const y0 = -h / 2;
  const y1 = h / 2;
  const clip = (px, py, vx, vy) => {
    let t0 = -1e3;
    let t1 = 1e3;
    for (const [p, q] of [[-vx, px - x0], [vx, x1 - px], [-vy, py - y0], [vy, y1 - py]]) {
      if (Math.abs(p) < 1e-9) continue;
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    return t1 > t0 ? [px + vx * t0, py + vy * t0, px + vx * t1, py + vy * t1] : null;
  };
  const spacing = 0.62;
  for (const dir of [1, -1]) {
    for (let k = -12; k <= 12; k++) {
      const seg = clip(w / 2 + k * spacing * Math.SQRT2, 0, 1, dir);
      if (!seg) continue;
      const [ax, ay, cx, cy] = seg;
      const len = Math.hypot(cx - ax, cy - ay);
      if (len < 0.25) continue;
      const g = new THREE.BoxGeometry(b, len, d * 0.9);
      g.rotateZ(Math.atan2(cy - ay, cx - ax) - Math.PI / 2);
      g.translate((ax + cx) / 2, (ay + cy) / 2, 0);
      parts.push(g);
    }
  }
  parts.push(box(0.9, 1.6, 1.3, -0.3, 0, 0));
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

let shared = null;
function sharedGeometry() {
  if (shared) return shared;
  const body = new THREE.CylinderGeometry(R, R, BODY_TOP - BODY_BOTTOM, 112, 1, true);
  body.translate(0, (BODY_TOP + BODY_BOTTOM) / 2, 0);
  const skirt = new THREE.CylinderGeometry(R * 1.01, R * 1.07, 4.2, 112, 1, true);
  skirt.translate(0, BODY_BOTTOM - 2.1, 0);
  const shield = new THREE.CircleGeometry(R * 1.07, 64);
  shield.rotateX(Math.PI / 2);
  shield.translate(0, BODY_BOTTOM - 4.2, 0);
  const band = new THREE.CylinderGeometry(R * 1.005, R * 1.005, 0.7, 112, 1, true);
  const bands = mergeGeometries([band.clone().translate(0, BODY_TOP + 0.35, 0), band.clone().translate(0, BODY_TOP + 3.1, 0)]);
  const inner = new THREE.CylinderGeometry(R * 0.86, R * 0.86, 3.4, 48, 1, false);
  inner.translate(0, BODY_TOP + 1.7, 0);
  const dome = new THREE.SphereGeometry(R, 72, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.24, 1);
  dome.translate(0, BODY_TOP + 3.45, 0);
  const strut = new THREE.BoxGeometry(0.42, 2.1, 0.55);
  const bell = new THREE.CylinderGeometry(0.36, 0.58, 1.7, 24, 1, true);
  const throat = new THREE.CircleGeometry(0.5, 20);
  throat.rotateX(Math.PI / 2);
  const pin = mergeGeometries([box(1.5, 0.9, 1.3, 0, 0.45, 0), box(0.5, 1.6, 1.0, -0.5, 1.0, 0)]);
  const raceway = box(0.8, 66, 0.6, 0, -27, 0);
  const conduit = box(0.35, 60, 0.35, 0, -30, 0);
  shared = { body, skirt, shield, bands, inner, dome, strut, bell, throat, fin: gridFinGeometry(), pin, raceway, conduit };
  return shared;
}

export function createBoosterMaterials(skin, envIntensity = 1) {
  return {
    steel: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: skin.map,
      metalness: 1,
      roughness: 0.72,
      roughnessMap: skin.roughnessMap,
      bumpMap: skin.bumpMap,
      bumpScale: 1.5,
      anisotropy: 0.8,
      envMapIntensity: envIntensity * 1.6,
    }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a3b3e, metalness: 0.85, roughness: 0.55 }),
    soot: new THREE.MeshStandardMaterial({ color: 0x1c1a19, metalness: 0.6, roughness: 0.85 }),
    fin: new THREE.MeshStandardMaterial({ color: 0x8a8d93, metalness: 0.9, roughness: 0.42 }),
    inner: new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.4, roughness: 0.9 }),
    pin: new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 0.9, roughness: 0.35 }),
    dome: new THREE.MeshStandardMaterial({ color: 0x8b8f96, metalness: 0.85, roughness: 0.62 }),
  };
}

export function createBooster(mats) {
  const geo = sharedGeometry();
  const root = new THREE.Group();
  const add = (g, m, cast = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  add(geo.body, mats.steel);
  add(geo.skirt, mats.soot);
  add(geo.shield, mats.soot, false);
  add(geo.bands, mats.dome);
  add(geo.inner, mats.inner, false);
  add(geo.dome, mats.dome);

  const struts = new THREE.InstancedMesh(geo.strut, mats.darkSteel, 40);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m.compose(new THREE.Vector3(Math.cos(a) * R * 0.97, BODY_TOP + 1.72, Math.sin(a) * R * 0.97), q, new THREE.Vector3(1, 1, 1));
    struts.setMatrixAt(i, m);
  }
  struts.castShadow = true;
  root.add(struts);

  for (const deg of [45, 135, 225, 315]) {
    const a = THREE.MathUtils.degToRad(deg);
    const fin = new THREE.Mesh(geo.fin, mats.fin);
    fin.position.set(Math.cos(a) * R, 3.6, -Math.sin(a) * R);
    fin.rotation.y = a;
    fin.castShadow = true;
    fin.receiveShadow = true;
    root.add(fin);
  }
  for (const deg of [90, 270]) {
    const a = THREE.MathUtils.degToRad(deg);
    const pin = new THREE.Mesh(geo.pin, mats.pin);
    pin.position.set(Math.cos(a) * (R + 0.55), 0, -Math.sin(a) * (R + 0.55));
    pin.rotation.y = a;
    pin.castShadow = true;
    root.add(pin);
  }
  const race = new THREE.Mesh(geo.raceway, mats.darkSteel);
  const ra = THREE.MathUtils.degToRad(200);
  race.position.set(Math.cos(ra) * (R + 0.2), 0, -Math.sin(ra) * (R + 0.2));
  race.rotation.y = ra;
  race.castShadow = true;
  root.add(race);
  for (const deg of [20, 330]) {
    const ca = THREE.MathUtils.degToRad(deg);
    const c = new THREE.Mesh(geo.conduit, mats.darkSteel);
    c.position.set(Math.cos(ca) * (R + 0.12), 0, -Math.sin(ca) * (R + 0.12));
    root.add(c);
  }

  // 33 engines: 3 center, 10 inner ring, 20 outer ring.
  const layout = [];
  for (let i = 0; i < 3; i++) layout.push([0.95, (i / 3) * Math.PI * 2 + 0.3]);
  for (let i = 0; i < 10; i++) layout.push([2.35, (i / 10) * Math.PI * 2]);
  for (let i = 0; i < 20; i++) layout.push([3.72, (i / 20) * Math.PI * 2 + 0.08]);
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x2c2b2a, metalness: 0.9, roughness: 0.45, side: THREE.DoubleSide });
  const throatMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
  const bells = new THREE.InstancedMesh(geo.bell, bellMat, 33);
  const throats = new THREE.InstancedMesh(geo.throat, throatMat, 33);
  const one = new THREE.Vector3(1, 1, 1);
  layout.forEach(([r, a], i) => {
    m.compose(new THREE.Vector3(Math.cos(a) * r, ENGINE_Y + 0.85, Math.sin(a) * r), new THREE.Quaternion(), one);
    bells.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(Math.cos(a) * r, ENGINE_Y + 0.02, Math.sin(a) * r), new THREE.Quaternion(), one);
    throats.setMatrixAt(i, m);
  });
  root.add(bells, throats);

  return { root, throatMat };
}
