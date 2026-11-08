'use client';
// The guides index with category chips and a filter box. All guides are in the HTML; filtering only hides cards.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowIcon, SearchIcon } from './Icons';

export type GuideSummary = { slug: string; title: string; description: string; tag: string; minutes?: string };

export function GuideBrowser({ guides }: { guides: GuideSummary[] }) {
  const [tag, setTag] = useState('All');
  const [query, setQuery] = useState('');
  const tags = useMemo(() => ['All', ...new Set(guides.map((g) => g.tag))], [guides]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = guides.filter(
    (g) => (tag === 'All' || g.tag === tag) && words.every((w) => `${g.title} ${g.description} ${g.tag}`.toLowerCase().includes(w)),
  );

  return (
    <>
      <div className="guide-filters">
        <div className="filter-chips" role="group" aria-label="Filter by topic">
          {tags.map((t) => (
            <button key={t} type="button" aria-pressed={t === tag} onClick={() => setTag(t)}>
              {t}
              <span>{t === 'All' ? guides.length : guides.filter((g) => g.tag === t).length}</span>
            </button>
          ))}
        </div>
        <label className="filter-search">
          <SearchIcon />
          <input type="search" placeholder="Filter guides…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter guides" />
        </label>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {visible.length} of {guides.length} guides shown
      </p>
      <div className="guide-grid">
        {guides.map((g) => (
          <Link key={g.slug} className="guide-card" href={`/guides/${g.slug}/`} hidden={!visible.includes(g)}>
            <span className="guide-tag">{g.tag}</span>
            <strong>{g.title}</strong>
            <span>{g.description}</span>
            <em>
              Read the guide{g.minutes ? ` · ${g.minutes} min` : ''} <ArrowIcon />
            </em>
          </Link>
        ))}
      </div>
      {!visible.length && (
        <p className="center muted guides-empty">
          No guide matches. <button type="button" className="link-btn" onClick={() => { setTag('All'); setQuery(''); }}>Show all guides</button>
        </p>
      )}
    </>
  );
}
