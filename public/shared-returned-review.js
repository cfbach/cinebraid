/* CineBraid — RETURNED REVIEW: the one deterministic answer to four questions that
 * were being answered in four places.
 *
 *     WHAT RETURNED MEDIA IS WAITING FOR A FILMMAKER'S DECISION?
 *     WHICH EXACT CANDIDATE OWNS THAT DECISION?
 *     WHAT IS THAT CANDIDATE A DECISION ABOUT — what it repairs, what it is up against?
 *     WHICH REVIEW ACTIONS ARE VALID ON IT?
 *
 * Shared by browser and Node the same way public/shared-shot-readiness.js and
 * public/shared-shot-intent.js are, and deliberately in their family: it is a
 * DERIVATION, not a store. It caches nothing, writes nothing, persists nothing, and
 * reaches no filesystem, network, clock or DOM.
 *
 * ---------------------------------------------------------------------------
 * THE PRODUCT INVARIANT THIS FILE EXISTS TO MAKE DERIVABLE.
 *
 *     WHEN A GENERATION RESULT COMES BACK AND NEEDS A PERSON,
 *     THE RETURNED MEDIA OWNS THE IMMEDIATE DECISION.
 *
 * Not the reference that is still unconfirmed, not the readiness guidance, not the
 * Create Frame promotion. The audit found the shot workspace answering "what needs me
 * here" from readiness alone, so a shot the project had just routed to with REVIEW
 * RETURNED RESULT opened saying `Confirm existing reference` — the returned candidate,
 * already paid for, was named nowhere.
 *
 * The fix is not a flag on that card. It is this projection, plus the rule that a
 * pending returned review outranks non-blocking readiness in the surface that owns the
 * shot. One derivation, three consumers.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT A SECOND AUTHORITY, AND IT IS NOT A STORE. THAT IS STRUCTURAL.
 *
 * Everything here is read off ONE input: the frozen answer of
 * public/shared-production-media.js's productionMediaRecords(). That module is already
 * the read-only projection over durable media — it is where disposition, identity,
 * lineage, human decision and per-kind action validity are decided, each by its own
 * owner. This file re-decides none of them:
 *
 *   what a file IS, and whether           P4 partitionShotMedia(), through
 *     it is approved / rejected           productionMediaRecords().disposition
 *   whether an approval is real           the authority kernel, through
 *                                         disposition.authority.receiptBacked
 *   whether a PERSON decided              humanDecision, which since 1D-04 answers from
 *                                         the receipt and never from a stray field
 *   what repaired what                    provenance.lineage — `correction-of` and
 *                                         `corrected-into`, stamped at ingest
 *   whether a decision can be taken        productionMediaRecords().actions, which
 *     on this kind at all                  already drops paid, destructive and
 *                                          undecidable candidates
 *   whether a shot can be produced         public/shared-shot-readiness.js. NOT read
 *                                          here, and not restated: "is something
 *                                          waiting for me to look at it" and "can this
 *                                          be produced now" are different questions,
 *                                          and merging them is what Slice 1 separated.
 *
 * A `returnedReviewProjection()` that received no media answer reports NOTHING waiting
 * rather than guessing from filenames or timestamps. An empty queue is visibly wrong
 * and gets fixed; an invented one sends a filmmaker to judge a file that is not there.
 *
 * ---------------------------------------------------------------------------
 * REVIEWED MEANS A PERSON DECIDED. AN AI REVIEW IS NOT A DECISION.
 *
 * `row.reviewedAt` is written by three different acts, and one of them is a machine:
 * public/review-provenance.js stamps it when a structured review is saved, when an
 * outcome is chosen — and when the vision assistant returns. So the settled predicate
 * here never reads a timestamp. A candidate has been decided when, and only when:
 *
 *     humanDecision.state is `approved`   a current receipt exists
 *     humanDecision.state is `rejected`   the row records the rejection
 *     humanDecision.decision is `shortlist`   KEEP AS ALTERNATE is a decision
 *
 * Anything else is undecided, including a candidate with a full AI triage attached.
 *
 * ---------------------------------------------------------------------------
 * A PICK SETTLES WHAT IT WAS CHOSEN AMONG, AND NOTHING THAT CAME AFTERWARDS.
 *
 * A frame whose pick has been made stops asking about the alternates that pick was taken
 * over — whoever made it and whether or not anybody approved it. That is Slice 1's
 * workflow-queue rule, carried through: it makes no claim about authority.
 *
 * WHAT IT IS NOT is frame-wide. A repair that came back AFTER the pick was never one of
 * the alternates, and settling it as though it had been is how a returned result nobody
 * had looked at could leave the queue empty and the project saying MARK SHOT FINAL. See
 * arrivedAfterPick(): lineage first, chronology second, filenames never.
 *
 * Motion settles at the SHOT, not per clip, and by the same candidate-specific rule. The
 * shot-level asymmetry is Slice 1's and is preserved deliberately: changing it would
 * change the Returned Results count on projects nobody edited.
 *
 * ---------------------------------------------------------------------------
 * ORDER COMES FROM PRODUCTION FACTS. THERE IS NO PRIORITY SCORE, AND NO FILENAME.
 *
 *   1. the project's own shot order
 *   2. within a shot: declared frame order, then motion
 *   3. within a unit: lineage groups, oldest root first — generation completion order
 *   4. within a lineage group: THE REPAIR LEADS
 *   5. for a true tie: the position the authoritative input already had
 *
 * (4) is not a heuristic: a repair is generated FROM a candidate, so the candidate it
 * repairs is the Before of a decision that has already moved on. It is read from
 * `correction-of`, which ingest stamps from the job's own sourceCandidate — never from
 * recency and never from a similar filename.
 *
 * (5) replaced an alphabetical tie-break, which was a real defect rather than a tidy-up:
 * a production that returned [Z.png, A.png] at the same instant was presented as
 * [A.png, Z.png], an order nothing in the project had stated.
 * tests/returned-media-ownership-negative-controls.js puts both rules back and requires
 * the suite to go red for each.
 *
 * ---------------------------------------------------------------------------
 * A RECORDED RESULT WITH NO BYTES IS AN INTEGRITY STATE, NOT AN ABSENCE.
 *
 * Everything above is derived from the media answer, which is derived from the scan — so
 * a candidate row the project still records as undecided, whose file has gone, would
 * produce no record and vanish. The shot would then read as having nothing outstanding
 * and CineBraid would offer to produce another frame: spending money because it had lost
 * track of something it already had. Those rows are reported, marked `blocking`, given
 * no actions, and kept out of `queue`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO.
 *
 * * NO WORDS. Every string a filmmaker reads is built by the surface, from the tokens
 *   here, for the same reason shared-stage-model.js leaves STAGE_STATUS in the UI layer.
 * * NO ROUTE. It returns a candidate key; where that key is opened is the router's
 *   business. There is no new router in this slice.
 * * NO ENTITY REFERENCES. Reference approval is a per-entity queue Slice 1 owns and the
 *   reference-demand model is out of scope, so this projection covers SHOT-OWNED
 *   returned media and says so. public/app.js composes the two.
 * * NO PAID ACTION. `revise` builds a correction prompt; dispatching it stays where it
 *   already is, behind the shipped confirmation.
 */

(function (root, factory) {
  const nodeModule = typeof module !== "undefined" && module.exports;
  const mediaOwner = nodeModule ? require("./shared-production-media.js") : root;
  /* P4's shot-media reader, the same one shared-production-media.js partitions with. It
     is asked ONLY for a candidate row whose file the scan no longer reports, where there
     is no media record to read a disposition off — see missingRowFact(). Loaded before
     shared-production-media.js in public/index.html and in the render harness, so it is
     on the global by the time this file evaluates. */
  const dispositionOwner = nodeModule ? require("./shared-media-disposition.js") : root;
  const api = factory({ media: mediaOwner, disposition: dispositionOwner });
  if (nodeModule) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function (OWNERS) {
  const MEDIA = OWNERS.media || {};
  const DISPOSITION = OWNERS.disposition || {};

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }
  const record = (value) => (value && typeof value === "object" ? value : {});
  const list = (value) => (Array.isArray(value) ? value : []);
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  /* productionMediaRecords() reports every scalar as a knowledge envelope. Reading one
     as a bare value everywhere else would mean forgetting the difference between
     "not recorded" and "", which is the distinction O3 introduced them for. */
  const valueOf = (envelope) => text(record(envelope).value);
  /* The same envelope, built locally, for the one path that has a durable fact and no
     production-media record to read it off. */
  const envelopeOf = (value) => deepFreeze({ state: text(value) ? "known" : "not-recorded", value: text(value) });

  const RETURNED_REVIEW_CONTRACT = "cinebraid.returned-review/1";

  /* The owners a returned candidate can belong to. There is no `entity-reference` here
     and there must not be one: see the header. */
  const RETURNED_REVIEW_OWNER_KINDS = deepFreeze(["shot-frame", "shot-motion"]);

  /* THE REVIEW VOCABULARY, and it is exactly three.
     approve  accept these bytes for the unit — the shipped approval, with its receipt
     revise   start a targeted repair FROM this exact candidate
     reject   dispose of this candidate; it stays in history */
  const RETURNED_REVIEW_ACTIONS = deepFreeze(["approve", "revise", "reject"]);

  /* THE DECISIONS THE PROJECTION MAY DECLARE VALID ON A CANDIDATE, and they are exactly
     the ones public/shared-production-media.js already declares. `revise` is NOT here:
     see RETURNED_REVIEW_ACTION_LIMITATIONS. */
  const RETURNED_REVIEW_DECISION_ACTIONS = deepFreeze(["approve", "reject"]);

  /* SHIPPED WORKFLOWS A SURFACE MAY OPEN FROM A CANDIDATE. Opening one is not taking a
     decision, and this list is not a second decision vocabulary. */
  const RETURNED_REVIEW_WORKFLOWS = deepFreeze(["revise"]);

  /* WHAT THIS PROJECTION CANNOT DECLARE, in the shape shared-production-media.js's
     PRODUCTION_MEDIA_UNAVAILABLE uses: the question, why not, and the record that would
     have to exist first. A gap that is declared cannot be quietly filled with a guess.

     THE INDEPENDENT REVIEW CAUGHT EXACTLY THAT HAPPENING HERE. This module used to read
     production-media's `view-review` — which declares that a surface may OPEN the review
     dialog — and emit `revise` as though it were a candidate DECISION the projection had
     narrowed from a declared one. It had not: no production-media action authorises
     starting a correction, and opening a workflow is not deciding anything. `revise` is
     now a WORKFLOW, gated on the same `view-review`, and it is never in `actions`. */
  const RETURNED_REVIEW_ACTION_LIMITATIONS = deepFreeze({
    revise: {
      question: "Is starting a targeted repair a decision this candidate declares?",
      why: "PRODUCTION_MEDIA_ACTIONS declares open-full-preview, open-owner, view-review, approve, reject and restore. None of them authorises building a correction, so a `revise` in `actions` would be a decision this projection invented.",
      wouldNeed: "a declared correction action on the production-media contract",
      surfacedAs: "a workflow, gated on the declared view-review action",
    },
    "revise-motion": {
      question: "Can a returned video be revised?",
      why: "A targeted repair is built FROM a recorded candidate review, and the recorded candidate review is a frame review — its categories, its numbered-reference diagnosis and its blocking-guide comparison are all statements about a still. There is nothing in the model that could describe what to repair about a clip.",
      wouldNeed: "a motion-shaped structured review the correction builder could read",
      surfacedAs: "a deterministic refusal from returnedReviewActionRefusal()",
    },
  });

  /* Why a returned candidate is not asking for a decision. Reported rather than
     silently dropped, so a surface can say which of these happened.

     `machine-selected` IS NOT `human-approved`, and the difference is the whole reason
     it is listed separately. An automation-written pick settles the unit — that is the
     shipped pick semantics and this module does not touch it — but calling it a human
     approval would assert a decision nobody took. */
  const RETURNED_REVIEW_SETTLED_REASONS = deepFreeze([
    "unit-already-picked",
    "human-approved",
    "machine-selected",
    "human-rejected",
    "kept-as-alternate",
  ]);

  /* Why a returned candidate cannot be reviewed even though a row exists for it.
     These FAIL CLOSED — the candidate is excluded from the queue and named here.

     `media-not-available` is a BLOCKER and the other two are not. A project that still
     says a result is undecided while its bytes have gone is in an integrity state; a
     candidate whose frame was deleted, or whose kind takes no decision, is simply not a
     review anybody owes. */
  const RETURNED_REVIEW_UNREVIEWABLE_REASONS = deepFreeze([
    "media-not-available",
    "frame-no-longer-declared",
    "decision-not-supported",
  ]);
  const RETURNED_REVIEW_BLOCKING_REASONS = deepFreeze(["media-not-available"]);

  /* ==========================================================================
     THE INPUT.

     A caller may hand in an already-derived media answer — the shot workspace and the
     Production summary render from one derivation rather than two — or the parts, in
     which case productionMediaRecords() is asked exactly once. */
  function mediaAnswerFor(input) {
    const supplied = record(input.media);
    if (Array.isArray(supplied.records)) return supplied;
    if (typeof MEDIA.productionMediaRecords !== "function") return null;
    return MEDIA.productionMediaRecords({
      project: input.project,
      scan: input.scan,
      jobs: input.jobs,
      jobsAvailable: input.jobsAvailable,
      entityMedia: input.entityMedia,
    });
  }

  /* HAS THIS EXACT CANDIDATE ALREADY BEEN DECIDED, and BY WHAT.
     All durable, none of them a timestamp, and each named for what actually happened. */
  function decidedReason(row) {
    const decision = record(row.humanDecision);
    const state = text(decision.state);
    if (state === "approved") return "human-approved";
    /* NOT `human-approved`. shared-production-media.js reports `machine-selected` when
       an approved edge's only recorded actor is automation, and it reports it separately
       precisely so nothing downstream can collapse the two. This is the downstream. */
    if (state === "machine-selected") return "machine-selected";
    if (state === "rejected") return "human-rejected";
    if (valueOf(decision.decision) === "shortlist") return "kept-as-alternate";
    return "";
  }

  /* WHEN THE UNIT'S PICK SETTLES A CANDIDATE, AND WHEN IT MUST NOT.
   *
   * THE P0 THE INDEPENDENT REVIEW FOUND. This was frame-wide: any pick on a unit settled
   * every undecided candidate in it. So a repair that came back AFTER the filmmaker had
   * picked its parent reported `unit-already-picked`, left the queue empty, and the
   * project said MARK SHOT FINAL — about a result nobody had looked at.
   *
   * Settlement is CANDIDATE-SPECIFIC. A pick settles the file that was picked, and it
   * settles the alternates it was chosen OVER — those are the ones the decision was
   * taken among. It settles nothing that arrived afterwards.
   *
   * "Arrived afterwards" is answered from durable facts, in this order, and never from a
   * filename:
   *
   *   1. LINEAGE. A candidate whose correction-of chain reaches the picked file was
   *      generated FROM it, so it cannot have been an alternate the pick chose over.
   *      This is structural and outranks any timestamp.
   *   2. CHRONOLOGY. The candidate is stamped later than the moment of the pick — the
   *      picked row's own recorded decision time, or its arrival when it records none.
   *
   * WHEN NEITHER CAN BE ESTABLISHED THE PICK STILL SETTLES, deliberately. Every candidate
   * ingest writes carries `addedAt`; a row with none is legacy, and treating legacy
   * alternates as newly returned would put every old project's discarded takes back in
   * front of its filmmaker. The new pending state appears only when the record positively
   * shows the candidate came later. */
  function candidateDescendsFrom(name, ancestor, byName) {
    const seen = new Set([name]);
    let current = name;
    for (;;) {
      const parent = correctionParentName(byName.get(current));
      if (!parent || seen.has(parent)) return false;
      if (parent === ancestor) return true;
      if (!byName.has(parent)) return false;
      seen.add(parent);
      current = parent;
    }
  }
  function arrivedAfterPick(row, pickRow, byName) {
    const name = text(record(row.file).name);
    const pickName = text(record(pickRow.file).name);
    if (!name || !pickName || name === pickName) return false;
    if (candidateDescendsFrom(name, pickName, byName)) return true;
    const pickAt = valueOf(record(pickRow.humanDecision).decidedAt) || valueOf(record(pickRow.file).addedAt);
    const rowAt = valueOf(record(row.file).addedAt);
    return !!pickAt && !!rowAt && rowAt > pickAt;
  }

  /* IS THIS CANDIDATE STILL UNSETTLED CURRENT WORK — THE ONE ANSWER, ASKED BY BOTH PATHS.
   *
   * THE P0 THE SECOND INDEPENDENT REVIEW FOUND. The media-present path asked the full
   * question — the candidate's own decision, then the unit's pick, candidate by
   * candidate. The synthetic path for a row whose bytes had gone asked two string checks
   * instead (`rejected` and `shortlist`), so a candidate the project had ALREADY settled
   * — one that was picked, or that a later approval superseded — was resurrected as a
   * current integrity blocker the moment its historical file was cleaned up. Missing
   * bytes are not a decision, and they must not undo one.
   *
   * So the decision lives here, once, and the two paths differ only in where the FACTS
   * come from: production-media's record when the file is present, the durable candidate
   * row and the shipped disposition owner when it is not. Returns the settled reason, or
   * "" for genuinely unsettled current work. */
  function candidateSettlement(fact, pickRow, byName) {
    const decided = decidedReason(fact);
    if (decided) return decided;
    if (!pickRow) return "";
    return arrivedAfterPick(fact, pickRow, byName) ? "" : "unit-already-picked";
  }

  /* THE SAME FACTS, FOR A ROW WHOSE FILE IS NOT THERE.
   *
   * Shaped exactly like a production-media record so candidateSettlement() cannot tell
   * the two apart, and assembled only from things that are durable without the bytes:
   * the candidate row itself, and P4's shotMediaDisposition() — the same reader
   * production-media partitions with, asked here rather than restated.
   *
   * WHAT IT DELIBERATELY DOES NOT SYNTHESISE is the difference between a human approval,
   * a machine selection and an unreceipted pointer. That distinction is
   * humanDecisionOf()'s, it needs the media record, and guessing at it is what the
   * `machine-selected` repair existed to stop. When an edge names this file the fact says
   * so by standing in as its OWN pick, which settles it as `unit-already-picked` — true
   * whoever wrote the edge, and a claim about nobody. */
  function missingRowFact(shot, row, name) {
    const claimed = DISPOSITION && typeof DISPOSITION.shotMediaDisposition === "function"
      ? record(DISPOSITION.shotMediaDisposition(shot, name))
      : {};
    const role = text(claimed.role);
    return deepFreeze({
      file: deepFreeze({ name, addedAt: envelopeOf(row.addedAt) }),
      humanDecision: deepFreeze({
        state: role === "rejected" ? "rejected" : "undecided",
        decision: envelopeOf(row.decision),
        decidedAt: envelopeOf(text(row.decidedAt) || text(row.approvedAt)),
      }),
      provenance: deepFreeze({ lineage: deepFreeze(text(row.correctionOf) ? [deepFreeze({ relation: "correction-of", value: text(row.correctionOf) })] : []) }),
      /* An approval edge names this file, so the unit's pick IS this file. */
      pickedByEdge: role === "approved",
    });
  }

  /* WHICH FRAME A RETURNED STILL BELONGS TO.

     The stamped `frameId` when there is one; the FIRST declared frame when there is
     not, because a candidate that predates per-frame stamping belongs to the frame the
     shot opened with. This is public/creation-studio.js guidedFrameCandidateRows()'s
     display rule, and tests/returned-media-ownership.js requires the two to agree on
     the same shot rather than trusting that they do.

     A stamped id naming a frame this shot no longer declares belongs to NO frame. It is
     reported as unreviewable rather than re-homed onto frame one: re-homing would put a
     candidate generated for a deleted composition in front of a filmmaker as though it
     had been made for the one that is left. */
  function frameOwnerFor(row, frames) {
    const stamped = valueOf(record(row.context).frameId);
    if (!stamped) return frames[0] || null;
    return frames.find((frame) => text(record(frame).id) === stamped) || null;
  }

  /* THE UNIT'S PICK, in Slice 1's words: has this frame already been picked. An
     approval EDGE pointing at a file is the pick, whoever wrote it — this asks the
     workflow question, and the authority question is answered elsewhere and separately
     by disposition.authority. */
  function framePickedName(rows, frameId) {
    for (const row of rows) {
      for (const target of list(record(row.disposition).targets))
        if (text(target.kind) === "frame" && text(target.id) === frameId) return text(record(row.file).name);
    }
    return "";
  }

  /* The record a `shot` edge points at — the shot's approved image. Not a settle
     condition (Slice 1 settles a frame on its own edge only) and used only as the
     comparison a filmmaker judges the returned candidate against. */
  function shotPickedName(rows) {
    for (const row of rows) {
      for (const target of list(record(row.disposition).targets))
        if (text(target.kind) === "shot") return text(record(row.file).name);
    }
    return "";
  }

  /* MOTION SETTLES AT THE SHOT. Slice 1's three pointers, read in one place and read
     from the shot record because that is where they live. Nothing is decided here: the
     question is still "has a video already been chosen for this shot". */
  function approvedMotionName(shot) {
    const brief = record(record(shot).creationBrief);
    const direct = text(brief.approvedMotionFile) || text(brief.finalVideoFile);
    if (direct) return direct;
    for (const clip of list(record(shot).clips)) {
      const winner = text(record(clip).videoWinner);
      if (winner) return winner;
    }
    return "";
  }

  /* The lineage a repair records about itself, and only that. `correction-of` is
     stamped at ingest from the generation job's own sourceCandidate. */
  function correctionParentName(row) {
    for (const entry of list(record(row.provenance).lineage))
      if (text(entry.relation) === "correction-of") return text(entry.value);
    return "";
  }

  function correctionChildNames(row) {
    const names = [];
    for (const entry of list(record(row.provenance).lineage))
      if (text(entry.relation) === "corrected-into") {
        const value = text(entry.value);
        if (value) names.push(value);
      }
    return names;
  }

  /* The compact reference a surface needs to SHOW another candidate: enough to render
     it and to open it, never a second copy of its record. */
  function mediaRef(row) {
    if (!row) return null;
    const file = record(row.file);
    return deepFreeze({
      key: text(row.key),
      name: text(file.name),
      url: text(file.url),
      mediaType: text(file.mediaType),
      addedAt: valueOf(file.addedAt),
      /* The LEDGER identity, carried separately from the projection key so a surface can
         hand this media to the Inspector identity-first, the way every other media
         handoff in the product already does. Empty is legal and means the file predates
         the ledger; the Inspector then resolves it by path. */
      assetId: text(record(row.identity).ledger),
      disposition: text(record(row.disposition).role),
      receiptBacked: record(record(row.disposition).authority).receiptBacked === true,
    });
  }

  /* WHICH OF THE THREE REVIEW ACTIONS ARE VALID HERE.

     `approve` and `reject` are taken from the record's OWN action list, so the kinds
     public/shared-production-media.js already refuses to offer a decision on are
     refused here too, by the same rule and without restating it.

     `revise` is the one action this module adds, and it is narrower than the other two
     for a product reason rather than a UI one: a targeted repair is built FROM a
     recorded candidate review, and the recorded candidate review is a frame review —
     its categories, its numbered-reference diagnosis and its blocking-guide comparison
     are all statements about a still. A returned VIDEO can be approved and it can be
     rejected; there is nothing in the model that could describe what to repair about it.
     Saying that here rather than letting the surface quietly omit the button is the
     difference between a declared gap and a missing control. */
  function reviewActionsFor(row) {
    const actions = list(row.actions).map((id) => text(id));
    return deepFreeze(RETURNED_REVIEW_DECISION_ACTIONS.filter((id) => actions.includes(id)));
  }
  /* WHICH SHIPPED WORKFLOWS THIS CANDIDATE CAN OPEN. `revise` is gated on the declared
     `view-review` action — which is what authorises opening the review dialog — and on
     the owner kind, because the correction builder reads a frame review. It is reported
     here rather than in `actions` so nothing can read it as a decision. */
  function reviewWorkflowsFor(row, ownerKind) {
    const actions = list(row.actions).map((id) => text(id));
    if (!actions.includes("view-review")) return deepFreeze([]);
    if (ownerKind !== "shot-frame") return deepFreeze([]);
    return deepFreeze(["revise"]);
  }

  /* ==========================================================================
     ONE UNIT'S RETURNED MEDIA.

     `rows` are already narrowed to this unit. Everything below is ordering and
     context; nothing here reclassifies a candidate. */
  function unitItems(context) {
    const { rows, pickRow, owner, shot, comparison, describeCorrection, ordinalOf } = context;

    const byName = new Map();
    for (const row of rows) byName.set(text(record(row.file).name), row);

    /* Ordering, in the header's four steps. A lineage group is keyed by the oldest
       ancestor PRESENT IN THIS UNIT, and `depth` is how many repairs deep this
       candidate sits below it. */
    const lineageCache = new Map();
    function lineageOf(name) {
      if (lineageCache.has(name)) return lineageCache.get(name);
      /* `seen` is not defensive dressing: a hand-edited project can name a parent that
         names it back, and an unguarded walk would hang a render. */
      const seen = new Set([name]);
      let root = name;
      let depth = 0;
      for (;;) {
        const parent = correctionParentName(byName.get(root));
        if (!parent || !byName.has(parent) || seen.has(parent)) break;
        seen.add(parent);
        root = parent;
        depth += 1;
      }
      const answer = {
        root,
        addedAt: valueOf(record(byName.get(root).file).addedAt),
        /* THE STABLE SOURCE ORDINAL, and it exists because the alternative was a
           filename. Two candidates stamped at the same instant used to be ordered
           alphabetically, so a production that returned [Z.png, A.png] was presented as
           [A.png, Z.png] — an order nothing in the project stated. This is the position
           the authoritative input already had. */
        ordinal: ordinalOf(root),
        depth,
      };
      lineageCache.set(name, answer);
      return answer;
    }

    const decorated = rows.map((row, index) => ({ row, index, group: lineageOf(text(record(row.file).name)) }));
    decorated.sort((a, b) => {
      if (a.group.root !== b.group.root) {
        if (a.group.addedAt !== b.group.addedAt) return a.group.addedAt < b.group.addedAt ? -1 : 1;
        /* Chronology tied. The source order decides — never the name. */
        return a.group.ordinal - b.group.ordinal;
      }
      /* THE REPAIR LEADS. Deeper in the correction chain is the newer decision. */
      if (a.group.depth !== b.group.depth) return b.group.depth - a.group.depth;
      return a.index - b.index;
    });

    const items = [];
    /* The unit's own pick and lineage lookup, handed back so the missing-media path can
       ask candidateSettlement() with exactly the inputs this unit used. */
    if (context.units) context.units.push({ owner, pickRow, byName });
    for (const { row } of decorated) {
      const file = record(row.file);
      const name = text(file.name);
      const parentName = correctionParentName(row);
      const parentRow = parentName ? byName.get(parentName) || null : null;
      const actions = reviewActionsFor(row);
      const workflows = reviewWorkflowsFor(row, owner.kind);
      /* THE CANDIDATE'S OWN DECISION IS THE MORE SPECIFIC FACT and is reported first: a
         file somebody approved says `human-approved`, not `unit-already-picked`, even
         though both are true of it. The unit's pick is the reason the alternates it was
         chosen OVER stopped asking — and only those. The decision itself is
         candidateSettlement(), which the missing-media path below asks in the same words. */
      const settled = candidateSettlement(row, pickRow, byName);
      /* SETTLED IS NOT UNREVIEWABLE, AND THE ORDER OF THESE TWO IS THE REASON.
       *
       * `unreviewable` says: this candidate STILL OWES A DISPOSITION and cannot be given
       * one. A candidate that has been approved or rejected owes nothing — it is
       * finished, and `settled` already says so with the specific reason.
       *
       * These were derived the other way round, which made the two contradict each other
       * the moment production-media stopped offering `reject` on an approved row: with no
       * declared decision left, an approved, receipt-backed candidate reported
       * `decision-not-supported` and was counted in `counts.unreviewable` — "cannot be
       * reviewed" said about a file somebody had already reviewed. Deriving settlement
       * first and gating on it costs nothing and cannot drift: there is no state in which
       * a finished candidate needs a reason it cannot be actioned.
       *
       * `decision-not-supported` keeps its job for the UNSETTLED candidate no valid
       * decision exists for, and `media-not-available` for the unsettled row whose bytes
       * are gone. A settled row whose bytes are gone is ordinary history, which is the
       * same answer the missing-media pass below reaches by skipping settled rows. */
      const unreviewable = settled
        ? ""
        : !text(file.url)
          ? "media-not-available"
          : !actions.length
            ? "decision-not-supported"
            : "";
      items.push(deepFreeze({
        contract: RETURNED_REVIEW_CONTRACT,
        /* The candidate's durable projection key. It is the deep-link identity and it
           is production-media's, not a new one. */
        key: text(row.key),
        shotId: text(record(shot).id),
        sceneId: text(record(shot).scene),
        shotTitle: text(record(shot).title),
        owner: deepFreeze({ ...owner }),
        candidate: mediaRef(row),
        /* AWAITING A PERSON, or the reason it is not. */
        awaitingReview: !settled && !unreviewable,
        settled: settled || "",
        unreviewable,
        /* Reported separately from `unreviewable` so the two facts never have to be
           inferred from one token: a frame can be undeclared while its media is present,
           and media can be gone while the frame is still declared. */
        mediaAvailable: !!text(file.url),
        blocking: RETURNED_REVIEW_BLOCKING_REASONS.includes(unreviewable),
        humanDecision: text(record(row.humanDecision).state) || "undecided",
        /* WHAT THIS IS A REPAIR OF. `recorded` is the name ingest stamped; `available`
           is whether that file is still here to compare against. A recorded parent that
           has gone is REPORTED, never dropped and never re-derived from a sibling. */
        repairOf: parentName
          ? deepFreeze({
            state: parentRow ? "available" : "recorded-not-available",
            name: parentName,
            candidate: mediaRef(parentRow),
          })
          : null,
        repairedInto: deepFreeze(correctionChildNames(row).map((child) => deepFreeze({
          name: child,
          state: byName.has(child) ? "available" : "recorded-not-available",
          key: byName.has(child) ? text(byName.get(child).key) : "",
        }))),
        /* The correction's own build, where the generation recorded one, plus whatever
           the caller's resolver can say about its intent. No resolver means
           `not-recorded` — this module never opens the prompt library itself. */
        correction: deepFreeze(parentName
          ? {
            state: "recorded",
            buildId: valueOf(record(row.provenance).sourceBuildId),
            intent: typeof describeCorrection === "function"
              ? text(describeCorrection(valueOf(record(row.provenance).sourceBuildId), name))
              : "",
          }
          : { state: "not-a-repair", buildId: "", intent: "" }),
        /* WHAT IS CURRENTLY IN PLACE for this unit, so a decision is taken against
           something rather than in the abstract. Null when nothing is. */
        comparison: comparison || null,
        actions,
        workflows,
      }));
    }
    return items;
  }

  /* ==========================================================================
     THE ENTRY POINT. */
  function returnedReviewProjection(options = {}) {
    const input = record(options);
    const project = record(input.project);
    const media = mediaAnswerFor(input);
    if (!media) {
      /* FAIL CLOSED. No media answer means no claim about what is waiting. */
      return deepFreeze({
        contract: RETURNED_REVIEW_CONTRACT,
        available: false,
        reason: "production-media-unavailable",
        items: deepFreeze([]),
        queue: deepFreeze([]),
        blockers: deepFreeze([]),
        counts: deepFreeze({ items: 0, awaiting: 0, shots: 0, repairs: 0, unreviewable: 0, unavailable: 0 }),
      });
    }

    /* THE AUTHORITATIVE INPUT ORDER, captured once. Every ordering tie in this module
       resolves to a position in this list rather than to a filename. */
    const ordinals = new Map();
    const shotRows = new Map();
    for (const row of list(media.records)) {
      if (text(row.scope) !== "shot") continue;
      const kind = text(row.kind);
      if (kind !== "shot-still" && kind !== "shot-motion") continue;
      const shotId = valueOf(record(row.context).shotId);
      if (!shotId) continue;
      if (!shotRows.has(shotId)) shotRows.set(shotId, []);
      const bucket = shotRows.get(shotId);
      /* THE SEPARATOR IS THE ESCAPE, NEVER THE RAW BYTE. A composite key needs a
         separator that cannot occur in a shot id or a filename, and shared-authority-kernel.js
         already uses `\u0000` for exactly that. Written as a literal NUL, the byte makes git
         classify this file as binary, `* text=auto` skips normalisation, CRLF is committed
         verbatim and every added line becomes a trailing-whitespace violation. Same key, same
         semantics, and the file stays text. */
      ordinals.set(`${shotId}\u0000${text(record(row.file).name)}`, ordinals.size);
      bucket.push(row);
    }

    const items = [];
    for (const shot of list(project.shots)) {
      const shotId = text(record(shot).id);
      const rows = shotRows.get(shotId) || [];
      const frames = list(record(shot).keyframes);
      /* Each unit reports the pick and the lineage lookup it settled with, so the
         missing-media pass below decides with the same inputs rather than its own. */
      const units = [];
      const stills = rows.filter((row) => text(row.kind) === "shot-still");
      const videos = rows.filter((row) => text(row.kind) === "shot-motion");
      const shotPick = shotPickedName(stills);
      const ordinalOf = (name) => {
        const found = ordinals.get(`${shotId}\u0000${name}`);
        return found === undefined ? Number.MAX_SAFE_INTEGER : found;
      };

      /* Frames, in declared order. */
      for (const frame of frames) {
        const frameId = text(record(frame).id);
        const unitRows = stills.filter((row) => {
          const owner = frameOwnerFor(row, frames);
          return owner ? text(record(owner).id) === frameId : false;
        });
        if (!unitRows.length) continue;
        const pickedName = framePickedName(unitRows, frameId);
        const pickRow = pickedName ? unitRows.find((row) => text(record(row.file).name) === pickedName) || null : null;
        const comparisonName = pickedName || (frames[0] === frame ? shotPick : "");
        const comparisonRow = comparisonName
          ? unitRows.find((row) => text(record(row.file).name) === comparisonName)
            || stills.find((row) => text(record(row.file).name) === comparisonName)
          : null;
        items.push(...unitItems({
          rows: unitRows,
          pickRow,
          shot,
          owner: {
            kind: "shot-frame",
            unitId: frameId,
            frameId,
            frameLabel: text(record(frame).label),
            picked: pickedName,
          },
          comparison: mediaRef(comparisonRow),
          describeCorrection: input.describeCorrection,
          ordinalOf,
          units,
        }));
      }

      /* Stills whose stamped frame this shot no longer declares. They are named rather
         than silently dropped — a queue that quietly loses media is the failure this
         projection exists to prevent — and they never claim a review. */
      for (const row of stills) {
        if (frameOwnerFor(row, frames)) continue;
        items.push(deepFreeze({
          contract: RETURNED_REVIEW_CONTRACT,
          key: text(row.key),
          shotId,
          sceneId: text(record(shot).scene),
          shotTitle: text(record(shot).title),
          owner: deepFreeze({
            kind: "shot-frame",
            unitId: valueOf(record(row.context).frameId),
            frameId: valueOf(record(row.context).frameId),
            frameLabel: "",
            picked: "",
          }),
          candidate: mediaRef(row),
          awaitingReview: false,
          settled: "",
          unreviewable: "frame-no-longer-declared",
          mediaAvailable: !!text(record(row.file).url),
          blocking: false,
          humanDecision: text(record(row.humanDecision).state) || "undecided",
          repairOf: null,
          repairedInto: deepFreeze([]),
          correction: deepFreeze({ state: "not-a-repair", buildId: "", intent: "" }),
          comparison: null,
          actions: deepFreeze([]),
          workflows: deepFreeze([]),
        }));
      }

      /* Motion, at the shot, exactly as Slice 1 counts it. */
      if (videos.length) {
        const approved = approvedMotionName(shot);
        const pickRow = approved
          ? videos.find((row) => text(record(row.file).name) === approved) || null
          : null;
        items.push(...unitItems({
          rows: videos,
          /* THE SAME CANDIDATE-SPECIFIC RULE. An approved motion settles the videos it
             was chosen among; a video that came back afterwards is still a returned
             review, exactly as it is for a frame. When the shot names an approved video
             the projection cannot see — the pointer resolves to no returned file — there
             is no row to compare against, so the pick settles nothing and every returned
             video is judged on its own record. */
          pickRow,
          shot,
          owner: {
            kind: "shot-motion",
            unitId: "",
            frameId: "",
            frameLabel: "",
            picked: approved,
          },
          comparison: mediaRef(pickRow),
          describeCorrection: input.describeCorrection,
          ordinalOf,
          units,
        }));
      }

      /* ======================================================================
         DURABLE ROWS WHOSE MEDIA IS NOT THERE.

         THE P0 THE INDEPENDENT REVIEW FOUND. Everything above is built from the media
         answer, which is built from the scan — so a candidate row the project still
         records as undecided, whose file has gone, produced no record and vanished from
         this projection entirely. The shot then looked like it had nothing outstanding
         and PRODUCE THE FRAME became the primary action: CineBraid offering to spend
         money because it had lost track of something it already had.

         An undecided row with no bytes is an INTEGRITY condition, not a review and not
         permission to generate. It is reported, it is non-actionable, and it blocks.

         A row somebody already disposed of is NOT a blocker — its media being gone is
         ordinary history — and a row whose frame the shot no longer declares reports
         that instead, because the missing unit is the more specific fact. */
      const present = new Set(rows.map((row) => text(record(row.file).name)));
      for (const candidateRow of list(record(shot).candidateFiles)) {
        const row = record(candidateRow);
        const name = text(row.stored) || text(row.name);
        if (!name || present.has(name)) continue;
        const stamped = text(row.frameId);
        const frame = stamped ? frames.find((item) => text(record(item).id) === stamped) || null : frames[0] || null;
        const kind = MEDIA.productionMediaTypeOf ? MEDIA.productionMediaTypeOf(name) : "image";
        const motion = kind === "video";
        const undeclared = !motion && !frame;
        /* THE SAME SETTLEMENT DECISION THE MEDIA-PRESENT PATH MAKES, with the same
           inputs: this row's unit, the pick that unit settled with, and that unit's
           lineage lookup — plus this row itself, so a repair whose own bytes are gone can
           still be recognised as descending from the pick. A candidate the project has
           already settled is history, and history is what the media answer omits when the
           bytes are gone; synthesising a row for it would resurrect a decision as work. */
        const fact = missingRowFact(shot, row, name);
        const unit = units.find((entry) => (motion
          ? entry.owner.kind === "shot-motion"
          : entry.owner.kind === "shot-frame" && entry.owner.unitId === text(record(frame).id))) || null;
        const lineage = new Map(unit ? unit.byName : []);
        lineage.set(name, fact);
        if (candidateSettlement(fact, fact.pickedByEdge ? fact : (unit && unit.pickRow), lineage)) continue;
        items.push(deepFreeze({
          contract: RETURNED_REVIEW_CONTRACT,
          /* The path key production-media would have minted for this file, so a stale
             route naming it resolves to THIS item rather than to nothing. */
          key: typeof MEDIA.productionMediaKeyForFile === "function"
            ? MEDIA.productionMediaKeyForFile({ url: `/assets/shots/${shotId}/takes/${name}` })
            : "",
          shotId,
          sceneId: text(record(shot).scene),
          shotTitle: text(record(shot).title),
          owner: deepFreeze({
            kind: motion ? "shot-motion" : "shot-frame",
            unitId: motion ? "" : text(record(frame).id),
            frameId: motion ? "" : text(record(frame).id),
            frameLabel: motion ? "" : text(record(frame).label),
            picked: "",
          }),
          candidate: deepFreeze({
            key: "", name, url: "", mediaType: kind, addedAt: text(row.addedAt),
            assetId: "", disposition: "candidate", receiptBacked: false,
          }),
          awaitingReview: false,
          settled: "",
          unreviewable: undeclared ? "frame-no-longer-declared" : "media-not-available",
          mediaAvailable: false,
          blocking: !undeclared,
          humanDecision: "undecided",
          repairOf: text(row.correctionOf)
            ? deepFreeze({ state: present.has(text(row.correctionOf)) ? "available" : "recorded-not-available", name: text(row.correctionOf), candidate: null })
            : null,
          repairedInto: deepFreeze([]),
          correction: deepFreeze({ state: text(row.correctionOf) ? "recorded" : "not-a-repair", buildId: text(row.correctionBuildId) || text(row.sourceBuildId), intent: "" }),
          comparison: null,
          actions: deepFreeze([]),
          workflows: deepFreeze([]),
        }));
      }
    }

    const queue = items.filter((item) => item.awaitingReview);
    const shots = new Set(queue.map((item) => item.shotId));
    return deepFreeze({
      contract: RETURNED_REVIEW_CONTRACT,
      available: true,
      reason: "",
      items: deepFreeze(items),
      /* THE QUEUE IS THE COUNT. There is no second list and no number derived beside
         it: a surface that shows "N waiting" and a surface that opens the next one read
         the same array, so they cannot disagree about what N was. */
      queue: deepFreeze(queue),
      /* RETURNED MEDIA THE PROJECT STILL OWES A DECISION ON AND CANNOT SHOW. Its own
         list, because it is not a review: nothing can be approved, rejected or revised
         here, and a surface that folded it into `queue` would offer actions with nowhere
         to write. What it MUST do is stop the shot reading as ready for more. */
      blockers: deepFreeze(items.filter((item) => item.blocking)),
      counts: deepFreeze({
        items: items.length,
        awaiting: queue.length,
        shots: shots.size,
        repairs: queue.filter((item) => !!item.repairOf).length,
        unreviewable: items.filter((item) => !!item.unreviewable).length,
        unavailable: items.filter((item) => item.blocking).length,
      }),
    });
  }

  /* THE RUNTIME REFUSAL, and it is deterministic rather than a silent no-op.
   *
   * A caller asks for an action by name and gets back whether it may run and, when it
   * may not, the sentence to show. Motion is the case the review named: `revise` is not
   * available for a returned video, and a control that quietly did nothing would leave a
   * filmmaker pressing a button and concluding the product was broken.
   *
   * It refuses on the item's OWN declared lists, so a surface cannot reach a decision
   * this projection did not declare by calling it directly. */
  /* THE REFUSAL REASONS ARE TOKENS, and the sentences are the surface's, for the same
     reason shared-stage-model.js leaves STAGE_STATUS in the UI layer. A projection that
     wrote the words would be a projection a translation had to edit. */
  const RETURNED_REVIEW_REFUSAL_REASONS = deepFreeze([
    "unknown-action",
    "no-item",
    "revise-motion",
    "not-available",
  ]);
  function refusal(reason) {
    return deepFreeze({ allowed: false, reason });
  }
  function returnedReviewActionRefusal(item, action) {
    const id = text(action);
    const row = record(item);
    if (!RETURNED_REVIEW_ACTIONS.includes(id)) return refusal("unknown-action");
    if (!row.contract) return refusal("no-item");
    if (id === "revise" && text(record(row.owner).kind) === "shot-motion") return refusal("revise-motion");
    const permitted = id === "revise" ? list(row.workflows) : list(row.actions);
    if (!permitted.includes(id)) return refusal("not-available");
    return deepFreeze({ allowed: true, reason: "" });
  }

  /* The next returned review, project-wide or for one shot. `null` when there is none,
     which is the answer a surface must render as "nothing is waiting" rather than as a
     shot with an empty card. */
  function pendingReturnedReview(projection, shotId = "") {
    const wanted = text(shotId);
    for (const item of list(record(projection).queue))
      if (!wanted || item.shotId === wanted) return item;
    return null;
  }

  /* One candidate's review context by its durable key, whether or not it is still
     waiting — a surface that has a key from a route needs to know "reviewed already"
     as distinctly as "never existed". */
  function candidateReviewContext(projection, key) {
    const wanted = text(key);
    if (!wanted) return null;
    return list(record(projection).items).find((item) => item.key === wanted) || null;
  }

  return {
    RETURNED_REVIEW_CONTRACT,
    RETURNED_REVIEW_OWNER_KINDS,
    RETURNED_REVIEW_ACTIONS,
    RETURNED_REVIEW_DECISION_ACTIONS,
    RETURNED_REVIEW_WORKFLOWS,
    RETURNED_REVIEW_ACTION_LIMITATIONS,
    RETURNED_REVIEW_REFUSAL_REASONS,
    RETURNED_REVIEW_SETTLED_REASONS,
    RETURNED_REVIEW_UNREVIEWABLE_REASONS,
    RETURNED_REVIEW_BLOCKING_REASONS,
    returnedReviewProjection,
    returnedReviewActionRefusal,
    pendingReturnedReview,
    candidateReviewContext,
  };
});
