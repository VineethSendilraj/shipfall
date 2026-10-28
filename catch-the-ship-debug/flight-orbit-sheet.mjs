// Contact sheet of screenshots, for a quick look at a whole set.
// Usage: node flight-orbit-sheet.mjs <out.jpg> <cols> <tile px> <img>...
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [out, cols, tile, ...imgs] = process.argv.slice(2);
const rows = Math.ceil(imgs.length / Number(cols));
const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${tile}px);gap:4px">${imgs
  .map((p) => `<div style="position:relative"><img src="file://${p}" style="width:${tile}px;display:block"><span style="position:absolute;left:4px;top:2px;color:#ff0;font:12px sans-serif">${p.split('/').pop()}</span></div>`)
  .join('')}</body>`;
writeFileSync('/tmp/flight-orbit-sheet.html', html);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: Number(cols) * (Number(tile) + 4), height: 200 } });
await page.goto('file:///tmp/flight-orbit-sheet.html', { waitUntil: 'load' });
await page.screenshot({ path: out, type: 'jpeg', quality: 85, fullPage: true });
await browser.close();
console.log(out, rows, 'rows');
