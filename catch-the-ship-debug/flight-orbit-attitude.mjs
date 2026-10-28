// Does the stack's attitude step under a one-frame glint: logs tilt, its change, the camera and the region's luma
// for each frame of a window.
// Usage: node flight-orbit-attitude.mjs <base-url> <from> <to> <x0> <y0> <x1> <y1> (cells of the scan's 16x9 grid)
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, from, to, x0, y0, x1, y1] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
const rows = await page.evaluate(([from, to, x0, y0, x1, y1]) => {
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
  const f = window.__flight;
  const d = window.__flightView.director;
  const cam = window.__view.camera;
  while (f.frame < from - 1) window.__advance(1, true);
  const out = [];
  let tilt = f.tilt;
  while (f.frame < to) {
    window.__advance(1, true);
    const fwd = cam.getWorldDirection(cam.position.clone());
    out.push({
      f: f.frame,
      tilt: +f.tilt.toFixed(5),
      dTilt: +(f.tilt - tilt).toFixed(5),
      ang: +f.booster.ang.toFixed(5),
      throttle: f.booster.throttle,
      shot: d.shot,
      cam: cam.position.toArray().map((x) => +x.toFixed(2)),
      fwd: fwd.toArray().map((x) => +x.toFixed(4)),
      fov: +cam.fov.toFixed(3),
      luma: luma(),
    });
    tilt = f.tilt;
  }
  return out;
}, [Number(from), Number(to), Number(x0), Number(y0), Number(x1), Number(y1)]);
for (const r of rows) console.log(JSON.stringify(r));
await browser.close();
