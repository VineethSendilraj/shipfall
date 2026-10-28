// Checks the camera projection's horizontal/vertical pixel scale on tall and square viewports (1 = not squashed).
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const [w, h, path] of [[390, 844, '/'], [480, 480, '/embed/'], [1280, 720, '/']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}${path}?explore=1`, { timeout: 120000 });
  await page.waitForFunction(() => window.__explore?.stack && !window.__explore.flight, null, { timeout: 120000, polling: 100 });
  const r = await page.evaluate(() => {
    const cam = window.__explore.view.camera;
    const p = cam.projectionMatrix.elements;
    return { aspect: cam.aspect.toFixed(3), view: cam.view?.enabled ? [cam.view.fullWidth, cam.view.fullHeight] : null, fov: cam.fov.toFixed(1), squash: ((p[0] * innerWidth) / (p[5] * innerHeight)).toFixed(3) };
  });
  console.log(`${w}x${h}`, JSON.stringify(r));
  await page.close();
}
await browser.close();
