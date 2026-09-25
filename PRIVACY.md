# Privacy Policy: Image Scraper Pro

_Last updated: 25 September 2026 (version 1.2.0: access to all sites became optional)_

Image Scraper Pro is a browser extension that finds and downloads images from web pages you choose. It is built to
work entirely inside your browser.

## What the extension does not do

- It does **not** collect, sell, or share any personal information.
- It does **not** send your browsing history, the pages you scan, the images you find, or your settings to the
  developer or to any third party.
- It has **no** analytics, tracking, advertising, or remote code. All of its code ships inside the extension package.

## Data stored on your device

The extension saves the following in your browser's own extension storage, only to make its features work:

| Data | Where | Why |
| --- | --- | --- |
| Your settings (filters, file-name template, download options) | `chrome.storage.sync` | So your preferences are kept. If you use Chrome Sync, your browser syncs them to your own Google account, as it does for any extension settings. The developer cannot access them. |
| Scan history (page URL, title, and the image URLs found) | `chrome.storage.local` | Powers the History view. You can clear it there at any time and limit its size in the options. |
| A list of image URLs you already downloaded | `chrome.storage.local` | Powers the optional "skip images I already downloaded" feature. |
| Results of a bulk scrape or crawl in progress | `chrome.storage.local` | Hands the results from the crawler to the dashboard. |

Removing the extension deletes all of this.

## Network requests

The extension only contacts websites **you** ask it to:

- To read and download images, it requests the pages and image files you scan, crawl, or list. These requests go
  directly from your browser to those websites, with your normal browser cookies, as if you opened them yourself.
- When downloading images from a site that blocks "hotlinking", it tells the browser to send that site's own
  address as the `Referer` header for those image requests only (using `declarativeNetRequest` session rules that
  are removed when the session ends).
- **Reverse image search** is used only when you click it. It opens the image's URL in the search engine you pick
  (Google Lens, Bing, TinEye or Yandex), and that engine's own privacy policy applies.

## Permissions

Each browser permission is used only for the extension's single purpose, finding and downloading images:
reading pages you scan (`activeTab`, `scripting`), saving files (`downloads`), right-click menu items
(`contextMenus`), storing settings and history (`storage`, `unlimitedStorage`), scanning several tabs and naming
files after the page (`tabs`), copying image URLs (`clipboardWrite`), and loading hotlink-protected images
(`declarativeNetRequestWithHostAccess`).

In Chrome and other Chromium browsers, access to all sites is **optional**. The extension asks for it only when you
first use a feature that fetches images or pages from other sites (analyze, ZIP, convert, duplicates, copy image,
all tabs, bulk scraping and crawling). You can allow or remove it at any time on the options page.

## Children

The extension is a general-purpose tool and is not directed at children under 13.

## Changes

Changes to this policy are published in this file, in the extension's public source repository:
<https://github.com/anonymous020786-dotcom/imagescrappers2026>

## Contact

Questions or concerns: open an issue at
<https://github.com/anonymous020786-dotcom/imagescrappers2026/issues>.
