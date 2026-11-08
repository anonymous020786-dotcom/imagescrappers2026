import Link from 'next/link';
import { REPO, hrefFor } from '@/lib/site';
import { ThemeSwitch } from './Theme';

const COLUMNS: { title: string; links: { href: string; label: string; dl?: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#seo', label: 'Image SEO audit' },
      { href: '/#download', label: 'Download' },
      { href: '/guides/', label: 'Guides' },
      { href: '/help/', label: 'Help Center' },
      { href: '/#faq', label: 'FAQ' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: REPO, label: 'GitHub' },
      { href: `${REPO}/blob/main/DEPLOY.md`, label: 'Install guide' },
      { href: `${REPO}/releases`, label: 'Releases' },
      { href: `${REPO}/issues`, label: 'Report an issue' },
    ],
  },
  {
    title: 'Get the extension',
    links: [
      { href: hrefFor('chrome'), label: 'Chrome Web Store', dl: 'chrome' },
      { href: hrefFor('firefox'), label: 'Firefox Add-ons', dl: 'firefox' },
      { href: hrefFor('edge'), label: 'Microsoft Edge Add-ons', dl: 'edge' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy/', label: 'Privacy policy' },
      { href: `${REPO}/blob/main/LICENSE`, label: 'GPL-3.0 licence' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <Link className="brand" href="/">
              <img src="/assets/icon128.png" alt="" width={34} height={34} loading="lazy" />
              Image Scraper Pro
            </Link>
            <p style={{ marginTop: 14, maxWidth: 360 }}>The free, open-source image downloader and image SEO audit for every major browser.</p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href.startsWith('/') ? (
                      <Link href={l.href}>{l.label}</Link>
                    ) : (
                      <a href={l.href} data-dl={l.dl}>
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="foot-bottom">
          <span>© {new Date().getFullYear()} Image Scraper Pro · Please respect copyright when downloading images.</span>
          <ThemeSwitch />
        </div>
      </div>
    </footer>
  );
}
