#!/usr/bin/env bash
# Lay down the project skeleton. Idempotent: skips anything that exists.
# Run from the repo root. Read before running.
set -euo pipefail

say() { printf '  %s\n' "$*"; }

say "toolchain check"
command -v swift >/dev/null || say "WARNING: no swift toolchain — Core tests will not run. Install from swift.org or via swiftly."
command -v node  >/dev/null || say "WARNING: no node — web tests will not run."
command -v gh    >/dev/null || say "WARNING: no gh CLI — PR automation unavailable."

mkdir -p docs/decisions Core/Sources/Core Core/Tests/CoreTests web/src/builtins web/test .github/workflows

# ---------- Core: Foundation-only Swift package, builds on Linux ----------
if [ ! -f Core/Package.swift ]; then
  say "Core/Package.swift"
  cat > Core/Package.swift <<'EOF'
// swift-tools-version: 5.9
import PackageDescription

// Foundation-only. Must never import WebKit/UIKit/SwiftUI/SwiftData —
// those do not exist on Linux and would break the only CI this project has.
let package = Package(
    name: "Core",
    products: [.library(name: "Core", targets: ["Core"])],
    targets: [
        .target(name: "Core"),
        .testTarget(name: "CoreTests", dependencies: ["Core"]),
    ]
)
EOF
  cat > Core/Sources/Core/Placeholder.swift <<'EOF'
import Foundation

/// Replaced by the match compiler, metadata parser, and wrapper builder.
public enum Core {
    public static let version = "0.0.1"
}
EOF
  cat > Core/Tests/CoreTests/PlaceholderTests.swift <<'EOF'
import XCTest
@testable import Core

final class PlaceholderTests: XCTestCase {
    func testHarnessRuns() {
        XCTAssertEqual(Core.version, "0.0.1")
    }
}
EOF
fi

# ---------- web: injected JS, tested with vitest + jsdom ----------
if [ ! -f web/package.json ]; then
  say "web/package.json"
  cat > web/package.json <<'EOF'
{
  "name": "injected-web",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "check": "node --check src/prelude.js"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "jsdom": "^25.0.0"
  }
}
EOF
  cat > web/vitest.config.js <<'EOF'
export default { test: { environment: "jsdom" } };
EOF
  cat > web/src/prelude.js <<'EOF'
// Injected once per content world, at document-start, before any user script.
// Responsibilities: patch history exactly once and dispatch __inj:navigate,
// install the GM shim, capture console. See .claude/skills/webkit-injection.
export function installPrelude(win = window) {
  if (win.__injPreludeInstalled) return;
  win.__injPreludeInstalled = true;

  const fire = () => win.dispatchEvent(new win.Event("__inj:navigate"));
  const { pushState, replaceState } = win.history;
  win.history.pushState = function (...a) { pushState.apply(this, a); fire(); };
  win.history.replaceState = function (...a) { replaceState.apply(this, a); fire(); };
  win.addEventListener("popstate", fire);
}
EOF
  cat > web/test/prelude.test.js <<'EOF'
import { describe, it, expect } from "vitest";
import { installPrelude } from "../src/prelude.js";

describe("prelude", () => {
  it("patches history exactly once", () => {
    installPrelude(window);
    const patched = window.history.pushState;
    installPrelude(window);
    expect(window.history.pushState).toBe(patched);
  });

  it("dispatches __inj:navigate on pushState", () => {
    installPrelude(window);
    let n = 0;
    window.addEventListener("__inj:navigate", () => n++);
    window.history.pushState({}, "", "/watch");
    expect(n).toBe(1);
  });
});
EOF
fi

# ---------- CI: Linux only, and says so ----------
if [ ! -f .github/workflows/linux-checks.yml ]; then
  say ".github/workflows/linux-checks.yml"
  cat > .github/workflows/linux-checks.yml <<'EOF'
# Linux-only checks. This does NOT build the iOS app — there is no macOS
# runner here. A green check means Core and web logic pass; it says nothing
# about whether App/ compiles.
name: linux-checks
on: [pull_request, push]
jobs:
  core:
    runs-on: ubuntu-latest
    container: swift:5.9
    steps:
      - uses: actions/checkout@v4
      - run: swift build --package-path Core
      - run: swift test --package-path Core
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci --prefix web || npm install --prefix web
      - run: npm test --prefix web
EOF
fi

# ---------- docs and templates ----------
[ -f docs/api-notes.md ] || cat > docs/api-notes.md <<'EOF'
# API notes

Signatures the compiler has actually accepted or rejected. Append after every
build failure caused by a wrong guess. Read this before writing platform code —
it is this project's substitute for having a compiler.

| Symbol | Correct form | Learned |
|---|---|---|
EOF

[ -f docs/userscript-api.md ] || cat > docs/userscript-api.md <<'EOF'
# Userscript API

What scripts running in this app can rely on: supported metadata keys, the GM
shim surface, the re-entry and cleanup contract, and known differences from
Tampermonkey. Keep current — pasted third-party scripts are judged against this.
EOF

[ -f .github/pull_request_template.md ] || cat > .github/pull_request_template.md <<'EOF'
## What

Closes #

## Design notes

## Proven on Linux
Core: · web: · lint:

## NOT proven
Everything under App/ — no compiler on the dev box.

## Assumptions (Tier 2 API — check these first)
-

## New files (add to the Xcode target)
-

## Device test plan
1.

Report back: pass/fail per step, plus any Xcode errors verbatim.
EOF

[ -f .gitignore ] || cat > .gitignore <<'EOF'
.DS_Store
.build/
node_modules/
DerivedData/
*.xcuserstate
xcuserdata/
EOF

say "done. Next: fill docs/ROADMAP.md, answer the three open decisions, open Phase 0."
