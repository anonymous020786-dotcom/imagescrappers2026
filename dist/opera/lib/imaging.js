// Browser-only image helpers used by extension pages (dashboard).
import { callInTab } from './scanner.js';
import { dHashFromGray, fitWithin, typeFromMime } from './utils.js';
import { orientTransform, outputGeometry } from './editgeom.js';
import { detectFormat, readMetadata, readRights, stripMetadata } from './exif.js';
import { jpegInfo } from './pdf.js';
import { extractPalette } from './palette.js';
import { fitToBytes, planGeometry, watermarkPosition } from './prepare.js';
import { mergeRights } from './rights.js';
import { fitInCell } from './sheet.js';
import { hasTransparency, isAnimated } from './props.js';

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
  let reason = 'network error';
  if (!img.url.startsWith('blob:')) {
    try {
      const res = await fetch(img.url, { credentials: 'include', signal });
      if (res.ok) blob = await res.blob();
      else reason = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
  }
  if (!blob && img.tabId != null) {
    const results = await callInTab(img.tabId, 'fetchAsDataUrl', [img.url], true).catch(() => []);
    const hit = results.find((r) => r?.dataUrl);
    if (hit) blob = await (await fetch(hit.dataUrl)).blob();
  }
  if (!blob) throw new Error(`Could not fetch image (${reason})`);
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

// Whether any sampled pixel is see-through (a 64×64 sample keeps this fast for large images).
function transparent(el) {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(el, 0, 0, 64, 64);
  return hasTransparency(ctx.getImageData(0, 0, 64, 64).data);
}

// RGBA pixels of an image scaled to width×height, for comparing two images.
export async function pixelsOf(blob, width, height) {
  const decoded = await decode(blob);
  try {
    const c = canvas(width, height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(decoded.el, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, natural: { width: decoded.width, height: decoded.height } };
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

// A square PNG of `size` px with the image centred and fitted (transparent margins), for icon packs.
export async function squarePng(blob, size) {
  const decoded = await decode(blob);
  try {
    const c = canvas(size, size);
    const ctx = c.getContext('2d');
    const scale = Math.min(size / decoded.width, size / decoded.height);
    const w = Math.round(decoded.width * scale);
    const h = Math.round(decoded.height * scale);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.el, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
    return await encode(c, 'image/png');
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

// Fills in exact bytes, MIME type, natural dimensions, perceptual hash, colour, animation and transparency.
export async function analyze(img, signal) {
  const blob = await fetchBlob(img, signal);
  const info = { bytes: blob.size, mime: blob.type };
  const type = typeFromMime(blob.type);
  if (type) info.type = type;
  const bytes = await blob.arrayBuffer();
  const rights = mergeRights(img.rights, readRights(bytes));
  if (rights) info.rights = rights;
  info.animated = isAnimated(bytes);
  try {
    const decoded = await decode(blob);
    info.width = decoded.width;
    info.height = decoded.height;
    info.hash = dHash(decoded.el);
    info.color = dominantColor(decoded.el);
    info.transparent = transparent(decoded.el);
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

function drawWatermark(ctx, width, height, { text, logo, position, opacity, scale }) {
  ctx.save();
  ctx.globalAlpha = opacity;
  if (logo) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round((w * logo.height) / logo.width));
    const at = watermarkPosition(width, height, w, h, position);
    ctx.drawImage(logo, at.x, at.y, w, h);
  } else if (text) {
    ctx.font = '600 100px system-ui, sans-serif';
    // Sized so the text spans `scale` of the width, without being taller than a fifth of the image.
    const size = Math.max(10, Math.min(height / 5, (100 * width * scale) / ctx.measureText(text).width));
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    const at = watermarkPosition(width, height, Math.ceil(ctx.measureText(text).width), Math.ceil(size * 1.2), position);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, size / 12);
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.strokeText(text, at.x, at.y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, at.x, at.y);
  }
  ctx.restore();
}

// Applies a preparation plan (see prepare.js) and encodes the result. Returns { blob, met }, where met is false
// when the target file size could not be reached. Formats that can't be redrawn safely (GIF animation, SVG) pass
// through unchanged unless a conversion was asked for.
export async function prepareImage(blob, target, plan, quality = 0.92) {
  const mime = target === 'original' ? Object.values(CONVERT_MIME).find((m) => m === blob.type) : CONVERT_MIME[target];
  if (!mime) return { blob, met: true };
  const decoded = await decode(blob);
  try {
    const paint = (scale) => {
      const g = planGeometry(decoded.width, decoded.height, plan, scale);
      const c = canvas(g.width, g.height);
      const ctx = c.getContext('2d');
      if (g.pad || mime === 'image/jpeg') {
        ctx.fillStyle = g.pad ? plan.background : '#ffffff';
        ctx.fillRect(0, 0, g.width, g.height);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(decoded.el, g.x, g.y, g.drawWidth, g.drawHeight);
      drawWatermark(ctx, g.width, g.height, plan.watermark);
      return c;
    };
    return await fitToBytes((q, scale) => encode(paint(scale), mime, q), plan.maxBytes, {
      quality, lossy: mime !== 'image/png', canShrink: !plan.width, // an exact size must stay exact
    });
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

// One decoded animation frame (a VideoFrame) as a PNG.
export function frameToPng(frame) {
  const c = canvas(frame.displayWidth, frame.displayHeight);
  c.getContext('2d').drawImage(frame, 0, 0);
  return encode(c, 'image/png');
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
// `filter` is a CSS filter string from the editor's adjustments (brightness, contrast, saturation…), or ''.
export async function renderEdited(blob, { rotation = 0, flipH = false, flipV = false, crop, maxWidth = 0, filter = '' }, mime, quality = 0.92) {
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
    if (filter && 'filter' in ctx) ctx.filter = filter;
    const s = g.source;
    ctx.drawImage(full, s.x, s.y, s.width, s.height, 0, 0, g.output.width, g.output.height);
    return await encode(out, mime, quality);
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

// JPEG bytes ready to embed in a PDF. JPEGs are used as they are (no quality loss) unless they rely on an
// EXIF rotation, which PDF viewers ignore; everything else is drawn on white and encoded as JPEG.
export async function pdfImage(blob, quality = 0.92) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const info = jpegInfo(bytes);
  if (info && (readMetadata(bytes)?.exif?.orientation ?? 1) <= 1) return { bytes, ...info };
  const decoded = await decode(blob);
  try {
    const c = canvas(decoded.width, decoded.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, decoded.width, decoded.height);
    ctx.drawImage(decoded.el, 0, 0, decoded.width, decoded.height);
    const jpeg = new Uint8Array(await (await encode(c, 'image/jpeg', quality)).arrayBuffer());
    const out = jpegInfo(jpeg);
    if (!out) throw new Error('Could not encode the image as JPEG');
    return { bytes: jpeg, ...out };
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

// Main colours of an image (sampled from a small copy).
export async function paletteOf(blob, count = 6) {
  const decoded = await decode(blob);
  try {
    const k = Math.min(1, 200 / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * k));
    const h = Math.max(1, Math.round(decoded.height * k));
    const c = canvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(decoded.el, 0, 0, w, h);
    return extractPalette(ctx.getImageData(0, 0, w, h).data, count);
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

function ellipsize(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

// Draws one contact sheet. entries[i] = { blob | null, label, detail } for cell.index i; returns a PNG blob.
export async function renderContactSheet(layout, sheet, entries, title) {
  const c = canvas(layout.width, sheet.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.width, sheet.height);
  ctx.fillStyle = '#111111';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(ellipsize(ctx, title, layout.width - 48), 24, 24);
  for (const cell of sheet.cells) {
    const entry = entries[cell.index];
    ctx.fillStyle = '#f1f1f4';
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    if (entry?.blob) {
      try {
        const d = await decode(entry.blob);
        try {
          const f = fitInCell(d.width, d.height, cell);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(d.el, f.x, f.y, f.w, f.h);
        } finally {
          URL.revokeObjectURL(d.url);
        }
      } catch { /* undecodable: leave the grey box */ }
    }
    ctx.fillStyle = '#111111';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(ellipsize(ctx, entry?.label ?? '', cell.w), cell.x, cell.captionY);
    ctx.fillStyle = '#666666';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(ellipsize(ctx, entry?.detail ?? '', cell.w), cell.x, cell.captionY + 15);
  }
  return encode(c, 'image/png');
}

export async function copyImageToClipboard(blob) {
  const png = blob.type === 'image/png' ? blob : await convert(blob, 'png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
