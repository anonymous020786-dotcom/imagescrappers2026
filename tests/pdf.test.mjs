import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, jpegInfo, placeImage } from '../src/lib/pdf.js';

// A JPEG header with an SOF0 frame (no real image data; enough for parsing and PDF structure).
function fakeJpeg(width, height, components = 3, marker = 0xc0) {
  const sof = [0xff, marker, 0, 8 + components * 3, 8, height >> 8, height & 255, width >> 8, width & 255, components];
  for (let c = 0; c < components; c++) sof.push(c + 1, 0x11, 0);
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, ...sof, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

const text = (pdf) => Buffer.concat(pdf.chunks.map((c) => Buffer.from(c))).toString('latin1');

test('reads JPEG size and colour components, including progressive', () => {
  assert.deepEqual(jpegInfo(fakeJpeg(640, 480)), { width: 640, height: 480, components: 3, progressive: false });
  assert.deepEqual(jpegInfo(fakeJpeg(10, 20, 1, 0xc2)), { width: 10, height: 20, components: 1, progressive: true });
  assert.equal(jpegInfo(Uint8Array.of(0x89, 0x50, 0x4e, 0x47)), null); // PNG
  assert.equal(jpegInfo(fakeJpeg(640, 480).subarray(0, 12)), null); // truncated
});

test('places images: page fits the image, or shrinks onto A4 in the matching orientation', () => {
  assert.deepEqual(placeImage(800, 600), { pageWidth: 600, pageHeight: 450, x: 0, y: 0, w: 600, h: 450 });
  const land = placeImage(4000, 3000, { pageSize: 'a4', margin: 36 });
  assert.equal(land.pageWidth, 841.89); // landscape A4
  assert.ok(land.w <= 841.89 - 72 + 1e-9 && land.h <= 595.28 - 72 + 1e-9);
  assert.ok(Math.abs(land.w / land.h - 4 / 3) < 1e-9);
  const small = placeImage(100, 200, { pageSize: 'letter' });
  assert.deepEqual([small.w, small.h], [75, 150]); // never enlarged
  assert.equal(small.x, (612 - 75) / 2);
});

test('builds a valid PDF: one page per image, correct xref offsets', () => {
  const pdf = buildPdf([
    { bytes: fakeJpeg(800, 600), width: 800, height: 600, components: 3 },
    { bytes: fakeJpeg(300, 400, 1), width: 300, height: 400, components: 1 },
    { bytes: fakeJpeg(50, 50, 4), width: 50, height: 50, components: 4 },
  ], { pageSize: 'a4', margin: 20, title: 'Café photos', date: new Date(Date.UTC(2026, 9, 13, 8, 5, 0)) });
  const s = text(pdf);
  assert.equal(s.length, pdf.size);
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.endsWith('%%EOF\n'));
  assert.match(s, /\/Count 3 >>/);
  assert.equal((s.match(/\/Type \/Page /g) ?? []).length, 3);
  assert.match(s, /\/ColorSpace \/DeviceGray/);
  assert.match(s, /\/ColorSpace \/DeviceCMYK \/Decode \[1 0 1 0 1 0 1 0\]/);
  assert.match(s, /\/Title <FEFF00430061006600E9/); // UTF-16 title
  assert.match(s, /\/CreationDate \(D:20261013080500Z\)/);
  // Every xref entry points at its object, and startxref points at the xref table.
  const startxref = Number(s.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const entries = s.slice(startxref).split('\n').slice(2).filter((l) => / 00000 n $/.test(l));
  assert.equal(entries.length, 3 + 3 * 3);
  entries.forEach((line, k) => {
    const at = Number(line.slice(0, 10));
    assert.ok(s.startsWith(`${k + 1} 0 obj\n`, at), `object ${k + 1} not at ${at}`);
  });
  // Image stream lengths match the embedded bytes.
  const len = Number(s.match(/\/Width 800 \/Height 600 .*\/Length (\d+) >>/)[1]);
  assert.equal(len, fakeJpeg(800, 600).length);
});

test('refuses an empty document', () => {
  assert.throws(() => buildPdf([]), /No images/);
});
