// Collections: named sets of images saved from any page, kept in the browser's local extension storage.
// The list operations are pure (unit-tested); load/save are thin storage wrappers.
import { api } from './browser.js';

export const COLLECTIONS_KEY = 'collections';
const MAX_DATA_URI = 200 * 1024; // inline images larger than this are not stored (they would bloat storage)

const FIELDS = ['url', 'type', 'width', 'height', 'alt', 'title', 'source', 'pageUrl', 'pageTitle', 'bytes'];

// The part of a scraped image worth keeping.
export function storedImage(img, now = Date.now()) {
  const out = { addedAt: now };
  for (const key of FIELDS) if (img[key] != null && img[key] !== '') out[key] = img[key];
  return out;
}

export function createCollection(collections, name, now = Date.now()) {
  const clean = String(name ?? '').trim().slice(0, 80) || 'Untitled';
  const collection = { id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean, created: now, updated: now, images: [] };
  return { collections: [collection, ...collections], collection };
}

// Adds images not already in the collection (same URL). Returns counts of added and skipped (duplicates, huge inline).
export function addImages(collections, id, images, now = Date.now()) {
  let added = 0;
  let skipped = 0;
  const next = collections.map((c) => {
    if (c.id !== id) return c;
    const have = new Set(c.images.map((i) => i.url));
    const fresh = [];
    for (const img of images) {
      if (!img?.url || have.has(img.url) || (img.url.startsWith('data:') && img.url.length > MAX_DATA_URI)) {
        skipped++;
        continue;
      }
      have.add(img.url);
      fresh.push(storedImage(img, now));
    }
    added = fresh.length;
    return { ...c, images: [...c.images, ...fresh], updated: fresh.length ? now : c.updated };
  });
  return { collections: next, added, skipped };
}

export function removeImages(collections, id, urls, now = Date.now()) {
  const drop = new Set(urls);
  return collections.map((c) => (c.id === id ? { ...c, images: c.images.filter((i) => !drop.has(i.url)), updated: now } : c));
}

export function renameCollection(collections, id, name, now = Date.now()) {
  const clean = String(name ?? '').trim().slice(0, 80);
  if (!clean) return collections;
  return collections.map((c) => (c.id === id ? { ...c, name: clean, updated: now } : c));
}

export function deleteCollection(collections, id) {
  return collections.filter((c) => c.id !== id);
}

// Most recently changed first.
export function sortCollections(collections) {
  return [...collections].sort((a, b) => b.updated - a.updated);
}

export async function loadCollections() {
  const stored = await api.storage.local.get(COLLECTIONS_KEY).catch(() => ({}));
  return Array.isArray(stored?.[COLLECTIONS_KEY]) ? stored[COLLECTIONS_KEY] : [];
}

export async function saveCollections(collections) {
  await api.storage.local.set({ [COLLECTIONS_KEY]: collections });
}
