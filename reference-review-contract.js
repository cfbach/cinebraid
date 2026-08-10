/* CineBraid reference-review contract.

   Whether a candidate is ESTABLISHING the first visual authority for a scope or
   being VALIDATED against one that already exists changes every other question
   the reviewer asks. That decision, the criterion ownership it implies, and the
   classification of what comes back all live here rather than inside a route,
   so the contract can be exercised directly and cannot drift from the prompt
   that carries it.

   Pure. No filesystem, no network, no project mutation. */
const crypto = require("crypto");

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

Return ONLY valid JSON, no markdown fences:
{"score":85,"pass":true,"hardChecks":{"sameUnderlyingEntity":{"pass":true,"note":"specific comparison"},"onlyRequestedDelta":{"pass":true,"note":"specific comparison"},"sameEmbeddedContent":{"pass":true,"note":"specific comparison"},"sameSpatialGeometry":{"pass":true,"note":"specific comparison"},"requestedViewCorrect":{"pass":true,"note":"specific comparison"}},"stateMatch":{"matchesRequestedState":true,"closerState":"","note":"why this is or is not the requested state"},"categories":{"design":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"state":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"requirements":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"usefulness":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"cleanliness":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"context":{"severity":"pass|minor|major|blocking","note":"specific visible finding"}},"referenceNotes":[{"label":"reference label","note":"specific comparison"}],"summary":"concise director-facing summary","recommendation":"approve|alternate|correct|reject"}`;
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
  const hardGateFailures = requiredHardChecks.filter((key) => !hardChecks[key].returned || !hardChecks[key].pass);
  if (rank[worstSeverity] >= rank.major) hardGateFailures.push(`category:${worstSeverity}`);
  if (!stateMatch.matchesRequestedState) hardGateFailures.push("state-mismatch");
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
  if (establishing && !pass && !blockers.some((row) => row.actionability === "generation-correctable") && !blockers.some((row) => row.actionability === "workflow-prerequisite")) {
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
        : establishing
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
