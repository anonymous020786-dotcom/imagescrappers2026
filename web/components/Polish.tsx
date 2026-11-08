'use client';
// Small touches: floating scroll controls and stat numbers that count up when they come into view.
import { useEffect, useRef, useState } from 'react';

// Floating scroll controls: "Back to top" with a ring that fills as you read, and "Next section", which jumps to
// the next heading below the fold (or the end of the page). Each button appears only when it would do something.
const HEADER_OFFSET = 88;
const smooth = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

function nextSectionTop() {
  const targets = document.querySelectorAll<HTMLElement>('main section[id], main h2[id], main .fx-group, footer');
  for (const el of targets) {
    const top = el.getBoundingClientRect().top;
    if (top > HEADER_OFFSET + 24) return window.scrollY + top - HEADER_OFFSET;
  }
  return document.documentElement.scrollHeight;
}

export function ScrollControls() {
  const [state, setState] = useState({ up: false, down: false, progress: 0 });
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      const next = { up: y > Math.min(600, window.innerHeight * 0.8), down: max > 200 && y < max - 160, progress: max > 0 ? Math.min(1, y / max) : 0 };
      setState((s) => (s.up === next.up && s.down === next.down && Math.abs(s.progress - next.progress) < 0.004 ? s : next));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule); // content that grows (filters, accordions) changes the page height
    ro.observe(document.body);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const R = 20;
  const C = 2 * Math.PI * R;
  return (
    <div className="scroll-ctl" data-show={state.up || state.down ? 'true' : undefined}>
      <button
        type="button"
        className="scroll-btn"
        data-show={state.up ? 'true' : undefined}
        aria-label={`Back to top (${Math.round(state.progress * 100)}% read)`}
        title="Back to top"
        tabIndex={state.up ? 0 : -1}
        aria-hidden={!state.up}
        onClick={() => window.scrollTo({ top: 0, behavior: smooth() })}
      >
        <svg className="scroll-ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r={R} />
          <circle cx="22" cy="22" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - state.progress)} />
        </svg>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
      <button
        type="button"
        className="scroll-btn"
        data-show={state.down ? 'true' : undefined}
        aria-label="Scroll to the next section"
        title="Next section"
        tabIndex={state.down ? 0 : -1}
        aria-hidden={!state.down}
        onClick={() => window.scrollTo({ top: nextSectionTop(), behavior: smooth() })}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </button>
    </div>
  );
}

// Renders the final value on the server (so it's in the HTML for search engines), then counts up once visible.
export function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const m = /^(\d+)(.*)$/.exec(value);
    const el = ref.current;
    if (!m || !el || matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const target = Number(m[1]);
    const suffix = m[2];
    if (target < 2) return;
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 1100);
        const eased = 1 - (1 - t) ** 3;
        setShown(`${Math.round(target * eased)}${suffix}`);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      setShown(`0${suffix}`);
      raf = requestAnimationFrame(step);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return (
    <strong ref={ref} className="grad-text" aria-label={value}>
      {shown}
    </strong>
  );
}
