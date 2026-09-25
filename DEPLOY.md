# Deploying Image Scraper Pro

This guide covers two things: installing the extension in your own browser for
testing, and publishing it to each browser's add-on store so anyone can
install it.

Ready-made builds are already in [`dist/`](dist). To rebuild them after
changing the source:

```bash
npm run build     # all browsers
npm test          # unit tests
npm run test:e2e  # optional: real-browser test (needs Playwright)
```

Before each store release, raise `"version"` in `src/manifest.json` (for example
`1.0.0` → `1.0.1`) and rebuild. Every store rejects an upload that reuses a
version number.

| Browser | Folder to load | Zip to upload | Store |
| --- | --- | --- | --- |
| Chrome | `dist/chrome` | `dist/image-scraper-pro-chrome-<ver>.zip` | Chrome Web Store |
| Edge | `dist/edge` | `dist/image-scraper-pro-edge-<ver>.zip` | Microsoft Edge Add-ons |
| Brave | `dist/brave` | uses the Chrome Web Store listing | Chrome Web Store |
| Vivaldi | `dist/vivaldi` | uses the Chrome Web Store listing | Chrome Web Store |
| Opera | `dist/opera` | `dist/image-scraper-pro-opera-<ver>.zip` | Opera add-ons |
| Firefox | `dist/firefox` | `dist/image-scraper-pro-firefox-<ver>.zip` | addons.mozilla.org (AMO) |
| Safari | `dist/safari` | an Xcode app built from it | Mac App Store |

---

## Part 1: install it for yourself

First get the files onto your computer: clone the repo, or on GitHub choose
**Code → Download ZIP** and unzip it. Load the **folder**, not the zip.

### Chrome
1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `dist/chrome`.
4. Pin it: click the puzzle icon in the toolbar, then the pin next to *Image Scraper Pro*.

After you change the code, run `npm run build`, then click the ⟳ reload icon on
the extension's card.

### Microsoft Edge
1. Go to `edge://extensions`.
2. Turn on **Developer mode** (left sidebar).
3. Click **Load unpacked** and select `dist/edge`.

### Brave
1. Go to `brave://extensions`.
2. Turn on **Developer mode** and click **Load unpacked**, then select `dist/brave`.

### Vivaldi
1. Go to `vivaldi://extensions`.
2. Turn on **Developer mode** and click **Load unpacked**, then select `dist/vivaldi`.

### Opera
1. Go to `opera://extensions`.
2. Turn on **Developer mode** and click **Load unpacked**, then select `dist/opera`.

### Firefox (version 121 or newer)
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `dist/firefox/manifest.json`.
3. Go to `about:addons`, open **Image Scraper Pro → Permissions**, and turn on
   **Access your data for all websites**. Without this, Firefox won't let it
   scan pages.

A temporary add-on is removed when Firefox restarts. To keep it installed,
have it signed through AMO (see Part 2). You can sign it as *unlisted*, which
keeps it private.

### Safari (macOS, Safari 16.4 or newer)
You'll need a Mac with Xcode installed.
1. Convert the build into an Xcode project:
   ```bash
   xcrun safari-web-extension-converter dist/safari --app-name "Image Scraper Pro"
   ```
2. Xcode opens the new project. Choose the **macOS** scheme and press **Run** (⌘R).
3. In Safari, go to **Settings → Advanced** and turn on **Show features for web developers**.
4. Go to **Settings → Developer** and turn on **Allow unsigned extensions**.
   You have to do this again every time Safari restarts.
5. Go to **Settings → Extensions**, turn on *Image Scraper Pro*, and allow it on **All Websites**.

Safari has no downloads API. Images are saved one at a time through the
browser's own download handling, so folder templates are flattened, and
*Quick download all* isn't available.

---

## Part 2: publish to the stores

### Things every store asks for
- **Screenshots**: 1280×800 or 640×400 PNGs of the dashboard, the preview window and the popup.
- **Icon**: `src/icons/icon128.png`.
- **Description**: use the feature list in the README.
- **Privacy policy URL**: this is required because the extension can read every
  site. A short page is enough, for example: *"Image Scraper Pro processes page
  content only on your device. It doesn't collect, store remotely or share any
  personal data. Settings and history are kept in your browser's storage."* You
  can host it as a GitHub Pages page or a Gist.
- **Why each permission is needed**: copy the answers from the Permissions table
  in the README. For access to all sites, a good answer is: *"The user can scan
  any page they visit. Downloading and analyzing images requires fetching them
  from whatever site hosts them."*

Because the extension asks for access to all websites, expect a longer manual
review, typically a few days, in every store.

### Chrome Web Store (also covers Brave and Vivaldi)
1. Sign up at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   There's a one-time registration fee.
2. Click **New item** and upload `dist/image-scraper-pro-chrome-<ver>.zip`.
3. Fill in the tabs. **[store/chrome/LISTING.md](store/chrome/LISTING.md) has every field ready to copy:** the
   description, category, the single purpose, a justification for each permission, the data-usage answers,
   test instructions and the privacy policy URL ([PRIVACY.md](PRIVACY.md)). The screenshots (1280×800), the
   small promo tile (440×280) and the marquee (1400×560) are in `store/chrome/`. Regenerate them from the real
   extension with `npm run build:chrome && npm run store:assets`.
4. Click **Submit for review**.
5. For updates, raise the version, rebuild, then go to **Package → Upload new
   package** and submit again.

### Microsoft Edge Add-ons
1. Sign up for the [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/)
   Edge program. It's free.
2. Click **Create new extension** and upload `dist/image-scraper-pro-edge-<ver>.zip`.
3. Fill in **Availability**, **Properties** (category, privacy policy URL) and
   **Store listings** (description, screenshots, search terms).
4. Click **Publish**.

### Firefox: addons.mozilla.org (AMO)
1. Sign in at the [AMO Developer Hub](https://addons.mozilla.org/developers/).
2. Click **Submit a New Add-on** and choose where it will be distributed:
   - **On this site**: public listing on AMO.
   - **On your own**: unlisted. You get a signed `.xpi` file that you can install
     permanently or share yourself.
3. Upload `dist/image-scraper-pro-firefox-<ver>.zip`.
4. AMO may ask for the source code. Because this code isn't minified or bundled,
   you can answer *No*. If a reviewer asks anyway, link them to this repo.
5. Fill in the listing and submit. Automated signing is usually quick; a manual
   review can come afterwards.

You can also sign from the command line with Mozilla's `web-ext` tool:
```bash
npx web-ext sign --source-dir dist/firefox --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```
The API keys come from **AMO → Tools → Manage API Keys**. Keep them private and
never commit them.

The Firefox build already sets the add-on ID to `image-scraper-pro@imagescrappers2026`.
Keep that ID the same forever, because AMO uses it to connect updates to your listing.

### Opera add-ons
1. Sign in at the [Opera add-ons developer portal](https://addons.opera.com/developer/).
2. Click **Upload new extension** and upload `dist/image-scraper-pro-opera-<ver>.zip`.
3. Fill in the description, screenshots and privacy policy, then submit.
   Opera's review is manual and can take longer than the other stores.

Opera users can also install extensions from the Chrome Web Store with Opera's
*Install Chrome Extensions* add-on.

### Safari: Mac App Store
Safari extensions ship inside a Mac app.
1. Join the Apple Developer Program. It has a yearly fee.
2. Create the Xcode project with `xcrun safari-web-extension-converter` (see Part 1).
3. In Xcode, set your **Team**, a unique **Bundle Identifier** for both the app
   and the extension target, and the app icon.
4. Choose **Product → Archive**, then in the Organizer choose
   **Distribute App → App Store Connect**.
5. In [App Store Connect](https://appstoreconnect.apple.com/), create the app
   record, add screenshots, a description and the privacy policy, then submit
   it for review.

To distribute outside the App Store, choose **Developer ID** in the Organizer and
get the app notarized instead.

---

## Part 3: automated releases (CI/CD)

The repo includes GitHub Actions workflows. **CI** checks every pull request.
**Release** builds and publishes whenever you push a version tag.

### How to release
```bash
npm run version:bump patch      # or minor / major / 1.4.0: updates manifest.json and package.json
npm run build                   # rebuild dist/ (CI fails if it's out of date)
git commit -am "Release v1.0.1"
git tag v1.0.1
git push && git push --tags
```

The **Release** workflow then:
1. checks that the tag matches `src/manifest.json`, then reruns the checks, tests, build and Firefox lint
2. creates a **GitHub Release** with every browser's zip attached
3. publishes to each store whose secrets are set. Stores without secrets are skipped with a notice, so this works before you have any store accounts.

You can also rerun a release for an existing tag: go to **Actions → Release → Run workflow**.

### Do the first store submission by hand
The store APIs can only update a listing that already exists. Publish version
1.0.0 to each store by hand (Part 2) first, then add the secrets below.

### Store secrets
Add these under **Settings → Secrets and variables → Actions → New repository secret**.

| Store | Secret | Where to get it |
| --- | --- | --- |
| Chrome Web Store | `CWS_EXTENSION_ID` | The 32-letter ID shown for your item in the Developer Dashboard |
| | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | Google Cloud Console: create a project, enable the **Chrome Web Store API**, then create an **OAuth client ID** of type *Desktop app* |
| | `CWS_REFRESH_TOKEN` | Use the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/). In its settings, enter your own client ID and secret, authorize the scope `https://www.googleapis.com/auth/chromewebstore`, then exchange the code for tokens and copy the refresh token |
| Firefox (AMO) | `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | AMO Developer Hub → **Tools → Manage API Keys** |
| Edge Add-ons | `EDGE_PRODUCT_ID` | Partner Center → your extension → **Overview** (the Product ID) |
| | `EDGE_CLIENT_ID`, `EDGE_API_KEY` | Partner Center → **Microsoft Edge → Publish API** → **Create API credentials** |

Optional repository variable: `AMO_CHANNEL`. Set it to `unlisted` to self-distribute
on Firefox (the default is `listed`). With `unlisted`, the signed `.xpi` is
attached to the GitHub Release.

Opera and Safari have no publishing API, so upload those by hand. Every release
includes their zips.

### Require approval before publishing
All three publish jobs use a GitHub **environment** called `stores`. To require
someone to approve each store release, go to **Settings → Environments → stores
→ Required reviewers** and add yourself. You can also store the secrets on that
environment instead of the whole repository.

### What CI checks on every pull request
| Check | Catches |
| --- | --- |
| `npm run check` | Syntax errors, broken imports, missing files, store listing text that's too long, `package.json` and manifest versions that don't match |
| Unit tests (Node 20 and 22) | Filters, file-name templates, duplicate detection, exports, ZIP format |
| Build + `dist/` freshness | Forgetting to run `npm run build` before committing |
| `web-ext lint` | Problems Firefox Add-ons would reject |
| End-to-end test (Chromium) | Detection, filters, analysis, ZIP, popup and options breaking in a real browser |
| CodeQL | Security issues in the JavaScript |

---

## Release checklist
- [ ] `npm run version:bump <patch|minor|major>`
- [ ] `npm run build && npm run check && npm test && npm run test:e2e`
- [ ] Load `dist/chrome` and `dist/firefox` by hand and scan a real website.
- [ ] Commit, then `git tag vX.Y.Z && git push && git push --tags`. The Release workflow does the rest.
- [ ] Upload the Opera and Safari builds by hand.
