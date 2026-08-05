# CineBraid 6.6.5 Private Test 1 — verification report

## What is verified, and how

### Source state

Both archives are produced by `git archive` from a single commit. Nothing
untracked, ignored or locally modified can reach them, and the two archives
cannot drift from each other, because they are two encodings of one tree.
`scripts/build-release.js` refuses to run against a dirty working tree.

### Exclusions

`.gitignore` already keeps `node_modules/`, `.env`, `data/config.json`, local
worktrees, `.claude/settings.local.json`, QA output, backups, generated media and
`*.zip` out of the tree. `.gitattributes` `export-ignore` additionally drops CI
wiring, local agent state and historical QA evidence from the archives.

`scripts/build-release.js` does not trust either of those. It parses the tar it
just produced and asserts, against the real archive contents, that none of the
following is present: `.git` metadata, `node_modules`, `.env`, `.claude/`,
`data/config.json`, nested release artifacts, QA evidence or generated output,
project backups, logs/temp files, CI wiring. It asserts `projects/` contains
`cinebraid-sample` and nothing else, and that a list of files a fresh install
cannot start without is present.

### Architecture neutrality

Asserted directly: no `.node`, `.dll`, `.so`, `.dylib` or `.exe` is in either
archive, and no `node_modules` is shipped. Dependency installation is deferred to
the destination platform via `npm ci`, which is what makes the runtime tarball
usable on the Spark's arm64 Linux from a build produced on Windows.

### Line endings and permissions

Read back out of the shipped tar, not from the working tree:

- `start.sh` and `start.command` contain no CRLF.
- `start.sh` and `start.command` retain their executable bit.
- `start.bat` contains CRLF.

### Credential and privacy scan

`scripts/scan-secrets.js` scans the extracted packages for FAL / OpenAI /
Anthropic / GitHub / AWS credentials, private key blocks, hard-coded bearer
tokens, credential-bearing URLs and personal filesystem paths.

Every run first validates the scanner against a **synthetic positive control**: a
throwaway directory of fake credentials written to the OS temp area, never into
the repository or a package. If any rule fails to fire on the control, the run
fails instead of reporting a clean scan.

### Clean-install verification

Each archive is extracted into a fresh temporary directory **outside the
repository** and then, independently:

1. checksums and manifest verified
2. `npm ci`
3. started with an isolated `CINEBRAID_CONFIG_PATH`, `CINEBRAID_PROJECTS_ROOT`
   and a free non-production `PORT`
4. HTTP 200 confirmed
5. shipped sample confirmed to load
6. model profiles confirmed to populate
7. major routes confirmed to render
8. the sample confirmed byte-identical after being opened
9. the exact recorded server PID stopped
10. the port confirmed to rebind immediately
11. unrelated Node processes confirmed still running

Port 4477 is not used at any point.

---

## Results

*Recorded after the packaged build. See the `Measured results` section below.*
