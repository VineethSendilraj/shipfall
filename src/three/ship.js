import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { instantiate } from './models.js';
import { createPlume } from './effects.js';
import { createRng } from '../rng.js';

// Ship geometry in meters, catch pins' undersides at y = 0 (same numbers as blender/build_models.py).
export const R = 4.5;
export const SHIP_ENGINE_Y = -35;
const TIP = 15.5;
const NOSE_BASE = 1.9;
export const SKIRT = -32.9;
const SKIN_M = 71; // meters per texture height of the booster skin, which the ship's steel shares
const TILE_UV_M = 64; // meters per UV unit on ship.glb's tiles
const HINGE = THREE.MathUtils.degToRad(-72); // front flap hinges; the tiles cover the half between the hinges
export const WIND = HINGE + Math.PI / 2;
const TILE_A0 = HINGE + THREE.MathUtils.degToRad(3);
const TILE_A1 = HINGE + THREE.MathUtils.degToRad(177);
// Hex tiles, pointy side up, of circumradius HEX_M; the texture repeats every HEX_COLS x 2 * HEX_ROW_PAIRS tiles.
const HEX_M = 0.2;
const HEX_COLS = 7;
const HEX_ROW_PAIRS = 4;

function hexPath(g, cx, cy, rx, ry) {
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  g.closePath();
}

/** Black heat-shield tiles with thin gaps: color, roughness and bump maps that tile seamlessly. */
function tileTextures() {
  const S = 512;
  const rng = createRng(1907);
  const canvases = [0, 1, 2].map(() => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return c;
  });
  const [g, rg, bg] = canvases.map((c) => c.getContext('2d'));
  const colW = S / HEX_COLS;
  const rowH = S / (2 * HEX_ROW_PAIRS);
  const rx = colW / Math.sqrt(3);
  const ry = rowH / 1.5;
  g.fillStyle = '#060606';
  g.fillRect(0, 0, S, S);
  rg.fillStyle = 'rgb(240,240,240)';
  rg.fillRect(0, 0, S, S);
  bg.fillStyle = 'rgb(40,40,40)';
  bg.fillRect(0, 0, S, S);
  for (let r = 0; r < 2 * HEX_ROW_PAIRS; r++) {
    for (let c = 0; c < HEX_COLS; c++) {
      const l = rng.chance(0.06) ? rng.range(34, 44) : rng.range(15, 24);
      const warm = rng.range(-1.5, 1.5);
      const rough = Math.round(rng.range(150, 200));
      const cx = (c + 0.5 * (r % 2)) * colW;
      const cy = r * rowH;
      // Draw each tile at its wrapped copies too, so the texture repeats without seams.
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          const x = cx + ox;
          const y = cy + oy;
          if (x < -colW || x > S + colW || y < -rowH * 2 || y > S + rowH * 2) continue;
          hexPath(g, x, y, rx * 0.93, ry * 0.93);
          g.fillStyle = `rgb(${l + warm},${l},${l - warm})`;
          g.fill();
          hexPath(rg, x, y, rx * 0.93, ry * 0.93);
          rg.fillStyle = `rgb(${rough},${rough},${rough})`;
          rg.fill();
          hexPath(bg, x, y, rx * 0.95, ry * 0.95);
          bg.fillStyle = 'rgb(150,150,150)';
          bg.fill();
          hexPath(bg, x, y, rx * 0.84, ry * 0.84);
          bg.fillStyle = 'rgb(200,200,200)';
          bg.fill();
        }
      }
    }
  }
  const repeat = [TILE_UV_M / (HEX_COLS * Math.sqrt(3) * HEX_M), TILE_UV_M / (HEX_ROW_PAIRS * 3 * HEX_M)];
  return canvases.map((c, i) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 8;
    return t;
  });
}

/** The booster's materials plus the ship's heat-shield tiles. */
export function createShipMaterials(boosterMats) {
  const [map, roughnessMap, bumpMap] = tileTextures();
  return {
    ...boosterMats,
    tiles: new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.85, roughnessMap, bumpMap, bumpScale: 1.2, metalness: 0 }),
  };
}

/** Meridian (r, y) of the ogive nose, base to tip. */
function noseProfile(n = 24) {
  const L = TIP - NOSE_BASE;
  const rho = (R * R + L * L) / (2 * R);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const h = (L * i) / n;
    pts.push(new THREE.Vector2(Math.max(0.001, Math.sqrt(rho * rho - h * h) + R - rho), NOSE_BASE + h));
  }
  return pts;
}

/** UVs in meters / TILE_UV_M around the windward centreline, like ship.glb's tiles. */
function tileUVs(geo) {
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const t = THREE.MathUtils.euclideanModulo(Math.atan2(x, z) - WIND + Math.PI, Math.PI * 2) - Math.PI;
    uv.setXY(i, 0.5 + (t * Math.hypot(x, z)) / TILE_UV_M, (TIP - p.getY(i)) / TILE_UV_M);
  }
  return geo;
}

function flapGeometry(root, tip0, tip1, span, thick) {
  const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(span, -tip0), new THREE.Vector2(span, -tip1), new THREE.Vector2(0, -root)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  return g;
}

let shared = null;
function sharedGeometry() {
  if (shared) return shared;
  // Steel on the leeward side only, tucked 2 deg under each tile edge.
  const s0 = TILE_A1 - 0.035;
  const sLen = Math.PI * 2 - (TILE_A1 - TILE_A0) + 0.07;
  const barrel = new THREE.CylinderGeometry(R, R, NOSE_BASE - SKIRT, 72, 1, true, s0, sLen);
  barrel.translate(0, (NOSE_BASE + SKIRT) / 2, 0);
  const nose = new THREE.LatheGeometry(noseProfile(), 72, s0, sLen);
  // Skin texture at the booster's scale, from its clean top rows down.
  for (const g of [barrel, nose]) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) g.attributes.uv.setY(i, 1 - (TIP - p.getY(i)) / SKIN_M);
    g.computeTangents();
  }
  const tilesBarrel = new THREE.CylinderGeometry(R + 0.04, R + 0.04, NOSE_BASE - SKIRT, 48, 8, true, TILE_A0, TILE_A1 - TILE_A0);
  tilesBarrel.translate(0, (NOSE_BASE + SKIRT) / 2, 0);
  const tipProfile = noseProfile().map((v) => new THREE.Vector2(v.x + 0.04, v.y));
  const tilesNose = new THREE.LatheGeometry(tipProfile, 48, TILE_A0, TILE_A1 - TILE_A0);
  const tiles = mergeGeometries([tileUVs(tilesBarrel), tileUVs(tilesNose)]);
  const shield = new THREE.CircleGeometry(R, 64);
  shield.rotateX(Math.PI / 2);
  shield.translate(0, SKIRT, 0);
  const pin = new THREE.BoxGeometry(1.5, 0.9, 1.3).translate(0, 0.45, 0);
  const slBell = new THREE.CylinderGeometry(0.3, 0.64, SKIRT - SHIP_ENGINE_Y, 20, 1, true).translate(0, (SKIRT + SHIP_ENGINE_Y) / 2, 0);
  const vacBell = new THREE.CylinderGeometry(0.62, 1.2, SKIRT + 0.3 - SHIP_ENGINE_Y, 28, 1, true).translate(0, (SKIRT + 0.3 + SHIP_ENGINE_Y) / 2, 0);
  const throat = new THREE.CircleGeometry(0.58, 18);
  throat.rotateX(Math.PI / 2);
  throat.translate(0, SHIP_ENGINE_Y + 0.04, 0);
  shared = {
    barrel,
    nose,
    tiles,
    shield,
    pin,
    slBell,
    vacBell,
    throat,
    forwardFlap: flapGeometry(7.9, 3.3, 6.9, 3.2, 0.4),
    aftFlap: flapGeometry(11.3, 2.6, 9.3, 4.5, 0.5),
  };
  return shared;
}

/** Simple ship for when ship.glb is missing: steel body and nose, windward tiles, flaps, pins and bells. */
function proceduralShip(mats, throatMat) {
  const geo = sharedGeometry();
  const root = new THREE.Group();
  const add = (g, m, cast = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  add(geo.barrel, mats.steel);
  add(geo.nose, mats.steel);
  add(geo.tiles, mats.tiles);
  add(geo.shield, mats.soot, false);
  for (const zs of [1, -1]) {
    const pin = add(geo.pin, mats.pin);
    pin.rotation.y = Math.PI / 2;
    pin.position.set(0, 0, zs * (R + 0.55));
  }
  // Flaps at the edges of the tiles, swung 5 deg back toward the leeward side; the forward hinge leans in
  // with the nose.
  for (const [h, swing] of [
    [HINGE, -0.087],
    [HINGE + Math.PI, 0.087],
  ]) {
    for (const [g, r, y, lean] of [
      [geo.forwardFlap, 2.75, 10.8, 0.22],
      [geo.aftFlap, R, -20.6, 0],
    ]) {
      const flap = add(g, mats.tiles);
      flap.position.set(Math.sin(h) * r, y, Math.cos(h) * r);
      flap.rotation.set(0, h + swing - Math.PI / 2, lean);
    }
  }
  for (let i = 0; i < 3; i++) {
    const a = THREE.MathUtils.degToRad(30 + 120 * i);
    const sl = add(geo.slBell, mats.bell, false);
    sl.position.set(Math.cos(a) * 1.15, 0, Math.sin(a) * 1.15);
    const glow = add(geo.throat, throatMat, false);
    glow.position.copy(sl.position);
    const v = THREE.MathUtils.degToRad(90 + 120 * i);
    add(geo.vacBell, mats.bell, false).position.set(Math.cos(v) * 2.95, 0, Math.sin(v) * 2.95);
  }
  return root;
}

const MODEL_NO_SHADOW = new Set(['inner', 'bell', 'throat']);

/** Lathe angle (from +z toward +x) of the middle of the tiles once turned: they face away from a tower on the +x side. */
export const TILES_AT = -Math.PI / 2;
/** How far the hull, tiles and flaps are turned about the axis from their modeled angle (WIND). */
export const SPIN = TILES_AT - WIND;

/**
 * model: the loaded ship.glb scene; without it the ship is built procedurally.
 * Everything but the catch pins sits in `spin`, turned so the tiles face away from the tower; the pins stay on the +-z arms.
 */
export function createShip(mats, model = null) {
  const throatMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
  const built = model ? instantiate(model, { ...mats, throat: throatMat }, (role) => !MODEL_NO_SHADOW.has(role)) : proceduralShip(mats, throatMat);
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  spin.add(built);
  const pins = [];
  built.traverse((o) => o.isMesh && (o.userData.role === 'pin' || o.material === mats.pin) && pins.push(o));
  for (const pin of pins) root.attach(pin);
  spin.rotation.y = SPIN;
  return { root, spin, throatMat };
}

/** Turns the tiles away from the tower on side `towerSide` (+1: +x, -1: -x). */
export function faceTower(ship, towerSide) {
  ship.spin.rotation.y = towerSide * TILES_AT - WIND;
}

/** Landing-burn plume from the three sea-level engines at the center: the booster's plume, narrower. */
export function createShipPlume() {
  const plume = createPlume();
  plume.group.position.y = SHIP_ENGINE_Y;
  plume.group.scale.set(0.38, 1, 0.38);
  return plume;
}
