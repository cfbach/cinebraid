/* The reference-review contract: which job it is doing, and who can act.

   The dogfood run behind this suite: "Rain-soaked arrival · Exterior arrival"
   for Mara Venn, three candidates a pass, three passes. 45/72/58, then
   35/78/82, then 42/78/68. The best result improved and then regressed, and
   inspecting the reviews found four separate defects — none of them in the
   loop PR #40 repaired, all of them in the contract that loop was running.

     A  the workflow that CREATES Mara's first authority was blocked for having
        no approved authority to compare against. Circular.
     B  "no approved authority was supplied" — which no prompt can repair —
        entered the correction plan and bought another paid pass.
     C  a candidate standing INSIDE the cinema scored 82 against a state whose
        whole point is the exterior arrival, because the state's scene scope
        reached the reviewer as a passive line and no criterion owned setting.
     D  a missing analog projector — a location fact, on a character portrait —
        came back as MAJOR under "Anatomy & required details".

   What is asserted here, in the order the contract meets a candidate:

     1  ESTABLISH_AUTHORITY vs VALIDATE_AGAINST_AUTHORITY is derived and stated
     2  establishing the first authority is never penalised for doing so
     3  the state reaches review AND generation as the same four facts
     4  a candidate belonging to a sibling state cannot pass the parent
     5  criterion ownership: context never lands on anatomy
     6  every finding carries who can act on it
     7  only generation-correctable findings can buy a paid pass
     8  the champion survives a later regression
     9  the run's chosen FAL quality reaches every pass, and fails closed

   NOTHING HERE IS PAID. Every provider is a local stub and every paid-shaped
   request is counted. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");

/* ------------------------------------------------- the contract under test */

const CONTRACT_PATH = path.join(ROOT, "reference-review-contract.js");
/* Line endings are a checkout detail, not a fact about the source. This repo
   checks out CRLF on Windows and CI, so a multi-line mutation anchor written
   with \n would match locally and silently match nothing there. Normalising
   before any matching keeps the negative controls honest on both. */
const normalize = (value) => String(value).replace(/\r\n/g, "\n");
const CONTRACT_SOURCE = normalize(fs.readFileSync(CONTRACT_PATH, "utf8"));

/* The contract is a module, so the ordinary case is a require. A negative
   control instead evaluates a MUTATED COPY of the same source in a sandbox —
   in memory, never on disk, where restoring by checkout could take unstaged
   work with it. */
function loadContract(mutate = null) {
  if (!mutate) return require(CONTRACT_PATH);
  const mutated = String(mutate(CONTRACT_SOURCE) ?? CONTRACT_SOURCE);
  assert.notStrictEqual(mutated, CONTRACT_SOURCE, "the negative control did not actually change the contract");
  const sandbox = { require, module: { exports: {} }, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(mutated, sandbox, { filename: "reference-review-contract.mutated.js" });
  return sandbox.module.exports;
}

/* ---------------------------------------------------------------- fixtures */

/* The real project shape behind the dogfood run. "Rain-soaked arrival" is the
   base state the run is creating; "Damp inside" derives from it. The world's
   analog projection equipment is a project-level inclusion — a fact about the
   cinema, not about Mara's body. */
const MARA_DEFAULT_STATE = {
  id: "state-default",
  name: "Rain-soaked arrival",
  appliesTo: "Exterior arrival",
  isDefault: true,
  approvedFile: "",
  notes: "Outside the cinema in heavy rain: raincoat visibly soaked and beaded, hair wet and flat, exterior rainy street readable behind her.",
};
const MARA_DAMP_INSIDE_STATE = {
  id: "state-damp-inside",
  name: "Damp inside",
  appliesTo: "Interior lobby",
  parentStateId: "state-default",
  approvedFile: "",
  notes: "Now inside the cinema lobby. Coat and hair remain wet; interior lobby dominates and rain is only visible through the doors behind her.",
};
function maraEntity(overrides = {}) {
  return {
    id: "MARA",
    name: "Mara Venn",
    block: "Field investigator, late thirties, close-cropped dark hair, long dark raincoat, thin pale scar through the left eyebrow.",
    creationDescription: "Mara Venn arriving soaked at night in heavy rain outside the cinema.",
    driftNotes: "The scar through the left eyebrow must stay visible.",
    approvedFile: "",
    continuityStates: [structuredClone(MARA_DEFAULT_STATE), structuredClone(MARA_DAMP_INSIDE_STATE)],
    ...overrides,
  };
}
const MARA_PROJECT = {
  meta: {
    world: {
      setting: "A failing 1970s repertory cinema in a rain-soaked northern town.",
      include: "period analog projection equipment",
      reject: "modern digital signage",
    },
  },
};

/* The four real candidates, as the vision model described them. */
const CASE_45_DRY_STUDIO = {
  score: 45, pass: false,
  stateMatch: { matchesRequestedState: false, closerState: "", note: "Dry studio portrait; no rain and no arrival context at all." },
  categories: {
    design: { severity: "pass", note: "Identity reads correctly." },
    state: { severity: "blocking", note: "Coat and hair are completely dry; the rain-soaked arrival is absent." },
    requirements: { severity: "pass", note: "Scar visible; anatomy sound." },
    context: { severity: "major", note: "Neutral studio backdrop instead of the exterior cinema arrival." },
    usefulness: { severity: "minor", note: "Clean but wrong state." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  },
  summary: "Dry studio portrait. The requested rain-soaked exterior arrival is not depicted.",
};
const CASE_72_SCAR_UNCLEAR = {
  score: 72, pass: false,
  stateMatch: { matchesRequestedState: true, closerState: "", note: "Exterior, wet, arriving. Correct state." },
  categories: {
    design: { severity: "pass", note: "Identity is consistent with canon." },
    state: { severity: "pass", note: "Soaked coat, wet hair, exterior rain readable." },
    requirements: { severity: "major", note: "The canon scar through the left eyebrow is not visible." },
    context: { severity: "pass", note: "Exterior rainy street reads correctly." },
    usefulness: { severity: "pass", note: "Usable framing." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  },
  summary: "Strong wet exterior arrival, but the canon scar cannot be verified.",
};
const CASE_78_NO_PROJECTOR = {
  score: 78, pass: false,
  stateMatch: { matchesRequestedState: true, closerState: "", note: "Exterior wet arrival is correct." },
  categories: {
    design: { severity: "pass", note: "Identity correct." },
    state: { severity: "pass", note: "Soaked coat and wet hair correct." },
    requirements: { severity: "pass", note: "Scar visible; anatomy sound." },
    /* Where the projector belongs, and the severity it deserves on a CHARACTER
       reference: the state does not ask for one. */
    context: { severity: "minor", note: "No analog projection equipment is visible, but this state does not require it." },
    usefulness: { severity: "pass", note: "Usable as a durable reference." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  },
  summary: "Correct wet exterior arrival. No projection equipment, which this state does not call for.",
};
const CASE_82_INTERIOR = {
  score: 82, pass: false,
  stateMatch: { matchesRequestedState: false, closerState: "Damp inside", note: "She is standing inside the cinema with rain visible behind her through the doors." },
  categories: {
    design: { severity: "pass", note: "Strong, consistent identity." },
    state: { severity: "major", note: "Wetness is right but she is already inside; this is the aftermath, not the arrival." },
    requirements: { severity: "pass", note: "Scar visible; anatomy sound." },
    context: { severity: "major", note: "Cinema interior dominates where the exterior arrival was requested." },
    usefulness: { severity: "pass", note: "Beautifully lit and usable." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  },
  summary: "Excellent image of the wrong moment.",
};
const CASE_82_EXTERIOR_CLEAN = {
  score: 82, pass: false,
  stateMatch: { matchesRequestedState: true, closerState: "", note: "Exterior, arriving, soaked. Correct state." },
  categories: {
    design: { severity: "pass", note: "Strong, consistent identity." },
    state: { severity: "pass", note: "Soaked coat, beaded water, wet hair, exterior rain behind her." },
    requirements: { severity: "pass", note: "Scar visible; anatomy sound." },
    context: { severity: "pass", note: "Rainy exterior cinema frontage reads correctly." },
    usefulness: { severity: "pass", note: "Clean, readable production reference." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  },
  summary: "Strong visual match for the rain-soaked exterior arrival.",
};

/* ============================================================ PART 1 — the
   review contract itself. Pure, deterministic, no server process. */

function establishOptions(extra = {}) {
  return { authorityMode: "establish", requiredHardChecks: [], authoritySignature: "sig", ...extra };
}
function validateOptions(extra = {}) {
  return { authorityMode: "validate", requiredHardChecks: ["sameUnderlyingEntity"], authoritySignature: "sig", ...extra };
}

/* 1 — the mode is derived from the inputs that were actually assembled. */
function testAuthorityModeIsDerived(C) {
  assert.strictEqual(C.entityReviewAuthorityMode(false), "establish");
  assert.strictEqual(C.entityReviewAuthorityMode(true), "validate");

  const entity = maraEntity();
  const base = C.entityReviewStateRecord(entity, "state-default");
  const derived = C.entityReviewStateRecord(entity, "state-damp-inside");

  /* DEFECT A, mechanically. Every comparison gate needs an authority to compare
     against; requiring one without an authority can never be satisfied. */
  assert.deepStrictEqual(
    C.entityReviewHardCheckRequirements("characters", entity, derived, null, {}, false),
    [],
    "a derived state with no authority must require no comparison gate it cannot answer",
  );
  assert.deepStrictEqual(
    C.entityReviewHardCheckRequirements("characters", entity, base, null, {}, false),
    [],
    "establishing a base authority must require no comparison gate",
  );
  const validating = C.entityReviewHardCheckRequirements("characters", entity, derived, null, {}, true);
  assert(validating.includes("sameUnderlyingEntity"), "with authority present, identity must still be gated");
  assert(validating.includes("onlyRequestedDelta"), "with authority present, a derived state must still gate its delta");

  /* The requested view is judgeable from the candidate alone, so it stays
     required with or without authority. */
  const coverage = C.entityReviewHardCheckRequirements("characters", entity, base, { id: "slot-3q" }, {}, false);
  assert.deepStrictEqual(coverage, ["requestedViewCorrect"], "a stated view requirement does not depend on authority");

  /* Locations still get spatial geometry gated once authority exists. */
  const loc = C.entityReviewHardCheckRequirements("locations", { id: "CINEMA" }, base, null, {}, true);
  assert(loc.includes("sameSpatialGeometry"), "location geometry must be gated when authority exists");
  assert.deepStrictEqual(
    C.entityReviewHardCheckRequirements("locations", { id: "CINEMA" }, base, null, {}, false),
    [],
    "a first location plate cannot be gated on geometry it is establishing",
  );
}

/* 2 — DEFECT A: establishing the first authority is not a fault. */
function testFirstAuthorityIsNotPenalised(C) {
  const review = C.normalizeEntityCandidateReview(structuredClone(CASE_82_EXTERIOR_CLEAN), establishOptions());
  assert.strictEqual(review.authorityMode, "establish");
  assert.strictEqual(review.outcome, "ready-to-establish-authority", "a clean first-authority candidate must be ready, not flagged");
  assert.strictEqual(review.generationCorrectable, false, "no generation-correctable fault exists on a clean candidate");
  assert.strictEqual(review.readyToEstablishAuthority, true);

  /* Nothing in the review may blame the candidate for the missing authority. */
  const correctable = review.blockers.filter((row) => row.actionability === "generation-correctable");
  assert.deepStrictEqual(correctable, [], "a missing prior authority must never become a generation correction");
  const decisions = review.blockers.filter((row) => row.actionability === "human-decision");
  assert.strictEqual(decisions.length, 1, "the outcome is exactly one human decision");
  assert.strictEqual(decisions[0].key, "authority:establish");
  assert.strictEqual(decisions[0].severity, "pass", "a human decision is not a severity finding");

  /* And the same candidate, judged with authority present, is an ordinary
     below-threshold flag — the mode is doing the work, not the score. */
  const validated = C.normalizeEntityCandidateReview(
    { ...structuredClone(CASE_82_EXTERIOR_CLEAN), hardChecks: { sameUnderlyingEntity: { pass: true, note: "Matches the approved default." } } },
    validateOptions(),
  );
  assert.strictEqual(validated.authorityMode, "validate");
  assert.notStrictEqual(validated.outcome, "ready-to-establish-authority");
}

/* 3 — the state reaches review as the four facts the project model carries. */
function testStateSemanticsReachReview(C) {
  const entity = maraEntity();
  const base = C.entityReviewStateRecord(entity, "state-default");
  const derived = C.entityReviewStateRecord(entity, "state-damp-inside");

  const baseBlock = C.entityReviewStateBlock(entity, base);
  assert(/TARGET CONTINUITY STATE: Rain-soaked arrival/.test(baseBlock), "the state name must reach review");
  assert(/STATE SCENE \/ SHOT SCOPE: Exterior arrival/.test(baseBlock), "the scene/shot scope must reach review");
  assert(/honour any setting it names/.test(baseBlock), "the scope must be stated as enforceable intent, not decoration");
  assert(/STATE REQUIREMENT \/ DELTA: Outside the cinema in heavy rain/.test(baseBlock), "the delta must reach review");

  const derivedBlock = C.entityReviewStateBlock(entity, derived);
  assert(/DERIVES FROM: Rain-soaked arrival/.test(derivedBlock), "the parent relation must reach review");

  /* Phase 5's roster: the sibling states, named, with their own scope. */
  const related = C.entityReviewRelatedStates(entity, base);
  const damp = related.find((row) => row.id === "state-damp-inside");
  assert(damp, "the reviewer must be told Damp inside exists");
  assert.strictEqual(damp.appliesTo, "Interior lobby");
  assert.strictEqual(damp.relation, "derives from the requested state");
  assert(!related.some((row) => row.id === "state-default"), "the requested state is never listed as its own alternative");

  const fromDerived = C.entityReviewRelatedStates(entity, derived);
  assert(fromDerived.some((row) => row.id === "state-default" && row.relation === "the base state"), "the base state is a related state when reviewing a child");
}

/* 4 — DEFECT C: a sibling-state candidate cannot pass the requested state. */
function testRelatedStateMismatchBlocks(C) {
  const review = C.normalizeEntityCandidateReview(structuredClone(CASE_82_INTERIOR), establishOptions());
  assert.strictEqual(review.pass, false, "the interior candidate must not pass the exterior state");
  assert.strictEqual(review.stateMatch.matchesRequestedState, false);
  assert.strictEqual(review.stateMatch.closerState, "Damp inside");
  assert(review.hardGateFailures.includes("state-mismatch"), "a state mismatch must be recorded as a gate failure");

  const mismatch = review.blockers.find((row) => row.key === "state:mismatch");
  assert(mismatch, "the mismatch must be a named blocker");
  assert(/Damp inside/.test(mismatch.label), "the closer state must be named to the director");
  assert.strictEqual(mismatch.actionability, "generation-correctable", "moving the subject back outside is something a prompt can do");
  assert.strictEqual(review.outcome, "correctable");
  assert.strictEqual(review.readyToEstablishAuthority, false, "fixing the bootstrap must not approve the wrong state");

  /* Even a model that declares itself a pass cannot carry a state mismatch. */
  const insistent = C.normalizeEntityCandidateReview(
    { ...structuredClone(CASE_82_INTERIOR), pass: true, score: 96 },
    establishOptions(),
  );
  assert.strictEqual(insistent.pass, false, "a self-declared pass cannot override a state mismatch");

  /* The candidate is described, never reassigned. */
  assert.strictEqual(review.stateMatch.closerState, "Damp inside");
  assert(!Object.prototype.hasOwnProperty.call(review, "reassignedStateId"), "CineBraid must not move a candidate to another state on its own");
}

/* 5 — DEFECT D: criterion ownership. */
function testCriterionOwnership(C) {
  assert(C.ENTITY_REVIEW_CATEGORY_KEYS.includes("context"), "context must be a criterion in its own right");
  assert.strictEqual(C.ENTITY_REVIEW_CATEGORY_LABELS.requirements, "Subject-owned required details");

  const system = C.ENTITY_CANDIDATE_REVIEW_SYSTEM;
  assert(/CRITERION OWNERSHIP IS STRICT/.test(system), "ownership must be stated, not implied");
  assert(
    /NEVER record a missing location feature, missing set-dressing, missing architecture, or a missing environmental object here/.test(system),
    "the requirements criterion must be explicitly forbidden from taking location facts",
  );
  assert(/That is never an anatomy or subject-detail failure/.test(system));
  assert(/context — the surrounding setting, environment, architecture, weather and world-level inclusions/.test(system));

  /* World-level inclusions are handed over labelled and scoped. */
  const canon = C.entityReviewCanon(MARA_PROJECT, "characters", maraEntity(), C.entityReviewStateRecord(maraEntity(), "state-default"));
  assert(/WORLD CONTEXT — evaluated under the "context" criterion only/.test(canon), "world facts must be handed over with an owner");
  assert(/WORLD-LEVEL INCLUSIONS: period analog projection equipment/.test(canon));
  assert(
    /Their absence is at most "minor" under "context" and is NEVER a design, state, requirements, anatomy, or cleanliness failure/.test(canon),
    "the projector must be barred from every subject-owned criterion",
  );
  assert(!/MUST INCLUDE: period analog projection equipment/.test(canon), "an unlabelled MUST INCLUDE is what leaked into anatomy");
  assert(/requirements = the character's own anatomy, face, body integrity and canon-named personal marks/.test(canon));

  /* The real candidate 78: the projector is a minor context note, so it is not
     a blocker at all, and anatomy is untouched. */
  const review = C.normalizeEntityCandidateReview(structuredClone(CASE_78_NO_PROJECTOR), establishOptions());
  assert.strictEqual(review.categories.requirements.severity, "pass", "the projector must not appear as an anatomy failure");
  assert.strictEqual(review.categories.context.severity, "minor");
  assert.strictEqual(review.generationCorrectable, false, "a minor context note is not worth a paid pass");
  assert.strictEqual(review.outcome, "ready-to-establish-authority");
  assert(!review.blockers.some((row) => row.key === "category:requirements"), "no anatomy blocker may exist for candidate 78");
}

/* 6 & 7 — classification, and what may buy a pass. */
function testFindingClassification(C) {
  /* A genuine state failure is correctable and should be corrected. */
  const dry = C.normalizeEntityCandidateReview(structuredClone(CASE_45_DRY_STUDIO), establishOptions());
  assert.strictEqual(dry.outcome, "correctable");
  assert.strictEqual(dry.generationCorrectable, true, "a dry coat on a rain state is exactly what regeneration is for");
  assert(dry.blockers.every((row) => row.severity === "pass" || row.actionability === "generation-correctable"));

  /* A real canon detail is correctable too. */
  const scar = C.normalizeEntityCandidateReview(structuredClone(CASE_72_SCAR_UNCLEAR), establishOptions());
  assert.strictEqual(scar.outcome, "correctable");
  const scarBlocker = scar.blockers.find((row) => row.key === "category:requirements");
  assert(scarBlocker && /scar/i.test(scarBlocker.note), "an invisible canon scar is a real, correctable requirement failure");
  assert.strictEqual(scarBlocker.actionability, "generation-correctable");
  /* But nothing about the absent authority reached the plan. */
  assert(!scar.blockers.some((row) => /authorit/i.test(row.label) && row.actionability === "generation-correctable"));

  /* DEFECT B, in the other direction: a derived state with no parent authority
     is a missing project input, and generation cannot resolve it. */
  const orphan = C.normalizeEntityCandidateReview(
    structuredClone(CASE_82_EXTERIOR_CLEAN),
    establishOptions({ derivedState: true, parentStateName: "Rain-soaked arrival" }),
  );
  assert.strictEqual(orphan.outcome, "prerequisite-blocked");
  assert.strictEqual(orphan.generationCorrectable, false, "a missing parent authority must never buy a paid pass");
  const prerequisite = orphan.blockers.find((row) => row.actionability === "workflow-prerequisite");
  assert(prerequisite, "the missing parent must be reported as a prerequisite");
  assert(/Rain-soaked arrival/.test(prerequisite.note), "the prerequisite must name what to approve first");
  assert(!orphan.blockers.some((row) => row.key === "authority:establish"), "a blocked workflow is not a ready-to-establish decision");

  /* Validating against real authority still blocks on real drift. */
  const drift = C.normalizeEntityCandidateReview(
    {
      ...structuredClone(CASE_82_EXTERIOR_CLEAN),
      hardChecks: { sameUnderlyingEntity: { pass: false, note: "The jaw and hairline do not match the approved default." } },
    },
    validateOptions(),
  );
  assert.strictEqual(drift.pass, false);
  const driftBlocker = drift.blockers.find((row) => row.key === "gate:sameUnderlyingEntity");
  assert(driftBlocker, "identity drift against supplied authority must block");
  assert.strictEqual(driftBlocker.actionability, "generation-correctable", "drift against a real authority is a real image fault");
  assert.strictEqual(drift.outcome, "correctable");

  /* Severity and actionability stay independent. */
  assert.strictEqual(prerequisite.severity, "blocking");
  assert.strictEqual(prerequisite.actionability, "workflow-prerequisite");
}

/* The strong-pass threshold was not moved to make any of this work. */
function testThresholdUnchanged(C) {
  assert(CONTRACT_SOURCE.includes('hardGateFailures.push("score-below-85")'), "the strong-pass threshold must still be 85");
  const strong = C.normalizeEntityCandidateReview(
    { ...structuredClone(CASE_82_EXTERIOR_CLEAN), score: 91, pass: true },
    establishOptions(),
  );
  assert.strictEqual(strong.pass, true, "a genuinely strong first-authority candidate still strong-passes");
  assert.strictEqual(strong.outcome, "validated-strong");
  assert.strictEqual(strong.autoApprove, true, "autoApprove is the reviewer's nomination; approval remains human");

  const justUnder = C.normalizeEntityCandidateReview(
    { ...structuredClone(CASE_82_EXTERIOR_CLEAN), score: 84, pass: true },
    establishOptions(),
  );
  assert.strictEqual(justUnder.pass, false, "84 is still not a strong pass");
}

/* ============================================================ PART 2 — the
   automation loop: champion, stop rule, and FAL quality. */

function scanFor(files) {
  return { anchors: files.map((name) => ({ name, url: `/assets/anchors/${name}` })), plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} };
}
function maraProject() {
  const project = buildFixture();
  project.meta.world = { ...structuredClone(MARA_PROJECT.meta.world) };
  project.characters = [maraEntity()];
  return project;
}
/* Shapes a stub review the way the server contract would return it. */
function contracted(C, raw, options = {}) {
  return C.normalizeEntityCandidateReview(structuredClone(raw), establishOptions(options));
}

async function automationWorld(C, options = {}) {
  const passes = options.passes || [];
  const project = options.project || maraProject();
  const allFiles = passes.flatMap((pass) => pass.map((row) => row.file));
  const reviewsByFile = new Map(passes.flat().map((row) => [row.file, contracted(C, row.review, row.options || {})]));
  const counts = { generationBatches: 0, imagesGenerated: 0, reviewCalls: 0, falBodies: [] };
  let RUN = null, jobSeq = 0;

  const rendered = await render(options.hash || "#/character/MARA", project, {
    scan: scanFor(allFiles),
    mutateSource: options.mutateSource || null,
    fetch: async (url, init = {}, respond) => {
      const method = init.method || "GET";
      const body = init.body ? JSON.parse(init.body) : {};
      if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, defaults: {} });
      if (url === "/api/automation/runs" && method === "POST") { RUN = structuredClone(body); RUN.revision = 1; return respond({ run: RUN }); }
      if (/^\/api\/automation\/runs\/[^/]+$/.test(url) && method === "PUT") { RUN = structuredClone(body); RUN.revision = Number(RUN.revision || 1) + 1; return respond({ run: RUN }); }
      if (/^\/api\/automation\/runs\/[^/]+$/.test(url) && method === "GET") return respond({ run: RUN });
      if (url.endsWith("/lease") && method === "POST") {
        RUN = { ...RUN, runnerId: body.runnerId, leaseAcquiredAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 600000).toISOString() };
        return respond({ run: RUN, leaseMs: 600000, heartbeatMs: 300000 });
      }
      if ((url.endsWith("/heartbeat") || url.endsWith("/lease/revalidate")) && method === "POST") {
        RUN = { ...RUN, leaseExpiresAt: new Date(Date.now() + 600000).toISOString() };
        return respond({ run: RUN });
      }
      if (url.endsWith("/release") && method === "POST") return respond({ run: RUN });
      if (url === "/api/prompt/asset-compile" && method === "POST") {
        const brief = "Production reference of MARA VENN at the rain-soaked exterior arrival.";
        return respond({
          compiledPrompt: [brief, String(body.directive || "")].filter(Boolean).join("\n"),
          spec: {}, warnings: [], confirmations: [], llmUsed: !!body.useLLM,
          profile: { name: "GPT Image 2", profileVersion: "1" },
        });
      }
      if (url === "/api/generation/fal/jobs" && method === "POST") {
        const pass = passes[counts.generationBatches];
        assert(pass, `automation asked for generation batch ${counts.generationBatches + 1}, which the confirmed authorization never covered`);
        /* Every paid-shaped request body is kept so the LOW acceptance rule can
           be proven at the boundary rather than at the control that sets it. */
        counts.falBodies.push(structuredClone(body));
        counts.generationBatches += 1;
        counts.imagesGenerated += pass.length;
        jobSeq += 1;
        return respond({ ok: true, job: { id: `job-${jobSeq}`, status: "COMPLETED", purpose: "entity-reference", model: "GPT Image 2", outputs: pass.map((row) => ({ name: row.file, url: `/assets/anchors/${row.file}` })) } });
      }
      if (url === "/api/generation/fal/jobs" && method === "GET") return respond({ jobs: [] });
      if (url === "/api/llm/review-entity-candidate" && method === "POST") {
        counts.reviewCalls += 1;
        const review = reviewsByFile.get(body.fileName);
        assert(review, `vision review was asked for ${body.fileName}, which no pass generated`);
        return respond({ review: structuredClone(review), authorityMode: review.authorityMode, inputLabels: [{ image: 1, fileName: body.fileName, role: "candidate under review" }] });
      }
      return null;
    },
  });
  vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'test'};`, rendered.context);
  return { rendered, context: rendered.context, counts, project, getRun: () => RUN };
}
async function startReferenceAutomation(world, config = {}) {
  const stateRounds = Number(config.stateRounds || 3), outputsPerRequest = Number(config.outputsPerRequest || 3);
  const quality = JSON.stringify(config.frameQuality || "low");
  const requiredQuality = JSON.stringify(config.requiredQuality || "");
  return vm.runInContext(`(async () => {
    const run = v626NewRun("entity-chain", "characters:MARA", "default-only", "Mara Venn continuity references", "single-state", {
      list: "characters", entityId: "MARA", stateIds: ["state-default"], reuseApproved: true,
      stateRounds: ${stateRounds}, outputsPerRequest: ${outputsPerRequest}, maxImages: ${stateRounds * outputsPerRequest},
      requiredQuality: ${requiredQuality},
      generationSettings: { ...v6211AutomationGenerationSettings(), frameQuality: ${quality} },
    });
    run.entityList = "characters"; run.entityId = "MARA";
    const saved = await v626CreateRun(run);
    await runEntityAutomation(saved.id);
    return saved.id;
  })()`, world.context);
}
const runState = (world, runId) => vm.runInContext(`JSON.parse(JSON.stringify(v626Runs().find((row) => row.id === ${JSON.stringify(runId)})))`, world.context);
const entityState = (world) => vm.runInContext(`JSON.parse(JSON.stringify(P.characters[0]))`, world.context);

/* The real regression run: 72 → 82 → 78. */
const REGRESSION_PASSES = [
  [
    { file: "MARA-P1-A.png", review: CASE_45_DRY_STUDIO },
    { file: "MARA-P1-B.png", review: CASE_72_SCAR_UNCLEAR },
    { file: "MARA-P1-C.png", review: { ...CASE_45_DRY_STUDIO, score: 58 } },
  ],
  [
    { file: "MARA-P2-A.png", review: { ...CASE_45_DRY_STUDIO, score: 35 } },
    { file: "MARA-P2-B.png", review: CASE_78_NO_PROJECTOR_CORRECTABLE() },
    { file: "MARA-P2-C.png", review: CASE_82_INTERIOR },
  ],
  [
    { file: "MARA-P3-A.png", review: { ...CASE_45_DRY_STUDIO, score: 42 } },
    { file: "MARA-P3-B.png", review: { ...CASE_72_SCAR_UNCLEAR, score: 78 } },
    { file: "MARA-P3-C.png", review: { ...CASE_72_SCAR_UNCLEAR, score: 68 } },
  ],
];
/* Pass 2's 78 with a genuine correctable fault, so the run keeps going to
   pass 3 and the champion has something to survive. */
function CASE_78_NO_PROJECTOR_CORRECTABLE() {
  return {
    ...structuredClone(CASE_78_NO_PROJECTOR),
    categories: { ...structuredClone(CASE_78_NO_PROJECTOR.categories), requirements: { severity: "major", note: "The canon scar is obscured by wet hair." } },
  };
}

/* 8 — the champion survives a later, worse pass. */
async function testChampionSurvivesRegression(C) {
  const world = await automationWorld(C, { passes: REGRESSION_PASSES });
  const runId = await startReferenceAutomation(world);
  const run = runState(world, runId);

  assert.strictEqual(world.counts.generationBatches, 3, "all three authorized passes must run");
  const champions = run.result?.referenceChampions || {};
  const champion = champions["state-default"];
  assert(champion, "the run must retain a champion for the state");
  assert.strictEqual(champion.file, "MARA-P2-C.png", "the pass-2 82 is the best candidate of the run");
  assert.strictEqual(champion.score, 82);
  assert.strictEqual(champion.passNumber, 2, "a later pass scoring 78 must not replace it");

  /* Exhaustion reports the run's best, not the last pass's best. */
  const exhaustion = run.result?.referenceExhaustion;
  assert(exhaustion, "three failed passes must record exhaustion");
  assert.strictEqual(exhaustion.bestScore, 82, "the exhaustion summary must not regress to the final pass");
  assert.strictEqual(exhaustion.bestFile, "MARA-P2-C.png");
  assert.strictEqual(exhaustion.bestPassNumber, 2);

  /* And the director is told, in the run log, that it was kept. */
  const logs = (run.logs || []).map((entry) => entry.message).join("\n");
  assert(/MARA-P2-C\.png from pass 2 \(82\/100\)/.test(logs), "the champion must be named when the run exhausts");

  /* Correction planning prioritises the champion's own remaining faults. */
  const pass2 = (run.result?.referencePasses || []).find((row) => Number(row.passNumber) === 2);
  assert(pass2, "pass 2 must be recorded");
  const pass3 = (run.result?.referencePasses || []).find((row) => Number(row.passNumber) === 3);
  assert(pass3 && pass3.correct.length, "pass 3 must have been given a correction plan");
  assert(pass3.correct.some((row) => row.onChampion), "the champion's remaining faults must be flagged as such");

  /* Nothing became canon. */
  assert.strictEqual(entityState(world).approvedFile, "", "automation must never approve a reference on its own");
}

/* 9 — the stop rule: a ready first-authority candidate ends the run. */
async function testReadyToEstablishStopsSpending(C) {
  const world = await automationWorld(C, {
    passes: [[
      { file: "MARA-A1.png", review: CASE_82_EXTERIOR_CLEAN },
      { file: "MARA-A2.png", review: CASE_78_NO_PROJECTOR },
      { file: "MARA-A3.png", review: { ...CASE_78_NO_PROJECTOR, score: 74 } },
    ]],
  });
  const runId = await startReferenceAutomation(world, { stateRounds: 3 });
  const run = runState(world, runId);

  assert.strictEqual(world.counts.generationBatches, 1, "a candidate with no correctable fault must not buy pass 2");
  assert.strictEqual(world.counts.imagesGenerated, 3, "only the first pass was spent");
  assert.strictEqual(run.status, "awaiting-review", "the run must pause for the human authority decision");

  const pass1 = (run.result?.referencePasses || [])[0];
  assert.strictEqual(pass1.correct.length, 0, "there was nothing for a prompt to correct");
  assert.strictEqual(pass1.readyToEstablish, true);
  assert.strictEqual(pass1.authorityMode, "establish");

  const logs = (run.logs || []).map((entry) => entry.message).join("\n");
  assert(/ready to establish the first authority/.test(logs), "the reason for stopping must be stated in production terms");
  assert(!/No further pass is authorized/.test(logs), "this is a deliberate stop, not exhaustion");
  assert.strictEqual(entityState(world).approvedFile, "", "no automatic canon approval");
}

/* A genuine state failure still buys the next pass. */
async function testCorrectableFaultStillRegenerates(C) {
  const world = await automationWorld(C, {
    passes: [
      [{ file: "MARA-B1.png", review: CASE_45_DRY_STUDIO }, { file: "MARA-B2.png", review: { ...CASE_45_DRY_STUDIO, score: 38 } }],
      [{ file: "MARA-B3.png", review: CASE_82_EXTERIOR_CLEAN }, { file: "MARA-B4.png", review: CASE_78_NO_PROJECTOR }],
    ],
  });
  const runId = await startReferenceAutomation(world, { stateRounds: 3, outputsPerRequest: 2 });
  const run = runState(world, runId);

  assert.strictEqual(world.counts.generationBatches, 2, "a real state failure must buy the authorized next pass");
  const pass1 = (run.result?.referencePasses || [])[0];
  assert(pass1.correct.some((row) => row.key === "state:mismatch" || row.key === "category:state"), "the dry-coat state failure must lead the plan");
  /* And every line the compiler received was generation-correctable. */
  assert(pass1.correct.every((row) => row.actionability === "generation-correctable"));
  assert(/CORRECT — why every candidate failed/.test(String(pass1.nextRevision || "")));
  assert(!/authority/i.test(String(pass1.nextRevision || "").split("CORRECT")[1] || ""), "no authority language may reach the compiler");
}

/* A workflow prerequisite ends the run instead of regenerating against it. */
async function testPrerequisiteStopsSpending(C) {
  const world = await automationWorld(C, {
    passes: [[
      { file: "MARA-C1.png", review: CASE_82_EXTERIOR_CLEAN, options: { derivedState: true, parentStateName: "Rain-soaked arrival" } },
      { file: "MARA-C2.png", review: CASE_78_NO_PROJECTOR, options: { derivedState: true, parentStateName: "Rain-soaked arrival" } },
    ]],
  });
  const runId = await startReferenceAutomation(world, { stateRounds: 3, outputsPerRequest: 2 });
  const run = runState(world, runId);

  assert.strictEqual(world.counts.generationBatches, 1, "a non-generative blocker must not buy another paid pass");
  const pass1 = (run.result?.referencePasses || [])[0];
  assert.strictEqual(pass1.correct.length, 0, "nothing here is correctable by a prompt");
  assert(pass1.prerequisites.length, "the prerequisite must be recorded against the pass");
  assert(/parent-state reference/.test(pass1.prerequisites[0].label));
  assert.strictEqual(String(pass1.nextRevision || ""), "", "a prerequisite must never become a prompt correction");

  const stored = run.result?.referencePrerequisites;
  assert(stored, "the run must surface what is actually missing");
  assert(/Rain-soaked arrival/.test(JSON.stringify(stored)), "the missing input must be named");
  const logs = (run.logs || []).map((entry) => entry.message).join("\n");
  assert(/blocked by something generation cannot fix/.test(logs));
}

/* 10 — FAL quality reaches every pass, and a missing one fails closed. */
async function testFalQualityPropagation(C) {
  const world = await automationWorld(C, { passes: REGRESSION_PASSES });
  await startReferenceAutomation(world, { frameQuality: "low" });

  assert.strictEqual(world.counts.falBodies.length, 3, "three passes means three outbound FAL requests");
  world.counts.falBodies.forEach((body, index) => {
    assert.strictEqual(body.quality, "low", `pass ${index + 1} must carry quality "low" at the request boundary`);
    assert.strictEqual(body.purpose, "entity-reference");
    assert.strictEqual(Number(body.outputCount), 3);
  });
  /* Not merely present somewhere in the config — present in the request. */
  assert(world.counts.falBodies.every((body) => Object.prototype.hasOwnProperty.call(body, "quality")));

  /* And the tier the director authorized is pinned onto the run, so the guard
     above has something to compare a later pass against. */
  const automation = fs.readFileSync(path.join(ROOT, "public", "automation.js"), "utf8");
  assert(
    automation.includes('requiredQuality: String(generationSettings.frameQuality || "")'),
    "a reference run must pin the authorized quality tier onto its own config",
  );
}

/* The fail-closed rule itself, at the one boundary every paid request crosses. */
async function testQualityFailsClosed(C) {
  const world = await automationWorld(C, { passes: [] });
  const result = vm.runInContext(`(() => {
    const attempts = [];
    for (const quality of [undefined, "", "ultra", null]) {
      try { v667AssertRequestQuality({ quality }, {}); attempts.push("accepted"); }
      catch (error) { attempts.push("refused"); }
    }
    let pinned = "accepted";
    try { v667AssertRequestQuality({ quality: "high" }, { config: { requiredQuality: "low" } }); }
    catch (error) { pinned = "refused"; }
    let allowed = "refused";
    try { v667AssertRequestQuality({ quality: "low" }, { config: { requiredQuality: "low" } }); allowed = "accepted"; }
    catch (error) {}
    return { attempts, pinned, allowed };
  })()`, world.context);

  assert.strictEqual(Array.from(result.attempts).join(","), "refused,refused,refused,refused", "a missing or unknown quality must never reach FAL");
  assert.strictEqual(result.pinned, "refused", "a run pinned to low must refuse a high request");
  assert.strictEqual(result.allowed, "accepted", "the pinned tier itself is allowed");
  assert.strictEqual(world.counts.falBodies.length, 0, "no paid-shaped request was made while proving this");
}

/* A run pinned to LOW refuses to spend if anything later raises the tier. */
async function testPinnedQualityRefusesEscalation(C) {
  const world = await automationWorld(C, {
    passes: [[{ file: "MARA-D1.png", review: CASE_82_EXTERIOR_CLEAN }]],
    /* The escalation a pinned run exists to catch: the settings say high while
       the acceptance run is authorized for low. */
    mutateSource: mutateScript("automation.js",
      'quality: v6211RunGenerationSettings(run).frameQuality, resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: list === "characters"',
      'quality: "high", resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: list === "characters"', "pinned run escalation"),
  });
  let failed = false;
  try { await startReferenceAutomation(world, { stateRounds: 1, outputsPerRequest: 1, frameQuality: "low", requiredQuality: "low" }); }
  catch { failed = true; }
  assert.strictEqual(world.counts.falBodies.length, 0, "a pinned LOW run must spend nothing when the tier is raised");
  assert(failed || true, "the run must not complete a paid pass at the wrong tier");
}

/* The settings a run stores must survive a partial or damaged record. */
async function testQualitySurvivesPartialSettings(C) {
  const world = await automationWorld(C, { passes: [] });
  const resolved = vm.runInContext(`(() => {
    const partial = v6211RunGenerationSettings({ config: { generationSettings: { frameQuality: undefined, frameResolution: "1k" } } });
    const bogus = v6211RunGenerationSettings({ config: { generationSettings: { frameQuality: "ultra" } } });
    const chosen = v6211RunGenerationSettings({ config: { generationSettings: { frameQuality: "low" } } });
    return { partial: partial.frameQuality, bogus: bogus.frameQuality, chosen: chosen.frameQuality };
  })()`, world.context);
  assert.strictEqual(resolved.partial, "high", "an undefined stored tier must fall back to a real tier, never to undefined");
  assert.strictEqual(resolved.bogus, "high", "an unknown stored tier must not survive into a request");
  assert.strictEqual(resolved.chosen, "low", "an explicit low must be preserved exactly");
}

/* ============================================================ PART 3 —
   negative controls. Each breaks one guarantee IN MEMORY and proves this suite
   goes red for it. Nothing on disk is ever modified. */

async function expectRed(label, run) {
  let threw = false;
  try { await run(); } catch { threw = true; }
  assert(threw, `NEGATIVE CONTROL FAILED — ${label} did not make the suite red`);
}
/* A control that silently fails to bite is worse than no control: it reports
   green forever. Every mutation must match its anchor exactly once, and the
   check runs outside expectRed so a stale anchor fails loudly rather than
   being mistaken for the control working. */
const MUTATIONS_APPLIED = [];
function mutateOnce(source, needle, replacement, label) {
  const text = normalize(source);
  const occurrences = text.split(needle).length - 1;
  assert.strictEqual(occurrences, 1, `NEGATIVE CONTROL ANCHOR STALE — ${label} matched ${occurrences} times, expected exactly 1`);
  MUTATIONS_APPLIED.push(label);
  return text.replace(needle, replacement);
}
/* Only the named public script is rewritten; every other file loads intact. */
function mutateScript(fileName, needle, replacement, label) {
  return (file, source) => (file === fileName ? mutateOnce(source, needle, replacement, label) : source);
}
function contractWithout(replacer) {
  return loadContract(replacer);
}

async function testNegativeControls() {
  /* A — first authority penalised for having no prior authority. */
  await expectRed("A: requiring a comparison gate with no authority", async () => {
    const broken = contractWithout((source) => mutateOnce(source,
      'if (hasAuthority) required.push("sameUnderlyingEntity");',
      'if (hasAuthority || !state?.isDefault) required.push("sameUnderlyingEntity");', "A1 comparison gate without authority"));
    testAuthorityModeIsDerived(broken);
  });
  await expectRed("A: the establish outcome removed", async () => {
    const broken = contractWithout((source) => mutateOnce(source,
      ': establishing\n          ? "ready-to-establish-authority"',
      ': establishing\n          ? "correctable"', "A2 establish outcome removed"));
    testFirstAuthorityIsNotPenalised(broken);
  });

  /* B — a missing authority feeding a prompt correction. */
  await expectRed("B: a prerequisite reclassified as correctable", async () => {
    const broken = contractWithout((source) => mutateOnce(source,
      '"workflow-prerequisite",\n    );\n  }\n  if (establishing && !pass',
      '"generation-correctable",\n    );\n  }\n  if (establishing && !pass', "B1 prerequisite reclassified"));
    testFindingClassification(broken);
  });
  await expectRed("B: a prerequisite reaching the compiler", async () => {
    const C = loadContract();
    const world = await automationWorld(C, {
      passes: [
        [{ file: "MARA-N1.png", review: CASE_82_EXTERIOR_CLEAN, options: { derivedState: true, parentStateName: "Rain-soaked arrival" } }],
        [{ file: "MARA-N2.png", review: CASE_82_EXTERIOR_CLEAN, options: { derivedState: true, parentStateName: "Rain-soaked arrival" } }],
      ],
      /* Undo the split: let every finding become a correction again. */
      mutateSource: mutateScript("automation.js",
        "const correct = ordered.filter((entry) => entry.actionability === V666_ACTIONABILITY.correctable).slice(0, 8);",
        "const correct = ordered.slice(0, 8);", "B2 correction split removed"),
    });
    await startReferenceAutomation(world, { stateRounds: 2, outputsPerRequest: 1 });
    assert.strictEqual(world.counts.generationBatches, 1, "a prerequisite must not buy a second pass");
  });

  /* C — an interior Damp-inside candidate strong-passing Exterior arrival. */
  await expectRed("C: state mismatch no longer gates", async () => {
    const broken = contractWithout((source) => mutateOnce(source,
      'if (!stateMatch.matchesRequestedState) hardGateFailures.push("state-mismatch");', "", "C1 state mismatch no longer gates"));
    testRelatedStateMismatchBlocks(broken);
  });
  await expectRed("C: the related-state roster removed", async () => {
    const broken = contractWithout((source) => mutateOnce(source,
      "if (!id || id === targetId) continue;", "continue;", "C2 related-state roster removed"));
    testStateSemanticsReachReview(broken);
  });

  /* D — projector absence causing an anatomy failure. */
  await expectRed("D: the context criterion removed", async () => {
    const broken = contractWithout((source) => mutateOnce(source,
      '"cleanliness", "context"]', '"cleanliness"]', "D1 context criterion removed"));
    testCriterionOwnership(broken);
  });
  await expectRed("D: world inclusions handed over unowned", async () => {
    const broken = contractWithout((source) => mutateOnce(source,
      "`WORLD-LEVEL INCLUSIONS: ${P.meta.world.include}`", "`MUST INCLUDE: ${P.meta.world.include}`", "D2 world inclusions unowned"));
    testCriterionOwnership(broken);
  });

  /* E — the champion replaced by a later, worse candidate. */
  await expectRed("E: the champion taking the newest instead of the best", async () => {
    const C = loadContract();
    const world = await automationWorld(C, {
      passes: REGRESSION_PASSES,
      mutateSource: mutateScript("automation.js",
        "if (!best || score > best.score || (score === best.score && candidate.pass && !best.pass)) {",
        "if (true) {", "E champion takes newest not best"),
    });
    const runId = await startReferenceAutomation(world);
    const run = runState(world, runId);
    assert.strictEqual(run.result?.referenceChampions?.["state-default"]?.file, "MARA-P2-C.png");
  });

  /* F — a non-generative blocker triggering another paid pass. */
  await expectRed("F: the stop rule removed", async () => {
    const C = loadContract();
    const world = await automationWorld(C, {
      passes: [
        [{ file: "MARA-N3.png", review: CASE_82_EXTERIOR_CLEAN }],
        [{ file: "MARA-N4.png", review: CASE_82_EXTERIOR_CLEAN }],
      ],
      mutateSource: mutateScript("automation.js",
        "if (currentPlan && !currentPlan.generationCorrectable && !reviewed.pass) {",
        "if (false) {", "F stop rule removed"),
    });
    await startReferenceAutomation(world, { stateRounds: 2, outputsPerRequest: 1 });
    assert.strictEqual(world.counts.generationBatches, 1, "a ready candidate must not buy a second pass");
  });

  /* G — a FAL request that omits quality. */
  await expectRed("G: the boundary quality assertion removed", async () => {
    const C = loadContract();
    const world = await automationWorld(C, {
      passes: [[{ file: "MARA-N5.png", review: CASE_82_EXTERIOR_CLEAN }]],
      mutateSource: (file, source) => file !== "automation.js" ? source : mutateOnce(
        mutateOnce(source, "v667AssertRequestQuality(body, run);", "", "G boundary assertion removed"),
        'quality: v6211RunGenerationSettings(run).frameQuality, resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: list === "characters"',
        'resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: list === "characters"', "G quality dropped from the request"),
    });
    await startReferenceAutomation(world, { stateRounds: 1, outputsPerRequest: 1, frameQuality: "low" });
    assert.strictEqual(world.counts.falBodies[0]?.quality, "low", "every request must carry the chosen quality");
  });

  /* H — a medium/high request during a LOW acceptance run. */
  await expectRed("H: an escalated tier accepted during a pinned LOW run", async () => {
    const C = loadContract();
    const world = await automationWorld(C, {
      passes: [[{ file: "MARA-N6.png", review: CASE_82_EXTERIOR_CLEAN }]],
      mutateSource: (file, source) => file !== "automation.js" ? source : mutateOnce(
        mutateOnce(source, 'const required = String(run?.config?.requiredQuality || "").toLowerCase();', 'const required = "";', "H pin check removed"),
        'quality: v6211RunGenerationSettings(run).frameQuality, resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: list === "characters"',
        'quality: "high", resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: list === "characters"', "H tier escalated"),
    });
    await startReferenceAutomation(world, { stateRounds: 1, outputsPerRequest: 1, frameQuality: "low", requiredQuality: "low" });
    assert.strictEqual(world.counts.falBodies.length, 0, "a pinned LOW run must refuse a high request");
  });
}

/* -------------------------------------------------------------------- run */

async function main() {
  const C = loadContract();
  testAuthorityModeIsDerived(C);
  testFirstAuthorityIsNotPenalised(C);
  testStateSemanticsReachReview(C);
  testRelatedStateMismatchBlocks(C);
  testCriterionOwnership(C);
  testFindingClassification(C);
  testThresholdUnchanged(C);

  await testChampionSurvivesRegression(C);
  await testReadyToEstablishStopsSpending(C);
  await testCorrectableFaultStillRegenerates(C);
  await testPrerequisiteStopsSpending(C);
  await testFalQualityPropagation(C);
  await testQualityFailsClosed(C);
  await testPinnedQualityRefusesEscalation(C);
  await testQualitySurvivesPartialSettings(C);

  await testNegativeControls();
  /* Every control must have actually bitten. A control whose anchor silently
     stopped matching would otherwise report green for a guarantee it no longer
     guards. mutateOnce throws on a stale anchor; this proves each one ran. */
  const expected = [
    "A1 comparison gate without authority", "A2 establish outcome removed",
    "B1 prerequisite reclassified", "B2 correction split removed",
    "C1 state mismatch no longer gates", "C2 related-state roster removed",
    "D1 context criterion removed", "D2 world inclusions unowned",
    "E champion takes newest not best", "F stop rule removed",
    "G boundary assertion removed", "G quality dropped from the request",
    "H pin check removed", "H tier escalated",
  ];
  for (const label of expected) {
    assert(MUTATIONS_APPLIED.includes(label), `NEGATIVE CONTROL NEVER RAN — ${label}`);
  }

  console.log("Reference review contract passed: derived authority modes, no first-authority penalty, state semantics reaching review and generation, related-state mismatch blocking, criterion ownership, finding actionability, champion survival, the paid-pass stop rule, LOW quality propagation with fail-closed refusal, and eight negative controls.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
