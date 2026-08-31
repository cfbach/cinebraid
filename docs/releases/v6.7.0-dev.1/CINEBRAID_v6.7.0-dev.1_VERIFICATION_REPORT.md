# CineBraid 6.7.0-dev.1 — verification report

This version changes no application behaviour. It corrects what a public checkout
of CineBraid says about itself — its licence, its version identity, its
documentation, the network requests its shell makes — and it repairs the
credential scan that had never run. The evidence below is therefore about two
things: that the corrections are real, and that nothing else moved with them.

## Version identity

`package.json` "version" is the only hand-edited version. It moved from
`6.7.0-private.1` to `6.7.0-dev.1`; the core version is unchanged.

`release-identity.js` was not modified. Its documented behaviour for a channel
that is not in `CHANNEL_LABELS` — "it simply displays its raw version rather than
an invented label" — is what produces the new display name, so no label was
invented and `CHANNEL_LABELS` still reads `{ private: "Private Test" }` for the
builds that were private tests.

| Surface | Owner | Before | After |
|---|---|---|---|
| `package.json` "version" | hand-edited, authoritative | `6.7.0-private.1` | `6.7.0-dev.1` |
| `public/index.html` title | `sync-version.js` | CineBraid 6.7.0 Private Test 1 | CineBraid 6.7.0-dev.1 |
| `public/index.html` `?v=` stamps (65) | `sync-version.js` | `6.7.0-private.1` | `6.7.0-dev.1` |
| `package-lock.json` (2 sites) | `sync-version.js` | `6.7.0-private.1` | `6.7.0-dev.1` |
| Git tag | derived | `v6.7.0-private.1` | `v6.7.0-dev.1` |
| Archives | derived | `cinebraid-6.7.0-private.1-*` | `cinebraid-6.7.0-dev.1-*` |
| `package.json` "license" | hand-edited | absent | `Apache-2.0` |

`npm run check:version` confirms the derived surfaces are in step and that the
schema markers did not follow the application version:

```
version consistency: OK
  authoritative: package.json 6.7.0-dev.1
  display name:  CineBraid 6.7.0-dev.1
  git tag:       v6.7.0-dev.1
  derived:       public/index.html title + 65 cache stamps, package-lock.json
  schema markers unchanged: hubVersion v6.0.0, schemaVersion 6.6, sample meta.version 6.6.4-studio.2
  client schema:  baseline 6.6 on open, 6.7 once a continuity field is written
```

## Licence

`LICENSE` is the standard Apache License 2.0. The terms and the appendix
instructions are byte-identical to the published text — reconstructed from two
independent local copies that agreed on all 187 lines, and pinned in
`tests/public-exposure.js` by the SHA-256 of that region
(`f4c1d7ba32ef5bcf5cf03e2eefec5825ebafedf50fa330a36700a49c605c1ef4`). Only the
appendix's own fill-in fields carry project text: `Copyright 2026 Frombach
Studios`, which is what the appendix instructs. Nothing was added to the licence:
the suite fails on `noncommercial`, `Commons Clause`, `field of use`,
`Server Side Public`, `Business Source`, `Affero`, `dual licen`,
`All rights reserved`, and the obsolete Community wording.

**NOTICE: none, and none is owed.** Apache-2.0 section 4(d) requires a NOTICE only
when a Work you received carried one. Nothing third-party is redistributed from
this repository: no `node_modules`, `vendor` or `third-party` path is tracked, no
second licence file is tracked, and the one runtime dependency (`express`, MIT) is
installed by `npm ci` on the destination rather than shipped. `git archive`
excludes `node_modules` by construction. The suite asserts those conditions rather
than asserting the file's absence, so vendoring an Apache library would fail the
check instead of quietly leaving the obligation unmet.

Trademark terms are in `TRADEMARKS.md` and nowhere near the licence text — the
suite fails if any appear after the licence body.

## Typography no longer leaves the machine

Before: `public/index.html` carried a `preconnect` and a stylesheet link to
`fonts.googleapis.com`; `public/bible.html` and the pre-authentication
`public/login.html` each carried the stylesheet link. Four remote references on
three pages, one of them before sign-in.

After: zero. The `<link>` elements are gone and the font tokens in
`public/styles.css` were extended with system fallbacks, so an installed IBM Plex
is still used and a machine without it renders on `system-ui` / `Segoe UI` /
`ui-monospace` rather than on an unstyled default. No font binary was added and
no `@font-face` was declared, so nothing was self-hosted under unresolved
redistribution rights.

`npm run check:public-exposure` reads all three pages plus the stylesheet and
fails on a Google Fonts host, on any absolute remote URL in a `<link>`, `<script>`,
`<img>`, `@import` or `url()`, on a leftover `preconnect`/`dns-prefetch`/`preload`
hint, on a tracked font binary, and on a font stack with no generic fallback.

## The credential scan

Before: `"check:secrets": "node scripts/scan-secrets.js"` — no target, so the
scanner printed usage and exited 2 on every invocation. It was in no gate.
Invoked correctly it exited 1 with 15 findings, because the allowlist covered 4
sites and 11 more synthetic values had appeared since.

After, `npm run check:secrets` scans two targets and both are clean:

```
scanner validated against a synthetic positive control: 9/9 rules fired
clean working tree (tracked files) (715 files)
clean publication tree (git archive HEAD) (708 files)
credential/privacy scan passed
```

Of the 15 findings, 12 were synthetic and are now allowed one exact value at a
time, per file and per rule; suppression applies to the matched text itself, so a
line carrying a fixture value and a real credential still reports the real one.
Three were genuine personal Windows paths in prose — a real account name in two
audit documents and one in a Git diagnostic — and those were redacted to
`C:\Users\<user>\…` rather than allowlisted. No detector was removed or widened.

The scan is now gated in two places:

- `scripts/build-release.js` reads the tar buffer that is about to become both
  artifacts, before either is written, so a finding leaves nothing on disk;
- `npm run check:ci`, which Windows CI runs on every pull request to `main` — the
  branch that is the only thing ever published.

`npm run check:public-exposure-negative` proves the guarantee can fail, with 13
receipts: a planted key is detected in an un-allowed file; the same key planted
inside an allowlisted file is still detected; a forgiven value and a planted key
on one line yield one suppression and one finding; removing a rule fails the
positive control with "no longer covers"; weakening a rule while leaving it listed
fails with "blind to"; broadening suppression back to whole-file hides a planted
key that the shipped form reports; a no-target invocation exits 2 with usage and
never reads as clean; and an uncommitted planted key is seen by the working-tree
target and absent from the publication-tree target, which is what proves the
second target reads `git archive` output. Every mutation is compiled in memory or
applied to a throwaway repository in the OS temp area; the suite asserts the
working tree is byte-identical afterwards.

## Documentation

`README.md` said `6.6.5` while `package.json` said `6.7.0`, and named Express as
the only runtime dependency while `server.js` and `agent-suite.js` both probe
`ffmpeg -version`. Both are corrected: ffmpeg is documented as optional and not
bundled, with the two places that probe for it named, and a section says plainly
that no credential is needed to install, start, open a project or finish a shot.
The suite fails on any version literal in the README that is not
`package.json` "version", on a missing ffmpeg mention, on a runtime dependency the
README does not name, on a broken document link, and on an overclaim
("production-ready", "stable release", "local generation") in a sentence that does
not deny it.

`docs/dogfood/PRODUCTION_TRUTH_DEFERRED_ARCHITECTURE.md` described its deferrals
as "everything a Professional or Enterprise tier would plausibly need". The
deferred content — multi-user identity, roles, delegation, distributed locking,
conflict resolution, policy infrastructure — is unchanged and still accurate; only
the edition wording moved, to multi-user, team and organization-scale
infrastructure, with an explicit line that none of it is deterministic core
functionality withheld for a paid edition.

## Publication contract

`docs/PUBLICATION.md` records that publication is a transfer of one branch between
two repositories: source is accepted private `main`, target is `cfbach/cinebraid`
`main`, with no `--mirror`, no `--all`, no wildcard refspec, no tags and no force
push, and with private and public `main` left at the same exact SHAs. Private
research refs are not deleted to prepare it; they are simply not in the refspec.

The suite reads that document's fenced commands rather than its prose: every
`git push` in it must match one explicit branch on both sides, and no command may
carry `--mirror`, `--all`, `--force`, `--tags` or a wildcard. It also walks the
history that would actually travel and asserts no `braidy/` or `research/` path is
reachable from `HEAD` — 719 paths reachable, 0 of them research.

## Suites

Run on this candidate, all green:

| Suite | Result |
|---|---|
| `check:version` | pass |
| `check:syntax` | pass |
| `check:behavior` | pass |
| `check:secrets` | pass, both targets clean |
| `check:public-exposure` | pass |
| `check:public-exposure-negative` | pass, 13 receipts |
| `check:local-only` | pass |
| `check:environment` | pass |
| `check:package` | pass |
| `check:render` | pass |
| `check:api` | pass |
| `check:browser` | pass |
| `release:build` | pass, archives built and scanned |
| `check:ofp-overfit` | pass after the goldens were re-pinned |
| `check:ofp-overfit-negative` | pass, 21 defects caught |

`npm run check:ci` expands to 167 leaves. It was run as one chain until it
aborted, then leaf by leaf so that every remaining suite reported its own exit
code rather than being skipped by the `&&`. **165 of 167 pass.**

### The version change re-pinned three OFP goldens

`check:ofp-overfit` failed on the first pass and the failure was real, not
inherited: it passes on the pristine foundation. The OFP migration writes the
producing application's version into `format.generator.version`
(`ofp/ofp-migrate.js:41`, `APPLICATION_VERSION` from `package.json`), and three
overfit goldens pin a full migrated document.

Re-pinned with the command the suite itself names,
`node scripts/build-overfit-golden-fixtures.js --goldens-only`, and the result was
compared field by field against the previous goldens: the only leaves that moved
are `candidateSha256` (18) and `candidateBytes` (18), every byte count lower by
exactly 4 — the difference between `6.7.0-private.1` and `6.7.0-dev.1`. No
migration behaviour changed, no statement count moved, and no other field
differs. Both `check:ofp-overfit` and `check:ofp-overfit-negative` pass
afterwards.

Two other files still carry `6.7.0-private.1` and correctly keep it:
`tests/fixtures/ofp-legacy/clean.json` and
`tests/fixtures/ofp/continuity-bindings-broken.ofp.json` are legacy *input*
documents describing the application that wrote them. A fixture that tracked the
current application version would be exactly the drift `check:version` exists to
forbid.

### Inherited, not introduced

`check:authority-server` fails on this candidate and fails identically on the
pristine foundation `25054fa1dde7979b66186f144a5fc84b77e591f4`, measured by
extracting that commit with `git archive` into a separate directory and running
the suite there: same error (`CineBraid has no record of what kind of image
ENTITY.png is`), the same four stack frames, the same last passing control
(`[bounded review] F1-04 PASS`), and the same exit code. It is not this change's.

### Not runnable here

`check:authority-browser` refuses to skip when Python Playwright is absent, and
this checkout has no `.venv-browser`; provisioning one needs a network download,
which this work did not make. `npm run check` aborts there for the same reason,
which is why the broad standing above was measured leaf by leaf.

The three HTML pages this version edited were verified in a real browser instead:
`login.html` (pre-authentication), `index.html` and `bible.html` each render with
no console errors, the computed font stacks resolve to the local chain
(`"IBM Plex Sans", system-ui, "Segoe UI", …`), and
`performance.getEntriesByType("resource")` lists **zero** off-origin entries on
every one.

No suite in this repository contacts a provider, and none was given a credential.
No network call was made while preparing this version: `node_modules` was taken
from an existing local install of the same lockfile version rather than fetched,
so `npm ci` was never run and its behaviour on this candidate is unverified.
