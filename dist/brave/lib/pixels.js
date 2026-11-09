// Pixel tools for single images: trim borders, remove a solid background, split into tiles and lay out a
// presentation mockup. Pure functions on RGBA arrays and sizes, unit-tested in Node.

const diff = (d, i, r, g, b, a) => {
  // Two fully transparent pixels are the same whatever their colour.
  if (a === 0 && d[i + 3] === 0) return 0;
  return Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b), Math.abs(d[i + 3] - a));
};

// The box that remains after removing uniform borders the colour of the top-left pixel (or transparency).
// Returns null when the whole image is that colour.
export function trimBounds(rgba, width, height, tolerance = 12) {
  const [r, g, b, a] = rgba.subarray(0, 4);
  const rowIsBorder = (y) => {
    for (let x = 0; x < width; x++) if (diff(rgba, (y * width + x) * 4, r, g, b, a) > tolerance) return false;
    return true;
  };
  const colIsBorder = (x, top, bottom) => {
    for (let y = top; y <= bottom; y++) if (diff(rgba, (y * width + x) * 4, r, g, b, a) > tolerance) return false;
    return true;
  };
  let top = 0;
  while (top < height && rowIsBorder(top)) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (bottom > top && rowIsBorder(bottom)) bottom--;
  let left = 0;
  while (left < width && colIsBorder(left, top, bottom)) left++;
  let right = width - 1;
  while (right > left && colIsBorder(right, top, bottom)) right--;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

// The background colour: the corner colour shared by the most corners.
function backgroundColour(rgba, width, height, tolerance) {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((p) => [...rgba.subarray(p * 4, p * 4 + 4)]);
  let best = corners[0];
  let bestVotes = -1;
  for (const c of corners) {
    const votes = corners.filter((o) => Math.max(...o.map((v, k) => Math.abs(v - c[k]))) <= tolerance).length;
    if (votes > bestVotes) {
      best = c;
      bestVotes = votes;
    }
  }
  return best;
}

// Makes a solid background transparent: a flood fill from the edges through pixels close to the background
// colour, so the same colour inside the subject is kept. Edge pixels just over the tolerance are faded for a
// smooth outline. Changes `rgba` in place and returns how many pixels became fully transparent.
export function removeBackground(rgba, width, height, tolerance = 32) {
  const [r, g, b, a] = backgroundColour(rgba, width, height, tolerance);
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const push = (p) => {
    if (seen[p]) return;
    seen[p] = 1;
    if (diff(rgba, p * 4, r, g, b, a) <= tolerance) stack[top++] = p;
    else seen[p] = 2; // an outline pixel next to the background
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  let removed = 0;
  while (top) {
    const p = stack[--top];
    rgba[p * 4 + 3] = 0;
    removed++;
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < n - width) push(p + width);
  }
  // Feather: outline pixels within twice the tolerance become partly transparent.
  for (let p = 0; p < n; p++) {
    if (seen[p] !== 2) continue;
    const d = diff(rgba, p * 4, r, g, b, a);
    if (d < tolerance * 2) rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3] * ((d - tolerance) / tolerance));
  }
  return removed;
}

// Splits width×height into cols×rows tiles that cover every pixel (any remainder is spread evenly).
export function tileGrid(width, height, cols, rows) {
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    const y = Math.round((row * height) / rows);
    const h = Math.round(((row + 1) * height) / rows) - y;
    for (let col = 0; col < cols; col++) {
      const x = Math.round((col * width) / cols);
      const w = Math.round(((col + 1) * width) / cols) - x;
      tiles.push({ row, col, x, y, width: w, height: h });
    }
  }
  return tiles;
}

export const MOCKUP_BACKGROUNDS = {
  violet: ['#4459dc', '#b82a87'],
  ocean: ['#0ea5e9', '#2563eb'],
  sunset: ['#f97316', '#db2777'],
  mint: ['#34d399', '#0d9488'],
  light: ['#f4f4f8', '#e2e2ea'],
  dark: ['#1f2133', '#0b0c14'],
  none: null,
};

// Layout of a presentation image: the picture in a frame (optionally with a browser-window bar), centred on a
// background with padding. `padding` is a share of the longer side.
export function mockupLayout(width, height, { padding = 0.08, windowBar = false, radius = 12 } = {}) {
  const bar = windowBar ? Math.max(24, Math.round(width * 0.035)) : 0;
  const frameW = width;
  const frameH = height + bar;
  const pad = Math.round(Math.max(frameW, frameH) * Math.max(0, padding));
  return {
    width: frameW + pad * 2,
    height: frameH + pad * 2,
    frame: { x: pad, y: pad, width: frameW, height: frameH },
    image: { x: pad, y: pad + bar, width, height },
    bar,
    radius: Math.min(Math.max(0, radius), Math.floor(Math.min(frameW, frameH) / 2)),
  };
}
