// Generates Chrome Web Store listing images from the real extension:
//   store/chrome/screenshot-{1..5}.png  1280×800 (dashboard, analysis, preview, crawler, popup)
//   store/chrome/promo-small.png        440×280  small promo tile (required)
//   store/chrome/promo-marquee.png      1400×560 marquee (optional)
//
//   npm run build:chrome && npm run store:assets
//
// It serves a demo photo site with generated landscape images, loads dist/chrome into Chromium with
// Playwright and screenshots the real UI, so the listing always matches what users get.
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'dist', 'chrome');
const OUT = join(ROOT, 'store', 'chrome');
const ICON = readFileSync(join(ROOT, 'src', 'icons', 'icon128.png')).toString('base64');
const W = 1280;
const H = 800;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')));
}
if (!existsSync(join(EXT, 'manifest.json'))) {
  console.error('Build first: npm run build:chrome');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ demo photos (deterministic SVG scenes)
const PALETTES = [
  ['#ff9a8b', '#ff6a88', '#2d1b4e', '#46295a', '#5c3a6e'],
  ['#a1c4fd', '#c2e9fb', '#2f4858', '#33658a', '#86bbd8'],
  ['#fddb92', '#d1fdff', '#3d5a40', '#5b8c5a', '#8fbf7f'],
  ['#f6d365', '#fda085', '#6b2d5c', '#8f3b76', '#c75d8f'],
  ['#89f7fe', '#66a6ff', '#1b3a4b', '#27546b', '#3f7c99'],
  ['#fbc2eb', '#a6c1ee', '#403a60', '#5c5487', '#8c83b8'],
  ['#ffecd2', '#fcb69f', '#5a3e36', '#7d5a4f', '#a6806f'],
  ['#e0c3fc', '#8ec5fc', '#22313f', '#34495e', '#5d7a96'],
];
const SIZES = [[1600, 1067], [1200, 800], [900, 1200], [1920, 1080], [1080, 1080], [1400, 933]];
const NAMES = ['alpine-dawn', 'fjord-mist', 'meadow-light', 'canyon-dusk', 'glacier-bay', 'lavender-ridge',
  'desert-glow', 'northern-pass', 'summit-view', 'valley-haze', 'coastal-cliffs', 'pine-lake',
  'red-rocks', 'blue-hour', 'misty-peaks', 'golden-field', 'ice-fields', 'twilight-dunes'];

function rand(seed) {
  let x = seed * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
}

function sceneSvg(i) {
  const [w, h] = SIZES[i % SIZES.length];
  const [s1, s2, m1, m2, m3] = PALETTES[i % PALETTES.length];
  const r = rand(i + 7);
  const ridge = (base, amp, color) => {
    const pts = [`0,${h}`];
    for (let x = 0; x <= w; x += w / 8) pts.push(`${Math.round(x)},${Math.round(h * base - r() * h * amp)}`);
    pts.push(`${w},${h}`);
    return `<polygon points="${pts.join(' ')}" fill="${color}"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s1}"/><stop offset="1" stop-color="${s2}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
    <circle cx="${w * (0.2 + r() * 0.6)}" cy="${h * (0.2 + r() * 0.15)}" r="${Math.min(w, h) * 0.09}" fill="#fff" opacity="0.85"/>
    ${ridge(0.62, 0.22, m3)}${ridge(0.75, 0.18, m2)}${ridge(0.9, 0.12, m1)}</svg>`;
}

const photos = new Map(); // name → PNG buffer, rendered once below
const photoName = (i) => `${NAMES[i]}.png`;

// ------------------------------------------------------------------ demo site
const layout = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta property="og:image" content="/photos/${photoName(0)}">
<style>
  body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f6f7fb;color:#1f2430}
  header{height:200px;background:url(/photos/${photoName(3)}) center/cover;display:flex;align-items:flex-end;padding:24px 40px;color:#fff;text-shadow:0 2px 8px #0008}
  header h1{margin:0;font-size:34px} nav{padding:12px 40px;background:#fff;border-bottom:1px solid #e5e7ef}
  nav a{margin-right:18px;color:#3b5bdb;text-decoration:none;font-weight:600}
  main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px 40px}
  figure{margin:0;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px #0002}
  figure img{width:100%;height:150px;object-fit:cover;display:block} figcaption{padding:8px 12px;font-size:13px;color:#555}
</style></head><body><header><h1>${title}</h1></header>
<nav><a href="/">Home</a><a href="/site/mountains.html">Mountains</a><a href="/site/coast.html">Coast</a><a href="/site/desert.html">Desert</a></nav>
<main>${body}</main></body></html>`;

const figures = (from, to) => Array.from({ length: to - from }, (_, k) => {
  const i = from + k;
  const cap = NAMES[i].replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const img = i % 3 === 1
    ? `<img loading="lazy" data-src="/photos/${photoName(i)}" src="/photos/${photoName(i)}" alt="${cap}">`
    : `<img srcset="/photos/${photoName(i)} 2x" src="/photos/${photoName(i)}" alt="${cap}">`;
  return `<figure>${img}<figcaption>${cap}</figcaption></figure>`;
}).join('');

const PAGES = {
  '/': ['Northern Light Photography', figures(0, 12)],
  '/site/mountains.html': ['Mountains', figures(6, 14)],
  '/site/coast.html': ['Coast', figures(10, 16)],
  '/site/desert.html': ['Desert', figures(12, 18)],
};

const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (PAGES[path]) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(layout(...PAGES[path]));
  }
  const name = path.replace('/photos/', '');
  if (photos.has(name)) {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
    return res.end(photos.get(name));
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// Shown in the UI, so use a reserved example domain mapped to the local server instead of 127.0.0.1:port.
const HOST = 'gallery.example.com';
const base = `http://${HOST}`;

const context = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  viewport: { width: W, height: H },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP ${HOST}:80 127.0.0.1:${server.address().port}`,
  ],
});

async function composite(file, html, width = W, height = H) {
  const p = await context.newPage();
  await p.setViewportSize({ width, height });
  await p.setContent(html, { waitUntil: 'load' });
  await p.screenshot({ path: join(OUT, file) });
  await p.close();
  console.log(`✔ store/chrome/${file}`);
}

try {
  // Render the demo photos to real PNGs.
  const painter = await context.newPage();
  for (let i = 0; i < NAMES.length; i++) {
    const [w, h] = SIZES[i % SIZES.length];
    await painter.setViewportSize({ width: w, height: h });
    await painter.setContent(`<body style="margin:0">${sceneSvg(i)}</body>`);
    photos.set(photoName(i), await painter.screenshot({ type: 'png' }));
  }
  await painter.close();

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;

  const site = await context.newPage();
  await site.goto(`${base}/`);
  await site.waitForLoadState('load');
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0].id, base);

  // 1. Dashboard gallery
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extId}/dashboard/dashboard.html?tabId=${tabId}`);
  await dash.waitForFunction(() => document.querySelectorAll('#gallery .card').length >= 12, null, { timeout: 20000 });
  await dash.waitForTimeout(1500);
  await dash.screenshot({ path: join(OUT, 'screenshot-1.png') });
  console.log('✔ store/chrome/screenshot-1.png');

  // 2. Selection with sizes, and a filter applied
  await dash.click('#selAll');
  await dash.click('#analyze');
  await dash.waitForFunction(() => [...document.querySelectorAll('#gallery .card .size')].some((e) => /KB|MB/.test(e.textContent)), null, { timeout: 20000 });
  await dash.fill('#fMinW', '1000');
  await dash.waitForTimeout(1200);
  await dash.screenshot({ path: join(OUT, 'screenshot-2.png') });
  console.log('✔ store/chrome/screenshot-2.png');
  await dash.click('#resetFilters');
  await dash.waitForTimeout(500);

  // 3. Lightbox preview with metadata
  await dash.dblclick('#gallery .card >> nth=3');
  await dash.waitForSelector('#lightbox:not(.hidden)');
  await dash.waitForTimeout(1000);
  await dash.screenshot({ path: join(OUT, 'screenshot-3.png') });
  console.log('✔ store/chrome/screenshot-3.png');

  // 4. Site crawler
  const crawl = await context.newPage();
  await crawl.goto(`chrome-extension://${extId}/bulk/bulk.html?crawl=${encodeURIComponent(`${base}/`)}`);
  await crawl.fill('#maxDepth', '1');
  await crawl.fill('#delay', '0');
  await crawl.click('#start');
  await crawl.waitForFunction(() => /done|finished|complete/i.test(document.querySelector('#log')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {});
  await crawl.waitForTimeout(1500);
  await crawl.evaluate(() => document.querySelector('#start')?.scrollIntoView({ block: 'start' }));
  await crawl.evaluate(() => window.scrollBy(0, -24));
  await crawl.waitForTimeout(300);
  await crawl.screenshot({ path: join(OUT, 'screenshot-4.png') });
  console.log('✔ store/chrome/screenshot-4.png');

  // 5. Popup over the page it scanned
  await site.bringToFront();
  const pageShot = (await site.screenshot()).toString('base64');
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 384, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
  await popup.waitForTimeout(2000);
  const popupShot = (await popup.locator('body').screenshot()).toString('base64');
  await composite('screenshot-5.png', `<body style="margin:0;position:relative;width:${W}px;height:${H}px;overflow:hidden">
    <img src="data:image/png;base64,${pageShot}" style="display:block;filter:brightness(.8)">
    <img src="data:image/png;base64,${popupShot}" style="position:absolute;top:16px;right:24px;border-radius:10px;box-shadow:0 12px 40px #0008"></body>`);

  // Promo images
  const promo = (width, height, size, tagline) => `<body style="margin:0;width:${width}px;height:${height}px;display:flex;align-items:center;
    gap:${size / 2}px;padding:0 ${size / 1.4}px;box-sizing:border-box;font-family:system-ui,sans-serif;color:#fff;
    background:linear-gradient(135deg,#3b5bdb,#7048e8 55%,#c2255c)">
    <img src="data:image/png;base64,${ICON}" style="width:${size * 1.5}px;height:${size * 1.5}px;filter:drop-shadow(0 6px 16px #0006)">
    <div><div style="font-size:${size * 0.5}px;font-weight:800;letter-spacing:-.5px;white-space:nowrap">Image Scraper Pro</div>
    <div style="font-size:${size * 0.26}px;opacity:.92;margin-top:${size / 8}px">${tagline}</div></div></body>`;
  await composite('promo-small.png', promo(440, 280, 52, 'Download every image on any page'), 440, 280);
  await composite(
    'promo-marquee.png',
    promo(1400, 560, 150, 'Find, filter and bulk-download every image on any page'),
    1400,
    560,
  );
} finally {
  await context.close();
  server.close();
}
