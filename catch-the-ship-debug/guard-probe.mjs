import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const [base, list] = process.argv.slice(2);
const src = readFileSync('/Users/vsendilraj/dev/scratch/catch-the-ship-blender/node_modules/three/src/renderers/shaders/ShaderChunk/bumpmap_pars_fragment.glsl.js', 'utf8');
const chunk = src.slice(src.indexOf('`') + 1, src.lastIndexOf('`'));
const guarded = chunk.replace('return normalize( abs( fDet ) * surf_norm - vGrad );', 'return abs( fDet ) < 0.05 ? surf_norm : normalize( abs( fDet ) * surf_norm - vGrad );');
if (guarded === chunk) throw new Error('chunk text changed');
const targets = list.split(',').map((s) => s.split(':').map(Number)).sort((a, b) => a[0] - b[0]);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
for (const [f, cx, cy] of targets) {
  const r = await page.evaluate(([f, cx, cy, guarded]) => {
    const v = window.__view, steel = v.boosterMats.steel;
    const cur = window.__demoFrame;
    if (f > cur) window.__advance(f - cur, true);
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const cell = () => {
      window.__advance(0, true);
      ctx.drawImage(document.getElementById('gl'), 0, 0, 640, 360);
      const px = ctx.getImageData(cx * 40, cy * 40, 40, 40).data;
      let s = 0;
      for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return +(s / (px.length / 4) / 255).toFixed(3);
    };
    const meshes = [];
    for (const slot of v.pool) slot.root.traverse((m) => { if (m.isMesh && m.material === steel) meshes.push(m); });
    const geos = [...new Set(meshes.map((m) => m.geometry))];
    window.__savedTangents ??= geos.map((g) => g.attributes.tangent);
    const setTangents = (on) => geos.forEach((g, i) => { if (on) g.setAttribute('tangent', window.__savedTangents[i]); else g.deleteAttribute('tangent'); });
    const setGuard = (on) => {
      steel.onBeforeCompile = on ? (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <bumpmap_pars_fragment>', guarded); } : () => {};
      steel.customProgramCacheKey = () => (on ? 'guard' : 'plain');
      steel.needsUpdate = true;
    };
    const out = { f };
    for (const [name, t, g] of [['tangents', true, false], ['tangents+guard', true, true], ['plain', false, false], ['guard only', false, true]]) {
      setTangents(t); setGuard(g); out[name] = cell();
    }
    setTangents(true); setGuard(false);
    return out;
  }, [f, cx, cy, guarded]);
  console.log(JSON.stringify(r));
}
await browser.close();
