// Optional "all sites" host access (Chromium builds declare <all_urls> in optional_host_permissions).
//
// Without it the extension still works on the tab the user invokes it on (activeTab): scanning, the popup,
// the right-click menu and plain downloads. Features that fetch from other origins (analyze, ZIP, convert,
// duplicates, copy image, all tabs, bulk/crawl, Referer rules) ask for it the first time they're used.
//
// chrome.permissions.request() only works during a user gesture, so callers must call requestAllSites()
// before any other await in their click handler. `granted` is kept current so that check is synchronous.
import { api } from './browser.js';

export const ALL_SITES = Object.freeze({ origins: ['<all_urls>'] });

export const access = {
  // Browsers without the permissions API (or builds with mandatory host access) behave as granted.
  granted: !api.permissions?.contains,
  listeners: new Set(),
};

function set(value) {
  if (access.granted === value) return;
  access.granted = value;
  for (const fn of access.listeners) fn(value);
}

export async function refreshAccess() {
  if (!api.permissions?.contains) return access.granted;
  set(await api.permissions.contains(ALL_SITES).catch(() => false));
  return access.granted;
}

export function onAccessChange(fn) {
  access.listeners.add(fn);
  return () => access.listeners.delete(fn);
}

api.permissions?.onAdded?.addListener(() => refreshAccess());
api.permissions?.onRemoved?.addListener(() => refreshAccess());

// Asks for access to all sites if it isn't granted yet. Must be the first await in a click handler.
export async function requestAllSites() {
  if (access.granted || !api.permissions?.request) return true;
  let ok = false;
  try {
    ok = await api.permissions.request(ALL_SITES);
  } catch {
    ok = false; // not in a user gesture, or the browser refused
  }
  set(ok || (await refreshAccess()));
  return access.granted;
}

export async function revokeAllSites() {
  if (!api.permissions?.remove) return false;
  const removed = await api.permissions.remove(ALL_SITES).catch(() => false);
  await refreshAccess();
  return removed;
}

export const NEEDS_ACCESS =
  'This needs access to all sites, so images hosted on other domains can be fetched. Nothing else changes: ' +
  'the extension still only acts when you ask it to.';

// A friendlier message when a tab can't be scanned for lack of access.
export function explainScanError(err) {
  const msg = String(err?.message ?? err);
  if (/cannot access|permission|host/i.test(msg) && !access.granted) {
    return 'No access to this tab. Click the Image Scraper icon while on that page, or allow access to all sites.';
  }
  return msg;
}

// A dismissible-by-granting notice with an "Allow" button, shown while access isn't granted.
export function mountAccessBanner(where, text) {
  const bar = document.createElement('div');
  bar.className = 'access-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText =
    'align-items:center;justify-content:space-between;gap:12px;margin:8px 12px;padding:8px 12px;font-size:13px;' +
    'border:1px solid color-mix(in srgb, currentColor 25%, transparent);border-radius:8px';
  const msg = document.createElement('span');
  msg.textContent = text;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'allowAllSites';
  btn.textContent = 'Allow access to all sites';
  btn.onclick = () => requestAllSites();
  bar.append(msg, btn);
  where.prepend(bar);
  const sync = (granted) => {
    bar.style.display = granted ? 'none' : 'flex';
  };
  sync(access.granted);
  onAccessChange(sync);
  return bar;
}
