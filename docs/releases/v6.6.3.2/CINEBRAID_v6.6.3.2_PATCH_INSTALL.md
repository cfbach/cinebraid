# CineBraid v6.6.3.2 patch installation

## Incremental patch from v6.6.3.1

1. Stop CineBraid.
2. Back up your existing `projects/` and `data/` folders.
3. Extract the v6.6.3.2 incremental patch over the v6.6.3.1 application folder.
4. Keep your existing project folders and `data/config.json` when prompted.
5. Start with `npm start`.
6. Open `http://127.0.0.1:4477` and hard-refresh once.

The patch does not delete or replace existing projects. The sanitized sample and provider-disabled default configuration are intended for the complete external-test archive, not as replacements for an established installation.

## Complete archive

For a separate test installation:

1. Extract the full ready-to-run archive into a new folder.
2. Confirm Node.js 18 or newer with `node --version`.
3. Run `npm start`.
4. Open `http://127.0.0.1:4477`.
5. Walk through **CineBraid Sample — The Blue Parcel**.

To enable trusted-network access, set an Editor passcode and start with `npm run start:lan`.
