/* NEGATIVE CONTROLS FOR THE FOUNDER-SMOKE P0 TRUST REPAIRS.
 *
 * A green suite proves nothing unless the defect it describes would turn it red.
 * Each control below REINTRODUCES one specific defect exactly as it shipped at
 * baseline 5207da1, runs the guarantee that is supposed to catch it, and requires
 * that guarantee to FAIL. A control that passes caught nothing, and this file
 * fails on it.
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Browser defects go
 * through render()'s `mutateSource` hook, which rewrites the shipped script text
 * on its way into the vm; the pure-module defect is compiled from a mutated copy
 * of the source into an in-memory Module. The suite re-reads every file it
 * mutated at the end and requires it to be byte-identical to what it read at the
 * top — a `git checkout` used to "restore" a control here and discarded four
 * unstaged repairs doing it.
 *
 * A SYNTAX OR REFERENCE ERROR IS NOT A RECEIPT. Every mutation asserts that it
 * matched the text it meant to match, and every guard is required to PASS against
 * the shipped source before its defect is injected. A control that blew a file up
 * would "fail" for a reason unrelated to the property, so those are reported as
 * BROKEN rather than counted as detections.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture, withCanon } = require("./render-harness");

const CONTINUITY_PATH = path.join(ROOT, "public", "shared-continuity.js");
const CONTINUITY_SOURCE = fs.readFileSync(CONTINUITY_PATH, "utf8");
const ENGINE_PATH = path.join(ROOT, "prompt-engine.js");
const ENGINE_SOURCE = fs.readFileSync(ENGINE_PATH, "utf8");
const LINEAGE_PATH = path.join(ROOT, "public", "shared-state-lineage.js");
const LINEAGE_SOURCE = fs.readFileSync(LINEAGE_PATH, "utf8");

/* Compile a mutated copy of a CommonJS module in memory. Nothing is written. */
function compileModule(source, filename) {
  const compiled = new Module(filename, null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

/* An in-memory source rewrite that must actually match.
 *
 * Line endings are normalised to LF first. This repository is checked out with
 * core.autocrlf=true, so every source file on disk is CRLF while the multi-line
 * needles below are written with LF — without this, every multi-line control
 * would report "did not match" and the whole file would look broken rather than
 * the controls looking wrong. Nothing is written back, so normalising here cannot
 * change a byte on disk. */
function mutate(source, from, to, label) {
  const normalized = String(source).replace(/\r\n/g, "\n");
  const needle = String(from).replace(/\r\n/g, "\n");
  assert(normalized.includes(needle), `control "${label}" did not match the shipped source it meant to change`);
  return normalized.replace(needle, to);
}

/* A mutateSource hook for render(), scoped to one file. */
function fileMutation(file, from, to, label) {
  return (name, source) => {
    if (name !== file) return source;
    return mutate(source, from, to, label);
  };
}

const LOCATION_FIXTURE = () => {
  const project = buildFixture();
  project.locations = [{
    id: "LOC-ROOF", name: "Rooftop", status: "APPROVED", approvedFile: "LOC-ROOF-WORKING.png",
    continuityStates: [
      { id: "state-default", name: "Rooftop working state", isDefault: true, approvedFile: "LOC-ROOF-WORKING.png", notes: "Primary." },
      { id: "state-soot", name: "Heavy soot", isDefault: false, approvedFile: "", notes: "Heavy soot over every surface.", generationMode: "derive", referenceRequirement: "required" },
    ],
  }];
  return withCanon(project, { kind: "entity-state", list: "locations", entityId: "LOC-ROOF", stateId: "state-default", value: "LOC-ROOF-WORKING.png" });
};

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

const CONTROLS = [
  {
    id: "N1",
    title: "P0-1 — the drawer reads the raw activity map again, as it shipped",
    defect: fileMutation("live-activity.js",
      `  const slug = v670ActiveProjectSlug();\n  return [...V641_MANUAL_ACTIVITIES.values()].filter((row) => String(row.projectSlug || "") === slug);`,
      `  return [...V641_MANUAL_ACTIVITIES.values()];`,
      "N1"),
    async guard(mutateSource) {
      /* The purge is left intact; only the per-row scoping is removed, which is
         exactly the shipped behaviour. A row belonging to another project must
         then reappear in this project's drawer. */
      const app = await render("#/production", buildFixture(), mutateSource ? { mutateSource } : {});
      vm.runInContext(`
        V641_MANUAL_ACTIVITIES.set("smuggled", { id: "smuggled", system: "VISION AI · SCENE CONTINUITY",
          title: "Smuggled from another project", detail: "", projectSlug: "somewhere-else", status: "completed",
          startedAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z" });
        v641StartManualActivity("VISION AI · CANDIDATE REVIEW", "Local review", "");
        V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();
      `, app.context);
      const html = app.context.document.getElementById("automation-activity-drawer").innerHTML;
      assert(html.includes("Local review"), "the fixture must produce a current-project row");
      assert(!html.includes("Smuggled from another project"),
        "a row belonging to another project rendered as current-project activity");
    },
  },
  {
    id: "N2",
    title: "P0-1 — the drawer is not purged when the project changes",
    defect: fileMutation("app.js",
      `if (typeof v670ScopeActivityToProject === "function") v670ScopeActivityToProject(ACTIVE_PROJECT_SLUG);`,
      `/* control: the purge is removed */`,
      "N2"),
    async guard(mutateSource) {
      const projects = { "project-a": buildFixture(), "project-b": buildFixture() };
      let active = "project-a";
      const customFetch = async (url, options, response) => {
        if (url === "/api/project") return response(projects[active], 200, { "x-cinebraid-project-slug": active });
        if (url === "/api/projects/switch" && options.method === "POST") { active = JSON.parse(options.body).slug; return response({ ok: true }); }
        if (url === "/api/automation/runs") return response({ runs: [], projectSlug: active });
        if (url === "/api/generation/fal/jobs") return response({ jobs: [] });
        return null;
      };
      const options = { fetch: customFetch };
      if (mutateSource) options.mutateSource = mutateSource;
      const app = await render("#/production", projects[active], options);
      vm.runInContext(`v641FinishManualActivity(v641StartManualActivity("VISION AI · SCENE CONTINUITY", "Review scene SC-01", ""), "completed", "");`, app.context);
      await app.context.switchProject("project-b");
      assert.strictEqual(vm.runInContext("V641_MANUAL_ACTIVITIES.size", app.context), 0,
        "the previous project's activity rows survived the switch");
    },
  },
  {
    id: "N3",
    title: "P0-2 — Next Action reads media presence again instead of readiness",
    defect: fileMutation("app.js",
      `const next = projectNextProductionAction();\n  const decisions = projectDecisionItems();`,
      `const row = nextProductionShot();\n  const next = row ? { kind: "shot", shotId: row.shot.id, href: "#/shot/" + row.shot.id, title: row.shot.id, message: row.next.detail, actionLabel: row.next.label.toUpperCase() } : null;\n  const decisions = projectDecisionItems();`,
      "N3"),
    async guard(mutateSource) {
      const app = await render("#/production", buildFixture(), mutateSource ? { mutateSource } : {});
      const feed = vm.runInContext("projectShotReadiness()", app.context);
      assert.strictEqual(feed.counts.ready, 0, "the fixture must have no startable shot");
      const html = app.context.document.getElementById("main").innerHTML;
      const section = (html.match(/<section class="production-next"[\s\S]*?<\/section>/) || [""])[0];
      assert(!/href="#\/shot\//.test(section),
        `NEXT ACTION routed into a shot while readiness says nothing can start: ${section.slice(0, 200)}`);
    },
  },
  {
    id: "N4",
    title: "P0-3 — recording a source is refused again, as reparenting always was",
    defect: (source) => mutate(source,
      `  if (node.parentStateId) return { record: false, reason: "reparenting-unsupported", parentStateId: node.parentStateId };`,
      `  return { record: false, reason: "reparenting-unsupported" };`,
      "N4"),
    guard(source) {
      const Lineage = compileModule(source, LINEAGE_PATH);
      const states = [
        { id: "state-default", name: "Base", isDefault: true },
        { id: "state-soot", name: "Heavy soot" },
      ];
      const outcome = Lineage.applyDerivationRecord(states, "state-soot", "state-default");
      assert.strictEqual(outcome.applied, true, "a state that records no source could not record one");
      assert.strictEqual(states[1].parentStateId, "state-default");
    },
    module: LINEAGE_PATH,
  },
  {
    id: "N5",
    title: "P0-3 — a descendant is accepted as a source, closing a cycle",
    defect: (source) => mutate(source,
      `  if (stateDescendantIds(rows, id).includes(sourceId)) return { record: false, reason: "source-is-descendant" };`,
      `  /* control: the cycle guard is removed */`,
      "N5"),
    guard(source) {
      const Lineage = compileModule(source, LINEAGE_PATH);
      const states = [
        { id: "state-default", name: "Base", isDefault: true },
        { id: "state-soot", name: "Heavy soot" },
        { id: "state-child", name: "Soot and rain", parentStateId: "state-soot" },
      ];
      assert.strictEqual(Lineage.planDerivationRecord(states, "state-soot", "state-child").reason, "source-is-descendant",
        "a descendant was accepted as a source");
    },
    module: LINEAGE_PATH,
  },
  {
    id: "N6",
    title: "P0-3 — import guesses a source for a state that records none",
    defect: null, /* server-side: exercised directly below */
    server: true,
  },
  {
    id: "N7",
    title: "P0-4 — the approve button returns for media that cannot be resolved",
    defect: fileMutation("automation.js",
      "${url ? `<button class=\"${suggested ? \"approve-btn\" : \"ghost-btn\"}\"",
      "${true ? `<button class=\"${suggested ? \"approve-btn\" : \"ghost-btn\"}\"",
      "N7"),
    async guard(mutateSource) {
      const app = await render("#/shot/L1-01", buildFixture(), mutateSource ? { mutateSource } : {});
      vm.runInContext(BLANK_MEDIA_RUN, app.context);
      const html = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
      assert(!/APPROVE SUGGESTED/.test(html) && !/APPROVE THIS/.test(html),
        "an approval control was offered for media that cannot be displayed");
    },
  },
  {
    id: "N8",
    title: "P0-4 — the approval command stops refusing unseen media",
    defect: fileMutation("automation.js",
      `  if (!v670CandidateInspectable(cachedRun, cachedStep, fileName))`,
      `  if (false)`,
      "N8"),
    async guard(mutateSource) {
      const app = await render("#/shot/L1-01", buildFixture(), mutateSource ? { mutateSource } : {});
      vm.runInContext(BLANK_MEDIA_RUN, app.context);
      let toasted = "";
      app.context.toast = (message) => { toasted = message; };
      await vm.runInContext(`approveAutomationCandidate('run-blank','entity:state-default:review','KAI-GONE.png')`, app.context);
      /* WHAT THIS CONTROL PROVES, EXACTLY. It proves the media refusal is the thing
         that stopped the request — not that authority would otherwise be minted.
         The authority kernel refuses independently here for its own reason (no
         trusted gesture), which is a second lock on the same door and is why the
         defect's toast is the kernel's rather than a success. Overclaiming would
         make this receipt worth less than it is. */
      assert(/cannot be displayed for inspection/.test(toasted),
        `the approval command stopped refusing media nobody could see; it failed for another reason instead: ${toasted}`);
    },
  },
  {
    id: "N9",
    title: "P0-5 — a worse result is classified as an improvement",
    defect: (source) => mutate(source,
      `  if (delta < -CORRECTION_SCORE_MARGIN) return { outcome: "regression", delta, baselineScore: before, candidateScore: after };`,
      `  /* control: the regression clause is removed */`,
      "N9"),
    guard(source) {
      const Continuity = compileModule(source, CONTINUITY_PATH);
      const verdict = Continuity.classifyCorrectionOutcome({ available: true, score: 72 }, { score: 41, pass: true });
      assert.strictEqual(verdict.outcome, "regression",
        `a correction 31 points below the approved original was classified ${verdict.outcome}`);
    },
    module: CONTINUITY_PATH,
  },
  {
    id: "N10",
    title: "P0-5 — an uncomparable correction is treated as recommendable",
    defect: (source) => mutate(source,
      `function recommendableCorrection(verdict) {\n  return !!verdict && verdict.outcome === "improvement";\n}`,
      `function recommendableCorrection(verdict) {\n  return !verdict || verdict.outcome !== "regression";\n}`,
      "N10"),
    guard(source) {
      const Continuity = compileModule(source, CONTINUITY_PATH);
      assert.strictEqual(Continuity.recommendableCorrection(Continuity.classifyCorrectionOutcome({ available: false }, { score: 99, pass: true })), false,
        "a correction whose improvement cannot be demonstrated was still recommendable");
    },
    module: CONTINUITY_PATH,
  },
  {
    id: "N11",
    title: "P0-5 — the gate suggests whatever the pass called the winner",
    defect: fileMutation("automation.js",
      `function v670CandidateIsSuggested(step, candidate) {\n  if (candidate.file !== step.winner) return false;`,
      `function v670CandidateIsSuggested(step, candidate) {\n  return candidate.file === step.winner;\n  if (candidate.file !== step.winner) return false;`,
      "N11"),
    async guard(mutateSource) {
      const app = await render("#/shot/L1-01", buildFixture(), mutateSource ? { mutateSource } : {});
      vm.runInContext(REGRESSION_RUN, app.context);
      const html = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
      assert(!/APPROVE SUGGESTED/.test(html), "a regression was offered as the suggested fix");
    },
  },
  {
    id: "N12",
    title: "P0-7 — the compiled package stops recording duration and method",
    defect: fileMutation("review-provenance.js",
      `    durationSeconds: Number(pack.durationSeconds || 0) || 0,\n    profileId: String(pack.profileId || ""),\n    mode: String(pack.mode || ""),`,
      `    /* control: the compiled inputs are no longer recorded */`,
      "N12"),
    async guard(mutateSource) {
      const project = buildFixture();
      const shot = project.shots[0];
      shot.clips = [{ id: "unit-a", suffix: "A", label: "A", dur: 8, motionPrompt: "Kai crosses.", generationPackages: [] }];
      shot.creationBrief = { ...(shot.creationBrief || {}), motionDuration: 8, motionProfileId: "minimax-h3/flf", motionDirection: "Kai crosses." };
      const app = await render("#/shot/L1-01", project, mutateSource ? { mutateSource } : {});
      vm.runInContext(`
        const s = shotById("L1-01"), unit = s.clips[0];
        const build = { id: "pkg-1", packageId: "L1-01-MOTION-R01", date: "2026-08-17T10:00:00Z",
          profileId: "minimax-h3/flf", mode: "flf", segmentId: unitKey(unit), durationSeconds: 8,
          kind: "guided-motion", revision: 1, prompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS", references: [] };
        build.dependencySnapshot = packageInputSnapshot(s, build, build.references, currentDirectionForPackage(s, build));
        const id = registerPromptBuild(P, build);
        unit.generationPackages = [promptBuildRef(id, { kind: "guided-motion", scope: "segment:" + unitKey(unit) })];
        s.creationBrief.motionDuration = 6;
      `, app.context);
      const reasons = vm.runInContext(`JSON.stringify(packageStaleReasons(shotById("L1-01"), resolvePromptBuildList(P, shotById("L1-01").clips[0].generationPackages)[0]))`, app.context);
      assert(/duration changed to 6s/.test(reasons),
        `a user-facing duration change left the compiled package reading current: ${reasons}`);
    },
  },
  {
    id: "N13",
    title: "P0-7 — the compiled prompt surface stops showing staleness",
    defect: fileMutation("creation-studio.js",
      `<b>OUT OF DATE — REBUILD BEFORE GENERATING</b>`,
      `<b>CURRENT</b>`,
      "N13"),
    async guard(mutateSource) {
      const project = buildFixture();
      const shot = project.shots[0];
      shot.clips = [{ id: "unit-a", suffix: "A", label: "A", dur: 8, motionPrompt: "Kai crosses.", generationPackages: [] }];
      shot.creationBrief = { ...(shot.creationBrief || {}), motionDuration: 8, motionProfileId: "minimax-h3/flf", motionDirection: "Kai crosses." };
      const app = await render("#/shot/L1-01", project, mutateSource ? { mutateSource } : {});
      const markup = vm.runInContext(`
        (() => {
          const s = shotById("L1-01"), unit = s.clips[0];
          const build = { id: "pkg-1", packageId: "L1-01-MOTION-R01", date: "2026-08-17T10:00:00Z",
            profileId: "minimax-h3/flf", profileName: "H3 FLF", mode: "flf", segmentId: unitKey(unit),
            durationSeconds: 8, kind: "guided-motion", revision: 1, prompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS",
            references: [], warnings: [], confirmations: [] };
          build.dependencySnapshot = packageInputSnapshot(s, build, build.references, currentDirectionForPackage(s, build));
          s.creationBrief.motionDuration = 6;
          return guidedMotionPromptResult(s, build);
        })()
      `, app.context);
      assert(/OUT OF DATE/.test(markup), `an out-of-date compiled prompt did not say so: ${markup.slice(0, 300)}`);
    },
  },
  {
    id: "N15",
    title: "P0-5 — the correction package takes the whole creation reference set again",
    defect: fileMutation("scene-automation.js",
      `      if (ref.supplemental === true || ref.blocking === true) {`,
      `      if (false) {`,
      "N15"),
    async guard(mutateSource) {
      const project = buildFixture();
      project.characters[0].coverageSlots = [{ id: "profile", label: "Profile", selectedFile: "KAI-PROFILE.png", required: true }];
      const options = {
        scan: {
          anchors: [{ name: "KAI-ANCHOR.png", url: "/a/KAI-ANCHOR.png" }, { name: "KAI-PROFILE.png", url: "/a/KAI-PROFILE.png" }],
          plates: [], props: [], vehicles: [], audio: [], media: [],
          shots: { "L1-01": { takes: [{ name: "L1-01_APPROVED.png", url: "/t/L1-01_APPROVED.png" }], locked: [] } },
        },
      };
      if (mutateSource) options.mutateSource = mutateSource;
      const app = await render("#/shot/L1-01", project, options);
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
  {
    id: "N14",
    title: "P0-7 — the H3 compiler emits the same instruction twice",
    defect: (source) => mutate(source,
      `  const sections = minimaxH3DedupeSections((chunks || []).filter(Boolean).map(minimaxH3SectionParts));`,
      `  const sections = (chunks || []).filter(Boolean).map(minimaxH3SectionParts);`,
      "N14"),
    guard(source) {
      const Engine = compileModule(source, ENGINE_PATH);
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
    module: ENGINE_PATH,
  },
];

/* The import control is server-side and reads its own function out of server.js. */
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

async function main() {
  const results = [];
  let broken = 0;

  const record = async (control, run) => {
    let caught = null;
    try { await run(); } catch (error) { caught = error; }
    if (!caught) {
      results.push({ id: control.id, status: "MISSED", detail: control.title });
      return;
    }
    if (caught.name !== "AssertionError") {
      broken++;
      results.push({ id: control.id, status: "BROKEN", detail: `${caught.name}: ${String(caught.message).split("\n")[0]}` });
      return;
    }
    results.push({ id: control.id, status: "detected", detail: String(caught.message).split("\n")[0] });
  };

  for (const control of CONTROLS) {
    if (control.id === "N6") continue;
    /* The guard must PASS against the shipped source first, or a "detection" is
       a detection of nothing. */
    try {
      if (control.module) control.guard(fs.readFileSync(control.module, "utf8"));
      else await control.guard(null);
    } catch (error) {
      broken++;
      results.push({ id: control.id, status: "BROKEN", detail: `the guard fails against the SHIPPED source: ${String(error.message).split("\n")[0]}` });
      continue;
    }
    if (control.module) {
      const mutated = control.defect(fs.readFileSync(control.module, "utf8"));
      await record(control, () => control.guard(mutated));
    } else {
      await record(control, () => control.guard(control.defect));
    }
  }

  /* N6 — the import normaliser. The shipped one leaves an unrecorded source empty
     and says so; the defect fills it in with the default state, which is exactly
     what 1D-06 removed and exactly what would hide the founder's blocker. */
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const importGuard = (normalize) => {
    const warnings = [];
    const states = normalize({ id: "LOC-ROOF", continuityStates: [
      { id: "state-default", name: "Base", isDefault: true },
      { id: "state-soot", name: "Heavy soot" },
    ] }, "location", warnings);
    assert.strictEqual(states[1].parentStateId, "", "import chose a source state on the filmmaker's behalf");
    assert(warnings.some((row) => /do not record what they derive from/.test(row)),
      "import did not report the missing lineage");
  };
  try {
    importGuard(importNormalizer(serverSource));
  } catch (error) {
    broken++;
    results.push({ id: "N6", status: "BROKEN", detail: `the guard fails against the SHIPPED source: ${String(error.message).split("\n")[0]}` });
  }
  const mutatedServer = mutate(serverSource,
    `      state.parentStateId = "";\n      missing.push(state.name || state.id || "(unnamed state)");\n      continue;\n    }\n    const named = byName.get(declared.toLowerCase());`,
    `      state.parentStateId = states.find((row) => row.isDefault) ? states.find((row) => row.isDefault).id : "";\n      continue;\n    }\n    const named = byName.get(declared.toLowerCase());`,
    "N6");
  await record({ id: "N6", title: CONTROLS.find((row) => row.id === "N6").title }, () => importGuard(importNormalizer(mutatedServer)));

  for (const result of results) console.log(`  ${result.id.padEnd(4)} ${result.status.padEnd(9)} ${result.detail}`);

  /* Everything this suite mutated was mutated in memory. */
  for (const [label, file, source] of [
    ["public/shared-continuity.js", CONTINUITY_PATH, CONTINUITY_SOURCE],
    ["public/shared-state-lineage.js", LINEAGE_PATH, LINEAGE_SOURCE],
    ["prompt-engine.js", ENGINE_PATH, ENGINE_SOURCE],
    ["server.js", path.join(ROOT, "server.js"), serverSource],
  ]) assert.strictEqual(fs.readFileSync(file, "utf8"), source, `${label} was modified on disk — every control here is in-memory only`);

  const missed = results.filter((result) => result.status === "MISSED");
  assert.strictEqual(broken, 0, `${broken} control(s) never reached their defect; a syntax or import failure is not a receipt`);
  assert.strictEqual(missed.length, 0, `${missed.length} defect(s) were reintroduced and nothing caught them: ${missed.map((result) => result.id).join(", ")}`);

  console.log(`\nFounder smoke P0 negative controls passed: ${results.length} defects reintroduced, ${results.length} caught, every one with a live-defect receipt. Nothing was written to disk and nothing was reverted with git. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
