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
  const PROBES = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  const CANVAS_AREA = 0.6;
  const WHITE = 'rgb(255, 255, 255)';
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
html[data-nightfall="soft"] {
  /* Soft: for saturated-brand sites. Land on dark grey instead of black and
     mute the palette instead of flipping it to loud complements. Photos lose
     some pop (grayscale has no counter-filter); that's this mode's trade. */
  filter: invert(0.92) hue-rotate(180deg) grayscale(0.35) brightness(${settings.brightness}%) contrast(${settings.contrast}%) !important;
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

  // Returns 'on', 'soft', 'deep', or false. 'soft'/'deep' only ever come from an
  // explicit site override — detection never picks them.
  function resolve(override, isDark) {
    if (override === 'on') return 'on';
    if (override === 'soft') return 'soft';
    if (override === 'deep') return 'deep';
    if (override === 'off') return false;
    if (!settings.enabled) return false;
    if (settings.smart && isDark) return false;
    return 'on';
  }

  // Child frames never trust their own host alone: top frame must be dark too.
  const ownResolve = () => resolve(host ? settings.sites?.[host] : undefined, knownDark);
  const effectiveMode = () => (isTop ? ownResolve() : topOn && ownResolve());

  function apply() {
    let mode = effectiveMode();
    if (mode === 'deep' && drBroken) mode = 'on';
    if (mode === 'deep') {
      // Never both engines: the filter comes off and the scanner stands down.
      document.documentElement.removeAttribute('data-nightfall');
      stopScanner();
      goDeep();
      return;
    }
    undeep();
    ensureStyle();
    if (mode) document.documentElement.setAttribute('data-nightfall', mode === 'soft' ? 'soft' : '');
    else document.documentElement.removeAttribute('data-nightfall');
    if (mode) startScanner();
    else stopScanner();
  }

  // --- deep mode (vendored Dark Reader engine) -----------------------------

  // Loaded lazily, once per frame, and only on sites the user picks: a non-deep
  // page never imports the bundle or sees a DarkReader global.
  let drOn = false;
  let drLoading = false;
  let drBroken = false;
  let drDeferred = false;

  async function goDeep() {
    if (!globalThis.DarkReader) {
      if (drLoading) return;
      drLoading = true;
      try {
        const ns = await import(chrome.runtime.getURL('vendor/darkreader.js'));
        // The UMD build attaches to the isolated-world global; take the module
        // namespace if it somehow didn't.
        if (!globalThis.DarkReader && ns && ns.enable) globalThis.DarkReader = ns;
        if (!globalThis.DarkReader) throw new Error('nightfall: no engine');
      } catch {
        drLoading = false;
        drBroken = true; // CSP-exotic page or dead frame: plain dark beats none
        apply();
        return;
      }
      drLoading = false;
      if (effectiveMode() !== 'deep') return; // state moved on while loading
    }
    try {
      // enable() updates in place, so slider changes just call it again.
      globalThis.DarkReader.enable({
        brightness: settings.brightness, contrast: settings.contrast, sepia: 0
      });
      drOn = true;
    } catch {
      // Wanted a document it didn't have yet; retry once when there is one.
      if (!drDeferred) {
        drDeferred = true;
        onReady(apply);
      }
    }
  }

  function undeep() {
    if (!drOn) return;
    drOn = false;
    globalThis.DarkReader.disable();
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

  // "Tiling" means the image visibly repeats across the box. background-repeat's
  // INITIAL value is repeat, so repeat alone proves nothing — and pattern tiles
  // are often given EXPLICIT sizes, so a tile much smaller than its box counts.
  function isTiling(size, repeat, r) {
    if (repeat === 'no-repeat') return false;
    if (size === 'auto') return true;
    const m = /^(\d+(?:\.\d+)?)px (\d+(?:\.\d+)?)px$/.exec(size);
    return !!m && +m[1] <= r.width / 2 && +m[2] <= r.height / 2;
  }

  // A "photo" wrapping the page's whole UI is a themed backdrop, not a photo —
  // counter-inverting it would un-darken everything inside it.
  function isPageScale(el, r) {
    return r.width * r.height >= innerWidth * innerHeight * 0.9 &&
      el.getElementsByTagName('*').length > 50;
  }

  // All reads (computed style, then rects) before any attribute write.
  function scanSlice(from, to) {
    const cand = [];
    const drop = [];
    for (let i = from; i < to; i++) {
      const el = queue[i];
      if (!el.isConnected || el === document.documentElement || el === document.body) continue;
      const cs = getComputedStyle(el);
      if (cs.backgroundImage.includes('url(')) cand.push([el, cs.backgroundSize, cs.backgroundRepeat]);
      else if (el.hasAttribute(TAG)) drop.push(el);
    }
    const tag = [];
    for (const [el, size, repeat] of cand) {
      const r = el.getBoundingClientRect();
      const photo = r.width >= MIN_W && r.height >= MIN_H &&
        !isTiling(size, repeat, r) && !isPageScale(el, r);
      if (photo && !el.hasAttribute(TAG)) tag.push(el);
      else if (!photo && el.hasAttribute(TAG)) drop.push(el);
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

  // Our filter doesn't affect getComputedStyle, so the page can be measured
  // without un-applying anything — but our own `background-color: #fff` on html
  // does, so html only reports the site's own colour while we're off. Reading it
  // anyway would peg every page to white. body carries no rule of ours.
  function opaqueBg(el) {
    if (el === document.documentElement && el.hasAttribute('data-nightfall')) return null;
    const value = getComputedStyle(el).backgroundColor;
    const c = parseColor(value);
    return c && c.a >= 0.9 ? value : null;
  }

  // The canvas is whatever actually paints behind the page: body/html, or the
  // full-page wrapper an SPA themes instead of them. Take the first opaque box
  // in the hit-test stack that covers most of the viewport — cards, headers and
  // sidebars are too small and get skipped. body/html paint the canvas whatever
  // their own box measures, so they always qualify.
  function canvasAt(x, y, base) {
    for (const el of document.elementsFromPoint(x, y)) {
      const value = opaqueBg(el);
      if (!value) continue;
      if (el === document.documentElement || el === document.body) return value;
      const r = el.getBoundingClientRect();
      if (r.width * r.height >= innerWidth * innerHeight * CANVAS_AREA) return value;
    }
    return base; // nothing opaque hit here: the canvas shows through
  }

  // The bottom of every stack: body's background paints the canvas however
  // small (or empty) body's own box is, so it can be missed by a hit test.
  function baseColor() {
    return opaqueBg(document.body || document.documentElement) ||
      opaqueBg(document.documentElement) || WHITE; // transparent renders as white
  }

  // Five probes, majority wins, no majority falls back to the centre.
  function canvasColor() {
    const base = baseColor();
    const s = PROBES.map(([fx, fy]) => canvasAt(fx * innerWidth, fy * innerHeight, base));
    for (const c of s) if (s.filter((v) => v === c).length >= 3) return c;
    return s[0];
  }

  // "Dark" really means "needs no darkening": an already-dark canvas, or a
  // strongly tinted brand colour — mid-tones map onto mid-tones under
  // invert+hue-rotate, so inverting a colourful page buys no darkness and
  // only scrambles its design. Nightfall kills white glare, nothing else.
  function pageIsDark() {
    const c = parseColor(canvasColor());
    if (!c) return false;
    const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    const sat = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
    return lum < 0.4 || (sat > 0.25 && lum < 0.8);
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
