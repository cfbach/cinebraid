# CineBraid 6.8.0-alpha.1 — source update guide

This guide updates an existing 6.7 Alpha source installation to the published
[v6.8.0-alpha.1](https://github.com/cfbach/cinebraid/releases/tag/v6.8.0-alpha.1) source pre-release, whose tag names
`d5342b98c3d9f7a824c74ca48a483a1702f183c8`. The frozen v6.7.0-alpha.1 tag still
identifies 6.7. There is no v6.8 release archive or native installer. Requires
Node.js 18 or newer; the required Windows CI uses Node 24.

## 1. Stop and preserve your production

Finish outstanding saves and provider work. Stop CineBraid cleanly from the
terminal running it with Ctrl+C, then wait for the server to exit. Do not start a
second instance over the same settings and projects while updating.

Before changing application files, make a private backup of:

- the configured projects root, including archived/trashed project folders;
- your active settings file and its backup, if present;
- any legacy `<application folder>/projects/` and `data/config.json` / `.bak`
  copies that have not already been preserved elsewhere.

Use the startup banner and **Settings → Files & storage** to identify the active
locations before stopping. Settings and their backups may contain credentials;
keep these copies private. Do not put them in Git or attach them to a bug report.
No step here deletes, resets or automatically cleans those files.

## 2. Update a Git source installation in place

From the existing application folder:

```bash
git status --short
git fetch origin main
git log -1 --format="%H %s" FETCH_HEAD
```

If tracked application files have local edits or history has diverged, stop and
preserve that work before proceeding. Do not use `git reset --hard`, `git clean`
or a forced update. Compare the fetched commit with the qualified main commit in
the milestone publication record. Do not continue with an unqualified candidate
or a later version under the assumption that it is this milestone.

For a clean checkout descended from the 6.7 Alpha release:

```bash
git merge --ff-only FETCH_HEAD
npm ci
node -p "require('./package.json').version"
```

The version must be `6.8.0-alpha.1`. Fast-forward works from the original detached
6.7 tag checkout as well as an ancestor main branch; it does not move the old tag.
If Git refuses the fast-forward, keep the installation stopped and resolve the
checkout mismatch without overwriting user data. `npm ci` needs network access
and installs from the lockfile; it does not replace your production folders.

Updating source in place lets the new build find legacy settings and projects in
that installation. Do not replace the entire application directory with an empty
clone if it still contains your only production/config copies.

### If the original installation came from a source ZIP

Keep the entire old installation as a private backup and prepare a fresh clone
of the qualified main commit. A new folder cannot automatically discover another
installation's legacy files. Before its first start:

- If per-user settings already exist, use those; do not overwrite them with the
  old installation's settings.
- If per-user settings do not exist and your settings are still in the old
  installation, privately copy its `data/config.json` and, if present, its `.bak`
  into the new installation's `data/` folder without replacing an existing
  destination. The new build's first start can then perform its normal verified
  per-user migration. Leave the source copies intact.
- If no project root is saved in those settings and productions remain under the
  old installation, set `CINEBRAID_PROJECTS_ROOT` to that exact old project root
  for this launch. It is a default only: a saved `workspace.projectRoot` wins.
  Confirm the resulting root before editing any project. The optional copy action
  described below can subsequently establish an external root.

Do not point a trial installation at live settings or projects. Trials require
separate disposable roots and a different port; see [QA isolation](../../SPARK_QA_SETUP.md).

## 3. Start and confirm both storage authorities

```bash
npm start
```

Open the URL printed by the server, normally `http://127.0.0.1:4477`, and
hard-refresh the browser. Confirm **6.8.0-alpha.1** in the in-app version display
or About and check the startup banner and **Settings → Files & storage**:

- The projects root is the intended existing production root. Confirm familiar
  projects and representative reference/shot images open from it.
- On Windows, normal settings mode is **per-user** at
  `%LOCALAPPDATA%\CineBraid\config.json`. macOS uses
  `~/Library/Application Support/CineBraid/config.json`; Linux uses
  `${XDG_CONFIG_HOME:-~/.config}/CineBraid/config.json`. The settings-file detail
  is available locally in Files & storage.
- If you deliberately use `CINEBRAID_CONFIG_PATH`, the banner reports the
  explicit override instead. It bypasses automatic per-user migration; preserve
  that choice rather than changing it accidentally during an update.

When no per-user settings file exists, the build copies usable legacy settings
from this installation once, using the backup if the primary is unusable, verifies
the copy and retains the original. Existing per-user settings always win; they
are never merged with legacy settings. A normal second start reuses them and
does not migrate again. If migration fails or expected productions are absent,
stop and investigate the named location; do not create replacement projects or
delete settings to force a fresh start.

## 4. Optional project-root copy; retain rollback copies

A saved project root wins over `CINEBRAID_PROJECTS_ROOT`. Without either, an
installation still holding legacy productions continues using that installation's
`projects/` folder. Otherwise the default is `%USERPROFILE%\CineBraid Projects`
on Windows or `~/CineBraid Projects` elsewhere. Startup does not move productions.

To choose an external root deliberately, use **Settings → Files & storage**.
The supported operation copies projects, verifies the result and retains the
source. Live project documents may be republished through their existing writer;
file verification accounts for that explicitly. Review the result and open
representative projects/media before treating the destination as your authority.
[Setup](../../../SETUP.md) documents the verification commands and root precedence.

Retain legacy project roots, settings and their backup files unless a separate,
explicit cleanup decision is made. This update does not perform PSS-4, CS-4 or
credential rotation. A rollback installation must not run concurrently against
the active production root; use preserved backups and verify compatibility before
resuming work. Changing the application version is not a project-data rollback.
