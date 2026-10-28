// Writes scratch copies of sim.js with candidate round-window fixes into fuel-exp/<name>/.
// Usage: node fuel-variants.mjs <path to sim.js>
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const simPath = process.argv[2];
const src = readFileSync(simPath, 'utf8');
const IGNITE_OLD = 'if (!b.burning && !b.cutoff && alt <= BURN_ALT_M) {';
const FLOOR_OLD = 'hoverLen: Math.max(7, 22 - d * 2.2),';
if (!src.includes(IGNITE_OLD) || !src.includes(FLOOR_OLD)) throw new Error('sim.js no longer matches');

const variant = ({ aIgn, floor, vCap }) => {
  let s = src;
  if (aIgn) {
    s = s.replace('const A_MAX = 135;', `const A_MAX = 135;\nconst A_IGNITE = ${aIgn};`);
    s = s.replace(IGNITE_OLD, 'if (!b.burning && !b.cutoff && (alt <= BURN_ALT_M || b.vy * b.vy >= 2 * A_IGNITE * (b.zeroY - b.y))) {');
  }
  if (floor) s = s.replace(FLOOR_OLD, `hoverLen: Math.max(${floor}, 22 - d * 2.2),`);
  if (vCap) s = s.replace('vHover: Math.min(2.6, 1.3 + d * 0.17) * PX_PER_M,', `vHover: Math.min(${vCap}, 1.3 + d * 0.17) * PX_PER_M,`);
  return s;
};

const variants = {
  base: {},
  ign130f11c25: { aIgn: 130, floor: 11, vCap: 2.5 },
  ign125f11c25: { aIgn: 125, floor: 11, vCap: 2.5 },
  ign130f12: { aIgn: 130, floor: 12 },
};
for (const [name, v] of Object.entries(variants)) {
  const dir = join(here, 'fuel-exp', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sim.js'), variant(v));
  copyFileSync(join(dirname(simPath), 'rng.js'), join(dir, 'rng.js'));
  console.log(dir);
}
