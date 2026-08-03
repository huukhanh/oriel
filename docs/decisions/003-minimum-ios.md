# 003 — Minimum deployment target: iOS 18, persistence via SwiftData

**Date:** 2026-08-03
**Status:** accepted

## Decision

Deployment target **iOS 18.0**, as §3 of the brainstorm assumes. Persistence
uses **SwiftData**. Swift 6 language mode.

## Why

There is exactly one user and one device ([[001-distribution]]), so the usual
reason to support an older OS — reach — does not apply. Dropping to iOS 17
would cost real work (SwiftData on 17 is buggy enough to be worth hand-rolling
a Codable store instead) and buy nothing.

iOS 18 also guarantees `isInspectable` (16.4+) and the current WebKit content
world behavior that §5.3 depends on, so no availability checks scattered
through the injection layer.

## Consequences

- SwiftData models are platform code and cannot be compiled or tested on the
  Linux box. This makes the Core/platform boundary matter more, not less:
  **models are plain `Codable` structs in `Core`**, and the SwiftData layer is
  a thin persistence shell over them. The brainstorm's §3 diagram shows
  `ScriptStore (SwiftData)` — that stays, but the `Script`/`Site`/`Binding`
  value types live in `Core` where they are Linux-testable.
- Anything that can be phrased against those structs — match compilation,
  metadata parsing, wrapper generation, ordering, merge of built-ins with user
  scripts ([[002-builtin-script-storage]]) — is provable here. Anything phrased
  against `@Model` is not. Push logic across that line deliberately.
- Swift 6 strict concurrency applies. `WKScriptMessageHandler` callbacks arrive
  on the main actor; store writes triggered from them need explicit isolation.
  Expect this to be the most common compile failure class on the Mac.
- Revisit only if the target device cannot run iOS 18.

## Alternatives considered

- **iOS 17 + hand-rolled Codable store** — would push *more* code into Core and
  therefore more code under test, which is genuinely attractive on this
  project. Rejected because it solves a problem (older OS support) that does
  not exist here, and the Core/platform split above captures most of the
  testability benefit anyway.
