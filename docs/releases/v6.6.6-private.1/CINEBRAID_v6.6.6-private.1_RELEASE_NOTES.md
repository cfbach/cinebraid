# CineBraid 6.6.6 Private Test 1

**This is a private test build, not a public production release.**

It is intended for an isolated QA installation that runs **alongside** an existing
CineBraid, never in place of one. See `docs/SPARK_QA_SETUP.md`.

CineBraid can now use a local OpenAI-compatible provider for its assistant and
text work. On a machine already running a compatible multimodal server, that
removes the need to keep a second large local assistant model resident alongside
it.

---

## What changed since v6.6.5-private.1

### Local OpenAI-compatible assistant providers work reliably

A custom OpenAI-compatible server can now supply CineBraid's assistant, Project
Bible Q&A, prompt improvement and structured text workflows.

Previously CineBraid sent one fixed request to every custom OpenAI-compatible
server. That is correct for most of them, and wrong for a server that reasons
before answering: such a server could spend the whole reply budget on reasoning
and return an empty answer, intermittently and without a useful explanation.

### Custom-provider sampling and model-thinking controls

Three optional settings appear when the provider is **Custom server**:

- **Sampling temperature** — leave blank to send nothing; a low value such as
  `0.2` keeps structured answers repeatable.
- **Top-K sampling** — leave blank unless your server accepts `top_k`.
- **Model thinking** — *Server default*, or *Ask the server to skip thinking* for
  a reasoning server that would otherwise return no final answer.

Each is blank or default until you set it, and a blank setting sends nothing at
all. A custom server that worked before behaves exactly as it did, because an
unconfigured custom provider produces exactly the request it produced before.

### AI readiness reflects the provider you actually chose

Readiness used to be described almost entirely in Ollama's terms, so a healthy
custom text provider could not switch the AI controls on, and a configured one
that was not running still looked fine.

Each provider is now asked about itself. A custom server is contacted to confirm
it is running and serving the model you named; if it is reachable and serving it,
text assistance is available without waiting on Ollama. If it is not reachable,
CineBraid says so in plain language and returns to manual mode rather than
leaving controls enabled that cannot work. Readiness recovers on its own once the
server returns — no restart.

Provider addresses and keys stay on the CineBraid server and are not sent to the
browser.

### Local-only projects are judged by the endpoint, not the provider's name

A project set to local-only asks for its material to stay on this machine. That
is now decided by the address the provider actually uses.

- A custom server on this machine (loopback) **can** satisfy local-only.
- The same provider pointed at another machine **cannot**.
- An Ollama endpoint on another machine **no longer** satisfies local-only either.

If nothing local is configured, the request is refused rather than sent, and the
prompt still compiles deterministically with a warning naming the policy.

**If you run Ollama on a different computer and use local-only projects, that
combination now stops rather than sending your material off the machine.** Point
the provider at this computer, or change the project's AI policy.

### Unchanged on purpose

- **Deterministic prompt compilation is unchanged.** Compiling with the assistant
  turned off produces the same prompt it always did, and contacts no provider.
- **Existing multi-image vision routing is unchanged.** It stays on the provider
  it already used. It has **not** been moved to a local OpenAI-compatible server.
- **Embeddings remain separately routable to Ollama**, since a text server need
  not provide them.

---

## Known limitations

- **Local Qwen vision/review has not been validated in this release.** It is
  untested here, not known-good.
- **Continuity review is unchanged in this release.** The declared-entity,
  single-image continuity design has been qualified separately but is **not**
  part of this build and has not shipped.
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

Existing Ollama, Claude API and OpenAI API configurations are unaffected. An
existing custom OpenAI-compatible configuration keeps its current behaviour until
you set one of the new optional fields.

## Install

Windows: `cinebraid-6.6.6-private.1-windows.zip`
Linux / macOS / DGX Spark: `cinebraid-6.6.6-private.1-runtime.tar.gz`

Neither archive contains `node_modules`. Dependencies are installed on the
destination platform with `npm ci`, which is what makes the runtime tarball
architecture-neutral. Verify `SHA256SUMS.txt` before installing, and see
`CINEBRAID_v6.6.6-private.1_PATCH_INSTALL.md`.
