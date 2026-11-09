// BlurHash encoder (https://blurha.sh, MIT algorithm by Wolt): a short text that apps decode into a blurred
// placeholder while the real image loads. Pure, unit-tested in Node; the dashboard passes small RGBA samples.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

export function encode83(value, length) {
  let out = '';
  for (let i = 1; i <= length; i++) out += DIGITS[Math.floor(value / 83 ** (length - i)) % 83];
  return out;
}

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v) => {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? Math.trunc(c * 12.92 * 255 + 0.5) : Math.trunc((1.055 * c ** (1 / 2.4) - 0.055) * 255 + 0.5);
};
const signPow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

export function encodeBlurhash(rgba, width, height, xComponents = 4, yComponents = 3) {
  if (xComponents < 1 || xComponents > 9 || yComponents < 1 || yComponents > 9) throw new Error('BlurHash needs 1–9 components');
  if (rgba.length !== width * height * 4) throw new Error('Pixel data does not match the size');
  const linear = new Float32Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    linear[p * 3] = toLinear(rgba[p * 4]);
    linear[p * 3 + 1] = toLinear(rgba[p * 4 + 1]);
    linear[p * 3 + 2] = toLinear(rgba[p * 4 + 2]);
  }
  const factors = [];
  for (let j = 0; j < yComponents; j++) {
    for (let i = 0; i < xComponents; i++) {
      const norm = i === 0 && j === 0 ? 1 : 2;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < height; y++) {
        const cy = Math.cos((Math.PI * j * y) / height);
        for (let x = 0; x < width; x++) {
          const basis = norm * Math.cos((Math.PI * i * x) / width) * cy;
          const p = (y * width + x) * 3;
          r += basis * linear[p];
          g += basis * linear[p + 1];
          b += basis * linear[p + 2];
        }
      }
      const scale = 1 / (width * height);
      factors.push([r * scale, g * scale, b * scale]);
    }
  }
  const [dc, ...ac] = factors;
  let hash = encode83(xComponents - 1 + (yComponents - 1) * 9, 1);
  let maxValue = 1;
  if (ac.length) {
    const actualMax = Math.max(...ac.flat().map(Math.abs));
    const quantisedMax = Math.max(0, Math.min(82, Math.floor(actualMax * 166 - 0.5)));
    maxValue = (quantisedMax + 1) / 166;
    hash += encode83(quantisedMax, 1);
  } else {
    hash += encode83(0, 1);
  }
  hash += encode83((toSrgb(dc[0]) << 16) + (toSrgb(dc[1]) << 8) + toSrgb(dc[2]), 4);
  for (const [r, g, b] of ac) {
    const q = (v) => Math.max(0, Math.min(18, Math.floor(signPow(v / maxValue, 0.5) * 9 + 9.5)));
    hash += encode83(q(r) * 19 * 19 + q(g) * 19 + q(b), 2);
  }
  return hash;
}

// The average colour of the pixels (ignoring transparency), as a CSS hex value for a plain placeholder.
export function averageColour(rgba) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
    n++;
  }
  if (!n) return 'transparent';
  const h = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
