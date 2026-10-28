// Records /embed/ being played inside a parent page that iframes it at 480x480 (like an X player card),
// in real time with Playwright's video recorder, then saves an MP4 plus standalone embed screenshots at
// 480x480 and at a 390x844 phone viewport. An in-page autopilot presses the on-screen buttons.
// Usage: npm run record:embed [-- --out artifacts --seconds 26]
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { ARM_MIN, ARM_MAX } from '../src/sim.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, def) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : def);
const OUT = arg('out', 'artifacts');
const SECONDS = Number(arg('seconds', 26));
const VIEW = { width: 600, height: 640 };
const GL_ARGS = (process.env.CHROMIUM_ARGS || '--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist').split(' ').filter(Boolean);
mkdirSync(OUT, { recursive: true });

/** Runs inside the embed page: steers with the on-screen buttons by dispatching pointer events on them. */
function autopilot({ armMin, armMax }) {
  const btn = (k) => document.querySelector(`#touch [data-k="${k}"]`);
  const pressed = {};
  const set = (k, on) => {
    if (!!pressed[k] === on) return;
    pressed[k] = on;
    btn(k).dispatchEvent(new PointerEvent(on ? 'pointerdown' : 'pointerup', { pointerId: 7, bubbles: true, cancelable: true }));
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let closeHeld = 0;
  const tick = () => {
    requestAnimationFrame(tick);
    const g = window.__game;
    const inp = { left: false, right: false, up: false, down: false };
    const b = g && g.phase === 'live' ? g.activeBooster() : null;
    if (closeHeld > 0 && --closeHeld === 0) set('close', false);
    if (b) {
      const tw = g.towers[b.tower];
      const diff = clamp(b.zeroY + 2, armMin, armMax) - tw.armY;
      if (Math.abs(tw.armVel) > 1) {
        if (Math.sign(diff) === Math.sign(tw.armVel) && Math.abs(diff) > Math.abs(tw.armVel) / 16 + 0.3) inp[diff > 0 ? 'down' : 'up'] = true;
      } else if (Math.abs(diff) > 3.5) inp[diff > 0 ? 'down' : 'up'] = true;
      if (b.state === 'falling') {
        const err = b.vx - clamp(-(b.x - tw.cx) * 2.2, -60, 60);
        if (err > 1.5) inp.left = true;
        else if (err < -1.5) inp.right = true;
        if (tw.ready && tw.open >= 1 && !tw.closing && closeHeld === 0) {
          set('close', true);
          closeHeld = 4;
        }
      }
    }
    for (const k of ['left', 'right', 'up', 'down']) set(k, inp[k]);
  };
  requestAnimationFrame(tick);
}

const ff = (args) => {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
};

const { server, url } = await startServer({ port: 0, quiet: true, routes: { '/__host/': join(REPO, 'scripts/fixtures/embed-host.html') } });
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
const external = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && external.push(r.url()));
};

// 1. Cross-origin parent must be refused by frame-ancestors (only 'self' and X origins may frame the embed).
{
  const page = await browser.newPage();
  await page.setContent(`<iframe src="${url}/embed/" width="480" height="480"></iframe>`);
  await page.waitForTimeout(1500);
  const child = page.frames()[1];
  const loaded = child ? await child.evaluate(() => !!document.getElementById('gl')).catch(() => false) : false;
  console.log(`${loaded ? 'FAIL' : 'ok  '} - cross-origin parent is blocked by frame-ancestors`);
  await page.close();
}

// 2. Real-time recording of the same-origin host page.
const videoDir = mkdtempSync(join(tmpdir(), 'embed-video-'));
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir: videoDir, size: VIEW } });
const page = await ctx.newPage();
watch(page);
const t0 = Date.now();
await page.goto(`${url}/__host/`);
const frame = page.frameLocator('#player');
await frame.locator('#play').waitFor();
const embed = page.frames().find((f) => f.url().endsWith('/embed/'));
await embed.waitForFunction(() => !!window.__game);
await page.waitForTimeout(2500);
const clickAt = (Date.now() - t0) / 1000;
await frame.locator('#play').click();
await embed.evaluate(autopilot, { armMin: ARM_MIN, armMax: ARM_MAX });
const samples = [];
const end = Date.now() + (SECONDS - 3) * 1000;
while (Date.now() < end) {
  await page.waitForTimeout(1000);
  samples.push(await embed.evaluate(() => ({ ...window.__quality, score: window.__game.score, stats: window.__game.stats, round: window.__game.round })));
}
await ctx.close();
const webm = join(videoDir, readdirSync(videoDir).find((f) => f.endsWith('.webm')));
const mp4 = join(OUT, 'embed-iframe-480.mp4');
const start = Math.max(0, clickAt - 2.2);
ff(['-ss', start.toFixed(2), '-i', webm, '-t', String(SECONDS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', mp4]);
rmSync(videoDir, { recursive: true, force: true });
const last = samples.at(-1);
console.log(`recorded ${mp4} (${(statSync(mp4).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  quality ${last.level} @ dpr ${last.dpr}, ~${last.fps.toFixed(0)} fps measured in-page; score ${last.score}, round ${last.round}, ${JSON.stringify(last.stats)}`);
console.log(`  fps per second: ${samples.map((s) => `${s.level[0]}${Math.round(s.fps)}`).join(' ')}`);

// 3. Standalone /embed/ screenshots mid-play with the on-screen controls visible. Stills are rendered at the
// 'high' quality level that GPU-equipped devices run; the video above shows auto-quality on SwiftShader.
async function shot(name, opts) {
  const c = await browser.newContext(opts);
  const p = await c.newPage();
  watch(p);
  await p.goto(`${url}/embed/?quality=high`);
  await p.waitForFunction(() => !!window.__game);
  await p.waitForTimeout(1500);
  if (opts.hasTouch) await p.tap('#play');
  else await p.click('#play');
  await p.evaluate(autopilot, { armMin: ARM_MIN, armMax: ARM_MAX });
  // Wait for the booster to be low and lit, close to the arms, so the shot shows the catch setup.
  await p.waitForFunction(() => {
    const g = window.__game;
    const b = g.phase === 'live' && g.activeBooster();
    return b && b.burning && g.altitudeM(b) < 70;
  }, null, { timeout: 60000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: join(OUT, name) });
  const box = await p.locator('#touch').boundingBox();
  const vh = opts.viewport.height;
  console.log(`saved ${name}: controls bottom edge at ${Math.round(box.y + box.height)} px of ${vh} (${(((box.y + box.height) / vh) * 100).toFixed(0)}%)`);
  await c.close();
}
await shot('embed-480x480.png', { viewport: { width: 480, height: 480 } });
await shot('embed-390x844.png', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

console.log(external.length ? `FAIL - external requests: ${external.join(', ')}` : 'ok   - no external network requests');
console.log(errors.length ? `FAIL - page errors: ${errors.join(' | ')}` : 'ok   - no page errors');
await browser.close();
server.close();
