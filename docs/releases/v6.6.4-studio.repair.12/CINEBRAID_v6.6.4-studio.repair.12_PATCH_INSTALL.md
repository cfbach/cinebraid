# Install — CineBraid v6.6.4-studio.repair.12

## Patch from repair.11

1. Stop CineBraid.
2. Back up the CineBraid application folder and current project folder.
3. Extract `CINEBRAID_v6.6.4-studio.repair.12_patch-from-v6.6.4-studio.repair.11.zip` over the existing repair.11 application folder.
4. Preserve the folder structure and replace included files.
5. Restart CineBraid.
6. Hard-refresh the browser once so the repair.12 cache-busted assets load.

The patch does not include project folders, project media, `data/config.json`, secrets, local model settings, storage settings, or `node_modules`.

## Full install
Extract `CINEBRAID_v6.6.4-studio.repair.12-ready-to-run.zip` into a new folder and run it normally.

## Recommended verification

```text
npm run check:syntax
npm run check:continuity-correction
npm run check:continuity-browser
npm run check:api
npm run check:fal
```
