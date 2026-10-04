# Install/update — CineBraid 7.0 Public Alpha

Applies to the `7.0.0-alpha.1` source candidate/package, not a native installer.
A release/tag/download is not asserted before publication. Use an exact reviewed
commit or supplied manifest/checksums, never moving `main` as a release identity.

## Fresh Windows source-folder installation

Requires Node.js 18 or newer and npm; Node.js 24 is the qualified Windows runtime.
Git is needed only for a clone. No provider key, Python, model runtime or ffmpeg
is required for the manual sample; ffmpeg is optional for media utilities.

1. Compare supplied ZIP with `SHA256SUMS.txt` using `Get-FileHash -Algorithm SHA256`.
2. Extract to a new application folder, never over a production.
3. Place supplied `build-info.json` beside `package.json`; compare its version/
   commit to the manifest. It supplies installed identity without Git.
4. In the application folder:

```powershell
node --version
npm --version
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm start
```

Source archives omit `node_modules`; `npm ci` needs network access, installing
`express` and pinned `pngjs` from the lockfile. No frontend build step.
Windows `start.bat` may be used after installation. Keep the terminal open;
Ctrl+C stops the server. Check displayed version/build and printed local URL,
normally `http://127.0.0.1:4477`, plus active settings/projects paths.

Ordinary startup may reuse existing account data. A different app folder/port
alone is not isolation. Use the [Windows trial](../../../SETUP.md#windows-isolated-manual-trial)
for disposable sample work; no new Windows account is needed.

## First manual production

[Getting started](../../GETTING_STARTED.md) uses **Add the CineBraid sample** to
create an editable copy. Selections are not approvals; inspect exact state/view/
frame targets. Never repeat current approvals to clear badges. The source sample
remains untouched. Provider setup is optional.

## Upgrade, backup and rollback

Finish saves/provider work and stop the old instance. Back up the complete actual
projects root/media/backups and the active config/recovery copies/mappings separately.
A JSON backup alone is not a media backup. Credentials are plaintext; keep backups private.

Install to a new application folder and run `npm ci`. Preserve the old folder/data.
Explicitly establish intended config/project paths before startup; saved workspace
roots override environment defaults. Never run two versions against the same data.

Read/play saved media, inspect the same receipts/decisions/job provenance, save/
reopen, and verify backup restoration to a separate destination. Do not reapprove
or regenerate for persistence. Project/schema markers do not follow application version.

Rollback uses preserved compatible data/config with the intended earlier app.
Changing app code is not data rollback. Do not delete the sole media/config/production
copy or overwrite it with a restore test.

[Setup/storage](../../../SETUP.md#where-data-lives) ·
[Limitations](CINEBRAID_v7.0.0-alpha.1_RELEASE_NOTES.md).
