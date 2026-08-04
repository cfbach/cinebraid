# CineBraid v6.6.4-studio.4 patch installation

This patch upgrades **v6.6.4.1** to **v6.6.4-studio.4**.

1. Stop CineBraid.
2. Back up the current application folder, `projects/`, and `data/`.
3. Extract `CINEBRAID_v6.6.4-studio.4_patch-from-v6.6.4.1.zip` over the v6.6.4.1 application folder, preserving the folder structure.
4. Start with `npm start`, or use `npm run start:lan` for deliberate trusted-LAN access.
5. Hard-refresh the browser once so the v6.6.4-studio.4 cache-busted assets load.

The patch archive contains application and documentation changes only. It does not contain or overwrite `projects/`, `data/`, or `node_modules/`.
