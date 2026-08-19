import { describe, it, expect } from "vitest";
import {
    CAPABILITIES,
    HOST_PROFILES,
    bandOf,
    permissionsFor,
    defineHost,
    exposeFor,
    HostCapabilityError
} from "../engine/host/contract.js";
import { createTestHost } from "../engine/host/test-host.js";

/**
 * The seam the browser is built on. The Swift half cannot be tested anywhere in
 * this project's loop, so the contract it has to satisfy is tested instead —
 * and the rule that a declared capability must come with an implementation is
 * what stops a Swift host shipping a capability that reads as available and
 * throws inside a stranger's skin.
 */

describe("capability names", () => {
    it("are unique and dotted", () => {
        expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
        for (const capability of CAPABILITIES) {
            expect(capability).toMatch(/^[a-z]+(\.[a-zA-Z]+)*$/);
        }
    });

    it("band every capability, and default an unknown one to the most restricted", () => {
        for (const capability of CAPABILITIES) {
            expect(["free", "declared", "prompted"]).toContain(bandOf(capability));
        }
        // Failing open here would let a typo become a silent grant.
        expect(bandOf("something.invented")).toBe("prompted");
    });

    it("keeps the document free and the device prompted", () => {
        expect(bandOf("page.dom")).toBe("free");
        expect(bandOf("storage")).toBe("free");
        expect(bandOf("tabs.open")).toBe("declared");
        expect(bandOf("chrome.toolbar")).toBe("declared");
        expect(bandOf("native.clipboard")).toBe("prompted");
        // Synthesising a response is answering for a site the user thinks they
        // are talking to, which is a different question from blocking a tracker.
        expect(bandOf("net.rules")).toBe("declared");
        expect(bandOf("net.synthesize")).toBe("prompted");
    });
});

describe("permissionsFor", () => {
    it("asks by namespace, not by method", () => {
        expect(permissionsFor(["tabs.list", "tabs.open", "tabs.close"])).toEqual(["tabs"]);
    });

    it("asks for each native capability separately", () => {
        // "read your clipboard" and "make the phone buzz" are not the same
        // question and must not be granted together.
        expect(permissionsFor(["native.clipboard", "native.haptic"])).toEqual([
            "native.clipboard",
            "native.haptic"
        ]);
    });

    it("asks for nothing for a skin that only touches the page", () => {
        expect(permissionsFor(["page.css", "page.dom", "page.js", "storage", "bus"])).toEqual([]);
    });

    it("is stable in order, so an install prompt does not reshuffle", () => {
        expect(permissionsFor(["chrome.css", "tabs.open", "net.rules"])).toEqual(["chrome", "net", "tabs"]);
    });
});

describe("defineHost", () => {
    const namespaces = { page: { css() {} }, storage: { get() {} } };

    it("accepts a host whose declarations match what it provides", () => {
        const host = defineHost({ name: "x", capabilities: ["page.css", "storage"], namespaces });
        expect(host.can("page.css")).toBe(true);
        expect(host.can("tabs.open")).toBe(false);
    });

    it("refuses a capability with no namespace behind it", () => {
        // The failure this prevents: a capability that reads as available and
        // throws `undefined is not a function` inside someone else's skin.
        expect(() => defineHost({ name: "x", capabilities: ["tabs.open"], namespaces })).toThrow(
            /provides no "tabs" namespace/
        );
    });

    it("refuses a capability nobody has heard of", () => {
        expect(() => defineHost({ name: "x", capabilities: ["page.telepathy"], namespaces })).toThrow(
            /unknown capability/
        );
    });

    it("refuses a nameless host", () => {
        expect(() => defineHost({ capabilities: [], namespaces: {} })).toThrow(/needs a name/);
    });

    it("is frozen, so a skin cannot grant itself a capability", () => {
        const host = defineHost({ name: "x", capabilities: ["page.css"], namespaces });
        expect(Object.isFrozen(host)).toBe(true);
        expect(Object.isFrozen(host.capabilities)).toBe(true);
    });

    it("names the host and the capability when it refuses", () => {
        const host = defineHost({ name: "extension", capabilities: ["page.css"], namespaces });
        expect(() => host.require("chrome.toolbar")).toThrow(HostCapabilityError);
        expect(() => host.require("chrome.toolbar")).toThrow(/extension.*chrome\.toolbar/);
    });
});

describe("exposeFor", () => {
    it("leaves a namespace out entirely rather than stubbing it", () => {
        // A stub that rejects turns a capability question into a runtime error
        // inside skin code that had no way to ask first.
        const { host } = createTestHost({ capabilities: ["page.css", "storage"] });
        const oriel = exposeFor(host);
        expect(oriel.page).toBeDefined();
        expect(oriel.storage).toBeDefined();
        expect(oriel.chrome).toBeUndefined();
        expect("chrome" in oriel).toBe(false);
    });

    it("answers can() for the whole capability list", () => {
        const { host } = createTestHost();
        const oriel = exposeFor(host);
        for (const capability of CAPABILITIES) expect(oriel.can(capability)).toBe(true);
    });

    it("reports a denial, so the manager can explain a skin doing nothing", () => {
        const denied = [];
        const { host } = createTestHost({ capabilities: ["page.css"] });
        const oriel = exposeFor(host, { onDenied: (c) => denied.push(c) });
        expect(oriel.can("chrome.toolbar")).toBe(false);
        expect(denied).toEqual(["chrome.toolbar"]);
    });
});

describe("host profiles", () => {
    it("gives the browser everything", () => {
        expect([...HOST_PROFILES.apple].sort()).toEqual([...CAPABILITIES].sort());
    });

    it("gives the extension host no access to the browser's own interface", () => {
        // The whole reason Oriel is a browser. If this ever passes, the pivot
        // was unnecessary and decision 001 needs rereading.
        for (const capability of HOST_PROFILES.extension) {
            expect(capability.startsWith("chrome.")).toBe(false);
            expect(capability.startsWith("native.")).toBe(false);
        }
    });

    it("only names capabilities that exist", () => {
        for (const profile of Object.values(HOST_PROFILES)) {
            for (const capability of profile) expect(CAPABILITIES).toContain(capability);
        }
    });
});

describe("the test host", () => {
    it("records what a skin asked for", async () => {
        const { host, callsTo } = createTestHost();
        await host.namespaces.tabs.open("https://example.com", { background: true });
        expect(callsTo("tabs.open")).toEqual([
            { method: "tabs.open", args: ["https://example.com", { background: true }] }
        ]);
    });

    it("stores and returns", async () => {
        const { host } = createTestHost();
        await host.namespaces.storage.set("k", 1);
        expect(await host.namespaces.storage.get("k")).toBe(1);
        expect(await host.namespaces.storage.keys()).toEqual(["k"]);
    });

    it("drives a listener the way a real host would", () => {
        const { host, fire } = createTestHost();
        const seen = [];
        host.namespaces.tabs.onChanged((event) => seen.push(event));
        fire("tabs", { kind: "activated", id: 3 });
        expect(seen).toEqual([{ kind: "activated", id: 3 }]);
    });

    it("carries a message between two skins on the bus", () => {
        const { host, fire } = createTestHost();
        const seen = [];
        host.namespaces.bus.on("reader:ready", (d) => seen.push(d));
        host.namespaces.bus.emit("reader:ready", { version: 2 });
        expect(seen).toEqual([{ version: 2 }]);
        expect(fire).toBeTypeOf("function");
    });

    it("can be narrowed, to test how a skin degrades", () => {
        const { host } = createTestHost({ capabilities: ["page.css", "storage"] });
        expect(host.can("chrome.theme")).toBe(false);
        expect(() => host.require("chrome.theme")).toThrow(HostCapabilityError);
    });
});
