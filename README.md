# Image Scraper Pro

[![CI](https://github.com/anonymous020786-dotcom/imagescrappers2026/actions/workflows/ci.yml/badge.svg)](https://github.com/anonymous020786-dotcom/imagescrappers2026/actions/workflows/ci.yml)
[![CodeQL](https://github.com/anonymous020786-dotcom/imagescrappers2026/actions/workflows/codeql.yml/badge.svg)](https://github.com/anonymous020786-dotcom/imagescrappers2026/actions/workflows/codeql.yml)

An advanced, dependency-free image scraper extension for every major browser.
It's built on Manifest V3. Chrome is the primary target, and the same source
builds for **Microsoft Edge, Brave, Opera, Vivaldi, Firefox (desktop and Android)
and Safari**.

It finds images wherever they are on a page: `<img>`, `srcset`, `<picture>`,
lazy-load attributes, CSS backgrounds, pseudo-elements, inline SVG, canvas,
video posters, Shadow DOM and iframes. You can then filter, preview, analyze,
de-duplicate, convert and bulk-download them, individually or as one ZIP file.

## Download a ready-made build

Pre-built packages are committed in [`dist/`](dist). You don't need to build anything:

- **Unpacked folders** to load directly: `dist/chrome`, `dist/edge`, `dist/brave`, `dist/opera`, `dist/vivaldi`, `dist/firefox`, `dist/safari`
- **Store-ready zips**: `dist/image-scraper-pro-<browser>-1.2.0.zip`

See **[DEPLOY.md](DEPLOY.md)** for step-by-step install instructions for every browser and how to publish to each store.
The Chrome Web Store listing (description, permission justifications, screenshots, promo tiles) is ready in
[`store/chrome/`](store/chrome/LISTING.md), and the privacy policy is [PRIVACY.md](PRIVACY.md).

## Build from source

```bash
npm run build          # builds every browser into dist/<browser>/ plus store-ready zips
npm run build:chrome   # or a single target: chrome | edge | brave | opera | vivaldi | firefox | safari
```

| Browser | How to load |
| --- | --- |
| Chrome / Brave / Vivaldi | `chrome://extensions` → enable *Developer mode* → **Load unpacked** → `dist/chrome` |
| Edge | `edge://extensions` → *Developer mode* → **Load unpacked** → `dist/edge` |
| Opera | `opera://extensions` → *Developer mode* → **Load unpacked** → `dist/opera` |
| Firefox (121+) | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `dist/firefox/manifest.json` |
| Safari (16.4+) | On macOS: `xcrun safari-web-extension-converter dist/safari --app-name "Image Scraper Pro"`, then build and run the generated Xcode project |

Store uploads: use `dist/image-scraper-pro-<browser>-<version>.zip`.

## Features (80+)

### Detection: finding every image
1. `<img>` elements, including their natural (intrinsic) dimensions
2. **Highest-resolution pick from `srcset`** (`w` and `x` descriptors)
3. `<picture>` / `<source>` candidates
4. **Lazy-load attributes**: `data-src`, `data-original`, `data-lazy-src`, `data-srcset`, `data-zoom-image` and 20+ more. Tiny `data:` placeholders are skipped automatically
5. **CSS background images**, plus `border-image`, `mask-image` and `list-style-image`
6. `::before` / `::after` pseudo-element images (`background` and `content: url()`)
7. **Inline `<svg>` export** as standalone `.svg` files (keeps `currentColor`)
8. SVG `<image>` elements
9. **`<canvas>` export** to PNG (skips tainted canvases)
10. `<video poster>` frames
11. Links that point to image files (`<a href="…jpg">`)
12. Open Graph / Twitter card / `itemprop` meta images
13. **JSON-LD structured data** images (`image`, `logo`, `thumbnailUrl`)
14. Favicons, Apple touch icons and mask icons, with their declared sizes
15. `<input type="image">`
16. **Shadow DOM traversal** (open shadow roots of web components)
17. **All frames**: scans iframes and merges the results
18. Inline `data:` URI images (optional)
19. **Auto-scroll** loads lazy and infinite-scroll content, then returns to where you were
20. **Live mode**: a `MutationObserver` adds new images as the page changes
21. **Pick area**: click any region of the page to scrape only inside it (↑ selects the parent element)
22. **Scrape all tabs** in the window at once
23. URL de-duplication, with an option to ignore `?query` strings

### Filtering and sorting
24. Min and max width/height, plus presets (≥100, ≥300, ≥800, HD)
25. File-type filter chips with live counts (JPG, PNG, GIF, WebP, SVG, AVIF, BMP, ICO, TIFF)
26. "Found in" filter by source (img, srcset, CSS, SVG, canvas, meta…)
27. Shape filter: landscape, portrait or square
28. File-size filter (KB) after analysis
29. Domain filter with per-domain counts
30. Search across URL, alt text and title, with an optional **regular expression** mode
31. Hides tracking pixels (≤2 px)
32. **Blocklist** with wildcards or `/regex/` (ad and analytics hosts are blocked by default)
33. Sort by page order, resolution, width, height, file size, name, type or domain
34. Remembers your last filters

### Analysis
35. **Analyze** fetches each image for its exact byte size, real MIME type and true dimensions
36. **Perceptual-hash (dHash) visual duplicate detection**, with adjustable sensitivity
37. Dominant colour swatch for each image

### Browsing and selection
38. Grid and list views with a thumbnail-size slider
39. Click to select, **Shift+click for a range**, plus select all, none and invert
40. Remove images from the results
41. **Lightbox preview**: wheel/click zoom up to 12×, drag to pan, ←/→ to browse, full metadata panel
42. **Show on page**: scrolls to the image in the original tab and highlights it
43. Copy the image itself to the clipboard (as PNG)
44. Open an image in a new tab
45. **Reverse image search** with Google Lens, Bing Visual Search, TinEye or Yandex

### Downloading and export
46. Bulk download with a **concurrency limit, progress bar and Cancel**
47. **Download as ZIP** using a built-in ZIP writer (UTF-8 names, failed URLs listed in `failed-urls.txt`)
48. **File name and folder templates**: `{name} {index:3} {domain} {pagedomain} {title} {date} {time} {timestamp} {width} {height} {alt} {type} {source}`
49. **Format conversion** to PNG, JPEG or WebP, with adjustable quality
50. Choose what happens when a file exists (add a number, overwrite or ask), plus an optional *Save as* dialog
51. Export the list as **TXT, CSV, JSON or a standalone HTML gallery**
52. Copy the selected URLs to the clipboard

### Bulk scraping and website crawling (any URL, no tab needed)
53. **Bulk URL scraper**: paste thousands of page or image URLs, or load them from a `.txt`, `.csv`, `.html` or `.json` file
54. **Website crawler**: follows links from start URLs with a link-depth limit and **no page limit** (0 = unlimited)
55. Crawl scope: the same website, the same domain including subdomains, or any website
56. Include and exclude URL patterns (wildcards or `/regex/`) to control which links the crawler follows
57. **Automatic pagination**: follows `rel="next"` and "Next", "›", "»", "Siguiente", "Suivant", "Weiter", "次へ", "下一页" and "Далее" links
58. **sitemap.xml support**, including sitemap indexes, gzipped sitemaps and Google image sitemaps
59. **Respects robots.txt** (Allow/Disallow, wildcards and Crawl-delay), and can be switched off for your own sites
60. **Fast mode** reads the page HTML directly, handling hundreds of pages per minute
61. **Full-render mode** opens each page in a background tab so its JavaScript runs, optionally auto-scrolling each page
62. Finds image URLs inside inline scripts and JSON (for JavaScript-built galleries)
63. Adjustable concurrency, delay between requests and page timeout
64. **Pause, resume and stop** at any time, with a live activity log, rate counter and progress bar
65. **URL pattern generator**: `img[001-500].{jpg,png}`, with numeric ranges, zero padding, steps, letters and alternatives (up to 1,000,000 URLs)
66. Send the results to the dashboard, or export them as a URL list
67. Right-click menu items: *Crawl this website for images…* and *Scrape images from linked page*

### Large-scale downloading
68. **No scan limits**: the number of elements examined and images collected per page are configurable (0 = unlimited)
69. **Paged gallery rendering** stays fast with tens of thousands of results
70. **ZIP files are split into parts** (the size is configurable, 1–3900 MB), so there's no overall size limit and memory use stays bounded
71. **Automatic retries** with exponential backoff for failed images
72. **Pause and resume** for downloads and ZIP packing
73. Rate limiting: a delay between downloads to avoid being blocked
74. The browser's download completion is tracked, so the parallel-download limit is real
75. **Skip previously downloaded images** using a persistent download log (up to 500,000 entries, which you can clear)
76. **Import URLs** into the dashboard by pasting or from a file, replacing or adding to the current results
77. Unlimited local storage for history and large result sets (`unlimitedStorage`)

### Worldwide web support
78. **Hotlink-protection bypass**: sends the original page as `Referer` for image requests (via `declarativeNetRequest`)
79. **Correct text decoding for non-UTF-8 sites**: Shift_JIS, EUC-JP, GBK, EUC-KR, Windows-1251 and other legacy encodings are detected from the BOM, headers and `<meta>`, just as browsers do
80. Internationalized domain names and Unicode file names (UTF-8 ZIP entries)
81. Logged-in pages: requests carry your cookies, so galleries behind a login can be scraped
82. **JPEG XL** and **HEIC/HEIF** detection, alongside JPG, PNG, GIF, WebP, AVIF, SVG, BMP, ICO and TIFF

### Browser integration
- Right-click menus: download an image with your naming rules, download a linked image, copy an image URL, reverse search, download all images on the page, scrape all tabs
- Keyboard commands: `Alt+Shift+I` popup, `Alt+Shift+O` dashboard, `Alt+Shift+D` quick download (all can be changed)
- Toolbar badge showing each page's image count
- Popup with an instant image count, the 12 largest images and one-click actions
- **Scrape history** of the last *N* scrapes, which you can reopen at any time
- Settings sync across devices (`storage.sync`), plus JSON import/export and reset
- Light, dark and system themes
- Keyboard shortcuts in the dashboard: `/` search · `Ctrl+A` select all · `Ctrl+C` copy URLs · `D` download · `Z` ZIP · `R` rescan · `Del` remove · `Esc` clear
- Store listing localized in English, Spanish, German and French

## Roadmap

- **Video scraping** (planned): finding `<video>`/`<audio>` elements, video links and metadata, network capture of streamed media, unencrypted HLS downloads and a Videos page. See [docs/VIDEO_SCRAPER_PLAN.md](docs/VIDEO_SCRAPER_PLAN.md).

## Project layout

```
src/
  manifest.json           Chrome MV3 base manifest (other browsers are derived in scripts/build.mjs)
  background/             service worker: context menus, commands, badge, quick download
  content/scraper.js      injected on demand into each frame: detection, auto-scroll, live mode, picker, highlight
  dashboard/              main UI: filters, gallery, lightbox, downloads, ZIP, export, history, import
  bulk/                   bulk URL scraper, website crawler and URL pattern generator
  popup/                  toolbar popup
  options/                settings page
  lib/                    shared modules: utils, zip, imaging, scanner, settings, browser shim,
                          crawler, pagefetch, robots, urlgen, crawl, downloader, referer
scripts/build.mjs         per-browser builds and store zips (no dependencies)
scripts/make-icons.mjs    renders the PNG icons
tests/                    unit tests (node:test) and a Playwright end-to-end test
```

## Continuous integration and delivery

GitHub Actions (in `.github/workflows/`):

- **CI** (`ci.yml`) runs on every push to `main` and every pull request:
  - static checks (`npm run check`) and unit tests on Node 20 and 22
  - builds every browser, and fails if the committed `dist/` doesn't match a fresh build
  - Mozilla's `web-ext lint` on the Firefox build, with warnings treated as errors
  - the end-to-end test in real Chromium
  - uploads the store zips as a downloadable artifact, with a size report
- **Release** (`release.yml`) runs when you push a tag like `v1.2.0`:
  - checks the tag matches the manifest version, then rebuilds and retests
  - creates a GitHub Release with every browser's zip attached
  - publishes to the Chrome Web Store, Firefox Add-ons and Edge Add-ons, skipping any store whose credentials aren't set
- **CodeQL** (`codeql.yml`) runs a weekly security scan and scans every pull request.
- **Dependabot** keeps the workflow actions up to date.

See [DEPLOY.md](DEPLOY.md#part-3-automated-releases-cicd) to set up automated releases.

## Testing

```bash
npm run check       # syntax, manifest, locale lengths, missing files, version consistency
npm test            # unit tests: filters, templates, dedupe, dHash, exports, ZIP, robots.txt, URL patterns, charsets, retries
npm run test:e2e    # loads dist/chrome into real Chromium and exercises the dashboard (needs Playwright)
```

The end-to-end test serves `tests/fixtures/page.html`, which contains every kind
of image source, and a small fake website in `tests/fixtures/site/`. That site
has robots.txt, a sitemap, pagination, a hotlink-protected image, a page built
by JavaScript and a Windows-1251 page. The test checks detection, filters,
analysis, duplicates, ZIP files, crawling (depth, scope, robots, sitemap,
pagination), full-render mode, charset decoding, Referer rules, skipping
previous downloads, multi-part ZIPs, the URL generator, history, the popup and
the options page.

## Permissions

| Permission | Why |
| --- | --- |
| `<all_urls>` host access, **optional** in Chrome, Edge, Brave, Opera and Vivaldi | Asked for the first time you use a feature that fetches from other sites: analyze, ZIP, convert, duplicates, copy image, all tabs, bulk scraping and crawling, and the Referer rules. Until then the extension works on the tab where you click its icon (`activeTab`). It can be allowed or removed in the options. Firefox and Safari declare it up front and let you manage site access in the browser. |
| `scripting`, `activeTab`, `tabs` | Inject the scanner into the tab you invoke it on (or all tabs, with access to all sites) |
| `downloads` | Save images and ZIP files (Safari falls back to `<a download>`) |
| `contextMenus` | Right-click actions |
| `storage`, `unlimitedStorage` | Settings, scrape history, download log and large result sets |
| `declarativeNetRequestWithHostAccess` | Set the page as `Referer` on the extension's own image requests (hotlink-protected images) |
| `clipboardWrite` | Copy URLs and images |

Everything runs locally. The extension has no analytics and doesn't call any
remote servers, except when you choose reverse image search.

## Browser notes
- **Firefox**: the build swaps the service worker for an MV3 event page and adds a `gecko` ID. Data-URI downloads are converted to blob URLs automatically.
- **Safari**: Safari has no `downloads` API, so the build drops that permission, and the dashboard saves files through `<a download>` (folder templates are flattened). Quick download from the popup or context menu isn't available on Safari.

## License

GPL-3.0. See [LICENSE](LICENSE).
