/* Negative controls for P4-SEM-C2 media disposition semantics.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * below reintroduces exactly ONE of the defects this batch removes — the selector
 * subtracting approved media again, approved media returned but indistinguishable
 * from a candidate, the rename repair going back to missing coverage slots,
 * identity being ignored in favour of string matching, the stamper accepting a
 * value that is not an identity, a render writing identity into a project that was
 * only opened, and the projection answering for a file that no longer exists — and
 * asserts that the guarding suite FAILS.
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Node modules are
 *   patched by compiling a modified copy IN MEMORY; the shipped browser scripts are
 *   patched through the render harness's `mutateSource` hook, which mutates the
 *   string it is about to evaluate and never the file. A broad `git checkout` can
 *   therefore never be the thing that undoes a control.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt:
 *   each anchor must exist, must be unique, and must actually change the source,
 *   and the DEFECT ITSELF must be observed through a behavioural probe before the
 *   guarded suite's failure is allowed to count as detection.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE: the render harness stubs fetch, and the
 * ledger work runs against a temporary projects root with no credentials.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
/* Normalised to LF before matching. Anchors span lines, and on a Windows checkout
   with core.autocrlf on they would arrive as \r\n — the anchor would not match, the
   control would report itself as stale, and the failure would look like a source
   change rather than a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* Everything a patch may invalidate, including the positive suite itself: it
   captures its module references at require time, so a stale copy would exercise
   the real code and the control would report a false pass. */
const IN_SCOPE = [
  path.join(PUBLIC, "shared-media-disposition.js"),
  path.join(ROOT, "media-asset-service.js"),
  path.join(__dirname, "media-disposition-semantics.js"),
];
const inScope = (key) => IN_SCOPE.includes(key);

function applyEdits(label, original, edits) {
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${label}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${label}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${label}; the control would test the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${label} was not modified at all`);
  return code;
}

function evict() {
  for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
}

/* Compile a modified copy of a Node module IN MEMORY, install it in the cache, run,
   restore. Every in-scope module is evicted first so the positive suite resolves to
   the patched copy rather than the one it captured at require time. */
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

/* The same edits, applied to the shipped browser scripts as the render harness
   evaluates them. `applied` is the receipt that the file was actually reached — a
   typo in a filename would otherwise mutate nothing and look like a pass. */
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
  delete require.cache[path.join(__dirname, "media-disposition-semantics.js")];
  return require("./media-disposition-semantics");
}

/* Did the guarded phase actually fail? An assertion failure is detection; any other
   error is the control breaking, and is reported as such. */
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

/* Render the Choose & approve surface with a mutated script and report what the
   creator would actually be able to see. */
async function renderedSelector(suite, mutate, { withIdentity = false } = {}) {
  const vm = require("vm");
  const { render, buildFixture } = require("./render-harness");
  const project = buildFixture();
  const location = project.locations.find((row) => row.id === "LOC-HULL") || project.locations[0];
  Object.assign(location, suite.rooftops({ id: location.id, prefix: location.prefix || location.id }));
  /* `withIdentity` mirrors the post-C1 project the compatibility guard models: the
     ledger knows every file and project.json knows none of them. */
  const plates = suite.ROOFTOP_MEDIA.map((item, index) =>
    withIdentity ? { ...item, assetId: `asset-${String(index).repeat(32).slice(0, 32)}` } : { ...item });
  const rendered = await render(`#/location/${location.id}`, project, {
    mutateSource: mutate,
    scan: { anchors: [], props: [], vehicles: [], audio: [], media: [], shots: {}, plates },
    storage: { [`cinebraid-focused:fixture:entity-task:locations:${location.id}`]: "review" },
  });
  const html = rendered.context.document.getElementById("main").innerHTML;
  return { html, vm, rendered };
}

async function main() {
  /* ---------------------------------------------------------------- NC-A
     The exact Dogfood Pass #1 defect: the selector subtracts approved media, so
     the approved authority leaves the screen entirely. */
  await control({
    id: "NC-A",
    defect: "the Choose & approve selector drops approved media, as it did before C2",
    mutatesBrowser: {
      "entities.js": [[
        `  const disposition=partitionEntityMedia(it,media,{states}), approvedMedia=disposition.approved;`,
        `  const disposition=partitionEntityMedia(it,media,{states}), approvedMedia=[];`,
      ]],
    },
    probe: async (suite, mutate) => {
      const { html } = await renderedSelector(suite, mutate);
      assert(!html.includes("entity-approved-authority"),
        "NC-A probe: the approved-authority section was expected to disappear");
      /* The header still prints the approved filename, which is exactly why the
         dogfood symptom was confusing: the name is visible somewhere on the page
         while the IMAGE is unreachable. The card is the thing that has to go. */
      assert(!html.includes(`data-candidate-file="LOC-HULL-A.png"`),
        "NC-A probe: and no card for the approved image remains — this is the state the dogfood reported");
      assert(html.includes(`data-candidate-file="LOC-HULL-C.png"`),
        "NC-A probe: while the undecided candidates are still listed, so only the approval was lost");
    },
    guard: (suite, mutate) => suite.surfacesSection({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-B
     Approved media is shown, but indistinguishable from a candidate. The creator
     can reach the image and cannot tell it is canon, which is the half of the
     dogfood finding that §7.1 reported separately. */
  await control({
    id: "NC-B",
    defect: "approved media is listed but carries no semantic marker distinguishing it from a candidate",
    mutatesBrowser: {
      "entities.js": [[
        ` data-media-role="\${attr(disposition?.role || (rejected ? "rejected" : "candidate"))}"`,
        ` data-media-role="candidate"`,
      ]],
    },
    probe: async (suite, mutate) => {
      const { html } = await renderedSelector(suite, mutate);
      assert(html.includes("LOC-HULL-A.png"), "NC-B probe: the image is still present");
      assert(!html.includes(`data-media-role="approved"`),
        "NC-B probe: but nothing on the surface says which item is the approved authority");
    },
    guard: (suite, mutate) => suite.surfacesSection({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-C
     The rename repair goes back to enumerating the edges it happens to remember,
     and misses coverage slots — the live pre-C2 defect. */
  await control({
    id: "NC-C",
    defect: "the approval rename repairs states and the candidate row but not coverage slots",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `    for (const edge of approvalEdges(it, { states: change.states })) {
      if (edge.file !== from) continue;`,
        `    for (const edge of approvalEdges(it, { states: change.states })) {
      if (edge.file !== from || edge.kind === "coverage" || edge.kind === "expression") continue;`,
      ]],
    },
    probe: () => {
      const D = require("../public/shared-media-disposition");
      const entity = {
        id: "LOC", approvedFile: "A.png",
        continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "A.png" }],
        coverageSlots: [{ id: "establishing", label: "Master", approvedFile: "A.png" }],
      };
      D.repairApprovalIdentity(entity, { from: "A.png", to: "B.png", assetId: "asset-" + "a".repeat(32) });
      assert.strictEqual(entity.continuityStates[0].approvedFile, "B.png", "NC-C probe: the state still moves");
      assert.strictEqual(entity.coverageSlots[0].approvedFile, "A.png",
        "NC-C probe: while the coverage slot is left pointing at a filename that no longer exists");
    },
    guard: (suite) => suite.repairSection(),
  });

  /* ---------------------------------------------------------------- NC-D
     Identity is recorded but never consulted, so resolution is string matching
     again and a renamed approval resolves to nothing. This is C2 reduced to a
     no-op while still looking implemented. */
  await control({
    id: "NC-D",
    defect: "approval resolution ignores durable identity and matches filenames only",
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
    probe: () => {
      const D = require("../public/shared-media-disposition");
      const id = "asset-" + "a".repeat(32);
      assert.strictEqual(D.resolveApprovalMedia({ file: "OLD.png", assetId: id }, [{ name: "NEW.png", assetId: id }]), null,
        "NC-D probe: an approval whose file was renamed now resolves to nothing, even though the identity matches");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-E
     The stamper stores whatever it is handed. A record then carries a malformed
     identity that resolves to nothing while looking authoritative — strictly worse
     than carrying none, because the filename fallback is skipped. */
  await control({
    id: "NC-E",
    defect: "a value that is not a ledger identity is stored as one",
    mutatesModule: {
      file: "public/shared-media-disposition.js",
      edits: [[
        `  function stampApprovalIdentity(record, assetId) {
    if (!record || typeof record !== "object") return "";
    if (!isLedgerAssetId(assetId)) return "";`,
        `  function stampApprovalIdentity(record, assetId) {
    if (!record || typeof record !== "object") return "";
    if (!assetId) return "";`,
      ]],
    },
    probe: () => {
      const D = require("../public/shared-media-disposition");
      const slot = {};
      assert.strictEqual(D.stampApprovalIdentity(slot, "A-FILENAME.png"), "A-FILENAME.png",
        "NC-E probe: a filename is now accepted as an identity");
      assert.strictEqual(slot.approvedAssetId, "A-FILENAME.png", "NC-E probe: and written into the record");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-F
     A read mutates. The partition stamps identity onto the edges it resolves, so
     merely opening a legacy project canonicalises it — the INV-R1-shaped rule that
     every shared contract in this repository holds. */
  await control({
    id: "NC-F",
    defect: "rendering a project writes durable identity into it",
    /* Browser-side, because the claim is about the RENDERED application: the guard
       runs through the render harness, which evaluates the shipped script from
       disk, so a Node module patch would leave the guarded path untouched and the
       control would report a false pass. */
    mutatesBrowser: {
      "shared-media-disposition.js": [[
        `      const disposition = mediaDisposition(it, name, { edges });
      const row = { item, name, ...disposition };`,
        `      const disposition = mediaDisposition(it, name, { edges });
      for (const target of disposition.targets) if (dispositionRecord(item).assetId) target.record[APPROVED_ASSET_ID_FIELD] = dispositionRecord(item).assetId;
      const row = { item, name, ...disposition };`,
      ]],
    },
    probe: async (suite, mutate) => {
      const vm = require("vm");
      const { rendered } = await renderedSelector(suite, mutate, { withIdentity: true });
      const after = vm.runInContext(`JSON.stringify(P.locations.find((row) => row.id === "LOC-HULL"))`, rendered.context);
      assert(after.includes("approvedAssetId"),
        "NC-F probe: merely rendering the page has written durable identity into the project document");
    },
    guard: (suite, mutate) => suite.compatibilitySection({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-G
     The identity projection answers for a row whose file has gone. A retained
     identity then shadows whatever live file now occupies that path, which is the
     false-linkage class C1 fixed twice before activation was allowed. */
  await control({
    id: "NC-G",
    defect: "the identity projection answers for a file that is no longer on disk",
    mutatesModule: {
      file: "media-asset-service.js",
      edits: [[
        `      if (!storagePath || asset.storage.missing === true) continue;`,
        `      if (!storagePath) continue;`,
      ]],
    },
    probe: () => {
      const os = require("os");
      const Service = require("../media-asset-service");
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-c2-nc-"));
      try {
        fs.mkdirSync(path.join(root, "proj"), { recursive: true });
        fs.writeFileSync(path.join(root, "proj", "media-assets.json"), JSON.stringify({
          schemaVersion: 1,
          assets: [{ assetId: "asset-" + "b".repeat(32), storage: { path: "plates/GONE.png", bytes: 4, mtimeMs: 1, missing: true } }],
        }));
        assert(Service.identityIndex({ projectsRoot: root, slug: "proj" }).has("plates/GONE.png"),
          "NC-G probe: a missing row now answers for its old path");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    guard: (suite) => suite.projectionSection(),
  });

  console.log("P4-SEM-C2 negative controls");
  for (const row of results) console.log(`  ${row.id} · ${row.defect}\n        detected: ${row.detected}`);
  assert.strictEqual(results.length, 7, "every declared control must have produced a receipt");
  console.log(`P4-SEM-C2 negative controls passed — ${results.length}/7 reintroduced defects were detected by the guarding suite.`);
}

module.exports = { main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
