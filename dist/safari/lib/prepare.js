// Batch preparation of images before saving: exact sizes, a target file size and a watermark.
// Geometry and the size search are pure (unit-tested); drawing happens in imaging.js.
import { fitWithin } from './utils.js';

export const SIZE_PRESETS = {
  square: { label: 'Square post (1080 × 1080)', width: 1080, height: 1080 },
  portrait: { label: 'Portrait post (1080 × 1350)', width: 1080, height: 1350 },
  story: { label: 'Story or reel (1080 × 1920)', width: 1080, height: 1920 },
  landscape: { label: 'Full HD (1920 × 1080)', width: 1920, height: 1080 },
  link: { label: 'Link preview (1200 × 630)', width: 1200, height: 630 },
};

const MARGIN = 0.03; // of the shorter side
const QUALITY_STEPS = 6;
const MIN_QUALITY = 0.35;
const SCALE_STEP = 0.8;
const MIN_SCALE = 0.3;

export function planFromSettings(s, logo = null) {
  const preset = SIZE_PRESETS[s.prepSize];
  const custom = s.prepSize === 'custom' && s.prepWidth > 0 && s.prepHeight > 0;
  return {
    width: preset?.width ?? (custom ? Number(s.prepWidth) : 0),
    height: preset?.height ?? (custom ? Number(s.prepHeight) : 0),
    fit: s.prepFit === 'contain' ? 'contain' : 'cover',
    background: s.prepBackground || '#ffffff',
    maxBytes: Math.max(0, Number(s.prepMaxKB) || 0) * 1024,
    maxWidth: Number(s.resizeMaxWidth) || 0,
    maxHeight: Number(s.resizeMaxHeight) || 0,
    watermark: {
      text: String(s.prepWatermarkText ?? '').trim(),
      logo,
      position: s.prepWatermarkPosition || 'bottom-right',
      opacity: Math.min(1, Math.max(0.05, Number(s.prepWatermarkOpacity) || 0.5)),
      scale: Math.min(0.8, Math.max(0.05, Number(s.prepWatermarkScale) || 0.25)),
    },
  };
}

export function planActive(plan) {
  return Boolean(plan.width || plan.maxBytes || plan.watermark.text || plan.watermark.logo);
}

// Output size and where to draw the image. Exact sizes may enlarge small images; otherwise only shrinks.
export function planGeometry(width, height, plan, scale = 1) {
  if (!plan.width) {
    const fitted = fitWithin(width, height, plan.maxWidth, plan.maxHeight);
    const w = Math.max(1, Math.round(fitted.width * scale));
    const h = Math.max(1, Math.round(fitted.height * scale));
    return { width: w, height: h, x: 0, y: 0, drawWidth: w, drawHeight: h, pad: false };
  }
  const k = plan.fit === 'contain' ? Math.min(plan.width / width, plan.height / height) : Math.max(plan.width / width, plan.height / height);
  const drawWidth = Math.max(1, Math.round(width * k));
  const drawHeight = Math.max(1, Math.round(height * k));
  return {
    width: plan.width, height: plan.height,
    x: Math.round((plan.width - drawWidth) / 2), y: Math.round((plan.height - drawHeight) / 2),
    drawWidth, drawHeight, pad: plan.fit === 'contain',
  };
}

// Top-left corner of a box of w×h placed on an image of width×height.
export function watermarkPosition(width, height, w, h, position) {
  const margin = Math.round(Math.min(width, height) * MARGIN);
  const [vertical, horizontal = 'center'] = position === 'center' ? ['center'] : position.split('-');
  const x = horizontal === 'left' ? margin : horizontal === 'right' ? width - w - margin : (width - w) / 2;
  const y = vertical === 'top' ? margin : vertical === 'bottom' ? height - h - margin : (height - h) / 2;
  return { x: Math.round(Math.max(0, x)), y: Math.round(Math.max(0, y)) };
}

// Finds the best encoding that fits maxBytes: lower quality first, then smaller dimensions.
// encode(quality, scale) resolves to a Blob-like { size }. Returns { blob, met }.
export async function fitToBytes(encode, maxBytes, { quality = 0.92, lossy = true, canShrink = true } = {}) {
  const first = await encode(quality, 1);
  if (!maxBytes || first.size <= maxBytes) return { blob: first, met: true };
  let smallest = first;
  for (let scale = 1; scale >= MIN_SCALE; scale *= SCALE_STEP) {
    let fit = null;
    if (lossy) {
      let low = MIN_QUALITY;
      let high = quality;
      for (let step = 0; step < QUALITY_STEPS; step++) {
        const q = (low + high) / 2;
        const out = await encode(q, scale);
        if (out.size < smallest.size) smallest = out;
        if (out.size <= maxBytes) {
          fit = out;
          low = q;
        } else high = q;
      }
    } else if (scale < 1) {
      const out = await encode(quality, scale);
      if (out.size < smallest.size) smallest = out;
      if (out.size <= maxBytes) fit = out;
    }
    if (fit) return { blob: fit, met: true };
    if (!canShrink) break;
  }
  return { blob: smallest, met: false };
}
