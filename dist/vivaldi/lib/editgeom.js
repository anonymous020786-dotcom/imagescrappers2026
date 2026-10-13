// Geometry for the image editor: rotation, flips, crop and resize. Pure functions (unit-tested).
//
// The editor works in "oriented" space: the image after rotation and flips. The crop is stored as
// fractions (0..1) of the oriented image, so it survives later rotations of the preview size.

export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
const MIN_CROP = 0.02; // 2% of a side

export function orientedSize(width, height, rotation) {
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// A crop rectangle from a drag between two points given as fractions of the preview (any direction).
// Returns null for a drag too small to mean a crop.
export function cropFromDrag(a, b) {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  if (x2 - x1 < MIN_CROP || y2 - y1 < MIN_CROP) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Rotating the image by +90° (clockwise) moves a crop drawn on the old orientation.
export function rotateCrop(crop, quarterTurnsClockwise) {
  let c = { ...crop };
  const turns = ((quarterTurnsClockwise % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) c = { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w };
  return c;
}

export function flipCrop(crop, horizontal) {
  return horizontal ? { ...crop, x: 1 - crop.x - crop.w } : { ...crop, y: 1 - crop.y - crop.h };
}

// Pixel source rectangle (in oriented space) and output size. Never upscales; maxWidth 0 = keep size.
export function outputGeometry(width, height, rotation, crop = FULL_CROP, maxWidth = 0) {
  const o = orientedSize(width, height, rotation);
  const sx = Math.round(crop.x * o.width);
  const sy = Math.round(crop.y * o.height);
  const sw = Math.max(1, Math.min(o.width - sx, Math.round(crop.w * o.width)));
  const sh = Math.max(1, Math.min(o.height - sy, Math.round(crop.h * o.height)));
  const scale = maxWidth > 0 && maxWidth < sw ? maxWidth / sw : 1;
  return {
    oriented: o,
    source: { x: sx, y: sy, width: sw, height: sh },
    output: { width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)) },
  };
}

// Canvas transform that draws the original (width×height) image into oriented space.
// Returns [a, b, c, d, e, f] for ctx.setTransform, applied before drawImage(img, 0, 0).
export function orientTransform(width, height, rotation, flipH = false, flipV = false) {
  const o = orientedSize(width, height, rotation);
  // Rotation about the origin, then translation so the image lands in the positive quadrant.
  const r = ((rotation % 360) + 360) % 360;
  let m;
  if (r === 90) m = [0, 1, -1, 0, height, 0];
  else if (r === 180) m = [-1, 0, 0, -1, width, height];
  else if (r === 270) m = [0, -1, 1, 0, 0, width];
  else m = [1, 0, 0, 1, 0, 0];
  // Flips are mirrors of the oriented result: pre-multiply by a scale about the oriented centre.
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  return [
    sx * m[0],
    sy * m[1],
    sx * m[2],
    sy * m[3],
    sx * m[4] + (flipH ? o.width : 0),
    sy * m[5] + (flipV ? o.height : 0),
  ];
}

// Maps a point of the original image through orientTransform (used by tests and the UI).
export function applyTransform(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
