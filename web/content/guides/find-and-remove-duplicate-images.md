---
title: How to find duplicate and similar images
description: Detect visually duplicate images even at different sizes or formats, keep the best copy automatically, and find images that look alike.
slug: find-and-remove-duplicate-images
updated: 2026-11-05
order: 9
tag: Organizing
minutes: 3
---
Websites often show the same picture several times: a thumbnail, a medium version and the full-size original, sometimes in different formats. Image Scraper Pro removes exact duplicate addresses automatically, and finds visual duplicates for you.

## Exact duplicates

The same image address found several times (in `<img>`, `srcset` and a CSS background, for example) is listed once. To also merge addresses that differ only by a `?query` string (common with CDNs and cache-busting), enable that option in the settings.

## Visual duplicates

1. Filter the list down to the images you care about.
2. Click **Find duplicates**.

Each image gets a perceptual fingerprint (a _dHash_) that stays the same when an image is resized or re-compressed. Images that look the same are grouped, even if they have different sizes, formats or addresses. You can adjust the sensitivity.

## Keep the best copy

After **Find duplicates**, click **Keep best**. In each group, the largest copy stays selected and the others are deselected. Then download your selection with no repeats.

> **Tip:** Click **Analyze** first, so "largest" uses the real pixel and file sizes rather than the size shown on the page.

## Find similar images

Open any image in the preview and click **Find similar**. The dashboard shows the images that look most like it, closest first. That's useful for finding every variant of a product photo or every shot from the same scene.

## More ways to organize

- **Filter by main colour:** after **Analyze**, keep only red, blue or green images, with live counts.
- **Collections:** save images from any page into named collections (★ Save, or press `S`), add tags and notes, and download them later.
- **Remove:** take images out of the results to keep your selection tidy.
