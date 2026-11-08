---
title: How to create a Google image sitemap
description: Generate an image sitemap (.xml) of your pages and their images from a scan or a site crawl, then submit it in Google Search Console.
slug: create-a-google-image-sitemap
updated: 2026-11-05
order: 7
tag: Image SEO
minutes: 3
---
An image sitemap tells Google which images appear on which pages. That helps it discover images loaded by JavaScript, lazy-loaded images and images on pages it rarely crawls. Image Scraper Pro builds one for you from a scan or a whole-site crawl.

## Step 1: Collect your pages and images

- **One page:** open it and click **Open scraper**.
- **A whole site:** use **🌐 Bulk scrape & crawl website** and click **Open results in dashboard** when the crawl finishes. **Full render** mode finds images added by JavaScript. See [How to download all images from a website](/guides/download-all-images-from-a-website/).

Filter out anything you don't want listed. For example, use the **Domain** filter to keep only your own images and CDN.

## Step 2: Export the sitemap

Open **Export ▾** and choose **Image sitemap (.xml)**, or click **Image sitemap** in the **Audit** window. The file lists each page with its images:

```
<url>
  <loc>https://example.com/sofas/</loc>
  <image:image>
    <image:loc>https://cdn.example.com/red-leather-sofa.jpg</image:loc>
  </image:image>
</url>
```

Favicons, tracking pixels and inline `data:` images are left out automatically. Following Google's limits, each page lists up to 1,000 images, and very large sites are split into files of 50,000 pages.

## Step 3: Publish and submit it

1. Upload the file to your website, for example as `https://example.com/image-sitemap.xml`.
2. In [Google Search Console](https://search.google.com/search-console), open **Sitemaps**, enter the address and click **Submit**.
3. Optionally, add a line to your `robots.txt`: `Sitemap: https://example.com/image-sitemap.xml`

> **Tip:** Google only uses `image:loc` today (the older caption, title and licence tags are deprecated), so the sitemap keeps to that.

## Improve your images first

A sitemap helps Google find your images, and good alt text and file names help them rank. Run the [image SEO audit](/guides/image-seo-audit-alt-text-checker/) before you submit.
