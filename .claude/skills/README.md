# Skill kit — scriptable WebView browser (iOS), developed headless

Six Claude Code skills that let an agent own this project from a GUI-less Ubuntu
box: plan, break down, implement, verify what's verifiable, open PRs, merge what
it's allowed to merge, and hand you precise test steps for your Mac and iPhone.

## Install

Copy into the repo you created (project-scoped, version-controlled, shared with
anyone else who clones):

```bash
cd /path/to/your-repo
cp -r /path/to/kit/.claude .
cp .claude/skills/project-lead/assets/CLAUDE.md.example CLAUDE.md
mkdir -p docs && cp /path/to/brainstorm.md docs/brainstorm.md   # the full file
git add -A && git commit -m "chore: add project skills"
```

Then open Claude Code in the repo and say: **"bootstrap the project"**.

It will read the brainstorm, run `bootstrap_repo.sh` (SwiftPM `Core` package,
JS test harness, CI, PR template, docs), ask you three design questions that
change the schema, write `docs/ROADMAP.md`, and open the Phase 0 issue.

Prerequisites on the Ubuntu box: `git`, `gh` (authenticated), `node` 20+, and a
Swift toolchain from swift.org — without Swift, roughly half the project loses
its only means of verification.

## The skills

| Skill | Owns |
|---|---|
| `project-lead` | roadmap, task breakdown, the per-task loop, progress reporting |
| `webkit-injection` | the WebKit/media invariants — worlds, script sets, CSP, config immutability, PiP limits |
| `blind-swift` | writing Swift with no compiler: API confidence tiers, concurrency traps, pbxproj rules |
| `linux-verification` | what's provable here — `Core` unit tests, jsdom tests for injected JS, lint, CI |
| `github-flow` | branches, commits, PR template, and the merge gate |
| `device-testing` | `TESTING.md`, per-PR test plans, simulator vs. real device, Web Inspector |

## The idea they encode

Everything follows from one fact: **the agent cannot compile the app.**

So the project is split into a provable half and a blind half, and the skills
push work toward the provable half. `@match` compilation, metadata parsing,
wrapper generation, and every line of injected JavaScript are testable on Linux —
that's most of the interesting logic in the brainstorm. What's left in `App/` is
glue, kept small, always labelled unverified, and never merged until you've built it.

Two habits are worth watching for early, because they're what makes this work or
not: the agent should be flagging uncertain API signatures in PR bodies under
**Assumptions** rather than writing confident-looking guesses, and it should be
extracting a testable kernel out of tasks that look purely platform-shaped. If you
see a platform PR with no test changes and no assumptions listed, push back.

## What to do first

Phase 0 is a throwaway spike that answers whether background audio survives a
locked screen on a real device. The brainstorm rates it "⚠️ mostly / flaky" and
moves on, but it's the reason the app exists, and the answer scopes everything
downstream. Don't let planning run ahead of it.
