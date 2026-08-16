/* Generation binding — what the dispatched request ACTUALLY consumed.
 *
 * CineBraid could already answer what it compiled, what it sent, where it sent it and
 * what it expected to pay. It could not answer what the provider was HANDED: which
 * entity, which collection, which continuity state, which file, which bytes, which
 * frame. Every one of those is destroyed by ordinary production work — a new approval,
 * a re-declared state, a rename — and none of them can be recovered afterwards.
 *
 * This suite asserts the record and the request agree, one route at a time, and that
 * the record stops moving the instant the request is committed.
 *
 * The assertions are behavioural. Nothing here reads a source file to prove an edit
 * happened: a binding is checked against the body the mock provider actually received
 * and against bytes hashed independently in the test, because a record that agrees with
 * itself proves nothing about the request.
 *
 * NO PROVIDER IS CONTACTED. The only endpoint reached is a local express mock, which is
 * also where the durability barrier is measured: it reads the ledger from disk at the
 * instant the paid request arrives, which is exactly what a process that died mid-POST
 * would have left behind.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

const { registerFalGeneration } = require("../fal-generation");
const { GENERATION_BINDING_VERSION, readGenerationBinding } = require("../generation-binding");
const { addMotionPromptBuild } = require("./h3-execution-fixture");
const { addFramePromptBuild } = require("./image-execution-fixture");
const { baseSpec, KAI, HANGAR } = require("./generation-compiler-fixture");

/* Six DIFFERENT images. Identical fixture bytes would let "the opening and closing
   frames are two different files" pass on a swap, and would make every content hash
   below the same number. */
const BYTES = {
  "A.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64"),
  "B.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
  "C.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC", "base64"),
  "KAI.png": Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d76360000000020001", "hex"),
  "KAI-RAIN.png": Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d76364000000030001", "hex"),
  "HANGAR.png": Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d76368000000040001", "hex"),
};
const MP4 = Buffer.from("00000018667479706d703432000000006d703432", "hex");
const WAV = Buffer.from("524946462400000057415645666d7420", "hex");

/* The digest computed HERE, from the fixture's own bytes, with no help from the module
   under test. A binding whose hash only matched media-hash.js's output would prove the
   two agree, not that either is the content of the file that was sent. */
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const A_PNG = "/assets/shots/SH-1/takes/A.png";
const B_PNG = "/assets/shots/SH-1/takes/B.png";
const C_PNG = "/assets/shots/SH-1/takes/C.png";
const KAI_PNG = "/assets/anchors/KAI.png";
const KAI_RAIN_PNG = "/assets/anchors/KAI-RAIN.png";
const HANGAR_PNG = "/assets/plates/HANGAR.png";
const TRACK_MP4 = "/assets/media/track.mp4";
const VOICE_WAV = "/assets/audio/kai.wav";

const notes = [];
const note = (line) => notes.push(line);

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;

/* A stored build reference, in the shape the prompt engine actually persists. */
const ref = (key, role, mediaType, url, extra = {}) => ({
  key, token: "", label: `Approved ${role}`, role, mediaType, instruction: "", entityId: "", url, ...extra,
});

/* ---------------------------------------------------------------------------
   The project.

   Three named frames, each with an approved take and a candidate row that BINDS that
   file to that frame — the durable record the binding resolver reads, rather than a
   guess about a filename.

   Kai declares two continuity states and the shot's FRAME A declares the non-default
   one. That disagreement is the whole point of the continuity case below: the entity's
   current state and the state this generation resolves are deliberately different, so a
   record that quietly reports the default is visibly wrong rather than plausibly right. */
function makeProject() {
  return {
    meta: { title: "Generation binding", aspectRatio: "16:9" },
    shots: [
      {
        id: "SH-1",
        keyframes: [
          { id: "FR-A", label: "A", winner: "A.png" },
          { id: "FR-B", label: "B", winner: "B.png" },
          { id: "FR-C", label: "C", winner: "C.png" },
        ],
        candidateFiles: [
          { stored: "A.png", frameId: "FR-A" },
          { stored: "B.png", frameId: "FR-B" },
          { stored: "C.png", frameId: "FR-C" },
        ],
        creationBrief: {
          frameWorkflows: {
            "FR-A": { characterStateSelections: { [KAI]: "state-rain" } },
          },
        },
      },
      { id: "SH-2", keyframes: [], candidateFiles: [], creationBrief: {} },
    ],
    characters: [{
      id: KAI,
      name: "Kai",
      approvedFile: "KAI.png",
      continuityStates: [
        { id: "state-default", name: "Default", isDefault: true, approvedFile: "KAI.png" },
        { id: "state-rain", name: "Rain-soaked", approvedFile: "KAI-RAIN.png" },
      ],
    }],
    locations: [{ id: HANGAR, name: "Hangar 4", approvedFile: "HANGAR.png", continuityStates: [] }],
    props: [], vehicles: [], mediaAssets: [],
  };
}

async function harness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-gen-binding-"));
  const dir = path.join(tmp, "project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  for (const sub of ["anchors", "plates", "props", "vehicles", "media", "audio"])
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const name of ["A.png", "B.png", "C.png"]) fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", name), BYTES[name]);
  for (const name of ["KAI.png", "KAI-RAIN.png"]) fs.writeFileSync(path.join(dir, "anchors", name), BYTES[name]);
  fs.writeFileSync(path.join(dir, "plates", "HANGAR.png"), BYTES["HANGAR.png"]);
  fs.writeFileSync(path.join(dir, "media", "track.mp4"), MP4);
  fs.writeFileSync(path.join(dir, "audio", "kai.wav"), WAV);
  const file = path.join(dir, "project.json");
  fs.writeFileSync(file, JSON.stringify(makeProject(), null, 2));

  const calls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  const endpoints = [
    "/minimax/h3/text-to-video", "/minimax/h3/image-to-video", "/minimax/h3/reference-to-video",
    "/openai/gpt-image-2", "/openai/gpt-image-2/edit",
  ];
  mock.post(endpoints, (req, res) => {
    const id = `job-${calls.length + 1}`;
    /* THE BARRIER. The paid request has arrived and has not been answered, so whatever
       is on disk at this instant is what a process that died mid-POST would leave. The
       binding must already be in it. */
    let ledgerAtRequest = [];
    try {
      ledgerAtRequest = JSON.parse(fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8"));
    } catch { ledgerAtRequest = []; }
    calls.push({ endpoint: req.path, body: req.body, ledgerAtRequest });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}`, cancel_url: `${mockOrigin}/cancel/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "IN_QUEUE" }));
  mock.put("/cancel/:id", (req, res) => res.json({ ok: true }));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  const SLUG = "generation-binding";
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "fal-secret-test-key", baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit",
      h3TextModel: "minimax/h3/text-to-video", h3ImageModel: "minimax/h3/image-to-video",
      h3ReferenceModel: "minimax/h3/reference-to-video", h3Resolution: "2K", maxConcurrent: 4,
    } } }),
    readProject: (slug = SLUG) => {
      if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
      return JSON.parse(fs.readFileSync(file, "utf8"));
    },
    writeProject: (project, slug = SLUG) => {
      if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
      fs.writeFileSync(file, JSON.stringify(project, null, 2));
    },
    activeSlug: () => SLUG,
    projectDirForSlug: (slug) => {
      if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
      return { slug, dir, file };
    },
  });
  const appServer = await listen(app);
  const appOrigin = originOf(appServer);

  const api = async (url, options = {}) => {
    const response = await fetch(`${appOrigin}${url}`, {
      method: options.method || "POST",
      headers: { "content-type": "application/json" },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };

  return {
    dir, file, calls, api, tmp,
    project: () => JSON.parse(fs.readFileSync(file, "utf8")),
    saveProject: (project) => fs.writeFileSync(file, JSON.stringify(project, null, 2)),
    ledger: () => {
      const raw = path.join(dir, "generation-jobs.json");
      if (!fs.existsSync(raw)) return [];
      return JSON.parse(fs.readFileSync(raw, "utf8"));
    },
    close: () => { mockServer.close(); appServer.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

/* CineBraid allows at most two in-flight paid jobs per project, so each submission is
   released before the next. Cancelling is also a small extra proof: the binding is
   written once at dispatch and survives every later lifecycle write. */
async function settle(h, jobId) {
  if (jobId) await h.api(`/api/generation/fal/jobs/${jobId}/cancel`, {});
}

/* One motion submission, from stored build to durable row. */
async function submitMotion(h, buildOptions = {}, overrides = {}) {
  const project = h.project();
  const buildId = addMotionPromptBuild(project, buildOptions.shotId || "SH-1", buildOptions);
  h.saveProject(project);
  const before = h.calls.length;
  const result = await h.api("/api/generation/fal/jobs", {
    body: {
      purpose: "motion-h3",
      shotId: buildOptions.shotId || "SH-1",
      sourceBuildId: buildId,
      profileFamily: "minimax-h3",
      profileMode: buildOptions.mode || "i2v",
      durationSeconds: buildOptions.durationSeconds || 8,
      resolution: "2K",
      aspectRatio: buildOptions.aspectRatio || "16:9",
      clientRequestId: `binding-${buildOptions.id || buildId}`,
      ...overrides,
    },
  });
  if (result.status === 200) await settle(h, result.data.job.id);
  return { result, call: h.calls[before] || null, buildId };
}

/* One compiled still-image submission. */
async function submitFrame(h, buildOptions = {}, overrides = {}) {
  const project = h.project();
  const buildId = addFramePromptBuild(project, "SH-1", { spec: baseSpec({ shotId: "SH-1" }), ...buildOptions });
  h.saveProject(project);
  const before = h.calls.length;
  const result = await h.api("/api/generation/fal/jobs", {
    body: {
      purpose: "frame", imagePlan: true, shotId: "SH-1", sourceBuildId: buildId,
      frameId: buildOptions.frameId || "FR-A", frameLabel: "A",
      aspectRatio: "16:9", outputCount: 1,
      clientRequestId: `binding-frame-${buildOptions.id || buildId}`,
      ...overrides,
    },
  });
  if (result.status === 200) await settle(h, result.data.job.id);
  return { result, call: h.calls[before] || null, buildId };
}

/* The durable row, re-read from disk. Never the response body: what a later reader gets
   is what was persisted, and the two are only the same if the write worked. */
function storedJob(h, jobId) {
  const row = h.ledger().find((item) => item.id === jobId);
  assert(row, `job ${jobId} is not in the durable ledger`);
  return row;
}

function bindingsOf(job) {
  const record = readGenerationBinding(job);
  assert.strictEqual(record.recorded, true, "this job must carry a generation binding record");
  assert.strictEqual(record.version, GENERATION_BINDING_VERSION);
  return record.bindings;
}

const byField = (bindings, field) => bindings.filter((row) => row.providerField === field);
const one = (bindings, field) => {
  const rows = byField(bindings, field);
  assert.strictEqual(rows.length, 1, `expected exactly one binding on ${field}, got ${rows.length}`);
  return rows[0];
};

async function main() {
  const h = await harness();
  try {
    /* ===================================================================
       1. T2V — a route that consumes no images records that it consumed none.
       =================================================================== */
    {
      const { result, call } = await submitMotion(h, { mode: "t2v", id: "b-t2v", durationSeconds: 8, references: [] });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const job = storedJob(h, result.data.job.id);
      const bindings = bindingsOf(job);

      assert.strictEqual(bindings.length, 0, "text-to-video consumes no image inputs");
      /* The request agrees. A binding set that said "none" while an image travelled
         would be the failure this whole record exists to prevent. */
      for (const field of ["image_url", "end_image_url", "reference_image_urls"])
        assert.strictEqual(call.body[field], undefined, `t2v must send no ${field}`);
      /* And nothing was fabricated. The shot HAS an approved Frame A with an approved
         file; the record must not name it just because it exists. */
      assert(!JSON.stringify(bindings).includes("FR-A"), "no frame may appear in a t2v binding set");
      assert(!JSON.stringify(bindings).includes("A.png"), "and no approved file either");
      /* This is a POSITIVE record of nothing, which is not the same as no record. */
      assert.notStrictEqual(readGenerationBinding(job).bindings, null);
      note("t2v: zero bindings recorded, and the empty set is a positive record rather than an absence");
    }

    /* ===================================================================
       2. I2V — the actual start frame, its exact file, its bytes, its identity.
       =================================================================== */
    {
      const { result, call } = await submitMotion(h, {
        mode: "i2v", id: "b-i2v", durationSeconds: 8,
        references: [ref("kf-a", "first-frame", "image", A_PNG)],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const job = storedJob(h, result.data.job.id);
      const bindings = bindingsOf(job);

      assert.strictEqual(bindings.length, 1, "i2v consumes exactly its opening frame");
      const start = one(bindings, "image_url");
      assert.strictEqual(start.role, "first-frame");
      assert.strictEqual(start.file, A_PNG, "the exact project-relative address that was supplied");
      assert.strictEqual(start.fileHash, sha256(BYTES["A.png"]), "the bytes, hashed independently by this test");
      assert.strictEqual(start.fileHashStatus, "hashed");
      assert.strictEqual(start.frameId, "FR-A", "and WHICH FRAME those bytes are");

      /* The request received exactly these bytes. Proving the record against the plan
         alone would only prove the record copied the plan. */
      assert(String(call.body.image_url).startsWith("data:image/png;base64,"));
      const sent = Buffer.from(String(call.body.image_url).split(",")[1], "base64");
      assert.strictEqual(sha256(sent), start.fileHash, "the hash on the record is the hash of what was sent");
      /* And it is durable BEFORE the provider answered. */
      const atBarrier = call.ledgerAtRequest.find((row) => row.id === job.id);
      assert(atBarrier, "the row must exist at the instant the paid request arrives");
      assert.strictEqual(atBarrier.generationBinding[0].fileHash, start.fileHash,
        "the binding is frozen before the POST, not attached to the response");
      note("i2v: the start frame's file, bytes and frame identity are recorded, and are durable before the POST");
    }

    /* ===================================================================
       3. FLF — two endpoints, two frame identities, and no way to swap them.
       =================================================================== */
    let flfJobId = "";
    {
      const { result, call } = await submitMotion(h, {
        mode: "flf", id: "b-flf", durationSeconds: 8,
        references: [ref("kf-a", "first-frame", "image", A_PNG), ref("kf-c", "last-frame", "image", C_PNG)],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      flfJobId = result.data.job.id;
      const bindings = bindingsOf(storedJob(h, flfJobId));

      assert.strictEqual(bindings.length, 2);
      const first = one(bindings, "image_url");
      const last = one(bindings, "end_image_url");
      assert.strictEqual(first.frameId, "FR-A");
      assert.strictEqual(last.frameId, "FR-C");
      assert.strictEqual(first.file, A_PNG);
      assert.strictEqual(last.file, C_PNG);
      assert.notStrictEqual(first.fileHash, last.fileHash, "two endpoints, two different sets of bytes");
      assert.strictEqual(first.fileHash, sha256(BYTES["A.png"]));
      assert.strictEqual(last.fileHash, sha256(BYTES["C.png"]));
      /* The request agrees, field by field. */
      assert.strictEqual(sha256(Buffer.from(String(call.body.image_url).split(",")[1], "base64")), first.fileHash);
      assert.strictEqual(sha256(Buffer.from(String(call.body.end_image_url).split(",")[1], "base64")), last.fileHash);
      note("flf: both endpoints recorded with distinct files, bytes and frame identities");
    }
    {
      /* THE SAME PACKAGE, STORED IN THE OTHER ORDER. The endpoints are bound by ROLE
         through the plan's endpoint contract, so an array written last-frame-first must
         produce the identical binding. This is the defect that once shipped a shot
         ending on its own opening frame; the record must not be able to reproduce it. */
      const { result, call } = await submitMotion(h, {
        mode: "flf", id: "b-flf-reordered", durationSeconds: 8,
        references: [ref("kf-c", "last-frame", "image", C_PNG), ref("kf-a", "first-frame", "image", A_PNG)],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const bindings = bindingsOf(storedJob(h, result.data.job.id));
      assert.strictEqual(one(bindings, "image_url").frameId, "FR-A", "reordering the array must not move the opening frame");
      assert.strictEqual(one(bindings, "end_image_url").frameId, "FR-C", "nor the closing one");
      assert.strictEqual(one(bindings, "image_url").file, A_PNG);
      assert.strictEqual(one(bindings, "end_image_url").file, C_PNG);
      /* And the request itself did not swap either, which is what makes the record's
         stability meaningful rather than coincidental. */
      assert.strictEqual(sha256(Buffer.from(String(call.body.image_url).split(",")[1], "base64")), sha256(BYTES["A.png"]));
      assert.strictEqual(sha256(Buffer.from(String(call.body.end_image_url).split(",")[1], "base64")), sha256(BYTES["C.png"]));
      note("flf: frame identities cannot swap because the stored reference array was written in the other order");
    }

    /* ===================================================================
       4. A REFERENCE REFUSED BEFORE DISPATCH IS NOT A CONSUMED REFERENCE.
       =================================================================== */
    {
      /* fal's image-to-video endpoint has no field for a video reference, so the pack
         refuses it BY NAME and the plan lists only what travels. The binding set must
         follow the request, not the package the filmmaker assembled. */
      const { result, call } = await submitMotion(h, {
        mode: "i2v", id: "b-i2v-dropped", durationSeconds: 8,
        references: [ref("kf-a", "first-frame", "image", A_PNG), ref("mo-1", "motion-reference", "video", TRACK_MP4)],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const job = storedJob(h, result.data.job.id);
      const bindings = bindingsOf(job);

      /* THE DROP IS REAL — otherwise this case proves nothing. The package the
         filmmaker assembled carried two references; the plan carries one, the loss is
         warned about by name, and the request has no video field at all. */
      assert.strictEqual(job.compilation.plan.inputs.references.length, 1, "the plan carries only what travels");
      assert(job.compilation.plan.warnings.some((row) => String(row.field) === "references.mo-1"),
        "and the refusal is named rather than silent");
      assert.strictEqual(call.body.reference_video_urls, undefined, "the video never left the machine");
      assert.strictEqual(bindings.length, 1, "and it is not recorded as consumed");
      assert.strictEqual(bindings[0].refId, "kf-a");
      assert(!bindings.some((row) => row.refId === "mo-1"), "a refused reference must not appear in the binding set");
      assert(!bindings.some((row) => row.mediaType === "video"));
      note("drop: a reference the configuration refuses before dispatch does not appear as consumed");
    }

    /* ===================================================================
       5. R2V / multi-frame — the ordered consumed sequence, with identities.
       =================================================================== */
    {
      const { result, call } = await submitMotion(h, {
        mode: "r2v", id: "b-r2v", durationSeconds: 10, aspectRatio: "16:9",
        references: [
          ref("kf-1", "sequential-keyframe", "image", A_PNG),
          ref("kf-2", "sequential-keyframe", "image", B_PNG),
          ref("kf-3", "sequential-keyframe", "image", C_PNG),
          ref("id-kai", "identity", "image", KAI_RAIN_PNG, { entityId: KAI }),
          ref("mo-1", "motion-reference", "video", TRACK_MP4),
        ],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const bindings = bindingsOf(storedJob(h, result.data.job.id));

      const images = byField(bindings, "reference_image_urls");
      const videos = byField(bindings, "reference_video_urls");
      assert.strictEqual(images.length, 4);
      assert.strictEqual(videos.length, 1);
      assert.strictEqual(bindings.length, call.body.reference_image_urls.length + call.body.reference_video_urls.length,
        "one binding per file the provider received, and no more");

      /* THE ORDER IS THE ORDER THAT WAS SENT. A keyframe sequence whose recorded order
         disagreed with the dispatched order would describe a different film. */
      assert.deepStrictEqual(images.map((row) => row.providerIndex), [0, 1, 2, 3]);
      assert.deepStrictEqual(images.map((row) => row.refId), ["kf-1", "kf-2", "kf-3", "id-kai"]);
      assert.deepStrictEqual(images.slice(0, 3).map((row) => row.frameId), ["FR-A", "FR-B", "FR-C"],
        "each consumed keyframe keeps its own frame identity");
      /* Position N in the record is position N in the request. */
      for (const row of images)
        assert.strictEqual(
          sha256(Buffer.from(String(call.body.reference_image_urls[row.providerIndex]).split(",")[1], "base64")),
          row.fileHash,
          `image ${row.providerIndex} on the record is image ${row.providerIndex} in the request`,
        );
      /* The identity reference is an entity, not a frame; the keyframes are frames, not
         entities. Neither is invented for the other. */
      const identity = images[3];
      assert.strictEqual(identity.entityId, KAI);
      assert.strictEqual(identity.list, "characters");
      assert.strictEqual(identity.frameId, "", "an entity reference is not one of this shot's frames");
      /* A motion request is not frame-scoped, so nothing declared a state for Kai here
         and the entity's default answered by precedence. Both halves are written down:
         the state that resolved, and the fact that no one declared it. */
      assert.strictEqual(identity.stateId, "state-default");
      assert.strictEqual(identity.stateDeclared, false, "the default answered; it was not bound");
      /* AND THE EVIDENCE IS ENOUGH TO SEE THE DIFFERENCE. The default state authorises
         KAI.png; what was actually sent was the rain-soaked image. This record does not
         say stale, invalid or wrong — it says which state resolved and which bytes
         travelled, and leaves the conclusion to a reader that does not exist yet. */
      assert.strictEqual(identity.stateAuthority, "unmatched");
      assert.strictEqual(identity.fileHash, sha256(BYTES["KAI-RAIN.png"]));
      assert.notStrictEqual(identity.fileHash, sha256(BYTES["KAI.png"]));
      for (const row of images.slice(0, 3)) assert.strictEqual(row.entityId, "", "a keyframe names no entity, so none is recorded");
      assert.strictEqual(videos[0].mediaType, "video");
      assert.strictEqual(videos[0].fileHash, sha256(MP4));
      note("r2v: five consumed inputs recorded in dispatch order, keyframes keep frame identity and the entity keeps its own");
    }

    /* ===================================================================
       6. STILL-IMAGE REFERENCE GENERATION.
       =================================================================== */
    let framePlanJobId = "";
    {
      const { result, call } = await submitFrame(h, {
        id: "frame-refs", frameId: "FR-A",
        references: [
          ref("loc-hangar", "location", "image", HANGAR_PNG, { entityId: HANGAR }),
          ref("id-kai", "identity", "image", KAI_RAIN_PNG, { entityId: KAI, continuityState: "Rain-soaked" }),
        ],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      framePlanJobId = result.data.job.id;
      const bindings = bindingsOf(storedJob(h, framePlanJobId));

      assert.strictEqual(call.endpoint, "/openai/gpt-image-2/edit");
      assert.strictEqual(bindings.length, call.body.image_urls.length, "one binding per reference actually sent");
      assert.strictEqual(bindings.length, 2);
      for (const row of bindings) {
        assert.strictEqual(row.providerField, "image_urls");
        assert.strictEqual(
          sha256(Buffer.from(String(call.body.image_urls[row.providerIndex]).split(",")[1], "base64")),
          row.fileHash,
        );
      }
      const kai = bindings.find((row) => row.entityId === KAI);
      const hangar = bindings.find((row) => row.entityId === HANGAR);
      assert(kai && hangar, "both entity references are attributed to their entities");
      assert.strictEqual(kai.list, "characters");
      assert.strictEqual(hangar.list, "locations");
      assert.strictEqual(kai.file, KAI_RAIN_PNG);
      assert.strictEqual(kai.fileHash, sha256(BYTES["KAI-RAIN.png"]));
      /* NO DEFAULT-STATE INVENTION. Hangar 4 declares no continuity states at all, so
         there is no state to name and none is written down — even though the shared
         resolver would happily hand back a synthesised `state-default` record. */
      assert.deepStrictEqual(h.project().locations[0].continuityStates, []);
      assert.strictEqual(hangar.stateId, "", "an entity with no declared states has no state recorded");
      assert.strictEqual(hangar.stateName, "");
      assert.strictEqual(hangar.stateDeclared, false);
      note("still image: the references actually sent on the executable route are captured, each attributed to its collection");
      note("no invention: an entity that declares no continuity states has an ABSENT state, not a fabricated default");
    }

    /* ===================================================================
       7. CONTINUITY STATE — the state RESOLVED for this dispatch, not the
          entity's current one.
       =================================================================== */
    {
      const project = h.project();
      const kai = project.characters.find((row) => row.id === KAI);
      /* The disagreement, stated rather than assumed. */
      assert.strictEqual(kai.continuityStates.find((row) => row.isDefault).id, "state-default");
      assert.strictEqual(kai.approvedFile, "KAI.png", "the entity's current authority is the clean state");
      assert.strictEqual(project.shots[0].creationBrief.frameWorkflows["FR-A"].characterStateSelections[KAI], "state-rain",
        "and Frame A declares the other one");

      const bindings = bindingsOf(storedJob(h, framePlanJobId));
      const kaiBinding = bindings.find((row) => row.entityId === KAI);
      assert.strictEqual(kaiBinding.stateId, "state-rain",
        "the record names the state this frame resolved, not the entity's default");
      assert.strictEqual(kaiBinding.stateName, "Rain-soaked");
      assert.strictEqual(kaiBinding.stateDeclared, true,
        "the frame BOUND that state; it did not arrive by falling through to a default");
      assert.strictEqual(kaiBinding.stateAuthority, "matched",
        "and that state is the one that authorises the bytes that were sent");
      assert.notStrictEqual(kaiBinding.stateId, "state-default");
      assert.notStrictEqual(kaiBinding.fileHash, sha256(BYTES["KAI.png"]),
        "the clean state's image was demonstrably not what travelled");
      note("continuity: the state ACTUALLY resolved for the frame is recorded, and the entity default is not");
    }

    /* ===================================================================
       8. IMMUTABILITY — Canon moves, the historical record does not.
       =================================================================== */
    {
      const before = JSON.stringify(bindingsOf(storedJob(h, framePlanJobId)));
      const flfBefore = JSON.stringify(bindingsOf(storedJob(h, flfJobId)));

      /* Everything a production week does. The frame re-declares its state, the entity
         re-approves its default image, an approved take is renamed on disk and in the
         project, and the frame's winner follows it. */
      const project = h.project();
      project.shots[0].creationBrief.frameWorkflows["FR-A"].characterStateSelections[KAI] = "state-default";
      const kai = project.characters.find((row) => row.id === KAI);
      kai.approvedFile = "KAI-RAIN.png";
      kai.continuityStates.find((row) => row.id === "state-rain").approvedFile = "KAI.png";
      fs.renameSync(path.join(h.dir, "shots", "SH-1", "takes", "A.png"), path.join(h.dir, "shots", "SH-1", "takes", "A-RENAMED.png"));
      project.shots[0].keyframes[0].winner = "A-RENAMED.png";
      project.shots[0].candidateFiles[0].stored = "A-RENAMED.png";
      h.saveProject(project);

      /* THE MUTATION IS REAL — a control that changed nothing would prove nothing. */
      const after = h.project();
      assert.strictEqual(after.shots[0].creationBrief.frameWorkflows["FR-A"].characterStateSelections[KAI], "state-default");
      assert.strictEqual(after.characters.find((row) => row.id === KAI).approvedFile, "KAI-RAIN.png");
      assert(!fs.existsSync(path.join(h.dir, "shots", "SH-1", "takes", "A.png")), "the consumed file no longer exists under that name");

      /* AND THE EVIDENCE HAS NOT MOVED. */
      assert.strictEqual(JSON.stringify(bindingsOf(storedJob(h, framePlanJobId))), before,
        "a Canon change must not rewrite an older job's binding");
      assert.strictEqual(JSON.stringify(bindingsOf(storedJob(h, flfJobId))), flfBefore,
        "nor may a rename rewrite which file an older job consumed");
      const kaiBinding = bindingsOf(storedJob(h, framePlanJobId)).find((row) => row.entityId === KAI);
      assert.strictEqual(kaiBinding.stateId, "state-rain", "still the state that was resolved at dispatch");
      const flfFirst = one(bindingsOf(storedJob(h, flfJobId)), "image_url");
      assert.strictEqual(flfFirst.file, A_PNG, "still the exact address that was supplied");
      assert.strictEqual(flfFirst.fileHash, sha256(BYTES["A.png"]), "still the bytes that were sent");
      note("immutability: a re-declared state, a re-approved entity file and a rename leave every historical binding untouched");
    }

    /* ===================================================================
       9. LEGACY — absence means NOT RECORDED, never an empty consumed set.
       =================================================================== */
    {
      const t2v = h.ledger().find((row) => row.mode === "t2v");
      assert(t2v, "the t2v job is the control: a recorded EMPTY set");
      const legacy = { id: "legacy-job", provider: "fal", purpose: "frame", references: [{ key: "x", url: A_PNG }] };

      const recorded = readGenerationBinding(t2v);
      const absent = readGenerationBinding(legacy);
      assert.strictEqual(recorded.recorded, true);
      assert.strictEqual(absent.recorded, false, "a job from before this existed has no record");
      assert.strictEqual(absent.bindings, null,
        "and it must not read as an empty binding set — the two mean opposite things");
      assert.deepStrictEqual(recorded.bindings, [], "whereas the t2v job really did consume nothing");
      assert.notStrictEqual(absent.bindings, recorded.bindings);
      /* The legacy job plainly USED a reference. Reporting [] would assert it used none. */
      assert.strictEqual(legacy.references.length, 1);
      note("legacy: a job with no record reads as not-recorded, not as a confirmed empty set");
    }

    /* ===================================================================
       10. NOTHING ELSE WAS DISTURBED.
       =================================================================== */
    {
      const job = h.ledger().find((row) => row.id === flfJobId);
      for (const field of ["compilation", "compiledPrompt", "prompt", "model", "modelFamily", "backendId", "providerBindings", "accounting", "externalId"])
        assert(job[field] !== undefined, `${field} must survive: generationBinding is additive evidence, not a replacement`);
      assert(job.compilation.plan, "the compiled plan is still whole");
      assert.strictEqual(job.providerBindings.length, 2, "the existing provider bindings are untouched");
      /* And the two records agree without being the same record: providerBindings says
         which field, generationBinding says what was in it. */
      assert.deepStrictEqual(
        job.providerBindings.map((row) => `${row.refId}:${row.field}`),
        job.generationBinding.map((row) => `${row.refId}:${row.providerField}`),
      );
      note("additive: every existing provenance field survives, and the two binding records agree by refId and field");
    }

    console.log(
      `Generation binding passed: ${notes.length} properties — the durable record of what a paid request actually `
      + "consumed agrees with the request the provider received, on every compiled route, and stops moving the "
      + "instant the request is committed.",
    );
    for (const line of notes) console.log(`  ${line}`);
    console.log("  Provider calls made: 0 (every endpoint above is a local mock).");
  } finally {
    h.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
