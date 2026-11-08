// Structured data for search engines. JSON-LD is a data block, not a script, so the CSP doesn't apply to it.
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
