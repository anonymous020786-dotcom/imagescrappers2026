// Image quality measurements that run on the device: sharpness, a brightness histogram and the way a file was
// encoded (estimated JPEG quality, progressive or baseline, chroma subsampling, PNG bit depth). Pure functions
// so they are unit-tested in Node; the dashboard passes them pixels from a canvas or the file's bytes.

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// Below this, an image (measured at up to 512 px) has little fine detail: it's probably blurry or soft.
export const BLURRY_BELOW = 60;

// Variance of the Laplacian of the grey image, the standard "is this photo in focus?" measure. Transparent
// pixels count as white so cut-outs are judged on their content.
export function sharpness(rgba, width, height) {
  if (width < 3 || height < 3) return 0;
  const g = new Float32Array(width * height);
  for (let p = 0, i = 0; p < g.length; p++, i += 4) {
    const a = rgba[i + 3] / 255;
    g[p] = luma(rgba, i) * a + 255 * (1 - a);
  }
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const lap = 4 * g[p] - g[p - 1] - g[p + 1] - g[p - width] - g[p + width];
      sum += lap;
      sq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return Math.round(sq / n - mean * mean);
}

// Red, green, blue and brightness histograms (256 bins), with simple exposure statistics.
// Pixels that are mostly transparent are left out.
export function histogram(rgba) {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  let count = 0;
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    r[rgba[i]]++;
    g[rgba[i + 1]]++;
    b[rgba[i + 2]]++;
    const v = Math.round(luma(rgba, i));
    l[v]++;
    sum += v;
    sq += v * v;
    count++;
  }
  if (!count) return { r, g, b, l, count, mean: 0, contrast: 0, shadows: 0, highlights: 0, verdict: 'Fully transparent' };
  const mean = sum / count;
  const contrast = Math.sqrt(Math.max(0, sq / count - mean * mean));
  let shadows = 0;
  let highlights = 0;
  for (let v = 0; v <= 5; v++) shadows += l[v];
  for (let v = 250; v <= 255; v++) highlights += l[v];
  shadows /= count;
  highlights /= count;
  let verdict = 'Balanced exposure';
  if (shadows > 0.2 || mean < 60) verdict = 'Mostly dark: shadows may be clipped';
  else if (highlights > 0.2 || mean > 200) verdict = 'Mostly bright: highlights may be clipped';
  else if (contrast < 32) verdict = 'Low contrast';
  return { r, g, b, l, count, mean: Math.round(mean), contrast: Math.round(contrast), shadows, highlights, verdict };
}

// The IJG (libjpeg) quality-50 luminance table: every encoder scales it to reach a quality setting.
const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_SUM = STD_LUMA.reduce((a, b) => a + b, 0);

// Estimated quality (1–100) from a JPEG luminance quantization table, inverting libjpeg's scaling.
export function qualityFromTable(table) {
  const sum = table.reduce((a, b) => a + b, 0);
  const scale = (sum * 100) / STD_SUM;
  const q = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
  return Math.max(1, Math.min(100, Math.round(q)));
}

const SUBSAMPLING = { '1x1': '4:4:4', '2x1': '4:2:2', '1x2': '4:4:0', '2x2': '4:2:0', '4x1': '4:1:1' };
const PNG_COLOR = { 0: 'greyscale', 2: 'RGB', 3: 'palette', 4: 'greyscale + alpha', 6: 'RGBA' };

function jpegInfo(d) {
  const info = { format: 'jpeg', progressive: false, icc: false };
  let i = 2;
  while (i + 4 <= d.length) {
    if (d[i] !== 0xff) break;
    const marker = d[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (d[i + 2] << 8) | d[i + 3];
    const start = i + 4;
    const end = Math.min(d.length, i + 2 + len);
    if (marker === 0xdb) {
      // DQT: one or more tables, each 1 byte (precision + id) and 64 values of 8 or 16 bits.
      let p = start;
      while (p < end) {
        const precision = d[p] >> 4;
        const id = d[p] & 15;
        const size = precision ? 128 : 64;
        if (p + 1 + size > end) break;
        if (id === 0 && info.quality == null) {
          const table = [];
          for (let k = 0; k < 64; k++) table.push(precision ? (d[p + 1 + 2 * k] << 8) | d[p + 2 + 2 * k] : d[p + 1 + k]);
          info.quality = qualityFromTable(table);
        }
        p += 1 + size;
      }
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      info.progressive = marker === 0xc2;
      info.bitDepth = d[start];
      const components = d[start + 5];
      if (components === 1) info.subsampling = 'greyscale';
      else if (components >= 3) {
        const s = d[start + 7];
        info.subsampling = SUBSAMPLING[`${s >> 4}x${s & 15}`] ?? `${s >> 4}x${s & 15}`;
      }
    } else if (marker === 0xe2 && String.fromCharCode(...d.subarray(start, start + 11)) === 'ICC_PROFILE') {
      info.icc = true;
    } else if (marker === 0xda) {
      break; // image data follows
    }
    i = i + 2 + len;
  }
  return info;
}

function pngInfo(d) {
  const info = { format: 'png', bitDepth: d[24], colorType: PNG_COLOR[d[25]] ?? String(d[25]), interlaced: d[28] === 1, icc: false };
  let i = 8;
  while (i + 8 <= d.length) {
    const len = ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
    const type = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    if (type === 'iCCP') info.icc = true;
    if (type === 'IDAT' || type === 'IEND') break;
    i += 12 + len;
  }
  return info;
}

// How a JPEG or PNG file was encoded, from its bytes. Other formats return null.
export function encodingInfo(input) {
  const d = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (d.length > 3 && d[0] === 0xff && d[1] === 0xd8) return jpegInfo(d);
  if (d.length > 29 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return pngInfo(d);
  return null;
}

// One line for people: "quality ≈ 82 · progressive · 4:2:0".
export function describeEncoding(e) {
  if (!e) return '';
  if (e.format === 'jpeg') {
    return [e.quality != null ? `quality ≈ ${e.quality}` : '', e.progressive ? 'progressive' : 'baseline', e.subsampling, e.icc ? 'ICC profile' : '']
      .filter(Boolean)
      .join(' · ');
  }
  return [`${e.bitDepth}-bit ${e.colorType}`, e.interlaced ? 'interlaced' : '', e.icc ? 'ICC profile' : ''].filter(Boolean).join(' · ');
}
