# CineBraid Project Import Benchmark

These source packages test three different Project Builder failure modes:

1. `script-only` — scene extraction, dialogue preservation, and practical shot planning from prose alone.
2. `synthetic-workshop` — source priority, stable IDs, continuity, and preservation of an invented one-scene / two-shot plan.
3. `conflicting-revisions` — final-draft authority, deleted material, and visible `[SOURCE CONFLICT]` handling.

Run `npm run benchmark:imports` to verify the scorer and the bundled reference outputs. To score outputs from ChatGPT, Claude, or a local model, place one JSON file per fixture in another directory using the fixture directory names (`script-only.json`, `synthetic-workshop.json`, and `conflicting-revisions.json`) and run:

```bash
node tests/import-benchmark.js /path/to/candidate-json
```

The benchmark reports structural recall, dialogue preservation, forbidden/deleted material, continuity readiness, frame planning, and reference-led duration compliance. It is an evaluation harness, not a claim that the bundled reference outputs came from a particular model.
