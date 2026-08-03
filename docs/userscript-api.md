# Userscript API

What scripts running in this app can rely on: supported metadata keys, the GM
shim surface, the re-entry and cleanup contract, and known differences from
Tampermonkey. Keep current — pasted third-party scripts are judged against this.

Implemented by `web/src/prelude.js` (the runtime) and
`Core/Sources/Core/WrapperBuilder.swift` (the wrapper each script is built
into).

---

## Metadata block

```js
// ==UserScript==
// @name        Hide Shorts
// @description Removes Shorts shelves
// @match       *://*.youtube.com/*
// @run-at      document-start
// @world       page
// @noframes
// ==/UserScript==
```

| Key | Supported | Notes |
|---|---|---|
| `@name` | yes | |
| `@description` | yes | |
| `@version` | yes | Stored, not acted on. Nothing auto-updates. |
| `@namespace` | yes | Stored only. |
| `@match` | yes | Repeatable. See below. |
| `@run-at` | yes | `document-start` (default) · `document-end` · `document-idle` |
| `@world` | yes | `page` (default) · `isolated` |
| `@noframes` | yes | |
| `@include` / `@exclude` | **no** | Use `@match`. `@include` allows patterns that cannot be evaluated safely. |
| `@require` | **no** | Nothing is fetched. Paste the dependency inline. |
| `@resource` | **no** | |
| `@grant` | ignored | Parsed and ignored — the GM surface below is always the same. |
| `@icon`, `@author`, `@license`, `@homepage`, `@updateURL`, `@downloadURL`, `@connect` | ignored | Parsed and ignored. |

Unknown keys are **never dropped silently** — they surface as warnings in the
editor, with line numbers.

### `@match`

The Chrome/Tampermonkey subset: `<scheme>://<host><path>`, plus `<all_urls>`.

- **Scheme** — `*`, `http`, or `https`. `*` means **http and https only**.
- **Host** — `*` (any), `*.example.com` (that domain *or* any subdomain), or an
  exact host. A `*` anywhere else in the host is an error.
- **Path** — required. `*` is the only wildcard and it spans `/`.

Two deliberate narrowings from Chrome:

- **Only `http` and `https`.** `file:`, `ftp:` and `javascript:` are rejected,
  and `<all_urls>` is narrowed the same way.
- **A malformed `@match` is dropped, never widened.** A script whose patterns
  are all malformed matches nothing. It will never fall back to "everything".

Matching ignores the **port** and the **fragment**; the **query string** is part
of what the path pattern sees. So `*://*.youtube.com/watch*` matches
`https://m.youtube.com/watch?v=abc`.

---

## Lifecycle — the part that differs from the original design

A script's body runs when its `@match` **starts** matching, and its cleanups run
when the pattern **stops** matching.

**While the URL keeps matching, navigating around the site does not re-run the
body.** This matches Tampermonkey, and it is deliberate: pasted scripts already
install their own route handling, and re-running the body on top of that would
give the page two of everything, then three. See
`docs/decisions/005-spa-reentry.md`.

Concretely, for a script matching `*://*.youtube.com/watch*`:

| Navigation | Result |
|---|---|
| load `/watch?v=1` | body runs |
| SPA route to `/watch?v=2` | **nothing** — still matching |
| SPA route to `/` (home) | cleanups run, script stops |
| SPA route back to `/watch?v=3` | body runs again |

A script matching `*://*.youtube.com/*` runs **once** for the whole visit,
however much the user navigates.

If you want per-route work, ask for it:

```js
GM_onRouteChange(function (href) {
    decorate();          // every route change, while matching
});
```

### Re-entry and cleanup

Anything registered through `GM_onCleanup` is torn down before the script stops,
and before it starts again:

```js
const observer = new MutationObserver(update);
observer.observe(document.body, { childList: true, subtree: true });
GM_onCleanup(() => observer.disconnect());
```

**Styles added with `GM_addStyle` are cleaned up automatically.** A style that
outlives its script is the most common way a disabled script keeps changing a
page.

> **Known limitation.** A pasted script that registers listeners with raw
> `addEventListener` and never calls `GM_onCleanup` will not have them removed
> when it stops. Because scripts are not re-run while matching, this does not
> accumulate during normal browsing — but a script that starts and stops
> repeatedly (a narrow `@match` on a site the user navigates in and out of) can
> leave handlers behind. Prefer `GM_onCleanup`.

---

## GM surface

Injected as locals in every script, so pasted scripts calling them work
unchanged.

| API | Behaviour |
|---|---|
| `GM_addStyle(css)` | Appends a `<style>`; removed automatically on cleanup. Returns the element. |
| `GM_onCleanup(fn)` | Registers teardown. Called in reverse order of registration. |
| `GM_onRouteChange(fn)` | Called with the new `href` on SPA navigation while the script is running. |
| `GM_log(...args)` | To the in-app log view. |
| `GM_info` | `{ id }` — the script's stable id. |
| `GM_setValue(key, value)` | Persists per script, JSON-encoded. **Returns a promise** — see below. |
| `GM_getValue(key, fallback)` | **Returns a promise** resolving to the value, or `fallback`. |
| `GM_deleteValue(key)` / `GM_listValues()` | Promises likewise. |
| `GM_xmlhttpRequest` | **Not implemented.** Its purpose is bypassing CORS; that is risk this app does not take on. |
| `GM_openInTab` | **Not yet.** |
| `unsafeWindow` | Not provided — in the default `page` world, `window` *is* the page's window. |

### Storage is asynchronous, unlike Tampermonkey

Tampermonkey's `GM_getValue` is synchronous. This app's is not, and cannot be:
the value lives in Swift, and there is no way to block a content-world script
on a round trip to the native side.

```js
const count = await GM_getValue("count", 0);
await GM_setValue("count", count + 1);
```

Faking the synchronous shape — caching values and writing back — was considered
and rejected: it hands the script a value that is silently stale after an edit
elsewhere or a script reload, and a stale read is worse than an `await`.

**A pasted script calling `GM_getValue` synchronously gets a promise**, which
will not behave as it expects. That is the one place this app knowingly differs
from Tampermonkey's surface rather than simply lacking part of it.

Values are scoped per script id, so two scripts using `"count"` do not collide,
and deleting a script takes its data with it.

Errors thrown by a script body or by a cleanup are caught, reported to the log
view, and do not stop other scripts. A script that throws partway through still
has whatever cleanups it managed to register run when it stops.

---

## Worlds

| World | Sees the page's globals | Use for |
|---|---|---|
| `page` (default) | yes | Anything touching site internals — `document.visibilityState`, `history`, player APIs. |
| `isolated` | no (shared DOM only) | Cosmetic DOM/CSS tweaks; safer for untrusted pasted scripts. |

`page` is the default because every media behaviour in this app requires it and
real userscripts assume that level of access.

---

## No `eval`

Scripts are wrapped **at build time** in Swift and injected as source. A user
script is exempt from the page's Content-Security-Policy, but `eval` and
`new Function` inside one are **not** — they fail on strict-CSP sites, which
includes most sites worth scripting.

So: no `eval(source)`, no `new Function(source)`, no injecting a `<script>` tag
with inline source. A script that needs one of those will fail on exactly the
sites the user cares about most.

**This is measured, not assumed.** `web/webkit/engine.webkit.test.js` serves a
page with `Content-Security-Policy: default-src 'none'; script-src 'none'` in a
real WebKit engine and asserts three things:

| Claim | Result |
|---|---|
| the page's own inline script is blocked | blocked — so the header is genuinely in effect |
| an injected user script still runs | **runs** — user scripts are CSP-exempt |
| `eval` / `new Function` inside that user script | **throw** — the exemption does not extend to them |
| `GM_addStyle` under the same policy | works |

Until that suite existed this was folklore in a comment. jsdom has no CSP
implementation at all, so it could never have caught a design that violated it.
