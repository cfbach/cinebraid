/* CineBraid — Public Alpha UX, Slice 5: REFERENCE DEMAND + REVERSIBLE STRUCTURE.
 *
 * TWO PROBLEMS, ONE SENTENCE EACH.
 *
 *   1  Creating a reference created a backlog. A character nobody had cast into
 *      a shot reported "8 required references still needed" on its own surface,
 *      and "Incomplete · 8 required views missing" on the strip above it — in
 *      the same breath as "No shot references this yet". The existence of a slot
 *      was being read as the production asking for it.
 *
 *   2  Structure a filmmaker authored could not be unauthored. A shot's Location
 *      could be swapped and never removed, and a shot continuity-state
 *      declaration could be changed and never withdrawn. Selected once meant
 *      required forever.
 *
 * WHAT THIS SLICE DID NOT DO, and the reason section 1 is the longest:
 *
 *   It did NOT move the requirement. coverageRequirement() answers exactly what
 *   it answered, coverageDemand().tier is still a one-to-one rename of it, and
 *   an unauthored slot still resolves `required`. tests/reference-reframe.js
 *   holds that line and it is still green. The requirement is WHAT KIND OF
 *   MATERIAL THIS IS; demand is WHETHER THE PRODUCTION IS ASKING FOR IT NOW.
 *   Two axes, and the screen had been reading the first as the second.
 *
 *   It also created no reference authority layer, no second readiness, and no
 *   new persisted field. The demand answer is derived on every read from the
 *   same relationship projection public/shared-shot-readiness.js already gates
 *   its own entity requirements on, which is why the entity page and Production
 *   cannot disagree about which references are dormant.
 *
 * Sections:
 *
 *   1  the demand projection — pure, total, fails CLOSED
 *   2  the demand owner — which shots count as demand, and which do not
 *   3  RD1-RD10, through the rendered reference surface
 *   4  agreement — the surface, the taskbar, the tools and Production
 *   5  reversible Location, through the shipped control
 *   6  reversible shot continuity-state declaration
 *   7  AUTH1-AUTH4 — clearing structure damages no authority
 *   8  route / method interaction, measured from shipped semantics
 *   9  copy — required-now vs available vs satisfied vs not currently needed
 *  10  no Slice 1/2/3/4 regression and no new persisted field
 *  11  every filmmaker-authored optional relation has a reachable clear path
 *  12  FD1-FD7 — the dependency reading is three-valued and fails closed
 *  13  VEH1-VEH7 — one vehicle relation, two encodings, one truthful control
 *  14  AG1-AG10 — current work equals what readiness actually owes
 *  15  LOC1-LOC7 — an explicit clear survives normalisation and a round trip
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
const Entities = require("../public/shared-entities");

const notes = [];
const note = (line) => notes.push(line);

/* Comments name what they retired, so a source census that included prose would
   count the explanation as the thing. Same strip the Slice 3 suite uses. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

/* ------------------------------------------------------------------ fixtures
   One project shape, parameterised by whether a shot casts the reference. Every
   RD case below is this project with one structural fact changed, so a
   difference in the answer can only have come from that fact. */
function slotSet(ids, requirement = "required") {
  return ids.map((id) => ({ id, label: id, requirement, selectedFile: "", notes: "", status: "missing" }));
}
function demandFixture({ cast = false, list = "characters", id = "RD-CHAR" } = {}) {
  const project = buildFixture();
  const record = {
    id, name: "Rennick", status: "IN PROGRESS", workflowStatus: "IN PROGRESS",
    block: "A dock supervisor.", notes: "A dock supervisor.", approvedFile: "",
    continuityStates: [], coverageSlots: slotSet(["front", "profile"]), expressionSlots: [],
  };
  project[list].push(record);
  if (cast) {
    if (list === "characters") project.shots[0].characters = ["KAI", id];
    if (list === "locations") project.shots[0].creationBrief.locationId = id;
    if (list === "props") project.shots[0].creationBrief.propIds = [id];
    if (list === "vehicles") project.shots[0].creationBrief.vehicleIds = [id];
  }
  return project;
}

const ROUTE_FOR_LIST = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" };

async function referenceSurface(project, { list = "characters", id = "RD-CHAR", task = "coverage", ...options } = {}) {
  return render(`#/${ROUTE_FOR_LIST[list]}/${id}`, project, {
    ...options,
    storage: { [`cinebraid-focused:fixture:entity-task:${list}:${id}`]: task, ...(options.storage || {}) },
  });
}

/* The demand surface's own published numbers, read off the markup rather than
   recomputed here — a suite that recomputed them would be asserting against
   itself. */
function demandCounts(html) {
  const attrs = /<section class="entity-demand"([^>]*)>/.exec(html);
  assert.ok(attrs, "the demand surface must render and publish its counts");
  const value = (key) => {
    const m = new RegExp(`data-demand-${key}="([^"]*)"`).exec(attrs[1]);
    return m ? m[1] : "";
  };
  return {
    required: Number(value("required")), missing: Number(value("missing")),
    recommended: Number(value("recommended")), notNeeded: Number(value("not-needed")),
    now: Number(value("now")), plan: Number(value("plan")), dormant: Number(value("dormant")),
    lead: value("lead"), obligations: value("obligations"),
    production: value("production"),
  };
}
function demandHeadline(html) {
  const m = /WHAT THIS PRODUCTION NEEDS<\/span><b>([^<]*)<\/b>/.exec(html);
  return m ? m[1] : "";
}
function coverageTaskButton(html) {
  const m = /<button type="button" class="focused-task-button ([^"]*)"[^>]*title="What this production needs — ([^"]*)"[\s\S]*?<small>([^<]*)<\/small>/.exec(html);
  return m ? { tone: m[1].trim().split(/\s+/)[0], status: m[2], note: m[3] } : null;
}

/* ============================================================= 1 · PROJECTION
   referenceDemandState() is pure, total over the tier vocabulary, and refuses
   to suppress work on an answer it does not have. */
function projectionSection() {
  assert.deepStrictEqual(Coverage.REFERENCE_DEMAND_STATES,
    ["required-now", "satisfied", "available", "not-currently-needed"],
    "1: exactly four demand states — the four the alpha brief names");
  assert.deepStrictEqual(Coverage.REFERENCE_DEMAND_STATES.map(Coverage.referenceDemandStateLabel),
    ["Required now", "Satisfied", "Available", "Not currently needed"],
    "1: and one label each, so no surface has to invent a word");

  /* TOTAL over every tier the requirement vocabulary can produce, crossed with
     satisfied and with all three production answers. Nothing may fall through
     to undefined and nothing may leave the declared set. */
  const productions = [
    { label: "absent", value: undefined },
    { label: "unknown", value: { known: false, demanded: false } },
    { label: "dormant", value: { known: true, demanded: false } },
    { label: "demanded", value: { known: true, demanded: true } },
  ];
  const seen = new Set();
  for (const requirement of Coverage.COVERAGE_REQUIREMENTS) {
    const demand = Coverage.coverageDemand({ requirement });
    for (const satisfied of [false, true]) {
      for (const production of productions) {
        const answer = Coverage.referenceDemandState(demand, { satisfied, production: production.value });
        assert.ok(Coverage.REFERENCE_DEMAND_STATES.includes(answer.state),
          `1: ${requirement}/${satisfied}/${production.label} produced ${answer.state}, which is not a declared state`);
        assert.strictEqual(answer.tier, demand.tier,
          "1: the projection must carry the tier through unchanged — it renames nothing and re-decides nothing");
        seen.add(answer.state);
      }
    }
  }
  assert.strictEqual(seen.size, Coverage.REFERENCE_DEMAND_STATES.length,
    `1: the matrix must exercise every state, saw ${[...seen].sort().join(", ")}`);

  /* FAILS CLOSED. A caller that cannot establish demand must not be able to
     suppress required work by staying silent — suppression takes a positive,
     knowing "nothing uses this". */
  const required = Coverage.coverageDemand({ requirement: "required" });
  for (const production of [undefined, {}, { known: false, demanded: false }, { known: false, demanded: true }]) {
    assert.strictEqual(Coverage.referenceDemandState(required, { satisfied: false, production }).state, "required-now",
      `1: an unknown production answer must leave required work required (${JSON.stringify(production)})`);
  }
  assert.strictEqual(Coverage.referenceDemandState(required, { satisfied: false, production: { known: true, demanded: false } }).state,
    "available", "1: and only a KNOWING answer of \"nothing uses this\" may stand it down");
  assert.strictEqual(Coverage.referenceDemandState(required, { satisfied: false, production: { known: true, demanded: false } }).basis,
    "no-current-production-demand", "1: with the reason recorded, so a surface can say why");

  /* SATISFIED OUTRANKS EVERYTHING, at every tier. */
  for (const requirement of Coverage.COVERAGE_REQUIREMENTS) {
    assert.strictEqual(
      Coverage.referenceDemandState(Coverage.coverageDemand({ requirement }), { satisfied: true, production: { known: true, demanded: true } }).state,
      "satisfied", `1: a covered ${requirement} item is not outstanding work`);
  }

  /* THE REQUIREMENT ITSELF IS UNTOUCHED. This is the Slice 3 line, re-asserted
     from this suite so a change to it fails in both places. */
  const tierFor = { required: "required", planned: "recommended", "not-required": "not-currently-needed" };
  for (const requirement of Coverage.COVERAGE_REQUIREMENTS) {
    assert.strictEqual(Coverage.coverageDemand({ requirement }).tier, tierFor[requirement],
      `1: ${requirement} must still project to ${tierFor[requirement]}`);
  }
  assert.strictEqual(Coverage.coverageRequirement({}), "required",
    "1: and the unauthored default was NOT flipped by this slice either");

  note("1. the demand projection is total over requirement × satisfied × production, never leaves its four "
    + "declared states, carries the tier through unchanged, and FAILS CLOSED — only a knowing \"no shot uses "
    + "this\" may stand required work down");
}

/* ================================================================== 2 · OWNER
   entityReferenceDemand() is the state-bearing relationship projection, which
   is the same one readiness gates its entity requirements on. */
function ownerSection() {
  const project = demandFixture({ cast: false });
  const dormant = Entities.entityReferenceDemand(project, "character", "RD-CHAR");
  assert.deepStrictEqual({ known: dormant.known, demanded: dormant.demanded, shots: dormant.shotIds.length },
    { known: true, demanded: false, shots: 0 }, "2: a reference no shot casts is dormant, and the answer is KNOWN");

  const cast = Entities.entityReferenceDemand(demandFixture({ cast: true }), "character", "RD-CHAR");
  assert.deepStrictEqual({ known: cast.known, demanded: cast.demanded, shots: cast.shotIds },
    { known: true, demanded: true, shots: ["L1-01"] }, "2: and a cast one is demanded, by the shot that casts it");

  /* TYPED, exactly as entityProductionUse() is: an id in another collection is
     not this reference. */
  const collide = demandFixture({ cast: true });
  collide.props.push({ id: "RD-CHAR", name: "Colliding prop", continuityStates: [] });
  assert.strictEqual(Entities.entityReferenceDemand(collide, "prop", "RD-CHAR").demanded, false,
    "2: a prop sharing a character's id must not inherit the character's demand");

  /* UNKNOWN TYPE REFUSES rather than asserting an absence it cannot support. */
  for (const type of ["", null, "audio", "sculpture", "Character"]) {
    assert.strictEqual(Entities.entityReferenceDemand(project, type, "RD-CHAR").known, false,
      `2: ${JSON.stringify(type)} is not a state-bearing entity type and must report that it does not know`);
  }
  assert.strictEqual(Entities.entityReferenceDemand(project, "character", "").known, false,
    "2: and an empty id knows nothing either");

  /* A DECLARATION IS NOT A RELATIONSHIP, and this is exactly why the demand owner
     is the state-bearing projection rather than the broader dependency record:
     shared-shot-readiness.js already refuses a declaration-only entity as an
     input, and a demand derived from the wider set would put the backlog back
     through a second door. */
  const declared = demandFixture({ cast: false });
  declared.shots[0].continuityStateSelections = { "RD-CHAR": "state-default" };
  assert.strictEqual(Entities.entityReferenceDemand(declared, "character", "RD-CHAR").demanded, false,
    "2: a stale continuity declaration must not resurrect demand for a reference no shot uses");
  assert.ok(Entities.shotDependencyRecords(declared, declared.shots[0])
    .some((row) => row.id === "RD-CHAR" && row.resolved),
    "2: (and the wider dependency record DOES see it, which is the distinction being made)");

  /* DEMAND IS A SUBSET OF USAGE. Whatever the broader relationship count says,
     demand can never claim a shot that record does not hold. */
  for (const fixture of [demandFixture({ cast: true }), demandFixture({ cast: false }), declared]) {
    const answer = Entities.entityReferenceDemand(fixture, "character", "RD-CHAR");
    for (const shotId of answer.shotIds) {
      const shot = fixture.shots.find((row) => row.id === shotId);
      assert.ok(Entities.shotDependencyRecords(fixture, shot).some((row) => row.resolved && row.type === "character" && row.id === "RD-CHAR"),
        `2: demand named ${shotId}, which the dependency record does not relate to this reference`);
    }
  }

  /* PURE. No clock, no filesystem, no network, and no write to the project. */
  const before = JSON.stringify(project);
  Entities.entityReferenceDemand(project, "character", "RD-CHAR");
  assert.strictEqual(JSON.stringify(project), before, "2: asking the question must not change the project");
  const source = codeOnly(read("public/shared-entities.js"));
  const region = source.slice(source.indexOf("function entityReferenceDemand"));
  assert.ok(!/Date\.now|new Date|Math\.random|require\(["']fs|fetch\(/.test(region.slice(0, 1400)),
    "2: the demand owner must reach no clock, no randomness, no filesystem and no network");

  note("2. the demand owner is shotStateBearingEntityRecords() — the same projection readiness gates its own "
    + "entity requirements on — so it is typed, refuses unknown types, treats a continuity declaration as no "
    + "relationship at all, can never name a shot the dependency record does not hold, and writes nothing");
}

/* ============================================================= 3 · RD1 - RD10 */
async function demandMatrixSection(options = {}) {
  /* RD1-RD4 · a dormant reference of every visual kind creates no backlog. */
  const dormantKinds = [];
  for (const list of ["characters", "locations", "props", "vehicles"]) {
    const id = `RD-${list.toUpperCase()}`;
    const rendered = await referenceSurface(demandFixture({ cast: false, list, id }), { ...options, list, id });
    const counts = demandCounts(rendered.html);
    assert.strictEqual(counts.production, "dormant", `RD: a ${list} no shot uses must be reported dormant`);
    assert.strictEqual(counts.now, 0,
      `RD: a dormant ${list} must create ZERO currently-required reference work, got ${counts.now}`);
    assert.ok(counts.required > 0,
      "RD: (and the fixture must actually carry required slots, or the zero above proves nothing)");
    assert.strictEqual(counts.dormant, counts.missing,
      `RD: every unmet required item of a dormant ${list} must be filed as available, not deleted`);
    dormantKinds.push(`${list}:${counts.required}->0`);
  }

  /* RD5 · casting the reference makes the work appear, with no other edit. */
  const cast = await referenceSurface(demandFixture({ cast: true }), options);
  const castCounts = demandCounts(cast.html);
  assert.strictEqual(castCounts.production, "demanded", "RD5: a cast reference is demanded");
  assert.ok(castCounts.now > 0, "RD5: and the reference work the production actually owes becomes current");
  /* CURRENT WORK IS WHAT READINESS OWES, NOT THE WHOLE TEMPLATE. An independent
     review found this suite's earlier expectation — `now === missing` — asserting
     the very defect the slice exists to remove: casting a character made all
     eight of its seeded coverage slots "required now" while Production owed only
     the primary reference. Section AG holds the agreement; this holds the shape. */
  assert.ok(castCounts.now < castCounts.missing,
    `RD5: and it is the production's obligation, not the entity's whole coverage template `
    + `(now=${castCounts.now} of missing=${castCounts.missing})`);
  assert.strictEqual(castCounts.plan, castCounts.missing,
    "RD5: with the rest of the template present and counted as coverage plan");
  assert.strictEqual(castCounts.dormant, 0, "RD5: and nothing standing by for want of a shot");

  /* RD6 · un-casting it makes the work disappear again, and deletes nothing. */
  const uncast = demandFixture({ cast: true });
  uncast.characters.find((row) => row.id === "RD-CHAR").coverageSlots[0].selectedFile = "RD-CHAR-FRONT.png";
  const before = await referenceSurface(uncast, options);
  assert.ok(demandCounts(before.html).now > 0, "RD6: (precondition) the cast reference has current work");
  uncast.shots[0].characters = ["KAI"];
  const after = await referenceSurface(uncast, options);
  assert.strictEqual(demandCounts(after.html).now, 0, "RD6: removing the shot's use removes the demand");
  const survived = JSON.parse(vm.runInContext(`JSON.stringify({
    slots: (P.characters.find((row) => row.id === "RD-CHAR").coverageSlots || []).map((s) => s.selectedFile || ""),
    states: (P.characters.find((row) => row.id === "RD-CHAR").continuityStates || []).length,
  })`, after.context));
  assert.ok(survived.slots.includes("RD-CHAR-FRONT.png"),
    "RD6: nothing about the reference was deleted when the demand went away");
  assert.ok(survived.states > 0, "RD6: and its continuity states are still on it");

  /* RD7 · a class the requirement does not ask for is not demanded merely
     because the slot exists — even on a reference the production IS using. */
  const optional = demandFixture({ cast: true });
  optional.characters.find((row) => row.id === "RD-CHAR").coverageSlots = slotSet(["front", "profile"], "not-required");
  const optionalRender = await referenceSurface(optional, options);
  for (const id of ["front", "profile"]) {
    assert.ok(new RegExp(`data-demand-id="${id}"`).test(optionalRender.html),
      `RD7: the ${id} slot must still be on screen`);
    const row = new RegExp(`<article class="entity-demand-row[^"]*"[^>]*data-demand-tier="([^"]*)"[^>]*data-demand-id="${id}"`).exec(optionalRender.html);
    assert.ok(row, `RD7: the ${id} slot must carry a tier`);
    assert.strictEqual(row[1], "not-currently-needed",
      `RD7: an affirmatively not-required view must stay not currently needed even on a reference in use (${id})`);
  }

  /* RD8 · a satisfied requirement is not outstanding. */
  const satisfied = demandFixture({ cast: true });
  for (const slot of satisfied.characters.find((row) => row.id === "RD-CHAR").coverageSlots) {
    slot.selectedFile = `${slot.id}.png`;
    slot.status = "selected";
  }
  const satisfiedCounts = demandCounts((await referenceSurface(satisfied, options)).html);
  assert.ok(satisfiedCounts.required > satisfiedCounts.missing,
    "RD8: (the fixture must actually satisfy some, or the counts below prove nothing)");
  assert.ok(satisfiedCounts.plan < satisfiedCounts.required,
    "RD8: a satisfied requirement leaves the coverage plan, because it is covered");
  assert.ok(!/data-demand-id="front"[^>]*>[\s\S]{0,200}?Nothing selected yet/.test(
    (await referenceSurface(satisfied, options)).html),
    "RD8: and a covered slot never reads as outstanding");

  /* RD9 · a historic/superseded declaration is not current demand. */
  const historic = demandFixture({ cast: false });
  historic.shots[0].continuityStateSelections = { "RD-CHAR": "state-default" };
  const historicCounts = demandCounts((await referenceSurface(historic, options)).html);
  assert.strictEqual(historicCounts.now, 0,
    "RD9: a declaration left behind by a relationship that no longer exists is not current demand");
  assert.strictEqual(historicCounts.production, "dormant", "RD9: and the surface says so");

  /* RD10 · one satisfaction covers every shot that shares it. */
  const shared = demandFixture({ cast: true });
  shared.shots.push({ ...JSON.parse(JSON.stringify(shared.shots[0])), id: "L1-02" });
  const sharedCounts = demandCounts((await referenceSurface(shared, options)).html);
  assert.strictEqual(sharedCounts.now, castCounts.now,
    "RD10: two shots asking for the same reference must not double the filmmaker's work "
    + `(${sharedCounts.now} vs ${castCounts.now})`);

  note("3. RD1-RD10 · dormant character/location/prop/vehicle each create ZERO current reference work "
    + `(${dormantKinds.join(", ")}); casting one makes exactly its unmet required items current; un-casting it `
    + "removes the demand and deletes none of the material; an affirmatively not-required view stays not needed; "
    + "a satisfied requirement is never outstanding; a stale declaration is not demand; and two shots sharing one "
    + "reference ask for it once");
}

/* ============================================================== 4 · AGREEMENT
   Every surface that speaks about required reference work says the same thing
   about the same project. */
async function agreementSection(options = {}) {
  const dormant = demandFixture({ cast: false });
  const rendered = await referenceSurface(dormant, options);
  const counts = demandCounts(rendered.html);
  const task = coverageTaskButton(rendered.html);

  assert.ok(task, "4: the reference taskbar must render the coverage task");
  assert.strictEqual(counts.now, 0, "4: the panel says there is no current work");
  assert.strictEqual(task.status, "Nothing waiting",
    `4: so the strip above it must not say Incomplete, got "${task.status}"`);
  assert.ok(/no shot uses this character yet/i.test(task.note),
    `4: and must say why, got "${task.note}"`);
  assert.ok(!/\d+ required view/.test(task.note),
    `4: the strip must not count required views for a reference nothing uses, got "${task.note}"`);
  assert.strictEqual(counts.obligations, "readiness",
    "4: and the surface must say the current-work number came from readiness rather than from the template");

  /* PRODUCTION AGREES: a dormant reference contributes no readiness requirement
     and no shared blocker. Asked of the shipped derivations, not restated. */
  const production = await render("#/production", dormant, options);
  const feed = JSON.parse(vm.runInContext("JSON.stringify(projectShotReadiness())", production.context));
  const rows = (feed.shots || []).flatMap((shot) => [
    ...(shot.requirements || []),
    ...(shot.units || []).flatMap((unit) => unit.requirements || []),
  ]);
  assert.ok(rows.length, "4: (the project must have real requirements, or the absence below proves nothing)");
  assert.deepStrictEqual(rows.filter((row) => String(row.id || "").includes("RD-CHAR")), [],
    "4: Production must raise no requirement at all for a reference no shot uses");
  const blockers = JSON.parse(vm.runInContext(
    "JSON.stringify(projectSharedBlockers(projectShotReadiness()).map((row) => row.key))", production.context));
  assert.ok(!blockers.some((key) => key.includes("RD-CHAR")),
    "4: and no shared blocker either — the two surfaces cannot disagree, because they ask one projection");

  /* AND THE OTHER WAY. A cast reference is demanded on its own surface AND
     raises requirements in Production. */
  const cast = demandFixture({ cast: true });
  const castSurface = await referenceSurface(cast, options);
  assert.strictEqual(demandCounts(castSurface.html).production, "demanded", "4: a cast reference reads demanded");
  const castProduction = await render("#/production", cast, options);
  const castRows = JSON.parse(vm.runInContext(`JSON.stringify(
    (projectShotReadiness().shots || []).flatMap((shot) => (shot.units || []).flatMap((unit) => unit.requirements || []))
      .filter((row) => String(row.id || "").includes("RD-CHAR")).map((row) => row.id))`, castProduction.context));
  assert.ok(castRows.length,
    "4: and Production raises its entity requirement, so demanded on one surface means demanded on the other");

  /* REFERENCE CONFIRMATION IS DEMAND-DRIVEN TOO, and this is the sharpest form of
     it. A HISTORIC pointer — a file on the record that no receipt vouches for — is
     exactly what the Historic confirmation queue exists to collect, and a dormant
     reference carrying one must not be in it. Asked of the shipped queue rather
     than of a lookalike, because the queue is what a filmmaker is shown. */
  const historic = demandFixture({ cast: false });
  historic.characters.find((row) => row.id === "RD-CHAR").approvedFile = "RD-CHAR-UNCONFIRMED.png";
  historic.characters.find((row) => row.id === "RD-CHAR").continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "RD-CHAR-UNCONFIRMED.png" },
  ];
  const historicProduction = await render("#/production", historic, options);
  const queue = JSON.parse(vm.runInContext(
    "JSON.stringify((projectShotReadiness().historic || {}).items || [])",
    historicProduction.context));
  const queued = queue.map((row) => String((row && row.key) || ""));
  assert.ok(!queued.some((key) => key.includes("RD-CHAR")),
    `4: a dormant reference with an unconfirmed pointer must not ask for confirmation, got ${JSON.stringify(queued)}`);

  /* AND THE QUEUE IS NOT EMPTY, or the absence above proves nothing: the shared
     fixture's own references carry historic pointers and DO belong in it. */
  assert.ok(queued.length,
    "4: (the confirmation queue must actually hold something, or the absence above is vacuous)");

  /* Cast the same reference and the confirmation appears — the same queue, the
     same pointer, one structural fact different. */
  const castHistoric = JSON.parse(JSON.stringify(historic));
  castHistoric.shots[0].characters = ["KAI", "RD-CHAR"];
  const castQueue = JSON.parse(vm.runInContext(
    "JSON.stringify((projectShotReadiness().historic || {}).items || [])",
    (await render("#/production", castHistoric, options)).context));
  assert.ok(castQueue.some((row) => String((row && row.key) || "").includes("RD-CHAR")),
    "4: and once a shot uses it, the confirmation it genuinely owes DOES appear");

  /* THE ASSISTED TOOLS STOP ADVERTISING A BACKLOG TOO, and still work. */
  const summary = /<details class="reference-assisted-tools"[\s\S]*?<\/summary>/.exec(rendered.html);
  if (summary) {
    assert.ok(!/\d+ missing<\/span>/.test(summary[0]),
      "4: the assisted-tools pill must not count missing work for a dormant reference");
  }
  assert.ok(rendered.html.includes("openCoverageAutomationModal") || !summary,
    "4: and the tools themselves are unchanged — nothing was removed, only the claim about outstanding work");

  note("4. one answer, five surfaces · a dormant reference reads `dormant` on the demand panel, \"Nothing waiting · "
    + "no shot uses this character yet\" on the reference strip, raises zero readiness requirements and zero shared "
    + "blockers in Production, and stops advertising a missing count on the assisted tools — while a cast one is "
    + "demanded on the surface and raises its entity requirement in Production. The Historic confirmation "
    + "queue obeys the same rule: a dormant reference carrying an unconfirmed pointer is absent from a queue "
    + "that is not empty, and casting it into a shot puts back the confirmation it genuinely owes");
}

/* ==================================================== 5 · REVERSIBLE LOCATION */
async function locationSection(options = {}) {
  const project = buildFixture();
  const inputs = { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" };
  const before = await render("#/shot/L1-01", project, { ...options, storage: inputs });

  /* THE CONTROL EXISTS, in the picker the location was chosen in. */
  const control = /data-clear-location="L1-01"[^>]*onclick="([^"]*)"/.exec(before.html);
  assert.ok(control, "5: the location picker must offer a way to select no location");
  assert.strictEqual(control[1], "setShotCreationLocation('L1-01','')",
    "5: and it must go through the shipped writer with the empty value, not through a new mutation path");
  assert.ok(/data-clear-location="L1-01"[^>]*aria-pressed="false"/.test(before.html),
    "5: while a location IS selected, the no-location choice must read as not chosen");
  assert.ok(!/confirmModal\([^)]*clear-location/.test(before.html),
    "5: clearing a relationship is not destructive and must not demand a destructive confirmation");

  /* IT CLEARS, and normalization does not put it straight back. */
  const state = () => JSON.parse(vm.runInContext(`JSON.stringify({
    locationId: P.shots[0].creationBrief.locationId || "",
    codes: P.shots[0].codes,
    resolved: resolveShotEntities(P, P.shots[0]).locations.map((row) => row.id),
  })`, before.context));
  assert.strictEqual(state().locationId, "LOC-HULL", "5: (precondition) the shot has a location");
  vm.runInContext(control[1], before.context);
  const cleared = state();
  assert.strictEqual(cleared.locationId, "", "5: the shot's location selection is gone");
  assert.ok(!cleared.codes.includes("LOC-HULL"),
    "5: and the token that would let normalization infer it back is gone with it");
  assert.deepStrictEqual(cleared.resolved, [], "5: so the shot structurally uses no location");
  vm.runInContext("normalizeShotV5(P.shots[0])", before.context);
  assert.strictEqual(state().locationId, "",
    "5: and it stays gone across the normalization every project load runs");

  /* THE SURFACE UPDATES, and the way back in is still there. */
  const clearedProject = JSON.parse(vm.runInContext("JSON.stringify(P)", before.context));
  const after = await render("#/shot/L1-01", clearedProject, { ...options, storage: inputs });
  assert.ok(/data-clear-location="L1-01"[^>]*aria-pressed="true"/.test(after.html),
    "5: the cleared state must be visible on the control that produced it");
  assert.ok(after.html.includes("setShotCreationLocation('L1-01','LOC-HULL')"),
    "5: and the same location must be selectable again — clearing is a change of mind, not a deletion");
  const plateSection = after.html.slice(after.html.indexOf("LOCATION PLATE"), after.html.indexOf("<b>CHARACTERS</b>"));
  assert.ok(plateSection.length > 0, "5: (the location section must still render)");
  assert.ok(!/primary plate/.test(plateSection),
    "5: and no location may still be presented as this shot's primary plate");

  /* DEMAND RECOMPUTES FROM THE CLEARED STRUCTURE. */
  const locationSurface = await referenceSurface(clearedProject, { ...options, list: "locations", id: "LOC-HULL" });
  assert.strictEqual(demandCounts(locationSurface.html).production, "dormant",
    "5: the location the shot released must now read dormant on its own surface");
  assert.strictEqual(demandCounts(locationSurface.html).now, 0,
    "5: and owe the filmmaker no current reference work");

  note("5. the Location picker offers \"No location\" as a peer of the plates, routed through the shipped "
    + "setShotCreationLocation writer with the empty value; it clears creationBrief.locationId AND the codes token, "
    + "survives normalizeShotV5, updates the control's own pressed state, leaves the same plate selectable again, "
    + "and the released location goes dormant on its own reference surface");
}

/* ============================================ 6 · REVERSIBLE STATE DECLARATION */
async function stateDeclarationSection(options = {}) {
  const project = buildFixture();
  project.characters[0].continuityStates = [
    { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    { id: "state-soot", name: "Sooty", isDefault: false, parentStateId: "state-default" },
  ];
  project.shots[0].continuityStateSelections = { KAI: "state-soot" };
  const inputs = { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" };
  const rendered = await render("#/shot/L1-01", project, { ...options, storage: inputs });

  const row = /<article data-shot-state-entity="KAI"[\s\S]*?<\/article>/.exec(rendered.html);
  assert.ok(row, "6: the shot's continuity-state declaration row must render");
  const empty = /<option value=""([^>]*)>([^<]*)<\/option>/.exec(row[0]);
  assert.ok(empty, "6: the row's chooser must offer the empty value");
  assert.ok(!/\bdisabled\b/.test(empty[1]),
    "6: and it must be selectable — a declaration made once was otherwise permanent");
  assert.ok(/^Clear — follow /.test(empty[2]),
    `6: the option must say what clearing does, got "${empty[2]}"`);
  assert.ok(empty[2].includes("Clean"),
    "6: and name the state the shot would fall back to, which the row already knows");

  /* IT CLEARS, through the shipped command, and the reference keeps its states. */
  const result = JSON.parse(vm.runInContext("JSON.stringify(chooseShotContinuityState('L1-01','KAI',''))", rendered.context));
  assert.strictEqual(result.status, "applied", "6: the shipped declaration command must accept the clear");
  assert.strictEqual(result.operation, "cleared", "6: and record it as a clear rather than as a selection");
  assert.deepStrictEqual(JSON.parse(vm.runInContext("JSON.stringify(P.shots[0].continuityStateSelections)", rendered.context)), {},
    "6: the shot-scoped declaration is gone");
  assert.deepStrictEqual(
    JSON.parse(vm.runInContext("JSON.stringify(P.characters[0].continuityStates.map((row) => row.id))", rendered.context)),
    ["state-default", "state-soot"],
    "6: and the states themselves are untouched on the reference — this cleared a shot's use, not a Bible record");

  const after = await render("#/shot/L1-01",
    JSON.parse(vm.runInContext("JSON.stringify(P)", rendered.context)), { ...options, storage: inputs });
  const afterRow = /<article data-shot-state-entity="KAI"[\s\S]*?<\/article>/.exec(after.html);
  assert.ok(afterRow && /No shot declaration/.test(afterRow[0]),
    "6: the row must now describe the state the product always knew how to describe and could never reach");
  assert.ok(afterRow[0].includes('value="state-soot"'),
    "6: and the same state must be choosable again");

  note("6. the shot continuity-state chooser's empty option is selectable and named — `Clear — follow <default>`. "
    + "applyShotStateDeclaration() already answered `operation: \"cleared\"` and app.js already had the toast; the "
    + "rendered control had disabled the only option that reached them. Clearing removes the shot's declaration and "
    + "leaves every state on the reference");
}

/* =========================================================== 7 · AUTH1 - AUTH4
   Structure and authority are different concepts, and clearing one may not
   touch the other. */
async function authoritySection(options = {}) {
  const inputs = { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" };

  /* AUTH1 · clear the shot's Location; the location's Canon is untouched. */
  const project = withCanon(buildFixture(), [
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  ]);
  const rendered = await render("#/shot/L1-01", project, { ...options, storage: inputs });
  const ledgerBefore = vm.runInContext("JSON.stringify(P.productionAuthority)", rendered.context);
  const locationBefore = vm.runInContext("JSON.stringify(P.locations.find((row) => row.id === 'LOC-HULL'))", rendered.context);
  const mediaBefore = vm.runInContext("JSON.stringify({ frames: P.shots[0].keyframes.map((f) => f.winner), clips: P.shots[0].clips.map((c) => c.videoWinner || '') })", rendered.context);
  const requirementsBefore = JSON.parse(vm.runInContext(`JSON.stringify(
    evaluateShotReadiness(P, P.shots[0]).units.flatMap((unit) => unit.requirements)
      .filter((row) => String(row.id || "").includes("LOC-HULL"))
      .map((row) => ({ id: row.id, state: row.state, reason: row.reason, value: row.value })))`, rendered.context));
  assert.ok(requirementsBefore.length,
    "AUTH: (the shot must actually raise a location requirement, or the round trip below proves nothing)");

  vm.runInContext("setShotCreationLocation('L1-01','')", rendered.context);
  assert.deepStrictEqual(JSON.parse(vm.runInContext(`JSON.stringify(
    evaluateShotReadiness(P, P.shots[0]).units.flatMap((unit) => unit.requirements)
      .filter((row) => String(row.id || "").includes("LOC-HULL")))`, rendered.context)), [],
    "AUTH1: while the location is cleared the shot raises no requirement for it — demand follows structure");
  assert.strictEqual(vm.runInContext("JSON.stringify(P.productionAuthority)", rendered.context), ledgerBefore,
    "AUTH1: clearing a shot's Location must not add, remove, revoke or rewrite one authority receipt");
  assert.strictEqual(vm.runInContext("JSON.stringify(P.locations.find((row) => row.id === 'LOC-HULL'))", rendered.context), locationBefore,
    "AUTH2: nor edit the location record or its approved references");

  /* AUTH3 · the shot's own approved media and history survive the detach. */
  assert.strictEqual(vm.runInContext("JSON.stringify({ frames: P.shots[0].keyframes.map((f) => f.winner), clips: P.shots[0].clips.map((c) => c.videoWinner || '') })", rendered.context), mediaBefore,
    "AUTH3: nor touch the shot's approved frames and motion");
  const canonAfter = JSON.parse(vm.runInContext(`JSON.stringify({
    frameA: !!currentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
    location: !!currentHumanAuthority(P, { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default" }),
  })`, rendered.context));
  assert.deepStrictEqual(canonAfter, { frameA: true, location: true },
    "AUTH3: and the kernel must still recognise both approvals — asked of the kernel, never of a pointer");

  /* AUTH4 · re-attaching restores the relationship, and the approval the location
     already held answers the shot's requirement again with no re-approval.

     ASSERTED AS AN EQUALITY AGAINST THE PRE-CLEAR ROWS rather than against a
     hard-coded state, because the state depends on the media oracle the caller
     supplied — this harness supplies none, so every entity row here is
     `media-availability-unknown`, which is a statement about bytes and not about
     authority. What must be true regardless of the oracle is that the round trip
     is the identity: the requirement the shot raises after clearing and
     re-selecting is the SAME requirement, resolved to the SAME approved value. A
     re-approval demand would change it. */
  const locationRows = () => vm.runInContext(`JSON.stringify(
    evaluateShotReadiness(P, P.shots[0]).units.flatMap((unit) => unit.requirements)
      .filter((row) => String(row.id || "").includes("LOC-HULL"))
      .map((row) => ({ id: row.id, state: row.state, reason: row.reason, value: row.value })))`, rendered.context);
  vm.runInContext("setShotCreationLocation('L1-01','LOC-HULL')", rendered.context);
  assert.deepStrictEqual(
    JSON.parse(vm.runInContext("JSON.stringify(resolveShotEntities(P, P.shots[0]).locations.map((row) => row.id))", rendered.context)),
    ["LOC-HULL"], "AUTH4: selecting the same location again restores the relationship");
  assert.strictEqual(vm.runInContext("JSON.stringify(P.productionAuthority)", rendered.context), ledgerBefore,
    "AUTH4: and re-attaching writes no receipt either — structure is not authority in either direction");
  const restored = JSON.parse(locationRows());
  assert.strictEqual(restored.length, requirementsBefore.length,
    `AUTH4: the shot must raise the same number of location requirements as before the clear `
    + `(${restored.length} vs ${requirementsBefore.length})`);
  assert.deepStrictEqual(restored, requirementsBefore,
    "AUTH4: and each one must be identical — same target, same state, same reason, same approved value. "
    + "Clearing and re-selecting a location asks the filmmaker to approve nothing again");
  assert.ok(restored.length && restored.every((row) => row.value === "LOC-HULL-PLATE.png"),
    `AUTH4: resolved to the image that was already approved, got ${JSON.stringify(restored.map((row) => row.value))}`);

  /* AUTH2, the other optional relation · clearing a state declaration writes no
     receipt and revokes none. */
  const declared = buildFixture();
  declared.characters[0].continuityStates = [
    { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    { id: "state-soot", name: "Sooty", isDefault: false, parentStateId: "state-default" },
  ];
  declared.shots[0].continuityStateSelections = { KAI: "state-soot" };
  const declaredRender = await render("#/shot/L1-01", declared, { ...options, storage: inputs });
  const declaredLedger = vm.runInContext("JSON.stringify(P.productionAuthority)", declaredRender.context);
  vm.runInContext("chooseShotContinuityState('L1-01','KAI','')", declaredRender.context);
  assert.strictEqual(vm.runInContext("JSON.stringify(P.productionAuthority)", declaredRender.context), declaredLedger,
    "AUTH2: clearing a shot continuity-state declaration must leave the receipt ledger byte-identical");

  note("7. AUTH1-AUTH4 · clearing a shot's Location leaves the authority ledger byte-identical, the location record "
    + "and its approved references untouched, and the shot's approved frames and motion intact; the kernel still "
    + "recognises both approvals; while cleared the shot raises no requirement for the location at all, and "
    + "re-selecting it writes no receipt and restores a byte-identical requirement resolved to the image that was "
    + "already approved — the round trip asks the filmmaker to approve nothing again. Same for a state declaration");
}

/* ================================================================== 8 · ROUTES
   Measured from the shipped route semantics, never inferred from the names. */
async function routeSection(options = {}) {
  const rendered = await render("#/production", buildFixture(), options);
  const observed = {};
  for (const route of ["", "t2v", "i2v", "flf", "r2v", "hybrid"]) {
    vm.runInContext(route
      ? `P.shots[0].deliveryRoute = ${JSON.stringify(route)};`
      : "delete P.shots[0].deliveryRoute;", rendered.context);
    observed[route || "absent"] = JSON.parse(vm.runInContext(`JSON.stringify({
      requiredUnits: evaluateShotReadiness(P, P.shots[0]).units.filter((unit) => unit.required).map((unit) => unit.id),
      entityDemands: [...new Set(evaluateShotReadiness(P, P.shots[0]).units
        .flatMap((unit) => unit.requirements).filter((row) => row.kind === "entity-state").map((row) => row.label))],
    })`, rendered.context));
  }

  /* WHAT THE ROUTE DOES GOVERN: which frame units are required. This is the
     Slice 5a/5b semantic and it is preserved, not re-derived. */
  assert.ok(!observed.t2v.requiredUnits.some((id) => id.startsWith("frame:")),
    "8: t2v requires no frame unit");
  assert.deepStrictEqual(observed.i2v.requiredUnits.filter((id) => id.startsWith("frame:")), ["frame:frame-a"],
    "8: i2v requires the opening frame and only that one");
  assert.deepStrictEqual(observed.flf.requiredUnits.filter((id) => id.startsWith("frame:")), ["frame:frame-a", "frame:frame-b"],
    "8: flf requires both endpoints");
  assert.ok(!observed.r2v.requiredUnits.some((id) => id.startsWith("frame:")),
    "8: r2v requires no frame unit of its own");

  /* WHAT IT DOES NOT GOVERN, and this is the fact the demand rule is built on
     rather than a rule invented for it: no shipped route narrows WHICH entities
     a declared unit needs a reference for. So demand for an entity's reference
     comes from the shot's structure, and a route-shaped demand rule would have
     been a new semantic with nothing behind it. */
  const perRoute = Object.entries(observed).map(([route, value]) => [route, value.entityDemands.slice().sort()]);
  const first = JSON.stringify(perRoute[0][1]);
  for (const [route, demands] of perRoute) {
    assert.strictEqual(JSON.stringify(demands), first,
      `8: ${route} demanded a different entity set (${JSON.stringify(demands)}) — if a route ever narrows entity `
      + "reference demand, the demand rule must be extended to hear it");
  }
  assert.ok(perRoute[0][1].length, "8: (and the shot must actually demand entities, or the equality proves nothing)");

  note("8. route interaction, measured · t2v requires no frame unit, i2v the opening frame only, flf both "
    + "endpoints, r2v none; and NO shipped route narrows which entities a declared unit needs a reference for "
    + `(${perRoute[0][1].length} entities demanded under every route), which is why demand is derived from shot `
    + "structure and not from a route-shaped rule this slice would have had to invent");
}

/* ==================================================================== 9 · COPY */
async function copySection(options = {}) {
  const dormant = await referenceSurface(demandFixture({ cast: false }), options);
  const headline = demandHeadline(dormant.html);
  assert.ok(/^No shot uses this character yet/.test(headline),
    `9: a dormant reference must not be told it owes required references, got "${headline}"`);
  assert.ok(!/required reference/.test(headline),
    "9: and the headline must not count required references it is not asking for");

  /* The four filmmaker-facing states are distinguishable on one surface. */
  const rich = demandFixture({ cast: true });
  rich.characters.find((row) => row.id === "RD-CHAR").coverageSlots = [
    { id: "front", label: "Front", requirement: "required", selectedFile: "" },
    { id: "profile", label: "Profile", requirement: "required", selectedFile: "profile.png", status: "selected" },
    { id: "detail", label: "Detail", requirement: "planned", selectedFile: "" },
    { id: "overhead", label: "Overhead", requirement: "not-required", selectedFile: "" },
  ];
  const richHtml = (await referenceSurface(rich, options)).html;
  const richCounts = demandCounts(richHtml);
  assert.ok(richCounts.now >= 1, "9: REQUIRED NOW is present");
  assert.ok(richCounts.plan >= 1, "9: OPTIONAL / AVAILABLE is present");
  assert.ok(richCounts.notNeeded >= 1, "9: NOT CURRENTLY NEEDED is present");
  assert.ok(/data-demand-id="profile"[\s\S]{0,400}?Selected/.test(richHtml), "9: SATISFIED is present and says so");

  /* THE DORMANT MATERIAL LEADS, AND THE LABEL CARRIES THE HONESTY.
     Not collapsed: a filmmaker building their Bible before the shot list exists
     has a reference where everything is dormant, and folding the workspace shut
     would answer a false backlog with an empty screen. What must not appear is
     the CLAIM, and that is asserted above and on the strip. */
  const lead = /<section class="entity-demand"[^>]*data-demand-lead="([^"]*)"/.exec(dormant.html);
  assert.ok(lead, "9: the surface must publish which list is leading");
  assert.strictEqual(lead[1], "available",
    "9: with nothing required now, the available material is what leads");
  const counts = demandCounts(dormant.html);
  const leadRows = /<div class="entity-demand-rows entity-demand-open">([\s\S]*?)<\/div>\s*(?:<details|<\/section)/.exec(dormant.html);
  assert.ok(leadRows, "9: and it must be rendered as the open list, not behind a disclosure");
  assert.strictEqual((leadRows[1].match(/<article class="entity-demand-row/g) || []).length, counts.dormant,
    "9: every dormant required item is in it — nothing counted is hidden and nothing hidden is counted");
  const caption = /<p class="entity-demand-lead-note">([^<]*)<\/p>/.exec(dormant.html);
  assert.ok(caption, "9: a leading list of material nobody has asked for must say so");
  assert.ok(/^Available/.test(caption[1]) && /None of it is required now/.test(caption[1])
    && /once a shot uses this character/.test(caption[1]),
    `9: naming the state, the condition and the absence of urgency, got "${caption[1]}"`);
  /* AND THE CONTROLS IN IT ARE REACHABLE, which is the specific thing the first
     version of this design broke: the contextual generate action for a dormant
     reference sat inside a closed disclosure and could not be clicked. */
  assert.ok(!/<details[^>]*>[\s\S]*<p class="entity-demand-lead-note">/.test(dormant.html.slice(dormant.html.indexOf('class="entity-demand"'))),
    "9: and nothing about the leading list may sit inside a disclosure");

  /* THE TIER IS STILL PRINTED. A dormant required view is still Required
     material; what changed is the claim that it is outstanding. */
  const frontRow = /<article class="entity-demand-row[^"]*"[^>]*data-demand-tier="([^"]*)"[^>]*data-demand-id="front"/.exec(dormant.html);
  assert.ok(frontRow, "9: the dormant required view must still have a row");
  assert.strictEqual(frontRow[1], "required",
    "9: and still be filed under the requirement it carries — Slice 3's rename is untouched");

  note("9. copy · a dormant reference reads \"No shot uses this character yet, so nothing is required now\", and "
    + "its required material LEADS the screen — not behind a disclosure — under \"Available — this is what the "
    + "production will need once a shot uses this character. None of it is required now.\", with every row keeping "
    + "its Required tier; the strip says \"Nothing waiting\"; and required-now / satisfied / recommended / "
    + "not-currently-needed remain four distinguishable answers on one screen");
}

/* ============================================================ 10 · NO DRIFT */
async function invariantSection(options = {}) {
  const entities = codeOnly(read("public/entities.js"));
  const coverage = codeOnly(read("public/shared-coverage.js"));
  const shared = codeOnly(read("public/shared-entities.js"));
  const studio = read("public/creation-studio.js");

  /* NOTHING NEW IS PERSISTED. The demand answer is derived on every read. */
  /* An ASSIGNMENT, not a comparison: `row.demandState === "required-now"` is a
     read and must not trip this, which is what the negative lookahead is for. */
  assert.ok(!/\.(demandState|demandBasis|productionDemanded)\s*=(?!=)/.test(entities + coverage + shared),
    "10: the demand answer must never be written onto a slot, a state or an entity");
  const derivation = entities.slice(entities.indexOf("function entityReferenceDemandFor"), entities.indexOf("function entityDemandActionMarkup"));
  assert.ok(derivation.length > 400, "10: (the derivation region must actually have been located)");
  assert.ok(!/dirty\(\)|route\(\)/.test(derivation),
    "10: and deriving it must neither mark the project dirty nor re-enter routing");

  /* NO SECOND REFERENCE AUTHORITY. The demand projection must not consult a
     receipt, a winner or an approvedFile to decide what is required. */
  const projection = coverage.slice(coverage.indexOf("function referenceDemandState"));
  assert.ok(projection.length > 200, "10: (the projection must actually have been located)");
  assert.ok(!/currentHumanAuthority|productionAuthority|approvedFile|winner/.test(projection),
    "10: the demand projection must decide nothing about authority");

  /* SLICE 1 · the readiness projection, its blockers and its one primary CTA. */
  const production = await render("#/production", buildFixture(), options);
  const next = JSON.parse(vm.runInContext("JSON.stringify(projectNextProductionAction() || {})", production.context));
  assert.ok(next.actionLabel, "10 (Slice 1): the project still names one primary next action");
  assert.strictEqual(vm.runInContext("typeof projectSharedBlockers", production.context), "function",
    "10 (Slice 1): projectSharedBlockers is still the shared-blocker owner");

  /* SLICE 2 · Bible canon is not reachable from a structural clear. */
  const writer = studio.slice(studio.indexOf("window.setShotCreationLocation"), studio.indexOf("window.toggleShotCreationCharacter"));
  assert.ok(writer.length > 200, "10: (the location writer must actually have been located)");
  assert.ok(!/deleteEntity|removeEntity|\.splice\(/.test(writer),
    "10 (Slice 2): the location writer must delete no entity and splice no collection");

  /* SLICE 3 · the returned-review scope was not merged into reference demand. */
  const demandRegion = entities.slice(entities.indexOf("function entityDemandMarkup"), entities.indexOf("function entityCoverageStatesMarkup"));
  assert.ok(demandRegion.length > 400, "10: (the demand markup region must actually have been located)");
  assert.ok(!/returnedResultsAwaitingReview|returnedReview|awaitingReview/.test(demandRegion),
    "10 (Slice 3): returned-result review must stay its own scope and never be counted as reference demand");

  /* SLICE 4 · no launch-language or provider vocabulary leaked into the demand
     projection. */
  for (const pattern of [/Send to finishing/i, /Mark shot final/i, /\bprovider\b/i, /deliveryRoute/]) {
    assert.ok(!pattern.test(projection), `10 (Slice 4): ${pattern} must not appear in the demand projection`);
  }

  note("10. no drift · the demand answer is derived on every read and never persisted, marked dirty or routed "
    + "through; the projection consults no receipt, pointer or winner; Slice 1's one primary action and "
    + "shared-blocker owner stand; the location writer deletes nothing; returned-result review is not merged into "
    + "reference demand; and no Slice 4 launch, provider or route vocabulary reached the projection");
}

/* ================================================ 11 · REVERSIBILITY SURVEY
   THE WHOLE SET, so "structure is reversible" is a census rather than an anecdote.

   The brief asks whether the optional relations share a coherent owner with
   Location and can be repaired generically. They do share the rule — every one
   of them is FILMMAKER-AUTHORED SHOT-SCOPED STRUCTURE, or a filmmaker's choice
   of which supporting file fills a slot — and the survey below is the evidence,
   taken off the rendered product rather than asserted in prose.

   Five of the seven already shipped a way out. Two did not, and those two are
   what this slice added; both went through the writer that already existed for
   them rather than through a new one. Nothing here is a new mutation path.

   A relation that ever loses its clear path fails HERE as well as in its own
   section, which is the point of counting them together. */
async function reversibilitySurvey(options = {}) {
  const project = buildFixture();
  project.characters[0].continuityStates = [
    { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    { id: "state-soot", name: "Sooty", isDefault: false, parentStateId: "state-default" },
  ];
  project.shots[0].continuityStateSelections = { KAI: "state-soot" };
  project.shots[0].creationBrief = { ...(project.shots[0].creationBrief || {}), propIds: ["PR-TOOL"] };
  const shot = await render("#/shot/L1-01", project,
    { ...options, storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" } });
  const entity = await referenceSurface(project, { ...options, list: "characters", id: "KAI",
    storage: { "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:KAI": "coverage" } });

  const relations = [
    ["shot uses character", "shipped", /onclick="toggleShotCreationCharacter\('L1-01','KAI'\)"/.test(shot.html)],
    ["shot uses prop or vehicle", "shipped", /onclick="toggleShotCreationProp\('L1-01','[^']+'\)"/.test(shot.html)],
    ["shot includes a reference input", "shipped", /onclick="toggleGuidedShotInput/.test(shot.html)],
    ["shot uses location", "slice 5", /data-clear-location="L1-01"[^>]*onclick="setShotCreationLocation\('L1-01',''\)"/.test(shot.html)],
    ["shot declares a continuity state", "slice 5",
      (() => {
        const row = /<article data-shot-state-entity="KAI"[\s\S]*?<\/article>/.exec(shot.html);
        const empty = row && /<option value=""([^>]*)>/.exec(row[0]);
        return !!empty && !/\bdisabled\b/.test(empty[1]);
      })()],
    ["coverage slot holds a file", "shipped", entity.html.includes("— no view selected —")],
    /* The expression board is the coverage board's twin and draws its options from
       the same function, so it is surveyed through the same option rather than
       through a lookalike that could pass while the real one failed. */
    ["expression slot holds a file", "shipped",
      /onchange="setExpressionSlotField\('KAI',\d+,'selectedFile'/.test(entity.html)
      || !(project.characters[0].expressionSlots || []).length],
  ];

  const stuck = relations.filter(([, , reversible]) => !reversible).map(([name]) => name);
  assert.deepStrictEqual(stuck, [],
    `11: these authored relations have no way out: ${stuck.join(", ")}`);
  assert.strictEqual(relations.length, 7,
    "11: (the survey must actually cover the set it claims to — add the relation here when one is added to the product)");

  /* AND THE TWO THIS SLICE ADDED WENT THROUGH THE EXISTING WRITERS. A clear path
     built on a new mutation path would be a second way to change structure, which
     is the duplicate-owner problem every other slice here has been removing. */
  const studio = codeOnly(read("public/creation-studio.js"));
  assert.strictEqual((studio.match(/window\.setShotCreationLocation\s*=/g) || []).length, 1,
    "11: there must still be exactly one writer for a shot's location");
  assert.ok(/function guidedLocationClearButton[\s\S]{0,600}?setShotCreationLocation\('/.test(studio),
    "11: and the clear control must call it rather than edit the shot itself");
  assert.ok(!/creationBrief\.locationId\s*=(?!=)/.test(
    studio.slice(0, studio.indexOf("window.setShotCreationLocation"))
    + studio.slice(studio.indexOf("window.toggleShotCreationCharacter"))),
    "11: and nothing outside that writer may assign the shot's location");
  assert.strictEqual((codeOnly(read("public/app.js")).match(/window\.chooseShotContinuityState\s*=/g) || []).length, 1,
    "11: there must still be exactly one entry point for a shot's continuity-state declaration");

  const shipped = relations.filter(([, origin]) => origin === "shipped").length;
  note(`11. reversibility survey · all ${relations.length} filmmaker-authored optional relations have a reachable `
    + `clear path — ${shipped} already shipped one (character, prop/vehicle, reference input, coverage slot, `
    + `expression slot) and 2 did not (shot location, shot continuity-state declaration). Both were repaired `
    + `through the writer that already existed for them: setShotCreationLocation is still the only writer of a `
    + `shot's location, and chooseShotContinuityState is still the only entry point for its state declaration`);
}

/* ================================================ 12 · FD1-FD7 · FAIL CLOSED
   ONLY A POSITIVELY-KNOWN ABSENCE MAY STAND REQUIRED WORK DOWN.

   The independent review's reproduction, and the reason this section exists:

       characters:  CHAR  and  CHAR-A
       shot codes:  ["CHAR-A"]

   shotEntityTokenMatches accepts an id followed by "-", so both entities match
   the one token; classifyShotCodeTokens calls it AMBIGUOUS and names both;
   shotDependencyRecords resolves the first. Asking about CHAR-A therefore
   returned `known: true, demanded: false` — a positive claim of absence about an
   entity the project's own classifier had just listed as a candidate — and
   CHAR-A's required reference work was stood down.

   Every case below is the same project with one fact changed, and the invariant
   is one-way: uncertainty may only ever ADD work back. */
function failClosedSection() {
  const Coverage2 = Coverage;
  const collision = (mutate) => {
    const project = buildFixture();
    project.characters = [
      { id: "CHAR", name: "Char", continuityStates: [], coverageSlots: slotSet(["front"]) },
      { id: "CHAR-A", name: "Char A", continuityStates: [], coverageSlots: slotSet(["front"]) },
    ];
    project.shots[0].characters = [];
    project.shots[0].codes = [];
    project.shots[0].creationBrief = { propIds: [] };
    mutate(project.shots[0], project);
    return project;
  };
  const ask = (project, id = "CHAR-A") => Entities.entityReferenceDemand(project, "character", id);

  /* FD1 · exact, unambiguous use. */
  const fd1 = collision((shot, project) => { project.characters = [project.characters[1]]; shot.codes = ["CHAR-A"]; });
  assert.deepStrictEqual({ known: ask(fd1).known, demanded: ask(fd1).demanded }, { known: true, demanded: true },
    "FD1: an unambiguous relationship is definitely used");

  /* FD2 · known dormant, on data that reads cleanly. */
  const fd2 = collision(() => {});
  assert.deepStrictEqual({ known: ask(fd2).known, demanded: ask(fd2).demanded }, { known: true, demanded: false },
    "FD2: clean data with no relationship is definitely unused, and may stand work down");

  /* FD3 · THE REPRODUCED CASE. */
  const fd3 = collision((shot) => { shot.codes = ["CHAR-A"]; });
  const classified = Entities.classifyShotCodeTokens(fd3, fd3.shots[0]);
  assert.strictEqual(classified[0].status, "ambiguous",
    "FD3: (precondition) the shipped classifier must call this token ambiguous");
  assert.deepStrictEqual(classified[0].matches.map((row) => row.id), ["CHAR", "CHAR-A"],
    "FD3: (precondition) and name both candidates, CHAR-A among them");
  assert.deepStrictEqual(Entities.shotDependencyRecords(fd3, fd3.shots[0]).filter((r) => r.type === "character").map((r) => r.id), ["CHAR"],
    "FD3: (precondition) while the resolver takes the first — which is what made the false certainty");
  assert.strictEqual(ask(fd3).known, false,
    "FD3: so CHAR-A's use CANNOT be known, and the answer must say so rather than claim absence");
  assert.ok(ask(fd3).uncertain.some((row) => /ambiguous/.test(row)),
    `FD3: naming the reason, got ${JSON.stringify(ask(fd3).uncertain)}`);
  assert.strictEqual(ask(fd3, "CHAR").demanded, true,
    "FD3: and the entity the resolver DID pick is still definitely used — uncertainty is per-entity");

  /* FD4 · every collection the resolver reads, one malformation each. */
  const malformations = [
    ["characters as a string", (shot) => { shot.characters = "CHAR-A"; }],
    ["codes as a string", (shot) => { shot.codes = "CHAR-A"; }],
    ["clips as a string", (shot) => { shot.clips = "nope"; }],
    ["audio as an array", (shot) => { shot.audio = []; }],
    ["continuityStateSelections as a string", (shot) => { shot.continuityStateSelections = "nope"; }],
    ["creationBrief as a string", (shot) => { shot.creationBrief = "nope"; }],
    ["creationBrief.propIds as a string", (shot) => { shot.creationBrief = { propIds: "nope" }; }],
    ["creationBrief.vehicleIds as a string", (shot) => { shot.creationBrief = { vehicleIds: "nope" }; }],
  ];
  for (const [label, mutate] of malformations) {
    const answer = ask(collision(mutate));
    assert.strictEqual(answer.known, false, `FD4: ${label} must not produce a known absence`);
    assert.ok(answer.uncertain.some((row) => /malformed/.test(row)), `FD4: ${label} must say why`);
  }
  /* And the whole shot list. */
  const fd4b = collision(() => {});
  fd4b.shots = "not an array";
  assert.strictEqual(ask(fd4b).known, false,
    "FD4: a project whose shot list is not a list cannot support a claim about production structure");
  /* An ABSENT collection is not a malformation — there is nothing to misread. */
  const fd4c = collision((shot) => { delete shot.codes; delete shot.clips; delete shot.audio; });
  assert.strictEqual(ask(fd4c).known, true,
    "FD4: an absent collection is absence, not damage, and must still permit a confident answer");

  /* FD5 · a token whose type is known and which names nothing. */
  const fd5 = collision((shot) => { shot.codes = ["CHARACTER-NOPE"]; });
  assert.strictEqual(Entities.classifyShotCodeTokens(fd5, fd5.shots[0])[0].status, "unresolved",
    "FD5: (precondition) the classifier must call this token unresolved");
  assert.strictEqual(ask(fd5).known, false,
    "FD5: a relationship CineBraid cannot read is not evidence that some other reference is unused");
  /* ...and the one case where shipped semantics DO prove absence: a token that
     lost specificity but demonstrably resolved to a different entity, and could
     not have named this one. */
  const fd5b = collision((shot) => { shot.codes = ["CHAR-GHOST"]; });
  assert.strictEqual(Entities.classifyShotCodeTokens(fd5b, fd5b.shots[0])[0].status, "reinterpreted",
    "FD5: (precondition) a token that resolves to exactly one entity with specificity discarded");
  assert.strictEqual(ask(fd5b).known, true,
    "FD5: CHAR-GHOST cannot match CHAR-A under the shipped matcher, so absence IS provable here");
  /* ...and the mirror: a lossy token that COULD have named it. */
  const fd5c = collision((shot) => { shot.codes = ["CHAR-A-01"]; });
  assert.strictEqual(ask(fd5c).known, false,
    "FD5: a lossy token that the shipped matcher accepts for this entity makes the answer unknown");

  /* FD6 · a stale declaration is not demand, and does not make the answer unknown. */
  const fd6 = collision((shot) => { shot.continuityStateSelections = { "CHAR-A": "state-default" }; });
  assert.deepStrictEqual({ known: ask(fd6).known, demanded: ask(fd6).demanded }, { known: true, demanded: false },
    "FD6: a superseded declaration creates no demand and clouds nothing");

  /* FD7 · removing a clean dependency returns a known dormant answer. */
  const fd7a = collision((shot) => { shot.characters = ["CHAR-A"]; });
  const fd7b = collision((shot) => { shot.characters = []; });
  assert.strictEqual(ask(fd7a).demanded, true, "FD7: (precondition) attached");
  assert.deepStrictEqual({ known: ask(fd7b).known, demanded: ask(fd7b).demanded }, { known: true, demanded: false },
    "FD7: and detaching returns a confident dormant answer rather than an unknown");

  /* ESTABLISHED USE OUTRANKS UNCERTAINTY. Once one shot definitely uses the
     reference, an unreadable shot elsewhere cannot turn `demanded` into unknown. */
  const both = collision((shot, project) => {
    shot.characters = ["CHAR-A"];
    project.shots.push({ ...JSON.parse(JSON.stringify(shot)), id: "L1-02", characters: "broken" });
  });
  assert.deepStrictEqual({ known: ask(both).known, demanded: ask(both).demanded }, { known: true, demanded: true },
    "FD: uncertainty may only ever block the NEGATIVE answer — it can never unmake an established use");

  /* AND THE PROJECTION HONOURS IT. `known: false` keeps required work required. */
  assert.strictEqual(
    Coverage2.referenceDemandState(Coverage2.coverageDemand({ requirement: "required" }),
      { satisfied: false, production: ask(fd3) }).state,
    "required-now", "FD: an unknown production answer must leave required work required");

  note("12. FD1-FD7 · the dependency reading is three-valued. The reproduced CHAR/CHAR-A collision, eight "
    + "malformed collections, a non-array shot list, an unresolved token and a lossy token that could have named "
    + "the entity all answer `known: false`; an absent collection, a stale declaration and a lossy token that "
    + "demonstrably resolved elsewhere still answer confidently; established use outranks uncertainty everywhere; "
    + "and an unknown answer leaves required work required");
}

/* ============================================ 13 · VEH1-VEH7 · ONE VEHICLE,
   TWO DIALECTS, AND THE CONTROL MUST TELL THE TRUTH ABOUT BOTH.

   SEMANTIC DISPOSITION, stated because the brief asks for it before anything is
   changed: `creationBrief.propIds` and `creationBrief.vehicleIds` do NOT have
   different meanings. shotDependencyRecords() produces the identical
   `type: "vehicle"` row from either, both are members of
   SHOT_STATE_BEARING_RELATIONSHIP_SOURCES, and no reader in the repository
   treats them differently. `propIds` is the union namespace the picker writes;
   `vehicleIds` is a type-narrowed spelling no shipped control has ever written —
   only import, a structure-duplicate clear, and a relink rewrite touch it. One
   relation, two encodings, and this section holds that reading. */
async function vehicleDialectSection(options = {}) {
  const INPUTS = { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" };
  const fixture = (brief) => {
    const project = withCanon(buildFixture(), [
      { kind: "entity-state", list: "vehicles", entityId: "VEH-CENSUS", stateId: "state-default", value: "VEH-CENSUS.png" },
    ]);
    project.vehicles = [{
      id: "VEH-CENSUS", name: "Census tug", approvedFile: "VEH-CENSUS.png",
      continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "VEH-CENSUS.png" }],
      coverageSlots: slotSet(["front"]),
      made: [{ model: "fixture-model", files: "VEH-CENSUS.png", prompt: "p", date: "2026-08-01" }],
    }];
    project.shots[0].codes = [];
    project.shots[0].characters = [];
    project.shots[0].creationBrief = { locationId: "", propIds: [], vehicleIds: [], ...brief };
    return project;
  };
  const inspect = (context) => JSON.parse(vm.runInContext(`JSON.stringify({
    propIds: P.shots[0].creationBrief.propIds, vehicleIds: P.shots[0].creationBrief.vehicleIds,
    codes: P.shots[0].codes,
    demanded: entityReferenceDemand(P, "vehicle", "VEH-CENSUS").demanded,
    canon: !!currentHumanAuthority(P, { kind: "entity-state", list: "vehicles", entityId: "VEH-CENSUS", stateId: "state-default" }),
    receipts: ((P.productionAuthority || {}).receipts || []).length,
    approvedFile: P.vehicles[0].approvedFile, history: (P.vehicles[0].made || []).length,
    states: (P.vehicles[0].continuityStates || []).length,
  })`, context));
  const selected = (html) => {
    const m = /class="guided-asset-choice ([^"]*)"[^>]*onclick="toggleShotCreationProp\('L1-01','VEH-CENSUS'\)"/.exec(html);
    assert.ok(m, "the vehicle must render in the Props & Vehicles picker");
    return /\bon\b/.test(m[1]);
  };

  /* VEH1 · a vehicleIds-only relation renders attached. */
  const one = await render("#/shot/L1-01", fixture({ vehicleIds: ["VEH-CENSUS"] }), { ...options, storage: INPUTS });
  assert.ok(selected(one.html),
    "VEH1: a vehicle the document attaches through `vehicleIds` must render as selected");
  const beforeOne = inspect(one.context);
  assert.strictEqual(beforeOne.demanded, true, "VEH1: (precondition) and reference demand must already count it");

  /* VEH2 · one click through the shipped control clears the relationship. */
  vm.runInContext("toggleShotCreationProp('L1-01','VEH-CENSUS')", one.context);
  const afterOne = inspect(one.context);
  assert.deepStrictEqual(afterOne.vehicleIds, [], "VEH2: the vehicleIds relationship is gone");
  assert.deepStrictEqual(afterOne.propIds, [], "VEH2: and no second encoding was left behind");
  assert.strictEqual(afterOne.demanded, false, "VEH2: so the vehicle no longer demands its references");

  /* VEH5 · and nothing about the vehicle itself was touched. */
  for (const key of ["canon", "receipts", "approvedFile", "history", "states"]) {
    assert.deepStrictEqual(afterOne[key], beforeOne[key],
      `VEH5: clearing a relationship must not change the vehicle's ${key}`);
  }

  /* VEH7 · and normalization does not put it back. */
  vm.runInContext("normalizeShotV5(P.shots[0])", one.context);
  assert.strictEqual(inspect(one.context).demanded, false,
    "VEH7: normalization must not resurrect a cleared vehicle relationship");

  /* VEH6 · re-selecting works, through the dialect the UI owns. */
  vm.runInContext("toggleShotCreationProp('L1-01','VEH-CENSUS')", one.context);
  const again = inspect(one.context);
  assert.strictEqual(again.demanded, true, "VEH6: re-selecting restores the relationship");
  assert.deepStrictEqual(again.propIds, ["VEH-CENSUS"],
    "VEH6: written to the union namespace the picker has always owned");
  assert.deepStrictEqual(again.vehicleIds, [],
    "VEH6: and NOT to the legacy dialect — a third writer of a two-encoding relation would make this worse");

  /* VEH3 · the propIds path is unchanged. */
  const prop = await render("#/shot/L1-01", fixture({ propIds: ["VEH-CENSUS"] }), { ...options, storage: INPUTS });
  assert.ok(selected(prop.html), "VEH3: a propIds vehicle still renders attached");
  vm.runInContext("toggleShotCreationProp('L1-01','VEH-CENSUS')", prop.context);
  assert.strictEqual(inspect(prop.context).demanded, false, "VEH3: and still clears in one click");

  /* VEH4 · both dialects naming the same vehicle is ONE removal and no ghost. */
  const both = await render("#/shot/L1-01", fixture({ propIds: ["VEH-CENSUS"], vehicleIds: ["VEH-CENSUS"] }),
    { ...options, storage: INPUTS });
  assert.ok(selected(both.html), "VEH4: (precondition) it renders attached");
  vm.runInContext("toggleShotCreationProp('L1-01','VEH-CENSUS')", both.context);
  const cleared = inspect(both.context);
  assert.deepStrictEqual([cleared.propIds, cleared.vehicleIds], [[], []],
    "VEH4: one removal must clear both encodings — a surviving one is the ghost relation");
  assert.strictEqual(cleared.demanded, false, "VEH4: and nothing may still demand the vehicle");

  /* THE CENSUS CLAIM, MADE HONEST. The earlier pass said all seven authored
     relations were reversible while this one was not; it is now, and the source
     says which fields the picker reads so the claim can be checked. */
  const studio = codeOnly(read("public/creation-studio.js"));
  assert.ok(/function guidedAttachedBriefPropVehicleIds/.test(studio),
    "VEH: the picker must resolve its attached set through one named reader");
  const reader = studio.slice(studio.indexOf("function guidedAttachedBriefPropVehicleIds"));
  assert.ok(/brief\.propIds/.test(reader.slice(0, 600)) && /brief\.vehicleIds/.test(reader.slice(0, 600)),
    "VEH: and that reader must consult BOTH dialects");

  note("13. VEH1-VEH7 · `propIds` and `vehicleIds` are one relation with two encodings — same dependency row, "
    + "both state-bearing, no reader distinguishes them — so the picker reads both. A vehicleIds-only vehicle "
    + "renders attached, clears in one click, stops demanding its references, survives normalization cleared, and "
    + "re-attaches through the union namespace the UI owns; both dialects together take ONE removal and leave no "
    + "ghost; and the vehicle's canon, receipts, approved file, states and history are untouched throughout");
}

/* ================================================= 14 · AG1-AG10 · AGREEMENT
   NO SURFACE MAY CLAIM CURRENT REQUIRED REFERENCE WORK WHEN READINESS OWES NONE.

   The defect this holds: an active character whose primary reference was already
   Canon, with eight empty seeded coverage rows, read "8 required references still
   needed" on its reference surface while shot readiness was satisfied,
   projectSharedBlockers was empty and Production said MARK SHOT FINAL. The
   surface was counting the entity's COVERAGE PLAN and calling it the production's
   CURRENT REQUIREMENT.

   Every case below compares the reference surface against the shipped
   derivations, and the comparison is an equality against a recomputation rather
   than against a number chosen here. */
async function agreementMatrixSection(options = {}) {
  const canonFor = (project, rows) => withCanon(project, rows);
  const allCanon = (project) => canonFor(project, [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  const withoutKai = (project) => canonFor(project, [
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  const oneState = (project) => {
    project.characters[0].continuityStates = [
      { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    ];
    return project;
  };
  const twoStates = (project) => {
    project.characters[0].continuityStates = [
      { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
      { id: "state-soot", name: "Sooty", isDefault: false, parentStateId: "state-default" },
    ];
    project.shots[0].continuityStateSelections = { KAI: "state-soot" };
    return project;
  };

  /* The shipped derivations, asked inside the page and recomputed independently
     of anything this suite decides. */
  async function compare(label, project, { list = "characters", id = "KAI" } = {}) {
    const surface = await referenceSurface(project, { ...options, list, id });
    const counts = demandCounts(surface.html);
    const production = await render("#/production", project, options);
    const truth = JSON.parse(vm.runInContext(`JSON.stringify((() => {
      const feed = projectShotReadiness();
      const owed = (feed.shots || []).flatMap((shot) => outstandingReadinessRows(shot))
        .filter((row) => row.target && row.target.kind === "entity-state"
          && row.target.list === ${JSON.stringify(list)} && row.target.entityId === ${JSON.stringify(id)});
      return {
        entityOwed: [...new Set(owed.map((row) => row.targetKey))].length,
        blockers: projectSharedBlockers(feed).map((row) => row.key),
        next: (projectNextProductionAction() || {}).actionLabel || "",
        historic: ((feed.historic || {}).items || []).map((row) => row.key),
        shotStatus: (feed.shots[0] || {}).status || "",
      };
    })())`, production.context));
    assert.strictEqual(counts.obligations, "readiness",
      `${label}: the surface must derive current work from readiness, not from the template`);
    assert.strictEqual(counts.now, truth.entityOwed,
      `${label}: the reference surface claims ${counts.now} current required reference(s) `
      + `while readiness owes ${truth.entityOwed}`);
    return { counts, truth, html: surface.html };
  }

  /* AG1 · dormant entity. */
  const dormant = allCanon(oneState(buildFixture()));
  dormant.characters.push({ id: "AG-DORM", name: "Dormant", continuityStates: [], coverageSlots: slotSet(["front", "profile"]) });
  const ag1 = await compare("AG1", dormant, { id: "AG-DORM" });
  assert.strictEqual(ag1.counts.now, 0, "AG1: a dormant entity owes zero current reference work");
  assert.ok(ag1.counts.plan > 0, "AG1: and its coverage plan is still on the screen");

  /* AG2 · THE REPRODUCED CASE. Active, Canon satisfies readiness, seeded coverage empty. */
  const ag2 = await compare("AG2", allCanon(oneState(buildFixture())));
  assert.strictEqual(ag2.counts.now, 0,
    "AG2: an active entity whose Canon already satisfies readiness owes no current reference work");
  assert.ok(ag2.counts.missing >= 8,
    `AG2: (and the entity must really carry unmet template rows, got ${ag2.counts.missing})`);
  assert.strictEqual(ag2.counts.plan, ag2.counts.missing,
    "AG2: every one of them is coverage plan");
  assert.deepStrictEqual(ag2.truth.blockers, [], "AG2: while Production is blocked by nothing");
  assert.ok(!/required reference/.test(demandHeadline(ag2.html)),
    `AG2: and the headline must not count a backlog, got "${demandHeadline(ag2.html)}"`);

  /* AG3 · a genuinely unresolved readiness requirement. */
  const ag3 = await compare("AG3", allCanon(twoStates(buildFixture())));
  assert.strictEqual(ag3.counts.now, 1, "AG3: one unresolved requirement is one current obligation");
  assert.ok(ag3.truth.blockers.some((key) => key.includes("state-soot")),
    "AG3: and Production names the same target");

  /* AG4 · a historic reference awaiting confirmation. */
  const ag4 = await compare("AG4", withoutKai(oneState(buildFixture())));
  assert.strictEqual(ag4.counts.now, 1, "AG4: an unconfirmed primary is a current decision");
  assert.ok(ag4.truth.historic.some((key) => key.includes("characters:KAI")),
    "AG4: and the confirmation queue holds the same target — the two surfaces agree a decision is owed");
  assert.ok(/data-demand-family="primary"/.test(ag4.html),
    "AG4: the obligation on the primary must appear on the panel even though the primary has its own stage");
  assert.ok(/Chosen but never approved/.test(ag4.html),
    "AG4: in readiness's own words rather than a second vocabulary");

  /* AG5 · confirming it clears the obligation. */
  const ag5 = await compare("AG5", allCanon(oneState(buildFixture())));
  assert.strictEqual(ag5.counts.now, 0, "AG5: confirming the reference clears the current obligation");
  assert.deepStrictEqual(ag5.truth.historic, [], "AG5: and empties the confirmation queue");

  /* AG6 · removing structural demand clears it too. */
  const detached = withoutKai(oneState(buildFixture()));
  detached.shots[0].characters = [];
  const ag6 = await compare("AG6", detached);
  assert.strictEqual(ag6.counts.now, 0, "AG6: removing the structural use clears the obligation");
  assert.strictEqual(ag6.counts.production, "dormant", "AG6: and the surface says the reference is dormant");

  /* AG7 · the plan is still there, visible and counted, in every case above. */
  for (const [label, row] of [["AG1", ag1], ["AG2", ag2], ["AG5", ag5], ["AG6", ag6]]) {
    assert.ok(row.counts.plan > 0, `AG7: ${label} must keep its unfilled coverage on screen`);
    assert.ok(/data-demand-lead="available"/.test(row.html),
      `AG7: ${label} must lead with it rather than hide it`);
  }

  /* AG8 · the count is obligations, never the number of possible slots. */
  assert.ok(ag3.counts.now < ag3.counts.missing,
    `AG8: current work must be the production's obligations (${ag3.counts.now}), not the slot catalogue `
    + `(${ag3.counts.missing})`);

  /* AG9 · a satisfied shared reference across two shots is not duplicated. */
  const shared = allCanon(oneState(buildFixture()));
  shared.shots.push({ ...JSON.parse(JSON.stringify(shared.shots[0])), id: "L1-02" });
  const ag9 = await compare("AG9", shared);
  assert.strictEqual(ag9.counts.now, 0, "AG9: a satisfied shared reference owes nothing, once or twice");
  const sharedUnsatisfied = withoutKai(oneState(buildFixture()));
  sharedUnsatisfied.shots.push({ ...JSON.parse(JSON.stringify(sharedUnsatisfied.shots[0])), id: "L1-02" });
  const ag9b = await compare("AG9b", sharedUnsatisfied);
  assert.strictEqual(ag9b.counts.now, 1,
    "AG9: and an unsatisfied one shared by two shots is ONE decision, not two");

  /* AG10 · returned-result review is a different scope and stays one. */
  const entities = codeOnly(read("public/entities.js"));
  const region = entities.slice(entities.indexOf("function entityReadinessObligationsGuard") >= 0
    ? entities.indexOf("function entityReadinessObligationsGuard")
    : entities.indexOf("function entityCurrentObligations"), entities.indexOf("function entityDemandActionMarkup"));
  assert.ok(region.length > 400, "AG10: (the obligation region must actually have been located)");
  assert.ok(!/returnedResultsAwaitingReview|returnedReview|awaitingReview/.test(region),
    "AG10: returned-result review must never be counted as reference demand");

  note(`14. AG1-AG10 · the reference surface's current-work number equals an independent recomputation of the `
    + `SHIPPED readiness rows for the same entity, in every case: dormant 0, active-and-satisfied 0 with `
    + `${ag2.counts.plan} coverage-plan rows still on screen, one unresolved requirement 1 (and Production names `
    + `the same target), an unconfirmed primary 1 (and the confirmation queue holds it), confirming it 0, `
    + `detaching it 0, two shots sharing one unsatisfied reference 1. The plan is visible and counted in every `
    + `case, and returned-result review is not merged into it`);
}

/* ================================================ 15 · LOC1-LOC7 · AN EXPLICIT
   CLEAR MUST SURVIVE NORMALISATION.

   Clearing a primary Location on a shot that also had a SUPPORTING location left
   `locationId` empty with the support still in `codes[]`, and the very next
   normalisation promoted the support into primary. The filmmaker's clear
   survived one render.

   WHY A RECORDED DECISION RATHER THAN PRESENCE/ABSENCE, measured rather than
   assumed. Both existing shapes already mean "please infer": of 611 shots across
   77 project documents in this repository, 533 carry no `locationId` key and 23
   carry it PRESENT AND EMPTY — 16 of those being real sanitized Overfit shots
   whose `codes[]` name a location and which depend on the inference. Reading
   present-and-empty as "explicitly cleared" would silently take the primary plate
   away from those 16. LOC3b holds that. */
async function locationDurabilitySection(options = {}) {
  const INPUTS = { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" };
  const fixture = ({ codes, brief }) => {
    const project = withCanon(buildFixture(), [
      { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    ]);
    project.locations.push({
      id: "LOC-SUPPORT", name: "Support bay", status: "APPROVED", workflowStatus: "APPROVED",
      notes: "", approvedFile: "LOC-SUPPORT-PLATE.png", continuityStates: [],
    });
    project.shots[0].codes = codes;
    project.shots[0].creationBrief = { propIds: [], promptBuilds: [], mode: "auto", ...brief };
    return project;
  };
  const state = (context) => JSON.parse(vm.runInContext(`JSON.stringify({
    locationId: P.shots[0].creationBrief.locationId || "",
    codes: P.shots[0].codes,
    resolved: resolveShotEntities(P, P.shots[0]).locations.map((row) => row.id),
    receipts: ((P.productionAuthority || {}).receipts || []).length,
    plate: P.locations[0].approvedFile,
    winners: P.shots[0].keyframes.map((frame) => frame.winner),
    canon: !!currentHumanAuthority(P, { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default" }),
  })`, context));
  /* LOC7 · the round trip a real save/load performs: serialise the document the
     page holds and hand it back to a fresh page, which normalises it on the way
     in exactly as a load does. */
  const roundTrip = async (context) =>
    render("#/shot/L1-01", JSON.parse(vm.runInContext("JSON.stringify(P)", context)), { ...options, storage: INPUTS });

  /* LOC1 · primary only. */
  const one = await render("#/shot/L1-01", fixture({ codes: ["LOC-HULL", "PR-TOOL"], brief: { locationId: "LOC-HULL" } }),
    { ...options, storage: INPUTS });
  const beforeOne = state(one.context);
  assert.strictEqual(beforeOne.locationId, "LOC-HULL", "LOC1: (precondition) the shot has a primary");
  vm.runInContext("setShotCreationLocation('L1-01','')", one.context);
  vm.runInContext("normalizeShotV5(P.shots[0])", one.context);
  assert.strictEqual(state(one.context).locationId, "", "LOC1: the clear survives normalisation");
  assert.strictEqual(state(await roundTrip(one.context).then((page) => page.context)).locationId, "",
    "LOC1: and a save/load round trip");

  /* LOC2 · primary + support, clear primary. THE REPRODUCED CASE. */
  const two = await render("#/shot/L1-01",
    fixture({ codes: ["LOC-HULL", "LOC-SUPPORT", "PR-TOOL"], brief: { locationId: "LOC-HULL" } }),
    { ...options, storage: INPUTS });
  const beforeTwo = state(two.context);
  assert.deepStrictEqual(beforeTwo.resolved, ["LOC-HULL", "LOC-SUPPORT"],
    "LOC2: (precondition) the shot has a primary and a supporting location");
  vm.runInContext("setShotCreationLocation('L1-01','')", two.context);
  vm.runInContext("normalizeShotV5(P.shots[0])", two.context);
  const clearedTwo = state(two.context);
  assert.strictEqual(clearedTwo.locationId, "",
    "LOC2: the explicitly cleared primary must remain cleared through normalisation");
  assert.deepStrictEqual(clearedTwo.resolved, ["LOC-SUPPORT"],
    "LOC2: and the supporting location must remain, as support — it is not deleted to keep the primary empty");
  const reloaded = state(await roundTrip(two.context).then((page) => page.context));
  assert.strictEqual(reloaded.locationId, "", "LOC2: and the clear survives a save/load round trip");
  assert.deepStrictEqual(reloaded.resolved, ["LOC-SUPPORT"], "LOC2: with the support still attached after it");

  /* LOC3 · a legacy shot with no key at all still infers. */
  const legacy = await render("#/shot/L1-01", fixture({ codes: ["LOC-HULL", "PR-TOOL"], brief: {} }),
    { ...options, storage: INPUTS });
  assert.strictEqual(state(legacy.context).locationId, "LOC-HULL",
    "LOC3: an imported shot that never stored a primary must still have one inferred");

  /* LOC3b · and so must the 16 real Overfit shots that store it present-and-empty. */
  const legacyEmpty = await render("#/shot/L1-01", fixture({ codes: ["LOC-HULL", "PR-TOOL"], brief: { locationId: "" } }),
    { ...options, storage: INPUTS });
  assert.strictEqual(state(legacyEmpty.context).locationId, "LOC-HULL",
    "LOC3b: a legacy shot storing an empty primary must keep inferring — 16 real corpus shots depend on it");

  /* LOC4 · the support can be chosen as primary explicitly. */
  vm.runInContext("setShotCreationLocation('L1-01','LOC-SUPPORT')", two.context);
  vm.runInContext("normalizeShotV5(P.shots[0])", two.context);
  assert.strictEqual(state(two.context).locationId, "LOC-SUPPORT",
    "LOC4: choosing the support as primary works, and withdraws the cleared decision");

  /* LOC5 · and so can the former primary. */
  vm.runInContext("setShotCreationLocation('L1-01','LOC-HULL')", two.context);
  vm.runInContext("normalizeShotV5(P.shots[0])", two.context);
  assert.strictEqual(state(two.context).locationId, "LOC-HULL", "LOC5: re-selecting the former primary works");

  /* LOC6 · none of it touched authority, media or history. */
  const finalTwo = state(two.context);
  for (const key of ["receipts", "plate", "canon"]) {
    assert.deepStrictEqual(finalTwo[key], beforeTwo[key],
      `LOC6: the clear/reselect round trip must not change ${key}`);
  }
  assert.deepStrictEqual(finalTwo.winners, beforeTwo.winners, "LOC6: nor the shot's approved frames");

  /* AND THE DECISION IS RECORDED BY ONE WRITER AND READ BY ONE READER. */
  const app = codeOnly(read("public/app.js"));
  const studio = codeOnly(read("public/creation-studio.js"));
  assert.strictEqual((app.match(/SHOT_NO_PRIMARY_LOCATION_KEY\s*=\s*"/g) || []).length, 1,
    "LOC: the key must be declared exactly once");
  assert.strictEqual((studio.match(/\[SHOT_NO_PRIMARY_LOCATION_KEY\]\s*=/g) || []).length, 1,
    "LOC: written by exactly one control");
  assert.strictEqual((app.match(/creationBrief\[SHOT_NO_PRIMARY_LOCATION_KEY\]/g) || []).length, 1,
    "LOC: and read by exactly one reader — the inference guard");

  note("15. LOC1-LOC7 · an explicitly cleared primary Location stays cleared through normalizeShotV5 AND a "
    + "save/load round trip, with a supporting location left attached as support rather than promoted or deleted. "
    + "Legacy inference is untouched for BOTH legacy shapes — 533 corpus shots with no key and the 16 real Overfit "
    + "shots that store it present-and-empty, which is why the decision is recorded rather than inferred from "
    + "presence. Re-selecting either location works, and canon, receipts, plate and approved frames are unchanged");
}

async function main(options = {}) {
  projectionSection();
  ownerSection();
  await demandMatrixSection(options);
  await agreementSection(options);
  await locationSection(options);
  await stateDeclarationSection(options);
  await authoritySection(options);
  await routeSection(options);
  await copySection(options);
  await invariantSection(options);
  await reversibilitySurvey(options);
  failClosedSection();
  await vehicleDialectSection(options);
  await agreementMatrixSection(options);
  await locationDurabilitySection(options);
  console.log("Reference demand + reversible structure suite passed:");
  for (const line of notes) console.log(`  ${line}`);
}

module.exports = {
  main, projectionSection, ownerSection, demandMatrixSection, agreementSection,
  locationSection, stateDeclarationSection, authoritySection, routeSection, copySection,
  reversibilitySurvey, invariantSection,
  failClosedSection, vehicleDialectSection, agreementMatrixSection, locationDurabilitySection,
  demandFixture, referenceSurface, demandCounts, demandHeadline, coverageTaskButton, slotSet,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
