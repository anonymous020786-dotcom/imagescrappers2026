---
title: Image SEO audit: check alt text and file names
description: Find missing or weak alt text, non-descriptive file names, missing og:image, oversized files and lazy-loading mistakes on any page, or across a whole site.
slug: image-seo-audit-alt-text-checker
updated: 2026-11-05
order: 6
tag: Image SEO
minutes: 5
---
Images bring traffic from Google Images, make your links look good when shared, and slow pages down when they're too large. The **Image audit & SEO** in Image Scraper Pro checks all of this for any page, or every page of a site, and suggests a fix for each finding.

## Run the audit on a page

1. Open the page and click **Open scraper** in the popup.
2. Click **Audit** in the dashboard.
3. Click a finding type to filter the list, and click an image to open it in the preview.

## What it checks

### Alt text

Alt text describes an image to screen readers and to search engines. The audit flags:

- **Missing alt text:** no `alt` attribute at all. Use `alt=""` for purely decorative images.
- **Alt text says nothing:** generic words like "image", "photo 3" or "banner", or a file name like `IMG_1234.jpg`.
- **Keyword-stuffed alt text:** the same word repeated three or more times, which can count as spam.
- **Alt text is very long:** over about 125 characters. Put longer descriptions in a caption.
- **Same alt text on several images:** three or more images on a page sharing one description.

### File names

Search engines read file names, so `red-leather-sofa.jpg` says far more than `IMG_20240518_101522.jpg` or `9f86d081884c7d65.jpg`. The audit flags camera defaults, generic names and random hashes, and it reads the real file name behind image CDNs and resizers such as `/_next/image?url=…`.

### Social sharing images

When someone shares your page on Facebook, LinkedIn, X or in a chat app, the preview uses the page's `og:image`. The audit checks that:

- the page declares an `og:image`, not only a `twitter:image`
- the image is at least **1200×630** pixels and close to **1.91:1** (click **Analyze** first to measure it)
- it's served over **https** on https pages

### Structured data

Pages with an image in their JSON-LD (Article, Product, Recipe…) can appear with a picture in rich results. The audit notes pages without one.

### Speed

- **Oversized image:** files more than twice the size they're displayed at, with the estimated saving.
- **Could use a modern format:** large JPEG and PNG files that would be smaller as WebP.
- **Lazy-loading mistakes:** offscreen images that load eagerly, and lazy-loaded images in the first screen.
- **No width/height attributes:** these make the layout jump while images load.

## Audit a whole website

Crawl the site with **🌐 Bulk scrape & crawl website** (see [How to download all images from a website](/guides/download-all-images-from-a-website/)), then click **Audit site**. Pages are ranked by possible savings and findings. Click a page to see its images, and **Export CSV** to share the report with your team or clients.

> **Tip:** Full-render crawls find the most issues. Fast crawls read the HTML without laying it out, so they skip the size and lazy-loading checks.

## Next step: an image sitemap

Once your images are in good shape, help Google find them: [create a Google image sitemap](/guides/create-a-google-image-sitemap/) from the same results.
