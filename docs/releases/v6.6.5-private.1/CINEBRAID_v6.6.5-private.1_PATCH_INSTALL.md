# CineBraid 6.6.5 Private Test 1 — install

This is a **fresh install from a packaged archive**, not a patch over an existing
directory. Install it beside whatever CineBraid you already run; nothing here
replaces or upgrades an existing copy. For the isolated Spark QA installation,
follow `docs/SPARK_QA_SETUP.md` instead — it covers the isolation this page does
not.

Requires **Node.js 18 or newer**. CineBraid is validated on Node 24 (Active LTS),
which is what Windows CI runs.

## Assets

| File | For |
|---|---|
| `cinebraid-6.6.5-private.1-windows.zip` | Windows |
| `cinebraid-6.6.5-private.1-runtime.tar.gz` | Linux, macOS, DGX Spark |
| `SHA256SUMS.txt` | checksums for every asset |
| `cinebraid-6.6.5-private.1-manifest.json` | machine-readable release manifest |
| `CINEBRAID_v6.6.5-private.1_RELEASE_NOTES.md` | what changed, and the known limitations |

Neither archive contains `node_modules`. Dependencies are installed on the machine
you install onto, which is why one runtime tarball serves x64 and arm64 alike.

## 1. Verify the download

Linux / macOS:

```bash
sha256sum -c SHA256SUMS.txt
```

Windows PowerShell:

```powershell
Get-FileHash .\cinebraid-6.6.5-private.1-windows.zip -Algorithm SHA256
```

Compare the result against the matching line in `SHA256SUMS.txt`. Do not install
an archive whose hash does not match.

## 2. Extract

Both archives extract to a single top-level folder, `cinebraid-6.6.5-private.1/`.

Windows — extracting needs no administrator permission. Extract anywhere you can
already write, such as `%USERPROFILE%\CineBraid`. Avoid `C:\Program Files`, which
does require elevation.

```powershell
Expand-Archive -Path .\cinebraid-6.6.5-private.1-windows.zip -DestinationPath "$env:USERPROFILE\CineBraid"
```

Linux / macOS:

```bash
tar -xzf cinebraid-6.6.5-private.1-runtime.tar.gz -C ~/
```

A path containing spaces is supported. Every startup script resolves its own
directory and quotes it — `start.bat` uses `cd /d "%~dp0"` and `start.sh` uses
`cd "$(dirname "$0")"` — so `%USERPROFILE%\My CineBraid Builds\` works. When you
type a path with spaces yourself, quote it.

## 3. Install dependencies

Run this on the machine CineBraid will run on:

```bash
npm ci
```

`npm ci` installs strictly from `package-lock.json` and fails if the lockfile and
`package.json` disagree, which is what makes the installed tree reproducible.

## 4. Start

| Platform | Command |
|---|---|
| Windows | `start.bat` |
| macOS | `./start.command` |
| Linux / DGX Spark | `./start.sh` |

Or directly, which is what the launchers do:

```bash
npm start
```

CineBraid listens on `http://127.0.0.1:4477` by default, loopback only.

## 5. Confirm

Open `http://127.0.0.1:4477`. The window title reads **CineBraid 6.6.5 Private
Test 1**. The shipped `cinebraid-sample` project opens in manual-first mode.
Opening it does not write to it.

## Choosing a different port, projects root or config path

All four are environment variables read at startup:

| Variable | Effect | Default |
|---|---|---|
| `PORT` | listening port | `4477` |
| `CINEBRAID_HOST` | bind address | `127.0.0.1` |
| `CINEBRAID_PROJECTS_ROOT` | projects directory | `<install>/projects` |
| `CINEBRAID_CONFIG_PATH` | config file path | `<install>/data/config.json` |

Set all four when running a second CineBraid on the same machine, so the two
installs share no port, no projects and no configuration. `docs/SPARK_QA_SETUP.md`
does exactly this.

Note that `CINEBRAID_PROJECTS_ROOT` sets the **default** projects root. A
`workspace.projectRoot` saved in the config file takes precedence over it, so an
isolated install needs its own `CINEBRAID_CONFIG_PATH` too — otherwise it can be
pointed back at another install's projects from inside the app.

## Uninstall

Stop the server and delete the extracted directory. CineBraid writes nothing
outside its install directory unless you configured it to.
