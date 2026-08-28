/* Shared coverage-requirement semantics for browser and Node, the same way
   public/shared-voice.js and public/shared-continuity.js are shared.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: two CineBraid surfaces looking
   at the same project cannot print two different required-view counts, because
   only one function is allowed to decide whether a coverage slot is required.

   Before this module the fact was encoded twice inside one record and read two
   different ways:

     slot.required      a boolean, seeded by every coverage template
     slot.requirement   the three-value enum the UI actually offers

   public/entities.js resolved the pair by precedence; public/focused-workspaces.js,
   public/coverage-automation.js and public/creation-studio.js read the boolean
   alone. A slot carrying `requirement: "not-required"` with no `required: false`
   twin was therefore excluded from the required set by the coverage board and
   counted by the Reference Inspector, and both printed a fraction.

   Three properties are structural here rather than merely tested:

   * NOTHING IS MUTATED BY A READ. Every resolver returns a fresh value and
     writes nothing back, so opening a legacy project never canonicalises it.
     Persisting an interpretation stays the explicit business of the migration
     framework (ofp/ofp-migrate-rules.js M015).

   * COUNTS ARE DERIVED, NEVER STORED. summariseCoverage() computes a fresh total
     on every call from the slots it is handed. No caller may persist its result.

   * NO UI WORDING. requirementLabel() is the one exception and it is a rendering
     helper, not a judgement — the semantic answer is always one of the three
     tokens below, and the browser decides how to say it.

   ---------------------------------------------------------------------------
   THE PRECEDENCE CONTRACT, frozen here because it is the thing that used to be
   re-guessed per screen. Resolution order, highest first:

     1. isDefault              the entity's default state is always required.
     2. slot.retired           a slot the project no longer carries is not a
                               current need. Every counting surface already
                               excluded retired slots, and the retirement writer
                               used to force `required: false` to make that
                               happen; the rule now lives here instead.
     3. slot.referenceRequirement, then slot.requirement, if the value is one of
                               the three declared literals. `referenceRequirement`
                               is the continuity-state spelling and `requirement`
                               the coverage-slot spelling; both were already read
                               in this order and that order is preserved exactly.
     4. slot.required === false  →  "planned".

   Step 4 is the rule most easily got wrong, so it is stated rather than implied:
   THE LEGACY BOOLEAN CANNOT DISTINGUISH "planned" FROM "not-required". `false`
   is the value every coverage template seeds for a view CineBraid offers but does
   not demand — "Overhead / layout", "Detail zone", "Face / detail" — and the UI
   names that state "Planned / useful later". `not-required` is an affirmative
   act: somebody said this view is not wanted. A boolean that was never authored
   cannot carry an affirmative act, so `false` reads as `planned` and never as
   `not-required`. That is the reading public/entities.js has always used, and
   inventing the more specific state during migration would manufacture intent
   the source document does not contain.

   A consequence worth naming: because the boolean is a lossy projection of the
   enum, `required: false` AGREES with both `planned` and `not-required`, and
   only `required: true` beside a non-required enum (or `required: false` beside
   `"required"`) is a genuine contradiction. requirementConflict() draws exactly
   that line, and the enum wins whenever it fires. */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  /* The declared vocabulary. These literals are the serialized values: they are
     what the UI writes, what OFP COVERAGE.requirement declares, and what
     ofp/ofp-migrate-rules.js M015 maps into. Adding a member here without adding
     it to ofp/ofp-schema.js would let the app author a value the format rejects,
     so tests/coverage-requirement-semantics.js pins the two together. */
  const COVERAGE_REQUIREMENTS = ["required", "planned", "not-required"];

  /* What an unauthored legacy boolean means. Named rather than inlined so the
     one place that decides it is greppable, and so a negative control can point
     at the exact line it has to break. */
  const LEGACY_FALSE_REQUIREMENT = "planned";
  const LEGACY_TRUE_REQUIREMENT = "required";

  function coverageText(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function coverageSlotObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  /* A declared literal, or "" when the value is absent, empty or outside the
     vocabulary. An unknown value is NEVER coerced into a neighbour — it falls
     through to the next precedence step and is reported by requirementTrace(),
     which is the same discipline OFP applies with schema.enum.unknown. */
  function normalizeRequirement(value) {
    const text = coverageText(value);
    return COVERAGE_REQUIREMENTS.includes(text) ? text : "";
  }

  /* The whole resolution, with its reasoning attached. Every other reader in this
     module is a thin wrapper over this one function. */
  function requirementTrace(item, isDefault = false) {
    const slot = coverageSlotObject(item);
    if (isDefault) return { requirement: "required", source: "default-state", declared: "", unknown: "", legacy: null };
    if (slot.retired) return { requirement: "not-required", source: "retired", declared: "", unknown: "", legacy: null };

    /* Preserved verbatim from public/entities.js: the two spellings are read as
       one expression, so an empty higher-precedence field falls through to the
       lower one while a NON-EMPTY unknown value does not. */
    const raw = slot.referenceRequirement || slot.requirement || "";
    const declared = normalizeRequirement(raw);
    const unknown = !declared && coverageText(raw) ? coverageText(raw) : "";
    const legacy = typeof slot.required === "boolean" ? slot.required : null;
    if (declared) return { requirement: declared, source: "declared", declared, unknown, legacy };
    if (legacy === false) return { requirement: LEGACY_FALSE_REQUIREMENT, source: "legacy-boolean", declared: "", unknown, legacy };
    if (legacy === true) return { requirement: LEGACY_TRUE_REQUIREMENT, source: "legacy-boolean", declared: "", unknown, legacy };
    return { requirement: "required", source: "unspecified", declared: "", unknown, legacy };
  }

  /* THE reader. Everything that wants to know whether a slot is required calls
     this and nothing else. */
  function coverageRequirement(item, isDefault = false) {
    return requirementTrace(item, isDefault).requirement;
  }

  function isRequiredCoverage(item, isDefault = false) {
    return coverageRequirement(item, isDefault) === "required";
  }

  /* Is the stored record self-contradictory? Only when the boolean asserts
     something the enum denies. `false` beside `planned` or `not-required` is not
     a conflict: the boolean simply cannot say which of the two it meant.
     Returns null when the record is coherent, so a caller can `if (conflict)`. */
  function requirementConflict(item) {
    const slot = coverageSlotObject(item);
    const declared = normalizeRequirement(slot.referenceRequirement || slot.requirement || "");
    if (!declared || typeof slot.required !== "boolean") return null;
    const consistent = slot.required ? declared === "required" : declared !== "required";
    if (consistent) return null;
    return {
      declared,
      legacy: slot.required,
      /* What the boolean can assert on its own. `true` is exact; `false` is the
         non-required pair, which is why it is reported as a set rather than a
         value. */
      legacyAdmits: slot.required ? ["required"] : ["planned", "not-required"],
      resolved: declared,
    };
  }

  /* THE SINGLE AUTHORITATIVE WRITER for a coverage or expression slot.

     One field is written and every retired encoding is removed from the record
     the user is editing. Removing them is deliberate: leaving `required` behind
     would keep a second, now-unauthored copy of the fact in the document, and
     leaving an imported `referenceRequirement` behind would leave a HIGHER
     precedence shadow that silently outranks what the user just chose. Either
     one is the duplicate truth this batch exists to end.

     `referenceRequirement` is the continuity-state spelling and is deleted here
     only because it has no business on a coverage slot; the state writer in
     public/entities.js still owns it on states, which this batch does not widen.

     This runs only inside an explicit user edit — never on load — so no project
     is canonicalised merely by being opened. */
  function writeCoverageRequirement(slot, value) {
    if (!slot || typeof slot !== "object") return "";
    const next = normalizeRequirement(value) || "required";
    slot.requirement = next;
    delete slot.required;
    delete slot.referenceRequirement;
    return next;
  }

  /* The default requirement a freshly seeded template slot carries. Templates
     used to express this as a boolean; they now express it as the enum, and this
     function is the one place that translates the template's intent so the two
     cannot drift. */
  function templateRequirement(required) {
    return required === false ? LEGACY_FALSE_REQUIREMENT : LEGACY_TRUE_REQUIREMENT;
  }

  /* ==========================================================================
     WHAT KIND OF ARTIFACT A REFERENCE FILE IS.

     A coverage sheet is a SOURCE ARTIFACT for coverage work: one image carrying
     several views. A single reference is one view. The distinction is not
     cosmetic — it decides whether an artifact may become an entity's PRIMARY
     IDENTITY AUTHORITY, and that question is now asked at the authority boundary
     in public/shared-authority-kernel.js rather than by whichever button happens
     to be on screen.

     THE ANSWER COMES FROM WHAT A WRITER DECLARED, AND FROM NOTHING ELSE.

     Three copies of a filename heuristic used to answer it —
     `/(?:SHEET|TURNAROUND|CONTACT)/i` over the stored filename, in
     public/entities.js, public/app.js and public/coverage-automation.js. It
     could not work in either direction, and that is measurable rather than
     asserted:

       * IT NEVER SAW A REAL SHEET. Every stored filename in a project is
         machine-generated from the entity id. doIntake() (public/library-tools.js)
         stores `${prefix}-CANDIDATE-${stamp}-NN.ext` and keeps the creator's own
         filename only in `original`; fal-generation.js stores
         `${entity.id}_FAL_CANDIDATE_N.ext`. A turnaround a filmmaker dragged in
         as `IREN-TURNAROUND.png` is stored as `CHAR-IREN-CANDIDATE-M9X-01.png`,
         which the pattern does not match.

       * IT FIRED ON ORDINARY IMAGES. The pattern read the WHOLE stored name, and
         that name begins with the entity id — so a prop called Bedsheet, a
         character codenamed Contact, or a location called Contact Point had every
         one of its single identity images classified as a multi-view sheet:
         barred from every coverage slot by coverageSlotOptions(), and, once the
         authority gate below exists, barred from primary authority too.

     So the pattern is DELETED rather than replaced, and no second filename
     convention takes its place. What remains is the declared record.

     PRECEDENCE, and the order matters. `coverageJobType` describes THE ARTIFACT;
     `coverageSheetType` describes WHICH BOARD the job was for. They are not the
     same fact and the old predicate conflated them: an individually generated
     expression candidate is written with `coverageJobType: "slot"` AND
     `coverageSheetType: "expressions"` (public/coverage-automation.js, the
     `mode === "individual"` arm), so `!!coverageSheetType` classified a single
     expression image as a multi-panel sheet — and coverageSlotOptions() then
     refused to let the filmmaker assign the very candidate the product had just
     generated for that slot. The job type is asked first for that reason.

     THE THIRD ANSWER IS REAL. `undeclared` is not a soft "no". It is the honest
     state of a file that reached the project without any writer describing its
     structure — which today is every hand-dropped import, because doIntake()
     writes only `{stored, original}`. It is reported as itself so that a caller
     decides what to do about it, rather than being rounded to "single" here where
     the decision would be invisible. */
  const REFERENCE_ARTIFACT_STRUCTURES = ["sheet", "single", "undeclared"];

  /* The declarations this reads, named beside the writer that authors each one:

       coverageJobType: "sheet"               submitCoverageJob, the sheet arm
       coverageJobType: "slot"                submitCoverageJob, the individual arm
       coverageJobType: "extracted-crop"      extractCoverageCrop
       coverageJobType: "imported-reference"  confirmImportedReferenceMapping
       coverageCrop: {...}                    extractCoverageCrop — the panel taken
                                              OUT of a sheet, which is one view
       coverageSheetType: "angles"|"expressions"
                                              the board the job belongs to; only a
                                              structural claim when no job type was
                                              recorded at all (legacy rows). */
  /* `single-reference` is the filmmaker's own answer at manual intake — see
     doIntake() in public/library-tools.js, which asks what the artifact is when
     nothing else has recorded it. It is a DECLARATION, not an inference, which is
     what makes it usable as identity evidence. */
  const SINGLE_VIEW_JOB_TYPES = ["slot", "extracted-crop", "imported-reference", "single-reference"];

  /* WHICH IMPORT MAPPINGS ARE A SINGLE-VIEW CLAIM, enumerated rather than assumed.
     confirmImportedReferenceMapping() splits its target as `${kind}:${targetId}`
     and the option list offers exactly three kinds (public/coverage-automation.js,
     `targetOptions`):

       state       -> one continuity state's approvedFile
       coverage    -> one named angle/view slot
       expression  -> one named expression slot

     Every one of them assigns ONE image to ONE single-view target, so all three
     are single-view claims and none of them can mean "sheet". A kind outside this
     set is not guessed at — it falls through to `undeclared` and fails closed. */
  const SINGLE_VIEW_IMPORT_KINDS = ["state", "coverage", "expression"];

  function referenceArtifactStructure(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return "undeclared";
    const jobType = coverageText(row.coverageJobType);
    if (jobType === "sheet") return "sheet";
    if (SINGLE_VIEW_JOB_TYPES.includes(jobType)) return "single";
    if (row.coverageCrop && typeof row.coverageCrop === "object" && !Array.isArray(row.coverageCrop)) return "single";
    if (!jobType && coverageText(row.coverageSheetType)) return "sheet";
    /* The state-import mapping was already being written and was already a
       single-view statement; only this reader was ignoring it. */
    const importKind = coverageText(coverageSlotObject(row.importedMapping).kind);
    if (SINGLE_VIEW_IMPORT_KINDS.includes(importKind)) return "single";
    return "undeclared";
  }

  /* The candidate row for a stored filename. This is public/entities.js's
     entityCandidateRow() lookup — `stored || name` — and deliberately NOT
     public/app.js's `stored || name || original`: `original` holds the creator's
     pre-upload filename, and matching one row's STORED name against another
     row's ORIGINAL name is the same filename-as-truth confusion this section
     exists to remove. Returns null rather than {} so "no record" stays
     distinguishable from "a record that declares nothing". */
  function referenceArtifactRow(entity, fileName) {
    const rows = entity && Array.isArray(entity.candidateFiles) ? entity.candidateFiles : [];
    const wanted = String(fileName == null ? "" : fileName);
    if (!wanted) return null;
    return rows.find((row) => row && String(row.stored || row.name || "") === wanted) || null;
  }

  function referenceArtifactStructureOf(entity, fileName) {
    return referenceArtifactStructure(referenceArtifactRow(entity, fileName));
  }

  /* The one predicate every "is this a sheet" caller now asks. */
  function isCoverageSheetArtifact(entity, fileName) {
    return referenceArtifactStructureOf(entity, fileName) === "sheet";
  }

  /* MAY THIS ARTIFACT BECOME AN ENTITY'S PRIMARY IDENTITY AUTHORITY.
     ONLY A KNOWN SINGLE VIEW MAY. This used to read `!== "sheet"`, and the
     independent review was right that it was fail-OPEN wearing a fail-closed
     comment: a hand-dropped single image and a hand-dropped multi-panel sheet
     persist the identical structural fields — `{stored, original}` — so BOTH
     answered `undeclared` and BOTH stayed identity-eligible. `undeclared` does
     not mean "probably fine"; it means THE APPLICATION HAS NO EVIDENCE, and no
     evidence is not evidence of eligibility.
     What makes this usable rather than merely strict is that the missing evidence
     is now COLLECTED instead of guessed: manual intake asks the filmmaker which
     one this is and records the answer structurally, and the import mapper's
     existing `importedMapping.kind` was already a single-view statement that this
     module simply was not reading. Nothing here infers from a filename, a
     dimension or an aspect ratio. */
  function artifactMayHoldPrimaryAuthority(structure) {
    return coverageText(structure) === "single";
  }

  function activeCoverageSlots(slots) {
    return (Array.isArray(slots) ? slots : []).filter((slot) => slot && !slot.retired);
  }

  /* DERIVED, never stored. Every count CineBraid shows about coverage comes from
     here, computed fresh from the slots handed in. A caller that persisted this
     object would be storing a rollup beside the facts it came from, which is the
     drift P0 §5 refuses. */
  /* The file a coverage slot holds, under either name. `selectedFile` is what a
     slot assignment writes; `approvedFile` is the legacy key a pre-existing
     project still carries. Both mean the same thing — A SUPPORTING SELECTION —
     and neither is Canon, which is why the fields this summary returns count
     SELECTED views rather than approvals. */
  function coverageSlotFile(slot) {
    const it = slot && typeof slot === "object" ? slot : {};
    return String(it.selectedFile || it.approvedFile || "");
  }
  function summariseCoverage(slots) {
    const active = activeCoverageSlots(slots);
    const required = active.filter((slot) => coverageRequirement(slot) === "required");
    const planned = active.filter((slot) => coverageRequirement(slot) === "planned");
    const notRequired = active.filter((slot) => coverageRequirement(slot) === "not-required");
    return {
      required: required.length,
      planned: planned.length,
      notRequired: notRequired.length,
      /* SELECTED, not approved. The keys keep their names because every caller
         and several suites already read them, but what they count is how many
         supporting views have been chosen — never how many were approved. */
      approvedRequired: required.filter((slot) => coverageSlotFile(slot)).length,
      approvedTotal: active.filter((slot) => coverageSlotFile(slot)).length,
      selectedRequired: required.filter((slot) => coverageSlotFile(slot)).length,
      selectedTotal: active.filter((slot) => coverageSlotFile(slot)).length,
      total: active.length,
      missingRequired: required.filter((slot) => !coverageSlotFile(slot)).length,
    };
  }

  function requirementLabel(item, isDefault = false) {
    const value = coverageRequirement(item, isDefault);
    return value === "not-required" ? "Not required" : value === "planned" ? "Planned" : "Required";
  }

  /* -------------------------------------------------------------------------
     BATCH 2 SLICE 3 — THE DEMAND PROJECTION. Presentation only, and additive.

     Slice 3 has to present coverage as "what does THIS production need" in
     filmmaker language, and the brief is explicit that flipping the
     `source: "unspecified"` default from required is NOT a casual UI change.
     It is not made here, and nothing above this comment changed: the five
     resolvers — requirementTrace, coverageRequirement, isRequiredCoverage,
     summariseCoverage, writeCoverageRequirement — answer exactly what they
     answered before, so server.js, ofp/ofp-migrate-rules.js M015,
     coverage-automation.js, creation-studio.js and the Reference Inspector
     count what they always counted.

     What this adds is a PROJECTION of the answer requirementTrace() already
     gives, and it is a projection precisely because the three things below are
     different questions that the checklist-shaped UI had collapsed into one:

       1. IS IT REQUIRED          coverageRequirement(). Unchanged. Authority.
       2. DID ANYONE SAY SO       requirementTrace().source. Already recorded.
                                  `unspecified` means the project never authored
                                  this slot; it is still REQUIRED, and it is
                                  still counted, but it is not evidence that the
                                  production asked for the view.
       3. WHAT DOES THE DEFAULT
          SCREEN LEAD WITH        `tier` plus `confirmed`, below.

     The tier is a ONE-TO-ONE RENAME of the three shipped tokens. It invents no
     fourth state and it can never disagree with coverageRequirement(), because
     it is computed from it:

         required       -> "required"           "Required"
         planned        -> "recommended"        "Recommended"
         not-required   -> "not-currently-needed"  "Not currently needed"

     `confirmed` is the only genuinely new bit, and it is deliberately NOT a
     requirement: it says whether a human, a template or the default-state rule
     put the value there, as opposed to nobody having authored the slot at all.
     A surface may use it to decide what to show FIRST. A surface that used it
     to decide what is REQUIRED would be re-deciding question 1, which is the
     duplicate-truth this file exists to prevent. */
  const COVERAGE_DEMAND_TIERS = ["required", "recommended", "not-currently-needed"];

  /* requirement token -> demand tier. Total over COVERAGE_REQUIREMENTS, so a
     token that ever gains a member fails loudly here rather than silently
     rendering as Required. */
  const DEMAND_TIER_BY_REQUIREMENT = {
    required: "required",
    planned: "recommended",
    "not-required": "not-currently-needed",
  };

  /* The sources that represent somebody ASSERTING something about this slot.
     `unspecified` is absent by definition — it is the absence of an assertion.
     `legacy-boolean` counts: every coverage template seeds it, so it carries a
     template author's intent even though it cannot carry a specific one. */
  const CONFIRMED_DEMAND_SOURCES = ["default-state", "retired", "declared", "legacy-boolean"];

  function coverageDemand(item, isDefault = false) {
    const trace = requirementTrace(item, isDefault);
    return {
      /* Carried through unchanged so a caller never has to re-resolve, and so a
         tier and a requirement can be compared in one place. */
      requirement: trace.requirement,
      source: trace.source,
      tier: DEMAND_TIER_BY_REQUIREMENT[trace.requirement] || "required",
      confirmed: CONFIRMED_DEMAND_SOURCES.includes(trace.source),
    };
  }

  /* WORDING, and the one place it lives. The same exception requirementLabel()
     already is: a rendering helper over a token, never a judgement. */
  function coverageDemandLabel(tier) {
    const value = COVERAGE_DEMAND_TIERS.includes(tier) ? tier : "required";
    return value === "recommended" ? "Recommended"
      : value === "not-currently-needed" ? "Not currently needed"
        : "Required";
  }

  /* -------------------------------------------------------------------------
     SLICE 5 — CURRENT DEMAND, WHICH IS A DIFFERENT QUESTION FROM REQUIREMENT.

     Slice 3 established the tier as a ONE-TO-ONE RENAME of the requirement, and
     that has not changed here: coverageDemand() still answers exactly what it
     answered, `tier` is still computed from coverageRequirement() alone, and a
     required slot is still presented under Required. tests/reference-reframe.js
     holds that line and must keep holding it.

     What this adds is the SECOND axis the reframe deliberately did not have.
     "Required" is a statement about the slot: this production would want this
     view of this reference. It is not a statement about now. A character
     nobody has cast into a shot has four required views and zero current work,
     and the surface was reporting the first number as the second — the fake
     backlog the Public Alpha audit found.

         tier            what KIND of material this is, per the requirement.
                         Authored, durable, unchanged by anything here.
         demand state    whether the production is ASKING FOR IT NOW.
                         Derived, never stored, and gone the moment the
                         structure that produced it is cleared.

     The two are orthogonal on purpose. Collapsing them would either delete the
     filmmaker's authored "this view is required" the moment a shot changed, or
     put the backlog straight back.

     FOUR STATES, and they are the four the alpha brief names:

       required-now           tier `required`, production demands this entity,
                              and nothing satisfies it yet. THE ONLY STATE THAT
                              IS WORK.
       satisfied              something already answers it, at any tier.
       available              real capability, not current work: a recommended
                              item, or a required item on a reference no shot
                              currently uses. It is not "not needed" — the day a
                              shot casts the reference it becomes required-now
                              with no edit at all.
       not-currently-needed   the requirement itself says so. Unchanged meaning.

     `basis` records WHY, so a surface can say "no shot uses this yet" rather
     than leaving a filmmaker to wonder where their required view went.

     PRODUCTION IS ASKED, NEVER ASSUMED. With no production fact supplied, or
     with one that reports `known: false`, a required item stays required-now:
     a caller that cannot establish demand must not be able to silently suppress
     work. Suppression requires a positive, knowing answer of "nothing uses
     this". */
  const REFERENCE_DEMAND_STATES = ["required-now", "satisfied", "available", "not-currently-needed"];

  /* Total over the four states. A fifth member would fail loudly here rather
     than render as a blank label. */
  const REFERENCE_DEMAND_LABELS = {
    "required-now": "Required now",
    satisfied: "Satisfied",
    available: "Available",
    "not-currently-needed": "Not currently needed",
  };

  function referenceDemandState(demand, context = {}) {
    const it = demand && typeof demand === "object" ? demand : {};
    const ctx = context && typeof context === "object" ? context : {};
    const tier = COVERAGE_DEMAND_TIERS.includes(it.tier) ? it.tier : "required";
    const production = ctx.production && typeof ctx.production === "object" ? ctx.production : {};
    /* SATISFIED OUTRANKS EVERYTHING. A covered item is not work at any tier, and
       reporting a satisfied required view as outstanding is the same lie in the
       other direction. */
    if (ctx.satisfied === true) return { state: "satisfied", tier, basis: "already-satisfied", demanded: production.demanded === true };
    if (tier === "not-currently-needed") return { state: "not-currently-needed", tier, basis: "requirement", demanded: production.demanded === true };
    if (tier === "recommended") return { state: "available", tier, basis: "requirement", demanded: production.demanded === true };
    /* tier === "required". The one place the production fact can change an
       answer, and only ever in the direction of claiming LESS. */
    if (production.known === true && production.demanded !== true)
      return { state: "available", tier, basis: "no-current-production-demand", demanded: false };
    return { state: "required-now", tier, basis: "current-production-demand", demanded: production.demanded === true };
  }

  function referenceDemandStateLabel(state) {
    return REFERENCE_DEMAND_LABELS[state] || REFERENCE_DEMAND_LABELS["required-now"];
  }

  /* -------------------------------------------------------------------------
     DOGFOOD SLICE 0 — WHAT A COVERAGE RUN RECORD IS ALLOWED TO SAY NOW.

     `entity.coverageAutomation` is a DURABLE RECORD OF A MACHINE'S OWN REPORT:
     which mode was submitted, which jobs it queued, and what it last knew about
     the requirement it was launched against. Two of those are history and stay
     history. The third — `status`, and the `missingRequired` count beside it —
     is a claim about the PROJECT, and the project moves without telling the
     record.

     The Aug 26 dogfood pass is the whole argument for this function. A creator
     satisfied the last required view by cropping a sheet by hand. The coverage
     board, which counts through summariseCoverage(), said 0 missing. The run
     banner, which read `run.status` and `run.missingRequired`, said NEEDS
     ATTENTION and offered RESUME MISSING VIEWS — a button whose destination is a
     paid generation dialog. One screen, two numbers, and the wrong one had the
     money attached to it.

     THE RULE, and it is the same rule the run-gate reconciliation in
     public/shared-production-authority.js applies to approval gates: a stored
     run state may never contradict current authoritative truth about the goal it
     was launched to reach. It does not matter whether the automation is what
     closed the gap; a goal satisfied by hand is satisfied.

     THREE PROPERTIES, structural rather than merely tested:

     * NOTHING IS MUTATED. Like every other resolver in this file, this returns a
       fresh value and writes nothing. The one durable writer that exists
       (updateCoverageTerminalState in public/coverage-automation.js) calls this
       and copies the answer; it is not a second opinion.

     * THE RECORDED STATUS IS NEVER DESTROYED. `recordedStatus` carries what the
       machine actually last said, so Activity and history keep their evidence
       while the live surface stops asserting it.

     * COVERAGE IS ASKED, NEVER ASSUMED. With no knowable coverage answer, the
       recorded status is passed through unchanged and the paid action is NOT
       suppressed — exactly the discipline referenceDemandState() applies to
       production demand. Suppressing work requires a positive, knowing "nothing
       is missing"; a caller that cannot establish coverage must not be able to
       silently hide the run or the action.

     The statuses below are public/coverage-automation.js's own vocabulary, named
     here so the reconciliation and the writer cannot drift apart. */
  const COVERAGE_RUN_GOALS = ["satisfied", "outstanding", "unknown"];
  /* A recorded status that means "the machine handed something back and a person
     still owes it a decision". These are the ones a satisfied goal must clear,
     and the ones updateCoverageTerminalState has always downgraded. */
  const COVERAGE_RUN_REVIEW_STATUSES = ["sheet-ready-for-review", "slot-candidates-ready", "ready-for-review"];
  /* A recorded status that says the machine is still executing. A run in flight is
     not reconciled to "completed" by this function even when the requirement is
     already met: the record belongs to a runner that has not finished writing it,
     and overwriting it here would be the same race automation-runs.js refuses for
     `running`. The GOAL is still reported satisfied, so no surface has to pretend
     work is owed — it simply does not restate the machine's own status. */
  const COVERAGE_RUN_ACTIVE_STATUSES = ["starting", "sheet-running", "individual-running"];

  /* THE MACHINE'S OWN COVERAGE-RUN RECORDS, PRESERVED WHOLESALE.
   *
   * A coverage run is a record of work the SERVER is executing, and during a generic
   * project save the authoritative value wins entirely. Not "wins except for the fields
   * that look harmless" — entirely.
   *
   * The previous version left one direction open: a run the browser could see could be
   * moved to a TERMINAL state, on the reasoning that terminating removes privilege rather
   * than granting it. An independent reviewer showed why that reasoning is not enough. A
   * generic PUT carrying `id: OLD, status: completed, completedAt: <stale>` was accepted
   * against the CURRENT ETag, and the stored run kept the server's identity and jobs while
   * its authoritative status became `completed` with a `completedAt` copied from a record
   * that no longer existed. Removing privilege is still WRITING LIFECYCLE, and a generic
   * save is not an authorised lifecycle writer at any point on the dial.
   *
   * So there is no field list any more and no status logic. One rule:
   *
   *   stored run exists  -> the stored run, exactly, whatever the successor says;
   *   stored run absent  -> no run, whatever the successor says.
   *
   * Nothing is lost by this. The browser's updateCoverageTerminalState() was caching a
   * value that coverageRunReconciliation() below already derives fresh for every reader —
   * `goal: "satisfied"` yields `status: "completed"` from the live requirement whatever
   * the stored word is — so the display never depended on the write. And the run does not
   * stay live: fal-generation.js's ingestEntity() moves it to `sheet-ready-for-review` or
   * `slot-candidates-ready` when the last job of the run returns, and
   * updateEntityCoverageRun() writes `failed` / `cancelled` / `needs-attention`. Both go
   * through INTERNAL_NONAUTHORITY_WRITE, which never reaches this function.
   *
   * Matched BY ENTITY ID within each list, so a save that reorders, renames or adds
   * entities keeps every run attached to the entity that owns it. Everything else on the
   * entity is the filmmaker's and is left exactly as it arrived. */
  function preserveServerOwnedCoverageRuns(prepared, current) {
    for (const list of ["characters", "locations", "props", "vehicles"]) {
      const stored = new Map(
        (Array.isArray(current?.[list]) ? current[list] : [])
          .filter((row) => row && row.coverageAutomation && typeof row.coverageAutomation === "object")
          .map((row) => [String(row.id), row.coverageAutomation]),
      );
      for (const entity of Array.isArray(prepared[list]) ? prepared[list] : []) {
        if (!entity || typeof entity !== "object") continue;
        const owned = stored.get(String(entity.id));
        if (owned === undefined) delete entity.coverageAutomation;
        else entity.coverageAutomation = JSON.parse(JSON.stringify(owned));
      }
    }
    return prepared;
  }

  function coverageRunReconciliation(run, coverage) {
    const record = coverageSlotObject(run);
    const it = coverageSlotObject(coverage);
    const recordedStatus = coverageText(record.status);
    const recordedMissing = Number.isFinite(Number(record.missingRequired)) && Number(record.missingRequired) >= 0
      ? Math.floor(Number(record.missingRequired))
      : null;
    const missing = Number(it.missingRequired);
    /* KNOWN means a caller positively supplied a current count. `known: false`
       forces unknown even when a number came with it, so a surface that is
       rendering from a partial projection can say so. */
    const known = it.known !== false && Number.isFinite(missing) && missing >= 0;
    if (!known) {
      return {
        known: false,
        goal: "unknown",
        status: recordedStatus,
        recordedStatus,
        missingRequired: recordedMissing,
        reconciled: false,
        /* Neither suppressed nor asserted: the caller could not establish the
           requirement, so nothing here narrows what it may offer. */
        actionable: COVERAGE_RUN_REVIEW_STATUSES.includes(recordedStatus) || recordedStatus === "needs-attention",
        offersGeneration: true,
      };
    }
    const live = Math.floor(missing);
    if (live === 0) {
      /* THE SATISFIED CASE. The machine's own word is kept in `recordedStatus`
         and replaced everywhere it would be read as a live claim. A run still
         executing keeps its executing status — see COVERAGE_RUN_ACTIVE_STATUSES
         — because "a machine is working" and "the goal is met" are different
         facts and this function only owns the second. */
      const active = COVERAGE_RUN_ACTIVE_STATUSES.includes(recordedStatus);
      const status = active ? recordedStatus : "completed";
      return {
        known: true,
        goal: "satisfied",
        status,
        recordedStatus,
        missingRequired: 0,
        reconciled: recordedStatus !== status || recordedMissing !== 0,
        actionable: false,
        offersGeneration: false,
      };
    }
    return {
      known: true,
      goal: "outstanding",
      /* The machine's status still governs how the outstanding work is described
         — it is the only thing that knows whether a sheet came back or a slot
         request failed — but the COUNT beside it is the live one. */
      status: recordedStatus,
      recordedStatus,
      missingRequired: live,
      reconciled: recordedMissing !== live,
      actionable: COVERAGE_RUN_REVIEW_STATUSES.includes(recordedStatus) || recordedStatus === "needs-attention",
      offersGeneration: true,
    };
  }

  return {
    COVERAGE_REQUIREMENTS,
    LEGACY_FALSE_REQUIREMENT,
    LEGACY_TRUE_REQUIREMENT,
    normalizeRequirement,
    requirementTrace,
    coverageRequirement,
    isRequiredCoverage,
    requirementConflict,
    writeCoverageRequirement,
    templateRequirement,
    REFERENCE_ARTIFACT_STRUCTURES,
    referenceArtifactStructure,
    referenceArtifactRow,
    referenceArtifactStructureOf,
    isCoverageSheetArtifact,
    artifactMayHoldPrimaryAuthority,
    activeCoverageSlots,
    coverageSlotFile,
    summariseCoverage,
    requirementLabel,
    COVERAGE_DEMAND_TIERS,
    CONFIRMED_DEMAND_SOURCES,
    coverageDemand,
    coverageDemandLabel,
    REFERENCE_DEMAND_STATES,
    REFERENCE_DEMAND_LABELS,
    referenceDemandState,
    referenceDemandStateLabel,
    COVERAGE_RUN_GOALS,
    COVERAGE_RUN_REVIEW_STATUSES,
    COVERAGE_RUN_ACTIVE_STATUSES,
    coverageRunReconciliation,
    preserveServerOwnedCoverageRuns,
  };
});
