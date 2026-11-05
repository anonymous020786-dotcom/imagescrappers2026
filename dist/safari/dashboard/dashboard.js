import { api, isScriptableUrl } from '../lib/browser.js';
import { applyTheme, loadSettings, saveSettings } from '../lib/settings.js';
import { callInTab, scanTab, scanTabs } from '../lib/scanner.js';
import {
  analyze, convert, copyImageToClipboard, fetchBlob, paletteOf, pdfImage, prepareImage, removeMetadata, renderContactSheet, resizeActive,
} from '../lib/imaging.js';
import { SIZE_PRESETS, planActive, planFromSettings } from '../lib/prepare.js';
import { RIGHTS_LABELS, mergeRights, rightsClass, sourcesToCSV } from '../lib/rights.js';
import { findProfile, loadProfiles, profileFilters, removeProfile, saveProfiles, setProfile, withProfile } from '../lib/profiles.js';
import { buildPdf } from '../lib/pdf.js';
import { sheetLayout } from '../lib/sheet.js';
import { paletteToCSS, textColorFor } from '../lib/palette.js';
import {
  addImages, backupCollections, createCollection, deleteCollection, loadCollections, matchesCollection, removeImages, renameCollection,
  restoreCollections, saveCollections, setCollectionDetails, sortCollections,
} from '../lib/collections.js';
import { readMetadata, readRights } from '../lib/exif.js';
import { RULES, auditByPage, auditImages, auditToCSV, pageAuditToCSV } from '../lib/audit.js';
import { PAGE_RULES, auditPages as auditPageSeo, imageSitemaps, socialSizesUnknown } from '../lib/seo.js';
import { openEditor } from './editor.js';
import { canExtractFrames, openFrames } from './frames.js';
import { ZipWriter } from '../lib/zip.js';
import { DownloadLog, createGate, waitForDownload } from '../lib/downloader.js';
import { applyRefererRules } from '../lib/referer.js';
import { NEEDS_ACCESS, access, explainScanError, mountAccessBanner, onAccessChange, refreshAccess, requestAllSites } from '../lib/access.js';
import { extractUrls, sleep, withRetry } from '../lib/crawl.js';
import {
  COLOR_FAMILIES, IMAGE_TYPES, applyTemplate, aspectOf, baseNameFromUrl, buildFilename, colorFamily, dedupe, duplicateGroups, extensionFromUrl,
  filterImages, formatBytes, guessType, hostFromUrl, mapLimit, markVisualDuplicates, normalizeUrl, previewNames, rankSimilar, reverseSearchUrl,
  safeImageSrc, sortImages, toCSV, toHTMLGallery, toJSON, toSnippet, toText,
} from '../lib/utils.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SOURCES = ['img', 'srcset', 'picture', 'lazy', 'css', 'pseudo', 'svg', 'canvas', 'poster', 'link', 'meta', 'icon', 'network', 'script', 'sitemap', 'direct', 'generated', 'imported'];
const SOURCE_LABELS = {
  img: '<img>', srcset: 'srcset', picture: '<picture>', lazy: 'lazy-load', css: 'CSS bg', pseudo: '::before/after',
  svg: 'inline SVG', canvas: 'canvas', poster: 'video poster', link: 'linked', meta: 'meta/og', icon: 'favicon', network: 'network',
  script: 'in scripts', sitemap: 'sitemap', direct: 'direct URL', generated: 'generated', imported: 'imported',
};
const COLOR_LABELS = Object.fromEntries(COLOR_FAMILIES.map((c) => [c, c[0].toUpperCase() + c.slice(1)]));
const LOGO_KEY = 'watermark-logo';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_NAME_ROWS = 300;
const PAGE_SIZE = 400;
const HISTORY_KEY = 'history';
const FILTER_STORE = 'dashboard-filters';

let settings = await loadSettings();
applyTheme(settings.theme);
await refreshAccess();

const panel = params.has('panel'); // running in the browser's side panel / sidebar

const state = {
  mode: params.get('mode') || 'tab',
  tab: null,
  images: [],
  view: [],
  lastClicked: -1,
  abort: null,
  live: false,
  lightboxIndex: -1,
  historyId: null,
  types: new Set(),
  sources: new Set(),
  colors: new Set(),
  similar: null, // { hash, name }: showing images that look like this one
  profile: null, // the site profile in use
  wmLogo: null, // decoded watermark logo
  prepMissed: 0, // images that couldn't reach the target file size in this run
  rendered: 0,
  gate: createGate(),
};

// ---------------------------------------------------------------- utilities

let toastTimer;
function toast(msg, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function storeGet(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}

function selected() {
  return state.images.filter((i) => i.selected);
}

function targetForAction() {
  const sel = state.view.filter((i) => i.selected);
  return sel.length ? sel : [];
}

function extFor(img, convertTo) {
  if (convertTo && convertTo !== 'original') return convertTo === 'jpeg' ? 'jpg' : convertTo;
  if (img.type && img.type !== 'other') return img.type;
  return extensionFromUrl(img.url) || 'jpg';
}

async function saveFile(url, filename, saveAs = false) {
  if (api.downloads?.download) {
    return api.downloads.download({ url, filename, conflictAction: settings.conflictAction, saveAs });
  }
  // Safari has no downloads API: fall back to an <a download> click.
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.split('/').pop();
  document.body.append(a);
  a.click();
  a.remove();
  return null;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  return saveFile(url, filename).finally(() => setTimeout(() => URL.revokeObjectURL(url), 120000));
}

// --------------------------------------------------------------- progress

function startTask(label) {
  state.abort?.abort();
  state.abort = new AbortController();
  $('status').classList.remove('hidden');
  $('statusText').textContent = label;
  $('progress').style.width = '0%';
  return state.abort.signal;
}

function progress(done, total, label) {
  $('progress').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  $('statusText').textContent = `${label} ${done}/${total}`;
}

function endTask() {
  $('status').classList.add('hidden');
  state.abort = null;
  state.gate.resume();
  $('pauseTask').textContent = 'Pause';
}

$('pauseTask').onclick = () => {
  if (state.gate.paused) state.gate.resume();
  else state.gate.pause();
  $('pauseTask').textContent = state.gate.paused ? 'Resume' : 'Pause';
  $('statusText').classList.toggle('paused', state.gate.paused);
};

$('cancel').onclick = () => {
  state.abort?.abort();
  endTask();
  toast('Cancelled');
};

// ----------------------------------------------------------------- filters

function num(id) {
  const v = parseInt($(id).value, 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function readFilters() {
  return {
    text: $('fText').value.trim(),
    regex: $('fRegex').checked,
    minWidth: num('fMinW'),
    minHeight: num('fMinH'),
    maxWidth: num('fMaxW'),
    maxHeight: num('fMaxH'),
    keepUnknownSize: $('fKeepUnknown').checked,
    hideTracking: $('fHideTracking').checked,
    aspect: $('fAspect').value,
    minBytes: num('fMinKB') * 1024,
    maxBytes: num('fMaxKB') * 1024,
    types: [...state.types],
    sources: [...state.sources],
    colors: [...state.colors],
    rights: $('fRights').value,
    domain: $('fDomain').value,
    hideDuplicates: $('fHideDupes').checked,
    selectedOnly: $('fSelectedOnly').checked,
    sortKey: $('sortKey').value,
    sortDir: $('sortDir').value,
  };
}

function writeFilters(f) {
  $('fText').value = f.text ?? '';
  $('fRegex').checked = !!f.regex;
  $('fMinW').value = f.minWidth || '';
  $('fMinH').value = f.minHeight || '';
  $('fMaxW').value = f.maxWidth || '';
  $('fMaxH').value = f.maxHeight || '';
  $('fKeepUnknown').checked = f.keepUnknownSize ?? true;
  $('fHideTracking').checked = f.hideTracking ?? true;
  $('fAspect').value = f.aspect || 'any';
  $('fMinKB').value = f.minBytes ? Math.round(f.minBytes / 1024) : '';
  $('fMaxKB').value = f.maxBytes ? Math.round(f.maxBytes / 1024) : '';
  state.types = new Set(f.types ?? []);
  state.sources = new Set(f.sources ?? []);
  state.colors = new Set(f.colors ?? []);
  $('fRights').value = f.rights || 'any';
  $('fHideDupes').checked = !!f.hideDuplicates;
  $('fSelectedOnly').checked = !!f.selectedOnly;
  $('sortKey').value = f.sortKey || 'order';
  $('sortDir').value = f.sortDir || 'asc';
}

function defaultFilters() {
  return {
    minWidth: settings.minWidth, minHeight: settings.minHeight,
    hideTracking: settings.hideTracking, keepUnknownSize: settings.keepUnknownSize,
  };
}

function renderChips(containerId, values, set, labels, counts) {
  const box = $(containerId);
  box.replaceChildren();
  for (const v of values) {
    if (!counts[v] && !set.has(v)) continue;
    const chip = document.createElement('label');
    chip.className = `chip${set.has(v) ? ' on' : ''}`;
    chip.innerHTML = `<input type="checkbox"><span></span><span class="n"></span>`;
    chip.children[1].textContent = labels?.[v] ?? v.toUpperCase();
    chip.children[2].textContent = counts[v] ?? 0;
    chip.firstChild.checked = set.has(v);
    chip.firstChild.onchange = () => {
      if (set.has(v)) set.delete(v);
      else set.add(v);
      render();
    };
    box.append(chip);
  }
  if (!box.children.length) box.innerHTML = '<span class="muted small">Nothing found yet</span>';
}

function renderFacets() {
  const typeCounts = {};
  const sourceCounts = {};
  const domains = {};
  const colorCounts = {};
  for (const img of state.images) {
    typeCounts[img.type] = (typeCounts[img.type] ?? 0) + 1;
    const family = colorFamily(img.color);
    if (family) colorCounts[family] = (colorCounts[family] ?? 0) + 1;
    for (const s of img.sources ?? [img.source]) sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
    const d = hostFromUrl(img.url) || 'inline (data URI)';
    domains[d] = (domains[d] ?? 0) + 1;
  }
  renderChips('fTypes', IMAGE_TYPES, state.types, null, typeCounts);
  renderChips('fSources', SOURCES, state.sources, SOURCE_LABELS, sourceCounts);
  renderChips('fColors', COLOR_FAMILIES, state.colors, COLOR_LABELS, colorCounts);
  if (!$('fColors').querySelector('.chip')) $('fColors').innerHTML = '<span class="muted small">Click Analyze to filter by colour</span>';

  const sel = $('fDomain');
  const current = sel.value;
  sel.replaceChildren(new Option(`All domains (${Object.keys(domains).length})`, ''));
  for (const [d, n] of Object.entries(domains).sort((a, b) => b[1] - a[1])) {
    sel.append(new Option(`${d} (${n})`, d.startsWith('inline') ? '' : d));
  }
  sel.value = current;
}

// ------------------------------------------------------------------ render

function cardMeta(img) {
  const dims = img.width && img.height ? `${img.width}×${img.height}` : '?×?';
  return { dims, size: img.bytes != null ? formatBytes(img.bytes) : '' };
}

function buildCard(img, index) {
  const card = document.createElement('div');
  card.className = `card${img.selected ? ' selected' : ''}${img.duplicateOf ? ' dupe' : ''}`;
  card.dataset.index = index;
  card.title = img.alt || img.title || img.url.slice(0, 300);

  const check = document.createElement('div');
  check.className = 'check';
  check.textContent = '✓';

  const thumb = document.createElement('div');
  thumb.className = 'thumb checker';
  const el = document.createElement('img');
  el.loading = 'lazy';
  el.decoding = 'async';
  el.alt = img.alt || '';
  el.referrerPolicy = 'no-referrer';
  el.onload = () => {
    if (!img.width || !img.height) {
      img.width = el.naturalWidth;
      img.height = el.naturalHeight;
      card.querySelector('.dims').textContent = cardMeta(img).dims;
    }
  };
  el.onerror = () => {
    // Retry once with the referrer (some CDNs require it), then give up.
    if (el.referrerPolicy === 'no-referrer') {
      el.referrerPolicy = 'strict-origin-when-cross-origin';
      el.src = safeImageSrc(img.url) ?? '';
    } else thumb.classList.add('broken');
  };
  el.src = safeImageSrc(img.url) ?? '';
  thumb.append(el);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const m = cardMeta(img);
  meta.innerHTML = '<span class="type"></span><span class="url"></span><span class="dims"></span><span class="size"></span>';
  meta.querySelector('.type').textContent = img.type;
  meta.querySelector('.url').textContent = img.url.startsWith('data:') ? `inline ${img.source}` : img.url;
  meta.querySelector('.dims').textContent = m.dims;
  meta.querySelector('.size').textContent = m.size;

  const zoom = document.createElement('button');
  zoom.className = 'zoom';
  zoom.textContent = '⤢';
  zoom.title = 'Preview';
  zoom.onclick = (e) => {
    e.stopPropagation();
    openLightbox(index);
  };

  card.append(check, thumb, meta, zoom);
  if (img.color) {
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = img.color;
    sw.title = `Dominant colour ${img.color}`;
    card.append(sw);
  }
  if (img.duplicateOf) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = 'duplicate';
    card.append(b);
  }
  if (img.rights) {
    const r = document.createElement('span');
    r.className = 'rights';
    r.textContent = rightsClass(img.rights) === 'open' ? 'CC' : '©';
    r.title = Object.entries(RIGHTS_LABELS).filter(([key]) => img.rights[key]).map(([key, label]) => `${label}: ${img.rights[key]}`).join('\n');
    card.append(r);
  }
  return card;
}

async function render() {
  // Install Referer rules before any thumbnail request goes out.
  await ensureReferer();
  const f = readFilters();
  if (!state.profile) storeSet(FILTER_STORE, f); // a profile's filters belong to that site
  const filtered = filterImages(state.images, { ...f, blocklist: [] });
  state.view = state.similar ? rankSimilar(filtered, state.similar.hash) : sortImages(filtered, f.sortKey, f.sortDir);
  renderFacets();
  $('keepBest').classList.toggle('hidden', !state.images.some((i) => i.duplicateOf));
  $('similarClear').classList.toggle('hidden', !state.similar);
  if (state.similar) $('similarClear').textContent = `Like ${state.similar.name} ✕`;

  // Render in pages so tens of thousands of results stay responsive; more
  // cards are appended as the user scrolls near the end.
  $('gallery').replaceChildren();
  state.rendered = 0;
  renderMore();

  const empty = $('empty');
  if (!state.images.length) {
    empty.textContent = state.mode === 'history' ? 'Choose a scrape from History.' : state.mode === 'collection' ? 'This collection is empty. Select images on any page and click ★ Save.' : 'No images found on this page yet. Try Auto-scroll or Rescan.';
    empty.classList.remove('hidden');
  } else if (!state.view.length) {
    empty.textContent = 'No images match your filters.';
    empty.classList.remove('hidden');
  } else empty.classList.add('hidden');

  updateStats();
}

function renderMore() {
  const gallery = $('gallery');
  const end = Math.min(state.view.length, state.rendered + PAGE_SIZE);
  const frag = document.createDocumentFragment();
  for (let i = state.rendered; i < end; i++) frag.append(buildCard(state.view[i], i));
  gallery.querySelector('.sentinel')?.remove();
  gallery.append(frag);
  state.rendered = end;
  if (end < state.view.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'sentinel';
    sentinel.textContent = `Showing ${end.toLocaleString()} of ${state.view.length.toLocaleString()}. Scroll for more`;
    gallery.append(sentinel);
    sentinelObserver.observe(sentinel);
  }
}

const sentinelObserver = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) {
    sentinelObserver.disconnect();
    renderMore();
  }
}, { root: $('gallery'), rootMargin: '800px' });

// Resolves once Referer rules for the current results are installed.
function ensureReferer() {
  // Referer rules modify requests to other hosts, which needs access to all sites.
  if (!access.granted) return Promise.resolve(0);
  return applyRefererRules(state.images, settings.sendReferer).catch(() => 0);
}

// Call first in a click handler: asks for access to all sites if needed (the prompt needs the click).
async function needAllSites() {
  if (await requestAllSites()) return true;
  toast(NEEDS_ACCESS, 7000);
  return false;
}

function updateStats() {
  const sel = selected();
  const known = sel.filter((i) => i.bytes != null);
  const bytes = known.reduce((n, i) => n + i.bytes, 0);
  $('stats').textContent = `${state.view.length.toLocaleString()} shown of ${state.images.length.toLocaleString()}`;
  $('selInfo').textContent = sel.length
    ? `${sel.length.toLocaleString()} selected${known.length ? ` · ${formatBytes(bytes)}${known.length < sel.length ? '+' : ''}` : ''}`
    : 'Nothing selected: click images to select, Shift+click for a range';
  for (const id of ['download', 'downloadZip', 'copyUrls', 'removeSel', 'saveBtn']) $(id).disabled = !sel.length;
}

function refreshCard(index) {
  const img = state.view[index];
  const card = $('gallery').children[index];
  if (!img || !card) return;
  card.classList.toggle('selected', !!img.selected);
}

// --------------------------------------------------------------- selection

function toggleSelect(index, { range = false } = {}) {
  const img = state.view[index];
  if (!img) return;
  if (range && state.lastClicked >= 0) {
    const [a, b] = [Math.min(state.lastClicked, index), Math.max(state.lastClicked, index)];
    const value = !img.selected;
    for (let i = a; i <= b; i++) {
      state.view[i].selected = value;
      refreshCard(i);
    }
  } else {
    img.selected = !img.selected;
    refreshCard(index);
  }
  state.lastClicked = index;
  updateStats();
}

function setAll(fn) {
  state.view.forEach((img, i) => {
    img.selected = fn(img);
    refreshCard(i);
  });
  updateStats();
}

$('gallery').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  toggleSelect(Number(card.dataset.index), { range: e.shiftKey });
});
$('gallery').addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (card) openLightbox(Number(card.dataset.index));
});

$('selAll').onclick = () => setAll(() => true);
$('selNone').onclick = () => setAll(() => false);
$('selInvert').onclick = () => setAll((i) => !i.selected);
$('removeSel').onclick = async () => {
  const gone = selected();
  state.images = state.images.filter((i) => !i.selected);
  render();
  if (state.mode === 'collection') {
    await saveCollections(removeImages(await loadCollections(), state.collectionId, gone.map((i) => i.url)));
    return toast(`Removed ${gone.length} images from the collection`);
  }
  toast(`Removed ${gone.length} images from the results`);
};

// ---------------------------------------------------------------- scanning

function mergeImages(fresh) {
  const prev = new Map(state.images.map((i) => [normalizeUrl(i.url, settings.ignoreQueryForDedupe), i]));
  const merged = dedupe(fresh, settings.ignoreQueryForDedupe).map((img) => {
    const old = prev.get(normalizeUrl(img.url, settings.ignoreQueryForDedupe));
    if (!old) return img;
    return {
      ...img,
      id: old.id,
      selected: old.selected,
      bytes: old.bytes,
      hash: old.hash,
      color: old.color,
      webpBytes: old.webpBytes,
      duplicateOf: old.duplicateOf,
      rights: mergeRights(img.rights, old.rights) ?? undefined,
      type: old.bytes != null ? old.type : img.type,
      width: Math.max(img.width || 0, old.width || 0),
      height: Math.max(img.height || 0, old.height || 0),
    };
  });
  const added = merged.filter((i) => !prev.has(normalizeUrl(i.url, settings.ignoreQueryForDedupe))).length;
  state.images = merged;
  return added;
}

function setSource(text) {
  $('sourceInfo').textContent = text;
  document.title = `Image Scraper · ${text}`;
}

async function resolveTargetTab() {
  const id = Number(params.get('tabId'));
  if (id) return api.tabs.get(id);
  // Side panel: the tab currently shown next to it.
  if (panel) return (await api.tabs.query({ active: true, currentWindow: true }))[0] ?? null;
  // Opened directly: use the most recently used web tab of this window.
  const tabs = await api.tabs.query({ currentWindow: true });
  return tabs
    .filter((t) => isScriptableUrl(t.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0] ?? null;
}

async function scan({ autoScroll = false, usePicked = false, quiet = false } = {}) {
  if (state.mode === 'alltabs') return scanAllTabs();
  if (state.mode === 'history' || state.mode === 'import' || state.mode === 'collection') return;
  if (!state.tab) {
    setSource('No web page to scan');
    render();
    return;
  }
  const signal = quiet ? null : startTask(autoScroll ? 'Scrolling page to load lazy images…' : 'Scanning page…');
  try {
    state.tab = await api.tabs.get(state.tab.id);
    const res = await scanTab(state.tab, { ...settings, autoScroll }, { usePicked });
    if (signal?.aborted) return;
    const added = mergeImages(res.images);
    setSource(`${res.title || res.url} · ${res.frames} frame${res.frames === 1 ? '' : 's'}${usePicked ? ' · picked area' : ''}`);
    render();
    if (quiet && added) toast(`${added} new image${added === 1 ? '' : 's'} found`);
    await saveHistory(res.title, res.url);
  } catch (err) {
    const msg = explainScanError(err);
    setSource(msg);
    toast(msg, 6000);
    render();
  } finally {
    if (!quiet) endTask();
  }
}

async function scanAllTabs() {
  const windowId = Number(params.get('windowId')) || undefined;
  const tabs = (await api.tabs.query(windowId ? { windowId } : { currentWindow: true })).filter((t) => isScriptableUrl(t.url));
  const signal = startTask('Scanning tabs…');
  const { images, errors } = await scanTabs(tabs, settings, (d, t) => progress(d, t, 'Scanning tabs'));
  endTask();
  if (signal.aborted) return;
  mergeImages(images);
  setSource(`${tabs.length} tabs · ${errors.length ? `${errors.length} could not be scanned` : 'all scanned'}`);
  if (errors.length && !access.granted) toast('Scanning other tabs needs access to all sites. Use "Allow access to all sites" above, then scan again.', 7000);
  render();
  await saveHistory(`${tabs.length} tabs`, tabs[0]?.url ?? '');
}

$('rescan').onclick = () => scan();
$('autoscroll').onclick = () => scan({ autoScroll: true });
$('alltabs').onclick = async () => {
  if (!(await needAllSites())) return;
  state.mode = 'alltabs';
  state.images = [];
  scan();
};

$('pick').onclick = async () => {
  if (!state.tab) return;
  const me = await api.tabs.getCurrent();
  await api.tabs.update(state.tab.id, { active: true });
  await api.windows.update(state.tab.windowId, { focused: true }).catch(() => {});
  try {
    const [res] = await callInTab(state.tab.id, 'pick', [], false);
    await api.tabs.update(me.id, { active: true });
    await api.windows.update(me.windowId, { focused: true }).catch(() => {});
    if (res?.picked) {
      state.images = [];
      await scan({ usePicked: true });
    }
  } catch (err) {
    toast(err.message);
  }
};

// Live monitoring: the content script's MutationObserver pings us on DOM changes.
const liveRescan = debounce(() => scan({ quiet: true }), 400);
api.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'page-images-changed' && state.live && sender.tab?.id === state.tab?.id) liveRescan();
});

$('live').onclick = async () => {
  if (!state.tab) return;
  state.live = !state.live;
  $('live').classList.toggle('active', state.live);
  await callInTab(state.tab.id, 'watch', [state.live], settings.allFrames).catch(() => {});
  toast(state.live ? 'Live mode on: new images are added as the page changes' : 'Live mode off');
};
window.addEventListener('pagehide', () => {
  if (state.live && state.tab) callInTab(state.tab.id, 'watch', [false], settings.allFrames).catch(() => {});
});

// -------------------------------------------------------------- side panel

// The side panel stays open while the user browses: follow the active tab of its window and rescan.
async function followTab(tab) {
  if (!tab) return;
  if (state.live && state.tab) callInTab(state.tab.id, 'watch', [false], settings.allFrames).catch(() => {});
  state.live = false;
  $('live').classList.remove('active');
  state.abort?.abort();
  if (!$('lightbox').classList.contains('hidden')) closeLightbox();
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  state.mode = 'tab';
  state.tab = tab;
  state.images = [];
  state.lastClicked = -1;
  state.historyId = null;
  state.similar = null;
  await applyProfile();
  if (!isScriptableUrl(tab.url)) {
    setSource('This page cannot be scanned');
    render();
    return;
  }
  setSource(tab.title || tab.url);
  await scan();
}

async function setupPanel() {
  document.body.classList.add('panel');
  const win = await api.windows.getCurrent().catch(() => null);
  api.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    if (win && windowId !== win.id) return;
    if (tabId !== state.tab?.id) followTab(await api.tabs.get(tabId).catch(() => null));
  });
  // The shown tab navigated to another page.
  api.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (tabId === state.tab?.id && info.status === 'complete' && tab.url !== state.tab.url) followTab(tab);
  });
}

// ------------------------------------------------------------------ import

function loadImported(images, title) {
  state.mode = 'import';
  state.live = false;
  state.similar = null;
  applyProfile();
  state.images = [];
  mergeImages(images.map((img, i) => ({
    source: 'imported', width: 0, height: 0, alt: '', pageUrl: '', ...img,
    id: `imp-${i}-${Math.random().toString(36).slice(2, 7)}`,
    order: i,
    type: img.type && img.type !== 'other' ? img.type : guessType(img.url),
    tabId: null,
  })));
  state.historyId = null;
  setSource(title);
  render();
  saveHistory(title, images[0]?.pageUrl || images[0]?.url || '');
}

async function importFromStorage(key) {
  const res = await api.storage.local.get(key);
  const data = res?.[key];
  await api.storage.local.remove(key).catch(() => {});
  if (!data?.images?.length) {
    setSource('Nothing to import');
    render();
    return;
  }
  loadImported(data.images, data.title || 'Imported images');
}

$('importBtn').onclick = () => $('importDialog').showModal();
$('importCancel').onclick = () => $('importDialog').close();
$('importFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (file) $('importText').value += `\n${await file.text()}`;
  e.target.value = '';
};
$('importGo').onclick = () => {
  const urls = extractUrls($('importText').value);
  if (!urls.length) return toast('No http(s) URLs found');
  $('importDialog').close();
  if ($('importAs').value === 'pages') {
    const q = new URLSearchParams({ urls: urls.join('\n'), autostart: '1' });
    api.tabs.create({ url: api.runtime.getURL(`bulk/bulk.html?${q}`) });
    return;
  }
  const add = urls.map((url) => ({ url, source: 'imported' }));
  if ($('importMode').value === 'append' && state.images.length) {
    mergeImages([...state.images, ...add.map((a, i) => ({ ...a, id: `imp-${Date.now()}-${i}`, type: guessType(a.url), width: 0, height: 0, alt: '', order: state.images.length + i }))]);
    render();
    toast(`Added ${urls.length.toLocaleString()} URLs`);
  } else loadImported(add, `Imported ${urls.length.toLocaleString()} URLs`);
  $('importText').value = '';
};
$('bulkBtn').onclick = () => {
  const q = state.tab?.url ? `?crawl=${encodeURIComponent(state.tab.url)}` : '';
  api.tabs.create({ url: api.runtime.getURL(`bulk/bulk.html${q}`) });
};

// ----------------------------------------------------------------- history

async function loadHistory() {
  const res = await api.storage.local.get(HISTORY_KEY);
  return res?.[HISTORY_KEY] ?? [];
}

async function saveHistory(title, url) {
  if (!state.images.length) return;
  const history = await loadHistory();
  state.historyId ??= `h${Date.now()}`;
  const entry = {
    id: state.historyId,
    time: Date.now(),
    title: title || url,
    url,
    count: state.images.length,
    thumb: state.images.find((i) => !i.url.startsWith('data:') && i.width >= 64)?.url ?? '',
    // Inline data URIs can be huge; store only real URLs.
    images: state.images
      .filter((i) => !i.url.startsWith('data:'))
      .slice(0, settings.historyImageLimit || Infinity)
      .map(({ url: u, type, width, height, alt, source, sources, pageUrl, bytes, rights, seo, seoRefs }) => ({ url: u, type, width, height, alt, source, sources, pageUrl, bytes, rights, seo, seoRefs })),
  };
  const next = [entry, ...history.filter((h) => h.id !== entry.id)].slice(0, settings.historyLimit);
  await api.storage.local.set({ [HISTORY_KEY]: next }).catch(() => {});
}

async function showHistory() {
  const history = await loadHistory();
  const list = $('historyList');
  list.replaceChildren();
  if (!history.length) list.innerHTML = '<p class="muted">No scrapes yet.</p>';
  for (const h of history) {
    const row = document.createElement('div');
    row.className = 'hist';
    row.innerHTML = '<img alt="" class="checker"><div><b></b><span class="muted small"></span></div>';
    row.querySelector('img').src = safeImageSrc(h.thumb) ?? '../icons/icon48.png';
    row.querySelector('b').textContent = h.title;
    row.querySelector('span').textContent = `${h.count} images · ${new Date(h.time).toLocaleString()} · ${hostFromUrl(h.url)}`;
    row.onclick = () => {
      state.mode = 'history';
      state.live = false;
      state.similar = null;
      applyProfile();
      state.images = h.images.map((i, n) => ({ ...i, id: `${h.id}-${n}`, order: n, tabId: null }));
      state.historyId = h.id;
      setSource(`History: ${h.title} (${new Date(h.time).toLocaleString()})`);
      $('historyPanel').classList.add('hidden');
      render();
    };
    list.append(row);
  }
  $('historyPanel').classList.remove('hidden');
}

$('historyBtn').onclick = showHistory;
$('closeHistory').onclick = () => $('historyPanel').classList.add('hidden');
$('clearHistory').onclick = async () => {
  await api.storage.local.remove(HISTORY_KEY);
  showHistory();
  toast('History cleared');
};

// ---------------------------------------------------------- analyze / dupes

async function analyzeImages(list, label) {
  const todo = list.filter((i) => i.bytes == null || !i.hash);
  if (!todo.length) return 0;
  await ensureReferer();
  const signal = startTask(label);
  let done = 0;
  let failed = 0;
  await mapLimit(todo, 6, async (img) => {
    try {
      Object.assign(img, await analyze(img, signal));
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      failed++;
    }
    progress(++done, todo.length, label);
  }, signal);
  endTask();
  return failed;
}

$('analyze').onclick = async () => {
  if (!(await needAllSites())) return;
  const failed = await analyzeImages(state.view, 'Analyzing');
  render();
  toast(failed ? `Analyzed. ${failed} images could not be fetched.` : 'Analysis complete: exact sizes, types and colours added');
};

$('dupes').onclick = async () => {
  if (!(await needAllSites())) return;
  await analyzeImages(state.images, 'Fingerprinting');
  const n = markVisualDuplicates(state.images, settings.duplicateThreshold);
  render();
  toast(n ? `${n} visual duplicates found. Tick "Hide visual duplicates" to hide them.` : 'No visual duplicates found');
};

$('keepBest').onclick = () => {
  const groups = duplicateGroups(state.images);
  for (const { best, others } of groups) {
    best.selected = true;
    for (const img of others) img.selected = false;
  }
  render();
  toast(`Selected the best copy in ${groups.length} group${groups.length === 1 ? '' : 's'} of duplicates`);
};

$('similarClear').onclick = () => {
  state.similar = null;
  render();
};

// --------------------------------------------------------------- downloads

// Settings with this site's profile applied.
const config = () => withProfile(settings, state.profile);

function filenameFor(img, index, now, convertTo, names = config()) {
  return buildFilename(names.filenameTemplate, names.folderTemplate, {
    ...img, index, date: now, ext: extFor(img, convertTo), title: img.pageTitle, pageUrl: img.pageUrl,
  });
}

const prepPlan = () => planFromSettings(settings, state.wmLogo);
const prepActive = () => Boolean(settings.prepEnabled) && planActive(prepPlan());

// True when downloads must be fetched and re-encoded (format change, resize or Prepare).
function needsProcessing(convertTo) {
  return convertTo !== 'original' || resizeActive(settings) || prepActive();
}

async function processBlob(blob, convertTo) {
  if (prepActive()) {
    const { blob: out, met } = await prepareImage(blob, convertTo, prepPlan(), settings.jpegQuality);
    if (!met) state.prepMissed++;
    return out;
  }
  return convert(blob, convertTo, settings.jpegQuality, {
    maxWidth: Number(settings.resizeMaxWidth) || 0, maxHeight: Number(settings.resizeMaxHeight) || 0,
  });
}

// True when downloads must go through fetch: re-encoding, or removing metadata.
function needsFetch(convertTo) {
  return needsProcessing(convertTo) || Boolean(settings.stripMetadata);
}

// Optional final step for every saved file: drop EXIF/GPS, XMP and comments (on the device).
async function finishBlob(blob) {
  if (!settings.stripMetadata) return blob;
  return (await removeMetadata(blob, settings.jpegQuality)).blob;
}

// Fetches (with retries) and optionally converts/resizes one image.
async function imageBlob(img, convertTo, signal) {
  let blob = await withRetry(() => fetchBlob(img, signal), settings.retries + 1, 1000, signal);
  if (needsProcessing(convertTo)) blob = await processBlob(blob, convertTo);
  return finishBlob(blob);
}

function useFetchPath(img, convertTo) {
  // Browser-managed downloads can't carry a Referer, so route those through
  // fetch (which the Referer rules apply to) when the option is on.
  return needsFetch(convertTo) || /^(data|blob):/.test(img.url) || !api.downloads?.download ||
    Boolean(settings.sendReferer && img.pageUrl && access.granted);
}

async function prepareQueue(list) {
  await ensureReferer();
  if (!settings.skipDownloaded) return { queue: list, log: await DownloadLog.load(), skipped: 0 };
  const log = await DownloadLog.load();
  const queue = list.filter((img) => !log.has(img.url));
  return { queue, log, skipped: list.length - queue.length };
}

async function downloadSelected() {
  const list = targetForAction();
  if (!list.length) return;
  const convertTo = $('convertTo').value;
  const now = new Date();
  const { queue, log, skipped } = await prepareQueue(list);
  if (!queue.length) return toast(`All ${list.length.toLocaleString()} images were downloaded before (skipped)`);
  const signal = startTask('Downloading');
  state.prepMissed = 0;
  let done = 0;
  const failed = [];
  await mapLimit(queue, settings.concurrency, async (img) => {
    await state.gate.wait(signal);
    const index = list.indexOf(img);
    try {
      const filename = filenameFor(img, index, now, convertTo);
      if (useFetchPath(img, convertTo)) {
        await saveBlob(await imageBlob(img, convertTo, signal), filename);
      } else {
        await withRetry(async () => {
          const id = await saveFile(img.url, filename, settings.saveAs && list.length === 1);
          await waitForDownload(id);
        }, settings.retries + 1, 1000, signal);
      }
      log.add(img.url);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      failed.push(img);
    }
    progress(++done, queue.length, 'Downloading');
    if (done % 50 === 0) log.save();
    await sleep(settings.requestDelay, signal).catch(() => {});
  }, signal);
  await log.save();
  endTask();
  for (const img of failed) img.failed = true;
  const parts = [`Downloaded ${(queue.length - failed.length).toLocaleString()}`];
  if (skipped) parts.push(`skipped ${skipped.toLocaleString()} already downloaded`);
  if (failed.length) parts.push(`${failed.length.toLocaleString()} failed after ${settings.retries + 1} attempts`);
  if (state.prepMissed) parts.push(`${state.prepMissed.toLocaleString()} over the target file size`);
  toast(parts.join(' · '), 5000);
}

// Builds the ZIP in batches and starts a new part whenever the size limit is
// reached, so memory use stays bounded and there's no total-size limit.
async function downloadZip() {
  const list = targetForAction();
  if (!list.length) return;
  const convertTo = $('convertTo').value;
  const now = new Date();
  const partLimit = Math.min(Math.max(1, settings.zipPartSizeMB || 1024), 3900) * 1024 * 1024;
  const { queue, log, skipped } = await prepareQueue(list);
  if (!queue.length) return toast(`All ${list.length.toLocaleString()} images were downloaded before (skipped)`);
  const signal = startTask('Packing ZIP');
  state.prepMissed = 0;
  const names = config();
  const first = queue[0];
  const baseName = applyTemplate(settings.zipName, { ...first, index: 0, date: now, pageUrl: first.pageUrl, title: first.pageTitle });
  const folder = applyTemplate(names.folderTemplate.split('/')[0] || '', { ...first, date: now, pageUrl: first.pageUrl });
  const failures = [];
  let sources = [];
  let zip = new ZipWriter();
  let part = 1;
  let packed = 0;
  let done = 0;
  const parts = [];

  const flush = async (last) => {
    if (!zip.count) return;
    if (last && failures.length) zip.add('failed-urls.txt', new TextEncoder().encode(failures.join('\n')), now);
    if (settings.zipSources && sources.length) zip.add('sources.csv', new TextEncoder().encode(sourcesToCSV(sources, now)), now);
    sources = [];
    const single = last && part === 1;
    const name = `${folder ? `${folder}/` : ''}${baseName}${single ? '' : `_part${String(part).padStart(2, '0')}`}.zip`;
    await saveBlob(new Blob([zip.finish()], { type: 'application/zip' }), name);
    parts.push(name);
    zip = new ZipWriter();
    part++;
  };

  const BATCH = Math.max(8, settings.concurrency * 4);
  for (let start = 0; start < queue.length && !signal.aborted; start += BATCH) {
    const batch = queue.slice(start, start + BATCH);
    const blobs = await mapLimit(batch, settings.concurrency + 2, async (img) => {
      await state.gate.wait(signal);
      try {
        const blob = await imageBlob(img, convertTo, signal);
        await sleep(settings.requestDelay, signal).catch(() => {});
        return blob;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        failures.push(img.url);
        return null;
      } finally {
        progress(++done, queue.length, `Packing ZIP part ${part}`);
      }
    }, signal);
    for (let i = 0; i < batch.length; i++) {
      const blob = blobs[i];
      if (!(blob instanceof Blob)) continue;
      if (zip.offset + blob.size > partLimit) await flush(false);
      const img = batch[i];
      const name = applyTemplate(names.filenameTemplate, { ...img, index: list.indexOf(img), date: now, pageUrl: img.pageUrl, title: img.pageTitle });
      const file = zip.add(`${name}.${extFor(img, convertTo)}`, new Uint8Array(await blob.arrayBuffer()), now);
      sources.push({ file, img });
      log.add(img.url);
      packed++;
    }
  }
  if (signal.aborted) return;
  await flush(true);
  await log.save();
  endTask();
  const extra = [
    parts.length > 1 ? `${parts.length} parts` : '',
    skipped ? `${skipped.toLocaleString()} skipped (downloaded before)` : '',
    failures.length ? `${failures.length.toLocaleString()} failed, listed in failed-urls.txt` : '',
    state.prepMissed ? `${state.prepMissed.toLocaleString()} over the target file size` : '',
  ].filter(Boolean).join(' · ');
  toast(`ZIP saved with ${packed.toLocaleString()} images${extra ? ` (${extra})` : ''}`, 5000);
}

$('download').onclick = async () => {
  // Plain downloads are handled by the browser; converting, resizing or removing metadata fetches the images first.
  if (needsFetch($('convertTo').value) && !(await needAllSites())) return;
  await downloadSelected();
};
$('downloadZip').onclick = async () => {
  if (!(await needAllSites())) return;
  await downloadZip();
};

$('copyUrls').onclick = async () => {
  const list = targetForAction();
  await navigator.clipboard.writeText(toText(list));
  toast(`Copied ${list.length} URLs`);
};

$('exportBtn').onclick = (e) => {
  e.stopPropagation();
  $('exportMenu').classList.toggle('hidden');
};
document.addEventListener('click', () => {
  $('exportMenu').classList.add('hidden');
  $('saveMenu').classList.add('hidden');
});
$('exportMenu').onclick = async (e) => {
  const fmt = e.target.dataset.export;
  const snippet = e.target.dataset.copy;
  if (!fmt && !snippet) return;
  const list = targetForAction().length ? targetForAction() : state.view;
  if (snippet) {
    const { text, skipped } = toSnippet(list, snippet);
    if (!text) return toast('Only images with a web address can be copied as code');
    await navigator.clipboard.writeText(text);
    return toast(`Copied ${(list.length - skipped).toLocaleString()} images${skipped ? ` (${skipped} inline images left out)` : ''}`);
  }
  if (fmt === 'pdf') return openPdfDialog(list);
  if (fmt === 'sitemap') return saveImageSitemap(list);
  if (fmt === 'sheet') {
    if (!(await needAllSites())) return;
    return createContactSheet(list);
  }
  const title = state.tab?.title || 'images';
  const out = {
    txt: [toText(list), 'text/plain'],
    csv: [toCSV(list), 'text/csv'],
    json: [toJSON(list), 'application/json'],
    html: [toHTMLGallery(list, `Images from ${title}`), 'text/html'],
  }[fmt];
  if (!out) return;
  const name = applyTemplate('{pagedomain}_{date}_images', { url: '', pageUrl: state.tab?.url ?? list[0]?.pageUrl });
  saveBlob(new Blob([out[0]], { type: out[1] }), `${name}.${fmt}`);
  toast(`Exported ${list.length} images as ${fmt.toUpperCase()}`);
};

// ---------------------------------------------------------------- lightbox

const zoom = { scale: 1, x: 0, y: 0, dragging: false, moved: false, sx: 0, sy: 0 };

function applyZoom() {
  $('lbImg').style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  $('lbStage').classList.toggle('zoomed', zoom.scale > 1);
}

function resetZoom() {
  Object.assign(zoom, { scale: 1, x: 0, y: 0 });
  applyZoom();
}

function zoomAt(clientX, clientY, nextScale) {
  const img = $('lbImg');
  const rect = img.getBoundingClientRect();
  const s2 = Math.min(12, Math.max(1, nextScale));
  const lx = (clientX - rect.left) / zoom.scale;
  const ly = (clientY - rect.top) / zoom.scale;
  zoom.x += lx * (zoom.scale - s2);
  zoom.y += ly * (zoom.scale - s2);
  zoom.scale = s2;
  if (s2 === 1) zoom.x = zoom.y = 0;
  applyZoom();
}

function openLightbox(index) {
  const img = state.view[index];
  if (!img) return;
  state.lightboxIndex = index;
  resetZoom();
  $('lbImg').src = safeImageSrc(img.url) ?? '';
  $('lbImg').alt = img.alt || '';
  $('lbTitle').textContent = img.alt || img.title || baseNameFromUrl(img.url);
  const rows = [
    ['Dimensions', img.width && img.height ? `${img.width} × ${img.height} px (${aspectOf(img)})` : 'unknown'],
    ['Displayed at', img.displayWidth ? `${img.displayWidth} × ${img.displayHeight} px` : '—'],
    ['Type', img.type.toUpperCase()],
    ['File size', formatBytes(img.bytes)],
    ['Found in', (img.sources ?? [img.source]).map((s) => SOURCE_LABELS[s] ?? s).join(', ')],
    ['Colour', img.color ?? '—'],
    ['Alt text', img.alt || '—'],
    ['Domain', hostFromUrl(img.url) || 'inline data'],
    ['Page', img.pageUrl ?? '—'],
    ['URL', img.url.length > 400 ? `${img.url.slice(0, 400)}…` : img.url],
    ...Object.entries(RIGHTS_LABELS).filter(([key]) => img.rights?.[key]).map(([key, label]) => [label, img.rights[key]]),
  ];
  const dl = $('lbMeta');
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  $('lbSelect').textContent = img.selected ? 'Deselect' : 'Select';
  $('lbHighlight').disabled = img.tabId == null;
  $('lbFrames').classList.toggle('hidden', img.type !== 'gif' || !canExtractFrames());
  for (const id of ['lbExif', 'lbPalette']) {
    $(id).classList.add('hidden');
    $(id).replaceChildren();
  }
  $('lightbox').classList.remove('hidden');
}

function closeLightbox() {
  $('lightbox').classList.add('hidden');
  $('lbImg').removeAttribute('src');
  state.lightboxIndex = -1;
}

function stepLightbox(delta) {
  if (!state.view.length) return;
  openLightbox((state.lightboxIndex + delta + state.view.length) % state.view.length);
}

const lbImage = () => state.view[state.lightboxIndex];

$('lbClose').onclick = closeLightbox;
$('lbPrev').onclick = () => stepLightbox(-1);
$('lbNext').onclick = () => stepLightbox(1);
$('lbImg').onload = () => {
  const img = lbImage();
  if (img && (!img.width || !img.height)) {
    img.width = $('lbImg').naturalWidth;
    img.height = $('lbImg').naturalHeight;
  }
};
$('lbStage').addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, zoom.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
}, { passive: false });
$('lbStage').addEventListener('pointerdown', (e) => {
  zoom.dragging = true;
  zoom.moved = false;
  zoom.sx = e.clientX;
  zoom.sy = e.clientY;
  $('lbStage').setPointerCapture(e.pointerId);
});
$('lbStage').addEventListener('pointermove', (e) => {
  if (!zoom.dragging || zoom.scale === 1) return;
  const dx = e.clientX - zoom.sx;
  const dy = e.clientY - zoom.sy;
  if (Math.abs(dx) + Math.abs(dy) > 3) zoom.moved = true;
  zoom.x += dx;
  zoom.y += dy;
  zoom.sx = e.clientX;
  zoom.sy = e.clientY;
  applyZoom();
});
$('lbStage').addEventListener('pointerup', (e) => {
  zoom.dragging = false;
  if (!zoom.moved) zoomAt(e.clientX, e.clientY, zoom.scale > 1 ? 1 : 2.5);
});

$('lbSelect').onclick = () => {
  toggleSelect(state.lightboxIndex);
  $('lbSelect').textContent = lbImage()?.selected ? 'Deselect' : 'Select';
};
$('lbDownload').onclick = async () => {
  if (needsFetch($('convertTo').value) && !(await needAllSites())) return;
  const img = lbImage();
  const filename = filenameFor(img, state.lightboxIndex, new Date(), $('convertTo').value);
  try {
    if (needsFetch($('convertTo').value) || /^(data|blob):/.test(img.url)) {
      let blob = await fetchBlob(img);
      blob = await finishBlob(await processBlob(blob, $('convertTo').value));
      await saveBlob(blob, filename);
    } else await saveFile(img.url, filename, settings.saveAs);
    toast('Download started');
  } catch (err) {
    toast(`Download failed: ${err.message}`);
  }
};
$('lbCopyImg').onclick = async () => {
  if (!(await needAllSites())) return;
  try {
    await copyImageToClipboard(await fetchBlob(lbImage()));
    toast('Image copied to clipboard');
  } catch (err) {
    toast(`Could not copy image: ${err.message}`);
  }
};
$('lbCopyUrl').onclick = async () => {
  await navigator.clipboard.writeText(lbImage().url);
  toast('URL copied');
};
$('lbOpen').onclick = async () => {
  const img = lbImage();
  if (img.url.startsWith('data:')) {
    const blob = await fetchBlob(img);
    api.tabs.create({ url: URL.createObjectURL(blob) });
  } else api.tabs.create({ url: img.url });
};
$('lbHighlight').onclick = async () => {
  const img = lbImage();
  try {
    const results = await callInTab(img.tabId, 'highlight', [img.url], settings.allFrames);
    const tab = await api.tabs.update(img.tabId, { active: true });
    await api.windows.update(tab.windowId, { focused: true }).catch(() => {});
    if (!results.some(Boolean)) toast('That image is no longer on the page (or is a meta/icon image)');
  } catch (err) {
    toast(err.message);
  }
};
$('lbSearchEngine').value = settings.reverseSearchEngine;
$('lbSearch').onclick = () => {
  const img = lbImage();
  if (img.url.startsWith('data:')) return toast('Inline images cannot be reverse searched by URL');
  api.tabs.create({ url: reverseSearchUrl($('lbSearchEngine').value, img.url) });
};

// ------------------------------------------------------------ photo info

const EXIF_ROWS = [
  ['Camera', (e) => [e.make, e.model].filter(Boolean).join(' ')],
  ['Lens', (e) => e.lensModel],
  ['Taken', (e) => e.dateTimeOriginal || e.dateTime],
  ['Exposure', (e) => [e.exposureTime, e.fNumber, e.iso ? `ISO ${e.iso}` : '', e.focalLength].filter(Boolean).join(' · ')],
  ['Software', (e) => e.software],
  ['Artist', (e) => e.artist],
  ['Copyright', (e) => e.copyright],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showPhotoInfo(meta, rights) {
  const box = $('lbExif');
  box.replaceChildren(el('h4', '', 'Photo info'));
  if (!meta) {
    box.append(el('p', 'muted', 'Metadata can be read from JPEG, PNG and WebP files only.'));
  } else {
    const e = meta.exif ?? {};
    const dl = el('dl');
    for (const [label, get] of EXIF_ROWS) {
      const value = get(e);
      if (value) dl.append(el('dt', '', label), el('dd', '', String(value)));
    }
    if (e.gps) dl.append(el('dt', '', 'Location'), el('dd', '', `${e.gps.lat}, ${e.gps.lon}`));
    if (dl.childElementCount) box.append(dl);
    if (e.gps) {
      box.append(el('p', 'warn', 'This photo contains the GPS location where it was taken. Tick "Remove metadata" before downloading to save it without.'));
    }
    const extras = [meta.hasXmp && 'XMP', meta.hasText && 'text notes'].filter(Boolean);
    if (!dl.childElementCount && !e.gps) box.append(el('p', 'muted', extras.length ? '' : 'No camera or location metadata in this file.'));
    if (meta.metadataBytes) {
      box.append(el('p', 'muted small', `Metadata: ${formatBytes(meta.metadataBytes)}${extras.length ? ` (includes ${extras.join(' and ')})` : ''}.`));
    }
  }
  if (rights) {
    const e = meta?.exif ?? {};
    const dl = el('dl');
    for (const [key, label] of Object.entries(RIGHTS_LABELS)) {
      if (rights[key] && rights[key] !== e.artist && rights[key] !== e.copyright) dl.append(el('dt', '', label), el('dd', '', rights[key]));
    }
    box.append(dl, el('p', 'muted small', 'Credit and licence are shown as stated. Check them before reusing an image.'));
  }
  box.classList.remove('hidden');
}

$('lbInfo').onclick = async () => {
  if (!(await needAllSites())) return;
  const img = lbImage();
  try {
    const blob = await fetchBlob(img);
    if (lbImage() !== img) return;
    const bytes = await blob.arrayBuffer();
    img.rights = mergeRights(img.rights, readRights(bytes)) ?? undefined;
    showPhotoInfo(readMetadata(bytes), img.rights);
  } catch (err) {
    toast(`Could not read the file: ${err.message}`);
  }
};

$('lbSimilar').onclick = async () => {
  if (!(await needAllSites())) return;
  const img = lbImage();
  closeLightbox();
  await analyzeImages(state.images, 'Comparing images');
  if (!img.hash) return toast('This image could not be compared');
  state.similar = { hash: img.hash, name: baseNameFromUrl(img.url).slice(0, 30) };
  render();
};

$('lbFrames').onclick = async () => {
  if (!(await needAllSites())) return;
  const img = lbImage();
  try {
    const folder = applyTemplate(config().folderTemplate, { ...img, date: new Date(), title: img.pageTitle });
    await openFrames(await fetchBlob(img), {
      name: baseNameFromUrl(img.url),
      saveBlob: (blob, name) => saveBlob(blob, folder ? `${folder}/${name}` : name),
      toast,
    });
  } catch (err) {
    toast(`Could not read the frames: ${err.message}`);
  }
};

// ----------------------------------------------------------------- editor

$('lbEdit').onclick = async () => {
  if (!(await needAllSites())) return;
  const img = lbImage();
  const index = state.lightboxIndex;
  try {
    const blob = await fetchBlob(img);
    await openEditor(blob, {
      quality: settings.jpegQuality,
      toast,
      save: async (out, ext) => {
        const name = filenameFor({ ...img, type: ext }, index, new Date(), 'original').replace(/(\.[^./]+)?$/, `-edited.${ext}`);
        await saveBlob(out, name);
        toast('Download started');
      },
      copy: async (out) => {
        await copyImageToClipboard(out);
        toast('Edited image copied to clipboard');
      },
    });
  } catch (err) {
    toast(`Could not open the editor: ${err.message}`);
  }
};

// ------------------------------------------------------------------ audit

let auditReport = null;
let auditPages = [];
let auditPageFindings = []; // page-level SEO findings (social and structured-data images)
let auditRule = '';
let auditPage = ''; // show only this page's images
let auditView = 'image'; // image | page

function auditTargets() {
  return state.images.filter((i) => i.pageUrl || i.tabId != null);
}

function renderAudit() {
  const targets = auditTargets();
  const report = (auditReport = auditImages(targets));
  // Page checks need the meta tags and JSON-LD, which tab scans skip when "meta images" is off.
  const findings = (auditPageFindings = settings.scanMeta || state.mode === 'import' ? auditPageSeo(targets) : []);
  const saving = report.savingBytes ? ` · about ${formatBytes(report.savingBytes)} could be saved` : '';
  const pageNote = findings.length ? ` ${findings.length.toLocaleString()} page SEO finding${findings.length === 1 ? '' : 's'}.` : '';
  const sizeNote = findings.length && socialSizesUnknown(targets) ? ' Run Analyze to check social image sizes.' : '';
  $('auditSummary').textContent = report.total
    ? `${report.withIssues.toLocaleString()} of ${report.total.toLocaleString()} images have findings${saving}.${pageNote}${sizeNote}`
    : 'No images to check. Scan a page first.';
  $('auditSitemap').disabled = !report.total;
  auditPages = auditByPage(report, findings);
  $('auditViewWrap').classList.toggle('hidden', auditPages.length < 2);
  if (auditPages.length < 2) auditView = 'image';
  $('auditView').value = auditView;
  const chips = $('auditRules');
  chips.replaceChildren();
  chips.classList.toggle('hidden', auditView === 'page');
  if (auditView === 'page') return renderAuditPages();
  if (auditPage) {
    const chip = el('button', 'chip on', `${hostFromUrl(auditPage)}${safePath(auditPage)} ✕`);
    chip.title = 'Show every page';
    chip.onclick = () => {
      auditPage = '';
      renderAudit();
    };
    chips.append(chip);
  }
  const pageFindings = auditPageFindings.filter((f) => !auditPage || f.page === auditPage);
  const pageCounts = {};
  for (const f of pageFindings) pageCounts[f.rule] = (pageCounts[f.rule] ?? 0) + 1;
  const ruleOf = (id) => RULES[id] ?? PAGE_RULES[id];
  const countOf = (id) => (RULES[id] ? report.byRule[id].count : pageCounts[id]);
  const ruleIds = [...Object.keys(PAGE_RULES).filter((id) => pageCounts[id]), ...Object.keys(RULES).filter((id) => report.byRule[id]?.count)];
  if (auditRule && !ruleIds.includes(auditRule)) auditRule = '';
  for (const id of ['', ...ruleIds]) {
    const chip = el('button', `chip${id === auditRule ? ' on' : ''}${id && ruleOf(id).severity === 'error' ? ' error' : ''}`);
    chip.append(id ? ruleOf(id).label : 'All findings', el('span', 'n', String(id ? countOf(id) : report.withIssues + pageFindings.length)));
    chip.onclick = () => {
      auditRule = id;
      renderAudit();
    };
    chips.append(chip);
  }
  const list = $('auditList');
  list.replaceChildren();
  for (const f of pageFindings.filter((x) => !auditRule || x.rule === auditRule).slice(0, 500)) {
    const row = el('div', 'audit-item page-finding');
    row.append(el('span', 'page-icon', '🌐'));
    const body = el('div', 'body');
    body.append(el('span', 'url', f.title || f.page));
    if (f.title) body.append(el('span', 'url muted', f.page));
    const li = el('li');
    li.append(el('span', `sev ${f.severity}`, f.severity), f.label);
    if (f.detail) li.append(el('span', 'muted', ` — ${f.detail}`));
    const ul = el('ul');
    ul.append(li);
    body.append(ul, el('span', 'muted small', f.fix));
    row.append(body);
    row.title = f.fix;
    list.append(row);
  }
  const items = report.items.filter((it) => (!auditRule || it.issues.some((x) => x.rule === auditRule)) && (!auditPage || it.img.pageUrl === auditPage));
  for (const { img, issues } of items.slice(0, 500)) {
    const row = el('div', 'audit-item');
    const thumb = el('img', 'checker');
    thumb.src = safeImageSrc(img.url) ?? '';
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.onerror = () => (thumb.style.visibility = 'hidden');
    const body = el('div', 'body');
    body.append(el('span', 'url', img.url.length > 300 ? `${img.url.slice(0, 300)}…` : img.url));
    const ul = el('ul');
    for (const issue of issues) {
      const li = el('li');
      li.append(el('span', `sev ${issue.severity}`, issue.severity), `${RULES[issue.rule].label}`);
      if (issue.detail) li.append(el('span', 'muted', ` — ${issue.detail}`));
      li.title = RULES[issue.rule].fix;
      ul.append(li);
    }
    body.append(ul);
    row.append(thumb, body);
    row.title = 'Open in the preview';
    row.onclick = () => {
      const index = state.view.indexOf(img);
      if (index < 0) return toast('That image is hidden by the current filters');
      $('auditDialog').close();
      openLightbox(index);
    };
    list.append(row);
  }
  if (items.length > 500) list.append(el('p', 'muted small', `…and ${items.length - 500} more (all included in the CSV).`));
  if (report.total && !items.length && !pageFindings.length) list.append(el('p', 'muted small', 'Nothing to report.'));
  $('auditCsv').disabled = !report.withIssues && !pageFindings.length;
}

function safePath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function renderAuditPages() {
  const list = $('auditList');
  list.replaceChildren();
  for (const p of auditPages.slice(0, 500)) {
    const row = el('div', 'audit-item');
    const body = el('div', 'body');
    const counts = [
      `${p.images.toLocaleString()} image${p.images === 1 ? '' : 's'}`,
      p.errors && `${p.errors} error${p.errors === 1 ? '' : 's'}`,
      p.warnings && `${p.warnings} warning${p.warnings === 1 ? '' : 's'}`,
      p.notes && `${p.notes} note${p.notes === 1 ? '' : 's'}`,
      p.savingBytes && `about ${formatBytes(p.savingBytes)} to save`,
    ].filter(Boolean).join(' · ');
    body.append(el('span', 'url', p.title || p.page), el('span', 'url muted', p.page), el('span', '', counts));
    row.append(body);
    row.title = 'Show the findings for this page';
    row.onclick = () => {
      auditPage = p.page;
      auditView = 'image';
      renderAudit();
    };
    list.append(row);
  }
  if (auditPages.length > 500) list.append(el('p', 'muted small', `…and ${auditPages.length - 500} more (all included in the CSV).`));
  if (!auditPages.length) list.append(el('p', 'muted small', 'Nothing to report.'));
  $('auditCsv').disabled = !auditPages.length;
}

$('auditView').onchange = () => {
  auditView = $('auditView').value;
  auditPage = '';
  renderAudit();
};

$('auditBtn').onclick = () => {
  auditRule = '';
  auditPage = '';
  renderAudit();
  $('auditDialog').showModal();
};
$('auditClose').onclick = () => $('auditDialog').close();
$('auditSitemap').onclick = () => saveImageSitemap(auditTargets());

// Google image sitemap of the pages the images were found on, ready to submit in Search Console.
function saveImageSitemap(list) {
  const files = imageSitemaps(list);
  if (!files.length) return toast('No images with a page address to put in a sitemap');
  const name = applyTemplate('{pagedomain}_{date}_image-sitemap', { url: '', pageUrl: state.tab?.url ?? list[0]?.pageUrl });
  files.forEach((x, i) => saveBlob(new Blob([x], { type: 'application/xml' }), `${name}${files.length > 1 ? `-${i + 1}` : ''}.xml`));
  toast(`Saved an image sitemap for ${list.length.toLocaleString()} images${files.length > 1 ? ` in ${files.length} files` : ''}`);
}
$('auditCsv').onclick = () => {
  if (!auditReport) return;
  const name = applyTemplate('{pagedomain}_{date}_image-audit', { url: '', pageUrl: state.tab?.url ?? auditReport.items[0]?.img.pageUrl });
  const csv = auditView === 'page' ? pageAuditToCSV(auditPages) : auditToCSV(auditReport, auditPageFindings);
  saveBlob(new Blob([csv], { type: 'text/csv' }), `${name}${auditView === 'page' ? '-pages' : ''}.csv`);
};
$('auditMeasure').onclick = async () => {
  if (!(await needAllSites())) return;
  const todo = auditTargets().filter((i) => ['jpg', 'png', 'bmp'].includes(i.type) && i.webpBytes == null);
  if (!todo.length) return toast('Nothing left to measure');
  $('auditMeasure').disabled = true;
  await ensureReferer();
  const signal = startTask('Measuring WebP size');
  let done = 0;
  await mapLimit(todo, 3, async (img) => {
    try {
      const blob = await fetchBlob(img, signal);
      img.bytes ??= blob.size;
      img.webpBytes = (await convert(blob, 'webp', settings.jpegQuality)).size;
    } catch { /* unreachable image: leave it unmeasured */ }
    progress(++done, todo.length, 'Measuring WebP size');
    $('auditMeasure').textContent = `Measuring ${done}/${todo.length}…`; // the status bar is behind the dialog
  }, signal);
  endTask();
  $('auditMeasure').textContent = 'Measure WebP savings';
  $('auditMeasure').disabled = false;
  renderAudit();
};

// ------------------------------------------------------- PDF & contact sheet

const MAX_PDF_PAGES = 1000;
let pdfList = [];

function exportName() {
  return applyTemplate('{pagedomain}_{date}_images', { url: '', pageUrl: state.tab?.url ?? pdfList[0]?.pageUrl ?? state.view[0]?.pageUrl });
}

function openPdfDialog(list) {
  if (!list.length) return toast('No images to export');
  pdfList = list.slice(0, MAX_PDF_PAGES);
  const cut = list.length > MAX_PDF_PAGES ? ` (the first ${MAX_PDF_PAGES.toLocaleString()} of ${list.length.toLocaleString()})` : '';
  const which = targetForAction().length ? 'selected' : 'shown';
  $('pdfInfo').textContent = `${pdfList.length.toLocaleString()} ${which} image${pdfList.length === 1 ? '' : 's'}${cut}, one per page.`;
  $('pdfDialog').showModal();
}
$('pdfCancel').onclick = () => $('pdfDialog').close();
$('pdfGo').onclick = async () => {
  if (!(await needAllSites())) return;
  $('pdfDialog').close();
  await createPdf(pdfList, { pageSize: $('pdfPage').value, margin: Number($('pdfMargin').value) || 0 });
};

async function createPdf(list, { pageSize, margin }) {
  await ensureReferer();
  const signal = startTask('Making PDF');
  const pages = new Array(list.length);
  let done = 0;
  let failed = 0;
  await mapLimit(list, settings.concurrency, async (img, i) => {
    await state.gate.wait(signal);
    try {
      const blob = await withRetry(() => fetchBlob(img, signal), settings.retries + 1, 1000, signal);
      pages[i] = await pdfImage(blob, settings.jpegQuality);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      failed++;
    }
    progress(++done, list.length, 'Making PDF');
  }, signal);
  if (signal.aborted) return;
  const ok = pages.filter(Boolean);
  if (!ok.length) {
    endTask();
    return toast('None of the images could be loaded, so no PDF was made');
  }
  const title = state.tab?.title || list[0]?.pageTitle || 'Images';
  const pdf = buildPdf(ok, { pageSize, margin, title });
  await saveBlob(new Blob(pdf.chunks, { type: 'application/pdf' }), `${exportName()}.pdf`);
  endTask();
  toast(`PDF saved with ${ok.length.toLocaleString()} pages (${formatBytes(pdf.size)})${failed ? `; ${failed} images could not be loaded` : ''}`, 5000);
}

async function createContactSheet(list) {
  if (!list.length) return toast('No images to export');
  await ensureReferer();
  const layout = sheetLayout(list.length, { columns: list.length > 40 ? 6 : 5 });
  const signal = startTask('Making contact sheet');
  const title = `${state.tab?.title || list[0]?.pageTitle || 'Images'} · ${list.length.toLocaleString()} images`;
  const name = exportName();
  let done = 0;
  for (const [n, sheet] of layout.sheets.entries()) {
    const entries = [];
    await mapLimit(sheet.cells, settings.concurrency + 2, async (cell) => {
      const img = list[cell.index];
      let blob = null;
      try {
        blob = await fetchBlob(img, signal);
      } catch { /* drawn as an empty box */ }
      const size = img.width && img.height ? `${img.width}×${img.height}` : '';
      entries[cell.index] = { blob, label: baseNameFromUrl(img.url) || hostFromUrl(img.url), detail: [size, img.type?.toUpperCase(), formatBytes(img.bytes ?? blob?.size)].filter((x) => x && x !== '—').join(' · ') };
      progress(++done, list.length, 'Making contact sheet');
    }, signal);
    if (signal.aborted) return;
    const many = layout.sheets.length > 1;
    const png = await renderContactSheet(layout, sheet, entries, many ? `${title} (${n + 1}/${layout.sheets.length})` : title);
    await saveBlob(png, `${name}_contact-sheet${many ? `-${n + 1}` : ''}.png`);
  }
  endTask();
  toast(layout.sheets.length > 1 ? `${layout.sheets.length} contact sheets saved` : 'Contact sheet saved');
}

// ---------------------------------------------------------------- prepare

function fillPrepare() {
  const box = $('prepSize');
  if (!box.options.length) {
    box.append(new Option('Keep the size', 'none'));
    for (const [id, preset] of Object.entries(SIZE_PRESETS)) box.append(new Option(preset.label, id));
    box.append(new Option('Custom size', 'custom'));
  }
  box.value = settings.prepSize;
  $('prepWidth').value = settings.prepWidth;
  $('prepHeight').value = settings.prepHeight;
  $('prepFit').value = settings.prepFit;
  $('prepBackground').value = settings.prepBackground;
  $('prepMaxKB').value = settings.prepMaxKB;
  $('wmText').value = settings.prepWatermarkText;
  $('wmPosition').value = settings.prepWatermarkPosition;
  $('wmOpacity').value = settings.prepWatermarkOpacity;
  $('wmScale').value = settings.prepWatermarkScale;
  syncPrepare();
}

function syncPrepare() {
  const none = $('prepSize').value === 'none';
  $('prepCustom').classList.toggle('hidden', $('prepSize').value !== 'custom');
  $('prepFit').disabled = none;
  $('prepBgWrap').classList.toggle('hidden', none || $('prepFit').value !== 'contain');
  $('wmLogoInfo').textContent = state.wmLogo ? `Logo in use (${state.wmLogo.width} × ${state.wmLogo.height}), replaces the text` : '';
  $('wmLogoClear').classList.toggle('hidden', !state.wmLogo);
}

async function savePrepare() {
  settings = await saveSettings({
    prepSize: $('prepSize').value,
    prepWidth: num('prepWidth') || settings.prepWidth,
    prepHeight: num('prepHeight') || settings.prepHeight,
    prepFit: $('prepFit').value,
    prepBackground: $('prepBackground').value,
    prepMaxKB: num('prepMaxKB'),
    prepWatermarkText: $('wmText').value.trim(),
    prepWatermarkPosition: $('wmPosition').value,
    prepWatermarkOpacity: Number($('wmOpacity').value),
    prepWatermarkScale: Number($('wmScale').value),
  });
}

async function loadLogo() {
  const stored = await api.storage.local.get(LOGO_KEY).catch(() => ({}));
  if (!stored?.[LOGO_KEY]) return;
  state.wmLogo = await fetch(stored[LOGO_KEY]).then((r) => r.blob()).then(createImageBitmap).catch(() => null);
}

$('prepBtn').onclick = () => {
  fillPrepare();
  $('prepareDialog').showModal();
};
for (const id of ['prepSize', 'prepFit']) $(id).addEventListener('change', syncPrepare);
$('prepClose').onclick = $('prepDone').onclick = async () => {
  await savePrepare();
  $('prepareDialog').close();
  // Choosing something here means the user wants it used.
  if (planActive(prepPlan()) && !settings.prepEnabled) {
    settings = await saveSettings({ prepEnabled: true });
    $('prepOn').checked = true;
    toast('Prepare is on for your next downloads');
  }
};
$('prepOn').onchange = async () => {
  settings = await saveSettings({ prepEnabled: $('prepOn').checked });
  if (settings.prepEnabled && !planActive(prepPlan())) $('prepBtn').click();
};
$('wmLogo').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > MAX_LOGO_BYTES) {
    $('wmLogoInfo').textContent = 'That logo is larger than 2 MB';
    return;
  }
  try {
    state.wmLogo = await createImageBitmap(file);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await api.storage.local.set({ [LOGO_KEY]: dataUrl });
    syncPrepare();
  } catch {
    $('wmLogoInfo').textContent = 'That file could not be read as an image';
  }
};
$('wmLogoClear').onclick = async () => {
  state.wmLogo = null;
  await api.storage.local.remove(LOGO_KEY);
  syncPrepare();
};
$('prepPreview').onclick = async () => {
  const img = targetForAction()[0] ?? state.view[0];
  const info = $('prepPreviewInfo');
  if (!img) {
    info.textContent = 'Scan a page first';
    return;
  }
  if (!(await requestAllSites())) {
    info.textContent = NEEDS_ACCESS;
    return;
  }
  await savePrepare();
  info.textContent = 'Working…';
  try {
    await ensureReferer();
    const { blob, met } = await prepareImage(await fetchBlob(img), $('convertTo').value, prepPlan(), settings.jpegQuality);
    const preview = $('prepPreviewImg');
    URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(blob);
    await preview.decode();
    preview.classList.remove('hidden');
    info.textContent = `${preview.naturalWidth} × ${preview.naturalHeight} px · ${formatBytes(blob.size)}${met ? '' : ' · could not reach the target file size'}`;
  } catch (err) {
    info.textContent = `Could not prepare this image: ${err.message}`;
  }
};

// ------------------------------------------------------------------ names

let nameList = [];

function renderNames() {
  const now = new Date();
  const convertTo = $('convertTo').value;
  const names = { filenameTemplate: $('rnFile').value, folderTemplate: $('rnFolder').value };
  const { rows, clashes } = previewNames(nameList, (img, i) => filenameFor(img, i, now, convertTo, names));
  $('rnSummary').textContent = clashes
    ? `${clashes.toLocaleString()} of ${rows.length.toLocaleString()} names clash, so they would be numbered, overwritten or asked about, depending on your settings. Add {index} to keep them apart.`
    : `${rows.length.toLocaleString()} files, no name clashes.`;
  const list = $('rnList');
  list.replaceChildren();
  // Clashes first, so they can't be hidden past the row limit.
  for (const row of [...rows].sort((a, b) => b.clash - a.clash).slice(0, MAX_NAME_ROWS)) {
    const item = el('div', `name-row${row.clash ? ' clash' : ''}`);
    const from = baseNameFromUrl(row.img.url);
    item.append(el('span', 'muted', from), el('span', 'path', row.path));
    item.title = row.path;
    list.append(item);
  }
  if (rows.length > MAX_NAME_ROWS) list.append(el('p', 'muted small', `…and ${(rows.length - MAX_NAME_ROWS).toLocaleString()} more.`));
}

$('namesBtn').onclick = () => {
  nameList = targetForAction().length ? targetForAction() : state.view;
  if (!nameList.length) return toast('No images to name');
  const names = config();
  $('rnFile').value = names.filenameTemplate;
  $('rnFolder').value = names.folderTemplate;
  renderNames();
  $('namesDialog').showModal();
};
$('rnFile').oninput = $('rnFolder').oninput = debounce(renderNames, 150);
$('rnClose').onclick = () => $('namesDialog').close();
$('rnSave').onclick = async () => {
  const names = { filenameTemplate: $('rnFile').value.trim() || '{name}', folderTemplate: $('rnFolder').value.trim() };
  if (state.profile) {
    const { host, ...profile } = state.profile;
    await saveProfiles(setProfile(await loadProfiles(), host, { ...profile, ...names }));
    state.profile = { ...state.profile, ...names };
  } else settings = await saveSettings(names);
  $('namesDialog').close();
  toast(state.profile ? `Names saved for ${state.profile.host}` : 'Names saved');
};

// ---------------------------------------------------------- site profiles

const currentHost = () => (state.mode === 'tab' ? hostFromUrl(state.tab?.url) : '');

function showProfile() {
  const host = currentHost();
  $('profileBtn').disabled = !host;
  $('profileInfo').textContent = state.profile
    ? `Using the profile for ${state.profile.host}`
    : host ? `No profile for ${host}` : 'Available when scanning a web page';
}

// Uses the saved profile of the scanned website, or goes back to the usual filters when there is none.
async function applyProfile() {
  const url = state.mode === 'tab' ? state.tab?.url : '';
  const profile = url ? findProfile(await loadProfiles(), url) : null;
  const had = state.profile;
  state.profile = profile;
  if (profile?.filters) writeFilters({ ...defaultFilters(), ...profile.filters });
  else if (had?.filters) writeFilters({ ...defaultFilters(), ...(storeGet(FILTER_STORE) ?? {}) });
  $('convertTo').value = profile?.convertTo || settings.convertTo;
  showProfile();
}

$('profileBtn').onclick = () => {
  const p = state.profile;
  $('pfTitle').textContent = `Profile for ${p?.host ?? currentHost()}`;
  $('pfFilters').checked = p ? Boolean(p.filters) : true;
  $('pfFile').value = p?.filenameTemplate ?? '';
  $('pfFile').placeholder = settings.filenameTemplate;
  $('pfFolder').value = p?.folderTemplate ?? '';
  $('pfFolder').placeholder = settings.folderTemplate;
  $('pfFormat').value = p?.convertTo ?? '';
  $('pfRemove').classList.toggle('hidden', !p);
  $('profileDialog').showModal();
};
$('pfClose').onclick = () => $('profileDialog').close();
$('pfSave').onclick = async () => {
  const host = state.profile?.host ?? currentHost();
  const profile = {
    filters: $('pfFilters').checked ? profileFilters(readFilters()) : undefined,
    filenameTemplate: $('pfFile').value.trim(),
    folderTemplate: $('pfFolder').value.trim(),
    convertTo: $('pfFormat').value,
  };
  await saveProfiles(setProfile(await loadProfiles(), host, profile));
  state.profile = { host, ...profile };
  $('profileDialog').close();
  showProfile();
  toast(`Profile saved for ${host}`);
};
$('pfRemove').onclick = async () => {
  const { host } = state.profile;
  await saveProfiles(removeProfile(await loadProfiles(), host));
  $('profileDialog').close();
  await applyProfile();
  render();
  toast(`Profile removed for ${host}`);
};

// ------------------------------------------------------------ collections

function askName(title, value = '') {
  const dialog = $('nameDialog');
  $('nameTitle').textContent = title;
  $('nameInput').value = value;
  dialog.returnValue = '';
  dialog.showModal();
  $('nameInput').select();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? $('nameInput').value.trim() || null : null), { once: true });
  });
}

async function saveTo(id, images) {
  const r = addImages(await loadCollections(), id, images);
  await saveCollections(r.collections);
  const name = r.collections.find((c) => c.id === id)?.name ?? '';
  storeSet('last-collection', id);
  const extra = r.skipped ? ` (${r.skipped} already there or too large)` : '';
  toast(r.added ? `Saved ${r.added} image${r.added === 1 ? '' : 's'} to "${name}"${extra}` : `Nothing new to save to "${name}"${extra}`);
}

async function saveToNew(images) {
  const name = await askName('New collection');
  if (!name) return;
  const { collections, collection } = createCollection(await loadCollections(), name);
  await saveCollections(collections);
  await saveTo(collection.id, images);
}

// Buttons for "save these images to …": recent collections first, then "New collection…".
async function collectionChoices(images, after = () => {}) {
  const list = sortCollections(await loadCollections()).slice(0, 15);
  const buttons = list.map((c) => {
    const b = el('button', '', `${c.name} (${c.images.length})`);
    b.onclick = async () => {
      after();
      await saveTo(c.id, images);
    };
    return b;
  });
  const fresh = el('button', '', '+ New collection…');
  fresh.onclick = () => {
    after();
    saveToNew(images);
  };
  return [...buttons, fresh];
}

$('saveBtn').onclick = async (e) => {
  e.stopPropagation();
  const menu = $('saveMenu');
  if (!menu.classList.contains('hidden')) return menu.classList.add('hidden');
  const images = targetForAction();
  if (!images.length) return;
  const hide = () => menu.classList.add('hidden');
  menu.replaceChildren(el('div', 'menu-note', `Save ${images.length.toLocaleString()} image${images.length === 1 ? '' : 's'} to:`), ...(await collectionChoices(images, hide)));
  menu.classList.remove('hidden');
};

$('lbSave').onclick = async () => {
  const img = lbImage();
  const box = $('lbPalette');
  box.replaceChildren(el('h4', '', 'Save to collection'));
  const wrap = el('div', 'lb-actions');
  wrap.append(...(await collectionChoices([img], () => box.classList.add('hidden'))));
  box.append(wrap);
  box.classList.remove('hidden');
};

function openCollection(c) {
  state.mode = 'collection';
  state.collectionId = c.id;
  state.live = false;
  state.historyId = null;
  state.similar = null;
  applyProfile();
  state.images = c.images.map((img, n) => ({
    source: 'imported', alt: '', width: 0, height: 0, ...img,
    type: img.type && img.type !== 'other' ? img.type : guessType(img.url),
    id: `${c.id}-${n}`, order: n, tabId: null,
  }));
  setSource(`Collection: ${c.name} · ${c.images.length.toLocaleString()} images`);
  $('collectionsPanel').classList.add('hidden');
  render();
}

async function showCollections() {
  const list = $('collectionsList');
  list.replaceChildren();
  const all = sortCollections(await loadCollections());
  const shown = all.filter((c) => matchesCollection(c, $('collSearch').value));
  if (!all.length) list.append(el('p', 'muted', 'No collections yet. Select images and click ★ Save.'));
  else if (!shown.length) list.append(el('p', 'muted', 'No collections match your search.'));
  for (const c of shown) {
    const row = el('div', 'hist');
    const thumb = el('img', 'checker');
    thumb.alt = '';
    thumb.src = safeImageSrc(c.images.find((i) => !i.url.startsWith('data:'))?.url) ?? '../icons/icon48.png';
    thumb.onerror = () => (thumb.src = '../icons/icon48.png');
    const text = el('div');
    text.append(el('b', '', c.name), el('span', 'muted small', `${c.images.length.toLocaleString()} images · ${new Date(c.updated).toLocaleDateString()}`));
    if (c.tags?.length) text.append(el('span', 'small tags', c.tags.join(', ')));
    if (c.note) text.append(el('span', 'muted small', c.note));
    row.title = c.note ?? '';
    const actions = el('div', 'coll-actions');
    const details = el('button', '', 'Tags');
    details.title = 'Edit tags and note';
    details.onclick = async (e) => {
      e.stopPropagation();
      const edited = await askDetails(c);
      if (!edited) return;
      await saveCollections(setCollectionDetails(await loadCollections(), c.id, edited));
      showCollections();
    };
    const rename = el('button', '', 'Rename');
    rename.onclick = async (e) => {
      e.stopPropagation();
      const name = await askName('Rename collection', c.name);
      if (!name) return;
      await saveCollections(renameCollection(await loadCollections(), c.id, name));
      if (state.mode === 'collection' && state.collectionId === c.id) setSource(`Collection: ${name} · ${state.images.length.toLocaleString()} images`);
      showCollections();
    };
    const del = el('button', 'danger', 'Delete');
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete the collection "${c.name}"? The images on the websites are not affected.`)) return;
      await saveCollections(deleteCollection(await loadCollections(), c.id));
      showCollections();
    };
    actions.append(details, rename, del);
    row.append(thumb, text, actions);
    row.onclick = () => openCollection(c);
    list.append(row);
  }
  $('collectionsPanel').classList.remove('hidden');
}

function askDetails(c) {
  const dialog = $('collDialog');
  $('collTitle').textContent = c.name;
  $('collTags').value = (c.tags ?? []).join(', ');
  $('collNote').value = c.note ?? '';
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? { tags: $('collTags').value, note: $('collNote').value } : null), { once: true });
  });
}

$('collSearch').addEventListener('input', debounce(showCollections, 150));
$('backupCollections').onclick = async () => {
  const all = await loadCollections();
  if (!all.length) return toast('No collections to back up');
  const name = applyTemplate('image-scraper-collections_{date}', { url: '' });
  await saveBlob(new Blob([backupCollections(all)], { type: 'application/json' }), `${name}.json`);
  toast(`Backed up ${all.length} collection${all.length === 1 ? '' : 's'}`);
};
$('restoreCollections').onclick = () => $('collFile').click();
$('collFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { collections, created, images } = restoreCollections(await loadCollections(), await file.text());
    await saveCollections(collections);
    toast(`Restored ${created} new collection${created === 1 ? '' : 's'} and ${images.toLocaleString()} images`);
    showCollections();
  } catch (err) {
    toast(`Could not restore: ${err.message}`, 5000);
  }
};
$('collectionsBtn').onclick = showCollections;
$('closeCollections').onclick = () => $('collectionsPanel').classList.add('hidden');
$('newCollection').onclick = async () => {
  const name = await askName('New collection');
  if (!name) return;
  await saveCollections(createCollection(await loadCollections(), name).collections);
  showCollections();
};

// ---------------------------------------------------------------- colours

$('lbColours').onclick = async () => {
  if (!(await needAllSites())) return;
  const img = lbImage();
  let colours;
  try {
    colours = await paletteOf(await fetchBlob(img), 6);
  } catch (err) {
    return toast(`Could not read the image: ${err.message}`);
  }
  if (lbImage() !== img) return;
  const box = $('lbPalette');
  box.replaceChildren(el('h4', '', 'Colours'));
  if (!colours.length) {
    box.append(el('p', 'muted', 'This image is fully transparent.'));
  } else {
    const grid = el('div', 'swatches');
    for (const c of colours) {
      const b = el('button', 'swatch-btn', c.hex);
      b.append(el('small', '', `${Math.round(c.share * 100)}%`));
      b.style.background = c.hex;
      b.style.color = textColorFor(c.rgb);
      b.title = `Copy ${c.hex}`;
      b.onclick = async () => {
        await navigator.clipboard.writeText(c.hex);
        toast(`${c.hex} copied`);
      };
      grid.append(b);
    }
    const css = el('button', '', 'Copy as CSS variables');
    css.onclick = async () => {
      await navigator.clipboard.writeText(paletteToCSS(colours));
      toast('CSS variables copied');
    };
    const hexes = el('button', '', 'Copy HEX list');
    hexes.onclick = async () => {
      await navigator.clipboard.writeText(colours.map((c) => c.hex).join('\n'));
      toast('Colours copied');
    };
    const row = el('div', 'lb-actions');
    row.append(css, hexes);
    box.append(grid, row);
  }
  box.classList.remove('hidden');
};

// -------------------------------------------------------------- view & ui

function applyView() {
  $('gallery').className = `gallery ${settings.view}`;
  $('viewGrid').classList.toggle('active', settings.view === 'grid');
  $('viewList').classList.toggle('active', settings.view === 'list');
  document.documentElement.style.setProperty('--thumb', `${settings.thumbSize}px`);
  $('thumbSize').value = settings.thumbSize;
}

$('viewGrid').onclick = async () => {
  settings = await saveSettings({ view: 'grid' });
  applyView();
};
$('viewList').onclick = async () => {
  settings = await saveSettings({ view: 'list' });
  applyView();
};
$('thumbSize').oninput = () => document.documentElement.style.setProperty('--thumb', `${$('thumbSize').value}px`);
$('thumbSize').onchange = async () => {
  settings = await saveSettings({ thumbSize: Number($('thumbSize').value) });
};
$('toggleSidebar').onclick = () => $('sidebar').classList.toggle('collapsed');
$('optionsBtn').onclick = () => api.runtime.openOptionsPage();
$('themeBtn').onclick = async () => {
  const order = ['system', 'light', 'dark'];
  const theme = order[(order.indexOf(settings.theme) + 1) % order.length];
  settings = await saveSettings({ theme });
  applyTheme(theme);
  toast(`Theme: ${theme}`);
};

const rerender = debounce(render, 150);
for (const id of ['fText', 'fMinW', 'fMinH', 'fMaxW', 'fMaxH', 'fMinKB', 'fMaxKB']) $(id).addEventListener('input', rerender);
for (const id of ['fRegex', 'fKeepUnknown', 'fHideTracking', 'fAspect', 'fRights', 'fDomain', 'fHideDupes', 'fSelectedOnly', 'sortKey', 'sortDir']) {
  $(id).addEventListener('change', render);
}
document.querySelectorAll('[data-preset]').forEach((b) => {
  b.onclick = () => {
    const v = Number(b.dataset.preset);
    $('fMinW').value = v || '';
    $('fMinH').value = v === 1920 ? 1080 : v || '';
    render();
  };
});
$('resetFilters').onclick = () => {
  state.similar = null;
  writeFilters(defaultFilters());
  render();
};

// Keep settings in sync if the options page changes them while we're open.
api.storage.onChanged.addListener(async (changes) => {
  if (changes.settings) {
    settings = await loadSettings();
    applyTheme(settings.theme);
    applyView();
    $('stripMeta').checked = !!settings.stripMetadata;
    $('prepOn').checked = !!settings.prepEnabled;
  }
});

// ------------------------------------------------------------ keyboard

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return; // dialogs handle their own keys (Esc closes them)
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  const lightbox = !$('lightbox').classList.contains('hidden');
  if (lightbox) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
    else if (e.key === ' ') {
      e.preventDefault();
      $('lbSelect').click();
    } else if (e.key === '+' || e.key === '=') zoomAt(innerWidth / 2, innerHeight / 2, zoom.scale * 1.25);
    else if (e.key === '-') zoomAt(innerWidth / 2, innerHeight / 2, zoom.scale / 1.25);
    return;
  }
  if (e.key === 'Escape') {
    if (!$('historyPanel').classList.contains('hidden')) $('historyPanel').classList.add('hidden');
    else if (!$('collectionsPanel').classList.contains('hidden')) $('collectionsPanel').classList.add('hidden');
    else if (typing) document.activeElement.blur();
    else setAll(() => false);
    return;
  }
  if (typing) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === '/') {
    e.preventDefault();
    $('fText').focus();
  } else if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    setAll(() => true);
  } else if (mod && e.key.toLowerCase() === 'c' && !getSelection().toString()) {
    if (selected().length) $('copyUrls').click();
  } else if (!mod && e.key.toLowerCase() === 'd') $('download').click();
  else if (!mod && e.key.toLowerCase() === 'z') $('downloadZip').click();
  else if (!mod && e.key.toLowerCase() === 's' && selected().length) $('saveBtn').click();
  else if (!mod && e.key.toLowerCase() === 'r') scan();
  else if (e.key === 'Delete' || e.key === 'Backspace') $('removeSel').click();
});

// ------------------------------------------------------------------- boot

applyView();
mountAccessBanner(
  document.querySelector('main'),
  'Limited mode: scanning and downloading work on the page you opened this from. Analyze, ZIP, convert, duplicates, copy image and all-tabs scans need access to all sites.',
);
// "All tabs" opened before access was granted: scan again as soon as it is.
onAccessChange((granted) => {
  if (granted && state.mode === 'alltabs') scan();
});
writeFilters({ ...defaultFilters(), ...(storeGet(FILTER_STORE) ?? {}) });
$('convertTo').value = settings.convertTo;
$('stripMeta').checked = !!settings.stripMetadata;
$('stripMeta').onchange = async () => {
  settings = await saveSettings({ stripMetadata: $('stripMeta').checked });
};
$('prepOn').checked = !!settings.prepEnabled;
await loadLogo();
showProfile();
if (matchMedia('(max-width: 900px)').matches) $('sidebar').classList.add('collapsed');
if (panel) await setupPanel();

if (state.mode === 'history') {
  render();
  showHistory();
} else if (state.mode === 'collection') {
  const c = (await loadCollections()).find((x) => x.id === params.get('id'));
  if (c) openCollection(c);
  else {
    render();
    showCollections();
  }
} else if (state.mode === 'import') {
  await importFromStorage(params.get('key'));
  if (params.has('audit')) {
    auditView = 'page';
    $('auditBtn').click();
  }
} else if (state.mode === 'alltabs') {
  scan();
} else {
  state.tab = await resolveTargetTab().catch(() => null);
  if (state.tab) setSource(state.tab.title || state.tab.url);
  await applyProfile();
  if (params.get('pick')) {
    render();
    $('pick').click();
  } else {
    await scan({ autoScroll: params.has('autoscroll') || settings.autoScroll });
  }
}
