import { api, isFirefox, isScriptableUrl } from '../lib/browser.js';
import { loadSettings } from '../lib/settings.js';
import { scanTab } from '../lib/scanner.js';
import { buildFilename, extensionFromUrl, filterImages, guessType, reverseSearchUrl } from '../lib/utils.js';

const DASHBOARD = 'dashboard/dashboard.html';

function openDashboard(params) {
  const qs = new URLSearchParams(params).toString();
  return api.tabs.create({ url: api.runtime.getURL(`${DASHBOARD}?${qs}`) });
}

async function createMenus() {
  await api.contextMenus.removeAll();
  const menus = [
    { id: 'open-scraper', title: 'Open Image Scraper on this page', contexts: ['page', 'frame', 'selection', 'link', 'image'] },
    { id: 'download-image', title: 'Download image (Image Scraper naming)', contexts: ['image'] },
    { id: 'download-link', title: 'Download linked image', contexts: ['link'], targetUrlPatterns: ['*://*/*.jpg*', '*://*/*.jpeg*', '*://*/*.png*', '*://*/*.gif*', '*://*/*.webp*', '*://*/*.avif*', '*://*/*.svg*'] },
    { id: 'reverse-search', title: 'Reverse image search', contexts: ['image'] },
    { id: 'copy-image-url', title: 'Copy image URL', contexts: ['image'] },
    { id: 'download-all', title: 'Download all images on this page', contexts: ['page', 'frame'] },
    { id: 'scrape-all-tabs', title: 'Scrape images from all tabs in this window', contexts: ['page', 'frame'] },
  ];
  for (const m of menus) api.contextMenus.create(m);
}

async function toDownloadableUrl(url) {
  // Firefox refuses data: URLs in downloads.download(); convert them to blob URLs.
  if (isFirefox && url.startsWith('data:')) {
    const blob = await (await fetch(url)).blob();
    return URL.createObjectURL(blob);
  }
  return url;
}

async function downloadImages(images, settings, page) {
  // Safari has no downloads API; the dashboard handles saving there instead.
  if (!api.downloads?.download) throw new Error('Downloads are not supported here. Use the dashboard instead.');
  const now = new Date();
  let ok = 0;
  let failed = 0;
  const queue = [...images.entries()];
  const workers = Array.from({ length: Math.max(1, settings.concurrency) }, async () => {
    while (queue.length) {
      const [index, img] = queue.shift();
      const type = img.type ?? guessType(img.url);
      const filename = buildFilename(settings.filenameTemplate, settings.folderTemplate, {
        ...img, index, date: now, ext: type === 'other' ? extensionFromUrl(img.url) || 'jpg' : type,
        pageUrl: page.url, title: page.title,
      });
      try {
        await api.downloads.download({
          url: await toDownloadableUrl(img.url),
          filename,
          conflictAction: settings.conflictAction,
          saveAs: settings.saveAs && images.length === 1,
        });
        ok++;
      } catch (err) {
        console.warn('Download failed', img.url, err);
        failed++;
      }
    }
  });
  await Promise.all(workers);
  return { ok, failed };
}

async function quickDownloadAll(tab) {
  const settings = await loadSettings();
  const { images, title } = await scanTab(tab, settings);
  const filtered = filterImages(images, {
    minWidth: settings.minWidth, minHeight: settings.minHeight, hideTracking: settings.hideTracking,
    keepUnknownSize: settings.keepUnknownSize, blocklist: settings.blocklist,
  });
  const result = await downloadImages(filtered, settings, { url: tab.url, title });
  notifyBadge(tab.id, `${result.ok}`, '#1a7f37');
  return { ...result, total: filtered.length };
}

function notifyBadge(tabId, text, color) {
  api.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  api.action.setBadgeText({ tabId, text }).catch(() => {});
}

async function updateBadge(tabId, url) {
  const settings = await loadSettings();
  if (!settings.showBadge || !isScriptableUrl(url)) {
    api.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }
  try {
    const [res] = await api.scripting.executeScript({
      target: { tabId },
      func: () => {
        const urls = new Set();
        for (const img of document.images) if (img.currentSrc || img.src) urls.add(img.currentSrc || img.src);
        return urls.size;
      },
    });
    const n = res?.result ?? 0;
    notifyBadge(tabId, n ? (n > 999 ? '999+' : String(n)) : '', '#5b4bdb');
  } catch {
    // No permission for this tab (e.g. PDF viewer); leave badge empty.
  }
}

async function copyText(tabId, text) {
  await api.scripting.executeScript({
    target: { tabId },
    func: (t) => navigator.clipboard.writeText(t),
    args: [text],
  });
}

api.runtime.onInstalled.addListener(createMenus);
api.runtime.onStartup?.addListener(createMenus);

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await loadSettings();
  switch (info.menuItemId) {
    case 'open-scraper':
      openDashboard({ tabId: tab.id });
      break;
    case 'download-image':
    case 'download-link': {
      const url = info.menuItemId === 'download-image' ? info.srcUrl : info.linkUrl;
      await downloadImages([{ url, type: guessType(url) }], { ...settings, concurrency: 1 }, { url: tab.url, title: tab.title });
      break;
    }
    case 'reverse-search':
      api.tabs.create({ url: reverseSearchUrl(settings.reverseSearchEngine, info.srcUrl), index: tab.index + 1 });
      break;
    case 'copy-image-url':
      await copyText(tab.id, info.srcUrl).catch(() => {});
      break;
    case 'download-all':
      await quickDownloadAll(tab).catch((e) => console.warn(e));
      break;
    case 'scrape-all-tabs':
      openDashboard({ windowId: tab.windowId, mode: 'alltabs' });
      break;
  }
});

api.commands.onCommand.addListener(async (command) => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (command === 'open-dashboard') openDashboard({ tabId: tab.id });
  if (command === 'quick-download') quickDownloadAll(tab).catch((e) => console.warn(e));
  if (command === 'scrape-all-tabs') openDashboard({ windowId: tab.windowId, mode: 'alltabs' });
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'quick-download') {
    api.tabs.get(msg.tabId).then(quickDownloadAll).then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg?.type === 'open-dashboard') {
    openDashboard(msg.params).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

api.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete') updateBadge(tabId, tab.url);
});
