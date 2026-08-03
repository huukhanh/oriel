import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The spike's injected probe is a classic script (WKUserScript source cannot
// be a module), so it is loaded as text and evaluated into jsdom's window —
// the same way WebKit will evaluate it. This is the only part of the Phase 0
// spike that is verified rather than assumed.
const here = dirname(fileURLToPath(import.meta.url));
const probeSource = readFileSync(
  join(here, "..", "..", "Spike", "BackgroundAudioSpike", "Probe.js"),
  "utf8"
);

function installProbe() {
  // eslint-disable-next-line no-eval
  (0, eval)(probeSource);
  return window.__spikeProbe;
}

/** jsdom media elements report paused=true from a read-only getter. */
function media(tag, { paused = true, ended = false, currentTime = 0, src = "" } = {}) {
  const element = document.createElement(tag);
  Object.defineProperty(element, "paused", { value: paused, configurable: true });
  Object.defineProperty(element, "ended", { value: ended, configurable: true });
  Object.defineProperty(element, "currentTime", { value: currentTime, configurable: true });
  Object.defineProperty(element, "currentSrc", { value: src, configurable: true });
  document.body.appendChild(element);
  return element;
}

describe("spike probe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    delete window.__spikeProbeInstalled;
    delete window.__spikeProbe;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports no media on a page with none", () => {
    const probe = installProbe();
    const result = probe.sample(document);
    expect(result.playing).toBe(false);
    expect(result.src).toBe("(no media element)");
  });

  it("falls back to a paused element so the UI can say 'found, not playing'", () => {
    media("audio", { paused: true, src: "a.wav" });
    const probe = installProbe();
    const result = probe.sample(document);
    expect(result.playing).toBe(false);
    expect(result.src).toBe("a.wav");
  });

  it("reports a playing element", () => {
    media("video", { paused: false, currentTime: 12.5, src: "v.mp4" });
    const probe = installProbe();
    const result = probe.sample(document);
    expect(result.playing).toBe(true);
    expect(result.currentTime).toBe(12.5);
  });

  // The case that matters on a real page: ad slots and hidden players leave
  // several paused elements in the DOM, and picking the first one would report
  // "silent" for the entire ten-minute run.
  it("prefers the playing element over earlier paused ones", () => {
    media("audio", { paused: true, src: "decoy1.wav" });
    media("video", { paused: true, src: "decoy2.mp4" });
    media("video", { paused: false, currentTime: 3, src: "real.mp4" });
    const probe = installProbe();
    const result = probe.sample(document);
    expect(result.playing).toBe(true);
    expect(result.src).toBe("real.mp4");
  });

  it("treats an ended element as not playing", () => {
    media("audio", { paused: false, ended: true, src: "done.wav" });
    const probe = installProbe();
    expect(probe.sample(document).playing).toBe(false);
  });

  it("installs exactly once", () => {
    const first = installProbe();
    installProbe();
    expect(window.__spikeProbe).toBe(first);
  });

  it("does not throw when the bridge is absent", () => {
    media("audio", { paused: false, src: "a.wav" });
    installProbe();
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
  });
});
