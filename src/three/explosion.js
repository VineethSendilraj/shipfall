import * as THREE from 'three';
import { createRng } from '../rng.js';
import { puffNoise } from './textures.js';

// Every value here is a pure function of (seed, time since impact), so an explosion looks the same at any
// frame rate and in frame-stepped captures. The seed comes from the sim's fx RNG stream (Game.crash()).
const MAX_PUFFS = 2048;
const MAX_ACTIVE = 3;
const MAX_SCORCH = 6;
const LIFE = 16;
const SCORCH_LIFE = 40;
const N_DEBRIS = 12;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Brightness ramp over the first few frames after impact: no single-frame jump to full intensity. */
const ramp = (t, dur = 0.09) => smooth(0, dur, t);
/** Squared ramp for light: the tone curve is log-like, so this reads as an even rise over ~7 frames. */
const easeIn = (t, dur) => ramp(t, dur) ** 2;
/** Fades to exactly 0 between a and b, so nothing is still visible on the frame it stops being drawn. */
const fadeOut = (t, a, b) => 1 - smooth(a, b, t);
const grow = (t, tau) => 1 - Math.exp(-Math.max(0, t) / tau);

const puffVert = /* glsl */ `
  attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
  varying vec2 vUv; varying vec4 vB; varying vec4 vC; varying float vY; varying float vR; varying vec2 vCS;
  void main() {
    vec4 mvc = modelViewMatrix * vec4(iA.xyz, 1.0);
    float c = cos(iB.w), s = sin(iB.w);
    vec2 q = position.xy;
    vec2 off = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iA.w * 2.0;
    gl_Position = projectionMatrix * (mvc + vec4(off, 0.0, 0.0));
    vUv = q + 0.5;
    // Height of this corner above the group's ground (the rotation's transpose maps the offset back to the group's frame).
    vY = iA.y + (vec4(off, 0.0, 0.0) * modelViewMatrix).y;
    vR = iA.w; vB = iB; vC = iC; vCS = vec2(c, s);
  }`;

const puffFrag = /* glsl */ `
  uniform sampler2D tNoise; uniform vec3 uLight; uniform vec3 uKey; uniform vec3 uAmb;
  varying vec2 vUv; varying vec4 vB; varying vec4 vC; varying float vY; varying float vR; varying vec2 vCS;
  vec3 fireRamp(float t) {
    vec3 c = mix(vec3(0.0), vec3(0.35, 0.045, 0.008), smoothstep(0.0, 0.18, t));
    c = mix(c, vec3(1.3, 0.3, 0.045), smoothstep(0.15, 0.38, t));
    c = mix(c, vec3(2.6, 1.0, 0.2), smoothstep(0.35, 0.6, t));
    c = mix(c, vec3(3.8, 2.4, 0.75), smoothstep(0.58, 0.82, t));
    return mix(c, vec3(5.0, 4.3, 3.0), smoothstep(0.8, 1.0, t));
  }
  void main() {
    // MSAA can evaluate edge samples outside the quad, so every interpolated input is clamped.
    vec2 uv = clamp(vUv, 0.0, 1.0);
    vec2 p = uv * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 >= 1.0) discard;
    float heat = clamp(vB.x, 0.0, 1.0);
    float smoke = clamp(vB.y, 0.0, 1.0);
    float sc = 0.8 + 0.4 * fract(vB.z * 7.31);
    vec4 n1 = texture2D(tNoise, uv * 0.9 * sc + vec2(vB.z, vB.z * 1.37));
    vec4 n2 = texture2D(tNoise, uv * 2.3 * sc + vec2(vB.z * 2.11, vB.z * 0.73));
    float n = n1.b * 0.6 + n2.b * 0.25 + n2.r * 0.15;
    float sph = sqrt(max(1.0 - r2, 0.0));
    // Billowy silhouette with soft edges that always reaches zero before the quad's edge (no circle outline).
    float dens = smoothstep(0.03, 0.72, sph + (n - 0.5) * 1.15) * (1.0 - smoothstep(0.6, 1.0, sqrt(r2)));
    if (dens < 0.003) discard;
    // Mostly noise-driven normals: lumpy lighting inside the puff rather than a lit ball with a rim.
    vec3 nrm = normalize(vec3((vCS.x * p.x - vCS.y * p.y) * 0.6, (vCS.y * p.x + vCS.x * p.y) * 0.6, sph + 0.6) + vec3(n2.g - 0.5, n1.r - 0.5, 0.0) * 1.3);
    float lam = clamp(dot(nrm, uLight) * 0.5 + 0.5, 0.0, 1.0);
    float under = clamp(vC.w, 0.0, 4.0) * clamp(0.5 - nrm.y * 0.6, 0.0, 1.0);
    // Thin smoke lets more light through than the dense core; a low light behind it brightens it a little.
    float thin = 1.0 - dens;
    vec3 smokeCol = clamp(vC.rgb, 0.0, 1.0) * (uAmb + uKey * lam) * (0.75 + 0.5 * n) * mix(0.8, 1.2, thin) + vec3(1.4, 0.5, 0.13) * under;
    smokeCol += clamp(vC.rgb, 0.0, 1.0) * uKey * smoothstep(0.1, 1.0, -uLight.z) * 0.35;
    float T = clamp(heat * (0.45 + 0.55 * dens) * (0.75 + 0.5 * n), 0.0, 1.0);
    vec3 fire = fireRamp(T) * smoothstep(0.02, 0.2, heat);
    float aFire = dens * smoothstep(0.08, 0.5, heat) * 0.9;
    float aSmoke = dens * smoke;
    float a = clamp(max(aSmoke, aFire), 0.0, 1.0);
    vec3 col = smokeCol * aSmoke * (1.0 - smoothstep(0.12, 0.55, heat)) + fire * dens;
    // Soft contact with the ground instead of a hard cut where the quad dips below it.
    float gf = smoothstep(0.0, max(clamp(vR, 0.0, 200.0) * 0.4, 0.4), vY);
    gl_FragColor = vec4(clamp(col, 0.0, 16.0) * gf, a * gf);
  }`;

const ringFrag = /* glsl */ `
  uniform sampler2D tNoise; uniform float uR; uniform float uW; uniform float uI; uniform float uRmax; uniform vec3 uCol; uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vec2 p = clamp(vUv, 0.0, 1.0) * 2.0 - 1.0;
    float r = length(p) * uRmax;
    float ang = atan(p.y, p.x) / 6.2831853;
    float n = texture2D(tNoise, vec2(ang * 5.0 + uSeed, r * 0.015)).g;
    float w = max(uW, 0.5);
    float ring = exp(-pow((r - uR) / w, 2.0)) * (0.55 + 0.9 * n);
    float inner = smoothstep(uR, 0.0, r) * 0.18;
    gl_FragColor = vec4(uCol * clamp(uI, 0.0, 4.0) * (ring + inner), 0.0);
  }`;

const scorchFrag = /* glsl */ `
  uniform sampler2D tNoise; uniform float uA; uniform float uEmber; uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vec2 p = clamp(vUv, 0.0, 1.0) * 2.0 - 1.0;
    float r = length(p);
    float ang = atan(p.y, p.x) / 6.2831853;
    float n = texture2D(tNoise, p * 0.6 + uSeed).r * 0.6 + texture2D(tNoise, p * 1.7 + uSeed * 2.0).g * 0.4;
    // Blast streaks radiating out from the impact.
    float streak = texture2D(tNoise, vec2(ang * 7.0 + uSeed, r * 0.18)).b;
    float m = smoothstep(1.0, 0.4, r + (n - 0.5) * 0.5 - (streak - 0.4) * 0.35 * r);
    float core = smoothstep(0.6, 0.0, r);
    float a = clamp(m * (0.5 + 0.45 * core) * clamp(uA, 0.0, 1.0), 0.0, 1.0);
    float ember = smoothstep(0.55, 0.85, n) * core * clamp(uEmber, 0.0, 1.0);
    gl_FragColor = vec4(vec3(0.016, 0.013, 0.011) * a + vec3(3.0, 0.9, 0.18) * ember, a);
  }`;

const quadVert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function chunkGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  const rng = createRng(77);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rng.range(0.6, 1.3), p.getY(i) * rng.range(0.35, 0.8), p.getZ(i) * rng.range(0.6, 1.3));
  g.computeVertexNormals();
  return g;
}

/** Seeded description of one explosion; everything time-dependent is evaluated from it in update(). */
function describe({ t, seed, x, y, bottom, top, drift, gravity }) {
  const r = createRng(seed >>> 0);
  const up = new THREE.Vector3().subVectors(top, bottom);
  const cap = Array.from({ length: 22 }, () => ({
    az: r.range(0, Math.PI * 2),
    phi: r.range(-1.3, 2.4),
    k: r.range(0.45, 1),
    lift: r.range(0.7, 1.25),
    R: r.range(5, 8.5),
    tau: r.range(0.32, 0.62),
    soot: r.next(),
    seed: r.range(0, 10),
    rot: r.range(0, Math.PI * 2),
    spin: r.range(-0.5, 0.5),
  }));
  const ground = Array.from({ length: 8 }, (_, i) => ({ az: (i / 8) * Math.PI * 2 + r.range(-0.3, 0.3), d: r.range(18, 34), R: r.range(4.5, 7), seed: r.range(0, 10), rot: r.range(0, 6.3) }));
  const engulf = Array.from({ length: 13 }, (_, i) => ({ u: Math.min(1, Math.max(0, i / 12 + r.range(-0.03, 0.03))), R: r.range(7, 10.5), dx: r.range(-2.5, 2.5), seed: r.range(0, 10), rot: r.range(0, 6.3) }));
  const skirt = Array.from({ length: 30 }, (_, i) => ({ az: (i / 30) * Math.PI * 2 + r.range(-0.1, 0.1), k: r.range(0.72, 1.02), R: r.range(0.8, 1.25), seed: r.range(0, 10), rot: r.range(0, 6.3), spin: r.sign() * r.range(0.3, 0.8) }));
  const column = Array.from({ length: 76 }, (_, j) => ({
    te: 0.16 + j * 0.054,
    ox: r.range(-4, 4),
    oz: r.range(-4, 4),
    h: r.range(0.85, 1.12),
    w: r.range(0, 6.3),
    R: r.range(0.85, 1.15),
    seed: r.range(0, 10),
    rot: r.range(0, 6.3),
  }));
  // Mars throws debris higher for the same speed, so speeds scale to keep the arcs in frame.
  const vs = Math.sqrt(gravity / 9.81);
  const debris = Array.from({ length: N_DEBRIS }, () => {
    const az = r.range(0, Math.PI * 2);
    const el = r.range(0.35, 1.2);
    const speed = r.range(15, 34) * vs;
    const v = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(speed);
    const p0 = new THREE.Vector3(x + r.range(-4, 4), y + r.range(3, 14), r.range(-4, 4));
    const land = (v.y + Math.sqrt(v.y * v.y + 2 * gravity * p0.y)) / gravity;
    const plate = r.chance(0.35);
    return {
      p0,
      v,
      land,
      size: r.range(0.55, 1.6),
      scale: plate ? new THREE.Vector3(2.2, 0.35, 1.6) : new THREE.Vector3(1, 1, 1),
      axis: new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize(),
      spin: r.range(3, 10),
      burn: r.range(1.6, 3.6),
      seed: r.range(0, 10),
    };
  });
  return { t0: t, x, y, bottom: bottom.clone(), up, drift, gravity, cap, ground, engulf, skirt, column, debris, ringSeed: r.next(), scorchSeed: r.next(), scorchR: r.range(15, 20), scorchRot: r.range(0, 6.3) };
}

/**
 * Crash explosions in 3D: a fireball that cools from white-yellow through orange to smoke and rolls up into
 * a cap, a ground shockwave and dust skirt, burning debris on arcs with smoke trails, a tall drifting smoke
 * column, a ground scorch and a light pulse. All brightness ramps in over several frames.
 */
export function createExplosions() {
  const group = new THREE.Group();
  const noise = puffNoise();
  let pal = null;

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const attrs = ['iA', 'iB', 'iC'].map((name) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    return a;
  });
  geo.instanceCount = 0;
  const puffMat = new THREE.ShaderMaterial({
    uniforms: { tNoise: { value: noise }, uLight: { value: new THREE.Vector3(0, 1, 0) }, uKey: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() } },
    vertexShader: puffVert,
    fragmentShader: puffFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    fog: false,
  });
  const puffs = new THREE.Mesh(geo, puffMat);
  puffs.frustumCulled = false;
  puffs.renderOrder = 1;
  puffs.visible = false;

  const debrisMesh = new THREE.InstancedMesh(chunkGeometry(), new THREE.MeshStandardMaterial({ color: 0x3b3735, metalness: 0.6, roughness: 0.5 }), N_DEBRIS * MAX_ACTIVE);
  debrisMesh.frustumCulled = false;
  debrisMesh.count = 0;
  debrisMesh.visible = false;
  debrisMesh.castShadow = true;

  const ringMeshes = Array.from({ length: MAX_ACTIVE }, () => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { tNoise: { value: noise }, uR: { value: 0 }, uW: { value: 1 }, uI: { value: 0 }, uRmax: { value: 95 }, uCol: { value: new THREE.Color() }, uSeed: { value: 0 } },
      vertexShader: quadVert,
      fragmentShader: ringFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      fog: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(190, 190).rotateX(-Math.PI / 2), mat);
    m.renderOrder = -1;
    m.visible = false;
    return m;
  });
  const scorchMeshes = Array.from({ length: MAX_SCORCH }, () => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { tNoise: { value: noise }, uA: { value: 0 }, uEmber: { value: 0 }, uSeed: { value: 0 } },
      vertexShader: quadVert,
      fragmentShader: scorchFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      fog: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat);
    m.renderOrder = -2;
    m.visible = false;
    return m;
  });
  const light = new THREE.PointLight(0xffa060, 0, 0, 2);
  group.add(light, puffs, debrisMesh, ...ringMeshes, ...scorchMeshes);

  let active = [];
  let scorches = [];
  const stage = new Float32Array(MAX_PUFFS * 12);
  const keys = new Float32Array(MAX_PUFFS);
  const order = new Uint16Array(MAX_PUFFS);
  let n = 0;
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const sv = new THREE.Vector3();

  /** pull: metres to move the puff toward the camera, so it draws over the solid wreck it belongs to. */
  function emit(x, y, z, r, heat, smoke, seed, rot, col, glow, pull = 0) {
    if (n >= MAX_PUFFS || r <= 0.01 || (heat <= 0.003 && smoke <= 0.003)) return;
    x -= camDir.x * pull;
    y -= camDir.y * pull;
    z -= camDir.z * pull;
    const o = n * 12;
    stage[o] = x;
    stage[o + 1] = y;
    stage[o + 2] = z;
    stage[o + 3] = r;
    stage[o + 4] = heat;
    stage[o + 5] = smoke;
    stage[o + 6] = seed;
    stage[o + 7] = rot;
    stage[o + 8] = col[0];
    stage[o + 9] = col[1];
    stage[o + 10] = col[2];
    stage[o + 11] = glow;
    keys[n] = (x - camPos.x) * camDir.x + (y - camPos.y) * camDir.y + (z - camPos.z) * camDir.z;
    n++;
  }

  function capCenter(e, tau, out) {
    return out.set(e.x + e.drift * tau * 0.55, e.y + 6 + 112 * grow(tau, 3.8), 0);
  }

  function puffsFor(e, tau) {
    const smokeCol = pal.boomSmoke;
    const dustCol = pal.boomDust;
    const C = capCenter(e, tau, v3).clone();
    // Every element below fades to exactly zero before it stops being emitted (no popping).
    const late = (tau < 4 ? 1 : Math.exp(-(tau - 4) / 5)) * fadeOut(tau, LIFE - 4, LIFE - 0.5);

    // Fireball rolling up into a cap: puffs on a vortex ring that grows and turns over as it rises.
    const Rv = 3 + 13 * grow(tau, 0.25) + 2.2 * tau;
    const rv = 2 + 8 * grow(tau, 0.25) + 1.3 * tau;
    for (const c of e.cap) {
      const phi = c.phi - 0.45 * tau;
      const ring = Rv + rv * c.k * Math.cos(phi);
      const r = c.R * (0.35 + 0.65 * grow(tau, 0.14)) * (1 + 0.42 * tau);
      // Sooty puffs cool sooner, so dark rolls show on the fireball while its core still burns.
      const heat = ramp(tau) * Math.exp(-tau / (c.tau * (1.15 - 0.45 * c.soot))) * (0.8 + 0.2 * (1 - c.soot));
      const smoke = smooth(0.06 + 0.4 * (1 - c.soot), 0.9, tau) * 0.92 * late;
      emit(C.x + Math.cos(c.az) * ring, Math.max(C.y + rv * c.k * Math.sin(phi) * c.lift, r * 0.3), C.z + Math.sin(c.az) * ring, r, heat, smoke, c.seed + tau * 0.04, c.rot + c.spin * tau, smokeCol, Math.exp(-tau / 0.4));
    }
    // White-hot core.
    if (tau < 2.5) {
      for (let k = 0; k < 4; k++) {
        const a = k * 1.7;
        const r = (5 + 9 * grow(tau, 0.12)) * (1 + 0.3 * tau);
        const smoke = smooth(0.4, 1.2, tau) * 0.6 * fadeOut(tau, 1.5, 2.45);
        emit(C.x + Math.cos(a) * 3, C.y + Math.sin(a) * 2, C.z + Math.sin(a) * 3, r, ramp(tau) * Math.exp(-tau / 0.3), smoke, k * 2.3 + tau * 0.05, a, smokeCol, 0.8 * Math.exp(-tau / 0.5));
      }
    }
    // Burning propellant spreading low across the pad.
    if (tau < 3.5) {
      for (const g of e.ground) {
        const d = g.d * grow(tau, 0.3);
        const r = g.R * (0.5 + 0.5 * grow(tau, 0.2)) * (1 + 0.25 * tau);
        const smoke = smooth(0.4, 1.4, tau) * 0.55 * Math.exp(-Math.max(0, tau - 1.6) / 1.2) * fadeOut(tau, 2.6, 3.45);
        emit(e.x + Math.cos(g.az) * d, r * 0.5, Math.sin(g.az) * d * 0.8, r, ramp(tau) * 0.9 * Math.exp(-tau / 0.55), smoke, g.seed, g.rot, smokeCol, 0.5 * Math.exp(-tau / 0.6));
      }
    }
    // Fire running up the whole body at impact, so the wreck is engulfed as it disappears.
    if (tau < 6) {
      for (const g of e.engulf) {
        // Burns orange rather than white, and is mostly lit by frame 4, before the hull disappears on frame 5.
        const a = tau;
        if (a <= 0) continue;
        // Wider and longer-lived low down; the upper hull flashes over and breaks up into thin smoke.
        const r = g.R * (1.2 - 0.35 * g.u) * (0.75 + 0.25 * grow(a, 0.08)) * (1 + 0.45 * a);
        const burst = 7 * grow(a, 0.5) * (0.4 + g.u);
        const y = Math.max(e.bottom.y + e.up.y * g.u + (2.2 - 3.5 * g.u) * a, r * 0.4);
        const smoke = smooth(0.15, 0.6, a) * 0.65 * (1 - 0.6 * g.u) * Math.exp(-Math.max(0, a - 2.2 + 1.4 * g.u) / 1.4) * fadeOut(a, 4.6, 5.9);
        // Pulled in front of the wreck so it is covered before the hull disappears.
        emit(e.bottom.x + e.up.x * g.u + g.dx * (1 + burst * 0.3) + e.drift * a * 0.4, y, e.bottom.z + e.up.z * g.u, r, ramp(a, 0.09) * 0.6 * Math.exp(-a / (0.32 - 0.12 * g.u)), smoke, g.seed + a * 0.04, g.rot, smokeCol, 0.6 * Math.exp(-a / 0.4), 6);
      }
    }
    // Dust skirt rolling outward behind the shockwave.
    if (tau < 9) {
      const Rs = 70 * grow(tau, 0.55);
      for (const s of e.skirt) {
        const d = Rs * s.k + 3;
        const r = (3 + 9 * grow(tau, 0.6) + 1.5 * tau) * s.R;
        const a = smooth(0.03, 0.35, tau) * 0.7 * Math.exp(-tau / 2.6) * fadeOut(tau, 7, 8.9);
        emit(e.x + Math.cos(s.az) * d, r * 0.42, Math.sin(s.az) * d * 0.85, r, 0.14 * Math.exp(-tau / 0.15) * ramp(tau), a, s.seed, s.rot + s.spin * tau, dustCol, 0.6 * Math.exp(-tau / 0.4));
      }
    }
    // Smoke column: puffs released over ~4 s, rising and widening, drifting downwind.
    for (const c of e.column) {
      const a = tau - c.te;
      if (a <= 0 || a > 14) continue;
      const fade = clamp01(1 - c.te / 4.6);
      const r = (4 + 6.5 * a ** 0.55) * c.R;
      const y = e.y + 3 + 118 * grow(a, 4.2) * c.h;
      const wob = Math.sin(a * 0.7 + c.w) * 3 * Math.min(1, a / 3);
      const smoke = smooth(0, 0.5, a) * 0.7 * Math.exp(-Math.max(0, a - 3) / 4.5) * (0.35 + 0.65 * fade) * fadeOut(a, 10.5, 13.9) * late;
      const heat = 0.55 * Math.exp(-a / 0.25) * Math.exp(-c.te / 1.0);
      emit(e.x + c.ox + e.drift * a + wob, y, c.oz + wob * 0.4, r, heat, smoke, c.seed, c.rot + a * 0.08, smokeCol, 0.9 * Math.exp(-c.te / 0.5) * Math.exp(-a / 0.5));
    }
    // Burning debris: a glow on each chunk and a trail that cools from flame to smoke. Trail puffs sit on a
    // fixed 0.04 s grid of release times, so they don't swim from frame to frame.
    for (const d of e.debris) {
      const tFly = Math.min(tau, d.land);
      const burnLeft = (t) => clamp01(1 - t / d.burn);
      const pos = (t, out) => out.set(d.p0.x + d.v.x * t, d.p0.y + d.v.y * t - 0.5 * e.gravity * t * t, d.p0.z + d.v.z * t);
      const last = Math.min(tFly, d.burn + 0.3);
      for (let k = Math.max(1, Math.ceil((tau - 1.6) / 0.04)); k * 0.04 <= last; k++) {
        const te = k * 0.04;
        const a = tau - te;
        const b = burnLeft(te);
        pos(te, sv);
        const smoke = 0.5 * smooth(0, 0.08, a) * Math.exp(-a / 0.75) * (0.4 + 0.6 * b) * fadeOut(a, 1.15, 1.58) * smooth(d.burn + 0.3, d.burn, te);
        emit(sv.x, sv.y + 0.8 * a, sv.z, 0.6 + d.size * 0.5 + 2.2 * a, 0.75 * Math.exp(-a / 0.1) * b * smooth(0, 0.035, a), smoke, d.seed + te, te * 3, smokeCol, 0.3 * b);
      }
      if (tau < d.burn) {
        pos(tFly, sv);
        emit(sv.x, sv.y, sv.z, 0.7 + d.size * 0.7, 0.85 * Math.sqrt(burnLeft(tau)) * ramp(tau), 0, d.seed, tau * 2, smokeCol, 0, d.size * 1.6 + 0.6);
      }
      // Wreckage that lands still burning smoulders for a while.
      if (tau > d.land && d.land < d.burn) {
        pos(d.land, sv);
        const end = Math.min(tau, d.burn + 1.5);
        for (let k = Math.ceil(d.land / 0.12); k * 0.12 <= end; k++) {
          const te = k * 0.12;
          const a = tau - te;
          if (a > 2) continue;
          const fadeIn = smooth(d.land, d.land + 0.3, te) * smooth(d.burn + 1.5, d.burn + 0.9, te);
          emit(sv.x, 0.5 + 1.2 * a, sv.z, 0.8 + 1.5 * a, 0.35 * Math.exp(-a / 0.15) * burnLeft(te), 0.4 * Math.exp(-a / 1.2) * fadeOut(a, 1.4, 1.95) * fadeIn, d.seed + te, te, smokeCol, 0.2);
        }
      }
    }
  }

  return {
    group,
    /** Colours, key light and gravity of the current map (STARBASE_FX / MARS_FX). Call before spawning. */
    setPalette(p) {
      pal = p;
      puffMat.uniforms.uKey.value.setRGB(...pal.key);
      puffMat.uniforms.uAmb.value.setRGB(...pal.ambient);
    },
    /**
     * Starts an explosion at sim time t. In the group's frame: bottom/top: ends of the wreck's axis; x: impact x (m);
     * y: impact height above the ground (m), where the fireball, smoke column and debris start.
     * drift: wind (m/s, + is +x); seed: from the sim's fx stream.
     */
    spawn({ t, seed, x, y = 0, bottom, top, drift }) {
      const sign = drift >= 0 ? 1 : -1;
      const e = describe({ t, seed, x, y, bottom, top, drift: sign * Math.min(6, Math.max(1.6, Math.abs(drift) * 2)), gravity: pal.gravity });
      active.push(e);
      if (active.length > MAX_ACTIVE) active.shift();
      scorches.push({ t0: t, x, seed: e.scorchSeed, r: e.scorchR, rot: e.scorchRot });
      if (scorches.length > MAX_SCORCH) scorches.shift();
    },
    /** Evaluates every explosion at sim time t and uploads the sorted puffs. Call after the camera moves. */
    update(t, camera) {
      // A frame drawn between sim steps can be a fraction of a step before the impact; a new game resets
      // time, which is what removes old explosions.
      active = active.filter((e) => t > e.t0 - 0.1 && t - e.t0 < LIFE);
      scorches = scorches.filter((s) => t > s.t0 - 0.1 && t - s.t0 < SCORCH_LIFE + 4);
      camera.updateMatrixWorld();
      // Puffs are placed and sorted in the group's frame, which free flight turns onto a crash site anywhere on the planet.
      const turn = group.getWorldQuaternion(q);
      puffMat.uniforms.uLight.value.copy(pal.keyDir).applyQuaternion(turn).transformDirection(camera.matrixWorldInverse);
      group.worldToLocal(camera.getWorldPosition(camPos));
      camera.getWorldDirection(camDir).applyQuaternion(turn.invert());

      n = 0;
      let li = 0;
      const lp = new THREE.Vector3();
      let dn = 0;
      ringMeshes.forEach((m) => (m.visible = false));
      active.forEach((e, i) => {
        const tau = Math.max(0, t - e.t0);
        puffsFor(e, tau);
        // Light pulse: ramps up over ~4 frames, a sharp peak, then a flickering glow that dies away.
        if (tau < 5) {
          const L = 46000 * easeIn(tau, 0.12) * (0.72 * Math.exp(-tau / 0.24) + 0.28 * Math.exp(-tau / 1.1)) * (0.88 + 0.12 * Math.sin(tau * 29 + e.ringSeed * 9)) * fadeOut(tau, 4, 4.95);
          capCenter(e, tau, v3);
          lp.addScaledVector(v3.setY(Math.min(v3.y, e.y + 30) + 4).setZ(8), L);
          li += L;
        }
        const ring = ringMeshes[i];
        if (tau < 2.5) {
          const u = ring.material.uniforms;
          u.uR.value = 85 * grow(tau, 0.32);
          u.uW.value = 2.5 + 7 * tau;
          u.uI.value = 1.6 * easeIn(tau, 0.1) * Math.exp(-tau / 0.3);
          u.uSeed.value = e.ringSeed;
          u.uCol.value.setRGB(...pal.ring);
          ring.position.set(e.x, 0.12, 0);
          ring.visible = true;
        }
        for (const d of e.debris) {
          const tf = Math.min(tau, d.land);
          sv.set(d.p0.x + d.v.x * tf, Math.max(0.3, d.p0.y + d.v.y * tf - 0.5 * e.gravity * tf * tf), d.p0.z + d.v.z * tf);
          q.setFromAxisAngle(d.axis, d.spin * tf);
          m4.compose(sv, q, v3.copy(d.scale).multiplyScalar(d.size));
          debrisMesh.setMatrixAt(dn++, m4);
        }
      });
      debrisMesh.count = dn;
      debrisMesh.visible = dn > 0;
      if (dn) debrisMesh.instanceMatrix.needsUpdate = true;
      light.intensity = li;
      if (li > 0) light.position.copy(lp.multiplyScalar(1 / li));

      scorchMeshes.forEach((m, i) => {
        const s = scorches[i];
        m.visible = !!s;
        if (!s) return;
        const tau = t - s.t0;
        m.position.set(s.x, 0.06, 0);
        m.scale.set(s.r, 1, s.r);
        m.rotation.y = s.rot;
        const u = m.material.uniforms;
        u.uA.value = smooth(0.05, 0.6, tau) * fadeOut(tau, SCORCH_LIFE, SCORCH_LIFE + 3.5);
        u.uEmber.value = ramp(tau) * Math.exp(-tau / 2.2);
        u.uSeed.value = s.seed;
      });

      // Back to front, so smoke in front of the fireball hides it and not the other way round.
      for (let i = 0; i < n; i++) order[i] = i;
      const idx = order.subarray(0, n).sort((a, b) => keys[b] - keys[a]);
      const [A, B, Cc] = attrs;
      for (let j = 0; j < n; j++) {
        const o = idx[j] * 12;
        A.array.set(stage.subarray(o, o + 4), j * 4);
        B.array.set(stage.subarray(o + 4, o + 8), j * 4);
        Cc.array.set(stage.subarray(o + 8, o + 12), j * 4);
      }
      for (const a of attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
      geo.instanceCount = n;
      puffs.visible = n > 0;
    },
  };
}
