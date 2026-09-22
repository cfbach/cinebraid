# Publishing CineBraid

CineBraid is developed in the open, in one repository:
**[`cfbach/cinebraid`](https://github.com/cfbach/cinebraid)**. Issues, branches,
pull requests, CI, tags and releases all live there. There is no private staging
copy and no mirror.

That makes one fact the centre of this contract: **every push publishes.** A branch
pushed to `cfbach/cinebraid` is readable by anyone the moment the push lands,
whether or not a pull request is ever opened for it, and it stays readable after
the branch is deleted. There is no later review step at which something becomes
public — the push is that step.

`tests/public-exposure.js` asserts the parts of this contract that can be checked
mechanically, so the rules below cannot quietly rot.

## One repository

| | Repository | Visibility | Role |
|---|---|---|---|
| Authority | `cfbach/cinebraid` | public | the only place development, review, CI and releases happen |
| Archive | `cfbach/cinebraid-app` | private, archived, read-only | the former engineering origin, frozen at the cutover below; research branches and internal review history stay there |

Until 2026-09-22 CineBraid was developed in the private `cfbach/cinebraid-app` and
published to `cfbach/cinebraid` one reviewed `main` at a time. On that date private
`main` was fast-forwarded into public `main` for the last time, at
`e31d9b370f348764cbf6c2183095a30099672a0b`, and the private repository was
archived. Both repositories carry that exact SHA, so every earlier commit on
public `main` is the same commit it was in the private origin.

Pull request numbers `#1`–`#86` in older commit messages and documents refer to
the archived private repository, not to pull requests here.

## How changes reach `main`

- **`main` changes only through a reviewed pull request merged on GitHub.** No one
  pushes to `main` directly — including an account that branch protection would
  let through. The pre-push gate below refuses it.
- **Published history is append-only.** No force push. Branch updates are
  fast-forwards; to change something already pushed, push a new commit.
- **Only named branches travel.** No `--mirror`, no `--all`, no wildcard refspec
  (`refs/heads/*`, `+refs/*:refs/*`) and no `--tags`/`--follow-tags`. Name the one
  branch you mean on both sides:

```bash
git push origin HEAD:refs/heads/your-branch-name
```

- **A tag is a release decision.** Tags are published one at a time, only for a
  commit already on `main`, and only when the release is decided. The gate
  refuses any tag the environment does not name exactly:

```bash
CINEBRAID_RELEASE_TAG=v1.2.3 git push origin refs/tags/v1.2.3:refs/tags/v1.2.3
```

## What a push makes readable

A push transfers **history**, not a snapshot. Everything reachable from the pushed
commit becomes readable, including file versions that were deleted again before
the tip.

That was measured, not assumed. Commit a fake key, delete the file, commit the
deletion: the working tree is clean, `git archive HEAD` is clean, a tip-only scan
reports clean — and `git cat-file` in the repository you just pushed to still
returns the key. **A tip-only scan cannot be the gate.** Deleting a secret before
the tip does not unpublish it, and deleting a pushed branch does not either.

So every gate scans two different boundaries, and neither replaces the other:

| Boundary | Scan | Protects |
|---|---|---|
| current bytes | `--working-tree`, `--publication-tree`, and the archive scan inside `npm run release:build` | what a downloader gets |
| newly readable history | `--history-range <base>..<head>` | what a cloner can recover |

## The gates

### 1. Your machine: the pre-push gate

Install it once per clone:

```bash
npm run hooks:install
```

That points `core.hooksPath` at the tracked `.githooks/` directory, whose
`pre-push` hook runs `scripts/push-gate.js` before git sends anything. For every
ref the push would update, the gate:

1. takes the exact commit git says it will send — never `HEAD`, never a branch
   name that may have moved;
2. asks the remote which commit its `main` is at (`git ls-remote`), and refuses if
   this checkout does not have it;
3. refuses a direct push to `main`, a non-fast-forward update, anything that is not
   a branch, and a tag the release environment does not name;
4. takes as its baseline what the remote provably already serves — the branch's
   current remote tip, or where a new branch leaves `main`;
5. scans the publication tree of the pushed commit;
6. scans every file version newly readable across the range, including ones
   deleted before the tip.

It exits **0** when nothing it would publish is disallowed, **1** when a scan
found something, and **2** when it refused by policy or could not decide. Any
non-zero exit stops the push. `2` is not a softer `1`: an unknown remote tip, a
missing baseline or a git failure is a refusal, because guessing is not safe.

The gate cannot push; it only reads. `git push --no-verify` skips it — which
breaks this contract, and is the one thing a maintainer must never do against
`cfbach/cinebraid`.

If the gate reports a finding in a commit that is not the tip, the push would
still publish it. Fix the branch before it is pushed — rewrite it locally or start
it again — because once pushed it cannot be recalled.

### 2. The server: `Publication scan`

The `Publication scan` job in `.github/workflows/windows-ci.yml` runs on every
pull request, from a fork or not:

```bash
node scripts/scan-secrets.js --history-range <base.sha>..<head.sha> --publication-tree <head.sha>
```

`base.sha` and `head.sha` come from the `pull_request` event. It is the check that
cannot be skipped: it guards what merging would add to `main`. It is intended as a
required status check beside `Windows validation`; branch protection must name it
for that to be enforced.

It cannot un-publish anything. By the time it runs the pull request's commits are
already public — in the contributor's fork or in a branch here — which is why the
local gate comes first.

### 3. Releases

`npm run release:build` scans the exact `git archive` bytes before it writes any
artifact. A release tag goes through the pre-push gate like any other ref.

## Where the history scan starts

The whole of public `main` has been read.

- `25054fa1dde7979b66186f144a5fc84b77e591f4` is the audited foundation: its
  reachable history was the subject of an independent full-history exposure audit
  (2026-08-30 — 505 commits, 5,089 unique blobs, 16,036 paths across 88 refs and
  3 tags) that found no credential, private key or token.
  `tests/public-exposure.js` rescans every commit from there to the tip.
- A full rescan of everything before it reports four `personal-path` hits in
  documentation prose — an account name in two audit records and the literal
  placeholder `C:\Users\<name>\My CineBraid Builds\` in a v6.6.5 install note.
  None is a credential. All four were reviewed and accepted as low-risk developer
  identifiers; they have been public since the first publication, and removing
  them would mean rewriting published history.
- Each publication from the former private origin was scanned from the SHA the
  public repository then held. The last one, `d5342b98..e31d9b37` (74 commits,
  632 file versions), reported nothing.

From here on the baseline is never remembered: it is whatever the remote serves at
the moment of the push, or the pull request's base.

## Checks you can run by hand

None of these writes anything, locally or remotely.

The current bytes:

```bash
npm run check:secrets
```

Everything a branch adds over `main`:

```bash
node scripts/scan-secrets.js --history-range origin/main..HEAD --publication-tree HEAD
```

That no research material is reachable from `main` — this must print `0`:

```bash
git log --pretty=format: --name-only origin/main | grep -c "^braidy/"
```

## If something is published by mistake

Treat any credential that reached this repository as compromised: revoke and
rotate it first, then remove it. Rewriting history afterwards does not recall
clones, forks or caches that already have it, and GitHub can keep serving an
unreferenced commit by its SHA. Report anything sensitive through the private
channel in [SECURITY.md](../SECURITY.md), not in a public issue.
