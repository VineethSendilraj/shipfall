import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, list] = process.argv.slice(2);
const targets = list.split(',').map((s) => s.split(':').map(Number)).sort((a, b) => a[0] - b[0]);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true);
for (const [f, cx, cy] of targets) {
  const r = await page.evaluate(([f, cx, cy]) => {
    const v = window.__view;
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
      return +((0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255).toFixed(3);
    };
    let mat;
    v.scene.traverse((o) => { if (o.material?.fragmentShader?.includes('standing inside a beam')) mat = o.material; });
    const out = { f, samples: v.composer.renderTarget1.samples, msaa4: cell() };
    const rts = [v.composer.renderTarget1, v.composer.renderTarget2];
    for (const rt of rts) { rt.samples = 0; rt.dispose(); }
    out.msaaOff = cell();
    for (const rt of rts) { rt.samples = 4; rt.dispose(); }
    out.msaa4Again = cell();
    const orig = mat.fragmentShader;
    mat.fragmentShader = orig.replace('float a = vV * vV * vEdge * vEdge', 'float cv = clamp(vV, 0.0, 1.0), ce = clamp(vEdge, 0.0, 1.0); float a = cv * cv * ce * ce');
    mat.needsUpdate = true;
    out.clampedVaryings = cell();
    mat.fragmentShader = orig;
    mat.needsUpdate = true;
    return out;
  }, [f, cx, cy]);
  console.log(JSON.stringify(r));
}
await browser.close();
