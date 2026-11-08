---
title: How to download all images from a web page
description: Save every image on a page in a few clicks, at full resolution, as separate files or one ZIP, with filters to skip icons and tracking pixels.
slug: download-all-images-from-a-web-page
updated: 2026-11-05
order: 1
tag: Getting started
minutes: 4
---
Right-clicking images one by one is slow, and it misses most of them: lazy-loaded photos, CSS backgrounds and images inside slideshows never show a "Save image" option. Image Scraper Pro scans the whole page at once and lets you save exactly the images you want.

## Before you start

Install Image Scraper Pro from your browser's store: [Chrome, Firefox or Edge](/#download). It's free, needs no account and runs entirely in your browser.

## Step 1: Scan the page

1. Open the page with the images you want.
2. Click the **Image Scraper Pro** icon in the toolbar (or press `Alt+Shift+I`). The popup shows how many images it found and the largest ones.
3. Click **Open scraper** to open the full dashboard for that page (or press `Alt+Shift+O` from the page).

> **Tip:** On long pages that load more images as you scroll, click **Auto-scroll + scan** in the popup instead. The extension scrolls the page for you, collects everything, and returns to where you were.

![The Image Scraper Pro dashboard listing every image found on a page, with filters in the sidebar](/assets/screenshot-1.png)

## Step 2: Keep only the images you want

The sidebar filters update the counts live:

- **Dimensions:** use the presets (≥100, ≥300, ≥800, HD) to drop icons and thumbnails, or type a minimum width and height.
- **File type:** keep only JPG, PNG, WebP, SVG, GIF or AVIF.
- **Found in:** keep only real `<img>` photos, or only CSS backgrounds, SVGs and so on.
- **Domain:** keep images from one CDN or website.
- **Search:** match words in the image address, alt text or title.

Tracking pixels (images of 2×2 pixels or less) and common ad and analytics images are hidden automatically.

## Step 3: Select and download

1. Click **Select all**, or click images to pick them (Shift+click selects a range).
2. Click **Download** to save them as separate files, or **Download ZIP** to get one archive.

Files go to your normal Downloads folder. To control file and folder names, set a template in the options, such as `{domain}/{index:3}-{name}`. See [Download images as a ZIP with your own file names](/guides/download-images-as-zip/).

## Quick download in one click

If you always want the same kind of images, set your default filters in the options, then use **Quick download all** in the popup (or `Alt+Shift+D`). It downloads every image that passes your filters without opening the dashboard.

## Troubleshooting

- **Fewer images than expected?** Use **Auto-scroll + scan**, and check that the filters aren't hiding them (click **Reset filters**). Images added later can be caught with **● Live** mode.
- **Images from a gallery behind a login?** Requests use your normal browser session, so pages you can see while signed in can be scraped.
- **An image shows as broken?** Some sites block images requested from elsewhere. Turn on **Send the page as Referer** in the options. See the [Help Center](/help/) for more fixes.
