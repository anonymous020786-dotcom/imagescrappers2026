// The full feature list, read at build time from the README's "## Features" section, so the website and the
// repository can never disagree. Each "### Category" becomes a section and each numbered line a feature.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inline, plainText, slugify } from './markdown';

export type Feature = { n: number; title: string; titleHtml: string; html: string; text: string };
export type FeatureGroup = { id: string; name: string; note?: string; intro: string; features: Feature[]; extras: string[]; isNew?: boolean };

// A short, plain-language introduction for each category (also the section's meta text in structured data).
const INTROS: Record<string, string> = {
  detection:
    'Image Scraper Pro looks further than any “save all images” button. It reads every place a web page can hide an image, from srcset and lazy-load attributes to CSS backgrounds, Shadow DOM and iframes, and always picks the largest version available.',
  filtering:
    'Narrow thousands of results down to exactly the files you want. Every filter shows a live count, and the dashboard remembers your choices between scans.',
  analysis:
    'One click fetches every image to measure its exact file size, true dimensions and real format, then finds visual duplicates and dominant colours.',
  browsing: 'A fast gallery built for large result sets, with keyboard-friendly selection and a full-screen preview.',
  downloading:
    'Download individual files with your own naming rules, or everything as one ZIP. Convert formats, skip files you already have and export lists in the format you need.',
  bulk:
    'Collect images from many pages without opening them: paste a list of URLs or let the crawler follow links, pagination and sitemaps across a whole website.',
  'large-scale': 'Built for jobs with tens of thousands of images: queues that survive restarts, automatic retries and ZIP files split to a size you choose.',
  worldwide: 'Works on the real web, including sites in any language, legacy text encodings, logins and image hosts that block direct downloads.',
  editing:
    'Crop, rotate, resize and convert in the browser, remove location and camera data before sharing, audit a page’s images and keep the best ones in collections.',
  credit: 'Find who made an image and under which licence, then prepare whole selections for social media, the web or print in one step.',
  seo: 'A built-in image SEO audit for marketers and developers: alt text, file names, sharing images, structured data and a Google image sitemap.',
  developer:
    'Added in version 1.7: tools for web developers and designers, from a broken image checker and a page weight report to favicon packs, responsive image sets and an on-page size inspector.',
  speed:
    'New in version 1.8: Core Web Vitals checks for the LCP image and layout shift, sharpness and encoding analysis, palettes for design apps, lazy-loading placeholders, sprite sheets and one-click image fixes such as trimming, background removal, tiles and mockups.',
  browser: 'Image Scraper Pro fits into the way you already browse, with right-click menus, keyboard commands and settings that follow you across devices.',
};

const KEYS: [RegExp, string][] = [
  [/^Detection/, 'detection'],
  [/^Filtering/, 'filtering'],
  [/^Analysis/, 'analysis'],
  [/^Browsing/, 'browsing'],
  [/^Downloading/, 'downloading'],
  [/^Bulk/, 'bulk'],
  [/^Large-scale/, 'large-scale'],
  [/^Worldwide/, 'worldwide'],
  [/^Editing/, 'editing'],
  [/^Credit/, 'credit'],
  [/^Image SEO/, 'seo'],
  [/^Developer/, 'developer'],
  [/^Page speed/, 'speed'],
  [/^Browser/, 'browser'],
];

// README descriptions continue the bold title ("**Title**: sends …"); on a card they start a sentence.
const cap = (s: string) => s.replace(/^[a-z]/, (c) => c.toUpperCase());

function parseFeature(n: number, md: string): Feature {
  // "**Title**: description" splits into a heading and its text; anything else is shown as one line.
  const m = /^\*\*(.+?)\*\*:\s*([\s\S]*)$/.exec(md);
  if (m) return { n, title: plainText(m[1]), titleHtml: inline(m[1]), html: inline(cap(m[2])), text: plainText(`${m[1]}: ${m[2]}`) };
  const short = /^([A-Z][^:`*]{2,40}):\s+(.+)$/.exec(md); // "Right-click menus: download …"
  if (short) return { n, title: short[1], titleHtml: inline(short[1]), html: inline(cap(short[2])), text: plainText(md) };
  return { n, title: plainText(md), titleHtml: inline(md), html: '', text: plainText(md) };
}

let cache: FeatureGroup[] | undefined;

export function getFeatureGroups(): FeatureGroup[] {
  if (cache) return cache;
  const readme = readFileSync(join(process.cwd(), '..', 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const section = /^## Features[^\n]*\n([\s\S]*?)(?=^## )/m.exec(readme);
  if (!section) throw new Error('README.md: no "## Features" section');
  const groups: FeatureGroup[] = [];
  for (const block of section[1].split(/^### /m).slice(1)) {
    const [head, ...lines] = block.split('\n');
    const nm = /^(.+?)(?:\s+\((.+)\))?\s*$/.exec(head.trim())!;
    const key = KEYS.find(([re]) => re.test(nm[1]))?.[1] ?? slugify(nm[1]);
    const features: Feature[] = [];
    const extras: string[] = [];
    for (const line of lines) {
      const num = /^(\d+)\.\s+(.+)$/.exec(line);
      if (num) features.push(parseFeature(Number(num[1]), num[2]));
      else if (/^- /.test(line)) extras.push(line.slice(2));
    }
    // Bullet lists (Browser integration) are features too, numbered after the last one.
    groups.push({ id: key, name: nm[1], note: nm[2], intro: INTROS[key] ?? '', features, extras, isNew: key === 'speed' });
  }
  let next = Math.max(...groups.flatMap((g) => g.features.map((f) => f.n))) + 1;
  for (const g of groups) {
    for (const e of g.extras) g.features.push(parseFeature(next++, e));
    g.extras = [];
  }
  cache = groups;
  return groups;
}

export const featureCount = () => getFeatureGroups().reduce((sum, g) => sum + g.features.length, 0);
