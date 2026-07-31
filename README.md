# Nightfall

A minimal, fast dark mode for Chrome (Manifest V3). Vanilla JS, no build step, no
dependencies — a lighter-weight alternative to Dark Reader.

Nightfall inverts a page with a single CSS filter on `<html>` and counter-inverts
images, video, canvas and inline background images so photos still look right.

## Install (unpacked)

1. Clone this repo (or download it as a ZIP and extract) to a local disk — Chrome
   can't reliably load extensions from cloud-drive mounts.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. **Load unpacked** and pick the repo folder.
5. Pin Nightfall to the toolbar if you want the popup one click away.

## Usage

- **Toolbar icon** opens the popup:
  - Master on/off switch for the whole extension.
  - **Auto / On / Off** for the current site. *Auto* follows the global setting plus
    smart detection; *On* and *Off* are per-site overrides that stick.
  - **Skip pages that are already dark** — leaves natively dark sites alone.
  - **Brightness** (60–110%) and **Contrast** (60–140%) sliders apply live; **Reset**
    puts both back to 100%.
- **Alt+Shift+D** toggles dark mode for the site in the active tab. Rebind it at
  `chrome://extensions/shortcuts`.

Settings live in `chrome.storage.sync`, so they roam with your Chrome profile. The
list of natively dark sites is cached in `chrome.storage.local` per machine, which
is what stops a dark site flashing inverted on your next visit.

## Regenerating the icons

```
powershell -ExecutionPolicy Bypass -File icons\make-icons.ps1
```

Writes `icon16.png`, `icon48.png` and `icon128.png` next to the script.

## Known limitations (v1)

- **Iframes are not scripted** (top frame only), so embedded content — YouTube
  embeds, ad frames, some widgets — inherits the parent page's inversion and looks
  inverted. Workaround: set that site to **Off**.
- **Background images declared in stylesheets** stay inverted. Only inline
  `style="background-image: ..."` elements are counter-inverted.
- **Chrome's own pages** (`chrome://`, the Web Store) can't be scripted by any
  extension, so Nightfall does nothing there — the popup says so.
- Smart detection reads the page background once at `DOMContentLoaded`; a site that
  paints its dark theme later may still get inverted on first load. Re-visiting it
  uses the cached verdict.
