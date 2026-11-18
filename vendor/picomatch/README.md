# PM Canvas picomatch security patch

This directory contains the runtime files from the MIT-licensed `picomatch@4.0.7`
npm distribution. The original license is retained in `LICENSE`.

Source: <https://github.com/micromatch/picomatch/tree/4.0.7>

Advisory: [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
The registry has no patched release as of 2026-11-18. Desktop and mobile use a
local override so clean installs also use this reviewed patch; no install hook
or network fork is required. The upstream version is identified by the explicit
`4.0.7-pmcanvas.1` suffix, not presented as an upstream release.

The change in `lib/parse.js` sends repeated `+(...)` and `*(...)` extglob bodies
containing an unescaped `*` or `?` through the parser's existing literal fallback.
This prevents ambiguous nested repetition for patterns such as `+(*)`, `+(*a)`
and `+(*a|b)`. The guard also applies if the caller disables the older recursion
guard. Ordinary globs, literal repetitions and alternatives keep their existing
behavior. Repeated wildcard extglobs intentionally match their literal spelling
instead of expanding; this conservative restriction is limited to development
and packaging tools and must remain covered by build tests.

`scripts/test-picomatch.mjs` verifies the patch, normal matching, all installed
instances used by both products, and bounded execution of malicious patterns in
a separate process. CI runs it before the unchanged `npm audit` checks. Replace
this override with a verified upstream patched release when one becomes available.
