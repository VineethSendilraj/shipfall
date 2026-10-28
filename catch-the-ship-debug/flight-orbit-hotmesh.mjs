// Which mesh makes a one-pixel HDR firefly: at the frame, hides each mesh in turn and re-renders the raw HDR scene,
// reporting the meshes whose removal kills the hot pixel, plus the stack's materials.
// Usage: node flight-orbit-hotmesh.mjs <base-url> <frame> <x> <y> (drawing-buffer pixel, top-left origin)
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, frame, x, y] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
const out = await page.evaluate(async ([target, x, y]) => {
  const v = window.__view;
  const { renderer, scene, camera } = v;
  const THREE = await import(performance.getEntriesByType('resource').find((e) => e.name.includes('/.vite/deps/three.js')).name);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, samples: 4 });
  const buf = new Float32Array(9 * 9 * 4);
  const peak = () => {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.readRenderTargetPixels(rt, x - 4, size.y - 1 - y - 4, 9, 9, buf);
    let m = 0;
    for (let i = 0; i < 81; i++) m = Math.max(m, 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]);
    return +m.toFixed(1);
  };
  const f = window.__flight;
  while (f.frame < target) window.__advance(1, true);
  const res = { frame: f.frame, control: peak(), culprits: [], mats: [] };
  const meshes = [];
  scene.traverse((o) => o.isMesh && o.visible && meshes.push(o));
  for (const o of meshes) {
    o.visible = false;
    const p = peak();
    o.visible = true;
    if (p < res.control * 0.5) {
      const m = o.material;
      res.culprits.push({
        mesh: o.name,
        parent: o.parent?.name,
        type: m.type,
        mat: m.name,
        rough: m.roughness,
        metal: m.metalness,
        clearcoat: m.clearcoat,
        clearcoatRough: m.clearcoatRoughness,
        maps: Object.keys(m).filter((k) => /Map$|^map$/.test(k) && m[k]).join(','),
        flat: m.flatShading,
        peakWithout: p,
      });
    }
  }
  const seen = new Set();
  for (const root of [v.pool[2].root, v.pool[0].root]) {
    root.traverse((o) => {
      if (!o.isMesh || seen.has(o.material)) return;
      seen.add(o.material);
      const m = o.material;
      res.mats.push(`${root === v.pool[2].root ? 'ship' : 'booster'} ${o.name} ${m.type} r${m.roughness} m${m.metalness}${m.clearcoat ? ` cc${m.clearcoat}/${m.clearcoatRoughness}` : ''}${m.roughnessMap ? ' rMap' : ''}${m.normalMap ? ' nMap' : ''} env${m.envMapIntensity}`);
    });
  }
  rt.dispose();
  return res;
}, [Number(frame), Number(x), Number(y)]);
console.log(JSON.stringify(out, null, 1));
await browser.close();
