import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, list] = process.argv.slice(2);
const targets = list.split(',').map((s) => s.split(':').map(Number)).sort((a, b) => a[0] - b[0]);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
const uv = await page.evaluate(() => {
  const v = window.__view, steel = v.boosterMats.steel, out = [];
  for (const slot of v.pool.slice(0, 1)) slot.root.traverse((m) => {
    if (!m.isMesh || m.material !== steel) return;
    const g = m.geometry, p = g.attributes.position, t = g.attributes.uv, idx = g.index;
    if (!t) { out.push({ mesh: m.name, tris: (idx ? idx.count : p.count) / 3, noUv: true }); return; }
    let degenerate = 0, tris = 0;
    const n = idx ? idx.count : p.count;
    for (let k = 0; k < n; k += 3) {
      const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
      const uvArea = Math.abs((t.getX(b) - t.getX(a)) * (t.getY(c) - t.getY(a)) - (t.getX(c) - t.getX(a)) * (t.getY(b) - t.getY(a)));
      tris++;
      if (uvArea < 1e-10) degenerate++;
    }
    out.push({ mesh: m.name, tris, degenerateUvTris: degenerate, hasTangent: !!g.attributes.tangent });
  });
  return out;
});
console.log('steel meshes:', JSON.stringify(uv));
for (const [f, cx, cy] of targets) {
  const r = await page.evaluate(([f, cx, cy]) => {
    const v = window.__view, steel = v.boosterMats.steel;
    const cur = window.__demoFrame;
    if (f > cur) window.__advance(f - cur, true);
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const cell = () => {
      window.__advance(0, true);
      ctx.drawImage(document.getElementById('gl'), 0, 0, 640, 360);
      const px = ctx.getImageData(cx * 40, cy * 40, 40, 40).data;
      let s = 0;
      for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return +(s / (px.length / 4) / 255).toFixed(3);
    };
    const out = { f, original: cell() };
    if (!window.__tangents) { for (const slot of v.pool) slot.root.traverse((m) => { if (m.isMesh && m.material === steel && !m.geometry.attributes.tangent) m.geometry.computeTangents(); }); steel.needsUpdate = true; window.__tangents = true; }
    out.withTangents = cell();
    const a = steel.anisotropy; steel.anisotropy = 0; steel.needsUpdate = true; out.anisotropyOff = cell(); steel.anisotropy = a; steel.needsUpdate = true;
    const bs = steel.bumpScale; steel.bumpScale = 0; out.bumpOff = cell(); steel.bumpScale = bs;
    const rts = [v.composer.renderTarget1, v.composer.renderTarget2];
    for (const rt of rts) { rt.samples = 0; rt.dispose(); }
    out.msaaOff = cell();
    for (const rt of rts) { rt.samples = 4; rt.dispose(); }
    out.restored = cell();
    return out;
  }, [f, cx, cy]);
  console.log(JSON.stringify(r));
}
await browser.close();
