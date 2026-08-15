/* NEGATIVE CONTROLS FOR CINEBRAID PRODUCTION TRUTH.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE FEWER OF THEM THAN THERE WERE.
 *
 * Batch 1D shipped twenty-seven controls and still failed acceptance, because
 * most of them guarded a mechanism the audit walked around rather than through:
 * a control proving a BOUND capability rejects changed bytes says nothing when
 * every shipped call site mints an UNBOUND one; a control proving a per-request
 * policy field is inert says nothing when the policy is an exported installer.
 *
 * The simplification deleted those mechanisms, and a control per deleted
 * mechanism is a control for nothing. What is left is the small set of places
 * where production truth is actually decided, and each one is broken here in
 * memory and watched to fail.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT. A control is a PROBE, not a throw.
 *
 * `probe(module)` returns `{ reached, held, reason }`:
 *
 *     reached   execution got to the checkpoint. A probe that fell over on the
 *               way there proves nothing, and says so.
 *     held      the invariant is intact under this module.
 *
 * The control runs that probe TWICE — against the real module and against the
 * mutated one — and passes only when all seven conditions hold:
 *
 *   1. baseline runs OUTSIDE any catch-as-success region       (`baseline()`)
 *   2. the mutation is confirmed to have changed the source     (`mutate()` counts)
 *   3. the probe reaches its checkpoint under BOTH modules      (`reached`)
 *   4. the invariant FAILS under the mutated module             (`held === false`)
 *   5. the failure is the named one                             (`reason`)
 *   6. an unrelated throw fails the suite loudly                (no catch-as-success)
 *   7. the invariant HOLDS under the real module                (`held === true`)
 *
 * There is no `catch (AssertionError) => pass` anywhere in this file, and a
 * test at the bottom asserts that there is not.
 *
 * IN MEMORY, ALWAYS. Nothing in the working tree is modified, so no control can
 * be "restored" by a checkout that also discards real work.
 *
 * NO PROJECT DATA IS TOUCHED, AND NO PROVIDER OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const source = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

let controls = 0;
const notes = [];

/* THE PROBE RECEIPT. A plain Error, never an assertion: a control whose anchor
   has moved must fail the suite loudly rather than be mistaken for a firing. */
function mutate(text, needle, replacement, label, expected = 1) {
  const hits = text.split(needle).length - 1;
  if (hits !== expected) {
    throw new Error(`probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.");
  }
  return text.split(needle).join(replacement);
}

/* Rebuild one module from (possibly mutated) source, in its own realm. */
function build(relPath, text) {
  const moduleObject = { exports: {} };
  const sandboxRequire = (specifier) => require(specifier.startsWith(".") ? path.join(ROOT, path.dirname(relPath), specifier) : specifier);
  vm.runInNewContext(text ?? source(relPath), { module: moduleObject, exports: moduleObject.exports, require: sandboxRequire, console, structuredClone }, { filename: relPath });
  return moduleObject.exports;
}

function applyMutations(spec) {
  const rows = spec.mutations || [[spec.anchor, spec.replacement, spec.occurrences === undefined ? 1 : spec.occurrences]];
  let text = source(spec.file);
  rows.forEach(([anchor, replacement, occurrences], index) => {
    text = mutate(text, anchor, replacement, `${spec.label}#${index + 1}`, occurrences === undefined ? 1 : occurrences);
  });
  return text;
}

/* THE CONTROL. Every condition above, in order, with nothing swallowed. */
function control(spec) {
  const { label, file, baseline, probe, reason, explain } = spec;
  controls += 1;
  if (typeof baseline === "function") baseline(build(file));
  const real = probe(build(file));
  assert.ok(real && real.reached === true,
    `${label}: the probe did not reach its checkpoint against the REAL module, so it proves nothing about the mutated one`);
  assert.strictEqual(real.held, true,
    `${label}: the invariant does not hold in the shipped implementation, so this control is describing a property that does not exist`);
  const broken = build(file, applyMutations(spec));
  const after = probe(broken);
  assert.ok(after && after.reached === true,
    `${label}: the probe did not reach its checkpoint against the MUTATED module — the break stopped execution instead of changing behaviour`);
  assert.strictEqual(after.held, false, `${label}: the invariant SURVIVED the break. ${explain}`);
  if (reason !== undefined) {
    assert.strictEqual(after.reason, reason,
      `${label}: the invariant failed, but not in the way this control describes (expected ${JSON.stringify(reason)}, got ${JSON.stringify(after.reason)})`);
  }
  notes.push(`  ${label} — held under the real module, failed as ${JSON.stringify(after.reason)} under the mutation`);
}

/* An async twin for a control whose boundary is a rendered page. Same contract. */
const pending = [];
function controlAsync(spec) {
  const { label, baseline, probe, reason, explain } = spec;
  controls += 1;
  pending.push((async () => {
    if (typeof baseline === "function") await baseline(null);
    const real = await probe(null);
    assert.ok(real && real.reached === true, `${label}: the probe did not reach its checkpoint against the REAL page`);
    assert.strictEqual(real.held, true, `${label}: the invariant does not hold in the shipped page`);
    const after = await probe(spec.mutateSource);
    assert.ok(after && after.reached === true, `${label}: the probe did not reach its checkpoint against the MUTATED page`);
    assert.strictEqual(after.held, false, `${label}: the invariant SURVIVED the break. ${explain}`);
    if (reason !== undefined) assert.strictEqual(after.reason, reason, `${label}: failed for the wrong reason (expected ${JSON.stringify(reason)}, got ${JSON.stringify(after.reason)})`);
    notes.push(`  ${label} — held under the real page, failed as ${JSON.stringify(after.reason)} under the mutation`);
  })());
}

/* ---------------------------------------------------------------------------
   Shared fixtures. */

const KERNEL_FILE = "public/shared-authority-kernel.js";
const AT = "2026-08-14T00:00:00.000Z";

const shotProject = () => ({
  shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }], clips: [], creationBrief: {} }],
});
const contestedProject = () => ({
  characters: [
    { id: "CHAR-A", prefix: "CHAR-A", candidateFiles: [{ stored: "SHARED.png" }], continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }] },
    { id: "CHAR-B", prefix: "CHAR-B", candidateFiles: [{ stored: "SHARED.png" }], continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }] },
  ],
});

/* Each control gets its OWN kernel realm, so it gets its own gesture source and
   its own trusted-event target. `harness(kernel)` returns the way to deliver a
   trusted event to that realm, which is the only way canon can be written in
   it — exactly the compositional boundary the product relies on. */
const { installTestManualActionSource } = require("./authority-test-gesture.js");
const harness = (kernel) => installTestManualActionSource(kernel);

/* ===========================================================================
   C1 — THE HUMAN IS REQUIRED.

   Delete the gesture check and automation writes canon. This is the boundary
   every other one stands on: if it does not hold, nothing below matters. */
control({
  label: "C1 the trusted-gesture requirement",
  file: KERNEL_FILE,
  anchor: "  const gesture = requireTrustedGesture(what);",
  replacement: "  const gesture = TRUSTED_GESTURE || { id: \"gesture-forged\", kind: \"click\" };",
  baseline: (kernel) => {
    const manual = harness(kernel);
    const project = shotProject();
    manual.gesture(() => kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "OK.png", assetId: "", at: AT }));
    assert.ok(kernel.hasCurrentHumanAuthority(project, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }),
      "baseline: a real human approval must work, or the control measures nothing");
  },
  probe: (kernel) => {
    harness(kernel);
    const project = shotProject();
    /* NO GESTURE IS DELIVERED. This is automation. */
    let wrote = false;
    try { kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "AUTO.png", assetId: "", at: AT }); wrote = true; }
    catch { wrote = false; }
    return { reached: true, held: !wrote, reason: wrote ? "automation-wrote-canon" : "refused" };
  },
  reason: "automation-wrote-canon",
  explain: "Without the gesture check, any code path can establish production truth.",
});

/* ===========================================================================
   C2 — THE ASSET IDENTITY IS REQUIRED BY CONSTRUCTION.

   Batch 1D made it an optional field and all twelve shipped surfaces omitted
   it. Make it optional again and an approval that never states the bytes
   succeeds. */
control({
  label: "C2 the stated-identity requirement",
  file: KERNEL_FILE,
  anchor: "  if (!Object.prototype.hasOwnProperty.call(it, \"assetId\")) {",
  replacement: "  if (false) {",
  baseline: (kernel) => {
    const manual = harness(kernel);
    const project = shotProject();
    manual.gesture(() => kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "OK.png", assetId: "", at: AT }));
    assert.ok(kernel.hasCurrentHumanAuthority(project, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }),
      "baseline: an approval that states \"no identity\" is legitimate and must work");
  },
  probe: (kernel) => {
    const manual = harness(kernel);
    const project = shotProject();
    let wrote = false;
    /* The `assetId` key is ABSENT — the caller never said what bytes these are. */
    try { manual.gesture(() => kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "SILENT.png", at: AT })); wrote = true; }
    catch { wrote = false; }
    return { reached: true, held: !wrote, reason: wrote ? "approved-without-stating-bytes" : "refused" };
  },
  reason: "approved-without-stating-bytes",
  explain: "An optional identity is an identity every caller forgets, which is exactly what Batch 1D shipped.",
});

/* ===========================================================================
   C3 — IDENTITY IS SYMMETRIC.

   Restore Batch 1D's "compare only where both sides carry one" and a receipt
   naming asset-A survives a live edge that has forgotten it. */
control({
  label: "C3 receipt/live identity symmetry",
  file: KERNEL_FILE,
  anchor: "  if (receiptAsset && receiptAsset !== kernelText(live.assetId)) return null;",
  replacement: "  if (receiptAsset && kernelText(live.assetId) && receiptAsset !== kernelText(live.assetId)) return null;",
  baseline: (kernel) => {
    const manual = harness(kernel);
    const project = shotProject();
    manual.gesture(() => kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "asset-A", at: AT }));
    assert.ok(kernel.hasCurrentHumanAuthority(project, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }),
      "baseline: an intact approval must hold");
  },
  probe: (kernel) => {
    const manual = harness(kernel);
    const project = shotProject();
    const target = { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" };
    manual.gesture(() => kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "asset-A", at: AT }));
    if (!kernel.hasCurrentHumanAuthority(project, target)) return { reached: false };
    delete project.shots[0].keyframes[0].winnerAssetId;
    delete project.shots[0].winnerAssetId;
    const survived = kernel.hasCurrentHumanAuthority(project, target);
    return { reached: true, held: !survived, reason: survived ? "identity-rounded-up-by-filename" : "failed-closed" };
  },
  reason: "identity-rounded-up-by-filename",
  explain: "A receipt that names bytes must not be satisfied by an edge that cannot name them.",
});

/* ===========================================================================
   C4 — REVOCATION CLEARS THE TARGET IT NAMES.

   Restore the still-versus-video inference from the new value and a video
   revocation leaves `approvedMotionFile` behind, which is the exact 1D
   counterexample. */
control({
  label: "C4 typed delivery revocation",
  file: KERNEL_FILE,
  /* ONE LINE, BOTH PLACES. `delete s.creationBrief.approvedMotionFile` appears
     twice — once in the typed clear, once when establishing a still — and
     removing both is exactly the Batch 1D shape: nothing clears the video
     pointer, so a revoked video survives its own revocation.
     Breaking BOTH is the only honest form of this control: with either one
     intact the pointer still goes, and the control would pass for a reason it
     is not describing. */
  anchor: "      delete s.creationBrief.approvedMotionFile;",
  replacement: "      /* control: the video pointer is not cleared */",
  occurrences: 2,
  baseline: (kernel) => {
    const manual = harness(kernel);
    const project = shotProject();
    manual.gesture(() => kernel.approveDeliveryCanon(project, { shotId: "SH-01", value: "MOVIE.mp4", assetId: "asset-V", at: AT }));
    assert.strictEqual(project.shots[0].creationBrief.approvedMotionFile, "MOVIE.mp4",
      "baseline: an approved video must be the delivery pointer");
  },
  probe: (kernel) => {
    const manual = harness(kernel);
    const project = shotProject();
    manual.gesture(() => kernel.approveDeliveryCanon(project, { shotId: "SH-01", value: "MOVIE.mp4", assetId: "asset-V", at: AT }));
    if (project.shots[0].creationBrief.approvedMotionFile !== "MOVIE.mp4") return { reached: false };
    kernel.revokeDeliveryCanon(project, { shotId: "SH-01", at: AT, reason: "withdrawn" });
    const left = project.shots[0].creationBrief.approvedMotionFile || "";
    return { reached: true, held: !left, reason: left ? `stale-pointer(${left})` : "cleared" };
  },
  reason: "stale-pointer(MOVIE.mp4)",
  explain: "Deciding which field to clear from the NEW value means every revocation clears the still field, because a revocation has no new value.",
});

/* ===========================================================================
   C5 — OWNERSHIP IS INTRINSIC.

   Make the veto answer yes and a file two references both claim becomes canon
   for one of them. */
control({
  label: "C5 the ownership veto",
  file: KERNEL_FILE,
  anchor: "  const verdict = kernelObject(entityOwnershipVerdict(project, target, value));",
  replacement: "  const verdict = { ok: true };",
  baseline: (kernel) => {
    const manual = harness(kernel);
    const project = contestedProject();
    let refused = false;
    try { manual.gesture(() => kernel.approveEntityStateCanon(project, { list: "characters", entityId: "CHAR-A", stateId: "state-default", value: "SHARED.png", assetId: "", at: AT })); }
    catch (error) { refused = error.code === "AUTHORITY_OWNERSHIP_CONTESTED"; }
    assert.ok(refused, "baseline: a contested file must be refused, or the control measures nothing");
  },
  probe: (kernel) => {
    const manual = harness(kernel);
    const project = contestedProject();
    let wrote = false;
    try { manual.gesture(() => kernel.approveEntityStateCanon(project, { list: "characters", entityId: "CHAR-A", stateId: "state-default", value: "SHARED.png", assetId: "", at: AT })); wrote = true; }
    catch { wrote = false; }
    return { reached: true, held: !wrote, reason: wrote ? "contested-file-became-canon" : "refused" };
  },
  reason: "contested-file-became-canon",
  explain: "A rule the kernel can be talked out of is not a rule.",
});

/* ===========================================================================
   C6 — THE COMMIT IS A TRANSACTION.

   Write the edge to the LIVE project before the ledger, as Batch 1B did, and a
   refused approval leaves a winner with nobody's name on it. */
control({
  label: "C6 the atomic commit",
  file: KERNEL_FILE,
  anchor: "  const gesture = requireTrustedGesture(what);",
  replacement: "  writeAuthorityEdge(project, target, { value, assetId, at: kernelText(it.at) });\n  const gesture = requireTrustedGesture(what);",
  baseline: (kernel) => {
    const project = shotProject();
    harness(kernel);
    let refused = false;
    try { kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "PARTIAL.png", assetId: "", at: AT }); }
    catch { refused = true; }
    assert.ok(refused, "baseline: a gesture-less approval must refuse");
    assert.ok(!project.shots[0].keyframes[0].winner, "baseline: and must leave the project untouched");
  },
  probe: (kernel) => {
    harness(kernel);
    const project = shotProject();
    try { kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "PARTIAL.png", assetId: "", at: AT }); }
    catch { /* the refusal is expected; what matters is what it left behind */ }
    const stranded = project.shots[0].keyframes[0].winner || "";
    return { reached: true, held: !stranded, reason: stranded ? `stranded-edge(${stranded})` : "clean" };
  },
  reason: "stranded-edge(PARTIAL.png)",
  explain: "An edge written before the credential is checked is a winner no receipt describes.",
});

/* ===========================================================================
   C7 — THE LIBRARY DOES NOT COUNT SUPPORTING SELECTIONS AS CANON.

   The 1D counterexample, at the surface that produced it. Count slot files into
   the canon set and an entity with no receipt is badged CANON. */
const { render, buildFixture } = require("./render-harness");
function referenceOnlyProject() {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-REF";
  character.name = "Reference only";
  character.prefix = "CHAR-REF";
  character.approvedFile = "";
  character.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "" }];
  character.coverageSlots = [{ id: "front", label: "Front", requirement: "required", selectedFile: "CHAR-REF-SIDE.png", status: "selected" }];
  character.expressionSlots = [];
  character.candidateFiles = [{ stored: "CHAR-REF-SIDE.png", decision: "selected-coverage" }];
  project.characters = [character];
  project.shots[0].characters = [character.id];
  return project;
}
const REF_SCAN = { anchors: [{ name: "CHAR-REF-SIDE.png", url: "data:image/svg+xml,%3Csvg/%3E" }], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} };

controlAsync({
  label: "C7 the Library's canon count",
  mutateSource: (file, text) => (file !== "app.js" ? text : mutate(
    text,
    "  const references = new Set(truth.references.map((row) => row.value).filter(Boolean));",
    "  const references = new Set(truth.references.map((row) => row.value).filter(Boolean));\n  for (const row of truth.references) canon.add(row.value);",
    "C7 library canon count",
  )),
  baseline: async () => {
    const rendered = await render("#/library/all", referenceOnlyProject(), { scan: REF_SCAN });
    assert.ok(/library-status reference/.test(rendered.html),
      "baseline: an entity with only a supporting selection must read as REFERENCES");
  },
  probe: async (mutateSource) => {
    const rendered = await render("#/library/canon", referenceOnlyProject(), { scan: REF_SCAN, ...(mutateSource ? { mutateSource } : {}) });
    const badged = /library-card canon/.test(rendered.html);
    return { reached: true, held: !badged, reason: badged ? "supporting-selection-badged-canon" : "excluded" };
  },
  reason: "supporting-selection-badged-canon",
  explain: "Merging references into the canon set is precisely the defect the Dogfood #2 audit reproduced under the Approved tab.",
});

/* ===========================================================================
   C8 — COVERAGE AUTOMATION'S IDENTITY INPUT IS RECEIPT-BACKED.

   Read the raw pointer instead of the projection and an unreceipted LEGACY.png
   is dispatched as this entity's identity. */
controlAsync({
  label: "C8 coverage identity input",
  mutateSource: (file, text) => (file !== "coverage-automation.js" ? text : mutate(
    text,
    "    const row = canonPrimaryRow(list, entity);\n    if (!row) return null;",
    "    const row = canonPrimaryRow(list, entity) || (entity && entity.approvedFile ? { value: entity.approvedFile, assetId: \"\" } : null);\n    if (!row) return null;",
    "C8 coverage identity input",
  )),
  baseline: async () => {
    const project = referenceOnlyProject();
    project.characters[0].approvedFile = "CHAR-REF-SIDE.png";
    project.characters[0].continuityStates[0].approvedFile = "CHAR-REF-SIDE.png";
    const rendered = await render("#/character/CHAR-REF", project, { scan: REF_SCAN });
    const primary = vm.runInContext("window.__CINEBRAID_COVERAGE_AUTOMATION.primaryReference('characters', P.characters[0])", rendered.context);
    assert.strictEqual(primary, null, "baseline: an unreceipted pointer must not be the identity input");
  },
  probe: async (mutateSource) => {
    const project = referenceOnlyProject();
    project.characters[0].approvedFile = "CHAR-REF-SIDE.png";
    project.characters[0].continuityStates[0].approvedFile = "CHAR-REF-SIDE.png";
    const rendered = await render("#/character/CHAR-REF", project, { scan: REF_SCAN, ...(mutateSource ? { mutateSource } : {}) });
    const primary = vm.runInContext("window.__CINEBRAID_COVERAGE_AUTOMATION.primaryReference('characters', P.characters[0])", rendered.context);
    const promoted = !!(primary && primary.name);
    return { reached: true, held: !promoted, reason: promoted ? `historic-promoted(${primary.name})` : "historic" };
  },
  reason: "historic-promoted(CHAR-REF-SIDE.png)",
  explain: "A pointer nobody approved is history, and using it as identity authority is the defect Generated Media had already fixed and coverage automation had not.",
});

/* ===========================================================================
   C9 — OPENING A PLANNER READS.

   Put the mutating list builder back into the modal wrapper and merely opening
   the default-reference planner writes continuity structure onto a bare entity. */
controlAsync({
  label: "C9 preflight purity",
  mutateSource: (file, text) => (file !== "automation.js" ? text : mutate(
    text,
    "  const state = entityStateListRead(entity, true).find((item) => item.isDefault);",
    "  const state = ensureEntityStateList(entity, true).find((item) => item.isDefault);",
    "C9 preflight purity",
  )),
  baseline: async () => {
    const rendered = await bareEntityPage(null);
    assert.ok(/CHAR-BARE/.test(rendered.before), "baseline: the entity must exist to be measured");
    assert.ok(!/continuityStates/.test(rendered.before), "baseline: and must not have been normalized, or the control measures nothing");
  },
  probe: async (mutateSource) => {
    const rendered = await bareEntityPage(mutateSource);
    vm.runInContext(`openAssetAutomationModal("characters","CHAR-BARE")`, rendered.context);
    const after = vm.runInContext(`JSON.stringify(P.characters.find((x) => x.id === "CHAR-BARE"))`, rendered.context);
    const mutated = after !== rendered.before;
    return { reached: true, held: !mutated, reason: mutated ? "opening-a-planner-wrote-state" : "unchanged" };
  },
  reason: "opening-a-planner-wrote-state",
  explain: "A guard that lives one line inside a wrapper that already mutated is a guard the reachable surface never reaches.",
});

/* THE ENTITY IS ADDED AFTER LOAD, ON PURPOSE.
 *
 * Normalization is CineBraid's named, deliberate mutation and it runs when a
 * project is opened, so an entity that was in the file already has its default
 * state by the time any screen sees it — and a control that measured one would
 * be measuring nothing. A reference the creator adds DURING the session has not
 * been normalized, and opening a planner on it is exactly the reachable path the
 * Dogfood #2 audit walked. */
async function bareEntityPage(mutateSource) {
  const project = buildFixture();
  const scan = { anchors: [{ name: "CHAR-BARE-A.png", url: "data:image/svg+xml,%3Csvg/%3E" }], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} };
  const rendered = await render("#/library/all", project, { scan, ...(mutateSource ? { mutateSource } : {}) });
  vm.runInContext(`P.characters.push({ id: "CHAR-BARE", name: "Bare", prefix: "CHAR-BARE", approvedFile: "CHAR-BARE-A.png" })`, rendered.context);
  rendered.before = vm.runInContext(`JSON.stringify(P.characters.find((x) => x.id === "CHAR-BARE"))`, rendered.context);
  return rendered;
}

/* ===========================================================================
   THE HARNESS ITSELF.
   =========================================================================== */

/* The rule an earlier audit rejected must not come back. */
{
  const own = fs.readFileSync(__filename, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/catch\s*\([^)]*\)\s*\{[^}]*failed\s*=\s*true/.test(own),
    "no control may treat a caught error as success — that is the rule the Batch 1B harness was built on");
  assert.ok(!/instanceof assert\.AssertionError/.test(own),
    "and no control may branch on the TYPE of a thrown error to decide whether it fired");
}

Promise.all(pending).then(() => {
  console.log([
    `CineBraid production-truth negative controls: ${controls} controls exercised.`,
    "Each held under the real implementation, was confirmed mutated, reached its checkpoint, and failed for its own named reason.",
    ...notes,
  ].join("\n"));
}).catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });
