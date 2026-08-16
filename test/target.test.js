/**
 * Rule matching is the security boundary of the whole product. A rule that
 * matches one URL more than its author meant ships a stranger's CSS and JS onto
 * a page the user never authorised — a bank, a webmail, an admin console — and
 * the user has no way to see it happen. So the interesting half of this file is
 * the URLs that must *not* match; the cases from docs/SKIN-FORMAT.md §3.3 are
 * asserted first, one `it` each, so a regression names the URL it let through.
 */

import { describe, it, expect } from "vitest";
import { SkinParseError } from "../extension/src/core/types.js";
import {
    ruleFromString,
    compileRule,
    compileTargets,
    matchesTargets,
    describeTargets,
    originPatterns
} from "../extension/src/core/target.js";

/** One `it` per URL, so a failure reads as "rejects https://…" rather than "table". */
function verdicts(rule, cases) {
    const compiled = compileRule(rule);
    for (const [url, expected] of cases) {
        it(`${expected ? "matches" : "rejects"} ${url}`, () => {
            expect(compiled.test(url)).toBe(expected);
        });
    }
}

describe("match pattern *://*.example.com/*", () => {
    verdicts("*://*.example.com/*", [
        // The three from §3.3, plus the two neighbours of each mistake.
        ["https://evil.com/?q=example.com", false],
        ["https://notexample.com/", false],
        ["https://example.com.evil.com/", false],
        ["https://wwwexample.com/", false],
        ["https://example.com.evil.com/example.com", false],
        ["https://evil.com/#https://example.com/", false],
        ["https://evil.com/example.com/", false],
        // `*` in the scheme is http|https and nothing else.
        ["ftp://example.com/x", false],
        ["file://example.com/x", false],
        ["ws://example.com/x", false],
        ["data:text/html,example.com", false],
        // And the URLs it exists to match.
        ["http://example.com/", true],
        ["https://example.com/a/b?c#d", true],
        ["https://a.b.example.com/", true],
        ["https://www.example.com/", true],
        // new URL() normalises a missing path to "/", so `/*` still covers it.
        ["https://example.com", true],
        // Host comparison is case-insensitive; the path's case is untouched.
        ["https://WWW.Example.COM/A", true],
        // Ports are not part of a match pattern, so every port matches.
        ["https://example.com:8443/x", true]
    ]);

    it("is not fooled by a lookalike host in the query string", () => {
        const targets = { include: ["*://*.example.com/*"] };
        expect(matchesTargets(targets, "https://evil.com/?next=https://example.com/")).toBe(false);
    });
});

describe("match pattern schemes", () => {
    verdicts("https://example.com/*", [
        ["https://example.com/", true],
        ["http://example.com/", false],
        ["ws://example.com/", false]
    ]);

    verdicts("*://*/*", [
        ["http://anything.test/", true],
        ["https://a.b.c.example.com/deep/path?q#f", true],
        ["ftp://example.com/x", false],
        ["file:///Users/x/y", false],
        ["ws://example.com/x", false],
        ["chrome://extensions/", false]
    ]);

    verdicts("<all_urls>", [
        ["http://example.com/", true],
        ["https://example.com/a?b#c", true],
        ["file:///Users/x/y", true],
        ["ftp://example.com/x", true],
        ["ws://example.com/socket", true],
        ["wss://example.com/socket", true],
        // §3.2 lists data: among the seven schemes <all_urls> covers.
        ["data:text/html,hi", true],
        ["data:text/plain;base64,aGk=", true],
        ["chrome://extensions/", false],
        ["about:blank", false],
        ["javascript:alert(1)", false],
        ["view-source:https://example.com/", false],
        ["not a url", false]
    ]);

    verdicts("ws://*.example.com/*", [
        ["ws://example.com/socket", true],
        ["wss://example.com/socket", false],
        ["https://example.com/socket", false]
    ]);

    verdicts("HTTPS://example.com/*", [["https://example.com/a", true]]);
});

describe("match pattern hosts", () => {
    verdicts("file:///Users/x/*", [
        ["file:///Users/x/y", true],
        ["file:///Users/x/", true],
        ["file:///Users/y/z", false],
        ["https://example.com/Users/x/y", false]
    ]);

    verdicts("*://example.com/*", [
        ["https://example.com/", true],
        ["https://www.example.com/", false],
        ["https://example.com.evil.com/", false]
    ]);

    // Authors write IDN, the URL parser hands us punycode. Both must work.
    verdicts("*://*.пример.рф/*", [
        ["https://a.пример.рф/x", true],
        ["https://a.xn--e1afmkfd.xn--p1ai/x", true],
        ["https://пример.рф/", true],
        ["https://xn--e1afmkfd.xn--p1ai/", true],
        ["https://пример.рф.evil.com/", false]
    ]);

    verdicts("*://*.EXAMPLE.com/*", [
        ["https://WWW.Example.com/", true],
        ["https://example.com/", true]
    ]);
});

describe("match pattern paths", () => {
    verdicts("https://x.com/a/*/c", [
        ["https://x.com/a/b/c", true],
        ["https://x.com/a/b/d/c", true],
        // The fragment is gone by the time the path is tested, so a pattern
        // ending in a literal still matches once the page scrolls.
        ["https://x.com/a/b/c#frag", true],
        // `*` matches a run of characters including none at all, but the
        // surrounding slashes are literal.
        ["https://x.com/a//c", true],
        ["https://x.com/a/c", false],
        ["https://x.com/a/b/c/d", false],
        ["https://x.com/A/b/c", false]
    ]);

    verdicts("https://x.com/*", [
        ["https://x.com/a/b/c", true],
        ["https://x.com/", true],
        ["https://x.com", true]
    ]);

    // Path matching is case-sensitive, unlike scheme and host.
    verdicts("https://x.com/A", [
        ["https://x.com/A", true],
        ["https://x.com/a", false]
    ]);

    // The query string is part of what the path pattern sees. The fragment is
    // not — it is stripped first, exactly as Chrome does it (§3.2).
    verdicts("https://x.com/s?q=*", [
        ["https://x.com/s?q=hi", true],
        ["https://x.com/s?q=", true],
        ["https://x.com/s?q=hi#results", true],
        ["https://x.com/s", false],
        ["https://x.com/s#q=hi", false],
        ["https://x.com/s?r=hi", false]
    ]);

    verdicts("https://x.com/a", [
        ["https://x.com/a", true],
        ["https://x.com/a#top", true],
        ["https://x.com/a#/spa/route", true],
        ["https://x.com/a?b", false],
        ["https://x.com/ab", false]
    ]);

    // A hash-routed app is targeted with `url`, `url-prefix` or `regexp`, which
    // still see the whole URL. A match pattern cannot express it at all.
    it("leaves the fragment alone for the other five kinds", () => {
        const url = "https://x.com/app#/settings";
        expect(compileRule({ kind: "url", value: url }).test(url)).toBe(true);
        expect(compileRule({ kind: "url", value: "https://x.com/app" }).test(url)).toBe(false);
        expect(compileRule({ kind: "url-prefix", value: "https://x.com/app#/set" }).test(url)).toBe(true);
        expect(compileRule({ kind: "regexp", value: "#/settings$" }).test(url)).toBe(true);
        expect(compileRule({ kind: "glob", value: "*#/settings" }).test(url)).toBe(true);
    });
});

describe("malformed match patterns", () => {
    const malformed = [
        ["*://example.com", /path is required/],
        ["*://*.example.com", /path is required/],
        ["https://example.com", /path is required/],
        ["example.com/*", /<scheme>:\/\/<host>\/<path>/],
        ["://example.com/*", /<scheme>:\/\/<host>\/<path>/],
        ["ftp2://example.com/*", /unsupported scheme/],
        ["javascript://example.com/*", /unsupported scheme/],
        ["urn://example.com/*", /unsupported scheme/],
        ["https://a*.example.com/*", /leftmost label/],
        ["https://*.*.example.com/*", /malformed host/],
        // `#` and `?` in a host would be swallowed by the URL parser and
        // silently shorten it to `x`.
        ["https://x#y.com/*", /malformed host/],
        ["https://x?y.com/*", /malformed host/],
        // A pattern is tested after the fragment is stripped, so one that
        // contains a fragment is a never-match, and never-matches are errors.
        ["https://x.com/*#top", /fragment/],
        ["https://x.com/a#top", /fragment/],
        ["*://*/*#", /fragment/],
        ["https://example.com:8080/*", /port/],
        ["file://localhost/Users/*", /empty host/],
        ["*:///*", /needs a host/],
        ["https://exa mple.com/*", /valid host name/]
    ];

    for (const [pattern, message] of malformed) {
        it(`refuses ${pattern}`, () => {
            expect(() => compileRule({ kind: "match", value: pattern })).toThrow(SkinParseError);
            expect(() => compileRule({ kind: "match", value: pattern })).toThrow(message);
        });
    }

    it("suggests the fix when the path is missing", () => {
        expect(() => compileRule({ kind: "match", value: "*://example.com" })).toThrow('"*://example.com/*"');
    });

    it("says why a port is refused rather than ignored", () => {
        // The reason is that Chrome and Firefox disagree, so a ported rule
        // would apply to different pages depending on the browser.
        expect(() => compileRule({ kind: "match", value: "https://example.com:8080/*" })).toThrow(/Chrome/);
        expect(() => compileRule({ kind: "match", value: "https://example.com:8080/*" })).toThrow(/Firefox/);
    });

    it("explains that a fragment can never match", () => {
        expect(() => compileRule({ kind: "match", value: "https://x.com/a#top" })).toThrow(/stripped/);
        expect(() => compileRule({ kind: "match", value: "https://x.com/a#top" })).toThrow(/never match/);
    });
});

describe("glob", () => {
    const glob = (value) => ({ kind: "glob", value });

    verdicts(glob("https://*.foo.com/bar"), [
        ["https://a.foo.com/bar", true],
        ["https://a.b.foo.com/bar", true],
        // A glob's `*` does not respect the shape of a URL, so it does not
        // match the bare domain — and does match things no one intended. This
        // is exactly why a string that parses as a match pattern is read as one.
        ["https://foo.com/bar", false],
        ["https://evil.com/?q=.foo.com/bar", true]
    ]);

    verdicts(glob("https://x.com/?"), [
        ["https://x.com/a", true],
        ["https://x.com/ab", false],
        ["https://x.com/", false]
    ]);

    // Anchored at both ends.
    verdicts(glob("https://x.com/a"), [
        ["https://x.com/a", true],
        ["https://x.com/ab", false],
        ["https://x.com/a/b", false],
        ["xhttps://x.com/a", false]
    ]);

    // Case-insensitive, and regex metacharacters are literal.
    verdicts(glob("HTTPS://X.com/A"), [["https://x.com/a", true]]);
    verdicts(glob("https://x.com/a.b"), [
        ["https://x.com/a.b", true],
        ["https://x.com/axb", false]
    ]);
    verdicts(glob("https://x.com/a+b"), [
        ["https://x.com/a+b", true],
        ["https://x.com/aab", false]
    ]);
    verdicts(glob("*"), [["https://anything.test/at/all", true]]);
});

describe("regexp", () => {
    verdicts("/^https:\\/\\/x\\.com\\/\\d+/", [
        ["https://x.com/123", true],
        ["https://x.com/abc", false],
        ["https://evil.com/https://x.com/123", false]
    ]);

    // Unanchored by definition — the author asked for a substring search.
    verdicts({ kind: "regexp", value: "x\\.com" }, [
        ["https://a.x.com/", true],
        ["https://evil.com/?q=x.com", true]
    ]);

    it("takes flags only from the slash-delimited form", () => {
        expect(compileRule("/^https:\\/\\/X\\.COM\\//i").test("https://x.com/a")).toBe(true);
        expect(compileRule({ kind: "regexp", value: "^https://X\\.COM/" }).test("https://x.com/a")).toBe(false);
    });

    it("treats a bare value with slashes as pattern text, not a delimiter", () => {
        const rule = compileRule({ kind: "regexp", value: "/foo/i" });
        expect(rule.test("https://x.com/foo/i")).toBe(true);
        expect(rule.test("https://x.com/foo")).toBe(false);
    });

    it("is not stateful when the author wrote /g", () => {
        const rule = compileRule("/x\\.com/g");
        expect(rule.test("https://x.com/")).toBe(true);
        expect(rule.test("https://x.com/")).toBe(true);
    });

    it("refuses a regexp that does not compile", () => {
        expect(() => compileRule({ kind: "regexp", value: "^https://(" })).toThrow(SkinParseError);
        expect(() => compileRule({ kind: "regexp", value: "^https://(" })).toThrow(/does not compile/);
    });
});

describe("url and url-prefix", () => {
    verdicts({ kind: "url", value: "https://example.com/page" }, [
        ["https://example.com/page", true],
        ["https://example.com/page/", false],
        ["https://example.com/page?x=1", false],
        ["https://example.com/pag", false],
        ["http://example.com/page", false]
    ]);

    verdicts({ kind: "url-prefix", value: "https://example.com/docs/" }, [
        ["https://example.com/docs/", true],
        ["https://example.com/docs/intro", true],
        // A shorter URL is not a longer prefix.
        ["https://example.com/docs", false],
        ["https://example.com/", false],
        ["https://example.com/docsx", false],
        ["http://example.com/docs/", false],
        ["https://evil.com/https://example.com/docs/", false]
    ]);
});

describe("domain", () => {
    verdicts({ kind: "domain", value: "example.com" }, [
        ["https://example.com/", true],
        ["https://www.example.com/", true],
        ["https://a.b.example.com/x?y#z", true],
        ["http://example.com/", true],
        ["ftp://example.com/x", true],
        ["https://evilexample.com/", false],
        ["https://notexample.com/", false],
        ["https://example.com.evil.com/", false],
        // Compared against the host, never against the whole URL.
        ["https://evil.com/?q=example.com", false],
        ["https://evil.com/example.com", false],
        ["not a url", false]
    ]);

    verdicts({ kind: "domain", value: "EXAMPLE.com" }, [["https://WWW.Example.COM/", true]]);
    verdicts({ kind: "domain", value: "ПРИМЕР.рф" }, [
        ["https://a.пример.рф/x", true],
        ["https://xn--e1afmkfd.xn--p1ai/", true],
        ["https://пример.рф.evil.com/", false]
    ]);

    for (const value of ["https://example.com", "*.example.com", "example.com/docs", "example.com:8080"]) {
        it(`refuses the domain value ${value}`, () => {
            expect(() => compileRule({ kind: "domain", value })).toThrow(SkinParseError);
            expect(() => compileRule({ kind: "domain", value })).toThrow(/bare host name/);
        });
    }
});

describe("ruleFromString", () => {
    const sniffed = [
        ["/^https:\\/\\/x\\.com\\//", { kind: "regexp", value: "^https:\\/\\/x\\.com\\/" }],
        ["/foo/i", { kind: "regexp", value: "foo", flags: "i" }],
        ["/foo/", { kind: "regexp", value: "foo" }],
        ["<all_urls>", { kind: "match", value: "<all_urls>" }],
        ["*://*.example.com/*", { kind: "match", value: "*://*.example.com/*" }],
        ["file:///Users/x/*", { kind: "match", value: "file:///Users/x/*" }],
        // A pattern-shaped string wins over the glob reading even though `?` is
        // a glob wildcard: the match reading is the narrower of the two.
        ["https://*.foo.com/bar?*", { kind: "match", value: "https://*.foo.com/bar?*" }],
        // Not a pattern: no scheme, no path, or nothing URL-shaped at all.
        ["news.ycombinator.com", { kind: "match", value: "news.ycombinator.com" }],
        ["*://example.com", { kind: "match", value: "*://example.com" }],
        // `/a/b/c` is not a regexp with the flags "c".
        ["/a/b/c", { kind: "match", value: "/a/b/c" }]
    ];

    for (const [input, expected] of sniffed) {
        it(`reads ${input} as ${expected.kind}`, () => {
            expect(ruleFromString(input)).toEqual(expected);
        });
    }

    it("defaults a bare string to a match rule, as skin.json does", () => {
        expect(ruleFromString("example.com").kind).toBe("match");
    });

    it("honours defaultKind for anything that is not pattern-shaped", () => {
        expect(ruleFromString("*example.com*", { defaultKind: "glob" })).toEqual({
            kind: "glob",
            value: "*example.com*"
        });
        expect(ruleFromString("*://*.example.com/*", { defaultKind: "glob" }).kind).toBe("match");
        expect(ruleFromString("/foo/", { defaultKind: "glob" }).kind).toBe("regexp");
    });

    it("normalizes an already-typed rule", () => {
        expect(ruleFromString({ kind: " MATCH ", value: " *://a.com/* " })).toEqual({
            kind: "match",
            value: "*://a.com/*"
        });
        expect(ruleFromString({ kind: "URL-Prefix", value: "https://a.com/" }).kind).toBe("url-prefix");
    });

    it("keeps flags only on a regexp", () => {
        expect(ruleFromString({ kind: "glob", value: "x", flags: "i" })).toEqual({ kind: "glob", value: "x" });
        expect(ruleFromString({ kind: "regexp", value: "x", flags: "i" }).flags).toBe("i");
    });

    it("trims the surrounding whitespace of a bare string", () => {
        expect(ruleFromString("  *://a.com/*  ")).toEqual({ kind: "match", value: "*://a.com/*" });
    });

    for (const value of ["", "   ", null, undefined, 42, [], {}, { kind: "match" }, { kind: "match", value: "" }]) {
        it(`refuses ${JSON.stringify(value) ?? String(value)}`, () => {
            expect(() => ruleFromString(value)).toThrow(SkinParseError);
        });
    }

    it("refuses an unknown kind", () => {
        expect(() => ruleFromString({ kind: "regex", value: "x" })).toThrow(/unknown rule kind/);
    });
});

describe("compileRule", () => {
    it("returns the normalized rule alongside the test function", () => {
        const rule = compileRule("  *://*.example.com/*  ");
        expect(rule.kind).toBe("match");
        expect(rule.value).toBe("*://*.example.com/*");
        expect(typeof rule.test).toBe("function");
        expect(rule.flags).toBeUndefined();
        expect(compileRule("/foo/i").flags).toBe("i");
    });

    it("says no to a URL it cannot parse rather than throwing", () => {
        const rule = compileRule("*://*.example.com/*");
        for (const url of ["", "not a url", null, undefined, 42]) expect(rule.test(url)).toBe(false);
    });
});

describe("compileTargets", () => {
    it("matches when an include matches and no exclude does", () => {
        const compiled = compileTargets({
            include: ["*://news.ycombinator.com/*"],
            exclude: ["*://news.ycombinator.com/login*"]
        });
        expect(compiled.errors).toEqual([]);
        expect(compiled.test("https://news.ycombinator.com/item?id=1")).toBe(true);
        expect(compiled.test("https://news.ycombinator.com/login?goto=news")).toBe(false);
        expect(compiled.test("https://example.com/")).toBe(false);
    });

    it("lets an exclude override every include", () => {
        const compiled = compileTargets({
            include: ["<all_urls>", "*://*.example.com/*"],
            exclude: [{ kind: "domain", value: "bank.example.com" }]
        });
        expect(compiled.test("https://example.com/")).toBe(true);
        expect(compiled.test("https://bank.example.com/")).toBe(false);
        expect(compiled.test("https://a.bank.example.com/")).toBe(false);
    });

    for (const targets of [{}, undefined, null, { include: [] }, { include: [], exclude: ["<all_urls>"] }]) {
        it(`matches nothing with include ${JSON.stringify(targets)}`, () => {
            const compiled = compileTargets(targets);
            expect(compiled.test("https://example.com/")).toBe(false);
            expect(compiled.test("http://localhost/")).toBe(false);
        });
    }

    it("collects a broken rule instead of throwing, and keeps the rest working", () => {
        const compiled = compileTargets({
            include: ["*://*.example.com/*", { kind: "regexp", value: "^https://(" }, "*://*.other.com/*"],
            exclude: ["not-a-pattern-at-all"]
        });

        expect(compiled.errors).toHaveLength(2);
        expect(compiled.errors[0].field).toBe("include[1]");
        expect(compiled.errors[0].message).toMatch(/does not compile/);
        expect(compiled.errors[1].field).toBe("exclude[0]");

        // The two good includes still match, and the broken exclude excludes nothing.
        expect(compiled.include).toHaveLength(2);
        expect(compiled.exclude).toHaveLength(0);
        expect(compiled.test("https://example.com/")).toBe(true);
        expect(compiled.test("https://other.com/")).toBe(true);
    });

    it("reports a rule of the wrong type rather than crashing", () => {
        const compiled = compileTargets({ include: [null, 42, { kind: "nope", value: "x" }] });
        expect(compiled.errors).toHaveLength(3);
        expect(compiled.test("https://example.com/")).toBe(false);
    });

    it("ignores a non-array include", () => {
        expect(compileTargets({ include: "*://*/*" }).test("https://example.com/")).toBe(false);
    });

    it("says no to anything that is not a URL string", () => {
        const compiled = compileTargets({ include: ["<all_urls>"] });
        for (const url of ["", null, undefined, 42, {}]) expect(compiled.test(url)).toBe(false);
    });
});

describe("matchesTargets", () => {
    const targets = { include: ["*://*.example.com/*"], exclude: ["*://*.example.com/login*"] };

    it("answers the same on a warm cache as on a cold one", () => {
        expect(matchesTargets(targets, "https://example.com/a")).toBe(true);
        expect(matchesTargets(targets, "https://example.com/a")).toBe(true);
        expect(matchesTargets(targets, "https://example.com/login")).toBe(false);
        expect(matchesTargets(targets, "https://evil.com/?q=example.com")).toBe(false);
    });

    it("does not share a compilation between two objects", () => {
        expect(matchesTargets({ include: ["*://a.com/*"] }, "https://a.com/")).toBe(true);
        expect(matchesTargets({ include: ["*://b.com/*"] }, "https://a.com/")).toBe(false);
    });

    it("matches nothing when there are no targets at all", () => {
        expect(matchesTargets(null, "https://example.com/")).toBe(false);
        expect(matchesTargets(undefined, "https://example.com/")).toBe(false);
    });
});

describe("describeTargets", () => {
    const summaries = [
        [{ include: ["*://news.ycombinator.com/*"] }, "news.ycombinator.com"],
        [{ include: ["*://*.example.com/*"] }, "example.com"],
        [{ include: [{ kind: "domain", value: "example.com" }] }, "example.com"],
        [{ include: [{ kind: "url", value: "https://example.com/page" }] }, "example.com"],
        // Two rules, one host.
        [{ include: ["*://*.example.com/*", "*://example.com/admin/*"] }, "example.com"],
        [{ include: ["*://a.com/*", "*://b.com/*", { kind: "domain", value: "c.com" }] }, "3 sites"],
        [{ include: ["<all_urls>"] }, "everywhere"],
        [{ include: ["*://*/*"] }, "everywhere"],
        [{ include: ["*://*.example.com/*", "<all_urls>"] }, "everywhere"],
        [{ include: [{ kind: "glob", value: "*" }] }, "everywhere"],
        // A regexp names no host, so it can only be counted.
        [{ include: [{ kind: "regexp", value: "^https://x\\.com/" }] }, "1 site"],
        [{ include: [{ kind: "regexp", value: "^https://x\\.com/" }, "*://a.com/*"] }, "2 sites"],
        [{ include: [] }, "nothing"],
        [undefined, "nothing"]
    ];

    for (const [targets, expected] of summaries) {
        it(`describes ${JSON.stringify(targets)} as "${expected}"`, () => {
            expect(describeTargets(targets)).toBe(expected);
        });
    }
});

describe("originPatterns", () => {
    const permissions = [
        [{ include: ["*://*.example.com/*"] }, ["*://*.example.com/*"]],
        [{ include: ["https://example.com/a/b"] }, ["https://example.com/*"]],
        [{ include: ["<all_urls>"] }, ["<all_urls>"]],
        [{ include: ["file:///Users/x/*"] }, ["file:///*"]],
        [{ include: [{ kind: "domain", value: "example.com" }] }, ["*://*.example.com/*"]],
        [{ include: [{ kind: "url", value: "https://example.com/page" }] }, ["https://example.com/*"]],
        [{ include: [{ kind: "url-prefix", value: "https://example.com/docs/" }] }, ["https://example.com/*"]],
        [{ include: [{ kind: "glob", value: "https://*.example.com/x*" }] }, ["https://*.example.com/*"]],
        // Deduplicated, in the order the rules were written.
        [
            { include: ["*://*.b.com/*", "*://*.a.com/*", "*://*.b.com/admin/*"] },
            ["*://*.b.com/*", "*://*.a.com/*"]
        ],
        // Nothing to ask permission for.
        [{ include: [] }, []],
        [undefined, []],
        // A rule that cannot be narrowed takes the whole set with it.
        [{ include: [{ kind: "regexp", value: "^https://x\\.com/" }] }, ["<all_urls>"]],
        [{ include: ["*://*.example.com/*", { kind: "regexp", value: "^https://x\\.com/" }] }, ["<all_urls>"]],
        [{ include: [{ kind: "glob", value: "*example.com*" }] }, ["<all_urls>"]],
        [{ include: [{ kind: "glob", value: "https://a*.example.com/*" }] }, ["<all_urls>"]],
        [{ include: ["*://*.example.com/*", "<all_urls>"] }, ["<all_urls>"]]
    ];

    for (const [targets, expected] of permissions) {
        it(`covers ${JSON.stringify(targets)} with ${JSON.stringify(expected)}`, () => {
            expect(originPatterns(targets)).toEqual(expected);
        });
    }

    it("asks for nothing on behalf of a rule that did not compile", () => {
        expect(originPatterns({ include: ["*://*.example.com/*", "*://broken.example.com"] })).toEqual([
            "*://*.example.com/*"
        ]);
    });

    it("produces patterns that the pattern parser itself accepts", () => {
        const targets = {
            include: [
                "*://*.example.com/*",
                { kind: "domain", value: "other.test" },
                { kind: "url", value: "https://third.test/page" }
            ]
        };
        for (const pattern of originPatterns(targets)) {
            expect(compileRule({ kind: "match", value: pattern }).kind).toBe("match");
        }
    });
});
