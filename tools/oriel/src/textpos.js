/**
 * Line numbers for text and JSON, so validation errors can say `file:line`
 * instead of "somewhere in this file".
 *
 * @module textpos
 */

/** 1-based line number of a character offset. */
export function lineAt(text, offset) {
    let line = 1;
    const end = Math.min(offset, text.length);
    for (let i = 0; i < end; i++) {
        if (text[i] === "\n") line++;
    }
    return line;
}

/**
 * Node's `JSON.parse` error messages carry "(line N column M)" on modern
 * Node; older ones only carry a character position. Handle both so a bad
 * skin.json still gets a line number.
 */
export function lineFromJsonError(err, text) {
    const withLine = /line (\d+)/.exec(err.message);
    if (withLine) return Number(withLine[1]);
    const withPos = /position (\d+)/.exec(err.message);
    if (withPos) return lineAt(text, Number(withPos[1]));
    return 1;
}

/**
 * Walks already-valid JSON text and records the 1-based line each value
 * starts on, keyed by a JSON-pointer-ish path ("vars[1].default", "[3].op").
 * This is a shape walk, not a validator — call it only after `JSON.parse`
 * has already accepted the text, so every token is guaranteed well-formed
 * and the walker can stay lenient.
 *
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function indexJsonLines(text) {
    const lines = new Map();
    let i = 0;
    let line = 1;
    const len = text.length;

    function advance() {
        if (text[i] === "\n") line++;
        i++;
    }
    function skipWs() {
        while (i < len && /\s/.test(text[i])) advance();
    }
    function skipString() {
        advance(); // opening quote
        while (i < len) {
            if (text[i] === "\\") { advance(); advance(); continue; }
            if (text[i] === "\"") { advance(); return; }
            advance();
        }
    }
    function skipScalar() {
        while (i < len && !/[,}\]\s"]/.test(text[i])) advance();
    }
    function stringValue() {
        const start = i + 1;
        skipString();
        return text.slice(start, i - 1);
    }
    function parseValue(path) {
        skipWs();
        lines.set(path, line);
        const ch = text[i];
        if (ch === "{") parseObject(path);
        else if (ch === "[") parseArray(path);
        else if (ch === "\"") skipString();
        else skipScalar();
    }
    function parseObject(path) {
        advance(); // {
        skipWs();
        if (text[i] === "}") { advance(); return; }
        for (;;) {
            skipWs();
            const key = stringValue();
            skipWs();
            advance(); // :
            parseValue(path ? `${path}.${key}` : key);
            skipWs();
            if (text[i] === ",") { advance(); continue; }
            if (text[i] === "}") { advance(); return; }
            return; // malformed beyond this point — bail rather than loop forever
        }
    }
    function parseArray(path) {
        advance(); // [
        skipWs();
        if (text[i] === "]") { advance(); return; }
        let idx = 0;
        for (;;) {
            parseValue(`${path}[${idx}]`);
            idx++;
            skipWs();
            if (text[i] === ",") { advance(); skipWs(); continue; }
            if (text[i] === "]") { advance(); return; }
            return;
        }
    }

    try {
        parseValue("");
    } catch {
        // best-effort — a partial index is still more useful than none
    }
    return lines;
}
