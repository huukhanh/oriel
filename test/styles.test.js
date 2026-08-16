// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStyleHost } from "../engine/runtime/styles.js";
import { PAGE } from "../hosts/extension/shared/protocol.js";

/**
 * The stylesheet host has two paths and the end-to-end suite can only reach
 * one of them.
 *
 * Chromium has `scripting.insertCSS`, so it always takes the browser path and
 * the fallback is never exercised there. The fallback is what Safari may well
 * use, and Safari is the browser this product is aimed at — so the path that
 * matters most is the one no browser available to this project will run. These
 * tests are the only evidence it works.
 */

/** A background that refuses to inject, forcing the element path. */
function refusingBackground() {
    const calls = [];
    return {
        calls,
        send: async (type, payload) => {
            calls.push({ type, ...payload });
            return { ok: false };
        }
    };
}

/** A background that injects, as Chromium's does. */
function injectingBackground() {
    const calls = [];
    return {
        calls,
        send: async (type, payload) => {
            calls.push({ type, ...payload });
            return { ok: true };
        }
    };
}

/**
 * Hosts are torn down between tests, not just abandoned.
 *
 * A host that still holds sheets keeps a MutationObserver alive, and that
 * observer's whole job is to put its stylesheets back when they disappear —
 * including when the next test clears the document. Leaking one leaks it into
 * every test after it. That is correct behaviour and an incorrect fixture.
 */
const hosts = [];

function makeHost(send) {
    const host = createStyleHost(send);
    hosts.push(host);
    return host;
}

beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
});

afterEach(async () => {
    for (const host of hosts.splice(0)) await host.removeAll();
});

const sheets = () => [...document.querySelectorAll("style[data-oriel]")];

describe("when the browser will inject for us", () => {
    it("does not put anything in the page", async () => {
        const background = injectingBackground();
        const host = makeHost(background.send);

        await host.add("skin:css0", "body { color: red; }");

        expect(sheets()).toHaveLength(0);
        expect(background.calls).toEqual([{ type: PAGE.INSERT_CSS, css: "body { color: red; }" }]);
    });

    it("hands back the identical text on removal", async () => {
        // `removeCSS` matches on the stylesheet's exact text. A byte of drift
        // between insert and remove leaves the skin on the page forever, which
        // on a single-page app means two skins fighting.
        const background = injectingBackground();
        const host = makeHost(background.send);
        const css = "body { color: red; }\n/* trailing */\n";

        await host.add("skin:css0", css);
        await host.remove("skin:css0");

        expect(background.calls[1]).toEqual({ type: PAGE.REMOVE_CSS, css });
    });
});

describe("when it will not", () => {
    it("falls back to an element in the page", async () => {
        const host = makeHost(refusingBackground().send);
        await host.add("skin:css0", "body { color: red; }");

        expect(sheets()).toHaveLength(1);
        expect(sheets()[0].textContent).toBe("body { color: red; }");
        expect(sheets()[0].getAttribute("data-oriel")).toBe("skin:css0");
    });

    it("attaches to documentElement when there is no head yet", async () => {
        // The content script runs at document_start. Waiting for a head is
        // losing the race the stylesheet exists to win.
        // Setting innerHTML is not enough — the parser puts a head straight
        // back. It has to be removed outright to model document_start.
        document.documentElement.innerHTML = "";
        document.head?.remove();
        expect(document.head).toBeFalsy();

        const host = makeHost(refusingBackground().send);
        await host.add("skin:css0", "body { color: red; }");

        expect(sheets()).toHaveLength(1);
        expect(sheets()[0].parentElement).toBe(document.documentElement);
    });

    it("removes the element again", async () => {
        const host = makeHost(refusingBackground().send);
        await host.add("skin:css0", "body { color: red; }");
        await host.remove("skin:css0");

        expect(sheets()).toHaveLength(0);
        expect(host.size).toBe(0);
    });

    it("puts the stylesheet back when the page tears the head down", async () => {
        // Frameworks that own <head> replace it wholesale on hydration. Without
        // this the skin works until the page finishes loading and then vanishes,
        // which reads to a user as "it flickers and breaks".
        const host = makeHost(refusingBackground().send);
        await host.add("skin:css0", "body { color: red; }");

        sheets()[0].remove();
        expect(sheets()).toHaveLength(0);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(sheets()).toHaveLength(1);
        expect(sheets()[0].textContent).toBe("body { color: red; }");
    });

    it("stops watching once nothing of ours is in the page", async () => {
        const host = makeHost(refusingBackground().send);
        await host.add("skin:css0", "body { color: red; }");
        await host.remove("skin:css0");

        // A removal after the host has let go must stay removed, or the guard
        // is still running and will resurrect a skin the user turned off.
        document.documentElement.appendChild(document.createElement("div"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(sheets()).toHaveLength(0);
    });
});

describe("bookkeeping", () => {
    it("replaces a sheet whose text changed, rather than stacking a second one", async () => {
        // This is the live-variable path: moving a slider re-adds the same key.
        const host = makeHost(refusingBackground().send);
        await host.add("skin:vars", ":root { --accent: red; }");
        await host.add("skin:vars", ":root { --accent: blue; }");

        expect(sheets()).toHaveLength(1);
        expect(sheets()[0].textContent).toBe(":root { --accent: blue; }");
    });

    it("does no work when the text is unchanged", async () => {
        const background = refusingBackground();
        const host = makeHost(background.send);
        await host.add("skin:vars", ":root { --accent: red; }");
        const element = sheets()[0];

        await host.add("skin:vars", ":root { --accent: red; }");

        expect(sheets()[0]).toBe(element);
        expect(background.calls.filter((c) => c.type === PAGE.INSERT_CSS)).toHaveLength(1);
    });

    it("ignores an empty sheet", async () => {
        const background = refusingBackground();
        const host = makeHost(background.send);
        await host.add("skin:vars", "");

        expect(sheets()).toHaveLength(0);
        expect(background.calls).toHaveLength(0);
    });

    it("keeps several sheets apart and removes them all together", async () => {
        const host = makeHost(refusingBackground().send);
        await host.add("a:css0", "a{}");
        await host.add("a:css1", "b{}");
        await host.add("b:css0", "c{}");
        expect(host.size).toBe(3);

        await host.removeAll();
        expect(host.size).toBe(0);
        expect(sheets()).toHaveLength(0);
    });

    it("survives a background that throws instead of answering", async () => {
        // Safari evicts the background context; a send can reject rather than
        // return `{ok: false}`. Either way the page must still get its CSS.
        const host = makeHost(async () => {
            throw new Error("background is gone");
        });
        await host.add("skin:css0", "body { color: red; }");

        expect(sheets()).toHaveLength(1);
    });

    it("does not throw when removing something that was never added", async () => {
        const host = makeHost(refusingBackground().send);
        await expect(host.remove("nope")).resolves.toBeUndefined();
    });
});
