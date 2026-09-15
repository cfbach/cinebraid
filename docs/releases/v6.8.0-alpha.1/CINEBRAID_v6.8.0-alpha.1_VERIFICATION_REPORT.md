# CineBraid 6.8.0-alpha.1 — verification basis and acceptance contract

This document records evidence available before final qualification of the
packaged 6.8 candidate. It is not a claim that every release gate has passed.
Final outcomes belong in the post-validation milestone/publication record and
GitHub Actions for the exact qualified commit. Completing those gates does not
require rewriting this packaged report or changing the tree they qualify.

## Known version lineage

All commits below are existing ancestors, not placeholders for this document's
future commit. Accepted product commits and correction commits remain intact.

| Point | Commit | Tree |
|---|---|---|
| Immutable 6.7 Alpha tag target | `a8840198144f7ac81b0a61193491bf58b7f05894` | See the immutable tag |
| Published storage/config baseline | `094bdf0f765a384f460e7a9306901d66c17dcfd9` | `ddb73f7570580b9fc6f78b5355267d1bd649dfa2` |
| EV2-1 human acceptance, including confirmation focus | `89253cdd31228e9518996815ce4f4fd037408565` | `6332833f89fd9dd670daf2c2f604cf45ad920514` |
| EV2-2 human acceptance, including terminology | `5dc13bb16616d10c0a3712729eae96b2b62f1c3b` | `7ba0caddbe38282b74310dce1441579dda144c39` |
| Integration-compatibility checkpoint | `728bac71bcedd40c18d5274778cc2dee51c17ff7` | `50f2e08f22c7fd0242becb0e882bd9e0b4e395c8` |
| Candidate transaction and browser-contract correction | `3651cfd64d59073ddad0e53a3e88c36ee9998130` | `074a4aa8d5241b6d8571c479df5b15b226c18b26` |
| Active version advancement | `d70b893596886a6d24e9768e4b490290e7bb6234` | `015acb1302a8e7d2cef710c203202103235072a3` |

The correction commit's parent is `728bac71bcedd40c18d5274778cc2dee51c17ff7`.
The version commit's parent is `3651cfd64d59073ddad0e53a3e88c36ee9998130`.
The earlier linear stack from published main is:
`094bdf0f` → `715a80e4` → `89253cdd` → `31723662` → `5dc13bb1` →
`cf640c49` → `bd0774f1` → `728bac71`.

The old annotated tag object is `97796e21c8e8fcea3e4733b8f2aa52262a493582`.
It and its GitHub release remain immutable. Advancing package identity to
6.8.0-alpha.1 does not create a new tag or release.

## Completed evidence before the documentation commit

The following focused results qualify the correction tree recorded above.
Browser work used disposable project/config roots and separate ports, with no
paid generation or configured-provider requests.

| Evidence | Recorded result |
|---|---|
| Reference convergence | 453 checks passed, including default and alternate source-state ownership |
| Reference convergence negative controls | Passed; Save crop & use and Save as candidate remain distinct |
| Coverage workflow | Passed |
| Candidate-review semantics | Passed; an AI review does not approve media |
| State-authority positive suite | 88/88 passed |
| State-authority negative controls | 10/10 detected; ownership protection retained |
| References alpha browser | Passed, including durable preview identity, foreign/missing rejection and candidate transaction |
| Returned-media ownership browser | 69 assertions passed |
| Generation truth browser | Passed; authored reference ordering reaches request preparation; zero paid calls |
| Reference-details dialog | Six pointer/keyboard navigation transactions and twelve ordinary dismissals passed at 1280, 1440 and 1920 |
| Syntax, Python parsing and committed diff checks | Passed for the correction work |

The crop browser proof injected an ordinary project-write failure: the extractor
reported failure and remained open, stored project bytes did not change, and one
new crop remained recoverable. Explicit retry reused that crop, persisted the
correct owning reference/state and durable ID, and created no approval or second
physical copy. Its Review button worked on the existing Primary reference
candidate card immediately and after reload. The preview resolved the same asset;
foreign and missing reference requests remained rejected.

The isolated dismissal diagnostic found focus on the page body after a responsive
render disconnected the original opener. The bounded correction restores the
corresponding opener only within the same project/route when that DOM node has
been replaced. A regression explicitly exercises that replacement. Navigation
closes the dialog, removes its modal state and focuses the destination; ordinary
Close, Escape, backdrop and selector Cancel restore their openers.

Browser media checks compare the expected fixture registry identity, production
resolver result, successful response bytes and decoded preview. They do not
require physical filenames or folders in preview URLs. Rejected Shot Desk
history preserves the existing declared actions: deliberate approval remains
available, repeated rejection does not. No product authority changed to satisfy
a browser expectation.

EV2 visual/workflow acceptance and storage acceptance preceded this correction.
The accepted PSS-3 evidence confirmed representative media opened after copying
projects to the external root, with the original root retained. Accepted CS-3
and its published required Windows check confirmed per-user settings migration,
retained legacy files and restart without a second migration. These historical
acceptances do not substitute for qualification of this candidate.

## First final CI attempt: incomplete, not passed

On `d70b893596886a6d24e9768e4b490290e7bb6234`, the first final `check:ci`
attempt passed `check:version` and `check:syntax`, then stopped at `check:package`:

`release documentation is missing CINEBRAID_v6.8.0-alpha.1_RELEASE_NOTES.md`

The same existing package contract also required the version-specific
`PATCH_INSTALL` and `VERIFICATION_REPORT` files. A milestone README was present,
but these three required documents were absent. The documentation batch supplies
them without changing product code, tests, version identity or prior evidence.
The failed attempt did not establish a complete CI pass. Subsequent stages were
unrun, not implicitly passed.

The version check confirmed package and lockfile identity, browser title and all
79 cache tokens agree on 6.8.0-alpha.1. API/footer/build identity remains derived
from the package. Project-schema markers did not follow the product version.

## Required final acceptance gates

These are requirements for the candidate containing these documents, not results
claimed by this report:

1. Documentation/package checks before commit, then direct `check:package` on the
   documentation commit and a clean committed diff/history check.
2. One complete `check:ci` pass from that exact committed head.
3. The combined browser gate, respecting its declared mandatory suites and
   established quarantine accounting without treating a quarantine as a pass.
4. Package structure and applicable release-build/archive checks against the
   qualified commit; no untracked runtime data may enter distributable artifacts.
5. Secrets and public-exposure checks on both the candidate tree and the history
   newly exposed beyond actual public main; publication preflight on the exact
   fast-forwarded main. No credential values belong in evidence.
6. Controlled publication and restart proof: local/private/public main identities
   agree, the existing external projects and per-user settings remain authoritative,
   Shot Desk and References open, and no second settings migration occurs.
7. Required **CineBraid Windows CI → Windows validation** succeeds on the published
   commit. The workflow can be manually dispatched on main when needed. A local
   pass or a push does not close this required hosted check.

Final gate logs, package identities, publication/restart results and the hosted
workflow outcome must be attached to the separate milestone/publication record.
The immutable 6.7 tag/release, live data and retained rollback copies remain
protected. No 6.8 tag or GitHub prerelease is authorized by this report.

## Rules carried forward

Browser tests prove durable media identity and observable behavior, not incidental
filenames or physical storage paths.

Public product milestones receive an explicit version decision before final
qualification. Internal implementation and correction commits do not independently
advance the version.

Approved is the production status. AI may review or recommend; enrollment, viewing
and candidate selection do not create approval. Selector search/filtering, PSS-4,
CS-4, workspace cleanup and EV2-3 remain outside this milestone's completed scope.
