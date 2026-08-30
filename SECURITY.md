# Security

CineBraid is a local-first application. By default the server binds `127.0.0.1`
and nothing outside the machine can reach it, provider credentials stay on the
server, and projects stay in the workspace you configure. LAN exposure is a
deliberate opt-in (`npm run start:lan`), and it prints a warning when you take it.

That posture is the design, not a guarantee. If you find a way around it, please
tell us before you tell everyone else.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting on this
repository: **Security → Advisories → Report a vulnerability**. That channel is
visible only to the maintainers, and it keeps the report and the fix in one place.

Please do not open a public issue, a pull request, or a discussion for a
vulnerability, and please do not post a working exploit publicly, until a fix is
available and we have agreed on timing. If a report is already public before we
see it, say so in the report so we know the clock is different.

Useful things to include: what an attacker gains, the smallest reproduction you
have, the CineBraid version (`package.json` "version"), the operating system and
Node version, and whether the machine was running in the default local-only mode
or with `--lan`.

## What counts as a vulnerability here

A security issue lets someone do something the design says they cannot. For
example:

- reaching the application, or its data, from off the machine while it is in the
  default local-only mode;
- reading provider credentials out of the server — through the API, the browser,
  a support bundle, a log or an export;
- writing outside the configured projects workspace, or reading a file outside it,
  through an import, an upload, a project path or an archive;
- bypassing the editor passcode when one is set;
- causing CineBraid to send project material somewhere it was not asked to.

A normal bug is anything else: a wrong result, a broken view, a crash on bad
input that does not cross one of those lines. Those belong in a public issue,
where they can be discussed and fixed in the open. If you are not sure which one
you have, report it privately — we would rather triage it than miss it.

Out of scope, because they are stated non-goals rather than defects:

- anything that requires an already-hostile process on the same machine. Any
  process that can rewrite `project.json` can write whatever it likes; CineBraid's
  in-page authority model defends against accident, not against an attacker who
  already owns the machine.
- consequences of turning on LAN mode without setting an editor passcode.
  `--lan` warns about exactly this.
- vulnerabilities in a third-party model provider or a local model runtime.
  Report those to the provider; tell us if CineBraid makes them worse.

## What we can promise

CineBraid is developed by a very small team, and this is a pre-release codebase.
We are not going to publish a response-time commitment or a support tier we
cannot keep. What we will do is read every private report, tell you whether we
consider it a vulnerability, and coordinate disclosure with you if it is.

There is no supported-version matrix yet: development happens on `main`, and
fixes land there.
