// Tries candidate steel shader patches on a frame-stepped capture without editing the game. At each frame of the
// windows it renders the frame as is, then once per variant with the polished steel (metalness 1, roughness <= 0.2)
// swapped for a patched copy. Per variant: the flash scan's amplitude for the window's center frame (16x9 luma grid
// of the 640x360 downscale, the jump-and-return rule) and how many full-size pixels differ from the unpatched frame.
// For the steel's hottest sample it also reports N.V (luminance-weighted over the pixel's samples).
// Usage: node flight-orbit-glint-trial.mjs <base-url> <demo|flight> <center frames, e.g. 1416,1434>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, mode, list] = process.argv.slice(2);
const centers = list.split(',').map(Number);
const cap = (t, c) => `if ( dot( geometryNormal, geometryViewDir ) < ${t} ) outgoingLight = min( outgoingLight, vec3( ${c} ) );\n#include <opaque_fragment>`;
// Fragment-only patches are [find, repl]; 'centroid N' and 'centroid N+V' are built in the page from THREE.ShaderChunk.
const VARIANTS = {
  noop: ['#include <opaque_fragment>', '#include <opaque_fragment>'],
  'cap128 N.V<0': ['#include <opaque_fragment>', cap('0.0', '128.0')],
  'cap256 N.V<0': ['#include <opaque_fragment>', cap('0.0', '256.0')],
  'cap512 N.V<0': ['#include <opaque_fragment>', cap('0.0', '512.0')],
  'cap1024 N.V<0': ['#include <opaque_fragment>', cap('0.0', '1024.0')],
  'centroid N': 'centroid N',
  'centroid N+V': 'centroid N+V',
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text().slice(0, 400)));
await page.goto(`${base}/?${mode}=1&capture=1`, { timeout: 600000 });
await page.waitForFunction((m) => window[m === 'demo' ? '__demoReady' : '__flightReady'] === true, mode, { timeout: 600000 });

await page.evaluate(async (variants) => {
  const THREE = await import(performance.getEntriesByType('resource').find((e) => /\/deps\/three\.js(\?|$)/.test(e.name)).name);
  const v = window.__view;
  const { renderer, scene, camera } = v;
  const isSteel = (m) => m && m.isMeshStandardMaterial && m.metalness === 1 && m.roughness <= 0.2;
  const copies = new Map();
  const centroid = (src, name) => src.replace(`varying vec3 ${name};`, `centroid varying vec3 ${name};`);
  const centroidN = {
    v: [['#include <normal_pars_vertex>', centroid(THREE.ShaderChunk.normal_pars_vertex, 'vNormal')]],
    f: [['#include <normal_pars_fragment>', centroid(THREE.ShaderChunk.normal_pars_fragment, 'vNormal')]],
  };
  const specs = {
    'centroid N': centroidN,
    'centroid N+V': {
      v: [...centroidN.v, ['varying vec3 vViewPosition;', 'centroid varying vec3 vViewPosition;']],
      f: [...centroidN.f, ['varying vec3 vViewPosition;', 'centroid varying vec3 vViewPosition;']],
    },
  };
  window.__matched = {};
  const copyOf = (m, key, patch) => {
    const k = `${m.uuid}|${key}`;
    let c = copies.get(k);
    if (!c) {
      const spec = typeof patch === 'string' ? specs[patch] : { f: [patch] };
      c = m.clone();
      c.onBeforeCompile = (s) => {
        let ok = true;
        for (const [a, b] of spec.v || []) {
          ok &&= s.vertexShader.includes(a);
          s.vertexShader = s.vertexShader.replace(a, b);
        }
        for (const [a, b] of spec.f || []) {
          ok &&= s.fragmentShader.includes(a);
          s.fragmentShader = s.fragmentShader.replace(a, b);
        }
        window.__matched[key] = ok;
      };
      c.customProgramCacheKey = () => key;
      copies.set(k, c);
    }
    return c;
  };
  const withSteel = (fn, swap) => {
    const done = [];
    scene.traverse((o) => {
      if (!isSteel(o.material)) return;
      done.push([o, o.material]);
      o.material = swap(o.material);
    });
    const r = fn();
    for (const [o, m] of done) o.material = m;
    return r;
  };
  const small = Object.assign(document.createElement('canvas'), { width: 640, height: 360 }).getContext('2d', { willReadFrequently: true });
  const full = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 }).getContext('2d', { willReadFrequently: true });
  const gl = document.getElementById('gl');
  const grab = () => {
    small.drawImage(gl, 0, 0, 640, 360);
    const px = small.getImageData(0, 0, 640, 360).data;
    const sum = new Float64Array(144);
    for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
      const o = (y * 640 + x) * 4;
      sum[Math.floor(y / 40) * 16 + Math.floor(x / 40)] += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    }
    full.drawImage(gl, 0, 0, 1280, 720);
    return { lum: Array.from(sum, (s) => s / (1600 * 255)), px: full.getImageData(0, 0, 1280, 720).data };
  };
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, samples: 4 });
  const fpx = new Float32Array(size.x * size.y * 4);
  const ndvKey = ['#include <opaque_fragment>', 'float lumP = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );\noutgoingLight = vec3( lumP, lumP * dot( geometryNormal, geometryViewDir ), 0.0 );\n#include <opaque_fragment>'];
  const hottest = () => {
    const muted = new Map();
    scene.traverse((o) => {
      if (o.material && !isSteel(o.material)) for (const m of [o.material].flat()) muted.has(m) || muted.set(m, m.colorWrite);
    });
    for (const m of muted.keys()) m.colorWrite = false;
    const bg = scene.background;
    scene.background = null;
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    withSteel(() => {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    }, (m) => Object.assign(copyOf(m, 'ndv', ndvKey), { fog: false }));
    renderer.shadowMap.autoUpdate = auto;
    scene.background = bg;
    for (const [m, w] of muted) m.colorWrite = w;
    renderer.readRenderTargetPixels(rt, 0, 0, size.x, size.y, fpx);
    let best = 0, at = 0;
    for (let i = 0; i < size.x * size.y; i++) if (fpx[i * 4] > best) { best = fpx[i * 4]; at = i; }
    return { lum: +best.toFixed(1), ndv: best > 0 ? +(fpx[at * 4 + 1] / best).toFixed(4) : null, x: at % size.x, y: size.y - 1 - Math.floor(at / size.x) };
  };
  window.__trial = (center) => {
    const out = { center, frames: {} };
    const step = window.__flight ? () => window.__flight.frame : null;
    for (let f = center - 1; f <= center + 1; f++) {
      const s = window.__advance(1, true);
      const row = { frame: s.frame, base: grab() };
      if (f === center) row.hot = hottest();
      for (const [key, patch] of Object.entries(variants)) {
        row[key] = withSteel(() => {
          window.__advance(0, true);
          return grab();
        }, (m) => copyOf(m, key, patch).copy(m));
      }
      out.frames[f] = row;
    }
    const amp = (k) => {
      const [a, b, c] = [center - 1, center, center + 1].map((f) => out.frames[f][k].lum);
      let best = 0;
      for (let i = 0; i < 144; i++) {
        const d1 = b[i] - a[i], d2 = c[i] - b[i];
        if (Math.sign(d1) !== Math.sign(d2) && Math.abs(c[i] - a[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2))) best = Math.max(best, Math.min(Math.abs(d1), Math.abs(d2)));
      }
      return +best.toFixed(3);
    };
    const diff = (k) => {
      const p = out.frames[center].base.px, q = out.frames[center][k].px;
      let n = 0, max = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
        if (d) n++;
        if (d > max) max = d;
      }
      return { changedPx: n, maxDiff: max };
    };
    const res = { center, frame: out.frames[center].frame, hot: out.frames[center].hot, base: { amp: amp('base') } };
    for (const key of Object.keys(variants)) res[key] = { amp: amp(key), ...diff(key) };
    return res;
  };
  window.__stepTo = (f) => {
    let s = { frame: 0 };
    while (true) {
      s = window.__advance(1, true);
      if (s.frame >= f || s.done) return s.frame;
    }
  };
}, VARIANTS);

for (const c of centers) {
  const at = await page.evaluate((f) => window.__stepTo(f), c - 2);
  if (at !== c - 2) console.log('warning: stepped to', at, 'for center', c);
  console.log(JSON.stringify(await page.evaluate((f) => window.__trial(f), c)));
}
console.log('patches matched:', JSON.stringify(await page.evaluate(() => window.__matched)));
await browser.close();
