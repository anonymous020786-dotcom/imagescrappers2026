import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb, CtaBox, GuideGrid, Prose, Toc } from '@/components/Content';
import { JsonLd } from '@/components/JsonLd';
import { getGuide, getGuides, humanDate } from '@/lib/content';
import { markdownToHtml } from '@/lib/markdown';
import { pageMetadata } from '@/lib/metadata';
import { publisher, siteUrl } from '@/lib/site';

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export function generateStaticParams() {
  return getGuides().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = getGuide((await params).slug);
  if (!guide) return {};
  return pageMetadata({ title: guide.title, description: guide.description, path: `/guides/${guide.slug}/`, type: 'article', modifiedTime: guide.updated });
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const guides = getGuides();
  const index = guides.findIndex((g) => g.slug === slug);
  if (index < 0) notFound();
  const guide = guides[index];
  const html = markdownToHtml(guide.body);
  const path = `/guides/${guide.slug}/`;
  const related = [...guides.slice(index + 1), ...guides.slice(0, index)].slice(0, 3);

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: guide.title,
          description: guide.description,
          image: `${siteUrl}/assets/og-image.png`,
          datePublished: guide.published ?? guide.updated,
          dateModified: guide.updated,
          author: publisher,
          publisher,
          mainEntityOfPage: `${siteUrl}${path}`,
          about: { '@id': `${siteUrl}/#app` },
        }}
      />
      <article className="article wrap-narrow">
        <Breadcrumb crumbs={[{ name: 'Guides', path: '/guides/' }, { name: guide.title, path }]} />
        <header className="article-head">
          <span className="eyebrow">{guide.tag ?? 'Guide'}</span>
          <h1>{guide.title}</h1>
          <p className="lead">{guide.description}</p>
          <p className="article-meta">
            Updated <time dateTime={guide.updated}>{humanDate(guide.updated)}</time>
            {guide.minutes ? ` · ${guide.minutes} min read` : ''}
          </p>
        </header>
        <Toc html={html} />
        <Prose html={html} />
        <CtaBox />
      </article>
      <section className="related wrap" aria-labelledby="related-title">
        <h2 id="related-title">More guides</h2>
        <GuideGrid guides={related} />
      </section>
    </>
  );
}
