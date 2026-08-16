/**
 * The views are pure functions of data, so this is the whole UI under test:
 * structure, empty states, callbacks, and the one rule that must never break —
 * a skin's own strings are text, never markup.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import {
    renderSkinList,
    renderSkinDetail,
    renderImport,
    renderPopup,
    renderLog,
    renderCaps,
    renderSettings,
    renderEmpty,
    PREVIEW_DEBOUNCE_MS
} from "../extension/src/ui/views.js";

/* ------------------------------------------------------------------ setup */

function makeDocument() {
    return new JSDOM("<!doctype html><html><body></body></html>").window.document;
}

function mount(node, document) {
    document.body.appendChild(node);
    return node;
}

function fire(element, type, init = {}) {
    const view = element.ownerDocument.defaultView;
    element.dispatchEvent(new view.Event(type, { bubbles: true, cancelable: true, ...init }));
}

function byText(root, selector, label) {
    return [...root.querySelectorAll(selector)].find((node) => node.textContent.trim() === label);
}

function textOf(root, selector) {
    const node = root.querySelector(selector);
    return node ? node.textContent.trim() : null;
}

/* --------------------------------------------------------------- fixtures */

const hn = {
    id: "hn-rebuilt",
    name: "Hacker News, rebuilt",
    version: "1.4.0",
    author: "you",
    description: "Card layout, real typography, no table soup.",
    enabled: true,
    order: 0,
    targets: "news.ycombinator.com",
    cssBytes: 4820,
    hasJs: true,
    hasDom: true,
    varCount: 4,
    updateURL: "https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css",
    homepageURL: "https://github.com/you/hn-rebuilt",
    source: {
        kind: "url",
        url: "https://github.com/you/hn-rebuilt/blob/main/hn.user.css",
        resolved: "https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css",
        fetchedAt: 1755302400000,
        digest: "sha256-2f0a"
    },
    warnings: []
};

const gh = {
    id: "gh-quieter",
    name: "GitHub, quieter",
    version: "0.9.1",
    author: "someone",
    enabled: false,
    order: 1,
    targets: "github.com and 1 more",
    cssBytes: 1200,
    hasJs: false,
    hasDom: true,
    varCount: 1,
    homepageURL: "https://github.com/someone/gh-quieter",
    source: { kind: "paste" },
    warnings: [
        "@preprocessor less is not supported; variables are handled as default.",
        "1 target rule could not be compiled and was dropped."
    ]
};

const HN_SOURCE = [
    "/* ==UserStyle==",
    "@name           Hacker News, rebuilt",
    "@version        1.4.0",
    "@var color accent \"Accent\" #ff6600",
    "==/UserStyle== */",
    "",
    "@-moz-document domain(\"news.ycombinator.com\") {",
    "  :root { --accent: /*[[accent]]*/; }",
    "  .athing { display: grid; }",
    "  table[border=\"0\"] { all: unset; }",
    "  .subtext { font-size: 12px; }",
    "  .broken { color: ; }",
    "}"
].join("\n");

const installedHn = {
    enabled: true,
    order: 0,
    installedAt: 1755302400000,
    updatedAt: 1755302400000,
    values: { accent: "#ff6600", density: 8 },
    text: HN_SOURCE,
    skin: {
        format: 1,
        id: "hn-rebuilt",
        name: "Hacker News, rebuilt",
        version: "1.4.0",
        author: "you",
        description: "Card layout, real typography, no table soup.",
        homepageURL: "https://github.com/you/hn-rebuilt",
        updateURL: "https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css",
        targets: {
            include: [
                { kind: "domain", value: "news.ycombinator.com" },
                { kind: "match", value: "*://hn.algolia.com/*" }
            ],
            exclude: []
        },
        css: [
            { id: "s1", text: ".athing { display: grid; }" },
            { id: "s2", text: ".subtext { font-size: 12px; }" }
        ],
        dom: [
            { op: "remove", select: ".ad" },
            { op: "move", select: ".subtext", into: ".athing" },
            { op: "wrap", select: ".titleline", with: { tag: "h2" } },
            { op: "setText", select: ".rank", text: "" },
            { op: "sort", select: "#hnmain", by: { attr: "data-score" } },
            { op: "addClass", select: "body", class: "o-hn" }
        ],
        js: [{ id: "j1", text: "oriel.log('hi')", world: "isolated", runAt: "document_end" }],
        vars: [
            { key: "accent", type: "color", label: "Accent", default: "#ff6600" },
            { key: "density", type: "range", label: "Row spacing", default: 8, min: 2, max: 24, step: 1, units: "px" }
        ],
        runAt: "document_start",
        allFrames: false,
        source: { kind: "url", resolved: "https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css" },
        warnings: []
    }
};

const capsFull = {
    js: "userScripts",
    userScriptsApi: true,
    userScriptsPermitted: true,
    functionConstructor: true,
    mainWorld: true,
    insertCss: true,
    webNavigation: true,
    registerContentScripts: true,
    engine: "chromium"
};

const capsSafari = {
    js: "none",
    userScriptsApi: false,
    userScriptsPermitted: false,
    functionConstructor: false,
    mainWorld: false,
    insertCss: true,
    webNavigation: false,
    registerContentScripts: false,
    engine: "webkit"
};

afterEach(() => {
    vi.useRealTimers();
});

/* ------------------------------------------------------------- skin list */

describe("renderSkinList", () => {
    it("renders one row per skin, with version and targets", () => {
        const document = makeDocument();
        const view = mount(renderSkinList({ skins: [hn, gh] }, document), document);

        const rows = view.querySelectorAll(".o-row");
        expect(rows).toHaveLength(2);
        expect(rows[0].dataset.id).toBe("hn-rebuilt");
        expect(textOf(rows[0], ".o-row-name")).toBe("Hacker News, rebuilt");
        expect(textOf(rows[0], ".o-row-meta")).toBe("v1.4.0 · news.ycombinator.com");
        expect(rows[1].classList.contains("is-off")).toBe(true);
    });

    it("shows a warning dot only for a skin with warnings", () => {
        const document = makeDocument();
        const view = renderSkinList({ skins: [hn, gh] }, document);
        const rows = view.querySelectorAll(".o-row");

        expect(rows[0].querySelector(".o-dot")).toBeNull();
        expect(rows[1].querySelector(".o-dot")).not.toBeNull();
        expect(rows[1].querySelector(".o-dot").getAttribute("aria-label")).toBe("2 warnings");
    });

    it("filters by name, and offers a way back when nothing matches", () => {
        const document = makeDocument();
        expect(renderSkinList({ skins: [hn, gh], filter: "hacker" }, document).querySelectorAll(".o-row")).toHaveLength(1);

        const empty = renderSkinList({ skins: [hn, gh], filter: "zzz" }, document);
        expect(empty.querySelectorAll(".o-row")).toHaveLength(0);
        expect(textOf(empty, ".o-empty-title")).toBe("Nothing matches");
    });

    it("reports search input as an oriel:filter event", () => {
        const document = makeDocument();
        const view = mount(renderSkinList({ skins: [hn] }, document), document);
        const seen = [];
        view.addEventListener("oriel:filter", (event) => seen.push(event.detail.value));

        const search = view.querySelector(".o-search");
        search.value = "hn";
        fire(search, "input");
        expect(seen).toEqual(["hn"]);
    });

    it("toggles a skin through onToggle", () => {
        const document = makeDocument();
        const onToggle = vi.fn();
        const view = mount(renderSkinList({ skins: [hn, gh], onToggle }, document), document);

        const input = view.querySelectorAll(".o-row")[0].querySelector(".o-switch input");
        expect(input.checked).toBe(true);
        input.checked = false;
        fire(input, "change");
        expect(onToggle).toHaveBeenCalledWith("hn-rebuilt", false);
    });

    it("opens a row through onOpen", () => {
        const document = makeDocument();
        const onOpen = vi.fn();
        const view = mount(renderSkinList({ skins: [hn], onOpen }, document), document);

        view.querySelector(".o-row-main").click();
        expect(onOpen).toHaveBeenCalledWith("hn-rebuilt", hn);
    });

    it("reorders with the up and down buttons, ends disabled", () => {
        const document = makeDocument();
        const onReorder = vi.fn();
        const view = mount(renderSkinList({ skins: [hn, gh], onReorder }, document), document);
        const rows = view.querySelectorAll(".o-row");

        expect(rows[0].querySelector("[data-move='up']").disabled).toBe(true);
        expect(rows[1].querySelector("[data-move='down']").disabled).toBe(true);

        rows[0].querySelector("[data-move='down']").click();
        expect(onReorder).toHaveBeenCalledWith(["gh-quieter", "hn-rebuilt"], "hn-rebuilt");
    });

    it("shows an empty state that leads to the Add tab", () => {
        const document = makeDocument();
        const view = mount(renderSkinList({ skins: [] }, document), document);
        const seen = [];
        view.addEventListener("oriel:navigate", (event) => seen.push(event.detail.tab));

        expect(textOf(view, ".o-empty-title")).toBe("No skins yet");
        view.querySelector(".o-empty .o-button").click();
        expect(seen).toEqual(["add"]);
    });

    it("renders a hostile skin name as text, not markup", () => {
        const document = makeDocument();
        const hostile = { ...hn, id: "evil", name: "<img src=x onerror=alert(1)>" };
        const view = mount(renderSkinList({ skins: [hostile] }, document), document);

        expect(view.querySelectorAll("img")).toHaveLength(0);
        expect(document.querySelectorAll("img")).toHaveLength(0);
        expect(textOf(view, ".o-row-name")).toBe("<img src=x onerror=alert(1)>");
        expect(view.innerHTML).toContain("&lt;img");
    });
});

/* ----------------------------------------------------------- skin detail */

describe("renderSkinDetail", () => {
    it("shows identity, homepage and a plain statement of what the skin does", () => {
        const document = makeDocument();
        const view = mount(renderSkinDetail({ installed: installedHn, caps: capsFull }, document), document);

        expect(textOf(view, ".o-title")).toBe("Hacker News, rebuilt");
        expect(textOf(view, ".o-sub")).toBe("v1.4.0 · by you");
        expect(view.querySelector(".o-link").getAttribute("href")).toBe("https://github.com/you/hn-rebuilt");
        expect(textOf(view, ".o-what")).toBe("CSS on 2 sites · 6 DOM operations · 1 script (isolated)");
    });

    it("refuses to link a homepage that is not http(s)", () => {
        const document = makeDocument();
        const installed = { ...installedHn, skin: { ...installedHn.skin, homepageURL: "javascript:alert(1)" } };
        const view = mount(renderSkinDetail({ installed, caps: capsFull }, document), document);

        expect(view.querySelector("a")).toBeNull();
        expect(view.textContent).toContain("javascript:alert(1)");
    });

    it("says so when the browser cannot run a skin's JavaScript", () => {
        const document = makeDocument();
        const view = renderSkinDetail({ installed: installedHn, caps: capsSafari }, document);
        expect(textOf(view, ".o-note")).toContain("JavaScript in skins is not available");
    });

    it("builds the settings form and reports a var change as a whole values map", () => {
        const document = makeDocument();
        const onValues = vi.fn();
        const view = mount(renderSkinDetail({ installed: installedHn, caps: capsFull, onValues }, document), document);

        const field = view.querySelector(".o-field[data-key='accent'] [data-input]");
        field.value = "rgba(255, 102, 0, 0.5)";
        fire(field, "input");

        expect(onValues).toHaveBeenCalledWith(
            { accent: "rgba(255, 102, 0, 0.5)", density: 8 },
            "accent",
            "rgba(255, 102, 0, 0.5)"
        );
    });

    it("says plainly when a skin has no settings", () => {
        const document = makeDocument();
        const installed = { ...installedHn, skin: { ...installedHn.skin, vars: [] } };
        const view = renderSkinDetail({ installed, caps: capsFull }, document);
        expect(view.querySelector(".o-vars").textContent).toContain("This skin has no settings.");
    });

    it("edits the source and hands it to onSave", () => {
        const document = makeDocument();
        const onSave = vi.fn();
        const view = mount(renderSkinDetail({ installed: installedHn, caps: capsFull, onSave }, document), document);

        const editor = view.querySelector("textarea.o-source");
        expect(editor.value).toBe(HN_SOURCE);
        editor.value = "/* edited */";
        byText(view, "button", "Save and re-parse").click();
        expect(onSave).toHaveBeenCalledWith("/* edited */", "hn-rebuilt");
    });

    it("shows a parse error's line number and highlights that line", () => {
        const document = makeDocument();
        const installed = { ...installedHn, errors: [{ message: "Expected a value", line: 12 }] };
        const view = mount(renderSkinDetail({ installed, caps: capsFull }, document), document);

        expect(textOf(view, ".o-error-line")).toBe("Line 12");
        const highlighted = view.querySelector(".o-line.is-error");
        expect(highlighted.dataset.line).toBe("12");
        expect(highlighted.textContent).toBe("  .broken { color: ; }");
    });

    it("removes only on the second tap", () => {
        const document = makeDocument();
        const onRemove = vi.fn();
        const view = mount(renderSkinDetail({ installed: installedHn, caps: capsFull, onRemove }, document), document);

        const remove = view.querySelector(".o-danger");
        remove.click();
        expect(onRemove).not.toHaveBeenCalled();
        expect(remove.textContent).toBe("Tap again to remove");
        remove.click();
        expect(onRemove).toHaveBeenCalledWith("hn-rebuilt");
    });

    it("checks for updates, and exports through an oriel:export event", () => {
        const document = makeDocument();
        const onUpdate = vi.fn();
        const view = mount(renderSkinDetail({ installed: installedHn, caps: capsFull, onUpdate }, document), document);
        const exported = [];
        view.addEventListener("oriel:export", (event) => exported.push(event.detail.id));

        byText(view, "button", "Check for update").click();
        expect(onUpdate).toHaveBeenCalledWith("hn-rebuilt");

        byText(view, "button", "Export").click();
        expect(exported).toEqual(["hn-rebuilt"]);
    });

    it("disables the update button for a skin with no update URL", () => {
        const document = makeDocument();
        const installed = { ...installedHn, skin: { ...installedHn.skin, updateURL: undefined } };
        const view = renderSkinDetail({ installed, caps: capsFull }, document);
        expect(byText(view, "button", "Check for update").disabled).toBe(true);
    });

    it("shows the skin's own log tail", () => {
        const document = makeDocument();
        const installed = {
            ...installedHn,
            log: [{ at: 1755302400000, skinId: "hn-rebuilt", level: "error", message: "op 3 failed: .subtext" }]
        };
        const view = mount(renderSkinDetail({ installed, caps: capsFull }, document), document);

        expect(view.querySelectorAll(".o-log-entry")).toHaveLength(1);
        expect(textOf(view, ".o-log-message")).toBe("op 3 failed: .subtext");
    });

    it("survives a missing skin", () => {
        const document = makeDocument();
        expect(textOf(renderSkinDetail({ installed: null }, document), ".o-empty-title")).toBe("Skin not found");
    });
});

/* ----------------------------------------------------------------- import */

describe("renderImport", () => {
    it("installs pasted text", () => {
        const document = makeDocument();
        const onPasteSubmit = vi.fn();
        const view = mount(renderImport({ state: { text: HN_SOURCE }, onPasteSubmit }, document), document);

        const form = view.querySelector("[data-pane='paste']");
        expect(form.querySelector("textarea").value).toBe(HN_SOURCE);
        fire(form, "submit");
        expect(onPasteSubmit).toHaveBeenCalledWith(HN_SOURCE);
    });

    it("keeps the pasted source after a failed install", () => {
        const document = makeDocument();
        const state = {
            text: HN_SOURCE,
            result: { ok: false, errors: [{ message: "Expected a value", line: 12 }], warnings: [] }
        };
        const view = mount(renderImport({ state }, document), document);

        expect(view.querySelector("[data-pane='paste'] textarea").value).toBe(HN_SOURCE);
        expect(textOf(view, ".o-result-head")).toBe("Could not install this skin.");
    });

    it("renders an ImportReply's errors with line numbers, and highlights the line", () => {
        const document = makeDocument();
        const state = {
            text: HN_SOURCE,
            result: { ok: false, errors: [{ message: "Expected a value", line: 12 }], warnings: [] }
        };
        const view = mount(renderImport({ state }, document), document);

        expect(textOf(view, ".o-error-line")).toBe("Line 12");
        expect(textOf(view, ".o-error-message")).toBe("Expected a value");
        const lines = [...view.querySelectorAll(".o-line")].map((line) => line.dataset.line);
        expect(lines).toEqual(["11", "12", "13"]);
        expect(view.querySelector(".o-line.is-error").textContent).toBe("  .broken { color: ; }");
    });

    it("renders warnings in their own, lighter list", () => {
        const document = makeDocument();
        const state = {
            text: "x",
            result: { ok: true, summary: hn, errors: [], warnings: gh.warnings, tried: "https://raw.example/hn.user.css" }
        };
        const view = mount(renderImport({ state }, document), document);

        expect(textOf(view, ".o-result-head")).toBe("Installed Hacker News, rebuilt v1.4.0");
        expect(view.querySelectorAll(".o-warning")).toHaveLength(2);
        expect(view.querySelector(".o-warnings").textContent).toContain("@preprocessor less");
        expect(view.textContent).toContain("Fetched https://raw.example/hn.user.css");
    });

    it("previews a link 400ms after typing stops, once", () => {
        vi.useFakeTimers();
        const document = makeDocument();
        const onPreview = vi.fn();
        const view = mount(renderImport({ state: {}, onPreview }, document), document);

        const input = view.querySelector("[data-pane='link'] input");
        input.value = "you/hn";
        fire(input, "input");
        input.value = "you/hn-rebuilt";
        fire(input, "input");

        vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1);
        expect(onPreview).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onPreview).toHaveBeenCalledTimes(1);
        expect(onPreview).toHaveBeenCalledWith("you/hn-rebuilt");
    });

    it("submits a link, and shows what would be fetched", () => {
        const document = makeDocument();
        const onUrlSubmit = vi.fn();
        const state = {
            locator: "you/hn-rebuilt",
            preview: {
                ok: true,
                describe: "GitHub repository you/hn-rebuilt, default branch",
                candidates: ["https://raw.githubusercontent.com/you/hn-rebuilt/main/skin.json"]
            }
        };
        const view = mount(renderImport({ state, onUrlSubmit }, document), document);

        expect(textOf(view, ".o-preview-describe")).toBe("GitHub repository you/hn-rebuilt, default branch");
        expect(view.querySelectorAll(".o-candidates li")).toHaveLength(1);

        fire(view.querySelector("[data-pane='link']"), "submit");
        expect(onUrlSubmit).toHaveBeenCalledWith("you/hn-rebuilt");
    });

    it("renders a hostile error message as text", () => {
        const document = makeDocument();
        const state = {
            text: "x",
            result: { ok: false, errors: [{ message: "<img src=x onerror=alert(1)>", line: 1 }], warnings: [] }
        };
        const view = mount(renderImport({ state }, document), document);

        expect(view.querySelectorAll("img")).toHaveLength(0);
        expect(textOf(view, ".o-error-message")).toBe("<img src=x onerror=alert(1)>");
    });
});

/* ------------------------------------------------------------------ popup */

describe("renderPopup", () => {
    it("leads with the hostname and the skins applying here", () => {
        const document = makeDocument();
        const view = mount(
            renderPopup(
                { url: "https://news.ycombinator.com/item?id=1", matches: [hn], others: [gh], caps: capsFull, settings: { enabled: true } },
                document
            ),
            document
        );

        expect(textOf(view, ".o-host")).toBe("news.ycombinator.com");
        expect(view.querySelector(".o-popup-head .o-quiet").textContent).toBe("1 skin applying here");
        expect(view.querySelectorAll(".o-rows")[0].querySelectorAll(".o-row")).toHaveLength(1);
    });

    it("collapses the skins that do not apply here", () => {
        const document = makeDocument();
        const view = renderPopup({ url: "https://news.ycombinator.com/", matches: [hn], others: [gh, { ...hn, id: "x" }] }, document);

        const details = view.querySelector("details.o-others");
        expect(details.querySelector("summary").textContent).toBe("2 other skins installed");
        expect(details.querySelectorAll(".o-row")).toHaveLength(2);
        expect(details.open).toBe(false);
    });

    it("says so plainly when nothing matches, and offers to add one", () => {
        const document = makeDocument();
        const onOpenManager = vi.fn();
        const view = mount(
            renderPopup({ url: "https://example.com/page", matches: [], others: [], onOpenManager }, document),
            document
        );

        expect(view.querySelector(".o-popup-head .o-quiet").textContent).toBe("No skin applies here");
        expect(textOf(view, ".o-empty-line")).toContain("Nothing is changing example.com");
        expect(view.querySelector(".o-rows")).toBeNull();

        byText(view, "button", "Add a skin for this site").click();
        expect(onOpenManager).toHaveBeenCalledWith({ tab: "add", url: "https://example.com/page", host: "example.com" });
    });

    it("toggles a matching skin and opens the manager", () => {
        const document = makeDocument();
        const onToggle = vi.fn();
        const onOpenManager = vi.fn();
        const view = mount(renderPopup({ url: "https://news.ycombinator.com/", matches: [hn], onToggle, onOpenManager }, document), document);

        const input = view.querySelector(".o-switch input");
        input.checked = false;
        fire(input, "change");
        expect(onToggle).toHaveBeenCalledWith("hn-rebuilt", false);

        byText(view, "button", "Open manager").click();
        expect(onOpenManager).toHaveBeenCalledWith({ tab: "skins" });
    });

    it("shows one quiet line when the browser cannot run skin JavaScript", () => {
        const document = makeDocument();
        const withJs = renderPopup({ url: "https://a.test/", matches: [hn], caps: capsFull }, document);
        expect(withJs.querySelector(".o-note")).toBeNull();

        const withoutJs = renderPopup({ url: "https://a.test/", matches: [hn], caps: capsSafari }, document);
        expect(textOf(withoutJs, ".o-note")).toBe(
            "JavaScript in skins is not available in this browser — CSS and layout changes still work."
        );
    });

    it("warns when the master switch is off", () => {
        const document = makeDocument();
        const view = renderPopup({ url: "https://a.test/", matches: [hn], settings: { enabled: false } }, document);
        expect(view.querySelector(".o-banner").textContent).toContain("All skins are switched off.");
    });

    it("copes with a page that has no hostname", () => {
        const document = makeDocument();
        const view = renderPopup({ url: "about:blank", matches: [] }, document);
        expect(textOf(view, ".o-host")).toBe("about:blank");
    });
});

/* -------------------------------------------------------------------- log */

describe("renderLog", () => {
    const entries = [
        { at: 1755302400000, skinId: "hn-rebuilt", level: "info", message: "applied" },
        { at: 1755302460000, skinId: "gh-quieter", level: "error", message: "op 2 failed" },
        { at: 1755302430000, skinId: "hn-rebuilt", level: "warn", message: "selector matched nothing" }
    ];

    it("puts the newest first and colours by level, without mutating the input", () => {
        const document = makeDocument();
        const view = mount(renderLog({ entries, skins: [hn, gh] }, document), document);

        const rows = [...view.querySelectorAll(".o-log-entry")];
        expect(rows.map((row) => row.querySelector(".o-log-message").textContent)).toEqual([
            "op 2 failed",
            "selector matched nothing",
            "applied"
        ]);
        expect(rows[0].classList.contains("is-error")).toBe(true);
        expect(rows[1].classList.contains("is-warn")).toBe(true);
        expect(textOf(rows[0], ".o-log-skin")).toBe("GitHub, quieter");
        expect(entries[0].message).toBe("applied");
    });

    it("filters to one skin and reports the change", () => {
        const document = makeDocument();
        const view = mount(renderLog({ entries, skins: [hn, gh], filter: "hn-rebuilt" }, document), document);
        expect(view.querySelectorAll(".o-log-entry")).toHaveLength(2);

        const seen = [];
        view.addEventListener("oriel:log-filter", (event) => seen.push(event.detail.skinId));
        const select = view.querySelector("select");
        expect(select.value).toBe("hn-rebuilt");
        select.value = "gh-quieter";
        fire(select, "change");
        expect(seen).toEqual(["gh-quieter"]);
    });

    it("clears through an oriel:log-clear event", () => {
        const document = makeDocument();
        const view = mount(renderLog({ entries, skins: [hn, gh], filter: "hn-rebuilt" }, document), document);
        const seen = [];
        view.addEventListener("oriel:log-clear", (event) => seen.push(event.detail.skinId));

        byText(view, "button", "Clear").click();
        expect(seen).toEqual(["hn-rebuilt"]);
    });

    it("has an empty state", () => {
        const document = makeDocument();
        expect(textOf(renderLog({ entries: [], skins: [] }, document), ".o-empty-title")).toBe("Nothing logged");
    });

    it("renders a hostile log message as text", () => {
        const document = makeDocument();
        const hostile = [{ at: 1, skinId: "evil", level: "error", message: "<img src=x onerror=alert(1)>" }];
        const view = mount(renderLog({ entries: hostile, skins: [] }, document), document);

        expect(view.querySelectorAll("img")).toHaveLength(0);
        expect(textOf(view, ".o-log-message")).toBe("<img src=x onerror=alert(1)>");
    });
});

/* ------------------------------------------------------------------- caps */

describe("renderCaps", () => {
    it("says in one line per capability what this browser allows", () => {
        const document = makeDocument();
        const view = mount(renderCaps({ caps: capsSafari }, document), document);

        const lines = [...view.querySelectorAll(".o-cap")];
        expect(lines.map((line) => line.dataset.cap)).toEqual([
            "js",
            "mainWorld",
            "insertCss",
            "webNavigation",
            "registerContentScripts"
        ]);
        expect(textOf(lines[0], ".o-cap-note")).toBe("Skins cannot run JavaScript here. CSS and DOM changes still work.");
        expect(lines[0].classList.contains("is-off")).toBe(true);
        expect(lines[2].classList.contains("is-ok")).toBe(true);
        expect(view.textContent).toContain("Engine: webkit");
    });

    it("offers to ask for the userScripts permission only when it is available and ungranted", () => {
        const document = makeDocument();
        expect(renderCaps({ caps: capsFull }, document).querySelector(".o-card-foot")).toBeNull();

        const view = mount(renderCaps({ caps: { ...capsFull, userScriptsPermitted: false, js: "function" } }, document), document);
        const seen = [];
        view.addEventListener("oriel:request-userscripts", () => seen.push(true));
        byText(view, "button", "Allow user scripts").click();
        expect(seen).toEqual([true]);
    });
});

/* --------------------------------------------------------------- settings */

describe("renderSettings", () => {
    it("reflects the stored settings", () => {
        const document = makeDocument();
        const view = mount(
            renderSettings({ settings: { enabled: true, allowFrames: true, updateCheck: "daily", devServer: "http://localhost:8787" } }, document),
            document
        );

        expect(view.querySelector("[data-setting='enabled'] input").checked).toBe(true);
        expect(view.querySelector("[data-setting='allowFrames'] input").checked).toBe(true);
        expect(view.querySelector("[data-setting='updateCheck'] select").value).toBe("daily");
        expect(view.querySelector("[data-setting='devServer'] input").value).toBe("http://localhost:8787");
    });

    it("reports every change as it happens", () => {
        const document = makeDocument();
        const onChange = vi.fn();
        const view = mount(renderSettings({ settings: { enabled: true }, onChange }, document), document);

        const master = view.querySelector("[data-setting='enabled'] input");
        master.checked = false;
        fire(master, "change");
        expect(onChange).toHaveBeenCalledWith("enabled", false);

        const frequency = view.querySelector("[data-setting='updateCheck'] select");
        frequency.value = "never";
        fire(frequency, "change");
        expect(onChange).toHaveBeenCalledWith("updateCheck", "never");

        const frames = view.querySelector("[data-setting='allowFrames'] input");
        frames.checked = true;
        fire(frames, "change");
        expect(onChange).toHaveBeenCalledWith("allowFrames", true);

        const dev = view.querySelector("[data-setting='devServer'] input");
        dev.value = "http://localhost:9000";
        fire(dev, "input");
        expect(onChange).toHaveBeenCalledWith("devServer", "http://localhost:9000");
    });
});

/* ------------------------------------------------------------------ empty */

describe("renderEmpty", () => {
    it("renders a title, a body and an optional action", () => {
        const document = makeDocument();
        const onClick = vi.fn();
        const view = mount(renderEmpty({ title: "No skins yet", body: "Paste one.", action: { label: "Add", onClick } }, document), document);

        expect(textOf(view, ".o-empty-title")).toBe("No skins yet");
        expect(textOf(view, ".o-empty-body")).toBe("Paste one.");
        byText(view, "button", "Add").click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("renders without an action", () => {
        const document = makeDocument();
        const view = renderEmpty({ title: "Loading…" }, document);
        expect(view.querySelector("button")).toBeNull();
    });
});
