import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
const r = await page.evaluate(() => {
  window.__advance(1288 - window.__demoFrame, true);
  const v = window.__view, gl = v.renderer.getContext();
  const progs = v.renderer.info.programs.map((p) => {
    const fs = gl.getShaderSource(p.fragmentShader) || '';
    return { name: p.name, bump: fs.includes('perturbNormalArb'), guard: fs.includes('abs( fDet ) < 0.05'), aniso: fs.includes('USE_ANISOTROPY'), tangent: /#define USE_TANGENT/.test(fs) };
  }).filter((p) => p.bump);
  const steel = v.boosterMats.steel;
  const meshes = [];
  v.scene.traverse((m) => { if (m.isMesh && m.material === steel && m.visible) meshes.push({ name: m.name, tangent: !!m.geometry.attributes.tangent }); });
  return { progs, steelMeshes: meshes.slice(0, 6), steelMeshCount: meshes.length };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
