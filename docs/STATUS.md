# Where the rework stands

Working branch: `feat/rework-extension`. Nothing has been merged to `main` yet —
`main` is still the old iOS browser.

## The change in direction

Oriel was a scriptable iOS browser. It is now a **cross-browser extension that
stores and applies skins** — packages that completely change a website's
interface — installed by pasting source or by giving a GitHub link, and authored
on a desktop with a CLI. The old `App/`, `Core/` and `web/` trees are deleted;
`docs/SKIN-FORMAT.md` is the new contract and is normative.

## Done and proven

| Piece | State |
|---|---|
| `docs/SKIN-FORMAT.md` | The normative format spec. Written first; everything implements it. |
| `core/target.js` | Targeting: 6 rule kinds, Chrome match patterns. **235 tests.** Mutation-checked. |
| `core/domops.js` | 15 declarative DOM operations, each with an inverse for clean SPA teardown. **81 tests.** |
| `core/userscript.js` | Tampermonkey/Violentmonkey metadata parser. **52 tests.** |
| `core/skin.js` | The normalizer: four input formats in, one `Skin` out. |
| `core/wrapper.js` | Source generation for the `userScripts` world. |
| `shared/protocol.js` | The whole message vocabulary, in one file. |
| `background/*` | Store, capability probe, install pipeline, update checks, apply, router. |
| `content/*` | The engine: styles, the `oriel` API, SPA re-entry. |
| `scripts/build.mjs` | Per-browser bundles into `dist/{chrome,firefox,safari}`. |
| `e2e/harness.js` | Real Chromium with the extension loaded; real WebKit for the engine. |
| CI | `.github/workflows/ci.yml` — lint, unit, build all targets, real-browser E2E. |

**368 unit tests green, lint clean** at the time of writing.

## Two platform facts, measured rather than assumed

1. **Chromium blocks `eval` and `new Function` inside content scripts.** The
   extension's own CSP applies there, independent of the page's. Verified with a
   throwaway extension in real Chromium, on a plain page and on one with
   `script-src 'self'`. So skin JavaScript has exactly two routes: the
   `userScripts` API where it exists and is permitted, or direct evaluation in
   the isolated world on engines that allow it. `background/caps.js` probes
   which, and the UI says so.
2. **`/*[[var]]*/` is Stylus's `uso` preprocessor, not `default`.** `default`
   uses `var(--name)`. Oriel does both unconditionally, which is a superset of
   the two modes and cannot mis-fire.

## In flight

Four teammates were mid-task at the checkpoint. Their files may be partially
present:

- `core/vars.js` + `core/usercss.js` (+ tests) — the UserCSS parser and variable
  system. **`core/skin.js` imports these; the build will not link without them.**
- `core/source.js` + `core/version.js` (+ tests) — GitHub URL resolution and
  version comparison. Also imported by `background/install.js` and `updates.js`.
- `ui/*` — popup and manager, built against `shared/protocol.js`.
- `tools/oriel/*` and `skins/*` — the authoring CLI and worked examples.

## Next, in order

1. **Land the four in-flight modules, then integrate.** `pnpm build` is the
   first honest check that the graph links; `pnpm test:e2e` is the second.
   `e2e/extension.e2e.test.js` is written and waiting.
2. **The Apple half.** `apple/` does not exist yet: an iOS + macOS container app
   with a Safari Web Extension target, expressed in an XcodeGen `project.yml`,
   plus a CI job that produces an unsigned build. This is the only part that
   cannot be verified here at all.
3. **`docs/VERIFICATION.md` and `docs/SAFARI.md`.** Referenced by the README and
   not yet written. The first says where the evidence stops; the second is the
   install path for a phone.
