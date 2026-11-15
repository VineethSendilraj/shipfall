// Renders the share-card images from the real 3D scene with the ShipFall tag over it: square for X's player card
// (public/player.jpg) and wide for og:image (public/share.jpg).
//   stack: free flight (?flight=1&capture=1) seconds after liftoff, the full stack climbing out of its smoke.
//   ship:  the demo's double catch (?demo=1&capture=1), the ship swinging upright on its engines beside the tower.
// The page is rendered taller than the card and the top is kept, which crops most of the ground away.
// Usage: npm run card                        (CARD_SCENE=ship|stack, default ship)
//        CHROMIUM_CHANNEL=chrome npm run card   (uses the installed Google Chrome instead of Playwright's Chromium)
//        CARD_OUT=/tmp/cards npm run card       (writes there instead of public/, to compare options)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { CARD } from '../site.config.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// CARD_MAP=mars|starbase picks the launch site the cards are rendered on.
const MAP = process.env.CARD_MAP || 'mars';
const OUT = process.env.CARD_OUT ? resolve(process.env.CARD_OUT) : join(REPO, 'public');
// at: mission seconds (stack) or demo sim frame (ship); cam: the look-around offset; extra: how much taller than the
// card the page renders (the extra is cropped off the bottom); y: where the title block sits, as a fraction of the card.
const SCENES = {
  stack: { url: `/?flight=1&capture=1&map=${MAP}`, ready: '__flightReady', at: 3.5, cam: { zoom: 1.75, pitch: -0.24, yaw: 0 }, square: { extra: 0.22, y: 0.2 }, wide: { extra: 0.2, y: 0.22, zoom: 1.9 } },
  ship: { url: `/?demo=1&capture=1&map=${MAP}`, ready: '__demoReady', at: Number(process.env.CARD_AT || 1325), cam: { zoom: 0.72, pitch: -0.08, yaw: 0.15 }, square: { extra: 0.14, y: 0.19 }, wide: { extra: 0.12, y: 0.21, zoom: 0.85 } },
};
const SCENE = SCENES[process.env.CARD_SCENE || 'ship'];
// The X logo, as on the game's Post on X button.
const X_PATH = 'M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z';
const CHANNEL = process.env.CHROMIUM_CHANNEL || undefined;
const GL_ARGS = (process.env.CHROMIUM_ARGS || (CHANNEL ? '--ignore-gpu-blocklist' : '--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist')).split(' ').filter(Boolean);

// u: one unit of type size for the shot.
const SHOTS = [
  { file: CARD.playerImage, w: CARD.playerImageSize, h: CARD.playerImageSize, u: 0.82, ...SCENE.square },
  { file: CARD.image, w: CARD.imageWidth, h: CARD.imageHeight, u: 0.55, sub: false, ...SCENE.wide },
];

const cardCss = (s) => `
  #hud, #popups, #banner, #corner, #touch, .coach, .status-stack, .disclaimer, #title-screen, #demo-title, #demo-end { display: none !important; }
  .card-art { position: absolute; left: 0; width: ${s.w}px; top: ${s.y * s.h}px; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; pointer-events: none; }
  .card-art h1 { margin: 0; position: relative; z-index: 0; font: 400 ${210 * s.u}px/1.1 'Sedgwick Ave Display', var(--display);
    background: linear-gradient(180deg, #ffffff 0%, #e4e8ef 46%, #9aa3b2 54%, #dfe4ec 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
    -webkit-text-stroke: ${3 * s.u}px rgba(10, 13, 20, 0.9); paint-order: stroke fill;
    filter: drop-shadow(0 ${8 * s.u}px ${18 * s.u}px rgba(0, 0, 0, 0.55)) drop-shadow(0 ${2 * s.u}px 0 rgba(0, 0, 0, 0.6)); }
  .card-art .tag { position: relative; z-index: 1; margin-top: ${-14 * s.u}px; padding: ${12 * s.u}px ${30 * s.u}px; border-radius: ${10 * s.u}px; font: 700 ${40 * s.u}px/1 var(--display); letter-spacing: ${0.06 * 40 * s.u}px; text-transform: uppercase;
    color: #1a0d03; background: linear-gradient(180deg, #ffc46b, #ff8a2a); box-shadow: 0 ${6 * s.u}px ${20 * s.u}px rgba(0, 0, 0, 0.45), inset 0 ${2 * s.u}px 0 rgba(255, 255, 255, 0.45); }
  .card-art .sub { display: ${s.sub === false ? 'none' : 'flex'}; align-items: center; gap: ${12 * s.u}px; margin-top: ${16 * s.u}px; font: 700 ${30 * s.u}px/1 var(--display); letter-spacing: ${0.1 * 30 * s.u}px; text-transform: uppercase; color: #f1f2f4; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.85); }
  .card-art .x { display: grid; place-items: center; width: ${46 * s.u}px; height: ${46 * s.u}px; border-radius: ${11 * s.u}px; background: #000; box-shadow: 0 ${3 * s.u}px ${12 * s.u}px rgba(0, 0, 0, 0.5); }
  .card-art .x svg { width: 64%; height: 64%; }
  .card-foot { position: absolute; left: ${22 * s.u}px; top: ${s.h - 36 * s.u}px; font: 600 ${16 * s.u}px var(--display); letter-spacing: 0.1em; color: rgba(241, 242, 244, 0.75); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9); }
`;

mkdirSync(OUT, { recursive: true });
const { server, url } = await startServer({ port: 0, quiet: true });
const browser = await chromium.launch({ channel: CHANNEL, args: GL_ARGS });

for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.w, height: Math.round(s.h * (1 + s.extra)) }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(url + SCENE.url);
  await page.waitForFunction((flag) => window[flag] === true, SCENE.ready, { timeout: 120000 });
  await page.addStyleTag({ content: cardCss(s) });
  await page.evaluate(
    ([flight, at, cam, xPath]) => {
      if (flight) {
        for (let i = 0; i < 20000; i++) if (window.__advance(1, false).t >= at) break;
      } else {
        let cur = window.__advance(0, false).frame;
        while (cur < at - 6) cur = window.__advance(Math.min(120, at - 6 - cur), false).frame;
      }
      const o = window.__view.orbit;
      Object.assign(o.want, cam);
      Object.assign(o, cam);
      // Render the last few frames so camera smoothing and bloom settle.
      for (let i = 0; i < 6; i++) window.__advance(1, true);
      const art = document.createElement('div');
      art.className = 'card-art';
      art.innerHTML = '<h1>ShipFall</h1><div class="tag">Try to catch Starship</div><div class="sub">Playable in <i class="x"><svg viewBox="0 0 24 24"><path fill="#fff" d="' + xPath + '"/></svg></i></div>';
      const foot = document.createElement('div');
      foot.className = 'card-foot';
      foot.textContent = 'not affiliated with SpaceX';
      document.getElementById('app').append(art, foot);
    },
    [SCENE.ready === '__flightReady', SCENE.at, { ...SCENE.cam, zoom: s.zoom ?? SCENE.cam.zoom }, X_PATH],
  );
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))]));
  const out = join(OUT, s.file);
  await page.screenshot({ path: out, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: s.w, height: s.h } });
  await page.close();
  console.log(`wrote ${out} (${s.w}x${s.h})`);
}
await browser.close();
server.close();
