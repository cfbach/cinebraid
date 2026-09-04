/* NEGATIVE CONTROLS FOR THE PRODUCTION TRUTH CLEANUP.
 *
 * A green suite proves nothing unless the defect it describes would turn it red.
 * Each control below REINTRODUCES one of the three defects into the real shipped
 * source, runs the guarantee that is supposed to catch it, and requires that
 * guarantee to fail FOR ITS OWN REASON.
 *
 * THREE PHASES, and the middle one is why this file exists in this shape. A
 * control that fails during setup — a needle that no longer matches after an
 * unrelated edit — is a SETUP FAILURE, and counting it as a detection is how a
 * suite comes to certify a property nobody is checking any more.
 *
 *   0  the guard must PASS against the SHIPPED source, or a later "detection" is
 *      a detection of something that was already broken.
 *   1  ARM. The exact mutation is applied to the real source and proved to have
 *      changed it, and the mutated text is proved to have REACHED the code under
 *      test.
 *   2  DETECT. The failure counts only if it is an AssertionError whose message
 *      matches the reason this control exists to produce.
 *
 * N12/N13 and N14 are the correction controls: they restore the fabricated empty
 * authority projection and the sum-of-not-declared-sentinels aggregate, which is
 * how the two blocked reproductions are held rather than described.
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Page scripts go
 * through render()'s `mutateSource` hook; the server's import writer is lifted by
 * exact source into a vm; every file touched is re-read at the end and required
 * to be byte-identical.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const SERVER = path.join(ROOT, "server.js");
const { render, rawFixture, buildFixture, withCanon } = require("./render-harness");

const PAGE_FILES = ["library-tools.js", "entities.js", "media-results.js", "automation.js", "app.js", "shared-bible-canon.js", "mutations.js"];
const TOUCHED = [SERVER, ...PAGE_FILES.map((name) => path.join(PUBLIC, name))];
const ORIGINAL = new Map(TOUCHED.map((file) => [file, fs.readFileSync(file, "utf8")]));

/* Line endings normalised before matching: this repository is checked out CRLF
   and the needles below are written LF. Nothing is written back, so this cannot
   change a byte on disk. */
function applyMutation(source, control) {
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

/* ==========================================================================
   THE SERVER LIFT.

   The import writer, taken by exact source into a vm with the three helpers it
   legitimately uses stubbed. `builderNumber` and `builderDuration` come from the
   real file — they are what is under test — and so does the whole clip
   normaliser, so a control that changes either is changing the thing the guard
   runs. Nothing here reaches a filesystem, a port or a project.
   ========================================================================== */
function builderClipNormalizer(source) {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  const slice = (from, to) => {
    const start = source.indexOf(from);
    assert(start >= 0, `the lift could not find ${JSON.stringify(from)} in server.js`);
    const end = source.indexOf(to, start);
    assert(end > start, `the lift could not find ${JSON.stringify(to)} after it`);
    return source.slice(start, end);
  };
  const numbers = slice("function builderNumber(", "function builderLabel(");
  const clips = slice("function normalizeBuilderClips(", "\nfunction normalizeBuilderShot(");
  vm.runInContext(
    `function builderArray(v){return Array.isArray(v)?v:[];}`
    + `function builderObject(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}`
    + `function builderLabel(i){return String.fromCharCode(65+Number(i||0));}`
    + `function normalizeBuilderMotionBrief(){return {};}\n`
    + `${numbers}\n${clips}\n`
    + `this.normalizeBuilderClips = normalizeBuilderClips;`,
    context,
  );
  return context.normalizeBuilderClips;
}

/* The guard both server controls share: an unstated motion-unit duration must
   arrive as an explicit unknown, and a stated one must arrive as its number. */
function importDurationGuard(normalizeBuilderClips) {
  const warnings = [];
  const clips = normalizeBuilderClips(
    { id: "S-01", clips: [{ id: "seg-a", kind: "i2v", dur: 4 }, { id: "seg-b", kind: "i2v" }] },
    [{ id: "frame-a" }],
    warnings,
  );
  assert.strictEqual(clips[0].dur, 4, "a stated motion-unit duration must survive import as its number");
  assert.strictEqual(clips[1].dur, null,
    `an unstated duration was imported as ${JSON.stringify(clips[1].dur)} rather than as an explicit unknown`);
}

/* ==========================================================================
   THE PT1 SUBJECT — the same fixture the focused suite uses.
   ========================================================================== */
const PT1_SCAN = {
  anchors: [
    { name: "KAI-ANCHOR.png", url: "/assets/anchors/KAI-ANCHOR.png" },
    { name: "KAI-OPENED.png", url: "/assets/anchors/KAI-OPENED.png" },
  ],
  plates: [], props: [], vehicles: [], audio: [], media: [], shots: {},
};
function pt1Project() {
  const project = rawFixture();
  const kai = project.characters[0];
  kai.approvedFile = "KAI-ANCHOR.png";
  kai.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    { id: "state-opened", name: "Opened", parentStateId: "state-default", approvedFile: "KAI-OPENED.png" },
  ];
  kai.candidateFiles = [
    { stored: "KAI-ANCHOR.png", original: "KAI-ANCHOR.png", decision: "unreviewed", coverageJobType: "single-reference" },
    { stored: "KAI-OPENED.png", original: "KAI-OPENED.png", decision: "unreviewed", coverageJobType: "single-reference" },
  ];
  return withCanon(project, [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  ]);
}
/* PT1-C1's subject: the same entity with BOTH states receipt-backed, so an
   unreadable projection cannot be mistaken for a true absence. */
function pt1CanonProject() {
  const project = pt1Project();
  return withCanon(project, [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-opened", value: "KAI-OPENED.png" },
  ]);
}
/* Opens the approval modal with the authority PROJECTION withdrawn and the truth
   READER left in place — the state the blocked candidate answered from fabricated
   empty collections. */
async function pt1UnavailableOption(run) {
  const app = await run({ hash: "#/character/KAI", project: pt1CanonProject(), scan: PT1_SCAN });
  vm.runInContext("globalThis.entityProductionTruth = undefined; entityProductionTruth = undefined;", app.context);
  app.context.approveEntityFile("characters", "KAI", "KAI-ANCHOR.png", "state-default");
  const select = vm.runInContext(
    "(() => { const el = document.getElementById('entity-approve-next'); return el ? el.innerHTML : ''; })()",
    app.context,
  );
  const option = select.match(/<option value="state-opened">([^<]*)<\/option>/);
  assert(option, "the continuation option must render");
  return option[1];
}

/* ==========================================================================
   THE PT2a SUBJECT — the real projection, the real card renderer.
   ========================================================================== */
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function publicRequire(specifier) {
  return require(specifier.startsWith("./") ? path.join(PUBLIC, specifier.slice(2)) : specifier);
}
function loadProjection() {
  const context = vm.createContext({ module: { exports: {} }, require: publicRequire, console });
  context.globalThis = context;
  vm.runInContext(ORIGINAL.get(path.join(PUBLIC, "shared-production-media.js")) || fs.readFileSync(path.join(PUBLIC, "shared-production-media.js"), "utf8"), context);
  return context.module.exports;
}
function loadResults(PM, source) {
  const context = vm.createContext({ console, esc, attr: esc, plural: (n, w) => `${n} ${w}${n === 1 ? "" : "s"}` });
  context.window = context;
  context.globalThis = context;
  Object.assign(context, PM);
  vm.runInContext(source, context, { filename: "media-results.js" });
  return context.window.CineBraidResults;
}
const PT2_ISO = (day) => `2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`;
function pt2Built(PM) {
  const project = {
    meta: { title: "PT2" },
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC01", title: "Hull" }],
    shots: [{
      id: "SH010", scene: "SC01", title: "Hull check",
      keyframes: [{ id: "kf-a", label: "A", winner: "" }], clips: [],
      candidateFiles: [
        { stored: "PASSING.png", addedAt: PT2_ISO(1), decision: "unreviewed", aiReview: { score: 91, pass: true, reviewedAt: PT2_ISO(1) } },
        { stored: "FLAGGED.png", addedAt: PT2_ISO(2), decision: "unreviewed", aiReview: { score: 62, pass: false, reviewedAt: PT2_ISO(2) } },
      ],
    }],
  };
  const scan = {
    anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { SH010: { takes: ["PASSING.png", "FLAGGED.png"].map((name) => ({ name, url: `/assets/shots/SH010/takes/${name}` })), blocking: [], locked: [] } },
  };
  return PM.productionMediaRecords({ project, scan, jobs: [] });
}

/* ==========================================================================
   THE PT2b SUBJECT — a gate reached by exhausting the authorized rounds with
   nothing passing, which is the arm where `winner` is a flagged candidate.
   ========================================================================== */
const FLAGGED_GATE_RUN = `
  AUTOMATION_RUNS=[{id:'run-gate',revision:1,type:'shot-chain',targetId:'L1-01',scope:'stills',status:'awaiting-review',
    stage:'Approve Frame B',createdAt:'2026-08-17T10:00:00Z',config:{frameRounds:2,maxImages:9},usage:{imagesGenerated:4},
    current:{stepKey:'frame:frame-b:round-2:review'},
    steps:{'frame:frame-b:round-2:review':{key:'frame:frame-b:round-2:review',status:'needs-review',kind:'frame-review',
      label:'Frame B review',frameId:'frame-b',attempt:2,maxAttempts:2,winner:'FRAME_B.png',score:79,
      files:['FRAME_A.png','FRAME_B.png'],
      review:{reviews:[{n:1,pass:false,score:55,notes:'Identity drift.'},{n:2,pass:false,score:79,notes:'Endpoint option.'}]},
      result:{autoApprove:false,threshold:85}}},logs:[]}];`;

/* ==========================================================================
   THE PT3c SUBJECT — a production with two shots nobody has timed.
   ========================================================================== */
function untimedShot(id, title) {
  return {
    id, scene: "SC-01", title, desc: "", positioning: "", route: "GENERATE",
    codes: [], characters: [], risks: [], notes: "", winner: null, dur: null,
    keyframes: [], clips: [], candidateFiles: [], stageApprovals: {}, generationPackages: [],
  };
}
function untimedProject() {
  const project = rawFixture();
  project.shots.push(untimedShot("L1-02", "Untimed A"));
  project.shots.push(untimedShot("L1-03", "Untimed B"));
  return project;
}

/* ==========================================================================
   THE CONTROLS.
   ========================================================================== */
const CONTROLS = [
  /* ---- PT1 · the approval surface -------------------------------------- */
  {
    id: "N1",
    title: "the continuation wording goes back to reading the assigned file",
    target: { file: "library-tools.js" },
    from: `    const continuationTruth = typeof entityStateTruth === "function" ? entityStateTruth(current.list, x) : null;`,
    to: `    const continuationTruth = null;`,
    expect: /an assigned file with no receipt was called currently approved|approval state unavailable/,
    async guard(run) {
      const app = await run({ hash: "#/character/KAI", project: pt1Project(), scan: PT1_SCAN });
      app.context.approveEntityFile("characters", "KAI", "KAI-ANCHOR.png", "state-default");
      const select = vm.runInContext(
        "(() => { const el = document.getElementById('entity-approve-next'); return el ? el.innerHTML : ''; })()",
        app.context,
      );
      assert(select, "the continuation dropdown must render");
      const option = select.match(/<option value="state-opened">([^<]*)<\/option>/);
      assert(option, "the historic state must be offered");
      assert(/historic, not approved/.test(option[1]),
        `an assigned file with no receipt was called currently approved: ${option[1]}`);
    },
  },
  {
    id: "N2",
    title: "the modal reads approvedFile again instead of the projection",
    target: { file: "library-tools.js" },
    from: `      if (standing === "canon") return " · currently approved";\n      if (standing === "historic") return " · historic, not approved";`,
    to: `      if (item.approvedFile) return " · currently approved";\n      if (standing === "historic") return " · historic, not approved";`,
    expect: /an assigned file with no receipt was called currently approved/,
    async guard(run) {
      const app = await run({ hash: "#/character/KAI", project: pt1Project(), scan: PT1_SCAN });
      app.context.approveEntityFile("characters", "KAI", "KAI-ANCHOR.png", "state-default");
      const select = vm.runInContext(
        "(() => { const el = document.getElementById('entity-approve-next'); return el ? el.innerHTML : ''; })()",
        app.context,
      );
      const option = select.match(/<option value="state-opened">([^<]*)<\/option>/);
      assert(option, "the historic state must be offered");
      assert(!/currently approved/.test(option[1]),
        `an assigned file with no receipt was called currently approved: ${option[1]}`);
    },
  },

  /* ---- PT1-C1 · an unavailable projection is not an empty one ----------- */
  {
    id: "N12",
    title: "entityStateTruth fabricates empty collections again",
    target: { file: "entities.js" },
    from: `  const available = typeof entityProductionTruth === "function";
  const truth = available ? entityProductionTruth(P, list, entity && entity.id) : null;`,
    to: `  const available = true;
  const truth = typeof entityProductionTruth === "function"
    ? entityProductionTruth(P, list, entity && entity.id)
    : { canon: [], references: [], historic: [] };`,
    expect: /an unreadable authority projection was answered as an absence of approval truth/,
    async guard(run) {
      const wording = await pt1UnavailableOption(run);
      assert(/approval state unavailable/.test(wording),
        `an unreadable authority projection was answered as an absence of approval truth: ${wording}`);
    },
  },
  {
    id: "N13",
    title: "the approval modal falls through an unrecognised standing to needs-reference",
    target: { file: "library-tools.js" },
    /* The other half of the same claim: even with the seam honest, the modal must
       not reach its last line from a standing it does not recognise. */
    mutations: [
      { from: `      if (!continuationTruth || continuationTruth.available === false) return " · approval state unavailable";`,
        to: `      if (!continuationTruth) return " · approval state unavailable";` },
      { from: `      if (standing !== "missing") return " · approval state unavailable";
`, to: `` },
    ],
    expect: /an unreadable authority projection was answered as an absence of approval truth/,
    async guard(run) {
      const wording = await pt1UnavailableOption(run);
      assert(/approval state unavailable/.test(wording),
        `an unreadable authority projection was answered as an absence of approval truth: ${wording}`);
    },
  },

  /* ---- PT2a · Generated Media ------------------------------------------ */
  {
    id: "N3",
    title: "the AI chip goes back to testing whether a review exists",
    target: { file: "media-results.js" },
    from: `    const recommendationValue = row.aiRecommendation.state === "known" ? String(row.aiRecommendation.value || "") : "";`,
    to: `    const recommendationValue = row.aiRecommendation.state === "known" ? "approve" : "";`,
    expect: /a FLAG was shown as an affirmative suggestion/,
    guard(run) {
      const { PM, source } = run();
      const Results = loadResults(PM, source);
      const built = pt2Built(PM);
      const card = (name) => Results.cardMarkup(built.records.find((row) => row.file.name === name));
      /* The control case first: the affirmative chip must still be reachable, or
         this control could pass by having removed the chip entirely. */
      assert(/AI SUGGESTED/.test(card("PASSING.png")), "a passing review must still be shown as a suggestion");
      assert(!/AI SUGGESTED/.test(card("FLAGGED.png")), "a FLAG was shown as an affirmative suggestion");
    },
  },

  /* ---- PT2b · the automation human-review gate -------------------------- */
  {
    id: "N4",
    title: "the gate suggests a flagged winner again",
    target: { file: "automation.js" },
    from: `  if (candidate.pass !== true) return false;`,
    to: `  /* control: a flagged winner is the suggestion again */`,
    expect: /a FLAG was offered under affirmative approval wording/,
    async guard(run) {
      const app = await run({ hash: "#/shot/L1-01" });
      vm.runInContext(FLAGGED_GATE_RUN, app.context);
      const html = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
      assert(/HUMAN REVIEW GATE/.test(html), "the gate must render");
      assert(!/APPROVE SUGGESTED/.test(html), "a FLAG was offered under affirmative approval wording");
    },
  },
  {
    id: "N5",
    title: "the gate header claims a suggestion it does not have",
    target: { file: "automation.js" },
    from: `  const headerNote = !anySuggested\n    ? correctionGate`,
    to: `  const headerNote = correctionGate && !anySuggested\n    ? correctionGate`,
    expect: /the header claimed a suggestion the gate does not have/,
    async guard(run) {
      const app = await run({ hash: "#/shot/L1-01" });
      vm.runInContext(FLAGGED_GATE_RUN, app.context);
      const html = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
      assert(/HUMAN REVIEW GATE/.test(html), "the gate must render");
      assert(!/\/100 suggested/.test(html), "the header claimed a suggestion the gate does not have");
    },
  },

  /* ---- PT3 · the duration representation -------------------------------- */
  {
    id: "N6",
    title: "the importer's unknown duration collapses back to zero",
    target: { server: true },
    from: `  return Number.isFinite(number) && number > 0 ? number : null;\n}`,
    to: `  return Number.isFinite(number) && number > 0 ? number : 0;\n}`,
    expect: /an unstated duration was imported as 0 rather than as an explicit unknown/,
    guard(run) { importDurationGuard(run()); },
  },
  {
    id: "N7",
    title: "the clip normaliser goes back to the numeric writer",
    target: { server: true },
    /* The clip site is the first of the two `dur:` intake lines in the file, and
       applyMutation replaces the first match — which is the one this guard runs. */
    from: `      dur: builderDuration(source.dur),`,
    to: `      dur: builderNumber(source.dur),`,
    expect: /an unstated duration was imported as 0 rather than as an explicit unknown/,
    guard(run) { importDurationGuard(run()); },
  },
  {
    id: "N8",
    title: "a new shot is created with a zero-second duration again",
    target: { file: "mutations.js" },
    from: `      dur: null,\n      continuityStateSelections: {},`,
    to: `      dur: 0,\n      continuityStateSelections: {},`,
    expect: /a new shot was stored with a zero-second duration/,
    async guard(run) {
      const app = await run({ hash: "#/shots/board" });
      app.context.addShot("SC-01");
      vm.runInContext(`(() => {
        const scene = document.getElementById("ff-scene"); if (scene) scene.value = "SC-01";
        const title = document.getElementById("ff-title"); if (title) title.value = "Untimed";
      })()`, app.context);
      app.context._formSubmit();
      const stored = vm.runInContext("JSON.stringify(P.shots[P.shots.length - 1].dur)", app.context);
      assert.strictEqual(stored, "null", `a new shot was stored with a zero-second duration: ${stored}`);
    },
  },
  {
    id: "N9",
    title: "the runtime total stops saying what it could not count",
    target: { file: "app.js" },
    from: `const unplannedRuntimeNote = (runtime) =>\n  runtime.unknown`,
    to: `const unplannedRuntimeNote = (runtime) =>\n  false`,
    expect: /a runtime total covering untimed shots did not say so/,
    async guard(run) {
      const app = await run({ hash: "#/shots/board", project: untimedProject() });
      const bar = vm.runInContext("runtimeBar(P.shots, null)", app.context);
      assert(/planned/.test(bar), "the runtime label must render");
      assert(/2 shots not yet timed/.test(bar), `a runtime total covering untimed shots did not say so: ${bar}`);
    },
  },
  {
    id: "N10",
    title: "the runtime total counts an untimed shot as a real zero",
    target: { file: "app.js" },
    /* The other half of the same claim, and the one a reader is most likely to
       reintroduce: summing every shot at face value produces the identical
       number, so only the count of what was skipped can tell them apart. */
    from: `const plannedRuntimeOf = (shots) =>\n  (typeof plannedRuntime === "function"`,
    to: `const plannedRuntimeOf = (shots) =>\n  (false`,
    expect: /an untimed shot was counted as a timed one/,
    async guard(run) {
      const app = await run({ hash: "#/shots/board", project: untimedProject() });
      const runtime = JSON.parse(vm.runInContext("JSON.stringify(plannedRuntimeOf(P.shots))", app.context));
      assert.strictEqual(runtime.unknown, 2,
        `an untimed shot was counted as a timed one: ${JSON.stringify(runtime)}`);
    },
  },
  {
    id: "N14",
    title: "the Bible shot aggregate sums the not-declared sentinel as a second",
    target: { file: "shared-bible-canon.js" },
    /* ASTRA'S REPRODUCTION, RESTORED. `[6, null]` projects as `[6, 0]`; summing
       that at face value publishes `6s` for a shot with one untimed unit. */
    from: `      const untimed = motions.filter((m) => m.durDeclared !== true);
      const seconds = motions.reduce((total, m) => total + (m.durDeclared === true ? m.dur : 0), 0);`,
    to: `      const untimed = [];
      const seconds = motions.reduce((total, m) => total + m.dur, 0);`,
    expect: /a partly timed shot was published as a complete duration/,
    guard(run) {
      const BibleCanon = run();
      const doc = BibleCanon.bibleCanonProjection({
        meta: { title: "Duration", models: [] },
        characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
        scenes: [{ id: "Cold open", title: "Cold open" }],
        shots: [{
          id: "S-01", scene: "Cold open", title: "Hull check", status: "LOCKED", workflowStatus: "APPROVED",
          dur: null, keyframes: [],
          clips: [
            { id: "seg-a", suffix: "a", label: "A", title: "Timed", kind: "i2v", dur: 6 },
            { id: "seg-b", suffix: "b", label: "B", title: "Untimed", kind: "i2v", dur: null },
          ],
          candidateFiles: [], promptBuilds: [], generationPackages: [], creationBrief: {},
        }],
        productionAuthority: { version: 1, receipts: [] },
      }, { media: {}, shotMedia: () => [], modelName: () => "" });
      const heading = BibleCanon.bibleCanonMarkdown(doc, { preset: "canon" })
        .split(/\r?\n/).find((line) => line.startsWith("Cold open")) || "";
      assert(heading, "the shot heading must be exported");
      const facts = heading.split(" · ").map((part) => part.trim());
      assert(!facts.includes("6s"),
        `a partly timed shot was published as a complete duration: ${heading}`);
    },
  },
  {
    id: "N11",
    title: "the Bible export prints an untimed motion unit as zero seconds",
    target: { file: "shared-bible-canon.js" },
    from: "`**Motion ${motion.label} — ${motion.title}** · ${motion.from || \"?\"}${motion.to ? ` → ${motion.to}` : \"\"} · ${motion.dur ? `${motion.dur}s` : \"duration not planned\"}`",
    to: "`**Motion ${motion.label} — ${motion.title}** · ${motion.from || \"?\"}${motion.to ? ` → ${motion.to}` : \"\"} · ${motion.dur}s`",
    expect: /an untimed motion unit was exported as a zero-second one/,
    guard(run) {
      const BibleCanon = run();
      const doc = BibleCanon.bibleCanonProjection({
        meta: { title: "Duration", models: [] },
        characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
        scenes: [{ id: "SC-01", title: "Cold open" }],
        shots: [{
          id: "S-01", scene: "SC-01", title: "Hull check", status: "LOCKED", workflowStatus: "APPROVED", dur: null,
          keyframes: [],
          clips: [{ id: "seg-b", suffix: "b", label: "B", title: "Untimed unit", kind: "i2v", dur: null }],
          candidateFiles: [], promptBuilds: [], generationPackages: [], creationBrief: {},
        }],
        productionAuthority: { version: 1, receipts: [] },
      }, { media: {}, shotMedia: () => [], modelName: () => "" });
      const line = BibleCanon.bibleCanonMarkdown(doc, { preset: "canon" })
        .split(/\r?\n/).find((row) => /^\*\*Motion /.test(row)) || "";
      assert(line, "the motion line must be exported");
      assert(!/0s/.test(line), `an untimed motion unit was exported as a zero-second one: ${line}`);
    },
  },
];

/* ==========================================================================
   PHASE 1 — ARM.
   ========================================================================== */
function compileModule(source, filename) {
  const Module = require("module");
  const compiled = new Module(filename, null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

function arm(control, mutated) {
  if (control.target.server) {
    const source = mutated ? applyMutation(ORIGINAL.get(SERVER), control) : ORIGINAL.get(SERVER);
    const state = { applied: !mutated };
    return { state, run: () => { state.applied = true; return builderClipNormalizer(source); } };
  }
  const file = control.target.file;
  const full = path.join(PUBLIC, file);
  const source = mutated ? applyMutation(ORIGINAL.get(full), control) : ORIGINAL.get(full).replace(/\r\n/g, "\n");
  const state = { applied: !mutated };

  /* Two files here are MODULES rather than page scripts render() loads, so they
     are compiled from the mutated text instead. Their guards receive the built
     subject directly. */
  if (file === "media-results.js") {
    return { state, run: () => { state.applied = true; return { PM: loadProjection(), source }; } };
  }
  if (file === "shared-bible-canon.js") {
    return { state, run: () => { state.applied = true; return compileModule(source, full); } };
  }

  const run = (options = {}) => {
    const { project, hash, ...rest } = options;
    const renderOptions = { ...rest };
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
    /* PHASE 0 — the guard must PASS against the SHIPPED source. */
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

  for (const file of TOUCHED) {
    assert.strictEqual(fs.readFileSync(file, "utf8"), ORIGINAL.get(file),
      `${path.relative(ROOT, file)} was modified on disk — every control here is in-memory only`);
  }

  console.log(`\n  armed ${armedCount}/${CONTROLS.length}   caught ${caught}   broken/not-armed ${broken}   missed ${missed}`);
  assert.strictEqual(broken, 0, `${broken} control(s) did not arm, or detected for a reason other than their own — a setup failure is not a receipt`);
  assert.strictEqual(missed, 0, `${missed} defect(s) were reintroduced and nothing caught them: ${results.filter((row) => row.status === "MISSED").map((row) => row.id).join(", ")}`);
  assert.strictEqual(armedCount, CONTROLS.length, "every control must arm");
  assert.strictEqual(caught, CONTROLS.length, "every armed control must be caught for its own reason");

  console.log(`\nProduction truth cleanup negative controls passed: ${CONTROLS.length} defects armed against live production source, ${caught} caught for their own stated reason, 0 broken, 0 missed. Nothing was written to disk and nothing was reverted with git. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
