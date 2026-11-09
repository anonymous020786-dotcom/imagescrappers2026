// CSS sprite sheets: packs many images into one PNG and writes the CSS to show each one.
// Pure layout and text functions, unit-tested in Node; the dashboard draws the PNG.

export const SPRITE_MAX_SIDE = 8192; // px: a safe canvas size in every browser

// Shelf packing: tallest images first, left to right, starting a new row when the next one doesn't fit.
// `items` are { width, height }; positions come back in the original order.
export function packSprite(items, { padding = 2, maxWidth = 2048 } = {}) {
  const order = items.map((it, i) => i).sort((a, b) => items[b].height - items[a].height || items[b].width - items[a].width);
  const widest = Math.max(0, ...items.map((i) => i.width));
  const limit = Math.max(maxWidth, widest);
  const positions = new Array(items.length);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const i of order) {
    const { width: w, height: h } = items[i];
    if (x > 0 && x + w > limit) {
      y += rowHeight + padding;
      x = 0;
      rowHeight = 0;
    }
    positions[i] = { x, y, width: w, height: h };
    x += w + padding;
    rowHeight = Math.max(rowHeight, h);
    width = Math.max(width, x - padding);
  }
  return { width, height: items.length ? y + rowHeight : 0, positions };
}

// CSS-safe, unique class names from file names.
export function uniqueNames(names) {
  const used = new Map();
  return names.map((n) => {
    let base = String(n).toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
    if (/^[0-9]/.test(base)) base = `i-${base}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  });
}

export function spriteCss(entries, file = 'sprite.png', sheet = { width: 0, height: 0 }) {
  const lines = [
    `/* ${entries.length} images in ${file} (${sheet.width}×${sheet.height}). Use: <i class="sprite sprite-NAME"></i> */`,
    `.sprite { display: inline-block; background-image: url("${file}"); background-repeat: no-repeat; }`,
  ];
  for (const e of entries) {
    lines.push(`.sprite-${e.name} { width: ${e.width}px; height: ${e.height}px; background-position: ${e.x ? `-${e.x}px` : '0'} ${e.y ? `-${e.y}px` : '0'}; }`);
  }
  return `${lines.join('\n')}\n`;
}

export function spriteDemo(entries, css = 'sprite.css') {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const items = entries.map((e) => `  <figure><i class="sprite sprite-${esc(e.name)}"></i><figcaption>.sprite-${esc(e.name)}</figcaption></figure>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sprite sheet</title>
<link rel="stylesheet" href="${esc(css)}">
<style>body{font:14px system-ui,sans-serif;margin:24px;display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;text-align:center}figcaption{color:#666;font-size:12px;margin-top:6px}</style>
</head>
<body>
${items}
</body>
</html>
`;
}
