// Colour palette extraction (median cut) and export helpers. Pure functions (unit-tested).

const MAX_SAMPLES = 40000;

const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');
export const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function box(pixels) {
  let min = [255, 255, 255];
  let max = [0, 0, 0];
  for (const p of pixels) {
    for (let c = 0; c < 3; c++) {
      if (p[c] < min[c]) min[c] = p[c];
      if (p[c] > max[c]) max[c] = p[c];
    }
  }
  const ranges = [0, 1, 2].map((c) => max[c] - min[c]);
  const channel = ranges.indexOf(Math.max(...ranges));
  return { pixels, channel, range: ranges[channel] };
}

// rgba: RGBA bytes (e.g. ImageData.data). Returns up to `count` colours, most common first:
// [{ hex, rgb: [r, g, b], share }] where share is the fraction of opaque pixels (0..1).
export function extractPalette(rgba, count = 6) {
  const total = Math.floor(rgba.length / 4);
  const step = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const pixels = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue; // ignore transparent pixels
    pixels.push([rgba[o], rgba[o + 1], rgba[o + 2]]);
  }
  if (!pixels.length) return [];
  const boxes = [box(pixels)];
  while (boxes.length < count) {
    // Split the box with the widest colour range (weighted by how many pixels it holds).
    let best = -1;
    let score = 0;
    boxes.forEach((b, i) => {
      const s = b.range * Math.sqrt(b.pixels.length);
      if (b.pixels.length > 1 && b.range > 0 && s > score) {
        score = s;
        best = i;
      }
    });
    if (best < 0) break;
    const { pixels: px, channel } = boxes[best];
    px.sort((a, b) => a[channel] - b[channel]);
    // Cut near the median, but between two different values, so one colour is never split across boxes.
    const mid = px.length >> 1;
    const v = px[mid][channel];
    let lo = mid;
    while (lo > 0 && px[lo - 1][channel] === v) lo--;
    let hi = mid;
    while (hi < px.length && px[hi][channel] === v) hi++;
    const cut = lo > 0 && (hi >= px.length || mid - lo <= hi - mid) ? lo : hi;
    boxes.splice(best, 1, box(px.slice(0, cut)), box(px.slice(cut)));
  }
  const colours = boxes.map((b) => {
    const sum = [0, 0, 0];
    for (const p of b.pixels) for (let c = 0; c < 3; c++) sum[c] += p[c];
    const rgb = sum.map((v) => Math.round(v / b.pixels.length));
    return { rgb, hex: toHex(rgb), share: b.pixels.length / pixels.length };
  });
  // Merge colours that look the same (identical hex), then most common first.
  const merged = new Map();
  for (const c of colours) {
    const prev = merged.get(c.hex);
    if (prev) prev.share += c.share;
    else merged.set(c.hex, { ...c });
  }
  return [...merged.values()].sort((a, b) => b.share - a.share);
}

// Black or white, whichever reads better on the colour (WCAG relative luminance).
export function textColorFor([r, g, b]) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.179 ? '#000000' : '#ffffff';
}

export function paletteToCSS(colours, prefix = 'color') {
  return `:root {\n${colours.map((c, i) => `  --${prefix}-${i + 1}: ${c.hex};`).join('\n')}\n}\n`;
}
