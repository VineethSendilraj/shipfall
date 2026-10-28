// Why does the ship vanish for single frames in orbit? Steps the capture to a frame where the flash scan saw it
// vanish, then re-renders that same state with one thing changed at a time and reads the ship's screen cells.
// Usage: node flight-orbit-vanish.mjs <base-url> <frame> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, frame, w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
const out = await page.evaluate((target) => {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const gl = document.getElementById('gl');
  // Mean luma of the 16x9 cells (7,4) and (8,4), where the ship sits in the orbit shot.
  const luma = () => {
    ctx.drawImage(gl, 0, 0, 640, 360);
    const px = ctx.getImageData(280, 160, 80, 40).data;
    let s = 0;
    for (let o = 0; o < px.length; o += 4) s += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    return +(s / (px.length / 4) / 255).toFixed(4);
  };
  const v = window.__view, cam = v.camera, ship = v.pool[2].root;
  const state = () => {
    const p = ship.position.clone().project(cam);
    const wp = ship.getWorldPosition(ship.position.clone());
    let meshes = 0, shown = 0;
    ship.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        let vis = true;
        for (let q = o; q; q = q.parent) vis &&= q.visible;
        if (vis) shown++;
      }
    });
    return { ndc: [p.x, p.y, p.z].map((x) => +x.toFixed(4)), world: [wp.x, wp.y].map((x) => +x.toFixed(1)), cam: [cam.position.x, cam.position.y, cam.position.z].map((x) => +x.toFixed(1)), visible: ship.visible, meshes, shown, parent: ship.parent?.type };
  };
  const log = [];
  while (window.__flight.frame < target - 2) window.__advance(1, true);
  for (let i = 0; i < 2; i++) {
    window.__advance(1, true);
    log.push({ frame: window.__flight.frame, luma: luma(), ...state() });
  }
  const tests = {};
  tests.rerender = (window.__advance(0, true), luma());
  tests.rerenderState = state();
  const culled = [];
  v.scene.traverse((o) => {
    if (o.frustumCulled) {
      culled.push(o);
      o.frustumCulled = false;
    }
  });
  tests.noCulling = (window.__advance(0, true), luma());
  for (const o of culled) o.frustumCulled = true;
  const fv = window.__flightView;
  fv.space.visible = false;
  tests.noSpaceRendered = (() => {
    // draw() turns the space sky back on, so render the composer directly after hiding it.
    v.composer.render();
    return luma();
  })();
  fv.space.visible = true;
  tests.composerOnly = (v.composer.render(), luma());
  window.__advance(1, true);
  log.push({ frame: window.__flight.frame, luma: luma(), ...state() });
  return { log, tests };
}, Number(frame));
console.log(JSON.stringify(out, null, 1));
await browser.close();
