import { describe, it, expect } from "vitest";
import { isUserScript, parseUserScript } from "../engine/core/userscript.js";

// Assembles "// ==UserScript== ... // ==/UserScript==" from a list of
// "@key value" lines, so individual tests only state what they're testing.
function fixture(metaLines, body = "code();\n") {
    const header = metaLines.map((line) => `// ${line}`).join("\n");
    return `// ==UserScript==\n${header}\n// ==/UserScript==\n${body}`;
}

describe("isUserScript", () => {
    it("is true for a well-formed block", () => {
        expect(isUserScript(fixture(["@name X"]))).toBe(true);
    });

    it("is true even with text before the block", () => {
        const src = `some preamble\n/* a banner */\n${fixture(["@name X"])}`;
        expect(isUserScript(src)).toBe(true);
    });

    it("is false for plain script text with no block", () => {
        expect(isUserScript("console.log('hi');\n")).toBe(false);
    });

    it("is false for an empty string", () => {
        expect(isUserScript("")).toBe(false);
    });

    it("is false for an opened-but-never-closed block", () => {
        expect(isUserScript("// ==UserScript==\n// @name X\ncode();\n")).toBe(false);
    });
});

describe("parseUserScript - a realistic complete script", () => {
    const src = fixture([
        "@name         HN Cards",
        "@namespace    github.com/example",
        "@version      1.2.0",
        "@description  Card layout for Hacker News",
        "@author       Example Author",
        "@license      MIT",
        "@homepageURL  https://example.com/hn-cards",
        "@supportURL   https://example.com/hn-cards/issues",
        "@updateURL    https://example.com/hn-cards.user.js",
        "@downloadURL  https://example.com/hn-cards.user.js",
        "@match        *://news.ycombinator.com/*",
        "@exclude-match *://news.ycombinator.com/login*",
        "@run-at       document-idle",
        "@grant        GM_addStyle",
        "@grant        GM_xmlhttpRequest"
    ], "(function () {\n  console.log('hn cards loaded');\n})();\n");
    const result = parseUserScript(src);

    it("extracts every simple field", () => {
        expect(result.name).toBe("HN Cards");
        expect(result.namespace).toBe("github.com/example");
        expect(result.version).toBe("1.2.0");
        expect(result.description).toBe("Card layout for Hacker News");
        expect(result.author).toBe("Example Author");
        expect(result.license).toBe("MIT");
        expect(result.homepageURL).toBe("https://example.com/hn-cards");
        expect(result.supportURL).toBe("https://example.com/hn-cards/issues");
        expect(result.updateURL).toBe("https://example.com/hn-cards.user.js");
        expect(result.downloadURL).toBe("https://example.com/hn-cards.user.js");
    });

    it("builds targets from @match and @exclude-match", () => {
        expect(result.targets).toEqual({
            include: [{ kind: "match", value: "*://news.ycombinator.com/*" }],
            exclude: [{ kind: "match", value: "*://news.ycombinator.com/login*" }]
        });
    });

    it("maps run-at, world, allFrames and grants", () => {
        expect(result.runAt).toBe("document_idle");
        expect(result.world).toBe("isolated");
        expect(result.allFrames).toBe(false);
        expect(result.grants).toEqual(["GM_addStyle", "GM_xmlhttpRequest"]);
    });

    it("has no warnings or errors for a clean script", () => {
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    it("keeps every meta key with its raw values, in source order", () => {
        expect(result.meta.match).toEqual(["*://news.ycombinator.com/*"]);
        expect(result.meta["exclude-match"]).toEqual(["*://news.ycombinator.com/login*"]);
        expect(result.meta.grant).toEqual(["GM_addStyle", "GM_xmlhttpRequest"]);
    });

    it("extracts the body without the metadata block", () => {
        expect(result.body).not.toMatch(/UserScript/);
        expect(result.body).toContain("hn cards loaded");
    });
});

describe("parseUserScript - targeting", () => {
    it("maps @include * to an <all_urls> match rule", () => {
        const result = parseUserScript(fixture(["@name Everywhere", "@include *"]));
        expect(result.targets.include).toEqual([{ kind: "match", value: "<all_urls>" }]);
        expect(result.errors).toEqual([]);
    });

    it("sniffs a slash-delimited @include as a regexp rule, delimiters stripped", () => {
        const regexValue = String.raw`/^https:\/\/x\.com\//`;
        const src = fixture(["@name Regex Include", `@include ${regexValue}`]);
        const result = parseUserScript(src);
        expect(result.targets.include).toEqual([{ kind: "regexp", value: regexValue.slice(1, -1) }]);
    });

    it("sniffs a plain @include as a glob rule", () => {
        const result = parseUserScript(fixture(["@name Glob Include", "@include https://*.foo.com/bar?*"]));
        expect(result.targets.include).toEqual([{ kind: "glob", value: "https://*.foo.com/bar?*" }]);
    });

    it("applies the same sniffing to @exclude", () => {
        const result = parseUserScript(fixture([
            "@name Exclude Glob",
            "@match *://example.com/*",
            "@exclude https://example.com/private/*"
        ]));
        expect(result.targets.exclude).toEqual([{ kind: "glob", value: "https://example.com/private/*" }]);
    });

    it("puts @exclude-match into the exclude set as a match rule", () => {
        const result = parseUserScript(fixture([
            "@name Exclude Match",
            "@match *://example.com/*",
            "@exclude-match *://example.com/admin/*"
        ]));
        expect(result.targets.exclude).toEqual([{ kind: "match", value: "*://example.com/admin/*" }]);
    });

    it("errors, without defaulting to match-everything, when there is no @match or @include", () => {
        const result = parseUserScript(fixture(["@name No Targets"]));
        expect(result.targets).toEqual({ include: [], exclude: [] });
        expect(result.errors.some((e) => e.field === "targets")).toBe(true);
    });
});

describe("parseUserScript - @run-at", () => {
    const cases = [
        ["document-start", "document_start"],
        ["document-body", "document_start"],
        ["document-end", "document_end"],
        ["document-idle", "document_idle"],
        ["context-menu", "document_idle"]
    ];

    for (const [input, expected] of cases) {
        it(`maps "${input}" to "${expected}"`, () => {
            const result = parseUserScript(fixture(["@name RunAt", "@match *://example.com/*", `@run-at ${input}`]));
            expect(result.runAt).toBe(expected);
        });
    }

    it("warns that Oriel has no context menu", () => {
        const result = parseUserScript(fixture(["@name RunAt", "@match *://example.com/*", "@run-at context-menu"]));
        expect(result.warnings.some((w) => w.includes("context-menu"))).toBe(true);
    });

    it("defaults an unknown value to document_idle with a warning", () => {
        const result = parseUserScript(fixture(["@name RunAt", "@match *://example.com/*", "@run-at whenever"]));
        expect(result.runAt).toBe("document_idle");
        expect(result.warnings.some((w) => w.includes("whenever"))).toBe(true);
    });

    it("defaults to document_idle with no warning when @run-at is absent", () => {
        const result = parseUserScript(fixture(["@name RunAt", "@match *://example.com/*"]));
        expect(result.runAt).toBe("document_idle");
        expect(result.warnings).toEqual([]);
    });
});

describe("parseUserScript - world and frames", () => {
    it("maps @inject-into page to the main world", () => {
        const result = parseUserScript(fixture(["@name Page", "@match *://example.com/*", "@inject-into page"]));
        expect(result.world).toBe("main");
    });

    it("maps @inject-into auto to isolated, with a warning", () => {
        const result = parseUserScript(fixture(["@name Auto", "@match *://example.com/*", "@inject-into auto"]));
        expect(result.world).toBe("isolated");
        expect(result.warnings.some((w) => w.includes("auto"))).toBe(true);
    });

    it("defaults world to isolated", () => {
        const result = parseUserScript(fixture(["@name Default World", "@match *://example.com/*"]));
        expect(result.world).toBe("isolated");
    });

    it("@noframes keeps allFrames false", () => {
        const result = parseUserScript(fixture(["@name No Frames", "@match *://example.com/*", "@noframes"]));
        expect(result.allFrames).toBe(false);
    });

    it("defaults allFrames to false when nothing is said about frames", () => {
        const result = parseUserScript(fixture(["@name Default Frames", "@match *://example.com/*"]));
        expect(result.allFrames).toBe(false);
    });

    it("opts into frames via @allFrames", () => {
        const result = parseUserScript(fixture(["@name All Frames", "@match *://example.com/*", "@allFrames"]));
        expect(result.allFrames).toBe(true);
    });
});

describe("parseUserScript - grants", () => {
    it("@grant none produces an empty grant list", () => {
        const result = parseUserScript(fixture(["@name Grant None", "@match *://example.com/*", "@grant none"]));
        expect(result.grants).toEqual([]);
    });

    it("warns about a grant Oriel does not implement, naming it", () => {
        const result = parseUserScript(fixture([
            "@name Unimplemented Grant",
            "@match *://example.com/*",
            "@grant GM_registerMenuCommand"
        ]));
        expect(result.grants).toEqual(["GM_registerMenuCommand"]);
        expect(result.warnings.some((w) => w.includes("GM_registerMenuCommand"))).toBe(true);
    });

    it("does not warn about the GM.* equivalent of an implemented grant", () => {
        const result = parseUserScript(fixture([
            "@name GM Dot Form",
            "@match *://example.com/*",
            "@grant GM.getValue"
        ]));
        expect(result.grants).toEqual(["GM.getValue"]);
        expect(result.warnings).toEqual([]);
    });
});

describe("parseUserScript - @require and @resource", () => {
    it("records @require URLs and warns they are fetched at install time", () => {
        const result = parseUserScript(fixture([
            "@name Requires Stuff",
            "@match *://example.com/*",
            "@require https://code.jquery.com/jquery-3.6.0.min.js",
            "@require https://example.com/lib.js"
        ]));
        expect(result.requires).toEqual([
            "https://code.jquery.com/jquery-3.6.0.min.js",
            "https://example.com/lib.js"
        ]);
        expect(result.warnings.some((w) => w.includes("install time"))).toBe(true);
    });

    it("records @resource name/url pairs", () => {
        const result = parseUserScript(fixture([
            "@name Has Resources",
            "@match *://example.com/*",
            "@resource icon https://example.com/icon.png",
            "@resource css  https://example.com/style.css"
        ]));
        expect(result.resources).toEqual([
            { name: "icon", url: "https://example.com/icon.png" },
            { name: "css", url: "https://example.com/style.css" }
        ]);
        expect(result.warnings.some((w) => w.includes("install time"))).toBe(true);
    });

    it("warns and skips a malformed @resource line missing its URL", () => {
        const result = parseUserScript(fixture([
            "@name Malformed Resource",
            "@match *://example.com/*",
            "@resource onlyname"
        ]));
        expect(result.resources).toEqual([]);
        expect(result.warnings.some((w) => w.includes("malformed @resource"))).toBe(true);
    });
});

describe("parseUserScript - repeats and localization", () => {
    it("warns on a repeated single-valued key and keeps the last value", () => {
        const result = parseUserScript(fixture([
            "@name First Name",
            "@name Second Name",
            "@match *://example.com/*"
        ]));
        expect(result.name).toBe("Second Name");
        expect(result.meta.name).toEqual(["First Name", "Second Name"]);
        expect(result.warnings.some((w) => w.includes("@name repeated"))).toBe(true);
    });

    it("does not warn when @match repeats, since it is multi-valued", () => {
        const result = parseUserScript(fixture([
            "@name Multi Match",
            "@match *://a.example.com/*",
            "@match *://b.example.com/*"
        ]));
        expect(result.targets.include).toEqual([
            { kind: "match", value: "*://a.example.com/*" },
            { kind: "match", value: "*://b.example.com/*" }
        ]);
        expect(result.warnings).toEqual([]);
    });

    it("prefers the un-suffixed value over a localized one, but keeps both in meta", () => {
        const result = parseUserScript(fixture([
            "@name Untranslated Name",
            "@name:fr Nom Traduit",
            "@match *://example.com/*"
        ]));
        expect(result.name).toBe("Untranslated Name");
        expect(result.meta["name:fr"]).toEqual(["Nom Traduit"]);
    });

    it("falls back to a locale-only value rather than erroring when no un-suffixed key exists", () => {
        const result = parseUserScript(fixture([
            "@name:fr Seulement Francais",
            "@match *://example.com/*"
        ]));
        expect(result.name).toBe("Seulement Francais");
        expect(result.errors.some((e) => e.field === "name")).toBe(false);
    });
});

describe("parseUserScript - malformed metadata lines", () => {
    it("warns, but does not error, on a line inside the block that isn't a @key line", () => {
        const src = `// ==UserScript==\n// @name Malformed Line\n// this line has no @key\n// @match *://example.com/*\n// ==/UserScript==\ncode();\n`;
        const result = parseUserScript(src);
        expect(result.errors).toEqual([]);
        expect(result.warnings.some((w) => w.includes("malformed"))).toBe(true);
        expect(result.targets.include).toEqual([{ kind: "match", value: "*://example.com/*" }]);
    });
});

describe("parseUserScript - whitespace and line-ending robustness", () => {
    it("parses metadata lines separated by tabs", () => {
        const src = "// ==UserScript==\n// @name\tTabbed Script\n// @match\t*://example.com/*\n// ==/UserScript==\ncode();\n";
        const result = parseUserScript(src);
        expect(result.name).toBe("Tabbed Script");
        expect(result.targets.include).toEqual([{ kind: "match", value: "*://example.com/*" }]);
    });

    it("parses CRLF line endings", () => {
        const lf = fixture(["@name CRLF Script", "@match *://example.com/*"], "console.log('hi');\n");
        const crlf = lf.replace(/\n/g, "\r\n");
        const result = parseUserScript(crlf);
        expect(result.name).toBe("CRLF Script");
        expect(result.targets.include).toEqual([{ kind: "match", value: "*://example.com/*" }]);
        expect(result.body).not.toContain("\r");
        expect(result.body).toContain("console.log('hi');");
    });

    it("parses a script missing a trailing newline", () => {
        const src = "// ==UserScript==\n// @name No Trailing Newline\n// @match *://example.com/*\n// ==/UserScript==";
        expect(isUserScript(src)).toBe(true);
        const result = parseUserScript(src);
        expect(result.name).toBe("No Trailing Newline");
        expect(result.targets.include).toEqual([{ kind: "match", value: "*://example.com/*" }]);
        expect(result.body).toBe("");
    });

    it("parses a block preceded by other text", () => {
        const src = `// This file was fetched from a gist\n/* a banner some tool adds */\n${fixture(["@name Prefixed", "@match *://example.com/*"])}`;
        const result = parseUserScript(src);
        expect(result.name).toBe("Prefixed");
        expect(result.body).toContain("This file was fetched from a gist");
        expect(result.body).toContain("code();");
        expect(result.body).not.toMatch(/UserScript/);
    });
});

describe("parseUserScript - body extraction", () => {
    it("removes exactly the metadata block, leaving the code intact", () => {
        const src = "// ==UserScript==\n// @name X\n// @match *://example.com/*\n// ==/UserScript==\ncode();";
        expect(parseUserScript(src).body).toBe("code();");
    });

    it("leaves multi-line code intact and does not leave the metadata block behind", () => {
        const code = "function hello() {\n  return 'world';\n}\nhello();\n";
        const src = fixture(["@name Body Extraction", "@match *://example.com/*"], code);
        const body = parseUserScript(src).body;
        expect(body).toContain("function hello()");
        expect(body).toContain("hello();");
        expect(body).not.toMatch(/==\/?UserScript==/);
        expect(body).not.toMatch(/@name|@match/);
    });
});

describe("parseUserScript - missing @name", () => {
    it("falls back to the first non-empty line of the body and records an error", () => {
        const direct = "// ==UserScript==\n// @match *://example.com/*\n// ==/UserScript==\n\n  console.log('fallback name source');\nmore();\n";
        const result = parseUserScript(direct);
        expect(result.name).toBe("console.log('fallback name source');");
        expect(result.errors.some((e) => e.field === "name")).toBe(true);
    });

    it("falls back to 'Untitled script' when the body is also empty", () => {
        const src = "// ==UserScript==\n// @match *://example.com/*\n// ==/UserScript==\n";
        const result = parseUserScript(src);
        expect(result.name).toBe("Untitled script");
        expect(result.errors.some((e) => e.field === "name")).toBe(true);
    });
});

describe("parseUserScript - no metadata block at all", () => {
    it("does not throw, and reports errors instead", () => {
        const src = "console.log('just a normal script, no header at all');\n";
        expect(isUserScript(src)).toBe(false);
        expect(() => parseUserScript(src)).not.toThrow();
        const result = parseUserScript(src);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.targets).toEqual({ include: [], exclude: [] });
        expect(result.name).toBe("console.log('just a normal script, no header at all');");
    });

    it("does not throw on an empty string, and still returns a usable shape", () => {
        expect(() => parseUserScript("")).not.toThrow();
        const result = parseUserScript("");
        expect(result.name).toBe("Untitled script");
        expect(result.targets).toEqual({ include: [], exclude: [] });
        expect(result.errors.length).toBeGreaterThan(0);
    });
});
