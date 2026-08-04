# Installing the CineBraid v6.6.2.1 Patch

This patch upgrades **v6.6.2.0** to **v6.6.2.1**.

## Before installing

1. Stop CineBraid.
2. Back up the CineBraid folder, especially `projects/`, configuration files, and any local provider credentials.
3. Confirm the installed version is v6.6.2.0. For older versions, use the complete ready-to-run package instead of this incremental patch.

## Install

1. Extract `CINEBRAID_v6.6.2.1_patch-from-v6.6.2.0.zip`.
2. Open the extracted `CINEBRAID_v6.6.2.1_patch` folder.
3. Copy its contents into the root of the existing CineBraid installation.
4. Allow matching files to be replaced.
5. No `npm install` is required because this release adds no dependency.
6. Run:

```bash
npm run check
```

7. Start CineBraid again:

```bash
npm start
```

8. Hard-refresh the browser so the v6.6.2.1 cache-busted scripts and styles load.

## Data compatibility

There is no project-schema migration. Existing projects, automation runs, generation jobs, reports, and recovery data are preserved.

## Quick verification

- Open a continuity-state generation panel and confirm the Manual generate / Automate state guidance is readable.
- Open an invalid route such as `#/shot/DOES-NOT-EXIST` and confirm a styled recovery screen appears.
- Open Reports and confirm **Export production summary** offers Markdown and JSON.
- Open Production and expand **Project readiness**.
