// Headless real-GPU flicker scan: samples the game canvas right after every render (16x9 grid of luma
// cells) and flags cells that jump and come straight back on the next frame. Also logs canvas resizes,
// window resize events and page reloads. Usage: node flicker.mjs <url> [seconds] [w] [h] [dpr]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url, secs = '45', w = '1280', h = '720', dpr = '2'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(dpr) });
let navs = 0;
page.on('framenavigated', (f) => f === page.mainFrame() && navs++);
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const GW = 16, GH = 9;
  const log = (window.__flick = { resizes: [], winResizes: 0, frames: [] });
  for (const prop of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
    Object.defineProperty(HTMLCanvasElement.prototype, prop, {
      get() { return d.get.call(this); },
      set(v) {
        const old = d.get.call(this);
        if (this.id === 'gl' && old !== v) log.resizes.push({ t: Math.round(performance.now()), prop, old, v });
        d.set.call(this, v);
      },
    });
  }
  addEventListener('resize', () => log.winResizes++);
  const small = document.createElement('canvas');
  small.width = GW; small.height = GH;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  let pendingT = -1, pending = null;
  const sample = (t) => {
    const gl = document.getElementById('gl');
    if (!gl || !gl.width) return;
    ctx.drawImage(gl, 0, 0, GW, GH);
    const px = ctx.getImageData(0, 0, GW, GH).data;
    const lum = new Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    if (t !== pendingT && pending) log.frames.push(pending);
    pendingT = t;
    pending = { t: Math.round(t), lum };
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { cb(t); sample(t); });
});
await page.goto(url);
await page.waitForTimeout(Number(secs) * 1000);
const res = await page.evaluate(() => {
  const { frames, resizes, winResizes } = window.__flick;
  const T = 0.06;
  const spikes = [];
  let worst = 0;
  for (let k = 1; k < frames.length - 1; k++) {
    const a = frames[k - 1].lum, b = frames[k].lum, c = frames[k + 1].lum;
    let n = 0, mx = 0;
    for (let i = 0; i < b.length; i++) {
      const d1 = b[i] - a[i], d2 = c[i] - b[i];
      if (Math.abs(d1) > T && Math.abs(d2) > T && Math.sign(d1) !== Math.sign(d2) && Math.abs(c[i] - a[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2))) {
        n++;
        mx = Math.max(mx, Math.min(Math.abs(d1), Math.abs(d2)));
      }
    }
    worst = Math.max(worst, mx);
    if (n) spikes.push({ t: frames[k].t, cells: n, amp: +mx.toFixed(3) });
  }
  const mean = frames.map((f) => f.lum.reduce((s, x) => s + x, 0) / f.lum.length);
  const dts = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((x, y) => x - y);
  return {
    frames: frames.length,
    frameMs: { p50: dts[Math.floor(dts.length / 2)], p99: dts[Math.floor(dts.length * 0.99)] },
    canvasResizes: resizes,
    winResizes,
    spikeFrames: spikes.length,
    worstAmp: +worst.toFixed(3),
    spikes: spikes.slice(0, 12),
    meanLuma: { min: +Math.min(...mean).toFixed(3), max: +Math.max(...mean).toFixed(3) },
  };
});
console.log(url, `${w}x${h}@${dpr}`, `navigations=${navs}`, JSON.stringify(res));
await browser.close();
