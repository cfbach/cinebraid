/* UX B2a — candidate review honours declared state semantics.

   THE DEFECT THIS SUITE EXISTS FOR

   A derived state of the Red Envelope declared, in effect:

     seal broken · flap open · same envelope

   The generated candidate had no wax seal at all. The reviewer SAW that and said
   so, then treated an ABSENT seal as satisfying a BROKEN one, returned 96/100,
   PASS, "All required gates passed", and a green approval recommendation.

   That is not a calibration error. Nothing in CineBraid held the requirement as
   data, and nothing held the observation as data, so there was no place where
   "absent" could be compared against "broken" — the substitution happened inside
   a verdict CineBraid then recorded as fact.

   The fix is the division the declared-entity continuity contract already runs
   on: THE MODEL OBSERVES, CINEBRAID COMPARES. Every case below is that division
   being exercised, in the order the audit hit it:

     1  a changed-but-present requirement met by absence          -> NOT PASS
     2  a required delta that was not observed                    -> ISSUE
     3  evidence that could not be read                           -> UNCERTAIN
     4  an unrelated parent-authoritative attribute that drifted  -> ISSUE
     5  a genuinely valid derived state                           -> PASS
     6  score 96 against a failed requirement                     -> NOT PASS
     7  an AI pass performing no human approval
     8  provider/model attribution taken from what actually served the review

   PART 1 is the contract, pure. PART 2 drives the REAL route in a real server
   against a mock vision provider. PART 3 renders the REAL modal.

   NOTHING HERE IS PAID. There is no FAL route in this path at all; part 2
   asserts that no request of any kind left the loopback mock, and part 3 counts
   every fetch the client makes. */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const Contract = require(path.join(ROOT, "src/authority/reference-review-contract.js"));
const Continuity = require(path.join(ROOT, "public", "shared-continuity.js"));

const notes = [];
const note = (line) => notes.push(line);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ==========================================================================
   THE FIXTURE — the audit's own object, described the way a production does.
   The vocabulary lives here and nowhere in the product code: nothing under test
   knows what a wax seal is.
   ========================================================================== */

const ENVELOPE_DEFAULT = {
  id: "state-default",
  name: "Sealed",
  isDefault: true,
  approvedFile: "PROP-ENVELOPE-SEALED.png",
  notes: "Red paper envelope, intact gold wax seal, flap closed.",
};
const ENVELOPE_OPENED = {
  id: "state-opened",
  name: "Opened",
  isDefault: false,
  parentStateId: "state-default",
  approvedFile: "",
  notes: "Wax seal broken but still present, flap open, same red envelope.",
};
function envelopeEntity() {
  return {
    id: "PROP-ENVELOPE",
    name: "The red envelope",
    block: "A red paper envelope closed with a gold wax seal.",
    approvedFile: "PROP-ENVELOPE-SEALED.png",
    continuityStates: [structuredClone(ENVELOPE_DEFAULT), structuredClone(ENVELOPE_OPENED)],
  };
}

const DECLARED = Contract.entityReviewDeclaredRequirements(ENVELOPE_OPENED);
const REQUIREMENTS = DECLARED.requirements;
const SEAL = REQUIREMENTS[0];
const FLAP = REQUIREMENTS[1];
const ENVELOPE = REQUIREMENTS[2];

/* A reviewer response in the shape the contract asks for. Every hard check and
   category is clean, so nothing but the declared-state evidence can be what
   moves the verdict in the cases below. */
function reviewerResponse(records, extra = {}) {
  return {
    score: 96,
    pass: true,
    hardChecks: {
      sameUnderlyingEntity: { pass: true, note: "The same envelope." },
      onlyRequestedDelta: { pass: true, note: "Only the requested delta changed." },
    },
    stateMatch: { matchesRequestedState: true, closerState: "", note: "The opened state." },
    categories: {
      design: { severity: "pass", note: "Identity preserved." },
      state: { severity: "pass", note: "Reads as the opened state." },
      requirements: { severity: "pass", note: "Nothing missing." },
      usefulness: { severity: "pass", note: "Clear reference." },
      cleanliness: { severity: "pass", note: "No artifacts." },
      context: { severity: "pass", note: "Neutral background." },
    },
    summary: "Strong opened-envelope reference.",
    recommendation: "approve",
    stateEvidence: records,
    parentDrift: [],
    ...extra,
  };
}
const observed = (requirement, feature, expectedFeature, observedFeature, observedCondition, evidence) => ({
  requirementId: requirement.id,
  feature,
  expectedFeature,
  observedFeature,
  observedCondition,
  evidence,
});
const FLAP_OPEN = () => observed(FLAP, "the flap", "must-remain", "present", "as-required", "The flap is open.");
const ENVELOPE_SAME = () => observed(ENVELOPE, "the envelope", "must-remain", "present", "as-required", "Red paper envelope.");

function validating(extra = {}) {
  return {
    authorityMode: "validate",
    requiredHardChecks: ["sameUnderlyingEntity", "onlyRequestedDelta"],
    authoritySignature: "sig",
    declaredRequirements: REQUIREMENTS,
    driftComparisonAvailable: true,
    derivedState: true,
    parentStateName: "Sealed",
    ...extra,
  };
}
/* Every case below takes the contract as an argument and defaults to the real
   one. The negative controls call the SAME functions with a deliberately broken
   copy compiled in memory, so what goes red there is the real guard and not a
   restatement of it. */
const judgeWith = (C, records, extra = {}, options = {}) =>
  C.normalizeEntityCandidateReview(reviewerResponse(records, extra), validating(options));

/* ==========================================================================
   PART 1 — the contract
   ========================================================================== */

/* The requirement list is CineBraid's, derived from the state the project
   already carries, and it is what reaches the reviewer. */
function testDeclaredRequirementsAreCineBraids() {
  assert.deepStrictEqual(
    REQUIREMENTS.map((row) => row.text),
    ["Wax seal broken but still present", "flap open", "same red envelope"],
    "the declared delta must reach review as discrete requirements CineBraid owns",
  );
  assert.deepStrictEqual(REQUIREMENTS.map((row) => row.id), ["delta-1", "delta-2", "delta-3"]);
  assert.strictEqual(DECLARED.omitted, 0);

  /* The default state describes an appearance, not a change to one, so it
     declares no delta and the semantic layer stays inert on it. */
  assert.deepStrictEqual(Contract.entityReviewDeclaredRequirements(ENVELOPE_DEFAULT).requirements, [],
    "the base state has no delta to be judged against");

  /* The checklist the reviewer is handed names the ids and forbids the
     substitution, without naming this fixture's vocabulary. */
  const contract = Contract.entityReviewDeclaredStateContract(DECLARED, { hasAuthority: true, authorityCount: 1, parentStateName: "Sealed" });
  for (const row of REQUIREMENTS) assert(contract.includes(`- ${row.id}: ${row.text}`), `the checklist must list ${row.id}`);
  assert(/ABSENT from the candidate never satisfies a requirement that changes it/.test(contract),
    "the request must state the rule the reviewer broke");
  assert(/parentDrift/.test(contract), "with authority supplied, undeclared drift must be asked for");
  assert(/nothing to compare unchanged features against/.test(
    Contract.entityReviewDeclaredStateContract(DECLARED, { hasAuthority: false })),
    "with no authority supplied, drift must be explicitly not asked for");

  /* An unbounded delta is capped, and says how much of itself was not checked. */
  const long = Contract.entityReviewDeclaredRequirements({
    id: "s", name: "Long", notes: Array.from({ length: 20 }, (_, i) => `clause number ${i + 1}`).join(", "),
  });
  assert.strictEqual(long.requirements.length, Contract.DECLARED_REQUIREMENT_LIMIT);
  assert.strictEqual(long.omitted, 8, "a capped checklist must report what it dropped rather than truncating silently");
  note("the declared delta becomes a CineBraid-owned requirement checklist; the base state declares none, and a capped list reports its own truncation");
}

/* CASE 1 — the audit's exact failure. Absent is not broken. */
function testAbsenceDoesNotSatisfyAChange(C = Contract) {
  const judge = (records, extra, options) => judgeWith(C, records, extra, options);
  const review = judge([
    observed(SEAL, "the wax seal", "must-remain", "absent", "not-applicable", "There is no wax seal anywhere on the envelope."),
    FLAP_OPEN(),
    ENVELOPE_SAME(),
  ]);

  assert.strictEqual(review.pass, false, "an absent feature must not satisfy a requirement that changes it");
  assert.strictEqual(review.autoApprove, false, "and it must not be nominated for approval");
  assert(review.hardGateFailures.includes("declared-state-unsatisfied"),
    "the semantic mismatch must be recorded as a gate failure in its own right");
  assert.strictEqual(review.semanticOutcome, "issue");
  assert.strictEqual(review.semanticSatisfied, false);
  assert.strictEqual(review.stateEvidence.label, Continuity.CONTINUITY_OUTCOME_LABELS.issue,
    "the outcome word must come from the shared continuity vocabulary");

  const finding = review.stateEvidence.findings.find((row) => row.id === SEAL.id);
  assert.strictEqual(finding.outcome, "issue");
  assert.strictEqual(finding.expectedFeature, "must-remain");
  assert.strictEqual(finding.observedFeature, "absent");
  assert(/absent/.test(finding.headline), "the finding must say the feature is absent");
  assert(/must still be there to be in that condition/.test(finding.detail),
    "and must explain why absence is not the requested change");
  assert.strictEqual(finding.requirement, SEAL.text, "the declared expectation must be shown beside the observation");

  /* The other two requirements were satisfied and stay visible as such. */
  assert.strictEqual(review.stateEvidence.findings.find((row) => row.id === FLAP.id).outcome, "expected");
  assert.strictEqual(review.stateEvidence.findings.find((row) => row.id === ENVELOPE.id).outcome, "expected");

  const blocker = review.blockers.find((row) => row.key === `declared-state:${SEAL.id}`);
  assert(blocker, "the unsatisfied requirement must be a named blocker");
  assert.strictEqual(blocker.actionability, "generation-correctable", "a missing feature is something another pass can supply");
  assert.strictEqual(review.outcome, "correctable");
  assert.notStrictEqual(review.recommendation, "approve", "a green recommendation must not survive the mismatch");

  /* Generality: the same rule with no envelope vocabulary anywhere. */
  const generic = C.judgeDeclaredRequirement(
    { id: "delta-1", text: "the hinge is bent" },
    observed({ id: "delta-1" }, "the hinge", "must-remain", "absent", "not-applicable", "No hinge is visible."),
  );
  assert.strictEqual(generic.outcome, "issue", "the rule is about presence semantics, not about any particular object");
  note("CASE 1: an absent feature never satisfies a requirement that changes it — not pass, gate failure named, blocker correctable");
}

/* CASE 2 — the declared change simply was not made. */
function testRequiredDeltaNotObserved(C = Contract) {
  const judge = (records, extra, options) => judgeWith(C, records, extra, options);
  const review = judge([
    observed(SEAL, "the wax seal", "must-remain", "present", "as-required", "The seal is cracked across."),
    observed(FLAP, "the flap", "must-remain", "present", "different", "The flap is still closed and tucked in."),
    ENVELOPE_SAME(),
  ]);
  assert.strictEqual(review.pass, false);
  assert.strictEqual(review.semanticOutcome, "issue");
  const finding = review.stateEvidence.findings.find((row) => row.id === FLAP.id);
  assert.strictEqual(finding.outcome, "issue");
  assert(/not in the declared condition/.test(finding.headline));
  assert(review.hardGateFailures.includes("declared-state-unsatisfied"));
  note("CASE 2: a declared change the candidate does not show is an ISSUE, not a pass");
}

/* CASE 3 — evidence nobody could read stays unread. */
function testUncertaintyStaysUncertain(C = Contract) {
  const judge = (records, extra, options) => judgeWith(C, records, extra, options);
  const review = judge([
    observed(SEAL, "the wax seal", "must-remain", "present", "uncertain", "The seal region is behind a fold and cannot be read."),
    FLAP_OPEN(),
    ENVELOPE_SAME(),
  ]);
  assert.strictEqual(review.pass, false, "uncertainty is not a pass");
  assert.strictEqual(review.semanticOutcome, "uncertain");
  assert(review.hardGateFailures.includes("declared-state-unresolved"));
  assert(!review.hardGateFailures.includes("declared-state-unsatisfied"), "uncertainty is not a fault in the image either");

  const blocker = review.blockers.find((row) => row.key === `declared-state:${SEAL.id}`);
  assert.strictEqual(blocker.actionability, "human-decision",
    "unreadable evidence must never buy a paid regeneration pass");
  assert.strictEqual(review.generationCorrectable, false);
  assert.strictEqual(review.outcome, "human-decision");

  /* Unreadable PRESENCE is uncertain too, and so is a requirement nobody
     answered at all. */
  const invisible = judge([
    observed(SEAL, "the wax seal", "must-remain", "uncertain", "uncertain", "Cannot tell whether a seal is there."),
    FLAP_OPEN(), ENVELOPE_SAME(),
  ]);
  assert.strictEqual(invisible.semanticOutcome, "uncertain");
  const unanswered = judge([FLAP_OPEN(), ENVELOPE_SAME()]);
  assert.strictEqual(unanswered.semanticOutcome, "review", "a requirement the reviewer skipped is a question, never a pass");
  assert.strictEqual(unanswered.pass, false);

  /* And an establishing workflow must not offer a signature over evidence that
     could not be read. */
  const establishing = C.normalizeEntityCandidateReview(
    reviewerResponse([
      observed(SEAL, "the wax seal", "must-remain", "present", "uncertain", "Obscured."),
      FLAP_OPEN(), ENVELOPE_SAME(),
    ]),
    { authorityMode: "establish", requiredHardChecks: [], declaredRequirements: REQUIREMENTS, driftComparisonAvailable: false },
  );
  assert.strictEqual(establishing.readyToEstablishAuthority, false,
    "uncertain evidence must not read as ready to establish the first authority");
  assert.strictEqual(establishing.outcome, "human-decision");
  note("CASE 3: unreadable evidence stays UNCERTAIN — never a pass, never a paid pass, never ready-to-establish");
}

/* CASE 4 — the parent stays authoritative for everything not declared. */
function testUndeclaredParentDriftBlocks(C = Contract) {
  const judge = (records, extra, options) => judgeWith(C, records, extra, options);
  const review = judge(
    [
      observed(SEAL, "the wax seal", "must-remain", "present", "as-required", "Gold seal, broken cleanly."),
      FLAP_OPEN(),
      ENVELOPE_SAME(),
    ],
    { parentDrift: [{ attribute: "color", parentValue: "red paper", candidateValue: "blue paper", evidence: "The body of the envelope is blue." }] },
  );
  assert.strictEqual(review.pass, false, "the requested delta being right does not license an unrequested one");
  assert.strictEqual(review.semanticOutcome, "issue");
  const drift = review.stateEvidence.drift[0];
  assert.strictEqual(drift.outcome, "issue");
  assert.strictEqual(drift.attribute, "color");
  assert(/red paper/.test(drift.detail) && /blue paper/.test(drift.detail), "both sides of the drift must be shown");
  assert(review.blockers.some((row) => row.key === "parent-authority:color"));

  /* Drift is only a question where an authority was actually supplied. */
  const bootstrapping = C.normalizeEntityCandidateReview(
    reviewerResponse([
      observed(SEAL, "the wax seal", "must-remain", "present", "as-required", "Broken."),
      FLAP_OPEN(), ENVELOPE_SAME(),
    ], { parentDrift: [{ attribute: "color", parentValue: "red", candidateValue: "blue", evidence: "x" }] }),
    { authorityMode: "establish", requiredHardChecks: [], declaredRequirements: REQUIREMENTS, driftComparisonAvailable: false },
  );
  assert.deepStrictEqual(bootstrapping.stateEvidence.drift, [],
    "with no authority image there is nothing to have drifted from, so nothing may be reported as drift");

  /* Every locked characteristic the semantic model already names is expressible,
     and an unknown one lands in the model's own catch-all rather than inventing
     a category. */
  for (const attribute of ["identity", "material", "color", "markings", "geometry", "design-cue"])
    assert.strictEqual(C.judgeParentDrift({ attribute, parentValue: "a", candidateValue: "b" }).attribute, attribute);
  assert.strictEqual(C.judgeParentDrift({ attribute: "vibes", parentValue: "a", candidateValue: "b" }).attribute, "other");
  /* A drift claim with only one side of the comparison is a question, not a
     finding — it cannot be acted on and must not be presented as fact. */
  assert.strictEqual(C.judgeParentDrift({ attribute: "color", parentValue: "red", candidateValue: "" }).outcome, "review");
  note("CASE 4: undeclared drift from the parent authority blocks a clean pass, and is only asked for where an authority exists");
}

/* CASE 5 — the positive control. The fix must not make derived states fail. */
function testValidDerivedStatePasses(C = Contract) {
  const judge = (records, extra, options) => judgeWith(C, records, extra, options);
  const review = judge([
    observed(SEAL, "the wax seal", "must-remain", "present", "as-required", "Gold wax seal, visibly cracked in two."),
    FLAP_OPEN(),
    ENVELOPE_SAME(),
  ]);
  assert.strictEqual(review.pass, true, "a derived state that is genuinely satisfied must still pass");
  assert.strictEqual(review.semanticOutcome, "expected");
  assert.strictEqual(review.semanticSatisfied, true);
  assert.strictEqual(review.outcome, "validated-strong");
  assert.strictEqual(review.stateEvidence.issueCount, 0);
  assert.strictEqual(review.stateEvidence.unresolvedCount, 0);
  assert(review.stateEvidence.findings.every((row) => row.outcome === "expected"));
  assert.deepStrictEqual(review.hardGateFailures, [], "nothing may be failing on a valid derived state");

  /* Removal states work in the other direction, and are not caught by the
     absence rule they would otherwise trip. */
  const removal = C.normalizeEntityCandidateReview(
    reviewerResponse([observed({ id: "delta-1" }, "the label", "must-disappear", "absent", "not-applicable", "No label on the tin.")]),
    validating({ declaredRequirements: [{ id: "delta-1", text: "the label has been peeled off" }] }),
  );
  assert.strictEqual(removal.semanticOutcome, "expected", "a requirement that REMOVES a feature is satisfied by its absence");
  assert.strictEqual(removal.pass, true);

  /* And a state that declares nothing leaves the semantic layer inert rather
     than failing everything for want of a checklist. */
  const noDelta = C.normalizeEntityCandidateReview(reviewerResponse([]), validating({ declaredRequirements: [], driftComparisonAvailable: false }));
  assert.strictEqual(noDelta.stateEvidence.applies, false);
  assert.strictEqual(noDelta.pass, true, "a state with no declared delta must review exactly as it did before");
  note("CASE 5: a genuinely satisfied derived state still passes; removal states pass on absence; a state with no delta is unaffected");
}

/* CASE 6 — the score is subordinate. */
function testScoreCannotOverrideSemantics(C = Contract) {
  const judge = (records, extra, options) => judgeWith(C, records, extra, options);
  const review = judge([
    observed(SEAL, "the wax seal", "must-remain", "absent", "not-applicable", "No seal."),
    FLAP_OPEN(), ENVELOPE_SAME(),
  ], { score: 96, pass: true });
  assert.strictEqual(review.score, 96, "the score is preserved as context");
  assert.strictEqual(review.modelPass, true, "and so is the model's own claim");
  assert.strictEqual(review.pass, false, "neither of them may clear a failed declared requirement");

  /* 100/100 and every gate the model controls green: still not a pass. */
  const perfect = judge([
    observed(SEAL, "the wax seal", "must-remain", "absent", "not-applicable", "No seal."),
    FLAP_OPEN(), ENVELOPE_SAME(),
  ], { score: 100, pass: true, recommendation: "approve" });
  assert.strictEqual(perfect.pass, false);
  assert.notStrictEqual(perfect.recommendation, "approve");

  /* The decision path itself: pass is the emptiness of the gate list, and the
     semantic terms are in that list. A score comparison cannot be reintroduced
     as a shortcut around it without this going red. */
  const source = fs.readFileSync(path.join(ROOT, "src/authority/reference-review-contract.js"), "utf8").replace(/\r\n/g, "\n");
  assert(source.includes('if (stateEvidence.applies && stateEvidence.issueCount) hardGateFailures.push("declared-state-unsatisfied");'),
    "an unsatisfied declared requirement must be a hard gate, not a scoring input");
  assert(source.includes('if (stateEvidence.applies && stateEvidence.unresolvedCount) hardGateFailures.push("declared-state-unresolved");'),
    "unresolved evidence must be a hard gate too");
  assert(source.includes("const pass = uniqueFailures.length === 0;"),
    "pass must remain the emptiness of the gate list");
  note("CASE 6: 96/100 and a self-declared pass cannot clear a failed declared requirement; the score is context under the semantic verdict");
}

/* CASE 7 — the AI verdict is advisory, in the contract as well as the UI. */
function testAiVerdictIsAdvisory(C = Contract) {
  const judge = (records, extra, options) => judgeWith(C, records, extra, options);
  const strong = judge([
    observed(SEAL, "the wax seal", "must-remain", "present", "as-required", "Broken."),
    FLAP_OPEN(), ENVELOPE_SAME(),
  ]);
  assert.strictEqual(strong.autoApprove, true, "autoApprove is the reviewer's nomination");
  /* And it is only that: nothing in the contract approves, renames, canonises or
     assigns anything. */
  for (const forbidden of ["approvedFile", "approvedAt", "humanApproved", "decision", "reassignedStateId"])
    assert(!Object.prototype.hasOwnProperty.call(strong, forbidden), `the review must not carry ${forbidden}`);
  note("CASE 7 (contract half): a strong pass is a nomination and carries no approval field of any kind");
}

/* ==========================================================================
   PART 2 — the real route, in a real server, against a mock vision provider
   ========================================================================== */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? null : JSON.stringify(options.body);
    const req = http.request({
      host: "127.0.0.1", port, path: pathname, method: options.method || "GET",
      headers: { ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}), ...(options.headers || {}) },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = text;
        try { data = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, data });
      });
    });
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function routeSection() {
  const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-b2a-"));
  const PROJECTS_ROOT = path.join(TEMP, "projects");
  const CONFIG_PATH = path.join(TEMP, "config.json");
  const PROJECT_DIR = path.join(PROJECTS_ROOT, "b2a-project");
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "shots", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  for (const name of ["PROP-ENVELOPE-SEALED.png", "PROP-ENVELOPE-CANDIDATE.png"])
    fs.writeFileSync(path.join(PROJECT_DIR, "props", name), Buffer.from(`mock-${name}`));

  /* The mock vision provider. It answers the checklist the request carries and
     nothing else; what it OBSERVES is switched by a marker in the state notes,
     so every case below travels the real prompt, the real parser and the real
     contract. */
  const visionRequests = [];
  let visionModel = "";
  const provider = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/api/tags")
      return res.end(JSON.stringify({ models: [{ name: "b2a-vision-a" }, { name: "b2a-vision-b" }] }));
    if (req.method !== "POST" || req.url !== "/api/chat") { res.statusCode = 404; return res.end("{}"); }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const user = String(body.messages?.[1]?.content || "");
      visionRequests.push({ user, model: body.model });
      visionModel = body.model;
      const ids = [...user.matchAll(/^- (delta-\d+): (.+)$/gm)].map((match) => ({ id: match[1], text: match[2] }));
      const records = ids.map((row, index) => ({
        requirementId: row.id,
        feature: row.text,
        expectedFeature: "must-remain",
        observedFeature: index === 0 && user.includes("OBSERVE_ABSENT") ? "absent" : "present",
        observedCondition: index === 0
          ? user.includes("OBSERVE_ABSENT") ? "not-applicable"
            : user.includes("OBSERVE_UNREADABLE") ? "uncertain"
              : user.includes("OBSERVE_UNCHANGED") ? "different" : "as-required"
          : "as-required",
        evidence: "What the candidate shows.",
      }));
      const answer = {
        score: 96, pass: true,
        hardChecks: {
          sameUnderlyingEntity: { pass: true, note: "Same envelope." },
          onlyRequestedDelta: { pass: true, note: "Only the delta." },
        },
        stateMatch: { matchesRequestedState: true, closerState: "", note: "Opened." },
        categories: Object.fromEntries(["design", "state", "requirements", "usefulness", "cleanliness", "context"]
          .map((key) => [key, { severity: "pass", note: "Fine." }])),
        summary: "Attractive opened-envelope candidate.",
        recommendation: "approve",
        stateEvidence: records,
        parentDrift: user.includes("OBSERVE_DRIFT")
          ? [{ attribute: "color", parentValue: "red paper", candidateValue: "blue paper", evidence: "The body is blue." }]
          : [],
      };
      res.end(JSON.stringify({ message: { content: JSON.stringify(answer) } }));
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerPort = provider.address().port;

  const writeConfig = (visionModelName) => fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "b2a-project",
    ollamaUrl: `http://127.0.0.1:${providerPort}`,
    ollamaModel: "b2a-text",
    ollamaVisionModel: visionModelName,
    assistant: { provider: "ollama", visionProvider: "same" },
  }, null, 2));
  writeConfig("b2a-vision-a");

  const port = await freePort();
  let serverOutput = "";
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => (serverOutput += chunk));
  child.stderr.on("data", (chunk) => (serverOutput += chunk));

  const project = (marker) => ({
    meta: { id: "b2a-project", title: "B2a Envelope", format: "Test", version: "v1", hubVersion: "v5.5.0", aiPolicy: "project-default" },
    qcChecklist: [],
    scenes: [],
    shots: [],
    audio: [],
    mediaAssets: [],
    characters: [],
    locations: [],
    props: [{
      ...envelopeEntity(),
      continuityStates: [
        structuredClone(ENVELOPE_DEFAULT),
        { ...structuredClone(ENVELOPE_OPENED), notes: `${marker ? `${marker} ` : ""}${ENVELOPE_OPENED.notes}` },
      ],
      candidateFiles: [{ stored: "PROP-ENVELOPE-CANDIDATE.png", decision: "unreviewed", targetStateId: "state-opened" }],
    }],
    vehicles: [],
  });
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(project(""), null, 2));
  const currentRevision = () => `"${crypto.createHash("sha256").update(fs.readFileSync(path.join(PROJECT_DIR, "project.json"))).digest("hex")}"`;
  const putProject = (marker) => request(port, "/api/projects/b2a-project/project", {
    method: "PUT", headers: { "if-match": currentRevision() }, body: project(marker),
  });
  const reviewCandidate = () => request(port, "/api/llm/review-entity-candidate", {
    method: "POST",
    body: { list: "props", id: "PROP-ENVELOPE", fileName: "PROP-ENVELOPE-CANDIDATE.png", stateId: "state-opened" },
  });

  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      if (child.exitCode != null) throw new Error(`server exited early: ${serverOutput}`);
      try { if ((await request(port, "/api/projects")).status === 200) break; } catch (_) {}
      if (Date.now() > deadline) throw new Error(`server did not start: ${serverOutput}`);
      await delay(100);
    }

    /* --- the audit's own case, end to end ------------------------------- */
    assert.strictEqual((await putProject("OBSERVE_ABSENT")).status, 200);
    const absent = await reviewCandidate();
    assert.strictEqual(absent.status, 200);
    /* The checklist really did travel in the request the provider received. */
    const sent = visionRequests.at(-1).user;
    for (const row of REQUIREMENTS) assert(sent.includes(`- ${row.id}: `), `the request must carry ${row.id}`);
    assert.strictEqual(absent.data.review.score, 96, "the reviewer really did return 96");
    assert.strictEqual(absent.data.review.modelPass, true, "and really did claim a pass");
    assert.strictEqual(absent.data.review.pass, false, "the route must not record it as one");
    assert.strictEqual(absent.data.review.semanticOutcome, "issue");
    assert(absent.data.review.hardGateFailures.includes("declared-state-unsatisfied"));
    assert.deepStrictEqual(absent.data.declaredRequirements.map((row) => row.id), ["delta-1", "delta-2", "delta-3"]);
    note("route: the audit's 96/100 absent-seal candidate comes back NOT PASS from the real endpoint, with the requirement named");

    /* --- the same route, the other three semantics ---------------------- */
    assert.strictEqual((await putProject("OBSERVE_UNREADABLE")).status, 200);
    const unreadable = await reviewCandidate();
    assert.strictEqual(unreadable.data.review.semanticOutcome, "uncertain");
    assert.strictEqual(unreadable.data.review.pass, false);
    assert.strictEqual(unreadable.data.review.generationCorrectable, false);

    assert.strictEqual((await putProject("OBSERVE_UNCHANGED")).status, 200);
    const unchanged = await reviewCandidate();
    assert.strictEqual(unchanged.data.review.semanticOutcome, "issue");
    assert.strictEqual(unchanged.data.review.pass, false);

    assert.strictEqual((await putProject("OBSERVE_DRIFT")).status, 200);
    const drifted = await reviewCandidate();
    assert.strictEqual(drifted.data.review.semanticOutcome, "issue", "undeclared drift must block through the real route too");
    assert.strictEqual(drifted.data.review.stateEvidence.drift[0].attribute, "color");

    /* --- the positive control, through the real route ------------------- */
    assert.strictEqual((await putProject("")).status, 200);
    const good = await reviewCandidate();
    assert.strictEqual(good.data.review.semanticOutcome, "expected");
    assert.strictEqual(good.data.review.pass, true, "a satisfied derived state must still pass through the real route");
    note("route: unreadable evidence, an unmade change and undeclared drift all block; a satisfied derived state still passes");

    /* --- CASE 8: attribution is what actually served the review --------- */
    assert.strictEqual(good.data.reviewer.provider, "ollama");
    assert.strictEqual(good.data.reviewer.model, "b2a-vision-a");
    assert.strictEqual(visionModel, "b2a-vision-a", "the reported model must be the one the provider was actually asked for");

    /* Settings change. The NEXT review reports the new target — and the record
       the old review left behind must keep saying the old one, which part 3
       proves at the surface a person reads. */
    writeConfig("b2a-vision-b");
    const after = await reviewCandidate();
    assert.strictEqual(after.data.reviewer.model, "b2a-vision-b");
    assert.strictEqual(visionModel, "b2a-vision-b");
    note("CASE 8 (route half): the response reports the provider and model the request was actually dispatched to");

    /* Nothing spent. There is no paid route in this path, and no request left
       the two loopback listeners this suite owns. */
    assert(visionRequests.length >= 6, "every case must have reached the mock provider");
    assert(visionRequests.every((row) => typeof row.user === "string"));
    note(`route: ${visionRequests.length} vision requests, all to the local mock; no paid provider route exists on this path and none was called`);
  } finally {
    child.kill();
    await new Promise((resolve) => provider.close(resolve));
    fs.rmSync(TEMP, { recursive: true, force: true });
  }
}

/* ==========================================================================
   PART 3 — the real modal
   ========================================================================== */

function reviewRecord(overrides = {}) {
  const review = judgeWith(Contract, overrides.records || [
    observed(SEAL, "the wax seal", "must-remain", "absent", "not-applicable", "There is no wax seal on the envelope."),
    FLAP_OPEN(), ENVELOPE_SAME(),
  ], overrides.extra || {});
  return {
    ...review,
    stateId: "state-opened",
    stateName: "Opened",
    reviewedAt: "2026-08-01T10:00:00.000Z",
    inputLabels: [],
    reviewer: overrides.reviewer === null ? undefined : (overrides.reviewer || { provider: "ollama", model: "b2a-vision-a" }),
  };
}
function uiFixture(reviewOverrides = {}) {
  const project = buildFixture();
  project.props = [{
    ...envelopeEntity(),
    prefix: "PROP-ENVELOPE",
    candidateFiles: [{
      stored: "PROP-ENVELOPE-CANDIDATE.png",
      decision: "unreviewed",
      /* WHERE it is going. */
      targetStateId: "state-opened",
      targetStateName: "Opened",
      /* WHAT it is, which is a separate fact and is now written by the producer
         that made it. Before S1 no generated candidate carried this, so a row
         like this one was `undeclared` — and the approval control below would
         open a confirmation for a write the authority kernel then refused. That
         is the 2026-09-01 dogfood, and it is why the offer now fails closed.
         Declaring it here keeps this section testing what it is about — that a
         strong AI pass approves nothing and the human confirmation is what
         writes — rather than incidentally depending on a candidate CineBraid
         could not have approved. */
      coverageJobType: "single-reference",
      structuredReviews: { "state-opened": reviewRecord(reviewOverrides) },
    }],
  }];
  return project;
}
const uiScan = () => ({
  anchors: [], plates: [], vehicles: [], audio: [], media: [], shots: {},
  props: [
    { name: "PROP-ENVELOPE-SEALED.png", url: "/assets/props/PROP-ENVELOPE-SEALED.png" },
    { name: "PROP-ENVELOPE-CANDIDATE.png", url: "/assets/props/PROP-ENVELOPE-CANDIDATE.png" },
  ],
});

async function openModal(project, calls = [], mutateSource = null) {
  const rendered = await render("#/prop/PROP-ENVELOPE", project, {
    scan: uiScan(),
    ...(mutateSource ? { mutateSource } : {}),
    fetch: async (url, options, respond) => {
      calls.push(`${options?.method || "GET"} ${url}`);
      return null;
    },
  });
  vm.runInContext(`openEntityCandidateReview('props','PROP-ENVELOPE','PROP-ENVELOPE-CANDIDATE.png','state-opened')`, rendered.context);
  await delay(20);
  const html = vm.runInContext(`document.getElementById('modal') ? document.getElementById('modal').innerHTML : ''`, rendered.context);
  return { rendered, html };
}

async function uiSection(mutateSource = null) {
  /* The failing candidate, on the screen a director actually reads. */
  const failing = [];
  const { html } = await openModal(uiFixture(), failing, mutateSource);
  assert(html.includes("DECLARED STATE · EXPECTED vs OBSERVED"), "the modal must put the declared requirement beside the observation");
  assert(html.includes("DECLARED</em>Wax seal broken but still present"), "the declared expectation must be rendered verbatim");
  assert(html.includes("OBSERVED</em>absent"), "and the observation beside it");
  assert(html.includes("ISSUE"), "the outcome word must be on screen");
  assert(html.includes("must still be there to be in that condition"), "the modal must explain why absence is not the requested change");
  /* The exact sentence the audit screenshotted must not be reachable while a
     declared requirement is unsatisfied. */
  assert(!html.includes("All required gates passed"), "the audit's all-clear must not be reachable over an unsatisfied requirement");
  assert(html.includes("OVERALL RESULT"));
  assert(html.includes("<b>FLAG · DECLARED STATE ISSUE</b>"), "the semantic verdict must lead the overall result");

  /* The score is present, and demoted. */
  assert(html.includes("Supporting score 96/100"), "the score must remain available as context");
  assert(html.indexOf("<b>FLAG · DECLARED STATE ISSUE</b>") < html.indexOf("Supporting score 96/100"),
    "the semantic verdict must be read before the score, not after it");
  assert(html.includes("it cannot clear a declared requirement the candidate did not satisfy"),
    "and must say in words that it is not the decision");

  /* Human authority is a separate fact and stays undecided. */
  assert(html.includes("HUMAN DECISION"), "the human decision must remain its own panel");
  assert(html.includes("NO HUMAN DECISION YET"));
  assert(html.includes("The AI result is advisory."));
  assert(!failing.some((call) => /\/api\/generation\/fal\/jobs/.test(call)), "opening a review must not reach a paid route");

  /* Provenance: what served THIS review, from the record. */
  assert(html.includes("REVIEWED BY"));
  assert(html.includes("ollama · b2a-vision-a"), "the modal must name the provider and model that served this review");

  /* The same modal, with a review stored before attribution existed. It must
     say so rather than borrowing the currently configured model. */
  const legacy = await openModal(uiFixture({ reviewer: { provider: "", model: "" } }), [], mutateSource);
  assert(legacy.html.includes("Not recorded for this review"), "a review with no recorded reviewer must say so");
  assert(!legacy.html.includes("b2a-vision-a"), "and must not borrow an attribution from anywhere else");
  const configured = vm.runInContext(
    `(() => { CONFIG.assistant = { provider: "ollama", visionProvider: "same" }; CONFIG.ollamaVisionModel = "settings-model-changed-since"; `
    + `return entityReviewModalMarkup("props", P.props[0], { name: "PROP-ENVELOPE-CANDIDATE.png", url: "/x.png" }, entityStateById(P.props[0], "state-opened"), `
    + `P.props[0].candidateFiles[0].structuredReviews["state-opened"]); })()`,
    legacy.rendered.context,
  );
  assert(!configured.includes("settings-model-changed-since"),
    "a later Settings change must never become the attribution of a review that already ran");
  note("CASE 8 (surface half): the modal names the reviewer recorded with the review, says \"not recorded\" when there is none, and never substitutes the current Settings value");

  /* The positive control on screen: a satisfied derived state reads as one. */
  const good = await openModal(uiFixture({
    records: [
      observed(SEAL, "the wax seal", "must-remain", "present", "as-required", "Gold seal, cracked in two."),
      FLAP_OPEN(), ENVELOPE_SAME(),
    ],
  }), [], mutateSource);
  assert(good.html.includes("<b>PASS · DECLARED STATE EXPECTED</b>"), "a satisfied derived state must read as a pass");
  assert(good.html.includes("Every declared requirement was observed in the candidate."));
  assert(good.html.includes("All authority-comparison gates passed"), "the authority gates keep their own scoped answer");
  assert(good.html.includes("NO HUMAN DECISION YET"), "even a strong pass waits for a person");

  /* Uncertainty on screen. */
  const unsure = await openModal(uiFixture({
    records: [
      observed(SEAL, "the wax seal", "must-remain", "present", "uncertain", "The seal region is behind a fold."),
      FLAP_OPEN(), ENVELOPE_SAME(),
    ],
  }), [], mutateSource);
  assert(unsure.html.includes("<b>FLAG · DECLARED STATE UNCERTAIN</b>"), "uncertainty must reach the screen as uncertainty");
  assert(unsure.html.includes("UNCERTAIN"));
  assert(unsure.html.includes("condition could not be read"));
  assert(!unsure.html.includes("Supporting score 96/100") === false, "the score is still shown as context");
  note("UI: the modal renders a semantic PASS, a declared-condition ISSUE and an UNCERTAIN result, each leading its own overall line with the score underneath");

  /* Nothing here judges. Every word above came from the contract. */
  const source = fs.readFileSync(path.join(ROOT, "public", "review.js"), "utf8");
  for (const internal of ["must-remain", "must-disappear", "as-required"])
    assert(source.includes(internal), `the renderer needs the ${internal} vocabulary to put it in English`);
  assert(!/stateEvidence\.(findings|drift)\s*\.\s*(filter|some|every)\s*\([^)]*outcome\s*===/.test(source.replace(/\s+/g, " ")),
    "the modal must not re-decide an outcome the contract already decided");
  assert(source.includes("entityReviewOutcomeWord"), "outcome words must come from the shared continuity labels");
}

/* CASE 7 — the human-authority boundary, on the real client. */
async function humanAuthoritySection(mutateSource = null) {
  const project = uiFixture({
    records: [
      observed(SEAL, "the wax seal", "must-remain", "present", "as-required", "Broken."),
      FLAP_OPEN(), ENVELOPE_SAME(),
    ],
  });
  const rendered = await render("#/prop/PROP-ENVELOPE", project, { scan: uiScan(), ...(mutateSource ? { mutateSource } : {}) });
  const before = vm.runInContext(`(() => { const e = P.props[0]; const s = e.continuityStates.find(x => x.id === "state-opened");
    return { pass: e.candidateFiles[0].structuredReviews["state-opened"].pass, approved: s.approvedFile, decision: e.candidateFiles[0].decision,
      entityApproved: e.approvedFile, status: e.status || "" }; })()`, rendered.context);
  assert.strictEqual(before.pass, true, "the stored review really is a strong pass");
  assert.strictEqual(before.approved, "", "and nothing was approved by it");
  assert.strictEqual(before.decision, "unreviewed", "the candidate carries no human decision");
  assert.strictEqual(before.entityApproved, "PROP-ENVELOPE-SEALED.png", "the base approval is untouched");

  /* Opening and re-rendering the review changes no approval anywhere. */
  vm.runInContext(`openEntityCandidateReview('props','PROP-ENVELOPE','PROP-ENVELOPE-CANDIDATE.png','state-opened')`, rendered.context);
  await delay(20);
  const after = vm.runInContext(`(() => { const e = P.props[0]; const s = e.continuityStates.find(x => x.id === "state-opened");
    return { approved: s.approvedFile, decision: e.candidateFiles[0].decision }; })()`, rendered.context);
  assert.strictEqual(after.approved, "", "an AI pass must never perform the human approval by itself");
  assert.strictEqual(after.decision, "unreviewed", "and must not move the candidate's human decision either");

  /* The approval that does exist is a control a person presses, and even that
     only opens the confirmation — the write is behind a second deliberate act. */
  const modal = vm.runInContext(`document.getElementById('modal').innerHTML`, rendered.context);
  assert(/onclick="closeModal\(\);approveEntityFile\('props','PROP-ENVELOPE'/.test(modal),
    "approval must remain an explicit human control");
  vm.runInContext(`approveEntityFile('props','PROP-ENVELOPE','PROP-ENVELOPE-CANDIDATE.png','state-opened')`, rendered.context);
  await delay(20);
  const pending = vm.runInContext(`P.props[0].continuityStates.find(x => x.id === "state-opened").approvedFile`, rendered.context);
  assert.strictEqual(pending, "", "pressing approve opens the confirmation; it does not write the approval on its own");
  assert(vm.runInContext(`document.getElementById('modal').innerHTML`, rendered.context).includes("confirmEntityApproval"),
    "the confirmation step must be the thing that writes it");
  note("CASE 7: a strong AI pass approves nothing, and the approval control opens a human confirmation rather than writing the approval itself");
}

/* ==========================================================================
   THE GATE THIS BATCH MUST NOT HAVE TOUCHED
   ========================================================================== */

/* F-065's motion-readiness gate is a different instrument on a different
   review. B2a changes the ENTITY candidate reviewer; the gate reads the
   FRAME-SEQUENCE review and runs before the motion panel exists. Pinned here as
   well as in tests/generation-default-inheritance.js so a B2a regression is
   caught by B2a's own suite. */
function testMotionGateUntouched() {
  const studio = fs.readFileSync(path.join(ROOT, "public", "creation-studio.js"), "utf8").replace(/\r\n/g, "\n");
  const opener = studio.slice(studio.indexOf("window.openGuidedMotionFromFrames"));
  const gate = opener.indexOf('if (approvedCount >= 2 && !sequenceReview?.pass) return toast(');
  const navigates = opener.indexOf('c.deliveryIntent = "motion";');
  assert(gate > 0 && navigates > 0, "the motion-readiness gate and the navigation it protects must both still exist");
  assert(gate < navigates, "the readiness check must still run BEFORE the motion panel opens");
  /* And the gate's decision still comes from the frame-sequence review, not from
     anything B2a touched. */
  assert(/const sequenceReview = guidedFrameSequenceReviewState\(s, sequenceInputs\);/.test(opener.slice(0, navigates + 200)),
    "the gate must still take its go/no-go from the frame-sequence review");
  for (const b2a of ["stateEvidence", "semanticOutcome", "declaredRequirements", "reviewEntityCandidateOnce"])
    assert(!opener.slice(0, navigates + 400).includes(b2a), `the motion gate must not read ${b2a}`);
  note("non-scope: the FLF motion-readiness gate still runs before the motion panel and still decides from the frame-sequence review");
}

/* The same gate, exercised rather than read. A source-order assertion cannot
   tell a moved gate from a moved comment, so this drives the real navigation on
   a shot with two approved anchors and no passing readiness review and watches
   what actually happens. Exported so the negative controls can run it against a
   deliberately reordered copy of the studio. */
async function motionGateBehaviour(mutateSource = null) {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.creationBrief = { ...(shot.creationBrief || {}) };
  delete shot.creationBrief.deliveryIntent;
  /* No frame-sequence review at all: the gate's refusing condition. */
  delete shot.creationBrief.frameSequenceReview;
  const rendered = await render(`#/shot/${shot.id}`, project, mutateSource ? { mutateSource } : {});
  return vm.runInContext(`(() => {
    const shot = P.shots[0];
    const messages = [];
    const original = window.toast;
    window.toast = (message) => { messages.push(String(message)); };
    try {
      const creation = ensureShotCreation(shot);
      delete creation.deliveryIntent;
      const inputs = guidedFrameSequenceInputs(shot, takesFor(shot.id)) || [];
      const review = guidedFrameSequenceReviewState(shot, inputs);
      openGuidedMotionFromFrames(shot.id, 'create');
      return {
        approvedCount: inputs.length,
        reviewPassed: !!(review && review.pass),
        refused: messages.length > 0,
        navigated: ensureShotCreation(shot).deliveryIntent === 'motion',
      };
    } finally { window.toast = original; }
  })()`, rendered.context);
}
async function testMotionGateStillRefuses(mutateSource = null) {
  const result = await motionGateBehaviour(mutateSource);
  assert(result.approvedCount >= 2, "the fixture must actually reach the gate's condition, or nothing is being proved");
  assert.strictEqual(result.reviewPassed, false, "and must carry no passing readiness review");
  assert.strictEqual(result.navigated, false, "the motion panel must not open before the readiness gate has passed");
  assert.strictEqual(result.refused, true, "and the refusal must be told to the filmmaker");
  note(`non-scope (behaviour): ${result.approvedCount} approved anchors with no passing readiness review were refused and did not reach the motion panel`);
}

/* ------------------------------------------------------------------ run */

async function main() {
  testDeclaredRequirementsAreCineBraids();
  testAbsenceDoesNotSatisfyAChange();
  testRequiredDeltaNotObserved();
  testUncertaintyStaysUncertain();
  testUndeclaredParentDriftBlocks();
  testValidDerivedStatePasses();
  testScoreCannotOverrideSemantics();
  testAiVerdictIsAdvisory();
  testMotionGateUntouched();

  await testMotionGateStillRefuses();
  await routeSection();
  await uiSection();
  await humanAuthoritySection();

  console.log("Candidate review semantics passed: a declared requirement is compared against observed evidence, absence never satisfies a change, "
    + "uncertainty stays uncertain, undeclared parent drift blocks, a valid derived state still passes, no score can clear a failed requirement, "
    + "approval stays human, and reviewer attribution comes from what actually served the review.");
  for (const line of notes) console.log(`  - ${line}`);
}

/* The negative controls import these to run the real guards against a
   deliberately broken copy of the source. */
module.exports = {
  REQUIREMENTS, SEAL, FLAP, ENVELOPE, observed, FLAP_OPEN, ENVELOPE_SAME,
  reviewerResponse, validating, envelopeEntity,
  ENVELOPE_DEFAULT, ENVELOPE_OPENED,
  uiFixture, uiScan, openModal, reviewRecord,
  testAbsenceDoesNotSatisfyAChange, testUncertaintyStaysUncertain,
  testUndeclaredParentDriftBlocks, testScoreCannotOverrideSemantics,
  testValidDerivedStatePasses, uiSection, humanAuthoritySection,
  motionGateBehaviour, testMotionGateStillRefuses, testMotionGateUntouched,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
