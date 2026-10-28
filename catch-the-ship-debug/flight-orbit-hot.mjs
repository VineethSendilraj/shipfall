// Where a glint comes from: renders the raw HDR scene (no post) for frames around a spike, reports the brightest
// pixels, the mesh and material under the hottest one, and the same frame with the moon's shadow off.
// Usage: node flight-orbit-hot.mjs <base-url> <frame> [span]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, frame, span = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
const out = await page.evaluate(async ([target, span]) => {
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
    const top = [];
    let nan = 0;
    for (let i = 0; i < size.x * size.y; i++) {
      const l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
      if (!Number.isFinite(l)) nan++;
      else if (l > 2 && (top.length < 6 || l > top[top.length - 1].l)) {
        top.push({ l: +l.toFixed(1), x: i % size.x, y: size.y - 1 - Math.floor(i / size.x) });
        top.sort((a, b) => b.l - a.l);
        top.length = Math.min(top.length, 6);
      }
    }
    let over = 0;
    for (let i = 0; i < size.x * size.y; i++) if (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2] > 50) over++;
    return { top, nan, over50: over };
  };
  const pick = (p) => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((p.x / size.x) * 2 - 1, -(p.y / size.y) * 2 + 1), camera);
    const hit = ray.intersectObjects(v.pool[2].root.children.concat(v.pool[0].root.children), true)[0];
    if (!hit) return null;
    const m = hit.object.material;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const moon = v.world.moon;
    const l = moon.position.clone().sub(moon.target.position).normalize();
    const e = camera.position.clone().sub(hit.point).normalize();
    return {
      mesh: hit.object.name,
      parent: hit.object.parent?.name,
      mat: m.name,
      rough: m.roughness,
      metal: m.metalness,
      maps: Object.keys(m).filter((k) => /Map$|^map$/.test(k) && m[k]).join(','),
      NdotL: +n.dot(l).toFixed(3),
      NdotV: +n.dot(e).toFixed(3),
      NdotH: +n.dot(l.clone().add(e).normalize()).toFixed(5),
    };
  };
  const f = window.__flight;
  while (f.frame < target - span - 1) window.__advance(1, true);
  const res = [];
  while (f.frame < target + span) {
    window.__advance(1, true);
    const h = hot();
    res.push({ f: f.frame, ...h, pick: h.top[0] ? pick(h.top[0]) : null });
    if (f.frame === target) {
      const sh = v.world.moon.shadow;
      sh.intensity = 0;
      res.push({ f: `${f.frame} no shadow`, ...hot() });
      sh.intensity = 1;
    }
  }
  rt.dispose();
  return res;
}, [Number(frame), Number(span)]);
for (const r of out) console.log(JSON.stringify(r));
await browser.close();
