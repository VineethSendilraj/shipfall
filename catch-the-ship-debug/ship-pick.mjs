// Frame-by-frame to `frame`, then an ID render: every mesh gets a unique flat color, the HDR scene target is read
// around a pixel, and the objects covering it are listed with their raw color in the normal render.
// Usage: node ship-pick.mjs <base> <w> <h> <from> <frame> <px> <py>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, from, frame, px, py] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
const res = await page.evaluate(
  ({ from, frame, px, py }) => {
    let r = window.__advance(from - window.__demoFrame, true);
    while (r.frame < frame) r = window.__advance(1, true);
    const v = window.__view;
    const renderer = v.renderer;
    const half = (u) => {
      const s = u & 0x8000 ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
      if (e === 31) return f ? NaN : s * Infinity;
      return e ? s * Math.pow(2, e - 15) * (1 + f / 1024) : s * Math.pow(2, -14) * (f / 1024);
    };
    const N = 15;
    const readBlock = () => {
      v.composer.passes.forEach((p, i) => (p.enabled = i === 0));
      v.composer.render();
      v.composer.passes.forEach((p) => (p.enabled = true));
      v.aa.enabled = false;
      const rt = v.composer.readBuffer;
      const sx = Math.round((px / window.innerWidth) * rt.width) - (N >> 1);
      const sy = rt.height - Math.round((py / window.innerHeight) * rt.height) - (N >> 1);
      const buf = new Uint16Array(N * N * 4);
      renderer.readRenderTargetPixels(rt, sx, sy, N, N, buf);
      return Array.from(buf, half);
    };
    const normal = readBlock();
    const Basic = v.guide.material.constructor;
    const objs = [];
    const saved = [];
    v.scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine)) return;
      saved.push([o, o.material, o.visible]);
      if (!o.isMesh || o.isInstancedMesh === undefined) {}
      if (o.isMesh) {
        const id = objs.length + 1;
        objs.push(o);
        o.material = new Basic({ color: ((id & 255) << 16) | (((id >> 8) & 255) << 8) | 0x40, toneMapped: false, side: 2 });
        o.material.color.setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, 0.25);
      } else o.visible = false;
    });
    const bg = v.scene.background;
    v.scene.background = null;
    const ids = readBlock();
    v.scene.background = bg;
    saved.forEach(([o, m, vis]) => { o.material = m; o.visible = vis; });
    const hits = new Map();
    let hottest = null;
    for (let i = 0; i < N * N; i++) {
      const R = normal[i * 4], G = normal[i * 4 + 1], B = normal[i * 4 + 2];
      const id = Math.round(ids[i * 4] * 255) + (Math.round(ids[i * 4 + 1] * 255) << 8);
      const o = objs[id - 1];
      const name = o ? `${o.name || o.type}|role=${o.userData.role ?? '-'}|parent=${o.parent?.name || o.parent?.type}|mat=${saved.find((s) => s[0] === o)[1].type}` : `none(${ids[i * 4].toFixed(3)},${ids[i * 4 + 1].toFixed(3)},${ids[i * 4 + 2].toFixed(3)})`;
      const e = hits.get(name) || { n: 0, maxR: 0 };
      e.n++;
      e.maxR = Math.max(e.maxR, R);
      hits.set(name, e);
      if (!hottest || R > hottest.R) hottest = { R, G, B, name };
    }
    return { hottest, hits: [...hits.entries()].sort((a, b) => b[1].maxR - a[1].maxR).slice(0, 8) };
  },
  { from: Number(from), frame: Number(frame), px: Number(px), py: Number(py) },
);
console.log(JSON.stringify(res, null, 1));
await browser.close();
