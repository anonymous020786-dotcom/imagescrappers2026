import type { Metadata } from 'next';
import { Breadcrumb, Prose } from '@/components/Content';
import { ProseTools, TocSidebar } from '@/components/DocTools';
import { getPrivacyMarkdown } from '@/lib/content';
import { headings, markdownToHtml } from '@/lib/markdown';
import { pageMetadata } from '@/lib/metadata';

const DESCRIPTION =
  'Image Scraper Pro runs entirely in your browser: no analytics, no tracking, and nothing sent to the developer. Read the full privacy policy.';

export const metadata: Metadata = pageMetadata({ title: 'Privacy Policy', description: DESCRIPTION, path: '/privacy/', type: 'article' });

// Rendered from PRIVACY.md in the repository root, the same file the store listings link to.
export default function PrivacyPage() {
  const html = markdownToHtml(getPrivacyMarkdown());
  return (
    <div className="doc-layout wrap">
      <article className="article">
        <Breadcrumb crumbs={[{ name: 'Privacy Policy', path: '/privacy/' }]} />
        <Prose html={html} />
        <ProseTools />
      </article>
      <aside className="doc-aside">
        <TocSidebar items={headings(html)} />
      </aside>
    </div>
  );
}
