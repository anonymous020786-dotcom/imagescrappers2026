import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, auditImage, auditImages, auditToCSV } from '../src/lib/audit.js';

const facts = (over = {}) => ({ hasAlt: true, loading: '', sized: true, top: 100, viewportHeight: 800, inFrame: false, ...over });
const img = (over = {}) => ({
  url: 'https://site.test/a.webp',
  source: 'img',
  type: 'webp',
  width: 400,
  height: 300,
  displayWidth: 400,
  displayHeight: 300,
  audit: facts(),
  ...over,
});
const rules = (i) => auditImage(i).map((x) => x.rule);

test('a well-made image has no findings', () => {
  assert.deepEqual(rules(img()), []);
});

test('missing alt is an error; empty alt (decorative) is fine', () => {
  assert.deepEqual(rules(img({ audit: facts({ hasAlt: false }) })), ['missing-alt']);
  assert.deepEqual(rules(img({ alt: '', audit: facts({ hasAlt: true }) })), []);
  // Tiny spacers and icons are not flagged.
  assert.deepEqual(rules(img({ displayWidth: 8, displayHeight: 8, width: 8, height: 8, audit: facts({ hasAlt: false }) })), []);
});

test('oversized allows 2x for high-DPI screens and estimates the saving', () => {
  assert.deepEqual(rules(img({ width: 800, height: 600 })), []); // exactly 2x
  const [o] = auditImage(img({ width: 4000, height: 3000, bytes: 1_000_000 }));
  assert.equal(o.rule, 'oversized');
  assert.match(o.detail, /4000×3000 shown at 400×300 \(10\.0× larger\)/);
  assert.equal(o.savingBytes, 960_000); // keeps (2/10)^2 = 4% of the pixels
});

test('legacy formats are flagged by size, with measured WebP savings when known', () => {
  assert.deepEqual(rules(img({ type: 'jpg', bytes: 10_000 })), []); // small JPEG is fine
  const est = auditImage(img({ type: 'jpg', bytes: 200_000 }))[0];
  assert.equal(est.rule, 'legacy-format');
  assert.equal(est.savingBytes, 60_000);
  const measured = auditImage(img({ type: 'png', bytes: 200_000, webpBytes: 50_000 }))[0];
  assert.match(measured.detail, /75% smaller \(measured\)/);
  assert.equal(measured.savingBytes, 150_000);
  // If WebP turns out bigger, it is not suggested.
  assert.deepEqual(rules(img({ type: 'png', bytes: 200_000, webpBytes: 250_000 })), []);
  // SVG and GIF are never "legacy".
  assert.deepEqual(rules(img({ type: 'svg', bytes: 500_000 })), []);
});

test('lazy loading: offscreen should be lazy, first screen should not', () => {
  assert.deepEqual(rules(img({ audit: facts({ top: 2000 }) })), ['not-lazy']);
  assert.deepEqual(rules(img({ audit: facts({ top: 2000, loading: 'lazy' }) })), []);
  assert.deepEqual(rules(img({ audit: facts({ top: 50, loading: 'lazy' }) })), ['lazy-above-fold']);
  // Images inside iframes are measured in the frame, so position rules are skipped.
  assert.deepEqual(rules(img({ audit: facts({ top: 2000, inFrame: true }) })), []);
});

test('missing width/height attributes; CSS backgrounds have no element facts', () => {
  assert.deepEqual(rules(img({ audit: facts({ sized: false }) })), ['no-dimensions']);
  assert.deepEqual(rules(img({ source: 'css', audit: undefined, type: 'webp' })), []);
});

test('page report: worst first, per-rule counts, non-overlapping saving, CSV', () => {
  const report = auditImages([
    img({ url: 'https://site.test/ok.webp' }),
    img({ url: 'https://site.test/big.jpg', type: 'jpg', width: 4000, height: 3000, bytes: 1_000_000 }),
    img({ url: 'https://site.test/noalt.webp', audit: facts({ hasAlt: false }) }),
  ]);
  assert.equal(report.total, 3);
  assert.equal(report.withIssues, 2);
  assert.equal(report.items[0].img.url, 'https://site.test/noalt.webp'); // error before warnings
  assert.equal(report.byRule['missing-alt'].count, 1);
  assert.equal(report.byRule.oversized.count, 1);
  assert.equal(report.byRule['legacy-format'].count, 1);
  assert.equal(report.savingBytes, 960_000); // the larger of the big JPEG's two savings, not their sum
  const csv = auditToCSV(report).split('\n');
  assert.equal(csv[0], 'url,page,issue,severity,detail,estimated_saving_bytes,how_to_fix');
  assert.equal(csv.length, 1 + 3);
  assert.ok(csv.some((l) => l.includes(RULES['missing-alt'].label)));
  assert.ok(csv.some((l) => l.includes(',4000×3000 shown at 400×300 (10.0× larger),960000,')));
});
