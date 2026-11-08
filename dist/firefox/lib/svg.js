// Safe SVG clean-up for downloads: removes what editors leave behind without touching the drawing.
// Comments, <metadata>, Inkscape/Sodipodi elements and attributes, and indentation between tags. Text
// content (<text>, <style>, <script>) is kept exactly. Pure so it is unit-tested in Node; the dashboard also
// checks the result still parses before using it.

const EDITOR_PREFIXES = ['sodipodi', 'inkscape', 'sketch', 'serif'];

export function optimizeSvg(input) {
  const original = String(input);
  // Keep the content of elements where whitespace and text matter.
  const kept = [];
  let svg = original.replace(/<(text|style|script|title|desc|textPath)\b[\s\S]*?<\/\1\s*>/gi, (m) => {
    kept.push(m);
    return `\u0000${kept.length - 1}\u0000`;
  });
  // Repeat until stable: removing one comment must not join pieces into a new "<!--" (e.g. "<!<!---->--").
  for (let prev; prev !== svg; ) {
    prev = svg;
    svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  }
  svg = svg
    .replace(/<metadata\b[\s\S]*?<\/metadata\s*>/gi, '')
    .replace(/<metadata\b[^>]*\/>/gi, '');
  for (const p of EDITOR_PREFIXES) {
    svg = svg
      .replace(new RegExp(`<${p}:[\\w-]+\\b[^>]*/>`, 'gi'), '')
      .replace(new RegExp(`<${p}:([\\w-]+)\\b[\\s\\S]*?</${p}:\\1\\s*>`, 'gi'), '')
      .replace(new RegExp(`\\s${p}:[\\w-]+\\s*=\\s*("[^"]*"|'[^']*')`, 'gi'), '')
      .replace(new RegExp(`\\sxmlns:${p}\\s*=\\s*("[^"]*"|'[^']*')`, 'gi'), '');
  }
  svg = svg
    .replace(/>\s*\n\s*</g, '><') // indentation between tags
    .replace(/[ \t]+\/>/g, '/>')
    .trim();
  svg = svg.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
  return { svg, saved: Math.max(0, new TextEncoder().encode(original).length - new TextEncoder().encode(svg).length) };
}
