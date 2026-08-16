/**
 * Terminal output. Colour only when the target stream is a TTY — piped
 * output (a test runner, `> file`, a CI log) stays plain.
 *
 * @module log
 */

function paint(stream, code, s) {
    return stream.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
}

const out = process.stdout;
const err = process.stderr;

export const log = {
    /** Plain line, no framing — used for scripted output like `--help`. */
    raw(msg = "") {
        out.write(`${msg}\n`);
    },
    info(msg) {
        out.write(`${msg}\n`);
    },
    ok(msg) {
        out.write(`${paint(out, 32, msg)}\n`);
    },
    warn(msg) {
        err.write(`${paint(err, 33, "warning:")} ${msg}\n`);
    },
    error(msg) {
        err.write(`${paint(err, 31, "error:")} ${msg}\n`);
    }
};

/** `path:line: message`, the format every diagnostic in this tool uses. */
export function formatDiagnostic(d) {
    const tag = d.severity === "warning" ? "warning: " : "";
    return `${d.path}:${d.line ?? 1}: ${tag}${d.message}`;
}
