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

## Preflight — read-only, run before every publication

None of these commands writes anything, locally or remotely.

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

Confirm the publication tree is clean of credentials and personal paths:

```bash
npm run check:secrets
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
