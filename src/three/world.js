import * as THREE from 'three';
import { concrete } from './textures.js';
import { createRng } from '../rng.js';

export const MOON_DIR = new THREE.Vector3(-0.42, 0.36, -0.83).normalize();
const GLOW_DIR = new THREE.Vector3(0.55, 0, -0.84).normalize();

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
`;

function skyMaterial({ withStars }) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMoonDir: { value: MOON_DIR }, uGlowDir: { value: GLOW_DIR } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uMoonDir; uniform vec3 uGlowDir;
      varying vec3 vDir;
      ${NOISE_GLSL}
      vec3 starLayer(vec3 d, float scale, float density, float radius) {
        vec3 p = d * scale; vec3 id = floor(p); vec3 f = fract(p) - 0.5;
        float h = hash13(id);
        if (h < 1.0 - density) return vec3(0.0);
        vec3 off = vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3)) - 0.5;
        float dist = length(f - off * 0.5);
        float b = (h - (1.0 - density)) / density;
        float tw = 0.8 + 0.2 * sin(uTime * (1.3 + b * 3.0) + h * 91.0);
        float s = smoothstep(radius, 0.0, dist) * (0.35 + 2.6 * b * b * b) * tw;
        vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.72), hash13(id + 9.0));
        return tint * s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zen = vec3(0.0035, 0.0055, 0.016);
        vec3 mid = vec3(0.010, 0.017, 0.045);
        vec3 hor = vec3(0.060, 0.050, 0.080);
        vec3 col = mix(hor, mid, smoothstep(-0.02, 0.22, h));
        col = mix(col, zen, smoothstep(0.22, 0.85, h));
        vec3 flat_ = normalize(vec3(d.x, 0.0001, d.z));
        float az = max(0.0, dot(flat_, uGlowDir));
        col += vec3(0.20, 0.085, 0.040) * pow(az, 3.0) * exp(-max(h, 0.0) * 10.0);
        col += vec3(0.03, 0.035, 0.06) * exp(-max(h, 0.0) * 5.0);
        float md = dot(d, uMoonDir);
        col += vec3(0.05, 0.065, 0.10) * pow(max(md, 0.0), 24.0);
        ${withStars ? `
        if (h > -0.02) {
          vec3 n = normalize(vec3(0.35, 0.55, 0.76));
          float band = exp(-pow(dot(d, n) / 0.2, 2.0));
          float clouds = fbm(d * 5.0) * fbm(d * 11.0 + 3.0);
          float dust = smoothstep(0.35, 0.65, fbm(d * 9.0 + 7.0));
          col += vec3(0.05, 0.05, 0.075) * band * clouds * 1.6 * (1.0 - 0.7 * dust) * smoothstep(0.0, 0.25, h);
          float fade = smoothstep(0.0, 0.18, h) * (1.0 - 0.85 * pow(max(md, 0.0), 6.0));
          col += (starLayer(d, 170.0, 0.035, 0.2) + starLayer(d, 330.0, 0.05, 0.16) * 0.6 + band * starLayer(d, 520.0, 0.12, 0.14) * 0.5) * fade;
          float r = acos(clamp(md, -1.0, 1.0));
          float disc = smoothstep(0.0235, 0.0215, r);
          vec3 lp = d - uMoonDir * md;
          float maria = fbm(lp * 190.0) * 0.6 + fbm(lp * 520.0) * 0.4;
          float limb = sqrt(max(0.0, 1.0 - pow(r / 0.0235, 2.0)));
          vec3 moon = vec3(2.3, 2.25, 2.1) * (0.55 + 0.45 * limb) * (0.72 + 0.4 * smoothstep(0.35, 0.7, maria));
          col = mix(col, moon, disc);
          col += vec3(0.30, 0.34, 0.42) * pow(max(md, 0.0), 2200.0) + vec3(0.06, 0.07, 0.09) * pow(max(md, 0.0), 260.0);
        }` : `
        col += vec3(1.2, 1.2, 1.25) * smoothstep(0.995, 0.999, md);
        `}
        if (h < 0.0) col = mix(col, vec3(0.012, 0.011, 0.012), smoothstep(0.0, -0.06, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

function buildEnvironment(renderer) {
  const envScene = new THREE.Scene();
  // Neutral night dome for reflections only: a saturated blue sky makes bare steel read as blue plastic.
  const dome = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 col = mix(vec3(0.16, 0.12, 0.09), vec3(0.018, 0.02, 0.026), smoothstep(-0.02, 0.45, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), dome));
  const flood = new THREE.MeshBasicMaterial({ color: new THREE.Color(24, 18, 12), side: THREE.DoubleSide });
  const sodium = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.7, 0.75), side: THREE.DoubleSide });
  const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.35, 1.8), side: THREE.DoubleSide });
  // Floodlight heads at the mast positions, plus softer sodium and cool sources around the horizon.
  for (const [x, y, z, w, h, m] of [
    [62, 16, 26, 6, 3, flood],
    [-86, 14, 20, 6, 3, flood],
    [-22, 14, -46, 5, 2.5, flood],
    [40, 4, 85, 40, 6, sodium],
    [-70, 5, -60, 46, 7, sodium],
    [85, 3, -40, 30, 4, sodium],
    [-90, 6, 55, 26, 5, cool],
  ]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    envScene.add(p);
  }
  // Horizon glow: the lit site seen low on every side.
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(96, 96, 10, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.36, 0.22), side: THREE.BackSide }),
  );
  band.position.y = 2;
  envScene.add(band);
  // Floodlit concrete pad below: the main thing a vertical steel tank reflects at night.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(98, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.42, 0.33, 0.24) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  return rt.texture;
}

function setDressing(scene, rng, towerMats) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x8f949b, metalness: 0.6, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.2, roughness: 0.55 });

  // Launch mount (behind the right-hand lane): six legs, a ring table and a flame deflector.
  const olm = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2.6, 18, 2.6), towerMats.concrete);
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
  scene.add(olm);

  // Tank farm and outbuildings on the horizon. The props model replaces the `tanks` group; its rng draws
  // still run so the buildings keep their places.
  const farm = new THREE.Group();
  const tanks = new THREE.Group();
  farm.add(tanks);
  const tankSteel = new THREE.MeshStandardMaterial({ color: 0xb4b8be, metalness: 1, roughness: 0.34 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x5c6066, metalness: 0.9, roughness: 0.5 });
  const insulated = new THREE.MeshStandardMaterial({ color: 0x8d8b86, metalness: 0, roughness: 0.82 });
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
  const windowGeo = new THREE.PlaneGeometry(1.6, 0.9);
  const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.9), toneMapped: false });
  for (let i = 0; i < 5; i++) {
    const w = rng.range(20, 60);
    const h = rng.range(8, 30);
    const d = rng.range(20, 40);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), towerMats.carriage);
    b.position.set(rng.range(120, 420), h / 2, rng.range(-420, -260));
    b.receiveShadow = true;
    farm.add(b);
    const rows = Math.max(1, Math.floor(h / 5));
    const cols = Math.floor(w / 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!rng.chance(0.35)) continue;
        const win = new THREE.Mesh(windowGeo, windowMat);
        win.position.set(b.position.x - w / 2 + 2 + c * 4, 2.5 + r * 5, b.position.z + d / 2 + 0.05);
        farm.add(win);
      }
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 2.0), toneMapped: false }));
    strip.position.set(b.position.x, h + 0.2, b.position.z + d / 2);
    farm.add(strip);
  }
  scene.add(farm);

  // Distant site lights (emissive points; bloom turns them into soft glints).
  const n = 140;
  const dotGeo = new THREE.SphereGeometry(0.7, 6, 4);
  const dots = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const a = rng.range(-1.6, 1.4);
    const d = rng.range(320, 1300);
    m.compose(new THREE.Vector3(Math.sin(a) * d, rng.range(0.6, 9), -Math.cos(a) * d), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1).multiplyScalar(rng.range(0.7, 2.2)));
    dots.setMatrixAt(i, m);
    const warm = rng.chance(0.7);
    col.setRGB(warm ? 4 : 2.5, warm ? 2.4 : 2.8, warm ? 1.1 : 3.4);
    dots.setColorAt(i, col);
  }
  scene.add(dots);
  return {
    mount: olm,
    tanks,
    mats: { tankSteel, band: bandMat, insulated, concrete: towerMats.concrete, mountSteel: steel, dark: hole.material },
  };
}

const beamMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(1.0, 0.78, 0.52) } },
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
  const head = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 1.5), toneMapped: false }));
  head.position.set(x, 34.5, z);
  head.lookAt(target);
  scene.add(head);
  const spot = new THREE.SpotLight(0xffd2a0, intensity, 0, THREE.MathUtils.degToRad(30), 0.6, 2);
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
  scene.add(beam);
  return spot;
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

export function buildWorld(scene, renderer, towerMats) {
  const rng = createRng(4242);
  scene.fog = new THREE.FogExp2(0x0a0d18, 0.0011);
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 0.8;

  const skyMat = skyMaterial({ withStars: true });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const tex = concrete();
  tex.map.repeat.set(36, 36);
  tex.roughnessMap.repeat.set(36, 36);
  const padMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, map: tex.map, roughnessMap: tex.roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 1.6 });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(720, 720), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.receiveShadow = true;
  scene.add(pad);
  const outer = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshStandardMaterial({ color: 0x23211d, roughness: 0.95 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.05;
  scene.add(outer);

  const hemi = new THREE.HemisphereLight(0x4a5f9a, 0x1a1512, 0.8);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xccd5ea, 1.25);
  moon.position.copy(MOON_DIR).multiplyScalar(420);
  moon.target.position.set(-20, 40, 0);
  moon.position.add(moon.target.position);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = -190;
  sc.right = 190;
  sc.top = 180;
  sc.bottom = -120;
  sc.near = 10;
  sc.far = 900;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.6;
  scene.add(moon, moon.target);

  const fill = new THREE.DirectionalLight(0xaab4c8, 0.25);
  fill.position.set(60, 40, 300);
  fill.target.position.set(0, 60, 0);
  scene.add(fill, fill.target);

  const floods = [
    lightMast(scene, 130, 55, new THREE.Vector3(40, 50, 0), 15000),
    lightMast(scene, -215, 50, new THREE.Vector3(-100, 50, 0), 12000),
    lightMast(scene, -40, -95, new THREE.Vector3(10, 50, 0), 9000),
  ];

  // Pools of sodium light on the pad, and a perimeter of small runway-style lights.
  for (const [x, z, s, c] of [
    [40, 30, 70, 0xffb070],
    [-95, 25, 60, 0xffb070],
    [-20, 70, 50, 0xffd9a8],
  ]) {
    const pool = new THREE.PointLight(c, 260, 0, 2);
    pool.position.set(x, 12, z);
    scene.add(pool);
  }
  const lampGeo = new THREE.BoxGeometry(0.6, 0.35, 0.6);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 64);
  const lm = new THREE.Matrix4();
  const lc = new THREE.Color();
  for (let i = 0; i < 64; i++) {
    const side = i % 4;
    const u = (Math.floor(i / 4) / 15) * 2 - 1;
    const x = side < 2 ? u * 260 - 40 : (side === 2 ? -300 : 220);
    const z = side < 2 ? (side === 0 ? 140 : -140) : u * 140;
    lm.makeTranslation(x, 0.2, z);
    lamps.setMatrixAt(i, lm);
    lc.setRGB(i % 3 ? 3.2 : 1.6, i % 3 ? 1.6 : 2.4, i % 3 ? 0.5 : 3.2);
    lamps.setColorAt(i, lc);
  }
  scene.add(lamps);

  const dressing = setDressing(scene, rng, towerMats);

  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(250, 250, 90, 96, 1, true),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying float vY; void main() { vY = position.y + 45.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vY;
        void main() {
          float a = exp(-clamp(vY, 0.0, 90.0) / 16.0) * 0.32;
          gl_FragColor = vec4(vec3(0.42, 0.29, 0.19) * a, a * 0.55);
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
  scene.add(haze);
  return { sky, skyMat, floods, moon, dressing };
}
