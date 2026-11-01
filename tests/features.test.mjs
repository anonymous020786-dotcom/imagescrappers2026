import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  colorFamily, duplicateGroups, filterImages, markVisualDuplicates, previewNames, rankSimilar, toSnippet,
} from '../src/lib/utils.js';
import { auditByPage, auditImage, auditImages, pageAuditToCSV } from '../src/lib/audit.js';
import {
  addImages, backupCollections, createCollection, matchesCollection, parseTags, restoreCollections, setCollectionDetails,
} from '../src/lib/collections.js';
import { findProfile, profileFilters, removeProfile, setProfile, withProfile } from '../src/lib/profiles.js';

test('names everyday colours', () => {
  const cases = {
    '#e02020': 'red', '#f08020': 'orange', '#f0e020': 'yellow', '#20c040': 'green', '#20c0c0': 'teal', '#2050e0': 'blue',
    '#8030d0': 'purple', '#f050a0': 'pink', '#6b3a10': 'brown', '#050505': 'black', '#808080': 'gray', '#fafafa': 'white',
  };
  for (const [hex, name] of Object.entries(cases)) assert.equal(colorFamily(hex), name, hex);
  assert.equal(colorFamily(null), null);
  assert.equal(colorFamily('red'), null);
});

test('filters by colour, hiding images not analyzed yet', () => {
  const images = [{ url: 'a', color: '#2050e0' }, { url: 'b', color: '#e02020' }, { url: 'c' }];
  assert.deepEqual(filterImages(images, { colors: ['blue'] }).map((i) => i.url), ['a']);
  assert.equal(filterImages(images, { colors: [] }).length, 3);
});

test('filters by credit and licence', () => {
  const images = [
    { url: 'a', rights: { license: 'https://creativecommons.org/licenses/by/4.0/' } },
    { url: 'b', rights: { copyright: '© Someone' } },
    { url: 'c' },
  ];
  const urls = (rights) => filterImages(images, { rights }).map((i) => i.url).join('');
  assert.equal(urls('any'), 'abc');
  assert.equal(urls('known'), 'ab');
  assert.equal(urls('open'), 'a');
  assert.equal(urls('none'), 'c');
});

test('ranks similar images closest first, leaving out unrelated and unhashed ones', () => {
  const images = [
    { url: 'far', hash: 'ffffffffffffffff', order: 0 },
    { url: 'near', hash: '0000000000000003', order: 1 },
    { url: 'self', hash: '0000000000000000', order: 2 },
    { url: 'nohash', order: 3 },
  ];
  assert.deepEqual(rankSimilar(images, '0000000000000000').map((i) => i.url), ['self', 'near']);
});

test('the largest copy, then the heaviest, is kept as the best duplicate', () => {
  const a = { id: 'a', hash: '00', width: 100, height: 100, bytes: 5 };
  const b = { id: 'b', hash: '00', width: 400, height: 400, bytes: 5 };
  const c = { id: 'c', hash: '00', width: 400, height: 400, bytes: 9 };
  const other = { id: 'd', hash: 'ff', width: 50, height: 50 };
  markVisualDuplicates([a, b, c, other], 1);
  const groups = duplicateGroups([a, b, c, other]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].best, c);
  assert.deepEqual(groups[0].others.map((i) => i.id).sort(), ['a', 'b']);
});

test('copies images as Markdown, HTML and BBCode', () => {
  const images = [
    { url: 'https://x.test/a b(1).jpg', alt: 'A [nice] photo', width: 10, height: 20 },
    { url: 'data:image/png;base64,AAAA', alt: 'inline' },
  ];
  assert.deepEqual(toSnippet(images, 'markdown'), { text: '![A \\[nice\\] photo](https://x.test/a%20b%281%29.jpg)', skipped: 1 });
  assert.equal(toSnippet(images, 'bbcode').text, '[img]https://x.test/a%20b%281%29.jpg[/img]');
  assert.equal(toSnippet(images, 'html').text, '<img src="https://x.test/a b(1).jpg" alt="A [nice] photo" width="10" height="20">');
  assert.equal(toSnippet([{ url: 'https://x.test/a.jpg', alt: '"><script>' }], 'html').text, '<img src="https://x.test/a.jpg" alt="&quot;&gt;&lt;script&gt;">');
  assert.equal(toSnippet([images[1]], 'markdown').text, '');
});

test('name preview marks clashes, ignoring case', () => {
  const images = [{ n: 'A.jpg' }, { n: 'a.JPG' }, { n: 'b.jpg' }];
  const { rows, clashes } = previewNames(images, (img) => img.n);
  assert.equal(clashes, 2);
  assert.deepEqual(rows.map((r) => r.clash), [true, true, false]);
  assert.equal(previewNames(images, (img, i) => `${i}.jpg`).clashes, 0);
});

const element = (extra) => ({ source: 'img', type: 'png', audit: { hasAlt: true, sized: true, loading: '', staticHtml: true }, ...extra });

test('audits images from a fast crawl, which have no layout information', () => {
  const rules = (img) => auditImage(img).map((i) => i.rule);
  assert.deepEqual(rules(element({ audit: { hasAlt: false, sized: false, loading: '', staticHtml: true } })), ['missing-alt', 'no-dimensions']);
  assert.deepEqual(rules(element({ width: 8, audit: { hasAlt: false, sized: false, staticHtml: true } })), []); // tiny icon
  assert.deepEqual(rules(element({})), []);
  // Images found by a live scan still need to be visible to be flagged.
  assert.deepEqual(rules({ source: 'img', type: 'png', audit: { hasAlt: false, sized: true } }), []);
});

test('groups audit findings by page, biggest saving first', () => {
  const report = auditImages([
    element({ pageUrl: 'https://s.test/a', audit: { hasAlt: false, sized: true, staticHtml: true } }),
    { source: 'img', type: 'jpg', bytes: 500000, pageUrl: 'https://s.test/b', pageTitle: '=cmd' },
    { source: 'img', type: 'jpg', bytes: 100000, pageUrl: 'https://s.test/b' },
    element({ pageUrl: 'https://s.test/c' }),
  ]);
  const pages = auditByPage(report);
  assert.deepEqual(pages.map((p) => p.page), ['https://s.test/b', 'https://s.test/a']);
  assert.equal(pages[0].images, 2);
  assert.equal(pages[0].notes, 2);
  assert.equal(pages[0].savingBytes, 180000);
  assert.equal(pages[1].errors, 1);
  const csv = pageAuditToCSV(pages);
  assert.match(csv.split('\n')[1], /^https:\/\/s\.test\/b,'=cmd,2,0,0,2,180000$/);
});

test('collection tags and notes are cleaned and searchable', () => {
  assert.deepEqual(parseTags(' Travel, travel , , Client Work '), ['travel', 'client work']);
  const { collections, collection } = createCollection([], 'Trips', 1);
  const [edited] = setCollectionDetails(collections, collection.id, { tags: 'Beach, 2026', note: ' Summer ideas ' }, 2);
  assert.deepEqual(edited.tags, ['beach', '2026']);
  assert.equal(edited.note, 'Summer ideas');
  assert.equal(edited.updated, 2);
  for (const q of ['trip', 'BEACH', 'summer', '']) assert.ok(matchesCollection(edited, q), q);
  assert.equal(matchesCollection(edited, 'winter'), false);
});

test('a backup restores into an empty profile and merges into an existing one', () => {
  let { collections, collection } = createCollection([], 'Trips', 1);
  collections = addImages(collections, collection.id, [{ url: 'https://x.test/1.jpg', rights: { creator: 'Ana' } }], 2).collections;
  collections = setCollectionDetails(collections, collection.id, { tags: 'a,b', note: 'n' }, 3);
  const backup = backupCollections(collections, 4);

  const fresh = restoreCollections([], backup, 5);
  assert.equal(fresh.created, 1);
  assert.equal(fresh.images, 1);
  assert.equal(fresh.collections[0].id, collection.id);
  assert.deepEqual(fresh.collections[0].tags, ['a', 'b']);
  assert.equal(fresh.collections[0].images[0].rights.creator, 'Ana');

  const again = restoreCollections(fresh.collections, backup, 6);
  assert.equal(again.created, 0);
  assert.equal(again.images, 0);
  assert.equal(again.collections.length, 1);
});

test('a backup file is treated as untrusted', () => {
  assert.throws(() => restoreCollections([], '{"hello":1}'), /not a collections backup/);
  assert.throws(() => restoreCollections([], 'not json'));
  const evil = JSON.stringify({
    format: 'image-scraper-collections',
    collections: [{
      id: 'x"><img', name: 42, tags: 'nope',
      images: [
        { url: 'javascript:alert(1)' }, { url: 'file:///etc/passwd' }, { url: 7 }, null,
        { url: 'https://x.test/ok.jpg', width: 'wide', onclick: 'x', rights: { creator: 5, evil: 'y' } },
        { url: `data:image/png;base64,${'A'.repeat(300 * 1024)}` },
      ],
    }, 'junk'],
  });
  const { collections } = restoreCollections([], evil, 9);
  const first = collections.find((c) => c.images.length);
  assert.match(first.id, /^c[a-z0-9]+$/);
  assert.equal(first.name, '42');
  assert.deepEqual(first.tags, []);
  assert.deepEqual(first.images, [{ url: 'https://x.test/ok.jpg', addedAt: 9 }]);
});

test('finds a site profile by host, then parent domains', () => {
  let profiles = setProfile({}, 'example.com', { filenameTemplate: '{name}' }, 1);
  assert.equal(findProfile(profiles, 'https://www.example.com/a').host, 'example.com');
  assert.equal(findProfile(profiles, 'https://cdn.img.example.com/a').host, 'example.com');
  assert.equal(findProfile(profiles, 'https://other.test/'), null);
  assert.equal(findProfile(profiles, 'not a url'), null);
  assert.equal(findProfile(profiles, 'http://constructor/'), null); // not an inherited object key
  assert.equal(findProfile(profiles, 'http://toString.test/'), null);
  profiles = setProfile(profiles, 'img.example.com', { filenameTemplate: 'x' }, 2);
  assert.equal(findProfile(profiles, 'https://img.example.com/').filenameTemplate, 'x');
  assert.equal(findProfile(removeProfile(profiles, 'img.example.com'), 'https://img.example.com/').host, 'example.com');
});

test('profiles keep lasting filters only and override settings when set', () => {
  assert.deepEqual(profileFilters({ minWidth: 300, text: 'cats', selectedOnly: true, domain: 'x', sortKey: 'area' }), { minWidth: 300, sortKey: 'area' });
  const settings = { filenameTemplate: 'a', folderTemplate: 'b', minWidth: 0 };
  assert.equal(withProfile(settings, null), settings);
  assert.deepEqual(
    withProfile(settings, { filenameTemplate: 'x', folderTemplate: '', filters: { minWidth: 300, sortKey: 'area' } }),
    { filenameTemplate: 'x', folderTemplate: 'b', minWidth: 300 },
  );
});
