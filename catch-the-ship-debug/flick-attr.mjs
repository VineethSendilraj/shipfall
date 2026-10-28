// At a flash frame, hide scene objects one by one and see which one removes the flash in a given cell.
// Usage: node flick-attr.mjs <base-url> frame:cx:cy[,frame:cx:cy...]
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
      ctx.drawImage(gl, 0, 0, 16, 9);
      const p = ctx.getImageData(cx, cy, 1, 1).data;
      return +((0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255).toFixed(3);
    };
    const redraw = () => { window.__advance(0, true); return cell(); };
    const base = redraw();
    const scene = window.__view.scene;
    const label = (o) => `${o.type}${o.name ? ' ' + o.name : ''}${o.material ? ' [' + (o.material.type || '') + (o.material.blending === 2 ? ' additive' : '') + ']' : ''} children=${o.children.length}`;
    const probe = (objs) => objs.map((o, i) => {
      const v = o.visible;
      o.visible = false;
      const l = redraw();
      o.visible = v;
      return { i, label: label(o), lumHidden: l, drop: +(base - l).toFixed(3) };
    }).filter((x) => x.drop > 0.05).sort((a, b) => b.drop - a.drop);
    const top = probe(scene.children);
    let deeper = [];
    if (top.length) {
      const culprit = scene.children[top[0].i];
      deeper = probe(culprit.children);
      if (deeper.length) {
        const c2 = culprit.children[deeper[0].i];
        deeper = deeper.concat([{ sub: probe(c2.children) }]);
      }
    }
    return { f: window.__demoFrame, base, top, deeper, after: redraw() };
  }, [f, cx, cy]);
  console.log(JSON.stringify(r));
}
await browser.close();
