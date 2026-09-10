/* Negative controls for P4-SEM-C4 job media identity.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * reintroduces exactly ONE defect this batch removes — the rename repairing no
 * job record as it did before C4, an output kind dropped from the enumeration,
 * outputs matched by bare filename instead of by path, the live reader ignoring
 * durable identity, a value that is not a ledger id stored as one, the ledger's
 * id written into the key the project media library already owns, the URL left
 * behind when the name moves, and a rename minting a generation ledger for a
 * project that has never generated — and asserts that the guarding suite FAILS.
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Node modules are
 *   patched by compiling a modified copy IN MEMORY; shipped browser scripts are
 *   patched through the render harness's `mutateSource` hook, which mutates the
 *   string it is about to evaluate and never the file.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt:
 *   each anchor must exist, must be unique, and must actually change the source,
 *   and the DEFECT ITSELF must be observed through a behavioural probe before the
 *   guarded suite's failure is allowed to count as detection.
 *
 *   WHY THE SERVER CONTROLS RUN IN PROCESS. The positive suite proves the route
 *   end to end by spawning server.js, but a child process reads the file from
 *   disk and would never see an in-memory patch. registerFalGeneration() returns
 *   the repair, so the writer's own rules are sabotaged and guarded here instead
 *   — the same live function the route calls, not a reimplementation of it.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
/* Normalised to LF before matching: on a Windows checkout with core.autocrlf on,
   a multi-line anchor would arrive as \r\n, fail to match, and report itself as
   stale rather than as a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const IN_SCOPE = [
  path.join(PUBLIC, "shared-media-disposition.js"),
  path.join(ROOT, "src/generation/fal/fal-generation.js"),
  path.join(__dirname, "job-media-identity.js"),
];
const inScope = (key) => IN_SCOPE.includes(key);

function applyEdits(label, original, edits) {
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${label}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${label}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${label}:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${label} was not modified at all`);
  return code;
}

function evict() {
  for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
}

async function patchedModule(relative, edits, run) {
  const file = require.resolve(path.join(ROOT, relative));
  const code = applyEdits(relative, readLF(file), edits);
  const saved = new Map();
  for (const key of Object.keys(require.cache)) if (inScope(key)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const copy = new Module(file, module);
    copy.filename = file;
    copy.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = copy;
    copy._compile(code, file);
    copy.loaded = true;
    return await run();
  } finally {
    evict();
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

function sourceMutator(editsByFile) {
  const applied = new Set();
  const mutate = (file, original) => {
    const edits = editsByFile[file];
    if (!edits) return original;
    applied.add(file);
    return applyEdits(file, original.replace(/\r\n/g, "\n"), edits);
  };
  mutate.applied = applied;
  mutate.expected = Object.keys(editsByFile);
  return mutate;
}

function freshSuite() {
  delete require.cache[path.join(__dirname, "job-media-identity.js")];
  return require("./job-media-identity");
}

async function expectRed(label, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message.split("\n")[0];
    throw new Error(`${label}: the guard threw something that is not an assertion failure, so this is not a valid receipt:\n${error.stack || error.message}`);
  }
  throw new Error(`${label}: the guarded suite PASSED with the defect reintroduced. The regression test does not detect it.`);
}

const results = [];
async function control({ id, defect, mutatesModule, mutatesBrowser, probe, guard }) {
  const mutate = mutatesBrowser ? sourceMutator(mutatesBrowser) : null;
  const body = async () => {
    const suite = freshSuite();
    await probe(suite, mutate);
    const detected = await expectRed(id, () => guard(suite, mutate));
    if (mutate)
      for (const file of mutate.expected)
        assert(mutate.applied.has(file), `${id}: ${file} was never evaluated, so the browser-side defect never ran`);
    results.push({ id, defect, detected });
  };
  if (mutatesModule) await patchedModule(mutatesModule.file, mutatesModule.edits, body);
  else await body();
}

async function main() {
  /* ---------------------------------------------------------------- NC-A
     The pre-C4 behaviour exactly: the approval rename moves the file and the job
     record keeps naming the one that is no longer there. */
  await control({
    id: "NC-A",
    defect: "the approval rename repairs no job record, as it did before C4",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `    for (const edge of jobOutputsForRename(job, change)) {
      edge.record.name = to;`,
        `    for (const edge of jobOutputsForRename(job, change)) {
      if (edge.kind) continue;
      edge.record.name = to;`,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const job = suite.deliveredJob();
      D.repairJobOutputIdentity(job, { dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "APPROVED.png", assetId: suite.ID_A });
      assert.strictEqual(job.outputs[0].name, "TAKE_1.png",
        "NC-A probe: the job record now keeps a filename the approval rename has retired");
      assert.strictEqual("mediaAssetId" in job.outputs[0], false,
        "NC-A probe: and records nothing about which bytes it actually delivered");
    },
    guard: (suite) => suite.repairSection(),
  });

  /* ---------------------------------------------------------------- NC-B
     An output kind drops out of the enumeration — the exact shape of the bug C2
     and C3 both closed by enumerating rather than remembering. */
  await control({
    id: "NC-B",
    defect: "blocking outputs are dropped from the job output enumeration",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `    outputs.forEach((output, index) => {
      const record = dispositionRecord(output);`,
        `    outputs.forEach((output, index) => {
      const record = dispositionRecord(output);
      if (record.type === "blocking") return;`,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const job = suite.deliveredJob();
      assert(!D.jobOutputEdges(job).some((edge) => edge.kind === "blocking"),
        "NC-B probe: blocking outputs are no longer enumerated");
      D.repairJobOutputIdentity(job, { dir: "shots/SH-010/blocking", from: "BLOCK_1.png", to: "GUIDE.png", assetId: suite.ID_B });
      assert.strictEqual(job.outputs[2].name, "BLOCK_1.png",
        "NC-B probe: so renaming a blocking guide silently leaves the job record broken");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-C
     Matched by bare filename instead of by path. This is C1's false-linkage
     class: two shots holding same-named takes, and one shot's rename reaching
     into the other's record. The most dangerous defect in this batch, because it
     writes a WRONG identity rather than merely failing to write one. */
  await control({
    id: "NC-C",
    defect: "job outputs are matched by bare filename instead of by path",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `    return jobOutputEdges(job).filter((edge) => (assetId && edge.assetId === assetId) || edge.path === target);`,
        `    return jobOutputEdges(job).filter((edge) => (assetId && edge.assetId === assetId) || edge.file === from);`,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const job = suite.deliveredJob();
      D.repairJobOutputIdentity(job, { dir: "shots/SH-020/takes", from: "TAKE_1.png", to: "OTHER.png", assetId: suite.ID_B });
      assert.strictEqual(job.outputs[0].name, "OTHER.png",
        "NC-C probe: a rename in ANOTHER shot's takes folder now rewrites this shot's job record");
      assert.strictEqual(job.outputs[0].mediaAssetId, suite.ID_B,
        "NC-C probe: and stamps it with another file's identity — a wrong answer that looks authoritative");
    },
    guard: (suite) => suite.repairSection(),
  });

  /* ---------------------------------------------------------------- NC-D
     Identity is recorded but never consulted by the LIVE reader, so C4's reader
     half is a no-op while still looking implemented. Sabotaged in the browser
     script the page actually evaluates, not in a Node copy of it. */
  await control({
    id: "NC-D",
    defect: "the live job reader ignores durable identity and matches filenames only",
    mutatesBrowser: {
      "shared-media-disposition.js": [[
        `      const id = dispositionText(row.assetId);
      if (id && ids.has(id)) return true;`,
        ``,
      ]],
    },
    probe: async (suite, mutate) => {
      const vm = require("vm");
      const { render, buildFixture } = require("./render-harness");
      const project = buildFixture();
      const shot = project.shots.find((row) => row.id === "L1-01") || project.shots[0];
      const scan = {
        anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
        shots: { [shot.id]: { takes: [{ name: "RENAMED_A.png", url: "/assets/x/RENAMED_A.png", assetId: suite.ID_A }], locked: [], blocking: [] } },
      };
      const rendered = await render(`#/shot/${shot.id}`, project, { mutateSource: mutate, scan });
      const rows = JSON.parse(vm.runInContext(`JSON.stringify((() => {
        const s = P.shots.find((row) => row.id === ${JSON.stringify(shot.id)});
        const job = { id: "j1", outputs: [{ type: "candidate", name: "PRE_RENAME_A.png", url: "/assets/shots/" + s.id + "/takes/PRE_RENAME_A.png", mediaAssetId: ${JSON.stringify(suite.ID_A)} }] };
        return v626FrameRowsFromJob(s.id, (s.keyframes[0] || {}).id || "", job).map((row) => row.name);
      })())`, rendered.context));
      assert.deepStrictEqual(rows, [],
        "NC-D probe: the live reader now loses the take its own job delivered, because the approval rename moved the name");
    },
    guard: (suite, mutate) => suite.readerSection({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-E
     The stamper stores whatever it is handed, so a job output carries a
     malformed identity that resolves to nothing while looking authoritative —
     worse than carrying none, because the filename fallback is then skipped. */
  await control({
    id: "NC-E",
    defect: "a value that is not a ledger identity is stored on a job output",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `  function stampJobOutputIdentity(record, assetId) {
    if (!record || typeof record !== "object") return "";
    if (!isLedgerAssetId(assetId)) return "";`,
        `  function stampJobOutputIdentity(record, assetId) {
    if (!record || typeof record !== "object") return "";
    if (!assetId) return "";`,
      ]],
    },
    probe: () => {
      const D = require("../public/shared-media-disposition");
      const output = { name: "TAKE_1.png" };
      assert.strictEqual(D.stampJobOutputIdentity(output, "TAKE_1.png"), "TAKE_1.png",
        "NC-E probe: a filename is now accepted as an identity");
      assert.strictEqual(output.mediaAssetId, "TAKE_1.png", "NC-E probe: and written into the job record");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-F
     THE NAMING COLLISION, reintroduced. `outputs[].assetId` is already the
     project media LIBRARY row id on every blocking output. Writing the ledger's
     identity into that key destroys a live library link and leaves two different
     kinds of id wearing one name — the collision C2's identity note exists to
     prevent, and the reason C4 spells its field mediaAssetId. */
  await control({
    id: "NC-F",
    defect: "the ledger's identity is written into the key the media library already owns",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `  const JOB_OUTPUT_ASSET_ID_FIELD = "mediaAssetId";`,
        `  const JOB_OUTPUT_ASSET_ID_FIELD = "assetId";`,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const job = suite.deliveredJob();
      assert.strictEqual(job.outputs[2].assetId, suite.LIBRARY_ID, "NC-F probe: precondition — the blocking output links to a library row");
      D.repairJobOutputIdentity(job, { dir: "shots/SH-010/blocking", from: "BLOCK_1.png", to: "GUIDE.png", assetId: suite.ID_B });
      assert.strictEqual(job.outputs[2].assetId, suite.ID_B,
        "NC-F probe: the ledger id has overwritten the media library link, and the row it named is now unreachable");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-G
     The name moves and its URL does not, trading a stale pointer for a broken
     preview. The same class as C3's derived-copy handling of canonicalName. */
  await control({
    id: "NC-G",
    defect: "a repaired job output keeps a URL naming the file it no longer names",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `      const url = dispositionText(edge.record.url);
      const cut = url.lastIndexOf("/");
      if (cut >= 0) edge.record.url = \`\${url.slice(0, cut + 1)}\${to}\`;`,
        ``,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const job = suite.deliveredJob();
      D.repairJobOutputIdentity(job, { dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "APPROVED.png", assetId: suite.ID_A });
      assert.strictEqual(job.outputs[0].name, "APPROVED.png");
      assert.strictEqual(job.outputs[0].url, "/assets/shots/SH-010/takes/TAKE_1.png",
        "NC-G probe: the record now names one file and previews another, which 404s");
    },
    guard: (suite) => suite.repairSection(),
  });

  /* ---------------------------------------------------------------- NC-H
     The writer opens a commit turn without checking whether a ledger exists.
     `commit` reads a missing ledger as [] and writes it back, so renaming a file
     in a project that has NEVER generated mints a generation history for it. The
     one control that guards the server-side writer's own rule. */
  await control({
    id: "NC-H",
    defect: "renaming a file mints a generation ledger for a project that has never generated",
    mutatesModule: {
      file: "src/generation/fal/fal-generation.js",
      edits: [[
        `      const ledger = readJobLedger(owner.dir);
      if (!ledger.exists) return { repaired: 0, jobs: 0, reason: "no-ledger" };
      if (!ledger.jobs.some((job) => jobOutputsForRename(job, request).length))
        return { repaired: 0, jobs: 0, reason: "no-match" };`,
        ``,
      ]],
    },
    probe: async () => {
      const os = require("os");
      const { registerFalGeneration } = require("../src/generation/fal/fal-generation");
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-c4-nch-"));
      try {
        const dir = path.join(sandbox, "quiet");
        fs.mkdirSync(dir, { recursive: true });
        const api = registerFalGeneration({ get() {}, post() {} }, {
          readConfig: () => ({}), readProject: () => ({}), writeProject: () => {},
          activeSlug: () => "quiet",
          projectDirForSlug: () => ({ dir, file: path.join(dir, "project.json") }),
        });
        await api.repairJobMediaIdentity({ slug: "quiet", dir: "anchors", from: "A.png", to: "B.png" });
        assert(fs.existsSync(path.join(dir, "generation-jobs.json")),
          "NC-H probe: a rename has created a generation ledger for a project that never generated");
      } finally {
        try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
      }
    },
    guard: (suite) => suite.ledgerSection(),
  });

  /* ---------------------------------------------------------------- NC-I
     The writer stops containing its own failures, so an unreadable sidecar turns
     a completed approval into an error the director sees — after the file has
     already moved. anchorBeforeRename refuses this trade for the same reason. */
  await control({
    id: "NC-I",
    defect: "an unreadable generation ledger throws out of the rename the approval depends on",
    mutatesModule: {
      file: "src/generation/fal/fal-generation.js",
      edits: [[
        `    } catch (error) {
      return { repaired: 0, jobs: 0, reason: "failed", error: String(error?.message || error) };
    }
  }`,
        `    } catch (error) {
      throw error;
    }
  }`,
      ]],
    },
    probe: async () => {
      const os = require("os");
      const { registerFalGeneration } = require("../src/generation/fal/fal-generation");
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-c4-nci-"));
      try {
        const dir = path.join(sandbox, "broken");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "generation-jobs.json"), "{ not json");
        const api = registerFalGeneration({ get() {}, post() {} }, {
          readConfig: () => ({}), readProject: () => ({}), writeProject: () => {},
          activeSlug: () => "broken",
          projectDirForSlug: () => ({ dir, file: path.join(dir, "project.json") }),
        });
        let threw = false;
        try {
          await api.repairJobMediaIdentity({ slug: "broken", dir: "shots/SH-010/takes", from: "TAKE_1.png", to: "B.png" });
        } catch { threw = true; }
        assert(threw, "NC-I probe: the repair now throws, so the rename route would answer an error on a move that succeeded");
      } finally {
        try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
      }
    },
    guard: (suite) => suite.ledgerSection(),
  });

  console.log("P4-SEM-C4 negative controls");
  for (const row of results) console.log(`  ${row.id} · ${row.defect}\n        detected: ${row.detected}`);
  assert.strictEqual(results.length, 9, "every declared control must have produced a receipt");
  console.log(`P4-SEM-C4 negative controls passed — ${results.length}/9 reintroduced defects were detected by the guarding suite.`);
}

module.exports = { main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
