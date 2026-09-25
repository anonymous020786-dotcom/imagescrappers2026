// Scrapes images from many URLs or whole websites without the user opening them.
//
// Modes:
//   fast   – fetch the HTML and parse it (very fast, no JavaScript executed)
//   render – open each page in a background tab, let it run its JavaScript,
//            optionally auto-scroll, then run the full in-page scanner
import { api } from './browser.js';
import { callInTab, scanTab } from './scanner.js';
import { fetchPage, readSitemap } from './pagefetch.js';
import { crawlDelay, isAllowed, parseRobots } from './robots.js';
import { canonicalPageUrl, inScope, isCrawlableUrl, passesPatterns, sleep } from './crawl.js';
import { guessType, isImageUrl, normalizeUrl } from './utils.js';

export const DEFAULT_CRAWL = {
  mode: 'fast',
  concurrency: 4,
  delay: 250, // ms between requests per worker
  maxPages: 0, // 0 = unlimited
  maxDepth: 2, // 0 = only the given URLs
  scope: 'host', // page | host | domain | any
  include: [],
  exclude: [],
  respectRobots: true,
  useSitemap: false,
  followNext: true, // always follow "next page" links (pagination), even past maxDepth
  timeout: 30000,
  renderWait: 1200, // extra settle time after load in render mode
  autoScroll: false,
};

export class Crawler {
  constructor(options, settings, events = {}) {
    this.o = { ...DEFAULT_CRAWL, ...options };
    this.settings = settings;
    this.events = events;
    this.queue = [];
    this.seen = new Set();
    this.images = new Map();
    this.robots = new Map();
    this.stats = { queued: 0, done: 0, failed: 0, skipped: 0, images: 0, active: 0 };
    this.paused = false;
    this.abort = new AbortController();
    this.roots = [];
    this.resumeWaiters = [];
  }

  log(msg, level = 'info') {
    this.events.onLog?.(msg, level);
  }

  emit() {
    this.events.onProgress?.({ ...this.stats, queueLength: this.queue.length });
  }

  enqueue(url, depth, root, viaNext = false) {
    if (!isCrawlableUrl(url)) return false;
    const key = canonicalPageUrl(url);
    if (this.seen.has(key)) return false;
    if (this.o.maxPages && this.seen.size >= this.o.maxPages) return false;
    if (!passesPatterns(key, this.o.include, this.o.exclude) && depth > 0) return false;
    this.seen.add(key);
    this.queue.push({ url: key, depth, root, viaNext });
    this.stats.queued++;
    return true;
  }

  addImage(img, pageUrl) {
    const key = normalizeUrl(img.url, this.settings.ignoreQueryForDedupe);
    const prev = this.images.get(key);
    if (prev) {
      for (const s of img.sources ?? [img.source]) if (!prev.sources.includes(s)) prev.sources.push(s);
      prev.width = Math.max(prev.width || 0, img.width || 0);
      prev.height = Math.max(prev.height || 0, img.height || 0);
      return null;
    }
    const entry = {
      ...img,
      sources: img.sources ?? [img.source],
      type: img.type && img.type !== 'other' ? img.type : guessType(img.url),
      pageUrl,
      pageTitle: img.pageTitle ?? '',
      order: this.images.size,
      tabId: null,
    };
    this.images.set(key, entry);
    this.stats.images = this.images.size;
    return entry;
  }

  async robotsFor(url) {
    if (!this.o.respectRobots) return null;
    const origin = new URL(url).origin;
    if (!this.robots.has(origin)) {
      this.robots.set(origin, (async () => {
        try {
          const res = await fetch(`${origin}/robots.txt`, { signal: this.abort.signal });
          return res.ok ? parseRobots(await res.text()) : null;
        } catch {
          return null;
        }
      })());
    }
    return this.robots.get(origin);
  }

  pause() {
    this.paused = true;
    this.log('Paused');
  }

  resume() {
    this.paused = false;
    this.resumeWaiters.splice(0).forEach((r) => r());
    this.log('Resumed');
  }

  stop() {
    this.abort.abort();
    this.resume();
  }

  async waitIfPaused() {
    while (this.paused && !this.abort.signal.aborted) await new Promise((r) => this.resumeWaiters.push(r));
  }

  // Direct image URLs are added as results immediately; everything else is crawled.
  async run(urls) {
    for (const raw of urls) {
      const url = raw.trim();
      if (!url) continue;
      if (isImageUrl(url) || url.startsWith('data:image/')) {
        const added = this.addImage({ url, source: 'direct' }, '');
        if (added) this.events.onImages?.([added]);
        continue;
      }
      this.roots.push(url);
      this.enqueue(url, 0, url);
    }
    if (this.o.useSitemap) await this.seedSitemaps();
    this.emit();

    const workers = Array.from({ length: Math.max(1, this.o.concurrency) }, () => this.worker());
    await Promise.all(workers);
    this.emit();
    return [...this.images.values()];
  }

  async seedSitemaps() {
    const origins = [...new Set(this.roots.map((r) => new URL(r).origin))];
    for (const origin of origins) {
      const robots = await this.robotsFor(origin);
      const maps = robots?.sitemaps?.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
      for (const map of maps) {
        try {
          const { pages, images } = await readSitemap(map, { signal: this.abort.signal, limit: this.o.maxPages });
          let added = 0;
          for (const p of pages) if (this.enqueue(p, 1, origin)) added++;
          const imgs = images.map((u) => this.addImage({ url: u, source: 'sitemap' }, map)).filter(Boolean);
          if (imgs.length) this.events.onImages?.(imgs);
          this.log(`Sitemap ${map}: ${added} pages, ${imgs.length} images`);
        } catch (err) {
          this.log(`Sitemap ${map} unavailable (${err.message})`, 'warn');
        }
      }
    }
  }

  async worker() {
    const signal = this.abort.signal;
    while (!signal.aborted) {
      await this.waitIfPaused();
      const job = this.queue.shift();
      if (!job) {
        // Other workers may still discover links; wait for them before exiting.
        if (this.stats.active === 0) return;
        await sleep(150).catch(() => {});
        continue;
      }
      this.stats.active++;
      try {
        await this.process(job);
      } catch (err) {
        if (err?.name === 'AbortError') break;
        this.stats.failed++;
        this.log(`✘ ${job.url} (${err.message})`, 'error');
      } finally {
        this.stats.active--;
        this.emit();
      }
      await sleep(this.o.delay, signal).catch(() => {});
    }
  }

  async process(job) {
    const robots = await this.robotsFor(job.url);
    if (robots && !isAllowed(robots, job.url, 'ImageScraperPro')) {
      this.stats.skipped++;
      this.log(`⊘ robots.txt disallows ${job.url}`, 'warn');
      return;
    }
    const cd = crawlDelay(robots, 'ImageScraperPro');
    if (cd) await sleep(Math.min(cd, 30) * 1000, this.abort.signal);

    const result = this.o.mode === 'render' ? await this.renderPage(job.url) : await this.fastPage(job.url);
    this.stats.done++;
    if (!result) return;

    const fresh = result.images.map((i) => this.addImage({ ...i, pageTitle: result.title }, result.url)).filter(Boolean);
    if (fresh.length) this.events.onImages?.(fresh);
    this.log(`✔ ${result.url}: ${result.images.length} images (${fresh.length} new)${result.charset && result.charset !== 'utf-8' ? ` [${result.charset}]` : ''}`);

    let followed = 0;
    if (job.depth < this.o.maxDepth) {
      for (const link of result.links) {
        if (inScope(link, job.root, this.o.scope) && this.enqueue(link, job.depth + 1, job.root)) followed++;
      }
    }
    if (this.o.followNext && result.next && inScope(result.next, job.root, this.o.scope === 'page' ? 'host' : this.o.scope)) {
      if (this.enqueue(result.next, job.depth, job.root, true)) followed++;
    }
    if (followed) this.log(`  ↳ queued ${followed} more page${followed === 1 ? '' : 's'}`);
  }

  async fastPage(url) {
    const res = await fetchPage(url, { signal: this.abort.signal, timeout: this.o.timeout });
    if (res.kind === 'image') {
      return { url: res.url, title: '', images: [{ url: res.url, source: 'direct', type: res.type, bytes: res.bytes }], links: [], next: null };
    }
    if (res.kind === 'sitemap') {
      const { pages, images } = await readSitemap(url, { signal: this.abort.signal, limit: this.o.maxPages });
      for (const p of pages) this.enqueue(p, 1, url);
      return { url, title: 'sitemap', images: images.map((u) => ({ url: u, source: 'sitemap' })), links: [], next: null };
    }
    if (res.kind !== 'html') {
      this.stats.skipped++;
      return null;
    }
    return res;
  }

  async renderPage(url) {
    const tab = await api.tabs.create({ url, active: false });
    try {
      await waitForTabLoad(tab.id, this.o.timeout, this.abort.signal);
      await sleep(this.o.renderWait, this.abort.signal);
      const loaded = await api.tabs.get(tab.id);
      const { images, title } = await scanTab(loaded, { ...this.settings, autoScroll: this.o.autoScroll });
      const [linkInfo] = await callInTab(tab.id, 'links', [], false);
      return {
        url: loaded.url,
        title,
        images: images.map(({ id, tabId, ...rest }) => rest),
        links: linkInfo?.links ?? [],
        next: linkInfo?.next ?? null,
      };
    } finally {
      api.tabs.remove(tab.id).catch(() => {});
    }
  }
}

export function waitForTabLoad(tabId, timeout, signal) {
  return new Promise((resolve, reject) => {
    const done = (fn, v) => {
      clearTimeout(timer);
      api.tabs.onUpdated.removeListener(listener);
      fn(v);
    };
    const listener = (id, change) => {
      if (id === tabId && change.status === 'complete') done(resolve);
    };
    const timer = setTimeout(() => done(resolve), timeout); // scan whatever has loaded by now
    api.tabs.onUpdated.addListener(listener);
    signal?.addEventListener('abort', () => done(reject, new DOMException('Aborted', 'AbortError')), { once: true });
    api.tabs.get(tabId).then((t) => t.status === 'complete' && t.url !== 'about:blank' && done(resolve)).catch(() => {});
  });
}
