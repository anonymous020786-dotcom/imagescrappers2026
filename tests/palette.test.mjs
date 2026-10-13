import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPalette, paletteToCSS, textColorFor, toHex } from '../src/lib/palette.js';

function pixels(spec) {
  // spec: [[r, g, b, a, count], ...]
  const out = [];
  for (const [r, g, b, a, count] of spec) for (let i = 0; i < count; i++) out.push(r, g, b, a);
  return Uint8ClampedArray.from(out);
}

test('finds the main colours, most common first, with their share', () => {
  const p = extractPalette(pixels([[255, 0, 0, 255, 600], [0, 0, 255, 255, 300], [0, 255, 0, 255, 100]]), 3);
  assert.deepEqual(p.map((c) => c.hex), ['#ff0000', '#0000ff', '#00ff00']);
  assert.ok(Math.abs(p[0].share - 0.6) < 1e-9);
  assert.ok(Math.abs(p.reduce((n, c) => n + c.share, 0) - 1) < 1e-9);
});

test('ignores transparent pixels and merges identical colours', () => {
  const p = extractPalette(pixels([[10, 20, 30, 255, 50], [200, 200, 200, 0, 500]]), 6);
  assert.deepEqual(p.map((c) => c.hex), ['#0a141e']);
  assert.equal(p[0].share, 1);
  assert.deepEqual(extractPalette(pixels([[1, 2, 3, 0, 10]])), []);
});

test('samples large images instead of reading every pixel', () => {
  const big = pixels([[0, 0, 0, 255, 300000], [255, 255, 255, 255, 300000]]);
  const p = extractPalette(big, 2);
  assert.deepEqual(p.map((c) => c.hex).sort(), ['#000000', '#ffffff']);
});

test('helpers: hex, readable text colour and CSS variables', () => {
  assert.equal(toHex([255, 128, 0]), '#ff8000');
  assert.equal(textColorFor([255, 255, 255]), '#000000');
  assert.equal(textColorFor([20, 20, 120]), '#ffffff');
  assert.equal(paletteToCSS([{ hex: '#ff0000' }, { hex: '#00ff00' }]), ':root {\n  --color-1: #ff0000;\n  --color-2: #00ff00;\n}\n');
});
