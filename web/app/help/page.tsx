import type { Metadata } from 'next';
import { Breadcrumb, CtaBox, GuideGrid, Prose, Toc } from '@/components/Content';
import { JsonLd } from '@/components/JsonLd';
import { faqFrom, getGuides, getHelp } from '@/lib/content';
import { markdownToHtml } from '@/lib/markdown';

const help = getHelp();

export const metadata: Metadata = {
  title: help.title,
  description: help.description,
  alternates: { canonical: '/help/' },
  openGraph: { type: 'website', url: '/help/', title: help.title, description: help.description },
  twitter: { title: help.title, description: help.description },
};

export default function HelpPage() {
  const html = markdownToHtml(help.body);
  return (
    <>
      {/* Every "### question" in content/help.md is also FAQ structured data. */}
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqFrom(help.body) }} />
      <article className="article wrap-narrow">
        <Breadcrumb crumbs={[{ name: 'Help Center', path: '/help/' }]} />
        <header className="article-head">
          <span className="eyebrow">Help Center</span>
          <h1>{help.heading ?? help.title}</h1>
          <p className="lead">{help.description}</p>
        </header>
        <Toc html={html} />
        <Prose html={html} />
        <CtaBox />
      </article>
      <section className="related wrap" aria-labelledby="related-title">
        <h2 id="related-title">Popular guides</h2>
        <GuideGrid guides={getGuides().slice(0, 3)} />
      </section>
    </>
  );
}
