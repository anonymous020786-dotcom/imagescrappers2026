import { api, isScriptableUrl } from '../lib/browser.js';
import { applyTheme, loadSettings, saveSettings } from '../lib/settings.js';
import { callInTab, scanTab, scanTabs } from '../lib/scanner.js';
import { analyze, convert, copyImageToClipboard, fetchBlob } from '../lib/imaging.js';
import { ZipWriter } from '../lib/zip.js';
import {
  IMAGE_TYPES, applyTemplate, aspectOf, baseNameFromUrl, buildFilename, dedupe, extensionFromUrl,
  filterImages, formatBytes, hostFromUrl, mapLimit, markVisualDuplicates, normalizeUrl, reverseSearchUrl,
  sortImages, toCSV, toHTMLGallery, toJSON, toText,
} from '../lib/utils.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SOURCES = ['img', 'srcset', 'picture', 'lazy', 'css', 'pseudo', 'svg', 'canvas', 'poster', 'link', 'meta', 'icon'];
const SOURCE_LABELS = {
  img: '<img>', srcset: 'srcset', picture: '<picture>', lazy: 'lazy-load', css: 'CSS bg', pseudo: '::before/after',
  svg: 'inline SVG', canvas: 'canvas', poster: 'video poster', link: 'linked', meta: 'meta/og', icon: 'favicon',
};
const HISTORY_KEY = 'history';
const FILTER_STORE = 'dashboard-filters';

let settings = await loadSettings();
applyTheme(settings.theme);

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
}

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
  for (const img of state.images) {
    typeCounts[img.type] = (typeCounts[img.type] ?? 0) + 1;
    for (const s of img.sources ?? [img.source]) sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
    const d = hostFromUrl(img.url) || 'inline (data URI)';
    domains[d] = (domains[d] ?? 0) + 1;
  }
  renderChips('fTypes', IMAGE_TYPES, state.types, null, typeCounts);
  renderChips('fSources', SOURCES, state.sources, SOURCE_LABELS, sourceCounts);

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
      el.src = img.url;
    } else thumb.classList.add('broken');
  };
  el.src = img.url;
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
  return card;
}

function render() {
  const f = readFilters();
  storeSet(FILTER_STORE, f);
  const filtered = filterImages(state.images, { ...f, blocklist: [] });
  state.view = sortImages(filtered, f.sortKey, f.sortDir);
  renderFacets();

  const gallery = $('gallery');
  const frag = document.createDocumentFragment();
  state.view.forEach((img, i) => frag.append(buildCard(img, i)));
  gallery.replaceChildren(frag);

  const empty = $('empty');
  if (!state.images.length) {
    empty.textContent = state.mode === 'history' ? 'Choose a scrape from History.' : 'No images found on this page yet. Try Auto-scroll or Rescan.';
    empty.classList.remove('hidden');
  } else if (!state.view.length) {
    empty.textContent = 'No images match your filters.';
    empty.classList.remove('hidden');
  } else empty.classList.add('hidden');

  updateStats();
}

function updateStats() {
  const sel = selected();
  const known = sel.filter((i) => i.bytes != null);
  const bytes = known.reduce((n, i) => n + i.bytes, 0);
  $('stats').textContent = `${state.view.length} shown of ${state.images.length}`;
  $('selInfo').textContent = sel.length
    ? `${sel.length} selected${known.length ? ` · ${formatBytes(bytes)}${known.length < sel.length ? '+' : ''}` : ''}`
    : 'Nothing selected: click images to select, Shift+click for a range';
  for (const id of ['download', 'downloadZip', 'copyUrls', 'removeSel']) $(id).disabled = !sel.length;
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
$('removeSel').onclick = () => {
  const n = selected().length;
  state.images = state.images.filter((i) => !i.selected);
  render();
  toast(`Removed ${n} images from the results`);
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
      duplicateOf: old.duplicateOf,
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
  // Opened directly: use the most recently used web tab of this window.
  const tabs = await api.tabs.query({ currentWindow: true });
  return tabs
    .filter((t) => isScriptableUrl(t.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0] ?? null;
}

async function scan({ autoScroll = false, usePicked = false, quiet = false } = {}) {
  if (state.mode === 'alltabs') return scanAllTabs();
  if (state.mode === 'history') return;
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
    setSource(err.message);
    toast(err.message, 5000);
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
  render();
  await saveHistory(`${tabs.length} tabs`, tabs[0]?.url ?? '');
}

$('rescan').onclick = () => scan();
$('autoscroll').onclick = () => scan({ autoScroll: true });
$('alltabs').onclick = () => {
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
      .slice(0, 1500)
      .map(({ url: u, type, width, height, alt, source, sources, pageUrl, bytes }) => ({ url: u, type, width, height, alt, source, sources, pageUrl, bytes })),
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
    row.querySelector('img').src = h.thumb || '../icons/icon48.png';
    row.querySelector('b').textContent = h.title;
    row.querySelector('span').textContent = `${h.count} images · ${new Date(h.time).toLocaleString()} · ${hostFromUrl(h.url)}`;
    row.onclick = () => {
      state.mode = 'history';
      state.live = false;
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
  const todo = list.filter((i) => i.bytes == null);
  if (!todo.length) return 0;
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
  const failed = await analyzeImages(state.view, 'Analyzing');
  render();
  toast(failed ? `Analyzed. ${failed} images could not be fetched.` : 'Analysis complete: exact sizes, types and colours added');
};

$('dupes').onclick = async () => {
  await analyzeImages(state.images, 'Fingerprinting');
  const n = markVisualDuplicates(state.images, settings.duplicateThreshold);
  render();
  toast(n ? `${n} visual duplicates found. Tick "Hide visual duplicates" to hide them.` : 'No visual duplicates found');
};

// --------------------------------------------------------------- downloads

function filenameFor(img, index, now, convertTo) {
  return buildFilename(settings.filenameTemplate, settings.folderTemplate, {
    ...img, index, date: now, ext: extFor(img, convertTo), title: img.pageTitle, pageUrl: img.pageUrl,
  });
}

async function downloadSelected() {
  const list = targetForAction();
  if (!list.length) return;
  const convertTo = $('convertTo').value;
  const now = new Date();
  const signal = startTask('Downloading');
  let done = 0;
  let failed = 0;
  await mapLimit(list, settings.concurrency, async (img, index) => {
    try {
      const filename = filenameFor(img, index, now, convertTo);
      const needsBlob = convertTo !== 'original' || /^(data|blob):/.test(img.url) || !api.downloads?.download;
      if (needsBlob) {
        let blob = await fetchBlob(img, signal);
        if (convertTo !== 'original') blob = await convert(blob, convertTo, settings.jpegQuality);
        await saveBlob(blob, filename);
      } else {
        await saveFile(img.url, filename, settings.saveAs && list.length === 1);
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      failed++;
    }
    progress(++done, list.length, 'Downloading');
  }, signal);
  endTask();
  toast(failed ? `Downloaded ${list.length - failed}, ${failed} failed` : `Downloaded ${list.length} images`);
}

async function downloadZip() {
  const list = targetForAction();
  if (!list.length) return;
  const convertTo = $('convertTo').value;
  const now = new Date();
  const zip = new ZipWriter();
  const signal = startTask('Packing ZIP');
  let done = 0;
  const failures = [];
  const blobs = await mapLimit(list, settings.concurrency + 2, async (img) => {
    try {
      let blob = await fetchBlob(img, signal);
      if (convertTo !== 'original') blob = await convert(blob, convertTo, settings.jpegQuality);
      return blob;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      failures.push(img.url);
      return null;
    } finally {
      progress(++done, list.length, 'Fetching for ZIP');
    }
  }, signal);
  if (signal.aborted) return;
  for (let i = 0; i < list.length; i++) {
    const blob = blobs[i];
    if (!(blob instanceof Blob)) continue;
    const name = applyTemplate(settings.filenameTemplate, { ...list[i], index: i, date: now, pageUrl: list[i].pageUrl, title: list[i].pageTitle });
    zip.add(`${name}.${extFor(list[i], convertTo)}`, new Uint8Array(await blob.arrayBuffer()), now);
  }
  if (failures.length) zip.add('failed-urls.txt', new TextEncoder().encode(failures.join('\n')), now);
  const first = list[0];
  const zipName = buildFilename(settings.zipName, settings.folderTemplate.split('/')[0] || '', {
    ...first, index: 0, date: now, ext: 'zip', pageUrl: first.pageUrl, title: first.pageTitle,
  });
  await saveBlob(new Blob([zip.finish()], { type: 'application/zip' }), zipName);
  endTask();
  toast(`ZIP saved with ${list.length - failures.length} images${failures.length ? ` (${failures.length} failed, listed in failed-urls.txt)` : ''}`);
}

$('download').onclick = downloadSelected;
$('downloadZip').onclick = downloadZip;

$('copyUrls').onclick = async () => {
  const list = targetForAction();
  await navigator.clipboard.writeText(toText(list));
  toast(`Copied ${list.length} URLs`);
};

$('exportBtn').onclick = (e) => {
  e.stopPropagation();
  $('exportMenu').classList.toggle('hidden');
};
document.addEventListener('click', () => $('exportMenu').classList.add('hidden'));
$('exportMenu').onclick = (e) => {
  const fmt = e.target.dataset.export;
  if (!fmt) return;
  const list = targetForAction().length ? targetForAction() : state.view;
  const title = state.tab?.title || 'images';
  const out = {
    txt: [toText(list), 'text/plain'],
    csv: [toCSV(list), 'text/csv'],
    json: [toJSON(list), 'application/json'],
    html: [toHTMLGallery(list, `Images from ${title}`), 'text/html'],
  }[fmt];
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
  $('lbImg').src = img.url;
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
  const img = lbImage();
  const filename = filenameFor(img, state.lightboxIndex, new Date(), $('convertTo').value);
  try {
    if ($('convertTo').value !== 'original' || /^(data|blob):/.test(img.url)) {
      let blob = await fetchBlob(img);
      blob = await convert(blob, $('convertTo').value, settings.jpegQuality);
      await saveBlob(blob, filename);
    } else await saveFile(img.url, filename, settings.saveAs);
    toast('Download started');
  } catch (err) {
    toast(`Download failed: ${err.message}`);
  }
};
$('lbCopyImg').onclick = async () => {
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
for (const id of ['fRegex', 'fKeepUnknown', 'fHideTracking', 'fAspect', 'fDomain', 'fHideDupes', 'fSelectedOnly', 'sortKey', 'sortDir']) {
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
  writeFilters(defaultFilters());
  render();
};

// Keep settings in sync if the options page changes them while we're open.
api.storage.onChanged.addListener(async (changes) => {
  if (changes.settings) {
    settings = await loadSettings();
    applyTheme(settings.theme);
    applyView();
  }
});

// ------------------------------------------------------------ keyboard

document.addEventListener('keydown', (e) => {
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
  else if (!mod && e.key.toLowerCase() === 'r') scan();
  else if (e.key === 'Delete' || e.key === 'Backspace') $('removeSel').click();
});

// ------------------------------------------------------------------- boot

applyView();
writeFilters({ ...defaultFilters(), ...(storeGet(FILTER_STORE) ?? {}) });
$('convertTo').value = settings.convertTo;
if (matchMedia('(max-width: 900px)').matches) $('sidebar').classList.add('collapsed');

if (state.mode === 'history') {
  render();
  showHistory();
} else if (state.mode === 'alltabs') {
  scan();
} else {
  state.tab = await resolveTargetTab().catch(() => null);
  if (state.tab) setSource(state.tab.title || state.tab.url);
  if (params.get('pick')) {
    render();
    $('pick').click();
  } else {
    await scan({ autoScroll: params.has('autoscroll') || settings.autoScroll });
  }
}
