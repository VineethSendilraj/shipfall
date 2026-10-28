import * as THREE from 'three';
import { NOISE_GLSL, NIGHT_SKY_GLSL, MOON_DIR } from './world.js';
import { R, SITE_X } from '../flight.js';

export const SUN_DIR = new THREE.Vector3(0.85, -0.25, 0.42).normalize();
export const CENTER = new THREE.Vector3(SITE_X, -R, 0);
// The ground sphere sits just under the launch site's flat pad and outer disc.
const PR = R - 3;
export const AIR_TOP = R + 12000;
const AH = 1100;
const BETA = [0.07 / AH, 0.18 / AH, 0.42 / AH];
const SUN_COL = new THREE.Vector3(7, 6.8, 6.4);

/**
 * Single-scattering air in planet-centred coordinates: airColumn is the optical column (density x meters) from
 * radius r out to space along a ray at cosine mu to the vertical (Schueler's Chapman approximation), airSun the
 * sunlight reaching a point, airScatter the light scattered toward ro along rd up to tMax and the transmittance.
 */
const AIR_GLSL = /* glsl */ `
const float PR = ${PR.toFixed(1)};
const float AR = ${AIR_TOP.toFixed(1)};
const float AH = ${AH.toFixed(1)};
const vec3 ABETA = vec3(${BETA.map((b) => b.toExponential(5)).join(', ')});
const int AIR_STEPS = 6;
uniform vec3 uSunDir; uniform vec3 uSunCol;
float airColumn(float r, float mu) {
  float c = sqrt(1.5707963 * r / AH);
  float rho = exp((PR - r) / AH);
  if (mu >= 0.0) return AH * rho * c / ((c - 1.0) * mu + 1.0);
  float s = sqrt(1.0 - mu * mu);
  return AH * (rho * c / ((c - 1.0) * mu - 1.0) + 2.0 * c * sqrt(s) * exp(min((PR - r * s) / AH, 40.0)));
}
vec3 airSun(vec3 p) {
  float r = length(p);
  float along = dot(p, uSunDir);
  float lit = along > 0.0 ? 1.0 : smoothstep(PR - 200.0, PR + 600.0, sqrt(max(r * r - along * along, 0.0)));
  return lit * exp(-ABETA * airColumn(r, along / r));
}
vec3 airScatter(vec3 ro, vec3 rd, float tMax, out vec3 trans) {
  trans = vec3(1.0);
  float b = dot(ro, rd);
  float disc = b * b - dot(ro, ro) + AR * AR;
  if (disc <= 0.0) return vec3(0.0);
  float sq = sqrt(disc);
  float t0 = max(0.0, -b - sq);
  float t1 = min(tMax, -b + sq);
  if (t1 <= t0) return vec3(0.0);
  // Samples crowd toward the ray's lowest point, where nearly all the air is.
  float tc = clamp(-b, t0, t1);
  vec3 tau = vec3(0.0);
  vec3 sum = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float len = k == 0 ? tc - t0 : t1 - tc;
    for (int i = 0; i < AIR_STEPS; i++) {
      float u = (float(i) + 0.5) / float(AIR_STEPS);
      float w = k == 0 ? 1.0 - u : u;
      float t = k == 0 ? tc - len * w * w : tc + len * w * w;
      float ds = 2.0 * len * w / float(AIR_STEPS);
      vec3 p = ro + rd * t;
      float rho = exp((PR - length(p)) / AH);
      vec3 dtau = ABETA * rho * ds;
      sum += rho * ds * exp(-(tau + 0.5 * dtau)) * airSun(p);
      tau += dtau;
    }
  }
  trans = exp(-tau);
  float mu = dot(rd, uSunDir);
  float phase = 0.0597 * (1.0 + mu * mu) + 0.03 * pow(max(mu, 0.0), 12.0);
  return uSunCol * ABETA * phase * sum + vec3(0.004, 0.007, 0.016) * (1.0 - trans);
}
`;

// Shared by the planet and the air, so one update moves both.
const AIR = { uSunDir: { value: SUN_DIR }, uSunCol: { value: SUN_COL }, uCam: { value: new THREE.Vector3() } };

/** The air shaders work relative to the planet's centre, where float precision holds at orbital distances. */
export function setAirCamera(cameraPosition) {
  AIR.uCam.value.subVectors(cameraPosition, CENTER);
}

function airColumn(r, mu) {
  const c = Math.sqrt((Math.PI / 2) * (r / AH));
  const rho = Math.exp((PR - r) / AH);
  if (mu >= 0) return (AH * rho * c) / ((c - 1) * mu + 1);
  const s = Math.sqrt(1 - mu * mu);
  return AH * ((rho * c) / ((c - 1) * mu - 1) + 2 * c * Math.sqrt(s) * Math.exp(Math.min((PR - r * s) / AH, 40)));
}

/** Sunlight reaching world point p through the air and past the planet's shadow (the shaders' airSun), into `out`. */
export function sunlight(p, out) {
  const x = p.x - CENTER.x;
  const y = p.y - CENTER.y;
  const z = p.z - CENTER.z;
  const r = Math.hypot(x, y, z);
  const along = x * SUN_DIR.x + y * SUN_DIR.y + z * SUN_DIR.z;
  const lit = along > 0 ? 1 : THREE.MathUtils.smoothstep(Math.sqrt(Math.max(0, r * r - along * along)), PR - 200, PR + 600);
  const col = airColumn(r, along / r);
  return out.setRGB(lit * Math.exp(-BETA[0] * col), lit * Math.exp(-BETA[1] * col), lit * Math.exp(-BETA[2] * col));
}

const planetFrag = /* glsl */ `
  uniform float uClouds; uniform vec3 uMoonDir;
  varying vec3 vObj;
  ${NOISE_GLSL}
  ${AIR_GLSL}
  #include <fog_pars_fragment>
  uniform vec3 uCam;
  // 1 while noise of frequency f (per planet radius) spans several pixels, fading to 0 as it shrinks under one.
  float detail(float f, float fw) { return smoothstep(1.0, 3.0, PR / (f * fw)); }
  void main() {
    vec3 n = normalize(vObj);
    vec3 toP = vObj - uCam;
    float dist = length(toP);
    vec3 rd = toP / dist;
    float fw = length(fwidth(vObj));
    float h = fbm(n * 2.6 + vec3(5.2, 1.3, 7.9)) - 0.47 + (fbm(n * 23.0 + 1.7) - 0.5) * 0.24 * detail(23.0, fw);
    // Keep the launch site on a coast, with the sea to the east.
    h += 0.09 * exp(-dot(n.xy - vec2(-0.03, 1.0), n.xy - vec2(-0.03, 1.0)) * 900.0) - 0.07 * exp(-dot(n.xy - vec2(0.09, 0.996), n.xy - vec2(0.09, 0.996)) * 500.0);
    float fine = (fbm(n * 160.0) - 0.5) * detail(160.0, fw) + (fbm(n * 1100.0) - 0.5) * 0.6 * detail(1100.0, fw);
    float wet = fbm(n * 7.0 + 4.0) + fine * 0.15;
    float land = smoothstep(0.0, 0.006, h);
    vec3 sea = mix(vec3(0.0035, 0.012, 0.035), vec3(0.012, 0.05, 0.065), smoothstep(-0.06, 0.0, h));
    vec3 ground = mix(vec3(0.025, 0.042, 0.017), vec3(0.10, 0.076, 0.045), smoothstep(0.42, 0.62, wet));
    ground = mix(ground, vec3(0.07, 0.065, 0.058), smoothstep(0.16, 0.3, h + fine * 0.05));
    ground = mix(vec3(0.15, 0.13, 0.09), ground, smoothstep(0.004, 0.02, h));
    ground *= 0.8 + 0.4 * (fine + 0.5);
    vec3 albedo = mix(sea, ground, land);
    float cloud = smoothstep(0.55, 0.78, fbm(n * 14.0 + vec3(2.0, 9.0, 4.0)) + (fbm(n * 90.0) - 0.5) * 0.3 * detail(90.0, fw)) * uClouds;
    albedo = mix(albedo, vec3(0.62), cloud);
    float ndl = dot(n, uSunDir);
    vec3 sunT = airSun(n * PR);
    vec3 light = uSunCol * (sunT * max(ndl, 0.0) + vec3(0.010, 0.017, 0.03) * smoothstep(-0.15, 0.25, ndl));
    light += vec3(0.004, 0.005, 0.008) * max(dot(n, uMoonDir), 0.0);
    vec3 col = albedo * light;
    vec3 hv = normalize(uSunDir - rd);
    float glint = pow(max(dot(n, hv), 0.0), 300.0) * 2.0 + pow(max(dot(n, hv), 0.0), 30.0) * 0.06;
    col += uSunCol * sunT * glint * (1.0 - land) * (1.0 - cloud) * step(0.0, ndl);
    vec3 trans;
    vec3 air = airScatter(uCam, rd, dist, trans);
    gl_FragColor = vec4(col * trans + air, 1.0);
    #include <fog_fragment>
  }`;

/** The planet under the launch site, centred so the site's pad sits on top; equator in the orbital (xy) plane. */
export function createPlanet() {
  const geo = new THREE.SphereGeometry(PR, 512, 256);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...AIR, uClouds: { value: 0 }, uMoonDir: { value: MOON_DIR } },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vObj;
      void main() {
        vObj = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: planetFrag,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(CENTER);
  return mesh;
}

/** The air seen against space: adds the scattered light and dims what is behind it. Drawn after the planet. */
export function createAir() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...AIR, uFade: { value: 1 } },
    vertexShader: 'varying vec3 vObj; void main() { vObj = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vObj;
      ${AIR_GLSL}
      uniform vec3 uCam;
      void main() {
        vec3 rd = normalize(vObj - uCam);
        float b = dot(uCam, rd);
        float disc = b * b - dot(uCam, uCam) + PR * PR;
        float tMax = 1e9;
        if (disc > 0.0 && -b - sqrt(disc) > 0.0) tMax = -b - sqrt(disc);
        vec3 trans;
        vec3 col = airScatter(uCam, rd, tMax, trans);
        gl_FragColor = vec4(col * uFade, 1.0 - uFade + uFade * dot(trans, vec3(1.0 / 3.0)));
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(AIR_TOP, 128, 64), mat);
  mesh.position.copy(CENTER);
  mesh.renderOrder = -5;
  return mesh;
}

/** Black sky with the sun and the catch sky's stars, milky way and moon, its horizon dropped to the planet's limb (uDip). */
export function createSpaceSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMoonDir: { value: MOON_DIR }, uSunDir: { value: SUN_DIR }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uDip: { value: 0 }, uFade: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uMoonDir; uniform vec3 uSunDir; uniform vec3 uUp; uniform float uDip; uniform float uFade;
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${NIGHT_SKY_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float sd = dot(d, uSunDir);
        vec3 sun = vec3(1.0, 0.96, 0.9) * (smoothstep(0.99985, 0.99992, sd) * 30.0 + pow(max(sd, 0.0), 900.0) * 0.8);
        gl_FragColor = vec4(nightSky(d, dot(d, uUp) + uDip, dot(d, uMoonDir), vec3(0.0)) + sun, uFade);
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -6;
  return mesh;
}

/**
 * Reflections in orbit: the sunlit planet below a thin blue limb and black space, with "up" along +y. The same
 * PMREM size as the launch site's map, so swapping scene.environment between them recompiles nothing.
 */
export function buildSpaceEnv(renderer) {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 col = mix(vec3(0.13, 0.17, 0.24), vec3(0.2, 0.36, 0.75), smoothstep(-0.75, -0.43, h));
        col *= smoothstep(-0.36, -0.43, h);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  return rt.texture;
}
