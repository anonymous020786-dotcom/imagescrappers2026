import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLURRY_BELOW, describeEncoding, encodingInfo, histogram, qualityFromTable, sharpness } from '../src/lib/quality.js';
import { mockupLayout, removeBackground, tileGrid, trimBounds } from '../src/lib/pixels.js';
import { packSprite, spriteCss, uniqueNames } from '../src/lib/sprite.js';
import { averageColour, encode83, encodeBlurhash } from '../src/lib/blurhash.js';
import { contrastRatio, toAse, toGpl, toTailwind, toTokens, wcag } from '../src/lib/colorx.js';
import { savingsSummary, savingsToCSV } from '../src/lib/reports.js';

const image = (w, h, fn) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4);
  return d;
};

test('sharpness: a checkerboard is sharp, a smooth gradient is not', () => {
  const sharp = image(64, 64, (x, y) => (((x >> 1) + (y >> 1)) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const soft = image(64, 64, (x) => [x * 4, x * 4, x * 4, 255]);
  assert.ok(sharpness(sharp, 64, 64) > 1000);
  assert.ok(sharpness(soft, 64, 64) < BLURRY_BELOW);
});

test('histogram: counts, exposure verdicts and transparent pixels left out', () => {
  const dark = histogram(image(10, 10, () => [2, 2, 2, 255]));
  assert.equal(dark.count, 100);
  assert.equal(dark.l[2], 100);
  assert.match(dark.verdict, /dark/);
  assert.match(histogram(image(10, 10, () => [254, 254, 254, 255])).verdict, /bright/);
  assert.match(histogram(image(10, 10, (x) => [100 + x, 100 + x, 100 + x, 255])).verdict, /Low contrast/);
  assert.match(histogram(image(10, 10, (x) => [x * 25, x * 25, x * 25, 255])).verdict, /Balanced/);
  assert.equal(histogram(image(4, 4, () => [0, 0, 0, 0])).count, 0);
});

test('JPEG quality is estimated from the quantization table', () => {
  const std = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  // libjpeg's own scaling for quality q.
  const scaled = (q) => std.map((v) => Math.min(255, Math.max(1, Math.floor((v * (q < 50 ? 5000 / q : 200 - q * 2) + 50) / 100))));
  for (const q of [30, 50, 75, 85, 95]) assert.ok(Math.abs(qualityFromTable(scaled(q)) - q) <= 1, `q${q} gave ${qualityFromTable(scaled(q))}`);
});

test('encodingInfo reads JPEG and PNG headers', () => {
  // A minimal progressive JPEG header: SOI, DQT (all 2s), SOF2 with 4:2:0 sampling, SOS.
  const dqt = [0xff, 0xdb, 0, 67, 0x00, ...new Array(64).fill(2)];
  const sof = [0xff, 0xc2, 0, 17, 8, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const jpeg = new Uint8Array([0xff, 0xd8, ...dqt, ...sof, 0xff, 0xda, 0, 2]);
  const j = encodingInfo(jpeg);
  assert.equal(j.format, 'jpeg');
  assert.equal(j.progressive, true);
  assert.equal(j.subsampling, '4:2:0');
  assert.ok(j.quality >= 95);
  assert.match(describeEncoding(j), /^quality ≈ \d+ · progressive · 4:2:0$/);
  const png = new Uint8Array(40);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4, 16, 6, 0, 0, 1]);
  assert.deepEqual({ ...encodingInfo(png) }, { format: 'png', bitDepth: 16, colorType: 'RGBA', interlaced: true, icc: false });
  assert.equal(describeEncoding(encodingInfo(png)), '16-bit RGBA · interlaced');
  assert.equal(encodingInfo(new Uint8Array([1, 2, 3])), null);
});

test('trimBounds finds the content inside a uniform border', () => {
  const d = image(20, 10, (x, y) => (x >= 5 && x < 12 && y >= 2 && y < 7 ? [200, 0, 0, 255] : [255, 255, 255, 255]));
  assert.deepEqual(trimBounds(d, 20, 10), { x: 5, y: 2, width: 7, height: 5 });
  assert.equal(trimBounds(image(4, 4, () => [9, 9, 9, 255]), 4, 4), null);
});

test('removeBackground clears the outer background but keeps the same colour inside the subject', () => {
  // White background, black ring, white centre (stays opaque: it is not connected to the edge).
  const d = image(9, 9, (x, y) => {
    const ring = x >= 2 && x <= 6 && y >= 2 && y <= 6 && !(x >= 3 && x <= 5 && y >= 3 && y <= 5);
    return ring ? [0, 0, 0, 255] : [255, 255, 255, 255];
  });
  assert.equal(removeBackground(d, 9, 9), 81 - 25);
  assert.equal(d[3], 0); // corner
  assert.equal(d[(4 * 9 + 4) * 4 + 3], 255); // centre
  assert.equal(d[(2 * 9 + 2) * 4 + 3], 255); // ring
});

test('tileGrid covers every pixel exactly once', () => {
  const tiles = tileGrid(1000, 333, 3, 2);
  assert.equal(tiles.length, 6);
  assert.equal(tiles.filter((t) => t.row === 0).reduce((s, t) => s + t.width, 0), 1000);
  assert.equal(tiles.filter((t) => t.col === 0).reduce((s, t) => s + t.height, 0), 333);
  assert.deepEqual(tiles[5], { row: 1, col: 2, x: 667, y: 167, width: 333, height: 166 });
});

test('mockupLayout pads the frame and adds the window bar above the image', () => {
  const m = mockupLayout(1000, 500, { padding: 0.1, windowBar: true, radius: 400 });
  assert.equal(m.bar, 35);
  assert.deepEqual(m.frame, { x: 100, y: 100, width: 1000, height: 535 });
  assert.deepEqual(m.image, { x: 100, y: 135, width: 1000, height: 500 });
  assert.equal(m.width, 1200);
  assert.equal(m.radius, 267);
});

test('packSprite places images without overlap and spriteCss writes offsets', () => {
  const items = [{ width: 100, height: 50 }, { width: 60, height: 80 }, { width: 120, height: 40 }, { width: 30, height: 30 }];
  const { width, height, positions } = packSprite(items, { padding: 2, maxWidth: 200 });
  for (let i = 0; i < positions.length; i++) {
    const a = positions[i];
    assert.ok(a.x + a.width <= width && a.y + a.height <= height);
    for (let j = i + 1; j < positions.length; j++) {
      const b = positions[j];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${i} overlaps ${j}`);
    }
  }
  assert.deepEqual(uniqueNames(['Logo.png', 'logo.svg', '1 photo.jpg', '***']), ['logo', 'logo-2', 'i-1-photo', 'image']);
  const css = spriteCss([{ name: 'logo', x: 10, y: 0, width: 5, height: 6 }], 'sprite.png', { width: 20, height: 6 });
  assert.match(css, /\.sprite-logo \{ width: 5px; height: 6px; background-position: -10px 0; \}/);
});

test('BlurHash: structure, and a solid colour encodes only its average', () => {
  const red = image(8, 8, () => [255, 0, 0, 255]);
  const hash = encodeBlurhash(red, 8, 8, 4, 3);
  assert.equal(hash.length, 4 + 2 * 4 * 3);
  assert.equal(hash[0], encode83(3 + 2 * 9, 1));
  assert.equal(hash.slice(2, 6), encode83(0xff0000, 4));
  assert.equal(averageColour(red), '#ff0000');
  assert.throws(() => encodeBlurhash(red, 8, 7));
});

test('WCAG contrast and palette exports', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#777777', '#ffffff'), 4.48);
  assert.deepEqual(wcag(4.48), { normalAA: false, normalAAA: false, largeAA: true, largeAAA: false, ui: true });
  const colours = [{ hex: '#ff0000' }, { hex: '#00ff80' }];
  assert.equal(toGpl(colours, 'Test'), 'GIMP Palette\nName: Test\nColumns: 2\n#\n255   0   0\tcolor-1 #FF0000\n  0 255 128\tcolor-2 #00FF80\n');
  const ase = toAse(colours);
  assert.equal(String.fromCharCode(...ase.subarray(0, 4)), 'ASEF');
  const view = new DataView(ase.buffer);
  assert.equal(view.getUint32(8), 2); // two blocks
  const len = view.getUint32(14);
  assert.equal(12 + 2 * (6 + len), ase.length);
  assert.equal(view.getFloat32(12 + 6 + 2 + 8 * 2 + 4), 1); // red channel of "color-1"
  assert.match(toTailwind(colours), /--color-color-1: #ff0000;/);
  assert.deepEqual(JSON.parse(toTokens(colours))['color-2'], { $type: 'color', $value: '#00ff80' });
});

test('WebP savings CSV and summary', () => {
  const rows = [
    { img: { url: 'https://a.test/a.jpg', type: 'jpg' }, bytes: 1000, webpBytes: 600 },
    { img: { url: 'https://a.test/b.png', type: 'png' }, bytes: 500, webpBytes: 700 },
  ];
  assert.equal(savingsToCSV(rows).split('\n')[1], 'https://a.test/a.jpg,,jpg,1000,600,400,40');
  assert.deepEqual(savingsSummary(rows), { count: 2, bytes: 1500, saved: 400, percent: 27, smaller: 1 });
});
