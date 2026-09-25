// Expands URL patterns into concrete URLs.
//
//   [1-100]      numbers 1..100
//   [001-100]    zero-padded to the width of the start value
//   [0-100:5]    with a step
//   [a-z]        letters (case preserved)
//   {jpg,png}    alternatives
//
// Several tokens multiply: photo[1-3]_{a,b}.jpg → 6 URLs.

const TOKEN = /\[(\d+)-(\d+)(?::(\d+))?\]|\[([a-zA-Z])-([a-zA-Z])\]|\{([^{}]*)\}/g;

function numericRange(startStr, endStr, stepStr) {
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  const step = Math.max(1, parseInt(stepStr ?? '1', 10));
  const width = startStr.length > 1 && startStr.startsWith('0') ? startStr.length : 0;
  const dir = end >= start ? 1 : -1;
  const count = Math.floor(Math.abs(end - start) / step) + 1;
  return {
    length: count,
    at: (i) => String(start + dir * i * step).padStart(width, '0'),
  };
}

function letterRange(a, b) {
  const s = a.charCodeAt(0);
  const e = b.charCodeAt(0);
  const dir = e >= s ? 1 : -1;
  return { length: Math.abs(e - s) + 1, at: (i) => String.fromCharCode(s + dir * i) };
}

function list(body) {
  const items = body.split(',');
  return { length: items.length, at: (i) => items[i] };
}

export function parsePattern(pattern) {
  const segments = [];
  let last = 0;
  for (const m of pattern.matchAll(TOKEN)) {
    if (m.index > last) segments.push(pattern.slice(last, m.index));
    if (m[1] !== undefined) segments.push(numericRange(m[1], m[2], m[3]));
    else if (m[4] !== undefined) segments.push(letterRange(m[4], m[5]));
    else segments.push(list(m[6]));
    last = m.index + m[0].length;
  }
  if (last < pattern.length) segments.push(pattern.slice(last));
  return segments;
}

export function countPattern(pattern) {
  return parsePattern(pattern).reduce((n, s) => (typeof s === 'string' ? n : n * s.length), 1);
}

// Returns up to `limit` URLs (0 = no limit) plus the total the pattern describes.
export function expandPattern(pattern, limit = 0) {
  const segments = parsePattern(pattern.trim());
  const ranges = segments.filter((s) => typeof s !== 'string');
  const total = ranges.reduce((n, r) => n * r.length, 1);
  const max = limit > 0 ? Math.min(limit, total) : total;
  const idx = new Array(ranges.length).fill(0);
  const urls = [];
  for (let n = 0; n < max; n++) {
    let r = 0;
    urls.push(segments.map((s) => (typeof s === 'string' ? s : s.at(idx[r++]))).join(''));
    // Odometer increment, rightmost token fastest.
    for (let k = ranges.length - 1; k >= 0; k--) {
      if (++idx[k] < ranges[k].length) break;
      idx[k] = 0;
    }
  }
  return { urls, total, truncated: max < total };
}
