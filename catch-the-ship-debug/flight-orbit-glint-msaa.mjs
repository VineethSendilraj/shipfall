// Is a steel glint an MSAA shading artifact? At one frame: the steel's hottest pixel rendered steel-only with 4x MSAA
// and without MSAA, plus the first-hit meshes of a 16x16 ray grid through the given pixel.
// Usage: node flight-orbit-glint-msaa.mjs <base-url> <demo|flight> <frame> <x> <y>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, mode, frame, x, y] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?${mode}=1&capture=1`, { timeout: 600000 });
await page.waitForFunction((m) => window[m === 'demo' ? '__demoReady' : '__flightReady'] === true, mode, { timeout: 600000 });
const out = await page.evaluate(
  async ([target, px, py]) => {
    const THREE = await import(performance.getEntriesByType('resource').find((e) => /\/deps\/three\.js(\?|$)/.test(e.name)).name);
    const v = window.__view;
    const { renderer, scene, camera } = v;
    let s = { frame: 0 };
    while (s.frame < target) s = window.__advance(1, true);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const isSteel = (m) => m && m.isMeshStandardMaterial && m.metalness === 1 && m.roughness <= 0.2;
    const steelOnly = (samples) => {
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, samples });
      const muted = new Map();
      const fog = new Map();
      scene.traverse((o) => {
        if (!o.material) return;
        for (const m of [o.material].flat()) {
          if (isSteel(m)) fog.has(m) || fog.set(m, m.fog);
          else muted.has(m) || muted.set(m, m.colorWrite);
        }
      });
      for (const m of muted.keys()) m.colorWrite = false;
      for (const m of fog.keys()) m.fog = false;
      const bg = scene.background;
      scene.background = null;
      const auto = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.shadowMap.autoUpdate = auto;
      scene.background = bg;
      for (const [m, w] of muted) m.colorWrite = w;
      for (const [m, f] of fog) m.fog = f;
      const buf = new Float32Array(size.x * size.y * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, size.x, size.y, buf);
      rt.dispose();
      let best = 0, at = 0;
      for (let i = 0; i < size.x * size.y; i++) {
        const l = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
        if (l > best) { best = l; at = i; }
      }
      const row = size.y - 1 - py;
      const o = (row * size.x + px) * 4;
      return { hottest: +best.toFixed(1), at: [at % size.x, size.y - 1 - Math.floor(at / size.x)], atPixel: +(0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2]).toFixed(1) };
    };
    const ray = new THREE.Raycaster();
    const hits = {};
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      ray.setFromCamera(new THREE.Vector2(((px + (i + 0.5) / 16) / size.x) * 2 - 1, -((py + (j + 0.5) / 16) / size.y) * 2 + 1), camera);
      const h = ray.intersectObjects(scene.children, true).find((q) => q.object.isMesh && q.object.visible && q.object.material.colorWrite !== false);
      const k = h ? `${h.object.parent?.name}/${h.object.name}${isSteel(h.object.material) ? ' (steel)' : ''}` : 'none';
      hits[k] = (hits[k] ?? 0) + 1;
    }
    return { frame: s.frame, msaa4: steelOnly(4), noMsaa: steelOnly(0), rayGrid16: hits };
  },
  [Number(frame), Number(x), Number(y)],
);
console.log(JSON.stringify(out));
await browser.close();
