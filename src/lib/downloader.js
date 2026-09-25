// Download engine helpers: completion tracking, pause/resume, and a persistent
// log of what was already downloaded (so repeated scrapes can skip it).
import { api } from './browser.js';
import { hash53 } from './crawl.js';
import { normalizeUrl } from './utils.js';

const LOG_KEY = 'downloadLog';
const LOG_LIMIT = 500000;

export class DownloadLog {
  constructor(hashes = []) {
    this.set = new Set(hashes);
    this.order = hashes;
    this.dirty = false;
  }

  static async load() {
    const res = await api.storage.local.get(LOG_KEY).catch(() => ({}));
    return new DownloadLog(res?.[LOG_KEY] ?? []);
  }

  static key(url) {
    return hash53(normalizeUrl(url));
  }

  has(url) {
    return this.set.has(DownloadLog.key(url));
  }

  add(url) {
    const k = DownloadLog.key(url);
    if (this.set.has(k)) return;
    this.set.add(k);
    this.order.push(k);
    this.dirty = true;
  }

  get size() {
    return this.set.size;
  }

  async save() {
    if (!this.dirty) return;
    // Keep the newest entries if the log grows past the limit.
    if (this.order.length > LOG_LIMIT) {
      this.order = this.order.slice(-LOG_LIMIT);
      this.set = new Set(this.order);
    }
    await api.storage.local.set({ [LOG_KEY]: this.order }).catch(() => {});
    this.dirty = false;
  }

  static async clear() {
    await api.storage.local.remove(LOG_KEY).catch(() => {});
  }
}

// Resolves when a browser download finishes; rejects if it's interrupted.
// Waiting (instead of fire-and-forget) makes the concurrency limit real and
// lets failed downloads be retried.
export function waitForDownload(id, timeout = 10 * 60 * 1000) {
  if (id == null || !api.downloads?.onChanged) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (fn, v) => {
      clearTimeout(timer);
      api.downloads.onChanged.removeListener(listener);
      fn(v);
    };
    const listener = (delta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') finish(resolve);
      else if (delta.state.current === 'interrupted') finish(reject, new Error(delta.error?.current || 'Download interrupted'));
    };
    const timer = setTimeout(() => finish(resolve), timeout);
    api.downloads.onChanged.addListener(listener);
    // It may already be finished (small files complete almost instantly).
    api.downloads.search({ id }).then(([item]) => {
      if (item?.state === 'complete') finish(resolve);
      else if (item?.state === 'interrupted') finish(reject, new Error(item.error || 'Download interrupted'));
    }).catch(() => {});
  });
}

// A gate that async workers pass through; closing it pauses them.
export function createGate() {
  let waiters = [];
  const gate = {
    paused: false,
    pause() {
      gate.paused = true;
    },
    resume() {
      gate.paused = false;
      waiters.forEach((r) => r());
      waiters = [];
    },
    async wait(signal) {
      while (gate.paused && !signal?.aborted) await new Promise((r) => waiters.push(r));
    },
  };
  return gate;
}
