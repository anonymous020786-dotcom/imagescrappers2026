// Page image audit: accessibility and performance findings for the images on a page.
// Pure functions (no browser APIs) so the rules are unit-tested in Node.

// Element sources whose audit facts come from a real <img> on the page.
const ELEMENT_SOURCES = new Set(['img', 'srcset', 'picture', 'lazy']);
const LEGACY_TYPES = new Set(['jpg', 'png', 'bmp']);
const MIN_VISIBLE = 16; // px: smaller elements are icons/spacers, not worth flagging
const OVERSIZE_FACTOR = 2; // allow 2× for high-DPI screens before calling an image oversized
const LEGACY_MIN_BYTES = 50 * 1024;
const LEGACY_MIN_PIXELS = 250_000;
const WEBP_SAVING = 0.3; // conservative typical saving of WebP over JPEG/PNG, used when not measured

export const RULES = {
  'missing-alt': {
    label: 'Missing alt text',
    severity: 'error',
    fix: 'Add an alt attribute describing the image (use alt="" for purely decorative images).',
  },
  oversized: {
    label: 'Oversized image',
    severity: 'warning',
    fix: 'Serve a smaller file (or srcset sizes) close to 2× the displayed size.',
  },
  'legacy-format': {
    label: 'Could use a modern format',
    severity: 'info',
    fix: 'Serve WebP or AVIF, which are usually much smaller than JPEG or PNG.',
  },
  'not-lazy': {
    label: 'Offscreen image loads eagerly',
    severity: 'info',
    fix: 'Add loading="lazy" to images below the first screen.',
  },
  'lazy-above-fold': {
    label: 'Lazy-loaded image in the first screen',
    severity: 'warning',
    fix: 'Remove loading="lazy" from images visible on load; it delays the main content.',
  },
  'no-dimensions': {
    label: 'No width/height attributes',
    severity: 'info',
    fix: 'Set width and height attributes so the page does not jump while images load.',
  },
};

export const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

function issue(rule, detail, savingBytes = 0) {
  return { rule, severity: RULES[rule].severity, detail, savingBytes: Math.max(0, Math.round(savingBytes)) };
}

// Findings for one image. `img` is a scan result (optionally analyzed: bytes, type, width, height,
// and webpBytes when a real WebP conversion was measured).
export function auditImage(img) {
  const out = [];
  const a = img.audit;
  const isElement = a && ELEMENT_SOURCES.has(img.source);
  const visible = img.displayWidth >= MIN_VISIBLE && img.displayHeight >= MIN_VISIBLE;

  if (isElement && !a.hasAlt && visible) {
    out.push(issue('missing-alt', 'No alt attribute'));
  }

  if (visible && img.width && img.height) {
    const ratio = Math.max(img.width / img.displayWidth, img.height / img.displayHeight);
    if (ratio > OVERSIZE_FACTOR) {
      const keep = (OVERSIZE_FACTOR / ratio) ** 2; // share of pixels worth keeping
      out.push(
        issue(
          'oversized',
          `${img.width}×${img.height} shown at ${img.displayWidth}×${img.displayHeight} (${ratio.toFixed(1)}× larger)`,
          img.bytes ? img.bytes * (1 - keep) : 0,
        ),
      );
    }
  }

  const pixels = (img.width || 0) * (img.height || 0);
  if (LEGACY_TYPES.has(img.type) && ((img.bytes ?? 0) >= LEGACY_MIN_BYTES || (!img.bytes && pixels >= LEGACY_MIN_PIXELS))) {
    const measured = img.webpBytes != null && img.bytes;
    const saving = measured ? img.bytes - img.webpBytes : (img.bytes ?? 0) * WEBP_SAVING;
    if (!measured || saving > 0) {
      out.push(
        issue(
          'legacy-format',
          measured
            ? `${img.type.toUpperCase()}: WebP would be ${Math.round((saving / img.bytes) * 100)}% smaller (measured)`
            : `${img.type.toUpperCase()}${img.bytes ? '' : `, ${img.width}×${img.height}`}`,
          saving,
        ),
      );
    }
  }

  if (isElement && !a.inFrame && a.viewportHeight) {
    const offscreen = a.top > a.viewportHeight;
    if (offscreen && a.loading !== 'lazy') out.push(issue('not-lazy', `Starts ${a.top}px down the page`));
    if (!offscreen && a.loading === 'lazy' && visible) out.push(issue('lazy-above-fold', `Visible at ${a.top}px`));
  }

  if (isElement && !a.sized && visible) out.push(issue('no-dimensions', 'Layout can shift while it loads'));

  return out;
}

// Audit a whole page: per-image findings (worst first) plus a summary per rule.
export function auditImages(images) {
  const items = [];
  const byRule = Object.fromEntries(Object.keys(RULES).map((r) => [r, { count: 0, savingBytes: 0 }]));
  for (const img of images) {
    const issues = auditImage(img);
    if (!issues.length) continue;
    issues.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
    for (const i of issues) {
      byRule[i.rule].count++;
      byRule[i.rule].savingBytes += i.savingBytes;
    }
    items.push({ img, issues });
  }
  items.sort(
    (x, y) =>
      SEVERITY_ORDER[x.issues[0].severity] - SEVERITY_ORDER[y.issues[0].severity] || y.issues.length - x.issues.length,
  );
  // Savings overlap (a resized WebP saves less than the sum), so report the largest single saving per image.
  const savingBytes = items.reduce((sum, it) => sum + Math.max(...it.issues.map((i) => i.savingBytes)), 0);
  return { items, byRule, total: images.length, withIssues: items.length, savingBytes };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditToCSV(report) {
  const rows = [['url', 'page', 'issue', 'severity', 'detail', 'estimated_saving_bytes', 'how_to_fix']];
  for (const { img, issues } of report.items) {
    for (const i of issues) {
      rows.push([img.url, img.pageUrl ?? '', RULES[i.rule].label, i.severity, i.detail, i.savingBytes, RULES[i.rule].fix]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
