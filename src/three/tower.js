import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { instantiate } from './models.js';

export const TOWER_H = 148.5;
export const TOWER_HALF_M = 7;
const ARM_Z = 6.1;
const ARM_LEN = 31;
const ARM_W = 2.2;
const ARM_DEPTH = 3.2;
const OPEN_ANGLE = THREE.MathUtils.degToRad(30);

const UP = new THREE.Vector3(0, 1, 0);

function beamMatrix(a, b, thick, out) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return out.compose(mid, q, new THREE.Vector3(thick, len, thick));
}

function latticeTower(mat) {
  const h = TOWER_HALF_M;
  const corners = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const beams = [];
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const [x, z] of corners) beams.push([v(x, 0, z), v(x, TOWER_H, z), 1.5]);
  const bays = 20;
  const bay = TOWER_H / bays;
  for (let i = 0; i < bays; i++) {
    const ya = i * bay;
    const yb = ya + bay;
    for (let c = 0; c < 4; c++) {
      const [xa, za] = corners[c];
      const [xb, zb] = corners[(c + 1) % 4];
      beams.push([v(xa, yb, za), v(xb, yb, zb), 0.75]);
      beams.push([v(xa, ya, za), v(xb, yb, zb), 0.42]);
      beams.push([v(xb, ya, zb), v(xa, yb, za), 0.42]);
    }
    if (i % 4 === 1) {
      beams.push([v(-h, yb, -h), v(h, yb, h), 0.35]);
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(unit, mat, beams.length);
  const m = new THREE.Matrix4();
  beams.forEach(([a, b, t], i) => mesh.setMatrixAt(i, beamMatrix(a, b, t, m)));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function armGeometry() {
  const parts = [];
  const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  parts.push(bx(ARM_LEN, 0.7, ARM_W, ARM_LEN / 2, -0.35, 0));
  parts.push(bx(ARM_LEN * 0.9, 0.55, ARM_W * 0.8, (ARM_LEN * 0.9) / 2, -ARM_DEPTH + 0.3, 0));
  const step = 2.6;
  for (let x = 0.4, k = 0; x < ARM_LEN * 0.9; x += step, k++) {
    for (const z of [-ARM_W * 0.42, ARM_W * 0.42]) {
      parts.push(bx(0.32, ARM_DEPTH - 0.6, 0.3, x, -ARM_DEPTH / 2, z));
      const d = new THREE.BoxGeometry(0.24, Math.hypot(step, ARM_DEPTH - 0.6), 0.24);
      d.rotateZ((k % 2 ? 1 : -1) * Math.atan2(step, ARM_DEPTH - 0.6));
      d.translate(x + step / 2, -ARM_DEPTH / 2, z);
      if (x + step < ARM_LEN * 0.9) parts.push(d);
    }
  }
  parts.push(bx(1.2, ARM_DEPTH, ARM_W * 1.1, ARM_LEN - 0.6, -ARM_DEPTH / 2, 0));
  parts.push(bx(2.4, ARM_DEPTH + 1.2, ARM_W * 1.3, 1.2, -ARM_DEPTH / 2 + 0.2, 0));
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

function carriageGeometry() {
  const h = TOWER_HALF_M + 1.4;
  const parts = [];
  const bx = (w, hh, d, x, y, z) => new THREE.BoxGeometry(w, hh, d).translate(x, y, z);
  for (const x of [-h, h]) for (const z of [-h, h]) parts.push(bx(1.1, 10, 1.1, x, -3, z));
  for (const y of [1.6, -7.6]) {
    parts.push(bx(2 * h + 1.1, 0.9, 0.9, 0, y, -h));
    parts.push(bx(2 * h + 1.1, 0.9, 0.9, 0, y, h));
    parts.push(bx(0.9, 0.9, 2 * h + 1.1, -h, y, 0));
    parts.push(bx(0.9, 0.9, 2 * h + 1.1, h, y, 0));
  }
  parts.push(bx(1.6, 7.4, 2 * h - 2, -h - 0.4, -3, 0));
  for (const z of [-ARM_Z, ARM_Z]) parts.push(new THREE.CylinderGeometry(0.75, 0.75, 6.5, 16).translate(-h - 0.9, -1.8, z));
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

export function createTowerMaterials() {
  return {
    lattice: new THREE.MeshStandardMaterial({ color: 0x5b5f66, metalness: 0.75, roughness: 0.5 }),
    arm: new THREE.MeshStandardMaterial({ color: 0x9da3ab, metalness: 0.6, roughness: 0.42 }),
    carriage: new THREE.MeshStandardMaterial({ color: 0x6f747c, metalness: 0.7, roughness: 0.45 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x77756f, metalness: 0, roughness: 0.9 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.1, roughness: 0.7 }),
  };
}

function addProceduralStructure(root, mats, side) {
  const lattice = latticeTower(mats.lattice);
  root.add(lattice);

  const base = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 20), mats.concrete);
  base.position.y = 1.2;
  base.receiveShadow = true;
  base.castShadow = true;
  root.add(base);

  const top = new THREE.Mesh(new THREE.BoxGeometry(17, 1.4, 17), mats.carriage);
  top.position.y = TOWER_H + 0.7;
  top.castShadow = true;
  root.add(top);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 22, 10), mats.lattice);
  mast.position.set(side * 3, TOWER_H + 12, 3);
  root.add(mast);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(24, 0.9, 0.9), mats.lattice);
  boom.position.set(-side * 6, TOWER_H + 6, -3);
  boom.rotation.z = side * 0.18;
  boom.castShadow = true;
  root.add(boom);

  for (const z of [-4.2, 4.2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.9, TOWER_H - 18, 0.9), mats.carriage);
    rail.position.set(side * (TOWER_HALF_M + 0.5), (TOWER_H - 18) / 2 + 12, z);
    rail.castShadow = true;
    root.add(rail);
  }
}

function addProceduralArm(pivot, mats, armGeo) {
  const arm = new THREE.Mesh(armGeo, mats.arm);
  arm.castShadow = true;
  arm.receiveShadow = true;
  pivot.add(arm);
  const reach = 26 - (TOWER_HALF_M + 1.4);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(7, 0.35, ARM_W * 0.9), mats.pad);
  pad.position.set(reach, 0.12, 0);
  pivot.add(pad);
  const stay = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.carriage);
  stay.applyMatrix4(beamMatrix(new THREE.Vector3(0, 5.5, 0), new THREE.Vector3(11, -0.3, 0), 0.45, new THREE.Matrix4()));
  stay.castShadow = true;
  pivot.add(stay);
}

/**
 * side = -1: arms reach toward -X (tower right of its lane); side = +1: arms reach toward +X.
 * The tower group's origin is the tower base center. model: the loaded tower.glb scene (built for side = -1
 * and mirrored for side = +1); without it the tower is built procedurally.
 */
export function createTower(mats, side, model = null) {
  const root = new THREE.Group();
  if (model) {
    const structure = instantiate(model.getObjectByName('towerStatic'), mats);
    structure.scale.x = -side;
    root.add(structure);
  } else {
    addProceduralStructure(root, mats, side);
  }

  // Aviation lights (emissive, bloom), blinked by the view.
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.25, 0.15), toneMapped: false });
  const lights = [];
  const lightGeo = new THREE.SphereGeometry(0.55, 12, 8);
  for (const [x, y, z] of [
    [side * 3, TOWER_H + 23.2, 3],
    [TOWER_HALF_M, TOWER_H + 1.6, TOWER_HALF_M],
    [-TOWER_HALF_M, TOWER_H + 1.6, -TOWER_HALF_M],
    [TOWER_HALF_M, TOWER_H * 0.5, -TOWER_HALF_M],
    [-TOWER_HALF_M, TOWER_H * 0.5, TOWER_HALF_M],
  ]) {
    const l = new THREE.Mesh(lightGeo, lightMat);
    l.position.set(x, y, z);
    root.add(l);
    lights.push(l);
  }

  // Carriage + arms (moved vertically by the view).
  const carriage = new THREE.Group();
  const cg = model ? instantiate(model.getObjectByName('carriage'), mats) : new THREE.Mesh(carriageGeometry(), mats.carriage);
  cg.scale.x = -side;
  cg.castShadow = true;
  cg.receiveShadow = true;
  carriage.add(cg);
  const workMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.4, 1.25), toneMapped: false });
  for (const z of [-3, 3]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 1.6), workMat);
    panel.position.set(side * (TOWER_HALF_M + 2.3), 2.4, z);
    carriage.add(panel);
  }

  const armNode = model?.getObjectByName('arm');
  const armGeo = armNode ? null : armGeometry();
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 2.4), toneMapped: false });
  const arms = [];
  for (const zSign of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (TOWER_HALF_M + 1.4), 0, zSign * ARM_Z);
    if (armNode) pivot.add(instantiate(armNode, mats, (role) => role !== 'pad'));
    else addProceduralArm(pivot, mats, armGeo);
    for (const zz of [-ARM_W * 0.52, ARM_W * 0.52]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(ARM_LEN * 0.82, 0.16, 0.14), glowMat);
      strip.position.set(ARM_LEN * 0.5, -0.2, zz);
      pivot.add(strip);
    }
    carriage.add(pivot);
    arms.push({ pivot, zSign });
  }
  root.add(carriage);

  const spot = new THREE.SpotLight(0xdfe8ff, 0, 90, THREE.MathUtils.degToRad(42), 0.9, 1.2);
  spot.position.set(side * (TOWER_HALF_M + 3), 6, 0);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(side * 26, -6, 0);
  carriage.add(spot, spotTarget);
  spot.target = spotTarget;

  const baseYaw = side === -1 ? Math.PI : 0;
  return {
    root,
    carriage,
    lights,
    lightMat,
    glowMat,
    spot,
    setArms(open, armTopY) {
      carriage.position.y = armTopY;
      const theta = open * OPEN_ANGLE;
      for (const a of arms) a.pivot.rotation.y = baseYaw - side * a.zSign * theta;
    },
  };
}
