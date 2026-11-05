// End-to-end smoke test: loads dist/chrome into Chromium, scans a fixture page
// through the real dashboard, and checks detection, filtering and ZIP export.
//
// dist/chrome asks for access to all sites at runtime (optional_host_permissions). The main suite runs a
// copy in the state after the user allowed it; a second suite checks the shipped, limited state.
//
//   npm run build:chrome && node tests/e2e/extension.e2e.mjs
//
// Requires Playwright (npm i -D playwright, or a global install).
import http from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// The same build with access to all sites already granted (what "Allow access to all sites" does).
const EXT_GRANTED = mkdtempSync(join(tmpdir(), 'image-scraper-granted-'));
cpSync(EXT, EXT_GRANTED, { recursive: true });
{
  const manifest = JSON.parse(readFileSync(join(EXT_GRANTED, 'manifest.json'), 'utf8'));
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
  writeFileSync(join(EXT_GRANTED, 'manifest.json'), JSON.stringify(manifest));
}

const BIG = Buffer.alloc(400 * 1024, 7);

// A real PNG drawn by `pixel(x, y)` -> [r, g, b].
function makePng(width, height, pixel) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
    return Buffer.concat([head, body, tail]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) Buffer.from(pixel(x, y)).copy(raw, y * (width * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A real animated GIF: each frame fills 4×4 with one palette colour. A clear code before every pixel keeps
// the LZW codes 3 bits wide, so no compressor is needed.
function makeGif(frames) {
  const CLEAR = 4;
  const END = 5;
  const lzw = (colour) => {
    const codes = [...Array.from({ length: 16 }, () => [CLEAR, colour]).flat(), END];
    const out = [];
    let bits = 0;
    let filled = 0;
    for (const code of codes) {
      bits |= code << filled;
      filled += 3;
      while (filled >= 8) {
        out.push(bits & 255);
        bits >>= 8;
        filled -= 8;
      }
    }
    if (filled) out.push(bits & 255);
    return out;
  };
  const bytes = [...Buffer.from('GIF89a'), 4, 0, 4, 0, 0x81, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0];
  for (const colour of frames) {
    const data = lzw(colour);
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0, 2, data.length, ...data, 0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

const ramp = (r, g, b) => (x) => [r && (x * 255) / 399, g && (x * 255) / 399, b && (x * 255) / 399].map(Math.round);
const MEDIA = {
  '/media/red.png': ['image/png', makePng(400, 300, (x) => [200 + (x % 55), 20, 20])],
  '/media/red-copy.png': ['image/png', makePng(200, 150, (x) => [200 + ((x * 2) % 55), 20, 20])],
  '/media/blue.png': ['image/png', makePng(400, 300, (x, y) => (Math.floor(x / 40) % 2 === Math.floor(y / 30) % 2 ? [20, 40, 220] : [10, 20, 160]))],
  '/media/open.png': ['image/png', makePng(128, 128, (x, y) => ramp(0, 1, 0)(x * 3 + y))],
  '/media/article.png': ['image/png', makePng(128, 128, (x, y) => ramp(1, 1, 0)(x + y * 3))],
  '/media/anim.gif': ['image/gif', makeGif([1, 2])],
};
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
  if (MEDIA[path]) {
    res.writeHead(200, { 'content-type': MEDIA[path][0] });
    return res.end(MEDIA[path][1]);
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

const launch = (ext) => chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  acceptDownloads: true,
});
const context = await launch(EXT_GRANTED);

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
  await check('detects script-loaded images via resource timing', () => assert.ok(has('/img/network.png')));
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

  await check('resize shrinks JPEG/PNG/WebP, keeps GIFs, never upscales', async () => {
    const r = await dash.evaluate(async () => {
      const { convert, decode } = await import('/lib/imaging.js');
      const c = new OffscreenCanvas(400, 200);
      c.getContext('2d').fillRect(0, 0, 400, 200);
      const png = await c.convertToBlob({ type: 'image/png' });
      const dims = async (b) => {
        const d = await decode(b);
        URL.revokeObjectURL(d.url);
        return `${b.type} ${d.width}x${d.height}`;
      };
      const gif = new Blob([new Uint8Array([71, 73, 70, 56, 57, 97])], { type: 'image/gif' });
      return {
        shrunk: await dims(await convert(png, 'original', 0.9, { maxWidth: 100 })),
        boxed: await dims(await convert(png, 'jpeg', 0.9, { maxWidth: 300, maxHeight: 50 })),
        same: (await convert(png, 'original', 0.9, { maxWidth: 1000 })) === png,
        gif: (await convert(gif, 'original', 0.9, { maxWidth: 10 })) === gif,
      };
    });
    assert.equal(r.shrunk, 'image/png 100x50');
    assert.equal(r.boxed, 'image/jpeg 100x50');
    assert.ok(r.same, 'upscaled or re-encoded an image already inside the limit');
    assert.ok(r.gif, 'GIF was re-encoded');
  });

  await check('image audit lists findings for the page', async () => {
    await dash.click('#auditBtn');
    await dash.waitForSelector('#auditDialog[open]');
    assert.match(await dash.textContent('#auditSummary'), /images have findings/);
    // The fixture's responsive <img> has no width/height attributes.
    assert.match(await dash.textContent('#auditRules'), /No width\/height attributes/);
    // The fixture declares og:image and a JSON-LD image, so the page-level SEO checks find both.
    assert.doesNotMatch(await dash.textContent('#auditRules'), /No social sharing image|No image in structured data/);
    assert.equal(await dash.isDisabled('#auditSitemap'), false);
    assert.ok((await dash.$$('#auditList .audit-item')).length > 0);
    assert.equal(await dash.isDisabled('#auditCsv'), false);
    await dash.keyboard.press('Escape');
    await dash.waitForFunction(() => !document.getElementById('auditDialog').open);
  });

  await check('reads and removes photo metadata in the browser', async () => {
    const r = await dash.evaluate(async () => {
      const { removeMetadata, decode } = await import('/lib/imaging.js');
      const { readMetadata } = await import('/lib/exif.js');
      const c = new OffscreenCanvas(40, 20);
      c.getContext('2d').fillRect(0, 0, 40, 20);
      const jpg = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer());
      // Minimal little-endian TIFF: IFD0 with Make = "Cam1".
      const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x0f, 0x01, 2, 0, 5, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0, 67, 97, 109, 49, 0];
      const payload = [...'Exif\0\0'].map((ch) => ch.charCodeAt(0)).concat(tiff);
      const len = payload.length + 2;
      const withExif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload, ...jpg.subarray(2)]);
      const blob = new Blob([withExif], { type: 'image/jpeg' });
      const before = readMetadata(withExif);
      const { blob: clean, removed } = await removeMetadata(blob);
      const after = readMetadata(await clean.arrayBuffer());
      const d = await decode(clean);
      URL.revokeObjectURL(d.url);
      return { make: before.exif?.make, removed, after: after.exif, size: `${d.width}x${d.height}` };
    });
    assert.equal(r.make, 'Cam1');
    assert.ok(r.removed > 0);
    assert.equal(r.after, null);
    assert.equal(r.size, '40x20');
  });

  await check('editor rotates, flips and crops at full resolution', async () => {
    const r = await dash.evaluate(async () => {
      const { renderEdited, decode } = await import('/lib/imaging.js');
      const c = new OffscreenCanvas(40, 20);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#f00';
      ctx.fillRect(0, 0, 20, 20);
      ctx.fillStyle = '#00f';
      ctx.fillRect(20, 0, 20, 20);
      const src = await c.convertToBlob({ type: 'image/png' });
      const pixels = async (blob, points) => {
        const d = await decode(blob);
        const k = new OffscreenCanvas(d.width, d.height);
        const kx = k.getContext('2d');
        kx.drawImage(d.el, 0, 0);
        URL.revokeObjectURL(d.url);
        return { size: `${d.width}x${d.height}`, px: points.map(([x, y]) => (kx.getImageData(x, y, 1, 1).data[0] > 128 ? 'red' : 'blue')) };
      };
      return {
        // A clockwise turn puts the left (red) half on top.
        rotated: await pixels(await renderEdited(src, { rotation: 90 }, 'image/png'), [[10, 5], [10, 35]]),
        flipped: await pixels(await renderEdited(src, { flipH: true }, 'image/png'), [[5, 10], [35, 10]]),
        cropped: await pixels(await renderEdited(src, { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } }, 'image/png'), [[5, 5]]),
        resized: (await pixels(await renderEdited(src, { maxWidth: 10 }, 'image/png'), [])).size,
      };
    });
    assert.deepEqual(r.rotated, { size: '20x40', px: ['red', 'blue'] });
    assert.deepEqual(r.flipped, { size: '40x20', px: ['blue', 'red'] });
    assert.deepEqual(r.cropped, { size: '20x20', px: ['blue'] });
    assert.equal(r.resized, '10x5');
  });

  await check('lightbox opens the editor; rotating swaps the output size', async () => {
    await dash.evaluate(async () => {
      const { openEditor } = await import('/dashboard/editor.js');
      const c = new OffscreenCanvas(60, 30);
      c.getContext('2d').fillRect(0, 0, 60, 30);
      await openEditor(await c.convertToBlob({ type: 'image/png' }), { save() {}, copy() {}, toast() {} });
    });
    await dash.waitForSelector('#editDialog[open]');
    assert.equal(await dash.textContent('#edInfo'), 'Output 60 × 30 px');
    await dash.click('#edRotR');
    assert.equal(await dash.textContent('#edInfo'), 'Output 30 × 60 px');
    await dash.fill('#edWidth', '15');
    assert.equal(await dash.textContent('#edInfo'), 'Output 15 × 30 px');
    await dash.click('#edClose');
    // And from a real result: the lightbox's Edit button fetches the image and opens it.
    await dash.dblclick('#gallery .card >> nth=0');
    await dash.click('#lbEdit');
    await dash.waitForSelector('#editDialog[open]');
    assert.match(await dash.textContent('#edInfo'), /^Output \d+ × \d+ px$/);
    await dash.keyboard.press('Escape');
    await dash.waitForFunction(() => !document.getElementById('editDialog').open);
    await dash.keyboard.press('Escape');
  });

  // Waits for a finished download of this MIME type (Playwright stores downloads under random names).
  const latestDownload = (mime, since) => worker.evaluate(async ([src, after]) => {
    for (let i = 0; i < 50; i++) {
      const items = await new Promise((r) => chrome.downloads.search({ orderBy: ['-startTime'], ...(after ? { startedAfter: after } : {}) }, r));
      const hit = items.find((d) => d.mime === src && d.state === 'complete');
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 200));
    }
    const items = await new Promise((r) => chrome.downloads.search({ orderBy: ['-startTime'], limit: 5 }, r));
    return { missing: items.map((d) => `${d.mime} ${d.state} ${d.error ?? ''}`) };
  }, [mime, since]);
  const now = () => new Date(Date.now() - 50).toISOString();

  await check('PDF export: one page per image, JPEGs embedded as-is', async () => {
    const r = await dash.evaluate(async () => {
      const { pdfImage } = await import('/lib/imaging.js');
      const { buildPdf } = await import('/lib/pdf.js');
      const c = new OffscreenCanvas(30, 20);
      c.getContext('2d').fillRect(0, 0, 30, 20);
      const png = await c.convertToBlob({ type: 'image/png' });
      const jpg = await c.convertToBlob({ type: 'image/jpeg' });
      const a = await pdfImage(png);
      const b = await pdfImage(jpg);
      const pdf = buildPdf([a, b], { pageSize: 'a4' });
      return { a: [a.width, a.height, a.components], same: b.bytes.length === jpg.size, size: pdf.size };
    });
    assert.deepEqual(r.a, [30, 20, 3]);
    assert.ok(r.same, 'JPEG was re-encoded');
    assert.ok(r.size > 0);
    // Through the UI: Export ▸ PDF ▸ Create PDF saves a .pdf file.
    await dash.click('#selAll');
    await dash.click('#exportBtn');
    await dash.click('[data-export="pdf"]');
    await dash.waitForSelector('#pdfDialog[open]');
    assert.match(await dash.textContent('#pdfInfo'), /selected images?/);
    await dash.selectOption('#pdfPage', 'a4');
    await dash.click('#pdfGo');
    await dash.waitForFunction(() => /PDF saved with \d+ pages/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 30000 });
    const pdf = await latestDownload('application/pdf');
    assert.ok(!pdf.missing, `no PDF download: ${JSON.stringify(pdf.missing)}`);
    const file = readFileSync(pdf.filename).toString('latin1');
    const selected = await dash.$$eval('#gallery .card.selected', (els) => els.length);
    assert.ok(file.startsWith('%PDF-1.4') && file.trimEnd().endsWith('%%EOF'));
    const pages = Number(file.match(/\/Count (\d+)/)[1]);
    assert.ok(pages >= selected - 4 && pages <= selected, `${pages} pages for ${selected} images`); // inline SVG/canvas may fail
  });

  await check('contact sheet export saves a PNG grid', async () => {
    await dash.click('#exportBtn');
    await dash.click('[data-export="sheet"]');
    await dash.waitForFunction(() => /Contact sheet saved/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 30000 });
    const sheet = await latestDownload('image/png');
    assert.ok(!sheet.missing, `no contact sheet download: ${JSON.stringify(sheet.missing)}`);
    const png = readFileSync(sheet.filename);
    assert.equal(png.readUInt32BE(16), 24 * 2 + 5 * 220 + 4 * 12); // IHDR width: 5 columns
  });

  await check('colour palette of an image', async () => {
    await dash.dblclick('#gallery .card >> nth=0');
    await dash.click('#lbColours');
    await dash.waitForSelector('#lbPalette .swatch-btn');
    const hexes = await dash.$$eval('#lbPalette .swatch-btn', (els) => els.map((e) => e.firstChild.textContent));
    assert.ok(hexes.length >= 2 && hexes.every((h) => /^#[0-9a-f]{6}$/.test(h)), hexes.join(','));
    await dash.keyboard.press('Escape');
  });

  await check('collections: save, reopen, remove', async () => {
    await dash.click('#selNone');
    await dash.click('#gallery .card >> nth=0');
    await dash.click('#gallery .card >> nth=1');
    await dash.click('#saveBtn');
    await dash.click('#saveMenu >> text=+ New collection…');
    await dash.fill('#nameInput', 'Favourites');
    await dash.click('#nameOk');
    await dash.waitForFunction(() => /Saved 2 images to "Favourites"/.test(document.querySelector('.toast')?.textContent ?? ''));
    // Saving the same images again adds nothing.
    await dash.click('#saveBtn');
    await dash.click('#saveMenu >> text=Favourites (2)');
    await dash.waitForFunction(() => /Nothing new to save/.test(document.querySelector('.toast')?.textContent ?? ''));
    await dash.click('#collectionsBtn');
    await dash.click('#collectionsList .hist >> nth=0');
    await dash.waitForFunction(() => document.querySelectorAll('#gallery .card').length === 2);
    assert.match(await dash.textContent('#sourceInfo'), /Collection: Favourites · 2 images/);
    await dash.click('#gallery .card >> nth=0');
    await dash.click('#removeSel');
    await dash.waitForFunction(() => /from the collection/.test(document.querySelector('.toast')?.textContent ?? ''));
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('collections')).collections);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].images.length, 1);
  });

  await check('history saved', async () => {
    const h = await worker.evaluate(async () => (await chrome.storage.local.get('history')).history);
    assert.ok(h?.length >= 1 && h[0].count > 5);
  });


  // --------------------------------------------------- rights, prepare and tools
  const XMP = '<rdf:Description photoshop:Credit="Credit Agency"><dc:rights><rdf:Alt><rdf:li>© 2026 Bo Chen</rdf:li></rdf:Alt></dc:rights></rdf:Description>';
  MEDIA['/media/credit.jpg'] = ['image/jpeg', Buffer.from(await dash.evaluate(async (xmp) => {
    const c = new OffscreenCanvas(120, 90);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#208040';
    ctx.fillRect(0, 0, 120, 90);
    ctx.fillStyle = '#fff';
    ctx.fillRect(60, 0, 60, 45);
    const jpg = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer());
    const body = new TextEncoder().encode(`http://ns.adobe.com/xap/1.0/\0${xmp}`);
    return [0xff, 0xd8, 0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body, ...jpg.subarray(2)];
  }, XMP))];

  const rightsPage = await context.newPage();
  await rightsPage.goto(`${base}/rights.html`);
  await rightsPage.waitForLoadState('load');
  const rightsTab = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${base}/rights.html`);
  const dash2 = await context.newPage();
  await dash2.goto(`chrome-extension://${extId}/dashboard/dashboard.html?tabId=${rightsTab}`);
  await dash2.waitForFunction(() => document.querySelectorAll('#gallery .card').length >= 7, null, { timeout: 15000 });
  await dash2.click('#resetFilters');
  const cards = () => dash2.$$eval('#gallery .card .url', (els) => els.map((e) => e.textContent.split('/').pop()).sort());
  const toasted = (re) => dash2.waitForFunction((src) => new RegExp(src).test(document.querySelector('.toast')?.textContent ?? ''), re.source, { timeout: 20000 });
  const openCard = async (name) => {
    await dash2.dblclick(`#gallery .card:has(.url:text-matches("${name}\$"))`);
    await dash2.waitForSelector('#lightbox:not(.hidden)');
  };
  const settingsNow = () => worker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);

  await check('credit and licence come from the image, not from the article around it', async () => {
    await dash2.selectOption('#fRights', 'open');
    await dash2.waitForFunction(() => document.querySelectorAll('#gallery .card').length === 1);
    assert.deepEqual(await cards(), ['open.png']);
    assert.equal(await dash2.textContent('#gallery .card .rights'), 'CC');
    await dash2.selectOption('#fRights', 'known');
    await dash2.waitForTimeout(200);
    assert.ok(!(await cards()).includes('article.png'), 'used the article author as the image creator');
    await openCard('open.png').catch(async () => { await dash2.selectOption('#fRights', 'open'); await openCard('open.png'); });
    const meta = await dash2.textContent('#lbMeta');
    assert.match(meta, /Open Agency/);
    assert.match(meta, /Ana Silva/);
    await dash2.keyboard.press('Escape');
  });

  await check('Analyze reads credit from the file and enables colour filters', async () => {
    await dash2.selectOption('#fRights', 'any');
    await dash2.click('#analyze');
    await toasted(/Analy/);
    await dash2.selectOption('#fRights', 'known');
    await dash2.waitForFunction(() => document.querySelectorAll('#gallery .card').length === 2);
    assert.deepEqual(await cards(), ['credit.jpg', 'open.png']);
    await openCard('credit.jpg');
    const meta = await dash2.textContent('#lbMeta');
    assert.match(meta, /Credit Agency/);
    assert.match(meta, /© 2026 Bo Chen/);
    await dash2.keyboard.press('Escape');
    await dash2.selectOption('#fRights', 'any');
    await dash2.click('#fColors .chip:has-text("Red")');
    await dash2.waitForFunction(() => document.querySelectorAll('#gallery .card').length < 4);
    assert.deepEqual(await cards(), ['red-copy.png', 'red.png']);
    await dash2.click('#resetFilters');
    await dash2.waitForFunction(() => document.querySelectorAll('#gallery .card').length >= 7);
  });

  await check('Find similar ranks lookalikes first and can be cleared', async () => {
    await openCard('red.png');
    await dash2.click('#lbSimilar');
    await dash2.waitForSelector('#similarClear:not(.hidden)', { timeout: 15000 });
    const first = await dash2.$$eval('#gallery .card .url', (els) => els.slice(0, 2).map((e) => e.textContent.split('/').pop()));
    assert.deepEqual(first.sort(), ['red-copy.png', 'red.png']);
    assert.ok((await cards()).length < 7, 'unrelated images were not left out');
    await dash2.click('#similarClear');
    await dash2.waitForFunction(() => document.querySelectorAll('#gallery .card').length >= 7);
  });

  await check('Keep best selects the largest copy of duplicates', async () => {
    assert.equal(await dash2.isVisible('#keepBest'), false);
    await dash2.click('#dupes');
    await dash2.waitForSelector('#keepBest:not(.hidden)', { timeout: 15000 });
    await dash2.click('#gallery .card:has(.url:text-matches("red-copy.png$"))');
    await dash2.click('#keepBest');
    await toasted(/best copy in \d+ group/);
    const selected = await dash2.$$eval('#gallery .card.selected .url', (els) => els.map((e) => e.textContent.split('/').pop()));
    assert.ok(selected.includes('red.png'), selected.join());
    assert.ok(!selected.includes('red-copy.png'), selected.join());
  });

  await check('ZIP files include sources.csv with credits, and it can be switched off', async () => {
    await dash2.click('#selAll');
    const since = now();
    await dash2.click('#downloadZip');
    await toasted(/ZIP saved/);
    const zip = await latestDownload('application/zip', since);
    assert.ok(!zip.missing, JSON.stringify(zip.missing));
    const text = readFileSync(zip.filename).toString('utf8');
    assert.ok(text.includes('sources.csv'), 'no sources.csv in the ZIP');
    assert.ok(text.includes('Credit Agency'), 'credit missing from sources.csv');
    assert.ok(text.includes(`${base}/rights.html`), 'page missing from sources.csv');

    await worker.evaluate(async () => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...settings, zipSources: false } });
    });
    await dash2.waitForTimeout(300);
    await dash2.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 });
    const later = now();
    await dash2.click('#downloadZip');
    await toasted(/ZIP saved/);
    const plain = await latestDownload('application/zip', later);
    assert.ok(!plain.missing, JSON.stringify(plain.missing));
    assert.ok(!readFileSync(plain.filename).toString('utf8').includes('sources.csv'), 'sources.csv was added anyway');
    await worker.evaluate(async () => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...settings, zipSources: true } });
    });
    await dash2.waitForTimeout(300);
  });

  await check('prepared images: exact size, target file size and a visible watermark', async () => {
    const r = await dash2.evaluate(async () => {
      const { prepareImage, decode } = await import('/lib/imaging.js');
      const { planFromSettings } = await import('/lib/prepare.js');
      const plain = { prepSize: 'none', prepFit: 'cover', prepMaxKB: 0, prepWatermarkText: '' };
      const c = new OffscreenCanvas(800, 400);
      const ctx = c.getContext('2d');
      for (let i = 0; i < 4000; i++) {
        ctx.fillStyle = `hsl(${(i * 37) % 360} 80% 50%)`;
        ctx.fillRect((i * 13) % 800, (i * 7) % 400, 12, 12);
      }
      const jpg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
      const png = await c.convertToBlob({ type: 'image/png' });
      const size = async (b) => {
        const d = await decode(b);
        URL.revokeObjectURL(d.url);
        return `${d.width}x${d.height}`;
      };
      const corner = async (b, x, y) => {
        const d = await decode(b);
        const k = new OffscreenCanvas(d.width, d.height);
        const kx = k.getContext('2d');
        kx.drawImage(d.el, 0, 0);
        URL.revokeObjectURL(d.url);
        return [...kx.getImageData(x, y, 1, 1).data].slice(0, 3);
      };
      const white = new OffscreenCanvas(400, 200);
      const wx = white.getContext('2d');
      wx.fillStyle = '#000';
      wx.fillRect(0, 0, 400, 200);
      const black = await white.convertToBlob({ type: 'image/png' });
      const logo = new OffscreenCanvas(40, 40);
      const lx = logo.getContext('2d');
      lx.fillStyle = '#ffffff';
      lx.fillRect(0, 0, 40, 40);
      const marked = await prepareImage(black, 'original', planFromSettings({ ...plain, prepWatermarkOpacity: 1, prepWatermarkScale: 0.25, prepWatermarkPosition: 'top-left' }, logo.transferToImageBitmap()));
      const padded = await prepareImage(png, 'png', planFromSettings({ ...plain, prepSize: 'square', prepFit: 'contain', prepBackground: '#00ff00' }));
      const small = await prepareImage(jpg, 'original', planFromSettings({ ...plain, prepMaxKB: 20 }));
      const exact = await prepareImage(jpg, 'original', planFromSettings({ ...plain, prepSize: 'link', prepMaxKB: 1 }));
      const gif = new Blob([new Uint8Array([71, 73, 70])], { type: 'image/gif' });
      return {
        padded: await size(padded.blob), pad: await corner(padded.blob, 5, 5),
        before: jpg.size, small: small.blob.size, smallMet: small.met, smallType: small.blob.type,
        exact: await size(exact.blob), exactMet: exact.met,
        mark: await corner(marked.blob, 20, 20), clean: await corner(marked.blob, 300, 150), markedType: marked.blob.type,
        gif: (await prepareImage(gif, 'original', planFromSettings({ ...plain, prepWatermarkText: 'x' }))).blob === gif,
      };
    });
    assert.equal(r.padded, '1080x1080');
    assert.deepEqual(r.pad, [0, 255, 0]);
    assert.ok(r.before > 20 * 1024, `source only ${r.before}`);
    assert.ok(r.smallMet && r.small <= 20 * 1024, `${r.small} bytes`);
    assert.equal(r.smallType, 'image/jpeg');
    assert.equal(r.exact, '1200x630');
    assert.equal(r.exactMet, false);
    assert.ok(r.mark[0] > 200, `watermark not drawn: ${r.mark}`);
    assert.ok(r.clean[0] < 20, `watermark spread: ${r.clean}`);
    assert.equal(r.markedType, 'image/png');
    assert.ok(r.gif, 'GIF was redrawn');
  });

  await check('Prepare dialog: preview, then downloads use the chosen size', async () => {
    await dash2.click('#selNone');
    await dash2.click('#gallery .card:has(.url:text-matches("blue.png$"))');
    await dash2.click('#prepBtn');
    await dash2.waitForSelector('#prepareDialog[open]');
    await dash2.selectOption('#prepSize', 'link');
    await dash2.fill('#wmText', '© Test');
    await dash2.click('#prepPreview');
    await dash2.waitForFunction(() => /1200 × 630 px/.test(document.getElementById('prepPreviewInfo').textContent), null, { timeout: 15000 });
    await dash2.click('#prepDone');
    await dash2.waitForFunction(() => document.getElementById('prepOn').checked);
    try {
      const since = now();
      await dash2.click('#download');
      await toasted(/Downloaded 1/);
      const png = await latestDownload('image/png', since);
      assert.ok(!png.missing, JSON.stringify(png.missing));
      assert.equal(readFileSync(png.filename).readUInt32BE(16), 1200);
    } finally {
      await dash2.uncheck('#prepOn');
      await dash2.waitForFunction(async () => !(await chrome.storage.sync.get('settings')).settings.prepEnabled);
    }
  });

  await check('GIF frames: lists real frames and saves one as PNG', async () => {
    await openCard('anim.gif');
    try {
      assert.equal(await dash2.isVisible('#lbFrames'), true);
      await dash2.click('#lbFrames');
      await dash2.waitForSelector('#framesDialog[open]', { timeout: 10000 });
      assert.equal((await dash2.$$('#frGrid .frame')).length, 2);
      assert.equal(await dash2.isDisabled('#frSave'), true);
      await dash2.click('#frGrid .frame >> nth=1');
      assert.match(await dash2.textContent('#frInfo'), /1 of 2/);
      const since = now();
      await dash2.click('#frSave');
      await dash2.waitForFunction(() => !document.getElementById('framesDialog').open);
      const png = await latestDownload('image/png', since);
      assert.ok(!png.missing, JSON.stringify(png.missing));
      const file = readFileSync(png.filename);
      assert.equal(file.readUInt32BE(16), 4);
      await dash2.keyboard.press('Escape');
      await openCard('blue.png');
      assert.equal(await dash2.isVisible('#lbFrames'), false);
    } finally {
      await dash2.evaluate(() => document.getElementById('lbClose').click());
    }
  });

  await check('Names dialog flags clashes before downloading', async () => {
    await dash2.click('#selAll');
    await dash2.click('#namesBtn');
    await dash2.waitForSelector('#namesDialog[open]');
    assert.match(await dash2.textContent('#rnSummary'), /no name clashes/);
    await dash2.fill('#rnFile', 'same');
    await dash2.waitForFunction(() => /names clash/.test(document.getElementById('rnSummary').textContent));
    assert.ok((await dash2.$$('#rnList .name-row.clash')).length >= 2);
    await dash2.click('#rnClose');
  });

  await check('Copy as Markdown and HTML', async () => {
    await dash2.evaluate(() => {
      navigator.clipboard.writeText = async (t) => {
        window.copied = t;
      };
    });
    await dash2.click('#selNone');
    await dash2.click('#gallery .card:has(.url:text-matches("/red.png$"))');
    await dash2.click('#exportBtn');
    await dash2.click('[data-copy="markdown"]');
    await toasted(/Copied 1 images/);
    assert.equal(await dash2.evaluate(() => window.copied), `![Red \\[one\\]](${base}/media/red.png)`);
    await dash2.click('#exportBtn');
    await dash2.click('[data-copy="html"]');
    await dash2.waitForFunction(() => window.copied.startsWith('<img'));
    assert.match(await dash2.evaluate(() => window.copied), /alt="Red \[one\]" width="400" height="300">$/);
  });

  await check('site profile applies after a reload and can be removed', async () => {
    const before = (await settingsNow()).filenameTemplate;
    await dash2.fill('#fMinW', '150');
    await dash2.waitForTimeout(300);
    await dash2.click('#profileBtn');
    await dash2.waitForSelector('#profileDialog[open]');
    await dash2.fill('#pfFile', 'site_{index:2}');
    await dash2.selectOption('#pfFormat', 'png');
    await dash2.click('#pfSave');
    await toasted(/Profile saved/);
    await dash2.reload();
    await dash2.waitForSelector('#gallery .card');
    assert.equal(await dash2.inputValue('#fMinW'), '150');
    assert.equal(await dash2.inputValue('#convertTo'), 'png');
    assert.match(await dash2.textContent('#profileInfo'), /Using the profile/);
    await dash2.click('#selAll');
    await dash2.click('#namesBtn');
    assert.equal(await dash2.inputValue('#rnFile'), 'site_{index:2}');
    await dash2.fill('#rnFile', 'renamed_{index:2}');
    await dash2.click('#rnSave');
    await toasted(/Names saved for/);
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('site-profiles'))['site-profiles']);
    assert.equal(stored['127.0.0.1'].filenameTemplate, 'renamed_{index:2}');
    assert.equal((await settingsNow()).filenameTemplate, before, 'a profile rename changed the global settings');
    await dash2.click('#profileBtn');
    await dash2.click('#pfRemove');
    await toasted(/Profile removed/);
    // Back to the filters from before the profile was loaded.
    assert.equal(await dash2.inputValue('#fMinW'), '150');
    assert.equal(await dash2.inputValue('#convertTo'), 'original');
    await dash2.click('#resetFilters');
  });

  await check('collections: tags, search, backup and restore', async () => {
    await dash2.click('#selNone');
    await dash2.click('#gallery .card >> nth=0');
    await dash2.click('#saveBtn');
    await dash2.click('#saveMenu >> text=+ New collection…');
    await dash2.fill('#nameInput', 'Tagged');
    await dash2.click('#nameOk');
    await toasted(/Saved 1 image to "Tagged"/);
    await dash2.click('#collectionsBtn');
    await dash2.click('#collectionsList .hist:has-text("Tagged") button:has-text("Tags")');
    await dash2.fill('#collTags', 'Beach, Trip');
    await dash2.fill('#collNote', 'Holiday ideas');
    await dash2.click('#collDialog button[value="ok"]');
    await dash2.waitForSelector('#collectionsList .tags:has-text("beach, trip")');
    await dash2.fill('#collSearch', 'holiday');
    await dash2.waitForFunction(() => document.querySelectorAll('#collectionsList .hist').length === 1);
    await dash2.fill('#collSearch', '');
    const since = now();
    await dash2.click('#backupCollections');
    await toasted(/Backed up/);
    const backup = await latestDownload('application/json', since);
    assert.ok(!backup.missing, JSON.stringify(backup.missing));
    await worker.evaluate(() => chrome.storage.local.remove('collections'));
    await dash2.setInputFiles('#collFile', backup.filename);
    await toasted(/Restored 2 new collections/);
    await dash2.waitForSelector('#collectionsList .tags:has-text("beach, trip")');
    await dash2.setInputFiles('#collFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
    await toasted(/not a collections backup/);
    await dash2.click('#closeCollections');
  });

  await check('options page shows the download log and sources.csv switch', async () => {
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extId}/options/options.html`);
    await opts.waitForFunction(() => /^\d/.test(document.getElementById('logSize').textContent));
    assert.equal(await opts.isChecked('input[name="zipSources"]'), true);
    await opts.close();
  });

  await rightsPage.close();
  await dash2.close();

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

  await check('Audit site opens a report ranked by page', async () => {
    const [report] = await Promise.all([context.waitForEvent('page'), crawlPage.click('#auditSite')]);
    await report.waitForSelector('#auditDialog[open]');
    assert.equal(await report.inputValue('#auditView'), 'page');
    const rows = await report.$$eval('#auditList .audit-item', (els) => els.map((e) => e.textContent));
    assert.ok(rows.length >= 2, `only ${rows.length} pages`);
    assert.ok(rows.every((r) => /\/site\//.test(r)), rows.join(' | '));
    await report.click('#auditList .audit-item >> nth=0');
    await report.waitForSelector('#auditRules .chip.on');
    assert.equal(await report.inputValue('#auditView'), 'image');
    assert.ok((await report.$$('#auditList .audit-item')).length >= 1);
    await report.close();
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

  await check('side panel follows the active tab', async () => {
    const side = await context.newPage();
    await side.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
    await side.waitForURL(/dashboard\.html\?panel=1/);
    await side.waitForSelector('body.panel');
    // In tests the panel is itself a tab; switching to the fixture page must make it scan that page.
    await page.bringToFront();
    await side.waitForFunction(() => document.querySelectorAll('#gallery .card').length > 0, null, { timeout: 15000 });
    assert.match(await side.textContent('#sourceInfo'), /Scraper fixture/);
    await page.goto(`${base}/frame.html`);
    await side.waitForFunction(() => !/Scraper fixture/.test(document.getElementById('sourceInfo').textContent), null, { timeout: 15000 });
    await page.goto(`${base}/`);
    await page.waitForLoadState('load');
    await side.close();
  });

  await check('popup renders counts', async () => {
    await page.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    await popup.waitForTimeout(1500);
    const text = await popup.textContent('#count');
    assert.ok(text !== '–', `count was ${text}`);
    assert.equal(await popup.isVisible('#panel'), true, 'side panel button hidden');
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
}

// ------------------------------------------------------------ limited mode (the build as shipped)
console.log('\nLimited mode (access to all sites not granted yet):');
const limited = await launch(EXT);
try {
  let [worker] = limited.serviceWorkers();
  worker ??= await limited.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;

  await check('manifest asks for access to all sites only at runtime', () => {
    const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
    assert.equal(manifest.host_permissions, undefined);
    assert.deepEqual(manifest.optional_host_permissions, ['<all_urls>']);
    assert.ok(manifest.permissions.includes('activeTab'));
  });
  const page = await limited.newPage();
  await page.goto(`${base}/`);
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0].id, base);
  const dash = await limited.newPage();
  await dash.goto(`chrome-extension://${extId}/dashboard/dashboard.html?tabId=${tabId}`);

  await check('not granted after install', async () => {
    assert.equal(await dash.evaluate(() => chrome.permissions.contains({ origins: ['<all_urls>'] })), false);
  });
  await check('scanning a tab without access explains what to do', async () => {
    await dash.waitForFunction(() => /No access to this tab/.test(document.getElementById('sourceInfo').textContent), null, { timeout: 15000 });
  });
  await check('dashboard shows the "Allow access to all sites" banner', async () => {
    assert.ok(await dash.isVisible('#allowAllSites'));
  });
  await check('Analyze without access explains why instead of failing', async () => {
    // Playwright's evaluate counts as a user gesture, which would open Chrome's permission prompt (which a
    // headless browser can't answer). Clicking after the ~5 s gesture window has expired makes Chrome refuse
    // to prompt, which is the path to test: the dashboard must say why nothing happened.
    await dash.evaluate(() => setTimeout(() => document.getElementById('analyze').click(), 6000));
    await dash.waitForFunction(() => /needs access to all sites/i.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 15000 });
  });

  const bulk = await limited.newPage();
  await bulk.goto(`chrome-extension://${extId}/bulk/bulk.html?urls=${encodeURIComponent(`${base}/`)}&autostart=1`);
  await check('bulk scraper waits for access instead of fetching', async () => {
    await bulk.waitForFunction(() => /needs access to all sites/i.test(document.getElementById('log').textContent), null, { timeout: 10000 });
    assert.ok(await bulk.isVisible('#allowAllSites'));
  });

  const opts = await limited.newPage();
  await opts.goto(`chrome-extension://${extId}/options/options.html`);
  await check('options page shows the site-access switch', async () => {
    await opts.waitForFunction(() => /Limited/.test(document.getElementById('accessStatus').textContent));
    assert.equal(await opts.textContent('#accessToggle'), 'Allow access to all sites');
  });
} finally {
  await limited.close();
  server.close();
  rmSync(EXT_GRANTED, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll end-to-end checks passed');
process.exit(failures ? 1 : 0);
