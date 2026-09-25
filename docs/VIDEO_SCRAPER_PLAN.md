# Plan: video scraping

Status: **planned, not built yet.** This document describes the proposed
design so it can be reviewed before any code is written.

## Goal

Find the videos (and, cheaply alongside them, audio files) on a page or
across a crawl. Show them with a preview, their resolution, length and size,
and download them using the same naming, retry and pause features the image
tools already have.

## Scope and limits

What it will do:
- download video and audio files that are served as plain files (MP4, WebM, MOV, M4V, OGV, MP3, M4A…)
- download **unencrypted** HLS streams (`.m3u8`) by fetching their segments and joining them
- **list** video embeds from sites like YouTube and Vimeo, with a link to open them

What it will deliberately not do:
- **No DRM or encrypted streams.** An HLS playlist containing `#EXT-X-KEY` with any method other than `NONE`, and anything protected by Widevine, PlayReady or FairPlay, is reported as "encrypted, can't be downloaded". The extension won't try to decrypt it.
- **No downloading from YouTube, Vimeo and similar platforms.** Their terms forbid it, so embeds are listed with an *Open* link only.
- **No DASH (`.mpd`) downloads in the first version.** DASH is detected and its URL can be copied. Downloading it means merging separate audio and video tracks, which needs a remuxer and belongs in a later phase.

## Where videos are found

### 1. On the page (extend `content/scraper.js`)
A new `scanMedia()` next to `scan()`, reusing the same element walk (Shadow DOM included):

| Source | Details collected |
| --- | --- |
| `<video src>`, `<video>` → `<source src type>` | every `<source>`, so each listed quality appears; `videoWidth`, `videoHeight`, `duration` and `poster` when loaded |
| `<audio>` and its `<source>` | `duration` |
| `blob:` / MediaSource players | flagged "streamed by the page". The real URL comes from network capture (below) |
| `<a href>` to video files | by extension: `mp4 webm mov m4v mkv ogv m3u8 mpd mp3 m4a ogg wav flac` |
| `<embed>`, `<object data>` | when the URL is a media file |
| Open Graph / Twitter tags | `og:video`, `og:video:url`, `og:video:secure_url`, `twitter:player:stream` |
| JSON-LD `VideoObject` | `contentUrl`, `embedUrl`, `thumbnailUrl`, `duration`, `uploadDate` |
| `<iframe>` embeds | YouTube, Vimeo, Dailymotion, Twitch, Streamable, Wistia, JW Player. Stored as platform plus video ID, *list only* |

### 2. Network capture (new, in the background worker)
Many sites use a player that feeds the `<video>` element from JavaScript, so
its `src` is a useless `blob:` URL. The real media or playlist URL only shows
up as a network request.
- Use `webRequest.onResponseStarted` (read-only, which Manifest V3 allows) for types `media`, `xmlhttprequest` and `other`.
- Keep a request when its `Content-Type` is `video/*`, `audio/*`, `application/vnd.apple.mpegurl`, `application/x-mpegURL` or `application/dash+xml`, or when its URL ends in a media extension.
- Ignore HLS and DASH *segments* (`.ts`, `.m4s`, byte-range requests), so only the playlist and whole files are listed.
- Store the results per tab in `storage.session` (up to 500 per tab), because the service worker can restart. Clear them when the tab navigates.
- New permission: `webRequest`, which is observational and works in both Chrome and Firefox.

### 3. Bulk scraping and crawling
- `lib/pagefetch.js` `extractFromDocument()` also returns `videos`, from static HTML sources 1 above.
- The crawler gets a "Collect videos" option. Results open in the Videos page instead of the image dashboard.
- Fast mode can't see videos loaded by JavaScript. Full-render mode can, when network capture is enabled for its background tabs.

## Videos page (`src/media/`)

A separate page rather than a tab in the image dashboard, because videos need different columns and controls. It opens from:
- a **Videos** button in the popup (showing the page's video count)
- the dashboard's top bar
- a right-click **Find videos on this page** item, and **Download video** on `<video>` elements

Each item shows:
- **Preview:** the poster frame, plus an inline `<video preload="metadata">` preview. Media elements may load across origins without CORS, so this works for most files.
- **Details:** type (file, HLS, DASH, embed), resolution, length, and size (from a `HEAD` request's `Content-Length`).
- **Where it was found** (page element, network capture or metadata), with a *Show on page* link that reuses the image highlighting.
- **For HLS master playlists:** an **Analyze** step lists the available qualities (resolution and bitrate) to choose from.

You can filter by type, minimum resolution (360p/480p/720p/1080p/4K), minimum length, domain and text. You can sort by resolution, length, size or page order.

Actions:
- **Download:** uses the existing file-name templates, with new tokens `{duration}` and `{resolution}`
- **Copy URLs**
- **Export:** TXT, CSV or JSON, plus an **M3U playlist**
- **Open in a new tab**

## Downloading

| Kind | How | Notes |
| --- | --- | --- |
| Plain file | `downloads.download()` directly | Streams to disk, so there's no memory limit. It uses the browser's own retry and resume, and the existing completion tracking gives retries and concurrency. |
| HLS, unencrypted | fetch the playlist → choose a quality → fetch the segments (concurrency and retry from `lib/crawl.js`) → join them in order → save | MPEG-TS segments become a `.ts` file, which VLC and mpv play. fMP4 segments (`#EXT-X-MAP`) have the init segment prepended and become a `.mp4` file. Progress, pause and cancel reuse the existing task bar. |
| HLS, encrypted | refused | shows "Encrypted stream (not supported)" |
| DASH | not in phase 1 | copy URL only |
| Embed | not downloadable | *Open* link only |

### Facts already checked in Chromium (September 2026)
- **Referer rules don't reach the browser's own downloads.** `declarativeNetRequest` session rules don't apply to `downloads.download()` requests, whichever condition is used: `tabIds: [-1]`, `initiatorDomains: [extension id]`, or no condition at all.
- **`downloads.download()` rejects a `Referer` header** with "Unsafe request header name".
- **Consequence:** for a hotlink-protected *file*, the choices are a direct download without a Referer, or fetching it through the Videos page (where the Referer rule works) and saving the result. Fetching through the page holds the whole file in memory. The plan is to try the direct download first, and fall back to the fetch path only when the file is under a size limit (default 1 GB) or the user opts in.
- **HLS segments** are always fetched by the Videos page, so the existing Referer rules cover them.

### Memory for long HLS streams
Segments are joined with `new Blob(parts)`. Chrome moves large blobs to disk,
so memory stays bounded in practice. As an improvement, Chromium could stream
straight to a file with `showSaveFilePicker()` and a writable stream, which
also avoids the size limits of a single `downloads.download()` blob.

## New settings
- **Videos:** scan video elements, video links and embeds (on/off); capture network requests (on/off, off by default because it keeps a per-tab list)
- **Quality:** preferred HLS quality (highest, lowest, or the closest to a set height such as 720p)
- **Fetch limit:** largest file to fetch through the page when a Referer is needed (MB)
- **Naming:** video file name template (default `{index:3}_{name}_{resolution}`)

## Permissions
- **New:** `webRequest`, which only reads requests to detect media URLs and never blocks or changes them.
- **Existing:** `downloads`, host permissions, `declarativeNetRequestWithHostAccess` and `storage`.

## Tests
- **Unit tests** (pure `lib/media.js`):
  - media type from URL or MIME
  - M3U8 parsing: master vs media playlist, variants with resolution and bandwidth, relative segment URLs, `EXT-X-MAP`, detecting `EXT-X-KEY`
  - recognizing embed platforms and IDs
  - ISO-8601 durations (`PT1H2M3S`)
- **End-to-end fixtures:**
  - a page with `<video>`/`<source>` in two qualities, a poster, an `og:video` tag, JSON-LD and an iframe embed
  - a page whose player loads video through `fetch` or `blob:`, to test network capture
  - a local unencrypted HLS stream (master and media playlists with small `.ts` segments). The joined download's size must equal the sum of the segments.
  - an encrypted playlist that must be refused

## Delivery phases
1. **Detection and Videos page:** page scanning, previews, details, filters, direct downloads and export
2. **Network capture:** `webRequest` sniffing, `blob:` player support, the Videos button in the popup
3. **HLS download:** quality choice, segment fetching with retry and pause, `.ts`/`.mp4` output, refusing encrypted streams
4. **Bulk and crawl:** "Collect videos" in the bulk scraper and crawler, with results opening in the Videos page
5. **Later:** DASH download (needs a small MP4 muxer), streaming to disk with `showSaveFilePicker`, and capturing frames from a video as images

## Open questions
- Should audio get its own filter tab, or share the Videos page (as proposed)?
- Should network capture be on by default? It's off in this plan, for privacy and memory.
- Is `.ts` output from HLS acceptable, or is a built-in TS→MP4 remux needed in phase 3? Remuxing adds a sizeable pure-JS muxer.
