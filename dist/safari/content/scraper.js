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

  // Credit and licence from a schema.org ImageObject (mirrors rightsFromJsonLd in lib/rights.js, which can't be
  // imported into this classic script).
  function jsonLdRights(node) {
    if (!node || typeof node !== 'object') return null;
    const name = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(name).filter(Boolean).join(', ') : typeof v?.name === 'string' ? v.name : '');
    const link = (v) => (Array.isArray(v) ? link(v[0]) : typeof v === 'string' ? v : typeof v?.url === 'string' ? v.url : '');
    const rights = {
      creator: name(node.creator) || name(node.author),
      credit: name(node.creditText),
      copyright: name(node.copyrightNotice) || name(node.copyrightHolder),
      license: link(node.license),
      licensePage: link(node.acquireLicensePage),
    };
    return Object.values(rights).some(Boolean) ? rights : null;
  }

  function scan(opts = {}) {
    const o = {
      scanImgTags: true, scanSrcset: true, scanBackgrounds: true, scanPseudo: true, scanSvg: true,
      scanCanvas: true, scanVideoPosters: true, scanLinks: true, scanMeta: true, scanLazyAttrs: true,
      scanShadowDom: true, scanDataUris: true, scanResources: true, preferHighestResolution: true, usePicked: false,
      ...opts,
    };
    walk.shadow = o.scanShadowDom;
    maxElements = Number(o.maxScanElements ?? 100000) || 0;
    maxResults = Number(o.maxScanResults ?? 0) || 0;
    elementsByUrl.clear();
    const results = [];
    const seen = new Set();
    // Every srcset candidate on the page, so the network pass doesn't re-add the
    // lower-resolution variant the browser happened to load.
    const srcsetVariants = new Set();
    const noteVariants = (candidates) => {
      for (const c of candidates) {
        const u = absolute(c.url);
        if (u) srcsetVariants.add(u);
      }
      return candidates;
    };
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
      if (seen.has(key)) {
        if (extra.rights || extra.seo) {
          const hit = results.find((r) => r.url === url && r.source === source);
          if (hit) hit.rights ??= extra.rights;
          if (hit && extra.seo) hit.seo = [...new Set([...(hit.seo || []), ...extra.seo])];
        }
        return;
      }
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
        // Facts for the image audit (only known for <img> elements).
        ...(extra.audit ? { audit: extra.audit } : {}),
        ...(extra.rights ? { rights: extra.rights } : {}),
        // Declared as the page's sharing or structured-data image (for the SEO checks).
        ...(extra.seo ? { seo: extra.seo } : {}),
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
          audit: {
            hasAlt: el.hasAttribute('alt'),
            loading: (el.getAttribute('loading') || '').toLowerCase(),
            sized: el.hasAttribute('width') && el.hasAttribute('height'),
            top: Math.round(rect.top + (window.scrollY || 0)),
            viewportHeight: window.innerHeight,
            inFrame: window !== window.top,
          },
        };
        const candidates = noteVariants(parseSrcset(el.getAttribute('srcset')));
        if (!o.scanSrcset) candidates.length = 0;
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
        const best = noteVariants(parseSrcset(el.getAttribute('srcset')))[0];
        if (best) add(best.url, 'picture', el.parentElement.querySelector('img') ?? el, { width: best.w });
      }

      if (tag === 'INPUT' && el.type === 'image' && o.scanImgTags) add(el.getAttribute('src'), 'img', el);

      if (o.scanLazyAttrs && el.attributes.length) {
        for (const attr of LAZY_ATTRS) {
          const v = el.getAttribute(attr);
          if (v && (IMAGE_EXT_RE.test(v) || v.startsWith('data:image/') || /^(https?:)?\/\//.test(v))) add(v, 'lazy', el, { alt: el.alt });
        }
        for (const attr of LAZY_SRCSET_ATTRS) {
          const best = noteVariants(parseSrcset(el.getAttribute(attr)))[0];
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
      for (const m of document.querySelectorAll(metaSel)) {
        const prop = m.getAttribute('property') || m.name || '';
        const tag = prop.startsWith('og:') ? 'og' : prop.startsWith('twitter:') ? 'twitter' : m.hasAttribute('itemprop') ? 'schema' : '';
        add(m.content, 'meta', null, { title: prop || 'itemprop image', ...(tag ? { seo: [tag] } : {}) });
      }
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
                for (const item of [].concat(v)) {
                  // Only an image's own object describes its rights: a page's author isn't always the photographer.
                  const owner = typeof item === 'object' ? item : /ImageObject/.test(String(node['@type'])) ? node : null;
                  add(typeof item === 'string' ? item : item?.url || item?.contentUrl, 'meta', null, { title: `ld+json ${k}`, rights: jsonLdRights(owner), seo: ['schema'] });
                }
              } else if (typeof v === 'object') collect(v);
            }
          };
          collect(JSON.parse(s.textContent));
        } catch { /* malformed JSON-LD */ }
      }
    }

    // Images the page has loaded that the DOM no longer (or never) shows: fetched
    // by scripts, CSS sprites of removed nodes, carousel slides swapped out, etc.
    if (o.scanResources && root === document && globalThis.performance?.getEntriesByType) {
      const found = new Set(results.map((r) => r.url));
      for (const entry of performance.getEntriesByType('resource')) {
        const url = entry.name;
        if (found.has(url) || srcsetVariants.has(url) || !/^https?:/.test(url)) continue;
        const isImage = entry.contentType ? entry.contentType.startsWith('image/') : IMAGE_EXT_RE.test(url);
        // Same-origin (or Timing-Allow-Origin) entries report their size: drop beacons.
        if (!isImage || (entry.encodedBodySize > 0 && entry.encodedBodySize < 100)) continue;
        found.add(url);
        add(url, 'network', null);
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

  // On-page size inspector: a badge on every visible <img> with its real (natural) size and the size it is shown
  // at. Red: the file is more than 2× larger than displayed (wasted bytes); amber: shown larger than it is
  // (blurry); green: well sized. Lives in a Shadow DOM so page styles can't change it, and never takes clicks.
  let inspector = null;
  function inspect(on) {
    if (!on) {
      if (inspector) {
        clearInterval(inspector.timer);
        removeEventListener('resize', inspector.redraw);
        inspector.host.remove();
        inspector = null;
      }
      return 0;
    }
    if (!inspector) {
      const host = document.createElement('image-scraper-inspector');
      host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        .b { position: absolute; font: 600 11px/1.3 system-ui, sans-serif; color: #fff; padding: 2px 6px; border-radius: 6px;
             box-shadow: 0 1px 4px rgba(0,0,0,.35); white-space: nowrap; transform: translate(4px, 4px); }
        .ok { background: #0f9f6e; } .warn { background: #c77700; } .bad { background: #d43a4a; }
        .o { position: absolute; border: 2px solid; border-radius: 4px; box-sizing: border-box; }
        .o.bad { border-color: #d43a4a; background: none; } .o.warn { border-color: #c77700; background: none; } .o.ok { border-color: transparent; background: none; }`;
      const layer = document.createElement('div');
      root.append(style, layer);
      document.documentElement.append(host);
      const redraw = () => draw();
      inspector = { host, layer, redraw, timer: setInterval(redraw, 1500) };
      addEventListener('resize', redraw);
    }
    return draw();

    function draw() {
      const { layer } = inspector;
      const frag = document.createDocumentFragment();
      let n = 0;
      for (const img of document.images) {
        const r = img.getBoundingClientRect();
        if (r.width < 24 || r.height < 24 || !img.naturalWidth) continue;
        const dpr = window.devicePixelRatio || 1;
        const ratio = img.naturalWidth / (r.width * dpr);
        const kind = ratio > 2 ? 'bad' : ratio < 0.95 / dpr ? 'warn' : 'ok';
        const x = r.left + scrollX;
        const y = r.top + scrollY;
        const outline = document.createElement('div');
        outline.className = `o ${kind}`;
        outline.style.cssText = `left:${x}px;top:${y}px;width:${r.width}px;height:${r.height}px`;
        const badge = document.createElement('div');
        badge.className = `b ${kind}`;
        badge.style.cssText = `left:${x}px;top:${y}px`;
        const shown = `${Math.round(r.width)}×${Math.round(r.height)}`;
        badge.textContent = `${img.naturalWidth}×${img.naturalHeight}${shown !== `${img.naturalWidth}×${img.naturalHeight}` ? ` → ${shown}` : ''}${kind === 'bad' ? ` · ${ratio.toFixed(1)}× too big` : kind === 'warn' ? ' · upscaled' : ''}`;
        frag.append(outline, badge);
        n++;
      }
      layer.replaceChildren(frag);
      return n;
    }
  }

  // Page speed facts for the Core Web Vitals check (judged in lib/vitals.js): the Largest Contentful Paint element
  // as measured by the browser (or, where that isn't available, the largest image in the first screen), the
  // measured layout shift, and every image whose space isn't reserved before it loads.
  function observe(type) {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const entries = [];
      const po = new PerformanceObserver((list) => entries.push(...list.getEntries()));
      po.observe({ type, buffered: true });
      setTimeout(() => {
        entries.push(...po.takeRecords());
        po.disconnect();
        resolve(entries);
      }, 150);
    });
  }

  function imageFacts(el, url) {
    const r = el.getBoundingClientRect();
    const isImg = el instanceof HTMLImageElement;
    return {
      kind: 'image',
      tag: el.tagName.toLowerCase(),
      url: url || (isImg ? el.currentSrc || el.src : ''),
      source: isImg ? 'img' : el.tagName === 'VIDEO' ? 'poster' : 'css',
      loading: isImg ? el.loading || el.getAttribute('loading') || '' : '',
      fetchPriority: (el.fetchPriority || el.getAttribute('fetchpriority') || '').toLowerCase(),
      lazyScript: isImg && !el.getAttribute('src') && el.hasAttribute('data-src'),
      preloaded: [...document.querySelectorAll('link[rel~="preload"][as="image"]')].some((l) => l.href === url),
      natural: isImg ? { width: el.naturalWidth, height: el.naturalHeight } : null,
      displayed: { width: Math.round(r.width), height: Math.round(r.height) },
      dpr: window.devicePixelRatio || 1,
    };
  }

  async function speed() {
    const [lcpEntries, shifts] = await Promise.all([observe('largest-contentful-paint'), observe('layout-shift')]);
    let lcp = null;
    const last = lcpEntries?.at(-1);
    if (last?.element && last.element.isConnected) {
      const el = last.element;
      const isMedia = el instanceof HTMLImageElement || el instanceof SVGImageElement || el.tagName === 'VIDEO' || last.url;
      lcp = isMedia
        ? { ...imageFacts(el, last.url), renderTime: Math.round(last.renderTime || last.loadTime || last.startTime), method: 'measured' }
        : { kind: 'text', tag: el.tagName.toLowerCase(), renderTime: Math.round(last.renderTime || last.startTime), method: 'measured' };
    } else {
      // No LCP API (Firefox, Safari): the largest image in the first screen of the document.
      let best = null;
      let bestArea = 0;
      for (const img of document.images) {
        const r = img.getBoundingClientRect();
        const top = r.top + scrollY;
        if (top >= innerHeight || r.width < 2 || r.height < 2) continue;
        const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(top + r.height, innerHeight) - Math.max(top, 0));
        if (area > bestArea) {
          best = img;
          bestArea = area;
        }
      }
      if (best) lcp = { ...imageFacts(best), renderTime: null, method: 'estimated' };
    }

    let cls = null;
    if (shifts) cls = Math.round(shifts.filter((s) => !s.hadRecentInput).reduce((sum, s) => sum + s.value, 0) * 1000) / 1000;

    const images = [];
    for (const img of document.images) {
      const url = img.currentSrc || img.src || img.getAttribute('data-src') || '';
      if (!url || url.startsWith('data:')) continue;
      const style = getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = img.getBoundingClientRect();
      if (r.width <= 2 && r.height <= 2 && img.complete && img.naturalWidth <= 2) continue; // tracking pixels
      const reserved =
        (img.hasAttribute('width') && img.hasAttribute('height')) ||
        (style.aspectRatio && style.aspectRatio !== 'auto' && !style.aspectRatio.startsWith('auto ')) ||
        style.position === 'absolute' ||
        style.position === 'fixed' ||
        (img.style.width && img.style.height && !/%|auto/.test(img.style.width + img.style.height));
      images.push({
        url,
        reserved: Boolean(reserved),
        aboveFold: r.top + scrollY < innerHeight,
        natural: img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null,
        displayed: { width: Math.round(r.width), height: Math.round(r.height) },
      });
    }
    return { lcp, cls, images, url: location.href };
  }

  globalThis.__imageScraper = { scan, autoScroll, highlight, fetchAsDataUrl, watch, pick, count, links, inspect, speed };
})();
