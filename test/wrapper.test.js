import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
    wrapForUserScriptWorld,
    API_SURFACE,
    registrationId,
    parseRegistrationId
} from "../engine/core/wrapper.js";

/**
 * This module generates source that will be handed to a browser and executed in
 * a world nothing here can reach. So the tests do the two things that are
 * possible without that browser: assert the text, and *run* it — jsdom is a
 * real JavaScript engine with a real DOM, which is enough to catch a generated
 * string that does not parse or whose API is missing a method.
 */
function evaluate(source, { messages = [] } = {}) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
    dom.window.chrome = {
        runtime: {
            sendMessage(message) {
                messages.push(message);
                return Promise.resolve({ ok: true, value: "stored" });
            }
        }
    };
    dom.window.eval(source);
    return { dom, messages };
}

const base = {
    skinId: "hn-rebuilt",
    name: "Hacker News, rebuilt",
    code: "oriel.log('hello');",
    vars: { accent: "#ff6600", density: 8 }
};

describe("wrapForUserScriptWorld", () => {
    it("produces source that parses and runs", () => {
        const { messages } = evaluate(wrapForUserScriptWorld(base));
        expect(messages).toEqual([
            { type: "page.log", skinId: "hn-rebuilt", level: "info", message: "hello" }
        ]);
    });

    it("offers every method the content script's native API offers", () => {
        const source = wrapForUserScriptWorld({
            ...base,
            code: "globalThis.__surface = Object.keys(oriel);"
        });
        const { dom } = evaluate(source);
        // The same list is implemented twice — natively in content/oriel-api.js
        // and as text here — and a skin cannot tell which one it got. When they
        // drift, a skin works on one browser and throws on another.
        for (const name of API_SURFACE) {
            expect(dom.window.__surface, `missing oriel.${name}`).toContain(name);
        }
    });

    it("freezes the variables it hands over", () => {
        const source = wrapForUserScriptWorld({
            ...base,
            code: "globalThis.__frozen = Object.isFrozen(oriel.vars); globalThis.__accent = oriel.vars.accent;"
        });
        const { dom } = evaluate(source);
        expect(dom.window.__frozen).toBe(true);
        expect(dom.window.__accent).toBe("#ff6600");
    });

    it("catches a throwing skin and reports it rather than letting it escape", () => {
        const messages = [];
        expect(() =>
            evaluate(wrapForUserScriptWorld({ ...base, code: "throw new Error('skin exploded');" }), { messages })
        ).not.toThrow();
        const errors = messages.filter((m) => m.level === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain("skin exploded");
        expect(errors[0].skinId).toBe("hn-rebuilt");
    });

    it("keeps the skin's variables out of the shared world", () => {
        // Every skin Oriel registers for a page lands in the same user-script
        // world. A top-level `var` here would be visible to, and clobberable
        // by, an unrelated skin.
        const source = wrapForUserScriptWorld({ ...base, code: "var mine = 1; globalThis.__leaked = 'no';" });
        const { dom } = evaluate(source);
        expect(dom.window.mine).toBeUndefined();
        expect(dom.window.__leaked).toBe("no");
    });

    it("runs the skin in strict mode, so an accidental global is an error it can attribute", () => {
        const messages = [];
        evaluate(wrapForUserScriptWorld({ ...base, code: "undeclared = 1;" }), { messages });
        const errors = messages.filter((m) => m.level === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toMatch(/undeclared/);
    });

    it("injects CSS through a style element it can take back", () => {
        const source = wrapForUserScriptWorld({
            ...base,
            code: "globalThis.__handle = oriel.css('body { color: red; }');"
        });
        const { dom } = evaluate(source);
        const style = dom.window.document.querySelector("style[data-oriel='hn-rebuilt']");
        expect(style).not.toBeNull();
        expect(style.textContent).toBe("body { color: red; }");

        dom.window.__handle.remove();
        expect(dom.window.document.querySelector("style[data-oriel='hn-rebuilt']")).toBeNull();
    });

    it("undoes its own work when the engine fires the cleanup event", () => {
        // Single-page navigation away from a matching route. The user-script
        // world has no reference back into the content script, so a document
        // event is the only channel that reaches it.
        const source = wrapForUserScriptWorld({
            ...base,
            code: "oriel.css('body{color:red}'); oriel.on('cleanup', () => { globalThis.__cleaned = true; });"
        });
        const { dom } = evaluate(source);
        expect(dom.window.document.querySelector("style[data-oriel='hn-rebuilt']")).not.toBeNull();

        dom.window.dispatchEvent(new dom.window.CustomEvent("oriel:cleanup:hn-rebuilt"));
        expect(dom.window.__cleaned).toBe(true);
        expect(dom.window.document.querySelector("style[data-oriel='hn-rebuilt']")).toBeNull();
    });

    it("hands each matching node to a watcher exactly once", () => {
        const source = wrapForUserScriptWorld({
            ...base,
            code: `globalThis.__seen = 0;
document.body.innerHTML = '<p class="x"></p>';
oriel.watch('.x', () => { globalThis.__seen++; });`
        });
        const { dom } = evaluate(source);
        expect(dom.window.__seen).toBe(1);

        // Re-parenting a node the watcher already saw must not call back again.
        const node = dom.window.document.querySelector(".x");
        dom.window.document.body.append(node);
        expect(dom.window.__seen).toBe(1);
    });

    it("escapes a skin name that would otherwise close the string literal", () => {
        const source = wrapForUserScriptWorld({
            ...base,
            name: `</script><script>alert(1)</script>"'`,
            code: "globalThis.__name = oriel.name;"
        });
        const { dom } = evaluate(source);
        expect(dom.window.__name).toBe(`</script><script>alert(1)</script>"'`);
    });

    it("survives a variable value containing a quote or a backslash", () => {
        const source = wrapForUserScriptWorld({
            ...base,
            vars: { label: `he said "hi"\\` },
            code: "globalThis.__label = oriel.vars.label;"
        });
        const { dom } = evaluate(source);
        expect(dom.window.__label).toBe(`he said "hi"\\`);
    });
});

describe("registration ids", () => {
    it("round-trips", () => {
        expect(parseRegistrationId(registrationId("hn", "js0"))).toEqual({ skinId: "hn", unitId: "js0" });
    });

    it("is namespaced, so a skin id cannot collide with anything else registered", () => {
        expect(registrationId("hn", "js0")).toBe("oriel:hn:js0");
    });

    it("refuses an id it did not mint", () => {
        // Reconciliation unregisters what it does not recognise; a null here is
        // what stops it deleting a registration belonging to something else.
        expect(parseRegistrationId("some-other-extension-script")).toBeNull();
        expect(parseRegistrationId(undefined)).toBeNull();
        expect(parseRegistrationId("oriel:onlyonepart")).toBeNull();
    });

    it("keeps a unit id containing a colon parseable", () => {
        expect(parseRegistrationId(registrationId("hn", "js:0"))).toEqual({ skinId: "hn", unitId: "js:0" });
    });
});
