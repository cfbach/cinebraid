# Synthetic legacy CineBraid fixtures (P2 migration framework)

Every file here is **synthetic**. No real user material, no copy of any archived
project, nothing derived from a real film. They imitate the *shapes* the frozen
audit measured — three duration aliases, seven prose fields, an undeclared union
namespace in `codes[]`, `INT-1->2`, `[INFERRED FOR PLANNING]` — with invented
content.

**Sanitised real-world fixtures are P3.** P2 migrates none of the archived
generations, and the migration framework has never opened one.

These are legacy `project.json` documents, not OFP documents, so the
`*.ofp.json` LF pin in `.gitattributes` does not apply to them. Nothing compares
their bytes; they are parsed, and the *output* of migrating them is what the
determinism tests compare.

## What each one is for

| Fixture | Exercises |
|---|---|
| `clean.json` | scenario A — a wholly deterministic migration: valid candidate, zero statements, zero diagnostics. Also the pinned accounting table. |
| `no-schema-version.json` | a project with no `schemaVersion` at all, classified by shape; `atomic` / `parentShot` / `fallbackFor` recovered into `relations[]` with no statement |
| `duration-aliases.json` | `dur` / `duration` / `sec`, including the measured live loss (`duration` only) and two aliases that disagree |
| `entity-prose.json` | the seven-field description cluster: two that differ, two that agree, one alone, and two that are empty |
| `codes-exact.json` | `codes[]` tokens that name records exactly, plus `creationBrief.locationId` / `propIds[]` |
| `codes-ambiguous.json` | a suffix that names a real coverage view, a suffix that names nothing, a suffixed entity token, and `STAGE-3`, which resolves to nothing |
| `prose-dependency.json` | a bookend dependency that exists three times as English and zero times as structure |
| `film-draft.json` | `meta.version` as the film's own draft label, beside a `hubVersion` that is an application version |
| `template-default.json` | the `BLANK()` defaults: `"v1"`, the five-line QC checklist, the status vocabulary |
| `inferred-marker.json` | `[INFERRED FOR PLANNING]` in a shot description and in an entity description |
| `missing-ids.json` | nested records with an empty id, with no id key at all, and the measured `INT-1->2` shape |
| `voice-linkage.json` | an audio entity linked by a character, one linked by nobody, and a link that names nothing |
| `unknown-fields.json` | fields no contract revision models, at the root, in `meta` and on a shot |
| `absent-null-empty.json` | absent versus `null` versus an explicitly empty collection |
| `state-coverage-aliases.json` | the nine state-delta spellings, and `required` disagreeing with `requirement` |
| `frame-stores.json` | `keyframes[]`, `creationBrief.frames[]` and `frameWorkflows{}` holding one frame between them, agreeing and then disagreeing |
| `secret-traps.json` | API keys, an auth secret, a passcode, credential-named tokens, absolute host paths, a localhost endpoint and a credential URL — none of which may reach the document; plus the M080 counterpart, a prompt reference placeholder stored under a bare `token` key, which must survive |
| `foreign-application.json` | another application's scene document, which the audit names and says do not migrate |

## Read by

- `tests/ofp-migration.js` — the framework, the six functional scenarios and the accounting table
- `tests/ofp-migration-negative-controls.js` — proof that suite would notice a regression
