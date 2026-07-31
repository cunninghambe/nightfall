# Nightfall 🌙

Fast, simple dark mode for Chrome.

Nightfall is a Manifest V3 extension that turns any site dark with a single CSS
filter — no build step, no dependencies, no network requests, and no per-element
style analysis to slow pages down or glitch out. It was built as a lighter-weight
alternative to Dark Reader: fewer knobs, fewer surprises.

## How it works

- The page is inverted with one `filter: invert(1) hue-rotate(180deg)` rule on
  `<html>`; images, video, canvas, and inline background images are
  counter-inverted so photos still look natural.
- **Smart detection** measures the page's background luminance and leaves sites
  that already ship a dark theme alone. Verdicts are cached per site, so a dark
  site never flashes inverted on a return visit.
- Your settings live in `chrome.storage.sync` and roam with your Chrome profile.
- Total footprint: ~350 lines of vanilla JS across a content script, a service
  worker, and the popup.

## Features

- 🌐 **Global switch** — dark mode everywhere, off with one click when you need it.
- 📌 **Per-site control** — Auto / On / Off for the current site, and overrides stick.
- 🌒 **Already-dark sites are skipped** automatically (toggleable).
- 🔆 **Brightness and contrast sliders** with live preview.
- ⌨️ **Alt+Shift+D** toggles the current site from the keyboard
  (rebindable at `chrome://extensions/shortcuts`).

## Installation

Nightfall isn't in the Chrome Web Store — load it unpacked:

1. **Get the code** — clone this repo, or *Code → Download ZIP* and extract it,
   to a folder on a local disk (cloud-drive mounts like Google Drive can break
   unpacked extensions):

   ```
   git clone https://github.com/cunninghambe/nightfall.git
   ```

2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked** and select the `nightfall` folder.
5. (Optional) Click the puzzle-piece icon in the toolbar and pin **Nightfall**
   so the popup is one click away.

To update later: `git pull`, then hit the reload arrow ↻ on the Nightfall card
at `chrome://extensions`.

## Usage

Click the toolbar icon to open the popup:

| Control | What it does |
|---|---|
| Header switch | Master on/off for the whole extension |
| **Auto / On / Off** | Per-site override for the current site; *Auto* follows the global setting plus smart detection |
| *Skip pages that are already dark* | Toggles smart detection |
| **Brightness** (60–110%) / **Contrast** (60–140%) | Applied live to every darkened page; **Reset** restores 100% |

**Alt+Shift+D** flips the current site between dark and light without opening
the popup.

## Regenerating the icons

The icons are generated, not hand-drawn:

```
powershell -ExecutionPolicy Bypass -File icons\make-icons.ps1
```

Writes `icon16.png`, `icon48.png`, and `icon128.png` next to the script
(Windows only — uses System.Drawing).

## Known limitations

- **Iframes aren't scripted** (top frame only), so embedded content — YouTube
  embeds, ad frames, some widgets — inherits the parent page's inversion and
  looks inverted. Workaround: set that site to **Off**.
- **Background images declared in stylesheets** stay inverted; only inline
  `style="background-image: …"` elements are counter-inverted.
- **Chrome's own pages** (`chrome://`, the Web Store) can't be scripted by any
  extension, so Nightfall does nothing there — the popup says so.
- Smart detection reads the page background once at `DOMContentLoaded`; a site
  that paints its dark theme later may get inverted on first load. Return
  visits use the cached verdict.

## License

[MIT](LICENSE)
