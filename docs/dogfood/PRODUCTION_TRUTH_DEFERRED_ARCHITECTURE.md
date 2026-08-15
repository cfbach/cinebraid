# CineBraid — Production Truth: Deferred Architecture

**Status:** deliberate deferrals, not oversights.
**Applies to:** the alpha production-truth model (Canon / Reference / Historic).
**Date:** 2026-08-14

CineBraid's alpha is **one creator, one local project truth, explicit Canon
decisions**. The list below is everything a Professional or Enterprise tier
would plausibly need and that this alpha deliberately does **not** implement.
Each is recorded so a future maintainer can tell a gap from a decision.

---

## Not implemented, on purpose

| Deferred | Why the alpha does not need it | What would have to change |
|---|---|---|
| **Authenticated multi-user identity** | There is one creator, at one machine, with one project. A receipt answers "did the creator approve these bytes", and there is only one creator to be. | The receipt would gain a subject, and every reader would have to resolve it. |
| **Roles and permissions** | Nothing to partition: the one person may approve everything. | A policy layer between the named commands and the private commit. |
| **Approval delegation** | Nobody to delegate to. | Delegation chains in the receipt, and a validity rule for them. |
| **Cryptographically signed provenance** | The threat model is accident, not forgery. `event.isTrusted` makes machine-written Canon impossible by accident; a signature would defend against a hostile operator of the machine, who already owns the file. | Key management, key storage, and a story for what a broken signature means to a filmmaker mid-edit. |
| **Hostile-local-process security** | Explicitly out of scope. Any process that can rewrite `project.json` can write whatever it likes; guarding the in-page path against it would be theatre. | An out-of-process authority service. |
| **Distributed locks** | One writer. The media ledger already has a one-writer-per-project rule for the same reason. | A lock protocol and a recovery story for a stale lock. |
| **Simultaneous-editor conflict resolution** | No second editor. | Operational transform or CRDT over the project document, plus a merge rule for competing receipts. |
| **Enterprise policy engines** | The only policy is the four target kinds' own rules, and they are fixed in the kernel. A configurable engine is exactly the replaceable-rule shape three audits walked through. | A policy language, and a way to make it non-replaceable at runtime. |
| **Complex cross-version authority migration** | The ledger is version 1 and fails closed on anything else. A project written by a future build is not read, which is the honest answer. | A migration framework for receipts, with the same accounting discipline `ofp/` applies to project documents. |

---

## Two things that are NOT deferred, and must stay implemented

- **Fail-closed on an unreadable ledger.** A damaged ledger answers "no canon"
  for every target, not for none. Repairing it silently is the same class of
  mistake as inferring authority from a pointer.
- **No trust migration.** A pre-receipt project's `winner` / `approvedFile` /
  `humanApproved` values are preserved and interpreted as HISTORIC. Nothing
  fabricates a receipt for them. The creator converts one by approving it.

---

## The known limitation this alpha accepts

The gesture check is scoped to the event dispatch it belongs to, read through
the user agent's own `window.event` accessor captured at install time. Page
script that installs its own capture listener, keeps the trusted event object,
and shadows that accessor could present a stale dispatch to the kernel.

That is deliberate: it is forgery by a script running inside the product, which
is the hostile-local-process case above. What the model guarantees, and what
three audits were actually breaking, is that **automation and ordinary internal
application paths cannot synthesize human production authority by accident** —
no `await` continuation, no `.then()`, no timer, no run loop, and no reusable
token that outlives the click.
