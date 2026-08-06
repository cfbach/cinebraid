# CineBraid 6.6.6 Private Test 1 — verification report

Two independent bodies of evidence back this release: the deterministic suites
that run on every commit, and a live acceptance test against a real local
OpenAI-compatible model service on the DGX Spark.

## Automated verification

`npm run check:ci` — **23 suites, all passing** on Windows CI (`windows-latest`,
Node 24 Active LTS) and locally. The 23 node-only suites in the full maintainer
list that CI omits also pass, as does `node scripts/scan-secrets.js .`.

Three suites are new in this release. All drive local mock endpoints; no suite
depends on a live model service.

| Suite | Asserts |
|---|---|
| `tests/custom-provider-routing.js` | An unconfigured custom request carries none of the three optional fields; a configured one carries exactly them; JSON mode still works alongside them; OpenAI and Ollama never receive them; blank and out-of-range values normalise instead of becoming a silent `0`; two-image custom vision is unchanged; reasoning-with-no-answer still fails loudly. |
| `tests/provider-health.js` | A reachable custom text provider enables text assistance while Ollama holds zero models; an unreachable one turns it off and returns the app to manual mode; neither browser-facing status route carries the provider base URL or key; an unselected custom endpoint is never contacted; Ollama readiness is unchanged. |
| `tests/local-only-policy.js` | 28 addresses through the locality classifier, then real routing: a loopback custom endpoint is used, the same provider moved to a remote host is not, a project with nothing local contacts no one, and `useLLM:false` compiles the same prompt twice while contacting no provider at all. |

## Live acceptance test

Staged as an isolated candidate on a DGX Spark from the merged commit, on its own
port, config path and projects root, against an already-resident vLLM-served
multimodal model. The existing release and demo services on that machine were not
modified, and no second large model was loaded at any point.

### The defect this release fixes, reproduced and closed

| Model-thinking setting | Result |
|---|---|
| *Server default* | **1 of 5 succeeded**; 4 failed with "returned reasoning but no final answer" |
| *Ask the server to skip thinking* | **10 of 10 succeeded** (two runs of five), 0.196–0.247 s |

The failure mode is real, intermittent, and closed by the new setting.

### Other live results

| Area | Result |
|---|---|
| Settings round-trip | Values written through the real Settings panel persist, reload and re-render; the save does not disturb the base URL, model or vision provider |
| Readiness | Text assistance available with **no** Ollama language model resident |
| Fail-closed | Unreachable provider → not ready, manual mode, message names no address |
| Recovery | Readiness returns without restarting CineBraid |
| Endpoint privacy | Provider base URL and key absent from browser-facing status JSON; the browser made zero direct requests to any model service |
| Project Bible Q&A | Correct entity and shot IDs; nothing invented |
| Absent-fact trap | Refused rather than inventing an undeclared fact |
| Blocking improvement | Assistant-sourced plan with legal enumerated values and only declared entity IDs |
| Motion improvement | Declared nouns and a hard production constraint both preserved |
| Deterministic compile | Two `useLLM:false` compiles byte-identical by SHA-256, with the model server's own request counter proving **zero** model calls |
| Local-only, loopback custom | Accepted and used |
| Local-only, LAN-address custom | Refused; a control run with the policy off showed the same address *being* attempted, isolating policy from reachability |
| Vision routing | Text provider custom, vision provider Ollama; multi-image review not routed to the custom server |
| Memory | Baseline and final identical; no second large model loaded; no new kernel memory errors |
| Concurrency | Two concurrent text requests both completed |

## Scope of the evidence

- Live multi-image vision was **not** exercised, deliberately: doing so would have
  required a second large model resident beside the first.
- The declared-entity single-image continuity design is **not** part of this
  release and was not tested as part of it.
- Image and video generation remained disabled throughout.

## Compatibility

No project schema change. `meta.hubVersion`, `meta.schemaVersion` and a project's
own `meta.version` are unchanged, and `npm run check:version` asserts they do not
track the application version.
