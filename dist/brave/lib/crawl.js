// Pure helpers for the URL scraper / crawler (no DOM, unit-tested in Node).
import { compilePattern } from './utils.js';

const LABEL_MAP = {
  utf8: 'utf-8', 'x-sjis': 'shift_jis', sjis: 'shift_jis', 'ms932': 'shift_jis', 'windows-31j': 'shift_jis',
  'x-euc-jp': 'euc-jp', gb2312: 'gbk', 'x-gbk': 'gbk', latin1: 'windows-1252', 'iso-8859-1': 'windows-1252',
  'ascii': 'windows-1252', 'us-ascii': 'windows-1252', 'ks_c_5601-1987': 'euc-kr', 'cp1251': 'windows-1251',
};

function normalizeCharset(label) {
  const l = String(label).trim().replace(/^["']|["']$/g, '').toLowerCase();
  return LABEL_MAP[l] ?? l;
}

// Picks the character encoding for an HTML response the way browsers do:
// BOM, then the Content-Type header, then a <meta> tag in the first 2 KB.
export function sniffCharset(contentType, bytes) {
  if (bytes?.[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes?.[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes?.[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  const header = /charset\s*=\s*([^;\s]+)/i.exec(contentType ?? '');
  if (header) return normalizeCharset(header[1]);
  if (bytes?.length) {
    let head = '';
    const n = Math.min(bytes.length, 2048);
    for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
    const meta = /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head);
    if (meta) return normalizeCharset(meta[1]);
  }
  return 'utf-8';
}

export function decodeHtml(bytes, contentType) {
  const charset = sniffCharset(contentType, bytes);
  try {
    return { text: new TextDecoder(charset).decode(bytes), charset };
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), charset: 'utf-8' };
  }
}

function baseDomain(host) {
  return host.replace(/^www\d?\./, '');
}

// scope: 'page' (never follow), 'host' (exact host), 'domain' (host + subdomains), 'any'.
export function inScope(url, rootUrl, scope) {
  if (scope === 'any') return true;
  if (scope === 'page') return false;
  try {
    const a = new URL(url).hostname;
    const b = new URL(rootUrl).hostname;
    if (scope === 'host') return baseDomain(a) === baseDomain(b);
    const root = baseDomain(b);
    return a === root || a.endsWith(`.${root}`);
  } catch {
    return false;
  }
}

const NON_PAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|jxl|heic|pdf|zip|rar|7z|gz|tar|mp4|webm|mov|avi|mkv|mp3|wav|ogg|flac|exe|dmg|msi|apk|iso|css|js|json|xml|woff2?|ttf|eot)$/i;

export function isCrawlableUrl(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && !NON_PAGE_EXT.test(u.pathname);
  } catch {
    return false;
  }
}

export function canonicalPageUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    // Drop common tracking parameters so the same page isn't crawled twice.
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_\w+|fbclid|gclid|mc_eid|ref|ref_src)$/i.test(p)) u.searchParams.delete(p);
    }
    return u.href;
  } catch {
    return url;
  }
}

export function passesPatterns(url, include = [], exclude = []) {
  const inc = include.map(compilePattern).filter(Boolean);
  const exc = exclude.map(compilePattern).filter(Boolean);
  if (inc.length && !inc.some((r) => r.test(url))) return false;
  return !exc.some((r) => r.test(url));
}

// Finds http(s) URLs in arbitrary text (pasted lists, CSV, HTML, JSON).
export function extractUrls(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/https?:\/\/[^\s"'<>()[\]{}|\\^`,]+/gi)) {
    out.add(m[0].replace(/[.;:!?]+$/, ''));
  }
  return [...out];
}

// Fast 53-bit string hash (cyrb53) used for the "already downloaded" log.
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (!ms) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// Retries `fn` with exponential backoff (base, 2×base, 4×base…). AbortErrors are not retried.
export async function withRetry(fn, attempts = 3, baseDelay = 1000, signal) {
  let lastErr;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    try {
      return await fn(i);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastErr = err;
      if (i < attempts - 1) await sleep(baseDelay * 2 ** i, signal);
    }
  }
  throw lastErr;
}
