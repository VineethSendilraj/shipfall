// Renders the share-card images from the real 3D scene: the deterministic ?demo=1 showcase is stepped to a
// chopstick-catch frame in headless Chromium and screenshotted, square for X's player card and wide for og:image.
// Usage: npm run card            (writes public/player.jpg and public/share.jpg)
//        npm run card -- --candidates /tmp/card-candidates   (renders a contact set of square catch frames to pick from)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { CARD } from '../site.config.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const candidatesDir = argv.includes('--candidates') ? argv[argv.indexOf('--candidates') + 1] : null;
// Sim frame (60 Hz) of the chosen shot: round 1 approach, booster tilted on its landing burn beside the open arms.
const CARD_FRAME = Number(process.env.CARD_FRAME || 352);
const CATCHES = [398, 823, 1291, 1461];
const GL_ARGS = (process.env.CHROMIUM_ARGS || '--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist').split(' ').filter(Boolean);

const SHOTS = [
  { file: CARD.playerImage, w: CARD.playerImageSize, h: CARD.playerImageSize, title: 84, top: 64, foot: 16, bottom: 34 },
  { file: CARD.image, w: CARD.imageWidth, h: CARD.imageHeight, title: 64, top: 40, foot: 14, bottom: 24 },
];

const cardCss = (s) => `
  #hud, #popups, #banner, #demo-title, #demo-end, .disclaimer { display: none !important; }
  .card-title { position: absolute; left: 0; right: 0; top: ${s.top}px; text-align: center; pointer-events: none; }
  .card-title h1 { margin: 0; font: 600 ${s.title}px var(--display); letter-spacing: -0.01em; line-height: 1; color: #f1f2f4;
    text-shadow: 0 4px 30px rgba(0,0,0,0.7); }
  .card-foot { position: absolute; left: 0; right: 0; bottom: ${s.bottom}px; text-align: center; font: 600 ${s.foot}px var(--display); letter-spacing: 0.12em; color: rgba(241,242,244,0.8); text-shadow: 0 1px 8px rgba(0,0,0,0.9); }
`;

const { server, url } = await startServer({ port: 0, quiet: true });
const browser = await chromium.launch({ args: GL_ARGS });

/** Opens the showcase at a shot's size, with the card title and footer over it. */
async function open(s) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`${url}/?demo=1&capture=1`);
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
  await page.addStyleTag({ content: cardCss(s) });
  await page.evaluate(() => {
    const t = document.createElement('div');
    t.className = 'card-title';
    t.innerHTML = '<h1>catch the booster</h1>';
    const f = document.createElement('div');
    f.className = 'card-foot';
    f.textContent = 'not affiliated with SpaceX';
    document.getElementById('app').append(t, f);
  });
  return page;
}

async function stepTo(page, frame) {
  // Advance without rendering, but render the last few frames so camera smoothing and bloom settle.
  let cur = (await page.evaluate(() => window.__advance(0, false))).frame;
  while (frame - cur > 4) cur = (await page.evaluate((n) => window.__advance(n, false), Math.min(120, frame - cur - 4))).frame;
  while (cur < frame) cur = (await page.evaluate(() => window.__advance(1, true))).frame;
}

if (candidatesDir) {
  mkdirSync(candidatesDir, { recursive: true });
  const page = await open(SHOTS[0]);
  const frames = CATCHES.flatMap((f) => [f + 8, f + 24, f + 43, f + 62]);
  for (const f of frames) {
    await stepTo(page, f);
    await page.screenshot({ path: join(candidatesDir, `card-${f}.jpg`), type: 'jpeg', quality: 80 });
    console.log('candidate', f);
  }
} else {
  for (const s of SHOTS) {
    const page = await open(s);
    await stepTo(page, CARD_FRAME);
    const out = join(REPO, 'public', s.file);
    await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
    await page.close();
    console.log(`wrote ${out} (${s.w}x${s.h}, sim frame ${CARD_FRAME})`);
  }
}
await browser.close();
server.close();
