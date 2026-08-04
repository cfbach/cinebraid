# Install CineBraid v6.6.4-studio.repair.6

## Patch from repair.5
1. Stop CineBraid.
2. Back up the application folder and project folders.
3. Extract `CINEBRAID_v6.6.4-studio.repair.6_patch-from-v6.6.4-studio.repair.5.zip` over the repair.5 application folder.
4. Preserve the folder structure and replace the included application files.
5. Restart CineBraid and hard-refresh the browser once.

The patch excludes `data/config.json`, project folders, uploaded/generated media, API keys, local model names, and passwords.

## Complete package
Extract `CINEBRAID_v6.6.4-studio.repair.6-ready-to-run.zip` into a new folder. The archive includes `node_modules`; testers do not need to run `npm install`.

## Verify
Run:

```bash
npm run check:quick
npm run check:h3
```
