import { api } from '../lib/browser.js';
import { applyTheme, loadSettings } from '../lib/settings.js';
import { Crawler } from '../lib/crawler.js';
import { extractUrls } from '../lib/crawl.js';
import { expandPattern } from '../lib/urlgen.js';
import { guessType, toText } from '../lib/utils.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const settings = await loadSettings();
applyTheme(settings.theme);

const MAX_GENERATED = 1_000_000;
const OPTION_IDS = ['mode', 'concurrency', 'delay', 'maxPages', 'timeout', 'respectRobots', 'followNext', 'autoScroll', 'scope', 'maxDepth', 'include', 'exclude', 'useSitemap', 'patternAs'];
const STORE_KEY = 'bulk-options';

let activeTab = 'urls';
let crawler = null;
let results = [];
let startedAt = 0;

// ------------------------------------------------------------- ui helpers

function log(msg, level = 'info') {
  const li = document.createElement('li');
  li.className = level;
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  li.title = msg;
  const list = $('log');
  list.prepend(li);
  while (list.children.length > 1000) list.lastChild.remove();
}

function showTab(name) {
  activeTab = name;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const t of ['urls', 'crawl', 'generate']) $(`tab-${t}`).classList.toggle('hidden', t !== name);
}

function syncMode() {
  document.body.classList.toggle('render', $('mode').value === 'render');
}

function saveOptions() {
  const out = {};
  for (const id of OPTION_IDS) out[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch { /* storage unavailable */ }
}

function restoreOptions() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY));
  } catch { /* ignore */ }
  for (const [id, v] of Object.entries(saved ?? {})) {
    if (!$(id)) continue;
    if ($(id).type === 'checkbox') $(id).checked = v;
    else $(id).value = v;
  }
}

const list = (v) => v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
const int = (id) => Math.max(0, parseInt($(id).value, 10) || 0);

function updateUrlCount() {
  const n = extractUrls($('urlList').value).length;
  $('urlCount').textContent = n ? `${n.toLocaleString()} URL${n === 1 ? '' : 's'} detected` : '';
}

function updatePattern() {
  const p = $('pattern').value.trim();
  if (!p) {
    $('patternInfo').textContent = '';
    $('patternPreview').textContent = '';
    return;
  }
  const { urls, total } = expandPattern(p, 12);
  $('patternInfo').textContent = `${total.toLocaleString()} URL${total === 1 ? '' : 's'}${total > MAX_GENERATED ? ` (the first ${MAX_GENERATED.toLocaleString()} will be used)` : ''}`;
  $('patternPreview').textContent = urls.join('\n') + (total > urls.length ? '\n…' : '');
}

function setRunning(running) {
  $('start').disabled = running;
  $('pause').disabled = !running;
  $('stop').disabled = !running;
  $('pause').textContent = 'Pause';
  for (const el of document.querySelectorAll('.panel textarea, .panel input, .options input, .options select')) el.disabled = running;
}

function renderStats(s) {
  $('sPages').textContent = s.done.toLocaleString();
  $('sQueue').textContent = (s.queueLength + s.active).toLocaleString();
  $('sImages').textContent = s.images.toLocaleString();
  $('sFailed').textContent = s.failed.toLocaleString();
  $('sSkipped').textContent = s.skipped.toLocaleString();
  const minutes = (Date.now() - startedAt) / 60000;
  $('sRate').textContent = minutes > 0.05 ? Math.round(s.done / minutes).toLocaleString() : '–';
  const total = s.done + s.failed + s.skipped + s.queueLength + s.active;
  $('progress').style.width = `${total ? Math.round(((s.done + s.failed + s.skipped) / total) * 100) : 0}%`;
  const has = s.images > 0;
  $('openDashboard').disabled = !has;
  $('exportTxt').disabled = !has;
}

function addThumbs(images) {
  const box = $('thumbs');
  for (const img of images.filter((i) => !i.url.startsWith('data:')).slice(-40)) {
    const el = document.createElement('img');
    el.src = img.url;
    el.loading = 'lazy';
    el.alt = img.alt || '';
    el.title = img.url;
    el.className = 'checker';
    el.referrerPolicy = 'no-referrer';
    el.onerror = () => el.remove();
    box.prepend(el);
  }
  while (box.children.length > 120) box.lastChild.remove();
}

// --------------------------------------------------------------------- run

async function start() {
  saveOptions();
  const options = {
    mode: $('mode').value,
    concurrency: Math.max(1, int('concurrency')),
    delay: int('delay'),
    maxPages: int('maxPages'),
    timeout: Math.max(5, int('timeout')) * 1000,
    respectRobots: $('respectRobots').checked,
    followNext: $('followNext').checked,
    autoScroll: $('autoScroll').checked,
    maxDepth: 0,
    scope: 'page',
  };

  let seeds = [];
  if (activeTab === 'urls') {
    seeds = extractUrls($('urlList').value);
  } else if (activeTab === 'crawl') {
    seeds = extractUrls($('crawlStart').value);
    Object.assign(options, {
      scope: $('scope').value,
      maxDepth: int('maxDepth'),
      include: list($('include').value),
      exclude: list($('exclude').value),
      useSitemap: $('useSitemap').checked,
    });
  } else {
    const { urls, truncated } = expandPattern($('pattern').value, MAX_GENERATED);
    if (truncated) log(`Pattern truncated to ${MAX_GENERATED.toLocaleString()} URLs`, 'warn');
    if ($('patternAs').value === 'images') {
      results = urls.map((url, i) => ({ url, source: 'generated', sources: ['generated'], type: guessType(url), order: i, width: 0, height: 0, alt: '', pageUrl: '' }));
      log(`Generated ${results.length.toLocaleString()} image URLs. Open them in the dashboard to preview and download.`);
      renderStats({ done: 0, failed: 0, skipped: 0, queueLength: 0, active: 0, images: results.length });
      addThumbs(results.slice(0, 40));
      return;
    }
    seeds = urls;
  }

  if (!seeds.length) {
    log('Add at least one http(s) URL first.', 'warn');
    return;
  }

  results = [];
  $('thumbs').replaceChildren();
  startedAt = Date.now();
  setRunning(true);
  log(`Starting: ${seeds.length.toLocaleString()} URL${seeds.length === 1 ? '' : 's'}, ${options.mode} mode, ${options.concurrency} at once${options.maxPages ? `, max ${options.maxPages} pages` : ', no page limit'}`);

  crawler = new Crawler(options, settings, {
    onLog: log,
    onProgress: renderStats,
    onImages: addThumbs,
  });
  try {
    results = await crawler.run(seeds);
    log(crawler.abort.signal.aborted ? `Stopped. ${results.length.toLocaleString()} images collected.` : `Finished: ${results.length.toLocaleString()} images from ${crawler.stats.done.toLocaleString()} pages.`);
  } catch (err) {
    results = [...crawler.images.values()];
    log(`Stopped with an error: ${err.message}`, 'error');
  } finally {
    setRunning(false);
    renderStats({ ...crawler.stats, queueLength: 0, active: 0 });
  }
}

function currentResults() {
  return crawler && !results.length ? [...crawler.images.values()] : results;
}

async function openInDashboard() {
  const images = currentResults();
  if (!images.length) return;
  const key = `import:${Date.now()}`;
  const title = activeTab === 'crawl' ? `Crawl of ${extractUrls($('crawlStart').value)[0] ?? 'website'}` : `Bulk scrape (${images.length.toLocaleString()} images)`;
  await api.storage.local.set({ [key]: { title, images } });
  await api.tabs.create({ url: api.runtime.getURL(`dashboard/dashboard.html?mode=import&key=${encodeURIComponent(key)}`) });
}

function exportTxt() {
  const blob = new Blob([toText(currentResults())], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `image-urls-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// ------------------------------------------------------------------ wiring

for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => showTab(b.dataset.tab);
$('mode').onchange = syncMode;
$('urlList').oninput = updateUrlCount;
$('pattern').oninput = updatePattern;
$('urlFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const urls = extractUrls(await file.text());
  $('urlList').value = [$('urlList').value.trim(), ...urls].filter(Boolean).join('\n');
  updateUrlCount();
  log(`Loaded ${urls.length.toLocaleString()} URLs from ${file.name}`);
  e.target.value = '';
};
$('start').onclick = start;
$('pause').onclick = () => {
  if (!crawler) return;
  if (crawler.paused) crawler.resume();
  else crawler.pause();
  $('pause').textContent = crawler.paused ? 'Resume' : 'Pause';
};
$('stop').onclick = () => crawler?.stop();
$('openDashboard').onclick = openInDashboard;
$('exportTxt').onclick = exportTxt;

restoreOptions();
if (params.get('urls')) {
  $('urlList').value = params.get('urls');
  showTab('urls');
}
if (params.get('crawl')) {
  $('crawlStart').value = params.get('crawl');
  showTab('crawl');
}
if (params.get('mode')) $('mode').value = params.get('mode');
syncMode();
updateUrlCount();
updatePattern();
if (params.get('autostart')) start();
