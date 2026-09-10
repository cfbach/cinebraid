# Repository layout

The root `server.js` is the startup bootstrap. It loads
`src/server/server.js`; both `npm start` and `node server.js` use that same
implementation and startup lifecycle.

## Server-side source

| Directory | Responsibility |
|---|---|
| `src/server/` | HTTP server, configuration, release/build identity, request boundaries, ZIP streaming |
| `src/accounts/` | Account connections, provider adapters, account API and errors |
| `src/assistant/` | Assistant dispatch and agent suite |
| `src/authority/` | Authority write seam and reference-review contract |
| `src/automation/` | Automation-run orchestration |
| `src/continuity/` | Continuity cache and JSON handling |
| `src/generation/` | Generation contracts, compilation, binding, lifecycle, cost, jobs, ingestion and polling |
| `src/generation/fal/` | Existing fal generation adapters |
| `src/generation/comfyui/` | ComfyUI client, workflow, registry and generation implementation |
| `src/generation/civitai/` | Civitai client, workflow and generation implementation |
| `src/media/` | Media identity, indexing, verification, storage and local-file actions |
| `src/project/` | Project Builder contract |

Put new server-side implementation in the matching `src/` domain. Keep the root
bootstrap small. Browser code belongs in `public/`; existing model-pack and OFP
boundaries remain at the top level.

## Browser and runtime data

- `public/` contains browser code, shared browser/Node contracts, styles and shipped
  assets. The server serves this application-root directory.
- `projects/` is the default production-storage directory. Only
  `projects/cinebraid-sample` is tracked; local productions and generated media
  are not source. Existing workspace and environment overrides still apply.
- `data/` contains shipped model catalogs alongside ignored local runtime data.
  `data/config.json` remains the local, untracked configuration file, including
  credentials. Configuration backups, embeddings and workflow registries remain
  at their existing application-root locations. Moving source does not move data.
- `package.json`, the lockfile and supplied build identity remain at the
  application root. Source modules resolve that root independently of their
  depth beneath `src/`.

## Other top-level boundaries

- `model-packs/`: model-family definitions and compilation contracts.
- `ofp/`: Open Film Project contracts, schemas and migration tooling.
- `resources/project-builder/`: the public Project Builder prompt kit.
- `scripts/`: maintenance, validation and release tooling.
- `tests/`: deterministic checks, fault-injection controls and browser suites.
- `docs/`: user/contributor guidance and clearly scoped historical records.
- `.github/`: repository presentation and CI; excluded from application archives.
- `.claude/`: retained launcher configuration; excluded from application archives.

Release tooling packages the selected Git ref. The frozen `v6.7.0-alpha.1` ref
retains its historical root-module layout; post-migration refs use this layout.
Dated release and engineering records describe the tree that existed at the time.
