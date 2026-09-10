# CineBraid 6.7.0-alpha.1 — install

**[v6.7.0-alpha.1](https://github.com/cfbach/cinebraid/releases/tag/v6.7.0-alpha.1) is a released, source-only Public Alpha.**
No binary/native installer or packaged application has been uploaded. GitHub
provides generated source ZIP/tar downloads; these are source archives, not
installers. The clone below selects the frozen release.

Requires **Node.js 18 or newer**. CineBraid is validated on Node 24 (Active LTS),
which is what Windows CI runs.

## From source

```bash
git clone --branch v6.7.0-alpha.1 --depth 1 https://github.com/cfbach/cinebraid.git
cd cinebraid
npm ci
npm start
```

This selects a detached checkout of the frozen Alpha tag, which dereferences to
`a8840198144f7ac81b0a61193491bf58b7f05894`. For post-release development, clone
without `--branch` and `--depth` to work on main.

Then open the URL printed in the terminal — by default `http://127.0.0.1:4477`.
[Setup](../../../SETUP.md) covers configuration and provider setup in detail;
[Getting started](../../GETTING_STARTED.md) is the short path from install to a
finished shot.

`npm ci` installs strictly from `package-lock.json` and needs network access once.
The application runs locally. Optional external assistant/generation requests
send their required inputs to the selected provider.

## Building an archive yourself

`npm run release:build` produces a Windows ZIP and an architecture-neutral runtime
tarball from a commit, with a manifest and checksums:

```bash
npm run release:build
```

Both archives come from `git archive`, so they contain the clean tracked source
state and nothing untracked, ignored or locally modified. The build refuses to run
from a dirty working tree, and it refuses to write either artifact if the
credential and privacy scan finds anything in the archive contents.

Output lands in `dist/release/`, which is gitignored.

## Upgrading an existing install

There is no patch path from an earlier identity. If you are running an earlier
CineBraid, install this one **beside** it rather than over it: point it at its own
workspace with `CINEBRAID_PROJECTS_ROOT` and `CINEBRAID_CONFIG_PATH`, and give it
its own `PORT`. [Spark QA setup](../../SPARK_QA_SETUP.md) documents that isolation
in full.

Your projects are self-contained folders under the projects root. Nothing in an
install writes to another install's workspace.

There is no breaking project-schema migration in this version.

## Validation policy

Windows validation is required. Browser validation is advisory pending
`BROWSER_GATE_RUNNER_STABILITY_V1`; browser commands retain their strict runtime
and failure behavior. See the [browser test guide](../../qa/BROWSER_TESTS.md).
