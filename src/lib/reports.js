// Reports built from scanned and analyzed images: page image weight, photo metadata and broken images.
// Pure functions so they are unit-tested in Node.

function csvCell(v) {
  let s = String(v ?? '');
  // Page text must not run as a spreadsheet formula; numbers (such as a negative GPS longitude) are safe.
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

const host = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url.startsWith('data:') ? '(inline data)' : '(unknown)';
  }
};

// Total bytes, by type and by domain, and the heaviest images. Only images with a known size (after Analyze).
export function weightReport(images, top = 10) {
  const known = images.filter((i) => Number.isFinite(i.bytes) && i.bytes >= 0);
  const group = (key) => {
    const map = new Map();
    for (const i of known) {
      const k = key(i);
      const g = map.get(k) ?? { key: k, bytes: 0, count: 0 };
      g.bytes += i.bytes;
      g.count++;
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
  };
  return {
    total: known.reduce((n, i) => n + i.bytes, 0),
    count: known.length,
    unknown: images.length - known.length,
    byType: group((i) => (i.type || 'other').toUpperCase()),
    byDomain: group((i) => host(i.url)),
    heaviest: [...known].sort((a, b) => b.bytes - a.bytes).slice(0, top),
  };
}

export const METADATA_COLUMNS = [
  'url', 'page', 'width', 'height', 'camera_make', 'camera_model', 'lens', 'taken', 'exposure', 'aperture', 'iso',
  'focal_length', 'gps_latitude', 'gps_longitude', 'creator', 'copyright', 'software',
];

// One row per image: `rows` is [{ img, exif }] where exif is readMetadata(...).exif (or null).
export function metadataToCSV(rows) {
  const out = [METADATA_COLUMNS];
  for (const { img, exif } of rows) {
    const e = exif ?? {};
    out.push([
      img.url, img.pageUrl ?? '', img.width || '', img.height || '', e.make, e.model, e.lensModel, e.dateTimeOriginal ?? e.dateTime,
      e.exposureTime, e.fNumber, e.iso, e.focalLength, e.gps?.lat ?? '', e.gps?.lon ?? '', e.artist, e.copyright, e.software,
    ]);
  }
  return csv(out);
}

export function brokenToCSV(images) {
  return csv([['url', 'page', 'error'], ...images.filter((i) => i.broken).map((i) => [i.url, i.pageUrl ?? '', i.broken])]);
}
