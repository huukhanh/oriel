/**
 * The settings form a skin never has to write.
 *
 * One control per var type in docs/SKIN-FORMAT.md §6.1. Every control reports
 * on `input`/`change`, not on submit: the background pushes var changes into
 * open tabs without a reload, and watching a page change under your thumb as
 * you drag a slider is the best thing about the product. A Save button would
 * throw that away to save a few messages.
 *
 * @module ui/varsform
 */

import { bind, switchControl } from "./dom.js";

/** `#rgb`, `#rrggbb`, `#rrggbbaa` — everything an `<input type="color">` can hold is a subset. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNCTION = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i;

function toNumber(raw, fallback = 0) {
    const value = typeof raw === "number" ? raw : Number(String(raw).trim());
    return Number.isFinite(value) ? value : fallback;
}

function toFlag(raw) {
    if (typeof raw === "boolean") return raw ? 1 : 0;
    if (typeof raw === "number") return raw ? 1 : 0;
    const s = String(raw).trim().toLowerCase();
    return s === "1" || s === "true" || s === "on" || s === "yes" ? 1 : 0;
}

/** Coerce a raw control value to what gets stored and substituted for this var type. */
function coerce(type, raw, fallback) {
    if (type === "number" || type === "range") return toNumber(raw, toNumber(fallback, 0));
    if (type === "checkbox") return toFlag(raw);
    return raw === undefined || raw === null ? "" : String(raw);
}

/**
 * The colour well can only hold `#rrggbb`. `rgba()` is legal in a skin and
 * common — a translucent overlay is exactly what an author reaches for — so
 * the text field is authoritative and the well shows the nearest opaque hex.
 */
function toPickerHex(value, fallback = "#000000") {
    const raw = String(value ?? "").trim();
    if (HEX.test(raw)) {
        if (raw.length === 4) {
            return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
        }
        return raw.slice(0, 7).toLowerCase();
    }
    const parts = RGB_FUNCTION.exec(raw);
    if (parts) {
        const channel = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0");
        return `#${channel(parts[1])}${channel(parts[2])}${channel(parts[3])}`;
    }
    return fallback;
}

function optionsOf(variable) {
    const options = Array.isArray(variable.options) ? variable.options : [];
    if (options.length) return options;
    // A select with no option map still has to be operable; the stored default
    // is the only key we know exists.
    const fallback = String(variable.default ?? "");
    return fallback ? [{ key: fallback, label: fallback, value: fallback }] : [];
}

function currentValue(variable, values) {
    const stored = values ? values[variable.key] : undefined;
    return stored === undefined || stored === null ? variable.default : stored;
}

let formSeq = 0;

/**
 * @param {{vars: import("../../engine/core/types.js").Var[], values?: Record<string, string|number>, onChange?: (key: string, value: string|number) => void}} props
 * @param {Document} document
 * @returns {HTMLElement} a `<form>`; pass it to {@link readValues} to read it back.
 */
export function buildVarsForm({ vars = [], values = {}, onChange }, document) {
    const h = bind(document);
    const idPrefix = `o-var-${++formSeq}`;
    const form = h("form.o-vars", { novalidate: true });

    if (!vars.length) {
        form.appendChild(h("p.o-quiet", { text: "This skin has no settings." }));
        return form;
    }

    const report = (key, value) => {
        if (typeof onChange === "function") onChange(key, value);
    };

    /** Each field hands back a setter so "Reset to defaults" can drive it. */
    const fields = [];

    for (const variable of vars) {
        const built = buildField(h, document, variable, currentValue(variable, values), report, idPrefix);
        fields.push({ variable, set: built.set });
        form.appendChild(built.node);
    }

    const reset = h("button.o-reset", { type: "button", text: "Reset to defaults" });
    reset.addEventListener("click", () => {
        for (const field of fields) {
            const value = coerce(field.variable.type, field.variable.default, field.variable.default);
            field.set(value);
            report(field.variable.key, value);
        }
    });
    form.appendChild(h("div.o-vars-foot", {}, [reset]));

    return form;
}

function buildField(h, document, variable, value, report, idPrefix) {
    const type = variable.type;
    const id = `${idPrefix}-${variable.key}`;
    const inline = type === "checkbox";
    const field = h("div.o-field", {
        class: inline ? "is-inline" : "",
        data: { key: variable.key, type }
    });

    const label = h("label.o-field-label", { for: id, text: variable.label || variable.key });
    const control = h("div.o-field-control");
    field.append(label, control);

    switch (type) {
        case "color":
            return colorControl();
        case "checkbox":
            return checkboxControl();
        case "number":
            return numberControl();
        case "range":
            return rangeControl();
        case "select":
        case "image":
            return selectControl();
        default:
            return textControl();
    }

    /** Every branch returns `{ node, set }`; `set` is what "Reset to defaults" drives. */
    function done(set) {
        return { node: field, set };
    }

    function textControl() {
        const input = h("input.o-input", {
            type: "text",
            id,
            value: String(value ?? ""),
            maxlength: variable.maxLength || undefined,
            data: { input: "" }
        });
        input.addEventListener("input", () => report(variable.key, input.value));
        control.appendChild(input);
        return done((next) => {
            input.value = String(next ?? "");
        });
    }

    function colorControl() {
        const picker = h("input.o-color", { type: "color", id, data: { role: "picker" } });
        picker.value = toPickerHex(value);
        const textField = h("input.o-input.o-color-text", {
            type: "text",
            value: String(value ?? ""),
            spellcheck: false,
            "aria-label": `${variable.label || variable.key} value`,
            data: { input: "" }
        });
        picker.addEventListener("input", () => {
            textField.value = picker.value;
            report(variable.key, picker.value);
        });
        textField.addEventListener("input", () => {
            const hex = toPickerHex(textField.value, "");
            if (hex) picker.value = hex;
            report(variable.key, textField.value);
        });
        control.append(picker, textField);
        return done((next) => {
            textField.value = String(next ?? "");
            picker.value = toPickerHex(next);
        });
    }

    function checkboxControl() {
        const flag = toFlag(value);
        const node = switchControl(document, {
            checked: flag === 1,
            label: variable.label || variable.key,
            onChange: (checked) => report(variable.key, checked ? 1 : 0)
        });
        const input = node.querySelector("input");
        input.id = id;
        input.dataset.input = "";
        control.appendChild(node);
        return done((next) => {
            input.checked = toFlag(next) === 1;
        });
    }

    function numberControl() {
        const input = h("input.o-input.o-number", {
            type: "number",
            id,
            min: variable.min ?? undefined,
            max: variable.max ?? undefined,
            step: variable.step ?? undefined,
            data: { input: "" }
        });
        input.value = String(toNumber(value, toNumber(variable.default, 0)));
        input.addEventListener("input", () => {
            if (input.value === "") return; // mid-edit; do not push NaN into a live page
            report(variable.key, toNumber(input.value, toNumber(variable.default, 0)));
        });
        control.appendChild(input);
        if (variable.units) control.appendChild(h("span.o-units", { text: variable.units }));
        return done((next) => {
            input.value = String(toNumber(next, 0));
        });
    }

    function rangeControl() {
        const min = variable.min ?? 0;
        const max = variable.max ?? 100;
        const input = h("input.o-range", {
            type: "range",
            id,
            min,
            max,
            step: variable.step ?? 1,
            data: { input: "" }
        });
        input.value = String(toNumber(value, toNumber(variable.default, min)));
        const readout = h("output.o-readout", { text: `${input.value}${variable.units || ""}` });
        input.addEventListener("input", () => {
            readout.textContent = `${input.value}${variable.units || ""}`;
            report(variable.key, toNumber(input.value, min));
        });
        control.append(input, readout);
        return done((next) => {
            input.value = String(toNumber(next, min));
            readout.textContent = `${input.value}${variable.units || ""}`;
        });
    }

    function selectControl() {
        const select = h("select.o-select", { id, data: { input: "" } });
        for (const option of optionsOf(variable)) {
            select.appendChild(h("option", { value: option.key, text: option.label ?? option.key }));
        }
        // Options have to exist before a value will stick.
        select.value = String(value ?? "");
        if (select.selectedIndex === -1 && select.options.length) select.selectedIndex = 0;
        select.addEventListener("change", () => report(variable.key, select.value));
        control.appendChild(select);
        return done((next) => {
            select.value = String(next ?? "");
        });
    }
}

/**
 * Read a built form back. The stored shape, not the DOM shape: numbers for
 * `number`/`range`, `0`/`1` for `checkbox`, the option *key* for `select`.
 *
 * @param {HTMLElement} formElement
 * @returns {Record<string, string|number>}
 */
export function readValues(formElement) {
    const values = {};
    if (!formElement) return values;
    for (const field of formElement.querySelectorAll("[data-key][data-type]")) {
        const key = field.dataset.key;
        const type = field.dataset.type;
        const input = field.querySelector("[data-input]");
        if (!input) continue;
        values[key] = type === "checkbox" ? (input.checked ? 1 : 0) : coerce(type, input.value);
    }
    return values;
}
