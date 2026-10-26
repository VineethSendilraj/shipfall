// Records the deterministic ?demo=1 showcase to MP4 + GIF.
//
// Headless Chromium usually has no GPU, so WebGL runs on SwiftShader and cannot hold 60 fps in real time.
// Instead of screen-recording wall-clock time, we drive the demo frame by frame: each video frame advances
// the fixed-step simulation by exactly two 1/60 s steps, renders, and is screenshotted. The result plays
// back at real speed at 30 fps with no dropped or duplicated frames, identically on every run.
//
// Usage: npm run record [-- --out /opt/cursor/artifacts --qa 14]
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './serve.mjs';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const OUT = arg('out', '/opt/cursor/artifacts');
const QA = Number(arg('qa', 14));
const FPS = 30;
const STEPS_PER_FRAME = 60 / FPS;
const W = 1280;
const H = 720;
const DONE_TIMEOUT_MS = Number(arg('timeout', 45 * 60 * 1000));
// Sim frames (60 Hz) to save as cover stills.
const STILLS = { 'booster-still-approach': 352, 'booster-still-catch': 430, 'booster-still-double': 1478 };
const GL_ARGS = (process.env.CHROMIUM_ARGS || '--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist').split(' ').filter(Boolean);

mkdirSync(OUT, { recursive: true });
const mp4 = join(OUT, 'booster-demo.mp4');
const gif = join(OUT, 'booster-demo.gif');

function probeDuration(file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

function run(args) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

const { server, url } = await startServer({ port: 0, quiet: true });
const browser = await chromium.launch({ args: GL_ARGS });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[page error]', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));

const started = Date.now();
await page.goto(`${url}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });

const ff = spawn(
  ffmpegPath,
  ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', mp4],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const ffDone = new Promise((ok, fail) => ff.on('close', (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))));

let info = await page.evaluate(() => window.__advance(0));
let frames = 0;
const stillAt = new Map(Object.entries(STILLS).map(([k, f]) => [f, k]));
for (;;) {
  const png = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once('drain', ok));
  for (const [f, name] of stillAt) {
    if (info.frame >= f && info.frame < f + STEPS_PER_FRAME) writeFileSync(join(OUT, `${name}.png`), png);
  }
  frames++;
  if (frames % 60 === 0) {
    const el = (Date.now() - started) / 1000;
    console.log(`  frame ${frames} (sim ${info.frame}) · ${el.toFixed(0)} s elapsed`);
  }
  if (info.done) break;
  if (Date.now() - started > DONE_TIMEOUT_MS) throw new Error('timed out waiting for window.__demoDone');
  info = await page.evaluate((n) => window.__advance(n), STEPS_PER_FRAME);
}
ff.stdin.end();
await ffDone;

const demoDone = await page.evaluate(() => window.__demoDone === true);
const demoInfo = await page.evaluate(() => window.__demoInfo);
await context.close();
await browser.close();
server.close();

// GIF: 12 fps, 640 px wide, palette pass. Fall back to fewer colors if it is too large.
// Camera motion changes most pixels every frame, so size is governed by noise; step down gently.
for (const [pre, colors, dither] of [
  ['', 160, 'bayer:bayer_scale=4'],
  ['hqdn3d=3:3:6:6,', 96, 'bayer:bayer_scale=5'],
  ['hqdn3d=5:4:8:8,gblur=sigma=0.5,', 64, 'bayer:bayer_scale=5'],
  ['hqdn3d=5:4:8:8,gblur=sigma=0.6,', 48, 'none'],
]) {
  run(['-i', mp4, '-vf', `fps=12,scale=640:-1:flags=lanczos,${pre}split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`, '-loop', '0', gif]);
  if (statSync(gif).size < 14.5 * 1024 * 1024) break;
}

// Evenly spaced QA frames from the final MP4.
const dur = probeDuration(mp4);
if (QA > 0) {
  const qaDir = join(OUT, 'qa-frames');
  rmSync(qaDir, { recursive: true, force: true });
  mkdirSync(qaDir, { recursive: true });
  for (let i = 0; i < QA; i++) {
    const t = (dur * (i + 0.5)) / QA;
    run(['-ss', t.toFixed(3), '-i', mp4, '-frames:v', '1', join(qaDir, `qa-${String(i + 1).padStart(2, '0')}-${t.toFixed(1)}s.png`)]);
  }
}

console.log(`\nwindow.__demoDone = ${demoDone}; captured ${frames} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`final score on end card: ${demoInfo.score.toLocaleString('en-US')} (${JSON.stringify(demoInfo.stats)})`);
console.log(`${mp4}  ${dur.toFixed(2)} s  ${(statSync(mp4).size / 1e6).toFixed(1)} MB  (${W}x${H}, H.264 yuv420p, ${FPS} fps)`);
console.log(`${gif}  ${probeDuration(gif).toFixed(2)} s  ${(statSync(gif).size / 1e6).toFixed(1)} MB  (640 px, 12 fps)`);
for (const name of Object.keys(STILLS)) console.log(join(OUT, `${name}.png`));
if (QA > 0) console.log(`${join(OUT, 'qa-frames')}/ (${QA} QA frames)`);
