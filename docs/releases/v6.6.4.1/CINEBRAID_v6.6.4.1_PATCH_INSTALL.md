# CineBraid v6.6.4.1 patch installation

This patch upgrades **v6.6.4.0** to **v6.6.4.1**.

1. Stop CineBraid.
2. Back up the application folder, `projects/`, and `data/`.
3. Extract the patch over the v6.6.4.0 application folder, preserving the folder structure.
4. Start with `npm start`, or use `npm run start:lan` for DGX Spark desktop access.
5. Hard-refresh the browser once so the new cache-busted interface loads.

## Preservation guarantees

The patch archive contains no `projects/`, `data/`, or `node_modules/` files. Applying it therefore does not overwrite project data, `data/config.json`, model profiles, or installed dependencies.

The application introduces no schema migration. Project deletion inside CineBraid is recoverable: the complete project folder is moved to `projects/.trash`.
