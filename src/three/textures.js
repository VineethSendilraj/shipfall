import * as THREE from 'three';
import { createRng } from '../rng.js';

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

/** Stainless booster skin: rolled ring plates, weld seams, brushed streaks, engine soot near the base. */
export function boosterSkin() {
  const W = 1024;
  const H = 2048;
  const rng = createRng(77);
  const [c, g] = makeCanvas(W, H);
  const [rc, rg] = makeCanvas(W / 2, H / 2);
  const [bc, bg] = makeCanvas(W, H);
  bg.fillStyle = 'rgb(128,128,128)';
  bg.fillRect(0, 0, W, H);

  g.fillStyle = '#c4c8cd';
  g.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(78,78,78)';
  rg.fillRect(0, 0, W / 2, H / 2);

  const ringH = 52;
  for (let y = 0, i = 0; y < H; y += ringH, i++) {
    const l = rng.range(-5, 5);
    const warm = rng.range(-2, 2);
    g.fillStyle = `rgb(${196 + l + warm},${200 + l},${205 + l - warm})`;
    g.fillRect(0, y, W, ringH);
    const r = Math.round(rng.range(74, 90));
    rg.fillStyle = `rgb(${r},${r},${r})`;
    rg.fillRect(0, y / 2, W / 2, ringH / 2);
    const seamX = rng.range(0, W);
    g.fillStyle = 'rgba(70,72,76,0.55)';
    g.fillRect(seamX, y, 2, ringH);
    bg.fillStyle = 'rgb(176,176,176)';
    bg.fillRect(seamX - 1, y, 4, ringH);
  }
  for (let i = 0; i < 2600; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, H);
    const len = rng.range(30, 260);
    const a = rng.range(0.02, 0.07);
    g.fillStyle = rng.chance(0.5) ? `rgba(255,255,255,${a})` : `rgba(40,44,50,${a})`;
    g.fillRect(x, y, rng.range(0.6, 1.6), len);
  }
  for (let y = ringH; y < H; y += ringH) {
    g.fillStyle = 'rgba(60,62,66,0.75)';
    g.fillRect(0, y - 1, W, 2.5);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, y + 1.5, W, 1);
    rg.fillStyle = 'rgb(140,140,140)';
    rg.fillRect(0, y / 2 - 1, W / 2, 2);
    bg.fillStyle = 'rgb(190,190,190)';
    bg.fillRect(0, y - 2, W, 4);
    bg.fillStyle = 'rgb(150,150,150)';
    bg.fillRect(0, y - 4, W, 2);
    bg.fillRect(0, y + 2, W, 2);
  }

  // Engine soot: heavy at the base, streaking upward.
  const sootTop = H * 0.72;
  const grad = g.createLinearGradient(0, sootTop, 0, H);
  grad.addColorStop(0, 'rgba(30,24,20,0)');
  grad.addColorStop(0.55, 'rgba(34,27,22,0.55)');
  grad.addColorStop(1, 'rgba(18,14,12,0.94)');
  g.fillStyle = grad;
  g.fillRect(0, sootTop, W, H - sootTop);
  for (let i = 0; i < 420; i++) {
    const x = rng.range(0, W);
    const len = rng.range(60, 520);
    const w = rng.range(2, 14);
    const sg = g.createLinearGradient(0, H - len, 0, H);
    sg.addColorStop(0, 'rgba(25,20,16,0)');
    sg.addColorStop(1, `rgba(25,20,16,${rng.range(0.15, 0.5)})`);
    g.fillStyle = sg;
    g.fillRect(x, H - len, w, len);
  }
  const rgrad = rg.createLinearGradient(0, sootTop / 2, 0, H / 2);
  rgrad.addColorStop(0, 'rgba(200,200,200,0)');
  rgrad.addColorStop(1, 'rgba(210,210,210,1)');
  rg.fillStyle = rgrad;
  rg.fillRect(0, sootTop / 2, W / 2, (H - sootTop) / 2);

  return { map: toTexture(c), roughnessMap: toTexture(rc, { srgb: false }), bumpMap: toTexture(bc, { srgb: false }) };
}

/** Tileable launch-pad concrete with expansion joints and damp patches (low roughness = wet sheen). */
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
