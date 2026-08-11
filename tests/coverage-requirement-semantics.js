/* P4-SEM-A — canonical coverage requirement semantics.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: two CineBraid surfaces looking
 * at the same project cannot print two different required-view counts, because
 * only one function is allowed to decide whether a coverage slot is required.
 *
 * Before this batch the fact was encoded twice inside one record — the boolean
 * `required` that every coverage template seeded, and the three-value
 * `requirement` enum the UI actually offers — and read two different ways.
 * public/entities.js resolved the pair by precedence; public/focused-workspaces.js,
 * public/coverage-automation.js and public/creation-studio.js read the boolean
 * alone. A slot declared "not required" with no `required: false` twin was
 * therefore counted by the Reference Inspector and excluded by the coverage
 * board, and the same project showed "1 of 3" on one screen and "1 of 2" on the
 * other. Worse, the load-time reconciliation in public/app.js MINTED the
 * template's boolean onto stored slots that carried only the enum, so merely
 * opening a project could manufacture the contradiction it then displayed.
 *
 * The tests below drive the real runtime paths: the shared contract directly,
 * both real rendered surfaces through the render harness, the real Project
 * Builder importer over HTTP, the real OFP migration and validator, and a real
 * save/reload through a real server process.
 *
 * THE ONE READING THAT IS EASY TO GET WRONG, asserted here rather than assumed:
 * a legacy `required: false` means PLANNED, not "not required". It is the value
 * every template seeds for a view CineBraid offers but does not demand, the UI
 * names that state "Planned / useful later", and an affirmative "not wanted" is
 * something a boolean nobody authored cannot carry. entities.js has always read
 * it that way; before this batch the migration did not, and that disagreement is
 * case 8 below.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing in this file dispatches a
 * generation. The render harness stubs `fetch`, and the server section spawns
 * server.js against a temporary projects root with no provider credentials.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const Coverage = require("../public/shared-coverage");
const Schema = require("../ofp/ofp-schema");
const { previewLegacyMigration } = require("../ofp/ofp-migrate");
const { serializeCanonical } = require("../ofp/ofp-serialize");
const { parseJsonStrict } = require("../ofp/ofp-json");
const { render, buildFixture } = require("./render-harness");

const AT = "2026-08-11T00:00:00.000Z";
let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  /* The values are folded into the message on purpose. assert.deepStrictEqual
     suppresses its own diff whenever a custom message is supplied, and a bare
     "case 10 failed" with no numbers is the least useful thing a suite can
     print at 3am. */
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

/* Comments are stripped before the source guards run, so a file may still
   EXPLAIN the reading it no longer performs. Template literals are left alone —
   none of the patterns below can appear inside one without also being code. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
}

/* Keys that would be a stored rollup of something the slots already say.
   `coverageAutomation.missingRequired` is deliberately NOT on this list: it is a
   field of an automation RUN — what that submission was for — and not a
   project-level answer to "how much coverage does this entity owe". */
const ROLLUP_KEYS = /^(totalRequired|completedRequired|requiredCount|approvedRequired|coverageCount|coverageTotal|coverageFraction|coverageProgress|coverageSummary|coverageStats|readiness|readinessPercent|entityReady|percentComplete)$/;
function storedRollups(record) {
  return Object.keys(record && typeof record === "object" ? record : {}).filter((key) => ROLLUP_KEYS.test(key)).sort();
}

/* One function's body, by balanced braces. The authoring guard is scoped this
   way on purpose: `required` is ALSO a legitimate field on a shot keyframe
   (`newKeyframe`), where it means "this frame is required rather than optional"
   and has nothing to do with coverage. A file-wide ban would either fail on that
   unrelated field or have to be weakened until it caught nothing. */
function functionSource(source, name) {
  const start = source.search(new RegExp(`(function\\s+${name}\\s*\\(|(window\\.)?${name}\\s*=\\s*(function|\\())`));
  assert(start >= 0, `the guard names a function that no longer exists: ${name}`);
  const open = source.indexOf("{", start);
  assert(open > 0, `${name} has no body`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is unbalanced`);
}

/* One mixed example, reused by every surface. The slot IDs are the LOCATION
   template's, because production logic must key off the declared requirement and
   never off a slot's name — a fixture that called everything "front"/"rear"
   could not tell the difference. */
const MIXED = [
  { id: "establishing", label: "Master establishing", requirement: "required", approvedFile: "LOC-YARD-MASTER.png", notes: "", status: "approved" },
  { id: "reverse", label: "Reverse angle", requirement: "required", approvedFile: "", notes: "", status: "missing" },
  { id: "action-zone", label: "Key action zone", requirement: "planned", approvedFile: "", notes: "", status: "missing" },
  { id: "overhead", label: "Overhead / layout", requirement: "not-required", approvedFile: "", notes: "", status: "missing" },
];

/* ===========================================================================
   1. The contract itself: three literals, one precedence chain, no rollups. */

function contractSection() {
  eq(Coverage.COVERAGE_REQUIREMENTS, ["required", "planned", "not-required"], "the declared vocabulary");
  /* The app must not be able to author a value the format rejects, so the two
     declarations are pinned to each other rather than merely resembling one
     another. */
  eq(Schema.records.COVERAGE.properties.requirement.enum, Coverage.COVERAGE_REQUIREMENTS,
    "OFP COVERAGE.requirement must declare exactly the literals the runtime writes");
  ok(!Schema.records.COVERAGE.required.includes("requirement"),
    "requirement must stay optional: absence is a legal reading and defaulting it at load would break INV-R1");
  ok(Schema.records.CHARACTER.properties.coverage, "case 6: a character owns coverage");
  eq(Schema.records.CHARACTER.properties.coverage.items, Schema.records.COVERAGE,
    "case 6: and it is the generic coverage record, not a second character-shaped copy of it");

  /* Case 1 — required. */
  eq(Coverage.coverageRequirement({ requirement: "required" }), "required", "case 1: an explicit required slot");
  /* Case 2 — planned is neither required nor not-required. */
  eq(Coverage.coverageRequirement({ requirement: "planned" }), "planned", "case 2: planned survives as its own state");
  ok(!Coverage.isRequiredCoverage({ requirement: "planned" }), "case 2: planned is not required");
  ok(Coverage.coverageRequirement({ requirement: "planned" }) !== "not-required", "case 2: planned is not not-required");
  /* Case 3 — not required. */
  eq(Coverage.coverageRequirement({ requirement: "not-required" }), "not-required", "case 3");
  ok(!Coverage.isRequiredCoverage({ requirement: "not-required" }), "case 3: a not-required view is not required work");

  /* Case 7 — legacy boolean true. */
  eq(Coverage.requirementTrace({ required: true }), { requirement: "required", source: "legacy-boolean", declared: "", unknown: "", legacy: true },
    "case 7: `required: true` reads as required, and the trace says the boolean is why");
  /* Case 8 — legacy boolean false. THE reading. */
  eq(Coverage.coverageRequirement({ required: false }), "planned",
    "case 8: `required: false` reads as PLANNED — the template's seed for an offered-but-not-demanded view. A boolean nobody authored cannot carry an affirmative 'not wanted'.");
  ok(Coverage.coverageRequirement({ required: false }) !== "not-required",
    "case 8: the more specific state must not be manufactured from a boolean that cannot express it");

  /* Case 9 — both encodings. The enum wins, and only a genuine contradiction is
     reported: `false` is consistent with BOTH non-required members, so it agrees
     with either rather than contradicting the more specific one. */
  eq(Coverage.coverageRequirement({ required: true, requirement: "planned" }), "planned", "case 9: the enum wins");
  eq(Coverage.requirementConflict({ required: true, requirement: "required" }), null, "case 9: true beside required agrees");
  eq(Coverage.requirementConflict({ required: false, requirement: "planned" }), null, "case 9: false beside planned agrees");
  eq(Coverage.requirementConflict({ required: false, requirement: "not-required" }), null,
    "case 9: false beside not-required agrees — the boolean cannot tell the two non-required states apart, so it denies neither");
  eq(Coverage.requirementConflict({ required: true, requirement: "planned" }),
    { declared: "planned", legacy: true, legacyAdmits: ["required"], resolved: "planned" },
    "case 9: true beside planned is a real contradiction, reported with what each side can actually assert");
  eq(Coverage.requirementConflict({ required: false, requirement: "required" })?.legacyAdmits, ["planned", "not-required"],
    "case 9: and so is false beside required");

  /* Absence is its own case, and the default belongs at use rather than at load. */
  eq(Coverage.requirementTrace({}).source, "unspecified", "an undeclared slot is reported as undeclared, not as an authored 'required'");
  eq(Coverage.coverageRequirement({}), "required", "and it is TREATED as required at use, which is where the default belongs");

  /* An unknown value is preserved and reported, never coerced into a neighbour. */
  eq(Coverage.normalizeRequirement("optional"), "", "an undeclared literal is not a member");
  eq(Coverage.requirementTrace({ requirement: "optional" }).unknown, "optional", "and it is reported");
  eq(Coverage.requirementTrace({ requirement: "optional", required: false }).requirement, "planned",
    "an unknown enum falls through to the boolean rather than being rounded to the nearest member");

  /* Case 4 — the mixed example. All three sets derive from one contract. */
  const summary = Coverage.summariseCoverage(MIXED);
  eq([summary.required, summary.planned, summary.notRequired], [2, 1, 1], "case 4: required / planned / not-required sets");
  eq([summary.approvedRequired, summary.total, summary.missingRequired], [1, 4, 1], "case 4: the derived fractions");

  /* Retirement is not a requirement, and it no longer has to overwrite one. */
  eq(Coverage.coverageRequirement({ requirement: "required", retired: true }), "not-required",
    "a retired slot is not a current need, so it leaves the required set without the retirement writer having to blank the authored value");
  eq(Coverage.summariseCoverage([{ requirement: "required", retired: true }]).total, 0, "and it leaves the totals entirely");
}

/* ===========================================================================
   2. One authoritative writer. */

function writerSection() {
  {
    const slot = { id: "rear", label: "Rear", required: true, approvedFile: "" };
    Coverage.writeCoverageRequirement(slot, "planned");
    eq(slot, { id: "rear", label: "Rear", approvedFile: "", requirement: "planned" },
      "the writer sets the enum and REMOVES the retired boolean; leaving it would be a second, now-unauthored copy of one fact");
    ok(!("required" in slot), "the boolean is gone, not falsified");
  }
  {
    /* An imported slot can carry the continuity-state spelling, which outranks
       `requirement`. Leaving it behind would silently overrule what the user just
       chose, so it goes too. */
    const slot = { id: "front", referenceRequirement: "required", requirement: "required" };
    Coverage.writeCoverageRequirement(slot, "not-required");
    eq(slot, { id: "front", requirement: "not-required" }, "no higher-precedence shadow survives an explicit choice");
  }
  {
    const slot = {};
    eq(Coverage.writeCoverageRequirement(slot, "nonsense"), "required", "an unknown input falls back to the safest member");
    eq(slot.requirement, "required", "and is stored as a declared literal, never verbatim");
  }

  /* The source-level half of the same rule: no surface may re-derive the answer
     from the boolean, and no template may author one. `slot` is the variable
     name every coverage reader uses. Comment lines are stripped first so the
     files may still EXPLAIN what they no longer do. */
  const sources = {};
  for (const file of ["focused-workspaces.js", "coverage-automation.js", "creation-studio.js", "entities.js", "app.js", "mutations.js"]) {
    sources[file] = stripComments(fs.readFileSync(path.join(ROOT, "public", file), "utf8").replace(/\r\n/g, "\n"));
    ok(!/\bslot\??\.required\b/.test(sources[file]),
      `${file} must not read a coverage slot's legacy boolean; the shared contract owns that reading`);
  }
  /* Every place that MAKES a coverage or expression slot, named individually so
     the ban is precise rather than approximate. */
  const WRITERS = [
    ["app.js", "projectCoverageTemplate"],
    ["app.js", "projectExpressionTemplate"],
    ["app.js", "seedCoverageRequirement"],
    ["app.js", "normalizeReferenceCoverageData"],
    ["entities.js", "coverageTemplateForList"],
    ["entities.js", "addCoverageSlot"],
    ["entities.js", "setCoverageSlotRequirement"],
    ["entities.js", "setExpressionSlotRequirement"],
    ["mutations.js", "addEntity"],
  ];
  for (const [file, name] of WRITERS) {
    const body = functionSource(sources[file], name);
    ok(!/\brequired\s*:/.test(body), `${file}:${name}() must not author a coverage slot's legacy boolean`);
    ok(!/\.required\s*=/.test(body), `${file}:${name}() must not assign a coverage slot's legacy boolean`);
  }
  const server = stripComments(fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replace(/\r\n/g, "\n"));
  ok(!/\bslot\?\.required\b/.test(server), "the Project Builder importer must not read a supplied boolean directly");
  for (const name of ["normalizeBuilderCoverage", "builderCoverageRequirement"]) {
    const body = functionSource(server, name);
    ok(!/\brequired\s*:/.test(body) && !/\.required\s*=/.test(body),
      `server.js:${name}() must not synthesise a boolean beside a supplied enum`);
  }
}

/* ===========================================================================
   3. Both real surfaces, one answer. */

/* `options.mutateSource` is the render harness's in-memory patch hook. It is
   threaded through here so a negative control can break a shipped browser script
   without touching the file on disk. */
let RENDER_OPTIONS = {};
async function renderedCoverage(project, list, id, options = RENDER_OPTIONS) {
  const view = ({ characters: "character", locations: "location", props: "prop", vehicles: "vehicle" })[list];
  const rendered = await render(`#/${view}/${id}`, project, options);
  /* focused-workspaces.js is not in the harness SCRIPT_ORDER, so it is evaluated
     here the way index.html loads it, and the inspector's OWN derivation is then
     called. Proving two surfaces agree is worth nothing if the test
     reimplements one of them. */
  rendered.context.requestAnimationFrame = () => 0;
  rendered.context.window.requestAnimationFrame = rendered.context.requestAnimationFrame;
  rendered.context.MutationObserver = function () { this.observe = () => {}; };
  rendered.context.window.MutationObserver = rendered.context.MutationObserver;
  const focused = fs.readFileSync(path.join(ROOT, "public", "focused-workspaces.js"), "utf8");
  vm.runInContext(options.mutateSource ? String(options.mutateSource("focused-workspaces.js", focused) ?? focused) : focused,
    rendered.context, { filename: "focused-workspaces.js" });
  /* Serialised across the realm boundary. Values built inside the VM carry that
     context's Array/Object prototypes, and assert.deepStrictEqual compares
     prototypes — so a cross-realm array fails against an identical host one. */
  return JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const entity = P[${JSON.stringify(list)}].find((row) => row.id === ${JSON.stringify(id)});
    const slots = ensureCoverageSlots(${JSON.stringify(list)}, entity);
    return {
      board: coverageStats(slots),
      inspector: window.__CINEBRAID_FOCUSED.inspectorCoverage(entity),
      stored: JSON.parse(JSON.stringify(entity.coverageSlots || [])),
      entity: JSON.parse(JSON.stringify(entity)),
      automationMissing: window.__CINEBRAID_COVERAGE_AUTOMATION.missingCoverageSlots(${JSON.stringify(list)}, entity, false).map((slot) => slot.id),
    };
  })())`, rendered.context));
}

async function surfacesSection(options = {}) {
  RENDER_OPTIONS = options;
  {
    const project = buildFixture();
    const location = project.locations.find((row) => row.id === "LOC-HULL") || project.locations[0];
    location.coverageSlots = MIXED.map((slot) => ({ ...slot }));
    const seen = await renderedCoverage(project, "locations", location.id);

    /* Cases 1-4 through the shipped surfaces. The board's numbers are the
       reference, because it was already reading the enum; what changed is that
       everyone else now gets the same ones. */
    eq([seen.board.required, seen.board.planned, seen.board.notRequired], [2, 5, 1],
      "case 4: the coverage board's three sets (the location template contributes four more planned slots, which is the realistic shape)");
    eq([seen.inspector.required, seen.inspector.approved], [seen.board.required, seen.board.approvedRequired],
      "cases 1-4: the Reference Inspector prints the coverage board's fraction, because it now derives it the same way");
    /* Case 3 stated as work rather than as a set: a not-required view must not
       appear as something anybody has to do. */
    ok(!seen.automationMissing.includes("overhead"), "case 3: a not-required view contributes no required work to coverage automation");
    ok(!seen.automationMissing.includes("action-zone"), "case 2: neither does a planned one");
    ok(seen.automationMissing.includes("reverse"), "case 1: the unapproved required view is the work that remains");

    /* Case 10 — opening does not canonicalise. The stored slots arrived with the
       enum and no boolean; a render must not have minted one. This is the exact
       defect that used to make the two screens disagree. */
    const authored = seen.stored.filter((row) => MIXED.some((source) => source.id === row.id));
    for (const slot of authored)
      ok(!("required" in slot), `case 10: rendering must not mint a legacy boolean onto ${slot.id}`);
    eq(authored.map((row) => row.requirement), ["required", "required", "planned", "not-required"],
      "case 10: and the authored values are exactly as stored");

    /* Counts stay DERIVED. A stored rollup is a second copy of an answer the
       slots already contain, and it starts disagreeing with them the first time
       either changes — which is the whole failure mode this batch is about, one
       level up. Nothing the render touched may carry one. */
    eq(storedRollups(seen.entity), [], "no coverage total, fraction, readiness value or entityReady may be persisted on the entity");
    for (const slot of seen.stored)
      eq(storedRollups(slot), [], `nor on a slot: ${slot.id}`);
  }

  /* Case 6 — CHARACTER coverage in the runtime, with the same mixed states. */
  {
    const project = buildFixture();
    const character = project.characters[0];
    character.coverageSlots = [
      { id: "front", label: "Front", requirement: "required", approvedFile: "KAI-FRONT.png", notes: "", status: "approved" },
      { id: "profile", label: "Profile", requirement: "required", approvedFile: "", notes: "", status: "missing" },
      { id: "rear", label: "Rear", requirement: "planned", approvedFile: "", notes: "", status: "missing" },
      { id: "detail-face", label: "Face / detail", requirement: "not-required", approvedFile: "", notes: "", status: "missing" },
    ];
    const seen = await renderedCoverage(project, "characters", character.id);
    /* The character template contributes `front-three-quarter` (required) and
       `expression` (planned) on top of the four authored above. */
    eq([seen.board.required, seen.board.planned, seen.board.notRequired], [3, 2, 1],
      "case 6: a character's own view slots resolve through the same three sets");
    eq([seen.inspector.required, seen.inspector.approved], [seen.board.required, seen.board.approvedRequired],
      "case 6: and both character surfaces agree");
  }

  /* Case 5 — primary authority is not a coverage slot.

     An approved primary identity image must not silently satisfy a named view.
     CineBraid already holds this line for characters — library-tools.js records
     `primaryAngleAssignment: { status: "unassigned" }` rather than filling a slot
     — and the point of this case is that P4-SEM-A did not quietly relax it while
     giving characters canonical coverage. */
  {
    const project = buildFixture();
    const character = project.characters[0];
    character.approvedFile = "KAI-PRIMARY.png";
    character.coverageSlots = [
      { id: "front", label: "Front", requirement: "required", approvedFile: "", notes: "", status: "missing" },
      { id: "profile", label: "Profile", requirement: "required", approvedFile: "", notes: "", status: "missing" },
      { id: "rear", label: "Rear", requirement: "planned", approvedFile: "", notes: "", status: "missing" },
    ];
    const seen = await renderedCoverage(project, "characters", character.id);
    eq(seen.board.approvedRequired, 0, "case 5: an approved primary image satisfies NO required view on its own");
    eq(seen.inspector.approved, 0, "case 5: and the inspector agrees it satisfies none");
    ok(seen.automationMissing.includes("front") && seen.automationMissing.includes("profile"),
      "case 5: both required views are still outstanding work");
    ok(!seen.stored.some((slot) => slot.approvedFile === "KAI-PRIMARY.png"),
      "case 5: and the primary file was not seeded into a slot by being looked at");

    const assigned = buildFixture();
    const target = assigned.characters[0];
    target.approvedFile = "KAI-PRIMARY.png";
    target.coverageSlots = [
      { id: "front", label: "Front", requirement: "required", approvedFile: "KAI-PRIMARY.png", notes: "", status: "approved" },
      { id: "profile", label: "Profile", requirement: "required", approvedFile: "", notes: "", status: "missing" },
    ];
    const after = await renderedCoverage(assigned, "characters", target.id);
    eq(after.board.approvedRequired, 1, "case 5: an EXPLICIT assignment of that same file to a named view does still count");
  }

  /* The writer, through the real UI entry point, on a slot that arrived with the
     legacy boolean. One field is authored and the duplicate leaves the record. */
  {
    const project = buildFixture();
    const location = project.locations.find((row) => row.id === "LOC-HULL") || project.locations[0];
    location.coverageSlots = [{ id: "establishing", label: "Master establishing", required: true, approvedFile: "", notes: "", status: "missing" }];
    const rendered = await render(`#/location/${location.id}`, project, options);
    const after = vm.runInContext(`(() => {
      setCoverageSlotRequirement("locations", ${JSON.stringify(location.id)}, 0, "not-required");
      const slot = P.locations.find((row) => row.id === ${JSON.stringify(location.id)}).coverageSlots[0];
      return { keys: Object.keys(slot).sort(), requirement: slot.requirement, conflict: window.requirementConflict(slot) };
    })()`, rendered.context);
    eq(after.requirement, "not-required", "the user's choice is what the record now says");
    ok(!after.keys.includes("required"), "and the legacy boolean is not maintained alongside it");
    eq(after.conflict, null, "so the record cannot contradict itself");
  }
}

/* ===========================================================================
   4. OFP: schema, migration, validation, round-trip. */

function ofpSection() {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ofp-legacy", "character-coverage.json"), "utf8"));
  const result = previewLegacyMigration(source, { at: AT });
  ok(result.ok, "the fixture migrates");
  eq(result.validation.ok, true, "and the candidate validates");
  eq(result.report.accounting.unaccounted, [], "with every source value accounted for");

  const byId = Object.fromEntries(result.candidate.entities.characters.map((row) => [row.id, row]));

  /* Case 6 — character coverage reaches core rather than an opaque blob. */
  eq(byId["CHAR-MARA"].coverage.map((row) => [row.id, row.requirement]),
    [["front", "required"], ["profile", "required"], ["rear", "planned"], ["detail-face", "not-required"]],
    "case 6: a character's mixed view requirements land in core COVERAGE records");

  /* Cases 7 and 8 — the two boolean-only readings. */
  eq(byId["CHAR-LEGACY"].coverage.find((row) => row.id === "front").requirement, "required", "case 7 through migration");
  eq(byId["CHAR-LEGACY"].coverage.find((row) => row.id === "rear").requirement, "planned",
    "case 8 through migration: `required: false` becomes planned, the same reading the running application uses");
  ok(!("requirement" in byId["CHAR-LEGACY"].coverage.find((row) => row.id === "profile")),
    "a slot that declared nothing gets nothing: where old data cannot determine a new fact, migration writes no fact");

  /* Case 9 — deterministic, documented conflict behaviour. */
  const conflicts = result.report.diagnostics.filter((row) => row.code === "migration.review.required" && /coverage\./.test(row.message));
  eq(conflicts.map((row) => row.target).sort(),
    ["character:CHAR-CONFLICT/coverage:profile", "character:CHAR-UNKNOWN/coverage:front"],
    "case 9: exactly the genuine contradiction and the unknown value are reported — `false` beside `not-required` is coherent data and stays silent");
  eq(byId["CHAR-CONFLICT"].coverage.map((row) => row.requirement), ["required", "not-required", "planned"],
    "case 9: the enum wins in every pair, including the contradicting one");
  ok(!("requirement" in byId["CHAR-UNKNOWN"].coverage[0]),
    "an unknown literal asserts no core value; it is preserved and reported rather than rounded to a member");

  /* No duplicate truth survives migration either: the workflow extension used to
     hold a second copy of every requirement. */
  ok(!result.candidate.extensions?.["com.cinebraid.workflow"]?.coverage,
    "the requirement has one home now, and it is the core field");

  /* Case 11 — canonical round-trip. */
  const reparsed = parseJsonStrict(serializeCanonical(result.candidate));
  /* Keyed by id rather than by position: `coverage` is a `set` collection, so the
     serializer orders it by identifier and array order carries no meaning. */
  eq(Object.fromEntries(reparsed.entities.characters.find((row) => row.id === "CHAR-MARA").coverage.map((row) => [row.id, row.requirement])),
    { front: "required", profile: "required", rear: "planned", "detail-face": "not-required" },
    "case 11: serialize and reparse preserves every requirement exactly");
  eq(reparsed.entities.characters.find((row) => row.id === "CHAR-UNKNOWN").coverage[0].requirement, undefined,
    "case 11: and an absent requirement stays absent rather than becoming a default on the way through");
  eq(serializeCanonical(parseJsonStrict(serializeCanonical(result.candidate))), serializeCanonical(result.candidate),
    "case 11: and the round-trip is byte-stable");

  /* Determinism: the same input twice is the same document. */
  eq(serializeCanonical(previewLegacyMigration(source, { at: AT }).candidate), serializeCanonical(result.candidate),
    "the migration is deterministic");

  /* Source untouched. previewLegacyMigration works on a parsed copy; this is the
     assertion that says so rather than assuming it. */
  eq(source, JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ofp-legacy", "character-coverage.json"), "utf8")),
    "previewing a migration must not mutate the document it was handed");
}

/* ===========================================================================
   5. Real server: import, open-without-write, save/reload. */

function freePort() {
  const net = require("net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
function waitFor(check, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = async () => {
      try { if (await check()) return resolve(true); } catch {}
      if (Date.now() > deadline) return reject(new Error("timed out waiting for the server"));
      setTimeout(tick, 120);
    };
    tick();
  });
}

/* A legacy project, on disk, in the shape a 6.7 project genuinely has: its
   schema marker is current, so opening it is a read and nothing else. */
function serverFixture() {
  const project = buildFixture();
  project.meta.schemaVersion = "6.7";
  project.meta.hubVersion = "v6.0.0";
  const location = project.locations.find((row) => row.id === "LOC-HULL") || project.locations[0];
  location.coverageSlots = MIXED.map((slot) => ({ ...slot }));
  project.characters[0].coverageSlots = [
    { id: "front", label: "Front", requirement: "required", approvedFile: "", notes: "", status: "missing" },
    { id: "profile", label: "Profile", requirement: "required", approvedFile: "", notes: "", status: "missing" },
    { id: "rear", label: "Rear", requirement: "planned", approvedFile: "", notes: "", status: "missing" },
    { id: "detail-face", label: "Face / detail", requirement: "not-required", approvedFile: "", notes: "", status: "missing" },
  ];
  /* And one entity still holding only the retired encoding, so the read path is
     exercised against legacy bytes rather than against freshly canonical ones. */
  project.props[0].coverageSlots = [
    { id: "hero", label: "Front / hero", required: true, approvedFile: "", notes: "", status: "missing" },
    { id: "top", label: "Top", required: false, approvedFile: "", notes: "", status: "missing" },
  ];
  return project;
}

async function serverSection(options = {}) {
  RENDER_OPTIONS = options;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-coverage-"));
  const projectsRoot = path.join(temp, "projects");
  const projectDir = path.join(projectsRoot, "coverage-fixture");
  fs.mkdirSync(projectDir, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"])
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });

  const file = path.join(projectDir, "project.json");
  fs.writeFileSync(file, JSON.stringify(serverFixture(), null, 2));
  const onDiskBefore = fs.readFileSync(file, "utf8");

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CINEBRAID_CONFIG_PATH: path.join(temp, "config.json"),
      CINEBRAID_PROJECTS_ROOT: projectsRoot,
      CINEBRAID_AI_TEXT_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitFor(async () => {
      const response = await fetch(`${base}/api/me`).catch(() => null);
      return !!response && response.ok;
    });

    /* Case 10 — opening a project writes nothing. A page load is not a
       migration, and canonicalising a legacy boolean on open would be exactly
       the silent rewrite this rule forbids. */
    const read = await fetch(`${base}/api/project`);
    ok(read.ok, `the project must open: ${read.status}\n${output}`);
    const revision = read.headers.get("etag") || read.headers.get("x-cinebraid-project-revision") || "*";
    const loaded = await read.json();
    eq(fs.readFileSync(file, "utf8"), onDiskBefore, "case 10: reading a project must not rewrite its coverage data on disk");
    eq(loaded.props[0].coverageSlots.map((row) => row.required), [true, false],
      "case 10: the legacy booleans survive a read verbatim");
    for (const slot of loaded.props[0].coverageSlots)
      ok(!("requirement" in slot), "case 10: and no canonical value was minted into them by reading");

    /* Case 11 — the runtime round-trip. Open, LOOK at two entities through the
       real render path, save what the browser holds, reload. Saving the
       untouched read would prove only that the server round-trips JSON. */
    const looked = await (async () => {
      let current = loaded;
      for (const [list, id] of [["locations", loaded.locations[0].id], ["characters", loaded.characters[0].id], ["props", loaded.props[0].id]]) {
        const view = ({ characters: "character", locations: "location", props: "prop" })[list];
        const rendered = await render(`#/${view}/${id}`, current, options);
        current = vm.runInContext("JSON.parse(JSON.stringify(P))", rendered.context);
      }
      return current;
    })();

    const save = await fetch(`${base}/api/projects/coverage-fixture/project`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": revision },
      body: JSON.stringify(looked),
    });
    ok(save.ok, `saving must succeed: ${save.status} ${await save.text().catch(() => "")}`);

    const reloaded = await (await fetch(`${base}/api/project`)).json();
    const character = reloaded.characters.find((row) => row.id === loaded.characters[0].id);
    eq(character.coverageSlots.filter((row) => ["front", "profile", "rear", "detail-face"].includes(row.id)).map((row) => [row.id, row.requirement]),
      [["front", "required"], ["profile", "required"], ["rear", "planned"], ["detail-face", "not-required"]],
      "case 6: character coverage survives save and reload with the same semantics");
    for (const slot of character.coverageSlots)
      ok(!("required" in slot), "case 6: and no second encoding reappears during the save cycle");
    const location = reloaded.locations.find((row) => row.id === loaded.locations[0].id);
    eq(Coverage.summariseCoverage(location.coverageSlots).required, 2,
      "the derived required set is the same after a reload as before the save");
    /* And the save cycle did not persist any of the numbers it printed. */
    for (const entity of [character, location, ...reloaded.props])
      eq(storedRollups(entity), [], `save/reload must not persist a coverage rollup on ${entity.id}`);
    /* The two slots the fixture actually stored keep their own encoding through
       the whole cycle; the four the template introduced carry only the enum,
       because a newly created slot has no stored fact to preserve. */
    const props = Object.fromEntries(reloaded.props[0].coverageSlots.map((row) => [row.id, row]));
    eq([props.hero.required, props.top.required], [true, false],
      "a legacy record the user never edited keeps its own encoding through the save cycle");
    for (const slot of reloaded.props[0].coverageSlots.filter((row) => !["hero", "top"].includes(row.id)))
      ok(!("required" in slot) && Coverage.COVERAGE_REQUIREMENTS.includes(slot.requirement),
        `a slot the template introduced is authored in one encoding only: ${slot.id}`);

    /* The importer: a kit that supplies the enum must not come out of import
       carrying a boolean that contradicts it. */
    const preview = await fetch(`${base}/api/projects/preview-import-json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project: {
          meta: { title: "Imported Coverage" },
          scenes: [], shots: [], audio: [], vehicles: [], props: [], locations: [],
          characters: [{
            id: "CHAR-IMPORT", name: "Imported", continuityStates: [{ id: "state-default", name: "Default", isDefault: true }],
            coverageSlots: [
              { id: "front", label: "Front", requirement: "required" },
              { id: "rear", label: "Rear", requirement: "not-required" },
              { id: "profile", label: "Profile", required: false },
            ],
            expressionSlots: [{ id: "neutral", label: "Neutral", requirement: "planned" }],
          }],
        },
      }),
    });
    ok(preview.ok, `the kit must import: ${preview.status} ${await preview.clone().text().catch(() => "")}`);
    const imported = (await preview.json()).normalizedProject.characters.find((row) => row.id === "CHAR-IMPORT");
    const importedSlots = Object.fromEntries(imported.coverageSlots.map((row) => [row.id, row]));
    eq(importedSlots.rear.requirement, "not-required", "the importer keeps what the kit declared");
    ok(!("required" in importedSlots.rear),
      "and does not manufacture the boolean that used to contradict it — this is the writer that created the disagreement");
    eq(importedSlots.profile.requirement, "planned", "case 8 through import: a supplied `required: false` is read as planned");
    ok(!("required" in importedSlots.profile), "and re-expressed as the single canonical field");
    eq(imported.expressionSlots[0].requirement, "planned", "expression slots take the same path");
    for (const slot of imported.coverageSlots)
      eq(Coverage.requirementConflict(slot), null, "no imported slot can contradict itself");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  contractSection();
  writerSection();
  await surfacesSection();
  ofpSection();
  await serverSection();
  console.log(`P4-SEM-A coverage requirement semantics passed ${checks} checks: one precedence contract, one authoritative writer, agreeing board/inspector/automation surfaces, character coverage in core and through save/reload, primary-image separation, legacy true/false readings, documented conflict precedence, open-without-write, and an importer that no longer manufactures a second encoding. Provider calls made: 0.`);
}

module.exports = { MIXED, renderedCoverage, contractSection, writerSection, surfacesSection, ofpSection, serverSection, serverFixture, storedRollups, main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
