// Positive control for explore-flash.mjs CAP: at the Engines preset, renders one frame plain, then with the facing-aware
// cap at 1 and at 0 on every standard material, and counts the pixels each cap changes and the compiled fragment
// shaders that carry the cap line.
// Usage: node explore-cap-check.mjs <base-url>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41830'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__hold = false;
  const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
  window.requestAnimationFrame = wrap;
});
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length && !window.__explore.flight, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(800);
const out = await page.evaluate(() => {
  window.__hold = true;
  const e = window.__explore;
  const { renderer, scene } = e.view;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true }));
  for (let k = 0; k < 400 && e.flight; k++) e.frame(1 / 60);
  for (let k = 0; k < 30; k++) e.frame(1 / 60);
  const c = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const grab = () => {
    e.view.render(e.game);
    ctx.drawImage(renderer.domElement, 0, 0);
    return ctx.getImageData(0, 0, 1280, 720).data;
  };
  const mats = new Set();
  scene.traverse((o) => o.isMesh && [o.material].flat().forEach((m) => m.isMeshStandardMaterial && mats.add(m)));
  const orig = new Map([...mats].map((m) => [m, [m.onBeforeCompile, m.customProgramCacheKey]]));
  const cap = (v) => {
    for (const m of mats) {
      const [prev] = orig.get(m);
      m.onBeforeCompile = (shader, r) => {
        prev.call(m, shader, r);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `if ( dot( geometryNormal, geometryViewDir ) < 0.0 ) outgoingLight = min( outgoingLight, vec3( ${v.toFixed(1)} ) );\n#include <opaque_fragment>`,
        );
      };
      m.customProgramCacheKey = () => `cap${v}:${prev.toString()}`;
      m.needsUpdate = true;
    }
  };
  const diff = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
    return n;
  };
  const gl = renderer.getContext();
  const capped = () =>
    renderer.info.programs.filter((p) => gl.getAttachedShaders(p.program).some((s) => gl.getShaderSource(s).includes('outgoingLight = min( outgoingLight, vec3('))).length;
  const a = grab();
  const a2 = grab();
  cap(1);
  const b = grab();
  const progs1 = capped();
  cap(0);
  const z = grab();
  const progs0 = capped();
  return { materials: mats.size, programs: renderer.info.programs.length, plainVsPlain: diff(a, a2), cap1Changed: diff(a, b), cap1Programs: progs1, cap0Changed: diff(a, z), cap0Programs: progs0 };
});
console.log(JSON.stringify(out));
await browser.close();
