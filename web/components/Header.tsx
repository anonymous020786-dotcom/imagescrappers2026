'use client';
import Image from 'next/image';
import Link from 'next/link';
import icon from '@/public/assets/icon128.png';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GithubIcon, MenuIcon } from './Icons';
import { SearchButton } from './Search';
import { ThemeToggle } from './Theme';

const REPO = 'https://github.com/anonymous020786-dotcom/imagescrappers2026';
const LINKS = [
  { href: '/features/', label: 'Features' },
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
          <Image src={icon} alt="" width={34} height={34} preload />
          Image Scraper Pro
        </Link>
        <ul className="nav-links" id="nav-links">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={!l.href.includes('#') && pathname?.startsWith(l.href) ? 'page' : undefined}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="nav-cta">
          <SearchButton />
          <ThemeToggle />
          <a className="btn btn-sm gh" href={REPO} rel="noopener" aria-label="Image Scraper Pro on GitHub" title="Source code on GitHub">
            <GithubIcon />
            <span className="gh-label">GitHub</span>
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
