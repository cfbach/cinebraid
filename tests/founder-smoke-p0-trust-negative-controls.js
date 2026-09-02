/* NEGATIVE CONTROLS FOR THE FOUNDER-SMOKE P0 TRUST REPAIRS.
 *
 * A green suite proves nothing unless the defect it describes would turn it red.
 * Each control below REINTRODUCES one specific defect, runs the guarantee that is
 * supposed to catch it, and requires that guarantee to fail FOR ITS OWN REASON.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAS THREE PHASES, AND WHAT IT USED TO GET WRONG.
 *
 * The first version of this harness ran the mutation INSIDE the same try/catch
 * that watched for the detection, and counted any AssertionError as a catch.
 * Independent review found what that hides: after `projectNextProductionAction()`
 * gained a parameter, N3's source needle stopped matching, `mutate()` threw its
 * own "did not match the shipped source" AssertionError before any production code
 * was touched, and the recorder scored that setup failure as a caught regression.
 * The control had mutated NOTHING and reported success. N8 was a softer version of
 * the same fault — it failed through the authority kernel's refusal rather than
 * through the media guard it claims to test, so it would have stayed green with
 * its own property deleted.
 *
 * So a control now passes through three separate, separately-reported phases:
 *
 *   1. ARM      the exact intended mutation is applied to the real production
 *               source and PROVED to have changed it. A needle that no longer
 *               matches, a mutation that changes nothing, or a page mutation that
 *               never reaches the page is BROKEN / NOT ARMED — never caught.
 *   2. EXECUTE  the guard runs against the mutated build.
 *   3. DETECT   the failure is counted only if it is an AssertionError AND its
 *               message matches the reason this control exists to produce.
 *               Anything else is BROKEN, with the actual failure printed.
 *
 * Every guard is additionally required to PASS against the SHIPPED source first,
 * so a control can never "detect" a property that was already broken.
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Page-script defects
 * go through render()'s `mutateSource` hook, which rewrites the shipped text on its
 * way into the vm; module defects are compiled from a mutated string into an
 * in-memory Module; the server defect is lifted by exact source into a vm context.
 * Every file touched is re-read at the end and required to be byte-identical.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { terminalHtml } = require("./terminal-view");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");

const PUBLIC = path.join(ROOT, "public");
const MODULE_TARGETS = {
  continuity: path.join(PUBLIC, "shared-continuity.js"),
  lineage: path.join(PUBLIC, "shared-state-lineage.js"),
  engine: path.join(ROOT, "prompt-engine.js"),
};
const SERVER = path.join(ROOT, "server.js");

/* Every file this suite mutates, read once so byte-identity can be proved at the
   end against exactly what was there at the start. */
const TOUCHED = [
  ...Object.values(MODULE_TARGETS), SERVER,
  ...["live-activity.js", "app.js", "automation.js", "creation-studio.js",
    "review-provenance.js", "scene-automation.js", "fal-generation.js"].map((name) => path.join(PUBLIC, name)),
];
const ORIGINAL = new Map(TOUCHED.map((file) => [file, fs.readFileSync(file, "utf8")]));

/* Line endings normalised before matching. This repository is checked out with
   core.autocrlf=true so every source file on disk is CRLF, while the multi-line
   needles below are written with LF. Nothing is written back, so this cannot
   change a byte on disk. */
function applyMutation(source, control) {
  /* A control may need more than one edit to reproduce its defect — restoring a
     substitution AND removing the reason that replaced it, for instance. Each edit
     is proved to match and to change something, so a needle that has drifted can
     never be mistaken for a defect that was reintroduced. */
  const edits = control.mutations || [{ from: control.from, to: control.to }];
  let text = String(source).replace(/\r\n/g, "\n");
  for (let index = 0; index < edits.length; index++) {
    const needle = String(edits[index].from).replace(/\r\n/g, "\n");
    if (!text.includes(needle)) {
      const error = new Error(`edit ${index + 1} of ${edits.length}: the source needle does not match the shipped source`);
      error.notArmed = true;
      throw error;
    }
    const next = text.replace(needle, edits[index].to);
    if (next === text) {
      const error = new Error(`edit ${index + 1} of ${edits.length}: the mutation produced no change`);
      error.notArmed = true;
      throw error;
    }
    text = next;
  }
  return text;
}

function compileModule(source, filename) {
  const compiled = new Module(filename, null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

/* ==========================================================================
   THE CONTROLS.

   `target`  which production source this mutates: {file} for a page script that
             render() loads, {module} for a required module, {server} for server.js.
   `from`/`to`  the exact mutation.
   `expect`  the message the intended regression must produce. A failure that does
             not match it is BROKEN, however plausible it looks — that is the whole
             lesson of the N8 finding.
   `guard`   receives `run`, a function that builds the subject: for a file control
             `run(options)` renders with the mutation installed; for a module
             control `run()` returns the compiled module. */

const BLANK_MEDIA_RUN = `
  AUTOMATION_RUNS=[{id:'run-blank',revision:1,type:'entity-chain',targetId:'characters:KAI',entityList:'characters',entityId:'KAI',
    config:{list:'characters',entityId:'KAI',maxImages:9},label:'Kai default',status:'awaiting-review',stage:'Candidate approval required',
    createdAt:'2026-08-17T10:00:00Z',updatedAt:'2026-08-17T10:01:00Z',current:{stepKey:'entity:state-default:review'},usage:{imagesGenerated:3},
    steps:{'entity:state-default:review':{key:'entity:state-default:review',kind:'entity-review',status:'needs-review',label:'Approve a candidate',
      stateId:'state-default',winner:'KAI-GONE.png',score:90,attempt:1,maxAttempts:3,
      review:{candidates:[{file:'KAI-GONE.png',review:{score:90,pass:true,summary:'Identity preserved.'}}]}}},logs:[]}];`;

const REGRESSION_RUN = `
  SCAN.shots['L1-01'] = { ...(SCAN.shots['L1-01']||{}), takes: [ ...((SCAN.shots['L1-01']||{}).takes||[]), { name: 'L1-01_correction.png', url: '/x/L1-01_correction.png' } ] };
  AUTOMATION_RUNS=[{id:'run-corr',revision:1,type:'scene-chain',targetId:'SC-01',label:'Scene correction',status:'awaiting-review',
    stage:'Approve correction',createdAt:'2026-08-17T10:00:00Z',updatedAt:'2026-08-17T10:05:00Z',
    current:{stepKey:'scene-correction:pkg-1:round-1:review'},config:{maxImages:9},usage:{imagesGenerated:3},
    steps:{'scene-correction:pkg-1:round-1:review':{key:'scene-correction:pkg-1:round-1:review',kind:'scene-correction-review',status:'needs-review',
      label:'Approve L1-01 scene correction',shotId:'L1-01',frameId:'frame-a',winner:'L1-01_correction.png',score:41,attempt:3,maxAttempts:3,
      files:['L1-01_correction.png'],review:{reviews:[{n:1,score:41,pass:false,notes:'Worse.'}]},
      result:{targetShotId:'L1-01',recommend:false,baseline:{available:true,file:'L1-01_APPROVED.png',score:72,pass:false},
        correctionVerdicts:{'L1-01_correction.png':{outcome:'regression',delta:-31,baselineScore:72,candidateScore:41}},winnerOutcome:'regression'}}},logs:[]}];`;

/* A shot with a compiled motion package, used by the freshness controls. */
function motionProject() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.clips = [{ id: "unit-a", suffix: "A", label: "A", dur: 8, motionPrompt: "Kai crosses.", generationPackages: [] }];
  shot.creationBrief = { ...(shot.creationBrief || {}), motionDuration: 8, motionProfileId: "minimax-h3/flf", motionDirection: "Kai crosses." };
  return project;
}
const COMPILE_MOTION_PACKAGE = `
  const s = shotById("L1-01"), c = ensureShotCreation(s), unit = s.clips[0];
  const build = { id: "pkg-1", packageId: "L1-01-MOTION-R01", date: "2026-08-17T10:00:00Z",
    profileId: "minimax-h3/flf", profileName: "H3 FLF", mode: "flf", segmentId: unitKey(unit),
    durationSeconds: 8, kind: "guided-motion", revision: 1, prompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS",
    references: promptReferenceOptions(s).filter((r) => r.url), warnings: [], confirmations: [] };
  build.dependencySnapshot = packageInputSnapshot(s, build, build.references, currentDirectionForPackage(s, build));
  const packId = registerPromptBuild(P, build);
  c.motionPromptBuilds = [promptBuildRef(packId, { kind: "guided-motion" })];
  unit.generationPackages = [promptBuildRef(packId, { kind: "guided-motion", scope: "segment:" + unitKey(unit) })];`;

const H3_PLAN = {
  compiledPrompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS",
  profile: { id: "minimax-h3/flf", name: "H3 FLF" }, mode: "flf", references: [],
  durationSeconds: 8, durationRequested: 8, durationRange: [5, 15], resolutions: ["2K"],
  resolution: "2K", carriesAspectRatio: false, maxPromptCharacters: 2000,
  modelMaxPromptCharacters: 2000, modelDurationRange: [5, 15],
  dispatch: { model: "minimax/h3" }, compiler: { packId: "minimax-h3", packVersion: "1" },
};
const h3Fetch = async (url, _options, response) => {
  if (url === "/api/config") return response({ generation: { fal: { enabled: true, apiKey: "test-key", keySource: "config" } } });
  if (url === "/api/generation/fal/h3/plan") return response(H3_PLAN);
  if (String(url).startsWith("/api/generation/options")) return response({ options: [] });
  return null;
};

const CONTROLS = [
  /* ---- P0-1 · project isolation ---------------------------------------- */
  {
    id: "N1",
    title: "the drawer reads the raw activity map again, as it shipped",
    target: { file: "live-activity.js" },
    from: `  const slug = v670ActiveProjectSlug();\n  return [...V641_MANUAL_ACTIVITIES.values()].filter((row) => String(row.projectSlug || "") === slug);`,
    to: `  return [...V641_MANUAL_ACTIVITIES.values()];`,
    expect: /rendered as current-project activity/,
    async guard(run) {
      const app = await run({});
      vm.runInContext(`
        V641_MANUAL_ACTIVITIES.set("smuggled", { id: "smuggled", system: "VISION AI · SCENE CONTINUITY",
          title: "Smuggled from another project", detail: "", projectSlug: "somewhere-else", status: "completed",
          startedAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z" });
        v641StartManualActivity("VISION AI · CANDIDATE REVIEW", "Local review", "");
        
      `, app.context);
      const html = terminalHtml(app.context);
      assert(html.includes("Local review"), "the fixture must produce a current-project row");
      assert(!html.includes("Smuggled from another project"),
        "a row belonging to another project rendered as current-project activity");
    },
  },
  {
    id: "N2",
    title: "the drawer is not purged when the project changes",
    target: { file: "app.js" },
    /* Inside the project load transaction's commit, which is where the slug is
       installed - so this is where the purge has to be asked for. */
    from: `  if (typeof v670ScopeActivityToProject === "function") v670ScopeActivityToProject(ACTIVE_PROJECT_SLUG);`,
    to: `      /* control: the purge is removed */`,
    expect: /activity rows survived the switch/,
    async guard(run) {
      const projects = { "project-a": buildFixture(), "project-b": buildFixture() };
      let active = "project-a";
      const app = await run({
        project: projects[active],
        fetch: async (url, options, response) => {
          if (url === "/api/project") return response(projects[active], 200, { "x-cinebraid-project-slug": active });
          if (url === "/api/projects/switch" && options.method === "POST") { active = JSON.parse(options.body).slug; return response({ ok: true }); }
          if (url === "/api/automation/runs") return response({ runs: [], projectSlug: active });
          if (url === "/api/generation/fal/jobs") return response({ jobs: [], projectSlug: active });
          return null;
        },
      });
      vm.runInContext(`v641FinishManualActivity(v641StartManualActivity("VISION AI · SCENE CONTINUITY", "Review scene SC-01", ""), "completed", "");`, app.context);
      await app.context.switchProject("project-b");
      assert.strictEqual(vm.runInContext("V641_MANUAL_ACTIVITIES.size", app.context), 0,
        "the previous project's activity rows survived the switch");
    },
  },
  {
    id: "N19",
    title: "a FAL payload is admitted without proving which project it belongs to",
    target: { file: "live-activity.js" },
    from: `  if (owner && here && owner !== here) return { rows: null, foreign: owner };\n  if (!owner && rows && rows.length) return { rows: null, foreign: "" };`,
    to: `  /* control: ownership is not checked */`,
    expect: /another project's generation ledger/,
    async guard(run) {
      const projects = { "project-a": buildFixture(), "project-b": buildFixture() };
      const active = "project-b";
      /* The runs route AGREES with the open project; only the FAL route answers for
         another one. That is the exact shape independent review reproduced, and the
         shape a single shared ownership answer cannot see. */
      let falOwner = "project-b";
      const app = await run({
        project: projects[active],
        fetch: async (url, _options, response) => {
          if (url === "/api/project") return response(projects[active], 200, { "x-cinebraid-project-slug": active });
          if (url === "/api/automation/runs") return response({ runs: [], projectSlug: active });
          if (url === "/api/generation/fal/jobs") return response({
            projectSlug: falOwner,
            jobs: falOwner === active ? [] : [{ id: "a-job", status: "IN_QUEUE", purpose: "Project A reference render", outputCount: 0, model: "gpt-image-2", createdAt: "2026-08-17T09:00:00Z" }],
          });
          return null;
        },
      });
      falOwner = "project-a";
      await app.context.refreshGlobalAutomationActivity(true);
      const ids = vm.runInContext("JSON.stringify(FAL_GENERATION_JOBS.map((job) => job.id))", app.context);
      assert.strictEqual(ids, "[]", `this window adopted another project's generation ledger: ${ids}`);
      vm.runInContext("", app.context);
      const drawer = terminalHtml(app.context);
      assert(!drawer.includes("Project A reference render"),
        "another project's generation ledger was rendered in this project's activity");
      const button = app.context.document.getElementById("automation-activity-toggle").innerHTML;
      assert(!/active/.test(button), `another project's generation ledger was counted as this project's: ${button}`);
    },
  },

  /* ---- P0-2 · one recommendation ---------------------------------------- */
  {
    id: "N3",
    title: "the #/create recommendation headline stops coming from the canonical answer",
    target: { file: "creation-studio.js" },
    from: `<span>RECOMMENDED</span><b>\${esc(next.title)}</b>`,
    to: `<span>RECOMMENDED</span><b>\${esc(shotProductionNextAction(P.shots[0]).label)}</b>`,
    expect: /recommendation and the action it labels/,
    async guard(run) {
      /* Batch 2 Slice 2 moved this card. #/create opens on the intent chooser, whose
         default is the assisted path; the RECOMMENDED card belongs to the project
         workspace, which is now the scratch intent. The stored preference puts this
         control back in front of the card it has always been about — what it proves,
         that the headline and the button it labels are one answer, is unchanged. */
      const app = await run({ hash: "#/create", storage: { "cinebraid-creation-start-path": "scratch" } });
      const feed = vm.runInContext("projectShotReadiness()", app.context);
      assert.strictEqual(feed.counts.ready, 0, "the fixture must have no startable shot, or this control is vacuous");
      const canonical = vm.runInContext("projectNextProductionAction()", app.context);
      const html = app.context.document.getElementById("main").innerHTML;
      const card = (html.match(/<article data-recommended-kind[\s\S]*?<\/article>/) || [""])[0];
      assert(card, "the create view must render a recommendation card");
      /* THE HEADLINE, not the card. The card also carries the canonical MESSAGE in
         its <small>, so `card.includes(title)` was true even with the headline
         coming from somewhere else — a weak assertion that let the first version of
         this control miss its own defect. */
      const headline = (card.match(/<b>([\s\S]*?)<\/b>/) || ["", ""])[1];
      vm.runInContext("continueProduction()", app.context);
      assert(headline === canonical.title && app.context.location.hash === canonical.href,
        `the recommendation and the action it labels must be one answer — the card is headlined "${headline}" while its button routes to ${app.context.location.hash} for "${canonical.title}"`);
    },
  },
  {
    id: "N18",
    title: "the project next action stops preferring the blocker and falls back to a shot",
    target: { file: "app.js" },
    from: `  const blockers = projectSharedBlockers(feed);\n  const top = blockers[0];`,
    to: `  const top = null;`,
    expect: /routed into a shot while readiness says nothing can start/,
    async guard(run) {
      const app = await run({});
      const feed = vm.runInContext("projectShotReadiness()", app.context);
      assert.strictEqual(feed.counts.ready, 0, "the fixture must have no startable shot");
      const next = vm.runInContext("projectNextProductionAction()", app.context);
      assert(!/^#\/shot\//.test(next.href),
        `NEXT ACTION routed into a shot while readiness says nothing can start: ${next.href}`);
    },
  },

  /* ---- P0-3 · lineage ---------------------------------------------------- */
  {
    id: "N4",
    title: "recording a source is refused again, as reparenting always was",
    target: { module: "lineage" },
    from: `  if (node.parentStateId) return { record: false, reason: "reparenting-unsupported", parentStateId: node.parentStateId };`,
    to: `  return { record: false, reason: "reparenting-unsupported" };`,
    expect: /could not record one/,
    guard(run) {
      const Lineage = run();
      const states = [
        { id: "state-default", name: "Base", isDefault: true },
        { id: "state-soot", name: "Heavy soot" },
      ];
      const outcome = Lineage.applyDerivationRecord(states, "state-soot", "state-default");
      assert.strictEqual(outcome.applied, true, "a state that records no source could not record one");
      assert.strictEqual(states[1].parentStateId, "state-default");
    },
  },
  {
    id: "N5",
    title: "a descendant is accepted as a source, closing a cycle",
    target: { module: "lineage" },
    from: `  if (stateDescendantIds(rows, id).includes(sourceId)) return { record: false, reason: "source-is-descendant" };`,
    to: `  /* control: the cycle guard is removed */`,
    expect: /descendant was accepted as a source/,
    guard(run) {
      const Lineage = run();
      const states = [
        { id: "state-default", name: "Base", isDefault: true },
        { id: "state-soot", name: "Heavy soot" },
        { id: "state-child", name: "Soot and rain", parentStateId: "state-soot" },
      ];
      assert.strictEqual(Lineage.planDerivationRecord(states, "state-soot", "state-child").reason, "source-is-descendant",
        "a descendant was accepted as a source");
    },
  },
  {
    id: "N6",
    title: "import fills a missing source in with the default state",
    target: { server: true },
    from: `      state.parentStateId = "";\n      missing.push(state.name || state.id || "(unnamed state)");\n      continue;\n    }\n    const named = byName.get(declared.toLowerCase());`,
    to: `      state.parentStateId = states.find((row) => row.isDefault) ? states.find((row) => row.isDefault).id : "";\n      continue;\n    }\n    const named = byName.get(declared.toLowerCase());`,
    expect: /chose a source state on the filmmaker's behalf/,
    guard(run) { importGuard(run()); },
  },
  {
    id: "N17",
    title: "an ambiguous source name resolves to the first state carrying it",
    target: { server: true },
    from: `    byName.set(name, byName.has(name) ? null : state); /* null marks an ambiguous name */`,
    to: `    if (!byName.has(name)) byName.set(name, state);`,
    expect: /a name two states share/,
    guard(run) { importGuard(run()); },
  },

  /* ---- P0-4 · unrenderable media ---------------------------------------- */
  {
    id: "N7",
    title: "the approve button returns for media that cannot be resolved",
    target: { file: "automation.js" },
    from: "${url ? `<button class=\"${suggested ? \"approve-btn\" : \"ghost-btn\"}\"",
    to: "${true ? `<button class=\"${suggested ? \"approve-btn\" : \"ghost-btn\"}\"",
    expect: /approval control was offered for media that cannot be displayed/,
    async guard(run) {
      const app = await run({});
      vm.runInContext(BLANK_MEDIA_RUN, app.context);
      const html = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
      assert(!/APPROVE SUGGESTED/.test(html) && !/APPROVE THIS/.test(html),
        "an approval control was offered for media that cannot be displayed");
    },
  },
  {
    id: "N8",
    title: "the approval command stops refusing unseen media",
    target: { file: "automation.js" },
    from: `  if (!v670CandidateInspectable(cachedRun, cachedStep, fileName))`,
    to: `  if (false)`,
    expect: /authority receipt was written for media nobody could see/,
    async guard(run) {
      const app = await run({ hash: "#/shot/L1-01" });
      /* THE SHOT-FRAME GATE, INSIDE A REAL TRUSTED GESTURE — and both choices are
         load-bearing.
           - the GESTURE removes the authority kernel from the argument. Without one
             the kernel refuses on its own account and this control would "detect"
             through the kernel's message rather than through the media guard it
             exists to test, which is the wrong-reason detection independent review
             found.
           - the FRAME path rather than the entity path, because entity approval has
             a second lock: an unresolvable file is by construction an unowned file,
             so the ownership veto refuses it whatever the media guard does, and the
             control could never observe its own property.
         With both removed from the argument, the media guard is the ONLY thing
         between this request and written Canon — and with it deleted, Canon IS
         written for a file nobody could see. */
      vm.runInContext(`
        AUTOMATION_RUNS=[{id:'run-blank',revision:1,type:'shot-chain',targetId:'L1-01',label:'Shot automation',
          status:'awaiting-review',stage:'Approve a candidate',createdAt:'2026-08-17T10:00:00Z',updatedAt:'2026-08-17T10:01:00Z',
          current:{stepKey:'frame:frame-a:review'},config:{maxImages:9},usage:{imagesGenerated:3},
          steps:{'frame:frame-a:review':{key:'frame:frame-a:review',kind:'frame-review',status:'needs-review',
            label:'Approve a candidate',frameId:'frame-a',winner:'GONE.png',score:90,attempt:1,maxAttempts:3,
            files:['GONE.png'],review:{reviews:[{n:1,score:90,pass:true,notes:'Looks right.'}]}}},logs:[]}];
      `, app.context);
      app.context.toast = () => {};
      const receipts = () => vm.runInContext("((P.productionAuthority && P.productionAuthority.receipts) || []).filter((r) => r.value === 'GONE.png').length", app.context);
      assert.strictEqual(receipts(), 0, "the fixture must start with no receipt for the unresolvable file");
      assert.strictEqual(vm.runInContext("v627CandidateUrl(v626Runs()[0], v626Runs()[0].steps['frame:frame-a:review'], 'GONE.png')", app.context), "",
        "the candidate must genuinely be unresolvable, or this control is vacuous");
      app.gesture.act(() => {
        /* The refresh that follows the approval rejects against the harness's route
           stub; the approval itself commits in the synchronous prologue, which is
           the part under test. */
        const pending = app.context.approveAutomationCandidate("run-blank", "frame:frame-a:review", "GONE.png");
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(receipts(), 0,
        "an authority receipt was written for media nobody could see");
    },
  },

  /* ---- P0-5 · correction comparison ------------------------------------- */
  {
    id: "N9",
    title: "a worse result is classified as an improvement",
    target: { module: "continuity" },
    from: `  if (delta < -CORRECTION_SCORE_MARGIN) return { outcome: "regression", delta, baselineScore: before, candidateScore: after };`,
    to: `  /* control: the regression clause is removed */`,
    expect: /below the approved original was classified/,
    guard(run) {
      const Continuity = run();
      const verdict = Continuity.classifyCorrectionOutcome({ available: true, score: 72 }, { score: 41, pass: true });
      assert.strictEqual(verdict.outcome, "regression",
        `a correction 31 points below the approved original was classified ${verdict.outcome}`);
    },
  },
  {
    id: "N10",
    title: "an uncomparable correction is treated as recommendable",
    target: { module: "continuity" },
    from: `function recommendableCorrection(verdict) {\n  return !!verdict && verdict.outcome === "improvement";\n}`,
    to: `function recommendableCorrection(verdict) {\n  return !verdict || verdict.outcome !== "regression";\n}`,
    expect: /improvement cannot be demonstrated was still recommendable/,
    guard(run) {
      const Continuity = run();
      assert.strictEqual(Continuity.recommendableCorrection(Continuity.classifyCorrectionOutcome({ available: false }, { score: 99, pass: true })), false,
        "a correction whose improvement cannot be demonstrated was still recommendable");
    },
  },
  {
    id: "N20",
    title: "an unstated score is coerced into a real number again",
    target: { module: "continuity" },
    from: `function correctionScore(row) {\n  if (!row || typeof row !== "object") return null;\n  if (row.explicitScore === false) return null;\n  return typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null;\n}`,
    to: `function correctionScore(row) {\n  const value = Number(row && row.score);\n  return Number.isFinite(value) ? value : null;\n}`,
    expect: /unscorable baseline/,
    guard(run) {
      const Continuity = run();
      /* Every shape that coerces to a finite zero, and the unscored-review flag. */
      const unscorable = [null, "", "   ", [], { note: "no score" }];
      for (const score of unscorable) {
        const verdict = Continuity.classifyCorrectionOutcome({ available: true, score }, { score: 80, pass: true });
        assert.strictEqual(verdict.outcome, "unknown",
          `an unscorable baseline (${JSON.stringify(score)}) produced "${verdict.outcome}" against an 80-point challenger`);
      }
      const unscored = Continuity.classifyCorrectionOutcome({ available: true, score: 0, explicitScore: false }, { score: 80, pass: true });
      assert.strictEqual(unscored.outcome, "unknown",
        "an unscorable baseline the reviewer never scored was read as a real zero");
    },
  },
  {
    id: "N11",
    title: "the gate suggests whatever the pass called the winner",
    target: { file: "automation.js" },
    from: `function v670CandidateIsSuggested(step, candidate) {\n  if (candidate.file !== step.winner) return false;`,
    to: `function v670CandidateIsSuggested(step, candidate) {\n  return candidate.file === step.winner;\n  if (candidate.file !== step.winner) return false;`,
    expect: /regression was offered as the suggested fix/,
    async guard(run) {
      const app = await run({ hash: "#/shot/L1-01" });
      vm.runInContext(REGRESSION_RUN, app.context);
      const html = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
      assert(!/APPROVE SUGGESTED/.test(html), "a regression was offered as the suggested fix");
    },
  },
  {
    id: "N15",
    title: "the correction package takes the whole creation reference set again",
    target: { file: "scene-automation.js" },
    from: `      if (ref.supplemental === true || ref.blocking === true) {`,
    to: `      if (false) {`,
    expect: /supplemental coverage view was sent to a targeted repair/,
    async guard(run) {
      const project = buildFixture();
      project.characters[0].coverageSlots = [{ id: "profile", label: "Profile", selectedFile: "KAI-PROFILE.png", required: true }];
      const app = await run({
        project,
        hash: "#/shot/L1-01",
        scan: {
          anchors: [{ name: "KAI-ANCHOR.png", url: "/a/KAI-ANCHOR.png" }, { name: "KAI-PROFILE.png", url: "/a/KAI-PROFILE.png" }],
          plates: [], props: [], vehicles: [], audio: [], media: [],
          shots: { "L1-01": { takes: [{ name: "L1-01_APPROVED.png", url: "/t/L1-01_APPROVED.png" }], locked: [] } },
        },
      });
      const sent = JSON.parse(vm.runInContext(`
        (() => {
          const pkg = { id: "pkg", targetShotId: "L1-01", previousShotId: "", nextShotId: "" };
          return JSON.stringify(v640SceneCorrectionReferences(pkg).map((ref) => ref.key));
        })()
      `, app.context));
      assert(!sent.includes("coverage:characters:KAI:profile"),
        `a supplemental coverage view was sent to a targeted repair: ${JSON.stringify(sent)}`);
    },
  },

  /* ---- P0-7 · compiler truth and freshness ------------------------------ */
  {
    id: "N12",
    title: "the compiled package stops recording duration and method",
    target: { file: "review-provenance.js" },
    from: `    durationSeconds: Number(pack.durationSeconds || 0) || 0,\n    profileId: String(pack.profileId || ""),\n    mode: String(pack.mode || ""),`,
    to: `    /* control: the compiled inputs are no longer recorded */`,
    expect: /duration change left the compiled package reading current/,
    async guard(run) {
      const app = await run({ project: motionProject(), hash: "#/shot/L1-01" });
      vm.runInContext(`${COMPILE_MOTION_PACKAGE}\n  s.creationBrief.motionDuration = 6;`, app.context);
      const reasons = vm.runInContext(`JSON.stringify(packageStaleReasons(shotById("L1-01"), resolvePromptBuildList(P, shotById("L1-01").clips[0].generationPackages)[0]))`, app.context);
      assert(/duration changed to 6s/.test(reasons),
        `a user-facing duration change left the compiled package reading current: ${reasons}`);
    },
  },
  {
    id: "N21",
    title: "a consumed reference that disappeared is substituted from the saved package",
    target: { file: "review-provenance.js" },
    /* BOTH HALVES, because either alone still leaves the package stale — and a
       control that reproduces only half the defect is not reproducing the defect.
       The shipped-at-a353151 behaviour was the saved reference substituted for the
       missing one AND no reason naming the disappearance. */
    mutations: [
      {
        from: `        return current ? { ...saved, url: current.url, label: current.label } : null;\n      })\n      .filter(Boolean);`,
        to: `        return current ? { ...saved, url: current.url, label: current.label } : saved;\n      });`,
      },
      {
        /* THE SECOND HALF MOVED SEAM, NOT MEANING. Paid Request Truth V1 lifted the
           comparison itself into public/shared-build-history.js so the money boundary
           could call it too, and packageStaleReasons() became the thing that GATHERS
           the evidence and hands it over. The disappearance reason is therefore
           suppressed here by WITHHOLDING the evidence rather than by deleting the
           branch that reports it - the same defect, at the line that now owns it, and
           still inside this file.

           missingConsumedReferences() is left defined and uncalled by this edit, which
           is exactly what a regression of this kind looks like in the wild. */
        from: `    missingReferences: missingConsumedReferences(s, pack),`,
        to: `    missingReferences: [],`,
      },
    ],
    expect: /consumed reference disappeared and the package stayed current/,
    async guard(run) {
      const app = await run({ project: motionProject(), hash: "#/shot/L1-01" });
      const out = JSON.parse(vm.runInContext(`
        (() => {
          ${COMPILE_MOTION_PACKAGE}
          const consumed = build.references.map((r) => r.key);
          /* Remove the character the compiled package consumed. */
          s.characters = []; P.characters = [];
          const now = promptReferenceOptions(s).map((r) => r.key);
          const reasons = packageStaleReasons(s, resolvePromptBuildList(P, unit.generationPackages)[0]);
          return JSON.stringify({ consumed, now, reasons });
        })()
      `, app.context));
      assert(out.consumed.includes("character:KAI"), "the package must actually consume the reference being removed");
      assert(!out.now.includes("character:KAI"), "the production must genuinely no longer offer it");
      assert(out.reasons.length > 0,
        `a consumed reference disappeared and the package stayed current: consumed ${JSON.stringify(out.consumed)}, now ${JSON.stringify(out.now)}`);
    },
  },
  {
    id: "N13",
    title: "the compiled prompt surface stops showing staleness",
    target: { file: "creation-studio.js" },
    from: `<b>OUT OF DATE — REBUILD BEFORE GENERATING</b>`,
    to: `<b>CURRENT</b>`,
    expect: /out-of-date compiled prompt did not say so/,
    async guard(run) {
      const app = await run({ project: motionProject(), hash: "#/shot/L1-01" });
      const markup = vm.runInContext(`
        (() => {
          ${COMPILE_MOTION_PACKAGE}
          s.creationBrief.motionDuration = 6;
          return guidedMotionPromptResult(s, resolvePromptBuild(P, unit.generationPackages[0]));
        })()
      `, app.context);
      assert(/OUT OF DATE/.test(markup), `an out-of-date compiled prompt did not say so: ${markup.slice(0, 200)}`);
    },
  },
  {
    id: "N16",
    title: "a stale package reaches the paid dialog silently again",
    target: { file: "fal-generation.js" },
    from: `<section id="fal-h3-sequence" class="h3-submit-sequence" hidden></section>\${freshnessBanner}\${durationBanner}`,
    to: `<section id="fal-h3-sequence" class="h3-submit-sequence" hidden></section>\${durationBanner}`,
    expect: /reached the paid submission dialog with nothing saying so/,
    async guard(run) {
      const app = await run({ project: motionProject(), hash: "#/shot/L1-01", fetch: h3Fetch });
      vm.runInContext(`${COMPILE_MOTION_PACKAGE}\n  s.creationBrief.motionDuration = 6;`, app.context);
      await app.context.openFalH3MotionModal("L1-01", "pkg-1");
      const html = app.context.document.getElementById("modal").innerHTML;
      assert(/MINIMAX H3 · PAID GENERATION/.test(html), "the paid dialog must open, or this control is vacuous");
      assert(/This compiled package is out of date/.test(html),
        "a stale package reached the paid submission dialog with nothing saying so");
    },
  },
  {
    id: "N14",
    title: "the H3 compiler emits the same instruction twice",
    target: { module: "engine" },
    from: `  const sections = minimaxH3DedupeSections((chunks || []).filter(Boolean).map(minimaxH3SectionParts));`,
    to: `  const sections = (chunks || []).filter(Boolean).map(minimaxH3SectionParts);`,
    expect: /emitted the same instruction/,
    guard(run) {
      const Engine = run();
      const profile = Engine.getProfile("minimax-h3/flf");
      const line = "Kai walks from the stairwell door to the ledge and stops.";
      const spec = {
        schemaVersion: 1, purpose: "motion", mode: "flf", shotId: "L1-01", durationSeconds: 8,
        narrativePurpose: line,
        initialState: { subject: "", staging: "", camera: "", environment: "" },
        finalState: { subject: "", staging: "", camera: "", environment: "" },
        actions: [{ start: 0, end: 8, action: line }],
        camera: { framing: "", movement: "", stability: "", lensIntent: "" },
        performance: { emotion: "", movementIntensity: "", gaze: "" },
        environmentMotion: [line], stagingLines: [], mustInclude: [], mustPreserve: [], mustAvoid: [],
        identityCanon: [], driftRestatements: [], visualGrounding: [], promptEntities: [],
        productionRisks: [], promptWarnings: [], audio: { mode: "none", dialogue: "" }, visualStyle: [],
      };
      const refs = [
        { key: "first", label: "First", role: "first-frame", mediaType: "image", url: "/a.png", instruction: "" },
        { key: "last", label: "Last", role: "last-frame", mediaType: "image", url: "/b.png", instruction: "" },
      ];
      const compiled = Engine.compile(profile, spec, refs).prompt;
      assert.strictEqual(compiled.split(line).length - 1, 1,
        `the compiler emitted the same instruction ${compiled.split(line).length - 1} times`);
    },
  },
];

/* The server-side import normaliser, lifted by exact source into a vm context. */
function importNormalizer(source) {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  const start = source.indexOf("function normalizeBuilderContinuityStates");
  const body = source.slice(start, source.indexOf("\nfunction builderCoverageAlias", start));
  vm.runInContext(
    `function builderArray(v){return Array.isArray(v)?v:[];}`
    + `function builderObject(v){return v&&typeof v==="object"?v:{};}`
    + `function addBuilderMarker(t){return String(t||"");}\n${body}\n`
    + `this.normalizeBuilderContinuityStates = normalizeBuilderContinuityStates;`,
    context,
  );
  return context.normalizeBuilderContinuityStates;
}
function importGuard(normalize) {
  const warnings = [];
  const states = normalize({ id: "LOC-ROOF", continuityStates: [
    { id: "state-default", name: "Base", isDefault: true },
    { id: "state-soot", name: "Heavy soot" },
  ] }, "location", warnings);
  assert.strictEqual(states[1].parentStateId, "", "import chose a source state on the filmmaker's behalf");
  assert(warnings.some((row) => /do not record what they derive from/.test(row)),
    "import did not report the missing lineage");
  const ambiguous = normalize({ id: "LOC-ROOF", continuityStates: [
    { id: "state-default", name: "Working", isDefault: true },
    { id: "state-b", name: "Working", parentStateId: "state-default" },
    { id: "state-soot", name: "Heavy soot", derivesFrom: "Working" },
  ] }, "location", []);
  assert.strictEqual(ambiguous[2].parentStateId, "",
    "import resolved a source named by a name two states share");
}

/* ==========================================================================
   PHASE 1 — ARM.

   Builds the subject-maker for a control. Throws with `notArmed` when the intended
   mutation cannot be applied, which the runner reports as BROKEN and never as a
   detection. `applied` is false until the mutated source has actually been handed
   to the thing under test, so a page mutation aimed at a file render() does not
   load is caught too. */
function arm(control, mutated) {
  if (control.target.module) {
    const file = MODULE_TARGETS[control.target.module];
    const source = mutated ? applyMutation(ORIGINAL.get(file), control) : ORIGINAL.get(file);
    const state = { applied: !mutated };
    return { state, run: () => { state.applied = true; return compileModule(source, file); } };
  }
  if (control.target.server) {
    const source = mutated ? applyMutation(ORIGINAL.get(SERVER), control) : ORIGINAL.get(SERVER);
    const state = { applied: !mutated };
    return { state, run: () => { state.applied = true; return importNormalizer(source); } };
  }
  const file = control.target.file;
  const full = path.join(PUBLIC, file);
  const source = mutated ? applyMutation(ORIGINAL.get(full), control) : null;
  const state = { applied: !mutated };
  const run = (options = {}) => {
    const { project, hash, ...rest } = options;
    /* A1: these controls read the Activity Terminal, which is the operational owner. */
    const renderOptions = { creatorSurfaces: true, ...rest };
    if (mutated) {
      renderOptions.mutateSource = (name, original) => {
        if (name !== file) return original;
        state.applied = true;
        return source;
      };
    }
    return render(hash || "#/production", project || buildFixture(), renderOptions);
  };
  return { state, run };
}

async function main() {
  const results = [];
  let armedCount = 0, caught = 0, broken = 0, missed = 0;
  const push = (id, status, detail) => results.push({ id, status, detail });

  for (const control of CONTROLS) {
    /* PHASE 0 — the guard must PASS against the SHIPPED source, or a "detection"
       is a detection of something that was already broken. */
    try {
      const shipped = arm(control, false);
      await control.guard(shipped.run);
    } catch (error) {
      broken++;
      push(control.id, "BROKEN", `the guard fails against the SHIPPED source: ${String(error.message).split("\n")[0]}`);
      continue;
    }

    /* PHASE 1 — ARM. */
    let armedControl;
    try {
      armedControl = arm(control, true);
    } catch (error) {
      broken++;
      push(control.id, "NOT ARMED", `${error.message}${error.notArmed ? "" : ` (${error.name})`}`);
      continue;
    }
    armedCount++;

    /* PHASE 2 — EXECUTE. */
    let failure = null;
    try {
      await control.guard(armedControl.run);
    } catch (error) {
      failure = error;
    }

    /* The mutated source has to have actually reached the subject. A page mutation
       aimed at a file the render never loads would otherwise look like a MISS. */
    if (!armedControl.state.applied) {
      broken++;
      push(control.id, "NOT ARMED", "the mutated source was never handed to the code under test");
      continue;
    }

    /* PHASE 3 — DETECT, and only for this control's own reason. */
    if (!failure) {
      missed++;
      push(control.id, "MISSED", control.title);
      continue;
    }
    if (failure.name !== "AssertionError") {
      broken++;
      push(control.id, "BROKEN", `the defect threw ${failure.name} instead of failing the guard: ${String(failure.message).split("\n")[0]}`);
      continue;
    }
    const message = String(failure.message);
    if (!control.expect.test(message)) {
      broken++;
      push(control.id, "WRONG REASON", `expected ${control.expect} · got: ${message.split("\n")[0]}`);
      continue;
    }
    caught++;
    push(control.id, "caught", message.split("\n")[0]);
  }

  const width = Math.max(...results.map((row) => row.status.length));
  for (const row of results) console.log(`  ${row.id.padEnd(4)} ${row.status.padEnd(width)}  ${row.detail}`);

  /* Every file this suite mutated was mutated in memory. */
  for (const file of TOUCHED) {
    assert.strictEqual(fs.readFileSync(file, "utf8"), ORIGINAL.get(file),
      `${path.relative(ROOT, file)} was modified on disk — every control here is in-memory only`);
  }

  console.log(`\n  armed ${armedCount}/${CONTROLS.length}   caught ${caught}   broken/not-armed ${broken}   missed ${missed}`);
  assert.strictEqual(broken, 0, `${broken} control(s) did not arm, or detected for a reason other than their own — a setup failure is not a receipt`);
  assert.strictEqual(missed, 0, `${missed} defect(s) were reintroduced and nothing caught them: ${results.filter((row) => row.status === "MISSED").map((row) => row.id).join(", ")}`);
  assert.strictEqual(armedCount, CONTROLS.length, "every control must arm");
  assert.strictEqual(caught, CONTROLS.length, "every armed control must be caught for its own reason");

  console.log(`\nFounder smoke P0 negative controls passed: ${CONTROLS.length} defects armed against live production source, ${caught} caught for their own stated reason, 0 broken, 0 missed. Nothing was written to disk and nothing was reverted with git. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
