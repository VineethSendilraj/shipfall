import * as THREE from 'three';
import { hash01 } from '../rng.js';
import { ENGINE_Y } from './booster.js';

const plumeVert = /* glsl */ `
  varying vec2 vUv; varying float vFres;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFres = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }`;

// uCover is how much of the background a layer hides: 0 is pure glow, which a bright daytime sky washes out.
const plumeFrag = /* glsl */ `
  uniform float uTime; uniform float uAmp; uniform vec3 uColA; uniform vec3 uColB; uniform float uDiamonds; uniform float uPow;
  uniform float uCover;
  varying vec2 vUv; varying float vFres;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    float v = 1.0 - vUv.y;
    float edge = pow(clamp(vFres, 1e-4, 1.0), uPow);
    float flick = 0.65 + 0.35 * n2(vec2(vUv.x * 10.0, v * 7.0 - uTime * 16.0));
    // Many engines merging into one column: fine vertical streaks that drift with the flow.
    float streak = 0.55 + 0.45 * n2(vec2(vUv.x * 46.0, v * 2.5 - uTime * 9.0));
    float knot = pow(0.5 + 0.5 * cos(v * 38.0 - uTime * 1.5), 8.0) * smoothstep(0.8, 0.1, v);
    float fade = smoothstep(1.0, 0.18, v) * smoothstep(0.0, 0.03, v);
    vec3 col = mix(uColA, uColB, smoothstep(0.0, 0.75, v));
    float body = edge * fade * uAmp * (1.0 - 0.6 * uDiamonds + 1.6 * uDiamonds * knot);
    vec3 rgb = col * body * flick * streak * (1.0 + 2.0 * uDiamonds * knot);
    gl_FragColor = vec4(rgb, min(1.0, body * uCover));
  }`;

function plumeLayer(rTop, rBot, colA, colB, { diamonds = 0, pow = 1.6, cover = 0 } = {}) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, 1, 40, 12, true);
  geo.translate(0, -0.5, 0);
  // Transparent objects sort by bounding-sphere centre; centring every layer on its origin makes the layers of
  // one plume tie, so they draw in the order they were made (outer to core) from any camera.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uColA: { value: new THREE.Color(...colA) },
      uColB: { value: new THREE.Color(...colB) },
      uDiamonds: { value: diamonds },
      uPow: { value: pow },
      uCover: { value: cover },
    },
    vertexShader: plumeVert,
    fragmentShader: plumeFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// Steam or dust at the foot of the plume, lit by the flame.
const FLAME_LIT = new THREE.Color(1.5, 1.05, 0.7);

/**
 * Plume of one vehicle. update() takes how far the exhaust can reach (alt) and the engine exit's height above the
 * ground, which raises steam or dust once the blast gets there; setPalette() takes the map's fx colours.
 */
export function createPlume() {
  const group = new THREE.Group();
  group.position.y = ENGINE_Y;
  const outer = plumeLayer(5.2, 7.5, [2.4, 0.7, 0.12], [0.9, 0.22, 0.04], { pow: 1.1, cover: 1.3 });
  const mid = plumeLayer(4.1, 2.6, [3.2, 1.4, 0.35], [1.8, 0.5, 0.08], { diamonds: 0.45, pow: 1.4, cover: 1.1 });
  const core = plumeLayer(2.9, 0.5, [4.0, 3.6, 4.2], [3.0, 1.6, 0.5], { diamonds: 0.9, pow: 2.0, cover: 1 });
  // Exhaust striking the ground: a squat dome of steam or dust, flipped so it is densest at the ground.
  const splash = plumeLayer(1, 0.4, [1, 1, 1], [1, 1, 1], { pow: 1.6, cover: 0.9 });
  splash.rotation.x = Math.PI;
  group.add(outer, mid, core, splash);
  const layers = [
    { mesh: outer, len: 1.25, amp: 0.55 },
    { mesh: mid, len: 1.0, amp: 0.8 },
    { mesh: core, len: 0.6, amp: 1.0 },
  ];
  const all = [...layers.map((L) => L.mesh), splash];
  return {
    group,
    setPalette({ vapor, dust }) {
      const u = splash.material.uniforms;
      u.uColB.value.setRGB(...vapor.map((v, i) => 0.7 * (v + dust[i])));
      u.uColA.value.copy(u.uColB.value).multiply(FLAME_LIT);
    },
    update(throttle, t, alt, ground = alt) {
      const on = throttle > 0.02;
      group.visible = on;
      if (!on) return;
      const len = 10 + 46 * Math.min(1, throttle * 1.2);
      const width = 0.5 + 0.5 * Math.min(1, throttle * 1.4);
      const amp = Math.min(1, 0.35 + throttle * 1.2);
      for (const L of layers) {
        L.mesh.scale.set(width, Math.min(len * L.len, alt + 6), width);
        L.mesh.material.uniforms.uAmp.value = L.amp * amp;
      }
      for (const m of all) m.material.uniforms.uTime.value = t;
      // The blast reaches the ground a little before the visible flame does.
      const hit = Math.min(1, Math.max(0, (len * 1.25 + 15 - ground) / 25));
      splash.visible = hit > 0;
      splash.position.y = -ground;
      splash.scale.set(9 + 22 * hit, 5 + 9 * hit, 9 + 22 * hit);
      splash.material.uniforms.uAmp.value = hit * amp;
    },
  };
}

const pointsVert = /* glsl */ `
  attribute float aSize; attribute vec4 aColor; attribute float aSeed;
  uniform float uScale;
  varying vec4 vColor; varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 512.0);
    gl_Position = projectionMatrix * mv;
    vColor = aColor; vSeed = aSeed;
    vColor.a *= smoothstep(12.0, 55.0, -mv.z);
  }`;

const pointsFrag = /* glsl */ `
  uniform float uSoft;
  varying vec4 vColor; varying float vSeed;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a = mix(a * a, a * (0.55 + 0.45 * n2(c * 5.0 + vSeed * 17.0)) , uSoft);
    a *= vColor.a;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }`;

function makePoints(max, additive, soft) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uSoft: { value: soft } },
    vertexShader: pointsVert,
    fragmentShader: pointsFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

const FIRE = [
  [2.2, 1.3, 0.5],
  [2.0, 0.75, 0.16],
  [1.2, 0.34, 0.06],
  [0.35, 0.07, 0.015],
];

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function fireColor(u) {
  const s = Math.min(0.999, u) * (FIRE.length - 1);
  const i = Math.floor(s);
  return lerp3(FIRE[i], FIRE[i + 1], s - i);
}

/** Renders the sim's particle list in 3D. Sim x/y map onto the play plane; depth is a stable per-particle hash. */
export function createParticles(toX, toY) {
  const MAX = 1000;
  const glow = makePoints(MAX, true, 0);
  const smoke = makePoints(MAX, false, 1);
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 6), 3).setUsage(THREE.DynamicDrawUsage));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(400 * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const streaks = new THREE.LineSegments(
    streakGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  streaks.frustumCulled = false;
  const group = new THREE.Group();
  group.add(smoke, glow, streaks);
  // Base colours of vapor (k 3), ground dust (k 4) and smoke; the map can swap them (Mars dust is red).
  let pal = { vapor: [0.55, 0.58, 0.62], dust: [0.34, 0.3, 0.26], smoke: [0.085, 0.085, 0.09] };

  return {
    group,
    setPalette({ vapor, dust, smoke: smokeCol }) {
      pal = { vapor, dust, smoke: smokeCol };
    },
    setScale(s) {
      glow.material.uniforms.uScale.value = s;
      smoke.material.uniforms.uScale.value = s;
    },
    update(particles, engines) {
      const gp = glow.geometry.attributes;
      const sp = smoke.geometry.attributes;
      const lp = streakGeo.attributes;
      let ng = 0;
      let ns = 0;
      let nl = 0;
      for (const p of particles) {
        const u = p.t / p.life;
        const h = hash01(p.id * 7 + 3);
        const h2 = hash01(p.id * 13 + 5);
        const X = toX(p.x);
        const Y = toY(p.y);
        if (p.k === 5) {
          if (nl >= 400) continue;
          const z = (h - 0.5) * 140;
          const a = Math.sin(Math.PI * u) * 0.09;
          lp.position.setXYZ(nl * 2, X, Y, z);
          lp.position.setXYZ(nl * 2 + 1, X - p.vx * 0.012 * (p.size / 60), Y, z);
          lp.color.setXYZ(nl * 2, a, a * 1.1, a * 1.3);
          lp.color.setXYZ(nl * 2 + 1, 0, 0, 0);
          nl++;
          continue;
        }
        if ((p.k === 2 || p.k === 6) && nl < 400) {
          // Sparks read as short hot streaks along their velocity, not as round dots.
          const fade = (1 - u) * (1 - u);
          const hot = p.k === 2 ? [3.2, 1.7, 0.55] : [1.6, 2.4, 3.0];
          const tz = (h - 0.5) * 10;
          lp.position.setXYZ(nl * 2, X, Y, tz);
          lp.position.setXYZ(nl * 2 + 1, toX(p.x - p.vx * 0.045), toY(p.y - p.vy * 0.045), tz);
          lp.color.setXYZ(nl * 2, hot[0] * fade, hot[1] * fade, hot[2] * fade);
          lp.color.setXYZ(nl * 2 + 1, 0, 0, 0);
          nl++;
        }
        if (p.k === 0 || p.k === 2 || p.k === 6) {
          if (ng >= MAX) continue;
          let c;
          let size;
          let a;
          let z;
          if (p.k === 0) {
            c = fireColor(u);
            size = (p.size + p.grow * p.t) / 4 * 1.25;
            a = (1 - u) * 0.24;
            z = (h - 0.5) * (5 + u * 14);
          } else {
            c = p.k === 6 ? [2.2, 3.4, 4] : [6, 3.6, 1.2];
            size = p.k === 6 ? 0.3 : 0.32;
            a = 1 - u * u;
            z = (h - 0.5) * 10;
          }
          gp.position.setXYZ(ng, X, Y, z);
          gp.aColor.setXYZW(ng, c[0], c[1], c[2], a);
          gp.aSize.setX(ng, size);
          gp.aSeed.setX(ng, h2);
          ng++;
        } else {
          if (ns >= MAX) continue;
          const size = (p.size + p.grow * p.t) / 4 * (p.k === 3 ? 1.1 : p.k === 4 ? 1.9 : 1.6);
          let a;
          let base;
          if (p.k === 3) {
            a = (1 - u) * 0.45;
            base = pal.vapor;
          } else if (p.k === 4) {
            a = Math.sin(Math.PI * Math.min(1, u * 1.4)) * 0.8;
            base = pal.dust;
          } else {
            a = Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.3;
            base = pal.smoke;
          }
          let glowAmt = 0;
          for (const e of engines) {
            const dx = X - e.x;
            const dy = Y - e.y;
            glowAmt += (e.power * 260) / (dx * dx + dy * dy + 400);
          }
          glowAmt = Math.min(glowAmt, 1.1);
          const z = (h - 0.5) * (p.k === 3 ? 3 : 10 + u * 26);
          sp.position.setXYZ(ns, X, Y, z);
          sp.aColor.setXYZW(ns, base[0] + glowAmt * 0.32, base[1] + glowAmt * 0.14, base[2] + glowAmt * 0.04, a);
          sp.aSize.setX(ns, size);
          sp.aSeed.setX(ns, h2);
          ns++;
        }
      }
      for (const [obj, n] of [
        [glow, ng],
        [smoke, ns],
      ]) {
        obj.geometry.setDrawRange(0, n);
        for (const k of ['position', 'aColor', 'aSize', 'aSeed']) obj.geometry.attributes[k].needsUpdate = true;
      }
      streakGeo.setDrawRange(0, nl * 2);
      lp.position.needsUpdate = true;
      lp.color.needsUpdate = true;
    },
  };
}
