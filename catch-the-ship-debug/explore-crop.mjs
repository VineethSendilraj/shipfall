// Crops rows out of a spike sheet: node explore-crop.mjs <in.jpg> <out.jpg> <rowHeight> <row> [row ...]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [src, dst, rowH, ...rows] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const url = await page.evaluate(async ({ data, rowH, rows }) => {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${data}`;
  await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: rowH * rows.length });
  rows.forEach((r, i) => c.getContext('2d').drawImage(img, 0, r * rowH, img.width, rowH, 0, i * rowH, img.width, rowH));
  return c.toDataURL('image/jpeg', 0.9);
}, { data: readFileSync(src).toString('base64'), rowH: Number(rowH), rows: rows.map(Number) });
writeFileSync(dst, Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
