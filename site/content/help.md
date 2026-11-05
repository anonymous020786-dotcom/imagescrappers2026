---
title: Help Center and FAQ
heading: How can we help?
description: Install Image Scraper Pro, fix missing or broken images, understand permissions and privacy, and get answers to common questions.
slug: help
updated: 2026-11-05
---
## Getting started

### How do I install Image Scraper Pro?

Install it from your browser's store: the [Chrome Web Store](/#download) (also for Brave and Vivaldi), Firefox Add-ons or Microsoft Edge Add-ons. Store installs update automatically. For Opera and Safari, download the ZIP from the [download section](/#download) and follow the [install guide](https://github.com/anonymous020786-dotcom/imagescrappers2026/blob/main/DEPLOY.md).

### How do I scrape the images on a page?

Open the page, click the Image Scraper Pro icon in the toolbar and click **Open scraper**. Filter the results, select the images and click **Download** or **Download ZIP**. The full walkthrough is in [How to download all images from a web page](/guides/download-all-images-from-a-web-page/).

### What are the keyboard shortcuts?

`Alt+Shift+I` opens the popup, `Alt+Shift+O` opens the dashboard and `Alt+Shift+D` quick-downloads with your default filters. In the dashboard: `/` search, `Ctrl+A` select all, `Ctrl+C` copy URLs, `D` download, `Z` ZIP, `R` rescan, `Del` remove and `Esc` clear. You can change the browser shortcuts in your browser's extension shortcut settings.

### Where is the side panel?

In Chrome and Edge, click **Open side panel** in the popup: a compact scraper stays beside the page and rescans as you switch tabs. In Firefox, open it from the sidebar menu (View → Sidebar → Image Scraper Pro). Safari has no side panel.

## Troubleshooting

### Why are some images missing?

Try these in order:

1. Click **Reset filters**. A size, type or domain filter may be hiding them.
2. Use **Auto-scroll + scan** in the popup. Many pages only load images as you scroll.
3. Turn on **● Live** mode for pages that keep loading content.
4. Check the options under **What to scan**: CSS backgrounds, iframes, Shadow DOM and others can be switched on or off.

See [How to save lazy-loaded and background images](/guides/save-lazy-loaded-and-background-images/) for the details.

### Why does an image show as broken or fail to download?

Some websites refuse to serve their images to other pages ("hotlink protection"). Turn on **Send the page as Referer (fixes hotlink-protected images)** in the options: the extension then requests each image as if from its own page. Images that still fail are retried automatically and listed in `failed-urls.txt` inside ZIP downloads.

### It says "No access to this tab". What do I do?

By default, the extension can only read the tab where you click its icon. Click the Image Scraper Pro icon while you're on the page you want, or choose **Allow access to all sites** when asked. Some features need that access to fetch images from other sites: Analyze, ZIP, conversion, duplicate detection, all tabs and the crawler. You can remove it at any time in the options under **Site access**.

### Why can't it scan this page?

Browsers don't let any extension read their own pages, such as `chrome://` and `about:` pages, settings, the new-tab page and the extension stores themselves. Open a normal website and try again.

### Why are the downloaded files named image(1).jpg?

The site gives many images the same name. Set a **File name template** in the options, for example `{pagedomain}/{index:3}-{name}`, and use **Names…** in the dashboard to preview the names first. See [Download images as a ZIP with your own file names](/guides/download-images-as-zip/).

### The crawler stopped or skipped pages. Why?

The crawler respects `robots.txt` by default, so pages a site disallows are skipped. Check the link depth, scope, page limit and the include and exclude patterns. If pages are built by JavaScript, switch to **Full render** mode. See [How to download all images from a website](/guides/download-all-images-from-a-website/).

## Privacy and permissions

### Does Image Scraper Pro collect my data?

No. Everything runs in your browser: scanning, editing, metadata removal, the SEO audit, PDFs and collections. The extension has no analytics or tracking, and it sends nothing to the developer. Only reverse image search, when you click it, opens the search engine you pick. Read the [privacy policy](/privacy/).

### Why does it ask for access to all sites?

Images are usually served from other domains (CDNs). To measure, convert, de-duplicate or ZIP them, or to crawl pages, the extension has to fetch them. Chrome, Edge, Brave, Opera and Vivaldi ask for this the first time you use such a feature, and you can remove it in the options. Firefox and Safari let you manage site access in the browser's own settings.

### Where are my settings, history and collections stored?

On your device, in the browser's extension storage. If you use your browser's sync, your settings (not your history or collections) follow you to your other devices. You can export and import settings, and back up collections to a file.

## More questions

### Is Image Scraper Pro free?

Yes. It's free and open source under the GPL-3.0 licence, with no account, no ads and no paid tier.

### Which browsers are supported?

Chrome, Microsoft Edge, Brave, Opera, Vivaldi, Firefox (desktop and Android, version 121+) and Safari 16.4+ on macOS, all built from the same Manifest V3 code.

### Can I use the images I download?

That depends on each image's licence and the website's terms. The extension shows the creator, credit and licence a page or file states, and records each image's source in ZIP downloads, but that isn't legal advice. Please respect copyright.

### How do I report a bug or request a feature?

Open an issue on [GitHub](https://github.com/anonymous020786-dotcom/imagescrappers2026/issues). Include your browser and version, the page address if you can share it, and what you expected to happen.
