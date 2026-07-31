# Nightfall — design spec

A minimal, fast dark-mode Chrome extension (Manifest V3), built as a lighter-weight
alternative to Dark Reader. Vanilla JS, no build step, no dependencies.

## Repo layout (dual-tree)

- Source of record: `G:\My Drive\Claude\nightfall` (this folder — Google Drive mount).
- Runnable tree Chrome loads: `C:\Users\cunni\nightfall`. Sync with forced robocopy
  (`robocopy "G:\My Drive\Claude\nightfall" C:\Users\cunni\nightfall /E /IS /IT`).
  Drive mtimes are stale, so always force (`/IS /IT`).
- Node tooling must run against the C: tree only (Node breaks on the G: mount).

## Files

```
manifest.json     (already written — keep unless a spec conflict requires a change)
content.js        injected at document_start, top frame only, http/https
background.js     MV3 service worker: keyboard-shortcut handler
popup.html/css/js action popup
icons/icon16.png, icon48.png, icon128.png   (generated, see Icons)
README.md         install + usage + known limitations
```

## Approach: CSS filter inversion

One `<style id="nightfall-style">` element + one attribute `data-nightfall` on `<html>`.

```css
html[data-nightfall] {
  filter: invert(1) hue-rotate(180deg) brightness(B%) contrast(C%) !important;
  background-color: #fff !important;   /* canvas becomes black after inversion */
}
```

`B`/`C` come from settings (default 100). Filter goes on `<html>`, never `<body>`
(a body filter breaks `position: fixed`).

Media must be counter-inverted so photos/video look natural. Define the media set
`img, video, canvas, embed, object, [style*="background-image"]` and use a
nesting guard so a media element inside another matched media element is NOT
double-counter-inverted (which would leave it net-inverted):

```css
html[data-nightfall] :is(MEDIA):not(html[data-nightfall] :is(MEDIA) *) {
  filter: invert(1) hue-rotate(180deg) !important;
}
```

(Expand MEDIA in both places. Do NOT include `picture` or `svg` in the set:
`picture` would double-filter its child `img`; svg is usually UI iconography that
should invert with the page.)

The style element is appended to `document.head || document.documentElement` so it
works at document_start before `<head>` exists. `ensureStyle()` re-writes
`textContent` on every apply so slider changes take effect live.

## Storage schema

`chrome.storage.sync` (roams with the Chrome profile):

```js
DEFAULTS = { enabled: true, smart: true, brightness: 100, contrast: 100, sites: {} }
// sites: { "example.com": "on" | "off" }  — absence of a host means "auto"
```

`chrome.storage.local` (per machine, a cache only):

```js
{ darkHosts: { "example.com": true } }   // sites detected as natively dark
```

## State resolution (single source of truth, duplicated in content + background)

```
override = sites[host]
if override === 'on'  -> ON
if override === 'off' -> OFF
if !enabled           -> OFF
if smart && darkHosts[host] -> OFF   (site ships its own dark theme)
else                  -> ON
```

## content.js

- IIFE, top frame only (`all_frames` not set in manifest).
- On init: read sync settings + local `darkHosts` (callback style, both before first
  apply), set `knownDark`, then `apply()`. document_start + fast storage reads keep
  the flash of light negligible on light pages.
- `apply()` = `ensureStyle()` + `documentElement.toggleAttribute('data-nightfall', effectiveOn())`.
- **Smart detection** (runs at DOMContentLoaded, or immediately if already past it;
  skipped when `!smart` or a site override exists):
  - Computed `backgroundColor` of `body`, falling back to `documentElement` when
    alpha < 0.1; both transparent -> treat as white (light). Parse `rgb()/rgba()`
    with a regex; unparseable -> treat as light.
  - Relative luminance `(0.2126r + 0.7152g + 0.0722b)/255 < 0.4` -> dark.
  - getComputedStyle is NOT affected by our filter, so no un-apply is needed to measure.
  - If verdict differs from `knownDark`: update and re-`apply()`.
  - Update the `darkHosts` cache only when the verdict changed vs. what's stored.
    The cache means a natively-dark site gets no inverted flash on the next visit.
- `chrome.storage.onChanged` (sync area): patch changed keys into `settings`
  (guard `?? DEFAULTS[key]`), re-`apply()`. This is how popup + shortcut changes
  land live without messaging.

## background.js

`chrome.commands.onCommand` for `toggle-site`:
- Query active tab; bail unless protocol is http/https.
- Compute current effective state via the resolution rules above (reads both
  storage areas), then write `sites[host] = currentlyOn ? 'off' : 'on'`.
- No tab messaging — the content script's storage listener picks it up.
- (activeTab is granted on command invocation, so `tab.url` is readable.)

## Popup

~280px wide, dark UI (it's a dark-mode extension — popup is always dark,
`color-scheme: dark`). System font stack, 13px. Sections separated by hairlines:

1. Header: icon48 at 20px + "Nightfall" + global on/off toggle switch (styled
   checkbox) for `enabled`.
2. Site section (hidden on non-http(s) pages, replaced by "Nightfall can't run on
   this page."): hostname + segmented control `Auto | On | Off` bound to
   `sites[host]` ('auto' deletes the key).
3. Checkbox: "Skip pages that are already dark" -> `smart`.
4. Sliders: Brightness 60–110 step 5, Contrast 60–140 step 5, live % labels,
   `input` event saves immediately; small "Reset" link restores 100/100.
5. Footer hint: "Alt+Shift+D toggles the current site".

popup.js: `chrome.storage.sync.get(DEFAULTS)` (promise style is fine here),
`chrome.tabs.query` for the active tab's host, every control writes straight to
`chrome.storage.sync` via one `save(patch)` helper, then re-renders.

## Icons

Generate with a PowerShell 5.1 + System.Drawing script (write it to the session
scratchpad, not the repo... actually commit it as `icons/make-icons.ps1` so they
can be regenerated): transparent background, filled circle in deep indigo
(RGB 30,27,75), pale amber crescent (RGB 253,230,138) built as
GraphicsPath(circle) Region minus offset circle, anti-aliased, saved as PNG at
16/48/128. PS 5.1 gotchas: no `??`/`?.`, use `[System.Drawing.Imaging.ImageFormat]::Png`,
and dispose Graphics/Bitmap.

## Verification (required before reporting done)

1. Icons exist and are non-trivial (>200 bytes each).
2. robocopy sync G: -> C: (exit codes 0–7 are success).
3. From `C:\Users\cunni\nightfall`: `node --check content.js`, `background.js`,
   `popup.js`; parse manifest.json (e.g. `node -e "JSON.parse(...)"`) —
   run Node in the C: tree, never on G:.
4. Confirm every file listed under Files exists in BOTH trees.

## Known limitations (document in README, don't try to fix in v1)

- Iframes inherit the parent-page inversion (top frame only), so embedded videos
  (YouTube embeds etc.) render inverted. Fix: set the site to Off.
- CSS `background-image` photos declared in stylesheets (not inline style) stay
  inverted.
- Chrome UI pages (chrome://, Web Store) can't be scripted.
- Shortcut can be rebound at chrome://extensions/shortcuts.
