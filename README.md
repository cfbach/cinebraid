# CineBraid 6.6.5 Private Test 1

**Your production, your control.**

The first packaged CineBraid release, for isolated private testing. It ships as a
Windows ZIP and an architecture-neutral runtime tarball with checksums and a
manifest, and it is meant to be installed **alongside** an existing CineBraid
rather than over one.

This is a private test build, not a public production release.

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

Express is the only runtime dependency. There is no build step and no bundler.

## Start

From the release folder:

- Windows: `start.bat`
- macOS: `start.command`
- Linux / DGX Spark: `./start.sh`

Or, once dependencies are installed with `npm ci`:

```bash
npm start
```

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

Reaching the interface from another machine is a **deliberate opt-in**, never a
default:

```bash
npm run start:lan
```

`--lan` (or `CINEBRAID_LAN=1`) binds `0.0.0.0` and prints an exposure warning.
**Set an editor passcode in Settings before using LAN mode** with paid providers
or sensitive projects — without one, anyone who can reach the port can drive the
application.

You do not need LAN mode to use CineBraid, and you do not need it to run local
models: CineBraid reaches out to those, not the other way round.

## Manual first

CineBraid is a **manual-first** production tool. Every stage — planning, the
Project Bible, shot work, review and approval — is usable end to end by hand,
with no AI provider configured and no generation enabled. AI and in-app
generation are optional accelerators layered on top of that manual workflow, and
they are switched off in a fresh install.

Two consequences worth knowing before you test:

- **Human approval stays explicit.** Nothing is approved, locked or superseded on
  your behalf.
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
provider — no suite in CineBraid depends on a live model service.

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

Provider keys are stored server-side and masked when settings are read back, so
they are not sent to the browser in plain text. Projects, media, provider keys
and local-model settings all stay inside the workspace you configure; nothing is
uploaded anywhere by CineBraid itself.

Both directories are excluded from version control and from release archives.

## Private-preview safety

- Human approval remains explicit.
- Two or more motion anchor frames must pass sequence continuity review before
  motion opens.
- Projects, media, provider keys, and local-model settings remain local to the
  configured workspace.

## More documentation

- `docs/GETTING_STARTED.md` — the short path from install to a finished shot.
- `SETUP.md` — install, configuration and provider setup in detail.
- `docs/releases/v6.6.5-private.1/` — release notes and verification material.

For an isolated side-by-side QA install on the DGX Spark, see
`docs/SPARK_QA_SETUP.md`.
