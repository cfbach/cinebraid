# CineBraid 6.6.5 Private Test 1

**Your production, your control.**

The first packaged CineBraid release, for isolated private testing. It ships as a
Windows ZIP and an architecture-neutral runtime tarball with checksums and a
manifest, and it is meant to be installed **alongside** an existing CineBraid
rather than over one.

This is a private test build, not a public production release.

## Start
- Windows: `start.bat`
- macOS: `start.command`
- Linux / DGX Spark: `./start.sh`

Then open the local CineBraid URL shown in the terminal.

## Private-preview safety
- Human approval remains explicit.
- Two or more motion anchor frames must pass sequence continuity review before motion opens.
- Projects, media, provider keys, and local-model settings remain local to the configured workspace.

See `docs/GETTING_STARTED.md` and `docs/releases/v6.6.5-private.1/`.

For an isolated side-by-side QA install on the DGX Spark, see
`docs/SPARK_QA_SETUP.md`.
