/* CineBraid — Batch 2, Slice 3: THE REFERENCE REFRAME.
 *
 * PRIMARY REFERENCE -> WHAT THIS PRODUCTION NEEDS -> DETAILS & HISTORY.
 *
 * This slice is a presentation and workflow reframe over accepted Production
 * Truth. It moves no authority and it adds no persisted field, so most of what
 * this suite asserts is the NEGATIVE half of that claim: that the reframe left
 * the semantics it renders exactly where it found them.
 *
 * The one that matters most, and the reason section 2 is the longest:
 *
 *   shared-coverage.js resolves an UNAUTHORED coverage slot to `required`. The
 *   brief is explicit that flipping that default is not a casual UI change --
 *   it would move every legacy project's required count, and it reaches
 *   server.js, ofp/ofp-migrate-rules.js M015, coverage-automation.js,
 *   creation-studio.js and the Reference Inspector. Slice 3 did NOT flip it.
 *   What Slice 3 added is a projection -- coverageDemand() -- that renames the
 *   three shipped tokens into filmmaker language and orders the screen by them.
 *   Section 2 proves the projection can never disagree with the requirement, and
 *   that the requirement still answers what it always answered.
 *
 * Sections, mapped to the slice's acceptance list:
 *
 *   1  A/B  the primary reference is the default owning context, and candidate
 *           review is contextual to it rather than a peer stage
 *   2  D/E/G/H  the coverage projection, and the semantics it did not change
 *   3  C      approval authority is untouched, and nothing here approves
 *   4  E/F    unneeded coverage is not dumped, and it is not deleted either
 *   5  F/I/J  continuity states derive from the RECORDED parent, or say why not
 *   6  G/K    details, history and provenance survive under disclosure
 *   7  H/L    the completed-run hand-off reaches the surface that owns the result
 *   8  M/N/O/P no Slice 1/2 regression, no Slice 4/5 leakage, no schema addition
 *   9      typed identity — an id is not an identity, and production usage is
 *          never claimed for a collection that merely shares a name
 *
 * Provider calls: 0. Paid calls: 0. Nothing is written to any project on disk.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const { render, buildFixture, withCanon } = require("./render-harness");
const Coverage = require("../public/shared-coverage");

const notes = [];
const note = (line) => notes.push(line);

/* Comments name what they retired, so a source census that included prose would
   count the explanation as the thing. Same strip the Slice 2 suite uses. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

/* ---------------------------------------------------------------- detectors
   Lifted out so the negative controls test the SAME predicate the positive
   assertions rely on, rather than a lookalike that could pass while the real
   one fails. */
const detectors = {
  /* The declared peer stages, read out of entities.js's own `specs` array rather
     than restated here — a suite that restates the task set cannot notice the
     product changing it. */
  peerTaskIds(source) {
    const block = codeOnly(source);
    const start = block.indexOf("const specs = list === \"audio\"");
    const end = block.indexOf("const legacyMap", start);
    if (start < 0 || end < 0) return [];
    const region = block.slice(start, end);
    const nonAudio = region.slice(region.indexOf("] : ["));
    return [...nonAudio.matchAll(/\{id:"([a-z]+)",label:/g)].map((m) => m[1]);
  },
  /* Which markup the entity page renders BEFORE anything else inside the
     selected task. "Leads" is a claim about order, so it is measured as one. */
  leadsWith(html, marker) {
    const body = html.slice(html.indexOf('class="bounded-selected-task"'));
    const at = body.indexOf(marker);
    return at >= 0 && at < 400;
  },
  /* Order between two markers in the rendered task body. */
  order(html, first, second) {
    const body = html.slice(html.indexOf('class="bounded-selected-task"'));
    const a = body.indexOf(first);
    const b = body.indexOf(second);
    return a >= 0 && b >= 0 && a < b;
  },
  /* A `<details>` that is present and CLOSED. `includes("<details")` alone
     passes against an open one, which is the whole distinction section 4 is
     about.

     THE ANCHORING IS LOAD-BEARING, and N7 found it the hard way: `open` is the
     LAST attribute in the shipped markup, so the closing `>` is consumed by the
     outer pattern and there is no trailing character to match. A probe looking
     for `open` followed by whitespace or `>` therefore reported an open
     disclosure as closed — a detector that could not fail. `$` is the fix. */
  closedDisclosure(html, className) {
    const match = new RegExp(`<details class="[^"]*\\b${className}\\b[^"]*"([^>]*)>`).exec(html);
    return !!match && !/(^|\s)open(\s|=|$)/.test(match[1]);
  },
  presentDisclosure(html, className) {
    return new RegExp(`<details class="[^"]*\\b${className}\\b`).test(html);
  },
  /* The contextual continuity action, and the parent it names. Returns null when
     the action is absent, which is the answer sections 5 asserts for every case
     where a parent cannot be resolved. */
  generateFromParent(html, stateId) {
    const rows = [...html.matchAll(/<article class="entity-demand-row[^"]*"[^>]*data-demand-id="([^"]+)"[\s\S]*?<\/article>/g)];
    const row = rows.find((m) => m[1] === stateId);
    if (!row) return null;
    const button = /<button class="approve-btn" onclick="openContinuityStateVariant\('([^']*)','([^']*)','([^']*)'\)">Use approved ([^<]*?) reference to generate ([^<]*?)<\/button>/.exec(row[0]);
    if (!button) return null;
    return { list: button[1], entityId: button[2], stateId: button[3], parent: button[4], state: button[5] };
  },
  demandRow(html, id) {
    const rows = [...html.matchAll(/<article class="entity-demand-row[^"]*"[^>]*data-demand-id="([^"]+)"[\s\S]*?<\/article>/g)];
    const row = rows.find((m) => m[1] === id);
    return row ? row[0] : "";
  },
  /* Which surfaces expose a candidate approval control. Section B's claim is
     that there is exactly ONE owning surface, and that is a count, not a
     presence check. */
  approvalSurfaces(html) {
    const found = new Set();
    if (/class="[^"]*entity-candidate-section/.test(html)) found.add("candidate-section");
    /* A second candidate grid rendered anywhere outside that section would be a
       second home for the same decision. */
    for (const m of html.matchAll(/class="entity-media entity-candidate-grid"/g)) void m;
    return found;
  },
  /* Nothing from Slice 4 or Slice 5 may appear. Price, provider/model choice and
     shot-route vocabulary are the three the brief names.

     TWO FORMS DELIBERATELY, because one pattern cannot serve both: `\$\d` is the
     right price probe for rendered text and a false positive in source, where
     `$1` is a regex backreference and `${0}` an interpolation. A single loose
     pattern that fires on source noise is a control nobody can trust. */
  noLaterSliceVocabularyInSource(source) {
    return ![/\bdelivery\s*route\b/i, /\bshot\s*intent\b/i, /adaptive\s*execution/i, /simple\s*(vs\.?|\/)\s*advanced/i,
      /\brateSource\b/, /estimatedCostPerImage/, /falH3CostEstimate/, /\bper[- ]second\s*rate\b/i, /require\(.*generation-cost/]
      .some((pattern) => pattern.test(source));
  },
  noLaterSliceVocabularyInHtml(html) {
    return ![/\bdelivery\s*route\b/i, /\bshot\s*intent\b/i, /adaptive\s*execution/i, /simple\s*(vs\.?|\/)\s*advanced/i,
      /\$\d/, /\bper[- ]second\b/i, /\bestimated\s*cost\b/i]
      .some((pattern) => pattern.test(html));
  },
};

/* ------------------------------------------------------------------ fixtures

   One character carrying every case sections 2-5 need to tell apart, so a single
   render answers all of them and the suite cannot accidentally assert about a
   fixture that does not contain the case.

   THE COVERAGE MATRIX, deliberately spanning all four requirement SOURCES:
     front    declared "required"       -> Required,     confirmed
     profile  legacy boolean false      -> Recommended,  confirmed
     rear     declared "not-required"   -> Not needed,   confirmed
     overhead nothing declared at all   -> Required,     UNCONFIRMED

   `overhead` is the whole point. It is the unauthored slot whose default this
   slice refused to flip, and section 2 asserts it is still counted as required. */
function referenceFixture() {
  const project = buildFixture();
  const character = (project.characters || [])[0];
  character.id = "CHAR-REFRAME";
  character.prefix = "CHAR-REFRAME";
  character.anchorPrefix = "CHAR-REFRAME";
  character.name = "Nora Reframe";
  character.approvedFile = "CHAR-REFRAME-PRIMARY.png";
  character.coverageSlots = [
    { id: "front", label: "Front", requirement: "required", selectedFile: "" },
    { id: "profile", label: "Profile", required: false, selectedFile: "" },
    { id: "rear", label: "Rear", requirement: "not-required", selectedFile: "" },
    { id: "overhead", label: "Overhead / layout", selectedFile: "" },
  ];
  character.expressionSlots = [
    { id: "neutral", label: "Neutral", requirement: "not-required", selectedFile: "" },
  ];
  character.continuityStates = [
    { id: "state-default", name: "Clean overall", isDefault: true, approvedFile: "CHAR-REFRAME-PRIMARY.png", notes: "Primary identity." },
    /* DERIVABLE: parent recorded, and the parent is canon below. */
    { id: "state-soot", name: "Heavy soot", isDefault: false, parentStateId: "state-default", referenceRequirement: "required", notes: "Soot over every surface." },
    /* NOT DERIVABLE, and for three DIFFERENT reasons — sections 5's whole point. */
    { id: "state-orphan", name: "Torn sleeve", isDefault: false, parentStateId: "", referenceRequirement: "required", notes: "Left sleeve torn." },
    { id: "state-dangling", name: "Night lighting", isDefault: false, parentStateId: "state-does-not-exist", referenceRequirement: "required", notes: "Cold key." },
    { id: "state-unapproved", name: "Rain soaked", isDefault: false, parentStateId: "state-soot", referenceRequirement: "planned", notes: "Wet through." },
  ];
  character.candidateFiles = [
    { stored: "CHAR-REFRAME-FRONT-A.png", original: "CHAR-REFRAME-FRONT-A.png", decision: "unreviewed", targetStateId: "state-default" },
    { stored: "CHAR-REFRAME-FRONT-B.png", original: "CHAR-REFRAME-FRONT-B.png", decision: "unreviewed", targetStateId: "state-default" },
  ];
  character.made = [{ model: "fixture-model", files: "CHAR-REFRAME-PRIMARY.png", prompt: "a very long compiled provenance prompt", date: "2026-08-01" }];
  project.characters = [character];
  /* Only the DEFAULT state is canon. `state-soot` therefore has an approved
     parent and no approved image of its own, which is exactly the case section
     5 needs, and `state-unapproved` has a parent that is NOT canon. */
  withCanon(project, [
    { kind: "entity-state", list: "characters", entityId: "CHAR-REFRAME", stateId: "state-default", value: "CHAR-REFRAME-PRIMARY.png" },
  ]);
  return project;
}

function referenceScan(project) {
  const names = ["CHAR-REFRAME-PRIMARY.png", "CHAR-REFRAME-FRONT-A.png", "CHAR-REFRAME-FRONT-B.png"];
  const tiny = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3C/svg%3E";
  void project;
  return { anchors: names.map((name) => ({ name, url: `/assets/anchors/${name}`, thumb: tiny })), plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} };
}

const renderReference = (project, options = {}) =>
  render("#/character/CHAR-REFRAME", project, { scan: referenceScan(project), ...options });

/* ============================================================== 1 · A and B
   The primary reference is where a reference opens, and the candidates for it
   are on it. */
async function primarySection(options = {}) {
  const source = read("public/entities.js");

  const peers = detectors.peerTaskIds(source);
  assert.deepStrictEqual(peers, ["reference", "coverage", "details"],
    `the reference workspace must declare exactly three peer stages, got ${peers.join(", ") || "none"}`);
  assert.ok(!/label:manualFirstWorkflow\(\)\?"Choose & approve"/.test(source),
    "B: `Choose & approve` must no longer be a peer top-level production stage");
  assert.ok(codeOnly(source).includes('review:"reference"'),
    "B: the retired `review` id must resolve onto the reference that absorbed it, not dangle");

  /* NO STORAGE AT ALL — this is what a filmmaker opening a reference for the
     first time gets. The old default jumped to whichever stage reported
     attention, which for this fixture is the coverage matrix. */
  const fresh = await renderReference(referenceFixture(), options);
  const selected = /data-selected-task="([^"]+)"/.exec(fresh.html);
  assert.strictEqual(selected && selected[1], "reference",
    "A: a reference must open on the primary reference, not on whichever stage reports attention");

  assert.ok(detectors.leadsWith(fresh.html, "reference-primary-hero"),
    "A: the primary reference must LEAD its surface");
  assert.ok(fresh.html.includes('data-primary-standing="canon"'),
    "A: the surface must state the primary's standing, resolved from the receipt ledger");
  assert.ok(fresh.html.includes("CHAR-REFRAME-PRIMARY.png is the approved primary reference"),
    "A: and it must name the approved primary rather than merely asserting one exists");

  /* A: do not LEAD with the machinery. Each of these must still be reachable —
     section 6 proves that — but none of them may come first. */
  for (const [marker, what] of [
    ["entity-candidate-section", "the candidate grid"],
    ["reference-manual-hub", "the upload/organise hub"],
    ["reference-assisted-tools", "the assisted-generation tools"],
  ]) {
    assert.ok(detectors.order(fresh.html, "reference-primary-hero", marker),
      `A: ${what} must follow the primary reference, not precede it`);
  }
  assert.ok(!fresh.html.slice(fresh.html.indexOf('class="bounded-selected-task"')).includes("Generation records"),
    "A: generation provenance must not appear on the primary surface at all");

  /* B: the candidates are HERE, and they say whose they are. */
  assert.ok(fresh.html.includes("entity-candidate-section"),
    "B: candidate review must render on the reference that owns it");
  assert.ok(fresh.html.includes("CANDIDATES FOR THIS CHARACTER REFERENCE"),
    "B: the candidate grid must name the kind of reference it belongs to");
  assert.ok(fresh.html.includes("These are candidates for Nora Reframe"),
    "B: and it must name the reference itself, so the filmmaker knows whose candidates these are");
  assert.ok(fresh.html.includes('data-candidate-file="CHAR-REFRAME-FRONT-A.png"'),
    "B: with the actual candidate cards, not a link to somewhere else");

  /* B: ONE owning surface. Rendering the other two peer tasks must produce no
     candidate approval surface at all. */
  for (const task of ["coverage", "details"]) {
    const other = await renderReference(referenceFixture(), {
      ...options,
      storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-REFRAME": task },
    });
    assert.ok(!other.html.includes("entity-candidate-section"),
      `B: the ${task} stage must not offer a second home for candidate approval`);
  }

  note("1. A/B · three peer stages (reference/coverage/details); a reference opens on its primary, "
    + "which leads ahead of candidates, upload and assisted tools; the candidate grid renders on the "
    + "reference, names it, and exists on exactly one of the three stages");
}

/* =========================================================== 2 · D, E, G, H
   THE COVERAGE SEMANTIC GUARDRAIL. */
function coverageSection() {
  /* ---- H · the resolvers still answer what they answered ------------------
     Asserted as a behavioural matrix rather than as source text, because the
     claim is about answers and a comment-only edit must not fail it. */
  const matrix = [
    [{}, false, "required", "unspecified", "an unauthored slot is STILL REQUIRED — this is the default Slice 3 did not flip"],
    [{}, true, "required", "default-state", "the entity default state is always required"],
    [{ required: false }, false, "planned", "legacy-boolean", "a legacy false is planned, never not-required"],
    [{ required: true }, false, "required", "legacy-boolean", "a legacy true is required"],
    [{ requirement: "not-required" }, false, "not-required", "declared", "an affirmative not-required is honoured"],
    [{ requirement: "planned" }, false, "planned", "declared", "an affirmative planned is honoured"],
    [{ retired: true }, false, "not-required", "retired", "a retired slot is not a current need"],
    [{ referenceRequirement: "planned", requirement: "required" }, false, "planned", "declared", "the continuity spelling still outranks the coverage spelling"],
    [{ requirement: "nonsense" }, false, "required", "unspecified", "an unknown value is never coerced into a neighbour"],
  ];
  for (const [slot, isDefault, requirement, source, why] of matrix) {
    assert.strictEqual(Coverage.coverageRequirement(slot, isDefault), requirement, `H: ${why}`);
    assert.strictEqual(Coverage.requirementTrace(slot, isDefault).source, source, `H: ${why} (source)`);
  }

  /* ---- G · the counts a legacy project produces are unchanged -------------
     summariseCoverage is what every coverage fraction in the app is read off.
     These are the exact numbers a project with one of each source yields, and
     `overhead` — the unauthored slot — is counted in `required`. */
  const legacy = [
    { id: "front", requirement: "required" },
    { id: "profile", required: false },
    { id: "rear", requirement: "not-required" },
    { id: "overhead" },
    { id: "retired-view", retired: true },
  ];
  const summary = Coverage.summariseCoverage(legacy);
  assert.strictEqual(summary.required, 2, "G: the unauthored slot must still be counted as required (front + overhead)");
  assert.strictEqual(summary.planned, 1, "G: the legacy boolean must still be counted as planned");
  assert.strictEqual(summary.notRequired, 1, "G: the affirmative not-required must still be counted as such");
  assert.strictEqual(summary.total, 4, "G: retired slots must still be excluded from the active set");
  assert.strictEqual(summary.missingRequired, 2, "G: and the missing-required count must be unchanged");

  /* ---- D/E · the projection is a RENAME, and cannot disagree --------------
     Every input the requirement resolver can be given, run through both. The
     tier is derived from the requirement, so no input can produce a tier that
     contradicts it. */
  const tierFor = { required: "required", planned: "recommended", "not-required": "not-currently-needed" };
  const inputs = [...matrix.map(([slot, isDefault]) => [slot, isDefault]), [{ requirement: "required", required: false }, false], [null, false], [undefined, true]];
  for (const [slot, isDefault] of inputs) {
    const requirement = Coverage.coverageRequirement(slot, isDefault);
    const demand = Coverage.coverageDemand(slot, isDefault);
    assert.strictEqual(demand.requirement, requirement,
      "D: the demand projection must carry the requirement through unchanged");
    assert.strictEqual(demand.tier, tierFor[requirement],
      `D: ${requirement} must project to ${tierFor[requirement]} and to nothing else`);
  }
  assert.deepStrictEqual(Coverage.COVERAGE_DEMAND_TIERS, ["required", "recommended", "not-currently-needed"],
    "E: exactly three tiers, one per shipped requirement token — a fourth would be a new semantic");
  assert.strictEqual(Coverage.COVERAGE_DEMAND_TIERS.length, Coverage.COVERAGE_REQUIREMENTS.length,
    "E: the projection must be total over the requirement vocabulary and invent no extra state");
  assert.deepStrictEqual(Coverage.COVERAGE_DEMAND_TIERS.map(Coverage.coverageDemandLabel),
    ["Required", "Recommended", "Not currently needed"],
    "C: the filmmaker-facing words are exactly the three the brief names");

  /* ---- D · `confirmed` orders the screen and decides nothing --------------
     The unauthored slot is unconfirmed AND required. If those two ever collapse
     into one bit, the default flip has happened by accident. */
  const unauthored = Coverage.coverageDemand({});
  assert.strictEqual(unauthored.confirmed, false, "D: nobody authored this slot, and the projection says so");
  assert.strictEqual(unauthored.requirement, "required", "D: and it is required anyway — confirmation is not requirement");
  assert.strictEqual(unauthored.tier, "required", "D: so it is presented under Required, not hidden under Not currently needed");
  assert.strictEqual(Coverage.coverageDemand({ requirement: "required" }).confirmed, true,
    "D: a declared value is confirmed");
  assert.ok(!Coverage.CONFIRMED_DEMAND_SOURCES.includes("unspecified"),
    "D: `unspecified` is the absence of an assertion and can never count as one");

  /* ---- H · the writer is unchanged ---------------------------------------- */
  const slot = { id: "rear", required: true, referenceRequirement: "required" };
  assert.strictEqual(Coverage.writeCoverageRequirement(slot, "not-required"), "not-required");
  assert.deepStrictEqual(Object.keys(slot).sort(), ["id", "requirement"],
    "H: the canonical writer must still leave exactly one encoding behind");

  note("2. D/E/G/H · the unauthored-slot default was NOT flipped: it still resolves `required` from source "
    + "`unspecified`, still counts in summariseCoverage, and is still presented under Required. The demand "
    + "projection is a total rename of the three shipped tokens and carries the requirement through unchanged; "
    + "`confirmed` is a separate bit that orders the screen and decides nothing");
}

/* ================================================================= 3 · C, D
   Approval authority, untouched — and nothing on the new surfaces approves. */
async function authoritySection(options = {}) {
  const source = read("public/entities.js");
  const body = codeOnly(source);

  /* The approval act still goes through the shipped writers and no others. */
  for (const writer of ["approveEntityFile", "requestHumanEntityCandidateApproval", "setEntityCandidateDecision"]) {
    assert.ok(body.includes(writer), `C: the shipped approval writer ${writer} must still exist`);
  }
  /* Standing is still ASKED of the truth projection, never recomputed. */
  assert.ok(body.includes("function entityStateTruth"), "C: standing must still be resolved through entityStateTruth");
  assert.ok(/entityProductionTruth\(P, list, entity && entity\.id\)/.test(body),
    "C: which must still delegate to the production-truth projection rather than reading pointers");

  /* The new surfaces must contain no approval control of their own. */
  const hero = /function referencePrimaryHeroMarkup[\s\S]*?\n}/.exec(body);
  const demand = /function entityDemandActionMarkup[\s\S]*?\n}/.exec(body);
  assert.ok(hero && demand, "C: the two new surfaces must be locatable for inspection");
  assert.ok(!/humanApproved|productionAuthority|recordCanon|approveCoverageCandidate/.test(demand[0]),
    "D: the demand surface must contain no approval writer — it points at work, it never authorises any");
  /* The hero DOES offer approveEntityFile, and that is correct: it is the
     shipped human approval of the primary, reached one click sooner. What it
     must not do is approve without one. */
  assert.ok(!/humanApproved\s*=|productionAuthority\.receipts\.push/.test(hero[0]),
    "C: the primary hero must not write an approval itself — it invokes the shipped one");

  /* D · RENDERING APPROVES NOTHING. Read the page's OWN project, not the
     fixture that was handed in: the harness clones, so comparing the input to
     itself is vacuously true. */
  const project = referenceFixture();
  const before = JSON.stringify(project);
  /* The receipts the fixture ARRIVES with. Asserting a fixed number here would
     pin the shared fixture's own ledger size rather than this slice's behaviour;
     the claim is that rendering ADDS none. */
  const receiptsBefore = project.productionAuthority.receipts.length;
  const rendered = await renderReference(project, options);
  const after = vm.runInContext("JSON.stringify(P)", rendered.context);
  const receipts = JSON.parse(vm.runInContext("JSON.stringify(P.productionAuthority.receipts)", rendered.context));
  assert.strictEqual(before, JSON.stringify(project), "D: the fixture handed in must be untouched");
  assert.strictEqual(receipts.length, receiptsBefore,
    "D: rendering the reframed surfaces must create no authority receipt — a Recommended need is not an approval");
  const canonStates = JSON.parse(vm.runInContext(
    `JSON.stringify(entityStateListRead(P.characters[0], true).map((s) => [s.id, entityStateTruth("characters", P.characters[0]).of(s).standing]))`,
    rendered.context));
  assert.deepStrictEqual(canonStates, [
    ["state-default", "canon"], ["state-soot", "missing"], ["state-orphan", "missing"],
    ["state-dangling", "missing"], ["state-unapproved", "missing"],
  ], "D: exactly one state is canon after render, and no required or recommended state became canon by being displayed");
  assert.ok(after.includes("CHAR-REFRAME"), "D: (sanity) the page's own project was actually read");

  note("3. C/D · the shipped approval writers and the truth projection are unchanged; the two new surfaces "
    + "carry no approval writer of their own; rendering creates no receipt and promotes no required or "
    + "recommended item to canon");
}

/* ================================================================ 4 · E, F
   What this production needs — and what it declines to dump. */
async function demandSection(options = {}) {
  const rendered = await renderReference(referenceFixture(), {
    ...options,
    storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-REFRAME": "coverage" },
  });
  const html = rendered.html;

  assert.ok(detectors.leadsWith(html, "entity-demand"),
    "C: the demand list must lead the coverage surface");
  assert.ok(detectors.order(html, "entity-demand", "entity-coverage-detail"),
    "E: and the detail boards must follow it");

  /* E/F · the boards do not arrive uninvited — they are not even rendered. */
  assert.ok(html.includes('data-coverage-detail-open="0"'),
    "F: angles, expressions and continuity-state boards must not be dumped into the default workflow");
  assert.ok(!/data-entity-subworkspace=/.test(html),
    "F: and while closed they must not be rendered at all, not merely hidden");
  /* ...and they are not deleted either: the way in is present and says what it opens. */
  assert.ok(/class="entity-coverage-detail-toggle" aria-expanded="false"/.test(html),
    "E: the deeper coverage capability must remain reachable, not removed");
  assert.ok(html.includes("Angles, expressions and continuity states"),
    "E: and the control must name what it opens");

  /* E · and OPENING it renders the boards in full. Without this the assertion
     above would be satisfied by a product that had simply deleted them. */
  const opened = await renderReference(referenceFixture(), {
    ...options,
    storage: {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-REFRAME": "coverage",
      "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-REFRAME": "states",
    },
  });
  assert.ok(opened.html.includes('data-coverage-detail-open="1"'),
    "E: an explicitly selected sub-view must open the coverage detail — this is also the Slice 1 hand-off path");
  assert.ok(/data-entity-subworkspace="states"/.test(opened.html),
    "E: and render the board that was selected");
  for (const label of ["Angles / views", "Expressions", "Continuity states"]) {
    assert.ok(opened.html.includes(label), `E: every coverage board must remain reachable (${label})`);
  }

  /* E · THE TRUTHFULNESS CLAIM, and it is asserted against an INDEPENDENT
     recomputation rather than against hard-coded numbers.

     Hard-coded expectations here would pin the shared fixture's coverage
     template, not this slice's behaviour — and the template is reconciled during
     project normalization, so the fixture's own slot set is not stable input.
     What must be true regardless is that the three groups on screen are exactly
     what coverageRequirement() answers for the same items. This walks the
     project inside the page with the shipped resolver and requires the DOM to
     agree with it. */
  const independent = JSON.parse(vm.runInContext(`(() => {
    const entity = P.characters[0];
    const tier = { required: "required", planned: "recommended", "not-required": "not-currently-needed" };
    const tally = { required: 0, recommended: 0, "not-currently-needed": 0 };
    const each = (item, isDefault) => { tally[tier[coverageRequirement(item, isDefault)]] += 1; };
    for (const state of entityStateListRead(entity, true)) { if (!state.isDefault) each(state, false); }
    for (const slot of ensureCoverageSlots("characters", entity)) { if (slot && !slot.retired) each(slot); }
    for (const slot of ensureExpressionSlots(entity)) { if (slot && !slot.retired) each(slot); }
    return JSON.stringify(tally);
  })()`, rendered.context));

  const counts = /data-demand-required="(\d+)" data-demand-missing="(\d+)" data-demand-recommended="(\d+)" data-demand-not-needed="(\d+)"/.exec(html);
  assert.ok(counts, "C: the demand surface must publish its own counts for inspection");
  const [, required, missing, recommended, notNeeded] = counts.map(Number);
  assert.strictEqual(required, independent.required,
    `E: Required must be exactly what coverageRequirement() calls required, got ${required} vs ${independent.required}`);
  assert.strictEqual(recommended, independent.recommended,
    `E: Recommended must be exactly what it calls planned, got ${recommended} vs ${independent.recommended}`);
  assert.strictEqual(notNeeded, independent["not-currently-needed"],
    `E: Not currently needed must be exactly what it calls not-required, got ${notNeeded} vs ${independent["not-currently-needed"]}`);
  assert.ok(required > 0 && recommended > 0 && notNeeded > 0,
    "E: (sanity) the fixture must actually exercise all three tiers, or the equality above proves nothing");
  assert.strictEqual(missing, required,
    "E: nothing in this fixture is satisfied, so every required item must read as still needed");

  /* E · and row by row, for the three slots this fixture authored deliberately.
     `profile` is the interesting one: a legacy `required: false` boolean, which
     must still read as Recommended and must never be promoted to an affirmative
     "not currently needed" — that is the exact invention shared-coverage.js's
     LEGACY_FALSE_REQUIREMENT note refuses. */
  const authored = [
    ["front", "required", "a declared required view"],
    ["profile", "recommended", "a legacy `required: false` boolean, which is planned and not not-required"],
    ["rear", "not-currently-needed", "an affirmative not-required view"],
  ];
  for (const [id, tier, why] of authored) {
    const row = detectors.demandRow(html, id);
    assert.ok(row, `E: ${why} must appear on the surface at all`);
    assert.ok(row.includes(`data-demand-tier="${tier}"`), `E: ${why} must present as ${tier}`);
    const resolved = vm.runInContext(
      `coverageRequirement(ensureCoverageSlots("characters", P.characters[0]).find((s) => s.id === ${JSON.stringify(id)}))`,
      rendered.context);
    assert.strictEqual({ required: "required", planned: "recommended", "not-required": "not-currently-needed" }[resolved], tier,
      `E: and the tier shown for ${id} must be the rename of what the resolver answered (${resolved})`);
  }

  /* G · NOTHING WAS WEAKENED. Not one item that coverageRequirement() calls
     required may be presented as anything other than Required. */
  const weakened = [...html.matchAll(/data-demand-id="([^"]+)"/g)].map((m) => m[1]).filter((id) => {
    const shown = /data-demand-tier="([^"]+)"/.exec(detectors.demandRow(html, id));
    const truth = vm.runInContext(`(() => {
      const entity = P.characters[0];
      const state = entityStateListRead(entity, true).find((s) => s.id === ${JSON.stringify(id)});
      if (state) return coverageRequirement(state, !!state.isDefault);
      const slot = [...ensureCoverageSlots("characters", entity), ...ensureExpressionSlots(entity)].find((s) => s && s.id === ${JSON.stringify(id)});
      return slot ? coverageRequirement(slot) : "";
    })()`, rendered.context);
    return truth === "required" && shown && shown[1] !== "required";
  });
  assert.deepStrictEqual(weakened, [],
    `G: these required items were presented as something weaker: ${weakened.join(", ")}`);

  /* F · Recommended and Not currently needed are present, counted and COLLAPSED. */
  assert.ok(detectors.closedDisclosure(html, "entity-demand-group"),
    "F: material that is not currently required must be collapsed rather than dumped");
  for (const label of ["Recommended", "Not currently needed"]) {
    assert.ok(html.includes(`<summary>${label} <span>`), `F: ${label} material must still be present and counted`);
  }
  /* D · confirmation travels to the markup as its own bit, separate from tier.
     A surface that fused the two would be the accidental default flip. */
  assert.ok(/data-demand-confirmed="[01]"/.test(html),
    "D: each row must record whether anybody authored its requirement");
  assert.ok(detectors.demandRow(html, "front").includes('data-demand-confirmed="1"'),
    "D: a declared requirement is confirmed");

  note(`4. C/E/F · the demand list leads and the angle/expression/state boards sit behind a closed disclosure `
    + `without being removed; the three groups on screen (${required} required, ${recommended} recommended, `
    + `${notNeeded} not currently needed) equal an independent walk of the project through coverageRequirement(); `
    + `no required item is presented as anything weaker; a legacy \`required: false\` reads Recommended and never `
    + `Not currently needed`);
}

/* =============================================================== 5 · F, I, J
   Continuity states are downstream of an approved primary, and no parent is
   ever guessed. */
async function continuitySection(options = {}) {
  const rendered = await renderReference(referenceFixture(), {
    ...options,
    storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-REFRAME": "coverage" },
  });
  const html = rendered.html;

  /* I · the one state whose parent is BOTH recorded and canon. */
  const action = detectors.generateFromParent(html, "state-soot");
  assert.ok(action, "I: a required state with an approved parent must offer the contextual generate action");
  assert.strictEqual(action.parent, "Clean overall",
    "I: and it must name the ACTUAL recorded parent, not a placeholder");
  assert.strictEqual(action.state, "Heavy soot", "I: and the state it would produce");
  assert.deepStrictEqual([action.list, action.entityId, action.stateId], ["characters", "CHAR-REFRAME", "state-soot"],
    "I: the action must target the state it is offered for");
  assert.ok(detectors.demandRow(html, "state-soot").includes("Derives from Clean overall"),
    "I: and the row must state the lineage it is about to use");

  /* J · three DIFFERENT ways a parent cannot be resolved, and not one of them
     may be answered with a guess. The default state exists and is canon in this
     fixture, so a guessing implementation would happily offer it for all three. */
  const unguessable = [
    ["state-orphan", "records no parent at all", "Record what this state derives from", "Source not recorded"],
    ["state-dangling", "records a parent that does not exist", "Record what this state derives from", "Source not recorded"],
    ["state-unapproved", "records a parent that is not canon", "Approve the parent state first", "Heavy soot is not approved"],
  ];
  for (const [stateId, why, expectedAction, expectedStatus] of unguessable) {
    assert.strictEqual(detectors.generateFromParent(html, stateId), null,
      `J: a state that ${why} must not be offered a parent to derive from`);
    const row = detectors.demandRow(html, stateId);
    assert.ok(row, `J: but the state that ${why} must still be visible`);
    assert.ok(row.includes(expectedAction), `J: it must offer the way forward instead (${expectedAction})`);
    assert.ok(row.includes(expectedStatus), `J: and say why it is blocked (${expectedStatus})`);
    assert.ok(!row.includes("Clean overall"),
      `J: and it must never name the default state as this state's parent — that is the guess`);
  }

  /* J · a dangling parent must not be silently reparented onto the default,
     which is the entity-side MB-PT-04 defect. */
  const dangling = JSON.parse(vm.runInContext(
    `JSON.stringify(entityStateParentSummary(P.characters[0], entityStateListRead(P.characters[0], true).find((s) => s.id === "state-dangling")))`,
    rendered.context));
  assert.strictEqual(dangling.parent, null, "J: a dangling parent resolves to no parent");
  assert.strictEqual(dangling.broken, true, "J: and it is reported as broken rather than substituted");

  /* F · viewing the option mutates nothing. openContinuityStateVariant is the
     action the row invokes, and it is a navigation, not a declaration. */
  const beforeStates = vm.runInContext("JSON.stringify(P.characters[0].continuityStates)", rendered.context);
  vm.runInContext(`openContinuityStateVariant("characters","CHAR-REFRAME","state-soot")`, rendered.context);
  const afterStates = vm.runInContext("JSON.stringify(P.characters[0].continuityStates)", rendered.context);
  assert.strictEqual(afterStates, beforeStates,
    "F: opening the state workflow must write nothing — not a parent, not a generation mode, not an approval");

  note("5. F/I/J · the one state with a recorded AND canon parent offers `Use approved Clean overall reference "
    + "to generate Heavy soot`; the three unresolvable cases (no parent, dangling parent, unapproved parent) "
    + "each get their own explanation and none is offered the default state as a guess; opening the workflow "
    + "writes nothing");
}

/* ================================================================ 6 · G, K
   Details, history and provenance survive — progressively disclosed. */
async function detailsSection(options = {}) {
  const rendered = await renderReference(referenceFixture(), {
    ...options,
    storage: {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-REFRAME": "details",
      "cinebraid-bounded:fixture:selected:entity-detail-view:characters:CHAR-REFRAME": "history",
    },
  });
  const html = rendered.html;

  /* K · none of the evidence was deleted. */
  assert.ok(html.includes("Generation records — provenance"), "K: generation provenance must remain available");
  /* The record's own fields, which is the evidence. The model is a <select> over
     P.meta.models, so asserting the model NAME here would be asserting the
     fixture's model catalogue rather than that the record survived. */
  assert.ok(html.includes('value="CHAR-REFRAME-PRIMARY.png"'), "K: including which file the record accounts for");
  assert.ok(html.includes("2026-08-01"), "K: and when it was made");
  assert.ok(html.includes("a very long compiled provenance prompt"), "K: and the exact prompt used");
  assert.ok(html.includes("Details") && html.includes("History"), "K: both detail views must remain reachable");

  /* G · but the wall of prompt text no longer opens by default. */
  assert.ok(detectors.presentDisclosure(html, "compact-entity-section"),
    "G: provenance must live inside a disclosure");
  assert.ok(!/<details class="fold compact-entity-section" open><summary>Generation records/.test(html),
    "G: and that disclosure must not be open by default");

  note("6. G/K · generation records, the files they account for, their dates and their exact prompts are all "
    + "still present and reachable, inside a disclosure that no longer opens by default");
}

/* ============================================================== 7 · H and L
   The completed-run hand-off reaches the surface that owns the result. */
function handoffSection() {
  const activity = codeOnly(read("public/live-activity.js"));
  const entities = read("public/entities.js");

  const map = /const V670_ENTITY_SCOPE_TASKS = \{([\s\S]*?)\};/.exec(activity);
  assert.ok(map, "L: the entity scope map must be locatable");
  assert.ok(/"default-only":\s*\{\s*task:\s*"reference"\s*\}/.test(map[1]),
    "L: a completed base-reference run must hand off to the reference that owns its candidates");
  assert.ok(/"state-chain":\s*\{\s*task:\s*"coverage",\s*view:\s*"states"\s*\}/.test(map[1]),
    "L: and a state chain must still reach the states surface — Slice 1's rule is unchanged");

  /* L · every task the hand-off can name must be a task the workspace declares.
     This is the property that fails SILENTLY: boundedFocusedTask substitutes a
     fallback for an unknown id, so a stale target lands somewhere plausible. */
  const declared = detectors.peerTaskIds(entities);
  const targets = [...map[1].matchAll(/task:\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 2, "L: the map must still name targets");
  for (const target of targets) {
    assert.ok(declared.includes(target),
      `L: the hand-off names "${target}", which the reference workspace does not declare (${declared.join(", ")})`);
  }

  /* H · and it is still applied through the entity workspace's own writer, in
     the focused-task namespace rather than the silent bounded-state one. */
  assert.ok(/boundedWriteFocusedTask\("entity-task"/.test(entities),
    "H: task selection must still go through boundedWriteFocusedTask");
  assert.ok(activity.includes("selectEntityResultTask(list, id, target.task, target.view, target.state)"),
    "H: the drawer must still apply the target through the entity workspace's own writer");
  /* And the retired id must still be reachable, so a run recorded before this
     slice does not strand. */
  assert.ok(codeOnly(entities).includes('review:"reference"'),
    "L: a pre-Slice-3 selection naming `review` must still resolve");

  note("7. H/L · `default-only` -> reference, `state-chain` -> coverage/states; every task the hand-off can "
    + "name is one the workspace declares; the writer and its namespace are unchanged; the retired `review` "
    + "id still resolves");
}

/* =========================================================== 8 · M, N, O, P
   No regression into the closed slices, no leakage from the open ones. */
async function boundarySection(options = {}) {
  const entities = read("public/entities.js");
  const activity = read("public/live-activity.js");
  const coverage = read("public/shared-coverage.js");

  /* M · Slice 1. The reference page must not have regrown an embedded timeline
     or a second global indicator. */
  const rendered = await renderReference(referenceFixture(), options);
  assert.ok(!rendered.html.includes("automation-live-activity"),
    "M: Slice 1's compact run state must survive — no embedded timeline may return to the reference page");
  /* Comments name what they retired, so this asks the CODE. Slice 1's own suite
     draws the same distinction at tests/quiet-shell.js:115. */
  assert.ok(!/automation-global-live-strip/.test(codeOnly(activity)),
    "M: Slice 1 retired the floating strip and it must stay retired");
  assert.ok(activity.includes("v670AnnounceActivityUpdate"),
    "M: and the aria-live announcement Slice 1 kept must still be there");

  /* N · Slice 2. This slice touched neither the entry surface nor the single
     project-level derivation it landed on. */
  const creation = read("public/creation-studio.js");
  assert.ok(creation.includes("projectNextProductionAction"),
    "N: the post-import landing must still read the single project-level derivation");
  assert.ok(!/function projectNextProductionAction/.test(creation),
    "N: and must still not define a second one");
  assert.ok(creation.includes("creationRecommendedActionMarkup"),
    "N: Slice 2's shared landing renderer must be intact");

  /* O · no Slice 4 or Slice 5 vocabulary anywhere this slice touched. */
  for (const [file, source] of [["entities.js", entities], ["shared-coverage.js", coverage]]) {
    assert.ok(detectors.noLaterSliceVocabularyInSource(source),
      `O: ${file} must contain no shot-route, price or Simple/Advanced vocabulary`);
  }
  assert.ok(detectors.noLaterSliceVocabularyInHtml(rendered.html),
    "O: and none of it may reach the rendered reference page");
  assert.ok(!/resolveTaskModes|deliveryIntent|SHOT_STAGE/.test(codeOnly(entities)),
    "O: the reference workspace must not have learned the shot stage vocabulary");

  /* P · no persistent schema addition. The three fields the demand surface reads
     are all pre-existing, and nothing new is written. */
  const schema = read("ofp/ofp-schema.js");
  for (const invented of ["demandTier", "coverageDemand", "confirmedDemand", "productionDemand", "primaryStanding"]) {
    assert.ok(!schema.includes(invented), `P: ${invented} must not have been added to the persistent format`);
    assert.ok(!new RegExp(`\\.${invented}\\s*=`).test(entities), `P: and nothing may write ${invented} onto a record`);
  }
  /* The projection is DERIVED on every call and never stored. */
  assert.ok(!/\.demand\s*=|slot\.tier\s*=|state\.tier\s*=/.test(codeOnly(coverage) + codeOnly(entities)),
    "P: the demand tier must be derived on read and never persisted beside the fact it came from");

  note("8. M/N/O/P · no embedded timeline or second indicator returned (Slice 1); the entry surface still reads "
    + "the one project-level derivation and defines no second (Slice 2); no shot-route, price or "
    + "Simple/Advanced vocabulary reached the files this slice touched; no persistent field was added and the "
    + "demand tier is never stored");
}

/* ==================================================== 9 · TYPED IDENTITY
   AN ENTITY ID IS NOT AN ENTITY IDENTITY.

   The defect the Codex acceptance pass reproduced: entityProductionUse() matched
   dependency rows on `row.id` alone and ignored `row.type`, so a shot that
   referenced only the CHARACTER `X` made the PROP `X` and the LOCATION `X` each
   headline "Used by 1 shot in this production" on their own default Reference
   surface — the first line a filmmaker read about a reference was a claim about
   a different entity that merely shared a name.

   Nothing about the fix is new vocabulary. shared-entities.js already resolves a
   `type` for every row and already de-duplicates on `${resolvedType}:${rawId}`;
   the matcher now uses the same pair that module keys its own map on.

   The matrix below is deliberately built so that an id-only matcher passes NONE
   of cases 1-4 and a type-only matcher passes none of 1-3 either. */

/* A project in which one id is placed in several collections at once, with
   `shots` naming exactly the typed dependencies asked for. Everything else comes
   from the shared fixture so this is a real project, not a stub. */
function collisionProject({ id = "X-COLLIDE", collections = ["characters", "locations", "props", "vehicles"], shots = [] } = {}) {
  const project = referenceFixture();
  const base = project.shots[0] || {};
  const named = { characters: "Colliding character", locations: "Colliding location", props: "Colliding prop", vehicles: "Colliding vehicle" };
  for (const list of ["characters", "locations", "props", "vehicles"]) {
    project[list] = collections.includes(list)
      ? [{ id, name: named[list], continuityStates: [{ id: "state-default", name: "Default", isDefault: true }] }]
      : [];
  }
  /* Each entry is one shot and names its dependencies BY TYPE, through the exact
     shot fields shotDependencyRecords() reads. `propIds` is the shipped
     `prop-or-vehicle` request, which the resolver narrows itself. */
  project.shots = shots.map((spec, index) => ({
    ...base,
    id: `X1-${String(index + 1).padStart(2, "0")}`,
    characters: spec.characters || [],
    codes: [],
    audio: {},
    clips: [],
    creationBrief: {
      locationId: spec.location || "",
      propIds: spec.propIds || [],
      vehicleIds: spec.vehicleIds || [],
    },
  }));
  return project;
}

/* Ask the page itself, through the shipped function, for every collection at
   once. One render answers a whole row of the matrix. */
async function usageFor(project, id, options = {}) {
  const rendered = await render(`#/character/${id}`, project, { scan: referenceScan(project), ...options });
  return JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const answer = {};
    for (const list of ["characters", "locations", "props", "vehicles"]) {
      const entity = (P[list] || []).find((row) => row && row.id === ${JSON.stringify(id)});
      answer[list] = entity ? entityProductionUse(list, entity).shots : null;
    }
    return answer;
  })())`, rendered.context));
}

async function typedIdentitySection(options = {}) {
  const ID = "X-COLLIDE";

  /* ---- 1-3 · one typed reference, three collections holding the id --------
     Exactly one of them may report usage, and it must be the one the shot named.
     An id-only matcher reports 1/1/1 on every row of this table. */
  const single = [
    ["a character", { characters: [ID] }, { characters: 1, locations: 0, props: 0, vehicles: 0 }],
    ["a location", { location: ID }, { characters: 0, locations: 1, props: 0, vehicles: 0 }],
    ["a prop", { propIds: [ID] }, { characters: 0, locations: 0, props: 1, vehicles: 0 }],
    ["a vehicle", { vehicleIds: [ID] }, { characters: 0, locations: 0, props: 0, vehicles: 1 }],
  ];
  for (const [what, shot, expected] of single) {
    /* The vehicle case must not have a prop of the same id present, because the
       shipped `prop-or-vehicle` resolver narrows to whichever collection holds
       the entity and checks props first — case 4 covers that on purpose. */
    const collections = shot.vehicleIds ? ["characters", "locations", "vehicles"] : ["characters", "locations", "props", "vehicles"];
    const seen = await usageFor(collisionProject({ id: ID, collections, shots: [shot] }), ID, options);
    for (const [list, count] of Object.entries(expected)) {
      if (seen[list] === null) continue;
      assert.strictEqual(seen[list], count,
        `a shot referencing ${what} ${ID} must report ${count} for ${list}, got ${seen[list]} — an id is not an identity`);
    }
  }

  /* ---- 1b · the OTHER half of identity: same type, different entity -------
     The table above holds one entity per collection, so a matcher that kept the
     type and threw the id away would pass all of it. Identity is both halves,
     and this is the half a cross-type matrix cannot see: two characters, one
     referenced, and the other must stay at zero. */
  const sameType = collisionProject({ id: ID, collections: ["characters"], shots: [{ characters: [ID] }] });
  sameType.characters.push({
    id: "Y-OTHER", name: "Unreferenced character",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true }],
  });
  const pair = await render(`#/character/Y-OTHER`, sameType, { scan: referenceScan(sameType), ...options });
  const bothCharacters = JSON.parse(vm.runInContext(`JSON.stringify({
    referenced: entityProductionUse("characters", P.characters.find((row) => row.id === ${JSON.stringify(ID)})).shots,
    unreferenced: entityProductionUse("characters", P.characters.find((row) => row.id === "Y-OTHER")).shots,
  })`, pair.context));
  assert.strictEqual(bothCharacters.referenced, 1,
    "1b: the character the shot named must report its usage");
  assert.strictEqual(bothCharacters.unreferenced, 0,
    "1b: and a different character of the SAME type must report zero — the type is only half the identity");
  assert.ok(pair.html.includes("No shot references this character yet"),
    "1b: and the unreferenced character's own surface must say so");

  /* ---- 4 · several typed references, all colliding on one id -------------- */
  const many = await usageFor(collisionProject({
    id: ID,
    collections: ["characters", "locations", "props", "vehicles"],
    shots: [{ characters: [ID], location: ID }],
  }), ID, options);
  assert.strictEqual(many.characters, 1, "4: the referenced character identity is counted");
  assert.strictEqual(many.locations, 1, "4: the referenced location identity is counted");
  assert.strictEqual(many.props, 0, "4: the prop sharing that id was never referenced");
  assert.strictEqual(many.vehicles, 0, "4: neither was the vehicle");

  /* The shipped `prop-or-vehicle` narrowing, asserted as the behaviour it is
     rather than changed: `propIds` resolves against props FIRST, so with the id
     in both collections the prop is the identity referenced and the vehicle is
     not. This suite reports that resolver's answer; it does not second-guess it. */
  const narrowed = await usageFor(collisionProject({
    id: ID, collections: ["props", "vehicles"], shots: [{ propIds: [ID] }],
  }), ID, options);
  assert.strictEqual(narrowed.props, 1, "4: `propIds` narrows to the prop when both collections hold the id");
  assert.strictEqual(narrowed.vehicles, 0, "4: and the vehicle of the same id is not the entity referenced");

  /* ---- 5 · several shots, one typed entity -------------------------------- */
  const repeated = await usageFor(collisionProject({
    id: ID,
    shots: [{ characters: [ID] }, { characters: [ID] }, { characters: [ID] }, { location: ID }],
  }), ID, options);
  assert.strictEqual(repeated.characters, 3, `5: three shots reference the character, got ${repeated.characters}`);
  assert.strictEqual(repeated.locations, 1, `5: one references the location, got ${repeated.locations}`);
  assert.strictEqual(repeated.props, 0, "5: and none references the prop");

  /* ---- 6 · one shot, several typed dependencies, counted once each --------
     The shot names the character twice over — in `characters` and again as the
     audio speaker — which is the case where a per-ROW count would report 2 for a
     single shot. The shipped counting semantics are per-shot, and this pins them. */
  const combined = collisionProject({
    id: ID, collections: ["characters", "locations", "props", "vehicles"],
    shots: [{ characters: [ID], location: ID, propIds: [ID] }],
  });
  combined.shots[0].audio = { speakerId: ID };
  const once = await usageFor(combined, ID, options);
  assert.deepStrictEqual(once, { characters: 1, locations: 1, props: 1, vehicles: 0 },
    `6: one shot naming three typed identities must count each exactly once, got ${JSON.stringify(once)}`);

  /* ---- 7 · an unrecognised collection must not guess a neighbour ---------- */
  const guessProject = collisionProject({ id: ID, shots: [{ characters: [ID], location: ID, propIds: [ID] }] });
  const guessed = await render(`#/character/${ID}`, guessProject, { scan: referenceScan(guessProject), ...options });
  const unknown = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const entity = P.characters[0];
    const out = {};
    for (const list of ["sculptures", "", "character", "CHARACTERS", "props "]) out[String(list)] = entityProductionUse(list, entity);
    out["__null"] = entityProductionUse(null, entity);
    out["__typemap"] = entityDependencyType("sculptures");
    return out;
  })())`, guessed.context));
  for (const [label, answer] of Object.entries(unknown)) {
    if (label === "__typemap") continue;
    assert.strictEqual(answer.shots, 0, `7: the unrecognised collection ${label} must claim no usage`);
    assert.strictEqual(answer.known, false,
      `7: and must report that it does not know, rather than asserting zero usage it cannot support (${label})`);
  }
  assert.strictEqual(unknown.__typemap, "", "7: an unrecognised collection resolves to no dependency type at all");
  /* Singular spellings are NOT collection names, and this is the trap the map
     exists to close: `character` looks like the dependency type and would match
     every character row if it were accepted as a collection. */
  assert.strictEqual(unknown.character.known, false,
    "7: the singular dependency type is not a collection name and must not be accepted as one");

  /* ---- 8 · a project with no collisions is unchanged ---------------------- */
  const plain = referenceFixture();
  plain.shots = [
    { ...(plain.shots[0] || {}), id: "P1-01", characters: ["CHAR-REFRAME"], codes: [], audio: {}, clips: [], creationBrief: {} },
    { ...(plain.shots[0] || {}), id: "P1-02", characters: ["CHAR-REFRAME"], codes: [], audio: {}, clips: [], creationBrief: {} },
    { ...(plain.shots[0] || {}), id: "P1-03", characters: [], codes: [], audio: {}, clips: [], creationBrief: {} },
  ];
  const plainRender = await renderReference(plain, options);
  /* Compared against an INDEPENDENT walk through the shipped resolver, so this
     asserts agreement with shotDependencyRecords() rather than a number I chose. */
  const [reported, independent] = JSON.parse(vm.runInContext(`JSON.stringify([
    entityProductionUse("characters", P.characters[0]).shots,
    (P.shots || []).filter((shot) => shotDependencyRecords(P, shot).some((row) => row.resolved && row.type === "character" && row.id === "CHAR-REFRAME")).length,
  ])`, plainRender.context));
  assert.strictEqual(reported, 2, `8: an uncollided project must count its two referencing shots, got ${reported}`);
  assert.strictEqual(reported, independent,
    "8: and must agree with an independent walk of the shipped dependency resolver");
  assert.ok(plainRender.html.includes("Used by 2 shots in this production"),
    "8: and the surface must print that count");

  /* ---- and the surface itself, not only the function --------------------- */
  const surfaceProject = collisionProject({ id: ID, shots: [{ characters: [ID] }] });
  const charSurface = await render(`#/character/${ID}`, surfaceProject, { scan: referenceScan(surfaceProject), ...options });
  const propSurface = await render(`#/prop/${ID}`, surfaceProject, { scan: referenceScan(surfaceProject), ...options });
  assert.ok(charSurface.html.includes("Used by 1 shot in this production"),
    "the referenced character's surface must state its real usage");
  assert.ok(propSurface.html.includes("No shot references this prop yet"),
    "and the unreferenced prop of the same id must say so on its own surface");
  assert.ok(!propSurface.html.includes("Used by 1 shot"),
    "the prop must never claim a usage that belongs to the character it collides with");

  note("9. typed identity · a shot referencing character X leaves prop X, location X and vehicle X at zero, and "
    + "the same holds for each type in turn; a DIFFERENT character of the same type also stays at zero, so both "
    + "halves of the identity are load-bearing; colliding ids count only the identities actually referenced; "
    + "`propIds` narrows to the prop as the shipped resolver does; three shots count 3 and one shot naming a "
    + "character three ways counts 1; an unrecognised collection — including the singular `character` — reports "
    + "`known: false` and guesses nothing; an uncollided project agrees with an independent walk of the resolver");
}

async function main() {
  await primarySection();
  coverageSection();
  await authoritySection();
  await demandSection();
  await continuitySection();
  await detailsSection();
  handoffSection();
  await boundarySection();
  await typedIdentitySection();
  console.log("Reference reframe suite passed:");
  for (const line of notes) console.log("  " + line);
}

module.exports = {
  detectors, referenceFixture, referenceScan, renderReference, codeOnly,
  primarySection, coverageSection, authoritySection, demandSection,
  continuitySection, detailsSection, handoffSection, boundarySection, typedIdentitySection,
  collisionProject, usageFor, main,
};

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
