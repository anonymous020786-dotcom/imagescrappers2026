// Contact sheet layout: a grid of thumbnails with captions, split into several sheets so no canvas gets too tall.
// Pure (unit-tested); drawing happens in imaging.js.

export const MAX_SHEET_HEIGHT = 16000; // px: stays inside every browser's canvas limits

// Returns { width, columns, sheets: [{ height, cells: [{ index, x, y, w, h, captionY }] }] }.
// Each cell is a square thumbnail box of `cell` px with a caption strip below it.
export function sheetLayout(count, { columns = 5, cell = 220, gap = 12, padding = 24, caption = 34, header = 40 } = {}) {
  const cols = Math.max(1, Math.min(columns, count || 1));
  const width = padding * 2 + cols * cell + (cols - 1) * gap;
  const rowHeight = cell + caption;
  const rowsPerSheet = Math.max(1, Math.floor((MAX_SHEET_HEIGHT - padding * 2 - header + gap) / (rowHeight + gap)));
  const perSheet = rowsPerSheet * cols;
  const sheets = [];
  for (let start = 0; start < count; start += perSheet) {
    const n = Math.min(perSheet, count - start);
    const rows = Math.ceil(n / cols);
    const cells = [];
    for (let k = 0; k < n; k++) {
      const x = padding + (k % cols) * (cell + gap);
      const y = padding + header + Math.floor(k / cols) * (rowHeight + gap);
      cells.push({ index: start + k, x, y, w: cell, h: cell, captionY: y + cell + 6 });
    }
    sheets.push({ height: padding * 2 + header + rows * rowHeight + (rows - 1) * gap, cells });
  }
  return { width, columns: cols, sheets };
}

// Fits an image inside a cell, centred, never enlarged.
export function fitInCell(width, height, cell) {
  const scale = Math.min(1, cell.w / (width || 1), cell.h / (height || 1));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { x: cell.x + Math.round((cell.w - w) / 2), y: cell.y + Math.round((cell.h - h) / 2), w, h };
}
