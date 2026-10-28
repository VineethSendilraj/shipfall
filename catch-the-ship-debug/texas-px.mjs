// Mean sRGB colour of rectangles in an image (JPEG/PNG through ffmpeg, or raw rgb24 with its size), and the
// linear HDR colour that AgX would turn into it.
// Usage: node texas-px.mjs <img> <w> <h> x0,y0,x1,y1[:label] ...
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inverse } from './texas-agx.mjs';

const [file, w, h, ...rects] = process.argv.slice(2);
const W = Number(w);
const buf = file.endsWith('.rgb') ? readFileSync(file) : execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
if (buf.length !== W * Number(h) * 3) throw new Error(`size mismatch: ${buf.length} bytes for ${w}x${h}`);
for (const r of rects) {
  const [box, label = ''] = r.split(':');
  const [x0, y0, x1, y1] = box.split(',').map(Number);
  const s = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * 3;
      s[0] += buf[o];
      s[1] += buf[o + 1];
      s[2] += buf[o + 2];
      n++;
    }
  }
  const m = s.map((v) => Math.round(v / n));
  const lin = inverse(m).map((v) => v.toFixed(3));
  console.log(`${label.padEnd(14)} srgb ${m.join(',').padEnd(12)} linear ${lin.join(', ')}`);
}
