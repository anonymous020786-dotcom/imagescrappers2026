import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb, CtaBox } from '@/components/Content';
import { FeatureExplorer } from '@/components/FeatureExplorer';
import { JsonLd } from '@/components/JsonLd';
import { featureCount, getFeatureGroups } from '@/lib/features';
import { pageMetadata } from '@/lib/metadata';
import { siteUrl, version } from '@/lib/site';

const groups = getFeatureGroups();
const total = featureCount();
const rounded = `${Math.floor(total / 5) * 5}+`;

const title = `All ${rounded} features in detail`;
const description = `The complete, detailed list of Image Scraper Pro's ${total} features: finding every image, filters, bulk download and ZIP, website crawling, conversion, editing, image SEO audit and developer tools. Free for Chrome, Firefox and Edge.`;

export const metadata: Metadata = pageMetadata({
  title,
  description,
  path: '/features/',
  shareTitle: `Image Scraper Pro: all ${rounded} features`,
});

export default function FeaturesPage() {
  const url = `${siteUrl}/features/`;
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebPage',
              '@id': url,
              url,
              name: title,
              description,
              about: { '@id': `${siteUrl}/#app` },
              mainEntity: { '@id': `${url}#list` },
            },
            {
              // One entry per category, each with its features, so the structure of the page is explicit.
              '@type': 'ItemList',
              '@id': `${url}#list`,
              name: 'Image Scraper Pro features',
              numberOfItems: total,
              itemListElement: groups.map((g, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: g.name,
                url: `${url}#${g.id}`,
                description: g.intro || undefined,
              })),
            },
            {
              '@type': 'SoftwareApplication',
              '@id': `${siteUrl}/#app`,
              name: 'Image Scraper Pro',
              softwareVersion: version,
              applicationCategory: 'BrowserApplication',
              operatingSystem: 'Chrome, Firefox, Edge, Brave, Opera, Vivaldi, Safari',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
              featureList: groups.flatMap((g) => g.features.map((f) => f.title)),
            },
          ],
        }}
      />
      <div className="wrap features-page">
        <Breadcrumb crumbs={[{ name: 'Features', path: '/features/' }]} />
        <header className="features-hero">
          <span className="eyebrow">Version {version} · {total} features</span>
          <h1>
            Every feature of Image Scraper Pro, <span className="grad-text">in detail</span>
          </h1>
          <p className="lead">
            A free, open-source image downloader for your browser. Below is the complete list of what it does, grouped into {groups.length} areas, from
            finding hidden images to crawling whole websites, converting, editing, auditing for SEO and building favicons or responsive image sets.
            Everything runs on your own device: no account, no tracking.
          </p>
          <ul className="features-facts" aria-label="At a glance">
            <li>
              <strong>{total}</strong> features
            </li>
            <li>
              <strong>{groups.length}</strong> categories
            </li>
            <li>
              <strong>7</strong> browsers
            </li>
            <li>
              <strong>0</strong> trackers
            </li>
          </ul>
          <nav className="features-toc" aria-label="Categories">
            {groups.map((g, i) => (
              <a key={g.id} href={`#${g.id}`}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                {g.name.replace(/:.*$/, '')}
                <em>{g.features.length}</em>
              </a>
            ))}
          </nav>
        </header>

        <FeatureExplorer groups={groups} />

        <section className="features-more" aria-labelledby="more-title">
          <h2 id="more-title">Learn how to use them</h2>
          <p>
            Step-by-step instructions are in the <Link href="/guides/">guides</Link>, and answers to common questions are in the{' '}
            <Link href="/help/">Help Center</Link>. Image Scraper Pro asks only for the permissions it needs; see the{' '}
            <Link href="/privacy/">privacy policy</Link>.
          </p>
        </section>
        <CtaBox />
      </div>
    </>
  );
}
