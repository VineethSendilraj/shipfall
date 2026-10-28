// Re-renders flagged frames of the scripted free flight with one thing changed at a time and reads a cell region's
// luma, to find what makes a flash. Also saves a crop of each frame rendered without bloom.
// Usage: node flight-orbit-probe.mjs <base-url> <frame:x0:y0:x1:y1>... (cells of the scan's 16x9 grid, inclusive)
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, ...specs] = process.argv.slice(2);
const DIR = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const jobs = specs.map((s) => s.split(':').map(Number)).sort((a, b) => a[0] - b[0]);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
for (const [frame, x0, y0, x1, y1] of jobs) {
  const out = await page.evaluate(([target, x0, y0, x1, y1]) => {
    const c = (window.__probeCanvas ??= Object.assign(document.createElement('canvas'), { width: 640, height: 360 }));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const gl = document.getElementById('gl');
    const luma = () => {
      ctx.drawImage(gl, 0, 0, 640, 360);
      const px = ctx.getImageData(x0 * 40, y0 * 40, (x1 - x0 + 1) * 40, (y1 - y0 + 1) * 40).data;
      let s = 0;
      for (let o = 0; o < px.length; o += 4) s += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
      return +(s / (px.length / 4) / 255).toFixed(4);
    };
    const v = window.__view, fv = window.__flightView;
    while (window.__flight.frame < target - 1) window.__advance(1, true);
    const before = luma();
    window.__advance(1, true);
    const res = { frame: window.__flight.frame, before, tests: {} };
    const run = (name, change, undo) => {
      change();
      v.composer.render();
      res.tests[name] = luma();
      undo();
    };
    const bloom = v.composer.passes.find((p) => p.constructor.name === 'UnrealBloomPass');
    const stack = [];
    for (const i of [0, 2]) v.pool[i].root.traverse((o) => o.isMesh && stack.push([o, o.material]));
    const Basic = fv.craft.slot.material.constructor;
    const gray = new Basic({ color: 0x808080 });
    const lights = [];
    v.scene.traverse((o) => o.isLight && lights.push([o, o.intensity]));
    run('control', () => {}, () => {});
    run('noBloom', () => (bloom.enabled = false), () => (bloom.enabled = true));
    run('noAir', () => (fv.air.visible = false), () => (fv.air.visible = true));
    run('noSpace', () => (fv.space.visible = false), () => (fv.space.visible = true));
    run('noPlanet', () => (fv.planet.visible = false), () => (fv.planet.visible = true));
    run('grayStack', () => stack.forEach(([o]) => (o.material = gray)), () => stack.forEach(([o, m]) => (o.material = m)));
    run('noLights', () => lights.forEach(([o]) => (o.intensity = 0)), () => lights.forEach(([o, i]) => (o.intensity = i)));
    const ei = v.scene.environmentIntensity;
    run('noEnv', () => (v.scene.environmentIntensity = 0), () => (v.scene.environmentIntensity = ei));
    // A full-resolution crop around the region, rendered without bloom, to see the source pixels.
    bloom.enabled = false;
    v.composer.render();
    bloom.enabled = true;
    const crop = Object.assign(document.createElement('canvas'), { width: 480, height: 320 });
    const cx = ((x0 + x1 + 1) / 2) * 80, cy = ((y0 + y1 + 1) / 2) * 80;
    crop.getContext('2d').drawImage(gl, cx - 240, cy - 160, 480, 320, 0, 0, 480, 320);
    res.png = crop.toDataURL('image/png');
    return res;
  }, [frame, x0, y0, x1, y1]);
  writeFileSync(`${DIR}/flight-orbit-probe-${frame}.png`, Buffer.from(out.png.split(',')[1], 'base64'));
  delete out.png;
  console.log(JSON.stringify(out));
}
await browser.close();
