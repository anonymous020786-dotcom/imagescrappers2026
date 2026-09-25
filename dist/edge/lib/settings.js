import { api } from './browser.js';

export const DEFAULT_SETTINGS = {
  // Scanning
  scanImgTags: true,
  scanSrcset: true,
  scanBackgrounds: true,
  scanPseudo: true,
  scanSvg: true,
  scanCanvas: true,
  scanVideoPosters: true,
  scanLinks: true,
  scanMeta: true,
  scanLazyAttrs: true,
  scanShadowDom: true,
  scanDataUris: true,
  allFrames: true,
  autoScroll: false,
  autoScrollMaxSteps: 40,
  autoScrollDelay: 350,
  preferHighestResolution: true,
  ignoreQueryForDedupe: false,
  maxScanElements: 100000, // 0 = unlimited
  maxScanResults: 0, // 0 = unlimited

  // Default filters
  minWidth: 0,
  minHeight: 0,
  hideTracking: true,
  keepUnknownSize: true,
  blocklist: ['*doubleclick.net*', '*googlesyndication.com*', '*facebook.com/tr*', '*/pixel.gif*', '*analytics*'],

  // Downloads
  filenameTemplate: '{index:3}_{name}',
  folderTemplate: 'ImageScraper/{pagedomain}/{date}',
  conflictAction: 'uniquify',
  saveAs: false,
  concurrency: 4,
  convertTo: 'original',
  jpegQuality: 0.92,
  zipName: '{pagedomain}_{date}_{time}',
  zipPartSizeMB: 1024,
  retries: 2,
  requestDelay: 0,
  skipDownloaded: false,
  sendReferer: true,

  // UI
  theme: 'system',
  thumbSize: 160,
  view: 'grid',
  showBadge: true,
  historyLimit: 25,
  historyImageLimit: 5000, // 0 = keep every image URL
  duplicateThreshold: 5,
  reverseSearchEngine: 'google',
};

// Keys stored in sync storage so they follow the user between devices.
const SYNC_KEY = 'settings';

export async function loadSettings() {
  try {
    const stored = await api.storage.sync.get(SYNC_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored?.[SYNC_KEY] ?? {}) };
  } catch {
    const stored = await api.storage.local.get(SYNC_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored?.[SYNC_KEY] ?? {}) };
  }
}

export async function saveSettings(partial) {
  const next = { ...(await loadSettings()), ...partial };
  try {
    await api.storage.sync.set({ [SYNC_KEY]: next });
  } catch {
    // Sync quota exceeded or sync unavailable (e.g. Safari): fall back to local.
    await api.storage.local.set({ [SYNC_KEY]: next });
  }
  return next;
}

export async function resetSettings() {
  await api.storage.sync.remove(SYNC_KEY).catch(() => {});
  await api.storage.local.remove(SYNC_KEY).catch(() => {});
  return { ...DEFAULT_SETTINGS };
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}
