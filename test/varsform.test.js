// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildVarsForm, readValues } from "../extension/src/ui/varsform.js";

/**
 * The settings form is generated from a skin's own declarations, so a skin
 * author never writes UI. That makes this the one screen whose correctness is
 * not the author's problem, and the one place a coercion bug reaches every skin
 * at once — a `range` that reports its value as a string writes `"8"` into a
 * page expecting `8px`.
 */

const VARS = [
    { key: "title", type: "text", label: "Heading", default: "Stories" },
    { key: "accent", type: "color", label: "Accent", default: "#ff6600" },
    { key: "thumbs", type: "checkbox", label: "Avatars", default: 1 },
    { key: "radius", type: "number", label: "Radius", default: 8, min: 0, max: 40, step: 1, units: "px" },
    { key: "density", type: "range", label: "Row spacing", default: 8, min: 2, max: 24, step: 1, units: "px" },
    {
        key: "corners",
        type: "select",
        label: "Corners",
        default: "round",
        options: [
            { key: "round", label: "Rounded", value: "12px" },
            { key: "square", label: "Square", value: "0" }
        ]
    }
];

function build(overrides = {}) {
    const changes = [];
    const form = buildVarsForm(
        { vars: VARS, values: {}, onChange: (key, value) => changes.push([key, value]), ...overrides },
        document
    );
    return { form, changes };
}

const field = (form, key) => form.querySelector(`[data-key="${key}"]`);
const input = (form, key) => field(form, key).querySelector("[data-input]");

function type(node, value) {
    node.value = value;
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
}

describe("controls", () => {
    it("builds one field per declared variable", () => {
        const { form } = build();
        expect(form.querySelectorAll("[data-key]")).toHaveLength(VARS.length);
    });

    it.each([
        ["title", "input", "text"],
        ["accent", "input", "text"],
        ["thumbs", "input", "checkbox"],
        ["radius", "input", "number"],
        ["density", "input", "range"]
    ])("gives %s the right control", (key, tag, inputType) => {
        const node = input(build().form, key);
        expect(node.tagName.toLowerCase()).toBe(tag);
        expect(node.type).toBe(inputType);
    });

    it("gives a select its options, labelled for humans and valued by key", () => {
        const select = input(build().form, "corners");
        expect(select.tagName.toLowerCase()).toBe("select");
        expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
            ["round", "Rounded"],
            ["square", "Square"]
        ]);
        expect(select.value).toBe("round");
    });

    it("shows units beside a number", () => {
        expect(field(build().form, "radius").textContent).toContain("px");
    });

    it("says so when a skin has no settings", () => {
        const form = buildVarsForm({ vars: [], onChange: () => {} }, document);
        expect(form.textContent).toMatch(/no settings/i);
        expect(form.querySelectorAll("[data-key]")).toHaveLength(0);
    });
});

describe("reporting changes", () => {
    it("reports a range as a number, not a string", () => {
        // The value is substituted into CSS as `8px`. A string here becomes
        // `"8"px` downstream, and the failure is a silently broken stylesheet.
        const { form, changes } = build();
        type(input(form, "density"), "14");
        expect(changes).toEqual([["density", 14]]);
        expect(typeof changes[0][1]).toBe("number");
    });

    it("reports a number as a number", () => {
        const { form, changes } = build();
        type(input(form, "radius"), "12");
        expect(changes).toEqual([["radius", 12]]);
    });

    it("reports a checkbox as 0 or 1", () => {
        // The format says a checkbox default is `0` or `1`, not a boolean, and
        // CSS reads it back as a custom property.
        const { form, changes } = build();
        const box = input(form, "thumbs");
        box.checked = false;
        box.dispatchEvent(new window.Event("change", { bubbles: true }));
        expect(changes).toEqual([["thumbs", 0]]);
    });

    it("reports a select by its key, not its value", () => {
        const { form, changes } = build();
        const select = input(form, "corners");
        select.value = "square";
        select.dispatchEvent(new window.Event("change", { bubbles: true }));
        expect(changes).toEqual([["corners", "square"]]);
    });

    it("reports on every keystroke rather than waiting for a submit", () => {
        // Live application to the open page is the point; a Save button would
        // trade the best thing about the product for a few fewer messages.
        const { form, changes } = build();
        type(input(form, "title"), "S");
        type(input(form, "title"), "St");
        expect(changes).toEqual([
            ["title", "S"],
            ["title", "St"]
        ]);
    });

    it("does not report a half-typed number", () => {
        // Clearing the field to retype it must not push NaN into a live page.
        const { form, changes } = build();
        type(input(form, "radius"), "");
        expect(changes).toEqual([]);
    });

    it("updates the slider's readout as it moves", () => {
        const { form } = build();
        const readout = field(form, "density").querySelector("output");
        expect(readout.textContent).toBe("8px");
        type(input(form, "density"), "20");
        expect(readout.textContent).toBe("20px");
    });
});

describe("the colour control", () => {
    it("shows the stored value in the text field and the picker", () => {
        const { form } = build({ values: { accent: "#00ff00" } });
        const picker = field(form, "accent").querySelector("[data-role='picker']");
        expect(picker.value).toBe("#00ff00");
        expect(input(form, "accent").value).toBe("#00ff00");
    });

    it("keeps rgba() as typed, and shows the nearest opaque colour in the well", () => {
        // A translucent overlay is exactly what an author reaches for, and
        // `<input type=color>` cannot hold one. Losing the alpha on load would
        // silently rewrite the skin.
        const { form, changes } = build({ values: { accent: "rgba(255, 0, 0, 0.5)" } });
        const picker = field(form, "accent").querySelector("[data-role='picker']");
        expect(input(form, "accent").value).toBe("rgba(255, 0, 0, 0.5)");
        expect(picker.value).toBe("#ff0000");

        type(input(form, "accent"), "rgba(0, 0, 255, 0.25)");
        expect(changes.at(-1)).toEqual(["accent", "rgba(0, 0, 255, 0.25)"]);
    });

    it("expands a three-digit hex for the picker", () => {
        const { form } = build({ values: { accent: "#f60" } });
        expect(field(form, "accent").querySelector("[data-role='picker']").value).toBe("#ff6600");
    });
});

describe("stored values", () => {
    it("prefers a stored value over the declared default", () => {
        const { form } = build({ values: { title: "Front page", density: 20, corners: "square" } });
        expect(input(form, "title").value).toBe("Front page");
        expect(input(form, "density").value).toBe("20");
        expect(input(form, "corners").value).toBe("square");
    });

    it("falls back to the first option when a stored choice no longer exists", () => {
        // A skin update that renamed an option must not leave an unselectable
        // control the user cannot get out of.
        const { form } = build({ values: { corners: "gone" } });
        expect(input(form, "corners").value).toBe("round");
    });
});

describe("reset to defaults", () => {
    it("puts every control back and reports each one", () => {
        const { form, changes } = build({ values: { title: "Changed", density: 20, thumbs: 0 } });
        changes.length = 0;

        form.querySelector("button.o-reset").click();

        expect(input(form, "title").value).toBe("Stories");
        expect(input(form, "density").value).toBe("8");
        expect(input(form, "thumbs").checked).toBe(true);
        expect(Object.fromEntries(changes)).toEqual({
            title: "Stories",
            accent: "#ff6600",
            thumbs: 1,
            radius: 8,
            density: 8,
            corners: "round"
        });
    });
});

describe("readValues", () => {
    it("reads the form back in the shape it is stored in", () => {
        const { form } = build({ values: { title: "Front page", density: 20, thumbs: 0, corners: "square" } });
        expect(readValues(form)).toEqual({
            title: "Front page",
            accent: "#ff6600",
            thumbs: 0,
            radius: 8,
            density: 20,
            corners: "square"
        });
    });

    it("round-trips through the controls", () => {
        const { form } = build();
        type(input(form, "title"), "Edited");
        type(input(form, "density"), "16");
        const values = readValues(form);
        expect(values.title).toBe("Edited");
        expect(values.density).toBe(16);
    });

    it("survives being handed nothing", () => {
        expect(readValues(null)).toEqual({});
    });
});

describe("labels", () => {
    it("ties every label to its control, so a tap on the label works", () => {
        const { form } = build();
        for (const variable of VARS) {
            const label = field(form, variable.key).querySelector("label");
            expect(label.textContent).toBe(variable.label);
            expect(label.getAttribute("for")).toBeTruthy();
        }
    });

    it("gives two forms on one page distinct control ids", () => {
        const a = buildVarsForm({ vars: VARS, onChange: () => {} }, document);
        const b = buildVarsForm({ vars: VARS, onChange: () => {} }, document);
        const idOf = (form) => field(form, "title").querySelector("label").getAttribute("for");
        expect(idOf(a)).not.toBe(idOf(b));
    });
});
