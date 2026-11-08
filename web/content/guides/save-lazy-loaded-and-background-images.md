---
title: How to save lazy-loaded and background images
description: Find images that right-click can't save: srcset originals, lazy-loaded photos, CSS backgrounds, SVG, canvas, Shadow DOM and iframes, at the highest resolution.
slug: save-lazy-loaded-and-background-images
updated: 2026-11-05
order: 4
tag: Detection
minutes: 4
---
Modern websites rarely show images with a plain `<img src>`. Photos load only when you scroll, the best version hides in `srcset`, and hero images are often CSS backgrounds. That's why "Save image as…" is missing or saves a tiny thumbnail. Here's how Image Scraper Pro finds the real files.

## Get the highest resolution

Responsive images list several sizes in `srcset`, and the browser shows whichever fits your screen. With **Prefer the highest resolution in srcset** (on by default in the options), Image Scraper Pro picks the largest candidate, using both `w` and `x` descriptors, and `<picture>` sources are included too.

> **Tip:** Click **Analyze** in the dashboard to fetch each image and show its true pixel size, file size and real format. Then sort by resolution to find the best copies.

## Lazy-loaded images

Lazy-loading puts a tiny placeholder in `src` and the real address in an attribute like `data-src`, `data-original`, `data-lazy-src` or `data-srcset`. Image Scraper Pro reads more than 20 of these attributes and skips the placeholders automatically.

On pages that load content as you scroll (infinite scroll), use **Auto-scroll + scan** from the popup. To always do this, turn on **Always auto-scroll before scanning** in the options. For pages that keep changing, **● Live** mode adds new images as they appear.

## CSS background images

Banners, cards and sliders often use CSS backgrounds that can't be right-clicked. With **CSS background, border and mask images** enabled, the scan reads every element's computed style, including `::before` and `::after` pseudo-elements, `border-image`, `mask-image` and `list-style-image`.

## SVG, canvas and video posters

- Inline `<svg>` graphics are exported as standalone `.svg` files.
- `<canvas>` drawings are exported as PNG (when the browser allows it).
- **Video poster frames** are included as images.

## Images hidden in components and frames

- **Inside Shadow DOM (web components):** open shadow roots are searched too.
- **Inside iframes:** every frame on the page is scanned and the results are merged.
- **Images loaded by scripts:** images the page fetched that aren't in the page any more are found through the browser's resource timing data.
- **Open Graph, Twitter, JSON-LD and favicons:** sharing images and structured-data images are included.

## Scrape just one part of a page

Click **⌖ Pick area**, then click a section of the page, such as a product gallery. Only images inside it are collected. Press ↑ to select the parent element if your click was too narrow.
