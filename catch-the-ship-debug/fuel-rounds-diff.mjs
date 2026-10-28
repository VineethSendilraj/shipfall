// Per-spawn window changes between two fuel-rounds.mjs outputs. Usage: node fuel-rounds-diff.mjs <before.txt> <after.txt>
import { readFileSync } from 'node:fs';

const rows = (path) => JSON.parse(readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith('JSON ')).slice(5));
const [a, b] = process.argv.slice(2).map(rows);
for (let i = 0; i < a.length; i++) {
  const d = a[i].wins.map((w, k) => b[i].wins[k] - w);
  const up = d.filter((x) => x > 1e-9);
  const down = d.filter((x) => x < -1e-9);
  const fmt = (xs) => (xs.length ? `${xs.length} (max ${Math.max(...xs.map(Math.abs)).toFixed(2)} s)` : '0');
  console.log(`round ${a[i].round}: longer ${fmt(up)}, shorter ${fmt(down)}, same ${d.length - up.length - down.length}`);
}
