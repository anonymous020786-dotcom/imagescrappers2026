'use client';
// Site search: ⌘K / Ctrl+K or "/" opens a dialog over guides, guide sections, Help Center answers and home sections.
// The index is built at compile time (lib/search.ts); matching runs in the browser.
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { SearchEntry } from '@/lib/search';
import { ArrowIcon, SearchIcon } from './Icons';

export const OPEN_SEARCH = 'open-search';
const GROUPS: SearchEntry['group'][] = ['Features', 'Guides', 'Help Center', 'On this site'];
const SUGGESTED = ['download all images', 'ZIP file names', 'alt text', 'WebP', 'not found', 'permissions'];

// Lower case without accents, so "resume" finds "résumé".
const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A query word matches the start of a word ("gps" finds "GPS", not "https").
const startsWord = (hay: string, w: string) => new RegExp(`(^|[^a-z0-9])${escape(w)}`).test(hay);

// Every word of the query must start a word somewhere; matches in titles rank higher.
function score(e: SearchEntry, words: string[]) {
  const title = normalize(e.title);
  const hay = `${title} ${normalize(e.parent ?? '')} ${normalize(e.text)}`;
  let s = 0;
  for (const w of words) {
    if (!startsWord(hay, w)) return 0;
    s += startsWord(title, w) ? (title.startsWith(w) ? 6 : 4) : 1;
  }
  if (!e.parent) s += 1; // a whole guide before one of its sections
  return s;
}

function highlight(text: string, words: string[]): ReactNode {
  if (!words.length) return text;
  const re = new RegExp(`((?<![a-z0-9])(?:${words.map(escape).join('|')}))`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

export function SearchButton() {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  return (
    <button type="button" className="search-trigger" onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH))} aria-label="Search the site" title={mac ? 'Search (⌘K or /)' : 'Search (Ctrl+K or /)'}>
      <SearchIcon />
      <span className="search-trigger-label">Search…</span>
      <kbd className="search-trigger-kbd">{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}

export function SearchPalette({ index }: { index: SearchEntry[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const open = useCallback(() => {
    if (!dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    setActive(0);
    // Focus right away, so the first key typed after opening isn't lost (notably on phones).
    input.current?.focus();
    input.current?.select();
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH, open);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH, open);
    };
  }, [open]);

  const words = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => {
    if (!words.length) return [];
    return index
      .map((e) => ({ e, s: score(e, words) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 24)
      .map((r) => r.e);
  }, [index, words]);
  // Grouped for display; `flat` keeps the keyboard order identical to what is shown.
  const grouped = GROUPS.map((g) => ({ group: g, items: results.filter((r) => r.group === g) })).filter((g) => g.items.length);
  const flat = grouped.flatMap((g) => g.items);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (entry?: SearchEntry) => {
    if (!entry) return;
    close();
    router.push(entry.url);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, flat.length - 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
    else if (e.key === 'Enter') go(flat[active]);
    else if (e.key === 'Escape') close(); // one press closes, instead of first clearing the search box
    else return;
    e.preventDefault();
  };

  let n = -1;
  return (
    <dialog ref={dialog} className="search-dialog" aria-label="Search the site" onClick={(e) => e.target === dialog.current && close()}>
      <div className="search-box">
        <div className="search-input-row">
          <SearchIcon />
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search guides, help and features…"
            aria-label="Search"
            aria-controls="search-results"
            aria-activedescendant={flat.length ? `search-result-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd onClick={close}>Esc</kbd>
        </div>
        <div className="search-results" id="search-results" role="listbox" ref={list}>
          {!words.length && (
            <div className="search-empty">
              <p>Try searching for</p>
              <div className="search-suggestions">
                {SUGGESTED.map((s) => (
                  <button key={s} type="button" onClick={() => setQuery(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {words.length > 0 && !flat.length && (
            <div className="search-empty">
              <p>
                No results for “{query}”. Try fewer words, or ask in the <a href="/help/">Help Center</a>.
              </p>
            </div>
          )}
          {grouped.map(({ group, items }) => (
            <div key={group} className="search-group" role="group" aria-label={group}>
              <div className="search-group-title">{group}</div>
              {items.map((r) => {
                n++;
                const i = n;
                return (
                  <a
                    key={r.url}
                    id={`search-result-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    className={`search-result${i === active ? ' active' : ''}`}
                    href={r.url}
                    onMouseMove={() => setActive(i)}
                    onClick={(e) => {
                      e.preventDefault();
                      go(r);
                    }}
                  >
                    <span className="search-result-body">
                      {r.parent && <span className="search-result-parent">{r.parent}</span>}
                      <strong>{highlight(r.title, words)}</strong>
                      <span className="search-result-text">{highlight(r.text, words)}</span>
                    </span>
                    <ArrowIcon />
                  </a>
                );
              })}
            </div>
          ))}
        </div>
        <div className="search-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>↵</kbd> to open</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </dialog>
  );
}
