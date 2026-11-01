// Collections: named sets of images saved from any page, kept in the browser's local extension storage.
// The list operations are pure (unit-tested); load/save are thin storage wrappers.
import { api } from './browser.js';
import { cleanRights } from './rights.js';

export const COLLECTIONS_KEY = 'collections';
const MAX_DATA_URI = 200 * 1024; // inline images larger than this are not stored (they would bloat storage)

const FIELDS = ['url', 'type', 'width', 'height', 'alt', 'title', 'source', 'pageUrl', 'pageTitle', 'bytes', 'rights'];
const BACKUP_FORMAT = 'image-scraper-collections';
const MAX_TAGS = 20;

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

// Comma-separated text to a clean tag list.
export function parseTags(text) {
  const tags = String(text ?? '').split(',').map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean);
  return [...new Set(tags)].slice(0, MAX_TAGS);
}

export function setCollectionDetails(collections, id, { tags, note }, now = Date.now()) {
  return collections.map((c) => (c.id === id ? { ...c, tags: parseTags(tags), note: String(note ?? '').trim().slice(0, 1000), updated: now } : c));
}

export function matchesCollection(collection, query) {
  const q = query.trim().toLowerCase();
  return !q || `${collection.name} ${collection.note ?? ''} ${(collection.tags ?? []).join(' ')}`.toLowerCase().includes(q);
}

export function backupCollections(collections, now = Date.now()) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exported: new Date(now).toISOString(), collections }, null, 2);
}

// A backup file is untrusted: keep only web or inline image URLs and fields of the expected type.
function restoredImage(img, now) {
  if (typeof img?.url !== 'string' || !(/^https?:\/\//i.test(img.url) || /^data:image\//i.test(img.url))) return null;
  const out = {};
  for (const key of FIELDS) {
    const value = img[key];
    if (key === 'rights') {
      const rights = cleanRights(value);
      if (rights) out.rights = rights;
    } else if (key === 'width' || key === 'height' || key === 'bytes') {
      if (Number.isFinite(value) && value >= 0) out[key] = value;
    } else if (typeof value === 'string' && value) out[key] = value.slice(0, 2000);
  }
  out.url = img.url; // not shortened: the cut above is for text fields
  return { ...out, addedAt: Number.isFinite(img.addedAt) ? img.addedAt : now };
}

// Merges a backup: collections with the same id gain the missing images, others are added.
export function restoreCollections(existing, text, now = Date.now()) {
  const data = JSON.parse(text);
  if (data?.format !== BACKUP_FORMAT || !Array.isArray(data.collections)) throw new Error('This is not a collections backup');
  let collections = existing;
  let created = 0;
  let images = 0;
  for (const raw of data.collections) {
    const incoming = (Array.isArray(raw?.images) ? raw.images : []).map((img) => restoredImage(img, now)).filter(Boolean);
    let id = typeof raw?.id === 'string' ? raw.id : '';
    if (!collections.some((c) => c.id === id)) {
      const made = createCollection(collections, raw?.name, now);
      id = /^c[a-z0-9]{1,24}$/.test(id) ? id : made.collection.id;
      const tags = Array.isArray(raw?.tags) ? raw.tags.join(',') : '';
      collections = made.collections.map((c) => (c === made.collection ? { ...c, id, tags: parseTags(tags), note: String(raw?.note ?? '').slice(0, 1000) } : c));
      created++;
    }
    const known = new Set(collections.find((c) => c.id === id).images.map((i) => i.url));
    const fresh = incoming.filter((img) => !known.has(img.url) && (!img.url.startsWith('data:') || img.url.length <= MAX_DATA_URI));
    if (fresh.length) {
      collections = collections.map((c) => (c.id === id ? { ...c, images: [...c.images, ...fresh], updated: now } : c));
      images += fresh.length;
    }
  }
  return { collections, created, images };
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
