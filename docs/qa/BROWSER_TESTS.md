# Running the real-browser suites

CineBraid has real-browser suites that drive the shipped client in Chromium.
The current gate inventory is maintained in [run-browser-gate.js](../../tests/run-browser-gate.js).
They exist because a whole class of defect is invisible to Node: the frontend is a
set of plain `<script>` tags sharing one global scope, and a mistake there — a
duplicate top-level `const`, a module reading shared state off `window` when the
declaration that made it is a top-level `let` and therefore not on `window` at all,
a stylesheet that never sizes an image — produces a blank, broken or silently inert
application while every Node suite passes.

## Current repository policy

**Windows validation is the required public status check. Browser validation is
advisory pending `BROWSER_GATE_RUNNER_STABILITY_V1`.** Keep investigating browser
failures; advisory status does not turn a failure or skip into a pass.

This is distinct from command behavior: `check:browser-gate` requires a working
browser and launch receipts, and fails if either is missing. `check:release` also
runs that command. Neither command is weakened by the repository policy.

## Setup

Once per clone:

```bash
npm run setup:browser-tests
```

That creates `.venv-browser/` inside the repository, installs the pinned Playwright
from `tests/browser-requirements.txt`, and downloads the matching Chromium
(~115 MB on first run). It needs Python 3.10+ on `PATH`; on Windows install it from
python.org rather than the Microsoft Store, whose stub cannot create a virtualenv.

`.venv-browser/` is gitignored, and releases are built with `git archive`, so it
cannot reach a release archive.

To check what is installed without changing anything:

```bash
npm run check:browser-setup
```

## Running them

```bash
npm run check:browser-gate
```

Every suite listed by the browser-gate runner, with `CINEBRAID_BROWSER_REQUIRED=1` set. Under that
variable a missing runtime is a **failure with setup instructions**, not a skip.

The gate does not take a suite's exit code at face value. `tests/browser_runtime.py`
prints a receipt after `pw.chromium.launch()` actually returns:

```
[browser-runtime] <suite>: launched Chromium 151.0.7922.34 (bundled playwright chromium)
```

`tests/run-browser-gate.js` requires that line from every suite. A suite that exits
0 without launching a browser fails the gate. This is the point of the whole
arrangement: starting Python is not the same as exercising the UI, and until Q1 the
two were indistinguishable.

Individual suites:

```bash
npm run check:c2b-browser          # capability-aware generation dialog
npm run check:brand-logo-browser   # the shipped mini logo, measured
npm run check:manual-browser       # manual-first persona audit
npm run check:browser-real         # the long workflow audit
npm run check:h3-browser           # MiniMax H3
npm run check:preview-layout       # layout containment across routes and themes
npm run check:ui-state             # same-route state stability
npm run check:focused-browser      # Focused Workspaces against the real project state
```

## The tiers

| Command | Browser suites | Missing runtime |
|---|---|---|
| `npm run check:quick` | board density only | skips |
| `npm run check:ci` | none | n/a |
| `npm run check` | selected suites in `tests/run-full-check.js` | some suites skip; check each command |
| `npm run check:browser-gate` | inventory in `tests/run-browser-gate.js` | **fails** |
| `npm run check:release` | `check` then the gate | **fails** |

Use `check:ci` for the portable Windows validation path. For other tiers, consult
the current runner and individual command output rather than assuming every
browser suite can skip.

`npm run check:release` remains the full verification command followed by the
browser gate. Its strict exit behavior is separate from the current required
Windows/advisory Browser status-check policy above.

## Screenshots and evidence

```bash
npm run qa:capture
```

Writes review screenshots, a viewport smoke report and an `INDEX.md` to
`../QA-Reviews/Q1-browser-qa`. It asserts nothing — it records — and it runs against
a disposable sandbox, blocks every off-machine request and blocks the paid
generation route outright.

## The quarantine

Three suites launch a browser and are **expected to fail**, pinned to the reason in
`tests/run-browser-gate.js`:

| Suite | Why |
|---|---|
| `check:motion-edit` | Proxies the app through a fabricated origin; the cross-origin guard correctly refuses writes from it. The harness needs to stop faking an origin. |
| `check:continuity-browser` | Asserts a `FIX CONTINUITY` control the shipped continuity UI no longer labels that way. |
| `check:continuity-workspace-browser` | Waits for a per-frame state `<select>` that now renders inside a collapsed disclosure. |

None of the three was reachable from `check`, `check:ci` or `check:quick`, so unlike
the other suites they were never even skipping — they were not wired into anything.
Running them for the first time showed all three had drifted away from the shipped
UI.

The quarantine is pinned in both directions. A quarantined suite must still launch a
browser, and must still fail for its recorded reason. One that starts passing fails
the gate asking to be promoted; one that breaks differently fails the gate too.
A quarantine that only tolerates failure is how the original skips became invisible.

## Isolation

The suites added in Q1 — and the continuity workspace suite — build a temporary
directory and point the server at it with `CINEBRAID_CONFIG_PATH` and
`CINEBRAID_PROJECTS_ROOT`, then delete it. Set `CINEBRAID_TEST_MODE=1` too: CineBraid
then refuses to start against a projects root inside the checkout, so the isolation is a
property rather than a habit. `tests/helpers/disposable-root.js` supplies all three in one
call and is the preferred way to build one. `scripts/qa-sandbox.js` builds the same
kind of environment for hand testing and refuses to build one inside the repository.

Six older suites predate those variables and still start `node server.js` against
the repository's own roots. Rather than trust that they only ever read, the gate
brackets its whole run with a byte census of `data/` and `projects/` and fails naming
any file that changed. On a machine that already has `data/config.json`, nothing
changes. On a **fresh clone** the first server start creates that file — the
application bootstrapping its own defaults — and the gate reports it as such:

```
isolation  26 files under data/ and projects/ byte-identical after the run
           first run created data/config.json, projects/cinebraid-sample/media-assets.json
           — six suites still start the server against the repository's own roots
```

Three files may be created, all named exactly, and all because starting the
application is what creates them:

- `data/config.json` — CineBraid bootstrapping its own defaults.
- `projects/cinebraid-sample/media-assets.json` — since P4-SEM-C1, opening a project
  mints a durable `assetId` per media file, and six of these suites open the shipped
  sample through the real server.
- `projects/cinebraid-sample/media-assets.json.bak` — the ledger is written twice
  across a gate run **by design**: the first server start indexes the sample
  stat-only, and a later one anchors those identities to their bytes. The store
  copies the previous primary aside before replacing it, so the second write produces
  the `.bak`. Both writes are the application converging on its own state.

*Modifying* any of them is still damage, and nothing else under `projects/` is
exempt: a stray test project appearing there is exactly what the census exists to
catch, and a new directory or any other new file still fails the gate.

Every exemption here was established the same way — by CI failing on exactly it while
a developer machine passed, because the file was already there from an earlier run
and the census saw it unchanged rather than created. If you are debugging an
isolation failure that CI sees and you do not, delete these three files and re-run
the gate.
Moving those six suites onto sandbox roots is the follow-up this line keeps visible.

## Troubleshooting

**"no Python 3 interpreter was found"** — install Python 3.10+ from python.org and
re-run the setup command.

**"the virtual environment could not be created"** — on Windows, the Microsoft Store
Python stub is first on `PATH`. Install from python.org instead.

**"no usable Chromium could be launched"** — re-run `npm run setup:browser-tests`.
The resolver tries Playwright's own Chromium, then the system Chrome channel, then
known install paths; `CINEBRAID_BROWSER_EXECUTABLE` overrides all of it.

**A suite fails on a UI label** — read the failure before changing the product. Two
of the drifted assertions found in Q1 were stale tests, not regressions; the shipped
behaviour was right in both cases.
