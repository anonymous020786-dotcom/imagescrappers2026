// The site is exported as static files (out/) and served by Netlify; see ../netlify.toml.
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true, // /guides/<slug>/ like the canonical URLs and the sitemap
  // next/image through a custom loader: the Netlify Image CDN in production (see lib/image-loader.ts).
  images: {
    loader: 'custom',
    loaderFile: './lib/image-loader.ts',
    // The screenshots are 1280px wide, so larger variants would only be upscaled copies.
    deviceSizes: [640, 828, 1080, 1280],
    imageSizes: [48, 96, 256, 384],
  },
  poweredByHeader: false,
};

export default nextConfig;
