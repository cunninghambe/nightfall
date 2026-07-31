(() => {
  'use strict';

  const DEFAULTS = { enabled: true, smart: true, brightness: 100, contrast: 100, sites: {} };
  const MEDIA = 'img, video, canvas, embed, object, [style*="background-image"]';
  const STYLE_ID = 'nightfall-style';
  const host = location.hostname;

  let settings = { ...DEFAULTS };
  let darkHosts = {};
  let knownDark = false;

  const css = () => `
html[data-nightfall] {
  filter: invert(1) hue-rotate(180deg) brightness(${settings.brightness}%) contrast(${settings.contrast}%) !important;
  background-color: #fff !important;
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

  function effectiveOn() {
    const override = settings.sites?.[host];
    if (override === 'on') return true;
    if (override === 'off') return false;
    if (!settings.enabled) return false;
    if (settings.smart && knownDark) return false;
    return true;
  }

  function apply() {
    ensureStyle();
    document.documentElement.toggleAttribute('data-nightfall', effectiveOn());
  }

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
    const isDark = pageIsDark();
    if (isDark !== knownDark) {
      knownDark = isDark;
      apply();
    }
    if (!!darkHosts[host] !== isDark) {
      if (isDark) darkHosts[host] = true;
      else delete darkHosts[host];
      chrome.storage.local.set({ darkHosts });
    }
  }

  function scheduleDetect() {
    if (!settings.smart || settings.sites?.[host]) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', detect, { once: true });
    } else {
      detect();
    }
  }

  chrome.storage.sync.get(DEFAULTS, (synced) => {
    settings = synced;
    chrome.storage.local.get({ darkHosts: {} }, (local) => {
      darkHosts = local.darkHosts || {};
      knownDark = !!darkHosts[host];
      apply();
      scheduleDetect();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const key of Object.keys(changes)) {
      if (key in DEFAULTS) settings[key] = changes[key].newValue ?? DEFAULTS[key];
    }
    apply();
  });
})();
