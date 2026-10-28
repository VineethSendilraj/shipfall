// How bright the raw HDR scene gets over the scripted mission: renders every frame and, every <every> frames,
// re-renders the scene into a float target and records the peak luminance and the share of bloom energy
// (luminance above 1) that a cap at each level would remove.
// Usage: node flight-orbit-hdr.mjs <base-url> <every> <out.json>
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, every, outPath] = process.argv.slice(2);
const CAPS = [16, 32, 64, 128, 256];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
await page.evaluate(async (caps) => {
  const v = window.__view;
  const { renderer, scene, camera } = v;
  const THREE = await import(performance.getEntriesByType('resource').find((e) => e.name.includes('/.vite/deps/three.js')).name);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, samples: 4 });
  const px = new Float32Array(size.x * size.y * 4);
  window.__hdr = () => {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.readRenderTargetPixels(rt, 0, 0, size.x, size.y, px);
    let max = 0;
    let at = 0;
    let e1 = 0;
    const cut = caps.map(() => 0);
    for (let i = 0; i < size.x * size.y; i++) {
      const l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
      if (!(l > 1)) continue;
      e1 += l - 1;
      if (l > max) [max, at] = [l, i];
      for (let k = 0; k < caps.length; k++) if (l > caps[k]) cut[k] += l - caps[k];
    }
    return { max: +max.toFixed(1), x: at % size.x, y: size.y - 1 - Math.floor(at / size.x), e1: Math.round(e1), cut: cut.map((c) => +(e1 ? c / e1 : 0).toFixed(4)) };
  };
}, CAPS);
const rows = [];
for (;;) {
  const r = await page.evaluate((every) => {
    const f = window.__flight;
    let done = false;
    for (let i = 0; i < every && !done; i++) done = window.__advance(1, true).done;
    return { f: f.frame, mode: f.ship.mode, booster: f.booster.state, done, ...window.__hdr() };
  }, Number(every));
  rows.push(r);
  if (r.done) break;
}
writeFileSync(outPath, JSON.stringify({ caps: CAPS, rows }));
const sorted = rows.slice().sort((a, b) => b.max - a.max);
console.log('frames sampled', rows.length, 'last', rows.at(-1).f);
console.log('top peaks:');
for (const r of sorted.slice(0, 15)) console.log(JSON.stringify(r));
for (let k = 0; k < CAPS.length; k++) {
  const shares = rows.map((r) => r.cut[k]).sort((a, b) => a - b);
  const worst = rows.reduce((a, b) => (b.cut[k] > a.cut[k] ? b : a));
  console.log(`cap ${CAPS[k]}: frames touched ${rows.filter((r) => r.max > CAPS[k]).length}, energy cut p50 ${shares[Math.floor(shares.length / 2)]} p99 ${shares[Math.floor(shares.length * 0.99)]} max ${worst.cut[k]} (frame ${worst.f}, ${worst.mode}, peak ${worst.max})`);
}
await browser.close();
