# CineBraid v6.6.2.2 patch installation

This patch upgrades **v6.6.2.1** to **v6.6.2.2 — Integrity & Mobile Usability**.

## Before installing

1. Stop CineBraid.
2. Make a complete copy of the current CineBraid folder.
3. Keep a separate copy of the `projects/` folder and any project media stored outside it.
4. Confirm that the installed build is v6.6.2.1. For older builds, use the complete v6.6.2.2 archive instead of skipping intermediate patches.

## Install the patch

1. Extract `CINEBRAID_v6.6.2.2_patch-from-v6.6.2.1.zip`.
2. Copy its contents over the existing CineBraid v6.6.2.1 folder.
3. Allow matching application files to be replaced.
4. Do **not** delete or replace the existing `projects/` folder.
5. For the same clean root layout as the full archive, remove these obsolete v6.6.2.1-only files if they remain after the overlay:
   - `CINEBRAID_v6.6.2.1_RELEASE_NOTES.md`
   - `deep-product-audit-v2-results.json`
6. From the CineBraid folder, run:

```bash
npm install
npm run check
npm start
```

CineBraid should start on the configured local port, normally `4477`.

## What the patch changes

The patch replaces application, style, server, and test files needed for:

- unresolved shot-reference preservation, readiness reporting, Relink, and Remove;
- active-only docked Activity behavior;
- authority-header typography;
- Settings and shot-navigation accessible names;
- larger mobile hit areas;
- release-package verification and documentation hygiene;
- v6.6.2.2 version metadata and regression coverage.

It does not replace project JSON, project media, local model configuration, FAL credentials, backups, or automation-run data.

## First launch checks

1. Open **Settings** and confirm the existing assistant and generation configuration remains present.
2. Open **Production → Project readiness**.
3. If unresolved references appear, open the linked shot.
4. In **Inputs**, use:
   - **Relink** to select a deliberate replacement of the same relationship type;
   - **Remove** to delete the stale relationship from all affected shot fields.
5. Start a harmless local assistant task and confirm Activity appears without covering the page, then disappears after completion.

## Rollback

If the application does not start or a project behaves unexpectedly:

1. Stop CineBraid.
2. Restore the complete pre-update folder backup.
3. Restore the separate `projects/` backup only if project files were manually changed after installation.
4. Run `npm install` and `npm start` from the restored folder.

Do not merge selected JavaScript files from v6.6.2.2 into an older release. The shared resolver, client repair UI, readiness endpoint, and deletion logic are designed to ship together.
