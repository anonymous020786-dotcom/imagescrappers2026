import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_CROP, applyTransform, cropFromDrag, flipCrop, orientTransform, orientedSize, outputGeometry, rotateCrop,
} from '../src/lib/editgeom.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const nearCrop = (c, e) => ['x', 'y', 'w', 'h'].forEach((k) => near(c[k], e[k]));

test('rotation swaps width and height for quarter turns', () => {
  assert.deepEqual(orientedSize(400, 300, 0), { width: 400, height: 300 });
  assert.deepEqual(orientedSize(400, 300, 90), { width: 300, height: 400 });
  assert.deepEqual(orientedSize(400, 300, 180), { width: 400, height: 300 });
  assert.deepEqual(orientedSize(400, 300, 270), { width: 300, height: 400 });
});

test('the orient transform maps the image corners onto the oriented canvas', () => {
  const W = 400;
  const H = 300;
  for (const [rot, flipH, flipV, corner, expected] of [
    [0, false, false, [0, 0], [0, 0]],
    [90, false, false, [0, 0], [H, 0]], // top-left goes to the top-right after a clockwise turn
    [90, false, false, [W, H], [0, W]],
    [180, false, false, [0, 0], [W, H]],
    [270, false, false, [0, 0], [0, W]],
    [0, true, false, [0, 0], [W, 0]],
    [0, false, true, [0, 0], [0, H]],
    [90, true, false, [0, 0], [0, 0]], // rotate then mirror: back to the left edge
  ]) {
    const p = applyTransform(orientTransform(W, H, rot, flipH, flipV), ...corner);
    assert.deepEqual([Math.round(p.x), Math.round(p.y)], expected, `rot ${rot} flipH ${flipH} flipV ${flipV}`);
  }
  // Every corner stays inside the oriented canvas.
  for (const rot of [0, 90, 180, 270]) {
    const o = orientedSize(W, H, rot);
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      const p = applyTransform(orientTransform(W, H, rot, true, true), x, y);
      assert.ok(p.x >= -1e-9 && p.x <= o.width + 1e-9 && p.y >= -1e-9 && p.y <= o.height + 1e-9);
    }
  }
});

test('a drag in any direction becomes a clamped crop; tiny drags are ignored', () => {
  nearCrop(cropFromDrag({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 }), { x: 0.2, y: 0.1, w: 0.6, h: 0.8 });
  nearCrop(cropFromDrag({ x: -0.5, y: 0.5 }, { x: 0.5, y: 1.5 }), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
  assert.equal(cropFromDrag({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.9 }), null);
});

test('crops follow the image when it is rotated or flipped', () => {
  const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }; // top-left area
  nearCrop(rotateCrop(crop, 1), { x: 0.4, y: 0.1, w: 0.4, h: 0.3 }); // moves to the top-right
  nearCrop(rotateCrop(crop, 4), crop);
  nearCrop(rotateCrop(rotateCrop(crop, 1), -1), crop);
  nearCrop(flipCrop(crop, true), { x: 0.6, y: 0.2, w: 0.3, h: 0.4 });
  nearCrop(flipCrop(crop, false), { x: 0.1, y: 0.4, w: 0.3, h: 0.4 });
});

test('output geometry crops in oriented pixels and only ever scales down', () => {
  const g = outputGeometry(400, 300, 90, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, 0);
  assert.deepEqual(g.oriented, { width: 300, height: 400 });
  assert.deepEqual(g.source, { x: 150, y: 0, width: 150, height: 200 });
  assert.deepEqual(g.output, { width: 150, height: 200 });
  assert.deepEqual(outputGeometry(400, 300, 0, FULL_CROP, 100).output, { width: 100, height: 75 });
  assert.deepEqual(outputGeometry(400, 300, 0, FULL_CROP, 1000).output, { width: 400, height: 300 }); // no upscaling
});
