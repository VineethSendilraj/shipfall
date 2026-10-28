// Which frames would a steel cap touch at all? Steps the capture one frame at a time; after each frame it re-renders
// with the polished steel (metalness 1, roughness <= 0.2) swapped for each patched copy and counts full-size pixels
// that differ from a re-render with an unpatched copy ('noop'). The copies have new material ids, which changes the
// opaque draw order, so the frame as drawn is not a fair reference. 'noop2' repeats the unpatched re-render to show
// re-renders are deterministic. Prints only frames where something changed.
// Usage: node flight-orbit-glint-sweep.mjs <base-url> <demo|flight> [caps, e.g. 128,256,512] [out.json] [all|double]
// 'double' swaps only double-sided steel (free flight's satellite door).
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, mode, list = '128,256,512', out = '', only = 'all'] = process.argv.slice(2);
const caps = list.split(',').map(Number);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text().slice(0, 400)));
await page.goto(`${base}/?${mode}=1&capture=1`, { timeout: 600000 });
await page.waitForFunction((m) => window[m === 'demo' ? '__demoReady' : '__flightReady'] === true, mode, { timeout: 600000 });

await page.evaluate(([caps, only]) => {
  const { scene } = window.__view;
  const isSteel = (m) => m && m.isMeshStandardMaterial && m.metalness === 1 && m.roughness <= 0.2 && (only === 'all' || m.side === 2);
  const patches = { noop: '' };
  for (const c of caps) patches[`cap${c}`] = `if ( dot( geometryNormal, geometryViewDir ) < 0.0 ) outgoingLight = min( outgoingLight, vec3( ${c.toFixed(1)} ) );\n`;
  const copies = new Map();
  const copyOf = (m, key) => {
    const k = `${m.uuid}|${key}`;
    let c = copies.get(k);
    if (!c) {
      c = m.clone();
      c.onBeforeCompile = (s) => {
        s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `${patches[key]}#include <opaque_fragment>`);
      };
      c.customProgramCacheKey = () => `sweep-${key}`;
      copies.set(k, c);
    }
    return c.copy(m);
  };
  const full = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 }).getContext('2d', { willReadFrequently: true });
  const gl = document.getElementById('gl');
  const grab = () => {
    full.drawImage(gl, 0, 0, 1280, 720);
    return full.getImageData(0, 0, 1280, 720).data;
  };
  const diff = (p, q) => {
    let n = 0, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
      if (d) n++;
      if (d > max) max = d;
    }
    return { px: n, max };
  };
  const shot = (key) => {
    const done = [];
    scene.traverse((o) => {
      if (!isSteel(o.material)) return;
      done.push([o, o.material]);
      o.material = copyOf(o.material, key);
    });
    window.__advance(0, true);
    const px = grab();
    for (const [o, m] of done) o.material = m;
    return px;
  };
  window.__sweep = (n) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const s = window.__advance(1, true);
      const ref = shot('noop');
      const row = { f: s.frame };
      for (const key of Object.keys(patches)) {
        const d = diff(ref, shot(key));
        if (d.px) row[key === 'noop' ? 'noop2' : key] = d;
      }
      if (Object.keys(row).length > 1) rows.push(row);
      if (s.done) return { rows, done: true, last: s.frame };
    }
    return { rows, done: false };
  };
}, [caps, only]);

const rows = [];
let last = 0;
for (;;) {
  const chunk = await page.evaluate(() => window.__sweep(60));
  rows.push(...chunk.rows);
  for (const r of chunk.rows) console.log(JSON.stringify(r));
  if (chunk.done) {
    last = chunk.last;
    break;
  }
}
await browser.close();
const summary = { frames: last };
for (const key of ['noop2', ...caps.map((c) => `cap${c}`)]) {
  const hit = rows.filter((r) => r[key]);
  summary[key] = { frames: hit.length, maxPx: Math.max(0, ...hit.map((r) => r[key].px)), maxDiff: Math.max(0, ...hit.map((r) => r[key].max)) };
}
console.log('summary', JSON.stringify(summary));
if (out) writeFileSync(out, JSON.stringify({ summary, rows }));
