// Finds what turns the ship black on a frame the flash scan flagged: steps the capture there, reports lights with
// non-finite values, then zeroes one light at a time (and the environment) and re-renders the same scene.
// Usage: node flight-orbit-nan.mjs <base-url> <frame> [cellX] [cellY]
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
  const v = window.__view;
  while (window.__flight.frame < target) window.__advance(1, true);
  const bad = (o) => Object.entries(o).filter(([, x]) => typeof x === 'number' && !Number.isFinite(x)).map(([k]) => k);
  const lights = [];
  v.scene.traverse((o) => {
    if (!o.isLight) return;
    const wp = o.getWorldPosition(o.position.clone());
    const info = { type: o.type, name: o.name, visible: o.visible, intensity: o.intensity, color: o.color.toArray().map((x) => +x.toFixed(4)), pos: wp.toArray().map((x) => +x.toFixed(1)) };
    if (o.target) info.target = o.target.getWorldPosition(o.position.clone()).toArray().map((x) => +x.toFixed(1));
    if (o.groundColor) info.ground = o.groundColor.toArray().map((x) => +x.toFixed(4));
    if (o.castShadow) info.shadow = true;
    info.nonFinite = [...bad({ i: o.intensity, r: o.color.r, g: o.color.g, b: o.color.b, x: wp.x, y: wp.y, z: wp.z })];
    lights.push({ o, info });
  });
  const scene = v.scene;
  const res = { frame: window.__flight.frame, base: luma(), env: { intensity: scene.environmentIntensity, rotZ: scene.environmentRotation.z, isSpace: scene.environment === window.__flightView.spaceEnv }, lights: lights.map((l) => l.info), zeroed: {} };
  v.composer.render();
  res.rerender = luma();
  lights.forEach((l, i) => {
    const was = l.o.intensity;
    l.o.intensity = 0;
    v.composer.render();
    res.zeroed[`${i}:${l.o.type}${l.o.name ? `:${l.o.name}` : ''}`] = luma();
    l.o.intensity = was;
  });
  const ei = scene.environmentIntensity;
  scene.environmentIntensity = 0;
  v.composer.render();
  res.zeroed.environment = luma();
  scene.environmentIntensity = ei;
  return res;
}, [Number(frame), Number(cx), Number(cy)]);
console.log(JSON.stringify(out, null, 1));
await browser.close();
