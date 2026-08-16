/**
 * Every screen, as a pure function from data to a DOM node.
 *
 * No `chrome.*`, no fetching, no module-level state, and a `document` passed
 * in rather than reached for. That is not purism: it is the only way any of
 * this gets verified before it reaches a phone. The page shells (popup.js,
 * manager.js) own the messaging and the state; this file owns what a screen
 * looks like and what an interaction means.
 *
 * Interactions report in two ways. The callbacks in each signature are the
 * ones the caller must handle. Everything else — searching, switching tab,
 * exporting, clearing the log — is dispatched as a bubbling `oriel:*` event
 * from the returned node (see {@link UI_EVENT}), because those interactions
 * are navigation, and threading a callback for each one through eight
 * signatures would buy nothing.
 *
 * Three fields on the detail view's `installed` object are not in
 * InstalledSkin: `text` (the raw source to edit), `errors` (the last failed
 * save) and `log` (this skin's log tail). The protocol has no way to fetch the
 * first two; manager.js assembles them. See the report in the PR.
 *
 * @module ui/views
 */

import { bind, append, switchControl, safeUrl, emit, icon, UI_EVENT } from "./dom.js";
import { buildVarsForm } from "./varsform.js";

const LEVELS = { info: "is-info", warn: "is-warn", error: "is-error" };

/**
 * Long enough that typing `owner/repo` does not fire four lookups, short
 * enough that the answer is on screen before a thumb reaches the button.
 */
export const PREVIEW_DEBOUNCE_MS = 400;

function plural(count, word, many) {
    return `${count} ${count === 1 ? word : many || `${word}s`}`;
}

function byOrder(a, b) {
    return (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name));
}

/** The hostname, or the raw string when it is not a URL (`about:blank`, a file path). */
function hostOf(url) {
    try {
        return new URL(url).hostname || url;
    } catch {
        return url || "";
    }
}

function matchesFilter(summary, filter) {
    const needle = String(filter || "").trim().toLowerCase();
    if (!needle) return true;
    return [summary.name, summary.id, summary.author, summary.description, summary.targets]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
}

function formatTime(at) {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * "CSS on 2 sites · 6 DOM operations · 1 script (isolated)".
 *
 * A user deciding whether to trust a skin should not have to read its source,
 * and "it changes the page" is not an answer.
 */
function describeSkin(skin) {
    const parts = [];
    const sites = skin.targets && Array.isArray(skin.targets.include) ? skin.targets.include.length : 0;
    if ((skin.css || []).length) {
        parts.push(sites ? `CSS on ${plural(sites, "site")}` : "CSS");
    }
    if ((skin.dom || []).length) parts.push(plural(skin.dom.length, "DOM operation"));
    if ((skin.js || []).length) {
        const worlds = [...new Set(skin.js.map((unit) => unit.world || "isolated"))];
        parts.push(`${plural(skin.js.length, "script")} (${worlds.join(", ")})`);
    }
    return parts.length ? parts.join(" · ") : "Nothing yet — this skin is empty.";
}

function warningDot(h, warnings) {
    if (!warnings || !warnings.length) return null;
    return h("span.o-dot", {
        title: plural(warnings.length, "warning"),
        "aria-label": plural(warnings.length, "warning"),
        role: "img"
    });
}

function warningList(h, doc, warnings) {
    if (!warnings || !warnings.length) return null;
    return h(
        "ul.o-warnings",
        { "aria-label": "Warnings" },
        warnings.map((warning) =>
            h("li.o-warning", {}, [icon(doc, "warning", { size: 16 }), h("span", { text: warning })])
        )
    );
}

/**
 * One skin, as a row. Shared by the manager list and the popup, because they
 * are the same thing at two densities and drifting them apart would show.
 */
function skinRow(h, doc, summary, options) {
    const { onToggle, onOpen, onReorder, ids, index, compact } = options;
    const row = h("li.o-row", {
        class: summary.enabled ? "is-on" : "is-off",
        data: { id: summary.id }
    });

    const open = h("button.o-row-main", { type: "button" }, [
        h("span.o-row-title", {}, [
            h("span.o-row-name", { text: summary.name }),
            warningDot(h, summary.warnings)
        ]),
        h("span.o-row-meta", {
            text: [summary.version && `v${summary.version}`, summary.targets].filter(Boolean).join(" · ")
        })
    ]);
    if (typeof onOpen === "function") {
        open.addEventListener("click", () => onOpen(summary.id, summary));
    } else {
        open.disabled = true;
    }

    const tools = h("div.o-row-tools");
    if (!compact && typeof onReorder === "function" && ids) {
        tools.append(
            moveButton(h, "up", index > 0, () => onReorder(moved(ids, index, index - 1), summary.id)),
            moveButton(h, "down", index < ids.length - 1, () => onReorder(moved(ids, index, index + 1), summary.id))
        );
    }
    tools.appendChild(
        switchControl(doc, {
            checked: summary.enabled,
            label: `${summary.name} on this browser`,
            onChange: (checked) => onToggle && onToggle(summary.id, checked)
        })
    );

    row.append(open, tools);

    // Dragging a list on a phone, inside a page that also scrolls, is
    // miserable; the buttons above are the real mechanism and this is the
    // desktop nicety layered on top.
    if (!compact && typeof onReorder === "function" && ids) {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => {
            row.classList.add("is-dragging");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", summary.id);
            }
        });
        row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
        row.addEventListener("dragover", (event) => event.preventDefault());
        row.addEventListener("drop", (event) => {
            event.preventDefault();
            const dragged = event.dataTransfer && event.dataTransfer.getData("text/plain");
            const from = ids.indexOf(dragged);
            if (from === -1 || from === index) return;
            onReorder(moved(ids, from, index), dragged);
        });
    }

    return row;
}

function moveButton(h, direction, enabled, onClick) {
    const button = h("button.o-icon", {
        type: "button",
        disabled: !enabled,
        "aria-label": direction === "up" ? "Move up" : "Move down",
        data: { move: direction }
    });
    button.appendChild(icon(button.ownerDocument, direction, { size: 18 }));
    if (enabled) button.addEventListener("click", onClick);
    return button;
}

function moved(ids, from, to) {
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

/**
 * A parse error, with the line it happened on and the two lines around it.
 * The whole source is already in the textarea below; repeating it here would
 * fill a phone screen, so this shows only the neighbourhood.
 */
function errorReport(h, errors, source, onGoToLine) {
    if (!errors || !errors.length) return null;
    const lines = String(source || "").split("\n");
    const list = h("ul.o-errors", { "aria-label": "Errors" });

    for (const error of errors) {
        const item = h("li.o-error");
        const head = h("span.o-error-head");
        if (error.line) head.appendChild(h("span.o-error-line", { text: `Line ${error.line}` }));
        if (error.field) head.appendChild(h("span.o-error-field", { text: error.field }));
        head.appendChild(h("span.o-error-message", { text: error.message }));
        item.appendChild(head);

        if (error.line && lines.length) {
            const first = Math.max(1, error.line - 1);
            const last = Math.min(lines.length, error.line + 1);
            const context = h("ol.o-lines", { start: first });
            for (let n = first; n <= last; n += 1) {
                const line = h("li.o-line", {
                    class: n === error.line ? "is-error" : "",
                    data: { line: n },
                    text: lines[n - 1] ?? ""
                });
                if (n === error.line && typeof onGoToLine === "function") {
                    line.addEventListener("click", () => onGoToLine(n));
                }
                context.appendChild(line);
            }
            item.appendChild(context);
        }
        list.appendChild(item);
    }
    return list;
}

function logList(h, entries, skinsById, { limit } = {}) {
    const sorted = [...(entries || [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const shown = limit ? sorted.slice(0, limit) : sorted;
    return h(
        "ul.o-log",
        {},
        shown.map((entry) => {
            const name = skinsById && skinsById.get(entry.skinId);
            return h("li.o-log-entry", { class: LEVELS[entry.level] || LEVELS.info, data: { level: entry.level } }, [
                h("span.o-log-time", { text: formatTime(entry.at) }),
                h("span.o-log-skin", { text: name || entry.skinId || "" }),
                h("span.o-log-message", { text: entry.message })
            ]);
        })
    );
}

/**
 * @param {{skins: import("../shared/protocol.js").SkinSummary[], filter?: string, onToggle?: Function, onOpen?: Function, onReorder?: Function}} props
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function renderSkinList({ skins = [], filter = "", onToggle, onOpen, onReorder }, document) {
    const h = bind(document);
    const view = h("section.o-view", { data: { view: "skins" } });

    const search = h("input.o-input.o-search", {
        type: "search",
        value: filter,
        placeholder: "Search skins",
        "aria-label": "Search skins",
        data: { focusKey: "skin-search" }
    });
    search.addEventListener("input", () => emit(view, UI_EVENT.FILTER, { value: search.value }));
    view.appendChild(h("div.o-searchbar", {}, [icon(document, "search", { size: 18 }), search]));

    if (!skins.length) {
        view.appendChild(
            renderEmpty(
                {
                    title: "No skins yet",
                    body: "Paste a skin's source, or give Oriel a GitHub link, and it will start working on the next page you load.",
                    action: { label: "Add a skin", onClick: () => emit(view, UI_EVENT.NAVIGATE, { tab: "add" }) }
                },
                document
            )
        );
        return view;
    }

    const ordered = [...skins].sort(byOrder);
    const ids = ordered.map((summary) => summary.id);
    const visible = ordered.filter((summary) => matchesFilter(summary, filter));

    if (!visible.length) {
        view.appendChild(
            renderEmpty(
                {
                    title: "Nothing matches",
                    body: `No installed skin matches “${filter}”.`,
                    action: { label: "Clear search", onClick: () => emit(view, UI_EVENT.FILTER, { value: "" }) }
                },
                document
            )
        );
        return view;
    }

    view.appendChild(
        h(
            "ul.o-rows",
            {},
            visible.map((summary) =>
                skinRow(h, document, summary, { onToggle, onOpen, onReorder, ids, index: ids.indexOf(summary.id) })
            )
        )
    );
    return view;
}

/**
 * @param {{installed: import("../core/types.js").InstalledSkin, caps: object, onSave?: Function, onValues?: Function, onRemove?: Function, onUpdate?: Function}} props
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function renderSkinDetail({ installed, caps = {}, onSave, onValues, onRemove, onUpdate }, document) {
    const h = bind(document);
    if (!installed || !installed.skin) {
        return renderEmpty({ title: "Skin not found", body: "It may have been removed on another device." }, document);
    }

    const skin = installed.skin;
    const view = h("section.o-view.o-detail", { data: { view: "detail", id: skin.id } });

    const back = h("button.o-back", { type: "button", text: "All skins" });
    back.addEventListener("click", () => emit(view, UI_EVENT.NAVIGATE, { tab: "skins" }));
    view.appendChild(back);

    const head = h("header.o-detail-head", {}, [
        h("h1.o-title", { text: skin.name }),
        h("p.o-sub", {
            text: [skin.version && `v${skin.version}`, skin.author && `by ${skin.author}`].filter(Boolean).join(" · ")
        })
    ]);
    if (skin.description) head.appendChild(h("p.o-desc", { text: skin.description }));

    const homepage = safeUrl(skin.homepageURL);
    if (homepage) {
        const link = h("a.o-link", {
            href: homepage,
            target: "_blank",
            rel: "noreferrer noopener",
            text: hostOf(homepage)
        });
        link.appendChild(icon(document, "external", { size: 14 }));
        head.appendChild(link);
    } else if (skin.homepageURL) {
        // Shown, not linked: the scheme is not one an extension page will follow.
        head.appendChild(h("p.o-quiet", { text: skin.homepageURL }));
    }

    head.appendChild(h("p.o-what", { text: describeSkin(skin) }));
    const warnings = warningList(h, document, skin.warnings);
    if (warnings) head.appendChild(warnings);
    if ((skin.js || []).length && caps.js === "none") {
        head.appendChild(
            h("p.o-note", {
                text: "JavaScript in skins is not available in this browser — this skin's CSS and layout changes still work."
            })
        );
    }
    view.appendChild(head);

    view.appendChild(detailActions(h, { skin, onUpdate, onRemove, view }));

    const settings = h("section.o-card", {}, [h("h2.o-card-title", { text: "Settings" })]);
    settings.appendChild(
        buildVarsForm(
            {
                vars: skin.vars || [],
                values: installed.values || {},
                onChange: (key, value) => {
                    if (typeof onValues !== "function") return;
                    onValues({ ...(installed.values || {}), [key]: value }, key, value);
                }
            },
            document
        )
    );
    view.appendChild(settings);

    view.appendChild(sourceCard(h, { installed, onSave }));

    if (installed.log && installed.log.length) {
        view.appendChild(
            h("section.o-card", {}, [
                h("h2.o-card-title", { text: "Recent activity" }),
                logList(h, installed.log, new Map([[skin.id, skin.name]]), { limit: 10 })
            ])
        );
    }

    return view;
}

function detailActions(h, { skin, onUpdate, onRemove, view }) {
    const bar = h("div.o-toolbar");

    const update = h("button.o-button", {
        type: "button",
        text: "Check for update",
        disabled: !skin.updateURL,
        title: skin.updateURL ? undefined : "This skin has no update URL"
    });
    if (skin.updateURL && typeof onUpdate === "function") {
        update.addEventListener("click", () => onUpdate(skin.id));
    }

    const exportButton = h("button.o-button", { type: "button", text: "Export" });
    exportButton.addEventListener("click", () => emit(view, UI_EVENT.EXPORT, { id: skin.id }));

    // Two taps, because this is the one irreversible control on a screen a
    // thumb scrolls past.
    const remove = h("button.o-button.o-danger", { type: "button", text: "Remove", data: { armed: "no" } });
    remove.addEventListener("click", () => {
        if (remove.dataset.armed === "no") {
            remove.dataset.armed = "yes";
            remove.textContent = "Tap again to remove";
            return;
        }
        if (typeof onRemove === "function") onRemove(skin.id);
    });

    bar.append(update, exportButton, remove);
    return bar;
}

function sourceCard(h, { installed, onSave }) {
    const skin = installed.skin;
    const source = sourceOf(installed);
    const card = h("section.o-card", {}, [h("h2.o-card-title", { text: "Source" })]);

    const editor = h("textarea.o-source", {
        spellcheck: false,
        rows: 14,
        "aria-label": `Source of ${skin.name}`,
        data: { focusKey: `source-${skin.id}` }
    });
    editor.value = source;

    const errors = errorReport(h, installed.errors, source, (line) => selectLine(editor, line));
    if (errors) card.appendChild(errors);
    card.appendChild(editor);

    const save = h("button.o-button.o-primary", { type: "button", text: "Save and re-parse" });
    save.addEventListener("click", () => {
        if (typeof onSave === "function") onSave(editor.value, skin.id);
    });
    card.appendChild(h("div.o-card-foot", {}, [save]));
    return card;
}

/**
 * The raw source is not part of InstalledSkin, so the shell attaches it as
 * `text`. Falling back to the stylesheets keeps the editor useful rather than
 * blank when it is missing.
 */
function sourceOf(installed) {
    if (typeof installed.text === "string") return installed.text;
    const skin = installed.skin || {};
    if (skin.source && typeof skin.source.text === "string") return skin.source.text;
    return (skin.css || []).map((sheet) => sheet.text).join("\n\n");
}

function selectLine(textarea, line) {
    const lines = textarea.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
    textarea.focus();
    if (typeof textarea.setSelectionRange === "function") {
        textarea.setSelectionRange(start, start + (lines[line - 1] || "").length);
    }
}

/**
 * @param {{state: object, onPasteSubmit?: Function, onUrlSubmit?: Function, onPreview?: Function}} props
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function renderImport({ state = {}, onPasteSubmit, onUrlSubmit, onPreview }, document) {
    const h = bind(document);
    const view = h("section.o-view", { data: { view: "add" } });
    const panes = h("div.o-panes");

    panes.appendChild(pastePane(h, state, onPasteSubmit, view));
    panes.appendChild(linkPane(h, state, onUrlSubmit, onPreview, view));
    view.appendChild(panes);

    const result = importResult(h, document, state);
    if (result) view.appendChild(result);
    return view;
}

function pastePane(h, state, onPasteSubmit, view) {
    const pane = h("form.o-pane", { data: { pane: "paste" } });
    const area = h("textarea.o-source", {
        spellcheck: false,
        rows: 10,
        placeholder: "/* ==UserStyle== ... */  or  { \"format\": 1, ... }",
        "aria-label": "Skin source",
        data: { focusKey: "import-text" }
    });
    // Never cleared here: a failed install with a page of pasted CSS in it is
    // the worst possible moment to throw the user's paste away.
    area.value = state.text || "";
    area.addEventListener("input", () => emit(view, UI_EVENT.IMPORT_STATE, { text: area.value }));

    const submit = h("button.o-button.o-primary", { type: "submit", text: "Install", disabled: Boolean(state.busy) });
    pane.addEventListener("submit", (event) => {
        event.preventDefault();
        if (typeof onPasteSubmit === "function") onPasteSubmit(area.value);
    });

    pane.append(
        h("h2.o-pane-title", { text: "Paste" }),
        h("p.o-quiet", { text: "A .user.css style, a skin.json bundle, or plain CSS." }),
        area,
        h("div.o-pane-foot", {}, [submit])
    );
    return pane;
}

function linkPane(h, state, onUrlSubmit, onPreview, view) {
    const pane = h("form.o-pane", { data: { pane: "link" } });
    const input = h("input.o-input", {
        type: "text",
        value: state.locator || "",
        placeholder: "owner/repo  or  https://github.com/…",
        spellcheck: false,
        "aria-label": "GitHub link or owner/repo",
        data: { focusKey: "import-url" }
    });

    // Debounced, so a wrong link is refused while it is still being typed
    // instead of after a round trip that costs a second on a phone network.
    let timer = null;
    input.addEventListener("input", () => {
        emit(view, UI_EVENT.IMPORT_STATE, { locator: input.value });
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            if (typeof onPreview === "function") onPreview(input.value);
        }, PREVIEW_DEBOUNCE_MS);
    });

    pane.addEventListener("submit", (event) => {
        event.preventDefault();
        if (timer) clearTimeout(timer);
        if (typeof onUrlSubmit === "function") onUrlSubmit(input.value);
    });

    const submit = h("button.o-button.o-primary", {
        type: "submit",
        text: "Fetch and install",
        disabled: Boolean(state.busy)
    });
    return append(pane, [
        h("h2.o-pane-title", { text: "From a link" }),
        h("p.o-quiet", { text: "A GitHub repository, a file in one, or a raw URL." }),
        input,
        previewBlock(h, state.preview),
        h("div.o-pane-foot", {}, [submit])
    ]);
}

function previewBlock(h, preview) {
    if (!preview) return null;
    const block = h("div.o-preview", { class: preview.ok ? "is-ok" : "is-bad" });
    block.appendChild(h("p.o-preview-describe", { text: preview.describe || (preview.ok ? "Ready" : "Not a skin link") }));
    const candidates = preview.candidates || [];
    if (candidates.length) {
        block.appendChild(
            h(
                "ul.o-candidates",
                {},
                candidates.map((candidate) =>
                    h("li", { text: typeof candidate === "string" ? candidate : candidate.url || candidate.path || "" })
                )
            )
        );
    }
    return block;
}

function importResult(h, doc, state) {
    const reply = state.result;
    if (!reply) return null;
    const block = h("div.o-result", { class: reply.ok ? "is-ok" : "is-bad", role: "status" });

    if (reply.ok && reply.summary) {
        block.appendChild(h("p.o-result-head", { text: `Installed ${reply.summary.name} v${reply.summary.version}` }));
        block.appendChild(h("p.o-quiet", { text: reply.summary.targets || "" }));
    } else if (!reply.ok) {
        block.appendChild(h("p.o-result-head", { text: "Could not install this skin." }));
    }

    if (reply.tried) block.appendChild(h("p.o-quiet", { text: `Fetched ${reply.tried}` }));

    const errors = errorReport(h, reply.errors, state.text, null);
    if (errors) block.appendChild(errors);

    const warnings = warningList(h, doc, reply.warnings);
    if (warnings) block.appendChild(warnings);

    return block;
}

/**
 * @param {{url: string, matches: object[], others: object[], caps: object, settings: object, onToggle?: Function, onOpenManager?: Function}} props
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function renderPopup({ url = "", matches = [], others = [], caps = {}, settings = {}, onToggle, onOpenManager }, document) {
    const h = bind(document);
    const view = h("div.o-popup", { data: { view: "popup" } });
    const host = hostOf(url);

    view.appendChild(
        h("header.o-popup-head", {}, [
            h("h1.o-host", { text: host || "This page" }),
            h("p.o-quiet", {
                text: matches.length
                    ? `${plural(matches.length, "skin")} applying here`
                    : "No skin applies here"
            })
        ])
    );

    if (settings.enabled === false) {
        const banner = h("div.o-banner", { role: "status" }, [
            h("span", { text: "All skins are switched off." })
        ]);
        const open = h("button.o-linkbutton", { type: "button", text: "Settings" });
        open.addEventListener("click", () => onOpenManager && onOpenManager({ tab: "settings" }));
        banner.appendChild(open);
        view.appendChild(banner);
    }

    if (matches.length) {
        view.appendChild(
            h(
                "ul.o-rows",
                {},
                matches.map((summary) =>
                    skinRow(h, document, summary, {
                        onToggle,
                        onOpen: onOpenManager ? (id) => onOpenManager({ tab: "skins", id }) : undefined,
                        compact: true
                    })
                )
            )
        );
    } else {
        view.appendChild(
            h("p.o-empty-line", {
                text: `Nothing is changing ${host || "this page"}. You can add a skin for it, or search the ones you have.`
            })
        );
    }

    if (others.length) {
        const details = h("details.o-others");
        details.appendChild(h("summary", { text: `${plural(others.length, "other skin")} installed` }));
        details.appendChild(
            h(
                "ul.o-rows.is-quiet",
                {},
                [...others].sort(byOrder).map((summary) =>
                    skinRow(h, document, summary, {
                        onToggle,
                        onOpen: onOpenManager ? (id) => onOpenManager({ tab: "skins", id }) : undefined,
                        compact: true
                    })
                )
            )
        );
        view.appendChild(details);
    }

    const add = h("button.o-button", { type: "button", text: "Add a skin for this site" });
    add.addEventListener("click", () => onOpenManager && onOpenManager({ tab: "add", url, host }));
    const manage = h("button.o-button.o-primary", { type: "button", text: "Open manager" });
    manage.addEventListener("click", () => onOpenManager && onOpenManager({ tab: "skins" }));
    view.appendChild(h("div.o-popup-actions", {}, [add, manage]));

    if (caps.js === "none") {
        view.appendChild(
            h("p.o-note", {
                text: "JavaScript in skins is not available in this browser — CSS and layout changes still work."
            })
        );
    }

    return view;
}

/**
 * @param {{entries: object[], skins?: object[], filter?: string}} props
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function renderLog({ entries = [], skins = [], filter = "" }, document) {
    const h = bind(document);
    const view = h("section.o-view", { data: { view: "log" } });
    const byId = new Map(skins.map((summary) => [summary.id, summary.name]));

    const select = h("select.o-select", { "aria-label": "Filter by skin", data: { focusKey: "log-filter" } });
    select.appendChild(h("option", { value: "", text: "All skins" }));
    for (const summary of skins) select.appendChild(h("option", { value: summary.id, text: summary.name }));
    select.value = filter || "";
    select.addEventListener("change", () => emit(view, UI_EVENT.LOG_FILTER, { skinId: select.value }));

    const clear = h("button.o-button", { type: "button", text: "Clear" });
    clear.addEventListener("click", () => emit(view, UI_EVENT.LOG_CLEAR, { skinId: filter || "" }));
    view.appendChild(h("div.o-logbar", {}, [select, clear]));

    const shown = filter ? entries.filter((entry) => entry.skinId === filter) : entries;
    if (!shown.length) {
        view.appendChild(
            renderEmpty(
                {
                    title: "Nothing logged",
                    body: "Skins report parse problems, failed DOM operations and their own messages here."
                },
                document
            )
        );
        return view;
    }

    view.appendChild(logList(h, shown, byId));
    return view;
}

/** One line per capability: what this browser allows, and what it means for skins. */
function capLines(caps) {
    const js = {
        userScripts: "Skins can run JavaScript, in a world of their own.",
        function: "Skins can run JavaScript, in the extension's isolated world.",
        none: "Skins cannot run JavaScript here. CSS and DOM changes still work."
    };
    return [
        { key: "js", label: "JavaScript in skins", ok: caps.js !== "none", note: js[caps.js] || js.none },
        {
            key: "mainWorld",
            label: "Page's own scripts",
            ok: Boolean(caps.mainWorld),
            note: caps.mainWorld
                ? "A skin can patch the site's own code."
                : "Skins asking for the main world run isolated instead."
        },
        {
            key: "insertCss",
            label: "CSS injection",
            ok: Boolean(caps.insertCss),
            note: caps.insertCss
                ? "Styles land before the page paints."
                : "Styles are applied by the content script, so a page may flash unstyled."
        },
        {
            key: "webNavigation",
            label: "Early start",
            ok: Boolean(caps.webNavigation),
            note: caps.webNavigation
                ? "Oriel knows a page is coming before it loads."
                : "Oriel first hears about a page when it starts running."
        },
        {
            key: "registerContentScripts",
            label: "Persistent registration",
            ok: Boolean(caps.registerContentScripts),
            note: caps.registerContentScripts
                ? "Skins survive a browser restart without waking the background."
                : "The background has to be awake to apply a skin."
        }
    ];
}

/**
 * @param {{caps: object}} props
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function renderCaps({ caps = {} }, document) {
    const h = bind(document);
    const panel = h("section.o-card.o-caps", { data: { view: "caps" } });
    panel.appendChild(h("h2.o-card-title", { text: "What this browser allows" }));

    panel.appendChild(
        h(
            "ul.o-caplist",
            {},
            capLines(caps).map((line) =>
                h("li.o-cap", { class: line.ok ? "is-ok" : "is-off", data: { cap: line.key } }, [
                    h("span.o-cap-label", { text: line.label }),
                    h("span.o-cap-note", { text: line.note })
                ])
            )
        )
    );

    if (caps.userScriptsApi && !caps.userScriptsPermitted) {
        const ask = h("button.o-button", { type: "button", text: "Allow user scripts" });
        ask.addEventListener("click", () => emit(panel, UI_EVENT.REQUEST_USER_SCRIPTS, {}));
        panel.appendChild(
            h("div.o-card-foot", {}, [
                h("p.o-quiet", { text: "This browser has the userScripts API but has not granted it." }),
                ask
            ])
        );
    }

    if (caps.engine) panel.appendChild(h("p.o-quiet", { text: `Engine: ${caps.engine}` }));
    return panel;
}

/**
 * @param {{settings: object, onChange?: (key: string, value: any) => void}} props
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function renderSettings({ settings = {}, onChange }, document) {
    const h = bind(document);
    const view = h("section.o-view", { data: { view: "settings" } });
    const change = (key, value) => onChange && onChange(key, value);

    const card = h("section.o-card", {}, [h("h2.o-card-title", { text: "Settings" })]);

    card.appendChild(
        settingRow(h, {
            key: "enabled",
            label: "Skins on",
            note: "The master switch. Off means no skin applies anywhere.",
            control: switchControl(document, {
                checked: settings.enabled !== false,
                label: "Skins on",
                onChange: (checked) => change("enabled", checked)
            })
        })
    );

    card.appendChild(
        settingRow(h, {
            key: "allowFrames",
            label: "Apply in frames",
            note: "Off by default: most frames on a page are ads and trackers.",
            control: switchControl(document, {
                checked: Boolean(settings.allowFrames),
                label: "Apply in frames",
                onChange: (checked) => change("allowFrames", checked)
            })
        })
    );

    const frequency = h("select.o-select", { "aria-label": "Check for updates" });
    for (const [value, label] of [["never", "Never"], ["daily", "Daily"], ["weekly", "Weekly"]]) {
        frequency.appendChild(h("option", { value, text: label }));
    }
    frequency.value = settings.updateCheck || "weekly";
    frequency.addEventListener("change", () => change("updateCheck", frequency.value));
    card.appendChild(
        settingRow(h, {
            key: "updateCheck",
            label: "Check for updates",
            note: "An update is offered, never installed for you.",
            control: frequency
        })
    );

    const devServer = h("input.o-input", {
        type: "text",
        value: settings.devServer || "",
        placeholder: "http://localhost:8787",
        spellcheck: false,
        "aria-label": "Dev server URL"
    });
    devServer.addEventListener("input", () => change("devServer", devServer.value));
    card.appendChild(
        settingRow(h, {
            key: "devServer",
            label: "Dev server",
            note: "Reload a skin from a local authoring server as you edit it.",
            control: devServer
        })
    );

    view.appendChild(card);
    return view;
}

function settingRow(h, { key, label, note, control }) {
    return h("div.o-setting", { data: { setting: key } }, [
        h("div.o-setting-text", {}, [
            h("span.o-setting-label", { text: label }),
            note && h("span.o-setting-note", { text: note })
        ]),
        h("div.o-setting-control", {}, [control])
    ]);
}

/**
 * @param {{title: string, body?: string, action?: {label: string, onClick: Function}}} props
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function renderEmpty({ title, body, action }, document) {
    const h = bind(document);
    const view = h("div.o-empty", { data: { view: "empty" } });
    view.appendChild(icon(document, "skin", { size: 28 }));
    view.appendChild(h("h2.o-empty-title", { text: title || "" }));
    if (body) view.appendChild(h("p.o-empty-body", { text: body }));
    if (action && action.label) {
        const button = h("button.o-button.o-primary", { type: "button", text: action.label });
        if (typeof action.onClick === "function") button.addEventListener("click", action.onClick);
        view.appendChild(button);
    }
    return view;
}
