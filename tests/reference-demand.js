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
    now: Number(value("now")), dormant: Number(value("dormant")),
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
  assert.ok(castCounts.now > 0, "RD5: and its required references become current work");
  assert.strictEqual(castCounts.now, castCounts.missing,
    "RD5: every unmet required item is now outstanding, because the production is asking for all of them");
  assert.strictEqual(castCounts.dormant, 0, "RD5: and nothing is standing by");

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
  assert.strictEqual(satisfiedCounts.now, satisfiedCounts.missing,
    "RD8: current work is exactly the unmet required items, never the satisfied ones");
  assert.ok(satisfiedCounts.required > satisfiedCounts.missing,
    "RD8: (and the fixture must actually satisfy some, or the equality above proves nothing)");

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
  assert.ok(richCounts.recommended >= 1, "9: OPTIONAL / AVAILABLE is present");
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
  console.log("Reference demand + reversible structure suite passed:");
  for (const line of notes) console.log(`  ${line}`);
}

module.exports = {
  main, projectionSection, ownerSection, demandMatrixSection, agreementSection,
  locationSection, stateDeclarationSection, authoritySection, routeSection, copySection,
  reversibilitySurvey, invariantSection,
  demandFixture, referenceSurface, demandCounts, demandHeadline, coverageTaskButton, slotSet,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
