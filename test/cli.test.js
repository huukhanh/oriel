/**
 * tools/oriel/ is a separate product surface (a desktop CLI) sharing this
 * repo's test runner. Everything here imports the CLI's modules directly and
 * drives them in-process — a spawned child process is reserved for the one
 * thing that actually requires it, `--help` from the real entry point.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs, ArgError } from "../tools/oriel/src/args.js";
import { run as runInit } from "../tools/oriel/src/commands/init.js";
import { run as runCheck } from "../tools/oriel/src/commands/check.js";
import { run as runBundle } from "../tools/oriel/src/commands/bundle.js";
import { run as runPublish, parseGitHubRemote } from "../tools/oriel/src/commands/publish.js";

const tempDirs = [];
function tempDir(prefix = "oriel-cli-test-") {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

/** Every command writes through log.js, which writes straight to the real streams. */
async function capture(fn) {
    const outChunks = [];
    const errChunks = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk) => { outChunks.push(String(chunk)); return true; };
    process.stderr.write = (chunk) => { errChunks.push(String(chunk)); return true; };
    try {
        const code = await fn();
        return { code, stdout: outChunks.join(""), stderr: errChunks.join("") };
    } finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
    }
}

function git(cwd, args) {
    execFileSync("git", args, { cwd, stdio: "pipe" });
}

// --- args.js ----------------------------------------------------------------

describe("args.js", () => {
    const spec = { flags: { name: "string", force: "boolean", port: "string" } };

    it("parses --flag value", () => {
        const { flags } = parseArgs(["--name", "foo"], spec);
        expect(flags.name).toBe("foo");
    });

    it("parses --flag=value", () => {
        const { flags } = parseArgs(["--name=foo"], spec);
        expect(flags.name).toBe("foo");
    });

    it("parses a boolean flag with no value", () => {
        const { flags } = parseArgs(["--force"], spec);
        expect(flags.force).toBe(true);
    });

    it("collects positionals", () => {
        const { positional } = parseArgs(["a", "--name", "foo", "b"], spec);
        expect(positional).toEqual(["a", "b"]);
    });

    it("treats everything after -- as positional", () => {
        const { positional, flags } = parseArgs(["a", "--", "--name", "--force"], spec);
        expect(positional).toEqual(["a", "--name", "--force"]);
        expect(flags).toEqual({});
    });

    it("rejects an unknown flag", () => {
        expect(() => parseArgs(["--nope"], spec)).toThrow(ArgError);
    });

    it("rejects a boolean flag given a value with =", () => {
        expect(() => parseArgs(["--force=yes"], spec)).toThrow(ArgError);
    });

    it("rejects a string flag with nothing after it", () => {
        expect(() => parseArgs(["--name"], spec)).toThrow(ArgError);
    });
});

// --- init ---------------------------------------------------------------------

describe("oriel init", () => {
    it("writes the usercss template", async () => {
        const dir = tempDir();
        const { code } = await capture(() => runInit([dir, "--name", "My Skin", "--match", "*://foo.example.com/*"]));
        expect(code).toBe(0);
        expect(existsSync(path.join(dir, "skin.user.css"))).toBe(true);
        expect(existsSync(path.join(dir, "README.md"))).toBe(true);
        expect(existsSync(path.join(dir, ".gitignore"))).toBe(true);

        const css = readFileSync(path.join(dir, "skin.user.css"), "utf8");
        expect(css).toContain("@name           My Skin");
        expect(css).toContain("@-moz-document domain(\"foo.example.com\")");
    });

    it("writes the bundle template", async () => {
        const dir = tempDir();
        const { code } = await capture(() => runInit([dir, "--name", "My Bundle", "--format", "bundle"]));
        expect(code).toBe(0);
        for (const file of ["skin.json", "style.css", "layout.dom.json", "enhance.js", "README.md", ".gitignore"]) {
            expect(existsSync(path.join(dir, file))).toBe(true);
        }
        const manifest = JSON.parse(readFileSync(path.join(dir, "skin.json"), "utf8"));
        expect(manifest.name).toBe("My Bundle");
        expect(Array.isArray(manifest.matches)).toBe(true);
    });

    it("refuses a non-empty directory without --force", async () => {
        const dir = tempDir();
        writeFileSync(path.join(dir, "existing.txt"), "hi");
        const { code, stderr } = await capture(() => runInit([dir, "--name", "X"]));
        expect(code).toBe(1);
        expect(stderr).toMatch(/not empty/);
        expect(existsSync(path.join(dir, "skin.user.css"))).toBe(false);
    });

    it("writes into a non-empty directory with --force", async () => {
        const dir = tempDir();
        writeFileSync(path.join(dir, "existing.txt"), "hi");
        const { code } = await capture(() => runInit([dir, "--name", "X", "--force"]));
        expect(code).toBe(0);
        expect(existsSync(path.join(dir, "skin.user.css"))).toBe(true);
    });
});

// --- check ----------------------------------------------------------------

describe("oriel check", () => {
    it("passes a clean bundle skin", async () => {
        const dir = tempDir();
        writeFileSync(
            path.join(dir, "skin.json"),
            JSON.stringify({
                name: "Clean",
                matches: ["*://example.com/*"],
                css: ["style.css"],
                vars: [{ key: "accent", type: "color", label: "Accent", default: "#ff0000" }]
            })
        );
        writeFileSync(path.join(dir, "style.css"), ":root{--accent:/*[[accent]]*/;}");
        const { code, stdout } = await capture(() => runCheck([dir]));
        expect(code).toBe(0);
        expect(stdout).toMatch(/no problems/);
    });

    it("catches every class of error in one broken skin", async () => {
        const dir = tempDir();
        writeFileSync(
            path.join(dir, "skin.json"),
            JSON.stringify({
                // no "name"
                matches: ["not a valid pattern"],
                css: ["missing.css", { text: "body{color:/*[[undeclared]]*/;}" }],
                dom: [
                    { op: "bogusOp" },
                    { op: "wrap", select: ".x" } // missing required "with"
                ],
                js: [{ text: "1", world: "spaceship" }],
                vars: [
                    { key: "n", type: "number", label: "N", default: 100, min: 0, max: 10 },
                    { key: "t", type: "not-a-real-type", label: "T", default: "x" }
                ]
            })
        );
        const { code } = await capture(() => runCheck([dir, "--json"]));
        expect(code).toBe(1);

        const { loaded } = await loadFixture(dir);
        const messages = loaded.diagnostics.map((d) => d.message).join("\n");

        expect(messages).toMatch(/missing "name"/);
        expect(messages).toMatch(/must be written|not a valid/); // bad target rule
        expect(messages).toMatch(/referenced file does not exist/);
        expect(messages).toMatch(/CSS references var "undeclared"/);
        expect(messages).toMatch(/unknown op/);
        expect(messages).toMatch(/is required/); // dom op missing its required field
        expect(messages).toMatch(/unknown world "spaceship"/);
        expect(messages).toMatch(/unknown var type "not-a-real-type"/);
        expect(messages).toMatch(/is above max/);
    });

    it("catches empty targets", async () => {
        const dir = tempDir();
        writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ name: "Nowhere", css: [{ text: "body{}" }] }));
        const { code } = await capture(() => runCheck([dir, "--json"]));
        expect(code).toBe(1);
        const { loaded } = await loadFixture(dir);
        expect(loaded.diagnostics.map((d) => d.message).join("\n")).toMatch(/missing or empty targets/);
    });

    it("catches a gallery index.json whose install and path disagree", async () => {
        const dir = tempDir();
        writeFileSync(path.join(dir, "real.json"), JSON.stringify({ name: "Real", matches: ["*://x.com/*"], css: [{ text: "body{}" }] }));
        writeFileSync(
            path.join(dir, "index.json"),
            JSON.stringify([
                { id: "a", name: "A", path: "real.json", install: "https://raw.githubusercontent.com/x/y/main/wrong.json" },
                { id: "b", name: "B", path: "missing.json", install: "https://raw.githubusercontent.com/x/y/main/missing.json" }
            ])
        );
        const cwd = process.cwd();
        process.chdir(dir);
        let result;
        try {
            result = await capture(() => runCheck(["index.json"]));
        } finally {
            process.chdir(cwd);
        }
        expect(result.code).toBe(1);
        expect(result.stdout).toMatch(/disagree/);
        expect(result.stdout).toMatch(/does not exist: missing\.json/);
    });

    it("passes a gallery index.json whose entries agree", async () => {
        const dir = tempDir();
        writeFileSync(path.join(dir, "real.json"), JSON.stringify({ name: "Real", matches: ["*://x.com/*"], css: [{ text: "body{}" }] }));
        writeFileSync(
            path.join(dir, "index.json"),
            JSON.stringify([{ id: "a", name: "A", path: "real.json", install: "https://raw.githubusercontent.com/x/y/main/real.json" }])
        );
        const cwd = process.cwd();
        process.chdir(dir);
        let result;
        try {
            result = await capture(() => runCheck(["index.json"]));
        } finally {
            process.chdir(cwd);
        }
        expect(result.code).toBe(0);
    });

    it("checks the repo's own example skins and gallery index", async () => {
        const repoRoot = path.resolve(import.meta.dirname, "..");
        const { code } = await capture(() =>
            runCheck([
                path.join(repoRoot, "skins/hn-rebuilt"),
                path.join(repoRoot, "skins/reader"),
                path.join(repoRoot, "skins/dim"),
                path.join(repoRoot, "skins/index.json")
            ])
        );
        expect(code).toBe(0);
    });
});

async function loadFixture(dir) {
    const { loadCore } = await import("../tools/oriel/src/core.js");
    const { loadSkin } = await import("../tools/oriel/src/skin-loader.js");
    const core = await loadCore();
    return { loaded: await loadSkin(dir, core) };
}

// --- bundle -----------------------------------------------------------------

describe("oriel bundle", () => {
    it("inlines a path-referenced stylesheet and reports size", async () => {
        const dir = tempDir();
        writeFileSync(
            path.join(dir, "skin.json"),
            JSON.stringify({ name: "Bundled", matches: ["*://example.com/*"], css: ["style.css"] })
        );
        writeFileSync(path.join(dir, "style.css"), "body { color: red; }");
        const out = path.join(dir, "out.json");

        const { code, stdout } = await capture(() => runBundle([dir, "--out", out]));
        expect(code).toBe(0);
        expect(stdout).toMatch(/wrote .* \(\d/);

        const wire = JSON.parse(readFileSync(out, "utf8"));
        expect(wire.css[0].text).toContain("color: red");
        expect(wire.css[0]).not.toHaveProperty("path");
    });

    it("inlines an asset as a data URL and warns above 512KB", async () => {
        const dir = tempDir();
        writeFileSync(
            path.join(dir, "skin.json"),
            JSON.stringify({
                name: "Heavy",
                matches: ["*://example.com/*"],
                css: [{ text: "body{}" }],
                assets: { big: "big.png" }
            })
        );
        writeFileSync(path.join(dir, "big.png"), Buffer.alloc(400_000, 1));
        const out = path.join(dir, "out.json");

        const { code, stderr } = await capture(() => runBundle([dir, "--out", out]));
        expect(code).toBe(0);
        expect(stderr).toMatch(/512KB|a lot to hold/);

        const wire = JSON.parse(readFileSync(out, "utf8"));
        expect(wire.assets.big).toMatch(/^data:image\/png;base64,/);
    });

    it("refuses to bundle a broken skin", async () => {
        const dir = tempDir();
        writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ css: [{ text: "body{}" }] })); // no name, no matches
        const { code, stderr } = await capture(() => runBundle([dir]));
        expect(code).toBe(1);
        expect(stderr).toMatch(/cannot bundle/);
    });
});

// --- publish ------------------------------------------------------------------

describe("oriel publish", () => {
    function initGitSkin(remoteUrl) {
        const dir = tempDir();
        git(dir, ["init", "-q", "-b", "main"]);
        if (remoteUrl) git(dir, ["remote", "add", "origin", remoteUrl]);
        writeFileSync(
            path.join(dir, "skin.user.css"),
            [
                "/* ==UserStyle==",
                "@name           Pub Test",
                "@version        1.0.0",
                "@updateURL      https://raw.githubusercontent.com/wrong/repo/main/skin.user.css",
                "==/UserStyle== */",
                "",
                '@-moz-document domain("example.com") {',
                "  body { color: red; }",
                "}"
            ].join("\n")
        );
        return dir;
    }

    it("parses github remotes in ssh and https form", () => {
        expect(parseGitHubRemote("git@github.com:someone/theirskin.git")).toEqual({ owner: "someone", repo: "theirskin" });
        expect(parseGitHubRemote("https://github.com/someone/theirskin.git")).toEqual({ owner: "someone", repo: "theirskin" });
        expect(parseGitHubRemote("https://gitlab.com/someone/theirskin.git")).toBeNull();
    });

    it("flags a wrong updateURL", async () => {
        const dir = initGitSkin("git@github.com:someone/theirskin.git");
        const { code, stdout, stderr } = await capture(() => runPublish([dir]));
        expect(code).toBe(1);
        expect(stderr).toMatch(/points somewhere other than this repo/);
        expect(stdout + stderr).toContain("https://raw.githubusercontent.com/someone/theirskin/main/skin.user.css");
    });

    it("confirms a correct updateURL", async () => {
        const dir = tempDir();
        git(dir, ["init", "-q", "-b", "main"]);
        git(dir, ["remote", "add", "origin", "git@github.com:someone/theirskin.git"]);
        writeFileSync(
            path.join(dir, "skin.user.css"),
            [
                "/* ==UserStyle==",
                "@name           Pub Test",
                "@version        1.0.0",
                "@updateURL      https://raw.githubusercontent.com/someone/theirskin/main/skin.user.css",
                "==/UserStyle== */",
                "",
                '@-moz-document domain("example.com") {',
                "  body { color: red; }",
                "}"
            ].join("\n")
        );
        const { code, stdout } = await capture(() => runPublish([dir]));
        expect(code).toBe(0);
        expect(stdout).toMatch(/updateURL is correct/);
    });

    it("warns instead of failing when there is no git repository at all", async () => {
        const dir = tempDir();
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            path.join(dir, "skin.user.css"),
            [
                "/* ==UserStyle==",
                "@name           No Repo",
                "@version        1.0.0",
                "==/UserStyle== */",
                "",
                '@-moz-document domain("example.com") {',
                "  body { color: red; }",
                "}"
            ].join("\n")
        );
        const { code, stderr } = await capture(() => runPublish([dir]));
        expect(code).toBe(0);
        expect(stderr).toMatch(/not inside a git repository/);
    });
});

// --- the real entry point ----------------------------------------------------

describe("bin/oriel.js --help", () => {
    it("prints usage and exits 0", () => {
        const binPath = path.resolve(import.meta.dirname, "..", "tools/oriel/bin/oriel.js");
        const output = execFileSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });
        expect(output).toMatch(/oriel <command>/);
        expect(output).toMatch(/init/);
        expect(output).toMatch(/publish/);
    });
});
