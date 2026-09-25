import { api, isScriptableUrl } from '../lib/browser.js';
import { applyTheme, loadSettings } from '../lib/settings.js';
import { scanTab } from '../lib/scanner.js';
import { filterImages, safeImageSrc } from '../lib/utils.js';

const $ = (id) => document.getElementById(id);
const settings = await loadSettings();
applyTheme(settings.theme);

// An explicit ?tabId= lets the popup be opened as a page (e.g. in tests).
const forcedTab = Number(new URLSearchParams(location.search).get('tabId'));
const tab = forcedTab ? await api.tabs.get(forcedTab) : (await api.tabs.query({ active: true, currentWindow: true }))[0];
$('page').textContent = tab?.title || tab?.url || 'No active tab';

function openDashboard(params) {
  api.runtime.sendMessage({ type: 'open-dashboard', params }).then(() => window.close());
}

$('options').onclick = () => api.runtime.openOptionsPage().then(() => window.close());
$('open').onclick = () => openDashboard({ tabId: tab.id });
$('pick').onclick = () => openDashboard({ tabId: tab.id, pick: 1 });
$('scroll').onclick = () => openDashboard({ tabId: tab.id, autoscroll: 1 });
$('alltabs').onclick = () => openDashboard({ windowId: tab.windowId, mode: 'alltabs' });
$('history').onclick = () => openDashboard({ mode: 'history' });
$('bulk').onclick = () => {
  const params = /^https?:/.test(tab?.url ?? '') ? { crawl: tab.url } : {};
  api.runtime.sendMessage({ type: 'open-bulk', params }).then(() => window.close());
};
$('quick').onclick = async () => {
  $('quick').disabled = true;
  $('quick').textContent = 'Downloading…';
  const res = await api.runtime.sendMessage({ type: 'quick-download', tabId: tab.id });
  $('quick').textContent = res?.error ? 'Failed' : `Saved ${res.ok}/${res.total}`;
  if (res?.error) showError(res.error);
};

function showError(msg) {
  $('error').textContent = msg;
  $('error').classList.remove('hidden');
}

if (!isScriptableUrl(tab?.url)) {
  showError('This page cannot be scanned. Open a regular web page and try again.');
  for (const id of ['open', 'quick', 'pick', 'scroll']) $(id).disabled = true;
} else {
  try {
    const { images, frames } = await scanTab(tab, { ...settings, autoScroll: false });
    const visible = filterImages(images, { hideTracking: true, blocklist: settings.blocklist });
    $('count').textContent = visible.length;
    $('large').textContent = visible.filter((i) => i.width >= 300 || i.height >= 300).length;
    $('frames').textContent = frames;
    const top = [...visible].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 12);
    for (const img of top) {
      const src = safeImageSrc(img.url);
      if (!src) continue;
      const el = document.createElement('img');
      el.src = src;
      el.alt = img.alt;
      el.title = `${img.width || '?'}×${img.height || '?'}`;
      el.className = 'checker';
      el.onerror = () => el.remove();
      $('preview').append(el);
    }
  } catch (err) {
    showError(err.message);
  }
}
