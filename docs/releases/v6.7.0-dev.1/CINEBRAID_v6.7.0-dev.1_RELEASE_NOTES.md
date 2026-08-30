# CineBraid 6.7.0-dev.1

**This is a development identity, not a published release.** No archive has been
built, signed or distributed under it. It exists so that a checkout of CineBraid
identifies itself honestly while the project is being prepared for public source
publication.

It does not claim a stable release, a production-ready build, or an announced
public alpha. It claims exactly what it is: the 6.7.0 line, in development.

---

## What changed since v6.7.0-private.1

Nothing about how CineBraid loads, saves, plans, renders or generates. This
version marks a public-source readiness correction, and the application behaviour
is unchanged.

### Release identity

The pre-release channel moved from `private` to `dev`.

`release-identity.js` derives every version surface from `package.json` "version",
and it gives an unlisted channel its raw version rather than an invented label —
so the display name is `CineBraid 6.7.0-dev.1` with no new label added to
`CHANNEL_LABELS`. The window title, the asset cache-busting stamps and the
lockfile were re-stamped by `npm run sync:version`; no version literal was edited
by hand.

A checkout no longer identifies itself as `Private Test 1` in its browser title,
its package metadata or its documentation headings.

### Licensing

`LICENSE` was the standard, unmodified **Apache License 2.0** text. It previously
described a private mainline build and pointed at a separately prepared Community
repository; that split is obsolete, and CineBraid is one complete application.
`package.json` now declares the SPDX identifier `Apache-2.0`.

New at the repository root:

- `CONTRIBUTING.md` — pull requests, DCO sign-off, no CLA.
- `SECURITY.md` — coordinated disclosure, and what counts as a vulnerability here.
- `TRADEMARKS.md` — the CineBraid name and logo are branding, held separately from
  the code licence.

There is no `NOTICE` file, because no shipped file carries an Apache NOTICE
obligation: nothing third-party is vendored into the tree, and the one runtime
dependency is installed on the destination machine rather than redistributed here.

### Typography no longer leaves the machine

All three HTML pages — including the pre-authentication `login.html` — used to
fetch web fonts from Google's CDN. CineBraid tells users it is local-only, so a
font request from the login screen contradicted the product's own claim before
anyone had signed in. The remote stylesheet links are gone and typography now
resolves from locally installed and system faces. No font binary was added.

`npm run check:public-exposure` fails if a remote font or CDN reference reappears
in the shell.

### The credential scan runs, and guards what is published

`npm run check:secrets` invoked the scanner with no target, so it printed usage
and exited 2 on every call — a check that had never once scanned anything. It now
scans two targets: every tracked file as it sits on disk, and the exact
`git archive` publication tree.

Synthetic fixture values are allowed one exact value at a time, per file and per
rule, and a suppression applies only to the matched text itself — so a line
carrying a fixture value and a real credential still reports the real one. The
scan is wired into `scripts/build-release.js`, which reads the archive buffer
before either artifact is written, and into `npm run check:ci`.

### Documentation truth

`README.md` claimed version 6.6.5 while `package.json` said 6.7.0, and named
Express as the only runtime dependency while the server probes `ffmpeg`. Both are
corrected, along with what ffmpeg is actually for and when provider credentials
are needed.

`docs/PUBLICATION.md` records the publication contract: only `main` travels, to
one named repository, with no mirror, no `--all` and no wildcard refspec.

---

## Known limitations

- This identity has no packaged archive. `npm run release:build` will produce one
  from any commit, but none has been published.
- There is no supported-version matrix. Development happens on `main`.
- Provider-backed generation still requires credentials the user supplies; nothing
  about that changed here.
