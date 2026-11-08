'use client';
// The full feature list with instant search and category chips. Everything is rendered into the static HTML,
// so search engines see every feature; filtering only hides cards in the browser.
import { useDeferredValue, useMemo, useState } from 'react';
import type { FeatureGroup } from '@/lib/features';

export function FeatureExplorer({ groups }: { groups: FeatureGroup[] }) {
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<string | null>(null);
  const q = useDeferredValue(query.trim().toLowerCase());
  const words = useMemo(() => q.split(/\s+/).filter(Boolean), [q]);
  const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));

  const visible = groups
    .filter((g) => !only || g.id === only)
    .map((g) => ({ ...g, features: g.features.filter((f) => matches(`${g.name} ${f.text}`)) }))
    .filter((g) => g.features.length);
  const shown = visible.reduce((n, g) => n + g.features.length, 0);
  const total = groups.reduce((n, g) => n + g.features.length, 0);

  return (
    <div className="fx">
      <div className="fx-bar" role="search">
        <label className="fx-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">Search features</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${total} features, e.g. “ZIP”, “WebP”, “alt text”`}
            autoComplete="off"
          />
        </label>
        <p className="fx-count" aria-live="polite">
          {shown === total ? `${total} features` : `${shown} of ${total} features`}
        </p>
        <div className="fx-chips" role="group" aria-label="Show one category">
          <button type="button" aria-pressed={!only} onClick={() => setOnly(null)}>
            All
          </button>
          {groups.map((g) => (
            <button key={g.id} type="button" aria-pressed={only === g.id} onClick={() => setOnly(only === g.id ? null : g.id)}>
              {g.name.replace(/:.*$/, '')}
              {g.isNew && <span className="fx-new">New</span>}
            </button>
          ))}
        </div>
      </div>

      {visible.map((g) => (
        <section key={g.id} id={g.id} className="fx-group" aria-labelledby={`${g.id}-title`}>
          <header className="fx-head">
            <span className="fx-num">{String(groups.findIndex((x) => x.id === g.id) + 1).padStart(2, '0')}</span>
            <div>
              <h2 id={`${g.id}-title`}>
                {g.name}
                {g.isNew && <span className="fx-new">New in 1.7</span>}
              </h2>
              {g.note && <p className="fx-note">{g.note}</p>}
              {g.intro && <p className="fx-intro">{g.intro}</p>}
            </div>
          </header>
          <ol className="fx-grid">
            {g.features.map((f) => (
              <li key={f.n} className="fx-card" id={`feature-${f.n}`}>
                <span className="fx-badge" aria-hidden="true">
                  {f.n}
                </span>
                <h3 dangerouslySetInnerHTML={{ __html: f.titleHtml }} />
                {f.html && <p dangerouslySetInnerHTML={{ __html: f.html }} />}
              </li>
            ))}
          </ol>
        </section>
      ))}

      {!visible.length && (
        <p className="fx-empty">
          No feature matches “{query}”. Try a shorter word, or <button type="button" onClick={() => { setQuery(''); setOnly(null); }}>show all features</button>.
        </p>
      )}
    </div>
  );
}
