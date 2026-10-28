// Compares flash scans per segment: node explore-flash-cmp.mjs <tag> <tag> ...
import { readFileSync } from 'node:fs';

const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const tags = process.argv.slice(2);
const runs = tags.map((t) => JSON.parse(readFileSync(`${D}/explore-flash-${t}.json`)));
const seg = {};
runs.forEach((r, i) => {
  for (const e of r.events) {
    const s = (seg[e.label] ??= tags.map(() => ({ n: 0, top: 0 })))[i];
    s.n++;
    s.top = Math.max(s.top, e.amp);
  }
});
const rows = Object.entries(seg).sort((a, b) => b[1].reduce((m, x) => Math.max(m, x.n), 0) - a[1].reduce((m, x) => Math.max(m, x.n), 0));
console.log('segment'.padEnd(28), tags.map((t) => t.padStart(16)).join(''));
for (const [l, v] of rows) console.log(l.padEnd(28), v.map((x) => `${String(x.n).padStart(5)} ${x.top.toFixed(3)}`.padStart(16)).join(''));
console.log('total'.padEnd(28), runs.map((r) => `${String(r.events.length).padStart(5)} ${Math.max(...r.events.map((e) => e.amp)).toFixed(3)}`.padStart(16)).join(''));
console.log('frames'.padEnd(28), runs.map((r) => String(r.frames).padStart(16)).join(''));
