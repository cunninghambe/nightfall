const DEFAULTS = { enabled: true, smart: true, brightness: 100, contrast: 100, sites: {} };

// Same resolution rules as content.js.
function effectiveOn(settings, override, isDark) {
  if (override === 'on') return true;
  if (override === 'off') return false;
  if (!settings.enabled) return false;
  if (settings.smart && isDark) return false;
  return true;
}

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname;
  } catch {
    return null;
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-site') return;
  // activeTab is granted on command invocation, so tab.url is readable.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const host = hostOf(tabs[0]?.url);
    if (!host) return;
    chrome.storage.sync.get(DEFAULTS, (settings) => {
      chrome.storage.local.get({ darkHosts: {} }, (local) => {
        const sites = { ...settings.sites };
        const on = effectiveOn(settings, sites[host], !!local.darkHosts?.[host]);
        sites[host] = on ? 'off' : 'on';
        // No tab messaging: the content script's storage listener picks this up.
        chrome.storage.sync.set({ sites });
      });
    });
  });
});
