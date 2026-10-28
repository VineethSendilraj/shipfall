// Explore on one map: each preset with the inspection lights as they are ("on") and forced to zero ("off"), from the
// same frozen camera. Holds the page's rAF loop and steps Explore.frame by hand, then reads the WebGL canvas.
// Prints near-white and clipped pixel shares and mean luma per shot, and writes an on/off contact sheet and
// (with FULL=1) each "on" frame as a JPEG.
// Usage: node explore-maps.mjs <base-url> <tag> <query, e.g. map=mars or tod=19> [w] [h] [presets]
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, tag, query = '', w = '1280', h = '720', only = ''] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const IDS = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(m.type(), m.text()));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__hold = false;
  const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
  window.requestAnimationFrame = wrap;
});
await page.goto(`${base}/?explore=1&quality=high${query ? `&${query}` : ''}`, { timeout: 240000 });
await page.waitForFunction(() => window.__explore?.shapes?.length && !window.__explore.flight, null, { polling: 100, timeout: 240000 });
await page.waitForTimeout(500);
console.log('map', await page.evaluate(() => window.__view.world.map), query);

const shots = [];
for (const id of IDS) {
  if (only && !only.split(',').includes(id)) continue;
  const r = await page.evaluate((id) => {
    window.__hold = true;
    const x = window.__explore;
    const gl = x.view.renderer.domElement;
    const grab = () => {
      const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(gl, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let white = 0, clip = 0, sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l;
        if (l >= 240) white++;
        if (Math.max(d[i], d[i + 1], d[i + 2]) >= 254) clip++;
      }
      const n = d.length / 4;
      return { m: { white: +((100 * white) / n).toFixed(2), clip: +((100 * clip) / n).toFixed(2), mean: +(sum / n).toFixed(1) }, url: c.toDataURL('image/jpeg', 0.9) };
    };
    const light = x.light;
    x.enter(id);
    x.idle = -1e9;
    for (let k = 0; k < 4; k++) x.frame(1 / 60);
    const lights = { lamp: Math.round(x.lamp.intensity), fill: Math.round(x.fill.intensity) };
    const on = grab();
    x.light = function () {
      light.call(x);
      x.lamp.intensity = 0;
      x.fill.intensity = 0;
    };
    x.frame(1 / 60);
    x.frame(1 / 60);
    const off = grab();
    x.light = light;
    return { id, lights, on, off };
  }, id);
  console.log(`${id.padEnd(11)} lamp ${String(r.lights.lamp).padStart(5)} fill ${String(r.lights.fill).padStart(4)} | on ${JSON.stringify(r.on.m)} | off ${JSON.stringify(r.off.m)}`);
  if (process.env.FULL) writeFileSync(`${D}/explore-maps-${tag}-${id}.jpg`, Buffer.from(r.on.url.split(',')[1], 'base64'));
  if (process.env.FULL === 'both') writeFileSync(`${D}/explore-maps-${tag}-${id}-off.jpg`, Buffer.from(r.off.url.split(',')[1], 'base64'));
  shots.push(r);
}

// Contact sheet: one row per preset, lights on (left) and off (right), at half size.
const sheet = await page.evaluate(async (shots) => {
  const load = async (u) => createImageBitmap(await (await fetch(u)).blob());
  const first = await load(shots[0].on.url);
  const sw = first.width / 2, sh = first.height / 2, pad = 22;
  const c = new OffscreenCanvas(sw * 2 + 6, shots.length * (sh + pad));
  const g = c.getContext('2d');
  g.fillStyle = '#111';
  g.fillRect(0, 0, c.width, c.height);
  g.font = '15px sans-serif';
  g.fillStyle = '#fff';
  for (let r = 0; r < shots.length; r++) {
    const y = r * (sh + pad);
    g.fillText(`${shots[r].id}: lights on | off (lamp ${shots[r].lights.lamp}, fill ${shots[r].lights.fill})`, 6, y + 16);
    for (const [k, u] of [shots[r].on.url, shots[r].off.url].entries()) g.drawImage(await load(u), k * (sw + 6), y + pad, sw, sh);
  }
  const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}, shots);
writeFileSync(`${D}/explore-maps-${tag}.jpg`, Buffer.from(sheet, 'base64'));
console.log('sheet', `${D}/explore-maps-${tag}.jpg`);
await browser.close();
