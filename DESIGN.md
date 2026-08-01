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

---

# v1.1 — limitation fixes (background-image scanner, per-frame darkening, late-theme detection)

Bump manifest to `1.1.0`. Popup and icons unchanged. Three features:

## A. Stylesheet background-image scanner (content.js, runs per frame)

Replace `[style*="background-image"]` in the MEDIA set with a scanner-managed
attribute. New MEDIA set (used in both places in the CSS, nesting guard kept):

```
img, video, canvas, embed, object, iframe, [data-nightfall-media]
```

(`iframe` addition belongs to feature B. Inline styles no longer get a special
CSS path — the scanner sees them via computed style, so heuristics apply
uniformly. The brief pre-scan window where an inline bg photo shows inverted is
accepted.)

Scanner rules — tag element with `data-nightfall-media` iff ALL of:
1. Computed `background-image` contains `url(` (gradient-only values excluded).
2. Rendered box is at least 96×72 px (`getBoundingClientRect`) — big boxes are
   photos; small ones are icons/sprites, which SHOULD stay inverted with the UI.
3. The background would not tile at natural size: skip only when computed
   `background-size` is `auto` AND computed `background-repeat` is not
   `no-repeat`. (`repeat` is the CSS initial value, so it alone proves nothing —
   a `cover`/`contain`/explicitly-sized background is a photo regardless of its
   repeat value.)

Un-tag on re-scan if the element no longer qualifies.

Mechanics:
- Full scan of all elements, chunked (~2000 elements per slice) through
  `requestIdleCallback` (setTimeout(…, 50) fallback) so big pages never jank.
  Batch all reads first (computed style, then rects for candidates), then all
  attribute writes.
- Runs at DOMContentLoaded and again at window `load` (layout/lazy content settled).
- MutationObserver: `childList` + `subtree`, plus `attributes` filtered to
  `class`/`style`. Collect dirty subtree roots into a Set, drain it debounced
  (~250 ms) through the same chunked scanner.
- Scanner is active only while the frame is effectively dark: start on first
  apply()-on, disconnect observer + cancel pending work when the state flips off
  (leave existing tags in place — the CSS is inert without `html[data-nightfall]`).

## B. Per-frame darkening (manifest + content.js + background.js)

manifest: content script gets `"all_frames": true, "match_about_blank": true`.

Frame roles (`const isTop = window.self === window.top`):
- **Top frame**: v1 behaviour, plus `iframe` in the counter-invert MEDIA set —
  a dark top frame no longer paints its iframes inverted; each frame handles itself.
- **Child frame**: never trusts its own hostname alone. Effective state =
  `topOn && ownResolve()` where:
  - `topOn` comes from the background: `chrome.runtime.sendMessage({type:'topState'})`.
    background.js gains an `onMessage` handler that reads `sender.tab.url`
    (available — our content-script matches grant host access) and resolves the
    top host through the same rules (override -> enabled -> smart && darkHosts).
    Non-http(s) or unreadable sender URL -> respond `{on:false}`.
  - `ownResolve()` is the standard v1 resolution on the child's own hostname —
    its own site override, its own already-dark detection (a YouTube embed
    detects dark and is left alone; a light Disqus frame inverts to match).
    Empty hostname (about:blank/srcdoc): skip override lookup, detection only.
  - Child frames re-query topState on EVERY storage change (sync AND local —
    a local `darkHosts` write is how the top frame's first-visit detection
    propagates down). No postMessage anywhere.
- Extract the state-resolution into one function shared by top/child paths in
  content.js; background.js keeps its own copy (no module system — accept the
  duplication, keep both trivially small).

## C. Late dark-theme detection (content.js, top frame; child frames reuse the same code path on their own document)

v1 detects once at DOMContentLoaded. Add, all gated on `smart && no site override`:
- Re-run `detect()` at window `load` and once more 1500 ms after `load`.
- MutationObserver (separate from the scanner's, alive regardless of on/off
  state) on `documentElement` + `body` attribute changes filtered to
  `class`/`style`/`data-theme`-ish attrs — debounced 250 ms -> `detect()`.
  This makes Nightfall follow sites that flip a `dark` class at runtime, in
  both directions.
- Existing darkHosts caching unchanged.

## README updates

Rewrite Known limitations: iframes and stylesheet background photos move to
"handled" (describe briefly in How it works); remaining honest edges — small or
tiling background photos stay inverted (icon heuristic), a site that paints its
dark theme late can still flash briefly on first visit, chrome:// pages
untouchable. Bump the line-count claim if it drifts.

## v1.2 addendum — dark scrollbars (shipped with the README screenshot)

The viewport scrollbar is painted outside the root filter (that's why it stayed
light) but follows the root element's color-scheme. Fix, in the injected CSS:
`color-scheme: dark !important` on `html[data-nightfall]` (native dark viewport
scrollbar) plus `color-scheme: light !important` on `html[data-nightfall] body`
— the page content IS filtered, so form controls and inner scrollbars must keep
rendering light for the inversion to turn them dark. Known edge, accepted: a
root scrollbar the site custom-styles via ::-webkit-scrollbar keeps its authored
(light) colors, since it's outside the filter and ignores color-scheme.

## v1.3 addendum — scanner false-positive guards (field bug, app.quantic.edu 2026-07-31)

Field failure: the scanner tagged a full-viewport page wrapper carrying a
turquoise pattern tile with `background-repeat: repeat` and an EXPLICIT
`background-size: 379px 216px`. The v1.2 tiling rule (`size === 'auto' &&
repeat !== 'no-repeat'`) missed it, and counter-inverting the wrapper
un-darkened the entire UI inside it — Nightfall silently no-ops on any site
built that way. Two guards, both required before tagging:

1. `isTiling(size, repeat, rect)`: no-repeat -> false; size auto -> true;
   explicit `Wpx Hpx` -> true when the tile is <= half the box in BOTH axes
   (pattern tiles get explicit sizes too); cover/contain/percentages -> false.
2. `isPageScale(el, rect)`: box area >= 90% of the viewport AND > 50 descendant
   elements -> themed backdrop wrapping the UI, never a photo. (A full-bleed
   hero section with a heading and a button stays taggable — few descendants.)

## v1.4 addendum — skip strongly tinted pages (field finding, app.quantic.edu 2026-07-31)

Inverting Quantic's teal app produced garbage even with the v1.3 scanner guards:
the background is a MID-TONE brand colour (lum 0.53), and invert+hue-rotate maps
mid-tones approximately onto themselves — so inversion bought no darkness on the
canvas while flipping the white cards black and lightening the dark pattern
image. Conclusion: a strongly tinted page has no white glare to kill and should
be auto-skipped exactly like a native-dark page.

`pageIsDark()` (semantics now "needs no darkening") returns true when
`lum < 0.4` OR (`sat > 0.25` AND `lum < 0.8`), where sat = (max−min)/255 of the
canvas colour. Calibration: Quantic teal rgb(23,166,144) → sat 0.56, lum 0.53 →
skipped. White/near-white docs (sat ~0) → inverted. Pale tints like #e8f0fe
(sat 0.09) → inverted. Bright saturated yellows (lum > 0.8) are still glare →
inverted. Popup label becomes "Skip pages that are already dark or colorful".
darkHosts cache semantics unchanged (stores the skip verdict either way).

## v1.5 addendum — per-site Soft mode (field request, app.quantic.edu 2026-07-31)

For saturated-brand sites the user stares at daily (Quantic MBA), full inversion
is garish (loud complements on pure black) and Off means no dark mode at all.
Soft is a third per-site override value: `sites[host] = 'soft'`.

- CSS: `html[data-nightfall="soft"]` overrides the filter to
  `invert(0.92) hue-rotate(180deg) grayscale(0.5) brightness(B%) contrast(C%)`.
  invert(0.92) lands white on ~#141414 dark grey (not black) and black text on
  ~#ebebeb (not stark white); grayscale(0.5) mutes brand colours into dusky
  tones instead of flipping them to complements. Base rules (canvas white,
  color-scheme split, media counter-invert) still match via `[data-nightfall]`.
- The attribute now carries the mode: `data-nightfall=""` (normal) or `"soft"`.
  resolve() returns 'on' | 'soft' | false; 'soft' only ever comes from an
  explicit override (auto-detection never picks it).
- Known trades, accepted: photos render slightly washed + half-desaturated in
  Soft (counter-invert cancels invert/hue-rotate but grayscale has no inverse);
  Alt+Shift+D from Soft goes to Off (shortcut still toggles on/off only);
  background.js treats 'soft' as on for topState and shortcut state.
- Popup segmented control is Auto | On | Soft | Off.

## v1.6 addendum — backdrop-aware detection

pageIsDark() samples only body/html computed backgroundColor. Two failure
classes: (1) a dark or brand-colored theme painted on a full-page wrapper
while body stays white/transparent — a dark SPA shell gets WRONGLY INVERTED
into a light page, and a CSS-tinted wrapper gets pointlessly inverted;
(2) a backdrop painted by a background-image (app.quantic.edu's pattern PNG) —
invisible to CSS detection. Class (2) is an ACCEPTED limitation: do NOT
canvas-sample images. This fixes class (1).

Replace the body/html read with an effective-canvas sample:

- Sample five viewport points: center, (25%,25%), (75%,25%), (25%,75%),
  (75%,75%).
- At each point call `document.elementsFromPoint(x, y)` (the full stack,
  top → bottom) and take the FIRST element whose computed background-color is
  opaque (alpha >= 0.9) AND whose border box covers >= 60% of the viewport
  area. Cards, headers, and sidebars fail the area test and are skipped; the
  stack naturally bottoms out at body/html, so pages whose theme lives there
  behave exactly as before. No qualifying element at a point -> that sample is
  white (the UA canvas).
- Verdict color = majority among the five samples (>= 3 identical rgb
  strings); no majority -> the center sample.
- Apply the existing verdict rule unchanged: lum < 0.4 OR (sat > 0.25 &&
  lum < 0.8). darkHosts caching, detect() call sites, and the v1.5 mode
  plumbing (resolve() returning 'on' | 'soft' | false) are untouched.

Perf: five elementsFromPoint calls plus a handful of getComputedStyle reads,
only on detection events (DOMContentLoaded, load, +1.5 s, theme flips) — no
per-element scanning.

Fixture cases (established --dump-dom self-reporting style; detection needs no
hostname, file:// is fine):
- Regression, body-color canvases: teal rgb(23,166,144) -> skip; white ->
  invert; pale tint #e8f0fe -> invert; near-black #111 -> skip.
- Dark fixed wrapper (inset 0, opaque #111) over white body -> skip.
- Teal CSS wrapper rgb(23,166,144) over white body -> skip.
- White opaque wrapper over white body -> invert.
- Dark fixed header (full-width, 64px tall) over white body -> invert (small
  surfaces must not fool the sampler).

## v1.7 addendum — per-site Deep mode (vendored Dark Reader engine)

Field verdict (Quantic, 2026-08-01): role-aware colour mapping beats pixel-space
filtering on mid-grey-heavy designs, and always will — a rewriter can push
text mid-greys UP and background mid-greys DOWN; a filter must send every
mid-grey to one place. Rather than reimplement ten years of edge cases, Deep
vendors Dark Reader's own dynamic engine (MIT) and quarantines it to sites the
user explicitly picks. Their engine, our design: the filter stays the default;
Deep pages opt into the heavyweight machinery.

- Vendored: `vendor/darkreader.js` — Dark Reader v4.9.128, UMD build from the
  darkreader npm package via unpkg, 346,017 bytes — plus
  `vendor/LICENSE.darkreader` (MIT (c) 2026 Dark Reader Ltd.). Never modify the
  vendored file. README gains an attribution line ("Deep mode embeds Dark
  Reader's dynamic engine, MIT (c) Dark Reader Ltd / contributors").
- manifest 1.7.0: `web_accessible_resources`:
  `[{ "resources": ["vendor/darkreader.js"], "matches": ["http://*/*", "https://*/*"], "use_dynamic_url": true }]`.
  No new permissions.
- Storage: `sites[host] = 'deep'` — fourth override value. Auto never picks it.
- content.js:
  - resolve() adds `'deep'`; effectiveMode() unchanged (`topOn &&` gating works
    for child frames; all_frames means each frame runs its own engine copy).
  - apply() for 'deep': REMOVE `data-nightfall` (never both engines), stop the
    scanner, lazy-load the engine exactly once per frame — guard first:
    `if (!globalThis.DarkReader) await import(chrome.runtime.getURL('vendor/darkreader.js'))`
    (the guard also lets fixtures preload the engine via a plain script tag).
    The UMD bundle attaches `DarkReader` to the isolated-world global; handle
    either the global or the module namespace. Then
    `DarkReader.enable({ brightness: settings.brightness, contrast: settings.contrast, sepia: 0 })`.
    enable() may need a body — if it throws pre-DOM, defer one apply to
    DOMContentLoaded (a first-paint flash on Deep sites is an accepted trade).
  - Slider changes while deep: call enable() again with new values (it updates
    in place). Leaving deep: `DarkReader.disable()` (guard: only if loaded).
  - Import failures (CSP-exotic pages, dead frame): catch, fall back to mode
    'on' for that frame so the user still gets dark.
  - Non-deep pages must never pay the cost: no import, no DarkReader global.
- background.js: `'deep'` counts as on (topState + shortcut state); Alt+Shift+D
  from deep -> 'off', as with soft.
- popup: segmented control Auto | On | Soft | Deep | Off. Adjust .seg button
  padding/font minimally if five labels crowd 280 px.
- detect()/darkHosts/scanner/theme observers: untouched.

Verification (file:// fixtures via the preload guard — dynamic ESM import does
not run on file://, so fixtures preload the engine with a plain
`<script src="darkreader.js">` before content.js; the real
chrome.runtime.getURL import path is exercised only in the live extension and
gets verified on a real site after install):
- Copy vendor/darkreader.js into the fixture dir; stub
  `chrome.runtime.getURL = (p) => p` (unused under preload, must exist).
- deep fixture: hostname is empty on file://, so the site-override branch
  can't be driven by `sites` — stub storage with `sites: {}` and drive deep
  via a fixture-only override: FIXTURES may set the stubbed sync.get to return
  a host key only when `location.hostname` is non-empty; for file:// use the
  documented fallback of testing resolve()'s deep branch through a direct
  storage stub keyed to '' being skipped — i.e., run the deep fixture over
  http://localhost using the established nffix server pattern ONLY IF the
  empty-host limitation can't be worked around; otherwise prefer file://.
  Expected either way: NO `data-nightfall` attribute,
  `document.querySelectorAll('style.darkreader').length > 0`, computed body
  background luminance < 0.3 on a white-authored page.
- on fixture regression: `data-nightfall=""`, full-invert filter, and
  `typeof DarkReader === 'undefined'` (no engine loaded on non-deep pages —
  this fixture must NOT preload the script tag).
- soft fixture regression unchanged.
- All prior fixture suites (v1.3 scanner, v1.4 tint, v1.6 backdrop) re-run.

## v1.7.2 addendum — the shortcut round-trips the mode

Field bug: Alt+Shift+D from Deep went to Off, but toggling back wrote a bare
'on', losing the user's mode. New sync key `lastModes: {}` (host -> the mode a
site was in when turned Off: 'on' | 'soft' | 'deep' | 'auto'). Recorded by BOTH
Off paths (shortcut and popup); consumed by the shortcut's on-branch, which
restores the recorded mode ('auto' deletes the override). Guard: restoring
'auto' when auto would skip the site (global off / cached-dark) forces 'on'
instead — the user pressed the shortcut to SEE dark. content.js never reads
lastModes.

## v1.1 verification (required)

1. `node --check` content.js + background.js (in the C: tree), manifest parses,
   robocopy G:->C: rc<=7.
2. Headless-Chrome fixture for the scanner (raw content.js with a stubbed
   `chrome.*`): large stylesheet-class bg photo gets tagged + counter-inverted;
   small (icon-sized) bg NOT tagged; gradient-only NOT tagged; repeat-tiled NOT
   tagged; dynamically inserted large bg div gets tagged via the observer.
3. Fixture for late-theme: page flips a `dark` class + colors after load ->
   attribute un-applies within ~1 s.
4. Frame logic: minimum bar is a stub-based test of the child-state math
   (topOn x ownResolve matrix) with chrome.runtime stubbed; full two-frame
   headless run with the real extension loaded is a bonus, not required.
