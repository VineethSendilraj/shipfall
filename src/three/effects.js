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

const plumeFrag = /* glsl */ `
  uniform float uTime; uniform float uAmp; uniform vec3 uColA; uniform vec3 uColB; uniform float uDiamonds; uniform float uPow;
  varying vec2 vUv; varying float vFres;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    float v = 1.0 - vUv.y;
    float edge = pow(max(vFres, 1e-4), uPow);
    float flick = 0.65 + 0.35 * n2(vec2(vUv.x * 10.0, v * 7.0 - uTime * 16.0));
    float dia = 1.0 - uDiamonds + uDiamonds * (0.55 + 0.45 * cos(v * 34.0 - uTime * 2.0));
    float fade = smoothstep(1.0, 0.18, v) * smoothstep(0.0, 0.03, v);
    vec3 col = mix(uColA, uColB, smoothstep(0.0, 0.75, v));
    float a = edge * fade * flick * dia * uAmp;
    gl_FragColor = vec4(col * a, 0.0);
  }`;

function plumeLayer(rTop, rBot, colA, colB, { diamonds = 0, pow = 1.6 } = {}) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, 1, 40, 12, true);
  geo.translate(0, -0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uColA: { value: new THREE.Color(...colA) },
      uColB: { value: new THREE.Color(...colB) },
      uDiamonds: { value: diamonds },
      uPow: { value: pow },
    },
    vertexShader: plumeVert,
    fragmentShader: plumeFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function createPlume() {
  const group = new THREE.Group();
  group.position.y = ENGINE_Y;
  const outer = plumeLayer(5.2, 7.5, [0.7, 0.26, 0.08], [0.3, 0.07, 0.015], { pow: 1.2 });
  const mid = plumeLayer(4.1, 2.6, [2.2, 1.25, 0.5], [1.1, 0.36, 0.08], { diamonds: 0.35, pow: 1.5 });
  const core = plumeLayer(2.9, 0.5, [4.2, 3.9, 3.5], [2.2, 1.1, 0.35], { diamonds: 0.6, pow: 2.2 });
  group.add(outer, mid, core);
  const layers = [
    { mesh: outer, len: 1.25, amp: 0.55 },
    { mesh: mid, len: 1.0, amp: 0.8 },
    { mesh: core, len: 0.6, amp: 1.0 },
  ];
  return {
    group,
    update(throttle, t, alt) {
      const on = throttle > 0.02;
      group.visible = on;
      if (!on) return;
      const len = 10 + 46 * Math.min(1, throttle * 1.2);
      const width = 0.3 + 0.7 * Math.min(1, throttle * 1.4);
      for (const L of layers) {
        L.mesh.scale.set(width, Math.min(len * L.len, alt + 6), width);
        L.mesh.material.uniforms.uTime.value = t;
        L.mesh.material.uniforms.uAmp.value = L.amp * Math.min(1, 0.35 + throttle * 1.2);
      }
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
  [2.6, 2.2, 1.7],
  [2.0, 1.1, 0.4],
  [1.2, 0.4, 0.09],
  [0.35, 0.08, 0.02],
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

  return {
    group,
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
        if (p.k === 0 || p.k === 2 || p.k === 6) {
          if (ng >= MAX) continue;
          let c;
          let size;
          let a;
          let z;
          if (p.k === 0) {
            c = fireColor(u);
            size = (p.size + p.grow * p.t) / 4 * 1.25;
            a = (1 - u) * 0.32;
            z = (h - 0.5) * (5 + u * 14);
          } else {
            c = p.k === 6 ? [2.2, 3.4, 4] : [6, 3.6, 1.2];
            size = p.k === 6 ? 0.45 : 0.6;
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
          const size = (p.size + p.grow * p.t) / 4 * (p.k === 3 ? 1.1 : 1.6);
          let a;
          let base;
          if (p.k === 3) {
            a = (1 - u) * 0.45;
            base = [0.55, 0.58, 0.62];
          } else if (p.k === 4) {
            a = Math.sin(Math.PI * Math.min(1, u * 1.4)) * 0.6;
            base = [0.34, 0.3, 0.26];
          } else {
            a = Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.3;
            base = [0.085, 0.085, 0.09];
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
