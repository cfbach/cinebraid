# Prospective correction note — cross-store durability for coverage runs

Written **before** implementation, as the correction brief requires. It records the six
decisions and the crash reading at every durable seam, so the design can be judged
independently of the diff.

The defect this answers: the coverage-run record and the generation ledger are two files
with two persistence chains, and the code claimed they were written "in the same durable
turn". They are not. Adjacent writes are not atomic, and `try`/`catch` is not protection
against process death.

---

## 1. Chosen durable owner — the generation ledger

`generation-jobs.json`, through `readJobLedger` / `writeJobLedgerSync`. Nothing new is
introduced, because it already carries every fact this needs:

| Fact | Where it already lives |
|---|---|
| durable intent | `status: "SUBMITTING"`, committed **before** the provider call |
| provider handle | `externalId`, plus `statusUrl` / `responseUrl` |
| uncertainty | `UNRESOLVED`, and `blocksResubmission()`'s `SUBMITTING && !externalId` |
| request identity | `clientRequestId`, and `generationContextKey()` |
| **coverage identity** | `entityList`, `entityId`, `coverageJobType`, `coverageSheetType`, `createdAt` |

That last row is the decisive one. A coverage job row already says which entity it is for
and what kind of coverage work it is — which is why `ingestEntity()` can and does
reconstruct `entity.coverageAutomation` from a job row alone when the record is missing.

**The coverage record is therefore a PROJECTION, not a co-equal execution owner.**

## 2. Chosen commit point — unchanged; the ORDER at it changes

The dispatch-commit decision point stays exactly where the previous correction put it:
after every pre-submission refusal, before the provider. What changes is the sequence:

```
before:  coverage projection  ->  ledger row  ->  provider
after:   ledger row           ->  coverage projection  ->  provider
```

**The projection may never precede its source.** That single rule is what makes the
invariant hold at write time: persisted coverage cannot claim paid generation is live
without a durable job that justifies it, because the job is written first.

## 3. Crash semantics after each durable write

| Interruption point | Durable result | Reading |
|---|---|---|
| after validation, before any write | no job, no run, no provider call | nothing happened |
| **after the ledger row, before the projection** | job `SUBMITTING` with no handle; **no coverage record** | truthful and UNDER-claiming. `blocksResubmission()` already treats this row as uncertain and refuses a duplicate of the same context, so no second bill. The board shows no run because none is justified. |
| after the projection, before the provider call | job `SUBMITTING` + run live, one job id | consistent: the run names exactly the job that justifies it |
| provider accepted, acknowledgement write fails | job stays `SUBMITTING` without a handle | uncertain, and the run is terminalized to `needs-attention` on that path |
| acknowledgement persisted, projection write fails | job carries `externalId` | the job is the truth; the record is rebuilt from it |
| after everything | agreement | — |

The **only** direction this ordering can be wrong in is under-claiming, which is the safe
one: a job with no coverage record is visible in Activity and blocks its own duplicate.
The previous ordering could over-claim, which is the direction that lies.

## 4. Reconciliation mechanism

The projection is rebuilt from job rows — the mechanism `ingestEntity()` already performs,
lifted into one named server function so the two places that touch a coverage job can both
use it. No startup scan, no journal, no second store. A record that is missing after an
interruption is rebuilt the next time its job is ingested or refreshed; a record whose job
went uncertain is terminalized by the existing lifecycle owner.

## 5. Idempotency and dedupe assumptions

All pre-existing, none added:

- `clientRequestId` — a repeated request returns the existing job, `reused: true`.
- `generationContextKey()` + `blocksResubmission()` — a second request for the same
  production result is refused with `GENERATION_UNRESOLVED` while an earlier submission is
  in-flight-without-handle or unresolved. **This is what makes it safe to leave a
  SUBMITTING row behind after a crash:** recovery never resubmits, and a person has to look
  at the provider and reconcile before that context can be generated again.
- The entity-reference duplicate guard, on `(entityList, entityId, coverageJobType,
  coverageSheetType, targetCoverageSlotId)`.

Nothing here resubmits automatically, so no ordering below can produce a duplicate paid
call.

## 6. Why no new authority model is introduced

- No token, receipt, transaction id or journal.
- No new field is required for reconciliation — the identity is already on the job row.
- The projection is derived from **server-authored** rows; a browser cannot write a job row
  and cannot write the coverage record (the save seam preserves it wholesale).
- The paid boundary is untouched: one `dispatchGenerationRequest`, and the
  `reference-automation` surface still comes only from the server-selected operation
  descriptor.

---

## Residual, stated rather than hidden

If the acknowledgement write fails **and** the coverage terminalization write fails **and**
the process then dies, a coverage record can still read as live while its only job is
`SUBMITTING` without a handle. The ledger remains the truth, the duplicate guard still
refuses a second paid request for that context, and the record is repaired the next time
the job is refreshed or ingested. Fixing the last of that would need the two files to
commit together, which is the cross-store transaction this note deliberately does not
introduce.
