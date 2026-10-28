// Checks that PR #18's steel cap reaches Explore's stack: renders the Grid fins and Engines presets, then counts the
// compiled fragment shaders that carry the cap line and the stack meshes whose material has an onBeforeCompile.
// Usage: node explore-cap18-check.mjs <base-url>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41830'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length && !window.__explore.flight, null, { polling: 100, timeout: 120000 });
for (const k of ['3', '2']) {
  await page.keyboard.press(k);
  await page.waitForFunction(() => !window.__explore.flight, null, { polling: 100, timeout: 60000 });
  await page.waitForTimeout(500);
}
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__explore;
  const { renderer } = e.view;
  const gl = renderer.getContext();
  const src = (p) => gl.getAttachedShaders(p.program).map((s) => gl.getShaderSource(s)).join('\n');
  const capped = renderer.info.programs.filter((p) => src(p).includes('outgoingLight = min( outgoingLight, vec3( 256.0 ) )')).length;
  const mats = new Set();
  e.stack.root.traverse((o) => o.isMesh && mats.add(o.material));
  const hooked = [...mats].filter((m) => m.onBeforeCompile.toString().includes('256.0'));
  return { programs: renderer.info.programs.length, cappedPrograms: capped, stackMaterials: mats.size, stackMaterialsWithCap: hooked.length, vertexColored: hooked.filter((m) => m.vertexColors).length };
})));
await browser.close();
