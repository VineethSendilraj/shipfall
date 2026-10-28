import * as THREE from 'three';
import { NOISE_GLSL, NIGHT_SKY_GLSL, MOON_DIR, bakeEnvironment } from './world.js';
import { SUN_DIR as MARS_SUN_DIR } from './mars.js';
import { R, SITE_X } from '../flight.js';

export const CENTER = new THREE.Vector3(SITE_X, -R, 0);
// The ground sphere sits just under the launch site's flat pad and outer disc.
const PR = R - 3;
export const AIR_TOP = R + 12000;
const AH = 1100;

/**
 * How free flight draws each map's planet. sunI: the sunlight's intensity on the vehicles in space; sunCol: the
 * sunlight on the planet and in its air; beta: the air's extinction at the ground (1/m); phase: GLSL that sets
 * `phase`, the light the air scatters toward the eye per unit of extinction, from mu, the cosine of the angle to
 * the sun; ambient: GLSL colour the air glows with on its own; surface: the planet's fragment shader; sun: GLSL
 * for the sun in the space sky, from sd, the cosine of the angle to it; moonDir: the space sky's moon (zero: none);
 * env: GLSL colours of the planet and its limb in the reflections in orbit; bounce: sunlight off the planet onto
 * the vehicles; siteSun: the launch site's key light is this sun.
 */
const LOOKS = {
  // Earth, its launch site at night with the sun below the eastern horizon.
  starbase: {
    sunDir: new THREE.Vector3(0.85, -0.25, 0.42).normalize(),
    sunI: 9,
    sunCol: new THREE.Vector3(7, 6.8, 6.4),
    beta: [0.07 / AH, 0.18 / AH, 0.42 / AH],
    phase: 'float phase = 0.0597 * (1.0 + mu * mu) + 0.03 * pow(max(mu, 0.0), 12.0);',
    ambient: 'vec3(0.004, 0.007, 0.016)',
    surface: earthFrag,
    moonDir: MOON_DIR,
    sun: 'smoothstep(0.99985, 0.99992, sd) * 30.0 + pow(max(sd, 0.0), 900.0) * 0.8',
    env: ['vec3(0.13, 0.17, 0.24)', 'vec3(0.2, 0.36, 0.75)'],
    bounce: new THREE.Color(0.25, 0.32, 0.45),
  },
  // Mars under the catch game's low dusk sun, which is also its launch site's key light: a rust desert below a thin,
  // dusty air that glows blue around the sun.
  mars: {
    sunDir: MARS_SUN_DIR,
    // The site's key light before the site's air dims it, so the light holds steady through the climb.
    sunI: 3.4,
    sunCol: new THREE.Vector3(2.8, 2.72, 2.56),
    beta: [0.045 / AH, 0.05 / AH, 0.06 / AH],
    phase: 'vec3 phase = vec3(0.052, 0.022, 0.0065) * (1.0 + 0.55 * mu) + vec3(0.03, 0.06, 0.14) * pow(max(mu, 0.0), 150.0);',
    ambient: 'vec3(0.003, 0.0018, 0.001)',
    surface: marsFrag,
    moonDir: new THREE.Vector3(),
    sun: 'smoothstep(0.999983, 0.999989, sd) * 12.0 + pow(max(sd, 0.0), 3000.0) * 0.6',
    env: ['vec3(0.08, 0.036, 0.016)', 'vec3(0.17, 0.1, 0.056)'],
    bounce: new THREE.Color(0.17, 0.09, 0.04),
    siteSun: true,
  },
};

/**
 * Single-scattering air in planet-centred coordinates: airColumn is the optical column (density x meters) from
 * radius r out to space along a ray at cosine mu to the vertical (Schueler's Chapman approximation), airSun the
 * sunlight reaching a point, airScatter the light scattered toward ro along rd up to tMax and the transmittance.
 */
const airGlsl = (k) => /* glsl */ `
const float PR = ${PR.toFixed(1)};
const float AR = ${AIR_TOP.toFixed(1)};
const float AH = ${AH.toFixed(1)};
const vec3 ABETA = vec3(${k.beta.map((b) => b.toExponential(5)).join(', ')});
const int AIR_STEPS = 6;
uniform vec3 uSunDir; uniform vec3 uSunCol;
float airColumn(float r, float mu) {
  float c = sqrt(1.5707963 * r / AH);
  float rho = exp((PR - r) / AH);
  if (mu >= 0.0) return AH * rho * c / ((c - 1.0) * mu + 1.0);
  // mu rounds past -1 near the shadow's axis; NaN from the root would blacken a square of the frame through the bloom.
  float s = sqrt(max(1.0 - mu * mu, 0.0));
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
  ${k.phase}
  return uSunCol * ABETA * phase * sum + ${k.ambient} * (1.0 - trans);
}
`;

// The air shaders work relative to the planet's centre, where float precision holds at orbital distances.
const CAM = { value: new THREE.Vector3() };

export function setAirCamera(cameraPosition) {
  CAM.value.subVectors(cameraPosition, CENTER);
}

function airColumn(r, mu) {
  const c = Math.sqrt((Math.PI / 2) * (r / AH));
  const rho = Math.exp((PR - r) / AH);
  if (mu >= 0) return (AH * rho * c) / ((c - 1) * mu + 1);
  const s = Math.sqrt(Math.max(0, 1 - mu * mu));
  return AH * ((rho * c) / ((c - 1) * mu - 1) + 2 * c * Math.sqrt(s) * Math.exp(Math.min((PR - r * s) / AH, 40)));
}

/** Sunlight reaching world point p through look k's air and past the planet's shadow (the shaders' airSun), into `out`. */
function sunlight(p, out, k) {
  const x = p.x - CENTER.x;
  const y = p.y - CENTER.y;
  const z = p.z - CENTER.z;
  const r = Math.hypot(x, y, z);
  const S = k.sunDir;
  const along = x * S.x + y * S.y + z * S.z;
  const lit = along > 0 ? 1 : THREE.MathUtils.smoothstep(Math.sqrt(Math.max(0, r * r - along * along)), PR - 200, PR + 600);
  const col = airColumn(r, along / r);
  return out.setRGB(lit * Math.exp(-k.beta[0] * col), lit * Math.exp(-k.beta[1] * col), lit * Math.exp(-k.beta[2] * col));
}

function earthFrag(k) {
  return /* glsl */ `
  uniform float uClouds; uniform vec3 uMoonDir;
  varying vec3 vObj;
  ${NOISE_GLSL}
  ${airGlsl(k)}
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
}

function marsFrag(k) {
  return /* glsl */ `
  uniform vec4 uHole;
  varying vec3 vObj;
  ${NOISE_GLSL}
  ${airGlsl(k)}
  #include <fog_pars_fragment>
  uniform vec3 uCam;
  float detail(float f, float fw) { return smoothstep(1.0, 3.0, PR / (f * fw)); }
  void main() {
    // The map's own terrain, which dips below the sphere in places, covers the launch site while it is drawn.
    if (uHole.w > 0.5 && vObj.y > 0.0 && length(vObj.xz - uHole.xy) < uHole.z) discard;
    vec3 n = normalize(vObj);
    vec3 toP = vObj - uCam;
    float dist = length(toP);
    vec3 rd = toP / dist;
    float fw = length(fwidth(vObj));
    float fine = (fbm(n * 160.0) - 0.5) * detail(160.0, fw) + (fbm(n * 1100.0) - 0.5) * 0.6 * detail(1100.0, fw);
    // Dark basalt plains among pale dust, at the scale of continents and of craters.
    float dark = smoothstep(0.45, 0.62, fbm(n * 2.4 + vec3(3.1, 7.7, 1.9)) + (fbm(n * 21.0 + 2.3) - 0.5) * 0.35 * detail(21.0, fw) + fine * 0.06);
    vec3 dust = mix(vec3(0.3, 0.1, 0.035), vec3(0.44, 0.17, 0.065), smoothstep(0.35, 0.65, fbm(n * 7.0 + 4.0) + fine * 0.15));
    vec3 albedo = mix(dust, vec3(0.1, 0.04, 0.02), dark) * (0.8 + 0.4 * (fine + 0.5));
    float ndl = dot(n, uSunDir);
    vec3 col = albedo * uSunCol * (airSun(n * PR) * max(ndl, 0.0) + vec3(0.018, 0.010, 0.006) * smoothstep(-0.15, 0.25, ndl));
    vec3 trans;
    vec3 air = airScatter(uCam, rd, dist, trans);
    gl_FragColor = vec4(col * trans + air, 1.0);
    #include <fog_fragment>
  }`;
}

let sphere = null;

/**
 * The planet under the launch site, centred so the site's pad sits on top; equator in the orbital (xy) plane.
 * uClouds: Earth's cloud cover; uHole: x, z (from the centre) and radius of the map's terrain, cut out of the
 * sphere while w is 1 (Mars).
 */
function createPlanet(k, shared) {
  sphere ??= new THREE.SphereGeometry(PR, 512, 256).rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared, uClouds: { value: 0 }, uMoonDir: { value: k.moonDir }, uHole: { value: new THREE.Vector4() } },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vObj;
      void main() {
        vObj = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: k.surface(k),
    fog: true,
  });
  const mesh = new THREE.Mesh(sphere, mat);
  mesh.position.copy(CENTER);
  return mesh;
}

/** The air seen against space: adds the scattered light and dims what is behind it. Drawn after the planet. */
function createAir(k, shared) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uFade: { value: 1 } },
    vertexShader: 'varying vec3 vObj; void main() { vObj = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vObj;
      ${airGlsl(k)}
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

/** Black sky with the sun and the catch sky's stars, milky way and (Earth's) moon, its horizon dropped to the planet's limb (uDip). */
function createSpaceSky(k) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMoonDir: { value: k.moonDir }, uSunDir: { value: k.sunDir }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uDip: { value: 0 }, uFade: { value: 0 } },
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
        vec3 sun = vec3(1.0, 0.96, 0.9) * (${k.sun});
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
 * Reflections in orbit: the sunlit planet below a thin limb and black space, with "up" along +y. Baked like the
 * launch site's map, so swapping scene.environment between them recompiles nothing.
 */
function buildSpaceEnv(renderer, k) {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 col = mix(${k.env[0]}, ${k.env[1]}, smoothstep(-0.75, -0.43, h));
        col *= smoothstep(-0.36, -0.43, h);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat));
  return bakeEnvironment(renderer, envScene).texture;
}

/**
 * What free flight draws around `map`'s launch site: the planet, its air and the space sky (`objects`), the
 * reflections in orbit (`env`), and sunlight(p, out), the sunlight reaching world point p.
 */
export function createLook(map, renderer) {
  const k = LOOKS[map];
  // Shared by the planet and the air, so one update moves both.
  const shared = { uSunDir: { value: k.sunDir }, uSunCol: { value: k.sunCol }, uCam: CAM };
  const planet = createPlanet(k, shared);
  const air = createAir(k, shared);
  const space = createSpaceSky(k);
  return {
    planet,
    air,
    space,
    objects: [planet, air, space],
    env: buildSpaceEnv(renderer, k),
    sunDir: k.sunDir,
    sunI: k.sunI,
    bounce: k.bounce,
    siteSun: !!k.siteSun,
    sunlight: (p, out) => sunlight(p, out, k),
  };
}
