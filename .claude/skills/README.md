# Skills — Oriel, a skin engine for the web

Five skills that let an agent own this project from a GUI-less Linux box: plan,
implement, verify what is verifiable, open PRs, merge what it is allowed to
merge, and hand the user precise steps for the one thing no machine here can
check — a real iPhone.

| Skill | For |
|---|---|
| `project-lead` | What to work on next; turning a want into a shippable task |
| `extension-injection` | The measured rules about getting a skin onto someone else's page |
| `linux-verification` | What can be proven here, and the three environment traps |
| `blind-swift` | The small amount of Swift in `apple/`, written without a compiler |
| `device-testing` | Writing a device test worth someone's afternoon |
| `github-flow` | Branch, commit, PR, and the merge gate |

## The shape of the project these assume

Oriel is a cross-browser extension that stores and applies **skins** — packages
of CSS, declarative layout operations and optional JavaScript that completely
change a website's interface. Users install one by pasting it or giving a GitHub
link; developers author them on a desktop and publish to GitHub.

Two facts drive almost every rule in these skills:

1. **Most of the product is pure logic**, kept that way on purpose by a lint rule,
   and therefore provable in Node on a machine with no browser.
2. **The target browser is Safari on iOS**, and there is no Safari, no Mac and no
   iPhone in the development loop. The gap is real, it is named in
   `docs/VERIFICATION.md`, and it is closed by a person, not by CI.

Read `docs/SKIN-FORMAT.md` before touching `extension/src/core/` — it is
normative, and when code and document disagree the document is the bug report.
