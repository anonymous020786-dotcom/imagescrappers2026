// The site is exported as static files (out/) and served by Netlify; see ../netlify.toml.
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true, // /guides/<slug>/ like the canonical URLs and the sitemap
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
