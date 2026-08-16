import { describe, it, expect } from "vitest";
import {
    parseVarDeclaration,
    normalizeVars,
    defaultValues,
    coerceValue,
    cssVariableBlock,
    substituteCss,
    interpolate
} from "../extension/src/core/vars.js";

describe("parseVarDeclaration - text", () => {
    it("parses a quoted default", () => {
        const v = parseVarDeclaration("text", 'greeting "Greeting" "Hello there"');
        expect(v).toEqual({ key: "greeting", type: "text", label: "Greeting", default: "Hello there" });
    });

    it("parses a bare-token default", () => {
        const v = parseVarDeclaration("text", "greeting \"Greeting\" Hello");
        expect(v.default).toBe("Hello");
    });

    it("strips double-then-single quoting for a default containing a colon", () => {
        const v = parseVarDeclaration("text", `weird "Weird" "'val:ue'"`);
        expect(v.default).toBe("val:ue");
    });

    it("splits a label and tooltip on a literal \\n", () => {
        const v = parseVarDeclaration("text", 'k "Label\\nTooltip text" default');
        expect(v.label).toBe("Label");
        expect(v.tooltip).toBe("Tooltip text");
    });
});

describe("parseVarDeclaration - color", () => {
    it("keeps the default colour verbatim", () => {
        const v = parseVarDeclaration("color", 'accent "Accent" #ff6600');
        expect(v).toEqual({ key: "accent", type: "color", label: "Accent", default: "#ff6600" });
    });
});

describe("parseVarDeclaration - checkbox", () => {
    it("accepts 1", () => {
        expect(parseVarDeclaration("checkbox", 'thumbs "Show avatars" 1').default).toBe(1);
    });

    it("accepts 0", () => {
        expect(parseVarDeclaration("checkbox", 'thumbs "Show avatars" 0').default).toBe(0);
    });

    it("rejects anything else", () => {
        expect(() => parseVarDeclaration("checkbox", 'thumbs "Show avatars" yes')).toThrow(/0 or 1/);
    });
});

describe("parseVarDeclaration - range/number", () => {
    it("fills default, min, max, step in order, with units", () => {
        const v = parseVarDeclaration("range", 'density "Row spacing" [8, 2, 24, 1, "px"]');
        expect(v).toMatchObject({ key: "density", type: "range", default: 8, min: 2, max: 24, step: 1, units: "px" });
    });

    it("accepts units at a non-final array position", () => {
        const v = parseVarDeclaration("number", 'gap "Gap" [8, "px", 2, 24, 1]');
        expect(v).toMatchObject({ default: 8, min: 2, max: 24, step: 1, units: "px" });
    });

    it("accepts just a default", () => {
        const v = parseVarDeclaration("number", 'solo "Solo" [8]');
        expect(v).toMatchObject({ default: 8 });
        expect(v.min).toBeUndefined();
    });

    it("treats null entries as absent", () => {
        const v = parseVarDeclaration("number", 'gapped "Gapped" [8, null, 24]');
        expect(v).toMatchObject({ default: 8, min: 24 });
        expect(v.max).toBeUndefined();
    });

    it("rejects a bare .5 with no leading zero — the real Stylus trap", () => {
        expect(() => parseVarDeclaration("number", 'frac "Frac" [.5]')).toThrow(/must be a JSON array/);
    });

    it("accepts a leading-zero fraction", () => {
        const v = parseVarDeclaration("number", 'frac "Frac" [0.5]');
        expect(v.default).toBe(0.5);
    });
});

describe("parseVarDeclaration - select, array form", () => {
    it("marks the trailing-* entry as the default, stripping the star", () => {
        const v = parseVarDeclaration("select", 'font "Font" ["Arial", "Consolas*", "Times New Roman"]');
        expect(v.options).toEqual([
            { key: "Arial", label: "Arial", value: "Arial" },
            { key: "Consolas", label: "Consolas", value: "Consolas" },
            { key: "Times New Roman", label: "Times New Roman", value: "Times New Roman" }
        ]);
        expect(v.default).toBe("Consolas");
    });

    it("defaults to the first entry when none is starred", () => {
        const v = parseVarDeclaration("select", 'font "Font" ["Arial", "Consolas"]');
        expect(v.default).toBe("Arial");
    });
});

describe("parseVarDeclaration - select, object form", () => {
    const src = 'corners "Corner style" {\n  "near_black:Near Black": "#222",\n  "near_white:Near White*": "#ddd"\n}';

    it("reads the object key as OPTION_KEY:OPTION_LABEL, key first", () => {
        const v = parseVarDeclaration("select", src);
        expect(v.options).toEqual([
            { key: "near_black", label: "Near Black", value: "#222" },
            { key: "near_white", label: "Near White", value: "#ddd" }
        ]);
    });

    it("marks the starred entry as the default", () => {
        const v = parseVarDeclaration("select", src);
        expect(v.default).toBe("near_white");
    });

    it("uses the whole string as both key and label when there is no colon", () => {
        const v = parseVarDeclaration("select", 'x "X" {"solo": "1"}');
        expect(v.options).toEqual([{ key: "solo", label: "solo", value: "1" }]);
    });
});

describe("parseVarDeclaration - dropdown and image alias to select", () => {
    it("dropdown becomes type select", () => {
        expect(parseVarDeclaration("dropdown", 'x "X" ["a*", "b"]').type).toBe("select");
    });

    it("image becomes type select", () => {
        expect(parseVarDeclaration("image", 'x "X" ["a*", "b"]').type).toBe("select");
    });
});

describe("parseVarDeclaration - errors", () => {
    it("throws on an unknown type", () => {
        expect(() => parseVarDeclaration("bogus", 'x "X" 1')).toThrow(/unknown type/);
    });

    it("throws when the key is missing", () => {
        expect(() => parseVarDeclaration("text", '"Label" default')).toThrow();
    });

    it("throws when the label is unquoted", () => {
        expect(() => parseVarDeclaration("text", "key Label default")).toThrow(/"label"/);
    });
});

describe("normalizeVars", () => {
    it("accepts a well-formed skin.json-shaped var array", () => {
        const { vars, errors } = normalizeVars([
            { key: "density", type: "range", label: "Row spacing", default: 8, min: 2, max: 24, step: 1, units: "px" }
        ]);
        expect(errors).toEqual([]);
        expect(vars).toEqual([
            { key: "density", type: "range", label: "Row spacing", default: 8, min: 2, max: 24, step: 1, units: "px" }
        ]);
    });

    it("drops an entry with an unknown type and reports it", () => {
        const { vars, errors } = normalizeVars([{ key: "x", type: "bogus", default: "1" }]);
        expect(vars).toEqual([]);
        expect(errors[0].message).toMatch(/unknown var type/);
    });

    it("drops an entry missing its key", () => {
        const { vars, errors } = normalizeVars([{ type: "text", default: "x" }]);
        expect(vars).toEqual([]);
        expect(errors[0].message).toMatch(/key/);
    });

    it("drops an entry missing its default", () => {
        const { vars, errors } = normalizeVars([{ key: "x", type: "text" }]);
        expect(vars).toEqual([]);
        expect(errors[0].message).toMatch(/default/);
    });

    it("falls back label to key when absent", () => {
        const { vars } = normalizeVars([{ key: "x", type: "text", default: "hi" }]);
        expect(vars[0].label).toBe("x");
    });

    it("is empty for undefined input, without throwing", () => {
        expect(normalizeVars(undefined)).toEqual({ vars: [], errors: [] });
    });
});

describe("coerceValue - number/range", () => {
    const v = { key: "density", type: "range", default: 8, min: 2, max: 24, step: 5 };

    it("passes through a value already in range and on-step", () => {
        expect(coerceValue(v, 12)).toBe(12);
    });

    it("clamps above max, then snaps to the nearest step within range", () => {
        expect(coerceValue(v, 999)).toBe(22);
    });

    it("clamps below min", () => {
        expect(coerceValue(v, -5)).toBe(2);
    });

    it("snaps to the nearest step", () => {
        expect(coerceValue(v, 13)).toBe(12);
    });

    it("falls back to the default for a non-numeric value", () => {
        expect(coerceValue(v, "not a number")).toBe(8);
    });
});

describe("coerceValue - checkbox", () => {
    const v = { key: "thumbs", type: "checkbox", default: 0 };

    it("normalizes truthy spellings to 1", () => {
        expect(coerceValue(v, "1")).toBe(1);
        expect(coerceValue(v, true)).toBe(1);
    });

    it("normalizes falsy spellings to 0", () => {
        expect(coerceValue(v, "0")).toBe(0);
        expect(coerceValue(v, false)).toBe(0);
    });

    it("falls back to the default for garbage", () => {
        expect(coerceValue(v, "garbage")).toBe(0);
    });
});

describe("coerceValue - select", () => {
    const v = {
        key: "corners",
        type: "select",
        default: "round",
        options: [{ key: "round", label: "Rounded", value: "12px" }, { key: "square", label: "Square", value: "0" }]
    };

    it("passes through a known key", () => {
        expect(coerceValue(v, "square")).toBe("square");
    });

    it("falls back to the default for an unknown key", () => {
        expect(coerceValue(v, "triangle")).toBe("round");
    });
});

describe("coerceValue - text/color", () => {
    it("passes a string through unchanged", () => {
        expect(coerceValue({ type: "text", default: "x" }, "hello")).toBe("hello");
    });

    it("falls back to the default for a non-string, non-number value", () => {
        expect(coerceValue({ type: "color", default: "#000" }, null)).toBe("#000");
    });
});

describe("defaultValues", () => {
    it("builds a record keyed by var, using each default", () => {
        const vars = [
            { key: "a", type: "text", default: "hi" },
            { key: "b", type: "range", default: 8, min: 2, max: 24, step: 1 }
        ];
        expect(defaultValues(vars)).toEqual({ a: "hi", b: 8 });
    });
});

describe("cssVariableBlock", () => {
    it("emits one declaration per simple var", () => {
        const vars = [{ key: "accent", type: "color", default: "#ff6600" }];
        expect(cssVariableBlock(vars, { accent: "#ff6600" })).toBe(":root {\n  --accent: #ff6600;\n}");
    });

    it("appends units for number/range", () => {
        const vars = [{ key: "density", type: "range", default: 8, units: "px" }];
        expect(cssVariableBlock(vars, { density: 12 })).toBe(":root {\n  --density: 12px;\n}");
    });

    it("emits the option's value plus a -key companion for select", () => {
        const vars = [
            {
                key: "corners",
                type: "select",
                default: "round",
                options: [{ key: "round", label: "Rounded", value: "12px" }, { key: "square", label: "Square", value: "0" }]
            }
        ];
        const block = cssVariableBlock(vars, { corners: "square" });
        expect(block).toBe(":root {\n  --corners: 0;\n  --corners-key: square;\n}");
    });

    it("does the same for image vars", () => {
        const vars = [
            {
                key: "bg",
                type: "image",
                default: "a",
                options: [{ key: "a", label: "A", value: "url(a.png)" }]
            }
        ];
        expect(cssVariableBlock(vars, { bg: "a" })).toBe(":root {\n  --bg: url(a.png);\n  --bg-key: a;\n}");
    });

    it("emits checkbox and text vars as their raw value", () => {
        const vars = [
            { key: "thumbs", type: "checkbox", default: 0 },
            { key: "note", type: "text", default: "hi" }
        ];
        expect(cssVariableBlock(vars, { thumbs: 1, note: "hi" })).toBe(":root {\n  --thumbs: 1;\n  --note: hi;\n}");
    });

    it("drops a value containing } or < entirely, rather than emitting it", () => {
        const vars = [
            { key: "accent", type: "color", default: "red" },
            { key: "safe", type: "text", default: "ok" }
        ];
        const block = cssVariableBlock(vars, { accent: "red}} body{color:red", safe: "ok" });
        expect(block).not.toContain("accent");
        expect(block).toContain("--safe: ok;");
    });

    it("uses a custom selector", () => {
        const vars = [{ key: "a", type: "text", default: "x" }];
        expect(cssVariableBlock(vars, { a: "x" }, ".skin")).toBe(".skin {\n  --a: x;\n}");
    });

    it("returns an empty string for no vars", () => {
        expect(cssVariableBlock([], {})).toBe("");
    });
});

describe("substituteCss", () => {
    const vars = [
        { key: "accent", type: "color", default: "#ff6600" },
        { key: "density", type: "range", default: 8, units: "px" },
        {
            key: "corners",
            type: "select",
            default: "round",
            options: [{ key: "round", label: "Rounded", value: "12px" }]
        }
    ];
    const values = { accent: "#123456", density: 12, corners: "round" };

    it("substitutes a simple placeholder", () => {
        expect(substituteCss("a { color: /*[[accent]]*/; }", vars, values)).toBe("a { color: #123456; }");
    });

    it("appends units for number/range placeholders", () => {
        expect(substituteCss("gap: /*[[density]]*/;", vars, values)).toBe("gap: 12px;");
    });

    it("substitutes a select placeholder with the option's value", () => {
        expect(substituteCss("radius: /*[[corners]]*/;", vars, values)).toBe("radius: 12px;");
    });

    it("leaves an unknown placeholder untouched", () => {
        expect(substituteCss("x: /*[[nope]]*/;", vars, values)).toBe("x: /*[[nope]]*/;");
    });
});

describe("interpolate", () => {
    it("replaces a known key", () => {
        expect(interpolate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
    });

    it("leaves an unknown key untouched", () => {
        expect(interpolate("Hello {{nope}}!", { name: "World" })).toBe("Hello {{nope}}!");
    });
});
