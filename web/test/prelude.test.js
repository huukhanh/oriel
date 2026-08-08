import { describe, it, expect } from "vitest";
import { makeWindow, navigate } from "./helpers.js";

const ANY = [{ scheme: "any", hostKind: "any", host: "", path: "*" }];
const WATCH = [{ scheme: "any", hostKind: "suffix", host: "youtube.com", path: "/watch*" }];
const SITE = [{ scheme: "any", hostKind: "suffix", host: "youtube.com", path: "/*" }];

const HOME = "https://www.youtube.com/";
const WATCH_1 = "https://www.youtube.com/watch?v=1";

describe("prelude installation", () => {
    it("patches history exactly once", async () => {
        const win = await makeWindow(HOME);
        const patched = win.history.pushState;
        const inj = win.__inj;

        // Re-running the prelude source is what a second content world, or a
        // re-injection, looks like.
        const script = win.document.createElement("script");
        script.textContent = "window.__injReRan = !!window.__inj;";
        win.document.head.appendChild(script);

        expect(win.history.pushState).toBe(patched);
        expect(win.__inj).toBe(inj);
    });

    it("dispatches __inj:navigate on pushState and replaceState", async () => {
        const win = await makeWindow(HOME);
        let n = 0;
        win.addEventListener("__inj:navigate", () => n++);
        win.history.pushState({}, "", "/watch?v=1");
        win.history.replaceState({}, "", "/watch?v=2");
        expect(n).toBe(2);
    });
});

describe("registration and matching", () => {
    it("runs a script whose pattern matches at registration", async () => {
        const win = await makeWindow(WATCH_1);
        let runs = 0;
        win.__inj.register("a", WATCH, () => runs++);
        expect(runs).toBe(1);
    });

    it("does not run one whose pattern does not match", async () => {
        const win = await makeWindow(HOME);
        let runs = 0;
        win.__inj.register("a", WATCH, () => runs++);
        expect(runs).toBe(0);
    });

    it("a script with no patterns runs nowhere", async () => {
        const win = await makeWindow(WATCH_1);
        let runs = 0;
        win.__inj.register("a", [], () => runs++);
        expect(runs).toBe(0);
    });

    it("a wildcard script runs everywhere", async () => {
        const win = await makeWindow("https://example.com/anything");
        let runs = 0;
        win.__inj.register("a", ANY, () => runs++);
        expect(runs).toBe(1);
    });

    // The case Layer A structurally cannot handle: an SPA route change into a
    // matching URL with no new document. This is why the guard exists at all.
    it("starts a script when an SPA route change makes it match", async () => {
        const win = await makeWindow(HOME);
        let runs = 0;
        win.__inj.register("a", WATCH, () => runs++);
        expect(runs).toBe(0);

        navigate(win, "/watch?v=1");
        expect(runs).toBe(1);
    });

    it("stops and cleans up when a route change makes it stop matching", async () => {
        const win = await makeWindow(WATCH_1);
        let cleaned = 0;
        win.__inj.register("a", WATCH, (GM) => GM.onCleanup(() => cleaned++));
        expect(cleaned).toBe(0);

        navigate(win, "/");
        expect(cleaned).toBe(1);
    });

    it("re-runs when the pattern matches again after not matching", async () => {
        const win = await makeWindow(WATCH_1);
        let runs = 0;
        win.__inj.register("a", WATCH, () => runs++);

        navigate(win, "/");
        navigate(win, "/watch?v=2");
        expect(runs).toBe(2);
    });
});

/**
 * decision 005 — the behaviour that departs from the brainstorm's sketch.
 * The reason it departs is in these tests.
 */
describe("re-entry contract", () => {
    it("does NOT re-run while the pattern keeps matching", async () => {
        const win = await makeWindow(WATCH_1);
        let runs = 0;
        win.__inj.register("a", SITE, () => runs++);

        navigate(win, "/");
        navigate(win, "/watch?v=2");
        navigate(win, "/feed/subscriptions");

        expect(runs, "re-running here is what doubles a pasted script's listeners").toBe(1);
    });

    it("listeners do not accumulate across route changes", async () => {
        const win = await makeWindow(WATCH_1);
        let fired = 0;
        win.__inj.register("a", SITE, () => {
            win.addEventListener("custom", () => fired++);
        });

        for (let i = 0; i < 5; i++) {
            navigate(win, `/watch?v=${i}`);
        }
        win.dispatchEvent(new win.Event("custom"));

        expect(fired, "one handler, not six").toBe(1);
    });

    it("offers onRouteChange for scripts that do want per-route work", async () => {
        const win = await makeWindow(WATCH_1);
        const seen = [];
        win.__inj.register("a", SITE, (GM) => {
            GM.onRouteChange((href) => seen.push(href));
        });

        navigate(win, "/watch?v=2");
        navigate(win, "/feed/subscriptions");

        expect(seen).toEqual([
            "https://www.youtube.com/watch?v=2",
            "https://www.youtube.com/feed/subscriptions"
        ]);
    });

    it("does not fire onRouteChange for a script that just started", async () => {
        const win = await makeWindow(HOME);
        const seen = [];
        win.__inj.register("a", WATCH, (GM) => {
            GM.onRouteChange((href) => seen.push(href));
        });

        navigate(win, "/watch?v=1");
        expect(seen, "its body just ran for this very route").toEqual([]);
    });

    it("drops route handlers when the script stops", async () => {
        const win = await makeWindow(WATCH_1);
        const seen = [];
        win.__inj.register("a", WATCH, (GM) => {
            GM.onRouteChange((href) => seen.push(href));
        });

        navigate(win, "/");
        navigate(win, "/watch?v=2");
        navigate(win, "/watch?v=3");

        expect(seen, "the handler from the first run must not survive teardown").toEqual([
            "https://www.youtube.com/watch?v=3"
        ]);
    });

    it("runs cleanups in reverse order", async () => {
        const win = await makeWindow(WATCH_1);
        const order = [];
        win.__inj.register("a", WATCH, (GM) => {
            GM.onCleanup(() => order.push("first"));
            GM.onCleanup(() => order.push("second"));
        });

        navigate(win, "/");
        expect(order).toEqual(["second", "first"]);
    });

    it("re-registering the same id tears the old one down first", async () => {
        const win = await makeWindow(WATCH_1);
        let cleaned = 0;
        win.__inj.register("a", WATCH, (GM) => GM.onCleanup(() => cleaned++));
        // What "run on current page now" does after an edit.
        win.__inj.register("a", WATCH, () => {});
        expect(cleaned, "an edit/run loop must not accumulate listeners").toBe(1);
    });
});

describe("GM surface", () => {
    it("addStyle injects a style element and removes it on cleanup", async () => {
        const win = await makeWindow(WATCH_1);
        win.__inj.register("a", WATCH, (GM) => {
            GM.addStyle("body { color: red }");
        });
        expect(win.document.querySelectorAll("style").length).toBe(1);

        navigate(win, "/");
        expect(
            win.document.querySelectorAll("style").length,
            "a style outliving its script is how a disabled script keeps changing a page"
        ).toBe(0);
    });

    it("exposes the script id via info", async () => {
        const win = await makeWindow(WATCH_1);
        let seen = null;
        win.__inj.register("my-script", WATCH, (GM) => {
            seen = GM.info.id;
        });
        expect(seen).toBe("my-script");
    });

    it("a throwing script does not stop the others", async () => {
        const win = await makeWindow(WATCH_1);
        let second = 0;
        win.__inj.register("bad", WATCH, () => {
            throw new Error("boom");
        });
        win.__inj.register("good", WATCH, () => second++);
        expect(second).toBe(1);
    });

    it("a script that throws still has its cleanups run", async () => {
        const win = await makeWindow(WATCH_1);
        let cleaned = 0;
        win.__inj.register("bad", WATCH, (GM) => {
            GM.onCleanup(() => cleaned++);
            throw new Error("boom after registering cleanup");
        });
        navigate(win, "/");
        expect(cleaned).toBe(1);
    });

    it("a throwing cleanup does not block the rest", async () => {
        const win = await makeWindow(WATCH_1);
        let cleaned = 0;
        win.__inj.register("a", WATCH, (GM) => {
            GM.onCleanup(() => cleaned++);
            GM.onCleanup(() => {
                throw new Error("bad cleanup");
            });
        });
        navigate(win, "/");
        expect(cleaned).toBe(1);
    });

    it("survives the absence of the native bridge", async () => {
        const win = await makeWindow(WATCH_1);
        expect(() => {
            win.__inj.register("a", ANY, (GM) => GM.log("hello"));
        }).not.toThrow();
    });
});
