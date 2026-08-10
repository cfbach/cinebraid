# CineBraid 6.7.0 Private Test 1 — Open Film Project 1.0-draft.1 Contract

- First CineBraid build carrying the Open Film Project draft contract: `format.id` `open-film-project`, `format.version` `1.0-draft.1`, with report-only validation over 24 synthetic fixtures.
- OFP is inert in this build. It is reachable from the test suites and `scripts/validate-ofp.js` and from nowhere else, so no ordinary use of the app can enter it by accident.
- Project persistence is unchanged. The runtime reads and writes legacy `schemaVersion` 6.7 exactly as it did, and no project is stored in the OFP format.
- The three version concepts stay separate: the application is `6.7.0-private.1`, the legacy project schema is `schemaVersion` 6.7, and the OFP contract is `format.version` `1.0-draft.1`. Only the first moved.
- Validation applies no defaults and repairs nothing; unknown extensions and unknown enum values survive parse, validate and write, reported and never coerced.
- Opening or validating an OFP document writes nothing — held by a filesystem wrapper over the project root rather than by discipline, and proven across ten document classes.
- No behaviour change otherwise. Provider and model configuration, generation and authentication are untouched; `npm run sync:version` stamped the window title, the 36 asset cache stamps and the lockfile from `package.json`.
- Private test build, not a public production release. See `docs/releases/v6.7.0-private.1/` for the known limitations.

# CineBraid 6.6.6 Private Test 1 — Local OpenAI-Compatible Assistant Providers

- A local OpenAI-compatible server can now supply CineBraid's assistant, Project Bible Q&A, prompt improvement and structured text workflows. On a machine already running a compatible multimodal server, that removes the need to keep a second large local assistant model resident beside it.
- Adds optional custom-provider request settings — sampling temperature, Top-K and model-thinking behaviour. Each is blank or default until set, and a blank setting sends nothing, so an existing custom provider behaves exactly as it did.
- AI readiness now reflects the provider actually selected instead of assuming Ollama. A custom server is contacted to confirm it is running and serving the configured model; an unreachable one fails closed to manual mode and recovers without a restart.
- Provider base URLs and keys stay on the CineBraid server and are not sent to the browser.
- Local-only projects are now judged by endpoint locality rather than by provider name: a loopback custom provider qualifies, a remote one does not, and a remote Ollama endpoint no longer qualifies either.
- Deterministic `useLLM:false` prompt compilation, existing multi-image vision routing and Ollama-routed embeddings are all unchanged.
- Private test build, not a public production release. See `docs/releases/v6.6.6-private.1/` for the known limitations.

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
