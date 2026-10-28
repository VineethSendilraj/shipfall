// Bend statistics for explore glides: for each preset-to-preset glide and each glide from a user pose (as in
// explore-clear.mjs), reads the route's bend array and reports how many glides are bent and by how much.
// Usage: node explore-bends.mjs <base-url>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(500);
const rows = await page.evaluate(() => {
  const e = window.__explore;
  const key = (n) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(n), code: `Digit${n}`, bubbles: true }));
  const settle = (n = 900) => {
    const render = e.view.render;
    e.view.render = () => {};
    for (let k = 0; k < n && (k === 0 || e.flight); k++) e.frame(1 / 60);
    e.view.render = render;
  };
  const names = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
  const stat = (label) => {
    const bend = e.flight.bend;
    const len = bend.map((v) => v.length());
    const max = Math.max(...len);
    const at = len.indexOf(max);
    const bent = len.filter((l) => l > 0.01).length;
    // Largest change of the bend between neighboring samples, against the glide's own step there.
    let slope = 0;
    for (let i = 1; i < bend.length; i++) {
      const step = e.glideAt(e.flight, i / (bend.length - 1), e.foot.clone(), e.foot.clone()).distanceTo(e.glideAt(e.flight, (i - 1) / (bend.length - 1), e.foot.clone(), e.foot.clone()));
      if (step > 1e-6) slope = Math.max(slope, bend[i].distanceTo(bend[i - 1]) / step);
    }
    const dir = bend[at].clone().normalize();
    return { label, max: +max.toFixed(2), at: +(at / (bend.length - 1)).toFixed(2), bent, slope: +slope.toFixed(2), dir: [dir.x, dir.y, dir.z].map((n) => Math.round(n)) };
  };
  const out = [];
  for (let i = 1; i <= 9; i++) {
    for (let j = 1; j <= 9; j++) {
      if (i === j) continue;
      key(i);
      settle();
      key(j);
      out.push(stat(`glide ${names[i - 1]} -> ${names[j - 1]}`));
      settle();
    }
  }
  const POSES = [[80, 1], [-80, 1], [160, 1], [0, 0.5], [0, 2]];
  for (let i = 1; i <= 9; i++) {
    for (const [dTheta, scale] of POSES) {
      for (let j = 1; j <= 9; j++) {
        if (i === j) continue;
        key(i);
        settle();
        const cam = e.view.camera.position;
        const t = e.controls.target;
        const o = cam.clone().sub(t);
        const rad = o.length();
        const theta = Math.atan2(o.x, o.z) + (dTheta * Math.PI) / 180;
        const phi = Math.acos(o.y / rad);
        cam.set(t.x + rad * scale * Math.sin(phi) * Math.sin(theta), t.y + rad * scale * Math.cos(phi), t.z + rad * scale * Math.sin(phi) * Math.cos(theta));
        settle(1);
        key(j);
        out.push(stat(`free ${names[i - 1]}(${dTheta},${scale}) -> ${names[j - 1]}`));
        settle();
      }
    }
  }
  return out;
});
const bent = rows.filter((r) => r.bent);
console.log(`${rows.length} glides, ${bent.length} bent`);
const maxes = bent.map((r) => r.max).sort((a, b) => a - b);
const q = (p) => maxes[Math.min(maxes.length - 1, Math.floor(p * maxes.length))];
if (maxes.length) console.log(`largest bend per bent glide (m): p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)}`);
const slopes = bent.map((r) => r.slope).sort((a, b) => a - b);
if (slopes.length) console.log(`bend slope against the glide step: p50 ${slopes[Math.floor(slopes.length / 2)]} max ${slopes.at(-1)}`);
for (const r of bent.sort((a, b) => b.max - a.max).slice(0, 40)) console.log(JSON.stringify(r));
await browser.close();
