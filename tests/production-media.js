/* O5 -- the shared production-media projection, the Generated Media destination, and
 * the Universal Media Inspector.
 *
 * THE STATEMENT THIS SUITE EXISTS TO MAKE TRUE, in one line: a filmmaker can find every
 * piece of production media from one destination, and what they are told about any of it
 * -- approved, recommended, reviewed, decided, paid for, authority for -- comes from the
 * record that owns that fact and is never invented.
 *
 * WHAT WAS ACTUALLY THE RISK. O5 puts ONE surface in front of five media populations
 * that were previously described by five separate grids. That creates four new ways to
 * lie, and each one is a section below:
 *
 *   1. COLLAPSING THE TWO IDENTITY DOMAINS. The MediaAsset ledger's `asset-...` and the
 *      project library's `media-...` are different things with different lifetimes, and a
 *      generic `assetId` field would let one resolve as the other.
 *   2. TURNING A RECOMMENDATION INTO AN APPROVAL. An AI that suggests approving and a
 *      human who approved are one CSS class apart if the projection reports one field.
 *   3. ANSWERING A QUESTION IT WAS NOT ASKED. A cost the browser could not load must not
 *      read as a cost nobody recorded, and a prompt that was never stored must not be
 *      backfilled from today's build.
 *   4. LOSING THE REJECTED. Approval already made media disappear once
 *      (public/shared-media-disposition.js's header); a browsing surface that hides
 *      rejected work would do it again in the other direction.
 *
 * WHAT THIS SUITE REFUSES TO DO. It does not assert a declared constant equals itself.
 * Every check drives the shipped projection over representative media, drives the
 * shipped renderers in a realm, or cross-reads a claim against the module that owns it --
 * public/shared-media-disposition.js for disposition, generation-cost.js for money.
 *
 * THE SHAPE, and why the checks are exported. Every section is a named function taking a
 * `deps` bundle -- the modules built FROM SOURCE in a realm, plus the source records.
 * tests/production-media-negative-controls.js rebuilds one module from mutated source
 * and requires the named check to fail. A suite whose checks cannot be handed a broken
 * build can only be controlled by editing files on disk, which is the mistake that once
 * discarded four unstaged repairs.
 *
 * WHAT IS PROVEN IN CHROMIUM INSTEAD: the live destination, real clicks, the Inspector
 * over a real modal, the responsive bands, theme integrity and the absence of horizontal
 * overflow. Those are statements about a live document and live in
 * tests/production-media-real-browser.py.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO REQUEST IS MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

/* CRLF is normalised on read: this repository checks out with core.autocrlf=true, so a
   multi-line anchor written with \n would match nothing and take its assertion's meaning
   with it. */
const readSource = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const SOURCES = {
  projection: readSource(path.join(PUBLIC, "shared-production-media.js")),
  inspector: readSource(path.join(PUBLIC, "media-inspector.js")),
  results: readSource(path.join(PUBLIC, "media-results.js")),
  disposition: readSource(path.join(PUBLIC, "shared-media-disposition.js")),
  stageSurfaces: readSource(path.join(PUBLIC, "stage-surfaces.js")),
  views: readSource(path.join(PUBLIC, "views.js")),
  markup: readSource(path.join(PUBLIC, "index.html")),
  styles: readSource(path.join(PUBLIC, "styles.css")),
  app: readSource(path.join(PUBLIC, "app.js")),
  shell: readSource(path.join(PUBLIC, "shared-workspace-shell.js")),
};

const P4 = require(path.join(PUBLIC, "shared-media-disposition.js"));
const Cost = require(path.join(ROOT, "generation-cost.js"));

const LEDGER = (seed) => `asset-${String(seed).repeat(32).slice(0, 32)}`;

/* 1D: the fixture establishes its approvals through the shipped writers, so it
   needs the same wiring the app has — the ownership resolver and a gesture
   source the test composition owns. See tests/authority-test-gesture.js. */
const Authority = require("../public/shared-production-authority");
const Ownership = require("../public/shared-entity-ownership");
const Kernel = require("../public/shared-authority-kernel");
Authority.useEntityOwnershipResolver(Ownership);
const MANUAL = require("./authority-test-gesture.js").installTestManualActionSource(Kernel);
const ISO = (day) => `2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`;

const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/* =========================================================================
   BUILDING THE MODULES FROM SOURCE.

   Each is evaluated in its own realm from the source RECORD rather than required, so a
   negative control can hand any check a build made from mutated text. The realm carries
   only the helpers the module legitimately uses -- a renderer reaching for anything else
   fails here rather than in a browser. */
/* The projection's UMD wrapper resolves its sibling with a RELATIVE require, which would
   otherwise resolve against tests/ and fail. The shim re-roots `./x` at public/ so the
   realm loads the same sibling the browser would. */
function publicRequire(specifier) {
  return require(specifier.startsWith("./") ? path.join(PUBLIC, specifier.slice(2)) : specifier);
}

function loadProjection(source) {
  const context = vm.createContext({ module: { exports: {} }, require: publicRequire, console });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "shared-production-media.js" });
  return context.module.exports;
}

function loadResults(sources, PM) {
  const context = vm.createContext({ console, esc, attr, plural: (n, w) => `${n} ${w}${n === 1 ? "" : "s"}` });
  context.window = context;
  context.globalThis = context;
  Object.assign(context, PM);
  vm.runInContext(sources.results, context, { filename: "media-results.js" });
  return context.window.CineBraidResults;
}

function loadInspector(sources, PM) {
  const context = vm.createContext({ console, esc, attr, document: { querySelector: () => null, getElementById: () => null } });
  context.window = context;
  context.globalThis = context;
  Object.assign(context, PM);
  vm.runInContext(sources.inspector, context, { filename: "media-inspector.js" });
  return context.window.CineBraidMediaInspector;
}

function build(sources = SOURCES) {
  const PM = loadProjection(sources.projection);
  return { sources, PM, Results: loadResults(sources, PM), Inspector: loadInspector(sources, PM) };
}

/* =========================================================================
   THE FIXTURE.
   One project carrying every case the projection has to distinguish. Built by a function
   rather than held as a constant so a check that mutates one cannot reach the next -- the
   projection writes nothing, and this is how that is proven rather than assumed. */
function fixture() {
  return {
    project: {
      characters: [{
        id: "KAI", name: "Kai", prefix: "KAI",
        approvedFile: "KAI_DEFAULT_V001.png",
        approvedAssetId: LEDGER("a"),
        continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "KAI_DEFAULT_V001.png", approvedAssetId: LEDGER("a") }],
        coverageSlots: [{ id: "front", label: "Front", approvedFile: "KAI_DEFAULT_V001.png" }],
        candidateFiles: [
          {
            stored: "KAI_DEFAULT_V001.png", addedAt: ISO(1), decision: "approved-reference",
            humanApproved: true, decidedAt: ISO(1),
            approvalProvenance: { source: "human", aiReviewed: true, aiPassed: true, approvedAt: ISO(1) },
            generationProvider: "fal", generationModel: "openai/gpt-image-2",
            generationJobId: "job-kai-1", generationRequestId: "req-kai-1",
            prompt: "Kai, front view.",
            structuredReviews: {
              "state-default": {
                contractVersion: "reference-authority-v3",
                reviewer: { provider: "openai", model: "gpt-5.2" },
                reviewedAt: ISO(1), pass: true, modelPass: true, score: 94, recommendation: "approve",
                summary: "Identity and state match.", semanticOutcome: "validated-strong",
                semanticLabel: "Declared state observed", semanticSatisfied: true,
                stateEvidence: { requirements: [{ label: "Jacket", expected: "worn", observed: "worn", outcome: "satisfied" }] },
                blockers: [],
              },
            },
          },
          {
            /* AI SAID APPROVE. NOBODY DID. */
            stored: "KAI_ALT_V002.png", addedAt: ISO(2), decision: "unreviewed",
            generationProvider: "fal", generationModel: "openai/gpt-image-2", generationJobId: "job-kai-2",
            prompt: "Kai, three-quarter.",
            structuredReviews: {
              "state-default": {
                contractVersion: "reference-authority-v3",
                reviewer: { provider: "openai", model: "gpt-5.2" },
                reviewedAt: ISO(2), pass: true, modelPass: true, score: 88, recommendation: "approve",
                summary: "Passes every check.", stateEvidence: { requirements: [] }, blockers: [],
              },
            },
          },
          { stored: "KAI_BAD_V003.png", addedAt: ISO(3), decision: "rejected", decidedAt: ISO(3) },
        ],
      }],
      /* APPROVED BY EDGE ONLY -- no candidate row exists at all. */
      props: [{
        id: "TOOL", name: "Panel tool", prefix: "TOOL",
        approvedFile: "TOOL_DEFAULT_V001.png",
        continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "TOOL_DEFAULT_V001.png" }],
        candidateFiles: [],
      }],
      locations: [], vehicles: [], audio: [],
      shots: [{
        id: "SH010", scene: "SC01", title: "Hull check",
        winner: "SH010_FRAME_A_V001.png",
        keyframes: [
          { id: "kf-a", label: "A", winner: "SH010_FRAME_A_V001.png", winnerAssetId: LEDGER("b") },
          { id: "kf-b", label: "B", winner: "SH010_FRAME_B_V001.png" },
        ],
        clips: [],
        candidateFiles: [
          {
            stored: "SH010_FRAME_A_V001.png", addedAt: ISO(4), decision: "shortlist",
            approvedAt: ISO(5), approvedTarget: "frame:kf-a", frameId: "kf-a",
            renamedFrom: ["SH010_FRAME_A_FAL_1.png"], sourceBuildId: "build-frame-a",
            generationProvider: "fal", generationModel: "openai/gpt-image-2", generationJobId: "job-frame-a",
            /* AI SAID CORRECT. THE HUMAN APPROVED ANYWAY. */
            aiReview: { score: 62, pass: false, notes: "Camera height drifts.", reviewedAt: ISO(4), strategy: "strict" },
          },
          {
            stored: "SH010_FRAME_B_V001.png", addedAt: ISO(4), decision: "shortlist",
            approvedAt: ISO(5), approvedTarget: "frame:kf-b", frameId: "kf-b",
            generationProvider: "fal", generationModel: "openai/gpt-image-2", generationJobId: "job-frame-b",
          },
          {
            stored: "SH010_MOTION_H3_1.mp4", addedAt: ISO(7), decision: "unreviewed",
            generationProvider: "fal", generationModel: "minimax/h3/image-to-video",
            generationJobId: "job-motion-1", generationProfileMode: "i2v",
          },
        ],
      }, {
        id: "SH020", scene: "SC01", title: "Panel close",
        keyframes: [{ id: "kf-a", label: "A", winner: "" }], clips: [],
        /* NAMES A JOB THE CALLER DOES NOT HOLD. */
        candidateFiles: [{ stored: "SH020_FRAME_A_FAL_1.png", addedAt: ISO(8), decision: "unreviewed", generationJobId: "job-vanished", generationProvider: "fal", generationModel: "openai/gpt-image-2" }],
      }],
      mediaAssets: [{
        id: "blocking-media-1", file: "SH010_BLOCKING_FAL_1.png",
        storagePath: "shots/SH010/blocking/SH010_BLOCKING_FAL_1.png",
        title: "SH010 blocking", kind: "image", createdAt: ISO(3),
        generationRecord: { provider: "fal", model: "openai/gpt-image-2", jobId: "job-blocking-1", requestId: "req-blocking-1", prompt: "Greyscale scaffold." },
        links: [{ id: "l1", targetType: "shot", targetId: "SH010", role: "blocking-frame", blockingFrameId: "kf-a" }],
      }, {
        id: "media-planning-1", file: "animatic-opening.png", title: "Animatic", kind: "image", createdAt: ISO(1),
        links: [{ id: "l2", targetType: "shot", targetId: "SH010", role: "animatic-frame" }],
      }],
    },
    scan: {
      anchors: [
        { name: "KAI_DEFAULT_V001.png", url: "/assets/anchors/KAI_DEFAULT_V001.png", assetId: LEDGER("a") },
        { name: "KAI_ALT_V002.png", url: "/assets/anchors/KAI_ALT_V002.png" },
        { name: "KAI_BAD_V003.png", url: "/assets/anchors/KAI_BAD_V003.png" },
      ],
      props: [{ name: "TOOL_DEFAULT_V001.png", url: "/assets/props/TOOL_DEFAULT_V001.png" }],
      plates: [], vehicles: [], audio: [],
      media: [{ name: "animatic-opening.png", url: "/assets/media/animatic-opening.png" }],
      shots: {
        SH010: {
          takes: [
            { name: "SH010_FRAME_A_V001.png", url: "/assets/shots/SH010/takes/SH010_FRAME_A_V001.png", assetId: LEDGER("b") },
            { name: "SH010_FRAME_B_V001.png", url: "/assets/shots/SH010/takes/SH010_FRAME_B_V001.png" },
            { name: "SH010_MOTION_H3_1.mp4", url: "/assets/shots/SH010/takes/SH010_MOTION_H3_1.mp4" },
          ],
          blocking: [{ name: "SH010_BLOCKING_FAL_1.png", url: "/assets/shots/SH010/blocking/SH010_BLOCKING_FAL_1.png", assetId: LEDGER("c") }],
          /* DELIVERY COPIES. Two of them, deliberately different from each other:
             the first shares the approved take's ledger identity (a straight copy, which
             deduplication would collapse even if it were enumerated), and the second is a
             re-encoded master with an identity OF ITS OWN. Only the second can prove the
             EXCLUSION rather than the dedup -- with one copy only, enumerating `locked`
             changes nothing and the exclusion is unfalsifiable. */
          locked: [
            { name: "SH010_FRAME_A_V001.png", url: "/assets/shots/SH010/locked/SH010_FRAME_A_V001.png", assetId: LEDGER("b") },
            { name: "SH010_DELIVERY_MASTER.mp4", url: "/assets/shots/SH010/locked/SH010_DELIVERY_MASTER.mp4", assetId: LEDGER("d") },
          ],
        },
        SH020: { takes: [{ name: "SH020_FRAME_A_FAL_1.png", url: "/assets/shots/SH020/takes/SH020_FRAME_A_FAL_1.png" }], blocking: [], locked: [] },
      },
    },
    jobs: [
      { id: "job-kai-1", provider: "fal", model: "openai/gpt-image-2", externalId: "req-kai-1", purpose: "entity-reference", status: "COMPLETED", createdAt: ISO(1), accounting: { estimate: { costClass: "metered_api", unit: "usd", confidence: "estimated", amount: 0.04 }, recordedAt: ISO(1), basis: {} }, outputs: [{ type: "entity-candidate", name: "KAI_DEFAULT_V001.png", url: "/assets/anchors/KAI_DEFAULT_V001.png", mediaAssetId: LEDGER("a") }] },
      { id: "job-kai-2", provider: "fal", model: "openai/gpt-image-2", purpose: "entity-reference", status: "COMPLETED", createdAt: ISO(2), accounting: { estimate: { costClass: "metered_api", unit: "usd", confidence: "estimated", amount: 0.02 }, recordedAt: ISO(2), basis: {} }, outputs: [] },
      { id: "job-frame-a", provider: "fal", model: "openai/gpt-image-2", purpose: "frame", status: "COMPLETED", createdAt: ISO(4), accounting: { estimate: { costClass: "metered_api", unit: "usd", confidence: "estimated", amount: 0.06 }, recordedAt: ISO(4), basis: {} }, outputs: [] },
      /* LEGACY: no accounting object at all. */
      { id: "job-frame-b", provider: "fal", model: "openai/gpt-image-2", purpose: "frame", status: "COMPLETED", createdAt: ISO(4), outputs: [] },
      /* METERED, HONESTLY UNPRICED. */
      { id: "job-motion-1", provider: "fal", model: "minimax/h3/image-to-video", purpose: "motion-h3", profileMode: "i2v", status: "COMPLETED", createdAt: ISO(7), accounting: { estimate: { costClass: "metered_api", unit: "usd", confidence: "unknown" }, recordedAt: ISO(7), basis: { unpricedReason: "no-per-image-rate-for-this-output" } }, outputs: [] },
      { id: "job-blocking-1", provider: "fal", model: "openai/gpt-image-2", externalId: "req-blocking-1", purpose: "blocking", status: "COMPLETED", createdAt: ISO(3), accounting: { estimate: { costClass: "metered_api", unit: "usd", confidence: "estimated", amount: 0.01 }, recordedAt: ISO(3), basis: {} }, outputs: [] },
    ],
  };
}

/* BATCH 1D — THE FIXTURE CARRIES A REAL AUTHORITY LEDGER NOW.
 *
 * The 1C acceptance audit's MB-1C-04: with `productionAuthority` absent, this
 * projection called every raw pointer `approved` and every one of them a human
 * decision. It does not any more — an approval requires a valid current
 * receipt — so a fixture that declares approvals must have the receipts a real
 * project would have. Otherwise this suite would be asserting the projection's
 * behaviour on a project state no creator can produce.
 *
 * The receipts are established through the SHIPPED writers, not hand-built, so
 * they are valid by construction and this fixture cannot drift away from what
 * the kernel accepts. A hand-written ledger would be a second implementation of
 * the receipt schema living in a test. */
function withAuthority(p) {
  const at = "2026-08-14T00:30:00.000Z";
  const grant = (target, value, assetId) => MANUAL.gesture(() => Authority.beginManualApproval({
    via: "production-media-fixture", targets: [{ ...target, value, assetId }],
  }));
  const approvals = [
    [{ kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default" }, "KAI_DEFAULT_V001.png", LEDGER("a")],
    [{ kind: "shot-frame", shotId: "SH010", frameId: "kf-a" }, "SH010_FRAME_A_V001.png", LEDGER("b")],
    [{ kind: "shot-frame", shotId: "SH010", frameId: "kf-b" }, "SH010_FRAME_B_V001.png", ""],
  ];
  for (const [target, value, assetId] of approvals) {
    const request = { ...target, value, assetId, at, manualAction: grant(target, value, assetId) };
    if (target.kind === "shot-frame") Authority.writeFrameProductionAuthority(p, request);
    else Authority.writeEntityStateProductionAuthority(p, request);
  }
  return p;
}

function project(PM, overrides = {}) {
  const f = fixture();
  return PM.productionMediaRecords({ project: withAuthority(f.project), scan: f.scan, jobs: f.jobs, ...overrides });
}
const byName = (built, name) => built.records.find((row) => row.file.name === name);
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* Arrays that came out of the vm realm carry THAT realm's Array.prototype, and
   assert.deepStrictEqual compares prototypes -- so a realm array fails against a host
   literal while printing identically, which is a genuinely maddening ten minutes.
   Everything compared structurally is re-rooted here first. */
const hostArray = (value) => Array.from(value || []);

/* =========================================================================
   1. THE POPULATION -- what is production media and what is not. */
function checkPopulation({ PM }) {
  const built = project(PM);
  const names = hostArray(built.records.map((row) => row.file.name)).sort();
  assert.deepStrictEqual(names, [
    "KAI_ALT_V002.png", "KAI_BAD_V003.png", "KAI_DEFAULT_V001.png",
    "SH010_BLOCKING_FAL_1.png", "SH010_FRAME_A_V001.png", "SH010_FRAME_B_V001.png",
    "SH010_MOTION_H3_1.mp4", "SH020_FRAME_A_FAL_1.png", "TOOL_DEFAULT_V001.png",
    "animatic-opening.png",
  ], "the projection must surface exactly the declared production-media population");

  /* THE LOCKED COPY IS THE POINT. It carries the SAME ledger identity as the approved
     take, so a projection that enumerated it would either show one result twice or --
     worse -- collapse the two and report the delivery path as the approved media's
     location. It is excluded by declaration, and the declaration says why. */
  assert.strictEqual(built.records.filter((row) => row.identity.path.includes("/locked/")).length, 0,
    "locked delivery copies must not appear as separate production results");
  assert(PM.PRODUCTION_MEDIA_EXCLUDED["shot-locked"]?.why,
    "the locked exclusion must stay declared with its reason");

  const kinds = hostArray(new Set(built.records.map((row) => row.kind))).sort();
  assert.deepStrictEqual(kinds, ["entity-reference", "project-media", "shot-blocking", "shot-motion", "shot-still"],
    "every declared media kind must be represented by the fixture and produced by the projection");
  for (const kind of kinds) assert(PM.PRODUCTION_MEDIA_KINDS.includes(kind), `${kind} must be a declared kind`);
  return `population: ${built.records.length} records across ${kinds.length} kinds, locked copies excluded`;
}

/* =========================================================================
   2. IDENTITY -- two domains, never collapsed, resolved by the existing rule. */
function checkIdentity({ PM }) {
  const built = project(PM);

  /* THE FIELD THAT MUST NOT EXIST. A generic `assetId` on the record would be exactly
     the collision public/shared-media-disposition.js's header was written to prevent. */
  for (const row of built.records) {
    assert(!("assetId" in row), `${row.file.name}: the record must not carry a generic assetId that flattens the two domains`);
    assert(row.identity.ledger && row.identity.library, "both identity domains must be reported, separately");
    assert(PM.PRODUCTION_MEDIA_RESOLUTIONS.includes(row.identity.resolvedBy), "resolvedBy must name a declared resolution");
  }

  const blocking = byName(built, "SH010_BLOCKING_FAL_1.png");
  assert.strictEqual(blocking.identity.ledger.state, "known", "a blocking frame indexed by the ledger has a ledger identity");
  assert.strictEqual(blocking.identity.ledger.value, LEDGER("c"));
  assert.strictEqual(blocking.identity.library.state, "known", "...and it is ALSO a project library row");
  assert.strictEqual(blocking.identity.library.value, "blocking-media-1");
  assert.notStrictEqual(blocking.identity.ledger.value, blocking.identity.library.value,
    "the two identities are different values and must stay distinguishable");
  assert.strictEqual(blocking.identity.resolvedBy, "ledger", "identity resolves ledger-first");

  const noLedger = byName(built, "KAI_ALT_V002.png");
  assert.strictEqual(noLedger.identity.ledger.state, "not-recorded", "absence of ledger identity is legal");
  assert.strictEqual(noLedger.identity.library.state, "not-applicable", "a file with no library row says so, rather than reporting an empty id");
  assert.strictEqual(noLedger.identity.resolvedBy, "path", "...and it falls back to the stored path");

  /* A LIBRARY ID MUST NEVER BE ACCEPTED AS A LEDGER ID. Handing the hand-off a library
     row's id must not produce a ledger key -- that is the cross-domain shortcut the
     whole identity section exists to forbid. */
  const crossed = PM.productionMediaKeyForFile({ url: "/assets/shots/SH010/blocking/SH010_BLOCKING_FAL_1.png", assetId: "blocking-media-1" });
  assert(!crossed.startsWith("asset:"), "a project-library id must never be treated as a ledger identity");
  assert.strictEqual(crossed, "path:shots/SH010/blocking/SH010_BLOCKING_FAL_1.png",
    "...it must fall back to the stored path instead");

  /* THE KEY IS NEVER A BARE FILENAME. That is the false-linkage class C1 removed from
     the indexer, and a browsing surface keyed on basenames would put it straight back:
     two shots can hold same-named takes. */
  for (const row of built.records) {
    assert(/^(asset:|path:)/.test(row.key), `${row.file.name}: a projection key must name its domain`);
    if (row.key.startsWith("path:"))
      assert(row.key.includes("/"), `${row.file.name}: a path key must be directory-scoped, not a bare filename`);
  }
  assert.strictEqual(byName(built, "SH010_FRAME_A_V001.png").key, `asset:${LEDGER("b")}`,
    "media the ledger knows is keyed by durable identity, so a rename cannot change its key");

  /* THE HAND-OFF PRODUCES THE SAME KEY. If it did not, every wired thumbnail would open
     the wrong record or none. */
  for (const row of built.records) {
    const viaFile = PM.productionMediaKeyForFile({ url: row.file.url, assetId: row.identity.ledger.value });
    assert.strictEqual(viaFile, row.key, `${row.file.name}: productionMediaKeyForFile must agree with the record's own key`);
  }
  return "identity: ledger and library reported separately, ledger-first, no cross-domain acceptance, keys never bare filenames";
}

/* =========================================================================
   3. DISPOSITION comes from P4 and from nowhere else. */
function checkDisposition({ PM }) {
  const built = project(PM);
  const f = fixture();

  assert.strictEqual(byName(built, "KAI_DEFAULT_V001.png").disposition.role, "approved");
  assert.strictEqual(byName(built, "KAI_ALT_V002.png").disposition.role, "candidate");
  assert.strictEqual(byName(built, "KAI_BAD_V003.png").disposition.role, "rejected");
  assert.strictEqual(byName(built, "SH010_FRAME_A_V001.png").disposition.role, "approved");
  assert.strictEqual(byName(built, "SH010_MOTION_H3_1.mp4").disposition.role, "candidate");

  /* CROSS-READ AGAINST THE OWNER. The projection must agree with the shipped resolver
     run independently -- not merely be internally consistent. */
  const entityPartition = P4.partitionEntityMedia(f.project.characters[0], f.scan.anchors);
  for (const group of ["approved", "candidates", "rejected"]) {
    const expected = group === "candidates" ? "candidate" : group.replace(/s$/, "");
    for (const entry of entityPartition[group])
      assert.strictEqual(byName(built, entry.name).disposition.role, expected,
        `${entry.name}: the projection must report what partitionEntityMedia decided`);
  }
  const shotPartition = P4.partitionShotMedia(f.project.shots[0], f.scan.shots.SH010.takes);
  for (const entry of shotPartition.approved)
    assert.strictEqual(byName(built, entry.name).disposition.role, "approved",
      `${entry.name}: the projection must report what partitionShotMedia decided`);

  /* CHANGED IN BATCH 1D — AND THE PROP IS THE CLEAREST CASE OF THE WHOLE FIX.

     OLD EXPECTATION: the prop's approval exists ONLY as an edge — no candidate
     row, no provenance, no receipt — and the projection called it `approved`
     with `humanDecision: "approved"`. The comment above it read "a projection
     that read disposition off the row would call it a candidate", and it was
     right that the row is the wrong place to look. The edge is the wrong place
     too.

     WHY IT IS NO LONGER VALID: an edge with nothing behind it is exactly the
     legacy pointer MB-1C-04 is about. This one cannot even be attributed — the
     project cannot say who chose it or when. Calling that a human decision is
     the claim 1D-04 removes.

     IT IS ALSO NOT APPROVABLE, and that is not an accident: PR-TOOL has no
     candidate row, so it does not durably own the file, and 1D-03 makes
     ownership a mandatory rule of the entity-state target kind. The fixture
     therefore CANNOT establish a receipt here even by going through the real
     writer, which is the rule working rather than a gap.

     THE NEW INVARIANT: the edge is still surfaced, still enumerated, still
     described — as a historic selection nobody has approved. */
  const prop = byName(built, "TOOL_DEFAULT_V001.png");
  assert.strictEqual(prop.disposition.role, "historic", "an edge with no receipt behind it is a historic selection");
  assert.strictEqual(prop.disposition.authority.claimed, true, "the edge is still reported — the evidence is not hidden");
  assert.strictEqual(prop.disposition.authority.receiptBacked, false, "and the reason it is not canon is stated");
  assert.strictEqual(prop.humanDecision.state, "undecided", "nobody decided it, which is the truth about an unattributable pointer");
  return "disposition: cross-read against partitionEntityMedia / partitionShotMedia, edge-only approvals honoured";
}

/* =========================================================================
   4. AUTHORITY comes from P4 targets, never from free text. */
function checkAuthority({ PM }) {
  const built = project(PM);
  const kai = byName(built, "KAI_DEFAULT_V001.png");
  assert.deepStrictEqual(hostArray(kai.disposition.targets.map((t) => t.kind)).sort(), ["coverage", "state"],
    "an entity approval reports the declared target kinds it satisfies");
  for (const target of kai.disposition.targets)
    assert(P4.APPROVAL_TARGET_KINDS.includes(target.kind), `${target.kind} must be a declared approval-target kind`);

  const frameA = byName(built, "SH010_FRAME_A_V001.png");
  assert.deepStrictEqual(hostArray(frameA.disposition.targets.map((t) => t.kind)).sort(), ["frame", "shot"],
    "a shot approval reports its declared shot-side target kinds");
  for (const target of frameA.disposition.targets)
    assert(P4.SHOT_APPROVAL_TARGET_KINDS.includes(target.kind), `${target.kind} must be a declared shot approval-target kind`);

  /* Which edges carry durable identity is reported rather than assumed, so a test can
     tell "bound by identity" from "bound by filename". */
  assert(frameA.disposition.targets.some((t) => t.assetId.state === "known"),
    "the frame edge recorded an assetId and the projection must surface it");
  assert.strictEqual(byName(built, "SH010_FRAME_B_V001.png").disposition.targets[0].assetId.state, "not-recorded",
    "an edge with no recorded identity says so rather than inventing one");

  assert.strictEqual(byName(built, "KAI_ALT_V002.png").disposition.targets.length, 0,
    "a candidate is authority for nothing");
  return "authority: target kinds cross-read against P4's own vocabularies, identity-bound edges distinguished";
}

/* =========================================================================
   5. SEMANTIC SAFETY -- the three concepts stay three. */
function checkSemanticSafety({ PM }) {
  const built = project(PM);

  /* AI RECOMMENDED APPROVE. NOBODY APPROVED. */
  const recommended = byName(built, "KAI_ALT_V002.png");
  assert.strictEqual(recommended.aiRecommendation.state, "known");
  assert.strictEqual(recommended.aiRecommendation.value, "approve", "the reviewer's suggestion is recorded");
  assert.strictEqual(recommended.humanDecision.state, "undecided", "...and it is NOT a human decision");
  assert.strictEqual(recommended.disposition.role, "candidate", "...and it did not move the disposition");
  assert.strictEqual(recommended.disposition.targets.length, 0, "...and it granted no authority");

  /* AI SAID CORRECT. THE HUMAN APPROVED ANYWAY. Human wins, and both stay legible. */
  const overridden = byName(built, "SH010_FRAME_A_V001.png");
  assert.strictEqual(overridden.aiRecommendation.value, "correct", "a failing triage reads as a suggestion to correct");
  assert.strictEqual(overridden.humanDecision.state, "approved", "the human decision outranks it");
  assert.strictEqual(overridden.disposition.role, "approved");

  /* THE RECOMMENDATION VOCABULARY CANNOT CONTAIN A DECISION WORD. `approve` is a
     suggestion; `approved` is an act. If the two vocabularies ever share a member, a
     renderer keyed on the token will eventually print one for the other. */
  for (const value of PM.PRODUCTION_MEDIA_RECOMMENDATIONS)
    assert(!PM.PRODUCTION_MEDIA_DECISION_STATES.includes(value),
      `"${value}" appears in both the recommendation and the human-decision vocabulary`);

  /* AI PASS CAUSES NOTHING. Strip the human decision and every edge from the approved
     reference; the passing review alone must not keep it approved. */
  const f = fixture();
  const row = f.project.characters[0].candidateFiles[0];
  delete row.humanApproved; delete row.approvalProvenance; row.decision = "unreviewed";
  f.project.characters[0].approvedFile = "";
  f.project.characters[0].approvedAssetId = "";
  f.project.characters[0].continuityStates[0].approvedFile = "";
  f.project.characters[0].continuityStates[0].approvedAssetId = "";
  f.project.characters[0].coverageSlots[0].approvedFile = "";
  const stripped = PM.productionMediaRecords({ project: f.project, scan: f.scan, jobs: f.jobs });
  const unapproved = byName(stripped, "KAI_DEFAULT_V001.png");
  assert.strictEqual(unapproved.disposition.role, "candidate",
    "a passing AI review with no human decision and no edge is a candidate");
  assert.strictEqual(unapproved.humanDecision.state, "undecided");
  assert.strictEqual(unapproved.reviews.length, 1, "...while the review itself is still on record");
  assert.strictEqual(unapproved.aiRecommendation.value, "approve", "...and still says what it suggested");

  /* REJECTED IS RETAINED. Approval must not be the thing that hides evidence, in either
     direction. */
  const rejected = byName(built, "KAI_BAD_V003.png");
  assert(rejected, "rejected media must remain in the projection");
  assert.strictEqual(rejected.humanDecision.state, "rejected");
  assert.strictEqual(built.counts.rejected, 1, "the rejected population is counted, not hidden");

  /* NO REJECTION REASON EXISTS, AND THE GAP IS DECLARED rather than filled. Checked on
     the human-decision block specifically: `reason` legitimately appears elsewhere on a
     record (a job's unavailability reason, a cost's unpriced reason), so a blanket
     string search would pass for the wrong reason. */
  assert(PM.PRODUCTION_MEDIA_UNAVAILABLE["rejection-reason"]?.wouldNeed,
    "the missing rejection reason must stay declared with what it would take to record one");
  assert(!("reason" in rejected.humanDecision) && !("rejectionReason" in rejected.humanDecision),
    "a rejection must not carry an invented reason on its decision block");
  assert.strictEqual(rejected.humanDecision.decision.value, "rejected", "...only the stored decision word itself");
  return "semantics: recommendation != decision != disposition, AI PASS alone approves nothing, rejections retained";
}

/* =========================================================================
   6. REVIEWS -- normalised for display, never merged into one stored schema. */
function checkReviews({ PM }) {
  const built = project(PM);

  const entityReview = byName(built, "KAI_DEFAULT_V001.png").reviews;
  assert.strictEqual(entityReview.length, 1);
  assert.strictEqual(entityReview[0].kind, "entity-structured-review");
  assert.strictEqual(entityReview[0].source, "candidateFiles[].structuredReviews",
    "the envelope names the record it came from, so two shapes stay distinguishable");
  assert.strictEqual(entityReview[0].reviewer.provider.value, "openai", "the reviewer that actually ran");
  assert.strictEqual(entityReview[0].reviewer.model.value, "gpt-5.2");
  assert.strictEqual(entityReview[0].reviewedAt.value, ISO(1), "the review's own timestamp, unchanged");
  assert.strictEqual(entityReview[0].verdict.pass, true);
  assert.strictEqual(entityReview[0].semantic.outcome.value, "validated-strong", "the semantic verdict survives normalisation");
  assert.strictEqual(entityReview[0].evidence.length, 1, "declared-vs-observed evidence survives normalisation");
  assert.strictEqual(entityReview[0].contractVersion.value, "reference-authority-v3");

  const shotReview = byName(built, "SH010_FRAME_A_V001.png").reviews;
  assert.strictEqual(shotReview.length, 1);
  assert.strictEqual(shotReview[0].kind, "shot-ai-triage");
  assert.strictEqual(shotReview[0].source, "candidateFiles[].aiReview");
  assert.strictEqual(shotReview[0].verdict.score, 62);
  assert.strictEqual(shotReview[0].reviewedAt.value, ISO(4));

  /* THE THIN SHAPE STAYS THIN. A shot triage records no reviewer, and the projection
     must say "not recorded" rather than borrowing the entity contract's answer or the
     current Settings model -- the attribution rule candidate review already holds. */
  assert.strictEqual(shotReview[0].reviewer.provider.state, "not-recorded",
    "a triage that never recorded a reviewer must not acquire one");
  assert.strictEqual(shotReview[0].reviewer.model.state, "not-recorded");
  assert.strictEqual(shotReview[0].contractVersion.state, "not-recorded",
    "a shape with no contract version must not be given the other shape's");

  for (const row of built.records)
    for (const review of row.reviews)
      assert(PM.PRODUCTION_MEDIA_REVIEW_KINDS.includes(review.kind), `${review.kind} must be a declared review kind`);

  assert.strictEqual(byName(built, "SH010_FRAME_B_V001.png").reviews.length, 0, "media with no review reports none");
  assert.strictEqual(byName(built, "SH010_FRAME_B_V001.png").aiRecommendation.state, "not-recorded",
    "...and therefore carries no recommendation");
  return "reviews: two persisted shapes in one envelope, kind/source/reviewer/timestamp/verdict all preserved";
}

/* =========================================================================
   6b. P1-3 -- A FORM DEFAULT IS NOT AN OBSERVATION.

   public/review-provenance.js normalizeCandidateStructuredReview() writes all five rubric
   categories at severity "pass" onto the candidate row, and candidateRecord() calls it on
   every candidate it touches. Those defaults exist so the review form has something to
   render a <select> against. Read as observations, they told a filmmaker that an image
   nobody opened -- and an image a person REJECTED -- carried "1 review on record" and five
   PASS marks, above a reviewer, model and timestamp all stating that nothing was recorded.

   That is the most expensive false confidence this product can produce, because it is
   exactly the claim someone would rely on to skip looking.

   THE FIXTURE IS LOCAL rather than added to fixture(): the shared one carries a counted
   population (checkSemanticSafety pins counts.rejected), and a check that had to edit the
   population to make its point would be paying for it in its neighbours' assertions.

   WHAT THIS DOES NOT DO. It does not migrate, rewrite or canonicalise anything: the stored
   bytes of a default "pass" and a deliberate "pass" are identical and stay identical. The
   distinction is drawn in what the projection is willing to REPORT. */
function checkReviewAssessment({ PM, Inspector }) {
  /* Exactly what normalizeCandidateStructuredReview() leaves behind, and nothing else. */
  const neutral = () => ({
    categories: {
      composition: { severity: "pass", note: "" },
      references: { severity: "pass", note: "" },
      requirements: { severity: "pass", note: "" },
      style: { severity: "pass", note: "" },
      cleanliness: { severity: "pass", note: "" },
    },
    references: [], summary: "", ai: null,
  });
  /* A REAL historical review: one issue, one deliberate pass carrying a note, three the
     reviewer left alone, and a timestamp of its own. */
  const reviewed = () => {
    const review = neutral();
    review.reviewedAt = ISO(6);
    review.summary = "Correct the camera height.";
    review.categories.composition = { severity: "major", note: "Camera height drifts from the guide." };
    review.categories.style = { severity: "pass", note: "Period treatment holds." };
    return review;
  };

  const f = fixture();
  f.project.shots[0].candidateFiles.push(
    { stored: "SH010_NEVER_OPENED.png", addedAt: ISO(6), decision: "unreviewed", structuredReview: neutral() },
    { stored: "SH010_HUMAN_REJECTED.png", addedAt: ISO(6), decision: "rejected", decidedAt: ISO(7), structuredReview: neutral() },
    { stored: "SH010_REALLY_REVIEWED.png", addedAt: ISO(6), decision: "shortlist", structuredReview: reviewed() },
  );
  for (const name of ["SH010_NEVER_OPENED.png", "SH010_HUMAN_REJECTED.png", "SH010_REALLY_REVIEWED.png"])
    f.scan.shots.SH010.takes.push({ name, url: `/assets/shots/SH010/takes/${name}` });
  const built = PM.productionMediaRecords({ project: f.project, scan: f.scan, jobs: f.jobs });

  /* 1. THE NEUTRAL STRUCTURE IS NOT A REVIEW. Asserted on the rejected row as well as the
        unreviewed one, because the rejected one is the case that made the defect
        indefensible: a person looked at that image and said no. */
  for (const name of ["SH010_NEVER_OPENED.png", "SH010_HUMAN_REJECTED.png"]) {
    const row = byName(built, name);
    assert(row, `precondition: ${name} must reach the projection`);
    assert.strictEqual(row.reviews.length, 0,
      `${name} carries only the untouched form structure and must report NO review on record`);
    assert.strictEqual(row.aiRecommendation.state, "not-recorded",
      `${name} must not acquire a recommendation from a structure nobody filled in`);
  }
  assert.strictEqual(byName(built, "SH010_HUMAN_REJECTED.png").humanDecision.state, "rejected",
    "...and the human decision on it is untouched by any of this");

  /* 2. A REAL REVIEW STILL RENDERS ITS REAL FINDINGS, with all three category states
        distinguishable and none of them invented. */
  const real = byName(built, "SH010_REALLY_REVIEWED.png").reviews;
  assert.strictEqual(real.length, 1, "a review that actually happened is still on record");
  assert.strictEqual(real[0].kind, "shot-structured-review");
  assert.strictEqual(real[0].reviewedAt.value, ISO(6), "its own timestamp, not today's");
  const outcomes = Object.fromEntries(real[0].evidence.map((entry) => [entry.label.value, `${entry.outcome.state}:${entry.outcome.value}`]));
  assert.deepStrictEqual(outcomes, {
    composition: "known:major",      // assessed, and an issue
    style: "known:pass",             // assessed, and a pass -- it carries a note
    references: "not-recorded:",     // untouched form default
    requirements: "not-recorded:",
    cleanliness: "not-recorded:",
  }, "assessed ISSUE, assessed PASS and no-recorded-observation must be three distinguishable answers");
  assert.deepStrictEqual({ ...real[0].assessment }, { categories: 5, assessed: 2 },
    "the projection must state how much of the rubric was actually filled in");
  assert.strictEqual(real[0].evidence.find((entry) => entry.label.value === "composition").observed.value,
    "Camera height drifts from the guide.", "the reviewer's own words survive");

  /* 3. REVIEWER IDENTITY REMAINS HISTORICAL TRUTH. The record carries none, and none is
        borrowed from the entity contract or from current Settings. */
  assert.strictEqual(real[0].reviewer.provider.state, "not-recorded");
  assert.strictEqual(real[0].reviewer.model.state, "not-recorded");

  /* 4. AND THE SURFACE KEEPS THEM APART. The Inspector is the reporting boundary the
        finding was raised against, so the words are checked in the shipped renderer and
        not only in the projection that feeds it. */
  const unreviewedHtml = Inspector.inspectorMarkup(byName(built, "SH010_HUMAN_REJECTED.png"));
  assert(unreviewedHtml.includes('data-mi-reviewed="no"') && unreviewedHtml.includes("Never reviewed"),
    "an unreviewed candidate must read as never reviewed");
  assert(!/[0-9]+ reviews? on record/.test(unreviewedHtml),
    "...and must never claim a review is on record because a neutral structure exists");
  assert(unreviewedHtml.includes('data-mi-review-count="0"'), "...with no review section rows");

  const reviewedHtml = Inspector.inspectorMarkup(byName(built, "SH010_REALLY_REVIEWED.png"));
  assert(reviewedHtml.includes("1 review on record"), "a real review is still reported as one");
  assert.strictEqual((reviewedHtml.match(/data-mi-evidence-outcome="not-recorded"/g) || []).length, 3,
    "the three unassessed categories must each say so rather than rendering as a bare row");
  assert(reviewedHtml.includes("No recorded observation"), "...in words, not by omission");
  assert(reviewedHtml.includes("2 of 5 categories assessed"), "...and the surface states the proportion");
  assert(reviewedHtml.includes("Reviewer not recorded") && reviewedHtml.includes("Model not recorded"),
    "reviewer and model stay historical truth even on a review that happened");

  /* 5. AI PASS STILL CAUSES NOTHING. The whole point of reporting a review honestly is
        that it remains advisory; an assessed PASS must not have moved anything. */
  const assessed = byName(built, "SH010_REALLY_REVIEWED.png");
  assert.strictEqual(assessed.disposition.role, "candidate", "an assessed review approves nothing");
  assert.strictEqual(assessed.humanDecision.state, "undecided");
  return "review assessment: form defaults are not observations, real findings survive, reviewer identity stays historical";
}

/* =========================================================================
   7. PROVENANCE AND MONEY -- the four job cases, and never a zero. */
function checkProvenance({ PM }) {
  const built = project(PM);

  const cases = {
    "TOOL_DEFAULT_V001.png": ["none", "not-recorded"],
    "SH010_FRAME_B_V001.png": ["resolved", "not-recorded"],
    "SH010_MOTION_H3_1.mp4": ["resolved", "not-priced"],
    "SH020_FRAME_A_FAL_1.png": ["unavailable", "unavailable"],
    "KAI_DEFAULT_V001.png": ["resolved", "priced"],
  };
  for (const [name, [jobState, costState]] of Object.entries(cases)) {
    const row = byName(built, name);
    assert.strictEqual(row.provenance.job.state, jobState, `${name}: job state`);
    assert.strictEqual(row.provenance.cost.state, costState, `${name}: cost state`);
    assert(PM.PRODUCTION_MEDIA_JOB_STATES.includes(row.provenance.job.state));
    assert(PM.PRODUCTION_MEDIA_COST_STATES.includes(row.provenance.cost.state));
  }

  /* THE FOURTH CASE IS THE WHOLE POINT: reached here with the ledger LOADED, so it
     cannot be dismissed as "generation is switched off". */
  assert.strictEqual(built.jobsAvailable, true);
  assert.strictEqual(byName(built, "SH020_FRAME_A_FAL_1.png").provenance.job.reason, "job-not-in-ledger",
    "a job missing from a loaded ledger is distinguishable from a ledger that never loaded");

  /* ...and the same media with NO ledger at all reports the other reason. */
  const f = fixture();
  const noLedger = PM.productionMediaRecords({ project: f.project, scan: f.scan, jobs: [], jobsAvailable: false });
  assert.strictEqual(noLedger.jobsAvailable, false);
  const kaiNoLedger = byName(noLedger, "KAI_DEFAULT_V001.png");
  assert.strictEqual(kaiNoLedger.provenance.job.state, "unavailable");
  assert.strictEqual(kaiNoLedger.provenance.job.reason, "generation-ledger-not-loaded");
  assert.strictEqual(kaiNoLedger.provenance.cost.state, "unavailable",
    "a cost that could not be loaded must NOT read as a cost nobody recorded");

  /* A CALLER THAT PASSES NOTHING GETS THE SAFE ANSWER. */
  const noJobsArg = PM.productionMediaRecords({ project: f.project, scan: f.scan });
  assert.strictEqual(noJobsArg.jobsAvailable, false, "omitting jobs must default to unavailable, not to not-recorded");

  /* NO ZERO ANYWHERE. Not as an amount, not as a string. */
  for (const row of built.records)
    if (row.provenance.cost.state !== "priced")
      assert.strictEqual(row.provenance.cost.amount, null, `${row.file.name}: an unknown cost must carry no number at all`);

  /* CROSS-READ AGAINST THE OWNER of the money rules. */
  for (const job of fixture().jobs) {
    const recorded = Cost.recordedEstimate(job);
    const amount = Cost.recordedAmount(job);
    const row = built.records.find((r) => r.provenance.job.id.value === job.id && r.provenance.job.state === "resolved");
    if (!row) continue;
    if (!recorded) assert.strictEqual(row.provenance.cost.state, "not-recorded", `${job.id}: generation-cost says nothing was recorded`);
    else if (amount == null) assert.strictEqual(row.provenance.cost.state, "not-priced", `${job.id}: generation-cost says unpriced`);
    else assert.strictEqual(row.provenance.cost.amount, amount, `${job.id}: the projection must report generation-cost's own number`);
  }
  assert.strictEqual(byName(built, "KAI_DEFAULT_V001.png").provenance.cost.basis, "estimated-at-submission",
    "a recorded amount must travel with the word that keeps it honest");

  /* PROVIDER AND MODEL ARE READ, NEVER INFERRED. */
  assert.strictEqual(byName(built, "SH010_MOTION_H3_1.mp4").provenance.model.value, "minimax/h3/image-to-video");
  assert.strictEqual(byName(built, "SH010_MOTION_H3_1.mp4").provenance.mode.value, "i2v");
  assert.strictEqual(byName(built, "animatic-opening.png").provenance.model.state, "not-recorded",
    "an imported planning file has no model, and none may be inferred from its name");

  /* PROMPT: recorded where it is, absent where it is not, and never reconstructed. */
  assert.strictEqual(byName(built, "KAI_DEFAULT_V001.png").provenance.prompt.state, "known", "an entity candidate records its prompt");
  assert.strictEqual(byName(built, "KAI_DEFAULT_V001.png").provenance.prompt.source, "candidate-row");
  assert.strictEqual(byName(built, "SH010_BLOCKING_FAL_1.png").provenance.prompt.state, "known", "a blocking asset records its prompt");
  assert.strictEqual(byName(built, "SH010_BLOCKING_FAL_1.png").provenance.prompt.source, "library-generation-record");
  assert.strictEqual(byName(built, "SH010_FRAME_A_V001.png").provenance.prompt.state, "not-recorded",
    "a shot candidate records a build id, not a prompt -- and the build's CURRENT text is not the historical request");
  assert.strictEqual(byName(built, "SH010_FRAME_A_V001.png").provenance.sourceBuildId.state, "known",
    "...while the build it names is still reported, so the gap is navigable");
  assert(PM.PRODUCTION_MEDIA_UNAVAILABLE["shot-candidate-prompt"]?.wouldNeed,
    "the shot-candidate prompt gap must stay declared");

  /* LINEAGE IS LINKED, NEVER RECONSTRUCTED. */
  const frameA = byName(built, "SH010_FRAME_A_V001.png");
  assert.deepStrictEqual(hostArray(frameA.provenance.lineage.map((l) => l.relation)), ["renamed-from"]);
  assert.strictEqual(frameA.provenance.lineage[0].value, "SH010_FRAME_A_FAL_1.png");
  assert.strictEqual(byName(built, "KAI_ALT_V002.png").provenance.lineage.length, 0,
    "media with no recorded lineage reports none rather than guessing from timestamps");
  assert(PM.PRODUCTION_MEDIA_UNAVAILABLE["retry-lineage"], "the retry gap must stay declared");
  return "provenance: four job states distinguished, cost cross-read against generation-cost.js, prompt/lineage never invented";
}

/* =========================================================================
   8. DEDUPLICATION -- one logical asset, one row. */
function checkDeduplication({ PM }) {
  const f = fixture();
  /* The same bytes reachable under a SECOND path with the SAME ledger identity -- what a
     rename leaves behind if a stale listing survives.

     BATCH 1B: the stale CANDIDATE ROW travels with the stale listing, because
     that is what an unrepaired rename really leaves and because the entity pool
     is keyed by durable claim now. Without the row the old path is an unclaimed
     file, correctly quarantined out of the pool — which would make this check
     pass against a projection that never saw the duplicate at all, rather than
     against the collapse it exists to prove. */
  f.scan.anchors.push({ name: "KAI_RENAMED_OLD.png", url: "/assets/anchors/KAI_RENAMED_OLD.png", assetId: LEDGER("a") });
  f.project.characters[0].candidateFiles.push({ stored: "KAI_RENAMED_OLD.png", addedAt: ISO(1), decision: "unreviewed" });
  const built = PM.productionMediaRecords({ project: f.project, scan: f.scan, jobs: f.jobs });
  const kai = built.records.filter((row) => row.identity.ledger.value === LEDGER("a"));
  assert.strictEqual(kai.length, 1, "one durable identity must produce one logical asset, not two");
  assert.strictEqual(built.duplicatesCollapsed, 1, "...and the collapse must be reported rather than silent");

  /* TWO DIFFERENT FILES WITH THE SAME BASENAME IN DIFFERENT DIRECTORIES MUST NOT MERGE.
     This is the false-linkage class C1 removed from the indexer. */
  const g = fixture();
  g.scan.shots.SH020.takes.push({ name: "SH010_FRAME_B_V001.png", url: "/assets/shots/SH020/takes/SH010_FRAME_B_V001.png" });
  const built2 = PM.productionMediaRecords({ project: g.project, scan: g.scan, jobs: g.jobs });
  const sameName = built2.records.filter((row) => row.file.name === "SH010_FRAME_B_V001.png");
  assert.strictEqual(sameName.length, 2, "same-named files in different directories are different media");
  assert.notStrictEqual(sameName[0].key, sameName[1].key, "...and must keep different keys");
  assert.strictEqual(built2.duplicatesCollapsed, 0, "...and nothing may be collapsed");
  return "dedup: one durable identity -> one row (reported), same basename in two directories stays two";
}

/* =========================================================================
   9. PURITY -- a read mutates nothing, and every record is frozen. */
function checkPurity({ PM, sources }) {
  const f = fixture();
  const before = JSON.stringify({ project: f.project, scan: f.scan, jobs: f.jobs });
  const built = PM.productionMediaRecords({ project: f.project, scan: f.scan, jobs: f.jobs });
  assert.strictEqual(JSON.stringify({ project: f.project, scan: f.scan, jobs: f.jobs }), before,
    "the projection must not write to anything it was handed -- including normalising a legacy entity by rendering it");

  assert(Object.isFrozen(built) && Object.isFrozen(built.records), "the projection returns frozen values");
  for (const row of built.records) {
    assert(Object.isFrozen(row), `${row.file.name}: records must be frozen`);
    assert(Object.isFrozen(row.provenance) && Object.isFrozen(row.disposition), "nested blocks must be frozen too");
  }

  /* A CALLER CANNOT PERSIST ONE. Freezing is what makes "this is a rendering, not
     production state" enforceable rather than merely documented. */
  const row = built.records[0];
  assert.throws(() => { "use strict"; row.disposition.role = "approved"; }, TypeError,
    "a caller must not be able to edit a projected disposition");

  /* THE MODULE HAS NO WRITER AT ALL. */
  const code = stripComments(sources.projection);
  assert(code.includes("productionMediaRecords"), "comment stripping must leave the projection's code intact");
  assert(!/\bdirty\s*\(/.test(code), "the projection must not be able to mark a project dirty");
  assert(!/\bfetch\s*\(/.test(code), "the projection must make no request");
  assert(!/localStorage/.test(code), "the projection must not persist anything");
  return "purity: no mutation of inputs, frozen output, no writer / fetch / storage in the module";
}

/* =========================================================================
   10. ACTIONS -- bounded, refusing, and reusing shipped handlers. */
function checkActions({ PM, sources }) {
  const built = project(PM);

  /* PAID AND DESTRUCTIVE ARE DROPPED BY CONSTRUCTION, the O4 discipline. */
  for (const action of PM.PRODUCTION_MEDIA_ACTIONS) {
    assert.strictEqual(action.paid, false, `${action.id}: no paid action may be declared here`);
    assert.strictEqual(action.destructive, false, `${action.id}: no destructive action may be declared here`);
  }
  /* THE DROP IS STRUCTURAL, not merely vacuous. Today no declared action is paid, so
     asserting the declaration alone would keep passing after the filter was deleted --
     and the deletion would only surface on the day somebody added a paid action, which
     is the worst possible day to discover it. */
  const projectionCode = stripComments(sources.projection);
  assert(/if \(action\.paid \|\| action\.destructive\) continue;/.test(projectionCode),
    "actionsFor must keep dropping paid and destructive candidates before anything is offered");

  const declaredIds = PM.PRODUCTION_MEDIA_ACTIONS.map((a) => a.id);
  assert(!declaredIds.includes("delete"), "deletion must not be reachable from a browsing surface: rejection retains evidence, deletion destroys it");
  assert(!declaredIds.some((id) => /regenerate|retry|generate/i.test(id)), "no generation action may be offered here");

  /* AN APPROVED ITEM IS NOT OFFERED APPROVE; A REJECTED ONE IS OFFERED RESTORE. */
  assert(!byName(built, "KAI_DEFAULT_V001.png").actions.includes("approve"));
  assert(byName(built, "KAI_ALT_V002.png").actions.includes("approve"));
  assert(byName(built, "KAI_BAD_V003.png").actions.includes("restore"));
  assert(!byName(built, "KAI_ALT_V002.png").actions.includes("restore"));

  /* MEDIA WITH NO CANDIDATE ROW IS OFFERED NO DECISION. A button with nowhere to write
     would imply a disposition the product cannot change. */
  for (const name of ["SH010_BLOCKING_FAL_1.png", "animatic-opening.png"])
    for (const forbidden of ["approve", "reject", "restore", "view-review"])
      assert(!byName(built, name).actions.includes(forbidden),
        `${name}: has no candidate row, so ${forbidden} must not be offered`);

  /* EVERY ACTION THE INSPECTOR DISPATCHES IS A SHIPPED HANDLER. */
  const handlers = ["approveTake", "approveEntityFile", "setCandidateDecision", "setEntityCandidateDecision", "openCandidateReview", "openEntityCandidateReview", "openMediaTheatre"];
  for (const handler of handlers)
    assert(sources.inspector.includes(handler), `the Inspector must dispatch the shipped ${handler}`);
  for (const [handler, owner] of [["approveTake", "library-tools.js"], ["approveEntityFile", "library-tools.js"], ["setCandidateDecision", "review-provenance.js"], ["setEntityCandidateDecision", "entities.js"]])
    assert(readSource(path.join(PUBLIC, owner)).includes(`window.${handler} =`), `${handler} must still be owned by ${owner}`);

  /* THE INSPECTOR IS NOT A SECOND DECISION WRITER.
     Scanned with COMMENTS REMOVED. This file explains what the shipped writers do by
     quoting them, so a naive source search matches the explanation and reports a
     violation that is not there -- and would keep reporting one after the explanation
     was deleted, training the next reader to weaken the check. */
  const code = stripComments(sources.inspector);
  assert(code.includes("window.inspectMedia"), "comment stripping must leave the Inspector's code intact");
  assert(!/\.decision\s*=[^=]/.test(code), "the Inspector must not write a decision itself");
  assert(!/\.approvedFile\s*=[^=]/.test(code), "the Inspector must not write an approval pointer itself");
  assert(!/\bdirty\s*\(/.test(code), "the Inspector must not mark the project dirty itself");
  assert(!/stampApprovalIdentity|stampShotApprovalIdentity/.test(code), "the Inspector must not stamp identity itself");
  assert(!/\bfetch\s*\(/.test(code), "the Inspector must make no request of its own");
  return "actions: paid/destructive/delete impossible, decisions only on decidable media, every dispatch a shipped handler";
}

/* =========================================================================
   11. THE DESTINATION -- one project-level route, and it is not a shot stage. */
function checkDestination({ sources }) {
  const Shell = loadShell(sources.shell);
  assert(Shell.isCreatorShellView("results"), "Generated Media must receive the creator shell");
  assert.strictEqual(Shell.creatorShellState({ view: "results", hasProject: true }).present, true);
  assert.strictEqual(Shell.creatorShellState({ view: "results", hasProject: false }).present, false,
    "...and not before a project is open");

  /* THE O4 STRIP MUST NOT FOLLOW IT. Proven at the source: the bar mounts on the shot
     route only, so no `results` entry can exist there to remove later. */
  assert(/view === "shot" \? currentTargetId\(\)/.test(sources.stageSurfaces),
    "the stage bar must still key on the shot route alone");
  assert(!/\bresults\b/.test(sources.stageSurfaces),
    "public/stage-surfaces.js must not name the Generated Media route at all -- its absence is what collapses the bar there");

  /* ONE ROUTE, ONE NAV ENTRY, ONE LABEL. */
  assert(/^\s*results\(tab\)/m.test(sources.views), "ROUTES must declare exactly one results entry");
  assert.strictEqual((sources.markup.match(/data-view="results"/g) || []).length, 1, "one navigation button");
  assert(/results: "Generated Media"/.test(sources.app), "the topbar must name the destination");
  assert(sources.markup.includes("shared-production-media.js"), "the projection must ship");
  assert(sources.markup.includes("media-inspector.js") && sources.markup.includes("media-results.js"), "both O5 surfaces must ship");

  /* THE DESTINATION IS NOT A DAM. Comments stripped for the reason given above: the
     module's own header says "no folders, no tags", and a naive search finds that. */
  const resultsCode = stripComments(sources.results);
  assert(resultsCode.includes("resultsView"), "comment stripping must leave the destination's code intact");
  for (const forbidden of ["folder", "tag", "savedSearch", "bulkDelete", "rename"])
    assert(!new RegExp(`\\b${forbidden}`, "i").test(resultsCode), `Generated Media must not grow a ${forbidden} system`);
  return "destination: one project-level route with the shell, no stage strip, no DAM features";
}

function loadShell(source) {
  const context = vm.createContext({ module: { exports: {} }, console });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "shared-workspace-shell.js" });
  return context.module.exports;
}

/* =========================================================================
   12. RENDERING RULES -- the destination and the Inspector print truth. */
function checkRendering({ PM, Results, Inspector }) {
  const built = project(PM);

  /* CURRENT PINS APPROVED FIRST and never hides rejected behind a wall. */
  const current = Results.orderRecords(Results.tabRecords(built.records, "current"), true);
  assert.strictEqual(current[0].disposition.role, "approved", "the default view leads with approved media");
  assert(!current.some((row) => row.disposition.role === "rejected"), "...and Current excludes rejected work");
  const rejectedTab = Results.tabRecords(built.records, "rejected");
  assert.strictEqual(rejectedTab.length, built.counts.rejected, "...which is still fully reachable under Rejected");
  assert.strictEqual(Results.tabRecords(built.records, "approved").length, built.counts.approved);
  /* 1D-04: HISTORIC rows — a pointer something selected and nobody approved —
     sit under Candidates, because the tabs answer "is this canon" and historic
     and candidate share that answer. They keep their own status word on the
     card, so the distinction stays visible where it matters. */
  assert.strictEqual(
    Results.tabRecords(built.records, "candidates").length,
    built.counts.candidate + built.counts.historic,
    "Candidates holds everything that is not canon and not rejected");
  assert.strictEqual(
    Results.tabRecords(built.records, "approved").length + Results.tabRecords(built.records, "candidates").length + rejectedTab.length,
    built.records.length, "the status views must partition the population with nothing lost");
  assert(built.counts.historic > 0, "and the fixture must actually contain a historic pointer, or this proves nothing");

  /* SORTING USES RECORDED FIELDS ONLY: a record with no timestamp sorts last rather
     than being treated as the oldest. */
  const ordered = Results.orderRecords(built.records, false);
  const firstUndated = ordered.findIndex((row) => row.file.addedAt.state !== "known");
  const lastDated = ordered.map((row) => row.file.addedAt.state === "known").lastIndexOf(true);
  if (firstUndated >= 0)
    assert(firstUndated > lastDated, "media with no recorded timestamp must sort after media that has one");

  /* A CARD SHOWS THE DISPOSITION AND NEVER THE RECOMMENDATION AS A STATUS. */
  const recommendedCard = Results.cardMarkup(byName(built, "KAI_ALT_V002.png"));
  assert(recommendedCard.includes('data-role="candidate"'));
  assert(recommendedCard.includes(">CANDIDATE<"), "the status chip prints the disposition");
  assert(!recommendedCard.includes(">APPROVED<"), "an AI-recommended candidate must never paint an APPROVED chip");
  assert(recommendedCard.includes("AI SUGGESTED"), "...and the suggestion is shown as advisory, separately");
  const approvedCard = Results.cardMarkup(byName(built, "KAI_DEFAULT_V001.png"));
  assert(approvedCard.includes(">APPROVED<") && approvedCard.includes('data-role="approved"'));
  assert(!approvedCard.includes("AI SUGGESTED"), "approved media does not also advertise a suggestion");

  /* THE INSPECTOR'S WORDS. */
  const recommendedHtml = Inspector.inspectorMarkup(byName(built, "KAI_ALT_V002.png"));
  assert(recommendedHtml.includes('data-mi-human-decision="undecided"'));
  assert(recommendedHtml.includes("No human decision yet"));
  assert(recommendedHtml.includes("Suggests approving"), "a suggestion is worded as a suggestion");
  assert(!recommendedHtml.includes("Approved by you"), "...and never as a human approval");
  assert(recommendedHtml.includes("Advisory only"), "...and says so explicitly");

  const approvedHtml = Inspector.inspectorMarkup(byName(built, "KAI_DEFAULT_V001.png"));
  assert(approvedHtml.includes("Approved by you") && approvedHtml.includes('data-mi-human-decision="approved"'));
  assert(approvedHtml.includes('data-mi-target-count="2"'), "authority targets are rendered");

  /* MISSING DATA IS PRINTED. */
  const unavailableHtml = Inspector.inspectorMarkup(byName(built, "SH020_FRAME_A_FAL_1.png"));
  assert(unavailableHtml.includes("Generation record unavailable"), "an unloadable job says so");
  assert(!unavailableHtml.includes("Cost not recorded"), "...and must NOT claim nothing was recorded");
  assert(Inspector.inspectorMarkup(byName(built, "SH010_MOTION_H3_1.mp4")).includes("Cost not priced"));
  assert(Inspector.inspectorMarkup(byName(built, "SH010_FRAME_B_V001.png")).includes("Cost not recorded"),
    "a job that recorded no accounting says nothing was recorded");

  /* NO ZERO, ANYWHERE, IN ANY RECORD. */
  for (const row of built.records) {
    const html = Inspector.inspectorMarkup(row);
    assert(!/\$\s*0\.00/.test(html) && !/>USD 0\.00</.test(html), `${row.file.name}: an unknown cost must never render as zero`);
    assert(html.includes('data-mi-section="provenance"'), "every record gets a provenance section");
  }

  /* THE REJECTED INSPECTOR SAYS WHY IT CANNOT SAY WHY. */
  const rejectedHtml = Inspector.inspectorMarkup(byName(built, "KAI_BAD_V003.png"));
  assert(rejectedHtml.includes("Rejected by you") && rejectedHtml.includes("kept as evidence"));
  assert(rejectedHtml.includes("Reason not recorded") && rejectedHtml.includes('data-mi-rejection-reason="not-recorded"'),
    "a rejection with no recorded reason must say so in those words rather than leaving a blank");
  assert(!approvedHtml.includes("Reason not recorded"),
    "...and the wording must not leak onto media that was never rejected");

  /* ONE INSPECTOR CONTRACT, EVERY KIND. */
  for (const kind of PM.PRODUCTION_MEDIA_KINDS) {
    const row = built.records.find((r) => r.kind === kind);
    assert(row, `the fixture must cover ${kind}`);
    const html = Inspector.inspectorMarkup(row);
    for (const section of ["identity", "status", "authority", "review", "provenance"])
      assert(html.includes(`data-mi-section="${section}"`), `${kind}: the Inspector must render the ${section} section`);
  }
  return "rendering: Current leads with approved, rejected reachable, recommendation never painted as approval, unknowns printed";
}

/* =========================================================================
   13. SCALE -- bounded work on a project with real media volume. */
function checkScale({ PM }) {
  const grow = (f, prefix, shots, takes) => {
    for (let s = 0; s < shots; s++) {
      const id = `${prefix}${String(s).padStart(3, "0")}`;
      const list = [], rows = [];
      for (let t = 0; t < takes; t++) {
        const name = `${id}_FRAME_A_V${String(t).padStart(3, "0")}.png`;
        list.push({ name, url: `/assets/shots/${id}/takes/${name}` });
        rows.push({ stored: name, addedAt: ISO(1 + (t % 27)), decision: t === 0 ? "shortlist" : t % 5 === 0 ? "rejected" : "unreviewed", generationJobId: t % 3 === 0 ? "job-frame-a" : "" });
      }
      f.project.shots.push({ id, scene: "SC01", title: `Shot ${s}`, winner: list[0].name, keyframes: [{ id: "kf-a", label: "A", winner: list[0].name }], clips: [], candidateFiles: rows });
      f.scan.shots[id] = { takes: list, blocking: [], locked: [] };
    }
    return f;
  };
  const SHOTS = 60, TAKES = 12;
  const f = grow(fixture(), "SC", SHOTS, TAKES);
  const started = process.hrtime.bigint();
  const built = PM.productionMediaRecords({ project: f.project, scan: f.scan, jobs: f.jobs });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const expected = 10 + SHOTS * TAKES;
  assert.strictEqual(built.records.length, expected, `expected ${expected} records at scale, got ${built.records.length}`);
  assert.strictEqual(built.duplicatesCollapsed, 0, "no logical asset may be duplicated at scale");
  /* 1D-04: four roles now, and `historic` is one of them — the scale fixture has
     no authority ledger, so every winner it declares is a legacy pointer. The
     partition property is what this asserts, and it is unchanged. */
  assert.strictEqual(
    built.counts.approved + built.counts.historic + built.counts.candidate + built.counts.rejected,
    expected, "counts must partition the population at scale");
  assert(built.counts.rejected >= SHOTS, "rejected media must survive at scale");

  /* A BOUND, NOT A BENCHMARK. The number is generous because CI machines vary; what it
     catches is an accidental O(N^2), which at this size would be seconds. */
  assert(ms < 4000, `the projection must stay bounded at ${expected} records (took ${ms.toFixed(0)}ms)`);

  /* Doubling the media must not quadruple the time -- the actual quadratic check. */
  const g = grow(fixture(), "SD", SHOTS * 2, TAKES);
  const started2 = process.hrtime.bigint();
  PM.productionMediaRecords({ project: g.project, scan: g.scan, jobs: g.jobs });
  const ms2 = Number(process.hrtime.bigint() - started2) / 1e6;
  const growth = ms2 / Math.max(ms, 0.5);
  assert(growth < 3.2, `doubling the media must not more than roughly double the work (grew ${growth.toFixed(2)}x)`);
  return `scale: ${expected} records in ${ms.toFixed(0)}ms, 2x media -> ${growth.toFixed(2)}x time (${ms2.toFixed(0)}ms)`;
}

/* =========================================================================
   14. STYLE -- the Inspector is theme-token only, and the known literal is corrected. */
function checkStyle({ sources }) {
  const marker = "GENERATED MEDIA + THE UNIVERSAL MEDIA INSPECTOR";
  assert(sources.styles.includes(marker), "the O5 stylesheet section must be findable");
  const inspectorCss = sources.styles.slice(sources.styles.indexOf(marker));
  const literals = inspectorCss.match(/background:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi) || [];
  const offenders = literals.filter((row) => !/var\(/.test(row));
  assert.deepStrictEqual(offenders, [], `O5 styles must paint from tokens only, found: ${offenders.join(", ")}`);

  /* THE KNOWN LIGHT-THEME DEFECT. `.focused-inspector` painted a frozen near-black, so
     it stayed dark while its ink went dark under the light surface. */
  const focused = sources.styles.match(/\.focused-inspector\{[^}]*\}/);
  assert(focused, ".focused-inspector must still be declared");
  assert(!/rgba\(20,\s*24,\s*27/.test(focused[0]), "the hardcoded dark literal must be gone");
  assert(/background:var\(--surface\)/.test(focused[0]), "...and replaced by the raised-surface token");
  return "style: O5 surfaces are token-only; .focused-inspector's frozen dark literal corrected";
}

const CHECKS = {
  checkPopulation, checkIdentity, checkDisposition, checkAuthority, checkSemanticSafety,
  checkReviews, checkReviewAssessment, checkProvenance, checkDeduplication, checkPurity, checkActions,
  checkDestination, checkRendering, checkScale, checkStyle,
};

module.exports = { ...CHECKS, SOURCES, fixture, build, byName, LEDGER, ISO };

if (require.main === module) {
  const deps = build();
  const lines = [];
  for (const [name, check] of Object.entries(CHECKS)) {
    try {
      lines.push(check(deps));
    } catch (error) {
      console.error(`O5 production media FAILED in ${name}`);
      throw error;
    }
  }
  console.log("O5 production media OK");
  for (const line of lines) console.log(`  ${line}`);
}
