// For given demo frames: every lit PointLight, its position, and the closest mesh vertex to it (world space).
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, list] = process.argv.slice(2);
const frames = list.split(',').map(Number).sort((a, b) => a - b);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
for (const f of frames) {
  const r = await page.evaluate((f) => {
    const cur = window.__demoFrame;
    if (f > cur) window.__advance(f - cur, true);
    const v = window.__view, scene = v.scene;
    scene.updateMatrixWorld(true);
    const lights = scene.children.map((o, i) => ({ o, i })).filter(({ o }) => o.isPointLight && o.intensity > 0);
    return lights.map(({ o, i }) => {
      const p = o.position;
      let best = { d: Infinity, name: '' };
      const tmp = p.clone(), m = o.matrixWorld.clone();
      scene.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.visible || !mesh.geometry?.attributes?.position) return;
        let vis = true;
        for (let a = mesh; a; a = a.parent) if (!a.visible) { vis = false; break; }
        if (!vis) return;
        const pos = mesh.geometry.attributes.position;
        const count = mesh.isInstancedMesh ? mesh.count : 1;
        for (let k = 0; k < count; k++) {
          const mw = mesh.matrixWorld.clone();
          if (mesh.isInstancedMesh) { mesh.getMatrixAt(k, m); mw.multiply(m); }
          const e = mw.elements;
          for (let j = 0; j < pos.count; j++) {
            const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
            const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
            const d = Math.hypot(wx - p.x, wy - p.y, wz - p.z);
            if (d < best.d) best = { d, name: `${mesh.name || mesh.type}${mesh.material?.name ? '/' + mesh.material.name : ''}` };
          }
        }
      });
      return { i, kind: v.crashLight === o ? 'crash' : v.pool.some((s) => s.light === o) ? 'engine' : 'other', intensity: +o.intensity.toFixed(0), pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), nearest: +best.d.toFixed(2), mesh: best.name };
    });
  }, f);
  console.log(f, JSON.stringify(r));
}
await browser.close();
