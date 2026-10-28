import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { regolith, hexPad, solarCells } from './textures.js';
import { createRng, hash01 } from '../rng.js';
import { instantiate } from './models.js';

/** Low dusk sun over the far side of the site, so its blue Martian sunset glow sits in the background. */
export const SUN_DIR = new THREE.Vector3(0.257, 0.122, -0.959).normalize();
// Sunlight comes from the sun's bearing but 12° up instead of 7°: lit from lower, the steel and the arm
// trusses throw glints that flicker from frame to frame.
const LIGHT_UP = THREE.MathUtils.degToRad(12);
const LIGHT_DIR = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize().multiplyScalar(Math.cos(LIGHT_UP)).setY(Math.sin(LIGHT_UP));
const PHOBOS_DIR = new THREE.Vector3(-0.275, 0.454, -0.847).normalize();
const DEIMOS_DIR = new THREE.Vector3(0.058, 0.545, -0.836).normalize();
const EARTH_DIR = new THREE.Vector3(0.09, 0.27, -0.958).normalize();
const SITE_X = -30;
const SITE_Z = -25;
const PAD_R = 130;
const MOUNT_X = -30;
const MOUNT_Z = -70;
const HAZE = [0.13, 0.05, 0.016];

/** Particle and explosion colours: red-orange regolith instead of white steam, brown smoke, low warm sun. */
export const MARS_FX = {
  dust: [0.44, 0.19, 0.08],
  smoke: [0.1, 0.07, 0.05],
  vapor: [0.6, 0.56, 0.52],
  boomSmoke: [0.1, 0.065, 0.045],
  boomDust: [0.56, 0.27, 0.12],
  ambient: [0.3, 0.2, 0.13],
  key: [1.15, 0.8, 0.52],
  keyDir: SUN_DIR,
  ring: [1.0, 0.52, 0.26],
  gravity: 3.71,
};

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
`;

// Dusty butterscotch sky: bright toward the setting sun, dimmer and browner overhead and opposite, with
// the blue glow that fine dust scatters forward around the Martian sun. Shared by the sky, its
// reflection environment and the distant ridges (which fade into the sky behind them).
const MARS_SKY_GLSL = /* glsl */ `
uniform vec3 uSun;
const vec3 HAZE = vec3(${HAZE.join(', ')});
float skyAngle(vec3 d, vec3 s) { return 2.0 * asin(min(1.0, length(d - s) * 0.5)); }
vec3 marsSky(vec3 d) {
  float hh = max(d.y, 0.0);
  float ang = skyAngle(d, uSun);
  float az = dot(normalize(d.xz + vec2(1e-6, 0.0)), normalize(uSun.xz));
  float sunSide = smoothstep(-0.6, 1.0, az);
  // Saturated and low on purpose: AgX lifts dark values and desaturates, and these have to come out
  // butterscotch near the horizon and dusk-brown overhead.
  vec3 hor = mix(vec3(0.12, 0.042, 0.012), vec3(0.42, 0.17, 0.045), sunSide);
  vec3 mid = mix(vec3(0.035, 0.013, 0.005), vec3(0.09, 0.036, 0.012), sunSide);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.2, hh));
  col = mix(col, vec3(0.009, 0.0055, 0.0055), smoothstep(0.15, 0.85, hh));
  col = mix(col, vec3(0.13, 0.25, 0.55), exp(-ang / 0.1) * 0.9);
  col += vec3(0.02, 0.04, 0.09) * exp(-ang / 0.32);
  return col;
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

function marsSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: SUN_DIR },
      uPhobos: { value: PHOBOS_DIR },
      uDeimos: { value: DEIMOS_DIR },
      uEarth: { value: EARTH_DIR },
    },
    vertexShader: SKY_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uPhobos; uniform vec3 uDeimos; uniform vec3 uEarth;
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${MARS_SKY_GLSL}
      // A small moon lit by the sun: lumpy outline, soft terminator, a little surface mottling.
      vec3 moon(vec3 col, vec3 d, vec3 dir, float rad, float lumpy) {
        vec3 ux = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
        vec3 uy = cross(ux, dir);
        vec2 q = vec2(dot(d, ux), dot(d, uy)) / rad;
        float rq = length(q);
        if (dot(d, dir) < 0.0 || rq > 1.5) return col;
        float a = atan(q.y, q.x);
        float edge = 1.0 + lumpy * (0.13 * sin(a * 2.0 + 0.7) + 0.06 * sin(a * 5.0 + 2.1));
        float r = rq / edge;
        float disc = smoothstep(1.0, 0.8, r);
        vec3 n = normalize((q.x * ux + q.y * uy) / edge - sqrt(max(0.0, 1.0 - r * r)) * dir);
        float lit = smoothstep(-0.05, 0.2, dot(n, uSun));
        float mott = 0.75 + 0.35 * vnoise(vec3(q * 3.0, rad * 400.0));
        return col + vec3(0.95, 0.85, 0.74) * lit * mott * disc;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = marsSky(d);
        // High, thin dust streaks, stretched along the horizon.
        float streak = fbm(d * vec3(2.2, 9.0, 2.2) + 4.0);
        col *= 0.86 + 0.28 * smoothstep(0.25, 0.75, streak) * smoothstep(0.0, 0.12, h);
        float ang = skyAngle(d, uSun);
        // Kept just above the bloom threshold, so the disc showing through a gap in the tower lattice for
        // one frame does not bloom into a flash.
        col += vec3(0.9, 1.05, 1.3) * exp(-ang / 0.025) + vec3(1.2, 1.3, 1.5) * exp(-ang / 0.008);
        col = mix(col, vec3(3.4, 3.6, 4.0), smoothstep(0.0058, 0.0047, ang));
        // A few early stars, only where the dusk sky is already dark.
        vec3 sp = d * 260.0; vec3 id = floor(sp);
        float sh = hash13(id);
        if (sh > 0.985) {
          vec3 off = vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3)) - 0.5;
          float s = smoothstep(0.17, 0.0, length(fract(sp) - 0.5 - off * 0.5)) * (sh - 0.985) / 0.015;
          float dark = smoothstep(0.35, 0.8, h) * (1.0 - smoothstep(-0.3, 0.5, dot(normalize(d.xz + vec2(1e-6, 0.0)), normalize(uSun.xz))));
          col += vec3(0.9, 0.85, 0.8) * s * dark * (0.8 + 0.2 * sin(uTime * 2.0 + sh * 80.0));
        }
        col = moon(col, d, uPhobos, 0.013, 1.0);
        col = moon(col, d, uDeimos, 0.0034, 0.5);
        // Earth: a bright blue-white evening star above the sunset.
        col += vec3(0.75, 0.95, 1.6) * smoothstep(0.0026, 0.0008, skyAngle(d, uEarth)) * 1.8;
        if (h < 0.0) col = mix(col, HAZE, smoothstep(0.0, -0.04, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

function marsEnvironment(renderer, bakeEnvironment) {
  const envScene = new THREE.Scene();
  const dome = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${MARS_SKY_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float ang = skyAngle(d, uSun);
        // The sun is drawn wider than in the sky so it survives the prefilter as a warm highlight.
        vec3 col = marsSky(d) + vec3(8.0, 8.2, 8.8) * smoothstep(0.05, 0.02, ang) + vec3(0.6, 0.72, 1.0) * exp(-ang / 0.09);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), dome));
  // Low ridges all round the horizon, darker toward the sun (seen against the light).
  const ridgeGeo = new THREE.CylinderGeometry(96, 96, 7, 96, 1, true);
  const rc = [];
  const pos = ridgeGeo.attributes.position;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i).normalize();
    const lit = 0.55 + 0.45 * Math.max(0, -(tmp.x * SUN_DIR.x + tmp.z * SUN_DIR.z));
    rc.push(0.2 * lit, 0.1 * lit, 0.06 * lit);
  }
  ridgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  const ridge = new THREE.Mesh(ridgeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  ridge.position.y = 1.5;
  envScene.add(ridge);
  // LED floodlight heads, the white habitat domes, and the sunlit regolith below.
  const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 15, 17), side: THREE.DoubleSide });
  const dome2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.62, 0.5), side: THREE.DoubleSide });
  for (const [x, y, z, w, h, m] of [
    [62, 16, 26, 5, 2.5, led],
    [-86, 14, 20, 5, 2.5, led],
    [-22, 14, -46, 4, 2, led],
    [-70, 3, -85, 16, 4, dome2],
    [60, 2, -88, 10, 3, dome2],
  ]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    envScene.add(p);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(98, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.09, 0.05) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
  envScene.add(ground);
  return bakeEnvironment(renderer, envScene);
}

// ---------------------------------------------------------------- terrain

function vnoise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (i, j) => hash01(Math.imul(i, 374761393) ^ Math.imul(j, 668265263));
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Impact craters out on the plain: x, z, radius, depth.
const CRATERS = [
  [250, -360, 42, 7],
  [-360, -300, 58, 9],
  [430, 110, 66, 9],
  [-430, 250, 44, 6],
  [110, -650, 95, 13],
  [-640, -470, 125, 15],
  [620, -260, 80, 10],
  [-250, 470, 60, 8],
];

/** Ground height: flat around the site, rolling plain with dunes and craters beyond it. */
function terrainHeight(x, z) {
  const d = Math.hypot(x - SITE_X, z - SITE_Z);
  let h = 0;
  const k = smooth(210, 380, d);
  if (k > 0) {
    h += (vnoise2(x / 520, z / 520) - 0.5) * 34;
    h += (vnoise2(x / 150 + 7.3, z / 150 - 2.1) - 0.5) * 8;
    const dune = smooth(0.45, 0.7, vnoise2(x / 700 + 3, z / 700 + 9));
    h += Math.sin((x * 0.6 + z * 0.8) / 34 + vnoise2(x / 260, z / 260) * 6) * 2.2 * dune;
    h *= k;
  }
  for (const [cx, cz, R, depth] of CRATERS) {
    const q = Math.hypot(x - cx, z - cz) / R;
    if (q > 2.2) continue;
    const bowl = q < 1 ? q * q - 1 : 0;
    const rim = 0.35 * Math.exp(-(((q - 1) / 0.22) ** 2));
    const ejecta = q > 1 ? 0.06 * Math.exp(-(q - 1) / 0.5) : 0;
    h += depth * (bowl + rim + ejecta);
  }
  return h;
}

function groundGeometry() {
  const SEG = 360;
  const RINGS = 150;
  const R_MAX = 3600;
  const pos = new Float32Array((RINGS + 1) * SEG * 3);
  const uv = new Float32Array((RINGS + 1) * SEG * 2);
  const col = new Float32Array((RINGS + 1) * SEG * 3);
  for (let j = 0; j <= RINGS; j++) {
    const r = R_MAX * (j / RINGS) ** 2.2;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = SITE_X + Math.cos(a) * r;
      const z = SITE_Z + Math.sin(a) * r;
      const y = terrainHeight(x, z);
      const o = j * SEG + i;
      pos.set([x, y, z], o * 3);
      uv.set([x / 16, -z / 16], o * 2);
      // Large-scale albedo: dark basalt fields and paler dust, so the tiled texture never reads as a grid.
      const t = vnoise2(x / 240 + 11, z / 240 - 5) * 0.65 + vnoise2(x / 60, z / 60) * 0.35;
      const w = smooth(0.25, 0.75, t);
      let c = [0.8 + 0.3 * w, 0.78 + 0.24 * w, 0.82 + 0.12 * w];
      for (const [cx, cz, R] of CRATERS) {
        const q = Math.hypot(x - cx, z - cz) / R;
        if (q < 1) c = c.map((v) => v * (0.82 + 0.18 * q));
        else if (q < 1.6) c = c.map((v) => v * (1 + 0.08 * (1.6 - q)));
      }
      col.set(c, o * 3);
    }
  }
  const idx = [];
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * SEG + i;
      const b = j * SEG + ((i + 1) % SEG);
      const c = a + SEG;
      const d = b + SEG;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeTangents();
  return geo;
}

/** Periodic 1-D value noise over the horizon angle. */
function ringNoise(rng, period) {
  const g = Array.from({ length: period }, () => rng.next());
  return (a) => {
    const u = ((a / (Math.PI * 2)) * period) % period;
    const i = Math.floor(u);
    const f = u - i;
    const s = f * f * (3 - 2 * f);
    return g[i % period] + (g[(i + 1) % period] - g[i % period]) * s;
  };
}

/** A ring of distant ridges or mesas: a slope rising away from the site to a crest given by `profile`. */
function ridgeRing(radius, depth, segs, profile) {
  const pos = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const h = profile(a);
    const c = Math.cos(a);
    const s = Math.sin(a);
    pos.push(c * (radius - depth), -60, s * (radius - depth));
    pos.push(c * (radius - depth * 0.42), h * 0.32, s * (radius - depth * 0.42));
    pos.push(c * radius, h, s * radius);
  }
  const idx = [];
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k;
      const b = (i + 1) * 3 + k;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function ridgeMaterial(tint, haze) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: SUN_DIR },
      uTint: { value: new THREE.Color().setRGB(...tint) },
      uHaze: { value: haze },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uHaze;
      varying vec3 vWorld; varying vec3 vNormal;
      ${NOISE_GLSL}
      ${MARS_SKY_GLSL}
      void main() {
        vec3 n = normalize(vNormal);
        vec3 vd = normalize(vWorld - cameraPosition);
        // Layered rock: horizontal strata, vertical gullies, a darker talus foot.
        float strata = 0.84 + 0.16 * sin(vWorld.y * 0.21 + vnoise(vWorld * 0.008) * 5.0);
        float gully = 0.82 + 0.18 * vnoise(vec3(vWorld.x * 0.03, vWorld.y * 0.006, vWorld.z * 0.03));
        float foot = mix(0.7, 1.0, smoothstep(-10.0, 90.0, vWorld.y));
        float sun = max(dot(n, uSun), 0.0);
        // Rim light where a crest is seen against the low sun behind it.
        float rim = pow(max(dot(vd, uSun), 0.0), 8.0) * smoothstep(0.0, 1.0, vWorld.y / 120.0);
        vec3 lit = uTint * strata * gully * foot * (vec3(0.3, 0.17, 0.1) + vec3(1.6, 1.05, 0.62) * sun) + vec3(0.5, 0.3, 0.16) * rim * 0.25;
        float haze = uHaze + (1.0 - uHaze) * 0.35 * exp(-max(vWorld.y, 0.0) / 45.0);
        vec3 sky = marsSky(normalize(vec3(vd.x, 0.02, vd.z)));
        gl_FragColor = vec4(mix(lit, sky, clamp(haze, 0.0, 1.0)), 1.0);
      }`,
    fog: false,
  });
}

/**
 * Crest profile made of separate buttes and mesas: flat (slightly eroded) tops, steep cliffs, and a
 * talus apron at the foot. Widths and slopes are in radians of horizon angle.
 */
function buttes(rng, count, { w: [w0, w1], h: [h0, h1], slope, apron = 0.22, base = 0 }) {
  const list = Array.from({ length: count }, () => ({ c: rng.range(0, Math.PI * 2), w: rng.range(w0, w1), h: rng.range(h0, h1), s: slope * rng.range(0.6, 1.5) }));
  const top = ringNoise(rng, 140);
  const fine = ringNoise(rng, 520);
  return (a) => {
    let h = base;
    for (const m of list) {
      let d = Math.abs(a - m.c) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      const cliff = smooth(0, 1, clamp01((m.w + m.s - d) / m.s)) ** 0.7;
      const foot = clamp01((m.w + m.s * 5 - d) / (m.s * 4)) ** 1.5 * apron;
      h = Math.max(h, m.h * Math.max(cliff * (0.93 + 0.07 * top(a)), foot));
    }
    return h + fine(a) * 3;
  };
}

function horizon(root) {
  const rng = createRng(512);
  const n1 = ringNoise(rng, 60);
  const n2 = ringNoise(rng, 190);
  const near = ridgeRing(1050, 240, 720, (a) => 8 + 40 * (n1(a) * 0.75 + n2(a) * 0.25) ** 1.8);
  const mid = buttes(rng, 9, { w: [0.025, 0.07], h: [55, 150], slope: 0.012 });
  const midRing = ridgeRing(1350, 160, 1440, mid);
  const mesa = buttes(rng, 13, { w: [0.04, 0.16], h: [90, 240], slope: 0.02, base: 14 });
  const mesaRing = ridgeRing(1800, 260, 1440, mesa);
  const scarp = buttes(rng, 7, { w: [0.2, 0.45], h: [170, 300], slope: 0.04, apron: 0.35, base: 40 });
  const far = ridgeRing(2900, 380, 1080, scarp);
  for (const [geo, tint, haze] of [
    [far, [0.22, 0.085, 0.035], 0.5],
    [mesaRing, [0.19, 0.07, 0.028], 0.32],
    [midRing, [0.16, 0.055, 0.022], 0.22],
    [near, [0.14, 0.05, 0.02], 0.12],
  ]) {
    const m = new THREE.Mesh(geo, ridgeMaterial(tint, haze));
    m.frustumCulled = false;
    root.add(m);
  }
}

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.72 + 0.5 * vnoise2(v.x * 1.7 + seed, v.z * 1.7 + v.y * 2.3 - seed);
    v.multiplyScalar(k);
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // IcosahedronGeometry is non-indexed, so each face gets its own normal: faceted rocks.
  g.computeVertexNormals();
  return g;
}

function scatterRocks(root, rng) {
  const geo = rockGeometry(3.7);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6a3b28, roughness: 0.9, metalness: 0, flatShading: true });
  const N = 420;
  const rocks = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  let n = 0;
  while (n < N) {
    const a = rng.range(0, Math.PI * 2);
    const r = PAD_R + 6 + (rng.next() ** 1.7) * 900;
    const x = SITE_X + Math.cos(a) * r;
    const z = SITE_Z + Math.sin(a) * r;
    // Keep the lane in front of the towers clear; rocks there would sit under the player's eye line.
    if (z > 0 && z < 260 && Math.abs(x + 30) < 140 && r < 330) continue;
    const size = (0.25 + rng.next() ** 2.4 * 2.2) * (1 + r / 500);
    e.set(rng.range(-0.3, 0.3), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3));
    s.set(size * rng.range(0.8, 1.5), size * rng.range(0.7, 1.2), size * rng.range(0.8, 1.4));
    m.compose(new THREE.Vector3(x, terrainHeight(x, z) - size * 0.18, z), q.setFromEuler(e), s);
    rocks.setMatrixAt(n++, m);
  }
  rocks.receiveShadow = true;
  rocks.castShadow = true;
  root.add(rocks);
}

// ---------------------------------------------------------------- base dressing

function add(root, geo, mat, { x = 0, y = 0, z = 0, cast = true, ry = 0 } = {}) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function beamBetween(a, b, r, segs = 12) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), segs);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Habitat domes, a greenhouse vault, solar arrays, landing pads, cargo and antenna masts behind the site. */
function marsBase(root, rng, mats) {
  const domeParts = [];
  const bermParts = [];
  const tubeParts = [];
  const winM = [];
  const domes = [
    [-190, -256, 14],
    [-156, -236, 9],
    [-212, -224, 7.5],
    [-168, -284, 10.5],
    [-128, -268, 6.5],
  ];
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const [x, z, r] of domes) {
    domeParts.push(new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, 0.6, z));
    bermParts.push(new THREE.CylinderGeometry(r * 1.04, r * 1.16, 1.4, 28).translate(x, 0.5, z));
    // A band of lit windows around each dome, and a lit airlock door facing the site.
    const n = Math.round(r * 1.6);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.05, 0.05);
      if (!rng.chance(0.72)) continue;
      const wy = r * 0.3;
      const wr = Math.sqrt(r * r - wy * wy) + 0.05;
      const mm = new THREE.Matrix4().compose(v(x + Math.cos(a) * wr, wy + 0.6, z + Math.sin(a) * wr), new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), -a + Math.PI / 2), v(1, 1, 1));
      winM.push(mm);
    }
    tubeParts.push(new THREE.CylinderGeometry(r * 0.2, r * 0.2, r * 0.6, 14).rotateX(Math.PI / 2).translate(x, r * 0.2 + 0.6, z + r * 0.95));
  }
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [0, 3],
    [3, 4],
  ]) {
    const [x1, z1] = domes[a];
    const [x2, z2] = domes[b];
    tubeParts.push(beamBetween(v(x1, 2.4, z1), v(x2, 2.4, z2), 1.9, 14));
  }
  // Greenhouse: a long half-cylinder vault with glowing panes along its side.
  domeParts.push(new THREE.CylinderGeometry(6.5, 6.5, 40, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(0.25).translate(-92, 0.4, -312));
  for (let k = 0; k < 9; k++) {
    const t = -18 + k * 4.4;
    winM.push(new THREE.Matrix4().compose(v(-92 + Math.cos(0.25) * t + 0.4, 3.2, -312 - Math.sin(0.25) * t + 6.3), new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), 0.25), v(2.2, 2.4, 1)));
  }
  add(root, mergeGeometries(domeParts), mats.dome, { cast: true });
  add(root, mergeGeometries(bermParts), mats.regolithBerm, { cast: false });
  add(root, mergeGeometries(tubeParts), mats.dome);
  const win = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 0.7), mats.window, winM.length);
  winM.forEach((mm, i) => win.setMatrixAt(i, mm));
  root.add(win);

  // Solar arrays: rows of tilted panels on posts, turned toward the open sky above the site.
  const rows = 5;
  const cols = 12;
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 0.12, 2.4), mats.solar, rows * cols);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6), mats.metal, rows * cols);
  const pm = new THREE.Matrix4();
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, -0.2, 0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 118 + c * 5.2 + r * 1.4;
      const z = -238 - r * 8.5 + c * 1.1;
      pm.compose(v(x, 2.3, z), tilt, v(1, 1, 1));
      panels.setMatrixAt(r * cols + c, pm);
      pm.compose(v(x, 1.1, z), new THREE.Quaternion(), v(1, 1, 1));
      posts.setMatrixAt(r * cols + c, pm);
    }
  }
  panels.castShadow = true;
  panels.receiveShadow = true;
  root.add(panels, posts);

  // Landing pads with beacon lights; one has a small lander parked on it.
  const beacons = [];
  for (const [x, z, r] of [
    [262, -172, 14],
    [-282, -158, 12],
    [372, -262, 16],
  ]) {
    add(root, new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2), mats.landingPad, { x, y: 0.05, z, cast: false });
    add(root, new THREE.RingGeometry(r * 0.72, r * 0.78, 48).rotateX(-Math.PI / 2), mats.paint, { x, y: 0.08, z, cast: false });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      beacons.push(v(x + Math.cos(a) * (r + 0.6), 0.35, z + Math.sin(a) * (r + 0.6)));
    }
  }
  const lander = [];
  lander.push(new THREE.CylinderGeometry(2.6, 3.4, 5.5, 18).translate(0, 4.6, 0));
  lander.push(new THREE.SphereGeometry(2.6, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 7.35, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    lander.push(beamBetween(v(Math.cos(a) * 2.6, 3.4, Math.sin(a) * 2.6), v(Math.cos(a) * 5.2, 0, Math.sin(a) * 5.2), 0.18, 8));
  }
  add(root, mergeGeometries(lander), mats.dome, { x: 372, z: -262 });
  add(root, new THREE.CylinderGeometry(1.2, 1.8, 1.8, 14), mats.dark, { x: 372, y: 1.3, z: -262 });

  // Cargo: containers stacked in small yards.
  const cargo = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 2.6, 2.5), mats.cargo, 22);
  const tints = [0xd9d6d0, 0xd8732c, 0x8a8f96, 0x9a4f32, 0xd9d6d0];
  let ci = 0;
  for (const [x0, z0, n, ry] of [
    [-140, -214, 6, 0.1],
    [228, -146, 5, -0.4],
    [-246, -132, 5, 0.6],
    [92, -226, 6, 0.0],
  ]) {
    for (let k = 0; k < n; k++) {
      const stack = k % 3 === 2 ? 1 : 0;
      const x = x0 + Math.cos(ry) * (k - stack) * 6.4;
      const z = z0 - Math.sin(ry) * (k - stack) * 6.4;
      pm.compose(v(x, 1.3 + stack * 2.6, z), new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), ry + rng.range(-0.04, 0.04)), v(1, 1, 1));
      cargo.setMatrixAt(ci, pm);
      cargo.setColorAt(ci, new THREE.Color(tints[Math.floor(rng.next() * tints.length)]));
      ci++;
    }
  }
  cargo.count = ci;
  cargo.castShadow = true;
  cargo.receiveShadow = true;
  root.add(cargo);

  // Antenna masts with dishes and red beacons, and one big tracking dish.
  const mastParts = [];
  const dishParts = [];
  for (const [x, z, h] of [
    [-98, -336, 42],
    [64, -350, 30],
    [318, -372, 36],
    [-300, -238, 26],
  ]) {
    mastParts.push(new THREE.CylinderGeometry(0.28, 0.5, h, 8).translate(x, h / 2, z));
    for (const [dy, dr] of [
      [0.55, 3.2],
      [0.75, 2.4],
    ]) {
      mastParts.push(new THREE.BoxGeometry(dr * 2, 0.2, 0.2).translate(x, h * dy, z));
    }
    dishParts.push(new THREE.SphereGeometry(2.2, 16, 6, 0, Math.PI * 2, 0, 0.7).rotateX(-1.1).translate(x + 0.6, h * 0.82, z + 1.4));
    beacons.push(v(x, h + 0.4, z));
  }
  dishParts.push(new THREE.SphereGeometry(9, 28, 8, 0, Math.PI * 2, 0, 0.62).rotateX(-0.95).rotateY(0.5).translate(30, 13, -262));
  mastParts.push(new THREE.CylinderGeometry(1.2, 2.2, 10, 12).translate(30, 5, -262));
  add(root, mergeGeometries(mastParts), mats.metal);
  const dishMat = mats.dome.clone();
  dishMat.side = THREE.DoubleSide;
  add(root, mergeGeometries(dishParts), dishMat);

  const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 8, 6), mats.beacon, beacons.length);
  beacons.forEach((p, i) => {
    pm.makeTranslation(p.x, p.y, p.z);
    bm.setMatrixAt(i, pm);
    bm.setColorAt(i, p.y > 5 ? new THREE.Color(4, 0.3, 0.15) : new THREE.Color(3.2, 1.9, 0.6));
  });
  root.add(bm);
}

const beamMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(0.78, 0.84, 1.0) } },
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
      float a = v * v * e * e * 0.02 * smoothstep(40.0, 160.0, vDepth);
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

/** LED floodlight mast: cool white against the warm dusk, with a faint beam in the dusty air. */
function ledMast(root, x, z, target, intensity) {
  add(root, new THREE.CylinderGeometry(0.5, 0.7, 34, 10), new THREE.MeshStandardMaterial({ color: 0x4a4440, metalness: 0.6, roughness: 0.6 }), { x, y: 17, z });
  const head = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.4, 2.8), toneMapped: false }));
  head.position.set(x, 34.5, z);
  head.lookAt(target);
  root.add(head);
  const spot = new THREE.SpotLight(0xe9efff, intensity, 0, THREE.MathUtils.degToRad(30), 0.6, 2);
  spot.position.set(x, 34.5, z);
  spot.target.position.copy(target);
  root.add(spot, spot.target);
  const from = new THREE.Vector3(x, 34.5, z);
  const len = from.distanceTo(target) * 1.25;
  const cone = new THREE.CylinderGeometry(2.2, len * Math.tan(THREE.MathUtils.degToRad(24)), len, 32, 1, true);
  cone.translate(0, -len / 2, 0);
  const beam = new THREE.Mesh(cone, beamMat);
  beam.position.copy(from);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(from).normalize());
  beam.frustumCulled = false;
  root.add(beam);
  return spot;
}

/** Keeps the triangles of a props.glb mesh whose centre lies within r of (x, z) in props space. */
function keepNear(mesh, x, z, r) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index;
  const tris = index ? index.count / 3 : pos.count / 3;
  const at = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  mesh.updateWorldMatrix(true, false);
  const mat = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const kept = [];
  for (let t = 0; t < tris; t++) {
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, at(t, k)).applyMatrix4(mat);
      cx += v.x;
      cz += v.z;
    }
    if (Math.hypot(cx / 3 - x, cz / 3 - z) < r) kept.push(t);
  }
  if (!kept.length) return null;
  const remap = new Map();
  const order = [];
  const newIndex = [];
  for (const t of kept) {
    for (let k = 0; k < 3; k++) {
      const i = at(t, k);
      if (!remap.has(i)) {
        remap.set(i, order.length);
        order.push(i);
      }
      newIndex.push(remap.get(i));
    }
  }
  const out = new THREE.BufferGeometry();
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = new Float32Array(order.length * attr.itemSize);
    order.forEach((i, j) => {
      for (let c = 0; c < attr.itemSize; c++) a[j * attr.itemSize + c] = attr[get[c]](i);
    });
    out.setAttribute(name, new THREE.BufferAttribute(a, attr.itemSize));
  }
  out.setIndex(newIndex);
  return out;
}

export function buildMars(root, scene, renderer, towerMats, { bakeEnvironment, launchMount }) {
  const rng = createRng(1965);
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(...HAZE), 0.0006);
  const envTarget = marsEnvironment(renderer, bakeEnvironment);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.65;

  const skyMat = marsSkyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  root.add(sky);

  const reg = regolith();
  const ground = new THREE.Mesh(
    groundGeometry(),
    new THREE.MeshStandardMaterial({ map: reg.map, normalMap: reg.normalMap, roughnessMap: reg.roughnessMap, roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: 0.7 }),
  );
  ground.receiveShadow = true;
  root.add(ground);

  const hex = hexPad();
  const tileW = 16.6;
  hex.map.repeat.set((PAD_R * 2) / tileW, (PAD_R * 2) / (tileW * hex.aspect));
  hex.roughnessMap.repeat.copy(hex.map.repeat);
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(PAD_R, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0xc2a696,
      map: hex.map,
      roughnessMap: hex.roughnessMap,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 1.1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
  pad.position.set(SITE_X, 0.02, SITE_Z);
  pad.receiveShadow = true;
  root.add(pad);
  // A sintered apron ring where the pad meets the loose regolith.
  const apron = new THREE.Mesh(
    new THREE.RingGeometry(PAD_R, PAD_R + 7, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5a3a2c, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  apron.position.set(SITE_X, 0.02, SITE_Z);
  apron.receiveShadow = true;
  root.add(apron);

  // Lights: the same kinds and counts as the night site, so switching maps recompiles nothing shared.
  const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.26, 0.11, 0.035), new THREE.Color().setRGB(0.1, 0.035, 0.012), 0.9);
  root.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.74, 0.5), 2.7);
  sun.target.position.set(-30, 20, -20);
  sun.position.copy(LIGHT_DIR).multiplyScalar(700).add(sun.target.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -240;
  sc.right = 240;
  sc.top = 190;
  sc.bottom = -120;
  sc.near = 100;
  sc.far = 1500;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.8;
  root.add(sun, sun.target);

  // Skylight from the bright western sky, so the faces turned toward the camera aren't black.
  const fill = new THREE.DirectionalLight(new THREE.Color().setRGB(0.7, 0.36, 0.15), 0.45);
  fill.position.set(80, 120, 300);
  fill.target.position.set(0, 50, 0);
  root.add(fill, fill.target);

  const floods = [
    ledMast(root, 130, 55, new THREE.Vector3(40, 50, 0), 9000),
    ledMast(root, -215, 50, new THREE.Vector3(-100, 50, 0), 7500),
    ledMast(root, -40, -95, new THREE.Vector3(10, 50, 0), 5500),
  ];
  for (const [x, z, c] of [
    [40, 30, 0xffd8b0],
    [-95, 25, 0xffd8b0],
    [-20, 70, 0xe6eeff],
  ]) {
    const pool = new THREE.PointLight(c, 140, 0, 2);
    pool.position.set(x, 12, z);
    root.add(pool);
  }

  // Edge lights around the pad.
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.35, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 72);
  const lm = new THREE.Matrix4();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    lm.makeTranslation(SITE_X + Math.cos(a) * (PAD_R + 2), 0.2, SITE_Z + Math.sin(a) * (PAD_R + 2));
    lamps.setMatrixAt(i, lm);
    lamps.setColorAt(i, i % 3 ? new THREE.Color(3.0, 1.7, 0.55) : new THREE.Color(1.8, 2.3, 3.2));
  }
  root.add(lamps);

  const steel = new THREE.MeshStandardMaterial({ color: 0x8f949b, metalness: 0.6, roughness: 0.5 });
  const { olm: mount, dark } = launchMount(steel, towerMats.concrete);
  root.add(mount);

  const mats = {
    dome: new THREE.MeshStandardMaterial({ color: 0xe3d8cc, roughness: 0.55, metalness: 0.05, flatShading: true }),
    regolithBerm: new THREE.MeshStandardMaterial({ color: 0x7a4430, roughness: 0.95 }),
    window: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.9), toneMapped: false, side: THREE.DoubleSide }),
    solar: new THREE.MeshStandardMaterial({ map: solarCells(), metalness: 0.5, roughness: 0.28, envMapIntensity: 1.4 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8c8580, metalness: 0.7, roughness: 0.45 }),
    landingPad: new THREE.MeshStandardMaterial({ color: 0x4e3f39, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xcfc3b5, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    cargo: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2 }),
    dark,
    beacon: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  };
  marsBase(root, rng, mats);
  scatterRocks(root, rng);
  horizon(root);

  // Distant lights of outlying modules.
  const n = 60;
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
  const dm = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = rng.range(-1.6, 1.4);
    const d = rng.range(420, 1000);
    const x = Math.sin(a) * d;
    const z = -Math.cos(a) * d;
    dm.compose(new THREE.Vector3(x, terrainHeight(x, z) + rng.range(0.6, 6), z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1).multiplyScalar(rng.range(0.7, 1.8)));
    dots.setMatrixAt(i, dm);
    dots.setColorAt(i, rng.chance(0.6) ? new THREE.Color(3.2, 2.0, 0.9) : new THREE.Color(2.0, 2.6, 3.4));
  }
  root.add(dots);

  // Thin dust haze hanging low around the site.
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(250, 250, 90, 96, 1, true),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying float vY; void main() { vY = position.y + 45.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vY;
        void main() {
          float a = exp(-clamp(vY, 0.0, 90.0) / 20.0) * 0.22;
          gl_FragColor = vec4(vec3(0.42, 0.21, 0.09) * a, a * 0.6);
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
  haze.position.y = 45;
  haze.renderOrder = 2;
  root.add(haze);

  const propMats = { tankSteel: steel, band: steel, insulated: steel, concrete: towerMats.concrete, mountSteel: steel, dark };
  return {
    sky,
    skyMat,
    floods,
    keyLight: sun,
    dressing: { mount, mats: propMats },
    envTarget,
    fx: MARS_FX,
    keep: [beamMat],
    makeProps(model) {
      // props.glb also holds the tank farm; on Mars only its launch mount is used.
      const props = instantiate(model, propMats);
      const drop = [];
      props.traverse((o) => {
        if (!o.isMesh) return;
        const g = keepNear(o, MOUNT_X, MOUNT_Z, 26);
        if (g) o.geometry = g;
        else drop.push(o);
      });
      for (const o of drop) o.removeFromParent();
      mount.visible = false;
      return props;
    },
  };
}
