import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const [base, f, cx, cy] = process.argv.slice(2).map((x, i) => (i ? Number(x) : x));
const src = readFileSync('/Users/vsendilraj/dev/scratch/catch-the-ship-blender/node_modules/three/src/renderers/shaders/ShaderChunk/bumpmap_pars_fragment.glsl.js', 'utf8');
const chunk = src.slice(src.indexOf('`') + 1, src.lastIndexOf('`'));
const ret = 'return normalize( abs( fDet ) * surf_norm - vGrad );';
const tilt = (deg) => chunk.replace(ret, `vGrad *= min( 1.0, ${Math.tan((deg * Math.PI) / 180).toFixed(4)} * abs( fDet ) / max( length( vGrad ), 1e-6 ) );\n\t\t${ret}`);
const variants = { tilt45: tilt(45), tilt60: tilt(60), tilt75: tilt(75) };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
const r = await page.evaluate(([f, cx, cy, variants]) => {
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
  const out = { f, guardInSource: String(steel.onBeforeCompile).includes('bumpmap_pars_fragment'), current: cell() };
  const orig = steel.onBeforeCompile;
  for (const [name, text] of Object.entries(variants)) {
    steel.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <bumpmap_pars_fragment>', text); };
    steel.customProgramCacheKey = () => name;
    steel.needsUpdate = true;
    out[name] = cell();
  }
  steel.onBeforeCompile = orig; steel.customProgramCacheKey = () => 'orig'; steel.needsUpdate = true;
  out.backToCurrent = cell();
  const bs = steel.bumpScale; steel.bumpScale = 0; out.bumpOff = cell(); steel.bumpScale = bs;
  return out;
}, [f, cx, cy, variants]);
console.log(JSON.stringify(r));
await browser.close();
