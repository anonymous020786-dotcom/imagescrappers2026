// Building blocks for the guides, Help Center and privacy pages.
import Link from 'next/link';
import type { Page } from '@/lib/content';
import { headings } from '@/lib/markdown';
import { chromeButton, hrefFor, siteUrl } from '@/lib/site';
import { ArrowIcon } from './Icons';
import { JsonLd } from './JsonLd';

export type Crumb = { name: string; path: string };

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  const all = [{ name: 'Home', path: '/' }, ...crumbs];
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <ol>
          {all.map((c, i) =>
            i === all.length - 1 ? (
              <li key={c.path} aria-current="page">
                {c.name}
              </li>
            ) : (
              <li key={c.path}>
                <Link href={c.path}>{c.name}</Link>
              </li>
            ),
          )}
        </ol>
      </nav>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: all.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${siteUrl}${c.path}` })),
        }}
      />
    </>
  );
}

export function GuideCard({ guide }: { guide: Page }) {
  return (
    <Link className="guide-card" href={`/guides/${guide.slug}/`}>
      <span className="guide-tag">{guide.tag ?? 'Guide'}</span>
      <strong>{guide.title}</strong>
      <span>{guide.description}</span>
      <em>
        Read the guide <ArrowIcon />
      </em>
    </Link>
  );
}

export function GuideGrid({ guides }: { guides: Page[] }) {
  return (
    <div className="guide-grid">
      {guides.map((g) => (
        <GuideCard key={g.slug} guide={g} />
      ))}
    </div>
  );
}

export function CtaBox() {
  return (
    <aside className="cta-box">
      <div>
        <strong>Try it free in your browser</strong>
        <span>Free, open source and private. No account needed.</span>
      </div>
      <div className="cta-row">
        <a className="btn btn-primary" href={hrefFor('chrome')} data-dl="chrome">
          {chromeButton}
        </a>
        <a className="btn" href={hrefFor('firefox')} data-dl="firefox">
          Firefox
        </a>
        <a className="btn" href={hrefFor('edge')} data-dl="edge">
          Edge
        </a>
      </div>
    </aside>
  );
}

// Table of contents from the h2 headings, when there are enough of them.
export function Toc({ html }: { html: string }) {
  const items = headings(html);
  if (items.length < 3) return null;
  return (
    <nav className="toc" aria-label="On this page">
      <strong>On this page</strong>
      <ol>
        {items.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} dangerouslySetInnerHTML={{ __html: h.html }} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

// Markdown rendered at build time from our own content files.
export function Prose({ html }: { html: string }) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

// Previous and next guide, at the end of each guide.
export function PrevNext({ prev, next }: { prev?: Page; next?: Page }) {
  if (!prev && !next) return null;
  return (
    <nav className="prev-next" aria-label="More guides">
      {prev ? (
        <Link className="pn prev" href={`/guides/${prev.slug}/`}>
          <span>← Previous</span>
          <strong>{prev.title}</strong>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link className="pn next" href={`/guides/${next.slug}/`}>
          <span>Next →</span>
          <strong>{next.title}</strong>
        </Link>
      )}
    </nav>
  );
}
