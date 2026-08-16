import { describe, it, expect } from "vitest";
import { isUserCss, parseUserCss, parseMozDocument, stringifyUserCss } from "../engine/core/usercss.js";

describe("isUserCss", () => {
    it("is true for a well-formed metadata block", () => {
        expect(isUserCss("/* ==UserStyle==\n@name X\n==/UserStyle== */\na{}")).toBe(true);
    });

    it("is false with no block", () => {
        expect(isUserCss("a { color: red; }")).toBe(false);
    });

    it("is false for an empty string", () => {
        expect(isUserCss("")).toBe(false);
    });

    it("is false for a non-string", () => {
        expect(isUserCss(null)).toBe(false);
    });

    it("is false for an opened-but-never-closed block", () => {
        expect(isUserCss("/* ==UserStyle==\n@name X\n")).toBe(false);
    });
});

describe("parseUserCss - a complete realistic skin", () => {
    const src = [
        "/* ==UserStyle==",
        "@name           Hacker News, rebuilt",
        "@namespace      github.com/you",
        "@version        1.4.0",
        "@description    Card layout, real typography, no table soup.",
        "@author         you",
        "@license        MIT",
        "@homepageURL    https://github.com/you/hn-rebuilt",
        "@updateURL      https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css",
        "@preprocessor   default",
        '@var color   accent    "Accent"        #ff6600',
        '@var range   density   "Row spacing"   [8, 2, 24, 1, "px"]',
        '@var checkbox thumbs   "Show avatars"  1',
        '@var select  corners  "Corner style" {',
        '  "Rounded:round": "12px",',
        '  "Square:square": "0"',
        "}",
        "==/UserStyle== */",
        "",
        '@-moz-document domain("news.ycombinator.com") {',
        "  :root { --accent: /*[[accent]]*/; --gap: /*[[density]]*/; }",
        "  .athing { display: grid; gap: var(--gap); border-radius: /*[[corners]]*/; }",
        '  table[border="0"] { all: unset; }',
        "}"
    ].join("\n");
    const result = parseUserCss(src);

    it("has no fatal errors", () => {
        expect(result.errors).toEqual([]);
    });

    it("extracts every simple metadata field", () => {
        expect(result.name).toBe("Hacker News, rebuilt");
        expect(result.namespace).toBe("github.com/you");
        expect(result.version).toBe("1.4.0");
        expect(result.description).toBe("Card layout, real typography, no table soup.");
        expect(result.author).toBe("you");
        expect(result.license).toBe("MIT");
        expect(result.homepageURL).toBe("https://github.com/you/hn-rebuilt");
        expect(result.updateURL).toBe("https://raw.githubusercontent.com/you/hn-rebuilt/main/hn.user.css");
    });

    it("parses all four var types", () => {
        expect(result.vars.map((v) => v.key)).toEqual(["accent", "density", "thumbs", "corners"]);
        expect(result.vars[0]).toMatchObject({ type: "color", default: "#ff6600" });
        expect(result.vars[1]).toMatchObject({ type: "range", default: 8, min: 2, max: 24, step: 1, units: "px" });
        expect(result.vars[2]).toMatchObject({ type: "checkbox", default: 1 });
        // No option is starred in this fixture, so the default is the first
        // entry's key — and per the object form's key-first convention, that
        // key is "Rounded" (the human-looking word), not "round".
        expect(result.vars[3]).toMatchObject({ type: "select", default: "Rounded" });
    });

    it("builds one @-moz-document section with a domain rule", () => {
        expect(result.sections).toHaveLength(1);
        expect(result.sections[0].rules).toEqual([{ kind: "domain", value: "news.ycombinator.com" }]);
        expect(result.sections[0].css).toContain("--accent: /*[[accent]]*/");
        expect(result.sections[0].css).toContain(".athing");
    });
});

describe("parseUserCss - errors and warnings", () => {
    it("missing @name is a fatal error", () => {
        const result = parseUserCss("/* ==UserStyle==\n@version 1.0.0\n==/UserStyle== */\na{}");
        expect(result.errors.some((e) => e.field === "name")).toBe(true);
        expect(result.errors[0].line).toBeTypeOf("number");
    });

    it("missing @version is a warning, not an error, and defaults to 0.0.0", () => {
        const result = parseUserCss("/* ==UserStyle==\n@name X\n==/UserStyle== */\na{}");
        expect(result.errors).toEqual([]);
        expect(result.version).toBe("0.0.0");
        expect(result.warnings.some((w) => w.includes("@version"))).toBe(true);
    });

    it("missing @namespace is a warning, not an error", () => {
        const result = parseUserCss("/* ==UserStyle==\n@name X\n@version 1.0.0\n==/UserStyle== */\na{}");
        expect(result.errors).toEqual([]);
        expect(result.warnings.some((w) => w.includes("@namespace"))).toBe(true);
    });

    it("an unknown key is kept and warned about, never dropped or fatal", () => {
        const result = parseUserCss("/* ==UserStyle==\n@name X\n@totallyMadeUp something\n==/UserStyle== */\na{}");
        expect(result.errors).toEqual([]);
        expect(result.meta.totallyMadeUp).toBe("something");
        expect(result.warnings.some((w) => w.includes("totallyMadeUp"))).toBe(true);
    });

    it("@preprocessor less warns that its variable syntax is not resolved", () => {
        const result = parseUserCss("/* ==UserStyle==\n@name X\n@preprocessor less\n==/UserStyle== */\na{}");
        expect(result.meta.preprocessor).toBe("less");
        expect(result.warnings.some((w) => w.includes("less"))).toBe(true);
    });

    it("no metadata block at all does not throw, and reports an error", () => {
        expect(() => parseUserCss("a { color: red; }")).not.toThrow();
        const result = parseUserCss("a { color: red; }");
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.sections).toEqual([]);
    });

    it("does not throw on an empty string or non-string input", () => {
        expect(() => parseUserCss("")).not.toThrow();
        expect(() => parseUserCss(undefined)).not.toThrow();
        expect(parseUserCss("").errors.length).toBeGreaterThan(0);
    });

    it("a malformed @var line becomes an error, not a throw", () => {
        const result = parseUserCss('/* ==UserStyle==\n@name X\n@var checkbox t "T" maybe\n==/UserStyle== */\na{}');
        expect(result.errors.some((e) => e.field === "vars")).toBe(true);
        expect(result.vars).toEqual([]);
    });
});

describe("parseUserCss - Oriel extension keys", () => {
    it("@oriel-match / @oriel-exclude become the skin-wide targets", () => {
        const src = [
            "/* ==UserStyle==",
            "@name X",
            "@oriel-match *://example.com/*",
            "@oriel-exclude *://example.com/admin/*",
            "==/UserStyle== */"
        ].join("\n");
        const result = parseUserCss(src);
        expect(result.targets).toEqual({
            include: [{ kind: "match", value: "*://example.com/*" }],
            exclude: [{ kind: "match", value: "*://example.com/admin/*" }]
        });
    });

    it("sniffs a slash-delimited @oriel-match as a regexp rule", () => {
        const src = "/* ==UserStyle==\n@name X\n@oriel-match /^https:\\/\\/x\\.com\\//\n==/UserStyle== */";
        const result = parseUserCss(src);
        expect(result.targets.include).toEqual([{ kind: "regexp", value: "^https:\\/\\/x\\.com\\/" }]);
    });

    it("@oriel-run-at is read and normalized", () => {
        const src = "/* ==UserStyle==\n@name X\n@oriel-run-at document-end\n==/UserStyle== */";
        expect(parseUserCss(src).runAt).toBe("document_end");
    });

    it("@oriel-all-frames true opts into frames", () => {
        const src = "/* ==UserStyle==\n@name X\n@oriel-all-frames true\n==/UserStyle== */";
        expect(parseUserCss(src).allFrames).toBe(true);
    });

    it("@oriel-dom parses a bracket-balanced JSON array, possibly multi-line", () => {
        const src = [
            "/* ==UserStyle==",
            "@name X",
            "@oriel-dom [",
            '  { "op": "remove", "select": ".ad" }',
            "]",
            "==/UserStyle== */"
        ].join("\n");
        const result = parseUserCss(src);
        expect(result.dom).toEqual([{ op: "remove", select: ".ad" }]);
    });

    it("@oriel-js captures a brace-balanced block of JS as one script unit", () => {
        const src = [
            "/* ==UserStyle==",
            "@name X",
            "@oriel-js {",
            "  const x = { a: 1 };",
            "  console.log(x);",
            "}",
            "==/UserStyle== */"
        ].join("\n");
        const result = parseUserCss(src);
        expect(result.js).toHaveLength(1);
        expect(result.js[0].text).toContain("const x = { a: 1 };");
        expect(result.js[0].text).toContain("console.log(x);");
        expect(result.js[0].world).toBe("isolated");
    });
});

describe("parseUserCss - whitespace and line-ending robustness", () => {
    it("parses CRLF line endings", () => {
        const src = "/* ==UserStyle==\r\n@name CRLF\r\n@version 1.0.0\r\n==/UserStyle== */\r\na{color:red}";
        const result = parseUserCss(src);
        expect(result.name).toBe("CRLF");
        expect(result.errors).toEqual([]);
    });

    it("parses tab-separated key/value pairs", () => {
        const src = "/* ==UserStyle==\n@name\tTabbed\n@version\t1.0.0\n==/UserStyle== */\na{}";
        expect(parseUserCss(src).name).toBe("Tabbed");
    });

    it("parses a file with no trailing newline", () => {
        const src = "/* ==UserStyle==\n@name NoTrailing\n@version 1.0.0\n==/UserStyle== */";
        const result = parseUserCss(src);
        expect(result.name).toBe("NoTrailing");
        expect(result.errors).toEqual([]);
    });
});

describe("parseMozDocument", () => {
    it("does not truncate a section whose CSS contains content: \"}\"", () => {
        const css = '@-moz-document domain("x.com") { a::after { content: "}"; } .b { color: red; } }';
        const result = parseMozDocument(css);
        expect(result.sections).toHaveLength(1);
        expect(result.sections[0].css).toContain('content: "}"');
        expect(result.sections[0].css).toContain(".b { color: red; }");
    });

    it("parses three comma-separated functions of different kinds", () => {
        const css = '@-moz-document url("https://x.com/a"), url-prefix("https://x.com/docs/"), regexp("^https://x\\\\.com/\\\\d+$") { .a {} }';
        const result = parseMozDocument(css);
        expect(result.sections[0].rules).toEqual([
            { kind: "url", value: "https://x.com/a" },
            { kind: "url-prefix", value: "https://x.com/docs/" },
            { kind: "regexp", value: "^https://x\\.com/\\d+$" }
        ]);
    });

    it("accepts single-quoted, unquoted and escaped arguments", () => {
        const css = "@-moz-document domain('example.com'), url-prefix(https://y.com/a), url(\"https://z.com/\\\"q\\\"\") { .a {} }";
        const result = parseMozDocument(css);
        expect(result.sections[0].rules).toEqual([
            { kind: "domain", value: "example.com" },
            { kind: "url-prefix", value: "https://y.com/a" },
            { kind: "url", value: 'https://z.com/"q"' }
        ]);
    });

    it("keeps CSS before the first section as its own section with no rules", () => {
        const css = '.preamble { color: blue; }\n@-moz-document domain("x.com") { .a {} }';
        const result = parseMozDocument(css);
        expect(result.sections).toHaveLength(2);
        expect(result.sections[0]).toEqual({ rules: [], css: ".preamble { color: blue; }\n" });
        expect(result.sections[1].rules).toEqual([{ kind: "domain", value: "x.com" }]);
    });

    it("treats CSS with no @-moz-document at all as one rules:[] section", () => {
        const result = parseMozDocument("a { color: red; }");
        expect(result.sections).toEqual([{ rules: [], css: "a { color: red; }" }]);
    });

    it("keeps a nested @media inside the section body as ordinary CSS", () => {
        const css = '@-moz-document domain("x.com") { @media (min-width: 700px) { .a { color: red; } } }';
        const result = parseMozDocument(css);
        expect(result.sections[0].css).toContain("@media (min-width: 700px)");
    });

    it("reports an unterminated section, naming the line it opened on", () => {
        const css = 'a {}\n@-moz-document domain("x.com") {\n  .a { color: red; }';
        const result = parseMozDocument(css);
        expect(result.warnings.some((w) => w.includes("line 2"))).toBe(true);
    });
});

describe("substitution placeholders", () => {
    it("var substitution and CSS variable emission are handled by core/vars.js, not here", () => {
        // usercss.js only extracts sections/vars; substitution is tested in vars.test.js.
        const result = parseUserCss('/* ==UserStyle==\n@name X\n@version 1.0.0\n==/UserStyle== */\na { color: /*[[nope]]*/; }');
        expect(result.sections[0].css).toContain("/*[[nope]]*/");
    });
});

describe("stringifyUserCss", () => {
    it("round-trips meta and vars through parseUserCss", () => {
        const src = [
            "/* ==UserStyle==",
            "@name           Round Trip",
            "@namespace      github.com/you",
            "@version        2.0.0",
            "@description    A description.",
            "@author         you",
            '@var color   accent    "Accent"        #ff6600',
            '@var range   density   "Row spacing"   [8, 2, 24, 1, "px"]',
            '@var checkbox thumbs   "Show avatars"  1',
            '@var select  corners  "Corner style" {',
            '  "Rounded:round": "12px",',
            '  "Square:square": "0"',
            "}",
            "==/UserStyle== */",
            "",
            '@-moz-document domain("example.com") {',
            "  a { color: red; }",
            "}"
        ].join("\n");
        const first = parseUserCss(src);
        const printed = stringifyUserCss(first);
        const second = parseUserCss(printed);

        expect(second.errors).toEqual([]);
        expect(second.name).toBe(first.name);
        expect(second.version).toBe(first.version);
        expect(second.namespace).toBe(first.namespace);
        expect(second.description).toBe(first.description);
        expect(second.author).toBe(first.author);
        expect(second.vars).toEqual(first.vars);
        expect(second.sections[0].rules).toEqual(first.sections[0].rules);
    });

    it("produces text that isUserCss recognizes", () => {
        const printed = stringifyUserCss({ name: "X", version: "1.0.0", vars: [], sections: [] });
        expect(isUserCss(printed)).toBe(true);
    });
});
