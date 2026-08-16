/**
 * The one message vocabulary. The background worker, the content script and
 * every UI page speak only what is listed here.
 *
 * Two reasons it is a file rather than a convention. The UI is written against
 * this list without reading the background's implementation, so the seam stays
 * a seam. And on Safari the background context is evicted aggressively — every
 * exchange has to be a self-contained request/response, which is easy to
 * violate accidentally and obvious to spot in a flat list.
 *
 * @module shared/protocol
 */

/** Page → background. Sent by the content script. */
export const PAGE = {
    /** First contact at document_start. `{ url, top }` → {@link HelloReply}. */
    HELLO: "page.hello",
    /** SPA route change. `{ url }` → {@link HelloReply} for the new URL. */
    NAVIGATED: "page.navigated",
    /** Ask the background to inject CSS with `scripting.insertCSS`. `{ skinId, sheetId, css }`. */
    INSERT_CSS: "page.insertCss",
    /** Undo one {@link PAGE.INSERT_CSS}. `{ skinId, sheetId, css }`. */
    REMOVE_CSS: "page.removeCss",
    /** A line for the per-skin log. `{ skinId, level, message }`. */
    LOG: "page.log",
    /** Per-skin persistent storage for skin JS. `{ skinId, op, key, value }`. */
    STORAGE: "page.storage",
    /** Host-permission-checked fetch on behalf of skin JS. `{ skinId, url, init }`. */
    FETCH: "page.fetch",
    /** Open a URL. `{ url, active }`. */
    OPEN: "page.open"
};

/** UI → background. Sent by the popup, the manager and the editor. */
export const UI = {
    /** `{}` → `{ skins: SkinSummary[], settings, caps }`. */
    LIST: "ui.list",
    /** `{ id }` → `{ installed: InstalledSkin }`. */
    GET: "ui.get",
    /** `{ text, name? }` → {@link ImportReply}. Paste path. */
    IMPORT_TEXT: "ui.importText",
    /** `{ locator }` → {@link ImportReply}. GitHub link / shorthand path. */
    IMPORT_URL: "ui.importUrl",
    /** `{ locator }` → `{ ok, candidates, describe }`. Dry run of the resolver, for the UI to show. */
    PREVIEW_URL: "ui.previewUrl",
    /** `{ id, enabled }` → `{ ok }`. */
    SET_ENABLED: "ui.setEnabled",
    /** `{ id, values }` → `{ ok }`. Live: applies to open tabs without a reload. */
    SET_VALUES: "ui.setValues",
    /** `{ id, source }` → {@link ImportReply}. Re-parse edited source in place, keeping id and values. */
    SAVE_SOURCE: "ui.saveSource",
    /** `{ id }` → `{ ok }`. */
    REMOVE: "ui.remove",
    /** `{ ids }` → `{ ok }`. New order, first wins on conflicting CSS. */
    REORDER: "ui.reorder",
    /** `{ ids? }` → `{ results: UpdateCheck[] }`. Network. */
    CHECK_UPDATES: "ui.checkUpdates",
    /** `{ id }` → {@link ImportReply}. Installs a checked update. */
    APPLY_UPDATE: "ui.applyUpdate",
    /** `{ id }` → `{ text, filename }`. Self-contained, re-importable. */
    EXPORT: "ui.export",
    /** `{ url }` → `{ matches: SkinSummary[], others: SkinSummary[] }`. Drives the popup. */
    FOR_SITE: "ui.forSite",
    /** `{ patch }` → `{ settings }`. */
    SETTINGS: "ui.settings",
    /** `{ skinId?, limit? }` → `{ entries: LogEntry[] }`. */
    LOG_READ: "ui.logRead",
    /** `{ skinId? }` → `{ ok }`. */
    LOG_CLEAR: "ui.logClear",
    /** `{}` → `{ caps }`. What this browser will actually let us do. */
    CAPS: "ui.caps",
    /** `{ enable }` → `{ caps }`. Ask for the optional `userScripts` permission. */
    REQUEST_USER_SCRIPTS: "ui.requestUserScripts",
    /** `{ url, ms }` → `{ ok }`. Dev-mode live reload from a local authoring server. */
    DEV_WATCH: "ui.devWatch"
};

/** Background → everyone, unsolicited. */
export const EVENT = {
    /** Something in the skin set changed; re-read. `{ reason, id? }`. */
    CHANGED: "event.changed",
    /** A skin logged something while a UI page is open. `{ entry }`. */
    LOGGED: "event.logged",
    /** Var values changed; content scripts re-apply without a reload. `{ id, values }`. */
    VALUES: "event.values"
};

/**
 * @typedef {object} HelloReply
 * @property {number} revision   Bumped whenever the applied set changes. The content
 *                               script ignores a reply older than one it already applied.
 * @property {AppliedSkin[]} skins  In apply order.
 * @property {Caps} caps
 * @property {object} settings
 */

/**
 * What the content script actually needs. Deliberately not an `InstalledSkin`:
 * the page gets the resolved, substituted, enabled subset and nothing else.
 *
 * @typedef {object} AppliedSkin
 * @property {string} id
 * @property {string} name
 * @property {number} rev
 * @property {{id: string, text: string}[]} css   Already var-substituted.
 * @property {object[]} dom
 * @property {{id: string, text: string, world: string, runAt: string}[]} js
 * @property {Record<string, string|number>} vars
 * @property {string} varBlock  The `:root{--k:v}` sheet, injected first.
 * @property {string} runAt
 */

/**
 * The result of every install path, successful or not. The UI renders this
 * shape directly; it is the reason a failed import can still show line numbers.
 *
 * @typedef {object} ImportReply
 * @property {boolean} ok
 * @property {SkinSummary} [summary]
 * @property {import("../core/types.js").SkinError[]} errors
 * @property {string[]} warnings
 * @property {string} [tried]     Which candidate URL actually answered.
 */

/**
 * @typedef {object} SkinSummary
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string} [author]
 * @property {string} [description]
 * @property {boolean} enabled
 * @property {number} order
 * @property {string} targets     Human summary from describeTargets().
 * @property {number} cssBytes
 * @property {boolean} hasJs
 * @property {boolean} hasDom
 * @property {number} varCount
 * @property {string} [updateURL]
 * @property {string} [homepageURL]
 * @property {import("../core/types.js").Source} source
 * @property {string[]} warnings
 */

/**
 * What this browser will let Oriel do. Probed once at startup and shown in the
 * UI, because "my skin's JavaScript does nothing" needs an answer that is not
 * a shrug.
 *
 * @typedef {object} Caps
 * @property {"userScripts"|"function"|"none"} js  Which JS mechanism is live.
 * @property {boolean} userScriptsApi
 * @property {boolean} userScriptsPermitted  Granted, vs merely present.
 * @property {boolean} functionConstructor   `new Function` works in the isolated world.
 * @property {boolean} mainWorld             `scripting.executeScript({world:"MAIN"})` works.
 * @property {boolean} insertCss             `scripting.insertCSS` works.
 * @property {boolean} webNavigation         Early CSS push is available.
 * @property {boolean} registerContentScripts
 * @property {string} engine                 "chromium" | "gecko" | "webkit" | "unknown"
 */

/**
 * @typedef {object} LogEntry
 * @property {number} at
 * @property {string} skinId
 * @property {"info"|"warn"|"error"} level
 * @property {string} message
 * @property {string} [url]
 */

/**
 * @typedef {object} UpdateCheck
 * @property {string} id
 * @property {"none"|"available"|"error"|"unversioned"} status
 * @property {string} [version]
 * @property {string} [message]
 */

/** Storage keys. Flat and boring on purpose — Safari's quota accounting is per key. */
export const KEY = {
    /** `SkinSummary[]` plus targeting. One read answers "does anything apply here?". */
    INDEX: "index",
    /** Per skin body. `skin:<id>`. */
    body: (id) => `skin:${id}`,
    /** Per skin var values. `values:<id>`. */
    values: (id) => `values:${id}`,
    /** Per skin storage for skin JS. `store:<id>`. */
    store: (id) => `store:${id}`,
    SETTINGS: "settings",
    LOG: "log",
    CAPS: "caps"
};

/** Defaults for the global settings object. */
export const DEFAULT_SETTINGS = {
    /** "never" | "daily" | "weekly" — never installs, only offers. */
    updateCheck: "weekly",
    /** Keep the last N log lines. A phone is not a place to grow an unbounded array. */
    logLimit: 300,
    /** Apply skins in subframes. Off by default: most frames are ads and trackers. */
    allowFrames: false,
    /** Master switch, so a user can turn everything off without uninstalling. */
    enabled: true,
    /** Local authoring server the extension polls in dev mode. */
    devServer: ""
};
