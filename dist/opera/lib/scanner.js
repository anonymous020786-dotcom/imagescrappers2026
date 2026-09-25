import { api, isScriptableUrl } from './browser.js';
import { dedupe, guessType, matchesAny } from './utils.js';

const SCRAPER_FILE = 'content/scraper.js';

export async function inject(tabId, allFrames = true) {
  await api.scripting.executeScript({ target: { tabId, allFrames }, files: [SCRAPER_FILE] });
}

// Runs `fn(...args)` against `globalThis.__imageScraper` in the tab's frames.
export async function callInTab(tabId, method, args = [], allFrames = true) {
  await inject(tabId, allFrames);
  const results = await api.scripting.executeScript({
    target: { tabId, allFrames },
    func: (m, a) => globalThis.__imageScraper?.[m]?.(...a),
    args: [method, args],
  });
  return results.map((r) => r.result);
}

export async function scanTab(tab, settings, { usePicked = false } = {}) {
  if (!isScriptableUrl(tab.url)) throw new Error('This page cannot be scanned (browser-internal or store page).');
  const allFrames = settings.allFrames && !usePicked;
  if (settings.autoScroll && !usePicked) {
    await callInTab(tab.id, 'autoScroll', [{ maxSteps: settings.autoScrollMaxSteps, delay: settings.autoScrollDelay }], false).catch(() => {});
  }
  const frames = (await callInTab(tab.id, 'scan', [{ ...settings, usePicked }], allFrames)).filter(Boolean);
  const top = frames.find((f) => f.isTop) ?? frames[0];
  const raw = frames.flatMap((f, fi) =>
    f.images.map((img) => ({ ...img, order: fi * 100000 + img.order })),
  );
  const images = dedupe(raw, settings.ignoreQueryForDedupe)
    .filter((img) => !(settings.blocklist?.length && matchesAny(img.url, settings.blocklist)))
    .map((img, i) => ({
      ...img,
      id: `${tab.id}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      type: guessType(img.url),
      pageUrl: tab.url,
      pageTitle: top?.pageTitle ?? tab.title,
      tabId: tab.id,
    }));
  return { images, title: top?.pageTitle ?? tab.title, url: tab.url, frames: frames.length };
}

export async function scanTabs(tabs, settings, onProgress) {
  const all = [];
  const errors = [];
  let done = 0;
  for (const tab of tabs) {
    try {
      const res = await scanTab(tab, { ...settings, autoScroll: false });
      all.push(...res.images);
    } catch (err) {
      errors.push({ tab: tab.title, error: err.message });
    }
    onProgress?.(++done, tabs.length);
  }
  return { images: all, errors };
}
