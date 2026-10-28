// Dumps renderer, light and booster-steel state after stepping the demo to a frame. Usage: node ship-statedump.mjs <base> [frame]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, frame = '330'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 200)));
const t0 = Date.now();
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
console.log('ready after', Date.now() - t0, 'ms');
await page.evaluate((n) => window.__advance(n, true), Number(frame));
const s = await page.evaluate(() => {
  const v = window.__view;
  const r = v.renderer;
  const slot = v.pool.find((x) => x.root.visible);
  let steel = null;
  let meshes = 0;
  slot.root.traverse((o) => {
    if (o.isMesh) meshes++;
    if (o.isMesh && (o.userData.role === 'steel' || (!o.userData.role && o.material === v.boosterMats.steel))) steel = steel || o;
  });
  const lights = [];
  v.scene.traverse((o) => {
    if (o.isLight) lights.push(`${o.type}:${o.intensity.toFixed(1)}@${o.getWorldPosition(o.position.clone()).toArray().map((x) => x.toFixed(0)).join(',')}${o.castShadow ? ':shadow' : ''}${o.visible ? '' : ':hidden'}`);
  });
  const m = steel?.material;
  return {
    exposure: r.toneMappingExposure,
    toneMapping: r.toneMapping,
    envI: v.scene.environmentIntensity,
    env: v.scene.environment ? [v.scene.environment.image?.width, v.scene.environment.image?.height] : null,
    background: !!v.scene.background,
    shadowType: r.shadowMap.type,
    modelSteel: steel ? { role: steel.userData.role ?? 'procedural', tangent: !!steel.geometry.attributes.tangent, color: !!steel.geometry.attributes.color, verts: steel.geometry.attributes.position.count } : null,
    meshes,
    mat: m ? { type: m.type, rough: m.roughness, metal: m.metalness, envMapIntensity: m.envMapIntensity, aniso: m.anisotropy, vc: m.vertexColors, color: m.color.getHexString(), bumpScale: m.bumpScale } : null,
    lights,
  };
});
console.log(JSON.stringify(s, null, 1));
await browser.close();
