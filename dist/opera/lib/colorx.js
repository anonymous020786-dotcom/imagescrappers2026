// Colour tools for palettes: WCAG contrast checking and export to design apps (GIMP/Inkscape .gpl,
// Adobe .ase, Tailwind CSS, JSON design tokens). Pure, unit-tested in Node.

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`Not a colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// WCAG 2 relative luminance and contrast ratio (1 to 21).
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// Which WCAG 2.1 levels a ratio passes: normal text, large text (18pt, or 14pt bold) and UI parts.
export function wcag(ratio) {
  return {
    normalAA: ratio >= 4.5,
    normalAAA: ratio >= 7,
    largeAA: ratio >= 3,
    largeAAA: ratio >= 4.5,
    ui: ratio >= 3,
  };
}

const names = (colours) => colours.map((c, i) => c.name || `color-${i + 1}`);

// GIMP / Inkscape / Krita palette.
export function toGpl(colours, title = 'Image Scraper Pro') {
  const n = names(colours);
  const rows = colours.map((c, i) => {
    const [r, g, b] = parseHex(c.hex);
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${n[i]} ${c.hex.toUpperCase()}`;
  });
  return `GIMP Palette\nName: ${title.replace(/[\r\n]/g, ' ')}\nColumns: ${Math.min(8, colours.length)}\n#\n${rows.join('\n')}\n`;
}

// Adobe Swatch Exchange (Photoshop, Illustrator, InDesign): binary, big-endian.
export function toAse(colours) {
  const n = names(colours);
  const blocks = colours.map((c, i) => {
    const name = `${n[i]}\u0000`;
    const len = 2 + name.length * 2 + 4 + 12 + 2;
    const buf = new DataView(new ArrayBuffer(6 + len));
    let p = 0;
    buf.setUint16(p, 0x0001); // colour entry
    buf.setUint32((p += 2), len);
    buf.setUint16((p += 4), name.length);
    p += 2;
    for (const ch of name) {
      buf.setUint16(p, ch.charCodeAt(0));
      p += 2;
    }
    for (const ch of 'RGB ') buf.setUint8(p++, ch.charCodeAt(0));
    for (const v of parseHex(c.hex)) {
      buf.setFloat32(p, v / 255);
      p += 4;
    }
    buf.setUint16(p, 2); // normal (not global or spot)
    return new Uint8Array(buf.buffer);
  });
  const head = new DataView(new ArrayBuffer(12));
  'ASEF'.split('').forEach((ch, i) => head.setUint8(i, ch.charCodeAt(0)));
  head.setUint16(4, 1);
  head.setUint16(6, 0);
  head.setUint32(8, blocks.length);
  const out = new Uint8Array(12 + blocks.reduce((s, b) => s + b.length, 0));
  out.set(new Uint8Array(head.buffer), 0);
  let off = 12;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

// Tailwind CSS: a v4 @theme block and the equivalent v3 config, in one file.
export function toTailwind(colours) {
  const n = names(colours);
  const v4 = colours.map((c, i) => `  --color-${n[i]}: ${c.hex};`).join('\n');
  const v3 = colours.map((c, i) => `        '${n[i]}': '${c.hex}',`).join('\n');
  return `/* Tailwind CSS v4: add to your main CSS file */\n@theme {\n${v4}\n}\n\n/* Tailwind CSS v3: tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n${v3}\n      },\n    },\n  },\n};\n*/\n`;
}

// Design tokens (W3C format draft): { "color-1": { "$type": "color", "$value": "#…" } }.
export function toTokens(colours) {
  const n = names(colours);
  return `${JSON.stringify(Object.fromEntries(colours.map((c, i) => [n[i], { $type: 'color', $value: c.hex }])), null, 2)}\n`;
}
