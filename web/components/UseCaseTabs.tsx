'use client';
// Use-case tabs with the ARIA tabs pattern: arrow keys, Home and End move between tabs.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type UseCase = { id: string; label: string; title: string; text: string; points: ReactNode[] };

export function UseCaseTabs({ cases }: { cases: UseCase[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (i: number, focus = false) => {
    setActive(i);
    if (focus) refs.current[i]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = cases.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(next, true);
  };

  return (
    <div className="tabs">
      <div className="tablist" role="tablist" aria-label="Use cases">
        {cases.map((c, i) => (
          <button
            key={c.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`tab-${c.id}`}
            aria-selected={i === active}
            aria-controls={`panel-${c.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {cases.map((c, i) => (
        <div key={c.id} className="tabpanel" role="tabpanel" id={`panel-${c.id}`} aria-labelledby={`tab-${c.id}`} hidden={i !== active}>
          <div>
            <h3>{c.title}</h3>
            <p>{c.text}</p>
          </div>
          <ul className="tab-points">
            {c.points.map((p, j) => (
              <li key={j}>{p}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
