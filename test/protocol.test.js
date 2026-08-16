import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE, UI, EVENT, KEY, DEFAULT_SETTINGS } from "../hosts/extension/shared/protocol.js";

/**
 * The message boundary, checked statically.
 *
 * `background/main.js` cannot be imported here — it registers a listener on
 * `chrome.runtime` at module load, and there is no `chrome` in Node. So this
 * reads it as text. That is cruder than importing it and worth it: the failure
 * this catches is a UI page sending a message no handler answers, which
 * produces no error anywhere, just a control that does nothing when tapped. It
 * is the single most likely way to break this extension silently.
 */
const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const background = read("hosts/extension/background/main.js");

/** Every `[UI.FOO]` / `[PAGE.FOO]` key in the handler table. */
function handlerNames(source) {
    return new Set([...source.matchAll(/async\s+\[(UI|PAGE)\.([A-Z_]+)\]/g)].map((m) => `${m[1]}.${m[2]}`));
}

/** Every `UI.FOO` / `PAGE.FOO` / `EVENT.FOO` mentioned in a file. */
function referenced(source) {
    return new Set([...source.matchAll(/\b(UI|PAGE|EVENT)\.([A-Z_]+)\b/g)].map((m) => `${m[1]}.${m[2]}`));
}

const TABLES = { UI, PAGE, EVENT };

function isDeclared(name) {
    const [table, key] = name.split(".");
    return Object.hasOwn(TABLES[table], key);
}

describe("the message protocol", () => {
    it("has no two messages sharing a wire name", () => {
        const values = [...Object.values(PAGE), ...Object.values(UI), ...Object.values(EVENT)];
        expect(new Set(values).size).toBe(values.length);
    });

    it("names every message after the table it lives in", () => {
        // The prefix is what lets the build and these tests tell a UI message
        // from a page message without a lookup table of their own.
        for (const value of Object.values(PAGE)) expect(value).toMatch(/^page\./);
        for (const value of Object.values(UI)) expect(value).toMatch(/^ui\./);
        for (const value of Object.values(EVENT)) expect(value).toMatch(/^event\./);
    });

    it("answers every message the UI and the content script send", () => {
        const handlers = handlerNames(background);
        const senders = [
            "browser/ui/manager.js",
            "browser/ui/popup.js",
            "browser/ui/views.js",
            "browser/ui/rpc.js",
            "engine/runtime/main.js",
            "engine/runtime/styles.js",
            "engine/runtime/oriel-api.js"
        ];

        const unanswered = [];
        for (const file of senders) {
            for (const name of referenced(read(file))) {
                if (name.startsWith("EVENT.")) continue; // broadcast, not a request
                if (!handlers.has(name)) unanswered.push(`${file} sends ${name}, which no handler answers`);
            }
        }
        expect(unanswered).toEqual([]);
    });

    it("declares every constant the background dispatches on", () => {
        const undeclared = [...referenced(background)].filter((name) => !isDeclared(name));
        expect(undeclared).toEqual([]);
    });

    it("declares every constant the UI and content script reach for", () => {
        const files = [
            "browser/ui/manager.js",
            "browser/ui/popup.js",
            "browser/ui/views.js",
            "engine/runtime/main.js",
            "engine/runtime/oriel-api.js"
        ];
        const undeclared = [];
        for (const file of files) {
            for (const name of referenced(read(file))) {
                if (!isDeclared(name)) undeclared.push(`${file}: ${name}`);
            }
        }
        expect(undeclared).toEqual([]);
    });

    it("has a handler for every request message it declares", () => {
        // The other direction: a message declared and documented but never
        // wired up is a feature that looks finished in the protocol and is not.
        const handlers = handlerNames(background);
        const missing = [
            ...Object.keys(PAGE).map((k) => `PAGE.${k}`),
            ...Object.keys(UI).map((k) => `UI.${k}`)
        ].filter((name) => !handlers.has(name));
        expect(missing).toEqual([]);
    });
});

describe("storage keys", () => {
    it("namespaces every per-skin key, so one skin cannot read another's", () => {
        for (const build of [KEY.body, KEY.values, KEY.store]) {
            expect(build("abc")).toMatch(/^[a-z]+:abc$/);
        }
        expect(new Set([KEY.body("x"), KEY.values("x"), KEY.store("x")]).size).toBe(3);
    });

    it("keeps the index out of the per-skin namespace", () => {
        // One `storage.get(KEY.INDEX)` answers "does anything apply to this
        // URL?" on every page load. A key that collided with a skin id would
        // make that read return a skin body.
        expect(KEY.INDEX).not.toContain(":");
        for (const flat of [KEY.SETTINGS, KEY.LOG, KEY.CAPS]) expect(flat).not.toContain(":");
    });
});

describe("default settings", () => {
    it("does not check for updates more often than weekly by default", () => {
        expect(DEFAULT_SETTINGS.updateCheck).toBe("weekly");
    });

    it("stays out of subframes unless asked", () => {
        // Most frames on the web are advertising and tracking. Skinning them by
        // default costs work on every page and buys nothing.
        expect(DEFAULT_SETTINGS.allowFrames).toBe(false);
    });

    it("bounds the log", () => {
        expect(DEFAULT_SETTINGS.logLimit).toBeGreaterThan(0);
        expect(DEFAULT_SETTINGS.logLimit).toBeLessThanOrEqual(1000);
    });
});
