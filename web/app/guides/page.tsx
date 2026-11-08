import type { Metadata } from 'next';
import { Breadcrumb, GuideGrid } from '@/components/Content';
import { JsonLd } from '@/components/JsonLd';
import { getGuides } from '@/lib/content';
import { pageMetadata } from '@/lib/metadata';
import { REPO, siteUrl } from '@/lib/site';

const TITLE = 'Guides: download, convert and audit images';
const DESCRIPTION =
  'Step-by-step guides for downloading every image from a page or a whole website, converting to WebP, removing photo metadata and improving image SEO.';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: '/guides/' });

export default function GuidesPage() {
  const guides = getGuides();
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Image Scraper Pro guides',
          url: `${siteUrl}/guides/`,
          hasPart: guides.map((g) => ({ '@type': 'TechArticle', headline: g.title, url: `${siteUrl}/guides/${g.slug}/` })),
        }}
      />
      <section className="page-hero wrap">
        <Breadcrumb crumbs={[{ name: 'Guides', path: '/guides/' }]} />
        <span className="eyebrow">Guides</span>
        <h1>Learn to collect, prepare and optimize images</h1>
        <p className="lead">Practical, step-by-step guides for Image Scraper Pro, from saving every image on a page to auditing a whole site&apos;s image SEO.</p>
      </section>
      <section className="wrap guides-list" aria-label="All guides">
        <GuideGrid guides={guides} />
        <p className="center muted guides-help">
          Can&apos;t find what you need? Visit the <a href="/help/">Help Center</a> or <a href={`${REPO}/issues`}>ask a question on GitHub</a>.
        </p>
      </section>
    </>
  );
}
