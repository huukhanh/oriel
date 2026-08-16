---
name: device-testing
description: Writing the device test the user actually runs on their iPhone — how to get them a build, what is worth asking, and how to get a useful answer back. Use this whenever preparing work that changes behaviour on Safari, when the user asks how to test something, or before handing anything back for verification. Trigger it before any device handoff — an untestable handoff wastes the one resource this project cannot buy more of.
---

# Asking someone to test on a phone

The user has an iPhone and limited patience. Every question costs them
attention, and a badly framed one costs them an afternoon and returns nothing.

## First: does this need a device at all?

Usually not. Before writing a test plan, check whether the question can be
answered by:

- a unit test (all of `core/`, and anything taking its DOM as an argument);
- the Chromium e2e suite (manifest, service worker, content script, protocol);
- the WebKit e2e suite (the HTML parser, the URL parser, CSP, timing).

A device test is for what is *structurally* unknowable here: Safari's own
extension host, iOS's permission flow, and whether anything is usable with a
thumb. If the answer would not change a design decision, it is not worth a
build cycle.

## Getting them a build

Two routes; offer the easy one first.

**Prebuilt.** The `apple` workflow (manual, and on `v*` tags) produces an
unsigned `.ipa` as an artifact. Link the run directly. They sign it with their
own Apple ID via SideStore / AltStore / Sideloadly, then trust the certificate
in Settings → General → VPN & Device Management. A free Apple ID signature lasts
**seven days**; say so, and say that skins survive re-signing.

**From source.** Needed when you want real Xcode error messages:

```sh
pnpm install && pnpm build
cd apple && xcodegen generate && open Oriel.xcodeproj
```

Signing team must be set on **both** targets. If the Swift has changed since the
last green `apple` run, say so and ask for the **first** error only — Swift
cascades are noise after it.

## The shape of a good test plan

- **Lead with the one question that matters most**, and say it is the one that
  matters. "If you only have ten minutes, do this." Everything else is optional.
- **Number the questions.** They will answer by number.
- **Give exact tap paths**, including the older-iOS variant. Settings moved
  between iOS 17 and 18 and a wrong path reads as "it doesn't work".
- **Paste-ready inputs.** A skin to paste, a URL to paste. Never "install a
  skin" — they will pick a different one and the result will not be comparable.
- **Ask for observations, not diagnoses.** "Is there a coloured bar across the
  top?" beats "does CSS injection work?"
- **Say what each answer changes.** A table mapping answer → consequence is what
  makes the test feel worth doing, and it keeps you honest about whether it is.
- **Invite partial answers explicitly.** "Got to step 3, here's the line, then it
  crashed" is a result, not a failure.

## Getting a useful failure report

Ask for **what you expected** and **what you saw**, separately. For a skin that
did not apply, the manager's Log tab holds a per-skin log — that is the thing to
ask for, because on a phone there is no console.

The `Device test report` issue template collects the structured half. Use it for
routine checks; write a bespoke issue when the questions are specific.

## After the report

Write down what is now known that was not, in `docs/VERIFICATION.md` or the
`extension-injection` skill. A device answer that lives only in a closed issue
will be re-asked in three months.
