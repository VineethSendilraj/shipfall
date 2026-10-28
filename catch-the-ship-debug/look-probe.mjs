// Renders demo frames with steel variants and writes PNGs. Usage: node look-probe.mjs <base> <w> <h> <frames csv> <prefix>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, w, h, framesCsv, prefix] = process.argv.slice(2);
const variants = JSON.parse(process.env.VARIANTS);
const frames = framesCsv.split(',').map(Number).sort((a, b) => a - b);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
for (const f of frames) {
  await page.evaluate((f) => window.__advance(f - window.__demoFrame, true), f);
  for (const [name, v] of Object.entries(variants)) {
    await page.evaluate((v) => {
      const s = window.__view.boosterMats.steel;
      window.__orig ??= { roughness: s.roughness, anisotropy: s.anisotropy, bumpScale: s.bumpScale, envMapIntensity: s.envMapIntensity, roughnessMap: s.roughnessMap, map: s.map, metalness: s.metalness };
      Object.assign(s, window.__orig);
      for (const [k, val] of Object.entries(v)) if (k !== 'radial') s[k] = val === 'null' ? null : val;
      const geos = new Set();
      window.__view.scene.traverse((m) => { if (m.isMesh && m.material === s) geos.add(m.geometry); });
      for (const g of geos) {
        g.userData.orig ??= g.attributes.normal.clone();
        const n = g.attributes.normal, p = g.attributes.position, o = g.userData.orig;
        const want = v.radial ? 'radial' : 'orig';
        if (g.userData.state === want) continue;
        for (let i = 0; i < n.count; i++) {
          const ox = o.getX(i), oy = o.getY(i), oz = o.getZ(i);
          if (!v.radial || Math.abs(oy) > 0.95) { n.setXYZ(i, ox, oy, oz); continue; }
          const x = p.getX(i), z = p.getZ(i), l = Math.hypot(x, z) || 1;
          n.setXYZ(i, x / l, 0, z / l);
        }
        n.needsUpdate = true;
        g.userData.state = want;
        if (g.attributes.tangent) { g.deleteAttribute('tangent'); g.computeTangents(); }
      }
      s.needsUpdate = true;
      window.__advance(0, true);
    }, v);
    await page.screenshot({ path: `${prefix}-f${f}-${name}.png`, timeout: 180000 });
  }
}
await browser.close();
