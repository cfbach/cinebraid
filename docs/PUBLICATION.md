# Publishing CineBraid to the public repository

CineBraid is developed in a private engineering origin and published to a
separate public repository. Publication is a deliberate transfer of **one branch**
between two repositories — never a visibility flip, never a mirror.

This document is the contract. `tests/public-exposure.js` asserts the parts of it
that can be checked mechanically, so the rules below cannot quietly rot.

## The two repositories

| | Repository | Visibility | Contains |
|---|---|---|---|
| Origin | `cfbach/cinebraid-app` | private | `main`, active engineering branches, research branches, review branches, internal material |
| Public | `cfbach/cinebraid` | public | `main` only |

The private origin is not a higher-feature edition. It is the same product, plus
work in progress. Research branches (`research/*`) and review branches stay
private because they are unreviewed, not because they are withheld.

## What travels

**Only `main`.** Nothing else.

- No `--mirror`. It would copy every ref namespace, including research branches
  and remote-tracking refs.
- No `--all`. It would copy every local branch.
- No wildcard refspec (`refs/heads/*`, `+refs/*:refs/*`). Wildcards are how an
  accidental research-branch publication happens.
- No `--follow-tags`, and no `--tags`. Tags are published only if that is
  approved separately, one tag at a time.
- No force push. The public history is append-only.

Private refs are never deleted to prepare a publication. They simply are not part
of the refspec.

## When it may happen

A commit is publishable only after all four of these are true:

1. The candidate has been independently reviewed for public exposure.
2. The exact SHA has been accepted as `PUBLIC_SAFE`.
3. That accepted SHA has been fast-forwarded, unchanged, into private `main`.
4. The push below is performed deliberately, by a human, against that SHA.

History is never rewritten to prepare a publication: no new root commit, no
squash, no regenerated commits for presentation. Private `main` and public `main`
are meant to sit at the **same exact SHAs**, because that is what makes the
review traceable afterwards.

## What a push makes readable

A public `main` push transfers **history**, not a snapshot. Everything reachable
from the published commit becomes readable, including file versions that were
deleted again before the tip.

That was measured, not assumed. Commit a fake key, delete the file, commit the
deletion: the working tree is clean, `git archive HEAD` is clean, a tip-only scan
reports clean — and `git cat-file` in the repository you just published still
returns the key. **A tip-only scan cannot be the publication gate.** Deleting a
secret before the tip does not unpublish it.

So the gate scans two different boundaries, and neither replaces the other:

| Boundary | Scan | Protects |
|---|---|---|
| current bytes | `--working-tree`, `--publication-tree`, and the archive scan inside `npm run release:build` | what a downloader gets |
| newly readable history | `--history-range <base>..<head>` | what a cloner can recover |

### Which baseline the history range starts from

**First publication.** `cfbach/cinebraid` has no published `main`, so there is no
public SHA to diff against. The baseline is the audited foundation
`25054fa1dde7979b66186f144a5fc84b77e591f4`, whose reachable history was the
subject of an independent full-history exposure audit (2026-08-30 — 505 commits,
5,089 unique blobs, 16,036 paths across 88 refs and 3 tags) that found no
credential, private key or token anywhere in it. Every commit after that
foundation is scanned.

Rescanning *all* history instead is equally sound and the scanner supports it
(`--history-range ..<candidate>`), but measured on this repository it reports four
`personal-path` hits in documentation prose — an account name in two audit records
and the literal placeholder `C:\Users\<name>\My CineBraid Builds\` in a v6.6.5
install note. None is a credential; all four were reviewed and accepted as
low-risk developer identifiers that do not warrant a history rewrite. The only
ways to make a full rescan pass would be to rewrite history or to widen the
allowlist, and both are worse than naming the evidence this baseline rests on.

**Every publication after the first.** The baseline is the SHA the public
repository actually holds — read from it at publication time, not remembered.
The range is `<published main>..<newly accepted private main>`.

`scripts/publication-preflight.js` freezes both rules, and
`tests/public-exposure.js` fails if either drifts.

## Preflight — read-only, run before every publication

One command performs the whole gate. It reads the repository, runs every scan,
and prints the push command. **It cannot push**: it contains no push, no remote
configuration and no network call, because a script that could push is a script
that can push by accident.

First publication:

```bash
npm run publication:preflight -- --first-publication
```

Every publication after the first:

```bash
npm run publication:preflight -- --public-sha <sha the public repository holds>
```

It runs these in order, and stops at the first one it cannot answer:

1. resolve the exact candidate (`main` unless `--candidate` says otherwise), and
   refuse unless the checkout is at it and clean;
2. resolve the baseline — the audited foundation, or the published SHA;
3. verify the baseline is an ancestor of the candidate — publication is
   fast-forward only, and anything else is a force push wearing a different hat;
4. verify the range is non-empty — nothing to publish is a refusal, not a pass;
5. scan the current tracked tree and the candidate's publication tree;
6. scan every file version newly readable across the range;
7. print the push command for a human to run.

Its exit codes are the scanner's, and mean the same things: **0** cleared,
**1** something disallowed was found, **2** it could not decide. `2` is not a
softer `1` — an unknown baseline, a non-ancestor baseline, a dirty checkout, an
empty range or a git enumeration failure all land there, because refusing to
answer is safe and guessing is not.

### The individual commands, if you want to run them by hand

None of these writes anything, locally or remotely.

Confirm what the public repository would receive:

```bash
git log --oneline -1 main
```

Confirm that commit is the reviewed and accepted `PUBLIC_SAFE` SHA:

```bash
git rev-parse main
```

Confirm no research material is reachable from `main` — this must print `0`:

```bash
git log --pretty=format: --name-only main | grep -c "^braidy/"
```

Confirm the current bytes are clean of credentials and personal paths:

```bash
npm run check:secrets
```

Confirm the history this push would make newly readable is clean:

```bash
node scripts/scan-secrets.js --history-range 25054fa1dde7979b66186f144a5fc84b77e591f4..main
```

Prove locally, without contacting GitHub, that publishing only `main` carries
only `main` — push into a throwaway bare repository and list what arrived:

```bash
git init --bare /tmp/cinebraid-publication-proof.git
```

```bash
git push /tmp/cinebraid-publication-proof.git main:refs/heads/main
```

```bash
git --git-dir=/tmp/cinebraid-publication-proof.git for-each-ref --format="%(refname)"
```

The last command must print exactly one line, `refs/heads/main`.

## The publication command

One branch, named on both sides, with no wildcard and no force:

```bash
git push https://github.com/cfbach/cinebraid.git main:refs/heads/main
```

Verify with a dry run first; it prints the same ref update without performing it:

```bash
git push --dry-run https://github.com/cfbach/cinebraid.git main:refs/heads/main
```

Do not add a permanent named remote for the public repository in a working
checkout. A named remote is what makes a stray `git push <remote> --all` possible.
Spelling the URL out at the moment of publication is the guard.

## Afterwards

Record the published SHA. Private `main` and public `main` must report the same
value:

```bash
git ls-remote https://github.com/cfbach/cinebraid.git refs/heads/main
```

If they ever differ, the public repository has received something that private
`main` did not review. Stop and reconcile before pushing again.
