'use client';
// Browser-aware install buttons: the page is pre-rendered for Chrome, then adapts to the visitor's browser after
// loading, so Firefox users see "Add to Firefox", Edge users the Edge store, and so on.
import { useEffect, useState, type ReactNode } from 'react';
import type { Browser } from '@/lib/site';
import { DownloadIcon } from './Icons';

type NavigatorWithHints = Navigator & { userAgentData?: { brands?: { brand: string }[]; mobile?: boolean }; brave?: { isBrave?: () => Promise<boolean> } };

export async function detectBrowser(): Promise<Browser | null> {
  const nav = navigator as NavigatorWithHints;
  const ua = nav.userAgent;
  const brands = (nav.userAgentData?.brands ?? []).map((b) => b.brand).join(' ');
  if (/iPhone|iPad|iPod/.test(ua)) return null; // Safari extensions here are macOS only
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua) || /Microsoft Edge/.test(brands)) return 'edge';
  if (/OPR\//.test(ua) || /Opera/.test(brands)) return 'opera';
  if (/Vivaldi/.test(ua)) return 'vivaldi';
  try {
    if (await nav.brave?.isBrave?.()) return 'brave';
  } catch {
    /* not Brave */
  }
  if (/Chrome\//.test(ua) || /Google Chrome|Chromium/.test(brands)) return 'chrome';
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return 'safari';
  return null;
}

function useVisitorBrowser() {
  const [browser, setBrowser] = useState<Browser | null>(null);
  useEffect(() => {
    let alive = true;
    detectBrowser().then((b) => alive && setBrowser(b));
    return () => {
      alive = false;
    };
  }, []);
  return browser;
}

export type InstallOption = { id: Browser; name: string; href: string; cta: string };

// The hero's main button: "Add to Chrome" by default, the visitor's own browser once known.
export function HeroInstallButton({ options, fallback, children }: { options: InstallOption[]; fallback: Browser; children?: ReactNode }) {
  const visitor = useVisitorBrowser();
  const pick = options.find((o) => o.id === visitor) ?? options.find((o) => o.id === fallback)!;
  // Store links say "Add to X"; ZIP downloads say "Download for X".
  const label = pick.cta.startsWith('Download') ? `Download for ${pick.name}` : pick.cta.replace(/ →$/, '');
  return (
    <a className="btn btn-primary" href={pick.href} data-dl={pick.id}>
      <DownloadIcon />
      {label} <small>· free</small>
      {children}
    </a>
  );
}

// "Also on …" under the hero button: the other main browsers, never the one the button already offers.
export function AlsoOn({ options }: { options: InstallOption[] }) {
  const visitor = useVisitorBrowser();
  const main: Browser = visitor && options.some((o) => o.id === visitor) ? visitor : 'chrome';
  const others = (['chrome', 'firefox', 'edge'] as Browser[]).filter((b) => b !== main).map((b) => options.find((o) => o.id === b)!);
  return (
    <p className="also-on">
      Also on{' '}
      {others.map((o) => (
        <span key={o.id}>
          <a href={o.href} data-dl={o.id}>
            {o.id === 'edge' ? 'Microsoft Edge' : o.name}
          </a>{' '}
          ·{' '}
        </span>
      ))}
      <a href="#download">more browsers</a>
    </p>
  );
}

// Marks the visitor's browser in the download grid ("Recommended for you").
export function VisitorBrowserMarker() {
  const visitor = useVisitorBrowser();
  useEffect(() => {
    if (!visitor) return;
    const grid = document.querySelector('.dl-grid');
    const card = grid?.querySelector<HTMLElement>(`.dl[data-dl="${visitor}"]`);
    if (!grid || !card) return;
    grid.querySelectorAll('.dl.featured').forEach((el) => el.classList.remove('featured'));
    card.classList.add('featured', 'yours');
    const badge = document.createElement('span');
    badge.className = 'yours-badge';
    badge.textContent = 'Recommended for you';
    card.prepend(badge);
    return () => badge.remove();
  }, [visitor]);
  return null;
}
