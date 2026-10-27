// Renders the share-card image (public/card.jpg, 1080x1080) from the real 3D scene: the deterministic
// ?demo=1 showcase is stepped to a chopstick-catch frame in headless Chromium and screenshotted.
// Usage: npm run card            (writes public/card.jpg)
//        npm run card -- --candidates /tmp/card-candidates   (renders a contact set of catch frames to pick from)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const candidatesDir = argv.includes('--candidates') ? argv[argv.indexOf('--candidates') + 1] : null;
const SIZE = 1080;
// Sim frame (60 Hz) of the chosen shot: round 1, arms closed on the catch pins, close-up camera.
const CARD_FRAME = Number(process.env.CARD_FRAME || 441);
const CATCHES = [398, 823, 1291, 1461];
const GL_ARGS = (process.env.CHROMIUM_ARGS || '--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist').split(' ').filter(Boolean);

const CARD_CSS = `
  #hud, #popups, #banner, #demo-title, #demo-end, .disclaimer { display: none !important; }
  .card-title { position: absolute; left: 0; right: 0; top: 64px; text-align: center; pointer-events: none; }
  .card-title h1 { margin: 0; font: 700 84px var(--display); letter-spacing: -0.02em; line-height: 1;
    background: linear-gradient(180deg, #ffffff 20%, #b4c4ea); -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 6px 26px rgba(0,0,0,0.75)); }
  .card-foot { position: absolute; left: 0; right: 0; bottom: 34px; text-align: center; font: 500 16px var(--mono); letter-spacing: 0.16em; color: rgba(225,233,255,0.78); text-shadow: 0 1px 6px rgba(0,0,0,0.9); }
`;

const { server, url } = await startServer({ port: 0, quiet: true });
const browser = await chromium.launch({ args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(`${url}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
await page.addStyleTag({ content: CARD_CSS });
await page.evaluate(() => {
  const t = document.createElement('div');
  t.className = 'card-title';
  t.innerHTML = '<h1>catch the booster</h1>';
  const f = document.createElement('div');
  f.className = 'card-foot';
  f.textContent = 'not affiliated with SpaceX';
  document.getElementById('app').append(t, f);
});

async function stepTo(frame) {
  // Advance without rendering, but render the last few frames so camera smoothing and bloom settle.
  let cur = (await page.evaluate(() => window.__advance(0, false))).frame;
  while (frame - cur > 4) cur = (await page.evaluate((n) => window.__advance(n, false), Math.min(120, frame - cur - 4))).frame;
  while (cur < frame) cur = (await page.evaluate(() => window.__advance(1, true))).frame;
}

if (candidatesDir) {
  mkdirSync(candidatesDir, { recursive: true });
  const frames = CATCHES.flatMap((f) => [f + 8, f + 24, f + 43, f + 62]);
  for (const f of frames) {
    await stepTo(f);
    await page.screenshot({ path: join(candidatesDir, `card-${f}.jpg`), type: 'jpeg', quality: 80 });
    console.log('candidate', f);
  }
} else {
  await stepTo(CARD_FRAME);
  const out = join(REPO, 'public/card.jpg');
  await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
  console.log(`wrote ${out} (${SIZE}x${SIZE}, sim frame ${CARD_FRAME})`);
}
await browser.close();
server.close();
