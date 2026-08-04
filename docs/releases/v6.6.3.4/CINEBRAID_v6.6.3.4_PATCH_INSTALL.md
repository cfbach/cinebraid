# CineBraid v6.6.3.4 patch installation

1. Stop CineBraid.
2. Back up the current application folder and active project folder.
3. Extract `CINEBRAID_v6.6.3.4_patch-from-v6.6.3.3.zip` over the v6.6.3.3 application folder.
4. Run `npm run check:quick`.
5. Restart with `npm start` for local-only use or `npm run start:lan` for deliberate Spark/LAN access.
6. Hard-refresh the browser once so the v6.6.3.4 cache-busted assets load.

Existing projects require no migration. Test notes are stored per project in `test-feedback.json` only after a user saves the first note.
