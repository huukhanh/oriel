---
name: webkit-injection
description: The hard-won WebKit and media rules this app is built on — user script sets, content worlds, @match implementation, SPA route handling, CSP, configuration immutability, PiP and background audio limits. Read this before writing or reviewing any code that touches WKWebView, WKUserContentController, WKUserScript, injected JavaScript, AVAudioSession, or Picture-in-Picture, and before designing anything about script matching or injection timing. Trigger it whenever a task mentions injection, userscripts, content worlds, background playback, PiP, or a site-specific script breaking. These rules are counter-intuitive and re-deriving them from first principles produces wrong code that looks right.
---

# Injection and media invariants

Violating any of these produces code that compiles, looks correct, and silently does nothing. That combination is expensive when the build cycle runs through a human.

## The two WebKit facts everything follows from

**1. User scripts are a set, not individually addressable.** `WKUserContentController` has `addUserScript(_:)` and `removeAllUserScripts()`. There is no `remove(script)`. So: keep the desired set in Swift, and rebuild wholesale on any change. Never try to mutate incrementally.

**2. `WKUserScript` has no URL matching.** It runs in every frame of every page. `@match` is entirely our implementation.

## Matching: the guard is the correctness mechanism

The brainstorm describes two layers. Be clear about which one is load-bearing:

- **Layer B (URL guard compiled into each script's wrapper) is correctness.** It must be right on its own.
- **Layer A (recomputing the set before navigation) is an optimization** — it avoids shipping YouTube scripts to unrelated sites. It is not required for correct behavior.

Consequences:
- Ship Layer B first. Consider deferring Layer A entirely in v1; it deletes a whole class of race and redirect bugs.
- If Layer A is implemented, gate the rebuild on `navigationAction.targetFrame?.isMainFrame == true`. Rebuilding on a subframe navigation wipes the main frame's set — an iframe ad can disable the user's scripts.
- Server-side redirects change the final URL after the set was computed. Another reason the guard, not the set, is the source of truth.

## SPA re-entry: idempotence and teardown

The brainstorm's wrapper resets `ran = false` on every history change and re-runs. On `watch → home → watch`, the script body runs twice; anything that adds a listener, a `MutationObserver`, or a DOM node now has two of them. This is the most likely source of "the app gets slow and weird after browsing for a while".

Design the runtime with an explicit contract:

- The wrapper hands each run a fresh scope and a `GM_onCleanup(fn)` (or equivalent) that the runtime calls before the next re-run.
- The runtime tracks listeners/observers registered through its own helpers and tears them down automatically.
- Whatever the mechanism, document it in `docs/userscript-api.md` — the user writes scripts against it, and pasted third-party scripts won't know about it, so pasted scripts must still work (worst case: they double up, which is a documented limitation rather than a mystery).

**Patch `history.pushState` exactly once, in the prelude.** If every wrapper patches it independently you get N nested wrappers, and the Nth script's patch calls the (N-1)th and so on. The prelude patches once and dispatches a custom event (`__inj:navigate`); wrappers listen for it.

## Content worlds

| World | Sees page globals | Use for |
|---|---|---|
| `.page` | yes | anything touching site internals: `document.visibilityState`, `history`, player APIs, `unsafeWindow`-style access |
| `.defaultClient` | no (shared DOM only) | cosmetic DOM/CSS tweaks; safer for untrusted pasted scripts |

Default to `.page` — every media trick requires it and real userscripts assume it.

**Worlds do not share globals, and this includes the bridge.** A message handler added with the plain `add(_:name:)` is not visible from a script running in `.page`. Use the world-taking overloads, and inject the prelude separately into every world that has scripts in it. Symptom of getting this wrong: `window.webkit.messageHandlers.scriptLog is undefined`, from a script that ran fine yesterday in a different world.

## CSP

A user script is exempt from the page's Content-Security-Policy, which is why build-time wrapping works. **Dynamic `eval` inside that script is not exempt.** So: no bootstrap-that-fetches-and-evals architecture, no `new Function(source)`, no `<script>` tag injection with inline source on strict-CSP sites. Wrap at build time in Swift. If a design starts needing `eval`, the design is wrong.

`GM_addStyle` via `<style>` element is fine — style-src rarely blocks it and there's no bridge cost.

## Injection timing

`.atDocumentStart` for anything that overrides page behavior. Overriding `document.hidden` after the page installed its `visibilitychange` handler accomplishes nothing. `.atDocumentEnd` only for scripts that just need the DOM and touch nothing the page owns.

Injection order is set order, which is list order in the UI. The prelude is always first.

## Configuration is immutable after the webview is created

`WKWebViewConfiguration` is copied at `WKWebView(frame:configuration:)`. Mutating it afterwards does nothing — no error, no effect.

So `allowsInlineMediaPlayback`, `allowsPictureInPictureMediaPlayback`, `mediaTypesRequiringUserActionForPlayback`, `websiteDataStore`, and `allowsContentJavaScript` cannot be toggled live.

- One `WebViewFactory.make(settings:)` is the only place a webview is born.
- Changing a config-affecting setting means: capture URL, scroll offset, and back/forward list; build a new webview; restore; reload.
- Group these in the UI under a "Reloads page" section. Keep live-changeable settings (user agent, zoom, scripts, content blockers) visually separate.

`userContentController` is a reference type held by the config — script changes *are* live. Don't rebuild the webview for those.

## Media reality table

| Approach | Status |
|---|---|
| `allowsPictureInPictureMediaPlayback` + user taps a PiP button | Reliable. Needs genuine user activation. This is the baseline. |
| `UIBackgroundModes: audio` + `AVAudioSession(.playback)` | Flaky and site-dependent. Prove it in Phase 0 before building on it. |
| Spoofing `document.hidden` / `visibilityState` so the page doesn't self-pause | High value, orthogonal to the above, and independently useful. |
| Auto-PiP triggered from `visibilitychange` | Fails silently. `visibilitychange` is not user activation; `requestPictureInPicture()` rejects and `webkitSetPresentationMode` fires its event with no window. Don't ship it, don't "fix" it. |
| `AVPictureInPictureController` on web video | Not applicable — needs an `AVPlayerLayer`. |
| Private `_setAutomaticallyStartsPictureInPicture` | Do not use. App Store rejection risk. |

Corollaries:
- Route every PiP entry through a real tap on our toolbar button.
- Keep `isIdleTimerDisabled` on only while media plays, and turn it off on pause and on teardown.
- Now Playing / remote command handling belongs to `MediaCoordinator` in Swift, fed by JS events over the bridge — not implemented in JS.
- **Simulator lies about all of this.** Media behavior is verified on a real device only; see `device-testing`.

## Site scripts rot

Selectors and player internals change without notice. Design for it: every media behavior is an editable built-in script, failures are visible in the log view, and a broken script is one toggle away from off. When a script breaks, the fix is a script edit — not an app update, and not a change to the engine.
