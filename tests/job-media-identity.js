/* P4-SEM-C4 — durable identity for generation job records.
 *
 * THE LAST OF C1'S THREE TARGETS. media-asset-service.js:59-62 named "approval
 * pointers, candidate rows or job records"; C2 took the entity approval
 * pointers and candidate rows, C3 took the shot-side ones, and this is what
 * remained.
 *
 * THE DEFECT THIS ENDS, proven against a running server before a line of it was
 * written. fal-generation.js's ingest() records what a paid job delivered as
 * `outputs[] = [{ type, name, url, ... }]` — a filename and a URL. The approval
 * rename then rewrites that filename. C2 repairs every entity edge and C3
 * repairs every shot edge, and neither touches the job, because a job record
 * lives in generation-jobs.json where the browser has no write path to it. So
 * approving a generated take under its canonical name left the job that
 * produced it naming a file that was no longer on disk, while the MediaAsset
 * ledger had tracked those same bytes across the move perfectly.
 *
 * WHAT IS NOT CLAIMED HERE. That a job's outputs were any good. `outputs[]`
 * means "this job delivered that media", exactly as `winner` means "this edge
 * points at that media" and no more. Frame-intent validation is a different
 * layer and is deliberately absent from C4 as it was from C3.
 *
 * NO PAID CALL IS POSSIBLE HERE: the render harness stubs fetch, and the server
 * section never configures a provider or submits a job — it writes a completed
 * job record directly and exercises the rename route.
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const D = require("../public/shared-media-disposition");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.resolve(__dirname, "..");
const ID_A = "asset-" + "a".repeat(32);
const ID_B = "asset-" + "b".repeat(32);
const LIBRARY_ID = "blocking-media-1";

/* A completed job shaped exactly as fal-generation.js ingest() writes one: two
   frame candidates in a shot's takes folder, and a blocking output that already
   carries the P.mediaAssets[] LIBRARY id under `assetId`. That third output is
   the reason C4 cannot spell its own field `assetId`. */
function deliveredJob(extra = {}) {
  return {
    id: "fal-job-1", status: "COMPLETED", purpose: "frame", shotId: "SH-010", frameId: "frame-a",
    outputs: [
      { type: "candidate", name: "TAKE_1.png", url: "/assets/shots/SH-010/takes/TAKE_1.png", frameId: "frame-a", correctionOf: "" },
      { type: "candidate", name: "TAKE_2.png", url: "/assets/shots/SH-010/takes/TAKE_2.png", frameId: "frame-a", correctionOf: "" },
      { type: "blocking", assetId: LIBRARY_ID, name: "BLOCK_1.png", url: "/assets/shots/SH-010/blocking/BLOCK_1.png", frameId: "frame-a", frameLabel: "A" },
    ],
    ...extra,
  };
}

/* ===========================================================================
   1. The contract. */
function contractSection() {
  {
    const job = deliveredJob();
    const edges = D.jobOutputEdges(job);
    /* Enumerated, not remembered — the same rule C2's approvalEdges() and C3's
       shotApprovalEdges() hold, so a repair walking this list cannot miss an
       output kind nobody thought to name. */
    assert.deepStrictEqual(edges.map((e) => `${e.kind}:${e.file}`),
      ["candidate:TAKE_1.png", "candidate:TAKE_2.png", "blocking:BLOCK_1.png"],
      "every output a job delivered is enumerated, whatever kind it is");
    /* Path, not basename. This is what makes a same-named take in another shot
       unreachable by this rename. */
    assert.deepStrictEqual(edges.map((e) => e.dir),
      ["shots/SH-010/takes", "shots/SH-010/takes", "shots/SH-010/blocking"],
      "each output knows which directory its bytes live in");
    assert.strictEqual(D.jobOutputPath(job.outputs[0]), "shots/SH-010/takes/TAKE_1.png");
  }

  {
    /* THE NAMING COLLISION, frozen. `outputs[].assetId` is the project media
       LIBRARY row id on every blocking output (fal-generation.js:891). Writing
       the ledger's identity there would overwrite a live library link with a
       different kind of id, which is exactly what C2's identity note exists to
       prevent. */
    assert.strictEqual(D.JOB_OUTPUT_ASSET_ID_FIELD, "mediaAssetId");
    assert.notStrictEqual(D.JOB_OUTPUT_ASSET_ID_FIELD, D.CANDIDATE_ASSET_ID_FIELD,
      "the ledger's id and the media library's id must never share a key on one record");
    const blocking = deliveredJob().outputs[2];
    D.stampJobOutputIdentity(blocking, ID_A);
    assert.strictEqual(blocking.assetId, LIBRARY_ID, "the library link is left exactly as it was");
    assert.strictEqual(blocking.mediaAssetId, ID_A, "and the ledger identity sits beside it");
  }

  {
    /* A malformed id is refused rather than stored, for the C2 reason: a record
       carrying one resolves to nothing while looking authoritative, which is
       strictly worse than carrying none, because the filename fallback is then
       skipped. */
    const output = { name: "TAKE_1.png" };
    assert.strictEqual(D.stampJobOutputIdentity(output, "TAKE_1.png"), "");
    assert.strictEqual(D.stampJobOutputIdentity(output, "asset-nope"), "");
    assert.strictEqual(D.stampJobOutputIdentity(output, ""), "");
    assert.deepStrictEqual(output, { name: "TAKE_1.png" }, "nothing is written when the value is refused");
    assert.strictEqual(D.stampJobOutputIdentity(output, ID_A), ID_A);
    assert.strictEqual(output.mediaAssetId, ID_A);
  }

  {
    /* Identity-first resolution, reusing resolveApprovalMedia() verbatim: the
       filename on the output is stale, the bytes moved, and it still resolves. */
    const output = { name: "GONE.png", mediaAssetId: ID_A };
    assert.strictEqual(D.resolveJobOutputMedia(output, [{ name: "MOVED.png", assetId: ID_A }])?.name, "MOVED.png",
      "an output carrying identity resolves through a rename that broke its filename");
    assert.strictEqual(D.resolveJobOutputMedia({ name: "TAKE_1.png" }, [{ name: "TAKE_1.png" }])?.name, "TAKE_1.png",
      "and an output with no identity still resolves by filename");
    assert.strictEqual(D.resolveJobOutputMedia({ name: "GONE.png" }, [{ name: "TAKE_1.png" }]), null,
      "an output matching nothing resolves to NOTHING — it never guesses a neighbour");
  }

  {
    /* Read purity: none of the readers write. */
    const job = deliveredJob();
    const before = JSON.stringify(job);
    D.jobOutputEdges(job);
    D.jobOutputsForRename(job, { dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "X.png", assetId: ID_A });
    D.jobOutputMatcher(job)({ name: "TAKE_1.png" });
    D.resolveJobOutputMedia(job.outputs[0], []);
    assert.strictEqual(JSON.stringify(job), before, "no reader mutates the job it is handed");
  }
  console.log("  contract · outputs enumerated with their directories, the library id untouched, malformed identity refused, identity-first resolution, and every read pure");
}

/* ===========================================================================
   2. The rename repair — the defect C4 exists to close. */
function repairSection() {
  {
    const job = deliveredJob();
    const changed = D.repairJobOutputIdentity(job, {
      dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "SH-010_FRAME_A_APPROVED.png", assetId: ID_A,
    });
    assert.deepStrictEqual(changed.map((row) => `${row.kind}:${row.name}`), ["candidate:SH-010_FRAME_A_APPROVED.png"],
      "exactly the renamed output is repaired, and the repair reports what it did");
    assert.strictEqual(job.outputs[0].name, "SH-010_FRAME_A_APPROVED.png");
    /* The URL is a derived copy of the name, the way canonicalName is a derived
       copy of a shot winner. Leaving it behind trades a stale name for a broken
       preview. */
    assert.strictEqual(job.outputs[0].url, "/assets/shots/SH-010/takes/SH-010_FRAME_A_APPROVED.png");
    assert.strictEqual(job.outputs[0].mediaAssetId, ID_A, "and the identity that proves the move is recorded");
    assert.strictEqual(job.outputs[1].name, "TAKE_2.png", "the sibling output is untouched");
    assert.strictEqual("mediaAssetId" in job.outputs[1], false, "and acquires no identity it did not earn");
    assert.strictEqual(job.outputs[2].assetId, LIBRARY_ID, "and the blocking output's library link is intact");
  }

  {
    /* MATCHED BY PATH, NEVER BY BARE FILENAME. Two shots holding same-named
       takes is ordinary, and matching on the basename alone is the false-linkage
       class C1 fixed in the indexer — SH010's record landing on SH020's file. */
    const job = deliveredJob();
    const changed = D.repairJobOutputIdentity(job, {
      dir: "shots/SH-020/takes", from: "TAKE_1.png", to: "MOVED.png", assetId: ID_A,
    });
    assert.deepStrictEqual(changed, [], "a rename in ANOTHER shot's takes folder repairs nothing here");
    assert.strictEqual(job.outputs[0].name, "TAKE_1.png");
    assert.strictEqual("mediaAssetId" in job.outputs[0], false,
      "and above all it does not stamp this file's record with another file's identity");
  }

  {
    /* The blocking directory is a different scope again, inside the same shot. */
    const job = deliveredJob();
    D.repairJobOutputIdentity(job, { dir: "shots/SH-010/blocking", from: "BLOCK_1.png", to: "GUIDE.png", assetId: ID_B });
    assert.strictEqual(job.outputs[2].name, "GUIDE.png");
    assert.strictEqual(job.outputs[2].mediaAssetId, ID_B);
    assert.strictEqual(job.outputs[0].name, "TAKE_1.png", "and the takes folder is not touched by a blocking rename");
  }

  {
    /* THE SECOND RENAME. This is what identity buys, and the property C2's
       closeout named for its successor: once an output carries an id, the next
       repair finds it by identity even though the filename it is matching on has
       already moved on. */
    const job = deliveredJob();
    D.repairJobOutputIdentity(job, { dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "FIRST.png", assetId: ID_A });
    /* Something moved the bytes again without CineBraid writing the name. */
    job.outputs[0].name = "STALE.png";
    job.outputs[0].url = "/assets/shots/SH-010/takes/STALE.png";
    const second = D.repairJobOutputIdentity(job, { dir: "shots/SH-010/takes", from: "FIRST.png", to: "SECOND.png", assetId: ID_A });
    assert.strictEqual(second.length, 1, "the second rename finds the output through its identity, not through its name");
    assert.strictEqual(job.outputs[0].name, "SECOND.png");
  }

  {
    /* An UNANCHORED rename — no ledger yet, or a file whose bytes were never
       readable. The filename is still repaired and no identity is invented,
       which is the pre-C1 behaviour rather than a new failure. */
    const job = deliveredJob();
    const changed = D.repairJobOutputIdentity(job, { dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "APPROVED.png", assetId: "" });
    assert.strictEqual(changed.length, 1);
    assert.strictEqual(job.outputs[0].name, "APPROVED.png", "the filename still follows the bytes");
    assert.strictEqual("mediaAssetId" in job.outputs[0], false, "and nothing invents an identity it cannot prove");
  }

  {
    /* A malformed id on the change is refused, not stored. */
    const job = deliveredJob();
    D.repairJobOutputIdentity(job, { dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "APPROVED.png", assetId: "APPROVED.png" });
    assert.strictEqual(job.outputs[0].name, "APPROVED.png");
    assert.strictEqual("mediaAssetId" in job.outputs[0], false, "a filename is not an identity and must be refused here too");
  }

  {
    /* A no-op rename changes nothing, and a job with no outputs is not an error. */
    const job = deliveredJob();
    const before = JSON.stringify(job);
    assert.deepStrictEqual(D.repairJobOutputIdentity(job, { dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "TAKE_1.png", assetId: ID_A }), []);
    assert.deepStrictEqual(D.repairJobOutputIdentity(job, { dir: "", from: "TAKE_1.png", to: "X.png" }), []);
    assert.strictEqual(JSON.stringify(job), before);
    assert.deepStrictEqual(D.repairJobOutputIdentity({ id: "empty" }, { dir: "shots/SH-010/takes", from: "a", to: "b" }), []);
    assert.deepStrictEqual(D.jobOutputEdges(null), []);
  }
  console.log("  repair · the renamed output follows its bytes with URL and identity, another shot's rename is refused, a second rename resolves by identity, and an unanchored rename invents nothing");
}

/* ===========================================================================
   3. The live readers, in the page's own context.

   Asserted against automation.js's real functions rather than against the
   helper they call, because the point of C4's reader half is that the LIVE
   surface resolves identity-first — a suite that only exercised
   jobOutputMatcher() would pass with the readers still matching strings. */
async function readerSection(options = {}) {
  const project = buildFixture();
  const shot = project.shots.find((row) => row.id === "L1-01") || project.shots[0];
  const frame = (shot.keyframes || [])[0];
  const scan = {
    anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { [shot.id]: {
      takes: [
        { name: "RENAMED_A.png", url: "/assets/x/RENAMED_A.png", assetId: ID_A },
        { name: "TAKE_2.png", url: "/assets/x/TAKE_2.png", assetId: ID_B },
      ], locked: [], blocking: [],
    } },
  };
  const rendered = await render(`#/shot/${shot.id}`, project, { ...options, scan });

  const seen = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const s = P.shots.find((row) => row.id === ${JSON.stringify(shot.id)});
    const frameId = ${JSON.stringify(frame ? frame.id : "")};
    /* A job whose recorded filename is stale because the approval rename moved
       the bytes, carrying the identity that rename anchored. */
    const identified = { id: "j1", outputs: [
      { type: "candidate", name: "PRE_RENAME_A.png", url: "/assets/shots/" + s.id + "/takes/PRE_RENAME_A.png", mediaAssetId: ${JSON.stringify(ID_A)} },
    ] };
    /* The same job as a pre-C4 project holds it: filename only, still accurate. */
    const filenameOnly = { id: "j2", outputs: [
      { type: "candidate", name: "TAKE_2.png", url: "/assets/shots/" + s.id + "/takes/TAKE_2.png" },
    ] };
    /* And the pre-C4 shape with a filename that no longer names anything. */
    const stale = { id: "j3", outputs: [
      { type: "candidate", name: "PRE_RENAME_A.png", url: "/assets/shots/" + s.id + "/takes/PRE_RENAME_A.png" },
    ] };
    return {
      identified: v626FrameRowsFromJob(s.id, frameId, identified).map((row) => row.name),
      filenameOnly: v626FrameRowsFromJob(s.id, frameId, filenameOnly).map((row) => row.name),
      stale: v626FrameRowsFromJob(s.id, frameId, stale).map((row) => row.name),
      matcherIsShared: typeof jobOutputMatcher === "function",
      readerSource: String(v626FrameRowsFromJob),
    };
  })())`, rendered.context));

  assert.strictEqual(seen.matcherIsShared, true,
    "the shared job-output resolver is loaded in the browser scope before automation.js uses it");
  assert.deepStrictEqual(seen.identified, ["RENAMED_A.png"],
    "the live frame reader resolves a job's delivery through identity after the approval rename moved it");
  assert.deepStrictEqual(seen.filenameOnly, ["TAKE_2.png"],
    "and a pre-C4 job with no identity still resolves by filename exactly as before");
  assert.deepStrictEqual(seen.stale, [],
    "while an output naming nothing resolves to nothing rather than to a neighbour");
  assert(/jobOutputMatcher/.test(seen.readerSource),
    "the live reader routes through the one resolver rather than re-deriving a filename Set");

  /* The second live reader, asserted at source because it runs only inside an
     entity automation turn. Wiring rather than behaviour, and named as such. */
  const automationSource = fs.readFileSync(path.join(ROOT, "public", "automation.js"), "utf8");
  const entityReader = automationSource.split("\n").filter((line) => /entityMedia\(list, entity\)\.filter\(/.test(line));
  assert.strictEqual(entityReader.length, 1, "there is exactly one entity-state job reader to keep honest");
  assert(/jobOutputMatcher/.test(entityReader[0]),
    "and it resolves through the shared matcher rather than a filename list");
  console.log("  readers · the live frame reader resolves identity-first, a pre-C4 job still resolves by filename, and both job readers route through the one resolver");
  return seen;
}

/* ===========================================================================
   4. The durable writer, in process.

   registerFalGeneration() returns exactly one thing — the C4 repair — so it can
   be exercised against a real generation-jobs.json without a provider, a port or
   a browser. The route-level proof follows in section 5; this is the section
   that pins the writer's own rules: read before write, refuse nothing silently,
   and never throw. */
function stubApp() {
  return { get() {}, post() {} };
}

async function ledgerSection() {
  const { registerFalGeneration } = require("../fal-generation");
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-c4-ledger-"));
  const projectsRoot = path.join(sandbox, "projects");
  const dirFor = (slug) => path.join(projectsRoot, slug);
  const api = registerFalGeneration(stubApp(), {
    readConfig: () => ({}),
    readProject: () => ({}),
    writeProject: () => {},
    activeSlug: () => "generated",
    projectDirForSlug: (slug) => {
      const dir = dirFor(slug);
      if (!fs.existsSync(dir)) throw new Error(`No such project: ${slug}`);
      return { dir, file: path.join(dir, "project.json") };
    },
  });
  assert.strictEqual(typeof api.repairJobMediaIdentity, "function",
    "the module hands the rename route exactly one thing: the repair");

  const generated = dirFor("generated");
  const quiet = dirFor("quiet");
  fs.mkdirSync(generated, { recursive: true });
  fs.mkdirSync(quiet, { recursive: true });
  const jobsPath = path.join(generated, "generation-jobs.json");
  const quietJobs = path.join(quiet, "generation-jobs.json");
  const writeJobs = () => fs.writeFileSync(jobsPath, JSON.stringify([deliveredJob()], null, 2));

  try {
    writeJobs();
    const repaired = await api.repairJobMediaIdentity({
      slug: "generated", dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "APPROVED.png", assetId: ID_A,
    });
    assert.deepStrictEqual({ repaired: repaired.repaired, jobs: repaired.jobs }, { repaired: 1, jobs: 1 },
      "the repair reports what it changed rather than leaving the caller to infer it");
    const after = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
    assert.strictEqual(after[0].outputs[0].name, "APPROVED.png");
    assert.strictEqual(after[0].outputs[0].mediaAssetId, ID_A);
    assert.strictEqual(after[0].outputs[2].assetId, LIBRARY_ID, "and the blocking output keeps its library link");

    /* READ BEFORE WRITE. `commit` writes whatever the ledger read produced, and a
       missing ledger reads as []. Without the early return, renaming a file in a
       project that has never generated would create a generation history for it. */
    assert.strictEqual(fs.existsSync(quietJobs), false, "precondition: this project has never generated");
    const untouched = await api.repairJobMediaIdentity({
      slug: "quiet", dir: "anchors", from: "CHAR-ZED.png", to: "APPROVED.png", assetId: ID_A,
    });
    assert.strictEqual(untouched.reason, "no-ledger");
    assert.strictEqual(fs.existsSync(quietJobs), false,
      "a rename must never be the thing that mints a generation ledger");

    /* A ledger that exists but that no job matches is left byte-identical: no
       turn is opened, so no rewrite, no .bak and no updatedAt churn. */
    writeJobs();
    const bytes = fs.readFileSync(jobsPath);
    const noMatch = await api.repairJobMediaIdentity({
      slug: "generated", dir: "shots/SH-999/takes", from: "TAKE_1.png", to: "X.png", assetId: ID_A,
    });
    assert.strictEqual(noMatch.reason, "no-match");
    assert.deepStrictEqual(fs.readFileSync(jobsPath), bytes,
      "a rename no job record names rewrites nothing at all");

    /* A CORRUPT PRIMARY WITH A READABLE BACKUP is generation-job-store.js's own
       recovery path, and the repair inherits it rather than reinventing it: the
       backup is read, repaired and promoted. Worth pinning because the obvious
       expectation — "corrupt means refuse" — is wrong here, and a later reader
       who assumed it would file the recovery as a bug. */
    writeJobs();
    await api.repairJobMediaIdentity({ slug: "generated", dir: "shots/SH-010/takes", from: "TAKE_2.png", to: "SECOND.png", assetId: ID_B });
    assert(fs.existsSync(`${jobsPath}.bak`), "precondition: the store took a backup before replacing the primary");
    fs.writeFileSync(jobsPath, "{ not json");
    const recovered = await api.repairJobMediaIdentity({
      slug: "generated", dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "APPROVED.png", assetId: ID_A,
    });
    assert.strictEqual(recovered.reason, "repaired");
    assert.strictEqual(JSON.parse(fs.readFileSync(jobsPath, "utf8"))[0].outputs[0].name, "APPROVED.png",
      "the store's backup recovery carries the repair through, rather than the repair defeating it");

    /* AN UNREADABLE LEDGER WITH NO BACKUP is the real refusal, and it must not
       throw: the file has already moved by the time this runs, and a sidecar
       problem must not become an error the director sees on a completed approval. */
    const brokenDir = dirFor("broken");
    fs.mkdirSync(brokenDir, { recursive: true });
    const brokenJobs = path.join(brokenDir, "generation-jobs.json");
    fs.writeFileSync(brokenJobs, "{ not json");
    /* Asserted rather than assumed. "It did not throw" is only evidence if the
       suite would have FAILED had it thrown, so the throw is converted into an
       assertion here instead of being allowed to escape as an exception. */
    const contained = async (label, change) => {
      try {
        return await api.repairJobMediaIdentity(change);
      } catch (error) {
        return assert.fail(`${label}: the repair must contain its own failures rather than throwing into the rename route — the file has already moved by then. Got: ${error && error.message}`);
      }
    };
    const corrupt = await contained("unreadable ledger", {
      slug: "broken", dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "APPROVED.png", assetId: ID_A,
    });
    assert.strictEqual(corrupt.reason, "failed", "an unreadable ledger is reported, not thrown");
    assert.strictEqual(fs.readFileSync(brokenJobs, "utf8"), "{ not json",
      "and is left exactly as it was rather than replaced with an empty history");

    const missing = await contained("unknown project", { slug: "nope", dir: "anchors", from: "a.png", to: "b.png" });
    assert.strictEqual(missing.reason, "no-project", "an unknown project is reported, not thrown");
    const nothing = await contained("no-op rename", { slug: "generated", dir: "anchors", from: "a.png", to: "a.png" });
    assert.strictEqual(nothing.reason, "no-change", "and a no-op rename opens nothing");

    console.log("  ledger · the one writer repairs through the commit chain, reads before it writes, rewrites nothing it does not match, and never throws");
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
  }
}

/* ===========================================================================
   5. The real server: POST /api/media/rename keeps the generation ledger true.

   This is the live path. The browser has no write access to generation-jobs.json,
   so the repair has to happen server-side inside the route that moves the file —
   and it has to happen inside fal-generation.js's existing per-project commit
   chain, because that ledger has exactly one writer and that is load-bearing. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100"
  + "05fe02fea7b5f1a30000000049454e44ae426082", "hex");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function serverSection() {
  /* Outside the repository, so no shipped sample and no tracked project data can
     be reached by anything below. */
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-c4-"));
  const projectsRoot = path.join(sandbox, "projects");
  const slug = "c4-project";
  const projectDir = path.join(projectsRoot, slug);
  const takes = path.join(projectDir, "shots", "SH-010", "takes");
  const configPath = path.join(sandbox, "config.json");
  const jobsPath = path.join(projectDir, "generation-jobs.json");
  const ledgerPath = path.join(projectDir, "media-assets.json");
  /* A second project that never generated, to prove a rename does not mint a
     generation history for a project that has none. */
  const quietSlug = "c4-quiet";
  const quietDir = path.join(projectsRoot, quietSlug);

  let child = null;
  let output = "";
  let base = "";

  function writeProjects() {
    fs.mkdirSync(takes, { recursive: true });
    for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media"])
      fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
    fs.writeFileSync(path.join(takes, "TAKE_1.png"), Buffer.concat([PNG, Buffer.from("one")]));
    fs.writeFileSync(path.join(takes, "TAKE_2.png"), Buffer.concat([PNG, Buffer.from("two")]));
    fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      meta: { title: "C4", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
      qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
      scenes: [{ id: "SC-01", title: "Scene one" }],
      shots: [{
        id: "SH-010", scene: "SC-01", title: "C4", desc: "x", characters: [], codes: [],
        creationBrief: { propIds: [], vehicleIds: [], frameWorkflows: {} },
        keyframes: [{ id: "frame-a", label: "A", winner: "", required: true, generationPackages: [] }],
        clips: [],
        candidateFiles: [
          { stored: "TAKE_1.png", decision: "unreviewed", generationJobId: "fal-job-1" },
          { stored: "TAKE_2.png", decision: "unreviewed", generationJobId: "fal-job-1" },
        ],
      }],
      agentRuns: [], decisions: [], sessions: [], finishJobs: [],
    }, null, 2));
    /* Written directly rather than generated: a completed job in exactly the
       shape ingest() leaves one, with no provider ever contacted. */
    fs.writeFileSync(jobsPath, JSON.stringify([{
      id: "fal-job-1", status: "COMPLETED", purpose: "frame", shotId: "SH-010", frameId: "frame-a",
      model: "openai/gpt-image-2", externalId: "req-1", ingestedAt: "2026-08-12T00:00:00.000Z",
      outputs: [
        { type: "candidate", name: "TAKE_1.png", url: "/assets/shots/SH-010/takes/TAKE_1.png", frameId: "frame-a", correctionOf: "" },
        { type: "candidate", name: "TAKE_2.png", url: "/assets/shots/SH-010/takes/TAKE_2.png", frameId: "frame-a", correctionOf: "" },
      ],
    }], null, 2));

    fs.mkdirSync(path.join(quietDir, "anchors"), { recursive: true });
    for (const dir of ["plates", "props", "vehicles", "audio", "media"])
      fs.mkdirSync(path.join(quietDir, dir), { recursive: true });
    fs.writeFileSync(path.join(quietDir, "anchors", "CHAR-ZED.png"), Buffer.concat([PNG, Buffer.from("zed")]));
    fs.writeFileSync(path.join(quietDir, "project.json"), JSON.stringify({
      meta: { title: "Quiet", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
      qcChecklist: [],
      characters: [{ id: "CHAR-ZED", name: "Zed", approvedFile: "CHAR-ZED.png", continuityStates: [{ id: "state-default", name: "Default", isDefault: true }] }],
      locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
      scenes: [], shots: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
    }, null, 2));

    fs.writeFileSync(configPath, JSON.stringify({
      activeProject: slug, assistant: { provider: "ollama", visionProvider: "ollama" },
    }, null, 2));
  }

  async function start() {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const deadline = Date.now() + 20000;
    for (;;) {
      try { if ((await fetch(`${base}/api/me`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`Server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  async function stop() {
    if (!child) return;
    const dead = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await dead;
    child = null;
  }
  /* Activation runs off the request path; a client observes it by keeping the
     product doing what it normally does. The predicate names the condition, so a
     timeout says which one never held. */
  async function waitForHashed(relativePath) {
    const deadline = Date.now() + 25000;
    let last = null;
    for (;;) {
      if (fs.existsSync(ledgerPath)) {
        try {
          last = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
          const row = (last.assets || []).find((asset) => asset.storage?.path === relativePath);
          if (row && row.contentHash) return row;
        } catch {}
      }
      if (Date.now() > deadline)
        throw new Error(`never anchored ${relativePath}: ${JSON.stringify((last?.assets || []).map((a) => [a.storage?.path, a.contentHash]))}\n${output}`);
      await fetch(`${base}/api/scan`).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  try {
    writeProjects();
    await start();
    await fetch(`${base}/api/project`);
    const anchored = await waitForHashed("shots/SH-010/takes/TAKE_1.png");

    const renamed = await (await fetch(`${base}/api/media/rename`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "SH-010_FRAME_A_APPROVED" }),
    })).json();
    assert.strictEqual(renamed.name, "SH-010_FRAME_A_APPROVED.png");
    assert.strictEqual(renamed.assetId, anchored.assetId, "the rename still returns the identity it anchored (C2)");

    /* THE DEFECT, CLOSED. Read from disk rather than from the API, because the
       durable record is what a later session, a support bundle and an export all
       read. */
    const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
    const onDisk = fs.readdirSync(takes);
    assert.strictEqual(jobs[0].outputs[0].name, "SH-010_FRAME_A_APPROVED.png",
      "the job record names the file the approval rename produced");
    assert(onDisk.includes(jobs[0].outputs[0].name),
      "and that file is actually on disk — the pre-C4 record named one that was not");
    assert.strictEqual(jobs[0].outputs[0].url, "/assets/shots/SH-010/takes/SH-010_FRAME_A_APPROVED.png",
      "the URL follows the name, so the preview is not traded for the pointer");
    assert.strictEqual(jobs[0].outputs[0].mediaAssetId, anchored.assetId,
      "and the job records WHICH BYTES it delivered, proven at the one moment that can be proven");
    assert.strictEqual(jobs[0].outputs[1].name, "TAKE_2.png", "the sibling output is untouched");
    assert.strictEqual("mediaAssetId" in jobs[0].outputs[1], false,
      "and acquires no identity, because nothing proved anything about it");

    /* The route still answers, and the job list the browser reads agrees with
       the file on disk. */
    const listed = await (await fetch(`${base}/api/generation/fal/jobs`)).json();
    assert.strictEqual(listed.jobs[0].outputs[0].mediaAssetId, anchored.assetId,
      "the serialized job carries the identity to the browser");

    /* A SECOND rename of the same bytes, now resolvable by identity. */
    await fetch(`${base}/api/media/rename`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, dir: "shots/SH-010/takes", from: "SH-010_FRAME_A_APPROVED.png", to: "SH-010_FRAME_A_FINAL" }),
    });
    const twice = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
    assert.strictEqual(twice[0].outputs[0].name, "SH-010_FRAME_A_FINAL.png",
      "a second rename of the same media keeps the job record true");
    assert.strictEqual(twice[0].outputs[0].mediaAssetId, anchored.assetId,
      "and the identity is stable across both moves — it is the bytes, not the name");

    /* A PROJECT THAT HAS NEVER GENERATED must not acquire a generation history
       because a file moved. `commit` would write `[]` for a missing ledger, so
       the repair reads before it writes. */
    const quietJobs = path.join(quietDir, "generation-jobs.json");
    assert.strictEqual(fs.existsSync(quietJobs), false, "precondition: no generation ledger");
    const quietRename = await (await fetch(`${base}/api/media/rename`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSlug: quietSlug, dir: "anchors", from: "CHAR-ZED.png", to: "CHAR-ZED_APPROVED" }),
    })).json();
    assert.strictEqual(quietRename.ok, true, "a project with no generation history renames normally");
    assert.strictEqual(fs.existsSync(quietJobs), false,
      "and renaming a file must never be the thing that mints a generation ledger");

    /* A CORRUPT ledger must not turn a completed approval into an error. The
       filesystem move already happened; blocking on a sidecar is the wrong trade,
       and it is the one anchorBeforeRename already refuses to make. */
    fs.writeFileSync(path.join(takes, "TAKE_3.png"), Buffer.concat([PNG, Buffer.from("three")]));
    fs.writeFileSync(jobsPath, "{ not json");
    const duringCorruption = await fetch(`${base}/api/media/rename`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, dir: "shots/SH-010/takes", from: "TAKE_3.png", to: "TAKE_3_APPROVED" }),
    });
    assert.strictEqual(duringCorruption.status, 200,
      "an unreadable generation ledger must not fail the rename the approval depends on");
    assert(fs.readdirSync(takes).includes("TAKE_3_APPROVED.png"), "and the file really moved");
    assert.strictEqual(fs.readFileSync(jobsPath, "utf8"), "{ not json",
      "and the unreadable ledger is left exactly as it was, never overwritten with an empty history");

    console.log("  server · the rename route repairs the generation ledger through the one commit chain, twice over, without minting a ledger for a project that has none and without failing on a corrupt one");
    return { assetId: anchored.assetId };
  } finally {
    await stop();
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
  }
}

/* ===========================================================================
   6. Pre-C4 compatibility, and C2/C3 untouched. */
async function compatibilitySection(options = {}) {
  const project = buildFixture();
  const shot = project.shots.find((row) => row.id === "L1-01") || project.shots[0];
  const scan = {
    anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { [shot.id]: { takes: [{ name: "FRAME_A.png", url: "/assets/x/FRAME_A.png", assetId: ID_A }], locked: [], blocking: [] } },
  };
  const before = JSON.stringify(shot);
  const rendered = await render(`#/shot/${shot.id}`, project, { ...options, scan });
  const after = JSON.parse(vm.runInContext(
    `JSON.stringify((() => { const s = P.shots.find((r) => r.id === ${JSON.stringify(shot.id)});
      return { doc: s, jobs: (typeof FAL_GENERATION_JOBS === "undefined" ? [] : FAL_GENERATION_JOBS) }; })())`,
    rendered.context));

  assert(!JSON.stringify(after).includes("mediaAssetId"),
    "rendering a project must not write mediaAssetId anywhere — identity comes from a rename, never from a read");
  /* Scoped to what C4 owns, deliberately. Rendering a shot DOES normalise it —
     ensureShotCreation() seeds a creationBrief, clips acquire their defaults —
     and that is pre-existing behaviour C1, C2 and C3 all leave alone. The claim
     here is the C3 one: no approval pointer moved, and no identity appeared. */
  const wasShot = JSON.parse(before);
  assert.strictEqual(after.doc.keyframes[0].winner, wasShot.keyframes[0].winner, "no approval pointer moved");
  assert.strictEqual(after.doc.clips[0].videoWinner, wasShot.clips[0].videoWinner);
  for (const field of ["winnerAssetId", "videoWinnerAssetId", "winnerEndAssetId", "approvedAssetId"])
    assert(!JSON.stringify(after.doc).includes(field),
      `rendering must not write ${field} either — C2's and C3's read-purity rules still hold`);

  /* C2 and C3 behave exactly as they did. The three dialects share the role
     vocabulary, the identity rules and resolveApprovalMedia(), and share nothing
     else — the constraint media-assets.js:244 states and C3 restated. */
  const entity = {
    id: "LOC-HULL", approvedFile: "A.png",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "A.png" }],
    coverageSlots: [{ id: "establishing", label: "Master establishing", approvedFile: "A.png" }],
    candidateFiles: [{ stored: "B.png", decision: "rejected" }],
  };
  const media = [{ name: "A.png" }, { name: "B.png" }, { name: "C.png" }];
  const entityPartition = D.partitionEntityMedia(entity, media);
  assert.deepStrictEqual(entityPartition.approved.map((r) => r.name), ["A.png"]);
  assert.deepStrictEqual(entityPartition.approved[0].targets.map((t) => t.kind), ["state", "coverage"]);
  assert.deepStrictEqual(entityPartition.rejected.map((r) => r.name), ["B.png"]);

  const shotFixture = {
    id: "SH-010", winner: "TAKE_A.png",
    keyframes: [{ id: "frame-a", label: "A", winner: "TAKE_A.png" }],
    clips: [{ id: "m", videoWinner: "CLIP.mp4", winner: "TAKE_A.png", winnerEnd: "TAKE_B.png" }],
    candidateFiles: [{ stored: "TAKE_C.png", decision: "rejected" }],
  };
  assert.deepStrictEqual(D.shotApprovalEdges(shotFixture).map((e) => `${e.kind}:${e.field}`),
    ["shot:winner", "frame:winner", "motion:videoWinner", "clip-first:winner", "clip-last:winnerEnd"],
    "C3's shot enumeration is unchanged");
  assert.strictEqual(D.shotMediaDisposition(shotFixture, "TAKE_C.png").role, "rejected");

  assert.strictEqual(D.APPROVED_ASSET_ID_FIELD, "approvedAssetId");
  assert.strictEqual(D.CANDIDATE_ASSET_ID_FIELD, "assetId");
  assert.strictEqual(D.shotAssetIdField("videoWinner"), "videoWinnerAssetId");
  assert.strictEqual(D.JOB_OUTPUT_ASSET_ID_FIELD, "mediaAssetId");
  console.log("  compatibility · a pre-C4 project renders identically and acquires no identity by being read, and C2 and C3 keep their own vocabularies");
}

async function main() {
  console.log("P4-SEM-C4 job media identity");
  contractSection();
  repairSection();
  await readerSection();
  await ledgerSection();
  await serverSection();
  await compatibilitySection();
  console.log("P4-SEM-C4 job media identity passed.");
}

module.exports = {
  deliveredJob, ID_A, ID_B, LIBRARY_ID,
  contractSection, repairSection, readerSection, ledgerSection, serverSection, compatibilitySection, main,
};
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
