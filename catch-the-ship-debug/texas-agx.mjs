// AgX (three.js r186) forward map at exposure 1.15, and its numeric inverse: which linear HDR colour
// comes out as a given sRGB colour on screen. Usage: node texas-agx.mjs fwd r g b | inv R G B (0-255)
const EXP = 1.15;
const mul = (m, v) => [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]);
const S2R = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.088], [0.0433, 0.0113, 0.8956]];
const R2S = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const INSET = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const OUTSET = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
const MIN = -12.47393;
const MAX = 4.026069;
const sig = (x) => 15.5 * x ** 6 - 40.14 * x ** 5 + 31.96 * x ** 4 - 6.868 * x ** 3 + 0.4298 * x ** 2 + 0.1191 * x - 0.00232;
const oetf = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function agx(lin) {
  let c = lin.map((v) => v * EXP);
  c = mul(INSET, mul(S2R, c));
  c = c.map((v) => Math.min(1, Math.max(0, (Math.log2(Math.max(v, 1e-10)) - MIN) / (MAX - MIN))));
  c = mul(OUTSET, c.map(sig)).map((v) => Math.max(0, v) ** 2.2);
  return mul(R2S, c).map((v) => Math.round(oetf(Math.min(1, Math.max(0, v))) * 255));
}
export function inverse(target) {
  let x = [0.2, 0.2, 0.2];
  for (let it = 0; it < 400; it++) {
    const y = agx(x);
    x = x.map((v, i) => Math.max(1e-5, v * ((target[i] + 1) / (y[i] + 1)) ** 1.5));
  }
  return x;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, ...v] = process.argv.slice(2);
  const nums = v.map(Number);
  if (mode === 'fwd') console.log(agx(nums).join(' '));
  else {
    const x = inverse(nums);
    const L = 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
    console.log(x.map((n) => n.toFixed(4)).join(' '), '-> back', agx(x).join(' '), 'lum', L.toFixed(3));
  }
}
