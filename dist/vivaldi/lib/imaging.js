// Browser-only image helpers used by extension pages (dashboard).
import { callInTab } from './scanner.js';
import { dHashFromGray, fitWithin, typeFromMime } from './utils.js';
import { orientTransform, outputGeometry } from './editgeom.js';
import { detectFormat, stripMetadata } from './exif.js';

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

export function resizeActive(s) {
  return Number(s?.resizeMaxWidth) > 0 || Number(s?.resizeMaxHeight) > 0;
}

// Converts to `target` ('original' keeps the format) and optionally shrinks to fit
// maxWidth×maxHeight. With 'original', only JPEG/PNG/WebP are re-encoded; GIF (would
// lose animation), SVG and other formats pass through unchanged.
export async function convert(blob, target, quality = 0.92, { maxWidth = 0, maxHeight = 0 } = {}) {
  const resizing = maxWidth > 0 || maxHeight > 0;
  const mime = target === 'original' ? Object.values(CONVERT_MIME).find((m) => m === blob.type) : CONVERT_MIME[target];
  if (!mime || (blob.type === mime && !resizing)) return blob;
  const decoded = await decode(blob);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, maxWidth, maxHeight);
    if (blob.type === mime && width === decoded.width && height === decoded.height) return blob;
    const c = canvas(width, height);
    const ctx = c.getContext('2d');
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.el, 0, 0, width, height);
    if (c.convertToBlob) return await c.convertToBlob({ type: mime, quality });
    return await new Promise((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion failed'))), mime, quality),
    );
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

function encode(c, mime, quality) {
  if (c.convertToBlob) return c.convertToBlob({ type: mime, quality });
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion failed'))), mime, quality),
  );
}

const FORMAT_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Removes EXIF (camera, GPS location, dates), XMP, comments and text chunks from JPEG, PNG and WebP.
// Lossless when possible; a rotated JPEG is re-encoded upright so it doesn't lose its orientation.
// Other formats are returned unchanged. Everything happens locally.
export async function removeMetadata(blob, quality = 0.92) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const format = detectFormat(bytes);
  if (!format) return { blob, removed: 0 };
  const mime = FORMAT_MIME[format];
  const res = stripMetadata(bytes);
  if (res.needsReencode) {
    // Browsers apply EXIF orientation when decoding, so drawing the image gives the upright pixels.
    const decoded = await decode(blob);
    try {
      const c = canvas(decoded.width, decoded.height);
      c.getContext('2d').drawImage(decoded.el, 0, 0);
      const out = await encode(c, mime, quality);
      return { blob: out, removed: Math.max(0, bytes.length - out.size), reencoded: true };
    } finally {
      URL.revokeObjectURL(decoded.url);
    }
  }
  if (!res.removed) return { blob, removed: 0 };
  return { blob: new Blob([res.bytes], { type: mime }), removed: res.removed };
}

// Applies editor settings: rotation (0/90/180/270), flips, crop (fractions of the rotated image),
// optional max width, then encodes as `mime`. Never upscales.
export async function renderEdited(blob, { rotation = 0, flipH = false, flipV = false, crop, maxWidth = 0 }, mime, quality = 0.92) {
  const decoded = await decode(blob);
  try {
    const { width, height } = decoded;
    const g = outputGeometry(width, height, rotation, crop, maxWidth);
    // Draw the whole image rotated/flipped into an oriented canvas, then copy the crop scaled.
    const full = canvas(g.oriented.width, g.oriented.height);
    const fctx = full.getContext('2d');
    fctx.setTransform(...orientTransform(width, height, rotation, flipH, flipV));
    fctx.drawImage(decoded.el, 0, 0, width, height);
    const out = canvas(g.output.width, g.output.height);
    const ctx = out.getContext('2d');
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, g.output.width, g.output.height);
    }
    ctx.imageSmoothingQuality = 'high';
    const s = g.source;
    ctx.drawImage(full, s.x, s.y, s.width, s.height, 0, 0, g.output.width, g.output.height);
    return await encode(out, mime, quality);
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

export async function copyImageToClipboard(blob) {
  const png = blob.type === 'image/png' ? blob : await convert(blob, 'png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
