# Writing a skin

This is the tutorial. [`SKIN-FORMAT.md`](SKIN-FORMAT.md) is the reference — come
here to learn, go there to check.

A skin is one file in a Git repository. That is the whole distribution model:
you commit it, and someone pastes the GitHub URL into Oriel. There is no
registry, no review, no account, and nothing to sign up for.

## Ten minutes to something working

```sh
npx oriel init hn --match "*://news.ycombinator.com/*"
cd hn
npx oriel dev
```

`oriel dev` prints an install URL — `http://127.0.0.1:7373/skin.json`. Paste it
into Oriel once, on the same machine. From then on every save re-applies to the
page you are looking at, so the loop is: edit, save, glance at the browser.

Open `hn.user.css` and change something obvious:

```css
@-moz-document domain("news.ycombinator.com") {
  body { background: #101014; color: #e8e8ea; }
}
```

If that lands, everything else is detail.

## Start with CSS, and stay there as long as you can

CSS can do more than people expect to someone else's page, and it is the only
part of a skin guaranteed to work on every platform Oriel runs on. Before
reaching for anything else:

- `display: none` deletes. `display: contents` removes a wrapper from layout
  without removing its children — the single most useful trick against a page
  built out of nested `div`s.
- `order`, `grid-template-areas` and `flex-direction` re-arrange siblings
  without touching the DOM.
- `:has()` gives you the parent selector, so "the row that contains a promoted
  badge" is one selector, not a script.
- `all: unset` on a site's own container is often faster than fighting its
  hundred declarations one at a time.
- `content` on `::before` and `::after` adds text and icons.

A skin that is only CSS installs everywhere, works under any Content-Security-
Policy, and cannot break the page.

## When CSS runs out: layout operations

CSS cannot move a node into a different parent, wrap it, re-order children by
their content, or change text. Layout operations can, and they are **data**, so
Oriel interprets them itself — they work even where the browser forbids
extensions from running downloaded code, and a reviewer can read them in a
`git diff`.

```json
[
  { "op": "unwrap", "select": "table#hnmain, table#hnmain > tbody" },
  { "op": "wrap", "select": ".athing", "with": { "tag": "article", "class": "card" } },
  { "op": "move", "select": ".morelink", "into": "main", "position": "append" },
  { "op": "rewriteText", "select": ".subline a[href^='item']",
    "pattern": "^(\\d+)\\s+comments?$", "with": "$1 💬" },
  { "op": "attrToVar", "select": ".rank", "attr": "data-rank", "var": "--rank" },
  { "op": "remove", "select": ".ad", "watch": true }
]
```

Three modifiers carry most of the weight:

- **`watch: true`** re-runs the operation as the page changes. Use it for
  anything an infinite scroll or a framework will re-render. Oriel coalesces to
  one pass per frame and skips nodes it has already handled, so it is cheap —
  but leave it off when you do not need it.
- **`once: "key"`** stops an operation running twice, and survives a
  single-page route change.
- **`when`** guards on viewport width or the presence of a selector.

Every operation records how to undo itself. That is what lets Oriel take a skin
cleanly off a route that stopped matching, without a reload.

## Variables, and why they are worth declaring

Declare a variable and Oriel generates the settings control for it, stores the
user's choice, and applies changes to the open page live. A slider that moves
the layout while you watch is the best thing about the product, and it costs one
line:

```css
@var range density "Row spacing" [8, 2, 24, 1, "px"]
@var color accent  "Accent"      #ff6600
@var select corners "Corners" {
  "round:Rounded*": "12px",
  "square:Square":  "0"
}
```

Then use them as ordinary custom properties:

```css
.card { gap: var(--density); border-radius: var(--corners); border-color: var(--accent); }
```

Note the option syntax: the object key is `key:Label` — **key first** — and a
trailing `*` marks the default. It is the Stylus convention, and it is the
opposite of what most people guess.

Variables are also how you make a skin adjustable instead of forkable. A user who
can change your accent colour will not maintain a private copy of your skin that
drifts.

## JavaScript, and its honest limits

For anything genuinely dynamic. The skin gets one global:

```js
oriel.watch(".card", (card) => {
  card.querySelector(".meta")?.append(badgeFor(card));
});
```

`oriel.watch` exists because it is the thing every skin needs and every skin gets
wrong: one `MutationObserver`, disconnected on cleanup, each node handed over
exactly once. There is also `oriel.css`, `oriel.dom`, `oriel.storage`,
`oriel.fetch` (cross-origin, without the user's cookies), `oriel.vars`,
`oriel.log`, and `oriel.on("cleanup", …)`.

**Write it so the skin degrades.** Some browsers do not let extensions run code
they downloaded — Chromium refuses outright unless the user enables user scripts,
and Safari's position is not yet established. Oriel says so in the UI rather than
failing silently, but a skin whose layout only works once its script has run will
look broken there. Put the structure in CSS and layout operations, and use
JavaScript for the parts that genuinely cannot be static.

## Publishing

```sh
npx oriel check      # validate before anyone else has to
npx oriel publish    # prints the git commands and the install URL
```

`publish` will tell you if your `updateURL` is missing or points at the wrong
repository. Fix it before the first release: a skin that ships without a correct
`updateURL` **can never be updated**, and every user of it is stranded on the
version they installed.

```css
@version    1.0.0
@updateURL  https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css
```

Bump `@version` on every change you want people to receive. Oriel compares
loosely — `1.10.0` is newer than `1.9.0`, a pre-release sorts below its release —
checks on the schedule the user chose, shows them a diff, and installs nothing
until they agree.

## Shipping more than one

A directory per site, plus an index:

```
skins/
  index.json
  hn-rebuilt/skin.json
  reader/reader.user.css
```

`index.json` is an array of `{id, name, description, author, path, install,
matches, tags}`. A user pastes the repository URL and Oriel finds them.
[`skins/`](../skins) in this repository is a worked example of the layout.

## Things worth knowing before you hit them

- **Scope tightly.** `*://*.example.com/*` matches the domain and every
  subdomain — including ones you have never seen. A skin that matches too much
  is the one real safety problem in this format.
- **Single-page apps re-render everything.** If a change survives the first load
  and vanishes on the first click, you wanted `watch: true`.
- **Specificity, not `!important`.** Reach for `!important` and you have given up
  the ability to override yourself later, including from a variable.
- **Test the logged-out page.** Most sites serve a different DOM to signed-out
  visitors, and your users will include some.
- **`oriel check` catches the boring half** — an undeclared variable used in
  CSS, an unknown operation, a rule that will not compile, a file you forgot to
  commit. Run it before you push.
