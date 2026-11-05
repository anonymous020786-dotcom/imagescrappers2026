// Builds the landing page into site-dist/ (no dependencies). Netlify runs this on every deploy.
//  - fills in {{SITE_URL}} (Netlify's primary URL, or SITE_URL), {{VERSION}} (package.json) and {{DATE}}
//  - adds search-engine verification meta tags from GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION
//  - points the download buttons at the stores when CHROME_STORE_URL / EDGE_STORE_URL / FIREFOX_STORE_URL are set
//  - copies the store screenshots and extension icons, so the images live in one place
//  - renders the guides (site/content/guides/*.md), the Help Center (site/content/help.md) and PRIVACY.md
//    with a shared template, and generates sitemap.xml from every page
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

// ------------------------------------------------------------- Markdown → HTML

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(text) {
  return esc(text)
    .replace(/!\[([^\]]*)\]\((\/[^)\s]+)\)/g, '<img src="$2" alt="$1" width="1280" height="800" loading="lazy" decoding="async">')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:|\/|#)[^)\s]*)\)/g, '<a href="$2">$1</a>')
    .replace(/&lt;(https?:[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
}

// Small Markdown subset: headings (h2/h3 get ids), paragraphs, lists, tables, images, "> " callouts.
export function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const listItems = (re) => {
    const items = [];
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
      const code = [];
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
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const [head, , ...body] = rows;
      out.push('<table><thead><tr>', ...cells(head).map((c) => `<th>${c}</th>`), '</tr></thead><tbody>');
      for (const r of body) out.push('<tr>', ...cells(r).map((c) => `<td>${c}</td>`), '</tr>');
      out.push('</tbody></table>');
    } else if (/^[-*]\s/.test(line)) {
      out.push('<ul>', ...listItems(/^[-*]\s+/), '</ul>');
    } else if (/^\d+\.\s/.test(line)) {
      out.push('<ol>', ...listItems(/^\d+\.\s+/), '</ol>');
    } else if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<div class="callout">${inline(quote.join(' '))}</div>`);
    } else if (/^!\[/.test(line)) {
      out.push(`<figure class="shot article-shot">${inline(line.trim())}</figure>`);
      i++;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\||[-*]\s|\d+\.\s|>|!\[)/.test(lines[i])) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

// "---" front matter of key: value lines, then the Markdown body.
function readContent(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${relative(ROOT, path)}: missing front matter`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
  for (const key of ['title', 'description', 'slug', 'updated']) if (!meta[key]) throw new Error(`${relative(ROOT, path)}: front matter needs "${key}"`);
  return { ...meta, body: m[2], path };
}

const CONTENT = join(SRC, 'content');
const guides = readdirSync(join(CONTENT, 'guides'))
  .filter((n) => n.endsWith('.md'))
  .map((n) => readContent(join(CONTENT, 'guides', n)))
  .sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99));
const help = readContent(join(CONTENT, 'help.md'));

const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const guideCard = (g) =>
  `<a class="guide-card" href="/guides/${g.slug}/"><span class="guide-tag">${esc(g.tag ?? 'Guide')}</span><strong>${esc(g.title)}</strong><span>${esc(g.description)}</span><em>Read the guide ${arrow}</em></a>`;

// ------------------------------------------------------------- copy the static site

rmSync(OUT, { recursive: true, force: true });
for (const file of walk(SRC)) {
  if (file.startsWith(CONTENT)) continue; // rendered below
  const dest = join(OUT, relative(SRC, file));
  if (TEXT.has(extname(file))) write(dest, fill(readFileSync(file, 'utf8')).replace('{{GUIDE_CARDS}}', guides.slice(0, 6).map(guideCard).join('\n          ')));
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

// ------------------------------------------------------------- page template

// Content pages reuse the home page's header and footer, with in-page links pointing back to the home page.
const home = readFileSync(join(OUT, 'index.html'), 'utf8');
const headerHtml = /<header class="site-header"[\s\S]*?<\/header>/.exec(home)[0].replace(/href="#/g, 'href="/#');
const footerHtml = /<footer class="site-footer">[\s\S]*?<\/footer>/.exec(home)[0].replace(/href="#/g, 'href="/#');
const headShared = /<link rel="icon"[\s\S]*?<link rel="stylesheet" href="\/styles.css">/.exec(home)[0].replace(/\s*<link rel="preload"[^>]*>/, '');
const jsonLd = (data) => `<script type="application/ld+json">\n${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}\n  </script>`;
const publisher = { '@type': 'Organization', name: 'Image Scraper Pro', url: `${siteUrl}/`, logo: { '@type': 'ImageObject', url: `${siteUrl}/assets/icon128.png` } };

function page({ path, title, description, type = 'article', crumbs = [], schema = [], body }) {
  const url = `${siteUrl}${path}`;
  const breadcrumb = crumbs.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [{ name: 'Home', path: '/' }, ...crumbs].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${siteUrl}${c.path}` })),
      }
    : null;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} – Image Scraper Pro</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0a0916" media="(prefers-color-scheme: dark)">
  <meta name="color-scheme" content="light dark">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="Image Scraper Pro">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${siteUrl}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${siteUrl}/assets/og-image.png">
  ${headShared}
  ${[breadcrumb, ...schema].filter(Boolean).map(jsonLd).join('\n  ')}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  ${headerHtml}
  <main id="main">
${body}
  </main>
  ${footerHtml}
  <script src="/main.js" defer></script>
</body>
</html>
`;
}

const breadcrumbNav = (crumbs) =>
  `<nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>${crumbs
    .map((c, i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${c.path}">${esc(c.name)}</a></li>`))
    .join('')}</ol></nav>`;

const ctaBox = `<aside class="cta-box">
        <div>
          <strong>Try it free in your browser</strong>
          <span>Free, open source and private. No account needed.</span>
        </div>
        <div class="cta-row">
          <a class="btn btn-primary" href="${hrefFor('chrome')}" data-dl="chrome">${chromeStore ? 'Add to Chrome' : 'Download for Chrome'}</a>
          <a class="btn" href="${hrefFor('firefox')}" data-dl="firefox">Firefox</a>
          <a class="btn" href="${hrefFor('edge')}" data-dl="edge">Edge</a>
        </div>
      </aside>`;

const humanDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// Table of contents from the h2 headings.
const toc = (html) => {
  const items = [...html.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)];
  return items.length >= 3 ? `<nav class="toc" aria-label="On this page"><strong>On this page</strong><ol>${items.map((m) => `<li><a href="#${m[1]}">${m[2]}</a></li>`).join('')}</ol></nav>` : '';
};

// ------------------------------------------------------------- guides

const pages = [{ path: '/', priority: '1.0', images: [1, 2, 3, 4, 5].map((n) => `/assets/screenshot-${n}.png`).concat('/assets/og-image.png') }];

for (const [index, g] of guides.entries()) {
  const html = markdownToHtml(g.body);
  const path = `/guides/${g.slug}/`;
  const crumbs = [{ name: 'Guides', path: '/guides/' }, { name: g.title, path }];
  const related = [...guides.slice(index + 1), ...guides.slice(0, index)].slice(0, 3);
  const images = [...html.matchAll(/<img src="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  write(
    join(OUT, 'guides', g.slug, 'index.html'),
    page({
      path,
      title: g.title,
      description: g.description,
      crumbs,
      schema: [
        {
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: g.title,
          description: g.description,
          image: `${siteUrl}/assets/og-image.png`,
          datePublished: g.published ?? g.updated,
          dateModified: g.updated,
          author: publisher,
          publisher,
          mainEntityOfPage: `${siteUrl}${path}`,
          about: { '@id': `${siteUrl}/#app` },
        },
      ],
      body: `    <article class="article wrap-narrow">
      ${breadcrumbNav(crumbs)}
      <header class="article-head">
        <span class="eyebrow">${esc(g.tag ?? 'Guide')}</span>
        <h1>${esc(g.title)}</h1>
        <p class="lead">${esc(g.description)}</p>
        <p class="article-meta">Updated <time datetime="${g.updated}">${humanDate(g.updated)}</time>${g.minutes ? ` · ${esc(g.minutes)} min read` : ''}</p>
      </header>
      ${toc(html)}
      <div class="prose">
${html}
      </div>
      ${ctaBox}
    </article>
    <section class="related wrap" aria-labelledby="related-title">
      <h2 id="related-title">More guides</h2>
      <div class="guide-grid">
        ${related.map(guideCard).join('\n        ')}
      </div>
    </section>`,
    }),
  );
  pages.push({ path, priority: '0.8', lastmod: g.updated, images });
}

write(
  join(OUT, 'guides', 'index.html'),
  page({
    path: '/guides/',
    title: 'Guides: download, convert and audit images',
    description: 'Step-by-step guides for downloading every image from a page or a whole website, converting to WebP, removing photo metadata and improving image SEO.',
    type: 'website',
    crumbs: [{ name: 'Guides', path: '/guides/' }],
    schema: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Image Scraper Pro guides',
        url: `${siteUrl}/guides/`,
        hasPart: guides.map((g) => ({ '@type': 'TechArticle', headline: g.title, url: `${siteUrl}/guides/${g.slug}/` })),
      },
    ],
    body: `    <section class="page-hero wrap">
      ${breadcrumbNav([{ name: 'Guides', path: '/guides/' }])}
      <span class="eyebrow">Guides</span>
      <h1>Learn to collect, prepare and optimize images</h1>
      <p class="lead">Practical, step-by-step guides for Image Scraper Pro, from saving every image on a page to auditing a whole site's image SEO.</p>
    </section>
    <section class="wrap guides-list" aria-label="All guides">
      <div class="guide-grid">
        ${guides.map(guideCard).join('\n        ')}
      </div>
      <p class="center muted guides-help">Can't find what you need? Visit the <a href="/help/">Help Center</a> or <a href="https://github.com/anonymous020786-dotcom/imagescrappers2026/issues">ask a question on GitHub</a>.</p>
    </section>`,
  }),
);
pages.push({ path: '/guides/', priority: '0.9' });

// ------------------------------------------------------------- help center (FAQ rich results)

const helpHtml = markdownToHtml(help.body);
// Every "### question" and the text under it becomes a FAQPage entry.
const faq = [...help.body.replace(/\r\n/g, '\n').matchAll(/^### (.+)\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/gm)].map((m) => ({
  '@type': 'Question',
  name: m[1].trim(),
  acceptedAnswer: { '@type': 'Answer', text: markdownToHtml(m[2].trim()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() },
}));
write(
  join(OUT, 'help', 'index.html'),
  page({
    path: '/help/',
    title: help.title,
    description: help.description,
    type: 'website',
    crumbs: [{ name: 'Help Center', path: '/help/' }],
    schema: [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }],
    body: `    <article class="article wrap-narrow">
      ${breadcrumbNav([{ name: 'Help Center', path: '/help/' }])}
      <header class="article-head">
        <span class="eyebrow">Help Center</span>
        <h1>${esc(help.heading ?? help.title)}</h1>
        <p class="lead">${esc(help.description)}</p>
      </header>
      ${toc(helpHtml)}
      <div class="prose">
${helpHtml}
      </div>
      ${ctaBox}
    </article>
    <section class="related wrap" aria-labelledby="related-title">
      <h2 id="related-title">Popular guides</h2>
      <div class="guide-grid">
        ${guides.slice(0, 3).map(guideCard).join('\n        ')}
      </div>
    </section>`,
  }),
);
pages.push({ path: '/help/', priority: '0.8', lastmod: help.updated });

// ------------------------------------------------------------- privacy policy (PRIVACY.md)

write(
  join(OUT, 'privacy', 'index.html'),
  page({
    path: '/privacy/',
    title: 'Privacy Policy',
    description: 'Image Scraper Pro runs entirely in your browser: no analytics, no tracking, and nothing sent to the developer. Read the full privacy policy.',
    crumbs: [{ name: 'Privacy Policy', path: '/privacy/' }],
    body: `    <article class="article wrap-narrow">
      ${breadcrumbNav([{ name: 'Privacy Policy', path: '/privacy/' }])}
      <div class="prose">
${markdownToHtml(readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8'))}
      </div>
    </article>`,
  }),
);
pages.push({ path: '/privacy/', priority: '0.3' });

// ------------------------------------------------------------- sitemap.xml (with images)

const xml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
write(
  join(OUT, 'sitemap.xml'),
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...pages.map((p) =>
      [
        '  <url>',
        `    <loc>${xml(siteUrl + p.path)}</loc>`,
        `    <lastmod>${p.lastmod ?? date}</lastmod>`,
        `    <priority>${p.priority}</priority>`,
        ...[...new Set(p.images ?? [])].map((img) => `    <image:image><image:loc>${xml(siteUrl + img)}</image:loc></image:image>`),
        '  </url>',
      ].join('\n'),
    ),
    '</urlset>',
    '',
  ].join('\n'),
);

console.log(`✔ site-dist/ built for ${siteUrl} (v${version}): ${guides.length} guides, help center with ${faq.length} questions, ${pages.length} pages in the sitemap`);
