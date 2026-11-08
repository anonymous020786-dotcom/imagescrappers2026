// Per-page metadata. Next.js replaces (does not merge) the layout's openGraph and twitter objects when a page sets
// its own, so every page goes through this helper to keep the sharing image and the large card.
import type { Metadata } from 'next';

const OG_IMAGE = { url: '/assets/og-image.png', width: 1200, height: 630, alt: 'Image Scraper Pro: find, filter and bulk-download every image on any page' };

type PageMeta = {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article';
  absoluteTitle?: boolean; // the home page's title is used as-is, without the " – Image Scraper Pro" suffix
  shareTitle?: string;
  shareDescription?: string;
  twitterDescription?: string;
  modifiedTime?: string;
};

export function pageMetadata(p: PageMeta): Metadata {
  const shareTitle = p.shareTitle ?? p.title;
  const shareDescription = p.shareDescription ?? p.description;
  return {
    title: p.absoluteTitle ? { absolute: p.title } : p.title,
    description: p.description,
    alternates: { canonical: p.path },
    openGraph: {
      type: p.type ?? 'website',
      url: p.path,
      siteName: 'Image Scraper Pro',
      locale: 'en_US',
      title: shareTitle,
      description: shareDescription,
      images: [OG_IMAGE],
      ...(p.modifiedTime ? { modifiedTime: p.modifiedTime } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description: p.twitterDescription ?? shareDescription,
      images: [OG_IMAGE.url],
    },
  };
}
