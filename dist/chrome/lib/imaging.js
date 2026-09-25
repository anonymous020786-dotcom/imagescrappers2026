// Browser-only image helpers used by extension pages (dashboard).
import { callInTab } from './scanner.js';
import { dHashFromGray, typeFromMime } from './utils.js';

const blobCache = new Map();
const MAX_CACHE_BYTES = 400 * 1024 * 1024;
let cacheBytes = 0;

function remember(url, blob) {
  if (cacheBytes + blob.size > MAX_CACHE_BYTES) return;
  blobCache.set(url, blob);
  cacheBytes += blob.size;
}

// Fetches image bytes. Extension pages with host permissions bypass CORS; if the
// server still refuses (hotlink protection, cookies, blob: URLs), fall back to
// fetching from inside the page itself.
export async function fetchBlob(img, signal) {
  if (blobCache.has(img.url)) return blobCache.get(img.url);
  let blob = null;
  if (!img.url.startsWith('blob:')) {
    try {
      const res = await fetch(img.url, { credentials: 'include', signal });
      if (res.ok) blob = await res.blob();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
  }
  if (!blob && img.tabId != null) {
    const results = await callInTab(img.tabId, 'fetchAsDataUrl', [img.url], true).catch(() => []);
    const hit = results.find((r) => r?.dataUrl);
    if (hit) blob = await (await fetch(hit.dataUrl)).blob();
  }
  if (!blob) throw new Error('Could not fetch image');
  remember(img.url, blob);
  return blob;
}

export async function decode(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const el = new Image();
    el.decoding = 'async';
    el.src = url;
    await el.decode();
    let width = el.naturalWidth;
    let height = el.naturalHeight;
    // SVGs without intrinsic size report 0; give them a sensible raster size.
    if (!width || !height) {
      width = 512;
      height = 512;
    }
    return { el, width, height, url };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function dHash(el) {
  const c = canvas(9, 8);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 9, 8);
  ctx.drawImage(el, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  const gray = new Array(72);
  for (let i = 0; i < 72; i++) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  return dHashFromGray(gray);
}

// Most common colour after quantising to 4 bits per channel (ignores transparency).
function dominantColor(el) {
  const c = canvas(24, 24);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(el, 0, 0, 24, 24);
  const { data } = ctx.getImageData(0, 0, 24, 24);
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += data[i];
    b.g += data[i + 1];
    b.b += data[i + 2];
    buckets.set(key, b);
  }
  let best = null;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  if (!best) return null;
  const hex = (v) => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

// Fills in exact bytes, MIME type, natural dimensions, perceptual hash and colour.
export async function analyze(img, signal) {
  const blob = await fetchBlob(img, signal);
  const info = { bytes: blob.size, mime: blob.type };
  const type = typeFromMime(blob.type);
  if (type) info.type = type;
  try {
    const decoded = await decode(blob);
    info.width = decoded.width;
    info.height = decoded.height;
    info.hash = dHash(decoded.el);
    info.color = dominantColor(decoded.el);
    URL.revokeObjectURL(decoded.url);
  } catch {
    // Undecodable (e.g. TIFF in Chrome): keep byte info only.
  }
  return info;
}

const CONVERT_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

export async function convert(blob, target, quality = 0.92) {
  const mime = CONVERT_MIME[target];
  if (!mime || blob.type === mime) return blob;
  const decoded = await decode(blob);
  try {
    const c = canvas(decoded.width, decoded.height);
    const ctx = c.getContext('2d');
    if (target === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, decoded.width, decoded.height);
    }
    ctx.drawImage(decoded.el, 0, 0, decoded.width, decoded.height);
    if (c.convertToBlob) return await c.convertToBlob({ type: mime, quality });
    return await new Promise((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion failed'))), mime, quality),
    );
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

export async function copyImageToClipboard(blob) {
  const png = blob.type === 'image/png' ? blob : await convert(blob, 'png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
