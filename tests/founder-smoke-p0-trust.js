/* FOUNDER SMOKE — BATCH 1 P0 TRUST REPAIRS.
 *
 * One focused regression per reproduced blocker in
 * CINEBRAID_FOUNDER_SMOKE_FREEZE_2026-08-17.md. Each section states the founder's
 * reproduction before it asserts anything, so a future reader can tell what the
 * assertion is FOR rather than only what it checks.
 *
 *   P0-1  a new project showed another project's activity as its own
 *   P0-2  Next Action / Continue Production contradicted canonical readiness
 *   P0-3  an imported derived state could not record what it derives from
 *   P0-4  a candidate with no resolvable media was still approvable
 *   P0-5  a correction worse than the approved original was the suggested fix
 *   P0-7  compiled prompts never went stale, and could emit one instruction twice
 *
 * P0-6 (overlay stacking) is tests/founder-smoke-overlay-real-browser.py — paint
 * order and keyboard precedence are only true in a real browser.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation; the
 * render harness answers every route from memory, and the two pure modules are
 * required directly.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture, withCanon } = require("./render-harness");
const Continuity = require("../public/shared-continuity.js");
const Lineage = require("../public/shared-state-lineage.js");
const PromptEngine = require("../prompt-engine.js");

const results = [];
const record = (id, detail) => results.push(`  ${id.padEnd(6)} ${detail}`);

/* ---------------------------------------------------------------------------
   P0-1 — CROSS-PROJECT ACTIVITY ISOLATION.

   Reproduction: a brand-new project displayed attention/activity work belonging
   to other projects, including vision reviews behind continuity approvals.

   V641_MANUAL_ACTIVITIES is a module-level Map that outlives load() and retains a
   finished row for ten minutes on purpose, so every review the previous project
   ran was still in the new project's drawer — under RECENT COMPLETED and under
   PREVIOUS FAILURES / NEEDS ATTENTION. */
async function testCrossProjectActivityIsolation() {
  const projects = { "project-a": buildFixture(), "project-b": buildFixture() };
  projects["project-a"].meta.title = "Project A";
  projects["project-b"].meta.title = "Project B";
  let active = "project-a";
  const runsByProject = { "project-a": [], "project-b": [] };
  const customFetch = async (url, options, response) => {
    if (url === "/api/project") return response(projects[active], 200, { "x-cinebraid-project-slug": active });
    if (url === "/api/projects/switch" && options.method === "POST") { active = JSON.parse(options.body).slug; return response({ ok: true }); }
    if (url === "/api/automation/runs") return response({ runs: runsByProject[active], projectSlug: active });
    if (url === "/api/generation/fal/jobs") return response({ jobs: [] });
    if (url === "/api/projects") return response({ active, projects: Object.keys(projects).map((slug) => ({ slug, title: projects[slug].meta.title })) });
    return null;
  };

  const app = await render("#/production", projects[active], { fetch: customFetch });
  assert.strictEqual(vm.runInContext("ACTIVE_PROJECT_SLUG", app.context), "project-a");

  /* Project A's work: a completed continuity review and a failed reference review. */
  vm.runInContext(`
    v641FinishManualActivity(
      v641StartManualActivity("VISION AI · SCENE CONTINUITY", "Review scene SC-01", "Comparing approved stills."),
      "completed", "Continuity approved.");
    v641FinishManualActivity(
      v641StartManualActivity("VISION AI · REFERENCE REVIEW", "Review ROOFTOP_STATE.png", "Comparing candidate."),
      "failed", "The review could not complete.");
  `, app.context);
  vm.runInContext("V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();", app.context);
  const drawerA = app.context.document.getElementById("automation-activity-drawer").innerHTML;
  assert(drawerA.includes("Review scene SC-01"), "the fixture must actually put project A's work in the drawer, or this test is vacuous");
  assert(drawerA.includes("Review ROOFTOP_STATE.png"), "the fixture must actually put project A's failed review in the drawer");

  await app.context.switchProject("project-b");
  assert.strictEqual(vm.runInContext("ACTIVE_PROJECT_SLUG", app.context), "project-b");

  vm.runInContext("V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();", app.context);
  const drawerB = app.context.document.getElementById("automation-activity-drawer").innerHTML;
  assert(!drawerB.includes("Review scene SC-01"), "project B's activity drawer still shows project A's continuity review");
  assert(!drawerB.includes("Review ROOFTOP_STATE.png"), "project B's PREVIOUS FAILURES section still shows project A's failed review");
  assert.strictEqual(vm.runInContext("V641_MANUAL_ACTIVITIES.size", app.context), 0, "the previous project's activity rows must be dropped, not merely hidden");

  /* The Activity button and the persistent rail read the same scoped answer. */
  const button = app.context.document.getElementById("automation-activity-toggle").innerHTML;
  assert(!/\d\s+need attention/.test(button), `the Activity button still counts another project's work: ${button}`);
  /* JSON, not deepStrictEqual: an array built inside the vm realm has a different
     Array.prototype than a host literal, so the two never compare equal however
     identical they print. */
  assert.strictEqual(vm.runInContext("JSON.stringify(v670ManualActivityRows().map((row) => row.title))", app.context), "[]",
    "the scoped reader must present no rows for a project that has run nothing");

  /* A row started under B belongs to B, and a row stamped for another project is
     never presented here even if the purge is bypassed. */
  vm.runInContext(`
    v641StartManualActivity("VISION AI · CANDIDATE REVIEW", "Review B candidate", "");
    V641_MANUAL_ACTIVITIES.set("smuggled", { id: "smuggled", system: "VISION AI · SCENE CONTINUITY",
      title: "Smuggled from project A", detail: "", projectSlug: "project-a", status: "completed",
      startedAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z" });
    v641RenderActivityDrawer();
  `, app.context);
  const drawerC = app.context.document.getElementById("automation-activity-drawer").innerHTML;
  assert(drawerC.includes("Review B candidate"), "project B's own activity must still appear");
  assert(!drawerC.includes("Smuggled from project A"), "a row stamped with another project must never render as current-project activity");

  /* The server states which project a run ledger belongs to, and a window that
     disagrees refuses the payload and says why rather than adopting it. */
  const runsSource = fs.readFileSync(path.join(ROOT, "automation-runs.js"), "utf8");
  assert(/runs: runs\.map\(publicRun\), projectSlug: runsOwnerSlug\(\)/.test(runsSource),
    "GET /api/automation/runs must state which project its runs belong to");
  const run = (id) => ({ id, type: "shot-chain", targetId: "L1-01", status: "failed", label: id, steps: {}, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" });
  runsByProject["project-b"] = [run("b-run")];
  runsByProject["project-a"] = [run("a-run")];
  await app.context.refreshGlobalAutomationActivity(true);
  assert.strictEqual(vm.runInContext("JSON.stringify(AUTOMATION_RUNS.map((row) => row.id))", app.context), '["b-run"]',
    "the window must adopt its own project's run ledger");
  active = "project-a"; /* another window switched the machine's active project */
  await app.context.refreshGlobalAutomationActivity(true);
  assert.strictEqual(vm.runInContext("JSON.stringify(AUTOMATION_RUNS.map((run) => run.id))", app.context), '["b-run"]',
    "a run ledger belonging to a different project must not be adopted as this window's");
  vm.runInContext("v641RenderActivityDrawer();", app.context);
  const drawerD = app.context.document.getElementById("automation-activity-drawer").innerHTML;
  assert(drawerD.includes("project-a"), "the drawer must name the project the server switched to instead of silently going stale");
  record("P0-1", "project A's continuity and reference reviews leave with project A; a foreign run ledger is refused and named");
}

/* ---------------------------------------------------------------------------
   P0-1 (correction) — THE GENERATION LEDGER PROVES ITS OWN OWNER TOO.

   The first repair tied both ledgers to the automation-run payload's ownership
   answer and adopted the FAL payload on the strength of it. Independent review
   reproduced the hole: a FAL response for project A, arriving beside a run
   response that agrees with project B, was adopted, drawn in the drawer and
   counted by the Activity button. Two routes, two ledgers, two owners. */
async function testFalLedgerOwnership() {
  const projects = { "project-a": buildFixture(), "project-b": buildFixture() };
  const active = "project-b";
  const foreignJob = { id: "a-job", status: "IN_QUEUE", purpose: "Project A reference render", outputCount: 0, model: "gpt-image-2", createdAt: "2026-08-17T09:00:00Z" };
  const ownJob = { id: "b-job", status: "IN_QUEUE", purpose: "Project B reference render", outputCount: 0, model: "gpt-image-2", createdAt: "2026-08-17T09:30:00Z" };
  let falOwner = active, falJobs = [ownJob], falStatesOwner = true;
  const app = await render("#/production", projects[active], {
    fetch: async (url, _options, response) => {
      if (url === "/api/project") return response(projects[active], 200, { "x-cinebraid-project-slug": active });
      /* The RUN ledger always agrees. Only the FAL ledger moves — which is exactly
         the case a single shared ownership answer cannot see. */
      if (url === "/api/automation/runs") return response({ runs: [], projectSlug: active });
      if (url === "/api/generation/fal/jobs") return response(falStatesOwner ? { jobs: falJobs, projectSlug: falOwner } : { jobs: falJobs });
      return null;
    },
  });

  /* Same-project polling must keep working — the guard must not be a blanket refusal. */
  await app.context.refreshGlobalAutomationActivity(true);
  assert.strictEqual(vm.runInContext("JSON.stringify(FAL_GENERATION_JOBS.map((job) => job.id))", app.context), '["b-job"]',
    "this project's own generation ledger must still be adopted on every poll");
  vm.runInContext("V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();", app.context);
  assert(app.context.document.getElementById("automation-activity-drawer").innerHTML.includes("Project B reference render"),
    "this project's own live render must appear, or the refusal below proves nothing");

  /* Now the machine's active project moves under this window. */
  falOwner = "project-a"; falJobs = [foreignJob];
  await app.context.refreshGlobalAutomationActivity(true);
  assert.strictEqual(vm.runInContext("JSON.stringify(FAL_GENERATION_JOBS.map((job) => job.id))", app.context), '["b-job"]',
    "a generation ledger belonging to another project must not be adopted");
  vm.runInContext("v641RenderActivityDrawer();", app.context);
  const drawer = app.context.document.getElementById("automation-activity-drawer").innerHTML;
  assert(!drawer.includes("Project A reference render"), "another project's render must not appear in this project's drawer");
  assert(drawer.includes("project-a"), "the drawer must name the project the server switched to");
  const button = app.context.document.getElementById("automation-activity-toggle").innerHTML;
  assert(!/Project A/.test(button), "another project's render must not reach the Activity button");
  /* The rail and the Terminal read the same ledger, so they cannot disagree. */
  assert.strictEqual(vm.runInContext("JSON.stringify(FAL_GENERATION_JOBS.map((job) => job.purpose))", app.context), '["Project B reference render"]',
    "every surface reads one ledger, and it is this project's");

  /* A payload that states NO owner: rows are refused, an empty list is harmless. */
  falStatesOwner = false; falJobs = [foreignJob];
  await app.context.refreshGlobalAutomationActivity(true);
  assert.strictEqual(vm.runInContext("JSON.stringify(FAL_GENERATION_JOBS.map((job) => job.id))", app.context), '["b-job"]',
    "rows that cannot prove where they came from must not be presented as this project's");
  falJobs = [];
  await app.context.refreshGlobalAutomationActivity(true);
  assert.strictEqual(vm.runInContext("JSON.stringify(FAL_GENERATION_JOBS)", app.context), "[]",
    "an empty payload has nothing to attribute and must still be admitted");

  /* And the route states it, so the browser has something to check. */
  const falSource = fs.readFileSync(path.join(ROOT, "fal-generation.js"), "utf8");
  assert(/jobs: jobs\.map\(publicJob\), projectSlug: owner\.slug/.test(falSource),
    "GET /api/generation/fal/jobs must state which project its ledger belongs to");
  /* The first read of the ledger is admitted the same way; it had no check at all. */
  const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert(/v670AdmitActivityRows\(data, "jobs"\)/.test(appSource),
    "load()'s first ledger read must be admitted on the payload's own owner too");
  record("P0-1b", "the generation ledger proves its own owner; same-project polling is unaffected; unprovable rows are refused");
}

/* ---------------------------------------------------------------------------
   P0-2 — NEXT ACTION AGREES WITH CANONICAL READINESS.

   Reproduction: PRODUCTION READINESS said "0 shots have work that can start now"
   while NEXT ACTION said "L1-01 · Animate — Still approved" and CONTINUE
   PRODUCTION routed into that blocked shot. The two answers came from two
   derivations: the former shotProductionNextAction() read media presence and could not
   see whether a shot's canonical inputs existed. */
async function testNextActionAgreesWithReadiness() {
  const fixture = buildFixture();
  const app = await render("#/production", fixture);
  const feed = vm.runInContext("projectShotReadiness()", app.context);
  assert.strictEqual(feed.counts.ready, 0, "the fixture must have no READY shot, or this test proves nothing");
  assert.strictEqual(feed.shots[0].status, "NEEDS_DECISION");

  /* Project and shot-level projections now read the same canonical feed. The project
     projection keeps its stronger cross-shot prioritisation. */
  assert.strictEqual(vm.runInContext("typeof nextProductionShot", app.context), "undefined",
    "the deleted media-presence project answer must not return");
  const local = vm.runInContext(`shotProductionNextAction(shotById("L1-01"), projectShotReadiness().shots[0])`, app.context);
  assert.strictEqual(local.key, feed.shots[0].nextAction.code, "the shot-local action must project canonical readiness");
  assert.strictEqual(local.detail, feed.shots[0].nextAction.message, "the shot-local explanation must be canonical");
  assert.strictEqual(local.status, feed.shots[0].status, "the shot-local status must be canonical");
  assert.strictEqual(vm.runInContext(`shotBoardActionCategory(shotById("L1-01"), projectShotReadiness().shots[0])`, app.context), "review",
    "the board category must not classify a canonical decision blocker as ready");

  assert.strictEqual((fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8").match(/function nextProductionShot\(/g) || []).length, 0,
    "nextProductionShot must be gone from the source, not merely unexported");

  const next = vm.runInContext("projectNextProductionAction()", app.context);
  assert.strictEqual(next.kind, "blocker", `Next Action must name the blocker, not the blocked shot (got ${next.kind})`);
  assert(!/^#\/shot\//.test(next.href), `Next Action must not route into a shot with no startable work (got ${next.href})`);
  assert.strictEqual(next.href, "#/character/KAI", "Next Action must route to the input that is actually blocking");
  assert.strictEqual(next.message, feed.shots[0].nextAction.message, "the words must be readiness's own, not a second opinion");

  const html = app.context.document.getElementById("main").innerHTML;
  assert(/0 shots have work that can start now/.test(html), "the readiness headline must be unchanged");
  assert(!/NEXT ACTION<\/span><h2>L1-01/.test(html), "NEXT ACTION must not headline a blocked shot");
  assert(/data-next-action-kind="blocker"/.test(html), "the rendered NEXT ACTION must declare what kind of action it is");

  vm.runInContext("continueProduction()", app.context);
  assert.strictEqual(app.context.location.hash, "#/character/KAI", "CONTINUE PRODUCTION must route to the actual next useful action");

  /* Leverage: one input required by several shots outranks one required by one. */
  const shared = buildFixture();
  shared.shots = [shared.shots[0], { ...JSON.parse(JSON.stringify(shared.shots[0])), id: "L1-02", title: "Second" }];
  const many = await render("#/production", shared);
  const sharedFeed = vm.runInContext("projectShotReadiness()", many.context);
  const blockers = vm.runInContext("projectSharedBlockers(projectShotReadiness())", many.context);
  assert(blockers.length, "the fixture must produce blocking requirements");
  assert.strictEqual(blockers[0].shotIds.length, sharedFeed.shots.length,
    "the top blocker must be the one the most shots depend on");
  const sharedNext = vm.runInContext("projectNextProductionAction()", many.context);
  assert.strictEqual(sharedNext.unblocks, 2, "the action must say how many shots resolving it unblocks");
  assert(/UNBLOCK 2 SHOTS/.test(sharedNext.actionLabel), `the label must state the leverage (got ${sharedNext.actionLabel})`);

  /* And a READY shot is still preferred over any blocker. */
  const ready = withCanon(buildFixture(), []);
  const readyApp = await render("#/production", ready);
  vm.runInContext(`
    const feed = projectShotReadiness();
    __forced = { ...feed, shots: [{ ...feed.shots[0], status: "READY", nextAction: { code: "produce-frame", message: "Produce Frame A using i2v.", count: 1 } }], counts: { ...feed.counts, ready: 1 } };
    projectShotReadiness = () => __forced;
  `, readyApp.context);
  const readyNext = vm.runInContext("projectNextProductionAction()", readyApp.context);
  assert.strictEqual(readyNext.kind, "shot", "a READY shot must be preferred over a blocker");
  assert.strictEqual(readyNext.href, "#/shot/L1-01");
  record("P0-2", "blocked project routes to its highest-leverage unblocker; a READY shot still wins; the words come from readiness");
}

/* ---------------------------------------------------------------------------
   P0-2 (correction) — THE VISIBLE RECOMMENDATION IS THE SAME ANSWER.

   Independent review found that fixing Continue Production was not enough: the
   RECOMMENDED card on #/create still rendered `nextProductionShot()`, so the
   screen showed "Animate · L1-01 · Hull check" with a button beside it that routed
   to the Kai reference actually blocking every shot. Two answers on one card. */
/* Batch 2 Slice 2 moved this card without changing what it says. #/create now opens
   on the three-intent chooser, and the RECOMMENDED card belongs to the project
   workspace — which is what the scratch intent renders. The stored preference puts
   this test back in front of the card it has always been about. The post-import
   landing renders the same card, from the same function, and is covered in
   tests/project-entry.js. */
const CREATE_WORKSPACE = { storage: { "cinebraid-creation-start-path": "scratch" } };
async function testCreateViewRecommendationAgrees() {
  const app = await render("#/create", buildFixture(), CREATE_WORKSPACE);
  const feed = vm.runInContext("projectShotReadiness()", app.context);
  assert.strictEqual(feed.counts.ready, 0, "the fixture must have no startable shot, or this test is vacuous");
  const canonical = vm.runInContext("projectNextProductionAction()", app.context);

  const html = app.context.document.getElementById("main").innerHTML;
  const card = (html.match(/<article data-recommended-kind[\s\S]*?<\/article>/) || [""])[0];
  assert(card, "the create view must render a recommendation card");
  const headline = (card.match(/<b>([\s\S]*?)<\/b>/) || ["", ""])[1];
  const detail = (card.match(/<small>([\s\S]*?)<\/small>/) || ["", ""])[1];

  /* THE THREE THINGS THAT MUST AGREE: the words, the destination, and the button. */
  assert.strictEqual(headline, canonical.title, `the recommendation headline must be the canonical answer, got "${headline}"`);
  assert.strictEqual(detail, canonical.message, "the recommendation detail must be readiness's own message");
  assert(!/Animate/.test(card), `the recommendation must not restate the media-presence answer: ${card}`);
  assert.strictEqual((card.match(/data-recommended-kind="blocker"/g) || []).length, 1,
    "the card must declare which kind of action it is showing");
  vm.runInContext("continueProduction()", app.context);
  assert.strictEqual(app.context.location.hash, canonical.href,
    "the button beside the recommendation must route where the recommendation points");
  assert.strictEqual(app.context.location.hash, "#/character/KAI");

  /* A READY shot still produces a shot recommendation on this screen. */
  const readyApp = await render("#/create", buildFixture(), CREATE_WORKSPACE);
  vm.runInContext(`
    const feed = projectShotReadiness();
    __forced = { ...feed, shots: [{ ...feed.shots[0], status: "READY", nextAction: { code: "produce-frame", message: "Produce Frame A using i2v.", count: 1 } }], counts: { ...feed.counts, ready: 1 } };
    projectShotReadiness = () => __forced;
  `, readyApp.context);
  await readyApp.context.route();
  const readyCard = (readyApp.context.document.getElementById("main").innerHTML.match(/<article data-recommended-kind[\s\S]*?<\/article>/) || [""])[0];
  assert(/data-recommended-kind="shot"/.test(readyCard), "a READY shot must still be recommended as a shot");
  assert(/Produce Frame A using i2v\./.test(readyCard), "and must carry readiness's own words");
  record("P0-2b", "the visible #/create recommendation, its detail and its button are one readiness-derived answer");
}

/* ---------------------------------------------------------------------------
   P0-3 — CONTINUITY-STATE LINEAGE.

   Reproduction: the approved "Rooftop working state" existed, "Heavy soot" was a
   required derived state, and automating it failed with "Heavy soot has no valid
   parent state". Every ancestry write was create-or-delete, so there was no way
   to record what it derives from — and reparenting is refused by design. */
function testLineagePureRules() {
  const states = [
    { id: "state-default", name: "Rooftop working state", isDefault: true },
    { id: "state-soot", name: "Heavy soot" },
    { id: "state-child", name: "Soot and rain", parentStateId: "state-soot" },
    { id: "state-recorded", name: "Wet", parentStateId: "state-default" },
  ];
  assert.deepStrictEqual(Lineage.validateStateCollection(states).legacy.map((row) => row.id), ["state-soot"],
    "a state that records no source must be reported as unrecorded derivation");

  assert.deepStrictEqual(Lineage.eligibleDerivationSourceIds(states, "state-soot"), ["state-default", "state-recorded"],
    "self and descendants must be excluded from the offered sources");
  assert.deepStrictEqual(Lineage.eligibleDerivationSourceIds(states, "state-recorded"), [],
    "a state that already records a source is offered nothing — that would be a reparent");

  assert.strictEqual(Lineage.planDerivationRecord(states, "state-soot", "state-child").reason, "source-is-descendant",
    "choosing a descendant would close a cycle and must be refused");
  assert.strictEqual(Lineage.planDerivationRecord(states, "state-soot", "state-soot").reason, "parent-is-self");
  assert.strictEqual(Lineage.planDerivationRecord(states, "state-soot", "ghost").reason, "parent-missing");
  assert.strictEqual(Lineage.planDerivationRecord(states, "state-soot", "").reason, "source-required",
    "an ambiguous request must refuse rather than guess");
  assert.strictEqual(Lineage.planDerivationRecord(states, "state-recorded", "state-soot").reason, "reparenting-unsupported",
    "changing an existing source is still a reparent and still refused");
  assert.strictEqual(Lineage.planDerivationRecord(states, "state-default", "state-soot").reason, "default-state-is-the-root");

  const before = JSON.stringify(states);
  assert.strictEqual(Lineage.applyDerivationRecord(states, "state-recorded", "state-soot").applied, false);
  assert.strictEqual(JSON.stringify(states), before, "a refused write must leave the collection byte-identical");

  const applied = Lineage.applyDerivationRecord(states, "state-soot", "state-default");
  assert.strictEqual(applied.applied, true);
  assert.strictEqual(states[1].parentStateId, "state-default");
  assert.strictEqual(Lineage.validateStateCollection(states).ok, true, "the resulting collection must still be intact");
  assert.deepStrictEqual(Lineage.validateStateCollection(states).legacy, [], "the gap must be closed once the source is recorded");
}

async function testLineageRuntimeSurfaces() {
  const project = buildFixture();
  project.locations = [{
    id: "LOC-ROOF", name: "Rooftop", status: "APPROVED", approvedFile: "LOC-ROOF-WORKING.png",
    continuityStates: [
      { id: "state-default", name: "Rooftop working state", isDefault: true, approvedFile: "LOC-ROOF-WORKING.png", notes: "Primary." },
      /* Imported exactly as the founder's was: a delta, a derivation intent, no source. */
      { id: "state-soot", name: "Heavy soot", isDefault: false, approvedFile: "", notes: "Heavy soot over every surface.", generationMode: "derive", referenceRequirement: "required" },
    ],
  }];
  withCanon(project, { kind: "entity-state", list: "locations", entityId: "LOC-ROOF", stateId: "state-default", value: "LOC-ROOF-WORKING.png" });
  const app = await render("#/location/LOC-ROOF", project);

  /* The blocked automation path is where the founder was standing. */
  const preflight = vm.runInContext(`v627EntityPreflight("locations", P.locations[0], ["state-soot"])`, app.context);
  assert(preflight.errors.some((row) => /does not record what it derives from/.test(row)),
    `the preflight must name the missing lineage as a decision: ${JSON.stringify(preflight.errors)}`);
  assert.strictEqual(JSON.stringify(preflight.lineageGaps), '["state-soot"]');
  vm.runInContext(`openEntityStateAutomationModal("locations","LOC-ROOF","state-soot")`, app.context);
  const modal = app.context.document.getElementById("modal").innerHTML;
  assert(modal.includes("SOURCE STATE NOT RECORDED"), "the blocked automation path must offer the source-state decision inline");
  assert(/Rooftop working state — approved/.test(modal), "the chooser must say which offered sources are approved");
  assert(!/selected/.test(modal.split("SOURCE STATE NOT RECORDED")[1].split("</select>")[0] || ""),
    "no source may be preselected — CineBraid must not choose on the filmmaker's behalf");

  /* And so is the state card, reached through the coverage workspace.
   *
   * AMENDED BY BATCH 2 SLICE 3, and deliberately STRENGTHENED rather than relaxed.
   * That workspace is `What this production needs` now: it leads with a demand list
   * and keeps the angle / expression / continuity boards behind a toggle, so the
   * full chooser is one click away instead of being the first thing rendered.
   *
   * The P0-3 guarantee is that a missing lineage is SURFACED as a human decision
   * rather than guessed, so both halves are asserted: the demand list must name the
   * decision by itself — a filmmaker must not have to go looking for it — and
   * opening the board must still produce the chooser this test has always required.
   * A reframe that hid the decision behind a toggle and said nothing about it would
   * fail the first assertion. */
  vm.runInContext(`selectBoundedTask('entity-task','locations:LOC-ROOF','coverage')`, app.context);
  await app.context.route();
  const demandHtml = app.context.document.getElementById("main").innerHTML;
  assert(/Record what this state derives from/.test(demandHtml),
    "the demand surface must name the missing-lineage decision without the filmmaker going looking for it");
  assert(/Source not recorded/.test(demandHtml),
    "and must say why that state is blocked");
  assert(!/SOURCE STATE NOT RECORDED[\s\S]*Rooftop working state/.test(demandHtml.split("entity-coverage-detail")[0] || demandHtml),
    "while the full chooser stays behind the coverage detail rather than leading the surface");

  vm.runInContext(`selectBoundedItem('entity-coverage-view','locations:LOC-ROOF','states')`, app.context);
  await app.context.route();
  assert(app.context.document.getElementById("main").innerHTML.includes("SOURCE STATE NOT RECORDED"),
    "the continuity state card must offer the same decision");

  const receiptsBefore = JSON.stringify(vm.runInContext("P.productionAuthority.receipts", app.context));
  let toasted = "";
  app.context.toast = (message) => { toasted = message; };
  vm.runInContext(`recordContinuityStateDerivation("locations","LOC-ROOF","state-soot","state-default")`, app.context);
  assert.strictEqual(vm.runInContext("P.locations[0].continuityStates[1].parentStateId", app.context), "state-default");
  assert(/Nothing was approved/.test(toasted), `recording a source must state that it approves nothing: ${toasted}`);
  assert.strictEqual(JSON.stringify(vm.runInContext("P.productionAuthority.receipts", app.context)), receiptsBefore,
    "recording lineage must not mint Canon for the derived variant");
  const after = vm.runInContext(`v627EntityPreflight("locations", P.locations[0], ["state-soot"])`, app.context);
  assert(!after.errors.some((row) => /derives from|parent state/.test(row)), `lineage must no longer block: ${JSON.stringify(after.errors)}`);

  vm.runInContext(`recordContinuityStateDerivation("locations","LOC-ROOF","state-soot","state-default")`, app.context);
  assert(/does not change/.test(toasted), `a second attempt is a reparent and must be refused: ${toasted}`);

  /* Import: explicit lineage is preserved, unresolvable lineage is dropped and
     named, and a missing one is reported at import rather than at run time. */
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const context = { module: { exports: {} }, console };
  context.globalThis = context;
  vm.createContext(context);
  const helpers = serverSource.slice(serverSource.indexOf("function normalizeBuilderContinuityStates"));
  const body = helpers.slice(0, helpers.indexOf("\nfunction builderCoverageAlias"));
  vm.runInContext(`function builderArray(v){return Array.isArray(v)?v:[];}function builderObject(v){return v&&typeof v==="object"?v:{};}function addBuilderMarker(t,m,x){return String(t||"");}\n${body}\nthis.normalizeBuilderContinuityStates = normalizeBuilderContinuityStates;`, context);
  const normalize = context.normalizeBuilderContinuityStates;

  const warnings = [];
  const imported = normalize({ id: "LOC-ROOF", continuityStates: [
    { id: "state-default", name: "Rooftop working state", isDefault: true },
    { id: "state-soot", name: "Heavy soot", derivesFrom: "state-default" },
    { id: "state-rain", name: "Rain", parentState: "Rooftop working state" },
    { id: "state-lost", name: "Lost", derivesFrom: "state-that-never-existed" },
    { id: "state-blank", name: "Blank" },
  ] }, "location", warnings);
  assert.strictEqual(imported[1].parentStateId, "state-default", "OFP's derivesFrom must be preserved");
  assert.strictEqual(imported[2].parentStateId, "state-default", "an unambiguous state name must resolve");
  assert.strictEqual(imported[3].parentStateId, "", "an unresolvable source must be dropped, never written as a dangling parent");
  assert.strictEqual(imported[4].parentStateId, "");
  assert.strictEqual(imported[0].parentStateId, "", "the default state is the root and never carries a source");
  assert(warnings.some((row) => /is not a state on this reference/.test(row)), "an unresolvable source must be named at import");
  assert(warnings.some((row) => /do not record what they derive from \(Lost, Blank\)/.test(row)),
    `missing lineage must be reported at import: ${JSON.stringify(warnings)}`);
  assert(warnings.some((row) => /will not choose one for you/.test(row)), "the import warning must say CineBraid does not guess");
  assert.strictEqual(Lineage.validateStateCollection(imported).ok, true, "the imported collection must be intact");

  /* AMBIGUOUS IS NOT RESOLVED. A source given as a name that two states share
     could mean either, so it means neither — the same rule as an unresolvable id,
     and the case that would tempt a "closest match". */
  const ambiguousWarnings = [];
  const ambiguous = normalize({ id: "LOC-ROOF", continuityStates: [
    { id: "state-default", name: "Working", isDefault: true },
    { id: "state-b", name: "Working", parentStateId: "state-default" },
    { id: "state-soot", name: "Heavy soot", derivesFrom: "Working" },
  ] }, "location", ambiguousWarnings);
  assert.strictEqual(ambiguous[2].parentStateId, "",
    `a source named by a name two states share must not resolve, got ${JSON.stringify(ambiguous[2].parentStateId)}`);
  assert(ambiguousWarnings.some((row) => /says it derives from "Working"/.test(row)),
    `the ambiguity must be named: ${JSON.stringify(ambiguousWarnings)}`);
  assert(ambiguousWarnings.some((row) => /do not record what they derive from \(Heavy soot\)/.test(row)),
    "and the state must be listed as still needing a decision");
  assert.strictEqual(Lineage.validateStateCollection(ambiguous).ok, true,
    "refusing an ambiguous source must leave the collection intact");
  record("P0-3", "an unrecorded source can be recorded once, never changed, never guessed; import preserves, drops and reports");
}

/* ---------------------------------------------------------------------------
   P0-4 — MEDIA THAT CANNOT BE SEEN CANNOT BE APPROVED.

   Reproduction: a candidate read 90/100 · APPROVE SUGGESTED while its thumbnail
   was blank. The markup rendered a placeholder reading "IMAGE" when the url did
   not resolve, and rendered the approve button regardless. */
async function testUnrenderableMediaCannotBeApproved() {
  const app = await render("#/shot/L1-01", buildFixture());
  vm.runInContext(`
    AUTOMATION_RUNS=[{id:'run-blank',revision:1,type:'entity-chain',targetId:'characters:KAI',entityList:'characters',entityId:'KAI',
      config:{list:'characters',entityId:'KAI',maxImages:9},label:'Kai default',status:'awaiting-review',stage:'Candidate approval required',
      createdAt:'2026-08-17T10:00:00Z',updatedAt:'2026-08-17T10:01:00Z',current:{stepKey:'entity:state-default:review'},usage:{imagesGenerated:3},
      steps:{'entity:state-default:review':{key:'entity:state-default:review',kind:'entity-review',status:'needs-review',label:'Approve a candidate',
        stateId:'state-default',winner:'KAI-GONE.png',score:90,attempt:1,maxAttempts:3,
        review:{candidates:[{file:'KAI-GONE.png',review:{score:90,pass:true,summary:'Identity preserved; lighting matches canon.'}}]}}},logs:[]}];
  `, app.context);
  const html = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);

  assert(!/APPROVE SUGGESTED/.test(html), "a candidate whose media cannot be resolved must not be offered for approval");
  assert(!/APPROVE THIS/.test(html), "no approval control may be offered for media that cannot be inspected");
  assert(/Image unavailable/.test(html), "the surface must say the image cannot be shown");
  assert(/SYNC LOCAL FOLDERS/.test(html), "a truthful recovery action must be offered");
  assert(/KAI-GONE\.png/.test(html), "the candidate must not be silently discarded");
  assert(/90\/100/.test(html), "a successful AI review must be preserved");
  assert(/Identity preserved/.test(html), "the review's note must be preserved");
  assert(/data-candidate-unresolved="KAI-GONE\.png"/.test(html), "the unresolved candidate must be identifiable in the DOM");

  /* THE NEGATIVE CONTROL PROPER: the command refuses even when called directly,
     so a regressed surface cannot mint the approval this rule exists to prevent. */
  let toasted = "";
  app.context.toast = (message) => { toasted = message; };
  const receiptsBefore = JSON.stringify(vm.runInContext("(P.productionAuthority && P.productionAuthority.receipts) || []", app.context));
  await vm.runInContext(`approveAutomationCandidate('run-blank','entity:state-default:review','KAI-GONE.png')`, app.context);
  assert(/cannot be displayed for inspection/.test(toasted), `the approval command must refuse: ${toasted}`);
  assert.strictEqual(JSON.stringify(vm.runInContext("(P.productionAuthority && P.productionAuthority.receipts) || []", app.context)), receiptsBefore,
    "no authority receipt may be written for media nobody could see");

  /* And a candidate whose media DOES resolve is still approvable — the guard must
     not have made the gate unusable. */
  const owned = vm.runInContext(`entityMedia("characters", P.characters[0])[0].name`, app.context);
  assert(owned, "the fixture must own at least one resolvable media file for the control case");
  vm.runInContext(`
    const step = v626Runs()[0].steps['entity:state-default:review'];
    step.winner = ${JSON.stringify(owned)};
    step.review.candidates = [{ file: ${JSON.stringify(owned)}, review: { score: 91, pass: true, summary: 'Good.' } }];
  `, app.context);
  const usable = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
  assert(/APPROVE SUGGESTED/.test(usable), "a candidate whose media resolves must still be approvable");
  assert(!/Image unavailable/.test(usable), "a resolvable candidate must not be marked unavailable");
  record("P0-4", "unresolvable media loses the approve control and the command refuses it; the review result survives; resolvable media is unaffected");
}

/* ---------------------------------------------------------------------------
   P0-5 — A CORRECTION IS JUDGED AGAINST WHAT IT WAS MEANT TO IMPROVE.

   Reproduction: Fix Continuity produced a Frame B visibly worse than the already
   approved one, which still failed continuity, and it was presented as APPROVE
   SUGGESTED — because `winner` means "best of this pass" and nothing compared it
   with the approved original. */
function testCorrectionClassification() {
  const cases = [
    [{ available: true, score: 72 }, { score: 41, pass: true }, "regression"],
    [{ available: true, score: 72 }, { score: 41, pass: false }, "regression"],
    [{ available: true, score: 72 }, { score: 73, pass: true }, "no-improvement"],
    [{ available: true, score: 72 }, { score: 75, pass: true }, "no-improvement"],
    [{ available: true, score: 72 }, { score: 88, pass: true }, "improvement"],
    [{ available: true, score: 40 }, { score: 60, pass: false }, "no-improvement"],
    [{ available: false }, { score: 99, pass: true }, "unknown"],
    [null, { score: 99, pass: true }, "unknown"],
  ];
  for (const [baseline, candidate, expected] of cases) {
    const verdict = Continuity.classifyCorrectionOutcome(baseline, candidate);
    assert.strictEqual(verdict.outcome, expected,
      `baseline ${JSON.stringify(baseline)} vs ${JSON.stringify(candidate)} should be ${expected}, got ${verdict.outcome}`);
    assert.strictEqual(Continuity.recommendableCorrection(verdict), expected === "improvement",
      `only a demonstrated improvement may be recommendable (${expected})`);
    assert(Continuity.describeCorrectionOutcome(verdict).length > 20, "every outcome must have a sentence a person can read");
  }
  assert.strictEqual(Continuity.CORRECTION_SCORE_MARGIN, 3, "the equality band must be explicit and stable");

  /* P0-5 (correction) — AN UNSCORABLE COMPARISON FAILS CLOSED.
   *
   * `Number(row.score)` behind a `Number.isFinite` check reads as strict and is
   * not: null, "", "  " and [] are all 0, and 0 is finite. Independent review
   * reproduced the consequence — a baseline recorded as { available: true,
   * score: null } became ZERO, and an 80-point challenger against it was called a
   * demonstrated improvement and offered as the fix. */
  const unscorable = [null, undefined, "", "   ", [], {}, true, false, NaN, "80", { valueOf: () => 80 }];
  for (const score of unscorable) {
    const asBaseline = Continuity.classifyCorrectionOutcome({ available: true, score }, { score: 80, pass: true });
    assert.strictEqual(asBaseline.outcome, "unknown",
      `an unscorable baseline (${JSON.stringify(score) ?? String(score)}) produced "${asBaseline.outcome}"`);
    assert.strictEqual(asBaseline.baselineScore, null, "an unscorable value must never surface as a number");
    assert.strictEqual(Continuity.recommendableCorrection(asBaseline), false, "and must never be recommendable");
    const asCandidate = Continuity.classifyCorrectionOutcome({ available: true, score: 72 }, { score, pass: true });
    assert.strictEqual(asCandidate.outcome, "unknown",
      `an unscorable challenger (${JSON.stringify(score) ?? String(score)}) produced "${asCandidate.outcome}"`);
  }
  /* server.js clamps an unstated score to 0 and flags it. That zero is not a score. */
  const unscored = Continuity.classifyCorrectionOutcome({ available: true, score: 0, explicitScore: false }, { score: 80, pass: true });
  assert.strictEqual(unscored.outcome, "unknown", "a review that stated no score must not be read as a real zero");
  assert.strictEqual(Continuity.correctionScore({ score: 0, explicitScore: true }), 0,
    "a genuine zero the reviewer actually stated is still a score");
  assert.strictEqual(Continuity.correctionScore({ score: 41 }), 41, "an ordinary score is unaffected");

  /* The already-working outcomes must be untouched by the strictness. */
  assert.strictEqual(Continuity.classifyCorrectionOutcome({ available: true, score: 72 }, { score: 88, pass: true }).outcome, "improvement");
  assert.strictEqual(Continuity.classifyCorrectionOutcome({ available: true, score: 72 }, { score: 41, pass: true }).outcome, "regression");
  assert.strictEqual(Continuity.classifyCorrectionOutcome({ available: true, score: 72 }, { score: 73, pass: true }).outcome, "no-improvement");
}

async function testCorrectionGateNeverRecommendsARegression() {
  const app = await render("#/shot/L1-01", buildFixture());
  const step = (outcome, score, pass, recommend) => `
    SCAN.shots['L1-01'] = { ...(SCAN.shots['L1-01']||{}), takes: [ ...((SCAN.shots['L1-01']||{}).takes||[]), { name: 'L1-01_correction.png', url: '/x/L1-01_correction.png' } ] };
    AUTOMATION_RUNS=[{id:'run-corr',revision:1,type:'scene-chain',targetId:'SC-01',label:'Scene correction',status:'awaiting-review',
      stage:'Approve correction',createdAt:'2026-08-17T10:00:00Z',updatedAt:'2026-08-17T10:05:00Z',
      current:{stepKey:'scene-correction:pkg-1:round-1:review'},config:{maxImages:9},usage:{imagesGenerated:3},
      steps:{'scene-correction:pkg-1:round-1:review':{key:'scene-correction:pkg-1:round-1:review',kind:'scene-correction-review',status:'needs-review',
        label:'Approve L1-01 scene correction',shotId:'L1-01',frameId:'frame-a',winner:'L1-01_correction.png',score:${score},attempt:3,maxAttempts:3,
        files:['L1-01_correction.png'],review:{reviews:[{n:1,score:${score},pass:${pass},notes:'Reviewed.'}]},
        result:{targetShotId:'L1-01',recommend:${recommend},baseline:{available:true,file:'L1-01_APPROVED.png',score:72,pass:false},
          correctionVerdicts:{'L1-01_correction.png':{outcome:'${outcome}',delta:${score - 72},baselineScore:72,candidateScore:${score}}},winnerOutcome:'${outcome}'}}},logs:[]}];`;

  vm.runInContext(step("regression", 41, false, false), app.context);
  const worse = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
  assert(!/APPROVE SUGGESTED/.test(worse), "a regression must never be the suggested fix");
  assert(/REGRESSION/.test(worse), "the gate must classify the result truthfully");
  assert(/NO CANDIDATE IMPROVED ON THE APPROVED FRAME/.test(worse), "the header must not claim a suggestion it does not have");
  assert(/L1-01_APPROVED\.png/.test(worse) && /72\/100/.test(worse), "the approved original must be named with its score");
  assert(/APPROVE ANYWAY/.test(worse), "human approval stays possible and explicit, and says what it is");
  assert(/data-correction-outcome="regression"/.test(worse), "the verdict must be identifiable in the DOM");

  vm.runInContext(step("improvement", 91, true, true), app.context);
  const better = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
  assert(/APPROVE SUGGESTED/.test(better), "a demonstrated improvement may be suggested");
  assert(/IMPROVEMENT/.test(better), "an improvement must be classified as one");
  assert(!/NO CANDIDATE IMPROVED/.test(better));

  vm.runInContext(step("unknown", 99, true, true), app.context);
  const unknown = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
  assert(!/APPROVE SUGGESTED/.test(unknown), "an uncomparable correction must not be recommended");
  assert(/NOT COMPARABLE/.test(unknown), "an uncomparable correction must say so");
}

async function testCorrectionInputPackageIsTheSmallestTruthfulOne() {
  /* The empirical half: a shot whose character carries a coverage view builds a
     package that sends the identity reference and NOT the coverage view, and
     records why the view was left out. */
  const project = buildFixture();
  project.characters[0].coverageSlots = [{ id: "profile", label: "Profile", selectedFile: "KAI-PROFILE.png", required: true }];
  const app = await render("#/shot/L1-01", project, {
    scan: {
      anchors: [{ name: "KAI-ANCHOR.png", url: "/a/KAI-ANCHOR.png" }, { name: "KAI-PROFILE.png", url: "/a/KAI-PROFILE.png" }],
      plates: [], props: [], vehicles: [], audio: [], media: [],
      shots: { "L1-01": { takes: [{ name: "L1-01_APPROVED.png", url: "/t/L1-01_APPROVED.png" }], locked: [] } },
    },
  });
  const built = JSON.parse(vm.runInContext(`
    (() => {
      const s = shotById("L1-01");
      const available = shotCreationReferences(s).filter((ref) => ref.url);
      const pkg = { id: "pkg", targetShotId: "L1-01", previousShotId: "", nextShotId: "" };
      const sent = v640SceneCorrectionReferences(pkg);
      return JSON.stringify({
        availableKeys: available.map((ref) => ref.key),
        sentKeys: sent.map((ref) => ref.key),
        omitted: pkg.omittedReferences,
        manifest: (pkg.referenceManifest || []).length,
      });
    })()
  `, app.context));
  assert(built.availableKeys.includes("coverage:characters:KAI:profile"),
    "the fixture must offer a supplemental coverage view, or this check is vacuous");
  assert(built.sentKeys.includes("characters:KAI:state-default"),
    "the required identity reference must still be sent to a targeted repair");
  assert(!built.sentKeys.includes("coverage:characters:KAI:profile"),
    `a supplemental coverage view must not be sent to a targeted repair: ${JSON.stringify(built.sentKeys)}`);
  assert(built.sentKeys.length < built.availableKeys.length,
    "the correction package must be smaller than the full creation reference set");
  assert.strictEqual(built.omitted.length, 1, "every dropped reference must be recorded, not silently discarded");
  assert.strictEqual(built.omitted[0].reason, "supplemental-view-not-needed-to-edit-an-approved-still");
  assert.strictEqual(built.manifest, built.sentKeys.length, "the manifest must record exactly what was sent");

  const source = fs.readFileSync(path.join(ROOT, "public", "scene-automation.js"), "utf8");
  assert(/CORRECTION_PRIMARY_ROLES = \["base", "location", "identity", "prop", "continuity-state"\]/.test(source),
    "the correction package must carry only the editable target, the structural anchors and required identity/location references");
  assert(/ref\.supplemental === true \|\| ref\.blocking === true/.test(source),
    "supplemental coverage views and blocking guides must be excluded from a targeted repair");
  assert(/pkg\.omittedReferences = omittedReferences/.test(source),
    "every dropped reference must be recorded with its reason rather than silently disappearing");
  assert(/pkg\.referenceManifest = finalRefs/.test(source),
    "the manifest must remain the exact record of what was sent");
  /* The baseline exists, is one local review, and cannot start a generation. */
  assert(/async function v670EstablishCorrectionBaseline/.test(source));
  assert(!/v626WaitFalJob[\s\S]{0,400}baseline/.test(source), "scoring the approved original must not dispatch a generation");
  assert(/recommendableCorrection\(pickedVerdict\)/.test(source),
    "the run's recommendation must require a demonstrated improvement");
}

/* ---------------------------------------------------------------------------
   P0-7 — COMPILER TRUTH AND FRESHNESS.

   Reproduction: a compiled H3 First/Last Frame package kept stating its original
   duration after the shot's duration changed, and motion/transition text could be
   emitted twice.

   TARGET FORMATTING IS HELD. compileMinimaxH3() is the encoded H3 format and its
   FLF branch already produces a target-specific prompt; the founder's "reads like
   an execution-contract dump" is a judgement about a defined format, and changing
   it is not a correctness repair. Recorded for a later batch. */
function testCompiledPromptEmitsOneInstructionOnce() {
  const profile = PromptEngine.getProfile("minimax-h3/flf");
  const line = "Kai walks from the stairwell door to the ledge and stops.";
  const spec = {
    schemaVersion: 1, purpose: "motion", mode: "flf", shotId: "L1-01", durationSeconds: 8,
    narrativePurpose: line,
    initialState: { subject: "", staging: "", camera: "", environment: "" },
    finalState: { subject: "", staging: "", camera: "", environment: "" },
    actions: [{ start: 0, end: 8, action: line }],
    camera: { framing: "", movement: "", stability: "", lensIntent: "" },
    performance: { emotion: "", movementIntensity: "", gaze: "" },
    /* The same sentence arriving from a second field — the shape the shot's motion
       direction and the H3 sequence/transition note actually produce. */
    environmentMotion: [line],
    stagingLines: [], mustInclude: [], mustPreserve: [], mustAvoid: [], identityCanon: [],
    driftRestatements: [], visualGrounding: [], promptEntities: [], productionRisks: [],
    promptWarnings: [], audio: { mode: "none", dialogue: "" }, visualStyle: [],
  };
  const refs = [
    { key: "first", label: "First", role: "first-frame", mediaType: "image", url: "/a.png", instruction: "" },
    { key: "last", label: "Last", role: "last-frame", mediaType: "image", url: "/b.png", instruction: "" },
  ];
  const compiled = PromptEngine.compile(profile, spec, refs).prompt;
  assert.strictEqual(compiled.split(line).length - 1, 1,
    `the H3 compiler emitted the same instruction more than once:\n${compiled}`);
  assert(/MINIMAX H3 FIRST \/ LAST FRAME — 8 SECONDS/.test(compiled), "the selected H3 target must compile through the H3 compiler");
  assert(/ENDPOINT CONTRACT/.test(compiled), "the FLF branch must state the endpoint contract");
  assert(/TRANSITION\n/.test(compiled), "the transition must still be stated once");

  /* The client must not create the duplicate in the first place. */
  const studio = fs.readFileSync(path.join(ROOT, "public", "creation-studio.js"), "utf8");
  assert(/const directiveParts = \(useLLM \?/.test(studio) && /directiveSeen\.has\(key\)/.test(studio),
    "the motion directive parts must be de-duplicated before compilation");
}

async function testCompiledPackageGoesStale() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.clips = [{ id: "unit-a", suffix: "A", label: "A", dur: 8, motionPrompt: "Kai crosses to the ledge.", generationPackages: [] }];
  shot.creationBrief = { ...(shot.creationBrief || {}), motionDuration: 8, motionProfileId: "minimax-h3/flf", motionDirection: "Kai crosses to the ledge." };
  const app = await render("#/shot/L1-01", project);

  const built = vm.runInContext(`
    (() => {
      const s = shotById("L1-01");
      const unit = s.clips[0];
      const build = { id: "pkg-1", packageId: "L1-01-MOTION-R01", date: "2026-08-17T10:00:00Z",
        profileId: "minimax-h3/flf", profileName: "MiniMax H3 — First / Last Frame", mode: "flf",
        segmentId: unitKey(unit), durationSeconds: 8, kind: "guided-motion", revision: 1,
        prompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS", references: [], warnings: [], confirmations: [] };
      build.dependencySnapshot = packageInputSnapshot(s, build, build.references, currentDirectionForPackage(s, build));
      const id = registerPromptBuild(P, build);
      unit.generationPackages = [promptBuildRef(id, { kind: "guided-motion", scope: "segment:" + unitKey(unit) })];
      return resolvePromptBuild(P, id);
    })()
  `, app.context);
  assert(built.dependencySnapshot, "a compiled package must record what it was compiled from");
  assert.strictEqual(built.dependencySnapshot.durationSeconds, 8, "the snapshot must record the compiled duration");
  assert.strictEqual(built.dependencySnapshot.mode, "flf", "the snapshot must record the execution method");
  assert.strictEqual(vm.runInContext(`JSON.stringify(packageStaleReasons(shotById("L1-01"), resolvePromptBuildList(P, shotById("L1-01").clips[0].generationPackages)[0]))`, app.context), "[]",
    "a freshly compiled package must read current");

  vm.runInContext(`shotById("L1-01").creationBrief.motionDuration = 6;`, app.context);
  const staleReasons = vm.runInContext(`packageStaleReasons(shotById("L1-01"), resolvePromptBuildList(P, shotById("L1-01").clips[0].generationPackages)[0])`, app.context);
  assert(staleReasons.some((row) => /duration changed to 6s/.test(row)),
    `a user-facing duration change must invalidate the compiled package: ${JSON.stringify(staleReasons)}`);
  assert(staleReasons.some((row) => /still states 8s/.test(row)), "the reason must name the stale value the prompt still states");

  const markup = vm.runInContext(`guidedMotionPromptResult(shotById("L1-01"), resolvePromptBuildList(P, shotById("L1-01").clips[0].generationPackages)[0])`, app.context);
  assert(/data-package-freshness="stale"/.test(markup), "the compiled prompt surface must mark itself out of date");
  assert(/OUT OF DATE — REBUILD BEFORE GENERATING/.test(markup), "a stale compiled prompt must not read as current");
  assert(/REBUILD MOTION PROMPT/.test(markup), "the stale marker must offer the action that fixes it");

  vm.runInContext(`shotById("L1-01").creationBrief.motionDuration = 8; shotById("L1-01").creationBrief.motionProfileId = "minimax-h3/i2v";`, app.context);
  const methodReasons = vm.runInContext(`packageStaleReasons(shotById("L1-01"), resolvePromptBuildList(P, shotById("L1-01").clips[0].generationPackages)[0])`, app.context);
  assert(methodReasons.some((row) => /execution method changed to I2V/.test(row)),
    `changing the execution method must invalidate the compiled package: ${JSON.stringify(methodReasons)}`);
  assert(methodReasons.some((row) => /target model changed/.test(row)), "changing the target model must invalidate it too");

  /* A package that never recorded its dependencies says so rather than passing. */
  const unchecked = vm.runInContext(`
    (() => {
      const pack = resolvePromptBuildList(P, shotById("L1-01").clips[0].generationPackages)[0];
      const legacy = { ...pack };
      delete legacy.dependencySnapshot;
      return guidedMotionPromptResult(shotById("L1-01"), legacy);
    })()
  `, app.context);
  assert(/data-package-freshness="unknown"/.test(unchecked), "an uncheckable package must not be presented as current");
  assert(/NOT CHECKED/.test(unchecked));

  /* Both live builders record the snapshot, which is what makes any of this fire. */
  const studio = fs.readFileSync(path.join(ROOT, "public", "creation-studio.js"), "utf8");
  assert.strictEqual((studio.match(/build\.dependencySnapshot = typeof packageInputSnapshot === "function"/g) || []).length, 2,
    "both the motion and frame package builders must record a dependency snapshot");
  record("P0-7", "duration, method and target changes invalidate a compiled package and say so on it; one instruction is emitted once");
}

/* ---------------------------------------------------------------------------
   P0-7 (correction) — AN INPUT THE PRODUCTION CAN NO LONGER SUPPLY IS DRIFT.

   Freshness compares what a package was compiled from against what the production
   would supply now. The comparison built the "now" side by mapping each SAVED
   reference onto its current option and KEEPING THE SAVED ONE when there was no
   current option — so the two sides were identical by construction and a removed
   input produced nothing to report. Independent review reproduced it: a package
   that consumed `character:KAI` stayed CURRENT after Kai was removed. */
async function testRemovedConsumedReferenceStalesThePackage() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.clips = [{ id: "unit-a", suffix: "A", label: "A", dur: 8, motionPrompt: "Kai crosses.", generationPackages: [] }];
  shot.creationBrief = { ...(shot.creationBrief || {}), motionDuration: 8, motionProfileId: "minimax-h3/flf", motionDirection: "Kai crosses." };
  const app = await render("#/shot/L1-01", project);

  const built = JSON.parse(vm.runInContext(`
    (() => {
      const s = shotById("L1-01"), unit = s.clips[0];
      const build = { id: "pkg-1", packageId: "L1-01-MOTION-R01", date: "2026-08-17T10:00:00Z",
        profileId: "minimax-h3/flf", profileName: "H3 FLF", mode: "flf", segmentId: unitKey(unit),
        durationSeconds: 8, kind: "guided-motion", revision: 1, prompt: "x",
        references: promptReferenceOptions(s).filter((r) => r.url), warnings: [], confirmations: [] };
      build.dependencySnapshot = packageInputSnapshot(s, build, build.references, currentDirectionForPackage(s, build));
      const id = registerPromptBuild(P, build);
      unit.generationPackages = [promptBuildRef(id, { kind: "guided-motion", scope: "segment:" + unitKey(unit) })];
      return JSON.stringify({ consumed: build.references.map((r) => r.key), fresh: packageStaleReasons(s, resolvePromptBuildList(P, unit.generationPackages)[0]) });
    })()
  `, app.context));
  assert(built.consumed.includes("character:KAI"), "the package must actually consume the reference this test removes");
  assert.strictEqual(built.fresh.length, 0, "a freshly compiled package must read current");

  /* Remove the character the compiled package consumed. */
  const after = JSON.parse(vm.runInContext(`
    (() => {
      const s = shotById("L1-01");
      s.characters = []; P.characters = [];
      return JSON.stringify({
        now: promptReferenceOptions(s).map((r) => r.key),
        reasons: packageStaleReasons(s, resolvePromptBuildList(P, s.clips[0].generationPackages)[0]),
      });
    })()
  `, app.context));
  assert(!after.now.includes("character:KAI"), "the production must genuinely no longer offer it");
  assert(after.reasons.length > 0, "removing a consumed reference must stale the package");
  assert(after.reasons.some((row) => /can no longer be supplied by this shot/.test(row)),
    `the reason must name the disappearance rather than a generic change: ${JSON.stringify(after.reasons)}`);
  assert(after.reasons.some((row) => /Kai/.test(row)), "and must name which input");

  /* The surface says so, and so does the paid dialog's source of truth. */
  const markup = vm.runInContext(`guidedMotionPromptResult(shotById("L1-01"), resolvePromptBuildList(P, shotById("L1-01").clips[0].generationPackages)[0])`, app.context);
  assert(/data-package-freshness="stale"/.test(markup), "the compiled prompt surface must mark itself out of date");
  assert(/can no longer be supplied/.test(markup), "and must state which input went away");

  /* A reference whose FILE changed while the option still exists is still the
     ordinary "changed" reason — the disappearance case must not swallow it. */
  const changed = JSON.parse(vm.runInContext(`
    (() => {
      const s = shotById("L1-01");
      const pack = resolvePromptBuildList(P, s.clips[0].generationPackages)[0];
      /* Restore the consumed entity, then move the take the package pointed at. */
      P.characters = ${JSON.stringify(project.characters)};
      s.characters = P.characters.map((c) => c.id);
      const missing = packageStaleReasons(s, pack);
      SCAN.shots["L1-01"].takes = (SCAN.shots["L1-01"].takes || []).map((t) => t.name === "FRAME_A.png" ? { ...t, url: "/moved/FRAME_A.png" } : t);
      return JSON.stringify({ restored: missing, changed: packageStaleReasons(s, pack) });
    })()
  `, app.context));
  assert.strictEqual(changed.restored.length, 0, "restoring the consumed reference must clear the disappearance reason");
  assert(changed.changed.some((row) => /approved reference file changed/.test(row)),
    `an input that changed rather than vanished must still report as changed: ${JSON.stringify(changed.changed)}`);
  record("P0-7c", "an input the shot can no longer supply stales the package and is named; a changed one still reports as changed");
}

/* The paid submission is the last screen before money is spent, so a stale package
   must not reach it silently either. It is not refused — sending an older package is
   a legitimate choice — but it is named, beside the duration banner that exists for
   the same reason. */
async function testStalePackageIsNamedBeforeAPaidSubmission() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.clips = [{ id: "unit-a", suffix: "A", label: "A", dur: 8, motionPrompt: "Kai crosses to the ledge.", generationPackages: [] }];
  shot.creationBrief = { ...(shot.creationBrief || {}), motionDuration: 8, motionProfileId: "minimax-h3/flf", motionDirection: "Kai crosses to the ledge." };
  const plan = {
    compiledPrompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS\n\nTRANSITION\nKai crosses to the ledge.",
    profile: { id: "minimax-h3/flf", name: "MiniMax H3 — First / Last Frame" }, mode: "flf",
    references: [], durationSeconds: 8, durationRequested: 8, durationRange: [5, 15],
    resolutions: ["2K", "768P"], resolution: "2K", carriesAspectRatio: false,
    maxPromptCharacters: 2000, modelMaxPromptCharacters: 2000, modelDurationRange: [5, 15],
    dispatch: { model: "minimax/h3" }, compiler: { packId: "minimax-h3", packVersion: "1" },
  };
  const app = await render("#/shot/L1-01", project, {
    fetch: async (url, options, response) => {
      if (url === "/api/config") return response({ generation: { fal: { enabled: true, apiKey: "test-key", keySource: "config" } } });
      if (url === "/api/generation/fal/h3/plan") return response(plan);
      if (String(url).startsWith("/api/generation/options")) return response({ options: [] });
      return null;
    },
  });
  vm.runInContext(`
    const s = shotById("L1-01"), c = ensureShotCreation(s), unit = s.clips[0];
    const build = { id: "pkg-1", packageId: "L1-01-MOTION-R01", date: "2026-08-17T10:00:00Z",
      profileId: "minimax-h3/flf", profileName: "MiniMax H3 — First / Last Frame", mode: "flf",
      segmentId: unitKey(unit), durationSeconds: 8, kind: "guided-motion", revision: 1,
      prompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS", references: [], warnings: [], confirmations: [] };
    build.dependencySnapshot = packageInputSnapshot(s, build, build.references, currentDirectionForPackage(s, build));
    const id = registerPromptBuild(P, build);
    c.motionPromptBuilds = [promptBuildRef(id, { kind: "guided-motion" })];
    unit.generationPackages = [promptBuildRef(id, { kind: "guided-motion", scope: "segment:" + unitKey(unit) })];
  `, app.context);

  await app.context.openFalH3MotionModal("L1-01", "pkg-1");
  const fresh = app.context.document.getElementById("modal").innerHTML;
  assert(/MINIMAX H3 · PAID GENERATION/.test(fresh), "the paid dialog must open, or this check is vacuous");
  assert(!/This compiled package is out of date/.test(fresh), "a current package must not be marked stale before submission");

  vm.runInContext(`shotById("L1-01").creationBrief.motionDuration = 6;`, app.context);
  await app.context.openFalH3MotionModal("L1-01", "pkg-1");
  const stale = app.context.document.getElementById("modal").innerHTML;
  assert(/This compiled package is out of date/.test(stale), "a stale package must be named before a paid submission");
  assert(/duration changed to 6s/.test(stale), "the paid dialog must say exactly what changed");
  assert(/id="fal-h3-submit"/.test(stale) && !/id="fal-h3-submit"[^>]*disabled/.test(stale),
    "a stale package is named, not refused — sending it stays the filmmaker's choice");
  record("P0-7b", "the paid H3 dialog names a stale compiled package before submission and still lets the filmmaker send it");
}

async function main() {
  await testCrossProjectActivityIsolation();
  await testFalLedgerOwnership();
  await testNextActionAgreesWithReadiness();
  await testCreateViewRecommendationAgrees();
  testLineagePureRules();
  await testLineageRuntimeSurfaces();
  await testUnrenderableMediaCannotBeApproved();
  testCorrectionClassification();
  await testCorrectionGateNeverRecommendsARegression();
  await testCorrectionInputPackageIsTheSmallestTruthfulOne();
  record("P0-5", "improvement/no-improvement/regression is classified against the approved original; a regression is never suggested; the repair package is the smallest truthful one");
  testCompiledPromptEmitsOneInstructionOnce();
  await testCompiledPackageGoesStale();
  await testRemovedConsumedReferenceStalesThePackage();
  await testStalePackageIsNamedBeforeAPaidSubmission();

  for (const line of results) console.log(line);
  console.log("\nFounder smoke P0 trust suite passed. P0-6 is tests/founder-smoke-overlay-real-browser.py. "
    + "HELD: the H3 target's prompt FORMATTING is unchanged — compileMinimaxH3() is where that format is defined, its FLF branch "
    + "already emits a target-specific prompt, and rewriting a defined format is not a correctness repair. Provider calls made: 0.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
