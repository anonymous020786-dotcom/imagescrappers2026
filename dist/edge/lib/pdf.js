// Minimal PDF writer for image documents: one image per page, JPEG data embedded as-is (DCTDecode).
// Pure functions with no dependencies (unit-tested). The output is a list of byte chunks, so a large document
// becomes a Blob without first being copied into one huge array.

const PT_PER_PX = 0.75; // 96 dpi screen pixels → 72 dpi PDF points

export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

// Reads width, height and colour components from a JPEG's SOF marker, or null if it isn't a usable JPEG.
export function jpegInfo(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // reached image data without a frame header
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC). Arithmetic/lossless variants are rare but valid PDF input.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (len < 8) return null;
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      if (!width || !height || ![1, 3, 4].includes(components)) return null;
      return { width, height, components, progressive: marker === 0xc2 };
    }
    i += 2 + len;
  }
  return null;
}

// Page size and where the image goes on it, in points.
// pageSize: 'image' (page fits the image), 'a4' or 'letter' (turned to match the image's orientation).
// Images are shrunk to fit and never enlarged beyond their natural size at 96 dpi.
export function placeImage(width, height, { pageSize = 'image', margin = 0 } = {}) {
  const natW = width * PT_PER_PX;
  const natH = height * PT_PER_PX;
  if (!PAGE_SIZES[pageSize]) {
    return { pageWidth: natW + margin * 2, pageHeight: natH + margin * 2, x: margin, y: margin, w: natW, h: natH };
  }
  let [pw, ph] = PAGE_SIZES[pageSize];
  if (width > height) [pw, ph] = [ph, pw];
  const scale = Math.min(1, (pw - margin * 2) / natW, (ph - margin * 2) / natH);
  const w = natW * scale;
  const h = natH * scale;
  return { pageWidth: pw, pageHeight: ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

const n = (v) => String(Math.round(v * 100) / 100);

// PDF text strings: printable ASCII as-is; anything else as UTF-16BE hex so titles in any language work.
function pdfString(s) {
  const str = String(s ?? '');
  if (/^[\x20-\x7e]*$/.test(str)) return `(${str.replace(/[\\()]/g, '\\$&')})`;
  let hex = 'FEFF';
  for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const pad10 = (v) => String(v).padStart(10, '0');

// images: [{ bytes: Uint8Array (JPEG), width, height, components }]
// Returns { chunks: Uint8Array[], size } — wrap with new Blob(chunks, { type: 'application/pdf' }).
export function buildPdf(images, { pageSize = 'image', margin = 0, title = '', date = new Date() } = {}) {
  if (!images.length) throw new Error('No images to put in the PDF');
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let size = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    size += bytes.length;
  };
  const object = (id, body) => {
    offsets[id] = size;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n');
  push(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a)); // binary marker comment

  // Object ids: 1 catalog, 2 pages, 3 info, then 3 per page (page, image, content).
  const pageIds = images.map((_, i) => 4 + i * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>`);
  const d = date;
  const stamp = `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}` +
    `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;
  object(3, `<< /Producer (Image Scraper Pro) /CreationDate (${stamp})${title ? ` /Title ${pdfString(title)}` : ''} >>`);

  images.forEach((img, i) => {
    const [pageId, imageId, contentId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    const p = placeImage(img.width, img.height, { pageSize, margin });
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(p.pageWidth)} ${n(p.pageHeight)}] ` +
      `/Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const colour = img.components === 1 ? '/DeviceGray' : img.components === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
    offsets[imageId] = size;
    push(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${colour} ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
    push(img.bytes);
    push('\nendstream\nendobj\n');
    const draw = `q ${n(p.w)} 0 0 ${n(p.h)} ${n(p.x)} ${n(p.y)} cm /Im${i} Do Q`;
    object(contentId, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });

  const count = 4 + images.length * 3;
  const xrefAt = size;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) xref += `${pad10(offsets[id])} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return { chunks, size };
}
