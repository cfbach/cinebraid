/* NEGATIVE CONTROLS FOR THE DOGFOOD #2 TRUST KERNEL.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE WAS REWRITTEN (Batch 1C).
 *
 * The Batch 1B harness had one rule: if the control body threw an
 * `AssertionError`, the control had fired. The re-audit's §10 took that apart,
 * and it was right on every count:
 *
 *   - ANY AssertionError counted, including one from an unrelated line, a
 *     baseline precondition, or a typo in the fixture;
 *   - C18 and C19 put their baseline "is this branch even live" checks INSIDE
 *     the catch-as-success region, so a broken baseline reported the control as
 *     successfully fired before the mutation was applied;
 *   - C15b's fixture already violated its own assertion before the mutation, so
 *     it passed for a pre-existing condition and proved nothing about the guard
 *     it named;
 *   - nothing verified that execution ever REACHED the assertion, or that the
 *     real implementation still upholds the invariant.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT NOW. A control is a PROBE, not a throw.
 *
 * `probe(module)` returns `{ reached, held }`:
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
 * test asserts that there is not.
 *
 * IN MEMORY, ALWAYS. Nothing in the working tree is modified, so no control can
 * be "restored" by a checkout that also discards real work.
 *
 * NO PROJECT DATA IS TOUCHED, AND NO PROVIDER OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
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

/* THE CONTROL. Every condition above, in order, with nothing swallowed. */
/* A guard may legitimately be more than one layer. `mutations` breaks all of
   them together, which is the only honest way to show that the SET is
   load-bearing when each layer alone is covered by the others. */
function applyMutations(spec) {
  const rows = spec.mutations || [[spec.anchor, spec.replacement, spec.occurrences === undefined ? 1 : spec.occurrences]];
  let text = source(spec.file);
  rows.forEach(([anchor, replacement, occurrences], index) => {
    text = mutate(text, anchor, replacement, `${spec.label}#${index + 1}`, occurrences === undefined ? 1 : occurrences);
  });
  return text;
}

function control(spec) {
  const { label, file, baseline, probe, reason, explain } = spec;
  controls += 1;
  /* 1 — BASELINE, OUTSIDE ANY CATCH. If this throws, the suite fails; it is not
         evidence that anything fired. */
  if (typeof baseline === "function") baseline(build(file));
  /* 7 — THE REAL MODULE UPHOLDS THE INVARIANT. Run first, so a control that
         describes a property the code never had is caught immediately. */
  const real = probe(build(file));
  assert.ok(real && real.reached === true,
    `${label}: the probe did not reach its checkpoint against the REAL module, so it proves nothing about the mutated one`);
  assert.strictEqual(real.held, true,
    `${label}: the invariant does not hold in the shipped implementation, so this control is describing a property that does not exist`);
  /* 2 — THE MUTATION IS CONFIRMED. `mutate` throws a plain Error otherwise. */
  const broken = build(file, applyMutations(spec));
  /* 3 & 4 & 5 — reached, failed, and failed for the named reason. */
  const after = probe(broken);
  assert.ok(after && after.reached === true,
    `${label}: the probe did not reach its checkpoint against the MUTATED module — the break stopped execution instead of changing behaviour`);
  assert.strictEqual(after.held, false,
    `${label}: the invariant SURVIVED the break. ${explain}`);
  if (reason !== undefined) {
    assert.strictEqual(after.reason, reason,
      `${label}: the invariant failed, but not in the way this control describes (expected ${JSON.stringify(reason)}, got ${JSON.stringify(after.reason)})`);
  }
  notes.push(`  ${label} — held under the real module, failed as ${JSON.stringify(after.reason)} under the mutation`);
}

/* An async twin for a control whose boundary is an HTTP route. Same contract. */
const pending = [];
function controlAsync(spec) {
  const { label, baseline, probe, reason, explain } = spec;
  controls += 1;
  pending.push((async () => {
    if (typeof baseline === "function") await baseline(null);
    const real = await probe(null);
    assert.ok(real && real.reached === true, `${label}: the probe did not reach its checkpoint against the REAL route`);
    assert.strictEqual(real.held, true, `${label}: the invariant does not hold in the shipped route`);
    const mutatedSource = applyMutations(spec);
    const after = await probe(mutatedSource);
    assert.ok(after && after.reached === true, `${label}: the probe did not reach its checkpoint against the MUTATED route`);
    assert.strictEqual(after.held, false, `${label}: the invariant SURVIVED the break. ${explain}`);
    if (reason !== undefined) assert.strictEqual(after.reason, reason, `${label}: failed for the wrong reason (expected ${JSON.stringify(reason)}, got ${JSON.stringify(after.reason)})`);
    notes.push(`  ${label} — held under the real route, failed as ${JSON.stringify(after.reason)} under the mutation`);
  })());
}

/* ---------------------------------------------------------------------------
   Shared fixture helpers. */

const KERNEL_FILE = "public/shared-authority-kernel.js";
const LINEAGE_FILE = "public/shared-state-lineage.js";
const PRESENCE_FILE = "public/shared-frame-presence.js";
const OWNERSHIP_FILE = "public/shared-entity-ownership.js";

function frameProject(winner = "") {
  return { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a", ...(winner ? { winner } : {}) }] }] };
}
/* The edge reader the kernel needs; the same shape shared-production-authority
   installs, restated here so a control can drive the kernel alone. */
function installEdges(kernel) {
  kernel.installAuthorityEdgeReader((project, target) => {
    if (target.kind !== "shot-frame") return { value: "", assetId: "" };
    const shot = (project.shots || []).find((row) => row && row.id === target.shotId);
    const frames = (shot || {}).keyframes || [];
    const index = frames.findIndex((row) => row && row.id === target.frameId);
    if (index < 0) return { value: "", assetId: "" };
    return { value: String(frames[index].winner || (index === 0 ? shot.winner || "" : "")), assetId: "" };
  });
  /* 1D-07: the kernel writes the edge now, from a writer installed once — the
     mirror of the reader above. These controls load a FRESH kernel module per
     probe, so each one gets its own pair, and neither is a per-call argument
     any test could supply differently. */
  kernel.installAuthorityEdgeWriter((draft, target, details) => {
    if (target.kind !== "shot-frame") return false;
    const shot = (draft.shots || []).find((row) => row && row.id === target.shotId);
    const frames = (shot || {}).keyframes || [];
    const index = frames.findIndex((row) => row && row.id === target.frameId);
    if (index < 0) return false;
    frames[index].winner = String(details.value || "");
    if (index === 0) shot.winner = String(details.value || "");
    return true;
  });
  return kernel;
}

/* 1D-01: the synthetic source is gone from the product, so each freshly-loaded
   kernel gets the REAL trusted-event listener installed on an event target this
   file owns. Same boundary as tests/authority-test-gesture.js, applied to a
   module instance rather than the singleton. */
const { installTestManualActionSource } = require("./authority-test-gesture.js");
function gestureSource(kernel) {
  return installTestManualActionSource(kernel);
}
function goodReceipt(overrides = {}) {
  return {
    id: "authority-000001", sequence: 1, actor: "human", act: "explicit-approval",
    command: "approve-shot-frame", kind: "shot-frame", targetKey: "shot-frame:SH-01#fr-a",
    shotId: "SH-01", frameId: "fr-a", value: "PICK.png", status: "current",
    provenance: { manualAction: "gesture-1", via: "test" },
    ...overrides,
  };
}
function ledger(...receipts) {
  return { version: 1, receipts };
}
const FRAME_TARGET = { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" };

/* The 1C audit's MB-1C-04 fixture: a shot whose opening frame carries a raw
   automatic winner, and no authority ledger anywhere in the project. */
const legacyPointerProject = () => ({
  shots: [{
    id: "SH010", scene: "SC01", title: "Hull check", winner: "AUTOPICK.png",
    keyframes: [{ id: "kf-a", label: "A", winner: "AUTOPICK.png" }], clips: [],
    candidateFiles: [{ stored: "AUTOPICK.png", addedAt: "2026-08-01T00:00:00.000Z", decision: "unreviewed" }],
    /* NO generationRecords, which is the audit's exact fixture: the actor is
       `not-recorded`, so nothing diverts the projection to `machine-selected`
       and the old code reported a plain human approval. That is the worst case
       and the one worth pinning — a pointer nobody can even attribute. */
  }],
  characters: [], locations: [], props: [], vehicles: [], audio: [],
});
const legacyPointerScan = () => ({
  anchors: [], props: [], plates: [], vehicles: [], audio: [], media: [],
  shots: { SH010: { takes: [{ name: "AUTOPICK.png", url: "/assets/shots/SH010/takes/AUTOPICK.png" }] } },
});

/* ===========================================================================
   K1 — THE AUTHORITY KERNEL
   =========================================================================== */
notes.push("K1 authority kernel:");

control({
  label: "C1 the manual-action credential is a shape rather than an identity",
  file: KERNEL_FILE,
  anchor: '  const record = MINTED_MANUAL_ACTIONS.get(token);\n  if (!record) {',
  /* The synthesized record mirrors the 1D shape — a Map of bound entries — so
     the mutation reintroduces the DEFECT rather than merely crashing. A control
     that "holds" because the broken code threw a TypeError proves nothing. */
  replacement: '  const record = MINTED_MANUAL_ACTIONS.get(token)\n    || (token && token.actor === "human" && token.act === "explicit-approval" ? { via: "shape", gestureId: "shape", gestureKind: "shape", remaining: new Map([["shot-frame:SH-01#fr-a", { key: "shot-frame:SH-01#fr-a", value: "", assetId: "" }]]) } : null);\n  if (!record) {',
  baseline(kernel) {
    /* OUTSIDE the control's judgement: the kernel must mint at all, or the
       probe below would be measuring a dead path. */
    installEdges(kernel);
    const harness = gestureSource(kernel);
    const token = harness.gesture(() => kernel.beginManualAuthorityAction({ via: "baseline", targets: [FRAME_TARGET] }));
    assert.ok(token && typeof token === "object", "baseline: a real gesture must be able to mint a capability");
  },
  probe(kernel) {
    installEdges(kernel);
    gestureSource(kernel);
    const project = frameProject();
    /* THE EXACT OBJECT THE RE-AUDIT FORGED. */
    let refused = false;
    let wrote = false;
    try {
      kernel.commitAuthorityTransaction(project, {
        kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "FORGED.png", at: "T",
        manualAction: { actor: "human", act: "explicit-approval" },
      });
    } catch { refused = true; }
    return { reached: true, held: refused && !wrote && !project.shots[0].keyframes[0].winner, reason: refused ? "refused" : "accepted-forged-shape" };
  },
  reason: "accepted-forged-shape",
  explain: "A credential that can be typed is not a credential. This is the exact object the Batch 1B re-audit constructed to obtain a winner and a receipt.",
});

control({
  label: "C2 a receipt is accepted without validating its actor",
  file: KERNEL_FILE,
  anchor: '  if (kernelText(receipt.actor) !== AUTHORITY_ACTOR) problems.push({ code: "receipt-actor-not-human", ...at, actor: kernelText(receipt.actor) });',
  replacement: "",
  baseline(kernel) {
    installEdges(kernel);
    const project = { ...frameProject("PICK.png"), productionAuthority: ledger(goodReceipt()) };
    assert.ok(kernel.hasCurrentHumanAuthority(project, FRAME_TARGET), "baseline: a well-formed receipt must confer authority, or the probe measures nothing");
  },
  probe(kernel) {
    installEdges(kernel);
    const project = { ...frameProject("PICK.png"), productionAuthority: ledger(goodReceipt({ actor: "automation" })) };
    const held = !kernel.hasCurrentHumanAuthority(project, FRAME_TARGET);
    return { reached: true, held, reason: held ? "refused" : "accepted-automation-actor" };
  },
  reason: "accepted-automation-actor",
  explain: "An automation actor on a receipt must never read as human authority; the re-audit's persisted fixture had exactly this.",
});

control({
  label: "C3 a receipt is looked up by its stored key rather than its derived one",
  file: KERNEL_FILE,
  mutations: [
    /* layer 1 — stop REPORTING the disagreement */
    ['    if (kernelText(receipt.targetKey) && kernelText(receipt.targetKey) !== target.key) {\n      problems.push({ code: "receipt-target-key-mismatched", ...at, stored: kernelText(receipt.targetKey), derived: target.key });\n    }', ""],
    /* layer 2 — and look the receipt up by the string it carries */
    ["    const key = receipt.target.key;", "    const key = kernelText(receipt.targetKey) || receipt.target.key;"],
  ],
  baseline(kernel) {
    installEdges(kernel);
    const project = { ...frameProject("PICK.png"), productionAuthority: ledger(goodReceipt()) };
    assert.ok(kernel.hasCurrentHumanAuthority(project, FRAME_TARGET),
      "baseline: a consistent receipt confers authority, or the probe measures a reader that never finds anything");
  },
  probe(kernel) {
    installEdges(kernel);
    /* THE RE-AUDIT'S RECEIPT: `targetKey` says fr-a, the component fields say
       something else. The kernel DERIVES the key from the parts, so this row
       buckets under the target it actually names and answers nothing about
       fr-a. Trust the stored string instead and it answers for fr-a. */
    const project = { ...frameProject("PICK.png"), productionAuthority: ledger(goodReceipt({ shotId: "SH-OTHER", frameId: "fr-other" })) };
    const held = !kernel.hasCurrentHumanAuthority(project, FRAME_TARGET);
    return { reached: true, held, reason: held ? "refused" : "accepted-mismatched-target" };
  },
  reason: "accepted-mismatched-target",
  explain: "A stored key that disagrees with the fields beside it is the forgery the re-audit walked in through; the key must be derived, never read.",
});

/* And the disagreement is REPORTED as well as ignored, so a damaged ledger can
   be found rather than merely being inert. Asserted directly — it is a
   diagnostic, not a decision, so breaking it does not break an invariant and it
   would be dishonest to dress it up as a control. */
{
  const kernel = installEdges(build(KERNEL_FILE));
  const diagnostics = kernel.authorityLedgerDiagnostics({ productionAuthority: ledger(goodReceipt({ shotId: "SH-OTHER", frameId: "fr-other" })) });
  assert.ok(diagnostics.some((row) => row.code === "receipt-target-key-mismatched"),
    "a receipt whose stored key disagrees with its fields is reported as damaged");
  notes.push("  C3b stored/derived target-key disagreement is reported as a diagnostic");
}

control({
  label: "C4 two current receipts resolve to the last one",
  file: KERNEL_FILE,
  mutations: [
    /* layer 1 — stop reporting it */
    ['    if (bucket.current.length > 1) {\n      diagnostics.push({ code: "target-multiple-current-receipts", targetKey: bucket.key, ids: bucket.current.map((row) => kernelText(row.id)) });\n    }', ""],
    /* layer 2 — and let the reader silently pick one */
    ["  if (!bucket || bucket.current.length !== 1) return null;\n  const receipt = bucket.current[0];",
     "  if (!bucket || !bucket.current.length) return null;\n  const receipt = bucket.current[bucket.current.length - 1];"],
  ],
  baseline(kernel) {
    installEdges(kernel);
    const project = { ...frameProject("PICK.png"), productionAuthority: ledger(goodReceipt()) };
    assert.ok(kernel.hasCurrentHumanAuthority(project, FRAME_TARGET), "baseline: one current receipt confers authority");
  },
  probe(kernel) {
    installEdges(kernel);
    const project = {
      ...frameProject("PICK.png"),
      productionAuthority: ledger(goodReceipt(), goodReceipt({ id: "authority-000002", sequence: 2 })),
    };
    const held = !kernel.hasCurrentHumanAuthority(project, FRAME_TARGET);
    return { reached: true, held, reason: held ? "refused" : "silently-picked-a-winner" };
  },
  reason: "silently-picked-a-winner",
  explain: "Two current rows is a ledger nobody can read, not a race the newest row wins.",
});

control({
  label: "C5 duplicate receipt ids are accepted",
  file: KERNEL_FILE,
  anchor: '    if (seenIds.has(id)) { diagnostics.push({ code: "receipt-id-duplicated", index, id }); continue; }',
  replacement: "    if (seenIds.has(id)) { continue; }",
  baseline(kernel) {
    installEdges(kernel);
    assert.strictEqual(kernel.authorityLedgerDiagnostics({ productionAuthority: ledger(goodReceipt()) }).length, 0,
      "baseline: a clean ledger reports no diagnostics");
  },
  probe(kernel) {
    installEdges(kernel);
    const project = { productionAuthority: ledger(goodReceipt(), goodReceipt({ sequence: 2, status: "superseded" })) };
    const codes = kernel.authorityLedgerDiagnostics(project).map((row) => row.code);
    const held = codes.includes("receipt-id-duplicated");
    return { reached: true, held, reason: held ? "reported" : "duplicate-id-unreported" };
  },
  reason: "duplicate-id-unreported",
  explain: "A ledger whose sequence had been reset minted a second authority-000001; two decisions with one durable id is unreadable.",
});

control({
  label: "C6 the edge is written before the credential is checked",
  file: KERNEL_FILE,
  /* 1D: the same defect, re-expressed against the code that exists now. There
     is no caller `applyEdge` left to move, so the mutation makes the KERNEL's
     own installed writer run against the LIVE project before the credential is
     consumed — the identical ordering failure, at the boundary that owns it. */
  anchor: '  const provenance = consumeManualAction(it.manualAction, target, value, assetId);',
  replacement: '  if (typeof AUTHORITY_EDGE_WRITER === "function") AUTHORITY_EDGE_WRITER(project, target, { value, assetId, at: kernelText(it.at) });\n  const provenance = consumeManualAction(it.manualAction, target, value, assetId);',
  baseline(kernel) {
    installEdges(kernel);
    gestureSource(kernel);
    assert.ok(typeof kernel.commitAuthorityTransaction === "function", "baseline: the transaction exists");
  },
  probe(kernel) {
    installEdges(kernel);
    gestureSource(kernel);
    const project = frameProject();
    try {
      kernel.commitAuthorityTransaction(project, {
        kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "X.png", at: "T",
        manualAction: undefined,
      });
    } catch { /* refusal is expected; WHETHER IT WROTE FIRST is the question */ }
    const held = !project.shots[0].keyframes[0].winner;
    return { reached: true, held, reason: held ? "nothing-written" : "wrote-before-checking" };
  },
  reason: "wrote-before-checking",
  explain: "Ordering IS the guarantee: a refusal that has already written the winner has refused nothing.",
});

control({
  label: "C7 a commit that did not persist still returns a receipt",
  file: KERNEL_FILE,
  anchor: '  if (!currentHumanAuthority(project, target)) {\n    applyDraftToProject(project, preImage);\n    throw authorityError(\n      "AUTHORITY_NOT_PERSISTED",',
  replacement: '  if (false) {\n    applyDraftToProject(project, preImage);\n    throw authorityError(\n      "AUTHORITY_NOT_PERSISTED",',
  baseline(kernel) {
    installEdges(kernel);
    const harness = gestureSource(kernel);
    const project = frameProject();
    const token = harness.gesture(() => kernel.beginManualAuthorityAction({ via: "baseline", targets: [FRAME_TARGET] }));
    const receipt = kernel.commitAuthorityTransaction(project, {
      kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "OK.png", at: "T", manualAction: token,
    });
    assert.ok(receipt && receipt.id, "baseline: an ordinary commit succeeds and returns a receipt");
    assert.ok(project.productionAuthority, "baseline: and the ledger is durable");
  },
  probe(kernel) {
    installEdges(kernel);
    const harness = gestureSource(kernel);
    /* A non-extensible root: the clone validates, the copy back cannot add the
       ledger key, and the command would return an id for a receipt that is not
       there. The re-audit's exact case. */
    const project = Object.preventExtensions(frameProject());
    const token = harness.gesture(() => kernel.beginManualAuthorityAction({ via: "probe", targets: [FRAME_TARGET] }));
    let returned = null;
    try {
      returned = kernel.commitAuthorityTransaction(project, {
        kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "PARTIAL.png", at: "T", manualAction: token,
      });
    } catch { returned = null; }
    const lying = !!returned && !project.productionAuthority;
    return { reached: true, held: !lying, reason: lying ? "returned-a-phantom-receipt" : "refused" };
  },
  reason: "returned-a-phantom-receipt",
  explain: "A returned receipt must describe durable state. The re-audit got authority-000001 back with no ledger written.",
});

/* ===========================================================================
   K3 — FRAME PRESENCE AT THE PAID BOUNDARY
   =========================================================================== */
notes.push("K3 frame presence:");

const SWEEP = { id: "CHAR-X", name: "Chimbley Sweep" };
function governedShot(extra = {}) {
  return {
    id: "SH-01",
    keyframes: [{ id: "fr-a" }, { id: "fr-b" }],
    creationBrief: { frameWorkflows: { "fr-a": { entityPresence: { "CHAR-X": "absent" } }, "fr-b": { entityPresence: { "CHAR-X": "present" } }, ...extra } },
  };
}
function presenceProject(shot) {
  return { shots: [shot], characters: [SWEEP], locations: [], props: [], vehicles: [] };
}

control({
  label: "C8 an unknown frame id is treated as declaring nothing",
  file: PRESENCE_FILE,
  anchor: '  if (!shotHasFrame(shot, frameId)) {',
  replacement: "  if (false) {",
  baseline(presence) {
    const gate = presence.finalDispatchPresenceGate({ project: presenceProject(governedShot()), purpose: "frame", shotId: "SH-01", frameId: "fr-a", prompt: "Empty rooftops." });
    assert.strictEqual(gate.ok, true, "baseline: a clean governed request passes, or the probe measures a gate that refuses everything");
  },
  probe(presence) {
    const gate = presence.finalDispatchPresenceGate({
      project: presenceProject(governedShot()), purpose: "frame", shotId: "SH-01",
      frameId: "not-a-frame", prompt: "A tiny Chimbley Sweep figure is silhouetted on the ridge.",
    });
    return { reached: true, held: gate.ok === false, reason: gate.ok === false ? "refused" : "allowed-unknown-frame" };
  },
  reason: "allowed-unknown-frame",
  explain: "The re-audit sent frameId 'not-a-frame' through the real FAL route and it reached the provider and committed a job row.",
});

control({
  label: "C9 a malformed presence declaration is treated as an empty one",
  file: PRESENCE_FILE,
  anchor: "  if (record.malformed) {",
  replacement: "  if (false) {",
  baseline(presence) {
    const status = presence.framePresenceRecordStatus(governedShot(), "fr-a");
    assert.strictEqual(status.malformed, false, "baseline: a well-formed declaration is not malformed");
  },
  probe(presence) {
    const shot = governedShot({ "fr-c": { entityPresence: { "CHAR-X": { state: "absent" } } } });
    shot.keyframes.push({ id: "fr-c" });
    const gate = presence.finalDispatchPresenceGate({
      project: presenceProject(shot), purpose: "frame", shotId: "SH-01", frameId: "fr-c",
      prompt: "The Chimbley Sweep stands at the stack.",
    });
    return { reached: true, held: gate.ok === false, reason: gate.ok === false ? "refused" : "allowed-malformed-declaration" };
  },
  reason: "allowed-malformed-declaration",
  explain: "{ state: 'absent' } normalised to '' and the frame looked unconstrained; the re-audit drove it to the provider trap.",
});

control({
  label: "C10 double negatives read as denials",
  file: PRESENCE_FILE,
  anchor: "  if (negations >= 2 && negations % 2 === 0) return false;",
  replacement: "",
  baseline(presence) {
    assert.strictEqual(presence.clauseAssertsPresence("Without the Chimbley Sweep, the rooftops read as empty.", SWEEP), false,
      "baseline: a single negation must still deny, or this control would pass by breaking the wrong thing");
  },
  probe(presence) {
    const held = presence.clauseAssertsPresence("The room is not without the Chimbley Sweep.", SWEEP) === true;
    return { reached: true, held, reason: held ? "caught" : "missed-double-negative" };
  },
  reason: "missed-double-negative",
  explain: "Two negations cancel. The re-audit drove this exact sentence through the real route to the provider trap.",
});

control({
  label: "C11 declared absence stops forbidding presence",
  file: PRESENCE_FILE,
  anchor: 'const FRAME_PRESENCE_FORBIDDING_VALUES = ["absent"];',
  replacement: "const FRAME_PRESENCE_FORBIDDING_VALUES = [];",
  baseline(presence) {
    /* Compared by join, not deepStrictEqual: the array comes from the control's
       vm realm and a host-realm literal is a different Array. */
    assert.strictEqual(presence.absentEntityIdsForFrame(governedShot(), "fr-a").join(","), "CHAR-X",
      "baseline: absent must be forbidding, or the declaration is decoration");
  },
  probe(presence) {
    const held = presence.absentEntityIdsForFrame(governedShot(), "fr-a").length === 1;
    return { reached: true, held, reason: held ? "forbidden" : "absence-not-forbidding" };
  },
  reason: "absence-not-forbidding",
  explain: "If nothing forbids presence, the declaration is decoration and the compiler is unchanged.",
});

/* ===========================================================================
   K4 — OWNERSHIP
   =========================================================================== */
notes.push("K4 ownership:");

function ownershipIndex(ownership, contested = false) {
  const characters = [
    { id: "CHAR-A", prefix: "CHAR-A", candidateFiles: [{ stored: "A_ONE.png" }, ...(contested ? [{ stored: "SHARED.png" }] : [])] },
    { id: "CHAR-B", prefix: "CHAR-B", candidateFiles: [...(contested ? [{ stored: "SHARED.png" }] : [])] },
  ];
  return ownership.buildEntityOwnerIndex({ characters }, "characters");
}

control({
  label: "C12 inference is accepted as ownership",
  file: OWNERSHIP_FILE,
  anchor: "  return resolution.authoritative === true && resolution.ownerId === wanted;",
  replacement: "  return resolution.ownerId === wanted;",
  baseline(ownership) {
    assert.strictEqual(ownership.entityOwnsMedia(ownershipIndex(ownership), "CHAR-A", "A_ONE.png"), true,
      "baseline: a durably claimed file IS owned, or the probe measures a predicate that refuses everything");
  },
  probe(ownership) {
    const held = ownership.entityOwnsMedia(ownershipIndex(ownership), "CHAR-A", "CHAR-A_DROPPED.png") === false;
    return { reached: true, held, reason: held ? "refused" : "inference-became-ownership" };
  },
  reason: "inference-became-ownership",
  explain: "A filename match is discovery. The re-audit approved an unclaimed file into a canon pool because one reader answered both questions.",
});

control({
  label: "C13 a contested file is attributed to a claimant",
  file: OWNERSHIP_FILE,
  anchor: "  if (contested.has(name)) {",
  replacement: "  if (false && contested.has(name)) {",
  baseline(ownership) {
    assert.strictEqual(ownership.resolveMediaOwnership(ownershipIndex(ownership, true), "SHARED.png").contested, true,
      "baseline: the fixture really is contested");
  },
  probe(ownership) {
    const resolution = ownership.resolveMediaOwnership(ownershipIndex(ownership, true), "SHARED.png");
    const held = resolution.ownerId === "" && resolution.authoritative === false;
    return { reached: true, held, reason: held ? "blocked" : "attributed-a-contested-file" };
  },
  reason: "attributed-a-contested-file",
  explain: "Filename specificity created the contamination; it may not settle it. The re-audit's batch writer approved SHARED.png anyway.",
});

/* ===========================================================================
   K5 — LINEAGE
   =========================================================================== */
notes.push("K5 lineage:");

const VALID_STATES = () => ([
  { id: "state-default", isDefault: true, parentStateId: "" },
  { id: "child", parentStateId: "state-default" },
  { id: "grand", parentStateId: "child" },
]);

control({
  label: "C14 a state may be created under a parent that does not exist",
  file: LINEAGE_FILE,
  mutations: [
    /* layer 1 — the creation-time parent check */
    ['    if (!rows.some((row) => lineageText(row.id) === parentStateId)) return { create: false, reason: "parent-missing" };', ""],
    /* layer 2 — and the collection validator that catches it afterwards */
    ['    if (!ids.has(parentId)) problems.push({ code: "parent-missing", index, id, parentStateId: parentId });', ""],
  ],
  baseline(lineage) {
    assert.strictEqual(lineage.planStateCreation(VALID_STATES(), { id: "new", parentStateId: "child" }).create, true,
      "baseline: creating under a REAL parent works, or this control would pass because creation is broken generally");
  },
  probe(lineage) {
    const outcome = lineage.planStateCreation(VALID_STATES(), { id: "new", parentStateId: "ghost" });
    const held = outcome.create === false;
    return { reached: true, held, reason: held ? "refused" : "created-dangling-ancestry" };
  },
  reason: "created-dangling-ancestry",
  explain: "Creation is the only moment ancestry is chosen, so it is the only place dangling ancestry can enter.",
});

control({
  label: "C15 the collection validator ignores duplicate ids",
  file: LINEAGE_FILE,
  anchor: '    if (seen.has(id)) problems.push({ code: "state-id-duplicated", index, id });',
  replacement: "",
  baseline(lineage) {
    /* OUTSIDE the catch region: the fixture must be VALID before the mutation,
       which is exactly what C15b failed to do in Batch 1B. */
    assert.strictEqual(lineage.stateCollectionIntact(VALID_STATES()), true,
      "baseline: the starting collection is valid, so any failure below is caused by the mutation and nothing else");
  },
  probe(lineage) {
    const collection = [...VALID_STATES(), { id: "child", parentStateId: "state-default" }];
    const held = lineage.stateCollectionIntact(collection) === false;
    return { reached: true, held, reason: held ? "rejected" : "duplicate-ids-accepted" };
  },
  reason: "duplicate-ids-accepted",
  explain: "Two states sharing an id is what made the simulated graph and the committed graph disagree.",
});

control({
  label: "C15b the collection validator ignores dangling ancestry",
  file: LINEAGE_FILE,
  anchor: '    if (!ids.has(parentId)) problems.push({ code: "parent-missing", index, id, parentStateId: parentId });',
  replacement: "",
  baseline(lineage) {
    /* THE REPAIR THE RE-AUDIT ASKED FOR. Batch 1B's C15b started from a fixture
       that ALREADY contained an a<->b cycle and then asserted the cycle count
       was zero — false before the mutation, so it passed for a pre-existing
       condition. This starts VALID and becomes invalid only because of the
       intended break. */
    assert.strictEqual(lineage.stateCollectionIntact(VALID_STATES()), true,
      "baseline: the starting collection is valid");
    assert.strictEqual(lineage.lineageCycles(VALID_STATES()).length, 0,
      "baseline: and acyclic, so 'dangling' is the only thing this control can be measuring");
  },
  probe(lineage) {
    /* Valid but for ONE dangling parent — and NOT a cycle, which is the whole
       point: `lineageIsAcyclic` returns true here. */
    const collection = [...VALID_STATES(), { id: "orphan", parentStateId: "ghost" }];
    const acyclic = lineage.lineageIsAcyclic(collection);
    const held = acyclic === true && lineage.stateCollectionIntact(collection) === false;
    return { reached: true, held, reason: held ? "rejected" : "dangling-parent-accepted" };
  },
  reason: "dangling-parent-accepted",
  explain: "Deleting an ancestor left a child pointing at nothing and the old check called the result acyclic. Acyclic is not integrity.",
});

control({
  label: "C16 deleting a state with descendants is permitted",
  file: LINEAGE_FILE,
  mutations: [
    /* layer 1 — the refusal itself. 1D-06 removed the `policy === "refuse"`
       qualifier, because refuse is now the only policy there is. */
    ['  if (children.length) return { remove: false, reason: "has-children", policy, children };', ""],
    /* layer 2 — and the collection validator that would catch the orphan it leaves */
    ['    if (!ids.has(parentId)) problems.push({ code: "parent-missing", index, id, parentStateId: parentId });', ""],
  ],
  baseline(lineage) {
    assert.strictEqual(lineage.planStateDeletion(VALID_STATES(), "grand").remove, true,
      "baseline: a leaf CAN be deleted, or this control would pass because deletion is broken generally");
  },
  probe(lineage) {
    const collection = VALID_STATES();
    const before = JSON.stringify(collection);
    const outcome = lineage.applyStateDeletion(collection, "child");
    const held = outcome.applied === false && JSON.stringify(collection) === before;
    return { reached: true, held, reason: held ? "refused" : "orphaned-a-descendant" };
  },
  reason: "orphaned-a-descendant",
  explain: "Removing `child` from root->child->grand left grand pointing at nothing; the default policy must refuse.",
});

control({
  label: "C17 a finished chain wraps instead of completing",
  file: LINEAGE_FILE,
  anchor: "  const unfinished = candidates.filter((candidate) => !candidate.approved);\n  if (!unfinished.length) {",
  replacement: "  const unfinished = candidates;\n  if (!unfinished.length) {",
  baseline(lineage) {
    const chain = [
      { id: "state-default", isDefault: true, parentStateId: "", approvedFile: "R.png" },
      { id: "child", parentStateId: "state-default", approvedFile: "" },
    ];
    assert.strictEqual(lineage.continuationOutcome(chain, "state-default").kind, "continue",
      "baseline: an unfinished chain continues, or 'complete' would be the answer to everything");
  },
  probe(lineage) {
    const chain = [
      { id: "state-default", isDefault: true, parentStateId: "", approvedFile: "R.png" },
      { id: "child", parentStateId: "state-default", approvedFile: "C.png" },
      { id: "grand", parentStateId: "child", approvedFile: "G.png" },
    ];
    const held = lineage.continuationOutcome(chain, "child").kind === "complete";
    return { reached: true, held, reason: held ? "completed" : "wrapped-instead-of-completing" };
  },
  reason: "wrapped-instead-of-completing",
  explain: "A ring has no end; 'complete' is the answer that stops it.",
});

/* ===========================================================================
   THE ANTI-VACUITY CONTROL — the real paid route.
   =========================================================================== */
notes.push("Paid dispatch boundary:");

controlAsync({
  label: "CG the universal pre-provider presence gate is removed",
  file: "fal-generation.js",
  anchor: "    if (!presenceGate.ok)",
  replacement: "    if (false && !presenceGate.ok)",
  async baseline() {},
  async probe(mutatedSource) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-cg-"));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-cg-project-"));
    const realFetch = globalThis.fetch;
    let providerAttempts = 0;
    try {
      fs.writeFileSync(path.join(projectDir, "generation-jobs.json"), "[]");
      fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(presenceProject(governedShot())));
      let moduleExports;
      if (mutatedSource) {
        const rewritten = mutatedSource.replace(/require\("\.\/([^"]+)"\)/g, (m, rel) => `require(${JSON.stringify(path.join(ROOT, rel).replace(/\\/g, "/"))})`);
        const copy = path.join(scratch, "fal-generation.mutated.js");
        fs.writeFileSync(copy, rewritten);
        moduleExports = require(copy);
      } else {
        moduleExports = require(path.join(ROOT, "fal-generation.js"));
      }
      const routes = new Map();
      moduleExports.registerFalGeneration({ post: (route, handler) => routes.set(route, handler), get: () => {} }, {
        readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "not-a-real-credential" } } }),
        readProject: () => JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")),
        writeProject: () => {},
        activeSlug: () => "control",
        projectDirForSlug: () => ({ dir: projectDir, file: path.join(projectDir, "project.json") }),
      });
      globalThis.fetch = (...args) => { providerAttempts += 1; throw new Error(`provider contacted: ${String(args[0])}`); };
      const handler = routes.get("/api/generation/fal/jobs");
      const res = { status() { return this; }, json() { return this; } };
      await handler({ body: { purpose: "frame", shotId: "SH-01", frameId: "fr-a", prompt: "The Chimbley Sweep stands before the chimney.", outputCount: 1 }, query: {}, headers: {} }, res);
      const rows = JSON.parse(fs.readFileSync(path.join(projectDir, "generation-jobs.json"), "utf8"));
      /* BOTH CONSEQUENCES, as the re-audit required: the mocked provider
         boundary was reached AND a paid job row was committed. Asserting only
         the attempt count would miss a gate that stopped the request after the
         row existed. */
      const held = providerAttempts === 0 && rows.length === 0;
      return { reached: true, held, reason: held ? "refused" : `reached-provider(${providerAttempts})-and-committed(${rows.length})` };
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  },
  explain: "Remove the gate and a contradicting request goes to fal and leaves a committed unresolved job row. This is the control that proves the boundary is mandatory rather than conventional.",
});


/* ===========================================================================
   BATCH 1D — ONE CONTROL PER MERGE BLOCKER THE 1C ACCEPTANCE AUDIT FOUND.

   Each reintroduces the EXACT counterexample the audit executed and proves the
   suite goes red for it. They obey the same seven-condition contract as every
   control above: valid baseline outside any catch, confirmed mutation, reached
   checkpoint, invariant holds under the real module, fails under the mutation,
   and fails for its own named reason.
   =========================================================================== */
notes.push("1D closure controls:");

/* --- CONTROL 1 (MB-1C-01) ------------------------------------------------ */
/* Not a source mutation: the property is that a shipped export DOES NOT EXIST,
   and there is nothing to break in a way that would be honest. So this one
   reintroduces the export itself — the literal Batch 1C line — and proves the
   browser composition can then mint human authority with no event at all. */
{
  controls += 1;
  const label = "D1 the test-harness gesture source is exported into the browser";
  const kernelSource = fs.readFileSync(path.join(ROOT, KERNEL_FILE), "utf8");

  const runBrowser = (source) => {
    const sandbox = { console };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: "shared-authority-kernel.js" });
    sandbox.installAuthorityEdgeReader((project, target) => {
      const shot = (project.shots || []).find((row) => row && row.id === target.shotId);
      const frame = ((shot || {}).keyframes || []).find((row) => row && row.id === target.frameId);
      return { value: String((frame || {}).winner || ""), assetId: "" };
    });
    sandbox.installAuthorityEdgeWriter((draft, target, details) => {
      const shot = (draft.shots || []).find((row) => row && row.id === target.shotId);
      const frame = ((shot || {}).keyframes || []).find((row) => row && row.id === target.frameId);
      if (!frame) return false;
      frame.winner = String(details.value || "");
      return true;
    });
    /* EXACTLY WHAT THE 1C AUDIT DID: ordinary page script, no user agent, no
       event — reach for a synthetic source and mint. */
    const installer = sandbox.installHarnessManualActionSource
      || (sandbox.CineBraidAuthorityKernel || {}).installHarnessManualActionSource;
    if (typeof installer !== "function") return { minted: false, actor: "", reason: "no-synthetic-source-exists" };
    const project = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }] }] };
    try {
      const harness = installer();
      const token = harness.gesture(() => sandbox.beginManualAuthorityAction({
        via: "ordinary-browser-code", targets: [{ kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }],
      }));
      sandbox.commitAuthorityTransaction(project, {
        kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "FORGED.png", at: "T", manualAction: token,
      });
      return { minted: true, actor: String(project.productionAuthority.receipts[0].actor), reason: "browser-minted-human-authority" };
    } catch (error) { return { minted: false, actor: "", reason: String(error.code || error.message) }; }
  };

  /* 1 — BASELINE, OUTSIDE ANY CATCH: the browser composition loads and the real
         approval path works when a trusted event IS delivered. */
  {
    const sandbox = { console };
    sandbox.window = sandbox; sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(kernelSource, sandbox, { filename: "shared-authority-kernel.js" });
    assert.ok(typeof sandbox.beginManualAuthorityAction === "function", "baseline: the kernel loads in a browser composition");
    assert.ok(typeof sandbox.installBrowserManualActionSource === "function", "baseline: and the real trusted-event installer is there");
  }

  /* 7 — THE REAL MODULE UPHOLDS IT. */
  const real = runBrowser(kernelSource);
  assert.strictEqual(real.minted, false, `${label}: the shipped kernel must not let browser code mint without an event`);
  assert.strictEqual(real.reason, "no-synthetic-source-exists",
    `${label}: and the reason must be that the export is absent, not that some other guard happened to fire`);

  /* 2 — THE MUTATION, CONFIRMED: put Batch 1C's installer back, verbatim. */
  const restored = kernelSource.replace(
    "const AUTHORITY_KERNEL_EXPORTS = {",
    'function installHarnessManualActionSource() {\n'
    + '  MANUAL_ACTION_SOURCE = "harness";\n'
    + '  return { gesture(body) { openTrustedGesture("harness"); try { return body(); } finally { closeTrustedGesture(); } } };\n'
    + '}\n'
    + "const AUTHORITY_KERNEL_EXPORTS = {\n  installHarnessManualActionSource,",
  );
  assert.notStrictEqual(restored, kernelSource, `${label}: the mutation anchor is stale and nothing was reintroduced`);

  /* 3, 4, 5 — reached, failed, and for its own reason. */
  const after = runBrowser(restored);
  assert.strictEqual(after.minted, true,
    `${label}: the mutation did not reproduce the 1C counterexample, so this control proves nothing`);
  assert.strictEqual(after.actor, "human",
    `${label}: and the forged receipt must claim a person, which is what made it a blocker`);
  notes.push(`  ${label} -> caught as "${after.reason}"`);
}

/* --- CONTROL 2 (MB-1C-02) ------------------------------------------------ */
control({
  label: "D2 a capability is bound to the target but not to the displayed value",
  file: KERNEL_FILE,
  mutations: [
    /* Remove BOTH staleness checks. Either alone leaves the other covering it,
       and a control that a single-layer break survives proves nothing. */
    ['  if (bound.value && bound.value !== wantedValue) {', '  if (false) {'],
    ['  if (bound.assetId && bound.assetId !== wantedAsset) {', '  if (false) {'],
  ],
  baseline(kernel) {
    installEdges(kernel);
    const harness = gestureSource(kernel);
    const project = frameProject();
    const token = harness.gesture(() => kernel.beginManualAuthorityAction({
      via: "baseline", targets: [{ ...FRAME_TARGET, value: "A.png" }],
    }));
    kernel.commitAuthorityTransaction(project, {
      kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "A.png", at: "T", manualAction: token,
    });
    assert.strictEqual(project.shots[0].keyframes[0].winner, "A.png",
      "baseline: approving the value the gesture named must WORK, or the probe measures a dead path");
  },
  probe(kernel) {
    installEdges(kernel);
    const harness = gestureSource(kernel);
    const project = frameProject();
    /* The 1C audit's case: the modal displayed A, the selection changed to B. */
    const token = harness.gesture(() => kernel.beginManualAuthorityAction({
      via: "approve-modal", targets: [{ ...FRAME_TARGET, value: "A.png", assetId: "asset-A" }],
    }));
    let refused = false;
    try {
      kernel.commitAuthorityTransaction(project, {
        kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "B.png", assetId: "asset-B", at: "T", manualAction: token,
      });
    } catch { refused = true; }
    const committed = String(project.shots[0].keyframes[0].winner || "");
    const held = refused && committed !== "B.png";
    return { reached: true, held, reason: held ? "refused-stale" : `approved-the-other-asset(${committed})` };
  },
  reason: "approved-the-other-asset(B.png)",
  explain: "A capability that names only the target approves whatever the UI is showing by the time the commit runs, which is not what the person confirmed.",
});

/* --- CONTROL 3 (MB-1C-03) ------------------------------------------------ */
control({
  label: "D3 entity ownership is skippable at the commit boundary",
  file: KERNEL_FILE,
  mutations: [
    /* Layer 1: make the policy optional again, the way 1C had it. */
    ['  if (target.kind !== "entity-state") return;', '  if (true) return;'],
  ],
  baseline(kernel) {
    installEdges(kernel);
    gestureSource(kernel);
    kernel.installAuthorityOwnershipPolicy(() => ({ ok: true }));
    assert.ok(typeof kernel.commitAuthorityTransaction === "function", "baseline: the transaction exists");
  },
  probe(kernel) {
    installEdges(kernel);
    const harness = gestureSource(kernel);
    /* The resolver's real answer for the audit's fixture: SHARED.png is claimed
       by two entities, so nobody may make it canon. */
    kernel.installAuthorityOwnershipPolicy((project, target, value) => (
      value === "SHARED.png"
        ? { ok: false, code: "AUTHORITY_OWNERSHIP_CONTESTED", message: "claimed by CHAR-A and CHAR-B" }
        : { ok: true }
    ));
    /* A matching reader/writer PAIR for entity-state, or the commit would refuse
       at the post-write agreement check for an unrelated reason and this control
       would "hold" without ever exercising the policy. */
    kernel.installAuthorityEdgeReader((project, target) => {
      const entity = (project.characters || []).find((row) => row && row.id === target.entityId);
      return { value: String((entity || {}).approvedFile || ""), assetId: "" };
    });
    kernel.installAuthorityEdgeWriter((draft, target, details) => {
      const entity = (draft.characters || []).find((row) => row && row.id === target.entityId);
      if (!entity) return false;
      entity.approvedFile = String(details.value || "");
      return true;
    });
    const project = { characters: [{ id: "CHAR-A", approvedFile: "", continuityStates: [{ id: "state-default", isDefault: true }] }], shots: [] };
    const target = { kind: "entity-state", list: "characters", entityId: "CHAR-A", stateId: "state-default" };
    let refused = false;
    try {
      kernel.commitAuthorityTransaction(project, {
        ...target, value: "SHARED.png", at: "T",
        /* The 1C escape, attempted: a caller-supplied override. There is no such
           parameter any more, so this is inert — which is the point. */
        eligibility: () => ({ ok: true }),
        manualAction: harness.gesture(() => kernel.beginManualAuthorityAction({ via: "probe", targets: [target] })),
      });
    } catch { refused = true; }
    const held = refused && !project.characters[0].approvedFile;
    return { reached: true, held, reason: held ? "vetoed" : "contested-file-became-canon" };
  },
  reason: "contested-file-became-canon",
  explain: "Ownership must be a property of the target kind. While it was a caller-supplied callback, the caller could pass ok:true — and the 1C audit did.",
});

/* --- CONTROL 4 (MB-1C-04) ------------------------------------------------ */
control({
  label: "D4 an unreceipted legacy pointer projects as approved production media",
  file: "public/shared-production-media.js",
  mutations: [
    /* Layer 1: the downgrade itself. Layer 2: the human-decision half, which
       would otherwise still report "undecided" and cover the first. */
    ['    const disposition = claimedApproved && !receiptBacked\n      ? { ...claimed, role: "historic" }\n      : claimed;',
     '    const disposition = claimed;'],
    ['      humanDecision: humanDecisionOf(row, receiptBacked, input.automationApproval),',
     '      humanDecision: humanDecisionOf(row, claimedApproved, input.automationApproval),'],
  ],
  baseline(media) {
    /* OUTSIDE the control's judgement: the projection must produce a record for
       this fixture at all, or the probe measures an empty list. */
    const built = media.productionMediaRecords({ project: legacyPointerProject(), scan: legacyPointerScan(), jobs: [], jobsAvailable: true });
    assert.strictEqual(built.records.length, 1, "baseline: the fixture must produce exactly one media record");
    assert.strictEqual(built.records[0].disposition.authority.claimed, true,
      "baseline: and an approval EDGE must point at it, or there is no claim to check");
  },
  probe(media) {
    /* THE 1C AUDIT'S FIXTURE: a raw winner, and productionAuthority null. */
    const built = media.productionMediaRecords({ project: legacyPointerProject(), scan: legacyPointerScan(), jobs: [], jobsAvailable: true });
    const row = built.records[0];
    const role = String(row.disposition.role || "");
    const decision = String(row.humanDecision.state || "");
    const held = role !== "approved" && decision !== "approved" && built.counts.approved === 0;
    return { reached: true, held, reason: held ? "historic" : `projected-as-${role}/${decision}` };
  },
  reason: "projected-as-approved/approved",
  explain: "Results filtered it as APPROVED and the Inspector printed \"Approved by you — it is production canon\" for a project with no ledger at all.",
});

/* --- CONTROL 5 (MB-1C-05) ------------------------------------------------ */
control({
  label: "D5 receipt/live-edge agreement is disjunctive again",
  file: KERNEL_FILE,
  mutations: [
    ['  if (live.value !== kernelText(receipt.value)) return null;', '  if (false) return null;'],
  ],
  baseline(kernel) {
    installEdges(kernel);
    const project = { ...frameProject("PICK.png"), productionAuthority: ledger(goodReceipt()) };
    assert.ok(kernel.hasCurrentHumanAuthority(project, FRAME_TARGET),
      "baseline: an exactly-agreeing receipt and edge must confer authority, or the probe measures nothing");
  },
  probe(kernel) {
    installEdges(kernel);
    /* The 1C audit's case: the receipt names bytes the project does not have.
       Under `byName || byIdentity` this stayed current whenever the other half
       happened to match. */
    const project = { ...frameProject("PICK.png"), productionAuthority: ledger(goodReceipt({ value: "WRONG.png" })) };
    const held = !kernel.hasCurrentHumanAuthority(project, FRAME_TARGET);
    return { reached: true, held, reason: held ? "rejected-contradiction" : "contradictory-receipt-stayed-current" };
  },
  reason: "contradictory-receipt-stayed-current",
  explain: "One contradictory field is a contradiction, not a half-match to be rounded up. A rename has its own explicit operation.",
});

/* --- CONTROL 5b: the ledger version, which 1C carried but never checked. --- */
control({
  label: "D5b an unsupported ledger version is still trusted",
  file: KERNEL_FILE,
  mutations: [
    ['  if (declaredVersion > AUTHORITY_LEDGER_VERSION || declaredVersion < 1) {', '  if (false) {'],
  ],
  baseline(kernel) {
    installEdges(kernel);
    const project = { ...frameProject("PICK.png"), productionAuthority: ledger(goodReceipt()) };
    assert.ok(kernel.hasCurrentHumanAuthority(project, FRAME_TARGET), "baseline: a version-1 ledger reads normally");
  },
  probe(kernel) {
    installEdges(kernel);
    const project = { ...frameProject("PICK.png"), productionAuthority: { version: 99, receipts: [goodReceipt()] } };
    const held = !kernel.hasCurrentHumanAuthority(project, FRAME_TARGET);
    return { reached: true, held, reason: held ? "fails-closed" : "read-a-ledger-it-does-not-understand" };
  },
  reason: "read-a-ledger-it-does-not-understand",
  explain: "A version field that is written and never checked is decorative. Either it means something or it should not be there.",
});

/* --- CONTROL 6 (MB-1C-06) ------------------------------------------------ */
control({
  label: "D6 reparenting comes back as a deletion policy",
  file: LINEAGE_FILE,
  mutations: [
    /* Layer 1: the policy list. Layer 2: the refusal that would otherwise still
       stop it. Both, because either alone leaves the other covering. */
    ['const LINEAGE_DELETION_POLICIES = ["refuse"];', 'const LINEAGE_DELETION_POLICIES = ["refuse", "reparent-to-root"];'],
    ['  if (asked && asked !== policy) return { remove: false, reason: "unsupported-deletion-policy", policy, asked };',
     '  const policyAsked = asked === "reparent-to-root" ? asked : policy;'],
    ['  if (children.length) return { remove: false, reason: "has-children", policy, children };',
     '  if (children.length && policyAsked !== "reparent-to-root") return { remove: false, reason: "has-children", policy, children };\n'
     + '  if (children.length) { const rootId = (rows.find((row) => row.isDefault === true) || {}).id; for (const row of rows) if (row.parentStateId === id) row.parentStateId = rootId; }'],
  ],
  baseline(lineage) {
    assert.strictEqual(lineage.planStateDeletion(VALID_STATES(), "grand").remove, true,
      "baseline: a leaf CAN be deleted, or this control would pass because deletion is broken generally");
  },
  probe(lineage) {
    const collection = VALID_STATES();
    const outcome = lineage.applyStateDeletion(collection, "child", { policy: "reparent-to-root" });
    const grand = collection.find((row) => row && row.id === "grand") || {};
    /* The 1C audit's exact observation: child removed, grand re-rooted. */
    const reparented = outcome.applied === true || grand.parentStateId === "root";
    return { reached: true, held: !reparented, reason: reparented ? "rewrote-an-ancestry" : "refused" };
  },
  reason: "rewrote-an-ancestry",
  explain: "An ancestry chosen at creation and rewritten by a delete confirmation was never immutable. The 1C creator UI invoked exactly this policy.",
});

/* --- CONTROL 7 (MB-1C-07) ------------------------------------------------ */
control({
  label: "D7 a caller callback can mutate live project state during a failed write",
  file: KERNEL_FILE,
  mutations: [
    /* Put the 1C callback seam back: honour a caller-supplied applyEdge, against
       the LIVE project, before the transaction can refuse. */
    ['  const draft = draftOf(project);\n  /* STEP 5 — the edge, written by the kernel',
     '  const draft = draftOf(project);\n  if (typeof it.applyEdge === "function") { try { it.applyEdge(project, target); } catch (error) { throw error; } }\n  /* STEP 5 — the edge, written by the kernel'],
  ],
  baseline(kernel) {
    installEdges(kernel);
    const harness = gestureSource(kernel);
    const project = frameProject();
    const token = harness.gesture(() => kernel.beginManualAuthorityAction({ via: "baseline", targets: [FRAME_TARGET] }));
    kernel.commitAuthorityTransaction(project, {
      kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "OK.png", at: "T", manualAction: token,
    });
    assert.strictEqual(project.shots[0].keyframes[0].winner, "OK.png", "baseline: an ordinary commit lands");
  },
  probe(kernel) {
    installEdges(kernel);
    const harness = gestureSource(kernel);
    const project = frameProject();
    project.shots[0].keyframes[0].winner = "ORIGINAL.png";
    const before = JSON.stringify(project);
    const token = harness.gesture(() => kernel.beginManualAuthorityAction({ via: "probe", targets: [FRAME_TARGET] }));
    try {
      kernel.commitAuthorityTransaction(project, {
        kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", value: "NEW.png", at: "T", manualAction: token,
        /* The 1C audit's callback: it closes over the live project, writes, and
           throws. The command refused and the mutation stayed. */
        applyEdge: () => { project.shots[0].keyframes[0].winner = "MUTATED-BY-CLOSURE"; throw new Error("edge failed"); },
      });
    } catch { /* a refusal is fine; WHETHER THE LIVE DOCUMENT MOVED is the question */ }
    const winner = String(project.shots[0].keyframes[0].winner || "");
    /* Held means: either the write succeeded normally (the callback was ignored
       entirely, which is the 1D behaviour) or it refused and left the document
       untouched. What must NEVER be true is the closure's value surviving. */
    const held = winner !== "MUTATED-BY-CLOSURE";
    return { reached: true, held, reason: held ? "callback-ignored" : `live-mutated(${winner})`, before };
  },
  reason: "live-mutated(MUTATED-BY-CLOSURE)",
  explain: "JavaScript cannot stop a closure reaching what it closed over. The only way the boundary can be real is for the kernel to run no caller code at all.",
});

/* ===========================================================================
   THE HARNESS ITSELF.
   =========================================================================== */

/* The rule the re-audit rejected must not come back. */
{
  const own = fs.readFileSync(__filename, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/catch\s*\([^)]*\)\s*\{[^}]*failed\s*=\s*true/.test(own),
    "no control may treat a caught error as success — that is the rule the Batch 1B harness was built on");
  assert.ok(!/instanceof assert\.AssertionError/.test(own),
    "and no control may branch on the TYPE of a thrown error to decide whether it fired");
  controls += 0;
}

Promise.all(pending).then(() => {
  console.log([
    `Dogfood #2 trust-kernel negative controls: ${controls} controls exercised.`,
    "Each held under the real implementation, was confirmed mutated, reached its checkpoint, and failed for its own named reason.",
    ...notes,
  ].join("\n"));
}).catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });
