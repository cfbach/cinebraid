/* Generation binding — negative controls.
 *
 * A guard that has never been seen to fail is a guard nobody has tested. Each control
 * below reintroduces one of the six ways this record could lie, IN MEMORY, proves the
 * defect is genuinely live against the mutated module, and then proves the property that
 * guards it goes red.
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Every mutation is a string
 * transformation compiled into an in-memory Module. A control that edited a file and
 * undid it with a checkout would discard unstaged work the first time one of these threw.
 *
 * Every anchor tolerates \r?\n. `core.autocrlf` is true in this working tree, so a
 * literal "\n" anchor stops matching the moment git re-checks a file out — and a
 * `String.replace` that matches nothing returns the source untouched, which would make
 * the control report a pass having tested nothing. `mutated()` refuses that outright,
 * and it self-tests before any control runs.
 *
 * Every control also carries a LIVE-DEFECT RECEIPT: the mutation must actually change
 * the answer before the guarding assertion is consulted. A control that guards itself
 * with the same assertion it is testing is reporting on itself.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const { KAI, HANGAR } = require("./generation-compiler-fixture");
const { withGenerationDeclaration } = require("./generation-request-fixture");

const ROOT = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

/* A mutated module compiled under its real filename, so its own relative requires
   resolve exactly as they do on disk. The file is opened read-only. */
function compileModule(relative, source) {
  const filename = path.join(ROOT, relative);
  const compiled = new Module(filename, null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

function mutated(relative, transform) {
  const original = read(relative);
  const source = String(transform(original));
  assert.notStrictEqual(source, original,
    `the control for ${relative} changed nothing; it would report a pass without testing anything`);
  return source;
}

/* Every production file any control below rewrites in memory, fingerprinted before and
   after the run. "Nothing is written to disk" is a claim this suite makes in its own
   summary line, and this is its evidence. */
const MUTATED_FILES = ["generation-binding.js", "fal-generation.js"];
function sourceFingerprints() {
  return Object.fromEntries(MUTATED_FILES.map((relative) =>
    [relative, crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex")]));
}

const BYTES = {
  "A.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64"),
  "C.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC", "base64"),
  "KAI.png": Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d76360000000020001", "hex"),
  "KAI-RAIN.png": Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d76364000000030001", "hex"),
  "KAI-STORM.png": Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d7636c000000050001", "hex"),
};
const MP4 = Buffer.from("00000018667479706d703432000000006d703432", "hex");
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const A_PNG = "/assets/shots/SH-1/takes/A.png";
const C_PNG = "/assets/shots/SH-1/takes/C.png";
const KAI_PNG = "/assets/anchors/KAI.png";
const KAI_RAIN_PNG = "/assets/anchors/KAI-RAIN.png";
const KAI_STORM_PNG = "/assets/shots/SH-1/takes/KAI-STORM.png";
const TRACK_MP4 = "/assets/media/track.mp4";

/* ---------------------------------------------------------------------------
   A disposable project on disk, so the injected file resolver and the real hasher run
   exactly as they do at dispatch. Torn down at the end of the run. */
let SANDBOX = "";
function sandbox() {
  if (SANDBOX) return SANDBOX;
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-binding-nc-"));
  fs.mkdirSync(path.join(SANDBOX, "shots", "SH-1", "takes"), { recursive: true });
  fs.mkdirSync(path.join(SANDBOX, "anchors"), { recursive: true });
  fs.mkdirSync(path.join(SANDBOX, "media"), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, "shots", "SH-1", "takes", "A.png"), BYTES["A.png"]);
  fs.writeFileSync(path.join(SANDBOX, "shots", "SH-1", "takes", "C.png"), BYTES["C.png"]);
  fs.writeFileSync(path.join(SANDBOX, "anchors", "KAI.png"), BYTES["KAI.png"]);
  fs.writeFileSync(path.join(SANDBOX, "anchors", "KAI-RAIN.png"), BYTES["KAI-RAIN.png"]);
  fs.writeFileSync(path.join(SANDBOX, "shots", "SH-1", "takes", "KAI-STORM.png"), BYTES["KAI-STORM.png"]);
  fs.writeFileSync(path.join(SANDBOX, "media", "track.mp4"), MP4);
  return SANDBOX;
}
function resolveFile(address) {
  const rel = String(address).replace(/^\/assets\//, "");
  const file = path.join(sandbox(), rel);
  if (!fs.existsSync(file)) throw new Error(`missing: ${rel}`);
  return file;
}
/* No hasher is injected anywhere below. The shipped default — CineBraid's shared media
   digest, owned by generation-binding.js — is what every case here runs. */

/* The project the controls reason about. Frame A declares Kai's non-default state, which
   is the disagreement NC-1 is built on. */
function project() {
  return {
    shots: [{
      id: "SH-1",
      keyframes: [
        { id: "FR-A", label: "A", winner: "A.png" },
        { id: "FR-B", label: "B", winner: "KAI-STORM.png" },
        { id: "FR-C", label: "C", winner: "C.png" },
      ],
      candidateFiles: [
        { stored: "A.png", frameId: "FR-A" },
        { stored: "C.png", frameId: "FR-C" },
        /* Frame B owns Kai's storm authority — the file NC-12's request consumes while
           targeting Frame A. */
        { stored: "KAI-STORM.png", frameId: "FR-B" },
      ],
      creationBrief: {
        frameWorkflows: {
          "FR-A": { characterStateSelections: { [KAI]: "state-rain" } },
          "FR-B": { characterStateSelections: { [KAI]: "state-storm" } },
        },
      },
    }],
    characters: [{
      id: KAI, name: "Kai", approvedFile: "KAI.png",
      continuityStates: [
        { id: "state-default", name: "Default", isDefault: true, approvedFile: "KAI.png" },
        { id: "state-rain", name: "Rain-soaked", approvedFile: "KAI-RAIN.png" },
        { id: "state-storm", name: "Storm-lashed", approvedFile: "KAI-STORM.png" },
      ],
    }],
    /* Declares NO continuity states, which is what NC-7 is built on. */
    locations: [{ id: HANGAR, name: "Hangar 4", approvedFile: "HANGAR.png", continuityStates: [] }],
    props: [], vehicles: [],
  };
}

/* A compiled plan and a serializer result, in the shapes the dispatcher hands over.
   Written out rather than compiled from a build so a control can express a set of
   consumed inputs directly — including the case where the plan carries a reference the
   serializer did not consume. */
function planFor(references) {
  return { inputs: { prompt: "x", references } };
}
const planRef = (refId, role, mediaType, url, order) => ({
  refId, role, mediaType, source: { kind: "project-asset", path: url },
  production: { label: refId, purpose: role }, required: true, order,
});
const bound = (refId, role, mediaType, field, index, order) => ({ refId, role, mediaType, field, index, order });

/* The FLF case every control can share: two endpoints, two frames, two files. */
function flfCase() {
  const references = [planRef("kf-a", "first-frame", "image", A_PNG, 0), planRef("kf-c", "last-frame", "image", C_PNG, 1)];
  return {
    plan: planFor(references),
    serialized: { bindings: [bound("kf-a", "first-frame", "image", "image_url", null, 0), bound("kf-c", "last-frame", "image", "end_image_url", null, 1)] },
    sourceReferences: [{ refId: "kf-a", entityId: "" }, { refId: "kf-c", entityId: "" }],
    project: project(),
    shot: project().shots[0],
    frameId: "",
    resolveFile,
  };
}

/* The still-frame case: an entity reference on a frame that declares a non-default
   state, which is what the continuity property is asserted against. */
function frameCase() {
  const references = [planRef("id-kai", "identity", "image", KAI_RAIN_PNG, 0)];
  return {
    plan: planFor(references),
    serialized: { bindings: [bound("id-kai", "identity", "image", "image_urls", 0, 0)] },
    sourceReferences: [{ refId: "id-kai", entityId: KAI }],
    project: project(),
    shot: project().shots[0],
    frameId: "FR-A",
    resolveFile,
  };
}

/* The i2v case where the pack refused a video reference: the BUILD carries two
   references, the plan and the request carry one. */
function droppedCase() {
  const references = [planRef("kf-a", "first-frame", "image", A_PNG, 0)];
  return {
    plan: planFor(references),
    serialized: { bindings: [bound("kf-a", "first-frame", "image", "image_url", null, 0)] },
    sourceReferences: [
      { refId: "kf-a", entityId: "" },
      /* The refused one. It is on the package the filmmaker assembled and reached
         nothing. */
      { refId: "mo-1", entityId: "", role: "motion-reference", mediaType: "video", path: TRACK_MP4 },
    ],
    project: project(),
    shot: project().shots[0],
    frameId: "",
    resolveFile,
  };
}

/* ---------------------------------------------------------------------------
   ONE REAL UNCOMPILED DISPATCH, through whichever fal-generation module is handed in.

   The uncompiled routes have no plan and no serializer, so nothing about them can be
   proved by inspecting a compiled artefact — the payload only exists at dispatch. These
   controls therefore run the real handler and read the ledger at the barrier, the same
   way NC-6a does.

   Returns the response AND the row as it stood when the paid request arrived, plus null
   for both when the request was refused before reaching the provider. */
async function dispatchLegacyOnce(FalModule, body) {
  const express = require("express");
  const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-binding-legacy-"));
  fs.mkdirSync(path.join(dir, "anchors"), { recursive: true });
  fs.writeFileSync(path.join(dir, "anchors", "KAI.png"), BYTES["KAI.png"]);
  fs.writeFileSync(path.join(dir, "anchors", "KAI-RAIN.png"), BYTES["KAI-RAIN.png"]);
  const file = path.join(dir, "project.json");
  fs.writeFileSync(file, JSON.stringify(project(), null, 2));

  const calls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    let ledgerAtRequest = [];
    try {
      ledgerAtRequest = JSON.parse(fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8"));
    } catch { ledgerAtRequest = []; }
    calls.push({ endpoint: req.path, body: req.body, ledgerAtRequest });
    res.json({ request_id: "legacy-1", status_url: "", response_url: "", cancel_url: "" });
  });
  const mockServer = await listen(mock);
  const mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

  const SLUG = "legacy-nc";
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  FalModule.registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "k", baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit", maxConcurrent: 2,
    } } }),
    readProject: () => JSON.parse(fs.readFileSync(file, "utf8")),
    writeProject: (next) => fs.writeFileSync(file, JSON.stringify(next, null, 2)),
    activeSlug: () => SLUG,
    projectDirForSlug: () => ({ slug: SLUG, dir, file }),
  });
  const appServer = await listen(app);
  const appOrigin = `http://127.0.0.1:${appServer.address().port}`;

  try {
    const response = await fetch(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(withGenerationDeclaration("/api/generation/fal/jobs", body)),
    });
    const data = await response.json();
    const jobId = data?.job?.id || "";
    let ledger = [];
    try {
      ledger = JSON.parse(fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8"));
    } catch { ledger = []; }
    return {
      status: response.status,
      data,
      calls,
      stored: jobId ? ledger.find((row) => row.id === jobId) || null : null,
      ledger,
      atBarrier: jobId && calls[0] ? calls[0].ledgerAtRequest.find((row) => row.id === jobId) || null : null,
    };
  } finally {
    mockServer.close();
    appServer.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------------------
   ONE REAL i2v DISPATCH, through whichever fal-generation module is handed in.

   NC-6a is a claim about WHEN the record becomes durable, and the only way to see that
   is to look at the ledger at the instant the paid request arrives — which is what the
   mock does before it answers. A source-shaped assertion would prove an edit happened
   and nothing about the boundary.

   Each call gets its own project directory, its own mock and its own ports, so the two
   modules cannot observe each other. Nothing outside the sandbox is touched. */
async function dispatchOnce(FalModule) {
  const express = require("express");
  const { registerPromptBuild, promptBuildRef } = require("../public/shared-build-history");
  const { baseSpec } = require("./generation-compiler-fixture");

  const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-binding-nc6a-"));
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "A.png"), BYTES["A.png"]);
  const file = path.join(dir, "project.json");

  const document = project();
  const shot = document.shots[0];
  shot.creationBrief.motionPromptBuilds = [];
  const buildId = registerPromptBuild(document, {
    id: "nc6a-build", packageId: "NC6A-R01", date: "2026-08-16T00:00:00.000Z",
    profileId: "minimax-h3/i2v", profileName: "MiniMax H3 — I2V", kind: "guided-motion",
    prompt: "legacy", spec: baseSpec({ shotId: "SH-1", durationSeconds: 8 }), durationSeconds: 8,
    references: [{ key: "kf-a", token: "", label: "Approved opening frame", role: "first-frame", mediaType: "image", instruction: "", entityId: "", url: A_PNG }],
  });
  shot.creationBrief.motionPromptBuilds.push(promptBuildRef(buildId, { kind: "guided-motion" }));
  fs.writeFileSync(file, JSON.stringify(document, null, 2));

  const calls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  mock.post("/minimax/h3/image-to-video", (req, res) => {
    let ledgerAtRequest = [];
    try {
      ledgerAtRequest = JSON.parse(fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8"));
    } catch { ledgerAtRequest = []; }
    calls.push({ body: req.body, ledgerAtRequest });
    res.json({ request_id: "nc6a-1", status_url: "", response_url: "", cancel_url: "" });
  });
  const mockServer = await listen(mock);
  const mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

  const SLUG = "nc6a";
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  FalModule.registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "k", baseUrl: mockOrigin,
      h3ImageModel: "minimax/h3/image-to-video", h3Resolution: "2K", maxConcurrent: 2,
    } } }),
    readProject: () => JSON.parse(fs.readFileSync(file, "utf8")),
    writeProject: (next) => fs.writeFileSync(file, JSON.stringify(next, null, 2)),
    activeSlug: () => SLUG,
    projectDirForSlug: () => ({ slug: SLUG, dir, file }),
  });
  const appServer = await listen(app);
  const appOrigin = `http://127.0.0.1:${appServer.address().port}`;

  try {
    const response = await fetch(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(withGenerationDeclaration("/api/generation/fal/jobs", {
        purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3",
        profileMode: "i2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9", clientRequestId: "nc6a",
      })),
    });
    const data = await response.json();
    assert.strictEqual(response.status, 200, `NC-6a dispatch failed: ${JSON.stringify(data)}`);
    assert.strictEqual(calls.length, 1, "exactly one request must reach the mock");
    return {
      atBarrier: calls[0].ledgerAtRequest.find((row) => row.id === data.job.id) || null,
      sentHash: sha256(Buffer.from(String(calls[0].body.image_url).split(",")[1], "base64")),
    };
  } finally {
    mockServer.close();
    appServer.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* The consumed-frame/state case: the request targets Frame A, the file it consumes
   belongs to Frame B, and the two frames declare different states for Kai. */
function crossFrameCase() {
  const references = [planRef("id-kai", "identity", "image", KAI_STORM_PNG, 0)];
  return {
    plan: planFor(references),
    serialized: { bindings: [bound("id-kai", "identity", "image", "image_urls", 0, 0)] },
    sourceReferences: [{ refId: "id-kai", entityId: KAI }],
    project: project(),
    shot: project().shots[0],
    frameId: "FR-A",
    resolveFile,
  };
}

/* TWO DIFFERENT FILES UNDER ONE REFERENCE KEY, in the shape serializeLegacyRequest
   produces: the plan view and the bindings are index-aligned because they were built in
   one pass over the dispatched payload, and both carry the repeated key. */
function duplicateKeyCase() {
  const references = [
    { ...planRef("dup", "reference", "image", KAI_PNG, 0) },
    { ...planRef("dup", "reference", "image", KAI_RAIN_PNG, 1) },
  ];
  return {
    plan: planFor(references),
    serialized: {
      bindings: [
        bound("dup", "reference", "image", "image_urls", 0, 0),
        bound("dup", "reference", "image", "image_urls", 1, 1),
      ],
    },
    sourceReferences: [{ refId: "dup", entityId: "" }, { refId: "dup", entityId: "" }],
    project: project(),
    shot: project().shots[0],
    frameId: "",
    resolveFile,
  };
}

/* An entity that declares no continuity states at all. The shared resolver answers an
   unresolved id for it with a SYNTHESISED `state-default` record, which is right for a
   renderer and is the fact NC-7 is about. */
function statelessEntityCase() {
  const references = [planRef("loc-hangar", "location", "image", A_PNG, 0)];
  return {
    plan: planFor(references),
    serialized: { bindings: [bound("loc-hangar", "location", "image", "image_urls", 0, 0)] },
    sourceReferences: [{ refId: "loc-hangar", entityId: HANGAR }],
    project: project(),
    shot: project().shots[0],
    frameId: "FR-A",
    resolveFile,
  };
}

const controls = [];
function control(id, title, run) {
  controls.push({ id, title, run });
}

/* ===========================================================================
   NC-1 — resolve the continuity state from the SHOT/Canon rather than from the
   frame this dispatch is for.

   Dropping the frameId argument is precisely the "read what the project says" defect:
   the resolver falls through the frame's declaration to the shot's, then to the
   entity's default, and answers with a state that did not select these bytes. */
control("NC-1", "resolving the state from current Canon instead of the dispatch frame", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /Continuity\.resolveDeclaredStateId\(shot, text\(frameId\), kind, text\(entityId\)\)/,
      "Continuity.resolveDeclaredStateId(shot, \"\", kind, text(entityId))",
    ));
  assert(/resolveDeclaredStateId\(shot, "", kind/.test(source), "the mutation must drop the frame scope");
  assert(!/resolveDeclaredStateId\(shot, "", kind/.test(read("generation-binding.js")), "and the shipped source must not");

  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");
  const input = frameCase();

  /* RECEIPT — THE LIVE DEFECT. The real module names the state the frame declared; the
     mutated one names the entity's default, which authorises different bytes. */
  const shipped = real.buildGenerationBinding(input)[0];
  const broken = Binding.buildGenerationBinding(input)[0];
  assert.strictEqual(shipped.stateId, "state-rain");
  assert.strictEqual(broken.stateId, "state-default", "the control must actually reintroduce the Canon read");
  assert.notStrictEqual(broken.stateId, shipped.stateId);
  assert.strictEqual(broken.stateAuthority, "unmatched",
    "and the state it names does not authorise the file that was sent");

  /* THE GUARD ITSELF, run rather than described. This is the assertion the focused
     suite makes about the continuity case; it must throw against the mutated module. */
  assert.throws(() => {
    assert.strictEqual(broken.stateId, "state-rain",
      "the record names the state this frame resolved, not the entity's default");
  }, /state-rain/);
});

/* ===========================================================================
   NC-2 — record every reference the package knows about instead of the set the
   serializer actually consumed.

   This is §3's failure exactly: a reference the configuration refused before dispatch
   reappears as evidence that it travelled. */
control("NC-2", "recording a reference that was dropped before serialization", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /return listOf\(serialized\.bindings\)\.filter\(isRecord\)\.map\(\(bound, position\) => \{/,
      "return listOf(input.sourceReferences).filter(isRecord).map((bound, position) => {",
    ));
  assert(/listOf\(input\.sourceReferences\)\.filter\(isRecord\)\.map/.test(source));

  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");
  const input = droppedCase();

  /* RECEIPT — THE LIVE DEFECT. The refused video reference is back in the record. */
  const shipped = real.buildGenerationBinding(input);
  const broken = Binding.buildGenerationBinding(input);
  assert.strictEqual(shipped.length, 1, "the shipped module records only what was consumed");
  assert.strictEqual(broken.length, 2, "the control must actually reintroduce the dropped reference");
  assert(!shipped.some((row) => row.refId === "mo-1"));
  assert(broken.some((row) => row.refId === "mo-1"), "the refused reference is recorded as consumed");

  assert.throws(() => {
    assert(!broken.some((row) => row.refId === "mo-1"), "a refused reference must not appear in the binding set");
  }, /must not appear/);
});

/* ===========================================================================
   NC-3 — omit a consumed reference.

   The mirror of NC-2, and the more dangerous direction: a record that is missing an
   input reads as a simpler generation than the one that was paid for. */
control("NC-3", "omitting a consumed reference", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /return listOf\(serialized\.bindings\)\.filter\(isRecord\)/,
      'return listOf(serialized.bindings).filter(isRecord).filter((row) => row.field !== "end_image_url")',
    ));
  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");
  const input = flfCase();

  const shipped = real.buildGenerationBinding(input);
  const broken = Binding.buildGenerationBinding(input);
  /* RECEIPT — THE LIVE DEFECT: the closing frame CineBraid paid to send is gone. */
  assert.strictEqual(shipped.length, 2);
  assert.strictEqual(broken.length, 1, "the control must actually drop the endpoint");
  assert(!broken.some((row) => row.providerField === "end_image_url"));

  assert.throws(() => {
    assert.strictEqual(broken.length, 2);
  });
  assert.throws(() => {
    const rows = broken.filter((row) => row.providerField === "end_image_url");
    assert.strictEqual(rows.length, 1, "expected exactly one binding on end_image_url, got 0");
  }, /end_image_url/);
});

/* ===========================================================================
   NC-4 — swap the FLF first/last frame identity.

   The record is swapped while the REQUEST is unchanged, which is the worst version of
   this defect: the shot renders correctly and the evidence says it opened on the frame
   it closed on. Nothing downstream would ever notice. */
control("NC-4", "swapping the FLF first and last frame identity", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /providerField: text\(bound\.field\),/,
      'providerField: bound.field === "image_url" ? "end_image_url" : bound.field === "end_image_url" ? "image_url" : text(bound.field),',
    ));
  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");
  const input = flfCase();

  const shipped = real.buildGenerationBinding(input);
  const broken = Binding.buildGenerationBinding(input);
  const first = (rows) => rows.find((row) => row.providerField === "image_url");
  const last = (rows) => rows.find((row) => row.providerField === "end_image_url");

  /* RECEIPT — THE LIVE DEFECT, stated against frame identity and against bytes. */
  assert.strictEqual(first(shipped).frameId, "FR-A");
  assert.strictEqual(last(shipped).frameId, "FR-C");
  assert.strictEqual(first(broken).frameId, "FR-C", "the control must actually swap the endpoints");
  assert.strictEqual(last(broken).frameId, "FR-A");
  assert.strictEqual(first(broken).fileHash, sha256(BYTES["C.png"]),
    "and the swap follows the bytes, so it is not a label-only difference");

  assert.throws(() => {
    assert.strictEqual(first(broken).frameId, "FR-A");
  }, /FR-A/);
  assert.throws(() => {
    assert.strictEqual(last(broken).file, C_PNG);
  });
});

/* ===========================================================================
   NC-5 — read a legacy absence as a confirmed empty binding set.

   A one-character convenience with a permanent consequence: every generation made
   before this phase would report, forever, that it used no references. */
control("NC-5", "treating a legacy absence as an empty confirmed binding set", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /if \(!Array\.isArray\(job\?\.generationBinding\)\) return \{ recorded: false, bindings: null, version: 0 \};/,
      "if (!Array.isArray(job?.generationBinding)) return { recorded: true, bindings: [], version: 0 };",
    ));
  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");

  /* A job that plainly DID consume a reference, and simply has no record of it. */
  const legacy = { id: "legacy-job", references: [{ key: "x", url: A_PNG }] };
  /* And a job that really consumed nothing. The two must not read alike. */
  const t2v = { id: "t2v-job", generationBinding: [], generationBindingVersion: 1 };

  const shipped = real.readGenerationBinding(legacy);
  const broken = Binding.readGenerationBinding(legacy);
  /* RECEIPT — THE LIVE DEFECT: the two jobs are now indistinguishable. */
  assert.strictEqual(shipped.recorded, false);
  assert.strictEqual(shipped.bindings, null);
  assert.strictEqual(broken.recorded, true, "the control must actually claim a record exists");
  assert.deepStrictEqual(broken.bindings, []);
  assert.deepStrictEqual(
    { recorded: broken.recorded, bindings: broken.bindings },
    { recorded: Binding.readGenerationBinding(t2v).recorded, bindings: Binding.readGenerationBinding(t2v).bindings },
    "a legacy job and a genuinely empty one now read identically, which is the defect",
  );

  assert.throws(() => {
    assert.strictEqual(broken.recorded, false, "a job from before this existed has no record");
  }, /has no record/);
  assert.throws(() => {
    assert.strictEqual(broken.bindings, null,
      "and it must not read as an empty binding set — the two mean opposite things");
  }, /opposite things/);
});

/* ===========================================================================
   NC-6a — attach the binding AFTER the provider request instead of before the
   durable commit.

   The capture boundary, tested as a boundary. The record would still be correct in the
   happy path, which is what makes this worth a control: it only fails when a process
   dies between sending and answering — the one moment the evidence is irreplaceable. */
control("NC-6a", "capturing the binding after the paid request instead of before the commit", async () => {
  const source = mutated("fal-generation.js", (text) =>
    text.replace(
      /(\r?\n\s*)applyBindingRecord\(job, bindingRecordFor\(owner, job, compiled, preflight\)\);/g,
      "$1/* moved after the POST by NC-6a */",
    ));
  /* RECEIPT 1 — the anchor matched both compiled branches, not one. The dispatcher has
     three writers in total; the third is the uncompiled path, which NC-8 removes on its
     own because it is reached through a different argument shape. */
  assert.strictEqual((read("fal-generation.js").match(/applyBindingRecord\(job, bindingRecordFor/g) || []).length, 3,
    "the shipped dispatcher must apply the record on both compiled branches and the uncompiled one");
  assert.strictEqual((source.match(/applyBindingRecord\(job, bindingRecordFor\(owner, job, compiled, preflight\)/g) || []).length, 0,
    "the control must actually remove the compiled pre-commit capture");

  /* RECEIPT 2 — THE LIVE DEFECT, DISPATCHED. Both modules run the same i2v submission
     against the same project, and the row is read from disk at the barrier: the instant
     the paid POST arrives and before anything answers. That is the only moment this
     defect is visible — the mutated module would still attach a correct binding to the
     response, and a happy-path assertion would pass against it. */
  const shipped = await dispatchOnce(require("../fal-generation"));
  const broken = await dispatchOnce(compileModule("fal-generation.js", source));

  assert(shipped.atBarrier, "the shipped row exists at the barrier");
  assert(broken.atBarrier, "and so does the mutated one — only its evidence is missing");
  assert(Array.isArray(shipped.atBarrier.generationBinding),
    "the shipped dispatcher freezes the binding before the paid request");
  assert.strictEqual(shipped.atBarrier.generationBinding.length, 1);
  assert.strictEqual(broken.atBarrier.generationBinding, undefined,
    "the control must actually leave the durable row without evidence at the moment of the charge");
  /* And both really did send the same request, so the difference is the record and not
     the dispatch. */
  assert.strictEqual(shipped.sentHash, broken.sentHash, "both modules sent identical bytes");

  /* THE GUARD ITSELF — the focused suite's barrier assertion, run against the row the
     mutated dispatcher actually left behind. */
  assert.throws(() => {
    const atBarrier = broken.atBarrier;
    assert.strictEqual(atBarrier.generationBinding[0].fileHash, shipped.atBarrier.generationBinding[0].fileHash,
      "the binding is frozen before the POST, not attached to the response");
  });
});

/* ===========================================================================
   NC-6b — let a later project-state change rewrite historical evidence.

   The helpful reader: one that re-resolves the state from the project it is handed
   instead of returning what was recorded. It looks like an improvement and it destroys
   the only property the record has. */
control("NC-6b", "re-resolving a historical binding from current project state on read", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /function readGenerationBinding\(job\) \{/,
      "function readGenerationBinding(job, currentProject, currentShot) {",
    ).replace(
      /return \{(\r?\n\s*)recorded: true,(\r?\n\s*)bindings: job\.generationBinding,/,
      "return {$1recorded: true,$2bindings: job.generationBinding.map((row) => ({ ...row, ...resolveConsumedState(currentProject, currentShot, job.frameId, row.list, row.entityId, row.file) })),",
    ));
  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");

  /* A job recorded when Frame A declared the rain-soaked state. */
  const recorded = real.buildGenerationBinding(frameCase());
  assert.strictEqual(recorded[0].stateId, "state-rain");
  const job = { id: "j1", frameId: "FR-A", generationBindingVersion: 1, generationBinding: recorded };

  /* Production moves on: the frame re-declares the default. */
  const later = project();
  later.shots[0].creationBrief.frameWorkflows["FR-A"].characterStateSelections[KAI] = "state-default";

  /* RECEIPT — THE LIVE DEFECT: the same job now reports a different state. */
  const shipped = real.readGenerationBinding(job).bindings[0];
  const broken = Binding.readGenerationBinding(job, later, later.shots[0]).bindings[0];
  assert.strictEqual(shipped.stateId, "state-rain", "the shipped reader returns what was recorded");
  assert.strictEqual(broken.stateId, "state-default", "the control must actually rewrite the history");
  assert.notStrictEqual(broken.stateId, shipped.stateId);

  assert.throws(() => {
    assert.strictEqual(broken.stateId, "state-rain", "still the state that was resolved at dispatch");
  }, /resolved at dispatch/);
  assert.throws(() => {
    assert.strictEqual(JSON.stringify([broken]), JSON.stringify(recorded),
      "a Canon change must not rewrite an older job's binding");
  }, /must not rewrite/);
});

/* ===========================================================================
   NC-7 — write down the synthesised default state for an entity that declares
   no states at all.

   The most seductive of the seven, because it makes every binding look complete. It
   mints a continuity state that is nowhere in the project, in the one record whose
   entire value is that it can be trusted without re-deriving it. */
control("NC-7", "inventing a default continuity state for an entity that declares none", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /const own = listOf\(entity\.continuityStates\)\.some\(\(row\) => text\(row\?\.id\) === stateId\);(\r?\n\s*)if \(!stateId \|\| !own\) return empty;/,
      "const own = true;$1if (!stateId) return empty;",
    ));
  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");
  const input = statelessEntityCase();

  /* THE PREMISE, stated rather than assumed: this entity really does declare nothing. */
  assert.deepStrictEqual(input.project.locations[0].continuityStates, []);

  /* RECEIPT — THE LIVE DEFECT: a state id that exists nowhere in the project. */
  const shipped = real.buildGenerationBinding(input)[0];
  const broken = Binding.buildGenerationBinding(input)[0];
  assert.strictEqual(shipped.stateId, "", "the shipped module records no state for an entity that has none");
  assert.strictEqual(broken.stateId, "state-default", "the control must actually mint one");
  assert(!input.project.locations[0].continuityStates.some((row) => row.id === broken.stateId),
    "and the minted id is on no record anywhere in the project");

  assert.throws(() => {
    assert.strictEqual(broken.stateId, "", "an entity with no declared states has no state recorded");
  }, /no state recorded/);
});

/* The two uncompiled request bodies the controls below dispatch. */
const LEGACY_EDIT_BODY = {
  purpose: "entity-reference", entityList: "characters", entityId: KAI,
  prompt: "Kai, three-quarter view.",
  references: [{ key: "base-kai", role: "base", mediaType: "image", url: "/assets/anchors/KAI.png" }],
  /* 3:4 — referenceAspectLabel("characters"), what the shipped entity-reference
     dispatcher sends. The paid boundary refuses a format nothing offered the request, and
     a control refused by a gate other than its own has measured nothing. */
  outputCount: 1, aspectRatio: "3:4", clientRequestId: "nc-legacy-edit",
};
const LEGACY_ZERO_INPUT_BODY = {
  purpose: "blocking", shotId: "SH-1", prompt: "Flat greyscale blocking.",
  references: [], outputCount: 1, aspectRatio: "16:9", clientRequestId: "nc-legacy-zero",
};

/* ===========================================================================
   NC-8 — remove the uncompiled path's binding writer.

   The exact state the first pass shipped in: the compiled routes instrumented, the
   legacy ones not. The defect is not the missing field — it is that its absence is the
   representation reserved for jobs that predate the record, so every new legacy dispatch
   silently backdates itself. */
control("NC-8", "removing the uncompiled path's binding writer", async () => {
  const source = mutated("fal-generation.js", (text) =>
    text.replace(
      /applyBindingRecord\(job, bindingRecordFor\((\r?\n\s*)owner,[\s\S]*?preparedLegacy,(\r?\n\s*)\)\);/,
      "/* removed by NC-8 */",
    ));
  assert(/preparedLegacy = serializeLegacyRequest/.test(source),
    "the payload must still be prepared — only the RECORD is removed, or this control tests the wrong thing");

  const shipped = await dispatchLegacyOnce(require("../fal-generation"), LEGACY_EDIT_BODY);
  const broken = await dispatchLegacyOnce(compileModule("fal-generation.js", source), LEGACY_EDIT_BODY);
  assert.strictEqual(shipped.status, 200, JSON.stringify(shipped.data));
  assert.strictEqual(broken.status, 200, "the mutated dispatcher still sends — that is what makes it dangerous");

  const real = require("../generation-binding");
  /* RECEIPT — THE LIVE DEFECT: a job dispatched seconds ago now reads as history. */
  assert.strictEqual(real.readGenerationBinding(shipped.stored).recorded, true);
  assert.strictEqual(real.readGenerationBinding(broken.stored).recorded, false,
    "the control must actually strip the record");
  assert.strictEqual(real.readGenerationBinding(broken.stored).bindings, null);
  assert.strictEqual(broken.calls.length, 1, "and it was a real paid dispatch, not a refusal");

  assert.throws(() => {
    assert.strictEqual(real.readGenerationBinding(broken.stored).recorded, true,
      "a newly dispatched job always carries a record");
  }, /always carries a record/);
});

/* ===========================================================================
   NC-9 — a binding that cannot be captured must stop the paid request.

   Fail-open is the tempting choice here, because provenance capture failing is not the
   filmmaker's problem. It is the wrong one: the job would go through, be charged for,
   and record an absence that says it was made before this existed. */
control("NC-9", "letting a binding-capture failure through to the provider", async () => {
  /* THREE REPLACEMENTS, ONE DEFECT. The first two restore the fail-open shape this
     module shipped with before the correction — a catch that returns null, and a writer
     that tolerates one. The third makes the capture actually fail, because on the
     uncompiled path a payload failure and a capture failure are otherwise the same
     failure and this control has to isolate the second. */
  const source = mutated("fal-generation.js", (text) => text
    .replace(
      /record = generationBindingRecord\(\{/,
      "record = ((() => { throw new Error(\"NC-9 simulated capture failure\"); })(), generationBindingRecord({",
    )
    .replace(/resolveFile: \(address\) => localAssetFile\(owner, address\),(\r?\n\s*)\}\);/,
      "resolveFile: (address) => localAssetFile(owner, address),$1}));")
    .replace(
      /\} catch \(error\) \{(\r?\n\s*)throw new GenerationBindingError\([\s\S]*?\);(\r?\n\s*)\}(\r?\n\s*)\/\* A record the constructor returned/,
      "} catch (error) {$1  return null;$2}$3/* A record the constructor returned",
    )
    .replace(
      /function applyBindingRecord\(job, record\) \{(\r?\n)/,
      "function applyBindingRecord(job, record) {$1    if (!record) return;$1",
    ));
  assert(/NC-9 simulated capture failure/.test(source), "the capture must actually fail");
  assert(/function applyBindingRecord\(job, record\) \{\r?\n\s*if \(!record\) return;/.test(source),
    "and the writer must tolerate the null, which is the fail-open shape");

  const shipped = await dispatchLegacyOnce(require("../fal-generation"), LEGACY_EDIT_BODY);
  const broken = await dispatchLegacyOnce(compileModule("fal-generation.js", source), LEGACY_EDIT_BODY);
  const real = require("../generation-binding");

  /* RECEIPT — THE LIVE DEFECT: paid work left the machine and the row it left behind
     reads as history. */
  assert.strictEqual(shipped.status, 200, JSON.stringify(shipped.data));
  assert.strictEqual(shipped.calls.length, 1);
  assert.strictEqual(real.readGenerationBinding(shipped.stored).recorded, true);
  assert.strictEqual(broken.status, 200, "the mutated dispatcher submitted anyway");
  assert.strictEqual(broken.calls.length, 1, "a paid request reached the provider");
  assert.strictEqual(real.readGenerationBinding(broken.stored).recorded, false,
    "and left a job that reads as pre-instrumentation history");

  assert.throws(() => {
    assert.strictEqual(broken.calls.length, 0,
      "a capture failure must prevent the provider POST entirely");
  }, /prevent the provider POST/);
});

/* THE SHIPPED SIDE OF NC-9, asserted directly rather than by mutation: when the capture
   genuinely cannot be completed, the real dispatcher refuses and contacts nobody. */
control("NC-9b", "proving the shipped dispatcher refuses rather than sending", async () => {
  /* A reference whose file is outside CineBraid media storage. `localAssetFile` refuses
     it, so the hash cannot be taken and the payload cannot be built — the real failure
     this path has to survive, not a simulated one. */
  const refused = await dispatchLegacyOnce(require("../fal-generation"), {
    ...LEGACY_EDIT_BODY,
    clientRequestId: "nc-legacy-refused",
    references: [{ key: "escape", role: "base", mediaType: "image", url: "/assets/../../etc/passwd" }],
  });
  assert.notStrictEqual(refused.status, 200, `the dispatch must be refused, got ${refused.status}`);
  assert.strictEqual(refused.calls.length, 0, "no provider request was made");
  assert.deepStrictEqual(refused.ledger, [], "and no durable row was created to be mistaken for history");
  assert.strictEqual(refused.data.providerContacted, false);
  assert.strictEqual(refused.data.paidRequestSubmitted, false);
});

/* ===========================================================================
   NC-10 — record the references the CALLER supplied rather than the ones the
   uncompiled route actually sends.

   The legacy edit endpoint takes sixteen. The seventeenth is not sent. A binding built
   from the supplied array instead of the dispatched payload claims it was. */
control("NC-10", "recording a reference the uncompiled route's final limit dropped", async () => {
  /* The payload is truncated AFTER the bindings are built from it, so the record keeps
     references the request no longer carries. That is precisely a reference dropped by
     the final limit appearing as consumed — and it is invisible without comparing the
     record against the body the provider actually received. */
  const source = mutated("fal-generation.js", (text) =>
    text.replace(
      /(input\.image_urls = sent\.map\(\(ref, index\) => \{[\s\S]*?return referenceInput\(owner, ref\);(\r?\n\s*)\}\);)/,
      "$1$2input.image_urls = input.image_urls.slice(0, 2);",
    ));
  assert(/input\.image_urls = input\.image_urls\.slice\(0, 2\);/.test(source),
    "the mutation must truncate the payload after the bindings were built");
  assert(!/input\.image_urls\.slice\(0, 2\)/.test(read("fal-generation.js")), "and the shipped source must not");

  const many = Array.from({ length: 5 }, (unused, index) => ({
    key: `extra-${index + 1}`, role: "reference", mediaType: "image", url: "/assets/anchors/KAI.png",
  }));
  const body = { ...LEGACY_EDIT_BODY, clientRequestId: "nc-legacy-limit", references: many };

  const shipped = await dispatchLegacyOnce(require("../fal-generation"), body);
  const broken = await dispatchLegacyOnce(compileModule("fal-generation.js", source), body);
  assert.strictEqual(shipped.status, 200, JSON.stringify(shipped.data));
  assert.strictEqual(broken.status, 200, JSON.stringify(broken.data));

  /* RECEIPT — THE LIVE DEFECT: five recorded, two sent. */
  assert.strictEqual(shipped.calls[0].body.image_urls.length, 5, "the shipped route sends every reference it recorded");
  assert.strictEqual(shipped.stored.generationBinding.length, 5);
  assert.strictEqual(broken.calls[0].body.image_urls.length, 2, "the mutated route sends two");
  assert.strictEqual(broken.stored.generationBinding.length, 5, "and records five");

  assert.throws(() => {
    assert.strictEqual(broken.stored.generationBinding.length, broken.calls[0].body.image_urls.length,
      "one binding per file actually sent");
  }, /actually sent/);
});

/* ===========================================================================
   NC-11 — let a new zero-input uncompiled dispatch fall back to no record.

   The subtlest of the set: skipping the capture "because there is nothing to capture"
   turns a positive statement — this generation consumed nothing — into the absence that
   means the opposite. */
control("NC-11", "collapsing a new zero-input uncompiled dispatch into no record", async () => {
  const source = mutated("fal-generation.js", (text) =>
    text.replace(
      /if \(legacyDispatch\(job\)\) \{(\r?\n\s*)try \{/,
      "if (legacyDispatch(job)) {$1try {$1  if (!(job.references || []).length) throw new Error(\"NC-11: nothing to record\");",
    ));
  assert(/NC-11: nothing to record/.test(source));

  const shipped = await dispatchLegacyOnce(require("../fal-generation"), LEGACY_ZERO_INPUT_BODY);
  const broken = await dispatchLegacyOnce(compileModule("fal-generation.js", source), LEGACY_ZERO_INPUT_BODY);
  const real = require("../generation-binding");

  /* RECEIPT — the shipped module records an EMPTY set; the mutated one records nothing,
     and the two are the opposite claim. */
  assert.strictEqual(shipped.status, 200, JSON.stringify(shipped.data));
  assert.strictEqual(real.readGenerationBinding(shipped.stored).recorded, true);
  assert.deepStrictEqual(real.readGenerationBinding(shipped.stored).bindings, []);
  /* The mutated module now REFUSES the dispatch, because fail-closed catches it — which
     is itself the correct behaviour for a capture that cannot complete. What it must
     never do is send and record nothing. */
  assert.notStrictEqual(broken.status, 200, "the mutated capture failure is caught by the fail-closed guard");
  assert.strictEqual(broken.calls.length, 0, "so nothing was charged");
  assert.strictEqual(broken.stored, null);

  assert.throws(() => {
    assert.strictEqual(broken.status, 200, "a zero-input dispatch must still record recorded:true with []");
  }, /must still record/);
});

/* ===========================================================================
   NC-12 — resolve the continuity state against the frame the generation is FOR
   instead of the frame whose bytes it consumes.

   The shape the first pass shipped. It produced rows reading `frameId: FR-B` beside
   frame A's `stateId` — two provenances on one line, which is worse than either fact
   alone because the row looks complete. */
control("NC-12", "resolving state against the target frame instead of the consumed frame", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /: resolveConsumedState\(project, shot, consumed\.frameId \|\| frameId, list, entityId, identity\.file\);/,
      ": resolveConsumedState(project, shot, frameId, list, entityId, identity.file);",
    ));
  assert(/resolveConsumedState\(project, shot, frameId, list/.test(source));

  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");
  const input = crossFrameCase();

  const shipped = real.buildGenerationBinding(input)[0];
  const broken = Binding.buildGenerationBinding(input)[0];

  /* RECEIPT — THE LIVE DEFECT: same bytes, same frame, different state. */
  assert.strictEqual(shipped.frameId, "FR-B");
  assert.strictEqual(broken.frameId, "FR-B", "both agree which frame the BYTES are");
  assert.strictEqual(shipped.stateId, "state-storm", "the shipped module takes the consumed frame's state");
  assert.strictEqual(broken.stateId, "state-rain", "the control must actually take the target frame's");
  assert.notStrictEqual(broken.stateId, shipped.stateId);
  assert.strictEqual(shipped.stateAuthority, "matched");
  assert.strictEqual(broken.stateAuthority, "unmatched",
    "and the mutated row's own state does not authorise the bytes beside it");

  assert.throws(() => {
    assert.strictEqual(broken.stateId, "state-storm",
      "so the state is Frame B's — not the state the TARGET frame declares");
  }, /Frame B/);
});

/* ===========================================================================
   NC-13 — correlate bindings to references by KEY rather than by ordered
   occurrence.

   `new Map(rows.map((row) => [row.refId, row]))` keeps the last row for a repeated key,
   so every binding sharing that key resolves to the same reference. The provider still
   receives both files; the record describes one of them twice, and the row for provider
   index 0 names bytes that index never received.

   The mutation returns the LAST row and never consumes it, which is exactly the keyed
   Map's semantics expressed inside the accessor. */
control("NC-13", "collapsing two same-keyed inputs by correlating on refId alone", () => {
  const source = mutated("generation-binding.js", (text) =>
    text.replace(
      /if \(!queue\.length\) return onExhausted\(\);(\r?\n\s*)return queue\.shift\(\);/,
      "if (!queue.length) return onExhausted();$1return queue[queue.length - 1];",
    ));
  assert(/return queue\[queue\.length - 1\];/.test(source), "the mutation must stop consuming in order");
  assert(!/return queue\[queue\.length - 1\];/.test(read("generation-binding.js")), "and the shipped source must not");

  const Binding = compileModule("generation-binding.js", source);
  const real = require("../generation-binding");
  const input = duplicateKeyCase();

  const shipped = real.buildGenerationBinding(input);
  const broken = Binding.buildGenerationBinding(input);

  /* THE PREMISE: two dispatched inputs, two different files, one shared key. */
  assert.strictEqual(input.serialized.bindings.length, 2);
  assert.deepStrictEqual(input.plan.inputs.references.map((row) => row.refId), ["dup", "dup"]);
  assert.notStrictEqual(input.plan.inputs.references[0].source.path, input.plan.inputs.references[1].source.path);

  /* RECEIPT — THE LIVE DEFECT: both rows describe the second file, so provider index 0
     carries false provenance. */
  assert.strictEqual(shipped.length, 2);
  assert.strictEqual(shipped[0].file, KAI_PNG);
  assert.strictEqual(shipped[1].file, KAI_RAIN_PNG);
  assert.notStrictEqual(shipped[0].fileHash, shipped[1].fileHash);
  assert.strictEqual(broken.length, 2, "the mutated module still emits one row per dispatched input");
  assert.strictEqual(broken[0].file, KAI_RAIN_PNG, "but row 0 names the file index 1 received");
  assert.strictEqual(broken[1].file, KAI_RAIN_PNG);
  assert.strictEqual(broken[0].fileHash, broken[1].fileHash, "two distinct inputs collapsed onto one");
  assert.strictEqual(broken[0].fileHash, sha256(BYTES["KAI-RAIN.png"]));

  assert.throws(() => {
    assert.strictEqual(broken[0].file, KAI_PNG);
  });
  assert.throws(() => {
    assert.notStrictEqual(broken[0].fileHash, broken[1].fileHash,
      "two distinct inputs must not end up describing one file");
  }, /must not end up describing one file/);
});

async function main() {
  /* THE NO-VACUOUS-CONTROL GUARD, SELF-TESTED. It is the one piece of this harness that
     must not rot: a `mutated()` that stopped refusing a no-op would turn every control
     below into a pass that tested nothing. */
  assert.throws(
    () => mutated("generation-binding.js", (text) => text),
    /changed nothing/,
    "a mutation that changes nothing must fail loudly rather than count as a pass",
  );

  const before = sourceFingerprints();
  const detected = [];
  try {
    for (const entry of controls) {
      let caught = null;
      try {
        await entry.run();
      } catch (error) {
        caught = error;
      }
      assert(!caught, `${entry.id} (${entry.title}) did not behave as the control describes: ${caught && caught.message}`);
      detected.push(entry.id);
    }

    /* AND NOT ONE BYTE OF PRODUCTION SOURCE MOVED. */
    assert.deepStrictEqual(sourceFingerprints(), before,
      "a control wrote to disk; nothing in this suite may modify production source");

    /* AND THE REAL MODULES ARE GREEN AFTERWARDS. If any mutation had reached a module
       cache, these would now disagree. */
    const Binding = require("../generation-binding");
    const flf = Binding.buildGenerationBinding(flfCase());
    assert.strictEqual(flf.length, 2);
    assert.strictEqual(flf.find((row) => row.providerField === "image_url").frameId, "FR-A");
    assert.strictEqual(flf.find((row) => row.providerField === "end_image_url").frameId, "FR-C");
    assert.strictEqual(Binding.buildGenerationBinding(frameCase())[0].stateId, "state-rain");
    assert.strictEqual(Binding.buildGenerationBinding(frameCase())[0].stateDeclared, true);
    assert.strictEqual(Binding.buildGenerationBinding(statelessEntityCase())[0].stateId, "");
    assert.strictEqual(Binding.buildGenerationBinding(droppedCase()).length, 1);
    assert.strictEqual(Binding.readGenerationBinding({}).recorded, false);
    assert.strictEqual(Binding.readGenerationBinding({}).bindings, null);
    assert.strictEqual(Binding.readGenerationBinding.length, 1, "the shipped reader takes a job and nothing else");
    /* The consumed-frame rule and the uncompiled path, green on the real modules. */
    const cross = Binding.buildGenerationBinding(crossFrameCase())[0];
    assert.strictEqual(cross.frameId, "FR-B");
    assert.strictEqual(cross.stateId, "state-storm");
    assert.strictEqual(cross.stateAuthority, "matched");
    const dup = Binding.buildGenerationBinding(duplicateKeyCase());
    assert.deepStrictEqual(dup.map((row) => row.file), [KAI_PNG, KAI_RAIN_PNG],
      "two same-keyed inputs keep one truthful row each");
    assert.notStrictEqual(dup[0].fileHash, dup[1].fileHash);
    const live = await dispatchLegacyOnce(require("../fal-generation"), LEGACY_ZERO_INPUT_BODY);
    assert.strictEqual(live.status, 200, JSON.stringify(live.data));
    assert.deepStrictEqual(Binding.readGenerationBinding(live.stored).bindings, [],
      "a real zero-input uncompiled dispatch still records an empty set, not an absence");
    assert.strictEqual(Binding.readGenerationBinding(live.stored).recorded, true);

    console.log(
      `Generation binding negative controls passed: ${detected.length} deliberate defects reintroduced in memory — `
      + "the continuity state resolved from Canon instead of the dispatch frame, a reference refused before "
      + "serialization recorded as consumed, a consumed endpoint omitted, the FLF first and last identities swapped "
      + "while the request stayed correct, a legacy absence read as a confirmed empty set, the capture moved after "
      + "the paid POST, a reader that re-resolves history from current project state, a default continuity state "
      + "minted for an entity that declares none, the uncompiled path's binding writer removed so a new job backdates "
      + "itself, a capture failure allowed through to the provider, a reference the final uncompiled limit dropped "
      + "recorded as consumed, a zero-input uncompiled dispatch collapsed into no record, the continuity state "
      + "resolved against the target frame instead of the consumed one, and two same-keyed inputs collapsed onto one "
      + "file by correlating on refId alone — every one detected by the "
      + "property that guards it, with the real modules green afterwards. Nothing was written to disk and nothing was "
      + "reverted with git. Provider calls made: 0.",
    );
  } finally {
    if (SANDBOX) fs.rmSync(SANDBOX, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
