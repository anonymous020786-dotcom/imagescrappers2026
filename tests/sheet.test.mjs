import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHEET_HEIGHT, fitInCell, sheetLayout } from '../src/lib/sheet.js';

test('lays out a grid with captions', () => {
  const l = sheetLayout(7, { columns: 3, cell: 100, gap: 10, padding: 20, caption: 30, header: 40 });
  assert.equal(l.width, 20 * 2 + 3 * 100 + 2 * 10);
  assert.equal(l.sheets.length, 1);
  const { cells, height } = l.sheets[0];
  assert.equal(cells.length, 7);
  assert.deepEqual(cells[4], { index: 4, x: 130, y: 20 + 40 + 140, w: 100, h: 100, captionY: 306 });
  assert.equal(height, 20 * 2 + 40 + 3 * 130 + 2 * 10);
});

test('few images use fewer columns; huge sets split into sheets under the canvas limit', () => {
  assert.equal(sheetLayout(2, { columns: 5 }).columns, 2);
  const l = sheetLayout(1000, { columns: 5 });
  assert.ok(l.sheets.length > 1);
  assert.equal(l.sheets.reduce((n, s) => n + s.cells.length, 0), 1000);
  assert.ok(l.sheets.every((s) => s.height <= MAX_SHEET_HEIGHT));
  assert.equal(l.sheets[1].cells[0].index, l.sheets[0].cells.length);
});

test('images fit inside their cell, centred and never enlarged', () => {
  const cell = { x: 0, y: 0, w: 200, h: 200 };
  assert.deepEqual(fitInCell(400, 100, cell), { x: 0, y: 75, w: 200, h: 50 });
  assert.deepEqual(fitInCell(50, 40, cell), { x: 75, y: 80, w: 50, h: 40 });
});
