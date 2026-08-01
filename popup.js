const DEFAULTS = { enabled: true, smart: true, brightness: 100, contrast: 100, sites: {}, lastModes: {} };

const $ = (id) => document.getElementById(id);
const segButtons = document.querySelectorAll('#seg button');

let settings = { ...DEFAULTS };
let host = null;

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname;
  } catch {
    return null;
  }
}

function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.sync.set(patch);
  render();
}

function setSite(value) {
  if (!host) return;
  const sites = { ...settings.sites };
  const lastModes = { ...settings.lastModes };
  // Turning a site off remembers its mode, so the shortcut restores it.
  if (value === 'off') lastModes[host] = sites[host] || 'auto';
  if (value === 'auto') delete sites[host];
  else sites[host] = value;
  save({ sites, lastModes });
}

function render() {
  $('enabled').checked = settings.enabled;
  $('smart').checked = settings.smart;

  $('site').hidden = !host;
  $('nosite').hidden = !!host;
  if (host) {
    $('host').textContent = host;
    const current = settings.sites?.[host] ?? 'auto';
    for (const button of segButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.value === current));
    }
  }

  $('brightness').value = settings.brightness;
  $('contrast').value = settings.contrast;
  $('brightness-value').textContent = `${settings.brightness}%`;
  $('contrast-value').textContent = `${settings.contrast}%`;
}

function wire() {
  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
  $('smart').addEventListener('change', (e) => save({ smart: e.target.checked }));
  $('brightness').addEventListener('input', (e) => save({ brightness: +e.target.value }));
  $('contrast').addEventListener('input', (e) => save({ contrast: +e.target.value }));
  $('reset').addEventListener('click', () => save({ brightness: 100, contrast: 100 }));
  for (const button of segButtons) {
    button.addEventListener('click', () => setSite(button.dataset.value));
  }
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  host = hostOf(tab?.url);
  settings = await chrome.storage.sync.get(DEFAULTS);
  wire();
  render();
})();
