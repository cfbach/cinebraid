# CineBraid 6.7.0 Private Test 1

**This is a private test build, not a public production release.**

It is intended for an isolated QA installation that runs **alongside** an existing
CineBraid, never in place of one. See `docs/SPARK_QA_SETUP.md`.

This is the first CineBraid build that carries the **Open Film Project (OFP)
1.0-draft.1 contract** and its report-only validation. Nothing about how CineBraid
loads or saves a real project has changed.

---

## What changed since v6.6.6-private.1

### The OFP 1.0-draft.1 contract ships, and is not wired to anything

The draft contract is defined, validated and proven against 24 synthetic
fixtures. It is reachable from the test suites and from
`scripts/validate-ofp.js`, and from nowhere else, so no ordinary use of the app
can enter it by accident.

- `format.id` is `open-film-project`; `format.version` is `1.0-draft.1`. That is
  the **contract** version and never the application version — a document written
  by this build says `1.0-draft.1`, not `6.7.0-private.1`.
- Only that one revision is writable. Every other revision opens read-only rather
  than being judged against a schema nobody wrote for it.
- Targets are `{subject, path}` — `type:id` steps naming a record, then ordinary
  RFC 6901 rooted at it. Resolution fails if traversing the path would enter an
  array, which is what makes an array index structurally incapable of being
  identity.
- `claim.hash` binds a statement to the value it was made about: SHA-256 over
  RFC 8785 JCS of `{ofp, t, v}`, with `v` **omitted** when the target resolves to
  nothing — because "absent" and "null" are two different production facts.
- Five acts, frozen. Staleness and unresolvability are derived on every read and
  stored never. A stale approval confers no approval, and is not dropped.
- Identifiers have a floor that is an error and an id-portable profile that is a
  warning, so a legal-but-awkward identifier is reported rather than rejected.
- Voice stays a first-class entity and a character points **at** it, so one
  character can carry several voices and a voice can be reused by several
  characters.

### What the suites prove

- **INV-R1 — opening or validating writes nothing** — is held by a filesystem
  wrapper over the project root rather than by discipline, and proven two ways
  across ten document classes: the guard shows no write was attempted, and a tree
  snapshot shows nothing changed or appeared.
- Unknown extensions and unknown enum values survive parse, validate and write —
  reported, never coerced.
- Validation applies no defaults. The document is the document.
- 17 negative controls reintroduce one defect each, and each first proves the
  defect is live with a probe before requiring the guarded property to fail.

### Unchanged on purpose

- **Project persistence is untouched.** The runtime reads and writes legacy
  `schemaVersion` 6.7 exactly as it did.
- **No migration, no export, no import, and no References UI.** Those are later
  phases; OFP 1.0 is not released.
- Provider and model configuration, generation behaviour and authentication are
  unchanged in this release.

---

## Known limitations

- **OFP is inert in this build.** It validates documents on request; it does not
  read, write or convert any real project.
- **Validation is report-only.** It classifies and explains; it never repairs.
- **Local Qwen vision/review has not been validated in this release.** It is
  untested here, not known-good.
- **Image-provider generation has not been authorized for Spark QA.** Do not
  enable it as part of this test.
- **Video generation must remain disabled** for this private test.
- **A custom provider must serve the model name you configure.** If its model
  listing does not include that exact name, CineBraid reports it as not ready.
- **MiniMax H3 cannot accept unsupported provider ratios.** It refuses them
  before dispatch; this is the intended behaviour.
- **Google Fonts remains the sole non-loopback browser dependency.**
- **This is a private test build, not a public production release.**

---

## Compatibility

No project schema change. `meta.hubVersion`, `meta.schemaVersion` and a project's
own `meta.version` are unchanged and deliberately do **not** track the application
version. The shipped sample was not rewritten to advertise this version.

The three version concepts stay separate, and this release moves only the first:

| Concept | Value in this build |
|---|---|
| CineBraid application | `6.7.0-private.1` |
| Legacy CineBraid project schema | `schemaVersion` 6.7 — unchanged |
| Open Film Project contract | `format.version` `1.0-draft.1` — unchanged |

Existing Ollama, Claude API, OpenAI API and custom OpenAI-compatible
configurations are unaffected.

## Install

Windows: `cinebraid-6.7.0-private.1-windows.zip`
Linux / macOS / DGX Spark: `cinebraid-6.7.0-private.1-runtime.tar.gz`

Neither archive contains `node_modules`. Dependencies are installed on the
destination platform with `npm ci`, which is what makes the runtime tarball
architecture-neutral. Verify `SHA256SUMS.txt` before installing, and see
`CINEBRAID_v6.7.0-private.1_PATCH_INSTALL.md`.
