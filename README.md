# CineBraid

**The production layer that keeps AI cinema tied together.
Your production, your control.**

CineBraid is a local-first film production application. It holds the approved
truth of a production — the Project Bible, references, continuity, shots, review
and approval — and it keeps that truth yours: it runs on your machine, binds
loopback by default, and uploads nothing on its own.

You can plan and finish a production entirely by hand, with no AI provider
configured and no generation enabled. AI assistance and provider-backed
generation are optional layers on top of that.

**Status: in development.** The version is `6.7.0-dev.1` — a development
identity, not a released or production-ready build. There is no support
commitment and no supported-version matrix; work happens on `main`. Expect rough
edges, and read [SECURITY.md](SECURITY.md) before reporting anything sensitive.

## Requirements

CineBraid requires **Node.js 18 or newer**. The server checks this before it opens
a port and exits with a single clear line on an unsupported version:

```
CineBraid requires Node.js 18 or newer; detected 16.20.0.
```

Check what you have:

```bash
node --version
```

`express` is the only npm runtime dependency, and there is no build step and no
bundler. It is installed from the lockfile with `npm ci`; nothing is vendored into
the repository.

**ffmpeg is optional and is not bundled.** CineBraid never requires it to start or
to run the manual workflow. It probes for `ffmpeg -version` in two places and
reports the answer rather than depending on it:

- `/api/system/health` reports whether ffmpeg was found, and its version line.
- The system assistant raises a low-priority advisory when it is missing, because
  media inspection and proxy utilities are the things that would want it.

If you never see that advisory, you never needed it. Install it from your own
package manager if you want those utilities.

### API keys are optional

No credential is needed to install, start, open a project, or take a shot from
opening to approved. Provider keys are needed only when you turn on a
provider-backed feature:

- an **AI assistant** for planning and continuity help — a local Ollama server, an
  OpenAI-compatible server you run, or the OpenAI or Anthropic APIs. "No AI" is a
  supported setting, not a degraded one.
- **in-app generation**, which is dispatched to fal.ai. Without a key, the
  generation surfaces stay off and everything else works.

A missing or unreachable provider degrades that feature, not the product. Keys are
stored server-side in `data/config.json` and masked when settings are read back,
so they are never sent to the browser in plain text.

## Start

From a source checkout:

```bash
npm ci
```

```bash
npm start
```

From a release folder, the startup scripts do the same thing:

- Windows: `start.bat`
- macOS: `start.command`
- Linux / DGX Spark: `./start.sh`

Then open the local CineBraid URL shown in the terminal — by default
`http://127.0.0.1:4477`. Set `PORT` if 4477 is taken.

On startup CineBraid prints its URL, the address it bound to, its network posture,
and where your projects live, so you can confirm all four at a glance.

## How CineBraid uses your network

**CineBraid is local-only by default.** It binds `127.0.0.1`, so nothing outside
this computer can reach it, and it says so on startup:

```
Local-only mode: other devices cannot connect.
```

The interface makes no third-party requests to render itself: no font CDN, no
analytics, no remote scripts or stylesheets. Everything the browser loads is
served by your own CineBraid.

Reaching the interface from another machine is a **deliberate opt-in**, never a
default:

```bash
npm run start:lan
```

`--lan` (or `CINEBRAID_LAN=1`) binds `0.0.0.0` and prints an exposure warning.
**Set an editor passcode in Settings before using LAN mode** with paid providers
or sensitive projects — without one, anyone who can reach the port can drive the
application.

You do not need LAN mode to use CineBraid, and you do not need it to use a local
AI server: CineBraid reaches out to that, not the other way round.

## Manual first

CineBraid is a **manual-first** production tool. Every stage — planning, the
Project Bible, shot work, review and approval — is usable end to end by hand,
with no AI provider configured and no generation enabled. You can bring in images,
video and audio made anywhere, organize them, assign continuity, attach them to
shots, and mark the final result.

Two consequences worth knowing:

- **Human approval stays explicit.** Nothing is approved, locked or superseded on
  your behalf. A machine can propose; only a person decides.
- **A missing or unreachable provider degrades the feature, not the product.**
  If an assistant is not configured, the manual path is still there.

## The sample project

A fresh install opens `projects/cinebraid-sample` — *CineBraid Sample — The Blue
Parcel* — a three-shot project with a character, a location, a prop and existing
media.

It is deliberately configured to need nothing external: no text provider, no
vision provider, and generation disabled. You can take all three shots from
opening to approved using only what ships in the box, which is the fastest way to
see the manual workflow before deciding what to automate.

## Testing an install

Three commands, in increasing order of cost. All are portable and none contacts a
provider — no suite in CineBraid depends on a live model service, and none needs
an API key.

```bash
npm run check:quick
```

The fast path: syntax, rendering, core contracts and the main workflow suites.
Use this while working.

```bash
npm run check:ci
```

What continuous integration runs on Windows for every change.

```bash
npm run check
```

The full verification, including the browser and release suites. It reports how
many suites ran and which were slowest.

Some browser suites self-skip with a printed message when Python Playwright is
not installed; that is expected on a plain install and is not a failure.

## Where your data lives

- `projects/<slug>/` — one self-contained folder per project: `project.json`, its
  media, and rolling backups.
- `data/config.json` — your settings, including provider credentials.

Projects, media, provider keys and local-model settings all stay inside the
workspace you configure; nothing is uploaded anywhere by CineBraid itself. When
you do dispatch a generation, the material for that request goes to the provider
you chose, and nowhere else.

Both directories are excluded from version control and from release archives.

## Contributing

Pull requests are welcome. Commits need a DCO `Signed-off-by` line; there is no
CLA and you keep your copyright. See [CONTRIBUTING.md](CONTRIBUTING.md).

Security issues go through [SECURITY.md](SECURITY.md), not a public issue.

## Licence

CineBraid is licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).

The licence covers the code. The CineBraid name and logo are branding held
separately; see [TRADEMARKS.md](TRADEMARKS.md) before using either in a fork.

## More documentation

- `docs/GETTING_STARTED.md` — the short path from install to a finished shot.
- `SETUP.md` — install, configuration and provider setup in detail.
- `docs/PUBLICATION.md` — how a reviewed commit reaches the public repository.
- `docs/releases/v6.7.0-dev.1/` — notes and install guidance for this identity.

For an isolated side-by-side QA install on the DGX Spark, see
`docs/SPARK_QA_SETUP.md`.
