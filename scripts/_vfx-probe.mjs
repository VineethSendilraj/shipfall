// Temporary probe: flash scan, frame captures and render cost. Usage:
//   node scripts/_vfx-probe.mjs scan <port> <out.json> [query]
//   node scripts/_vfx-probe.mjs shots <port> <outdir> <tag>
//   node scripts/_vfx-probe.mjs cost <port>
//   node scripts/_vfx-probe.mjs frame <port> <frame> <out.jpg> [query] [w] [h] [path]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const [mode, port, ...rest] = process.argv.slice(2);
const base = `http://localhost:${port}`;
const launch = (extra = []) =>
  chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', ...extra] });

async function openDemo(browser, { path = '/', query = '', w = 1280, h = 720 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}${path}?demo=1&capture=1${query}`);
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
  return page;
}

async function stepTo(page, target) {
  const cur = await page.evaluate(() => window.__demoFrame);
  const skip = target - cur - 3;
  if (skip > 0) await page.evaluate((n) => window.__advance(n, false), skip);
  while ((await page.evaluate(() => window.__demoFrame)) < target) await page.evaluate(() => window.__advance(1, true));
}

const shot = (page, file) => page.screenshot({ path: file, type: 'jpeg', quality: 90, timeout: 120000 });

if (mode === 'scan') {
  const [out, query = ''] = rest;
  const browser = await launch();
  const page = await openDemo(browser, { query });
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const g = c.getContext('2d', { willReadFrequently: true });
    window.__grid = () => {
      g.drawImage(document.getElementById('gl'), 0, 0, 640, 360);
      const d = g.getImageData(0, 0, 640, 360).data;
      const cells = new Float32Array(144);
      for (let y = 0; y < 360; y++) {
        for (let x = 0; x < 640; x++) {
          const i = (y * 640 + x) * 4;
          cells[Math.floor(y / 40) * 16 + Math.floor(x / 40)] += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        }
      }
      return Array.from(cells, (v) => v / 1600);
    };
  });
  const frames = [];
  for (;;) {
    const r = await page.evaluate(() => {
      const s = window.__advance(1, true);
      return { frame: window.__demoFrame, done: !!window.__demoDone, grid: window.__grid() };
    });
    frames.push(r);
    if (r.done) break;
  }
  const spikes = [];
  for (let i = 1; i + 1 < frames.length; i++) {
    for (let c = 0; c < 144; c++) {
      const a = frames[i - 1].grid[c];
      const b = frames[i].grid[c];
      const n = frames[i + 1].grid[c];
      if (b - a > 0.07 && b - n > 0.07) spikes.push({ frame: frames[i].frame, cell: [c % 16, Math.floor(c / 16)], prev: +a.toFixed(3), val: +b.toFixed(3), next: +n.toFixed(3) });
    }
  }
  writeFileSync(out, JSON.stringify({ frames: frames.length, spikes }, null, 1));
  console.log(`frames ${frames.length} spikes ${spikes.length}`);
  for (const s of spikes) console.log(JSON.stringify(s));
  await browser.close();
} else if (mode === 'frame') {
  const [frame, out, query = '', w = '1280', h = '720', path = '/'] = rest;
  const browser = await launch();
  const page = await openDemo(browser, { query, w: +w, h: +h, path });
  await stepTo(page, +frame);
  await shot(page, out);
  await browser.close();
} else if (mode === 'shots') {
  const [dir, tag] = rest;
  mkdirSync(dir, { recursive: true });
  const browser = await launch();
  const sets = [
    { name: 'wide', path: '/', query: '', w: 1280, h: 720, frames: [340, 1450] },
    { name: 'embed', path: '/embed/', query: '', w: 480, h: 480, frames: [340, 1450] },
    { name: 'tod19', path: '/', query: '&tod=19', w: 1280, h: 720, frames: [340, 1450] },
    { name: 'tod22', path: '/', query: '&tod=22', w: 1280, h: 720, frames: [1450] },
    { name: 'mars', path: '/', query: '&map=mars', w: 1280, h: 720, frames: [340, 1450] },
  ];
  for (const s of sets) {
    const page = await openDemo(browser, s);
    for (const f of s.frames) {
      await stepTo(page, f);
      await shot(page, `${dir}/${tag}-${s.name}-${f}.jpg`);
    }
    await page.close();
  }
  await browser.close();
} else if (mode === 'cost') {
  const browser = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await page.click('#play', { timeout: 120000 });
  await page.waitForTimeout(1500);
  const res = await page.evaluate(
    () =>
      new Promise((done) => {
        const wait = () => {
          const v = window.__view;
          if (!v) return setTimeout(wait, 100);
          const gl = v.renderer?.getContext?.() ?? document.getElementById('gl').getContext('webgl2');
          const px = new Uint8Array(4);
          const orig = v.render.bind(v);
          const times = [];
          v.render = (...a) => {
            const t0 = performance.now();
            const r = orig(...a);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            times.push(performance.now() - t0);
            return r;
          };
          setTimeout(() => {
            v.render = orig;
            times.sort((a, b) => a - b);
            const q = (p) => times[Math.floor(p * (times.length - 1))];
            done({ n: times.length, p50: q(0.5), p90: q(0.9) });
          }, 8000);
        };
        wait();
      }),
  );
  console.log(JSON.stringify(res));
  await browser.close();
}
