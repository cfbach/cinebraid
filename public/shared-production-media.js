/* CineBraid — the shared production-media projection, shared by browser and Node the
   same way public/shared-media-disposition.js and public/shared-creator-state.js are.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: the Results destination and the
   Universal Media Inspector describe the same piece of media because they are two
   renderings of ONE projection, not two surfaces that each worked out what a file is.

   ---------------------------------------------------------------------------
   WHY THIS IS NOT A SECOND MEDIA DATABASE. Every fact below is already true
   somewhere else and stays true there:

     is this approved, and what for   public/shared-media-disposition.js (P4-SEM-C2/C3)
     which media did this job deliver public/shared-media-disposition.js (P4-SEM-C4)
     what does a file cost            generation-cost.js, at submission, once
     what did the AI say              the review records the reviewer wrote
     what did the human decide        the approval handlers, on the candidate row

   This module reads those records and PUTS THEM IN ONE SHAPE. It resolves no
   approval of its own, decides no disposition of its own, and writes nothing
   anywhere. `productionMediaRecords()` cannot reach a project on disk, a network,
   a clock or a DOM, which is what lets a Node suite drive it against representative
   media and what stops a rendering from becoming production state.

   NOTHING IS STORED AND NOTHING IS MUTATED. Every record is built fresh and returned
   frozen. In particular this module never calls entityStateList() or
   entityCandidateRow(create), both of which normalise what they are handed — an
   Inspector read must not canonicalise a legacy project merely by looking at it.

   ---------------------------------------------------------------------------
   IDENTITY IS TWO DOMAINS AND THEY ARE NEVER COLLAPSED.

   CineBraid has two id systems for media, and public/shared-media-disposition.js's
   own header records how easy and how permanent it is to confuse them:

     ledger    `asset-<32 hex>`. The MediaAsset ledger's identity, minted server-side,
               anchored to a digest, and the thing that survives the rename an
               approval performs. It reaches the browser only on GET /api/scan, as
               `item.assetId`, and its ABSENCE IS LEGAL — a project whose first pass
               has not run carries none at all.

     library   `P.mediaAssets[].id` — `media-…`, `blocking-media-…`. The PROJECT MEDIA
               LIBRARY row: a planning link, a blocking guide, a reference pack entry.
               A different kind of thing with a different lifetime.

   A generated blocking frame legitimately carries BOTH, and `outputs[].assetId`
   already means the library row while `outputs[].mediaAssetId` means the ledger. So
   this projection reports them as two named fields under `identity`, each with its
   own knowledge state, plus `resolvedBy` naming which one actually located the media.
   There is no generic `assetId` here to flatten them into, and a caller that wants
   "the durable identity" has to say which domain it means.

   RESOLUTION GOES THROUGH THE EXISTING RESOLVER. Anything that has to turn an edge
   into a media item calls resolveApprovalMedia() / resolveJobOutputMedia() from
   public/shared-media-disposition.js, which is identity-first with a filename
   fallback. This module adds no cross-domain shortcut — a library id is never tried
   against the ledger and a ledger id is never tried against the library.

   ---------------------------------------------------------------------------
   KNOWLEDGE, and the four job cases that are deliberately four and not two.

   Every uncertain field is a {state, value} triple in O3's vocabulary
   (public/shared-creator-state.js): `known`, `not-recorded`, `not-applicable`. A
   surface that receives {state:"not-recorded"} cannot print `$0.00` by accident,
   because there is no zero to print.

   Generation accounting needs one more, and the extra state is the whole point:

     no job          the media names no generation job at all. It was imported, or
                     hand-made, or predates job recording. Cost: not-recorded.

     job resolved,   the job row is in hand and carries no accounting. It ran before
     no accounting   CineBraid recorded cost. Cost: not-recorded.

     job resolved,   accounting exists and honestly says it does not know — a motion
     unpriced        render metered on duration, with no server-side rate.
                     Cost: not-priced.

     job NAMED but   the media names a job the caller does not have. The browser only
     NOT LOADED      loads the generation ledger when fal is enabled
                     (public/app.js), so on a project with fal off EVERY generated
                     candidate is in this case. Cost: UNAVAILABLE.

   The fourth must never render as "Cost not recorded", because the accounting may
   exist perfectly well and simply not be in the room. Saying "not recorded" there is
   the same class of lie as `$0.00` for unknown: a confident answer to a question that
   was not asked. `job.state === "unavailable"` is how a surface says
   "Generation record unavailable" instead, and nothing in this module fetches
   anything to make that case go away.

   ---------------------------------------------------------------------------
   REVIEWS ARE NORMALISED FOR DISPLAY AND NOT FOR STORAGE.

   Entity references and shot candidates carry genuinely different persisted review
   shapes, written by different code at different times:

     entity   candidateFiles[].structuredReviews[stateId] — the reference-authority
              contract, with reviewer{provider,model}, contractVersion, per-requirement
              declared-vs-observed evidence, and a semantic outcome.

     shot     candidateFiles[].aiReview — score / pass / notes / strategy, and
              candidateFiles[].structuredReview — the human's own category severities
              with an optional `ai` block.

   This module gives them ONE ENVELOPE so an Inspector can render a list, and the
   envelope carries `kind` and `source` so nothing can forget which shape it came
   from. Reviewer identity, the review's own timestamp and the underlying verdict
   fields are carried through UNCHANGED, under their own names, in `detail`. Nothing
   is invented for a shape that does not have it: a shot triage has no
   `contractVersion` and reports reviewer as not-recorded rather than borrowing the
   current Settings model, which is the attribution rule candidate review already
   holds.

   THERE IS NO CANONICAL STORED REVIEW SCHEMA HERE, and this module cannot write one:
   it has no writer at all. The normalised envelope exists for the duration of a
   render and is thrown away.

   AND A FORM DEFAULT IS NOT AN OBSERVATION. The shot's review form normalises before it
   renders, so every candidate the app has touched carries five rubric categories already
   set to "pass". Reporting those as findings is how an image nobody opened came to show
   five PASS marks. A review is on record here only when a review ACT is evidenced, and a
   category is reported only where something was actually recorded about it — see
   shotStructuredReview. Nothing is migrated to achieve that: the stored bytes are
   unchanged and the distinction lives entirely in what this module will report.

   ---------------------------------------------------------------------------
   AI RECOMMENDATION, AI REVIEW AND HUMAN DECISION ARE THREE FIELDS.

   They are separate keys on every record, they can disagree, and the projection
   never lets one stand in for another:

     humanDecision      what a person decided. The only thing that establishes canon.
     aiRecommendation   what a reviewer SUGGESTED. Advisory, and never an approval.
     reviews[]          that an AI review happened, by whom, when, and what it said.

   A record with `aiRecommendation.value === "approve"` and `humanDecision.state ===
   "undecided"` is a normal, expected row, and its `disposition.role` is `candidate`.
   Disposition comes from P4 and from nowhere else — no AI field can move it.

   ---------------------------------------------------------------------------
   NO UI WORDING. Every field below is a token, a count, an identifier, a path or a
   timestamp. Which words a surface prints is the surface's business, exactly as
   public/shared-continuity.js and public/shared-media-disposition.js both require. */

(function (root, factory) {
  const disposition = typeof module !== "undefined" && module.exports
    ? require("./shared-media-disposition.js")
    : root;
  const api = factory(disposition);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function (P4) {
  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  const PRODUCTION_MEDIA_CONTRACT = "production-media/1";

  /* ==========================================================================
     THE VOCABULARIES. */

  /* WHAT A PIECE OF MEDIA IS, by where it lives and what produced it. Deliberately
     coarse: five members, each of which a filmmaker can name. A taxonomy with a
     member per generation purpose would be a taxonomy the data cannot fill. */
  const PRODUCTION_MEDIA_KINDS = deepFreeze([
    "entity-reference",
    "shot-still",
    "shot-motion",
    "shot-blocking",
    "project-media",
  ]);

  /* Which owner a record hangs off. `project` covers media linked to the project or
     to a scene rather than to one entity or one shot. */
  const PRODUCTION_MEDIA_SCOPES = deepFreeze(["entity", "shot", "project"]);

  /* P4's roles, restated as a re-export rather than re-declared, so a surface reading
     this module does not have to import two vocabularies to render one badge. */
  const PRODUCTION_MEDIA_DISPOSITIONS = deepFreeze(["approved", "candidate", "rejected"]);

  /* THE TWO IDENTITY DOMAINS. See the header. Never merged, never cross-tried. */
  const PRODUCTION_MEDIA_IDENTITY_DOMAINS = deepFreeze(["ledger", "library"]);

  /* How the media was located. `path` is the honest answer for a project whose ledger
     has never run: the file was found by its project-relative storage path, which is
     directory-scoped and therefore NOT the bare-filename assumption C1 removed from
     the indexer. */
  const PRODUCTION_MEDIA_RESOLUTIONS = deepFreeze(["ledger", "library", "path"]);

  /* Whether the caller has the generation-job row this media names. */
  const PRODUCTION_MEDIA_JOB_STATES = deepFreeze(["none", "resolved", "unavailable"]);

  /* Four answers about money, and `priced` is the only one carrying a number. */
  const PRODUCTION_MEDIA_COST_STATES = deepFreeze(["priced", "not-priced", "not-recorded", "unavailable"]);

  /* The persisted review shapes this module can put in one envelope. Adding a member
     means adding a reader; the envelope never guesses at a shape it does not name. */
  const PRODUCTION_MEDIA_REVIEW_KINDS = deepFreeze([
    "entity-structured-review",
    "shot-ai-triage",
    "shot-structured-review",
  ]);

  /* What a human decided, in tokens. `undecided` is a real answer and the common one.
     The two dialects are kept apart — an entity row says `approved-reference`, a shot
     row says `shortlist` — and the raw stored word travels in `decision`. */
  /* `machine-selected` is the fourth, added by the Dogfood #2 P0 batch. Before it,
     an edge written by scene automation and an edge written by a director were
     the same word here, and the Inspector printed "A person approved this. It is
     production canon." over both. Automation may no longer write such an edge,
     but projects created before that repair still carry ones it did, and the
     honest report of those is that a MACHINE selected it — not that a person
     approved it, and not that nobody decided. */
  const PRODUCTION_MEDIA_DECISION_STATES = deepFreeze(["approved", "machine-selected", "rejected", "undecided"]);

  /* The reviewer's SUGGESTION vocabulary, which is not an approval vocabulary. The
     entity contract emits the first four; a shot triage emits pass/fail, mapped to
     `approve`/`correct` only because those are the same two suggestions under
     different names, and never to `approved`. */
  const PRODUCTION_MEDIA_RECOMMENDATIONS = deepFreeze(["approve", "alternate", "correct", "reject"]);

  /* ==========================================================================
     WHAT IS DELIBERATELY NOT PRODUCTION MEDIA, stated rather than merely omitted, so
     that "Results does not show locked deliveries" is a decision on the record.
     tests/production-media.js requires these to stay declared. */
  const PRODUCTION_MEDIA_EXCLUDED = deepFreeze({
    "shot-locked": {
      what: "shots/<id>/locked",
      why: "A locked file is a DELIVERY COPY of media that is already in Results under its own identity. Listing both would show one production result twice and make the approved original look like one of two candidates.",
    },
    "continuity-cache": {
      what: "continuity observation and comparison caches",
      why: "Derived analysis rather than production media. It has no disposition, no authority and nothing to approve.",
    },
    "prompt-sidecars": {
      what: "prompt, package and job JSON written beside media",
      why: "Not media. It is already reachable from the provenance block of the media it describes.",
    },
    "project-backups": {
      what: "project backups and snapshots",
      why: "Recovery artefacts. Surfacing them as production results would invite a filmmaker to approve one.",
    },
  });

  /* ==========================================================================
     WHAT THIS PROJECTION CANNOT ANSWER, in the shape O1's SHOT_STAGE_LIMITATIONS and
     O3's CREATOR_UNAVAILABLE both use: the question, why not, and the record that
     would have to exist first. A gap that is declared cannot be quietly filled with a
     guess, and tests/production-media.js requires each to stay declared for as long as
     the condition holds. */
  const PRODUCTION_MEDIA_UNAVAILABLE = deepFreeze({
    "rejection-reason": {
      question: "Why was this media rejected?",
      why: "Neither candidate dialect has a reason field. A rejection records the decision and when it was taken, and nothing about what was wrong.",
      wouldNeed: "a reason field on the candidate row, written by the rejection handler",
    },
    "shot-candidate-prompt": {
      question: "What prompt produced this frame or motion candidate?",
      why: "A shot candidate records sourceBuildId / sourcePackageId, not the prompt text. The build it names may still exist in the prompt library, but the request as sent was never copied onto the row. Entity candidates and blocking assets DO record their prompt, which is why this gap is per-kind rather than global.",
      wouldNeed: "the dispatched prompt copied onto the shot candidate row at ingest, as ingestEntity already does",
    },
    "actual-charge": {
      question: "What was actually billed for this media?",
      why: "Every recorded amount is what was ESTIMATED at submission. CineBraid receives no trustworthy billing figure from the provider.",
      wouldNeed: "provider invoice reconciliation",
    },
    "retry-lineage": {
      question: "Is this media a retry of another generation?",
      why: "A retry is a new job with a new id. Correction lineage IS recorded (correctionOf, correctionJobIds) and is reported; a plain re-run of the same request records nothing linking the two.",
      wouldNeed: "a retry-of field on the generation-job record",
    },
    "imported-origin": {
      question: "Where did an imported file come from?",
      why: "An uploaded file records its original filename and when it arrived. Nothing records the tool or service that made it.",
      wouldNeed: "an import-origin field written by the upload routes",
    },
  });

  const PRODUCTION_MEDIA_UNAVAILABLE_KEYS = deepFreeze(Object.keys(PRODUCTION_MEDIA_UNAVAILABLE));

  /* ==========================================================================
     KNOWLEDGE. O3's three answers, and `""` is not one of them. */
  function known(value) {
    const value_ = text(value);
    return deepFreeze({ state: value_ ? "known" : "not-recorded", value: value_ });
  }

  function notApplicable(reason) {
    return deepFreeze({ state: "not-applicable", value: "", reason: text(reason) });
  }

  function unavailable(reason) {
    return deepFreeze({ state: "unavailable", value: "", reason: text(reason) });
  }

  /* ==========================================================================
     MEDIA TYPE. Restated from public/app.js's isVideo/isAudio rather than required,
     for the reason shared-media-disposition.js gives at stateApprovedFileFor: the
     shared owner is preferred when it is loaded, and the local copy exists only so a
     Node suite that has not loaded app.js still answers identically. */
  function mediaTypeOf(name) {
    const file = text(name);
    const video = typeof isVideo === "function"
      ? isVideo
      : (typeof globalThis !== "undefined" && typeof globalThis.isVideo === "function" ? globalThis.isVideo : null);
    const audio = typeof isAudio === "function"
      ? isAudio
      : (typeof globalThis !== "undefined" && typeof globalThis.isAudio === "function" ? globalThis.isAudio : null);
    if (video ? video(file) : /\.(mp4|webm|mov)$/i.test(file)) return "video";
    if (audio ? audio(file) : /\.(wav|mp3|m4a|flac|ogg)$/i.test(file)) return "audio";
    return "image";
  }

  /* ==========================================================================
     IDENTITY.

     Two domains, resolved independently and reported separately.

     The ledger id is shape-checked through P4's own isLedgerAssetId, so a legacy row
     carrying a filename here reads as "no ledger identity" and the record falls back
     to its path — never as an identity that will match nothing.

     The library id is checked by MEMBERSHIP rather than by pattern. Library ids are
     free-form (`media-…`, `blocking-media-…`, and whatever a future importer mints),
     so a pattern would either be too narrow to match real rows or wide enough to
     accept a ledger id. Asking the library whether it holds the row is the honest
     test and it is the one that cannot cross the domains. */
  function isLedgerIdentity(value) {
    return typeof P4?.isLedgerAssetId === "function" ? P4.isLedgerAssetId(value) : false;
  }

  function libraryIndex(project) {
    const index = new Map();
    for (const asset of list(record(project).mediaAssets)) {
      const row = record(asset);
      const id = text(row.id);
      if (id && !index.has(id)) index.set(id, row);
    }
    return index;
  }

  /* Project-relative storage path for a scanned media item. `url` is what the scan
     wrote and is the only path the browser is given, so it is decoded back rather
     than reassembled from a directory the caller would have to remember. */
  function storagePathOf(item) {
    const raw = text(record(item).url);
    if (!raw.startsWith("/assets/")) return "";
    let rest = raw.slice("/assets/".length);
    try { rest = decodeURIComponent(rest); } catch { /* a raw name that is not valid escaping stays as written */ }
    return rest.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  /* THE PROJECTION KEY, and why it is not a filename.

     A caller needs one string it can hand to `inspect media <durable identity>`. When
     the ledger knows this file the key IS the ledger identity, which is what survives
     the approval rename. When it does not, the key is the project-relative STORAGE
     PATH — directory-scoped, unique within the project, and specifically not the bare
     basename that let `shots/SH010/blocking/BLOCK.png` inherit SH020's record.

     The prefix names the domain so a reader can never mistake one for the other. */
  function productionMediaKey(identity) {
    const it = record(identity);
    if (it.ledger?.state === "known") return `asset:${it.ledger.value}`;
    const path = text(it.path);
    return path ? `path:${path}` : "";
  }

  /* THE KEY FOR A SCANNED MEDIA ITEM, computed WITHOUT building the projection.

     This is what lets an existing thumbnail hand off to the Inspector: every media
     surface in CineBraid already holds `{name, url, assetId?}` straight from the
     scan, which is exactly the two facts the key is made of. A surface therefore
     never has to assemble Inspector data — it names the media and the Inspector does
     the rest, which is the property that keeps one Inspector from becoming six.

     Identical by construction to the key buildRecord() produces, because both call
     productionMediaKey() over the same two fields. */
  function productionMediaKeyForFile(file) {
    const it = record(file);
    const assetId = text(it.assetId);
    return productionMediaKey({
      ledger: isLedgerIdentity(assetId) ? known(assetId) : known(""),
      path: storagePathOf(it),
    });
  }

  function resolveIdentity(item, libraryRow) {
    const ledgerId = text(record(item).assetId);
    const ledger = isLedgerIdentity(ledgerId) ? known(ledgerId) : known("");
    const library = libraryRow ? known(text(record(libraryRow).id)) : notApplicable("no-library-row");
    const path = storagePathOf(item);
    return {
      ledger,
      library,
      path,
      /* Which domain actually located this media. The library never resolves media on
         its own here — a library row is discovered FROM the file, not the other way
         round — so it is reported when present and `path` is the fallback. */
      resolvedBy: ledger.state === "known" ? "ledger" : library.state === "known" ? "library" : "path",
    };
  }

  /* ==========================================================================
     HUMAN DECISION.

     Read off the candidate row, in whichever dialect the row speaks, and reported as
     one state plus the raw stored word. The dialects are NOT coerced into each other
     — media-assets.js:244 and C2's closeout both forbid it — so `decision` carries
     exactly what is on disk and `state` is the three-way answer a surface renders.

     An approval that left a `targets[]` behind is stronger evidence than the row, so
     `approvedByEdge` is passed in from the P4 disposition rather than re-derived: a
     project whose candidate row was never written still has an approved image, and it
     must not read as undecided. */
  const ENTITY_APPROVED_DECISIONS = deepFreeze([
    "approved-reference",
    "approved-sheet-source",
    "approved-coverage",
    "approved-expression",
  ]);

  /* The automation provenance word for one file, out of a shot's
     `generationRecords[]` or an entity's `made[]`. Both dialects store the
     filename under `files`, and the shot dialect also stores `file`.

     A file may carry several records — one per step that touched it — and a
     later director approval of a candidate a run had already selected produces
     both. The strongest human evidence wins, because "a person approved this"
     stops being true only if no record says so. */
  const AUTOMATION_APPROVAL_RANK = { director: 3, reused: 2, automatic: 1 };
  function automationApprovalFor(records, fileName) {
    const wanted = text(fileName);
    if (!wanted) return "";
    let best = "";
    for (const entry of list(records)) {
      const it = record(entry);
      if (text(it.file) !== wanted && text(it.files) !== wanted) continue;
      const approval = text(it.approval);
      if (!AUTOMATION_APPROVAL_RANK[approval]) continue;
      if (!best || AUTOMATION_APPROVAL_RANK[approval] > AUTOMATION_APPROVAL_RANK[best]) best = approval;
    }
    return best;
  }

  /* WHO ESTABLISHED THIS EDGE. `automationApproval` is the word the run's own
     provenance record stored — "director", "reused" or "automatic" — supplied by
     the caller because this function has no shot and no entity. It is the only
     evidence that distinguishes a machine write from a human one on the shot
     path, where the candidate row records no actor. */
  function decisionActor(row, automationApproval) {
    const it = record(row);
    const provenance = record(it.approvalProvenance);
    if (text(provenance.source) === "human" || it.humanApproved === true) return "human";
    const stored = text(automationApproval);
    if (stored === "director") return "human";
    if (stored === "reused") return "prior-human";
    if (stored === "automatic") return "automation";
    return "";
  }

  function humanDecisionOf(row, approvedByEdge, automationApproval) {
    const it = record(row);
    const decision = text(it.decision);
    const approved = approvedByEdge
      || ENTITY_APPROVED_DECISIONS.includes(decision)
      || it.humanApproved === true
      || !!text(it.approvedAt);
    const rejected = !approved && decision === "rejected";
    const provenance = record(it.approvalProvenance);
    const actor = decisionActor(it, automationApproval);
    /* THE COLLAPSE THIS ENDS. An approved edge whose only recorded actor is
       automation is reported as machine-selected, never as a human decision. */
    const machineEstablished = approved && actor === "automation";
    return deepFreeze({
      state: machineEstablished ? "machine-selected" : approved ? "approved" : rejected ? "rejected" : "undecided",
      /* The actor, reported rather than assumed. "" means no record names one,
         which is the ordinary state of a shot edge approved through the modal
         before this batch and must not be read as either answer. */
      actor: known(actor),
      /* The stored word, unchanged. A surface that wants to say "shortlisted" rather
         than "candidate" has what it needs; nothing here decides that it should. */
      decision: known(decision),
      decidedAt: known(it.decidedAt || it.approvedAt || it.reviewedAt),
      /* WAS A HUMAN THE AUTHOR OF THIS DECISION. Recorded explicitly by the entity
         approval path; absent on the shot path, where every decision is taken in a
         modal a person confirmed, so absence is reported rather than assumed. */
      by: known(provenance.source),
      /* Whether an AI check had passed at the moment the human approved. This is a
         fact ABOUT the human decision, not a decision of its own, and it is the field
         that lets a surface say "approved without an AI check" honestly. */
      aiReviewedAtDecision: typeof provenance.aiReviewed === "boolean"
        ? deepFreeze({ state: "known", value: provenance.aiReviewed ? "yes" : "no" })
        : known(""),
      approvedWithoutAI: it.humanApprovedWithoutAI === true
        ? deepFreeze({ state: "known", value: "yes" })
        : known(""),
      /* Where the shot dialect records what the approval was FOR. The entity dialect
         puts that in the approval edges instead, so this is not-applicable there. */
      approvedTarget: text(it.approvedTarget) ? known(it.approvedTarget) : known(""),
    });
  }

  /* ==========================================================================
     REVIEWS.

     One envelope, three readers, and the envelope never loses which reader produced
     it. `detail` carries the shape's own fields under their own names — nothing is
     renamed into a common schema, because a common schema is exactly the thing that
     would have to be invented and then stored. */
  function reviewEnvelope(kind, source, raw, fields) {
    return deepFreeze({
      kind,
      /* WHICH RECORD this came off, so a surface can say "reference authority review"
         and "candidate triage" rather than printing one word for two different acts. */
      source,
      reviewer: deepFreeze({
        provider: known(record(record(raw).reviewer).provider),
        model: known(record(record(raw).reviewer).model),
      }),
      reviewedAt: known(record(raw).reviewedAt),
      ...fields,
    });
  }

  /* The entity reference-authority review. Carries the richest evidence in the
     product and every field of it is passed through by name. */
  function entityReviews(row) {
    const reviews = record(record(row).structuredReviews);
    const rows = [];
    for (const stateId of Object.keys(reviews)) {
      const raw = record(reviews[stateId]);
      if (!Object.keys(raw).length) continue;
      rows.push(reviewEnvelope("entity-structured-review", "candidateFiles[].structuredReviews", raw, {
        /* The verdict, kept as the reviewer's own three separate answers rather than
           reduced to one boolean. `pass` is the contract's gate, `modelPass` is what
           the model itself said, and they can differ — that difference is the whole
           reason the reference-authority contract exists. */
        verdict: deepFreeze({
          pass: typeof raw.pass === "boolean" ? raw.pass : null,
          modelPass: typeof raw.modelPass === "boolean" ? raw.modelPass : null,
          score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : null,
          outcome: known(raw.outcome),
          worstSeverity: known(raw.worstSeverity),
        }),
        /* The declared expectation beside the observed evidence, already classified by
           the contract. Passed through untouched: this module renders nothing and
           re-judges nothing. */
        semantic: deepFreeze({
          outcome: known(raw.semanticOutcome),
          label: known(raw.semanticLabel),
          satisfied: typeof raw.semanticSatisfied === "boolean" ? raw.semanticSatisfied : null,
        }),
        evidence: deepFreeze(list(record(raw.stateEvidence).requirements).map((entry) => deepFreeze({
          label: known(record(entry).label),
          expected: known(record(entry).expected),
          observed: known(record(entry).observed),
          outcome: known(record(entry).outcome),
          detail: known(record(entry).detail),
        }))),
        blockers: deepFreeze(list(raw.blockers).map((entry) => deepFreeze({
          label: known(record(entry).label),
          severity: known(record(entry).severity),
          note: known(record(entry).note),
          actionability: known(record(entry).actionability),
        }))),
        summary: known(raw.summary),
        recommendation: known(raw.recommendation),
        contractVersion: known(raw.contractVersion),
        stateId: known(raw.stateId || stateId),
        stateName: known(raw.stateName),
      }));
    }
    return rows;
  }

  /* The shot candidate's AI triage. A genuinely thinner record, reported as thin:
     no contractVersion, and reviewer identity NOT RECORDED rather than borrowed from
     current Settings. `strategy` is the one attribution it does carry. */
  function shotAiTriage(row) {
    const raw = record(record(row).aiReview);
    if (!Object.keys(raw).length) return [];
    return [reviewEnvelope("shot-ai-triage", "candidateFiles[].aiReview", raw, {
      verdict: deepFreeze({
        pass: typeof raw.pass === "boolean" ? raw.pass : null,
        modelPass: null,
        score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : null,
        outcome: known(""),
        worstSeverity: known(""),
      }),
      semantic: deepFreeze({ outcome: known(""), label: known(""), satisfied: null }),
      evidence: deepFreeze([]),
      blockers: deepFreeze([]),
      summary: known(raw.notes),
      /* A triage `pass` is a suggestion in the same sense the entity contract's
         `recommendation` is, and it is mapped onto that vocabulary so one Inspector
         section can render both. It is NEVER mapped onto a decision word: `approve`
         is a suggestion, `approved` is a human act, and no branch here can produce
         the second. */
      recommendation: raw.pass === true ? known("approve") : raw.pass === false ? known("correct") : known(""),
      contractVersion: known(""),
      strategy: known(raw.strategy),
    })];
  }

  /* P1-3. A FORM DEFAULT IS NOT AN OBSERVATION, and this is the boundary that has to
     say so.

     public/review-provenance.js normalizeCandidateStructuredReview() writes all five
     rubric categories at severity "pass" onto the row, and candidateRecord() calls it on
     every candidate it touches — so a candidate nobody has opened, and a candidate a
     person REJECTED, both carry a full set of "pass" severities. Those exist so the
     review form has something to render a <select> against. They are not findings.

     A reporting surface that reads them as findings tells a filmmaker that an image
     nobody reviewed passed five checks, which is the most expensive kind of false
     confidence this product can produce: it is the exact claim a director would rely on
     to skip looking.

     The distinction cannot be recovered from storage — a default "pass" and a
     deliberate "pass" are the same bytes, and giving them different bytes is a schema
     migration this projection has no writer for and no business doing. So the
     distinction is drawn HERE, in what this module is willing to REPORT:

       assessed        a severity the untouched form cannot produce, or a note. Somebody
                       recorded something about this category.
       not assessed    "pass" with no note. Indistinguishable from the untouched form, so
                       it is reported as no recorded observation — never as a PASS.

     And the review is only ON RECORD at all when a review ACT is evidenced: a stored
     timestamp, an `ai` block, a summary, or a category/reference carrying a real finding
     on a record written before the timestamp existed. That is the same test
     candidateReviewBadge() already applies before it will paint a badge, so the Inspector
     and the candidate tray agree about whether a review happened. */
  function shotReviewCategoryAssessed(item) {
    const severity = text(record(item).severity);
    return (severity !== "" && severity !== "pass") || text(record(item).note) !== "";
  }

  /* The shot's structured review. This one is primarily the HUMAN's own category
     severities, with an optional `ai` block, so it is reported with its authorship
     stated rather than filed under AI. */
  function shotStructuredReview(row) {
    const raw = record(record(row).structuredReview);
    const categories = record(raw.categories);
    const keys = Object.keys(categories);
    const assessedKeys = keys.filter((key) => shotReviewCategoryAssessed(categories[key]));
    const performed = !!(text(raw.reviewedAt)
      || Object.keys(record(raw.ai)).length
      || text(raw.summary)
      || assessedKeys.length
      || list(raw.references).some(shotReviewCategoryAssessed));
    if (!performed) return [];
    return [reviewEnvelope("shot-structured-review", "candidateFiles[].structuredReview", raw, {
      verdict: deepFreeze({ pass: null, modelPass: null, score: null, outcome: known(""), worstSeverity: known("") }),
      semantic: deepFreeze({ outcome: known(""), label: known(""), satisfied: null }),
      /* HOW MUCH OF THE RUBRIC WAS ACTUALLY FILLED IN, so a surface can say "two of five
         categories carry a recorded observation" instead of implying all five do. */
      assessment: deepFreeze({ categories: keys.length, assessed: assessedKeys.length }),
      evidence: deepFreeze(keys.map((key) => {
        const item = record(categories[key]);
        return deepFreeze({
          label: known(key),
          expected: known(""),
          observed: known(item.note),
          /* The severity is reported ONLY where it is an observation. An unassessed
             category leaves this not-recorded, which is the one answer no surface can
             render as a PASS — there is no "pass" value in it to print. */
          outcome: shotReviewCategoryAssessed(item) ? known(item.severity) : known(""),
          detail: known(""),
        });
      })),
      blockers: deepFreeze([]),
      summary: known(raw.summary),
      recommendation: known(""),
      contractVersion: known(""),
      /* Stated, because this record is not an AI verdict and a surface that filed it
         under "what the AI said" would be misattributing a person's own notes. */
      authoredBy: known(record(raw.ai).provider ? "ai-assisted" : "human"),
    })];
  }

  /* THE RECOMMENDATION, extracted once from whichever review is most recent. Separate
     from `reviews[]` because a surface wants one advisory token beside the human
     decision, and separate from `humanDecision` because it is not one. */
  function recommendationOf(reviews) {
    const ordered = [...reviews].sort((a, b) =>
      text(b.reviewedAt.value).localeCompare(text(a.reviewedAt.value)));
    for (const review of ordered) {
      const value = text(review.recommendation?.value);
      if (PRODUCTION_MEDIA_RECOMMENDATIONS.includes(value))
        return deepFreeze({ state: "known", value, from: review.kind, reviewedAt: review.reviewedAt });
    }
    return deepFreeze({ state: "not-recorded", value: "", from: "", reviewedAt: known("") });
  }

  /* ==========================================================================
     PROVENANCE.

     Read from the candidate row FIRST, because the row is where ingest actually wrote
     it — generationProvider, generationModel, generationJobId, generationRequestId are
     stamped onto the candidate at ingest and are present whether or not the caller
     holds the job ledger. The job row is consulted for what only it has: accounting,
     and the durable output identity.

     Nothing here reads a filename. A model is never inferred from a name, a retry is
     never inferred from two similar jobs, and a cost is never inferred from anything. */
  function jobIndex(jobs) {
    const index = new Map();
    for (const job of list(jobs)) {
      const id = text(record(job).id);
      if (id && !index.has(id)) index.set(id, job);
    }
    return index;
  }

  /* THE FOUR-CASE ANSWER. See the header — the fourth case is why this is not a
     two-line lookup. `jobsAvailable` is the caller's honest statement about whether it
     holds a generation ledger at all; the browser passes false when fal is disabled
     and the ledger was therefore never fetched. */
  function resolveJob(jobId, index, jobsAvailable) {
    const id = text(jobId);
    if (!id) return { state: "none", job: null, id: known("") };
    const job = index.get(id) || null;
    if (job) return { state: "resolved", job, id: known(id) };
    /* NAMED BUT NOT IN HAND. Whether that is because the ledger was never loaded or
       because the row is genuinely gone, this projection cannot tell and does not
       claim to — both are "unavailable", and neither is "not recorded". */
    return {
      state: "unavailable",
      job: null,
      id: known(id),
      reason: jobsAvailable ? "job-not-in-ledger" : "generation-ledger-not-loaded",
    };
  }

  function costOf(job, jobState) {
    if (jobState === "unavailable")
      return deepFreeze({ state: "unavailable", amount: null, currency: "", confidence: "", basis: "", reason: "generation-record-unavailable" });
    if (jobState === "none")
      return deepFreeze({ state: "not-recorded", amount: null, currency: "", confidence: "", basis: "", reason: "no-generation-job" });
    const estimate = record(record(job).accounting).estimate;
    if (!estimate || !Object.keys(record(estimate)).length)
      return deepFreeze({ state: "not-recorded", amount: null, currency: "", confidence: "", basis: "", reason: "job-records-no-accounting" });
    const it = record(estimate);
    const confidence = text(it.confidence);
    if (confidence === "unknown")
      return deepFreeze({
        state: "not-priced",
        amount: null,
        currency: text(it.unit),
        confidence,
        basis: text(record(record(job).accounting).recordedAt ? "estimated-at-submission" : ""),
        reason: text(record(record(job).accounting).basis?.unpricedReason) || "no-rate-applied",
      });
    const amount = Number(it.amount);
    if (!Number.isFinite(amount))
      return deepFreeze({ state: "not-recorded", amount: null, currency: text(it.unit), confidence, basis: "", reason: "estimate-has-no-amount" });
    return deepFreeze({
      state: "priced",
      amount,
      currency: text(it.unit),
      confidence,
      /* The word that must travel with the number. generation-cost.js is explicit that
         nothing in CineBraid produces an actual charge. */
      basis: "estimated-at-submission",
      reason: "",
    });
  }

  /* The prompt, and ONLY where it was genuinely recorded against this media.

     Entity candidates copy the dispatched prompt onto the row. Blocking assets copy it
     into generationRecord. Shot frame and motion candidates DO NOT — they record a
     build id, and the build's current text is not the historical request. So this
     returns not-recorded for those rather than resolving the build and presenting
     today's wording as what was sent. PRODUCTION_MEDIA_UNAVAILABLE names the gap. */
  function promptOf(row, libraryRow) {
    const direct = text(record(row).prompt);
    if (direct) return deepFreeze({ state: "known", value: direct, source: "candidate-row" });
    const generation = text(record(record(libraryRow).generationRecord).prompt);
    if (generation) return deepFreeze({ state: "known", value: generation, source: "library-generation-record" });
    return deepFreeze({ state: "not-recorded", value: "", source: "" });
  }

  /* Lineage, and only what is actually linked. Every entry names the RELATION as a
     token and the thing it points at; nothing is reconstructed from timestamps or from
     similar filenames. */
  function lineageOf(row, libraryRow) {
    const it = record(row);
    const rows = [];
    const correctionOf = text(it.correctionOf);
    if (correctionOf) rows.push({ relation: "correction-of", value: correctionOf });
    for (const name of list(it.correctionResultNames)) {
      const value = text(name);
      if (value) rows.push({ relation: "corrected-into", value });
    }
    const finishedFrom = text(it.finishedFrom);
    if (finishedFrom) rows.push({ relation: "finished-from", value: finishedFrom });
    for (const name of list(it.renamedFrom)) {
      const value = text(name);
      if (value) rows.push({ relation: "renamed-from", value });
    }
    const revisedFrom = text(record(record(libraryRow).generationRecord).revisedFromAssetId);
    if (revisedFrom) rows.push({ relation: "revised-from-library-asset", value: revisedFrom });
    return deepFreeze(rows.map((entry) => deepFreeze(entry)));
  }

  function provenanceOf(row, libraryRow, jobs, jobsAvailable) {
    const it = record(row);
    const generation = record(record(libraryRow).generationRecord);
    const jobId = text(it.generationJobId) || text(generation.jobId);
    const resolved = resolveJob(jobId, jobs, jobsAvailable);
    const job = record(resolved.job);
    /* Row first, library second, job last. The row is where ingest stamped it and is
       the only source present when the ledger is not loaded; the job is consulted only
       for what it uniquely holds. */
    const provider = text(it.generationProvider) || text(generation.provider) || text(job.provider);
    const model = text(it.generationModel) || text(generation.model) || text(job.model);
    const requestId = text(it.generationRequestId) || text(generation.requestId) || text(job.externalId);
    const mode = text(it.generationProfileMode) || text(job.profileMode) || text(job.purpose);
    return deepFreeze({
      job: deepFreeze({
        state: resolved.state,
        id: resolved.id,
        reason: text(resolved.reason),
        purpose: known(job.purpose),
        status: known(job.status),
        createdAt: known(job.createdAt),
      }),
      provider: known(provider),
      model: known(model),
      mode: known(mode),
      requestId: known(requestId),
      profileId: known(it.generationProfileId || job.profileId),
      quality: known(it.generationQuality || generation.quality || job.quality),
      resolution: known(it.generationResolution || generation.resolution || job.resolution),
      automationRunId: known(it.automationRunId || generation.automationRunId),
      sourceBuildId: known(it.sourceBuildId || generation.sourceBuildId),
      prompt: promptOf(row, libraryRow),
      cost: costOf(resolved.job, resolved.state),
      lineage: lineageOf(row, libraryRow),
      /* The ledger identity the JOB recorded for its own output, which is a different
         statement from the identity the scan reported for the file. They agree after
         P4-SEM-C4's repair; reporting both is what lets a test prove it. */
      outputIdentity: jobOutputIdentity(resolved.job, row),
    });
  }

  /* Which durable identity the job says it delivered for this media. Resolved through
     P4's own jobOutputEdges so the matching rule stays in one place. */
  function jobOutputIdentity(job, row) {
    if (!job || typeof P4?.jobOutputEdges !== "function") return known("");
    const name = text(record(row).stored || record(row).name);
    if (!name) return known("");
    for (const edge of P4.jobOutputEdges(job)) {
      if (text(edge.file) !== name) continue;
      return known(edge.assetId);
    }
    return known("");
  }

  /* ==========================================================================
     ACTIONS.

     Declared, bounded, and REFUSING — the discipline O4's stage actions established.
     Every action carries an `invoke` DESCRIPTION and this module dispatches nothing;
     the runtime turns a token into the shipped call. Two flags exist so that a future
     edit adding a one-click paid regeneration produces NO ACTION AT ALL rather than a
     button that works.

     There is no delete. Rejection retains evidence and deletion destroys it, and
     making destruction reachable from a browsing surface is how a filmmaker loses the
     rejected take that explained a decision. */
  const PRODUCTION_MEDIA_ACTIONS = deepFreeze([
    {
      id: "open-full-preview",
      emphasis: "secondary",
      paid: false,
      destructive: false,
      invoke: "media-theatre",
      appliesWhen: "always",
    },
    {
      id: "open-owner",
      emphasis: "secondary",
      paid: false,
      destructive: false,
      invoke: "navigate-owner",
      appliesWhen: "has-owner",
    },
    {
      id: "view-review",
      emphasis: "secondary",
      paid: false,
      destructive: false,
      /* THE SHIPPED REVIEW MODAL, handed off to rather than reimplemented. That modal
         is also where running or re-running a review already lives, with its existing
         confirmation and its existing reviewer attribution. Building a second trigger
         here would mean a second place that could dispatch a reviewer, and the
         attribution rule — the reviewer that ACTUALLY RAN, never the current Settings
         value — is only true because one call site records it. */
      invoke: "review-handler",
      appliesWhen: "decidable",
    },
    {
      id: "approve",
      emphasis: "primary",
      paid: false,
      destructive: false,
      /* The SHIPPED approval modals. Both open a confirmation a person completes;
         neither is an approval this module performs. */
      invoke: "approval-handler",
      appliesWhen: "not-approved",
    },
    {
      id: "reject",
      emphasis: "secondary",
      paid: false,
      destructive: false,
      invoke: "decision-handler",
      appliesWhen: "not-rejected",
    },
    {
      id: "restore",
      emphasis: "secondary",
      paid: false,
      destructive: false,
      invoke: "decision-handler",
      appliesWhen: "rejected",
    },
  ]);

  /* WHICH MEDIA A DECISION CAN EVEN BE TAKEN ON.

     Approval and rejection are acts performed ON A CANDIDATE ROW, and two kinds have
     none: a blocking guide is a disposable planning scaffold with no approval edge
     anywhere in the model, and a project media library file is a LINK rather than a
     candidate. Offering the controls there would be a button with nowhere to write —
     worse than no button, because it would imply those kinds have a disposition the
     product could change. They are DROPPED rather than disabled, for the reason O4's
     action contract drops paid candidates: an absent control is a visible fact, and a
     disabled one invites somebody to enable it. */
  const DECIDABLE_KINDS = deepFreeze(["entity-reference", "shot-still", "shot-motion"]);

  function actionsFor(scope, kind, dispositionRole) {
    const decidable = DECIDABLE_KINDS.includes(kind);
    const rows = [];
    for (const action of PRODUCTION_MEDIA_ACTIONS) {
      if (action.paid || action.destructive) continue;
      if (action.appliesWhen === "not-approved" && dispositionRole === "approved") continue;
      if (action.appliesWhen === "not-rejected" && dispositionRole === "rejected") continue;
      if (action.appliesWhen === "rejected" && dispositionRole !== "rejected") continue;
      if (action.appliesWhen === "has-owner" && scope === "project") continue;
      if (action.appliesWhen === "decidable" && !decidable) continue;
      if (!decidable && ["approve", "reject", "restore"].includes(action.id)) continue;
      rows.push(action.id);
    }
    return deepFreeze(rows);
  }

  /* ==========================================================================
     THE RECORD.

     Assembled from parts that were each read by their own owner. This function
     decides nothing except which parts belong together. */
  function buildRecord(input) {
    const item = record(input.item);
    const row = record(input.row);
    const libraryRow = input.libraryRow || null;
    const identity = resolveIdentity(item, libraryRow);
    const name = text(item.name);
    const disposition = record(input.disposition);
    const targets = list(disposition.targets).map((edge) => deepFreeze({
      kind: text(edge.kind),
      id: text(edge.id),
      label: text(edge.label),
      /* The identity the EDGE recorded, which is what proves the approval survived a
         rename. Empty is legal and means the edge predates identity. */
      assetId: known(edge.assetId),
    }));
    const reviews = deepFreeze(input.reviews || []);
    return deepFreeze({
      contract: PRODUCTION_MEDIA_CONTRACT,
      key: productionMediaKey(identity),
      identity: deepFreeze({
        ledger: identity.ledger,
        library: identity.library,
        path: identity.path,
        resolvedBy: identity.resolvedBy,
        domains: PRODUCTION_MEDIA_IDENTITY_DOMAINS,
      }),
      kind: input.kind,
      scope: input.scope,
      file: deepFreeze({
        name,
        url: text(item.url),
        mediaType: mediaTypeOf(name),
        originalName: known(row.original || record(libraryRow).originalName),
        title: known(record(libraryRow).title),
        addedAt: known(row.addedAt || record(libraryRow).createdAt),
      }),
      context: deepFreeze(input.context),
      disposition: deepFreeze({
        role: text(disposition.role) || "candidate",
        source: input.dispositionSource,
        targets: deepFreeze(targets),
      }),
      humanDecision: humanDecisionOf(row, text(disposition.role) === "approved", input.automationApproval),
      aiRecommendation: recommendationOf(reviews),
      reviews,
      provenance: input.provenance,
      actions: actionsFor(input.scope, input.kind, text(disposition.role) || "candidate"),
    });
  }

  /* ==========================================================================
     ENUMERATION.

     One pass per owner, each using the P4 partition that already owns that owner's
     disposition. Order within an owner is the order the scan returned, because the
     scan is already sorted and re-sorting here would make this module responsible for
     presentation. */

  /* The entity's media, by the shipped rule. Preferred through the loaded owner
     (public/entities.js entityMedia) and restated verbatim otherwise, for the reason
     shared-media-disposition.js gives at stateApprovedFileFor. */
  const ENTITY_SCAN_DIR = deepFreeze({
    characters: "anchors",
    locations: "plates",
    props: "props",
    vehicles: "vehicles",
    audio: "audio",
  });
  const ENTITY_LISTS = deepFreeze(Object.keys(ENTITY_SCAN_DIR));

  function entityMediaFor(scan, listName, entity, injected) {
    if (typeof injected === "function") return list(injected(listName, entity));
    const shared = typeof entityMedia === "function"
      ? entityMedia
      : (typeof globalThis !== "undefined" && typeof globalThis.entityMedia === "function" ? globalThis.entityMedia : null);
    if (shared) return list(shared(listName, entity));
    const prefix = text(record(entity).prefix || record(entity).anchorPrefix || record(entity).id).toUpperCase();
    return list(record(scan)[ENTITY_SCAN_DIR[listName]])
      .filter((item) => text(record(item).name).toUpperCase().startsWith(prefix));
  }

  function entityRecords(options) {
    const { project, scan, jobs, jobsAvailable, libraries } = options;
    const rows = [];
    for (const listName of ENTITY_LISTS) {
      for (const entity of list(record(project)[listName])) {
        const it = record(entity);
        const media = entityMediaFor(scan, listName, it, options.entityMedia);
        /* P4 owns this. The partition is asked once per entity and every item's role
           comes out of it — nothing below re-derives approval. */
        const partition = P4.partitionEntityMedia(it, media);
        for (const group of [partition.approved, partition.candidates, partition.rejected])
          for (const entry of group) {
            const row = P4.candidateRowFor(it, entry.name) || {};
            const libraryRow = libraries.byPath.get(storagePathOf(entry.item)) || null;
            rows.push(buildRecord({
              item: entry.item,
              row,
              libraryRow,
              kind: "entity-reference",
              scope: "entity",
              disposition: entry,
              dispositionSource: "partitionEntityMedia",
              context: {
                entityList: known(listName),
                entityId: known(it.id),
                entityName: known(it.name || it.id),
                shotId: known(""),
                frameId: known(""),
                frameLabel: known(""),
                stateId: known(row.targetStateId),
                coverageSlotId: known(row.targetCoverageSlotId),
                workflow: known(row.coverageJobType === "sheet" || text(row.coverageSheetType)
                  ? "reference-sheet"
                  : text(row.targetCoverageSlotId) ? "coverage-view" : "primary-state"),
              },
              reviews: entityReviews(row),
              provenance: provenanceOf(row, libraryRow, jobs, jobsAvailable),
              automationApproval: automationApprovalFor(it.made, entry.name),
            }));
          }
      }
    }
    return rows;
  }

  function shotRecords(options) {
    const { project, scan, jobs, jobsAvailable, libraries } = options;
    const rows = [];
    for (const shot of list(record(project).shots)) {
      const it = record(shot);
      const shotScan = record(record(record(scan).shots)[text(it.id)]);
      const takes = list(shotScan.takes);
      const partition = P4.partitionShotMedia(it, takes);
      for (const group of [partition.approved, partition.candidates, partition.rejected])
        for (const entry of group) {
          const row = P4.shotCandidateRowFor(it, entry.name) || {};
          const libraryRow = libraries.byPath.get(storagePathOf(entry.item)) || null;
          const mediaType = mediaTypeOf(entry.name);
          const frameId = text(row.frameId);
          const frame = list(it.keyframes).find((item) => text(record(item).id) === frameId);
          rows.push(buildRecord({
            item: entry.item,
            row,
            libraryRow,
            kind: mediaType === "video" ? "shot-motion" : "shot-still",
            scope: "shot",
            disposition: entry,
            dispositionSource: "partitionShotMedia",
            /* The run's own word for who approved this file. Read here rather
               than inside buildRecord because only this arm has the shot. */
            automationApproval: automationApprovalFor(it.generationRecords, entry.name),
            context: {
              entityList: known(""),
              entityId: known(""),
              entityName: known(""),
              shotId: known(it.id),
              shotTitle: known(it.title),
              sceneId: known(it.scene),
              frameId: known(frameId),
              frameLabel: known(record(frame).label),
              stateId: known(""),
              coverageSlotId: known(""),
              workflow: known(mediaType === "video" ? "motion" : "frame"),
            },
            reviews: [...shotAiTriage(row), ...shotStructuredReview(row)],
            provenance: provenanceOf(row, libraryRow, jobs, jobsAvailable),
          }));
        }
      /* Blocking media. It has no candidate row and no winner edge — a blocking guide
         is a planning scaffold, not a thing anybody approves — so its disposition is
         `candidate` by construction and its record says so through its own source
         token rather than by borrowing the shot partition's. */
      for (const item of list(shotScan.blocking)) {
        const libraryRow = libraries.byPath.get(storagePathOf(item)) || null;
        rows.push(buildRecord({
          item,
          row: {},
          libraryRow,
          kind: "shot-blocking",
          scope: "shot",
          disposition: { role: "candidate", targets: [] },
          dispositionSource: "blocking-has-no-approval-edge",
          context: {
            entityList: known(""),
            entityId: known(""),
            entityName: known(""),
            shotId: known(it.id),
            shotTitle: known(it.title),
            sceneId: known(it.scene),
            frameId: known(record(libraryRow).links ? blockingFrameId(libraryRow) : ""),
            frameLabel: known(""),
            stateId: known(""),
            coverageSlotId: known(""),
            workflow: known("blocking"),
          },
          reviews: [],
          provenance: provenanceOf({}, libraryRow, jobs, jobsAvailable),
        }));
      }
    }
    return rows;
  }

  function blockingFrameId(libraryRow) {
    for (const link of list(record(libraryRow).links)) {
      const value = text(record(link).blockingFrameId);
      if (value) return value;
    }
    return "";
  }

  /* Project media library files that live in `media/`. Entity and shot media already
     appeared above under their own owner, so this pass covers only the flat media
     folder — otherwise a blocking frame would be listed twice, once as shot media and
     once as a library row, and Results would show one file as two results. */
  function projectRecords(options) {
    const { scan, jobs, jobsAvailable, libraries } = options;
    const rows = [];
    for (const item of list(record(scan).media)) {
      const path = storagePathOf(item);
      const libraryRow = libraries.byPath.get(path) || null;
      rows.push(buildRecord({
        item,
        row: {},
        libraryRow,
        kind: "project-media",
        scope: "project",
        disposition: { role: "candidate", targets: [] },
        dispositionSource: "project-media-has-no-approval-edge",
        context: {
          entityList: known(""),
          entityId: known(""),
          entityName: known(""),
          shotId: known(""),
          frameId: known(""),
          frameLabel: known(""),
          stateId: known(""),
          coverageSlotId: known(""),
          workflow: known("planning"),
          /* What this library row is linked to, which is the only "belongs to" a
             planning file has. Reported as the stored links rather than resolved to
             names this module would have to look up. */
          links: deepFreeze(list(record(libraryRow).links).map((link) => deepFreeze({
            targetType: known(record(link).targetType),
            targetId: known(record(link).targetId),
            role: known(record(link).role),
          }))),
        },
        reviews: [],
        provenance: provenanceOf({}, libraryRow, jobs, jobsAvailable),
      }));
    }
    return rows;
  }

  /* Library rows indexed by the path they claim, so a scanned file can find the
     library row describing it WITHOUT matching on a basename. `storagePath` is what
     fal-generation.js writes for every blocking asset; the older `file`-only rows are
     indexed under `media/<file>`, which is where mediaAssetUrl() says they live. */
  function libraryIndexes(project) {
    const byId = libraryIndex(project);
    const byPath = new Map();
    for (const asset of byId.values()) {
      const storage = text(asset.storagePath).replace(/^\/+/, "");
      const path = storage || (text(asset.file) ? `media/${text(asset.file)}` : "");
      if (path && !byPath.has(path)) byPath.set(path, asset);
    }
    return { byId, byPath };
  }

  /* ==========================================================================
     THE ENTRY POINT.

     `jobsAvailable` defaults to whether a job array was supplied at all, so a caller
     that passes nothing gets `unavailable` rather than a silent "not recorded" — the
     safe direction, and the one that makes the four-case rule hold for callers that
     have not thought about it yet. */
  function productionMediaRecords(options = {}) {
    const input = record(options);
    const project = record(input.project);
    const scan = record(input.scan);
    const jobs = jobIndex(input.jobs);
    const jobsAvailable = input.jobsAvailable === undefined
      ? Array.isArray(input.jobs)
      : input.jobsAvailable === true;
    const libraries = libraryIndexes(project);
    const shared = { project, scan, jobs, jobsAvailable, libraries, entityMedia: input.entityMedia };
    const records = [
      ...entityRecords(shared),
      ...shotRecords(shared),
      ...projectRecords(shared),
    ];
    /* DEDUPLICATED BY DURABLE IDENTITY. Two owners can legitimately surface the same
       bytes — a file reachable as both entity media and a library link — and Results
       must show one logical asset, not two. The key is the ledger identity when there
       is one and the storage path otherwise, so a renamed file does not become a
       second row and two different files in two directories never merge into one. */
    const seen = new Map();
    for (const row of records) if (row.key && !seen.has(row.key)) seen.set(row.key, row);
    const unique = [...seen.values()];
    return deepFreeze({
      contract: PRODUCTION_MEDIA_CONTRACT,
      records: deepFreeze(unique),
      counts: deepFreeze({
        total: unique.length,
        approved: unique.filter((row) => row.disposition.role === "approved").length,
        candidate: unique.filter((row) => row.disposition.role === "candidate").length,
        rejected: unique.filter((row) => row.disposition.role === "rejected").length,
      }),
      /* Stated rather than silent: how many rows named the same logical asset. A
         surface that truncates without saying so reads as "this is everything". */
      duplicatesCollapsed: records.length - unique.length,
      jobsAvailable,
    });
  }

  /* One record by its projection key. Rebuilt from the same pass rather than cached,
     because a cached record is a record that can be stale, and the Inspector's whole
     claim is that it shows current truth. */
  function productionMediaByKey(key, options = {}) {
    const wanted = text(key);
    if (!wanted) return null;
    return productionMediaRecords(options).records.find((row) => row.key === wanted) || null;
  }

  return {
    PRODUCTION_MEDIA_CONTRACT,
    PRODUCTION_MEDIA_KINDS,
    PRODUCTION_MEDIA_SCOPES,
    PRODUCTION_MEDIA_DISPOSITIONS,
    PRODUCTION_MEDIA_IDENTITY_DOMAINS,
    PRODUCTION_MEDIA_RESOLUTIONS,
    PRODUCTION_MEDIA_JOB_STATES,
    PRODUCTION_MEDIA_COST_STATES,
    PRODUCTION_MEDIA_REVIEW_KINDS,
    PRODUCTION_MEDIA_DECISION_STATES,
    PRODUCTION_MEDIA_RECOMMENDATIONS,
    PRODUCTION_MEDIA_EXCLUDED,
    PRODUCTION_MEDIA_UNAVAILABLE,
    PRODUCTION_MEDIA_UNAVAILABLE_KEYS,
    PRODUCTION_MEDIA_ACTIONS,
    productionMediaKey,
    productionMediaKeyForFile,
    productionMediaRecords,
    productionMediaByKey,
  };
});
