'use client';
// Small touches: a back-to-top button and stat numbers that count up when they come into view.
import { useEffect, useRef, useState } from 'react';

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const update = () => setShow(window.scrollY > window.innerHeight * 1.5);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return (
    <button
      type="button"
      className="back-to-top"
      data-show={show ? 'true' : undefined}
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
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
