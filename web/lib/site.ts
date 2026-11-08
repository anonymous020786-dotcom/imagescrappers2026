// Build-time site configuration. Values come from Netlify environment variables, read during `next build`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SITE_NAME = 'Image Scraper Pro';
export const REPO = 'https://github.com/anonymous020786-dotcom/imagescrappers2026';
export const siteUrl = (process.env.SITE_URL || process.env.URL || 'https://image-scraper-pro.netlify.app').replace(/\/+$/, '');
export const version: string = JSON.parse(readFileSync(join(process.cwd(), '..', 'package.json'), 'utf8')).version;
export const buildDate = new Date().toISOString().slice(0, 10);

// Search Console / Bing Webmaster "HTML tag" verification tokens.
const token = (name: string) => (process.env[name] ?? '').trim().replace(/[^\w-]/g, '');
export const verification = { google: token('GOOGLE_SITE_VERIFICATION'), bing: token('BING_SITE_VERIFICATION') };

// Store listings: set CHROME_STORE_URL / EDGE_STORE_URL / FIREFOX_STORE_URL in Netlify and the download buttons
// become "Add to …" links, so installs count towards the store ranking. Unset, they download the ZIP from GitHub.
const storeUrl = (name: string) => {
  const value = (process.env[name] ?? '').trim();
  return /^https:\/\/\S+$/.test(value) ? value : '';
};
export const chromeStore = storeUrl('CHROME_STORE_URL');
export type Browser = 'chrome' | 'edge' | 'firefox' | 'brave' | 'opera' | 'vivaldi' | 'safari';
const stores: Partial<Record<Browser, [string, string]>> = {
  chrome: [chromeStore, 'Add to Chrome'],
  brave: [chromeStore, 'Add from Chrome Web Store'],
  vivaldi: [chromeStore, 'Add from Chrome Web Store'],
  edge: [storeUrl('EDGE_STORE_URL'), 'Get it from Edge Add-ons'],
  firefox: [storeUrl('FIREFOX_STORE_URL'), 'Add to Firefox'],
};
export const zipUrl = (browser: Browser) => `${REPO}/raw/main/dist/image-scraper-pro-${browser}-${version}.zip`;
export const hrefFor = (browser: Browser) => stores[browser]?.[0] || zipUrl(browser);
export const ctaFor = (browser: Browser) => (stores[browser]?.[0] ? stores[browser]![1] : 'Download .zip');
export const chromeButton = chromeStore ? 'Add to Chrome' : 'Download for Chrome';
export const installUrl = chromeStore || `${REPO}/releases/latest`;
// The store pages are the same product: listed as sameAs in the structured data.
export const sameAs = [chromeStore, stores.firefox?.[0], stores.edge?.[0]].filter((u): u is string => Boolean(u));

export const publisher = {
  '@type': 'Organization',
  name: SITE_NAME,
  url: `${siteUrl}/`,
  logo: { '@type': 'ImageObject', url: `${siteUrl}/assets/icon128.png` },
};
