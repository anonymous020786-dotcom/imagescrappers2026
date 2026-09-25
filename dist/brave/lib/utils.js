// Pure helpers shared by the dashboard, background worker and unit tests.

export const IMAGE_TYPES = ['jpg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tiff', 'other'];

const MIME_TO_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/apng': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
};

const EXT_TO_TYPE = {
  jpg: 'jpg', jpeg: 'jpg', jfif: 'jpg', pjpeg: 'jpg', pjp: 'jpg',
  png: 'png', apng: 'png',
  gif: 'gif',
  webp: 'webp',
  svg: 'svg', svgz: 'svg',
  avif: 'avif',
  bmp: 'bmp',
  ico: 'ico', cur: 'ico',
  tif: 'tiff', tiff: 'tiff',
};

export const TYPE_TO_MIME = {
  jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', tiff: 'image/tiff',
};

export function typeFromMime(mime) {
  if (!mime) return null;
  return MIME_TO_TYPE[mime.split(';')[0].trim().toLowerCase()] ?? null;
}

export function extensionFromUrl(url) {
  if (!url) return '';
  if (url.startsWith('data:')) {
    return typeFromMime(url.slice(5).split(/[;,]/)[0]) ?? '';
  }
  try {
    const { pathname, searchParams } = new URL(url);
    const m = /\.([a-z0-9]{2,5})$/i.exec(pathname);
    if (m) return m[1].toLowerCase();
    // CDNs frequently put the format in a query parameter (?format=webp, ?fm=jpg).
    const fmt = searchParams.get('format') || searchParams.get('fm') || searchParams.get('ext');
    return fmt ? fmt.toLowerCase() : '';
  } catch {
    return '';
  }
}

export function guessType(url, mime) {
  return typeFromMime(mime) ?? EXT_TO_TYPE[extensionFromUrl(url)] ?? 'other';
}

export function isImageUrl(url) {
  return Boolean(EXT_TO_TYPE[extensionFromUrl(url)]);
}

export function sanitizeFilename(name, maxLength = 120) {
  const cleaned = String(name)
    .replace(/[\u0000-\u001f\u007f<>:"|?*\\/]+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .replace(/_+/g, '_');
  const out = cleaned.slice(0, maxLength);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out) ? `_${out}` : out || 'image';
}

export function sanitizePath(path) {
  return String(path)
    .split(/[\\/]+/)
    .map((seg) => seg.trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map((seg) => sanitizeFilename(seg, 80))
    .join('/');
}

export function baseNameFromUrl(url) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return 'image';
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    const withoutExt = last.replace(/\.[a-z0-9]{2,5}$/i, '');
    return sanitizeFilename(withoutExt || new URL(url).hostname || 'image');
  } catch {
    return 'image';
  }
}

export function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

// Expands a filename template. Supported tokens:
// {name} {ext} {index} {index:N} {domain} {pagedomain} {title} {date} {time}
// {timestamp} {width} {height} {alt} {type} {source}
export function applyTemplate(template, ctx) {
  const now = ctx.date ?? new Date();
  const values = {
    name: ctx.name ?? baseNameFromUrl(ctx.url),
    ext: ctx.ext ?? 'jpg',
    domain: hostFromUrl(ctx.url) || 'inline',
    pagedomain: hostFromUrl(ctx.pageUrl) || 'page',
    title: ctx.title ?? 'untitled',
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    timestamp: String(now.getTime()),
    width: ctx.width ? String(ctx.width) : '0',
    height: ctx.height ? String(ctx.height) : '0',
    alt: ctx.alt || 'no-alt',
    type: ctx.type ?? 'other',
    source: ctx.source ?? 'img',
  };
  const expanded = template.replace(/\{(\w+)(?::(\d+))?\}/g, (whole, key, width) => {
    if (key === 'index') return pad((ctx.index ?? 0) + 1, Number(width) || 1);
    if (!(key in values)) return whole;
    return sanitizeFilename(values[key], 80);
  });
  return sanitizePath(expanded);
}

export function buildFilename(template, folder, ctx) {
  let file = applyTemplate(template || '{name}', ctx);
  if (!/\.[a-z0-9]{2,5}$/i.test(file) || !template.includes('{ext}')) file = `${file}.${ctx.ext}`;
  const dir = folder ? applyTemplate(folder, ctx) : '';
  return dir ? `${dir}/${file}` : file;
}

export function normalizeUrl(url, ignoreQuery = false) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const u = new URL(url);
    u.hash = '';
    if (ignoreQuery) u.search = '';
    return u.href;
  } catch {
    return url;
  }
}

export function dedupe(images, ignoreQuery = false) {
  const seen = new Map();
  for (const img of images) {
    const key = normalizeUrl(img.url, ignoreQuery);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, { ...img, sources: [...new Set([img.source, ...(img.sources ?? [])])] });
    } else {
      prev.sources = [...new Set([...prev.sources, img.source])];
      prev.width = Math.max(prev.width || 0, img.width || 0);
      prev.height = Math.max(prev.height || 0, img.height || 0);
      prev.alt ||= img.alt;
    }
  }
  return [...seen.values()];
}

// Wildcard patterns: `*.doubleclick.net`, `*/ads/*`, or /regex/.
export function compilePattern(pattern) {
  const p = pattern.trim();
  if (!p) return null;
  if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
    try {
      return new RegExp(p.slice(1, -1), 'i');
    } catch {
      return null;
    }
  }
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(escaped, 'i');
}

export function matchesAny(url, patterns) {
  return patterns.some((p) => {
    const re = typeof p === 'string' ? compilePattern(p) : p;
    return re ? re.test(url) : false;
  });
}

export function aspectOf(img) {
  if (!img.width || !img.height) return 'unknown';
  const r = img.width / img.height;
  if (r > 1.1) return 'landscape';
  if (r < 0.9) return 'portrait';
  return 'square';
}

export function filterImages(images, f) {
  let textRe = null;
  if (f.text) {
    if (f.regex) {
      try {
        textRe = new RegExp(f.text, 'i');
      } catch {
        textRe = null;
      }
    }
  }
  const blocked = (f.blocklist ?? []).map(compilePattern).filter(Boolean);
  const text = (f.text ?? '').toLowerCase();

  return images.filter((img) => {
    const w = img.width || 0;
    const h = img.height || 0;
    const known = w > 0 && h > 0;
    if (f.hideTracking && known && w <= 2 && h <= 2) return false;
    if (known || !f.keepUnknownSize) {
      if (f.minWidth && w < f.minWidth) return false;
      if (f.minHeight && h < f.minHeight) return false;
      if (f.maxWidth && w > f.maxWidth) return false;
      if (f.maxHeight && h > f.maxHeight) return false;
    }
    if (f.types?.length && !f.types.includes(img.type)) return false;
    if (f.sources?.length && !(img.sources ?? [img.source]).some((s) => f.sources.includes(s))) return false;
    if (f.aspect && f.aspect !== 'any' && aspectOf(img) !== f.aspect) return false;
    if (f.minBytes && img.bytes != null && img.bytes < f.minBytes) return false;
    if (f.maxBytes && img.bytes != null && img.bytes > f.maxBytes) return false;
    if (f.domain && !hostFromUrl(img.url).includes(f.domain.toLowerCase())) return false;
    if (blocked.length && matchesAny(img.url, blocked)) return false;
    if (f.hideDuplicates && img.duplicateOf) return false;
    if (f.selectedOnly && !img.selected) return false;
    if (text) {
      const hay = `${img.url} ${img.alt ?? ''} ${img.title ?? ''}`;
      if (textRe ? !textRe.test(hay) : !hay.toLowerCase().includes(text)) return false;
    }
    return true;
  });
}

export function sortImages(images, key = 'order', dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const get = {
    order: (i) => i.order ?? 0,
    area: (i) => (i.width || 0) * (i.height || 0),
    width: (i) => i.width || 0,
    height: (i) => i.height || 0,
    bytes: (i) => i.bytes ?? -1,
    name: (i) => baseNameFromUrl(i.url).toLowerCase(),
    type: (i) => i.type,
    domain: (i) => hostFromUrl(i.url),
  }[key] ?? ((i) => i.order ?? 0);
  return [...images].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va < vb) return -1 * sign;
    if (va > vb) return 1 * sign;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

// Computes a 64-bit difference hash from a 9x8 grayscale pixel array.
export function dHashFromGray(gray) {
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let nibbleHi = 0;
    let nibbleLo = 0;
    for (let x = 0; x < 8; x++) {
      const bit = gray[y * 9 + x] < gray[y * 9 + x + 1] ? 1 : 0;
      if (x < 4) nibbleHi = (nibbleHi << 1) | bit;
      else nibbleLo = (nibbleLo << 1) | bit;
    }
    hex += nibbleHi.toString(16) + nibbleLo.toString(16);
  }
  return hex;
}

// Marks visually similar images: every image whose hash is within `threshold`
// bits of an earlier (larger) image gets `duplicateOf` set to that image's id.
export function markVisualDuplicates(images, threshold = 5) {
  const hashed = images
    .filter((i) => i.hash)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  const kept = [];
  let groups = 0;
  for (const img of images) delete img.duplicateOf;
  for (const img of hashed) {
    const match = kept.find((k) => hammingHex(k.hash, img.hash) <= threshold);
    if (match) {
      img.duplicateOf = match.id;
      groups++;
    } else {
      kept.push(img);
    }
  }
  return groups;
}

export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(images) {
  const cols = ['url', 'type', 'width', 'height', 'bytes', 'alt', 'sources', 'pageUrl'];
  const rows = images.map((i) =>
    cols.map((c) => csvCell(c === 'sources' ? (i.sources ?? [i.source]).join('|') : i[c])).join(','),
  );
  return [cols.join(','), ...rows].join('\n');
}

export function toJSON(images) {
  return JSON.stringify(
    images.map(({ url, type, width, height, bytes, alt, title, sources, source, pageUrl, color, hash }) => ({
      url, type, width, height, bytes, alt, title, sources: sources ?? [source], pageUrl, color, hash,
    })),
    null,
    2,
  );
}

export function toText(images) {
  return images.map((i) => i.url).join('\n');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function toHTMLGallery(images, title = 'Image gallery') {
  const items = images
    .map(
      (i) => `<figure><a href="${escapeHtml(i.url)}" target="_blank" rel="noopener"><img loading="lazy" src="${escapeHtml(i.url)}" alt="${escapeHtml(i.alt)}"></a><figcaption>${i.width || '?'}×${i.height || '?'} · ${escapeHtml(i.type)}</figcaption></figure>`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:16px;background:#111;color:#eee}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}figure{margin:0;background:#222;border-radius:8px;overflow:hidden}img{width:100%;height:200px;object-fit:contain;background:#000;display:block}figcaption{padding:6px 8px;font-size:12px;color:#aaa}</style>
</head><body><h1>${escapeHtml(title)}</h1><p>${images.length} images · exported ${new Date().toISOString()}</p><main>${items}</main></body></html>`;
}

// Runs async `worker` over `items` with a concurrency limit. Supports abort.
export async function mapLimit(items, limit, worker, signal) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      if (signal?.aborted) return;
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: err };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}

export const REVERSE_SEARCH_ENGINES = {
  google: (u) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(u)}`,
  bing: (u) => `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(u)}`,
  tineye: (u) => `https://tineye.com/search?url=${encodeURIComponent(u)}`,
  yandex: (u) => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(u)}`,
};

export function reverseSearchUrl(engine, url) {
  return (REVERSE_SEARCH_ENGINES[engine] ?? REVERSE_SEARCH_ENGINES.google)(url);
}
