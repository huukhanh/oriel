import { describe, it, expect } from "vitest";
import { installPrelude } from "../src/prelude.js";

describe("prelude", () => {
  it("patches history exactly once", () => {
    installPrelude(window);
    const patched = window.history.pushState;
    installPrelude(window);
    expect(window.history.pushState).toBe(patched);
  });

  it("dispatches __inj:navigate on pushState", () => {
    installPrelude(window);
    let n = 0;
    window.addEventListener("__inj:navigate", () => n++);
    window.history.pushState({}, "", "/watch");
    expect(n).toBe(1);
  });
});
