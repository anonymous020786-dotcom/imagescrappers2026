# Chrome Web Store submission: Image Scraper Pro

Everything the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) asks for, ready to copy.
Upload `dist/image-scraper-pro-chrome-<version>.zip` (built with `npm run build:chrome`).

---

## 1. Package

- **File:** `dist/image-scraper-pro-chrome-<version>.zip` (manifest at the zip root, Manifest V3). Version 1.1.0 was the first submission.
- The name, summary and icon come from the package: **Image Scraper Pro**. The summary is the manifest
  description, localized in English, German, Spanish and French.

## 2. Store listing tab

**Description** (paste as-is):

```
Image Scraper Pro finds every image on a web page and lets you filter, preview and download exactly the ones you want, one at a time or all at once as a ZIP.

FINDS IMAGES OTHER TOOLS MISS
• <img>, the highest-resolution srcset candidate, <picture> sources and lazy-loaded images (data-src and 20+ other attributes)
• CSS backgrounds, ::before/::after images, inline SVG and <canvas> (exported as files), video posters
• Open Graph, Twitter card and JSON-LD images, favicons, and links to image files
• Shadow DOM and iframes, plus auto-scroll for infinite-scroll pages and a live mode for pages that keep changing
• Pick area: scrape only the part of the page you click

FILTER AND SORT
• Width, height, shape, file type, file size, domain and "found in" filters with live counts
• Search URLs, alt text and titles (regular expressions supported)
• Tracking pixels and ad/analytics images hidden automatically
• Sort by resolution, size, name, type or page order

PREVIEW AND ANALYZE
• Lightbox with zoom, pan and full details (dimensions, type, size, colour, alt text, source)
• Analyze exact file sizes and real types, find visual duplicates, see each image's main colour
• Copy an image or its URL, open it, jump to it on the page, or run a reverse image search

DOWNLOAD YOUR WAY
• Bulk download with progress, pause, resume and cancel, or one ZIP (split into parts for huge sets)
• File-name and folder templates: {domain} {title} {index:3} {width} {height} {date} and more
• Convert to PNG, JPEG or WebP
• Skip images you already downloaded
• Export the list as TXT, CSV, JSON or an HTML gallery

BULK SCRAPER AND WEBSITE CRAWLER
• Paste thousands of page or image URLs, or crawl a site by following links, pagination and sitemap.xml
• Include/exclude patterns, depth, speed and delay controls; respects robots.txt
• URL pattern generator, e.g. photo[001-500].jpg

WORKS EVERYWHERE
• Pages behind your own login (uses your normal browser session)
• Image hosts that only serve images when the request comes from their own site
• Non-English sites and legacy text encodings
• Right-click menus, keyboard shortcuts (Alt+Shift+I / O / D), a toolbar badge with the image count
• Light and dark themes; settings sync across your devices

PRIVATE BY DESIGN
Everything runs in your browser. No account, no analytics, no tracking, no ads, and nothing is sent to the developer. Open source: https://github.com/anonymous020786-dotcom/imagescrappers2026

Please respect website terms and copyright when downloading images.
```

**Category:** Productivity → Tools. If the dashboard shows the older category list, choose **Productivity**.

**Language:** English. The package also includes German, Spanish and French.

**Graphic assets** (all in `store/chrome/`):

| Field | File | Size |
| --- | --- | --- |
| Store icon | `src/icons/icon128.png` | 128×128 |
| Screenshots (upload in this order) | `screenshot-1.png` … `screenshot-5.png` | 1280×800 |
| Small promo tile (required) | `promo-small.png` | 440×280 |
| Marquee promo tile (optional) | `promo-marquee.png` | 1400×560 |

Screenshot captions, if the dashboard asks for them:
1. Every image on the page, with filters and live counts
2. Select, analyze exact sizes and filter by resolution
3. Full-size preview with every detail
4. Crawl a whole website for images
5. One-click popup with the page's largest images

**Official URL:** leave empty (it needs a verified domain).
**Homepage URL:** `https://github.com/anonymous020786-dotcom/imagescrappers2026`
**Support URL:** `https://github.com/anonymous020786-dotcom/imagescrappers2026/issues`
**Mature content:** No.

## 3. Privacy tab

**Single purpose** (paste):

```
Find the images on web pages the user chooses and let the user filter, preview and download them.
```

**Permission justifications** (one box per permission):

| Permission | Justification to paste |
| --- | --- |
| `activeTab` | Lets the user scan the current tab for images when they open the popup or press the shortcut. |
| `scripting` | Injects the image scanner into the page (and its frames) the user chooses to scan, to find img, srcset, CSS background, SVG and canvas images. |
| `downloads` | Saves the images and ZIP files the user selects, using the user's file-name and folder settings. |
| `contextMenus` | Adds right-click items such as "Download image", "Download all images on this page" and "Crawl this website for images". |
| `storage` | Stores the user's settings, scan history and download log locally (settings in storage.sync so they follow the user's browser profile). |
| `unlimitedStorage` | Bulk scrapes and scan history can hold tens of thousands of image URLs (including inline data: images), which exceeds the default 10 MB local storage quota. |
| `tabs` | Reads the URL and title of tabs so images can be named after the page, all tabs in a window can be scanned at once, and the toolbar badge shows each page's image count. |
| `clipboardWrite` | Copies selected image URLs, or an image itself, to the clipboard when the user clicks Copy. |
| `declarativeNetRequestWithHostAccess` | Some image hosts refuse requests that don't come from their own site. For the extension's own image requests only, a session rule sends the address of the page the image was found on as the Referer, so the image the user sees on that page can be previewed and downloaded. |
| Host permission `<all_urls>` (optional since 1.2.0) | Requested at runtime, only when the user first uses a feature that needs it; until then the extension works through activeTab on the tab the user invokes it on. The user can scan images on any website, and those features must fetch the images (often from a different CDN domain) to measure, convert, de-duplicate and ZIP them. The bulk scraper and crawler also fetch pages the user lists. Nothing is fetched unless the user starts it. |

**Are you using remote code?** No. All JavaScript is included in the package.

**Data usage:** tick **none** of the data types. The extension reads page content only locally, to find images,
and never sends user data to the developer or third parties. Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:**
`https://github.com/anonymous020786-dotcom/imagescrappers2026/blob/main/PRIVACY.md`

## 4. Distribution tab

- **Payments:** Free
- **Visibility:** Public. Choose **Unlisted** instead to test with a link before going public.
- **Regions:** All regions

## 5. Test instructions tab (for the reviewer)

```
No account or setup is needed. Open any page with pictures (for example https://unsplash.com), click the Image Scraper Pro toolbar icon, then "Open scraper". Select images and click Download or Download ZIP. The bulk scraper/crawler is under "Bulk & crawl".
```

## 6. Submit

Click **Submit for review**. You can let the dashboard publish automatically when the review passes. First
reviews usually take a few days. Extensions with host access to all sites may get a more thorough review, which
can take longer.

After the first version is live, later versions can be published automatically by pushing a version tag. See
"Part 3: automated releases (CI/CD)" and "Store secrets" in [DEPLOY.md](../../DEPLOY.md).
