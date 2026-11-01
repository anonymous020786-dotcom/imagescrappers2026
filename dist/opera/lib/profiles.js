// Site profiles: filters and naming rules remembered per website, kept in local extension storage.
// The operations are pure (unit-tested); load/save are thin storage wrappers.
import { api } from './browser.js';
import { hostFromUrl } from './utils.js';

export const PROFILES_KEY = 'site-profiles';

const FILTER_KEYS = ['minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'keepUnknownSize', 'hideTracking', 'aspect', 'minBytes', 'maxBytes', 'types', 'sources', 'colors', 'rights', 'hideDuplicates', 'sortKey', 'sortDir'];

// The filters worth keeping: not the search text, the selection or anything else tied to one visit.
export function profileFilters(filters) {
  return Object.fromEntries(FILTER_KEYS.filter((key) => filters[key] !== undefined).map((key) => [key, filters[key]]));
}

// The profile for a page: its own host first, then each parent domain.
export function findProfile(profiles, url) {
  let host = hostFromUrl(url);
  while (host) {
    if (Object.hasOwn(profiles, host)) return { host, ...profiles[host] };
    const dot = host.indexOf('.');
    host = dot < 0 ? '' : host.slice(dot + 1);
  }
  return null;
}

export function setProfile(profiles, host, profile, now = Date.now()) {
  return { ...profiles, [host]: { ...profile, updated: now } };
}

export function removeProfile(profiles, host) {
  const { [host]: _removed, ...rest } = profiles;
  return rest;
}

// Settings with a profile applied on top.
export function withProfile(settings, profile) {
  if (!profile) return settings;
  const out = { ...settings };
  if (profile.filenameTemplate) out.filenameTemplate = profile.filenameTemplate;
  if (profile.folderTemplate) out.folderTemplate = profile.folderTemplate;
  for (const key of ['minWidth', 'minHeight', 'hideTracking', 'keepUnknownSize']) {
    if (profile.filters?.[key] !== undefined) out[key] = profile.filters[key];
  }
  return out;
}

export async function loadProfiles() {
  const stored = await api.storage.local.get(PROFILES_KEY).catch(() => ({}));
  const profiles = stored?.[PROFILES_KEY];
  return profiles && typeof profiles === 'object' ? profiles : {};
}

export async function saveProfiles(profiles) {
  await api.storage.local.set({ [PROFILES_KEY]: profiles });
}
