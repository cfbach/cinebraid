# CineBraid 6.7.0-alpha.1 — Public Alpha

**This is the identity CineBraid is first shared publicly under.** It is an alpha:
the 6.7.0 line, in development, offered for people to run and report on. It does
not claim a stable release, a supported-version matrix, or a production-ready
build.

The pre-release channel moved from `dev` to `alpha`. `release-identity.js` was not
modified — it gives a channel that is not in `CHANNEL_LABELS` its raw version
rather than an invented label, so the display name is `CineBraid 6.7.0-alpha.1`
and no label was added. `npm run sync:version` re-stamped the window title, the
asset cache stamps and the lockfile; no version literal was edited by hand.

---

## What this version is for

Everything CineBraid holds — the Project Bible, references, continuity, shots,
review and approval — stays on the machine you run it on. It binds `127.0.0.1` by
default and uploads nothing on its own. A production can be planned and finished
by hand, with no assistant configured and no generation enabled.

That is the claim this alpha exists to test with people who are not us.

## What changed since v6.7.0-dev.1

`6.7.0-dev.1` was a public-source readiness correction that deliberately changed
no application behaviour. The work between it and this identity is product work,
and it is the substance of the alpha.

### Braidy

The assistant has a name, a face and a rail of its own, and — more importantly —
a single published capability standing that every surface reads instead of
guessing. A capability nobody turned on reports "off" rather than a failure. An
unreachable Braidy names the model it was going to use. The Assistant screen says
where each capability stands before it offers any plumbing.

Configuration asks **where a capability runs** — on your own hardware or a cloud
provider — before it asks which protocol to speak. Self-hosted is a statement
about whose hardware answers, not about whether anything travels.

### Generation routes

Two backends joined fal:

- **Local ComfyUI**, mounted beside fal rather than through it. A ComfyUI server
  on the same machine has nothing to authorise and no cost to price, so it is not
  routed through fal's dispatcher or gated on fal's key. Every ComfyUI route
  refuses a non-loopback caller: the host configuration is not editable from
  another device.
- **Civitai**, which does have everything to authorise. A permit binds the exact
  request it paid for, Buzz is not dollars, and a delivered job carries no failure
  message.

The browser loads every configured backend's generation ledger, and each row
routes to the backend that owns it.

### References and approval

Reference Workflow Coherence V2: a reference is shown whole, the strip that routes
to it can be read, and the reference a filmmaker asked for is the task on the page.

Imported-reference approval now prepares identity **before** the decision rather
than discovering it was missing afterwards. Readiness is bound to what is on
screen; anything moving withdraws the confirm control.

**The rename is gone from reference approval.** An approved image keeps the name
it was imported under. A production filename is an address, not an identity and
not the decision. Shot take approval still renames, unchanged.

An approval that cannot be saved cannot be entered: while one submission is
unresolved the recovery dialog holds a modal lock, the shell's own regions go
inert, and navigation is refused at the seam every view change passes through.
What the workspace accepts and what the save path will keep now agree.

---

## Known limitations

- **No published archive under this identity.** The first public sharing is
  source-first. `npm run release:build` produces a Windows ZIP, an
  architecture-neutral runtime tarball, a manifest and `SHA256SUMS.txt` from any
  commit, but none has been published yet.
- **No supported-version matrix, and no response-time commitment.** Development
  happens on `main`. `SECURITY.md` says what is promised, which is deliberately
  less than a support tier.
- **Provider-backed features need credentials you supply.** A local ComfyUI server
  needs none; fal and Civitai do. Nothing about the manual path depends on any of
  them.
- **Interface work is ongoing.** Working-area hierarchy, Project Bible image
  presentation and the language inside deep configuration are known to be rougher
  than the workflows they sit around. They are recorded as later work, not as
  defects this alpha is withholding a fix for.
