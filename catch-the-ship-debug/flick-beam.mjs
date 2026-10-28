import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, list] = process.argv.slice(2);
const targets = list.split(',').map((s) => s.split(':').map(Number)).sort((a, b) => a[0] - b[0]);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true);
for (const [f, cx, cy] of targets) {
  const r = await page.evaluate(([f, cx, cy]) => {
    const cur = window.__demoFrame;
    if (f > cur) window.__advance(f - cur, true);
    const c = document.createElement('canvas');
    c.width = 16; c.height = 9;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const gl = document.getElementById('gl');
    const cell = () => {
      window.__advance(0, true);
      ctx.drawImage(gl, 0, 0, 16, 9);
      const p = ctx.getImageData(cx, cy, 1, 1).data;
      return [+((0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255).toFixed(3), p[0], p[1], p[2]];
    };
    let mat;
    window.__view.scene.traverse((o) => { if (o.material?.fragmentShader?.includes('standing inside a beam')) mat = o.material; });
    const orig = mat.fragmentShader;
    const variant = (body) => {
      mat.fragmentShader = orig.replace('gl_FragColor = vec4(uColor * a, 0.0);', body);
      mat.needsUpdate = true;
      return cell();
    };
    const out = {
      f: window.__demoFrame,
      original: variant('gl_FragColor = vec4(uColor * a, 0.0);'),
      nanGuard: variant('if (isnan(a) || isinf(a)) a = 0.0; gl_FragColor = vec4(uColor * a, 0.0);'),
      varyingNaN: variant('bool bad = isnan(vEdge) || isinf(vEdge) || isnan(vDepth) || isinf(vDepth) || isnan(vV); gl_FragColor = bad ? vec4(0.0, 4.0, 0.0, 0.0) : vec4(uColor * a, 0.0);'),
      aRange: variant('gl_FragColor = (a > 0.0801 || a < 0.0) ? vec4(0.0, 0.0, 4.0, 0.0) : vec4(uColor * a, 0.0);'),
    };
    mat.fragmentShader = orig;
    mat.needsUpdate = true;
    out.restored = cell();
    return out;
  }, [f, cx, cy]);
  console.log(JSON.stringify(r));
}
await browser.close();
