/**
 * Shared vocabulary for everything under `core/`.
 *
 * `core/` is pure: no `chrome.*`, no `browser.*`, no `document`, no `fetch`.
 * Anything here runs in Node under vitest, which is the whole reason the
 * interesting parts of this extension are provable on a machine that cannot
 * run Safari. Modules that need a DOM take one as an argument; modules that
 * need the network take a fetch function as an argument.
 *
 * The normative description of these shapes is docs/SKIN-FORMAT.md.
 *
 * @module core/types
 */

/**
 * One targeting rule. Six kinds, listed in docs/SKIN-FORMAT.md §3.
 *
 * @typedef {object} Rule
 * @property {"match"|"glob"|"regexp"|"url"|"url-prefix"|"domain"} kind
 * @property {string} value  Raw, uncompiled. Compilation happens in core/target.js.
 */

/**
 * A set of rules. Matches when some include matches and no exclude does.
 *
 * @typedef {object} Targets
 * @property {Rule[]} include
 * @property {Rule[]} exclude
 */

/**
 * @typedef {object} Sheet
 * @property {string} id        Unique within the skin.
 * @property {string} text      CSS source, before var substitution.
 * @property {Targets} [targets] Narrows this sheet inside the skin's scope.
 */

/**
 * @typedef {object} ScriptUnit
 * @property {string} id
 * @property {string} text
 * @property {"isolated"|"main"} world
 * @property {"document_start"|"document_end"|"document_idle"} runAt
 */

/**
 * @typedef {object} Var
 * @property {string} key
 * @property {"text"|"color"|"checkbox"|"number"|"range"|"select"|"image"} type
 * @property {string} label
 * @property {string|number} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [units]
 * @property {{key: string, label: string, value: string}[]} [options]
 */

/**
 * Where a skin came from, and how to check it for updates.
 *
 * @typedef {object} Source
 * @property {"paste"|"url"|"file"|"builtin"} kind
 * @property {string} [url]       What the user typed.
 * @property {string} [resolved]  What was actually fetched.
 * @property {number} [fetchedAt] Epoch ms.
 * @property {string} [digest]    `sha256-<hex>` of the fetched bytes.
 */

/**
 * The normalized in-memory form of a skin. Every input format — `.user.css`,
 * `skin.json`, a bare `.css` file, a userscript — becomes one of these, and
 * nothing downstream of `core/skin.js` knows which it was.
 *
 * @typedef {object} Skin
 * @property {1} format
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string} [namespace]
 * @property {string} [description]
 * @property {string} [author]
 * @property {string} [license]
 * @property {string} [homepageURL]
 * @property {string} [supportURL]
 * @property {string} [updateURL]
 * @property {Targets} targets
 * @property {Sheet[]} css
 * @property {object[]} dom          DOM ops; validated by core/domops.js.
 * @property {ScriptUnit[]} js
 * @property {Var[]} vars
 * @property {Record<string,string>} [assets]  name -> data URL.
 * @property {"document_start"|"document_end"|"document_idle"} runAt
 * @property {boolean} allFrames
 * @property {Source} source
 * @property {string[]} warnings     Non-fatal problems, shown in the UI.
 */

/**
 * A skin as stored, with the user's state attached. The `Skin` half is
 * replaced wholesale on update; the state half survives.
 *
 * @typedef {object} InstalledSkin
 * @property {Skin} skin
 * @property {boolean} enabled
 * @property {number} order
 * @property {Record<string,string|number>} values  User's var choices.
 * @property {number} installedAt
 * @property {number} updatedAt
 */

/**
 * A parse or validation failure with enough detail to fix it.
 *
 * @typedef {object} SkinError
 * @property {string} message
 * @property {number} [line]
 * @property {string} [field]
 */

/** Thrown by parsers. Carries the structured error for the UI. */
export class SkinParseError extends Error {
    /**
     * @param {string} message
     * @param {{line?: number, field?: string}} [detail]
     */
    constructor(message, detail = {}) {
        super(message);
        this.name = "SkinParseError";
        this.line = detail.line;
        this.field = detail.field;
    }
}

/** The three points at which a skin can be applied, in order. */
export const RUN_AT = ["document_start", "document_end", "document_idle"];

/** Rule kinds, in the order the UI lists them. */
export const RULE_KINDS = ["match", "glob", "regexp", "url", "url-prefix", "domain"];

/** Var types, as accepted by both authoring formats. */
export const VAR_TYPES = ["text", "color", "checkbox", "number", "range", "select", "image"];

export {};
