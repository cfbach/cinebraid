# Install CineBraid v6.6.4-studio.repair.9

## Patch from repair.8

1. Stop CineBraid.
2. Back up the current CineBraid folder.
3. Extract `CINEBRAID_v6.6.4-studio.repair.9_patch-from-v6.6.4-studio.repair.8.zip` over the repair.8 application folder.
4. Preserve the directory structure and replace included application files.
5. Restart CineBraid.
6. Hard-refresh the browser once so the repair.9 cache-busted assets load.

The patch excludes:
- `data/config.json`
- project folders
- project media
- API keys
- local model configuration
- `node_modules`

## Complete installation

Extract `CINEBRAID_v6.6.4-studio.repair.9-ready-to-run.zip` into a new folder and start CineBraid normally.
