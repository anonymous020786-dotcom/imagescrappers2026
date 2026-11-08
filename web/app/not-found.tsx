import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'This page could not be found. Visit the home page, browse the guides or open the Help Center for Image Scraper Pro.',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <section className="doc center" style={{ paddingTop: 96 }}>
      <h1>This page could not be found</h1>
      <p className="lead">The link may be old or mistyped.</p>
      <div className="cta-row" style={{ marginTop: 28, justifyContent: 'center' }}>
        <Link className="btn btn-primary" href="/">
          Go to the home page
        </Link>
        <Link className="btn" href="/guides/">
          Browse the guides
        </Link>
        <Link className="btn" href="/help/">
          Help Center
        </Link>
      </div>
    </section>
  );
}
