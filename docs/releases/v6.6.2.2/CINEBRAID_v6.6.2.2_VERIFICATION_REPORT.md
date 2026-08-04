# CineBraid v6.6.2.2 verification report

## Result

**PASS** — source verification, real-browser acceptance, responsive overlap checks, accessibility assertions, and release-package structure checks completed successfully.

## Required issue verification

### Unresolved project relationships

Passed:

- stale character, location, prop, and vehicle IDs survive normalization;
- Shot Inputs renders every unresolved relationship as a blocking row;
- Relink replaces the stale ID across all matching shot fields;
- Remove clears the stale relationship;
- entity deletion uses the same dependency resolver;
- Project readiness reports unresolved relationships and links to the affected shot's Inputs stage;
- rerendering does not silently discard unresolved IDs.

### Activity behavior

Passed:

- idle Activity strip is hidden;
- active Activity strip appears in normal workspace flow;
- completed Activity returns to hidden state;
- Activity drawer remains keyboard closable;
- zero geometric overlap with visible controls or text on Production, Shot, Reference, Reports, and Settings at 1600, 768, and 390 px;
- zero horizontal overflow at the tested widths.

### Typography and accessibility

Passed:

- Approved Authority label and assigned-state count render as separate structures;
- the joined `APPROVED AUTHORITY1/…` rendering does not occur;
- Settings textareas, inputs, and selects have accessible names;
- Chromium's accessibility tree reports no unnamed textbox or combobox in Settings;
- previous/next shot controls include meaningful destination labels;
- mobile hit-area rules cover frequent compact controls without adding controls.

### Reference Library and packaging

Passed:

- last-selected Reference Library category persists;
- release documentation is contained under `docs/releases/`;
- root Markdown hygiene passes;
- package metadata reports v6.6.2.2;
- release-package smoke infrastructure can extract a supplied archive and run its own full check command.

## Control-budget ratchet

| Surface | Actual | Ceiling | Result |
|---|---:|---:|---|
| Default-visible shot controls | 9 | 10 | PASS |
| Total reachable shot controls | 23 | 24 | PASS |
| Global Activity controls | 4 | 4 | PASS |
| Automation-console controls | 1 | 1 | PASS |

No capability was removed to meet these budgets.

## Test coverage

The full `npm run check` source run passed:

- syntax validation;
- render harness and current-behavior assertions;
- browser workflow and import benchmark;
- Project Builder, composer/motion, build history, FAL safety, and API smoke tests;
- diagnostic redaction and Reports;
- live Activity;
- reference coverage, safety/integrity, focused workspaces, reference UX, batch repair, and state-chain recovery;
- data recovery and bounded rendering;
- clarity consolidation;
- v6.6.2.2 integrity/mobile usability;
- real Chromium workflow;
- package structure.

The real Chromium workflow additionally exercised:

- candidate review gating and a bounded partial batch result;
- parent-derived continuity-state prompt compilation;
- continuity disclosure persistence;
- unresolved-reference Relink and Remove through the actual UI;
- authority typography;
- accessible shot navigation;
- active-only Activity at desktop, tablet, and mobile widths;
- responsive overflow and overlap checks.

## Safety

- No paid FAL generation requests were submitted by verification.
- The test project was disposable.
- Project schema and existing automation records were not migrated or rewritten.
- Recovery guards and video motion compilers were not modified.

## Archive verification

**PASS** — the final ready-to-run ZIP was extracted into a clean temporary directory and the untouched archive completed its own `npm run check` command successfully.

Verification command:

```bash
CINEBRAID_RELEASE_ZIP=/path/to/CINEBRAID_v6.6.2.2-integrity-mobile-usability-ready-to-run.zip npm run check:package
```

The package smoke test also confirmed the extracted package version and release-document structure before launching the complete suite.
