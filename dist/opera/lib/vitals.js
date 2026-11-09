// Core Web Vitals advice for images: the Largest Contentful Paint (LCP) image and images that can shift the
// layout (CLS). The content script collects facts from the page; these pure functions turn them into checks,
// following web.dev guidance. Unit-tested in Node.

const LEGACY = /\.(jpe?g|jfif|png|gif|bmp)(?:[?#]|$)/i;

// `l` is the LCP fact sheet from the content script, or null when no LCP element was found.
export function lcpChecks(l) {
  if (!l) return [{ level: 'warn', text: 'No image was found in the first screen of the page.' }];
  if (l.kind === 'text') return [{ level: 'ok', text: `The largest element is text (<${l.tag}>), not an image, so no image is slowing it down.` }];
  const out = [];
  if (l.renderTime != null) {
    const s = (l.renderTime / 1000).toFixed(1);
    if (l.renderTime <= 2500) out.push({ level: 'ok', text: `Shown after ${s} s (good: 2.5 s or less).` });
    else if (l.renderTime <= 4000) out.push({ level: 'warn', text: `Shown after ${s} s: needs improvement (aim for 2.5 s or less).` });
    else out.push({ level: 'bad', text: `Shown after ${s} s: poor (aim for 2.5 s or less).` });
  }
  if (l.loading === 'lazy') out.push({ level: 'bad', text: 'Has loading="lazy", which delays the most important image. Remove it from this image.' });
  else if (l.lazyScript) out.push({ level: 'bad', text: 'Loaded by a JavaScript lazy loader (data-src), so the browser finds it late. Use a normal src.' });
  else out.push({ level: 'ok', text: 'Not lazy-loaded.' });
  if (l.fetchPriority === 'high') out.push({ level: 'ok', text: 'Has fetchpriority="high".' });
  else out.push({ level: 'warn', text: 'Add fetchpriority="high" so the browser downloads it before other images.' });
  if (l.source === 'css' && !l.preloaded) {
    out.push({ level: 'warn', text: 'It is a CSS background, which the browser finds late. Preload it with <link rel="preload" as="image">.' });
  }
  if (l.natural?.width && l.displayed?.width) {
    const ratio = l.natural.width / (l.displayed.width * (l.dpr || 1));
    if (ratio > 1.5) out.push({ level: 'warn', text: `The file is ${ratio.toFixed(1)}× wider than needed for this screen. Serve a smaller size with srcset.` });
  }
  if (LEGACY.test(l.url || '')) out.push({ level: 'warn', text: 'Served as JPEG/PNG/GIF: WebP or AVIF is usually much smaller.' });
  return out;
}

// Google's thresholds for Cumulative Layout Shift.
export function clsRating(score) {
  if (score == null) return null;
  if (score <= 0.1) return { level: 'ok', label: 'Good' };
  if (score <= 0.25) return { level: 'warn', label: 'Needs improvement' };
  return { level: 'bad', label: 'Poor' };
}

// Images whose space isn't reserved before they load: no width and height attributes, no CSS aspect-ratio,
// not taken out of the flow. Those above the fold matter most, so they come first.
export function unsizedImages(images) {
  return images
    .filter((i) => !i.reserved)
    .sort((a, b) => Number(b.aboveFold) - Number(a.aboveFold) || b.displayed.width * b.displayed.height - a.displayed.width * a.displayed.height);
}

// The fix to paste for an unsized image: width and height in the image's own proportions.
export function sizeFix(i) {
  const w = i.natural?.width || Math.round(i.displayed.width);
  const h = i.natural?.height || Math.round(i.displayed.height);
  return `width="${w}" height="${h}"`;
}

function csvCell(v) {
  let s = String(v ?? '');
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function vitalsToCSV({ lcp, unsized }) {
  const rows = [['check', 'url', 'level', 'detail']];
  for (const c of lcpChecks(lcp)) rows.push(['LCP image', lcp?.url ?? '', c.level, c.text]);
  for (const i of unsized) rows.push(['Unsized image (CLS)', i.url, i.aboveFold ? 'bad' : 'warn', `Add ${sizeFix(i)}${i.aboveFold ? ' (in the first screen)' : ''}`]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
