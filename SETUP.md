# CineBraid setup

## Requirements

CineBraid requires **Node.js 18 or newer**. The server checks this before opening a port and exits with a clear message on an unsupported version.

Verify:

```bash
node --version
```

## Install and start

**The Public Alpha is shared as source.** No archive has been published under this
identity, so there is nothing to download and no checksum to verify. Install from a
clone, **on the machine CineBraid will run on**:

```bash
git clone https://github.com/cfbach/cinebraid.git
cd cinebraid
npm ci
npm start
```

Then open `http://127.0.0.1:4477`.

`npm ci` installs strictly from `package-lock.json` and fails if it and
`package.json` disagree. It needs network access once; everything after that runs
locally.

### From an archive you built

`npm run release:build` produces a Windows ZIP and a runtime tarball from a commit.
To install one, extract it into a new folder, open a terminal there, and run the
same `npm ci` and `npm start`.

Those archives do **not** include `node_modules`. Dependencies are installed on the
destination machine, which is what lets one runtime tarball serve x64 and arm64
alike — including the DGX Spark.

## Running a second CineBraid on the same machine

Give it its own port, projects root and config path, or it will share them:

```bash
PORT=4488 \
CINEBRAID_PROJECTS_ROOT=/path/to/qa-projects \
CINEBRAID_CONFIG_PATH=/path/to/qa-config/config.json \
node server.js
```

`CINEBRAID_PROJECTS_ROOT` sets the *default* projects root; a `workspace.projectRoot`
saved in the config file overrides it, so a separate `CINEBRAID_CONFIG_PATH` is
required for real isolation. See `docs/SPARK_QA_SETUP.md`.

## Network posture

A fresh install binds to **127.0.0.1 only**. It is available on the CineBraid computer and not on the LAN.

To opt into LAN access:

1. Set an Editor passcode in CineBraid Settings.
2. Start with:

```bash
npm run start:lan
```

or `node server.js --lan`.

LAN mode binds to `0.0.0.0` and prints an exposure warning. Do not port-forward CineBraid or expose it directly to the public internet.

Advanced alternatives:

```bash
CINEBRAID_LAN=1 node server.js
CINEBRAID_HOST=192.168.1.50 node server.js
```

## First run

The release includes only the sanitized **CineBraid Sample — The Blue Parcel** project. It opens in manual-first mode and needs no assistant or generation provider.

If no projects exist, CineBraid shows a first-run screen with **Create a project** and any available sample/open-project actions. It does not render a blank workspace.

## Optional providers

All provider features are disabled in the sample configuration. Configure them only when needed. They sit together under **Settings → Optional assisted services**:

- **Assistant** — Braidy, for planning, continuity and prompt help. Setup asks where a capability runs before which protocol it speaks: **Local / self-hosted** (Ollama, or any OpenAI-compatible server you run) needs no key; **Cloud** (the OpenAI or Anthropic APIs) does. Vision and Continuity Analysis carry their own standing and their own endpoint configuration.
- **Generation** — fal.ai image defaults. Key required.
- **Integrations** — generation tools running on this machine, currently **local ComfyUI**. No key and no provider cost. Every ComfyUI route refuses a caller that is not on this machine, so its host configuration cannot be changed from another device.
- **Accounts** — services you already have an account with, currently **Civitai**. Key required; a request is priced and explicitly authorised before anything is spent.

Provider keys remain server-side. Paid requests require explicit confirmation and are not needed for manual production. Braidy being off, unconfigured or unreachable does not block manual work — import, review, approval, shot editing and deterministic prompt preparation all continue.

## Upgrade an existing installation

1. Stop CineBraid.
2. Back up `projects/` and `data/`.
3. Install the newer version into a new folder — a fresh clone, or an archive you built — and run `npm ci` there.
4. Restore your own `projects/` and `data/config.json` when using a new folder. Do not replace them with the release sample/config if preserving existing work.
5. Start CineBraid and hard-refresh the browser once.

The release has no breaking project-schema migration.

## Verification

Portable tester check:

```bash
npm run check:quick
```

Full maintainer check:

```bash
npm run check
```

Python 3 is optional for a normal install. Real-browser verification uses Python Playwright and Chromium when available and skips clearly when unavailable.
