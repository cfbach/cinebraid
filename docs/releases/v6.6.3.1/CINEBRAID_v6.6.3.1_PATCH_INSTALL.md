# CineBraid v6.6.3.1 patch installation

## Recommended installation

1. Stop CineBraid.
2. Back up the current CineBraid folder and project folders.
3. Extract the v6.6.3.1 ready-to-run archive into a new folder.
4. Copy or link your existing `projects/` folders into the new installation as appropriate.
5. Run `npm install` only if `node_modules` is not present.
6. Start CineBraid with `npm start`.
7. Hard-refresh the browser once so the v6.6.3.1 cache versions load.

## Incremental patch

The patch archive is intended for an unchanged v6.6.3.0 installation.

1. Stop CineBraid.
2. Back up the application and project folders.
3. Extract the patch over the v6.6.3.0 application folder, preserving paths.
4. Start CineBraid.
5. Hard-refresh the browser.

## After upgrading

Open **Settings → Project** and confirm the desired Workspace emphasis:

- Manual-first production;
- Assisted generation.

Projects without a previously saved preference default to Manual-first production. This does not change project authority or delete generation history.
