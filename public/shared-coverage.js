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
    activeCoverageSlots,
    coverageSlotFile,
    summariseCoverage,
    requirementLabel,
  };
});
