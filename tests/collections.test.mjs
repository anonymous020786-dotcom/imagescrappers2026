import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addImages, createCollection, deleteCollection, removeImages, renameCollection, sortCollections, storedImage,
} from '../src/lib/collections.js';

const img = (url, extra = {}) => ({ url, type: 'jpg', width: 100, height: 50, alt: '', selected: true, hash: 'abc', tabId: 7, ...extra });

test('stores only the useful fields of an image', () => {
  assert.deepEqual(storedImage(img('https://a.test/1.jpg', { pageUrl: 'https://a.test/' }), 5), {
    addedAt: 5, url: 'https://a.test/1.jpg', type: 'jpg', width: 100, height: 50, pageUrl: 'https://a.test/',
  });
});

test('create, add without duplicates, remove, rename, delete', () => {
  let { collections, collection } = createCollection([], '  Holiday ideas  ', 1000);
  assert.equal(collection.name, 'Holiday ideas');
  assert.equal(createCollection([], '   ', 1).collection.name, 'Untitled');

  let r = addImages(collections, collection.id, [img('https://a.test/1.jpg'), img('https://a.test/2.jpg'), img('https://a.test/1.jpg')], 2000);
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 1);
  r = addImages(r.collections, collection.id, [img('https://a.test/2.jpg'), img(`data:image/png;base64,${'A'.repeat(300 * 1024)}`)], 3000);
  assert.equal(r.added, 0);
  assert.equal(r.skipped, 2); // already there + huge inline image
  collections = r.collections;
  assert.equal(collections[0].images.length, 2);
  assert.equal(collections[0].updated, 2000); // nothing added, timestamp unchanged

  collections = removeImages(collections, collection.id, ['https://a.test/1.jpg'], 4000);
  assert.deepEqual(collections[0].images.map((i) => i.url), ['https://a.test/2.jpg']);
  collections = renameCollection(collections, collection.id, 'Trips', 5000);
  assert.equal(collections[0].name, 'Trips');
  assert.equal(renameCollection(collections, collection.id, '  ')[0].name, 'Trips');
  assert.deepEqual(deleteCollection(collections, collection.id), []);
});

test('collections are listed most recently changed first', () => {
  const a = { id: 'a', updated: 1 };
  const b = { id: 'b', updated: 3 };
  assert.deepEqual(sortCollections([a, b]).map((c) => c.id), ['b', 'a']);
});
