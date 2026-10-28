import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const [base, list] = process.argv.slice(2);
const src = readFileSync('/Users/vsendilraj/dev/scratch/catch-the-ship-blender/node_modules/three/src/renderers/shaders/ShaderChunk/lights_physical_fragment.glsl.js', 'utf8');
const chunk = src.slice(src.indexOf('`') + 1, src.lastIndexOf('`'));
const line = 'vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );';
const floorLine = 'material.roughness = max( roughnessFactor, 0.0525 );';
if (!chunk.includes(floorLine)) throw new Error('floor line not found');
const saa = Object.fromEntries([0.28, 0.32, 0.36].map((r) => [`floor${r}`, chunk.replace(floorLine, `material.roughness = max( roughnessFactor, ${r} );`)]));
const targets = list.split(',').map((s) => s.split(':').map(Number)).sort((a, b) => a[0] - b[0]);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
for (const [f, cx, cy] of targets) {
  const r = await page.evaluate(([f, cx, cy, saa]) => {
    const v = window.__view, steel = v.boosterMats.steel;
    window.__advance(f - window.__demoFrame, true);
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
    const set = (fn, key) => { steel.onBeforeCompile = fn; steel.customProgramCacheKey = () => key; steel.needsUpdate = true; };
    const out = { f, current: cell() };
    set(() => {}, 'none'); out.noPatch = cell();
    for (const [k, text] of Object.entries(saa)) { set((sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', text); }, k); out[k] = cell(); }
    return out;
  }, [f, cx, cy, saa]);
  console.log(JSON.stringify(r));
}
await browser.close();
