import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true);
const r = await page.evaluate(() => {
  window.__advance(627, true);
  const s = window.__view.scene;
  return [12, 22].map((i) => {
    const o = s.children[i], g = o.geometry, m = o.material;
    return {
      i, type: o.type, isInstanced: !!o.isInstancedMesh, count: o.count, geom: g.type, verts: g.attributes.position?.count,
      attrs: Object.keys(g.attributes), drawRange: g.drawRange, instanceCount: g.instanceCount, renderOrder: o.renderOrder,
      frustumCulled: o.frustumCulled, blending: m.blending, depthWrite: m.depthWrite, transparent: m.transparent,
      uniforms: Object.keys(m.uniforms || {}), frag: (m.fragmentShader || '').slice(0, 700), vert: (m.vertexShader || '').slice(0, 1200),
    };
  });
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
