# CineBraid setup

## Requirements

CineBraid requires **Node.js 18 or newer**. The server checks this before opening a port and exits with a clear message on an unsupported version.

Verify:

```bash
node --version
```

## Install and start

**Public Alpha [v6.7.0-alpha.1](https://github.com/cfbach/cinebraid/releases/tag/v6.7.0-alpha.1) is released as source only.**
No binary/native installer or packaged application has been uploaded. GitHub offers
generated source ZIP/tar downloads; these are source archives, not installers.
Install the frozen source tag **on the machine CineBraid will run on**:

```bash
git clone --branch v6.7.0-alpha.1 --depth 1 https://github.com/cfbach/cinebraid.git
cd cinebraid
npm ci
npm start
```

This selects the frozen Alpha in a detached checkout. Contributors can clone
without `--branch` and `--depth` to work on post-release main.

Then open `http://127.0.0.1:4477`.

`npm ci` installs strictly from `package-lock.json` and fails if it and
`package.json` disagree. It needs network access to install dependencies. The app
runs locally; optional external assistant/generation requests send their required
inputs to the selected provider.

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

For anything automated, set `CINEBRAID_TEST_MODE=1` as well. CineBraid then refuses to
start if the projects root it resolves is inside the application folder, so a test run
cannot write to the checkout's own `projects/` and `data/`. `scripts/qa-sandbox.js`
builds a complete disposable environment; `tests/helpers/disposable-root.js` is the
same guarantee for a suite.

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

## Where your projects are kept

**Outside the application.** A CineBraid install is disposable — you replace it to
upgrade — and your productions are not, so they do not live in the same folder.

The default is `%USERPROFILE%\CineBraid Projects` on Windows and
`~/CineBraid Projects` elsewhere. Nothing is asked at first launch; the startup banner
names the folder in use and says where that choice came from:

```
  Projects root: C:\Users\<you>\CineBraid Projects (default)
```

Change it in **Settings → Files & storage**. Applying a new project root COPIES every
project into the new location and leaves the originals exactly where they are, then
reports what arrived and checks the new location against the old one. Nothing is moved
and nothing is deleted.

Resolution order, most authoritative first:

1. `workspace.projectRoot` saved in the config — an explicit choice, always wins.
2. `CINEBRAID_PROJECTS_ROOT` — the environment default.
3. The application's own `projects/` folder, but **only** while it still holds
   productions. See *Upgrading from a CineBraid that kept projects inside the app*.
4. The per-user default above.

To prove a copy arrived intact, or that the originals were untouched:

```bash
node scripts/verify-migration.js --manifest "<old root>" --out before.json
node scripts/verify-migration.js --compare "<old root>" "<new root>" --documents-republished
node scripts/verify-migration.js --manifest "<old root>" --out after.json
node scripts/verify-migration.js --compare-manifests before.json after.json
```

The first comparison allows `<slug>/project.json` to differ, because a migration
republishes a live project's document rather than copying it. The last one allows
nothing: the old location must be byte-identical to how it started.

## First run

The release includes only the sanitized **CineBraid Sample — The Blue Parcel** project, which ships inside the application and stays there. It opens in manual-first mode and needs no assistant or generation provider.

If no projects exist, CineBraid shows a first-run screen with **Create a project**, the folder your projects will be kept in, and **Add the CineBraid sample** — which puts an ordinary, editable copy of the shipped sample in your own projects folder. The shipped copy is never opened for editing. CineBraid does not render a blank workspace.

## Optional providers

All provider features are disabled in the sample configuration. Configure them only when needed. They sit together under **Settings → Optional assisted services**:

- **Assistant** — Braidy, for planning, continuity and prompt help. Setup asks where a capability runs before which protocol it speaks: **Local / self-hosted** (Ollama, or any OpenAI-compatible server you run) needs no key; **Cloud** (the OpenAI or Anthropic APIs) does. Vision and Continuity Analysis carry their own standing and their own endpoint configuration.
- **Generation** — fal.ai image defaults. Key required.
- **Integrations** — generation tools running on this machine, currently **local ComfyUI**. No key and no provider cost. Every ComfyUI route refuses a caller that is not on this machine, so its host configuration cannot be changed from another device.
- **Accounts** — services you already have an account with, currently **Civitai**. Key required; a request is priced and explicitly authorised before anything is spent.

Provider keys remain server-side. Paid requests require explicit confirmation and are not needed for manual production. Braidy being off, unconfigured or unreachable does not block manual work — import, review, approval, shot editing and deterministic prompt preparation all continue.

## Upgrade an existing installation

1. Stop CineBraid.
2. Back up your projects root and `data/`.
3. Install the newer version into a new folder — a fresh clone, or an archive you built — and run `npm ci` there.
4. Restore your own `data/config.json` when using a new folder. Do not replace it with the release config if preserving existing work.
5. Start CineBraid and hard-refresh the browser once.

The release has no breaking project-schema migration.

### Upgrading from a CineBraid that kept projects inside the app

Earlier versions defaulted to `<install>/projects`, and nobody using that default ever
had a project root to save. **Those installs are not moved and are not changed.** When
the application's own `projects/` folder still holds productions — or archived or
trashed ones — CineBraid keeps opening them from exactly where they are, and says so:

```
  Projects root: C:\CineBraid\CineBraid-Source\projects (legacy-install)
  NOTICE: your productions are still inside the CineBraid application folder (2 projects, 1 archived).
          CineBraid is still opening them from there and has changed nothing.
          Move them with Settings -> Files & storage. Suggested: C:\Users\<you>\CineBraid Projects
```

The same statement appears on the welcome screen and in **Settings → Files & storage**.
Moving them is the supported copy described above: originals stay, and you delete the
old copies yourself once you are satisfied. Until you do, step 3 of an upgrade will
overwrite the application folder — which is the reason for the notice.

## Verification

Portable tester check:

```bash
npm run check:quick
```

Full maintainer check:

```bash
npm run check
```

**Windows validation is required; Browser validation is advisory pending
`BROWSER_GATE_RUNNER_STABILITY_V1`.** Python is optional for a normal install.
Some individual browser suites skip without a runtime, but `check:browser-gate`
and `check:release` fail if the required runtime is missing. See the
[browser test guide](docs/qa/BROWSER_TESTS.md) for setup and command behavior.
