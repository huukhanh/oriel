# 001 — Distribution: personal signing with a free Apple account

**Date:** 2026-08-03
**Status:** accepted

## Decision

Ship to the developer's own device by personal signing with a **free** Apple
account. No App Store submission, no TestFlight, no paid developer program.

## Why

The media features are the reason the app exists. Forcing background playback
and PiP on sites where those are paid features is exactly the kind of thing
App Store review rejects, and designing around a reviewer would gut §7 before
a line of it is written. Not submitting removes the constraint entirely.

Cost is the second reason: the brainstorm's §1 scope is "one person,
evenings-and-weekends", and $99/yr for an app with one user is hard to justify
before the premise in Phase 0 is even proven.

## Consequences

- **7-day re-signing cycle.** The app stops launching a week after each build.
  Re-signing is a rebuild from Xcode, so the dev loop already covers it, but it
  means the app can never be "installed and forgotten".
- Free accounts are capped at 3 sideloaded apps and 10 App IDs per 7 days.
  Throwaway spike projects (Phase 0) burn App IDs — reuse one bundle ID for
  spikes rather than minting a new one each time.
- No push notifications, no App Groups, no background-processing entitlements
  beyond `UIBackgroundModes: audio`, which is available on free accounts.
- The built-in script library (§10, Phase 6) can ship whatever works. No
  review-driven split between "built-in" and "user must paste this themselves".
- Revisit if the app is ever shared with anyone else. Upgrading to a paid
  account later is a signing-settings change, not a rewrite.

## Alternatives considered

- **Paid developer account + TestFlight** — removes the weekly re-sign and
  gives 1-year signing. Rejected for now on cost; TestFlight builds still get a
  review pass, so it does not fully buy back the §7 freedom. Cheap to switch to
  later if the 7-day cycle becomes the main friction.
- **App Store release** — rejected. Review risk lands squarely on the features
  the app is for, and there is no second user to justify the work.

Related: [[002-builtin-script-storage]]
