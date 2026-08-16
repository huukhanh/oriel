## What

One paragraph. Closes #.

## Design notes

Non-obvious choices, and what was rejected.

## Proven

```
lint clean · unit NNN/NNN · e2e (chromium) NN/NN · e2e (webkit) NN/NN
```

## Not proven

Anything under `apple/` — there is no Swift toolchain on the dev box, and no
Safari anywhere in the loop. Say which of the two it is.

If this changes behaviour on Safari specifically, say what you expect to happen
and how a person with a phone would tell whether it did. See
[docs/VERIFICATION.md](../docs/VERIFICATION.md).

## Format changes

Did `docs/SKIN-FORMAT.md` change? If a skin that used to install would now fail —
or worse, would now install and behave differently — say so here and bump the
`format` number.
