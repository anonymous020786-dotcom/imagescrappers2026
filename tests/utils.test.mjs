import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTemplate, baseNameFromUrl, buildFilename, compilePattern, dHashFromGray, dedupe, extensionFromUrl,
  filterImages, formatBytes, guessType, hammingHex, markVisualDuplicates, normalizeUrl, reverseSearchUrl,
  sanitizeFilename, sortImages, toCSV, toHTMLGallery, mapLimit,
} from '../src/lib/utils.js';

test('guessType uses MIME first, then extension, then query params', () => {
  assert.equal(guessType('https://x.com/a.png', 'image/webp'), 'webp');
  assert.equal(guessType('https://x.com/a.JPEG?x=1'), 'jpg');
  assert.equal(guessType('https://cdn.x.com/img?fm=webp&w=200'), 'webp');
  assert.equal(guessType('data:image/svg+xml;base64,AAA'), 'svg');
  assert.equal(guessType('https://x.com/image'), 'other');
});

test('extensionFromUrl handles invalid URLs', () => {
  assert.equal(extensionFromUrl('not a url'), '');
  assert.equal(extensionFromUrl(''), '');
});

test('sanitizeFilename strips illegal characters and reserved names', () => {
  assert.equal(sanitizeFilename('a<b>:c?.jpg'), 'a_b_c_.jpg');
  assert.equal(sanitizeFilename('CON'), '_CON');
  assert.equal(sanitizeFilename('...'), 'image');
});

test('baseNameFromUrl decodes and strips extension', () => {
  assert.equal(baseNameFromUrl('https://x.com/p/my%20photo.jpg?w=1'), 'my photo');
  assert.equal(baseNameFromUrl('data:image/png;base64,xx'), 'image');
});

test('applyTemplate expands tokens and zero-pads indexes', () => {
  const date = new Date(2026, 0, 5, 7, 8, 9);
  const out = applyTemplate('{pagedomain}/{date}/{index:3}_{name}_{width}x{height}', {
    url: 'https://cdn.site.com/a/cat.png', pageUrl: 'https://www.site.com/page', index: 4, date, width: 10, height: 20,
  });
  assert.equal(out, 'site.com/2026-01-05/005_cat_10x20');
});

test('applyTemplate prevents path traversal', () => {
  assert.equal(applyTemplate('../../etc/{name}', { url: 'https://x.com/passwd' }), 'etc/passwd');
});

test('buildFilename appends extension and folder', () => {
  assert.equal(buildFilename('{name}', 'imgs', { url: 'https://x.com/a.png', ext: 'png' }), 'imgs/a.png');
  assert.equal(buildFilename('{name}.{ext}', '', { url: 'https://x.com/a.png', ext: 'webp' }), 'a.webp');
});

test('normalizeUrl and dedupe merge identical images and their sources', () => {
  assert.equal(normalizeUrl('https://x.com/a.png?v=1#frag', true), 'https://x.com/a.png');
  const out = dedupe([
    { url: 'https://x.com/a.png#1', source: 'img', width: 10, height: 10 },
    { url: 'https://x.com/a.png#2', source: 'css', width: 0, height: 0 },
    { url: 'https://x.com/b.png', source: 'img' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].sources, ['img', 'css']);
  assert.equal(out[0].width, 10);
});

test('compilePattern supports wildcards and regex', () => {
  assert.ok(compilePattern('*doubleclick.net*').test('https://ad.doubleclick.net/x.gif'));
  assert.ok(compilePattern('/\\.gif$/').test('https://x.com/a.gif'));
  assert.equal(compilePattern('   '), null);
});

const sample = [
  { id: 1, url: 'https://a.com/big.jpg', type: 'jpg', width: 1920, height: 1080, source: 'img', order: 0, bytes: 500000 },
  { id: 2, url: 'https://b.com/icon.png', type: 'png', width: 32, height: 32, source: 'icon', order: 1, bytes: 1000 },
  { id: 3, url: 'https://a.com/pixel.gif', type: 'gif', width: 1, height: 1, source: 'img', order: 2 },
  { id: 4, url: 'https://a.com/tall.webp', type: 'webp', width: 400, height: 900, source: 'css', order: 3, alt: 'Portrait of a cat' },
  { id: 5, url: 'https://a.com/unknown.jpg', type: 'jpg', width: 0, height: 0, source: 'lazy', order: 4 },
];

test('filterImages: dimensions, tracking pixels and unknown sizes', () => {
  const ids = (f) => filterImages(sample, f).map((i) => i.id);
  assert.deepEqual(ids({ minWidth: 300, keepUnknownSize: true }), [1, 4, 5]);
  assert.deepEqual(ids({ minWidth: 300, keepUnknownSize: false }), [1, 4]);
  assert.deepEqual(ids({ hideTracking: true }), [1, 2, 4, 5]);
  assert.deepEqual(ids({ maxWidth: 500, minWidth: 10 }), [2, 4]);
});

test('filterImages: type, source, aspect, bytes, domain, text, regex', () => {
  const ids = (f) => filterImages(sample, f).map((i) => i.id);
  assert.deepEqual(ids({ types: ['jpg'] }), [1, 5]);
  assert.deepEqual(ids({ sources: ['css', 'icon'] }), [2, 4]);
  assert.deepEqual(ids({ aspect: 'portrait' }), [4]);
  assert.deepEqual(ids({ aspect: 'square' }), [2, 3]);
  assert.deepEqual(ids({ minBytes: 2000 }), [1, 3, 4, 5]);
  assert.deepEqual(ids({ domain: 'b.com' }), [2]);
  assert.deepEqual(ids({ text: 'cat' }), [4]);
  assert.deepEqual(ids({ text: '^https://a\\.com/(big|tall)', regex: true }), [1, 4]);
  assert.deepEqual(ids({ text: '([bad', regex: true }).length, 0);
  assert.deepEqual(ids({ blocklist: ['*pixel*'] }), [1, 2, 4, 5]);
});

test('sortImages sorts by area and keeps page order for ties', () => {
  assert.deepEqual(sortImages(sample, 'area', 'desc').map((i) => i.id), [1, 4, 2, 3, 5]);
  assert.deepEqual(sortImages(sample, 'bytes', 'asc').map((i) => i.id), [3, 4, 5, 2, 1]);
  assert.deepEqual(sortImages(sample, 'name').map((i) => i.id), [1, 2, 3, 4, 5]);
});

test('dHash + hamming distance detects near-duplicates', () => {
  const gradient = Array.from({ length: 72 }, (_, i) => (i % 9) * 10);
  const noisy = gradient.map((v, i) => (i === 5 ? v + 30 : v));
  const reversed = gradient.map((v) => 255 - v);
  const h1 = dHashFromGray(gradient);
  assert.equal(h1.length, 16);
  assert.equal(hammingHex(h1, dHashFromGray(gradient)), 0);
  assert.ok(hammingHex(h1, dHashFromGray(noisy)) <= 2);
  assert.equal(hammingHex(h1, dHashFromGray(reversed)), 64);

  const imgs = [
    { id: 'small', hash: h1, width: 10, height: 10 },
    { id: 'big', hash: dHashFromGray(noisy), width: 100, height: 100 },
    { id: 'other', hash: dHashFromGray(reversed), width: 50, height: 50 },
  ];
  assert.equal(markVisualDuplicates(imgs, 5), 1);
  assert.equal(imgs[0].duplicateOf, 'big');
  assert.equal(imgs[1].duplicateOf, undefined);
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(null), '—');
});

test('exports escape values', () => {
  const csv = toCSV([{ url: 'https://x.com/a,b.png', alt: 'say "hi"', source: 'img', type: 'png' }]);
  assert.match(csv, /"https:\/\/x.com\/a,b.png"/);
  assert.match(csv, /"say ""hi"""/);
  const html = toHTMLGallery([{ url: 'https://x.com/"><script>.png', alt: '<b>', type: 'png' }]);
  assert.ok(!html.includes('<script>.png'));
});

test('reverseSearchUrl encodes the image URL', () => {
  assert.equal(reverseSearchUrl('tineye', 'https://x.com/a b.png'), 'https://tineye.com/search?url=https%3A%2F%2Fx.com%2Fa%20b.png');
  assert.match(reverseSearchUrl('nope', 'https://x.com/a.png'), /^https:\/\/lens\.google\.com\//);
});

test('mapLimit respects concurrency and captures errors', async () => {
  let active = 0;
  let peak = 0;
  const res = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (n === 3) throw new Error('boom');
    return n * 2;
  });
  assert.equal(peak, 2);
  assert.equal(res[0], 2);
  assert.equal(res[2].error.message, 'boom');
});

test('safeImageSrc only allows image-safe schemes', async () => {
  const { safeImageSrc } = await import('../src/lib/utils.js');
  assert.equal(safeImageSrc('https://x.com/a.png'), 'https://x.com/a.png');
  assert.equal(safeImageSrc('data:image/png;base64,AA'), 'data:image/png;base64,AA');
  assert.equal(safeImageSrc('blob:https://x.com/1'), 'blob:https://x.com/1');
  assert.equal(safeImageSrc('javascript:alert(1)'), null);
  assert.equal(safeImageSrc(' JavaScript:alert(1)'), null);
  assert.equal(safeImageSrc('vbscript:msgbox'), null);
  assert.equal(safeImageSrc('data:text/html,<script>'), null);
  assert.equal(safeImageSrc('not a url'), null);
  assert.equal(safeImageSrc(undefined), null);
});
