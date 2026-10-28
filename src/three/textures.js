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
