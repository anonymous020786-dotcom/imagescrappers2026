// Injected on demand into every frame of the target tab. Classic script (not a
// module) so it can be injected with scripting.executeScript({ files }).
// Re-injection is idempotent: the API object is created once per frame.
(() => {
  if (globalThis.__imageScraper) return;

  const ext = globalThis.browser ?? globalThis.chrome;
  const LAZY_ATTRS = [
    'data-src', 'data-lazy-src', 'data-lazy', 'data-original', 'data-url', 'data-hi-res', 'data-hires',
    'data-full', 'data-full-src', 'data-fullsrc', 'data-large', 'data-large_image', 'data-zoom-image',
    'data-zoom', 'data-highres', 'data-echo', 'data-img', 'data-image', 'data-bg', 'data-background',
    'data-original-src', 'data-actualsrc', 'data-delayed-url', 'lazy-src',
  ];
  const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset', 'data-original-set'];
  const IMAGE_EXT_RE = /\.(jpe?g|jfif|png|apng|gif|webp|svgz?|avif|jxl|heic|heif|bmp|ico|tiff?)(?:[?#]|$)/i;
  // Defaults; both can be raised or removed (0 = unlimited) from the settings.
  let maxElements = 100000;
  let maxResults = 0;

  const elementsByUrl = new Map();
  let pickedRoot = null;
  let observer = null;

  function absolute(url) {
    if (!url) return null;
    const trimmed = String(url).trim();
    if (!trimmed || trimmed === 'none') return null;
    try {
      // Allowlist schemes that can hold an image (drops javascript:, vbscript:, about:, …).
      const u = new URL(trimmed, document.baseURI);
      return /^(https?|file|ftp|blob):$/.test(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  }

  // Parses a srcset string and returns candidates sorted best-first.
  function parseSrcset(srcset) {
    if (!srcset) return [];
    const out = [];
    // Split on commas that are followed by whitespace+URL (data URIs contain commas).
    const parts = srcset.split(/,\s+(?=\S)/);
    for (const part of parts) {
      const [url, descriptor = '1x'] = part.trim().split(/\s+/);
      if (!url) continue;
      const m = /^([\d.]+)([wx])$/.exec(descriptor);
      const value = m ? parseFloat(m[1]) * (m[2] === 'x' ? 10000 : 1) : 1;
      out.push({ url, value, w: m && m[2] === 'w' ? parseFloat(m[1]) : 0 });
    }
    return out.sort((a, b) => b.value - a.value);
  }

  function* walk(root) {
    let count = 0;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const el of all) {
        if (maxElements && ++count > maxElements) return;
        yield el;
        if (el.shadowRoot && walk.shadow) stack.push(el.shadowRoot);
      }
    }
  }

  function extractCssUrls(value) {
    if (!value || value === 'none' || !value.includes('url(')) return [];
    const urls = [];
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    let m;
    while ((m = re.exec(value))) urls.push(m[2]);
    return urls;
  }

  function svgToDataUrl(svg) {
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const rect = svg.getBoundingClientRect();
    if (!clone.getAttribute('width') && rect.width) clone.setAttribute('width', Math.round(rect.width));
    if (!clone.getAttribute('height') && rect.height) clone.setAttribute('height', Math.round(rect.height));
    // Inline the computed fill colour so icons using `currentColor` don't come out black.
    if (!clone.getAttribute('fill')) {
      const color = getComputedStyle(svg).color;
      if (color) clone.setAttribute('color', color);
    }
    const xml = new XMLSerializer().serializeToString(clone);
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
  }

  function scan(opts = {}) {
    const o = {
      scanImgTags: true, scanSrcset: true, scanBackgrounds: true, scanPseudo: true, scanSvg: true,
      scanCanvas: true, scanVideoPosters: true, scanLinks: true, scanMeta: true, scanLazyAttrs: true,
      scanShadowDom: true, scanDataUris: true, preferHighestResolution: true, usePicked: false,
      ...opts,
    };
    walk.shadow = o.scanShadowDom;
    maxElements = Number(o.maxScanElements ?? 100000) || 0;
    maxResults = Number(o.maxScanResults ?? 0) || 0;
    elementsByUrl.clear();
    const results = [];
    const seen = new Set();
    let order = 0;

    function add(rawUrl, source, el, extra = {}) {
      if (maxResults && results.length >= maxResults) return;
      const url = rawUrl?.startsWith('data:') ? rawUrl : absolute(rawUrl);
      if (!url) return;
      if (url.startsWith('data:') && !o.scanDataUris && source !== 'svg' && source !== 'canvas') return;
      if (url.startsWith('data:') && !url.startsWith('data:image/')) return;
      if (el) {
        if (!elementsByUrl.has(url)) elementsByUrl.set(url, []);
        elementsByUrl.get(url).push(el);
      }
      const key = `${source}|${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        url,
        source,
        order: order++,
        width: extra.width || 0,
        height: extra.height || 0,
        displayWidth: extra.displayWidth || 0,
        displayHeight: extra.displayHeight || 0,
        alt: extra.alt || '',
        title: extra.title || '',
        frameUrl: location.href,
      });
    }

    const root = o.usePicked && pickedRoot?.isConnected ? pickedRoot : document;
    const elements = root === document ? [...walk(document)] : [root, ...walk(root)];

    for (const el of elements) {
      const tag = el.tagName;

      if (tag === 'IMG' && o.scanImgTags) {
        const rect = el.getBoundingClientRect();
        const meta = {
          width: el.naturalWidth, height: el.naturalHeight, alt: el.alt, title: el.title,
          displayWidth: Math.round(rect.width), displayHeight: Math.round(rect.height),
        };
        const candidates = o.scanSrcset ? parseSrcset(el.getAttribute('srcset')) : [];
        if (o.preferHighestResolution && candidates.length) {
          const best = candidates[0];
          const current = absolute(el.currentSrc || el.src);
          const bestAbs = absolute(best.url);
          const scaled = best.w && best.w !== meta.width && el.naturalWidth
            ? { width: best.w, height: Math.round(best.w * (el.naturalHeight / el.naturalWidth)) }
            : {};
          add(best.url, 'srcset', el, bestAbs === current ? meta : { ...meta, ...scaled });
        } else {
          const src = el.currentSrc || el.getAttribute('src');
          // Skip tiny data: placeholders when a lazy-load attribute holds the real image.
          const placeholder = src?.startsWith('data:') && src.length < 2000 && LAZY_ATTRS.some((a) => el.hasAttribute(a));
          if (!placeholder) add(src, 'img', el, meta);
        }
        if (!o.preferHighestResolution) for (const c of candidates) add(c.url, 'srcset', el, { alt: el.alt });
      }

      if (tag === 'SOURCE' && o.scanSrcset && el.parentElement?.tagName === 'PICTURE') {
        const best = parseSrcset(el.getAttribute('srcset'))[0];
        if (best) add(best.url, 'picture', el.parentElement.querySelector('img') ?? el, { width: best.w });
      }

      if (tag === 'INPUT' && el.type === 'image' && o.scanImgTags) add(el.getAttribute('src'), 'img', el);

      if (o.scanLazyAttrs && el.attributes.length) {
        for (const attr of LAZY_ATTRS) {
          const v = el.getAttribute(attr);
          if (v && (IMAGE_EXT_RE.test(v) || v.startsWith('data:image/') || /^(https?:)?\/\//.test(v))) add(v, 'lazy', el, { alt: el.alt });
        }
        for (const attr of LAZY_SRCSET_ATTRS) {
          const best = parseSrcset(el.getAttribute(attr))[0];
          if (best) add(best.url, 'lazy', el, { alt: el.alt, width: best.w });
        }
      }

      if (o.scanSvg && tag.toLowerCase() === 'svg' && !el.parentElement?.closest('svg')) {
        const rect = el.getBoundingClientRect();
        if (rect.width >= 4 && rect.height >= 4) {
          try {
            add(svgToDataUrl(el), 'svg', el, {
              width: Math.round(rect.width), height: Math.round(rect.height),
              title: el.querySelector('title')?.textContent ?? el.getAttribute('aria-label') ?? '',
            });
          } catch { /* ignore unserializable svg */ }
        }
      }
      if (o.scanSvg && tag.toLowerCase() === 'image' && el.namespaceURI === 'http://www.w3.org/2000/svg') {
        add(el.getAttribute('href') || el.getAttribute('xlink:href'), 'svg', el);
      }

      if (o.scanCanvas && tag === 'CANVAS' && el.width >= 8 && el.height >= 8) {
        try {
          add(el.toDataURL('image/png'), 'canvas', el, { width: el.width, height: el.height });
        } catch { /* tainted canvas */ }
      }

      if (o.scanVideoPosters && tag === 'VIDEO' && el.poster) add(el.poster, 'poster', el, { width: el.videoWidth, height: el.videoHeight });

      if (o.scanLinks && tag === 'A') {
        const href = el.getAttribute('href');
        if (href && IMAGE_EXT_RE.test(href)) add(href, 'link', el, { title: el.title || el.textContent.trim().slice(0, 100) });
      }

      if (o.scanBackgrounds || o.scanPseudo) {
        const style = getComputedStyle(el);
        if (o.scanBackgrounds) {
          for (const u of extractCssUrls(style.backgroundImage)) add(u, 'css', el);
          for (const u of extractCssUrls(style.borderImageSource)) add(u, 'css', el);
          for (const u of extractCssUrls(style.maskImage || style.webkitMaskImage)) add(u, 'css', el);
          if (tag === 'LI') for (const u of extractCssUrls(style.listStyleImage)) add(u, 'css', el);
        }
        if (o.scanPseudo) {
          for (const pseudo of ['::before', '::after']) {
            const ps = getComputedStyle(el, pseudo);
            if (ps.content === 'none' && ps.backgroundImage === 'none') continue;
            for (const u of extractCssUrls(ps.backgroundImage)) add(u, 'pseudo', el);
            for (const u of extractCssUrls(ps.content)) add(u, 'pseudo', el);
          }
        }
      }
    }

    if (o.scanMeta && root === document) {
      const metaSel = [
        'meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[property="og:image:secure_url"]',
        'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]', 'meta[itemprop="image"]',
        'meta[name="msapplication-TileImage"]',
      ].join(',');
      for (const m of document.querySelectorAll(metaSel)) add(m.content, 'meta', null, { title: m.getAttribute('property') || m.name });
      for (const l of document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="image_src"], link[rel="mask-icon"]')) {
        const sizes = /^(\d+)x(\d+)$/i.exec(l.getAttribute('sizes') || '');
        add(l.href, l.rel.includes('icon') ? 'icon' : 'meta', null, sizes ? { width: +sizes[1], height: +sizes[2], title: l.rel } : { title: l.rel });
      }
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const collect = (node) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) return node.forEach(collect);
            for (const [k, v] of Object.entries(node)) {
              if (/^(image|logo|thumbnailUrl|contentUrl)$/.test(k)) {
                for (const item of [].concat(v)) add(typeof item === 'string' ? item : item?.url || item?.contentUrl, 'meta', null, { title: `ld+json ${k}` });
              } else if (typeof v === 'object') collect(v);
            }
          };
          collect(JSON.parse(s.textContent));
        } catch { /* malformed JSON-LD */ }
      }
    }

    return {
      frameUrl: location.href,
      pageTitle: document.title,
      isTop: window === window.top,
      images: results,
    };
  }

  async function autoScroll({ maxSteps = 40, delay = 350 } = {}) {
    const startY = window.scrollY;
    let lastHeight = 0;
    let stable = 0;
    for (let i = 0; i < maxSteps; i++) {
      window.scrollBy(0, Math.max(window.innerHeight * 0.85, 400));
      await new Promise((r) => setTimeout(r, delay));
      const h = document.documentElement.scrollHeight;
      const atBottom = window.innerHeight + window.scrollY >= h - 4;
      if (atBottom && h === lastHeight) {
        if (++stable >= 3) break;
      } else stable = 0;
      lastHeight = h;
    }
    // Force remaining lazy images to start loading.
    for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
    window.scrollTo({ top: startY, behavior: 'instant' });
    return { height: document.documentElement.scrollHeight };
  }

  function highlight(url) {
    const els = (elementsByUrl.get(url) ?? []).filter((e) => e.isConnected);
    if (!els.length) return false;
    const el = els[0];
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    for (const e of els) {
      const prev = { outline: e.style.outline, offset: e.style.outlineOffset, transition: e.style.transition };
      e.style.transition = 'outline-color .2s';
      e.style.outline = '4px solid #ff3b7f';
      e.style.outlineOffset = '2px';
      setTimeout(() => {
        e.style.outline = prev.outline;
        e.style.outlineOffset = prev.offset;
        e.style.transition = prev.transition;
      }, 2500);
    }
    return true;
  }

  async function fetchAsDataUrl(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result, type: blob.type, size: blob.size });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function watch(enable) {
    observer?.disconnect();
    observer = null;
    if (!enable) return false;
    let timer = null;
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) =>
        m.type === 'attributes' ||
        [...m.addedNodes].some((n) => n.nodeType === 1 && (n.tagName === 'IMG' || n.querySelector?.('img,picture,svg,[style*="url("]'))),
      );
      if (!relevant) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        ext.runtime.sendMessage({ type: 'page-images-changed', frameUrl: location.href }).catch?.(() => {});
      }, 900);
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'data-src'],
    });
    return true;
  }

  // Lets the user click an element on the page; later scans can be limited to it.
  function pick() {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: 2147483647, border: '3px solid #ff3b7f',
        background: 'rgba(255,59,127,.12)', borderRadius: '4px', transition: 'all .06s',
      });
      const tip = document.createElement('div');
      tip.textContent = 'Image Scraper: click an area to scrape · Esc to cancel';
      Object.assign(tip.style, {
        position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647,
        background: '#111', color: '#fff', font: '13px system-ui', padding: '8px 14px', borderRadius: '20px',
        pointerEvents: 'none', boxShadow: '0 4px 20px rgba(0,0,0,.4)',
      });
      document.documentElement.append(box, tip);
      let current = null;
      const move = (e) => {
        current = e.target;
        const r = current.getBoundingClientRect();
        Object.assign(box.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
      };
      const cleanup = (result) => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('keydown', key, true);
        box.remove();
        tip.remove();
        resolve(result);
      };
      const click = (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickedRoot = current;
        cleanup({ picked: true, tag: current?.tagName?.toLowerCase() });
      };
      const key = (e) => {
        if (e.key === 'Escape') cleanup({ picked: false });
        if (e.key === 'ArrowUp' && current?.parentElement) {
          e.preventDefault();
          move({ target: current.parentElement });
        }
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', key, true);
    });
  }

  // Links for the crawler, plus the "next page" link if the page declares or shows one.
  function links() {
    const out = new Set();
    for (const a of document.querySelectorAll('a[href], area[href]')) {
      const url = absolute(a.getAttribute('href'));
      if (url && /^https?:/.test(url)) out.add(url.split('#')[0]);
    }
    const nextEl = document.querySelector('link[rel~="next"], a[rel~="next"]') ??
      [...document.querySelectorAll('a[href]')].find((a) => /^(next|next page|older|more|›|»|→|siguiente|suivant|weiter|次へ|下一页|далее)$/i.test(a.textContent.trim()));
    return { links: [...out], next: nextEl ? absolute(nextEl.getAttribute('href')) : null };
  }

  function count() {
    const urls = new Set();
    for (const img of document.images) if (img.currentSrc || img.src) urls.add(img.currentSrc || img.src);
    return urls.size;
  }

  globalThis.__imageScraper = { scan, autoScroll, highlight, fetchAsDataUrl, watch, pick, count, links };
})();
