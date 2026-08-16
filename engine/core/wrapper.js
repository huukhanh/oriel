/**
 * Source generation for the one execution path where the `oriel` object cannot
 * simply be passed in as an argument.
 *
 * In the content script, skin JS runs as `new Function("oriel", code)(api)` and
 * the API is a live object. In the `userScripts` world it is not — the browser
 * registers a *string* and runs it in a world Oriel has no reference into, so
 * the API has to be built by code that travels with the skin. That string is
 * generated here rather than in the background module, because a generated
 * string is exactly the kind of thing that can be unit-tested on a machine with
 * no browser: the tests below assert on the text, and the E2E suite executes it.
 *
 * @module core/wrapper
 */

/**
 * @param {object} spec
 * @param {string} spec.skinId
 * @param {string} spec.name
 * @param {string} spec.code       The skin's own JavaScript.
 * @param {Record<string, string|number>} spec.vars
 * @param {Record<string, string>} [spec.assets]
 * @returns {string}
 */
export function wrapForUserScriptWorld(spec) {
    const header = JSON.stringify({
        id: spec.skinId,
        name: spec.name,
        vars: spec.vars ?? {},
        assets: spec.assets ?? {}
    });

    // The IIFE is not decoration. A registered user script shares its world
    // with every other script Oriel registered for the same page, so anything
    // at top level here would be visible to — and clobberable by — an unrelated
    // skin. `use strict` additionally turns a skin's accidental global into an
    // error the log can attribute, instead of a variable that silently leaks.
    return `(function () {
"use strict";
var __meta = ${header};
var __send = function (message) {
  try {
    return (globalThis.chrome || globalThis.browser).runtime.sendMessage(message);
  } catch (error) {
    return Promise.reject(error);
  }
};
${ORIEL_API}
try {
  (function (oriel) {
${indent(spec.code)}
  })(__oriel);
} catch (error) {
  __oriel.log("error", (error && error.stack) || String(error));
}
})();`;
}

/**
 * The `oriel` object as source. Kept as one template so the content script and
 * the user-script world cannot drift into offering different APIs — the content
 * script builds the same surface natively, and `API_SURFACE` below is what both
 * are checked against.
 */
const ORIEL_API = `var __cleanup = [];
var __sheets = [];
var __oriel = {
  id: __meta.id,
  name: __meta.name,
  vars: Object.freeze(Object.assign({}, __meta.vars)),
  log: function (level, message) {
    if (arguments.length === 1) { message = level; level = "info"; }
    __send({ type: "page.log", skinId: __meta.id, level: level, message: String(message) });
  },
  css: function (text) {
    var style = document.createElement("style");
    style.textContent = text;
    style.setAttribute("data-oriel", __meta.id);
    (document.head || document.documentElement).appendChild(style);
    __sheets.push(style);
    return { remove: function () { style.remove(); } };
  },
  watch: function (selector, fn) {
    var seen = new WeakSet();
    var sweep = function () {
      var nodes = document.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) {
        if (seen.has(nodes[i])) continue;
        seen.add(nodes[i]);
        try { fn(nodes[i]); } catch (error) { __oriel.log("error", String(error)); }
      }
    };
    sweep();
    var observer = new MutationObserver(sweep);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    __cleanup.push(function () { observer.disconnect(); });
    return { stop: function () { observer.disconnect(); } };
  },
  on: function (event, fn) {
    if (event === "cleanup") __cleanup.push(fn);
    else addEventListener("oriel:" + event, fn);
  },
  storage: {
    get: function (key) { return __send({ type: "page.storage", skinId: __meta.id, op: "get", key: key }).then(function (r) { return r && r.value; }); },
    set: function (key, value) { return __send({ type: "page.storage", skinId: __meta.id, op: "set", key: key, value: value }); },
    remove: function (key) { return __send({ type: "page.storage", skinId: __meta.id, op: "delete", key: key }); },
    keys: function () { return __send({ type: "page.storage", skinId: __meta.id, op: "keys" }).then(function (r) { return r && r.value; }); }
  },
  fetch: function (url, init) {
    return __send({ type: "page.fetch", skinId: __meta.id, url: url, init: init });
  },
  asset: function (name) { return __meta.assets[name]; },
  open: function (url, active) { return __send({ type: "page.open", url: url, active: active }); }
};
addEventListener("oriel:cleanup:" + __meta.id, function () {
  for (var i = 0; i < __sheets.length; i++) __sheets[i].remove();
  for (var j = 0; j < __cleanup.length; j++) { try { __cleanup[j](); } catch (e) {} }
  __cleanup = [];
  __sheets = [];
});`;

/**
 * The API a skin may rely on, in both execution paths. Exported so a test can
 * assert the content script's native implementation and the generated source
 * offer the same names — the failure mode otherwise is a skin that works on one
 * browser and throws `oriel.watch is not a function` on another.
 */
export const API_SURFACE = ["id", "name", "vars", "log", "css", "watch", "on", "storage", "fetch", "asset", "open"];

function indent(code) {
    return String(code)
        .split("\n")
        .map((line) => (line ? `    ${line}` : line))
        .join("\n");
}

/**
 * The id a registered user script is filed under. Namespaced because
 * `userScripts.register` shares an id space with anything else the extension
 * registers, and unprefixed skin ids would be a collision waiting to happen.
 */
export function registrationId(skinId, unitId) {
    return `oriel:${skinId}:${unitId}`;
}

/** The inverse, for reconciling what the browser reports against what we want. */
export function parseRegistrationId(id) {
    const match = /^oriel:([^:]+):(.+)$/.exec(id ?? "");
    return match ? { skinId: match[1], unitId: match[2] } : null;
}
