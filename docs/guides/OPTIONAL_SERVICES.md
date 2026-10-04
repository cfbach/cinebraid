# Optional services — CineBraid 7.0 Public Alpha

Current source candidate: `7.0.0-alpha.1`. This is setup guidance, not a live
readiness certificate or a claim that a release/tag/download exists.

You can import, organize, review, approve and deliver existing media with all
services off. CineBraid does not bundle or install models.

## Braidy setup

1. Open **Settings → Studio → Braidy & assistance**.
2. Leave Braidy **Off**, or choose **Local / self-hosted** or **Cloud**, then
   the runtime/provider. Local/self-hosted supports Ollama or an
   OpenAI-compatible server; cloud supports OpenAI or Claude (Anthropic).
3. Open the matching **Settings → Connections** page. Supply the endpoint,
   model and any credential that your chosen service requires. Run your own
   model server separately when using one.
4. Review each capability separately: **Braidy**, **Vision** and
   **Continuity Analysis** have their own selection/configuration and readiness.
   A text model is not automatically an image-reading or continuity-review model.
5. Distinguish saving setup or refreshing a model list from **Send test message**.
   Setup may contact the configured service and use its credentials for inventory;
   it does not send a project test prompt merely because you saved the form.
   Use an explicit test only when you intend to contact that service.

Braidy's rail offers questions, planning and prompt/review help. Its conversation
is session-only and advisory; it does not own approval or generation dispatch.
Other explicitly invoked assistance can store runs, observations or proposals;
applying a proposal is a separate action. Human approval remains a separate
production decision.

**No Braidy model currently has a qualified champion standing.**
Connection readiness means the configured endpoint/model is usable at that
moment; it is not evidence that a task passes a production benchmark.
Historical Qwen/vLLM dogfood is limited evidence, not a shipped champion or a
bundled runtime. For blocked shots and unresolved required references, some
rail guidance comes directly from deterministic readiness and does not invoke a
model. Treat that as current production guidance, not model reasoning.

## Implemented generation

Use **Settings → Connections** for **Local ComfyUI**, **Civitai account** or
**Fal**. **Studio → Generation defaults** chooses defaults; the actual request,
price/authorization where applicable, result and human review remain separate.

- **ComfyUI:** run ComfyUI on the same machine as CineBraid, register an API
  workflow and its input/output mapping, and verify its required models/nodes
  independently. A generic workflow interface is not a promise that every model,
  custom node or workflow works. CineBraid restricts the target and caller to the
  same machine; an arbitrary LAN ComfyUI server is not this integration.
- **Civitai:** the implemented route is one-image text-to-image with a quoted,
  explicitly authorized paid request and collection of the returned candidate.
  It is not an implementation of every Civitai generation feature.
- **fal.ai:** the compiled adapters are `fal-gpt-image-2` (text-to-image,
  blocking, multi-reference, edit and inpaint), `fal-h3-fl2va` (text-to-video,
  image-to-video and first/last frame), and `fal-h3-ref2va` (reference-to-video).
  These identifiers bound the code's dispatch inventory; availability and
  successful execution of every mode are not established by the inventory alone.

Cloud generation sends the required prompts/reference material to its provider
and can incur cost. Review the actual request and authorization before submitting.
A returned file is a candidate, never an automatic approval.

## Qualification versus availability

Qualified means an exact compiler/provider/mode contract. Experimental/available
means a route/control exists without blanket task qualification. In development
and Research/watchlist are not supported generation claims.

| Exact target/service | Standing and boundary |
|---|---|
| GPT Image 2 / fal `openai/gpt-image-2` | Qualified deterministic T2I and blocking request paths |
| GPT Image 2 / fal `openai/gpt-image-2/edit` | Qualified edit, multi-reference and explicit inpaint mapping; base first; normalized `mask_url` white-edit / black-preserve |
| MiniMax H3 FL2VA / fal | Qualified T2V at `minimax/h3/text-to-video`; I2V and first/last frame at `minimax/h3/image-to-video` |
| MiniMax H3 Ref2VA / fal | Qualified explicitly selected R2V inputs at `minimax/h3/reference-to-video`; no implicit harvesting of project references or Frame A |
| OpenAI Braidy target review | Experimental/advisory; Responses API structured proposals, `store: false`; configurable account-visible model, no automatic task-qualified default |
| Ollama / compatible server / Anthropic | Existing optional assistant transports; model/task limits, not the qualified OpenAI target-review path |
| Local ComfyUI | Experimental/available same-machine registered workflows; evaluate installed workflow/nodes/models |
| Civitai | Experimental/available bounded one-image T2I quote/authorization/collection route, not all Civitai features |
| Assisted continuity repair / per-frame AI critique | Unqualified optional features; existing quarantines remain unqualified |
| Historical profiles / other catalogue entries | Legacy/unqualified or Research/watchlist unless a current exact executable route and qualified pack establish otherwise |

Request-path qualification includes provider-free golden/browser/authority tests.
Recorded real native I2V and masked-edit executions establish bounded routes, not
paid testing of every mode or acceptable artistic results. No uptime, fixed future
price or pixel preservation is guaranteed. Direct OpenAI image, BFL, Runware,
ElevenLabs or direct MiniMax catalogue presence does not establish native adapters
qualified by these fal routes.

## Improve with Braidy after Build

Build first: deterministic model-specific compilation is the trusted baseline.
Braidy receives the exact target, Canon, ordered approved input roles, coverage,
warnings, settings and playbook identity. It proposes text/reasons/warnings, not
reference roles, provider capabilities, approvals or project mutations.

For this reviewer use **Settings → Connections → OpenAI**. Enter the key through
the normal password field, save server-side, load actual account models, then
choose **Braidy prompt-review model**. Saving configuration is not an advisory
request; a successful connection is not task qualification. Advisory API requests
can incur cost. Never paste keys into chat, evidence or public issues.

Inspect Build versus proposal and lost directed intent. **Accept / Edit / Reject**
affect the target package only, never Canon or approvals. Coverage/omission review
guards acceptance; no model is permanently task-qualified. Relevant Canon/input/
target/settings changes invalidate a proposal. Inspect fresh exact provider review
after accepting changes. Braidy unavailable leaves deterministic generation usable
and must not be presented as an AI improvement.

## Data, credentials and locality

Settings are ordinary plaintext JSON, protected by OS account permissions,
normally outside the application. Keys stay server-side, readbacks mask keys and
omit OAuth secrets; this is not encryption. Ordinary endpoint URLs can be visible.
See [storage and migration](../../SETUP.md#where-data-lives).

A custom “Local / self-hosted” endpoint may be on your computer, a LAN host or a
remote proxy. It can require a key or incur a charge. Check its address and
operator; the label does not prove that requests never leave your machine.
A project's local-only AI restriction checks same-machine endpoint routing;
it cannot certify what a separately operated server does with the request.

Cloud assistance can send project context or requested images. Generation sends
its prompt/reference payload; status polling and output collection make network
requests too. Importing a file through a browser on another LAN device transfers
that file to CineBraid. Filesystem import is not automatic external reference
search. The application UI itself has no third-party analytics, fonts, scripts
or stylesheets.
