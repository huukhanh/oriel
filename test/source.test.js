/**
 * `core/source.js` is URL algebra only, but the algebra is the whole safety
 * story for "import a skin from a link": get the candidate order wrong and a
 * common install pays for an API round trip it never needed; get a refusal
 * wrong and a `javascript:`/`data:`/credentialed URL gets fetched. So this
 * file asserts the full ordered `candidates` array for the common shapes
 * (order is a promise `background/install.js` relies on) and gives every
 * refusal its own `it`, one URL each.
 */

import { describe, it, expect } from "vitest";
import {
    looksLikeLocator,
    resolveLocator,
    deriveUpdateURL,
    humanURL,
    SKIN_FILENAMES,
    isSkinFilename
} from "../extension/src/core/source.js";

// --- looksLikeLocator --------------------------------------------------------

describe("looksLikeLocator", () => {
    const yes = [
        "https://github.com/octocat/Hello-World",
        "https://github.com/octocat/Hello-World/blob/main/hn.user.css",
        "https://raw.githubusercontent.com/octocat/Hello-World/main/hn.user.css",
        "https://gist.github.com/octocat/abcdef1234",
        "http://example.com/x.css",
        "octocat/Hello-World",
        "octocat/Hello-World@v2",
        "octocat/Hello-World@v2/skins/hn.user.css",
        // These "look like" a locator; resolveLocator is what refuses them, with a reason.
        "javascript:alert(1)",
        "data:text/css,body{color:red}",
        "file:///etc/passwd"
    ];
    const no = [
        "",
        "   ",
        "a{color:red}",
        "body { color: red; }",
        "/* see https://github.com/o/r for source */\nbody{color:red}",
        "// https://github.com/o/r\nbody{color:red}",
        '@-moz-document domain("example.com") {\n  body{color:red}\n}',
        '{"id":"x"}',
        "octocat/Hello World" // a space makes it two tokens, not one shorthand
    ];

    for (const text of yes) {
        it(`is true for ${JSON.stringify(text)}`, () => expect(looksLikeLocator(text)).toBe(true));
    }
    for (const text of no) {
        it(`is false for ${JSON.stringify(text)}`, () => expect(looksLikeLocator(text)).toBe(false));
    }

    it("is false for non-string input", () => {
        expect(looksLikeLocator(undefined)).toBe(false);
        expect(looksLikeLocator(null)).toBe(false);
    });
});

// --- SKIN_FILENAMES / isSkinFilename -----------------------------------------

describe("SKIN_FILENAMES / isSkinFilename", () => {
    it("ranks the manifest before the stylesheet", () => {
        expect(SKIN_FILENAMES.indexOf("skin.json")).toBeLessThan(SKIN_FILENAMES.indexOf("skin.user.css"));
    });

    it("accepts the manifest name and any *.user.css file", () => {
        expect(isSkinFilename("skin.json")).toBe(true);
        expect(isSkinFilename("skin.user.css")).toBe(true);
        expect(isSkinFilename("hn.user.css")).toBe(true);
        expect(isSkinFilename("HN.USER.CSS")).toBe(true);
    });

    it("rejects everything else", () => {
        expect(isSkinFilename("readme.md")).toBe(false);
        expect(isSkinFilename("skin.css")).toBe(false);
        expect(isSkinFilename("")).toBe(false);
        expect(isSkinFilename(undefined)).toBe(false);
    });
});

// --- the four most common inputs: full ordered candidates --------------------

describe("resolveLocator — full ordered candidates for the common inputs", () => {
    it("a blob URL: one raw candidate, no API round trip", () => {
        const resolved = resolveLocator("https://github.com/octocat/Hello-World/blob/main/hn.user.css");
        expect(resolved.kind).toBe("github-file");
        expect(resolved.owner).toBe("octocat");
        expect(resolved.repo).toBe("Hello-World");
        expect(resolved.ref).toBe("main");
        expect(resolved.path).toBe("hn.user.css");
        expect(resolved.candidates).toEqual([
            {
                url: "https://raw.githubusercontent.com/octocat/Hello-World/main/hn.user.css",
                via: "raw",
                expects: "skin",
                note: 'assuming ref "main"; if the branch name itself contains "/", edit the ref'
            }
        ]);
    });

    it("a repo root: raw guesses first, then the three API listings", () => {
        const resolved = resolveLocator("https://github.com/octocat/Hello-World");
        expect(resolved.kind).toBe("github-repo");
        expect(resolved.ref).toBe("HEAD");
        expect(resolved.candidates).toEqual([
            { url: "https://raw.githubusercontent.com/octocat/Hello-World/HEAD/skin.json", via: "raw", expects: "skin" },
            {
                url: "https://raw.githubusercontent.com/octocat/Hello-World/HEAD/skin.user.css",
                via: "raw",
                expects: "skin"
            },
            {
                url: "https://api.github.com/repos/octocat/Hello-World/contents?ref=HEAD",
                via: "api",
                expects: "listing",
                note: "listing the repository root"
            },
            {
                url: "https://api.github.com/repos/octocat/Hello-World/contents/skins?ref=HEAD",
                via: "api",
                expects: "listing",
                note: "listing skins/"
            },
            {
                url: "https://api.github.com/repos/octocat/Hello-World/contents/styles?ref=HEAD",
                via: "api",
                expects: "listing",
                note: "listing styles/"
            }
        ]);
    });

    it("owner/repo shorthand resolves exactly like the equivalent github.com URL", () => {
        const shorthand = resolveLocator("octocat/Hello-World");
        const url = resolveLocator("https://github.com/octocat/Hello-World");
        expect(shorthand.kind).toBe("github-repo");
        expect(shorthand.candidates).toEqual(url.candidates);
    });

    it("a gist: the raw single-file guess before the API listing", () => {
        const resolved = resolveLocator("https://gist.github.com/octocat/abcdef1234567890");
        expect(resolved.kind).toBe("gist");
        expect(resolved.gistId).toBe("abcdef1234567890");
        expect(resolved.candidates).toEqual([
            {
                url: "https://gist.githubusercontent.com/octocat/abcdef1234567890/raw/",
                via: "raw",
                expects: "skin",
                note: "guessing the gist has a single file"
            },
            {
                url: "https://api.github.com/gists/abcdef1234567890",
                via: "api",
                expects: "listing",
                note: "listing the gist's files"
            }
        ]);
    });
});

// --- every other form from the table -----------------------------------------

describe("resolveLocator — other forms", () => {
    it("blob URL: ?plain=1#L3 is dropped, same result as the bare blob URL", () => {
        const withQuery = resolveLocator("https://github.com/octocat/Hello-World/blob/main/hn.user.css?plain=1#L3");
        const bare = resolveLocator("https://github.com/octocat/Hello-World/blob/main/hn.user.css");
        expect(withQuery.candidates).toEqual(bare.candidates);
        expect(withQuery.kind).toBe("github-file");
    });

    it("a /raw/ blob-style URL resolves the same as /blob/", () => {
        const raw = resolveLocator("https://github.com/octocat/Hello-World/raw/main/hn.user.css");
        const blob = resolveLocator("https://github.com/octocat/Hello-World/blob/main/hn.user.css");
        expect(raw.candidates).toEqual(blob.candidates);
    });

    it("a tree URL with a directory: API listing plus raw guesses under that dir", () => {
        const resolved = resolveLocator("https://github.com/octocat/Hello-World/tree/main/skins");
        expect(resolved.kind).toBe("github-dir");
        expect(resolved.path).toBe("skins");
        expect(resolved.candidates.map((c) => c.url)).toEqual([
            "https://raw.githubusercontent.com/octocat/Hello-World/main/skins/skin.json",
            "https://raw.githubusercontent.com/octocat/Hello-World/main/skins/skin.user.css",
            "https://api.github.com/repos/octocat/Hello-World/contents/skins?ref=main"
        ]);
        expect(resolved.candidates.every((c) => c.expects === (c.via === "api" ? "listing" : "skin"))).toBe(true);
    });

    it("tree/REF with no directory is repo root at that ref, not a directory", () => {
        const resolved = resolveLocator("https://github.com/octocat/Hello-World/tree/v2");
        expect(resolved.kind).toBe("github-repo");
        expect(resolved.ref).toBe("v2");
        expect(resolved.candidates[0].url).toBe("https://raw.githubusercontent.com/octocat/Hello-World/v2/skin.json");
    });

    it("a raw.githubusercontent.com URL resolves to itself", () => {
        const resolved = resolveLocator("https://raw.githubusercontent.com/octocat/Hello-World/main/hn.user.css");
        expect(resolved.kind).toBe("raw");
        expect(resolved.candidates).toEqual([
            {
                url: "https://raw.githubusercontent.com/octocat/Hello-World/main/hn.user.css",
                via: "raw",
                expects: "skin"
            }
        ]);
    });

    it("a gist URL with a #file-… fragment still resolves (fragment ignored)", () => {
        const resolved = resolveLocator("https://gist.github.com/octocat/abcdef1234#file-skin-user-css");
        expect(resolved.kind).toBe("gist");
        expect(resolved.candidates[0].url).toBe("https://gist.githubusercontent.com/octocat/abcdef1234/raw/");
    });

    it("a release asset resolves to itself, flagged as needing a host permission not CORS", () => {
        const resolved = resolveLocator("https://github.com/octocat/Hello-World/releases/download/v1.0/asset.user.css");
        expect(resolved.kind).toBe("release-asset");
        expect(resolved.candidates).toEqual([
            {
                url: "https://github.com/octocat/Hello-World/releases/download/v1.0/asset.user.css",
                via: "raw",
                expects: "skin",
                note: "release asset — fetched via host permission, not CORS"
            }
        ]);
    });

    it("owner/repo@ref/path.css resolves like the equivalent blob URL", () => {
        const shorthand = resolveLocator("octocat/Hello-World@v2/skins/hn.user.css");
        expect(shorthand.kind).toBe("github-file");
        expect(shorthand.candidates[0].url).toBe(
            "https://raw.githubusercontent.com/octocat/Hello-World/v2/skins/hn.user.css"
        );
    });

    it("owner/repo/path.css with no ref defaults to HEAD", () => {
        const shorthand = resolveLocator("octocat/Hello-World/skins/hn.user.css");
        expect(shorthand.ref).toBe("HEAD");
        expect(shorthand.candidates[0].url).toBe(
            "https://raw.githubusercontent.com/octocat/Hello-World/HEAD/skins/hn.user.css"
        );
    });

    it("any other https:// URL: one candidate, as given", () => {
        const resolved = resolveLocator("https://example.com/skins/hn.user.css?v=2");
        expect(resolved.kind).toBe("url");
        expect(resolved.candidates).toEqual([
            { url: "https://example.com/skins/hn.user.css?v=2", via: "raw", expects: "skin" }
        ]);
    });

    it("http:// is allowed and flagged in describe", () => {
        const resolved = resolveLocator("http://example.com/x.css");
        expect(resolved.kind).toBe("url");
        expect(resolved.candidates).toEqual([{ url: "http://example.com/x.css", via: "raw", expects: "skin" }]);
        expect(resolved.describe).toMatch(/http/i);
    });

    it("a ref containing a slash: shortest ref wins, ambiguity noted", () => {
        const resolved = resolveLocator("https://github.com/octocat/Hello-World/blob/feat/x/hn.user.css");
        expect(resolved.ref).toBe("feat");
        expect(resolved.path).toBe("x/hn.user.css");
        expect(resolved.candidates[0].note).toMatch(/feat/);
    });

    it("percent-encodes a path segment that needs it, without double-encoding an already-escaped one", () => {
        const needsEncoding = resolveLocator("https://github.com/octocat/Hello-World/blob/main/a folder/b.user.css");
        expect(needsEncoding.candidates[0].url).toBe(
            "https://raw.githubusercontent.com/octocat/Hello-World/main/a%20folder/b.user.css"
        );

        const alreadyEncoded = resolveLocator("https://github.com/octocat/Hello-World/blob/main/a%20folder/b.user.css");
        expect(alreadyEncoded.candidates[0].url).toBe(
            "https://raw.githubusercontent.com/octocat/Hello-World/main/a%20folder/b.user.css"
        );
    });

    it("strips a trailing slash from an owner/repo shorthand directory", () => {
        const resolved = resolveLocator("octocat/Hello-World@main/skins/");
        expect(resolved.kind).toBe("github-dir");
        expect(resolved.path).toBe("skins");
    });
});

// --- refusals -----------------------------------------------------------------

describe("resolveLocator — refusals", () => {
    const refused = [
        ["javascript:alert(document.cookie)", /javascript/],
        ["data:text/css,body{color:red}", /data/],
        ["file:///etc/passwd", /file/],
        ["https://user:pass@github.com/octocat/Hello-World", /credentials/],
        ["ftp://example.com/x.css", /ftp/],
        ["/* built with love */\nbody { color: red; }", /skin source/],
        ["// see https://github.com/o/r\nbody { color: red; }", /skin source/],
        ['@-moz-document domain("example.com") {\n  body { color: red; }\n}', /skin source/],
        ['{"id":"x","css":[]}', /skin source/],
        ["not a url and not owner/repo", /doesn't|isn't/],
        ["", /nothing/]
    ];

    for (const [text, reason] of refused) {
        it(`refuses ${JSON.stringify(text.slice(0, 40))}`, () => {
            const resolved = resolveLocator(text);
            expect(resolved.kind).toBe("unknown");
            expect(resolved.candidates).toEqual([]);
            expect(resolved.describe).toMatch(reason);
        });
    }
});

// --- deriveUpdateURL ------------------------------------------------------------

describe("deriveUpdateURL", () => {
    it("keeps a raw.githubusercontent.com URL, stripped of query/hash", () => {
        expect(deriveUpdateURL("https://raw.githubusercontent.com/o/r/main/f.user.css?x=1#y")).toBe(
            "https://raw.githubusercontent.com/o/r/main/f.user.css"
        );
    });

    it("keeps a gist.githubusercontent.com URL", () => {
        expect(deriveUpdateURL("https://gist.githubusercontent.com/o/id/raw/f.user.css")).toBe(
            "https://gist.githubusercontent.com/o/id/raw/f.user.css"
        );
    });

    it("returns null for api.github.com — rate-limited, not a stable update source", () => {
        expect(deriveUpdateURL("https://api.github.com/repos/o/r/contents/f.user.css")).toBeNull();
    });

    it("returns null for a generic URL", () => {
        expect(deriveUpdateURL("https://example.com/f.css")).toBeNull();
    });

    it("returns null for an unparseable URL", () => {
        expect(deriveUpdateURL("not a url")).toBeNull();
    });
});

// --- humanURL ------------------------------------------------------------------

describe("humanURL", () => {
    it("turns a raw.githubusercontent.com URL into a blob URL", () => {
        expect(humanURL("https://raw.githubusercontent.com/o/r/main/a/b.user.css")).toBe(
            "https://github.com/o/r/blob/main/a/b.user.css"
        );
    });

    it("turns a gist.githubusercontent.com URL into a gist page", () => {
        expect(humanURL("https://gist.githubusercontent.com/o/id/raw/f.user.css")).toBe("https://gist.github.com/o/id");
    });

    it("turns an api.github.com contents URL into a tree URL", () => {
        expect(humanURL("https://api.github.com/repos/o/r/contents/skins?ref=main")).toBe(
            "https://github.com/o/r/tree/main/skins"
        );
    });

    it("turns an api.github.com gists URL into a gist page", () => {
        expect(humanURL("https://api.github.com/gists/abcdef")).toBe("https://gist.github.com/abcdef");
    });

    it("returns any other URL unchanged", () => {
        expect(humanURL("https://example.com/f.css")).toBe("https://example.com/f.css");
    });

    it("returns null for input that isn't a URL", () => {
        expect(humanURL("not a url")).toBeNull();
    });
});
