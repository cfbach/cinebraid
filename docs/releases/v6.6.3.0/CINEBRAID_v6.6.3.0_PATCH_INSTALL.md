# CineBraid v6.6.3.0 patch installation

## Recommended: full ready-to-run build

1. Stop the running CineBraid server.
2. Keep your existing project folders and any external asset backups.
3. Extract the v6.6.3.0 ready-to-run archive into a new folder.
4. Copy or point the new installation to the same project data only if your local setup stores projects outside the application folder.
5. Run `npm start` and open `http://127.0.0.1:4477`.
6. Hard-refresh the browser once so the v6.6.3.0 script cache versions load.

## Incremental patch from v6.6.2.2

1. Stop CineBraid.
2. Back up the v6.6.2.2 application folder.
3. Extract the patch over the v6.6.2.2 folder, preserving paths and allowing replacement.
4. Remove any browser cache for the CineBraid origin or hard-refresh after restart.
5. Run `npm run check:reference-authority` for the focused authority suite, or `npm run check` for the complete suite.
6. Start CineBraid with `npm start`.

## Existing projects

No project-schema migration is required. Previous AI review records remain visible, but older review contracts cannot authorize a new assignment. Re-run review for any candidate you intend to approve or assign.

For references already created outside CineBraid:

1. Open the asset in References.
2. Choose **Map imported references**.
3. Select the existing image and its exact continuity state or coverage slot.
4. Run AI review.
5. Confirm the assignment.
6. Generate only the remaining missing states or views.

## Existing failed alerts

Open Global Activity and use **Dismiss** on an obsolete failure or **Dismiss previous alerts** for all old failed/interrupted runs. Dismissal archives the alert; the complete run remains in Reports.
