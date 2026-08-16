# The Oriel skin format

**Status:** normative for v1. Everything in `extension/src/core/` implements
this document; if code and document disagree, the document is the bug report.

A **skin** is a package that changes a website's interface. Not a colour tweak —
the format is built on the assumption that an author wants to *replace* a site's
UI: delete its chrome, restructure its DOM, and render their own.

A skin is four things, any of which may be empty:

| Part | What it does | Works where |
|---|---|---|
| **CSS** | restyle, relayout, hide | everywhere, always |
| **DOM ops** | move, wrap, remove, insert, sort, rewrite text | everywhere, always |
| **JS** | anything | where the browser permits user code (see [§8](#8-javascript-and-where-it-runs)) |
| **Vars** | user-tunable settings, surfaced as a generated settings UI | everywhere |

CSS and DOM ops are *declarative*: Oriel interprets them itself, so they are
immune to the page's Content-Security-Policy and to the extension platform's
restrictions on running code obtained at runtime. **A skin that stays
declarative runs identically on every browser Oriel supports, including Safari
on iOS.** JS is the escape hatch, and the format is honest about the fact that
it is not always available.

---

## 1. Two ways to write one

### 1.1 Single file — `*.user.css`

The primary format, and deliberately not a new one: it is
[UserCSS](https://github.com/openstyles/stylus/wiki/Usercss) as implemented by
Stylus, with Oriel-specific keys added under an `@oriel-` prefix that other
tools ignore. An existing UserCSS style installs into Oriel unchanged.

```css
/* ==UserStyle==
@name           Hacker News, rebuilt
@namespace      github.com/you
@version        1.4.0
@description    Card layout, real typography, no table soup.
@author         you
@license        MIT
@homepageURL    https://github.com/you/hn-rebuilt
@updateURL      https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css
@preprocessor   default
@var color   accent    "Accent"        #ff6600
@var range   density   "Row spacing"   [8, 2, 24, 1, "px"]
@var checkbox thumbs   "Show avatars"  1
@var select  corners   "Corner style" {
  "Rounded:round": "12px",
  "Square:square": "0"
}
==/UserStyle== */

@-moz-document domain("news.ycombinator.com") {
  :root { --accent: /*[[accent]]*/; --gap: /*[[density]]*/; }
  .athing { display: grid; gap: var(--gap); border-radius: /*[[corners]]*/; }
  table[border="0"] { all: unset; }
}
```

This is one file. Paste it into Oriel, or give Oriel the GitHub URL.

### 1.2 Bundle — `skin.json`

For skins too large for one file, or that need DOM ops, JS, or assets.

```json
{
  "$schema": "https://oriel.dev/schema/skin-1.json",
  "format": 1,
  "id": "hn-rebuilt",
  "name": "Hacker News, rebuilt",
  "version": "1.4.0",
  "description": "Card layout, real typography, no table soup.",
  "author": "you",
  "license": "MIT",
  "homepageURL": "https://github.com/you/hn-rebuilt",
  "updateURL": "https://raw.githubusercontent.com/you/hn-rebuilt/main/skin.json",
  "matches": ["*://news.ycombinator.com/*"],
  "excludes": ["*://news.ycombinator.com/login*"],
  "runAt": "document_start",
  "allFrames": false,
  "css": ["style.css", "cards.css"],
  "dom": "layout.dom.json",
  "js": [{ "file": "enhance.js", "world": "isolated", "runAt": "document_end" }],
  "vars": [
    { "key": "accent", "type": "color", "label": "Accent", "default": "#ff6600" }
  ],
  "assets": { "logo": "logo.svg" }
}
```

Every `css` / `dom` / `js` entry may be **a path** (resolved relative to the
manifest, only when the skin came from a URL or a folder) or **inline text**
(`{ "text": "..." }`). A bundle whose sources are all inline is a single
self-contained JSON file — that is what "Export" produces, and what a user can
paste.

---

## 2. Identity and versioning

| Field | Rules |
|---|---|
| `id` | `[a-z0-9][a-z0-9-]{0,63}`. Optional. If absent, derived from `namespace` + `name`. Two skins with the same `id` are the same skin; installing one replaces the other. |
| `name` | Required. Free text, shown everywhere. |
| `version` | Required for anything with an `updateURL`. Compared with the [loose semver rule in §7](#7-updates). |
| `namespace` | Optional. A URL or reverse-DNS string that disambiguates two skins with the same name. |

---

## 3. Targeting — where a skin applies

A skin has an **include set** and an **exclude set** of *rules*. A page matches
when at least one include rule matches and no exclude rule matches. Frames are
matched independently; a skin only enters subframes when `allFrames` is true.

Six rule kinds. All six normalise to `{ kind, value }`.

| Kind | Written as | Semantics |
|---|---|---|
| `match` | `"*://*.example.com/*"` | [Chrome match pattern](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Match_patterns). See §3.3. |
| `glob` | `"https://*.foo.com/bar?*"` | Tampermonkey `@include` glob. `*` matches anything, `?` matches one character, and the pattern is anchored at both ends. |
| `regexp` | `"/^https:\\/\\/x\\.com\\/\\d+/"` | A regular expression tested against the full URL. Written slash-delimited in metadata blocks; bare in JSON. |
| `url` | `"https://example.com/page"` | Exact string equality against the full URL. |
| `url-prefix` | `"https://example.com/docs/"` | The URL starts with this string. |
| `domain` | `"example.com"` | The URL's host is this domain or a subdomain of it. |

`url`, `url-prefix`, `domain` and `regexp` are the four `@-moz-document`
functions, so a Stylus style's sections map over exactly. `match` and `glob`
are the two userscript forms.

### 3.1 Where the rules come from

- **`skin.json`** — `matches` / `excludes`. A bare string is a `match` rule; an
  object `{ "kind": "domain", "value": "…" }` is explicit.
- **`*.user.css`** — every `@-moz-document` section contributes its functions as
  include rules *for that section's CSS only*. A skin with three sections has
  three separately-targeted stylesheets under one identity. An `@oriel-match`
  key in the metadata block, if present, scopes the whole skin instead;
  `@match`, `@exclude` and `@exclude-match` are accepted as aliases, because
  that is what anyone who has written a userscript will reach for.
- A skin with **no** include rules matches nothing and is reported as an error
  at install time. Silently matching everything is how a skin escapes onto a
  banking site.

### 3.2 Match patterns, precisely

Oriel implements the Chrome/MDN grammar, because that is what every pasted
userscript was written against.

```
<pattern>  := "<all_urls>" | <scheme> "://" <host> <path>
<scheme>   := "*" | http | https | ws | wss | ftp | file | data
<host>     := "*" | "*." <hostname> | <hostname> | ""   (empty only for file://)
<path>     := "/" <anything, with * matching any run of characters>
```

- `*` as the scheme means **`http` or `https` only** — not `ftp`, not `file`.
- `*.example.com` matches `example.com` **and** every subdomain. A bare
  `example.com` matches that host alone.
- `*` in the host is legal only as the entire host or as the leading label
  followed by `.`. `mozilla.*.org` and `*zilla.org` are errors, not
  never-matches.
- The path is **required**. `*://example.com` is an error.
- The path is matched against `pathname + search`. **The fragment is stripped
  first**, so `https://x.com/a` matches `https://x.com/a#top`. This is Chrome's
  rule; a pattern containing `#` can therefore never match anything, and Oriel
  reports that as an error rather than letting it fail silently.
- Host comparison is case-insensitive and punycode-normalised. Path comparison
  is case-sensitive.
- `<all_urls>` covers `http`, `https`, `ws`, `wss`, `ftp`, `data` and `file`.
- A port in the host (`example.com:8080`) is Chrome-only and Firefox ignores it.
  Oriel rejects it, because a rule that means different things on different
  browsers is worse than one that does not compile.

The other five kinds match against the **full URL, fragment included** — `url`
in particular is an exact-equality test, and stripping the fragment from it
would make it impossible to target a single route of a hash-routed app.

A `regexp` rule written slash-delimited may carry flags (`/x/i`); `g` and `y`
are stripped, because `RegExp.prototype.test` is stateful with those set and a
rule that matches every other call is not a rule.

### 3.3 Over-matching is the security bug

`*://*.example.com/*` must **not** match `https://evil.com/?q=example.com`,
`https://notexample.com/`, or `https://example.com.evil.com/`. The rule
compiler is tested against those three cases and a dozen more, because a rule
that matches too much hands a third party's code to a site the user never
authorised.

---

## 4. CSS

An array of stylesheets. Each is applied to a matching page at `document_start`
via the browser's own CSS injection API, so it lands before first paint and is
unaffected by the page's `style-src` CSP.

Each stylesheet may carry its own `targets`, narrowing it inside the skin's
overall scope — that is how `@-moz-document` sections are represented.

Oriel adds nothing to the CSS except variable substitution ([§6](#6-vars)). It
does not rewrite selectors, add `!important`, or scope rules. What you write is
what the page gets.

---

## 5. DOM ops

CSS cannot move a node into a different parent, wrap it, re-order by content, or
change text. DOM ops can, and unlike JS they are data — reviewable in a diff,
and executable everywhere.

A `dom` value is an array of operations, each `{ "op": …, "select": …, … }`.

### 5.1 The operations

| `op` | Fields | Effect |
|---|---|---|
| `remove` | `select` | Detach every match. |
| `move` | `select`, `into`, `position` | Move matches into the first `into` match. `position` ∈ `append`\|`prepend`\|`before`\|`after` (default `append`). |
| `wrap` | `select`, `with` | Wrap each match in a new element. `with` is `{ tag, class, id, attrs }`. |
| `unwrap` | `select` | Replace each match with its children. |
| `insert` | `into`, `position`, `html` \| `text` \| `element` | Insert new content. |
| `replace` | `select`, `html` \| `text` \| `element` | Replace each match. |
| `setAttr` | `select`, `attr`, `value` | Set an attribute. `value` may reference `$0`–`$9` capture groups when `from` is given. |
| `removeAttr` | `select`, `attr` | Remove an attribute. `attr` may be `*`. |
| `addClass` / `removeClass` / `toggleClass` | `select`, `class` | Class list edits. |
| `setText` | `select`, `text` | Replace text content. |
| `rewriteText` | `select`, `pattern`, `flags`, `with` | Regex-replace text inside matches, text nodes only — never touches markup. |
| `sort` | `select`, `by`, `direction`, `numeric` | Re-order the children of each match. `by` is `{ selector?, attr?, text? }`. |
| `attrToVar` | `select`, `attr`, `var` | Copy an attribute's value into a CSS custom property on the match. Lets CSS react to page data. |

`element` describes a node to build, recursively:
`{ "tag": "button", "class": "o-btn", "attrs": {…}, "text": "…", "children": [ … ] }`.
Building from a description rather than an HTML string is the default because it
cannot inject a `<script>`.

### 5.2 When an op runs

```json
{ "op": "remove", "select": ".ad", "watch": true, "when": { "minWidth": 700 } }
```

- `watch: false` (default) — runs once, when the op's turn comes.
- `watch: true` — re-runs whenever the DOM changes in a way that could produce
  new matches. Oriel debounces to one pass per animation frame and skips nodes
  it has already handled, so `watch` on a busy page costs one `querySelectorAll`
  per frame, not one per mutation.
- `when` — a guard: `minWidth` / `maxWidth` (viewport), `matches` (extra target
  rules), `has` (a selector that must exist).
- `once: "<key>"` — dedupe key; the op will not run twice for the same key even
  across SPA route changes.

### 5.3 HTML is sanitised

`html` strings are parsed and stripped of `<script>`, `<iframe>`, `<object>`,
`<embed>`, `<link>`, `<meta>`, `<base>`, every `on*` attribute, and any
`href`/`src`/`action`/`formaction` whose scheme is not `http`, `https`, `data:`
(images only) or `#`. This is not a sandbox — a skin you install can already
restyle your bank — it is a floor, so that a *declarative* skin cannot smuggle
in script execution on a platform where Oriel promised there would be none.

---

## 6. Vars

A var is a user-tunable value. Oriel generates a settings UI from the
declarations, stores the user's choices per skin, and substitutes them into CSS,
DOM ops and JS.

### 6.1 Types

| `type` | `default` | Extra | UI |
|---|---|---|---|
| `text` | string | `maxLength` | text field |
| `color` | `#rrggbb` / `rgba()` | — | colour well |
| `checkbox` | `0` \| `1` | — | switch |
| `number` | number | `[default, min, max, step, units]` | stepper |
| `range` | number | `[default, min, max, step, units]` | slider |
| `select` | option key | option map | menu |
| `image` | url or option key | option map | menu / URL field |

In `*.user.css` these are the Stylus `@var` forms verbatim:

```
@var color    accent   "Accent"      #ff6600
@var range    density  "Row spacing" [8, 2, 24, 1, "px"]
@var select   corners  "Corners"     {"Rounded:round": "12px", "Square:square": "0"}
```

In `skin.json` they are objects:

```json
{ "key": "density", "type": "range", "label": "Row spacing",
  "default": 8, "min": 2, "max": 24, "step": 1, "units": "px" }
```

### 6.2 How a var reaches the page

Three ways, all active at once:

1. **A CSS custom property** on `:root` — `--accent`, `--density`. Written
   `var(--accent)`. This is Stylus's `@preprocessor default`, it needs no
   preprocessing, and it means a var can be changed *live* without re-injecting
   the stylesheet. It is the recommended way to write a skin.
2. **Textual substitution** of `/*[[accent]]*/`. This is Stylus's
   `@preprocessor uso`, inherited from userstyles.org, and it is what a style
   written before custom properties existed will use. Changing one of these
   requires re-injecting the stylesheet, which Oriel does automatically.
3. **`oriel.vars`** — a frozen object handed to skin JS, and available for
   interpolation in DOM-op string fields as `{{accent}}`.

Oriel does **both** 1 and 2 unconditionally rather than switching on
`@preprocessor`, because Stylus's own rule for picking a mode when the key is
absent depends on whether any variable is declared — a subtlety that produces a
silently unstyled page when you get it wrong. Emitting the `:root` block *and*
substituting the placeholders is a superset of both modes and cannot mis-fire:
a `default`-mode style has no placeholders to substitute, and a `uso`-mode style
does not read the custom properties.

`@preprocessor less` and `@preprocessor stylus` are **not** supported — their
variables are `@name` and bare `name`, which cannot be resolved without shipping
a CSS preprocessor to a phone. A skin declaring one installs with a warning and
its variables are handled as above, which will work for some styles and visibly
fail for others. The warning says so.

---

## 7. Updates

A skin remembers where it came from.

```json
"source": {
  "kind": "url",
  "url": "https://github.com/you/hn-rebuilt/blob/main/hn.user.css",
  "resolved": "https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css",
  "fetchedAt": 1755302400000,
  "digest": "sha256-…"
}
```

`updateURL` (or, absent that, `source.resolved`) is re-fetched on the schedule
the user picks — never, daily, or weekly. A new version is offered, not
installed: **Oriel never silently runs code the user has not seen change.** The
update panel shows a diff.

Version comparison is loose semver: dot-separated numeric segments compared
numerically left to right, missing segments treated as 0, a pre-release suffix
ordering *before* the same version without one, and any unparseable version
treated as "different, therefore newer".

---

## 8. JavaScript, and where it runs

**In the browser, a skin's JavaScript always runs.** Oriel owns the web view, so
the runtime is installed as a document-start user script with nothing between it
and the page: no extension Content-Security-Policy, no permission switch for the
user to find, and exact timing on every navigation including the first.

That guarantee is the reason Oriel is a browser rather than an extension, and it
is written down in [decision 001](decisions/001-browser-not-extension.md).

It does not hold in the **extension host**, which is kept so the engine can be
tested in a real browser on Linux and is handy for authoring on a desktop.
There, the platform decides:

| Mechanism | Used when | Notes |
|---|---|---|
| `userScripts` API | Chrome 120+, Firefox 136+, once the user enables it per-extension | Runs in a dedicated `USER_SCRIPT` world. |
| `new Function` in the content script | the isolated world permits it | Blocked on Chromium — the extension's own CSP applies there, measured. |
| declarative only | nowhere else works | CSS and layout operations still apply. The skin is marked **JS suspended** and the log says why. |

So: write JavaScript freely for the browser, and keep the *structure* of a skin
in CSS and layout operations anyway. A skin whose layout only appears once its
script has run looks broken in the extension host, and a skin whose script only
adds behaviour degrades to something still worth having.

A `js` entry declares:

```json
{ "file": "enhance.js", "world": "isolated", "runAt": "document_end" }
```

- `world: "isolated"` (default) — cannot see the page's variables, is invisible
  to the page. Correct for almost everything.
- `world: "main"` — shares the page's globals. Needed to patch a site's own
  framework. Not available on every platform, and the skin must tolerate being
  refused.

### 8.1 The `oriel` object

Skin JS gets one global. The part every host provides:

```js
oriel.id                     // this skin's id
oriel.vars                   // frozen var values
oriel.css(text) -> handle    // inject additional CSS, removed on cleanup
oriel.dom(ops)               // run layout operations from JS
oriel.on(event, fn)          // "navigate" | "cleanup"
oriel.watch(selector, fn)    // fn(el) for each match now and in future
oriel.asset(name) -> url     // a bundled asset as a blob URL
oriel.storage.get/set        // per-skin persistent storage
oriel.log(...args)           // to the in-app log, not the page console
oriel.fetch(url, init)       // cross-origin, without the user's cookies
oriel.can(capability)        // "chrome.toolbar", "tabs.open", … — always ask this
```

`oriel.watch` exists because it is the thing every skin needs and every skin
gets wrong: a `MutationObserver` per skin, correctly disconnected on cleanup,
correctly not firing twice for the same node.

Everything else — the browser's tabs, its own interface, request interception,
the device, and the ability for one skin to export functions to another — is in
[`BROWSER-API.md`](BROWSER-API.md). A namespace the running host cannot provide
is **absent**, not a stub that fails later, so `oriel.can()` is the check and
`typeof oriel.chrome` is a fair fallback.

---

## 9. Single-page apps

Sites replace their whole UI without a page load. Oriel treats that as a first
class case:

- `history.pushState` / `replaceState` are patched **once**, by Oriel, not by
  each skin.
- On a URL change, Oriel re-evaluates every rule. A skin whose rules stop
  matching gets a `cleanup` event and has its CSS removed. A skin whose rules
  start matching is applied, exactly as it would be on a fresh load.
- A skin that matches both routes is **not** re-run. `once` keys survive the
  transition.
- `watch: true` DOM ops keep working across the transition without
  re-registering.

---

## 10. Shipping more than one — the gallery

A repository holding several skins puts an `index.json` beside them. Paste the
repository's URL and Oriel reads it instead of guessing at filenames.

```json
[
  {
    "id": "hn-rebuilt",
    "name": "Hacker News, rebuilt",
    "description": "Card layout, real typography, no table soup.",
    "author": "you",
    "path": "skins/hn-rebuilt/skin.json",
    "install": "https://raw.githubusercontent.com/you/skins/main/skins/hn-rebuilt/skin.json",
    "matches": ["*://news.ycombinator.com/*"],
    "tags": ["news", "dark"]
  }
]
```

`path` is relative to the repository root; `install` is the absolute raw URL, so
the entry works when the index is read on its own, out of context. Both are
required and they must agree — `oriel check` compares them, because an index
whose `install` URLs point at the author's old repository is worse than no index
at all.

The layout that goes with it is one directory per skin, named for its `id`:

```
skins/
  index.json
  hn-rebuilt/
    skin.json
    style.css
    layout.dom.json
  reader/
    reader.user.css
```

This is the shape the established multi-skin repositories converged on, and
`skins/` in this repository is a worked example. One skin may target several
sites; that is a longer `matches` array, not several entries.

## 11. Errors

A skin never fails silently, and a broken skin never breaks the page.

- **Parse errors** — reported with a line number at install; nothing is stored.
- **Rule errors** — an unparseable target rule disables the skin and says which
  rule.
- **Op errors** — the failing op is skipped, logged with its index, and the rest
  of the skin still runs.
- **JS errors** — caught, logged against the skin, never propagated to the page.
- Everything lands in a per-skin log the user can read on the device, because
  the alternative on a phone is a user who can only report "it doesn't work".
