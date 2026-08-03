# Brainstorm — Scriptable WebView Browser with Media Superpowers (iOS)

**Idea:** a minimal iOS browser that opens a URL, lets me **customize any page with my own scripts** (managed in-app), and has **settings to force PiP / background playback** for every video on the open page.

**Context:** grew out of [`youplay-tech-research.md`](./youplay-tech-research.md). YouPlay is the same shape but closed and un-scriptable — this design keeps the shell and makes the injection layer the product.

---

## 1. Goals / non-goals

**Goals**
- Open an arbitrary URL in a `WKWebView` that behaves like a real browser (persistent login, back/forward, share).
- Author, store, enable/disable, and URL-scope **user scripts (JS) and user styles (CSS)** on-device.
- Settings toggles that make **video keep playing in background** and **enter PiP**, for whatever site is open.
- One person, evenings-and-weekends scope. Ship v1 in a few weekends.

**Non-goals (v1)**
- Not a full multi-tab browser. One webview, a bookmark launcher, done.
- No stream extraction / downloading (ToS and legal exposure, and MSE makes it hard anyway — see §7.5).
- No sync, no accounts, no backend. Zero server = zero cost and no privacy policy headaches.
- Not trying to be Tampermonkey-complete. A useful subset (§6.4).

---

## 2. The one big idea

**Don't build two systems.** The media features and the user scripts are the *same* mechanism: JS injected into the page at the right time, in the right content world.

So: build **one injection engine**, and ship the media behaviors as **built-in scripts** that the settings toggles enable.

```
Settings: [✓] Keep playing in background   →  enables built-in script "visibility-spoof"
          [✓] Force inline playback        →  webview config flag + built-in "playsinline"
          [✓] Playback speed control       →  built-in script "speed-hud"
My Scripts: [✓] hide-youtube-shorts        →  user script
            [ ] reddit-declutter           →  user script
```

Consequences worth having:
- Every media feature is inspectable and editable by me — if a site changes, I patch the script instead of shipping an app update.
- Built-ins are seeded read-only with a **"Duplicate & edit"** action, so a broken tweak never bricks the feature.
- One code path to test, one storage model, one UI.

---

## 3. Architecture

```
┌──────────────────────────────────────────────┐
│ SwiftUI app                                  │
│  ├── LauncherView       (bookmarks grid)     │
│  ├── BrowserView        (webview + toolbar)  │
│  ├── ScriptListView / ScriptEditorView       │
│  └── SettingsView                            │
└───────────────┬──────────────────────────────┘
                │
     ┌──────────▼───────────┐    ┌────────────────────┐
     │ WebViewController    │◄───│ ScriptStore        │
     │  (UIViewRepresentable)│    │ (SwiftData)        │
     │  - WKWebView          │    │  Script, Site,     │
     │  - config factory     │    │  Binding           │
     │  - navigation delegate│    └────────────────────┘
     └──────────┬───────────┘
                │  builds WKUserScript set per navigation
     ┌──────────▼──────────────────────────────┐
     │ InjectionEngine                          │
     │  - pattern matching (&#64;match)             │
     │  - wrap source in URL guard              │
     │  - GM_* shim prelude                     │
     │  - console capture                       │
     └──────────┬──────────────────────────────┘
                │  WKScriptMessageHandler bridge
     ┌──────────▼──────────────────────────────┐
     │ MediaCoordinator                         │
     │  - AVAudioSession lifecycle              │
     │  - PiP trigger (evaluateJavaScript)      │
     │  - Now Playing info                      │
     │  - sleep timer                           │
     └──────────────────────────────────────────┘
```

Stack: **Swift 6 / SwiftUI, iOS 18+, SwiftData, WebKit, AVFoundation.** No third-party deps in v1 (maybe Runestone later for the editor).

---

## 4. Component: browser shell

### 4.1 The config flags that matter

```swift
let cfg = WKWebViewConfiguration()
cfg.allowsInlineMediaPlayback = true          // else video goes fullscreen-only
cfg.allowsPictureInPictureMediaPlayback = true
cfg.mediaTypesRequiringUserActionForPlayback = []   // allow autoplay
cfg.websiteDataStore = .default()             // PERSISTENT — keeps logins/cookies
cfg.defaultWebpagePreferences.allowsContentJavaScript = true
cfg.userContentController = contentController  // scripts live here
```

### 4.2 ⚠️ Design constraint: these are immutable after creation

`WKWebViewConfiguration` is copied when the webview is created. **A settings toggle for inline playback / PiP / autoplay cannot take effect on a live webview.**

Plan for it from day one:
- Single `WebViewFactory.make(settings:)` — the only place a webview is born.
- On a config-affecting setting change: capture `url` + `scrollView.contentOffset` (+ back/forward list if I care), rebuild, restore, reload.
- Show it honestly in the UI: those toggles reload the page. Group them under a "Reloads page" section header so it isn't a surprise.
- Non-config settings (user agent, zoom, scripts, content blockers) *can* change live — keep the two groups visually separate.

### 4.3 Other shell details
- `webView.isInspectable = true` in DEBUG (iOS 16.4+) → **Safari Web Inspector attaches to the app's webview**. This is the single biggest quality-of-life win for authoring scripts; see §12.
- `customUserAgent` toggle (mobile ⇄ desktop). Changes which player some sites serve, which changes what my media scripts have to deal with — useful debugging lever, and it's live-changeable.
- Toolbar, mirroring what YouPlay proved sufficient: back · home · reload · share · **PiP** · **AirPlay** · fullscreen · **scripts** (new). The scripts button opens "scripts affecting this page" — fast path to toggling one off when a site breaks.
- `isIdleTimerDisabled` while media plays.

---

## 5. Component: injection engine (the core)

### 5.1 The two WebKit facts everything else follows from

1. **User scripts are a set, not individually addressable.** No `remove(script)`. Only `removeAllUserScripts()` + re-add. → Keep the desired set in Swift, rebuild wholesale whenever it changes.
2. **`WKUserScript` has no URL matching.** It runs in *every* frame of *every* page. → I implement `&#64;match` myself.

### 5.2 Matching: two layers, both needed

```
Layer A — rebuild before load()
  In BrowserView, before webView.load(request) and on decidePolicyFor(navigationAction)
  for a new document: recompute the matching set for the destination URL, rebuild.
  Handles normal navigation.

Layer B — guard inside the source
  SPAs (YouTube, Reddit, Instagram) change route without a new document, so Layer A
  never fires. Every script is therefore wrapped at build time in a URL guard that
  is re-checked on history changes.
```

Wrapper (generated in Swift, not written by me in every script):

```js
(function(){
  const patterns = [/^https:\/\/(www\.)?youtube\.com\/watch/];  // compiled from &#64;match
  const test = () => patterns.some(p => p.test(location.href));
  let ran = false;
  const run = () => {
    if (ran || !test()) return;
    ran = true;
    try { /* ---- USER SOURCE ---- */ }
    catch (e) { window.webkit.messageHandlers.scriptLog.postMessage({level:'error', msg:String(e)}); }
  };
  run();
  // SPA route changes
  const fire = () => { ran = false; run(); };
  addEventListener('popstate', fire);
  const ps = history.pushState, rs = history.replaceState;
  history.pushState = function(){ ps.apply(this, arguments); fire(); };
  history.replaceState = function(){ rs.apply(this, arguments); fire(); };
})();
```

**No `eval`.** A tempting alternative — inject one bootstrap that fetches and `eval`s matching scripts — dies on any site with a strict CSP. Build-time wrapping sidesteps CSP entirely because it's a *user script*, which is exempt from the page's CSP.

`&#64;match` syntax: support the Chrome/Tampermonkey glob subset (`*://*.example.com/*`) and compile to `NSRegularExpression`. Don't invent a syntax — I want to paste existing userscripts.

### 5.3 Content worlds — get this right or nothing works

| World | Sees page's JS globals | Use for |
|---|---|---|
| `.page` | ✅ yes | anything touching site internals, overriding `document.visibilityState`, hooking `history`, patching player APIs |
| `.defaultClient` (isolated) | ❌ no (shared DOM only) | cosmetic DOM/CSS tweaks, safer default for untrusted scripts |

**Default to `.page`** — real userscripts assume `unsafeWindow`-ish access, and every media trick in §7 requires it. Expose the world as a per-script picker with `.page` preselected.

```swift
WKUserScript(source: wrapped,
             injectionTime: .atDocumentStart,   // must beat the page's own listeners
             forMainFrameOnly: script.mainFrameOnly,
             in: .page)
```

`&#64;run-at document-start` is not a nicety for the media scripts — overriding `document.hidden` **must** happen before the page installs its `visibilitychange` handler.

### 5.4 GM shim subset (cheap, high payoff)

Prelude injected once at document-start, before user scripts:

| API | Implementation |
|---|---|
| `GM_addStyle(css)` | inject `<style>` — pure JS, no bridge |
| `GM_setValue/getValue` | `WKScriptMessageHandlerWithReply` → SwiftData KV per script id |
| `GM_log` / `console.*` capture | `postMessage` → in-app log view |
| `GM_openInTab` | bridge → open in-app or Safari |
| `GM_xmlhttpRequest` | **skip in v1** (CORS bypass = the real reason it exists; adds risk and work) |

Parse a metadata block so pasted scripts Just Work:
```
// ==UserScript==
// &#64;name        Hide Shorts
// &#64;match       *://*.youtube.com/*
// &#64;run-at      document-start
// &#64;world       page
// ==/UserScript==
```
Unknown keys → ignored + surfaced as a soft warning in the editor ("`&#64;require` not supported").

### 5.5 Console capture

Override `console.log/warn/error` in the prelude, `postMessage` to `scriptLog`, render in a **Log** tab with filter by script. Without this, on-device authoring is guesswork. (With `isInspectable` I get the real console too, but only when tethered to a Mac.)

---

## 6. Component: script manager UI

**Scripts list** — name, match summary, enabled toggle, drag to reorder (injection order = list order), swipe to delete, section for `Built-in` vs `Mine`.

**Editor** — name, description, `&#64;match` list editor (add/remove rows), run-at picker, world picker, main-frame-only toggle, source editor, and:
- **"Run on current page now"** — `evaluateJavaScript` the source immediately against the live webview. Instant feedback loop without reloading. This is the feature that makes on-device authoring bearable.
- **"Reload page with this script"** — full document-start path.

**Code editing on iOS is the UX risk.** Ladder:
1. v1: `TextEditor`, `.monospaced()`, `autocorrectionDisabled`, `textInputAutocapitalization(.never)`, `smartQuotesType = .no` ← **critical**, smart quotes silently corrupt JS.
2. + keyboard accessory row: `{ } ( ) [ ] ; = > ' " ⇥` and undo/redo.
3. v2: [Runestone](https://github.com/simonbs/Runestone) for syntax highlighting + line numbers.

**Import/export** — `.user.js` via `fileImporter`, paste from clipboard, `ShareLink` out, and "import from URL" (fetch text, show a diff/preview before saving — never auto-run a fetched script).

**Per-site view** — from the toolbar's scripts button: "3 scripts active on youtube.com" with inline toggles.

**Starter library** — ship §10's scripts as seeded built-ins so the app is useful on first launch.

---

## 7. Component: media — PiP and background playback

The reason this app exists. Here's what actually works, in order of reliability.

### 7.1 Reality check on the mechanisms

| Approach | Works? | Notes |
|---|---|---|
| `allowsPictureInPictureMediaPlayback` + **user taps my PiP button** | ✅ reliable | needs a real user gesture; this is what YouPlay ships |
| `UIBackgroundModes: audio` + `AVAudioSession(.playback)` | ⚠️ mostly | widely reported to be flaky; WebKit's media process can get suspended |
| Spoofing `document.hidden` so the *page* doesn't pause | ✅ high value | fixes page-initiated pause (YouTube web does this); orthogonal to the above |
| Auto-PiP on backgrounding via JS | ❌ silently fails | `visibilitychange` isn't user activation — `requestPictureInPicture()` throws, `webkitSetPresentationMode` fires its event but shows no window |
| `AVPictureInPictureController` | ❌ n/a | requires `AVPlayerLayer`; web video isn't one |
| Private `_setAutomaticallyStartsPictureInPicture` | 🚫 don't | rejection risk |
| Native handoff to `AVPlayer` (§7.5) | ✅ perfect, ❌ limited | only when `cur...</style>