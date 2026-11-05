---
title: Download images as a ZIP with your own file names
description: Bulk download images as one ZIP or as files named your way, with templates like {domain}/{index:3}, automatic ZIP splitting, retries and a sources list.
slug: download-images-as-zip
updated: 2026-11-05
order: 3
tag: Downloading
minutes: 4
---
Hundreds of files called `image.jpg`, `image(1).jpg` and `image(2).jpg` are hard to work with. Image Scraper Pro saves images with meaningful names and folders, or packs everything into a single ZIP.

## Download as a ZIP

1. Scan a page and open the dashboard (see [How to download all images from a web page](/guides/download-all-images-from-a-web-page/)).
2. Filter the list, then click **Select all** or click the images you want.
3. Click **Download ZIP**.

The ZIP is built on your device. Very large selections are split into parts automatically (the part size is configurable), so there's no overall size limit. Images that fail to download are listed in `failed-urls.txt` inside the ZIP, and a `sources.csv` file records where each image came from.

## Name files and folders with templates

Open the options (⚙) and set the **File name template**, **Folder template (inside your Downloads folder)** and **ZIP file name template**. The available fields:

| Field | Becomes |
| --- | --- |
| `{name}` | the original file name |
| `{index:3}` | a counter padded to 3 digits: 001, 002… |
| `{domain}` / `{pagedomain}` | the image's site / the page's site |
| `{title}` | the page title |
| `{date}` `{time}` `{timestamp}` | when you downloaded |
| `{width}` `{height}` | the image size in pixels |
| `{alt}` | the image's alt text |
| `{type}` `{source}` | the file type, and where it was found (img, CSS…) |

For example, a folder template of `{pagedomain}/{date}` with a file template of `{index:3}-{name}` gives `example.com/2026-11-05/001-sunset.jpg`.

> **Tip:** Click **Names…** in the dashboard to preview the final file names before downloading. Name clashes are flagged so nothing gets overwritten by accident.

## Reliable large downloads

- **Parallel downloads with a limit:** downloads run a few at a time, with a progress bar, **Pause** and **Cancel**.
- **Automatic retries:** failed images are retried with increasing waits.
- **Rate limiting:** add a delay between downloads to avoid being blocked by the site.
- **Skip previously downloaded images:** a download log on your device remembers what you saved before.

## Other export formats

The **Export ▾** menu saves the list instead of the files: a URL list (.txt), a spreadsheet (.csv), metadata (.json), a standalone HTML gallery, a PDF document with one image per page, a contact sheet, or a Google image sitemap. **Copy URLs** copies the selected addresses to the clipboard.
