/* THE ELEVEN BATCH 1D COUNTEREXAMPLES, AS REGRESSIONS — through the real
 * product surfaces, not through the kernel's front door.
 *
 * tests/production-authority.js asserts the six-sentence model against the
 * modules. This file asserts it against the SCREENS, because every one of the
 * findings below was reproduced by an independent audit driving shipped
 * application paths while the module-level suites were green:
 *
 *    1  a later Promise microtask using the same trusted-event window
 *    2  a target-only approval turning DISPLAYED.png/asset-A into CHANGED.png/asset-B
 *    3  replacing the exported ownership policy and approving contested bytes
 *    4  replacing the writer/committer and mutating live state
 *    5  a supporting coverage slot appearing under the Approved Library
 *    6  an unreceipted LEGACY.png becoming identity-authority
 *    7  a supporting SIDE.png becoming approved-view
 *    8  a receipt asset present while the live asset disappears
 *    9  a delivery receipt unable to compare live asset identity
 *   10  video revocation leaving approvedMotionFile behind
 *   11  opening the entity automation modal creating continuity state
 *
 * 8, 9 and 10 are module-level facts and are asserted in the suite above; the
 * rest need a rendered page, a real DOM double and the real fetch boundary.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. The coverage dispatch is observed at a
 * local fetch double; no request leaves the process.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture, withCanon } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

const TINY = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3C/svg%3E";

/* --------------------------------------------------------------------------
   A shot fixture whose opening frame has two real candidates, so an approval
   modal has something to display and something else to change to. */
function shotFixture() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.id = "SH-DF2";
  shot.winner = "";
  shot.keyframes = [{ id: "fr-a", label: "Opening" }];
  shot.clips = [];
  shot.creationBrief = {};
  project.shots = [shot];
  return project;
}
const shotScan = () => ({
  anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
  shots: { "SH-DF2": { takes: [
    { name: "DISPLAYED.png", url: TINY, assetId: "asset-A" },
    { name: "CHANGED.png", url: TINY, assetId: "asset-B" },
  ], locked: [] } },
});

/* --------------------------------------------------------------------------
   An entity with a raw legacy pointer, one selected supporting view, and no
   receipt anywhere — the shape of every pre-receipt dogfood project. */
function legacyEntityFixture() {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-LEG";
  character.name = "Legacy";
  character.prefix = "CHAR-LEG";
  character.approvedFile = "CHAR-LEG-LEGACY.png";
  character.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "CHAR-LEG-LEGACY.png" }];
  character.coverageSlots = [
    { id: "front", label: "Front", requirement: "required", selectedFile: "CHAR-LEG-SIDE.png", status: "selected", assignment: { authoritative: false } },
    { id: "profile", label: "Profile", requirement: "required", selectedFile: "", status: "missing" },
  ];
  character.expressionSlots = [];
  character.candidateFiles = [
    { stored: "CHAR-LEG-LEGACY.png", decision: "unreviewed" },
    { stored: "CHAR-LEG-SIDE.png", decision: "selected-coverage" },
  ];
  project.characters = [character];
  project.shots[0].characters = [character.id];
  return project;
}
const legacyScan = () => ({
  anchors: [
    { name: "CHAR-LEG-LEGACY.png", url: TINY, assetId: "asset-L" },
    { name: "CHAR-LEG-SIDE.png", url: TINY, assetId: "asset-S" },
  ],
  plates: [], props: [], vehicles: [], audio: [], media: [], shots: {},
});

async function main() {
  /* =========================================================================
     COUNTEREXAMPLE 1 — a Promise continuation of a trusted event.

     THE MECHANISM, WHERE IT CAN BE TESTED. The harness has a window and sets
     `window.event` around its dispatch exactly as a user agent does, so the
     kernel takes the same path here as it does in Chromium. The Node-only twin
     in tests/production-authority.js proves the consequence but cannot reach
     this code, which is why both exist. */
  {
    const project = shotFixture();
    const rendered = await render("#/shot/SH-DF2", project, { scan: shotScan() });
    const outcome = { insideDispatch: "", microtask: "" };
    /* The attempt runs IN PAGE SCOPE, which is where the audit stood and where
       the kernel actually lives. */
    vm.runInContext(`window.__attemptCanon = () => {
      try { approveFrameCanon(P, { shotId: "SH-DF2", frameId: "fr-a", value: "DISPLAYED.png", assetId: "asset-A", at: "T" }); return "WROTE-CANON"; }
      catch (error) { return error.code || error.message; }
    };`, rendered.context);
    const attempt = () => rendered.context.__attemptCanon();
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    rendered.gesture.act(() => {
      outcome.insideDispatch = attempt();
      Promise.resolve().then(() => { outcome.microtask = attempt(); resolveDone(); });
    });
    await done;
    eq(outcome.insideDispatch, "WROTE-CANON", "the creator's own click writes canon — the guard must not break the product");
    eq(outcome.microtask, "MANUAL_ACTION_REQUIRED",
      "a Promise continuation of that same trusted event may not write canon");
    const receipts = vm.runInContext(`(P.productionAuthority?.receipts || []).length`, rendered.context);
    eq(receipts, 1, "exactly one decision was recorded — the one a person made");
  }

  /* =========================================================================
     COUNTEREXAMPLE 2 — DISPLAYED.png / asset-A cannot become CHANGED.png /
     asset-B.

     Batch 1D minted a target-only capability in the modal prologue, awaited a
     rename, and committed whatever came back. There is no capability now: the
     approval modal commits synchronously against the bytes it is displaying,
     and the rename that follows moves the receipt with them. */
  {
    const project = shotFixture();
    let renamed = null;
    const rendered = await render("#/shot/SH-DF2", project, {
      scan: shotScan(),
      fetch: async (url, options, respond) => {
        if (url === "/api/media/rename") {
          renamed = JSON.parse(options.body || "{}");
          return respond({ ok: true, name: "SH-DF2_A_001.png", assetId: "asset-A" });
        }
        if (url === "/api/scan") return respond(shotScan());
        return null;
      },
    });
    rendered.context.approveTake("SH-DF2", "DISPLAYED.png");
    rendered.context.document.getElementById("approve-target").value = "shot";
    rendered.context.document.getElementById("approve-name").value = "SH-DF2_A_001.png";
    await rendered.gesture.act(() => rendered.context.confirmApproveTake());
    const state = vm.runInContext(`(() => {
      const s = P.shots[0];
      const receipt = (P.productionAuthority?.receipts || [])[0] || {};
      return { winner: s.winner, assetId: s.winnerAssetId || "", value: receipt.value, receiptAsset: receipt.assetId, count: (P.productionAuthority?.receipts || []).length };
    })()`, rendered.context);
    ok(renamed, "the modal still performs the rename the creator asked for");
    eq(state.count, 1, "one approval, one receipt");
    eq(state.value, "SH-DF2_A_001.png", "the receipt follows the bytes through the rename");
    eq(state.receiptAsset, "asset-A", "and still names the exact bytes the creator was looking at");
    eq(state.winner, "SH-DF2_A_001.png", "the edge agrees");
    ok(state.value !== "CHANGED.png" && state.receiptAsset !== "asset-B",
      "and nothing turned the displayed decision into a different one");
  }

  /* The approval modal has NO capability to mint, and the source says so. A
     capability minted before an await is the shape this pass deleted; a grep is
     the cheapest way to keep it deleted. */
  {
    const tools = read("public/library-tools.js");
    const studio = read("public/creation-studio.js");
    const automation = read("public/automation.js");
    const provenance = read("public/review-provenance.js");
    const review = read("public/review.js");
    for (const [name, source] of Object.entries({ "library-tools.js": tools, "creation-studio.js": studio, "automation.js": automation, "review-provenance.js": provenance, "review.js": review })) {
      ok(!/beginManualApproval/.test(source), `${name} must not mint a human capability`);
      ok(!/write(Frame|Motion|Delivery|EntityState)ProductionAuthority/.test(source), `${name} must not call a generic authority wrapper`);
    }
    /* And every approve*Canon call states the bytes. A call with no `assetId:`
       key is refused at runtime; this catches it at review time. */
    for (const [name, source] of Object.entries({ "library-tools.js": tools, "creation-studio.js": studio, "automation.js": automation, "review-provenance.js": provenance, "review.js": review })) {
      const calls = source.match(/approve(Frame|Motion|Delivery|EntityState)Canon\(P, \{[\s\S]{0,400}?\}\)/g) || [];
      for (const call of calls) ok(/assetId:/.test(call), `${name}: every canon approval must state the bytes — found ${call.slice(0, 90)}`);
    }
  }

  /* =========================================================================
     COUNTEREXAMPLES 3 AND 4 — from inside the page, where the audit stood.

     Ordinary page script tries to replace the ownership policy and the edge
     writer. The names do not exist; assigning them reaches nothing. */
  {
    const project = shotFixture();
    const rendered = await render("#/shot/SH-DF2", project, { scan: shotScan() });
    const probe = vm.runInContext(`(() => {
      const before = {
        kernelInstallers: Object.keys(CineBraidAuthorityKernel).filter((k) => /^install/.test(k)).join(","),
        genericTransaction: typeof CineBraidAuthorityKernel.commitAuthorityTransaction,
        ownershipSetter: typeof useEntityOwnershipResolver,
        slotPolicySetter: typeof installSlotOwnershipPolicy,
      };
      let sideEffect = "";
      /* The exact 1D moves, from page scope. */
      CineBraidAuthorityKernel.installAuthorityOwnershipPolicy = () => true;
      CineBraidAuthorityKernel.installAuthorityEdgeWriter = () => { sideEffect = "MUTATED-LIVE"; P.shots[0].winner = "FORGED.png"; throw new Error("boom"); };
      window.entityOwnershipEligibility = () => ({ ok: true });
      return { before, sideEffect };
    })()`, rendered.context);
    eq(probe.before.kernelInstallers, "installBrowserManualActionSource",
      "the only installer the kernel exposes is the one that says what a human gesture is");
    eq(probe.before.genericTransaction, "undefined", "there is no generic authority transaction to call");
    eq(probe.before.ownershipSetter, "undefined", "and no way to replace the ownership answer");
    eq(probe.before.slotPolicySetter, "undefined", "on the supporting path either");
    /* And with those assignments in place, a real approval still runs the real
       rules against the real edge. */
    rendered.gesture.act(() => vm.runInContext(
      `approveFrameCanon(P, { shotId: "SH-DF2", frameId: "fr-a", value: "DISPLAYED.png", assetId: "asset-A", at: "T" })`,
      rendered.context,
    ));
    const after = vm.runInContext(`({ winner: P.shots[0].winner, receipts: (P.productionAuthority?.receipts || []).length })`, rendered.context);
    eq(after.winner, "DISPLAYED.png", "a replaced writer changes nothing, because nothing reads one");
    eq(after.receipts, 1, "and the real transaction still recorded the real decision");
  }

  /* =========================================================================
     COUNTEREXAMPLE 5 — the Approved Library.

     The audit rendered an entity with NO canon and one selected coverage slot
     and got `class="library-card approved"`, `<span class="library-status
     approved">APPROVED</span>`, "1 approved file", inside a tab whose copy says
     these media currently define production truth. */
  {
    const rendered = await render("#/library/canon", legacyEntityFixture(), { scan: legacyScan() });
    const canonTab = rendered.html;
    ok(!/class="library-card canon"/.test(canonTab), "an entity with no receipt is not in the Canon tab");
    ok(!/>APPROVED</.test(canonTab), "and the Library does not badge anything APPROVED");
    ok(!/currently define production truth/.test(canonTab), "and does not claim these media define production truth");
    ok(/Nothing is canon yet/.test(canonTab), "it says plainly that nothing is canon yet");

    const all = await render("#/library/all", legacyEntityFixture(), { scan: legacyScan() });
    ok(!/library-status canon/.test(all.html), "no canon badge without a receipt");
    ok(/library-status historic|library-status reference/.test(all.html),
      "the entity is shown, described as historic or reference");
    ok(!/approved file/.test(all.html), "and no count is described as approved files");

    /* And the positive half, so the assertion is not satisfied by an empty
       Library: with a receipt, the same entity IS canon. */
    const approved = legacyEntityFixture();
    withCanon(approved, {
      kind: "entity-state", list: "characters", entityId: "CHAR-LEG", stateId: "state-default",
      value: "CHAR-LEG-LEGACY.png",
    });
    const withReceipt = await render("#/library/canon", approved, { scan: legacyScan() });
    ok(/library-card canon/.test(withReceipt.html), "an entity with a receipt IS in the Canon tab");
    ok(/>CANON</.test(withReceipt.html), "and is badged CANON");
    ok(/canon file/.test(withReceipt.html), "and counted in canon files");
  }

  /* =========================================================================
     COUNTEREXAMPLES 6 AND 7 — the coverage dispatch boundary.

     The audit reached a real submission with a null ledger and observed
     roles ["identity-authority", "approved-view"] and the label "Legacy primary
     approved authority". */
  {
    /* 6 — with no receipt there is no identity input, so there is nothing to
       submit. The refusal is the product's own, and it names the fix. */
    const said = [];
    const noCanon = await render("#/character/CHAR-LEG", legacyEntityFixture(), {
      scan: legacyScan(),
      storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-LEG": "coverage" },
      fetch: async (url, options, respond) => {
        if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, defaults: {} });
        if (url === "/api/generation/fal/jobs") { said.push("SUBMITTED"); return respond({ ok: true, job: { id: "j" } }); }
        return null;
      },
    });
    noCanon.context.toast = (message) => said.push(String(message));
    vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'t'};pollFalGeneration=()=>{};`, noCanon.context);
    await noCanon.context.generateCoverageSlot("characters", "CHAR-LEG", "profile");
    ok(!said.includes("SUBMITTED"), "an unreceipted pointer is not identity authority, so nothing is dispatched");
    ok(said.some((line) => /Approve the primary reference first/i.test(line)),
      "and the creator is told exactly what would make it canon");
    /* The projection agrees, which is what every other surface reads. */
    const truth = vm.runInContext(`entityProductionTruth(P, "characters", "CHAR-LEG")`, noCanon.context);
    eq(truth.canon.length, 0, "the projection reports no canon");
    eq(truth.historic.map((row) => row.value).join(","), "CHAR-LEG-LEGACY.png", "and reports the pointer as historic");
    eq(truth.references.map((row) => row.value).join(","), "CHAR-LEG-SIDE.png", "and the slot as a reference");

    /* 7 — with a receipt, the package goes out, and every role names a purpose.
       The primary is canon; SIDE.png is a supporting view and says so. */
    const approved = legacyEntityFixture();
    /* A real approval stamps the identity on BOTH sides, which is what makes the
       receipt checkable. A fixture that stamped only the receipt would fail
       closed here — correctly — and would be testing the wrong thing. */
    approved.characters[0].approvedAssetId = "asset-L";
    approved.characters[0].continuityStates[0].approvedAssetId = "asset-L";
    withCanon(approved, {
      kind: "entity-state", list: "characters", entityId: "CHAR-LEG", stateId: "state-default",
      value: "CHAR-LEG-LEGACY.png", assetId: "asset-L",
    });
    let submitted = null;
    const canonical = await render("#/character/CHAR-LEG", approved, {
      scan: legacyScan(),
      storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-LEG": "coverage" },
      fetch: async (url, options, respond) => {
        if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, defaults: {} });
        if (url === "/api/generation/fal/jobs" && options.method === "POST") {
          submitted = JSON.parse(options.body);
          return respond({ ok: true, job: { id: "job-1", status: "IN_QUEUE" } });
        }
        return null;
      },
    });
    vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'t'};pollFalGeneration=()=>{};`, canonical.context);
    await canonical.context.generateCoverageSlot("characters", "CHAR-LEG", "profile");
    ok(submitted, "with canon established, coverage generation submits");
    const roles = submitted.references.map((ref) => ref.role);
    const labels = submitted.references.map((ref) => ref.label);
    const sources = submitted.references.map((ref) => ref.sourceFile);
    eq(roles[0], "identity-canon", "the receipt-backed primary is the canon identity");
    ok(roles.slice(1).every((role) => role === "supporting-view" || role === "expression-reference" || role === "environment-reference"),
      `every other role names a purpose — got ${JSON.stringify(roles)}`);
    ok(!roles.includes("identity-authority"), "no role called identity-authority survives");
    ok(!roles.includes("approved-view"), "and none called approved-view");
    ok(labels.every((label) => !/approved authority/i.test(label)),
      `no reference is labelled approved authority — got ${JSON.stringify(labels)}`);
    ok(sources.includes("CHAR-LEG-SIDE.png"), "the supporting view still travels — it is useful context");
    ok(!("authorityManifest" in submitted), "the package is not called an authority manifest");
    ok(Array.isArray(submitted.referenceManifest), "it is a reference manifest");
    ok(!/approved authority package/i.test(submitted.prompt), "and the prompt does not call it an approved authority package");
  }

  /* =========================================================================
     COUNTEREXAMPLE 11 — opening the entity automation modal.

     With a synthetic entity carrying only id, name and a pointer, merely opening
     the default-reference planner produced a continuityStates array, a
     state-default, generationMode, prompt fields and a build array. */
  {
    const project = buildFixture();
    const scan = { anchors: [{ name: "CHAR-BARE-A.png", url: TINY }], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} };
    const rendered = await render("#/library/all", project, { scan });
    /* THE ENTITY IS ADDED AFTER LOAD, ON PURPOSE. Normalization is CineBraid's
       named, deliberate mutation and it runs when a project is opened, so an
       entity that was in the file already has its default state by the time any
       screen sees it — and asserting on one would prove nothing. A reference the
       creator adds DURING the session has not been normalized, and opening a
       planner on it is exactly the reachable path the audit walked. */
    vm.runInContext(`P.characters.push({ id: "CHAR-BARE", name: "Bare", prefix: "CHAR-BARE", approvedFile: "CHAR-BARE-A.png" })`, rendered.context);
    const before = vm.runInContext(`JSON.stringify(P.characters.find((x) => x.id === "CHAR-BARE"))`, rendered.context);
    ok(!/continuityStates/.test(before), "the added reference has no state structure yet — which is what makes this measurable");
    const beforeProject = vm.runInContext(`JSON.stringify(P)`, rendered.context);
    for (const opener of [
      `openAssetAutomationModal("characters","CHAR-BARE")`,
      `openEntityChainAutomationModal("characters","CHAR-BARE")`,
      `v627EntityPreflight("characters", P.characters.find((x) => x.id === "CHAR-BARE"), ["state-default"])`,
    ]) {
      vm.runInContext(opener, rendered.context);
      const after = vm.runInContext(`JSON.stringify(P.characters.find((x) => x.id === "CHAR-BARE"))`, rendered.context);
      eq(after, before, `${opener.split("(")[0]} must not change the entity`);
    }
    eq(vm.runInContext(`JSON.stringify(P)`, rendered.context), beforeProject,
      "and opening a planner must not change the project at all");
    /* The preflight still ANSWERS — a pure reader that reported nothing would be
       a different bug. */
    const preflight = vm.runInContext(`v627EntityPreflight("characters", P.characters.find((x) => x.id === "CHAR-BARE"), ["state-default"])`, rendered.context);
    ok(Array.isArray(preflight.errors), "the preflight still reports");
  }


  /* =========================================================================
     CODEX MB-PT-02 §7.1 — THE ENTITY PAGE.
     Codex rendered a prop with a raw pointer and no ledger and got
     "APPROVED IMAGES", "1/1 state has an approved image", an APPROVED row and an
     APPROVED workflow state — while the projection called the same pointer
     Historic. Two truths, one screen. */
  {
    const project = buildFixture();
    const prop = project.props.find((row) => row.id === "PR-TOOL") || project.props[0];
    prop.id = "PR-TOOL";
    prop.approvedFile = "PR-TOOL-PLATE.png";
    prop.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "PR-TOOL-PLATE.png" }];
    prop.coverageSlots = [];
    prop.candidateFiles = [{ stored: "PR-TOOL-PLATE.png", decision: "unreviewed" }];
    project.props = [prop];
    delete project.productionAuthority;
    const scan = { anchors: [], plates: [], vehicles: [], audio: [], media: [], shots: {}, props: [{ name: "PR-TOOL-PLATE.png", url: TINY }] };
    const rendered = await render("#/prop/PR-TOOL", project, { scan, storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "approved" } });
    const truth = vm.runInContext('entityProductionTruth(P, "props", "PR-TOOL")', rendered.context);
    eq(truth.canon.length, 0, "the projection reports no canon for an unreceipted pointer");
    eq(truth.historic.map((row) => row.value).join(","), "PR-TOOL-PLATE.png", "and reports the plate as historic");
    const html = rendered.html;
    ok(!/APPROVED IMAGES/.test(html), "the summary must not be headlined APPROVED IMAGES");
    ok(/CANON IMAGES/.test(html), "it is headlined CANON IMAGES");
    ok(/<strong>0\/1<\/strong>/.test(html), "and counts zero of one — a pointer is not a canon state");
    ok(!/<strong>1\/1<\/strong>/.test(html), "never one of one");
    ok(/Historic/.test(html), "the pointer is presented as historic");
    ok(/PR-TOOL-PLATE\.png/.test(html), "while still being shown — historic evidence stays visible and re-approvable");
  }

  /* =========================================================================
     CODEX MB-PT-02 §7.2 — THE GENERATION PARENT.
     An unreceipted parent went out as `role: "base"` labelled
     "Default approved reference". It may travel as context; it may not be named
     or ranked as an approved base. */
  {
    const project = buildFixture();
    const prop = project.props.find((row) => row.id === "PR-TOOL") || project.props[0];
    prop.id = "PR-TOOL";
    prop.approvedFile = "PR-TOOL-PLATE.png";
    prop.continuityStates = [
      { id: "state-default", name: "Default", isDefault: true, approvedFile: "PR-TOOL-PLATE.png" },
      { id: "state-worn", name: "Worn", isDefault: false, parentStateId: "state-default", approvedFile: "", notes: "Scratched.", generationMode: "derive" },
    ];
    project.props = [prop];
    delete project.productionAuthority;
    const scan = { anchors: [], plates: [], vehicles: [], audio: [], media: [], shots: {}, props: [{ name: "PR-TOOL-PLATE.png", url: TINY }] };
    const rendered = await render("#/prop/PR-TOOL", project, { scan });
    const parsed = JSON.parse(vm.runInContext([
      '(() => {',
      '  const e = P.props.find((row) => row.id === "PR-TOOL");',
      '  const state = e.continuityStates.find((row) => row.id === "state-worn");',
      '  return JSON.stringify(entityGenerationReferences("props", e, { state, mode: "derive" }).map((r) => ({ role: r.role, label: r.label })));',
      '})()',
    ].join("\n"), rendered.context));
    ok(parsed.length > 0, "the historic parent still travels — it is the image the creator has been working from");
    ok(!parsed.some((row) => row.role === "base"), "but an unreceipted parent is never an editable base");
    ok(parsed.some((row) => row.role === "historic-reference"), "it travels under a role that says what it is");
    ok(!parsed.some((row) => /approved reference/i.test(row.label)), "and is never labelled an approved reference");

    /* And the positive half: with a receipt, the same parent IS the base. */
    const approved = JSON.parse(JSON.stringify(project));
    withCanon(approved, { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" });
    const withReceipt = await render("#/prop/PR-TOOL", approved, { scan });
    const canonRefs = JSON.parse(vm.runInContext([
      '(() => {',
      '  const e = P.props.find((row) => row.id === "PR-TOOL");',
      '  const state = e.continuityStates.find((row) => row.id === "state-worn");',
      '  return JSON.stringify(entityGenerationReferences("props", e, { state, mode: "derive" }).map((r) => ({ role: r.role, label: r.label })));',
      '})()',
    ].join("\n"), withReceipt.context));
    ok(canonRefs.some((row) => row.role === "base"), "an approved parent IS the editable base");
    ok(canonRefs.some((row) => /canon reference/i.test(row.label)), "and is labelled canon");
  }

  /* =========================================================================
     CODEX MB-PT-03 — OPENING THE STATE-VARIANT FLOW WRITES NOTHING.
     Codex stored a child state as `generationMode: "independent"`, opened the
     ordinary flow, and watched it become "derive" and the project change. */
  {
    const project = buildFixture();
    const prop = project.props.find((row) => row.id === "PR-TOOL") || project.props[0];
    prop.id = "PR-TOOL";
    prop.approvedFile = "PR-TOOL-PLATE.png";
    prop.continuityStates = [
      { id: "state-default", name: "Default", isDefault: true, approvedFile: "PR-TOOL-PLATE.png" },
      { id: "state-worn", name: "Worn", isDefault: false, parentStateId: "state-default", approvedFile: "", notes: "Scratched.", generationMode: "independent" },
    ];
    project.props = [prop];
    const scan = { anchors: [], plates: [], vehicles: [], audio: [], media: [], shots: {}, props: [{ name: "PR-TOOL-PLATE.png", url: TINY }] };
    const rendered = await render("#/prop/PR-TOOL", project, { scan });
    const before = vm.runInContext("JSON.stringify(P)", rendered.context);
    eq(vm.runInContext('P.props[0].continuityStates.find((r) => r.id === "state-worn").generationMode', rendered.context),
      "independent", "the creator deliberately marked this state independent");
    vm.runInContext('openContinuityStateVariantHub("props","PR-TOOL")', rendered.context);
    vm.runInContext('openContinuityStateVariant("props","PR-TOOL","state-worn")', rendered.context);
    eq(vm.runInContext('P.props[0].continuityStates.find((r) => r.id === "state-worn").generationMode', rendered.context),
      "independent", "opening the variant flow must not switch it back to derive");
    eq(vm.runInContext("JSON.stringify(P)", rendered.context), before,
      "and inspecting or cancelling the flow leaves the project byte-identical");
  }

  /* =========================================================================
     CODEX MB-PT-04 — A GHOST PARENT RESOLVES TO NOTHING AND BLOCKS.
     Codex stored `parentStateId: "ghost"`, watched validation report
     `parent-missing`, and watched `assetStateParent()` hand back `state-default`
     anyway — an operational reparent of an immutable state. */
  {
    const project = buildFixture();
    const prop = project.props.find((row) => row.id === "PR-TOOL") || project.props[0];
    prop.id = "PR-TOOL";
    prop.approvedFile = "PR-TOOL-PLATE.png";
    prop.continuityStates = [
      { id: "state-default", name: "Default", isDefault: true, approvedFile: "PR-TOOL-PLATE.png" },
      { id: "state-ghosted", name: "Ghosted", isDefault: false, parentStateId: "ghost", approvedFile: "", notes: "Scratched.", generationMode: "derive" },
    ];
    project.props = [prop];
    const scan = { anchors: [], plates: [], vehicles: [], audio: [], media: [], shots: {}, props: [{ name: "PR-TOOL-PLATE.png", url: TINY }] };
    const rendered = await render("#/prop/PR-TOOL", project, { scan });
    const probe = JSON.parse(vm.runInContext([
      '(() => {',
      '  const e = P.props.find((row) => row.id === "PR-TOOL");',
      '  const state = e.continuityStates.find((row) => row.id === "state-ghosted");',
      '  return JSON.stringify({',
      '    storedParent: state.parentStateId,',
      '    resolved: (assetStateParent(e, state) || {}).id || "",',
      '    preflight: v627EntityPreflight("props", e, ["state-ghosted"]).errors,',
      '  });',
      '})()',
    ].join("\n"), rendered.context));
    eq(probe.storedParent, "ghost", "the durable record names a parent that does not exist");
    eq(probe.resolved, "", "and it resolves to NOTHING — no default, no other state, no substitute");
    ok(probe.preflight.some((line) => /no valid parent/i.test(line)),
      `preflight must block on the broken lineage — got ${JSON.stringify(probe.preflight)}`);
  }

  console.log(`Dogfood #2 counterexample regressions passed ${checks} checks across all eleven Batch 1D findings and the four Codex acceptance reproductions. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
