/* P-1 regression suite: no meaningful director intent may silently disappear,
   and opening a project is not a migration.

   Each block reproduces a defect that shipped, so each assertion fails if that
   defect returns:

   F1 - Creation Studio writes entity.creationDescription, but the prompt
        compiler resolved `block || description`. A visual description authored
        through the current UI reached continuity and never reached image
        generation.
   F2 - the compiler read only `shot.dur`, so the shipped sample's SAMPLE-03,
        which stores `duration: 4`, compiled as a defaulted 5-second shot.
   F3 - `codes[]` resolves a token through a prefix compatibility rule, so
        LOC-HULL-A silently becomes LOC-HULL and STAGE-3 silently becomes
        nothing. Resolution is deliberately unchanged here; the loss is now
        reported.
   F4 - normalizing a project on load cleared coverage approvedFile values,
        performing a destructive migration before the filmmaker asked for one.

   Everything runs against synthetic fixtures, a disposable copy of the shipped
   sample, or an os.tmpdir() projects root. No real user project is read or
   written, and no Overfit data is used. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PromptEngine = require("../prompt-engine");
const {
  entityVisualDescription,
  resolveShotDuration,
  classifyShotCodeTokens,
  lossyShotCodeTokens,
} = require("../public/shared-entities");
const { render, buildFixture } = require("./render-harness");

const SAMPLE_FILE = path.join(ROOT, "projects", "cinebraid-sample", "project.json");
/* Distinctive enough that its disappearance cannot be mistaken for a coincidence. */
const AUTHORED = "Weathered brass diving helmet with a cracked left porthole and a hand-stitched leather collar.";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readSample = () => JSON.parse(fs.readFileSync(SAMPLE_FILE, "utf8"));

function shotProject(shot, extra = {}) {
  return {
    meta: { title: "Intent loss fixture" },
    characters: [], locations: [], props: [], vehicles: [], audio: [],
    scenes: [{ id: "SC-01", whatHappens: "Something happens.", howItFeels: "Tense." }],
    shots: [{ id: "S-01", scene: "SC-01", title: "Shot one", desc: "A described shot.", codes: [], clips: [], ...shot }],
    ...extra,
  };
}

/* ---------------------------------------------------------------- F1 ---- */

function testAuthoredDescriptionReachesTheCompiler() {
  const project = shotProject(
    { characters: ["CHAR-DIVER"] },
    {
      characters: [{
        id: "CHAR-DIVER",
        name: "The Diver",
        /* The shape the current UI produces: Creation Studio's field is
           filled in and the legacy fields were never touched. */
        block: "",
        description: "",
        creationDescription: AUTHORED,
      }],
    },
  );
  const context = PromptEngine.buildContext(project, "S-01", "");
  const reference = (context.references || []).find((row) => row.id === "CHAR-DIVER");
  const promptEntity = (context.promptEntities || []).find((row) => row.id === "CHAR-DIVER");
  assert(reference, "the shot's character must resolve into the generation context");
  assert.strictEqual(reference.canon, AUTHORED, "a description authored in Creation Studio must reach the prompt compiler as canon");
  assert.strictEqual(promptEntity.canon, AUTHORED, "the same description must reach the prompt entity list");
  assert(JSON.stringify(context).includes(AUTHORED), "the authored sentence must be present somewhere in the compiled context");
}

/* A location authored the same way. Non-characters took a different legacy
   branch, so they need their own proof rather than an assumption. */
function testAuthoredDescriptionReachesTheCompilerForNonCharacters() {
  const project = shotProject(
    { codes: ["LOC-DECK", "PROP-VALVE"] },
    {
      locations: [{ id: "LOC-DECK", name: "The deck", notes: "", description: "", creationDescription: AUTHORED }],
      props: [{ id: "PROP-VALVE", name: "Valve", notes: "", description: "", creationDescription: AUTHORED }],
    },
  );
  const context = PromptEngine.buildContext(project, "S-01", "");
  for (const type of ["location", "prop"]) {
    const reference = (context.references || []).find((row) => row.type === type);
    assert(reference, `the shot's ${type} must resolve into the generation context`);
    assert.strictEqual(reference.canon, AUTHORED, `a ${type} description authored in Creation Studio must reach the prompt compiler`);
  }
}

/* Centralising the rule must not re-rank text that already resolved. These are
   the two shapes that exist in real projects and in the shipped sample. */
function testExistingDescriptionPrecedenceIsUnchanged() {
  assert.strictEqual(
    entityVisualDescription({ block: "canon block", description: "generic description" }, "character"),
    "canon block",
    "a character's canon block must keep winning over a generic description",
  );
  assert.strictEqual(
    entityVisualDescription({ description: "fuller visual description", notes: "short production note" }, "location"),
    "fuller visual description",
    "a location's visual description must keep winning over its production note",
  );
  assert.strictEqual(
    entityVisualDescription({ creationDescription: AUTHORED, block: "canon block", description: "generic" }, "character"),
    AUTHORED,
    "the field the current UI writes must outrank every legacy alias",
  );
  /* Nothing may become unreachable: a value stored only under the other
     type's legacy field must still resolve rather than vanish. */
  assert.strictEqual(entityVisualDescription({ notes: "only a note" }, "prop"), "only a note");
  assert.strictEqual(entityVisualDescription({ block: "only a block" }, "location"), "only a block");
  assert.strictEqual(entityVisualDescription({}, "character"), "", "an entity with no description resolves to nothing, not to noise");
}

/* The shipped sample's prop stores its description in `notes` only. The
   compiler could not see it, so the product reported the prop as having no
   canon while Creation Studio displayed one. */
function testSampleEntityCanonIsVisibleToTheCompiler() {
  const sample = readSample();
  const context = PromptEngine.buildContext(sample, "SAMPLE-01", "");
  const parcel = (context.references || []).find((row) => row.id === "PROP-PARCEL");
  assert(parcel, "the sample's prop must resolve into the generation context");
  assert(parcel.canon.includes("Medium blue parcel"), "the sample prop's stored description must reach the compiler");
}

/* ---------------------------------------------------------------- F2 ---- */

function testDurationAliasesAreAllHonoured() {
  const cases = [
    ["dur only", { dur: 4 }, 4, false],
    ["duration only", { duration: 4 }, 4, false],
    ["sec only", { sec: 4 }, 4, false],
    ["no duration at all", {}, 5, true],
  ];
  for (const [label, fields, seconds, defaulted] of cases) {
    const context = PromptEngine.buildContext(shotProject(fields), "S-01", "");
    assert.strictEqual(context.shot.durationSeconds, seconds, `${label}: effective duration`);
    assert.strictEqual(context.shot.durationWasDefaulted, defaulted, `${label}: durationWasDefaulted`);
  }
}

function testDurationAliasPrecedenceIsDeterministic() {
  assert.strictEqual(resolveShotDuration({ dur: 4, sec: 7, duration: 9 }).field, "dur", "the field every current writer produces must win");
  assert.strictEqual(resolveShotDuration({ sec: 7, duration: 9 }).field, "sec", "sec must outrank duration, as the report readers have always read them");
  assert.strictEqual(resolveShotDuration({ duration: 9 }).field, "duration");
  /* A shot split into motion units is as long as its units. Unchanged. */
  const withClips = resolveShotDuration({ dur: 30, clips: [{ dur: 4 }, { duration: 6 }] });
  assert.strictEqual(withClips.seconds, 10, "declared motion-unit durations must still total the shot, under any alias");
  assert.strictEqual(withClips.wasDefaulted, false);
}

function testInvalidDurationsStillFallThrough() {
  for (const invalid of [{ dur: 0 }, { dur: "" }, { dur: null }, { dur: -3 }, { dur: "abc" }, { dur: NaN }, { dur: Infinity }]) {
    const resolved = resolveShotDuration(invalid);
    assert.strictEqual(resolved.seconds, 5, `${JSON.stringify(invalid)} must fall through to the safe default`);
    assert.strictEqual(resolved.wasDefaulted, true, `${JSON.stringify(invalid)} must still count as undeclared`);
  }
  /* An unusable canonical value must not shadow a usable historical one. */
  assert.strictEqual(resolveShotDuration({ dur: 0, duration: 4 }).seconds, 4, "an invalid dur must not hide a valid legacy alias");
}

/* The defect exactly as shipped. */
function testShippedSampleShotKeepsItsStoredDuration() {
  const sample = readSample();
  const shot = sample.shots.find((row) => row.id === "SAMPLE-03");
  assert(shot, "the sample must still contain SAMPLE-03");
  assert.strictEqual(shot.dur, undefined, "precondition: SAMPLE-03 stores no `dur`");
  assert.strictEqual(shot.duration, 4, "precondition: SAMPLE-03 declares four seconds under the historical alias");
  const context = PromptEngine.buildContext(sample, "SAMPLE-03", "");
  assert.strictEqual(context.shot.durationSeconds, 4, "a shot that declares four seconds must compile as four seconds");
  assert.strictEqual(context.shot.durationWasDefaulted, false, "a declared duration must never be reported as defaulted");
}

/* ---------------------------------------------------------------- F3 ---- */

/* Sanitised synthetic fixture, patterned after the token shapes the audit
   found in historical data. No real production data is used. */
function codesFixture() {
  return shotProject(
    { codes: ["LOC-HULL", "LOC-HULL-A", "KAI-ANCHOR-01", "PROP-RIG_HANDS-01", "STAGE-3"] },
    {
      characters: [{ id: "KAI", name: "Kai", block: "A rigger." }],
      locations: [{ id: "LOC-HULL", name: "Hull", description: "An open hull section." }],
      props: [{ id: "PROP-RIG", name: "Rig", notes: "A climbing rig." }],
    },
  );
}

function testCodeTokensAreClassifiedWithoutChangingResolution() {
  const project = codesFixture();
  const rows = classifyShotCodeTokens(project, project.shots[0]);
  const byToken = Object.fromEntries(rows.map((row) => [row.token, row]));

  assert.strictEqual(byToken["LOC-HULL"].status, "exact", "an exact id must be classified as exact");
  assert.strictEqual(byToken["LOC-HULL"].discarded, "", "an exact id discards nothing");

  assert.strictEqual(byToken["LOC-HULL-A"].status, "reinterpreted");
  assert.strictEqual(byToken["LOC-HULL-A"].id, "LOC-HULL", "resolution itself must be unchanged");
  assert.strictEqual(byToken["LOC-HULL-A"].discarded, "-A", "the discarded specificity must be named");

  assert.strictEqual(byToken["KAI-ANCHOR-01"].status, "reinterpreted");
  assert.strictEqual(byToken["KAI-ANCHOR-01"].id, "KAI");
  assert.strictEqual(byToken["KAI-ANCHOR-01"].discarded, "-ANCHOR-01");

  assert.strictEqual(byToken["PROP-RIG_HANDS-01"].status, "reinterpreted", "the underscore compatibility form must be classified too");
  assert.strictEqual(byToken["PROP-RIG_HANDS-01"].id, "PROP-RIG");

  assert.strictEqual(byToken["STAGE-3"].status, "unresolved", "a token naming nothing must be classified as unresolved");
  assert.strictEqual(byToken["STAGE-3"].id, "");

  /* The runtime resolvers must still see exactly what they saw before. */
  const resolved = PromptEngine.resolveShotEntities(project, project.shots[0]);
  assert.deepStrictEqual(resolved.characters.map((row) => row.id), ["KAI"]);
  assert.deepStrictEqual(resolved.locations.map((row) => row.id), ["LOC-HULL"]);
  assert.deepStrictEqual(resolved.props.map((row) => row.id), ["PROP-RIG"]);
  assert.deepStrictEqual(lossyShotCodeTokens(project, project.shots[0]).map((row) => row.token),
    ["LOC-HULL-A", "KAI-ANCHOR-01", "PROP-RIG_HANDS-01", "STAGE-3"],
    "every token except the exact one must be reported as lossy");
}

function testAmbiguousCodeTokenIsReportedWithoutPickingANewWinner() {
  const project = shotProject(
    { codes: ["KAI-ANCHOR-01"] },
    {
      characters: [{ id: "KAI", name: "Kai" }],
      props: [{ id: "KAI-ANCHOR", name: "Kai's anchor" }],
    },
  );
  const [row] = classifyShotCodeTokens(project, project.shots[0]);
  assert.strictEqual(row.status, "ambiguous", "a token matching two entities must be reported as ambiguous");
  assert.deepStrictEqual(row.matches.map((match) => match.id).sort(), ["KAI", "KAI-ANCHOR"]);
  /* Both still resolve, exactly as before. Diagnostics do not choose. */
  const resolved = PromptEngine.resolveShotEntities(project, project.shots[0]);
  assert.deepStrictEqual(resolved.characters.map((item) => item.id), ["KAI"]);
  assert.deepStrictEqual(resolved.props.map((item) => item.id), ["KAI-ANCHOR"]);
}

function testExactCodesStayQuiet() {
  const project = shotProject(
    { codes: ["LOC-HULL", "KAI"] },
    { characters: [{ id: "KAI", name: "Kai" }], locations: [{ id: "LOC-HULL", name: "Hull" }] },
  );
  assert.deepStrictEqual(lossyShotCodeTokens(project, project.shots[0]), [], "exact ids must produce no diagnostics at all");
  const sample = readSample();
  for (const shot of sample.shots)
    assert.deepStrictEqual(lossyShotCodeTokens(sample, shot), [], `the shipped sample's ${shot.id} must stay quiet`);
}

/* ------------------------------------------------------ F3 in readiness -- */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: "GET" }, (res) => {
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
    req.end();
  });
}

async function testReadinessSurfacesLossyAndUnknownCodes() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-intent-loss-"));
  const projectsRoot = path.join(temp, "projects");
  const configPath = path.join(temp, "config.json");
  const dir = path.join(projectsRoot, "codes-fixture");
  fs.mkdirSync(dir, { recursive: true });

  const project = codesFixture();
  project.meta = { ...project.meta, title: "Codes fixture", hubVersion: "v6.0.0", schemaVersion: "6.6" };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
  fs.writeFileSync(configPath, JSON.stringify({
    activeProject: "codes-fixture",
    assistant: { provider: "none", visionProvider: "none" },
    agents: { enabled: false },
    generation: { fal: { enabled: false, apiKey: "" } },
  }, null, 2));

  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_PROJECTS_ROOT: projectsRoot, CINEBRAID_CONFIG_PATH: configPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    const deadline = Date.now() + 10000;
    for (;;) {
      if (child.exitCode != null) throw new Error(`server exited early: ${output}`);
      try {
        if ((await request(port, "/api/projects")).status === 200) break;
      } catch (_) {}
      if (Date.now() > deadline) throw new Error(`server did not start: ${output}`);
      await wait(100);
    }

    const response = await request(port, "/api/project/readiness");
    assert.strictEqual(response.status, 200);
    const issues = response.data.setup.issues || [];
    const kinds = issues.map((row) => row.kind);

    const reinterpreted = issues.filter((row) => row.kind === "code-reinterpreted");
    assert.strictEqual(reinterpreted.length, 3, `three tokens lose specificity; readiness reported ${JSON.stringify(kinds)}`);
    const hull = reinterpreted.find((row) => row.message.includes("LOC-HULL-A"));
    assert(hull, "the reinterpreted location token must be named in a readiness issue");
    assert(hull.message.includes("LOC-HULL"), "the issue must name what the token actually resolved to");
    assert(/specificity/i.test(hull.message), "the issue must say plainly that specificity is lost");
    assert.strictEqual(hull.shotId, "S-01", "the issue must point at the shot that carries the token");

    const unresolved = issues.filter((row) => row.kind === "code-unresolved");
    assert.strictEqual(unresolved.length, 1, "the token that names nothing must produce exactly one issue");
    assert(unresolved[0].message.includes("STAGE-3"), "the unknown token must be named");
    assert(!kinds.includes("code-ambiguous"), "this fixture has no ambiguous token");
  } finally {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), wait(1500)]);
      if (child.exitCode == null) child.kill("SIGKILL");
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------- F4 / G ---- */

const evaluate = (rendered, expression) => vm.runInContext(expression, rendered.context);

function coverageScan() {
  const names = ["CHAR-IREN-PRIMARY.png", "CHAR-IREN-TURNAROUND.png"];
  return {
    anchors: names.map((name) => ({ name, url: `/assets/anchors/${name}` })),
    plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { "L1-01": { takes: [], locked: [] } },
  };
}

function legacyCoverageProject(kind) {
  const project = buildFixture();
  project.meta.hubVersion = "v6.0.0";
  project.meta.schemaVersion = "6.6";
  const character = project.characters[0];
  character.id = "CHAR-IREN";
  character.name = "Iren";
  character.approvedFile = "CHAR-IREN-PRIMARY.png";
  character.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "CHAR-IREN-PRIMARY.png" }];
  if (kind === "sheet") {
    character.candidateFiles = [{ stored: "CHAR-IREN-TURNAROUND.png", original: "CHAR-IREN-TURNAROUND.png", decision: "approved", coverageJobType: "sheet", coverageSheetType: "angles" }];
    character.coverageSlots = [{ id: "front", label: "Front", required: true, approvedFile: "CHAR-IREN-TURNAROUND.png", notes: "Approved by the director.", status: "approved", replacementHistory: [] }];
  } else {
    character.candidateFiles = [];
    character.coverageSlots = [{ id: "front-three-quarter", label: "3/4 front", required: true, approvedFile: "CHAR-IREN-PRIMARY.png", notes: "Automatically seeded from the first approved primary reference.", status: "approved", replacementHistory: [], provenance: { source: "primary-approved-reference" } }];
  }
  project.shots[0].characters = ["CHAR-IREN"];
  return project;
}

/* The heart of it: a filmmaker's approval must survive being looked at. */
async function testLoadDoesNotClearApprovedReferences() {
  for (const [kind, slotId, file] of [
    ["sheet", "front", "CHAR-IREN-TURNAROUND.png"],
    ["seed", "front-three-quarter", "CHAR-IREN-PRIMARY.png"],
  ]) {
    const rendered = await render("#/character/CHAR-IREN", legacyCoverageProject(kind), { scan: coverageScan() });
    const state = evaluate(rendered, `(() => {
      const entity = P.characters.find((row) => row.id === "CHAR-IREN");
      const slot = (entity.coverageSlots || []).find((row) => row.id === ${JSON.stringify(slotId)});
      /* The slot value moved key on load: approvedFile became selectedFile, so
         a supporting reference no longer carries the word approved. The
         assertion is about the VALUE surviving, which is what "a project must
         not become less complete for having been opened" actually means. */
      return {
        file: slot ? (slot.selectedFile || slot.approvedFile) : null,
        legacyKey: slot ? slot.approvedFile : null,
        status: slot ? slot.status : null,
        notes: slot ? slot.notes : null,
        history: entity.coverageMigrationHistory || [],
        warnings: (P.meta.dataIntegrityWarnings || []),
      };
    })()`);
    assert.strictEqual(state.file, file, `${kind}: opening a project must not clear a persisted approved reference`);
    /* CHANGED IN BATCH 1C — "approved" -> "selected", and this suite's own
       subject is why. `status` is not persisted intent: the load normaliser
       recomputes it from `approvedFile` presence every time, before and after
       this change. What this line pinned was that derivation, and the
       derivation was producing an authority word for a supporting reference —
       which silently reverted any slot a routed writer had correctly saved as a
       selection.

       What THIS test is for is untouched and still asserted on either side of
       this line: the filename survives, the filmmaker's note survives, no
       migration history is invented, and the legacy condition is reported by
       name. Nothing was lost on load; one derived label got honest. */
    assert.strictEqual(state.status, "selected", `${kind}: the preserved reference is a supporting-reference selection, not a derived approval`);
    assert(String(state.notes || "").trim(), `${kind}: the filmmaker's own note must survive the load`);
    assert.deepStrictEqual(Array.from(state.history), [], `${kind}: a mere load must not record a migration it did not perform`);
    /* Preserved, but not hidden. */
    assert(state.warnings.length >= 1, `${kind}: the legacy condition must still be reported`);
    assert(state.warnings.some((warning) => warning.includes(file)), `${kind}: the warning must name the file it is about`);
    assert(state.warnings.some((warning) => /Iren/.test(warning)), `${kind}: the warning must name the entity`);
  }
}

/* Opening a project is not a migration. */
async function testOpeningTheShippedSampleChangesNothing() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-open-read-"));
  const file = path.join(temp, "project.json");
  try {
    fs.copyFileSync(SAMPLE_FILE, file);
    const before = fs.readFileSync(file);
    const puts = [];
    const rendered = await render("#/production", JSON.parse(before.toString("utf8")), {
      fetch: async (url, options = {}, respond) => {
        if (options.method === "PUT" && /^\/api\/projects\/[^/]+\/project$/.test(url)) {
          puts.push(options.body);
          fs.writeFileSync(file, JSON.stringify(JSON.parse(options.body), null, 2));
          return respond({ ok: true });
        }
        return null;
      },
    });
    await wait(800); // outlast the autosave debounce
    assert.strictEqual(puts.length, 0, "opening the shipped sample must not issue a single project write");
    assert(fs.readFileSync(file).equals(before), "opening the shipped sample must leave its bytes identical");

    /* Bytes alone would also be satisfied by a load that mangled the record in
       memory and simply had not saved yet, so the approvals themselves are
       checked too. Normalization may still raise a record to the baseline
       shape in memory — that is the documented D1 behaviour and is why the
       whole record is not compared here — but nothing a filmmaker approved
       may be dropped on the way. */
    const stored = JSON.parse(before.toString("utf8"));
    const approvalsOnDisk = [];
    for (const list of ["characters", "locations", "props", "vehicles"])
      for (const entity of stored[list] || [])
        for (const slot of entity.coverageSlots || [])
          if (slot.approvedFile) approvalsOnDisk.push([list, entity.id, slot.id, slot.approvedFile]);
    assert(approvalsOnDisk.length >= 4, "precondition: the sample must ship with approved coverage views to protect");
    const loaded = JSON.parse(evaluate(rendered, "JSON.stringify(P)"));
    for (const [list, entityId, slotId, file] of approvalsOnDisk) {
      const entity = (loaded[list] || []).find((row) => row.id === entityId);
      const slot = (entity?.coverageSlots || []).find((row) => row.id === slotId);
      /* The KEY moved on load — approvedFile becomes selectedFile, so a
         supporting reference stops carrying the word approved — and the VALUE
         is what must survive. The shipped bytes are unchanged, asserted twenty
         lines up along with zero project writes. */
      assert.strictEqual(slot?.selectedFile || slot?.approvedFile, file, `opening the sample must not disturb ${entityId}/${slotId}`);
      /* CHANGED IN BATCH 1C, and squarely inside the allowance the comment
         above already makes: normalization raises a record to the baseline
         shape IN MEMORY, and `status` is one of the fields it derives. The
         derivation now produces "selected" for a coverage view, because a view
         is a supporting reference.

         THE SHIPPED SAMPLE'S BYTES ARE UNCHANGED — asserted twenty lines up,
         along with zero project writes — so no stored value was migrated by
         this. The file each slot points at is asserted on the line above and is
         identical. What changed is one derived in-memory label. */
      assert.strictEqual(slot?.status, "selected", `${entityId}/${slotId} must remain a selected supporting view after a mere load`);
    }
    for (const shot of stored.shots || []) {
      const context = PromptEngine.buildContext(loaded, shot.id, "");
      assert.strictEqual(context.shot.durationWasDefaulted, false, `${shot.id} declares a duration, so opening must not default it`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/* ------------------------------------------------- current-format shape --- */

/* A 30-second project written the way the current UI writes one: descriptions
   in creationDescription, explicit five-second shots, continuity state
   selections, first/last-frame planning, and several entities per shot.

   This mirrors the structure of the separately prepared dogfood project rather
   than reading it — a private test project is not a repository fixture — and
   exists so the P-1 repairs are exercised against a whole current-format
   project instead of only against single-defect fixtures. */
function currentFormatProject() {
  const entity = (id, name, kind) => ({
    id, name,
    creationDescription: `${name} — ${AUTHORED}`,
    continuityStates: [
      { id: "state-default", name: "Default", isDefault: true, approvedFile: `${id}.png` },
      { id: "state-worn", name: "Worn", isDefault: false, parentStateId: "state-default", approvedFile: "" },
    ],
    approvedFile: `${id}.png`,
    kind,
  });
  const shots = Array.from({ length: 6 }, (_, index) => {
    const id = `THR-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      scene: "SC-THREAD",
      title: `Thread shot ${index + 1}`,
      desc: `A described beat, number ${index + 1}.`,
      dur: 5,
      characters: ["CHAR-WEAVER"],
      codes: ["LOC-LOFT", "PROP-SPOOL"],
      continuityStateSelections: { "CHAR-WEAVER": index > 2 ? "state-worn" : "state-default" },
      keyframes: [
        { id: "frame-a", label: "A", title: "First frame", description: `Opening of beat ${index + 1}.`, required: true },
        { id: "frame-b", label: "B", title: "Last frame", description: `Close of beat ${index + 1}.`, required: true },
      ],
      clips: [],
      creationBrief: { deliveryIntent: "motion", locationId: "LOC-LOFT", propIds: ["PROP-SPOOL"], frames: [], motionPlan: { audio: { mode: "none" } } },
    };
  });
  return {
    meta: { title: "Current-format shape", hubVersion: "v6.0.0", schemaVersion: "6.6" },
    characters: [entity("CHAR-WEAVER", "The weaver", "character")],
    locations: [entity("LOC-LOFT", "The loft", "location")],
    props: [entity("PROP-SPOOL", "The spool", "prop")],
    vehicles: [], audio: [],
    scenes: [{ id: "SC-THREAD", title: "The thread", whatHappens: "A thread is spun and broken.", howItFeels: "Patient, then sudden." }],
    shots,
  };
}

function testCurrentFormatProjectLosesNothing() {
  const project = currentFormatProject();
  let total = 0;
  for (const shot of project.shots) {
    const context = PromptEngine.buildContext(project, shot.id, "");
    assert.strictEqual(context.shot.durationSeconds, 5, `${shot.id}: an explicit five-second shot must compile as five seconds`);
    assert.strictEqual(context.shot.durationWasDefaulted, false, `${shot.id}: an explicit duration must never read as defaulted`);
    total += context.shot.durationSeconds;

    const ids = (context.references || []).map((row) => row.id).sort();
    assert.deepStrictEqual(ids, ["CHAR-WEAVER", "LOC-LOFT", "PROP-SPOOL"], `${shot.id}: every declared dependency must resolve`);
    for (const reference of context.references)
      assert(reference.canon.includes(AUTHORED), `${shot.id}: ${reference.id} must carry its authored description into generation`);

    assert.deepStrictEqual(lossyShotCodeTokens(project, shot), [], `${shot.id}: exact ids must stay quiet`);
    /* A continuity state selection is a dependency the shot declares, so it
       must be resolvable rather than silently ignored. */
    const selected = Object.keys(shot.continuityStateSelections);
    for (const entityId of selected)
      assert(ids.includes(entityId), `${shot.id}: the entity a continuity state was selected for must resolve`);
    assert.strictEqual(shot.keyframes.length, 2, `${shot.id}: first and last frame planning must survive the fixture`);
  }
  assert.strictEqual(total, 30, "the whole project must compile to its declared thirty seconds");
}

async function main() {
  testAuthoredDescriptionReachesTheCompiler();
  testAuthoredDescriptionReachesTheCompilerForNonCharacters();
  testExistingDescriptionPrecedenceIsUnchanged();
  testSampleEntityCanonIsVisibleToTheCompiler();
  testDurationAliasesAreAllHonoured();
  testDurationAliasPrecedenceIsDeterministic();
  testInvalidDurationsStillFallThrough();
  testShippedSampleShotKeepsItsStoredDuration();
  testCodeTokensAreClassifiedWithoutChangingResolution();
  testAmbiguousCodeTokenIsReportedWithoutPickingANewWinner();
  testExactCodesStayQuiet();
  testCurrentFormatProjectLosesNothing();
  await testReadinessSurfacesLossyAndUnknownCodes();
  await testLoadDoesNotClearApprovedReferences();
  await testOpeningTheShippedSampleChangesNothing();
  console.log(
    "Intent-loss safety suite passed: authored entity descriptions reach the compiler, every historical duration alias survives compilation, lossy and unknown shot codes are visible in readiness without changing resolution, and opening a project neither clears an approval nor rewrites a byte.",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
