import type { Metadata } from 'next';
import Link from 'next/link';
import { AlsoOn, HeroInstallButton, VisitorBrowserMarker } from '@/components/BrowserAware';
import { GuideGrid } from '@/components/Content';
import {
  BracesIcon, ChartIcon, CheckIcon, ChevronIcon, DownloadIcon, EditIcon, FileIcon, FilterIcon, GlobeIcon, InfoIcon, LockIcon,
  SearchIcon, ShareIcon, TextIcon,
} from '@/components/Icons';
import { JsonLd } from '@/components/JsonLd';
import { CountUp } from '@/components/Polish';
import { UseCaseTabs, type UseCase } from '@/components/UseCaseTabs';
import { getGuides } from '@/lib/content';
import { markdownToHtml, plainText } from '@/lib/markdown';
import { pageMetadata } from '@/lib/metadata';
import { REPO, chromeButton, ctaFor, hrefFor, installUrl, sameAs, siteUrl, version, type Browser } from '@/lib/site';

const TITLE = 'Image Scraper Pro – Free Bulk Image Downloader Extension';
const DESCRIPTION =
  'Find, filter and bulk-download every image on any page, or crawl a whole site. Free, open-source extension for Chrome, Edge, Firefox and Safari, with image SEO audit.';
const SHARE_TITLE = 'Image Scraper Pro – Find and download every image on any page';

export const metadata: Metadata = {
  ...pageMetadata({
    title: TITLE,
    absoluteTitle: true,
    description: DESCRIPTION,
    path: '/',
    shareTitle: SHARE_TITLE,
    shareDescription:
      'Free, open-source image downloader and image SEO audit for every major browser. Bulk download, ZIP, crawl whole sites. No account, no tracking in the extension.',
    twitterDescription: 'Free, open-source image downloader and image SEO audit for Chrome, Edge, Firefox, Brave, Opera, Vivaldi and Safari.',
  }),
  keywords: [
    'image downloader', 'image scraper', 'bulk image download', 'download all images', 'image extractor', 'chrome extension',
    'firefox add-on', 'image SEO', 'alt text checker', 'image sitemap',
  ],
};

const BROWSERS: { id: Browser; name: string; color: string; note: string }[] = [
  { id: 'chrome', name: 'Chrome', color: '#3b7bea', note: 'Recommended · side panel' },
  { id: 'edge', name: 'Microsoft Edge', color: '#0c8bd0', note: 'Side panel supported' },
  { id: 'firefox', name: 'Firefox', color: '#f2672a', note: 'Desktop & Android, 121+' },
  { id: 'brave', name: 'Brave', color: '#e8512b', note: 'Chromium build' },
  { id: 'opera', name: 'Opera', color: '#e3233a', note: 'Chromium build' },
  { id: 'vivaldi', name: 'Vivaldi', color: '#d93a3a', note: 'Chromium build' },
  { id: 'safari', name: 'Safari', color: '#1b88ca', note: 'macOS, Safari 16.4+ (Xcode)' },
];
const shortName = (b: (typeof BROWSERS)[number]) => b.name.replace('Microsoft ', '');

const DETECTED = ['<img>', 'srcset', '<picture>', 'data-src', 'CSS background', '::before / ::after', 'inline SVG', '<canvas>', 'video poster', 'og:image', 'JSON-LD', 'favicons', 'Shadow DOM', 'iframes', 'network'];
const HOT = new Set(['<img>', 'srcset', 'data-src', 'Shadow DOM']);

const USE_CASES: UseCase[] = [
  {
    id: 'design',
    label: 'Designers',
    title: 'Collect inspiration in seconds',
    text: 'Grab every visual from a page at full resolution, drop the tiny icons, and save the rest as a tidy, named ZIP or a contact sheet.',
    points: ['Highest-resolution srcset image, automatically', 'Colour palette of any image, copied as HEX or CSS', 'Collections with tags and notes to keep moodboards'],
  },
  {
    id: 'seo',
    label: 'SEO & marketing',
    title: 'Fix image SEO page by page — or site-wide',
    text: 'Crawl a site, run the audit and get a ranked list of pages with weak alt text, poor file names or missing social images.',
    points: ['Alt text, file name and og:image checks with fixes', 'Google image sitemap ready for Search Console', 'CSV reports to share with your team or clients'],
  },
  {
    id: 'shop',
    label: 'E-commerce',
    title: 'Prepare product images in bulk',
    text: 'Pull your catalogue images, then resize, convert and watermark a whole selection in one go — ready for marketplaces and social posts.',
    points: ['Exact sizes for social and marketplace listings', 'Target file size and WebP/JPEG/PNG conversion', 'Your own text or logo watermark, previewed first'],
  },
  {
    id: 'dev',
    label: 'Developers & research',
    title: 'Audit, export and automate',
    text: 'Find oversized images and lazy-loading mistakes, export lists as JSON or CSV, and generate URL ranges for datasets.',
    points: [
      'Performance audit with measured WebP savings',
      'TXT, CSV, JSON and HTML exports, copy as Markdown',
      <>URL pattern generator: <code>img[001-500].jpg</code></>,
    ],
  },
];

const TOUR = [
  {
    title: 'Select exactly what you need',
    text: 'Shift-click ranges, select all or invert, then filter by size presets like ≥800 px or HD. Analyze fetches the exact size, real type and true dimensions of every image.',
    points: ['Perceptual-hash duplicate detection', 'Keep the best copy of each duplicate group', 'Sort by resolution, size, name, type or domain'],
    img: 2,
    alt: 'A filtered selection of photos with their pixel sizes and file sizes shown after analysis',
  },
  {
    title: 'Preview every detail',
    text: 'Zoom up to 12×, pan and browse with the arrow keys. See dimensions, type, size, alt text, source, colour palette, camera data and licence information.',
    points: ['Reverse image search with Google Lens, Bing, TinEye or Yandex', 'Jump to the image on the original page', 'Copy the image or its URL in one click'],
    img: 3,
    alt: 'Lightbox preview of a landscape photo with a metadata panel listing its size, type and source',
  },
  {
    title: 'Scrape an entire website',
    text: 'The crawler follows links, "next page" buttons and sitemaps. Fast HTML mode handles hundreds of pages per minute; full-render mode runs JavaScript-built galleries.',
    points: ['Pause, resume and stop with a live activity log', 'Include and exclude patterns, depth and scope', 'Send results straight to the dashboard'],
    img: 4,
    alt: 'The website crawler with start URLs, depth and scope settings and a live log of pages crawled',
  },
  {
    title: 'One click from the toolbar',
    text: 'The popup shows an instant image count and the largest images on the page. Quick download uses your saved filters and naming rules.',
    points: ['Right-click menus for single images and linked pages', "Side panel that follows the tab you're on", 'Light and dark themes, settings synced across devices'],
    img: 5,
    alt: 'The toolbar popup over a web page, showing the number of images found and the largest ones as thumbnails',
  },
];

const SEO_CHECKS = [
  { Icon: TextIcon, title: 'Alt text quality', text: 'Missing, generic ("image", "IMG_1234.jpg"), keyword-stuffed, too long or reused.' },
  { Icon: FileIcon, title: 'Descriptive file names', text: 'Flags camera defaults and hashes, even behind image CDNs.' },
  { Icon: ShareIcon, title: 'Social sharing images', text: 'og:image and Twitter cards present, 1200×630, 1.91:1 and over https.' },
  { Icon: BracesIcon, title: 'Structured data & sitemaps', text: 'Images in JSON-LD for rich results, plus a Google image sitemap export.' },
];

const STEPS = [
  { title: 'Open any page', text: 'Click the toolbar icon. The extension scans every frame and counts the images instantly.' },
  { title: 'Filter & review', text: 'Narrow the results with filters, preview in the lightbox and run the SEO audit if you like.' },
  { title: 'Download', text: 'Save files or a ZIP, converted and named your way — or export a list, PDF, contact sheet or image sitemap.' },
];

const SHORTCUTS: [string[], string][] = [
  [['Alt', 'Shift', 'I'], 'open popup'],
  [['Alt', 'Shift', 'O'], 'open dashboard'],
  [['Alt', 'Shift', 'D'], 'quick download'],
  [['/'], 'search'],
  [['Z'], 'download ZIP'],
];

// One source for the visible FAQ and its structured data. Answers are Markdown.
const FAQ = [
  { q: 'Is Image Scraper Pro free?', a: 'Yes. It is free and open source under the GPL-3.0 licence, with no account, no ads and no paid tier.' },
  {
    q: 'Does the extension collect my data?',
    a: 'No. Everything — scanning, editing, metadata removal, the SEO audit, PDFs and collections — runs in your browser. The extension has no analytics or tracking and sends nothing to the developer. Only reverse image search, when you choose it, opens the search engine you pick. Read the [privacy policy](/privacy/).',
  },
  {
    q: 'Which browsers are supported?',
    a: 'Chrome, Microsoft Edge, Brave, Opera, Vivaldi, Firefox (desktop and Android, version 121+) and Safari 16.4+ on macOS, all built from the same Manifest V3 code.',
  },
  {
    q: 'How do I install it from the ZIP file?',
    a: `Unzip the download, open \`chrome://extensions\` (or \`edge://extensions\`), turn on Developer mode, click _Load unpacked_ and choose the unzipped folder. In Firefox, open \`about:debugging\`, choose _This Firefox_ and click _Load Temporary Add-on_. The [install guide](${REPO}/blob/main/DEPLOY.md) covers every browser.`,
  },
  {
    q: 'What does the image SEO audit check?',
    a: 'Missing, generic, keyword-stuffed, overly long or reused alt text; non-descriptive file names; missing or undersized Open Graph and Twitter images; missing structured-data images; oversized files; images that could be WebP; and lazy-loading mistakes. It exports a CSV report and a Google image sitemap.',
  },
  {
    q: 'Can it download images from a whole website?',
    a: 'Yes. The bulk scraper accepts thousands of URLs, and the crawler follows links, pagination and `sitemap.xml` with depth, scope and speed controls. It respects `robots.txt` by default.',
  },
  {
    q: 'Am I allowed to use the images I download?',
    a: "That depends on each image's licence and the website's terms. The extension shows the creator, credit and licence a page or file states, and records each image's source in ZIP downloads, but it is not legal advice. Please respect copyright.",
  },
];

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteUrl}/#app`,
      name: 'Image Scraper Pro',
      applicationCategory: 'BrowserApplication',
      applicationSubCategory: 'Image downloader',
      operatingSystem: 'Chrome, Microsoft Edge, Firefox, Brave, Opera, Vivaldi, Safari',
      softwareVersion: version,
      description:
        'Browser extension that finds every image on a web page — img, srcset, lazy-loaded, CSS backgrounds, SVG, canvas, Shadow DOM and iframes — and lets you filter, preview, audit and bulk-download them, or crawl a whole website.',
      url: `${siteUrl}/`,
      downloadUrl: installUrl,
      installUrl,
      screenshot: [1, 3, 4].map((n) => `${siteUrl}/assets/screenshot-${n}.png`),
      image: `${siteUrl}/assets/og-image.png`,
      license: 'https://www.gnu.org/licenses/gpl-3.0.html',
      ...(sameAs.length ? { sameAs } : {}),
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: [
        'Detects img, srcset, picture, lazy-load, CSS background, pseudo-element, SVG, canvas, video poster, Open Graph and JSON-LD images',
        'Shadow DOM and iframe scanning, auto-scroll and live mode',
        'Filters by size, type, shape, domain, colour and file size',
        'Bulk download and ZIP with file-name templates',
        'Website crawler with sitemap.xml and robots.txt support',
        'Image SEO audit: alt text, file names, social images, structured data',
        'Google image sitemap export',
        'Format conversion, resize, crop, watermark and metadata removal',
      ],
    },
    { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: `${siteUrl}/`, name: 'Image Scraper Pro', inLanguage: 'en' },
    {
      '@type': 'FAQPage',
      '@id': `${siteUrl}/#faq`,
      mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plainText(f.a) } })),
    },
  ],
};

const Check = () => <CheckIcon />;

export default function HomePage() {
  const guides = getGuides();
  return (
    <>
      <JsonLd data={structuredData} />

      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap hero-grid">
          <div>
            <a className="pill" href="#seo">
              <b>NEW</b> Image SEO audit &amp; image sitemaps
              <ChevronIcon />
            </a>
            <h1 id="hero-title">
              Download <span className="grad-text">every image</span> on any web page
            </h1>
            <p className="lead">
              Image Scraper Pro finds the images other tools miss — lazy-loaded, CSS backgrounds, SVG, canvas, Shadow DOM and iframes — then lets you filter,
              audit and bulk-download them in one click.
            </p>
            <div className="cta-row">
              <HeroInstallButton
                fallback="chrome"
                options={BROWSERS.map((b) => ({ id: b.id, name: shortName(b), href: hrefFor(b.id), cta: ctaFor(b.id) }))}
              />
              <a className="btn" href="#download">
                All browsers
              </a>
            </div>
            <AlsoOn options={BROWSERS.map((b) => ({ id: b.id, name: shortName(b), href: hrefFor(b.id), cta: ctaFor(b.id) }))} />
            <ul className="trust" aria-label="Highlights">
              {['Free & open source', 'No account', 'Runs 100% locally'].map((t) => (
                <li key={t}>
                  <Check />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="hero-visual">
            <figure className="browser-frame" style={{ margin: 0 }}>
              <div className="browser-bar" aria-hidden="true">
                <span />
                <span />
                <span />
                <em>Image Scraper Pro — Dashboard</em>
              </div>
              <img
                src="/assets/screenshot-1.png"
                width={1280}
                height={800}
                fetchPriority="high"
                alt="Image Scraper Pro dashboard showing a grid of landscape photos found on a page, with size, type and source filters in the sidebar and download buttons at the bottom"
              />
            </figure>
            <div className="float-card fc-1" aria-hidden="true">
              <div className="fc-icon">
                <SearchIcon />
              </div>
              <div>
                <strong>142 images found</strong>
                <span>img · srcset · CSS · SVG</span>
              </div>
            </div>
            <div className="float-card fc-2" aria-hidden="true">
              <div className="fc-icon">
                <DownloadIcon />
              </div>
              <div>
                <strong>Packing ZIP…</strong>
                <div className="mini-bar">
                  <i />
                </div>
              </div>
            </div>
            <div className="float-card fc-3" aria-hidden="true">
              <div className="fc-icon ok">
                <CheckIcon />
              </div>
              <div>
                <strong>Image SEO audit</strong>
                <span>alt text · og:image · sitemap</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="strip wrap">
        <p>One extension, every major browser</p>
        <ul className="browser-list">
          {BROWSERS.map((b) => (
            <li key={b.id}>
              <span className="mono" style={{ ['--c' as string]: b.color }}>
                {b.name.replace('Microsoft ', '')[0]}
              </span>
              {shortName(b)}
            </li>
          ))}
        </ul>
      </div>

      <div className="stats-wrap wrap">
        <ul className="stats reveal" aria-label="At a glance">
          {[
            ['110+', 'features'],
            ['20+', 'ways to find images'],
            ['7', 'browsers supported'],
            ['0', 'trackers in the extension'],
          ].map(([n, label]) => (
            <li key={label}>
              <CountUp value={n} />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>

      <section id="features" aria-labelledby="features-title">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Features</span>
            <h2 id="features-title">Everything you need to collect images — at any scale</h2>
            <p className="lead">From one photo to a whole-site crawl, Image Scraper Pro is thorough, fast and private.</p>
          </div>
          <div className="bento">
            <article className="card span-4 wide-sm reveal">
              <div className="icon">
                <SearchIcon />
              </div>
              <h3>Finds the images other tools miss</h3>
              <p>
                Picks the highest-resolution <code>srcset</code> candidate, reads 20+ lazy-load attributes and walks into Shadow DOM and every iframe.
                Auto-scroll loads infinite pages; live mode catches images as they appear.
              </p>
              <div className="demo tags" aria-label="Image sources detected">
                {DETECTED.map((t) => (
                  <span key={t} className={`tag${HOT.has(t) ? ' hot' : ''}`}>
                    {t}
                  </span>
                ))}
              </div>
            </article>
            <article className="card span-2 reveal">
              <div className="icon">
                <FilterIcon />
              </div>
              <h3>Smart filters</h3>
              <p>Size, type, shape, domain, colour and file size — with live counts.</p>
              <div className="demo" aria-hidden="true">
                <div className="filter-row">
                  Width{' '}
                  <span className="range">
                    <i />
                  </span>
                </div>
                <div className="filter-row">
                  Hide tracking pixels <span className="switch" />
                </div>
                <div className="filter-row">
                  Type{' '}
                  <span className="tags">
                    <span className="tag hot">JPG</span>
                    <span className="tag">WebP</span>
                  </span>
                </div>
              </div>
            </article>
            <article className="card span-2 reveal">
              <div className="icon">
                <DownloadIcon />
              </div>
              <h3>Bulk download &amp; ZIP</h3>
              <p>Pause, resume, retry — or one ZIP, split automatically for huge sets.</p>
              <div className="demo zip" aria-hidden="true">
                <div className="zip-row">
                  <span>photos_part1.zip</span>
                  <span>486 files</span>
                </div>
                <div className="progress">
                  <i />
                </div>
                <div className="zip-row">
                  <span>{'{domain}/{index:3}.jpg'}</span>
                  <span>template</span>
                </div>
              </div>
            </article>
            <article className="card span-2 reveal">
              <div className="icon">
                <GlobeIcon />
              </div>
              <h3>Crawl whole websites</h3>
              <p>
                Links, pagination and <code>sitemap.xml</code>, with robots.txt respected.
              </p>
              <div className="demo log" aria-hidden="true">
                <div>
                  <b>200</b> /gallery/ <em>+48 images</em>
                </div>
                <div>
                  <b>200</b> /gallery/page/2 <em>+51</em>
                </div>
                <div>
                  <b>200</b> /blog/autumn-trip <em>+23</em>
                </div>
              </div>
            </article>
            <article className="card span-2 reveal">
              <div className="icon">
                <EditIcon />
              </div>
              <h3>Edit, convert &amp; clean</h3>
              <p>Resize, crop, watermark, hit a target size and strip EXIF/GPS.</p>
              <div className="demo convert" aria-hidden="true">
                <span className="fmt">PNG</span>→<span className="fmt to">WebP</span>
                <span className="saving">smaller</span>
              </div>
            </article>
            <article className="card span-3 feature-seo reveal">
              <div className="icon">
                <ChartIcon />
              </div>
              <h3>
                Image SEO audit <span className="new-tag">NEW</span>
              </h3>
              <p>Alt text, file names, social sharing images, structured data and page speed — with a fix for every finding and a Google image sitemap export.</p>
              <a className="card-link" href="#seo">
                See what it checks →
              </a>
            </article>
            <article className="card span-3 reveal">
              <div className="icon">
                <LockIcon />
              </div>
              <h3>Private by design</h3>
              <p>Everything runs inside your browser: no account, no analytics, no remote servers. It&apos;s open source, so you can check every line.</p>
              <Link className="card-link" href="/privacy/">
                Read the privacy policy →
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section id="use-cases" className="alt-bg" aria-labelledby="use-title">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Use cases</span>
            <h2 id="use-title">Built for the way you work</h2>
          </div>
          <UseCaseTabs cases={USE_CASES} />
        </div>
      </section>

      <section aria-labelledby="tour-title">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Take the tour</span>
            <h2 id="tour-title">Powerful when you need it, simple when you don&apos;t</h2>
          </div>
          <div className="showcase">
            {TOUR.map((t, i) => (
              <div key={t.title} className={`show-row${i % 2 ? ' flip' : ''}`}>
                <div className="show-text reveal">
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                  <ul className="checks">
                    {t.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
                <div className="shot-wrap reveal">
                  <div className="shot">
                    <img src={`/assets/screenshot-${t.img}.png`} width={1280} height={800} loading="lazy" decoding="async" alt={t.alt} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="seo" className="alt-bg" aria-labelledby="seo-title">
        <div className="wrap seo-grid">
          <div className="reveal">
            <span className="eyebrow">
              Image SEO audit <span className="new-tag">NEW</span>
            </span>
            <h2 id="seo-title">Rank higher in image search and look great when shared</h2>
            <p className="lead">
              Click <strong>Audit</strong> on any page — or a whole crawled site — to see what&apos;s holding its images back, with a clear fix for every finding.
            </p>
            <ul className="seo-list">
              {SEO_CHECKS.map(({ Icon, title, text }) => (
                <li key={title}>
                  <span className="ic">
                    <Icon />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div
            className="audit reveal"
            role="img"
            aria-label="Example audit report listing a missing social image, weak alt text and an oversized image, with buttons to export an image sitemap and a CSV"
          >
            <div className="audit-head">
              <strong>Image audit &amp; SEO</strong>
              <span className="muted">✕</span>
            </div>
            <div className="score">
              <div className="ring" style={{ ['--p' as string]: 72 }}>
                <b>72</b>
              </div>
              <div>
                <strong>example-shop.com/sofas/</strong>
                <p>6 of 24 images have findings · about 1.8 MB could be saved · 2 page SEO findings</p>
              </div>
            </div>
            <div className="chips">
              <span className="chip on">
                All findings <b>8</b>
              </span>
              {[
                ['No social sharing image', 1],
                ['Alt text says nothing', 2],
                ['Non-descriptive file name', 3],
                ['Oversized image', 2],
              ].map(([label, n]) => (
                <span key={label} className="chip">
                  {label} <b>{n}</b>
                </span>
              ))}
            </div>
            <div className="row">
              <div className="thumb page">
                <GlobeIcon />
              </div>
              <div className="row-body">
                <span className="row-url">example-shop.com/sofas/</span>
                <span className="sev error">error</span>No social sharing image <span className="muted">— No og:image or twitter:image</span>
              </div>
            </div>
            <div className="row">
              <div className="thumb" />
              <div className="row-body">
                <span className="row-url">cdn.example-shop.com/uploads/IMG_20240518_101522.jpg</span>
                <span className="sev warning">warning</span>Alt text says nothing <span className="muted">— alt=&quot;image&quot;</span>
                <br />
                <span className="sev info">info</span>Non-descriptive file name
              </div>
            </div>
            <div className="row">
              <div className="thumb t2" />
              <div className="row-body">
                <span className="row-url">cdn.example-shop.com/hero-living-room.jpg</span>
                <span className="sev warning">warning</span>Oversized image <span className="muted">— 4000×2667 shown at 1200×800</span>
              </div>
            </div>
            <div className="audit-foot">
              <span className="fake-btn">Image sitemap</span>
              <span className="fake-btn">Measure WebP savings</span>
              <span className="fake-btn primary">Export CSV</span>
            </div>
          </div>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2 id="how-title">From page to folder in three steps</h2>
          </div>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.title} className="reveal">
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="shortcuts" aria-label="Keyboard shortcuts">
            {SHORTCUTS.map(([keys, label]) => (
              <span key={label}>
                {keys.map((k, i) => (
                  <span key={k} style={{ display: 'contents' }}>
                    {i > 0 && '+'}
                    <kbd>{k}</kbd>
                  </span>
                ))}{' '}
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="download" className="alt-bg" aria-labelledby="download-title">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Download</span>
            <h2 id="download-title">Free for every major browser</h2>
            <p className="lead">Version {version} · Manifest V3 · GPL-3.0. Pick your browser to download a ready-to-install package.</p>
          </div>
          <div className="dl-grid">
            {BROWSERS.map((b) => (
              <a key={b.id} className={`dl${b.id === 'chrome' ? ' featured' : ''}`} href={hrefFor(b.id)} data-dl={b.id}>
                <span className="mono" style={{ ['--c' as string]: b.color }}>
                  {shortName(b)[0]}
                </span>
                <strong>{b.name}</strong>
                <span>{b.note}</span>
                <em>{ctaFor(b.id)} →</em>
              </a>
            ))}
            <a className="dl" href={REPO} data-dl="source">
              <span className="mono" style={{ ['--c' as string]: '#24292f' }}>
                {'</>'}
              </span>
              <strong>Source code</strong>
              <span>Build it yourself, no dependencies</span>
              <em>View on GitHub →</em>
            </a>
          </div>
          <VisitorBrowserMarker />
          <div className="install-note">
            <InfoIcon />
            <p>
              <strong>Chrome, Firefox, Edge, Brave and Vivaldi</strong> install in one click from their stores, with automatic updates.{' '}
              <strong>Opera and Safari:</strong> download the ZIP and follow the <a href={`${REPO}/blob/main/DEPLOY.md`}>step-by-step install guide</a>.
            </p>
          </div>
        </div>
      </section>

      <section id="guides" className="alt-bg" aria-labelledby="guides-title">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Guides</span>
            <h2 id="guides-title">Learn how to get the most out of every image</h2>
            <p className="lead">Step-by-step guides for downloading, converting, cleaning and optimizing images.</p>
          </div>
          <GuideGrid guides={guides.slice(0, 6)} />
          <p className="center section-more">
            <Link className="btn" href="/guides/">
              See all guides
            </Link>
          </p>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-title">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">FAQ</span>
            <h2 id="faq-title">Frequently asked questions</h2>
          </div>
          <div className="faq">
            {FAQ.map((f, i) => (
              <details key={f.q} className="reveal" open={i === 0}>
                <summary>{f.q}</summary>
                <div dangerouslySetInnerHTML={{ __html: markdownToHtml(f.a) }} />
              </details>
            ))}
          </div>
          <p className="center section-more">
            More answers, including troubleshooting, in the <Link href="/help/">Help Center</Link>.
          </p>
        </div>
      </section>

      <section className="final" aria-labelledby="final-title">
        <div className="wrap">
          <div className="final-box reveal">
            <h2 id="final-title">Start collecting images in seconds</h2>
            <p>Free, private and open source. No sign-up, no limits.</p>
            <div className="cta-row">
              <a className="btn btn-white" href={hrefFor('chrome')} data-dl="chrome">
                {chromeButton}
              </a>
              <a className="btn btn-ghost" href="#download">
                Other browsers
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
