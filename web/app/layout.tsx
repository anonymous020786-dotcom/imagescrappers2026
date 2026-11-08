import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Enhancements } from '@/components/Enhancements';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { BackToTop } from '@/components/Polish';
import { SearchPalette } from '@/components/Search';
import { getSearchIndex } from '@/lib/search';
import { SITE_NAME, siteUrl, verification } from '@/lib/site';
import './globals.css';

// Self-hosted at build time: no requests to Google Fonts.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${SITE_NAME} – Free Bulk Image Downloader Extension`, template: `%s – ${SITE_NAME}` },
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  robots: { index: true, follow: true, 'max-image-preview': 'large' },
  icons: {
    icon: [
      { url: '/assets/icon32.png', sizes: '32x32', type: 'image/png' },
      { url: '/assets/icon128.png', sizes: '128x128', type: 'image/png' },
    ],
    apple: '/assets/icon128.png',
  },
  manifest: '/site.webmanifest',
  openGraph: {
    siteName: SITE_NAME,
    locale: 'en_US',
    images: [{ url: '/assets/og-image.png', width: 1200, height: 630, alt: 'Image Scraper Pro: find, filter and bulk-download every image on any page' }],
  },
  twitter: { card: 'summary_large_image', images: ['/assets/og-image.png'] },
  verification: {
    google: verification.google || undefined,
    other: verification.bing ? { 'msvalidate.01': verification.bing } : undefined,
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0916' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // theme.js sets data-theme and the "js" class before React hydrates.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Runs before the first paint so the saved theme never flashes. */}
        <script src="/theme.js" />
        {/* Google Tag Manager: the data layer first, then the container. */}
        <script src="/analytics.js" />
        <script async src="https://www.googletagmanager.com/gtm.js?id=GTM-KKDJ4GW4" />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <SearchPalette index={getSearchIndex()} />
        <BackToTop />
        <Enhancements />
      </body>
    </html>
  );
}
