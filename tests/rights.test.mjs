import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRights } from '../src/lib/exif.js';
import {
  cleanRights, mergeRights, rightsClass, rightsFromIptc, rightsFromJsonLd, rightsFromXmp, sourcesToCSV,
} from '../src/lib/rights.js';

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmpRights:WebStatement="https://site.test/terms?a=1&amp;b=2" photoshop:Credit="Agency &amp; Co">
<dc:creator><rdf:Seq><rdf:li>Ana Silva</rdf:li><rdf:li>Bo Chen</rdf:li></rdf:Seq></dc:creator>
<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© 2026 Ana Silva</rdf:li></rdf:Alt></dc:rights>
<cc:license rdf:resource="https://creativecommons.org/licenses/by/4.0/"/>
<plus:LicensorURL>https://site.test/buy</plus:LicensorURL>
</rdf:Description></rdf:RDF></x:xmpmeta>`;

const enc = new TextEncoder();
const iptcRecord = (dataset, value) => {
  const body = enc.encode(value);
  return [0x1c, 2, dataset, body.length >> 8, body.length & 255, ...body];
};

function jpegWith(...segments) {
  const parts = [0xff, 0xd8];
  for (const [marker, body] of segments) parts.push(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
  parts.push(0xff, 0xda, 0, 2, 0xff, 0xd9);
  return new Uint8Array(parts);
}

function pngChunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(enc.encode(type), 4);
  out.set(body, 8);
  return out;
}

function pngWith(...chunks) {
  const all = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), ...chunks, pngChunk('IEND', new Uint8Array())];
  return Uint8Array.from(all.flatMap((c) => [...c]));
}

test('reads credit and licence from XMP, in attribute and element forms', () => {
  assert.deepEqual(rightsFromXmp(XMP), {
    creator: 'Ana Silva, Bo Chen',
    credit: 'Agency & Co',
    copyright: '© 2026 Ana Silva',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    licensePage: 'https://site.test/buy',
  });
  assert.equal(rightsFromXmp('<x>nothing here</x>'), null);
  assert.equal(rightsFromXmp(''), null);
});

test('falls back to the web statement when there is no cc:license', () => {
  const xmp = '<rdf:Description xmpRights:WebStatement="https://site.test/terms"/>';
  assert.equal(rightsFromXmp(xmp).license, 'https://site.test/terms');
});

test('reads IPTC records, joins repeats and survives truncated data', () => {
  const bytes = Uint8Array.from([1, 2, 3, ...iptcRecord(80, 'Ana'), ...iptcRecord(80, 'Bo'), ...iptcRecord(110, 'Agency'), ...iptcRecord(116, '© Ana'), ...iptcRecord(5, 'A title')]);
  assert.deepEqual(rightsFromIptc(bytes), { creator: 'Ana, Bo', credit: 'Agency', copyright: '© Ana' });
  assert.equal(rightsFromIptc(Uint8Array.of(0x1c, 2, 80, 0xff, 0xff, 65)), null);
  assert.equal(rightsFromIptc(new Uint8Array()), null);
});

test('reads schema.org image details', () => {
  assert.deepEqual(rightsFromJsonLd({
    '@type': 'ImageObject', creator: [{ '@type': 'Person', name: 'Ana' }, 'Bo'], creditText: 'Agency',
    copyrightNotice: '© Ana', license: 'https://creativecommons.org/publicdomain/zero/1.0/', acquireLicensePage: { url: 'https://s.test/buy' },
  }), {
    creator: 'Ana, Bo', credit: 'Agency', copyright: '© Ana', license: 'https://creativecommons.org/publicdomain/zero/1.0/', licensePage: 'https://s.test/buy',
  });
  assert.equal(rightsFromJsonLd({ '@type': 'ImageObject', url: 'x.jpg' }), null);
  assert.equal(rightsFromJsonLd(null), null);
});

test('readRights finds details in JPEG and PNG files', () => {
  const xmpSegment = [...enc.encode('http://ns.adobe.com/xap/1.0/\0'), ...enc.encode(XMP)];
  const iptcSegment = [...enc.encode('Photoshop 3.0\0'), ...iptcRecord(110, 'From IPTC'), ...iptcRecord(80, 'Second')];
  const jpeg = jpegWith([0xe1, xmpSegment], [0xed, iptcSegment]);
  const fromJpeg = readRights(jpeg);
  assert.equal(fromJpeg.creator, 'Ana Silva, Bo Chen'); // XMP wins over IPTC
  assert.equal(fromJpeg.licensePage, 'https://site.test/buy');

  const itxt = pngChunk('iTXt', Uint8Array.from([...enc.encode('XML:com.adobe.xmp\0'), 0, 0, 0, 0, ...enc.encode(XMP)]));
  const note = pngChunk('tEXt', Uint8Array.from([...enc.encode('Author\0'), ...enc.encode('Cy')]));
  assert.equal(readRights(pngWith(itxt)).credit, 'Agency & Co');
  assert.deepEqual(readRights(pngWith(note)), { creator: 'Cy' });

  assert.equal(readRights(jpegWith([0xe0, [1, 2, 3]])), null);
  assert.equal(readRights(enc.encode('not an image')), null);
});

test('merging keeps the first value of each field', () => {
  assert.deepEqual(mergeRights({ creator: 'Page' }, null, { creator: 'File', credit: 'Agency' }), { creator: 'Page', credit: 'Agency' });
  assert.equal(mergeRights(null, undefined, {}), null);
});

test('cleaning drops unknown fields, non-text values and long text', () => {
  assert.deepEqual(cleanRights({ creator: ' Ana\n Silva ', evil: 'x', license: { a: 1 } }), { creator: 'Ana Silva' });
  assert.equal(cleanRights({ creator: 'x'.repeat(1000) }).creator.length, 300);
  assert.equal(cleanRights({ creator: '  ' }), null);
});

test('classifies open licences without treating other text as open', () => {
  assert.equal(rightsClass({ license: 'https://creativecommons.org/licenses/by/4.0/' }), 'open');
  assert.equal(rightsClass({ copyright: 'Released to the public domain' }), 'open');
  assert.equal(rightsClass({ license: 'CC0' }), 'open');
  assert.equal(rightsClass({ copyright: '© 2026 Getty Images' }), 'known');
  assert.equal(rightsClass({ license: 'accent-based licence' }), 'known');
  assert.equal(rightsClass(null), 'none');
});

test('sources.csv records each file and neutralises spreadsheet formulas', () => {
  const csv = sourcesToCSV([
    { file: 'a.jpg', img: { url: 'https://x.test/a.jpg', pageUrl: 'https://x.test/', pageTitle: '=HYPERLINK("http://evil")', width: 10, height: 5, rights: { creator: 'Ana, "B"' } } },
    { file: 'b.png', img: { url: 'data:image/png;base64,AAAA' } },
  ], new Date('2026-01-02T03:04:05Z'));
  const lines = csv.split('\n');
  assert.equal(lines[0].split(',')[0], 'file');
  assert.match(lines[1], /^a\.jpg,https:\/\/x\.test\/a\.jpg,https:\/\/x\.test\/,"'=HYPERLINK\(""http:\/\/evil""\)",10,5,2026-01-02T03:04:05\.000Z,"Ana, ""B""",/);
  assert.match(lines[2], /^b\.png,inline image,/);
  assert.ok(!csv.includes('base64'));
});
