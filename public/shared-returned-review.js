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
 * THE UNIT SETTLES, AND SLICE 1'S RULE FOR THAT IS CARRIED THROUGH UNCHANGED.
 *
 * A frame whose pick has been made stops asking about its candidates, whoever made the
 * pick and whether or not anybody approved it — that was already the shipped rule in
 * returnedResultsAwaitingReview(), stated there as "has this frame already been
 * picked", and it is a WORKFLOW QUEUE question rather than an authority one. It is
 * restated here, once, and public/app.js now reads it from here rather than keeping a
 * second copy.
 *
 * Motion settles at the SHOT, not per clip, for the same reason and from the same three
 * shipped pointers. That asymmetry is Slice 1's and is preserved deliberately: changing
 * it would change the Returned Results count on projects nobody edited.
 *
 * ---------------------------------------------------------------------------
 * ORDER COMES FROM PRODUCTION FACTS. THERE IS NO PRIORITY SCORE.
 *
 *   1. the project's own shot order
 *   2. within a shot: declared frame order, then motion
 *   3. within a unit: lineage groups, oldest root first — generation completion order
 *   4. within a lineage group: THE REPAIR LEADS
 *
 * (4) is the only ordering rule that is not simply "as recorded", and it is not a
 * heuristic: a repair is generated FROM a candidate, so the candidate it repairs is the
 * Before of a decision that has already moved on. It is read from `correction-of`,
 * which ingest stamps from the job's own sourceCandidate — never from recency and never
 * from a similar filename. tests/returned-media-ownership-negative-controls.js
 * constructs a newest-file-wins parent and requires the suite to go red for it.
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
  const api = factory({ media: mediaOwner });
  if (nodeModule) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function (OWNERS) {
  const MEDIA = OWNERS.media || {};

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

  const RETURNED_REVIEW_CONTRACT = "cinebraid.returned-review/1";

  /* The owners a returned candidate can belong to. There is no `entity-reference` here
     and there must not be one: see the header. */
  const RETURNED_REVIEW_OWNER_KINDS = deepFreeze(["shot-frame", "shot-motion"]);

  /* THE REVIEW VOCABULARY, and it is exactly three.
     approve  accept these bytes for the unit — the shipped approval, with its receipt
     revise   start a targeted repair FROM this exact candidate
     reject   dispose of this candidate; it stays in history */
  const RETURNED_REVIEW_ACTIONS = deepFreeze(["approve", "revise", "reject"]);

  /* Why a returned candidate is not asking for a decision. Reported rather than
     silently dropped, so a surface can say which of these happened. */
  const RETURNED_REVIEW_SETTLED_REASONS = deepFreeze([
    "unit-already-picked",
    "human-approved",
    "human-rejected",
    "kept-as-alternate",
  ]);

  /* Why a returned candidate cannot be reviewed even though a row exists for it.
     These FAIL CLOSED — the candidate is excluded from the queue and named here. */
  const RETURNED_REVIEW_UNREVIEWABLE_REASONS = deepFreeze([
    "media-not-available",
    "frame-no-longer-declared",
    "decision-not-supported",
  ]);

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

  /* HAS THE FILMMAKER ALREADY DECIDED ABOUT THIS EXACT CANDIDATE.
     Three states, all durable, none of them a timestamp. */
  function decidedReason(row) {
    const decision = record(row.humanDecision);
    const state = text(decision.state);
    if (state === "approved" || state === "machine-selected") return "human-approved";
    if (state === "rejected") return "human-rejected";
    if (valueOf(decision.decision) === "shortlist") return "kept-as-alternate";
    return "";
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
  function reviewActionsFor(row, ownerKind) {
    const actions = list(row.actions).map((id) => text(id));
    const decidable = actions.includes("view-review");
    const out = [];
    if (actions.includes("approve")) out.push("approve");
    if (decidable && ownerKind === "shot-frame") out.push("revise");
    if (actions.includes("reject")) out.push("reject");
    return deepFreeze(out);
  }

  /* ==========================================================================
     ONE UNIT'S RETURNED MEDIA.

     `rows` are already narrowed to this unit. Everything below is ordering and
     context; nothing here reclassifies a candidate. */
  function unitItems(context) {
    const { rows, unitSettled, settleReason, owner, shot, comparison, describeCorrection } = context;

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
      const answer = { root, addedAt: valueOf(record(byName.get(root).file).addedAt), depth };
      lineageCache.set(name, answer);
      return answer;
    }

    const decorated = rows.map((row, index) => ({ row, index, group: lineageOf(text(record(row.file).name)) }));
    decorated.sort((a, b) => {
      if (a.group.root !== b.group.root) {
        if (a.group.addedAt !== b.group.addedAt) return a.group.addedAt < b.group.addedAt ? -1 : 1;
        return a.group.root < b.group.root ? -1 : 1;
      }
      /* THE REPAIR LEADS. Deeper in the correction chain is the newer decision. */
      if (a.group.depth !== b.group.depth) return b.group.depth - a.group.depth;
      return a.index - b.index;
    });

    const items = [];
    for (const { row } of decorated) {
      const file = record(row.file);
      const name = text(file.name);
      const parentName = correctionParentName(row);
      const parentRow = parentName ? byName.get(parentName) || null : null;
      const decided = decidedReason(row);
      const actions = reviewActionsFor(row, owner.kind);
      const unreviewable = !text(file.url)
        ? "media-not-available"
        : !actions.length
          ? "decision-not-supported"
          : "";
      /* THE CANDIDATE'S OWN DECISION IS THE MORE SPECIFIC FACT and is reported first: a
         file somebody approved says `human-approved`, not `unit-already-picked`, even
         though both are true of it. The unit's pick is the reason its ALTERNATES stopped
         asking, which is a different sentence about a different file. */
      const settled = decided || (unitSettled ? settleReason : "");
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
        counts: deepFreeze({ items: 0, awaiting: 0, shots: 0, repairs: 0, unreviewable: 0 }),
      });
    }

    const shotRows = new Map();
    for (const row of list(media.records)) {
      if (text(row.scope) !== "shot") continue;
      const kind = text(row.kind);
      if (kind !== "shot-still" && kind !== "shot-motion") continue;
      const shotId = valueOf(record(row.context).shotId);
      if (!shotId) continue;
      if (!shotRows.has(shotId)) shotRows.set(shotId, []);
      shotRows.get(shotId).push(row);
    }

    const items = [];
    for (const shot of list(project.shots)) {
      const shotId = text(record(shot).id);
      const rows = shotRows.get(shotId) || [];
      if (!rows.length) continue;
      const frames = list(record(shot).keyframes);
      const stills = rows.filter((row) => text(row.kind) === "shot-still");
      const videos = rows.filter((row) => text(row.kind) === "shot-motion");
      const shotPick = shotPickedName(stills);

      /* Frames, in declared order. */
      for (const frame of frames) {
        const frameId = text(record(frame).id);
        const unitRows = stills.filter((row) => {
          const owner = frameOwnerFor(row, frames);
          return owner ? text(record(owner).id) === frameId : false;
        });
        if (!unitRows.length) continue;
        const pickedName = framePickedName(unitRows, frameId);
        const comparisonName = pickedName || (frames[0] === frame ? shotPick : "");
        const comparisonRow = comparisonName
          ? unitRows.find((row) => text(record(row.file).name) === comparisonName)
            || stills.find((row) => text(record(row.file).name) === comparisonName)
          : null;
        items.push(...unitItems({
          rows: unitRows,
          unitSettled: !!pickedName,
          settleReason: "unit-already-picked",
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
          humanDecision: text(record(row.humanDecision).state) || "undecided",
          repairOf: null,
          repairedInto: deepFreeze([]),
          correction: deepFreeze({ state: "not-a-repair", buildId: "", intent: "" }),
          comparison: null,
          actions: deepFreeze([]),
        }));
      }

      /* Motion, at the shot, exactly as Slice 1 counts it. */
      if (videos.length) {
        const approved = approvedMotionName(shot);
        const comparisonRow = approved
          ? videos.find((row) => text(record(row.file).name) === approved) || null
          : null;
        items.push(...unitItems({
          rows: videos,
          unitSettled: !!approved,
          settleReason: "unit-already-picked",
          shot,
          owner: {
            kind: "shot-motion",
            unitId: "",
            frameId: "",
            frameLabel: "",
            picked: approved,
          },
          comparison: mediaRef(comparisonRow),
          describeCorrection: input.describeCorrection,
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
      counts: deepFreeze({
        items: items.length,
        awaiting: queue.length,
        shots: shots.size,
        repairs: queue.filter((item) => !!item.repairOf).length,
        unreviewable: items.filter((item) => !!item.unreviewable).length,
      }),
    });
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
    RETURNED_REVIEW_SETTLED_REASONS,
    RETURNED_REVIEW_UNREVIEWABLE_REASONS,
    returnedReviewProjection,
    pendingReturnedReview,
    candidateReviewContext,
  };
});
