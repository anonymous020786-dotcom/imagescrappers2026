// Renders the extension icons to PNG with no dependencies (node:zlib only).
// Usage: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
const SIZES = [16, 32, 48, 96, 128];

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shape test in unit coordinates (0..1). Returns [r,g,b,a] or null.
function shade(x, y) {
  const r = 0.2;
  const inRounded = (() => {
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  })();
  if (!inRounded) return null;
  // Background gradient: indigo → pink.
  const t = (x + y) / 2;
  let col = [91 + (255 - 91) * t * 0.7, 75 + (59 - 75) * t, 219 + (127 - 219) * t, 255];

  // Photo frame (white rounded rect outline + fill).
  const fx0 = 0.17, fy0 = 0.2, fx1 = 0.83, fy1 = 0.72;
  if (x >= fx0 && x <= fx1 && y >= fy0 && y <= fy1) {
    col = [255, 255, 255, 255];
    const ix0 = fx0 + 0.05, iy0 = fy0 + 0.05, ix1 = fx1 - 0.05, iy1 = fy1 - 0.05;
    if (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1) {
      col = [230, 234, 255, 255];
      // Sun.
      if ((x - 0.63) ** 2 + (y - 0.35) ** 2 < 0.055 ** 2) col = [255, 190, 60, 255];
      // Mountains.
      const m1 = iy1 - Math.max(0, 0.26 - Math.abs(x - 0.38) * 1.1);
      const m2 = iy1 - Math.max(0, 0.17 - Math.abs(x - 0.64) * 0.9);
      if (y >= m1) col = [91, 75, 219, 255];
      else if (y >= m2) col = [140, 125, 255, 255];
    }
  }
  // Download arrow below the frame.
  const ax = 0.5;
  if (Math.abs(x - ax) < 0.045 && y > 0.7 && y < 0.83) col = [255, 255, 255, 255];
  if (y >= 0.78 && y <= 0.9 && Math.abs(x - ax) <= (0.9 - y) * 1.1) col = [255, 255, 255, 255];
  return col;
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = ss * ss;
      const alpha = a / n;
      const i = (py * size + px) * 4;
      const cov = a / 255 || 1;
      buf[i] = Math.round(r / cov);
      buf[i + 1] = Math.round(g / cov);
      buf[i + 2] = Math.round(b / cov);
      buf[i + 3] = Math.round(alpha);
    }
  }
  writeFileSync(join(OUT, `icon${size}.png`), png(size, buf));
  console.log(`icon${size}.png`);
}
