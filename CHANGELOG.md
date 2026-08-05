# CineBraid 6.6.5 Private Test 1 — First Packaged Private Test

- First packaged CineBraid release: a Windows ZIP, an architecture-neutral runtime tarball, `SHA256SUMS.txt` and a machine-readable manifest, all built from one commit with `git archive`.
- `package.json` `version` is now the one authoritative version source. The window title, asset cache stamps, Git tag and archive names are derived from it, and `npm run check:version` fails the build when any surface drifts.
- Project schema markers (`meta.hubVersion`, `meta.schemaVersion`, project `meta.version`) are asserted **not** to track the application version.
- Adds `docs/SPARK_QA_SETUP.md` for an isolated side-by-side QA install on the DGX Spark, using the port, projects-root and config-path environment variables the code actually reads.
- Startup scripts get pinned line endings (`*.sh`/`*.command` LF, `*.bat` CRLF) and `start.sh`/`start.command` keep their executable bit in the archives.
- Private test build, not a public production release. See `docs/releases/v6.6.5-private.1/` for the known limitations.

# CineBraid v6.6.4-studio.repair.13 — Correction Dialog Clarity

- Rebuilt the frame-sequence correction dialog as a viewport-safe guided workflow.
- Clearly separates what the user chooses/edits from what CineBraid automates.
- Adds live anchor/repair labels, bounded review evidence, a fixed footer, and explicit no-charge prompt-building language.

# CineBraid v6.6.4-studio.repair.12 — Guided Continuity Correction

- Failed frame-sequence reviews now lead into a guided correction workflow instead of only offering Review again.
- Users can choose the structural anchor, choose the target frame, define the intended delta, lock unchanged continuity, and build an immutable correction package.
- Corrected-frame approval can automatically rerun sequence review before motion unlocks.
- Non-default character, prop, location, and vehicle states can be validated against their approved parent.
- Failed parent-state checks offer Correct from parent, upload, alternate candidate, explicit canon expansion, and revalidation.
- Replacing parent/target authority or editing the state delta invalidates stale validation.

# CineBraid v6.6.4-studio.repair.11 — Continuity-Safe Frame Sequences

- Bounded approved-frame previews in the Frames workspace.
- Large media-theatre preview remains one click away.
- New AI sequence review gates first/last and multi-frame motion.
- Major camera, environment, background-light, character, or prop drift blocks motion readiness.
- Current continuity-state authority is pinned near the top and previewable without navigation.
- Automation planners expose images per pass, quality, and resolution.
- Checkbox and generation-control layouts are aligned and responsive.

# CineBraid v6.6.4-studio.repair.10 — Editable Motion Prompt Revisions

- Editable MiniMax H3 preflight prompts with immutable revision history.
