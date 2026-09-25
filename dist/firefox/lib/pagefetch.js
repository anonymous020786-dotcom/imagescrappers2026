// Fetches pages without opening them and extracts images and links from the
// static HTML. Runs in extension pages (needs DOMParser); host permissions let
// these requests reach any site, with the user's cookies for logged-in pages.
import { decodeHtml, extractUrls } from './crawl.js';
import { isImageUrl, typeFromMime } from './utils.js';

const LAZY_ATTRS = [
  'data-src', 'data-lazy-src', 'data-lazy', 'data-original', 'data-url', 'data-hi-res', 'data-full', 'data-full-src',
  'data-large', 'data-large_image', 'data-zoom-image', 'data-highres', 'data-img', 'data-image', 'data-bg',
  'data-background', 'data-original-src', 'data-actualsrc',
];
const LAZY_SRCSET = ['data-srcset', 'data-lazy-srcset'];
const NEXT_TEXT = /^(next|next page|older|more|›|»|→|siguiente|suivant|weiter|次へ|下一页|далее)$/i;

function bestFromSrcset(srcset) {
  if (!srcset) return null;
  let best = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, d = '1x'] = part.trim().split(/\s+/);
    const m = /^([\d.]+)([wx])$/.exec(d);
    const v = m ? parseFloat(m[1]) * (m[2] === 'x' ? 10000 : 1) : 1;
    if (url && (!best || v > best.v)) best = { url, v, w: m?.[2] === 'w' ? parseFloat(m[1]) : 0 };
  }
  return best;
}

function cssUrls(text) {
  return [...String(text).matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((m) => m[2]);
}

export function extractFromDocument(doc, pageUrl) {
  const base = doc.querySelector('base[href]')?.getAttribute('href');
  const baseUrl = (() => {
    try {
      return base ? new URL(base, pageUrl).href : pageUrl;
    } catch {
      return pageUrl;
    }
  })();
  const abs = (u) => {
    if (!u) return null;
    const t = u.trim();
    if (!t) return null;
    if (/^data:/i.test(t)) return /^data:image\//i.test(t) ? t : null;
    try {
      // Allowlist: only web URLs (drops javascript:, vbscript:, about:, …).
      const u = new URL(t, baseUrl);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
      return null;
    }
  };

  const images = new Map();
  let order = 0;
  const add = (raw, source, extra = {}) => {
    const url = abs(raw);
    if (!url || url.length > 200000) return;
    const prev = images.get(url);
    if (prev) {
      if (!prev.sources.includes(source)) prev.sources.push(source);
      return;
    }
    images.set(url, { url, source, sources: [source], order: order++, width: 0, height: 0, alt: '', title: '', ...extra });
  };

  for (const img of doc.querySelectorAll('img, input[type="image"]')) {
    const meta = {
      alt: img.getAttribute('alt') ?? '',
      title: img.getAttribute('title') ?? '',
      width: Number(img.getAttribute('width')) || 0,
      height: Number(img.getAttribute('height')) || 0,
    };
    const best = bestFromSrcset(img.getAttribute('srcset'));
    const lazy = LAZY_ATTRS.map((a) => img.getAttribute(a)).find(Boolean);
    const lazySet = LAZY_SRCSET.map((a) => bestFromSrcset(img.getAttribute(a))).find(Boolean);
    if (best) add(best.url, 'srcset', { ...meta, width: best.w || meta.width, height: best.w ? 0 : meta.height });
    if (lazySet) add(lazySet.url, 'lazy', { ...meta, width: lazySet.w || 0, height: 0 });
    if (lazy) add(lazy, 'lazy', meta);
    const src = img.getAttribute('src');
    const placeholder = src?.startsWith('data:') && src.length < 2000 && (lazy || lazySet);
    if (src && !placeholder && !best) add(src, 'img', meta);
  }
  for (const s of doc.querySelectorAll('picture source[srcset]')) {
    const best = bestFromSrcset(s.getAttribute('srcset'));
    if (best) add(best.url, 'picture', { width: best.w });
  }
  for (const el of doc.querySelectorAll(LAZY_ATTRS.map((a) => `:not(img)[${a}]`).join(','))) {
    for (const a of LAZY_ATTRS) {
      const v = el.getAttribute(a);
      if (v && (isImageUrl(abs(v) ?? '') || /^(https?:)?\/\//.test(v))) add(v, 'lazy');
    }
  }
  for (const el of doc.querySelectorAll('[style*="url("]')) for (const u of cssUrls(el.getAttribute('style'))) add(u, 'css');
  for (const st of doc.querySelectorAll('style')) for (const u of cssUrls(st.textContent)) if (isImageUrl(abs(u) ?? '')) add(u, 'css');
  for (const v of doc.querySelectorAll('video[poster]')) add(v.getAttribute('poster'), 'poster');
  for (const i of doc.querySelectorAll('image[href], image[*|href]')) add(i.getAttribute('href') ?? i.getAttribute('xlink:href'), 'svg');
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = abs(a.getAttribute('href'));
    if (href && isImageUrl(href)) add(href, 'link', { title: a.textContent.trim().slice(0, 100) });
  }
  const metaSel = 'meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[itemprop="image"]';
  for (const m of doc.querySelectorAll(metaSel)) add(m.getAttribute('content'), 'meta');
  for (const l of doc.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel="image_src"]')) {
    add(l.getAttribute('href'), (l.getAttribute('rel') ?? '').includes('icon') ? 'icon' : 'meta');
  }
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        for (const [k, v] of Object.entries(n)) {
          if (/^(image|logo|thumbnailUrl|contentUrl)$/.test(k)) {
            for (const item of [].concat(v)) add(typeof item === 'string' ? item : item?.url ?? item?.contentUrl, 'meta');
          } else if (typeof v === 'object') walk(v);
        }
      };
      walk(JSON.parse(s.textContent));
    } catch { /* malformed JSON-LD */ }
  }
  // Image URLs embedded in inline scripts (common in JS-rendered galleries).
  for (const s of doc.querySelectorAll('script:not([src])')) {
    for (const u of extractUrls(s.textContent.replace(/\\\//g, '/'))) if (isImageUrl(u)) add(u, 'script');
  }

  const links = new Set();
  for (const a of doc.querySelectorAll('a[href], area[href]')) {
    const href = abs(a.getAttribute('href'));
    if (href && /^https?:/.test(href)) links.add(href.split('#')[0]);
  }
  const nextEl = doc.querySelector('link[rel~="next"], a[rel~="next"]') ??
    [...doc.querySelectorAll('a[href]')].find((a) => NEXT_TEXT.test(a.textContent.trim()));

  return {
    title: doc.querySelector('title')?.textContent.trim() ?? '',
    images: [...images.values()],
    links: [...links],
    next: nextEl ? abs(nextEl.getAttribute('href')) : null,
  };
}

// Fetches a URL. HTML is decoded with the right charset (Shift_JIS, GBK,
// Windows-1251…) and parsed; a direct image response is reported as such.
export async function fetchPage(url, { signal, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), timeout);
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  try {
    const res = await fetch(url, { credentials: 'include', signal: ctrl.signal, redirect: 'follow' });
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (/^image\//i.test(contentType)) {
      return { kind: 'image', url: res.url || url, type: typeFromMime(contentType), bytes: Number(res.headers.get('content-length')) || null };
    }
    if (!/html|xml|text\/plain/i.test(contentType) && contentType) return { kind: 'other', url: res.url || url, contentType };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { text, charset } = decodeHtml(bytes, contentType);
    const finalUrl = res.url || url;
    if (/xml/i.test(contentType) && /<(urlset|sitemapindex)[\s>]/.test(text)) return { kind: 'sitemap', url: finalUrl, text };
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return { kind: 'html', url: finalUrl, charset, ...extractFromDocument(doc, finalUrl) };
  } finally {
    clearTimeout(timer);
  }
}

// Reads sitemap.xml / sitemap index files (including .xml.gz) recursively.
export async function readSitemap(url, { signal, limit = 0, depth = 0 } = {}) {
  const res = await fetch(url, { signal, credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let text;
  if (/\.gz$/i.test(new URL(url).pathname) && !/xml/i.test(res.headers.get('content-type') ?? '') && typeof DecompressionStream !== 'undefined') {
    text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = await res.text();
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  const pages = [];
  const images = [];
  for (const img of xml.getElementsByTagNameNS('*', 'image')) {
    const loc = img.getElementsByTagNameNS('*', 'loc')[0]?.textContent.trim();
    if (loc) images.push(loc);
  }
  if (xml.getElementsByTagNameNS('*', 'sitemapindex').length && depth < 3) {
    for (const loc of xml.querySelectorAll('sitemap > loc')) {
      if (limit && pages.length >= limit) break;
      try {
        const sub = await readSitemap(loc.textContent.trim(), { signal, limit: limit ? limit - pages.length : 0, depth: depth + 1 });
        pages.push(...sub.pages);
        images.push(...sub.images);
      } catch { /* skip broken child sitemap */ }
    }
  } else {
    for (const loc of xml.querySelectorAll('url > loc')) {
      pages.push(loc.textContent.trim());
      if (limit && pages.length >= limit) break;
    }
  }
  return { pages, images };
}
