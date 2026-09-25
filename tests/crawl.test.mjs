import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countPattern, expandPattern } from '../src/lib/urlgen.js';
import { crawlDelay, isAllowed, parseRobots } from '../src/lib/robots.js';
import {
  canonicalPageUrl, decodeHtml, extractUrls, hash53, inScope, isCrawlableUrl, passesPatterns, sniffCharset, withRetry,
} from '../src/lib/crawl.js';
import { guessType } from '../src/lib/utils.js';

test('expandPattern: numeric, padded, stepped, letters, lists and products', () => {
  assert.deepEqual(expandPattern('a[1-3].jpg').urls, ['a1.jpg', 'a2.jpg', 'a3.jpg']);
  assert.deepEqual(expandPattern('[008-011]').urls, ['008', '009', '010', '011']);
  assert.deepEqual(expandPattern('[0-10:5]').urls, ['0', '5', '10']);
  assert.deepEqual(expandPattern('[3-1]').urls, ['3', '2', '1']);
  assert.deepEqual(expandPattern('[a-c]').urls, ['a', 'b', 'c']);
  assert.deepEqual(expandPattern('x.{jpg,png}').urls, ['x.jpg', 'x.png']);
  assert.deepEqual(expandPattern('p[1-2]_{a,b}').urls, ['p1_a', 'p1_b', 'p2_a', 'p2_b']);
  assert.deepEqual(expandPattern('plain').urls, ['plain']);
});

test('expandPattern respects the limit and reports the total', () => {
  const res = expandPattern('https://x.com/[1-1000]/[1-1000].jpg', 5);
  assert.equal(res.total, 1_000_000);
  assert.equal(res.urls.length, 5);
  assert.ok(res.truncated);
  assert.equal(res.urls[4], 'https://x.com/1/5.jpg');
  assert.equal(countPattern('[1-10]{a,b,c}'), 30);
});

test('robots.txt: groups, longest match, allow ties, wildcards, sitemaps', () => {
  const robots = parseRobots(`
User-agent: badbot
Disallow: /

User-agent: *
Disallow: /private/
Allow: /private/public-*
Disallow: /*.pdf$
Disallow:
Crawl-delay: 2
Sitemap: https://x.com/sitemap.xml
`);
  assert.deepEqual(robots.sitemaps, ['https://x.com/sitemap.xml']);
  assert.ok(isAllowed(robots, 'https://x.com/'));
  assert.ok(!isAllowed(robots, 'https://x.com/private/a'));
  assert.ok(isAllowed(robots, 'https://x.com/private/public-gallery'));
  assert.ok(!isAllowed(robots, 'https://x.com/doc.pdf'));
  assert.ok(isAllowed(robots, 'https://x.com/doc.pdf?x=1'));
  assert.ok(!isAllowed(robots, 'https://x.com/anything', 'BadBot/1.0'));
  assert.equal(crawlDelay(robots), 2);
  assert.ok(isAllowed(null, 'https://x.com/private/'));
});

test('sniffCharset: BOM, header, meta, default', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(sniffCharset('', new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), 'utf-8');
  assert.equal(sniffCharset('text/html; charset=Shift_JIS', enc('')), 'shift_jis');
  assert.equal(sniffCharset('text/html', enc('<html><head><meta charset="windows-1251">')), 'windows-1251');
  assert.equal(sniffCharset('text/html', enc('<meta http-equiv="Content-Type" content="text/html; charset=euc-kr">')), 'euc-kr');
  assert.equal(sniffCharset('text/html', enc('<p>hi</p>')), 'utf-8');
});

test('decodeHtml decodes legacy encodings (Windows-1251 Cyrillic)', () => {
  // "Привет" in windows-1251
  const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  const { text, charset } = decodeHtml(bytes, 'text/html; charset=windows-1251');
  assert.equal(charset, 'windows-1251');
  assert.equal(text, 'Привет');
});

test('inScope: host, domain (subdomains), any, page', () => {
  const root = 'https://www.example.com/start';
  assert.ok(inScope('https://example.com/a', root, 'host'));
  assert.ok(!inScope('https://cdn.example.com/a', root, 'host'));
  assert.ok(inScope('https://cdn.example.com/a', root, 'domain'));
  assert.ok(!inScope('https://example.org/a', root, 'domain'));
  assert.ok(!inScope('https://notexample.com/a', root, 'domain'));
  assert.ok(inScope('https://other.org/', root, 'any'));
  assert.ok(!inScope('https://example.com/a', root, 'page'));
});

test('crawlable URLs, canonicalisation and include/exclude patterns', () => {
  assert.ok(isCrawlableUrl('https://x.com/gallery/2'));
  assert.ok(!isCrawlableUrl('https://x.com/a.pdf'));
  assert.ok(!isCrawlableUrl('mailto:a@b.c'));
  assert.equal(canonicalPageUrl('https://x.com/a?utm_source=t&id=2#top'), 'https://x.com/a?id=2');
  assert.ok(passesPatterns('https://x.com/gallery/1', ['*/gallery/*'], []));
  assert.ok(!passesPatterns('https://x.com/blog/1', ['*/gallery/*'], []));
  assert.ok(!passesPatterns('https://x.com/gallery/login', [], ['*login*']));
});

test('extractUrls finds URLs in pasted text, CSV and HTML', () => {
  const text = 'see https://a.com/x.jpg, and "https://b.com/p?q=1". <a href="https://c.com/">c</a>\nhttps://d.com/y.png';
  assert.deepEqual(extractUrls(text), ['https://a.com/x.jpg', 'https://b.com/p?q=1', 'https://c.com/', 'https://d.com/y.png']);
});

test('hash53 is stable and distinguishes inputs', () => {
  assert.equal(hash53('https://x.com/a.jpg'), hash53('https://x.com/a.jpg'));
  assert.notEqual(hash53('https://x.com/a.jpg'), hash53('https://x.com/b.jpg'));
});

test('withRetry retries with backoff and stops on success', async () => {
  let calls = 0;
  const out = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('flaky');
    return 'ok';
  }, 3, 1);
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  await assert.rejects(withRetry(async () => { throw new Error('always'); }, 2, 1), /always/);
});

test('JPEG XL and HEIC are recognised', () => {
  assert.equal(guessType('https://x.com/a.jxl'), 'jxl');
  assert.equal(guessType('https://x.com/a.HEIC'), 'heic');
  assert.equal(guessType('https://x.com/a', 'image/jxl'), 'jxl');
});
