# Install CineBraid v6.6.4-studio.repair.7

## Patch from repair.6
1. Stop CineBraid.
2. Back up the application folder and project folders.
3. Extract `CINEBRAID_v6.6.4-studio.repair.7_patch-from-v6.6.4-studio.repair.6.zip` over the repair.6 application folder.
4. Preserve the folder structure and replace the included application files.
5. Restart CineBraid and hard-refresh the browser once.

The patch excludes `data/config.json`, project folders, uploaded/generated media, API keys, local model names, and `node_modules`.

## Complete package
Extract `CINEBRAID_v6.6.4-studio.repair.7-ready-to-run.zip` into a new writable folder. The archive includes `node_modules`.

## Verify
Run:

```bash
npm run check:quick
npm run check:h3-browser
npm run check:preview-layout
```
