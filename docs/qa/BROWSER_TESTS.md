# Running the real-browser suites

CineBraid has eleven test suites that drive the shipped client in a real Chromium.
They exist because a whole class of defect is invisible to Node: the frontend is a
set of plain `<script>` tags sharing one global scope, and a mistake there — a
duplicate top-level `const`, a stylesheet that never sizes an image — produces a
blank or broken application while every Node suite passes.

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

Every real-browser suite, with `CINEBRAID_BROWSER_REQUIRED=1` set. Under that
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
```

## The tiers

| Command | Browser suites | Missing runtime |
|---|---|---|
| `npm run check:quick` | board density only | skips |
| `npm run check:ci` | none | n/a |
| `npm run check` | six, best effort | skips |
| `npm run check:browser-gate` | all eleven | **fails** |
| `npm run check:release` | `check` then the gate | **fails** |

`check`, `check:ci` and `check:quick` stay tolerant on purpose: a fresh clone must
be able to verify everything portable before anyone installs a browser. What changed
in Q1 is that tolerance is now confined to those tiers and stated in the tier table,
instead of being the silent behaviour everywhere.

Use `npm run check:release` before tagging or accepting a candidate.

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

Every suite that needs data builds a temporary directory and points the server at it
with `CINEBRAID_CONFIG_PATH` and `CINEBRAID_PROJECTS_ROOT`, then deletes it. Nothing
reads or writes `data/`, `projects/` or the shipped sample. `scripts/qa-sandbox.js`
builds the same kind of environment for hand testing and refuses to build one inside
the repository.

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
