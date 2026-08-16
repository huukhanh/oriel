import { describe, it, expect } from "vitest";
import {
    sniffFormat,
    skinFromText,
    skinFromBundle,
    summarize,
    resolveForPage,
    unionTargets,
    skinMatches,
    withDefaults,
    exportSkin,
    deriveId,
    normalizeId
} from "../engine/core/skin.js";
import { stringifyUserCss } from "../engine/core/usercss.js";

/**
 * Four input formats reduce to one `Skin` here, and nothing downstream knows
 * which one a skin arrived in. These tests are what that claim rests on.
 */

const USERCSS = `/* ==UserStyle==
@name        Hacker News, rebuilt
@namespace   github.com/you
@version     1.4.0
@description Card layout.
@author      you
@license     MIT
@updateURL   https://raw.githubusercontent.com/you/hn/main/hn.user.css
@var color accent "Accent" #ff6600
@var range density "Row spacing" [8, 2, 24, 1, "px"]
==/UserStyle== */
@-moz-document domain("news.ycombinator.com") {
  .athing { gap: /*[[density]]*/; color: var(--accent); }
}
@-moz-document domain("example.com") {
  body { background: black; }
}`;

const BUNDLE = {
    format: 1,
    id: "hn-rebuilt",
    name: "Hacker News, rebuilt",
    version: "2.0.0",
    matches: ["*://news.ycombinator.com/*"],
    excludes: ["*://news.ycombinator.com/login*"],
    css: [{ text: ".athing { display: grid; }" }],
    dom: [{ op: "remove", select: ".ad" }],
    js: [{ text: "oriel.log('hi');", world: "isolated", runAt: "document_end" }],
    vars: [{ key: "accent", type: "color", label: "Accent", default: "#ff6600" }]
};

const USERSCRIPT = `// ==UserScript==
// @name        Tidy
// @version     0.3.0
// @match       *://example.com/*
// @run-at      document-end
// @grant       none
// ==/UserScript==
document.title = "tidied";`;

const paste = { kind: "paste" };

describe("sniffFormat", () => {
    it.each([
        ["a UserCSS file", USERCSS, "usercss"],
        ["a bundle", JSON.stringify(BUNDLE), "bundle"],
        ["a userscript", USERSCRIPT, "userscript"],
        ["a bare stylesheet", "body { color: red; }", "css"],
        ["an at-rule stylesheet", "@media (min-width: 40em) { body { color: red } }", "css"],
        ["nothing useful", "hello there", "unknown"],
        ["an empty string", "   ", "unknown"]
    ])("recognises %s", (_, text, expected) => {
        expect(sniffFormat(text)).toBe(expected);
    });

    it("treats a stylesheet whose first rule lost its selector as CSS, not JSON", () => {
        expect(sniffFormat("{ color: red; }\n.a { color: blue }")).toBe("css");
    });

    it("prefers the structural marker when a userscript mentions UserStyle in a comment", () => {
        const text = `// ==UserScript==\n// @name x\n// @match *://a.com/*\n// ==/UserScript==\n// ==UserStyle== in a string`;
        expect(sniffFormat(text)).toBe("userscript");
    });
});

describe("UserCSS in", () => {
    const { skin, errors } = skinFromText(USERCSS, paste);

    it("parses without error", () => {
        expect(errors).toEqual([]);
        expect(skin).not.toBeNull();
    });

    it("keeps each @-moz-document section separately targeted", () => {
        // A style with two sections is one skin with two scoped stylesheets.
        // Merging them would apply the Hacker News rules to example.com.
        expect(skin.css).toHaveLength(2);
        expect(skin.css[0].targets.include).toEqual([{ kind: "domain", value: "news.ycombinator.com" }]);
        expect(skin.css[1].targets.include).toEqual([{ kind: "domain", value: "example.com" }]);
    });

    it("carries the metadata across", () => {
        expect(skin.name).toBe("Hacker News, rebuilt");
        expect(skin.version).toBe("1.4.0");
        expect(skin.author).toBe("you");
        expect(skin.license).toBe("MIT");
        expect(skin.updateURL).toContain("raw.githubusercontent.com");
        expect(skin.vars.map((v) => v.key)).toEqual(["accent", "density"]);
    });

    it("takes its overall reach from the union of its sections", () => {
        expect(unionTargets(skin).include).toHaveLength(2);
        expect(skinMatches(skin, "https://news.ycombinator.com/")).toBe(true);
        expect(skinMatches(skin, "https://example.com/")).toBe(true);
        expect(skinMatches(skin, "https://other.com/")).toBe(false);
    });
});

describe("a bundle in", () => {
    const { skin, errors } = skinFromText(JSON.stringify(BUNDLE), paste);

    it("parses without error", () => {
        expect(errors).toEqual([]);
    });

    it("keeps all four parts", () => {
        expect(skin.css).toHaveLength(1);
        expect(skin.dom).toHaveLength(1);
        expect(skin.js).toHaveLength(1);
        expect(skin.vars).toHaveLength(1);
    });

    it("defaults a script's world to isolated and gives every unit an id", () => {
        expect(skin.js[0].world).toBe("isolated");
        expect(skin.js[0].id).toBeTruthy();
    });

    it("keeps excludes", () => {
        expect(skinMatches(skin, "https://news.ycombinator.com/")).toBe(true);
        expect(skinMatches(skin, "https://news.ycombinator.com/login?x=1")).toBe(false);
    });
});

describe("a userscript in", () => {
    const { skin, errors, warnings } = skinFromText(USERSCRIPT, paste);

    it("becomes a skin whose only content is its script", () => {
        expect(errors).toEqual([]);
        expect(skin.js).toHaveLength(1);
        expect(skin.js[0].text).toContain('document.title = "tidied"');
        expect(skin.css).toEqual([]);
    });

    it("warns that its JavaScript may be suspended", () => {
        // The user is installing something whose entire content is code, onto
        // a platform that may refuse to run it. Saying so at install time is
        // the difference between a limitation and a mystery.
        expect(warnings.join(" ")).toMatch(/suspended|where the browser allows/i);
    });
});

describe("refusing to install", () => {
    it("rejects a stylesheet with nowhere to apply", () => {
        // Defaulting plain CSS to every site would be the worst default
        // available: it would put a pasted stylesheet onto the user's bank.
        const { skin, errors } = skinFromText("body { color: red; }", paste);
        expect(skin).toBeNull();
        expect(errors.some((e) => e.field === "matches")).toBe(true);
    });

    it("accepts the same stylesheet once told where it goes", () => {
        const { skin, errors } = skinFromText("body { color: red; }", paste, {
            match: "*://example.com/*",
            name: "Reds"
        });
        expect(errors).toEqual([]);
        expect(skin.name).toBe("Reds");
        expect(skinMatches(skin, "https://example.com/x")).toBe(true);
    });

    it("rejects a skin that does nothing", () => {
        const { skin, errors } = skinFromText(
            JSON.stringify({ name: "Empty", version: "1.0.0", matches: ["*://a.com/*"] }),
            paste
        );
        expect(skin).toBeNull();
        expect(errors.some((e) => /empty/i.test(e.message))).toBe(true);
    });

    it("reports an unparseable target rule instead of silently dropping it", () => {
        const { skin, errors } = skinFromText(
            JSON.stringify({ ...BUNDLE, matches: ["*://example.com"] }),
            paste
        );
        expect(skin).toBeNull();
        expect(errors.length).toBeGreaterThan(0);
    });

    it("says so plainly when the text is not a skin at all", () => {
        const { skin, errors } = skinFromText("hello there", paste);
        expect(skin).toBeNull();
        expect(errors[0].message).toMatch(/does not look like a skin/i);
    });
});

describe("identity", () => {
    it("derives a stable id from namespace and name", () => {
        expect(deriveId("github.com/you", "HN")).toBe(deriveId("github.com/you", "HN"));
    });

    it("separates two skins with the same name from different authors", () => {
        expect(deriveId("github.com/a", "HN")).not.toBe(deriveId("github.com/b", "HN"));
    });

    it("normalizes an author-supplied id to a slug", () => {
        expect(normalizeId("HN Rebuilt!")).toBe("hn-rebuilt");
        expect(normalizeId("---")).toBe("");
        expect(normalizeId("9lives")).toBe("9lives");
    });

    it("gives the same UserCSS the same id every time it is installed", () => {
        const a = skinFromText(USERCSS, paste).skin;
        const b = skinFromText(USERCSS, { kind: "url", url: "https://example.com/x.user.css" }).skin;
        // Re-installing from a different URL must replace, not duplicate.
        expect(a.id).toBe(b.id);
    });
});

describe("resolving for a page", () => {
    const installed = (values = {}) => ({
        skin: skinFromText(USERCSS, paste).skin,
        enabled: true,
        order: 0,
        values,
        installedAt: 1,
        updatedAt: 2
    });

    it("sends only the sections whose own scope matches", () => {
        const applied = resolveForPage(installed(), "https://news.ycombinator.com/");
        expect(applied.css).toHaveLength(1);
        expect(applied.css[0].text).toContain(".athing");
    });

    it("returns nothing for a URL the skin does not reach", () => {
        expect(resolveForPage(installed(), "https://nowhere.test/")).toBeNull();
    });

    it("substitutes uso-style placeholders and emits the custom properties", () => {
        const applied = resolveForPage(installed({ accent: "#00ff00" }), "https://news.ycombinator.com/");
        expect(applied.css[0].text).not.toContain("/*[[density]]*/");
        expect(applied.css[0].text).toContain("8px");
        expect(applied.varBlock).toContain("--accent: #00ff00");
    });

    it("falls back to a declared default when the stored value is nonsense", () => {
        const applied = resolveForPage(installed({ density: 9999 }), "https://news.ycombinator.com/");
        // Clamped to the declared maximum rather than written through.
        expect(applied.vars.density).toBe(24);
    });

    it("hands the page a resolved subset, not the stored skin", () => {
        const applied = resolveForPage(installed(), "https://news.ycombinator.com/");
        expect(applied).not.toHaveProperty("source");
        expect(applied).not.toHaveProperty("warnings");
        expect(Object.keys(applied).sort()).toEqual(
            ["assets", "css", "dom", "id", "js", "name", "rev", "runAt", "varBlock", "vars"].sort()
        );
    });
});

describe("withDefaults", () => {
    const vars = [
        { key: "accent", type: "color", label: "A", default: "#ff6600" },
        { key: "density", type: "range", label: "D", default: 8, min: 2, max: 24, step: 1 }
    ];

    it("fills in everything the user has not set", () => {
        expect(withDefaults(vars, {})).toEqual({ accent: "#ff6600", density: 8 });
    });

    it("ignores a stored key the skin no longer declares", () => {
        // A skin update that dropped a variable must not leak the old value
        // into the page as an undeclared custom property.
        expect(withDefaults(vars, { gone: "x" })).not.toHaveProperty("gone");
    });
});

describe("summarize", () => {
    const installed = {
        skin: skinFromText(JSON.stringify(BUNDLE), paste).skin,
        enabled: false,
        order: 3,
        values: {},
        installedAt: 1,
        updatedAt: 2
    };

    it("describes the skin without loading its body", () => {
        const summary = summarize(installed);
        expect(summary).toMatchObject({
            id: "hn-rebuilt",
            name: "Hacker News, rebuilt",
            version: "2.0.0",
            enabled: false,
            order: 3,
            hasJs: true,
            hasDom: true,
            varCount: 1
        });
        expect(summary.cssBytes).toBeGreaterThan(0);
        expect(summary.targets).toContain("news.ycombinator.com");
    });
});

describe("exporting", () => {
    it("round-trips a bundle back through the parser", () => {
        const original = skinFromText(JSON.stringify(BUNDLE), paste).skin;
        const { text, filename } = exportSkin({ skin: original, enabled: true, order: 0, values: {} });
        expect(filename).toBe("hn-rebuilt.skin.json");

        const again = skinFromText(text, paste).skin;
        expect(again.name).toBe(original.name);
        expect(again.version).toBe(original.version);
        expect(again.css[0].text).toBe(original.css[0].text);
        expect(again.dom).toEqual(original.dom);
        expect(again.js[0].text).toBe(original.js[0].text);
        expect(again.vars).toEqual(original.vars);
    });

    it("exports a CSS-only skin as UserCSS, which is what its author will commit", () => {
        const original = skinFromText(USERCSS, paste).skin;
        const { text, filename } = exportSkin(
            { skin: original, enabled: true, order: 0, values: {} },
            stringifyUserCss
        );
        expect(filename).toMatch(/\.user\.css$/);
        expect(text).toContain("==UserStyle==");

        const again = skinFromText(text, paste).skin;
        expect(again.name).toBe(original.name);
        expect(again.vars.map((v) => v.key)).toEqual(original.vars.map((v) => v.key));
    });

    it("exports a bundle when there is JavaScript, because UserCSS cannot hold it", () => {
        const original = skinFromText(JSON.stringify(BUNDLE), paste).skin;
        const { filename } = exportSkin(
            { skin: original, enabled: true, order: 0, values: {} },
            stringifyUserCss
        );
        expect(filename).toMatch(/\.skin\.json$/);
    });
});

describe("bundles that reference files", () => {
    const manifest = {
        ...BUNDLE,
        css: ["style.css"],
        dom: "layout.dom.json",
        js: [{ file: "enhance.js", world: "isolated" }]
    };

    const files = {
        "style.css": ".athing { display: grid; }",
        "layout.dom.json": '[{"op":"remove","select":".ad"}]',
        "enhance.js": "oriel.log('loaded');"
    };

    it("pulls each referenced file in", async () => {
        const { skin, errors } = await skinFromBundle(manifest, { kind: "url" }, async (path) => {
            if (!(path in files)) throw new Error("not found");
            return files[path];
        });
        expect(errors).toEqual([]);
        expect(skin.css[0].text).toBe(files["style.css"]);
        // Normalized on the way in: validateOps fills in `watch` and the op's
        // index, so the stored shape is richer than what the author wrote.
        expect(skin.dom).toMatchObject([{ op: "remove", select: ".ad", watch: false }]);
        expect(skin.js[0].text).toBe(files["enhance.js"]);
    });

    it("names the file it could not read", async () => {
        const { errors } = await skinFromBundle(manifest, { kind: "url" }, async () => {
            throw new Error("404");
        });
        expect(errors.some((e) => e.message.includes("style.css"))).toBe(true);
    });
});
