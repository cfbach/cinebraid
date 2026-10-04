# CineBraid setup — 7.0 Public Alpha

## Requirements and source install

This tree is the `7.0.0-alpha.1` source candidate. No GitHub Release, tag or
available download is asserted by these instructions. Use an exact reviewed
commit or supplied source archive identified by its manifest/checksums;
never use moving `main` as a frozen package identity.

Requires **Node.js 18 or newer** and npm; Node.js 24 is the qualified Windows
runtime. Git is required only for cloning. There is no frontend build step.
Runtime dependencies are `express` and `pngjs` (pinned to 7.0.0). Source archives
omit `node_modules`; `npm ci` needs network access. ffmpeg is optional,
not bundled, and used by media inspection/proxy utilities. No credential is
needed for manual work.

Extract the supplied verified source ZIP into a new application folder. Open
PowerShell there and check its manifest/checksums, then:

```powershell
node --version
npm --version
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
```

Copy the supplied `build-info.json` beside `package.json` if provided; it names
the source commit in an installed copy without Git. Check the displayed build
identity after startup. Without supplied identity it may report Development build.
[7.0 install/update](docs/releases/v7.0.0-alpha.1/CINEBRAID_v7.0.0-alpha.1_PATCH_INSTALL.md)
explains the package boundary. A release-tag clone command belongs to instructions
supplied after that tag exists; do not guess it during source-candidate review.

For ordinary personal use `npm start` uses this account's settings/projects.
A second application folder alone is not isolation. For a disposable trial use
separate settings, projects and port as below.

## Windows isolated manual trial

Open a **new PowerShell window in the application folder**. This recipe creates
an empty, provider-free settings profile and projects folder under the system
temporary directory. It does not open your ordinary production workspace.
Use it with disposable sample work only; temporary storage is not a production
backup. The variables affect this terminal and its child server only.

```powershell
$cinebraidTrial = Join-Path ([System.IO.Path]::GetTempPath()) ('cinebraid-trial-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $cinebraidTrial | Out-Null
New-Item -ItemType Directory -Path (Join-Path $cinebraidTrial 'projects') | Out-Null

$env:CINEBRAID_CONFIG_PATH = Join-Path $cinebraidTrial 'config.json'
$env:CINEBRAID_PROJECTS_ROOT = Join-Path $cinebraidTrial 'projects'
$env:CINEBRAID_COMFY_REGISTRY_PATH = Join-Path $cinebraidTrial 'comfy-workflows.json'
$env:CINEBRAID_TEST_MODE = '1'
$env:CINEBRAID_HOST = '127.0.0.1'
$env:CINEBRAID_LAN = '0'
$env:PORT = '4488'
$env:FAL_KEY = ''
$env:OPENAI_API_KEY = ''
$env:ANTHROPIC_API_KEY = ''
$env:GOOGLE_API_KEY = ''

$cinebraidTrialConfig = '{"assistant":{"provider":"none","visionProvider":"none"},"agents":{"enabled":false},"generation":{"fal":{"enabled":false}},"workspace":{"projectRoot":"","mediaRoot":"","outputRoot":"","backupRoot":""},"activeProject":""}'
Set-Content -LiteralPath $env:CINEBRAID_CONFIG_PATH -Value $cinebraidTrialConfig -Encoding ascii
Write-Host "Trial files: $cinebraidTrial"
npm start
```

If 4488 is occupied, choose another unused port before starting. Keep the terminal
open. Read the printed URL, bind address, settings **mode** and **projects root**.
The mode should be `explicit override (CINEBRAID_CONFIG_PATH)` and the projects
root must name this trial. The exact settings file is `$env:CINEBRAID_CONFIG_PATH`;
you can also inspect it in **Settings → Files & storage**. Open the printed URL (normally
`http://127.0.0.1:4488`) in a private browser window. The welcome screen should
offer **Create a project** and **Add the CineBraid sample**. Adding the sample
copies it into this trial; merely starting the app does not approve its media.

Follow the [7.0 first-shot guide](docs/GETTING_STARTED.md).
Press **Ctrl+C** in the server terminal to stop; wait for it to exit.
Run `npm start` again in the same window to reopen the same trial.
Closing that PowerShell window discards its environment overrides; it does not
delete the trial files. Keep the printed path if you want to inspect or preserve
the sample work. Do not use this temporary root for a real production.

Both a separate `CINEBRAID_CONFIG_PATH` and a separate
`CINEBRAID_PROJECTS_ROOT` matter: a saved `workspace.projectRoot` overrides the
environment default. A different port or browser window alone does not isolate
data. Test mode refuses settings, projects and configured storage paths outside
disposable temporary locations. Automated suites should use
`tests/helpers/disposable-root.js`; `scripts/qa-sandbox.js` prepares a populated
sample workspace for hand testing, rather than an empty first-run screen.
See also [browser test isolation](docs/qa/BROWSER_TESTS.md).

## Start, stop, and launcher behavior

After `npm ci`, use `npm start` and open the local URL printed by the server
(default `http://127.0.0.1:4477`). Keep its terminal open; Ctrl+C stops the server.

Windows `start.bat` runs `npm ci` if
`node_modules` is absent, stops on installation failure and prints the server's
URL without opening a browser. Run `npm ci` yourself first for reproducible dependency installation.
The macOS/Linux launchers can use `npm install --silent` when dependencies are
absent, so run `npm ci` yourself first. Locally built source archives omit
`node_modules` and still require Node.js and dependency installation.

## Where data lives

Fresh Windows defaults are:

| Data | Default location |
|---|---|
| Projects, media and project backups | `%USERPROFILE%\CineBraid Projects` |
| Settings and provider credentials | `%LOCALAPPDATA%\CineBraid\config.json` |
| ComfyUI workflow mappings | `<application>\data\comfy-workflows.json` |
| Embeddings cache | `<application>\data\embeddings.json` |

macOS settings use `~/Library/Application Support/CineBraid/config.json`;
Linux uses `CineBraid/config.json` under `XDG_CONFIG_HOME` (default `~/.config`).
Projects default to `~/CineBraid Projects` on those platforms.
The public sample in `<application>/projects/cinebraid-sample` is application
content; **Add the CineBraid sample** makes a separate editable copy.

Project-root precedence, highest first:

1. `workspace.projectRoot` saved in the active settings file.
2. `CINEBRAID_PROJECTS_ROOT`, an environment default.
3. This application's `projects/` folder if it contains legacy productions,
   including archived or trashed projects. The bundled sample does not count.
4. The per-user default above.

The startup banner and **Settings → Files & storage** name the actual root.
An existing installation may still use an application-local root. Changing the
root there deliberately copies projects, verifies the result and retains the
source; it is not an automatic move or deletion.

`CINEBRAID_CONFIG_PATH` selects one explicit settings file and bypasses automatic
per-user migration. Without that override, first start can copy usable legacy
`data/config.json` from **this installation** when no per-user settings file exists.
The copy is verified and the original retained. Existing per-user settings win
and are never merged with legacy settings. A new application folder does not
discover legacy settings in a different old folder. If the active file is damaged,
the app can recover its valid `.bak`; an unusable authoritative file is not a
reason to silently fall back to old settings or an empty profile.

Settings are ordinary **plaintext JSON**, not an encrypted vault. Key readbacks
are masked and OAuth secrets omitted; ordinary endpoint URLs can remain visible.
The file and adjacent `.bak`, `.corrupt` or temporary recovery files depend on OS
account permissions and may contain sensitive material. Keep private backups
private. This guide does not delete old settings or rotate credentials.

`CINEBRAID_COMFY_REGISTRY_PATH` can relocate workflow mappings. Preserve mappings
or register them again when replacing an application folder. The embeddings cache
is also application-local by default; do not claim all user state has moved
outside the checkout.

## Optional services

Manual production needs no API key, model server or provider.
Use **Settings → Studio → Braidy & assistance**
and **Settings → Connections**. Read the
[optional-services guide](docs/guides/OPTIONAL_SERVICES.md) for exact
adapters, setup, reachability and qualification limits.

## Network posture

CineBraid is **local-only by default**, bound to `127.0.0.1`.
To share deliberately on a trusted LAN, first set an Editor passcode, then run
`npm run start:lan` (or `node server.js --lan`). This binds `0.0.0.0`.
Without a passcode, anyone who can reach that port can drive the application.
Do not port-forward it or expose it directly to the public internet.
A same-machine AI server does not require LAN mode.

The interface comes from your CineBraid server without third-party fonts,
analytics, scripts or stylesheets. Optional health/model-list requests can contact
configured endpoints. Requested cloud work sends required prompts/context/media;
collecting outputs may download remote media. Files imported in a LAN browser
travel to the CineBraid machine. “Local / self-hosted” describes a setup choice,
not proof that the configured endpoint or its operator never forwards data.
ComfyUI dispatch is restricted to a same-machine target and same-machine caller.

## Upgrade and rollback

1. Finish saves and any provider work, then stop the server. Do not run two
   versions against the same settings/projects simultaneously.
2. Confirm and privately back up the actual settings file and its recovery
   copies, the entire projects root (including archive/trash), any legacy
   application-local data, and ComfyUI mappings.
3. Put the exact intended version in a new application folder and run `npm ci`.
   Use the [7.0 update guide](docs/releases/v7.0.0-alpha.1/CINEBRAID_v7.0.0-alpha.1_PATCH_INSTALL.md)
   with its exact source/package identity. Do not fetch moving `main` and call it a frozen release.
4. With ordinary per-user settings, the new folder normally reuses them. With
   legacy installation-local settings/projects, preserve the old folder and
   explicitly establish the intended paths before startup; a new folder cannot
   find another installation's files automatically.
5. Start, hard-refresh, verify version/commit and both data locations, then reopen
   representative media and decisions before continuing work.

Only replace or remove an old application folder after confirming that it holds
no sole copy of your projects, settings or mappings. External storage reduces
upgrade risk; it is not a guarantee against deleting the wrong folder.
There is no native uninstaller. Removing application files and removing personal
data are separate choices; neither requires deleting the other.

For rollback, stop the newer server, use preserved compatible project/settings
copies and explicitly select the intended config path. Verify compatibility
before editing. Changing application code is not a project-data rollback.
Legacy cleanup and credential rotation remain separate decisions; no CS-4
cleanup completion is claimed.

For a project-root copy, the existing verifier can compare source and destination:

```text
node scripts/verify-migration.js --manifest "<old root>" --out before.json
node scripts/verify-migration.js --compare "<old root>" "<new root>" --documents-republished
node scripts/verify-migration.js --manifest "<old root>" --out after.json
node scripts/verify-migration.js --compare-manifests before.json after.json
```

The destination comparison allows live project documents to be republished
through the application writer. Comparing the two source manifests allows no
change to the source.

## Verification

`npm run check:quick` runs development checks; `npm run check:ci` is the portable
registered validation; `npm run check` is the full maintainer runner.
**Windows validation is required; Browser validation is advisory pending
`BROWSER_GATE_RUNNER_STABILITY_V1`.** Python is optional for normal use.
The strict `check:browser-gate` and `check:release` commands fail if their required
runtime is absent even though some individual suites can skip.
See the [browser test guide](docs/qa/BROWSER_TESTS.md).

## Optional services and alpha boundaries

Use **Settings → Studio → Braidy & assistance** for assistant selection and
**Settings → Connections** for OpenAI, Fal and other existing integrations.
[Optional services](docs/guides/OPTIONAL_SERVICES.md) explains qualified modes,
server-side plaintext credentials, costs and experimental controls.

Deterministic Build works with Braidy disabled. Braidy target review is an
OpenAI-backed advisory proposal requiring coverage/omission review; it never
approves or changes Canon. Delivery is manual physical media handoff, not an NLE
export pipeline or sound mix. Desktop is primary; basic responsive behavior exists.
Assisted continuity repair and per-frame AI critique remain unqualified.

See [Working now, limitations, roadmap and feedback](README.md). Never include
secrets or private project/config files in public screenshots, logs or feedback.
