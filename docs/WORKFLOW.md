# How work is tracked

GitHub issues are the backlog. This page says how they are used, so the state of
the project can be read off the tracker rather than reconstructed from merged
PRs.

## Issues

**Every piece of planned work gets an issue before it is built**, with
acceptance criteria concrete enough to tell whether it is done. An issue that
cannot say what "finished" looks like is not ready to work on.

**Issues opened by a human take priority** over anything already in the backlog.
They are read at the start of each session, before continuing planned work.

**Labels** carry the state that matters here:

| Label | Meaning |
|---|---|
| `blocked-on-device` | Cannot progress without a physical iPhone. Not stalled — *unanswerable* here. |
| `needs-device-check` | Contains platform code, or asks for a device result. |
| `linux-verified` | The automated half passed. |
| `device-verified` | Confirmed on real hardware. |
| `shipped` | Implemented and in a release. |

[Issue #29](https://github.com/huukhanh/oriel/issues/29) is a standing summary of
what is built, verified, and left — kept current, so there is one place to look.

## Branches and PRs

`<type>/<issue>-<slug>` — `feat/26-reorder`, `fix/31-double-listener`.

Every PR states what was **proven** and what was **assumed**, separately. On a
project developed without a Mac in the loop that distinction is the whole point,
and it stays useful now that CI has a real compiler: a green build proves the
code compiles, not that a media feature works on hardware.

## What gates a merge

| Check | What it settles |
|---|---|
| `linux-checks` | Core logic, and the injected JavaScript in a **real WebKit engine** |
| `ios-build` | Compiles against the **real iOS SDK**; simulator and UI tests; the Mac scripts run |
| `release` | An installable `.ipa` and a simulator build are produced |

All green is required. Nothing merges on a local-only signal — see
[decision 007](decisions/007-merge-gate-amendment.md) for why that rule exists
and the one way it was amended.

## Releases

A `v*` tag publishes a GitHub Release with both artifacts. Release notes say
what was **device-verified**, not merely what was merged.

## Decisions

Anything that changed the design away from `docs/brainstorm.md` gets a page in
[`docs/decisions/`](decisions/): what was decided, why, the consequences, and
what was rejected. The rejected alternatives are the part worth writing down —
they are what stops a settled question being reopened from scratch six months
later.
