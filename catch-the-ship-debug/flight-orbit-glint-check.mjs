// Lists every polished-steel material in the scene (metalness 1, roughness <= 0.2) and whether its compiled fragment
// shader contains the cap. Usage: node flight-orbit-glint-check.mjs <base-url> <demo|flight> [frames to step]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, mode, steps = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text().slice(0, 400)));
await page.goto(`${base}/?${mode}=1&capture=1`, { timeout: 600000 });
await page.waitForFunction((m) => window[m === 'demo' ? '__demoReady' : '__flightReady'] === true, mode, { timeout: 600000 });
console.log(JSON.stringify(await page.evaluate((n) => {
  window.__advance(n, true);
  const { renderer, scene } = window.__view;
  const gl = renderer.getContext();
  const seen = new Map();
  scene.traverse((o) => {
    const m = o.material;
    if (!m || !m.isMeshStandardMaterial || m.metalness !== 1 || m.roughness > 0.2) return;
    const e = seen.get(m) ?? { id: m.id, vertexColors: m.vertexColors, side: m.side, meshes: [], capped: null };
    e.meshes.push(o.name || o.parent?.name || '?');
    const prog = renderer.properties.get(m).currentProgram;
    if (prog) e.capped = gl.getShaderSource(prog.fragmentShader).includes('min( outgoingLight, vec3( 256.0 ) )');
    seen.set(m, e);
  });
  return [...seen.values()];
}, Number(steps)), null, 1));
await browser.close();
