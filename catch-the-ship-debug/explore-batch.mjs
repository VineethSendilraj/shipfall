// Fast motion scan for explore glides: frame-steps every preset-to-preset glide and every glide from a user pose
// (as in explore-clear.mjs) with rendering stubbed, and reports per glide the largest camera step per frame, the
// largest jerk (change of the step vector between frames), the largest clamp push, the closest approach to the
// keep-out shapes after the clamp, and the route time. Clearance to triangles is explore-clear.mjs's job.
// Usage: node explore-batch.mjs <base-url> [worst-n]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const worstN = Number(process.argv[3] ?? 20);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(500);
const rows = await page.evaluate(() => {
  const e = window.__explore;
  const cam = e.view.camera.position;
  const key = (n) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(n), code: `Digit${n}`, bubbles: true }));
  const render = e.view.render;
  const clamp = e.clamp;
  let corr = 0;
  e.view.render = () => {};
  e.clamp = function () {
    const before = cam.clone();
    clamp.call(this);
    before.y = Math.max(1.5, before.y);
    corr = before.distanceTo(cam);
  };
  const settle = (n = 900) => {
    for (let k = 0; k < n && (k === 0 || e.flight); k++) e.frame(1 / 60);
  };
  const glide = (label, j) => {
    key(j);
    const ms = e.lastMs;
    // The same glide with no bend and no clamp, for the jerk a long curved glide has anyway.
    const f = e.flight;
    const base = [cam.clone()];
    for (let k = 1, t = 0; t < 1; k++) {
      t = Math.min(1, (k / 60) / f.seconds);
      base.push(e.glideAt(f, t * t * (3 - 2 * t), cam.clone(), cam.clone()));
    }
    let natural = 0;
    for (let k = 1; k + 1 < base.length; k++) natural = Math.max(natural, base[k + 1].clone().sub(base[k]).sub(base[k].clone().sub(base[k - 1])).length());
    const path = [cam.clone()];
    let push = 0;
    let near = Infinity;
    for (let k = 0; k < 900 && e.flight; k++) {
      e.frame(1 / 60);
      path.push(cam.clone());
      push = Math.max(push, corr);
      near = Math.min(near, e.toModel(cam));
    }
    let step = 0;
    let jerk = 0;
    let jerkAt = 0;
    for (let k = 1; k < path.length; k++) {
      step = Math.max(step, path[k].distanceTo(path[k - 1]));
      if (k + 1 < path.length) {
        const a = path[k + 1].clone().sub(path[k]).sub(path[k].clone().sub(path[k - 1])).length();
        if (a > jerk) [jerk, jerkAt] = [a, k / path.length];
      }
    }
    const bend = Math.max(...e.lastBend.map((v) => v.length()));
    return { label, line: e.lastLine, long: e.lastLong, ...e.lastBases, frames: path.length - 1, step: +step.toFixed(2), jerk: +jerk.toFixed(3), natural: +natural.toFixed(3), extra: +(jerk - natural).toFixed(3), jerkAt: +jerkAt.toFixed(2), push: +push.toFixed(2), near: +near.toFixed(2), bend: +bend.toFixed(2), ms: +ms.toFixed(1) };
  };
  // Keeps the last route's bend after the flight ends.
  const route = e.route;
  e.route = function (f) {
    const t0 = performance.now();
    const turn0 = f.turn;
    route.call(this, f);
    e.lastLong = f.turn !== turn0;
    e.lastMs = performance.now() - t0;
    e.lastBend = f.bend;
    e.lastLine = !!f.line;
    const most = (b) => +Math.max(...b.map((v) => v.length())).toFixed(2);
    e.lastBases = { curve: most(this.bendAround({ ...f, line: false })), straight: most(this.bendAround({ ...f, line: true })), hop: +f.hop.toFixed(1) };
  };
  const names = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
  const out = [];
  for (let i = 1; i <= 9; i++) {
    for (let j = 1; j <= 9; j++) {
      if (i === j) continue;
      key(i);
      settle();
      out.push(glide(`${i}>${j} ${names[i - 1]} -> ${names[j - 1]}`, j));
    }
  }
  const POSES = [[80, 1], [-80, 1], [160, 1], [0, 0.5], [0, 2]];
  for (let i = 1; i <= 9; i++) {
    for (const [dTheta, scale] of POSES) {
      for (let j = 1; j <= 9; j++) {
        if (i === j) continue;
        key(i);
        settle();
        const t = e.controls.target;
        const o = cam.clone().sub(t);
        const rad = o.length();
        const theta = Math.atan2(o.x, o.z) + (dTheta * Math.PI) / 180;
        const phi = Math.acos(o.y / rad);
        cam.set(t.x + rad * scale * Math.sin(phi) * Math.sin(theta), t.y + rad * scale * Math.cos(phi), t.z + rad * scale * Math.sin(phi) * Math.cos(theta));
        settle(1);
        out.push(glide(`${i}:${dTheta},${scale}>${j} free ${names[i - 1]}(${dTheta},${scale}) -> ${names[j - 1]}`, j));
      }
    }
  }
  e.view.render = render;
  e.clamp = clamp;
  e.route = route;
  return out;
});
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const col = (k) => rows.map((r) => r[k]);
console.log(`${rows.length} glides, ${rows.filter((r) => r.bend > 0.01).length} bent, ${rows.filter((r) => r.line).length} on a line, ${rows.filter((r) => r.long).length} the long way round`);
for (const k of ['step', 'jerk', 'natural', 'extra', 'push', 'bend', 'ms']) console.log(`${k}: p50 ${q(col(k), 0.5)} p95 ${q(col(k), 0.95)} max ${q(col(k), 1)}`);
console.log(`closest to the shapes after the clamp: ${Math.min(...col('near'))} m`);
console.log(`extra jerk over 0.3: ${rows.filter((r) => r.extra > 0.3).length}; push over 0.3: ${rows.filter((r) => r.push > 0.3).length}`);
console.log(`worst ${worstN} by extra jerk:`);
for (const r of [...rows].sort((a, b) => b.extra - a.extra).slice(0, worstN)) console.log(`  ${JSON.stringify(r)}`);
console.log(`worst ${worstN} by natural jerk:`);
for (const r of [...rows].sort((a, b) => b.natural - a.natural).slice(0, worstN)) console.log(`  ${JSON.stringify(r)}`);
console.log(`worst ${worstN} by push:`);
for (const r of [...rows].sort((a, b) => b.push - a.push).slice(0, worstN)) console.log(`  ${JSON.stringify(r)}`);
if (process.env.LINES) {
  console.log('glides on a line (curve and straight: the largest bend each base needs; hop: the curve\'s bow):');
  for (const r of rows.filter((r) => r.line)) console.log(`  ${r.label}: curve ${r.curve}, straight ${r.straight}, hop ${r.hop}`);
}
console.log('BATCH_DONE');
await browser.close();
