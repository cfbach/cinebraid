/* CineBraid reference-review contract.

   Whether a candidate is ESTABLISHING the first visual authority for a scope or
   being VALIDATED against one that already exists changes every other question
   the reviewer asks. That decision, the criterion ownership it implies, and the
   classification of what comes back all live here rather than inside a route,
   so the contract can be exercised directly and cannot drift from the prompt
   that carries it.

   Pure. No filesystem, no network, no project mutation. */
const crypto = require("crypto");
/* The declared-entity continuity core owns CineBraid's observation vocabulary and
   its five-value outcome words. B2a needs both, and a second copy of either would
   be a second interpretation engine, so they are taken from there rather than
   restated here. shared-continuity.js is pure and has no provider, clock or I/O
   of its own, so requiring it does not compromise the line above. */
const Continuity = require("../../public/shared-continuity");
const { PRESENCE_VALUES, CONTINUITY_OUTCOMES, CONTINUITY_OUTCOME_LABELS } = Continuity;

function candidateReviewSeverity(value) {
  const normalized = String(value || "pass").toLowerCase();
  return ["pass", "minor", "major", "blocking"].includes(normalized) ? normalized : "pass";
}
/* v667 — the reference-review contract knows which job it is doing.

   A reference workflow is either ESTABLISHING the first visual authority for a
   scope or VALIDATING a candidate against one that already exists. Until this
   distinction existed the reviewer ran the validating contract in both cases,
   so the workflow whose entire purpose was to create Mara Venn's first approved
   image was blocked for having no approved image to compare against. The mode
   is derived from the inputs that were actually assembled — nothing durable
   stores it, and nothing needs to. */
const ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION = "reference-authority-v3";
const ENTITY_REFERENCE_AUTHORITY_MODES = ["establish", "validate"];
const ENTITY_REFERENCE_HARD_CHECK_KEYS = [
  "sameUnderlyingEntity",
  "onlyRequestedDelta",
  "sameEmbeddedContent",
  "sameSpatialGeometry",
  "requestedViewCorrect",
];
/* Every hard check except the requested view is a COMPARISON against supplied
   approved authority. Requiring one when no authority was supplied is the
   circular bootstrap: it can never be satisfied, so it can never be a gate. */
const ENTITY_REFERENCE_COMPARISON_CHECKS = new Set([
  "sameUnderlyingEntity",
  "onlyRequestedDelta",
  "sameEmbeddedContent",
  "sameSpatialGeometry",
]);
/* Severity is how bad a finding is. Actionability is who can act on it. They
   are independent, and conflating them is what sent "no authority exists" —
   which no prompt can repair — into the correction plan and paid another pass
   to regenerate an image against it. */
const ENTITY_REFERENCE_ACTIONABILITY = ["generation-correctable", "workflow-prerequisite", "human-decision"];
const ENTITY_REVIEW_CATEGORY_KEYS = ["design", "state", "requirements", "usefulness", "cleanliness", "context"];

/* ---------- declared state evidence (B2a) --------------------------------

   The defect this exists for: a derived state asked for a wax seal that was
   BROKEN but still present. The candidate had no seal at all. The reviewer said
   so in its own note, then answered the delta gate `pass: true`, scored 96, and
   CineBraid recorded a strong pass — because the only representation of the
   requirement anywhere in the system was prose in a prompt, and the only
   representation of the evidence was the reviewer's own conclusion about it.

   Absence is not a change to a thing. Neither is "I could not see it". The fix
   is the division the declared-entity continuity contract already runs on: the
   model OBSERVES, CineBraid COMPARES. Three answers per declared requirement,
   asked separately so that none of them can stand in for another:

     expectedFeature   what the requirement TEXT says about the feature existing
     observedFeature   what the CANDIDATE'S PIXELS say about it existing
     observedCondition whether the demanded condition is visible ON it

   Every value is a closed enum, so the comparison below is exact equality and
   never a reading of prose. Nothing here knows what a wax seal is. */
const DECLARED_STATE_EVIDENCE_VERSION = "declared-state-evidence-v1";
/* What the declared requirement says must be true of the feature's EXISTENCE.
   A requirement that changes a feature — broken, open, wet, torn, dirty — is
   `must-remain`: the feature has to still be there to be in that condition. */
const DECLARED_FEATURE_EXPECTATIONS = ["must-remain", "must-appear", "must-disappear", "not-a-feature-requirement"];
/* What the pixels say. present/absent/uncertain are the continuity contract's
   own presence vocabulary; not-applicable exists only for a clause that names no
   feature at all. */
const DECLARED_FEATURE_OBSERVATIONS = [...PRESENCE_VALUES, "not-applicable"];
const DECLARED_CONDITION_OBSERVATIONS = ["as-required", "different", "uncertain", "not-applicable"];
/* The locked characteristics CineBraid's semantic model already names. Parent
   authority is only comparable when an authority image was actually supplied,
   so this list is never consulted in establish mode. */
const PARENT_AUTHORITY_ATTRIBUTES = ["identity", "material", "color", "markings", "geometry", "design-cue", "other"];
const PARENT_AUTHORITY_ATTRIBUTE_WORDS = {
  identity: "Identity",
  material: "Material",
  color: "Colour",
  markings: "Markings",
  geometry: "Major geometry",
  "design-cue": "Distinctive design cue",
  other: "Locked characteristic",
};
/* Worst first, so one requirement's outcome can roll up into the block's. Same
   ordering the continuity workspace ranks entity cards by. */
const DECLARED_OUTCOME_RANK = { review: 4, issue: 3, uncertain: 2, expected: 1, stable: 0 };
/* An unbounded delta would send an unbounded checklist to the reviewer. What is
   dropped is reported rather than silently truncated. */
const DECLARED_REQUIREMENT_LIMIT = 12;
const DECLARED_REQUIREMENT_MAX_LENGTH = 240;
const PARENT_DRIFT_LIMIT = 12;
const DECLARED_EVIDENCE_MAX_LENGTH = 240;
const ENTITY_CANDIDATE_REVIEW_SYSTEM = `You are a strict production-reference reviewer for an AI filmmaking workflow, specializing in continuity authority. Image 1 is the candidate being judged. Any later images are labelled approved authorities. Treat approved authorities as evidence, not inspiration.

The request states an AUTHORITY MODE and you MUST obey it.

ESTABLISH_AUTHORITY — no approved visual authority exists for this scope yet, and this workflow exists to create the first one. The absence of a prior authority is EXPECTED and CORRECT. It MUST NOT reduce the score, MUST NOT set any category above "pass", MUST NOT fail any hard check, MUST NOT appear in the summary as a fault, and MUST NOT be offered as something to correct. Judge the candidate only against the written canon, the explicit target-state semantics, the required character/asset details, production-reference usefulness, and artifacts.

VALIDATE_AGAINST_AUTHORITY — approved authority images are supplied. A visually attractive image MUST FAIL when it changes the underlying character, prop, embedded photograph/artwork/text, vehicle construction, or location geometry. A continuity-state candidate MUST preserve everything except the explicitly requested delta. A location angle MUST depict the same navigable physical space: the same walls, openings, doors, windows, fixed fixtures, topology, proportions, materials and landmark placement from a different camera position. Never accept a plausible but newly invented room. A prop containing a photograph, painting, mural, poster, map, document, screen, label, card, print or other embedded content MUST retain that exact internal content unless the requested delta explicitly changes it.

CRITERION OWNERSHIP IS STRICT. Each finding belongs to exactly one criterion and you may not borrow another's:
- design — the subject's own identity and design only.
- state — whether the candidate depicts THE REQUESTED target state and no other. A candidate that is coherent but depicts a different named state is at least a major state failure.
- requirements — ONLY the subject itself: anatomy, face, body integrity, and the subject-specific marks, scars, wardrobe items and details the canon names as belonging to it. NEVER record a missing location feature, missing set-dressing, missing architecture, or a missing environmental object here. That is never an anatomy or subject-detail failure.
- context — the surrounding setting, environment, architecture, weather and world-level inclusions. Use this criterion for anything the subject does not itself own. When the target state does not explicitly require a setting, context is "pass".
- usefulness — clarity and framing as a durable production reference.
- cleanliness — rendering artifacts.

DECLARED STATE REQUIREMENTS ARE OBSERVED, NOT DECIDED. When the request lists numbered DECLARED STATE REQUIREMENTS you MUST return one "stateEvidence" record for every requirement id, and you MUST NOT decide whether the requirement is satisfied. CineBraid decides that from your observations. Answer three independent questions per requirement and never let one answer stand in for another:
- expectedFeature — what the requirement TEXT says about whether the named feature exists at all: must-remain | must-appear | must-disappear | not-a-feature-requirement. A requirement that CHANGES a feature (broken, open, wet, torn, dirty, cracked, unfastened) is must-remain: the feature must still be there in order to be in that condition.
- observedFeature — what the CANDIDATE'S PIXELS show about that feature: present | absent | uncertain | not-applicable. Report absent when the feature is not in the image. NEVER report a feature present because the requirement asks for it.
- observedCondition — whether the demanded condition is visible ON that feature: as-required | different | uncertain | not-applicable. Use uncertain whenever the region is obscured, cropped, too small, or ambiguous. Do not guess.
AN ABSENT FEATURE IS NEVER EVIDENCE THAT A REQUESTED CHANGE TO IT HAPPENED. If the requirement is that a feature is broken and that feature is not in the image, the answer is observedFeature:"absent" — it is NOT observedCondition:"as-required". The same holds for removed, missing, replaced or substituted features of every kind.

PARENT AUTHORITY DRIFT. When approved authority images are supplied, report in "parentDrift" every difference you can actually see between the candidate and the approved authority that the declared requirements do NOT ask for. Each entry is {"attribute":"identity|material|color|markings|geometry|design-cue|other","parentValue":"","candidateValue":"","evidence":""}. Report nothing you cannot see; an empty array means you observed no undeclared difference. Never report a difference the declared requirements already asked for.

Return ONLY valid JSON, no markdown fences:
{"score":85,"pass":true,"stateEvidence":[{"requirementId":"delta-1","feature":"the feature this requirement is about","expectedFeature":"must-remain","observedFeature":"present","observedCondition":"as-required","evidence":"what you can actually see"}],"parentDrift":[],"hardChecks":{"sameUnderlyingEntity":{"pass":true,"note":"specific comparison"},"onlyRequestedDelta":{"pass":true,"note":"specific comparison"},"sameEmbeddedContent":{"pass":true,"note":"specific comparison"},"sameSpatialGeometry":{"pass":true,"note":"specific comparison"},"requestedViewCorrect":{"pass":true,"note":"specific comparison"}},"stateMatch":{"matchesRequestedState":true,"closerState":"","note":"why this is or is not the requested state"},"categories":{"design":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"state":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"requirements":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"usefulness":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"cleanliness":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"context":{"severity":"pass|minor|major|blocking","note":"specific visible finding"}},"referenceNotes":[{"label":"reference label","note":"specific comparison"}],"summary":"concise director-facing summary","recommendation":"approve|alternate|correct|reject"}`;
function entityReviewStateRecord(entity, stateId) {
  const states = Array.isArray(entity?.continuityStates) ? entity.continuityStates.filter(Boolean) : [];
  const existingDefault = states.find((state) => state.isDefault);
  const defaultState = existingDefault || {
    id: "state-default",
    name: "Default",
    appliesTo: "",
    approvedFile: entity?.approvedFile || "",
    notes: "Primary project-wide appearance and design.",
    isDefault: true,
  };
  if (!stateId || stateId === "state-default") return defaultState;
  return states.find((state) => String(state.id) === String(stateId)) || defaultState;
}
function entityReviewParentState(entity, state) {
  if (!state || state.isDefault) return null;
  const states = Array.isArray(entity?.continuityStates) ? entity.continuityStates.filter(Boolean) : [];
  return states.find((item) => String(item.id) === String(state.parentStateId) && String(item.id) !== String(state.id))
    || states.find((item) => item.isDefault)
    || null;
}
function entityReviewFolder(list) {
  return { characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" }[list] || "";
}
function entityReviewType(list) {
  return { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list] || "entity";
}
/* One authoritative state block, assembled from the fields the project model
   actually carries: name, scene/shot scope, delta, and the derives-from
   relation. The compiler receives the same four facts, so review and generation
   argue about the same state rather than two paraphrases of it. */
function entityReviewStateBlock(entity, state) {
  const parentState = entityReviewParentState(entity, state);
  return [
    `TARGET CONTINUITY STATE: ${state.name || "Default"}`,
    state.appliesTo ? `STATE SCENE / SHOT SCOPE: ${state.appliesTo}. Treat this as production intent about where and when the state occurs; honour any setting it names.` : "",
    state.notes ? `STATE REQUIREMENT / DELTA: ${state.notes}` : "",
    parentState ? `DERIVES FROM: ${parentState.name || "Default"}. Preserve all parent-state features not explicitly changed by the target state.` : "",
  ].filter(Boolean).join("\n");
}
function entityReviewCanon(P, list, entity, state) {
  const common = [
    `ENTITY: ${entity.name || entity.id} (${entity.id})`,
    `TYPE: ${entityReviewType(list)}`,
    entityReviewStateBlock(entity, state),
    entity.block ? `CANON / IDENTITY: ${entity.block}` : "",
    entity.creationDescription ? `GENERATION DESCRIPTION: ${entity.creationDescription}` : "",
    entity.description ? `DESCRIPTION: ${entity.description}` : "",
    entity.notes ? `PRODUCTION NOTES: ${entity.notes}` : "",
    entity.driftNotes ? `DRIFT-PRONE DETAILS: ${entity.driftNotes}` : "",
    entity.coveragePolicy ? `LOCATION COVERAGE POLICY: ${entity.coveragePolicy}` : "",
  ];
  /* World-level facts belong to the surrounding world, not to the subject's own
     body or design. Handing them over unlabelled is how "no analog projector is
     visible" arrived as an ANATOMY failure on a character portrait. */
  const worldLines = [
    P.meta?.world?.setting ? `WORLD / ERA: ${P.meta.world.setting}` : "",
    P.meta?.world?.include ? `WORLD-LEVEL INCLUSIONS: ${P.meta.world.include}` : "",
    P.meta?.world?.reject ? `MUST NOT CONTAIN: ${P.meta.world.reject}` : "",
  ].filter(Boolean);
  const worldBlock = worldLines.length
    ? `\nWORLD CONTEXT — evaluated under the "context" criterion only\n${worldLines.join("\n")}\n${list === "characters" || list === "props" || list === "vehicles"
      ? `This is a ${entityReviewType(list)} reference, not a scene still. World-level inclusions and location features are NOT required to appear unless the target state above explicitly names them. Their absence is at most "minor" under "context" and is NEVER a design, state, requirements, anatomy, or cleanliness failure.`
      : "Judge these under the context criterion."}`
    : "";
  const factorContract = list === "characters"
    ? "FACTORS: design = identity and design; state = the requested target state and wardrobe; requirements = the character's own anatomy, face, body integrity and canon-named personal marks or worn details; context = surrounding setting, environment and world-level inclusions; usefulness = production-reference clarity; cleanliness = artifacts."
    : list === "locations"
      ? "FACTORS: design = architecture and layout; state = target time/weather/state; requirements = materials, fixtures and set dressing this location owns; context = surrounding world and era consistency; usefulness = production-reference clarity; cleanliness = artifacts."
      : list === "vehicles"
        ? "FACTORS: design = silhouette and vehicle identity; state = target condition/state; requirements = the vehicle's own components, proportions and functional details; context = surrounding setting and world-level inclusions; usefulness = production-reference clarity; cleanliness = artifacts."
        : "FACTORS: design = design, scale and materials; state = target condition/state; requirements = the prop's own functional and required details; context = surrounding setting and world-level inclusions; usefulness = production-reference clarity; cleanliness = artifacts.";
  return [...common.filter(Boolean), factorContract].join("\n") + worldBlock;
}
function entityReviewEmbeddedContentRequired(list, entity) {
  if (list !== "props") return false;
  const text = [entity?.name, entity?.id, entity?.block, entity?.description, entity?.creationDescription, entity?.notes, entity?.driftNotes]
    .filter(Boolean).join("\n").toLowerCase();
  return /\b(photo|photograph|snapshot|portrait|mural|painting|poster|artwork|illustration|print|document|newspaper|letter|map|sign|label|card|book|magazine|screen|display|tile image|emblem|logo)\b/.test(text);
}
/* A comparison gate needs something to compare against. `hasAuthority` is the
   whole condition for the four comparison checks; a derived state or a coverage
   slot only says a comparison would be MEANINGFUL, never that one is POSSIBLE.
   requestedViewCorrect stays independent: the requested view is a stated
   requirement, judgeable from the candidate alone. */
function entityReviewHardCheckRequirements(list, entity, state, coverageSlot, candidateRow, hasAuthority) {
  const required = [];
  const isDerivedState = !!state && !state.isDefault;
  if (hasAuthority) required.push("sameUnderlyingEntity");
  if (hasAuthority && isDerivedState) required.push("onlyRequestedDelta");
  if (hasAuthority && entityReviewEmbeddedContentRequired(list, entity)) required.push("sameEmbeddedContent");
  if (hasAuthority && list === "locations") required.push("sameSpatialGeometry");
  if (coverageSlot || candidateRow?.targetCoverageSlotId) required.push("requestedViewCorrect");
  return [...new Set(required)];
}
function entityReviewAuthorityMode(hasAuthority) {
  return hasAuthority ? "validate" : "establish";
}
/* Every other state this entity carries, so the reviewer can tell the requested
   state apart from one that merely looks close. "Damp inside" and "Rain-soaked
   arrival" share a wet coat; only the roster makes the difference nameable. */
function entityReviewRelatedStates(entity, state) {
  const states = Array.isArray(entity?.continuityStates) ? entity.continuityStates.filter(Boolean) : [];
  const targetId = String(state?.id || "state-default");
  const known = new Map();
  for (const item of states) {
    const id = String(item.id || "");
    if (!id || id === targetId) continue;
    known.set(id, item);
  }
  if (!states.some((item) => item.isDefault) && targetId !== "state-default" && entity?.approvedFile !== undefined) {
    known.set("state-default", { id: "state-default", name: "Default", isDefault: true, notes: "Primary project-wide appearance and design." });
  }
  return [...known.values()].map((item) => {
    const parentId = String(item.parentStateId || "");
    const relation = parentId === targetId
      ? "derives from the requested state"
      : parentId && parentId === String(state?.parentStateId || "")
        ? "shares the requested state's parent"
        : item.isDefault
          ? "the base state"
          : "another state of this entity";
    return {
      id: String(item.id || ""),
      name: String(item.name || "State"),
      appliesTo: String(item.appliesTo || ""),
      notes: String(item.notes || ""),
      relation,
    };
  });
}
function entityReviewAuthoritySignature(list, entity, state, coverageSlot, inputLabels, requiredHardChecks, authorityMode) {
  const payload = JSON.stringify({
    version: ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
    list,
    entityId: entity?.id || "",
    stateId: state?.id || "state-default",
    stateNotes: state?.notes || "",
    stateAppliesTo: state?.appliesTo || "",
    coverageSlotId: coverageSlot?.id || "",
    coverageSlotNotes: coverageSlot?.notes || "",
    authorities: (inputLabels || []).slice(1).map((row) => [row.label, row.role]),
    requiredHardChecks,
    authorityMode: authorityMode || "",
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 20);
}
const ENTITY_REVIEW_CATEGORY_LABELS = {
  design: "Identity & design",
  state: "Target state",
  requirements: "Subject-owned required details",
  usefulness: "Production-reference clarity",
  cleanliness: "Cleanliness & artifacts",
  context: "Setting & context",
};
const ENTITY_REVIEW_GATE_LABELS = {
  sameUnderlyingEntity: "Keep the exact same underlying subject/design as the approved authority",
  onlyRequestedDelta: "Apply only the requested state delta and no unrelated changes",
  sameEmbeddedContent: "Preserve the exact embedded photograph, artwork, print, text, map, or screen content",
  sameSpatialGeometry: "Preserve the exact spatial geometry, topology, openings, fixtures, and object placement",
  requestedViewCorrect: "Use the requested viewpoint while remaining spatially consistent",
};
/* ---------- what the state actually declared ------------------------------

   CineBraid owns the requirement list. The reviewer answers it; it never
   authors it, so it cannot quietly drop a requirement it would rather not meet
   or invent one it can satisfy.

   The delta is prose because productions write prose, so it is cut into clauses
   deterministically on the separators productions actually use. Over-splitting
   is harmless — each clause is answered on its own and a clause that names no
   feature says so. Under-splitting is harmless too: the requirement is still
   observed, only less finely. Only a DERIVED state has a delta; the default
   state's notes describe an appearance, not a change to one. */
function entityReviewDeclaredRequirements(state) {
  const derived = !!state && !state.isDefault;
  const text = derived ? String(state?.notes || "") : "";
  const clauses = text
    .split(/[\n;•·]+|(?<=[.!?])\s+|,\s+/g)
    .map((row) => String(row).replace(/\s+/g, " ").trim().replace(/^[-–—*\s]+/, "").replace(/[.,;:]+$/, "").trim())
    .filter((row) => row.length >= 3);
  const unique = [];
  for (const clause of clauses) {
    const key = clause.toLowerCase();
    if (unique.some((row) => row.key === key)) continue;
    unique.push({ key, text: clause.slice(0, DECLARED_REQUIREMENT_MAX_LENGTH) });
  }
  const kept = unique.slice(0, DECLARED_REQUIREMENT_LIMIT);
  return {
    requirements: kept.map((row, index) => ({ id: `delta-${index + 1}`, text: row.text })),
    /* Never a silent cap: a delta longer than the checklist says how much of
       itself was not checked. */
    omitted: Math.max(0, unique.length - kept.length),
    stateId: String(state?.id || ""),
    stateName: String(state?.name || ""),
    derived,
  };
}
/* The checklist the reviewer is handed, in the request that carries it. Written
   here rather than in the route so the wording and the parser below cannot
   drift apart. */
function entityReviewDeclaredStateContract(declared, options = {}) {
  const rows = (declared && declared.requirements) || [];
  const drift = options.hasAuthority
    ? `
Also return "parentDrift": every difference you can SEE between this candidate and the approved authority image${options.authorityCount === 1 ? "" : "s"} that the requirements above do not ask for. ${options.parentStateName ? `The authority for the unchanged features is "${options.parentStateName}". ` : ""}An empty array means you observed no undeclared difference.`
    : `
Return "parentDrift" as an empty array: no approved authority image was supplied, so there is nothing to compare unchanged features against.`;
  if (!rows.length) return declared && declared.derived ? `

DECLARED STATE REQUIREMENTS
This state records no concrete visual delta, so there is no requirement checklist. Return "stateEvidence" as an empty array.${drift}` : "";
  return `

DECLARED STATE REQUIREMENTS — OBSERVE EACH ONE, DO NOT JUDGE IT
${rows.map((row) => `- ${row.id}: ${row.text}`).join("\n")}${declared.omitted ? `\n(${declared.omitted} further clause${declared.omitted === 1 ? "" : "s"} of this delta were not put on the checklist and are not being checked here.)` : ""}
Return one "stateEvidence" record per id above, with expectedFeature, observedFeature and observedCondition answered separately. A feature that is ABSENT from the candidate never satisfies a requirement that changes it, and an unreadable region is "uncertain", never "as-required".${drift}`;
}
/* ---------- the comparison -------------------------------------------------

   One deterministic switch. It reads closed enums and nothing else: no note, no
   summary, no score, no model verdict. Outcome words are the continuity
   contract's five. */
function declaredEvidenceRecords(source) {
  const raw = Array.isArray(source?.stateEvidence)
    ? source.stateEvidence
    : Array.isArray(source?.stateEvidence?.records) ? source.stateEvidence.records : [];
  const byId = new Map();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.requirementId || row.id || "").trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, row);
  }
  return byId;
}
function judgeDeclaredRequirement(requirement, record) {
  const base = {
    id: requirement.id,
    requirement: requirement.text,
    feature: String(record?.feature || "").replace(/\s+/g, " ").trim().slice(0, 160),
    expectedFeature: DECLARED_FEATURE_EXPECTATIONS.includes(record?.expectedFeature) ? record.expectedFeature : "",
    observedFeature: DECLARED_FEATURE_OBSERVATIONS.includes(record?.observedFeature) ? record.observedFeature : "",
    observedCondition: DECLARED_CONDITION_OBSERVATIONS.includes(record?.observedCondition) ? record.observedCondition : "",
    evidence: String(record?.evidence || "").replace(/\s+/g, " ").trim().slice(0, DECLARED_EVIDENCE_MAX_LENGTH),
    returned: !!record,
  };
  const feature = base.feature || "the feature this requirement names";
  const unanswered = (detail) => ({ ...base, outcome: "review", headline: "This declared requirement was not answered", detail, recommendation: "Run the review again, or check this requirement by eye." });
  if (!record) return unanswered("The reviewer returned no observation for this requirement, so nothing was compared against it.");
  if (!base.expectedFeature || !base.observedFeature || !base.observedCondition)
    return unanswered("The reviewer's answer was not in the contract's vocabulary, so it was never compared.");
  if (base.observedFeature === "not-applicable" && base.expectedFeature !== "not-a-feature-requirement")
    return unanswered(`The requirement names ${feature}, but the reviewer answered that no feature applies. The two answers contradict each other.`);
  if (base.observedFeature === "uncertain")
    return {
      ...base, outcome: "uncertain",
      headline: `Could not tell whether ${feature} is there`,
      detail: "The candidate gave no usable answer about whether this feature is present, so the requirement could not be checked.",
      recommendation: "Confirm by eye, or generate a clearer view of this feature.",
    };
  /* The wax-seal rule, stated generally: a requirement that CHANGES a feature is
     not satisfied by that feature being gone. */
  if (base.expectedFeature === "must-remain" && base.observedFeature === "absent")
    return {
      ...base, outcome: "issue",
      headline: `${feature} is absent, and this requirement changes it rather than removing it`,
      detail: `The declared requirement is a change to ${feature}, so ${feature} must still be there to be in that condition. It is not in the candidate. An absent feature is a different state, not the declared one.`,
      recommendation: `Regenerate with ${feature} present and in the declared condition.`,
    };
  if (base.expectedFeature === "must-appear" && base.observedFeature === "absent")
    return {
      ...base, outcome: "issue",
      headline: `${feature} was required to appear and is absent`,
      detail: "The declared requirement adds this feature. The candidate does not show it.",
      recommendation: `Regenerate with ${feature} present.`,
    };
  if (base.expectedFeature === "must-disappear" && base.observedFeature === "present")
    return {
      ...base, outcome: "issue",
      headline: `${feature} was required to be gone and is still there`,
      detail: "The declared requirement removes this feature. The candidate still shows it.",
      recommendation: `Regenerate without ${feature}.`,
    };
  if (base.observedCondition === "uncertain")
    return {
      ...base, outcome: "uncertain",
      headline: `Could not read the declared condition on ${feature}`,
      detail: "The feature is there, but the condition this requirement asks for could not be read from the candidate.",
      recommendation: "Confirm by eye, or generate a clearer view of this feature.",
    };
  if (base.observedCondition === "different")
    return {
      ...base, outcome: "issue",
      headline: `${feature} is not in the declared condition`,
      detail: "The feature is present, but not in the condition this requirement asks for.",
      recommendation: "Regenerate with the declared condition applied.",
    };
  if (base.observedCondition === "not-applicable" && base.expectedFeature !== "not-a-feature-requirement" && base.expectedFeature !== "must-disappear")
    return unanswered("The reviewer reported the feature but then answered that its condition does not apply, so the requirement was never checked.");
  return {
    ...base, outcome: "expected",
    headline: base.expectedFeature === "must-disappear" ? `${feature} is gone, as declared` : `${feature} is present and in the declared condition`,
    detail: "",
    recommendation: "",
  };
}
/* Undeclared drift from the parent/base authority. Every entry the reviewer
   returns is by definition something the delta did not ask for, so it is an
   issue; an entry that says nothing usable is a question for a person. */
function judgeParentDrift(row) {
  const attribute = PARENT_AUTHORITY_ATTRIBUTES.includes(row?.attribute) ? row.attribute : "other";
  const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, 160);
  const base = {
    attribute,
    label: PARENT_AUTHORITY_ATTRIBUTE_WORDS[attribute],
    parentValue: clean(row?.parentValue),
    candidateValue: clean(row?.candidateValue),
    evidence: clean(row?.evidence).slice(0, DECLARED_EVIDENCE_MAX_LENGTH),
  };
  if (!base.parentValue || !base.candidateValue)
    return {
      ...base, outcome: "review",
      headline: `${base.label} was reported as drifted without both readings`,
      detail: "The reviewer reported a difference from the approved authority but did not give both sides of it, so it could not be compared.",
      recommendation: "Check this characteristic against the approved authority by eye.",
    };
  return {
    ...base, outcome: "issue",
    headline: `${base.label} changed without being declared`,
    detail: `The approved authority is "${base.parentValue}"; the candidate is "${base.candidateValue}". The declared state does not ask for this change, so the parent stays authoritative.`,
    recommendation: "Restore the parent's value, or declare this change as part of the state.",
  };
}
/* The block the rest of the contract, the automation loop and the UI all read.
   `applies` is false when CineBraid declared nothing and no authority was
   supplied — there is genuinely nothing to compare, and an empty comparison must
   not masquerade as a clean one. */
function evaluateDeclaredStateEvidence(source, options = {}) {
  const requirements = (Array.isArray(options.declaredRequirements) ? options.declaredRequirements : [])
    .filter((row) => row && row.id)
    .slice(0, DECLARED_REQUIREMENT_LIMIT)
    .map((row) => ({ id: String(row.id), text: String(row.text || "") }));
  const comparable = options.driftComparisonAvailable === true;
  const records = declaredEvidenceRecords(source);
  const findings = requirements.map((requirement) => judgeDeclaredRequirement(requirement, records.get(requirement.id) || null));
  const rawDrift = comparable && Array.isArray(source?.parentDrift) ? source.parentDrift : [];
  const drift = rawDrift.filter((row) => row && typeof row === "object").slice(0, PARENT_DRIFT_LIMIT).map(judgeParentDrift);
  const unmatched = [...records.keys()].filter((id) => !requirements.some((row) => row.id === id)).sort();
  const applies = requirements.length > 0 || (comparable && drift.length > 0);
  const all = [...findings, ...drift];
  const outcome = all.reduce((worst, row) => DECLARED_OUTCOME_RANK[row.outcome] > DECLARED_OUTCOME_RANK[worst] ? row.outcome : worst, "stable");
  const issues = all.filter((row) => row.outcome === "issue");
  const unresolved = all.filter((row) => row.outcome === "uncertain" || row.outcome === "review");
  return {
    version: DECLARED_STATE_EVIDENCE_VERSION,
    applies,
    comparable,
    requirements,
    findings,
    drift,
    /* Answers about requirements CineBraid never declared are discarded rather
       than believed, and the discard is recorded. */
    undeclaredAnswers: unmatched,
    omittedRequirements: Math.max(0, Number(options.omittedRequirements || 0)),
    outcome: applies ? outcome : "stable",
    label: CONTINUITY_OUTCOME_LABELS[applies ? outcome : "stable"],
    satisfied: !applies ? true : outcome === "stable" || outcome === "expected",
    issueCount: issues.length,
    unresolvedCount: unresolved.length,
  };
}
function normalizeEntityCandidateReview(parsed, options = {}) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const authorityMode = ENTITY_REFERENCE_AUTHORITY_MODES.includes(String(options.authorityMode || ""))
    ? String(options.authorityMode)
    : "validate";
  const establishing = authorityMode === "establish";
  const categories = {};
  for (const key of ENTITY_REVIEW_CATEGORY_KEYS) {
    const row = source.categories?.[key] || {};
    categories[key] = {
      severity: candidateReviewSeverity(row.severity),
      note: String(row.note || "").trim(),
    };
  }
  const rank = { pass: 0, minor: 1, major: 2, blocking: 3 };
  const worstSeverity = Object.values(categories).reduce((current, row) => rank[row.severity] > rank[current] ? row.severity : current, "pass");
  const explicitPass = typeof source.pass === "boolean";
  const modelPass = source.pass === true;
  const explicitScore = source.score !== null && source.score !== "" && typeof source.score !== "undefined" && Number.isFinite(Number(source.score));
  const score = Math.max(0, Math.min(100, explicitScore ? Number(source.score) : 0));
  const requiredHardChecks = [...new Set((options.requiredHardChecks || []).filter((key) => ENTITY_REFERENCE_HARD_CHECK_KEYS.includes(key)))];
  const hardChecks = {};
  for (const key of ENTITY_REFERENCE_HARD_CHECK_KEYS) {
    const row = source.hardChecks?.[key];
    hardChecks[key] = {
      pass: row?.pass === true,
      note: String(row?.note || "").trim(),
      required: requiredHardChecks.includes(key),
      returned: !!row && typeof row === "object" && typeof row.pass === "boolean",
    };
  }
  /* A candidate can be beautiful and still be the wrong state. The reviewer
     names the state it actually matches; CineBraid never reassigns it. */
  const rawMatch = source.stateMatch && typeof source.stateMatch === "object" ? source.stateMatch : {};
  const stateMatch = {
    matchesRequestedState: rawMatch.matchesRequestedState !== false,
    returned: typeof rawMatch.matchesRequestedState === "boolean",
    closerState: String(rawMatch.closerState || "").trim(),
    note: String(rawMatch.note || "").trim(),
  };
  /* B2a. The declared requirements CineBraid handed over, compared against what
     the reviewer actually observed. Computed before any gate is decided, because
     a semantic mismatch is a gate in its own right and must not be reachable
     around by a high score or a self-declared pass. */
  const stateEvidence = evaluateDeclaredStateEvidence(source, options);
  const hardGateFailures = requiredHardChecks.filter((key) => !hardChecks[key].returned || !hardChecks[key].pass);
  if (rank[worstSeverity] >= rank.major) hardGateFailures.push(`category:${worstSeverity}`);
  if (!stateMatch.matchesRequestedState) hardGateFailures.push("state-mismatch");
  if (stateEvidence.applies && stateEvidence.issueCount) hardGateFailures.push("declared-state-unsatisfied");
  /* Uncertainty stays uncertainty. It is not a pass and it is not a fault. */
  if (stateEvidence.applies && stateEvidence.unresolvedCount) hardGateFailures.push("declared-state-unresolved");
  if (!explicitScore || score < 85) hardGateFailures.push("score-below-85");
  if (!explicitPass || !modelPass) hardGateFailures.push("model-did-not-pass");
  const uniqueFailures = [...new Set(hardGateFailures)];
  const pass = uniqueFailures.length === 0;

  /* Classification. Severity said how bad; this says who can act. Only
     generation-correctable findings are allowed to buy another paid pass. */
  const blockers = [];
  const addBlocker = (key, label, note, severity, actionability) => {
    if (blockers.some((row) => row.key === key)) return;
    blockers.push({ key, label, note: String(note || "").trim(), severity, actionability });
  };
  for (const key of requiredHardChecks) {
    const row = hardChecks[key];
    if (row.pass && row.returned) continue;
    /* A required comparison gate that the reviewer could not answer is a missing
       input, not a bad image. No prompt revision can produce the authority. */
    const unanswerable = ENTITY_REFERENCE_COMPARISON_CHECKS.has(key) && establishing;
    addBlocker(
      `gate:${key}`,
      ENTITY_REVIEW_GATE_LABELS[key] || key,
      row.note || (row.returned ? "" : "The reviewer did not return this mandatory check."),
      "blocking",
      unanswerable ? "workflow-prerequisite" : "generation-correctable",
    );
  }
  if (!stateMatch.matchesRequestedState) {
    addBlocker(
      "state:mismatch",
      stateMatch.closerState
        ? `Candidate matches the related state "${stateMatch.closerState}" rather than the requested state`
        : "Candidate does not depict the requested continuity state",
      stateMatch.note,
      "blocking",
      "generation-correctable",
    );
  }
  for (const [key, row] of Object.entries(categories)) {
    if (rank[row.severity] < rank.major) continue;
    addBlocker(`category:${key}`, ENTITY_REVIEW_CATEGORY_LABELS[key] || key, row.note, row.severity, "generation-correctable");
  }
  /* A requirement the candidate does not satisfy is something a corrected prompt
     can act on. A requirement nobody could READ is not — no prompt reliably buys
     certainty, and letting uncertainty buy a paid pass is how a loop spends money
     on its own blind spots. It goes to a person instead. */
  for (const finding of stateEvidence.findings) {
    if (finding.outcome === "issue")
      addBlocker(`declared-state:${finding.id}`, finding.headline, `${finding.requirement} — ${finding.detail}`, "blocking", "generation-correctable");
    else if (finding.outcome === "uncertain" || finding.outcome === "review")
      addBlocker(`declared-state:${finding.id}`, finding.headline, `${finding.requirement} — ${finding.detail}`, "major", "human-decision");
  }
  for (const row of stateEvidence.drift) {
    if (row.outcome === "issue")
      addBlocker(`parent-authority:${row.attribute}`, row.headline, row.detail, "blocking", "generation-correctable");
    else addBlocker(`parent-authority:${row.attribute}`, row.headline, row.detail, "major", "human-decision");
  }
  /* A derived state is defined as a delta FROM something. With no authority in
     hand there is nothing to measure the delta against, and no image a prompt
     could produce would change that — it is a missing project input, and the
     workflow must say so instead of buying another pass. */
  if (establishing && options.derivedState) {
    addBlocker(
      "authority:missing-parent",
      "The approved parent-state reference needed to verify this delta is not available",
      `${options.parentStateName ? `Approve a ${options.parentStateName} reference first.` : "Approve the parent state's reference first."} Generation cannot supply the comparison authority this state is defined against.`,
      "blocking",
      "workflow-prerequisite",
    );
  }
  /* An unresolved observation is not a clean candidate waiting for a signature.
     Without this the establish branch below would offer "ready to establish
     authority" over evidence nobody could read. */
  const evidenceUnresolved = stateEvidence.applies && stateEvidence.unresolvedCount > 0;
  if (establishing && !pass && !evidenceUnresolved && !blockers.some((row) => row.actionability === "generation-correctable") && !blockers.some((row) => row.actionability === "workflow-prerequisite")) {
    addBlocker(
      "authority:establish",
      "This candidate would establish the first approved authority for this reference",
      "No approved visual authority exists for this scope yet and no generation-correctable fault was found. Establishing the first authority is a human decision.",
      "pass",
      "human-decision",
    );
  }
  const correctable = blockers.filter((row) => row.actionability === "generation-correctable");
  const prerequisites = blockers.filter((row) => row.actionability === "workflow-prerequisite");
  const outcome = pass
    ? "validated-strong"
    : correctable.length
      ? "correctable"
      : prerequisites.length
        ? "prerequisite-blocked"
        : establishing && !evidenceUnresolved
          ? "ready-to-establish-authority"
          : "human-decision";

  let recommendation = ["approve", "alternate", "correct", "reject"].includes(String(source.recommendation || "").toLowerCase())
    ? String(source.recommendation).toLowerCase()
    : pass ? "approve" : "correct";
  if (!pass && recommendation === "approve") recommendation = rank[worstSeverity] >= rank.blocking ? "reject" : "correct";
  return {
    contractVersion: ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
    authoritySignature: String(options.authoritySignature || ""),
    authorityMode,
    score,
    pass,
    modelPass,
    explicitPass,
    explicitScore,
    autoApprove: pass,
    worstSeverity,
    requiredHardChecks,
    hardChecks,
    hardGateFailures: uniqueFailures,
    stateMatch,
    /* Declared expectation beside observed evidence, per requirement, already
       classified. The UI renders these words; it never re-decides them. */
    stateEvidence,
    /* The semantic answer, kept as its own field so no caller has to infer it
       from the score. A high score can never make this one say "stable". */
    semanticOutcome: stateEvidence.outcome,
    semanticLabel: stateEvidence.label,
    semanticSatisfied: stateEvidence.satisfied,
    categories,
    blockers,
    outcome,
    /* The two questions the automation loop asks before spending again. */
    generationCorrectable: correctable.length > 0,
    readyToEstablishAuthority: outcome === "ready-to-establish-authority",
    referenceNotes: (Array.isArray(source.referenceNotes) ? source.referenceNotes : []).slice(0, 12).map((row) => ({
      label: String(row?.label || "Reference").trim(),
      note: String(row?.note || "").trim(),
    })).filter((row) => row.note),
    summary: String(source.summary || "").trim(),
    recommendation,
  };
}

module.exports = {
  ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
  ENTITY_REFERENCE_AUTHORITY_MODES,
  ENTITY_REFERENCE_HARD_CHECK_KEYS,
  ENTITY_REFERENCE_COMPARISON_CHECKS,
  ENTITY_REFERENCE_ACTIONABILITY,
  ENTITY_REVIEW_CATEGORY_KEYS,
  ENTITY_REVIEW_CATEGORY_LABELS,
  ENTITY_REVIEW_GATE_LABELS,
  ENTITY_CANDIDATE_REVIEW_SYSTEM,
  DECLARED_STATE_EVIDENCE_VERSION,
  DECLARED_FEATURE_EXPECTATIONS,
  DECLARED_FEATURE_OBSERVATIONS,
  DECLARED_CONDITION_OBSERVATIONS,
  PARENT_AUTHORITY_ATTRIBUTES,
  PARENT_AUTHORITY_ATTRIBUTE_WORDS,
  DECLARED_REQUIREMENT_LIMIT,
  CONTINUITY_OUTCOMES,
  CONTINUITY_OUTCOME_LABELS,
  entityReviewDeclaredRequirements,
  entityReviewDeclaredStateContract,
  judgeDeclaredRequirement,
  judgeParentDrift,
  evaluateDeclaredStateEvidence,
  candidateReviewSeverity,
  entityReviewStateRecord,
  entityReviewParentState,
  entityReviewFolder,
  entityReviewType,
  entityReviewStateBlock,
  entityReviewCanon,
  entityReviewEmbeddedContentRequired,
  entityReviewHardCheckRequirements,
  entityReviewAuthorityMode,
  entityReviewRelatedStates,
  entityReviewAuthoritySignature,
  normalizeEntityCandidateReview,
};
