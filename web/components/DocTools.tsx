'use client';
// Reading tools for the guides and Help Center: a sticky "On this page" sidebar that follows the section you're
// reading, a reading-progress bar, link buttons on headings and copy buttons on code blocks.
import { useEffect, useRef, useState } from 'react';

export type TocItem = { id: string; html: string };

export function TocSidebar({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  useEffect(() => {
    const headings = items.map((i) => document.getElementById(i.id)).filter((h): h is HTMLElement => Boolean(h));
    if (!headings.length) return;
    // The active section is the last heading above the upper third of the screen.
    const update = () => {
      const line = window.innerHeight * 0.3;
      let current = headings[0].id;
      for (const h of headings) if (h.getBoundingClientRect().top - line <= 0) current = h.id;
      setActive(current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items]);
  if (items.length < 2) return null;
  return (
    <nav className="toc-side" aria-label="On this page">
      <strong>On this page</strong>
      <ol>
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className={i.id === active ? 'active' : undefined} aria-current={i.id === active ? 'location' : undefined} dangerouslySetInnerHTML={{ __html: i.html }} />
          </li>
        ))}
      </ol>
      <a className="toc-top" href="#main">
        Back to top ↑
      </a>
    </nav>
  );
}

export function ReadingProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const article = document.querySelector<HTMLElement>('.article');
    const update = () => {
      if (!bar.current || !article) return;
      const rect = article.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.6;
      const done = Math.min(1, Math.max(0, -rect.top / Math.max(total, 1)));
      bar.current.style.transform = `scaleX(${done})`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return <div className="reading-progress" aria-hidden="true"><div ref={bar} /></div>;
}

// Adds "copy link" buttons to h2/h3 and "copy" buttons to code blocks inside .prose (rendered Markdown).
export function ProseTools() {
  const [toast, setToast] = useState('');
  useEffect(() => {
    const prose = document.querySelector('.prose');
    if (!prose) return;
    const added: HTMLElement[] = [];
    const flash = (text: string) => {
      setToast(text);
      window.setTimeout(() => setToast(''), 1800);
    };
    const copy = async (text: string, done: string) => {
      try {
        await navigator.clipboard.writeText(text);
        flash(done);
      } catch {
        flash('Copy failed: select and copy instead');
      }
    };
    for (const h of prose.querySelectorAll<HTMLElement>('h2[id], h3[id]')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'heading-link';
      btn.setAttribute('aria-label', `Copy link to "${h.textContent}"`);
      btn.textContent = '#';
      btn.addEventListener('click', () => {
        history.replaceState(null, '', `#${h.id}`);
        copy(`${location.origin}${location.pathname}#${h.id}`, 'Link copied');
      });
      h.append(btn);
      added.push(btn);
    }
    for (const pre of prose.querySelectorAll<HTMLElement>('pre')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => copy(pre.querySelector('code')?.textContent ?? pre.textContent ?? '', 'Code copied'));
      pre.append(btn);
      added.push(btn);
    }
    return () => added.forEach((el) => el.remove());
  }, []);
  return (
    <div className="toast" role="status" aria-live="polite" data-show={toast ? 'true' : undefined}>
      {toast}
    </div>
  );
}
