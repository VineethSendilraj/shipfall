import { chromium } from 'playwright';

const [port] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${port}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
await page.evaluate(() => window.__advance(999 - window.__demoFrame, true));
const r = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  const g = c.getContext('2d', { willReadFrequently: true });
  const peak = () => {
    window.__advance(0, true);
    g.drawImage(document.getElementById('gl'), 0, 0, 1280, 720);
    const d = g.getImageData(400, 560, 120, 80).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    return +(s / (d.length / 4)).toFixed(4);
  };
  const v = window.__view;
  let band;
  v.scene.traverse((o) => o.name === 'props_band' && (band = o));
  const m = band.material;
  const out = { base: peak() };
  const tryIt = (name, set, reset) => {
    set();
    m.needsUpdate = true;
    out[name] = peak();
    reset();
    m.needsUpdate = true;
  };
  tryIt('noVertexColors', () => (m.vertexColors = false), () => (m.vertexColors = true));
  tryIt('rough0.8', () => (m.roughness = 0.8), () => (m.roughness = 0.5));
  tryIt('metal0', () => (m.metalness = 0), () => (m.metalness = 0.6));
  tryIt('envInt0', () => (m.envMapIntensity = 0), () => (m.envMapIntensity = 1));
  let key;
  v.scene.traverse((o) => o.isDirectionalLight && o.intensity > 2 && (key = o));
  const ki = key.intensity;
  tryIt('key0', () => (key.intensity = 0), () => (key.intensity = ki));
  tryIt('noShadowRecv', () => (band.receiveShadow = false), () => (band.receiveShadow = true));
  out.after = peak();
  const col = band.geometry.attributes.color;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < col.array.length; i++) {
    lo = Math.min(lo, col.array[i]);
    hi = Math.max(hi, col.array[i]);
  }
  out.colorRange = [lo, hi, col.itemSize, col.array.constructor.name, col.normalized];
  const nor = band.geometry.attributes.normal;
  let bad = 0;
  for (let i = 0; i < nor.count; i++) {
    const l = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
    if (!(Math.abs(l - 1) < 0.02)) bad++;
  }
  out.badNormals = bad;
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
