// Renders the share-card images from the real 3D scene: free flight (?flight=1&capture=1) is stepped to a few
// seconds after liftoff, the full stack climbing out of its smoke beside the tower, and screenshotted with the
// ShipFall title over it: square for X's player card and wide for og:image.
// Usage: npm run card            (writes public/player.jpg and public/share.jpg)
//        CHROMIUM_CHANNEL=chrome npm run card   (uses the installed Google Chrome instead of Playwright's Chromium)
import { chromium } from 'playwright';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { CARD } from '../site.config.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Mission seconds after liftoff, and the look-around offset that pulls back and looks up at the stack.
const CARD_T = Number(process.env.CARD_T || 3);
const CAMERA = { zoom: 1.9, pitch: -0.12, yaw: 0 };
const CHANNEL = process.env.CHROMIUM_CHANNEL || undefined;
const GL_ARGS = (process.env.CHROMIUM_ARGS || (CHANNEL ? '--ignore-gpu-blocklist' : '--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist')).split(' ').filter(Boolean);

// u: one unit of type size for the shot; the title block is centered in the sky at `y` (fraction of the height).
const SHOTS = [
  { file: CARD.playerImage, w: CARD.playerImageSize, h: CARD.playerImageSize, u: 0.82, y: 0.14, zoom: 2.15 },
  { file: CARD.image, w: CARD.imageWidth, h: CARD.imageHeight, u: 0.55, y: 0.16, zoom: 2.2, sub: false },
];

const cardCss = (s) => `
  #hud, #popups, #banner, #corner, #touch, .coach, .status-stack, .disclaimer, #title-screen { display: none !important; }
  .card-art { position: absolute; left: 0; right: 0; top: ${s.y * 100}%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; pointer-events: none; }
  .card-art h1 { margin: 0; font: 700 ${190 * s.u}px/0.9 var(--display); letter-spacing: ${0.02 * 190 * s.u}px; text-transform: uppercase;
    background: linear-gradient(180deg, #ffffff 0%, #e4e8ef 46%, #9aa3b2 54%, #dfe4ec 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
    -webkit-text-stroke: ${3 * s.u}px rgba(10, 13, 20, 0.9); paint-order: stroke fill;
    filter: drop-shadow(0 ${8 * s.u}px ${18 * s.u}px rgba(0, 0, 0, 0.55)) drop-shadow(0 ${2 * s.u}px 0 rgba(0, 0, 0, 0.6)); }
  .card-art .tag { margin-top: ${18 * s.u}px; padding: ${12 * s.u}px ${30 * s.u}px; border-radius: ${10 * s.u}px; font: 700 ${40 * s.u}px/1 var(--display); letter-spacing: ${0.06 * 40 * s.u}px; text-transform: uppercase;
    color: #1a0d03; background: linear-gradient(180deg, #ffc46b, #ff8a2a); box-shadow: 0 ${6 * s.u}px ${20 * s.u}px rgba(0, 0, 0, 0.45), inset 0 ${2 * s.u}px 0 rgba(255, 255, 255, 0.45); }
  .card-art .sub { display: ${s.sub === false ? 'none' : 'block'}; margin-top: ${16 * s.u}px; font: 700 ${30 * s.u}px/1 var(--display); letter-spacing: ${0.1 * 30 * s.u}px; text-transform: uppercase; color: #f1f2f4; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.85); }
  .card-foot { position: absolute; left: ${22 * s.u}px; bottom: ${18 * s.u}px; font: 600 ${16 * s.u}px var(--display); letter-spacing: 0.1em; color: rgba(241, 242, 244, 0.75); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9); }
`;

const { server, url } = await startServer({ port: 0, quiet: true });
const browser = await chromium.launch({ channel: CHANNEL, args: GL_ARGS });

for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`${url}/?flight=1&capture=1`);
  await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
  await page.addStyleTag({ content: cardCss(s) });
  await page.evaluate(
    ([t, cam]) => {
      for (let i = 0; i < 20000; i++) if (window.__advance(1, false).t >= t) break;
      const o = window.__view.orbit;
      Object.assign(o.want, cam);
      Object.assign(o, cam);
      // Render the last few frames so camera smoothing and bloom settle.
      for (let i = 0; i < 3; i++) window.__advance(1, true);
      const art = document.createElement('div');
      art.className = 'card-art';
      art.innerHTML = '<h1>ShipFall</h1><div class="tag">Try to catch Starship</div><div class="sub">Playable in the timeline</div>';
      const foot = document.createElement('div');
      foot.className = 'card-foot';
      foot.textContent = 'not affiliated with SpaceX';
      document.getElementById('app').append(art, foot);
    },
    [CARD_T, { ...CAMERA, zoom: s.zoom ?? CAMERA.zoom }],
  );
  await page.evaluate(() => document.fonts.ready);
  const out = join(REPO, 'public', s.file);
  await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
  await page.close();
  console.log(`wrote ${out} (${s.w}x${s.h}, T+${CARD_T}s)`);
}
await browser.close();
server.close();
