// Per-image editor: rotate, flip, crop and resize, then download or copy. Runs entirely on the device.
import { decode, renderEdited } from '../lib/imaging.js';
import { FULL_CROP, cropFromDrag, flipCrop, orientTransform, orientedSize, outputGeometry, rotateCrop } from '../lib/editgeom.js';

const $ = (id) => document.getElementById(id);
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const PREVIEW_MAX = 1600; // px: preview canvas size cap (the export always uses full resolution)

let ed = null; // { blob, decoded, rotation, flipH, flipV, crop, opts }

function initialFormat(blob) {
  const hit = Object.entries(MIME).find(([, m]) => m === blob.type);
  return hit ? hit[0] : 'png';
}

function geometry() {
  const maxWidth = Number($('edWidth').value) || 0;
  return outputGeometry(ed.decoded.width, ed.decoded.height, ed.rotation, ed.crop, maxWidth);
}

function draw() {
  const { width, height, el } = ed.decoded;
  const o = orientedSize(width, height, ed.rotation);
  const k = Math.min(1, PREVIEW_MAX / Math.max(o.width, o.height));
  const c = $('edCanvas');
  c.width = Math.max(1, Math.round(o.width * k));
  c.height = Math.max(1, Math.round(o.height * k));
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.transform(...orientTransform(width, height, ed.rotation, ed.flipH, ed.flipV));
  ctx.drawImage(el, 0, 0, width, height);
  fitPreview(o);
  showCrop();
}

// Shows the preview as large as the stage allows (small images are enlarged up to 4× so they're easy to crop).
function fitPreview(o) {
  const stage = $('edStage');
  const maxW = stage.clientWidth || 600;
  const maxH = Math.min(innerHeight * 0.55, 480);
  const scale = Math.min(4, maxW / o.width, maxH / o.height);
  const c = $('edCanvas');
  c.style.width = `${Math.max(1, Math.floor(o.width * scale))}px`;
  c.style.height = `${Math.max(1, Math.floor(o.height * scale))}px`;
}

function showCrop() {
  const box = $('edCrop');
  const full = ed.crop.w >= 1 && ed.crop.h >= 1;
  box.classList.toggle('hidden', full);
  $('edCropClear').disabled = full;
  if (!full) {
    // The crop is in fractions of the canvas; position it relative to the canvas inside the stage.
    const c = $('edCanvas');
    const stage = $('edStage').getBoundingClientRect();
    const r = c.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${r.left - stage.left + ed.crop.x * r.width}px`,
      top: `${r.top - stage.top + ed.crop.y * r.height}px`,
      width: `${ed.crop.w * r.width}px`,
      height: `${ed.crop.h * r.height}px`,
    });
  }
  const g = geometry();
  $('edWidth').placeholder = String(g.source.width);
  $('edInfo').textContent = `Output ${g.output.width} × ${g.output.height} px`;
}

function pointAt(e) {
  const r = $('edCanvas').getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

let dragStart = null;
$('edStage').addEventListener('pointerdown', (e) => {
  if (!ed) return;
  dragStart = pointAt(e);
  $('edStage').setPointerCapture(e.pointerId);
});
$('edStage').addEventListener('pointermove', (e) => {
  if (!ed || !dragStart) return;
  const crop = cropFromDrag(dragStart, pointAt(e));
  if (crop) {
    ed.crop = crop;
    showCrop();
  }
});
$('edStage').addEventListener('pointerup', () => {
  dragStart = null;
});

function rotate(turns) {
  ed.rotation = (ed.rotation + turns * 90 + 360) % 360;
  // Rotating a mirrored image equals mirroring the rotated image along the other axis.
  if (turns % 2) [ed.flipH, ed.flipV] = [ed.flipV, ed.flipH];
  ed.crop = rotateCrop(ed.crop, turns);
  draw();
}

function flip(horizontal) {
  if (horizontal) ed.flipH = !ed.flipH;
  else ed.flipV = !ed.flipV;
  ed.crop = flipCrop(ed.crop, horizontal);
  draw();
}

function reset() {
  Object.assign(ed, { rotation: 0, flipH: false, flipV: false, crop: { ...FULL_CROP } });
  $('edWidth').value = '';
  draw();
}

async function output() {
  const format = $('edFormat').value;
  const blob = await renderEdited(ed.blob, {
    rotation: ed.rotation, flipH: ed.flipH, flipV: ed.flipV, crop: ed.crop, maxWidth: Number($('edWidth').value) || 0,
  }, MIME[format], Number($('edQuality').value));
  return { blob, ext: format === 'jpeg' ? 'jpg' : format };
}

function close() {
  if (ed) URL.revokeObjectURL(ed.decoded.url);
  ed = null;
  if ($('editDialog').open) $('editDialog').close();
}

$('edRotL').onclick = () => rotate(-1);
$('edRotR').onclick = () => rotate(1);
$('edFlipH').onclick = () => flip(true);
$('edFlipV').onclick = () => flip(false);
$('edCropClear').onclick = () => {
  ed.crop = { ...FULL_CROP };
  showCrop();
};
$('edReset').onclick = reset;
$('edWidth').oninput = showCrop;
$('edClose').onclick = close;
$('editDialog').addEventListener('close', close);
$('edDownload').onclick = async () => {
  try {
    const { blob, ext } = await output();
    await ed.opts.save(blob, ext);
  } catch (err) {
    ed?.opts.toast(`Could not save the edited image: ${err.message}`);
  }
};
$('edCopy').onclick = async () => {
  try {
    const { blob } = await output();
    await ed.opts.copy(blob);
  } catch (err) {
    ed?.opts.toast(`Could not copy the edited image: ${err.message}`);
  }
};
addEventListener('resize', () => ed && draw());

// opts: { quality, save(blob, ext), copy(blob), toast(msg) }
export async function openEditor(blob, opts) {
  close();
  const decoded = await decode(blob);
  ed = { blob, decoded, rotation: 0, flipH: false, flipV: false, crop: { ...FULL_CROP }, opts };
  $('edFormat').value = initialFormat(blob);
  $('edQuality').value = String(opts.quality ?? 0.92);
  $('edWidth').value = '';
  $('editDialog').showModal();
  draw();
}

// Read-only view of the editor state for tests.
export function editorState() {
  return ed && { rotation: ed.rotation, flipH: ed.flipH, flipV: ed.flipV, crop: { ...ed.crop }, output: geometry().output };
}
