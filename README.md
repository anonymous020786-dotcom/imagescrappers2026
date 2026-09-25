# Image Scraper Pro

An advanced, dependency-free image scraper extension for every major browser.
It's built on Manifest V3. Chrome is the primary target, and the same source
builds for **Microsoft Edge, Brave, Opera, Vivaldi, Firefox (desktop and Android)
and Safari**.

It finds images wherever they are on a page: `<img>`, `srcset`, `<picture>`,
lazy-load attributes, CSS backgrounds, pseudo-elements, inline SVG, canvas,
video posters, Shadow DOM and iframes. You can then filter, preview, analyze,
de-duplicate, convert and bulk-download them, individually or as one ZIP file.

## Install (development)

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

## Features (52)

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

## Project layout

```
src/
  manifest.json           Chrome MV3 base manifest (other browsers are derived in scripts/build.mjs)
  background/             service worker: context menus, commands, badge, quick download
  content/scraper.js      injected on demand into each frame: detection, auto-scroll, live mode, picker, highlight
  dashboard/              main UI: filters, gallery, lightbox, downloads, ZIP, export, history
  popup/                  toolbar popup
  options/                settings page
  lib/                    shared modules: utils (pure), zip, imaging, scanner, settings, browser shim
scripts/build.mjs         per-browser builds and store zips (no dependencies)
scripts/make-icons.mjs    renders the PNG icons
tests/                    unit tests (node:test) and a Playwright end-to-end test
```

## Testing

```bash
npm test            # unit tests: filters, templates, dedupe, dHash, exports, ZIP (checked with Python's zipfile)
npm run test:e2e    # loads dist/chrome into real Chromium and exercises the dashboard (needs Playwright)
```

The end-to-end test serves `tests/fixtures/page.html`, which contains every kind
of image source. It checks that the dashboard detects all of them, filters them,
analyzes them, finds duplicates and produces a ZIP. It also checks history, the
popup and the options page.

## Permissions

| Permission | Why |
| --- | --- |
| `<all_urls>` host access | Scan pages, and fetch images across origins for analysis, ZIP and conversion |
| `scripting`, `activeTab`, `tabs` | Inject the scanner into the current tab or all tabs |
| `downloads` | Save images and ZIP files (Safari falls back to `<a download>`) |
| `contextMenus` | Right-click actions |
| `storage` | Settings and scrape history |
| `clipboardWrite` | Copy URLs and images |

Everything runs locally. The extension has no analytics and doesn't call any
remote servers, except when you choose reverse image search.

## Browser notes
- **Firefox**: the build swaps the service worker for an MV3 event page and adds a `gecko` ID. Data-URI downloads are converted to blob URLs automatically.
- **Safari**: Safari has no `downloads` API, so the build drops that permission, and the dashboard saves files through `<a download>` (folder templates are flattened). Quick download from the popup or context menu isn't available on Safari.

## License

GPL-3.0. See [LICENSE](LICENSE).
