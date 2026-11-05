// Renders the landing page's social sharing image, site/assets/og-image.png (1200×630), with Playwright.
// Run with `npm run site:og` after changing the branding or screenshots.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(join(execSync('npm root -g').toString().trim(), 'playwright')));
}

const dataUri = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
const icon = dataUri(join(ROOT, 'src', 'icons', 'icon128.png'));
const shot = dataUri(join(ROOT, 'store', 'chrome', 'screenshot-1.png'));

const html = `<!doctype html><html><head><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
    background: linear-gradient(120deg, #4459dc 0%, #6e47e6 48%, #b82a87 100%); color: #fff; position: relative; }
  body::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 12% 0%, rgba(255,255,255,.25), transparent 40%); }
  .text { position: absolute; left: 72px; top: 92px; width: 560px; }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 30px; font-weight: 800; margin-bottom: 44px; }
  .brand img { width: 72px; height: 72px; border-radius: 18px; box-shadow: 0 12px 30px rgba(20,10,80,.35); }
  h1 { font-size: 60px; line-height: 1.05; font-weight: 800; letter-spacing: -1.5px; margin-bottom: 26px; }
  p { font-size: 26px; line-height: 1.35; opacity: .92; }
  .tags { position: absolute; left: 72px; bottom: 64px; display: flex; gap: 12px; }
  .tags span { font-size: 19px; font-weight: 700; padding: 9px 18px; border-radius: 999px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.35); }
  .shot { position: absolute; left: 680px; top: 120px; width: 760px; border-radius: 16px; overflow: hidden;
    box-shadow: 0 40px 90px rgba(20,10,80,.5); transform: perspective(1400px) rotateY(-14deg) rotateX(4deg); border: 1px solid rgba(255,255,255,.4); }
  .shot img { display: block; width: 100%; }
</style></head><body>
  <div class="text">
    <div class="brand"><img src="${icon}" alt="">Image Scraper Pro</div>
    <h1>Find &amp; download every image on any page</h1>
    <p>Bulk download, ZIP, crawl whole sites and audit image SEO.</p>
  </div>
  <div class="tags"><span>Free &amp; open source</span><span>7 browsers</span><span>No tracking</span></div>
  <div class="shot"><img src="${shot}" alt=""></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
const out = join(ROOT, 'site', 'assets', 'og-image.png');
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();
console.log('✔ site/assets/og-image.png');
