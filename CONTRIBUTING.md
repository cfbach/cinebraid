# Contributing to CineBraid

Thanks for taking the time. CineBraid is one complete, self-hostable application,
and contributions are welcome on that basis.

## How to contribute

Open a pull request. There is no separate proposal process for ordinary changes —
a focused PR with a clear description of what changed and why is enough. For a
large or architectural change, open an issue first so the direction can be agreed
before you spend the effort.

## Sign your commits (DCO, not a CLA)

CineBraid does **not** use a Contributor Licence Agreement, and it does not ask
you to assign or reassign copyright. You keep the copyright in what you write.

Instead, every commit must carry a Developer Certificate of Origin sign-off. The
DCO is a short statement that you have the right to submit the work under the
project's licence. Read it at <https://developercertificate.org/> — it is version
1.1 and it is the whole agreement.

Sign off by adding a `Signed-off-by` trailer with your real name and email:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Git will add it for you:

```bash
git commit -s -m "your message"
```

To sign off commits you have already made on your branch:

```bash
git rebase --signoff main
```

By signing off you are certifying the DCO and licensing your contribution under
the repository's licence — Apache License 2.0, the same terms as the rest of the
project. See [LICENSE](LICENSE).

## What to run before you submit

CineBraid's suites are local and deterministic: none of them contacts a provider,
and none of them needs an API key.

```bash
npm run check:quick
```

The fast path — syntax, rendering, core contracts and the main workflow suites.
Run it while you work.

```bash
npm run check:ci
```

The portable suites run by Windows CI for pull requests. **Windows validation is
the required public status check. Browser validation is advisory pending
`BROWSER_GATE_RUNNER_STABILITY_V1`.** A local result does not replace the reported
Windows status for the candidate under review.

```bash
npm run check
```

The full verification, including browser and release-related suites. Some browser
suites self-skip without their runtime; a skip is not browser validation. The
separate `check:browser-gate` and `check:release` commands fail when the required
runtime is missing. Advisory repository status does not weaken those commands.
See the [browser test guide](docs/qa/BROWSER_TESTS.md).

If your change adds behaviour, add or extend a suite that would fail without it.
If it changes documented behaviour, update the documentation in the same PR.

## Security issues do not belong in a pull request

If you have found a vulnerability, do **not** open a public issue or PR for it.
Follow [SECURITY.md](SECURITY.md) instead, so a fix can be prepared before the
problem is described in public.

## Name and logo

The Apache 2.0 licence covers the code. It does not grant rights to the CineBraid
name or logo — see [TRADEMARKS.md](TRADEMARKS.md) before using either in a fork or
a derived product.
