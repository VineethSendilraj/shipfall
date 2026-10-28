// Second probe for the black ship: counts the ship meshes' draw calls on the flagged frame and its neighbours, then
// re-renders that frame with the planet, the air or shadows taken away, or the camera moved a little.
// Usage: node flight-orbit-nan2.mjs <base-url> <frame> [cellX] [cellY]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, frame, cx = '7', cy = '4'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
const out = await page.evaluate(([target, cx, cy]) => {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const gl = document.getElementById('gl');
  const luma = () => {
    ctx.drawImage(gl, 0, 0, 640, 360);
    const px = ctx.getImageData(cx * 40, cy * 40, 80, 40).data;
    let s = 0;
    for (let o = 0; o < px.length; o += 4) s += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    return +(s / (px.length / 4) / 255).toFixed(4);
  };
  const v = window.__view, fv = window.__flightView, cam = v.camera;
  const shipMeshes = [];
  v.pool[2].root.traverse((o) => o.isMesh && shipMeshes.push(o));
  let draws = 0;
  for (const m of shipMeshes) {
    const prev = m.onBeforeRender;
    m.onBeforeRender = function (...a) {
      draws++;
      return prev.apply(this, a);
    };
  }
  const log = [];
  while (window.__flight.frame < target - 1) window.__advance(1, true);
  const frameInfo = () => {
    const f = window.__flight;
    return { frame: f.frame, luma: luma(), draws, mode: f.ship.mode, shipXY: [f.ship.x, f.ship.y].map((x) => +x.toFixed(2)), ang: +f.ship.ang.toFixed(5), camPos: cam.position.toArray().map((x) => +x.toFixed(2)), near: cam.near, far: +cam.far.toFixed(1), fov: cam.fov, up: cam.up.toArray().map((x) => +x.toFixed(5)) };
  };
  draws = 0;
  window.__advance(1, true);
  log.push(frameInfo());
  const tests = {};
  const run = (name, change, undo) => {
    change();
    draws = 0;
    v.composer.render();
    tests[name] = { luma: luma(), draws };
    undo();
  };
  run('control', () => {}, () => {});
  const mats = shipMeshes.map((m) => m.material);
  const Basic = fv.craft.slot.material.constructor;
  run('basicRed', () => shipMeshes.forEach((m) => (m.material = new Basic({ color: 0xff0000 }))), () => shipMeshes.forEach((m, i) => (m.material = mats[i])));
  run('litEmissiveRed', () => shipMeshes.forEach((m) => { m.material = m.material.clone(); m.material.color?.setRGB(1, 0, 0); m.material.emissive?.setRGB(1, 0, 0); m.material.emissiveIntensity = 1; m.material.envMapIntensity = 0; m.material.metalness = 0; m.material.roughness = 1; }), () => shipMeshes.forEach((m, i) => (m.material = mats[i])));
  run('noReceiveShadow', () => shipMeshes.forEach((m) => (m.receiveShadow = false)), () => shipMeshes.forEach((m) => (m.receiveShadow = true)));
  const moon = v.world.moon;
  run('moonNoShadow', () => (moon.castShadow = false), () => (moon.castShadow = true));
  const env = v.scene.environment;
  run('envNull', () => (v.scene.environment = null), () => (v.scene.environment = env));
  run('noPlanet', () => (fv.planet.visible = false), () => (fv.planet.visible = true));
  run('noAir', () => (fv.air.visible = false), () => (fv.air.visible = true));
  run('noSpace', () => (fv.space.visible = false), () => (fv.space.visible = true));
  const p0 = cam.position.clone();
  run('camUp1m', () => { cam.position.y += 1; cam.updateMatrixWorld(); }, () => { cam.position.copy(p0); cam.updateMatrixWorld(); });
  run('camZ1m', () => { cam.position.z += 1; cam.updateMatrixWorld(); }, () => { cam.position.copy(p0); cam.updateMatrixWorld(); });
  const n0 = cam.near;
  run('near1', () => { cam.near = 1; cam.updateProjectionMatrix(); }, () => { cam.near = n0; cam.updateProjectionMatrix(); });
  const f0 = cam.far;
  run('far20k', () => { cam.far = 20000; cam.updateProjectionMatrix(); }, () => { cam.far = f0; cam.updateProjectionMatrix(); });
  const sm = v.renderer.shadowMap;
  run('noShadowUpdate', () => { sm.autoUpdate = false; sm.needsUpdate = false; }, () => { sm.autoUpdate = true; });
  draws = 0;
  window.__advance(1, true);
  log.push(frameInfo());
  return { log, tests };
}, [Number(frame), Number(cx), Number(cy)]);
console.log(JSON.stringify(out));
await browser.close();
