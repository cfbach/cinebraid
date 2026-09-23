# CineBraid 6.8.0-alpha.1 — EV2 milestone

Status: published on 2026-09-15 as the source-only GitHub pre-release [v6.8.0-alpha.1](https://github.com/cfbach/cinebraid/releases/tag/v6.8.0-alpha.1), tagged at `d5342b9`. It is the latest release; `main` has since moved on to 6.9.0-alpha.1 development code. No release archive or native installer exists.

The combined Experience V2 milestone includes the accepted A+ Shot Desk representative workflow and References with explicit enrollment of existing production media through durable asset identities. Enrollment remains separate from approval. Approval remains a deliberate user action through the existing authority writer.

The bounded integration corrections align repository checks with those accepted contracts and ensure extracted reference crops are persisted and resolvable before Save as candidate reports success. The application version does not change project schema markers or migrate project data.

`package.json` is the active version authority. The lockfile, browser title and asset cache tokens are stamped by `scripts/sync-version.js`. Server/API identity, footer/About, diagnostic version metadata and release-build metadata derive from that authority. Historical release records, the v6.7.0-alpha.1 annotated tag and its GitHub release remain unchanged.

Production media selector search/filtering for larger productions is deferred. Linked-first selection remains the accepted representative implementation.

## Development rules

Public product milestones receive an explicit version decision before final qualification. Internal implementation and correction commits do not independently advance the version.

Browser tests prove durable media identity and observable behavior, not incidental filenames or physical storage paths.

The production status is **Approved**. AI may review or recommend; it does not possess approval authority.
