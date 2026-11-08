// next/image loader for the static export. On Netlify, images go through the Netlify Image CDN
// (/.netlify/images), which resizes them to the width the browser asks for, serves AVIF or WebP when the
// browser supports it, and caches the result at the edge. Elsewhere (local builds, tests) the original file
// is served, so nothing depends on Netlify.
// NEXT_PUBLIC_IMAGE_CDN is set to "netlify" in ../../netlify.toml.

type LoaderProps = { src: string; width: number; quality?: number };

export const imageCdn = process.env.NEXT_PUBLIC_IMAGE_CDN === 'netlify';

export default function imageLoader({ src, width, quality }: LoaderProps): string {
  if (!imageCdn || !src.startsWith('/') || src.endsWith('.svg')) return `${src}?w=${width}`;
  return `/.netlify/images?url=${encodeURIComponent(src)}&w=${width}&q=${quality ?? 75}`;
}

// Responsive srcset for images inside rendered Markdown, where next/image can't be used.
export const PROSE_WIDTHS = [480, 768, 1080, 1280];
export function responsiveAttrs(src: string, sizes: string) {
  if (!imageCdn) return { src, srcset: '', sizes: '' };
  return {
    src: imageLoader({ src, width: 1280 }),
    srcset: PROSE_WIDTHS.map((w) => `${imageLoader({ src, width: w })} ${w}w`).join(', '),
    sizes,
  };
}
