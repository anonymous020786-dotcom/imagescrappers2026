// GIF frame extractor: browse the frames of an animation and save the chosen ones as PNG. Runs on the device.
// Uses the browser's ImageDecoder; browsers without it never show the button.
import { frameToPng } from '../lib/imaging.js';
import { ZipWriter } from '../lib/zip.js';

const $ = (id) => document.getElementById(id);
const MAX_FRAMES = 300;
const THUMB = 96;

let session = null; // { decoder, count, chosen, opts }

export const canExtractFrames = () => typeof ImageDecoder !== 'undefined';

function info() {
  $('frSave').disabled = !session.chosen.size;
  $('frInfo').textContent = `${session.chosen.size} of ${session.count} frame${session.count === 1 ? '' : 's'} selected`;
}

function setChosen(index, on) {
  if (on) session.chosen.add(index);
  else session.chosen.delete(index);
  $('frGrid').children[index]?.classList.toggle('on', on);
}

function close() {
  session?.decoder.close();
  session = null;
  $('frGrid').replaceChildren();
  if ($('framesDialog').open) $('framesDialog').close();
}

async function thumbs(current) {
  for (let i = 0; i < current.count && current === session; i++) {
    const { image } = await current.decoder.decode({ frameIndex: i });
    const k = Math.min(1, THUMB / Math.max(image.displayWidth, image.displayHeight));
    const c = $('frGrid').children[i]?.querySelector('canvas');
    if (c) {
      c.width = Math.max(1, Math.round(image.displayWidth * k));
      c.height = Math.max(1, Math.round(image.displayHeight * k));
      c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
    }
    image.close();
  }
}

async function pngOf(index) {
  const { image } = await session.decoder.decode({ frameIndex: index });
  try {
    return await frameToPng(image);
  } finally {
    image.close();
  }
}

const frameName = (base, index) => `${base}-frame-${String(index + 1).padStart(3, '0')}.png`;

async function save() {
  const indexes = [...session.chosen].sort((a, b) => a - b);
  const { name, saveBlob, toast } = session.opts;
  $('frSave').disabled = true;
  try {
    if (indexes.length === 1) {
      await saveBlob(await pngOf(indexes[0]), frameName(name, indexes[0]));
    } else {
      const zip = new ZipWriter();
      for (const index of indexes) zip.add(frameName(name, index), new Uint8Array(await (await pngOf(index)).arrayBuffer()));
      await saveBlob(new Blob([zip.finish()], { type: 'application/zip' }), `${name}-frames.zip`);
    }
    toast(`Saved ${indexes.length} frame${indexes.length === 1 ? '' : 's'}`);
    close();
  } catch (err) {
    toast(`Could not save the frames: ${err.message}`);
    if (session) info();
  }
}

$('frClose').onclick = close;
$('framesDialog').addEventListener('close', close);
$('frAll').onclick = () => {
  for (let i = 0; i < session.count; i++) setChosen(i, true);
  info();
};
$('frNone').onclick = () => {
  for (let i = 0; i < session.count; i++) setChosen(i, false);
  info();
};
$('frSave').onclick = save;

// opts: { name, saveBlob(blob, filename), toast(msg) }
export async function openFrames(blob, opts) {
  close();
  const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type.startsWith('image/') ? blob.type : 'image/gif' });
  await decoder.tracks.ready;
  await decoder.completed;
  const total = decoder.tracks.selectedTrack?.frameCount ?? 0;
  if (!total) {
    decoder.close();
    throw new Error('no frames found');
  }
  session = { decoder, count: Math.min(total, MAX_FRAMES), chosen: new Set(), opts };
  const grid = $('frGrid');
  for (let i = 0; i < session.count; i++) {
    const cell = document.createElement('button');
    cell.className = 'frame checker';
    cell.title = `Frame ${i + 1}`;
    cell.append(document.createElement('canvas'), Object.assign(document.createElement('span'), { textContent: i + 1 }));
    cell.onclick = () => {
      setChosen(i, !session.chosen.has(i));
      info();
    };
    grid.append(cell);
  }
  $('frNote').textContent = total > MAX_FRAMES ? `Showing the first ${MAX_FRAMES} of ${total} frames.` : '';
  info();
  $('framesDialog').showModal();
  thumbs(session).catch((err) => opts.toast(`Could not read every frame: ${err.message}`));
}
