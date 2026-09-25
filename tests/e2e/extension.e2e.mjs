// End-to-end smoke test: loads dist/chrome into Chromium, scans a fixture page
// through the real dashboard, and checks detection, filtering and ZIP export.
//
//   npm run build:chrome && node tests/e2e/extension.e2e.mjs
//
// Requires Playwright (npm i -D playwright, or a global install).
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path.startsWith('/img/')) {
    res.writeHead(200, { 'content-type': 'image/png' });
    if (path.includes('pixel')) return res.end(PIXEL);
    return res.end(/small|favicon/.test(path) ? ICON_SMALL : ICON);
  }
  const file = path === '/' ? 'page.html' : path.slice(1);
  try {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(readFileSync(join(FIXTURES, file)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

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
