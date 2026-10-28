// The catch demo's side of flight-orbit-hot.mjs: raw HDR peaks around a frame of ?demo=1&capture=1, the mesh under
// the hottest pixel, and the meshes whose removal kills it.
// Usage: node flight-orbit-hotdemo.mjs <base-url> <frame>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, frame] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
const out = await page.evaluate(async (target) => {
  const v = window.__view;
  const { renderer, scene, camera } = v;
  const THREE = await import(performance.getEntriesByType('resource').find((e) => e.name.includes('/.vite/deps/three.js')).name);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, samples: 4 });
  const px = new Float32Array(size.x * size.y * 4);
  const hot = () => {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.readRenderTargetPixels(rt, 0, 0, size.x, size.y, px);
    let best = { l: 0, x: 0, y: 0 };
    for (let i = 0; i < size.x * size.y; i++) {
      const l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
      if (l > best.l) best = { l: +l.toFixed(1), x: i % size.x, y: size.y - 1 - Math.floor(i / size.x) };
    }
    return best;
  };
  const res = [];
  let n = 0;
  while (n < target - 2) {
    window.__advance(1, true);
    n++;
  }
  for (let k = 0; k < 3; k++) {
    window.__advance(1, true);
    n++;
    const h = hot();
    const row = { f: n, ...h };
    if (k === 1) {
      const meshes = [];
      scene.traverse((o) => o.isMesh && o.visible && meshes.push(o));
      row.culprits = [];
      for (const o of meshes) {
        o.visible = false;
        const p = hot();
        o.visible = true;
        if (p.l < h.l * 0.5) row.culprits.push(`${o.parent?.name}/${o.name} ${o.material.type} r${o.material.roughness} -> ${p.l}`);
      }
    }
    res.push(row);
  }
  rt.dispose();
  return res;
}, Number(frame));
for (const r of out) console.log(JSON.stringify(r));
await browser.close();
