// Image SEO for whole pages: the images that represent a page when it is shared (Open Graph,
// Twitter/X cards) or shown in rich results (structured data), plus Google image sitemaps.
// Pure functions (no browser APIs) so the rules are unit-tested in Node.

const OG_MIN_WIDTH = 1200;
const OG_MIN_HEIGHT = 630;
const OG_RATIO = 1.91; // the shape large link previews use
const OG_RATIO_TOLERANCE = 0.15;
const SITEMAP_MAX_URLS = 50_000; // per sitemap file (sitemaps.org)
const SITEMAP_MAX_IMAGES = 1_000; // per page (Google)

export const PAGE_RULES = {
  'no-og-image': {
    label: 'No social sharing image',
    severity: 'error',
    fix: 'Add <meta property="og:image" content="https://…"> so links to the page show a preview image on social networks and in chat apps.',
  },
  'small-og-image': {
    label: 'Social image too small',
    severity: 'warning',
    fix: `Use an og:image of at least ${OG_MIN_WIDTH}×${OG_MIN_HEIGHT} px so it can show as a large preview.`,
  },
  'og-image-ratio': {
    label: 'Social image will be cropped',
    severity: 'info',
    fix: `Use a ${OG_RATIO}:1 image (for example ${OG_MIN_WIDTH}×${OG_MIN_HEIGHT}) so previews are not cropped.`,
  },
  'insecure-og-image': {
    label: 'Social image over http',
    severity: 'warning',
    fix: 'Serve the og:image over https. Many platforms ignore insecure preview images.',
  },
  'no-structured-image': {
    label: 'No image in structured data',
    severity: 'info',
    fix: 'Add an "image" to the page\'s JSON-LD (Article, Product, Recipe…) so it can appear with a picture in rich results.',
  },
};

// Where an image was declared as a page's representative image: [{ page, tags: ['og' | 'twitter' | 'schema'] }].
// A scan tags the image itself; a crawl keeps one entry per page because an image is stored only once.
export function seoRefs(img) {
  if (img.seoRefs?.length) return img.seoRefs;
  return img.seo?.length && img.pageUrl ? [{ page: img.pageUrl, tags: img.seo }] : [];
}

// Page-level findings for every page the images were found on, worst first.
export function auditPages(images) {
  const pages = new Map();
  const pageFor = (url, title) => {
    if (!/^https?:/i.test(url ?? '')) return null;
    if (!pages.has(url)) pages.set(url, { title: title ?? '', og: [], twitter: [], schema: [] });
    const p = pages.get(url);
    p.title ||= title ?? '';
    return p;
  };
  for (const img of images) {
    pageFor(img.pageUrl, img.pageTitle);
    for (const { page, tags } of seoRefs(img)) {
      const p = pageFor(page, page === img.pageUrl ? img.pageTitle : '');
      if (!p) continue;
      for (const tag of tags) if (p[tag] && !p[tag].includes(img)) p[tag].push(img);
    }
  }

  const findings = [];
  const add = (page, title, rule, detail) =>
    findings.push({ page, title, rule, label: PAGE_RULES[rule].label, severity: PAGE_RULES[rule].severity, detail, fix: PAGE_RULES[rule].fix });
  for (const [page, p] of pages) {
    const social = p.og[0] ?? p.twitter[0];
    if (!p.og.length) add(page, p.title, 'no-og-image', p.twitter.length ? 'Only twitter:image is set; Facebook, LinkedIn and chat apps need og:image' : 'No og:image or twitter:image');
    if (social) {
      const { width: w, height: h } = social;
      if (w && h && (w < OG_MIN_WIDTH || h < OG_MIN_HEIGHT)) add(page, p.title, 'small-og-image', `${w}×${h}`);
      if (w && h && Math.abs(w / h - OG_RATIO) / OG_RATIO > OG_RATIO_TOLERANCE) add(page, p.title, 'og-image-ratio', `${w}×${h} is ${(w / h).toFixed(2)}:1`);
      if (/^https:/i.test(page) && /^http:/i.test(social.url)) add(page, p.title, 'insecure-og-image', social.url);
    }
    if (!p.schema.length) add(page, p.title, 'no-structured-image', 'No image, logo or thumbnailUrl in JSON-LD or microdata');
  }
  const order = { error: 0, warning: 1, info: 2 };
  return findings.sort((x, y) => order[x.severity] - order[y.severity]);
}

// Whether the social image sizes are still unknown (they are measured by Analyze).
export function socialSizesUnknown(images) {
  return images.some((img) => seoRefs(img).some((r) => r.tags.includes('og') || r.tags.includes('twitter')) && !(img.width && img.height));
}

function xml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}

// Images worth listing: real web addresses, not favicons or tracking pixels.
function sitemapWorthy(img) {
  if (!/^https?:/i.test(img.url)) return false;
  const sources = img.sources?.length ? img.sources : [img.source];
  if (sources.every((s) => s === 'icon')) return false;
  return !(img.width && img.height && img.width <= 2 && img.height <= 2);
}

// Google image sitemaps (https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps),
// one page per <url> with its images. Returns one XML string per 50,000 pages.
export function imageSitemaps(images) {
  const pages = new Map();
  for (const img of images) {
    if (!sitemapWorthy(img)) continue;
    const onPages = new Set([img.pageUrl, ...seoRefs(img).map((r) => r.page)].filter((u) => /^https?:/i.test(u ?? '')));
    for (const page of onPages) {
      if (!pages.has(page)) pages.set(page, new Set());
      const set = pages.get(page);
      if (set.size < SITEMAP_MAX_IMAGES) set.add(img.url);
    }
  }
  const entries = [...pages];
  const files = [];
  for (let i = 0; i < entries.length; i += SITEMAP_MAX_URLS) {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ];
    for (const [page, urls] of entries.slice(i, i + SITEMAP_MAX_URLS)) {
      lines.push('  <url>', `    <loc>${xml(page)}</loc>`);
      for (const u of urls) lines.push('    <image:image>', `      <image:loc>${xml(u)}</image:loc>`, '    </image:image>');
      lines.push('  </url>');
    }
    lines.push('</urlset>', '');
    files.push(lines.join('\n'));
  }
  return files;
}
