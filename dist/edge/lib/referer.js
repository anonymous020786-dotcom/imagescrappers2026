// Hotlink-protected servers refuse image requests that don't carry the original
// page as Referer, and requests made by an extension page never do. Pages
// can't set that header, but declarativeNetRequest session rules can: for
// requests from this extension tab to an image's host, send the origin of the
// page the image was found on as the Referer.
import { api } from './browser.js';
import { hostFromUrl } from './utils.js';

const FIRST_ID = 1000;
const MAX_RULES = 4000;

let lastSignature = null;

// Installs one rule per image host. Idempotent: returns immediately when the
// wanted rules are already in place, so it's cheap to call before every fetch.
export async function applyRefererRules(images, enabled) {
  const dnr = api.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return 0;
  const me = await api.tabs.getCurrent().catch(() => null);
  if (!me) return 0;

  const byHost = new Map();
  if (enabled) {
    for (const img of images) {
      if (!img.pageUrl || img.url.startsWith('data:')) continue;
      const host = hostFromUrl(img.url);
      if (!host || byHost.has(host)) continue;
      try {
        byHost.set(host, [new URL(img.url).hostname, `${new URL(img.pageUrl).origin}/`]);
      } catch { /* bad URL */ }
      if (byHost.size >= MAX_RULES) break;
    }
  }
  const pairs = [...byHost.values()];
  const signature = JSON.stringify(pairs);
  if (signature === lastSignature) return pairs.length;

  // Rule IDs are per-tab ranges so several dashboards don't clash.
  const base = FIRST_ID + (me.id % 1000) * MAX_RULES;
  const existing = (await dnr.getSessionRules().catch(() => []))
    .filter((r) => r.id >= FIRST_ID && r.condition.tabIds?.includes(me.id));
  const addRules = pairs.map(([host, referer], i) => ({
    id: base + i,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: referer }] },
    condition: { requestDomains: [host], tabIds: [me.id], resourceTypes: ['image', 'xmlhttprequest', 'media', 'other'] },
  }));
  try {
    await dnr.updateSessionRules({ removeRuleIds: existing.map((r) => r.id), addRules });
    lastSignature = signature;
  } catch (err) {
    console.warn('Could not set Referer rules', err);
    return 0;
  }
  return addRules.length;
}
