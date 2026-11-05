import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditByPage, auditImage, auditImages, auditToCSV, imageFileName } from '../src/lib/audit.js';
import { auditPages, imageSitemaps, socialSizesUnknown } from '../src/lib/seo.js';
import { dedupe } from '../src/lib/utils.js';

const facts = (over = {}) => ({ hasAlt: true, loading: '', sized: true, top: 100, viewportHeight: 800, inFrame: false, ...over });
const img = (over = {}) => ({
  url: 'https://site.test/red-leather-sofa.webp',
  pageUrl: 'https://site.test/',
  source: 'img',
  type: 'webp',
  alt: 'Red leather sofa in a bright living room',
  width: 400,
  height: 300,
  displayWidth: 400,
  displayHeight: 300,
  audit: facts(),
  ...over,
});
const rules = (i) => auditImage(i).map((x) => x.rule);

test('a well-described image with a descriptive file name has no SEO findings', () => {
  assert.deepEqual(rules(img()), []);
});

test('alt text that says nothing, or is a file name, is weak', () => {
  for (const alt of ['image', 'Photo 3', 'banner-2', 'IMG_1234.jpg', 'DSC_0042', 'untitled']) {
    assert.deepEqual(rules(img({ alt })), ['weak-alt'], alt);
  }
  // Empty alt marks a decorative image: fine.
  assert.deepEqual(rules(img({ alt: '' })), []);
});

test('keyword stuffing and very long alt text', () => {
  assert.deepEqual(rules(img({ alt: 'cheap sofa, best sofa, buy sofa online' })), ['stuffed-alt']);
  assert.deepEqual(rules(img({ alt: 'A '.repeat(70) + 'room' })), ['long-alt']);
});

test('camera, default and hash file names are flagged; CDN query names are read', () => {
  assert.deepEqual(rules(img({ url: 'https://site.test/IMG_20240101_123456.jpg', type: 'webp' })), ['generic-filename']);
  assert.deepEqual(rules(img({ url: 'https://site.test/9f86d081884c7d659a2feaa0c55ad015.webp' })), ['generic-filename']);
  assert.deepEqual(rules(img({ url: 'https://site.test/image.webp' })), ['generic-filename']);
  assert.equal(imageFileName('https://site.test/_next/image?url=%2Fuploads%2Fblue-chair.jpg&w=640'), 'blue-chair');
  assert.deepEqual(rules(img({ url: 'https://site.test/_next/image?url=%2Fuploads%2Fblue-chair.jpg&w=640' })), []);
  // CSS backgrounds are not content images.
  assert.deepEqual(rules(img({ source: 'css', audit: undefined, url: 'https://site.test/IMG_1.jpg' })), []);
});

test('the same alt on three or more images of a page is reported once per image', () => {
  const same = (n) => img({ url: `https://site.test/sofa-${n}.webp`, alt: 'Our sofa' });
  const report = auditImages([same('a'), same('b'), same('c'), img({ url: 'https://site.test/other.webp', pageUrl: 'https://site.test/x', alt: 'Our sofa' })]);
  assert.equal(report.byRule['duplicate-alt'].count, 3);
  assert.match(report.items[0].issues[0].detail, /used on 3 images/);
});

test('page checks: missing og:image, twitter-only, structured data', () => {
  const plain = auditPages([img()]);
  assert.deepEqual(plain.map((f) => f.rule), ['no-og-image', 'no-structured-image']);
  assert.equal(plain[0].severity, 'error');

  const twitterOnly = auditPages([img(), img({ url: 'https://site.test/card.jpg', source: 'meta', width: 1200, height: 630, seo: ['twitter', 'schema'] })]);
  assert.deepEqual(twitterOnly.map((f) => f.rule), ['no-og-image']);
  assert.match(twitterOnly[0].detail, /Only twitter:image/);
});

test('page checks: social image size, shape and http', () => {
  const og = (over) => img({ url: 'https://site.test/share.jpg', source: 'meta', seo: ['og', 'schema'], ...over });
  assert.deepEqual(auditPages([og({ width: 1200, height: 630 })]), []);
  assert.deepEqual(auditPages([og({ width: 600, height: 600 })]).map((f) => f.rule), ['small-og-image', 'og-image-ratio']);
  assert.deepEqual(auditPages([og({ url: 'http://cdn.test/share.jpg', width: 1200, height: 630 })]).map((f) => f.rule), ['insecure-og-image']);
  assert.equal(socialSizesUnknown([og({ width: 0, height: 0 })]), true);
  assert.equal(socialSizesUnknown([og({ width: 1200, height: 630 })]), false);
});

test('a crawl stores a shared og:image once but every page that declares it counts', () => {
  const shared = img({ url: 'https://site.test/share.jpg', source: 'meta', width: 1200, height: 630,
    seoRefs: [{ page: 'https://site.test/', tags: ['og', 'schema'] }, { page: 'https://site.test/b', tags: ['og', 'schema'] }] });
  const other = img({ url: 'https://site.test/b-photo.webp', pageUrl: 'https://site.test/b' });
  assert.deepEqual(auditPages([shared, other]), []);
});

test('dedupe keeps the SEO tags of every source', () => {
  const [merged] = dedupe([
    { url: 'https://site.test/share.jpg', source: 'img' },
    { url: 'https://site.test/share.jpg', source: 'meta', seo: ['og'] },
    { url: 'https://site.test/share.jpg', source: 'meta', seo: ['twitter'] },
  ]);
  assert.deepEqual(merged.seo, ['og', 'twitter']);
});

test('page findings join the per-page ranking and the CSV', () => {
  const images = [img()];
  const findings = auditPages(images);
  const report = auditImages(images);
  const [row] = auditByPage(report, findings);
  assert.equal(row.page, 'https://site.test/');
  assert.equal(row.errors, 1);
  assert.equal(row.notes, 1);
  const csv = auditToCSV(report, findings).split('\n');
  assert.equal(csv.length, 1 + 2);
  assert.ok(csv[1].startsWith('https://site.test/,https://site.test/,No social sharing image,error,'));
});

test('image sitemap: grouped by page, escaped, without icons, pixels or inline images', () => {
  const [xml] = imageSitemaps([
    img({ url: 'https://site.test/a.jpg?x=1&y=2' }),
    img({ url: 'https://site.test/b.jpg' }),
    img({ url: 'https://site.test/favicon.ico', source: 'icon', sources: ['icon'] }),
    img({ url: 'https://site.test/pixel.gif', width: 1, height: 1 }),
    img({ url: 'data:image/png;base64,AAAA' }),
    img({ url: 'https://site.test/c.jpg', pageUrl: 'https://site.test/page-2' }),
  ]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /xmlns:image="http:\/\/www.google.com\/schemas\/sitemap-image\/1.1"/);
  assert.equal((xml.match(/<url>/g) ?? []).length, 2);
  assert.equal((xml.match(/<image:image>/g) ?? []).length, 3);
  assert.ok(xml.includes('<image:loc>https://site.test/a.jpg?x=1&amp;y=2</image:loc>'));
  assert.ok(!xml.includes('favicon') && !xml.includes('pixel') && !xml.includes('data:'));
  assert.deepEqual(imageSitemaps([img({ pageUrl: '' })]), []);
});
