// Responsive image set: which widths to export, and the <picture> markup that uses them.
// Pure functions so they are unit-tested in Node.

export const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920];

// Widths no larger than the original (never upscale). An original narrower than all of them is used as it is.
export function responsiveWidths(naturalWidth, wanted = DEFAULT_WIDTHS) {
  const widths = [...new Set(wanted.map(Number).filter((w) => w > 0 && w <= naturalWidth))].sort((a, b) => a - b);
  return widths.length ? widths : [naturalWidth];
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// <picture> with a WebP source and a JPEG (or PNG, for transparent images) fallback.
// `base` is the file name without width and extension; files are named `${base}-${width}.${ext}`.
export function responsiveSnippet({ base, widths, naturalWidth, naturalHeight, alt = '', fallback = 'jpg', maxDisplayWidth }) {
  const largest = widths[widths.length - 1];
  const height = Math.round((naturalHeight / naturalWidth) * largest);
  const display = Math.min(maxDisplayWidth || largest, largest);
  const sizes = `(max-width: ${display}px) 100vw, ${display}px`;
  const set = (ext) => widths.map((w) => `${attr(base)}-${w}.${ext} ${w}w`).join(', ');
  return [
    '<picture>',
    `  <source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">`,
    `  <img src="${attr(base)}-${largest}.${fallback}" srcset="${set(fallback)}" sizes="${sizes}"`,
    `       width="${largest}" height="${height}" alt="${attr(alt)}" loading="lazy" decoding="async">`,
    '</picture>',
    '',
  ].join('\n');
}
