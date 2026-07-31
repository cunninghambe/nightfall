(() => {
  'use strict';

  const DEFAULTS = { enabled: true, smart: true, brightness: 100, contrast: 100, sites: {} };
  const MEDIA = 'img, video, canvas, embed, object, iframe, [data-nightfall-media]';
  const STYLE_ID = 'nightfall-style';
  const TAG = 'data-nightfall-media';
  const THEME_ATTRS = ['class', 'style', 'data-theme', 'data-color-mode', 'data-bs-theme', 'theme'];
  const MIN_W = 96;
  const MIN_H = 72;
  const CHUNK = 2000;
  const isTop = window.self === window.top;
  const host = location.hostname;

  let settings = { ...DEFAULTS };
  let darkHosts = {};
  let knownDark = false;
  let topOn = false;

  const css = () => `
html[data-nightfall] {
  filter: invert(1) hue-rotate(180deg) brightness(${settings.brightness}%) contrast(${settings.contrast}%) !important;
  background-color: #fff !important;
  /* The viewport scrollbar is painted outside our filter; it follows the
     root color-scheme, so ask for the dark one natively. */
  color-scheme: dark !important;
}
html[data-nightfall] body {
  /* ...but the page CONTENT is filtered: form controls and inner scrollbars
     must keep rendering light so the inversion turns them dark. */
  color-scheme: light !important;
}
html[data-nightfall] :is(${MEDIA}):not(html[data-nightfall] :is(${MEDIA}) *) {
  filter: invert(1) hue-rotate(180deg) !important;
}
`;

  function ensureStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css();
  }

  // --- state ---------------------------------------------------------------

  function resolve(override, isDark) {
    if (override === 'on') return true;
    if (override === 'off') return false;
    if (!settings.enabled) return false;
    if (settings.smart && isDark) return false;
    return true;
  }

  // Child frames never trust their own host alone: top frame must be dark too.
  const ownResolve = () => resolve(host ? settings.sites?.[host] : undefined, knownDark);
  const effectiveOn = () => (isTop ? ownResolve() : topOn && ownResolve());

  function apply() {
    ensureStyle();
    const on = effectiveOn();
    document.documentElement.toggleAttribute('data-nightfall', on);
    if (on) startScanner();
    else stopScanner();
  }

  function refreshTopState() {
    chrome.runtime.sendMessage({ type: 'topState' }, (res) => {
      void chrome.runtime.lastError;
      topOn = !!(res && res.on);
      apply();
    });
  }

  // --- stylesheet background-image scanner ---------------------------------

  let scanning = false;
  let queue = [];
  let cursor = 0;
  let idleId = 0;
  let scanMo = null;
  let dirty = new Set();
  let dirtyId = 0;

  // timeout: background tabs starve untimed idle callbacks indefinitely
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 50));
  const unidle = (id) => (window.requestIdleCallback ? cancelIdleCallback(id) : clearTimeout(id));

  // All reads (computed style, then rects) before any attribute write.
  function scanSlice(from, to) {
    const cand = [];
    const drop = [];
    for (let i = from; i < to; i++) {
      const el = queue[i];
      if (!el.isConnected || el === document.documentElement || el === document.body) continue;
      const cs = getComputedStyle(el);
      // "Tiling" means it would repeat at natural size. background-repeat's
      // INITIAL value is repeat, so repeat alone proves nothing — sized
      // backgrounds (cover/contain/explicit) are photos regardless.
      const tiles = cs.backgroundSize === 'auto' && cs.backgroundRepeat !== 'no-repeat';
      if (cs.backgroundImage.includes('url(') && !tiles) cand.push(el);
      else if (el.hasAttribute(TAG)) drop.push(el);
    }
    const tag = [];
    for (const el of cand) {
      const r = el.getBoundingClientRect();
      const big = r.width >= MIN_W && r.height >= MIN_H;
      if (big && !el.hasAttribute(TAG)) tag.push(el);
      else if (!big && el.hasAttribute(TAG)) drop.push(el);
    }
    for (const el of tag) el.setAttribute(TAG, '');
    for (const el of drop) el.removeAttribute(TAG);
  }

  function step() {
    idleId = 0;
    const end = Math.min(cursor + CHUNK, queue.length);
    scanSlice(cursor, end);
    cursor = end;
    if (cursor >= queue.length) {
      queue = [];
      cursor = 0;
      return;
    }
    idleId = idle(step);
  }

  function pump() {
    if (!idleId && cursor < queue.length) idleId = idle(step);
  }

  function collect(root, out) {
    if (root.nodeType !== 1) return out;
    out.push(root);
    const kids = root.getElementsByTagName('*');
    for (let i = 0; i < kids.length; i++) out.push(kids[i]);
    return out;
  }

  function scanAll() {
    if (!scanning) return;
    queue = collect(document.documentElement, []);
    cursor = 0;
    pump();
  }

  function scanDirty() {
    dirtyId = 0;
    const next = cursor ? queue.slice(cursor) : queue;
    for (const root of dirty) collect(root, next);
    dirty.clear();
    queue = next;
    cursor = 0;
    pump();
  }

  function onScanMutations(records) {
    for (const r of records) {
      if (r.type === 'attributes') dirty.add(r.target);
      else for (const n of r.addedNodes) if (n.nodeType === 1) dirty.add(n);
    }
    if (dirty.size && !dirtyId) dirtyId = setTimeout(scanDirty, 250);
  }

  function startScanner() {
    if (scanning) return;
    scanning = true;
    scanMo = new MutationObserver(onScanMutations);
    scanMo.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
    });
    scanAll();
  }

  // Tags are left in place: the CSS is inert without html[data-nightfall].
  function stopScanner() {
    if (!scanning) return;
    scanning = false;
    scanMo.disconnect();
    scanMo = null;
    if (idleId) unidle(idleId);
    if (dirtyId) clearTimeout(dirtyId);
    idleId = dirtyId = cursor = 0;
    queue = [];
    dirty.clear();
  }

  // --- dark-theme detection ------------------------------------------------

  function parseColor(value) {
    const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/.exec(value || '');
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }

  // getComputedStyle reports the authored colour, unaffected by our filter,
  // so the page can be measured without un-applying anything.
  function pageIsDark() {
    let c = parseColor(getComputedStyle(document.body || document.documentElement).backgroundColor);
    if (!c || c.a < 0.1) c = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    if (!c || c.a < 0.1) return false; // fully transparent renders as white
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 < 0.4;
  }

  function detect() {
    if (!settings.smart || (host && settings.sites?.[host])) return;
    const isDark = pageIsDark();
    if (isDark !== knownDark) {
      knownDark = isDark;
      apply();
    }
    if (host && !!darkHosts[host] !== isDark) {
      if (isDark) darkHosts[host] = true;
      else delete darkHosts[host];
      chrome.storage.local.set({ darkHosts });
    }
  }

  let themeId = 0;
  const themeMo = new MutationObserver(() => {
    if (themeId) return;
    themeId = setTimeout(() => {
      themeId = 0;
      detect();
    }, 250);
  });

  function watchTheme() {
    const opts = { attributes: true, attributeFilter: THEME_ATTRS };
    themeMo.observe(document.documentElement, opts);
    if (document.body) themeMo.observe(document.body, opts);
  }

  // --- init ----------------------------------------------------------------

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function onLoad(fn) {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', fn, { once: true });
  }

  chrome.storage.sync.get(DEFAULTS, (synced) => {
    settings = synced;
    chrome.storage.local.get({ darkHosts: {} }, (local) => {
      darkHosts = local.darkHosts || {};
      knownDark = !!(host && darkHosts[host]);
      apply();
      if (!isTop) refreshTopState();
      onReady(() => {
        watchTheme();
        detect();
        scanAll();
      });
      onLoad(() => {
        detect();
        scanAll();
        setTimeout(detect, 1500);
      });
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      for (const key of Object.keys(changes)) {
        if (key in DEFAULTS) settings[key] = changes[key].newValue ?? DEFAULTS[key];
      }
    } else if (isTop) {
      return; // local area is just the darkHosts cache this frame writes itself
    }
    if (isTop) apply();
    else refreshTopState();
  });
})();
