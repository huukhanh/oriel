#!/usr/bin/env node
/**
 * Entry point. Dispatches to a command module and turns a thrown error into
 * a one-line message and a non-zero exit — this is a terminal tool, not a
 * service with logs to grep, so nobody wants a stack trace.
 *
 * @module bin/oriel
 */

import { log } from "../src/log.js";

const USAGE = `oriel <command> [options]

Commands:
  init [dir]       Scaffold a new skin
  dev [dir]        Serve a skin for live preview while you edit
  check [path...]  Validate one or more skins
  bundle [dir]     Emit a self-contained skin.json
  publish [dir]    Print what publishing this skin to GitHub would do

Run "oriel <command> --help" for a command's options.`;

const COMMANDS = {
    init: () => import("../src/commands/init.js"),
    dev: () => import("../src/commands/dev.js"),
    check: () => import("../src/commands/check.js"),
    bundle: () => import("../src/commands/bundle.js"),
    publish: () => import("../src/commands/publish.js")
};

async function main(argv) {
    const [command, ...rest] = argv;

    if (!command || command === "--help" || command === "-h") {
        log.raw(USAGE);
        return 0;
    }

    const load = COMMANDS[command];
    if (!load) {
        log.error(`unknown command: ${command}`);
        log.raw(USAGE);
        return 1;
    }

    const mod = await load();
    return mod.run(rest);
}

main(process.argv.slice(2))
    .then((code) => {
        process.exitCode = code ?? 0;
    })
    .catch((err) => {
        log.error(err.message);
        process.exitCode = 1;
    });
