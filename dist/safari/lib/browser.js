// Cross-browser WebExtension namespace.
// Firefox and Safari expose a promise-based `browser` global; Chromium-based
// browsers (Chrome, Edge, Opera, Brave, Vivaldi) expose promise-returning
// `chrome` APIs under Manifest V3.
export const api = globalThis.browser ?? globalThis.chrome;

export const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

export function isScriptableUrl(url) {
  if (!url) return false;
  return /^(https?|file|ftp):/i.test(url) &&
    !/^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|addons\.mozilla\.org|microsoftedge\.microsoft\.com\/addons)/i.test(url);
}
