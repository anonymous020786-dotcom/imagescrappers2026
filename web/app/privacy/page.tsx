import type { Metadata } from 'next';
import { Breadcrumb, Prose } from '@/components/Content';
import { getPrivacyMarkdown } from '@/lib/content';
import { markdownToHtml } from '@/lib/markdown';
import { pageMetadata } from '@/lib/metadata';

const DESCRIPTION =
  'Image Scraper Pro runs entirely in your browser: no analytics, no tracking, and nothing sent to the developer. Read the full privacy policy.';

export const metadata: Metadata = pageMetadata({ title: 'Privacy Policy', description: DESCRIPTION, path: '/privacy/', type: 'article' });

// Rendered from PRIVACY.md in the repository root, the same file the store listings link to.
export default function PrivacyPage() {
  return (
    <article className="article wrap-narrow">
      <Breadcrumb crumbs={[{ name: 'Privacy Policy', path: '/privacy/' }]} />
      <Prose html={markdownToHtml(getPrivacyMarkdown())} />
    </article>
  );
}
