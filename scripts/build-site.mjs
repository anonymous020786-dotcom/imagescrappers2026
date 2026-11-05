// Builds the landing page into site-dist/ (no dependencies). Netlify runs this on every deploy.
//  - fills in {{SITE_URL}} (Netlify's primary URL, or SITE_URL), {{VERSION}} (package.json) and {{DATE}}
//  - adds search-engine verification meta tags from GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION
//  - points the download buttons at the stores when CHROME_STORE_URL / EDGE_STORE_URL / FIREFOX_STORE_URL are set
//  - copies the store screenshots and extension icons, so the images live in one place
//  - renders PRIVACY.md as /privacy/
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'site');
const OUT = join(ROOT, 'site-dist');
const TEXT = new Set(['.html', '.xml', '.txt', '.webmanifest', '.css', '.js', '.json']);

const siteUrl = (process.env.SITE_URL || process.env.URL || 'https://image-scraper-pro.netlify.app').replace(/\/+$/, '');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const date = new Date().toISOString().slice(0, 10);
// Search Console / Bing Webmaster "HTML tag" verification: set the token as an environment variable in Netlify.
const verification = [
  ['google-site-verification', process.env.GOOGLE_SITE_VERIFICATION],
  ['msvalidate.01', process.env.BING_SITE_VERIFICATION],
]
  .filter(([, token]) => token?.trim())
  .map(([name, token]) => `<meta name="${name}" content="${token.trim().replace(/[^\w-]/g, '')}">`)
  .join('\n  ');
// Store listings: set CHROME_STORE_URL / EDGE_STORE_URL / FIREFOX_STORE_URL in Netlify and the download buttons
// become "Add to …" links, so installs count towards the store ranking. Unset, they download the ZIP from GitHub.
const storeUrl = (name) => (/^https:\/\/\S+$/.test(process.env[name]?.trim() ?? '') ? process.env[name].trim() : '');
const chromeStore = storeUrl('CHROME_STORE_URL');
const stores = {
  chrome: [chromeStore, 'Add to Chrome'],
  brave: [chromeStore, 'Add from Chrome Web Store'],
  vivaldi: [chromeStore, 'Add from Chrome Web Store'],
  edge: [storeUrl('EDGE_STORE_URL'), 'Get it from Edge Add-ons'],
  firefox: [storeUrl('FIREFOX_STORE_URL'), 'Add to Firefox'],
};
const zipUrl = (browser) => `https://github.com/anonymous020786-dotcom/imagescrappers2026/raw/main/dist/image-scraper-pro-${browser}-${version}.zip`;
// The store pages are the same product: listed as sameAs in the structured data.
const sameAs = [chromeStore, stores.firefox[0], stores.edge[0]].filter(Boolean);
const hrefFor = (browser) => stores[browser]?.[0] || zipUrl(browser);
const ctaFor = (browser) => (stores[browser]?.[0] ? stores[browser][1] : 'Download .zip');
const fill = (text) =>
  text
    .replaceAll('{{SITE_URL}}', siteUrl)
    .replaceAll('{{VERSION}}', version)
    .replaceAll('{{DATE}}', date)
    .replace(/\{\{HREF:(\w+)\}\}/g, (_, b) => hrefFor(b))
    .replace(/\{\{CTA:(\w+)\}\}/g, (_, b) => ctaFor(b))
    .replaceAll('{{CHROME_BUTTON}}', chromeStore ? 'Add to Chrome' : 'Download for Chrome')
    .replace(/^[ \t]*\{\{SAME_AS\}\}\n/m, sameAs.length ? `        "sameAs": ${JSON.stringify(sameAs)},\n` : '')
    .replaceAll('{{INSTALL_URL}}', chromeStore || 'https://github.com/anonymous020786-dotcom/imagescrappers2026/releases/latest')
    .replace(/^[ \t]*\{\{SITE_VERIFICATION\}\}\n/m, verification ? `  ${verification}\n` : '');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

rmSync(OUT, { recursive: true, force: true });
for (const file of walk(SRC)) {
  const dest = join(OUT, relative(SRC, file));
  if (TEXT.has(extname(file))) write(dest, fill(readFileSync(file, 'utf8')));
  else {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(file, dest);
  }
}

const assets = join(OUT, 'assets');
mkdirSync(assets, { recursive: true });
for (let i = 1; i <= 5; i++) cpSync(join(ROOT, 'store', 'chrome', `screenshot-${i}.png`), join(assets, `screenshot-${i}.png`));
for (const size of [32, 128]) cpSync(join(ROOT, 'src', 'icons', `icon${size}.png`), join(assets, `icon${size}.png`));
if (!existsSync(join(assets, 'og-image.png'))) throw new Error('site/assets/og-image.png is missing: run `npm run site:og`');

// ------------------------------------------------------------- PRIVACY.md → HTML

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/&lt;(https?:[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
}

export function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const [head, , ...body] = rows;
      out.push('<table><thead><tr>', ...cells(head).map((c) => `<th>${c}</th>`), '</tr></thead><tbody>');
      for (const r of body) out.push('<tr>', ...cells(r).map((c) => `<td>${c}</td>`), '</tr>');
      out.push('</tbody></table>');
    } else if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && (/^[-*]\s/.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        if (/^[-*]\s/.test(lines[i])) items.push(lines[i].replace(/^[-*]\s+/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push('<ul>', ...items.map((t) => `<li>${inline(t)}</li>`), '</ul>');
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\||[-*]\s)/.test(lines[i])) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

const privacy = markdownToHtml(readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8'));
write(join(OUT, 'privacy', 'index.html'), fill(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy Policy – Image Scraper Pro</title>
  <meta name="description" content="Image Scraper Pro runs entirely in your browser: no analytics, no tracking, and nothing sent to the developer. Read the full privacy policy.">
  <link rel="canonical" href="{{SITE_URL}}/privacy/">
  <meta property="og:type" content="article">
  <meta property="og:title" content="Privacy Policy – Image Scraper Pro">
  <meta property="og:url" content="{{SITE_URL}}/privacy/">
  <meta property="og:image" content="{{SITE_URL}}/assets/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/icon32.png" sizes="32x32" type="image/png">
  <script src="/theme.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
  <script src="/analytics.js"></script>
  <script async src="https://www.googletagmanager.com/gtm.js?id=GTM-KKDJ4GW4"></script>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header">
    <nav class="wrap nav" aria-label="Main">
      <a class="brand" href="/"><img src="/assets/icon128.png" alt="" width="34" height="34">Image Scraper Pro</a>
      <div class="nav-cta" style="margin-left: auto;"><button class="icon-btn theme-toggle" type="button" aria-label="Switch to dark theme" title="Switch theme"><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg></button><a class="btn btn-sm btn-primary" href="/#download">Get it free</a></div>
    </nav>
  </header>
  <main class="doc">
${privacy}
  </main>
  <footer class="site-footer"><div class="wrap foot-bottom" style="border: 0; margin: 0; padding: 0;">
    <span>© ${new Date().getFullYear()} Image Scraper Pro. Open source under GPL-3.0.</span>
    <a href="/">Back to the home page</a>
  </div></footer>
  <script src="/main.js" defer></script>
</body>
</html>
`));

console.log(`✔ site-dist/ built for ${siteUrl} (v${version})`);
