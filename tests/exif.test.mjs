import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, readMetadata, stripMetadata } from '../src/lib/exif.js';

// ---------------------------------------------------------------- builders for real file structures

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

// Little-endian TIFF with IFD0 (+ Exif and GPS sub-IFDs). Entries: [tag, type, value].
// value: string (ASCII), number[] (SHORT/LONG) or [num, den][] (RATIONAL).
function buildTiff({ ifd0 = [], exif = [], gps = [] }) {
  const ifds = [ifd0.slice(), exif, gps];
  if (exif.length) ifds[0].push([0x8769, LONG, [0]]);
  if (gps.length) ifds[0].push([0x8825, LONG, [0]]);
  const sizes = ifds.map((e) => (e.length ? 2 + e.length * 12 + 4 : 0));
  const offsets = [8, 8 + sizes[0], 8 + sizes[0] + sizes[1]];
  let dataAt = 8 + sizes[0] + sizes[1] + sizes[2];
  const buf = new Uint8Array(4096);
  const v = new DataView(buf.buffer);
  buf.set([0x49, 0x49]);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  for (const e of ifds[0]) {
    if (e[0] === 0x8769) e[2] = [offsets[1]];
    if (e[0] === 0x8825) e[2] = [offsets[2]];
  }
  ifds.forEach((entries, k) => {
    if (!entries.length) return;
    let at = offsets[k];
    v.setUint16(at, entries.length, true);
    at += 2;
    for (const [tag, type, val] of entries) {
      const raw =
        type === ASCII
          ? [...new TextEncoder().encode(val), 0]
          : type === RATIONAL
            ? val.flatMap(([n, d]) => [n, d])
            : val;
      const unit = type === ASCII ? 1 : type === SHORT ? 2 : 4;
      const count = type === RATIONAL ? val.length : raw.length;
      const total = raw.length * unit;
      v.setUint16(at, tag, true);
      v.setUint16(at + 2, type, true);
      v.setUint32(at + 4, count, true);
      let target = at + 8;
      if (total > 4) {
        v.setUint32(at + 8, dataAt, true);
        target = dataAt;
        dataAt += total + (total & 1);
      }
      raw.forEach((n, i) => {
        if (unit === 1) buf[target + i] = n;
        else if (unit === 2) v.setUint16(target + i * 2, n, true);
        else v.setUint32(target + i * 4, n, true);
      });
      at += 12;
    }
    v.setUint32(at, 0, true);
  });
  return buf.subarray(0, dataAt);
}

const PHOTO_TIFF = (orientation = 1) =>
  buildTiff({
    ifd0: [
      [0x010f, ASCII, 'TestCam'],
      [0x0110, ASCII, 'Model X100'],
      [0x0112, SHORT, [orientation]],
      [0x0132, ASCII, '2026:09:25 10:20:30'],
    ],
    exif: [
      [0x829a, RATIONAL, [[1, 250]]],
      [0x829d, RATIONAL, [[28, 10]]],
      [0x8827, SHORT, [400]],
      [0x920a, RATIONAL, [[50, 1]]],
    ],
    gps: [
      [1, ASCII, 'N'],
      [2, RATIONAL, [[48, 1], [51, 1], [2964, 100]]], // 48°51'29.64" N
      [3, ASCII, 'W'],
      [4, RATIONAL, [[2, 1], [17, 1], [4020, 100]]], // 2°17'40.20" W
    ],
  });

function segment(marker, payload) {
  const len = payload.length + 2;
  return Uint8Array.of(0xff, marker, len >> 8, len & 0xff, ...payload);
}
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const SCAN = Uint8Array.of(0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9); // SOS … EOI

function jpeg({ orientation = 1, extra = [] } = {}) {
  return Uint8Array.from([
    0xff, 0xd8,
    ...segment(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...segment(0xe1, [...ascii('Exif\0\0'), ...PHOTO_TIFF(orientation)]),
    ...segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>')),
    ...segment(0xe2, ascii('ICC_PROFILE\0\x01\x01profile')),
    ...segment(0xfe, ascii('a comment')),
    ...extra,
    ...SCAN,
  ]);
}

function crcless(type, data) {
  const len = data.length;
  return Uint8Array.from([len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...ascii(type), ...data, 0, 0, 0, 0]);
}
function png() {
  return Uint8Array.from([
    ...ascii('\x89PNG\r\n\x1a\n'),
    ...crcless('IHDR', new Array(13).fill(1)),
    ...crcless('eXIf', [...PHOTO_TIFF()]),
    ...crcless('tEXt', ascii('Author\0me')),
    ...crcless('IDAT', [1, 2, 3]),
    ...crcless('IEND', []),
  ]);
}

function riffChunk(fourcc, data) {
  const n = data.length;
  return [...ascii(fourcc), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...data, ...(n & 1 ? [0] : [])];
}
function webp() {
  const body = [
    ...ascii('WEBP'),
    ...riffChunk('VP8X', [0x0c, 0, 0, 0, 9, 0, 0, 9, 0, 0]), // EXIF (0x08) + XMP (0x04) flags
    ...riffChunk('VP8 ', [1, 2, 3, 4, 5]),
    ...riffChunk('EXIF', [...PHOTO_TIFF()]),
    ...riffChunk('XMP ', ascii('<x/>')),
  ];
  const n = body.length;
  return Uint8Array.from([...ascii('RIFF'), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...body]);
}

// ---------------------------------------------------------------- tests

test('reads camera, exposure and GPS from a JPEG', () => {
  const meta = readMetadata(jpeg());
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.hasXmp, true);
  assert.deepEqual(meta.exif, {
    make: 'TestCam',
    model: 'Model X100',
    orientation: 1,
    dateTime: '2026:09:25 10:20:30',
    exposureTime: '1/250 s',
    fNumber: 'f/2.8',
    iso: 400,
    focalLength: '50 mm',
    gps: { lat: 48.858233, lon: -2.2945 },
  });
});

test('reads EXIF from PNG eXIf and WebP EXIF chunks', () => {
  assert.equal(readMetadata(png()).exif.model, 'Model X100');
  assert.equal(readMetadata(png()).hasText, true);
  const w = readMetadata(webp());
  assert.equal(w.format, 'webp');
  assert.deepEqual(w.exif.gps, { lat: 48.858233, lon: -2.2945 });
  assert.equal(w.hasXmp, true);
});

test('strips JPEG metadata losslessly and keeps JFIF, ICC and the image data', () => {
  const src = jpeg();
  const { bytes, removed, needsReencode } = stripMetadata(src);
  assert.equal(needsReencode, false);
  assert.ok(removed > 0);
  assert.equal(bytes.length, src.length - removed);
  const after = readMetadata(bytes);
  assert.equal(after.exif, null);
  assert.equal(after.hasXmp, false);
  assert.equal(after.metadataBytes, 0);
  const text = String.fromCharCode(...bytes);
  assert.ok(text.includes('JFIF') && text.includes('ICC_PROFILE'));
  assert.deepEqual([...bytes.subarray(-SCAN.length)], [...SCAN]); // scan data untouched
  assert.equal(stripMetadata(bytes).removed, 0); // idempotent
});

test('a rotated JPEG asks for a re-encode instead of losing its orientation', () => {
  const r = stripMetadata(jpeg({ orientation: 6 }));
  assert.equal(r.needsReencode, true);
  assert.equal(r.removed, 0);
});

test('strips PNG text/EXIF chunks and WebP EXIF/XMP chunks', () => {
  const p = stripMetadata(png());
  assert.ok(p.removed > 0);
  const pm = readMetadata(p.bytes);
  assert.equal(pm.exif, null);
  assert.equal(pm.hasText, false);
  assert.ok(String.fromCharCode(...p.bytes).includes('IDAT'));

  const w = stripMetadata(webp());
  assert.ok(w.removed > 0);
  const wm = readMetadata(w.bytes);
  assert.equal(wm.exif, null);
  assert.equal(wm.hasXmp, false);
  const view = new DataView(w.bytes.buffer, w.bytes.byteOffset);
  assert.equal(view.getUint32(4, true), w.bytes.length - 8); // RIFF size fixed
  assert.equal(w.bytes[20] & 0x0c, 0); // VP8X EXIF/XMP flags cleared
});

test('unsupported and corrupt input is left alone', () => {
  assert.equal(detectFormat(Uint8Array.of(0x47, 0x49, 0x46, 0x38)), null); // GIF
  const gif = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  assert.equal(stripMetadata(gif).bytes, gif);
  assert.equal(readMetadata(gif), null);
  const truncated = jpeg().subarray(0, 30);
  assert.equal(stripMetadata(truncated).removed, 0);
  assert.doesNotThrow(() => readMetadata(truncated));
  // A hostile IFD pointing outside the segment must not throw.
  const evil = jpeg();
  evil[2 + 18 + 4 + 6 + 4] = 0xff; // corrupt the IFD0 offset inside the EXIF segment
  assert.doesNotThrow(() => readMetadata(evil));
});
