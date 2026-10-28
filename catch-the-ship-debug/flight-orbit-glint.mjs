// Which light makes a one-frame glint: steps the capture to the frame, zeroes one light at a time and re-renders,
// and reports the brightest pixels of the region rendered without bloom.
// Usage: node flight-orbit-glint.mjs <base-url> <frame> <x0> <y0> <x1> <y1> (cells of the scan's 16x9 grid)
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, frame, x0, y0, x1, y1] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
const out = await page.evaluate(([target, x0, y0, x1, y1]) => {
  const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const gl = document.getElementById('gl');
  const luma = () => {
    ctx.drawImage(gl, 0, 0, 640, 360);
    const px = ctx.getImageData(x0 * 40, y0 * 40, (x1 - x0 + 1) * 40, (y1 - y0 + 1) * 40).data;
    let s = 0;
    for (let o = 0; o < px.length; o += 4) s += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    return +(s / (px.length / 4) / 255).toFixed(4);
  };
  const v = window.__view;
  while (window.__flight.frame < target) window.__advance(1, true);
  const lights = [];
  v.scene.traverse((o) => o.isLight && lights.push(o));
  const res = { frame: window.__flight.frame, control: luma(), zeroed: {} };
  lights.forEach((o, i) => {
    const was = o.intensity;
    o.intensity = 0;
    v.composer.render();
    const p = o.getWorldPosition(o.position.clone());
    res.zeroed[`${i}:${o.type}@${p.toArray().map((x) => Math.round(x)).join(',')}:i${Math.round(was)}${o.castShadow ? ':shadow' : ''}`] = luma();
    o.intensity = was;
  });
  const m = v.world.moon;
  res.moon = { color: m.color.toArray().map((x) => +x.toFixed(3)), intensity: m.intensity, dir: m.position.clone().sub(m.target.position).normalize().toArray().map((x) => +x.toFixed(3)) };
  return res;
}, [Number(frame), Number(x0), Number(y0), Number(x1), Number(y1)]);
console.log(JSON.stringify(out, null, 1));
await browser.close();
