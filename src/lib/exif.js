// Photo metadata: read EXIF (camera, date, GPS…) and remove metadata without re-encoding.
// Pure byte-level code (no browser APIs), unit-tested in Node. Every read is bounds-checked
// because the bytes come from arbitrary websites.

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
const MAX_ENTRIES = 512;

const IFD0_TAGS = {
  0x010f: 'make',
  0x0110: 'model',
  0x0112: 'orientation',
  0x0131: 'software',
  0x0132: 'dateTime',
  0x013b: 'artist',
  0x8298: 'copyright',
};
const EXIF_TAGS = {
  0x829a: 'exposureTime',
  0x829d: 'fNumber',
  0x8827: 'iso',
  0x9003: 'dateTimeOriginal',
  0x920a: 'focalLength',
  0xa434: 'lensModel',
};
const EXIF_POINTER = 0x8769;
const GPS_POINTER = 0x8825;

function readTiff(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (off, n) => off >= start && off + n <= end;
  if (!has(start, 8)) return null;
  const order = String.fromCharCode(bytes[start], bytes[start + 1]);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  if (u16(start + 2) !== 42) return null;

  function value(entry) {
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const size = TYPE_SIZE[type] ?? 0;
    if (!size || count === 0 || count > 65535) return undefined;
    const total = size * count;
    const at = total <= 4 ? entry + 8 : start + u32(entry + 8);
    if (!has(at, total)) return undefined;
    const one = (i) => {
      const o = at + i * size;
      switch (type) {
        case 1:
        case 7:
          return bytes[o];
        case 3:
          return u16(o);
        case 4:
          return u32(o);
        case 9:
          return view.getInt32(o, le);
        case 5:
          return u32(o + 4) ? u32(o) / u32(o + 4) : 0;
        case 10:
          return view.getInt32(o + 4, le) ? view.getInt32(o, le) / view.getInt32(o + 4, le) : 0;
        default:
          return undefined;
      }
    };
    if (type === 2) {
      let s = '';
      for (let i = 0; i < count && bytes[at + i]; i++) s += String.fromCharCode(bytes[at + i]);
      return s.trim();
    }
    if (type === 5 && count === 1) return { value: one(0), num: u32(at), den: u32(at + 4) };
    return count === 1 ? one(0) : Array.from({ length: Math.min(count, 16) }, (_, i) => one(i));
  }

  function ifd(offset, names, out, pointers = {}) {
    const at = start + offset;
    if (!offset || !has(at, 2)) return;
    const n = Math.min(u16(at), MAX_ENTRIES);
    for (let i = 0; i < n; i++) {
      const entry = at + 2 + i * 12;
      if (!has(entry, 12)) break;
      const tag = u16(entry);
      if (tag in pointers) pointers[tag] = u32(entry + 8);
      else if (names === null) out[tag] = value(entry); // GPS: keep raw tag numbers
      else if (names[tag]) out[names[tag]] = value(entry);
    }
  }

  const tags = {};
  const pointers = { [EXIF_POINTER]: 0, [GPS_POINTER]: 0 };
  ifd(u32(start + 4), IFD0_TAGS, tags, pointers);
  ifd(pointers[EXIF_POINTER], EXIF_TAGS, tags);
  const gps = {};
  ifd(pointers[GPS_POINTER], null, gps);
  return { tags, gps };
}

function gpsDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3 || dms.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const deg = dms[0] + dms[1] / 60 + dms[2] / 3600;
  return Math.round((ref === 'S' || ref === 'W' ? -deg : deg) * 1e6) / 1e6;
}

function tidy(parsed) {
  if (!parsed) return null;
  const { tags, gps } = parsed;
  const out = {};
  for (const [k, v] of Object.entries(tags)) {
    if (v === undefined || v === '') continue;
    if (k === 'exposureTime' && v && typeof v === 'object') {
      out[k] = v.value >= 1 || !v.value ? `${Math.round(v.value * 10) / 10} s` : `1/${Math.round(1 / v.value)} s`;
    } else if (k === 'fNumber' && v && typeof v === 'object') out[k] = `f/${Math.round(v.value * 10) / 10}`;
    else if (k === 'focalLength' && v && typeof v === 'object') out[k] = `${Math.round(v.value * 10) / 10} mm`;
    else if (v && typeof v === 'object' && 'value' in v) out[k] = v.value;
    else out[k] = Array.isArray(v) ? v[0] : v;
  }
  const lat = gpsDecimal(gps[2], gps[1]);
  const lon = gpsDecimal(gps[4], gps[3]);
  if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.gps = { lat, lon };
  return Object.keys(out).length ? out : null;
}

const ascii = (bytes, at, s) => s.split('').every((c, i) => bytes[at + i] === c.charCodeAt(0));
const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function detectFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && ascii(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'webp';
  return null;
}

// JPEG segments before the image data: [{ marker, start, end }] (end exclusive), plus where scan data begins.
function jpegSegments(bytes) {
  const segments = [];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    while (bytes[i + 1] === 0xff && i + 2 < bytes.length) i++; // fill bytes
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) return { segments, dataStart: i };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(bytes, i + 2);
    if (len < 2 || i + 2 + len > bytes.length) return null;
    segments.push({ marker, start: i, end: i + 2 + len });
    i += 2 + len;
  }
  return null;
}

// Metadata segments/chunks dropped by stripMetadata. Kept on purpose: JFIF (APP0), ICC colour profiles
// (APP2) and Adobe (APP14), which change how the image looks.
const JPEG_DROP = (m) => m === 0xe1 || (m >= 0xe3 && m <= 0xed) || m === 0xef || m === 0xfe;
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
const WEBP_DROP = new Set(['EXIF', 'XMP ']);

function webpChunks(bytes) {
  const chunks = [];
  let i = 12;
  while (i + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(...bytes.subarray(i, i + 4));
    const size = u32le(bytes, i + 4);
    const end = i + 8 + size + (size & 1);
    if (end > bytes.length + (size & 1)) return null;
    chunks.push({ fourcc, start: i, data: i + 8, size, end: Math.min(end, bytes.length) });
    i = end;
  }
  return chunks;
}

function pngChunks(bytes) {
  const chunks = [];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const size = u32be(bytes, i);
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    const end = i + 12 + size;
    if (end > bytes.length) return null;
    chunks.push({ type, start: i, data: i + 8, size, end });
    i = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

// { format, exif, hasXmp, hasText, metadataBytes } or null for unsupported/corrupt files.
export function readMetadata(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const format = detectFormat(bytes);
  let exif = null;
  let hasXmp = false;
  let hasText = false;
  let metadataBytes = 0;
  try {
    if (format === 'jpeg') {
      const parsed = jpegSegments(bytes);
      if (!parsed) return null;
      for (const s of parsed.segments) {
        if (!JPEG_DROP(s.marker)) continue;
        metadataBytes += s.end - s.start;
        if (s.marker === 0xe1 && ascii(bytes, s.start + 4, 'Exif\0\0')) exif = tidy(readTiff(bytes, s.start + 10, s.end));
        else if (s.marker === 0xe1) hasXmp = true;
        else hasText = true;
      }
    } else if (format === 'png') {
      const chunks = pngChunks(bytes);
      if (!chunks) return null;
      for (const c of chunks) {
        if (!PNG_DROP.has(c.type)) continue;
        metadataBytes += c.end - c.start;
        if (c.type === 'eXIf') exif = tidy(readTiff(bytes, c.data, c.data + c.size));
        else hasText = true;
      }
    } else if (format === 'webp') {
      const chunks = webpChunks(bytes);
      if (!chunks) return null;
      for (const c of chunks) {
        if (!WEBP_DROP.has(c.fourcc)) continue;
        metadataBytes += c.end - c.start;
        if (c.fourcc === 'EXIF') {
          const tiff = ascii(bytes, c.data, 'Exif\0\0') ? c.data + 6 : c.data;
          exif = tidy(readTiff(bytes, tiff, c.data + c.size));
        } else hasXmp = true;
      }
    } else return null;
  } catch {
    return null;
  }
  return { format, exif, hasXmp, hasText, metadataBytes };
}

function concat(parts, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Removes EXIF/GPS, XMP, IPTC, comments and text chunks without touching the pixels.
// Returns { bytes, removed, needsReencode }. needsReencode is true for JPEGs whose EXIF says
// "display rotated": dropping it would show the photo sideways, so the caller should re-encode
// upright instead. Unsupported or corrupt input is returned unchanged (removed: 0).
export function stripMetadata(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const unchanged = { bytes, removed: 0, needsReencode: false };
  const format = detectFormat(bytes);
  try {
    if (format === 'jpeg') {
      const parsed = jpegSegments(bytes);
      if (!parsed) return unchanged;
      const orientation = readMetadata(bytes)?.exif?.orientation;
      if (orientation > 1) return { ...unchanged, needsReencode: true };
      const parts = [bytes.subarray(0, 2)];
      for (const s of parsed.segments) if (!JPEG_DROP(s.marker)) parts.push(bytes.subarray(s.start, s.end));
      parts.push(bytes.subarray(parsed.dataStart));
      const total = parts.reduce((n, p) => n + p.length, 0);
      return total === bytes.length ? unchanged : { bytes: concat(parts, total), removed: bytes.length - total, needsReencode: false };
    }
    if (format === 'png') {
      const chunks = pngChunks(bytes);
      if (!chunks) return unchanged;
      const parts = [bytes.subarray(0, 8)];
      for (const c of chunks) if (!PNG_DROP.has(c.type)) parts.push(bytes.subarray(c.start, c.end));
      const last = chunks.at(-1);
      if (last && last.end < bytes.length) parts.push(bytes.subarray(last.end));
      const total = parts.reduce((n, p) => n + p.length, 0);
      return total === bytes.length ? unchanged : { bytes: concat(parts, total), removed: bytes.length - total, needsReencode: false };
    }
    if (format === 'webp') {
      const chunks = webpChunks(bytes);
      if (!chunks || !chunks.some((c) => WEBP_DROP.has(c.fourcc))) return unchanged;
      const kept = chunks.filter((c) => !WEBP_DROP.has(c.fourcc)).map((c) => bytes.slice(c.start, c.end));
      const vp8x = kept.find((c) => ascii(c, 0, 'VP8X'));
      if (vp8x) vp8x[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
      const body = kept.reduce((n, c) => n + c.length, 0);
      const header = new Uint8Array(12);
      header.set(bytes.subarray(0, 12));
      new DataView(header.buffer).setUint32(4, body + 4, true);
      const out = concat([header, ...kept], 12 + body);
      return { bytes: out, removed: bytes.length - out.length, needsReencode: false };
    }
  } catch {
    return unchanged;
  }
  return unchanged;
}
