import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZE_PRESETS, fitToBytes, planActive, planFromSettings, planGeometry, watermarkPosition,
} from '../src/lib/prepare.js';

const base = { prepSize: 'none', prepFit: 'cover', prepMaxKB: 0, prepWatermarkText: '' };
const plan = (extra = {}) => planFromSettings({ ...base, ...extra });

test('a plan is active only when something is chosen', () => {
  assert.equal(planActive(plan()), false);
  assert.equal(planActive(plan({ prepSize: 'square' })), true);
  assert.equal(planActive(plan({ prepMaxKB: 100 })), true);
  assert.equal(planActive(plan({ prepWatermarkText: '  ©  ' })), true);
  assert.equal(planActive(plan({ prepWatermarkText: '   ' })), false);
  assert.equal(planActive(planFromSettings(base, { width: 10, height: 10 })), true);
  assert.equal(planActive(plan({ prepSize: 'custom', prepWidth: 0, prepHeight: 300 })), false);
});

test('presets and custom sizes set the output', () => {
  assert.equal(plan({ prepSize: 'story' }).height, SIZE_PRESETS.story.height);
  const custom = plan({ prepSize: 'custom', prepWidth: 640, prepHeight: 480 });
  assert.deepEqual([custom.width, custom.height], [640, 480]);
  assert.equal(plan({ prepMaxKB: 200 }).maxBytes, 200 * 1024);
  assert.equal(plan({ prepWatermarkOpacity: 9 }).watermark.opacity, 1);
});

test('cover crops to the exact size, centred', () => {
  const g = planGeometry(2000, 1000, plan({ prepSize: 'square' }));
  assert.deepEqual([g.width, g.height], [1080, 1080]);
  assert.deepEqual([g.drawWidth, g.drawHeight], [2160, 1080]);
  assert.deepEqual([g.x, g.y], [-540, 0]);
  assert.equal(g.pad, false);
});

test('contain fits inside with padding, and exact sizes can enlarge', () => {
  const g = planGeometry(2000, 1000, plan({ prepSize: 'square', prepFit: 'contain' }));
  assert.deepEqual([g.drawWidth, g.drawHeight], [1080, 540]);
  assert.deepEqual([g.x, g.y], [0, 270]);
  assert.equal(g.pad, true);
  assert.equal(planGeometry(100, 100, plan({ prepSize: 'square' })).drawWidth, 1080);
});

test('without an exact size, the resize limits apply and nothing is enlarged', () => {
  const p = plan({ resizeMaxWidth: 500 });
  assert.deepEqual([planGeometry(1000, 400, p).width, planGeometry(1000, 400, p).height], [500, 200]);
  assert.equal(planGeometry(100, 40, p).width, 100);
  assert.equal(planGeometry(1000, 400, plan(), 0.5).width, 500);
});

test('watermarks stay inside the image in every position', () => {
  const at = (position) => watermarkPosition(1000, 500, 200, 50, position);
  assert.deepEqual(at('top-left'), { x: 15, y: 15 });
  assert.deepEqual(at('bottom-right'), { x: 785, y: 435 });
  assert.deepEqual(at('center'), { x: 400, y: 225 });
  assert.deepEqual(watermarkPosition(100, 100, 400, 400, 'bottom-right'), { x: 0, y: 0 });
});

// A fake encoder: size grows with quality and with area.
const fake = (full) => {
  const calls = [];
  const encode = async (q, s) => {
    calls.push([q, s]);
    return { size: Math.round(full * q * s * s), quality: q, scale: s };
  };
  return { encode, calls };
};

test('no target, or an image already small enough, encodes once', async () => {
  const { encode, calls } = fake(1000);
  assert.equal((await fitToBytes(encode, 0, { quality: 0.9 })).met, true);
  assert.equal((await fitToBytes(encode, 5000, { quality: 0.9 })).met, true);
  assert.equal(calls.length, 2);
});

test('lowers quality before shrinking, keeping the highest quality that fits', async () => {
  const { encode } = fake(1000);
  const { blob, met } = await fitToBytes(encode, 600, { quality: 0.9 });
  assert.equal(met, true);
  assert.equal(blob.scale, 1);
  assert.ok(blob.size <= 600 && blob.size > 500, `size ${blob.size}`);
});

test('shrinks dimensions when quality alone is not enough', async () => {
  const { encode } = fake(10000);
  const { blob, met } = await fitToBytes(encode, 1000, { quality: 0.9 });
  assert.equal(met, true);
  assert.ok(blob.scale < 1);
  assert.ok(blob.size <= 1000);
});

test('lossless formats only shrink', async () => {
  const { encode, calls } = fake(1000);
  const { blob, met } = await fitToBytes(encode, 500, { quality: 0.9, lossy: false });
  assert.equal(met, true);
  assert.ok(blob.scale < 1);
  assert.ok(calls.every(([q]) => q === 0.9));
});

test('an exact size is never shrunk, and a missed target is reported with the smallest result', async () => {
  const { encode, calls } = fake(10000);
  const { blob, met } = await fitToBytes(encode, 100, { quality: 0.9, canShrink: false });
  assert.equal(met, false);
  assert.ok(calls.every(([, s]) => s === 1));
  assert.ok(blob.size < 10000 * 0.9);
  const hopeless = await fitToBytes(fake(1e9).encode, 1, { quality: 0.9 });
  assert.equal(hopeless.met, false);
  assert.ok(hopeless.blob.scale < 1);
});
