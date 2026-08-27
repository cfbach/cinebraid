/* NEGATIVE CONTROLS FOR THE REFERENCE TRUTH + SHEET GATE.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested.
 *
 * Each control below breaks ONE mechanism this slice added, IN MEMORY, executes
 * the real unsafe path against the broken module, and requires the named bad
 * state to appear. The contract is the one tests/dogfood2-p0-negative-controls.js
 * established, and all seven conditions are enforced by control()/controlAsync():
 *
 *   1. the baseline runs outside any catch-as-success region
 *   2. the mutation is CONFIRMED to have changed the shipped source
 *   3. the probe reaches its checkpoint under BOTH modules
 *   4. the invariant FAILS under the mutated module
 *   5. the failure is the NAMED one — an arbitrary AssertionError is not a pass
 *   6. an unrelated throw fails the suite loudly
 *   7. the invariant HOLDS under the real module
 *
 * IN MEMORY, ALWAYS. Nothing in the working tree is written, so no control can be
 * "restored" by a checkout that would also discard real work.
 *
 * NO PROJECT DATA IS TOUCHED, AND NO PROVIDER OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const source = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const { render, buildFixture, withCanon } = require("./render-harness");
const { installTestManualActionSource } = require("./authority-test-gesture.js");

let controls = 0;
const notes = [];

/* LINE ENDINGS ARE NOT PART OF AN ANCHOR. `core.autocrlf=true` checks these files
   out with CRLF, so a multi-line anchor written as LF matches ZERO times on a
   normal Windows clone — a loud, accurate-sounding failure about nothing. */
const toLF = (text) => String(text).split("\r\n").join("\n");

/* THE PROBE RECEIPT. A plain Error, never an assertion: a control whose anchor
   has moved must fail the suite loudly rather than be mistaken for a firing. */
function mutate(text, needle, replacement, label, expected = 1) {
  const body = toLF(text);
  const anchor = toLF(needle);
  const hits = body.split(anchor).length - 1;
  if (hits !== expected) {
    throw new Error(`probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.");
  }
  return body.split(anchor).join(toLF(replacement));
}

/* THE PROBE'S OWN PROBE — both failure modes of mutate() pinned, not assumed. */
(function proveTheProbe() {
  const LF = ["  const a = one();", "  return a;", ""].join("\n");
  const CRLF = LF.split("\n").join("\r\n");
  const ANCHOR = ["  const a = one();", "  return a;"].join("\n");
  const ABSENT = ["  const a = two();", "  return a;"].join("\n");
  for (const [name, text] of [["LF", LF], ["CRLF", CRLF]]) {
    const out = mutate(text, ANCHOR, "  const a = BROKEN;\n  return a;", `self-check ${name}`);
    assert(out.includes("BROKEN"), `mutate() did not apply a multi-line anchor to ${name} source`);
    assert(!out.includes("\r"), `mutate() left carriage returns in ${name} source`);
    assert.throws(() => mutate(text, ABSENT, "x", `self-check absent ${name}`),
      /probe receipt: self-check absent/, `mutate() accepted an absent anchor in ${name} source`);
  }
})();

const KERNEL_FILE = "public/shared-authority-kernel.js";
const COVERAGE_FILE = "public/shared-coverage.js";
const AT = "2026-08-27T00:00:00.000Z";

/* Rebuild one module from (possibly mutated) source, in its own realm, resolving
   its siblings the way the module itself does. */
function build(relPath, text, blindTo = "") {
  const moduleObject = { exports: {} };
  const abs = path.join(ROOT, relPath);
  const resolve = require("module").createRequire(abs);
  /* `blindTo` removes ONE sibling from the composition, which is how the
     "resolver unavailable" arm is reached without editing the module that
     provides it. */
  const sandboxRequire = (specifier) => {
    if (blindTo && String(specifier).includes(blindTo)) throw new Error(`${blindTo} unavailable in this composition`);
    return resolve(specifier);
  };
  vm.runInNewContext(text ?? source(relPath),
    { module: moduleObject, exports: moduleObject.exports, require: sandboxRequire, console, structuredClone, globalThis: {} },
    { filename: relPath });
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

function control(spec) {
  const { label, file, baseline, probe, reason, explain } = spec;
  controls += 1;
  const blindTo = spec.blindTo || "";
  if (typeof baseline === "function") baseline(build(file, null, blindTo));
  const real = probe(build(file, null, blindTo));
  assert.ok(real && real.reached === true,
    `${label}: the probe did not reach its checkpoint against the REAL module, so it proves nothing about the mutated one`);
  assert.strictEqual(real.held, true,
    `${label}: the invariant does not hold in the shipped implementation, so this control describes a property that does not exist`);
  const after = probe(build(file, applyMutations(spec), blindTo));
  assert.ok(after && after.reached === true,
    `${label}: the probe did not reach its checkpoint against the MUTATED module — the break stopped execution instead of changing behaviour`);
  assert.strictEqual(after.held, false, `${label}: the invariant SURVIVED the break. ${explain}`);
  if (reason !== undefined) {
    assert.strictEqual(after.reason, reason,
      `${label}: the invariant failed, but not in the way this control describes (expected ${JSON.stringify(reason)}, got ${JSON.stringify(after.reason)})`);
  }
  notes.push(`  ${label} — held under the real module, failed as ${JSON.stringify(after.reason)} under the mutation`);
}

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
    if (reason !== undefined) assert.strictEqual(after.reason, reason,
      `${label}: failed for the wrong reason (expected ${JSON.stringify(reason)}, got ${JSON.stringify(after.reason)})`);
    notes.push(`  ${label} — held under the real page, failed as ${JSON.stringify(after.reason)} under the mutation`);
  })());
}

/* ---------------------------------------------------------------------------
   Shared fixtures. */

const sheetProject = () => ({
  characters: [{
    id: "CHAR-A", prefix: "CHAR-A",
    candidateFiles: [{ stored: "CHAR-A-CANDIDATE-M9X-01.png", coverageJobType: "sheet", coverageSheetType: "angles" }],
    continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }],
  }],
});

function approveSheet(kernel, project) {
  const manual = installTestManualActionSource(kernel);
  try {
    manual.gesture(() => kernel.approveEntityStateCanon(project, {
      list: "characters", entityId: "CHAR-A", stateId: "state-default",
      value: "CHAR-A-CANDIDATE-M9X-01.png", assetId: "", at: AT,
    }));
    return true;
  } catch { return false; }
}

/* ===========================================================================
   C1 — THE ARTIFACT ELIGIBILITY GATE.

   Make the artifact veto answer yes and a coverage sheet becomes the character's
   identity, which is the defect the whole slice exists to close. */
control({
  label: "C1 the artifact eligibility gate",
  file: KERNEL_FILE,
  anchor: "    kernelObject(entityArtifactVerdict(project, target, value)),",
  replacement: "    { ok: true },",
  baseline: (kernel) => {
    const project = sheetProject();
    assert.strictEqual(approveSheet(kernel, project), false,
      "baseline: a declared coverage sheet must be refused, or this control measures nothing");
  },
  probe: (kernel) => {
    const project = sheetProject();
    const wrote = approveSheet(kernel, project);
    const canon = kernel.entityProductionTruth(project, "characters", "CHAR-A").canon;
    return {
      reached: true,
      held: !wrote && canon.length === 0,
      reason: wrote ? `sheet-became-entity-primary(${canon.map((row) => row.value).join(",") || "no-canon"})` : "refused",
    };
  },
  reason: "sheet-became-entity-primary(CHAR-A-CANDIDATE-M9X-01.png)",
  explain: "A gate the kernel can be talked out of is a UI suggestion, not a boundary.",
});

/* ===========================================================================
   C2 — AN UNANSWERABLE QUESTION IS A REFUSAL.

   Built in a realm where public/shared-coverage.js cannot resolve, so the
   kernel genuinely cannot ask what the artifact is. Shipped, that refuses.
   Mutated so the unavailable arm answers `ok: true`, a composition missing its
   structural reader silently grants identity authority to anything at all. */
control({
  label: "C2 fail-closed when the classifier is unavailable",
  file: KERNEL_FILE,
  blindTo: "shared-coverage",
  anchor: '      code: "AUTHORITY_ARTIFACT_CLASSIFIER_UNAVAILABLE",',
  replacement: '      ok: true, code: "AUTHORITY_ARTIFACT_CLASSIFIER_UNAVAILABLE",',
  baseline: (kernel) => {
    const project = sheetProject();
    assert.strictEqual(approveSheet(kernel, project), false,
      "baseline: with no classifier the kernel must refuse, or this control measures nothing");
  },
  probe: (kernel) => {
    const project = sheetProject();
    const wrote = approveSheet(kernel, project);
    return {
      reached: true,
      held: !wrote,
      reason: wrote ? "sheet-became-entity-primary-with-no-classifier" : "refused",
    };
  },
  reason: "sheet-became-entity-primary-with-no-classifier",
  explain: "Unknown must never be rounded up to eligible.",
});

/* ===========================================================================
   C3 — THE STRUCTURAL PRECEDENCE.

   Restore the old `|| !!coverageSheetType` reading and an individually generated
   EXPRESSION candidate — one image of one expression — is classified as a
   multi-panel sheet again, which is what barred it from its own slot. */
control({
  label: "C3 job type outranks board type",
  file: COVERAGE_FILE,
  anchor: '    if (jobType === "sheet") return "sheet";',
  replacement: '    if (jobType === "sheet" || coverageText(row.coverageSheetType)) return "sheet";',
  baseline: (coverage) => {
    assert.strictEqual(coverage.referenceArtifactStructure({ coverageJobType: "slot", coverageSheetType: "expressions" }), "single",
      "baseline: a single expression candidate must read as one view, or this control measures nothing");
  },
  probe: (coverage) => {
    const answer = coverage.referenceArtifactStructure({ coverageJobType: "slot", coverageSheetType: "expressions" });
    return {
      reached: true,
      held: answer === "single",
      reason: answer === "single" ? "single" : `single-expression-candidate-read-as-${answer}`,
    };
  },
  reason: "single-expression-candidate-read-as-sheet",
  explain: "The board a job belongs to is not a description of the artifact it produced.",
});

/* ===========================================================================
   C4 — THE FILENAME MUST NOT BE ABLE TO DECIDE.

   Put the deleted heuristic back and a prop called Bedsheet has every one of its
   single identity images classified as a multi-view sheet — and, with C1's gate
   in force, barred from ever becoming that prop's identity. */
control({
  label: "C4 no filename may classify an artifact",
  file: COVERAGE_FILE,
  anchor: "    if (!jobType && coverageText(row.coverageSheetType)) return \"sheet\";\n    return \"undeclared\";",
  replacement: "    if (!jobType && coverageText(row.coverageSheetType)) return \"sheet\";\n"
    + "    if (/(?:SHEET|TURNAROUND|CONTACT)/i.test(String(row.stored || row.name || \"\"))) return \"sheet\";\n"
    + "    return \"undeclared\";",
  baseline: (coverage) => {
    assert.strictEqual(
      coverage.referenceArtifactStructureOf({ candidateFiles: [{ stored: "PROP-BEDSHEET-CANDIDATE-M9X-01.png" }] }, "PROP-BEDSHEET-CANDIDATE-M9X-01.png"),
      "undeclared", "baseline: an ordinary image belonging to a prop called Bedsheet must not read as a sheet");
  },
  probe: (coverage) => {
    const entity = { candidateFiles: [{ stored: "PROP-BEDSHEET-CANDIDATE-M9X-01.png" }] };
    const answer = coverage.referenceArtifactStructureOf(entity, "PROP-BEDSHEET-CANDIDATE-M9X-01.png");
    return {
      reached: true,
      held: answer !== "sheet",
      reason: answer === "sheet" ? "ordinary-image-classified-by-its-entity-name" : answer,
    };
  },
  reason: "ordinary-image-classified-by-its-entity-name",
  explain: "A stored filename begins with the entity id, so a filename rule classifies the ENTITY, not the artifact.",
});

/* ===========================================================================
   BROWSER-LEVEL CONTROLS.
   =========================================================================== */

const gateFixture = ({ sheetIsCanon = false } = {}) => {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-IREN";
  character.name = "Iren";
  const primary = sheetIsCanon ? "CHAR-IREN-SHEET.png" : "CHAR-IREN-PRIMARY.png";
  character.approvedFile = primary;
  character.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: primary }];
  character.candidateFiles = [
    { stored: "CHAR-IREN-PRIMARY.png", original: "CHAR-IREN-PRIMARY.png", decision: "unreviewed" },
    { stored: "CHAR-IREN-SHEET.png", original: "CHAR-IREN-SHEET.png", decision: "unreviewed", coverageJobType: "sheet", coverageSheetType: "angles" },
  ];
  character.coverageSlots = [{ id: "front", label: "Front", requirement: "required", selectedFile: "" }];
  project.shots[0].characters = [character.id];
  return withCanon(project, { kind: "entity-state", list: "characters", entityId: character.id, stateId: "state-default", value: primary });
};

const gateScan = () => ({
  anchors: [
    { name: "CHAR-IREN-PRIMARY.png", url: "/assets/anchors/CHAR-IREN-PRIMARY.png" },
    { name: "CHAR-IREN-SHEET.png", url: "/assets/anchors/CHAR-IREN-SHEET.png" },
  ],
  plates: [], props: [], vehicles: [], audio: [], media: [],
  shots: { "L1-01": { takes: [], locked: [] } },
});

const COVERAGE_VIEW_STORAGE = {
  "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "coverage",
  "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-IREN": "coverage",
};

/* C5 — SELECTION MUST NOT COMMIT. Put the writer back on the dropdown's own
   onchange and merely choosing a file assigns the slot again. */
controlAsync({
  label: "C5 a bare selection must not write the slot",
  mutateSource: (file, text) => file !== "entities.js" ? text : mutate(
    text,
    `onchange="stageSlotSelection('coverage-slot-file','coverage-slot-use')"`,
    `onchange="setCoverageSlotField('\${list}','\${entity.id}',\${selectedIndex},'selectedFile',this.value)"`,
    "C5", 1),
  probe: async (mutateSource) => {
    const rendered = await render("#/character/CHAR-IREN", gateFixture(), {
      scan: gateScan(), storage: { ...COVERAGE_VIEW_STORAGE }, ...(mutateSource ? { mutateSource } : {}),
    });
    /* Run THE PAGE'S OWN declared handler, whatever it is. The attribute is read
       out of the rendered markup (the harness DOM has no getAttribute) and
       `this.value` is bound to the file being chosen, so this is the dropdown
       firing, not a re-implementation of it. */
    const html = rendered.context.document.getElementById("main").innerHTML;
    const handler = (html.match(/<select id="coverage-slot-file"[^>]*onchange="([^"]*)"/) || [])[1];
    if (!handler) return { reached: false, held: false, reason: "no-dropdown" };
    const decoded = handler.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .split("this.value").join("'CHAR-IREN-PRIMARY.png'");
    const after = vm.runInContext(
      `(() => { const sel=document.getElementById('coverage-slot-file');
         if (sel) sel.value='CHAR-IREN-PRIMARY.png';
         try { ${decoded}; } catch (error) { return { error: String(error && error.message) }; }
         const e=P.characters.find(x=>x.id==='CHAR-IREN');
         return { file: slotSelectedFile(ensureCoverageSlots('characters',e)[0]) }; })()`,
      rendered.context);
    if (after && after.error) return { reached: false, held: false, reason: `handler-threw:${after.error}` };
    return {
      reached: true,
      held: after.file === "",
      reason: after.file ? `bare-selection-committed-the-slot(${after.file})` : "no-write",
    };
  },
  reason: "bare-selection-committed-the-slot(CHAR-IREN-PRIMARY.png)",
  explain: "A dropdown that writes on change turns looking at the options into deciding.",
});

/* C6 — DETECT AND TELL. Blind the correction detector and an entity whose
   identity really is a coverage sheet reports itself clean. */
controlAsync({
  label: "C6 an entity whose identity is a sheet must say so",
  mutateSource: (file, text) => file !== "entities.js" ? text : mutate(
    text,
    "    const isSheet = !!(media && entityCandidateIsCoverageSheet(entity, fileName));",
    "    const isSheet = false;",
    "C6", 1),
  probe: async (mutateSource) => {
    const rendered = await render("#/character/CHAR-IREN", gateFixture({ sheetIsCanon: true }), {
      scan: gateScan(), ...(mutateSource ? { mutateSource } : {}),
    });
    const html = rendered.context.document.getElementById("main").innerHTML;
    if (!html.includes("CANON IMAGES")) return { reached: false, held: false, reason: "no-authority-summary" };
    const told = html.includes("NEEDS CORRECTION");
    return { reached: true, held: told, reason: told ? "reported" : "bad-primary-reported-clean" };
  },
  reason: "bad-primary-reported-clean",
  explain: "Authority that predates the gate cannot be revoked automatically, so being TOLD is the entire remedy.",
});

/* C7 — IDENTITY PACKAGING. Drop the structural check from the reference package
   and a coverage sheet is handed to a paid generation as the character's face. */
controlAsync({
  label: "C7 a sheet must never be packaged as identity",
  mutateSource: (file, text) => file !== "coverage-automation.js" ? text : mutate(
    text,
    "      if (!item?.url || entityCandidateIsCoverageSheet(entity, item.name) || refs.some((row) => row.item.name === item.name)) return;",
    "      if (!item?.url || refs.some((row) => row.item.name === item.name)) return;",
    "C7", 1),
  probe: async (mutateSource) => {
    const rendered = await render("#/character/CHAR-IREN", gateFixture({ sheetIsCanon: true }), {
      scan: gateScan(), ...(mutateSource ? { mutateSource } : {}),
    });
    const packaged = vm.runInContext(
      `(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');
         const pack=__CINEBRAID_COVERAGE_AUTOMATION.coverageReferencePackage('characters',e,null);
         return pack.map(r=>({kind:r.kind,name:r.item.name})); })()`,
      rendered.context);
    if (!Array.isArray(packaged)) return { reached: false, held: false, reason: "no-package" };
    const leaked = packaged.find((row) => row.name === "CHAR-IREN-SHEET.png");
    return {
      reached: true,
      held: !leaked,
      reason: leaked ? `sheet-packaged-as-${leaked.kind}` : "not-packaged",
    };
  },
  reason: "sheet-packaged-as-identity-canon",
  explain: "The gate stops NEW bad authority; this is what stops the authority that already exists from being spent.",
});

/* C8 — THE QUOTE IS DERIVED, NOT DECORATIVE. Price a fixed quantity instead of
   the work the button will actually submit and the number stops describing the
   request beside it. */
controlAsync({
  label: "C8 the coverage quote prices the work it names",
  mutateSource: (file, text) => file !== "coverage-automation.js" ? text : mutate(
    text,
    "quantity: images, local: false })",
    "quantity: 1, local: false })",
    "C8", 1),
  probe: async (mutateSource) => {
    const project = gateFixture();
    const rendered = await render("#/character/CHAR-IREN", project, {
      scan: gateScan(), storage: { ...COVERAGE_VIEW_STORAGE }, ...(mutateSource ? { mutateSource } : {}),
    });
    vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal=CONFIG.generation.fal||{};
      CONFIG.generation.fal.enabled=true;CONFIG.generation.fal.apiKey='k';
      CONFIG.generation.fal.estimatedCostPerImage=0.04;pollFalGeneration=()=>{};`, rendered.context);
    vm.runInContext(`openCoverageAutomationModal('characters','CHAR-IREN','individual');`, rendered.context);
    vm.runInContext(`document.getElementById('coverage-mode').value='individual';
      document.getElementById('coverage-sheet-type').value='angles';updateCoverageAutomationPlan();`, rendered.context);
    const html = vm.runInContext(`document.getElementById('coverage-spend-plan').innerHTML`, rendered.context);
    const shown = Number((html.match(/data-coverage-price-amount="([0-9.]+)"/) || [])[1]);
    const images = Number((html.match(/up to (\d+) image/) || [])[1]);
    if (!images || !Number.isFinite(shown)) return { reached: false, held: false, reason: "no-quote" };
    const expected = Number((images * 0.04).toFixed(2));
    return {
      reached: true,
      held: shown === expected,
      reason: shown === expected ? "matches-owner" : `quote-priced-${shown}-for-${images}-images`,
    };
  },
  reason: "quote-priced-0.04-for-12-images",
  explain: "A price that does not move with the request is decoration next to a paid button.",
});

/* ---------------------------------------------------------------------------
   NO CATCH-AS-SUCCESS. Enforced, not promised. */
function testNoCatchAsSuccess() {
  const text = toLF(fs.readFileSync(__filename, "utf8"));
  assert.ok(!/catch\s*\([^)]*\)\s*\{[^}]*controls\s*\+\+/.test(text),
    "a control must never count itself as passed from inside a catch");
  /* The real hazard is CLASSIFYING an assertion failure as the firing this suite
     was looking for. Naming the word in prose is not that; branching on it is. */
  assert.ok(!/instanceof\s+(assert\.)?AssertionError/.test(text),
    "no control may branch on an AssertionError");
  /* Built rather than written, so this line does not match itself. */
  assert.ok(!new RegExp(["ERR", "ASSERTION"].join("_")).test(text),
    "no control may recognise an assertion failure code as a result");
  /* And every control must state the exact bad state it expects. */
  const declared = (text.match(/^\s*reason: "/gm) || []).length;
  assert.strictEqual(declared, controls,
    `every control must name its expected failure (${controls} controls, ${declared} named reasons)`);
}

async function main() {
  await Promise.all(pending);
  testNoCatchAsSuccess();
  console.log(`Reference truth + sheet gate negative controls: ${controls} controls, each broken in memory and watched to fail.`);
  for (const note of notes) console.log(note);
  console.log("No file in the working tree was modified. Provider calls made: 0.");
}

main().catch((error) => { console.error(error); process.exit(1); });
