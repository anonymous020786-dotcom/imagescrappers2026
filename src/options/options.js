import { api } from '../lib/browser.js';
import { DEFAULT_SETTINGS, applyTheme, loadSettings, resetSettings, saveSettings } from '../lib/settings.js';
import { buildFilename } from '../lib/utils.js';
import { DownloadLog } from '../lib/downloader.js';
import { access, onAccessChange, refreshAccess, requestAllSites, revokeAllSites } from '../lib/access.js';

const form = document.getElementById('form');
let settings = await loadSettings();

function fill(s) {
  for (const [key, value] of Object.entries(s)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!value;
    else if (key === 'blocklist') el.value = value.join('\n');
    else el.value = value;
  }
  applyTheme(s.theme);
  preview();
}

function read() {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el.type === 'checkbox') out[key] = el.checked;
    else if (key === 'blocklist') out[key] = el.value.split('\n').map((l) => l.trim()).filter(Boolean);
    else if (el.type === 'number') {
      const n = Number(el.value);
      out[key] = Number.isFinite(n) && el.value !== '' ? n : DEFAULT_SETTINGS[key];
    } else out[key] = el.value;
  }
  return out;
}

function preview() {
  const s = read();
  document.getElementById('preview').textContent = buildFilename(s.filenameTemplate, s.folderTemplate, {
    url: 'https://cdn.example.com/photos/sunset-beach.jpg', pageUrl: 'https://www.example.com/gallery',
    title: 'Summer gallery', index: 6, ext: 'jpg', width: 1920, height: 1080, alt: 'Sunset', type: 'jpg', source: 'img',
  });
}

let timer;
form.addEventListener('input', () => {
  preview();
  clearTimeout(timer);
  timer = setTimeout(async () => {
    settings = await saveSettings(read());
    applyTheme(settings.theme);
    document.getElementById('saved').textContent = `Saved ${new Date().toLocaleTimeString()}`;
  }, 300);
});

document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'image-scraper-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

document.getElementById('import').onclick = () => document.getElementById('importFile').click();
document.getElementById('importFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const clean = Object.fromEntries(Object.entries(data).filter(([k, v]) => k in DEFAULT_SETTINGS && typeof v === typeof DEFAULT_SETTINGS[k]));
    settings = await saveSettings(clean);
    async function showLogSize() {
  document.getElementById('logSize').textContent = (await DownloadLog.load()).size.toLocaleString();
}
document.getElementById('clearLog').onclick = async () => {
  await DownloadLog.clear();
  showLogSize();
};

fill(settings);
showLogSize();
    document.getElementById('saved').textContent = `Imported ${Object.keys(clean).length} settings`;
  } catch (err) {
    document.getElementById('saved').textContent = `Import failed: ${err.message}`;
  }
  e.target.value = '';
};

document.getElementById('reset').onclick = async () => {
  if (!confirm('Reset all settings to their defaults?')) return;
  settings = await resetSettings();
  fill(settings);
  document.getElementById('saved').textContent = 'Settings reset';
};

document.getElementById('shortcuts').onclick = () => {
  const isFirefox = /firefox/i.test(navigator.userAgent);
  const url = isFirefox ? 'about:addons' : /edg\//i.test(navigator.userAgent) ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
  api.tabs.create({ url }).catch(() => alert(`Open ${url} to change keyboard shortcuts.`));
};

fill(settings);

// ------------------------------------------------------------ site access

function showAccess(granted) {
  document.getElementById('accessStatus').textContent = granted
    ? '✅ Allowed on all sites: every feature is available.'
    : 'Limited: works on the tab where you click the Image Scraper icon.';
  document.getElementById('accessToggle').textContent = granted ? 'Remove access to all sites' : 'Allow access to all sites';
}
if (api.permissions?.contains) {
  showAccess(await refreshAccess());
  onAccessChange(showAccess);
  document.getElementById('accessToggle').onclick = () => (access.granted ? revokeAllSites() : requestAllSites());
} else {
  document.getElementById('siteAccess').hidden = true;
}
