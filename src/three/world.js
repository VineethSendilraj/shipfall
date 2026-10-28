import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { concrete, puffNoise } from './textures.js';
import { createRng, hash01 } from '../rng.js';
import { instantiate } from './models.js';
import { buildMars } from './mars.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (c) => new THREE.Color().setRGB(...c);

// ---------------------------------------------------------------- time of day

/**
 * Hour at Starbase (local solar time, 0-24). The sun, sky, light, haze, floodlights and stars all follow from
 * it through siteLighting(). `?tod=19` previews another hour.
 */
const TIME_OF_DAY = (() => {
  const asked = Number.parseFloat(new URLSearchParams(globalThis.location?.search).get('tod'));
  return Number.isFinite(asked) ? ((asked % 24) + 24) % 24 : 14.5;
})();
const LATITUDE = THREE.MathUtils.degToRad(26);
const DECLINATION = THREE.MathUtils.degToRad(10);
// After dark the key light is skyglow over the bay: a sun below the horizon would light everything from beneath.
const NIGHT_KEY = new THREE.Vector3(-0.42, 0.36, -0.83).normalize();
// Lit from lower than this, the steel and the lattice catch grazing glints that flicker from frame to frame.
const MIN_KEY_UP = THREE.MathUtils.degToRad(12);

/**
 * The site's light by sun elevation in degrees; siteLighting() interpolates between rows. Colours are linear
 * RGB. key is the sunlight colour (times keyI); zenith, horizon and glow (around the sun) make the sky; hemi
 * and fill are extra sky light and light from the camera side; env scales the sky's reflections and light;
 * fog is the haze density; floods and stars fade the site lights and the stars in.
 */
const LIGHTING = [
  { el: -14, key: [0.6, 0.66, 0.82], keyI: 1, zenith: [0.0035, 0.0055, 0.016], horizon: [0.05, 0.045, 0.07], glow: [0, 0, 0], hemi: [0.055, 0.092, 0.26], fill: [0.1, 0.114, 0.144], env: 0.8, fog: 0.0011, floods: 1, stars: 1 },
  { el: -5, key: [0.55, 0.6, 0.85], keyI: 0.5, zenith: [0.01, 0.022, 0.07], horizon: [0.16, 0.11, 0.12], glow: [0.35, 0.12, 0.04], hemi: [0.05, 0.07, 0.15], fill: [0.08, 0.08, 0.1], env: 0.8, fog: 0.0006, floods: 1, stars: 0.3 },
  { el: 0, key: [1, 0.45, 0.18], keyI: 1, zenith: [0.025, 0.055, 0.2], horizon: [0.6, 0.36, 0.28], glow: [1.2, 0.45, 0.12], hemi: [0.06, 0.06, 0.1], fill: [0.15, 0.1, 0.08], env: 0.8, fog: 0.0003, floods: 0.4, stars: 0 },
  { el: 7, key: [1, 0.7, 0.42], keyI: 2, zenith: [0.035, 0.12, 0.5], horizon: [0.55, 0.6, 0.8], glow: [0.8, 0.45, 0.18], hemi: [0.05, 0.07, 0.12], fill: [0.25, 0.2, 0.16], env: 0.9, fog: 0.00018, floods: 0, stars: 0 },
  { el: 22, key: [1, 0.9, 0.78], keyI: 2.6, zenith: [0.045, 0.17, 0.72], horizon: [0.42, 0.78, 1.4], glow: [0.35, 0.28, 0.18], hemi: [0.05, 0.08, 0.14], fill: [0.15, 0.135, 0.12], env: 1, fog: 0.0001, floods: 0, stars: 0 },
  { el: 45, key: [1, 0.96, 0.9], keyI: 2.8, zenith: [0.05, 0.2, 0.85], horizon: [0.4, 0.8, 1.5], glow: [0.15, 0.13, 0.1], hemi: [0.05, 0.08, 0.14], fill: [0.15, 0.14, 0.125], env: 1, fog: 0.00008, floods: 0, stars: 0 },
];

// Particle and explosion colours by night and by day (white deluge steam, a bright sun on the smoke).
const NIGHT_FX = {
  dust: [0.34, 0.3, 0.26],
  smoke: [0.085, 0.085, 0.09],
  vapor: [0.55, 0.58, 0.62],
  boomSmoke: [0.075, 0.07, 0.068],
  boomDust: [0.42, 0.37, 0.31],
  ambient: [0.2, 0.16, 0.13],
  key: [0.25, 0.27, 0.33],
  ring: [1.0, 0.72, 0.45],
};
const DAY_FX = {
  dust: [0.72, 0.71, 0.69],
  smoke: [0.3, 0.29, 0.28],
  vapor: [0.8, 0.82, 0.86],
  boomSmoke: [0.06, 0.055, 0.05],
  boomDust: [0.46, 0.41, 0.35],
  ambient: [0.42, 0.48, 0.58],
  key: [1.2, 1.15, 1.08],
  ring: [1.0, 0.85, 0.65],
};
// Average albedo of the ground around the site (linear), for what the sky and the steel see below the horizon.
const GROUND_ALBEDO = [0.2, 0.16, 0.1];

/** Unit vector toward the sun at `hour`. North is -z and east +x, so the bay lies behind the towers. */
function sunDirection(hour) {
  const h = THREE.MathUtils.degToRad((hour - 12) * 15);
  const up = Math.sin(LATITUDE) * Math.sin(DECLINATION) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(h);
  const north = Math.cos(LATITUDE) * Math.sin(DECLINATION) - Math.sin(LATITUDE) * Math.cos(DECLINATION) * Math.cos(h);
  return new THREE.Vector3(-Math.cos(DECLINATION) * Math.sin(h), up, -north);
}

function lightingRow(el) {
  const i = LIGHTING.findIndex((r) => r.el > el);
  if (i === 0) return LIGHTING[0];
  if (i < 0) return LIGHTING.at(-1);
  const a = LIGHTING[i - 1];
  const b = LIGHTING[i];
  const t = (el - a.el) / (b.el - a.el);
  return Object.fromEntries(Object.keys(a).map((k) => [k, Array.isArray(a[k]) ? a[k].map((v, n) => lerp(v, b[k][n], t)) : lerp(a[k], b[k], t)]));
}

/** Everything the site's look takes from the hour: the LIGHTING row for the sun's elevation, and what follows. */
function siteLighting(hour) {
  const sun = sunDirection(hour);
  const el = THREE.MathUtils.radToDeg(Math.asin(sun.y));
  const row = lightingRow(el);
  const keyDir =
    el < -4
      ? NIGHT_KEY.clone()
      : sun.y < Math.sin(MIN_KEY_UP)
        ? new THREE.Vector3(sun.x, 0, sun.z).normalize().multiplyScalar(Math.cos(MIN_KEY_UP)).setY(Math.sin(MIN_KEY_UP))
        : sun.clone();
  const key = rgb(row.key);
  const zenith = rgb(row.zenith);
  const horizon = rgb(row.horizon);
  // Sunlit ground seen from above: sunlight plus the (half grey) sky, and the floodlit pad after dark.
  const sky = zenith.clone().lerp(horizon, 0.2);
  sky.lerp(new THREE.Color().setScalar(sky.r * 0.2126 + sky.g * 0.7152 + sky.b * 0.0722), 0.5);
  const ground = rgb(GROUND_ALBEDO)
    .multiply(key.clone().multiplyScalar((row.keyI * Math.max(sun.y, 0)) / Math.PI).add(sky.multiplyScalar(row.env)))
    .add(new THREE.Color(0.25, 0.19, 0.13).multiplyScalar(row.floods));
  const day = smooth(-6, 12, el);
  const fx = { keyDir, gravity: 9.81 };
  for (const k in DAY_FX) fx[k] = NIGHT_FX[k].map((v, n) => lerp(v, DAY_FX[k][n], day));
  return {
    ...row,
    sun,
    el,
    keyDir,
    key,
    zenith,
    horizon,
    glow: rgb(row.glow),
    hemi: rgb(row.hemi),
    fill: rgb(row.fill),
    ground,
    sea: horizon.clone().multiplyScalar(0.9),
    fx,
  };
}

const LIGHT = siteLighting(TIME_OF_DAY);

/** Particle and explosion colours for the site at its time of day (the defaults in effects.js are the night ones). */
export const STARBASE_FX = LIGHT.fx;
/** Unit vector toward the sun at the site's time of day. */
export const SUN_DIR = LIGHT.sun;

// ---------------------------------------------------------------- sky

// Clear sky: pale and hazy at the horizon, deeper blue overhead, brighter around the sun. Shared by the sky,
// its reflection environment and the water.
const SKY_GLSL = /* glsl */ `
uniform vec3 uSun; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow;
float skyAngle(vec3 d, vec3 s) { return 2.0 * asin(min(1.0, length(d - s) * 0.5)); }
vec3 siteSky(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-3.5 * h));
  float side = max(dot(normalize(d.xz + vec2(1e-6, 0.0)), normalize(uSun.xz + vec2(1e-6, 0.0))), 0.0);
  return col + uGlow * (0.7 * pow(max(dot(d, uSun), 0.0), 12.0) + 0.5 * side * side * side * exp(-8.0 * h));
}
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w;
  }`;

function skyUniforms() {
  return {
    uSun: { value: LIGHT.sun },
    uZenith: { value: LIGHT.zenith },
    uHorizon: { value: LIGHT.horizon },
    uGlow: { value: LIGHT.glow },
  };
}

function skyMaterial(sky) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sky,
      uTime: { value: 0 },
      uSunDisc: { value: LIGHT.key.clone().multiplyScalar(LIGHT.el > -1 ? 3 : 0) },
      uSea: { value: LIGHT.sea },
      uStars: { value: LIGHT.stars },
    },
    vertexShader: SKY_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSunDisc; uniform vec3 uSea; uniform float uStars;
      varying vec3 vDir;
      ${SKY_GLSL}
      float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = siteSky(d) + uSunDisc * smoothstep(0.0058, 0.0047, skyAngle(d, uSun));
        if (uStars > 0.0 && d.y > 0.0) {
          vec3 sp = d * 300.0; vec3 id = floor(sp);
          float sh = hash13(id);
          if (sh > 0.97) {
            vec3 off = vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3)) - 0.5;
            float s = smoothstep(0.17, 0.0, length(fract(sp) - 0.5 - off * 0.5)) * (sh - 0.97) / 0.03;
            col += vec3(0.9, 0.92, 1.0) * s * uStars * smoothstep(0.0, 0.2, d.y) * (0.8 + 0.2 * sin(uTime * 2.0 + sh * 80.0));
          }
        }
        if (d.y < 0.0) col = mix(col, uSea, smoothstep(0.0, -0.04, d.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

function siteEnvironment(renderer, sky) {
  const envScene = new THREE.Scene();
  const dome = new THREE.ShaderMaterial({
    uniforms: { ...sky, uGround: { value: LIGHT.ground } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform vec3 uGround;
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = siteSky(d);
        // Half grey: a saturated blue sky makes bare steel read as blue plastic.
        col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), 0.5);
        gl_FragColor = vec4(mix(col, uGround, smoothstep(0.03, -0.05, d.y)), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), dome));
  if (LIGHT.floods > 0) {
    const flood = new THREE.MeshBasicMaterial({ color: new THREE.Color(24, 18, 12).multiplyScalar(LIGHT.floods), side: THREE.DoubleSide });
    for (const [x, y, z] of [
      [62, 16, 26],
      [-86, 14, 20],
      [-22, 14, -46],
    ]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), flood);
      p.position.set(x, y, z);
      p.lookAt(0, 0, 0);
      envScene.add(p);
    }
  }
  return bakeEnvironment(renderer, envScene);
}

/** Prefilters a small scene into a PMREM environment, then frees the scene. Returns the render target. */
export function bakeEnvironment(renderer, envScene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  disposeTree(envScene);
  return rt;
}

/** Frees the GPU side of everything under `root` (geometries, materials, their textures, light shadow maps). */
export function disposeTree(root, keep = new Set()) {
  const done = new Set();
  const free = (x) => {
    if (!x || keep.has(x) || done.has(x)) return;
    done.add(x);
    x.dispose();
  };
  root.traverse((o) => {
    if (o.isLight) o.dispose();
    if (o.isInstancedMesh) o.dispose();
    free(o.geometry);
    for (const m of [o.material].flat()) {
      if (!m || keep.has(m)) continue;
      for (const v of Object.values(m)) if (v?.isTexture) free(v);
      for (const u of Object.values(m.uniforms ?? {})) if (u.value?.isTexture) free(u.value);
      free(m);
    }
  });
}

/** Procedural launch mount (behind the right-hand lane): six legs, a ring table and a flame deflector. */
export function launchMount(steel, concrete) {
  const olm = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2.6, 18, 2.6), concrete);
    leg.position.set(Math.cos(a) * 11, 9, Math.sin(a) * 11);
    leg.castShadow = leg.receiveShadow = true;
    olm.add(leg);
  }
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 4.5, 48, 1, false), steel);
  ring.position.y = 20;
  ring.castShadow = ring.receiveShadow = true;
  olm.add(ring);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 4.7, 32), new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 1 }));
  hole.position.y = 20;
  olm.add(hole);
  const clamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 2.2, 2), steel, 20);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    m.compose(new THREE.Vector3(Math.cos(a) * 6.2, 23.2, Math.sin(a) * 6.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), new THREE.Vector3(1, 1, 1));
    clamps.setMatrixAt(i, m);
  }
  olm.add(clamps);
  olm.position.set(-30, 0, -70);
  return { olm, dark: hole.material };
}

// ---------------------------------------------------------------- ground

// Concrete: the orbital launch pad, the tank farm, and the second tower's pad. x0, z0, x1, z1.
const PADS = [
  [-150, -108, 95, 40],
  [-310, -330, -25, -232],
  [-235, -830, -105, -690],
];
// Outbuildings: x, z, width, depth, height. The last three are the high bays down the road to the west.
const BUILDINGS = [
  [172, -30, 26, 14, 9],
  [168, -75, 18, 12, 7],
  [210, -140, 34, 22, 12],
  [150, -205, 22, 16, 8],
  [262, -215, 48, 36, 18],
  [300, -150, 40, 30, 12],
  [236, -280, 30, 24, 22],
  [-300, -150, 26, 18, 10],
  [-330, -200, 20, 14, 7],
  [-262, -716, 30, 20, 12],
  [-88, -802, 24, 16, 9],
  [-1250, -440, 120, 60, 40],
  [-1120, -420, 80, 50, 28],
  [-1380, -460, 60, 40, 22],
];
// Gravel: the horizontal tanks beside the pad, the deluge tanks, and a yard round every outbuilding.
const LOTS = [
  [55, -185, 135, -125],
  [-112, -170, -40, -118],
  ...BUILDINGS.map(([x, z, w, d]) => [x - w / 2 - 10, z - d / 2 - 10, x + w / 2 + 10, z + d / 2 + 10]),
];
// Highway 4 along the bay shore to the Gulf beach, and the road north to the second tower.
const ROAD = [
  [-2600, -395],
  [-280, -362],
  [180, -325],
  [420, -300],
  [900, -300],
  [1460, -320],
];
const SPUR = [
  [-215, -366],
  [-190, -690],
];
const TOWER_B = [-170, -760];

// Ground albedo (sRGB), warm enough to stay sand-coloured under the blue sky light.
const SAND = [0.52, 0.43, 0.28];
const MUD = [0.35, 0.29, 0.2];
const SCRUB = [0.45, 0.39, 0.23];
const VEG = [0.33, 0.36, 0.2];
const MARSH_GREEN = [0.28, 0.32, 0.17];
const MARSH_BROWN = [0.4, 0.34, 0.21];
const FLATS = [0.6, 0.55, 0.4];
const GRAVEL = [0.61, 0.57, 0.44];
const ASPHALT = [0.26, 0.25, 0.21];
const BEACH = [0.86, 0.78, 0.55];
const TOWN = [0.68, 0.64, 0.51];

// Site maps (x0, z0, size in m, texels): the near one covers the site and the bay shore, the far one the whole ground.
const NEAR_MAP = [-900, -1500, 1800, 384];
const FAR_MAP = [-5830, -5900, 11600, 256];
const GROUND_X = -30;
const GROUND_Z = -100;
const GROUND_R = 5600;

const hash2 = (i, j) => hash01(Math.imul(i, 374761393) ^ Math.imul(j, 668265263));

function vnoise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Value-noise fbm in [0, 1]. */
function fbm(x, y, octaves) {
  let s = 0;
  let w = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    s += w * vnoise2(x, y);
    total += w;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    w *= 0.5;
  }
  return s / total;
}

/**
 * The bay's south shore: north of the tank farm, swinging further north past the marsh to the west, with an
 * inlet of tidal flats reaching toward the pad on the east.
 */
const shoreZ = (x) => -480 - 600 * smooth(160, -320, x) + 220 * (vnoise2(x / 900, 1.7) - 0.5) + 250 * smooth(330, 520, x) * smooth(980, 760, x);
/** Centre line of the barrier island across the bay, with its town; the Gulf lies beyond it. */
const stripZ = (x) => -2700 + 90 * (vnoise2(x / 700, 3.1) - 0.5);

function polyDist(x, z, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0];
    const az = pts[i - 1][1];
    const dx = pts[i][0] - ax;
    const dz = pts[i][1] - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

function boxDist(x, z, boxes) {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of boxes) best = Math.min(best, Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)));
  return best;
}

function paint(out, c, t) {
  if (t <= 0) return;
  out.r += (c[0] - out.r) * t;
  out.g += (c[1] - out.g) * t;
  out.b += (c[2] - out.b) * t;
}

/**
 * The ground at (x, z): albedo (r, g, b, sRGB), water level w (0 dry, 0.5 the waterline, 1 deep) and height h.
 * `fine` adds the features too small for the far map: marsh channels and the puddles round the pad.
 */
function siteSample(x, z, out, fine) {
  // Metres into the Gulf, and into the bay (negative on land). The beach strip and the barrier island are land.
  const sz = stripZ(x);
  const gulf = Math.max(x - 1470 - 60 * (vnoise2(z / 400, 7.7) - 0.5), sz - 75 - z);
  const isle = Math.min(75 - Math.abs(z - sz), 1250 - x);
  const strip = Math.min(x - 1150, z + 2560, 1470 - x);
  const bay = Math.min(shoreZ(x) + 140 * (fbm(x / 260, z / 260, 3) - 0.5) - z, -isle, -strip);
  out.h = 0;
  if (gulf > 250 || bay > 650) {
    out.r = MUD[0];
    out.g = MUD[1];
    out.b = MUD[2];
    out.w = 1;
    return;
  }
  const site = smooth(470, 330, Math.hypot(x + 40, z - 80));
  const marsh = smooth(-380, -470, z) * smooth(220, 80, x) * (1 - site);

  out.r = SCRUB[0];
  out.g = SCRUB[1];
  out.b = SCRUB[2];
  paint(out, VEG, 0.75 * smooth(0.42, 0.62, fbm(x / 80 + 11, z / 80 - 6, 3)));
  paint(out, SAND, smooth(0.5, 0.68, fbm(x / 150 - 7, z / 150 + 5, 2)));
  let w = 0.5 * smooth(-40, 0, bay);
  if (site > 0) {
    // Sand and mud round the pad, with puddles in the low spots.
    paint(out, SAND, site * 0.6);
    paint(out, MUD, site * smooth(0.45, 0.62, fbm(x / 90 + 1, z / 90 - 4, 3)));
    if (fine) w = Math.max(w, site * 0.53 * smooth(0.5, 0.74, fbm(x / 48 + 3, z / 48 - 2, 3)));
  }
  if (marsh > 0) {
    // Green and brown marsh, ponds, and (close up) a web of tidal channels.
    paint(out, MARSH_GREEN, marsh);
    paint(out, MARSH_BROWN, marsh * smooth(0.35, 0.65, fbm(x / 120 + 9, z / 120 + 2, 3)));
    let wet = Math.max(0.3, 0.42 + 0.16 * smooth(0.62, 0.68, fbm(x / 150 - 3, z / 150 + 8, 3)));
    if (fine) wet = Math.max(wet, 0.42 + 0.16 * smooth(0.024, 0.012, Math.abs(fbm(x / 240 + 4, z / 240 - 9, 3) - 0.5)));
    w = Math.max(w, marsh * wet);
  }
  paint(out, FLATS, smooth(-70, -5, bay));
  paint(out, BEACH, Math.max(smooth(-110, -30, gulf), smooth(0, 12, isle)));
  if (isle > 0) paint(out, TOWN, smooth(20, 45, isle) * smooth(-1600, 200, x));
  if (bay > 0) {
    // Shallow over the flats near the shore and in patches out in the bay, with marsh islets here and there.
    const deep = smooth(0.25, 0.5, fbm(x / 500 + 2, z / 500 - 1, 2));
    w = 0.5 + 0.06 * smooth(0, 12, bay) + 0.44 * smooth(70, 520, bay) * deep;
    paint(out, FLATS, smooth(0, 15, bay));
    const islet = smooth(0.66, 0.72, fbm(x / 170 + 5, z / 170 - 3, 3)) * smooth(120, 260, bay);
    if (islet > 0) {
      w = lerp(w, 0.4, islet);
      paint(out, MARSH_GREEN, islet);
    }
  }
  if (gulf > 0) w = 0.5 + 0.06 * smooth(0, 12, gulf) + 0.44 * smooth(20, 200, gulf);

  // Roads, the gravel round the pads, and the yards: all dry and flat.
  const road = Math.min(polyDist(x, z, ROAD), polyDist(x, z, SPUR));
  const yard = Math.max(smooth(18, 6, boxDist(x, z, PADS)), smooth(6, 1, boxDist(x, z, LOTS)));
  const dry = Math.max(smooth(9, 5, road), yard);
  paint(out, GRAVEL, dry);
  paint(out, ASPHALT, smooth(4.5, 3, road));
  out.w = w * (1 - dry);

  // Low dunes in the scrub away from the water, and a foredune behind the Gulf beach.
  const dunes = smooth(-150, -350, bay) * (1 - marsh) * (1 - site) * 4 * smooth(0.4, 0.75, fbm(x / 130 + 2, z / 130 + 6, 3));
  const foredune = 5 * smooth(-200, -130, gulf) * smooth(-30, -90, gulf) * (isle > 0 ? 0 : 1);
  out.h = (dunes + foredune) * (1 - smooth(0.25, 0.45, w)) * (1 - dry);
}

/** Bakes siteSample() over a square into an RGBA texture: sRGB albedo, and the water level in alpha. */
function bakeSite([x0, z0, size, n], fine) {
  const data = new Uint8ClampedArray(n * n * 4);
  const s = {};
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      siteSample(x0 + ((i + 0.5) / n) * size, z0 + ((j + 0.5) / n) * size, s, fine);
      const o = (j * n + i) * 4;
      data[o] = s.r * 255;
      data[o + 1] = s.g * 255;
      data[o + 2] = s.b * 255;
      data[o + 3] = s.w * 255;
    }
  }
  const t = new THREE.DataTexture(data, n, n);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** One polar mesh out to the horizon, densest round the site. */
function groundGeometry() {
  const SEG = 240;
  const RINGS = 110;
  const pos = new Float32Array((RINGS + 1) * SEG * 3);
  const s = {};
  for (let j = 0; j <= RINGS; j++) {
    const r = GROUND_R * (j / RINGS) ** 2.2;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = GROUND_X + Math.cos(a) * r;
      const z = GROUND_Z + Math.sin(a) * r;
      siteSample(x, z, s, false);
      pos.set([x, s.h, z], (j * SEG + i) * 3);
    }
  }
  const idx = [];
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * SEG + i;
      const b = j * SEG + ((i + 1) % SEG);
      idx.push(a, b, a + SEG, b, b + SEG, a + SEG);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Lit ground that reads its albedo and water from the baked site maps, roughens both with tiled noise, and
 * gives the water a Fresnel reflection of the sky.
 */
function groundMaterial(sky) {
  const [nx, nz, ns] = NEAR_MAP;
  const [fx, fz, fs] = FAR_MAP;
  const uniforms = {
    ...sky,
    uSiteNear: { value: bakeSite(NEAR_MAP, true) },
    uSiteFar: { value: bakeSite(FAR_MAP, false) },
    uDetail: { value: puffNoise() },
    uNearBox: { value: new THREE.Vector4(nx, nz, 1 / ns, 1 / ns) },
    uFarBox: { value: new THREE.Vector4(fx, fz, 1 / fs, 1 / fs) },
    uShallow: { value: new THREE.Color().setRGB(0.035, 0.095, 0.16) },
    uDeep: { value: new THREE.Color().setRGB(0.006, 0.045, 0.15) },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSite;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSite = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vSite;
        uniform sampler2D uSiteNear; uniform sampler2D uSiteFar; uniform sampler2D uDetail;
        uniform vec4 uNearBox; uniform vec4 uFarBox; uniform vec3 uShallow; uniform vec3 uDeep;
        ${SKY_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 nearUv = (vSite.xz - uNearBox.xy) * uNearBox.zw;
        vec2 edge = abs(nearUv - 0.5);
        vec4 site = mix(texture2D(uSiteNear, nearUv), texture2D(uSiteFar, (vSite.xz - uFarBox.xy) * uFarBox.zw), smoothstep(0.44, 0.5, max(edge.x, edge.y)));
        vec4 dA = texture2D(uDetail, vSite.xz / 37.0);
        vec4 dB = texture2D(uDetail, vSite.xz / 4.3 + 0.37);
        // 0.5 is the waterline; the noise roughens the shores and opens puddles in damp ground.
        float level = site.a + (dA.r - 0.5) * 0.16 + (dB.g - 0.5) * 0.05;
        float lw = fwidth(level) + 1e-4;
        float water = smoothstep(0.5 - lw, 0.5 + lw, level);
        float damp = smoothstep(0.3, 0.5, level);
        float deep = smoothstep(0.55, 0.85, site.a);
        vec3 land = site.rgb * (0.86 + 0.28 * dA.b) * (0.93 + 0.14 * dB.r) * (1.0 - 0.4 * damp);
        diffuseColor.rgb *= mix(land, mix(uShallow, uDeep, deep), water);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.55, damp), 0.2, water);')
      // Dry sand and scrub barely reflect the sky (the full sheen greys them out at grazing angles); open water
      // reflects it below instead.
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nradiance *= mix(0.2, 1.0, damp) * (1.0 - water);')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        if (water > 0.0) {
          vec3 V = normalize(cameraPosition - vSite);
          vec2 tilt = (vec2(dA.g, dB.r) - 0.5) * mix(0.05, 0.2, deep);
          vec3 N = normalize(vec3(tilt.x, 1.0, tilt.y));
          // Ripples face the viewer more than a mirror would: less reflection, and of the bluer sky above the horizon.
          float F = 0.4 * (0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0));
          vec3 R = reflect(-V, N);
          R.y = max(abs(R.y), 0.5);
          outgoingLight = mix(outgoingLight, outgoingLight * (1.0 - F) + siteSky(normalize(R)) * F, water);
        }
        // Far ground fades into the horizon haze, so the edge of the ground never shows.
        outgoingLight = mix(outgoingLight, uHorizon, smoothstep(3600.0, 5200.0, distance(vSite, cameraPosition)));
        #include <opaque_fragment>`,
      );
  };
  // three ignores `uniforms` on its built-in materials; disposeTree() reads it to free the baked maps.
  mat.uniforms = uniforms;
  return mat;
}

function padGeometry([x0, z0, x1, z1], r = 6) {
  // Drawn in the XY plane with y = -z, then laid flat.
  const s = new THREE.Shape();
  const [a, b, c, d] = [x0, -z1, x1, -z0];
  s.moveTo(a + r, b);
  s.lineTo(c - r, b);
  s.quadraticCurveTo(c, b, c, b + r);
  s.lineTo(c, d - r);
  s.quadraticCurveTo(c, d, c - r, d);
  s.lineTo(a + r, d);
  s.quadraticCurveTo(a, d, a, d - r);
  s.lineTo(a, b + r);
  s.quadraticCurveTo(a, b, a + r, b);
  return new THREE.ShapeGeometry(s, 4).rotateX(-Math.PI / 2);
}

// ---------------------------------------------------------------- dressing

/** A square strut of thickness t from a to b. */
function strut(a, b, t) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.BoxGeometry(t, dir.length(), t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** Domed tank lying along x or z on two concrete saddles. */
function lyingTank(white, saddles, x, z, r, len, alongX) {
  const cap = new THREE.SphereGeometry(r, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1);
  const tank = mergeGeometries([new THREE.CylinderGeometry(r, r, len, 20, 1, true), cap.clone().translate(0, len / 2, 0), cap.rotateX(Math.PI).translate(0, -len / 2, 0)]);
  if (alongX) tank.rotateZ(Math.PI / 2);
  else tank.rotateX(Math.PI / 2);
  white.push(tank.translate(x, r + 1.2, z));
  for (const k of [-0.3, 0.3]) {
    const h = 1.2 + r * 0.6;
    saddles.push(new THREE.BoxGeometry(alongX ? 1.2 : r * 1.8, h, alongX ? r * 1.8 : 1.2).translate(x + (alongX ? k * len : 0), h / 2, z + (alongX ? 0 : k * len)));
  }
}

/** The second tower across the marsh: a bare lattice, and the yellow crawler crane that is stacking it. */
function towerB(root, lattice) {
  const [x0, z0] = TOWER_B;
  const H = 146;
  const h = 8;
  const v = (x, y, z) => new THREE.Vector3(x0 + x, y, z0 + z);
  const corners = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const parts = corners.map(([x, z]) => strut(v(x, 0, z), v(x, H, z), 2.2));
  const bays = 16;
  for (let i = 0; i < bays; i++) {
    const ya = (i * H) / bays;
    const yb = ((i + 1) * H) / bays;
    corners.forEach(([xa, za], c) => {
      const [xb, zb] = corners[(c + 1) % 4];
      parts.push(strut(v(xa, yb, za), v(xb, yb, zb), 1.2));
      parts.push(i % 2 ? strut(v(xa, ya, za), v(xb, yb, zb), 0.8) : strut(v(xb, ya, zb), v(xa, yb, za), 0.8));
    });
  }
  parts.push(new THREE.BoxGeometry(2 * h + 3, 3, 2 * h + 3).translate(x0, H + 1.5, z0));
  root.add(new THREE.Mesh(mergeGeometries(parts), lattice));

  const cx = x0 + 42;
  const cz = z0 + 12;
  const c = (x, y, z) => new THREE.Vector3(cx + x, y, cz + z);
  const yellow = [new THREE.BoxGeometry(11, 5, 7).translate(cx + 1.5, 6.5, cz), new THREE.BoxGeometry(3, 6, 7.5).translate(cx + 8, 6, cz)];
  const boom = THREE.MathUtils.degToRad(78);
  const foot = c(-3, 6, 0);
  yellow.push(strut(foot, foot.clone().add(new THREE.Vector3(-Math.cos(boom), Math.sin(boom), 0).multiplyScalar(118)), 2.6));
  yellow.push(strut(c(2, 9, 0), c(-4, 30, 0), 1.6));
  const dark = [new THREE.BoxGeometry(15, 2.4, 2.6).translate(cx, 1.2, cz - 3.6), new THREE.BoxGeometry(15, 2.4, 2.6).translate(cx, 1.2, cz + 3.6)];
  dark.push(new THREE.BoxGeometry(6, 1.6, 6).translate(cx, 3.2, cz));
  root.add(new THREE.Mesh(mergeGeometries(yellow), new THREE.MeshStandardMaterial({ color: 0xe8b41e, roughness: 0.55, metalness: 0.1 })));
  root.add(new THREE.Mesh(mergeGeometries(dark), new THREE.MeshStandardMaterial({ color: 0x2c2d2f, roughness: 0.8 })));
}

/** Low town along the barrier island, a few condo towers toward the pass. */
function farTown(root, rng) {
  const tints = [0xe9e6df, 0xd8d4cb, 0xcfd6dc, 0xe2d6c4, 0xbfc3c6];
  const boxes = tints.map(() => []);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < 240; i++) {
    const x = 1100 - 3700 * rng.next() ** 2;
    const tall = rng.chance(0.06);
    p.set(x, 0, stripZ(x) + rng.range(-35, 35));
    s.set(tall ? rng.range(14, 26) : rng.range(8, 22), tall ? rng.range(28, 60) : rng.range(4, 12), rng.range(8, 18));
    m.compose(p, q.setFromAxisAngle(UP, rng.range(-0.15, 0.15)), s);
    boxes[Math.floor(rng.next() * tints.length)].push(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).applyMatrix4(m));
  }
  // Merged per colour, not instanced with colours: that would be one more shader to rebuild when the second
  // tower's light comes on, a visible hitch.
  tints.forEach((c, i) => root.add(new THREE.Mesh(mergeGeometries(boxes[i]), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }))));
}

function siteDressing(root, rng, towerMats) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x8f949b, metalness: 0.6, roughness: 0.5 });
  const { olm, dark } = launchMount(steel, towerMats.concrete);
  root.add(olm);

  // Tank farm: white tanks behind the pad. The props model replaces the `tanks` group.
  const tanks = new THREE.Group();
  const tankSteel = new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 0.3, roughness: 0.38 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x7d8288, metalness: 0.6, roughness: 0.5 });
  const insulated = new THREE.MeshStandardMaterial({ color: 0xd9d8d3, metalness: 0, roughness: 0.8 });
  for (let i = 0; i < 9; i++) {
    const r = rng.range(3.2, 5.2);
    const hgt = rng.range(16, 30);
    const x = -220 + i * 12.5 + rng.range(-1.5, 1.5);
    const z = -262 + rng.range(-6, 6);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 32), tankSteel);
    tank.position.set(x, hgt / 2 + 1.5, z);
    tank.castShadow = true;
    tanks.add(tank);
    const head = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankSteel);
    head.scale.y = 0.35;
    head.position.set(x, hgt + 1.5, z);
    tanks.add(head);
    for (const fy of [0.3, 0.62]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.5, 32, 1, true), bandMat);
      band.position.set(x, 1.5 + hgt * fy, z);
      tanks.add(band);
    }
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.95, 1.5, 24), towerMats.concrete);
    skirt.position.set(x, 0.75, z);
    tanks.add(skirt);
  }
  const rack = new THREE.Mesh(new THREE.BoxGeometry(150, 0.7, 0.7), bandMat);
  rack.position.set(-150, 7, -250);
  tanks.add(rack);
  const rack2 = rack.clone();
  rack2.position.y = 8.4;
  tanks.add(rack2);
  for (let i = 0; i < 3; i++) {
    const x = -90 + i * 24;
    const sph = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 20), insulated);
    sph.position.set(x, 11.5, -300);
    sph.castShadow = true;
    tanks.add(sph);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 11, 8), bandMat);
      leg.position.set(x + Math.cos(a) * 7.4, 5.5, -300 + Math.sin(a) * 7.4);
      tanks.add(leg);
    }
  }
  root.add(tanks);

  // Lying tanks beside the pad and west of the farm, the tall deluge water tanks by the mount, and the pipe
  // rack that feeds the mount from the farm.
  const white = [];
  const footings = [];
  for (let i = 0; i < 6; i++) lyingTank(white, footings, 92, -138 - i * 6.2, 2.4, 24, true);
  for (let i = 0; i < 5; i++) lyingTank(white, footings, -296 + i * 7, -270, 2.8, 30, false);
  for (const [x, z, r, h] of [
    [-88, -140, 5, 26],
    [-66, -146, 4, 20],
  ]) {
    white.push(new THREE.CylinderGeometry(r, r, h, 28).translate(x, h / 2 + 0.6, z));
    white.push(new THREE.SphereGeometry(r, 28, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1).translate(x, h + 0.6, z));
    footings.push(new THREE.CylinderGeometry(r * 1.08, r * 1.12, 1.2, 28).translate(x, 0.6, z));
  }
  const pipes = [];
  const from = new THREE.Vector3(-66, 0, -232);
  const to = new THREE.Vector3(-46, 0, -86);
  const along = to.clone().sub(from);
  const len = along.length();
  along.normalize();
  const side = new THREE.Vector3(-along.z, 0, along.x);
  const at = (t, k, y) => from.clone().addScaledVector(along, t).addScaledVector(side, k).setY(y);
  for (let t = 0; t <= len; t += 9) {
    for (const k of [-1.8, 1.8]) pipes.push(strut(at(t, k, 0), at(t, k, 6.4), 0.4));
    pipes.push(strut(at(t, -2, 6), at(t, 2, 6), 0.35));
  }
  for (const [k, r] of [
    [-1, 0.45],
    [0, 0.6],
    [1, 0.45],
  ]) {
    pipes.push(strut(at(0, k, 6.6 + r), at(len, k, 6.6 + r), r * 2));
  }
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe6e7e8, metalness: 0.15, roughness: 0.45 });
  for (const [parts, mat] of [
    [white, whiteMat],
    [footings, towerMats.concrete],
    [pipes, bandMat],
  ]) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }

  const sheds = new THREE.Mesh(
    mergeGeometries(BUILDINGS.map(([x, z, w, d, h]) => new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z))),
    new THREE.MeshStandardMaterial({ color: 0xc8cacc, metalness: 0.1, roughness: 0.7 }),
  );
  sheds.castShadow = sheds.receiveShadow = true;
  root.add(sheds);

  towerB(root, towerMats.lattice);
  farTown(root, createRng(77));
  return {
    mount: olm,
    tanks,
    mats: { tankSteel, band: bandMat, insulated, concrete: towerMats.concrete, mountSteel: steel, dark },
  };
}

// The beams show only after dark; their strength follows the floodlights.
const beamMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(1.0, 0.78, 0.52).multiplyScalar(LIGHT.floods) } },
  vertexShader: /* glsl */ `
    varying float vV; varying float vEdge; varying float vDepth;
    void main() {
      vV = uv.y;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      vEdge = abs(dot(n, normalize(-mv.xyz)));
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; varying float vV; varying float vEdge; varying float vDepth;
    void main() {
      // MSAA shades edge pixels outside thin triangles, extrapolating varyings far out of range.
      float v = clamp(vV, 0.0, 1.0), e = clamp(vEdge, 0.0, 1.0);
      // Fade out close to the camera so standing inside a beam doesn't wash the frame.
      float a = v * v * e * e * 0.04 * smoothstep(40.0, 160.0, vDepth);
      gl_FragColor = vec4(uColor * a, 0.0);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  side: THREE.DoubleSide,
  fog: false,
});

function lightMast(scene, x, z, target, intensity) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 34, 10), new THREE.MeshStandardMaterial({ color: 0x3d4046, metalness: 0.6, roughness: 0.6 }));
  pole.position.set(x, 17, z);
  pole.castShadow = true;
  scene.add(pole);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(5, 2.2, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.4, roughness: 0.5, emissive: new THREE.Color(2.4, 2.0, 1.5), emissiveIntensity: LIGHT.floods }),
  );
  head.position.set(x, 34.5, z);
  head.lookAt(target);
  scene.add(head);
  const spot = new THREE.SpotLight(0xffd2a0, intensity * LIGHT.floods, 0, THREE.MathUtils.degToRad(30), 0.6, 2);
  spot.position.set(x, 34.5, z);
  spot.target.position.copy(target);
  scene.add(spot, spot.target);
  const from = new THREE.Vector3(x, 34.5, z);
  const len = from.distanceTo(target) * 1.25;
  const cone = new THREE.CylinderGeometry(2.2, len * Math.tan(THREE.MathUtils.degToRad(24)), len, 32, 1, true);
  cone.translate(0, -len / 2, 0);
  const beam = new THREE.Mesh(cone, beamMat);
  beam.position.copy(from);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(from).normalize());
  beam.frustumCulled = false;
  beam.visible = LIGHT.floods > 0;
  scene.add(beam);
  return spot;
}

/** Fits the light's orthographic shadow camera round `box`, as seen from the light. */
function fitShadow(light, box) {
  const cam = new THREE.OrthographicCamera();
  cam.position.copy(light.position);
  cam.lookAt(light.target.position);
  cam.updateMatrixWorld();
  const view = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    view.expandByPoint(p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse));
  }
  const sc = light.shadow.camera;
  sc.left = view.min.x;
  sc.right = view.max.x;
  sc.bottom = view.min.y;
  sc.top = view.max.y;
  sc.near = -view.max.z - 50;
  sc.far = -view.min.z + 50;
  sc.updateProjectionMatrix();
}

/**
 * Renders the procedural sky once into a cube map. Sampling it costs one texture read per pixel instead of
 * dozens of noise evaluations, which matters on software GPUs; only the star twinkle is lost.
 */
export function bakeSky(renderer, sky, size = 1024) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
  const skyScene = new THREE.Scene();
  skyScene.add(new THREE.Mesh(sky.geometry, sky.material));
  new THREE.CubeCamera(1, 5000, rt).update(renderer, skyScene);
  return rt;
}

/**
 * Builds the launch site for `map` ('starbase' or 'mars') under one group (`root`) that sits first in the
 * scene, and sets the scene's fog and environment. Returns the parts the view drives, plus:
 *   groundHeight(x, z)  the ground's height in meters at (x, z)
 *   useProps(model)     swaps the props.glb model in for the procedural dressing it replaces (throws if unusable)
 *   dispose()           removes the world and frees its GPU memory (shared tower materials are kept)
 */
export function buildWorld(scene, renderer, towerMats, map = 'starbase') {
  const root = new THREE.Group();
  root.name = `world-${map}`;
  const world =
    map === 'mars' ? buildMars(root, scene, renderer, towerMats, { bakeEnvironment, launchMount }) : buildStarbase(root, scene, renderer, towerMats);
  // First in the scene, so lights keep the order they had before maps existed.
  scene.add(root);
  scene.children.unshift(scene.children.pop());
  // props.glb geometry is shared with the loaded model, which outlives any one world. So are the
  // vertex-colored twins instantiate() makes of the tower's materials (one per material, shared with the tower).
  const shared = new Set();
  const towerSet = new Set(Object.values(towerMats));
  return {
    ...world,
    map,
    root,
    useProps(model) {
      const props = world.makeProps(model);
      model.traverse((o) => o.geometry && shared.add(o.geometry));
      props.traverse((o) => o.isMesh && towerSet.has(world.dressing.mats[o.userData.role]) && shared.add(o.material));
      root.add(props);
      return props;
    },
    dispose() {
      scene.remove(root);
      disposeTree(root, new Set([...towerSet, ...shared, ...(world.keep ?? [])]));
      world.envTarget.dispose();
    },
  };
}

/**
 * Starbase, Texas: the pad and tank farm on sand and mud, marsh and tidal flats round a wide bay, the
 * barrier island's town across it, and the Gulf beyond. Lit for TIME_OF_DAY.
 */
function buildStarbase(root, scene, renderer, towerMats) {
  const rng = createRng(4242);
  scene.fog = new THREE.FogExp2(LIGHT.horizon, LIGHT.fog);
  const sky = skyUniforms();
  const envTarget = siteEnvironment(renderer, sky);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = LIGHT.env;

  const skyMat = skyMaterial(sky);
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -10;
  root.add(skyMesh);

  const outer = new THREE.Group();
  const ground = new THREE.Mesh(groundGeometry(), groundMaterial(sky));
  ground.receiveShadow = true;
  outer.add(ground);
  root.add(outer);

  const tex = concrete();
  tex.map.repeat.set(1 / 24, 1 / 24);
  tex.roughnessMap.repeat.set(1 / 24, 1 / 24);
  const pads = new THREE.Mesh(
    mergeGeometries(PADS.map((p) => padGeometry(p))),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(3.3, 3.0, 2.4),
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
  pads.position.y = 0.02;
  pads.receiveShadow = true;
  root.add(pads);

  root.add(new THREE.HemisphereLight(LIGHT.hemi, LIGHT.ground.clone().multiplyScalar(0.5), 1));

  const key = new THREE.DirectionalLight(LIGHT.key, LIGHT.keyI);
  key.target.position.set(-60, 30, -120);
  key.position.copy(LIGHT.keyDir).multiplyScalar(700).add(key.target.position);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  fitShadow(key, new THREE.Box3(new THREE.Vector3(-250, 0, -335), new THREE.Vector3(260, 170, 150)));
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.8;
  root.add(key, key.target);

  const fill = new THREE.DirectionalLight(LIGHT.fill, 1);
  fill.position.set(60, 40, 300);
  fill.target.position.set(0, 60, 0);
  root.add(fill, fill.target);

  const floods = [
    lightMast(root, 130, 55, new THREE.Vector3(40, 50, 0), 15000),
    lightMast(root, -215, 50, new THREE.Vector3(-100, 50, 0), 12000),
    lightMast(root, -40, -95, new THREE.Vector3(10, 50, 0), 9000),
  ];
  // Pools of sodium light on the pad.
  for (const [x, z, c] of [
    [40, 30, 0xffb070],
    [-95, 25, 0xffb070],
    [-20, 70, 0xffd9a8],
  ]) {
    const pool = new THREE.PointLight(c, 260 * LIGHT.floods, 0, 2);
    pool.position.set(x, 12, z);
    root.add(pool);
  }

  const dressing = siteDressing(root, rng, towerMats);

  // Low haze over the far ground. It fades out when seen from above, where it would show as a ring.
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(900, 900, 120, 128, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: LIGHT.horizon } },
      vertexShader: /* glsl */ `
        varying float vY; varying vec3 vView;
        void main() {
          vY = position.y + 60.0;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vView = wp.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vY; varying vec3 vView;
        void main() {
          float a = exp(-clamp(vY, 0.0, 120.0) / 40.0) * 0.08 * (1.0 - smoothstep(0.05, 0.3, abs(normalize(vView).y)));
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      fog: false,
    }),
  );
  haze.position.y = 60;
  haze.renderOrder = 2;
  root.add(haze);
  const sample = {};
  return {
    sky: skyMesh,
    skyMat,
    floods,
    keyLight: key,
    dressing,
    envTarget,
    // Title screen: from above the beach road, both towers left of the title card, the bay and the
    // barrier island behind them and the Gulf past the beach on the right.
    establish: { pos: [120, 260, 577], tgt: [339, 27, -265], focus: [45, 0, 0], fov: 42 },
    fx: STARBASE_FX,
    keep: [beamMat],
    outer,
    haze,
    groundHeight(x, z) {
      siteSample(x, z, sample, false);
      return sample.h;
    },
    makeProps(model) {
      const props = instantiate(model, dressing.mats);
      dressing.mount.visible = false;
      dressing.tanks.visible = false;
      return props;
    },
  };
}
