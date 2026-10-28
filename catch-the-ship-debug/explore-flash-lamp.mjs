// Splits a lamp-on flash scan against its lamp-off control (same deterministic path, so frames line up by index):
// per-segment counts, and the flagged frames only the lamp run has. With a dump dir (explore-flash.mjs DUMP=),
// renders contact sheets of those frames' crops there, 12 to a sheet, in headless Chrome.
// Usage: node explore-flash-lamp.mjs <onTag> <offTag> [dumpDir]
import { readFileSync, writeFileSync } from 'node:fs';

const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const [onTag, offTag, dumpDir] = process.argv.slice(2);
const load = (t) => JSON.parse(readFileSync(`${D}/explore-flash-${t}.json`));
const on = load(onTag);
const off = load(offTag);
if (on.frames !== off.frames) console.log(`frame counts differ: ${on.frames} vs ${off.frames}; matching by index is off`);
const offF = new Set(off.events.map((e) => e.f));
const onF = new Set(on.events.map((e) => e.f));
const lampOnly = on.events.filter((e) => !offF.has(e.f)).sort((a, b) => a.f - b.f);
const offOnly = off.events.filter((e) => !onF.has(e.f));
const seg = {};
for (const [i, r] of [on, off].entries()) for (const e of r.events) (seg[e.label] ??= [0, 0, 0])[i]++;
for (const e of lampOnly) seg[e.label][2]++;
console.log('segment'.padEnd(28), 'on'.padStart(5), 'off'.padStart(5), 'net'.padStart(5), 'onlyOn'.padStart(7));
for (const [l, [a, b, c]] of Object.entries(seg).sort((x, y) => y[1][0] - y[1][1] - (x[1][0] - x[1][1])))
  console.log(l.padEnd(28), String(a).padStart(5), String(b).padStart(5), String(a - b).padStart(5), String(c).padStart(7));
console.log(
  `total: on ${on.events.length}, off ${off.events.length}, net ${on.events.length - off.events.length};`,
  `frames only the lamp run flags ${lampOnly.length}, only the control flags ${offOnly.length}`,
);
console.log('lamp-only frames:', lampOnly.map((e) => `${e.f}(${e.cell.x},${e.cell.y} ${e.amp})`).join(' '));

if (dumpDir) {
  const { chromium } = await import('/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1640, height: 1300 } });
  // SKIP=<regex> leaves matching segments out of the sheets; FRAMES=<f,f,...> shows only those frames.
  const pick = process.env.FRAMES?.split(',').map(Number);
  const shown = lampOnly.filter((e) => (!process.env.SKIP || !new RegExp(process.env.SKIP).test(e.label)) && (!pick || pick.includes(e.f)));
  for (let s = 0; s * 12 < shown.length; s++) {
    const cells = shown.slice(s * 12, s * 12 + 12).map((e) => {
      const src = `data:image/jpeg;base64,${readFileSync(`${dumpDir}/${onTag}-f${e.f}.jpg`).toString('base64')}`;
      return `<figure><img src="${src}"><figcaption>f${e.f} ${e.label} cell ${e.cell.x},${e.cell.y} amp ${e.amp} n ${e.n}</figcaption></figure>`;
    });
    await page.setContent(`<style>body{margin:0;background:#111;color:#ddd;font:13px sans-serif;display:grid;grid-template-columns:800px 800px;align-content:start;gap:8px 16px;padding:8px}figure{margin:0}img{display:block}</style>${cells.join('')}`);
    const out = `${dumpDir}/${onTag}-lamp-only-${s + 1}.jpg`;
    await page.screenshot({ path: out, type: 'jpeg', quality: 88, fullPage: true });
    console.log('sheet', out);
  }
  await browser.close();
}
