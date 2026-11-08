// Small Markdown subset for the guides, help and privacy pages: headings (h2/h3 get ids), paragraphs, lists,
// tables, code blocks, images and "> " callouts. The content is our own, from the repository.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// Headings are raw Markdown, so the id keeps only letters and digits.
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(text: string) {
  return esc(text)
    .replace(/!\[([^\]]*)\]\((\/[^)\s]+)\)/g, '<img src="$2" alt="$1" width="1280" height="800" loading="lazy" decoding="async">')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:|\/|#)[^)\s]*)\)/g, '<a href="$2">$1</a>')
    .replace(/&lt;(https?:[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const listItems = (re: RegExp) => {
    const items: string[] = [];
    while (i < lines.length && (re.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
      if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
      else items[items.length - 1] += ` ${lines[i].trim()}`;
      i++;
    }
    return items.map((t) => `<li>${inline(t)}</li>`);
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const n = h[1].length;
      out.push(n === 1 ? `<h1>${inline(h[2])}</h1>` : `<h${n} id="${slugify(h[2])}">${inline(h[2])}</h${n}>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r: string) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const [head, , ...body] = rows;
      out.push('<table><thead><tr>', ...cells(head).map((c) => `<th>${c}</th>`), '</tr></thead><tbody>');
      for (const r of body) out.push('<tr>', ...cells(r).map((c) => `<td>${c}</td>`), '</tr>');
      out.push('</tbody></table>');
    } else if (/^[-*]\s/.test(line)) {
      out.push('<ul>', ...listItems(/^[-*]\s+/), '</ul>');
    } else if (/^\d+\.\s/.test(line)) {
      out.push('<ol>', ...listItems(/^\d+\.\s+/), '</ol>');
    } else if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<div class="callout">${inline(quote.join(' '))}</div>`);
    } else if (/^!\[/.test(line)) {
      out.push(`<figure class="shot article-shot">${inline(line.trim())}</figure>`);
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\||[-*]\s|\d+\.\s|>|!\[)/.test(lines[i])) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

// Markdown to plain text for structured data: link text, code and emphasis without their markup.
export const plainText = (md: string) =>
  md
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])_([^_]+)_/g, '$1$2')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

// The h2 headings of rendered HTML, for a table of contents.
export const headings = (html: string) => [...html.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)].map((m) => ({ id: m[1], html: m[2] }));
