# CineBraid 6.7.0-alpha.1 — install

**The Public Alpha is shared as source.** No archive has been published under this
identity yet, so there is nothing to download and no checksum to verify. Install
from a clone.

Requires **Node.js 18 or newer**. CineBraid is validated on Node 24 (Active LTS),
which is what Windows CI runs.

## From source

```bash
git clone https://github.com/cfbach/cinebraid.git
cd cinebraid
npm ci
npm start
```

Then open the URL printed in the terminal — by default `http://127.0.0.1:4477`.
`SETUP.md` covers configuration and provider setup in detail;
`docs/GETTING_STARTED.md` is the short path from install to a finished shot.

`npm ci` installs strictly from `package-lock.json` and needs network access once.
Everything after that runs locally.

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
its own `PORT`. `docs/SPARK_QA_SETUP.md` documents that isolation in full.

Your projects are self-contained folders under the projects root. Nothing in an
install writes to another install's workspace.

There is no breaking project-schema migration in this version.
