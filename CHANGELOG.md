# CineBraid 6.7.0-alpha.1 — Public Alpha

- The identity CineBraid is first shared publicly under. The pre-release channel moved from `dev` to `alpha`; `release-identity.js` is unchanged and gives an unlisted channel its raw version, so the display name is `CineBraid 6.7.0-alpha.1` and no label was added. `npm run sync:version` stamped the window title, the asset cache stamps and the lockfile; no version literal was edited by hand.
- **Braidy** is the assistant by name, with its own rail and one published capability standing that every surface reads instead of guessing. A capability nobody turned on reports off rather than a failure; an unreachable Braidy names the model it was going to use; the Assistant screen says where each capability stands before it offers any plumbing. Configuration asks where a capability runs — local/self-hosted or cloud — before it asks which protocol to speak.
- **Local ComfyUI** generation, mounted beside fal rather than through it: a free render on your own machine has nothing to authorise, so it is not gated on fal's enablement flag or fal's key. Every ComfyUI route refuses a non-loopback caller, and the host configuration is not editable from another device. Adds a workflow registry that certifies its node classes, and CineBraid's own ledger vocabulary for job status.
- **Civitai** generation, which does have everything to authorise: a permit binds the exact request it paid for, Buzz is not dollars, result collection follows a redirect only within the origin the provider named, and a delivered job carries no failure message. The browser loads every configured backend's generation ledger and routes each row to the backend that owns it.
- **Reference Workflow Coherence V2**: a reference is shown whole, the strip that routes to it can be read, the reference a filmmaker asked for is the task on the page, and what comes back cannot be lost. One browser Vision authority, asked by every consumer including the wrapper behind each button.
- **Prepared-identity reference approval.** An import is not an import until storage has it, and identity is established positively before the decision rather than discovered missing after it. Readiness is bound to what is on screen — project, candidate, state, declaration, ownership, save generation and live identity — and anything moving withdraws the confirm control.
- **No rename on reference approval.** An approved reference keeps the name it was imported under; a production filename is an address, not an identity and not the decision. Shot take approval still renames, unchanged.
- **Approval saving is blocking and recoverable.** While one submission is unresolved the recovery dialog holds a modal lock, the shell's own regions go inert, and navigation is refused at `route()`. What the workspace accepts and what the save path will keep now agree: what cannot be saved cannot be entered. A retry replays the one submission rather than re-deciding, and an unknown outcome asks storage what it holds first.
- Documentation truth for a public checkout: the README named fal as the only generation route and never named Braidy; `SETUP.md` listed two of the four optional-service surfaces; `docs/SPARK_QA_SETUP.md` told a public reader to clone the private engineering origin. All corrected. `TRADEMARKS.md` extends the existing brand-asset carve-out to the six Braidy character exports, on the same terms as the logo and without restricting the code.
- `package.json` declares public `repository`, `homepage`, `bugs` and `author` metadata pointing at `cfbach/cinebraid`.
- No application behaviour change in this entry's documentation work. Persistence, provider and model configuration, generation, authority and authentication are untouched by it.
- An alpha, not a released build, and shared as source. See `docs/releases/v6.7.0-alpha.1/`.

# CineBraid 6.7.0-dev.1 — Public Source Readiness

- The pre-release channel moved from `private` to `dev`. `release-identity.js` gives an unlisted channel its raw version rather than an invented label, so the display name is `CineBraid 6.7.0-dev.1` and no new label was added. `npm run sync:version` stamped the window title, the 65 asset cache stamps and the lockfile; no version literal was edited by hand.
- `LICENSE` is the standard, unmodified Apache License 2.0. It previously described a private mainline build and a separately prepared Community repository; that split is obsolete. `package.json` now declares the SPDX identifier `Apache-2.0`.
- New at the root: `CONTRIBUTING.md` (pull requests, DCO sign-off, no CLA), `SECURITY.md` (coordinated disclosure) and `TRADEMARKS.md` (the name and logo are held separately from the code licence). No `NOTICE` file: no shipped file carries an Apache NOTICE obligation.
- All three HTML pages, including the pre-authentication login page, no longer fetch web fonts from a CDN. Typography resolves from locally installed and system faces, and no font binary was added. `npm run check:public-exposure` fails if a remote font or CDN reference reappears.
- `npm run check:secrets` invoked the scanner with no target and exited 2 with usage on every call, so it had never scanned anything. It now scans the tracked working tree and the exact `git archive` publication tree, allows synthetic fixture values one exact value at a time per file and per rule, and is wired into `scripts/build-release.js` — which reads the archive buffer before either artifact is written — and into `npm run check:ci`.
- Documentation truth: the README said 6.6.5 while `package.json` said 6.7.0, and named Express as the only runtime dependency while the server probes `ffmpeg`. Both corrected, along with what ffmpeg is for and when a provider key is actually needed.
- `docs/PUBLICATION.md` records the publication contract: only `main` travels, to one named repository, with no mirror, no `--all` and no wildcard refspec.
- No application behaviour change. Persistence, provider and model configuration, generation, authority and authentication are untouched.
- A development identity, not a released build. See `docs/releases/v6.7.0-dev.1/`.

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
