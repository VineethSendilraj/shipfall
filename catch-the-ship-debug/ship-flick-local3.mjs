// Re-measures single-frame flashes around given frames (same 16x9 luma test as flicker-det.mjs) with a
// render variant applied: default | novc (vertex colors off) | notan (drop vertex tangents).
// Usage: node ship-flick-local.mjs <base> <w> <h> <variant> f1,f2,...
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, variant, list] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
await page.evaluate((variant) => {
  const v = window.__view;
  if (variant === 'noparticles') v.particles.group.visible = false;
  if (variant === 'noship') v.pool.forEach((s) => { if (s.kind === 'ship') s.root.scale.setScalar(0.0001); });
  if (variant === 'novc') v.scene.traverse((o) => { if (o.isMesh && o.material.vertexColors) { o.material.vertexColors = false; o.material.needsUpdate = true; } });
}, variant);
const targets = list.split(',').map(Number);
const lum = () =>
  page.evaluate(() => {
    const GW = 16, GH = 9, SW = 640, SH = 360, BW = SW / GW, BH = SH / GH;
    if (!window.__small) {
      const c = document.createElement('canvas');
      c.width = SW; c.height = SH;
      window.__small = c.getContext('2d', { willReadFrequently: true });
    }
    const ctx = window.__small;
    ctx.drawImage(document.getElementById('gl'), 0, 0, SW, SH);
    const px = ctx.getImageData(0, 0, SW, SH).data, sum = new Float64Array(GW * GH);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const o = (y * SW + x) * 4;
      sum[Math.floor(y / BH) * GW + Math.floor(x / BW)] += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    }
    return Array.from(sum, (s) => s / (BW * BH * 255));
  });
let frame = await page.evaluate(() => window.__demoFrame);
const out = [];
for (const k of targets) {
  const pre = Number(process.env.PRE || 0);
  if (k - 1 - pre > frame) frame = (await page.evaluate((n) => window.__advance(n, true), k - 1 - pre - frame)).frame;
  while (frame < k - 1) frame = (await page.evaluate(() => window.__advance(1, true))).frame;
  if (variant === 'late-novc') await page.evaluate(() => window.__view.scene.traverse((o) => { if (o.isMesh && o.material.vertexColors) { o.material.vertexColors = false; o.material.needsUpdate = true; } }));
  if (variant === 'late-steel-novc') await page.evaluate(() => window.__view.scene.traverse((o) => { if (o.isMesh && o.material.vertexColors && o.material.anisotropy > 0) { o.material.vertexColors = false; o.material.needsUpdate = true; } }));
  if (variant === 'late-other-novc') await page.evaluate(() => window.__view.scene.traverse((o) => { if (o.isMesh && o.material.vertexColors && !(o.material.anisotropy > 0)) { o.material.vertexColors = false; o.material.needsUpdate = true; } }));
  if (variant === 'late-steel-noaniso') await page.evaluate(() => window.__view.scene.traverse((o) => { if (o.isMesh && o.material.vertexColors && o.material.anisotropy > 0) { o.material.anisotropy = 0; o.material.needsUpdate = true; } }));
  if (variant === 'late-steel-nobump') await page.evaluate(() => window.__view.scene.traverse((o) => { if (o.isMesh && o.material.vertexColors && o.material.anisotropy > 0) { o.material.bumpMap = null; o.material.needsUpdate = true; } }));

  if (variant === 'late-steel-guard') await page.evaluate(() => {
    const chunk = `
#ifdef USE_BUMPMAP
uniform sampler2D bumpMap;
uniform float bumpScale;
vec2 dHdxy_fwd() {
  vec2 dSTdx = dFdx( vBumpMapUv );
  vec2 dSTdy = dFdy( vBumpMapUv );
  float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
  float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
  float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
  return vec2( dBx, dBy );
}
vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
  vec3 dx = dFdx( surf_pos.xyz );
  vec3 dy = dFdy( surf_pos.xyz );
  if ( dot( dx, dx ) < 1e-24 || dot( dy, dy ) < 1e-24 ) return surf_norm;
  vec3 vSigmaX = normalize( dx );
  vec3 vSigmaY = normalize( dy );
  vec3 R1 = cross( vSigmaY, surf_norm );
  vec3 R2 = cross( surf_norm, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDirection;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  vec3 n = abs( fDet ) * surf_norm - vGrad;
  return dot( n, n ) > 1e-24 ? normalize( n ) : surf_norm;
}
#endif`;
    window.__view.scene.traverse((o) => {
      if (o.isMesh && o.material.vertexColors && o.material.anisotropy > 0 && !o.material.__guarded) {
        const m = o.material;
        m.__guarded = true;
        m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <bumpmap_pars_fragment>', chunk); };
        m.customProgramCacheKey = () => 'bumpguard';
        m.needsUpdate = true;
      }
    });
  });
  const a = await lum();
  frame = (await page.evaluate(() => window.__advance(1, true))).frame;
  const b = await lum();
  frame = (await page.evaluate(() => window.__advance(1, true))).frame;
  const c = await lum();
  let amp = 0;
  for (let i = 0; i < b.length; i++) {
    const d1 = b[i] - a[i], d2 = c[i] - b[i];
    if (Math.sign(d1) !== Math.sign(d2) && Math.abs(c[i] - a[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2))) amp = Math.max(amp, Math.min(Math.abs(d1), Math.abs(d2)));
  }
  out.push(`f${k}:${amp.toFixed(3)}`);
}
console.log(variant, w + 'x' + h, out.join(' '));
await browser.close();
