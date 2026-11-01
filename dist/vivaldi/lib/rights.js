// Credit and licence details stated by an image file or its page. Pure functions (no browser APIs), unit-tested
// in Node. The values come from arbitrary websites, so they are treated as untrusted text. This reports what a
// source claims; it does not decide whether an image may be reused.

export const RIGHTS_LABELS = {
  creator: 'Creator',
  credit: 'Credit',
  copyright: 'Copyright',
  license: 'Licence',
  licensePage: 'Licence page',
};

const FIELDS = Object.keys(RIGHTS_LABELS);
const MAX_TEXT = 300;
const MAX_XMP = 512 * 1024;
const OPEN_LICENSE = /creativecommons\.org\/|\bcc[ -]?0\b|\bcc[ -]by\b|\bcreative commons\b|\bpublic domain\b/i;
const IPTC_FIELDS = { 80: 'creator', 110: 'credit', 116: 'copyright' };

const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '');

// Keeps the known fields that hold text; null when nothing is left.
export function cleanRights(rights) {
  if (!rights || typeof rights !== 'object') return null;
  const out = {};
  for (const key of FIELDS) {
    const value = text(rights[key]);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

// Earlier sources win, field by field.
export function mergeRights(...sources) {
  const out = {};
  for (const source of sources) {
    const clean = cleanRights(source);
    if (clean) for (const key of FIELDS) out[key] ??= clean[key];
  }
  for (const key of FIELDS) if (out[key] === undefined) delete out[key];
  return Object.keys(out).length ? out : null;
}

// 'open' (Creative Commons or public domain), 'known' (other details) or 'none'.
export function rightsClass(rights) {
  if (!rights) return 'none';
  return OPEN_LICENSE.test(`${rights.license ?? ''} ${rights.copyright ?? ''}`) ? 'open' : 'known';
}

function nameOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(', ');
  return value && typeof value === 'object' ? text(value.name) : '';
}

function linkOf(value) {
  if (Array.isArray(value)) return linkOf(value[0]);
  return typeof value === 'string' ? value : text(value?.url ?? value?.['@id']);
}

// A schema.org ImageObject (or similar) in the page's JSON-LD.
export function rightsFromJsonLd(node) {
  if (!node || typeof node !== 'object') return null;
  return cleanRights({
    creator: nameOf(node.creator) || nameOf(node.author),
    credit: nameOf(node.creditText),
    copyright: nameOf(node.copyrightNotice) || nameOf(node.copyrightHolder),
    license: linkOf(node.license),
    licensePage: linkOf(node.acquireLicensePage),
  });
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// The value of an XMP property, written as an attribute or as an element (with or without an rdf:li list).
function xmpValue(xmp, name) {
  const attr = new RegExp(`[\\s<]${name}="([^"]*)"`).exec(xmp);
  if (attr) return decodeEntities(attr[1]);
  const resource = new RegExp(`<${name}\\s[^>]*rdf:resource="([^"]*)"`).exec(xmp);
  if (resource) return decodeEntities(resource[1]);
  const element = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xmp);
  if (!element) return '';
  const items = [...element[1].matchAll(/<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/g)].map((m) => m[1]);
  return decodeEntities(items.length ? items.join(', ') : element[1].replace(/<[^>]*>/g, ''));
}

export function rightsFromXmp(xml) {
  const xmp = String(xml ?? '').slice(0, MAX_XMP);
  if (!xmp) return null;
  return cleanRights({
    creator: xmpValue(xmp, 'dc:creator'),
    credit: xmpValue(xmp, 'photoshop:Credit'),
    copyright: xmpValue(xmp, 'dc:rights'),
    license: xmpValue(xmp, 'cc:license') || xmpValue(xmp, 'xmpRights:WebStatement'),
    licensePage: xmpValue(xmp, 'plus:LicensorURL'),
  });
}

// IPTC-IIM records (the bytes of a JPEG APP13 segment): 0x1C, record 2, dataset, 16-bit length, value.
export function rightsFromIptc(bytes) {
  const out = {};
  const decoder = new TextDecoder();
  let i = 0;
  while (i + 5 <= bytes.length) {
    if (bytes[i] !== 0x1c || bytes[i + 1] !== 2) {
      i++;
      continue;
    }
    const length = (bytes[i + 3] << 8) | bytes[i + 4];
    if (length & 0x8000) break; // extended size: only used for binary data
    const field = IPTC_FIELDS[bytes[i + 2]];
    if (field && i + 5 + length <= bytes.length) {
      const value = decoder.decode(bytes.subarray(i + 5, i + 5 + length));
      out[field] = out[field] ? `${out[field]}, ${value}` : value;
    }
    i += 5 + length;
  }
  return cleanRights(out);
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // page text must not run as a spreadsheet formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Where each file in a ZIP came from. rows: [{ file, img }].
export function sourcesToCSV(rows, date = new Date()) {
  const header = ['file', 'url', 'page', 'page_title', 'width', 'height', 'saved', 'creator', 'credit', 'copyright', 'licence', 'licence_page'];
  const lines = rows.map(({ file, img }) => {
    const r = img.rights ?? {};
    const url = img.url.startsWith('data:') ? 'inline image' : img.url;
    return [file, url, img.pageUrl, img.pageTitle, img.width || '', img.height || '', date.toISOString(), r.creator, r.credit, r.copyright, r.license, r.licensePage].map(csvCell).join(',');
  });
  return [header.join(','), ...lines].join('\n');
}
