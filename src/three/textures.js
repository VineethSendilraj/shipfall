import * as THREE from 'three';
import { createRng, hash01 } from '../rng.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  } else {
    t.wrapS = THREE.RepeatWrapping;
  }
  return t;
}

export function concrete() {
  const S = 1024;
  const rng = createRng(31);
  const [c, g] = makeCanvas(S, S);
  const [rc, rg] = makeCanvas(S / 2, S / 2);
  g.fillStyle = '#6d6c68';
  g.fillRect(0, 0, S, S);
  rg.fillStyle = 'rgb(205,205,205)';
  rg.fillRect(0, 0, S / 2, S / 2);
  for (let i = 0; i < 9000; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(0.5, 3);
    const l = rng.range(60, 140);
    g.fillStyle = `rgba(${l},${l},${l - 4},${rng.range(0.05, 0.25)})`;
    g.fillRect(x, y, r, r);
  }
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(30, 160);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng.chance(0.6);
    gr.addColorStop(0, dark ? `rgba(30,28,26,${rng.range(0.1, 0.3)})` : `rgba(150,148,140,${rng.range(0.05, 0.15)})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    if (dark) {
      const rr = rg.createRadialGradient(x / 2, y / 2, 0, x / 2, y / 2, r / 2);
      rr.addColorStop(0, `rgba(70,70,70,${rng.range(0.4, 0.8)})`);
      rr.addColorStop(1, 'rgba(70,70,70,0)');
      rg.fillStyle = rr;
      rg.fillRect(x / 2 - r / 2, y / 2 - r / 2, r, r);
    }
  }
  g.fillStyle = 'rgba(35,34,32,0.8)';
  for (const p of [0, S / 2]) {
    g.fillRect(p, 0, 3, S);
    g.fillRect(0, p, S, 3);
  }
  return { map: toTexture(c, { repeat: [1, 1] }), roughnessMap: toTexture(rc, { srgb: false, repeat: [1, 1] }) };
}

/** Width of the outbuilding atlas in meters of wall: u wraps every ATLAS_M meters. */
export const ATLAS_M = 8;
const ATLAS_W = 512;
const ATLAS_H = 1024;
// Horizontal bands of the atlas, as [first, last) canvas rows. Neighbours are chosen so the colours that bleed
// together in the small mip levels are alike.
const ATLAS_ROWS = {
  roof: [0, 64],
  wallA: [64, 352],
  concrete: [352, 400],
  trim: [400, 448],
  wallB: [448, 736],
  dark: [736, 784],
  doorTall: [784, 896],
  doorShort: [896, 960],
  window: [960, 1024],
};
/** Each band's texture v range [bottom, top], inset half a texel. */
export const ATLAS_BANDS = Object.fromEntries(Object.entries(ATLAS_ROWS).map(([k, [r0, r1]]) => [k, [1 - (r1 - 0.5) / ATLAS_H, 1 - (r0 + 0.5) / ATLAS_H]]));

/**
 * Outbuilding atlas: ribbed wall cladding (two tints) streaked with grime toward the foot, roll-up doors
 * (tall Mega Bay slats and short shop doors), a window band, roof, trim, concrete and dark steel. Every band
 * tiles along u; walls and doors stretch over v. Colour at 512 x 1024, roughness at half that.
 */
export function outbuildingAtlas() {
  const rng = createRng(1213);
  const [c, g] = makeCanvas(ATLAS_W, ATLAS_H);
  const [rc, rg] = makeCanvas(ATLAS_W / 2, ATLAS_H / 2);
  rg.scale(0.5, 0.5);
  const band = (k, color, rough) => {
    const [r0, r1] = ATLAS_ROWS[k];
    g.fillStyle = color;
    g.fillRect(0, r0, ATLAS_W, r1 - r0);
    rg.fillStyle = `rgb(${rough},${rough},${rough})`;
    rg.fillRect(0, r0, ATLAS_W, r1 - r0);
    return [r0, r1];
  };
  const lines = (ctx, style, r0, r1, every, width, vertical) => {
    ctx.fillStyle = style;
    if (vertical) for (let x = 0; x < ATLAS_W; x += every) ctx.fillRect(x, r0, width, r1 - r0);
    else for (let y = r0; y < r1; y += every) ctx.fillRect(0, y, ATLAS_W, width);
  };

  for (const [k, base] of [
    ['wallA', [184, 183, 178]],
    ['wallB', [168, 172, 174]],
  ]) {
    const [r0, r1] = band(k, `rgb(${base})`, 150);
    const h = r1 - r0;
    // Trapezoidal ribs every 0.5 m: a lit crest, a shaded web, a flat pan.
    for (let x = 0; x < ATLAS_W; x += 32) {
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.fillRect(x, r0, 10, h);
      g.fillStyle = 'rgba(20,22,26,0.2)';
      g.fillRect(x + 10, r0, 4, h);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(x + 28, r0, 4, h);
    }
    lines(g, 'rgba(30,30,32,0.35)', r0, r1, ATLAS_W, 2, true);
    // Grime streaks running down from the roof line and from midway, and a dirty foot.
    for (let i = 0; i < 70; i++) {
      const x = rng.range(0, ATLAS_W);
      const w = rng.range(2, 14);
      const y0 = r0 + (rng.chance(0.5) ? 0 : rng.range(0.2, 0.6) * h);
      const gr = g.createLinearGradient(0, y0, 0, r1);
      gr.addColorStop(0, `rgba(78,72,62,${rng.range(0.06, 0.16)})`);
      gr.addColorStop(1, 'rgba(78,72,62,0)');
      g.fillStyle = gr;
      g.fillRect(x, y0, w, r1 - y0);
      rg.fillStyle = 'rgba(230,230,230,0.25)';
      rg.fillRect(x, y0, w, (r1 - y0) * 0.6);
    }
    const foot = g.createLinearGradient(0, r0 + h * 0.6, 0, r1);
    foot.addColorStop(0, 'rgba(92,80,62,0)');
    foot.addColorStop(1, 'rgba(92,80,62,0.45)');
    g.fillStyle = foot;
    g.fillRect(0, r0 + h * 0.6, ATLAS_W, h * 0.4);
    g.fillStyle = 'rgba(60,58,54,0.25)';
    g.fillRect(0, r0, ATLAS_W, 4);
  }

  // Roll-up doors: horizontal slats, a little lighter than the cladding so the slot reads from afar.
  for (const k of ['doorTall', 'doorShort']) {
    const [r0, r1] = band(k, 'rgb(150,154,157)', 110);
    lines(g, 'rgba(40,42,46,0.4)', r0, r1, 4, 1, false);
    const gr = g.createLinearGradient(0, r0, 0, r1);
    gr.addColorStop(0, 'rgba(255,255,255,0.06)');
    gr.addColorStop(1, 'rgba(70,62,50,0.25)');
    g.fillStyle = gr;
    g.fillRect(0, r0, ATLAS_W, r1 - r0);
  }

  // Dark glazing with a mullion every 2 m.
  const [w0, w1] = band('window', 'rgb(34,42,54)', 40);
  lines(g, 'rgb(150,154,158)', w0, w1, 128, 6, true);
  lines(rg, 'rgb(150,150,150)', w0, w1, 128, 6, true);

  const [f0, f1] = band('roof', 'rgb(146,146,143)', 200);
  lines(g, 'rgba(255,255,255,0.12)', f0, f1, 32, 3, true);
  band('trim', 'rgb(206,206,202)', 140);
  band('concrete', 'rgb(124,121,114)', 240);
  band('dark', 'rgb(60,63,68)', 150);

  return { map: toTexture(c), roughnessMap: toTexture(rc, { srgb: false }) };
}

/** Tileable value noise on a period x period lattice; sample with lattice coordinates (wraps). */
function periodicNoise(rng, period) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (u, v) => {
    const x = Math.floor(u);
    const y = Math.floor(v);
    const fx = u - x;
    const fy = v - y;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((x % period) + period) % period;
    const y0 = ((y % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0];
    const b = g[y0 * period + x1];
    const c = g[y1 * period + x0];
    const d = g[y1 * period + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Writes a tangent-space normal map (OpenGL convention) from a wrapped height field. */
function normalsFromHeight(H, N, strength) {
  const [c, g] = makeCanvas(N, N);
  const img = g.createImageData(N, N);
  const d = img.data;
  for (let y = 0; y < N; y++) {
    const yu = ((y - 1 + N) % N) * N;
    const yd = ((y + 1) % N) * N;
    for (let x = 0; x < N; x++) {
      const xl = (x - 1 + N) % N;
      const xr = (x + 1) % N;
      const dx = (H[y * N + xr] - H[y * N + xl]) * strength;
      // Canvas rows run top-down while texture v runs bottom-up, so the v slope flips sign.
      const dy = (H[yu + x] - H[yd + x]) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      d[o] = (-dx / l) * 127.5 + 127.5;
      d[o + 1] = (-dy / l) * 127.5 + 127.5;
      d[o + 2] = (1 / l) * 127.5 + 127.5;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Martian regolith, one 512 px tile (meant for ~16 m): rust dust with darker basalt patches, small craters,
 * scattered rocks and pebbles, and wind ripples in the dust. Returns colour, normal and roughness maps.
 */
export function regolith() {
  const N = 512;
  const rng = createRng(1977);
  const H = new Float32Array(N * N);
  const tone = new Float32Array(N * N);
  const rough = new Float32Array(N * N).fill(0.95);
  const octaves = [4, 8, 16, 32, 64].map((p) => [periodicNoise(rng, p), p]);
  const patch = periodicNoise(rng, 3);
  const ripMask = periodicNoise(rng, 5);
  const ripWarp = periodicNoise(rng, 12);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      let h = 0;
      let a = 0.5;
      for (const [n, p] of octaves) {
        h += a * n(u * p, v * p);
        a *= 0.5;
      }
      const i = y * N + x;
      // Wind ripples: crests across the prevailing wind, only where loose dust collects.
      const m = Math.max(0, Math.min(1, (ripMask(u * 5, v * 5) - 0.5) * 4));
      const rip = Math.sin((u * 0.8 + v * 0.6) * Math.PI * 2 * 38 + ripWarp(u * 12, v * 12) * 6) * m;
      // Heights are in texels (~3 cm), so the normal map below uses true slopes.
      H[i] = h * 6 + rip * 0.6;
      tone[i] = (patch(u * 3, v * 3) - 0.5) * 0.9 + (h - 0.5) * 0.5 + rip * 0.05;
    }
  }
  const stamp = (cx, cy, R, fn) => {
    const r = Math.ceil(R);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const q = Math.hypot(dx, dy) / R;
        if (q > 1) continue;
        const x = (((Math.round(cx) + dx) % N) + N) % N;
        const y = (((Math.round(cy) + dy) % N) + N) % N;
        fn(y * N + x, q, dx / R, dy / R);
      }
    }
  };
  // Small impact craters: a bowl, a raised rim and a faint bright ejecta skirt.
  for (let k = 0; k < 9; k++) {
    const R = rng.range(9, k < 2 ? 48 : 26);
    const depth = R * rng.range(0.25, 0.4);
    stamp(rng.range(0, N), rng.range(0, N), R * 1.9, (i, q) => {
      const d = q * 1.9;
      const bowl = d < 1 ? d * d - 1 : 0;
      const rim = 0.32 * Math.exp(-(((d - 1) / 0.22) ** 2));
      H[i] += depth * (bowl + rim);
      tone[i] += d < 1 ? -0.12 * (1 - d * d) : 0.1 * Math.exp(-(d - 1) / 0.4);
    });
  }
  // Rocks and pebbles: irregular dark stones, flat-lit on top.
  for (let k = 0; k < 1700; k++) {
    const big = k < 70;
    const R = big ? rng.range(4, 11) : rng.range(0.9, 3.2);
    const sq = rng.range(0.6, 1);
    const rot = rng.range(0, Math.PI);
    const tall = R * rng.range(0.45, 0.8);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    stamp(rng.range(0, N), rng.range(0, N), R, (i, q, ux, uy) => {
      const ex = (ux * cr + uy * sr) / sq;
      const ey = -ux * sr + uy * cr;
      const e = Math.hypot(ex, ey);
      if (e > 1) return;
      const bump = Math.sqrt(1 - e * e);
      H[i] += tall * bump;
      tone[i] = Math.min(tone[i], -0.55 + 0.3 * bump - (big ? 0.1 : 0));
      rough[i] = 0.78;
    });
  }
  // Colour: rust dust, darker basalt where tone is low, pale dust where it is high.
  const [c, g] = makeCanvas(N, N);
  const img = g.createImageData(N, N);
  const px = img.data;
  const dark = [92, 50, 34];
  const base = [156, 84, 50];
  const pale = [190, 118, 74];
  for (let i = 0; i < N * N; i++) {
    const t = Math.max(-1, Math.min(1, tone[i]));
    const s = 0.96 + rng.next() * 0.08;
    const [a, b, w] = t < 0 ? [base, dark, -t] : [base, pale, t];
    px[i * 4] = (a[0] + (b[0] - a[0]) * w) * s;
    px[i * 4 + 1] = (a[1] + (b[1] - a[1]) * w) * s;
    px[i * 4 + 2] = (a[2] + (b[2] - a[2]) * w) * s;
    px[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const [rc, rg] = makeCanvas(N, N);
  const rimg = rg.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = rough[i] * 255;
    rimg.data.set([v, v, v, 255], i * 4);
  }
  rg.putImageData(rimg, 0, 0);
  return {
    map: toTexture(c, { repeat: [1, 1] }),
    normalMap: toTexture(normalsFromHeight(H, N, 1), { srgb: false, repeat: [1, 1] }),
    roughnessMap: toTexture(rc, { srgb: false, repeat: [1, 1] }),
  };
}

/**
 * Sintered-regolith landing pad: hexagonal pavers with dark joints, per-paver tint and exhaust scorching.
 * The tile is 8 hexes wide and 14 rows tall, so it is 1024 x 1552 px; `aspect` is its height / width.
 */
export function hexPad() {
  const W = 1024;
  const n = 8;
  const m = 14;
  const s = W / (n * Math.sqrt(3));
  const Hh = Math.round(m * 1.5 * s);
  const rng = createRng(2033);
  const [c, g] = makeCanvas(W, Hh);
  const [rc, rg] = makeCanvas(W / 2, Hh / 2);
  g.fillStyle = '#6f5a51';
  g.fillRect(0, 0, W, Hh);
  // Dry sintered surface: rough everywhere (Starbase's wet-concrete sheen would look wrong on Mars).
  rg.fillStyle = 'rgb(235,235,235)';
  rg.fillRect(0, 0, W / 2, Hh / 2);
  const hex = (ctx, cx, cy, r) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  };
  // Per-paver tint, drawn wrapped so the tile repeats seamlessly.
  for (let row = -1; row <= m; row++) {
    for (let col = -1; col <= n; col++) {
      const cx = col * s * Math.sqrt(3) + (row % 2 ? (s * Math.sqrt(3)) / 2 : 0);
      const cy = row * 1.5 * s;
      const l = 0.86 + 0.24 * hash01(((((row % m) + m) % m) * 31 + (((col % n) + n) % n) * 7) * 97 + 11);
      g.fillStyle = `rgba(${Math.round(112 * l)},${Math.round(90 * l)},${Math.round(80 * l)},0.55)`;
      hex(g, cx, cy, s * 0.96);
      g.fill();
    }
  }
  for (let i = 0; i < 9000; i++) {
    const l = rng.range(50, 150);
    g.fillStyle = `rgba(${l},${l * 0.82},${l * 0.72},${rng.range(0.05, 0.2)})`;
    g.fillRect(rng.range(0, W), rng.range(0, Hh), rng.range(0.5, 3), rng.range(0.5, 3));
  }
  for (let i = 0; i < 46; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, Hh);
    const r = rng.range(40, 190);
    const dark = rng.chance(0.65);
    for (const [ox, oy] of [[0, 0], [W, 0], [-W, 0], [0, Hh], [0, -Hh]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, dark ? `rgba(28,22,20,${rng.range(0.12, 0.3)})` : `rgba(170,120,92,${rng.range(0.06, 0.14)})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
    if (dark) {
      const rr = rg.createRadialGradient(x / 2, y / 2, 0, x / 2, y / 2, r / 2);
      rr.addColorStop(0, `rgba(185,185,185,${rng.range(0.3, 0.6)})`);
      rr.addColorStop(1, 'rgba(185,185,185,0)');
      rg.fillStyle = rr;
      rg.fillRect(x / 2 - r / 2, y / 2 - r / 2, r, r);
    }
  }
  // Joints between the pavers.
  g.strokeStyle = 'rgba(30,24,22,0.85)';
  g.lineWidth = 3;
  rg.strokeStyle = 'rgb(255,255,255)';
  rg.lineWidth = 1.5;
  for (let row = -1; row <= m; row++) {
    for (let col = -1; col <= n; col++) {
      const cx = col * s * Math.sqrt(3) + (row % 2 ? (s * Math.sqrt(3)) / 2 : 0);
      const cy = row * 1.5 * s;
      hex(g, cx, cy, s);
      g.stroke();
      hex(rg, cx / 2, cy / 2, s / 2);
      rg.stroke();
    }
  }
  return { map: toTexture(c, { repeat: [1, 1] }), roughnessMap: toTexture(rc, { srgb: false, repeat: [1, 1] }), aspect: Hh / W };
}

/** Solar-array panel: dark blue cells on a thin silver grid inside a frame (one panel per texture). */
export function solarCells() {
  const [c, g] = makeCanvas(512, 256);
  g.fillStyle = '#c3c6cc';
  g.fillRect(0, 0, 512, 256);
  const gr = g.createLinearGradient(0, 0, 512, 256);
  gr.addColorStop(0, '#1d2b4d');
  gr.addColorStop(1, '#101a33');
  g.fillStyle = gr;
  g.fillRect(8, 8, 496, 240);
  g.strokeStyle = 'rgba(190,200,215,0.55)';
  g.lineWidth = 2;
  for (let i = 1; i < 12; i++) {
    g.beginPath();
    g.moveTo(8 + i * (496 / 12), 8);
    g.lineTo(8 + i * (496 / 12), 248);
    g.stroke();
  }
  for (let j = 1; j < 6; j++) {
    g.beginPath();
    g.moveTo(8, 8 + j * 40);
    g.lineTo(504, 8 + j * 40);
    g.stroke();
  }
  return toTexture(c, { repeat: [1, 1] });
}

/**
 * Tileable 256 px noise for smoke and fire puffs: R and G are value-noise fbm at two scales, B is "billow"
 * noise (|fbm| folded around its mean: round lobes split by sharp creases).
 */
export function puffNoise() {
  const N = 256;
  const rng = createRng(4711);
  const a = [4, 8, 16, 32].map((p) => [periodicNoise(rng, p), p]);
  const b = [8, 16, 32, 64].map((p) => [periodicNoise(rng, p), p]);
  const c = [6, 12, 24, 48].map((p) => [periodicNoise(rng, p), p]);
  const data = new Uint8Array(N * N * 4);
  const fbm = (oct, u, v) => {
    let s = 0;
    let w = 0.5;
    for (const [n, p] of oct) {
      s += w * n(u * p, v * p);
      w *= 0.5;
    }
    return s / 0.9375;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const o = (y * N + x) * 4;
      data[o] = fbm(a, u, v) * 255;
      data[o + 1] = fbm(b, u, v) * 255;
      data[o + 2] = Math.min(1, Math.abs(fbm(c, u, v) * 2 - 1) * 2.2) * 255;
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function softDisc() {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return toTexture(c);
}
