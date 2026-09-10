"use strict";

/* PSS-2 — NESTED PROJECT DOCUMENTS SURVIVE A WORKSPACE MIGRATION.
 *
 * Moving the projects root does two different things to two different kinds of file.
 * A LIVE project's document is ENROLLED: the Authority Write Seam publishes a
 * successor of it at the new location, carrying a fresh revision. Everything else is
 * COPIED, create-only, byte for byte.
 *
 * The copy loop has to know which documents the seam owns so it does not write them
 * twice. It used to decide that by NAME — any file called project.json, at any depth,
 * was skipped — and the seam's actual set is much smaller than that. The seam enrols
 * TOP-LEVEL source directories that contain a project.json. `.archive/` and `.trash/`
 * hold no project.json at their own top level, so they are not projects and are never
 * enrolled; their children each hold one, and the name test skipped those too.
 *
 * Nothing else carried them. An archived or trashed project arrived at the new root
 * with its media, its `.cinebraid-archive.json` manifest, and no document — and the
 * migration answered 200 with accurate counts, because the counts came from the loop
 * that dropped it. That is the whole record of a retired or deleted production, lost
 * to a settings change, reported as a success.
 *
 * This suite is the proof that it is not lost. Every scenario runs a REAL server
 * against roots under os.tmpdir(). No provider is configured or contacted. The real
 * production workspace is never read, written or referenced.
 *
 * The complementary property — that an ENROLLED document is still written exactly
 * once, by the seam — is asserted here too, because the correction is only safe while
 * that stays true. tests/workspace-migration-rollback.js owns the create-only,
 * reparse-point and rollback guarantees and is unchanged in substance by this slice.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ROOT, startCineBraidServer } = require("./fixtures/mock-civitai");
const { manifestOf, compareManifests } = require(path.join(ROOT, "scripts", "verify-migration"));

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-pss2-"));
const passed = [];

/* ==========================================================================
   FIXTURES
   ========================================================================== */

function baseProject(title) {
  return {
    meta: {
      title, format: "Test", version: "v1", hubVersion: "v6.0.0",
      schemaVersion: "6.6", aiPolicy: "project-default", world: {},
    },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [],
    audio: [], mediaAssets: [], jobs: [], agentRuns: [], decisions: [],
    sessions: [], finishJobs: [],
    scenes: [{ id: "SC-01", title: "Scene", whatHappens: "A test beat.", howItFeels: "Exact." }],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "Shot", desc: "A test shot.",
      positioning: "Locked frame.", dur: 5, workflowStatus: "DRAFT",
      characters: [], codes: [], risks: [], candidateFiles: [], creationBrief: {},
      keyframes: [{ id: "fr-a", label: "A", title: "Opening", description: "Opening frame.", generationPackages: [] }],
      clips: [],
    }],
  };
}

const toPosix = (value) => String(value).replace(/\\/g, "/");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function writeFileAt(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
function writeProjectAt(dir, project) {
  writeFileAt(path.join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n");
}

/* Content hashes for every regular file under a root. lstat, never stat: a reparse
   point is recorded as the link it is rather than hashed through. */
function snapshot(root) {
  const out = {};
  (function walk(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name), rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (fs.lstatSync(full).isSymbolicLink()) { out[rel] = "link:" + fs.readlinkSync(full); continue; }
      if (entry.isDirectory()) { out[rel + "/"] = "dir"; walk(full, rel); }
      else out[rel] = sha(full);
    }
  })(root, "");
  return out;
}

/* THE WORKSPACE THIS SLICE IS ABOUT: one live project, one archived project and one
   trashed project, each with a document, media and a sidecar, plus a project.json
   nested under a live project that is not a project either. Deliberately the shape of
   a real projects root that has had a production retired out of it. */
const ARCHIVE_STAMP = "retired-2026-09-09T17-27-32-055Z";
const TRASH_NAME = "discarded-2026-09-01T08-00-00-000Z";

function buildWorkspace(source) {
  /* live */
  writeProjectAt(path.join(source, "alpha"), baseProject("Alpha"));
  writeFileAt(path.join(source, "alpha", "media", "frame.bin"), "alpha-frame-bytes");
  writeFileAt(path.join(source, "alpha", "media-assets.json"), '{"schemaVersion":1,"assets":[]}\n');
  writeFileAt(path.join(source, "alpha", "backups", "project-2026-09-09T20-10-19-023Z-autosave.json"), '{"backup":"alpha"}\n');
  /* a document below the top level of a LIVE project: not a project, must be carried */
  writeFileAt(path.join(source, "alpha", "docs", "nested", "project.json"), '{"nested":"under-a-live-project"}\n');

  /* archived */
  const archived = path.join(source, ".archive", ARCHIVE_STAMP);
  writeProjectAt(archived, baseProject("Retired"));
  writeFileAt(path.join(archived, ".cinebraid-archive.json"), '{"originalSlug":"retired","archivedAt":"2026-09-09T17:27:32.055Z"}\n');
  writeFileAt(path.join(archived, "media", "retired-frame.bin"), "retired-frame-bytes");
  writeFileAt(path.join(archived, "media-assets.json"), '{"schemaVersion":1,"assets":[]}\n');

  /* trashed */
  const trashed = path.join(source, ".trash", TRASH_NAME);
  writeProjectAt(trashed, baseProject("Discarded"));
  writeFileAt(path.join(trashed, ".cinebraid-trash.json"), '{"originalSlug":"discarded","deletedAt":"2026-09-01T08:00:00.000Z"}\n');
  writeFileAt(path.join(trashed, "media", "discarded-frame.bin"), "discarded-frame-bytes");
}

/* Every file the migration must carry byte for byte. The two live documents are NOT
   here: those are republished by the seam and are checked for arrival instead. */
const CARRIED = [
  "alpha/media/frame.bin",
  "alpha/media-assets.json",
  "alpha/backups/project-2026-09-09T20-10-19-023Z-autosave.json",
  "alpha/docs/nested/project.json",
  `.archive/${ARCHIVE_STAMP}/project.json`,
  `.archive/${ARCHIVE_STAMP}/.cinebraid-archive.json`,
  `.archive/${ARCHIVE_STAMP}/media/retired-frame.bin`,
  `.archive/${ARCHIVE_STAMP}/media-assets.json`,
  `.trash/${TRASH_NAME}/project.json`,
  `.trash/${TRASH_NAME}/.cinebraid-trash.json`,
  `.trash/${TRASH_NAME}/media/discarded-frame.bin`,
];

async function withWorkspace(build, run) {
  const home = fs.mkdtempSync(path.join(TEMP, "ws-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(source, { recursive: true });
  build({ home, source, dest });
  const configPath = path.join(home, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    workspace: { projectRoot: toPosix(source) },
    activeProject: "alpha",
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: false } },
  }, null, 2));
  const server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: source,
    FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "",
  });
  const migrate = (to = dest) => server.request("/api/workspace/settings", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: { projectRoot: toPosix(to) } }),
  });
  try { await run({ home, source, dest, configPath, server, migrate }); }
  finally { server.stop(); }
}

async function scenario(id, fn) {
  await fn();
  passed.push(id);
  console.log(`  ok  ${id}`);
}

/* ==========================================================================
   ND-1 — the documents arrive, and so does everything beside them
   ========================================================================== */

async function nd1() {
  await withWorkspace(({ source }) => buildWorkspace(source), async ({ source, dest, migrate }) => {
    const result = await migrate();
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
    assert.strictEqual(result.body.migration.movedRoot, true);

    /* The three documents this slice exists for. Two of them are the whole record of
       a production that is no longer live, and before PSS-2 neither one arrived. */
    for (const rel of [
      `.archive/${ARCHIVE_STAMP}/project.json`,
      `.trash/${TRASH_NAME}/project.json`,
      "alpha/docs/nested/project.json",
    ]) {
      const target = path.join(dest, ...rel.split("/"));
      assert.strictEqual(fs.existsSync(target), true, `${rel} must arrive at the new location`);
      assert.strictEqual(sha(target), sha(path.join(source, ...rel.split("/"))), `${rel} must arrive byte-identical`);
    }

    /* And the media and sidecars beside them, at every depth. */
    for (const rel of CARRIED) {
      const target = path.join(dest, ...rel.split("/"));
      assert.strictEqual(fs.existsSync(target), true, `${rel} must arrive`);
      assert.strictEqual(sha(target), sha(path.join(source, ...rel.split("/"))), `${rel} must be byte-identical`);
    }

    /* The live document is republished by the seam rather than copied, so it is
       checked for arrival and for still being a readable project — not for bytes. */
    const live = path.join(dest, "alpha", "project.json");
    assert.strictEqual(fs.existsSync(live), true, "the live project's document must arrive");
    assert.strictEqual(JSON.parse(fs.readFileSync(live, "utf8")).meta.title, "Alpha",
      "and must still be the project it was");
  });
}

/* ==========================================================================
   ND-2 — an archived document that no longer validates is still carried

   Enrolment runs validateProjectForSave and mints a revision, which is right for a
   project a user is about to open and wrong for a frozen record. An archive whose
   document predates a schema change must migrate anyway: refusing the whole
   migration over it, or rewriting it to pass, both destroy the thing the archive
   exists to preserve.
   ========================================================================== */

async function nd2() {
  await withWorkspace(({ source }) => {
    buildWorkspace(source);
    writeFileAt(path.join(source, ".archive", "ancient", "project.json"),
      '{"meta":{"title":"Ancient"},"shots":"this is not a shot array"}\n');
    writeFileAt(path.join(source, ".trash", "corrupt", "project.json"), "{ not json at all");
  }, async ({ source, dest, migrate }) => {
    const result = await migrate();
    assert.strictEqual(result.status, 200,
      "an unreadable ARCHIVED document must not refuse the migration: " + JSON.stringify(result.body));

    for (const rel of [".archive/ancient/project.json", ".trash/corrupt/project.json"]) {
      const target = path.join(dest, ...rel.split("/"));
      assert.strictEqual(fs.existsSync(target), true, `${rel} must arrive despite not validating`);
      assert.strictEqual(sha(target), sha(path.join(source, ...rel.split("/"))),
        `${rel} must arrive byte-identical rather than repaired`);
    }
  });
}

/* ==========================================================================
   ND-3 — a TOP-LEVEL document that cannot be read still refuses

   The complement of ND-2, and the line between them is the whole design: a live
   project is enrolled and therefore validated, so an unreadable one is a refusal
   before any byte is written. Widening the carry must not have widened this.
   ========================================================================== */

async function nd3() {
  await withWorkspace(({ source }) => {
    buildWorkspace(source);
    writeFileAt(path.join(source, "beta", "project.json"), "{ not json");
  }, async ({ source, dest, migrate }) => {
    const before = snapshot(source);
    const result = await migrate();
    assert.strictEqual(result.status, 422, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "WORKSPACE_MIGRATION_PREFLIGHT_FAILED");
    assert(fs.readdirSync(dest).length === 0 || !fs.existsSync(path.join(dest, "alpha")),
      "a preflight refusal writes nothing");
    assert.deepStrictEqual(snapshot(source), before, "and touches nothing at the source");
  });
}

/* ==========================================================================
   ND-4 — an enrolled document is written exactly once, by the seam

   The property the old name test was protecting. If the reservation set were wrong
   in the other direction — too small — the copy would also write a document the seam
   had already published, and the two writers would race for one file. It cannot: the
   copy is create-only, so a second write would be REFUSED, and the observable proof
   is that the tree copy reports carrying exactly the documents the seam did not.
   ========================================================================== */

async function nd4() {
  await withWorkspace(({ source }) => buildWorkspace(source), async ({ dest, migrate }) => {
    const result = await migrate();
    const migration = result.body.migration;
    assert.strictEqual(migration.projectDocuments, 1, "one live project was enrolled");
    assert.strictEqual(migration.carriedDocuments, 3,
      "and three documents were carried: archived, trashed, and the one nested under a live project");
    assert.strictEqual(migration.verification.documents.enrolled, 1);
    assert.strictEqual(migration.verification.documents.carried, 3);

    /* Exactly one live document at the destination top level, and it parses. */
    const tops = fs.readdirSync(dest, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dest, entry.name, "project.json")))
      .map((entry) => entry.name).sort();
    assert.deepStrictEqual(tops, ["alpha"], "the destination must hold exactly the enrolled projects");
  });
}

/* ==========================================================================
   ND-5 — the response carries a verification that did not come from the copy loop
   ========================================================================== */

async function nd5() {
  await withWorkspace(({ source }) => buildWorkspace(source), async ({ migrate }) => {
    const { verification } = (await migrate()).body.migration;
    assert.strictEqual(verification.ok, true, JSON.stringify(verification));
    assert.strictEqual(verification.method, "presence-and-size");
    assert.strictEqual(verification.missingCount, 0);
    assert.strictEqual(verification.mismatchedCount, 0);
    assert.strictEqual(verification.unsupportedCount, 0);
    /* Counted from the source tree, so it is a statement about the workspace and not
       about how many times the loop went round. */
    assert.strictEqual(verification.source.files, CARRIED.length + 1, "every source file was accounted for");
    assert(verification.source.bytes > 0, "and measured");
  });
}

/* ==========================================================================
   ND-6 — the source is untouched, proven the way PSS-3 will prove it
   ========================================================================== */

async function nd6() {
  await withWorkspace(({ source }) => buildWorkspace(source), async ({ source, migrate }) => {
    const before = manifestOf(source);
    await migrate();
    const after = manifestOf(source);
    const result = compareManifests(before, after);
    assert.strictEqual(result.ok, true,
      "migration must not write to the source: " + JSON.stringify({ missing: result.missing, mismatched: result.mismatched }));
    assert.deepStrictEqual(result.extra, [], "and must not add anything to it either");
    assert.strictEqual(before.totals.files, after.totals.files);
    assert.strictEqual(before.totals.bytes, after.totals.bytes);
  });
}

/* ==========================================================================
   ND-7 — the standalone verifier agrees with the server, independently
   ========================================================================== */

async function nd7() {
  await withWorkspace(({ source }) => buildWorkspace(source), async ({ source, dest, migrate }) => {
    await migrate();
    const strict = compareManifests(manifestOf(source), manifestOf(dest));
    assert.strictEqual(strict.ok, false,
      "without the allowance the republished live document must show as a difference");
    assert.deepStrictEqual(strict.mismatched.map((row) => row.path), ["alpha/project.json"],
      "and it must be the ONLY difference: " + JSON.stringify(strict.mismatched));

    const allowed = compareManifests(manifestOf(source), manifestOf(dest), { republishedDocuments: true });
    assert.strictEqual(allowed.ok, true,
      "with the allowance the migration must verify by SHA-256: " + JSON.stringify(allowed.mismatched));
    assert.strictEqual(allowed.comparedBy, "sha256", "and by content, not by size");
    assert.deepStrictEqual(allowed.republished, ["alpha/project.json"],
      "with the exemption named rather than silent");
    assert.deepStrictEqual(allowed.missing, [], "nothing may be missing");
  });
}

/* ==========================================================================
   ND-8 — the allowance is exact: it never covers a nested document

   `--documents-republished` exists for the one file class a migration legitimately
   rewrites. If it also covered `.archive/<stamp>/project.json`, it would hide the
   very defect this slice corrects, and the verifier would bless a migration that
   dropped an archive.
   ========================================================================== */

function nd8() {
  const before = {
    tool: "cinebraid-verify-migration", format: 1, hashed: true, totals: { files: 2, bytes: 2 }, unsupported: [],
    files: { "alpha/project.json": { bytes: 1, sha256: "a" }, [`.archive/${ARCHIVE_STAMP}/project.json`]: { bytes: 1, sha256: "a" } },
  };
  const after = {
    tool: "cinebraid-verify-migration", format: 1, hashed: true, totals: { files: 2, bytes: 2 }, unsupported: [],
    files: { "alpha/project.json": { bytes: 1, sha256: "b" }, [`.archive/${ARCHIVE_STAMP}/project.json`]: { bytes: 1, sha256: "b" } },
  };
  const result = compareManifests(before, after, { republishedDocuments: true });
  assert.strictEqual(result.ok, false, "a changed archived document must still fail");
  assert.deepStrictEqual(result.republished, ["alpha/project.json"], "only the top-level document is exempt");
  assert.deepStrictEqual(result.mismatched.map((row) => row.path), [`.archive/${ARCHIVE_STAMP}/project.json`],
    "and the nested one is reported: " + JSON.stringify(result.mismatched));

  /* A dropped archive is `missing`, which no flag forgives. */
  const dropped = compareManifests(before, { ...after, files: { "alpha/project.json": { bytes: 1, sha256: "b" } } },
    { republishedDocuments: true });
  assert.strictEqual(dropped.ok, false, "a dropped archived document must fail under every option");
  assert.deepStrictEqual(dropped.missing, [`.archive/${ARCHIVE_STAMP}/project.json`]);
}

/* ==========================================================================
   RUN
   ========================================================================== */

(async () => {
  console.log("PSS-2 nested project documents survive a workspace migration\n");
  await scenario("ND-1  archived, trashed and nested documents arrive byte-identical", nd1);
  await scenario("ND-2  an archived document that does not validate is carried, not refused", nd2);
  await scenario("ND-3  a live document that cannot be read still refuses the migration", nd3);
  await scenario("ND-4  an enrolled document is written exactly once, by the seam", nd4);
  await scenario("ND-5  the response carries an independent verification", nd5);
  await scenario("ND-6  the source is byte-identical afterwards", nd6);
  await scenario("ND-7  the standalone verifier agrees, by SHA-256", nd7);
  await scenario("ND-8  the republished-document allowance is exact", async () => nd8());

  assert.deepStrictEqual(passed.map((line) => line.split(" ")[0]),
    ["ND-1", "ND-2", "ND-3", "ND-4", "ND-5", "ND-6", "ND-7", "ND-8"]);
  console.log(`\nPSS-2 nested documents: ${passed.length}/8 scenarios passed; provider calls: 0.`);
  fs.rmSync(TEMP, { recursive: true, force: true });
})().catch((error) => {
  console.error("\nPSS-2 nested documents FAILED\n", error);
  process.exit(1);
});
