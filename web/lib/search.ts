// Site search index, built at compile time from the same content as the pages (no search service).
import { getGuides, getHelp } from './content';
import { plainText, slugify } from './markdown';

export type SearchEntry = { title: string; text: string; url: string; group: 'Guides' | 'Help Center' | 'On this site'; parent?: string };

const SECTIONS: SearchEntry[] = [
  { title: 'Features', text: 'Detection, filters, bulk download, ZIP, crawler, editing, privacy', url: '/#features', group: 'On this site' },
  { title: 'Use cases', text: 'Designers, SEO and marketing, e-commerce, developers and research', url: '/#use-cases', group: 'On this site' },
  { title: 'Image SEO audit', text: 'Alt text, file names, social sharing images, structured data, image sitemap', url: '/#seo', group: 'On this site' },
  { title: 'Download for your browser', text: 'Chrome, Edge, Firefox, Brave, Opera, Vivaldi, Safari, source code', url: '/#download', group: 'On this site' },
  { title: 'Frequently asked questions', text: 'Free, privacy, browsers, installing from ZIP, SEO audit, crawling, copyright', url: '/#faq', group: 'On this site' },
  { title: 'Privacy policy', text: 'No analytics, no tracking, data stored on your device, permissions', url: '/privacy/', group: 'On this site' },
];

export function getSearchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const g of getGuides()) {
    entries.push({ title: g.title, text: g.description, url: `/guides/${g.slug}/`, group: 'Guides' });
    // Each guide section is searchable on its own, linking straight to the heading.
    for (const m of g.body.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
      entries.push({ title: plainText(m[1]), text: plainText(m[2]).slice(0, 220), url: `/guides/${g.slug}/#${slugify(m[1])}`, group: 'Guides', parent: g.title });
    }
  }
  for (const m of getHelp().body.matchAll(/^### (.+)\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/gm)) {
    entries.push({ title: plainText(m[1]), text: plainText(m[2]).slice(0, 220), url: `/help/#${slugify(m[1])}`, group: 'Help Center' });
  }
  return [...entries, ...SECTIONS];
}
