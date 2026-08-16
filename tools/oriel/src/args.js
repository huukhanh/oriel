/**
 * Long-flag argv parsing, no dependency. `--flag`, `--flag value`,
 * `--flag=value`, positionals, and a `--` terminator after which everything
 * is positional.
 *
 * @module args
 */

export class ArgError extends Error {}

/**
 * @param {string[]} argv
 * @param {{flags?: Record<string, "boolean"|"string">}} [spec]
 *   `spec.flags` maps a flag name (without `--`) to its kind. A flag not
 *   listed there is an error — a typo in a flag name should never be
 *   silently ignored.
 * @returns {{positional: string[], flags: Record<string, string|boolean>}}
 */
export function parseArgs(argv, spec = {}) {
    const types = spec.flags ?? {};
    const positional = [];
    const flags = {};
    let literal = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (!literal && arg === "--") { literal = true; continue; }

        if (!literal && arg.startsWith("--")) {
            const body = arg.slice(2);
            const eq = body.indexOf("=");
            const name = eq === -1 ? body : body.slice(0, eq);
            if (!name) throw new ArgError("\"--\" is not a flag");
            const kind = types[name];
            if (kind === undefined) throw new ArgError(`unknown flag: --${name}`);

            if (eq !== -1) {
                if (kind === "boolean") throw new ArgError(`--${name} does not take a value`);
                flags[name] = body.slice(eq + 1);
                continue;
            }
            if (kind === "boolean") {
                flags[name] = true;
                continue;
            }
            const value = argv[i + 1];
            if (value === undefined) throw new ArgError(`--${name} requires a value`);
            flags[name] = value;
            i++;
            continue;
        }

        positional.push(arg);
    }

    return { positional, flags };
}
