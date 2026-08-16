/**
 * One manifest, three browsers.
 *
 * The three disagree in exactly two places — how a background context is
 * declared, and how the extension is identified — so the shared object below is
 * the truth and `manifestFor(target)` applies the differences. A single
 * manifest.json with every browser's keys in it works until one of them starts
 * rejecting unknown keys, and then it fails at install time on a device we
 * cannot debug.
 *
 * @module manifest.config
 */

export const VERSION = "0.1.0";

const shared = {
    manifest_version: 3,
    name: "Oriel",
    version: VERSION,
    description: "Store and apply skins that completely change a website's interface.",
    action: {
        default_title: "Oriel",
        default_popup: "popup.html"
    },
    options_ui: {
        page: "manager.html",
        open_in_tab: true
    },
    permissions: [
        "storage",
        "scripting",
        "tabs",
        "alarms"
    ],
    // Asked for at runtime, from a user gesture, and only where it exists.
    // Chrome additionally requires the user to flip a per-extension switch, so
    // this being in the manifest guarantees nothing — see background/caps.js.
    optional_permissions: ["userScripts"],
    host_permissions: ["<all_urls>"],
    content_scripts: [
        {
            matches: ["<all_urls>"],
            js: ["content.js"],
            run_at: "document_start",
            all_frames: true,
            match_about_blank: false
        }
    ],
    icons: {
        48: "icons/icon-48.png",
        128: "icons/icon-128.png"
    }
};

/** @param {"chrome"|"firefox"|"safari"} target */
export function manifestFor(target) {
    const manifest = structuredClone(shared);

    if (target === "chrome") {
        // A classic (non-module) service worker: the bundle is self-contained,
        // and `type: "module"` buys nothing but a compatibility risk.
        manifest.background = { service_worker: "background.js" };
        manifest.minimum_chrome_version = "120";
    }

    if (target === "firefox") {
        // Firefox implements MV3 backgrounds as non-persistent event pages.
        manifest.background = { scripts: ["background.js"], type: "classic" };
        manifest.browser_specific_settings = {
            gecko: { id: "oriel@huukhanh.github.io", strict_min_version: "128.0" }
        };
    }

    if (target === "safari") {
        // Safari accepts the service-worker form and treats it as a
        // non-persistent background context that it may evict at any time.
        // Every message exchange in shared/protocol.js is therefore
        // self-contained; nothing survives in a module-level variable that
        // could not be rebuilt from storage.
        manifest.background = { service_worker: "background.js" };
        // `unlimitedStorage` is a Chrome-ism Safari ignores; asking for a
        // permission a browser does not know is how an install silently fails.
        manifest.permissions = manifest.permissions.filter((p) => p !== "alarms");
        // No alarms API on iOS worth relying on: update checks run when a UI
        // page opens instead. See background/updates.js.
    }

    if (target !== "safari") {
        // Early CSS: with webNavigation the background can push a skin's
        // stylesheet at commit time, which beats the content script's first
        // message by a paint on a slow page. Safari's support is unverified,
        // and the content-script path covers us there.
        manifest.permissions.push("webNavigation");
    }

    return manifest;
}

export const TARGETS = ["chrome", "firefox", "safari"];
