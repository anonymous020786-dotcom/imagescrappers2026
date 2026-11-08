import type { MetadataRoute } from 'next';
import { getGuides, getHelp } from '@/lib/content';
import { buildDate, siteUrl } from '@/lib/site';

export const dynamic = 'force-static';

// Every page, with its images, so Google can find the screenshots too.
export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => `${siteUrl}${path}`;
  const imagesIn = (markdown: string) => [...markdown.matchAll(/!\[[^\]]*\]\((\/assets\/[^)\s]+)\)/g)].map((m) => url(m[1]));
  return [
    { url: url('/'), lastModified: buildDate, priority: 1, images: [1, 2, 3, 4, 5].map((n) => url(`/assets/screenshot-${n}.png`)).concat(url('/assets/og-image.png')) },
    { url: url('/features/'), lastModified: buildDate, priority: 0.9 },
    { url: url('/guides/'), lastModified: buildDate, priority: 0.9 },
    ...getGuides().map((g) => ({ url: url(`/guides/${g.slug}/`), lastModified: g.updated, priority: 0.8, images: [...new Set(imagesIn(g.body))] })),
    { url: url('/help/'), lastModified: getHelp().updated, priority: 0.8 },
    { url: url('/privacy/'), lastModified: buildDate, priority: 0.3 },
  ];
}
