// Steel highlight survey of a frame-stepped capture. After each frame's normal render, re-renders only the polished
// steel (metalness 1, roughness <= 0.2) into a float 4x MSAA target, with every other material's color writes off so
// depth still occludes. Each steel fragment writes its pre-fog luminance to red when its shading normal faces the
// camera (N.V > 0.05) and to green otherwise (silhouette and past-the-edge samples). Reports per-frame maxima.
// Usage: node flight-orbit-glint-survey.mjs <base-url> <demo|flight> <out.json> [from=0] [to=end]
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, mode, out, from = '0', to = '1e9'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?${mode}=1&capture=1`, { timeout: 600000 });
await page.waitForFunction((m) => window[m === 'demo' ? '__demoReady' : '__flightReady'] === true, mode, { timeout: 600000 });

const setup = await page.evaluate(async () => {
  const THREE = await import(performance.getEntriesByType('resource').find((e) => /\/deps\/three\.js(\?|$)/.test(e.name)).name);
  const v = window.__view;
  const { renderer, scene, camera } = v;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, samples: 4 });
  const px = new Float32Array(size.x * size.y * 4);
  const isSteel = (m) => m && m.isMeshStandardMaterial && m.metalness === 1 && m.roughness <= 0.2;
  const probes = new Map();
  const probeOf = (m) => {
    let p = probes.get(m);
    if (!p) {
      p = m.clone();
      p.fog = false;
      p.onBeforeCompile = (s) => {
        s.fragmentShader = s.fragmentShader.replace(
          '#include <opaque_fragment>',
          `float ndvProbe = dot(normal, normalize(vViewPosition));
          float lumProbe = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          outgoingLight = ndvProbe > 0.05 ? vec3(lumProbe, 0.0, 0.0) : vec3(0.0, lumProbe, 0.0);
          #include <opaque_fragment>`,
        );
      };
      p.customProgramCacheKey = () => 'steel-probe';
      probes.set(m, p);
    }
    return p;
  };
  const black = new THREE.Color(0, 0, 0);
  const clear = new THREE.Color();
  window.__steel = () => {
    const swapped = [];
    const muted = new Map();
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (isSteel(m) && !Array.isArray(o.material)) {
          swapped.push([o, m]);
          o.material = probeOf(m);
        } else if (!muted.has(m)) muted.set(m, m.colorWrite);
      }
    });
    for (const m of muted.keys()) m.colorWrite = false;
    const bg = scene.background;
    const auto = renderer.shadowMap.autoUpdate;
    const ca = renderer.getClearAlpha();
    renderer.getClearColor(clear);
    scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(black, 0);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, ca);
    renderer.shadowMap.autoUpdate = auto;
    scene.background = bg;
    for (const [m, w] of muted) m.colorWrite = w;
    for (const [o, m] of swapped) o.material = m;
    renderer.readRenderTargetPixels(rt, 0, 0, size.x, size.y, px);
    let r = 0, ri = 0, g = 0, gi = 0, r16 = 0, g16 = 0;
    for (let i = 0, n = size.x * size.y; i < n; i++) {
      const a = px[i * 4], b = px[i * 4 + 1];
      if (a > r) { r = a; ri = i; }
      if (b > g) { g = b; gi = i; }
      if (a > 16) r16++;
      if (b > 16) g16++;
    }
    const at = (i) => [i % size.x, size.y - 1 - Math.floor(i / size.x)];
    return { r: +r.toFixed(1), rp: at(ri), g: +g.toFixed(1), gp: at(gi), r16, g16, steel: swapped.length };
  };
  const mats = new Map();
  scene.traverse((o) => {
    if (!isSteel(o.material)) return;
    const e = mats.get(o.material) ?? { uuid: o.material.uuid.slice(0, 8), name: o.material.name, vertexColors: o.material.vertexColors, users: [] };
    e.users.push(`${o.parent?.name ?? ''}/${o.name}`);
    mats.set(o.material, e);
  });
  return { size: [size.x, size.y], steel: [...mats.values()] };
});
console.log(JSON.stringify(setup));

const rows = [];
const t0 = Date.now();
for (;;) {
  const chunk = await page.evaluate(
    ([from, to]) => {
      const res = [];
      for (let k = 0; k < 30; k++) {
        const s = window.__advance(1, true);
        if (s.frame >= from && s.frame <= to) res.push({ f: s.frame, ph: s.phase ?? '', ...window.__steel() });
        if (s.done || s.frame >= to) return { res, done: true };
      }
      return { res, done: false };
    },
    [Number(from), Number(to)],
  );
  rows.push(...chunk.res);
  if (chunk.done) break;
}
await browser.close();

const top = (k) => [...rows].sort((p, q) => q[k] - p[k]).slice(0, 12).map(({ f, ph, r, rp, g, gp }) => ({ f, ph, r, rp, g, gp }));
const byPhase = {};
for (const x of rows) {
  const p = (byPhase[x.ph] ??= { frames: 0, r: 0, g: 0 });
  p.frames++;
  p.r = Math.max(p.r, x.r);
  p.g = Math.max(p.g, x.g);
}
console.log(JSON.stringify({ frames: rows.length, secs: Math.round((Date.now() - t0) / 1000), byPhase, topFacing: top('r'), topEdge: top('g') }));
writeFileSync(out, JSON.stringify({ setup, rows }));
