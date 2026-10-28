// Renders the demo frame by frame from `from` up to `frame`, then renders that frame with bloom off and probes
// the raw HDR scene target around a pixel: reads the RenderPass output (half-float) and hides groups to find the source.
// Usage: node ship-flash-probe.mjs <base> <w> <h> <from> <frame> <px> <py>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, from, frame, px, py] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
await page.evaluate(
  ({ from, frame }) => {
    let r = window.__advance(from - window.__demoFrame, true);
    while (r.frame < frame) r = window.__advance(1, true);
  },
  { from: Number(from), frame: Number(frame) },
);
const res = await page.evaluate(
  ({ px, py }) => {
    const v = window.__view;
    const r = v.renderer;
    const rp = v.composer.passes[0];
    const read = () => {
      // Render only the scene pass into a half-float target and read a 9x9 block (y flipped).
      const rt = v.composer.readBuffer;
      v.composer.passes.forEach((p, i) => (p.enabled = i === 0));
      v.composer.render();
      v.composer.passes.forEach((p, i) => (p.enabled = true));
      v.aa.enabled = false;
      const W = rt.width;
      const H = rt.height;
      const sx = Math.round((px / window.innerWidth) * W) - 10;
      const sy = H - Math.round((py / window.innerHeight) * H) - 10;
      const buf = new Uint16Array(21 * 21 * 4);
      r.readRenderTargetPixels(v.composer.readBuffer, sx, sy, 21, 21, buf);
      const half = (u) => {
        const s = u & 0x8000 ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
        if (e === 31) return f ? NaN : s * Infinity;
        return e ? s * Math.pow(2, e - 15) * (1 + f / 1024) : s * Math.pow(2, -14) * (f / 1024);
      };
      let maxR = 0, maxG = 0, nan = 0, inf = 0;
      for (let i = 0; i < 441; i++) {
        const R = half(buf[i * 4]), G = half(buf[i * 4 + 1]);
        if (Number.isNaN(R) || Number.isNaN(G)) nan++;
        else if (!Number.isFinite(R) || !Number.isFinite(G)) inf++;
        else { maxR = Math.max(maxR, R); maxG = Math.max(maxG, G); }
      }
      return { maxR: +maxR.toFixed(2), maxG: +maxG.toFixed(2), nan, inf };
    };
    const out = { all: read() };
    const groups = {
      boosters: v.pool.filter((s) => (s.kind ?? 'booster') === 'booster').map((s) => s.root),
      ships: v.pool.filter((s) => s.kind === 'ship').map((s) => s.root),
      towers: v.towers.map((t) => t.root),
    };
    for (const [name, roots] of Object.entries(groups)) {
      const vis = roots.map((o) => o.visible);
      roots.forEach((o) => (o.visible = false));
      out[`no_${name}`] = read();
      roots.forEach((o, i) => (o.visible = vis[i]));
    }
    // Per role inside the visible booster.
    const slot = v.pool.find((s) => (s.kind ?? 'booster') === 'booster' && s.root.visible);
    const roles = new Set();
    slot.root.traverse((o) => o.isMesh && roles.add(o.userData.role));
    for (const role of roles) {
      const hidden = [];
      slot.root.traverse((o) => { if (o.isMesh && o.userData.role === role && o.visible) { o.visible = false; hidden.push(o); } });
      out[`booster_no_${role}`] = read();
      hidden.forEach((o) => (o.visible = true));
    }
    return out;
  },
  { px: Number(px), py: Number(py) },
);
console.log(JSON.stringify(res, null, 0));
await browser.close();
