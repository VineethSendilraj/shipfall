// Screenshots of chosen frames of the scripted free flight (?flight=1&capture=1). Renders every frame on the way,
// like the flash scan, so view state matches the scan exactly.
// Usage: node flight-orbit-frames.mjs <base-url> <w> <h> <prefix> <frame>...
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, prefix, ...list] = process.argv.slice(2);
const DIR = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const targets = list.map(Number).sort((a, b) => a - b);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
for (const t of targets) {
  const info = await page.evaluate((t) => {
    let r = null;
    while (window.__flight.frame < t) r = window.__advance(1, true);
    const f = window.__flight, v = window.__flightView, cam = window.__view.camera;
    return { frame: f.frame, real: +f.real.toFixed(2), warp: +f.warp.toFixed(2), mode: f.ship.mode, phase: f.phase, throttle: f.throttle, cut: !!f.cut, shot: v.director.shot, near: +cam.near.toFixed(2), far: Math.round(cam.far), dist: +cam.position.distanceTo(v.director.tgt).toFixed(1), done: r?.done };
  }, t);
  await page.screenshot({ path: `${DIR}/${prefix}-${t}.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });
  console.log(JSON.stringify(info));
}
await browser.close();
