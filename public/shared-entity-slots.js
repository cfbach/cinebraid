/* CINEBRAID — COVERAGE AND EXPRESSION SLOTS ARE SUPPORTING REFERENCES.
 *
 * Browser and Node, the same way public/shared-entity-ownership.js is shared.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR (Dogfood #2, Repair Batch 1C).
 *
 * The Batch 1B re-audit found coverage and expression slots living a double
 * life. They were described as display pointers, and they were consumed as:
 *
 *   - generation authority       (the reference builder attached them)
 *   - continuity/design authority(server-side review called an approved slot
 *                                 "approved alternate-view design authority")
 *   - production-media authority (`approved-coverage` / `approved-expression`
 *                                 dispositions)
 *   - export authority           (OFP M013/M030 sent a non-empty slot file
 *                                 through the approved-output path)
 *   - implicit human approval    (the writers set `humanApproved: true` and an
 *                                 approval provenance record)
 *
 * and they carried no authority receipt, no actor, and — in the batch writer —
 * no ownership check at commit time.
 *
 * There were two coherent endings. Extend the receipt model to slots, or stop
 * the consumers treating slots as authority.
 *
 *     ALPHA TAKES THE SECOND, AND IT IS A DELETION, NOT A DEFERRAL.
 *
 * Nothing in the evidenced workflow needs a coverage slot to be canon. A
 * three-quarter view is something a filmmaker wants ON HAND — a supporting
 * reference the prompt compiler may cite as context. The production truth of
 * "which image IS this character" lives in the entity's continuity states,
 * which do carry receipts. Making slots explicitly non-authoritative removes an
 * entire authority surface rather than instrumenting one.
 *
 * ---------------------------------------------------------------------------
 * WHAT A SLOT MAY AND MAY NOT DO, stated once so no consumer has to decide.
 *
 *   MAY   hold a chosen file, be shown, be replaced, be cleared, be described,
 *         travel as SUPPORTING context to a prompt, be part of coverage
 *         completeness reporting.
 *
 *   MAY NOT satisfy a human gate, count as human approval, become canon,
 *         become an approved production output, be exported as approved
 *         output, or unblock work that requires human authority.
 *
 * NO DATA IS DESTROYED. Every existing `approvedFile`, every replacement
 * history entry and every provenance record stays exactly where it is. What
 * changes is what CineBraid CLAIMS about them: an assignment is a selection,
 * and the record says so.
 *
 * Deliberately absent, and required to stay absent:
 *   - file or network I/O
 *   - Date.now(), new Date(), Math.random()
 *   - any authority vocabulary. There is none here, on purpose. */

const SLOT_GROUPS = ["coverageSlots", "expressionSlots"];

/* The word a slot's `status` may carry. `approved` is gone: it was the field
   every consumer read as authority, and keeping it while denying its meaning
   would be the mixed contract all over again. */
const SLOT_ASSIGNMENT_STATES = ["missing", "selected", "retired"];

/* WHAT A SLOT ASSIGNMENT IS. Named so a reader greps for the concept rather
   than for a status string, and so the distinction from an approval is visible
   at every call site. */
const SLOT_ASSIGNMENT_KIND = "supporting-reference-selection";

function slotObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function slotText(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function slotList(value) {
  return Array.isArray(value) ? value : [];
}

/* ---------- reading ------------------------------------------------------- */

/* THE ONE ACCESSOR. Every reader of a slot's file goes through here.
 *
 * `selectedFile` is what a slot assignment writes now. `approvedFile` is read
 * only as a LEGACY ALIAS, because a pre-existing project has the file under that
 * name and no data may be destroyed — but a value found there is a SUPPORTING
 * SELECTION, exactly like a value found under the new name. It has never been
 * Canon and reading it from the old key does not make it Canon.
 *
 * The rename is the point: `slot.approvedFile` put the word "approved" in front
 * of every consumer, and consumers duly concluded approval. There is no field on
 * a slot with that word in it any more, so the mistake has nothing to read. */
function slotSelectedFile(slot) {
  const it = slotObject(slot);
  return slotText(it.selectedFile) || slotText(it.approvedFile);
}
/* The legacy value alone, for a surface that wants to say "this came from an
   older project" rather than silently presenting it as a current selection. */
function slotLegacyFile(slot) {
  const it = slotObject(slot);
  return slotText(it.selectedFile) ? "" : slotText(it.approvedFile);
}

/* IS THIS SLOT AUTHORITY. No. It never is, and the answer is a function rather
   than a comment so a consumer can assert on it and a test can hold it. */
function slotIsAuthoritative() {
  return false;
}

/* Every slot file an entity holds, across both groups. Used by ownership as a
   durable CLAIM source — "this entity records this file" is still true and
   still decides ownership; it just is not an approval. */
function entitySlotFiles(entity) {
  const it = slotObject(entity);
  const files = [];
  for (const group of SLOT_GROUPS) {
    for (const slot of slotList(it[group])) {
      const file = slotSelectedFile(slot);
      if (file) files.push(file);
    }
  }
  return files;
}

/* ---------- writing ------------------------------------------------------- */

/* THE ONE SLOT WRITER.
 *
 * Every path that puts a file in a slot goes through here — single selection,
 * batch, replacement, automation seeding, import, and the crop extractor. Not
 * because a slot is authority (it is not) but because ownership still has to be
 * true, and because the re-audit's batch writer proved that a second setter is
 * where the check goes missing.
 *
 * OWNERSHIP IS INTRINSIC, AND THERE IS NO INSTALLER.
 *
 * Six call sites used to pass the identical eligibility closure. Batch 1D
 * replaced that with `installSlotOwnershipPolicy`, an exported setter — the
 * same optional-policy architecture the Canon path had just deleted, and the 1D
 * audit noted that a caller omitting `owner.project` skipped the check
 * entirely.
 *
 * This module depends on public/shared-entity-ownership.js directly, by
 * `require` in Node and by name in the browser's shared scope, and the check is
 * unconditional: an assignment that cannot be justified is refused.
 *
 * Returns a decision. Applies it only when it passes, so a refused assignment
 * leaves the slot exactly as it was. */
function slotOwnershipModule() {
  if (typeof module !== "undefined" && module.exports) {
    try { return require("./shared-entity-ownership.js"); } catch { return null; }
  }
  if (typeof buildEntityOwnerIndex === "function" && typeof resolveMediaOwnership === "function") {
    return { buildEntityOwnerIndex, resolveMediaOwnership };
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.buildEntityOwnerIndex === "function" && typeof globalThis.resolveMediaOwnership === "function") {
    return { buildEntityOwnerIndex: globalThis.buildEntityOwnerIndex, resolveMediaOwnership: globalThis.resolveMediaOwnership };
  }
  return null;
}
function assignSlotReference(slot, request = {}) {
  const it = slotObject(request);
  const target = slotObject(slot);
  const fileName = slotText(it.fileName);
  const at = slotText(it.at);
  if (!target || typeof slot !== "object") return { assigned: false, reason: "unknown-slot" };
  if (!fileName) return { assigned: false, reason: "no-file" };
  /* The owner this slot belongs to, re-resolved against CURRENT state at the
     moment of writing — never against a shortlist a modal rendered minutes ago,
     which is the stale-evidence defect the 1B re-audit produced here. */
  const owner = slotObject(it.owner);
  if (owner.project) {
    const owners = slotOwnershipModule();
    if (!owners) {
      return { assigned: false, reason: "SLOT_OWNERSHIP_RESOLVER_UNAVAILABLE", message: `CineBraid cannot confirm which reference owns ${fileName}, so it will not select it here.` };
    }
    const resolution = slotObject(owners.resolveMediaOwnership(owners.buildEntityOwnerIndex(owner.project, slotText(owner.list)), fileName));
    if (resolution.contested === true) {
      return { assigned: false, reason: "SLOT_OWNERSHIP_CONTESTED", message: `${fileName} is durably claimed by more than one reference (${slotList(resolution.claimants).join(", ")}). Resolve the conflict first.` };
    }
    if (resolution.authoritative !== true || slotText(resolution.ownerId) !== slotText(owner.entityId)) {
      return { assigned: false, reason: "SLOT_OWNERSHIP_UNRESOLVED", message: `${fileName} is not durably owned by ${slotText(owner.entityId)}. Claim it for this reference first.` };
    }
  }
  const previous = slotSelectedFile(target);
  if (previous && previous !== fileName) {
    target.replacementHistory = slotList(target.replacementHistory);
    target.replacementHistory.push({ from: previous, to: fileName, at, source: slotText(it.via) });
  }
  /* THE FIELD IS RENAMED, NOT MIRRORED. Writing both would leave the word
     "approved" on a supporting reference forever, and the 1D audit showed
     exactly what consumers do with it: the Library badged a coverage selection
     APPROVED and coverage automation submitted one as `approved-view`.
     The value moves; nothing is lost. */
  target.selectedFile = fileName;
  delete target.approvedFile;
  target.status = "selected";
  target.selectedAt = at;
  /* The record says what this was. A reader that wants to know whether a person
     chose it can see that a person chose it — and can also see that choosing is
     not approving. */
  target.assignment = {
    kind: SLOT_ASSIGNMENT_KIND,
    authoritative: false,
    by: slotText(it.by) || "human",
    via: slotText(it.via),
    at,
  };
  /* WITHDRAWN CLAIMS. These three fields are what made a slot read as an
     approval; a slot this function touches stops asserting them. Existing
     records are left alone — history is preserved — but nothing new claims it. */
  delete target.approvedAt;
  delete target.humanApproved;
  if (slotObject(target.provenance).source) target.provenance = { ...slotObject(target.provenance), authoritative: false };
  return { assigned: true, reason: "selected", previous, fileName };
}

/* Clearing is the same act in reverse and keeps the same honesty. */
function clearSlotReference(slot, request = {}) {
  const it = slotObject(request);
  const target = slotObject(slot);
  const previous = slotSelectedFile(target);
  if (!previous) return { cleared: false, reason: "already-empty" };
  target.replacementHistory = slotList(target.replacementHistory);
  target.replacementHistory.push({ from: previous, to: "", at: slotText(it.at), source: slotText(it.via) });
  target.selectedFile = "";
  delete target.approvedFile;
  target.status = "missing";
  target.assignment = { kind: SLOT_ASSIGNMENT_KIND, authoritative: false, by: slotText(it.by) || "human", via: slotText(it.via), at: slotText(it.at) };
  return { cleared: true, previous };
}

/* ---------- what a consumer is allowed to conclude ------------------------ */

/* THE PREDICATE EVERY CONSUMER ASKS INSTEAD OF READING `status === "approved"`.
 *
 * A slot with a file is USABLE as supporting context. That is the whole
 * permission. The name is long on purpose: `slotIsApproved` is the function
 * this codebase must not grow again. */
function slotUsableAsSupportingReference(slot) {
  return !!slotSelectedFile(slot) && slotText(slotObject(slot).status) !== "retired";
}

/* The role label a reference carries when a slot travels into a prompt. Stated
   so the compiler, the server reviewer and the export all say the same thing
   about what they are looking at. */
const SLOT_REFERENCE_ROLE = "supporting-view";
const SLOT_REFERENCE_NOTE = "Supporting view selected by the filmmaker. Context only — not approved production authority.";

/* THE DECISION WORDS, IN ONE PLACE.
 *
 * Renaming the word a slot commit writes left four readers behind — the AI
 * badge's "NOT ASSIGNED" suffix, the passing-assignment queue, the reference
 * inspector's outstanding count, and the human-decision renderer. Each carried
 * its own literal pair, so each went on believing a selected candidate was
 * still unassigned. Four copies of a vocabulary is how a rename half-lands, so
 * there is one copy now.
 *
 * The legacy words stay in the set on purpose: a pre-1C project has them on
 * disk, nothing rewrites them, and they mean exactly what the new words mean. */
const SLOT_SELECTION_DECISIONS = ["selected-coverage", "selected-expression", "approved-coverage", "approved-expression"];
function decisionIsSlotSelection(decision) {
  return SLOT_SELECTION_DECISIONS.includes(slotText(decision));
}

const ENTITY_SLOT_EXPORTS = {
  SLOT_GROUPS,
  SLOT_ASSIGNMENT_STATES,
  SLOT_ASSIGNMENT_KIND,
  SLOT_REFERENCE_ROLE,
  SLOT_REFERENCE_NOTE,
  SLOT_SELECTION_DECISIONS,
  decisionIsSlotSelection,
  slotSelectedFile,
  slotLegacyFile,
  slotIsAuthoritative,
  entitySlotFiles,
  assignSlotReference,
  clearSlotReference,
  slotUsableAsSupportingReference,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(ENTITY_SLOT_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = ENTITY_SLOT_EXPORTS;
