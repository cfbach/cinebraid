/* CineBraid Phase 2b — indexing identity and idempotence.
 *
 * The ledger is an INDEX. It observes what a project already has and records it;
 * it never becomes the source of truth for approval, never rewrites project.json,
 * and never changes a filename. The property every case below asserts explicitly is
 * assetId STABILITY: an identity, once minted, survives everything except the
 * asset genuinely ceasing to be that asset.
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const A = require("../src/media/media-assets");
const S = require("../src/media/media-asset-store");
const I = require("../src/media/media-asset-indexer");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-backfill-"));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let made = 0;
function makeProject({ takes = ["A.png"], entity = [], blocking = [], library = [], audio = [] } = {}) {
  const dir = path.join(TEMP, `p${made += 1}`);
  fs.mkdirSync(path.join(dir, "shots", "S-01", "takes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "shots", "S-01", "blocking"), { recursive: true });
  for (const name of ["anchors", "plates", "props", "vehicles", "audio", "media"])
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  for (const name of takes) fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", name), PNG);
  for (const name of blocking) fs.writeFileSync(path.join(dir, "shots", "S-01", "blocking", name), PNG);
  for (const name of entity) fs.writeFileSync(path.join(dir, "anchors", name), PNG);
  for (const name of library) fs.writeFileSync(path.join(dir, "media", name), PNG);
  for (const name of audio) fs.writeFileSync(path.join(dir, "audio", name), PNG);
  return dir;
}
function project(overrides = {}) {
  return {
    shots: [{ id: "S-01", winner: "A.png", keyframes: [], clips: [], candidateFiles: [] }],
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    ...overrides,
  };
}
const idsOf = (dir) => S.readLedger(dir).ledger.assets
  .map((a) => `${a.storage.path}=${a.assetId}`).sort();
const rowFor = (dir, p) => S.readLedger(dir).ledger.assets.find((a) => a.storage.path === p);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  /* ================= 1. first index of a project with no ledger ================= */
  const fresh = makeProject({ takes: ["A.png", "B.mp4"], entity: ["CHAR-KAI.png"] });
  const p1 = project({
    shots: [{
      id: "S-01", winner: "A.png", keyframes: [{ id: "frame-a", winner: "A.png" }], clips: [],
      candidateFiles: [
        { stored: "A.png", decision: "shortlist", frameId: "frame-a", generationJobId: "gen-1" },
        { stored: "B.mp4", decision: "unreviewed" },
      ],
    }],
    characters: [{ id: "CHAR-KAI", approvedFile: "CHAR-KAI.png", continuityStates: [],
      candidateFiles: [{ stored: "CHAR-KAI.png", decision: "approved-reference" }] }],
  });
  let result = await I.indexProject({ projectDir: fresh, slug: "p1", project: p1 });
  assert.strictEqual(result.status, "complete");
  assert.strictEqual(result.minted, 3);
  const firstIds = idsOf(fresh);

  /* Inference used only what the source proves. */
  const shotRow = rowFor(fresh, "shots/S-01/takes/A.png");
  assert.strictEqual(shotRow.role, "frame-approved", "a winner-pointed still is approved");
  assert.strictEqual(shotRow.lifecycle, "approved");
  assert.strictEqual(shotRow.scope.frameId, "frame-a", "frameId comes from the candidate row, not the filename");
  assert.strictEqual(shotRow.source, "generated", "generationJobId is what proves generated");
  assert.strictEqual(shotRow.legacy.candidateArray, "shot.candidateFiles");
  const videoRow = rowFor(fresh, "shots/S-01/takes/B.mp4");
  assert.strictEqual(videoRow.mediaType, "video");
  assert.strictEqual(videoRow.role, "motion-candidate");
  assert.strictEqual(videoRow.lifecycle, "candidate");
  assert.strictEqual(videoRow.source, "unknown", "no evidence means unknown, not a guess");
  const entityRow = rowFor(fresh, "anchors/CHAR-KAI.png");
  assert.strictEqual(entityRow.role, "entity-reference");
  assert.strictEqual(entityRow.lifecycle, "approved", "an entity approvedFile pointer is a live pointer");
  assert.strictEqual(entityRow.scope.entityId, "CHAR-KAI");

  /* ================= 2. second identical index ================= */
  result = await I.indexProject({ projectDir: fresh, slug: "p1", project: p1 });
  assert.strictEqual(result.minted, 0, "a second pass mints nothing");
  assert.strictEqual(result.reused, 3);
  assert.strictEqual(result.wrote, false, "an unchanged ledger is not rewritten");
  assert.deepStrictEqual(idsOf(fresh), firstIds, "every assetId is stable");

  /* Ten more passes must not drift. */
  for (let i = 0; i < 10; i += 1) await I.indexProject({ projectDir: fresh, slug: "p1", project: p1 });
  assert.deepStrictEqual(idsOf(fresh), firstIds, "ten repeated passes produce stable ids and no duplicates");
  assert.strictEqual(S.readLedger(fresh).ledger.assets.length, 3, "and no duplicate rows");

  /* ================= 3. interrupted then resumed ================= */
  const big = makeProject({ takes: Array.from({ length: 25 }, (_, i) => `T${i}.png`) });
  let chunks = 0;
  await I.indexProject({
    projectDir: big, slug: "big", project: project(), chunkSize: 5,
    activeSlug: () => (chunks++ < 2 ? "big" : "somewhere-else"),
  });
  const partial = S.readLedger(big);
  assert.strictEqual(A.validateLedger(partial.ledger).ok, true, "an interrupted pass leaves a VALID ledger");
  const partialIds = idsOf(big);
  const resumed = await I.indexProject({ projectDir: big, slug: "big", project: project(), chunkSize: 5 });
  assert.strictEqual(S.readLedger(big).ledger.assets.length, 25, "resuming completes the pass");
  assert(resumed.minted > 0 && resumed.reused > 0, "it mints only what was missing");
  for (const entry of partialIds)
    assert(idsOf(big).includes(entry), "ids from the interrupted pass survive the resume");

  /* ================= 4. project switch mid-index ================= */
  const projectA = makeProject({ takes: ["A1.png", "A2.png", "A3.png", "A4.png"] });
  const projectB = makeProject({ takes: ["B1.png"] });
  let calls = 0;
  const switched = await I.indexProject({
    projectDir: projectA, slug: "A", project: project(), chunkSize: 1,
    activeSlug: () => (calls++ === 0 ? "A" : "B"),
  });
  assert.strictEqual(switched.status, "aborted-project-switch", "the pass must abandon itself, not continue");
  assert.strictEqual(S.readLedger(projectB).exists, false, "project B must be completely untouched");
  const aLedger = S.readLedger(projectA);
  if (aLedger.exists)
    for (const asset of aLedger.ledger.assets)
      assert(asset.storage.path.startsWith("shots/S-01/takes/A"), "every row belongs to project A");

  /* ================= 5. a newly added file ================= */
  const growing = makeProject({ takes: ["A.png"] });
  await I.indexProject({ projectDir: growing, slug: "g", project: project() });
  const beforeAdd = idsOf(growing);
  fs.writeFileSync(path.join(growing, "shots", "S-01", "takes", "NEW.png"), PNG);
  const added = await I.indexProject({ projectDir: growing, slug: "g", project: project() });
  assert.strictEqual(added.minted, 1, "only the new file is minted");
  for (const entry of beforeAdd) assert(idsOf(growing).includes(entry), "existing ids are untouched");

  /* ================= 6. a definitely removed file ================= */
  const shrinking = makeProject({ takes: ["KEEP.png", "GONE.png"] });
  await I.indexProject({ projectDir: shrinking, slug: "s", project: project() });
  const goneId = rowFor(shrinking, "shots/S-01/takes/GONE.png").assetId;
  fs.unlinkSync(path.join(shrinking, "shots", "S-01", "takes", "GONE.png"));
  const removed = await I.indexProject({ projectDir: shrinking, slug: "s", project: project() });
  assert.strictEqual(removed.missing, 1);
  const goneRow = rowFor(shrinking, "shots/S-01/takes/GONE.png");
  assert(goneRow, "a removed file's row is RETAINED, never deleted");
  assert.strictEqual(goneRow.storage.missing, true, "and marked missing");
  assert.strictEqual(goneRow.assetId, goneId, "with its identity intact");
  /* And it comes back. */
  fs.writeFileSync(path.join(shrinking, "shots", "S-01", "takes", "GONE.png"), PNG);
  await I.indexProject({ projectDir: shrinking, slug: "s", project: project() });
  const backRow = rowFor(shrinking, "shots/S-01/takes/GONE.png");
  assert.strictEqual(backRow.assetId, goneId, "a returning file reuses its assetId");
  assert.strictEqual(backRow.storage.missing, undefined, "and is no longer missing");

  /* ================= 7. stat metadata churn never re-mints ================= */
  const churn = makeProject({ takes: ["A.png"] });
  await I.indexProject({ projectDir: churn, slug: "c", project: project() });
  const churnBefore = rowFor(churn, "shots/S-01/takes/A.png");
  const target = path.join(churn, "shots", "S-01", "takes", "A.png");
  const future = Date.now() / 1000 + 3600;
  fs.utimesSync(target, future, future);
  await I.indexProject({ projectDir: churn, slug: "c", project: project() });
  let churnAfter = rowFor(churn, "shots/S-01/takes/A.png");
  assert.strictEqual(churnAfter.assetId, churnBefore.assetId, "an mtime change must NEVER re-mint identity");
  assert.strictEqual(churnAfter.needsVerify, true, "it only flags the row for later verification");
  assert.strictEqual(churnAfter.hashState, "unhashed");
  assert.strictEqual(churnAfter.contentHash, null);
  /* Size change, same rule. */
  fs.writeFileSync(target, Buffer.concat([PNG, Buffer.from("padding")]));
  await I.indexProject({ projectDir: churn, slug: "c", project: project() });
  churnAfter = rowFor(churn, "shots/S-01/takes/A.png");
  assert.strictEqual(churnAfter.assetId, churnBefore.assetId, "a size change must NEVER re-mint identity either");
  assert.strictEqual(S.readLedger(churn).ledger.assets.length, 1, "and must not create a second row");

  /* ================= 8. legacy dialects and unreferenced media ================= */
  const dialects = makeProject({
    takes: ["ORPHAN.png"], blocking: ["G.png"], library: ["LIB.png"], audio: ["VO.wav"],
  });
  await I.indexProject({
    projectDir: dialects, slug: "d",
    /* `storagePath` is what fal-generation.js writes on every blocking row, and it
       is what the product's own resolvers read (public/media.js:51, server.js:4964).
       A row carrying only a bare `file` resolves to `media/<file>` everywhere in
       CineBraid, so a fixture that put one in shots/S-01/blocking/ was describing a
       row the product itself would render broken. */
    project: project({ mediaAssets: [{
      id: "blocking-media-1", file: "G.png", storagePath: "shots/S-01/blocking/G.png",
      links: [{ targetType: "shot", targetId: "S-01", role: "blocking-frame", blockingState: "active" }],
    }] }),
  });
  const orphan = rowFor(dialects, "shots/S-01/takes/ORPHAN.png");
  assert.strictEqual(orphan.legacy.candidateKey, null, "media with no project record is an honest orphan");
  assert.strictEqual(orphan.source, "unknown");
  assert.strictEqual(rowFor(dialects, "shots/S-01/blocking/G.png").role, "blocking-guide");
  assert.strictEqual(rowFor(dialects, "shots/S-01/blocking/G.png").lifecycle, "approved", "an active blocking guide");
  assert.strictEqual(rowFor(dialects, "shots/S-01/blocking/G.png").legacy.libraryAssetId, "blocking-media-1");
  assert.strictEqual(rowFor(dialects, "media/LIB.png").role, "unknown", "a library file proves no production role");
  assert.strictEqual(rowFor(dialects, "audio/VO.wav").mediaType, "audio");

  /* ================= 9. a project with zero media ================= */
  const bare = makeProject({ takes: [] });
  const bareResult = await I.indexProject({ projectDir: bare, slug: "bare", project: project() });
  assert.strictEqual(bareResult.indexed, 0);
  assert.strictEqual(bareResult.wrote, false, "nothing to index means nothing written");
  assert.strictEqual(S.readLedger(bare).exists, false, "and no ledger is created");

  /* ================= 9b. two rows on one path, in the hostile order =================
     Verification retires a record when the bytes under it are replaced, and its
     successor takes the same path. Which of the two discovery reuses must come from
     the `missing` flag, not from array order: the ledger is a file that a .bak
     recovery, a hand edit or a future writer can reorder, and reusing the retired
     row would un-mark it missing and graft a record describing the old bytes back
     onto the file that replaced them. */
  const contested = makeProject({ takes: ["A.png"] });
  await I.indexProject({ projectDir: contested, slug: "ct", project: project() });
  const contestedLedger = S.readLedger(contested).ledger;
  const live = contestedLedger.assets[0];
  const retired = {
    ...live,
    assetId: A.mintAssetId(),
    contentHash: `sha256:${"a".repeat(64)}`,
    hashState: "hashed",
    storage: { ...live.storage, missing: true },
  };
  /* Deliberately live-first, retired-last — the order that defeats "last wins". */
  contestedLedger.assets = [live, retired];
  S.writeLedgerSync(contested, contestedLedger);

  const reindexed = await I.indexProject({ projectDir: contested, slug: "ct", project: project() });
  assert.strictEqual(reindexed.minted, 0, "no new identity is minted for an already-indexed path");
  const settledContest = S.readLedger(contested).ledger;
  assert.strictEqual(settledContest.assets.find((a) => a.assetId === retired.assetId).storage.missing, true,
    "the retired record stays retired regardless of where it sits in the array");
  assert.strictEqual(settledContest.assets.find((a) => a.assetId === retired.assetId).contentHash,
    retired.contentHash, "and keeps the digest that described the bytes it was retired for");
  assert.strictEqual(
    settledContest.assets.filter((a) => a.storage.path === "shots/S-01/takes/A.png" && !a.storage.missing).length, 1,
    "exactly one live row occupies the path",
  );
  assert.strictEqual(
    settledContest.assets.find((a) => a.storage.path === "shots/S-01/takes/A.png" && !a.storage.missing).assetId,
    live.assetId, "and it is the live one",
  );

  /* ================= 10. a double-corrupt ledger REFUSES ================= */
  const doomed = makeProject({ takes: ["A.png"] });
  await I.indexProject({ projectDir: doomed, slug: "doomed", project: project() });
  fs.writeFileSync(path.join(doomed, "shots", "S-01", "takes", "B.png"), PNG);
  await I.indexProject({ projectDir: doomed, slug: "doomed", project: project() });  /* creates the .bak */
  fs.writeFileSync(S.ledgerPath(doomed), "{ broken");
  fs.writeFileSync(S.backupPath(doomed), "also broken");
  await assert.rejects(
    () => I.indexProject({ projectDir: doomed, slug: "doomed", project: project() }),
    (error) => error.code === "LEDGER_UNREADABLE",
    "indexing must ABORT rather than backfill from empty — that would re-mint every identity",
  );
  assert.strictEqual(fs.readFileSync(S.ledgerPath(doomed), "utf8"), "{ broken",
    "and must not overwrite either corrupt file");
  assert.strictEqual(fs.readFileSync(S.backupPath(doomed), "utf8"), "also broken");

  /* ================= 11. an unreadable project ROOT aborts ================= */
  await assert.rejects(
    () => I.indexProject({ projectDir: path.join(TEMP, "no-such-project"), slug: "x", project: project() }),
    (error) => error.code === "INDEX_ROOT_UNREADABLE",
    "a root that cannot be listed aborts rather than marking every asset missing",
  );

  /* ================= 12. ZERO-PUT: indexing never writes project.json ================= */
  const guarded = makeProject({ takes: ["A.png", "B.png"] });
  const projectsRoot = path.dirname(guarded);
  const slug = path.basename(guarded);
  const configPath = path.join(TEMP, "zero-put-config.json");
  fs.writeFileSync(path.join(guarded, "project.json"), JSON.stringify({
    meta: { title: "Zero PUT", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [], shots: [{ id: "S-01", scene: "", title: "S", desc: "d", keyframes: [], clips: [], candidateFiles: [] }],
    agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  fs.mkdirSync(path.join(guarded, "docs"), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ activeProject: slug }, null, 2));

  const before = fs.readFileSync(path.join(guarded, "project.json"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (c) => { output += c; });
  child.stderr.on("data", (c) => { output += c; });
  try {
    const deadline = Date.now() + 10000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/me`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    /* Open the project the way the app does. Since P4-SEM-C1 that IS the indexing:
       media-asset-service.js schedules a pass on /api/project and /api/scan, so the
       ledger arrives from the SERVER. Wait for it rather than also indexing from
       this process — CineBraid has one local server, so two processes writing one
       ledger is not a shape it has in production, and on Windows the loser of that
       race gets EPERM on the rename. */
    await (await fetch(`http://127.0.0.1:${port}/api/project`)).json();
    await (await fetch(`http://127.0.0.1:${port}/api/scan`)).json();
    const indexDeadline = Date.now() + 10000;
    for (;;) {
      try { if (S.readLedger(guarded).ledger.assets.length === 2) break; } catch {}
      if (Date.now() > indexDeadline) throw new Error(`the server never indexed the project:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    assert.strictEqual(S.readLedger(guarded).exists, true,
      "opening a project through the real server writes the ledger");

    assert(before.equals(fs.readFileSync(path.join(guarded, "project.json"))),
      "project.json must be BYTE-IDENTICAL after opening and indexing");
    const backups = path.join(guarded, "backups");
    assert(!fs.existsSync(backups) || fs.readdirSync(backups).length === 0,
      "no project backup may exist — a backup is what a project write produces");
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }

  /* The server is gone, so there is one writer again. A pass in this process must
     be a complete no-op against what the server's own activation established. */
  const idsBefore = idsOf(guarded);
  const ledgerBytes = fs.readFileSync(S.ledgerPath(guarded), "utf8");
  const again = await I.indexProject({ projectDir: guarded, slug, project: project() });
  assert.strictEqual(again.minted, 0, "the server's activation had already minted every identity");
  assert.strictEqual(again.wrote, false, "an unchanged second pass performs no unnecessary ledger rewrite");
  assert.strictEqual(fs.readFileSync(S.ledgerPath(guarded), "utf8"), ledgerBytes);
  assert.deepStrictEqual(idsOf(guarded), idsBefore, "and preserves every assetId");
  assert(before.equals(fs.readFileSync(path.join(guarded, "project.json"))),
    "still byte-identical after the second pass");

  /* ================= 13. a larger synthetic project stays chunked ================= */
  const large = path.join(TEMP, "large");
  fs.mkdirSync(path.join(large, "shots", "S-01", "takes"), { recursive: true });
  for (let i = 0; i < 2000; i += 1)
    fs.writeFileSync(path.join(large, "shots", "S-01", "takes", `L${i}.png`), PNG);
  const started = Date.now();
  const largeResult = await I.indexProject({ projectDir: large, slug: "large", project: project(), chunkSize: 250 });
  assert.strictEqual(largeResult.indexed, 2000);
  assert(largeResult.chunks >= 8, "a large project must be chunked");
  const largeIds = idsOf(large);
  assert.strictEqual(new Set(largeIds).size, 2000, "2000 distinct identities");
  const repeat = await I.indexProject({ projectDir: large, slug: "large", project: project(), chunkSize: 250 });
  assert.strictEqual(repeat.minted, 0);
  assert.deepStrictEqual(idsOf(large), largeIds, "stable across a repeat");
  console.log(`  2000-file synthetic project indexed in ${Date.now() - started}ms across ${largeResult.chunks} chunks`);

  console.log(
    "MediaAsset backfill suite passed: identity is stable across repeats, resumes, additions, removals, returns and "
    + "metadata churn; a project switch abandons the pass and leaves the other project untouched; a removed file is "
    + "retained and marked rather than deleted; a double-corrupt ledger and an unreadable root both abort; and "
    + "indexing leaves project.json byte-identical with no project write.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(TEMP, { recursive: true, force: true });
  });
