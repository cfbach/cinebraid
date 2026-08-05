# CineBraid 6.6.5 Private Test 1

**This is a private test build, not a public production release.**

It is the first packaged CineBraid release: two archives, a checksum file and a
machine-readable manifest, built so a tester can install a known build from a
known commit rather than copying a working directory. It is intended for an
isolated QA installation that runs **alongside** an existing CineBraid, never in
place of one. See `docs/SPARK_QA_SETUP.md`.

Version identity is now derived from a single authoritative source. `package.json`
`version` is the only hand-edited version in the tree; the window title, the asset
cache-busting stamps, the Git tag and the archive names are derived from it, and
`npm run check:version` fails the build if any of them drift.

---

## Major repairs since v6.6.4.2

### Project switch and load safety

Switching projects is atomic and recoverable. Reads tolerate a byte-order mark,
a project is validated before it becomes the active one, and a project that
cannot be parsed is refused with its file left untouched and the previous project
still open — instead of a partial switch that could write into the wrong project.
Project load leaves the project file byte-identical, schema markers never
downgrade, and backup listing uses the active slug and fails visibly rather than
silently returning nothing.

### Windows shutdown repair

The server no longer orphans itself on Windows. It keeps its listen handle and
handles `SIGINT`, `SIGTERM` and `SIGBREAK`; the launcher execs Node directly with
no `npm` or `cmd` wrapper in between, so terminating the server process actually
stops the server. Terminating that PID frees the port for immediate rebinding and
touches no unrelated Node process. A separate repair stopped the activity
retention timer from holding the event loop open, so the process exits naturally.

### Responsive Shot workspace

The Shot workspace layout adapts to real desktop widths rather than assuming one.
Navigation, preview and review columns are measured from 1280 px through 1920 px,
with the preview growing from 300 px to 430 px and the review column from 626 px
to 1030 px, and the work column holding a 340 px floor.

### Terminology and status clarification

Sections, statuses and counts use one vocabulary throughout, so the same state is
not called three different things in three places.

### Settings persistence repair

Every Settings subsection states how it stores changes, and Settings stops losing
work that was entered but not obviously committed.

### Image scale and inspection

Images are shown whole and at a size worth judging. Every review surface uses
`object-fit: contain`, so no frame is cropped to fit its well, and an explicit,
labelled enlarge control opens a media theatre with a real Close, Escape support
and focus that moves in and returns. Board thumbnails scale with a Compact /
Comfortable / Large card size.

### Multi-aspect support

Productions are judged in the format they are delivered in. Shots resolve a
production format by precedence — shot override, then project, then legacy format,
then asset dimensions, then 16:9 — and 16:9, 21:9, 2.39:1, 1:1, 9:16 and 3:2 all
resolve to usable ratios. Shot-output surfaces follow the production format while
reference surfaces stay intrinsic. Malformed and out-of-range ratios fall back to
16:9 **without rewriting the record**. Review canvases hold a constant area across
formats, so a 9:16 shot is not reviewed at a quarter of the size of a 16:9 one.

### Light Canvas contrast

The light theme is genuinely readable: `--text`, `--accent` and five previously
frozen surface tokens are theme-aware, 240 token pairs were measured across four
accents with a worst case of 4.68:1, and five raised surfaces that were painted
from dark literals now carry light-surface backgrounds.

### H3 unsupported-ratio refusal

MiniMax H3 refuses aspect ratios it cannot deliver, before dispatch, rather than
silently substituting one. Ten refusals across five paths and two unsupported
formats were verified with a provider call count of zero, no project write and no
orphaned job; supported ratios still compile and reach the provider unchanged.

### Reference import repair

The reference picker is wired both with and without a drop target, and every
reference workspace renders.

### Compiler contract and Windows CI

`npm run check:composer` had failed on every Windows clone since the initial
commit for a reason unrelated to the compiler: protected source hashes were taken
over raw bytes, so a checkout with `core.autocrlf=true` mismatched on line endings
alone. The check now normalises to LF before hashing — losing no strictness, since
a single altered character still moves a hash — and asserts its slice boundaries
instead of assuming them. Alongside the hashes, the fields a motion package is
actually judged on are asserted through the public `compile()` entry: prompt text,
reference selection and order, model identifier, aspect ratio, resolution,
duration, first/last frame and multi-keyframe behaviour. `check:composer` is now
part of `check:ci`, and a Windows CI baseline runs the deterministic, credential-
free, provider-free suites on every pull request to `main`.

---

## Known limitations

- **Local Qwen vision/review has not been validated in this release.** It is
  untested here, not known-good.
- **Image-provider generation has not been authorized for Spark QA.** Do not
  enable it as part of this test.
- **Video generation must remain disabled** for this private test.
- **MiniMax H3 cannot accept unsupported provider ratios.** It refuses them
  before dispatch; this is the intended behaviour, not a failure to work around.
- **Previously opened or stamped Shots may appear as explicit format overrides**
  until **Use project format** is selected. Existing stamped values are honoured
  and never silently rewritten, which is why they persist until you clear them.
- **Google Fonts remains the sole non-loopback browser dependency.** CineBraid
  remains usable when it is blocked; only the webfont fails to load.
- **This is a private test build, not a public production release.**

---

## Compatibility

No project schema change. `meta.hubVersion`, `meta.schemaVersion` and a project's
own `meta.version` are unchanged and deliberately do **not** track the application
version — `npm run check:version` asserts this, so a release cannot renumber them
and imply projects were migrated. The shipped sample was not rewritten to
advertise this version.

## Install

Windows: `cinebraid-6.6.5-private.1-windows.zip`
Linux / macOS / DGX Spark: `cinebraid-6.6.5-private.1-runtime.tar.gz`

Neither archive contains `node_modules`. Dependencies are installed on the
destination platform with `npm ci`, which is what makes the runtime tarball
architecture-neutral. Verify `SHA256SUMS.txt` before installing, and see
`CINEBRAID_v6.6.5-private.1_PATCH_INSTALL.md`.
