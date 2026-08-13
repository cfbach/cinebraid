/* Negative controls for P4-SEM-C3 shot media identity.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * reintroduces exactly ONE defect this batch removes — the rename repairing only
 * the candidate row as it did before C3, an edge kind dropped from the
 * enumeration, identity ignored in favour of string matching, a value that is not
 * a ledger id stored as one, identity surviving the clearing of the edge it
 * identified, a read that writes identity into the document, and a rejected
 * alternate drifting into authority — and asserts that the guarding suite FAILS.
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
  path.join(__dirname, "shot-media-identity.js"),
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
  delete require.cache[path.join(__dirname, "shot-media-identity.js")];
  return require("./shot-media-identity");
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
     The pre-C3 behaviour exactly: the rename touches the candidate row and
     leaves every winner edge naming a file that is no longer on disk. */
  await control({
    id: "NC-A",
    defect: "the shot rename repairs no winner edge, as it did before C3",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `    for (const edge of shotApprovalEdges(s)) {
      if (edge.file !== from) continue;
      edge.record[edge.field] = to;`,
        `    for (const edge of shotApprovalEdges(s)) {
      if (edge.file !== from) continue;
      if (edge.kind) continue;
      edge.record[edge.field] = to;`,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const shot = suite.chimbley();
      D.repairShotApprovalIdentity(shot, { from: "TAKE_A.png", to: "APPROVED_A.png", assetId: suite.ID_A });
      assert.strictEqual(shot.winner, "TAKE_A.png",
        "NC-A probe: the shot winner now keeps a filename the rename has retired");
      assert.strictEqual(shot.keyframes[0].winner, "TAKE_A.png", "NC-A probe: and so does Frame A");
    },
    guard: (suite) => suite.repairSection(),
  });

  /* ---------------------------------------------------------------- NC-B
     An edge kind drops out of the enumeration. This is the exact shape of the
     original bug — a repair that knows about the edges its author remembered. */
  await control({
    id: "NC-B",
    defect: "clip endpoints are dropped from the shot edge enumeration",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `      edges.push(shotEdge("clip-first", record.id || name, name ? \`\${name} first\` : "Clip first", record, "winner"));
      edges.push(shotEdge("clip-last", record.id || name, name ? \`\${name} last\` : "Clip last", record, "winnerEnd"));`,
        ``,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const shot = suite.chimbley();
      assert(!D.shotApprovalEdges(shot).some((e) => e.kind === "clip-first"),
        "NC-B probe: the clip endpoints are no longer enumerated");
      D.repairShotApprovalIdentity(shot, { from: "TAKE_A.png", to: "R.png", assetId: suite.ID_A });
      assert.strictEqual(shot.clips[0].winner, "TAKE_A.png",
        "NC-B probe: so a rename silently leaves the clip's first endpoint broken");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-C
     Identity is recorded but never consulted, so resolution is string matching
     again — C3 reduced to a no-op while still looking implemented. */
  await control({
    id: "NC-C",
    defect: "shot approval resolution ignores durable identity and matches filenames only",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `    if (isLedgerAssetId(target.assetId)) {
      const byIdentity = items.find((item) => dispositionRecord(item).assetId === target.assetId);
      if (byIdentity) return byIdentity;
    }`,
        ``,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      assert.strictEqual(
        D.resolveShotApprovalMedia({ file: "OLD.png", assetId: suite.ID_A }, [{ name: "NEW.png", assetId: suite.ID_A }]),
        null, "NC-C probe: a renamed winner now resolves to nothing even though the identity matches");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-D
     The stamper stores whatever it is handed, so a record carries a malformed
     identity that resolves to nothing while looking authoritative — worse than
     carrying none, because the filename fallback is then skipped. */
  await control({
    id: "NC-D",
    defect: "a value that is not a ledger identity is stored on a shot edge",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `  function stampShotApprovalIdentity(record, field, assetId) {
    if (!record || typeof record !== "object" || !field) return "";
    if (!isLedgerAssetId(assetId)) return "";`,
        `  function stampShotApprovalIdentity(record, field, assetId) {
    if (!record || typeof record !== "object" || !field) return "";
    if (!assetId) return "";`,
      ]],
    },
    probe: () => {
      const D = require("../public/shared-media-disposition");
      const frame = {};
      assert.strictEqual(D.stampShotApprovalIdentity(frame, "winner", "TAKE_A.png"), "TAKE_A.png",
        "NC-D probe: a filename is now accepted as an identity");
      assert.strictEqual(frame.winnerAssetId, "TAKE_A.png", "NC-D probe: and written into the record");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-E
     Identity outlives the edge it identified. A reopened approval then still
     carries an id that can silently re-resolve to the media it was reopened
     away from. */
  await control({
    id: "NC-E",
    defect: "clearing a winner leaves its durable identity behind",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `  function clearShotApprovalIdentity(record, field) {
    if (!record || typeof record !== "object" || !field) return;
    delete record[shotAssetIdField(field)];
  }`,
        `  function clearShotApprovalIdentity(record, field) {
    if (!record || typeof record !== "object" || !field) return;
  }`,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const frame = {};
      D.stampShotApprovalIdentity(frame, "winner", suite.ID_A);
      D.clearShotApprovalIdentity(frame, "winner");
      assert.strictEqual(frame.winnerAssetId, suite.ID_A,
        "NC-E probe: the identity survives the clearing of the edge it identified");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-F
     A read mutates: the partition stamps identity onto the edges it resolves,
     so opening a pre-C3 project canonicalises it. Browser-side, because the
     guard runs through the render harness — a Node module patch would leave the
     guarded path untouched and report a false pass. */
  await control({
    id: "NC-F",
    defect: "rendering a shot writes durable identity into the project",
    /* Mutates public/app.js rather than the shared module, because the resolution
       helper the SHOT RENDER actually calls is winnerEdgeName() — caching the
       resolved identity back onto the record is the plausible mistake, and it is
       on the render path where the guard can see it. */
    mutatesBrowser: {
      "app.js": [[
        `  const resolved = typeof resolveApprovalMedia === "function"
    ? resolveApprovalMedia({ file, assetId: assetId || "" }, takes || [])
    : null;
  return resolved ? resolved.name : file;`,
        `  const resolved = typeof resolveApprovalMedia === "function"
    ? resolveApprovalMedia({ file, assetId: assetId || "" }, takes || [])
    : null;
  if (resolved && resolved.assetId && typeof shotAssetIdField === "function") record[shotAssetIdField(field)] = resolved.assetId;
  return resolved ? resolved.name : file;`,
      ]],
    },
    probe: async (suite, mutate) => {
      const vm = require("vm");
      const { render, buildFixture } = require("./render-harness");
      const project = buildFixture();
      const shot = project.shots.find((r) => r.id === "L1-01") || project.shots[0];
      const scan = { anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
        shots: { [shot.id]: { takes: [{ name: "FRAME_A.png", url: "/a", assetId: suite.ID_A }], locked: [], blocking: [] } } };
      const r = await render(`#/shot/${shot.id}`, project, { mutateSource: mutate, scan });
      const after = vm.runInContext(`(() => { const s = P.shots.find((x) => x.id === ${JSON.stringify(shot.id)});
        takeBadges(s, "FRAME_A.png"); return JSON.stringify(s); })()`, r.context);
      assert(after.includes("winnerAssetId"),
        "NC-F probe: merely reading a badge has written durable identity into the shot document");
    },
    guard: (suite, mutate) => suite.compatibilitySection({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-G
     A rejected alternate outranks a live approval, so an image the creator said
     no to reads as authority. The precedence C2 froze, inverted. */
  await control({
    id: "NC-G",
    defect: "a stale rejection outranks a live approval on the same shot media",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `    const edges = Array.isArray(options.edges) ? options.edges : shotApprovalEdges(s);
    const targets = edges.filter((edge) => edge.file && edge.file === name);
    if (targets.length) {`,
        `    const edges = Array.isArray(options.edges) ? options.edges : shotApprovalEdges(s);
    const targets = edges.filter((edge) => edge.file && edge.file === name);
    const rejectedFirst = shotCandidateRowFor(s, name);
    if (targets.length && dispositionText(dispositionRecord(rejectedFirst).decision) !== REJECTED_DECISION) {`,
      ]],
    },
    probe: (suite) => {
      const D = require("../public/shared-media-disposition");
      const shot = suite.chimbley();
      shot.candidateFiles.push({ stored: "TAKE_A.png", decision: "rejected" });
      assert.strictEqual(D.shotMediaDisposition(shot, "TAKE_A.png").role, "rejected",
        "NC-G probe: the approved shot image now reads as a rejected alternate");
    },
    guard: (suite) => suite.contractSection(),
  });

  console.log("P4-SEM-C3 negative controls");
  for (const row of results) console.log(`  ${row.id} · ${row.defect}\n        detected: ${row.detected}`);
  assert.strictEqual(results.length, 7, "every declared control must have produced a receipt");
  console.log(`P4-SEM-C3 negative controls passed — ${results.length}/7 reintroduced defects were detected by the guarding suite.`);
}

module.exports = { main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
