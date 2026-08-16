# The browser API

**Status:** normative for v1 of the browser shell. Companion to
[`SKIN-FORMAT.md`](SKIN-FORMAT.md), which describes what a skin *is*; this
describes what a skin can *do* once Oriel owns the browser.

The short version of why this document exists: an extension can restyle the
content area and nothing else, and on some platforms it cannot run a skin's
JavaScript at all. Owning the browser removes both limits. Everything below is
either impossible or unreliable in an extension.

---

## 1. Two guarantees an extension could not make

**Skin JavaScript always runs.** There is no extension Content-Security-Policy
between Oriel and the page, and no permission switch for a user to find. `caps`
still exists, but it reports which *host* is running, not whether the skin's
code will execute.

**Injection timing is exact.** The runtime is installed as a document-start user
script by the browser itself, before any of the page's own code, every time,
including on the first navigation of a cold start.

---

## 2. `oriel` — the object a skin receives

Grouped by namespace. A namespace missing from the running host is `undefined`
rather than a stub that fails later; `oriel.can("chrome.toolbar")` is the check.

### 2.1 `oriel.page` — the document

Everything the extension version had, unchanged:
`css`, `dom`, `watch`, `on`, `vars`, `asset`, `log`.

Added by the browser:

```js
oriel.page.navigate(url, { replace })  // this tab, this document
oriel.page.reload({ cache })
oriel.page.stop()
oriel.page.back() / .forward()
oriel.page.zoom(factor)
oriel.page.evaluate(code, { world })   // "isolated" | "main" — both, always
oriel.page.snapshot({ full })          // a PNG data URL of the page
oriel.page.readability()               // extracted article text, title, byline
oriel.page.find(text, options)
```

`page.evaluate` into the **main world** is the one most worth naming: it is how
a skin patches a site's own framework, and no extension API offers it reliably.

### 2.2 `oriel.tabs` — the browser's tabs

```js
oriel.tabs.list()                      // [{ id, url, title, active, pinned, group, loading }]
oriel.tabs.current()
oriel.tabs.open(url, { background, after, group })
oriel.tabs.navigate(id, url, { replace })   // load a URL into an existing tab
oriel.tabs.close(id) / .activate(id) / .move(id, index)
oriel.tabs.pin(id, pinned)
oriel.tabs.group(ids, { name, colour })
oriel.tabs.onChanged(fn)               // created | closed | activated | navigated | titled
```

A skin can therefore *be* a tab manager: vertical tabs, tab search, session
save and restore, auto-grouping by domain.

### 2.3 `oriel.chrome` — the browser's own interface

This is the namespace that justifies the whole pivot. The browser's UI is built
from the same engine, so a skin can restyle and restructure it exactly as it
restyles a page.

```js
oriel.chrome.css(text)                 // stylesheet against the browser's own UI
oriel.chrome.dom(ops)                  // layout operations against the browser's own UI
oriel.chrome.theme({ tokens })         // the design tokens the whole UI reads
oriel.chrome.toolbar.add({ id, icon, title, position, onTap })
oriel.chrome.toolbar.remove(id)
oriel.chrome.toolbar.list()            // what is registered, including other skins'
oriel.chrome.toolbar.onChanged(fn)     // so the chrome document can re-render
oriel.chrome.addressBar.set({ placeholder, hidden, transform })
oriel.chrome.gesture.on("swipe-left" | "long-press" | "pull-down", fn)
oriel.chrome.menu.add({ target: "link" | "image" | "page", title, onTap })
oriel.chrome.newTab.set({ url })       // or render your own
oriel.chrome.hide(part) / .show(part)  // "tabs" | "toolbar" | "address" | "status"
```

`chrome.theme` is deliberately the *documented* way to recolour the browser;
`chrome.css` is the escape hatch under it. A skin that only sets tokens keeps
working when the UI changes shape.

A toolbar item is `{ id, icon, title, position, onTap }`:

- `icon` is **plain text** — one or two characters, an emoji, or a short label.
  It is rendered as text, never as markup, because the toolbar lives in the
  browser's own document and that document has the browser's privileges.
- `position` is a number. Items without one sort after items with one, and ties
  keep insertion order, so two skins that both omit it stay stable relative to
  each other.
- `title` is required and is what a screen reader reads.

`toolbar.add` is a skin talking to the browser; `toolbar.onChanged` is the
browser's own interface finding out. Both directions have to exist, or the
chrome document has no way to learn that a skin registered something.

### 2.4 `oriel.net` — requests

```js
oriel.net.on(filter, fn)               // filter: { urls, types, methods }
// fn returns, or resolves to, one of:
//   undefined                         allow
//   { block: true }
//   { redirect: url }
//   { headers: { set, remove } }
//   { body: string, status, headers }  a synthesised response
oriel.net.rules(list)                  // declarative, evaluated natively — faster, and
                                       //   the only form available at document_start
```

Blocking, redirecting, header rewriting and mocking. The declarative `rules`
form exists because a JavaScript callback on every subresource is the wrong
shape on a phone; reach for it first.

### 2.5 `oriel.native` — the device

```js
oriel.native.share({ url, title, text })
oriel.native.clipboard.read() / .write(text)
oriel.native.haptic("light" | "medium" | "heavy" | "success" | "warning")
oriel.native.download(url, { filename })
oriel.native.notify({ title, body })
oriel.native.lock({ reason })          // biometric gate, for a skin over a bank
oriel.native.safeArea()                // insets, so chrome skins can lay out correctly
```

Every one of these is a permission prompt the first time, per skin, and the
grant is visible and revocable in Settings.

### 2.6 `oriel.storage` and `oriel.bus`

```js
oriel.storage.get(key) / .set(key, value) / .remove(key) / .keys()
oriel.bus.emit(channel, data)          // between skins, and to the browser UI
oriel.bus.on(channel, fn)
```

---

## 3. Skins that export APIs

A skin can publish functions for other skins to call. This is what makes the
format a platform rather than a pile of stylesheets: a "reader mode" skin
exports its extractor, and a "save to notes" skin uses it without either author
having to coordinate.

```js
// in skin "reader"
oriel.export({
  extract(document) { … },       // returns { title, byline, html }
  version: 2
});
```

```js
// in any other skin
const reader = await oriel.import("reader", { minVersion: 2 });
if (reader) {
  const article = await reader.extract(document);
}
```

Rules that make this safe to rely on:

- **`import` never throws and never blocks.** A missing or too-old export
  resolves to `null`, so a skin degrades instead of breaking.
- **Calls are asynchronous and structured-cloned**, even between two skins in
  the same page. Passing a live DOM node or a closure across is not possible,
  which keeps one skin from holding another's internals.
- **A skin declares what it imports** in its manifest, so the user can see the
  dependency before installing and Oriel can warn when it is missing:

```json
"imports": [{ "id": "reader", "minVersion": 2, "reason": "article extraction" }]
```

- **Exports are namespaced by skin id and versioned.** Breaking an exported
  function is a major version bump, exactly as it would be for a library.

---

## 4. Hosts and capability

The engine runs against a **Host**. Three exist:

| Host | What it is | Namespaces |
|---|---|---|
| `ios` | The browser. WKWebView, tabs, chrome. | all |
| `extension` | A WebExtension. Kept so the engine can be end-to-end tested in a real browser on Linux, and handy for desktop authoring. | `page`, `storage`, partial `tabs`, partial `net` |
| `test` | In-process, for unit tests. | all, recorded rather than performed |

```js
if (oriel.can("chrome.toolbar")) { … }
```

`oriel.can` takes a dotted capability name and is the only correct way to
branch. Do not test for a namespace's existence by feature-detecting a method —
capability names are stable, method sets are not.

A skin that needs a capability the host lacks should say so once, through
`oriel.log`, and carry on doing what it can. The manager shows the message
against the skin, so a user running the extension host understands why a
chrome-restyling skin does nothing.

---

## 5. Permissions

Namespaces divide into three bands:

- **Free** — `page`, `storage`, `bus`, `export`/`import`. Implied by installing.
- **Declared** — `tabs`, `net`, `chrome`. Listed in the manifest, shown at
  install, granted as a group.
- **Prompted** — everything in `native`, plus `net` synthesised responses.
  Asked at first use, per skin, revocable.

```json
"permissions": ["tabs", "chrome", "native.clipboard"]
```

A skin asking for `net` gets told, at install, in one sentence, that it can see
and change every request the browser makes. That sentence is the product's most
important piece of copy and should not be softened.

---

## 6. What is deliberately absent

- **No arbitrary native code.** Skins are HTML, CSS and JavaScript. A skin that
  needs a native module is not a skin.
- **No background execution.** A skin runs while its pages are open. Nothing
  earns the battery cost of running when the browser is closed.
- **No access to another skin's storage**, except through what that skin
  chooses to export.
- **No telemetry hook.** There is nowhere for a skin to phone home from that is
  not an ordinary `fetch` the user can see in the network log.
