/**
 * DOM ops — the declarative restructuring layer of docs/SKIN-FORMAT.md §5.
 *
 * Ops are data rather than code because not every platform Oriel ships to will
 * execute JavaScript the extension fetched at runtime, and because a JSON array
 * is reviewable in a diff. Everything here is pure: the document is always an
 * argument, never a global, so the same module runs inside a content script and
 * under vitest with jsdom.
 *
 * Every op records its inverse as it applies. Undo exists for §9: when an SPA
 * navigates to a route the skin does not match, the skin comes off without a
 * reload, and an undo that half-works is worse than no undo at all.
 *
 * @module core/domops
 */

import { SkinParseError } from "./types.js";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Stripped from any HTML a skin supplies (§5.3), and refused by buildElement. */
const FORBIDDEN_TAGS = new Set(["script", "iframe", "object", "embed", "link", "meta", "base"]);

/** Attributes holding a URL, so the only ones whose scheme has to be checked. */
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href"]);

/** Elements whose text is code or chrome. rewriteText never descends into them. */
const OPAQUE_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

/**
 * Ops that compound when a watch pass runs them twice on the same node: wrapping
 * a wrapped node wraps it again, forever. The runner hands us a `handled` map so
 * these skip nodes they have already seen. The rest are left un-deduped on
 * purpose — `sort` has to re-sort when children arrive, `setAttr` has to win
 * back an attribute the page reset.
 */
const DEDUPE_OPS = new Set(["wrap", "insert", "replace"]);

const MAX_ELEMENT_DEPTH = 32;

const VAR_REF = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/** `name: "checker"`, or `"checker!"` when the field is required. */
const OP_SPEC = {
    remove: { fields: { select: "selector!" } },
    move: { fields: { select: "selector!", into: "selector!", position: "position" } },
    wrap: { fields: { select: "selector!", with: "element!" } },
    unwrap: { fields: { select: "selector!" } },
    insert: {
        fields: { into: "selector!", position: "position", html: "string", text: "string", element: "element" },
        content: true
    },
    replace: {
        fields: { select: "selector!", html: "string", text: "string", element: "element" },
        content: true
    },
    setAttr: { fields: { select: "selector!", attr: "writableAttr!", value: "string!", from: "from" } },
    removeAttr: { fields: { select: "selector!", attr: "anyAttr!" } },
    addClass: { fields: { select: "selector!", class: "classList!" } },
    removeClass: { fields: { select: "selector!", class: "classList!" } },
    toggleClass: { fields: { select: "selector!", class: "classList!" } },
    setText: { fields: { select: "selector!", text: "string!" } },
    rewriteText: {
        fields: { select: "selector!", pattern: "string!", flags: "flags", with: "string!" },
        finish: (op) => {
            compileOrFail(op.pattern, op.flags, "pattern");
        }
    },
    sort: { fields: { select: "selector!", by: "by", direction: "direction", numeric: "boolean" } },
    attrToVar: { fields: { select: "selector!", attr: "anyAttr!", var: "customProperty!" } }
};

/** Modifiers from §5.2, accepted on every op. */
const MODIFIER_SPEC = { watch: "boolean", once: "string", when: "when" };

const DEFAULTS = {
    move: { position: "append" },
    insert: { position: "append" },
    rewriteText: { flags: "g" },
    sort: { by: {}, direction: "asc", numeric: false }
};

const CHECK = {
    string(value) {
        if (typeof value !== "string") throw fail("must be a string");
        return value;
    },

    boolean(value) {
        if (typeof value !== "boolean") throw fail("must be true or false");
        return value;
    },

    number(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) throw fail("must be a number");
        return value;
    },

    selector(value, ctx) {
        const selector = CHECK.string(value).trim();
        if (!selector) throw fail("must not be empty");
        if (ctx.document) {
            // A detached fragment parses the selector without touching the page.
            try {
                ctx.document.createDocumentFragment().querySelector(selector);
            } catch {
                throw fail(`is not a valid selector: \`${selector}\``);
            }
        }
        return selector;
    },

    position(value) {
        const position = CHECK.string(value);
        if (!["append", "prepend", "before", "after"].includes(position)) {
            throw fail("must be append, prepend, before or after");
        }
        return position;
    },

    direction(value) {
        const direction = CHECK.string(value);
        if (direction !== "asc" && direction !== "desc") throw fail("must be asc or desc");
        return direction;
    },

    flags(value) {
        const flags = CHECK.string(value);
        if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) {
            throw fail(`are not valid regex flags: \`${flags}\``);
        }
        return flags;
    },

    classList(value) {
        const raw = Array.isArray(value) ? value : [CHECK.string(value)];
        const tokens = raw.flatMap((entry) => CHECK.string(entry).split(/\s+/)).filter(Boolean);
        if (!tokens.length) throw fail("must name at least one class");
        return tokens;
    },

    writableAttr(value) {
        const name = CHECK.anyAttr(value);
        if (name === "*") throw fail("`*` only makes sense for removeAttr");
        if (isEventHandlerAttr(name)) throw fail(`may not set the event handler \`${name}\``);
        return name;
    },

    anyAttr(value) {
        const name = CHECK.string(value).trim();
        if (name !== "*" && !/^[A-Za-z_:][\w.:-]*$/.test(name)) {
            throw fail(`is not a valid attribute name: \`${name}\``);
        }
        return name;
    },

    customProperty(value) {
        const name = CHECK.string(value).trim();
        if (!/^(--)?[A-Za-z_][\w-]*$/.test(name)) throw fail(`is not a valid custom property: \`${name}\``);
        return name.startsWith("--") ? name : `--${name}`;
    },

    element(value, ctx) {
        checkElement(value, ctx, 0);
        return value;
    },

    from(value) {
        if (!isPlainObject(value)) throw fail("must be an object");
        const from = { pattern: CHECK.string(value.pattern) };
        if (value.attr !== undefined) from.attr = CHECK.anyAttr(value.attr);
        if (value.flags !== undefined) from.flags = CHECK.flags(value.flags);
        compileOrFail(from.pattern, from.flags ?? "", "pattern");
        return from;
    },

    by(value, ctx) {
        if (!isPlainObject(value)) throw fail("must be an object");
        const by = {};
        if (value.selector !== undefined) by.selector = CHECK.selector(value.selector, ctx);
        if (value.attr !== undefined) by.attr = CHECK.anyAttr(value.attr);
        if (value.text !== undefined) by.text = CHECK.boolean(value.text);
        return by;
    },

    when(value, ctx) {
        if (!isPlainObject(value)) throw fail("must be an object");
        const when = {};
        if (value.minWidth !== undefined) when.minWidth = CHECK.number(value.minWidth);
        if (value.maxWidth !== undefined) when.maxWidth = CHECK.number(value.maxWidth);
        if (value.has !== undefined) when.has = CHECK.selector(value.has, ctx);
        // `when.matches` needs the rule compiler, which lives outside this
        // module; carry it through for whoever supplies `context.matches`.
        if (value.matches !== undefined) when.matches = value.matches;
        return when;
    }
};

/**
 * Validate and normalize an ops array. Never throws.
 *
 * An unknown `op`, a missing required field, a field of the wrong type, or a
 * selector the engine rejects drops that one op and records an error against
 * `dom[i]`; every other op survives. Unrecognised fields are dropped silently so
 * that a skin written for a later format still runs.
 *
 * @param {unknown} ops
 * @param {Document} [document] Supply one to have selectors parsed for real;
 *   without it only the structural checks run.
 * @returns {{ops: object[], errors: import("./types.js").SkinError[]}}
 */
export function validateOps(ops, document) {
    const errors = [];
    const normalized = [];
    if (ops === undefined || ops === null) return { ops: normalized, errors };
    if (!Array.isArray(ops)) {
        errors.push({ message: "dom must be an array of operations", field: "dom" });
        return { ops: normalized, errors };
    }

    ops.forEach((raw, position) => {
        // Re-validating an already-normalized array must keep reporting against
        // the author's original indices, not the post-drop ones.
        const index = isPlainObject(raw) && Number.isInteger(raw.index) ? raw.index : position;
        try {
            normalized.push(normalizeOp(raw, index, { document }));
        } catch (error) {
            errors.push({ message: error.message, field: error.field ?? `dom[${index}]` });
        }
    });
    return { ops: normalized, errors };
}

function normalizeOp(raw, index, ctx) {
    const field = `dom[${index}]`;
    if (!isPlainObject(raw)) throw located(field, "must be an object");

    const spec = typeof raw.op === "string" ? OP_SPEC[raw.op] : undefined;
    if (!spec) throw located(`${field}.op`, `unknown op \`${String(raw.op)}\``);

    const op = { op: raw.op, index, watch: false };
    readFields(raw, spec.fields, op, field, ctx);
    readFields(raw, MODIFIER_SPEC, op, field, ctx);

    if (spec.content && op.html === undefined && op.text === undefined && op.element === undefined) {
        throw located(field, "needs one of `html`, `text` or `element`");
    }
    for (const [key, value] of Object.entries(DEFAULTS[raw.op] ?? {})) {
        if (op[key] === undefined) op[key] = value;
    }
    if (spec.finish) {
        try {
            spec.finish(op);
        } catch (error) {
            throw located(`${field}.${error.field ?? "op"}`, error.message);
        }
    }
    return op;
}

function readFields(raw, fields, op, field, ctx) {
    for (const [key, kind] of Object.entries(fields)) {
        const required = kind.endsWith("!");
        const value = raw[key];
        if (value === undefined || value === null) {
            if (required) throw located(`${field}.${key}`, "is required");
            continue;
        }
        try {
            op[key] = CHECK[required ? kind.slice(0, -1) : kind](value, ctx);
        } catch (error) {
            throw located(`${field}.${key}`, error.message);
        }
    }
}

function checkElement(desc, ctx, depth) {
    if (depth > MAX_ELEMENT_DEPTH) throw fail("is nested too deeply");
    if (!isPlainObject(desc)) throw fail("must be an object with a tag");
    CHECK.string(desc.tag);
    if (desc.class !== undefined) CHECK.classList(desc.class);
    if (desc.id !== undefined) CHECK.string(desc.id);
    if (desc.text !== undefined) CHECK.string(desc.text);
    if (desc.html !== undefined) CHECK.string(desc.html);
    if (desc.attrs !== undefined) {
        if (!isPlainObject(desc.attrs)) throw fail("attrs must be an object");
        for (const value of Object.values(desc.attrs)) CHECK.string(value);
    }
    if (desc.children !== undefined) {
        if (!Array.isArray(desc.children)) throw fail("children must be an array");
        for (const child of desc.children) {
            if (typeof child !== "string") checkElement(child, ctx, depth + 1);
        }
    }
}

function compileOrFail(pattern, flags, field) {
    try {
        return new RegExp(pattern, flags ?? "");
    } catch (error) {
        const problem = fail(`is not a valid regular expression: ${error.message}`);
        problem.field = field;
        throw problem;
    }
}

/** A field-level complaint; the caller knows which field it was reading. */
function fail(message) {
    return new SkinParseError(message);
}

/** The same complaint, once the caller knows where it happened. */
function located(field, message) {
    const error = new SkinParseError(message);
    error.field = field;
    return error;
}

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEventHandlerAttr(name) {
    return name.toLowerCase().startsWith("on");
}

/* ------------------------------------------------------------------ *
 * Sanitising and building
 * ------------------------------------------------------------------ */

/**
 * True unless the value carries a scheme a skin may not reach for.
 *
 * Browsers ignore C0 controls and whitespace when they work out a scheme, so
 * `java\tscript:` is `javascript:`; strip those before looking at all.
 *
 * @param {string} value
 */
function isSafeUrl(value) {
    const url = String(value).replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase();
    const scheme = /^([a-z][a-z0-9+.-]*):/.exec(url);
    if (!scheme) return true; // relative, protocol-relative, or a bare fragment
    if (scheme[1] === "http" || scheme[1] === "https") return true;
    return url.startsWith("data:image/");
}

function isUnsafeAttr(name, value) {
    const lower = name.toLowerCase();
    if (isEventHandlerAttr(lower)) return true;
    return URL_ATTRS.has(lower) && !isSafeUrl(value);
}

/**
 * Parse an HTML string into a fragment with everything from §5.3 removed.
 *
 * The string is parsed in a document created by `createHTMLDocument`, which has
 * no browsing context: scripts do not run and `src` is never fetched, even for
 * the nodes we are about to throw away.
 *
 * @param {string} html
 * @param {Document} document Owner of the returned fragment.
 * @returns {DocumentFragment}
 */
export function sanitizeFragment(html, document) {
    const inert = document.implementation.createHTMLDocument("");
    inert.body.innerHTML = String(html ?? "");
    scrub(inert.body);

    const fragment = document.createDocumentFragment();
    for (const node of [...inert.body.childNodes]) fragment.appendChild(document.importNode(node, true));
    return fragment;
}

function scrub(root) {
    for (const element of [...root.querySelectorAll("*")]) {
        if (FORBIDDEN_TAGS.has(element.localName)) {
            element.remove();
            continue;
        }
        for (const attr of [...element.attributes]) {
            if (isUnsafeAttr(attr.name, attr.value)) element.removeAttribute(attr.name);
        }
        // Template content is a separate fragment, invisible to querySelectorAll.
        if (element.localName === "template" && element.content) scrub(element.content);
    }
}

/**
 * Build an element from a description: `{ tag, class, id, attrs, text, html,
 * children }`. Unsafe attributes are dropped the way the sanitiser drops them;
 * a description that cannot produce an element at all — no tag, a forbidden tag,
 * runaway nesting — throws, which the caller turns into a per-op error.
 *
 * @param {object} desc
 * @param {Document} document
 * @returns {Element}
 */
export function buildElement(desc, document) {
    return build(desc, document, 0);
}

function build(desc, document, depth) {
    if (depth > MAX_ELEMENT_DEPTH) throw new SkinParseError("element description is nested too deeply");
    if (!isPlainObject(desc)) throw new SkinParseError("element must be an object with a tag");

    const tag = typeof desc.tag === "string" ? desc.tag.trim().toLowerCase() : "";
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new SkinParseError(`\`${String(desc.tag)}\` is not a tag name`);
    if (FORBIDDEN_TAGS.has(tag)) throw new SkinParseError(`a skin may not build a \`${tag}\``);

    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(desc.attrs ?? {})) {
        if (!/^[A-Za-z_:][\w.:-]*$/.test(name)) throw new SkinParseError(`\`${name}\` is not an attribute name`);
        if (isUnsafeAttr(name, value)) continue;
        element.setAttribute(name, String(value));
    }
    // Explicit class/id win over anything the same names in `attrs` set.
    if (desc.class !== undefined) element.setAttribute("class", CHECK.classList(desc.class).join(" "));
    if (desc.id !== undefined) element.setAttribute("id", String(desc.id));
    if (desc.text !== undefined) element.appendChild(document.createTextNode(String(desc.text)));
    if (desc.html !== undefined) element.appendChild(sanitizeFragment(desc.html, document));
    for (const child of desc.children ?? []) {
        element.appendChild(
            typeof child === "string" ? document.createTextNode(child) : build(child, document, depth + 1)
        );
    }
    return element;
}

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

/**
 * Apply ops once, against `context.document`.
 *
 * @param {unknown} ops Raw or already-normalized.
 * @param {{
 *   document: Document,
 *   root?: ParentNode,
 *   vars?: Record<string, string|number>,
 *   log?: (message: string) => void,
 *   viewportWidth?: number,
 *   seen?: Set<string>,
 *   handled?: Map<number, WeakSet<Node>>,
 *   matches?: (rules: unknown) => boolean
 * }} context
 * @returns {{applied: number, errors: import("./types.js").SkinError[], undo: () => void}}
 *   `applied` counts ops that changed something, not nodes touched.
 */
export function applyOps(ops, context) {
    if (!context || !context.document) throw new TypeError("applyOps needs context.document");

    const { document } = context;
    const root = context.root ?? document;
    const { ops: normalized, errors } = validateOps(ops, document);
    const journal = [];
    const ctx = { document, root, journal, context };
    let applied = 0;

    for (const op of normalized) {
        const field = `dom[${op.index}]`;
        try {
            if (op.once && context.seen && context.seen.has(op.once)) continue;
            if (!guardPasses(op, ctx)) continue;

            const count = HANDLERS[op.op](interpolateOp(op, context.vars), ctx);
            if (count > 0) {
                applied += 1;
                // A key is only spent once the op actually did something, so an
                // op whose target has not rendered yet still gets its turn.
                if (op.once && context.seen) context.seen.add(op.once);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({ message, field });
            if (typeof context.log === "function") context.log(`${field} (${op.op}): ${message}`);
        }
    }

    return { applied, errors, undo: () => undoAll(journal) };
}

function undoAll(journal) {
    for (let i = journal.length - 1; i >= 0; i -= 1) {
        try {
            journal[i]();
        } catch {
            // A page that tore the node out from under us must not stop the rest
            // of the undo: a half-reverted skin is the failure we are avoiding.
        }
    }
    journal.length = 0;
}

function guardPasses(op, ctx) {
    const when = op.when;
    if (!when) return true;

    const width = ctx.context.viewportWidth;
    if (typeof width === "number" && Number.isFinite(width)) {
        if (when.minWidth !== undefined && width < when.minWidth) return false;
        if (when.maxWidth !== undefined && width > when.maxWidth) return false;
    }
    if (when.has !== undefined && !queryOne(ctx.root, when.has)) return false;
    if (when.matches !== undefined && typeof ctx.context.matches === "function") {
        if (!ctx.context.matches(when.matches)) return false;
    }
    return true;
}

function interpolateOp(op, vars) {
    if (!vars || Object.keys(vars).length === 0) return op;
    return mapStrings(op, (text) =>
        text.replace(VAR_REF, (match, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : match))
    );
}

function mapStrings(value, fn) {
    if (typeof value === "string") return fn(value);
    if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, fn));
    if (isPlainObject(value)) {
        const out = {};
        for (const [key, entry] of Object.entries(value)) out[key] = mapStrings(entry, fn);
        return out;
    }
    return value;
}

/* ------------------------------------------------------------------ *
 * The operations
 * ------------------------------------------------------------------ */

const HANDLERS = {
    remove(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            const place = placeOf(element);
            if (!place.parent) return false;
            element.remove();
            ctx.journal.push(() => restore(element, place));
        });
    },

    move(op, ctx) {
        const target = queryOne(ctx.root, op.into);
        if (!target) return note(ctx, op, `nothing matches into \`${op.into}\``);
        const anchor = anchorFor(target, op.position);

        return eachTarget(op, ctx, (element) => {
            if (element === target || element.contains(target)) {
                throw new SkinParseError("cannot move an element into itself");
            }
            // Leave a node that is already in place alone: re-appending it would
            // churn mutation records on every watch pass for no visible change.
            if (alreadyPlaced(element, target, op.position)) return false;
            const place = placeOf(element);
            placeNode(element, target, op.position, anchor);
            ctx.journal.push(() => restore(element, place));
        });
    },

    wrap(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            const place = placeOf(element);
            if (!place.parent) throw new SkinParseError("cannot wrap a node with no parent");
            const wrapper = buildElement(op.with, ctx.document);
            place.parent.insertBefore(wrapper, element);
            wrapper.appendChild(element);
            ctx.journal.push(() => {
                restore(element, place);
                wrapper.remove();
            });
        });
    },

    unwrap(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            const place = placeOf(element);
            if (!place.parent) throw new SkinParseError("cannot unwrap a node with no parent");
            const children = [...element.childNodes];
            for (const child of children) place.parent.insertBefore(child, element);
            element.remove();
            ctx.journal.push(() => {
                for (const child of children) element.appendChild(child);
                restore(element, place);
            });
        });
    },

    insert(op, ctx) {
        const target = queryOne(ctx.root, op.into);
        if (!target) return note(ctx, op, `nothing matches into \`${op.into}\``);
        const done = handledSet(ctx, op);
        if (done) {
            if (done.has(target)) return 0;
            done.add(target);
        }
        const nodes = contentNodes(op, ctx.document);
        insertNodes(nodes, target, op.position);
        ctx.journal.push(() => {
            for (const node of nodes) node.remove();
        });
        return 1;
    },

    replace(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            const place = placeOf(element);
            if (!place.parent) throw new SkinParseError("cannot replace a node with no parent");
            const nodes = contentNodes(op, ctx.document);
            for (const node of nodes) place.parent.insertBefore(node, element);
            element.remove();
            ctx.journal.push(() => {
                for (const node of nodes) node.remove();
                restore(element, place);
            });
        });
    },

    setAttr(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            const value = op.from ? expand(op.value, element, op.from) : op.value;
            if (value === null) return false; // `from` did not match; leave it alone
            if (isUnsafeAttr(op.attr, value)) {
                throw new SkinParseError(`\`${op.attr}\` may not be set to \`${value}\``);
            }
            if (element.getAttribute(op.attr) === value) return false;
            const previous = element.getAttribute(op.attr);
            element.setAttribute(op.attr, value);
            ctx.journal.push(() => setOrRemoveAttr(element, op.attr, previous));
        });
    },

    removeAttr(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            if (op.attr === "*") {
                // Restoring in the original order keeps the serialization identical.
                const previous = [...element.attributes].map((attr) => [attr.name, attr.value]);
                if (!previous.length) return false;
                for (const [name] of previous) element.removeAttribute(name);
                ctx.journal.push(() => {
                    for (const [name, value] of previous) element.setAttribute(name, value);
                });
                return true;
            }
            if (!element.hasAttribute(op.attr)) return false;
            const previous = element.getAttribute(op.attr);
            element.removeAttribute(op.attr);
            ctx.journal.push(() => element.setAttribute(op.attr, previous));
        });
    },

    addClass(op, ctx) {
        return editClasses(op, ctx, (list) => list.add(...op.class));
    },

    removeClass(op, ctx) {
        return editClasses(op, ctx, (list) => list.remove(...op.class));
    },

    toggleClass(op, ctx) {
        return editClasses(op, ctx, (list) => {
            for (const token of op.class) list.toggle(token);
        });
    },

    setText(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            if (isAlreadyText(element, op.text)) return false;
            const previous = [...element.childNodes];
            element.textContent = op.text;
            ctx.journal.push(() => {
                element.textContent = "";
                for (const node of previous) element.appendChild(node);
            });
        });
    },

    rewriteText(op, ctx) {
        const pattern = new RegExp(op.pattern, op.flags);
        return eachTarget(op, ctx, (element) => {
            if (OPAQUE_TEXT_TAGS.has(element.localName)) return false;
            let changed = 0;
            forEachTextNode(element, (node) => {
                const next = node.data.replace(pattern, op.with);
                if (next === node.data) return;
                const previous = node.data;
                node.data = next;
                ctx.journal.push(() => {
                    node.data = previous;
                });
                changed += 1;
            });
            return changed > 0;
        });
    },

    sort(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            const children = [...element.children];
            if (children.length < 2) return false;
            const entries = children.map((child, at) => ({ child, at, key: sortKey(child, op.by) }));
            entries.sort((a, b) => compareEntries(a, b, op));
            if (entries.every((entry, at) => entry.at === at)) return false;

            const original = [...element.childNodes];
            for (const entry of entries) element.appendChild(entry.child);
            ctx.journal.push(() => {
                for (const node of original) element.appendChild(node);
            });
        });
    },

    attrToVar(op, ctx) {
        return eachTarget(op, ctx, (element) => {
            if (!element.hasAttribute(op.attr)) return false;
            const previous = element.getAttribute("style");
            element.style.setProperty(op.var, element.getAttribute(op.attr));
            if (element.getAttribute("style") === previous) return false;
            ctx.journal.push(() => setOrRemoveAttr(element, "style", previous));
        });
    }
};

function editClasses(op, ctx, edit) {
    return eachTarget(op, ctx, (element) => {
        // The whole attribute is the undo unit: classList.remove() on an element
        // that had no class leaves `class=""` behind, which is not the page we
        // were handed.
        const previous = element.getAttribute("class");
        edit(element.classList);
        if (element.getAttribute("class") === previous) return false;
        ctx.journal.push(() => setOrRemoveAttr(element, "class", previous));
    });
}

/**
 * Run `fn` over the op's matches, skipping nodes a previous pass handled.
 * `fn` returning `false` means "nothing changed here".
 */
function eachTarget(op, ctx, fn) {
    const done = handledSet(ctx, op);
    let count = 0;
    for (const node of queryAll(ctx.root, op.select)) {
        if (done) {
            if (done.has(node)) continue;
            done.add(node);
        }
        if (fn(node) !== false) count += 1;
    }
    return count;
}

function handledSet(ctx, op) {
    const handled = ctx.context.handled;
    if (!handled || !DEDUPE_OPS.has(op.op)) return null;
    let set = handled.get(op.index);
    if (!set) {
        set = new WeakSet();
        handled.set(op.index, set);
    }
    return set;
}

function note(ctx, op, message) {
    if (typeof ctx.context.log === "function") ctx.context.log(`dom[${op.index}] (${op.op}): ${message}`);
    return 0;
}

function queryAll(root, selector) {
    try {
        return [...root.querySelectorAll(selector)];
    } catch {
        throw new SkinParseError(`\`${selector}\` is not a valid selector`);
    }
}

function queryOne(root, selector) {
    try {
        return root.querySelector(selector);
    } catch {
        throw new SkinParseError(`\`${selector}\` is not a valid selector`);
    }
}

function placeOf(node) {
    return { parent: node.parentNode, next: node.nextSibling };
}

function restore(node, place) {
    if (!place.parent) return;
    if (place.next && place.next.parentNode === place.parent) place.parent.insertBefore(node, place.next);
    else place.parent.appendChild(node);
}

function setOrRemoveAttr(element, name, value) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
}

function anchorFor(target, position) {
    if (position === "prepend") return target.firstChild;
    if (position === "after") return target.nextSibling;
    return null;
}

/** Insert in order: each node goes before the anchor captured up front. */
function insertNodes(nodes, target, position) {
    const anchor = anchorFor(target, position);
    for (const node of nodes) placeNode(node, target, position, anchor);
}

function placeNode(node, target, position, anchor) {
    if (position === "append") {
        target.appendChild(node);
        return;
    }
    if (position === "prepend") {
        insertBefore(target, node, anchor);
        return;
    }
    const parent = target.parentNode;
    if (!parent) throw new SkinParseError(`\`${position}\` needs the target to have a parent`);
    insertBefore(parent, node, position === "before" ? target : anchor);
}

function insertBefore(parent, node, reference) {
    parent.insertBefore(node, reference && reference.parentNode === parent ? reference : null);
}

function alreadyPlaced(element, target, position) {
    if (position === "append" || position === "prepend") return element.parentNode === target;
    return element.parentNode === target.parentNode;
}

function contentNodes(op, document) {
    if (op.element !== undefined) return [buildElement(op.element, document)];
    if (op.html !== undefined) return [...sanitizeFragment(op.html, document).childNodes];
    return [document.createTextNode(String(op.text))];
}

function isAlreadyText(element, text) {
    if (text === "") return element.childNodes.length === 0;
    return (
        element.childNodes.length === 1 &&
        element.firstChild.nodeType === TEXT_NODE &&
        element.firstChild.data === text
    );
}

function forEachTextNode(node, fn) {
    for (const child of [...node.childNodes]) {
        if (child.nodeType === TEXT_NODE) fn(child);
        else if (child.nodeType === ELEMENT_NODE && !OPAQUE_TEXT_TAGS.has(child.localName)) forEachTextNode(child, fn);
    }
}

function expand(template, element, from) {
    const source = from.attr ? (element.getAttribute(from.attr) ?? "") : element.textContent;
    const match = new RegExp(from.pattern, from.flags ?? "").exec(source);
    if (!match) return null;
    return template.replace(/\$([0-9])/g, (_, digit) => match[Number(digit)] ?? "");
}

function sortKey(child, by) {
    const node = by.selector ? (child.querySelector(by.selector) ?? child) : child;
    if (by.attr) return node.getAttribute(by.attr) ?? "";
    return node.textContent.trim().replace(/\s+/g, " ");
}

function compareEntries(a, b, op) {
    const sign = op.direction === "desc" ? -1 : 1;
    if (op.numeric) {
        const x = toNumber(a.key);
        const y = toNumber(b.key);
        // Rows with no number in them keep to the end whichever way we sort.
        if (Number.isNaN(x) || Number.isNaN(y)) {
            if (Number.isNaN(x) && Number.isNaN(y)) return a.at - b.at;
            return Number.isNaN(x) ? 1 : -1;
        }
        return x === y ? a.at - b.at : (x < y ? -sign : sign);
    }
    const order = a.key.localeCompare(b.key);
    return order === 0 ? a.at - b.at : order * sign;
}

function toNumber(key) {
    return Number.parseFloat(String(key).replace(/[^\d.eE+-]/g, ""));
}

/* ------------------------------------------------------------------ *
 * The runner
 * ------------------------------------------------------------------ */

/**
 * Apply ops and keep applying them as the DOM changes.
 *
 * One MutationObserver for the whole runner, one pass per frame, and every pass
 * ends by draining the records its own writes queued — see `runPass`.
 *
 * @param {unknown} ops
 * @param {Parameters<typeof applyOps>[1] & {schedule?: (fn: () => void) => void}} context
 * @returns {{start: () => void, stop: () => void, undo: () => void, applied: number}}
 */
export function createRunner(ops, context) {
    if (!context || !context.document) throw new TypeError("createRunner needs context.document");

    const { document } = context;
    const root = context.root ?? document;
    const schedule = typeof context.schedule === "function" ? context.schedule : defaultSchedule(document);
    const handled = context.handled ?? new Map();
    const seen = context.seen ?? new Set();
    const { ops: normalized, errors } = validateOps(ops, document);
    const watching = normalized.some((op) => op.watch);
    const undos = [];

    let observer = null;
    let running = false;
    let pending = false;
    let applied = 0;

    function log(message) {
        if (typeof context.log === "function") context.log(message);
    }

    function runPass() {
        pending = false;
        if (!running) return;
        const result = applyOps(normalized, { ...context, root, handled, seen });
        applied += result.applied;
        if (result.applied > 0) undos.push(result.undo);
        for (const error of result.errors) log(`${error.field}: ${error.message}`);

        // The records our own writes just queued describe a DOM this pass has
        // already read, so replaying them would only schedule the pass again —
        // which is how a `move` op ends up rescheduling itself forever. Draining
        // them synchronously, before control leaves this function, is the only
        // point at which they can be told apart from the page's own mutations.
        if (observer) observer.takeRecords();
    }

    function schedulePass() {
        if (pending || !running) return;
        pending = true;
        schedule(runPass);
    }

    function start() {
        if (running) return;
        running = true;
        for (const error of errors) log(`${error.field}: ${error.message}`);
        runPass();
        if (!watching || observer) return;

        const view = document.defaultView;
        if (!view || typeof view.MutationObserver !== "function") return; // ops still ran once
        observer = new view.MutationObserver(schedulePass);
        // characterData stays off: a rewriteText whose replacement still matches
        // its own pattern would otherwise feed itself.
        observer.observe(root, { childList: true, subtree: true, attributes: true });
    }

    function stop() {
        running = false;
        pending = false;
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    function undo() {
        stop(); // undoing while still observing would re-apply on the next frame
        for (let i = undos.length - 1; i >= 0; i -= 1) undos[i]();
        undos.length = 0;
        handled.clear();
        applied = 0;
    }

    return {
        start,
        stop,
        undo,
        get applied() {
            return applied;
        }
    };
}

function defaultSchedule(document) {
    const view = document.defaultView;
    if (view && typeof view.requestAnimationFrame === "function") return (fn) => view.requestAnimationFrame(fn);
    return (fn) => setTimeout(fn, 0);
}
