'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GithubIcon, MenuIcon } from './Icons';
import { ThemeToggle } from './Theme';

const REPO = 'https://github.com/anonymous020786-dotcom/imagescrappers2026';
const LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#use-cases', label: 'Use cases' },
  { href: '/#seo', label: 'SEO audit' },
  { href: '/guides/', label: 'Guides' },
  { href: '/help/', label: 'Help' },
  { href: '/#download', label: 'Download' },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <header className={`site-header${scrolled ? ' scrolled' : ''}`} id="top">
      <nav className={`wrap nav${open ? ' open' : ''}`} aria-label="Main">
        <Link className="brand" href="/" aria-label="Image Scraper Pro home">
          <img src="/assets/icon128.png" alt="" width={34} height={34} />
          Image Scraper Pro
        </Link>
        <ul className="nav-links" id="nav-links">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="nav-cta">
          <ThemeToggle />
          <a className="btn btn-sm gh" href={REPO} rel="noopener">
            <GithubIcon />
            GitHub
          </a>
          <Link className="btn btn-sm btn-primary" href="/#download">
            Get it free
          </Link>
          <button
            className="icon-btn menu-btn"
            type="button"
            aria-expanded={open}
            aria-controls="nav-links"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <MenuIcon />
          </button>
        </div>
      </nav>
    </header>
  );
}
