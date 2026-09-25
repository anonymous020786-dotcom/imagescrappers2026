// End-to-end smoke test: loads dist/chrome into Chromium, scans a fixture page
// through the real dashboard, and checks detection, filtering and ZIP export.
//
//   npm run build:chrome && node tests/e2e/extension.e2e.mjs
//
// Requires Playwright (npm i -D playwright, or a global install).
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = join(ROOT, 'dist', 'chrome');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const ICON = readFileSync(join(ROOT, 'src', 'icons', 'icon128.png'));
const ICON_SMALL = readFileSync(join(ROOT, 'src', 'icons', 'icon48.png'));
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const require = createRequire(import.meta.url);
  const globalRoot = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = require(join(globalRoot, 'playwright')));
}

if (!existsSync(join(EXT, 'manifest.json'))) {
  console.error('Build first: node scripts/build.mjs chrome');
  process.exit(1);
}

const BIG = Buffer.alloc(400 * 1024, 7);
let base = '';
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(`User-agent: *\nDisallow: /site/private/\nSitemap: ${base}/sitemap.xml\n`);
  }
  if (path === '/sitemap.xml') {
    res.writeHead(200, { 'content-type': 'application/xml' });
    return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/site/orphan.html</loc></url></urlset>`);
  }
  if (path.startsWith('/hotlink/')) {
    // Simulates CDN hotlink protection: only serves requests referred by this site.
    const ok = (req.headers.referer ?? '').startsWith(base);
    res.writeHead(ok ? 200 : 403, { 'content-type': 'image/png' });
    return res.end(ok ? ICON : '');
  }
  if (path.startsWith('/big/')) {
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(BIG);
  }
  if (path.startsWith('/img/')) {
    res.writeHead(200, { 'content-type': 'image/png' });
    if (path.includes('pixel')) return res.end(PIXEL);
    return res.end(/small|favicon/.test(path) ? ICON_SMALL : ICON);
  }
  const file = path === '/' ? 'page.html' : path.slice(1);
  // Never serve anything outside the fixtures folder.
  const full = resolve(FIXTURES, decodeURIComponent(file));
  if (!full.startsWith(FIXTURES + sep)) return res.writeHead(403).end();
  try {
    let body = readFileSync(full);
    if (file.endsWith('gallery.html')) body = Buffer.from(body.toString().replace('HOST', `127.0.0.1:${server.address().port}`));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
base = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  acceptDownloads: true,
});

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failures++;
    console.log(`✘ ${name}\n  ${err.message.split('\n').join('\n  ')}`);
  }
}

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.waitForLoadState('load');
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0].id, base);

  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extId}/dashboard/dashboard.html?tabId=${tabId}`);
  await dash.waitForFunction(() => document.querySelectorAll('#gallery .card').length > 0, null, { timeout: 15000 });
  await dash.waitForTimeout(500);

  const urls = await dash.$$eval('#gallery .card .url', (els) => els.map((e) => e.textContent));
  const has = (s) => urls.some((u) => u.includes(s));

  await check('detects <img>', () => assert.ok(has('/img/plain.png')));
  await check('picks highest srcset candidate', () => {
    assert.ok(has('/img/large.png'));
    assert.ok(!has('/img/small.png'));
  });
  await check('detects <picture> sources', () => assert.ok(has('/img/picture.png')));
  await check('detects lazy-load data-src', () => assert.ok(has('/img/lazy.png')));
  await check('detects CSS backgrounds', () => assert.ok(has('/img/bg.png')));
  await check('detects ::before content', () => assert.ok(has('/img/pseudo.png')));
  await check('exports inline SVG', () => assert.ok(urls.some((u) => u === 'inline svg')));
  await check('exports canvas', () => assert.ok(urls.some((u) => u === 'inline canvas')));
  await check('detects video poster', () => assert.ok(has('/img/poster.png')));
  await check('detects linked images', () => assert.ok(has('/img/linked.jpg')));
  await check('detects og:image and JSON-LD', () => assert.ok(has('/img/og.png') && has('/img/ld.png')));
  await check('detects favicon', () => assert.ok(has('/img/favicon.png')));
  await check('traverses Shadow DOM', () => assert.ok(has('/img/shadow.png')));
  await check('scans iframes', () => assert.ok(has('/img/iframe.png')));
  await check('hides 1x1 tracking pixel', () => assert.ok(!has('/img/pixel.png')));

  await check('min width filter', async () => {
    const before = await dash.$$eval('#gallery .card', (c) => c.length);
    await dash.fill('#fMinW', '100');
    await dash.uncheck('#fKeepUnknown');
    await dash.waitForTimeout(400);
    const after = await dash.$$eval('#gallery .card', (c) => c.length);
    assert.ok(after < before && after > 0, `before ${before}, after ${after}`);
    await dash.click('#resetFilters');
    await dash.waitForTimeout(200);
  });

  await check('text search filter', async () => {
    await dash.fill('#fText', 'shadow');
    await dash.waitForTimeout(400);
    const n = await dash.$$eval('#gallery .card', (c) => c.length);
    assert.equal(n, 1);
    await dash.fill('#fText', '');
    await dash.waitForTimeout(300);
  });

  await check('select all + analyze fills in file sizes', async () => {
    await dash.click('#selAll');
    await dash.click('#analyze');
    await dash.waitForFunction(() => [...document.querySelectorAll('#gallery .card .size')].some((e) => e.textContent.includes('KB')), null, { timeout: 15000 });
    const info = await dash.textContent('#selInfo');
    assert.match(info, /selected · [\d.]+ KB/);
  });

  await check('finds visual duplicates', async () => {
    await dash.click('#dupes');
    await dash.waitForFunction(() => document.querySelectorAll('#gallery .card .badge').length > 0, null, { timeout: 15000 });
  });

  await check('ZIP download contains the selected images', async () => {
    await dash.click('#downloadZip');
    await dash.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('ZIP saved'), null, { timeout: 20000 });
    const items = await worker.evaluate(() => new Promise((r) => chrome.downloads.search({ orderBy: ['-startTime'] }, r)));
    const zip = items.find((d) => d.filename.endsWith('.zip') || d.mime === 'application/zip');
    assert.ok(zip, `no zip download in ${JSON.stringify(items.map((d) => d.filename))}`);
  });

  await check('lightbox opens with metadata', async () => {
    await dash.dblclick('#gallery .card >> nth=0');
    await dash.waitForSelector('#lightbox:not(.hidden)');
    const meta = await dash.textContent('#lbMeta');
    assert.match(meta, /Dimensions/);
    await dash.keyboard.press('Escape');
  });

  await check('history saved', async () => {
    const h = await worker.evaluate(async () => (await chrome.storage.local.get('history')).history);
    assert.ok(h?.length >= 1 && h[0].count > 5);
  });


  // ------------------------------------------------------------ bulk & crawl
  const waitForLog = (p, text, timeout = 30000) =>
    p.waitForFunction((t) => document.getElementById('log').textContent.includes(t), text, { timeout });
  const statNum = async (p, id) => Number((await p.textContent(`#${id}`)).replace(/\D/g, ''));

  let crawlPage;
  await check('crawler: follows links, pagination and sitemap, obeys robots.txt', async () => {
    crawlPage = await context.newPage();
    await crawlPage.goto(`chrome-extension://${extId}/bulk/bulk.html?crawl=${encodeURIComponent(`${base}/site/index.html`)}`);
    await crawlPage.fill('#maxDepth', '1');
    await crawlPage.check('#useSitemap');
    await crawlPage.fill('#delay', '0');
    await crawlPage.click('#start');
    await waitForLog(crawlPage, 'Finished');
    const log = await crawlPage.textContent('#log');
    assert.match(log, /robots\.txt disallows .*private\/secret\.html/);
    for (const page of ['gallery.html', 'page1.html', 'page2.html', 'page3.html', 'orphan.html']) {
      assert.ok(log.includes(`/site/${page}`), `did not crawl ${page}`);
    }
    assert.ok(!log.includes('external.invalid'), 'left the website');
    assert.ok((await statNum(crawlPage, 'sSkipped')) >= 1);
  });

  let imported;
  await check('crawler results open in the dashboard with every image kind', async () => {
    const [p] = await Promise.all([context.waitForEvent('page'), crawlPage.click('#openDashboard')]);
    imported = p;
    await imported.waitForSelector('#gallery .card');
    const urls = await imported.$$eval('#gallery .card .url', (els) => els.map((e) => e.textContent));
    const has = (x) => urls.some((u) => u.includes(x));
    for (const x of ['home.png', 'gallery-bg.png', 'gallery-lazy.png', 'g-large.png', 'protected.png', 'from-script.jpg', 'p1.png', 'p2.png', 'p3.png', 'orphan.png']) {
      assert.ok(has(x), `missing ${x}`);
    }
    assert.ok(!has('g-small.png'), 'took the small srcset candidate');
    assert.ok(!has('secret.png'), 'scraped a robots-disallowed page');
  });

  await check('hotlink-protected image loads via the Referer rule', async () => {
    await imported.fill('#fText', 'protected');
    await imported.waitForTimeout(400);
    await imported.click('#selAll');
    await imported.click('#analyze');
    await imported.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Analy'), null, { timeout: 15000 });
    const size = await imported.textContent('#gallery .card .size');
    assert.match(size, /\d+(\.\d+)? (B|KB)/, `size was "${size}"`);
  });

  await check('skip previously downloaded images', async () => {
    await worker.evaluate(async () => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...settings, skipDownloaded: true } });
    });
    await imported.waitForTimeout(300);
    await imported.click('#downloadZip');
    await imported.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('ZIP saved'), null, { timeout: 20000 });
    await imported.click('#downloadZip');
    await imported.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('downloaded before'), null, { timeout: 20000 });
  });

  await check('ZIP splits into parts past the size limit', async () => {
    await worker.evaluate(async () => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...settings, skipDownloaded: false, zipPartSizeMB: 1 } });
    });
    await imported.fill('#fText', '');
    await imported.waitForTimeout(300);
    await imported.click('#importBtn');
    await imported.fill('#importText', Array.from({ length: 6 }, (_, i) => `${base}/big/${i}.png`).join('\n'));
    await imported.click('#importGo');
    await imported.waitForFunction(() => document.querySelectorAll('#gallery .card').length === 6);
    const before = (await worker.evaluate(() => new Promise((r) => chrome.downloads.search({}, r)))).length;
    await imported.click('#selAll');
    await imported.click('#downloadZip');
    await imported.waitForFunction(() => /ZIP saved with 6 images \(\d parts/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 30000 })
      .catch(async (err) => {
        throw new Error(`${err.message}\nLast toast: ${await imported.textContent('.toast').catch(() => 'none')}; status: ${await imported.textContent('#statusText')}`);
      });
    // Playwright renames saved files, so count the new downloads instead of matching names.
    const parts = Number(/\((\d+) parts/.exec(await imported.textContent('.toast'))[1]);
    assert.ok(parts >= 3, `only ${parts} parts`);
    const after = (await worker.evaluate(() => new Promise((r) => chrome.downloads.search({}, r)))).length;
    assert.equal(after - before, parts);
  });

  await check('full-render mode finds images added by JavaScript', async () => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/bulk/bulk.html?mode=render&urls=${encodeURIComponent(`${base}/site/js.html`)}&autostart=1`);
    await waitForLog(p, 'Finished', 45000);
    assert.match(await p.textContent('#log'), /js\.html: [1-9]\d* images/);
    assert.ok(await p.$('#thumbs img[src$="js-rendered.png"]'), 'JS-added image not found');
  });

  await check('decodes non-UTF-8 pages (Windows-1251)', async () => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/bulk/bulk.html?mode=fast&urls=${encodeURIComponent(`${base}/site/cp1251.html`)}&autostart=1`);
    await waitForLog(p, 'Finished');
    assert.match(await p.textContent('#log'), /\[windows-1251\]/);
  });

  await check('URL pattern generator', async () => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/bulk/bulk.html`);
    await p.click('[data-tab="generate"]');
    await p.fill('#pattern', `${base}/img/gen[01-25].{png,jpg}`);
    assert.match(await p.textContent('#patternInfo'), /^50 URLs/);
    await p.click('#start');
    assert.equal(await statNum(p, 'sImages'), 50);
  });

  await check('popup renders counts', async () => {
    await page.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    await popup.waitForTimeout(1500);
    const text = await popup.textContent('#count');
    assert.ok(text !== '–', `count was ${text}`);
  });

  await check('options page saves settings', async () => {
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extId}/options/options.html`);
    await opts.fill('input[name="filenameTemplate"]', '{domain}_{index:4}');
    await opts.waitForTimeout(700);
    const s = await worker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
    assert.equal(s.filenameTemplate, '{domain}_{index:4}');
    assert.match(await opts.textContent('#preview'), /cdn\.example\.com_0007\.jpg$/);
  });
} finally {
  await context.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll end-to-end checks passed');
process.exit(failures ? 1 : 0);
