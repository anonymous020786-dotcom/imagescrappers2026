import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorSortKey, hasTransparency, isAnimated, pixelDifference } from '../src/lib/props.js';
import { buildIco, faviconHtml, PNG_ICONS, webManifest } from '../src/lib/favicon.js';
import { responsiveSnippet, responsiveWidths } from '../src/lib/responsive.js';
import { optimizeSvg } from '../src/lib/svg.js';
import { brokenToCSV, metadataToCSV, weightReport } from '../src/lib/reports.js';

const bytes = (...parts) => {
  const arr = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) arr.push(c.charCodeAt(0));
    else if (Array.isArray(p)) arr.push(...p);
    else arr.push(p);
  }
  return new Uint8Array(arr);
};
const u32be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

// GIF89a 2×2 with a 2-colour global table and `frames` frames, each preceded by a graphic control extension.
function gif(frames) {
  const frame = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00];
  return bytes('GIF89a', [2, 0, 2, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255], ...Array(frames).fill(frame), 0x3b);
}
const chunk = (type, data) => [...u32be(data.length), ...type.split('').map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
function png({ frames } = {}) {
  const ihdr = chunk('IHDR', [...u32be(2), ...u32be(2), 8, 6, 0, 0, 0]);
  const actl = frames ? chunk('acTL', [...u32be(frames), ...u32be(0)]) : [];
  return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ihdr, actl, chunk('IDAT', [1, 2, 3]), chunk('IEND', []));
}
function webp(animated) {
  const vp8x = ['V', 'P', '8', 'X'].map((c) => c.charCodeAt(0));
  const body = [...vp8x, ...u32le(10), animated ? 0x02 : 0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0];
  return bytes('RIFF', u32le(4 + body.length), 'WEBP', body);
}

test('animation: GIF frames are counted by walking the blocks', () => {
  assert.equal(isAnimated(gif(1)), false);
  assert.equal(isAnimated(gif(2)), true);
  assert.equal(isAnimated(gif(5)), true);
});

test('animation: APNG needs an acTL chunk with more than one frame', () => {
  assert.equal(isAnimated(png()), false);
  assert.equal(isAnimated(png({ frames: 1 })), false);
  assert.equal(isAnimated(png({ frames: 3 })), true);
});

test('animation: WebP uses the VP8X animation flag; other formats are still', () => {
  assert.equal(isAnimated(webp(true)), true);
  assert.equal(isAnimated(webp(false)), false);
  assert.equal(isAnimated(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0])), false);
  assert.equal(isAnimated(new Uint8Array(0)), false);
});

test('transparency: any pixel below the alpha threshold', () => {
  assert.equal(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255])), false);
  assert.equal(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 0])), true);
  assert.equal(hasTransparency(new Uint8ClampedArray([1, 2, 3, 252])), false); // nearly opaque counts as opaque
});

test('colour sort: around the hue wheel, then greys dark to light, then unknown', () => {
  const order = ['#ff0000', '#00ff00', '#0000ff', '#222222', '#dddddd', undefined, '#ff8800']
    .map((c) => [c, colorSortKey(c)])
    .sort((a, b) => a[1] - b[1])
    .map(([c]) => c);
  assert.deepEqual(order, ['#ff0000', '#ff8800', '#00ff00', '#0000ff', '#222222', '#dddddd', undefined]);
});

test('pixel difference: identical, partly changed and size mismatch', () => {
  const a = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255]);
  assert.deepEqual(pixelDifference(a, a), { changed: 0, mean: 0 });
  const b = new Uint8ClampedArray([0, 0, 0, 255, 200, 100, 100, 255]);
  const d = pixelDifference(a, b);
  assert.equal(d.changed, 0.5);
  assert.ok(Math.abs(d.mean - 50 / 255) < 1e-9);
  assert.equal(pixelDifference(a, new Uint8ClampedArray([0, 0, 0, 255, 110, 100, 100, 255])).changed, 0); // within tolerance
  assert.throws(() => pixelDifference(a, new Uint8ClampedArray(4)), /same size/);
});

test('favicon: ICO header, directory entries and embedded PNG data', () => {
  const pngs = [16, 32, 256].map((size) => ({ size, data: new Uint8Array(size === 256 ? 7 : 3).fill(size % 255) }));
  const ico = buildIco(pngs);
  const v = new DataView(ico.buffer);
  assert.deepEqual([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)], [0, 1, 3]);
  assert.deepEqual([ico[6], ico[22], ico[38]], [16, 32, 0]); // 256 is written as 0
  assert.equal(v.getUint16(6 + 6, true), 32); // bits per pixel
  const firstOffset = v.getUint32(6 + 12, true);
  assert.equal(firstOffset, 6 + 16 * 3);
  assert.equal(v.getUint32(22 + 12, true), firstOffset + 3);
  assert.equal(ico.length, 6 + 48 + 3 + 3 + 7);
  assert.deepEqual([...ico.slice(firstOffset, firstOffset + 3)], [16, 16, 16]);
  assert.throws(() => buildIco([]), /No images/);
  assert.equal(JSON.parse(webManifest('My site')).icons.length, 2);
  assert.match(faviconHtml(), /favicon\.ico[\s\S]*apple-touch-icon[\s\S]*site\.webmanifest/);
  assert.ok(PNG_ICONS.some((i) => i.size === 180 && i.name === 'apple-touch-icon.png'));
});

test('responsive: widths never upscale; snippet has WebP source and fallback', () => {
  assert.deepEqual(responsiveWidths(1500), [320, 640, 960, 1280]);
  assert.deepEqual(responsiveWidths(200), [200]);
  assert.deepEqual(responsiveWidths(1000, [640, 640, 320, 2000]), [320, 640]);
  const html = responsiveSnippet({ base: 'red "sofa"', widths: [320, 640], naturalWidth: 1000, naturalHeight: 500, alt: 'A <red> sofa', fallback: 'png' });
  assert.match(html, /<source type="image\/webp" srcset="red &quot;sofa&quot;-320\.webp 320w, red &quot;sofa&quot;-640\.webp 640w"/);
  assert.match(html, /src="red &quot;sofa&quot;-640\.png"/);
  assert.match(html, /width="640" height="320" alt="A &lt;red> sofa"/);
  assert.match(html, /sizes="\(max-width: 640px\) 100vw, 640px"/);
});

test('SVG optimizer: removes editor clutter, keeps text and drawing', () => {
  const input = `<?xml version="1.0"?>
<!-- Created with Inkscape -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="10" height="10" inkscape:version="1.2">
  <metadata><rdf:RDF>lots of data</rdf:RDF></metadata>
  <sodipodi:namedview id="nv" inkscape:zoom="2" />
  <title>Logo  with  spaces</title>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer">
    <rect width="10" height="10" fill="red" />
    <text x="1" y="9"><tspan>Hi</tspan> <tspan>there</tspan></text>
  </g>
</svg>`;
  const { svg, saved } = optimizeSvg(input);
  assert.ok(saved > 100);
  assert.doesNotMatch(svg, /inkscape|sodipodi|<!--|metadata/);
  assert.match(svg, /<title>Logo {2}with {2}spaces<\/title>/);
  assert.match(svg, /<text x="1" y="9"><tspan>Hi<\/tspan> <tspan>there<\/tspan><\/text>/);
  assert.match(svg, /<rect width="10" height="10" fill="red"\/>/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(optimizeSvg('<svg><rect/></svg>').saved, 0);
});

test('weight report: totals, groups and heaviest', () => {
  const r = weightReport([
    { url: 'https://a.test/1.jpg', type: 'jpg', bytes: 500 },
    { url: 'https://cdn.test/2.png', type: 'png', bytes: 1500 },
    { url: 'https://a.test/3.jpg', type: 'jpg', bytes: 700 },
    { url: 'https://a.test/4.gif', type: 'gif' },
  ], 2);
  assert.equal(r.total, 2700);
  assert.equal(r.count, 3);
  assert.equal(r.unknown, 1);
  assert.deepEqual(r.byType.map((g) => [g.key, g.bytes, g.count]), [['PNG', 1500, 1], ['JPG', 1200, 2]]);
  assert.deepEqual(r.byDomain.map((g) => g.key), ['cdn.test', 'a.test']);
  assert.deepEqual(r.heaviest.map((i) => i.bytes), [1500, 700]);
});

test('metadata and broken-image CSVs', () => {
  const csv = metadataToCSV([
    { img: { url: 'https://a.test/p.jpg', pageUrl: 'https://a.test/', width: 4000, height: 3000 }, exif: { make: 'Canon', model: 'EOS R6', dateTimeOriginal: '2026:05:01 10:00:00', fNumber: 'f/2.8', gps: { lat: 51.5, lon: -0.12 }, artist: '=cmd' } },
    { img: { url: 'https://a.test/q.png' }, exif: null },
  ]).split('\n');
  assert.match(csv[0], /^url,page,width,height,camera_make,camera_model/);
  assert.match(csv[1], /^https:\/\/a\.test\/p\.jpg,https:\/\/a\.test\/,4000,3000,Canon,EOS R6,,2026:05:01 10:00:00,,f\/2\.8,,,51\.5,-0\.12,'=cmd,,$/);
  assert.equal(csv[2], 'https://a.test/q.png' + ','.repeat(16));
  const broken = brokenToCSV([{ url: 'https://a.test/x.jpg', pageUrl: 'https://a.test/', broken: 'HTTP 404' }, { url: 'https://a.test/ok.jpg' }]).split('\n');
  assert.deepEqual(broken, ['url,page,error', 'https://a.test/x.jpg,https://a.test/,HTTP 404']);
});
