// Deterministic flash scan for explore mode. Holds the page's own rAF loop, steps Explore.frame(1/60) by hand
// through a scripted path (every preset glide, close zooms, orbit drags, a pan, turntable stretches), samples a
// 16x9 block-luma grid of the canvas downscaled to 640x360 after every frame, and reports cells that jump and come
// straight back (T = 0.06, as flicker-det.mjs). Also saves contact sheets of a few long glides.
// Usage: [QUERY=map=mars] node explore-flash.mjs <base-url> [w] [h] [quality]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
import { lampVariant } from './explore-lamp-variant.mjs';
import { lampSpeedFade } from './explore-lamp-fade.mjs';

const [base = 'http://127.0.0.1:41830', w = '1280', h = '720', quality = 'high'] = process.argv.slice(2);
const W = Number(w);
const H = Number(h);
const tag = process.env.TAG ?? quality;
const query = process.env.QUERY ?? '';
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__hold = false;
  const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
  window.requestAnimationFrame = wrap;
});
await page.goto(`${base}/?explore=1&quality=${quality}${query ? `&${query}` : ''}`, { timeout: 240000 });
page.setDefaultTimeout(240000);
await page.waitForFunction(() => window.__explore?.shapes?.length && !window.__explore.flight, null, { polling: 100, timeout: 240000 });
await page.waitForTimeout(800);
// DUMP=<dir> saves every flagged frame: its strongest cell before, at and after the frame, at full size, plus the frame.
const dumpDir = process.env.DUMP;
await page.evaluate((dump) => {
  window.__hold = true;
  const GW = 16, GH = 9, SW = 640, SH = 360, BW = SW / GW, BH = SH / GH;
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const gl = window.__explore.view.renderer.domElement;
  const full = [0, 1, 2].map(() => Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height }));
  const strip = Object.assign(document.createElement('canvas'), { width: 3 * 160 + 320, height: 180 });
  window.__dumps = [];
  const dumpFrame = (F) => {
    full[(F.length - 1) % 3].getContext('2d').drawImage(gl, 0, 0);
    if (F.length < 3) return;
    const [a, b, cc] = [F.at(-3).lum, F.at(-2).lum, F.at(-1).lum];
    let best = -1, amp = 0, n = 0;
    for (let i = 0; i < b.length; i++) {
      const d1 = b[i] - a[i], d2 = cc[i] - b[i];
      if (Math.abs(d1) > 0.06 && Math.abs(d2) > 0.06 && Math.sign(d1) !== Math.sign(d2) && Math.abs(cc[i] - a[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2))) {
        n++;
        if (Math.min(Math.abs(d1), Math.abs(d2)) > amp) [amp, best] = [Math.min(Math.abs(d1), Math.abs(d2)), i];
      }
    }
    if (best < 0) return;
    const cw = gl.width / GW, ch = gl.height / GH;
    const [cx, cy] = [((best % GW) + 0.5) * cw, (Math.floor(best / GW) + 0.5) * ch];
    const g = strip.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, strip.width, strip.height);
    [-3, -2, -1].forEach((j, i) => g.drawImage(full[(F.length + j) % 3], cx - 80, cy - 80, 160, 160, i * 160, 10, 160, 160));
    g.drawImage(full[(F.length - 2) % 3], 480, 0, 320, 180);
    g.strokeStyle = '#f00';
    g.strokeRect(480 + ((best % GW) * 320) / GW, (Math.floor(best / GW) * 180) / GH, 320 / GW, 180 / GH);
    window.__dumps.push({ f: F.length - 2, label: F.at(-2).label, cell: [best % GW, Math.floor(best / GW)], n, amp: +amp.toFixed(3), url: strip.toDataURL('image/jpeg', 0.9) });
  };
  window.__frames = [];
  window.__sheets = {};
  // The last three frames' pixels, and up to 16 big spikes kept with their neighbours for a look.
  const recent = [];
  window.__caught = [];
  const spikeAmp = (a, b, c) => {
    let amp = 0;
    for (let i = 0; i < b.length; i++) {
      const d1 = b[i] - a[i], d2 = c[i] - b[i];
      if (Math.sign(d1) !== Math.sign(d2) && Math.abs(c[i] - a[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2))) amp = Math.max(amp, Math.min(Math.abs(d1), Math.abs(d2)));
    }
    return amp;
  };
  /** Steps n frames (or until a glide ends, plus `after`), sampling each. sheet: [name, stride] draws thumbnails. */
  window.__run = (n, { label = '', untilLanded = false, after = 0, sheet = null } = {}) => {
    const e = window.__explore;
    let left = after;
    let k = 0;
    window.__seg = label;
    for (; k < n; k++) {
      e.frame(1 / 60);
      ctx.drawImage(gl, 0, 0, SW, SH);
      const px = ctx.getImageData(0, 0, SW, SH).data;
      const sum = new Float64Array(GW * GH);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const o = (y * SW + x) * 4;
        sum[Math.floor(y / BH) * GW + Math.floor(x / BW)] += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
      }
      const cam = e.view.camera.position;
      const rel = (p) => [p.x - e.foot.x, p.y, p.z - e.foot.z].map((n) => Math.round(n * 10) / 10);
      window.__frames.push({ label, lum: Array.from(sum, (v) => +(v / (BW * BH * 255)).toFixed(4)), cam: rel(cam), tgt: rel(e.controls.target) });
      if (dump) dumpFrame(window.__frames);
      recent.push(px);
      if (recent.length > 3) recent.shift();
      const F = window.__frames;
      if (recent.length === 3 && F.length >= 3) {
        const amp = spikeAmp(F.at(-3).lum, F.at(-2).lum, F.at(-1).lum);
        // Keep the biggest spike per segment.
        const prev = window.__caught.find((r) => r.label === label);
        const row = { f: F.length - 2, label, amp: +amp.toFixed(3), cam: [F.at(-3).cam, F.at(-2).cam, F.at(-1).cam], tgt: F.at(-2).tgt, px: [...recent] };
        if (amp > 0.15 && !prev) window.__caught.push(row);
        else if (prev && amp > prev.amp) Object.assign(prev, row);
      }
      if (sheet && k % sheet[1] === 0) {
        const s = (window.__sheets[sheet[0]] ??= { canvas: Object.assign(document.createElement('canvas'), { width: 4 * 320, height: 4 * 180 }), n: 0 });
        if (s.n < 16) s.canvas.getContext('2d').drawImage(gl, (s.n % 4) * 320, Math.floor(s.n / 4) * 180, 320, 180);
        s.n++;
      }
      if (untilLanded && !e.flight && left-- <= 0) break;
    }
    return k;
  };
  window.__key = (n) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(n), code: `Digit${n}`, bubbles: true }));
  /** A screen point near (x, y) whose ray hits the tower within 120 m, so a zoom there closes in on a girder. */
  window.__onTower = (x, y) => {
    const e = window.__explore;
    const ray = e.raycaster;
    const rect = gl.getBoundingClientRect();
    for (let r = 0; r < 200; r += 6) {
      for (let k = 0; k < 16; k++) {
        const px = x + r * Math.cos((k * Math.PI) / 8);
        const py = y + r * Math.sin((k * Math.PI) / 8);
        ray.setFromCamera({ x: ((px - rect.left) / rect.width) * 2 - 1, y: 1 - ((py - rect.top) / rect.height) * 2 }, e.view.camera);
        const hit = ray.intersectObject(e.view.towers[0].root)[0];
        if (hit && hit.distance < 120) return { x: px, y: py, d: hit.distance };
      }
    }
    return null;
  };
}, Boolean(dumpDir));

// NOLAMP=1 turns the inspection lights off, as a control. LAMP='{"K":1.5,"off":"clear"}' swaps in a candidate lamp.
if (process.env.NOLAMP) await page.evaluate(() => { const e = window.__explore; e.light = () => { e.lamp.intensity = 0; e.fill.intensity = 0; }; });
if (process.env.LAMP) await page.evaluate(lampVariant, JSON.parse(process.env.LAMP));
// FADE='{"by":"omega","range":[10,25]}' dims the lamp while the model sweeps past (explore-lamp-fade.mjs).
if (process.env.FADE) await page.evaluate(lampSpeedFade, JSON.parse(process.env.FADE));
// CAP=<value> applies PR #18's facing-aware cap to the mount steel the props model uses; CAPON=all to every
// standard material in the scene instead.
if (process.env.CAP) {
  const n = await page.evaluate(({ cap, all }) => {
    const { scene } = window.__explore.view;
    const mats = new Set();
    if (all) scene.traverse((o) => o.isMesh && [o.material].flat().forEach((m) => m.isMeshStandardMaterial && mats.add(m)));
    else mats.add(scene.getObjectByName('props_mountSteel').material);
    const line = `if ( dot( geometryNormal, geometryViewDir ) < 0.0 ) outgoingLight = min( outgoingLight, vec3( ${cap.toFixed(1)} ) );\n#include <opaque_fragment>`;
    for (const m of mats) {
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, r) => {
        prev.call(m, shader, r);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', line);
      };
      m.customProgramCacheKey = () => `cap${cap}:${prev.toString()}`;
      m.needsUpdate = true;
    }
    return mats.size;
  }, { cap: Number(process.env.CAP), all: process.env.CAPON === 'all' });
  console.log(`capped ${n} materials at ${process.env.CAP}`);
}

const names = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
let at = 1;
const glide = async (k, sheet = null) => {
  const label = `glide ${names[at - 1]}->${names[k - 1]}`;
  const info = await page.evaluate(({ k, label, sheet }) => {
    const e = window.__explore;
    const rel = (p) => [p.x - e.foot.x, p.y, p.z - e.foot.z].map((n) => Math.round(n * 10) / 10);
    const from = { cam: rel(e.view.camera.position), tgt: rel(e.controls.target) };
    window.__key(k);
    const f = e.flight;
    const out = { ...from, turnDeg: Math.round((f.turn * 180) / Math.PI), hop: Math.round(f.hop), base: Math.round(0.4 * f.from.target.distanceTo(f.to.target)), seconds: +f.seconds.toFixed(2) };
    window.__run(400, { label, untilLanded: true, after: 20, sheet });
    return out;
  }, { k, label, sheet });
  if (process.env.GLIDES) console.log(label, JSON.stringify(info));
  at = k;
};
const run = (n, label) => page.evaluate(({ n, label }) => window.__run(n, { label }), { n, label });
const drag = async (x0, y0, dx, dy, frames, label, button = 'left') => {
  await page.mouse.move(x0, y0);
  await page.mouse.down({ button });
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(x0 + (dx * i) / frames, y0 + (dy * i) / frames);
    await run(1, label);
  }
  await page.mouse.up({ button });
  await run(30, label);
};
const zoom = async (x, y, steps, dir, label) => {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dir * 100);
    await run(2, label);
  }
  await run(30, label);
};

// ONLY=presets,closeups,turntables picks sections; ONLY=mount runs only the glides under the mount.
const only = (process.env.ONLY ?? 'presets,closeups,turntables').split(',');
// Every glide into and out of the Engines preset, whose camera is under the mount's ring table.
if (only.includes('mount')) {
  for (const k of [3, 4, 5, 6, 7, 8, 9, 1]) {
    await glide(2);
    await glide(k);
  }
}
// Every preset in order, then transitions in and out of the engine bay and to the farm.
if (only.includes('presets')) {
  for (const k of [2, 3, 4, 5, 6, 7, 8, 9, 1]) await glide(k);
  await glide(2);
  await glide(9, ['engines-farm', 7]);
  await glide(3);
  await glide(9, ['fins-farm', 7]);
  await glide(8, ['farm-tower', 7]);
  await glide(2, ['tower-engines', 7]);
  await glide(5);
  await glide(2);
  await glide(7);
  await glide(4);
  await glide(6);
  await glide(1);
}

// Close-ups: zoom into the engines and orbit under the mount; zoom onto the ship's tiles, orbit and pan; zoom
// onto the tower lattice and orbit there. The glides out of each start from the pose the close-up left.
if (only.includes('closeups')) {
  await glide(2);
  await zoom(W / 2, H * 0.42, 14, -1, 'zoom engines');
  await drag(W * 0.35, H * 0.5, W * 0.3, 0, 60, 'orbit engines');
  await drag(W * 0.5, H * 0.5, 0, -H * 0.15, 30, 'tilt engines');
  await zoom(W / 2, H / 2, 14, 1, 'unzoom engines');
  await glide(5, ['enginespose-nose', 9]);
  await zoom(W * 0.45, H * 0.55, 18, -1, 'zoom tiles');
  await drag(W * 0.3, H * 0.5, W * 0.4, 0, 60, 'orbit tiles');
  await drag(W * 0.5, H * 0.5, -W * 0.2, H * 0.1, 40, 'pan tiles', 'right');
  await zoom(W / 2, H / 2, 12, 1, 'unzoom tiles');
  await glide(8, ['nosepose-tower', 7]);
  const girder = await page.evaluate(({ x, y }) => window.__onTower(x, y), { x: W * 0.42, y: H * 0.6 });
  console.log('lattice zoom aims at', JSON.stringify(girder));
  await zoom(girder.x, girder.y, 16, -1, 'zoom lattice');
  await drag(W * 0.3, H * 0.5, W * 0.4, 0, 60, 'orbit lattice');
  await zoom(W / 2, H / 2, 16, 1, 'unzoom lattice');
}

// Turntable stretches (the idle timer is pushed past IDLE_S).
for (const k of only.includes('turntables') ? [1, 3, 5] : []) {
  await glide(k);
  await page.evaluate(() => (window.__explore.idle = 9));
  await run(480, `turntable ${names[k - 1]}`);
}

const caught = await page.evaluate(() => {
  const rows = window.__caught;
  if (!rows.length) return { url: null, rows: [] };
  const big = Object.assign(document.createElement('canvas'), { width: 3 * 320, height: rows.length * 180 });
  const tmp = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
  const g = big.getContext('2d');
  rows.forEach((r, j) => r.px.forEach((px, i) => {
    tmp.getContext('2d').putImageData(new ImageData(px, 640, 360), 0, 0);
    g.drawImage(tmp, i * 320, j * 180, 320, 180);
  }));
  return { url: big.toDataURL('image/jpeg', 0.85), rows: rows.map(({ px, ...r }) => r) };
});
if (caught.url) writeFileSync(`${D}/explore-spikes-${tag}.jpg`, Buffer.from(caught.url.split(',')[1], 'base64'));
console.log('caught spikes (rows of explore-spikes):');
caught.rows.forEach((r, j) => console.log(j, JSON.stringify(r)));
const frames = await page.evaluate(() => window.__frames);
const sheets = await page.evaluate(() => Object.fromEntries(Object.entries(window.__sheets).map(([k, s]) => [k, s.canvas.toDataURL('image/jpeg', 0.85)])));
for (const [k, url] of Object.entries(sheets)) writeFileSync(`${D}/explore-sheet-${k}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
if (process.env.FADE) console.log('largest sweep rate per segment:', JSON.stringify(await page.evaluate(() => window.__fade)));
if (dumpDir) {
  const dumps = await page.evaluate(() => window.__dumps);
  for (const d of dumps) writeFileSync(`${dumpDir}/${tag}-f${d.f}.jpg`, Buffer.from(d.url.split(',')[1], 'base64'));
  writeFileSync(`${dumpDir}/${tag}-index.json`, JSON.stringify(dumps.map(({ url, ...d }) => d)));
  console.log(`dumped ${dumps.length} flagged frames to ${dumpDir}`);
}
await browser.close();

const T = 0.06;
const events = [];
for (let k = 1; k < frames.length - 1; k++) {
  const a = frames[k - 1].lum, b = frames[k].lum, c = frames[k + 1].lum;
  const cells = [];
  for (let i = 0; i < b.length; i++) {
    const d1 = b[i] - a[i], d2 = c[i] - b[i];
    if (Math.abs(d1) > T && Math.abs(d2) > T && Math.sign(d1) !== Math.sign(d2) && Math.abs(c[i] - a[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2)))
      cells.push({ x: i % 16, y: Math.floor(i / 16), amp: +Math.min(Math.abs(d1), Math.abs(d2)).toFixed(3), abc: [a[i], b[i], c[i]] });
  }
  if (cells.length) events.push({ f: k, label: frames[k].label, n: cells.length, amp: Math.max(...cells.map((x) => x.amp)), cell: cells.sort((p, q) => q.amp - p.amp)[0] });
}
const byLabel = {};
for (const f of frames) byLabel[f.label] = (byLabel[f.label] ?? 0) + 1;
console.log(JSON.stringify({ quality, size: `${W}x${H}`, frames: frames.length, segments: Object.keys(byLabel).length, spikeFrames: events.length, top: events.sort((p, q) => q.amp - p.amp).slice(0, 15) }));
writeFileSync(`${D}/explore-flash-${tag}.json`, JSON.stringify({ frames: frames.length, byLabel, events }));
