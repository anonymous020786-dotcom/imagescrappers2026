// Image properties found by Analyze (animation, transparency) and helpers to sort by colour and compare images.
// Pure functions (bytes or pixel arrays in, plain values out) so they are unit-tested in Node.

const ascii = (b, at, s) => s.split('').every((c, i) => b[at + i] === c.charCodeAt(0));
const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// GIF: count image descriptors by walking the blocks (a frame count, not a byte search).
function gifFrames(b) {
  let p = 13;
  if (b[10] & 0x80) p += 3 * 2 ** ((b[10] & 0x07) + 1); // global colour table
  const skipSubBlocks = () => {
    while (p < b.length && b[p] !== 0) p += b[p] + 1;
    p++;
  };
  let frames = 0;
  while (p < b.length) {
    const block = b[p];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      p += 2; // extension introducer + label
      skipSubBlocks();
    } else if (block === 0x2c) {
      frames++;
      if (frames > 1) return frames;
      const packed = b[p + 9];
      p += 10;
      if (packed & 0x80) p += 3 * 2 ** ((packed & 0x07) + 1); // local colour table
      p++; // LZW minimum code size
      skipSubBlocks();
    } else break; // corrupt data: stop
  }
  return frames;
}

// True for animated GIF, APNG and animated WebP; false for still images and other formats.
export function isAnimated(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length >= 13 && ascii(b, 0, 'GIF8')) return gifFrames(b) > 1;
  if (b.length >= 8 && ascii(b, 0, '\x89PNG\r\n\x1a\n')) {
    // APNG: an acTL chunk with more than one frame, before the image data.
    for (let p = 8; p + 12 <= b.length; ) {
      const size = u32be(b, p);
      if (ascii(b, p + 4, 'acTL')) return u32be(b, p + 8) > 1;
      if (ascii(b, p + 4, 'IDAT') || ascii(b, p + 4, 'IEND')) return false;
      p += 12 + size;
    }
    return false;
  }
  if (b.length >= 21 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) {
    for (let p = 12; p + 8 <= b.length; ) {
      if (ascii(b, p, 'VP8X')) return Boolean(b[p + 8] & 0x02); // animation flag
      if (ascii(b, p, 'ANIM')) return true;
      p += 8 + u32le(b, p + 4) + (u32le(b, p + 4) & 1);
    }
  }
  return false;
}

// True when any pixel of RGBA data is not fully opaque (alpha below `threshold`).
export function hasTransparency(rgba, threshold = 250) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < threshold) return true;
  return false;
}

function hsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return { h, s, l };
}

// Sort key for "Sort by colour": hues around the colour wheel, then greys from dark to light, then unknown.
export function colorSortKey(hex) {
  const c = hsl(hex);
  if (!c) return 1000;
  if (c.s < 0.15 || c.l < 0.08 || c.l > 0.94) return 400 + c.l * 100;
  return c.h;
}

// How different two same-size RGBA images are: the share of pixels whose largest channel difference is above
// `tolerance`, and the mean difference (0–1). Used by "Compare".
export function pixelDifference(a, b, tolerance = 24) {
  if (a.length !== b.length || a.length % 4) throw new Error('Images must have the same size');
  let changed = 0;
  let sum = 0;
  const pixels = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
    if (d > tolerance) changed++;
    sum += d;
  }
  return { changed: pixels ? changed / pixels : 0, mean: pixels ? sum / pixels / 255 : 0 };
}
