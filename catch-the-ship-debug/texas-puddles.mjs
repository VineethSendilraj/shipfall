// Counts the puddles the near site map would hold (connected texels above the waterline) for a few settings.
import { hash01 } from '/Users/vsendilraj/dev/scratch/catch-the-ship-texas/src/rng.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hash2 = (i, j) => hash01(Math.imul(i, 374761393) ^ Math.imul(j, 668265263));
function vnoise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, octaves) {
  let s = 0;
  let w = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    s += w * vnoise2(x, y);
    total += w;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    w *= 0.5;
  }
  return s / total;
}
function polyDist(x, z, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const dx = pts[i][0] - ax;
    const dz = pts[i][1] - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
const boxDist = (x, z, [x0, z0, x1, z1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
const PAD = [-150, -108, 95, 40];
const ROAD = [[-2600, -395], [-280, -362], [180, -325], [420, -300], [900, -300], [1460, -320]];
const SPUR = [[-215, -366], [-190, -690]];
const [X0, Z0, SIZE, N] = [-900, -1500, 1800, 384];

function count({ amp, lo, hi, scale, oct, padIn, padOut }) {
  const w = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = X0 + ((i + 0.5) / N) * SIZE;
      const z = Z0 + ((j + 0.5) / N) * SIZE;
      const road = Math.min(polyDist(x, z, ROAD), polyDist(x, z, SPUR));
      const mask = Math.max(smooth(padOut, padIn, boxDist(x, z, PAD)), smooth(9, 5, road));
      if (mask <= 0) continue;
      w[j * N + i] = mask * amp * smooth(lo, hi, fbm(x / scale + 3, z / scale - 2, oct));
    }
  // Connected components above 0.5, split by where they are.
  const seen = new Uint8Array(N * N);
  const out = { pad: [], road: [] };
  for (let k = 0; k < N * N; k++) {
    if (seen[k] || w[k] <= 0.5) continue;
    const stack = [k];
    seen[k] = 1;
    let n = 0;
    let sx = 0;
    let sz = 0;
    while (stack.length) {
      const c = stack.pop();
      n++;
      const ci = c % N;
      const cj = (c / N) | 0;
      sx += X0 + ((ci + 0.5) / N) * SIZE;
      sz += Z0 + ((cj + 0.5) / N) * SIZE;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const q = nj * N + ni;
        if (!seen[q] && w[q] > 0.5) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    const cx = sx / n;
    const cz = sz / n;
    (boxDist(cx, cz, PAD) < 60 ? out.pad : out.road).push(n);
  }
  const texel = (SIZE / N) ** 2;
  const fmt = (a) => `${a.length} puddles, texels ${a.sort((p, q) => q - p).slice(0, 12).join(' ')}${a.length > 12 ? ' ...' : ''} (${Math.round(a.reduce((s, v) => s + v, 0) * texel)} m2)`;
  return `pad: ${fmt(out.pad)} | roads: ${fmt(out.road)}`;
}

const base = { amp: 0.56, lo: 0.7, hi: 0.8, scale: 20, oct: 2, padIn: 15, padOut: 40 };
for (const v of [
  base,
  { ...base, lo: 0.62, hi: 0.72 },
  { ...base, lo: 0.6, hi: 0.7, amp: 0.6 },
  { ...base, lo: 0.58, hi: 0.68, amp: 0.6, scale: 16 },
  { ...base, lo: 0.6, hi: 0.68, amp: 0.62, scale: 14 },
]) console.log(JSON.stringify(v), '\n  ', count(v));
