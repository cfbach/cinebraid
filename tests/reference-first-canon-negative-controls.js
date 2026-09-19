/* REFERENCE_FIRST_CANON_SIMPLIFICATION_V1 — NEGATIVE CONTROLS.
 *
 * tests/reference-first-canon.js asserts a truth seam and a paid boundary. Both kinds of
 * assertion are easy to write so that they cannot fail: a count that happens to be 1 either
 * way, a dialog check that passes because nothing rendered, a "nothing was sent" that holds
 * because nothing ran. So each control below breaks one guarantee IN MEMORY (the files on
 * disk are never touched) and requires the SPECIFIC assertion that owns it to fail.
 *
 *   NC-1   needed now is hard-coded from the canon standing instead of read from readiness
 *   NC-2   the coverage plan is counted as needed now
 *   NC-3   the first demanding shot's own total is presented as the entity's count
 *   NC-4   the fail-closed primary is dropped when readiness cannot answer
 *   NC-5   an existing candidate is ignored and Generate is offered over it
 *   NC-6   coverage keeps the warm accent while the primary is still needed
 *   NC-7   the coverage summary goes back to calling the plan required views
 *   NC-8   Generate primary reference submits the paid request itself, before confirmation
 *   NC-9   the paid dialog stops showing the prompt it will send
 *   NC-10  the submission skips the server's paid permit
 *   NC-11  the one-press path asks the assistant, so an unreachable Braidy blocks it
 *   NC-12  the Desk disables Generate primary reference when the assistant is unreachable
 *   NC-13  the Braidy path is deleted instead of demoted
 *   NC-14  planned coverage is warm again when nothing is needed now
 *   NC-15  the coverage surfaces print the "3/4" fraction again
 *
 * Each control first proves its anchor exists exactly once in the LF-normalised source and
 * that the mutated source was actually loaded, so a control can never pass by mutating
 * nothing. Provider calls made: 0. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const suite = require("./reference-first-canon");

const ROOT = path.join(__dirname, "..");
const readLF = (file) => fs.readFileSync(path.join(ROOT, "public", file), "utf8").replace(/\r\n/g, "\n");

const CONTROLS = [
  { id: "NC-1", defect: "needed now is hard-coded from the canon standing, not read from readiness", file: "entities.js",
    anchor: 'const now = [...obligationRows, ...unanswered, ...rows.filter((row) => row.demandState === "required-now")];',
    replacement: 'const now = standing.isCanon ? [] : [{ family: "primary", id: standing.primaryId, label: entity.name || entity.id, shotIds: [] }];',
    expect: /A4: the declared state the shot waits on is|A7: nothing is needed now for a reference no shot uses/ },
  { id: "NC-2", defect: "the coverage plan is counted as needed now", file: "entities.js",
    anchor: 'const now = [...obligationRows, ...unanswered, ...rows.filter((row) => row.demandState === "required-now")];',
    replacement: 'const now = [...obligationRows, ...unanswered, ...rows.filter((row) => row.demandState === "required-now" || (!row.satisfied && row.tier === "required"))];',
    expect: /A1: and counts exactly the readiness rows|A1: no coverage view is needed now/ },
  { id: "NC-3", defect: "the first demanding shot's own total is presented as the chair's count", file: "entities.js",
    anchor: 'const now = [...obligationRows, ...unanswered, ...rows.filter((row) => row.demandState === "required-now")];',
    replacement: 'const now = (production.shotIds || []).slice(0, 1).flatMap((shotId) => outstandingReadinessRows(evaluateShotReadiness(P, P.shots.find((s) => String(s.id) === shotId), readinessOracleForBrowser())).filter((r) => r.target && r.target.kind === "entity-state").map((r) => ({ family: "primary", id: standing.primaryId, label: String(r.label || ""), shotIds: [shotId] })));',
    expect: /A1: needed now is the readiness obligation on the primary|A6: / },
  { id: "NC-4", defect: "the fail-closed primary is dropped when readiness cannot answer", file: "entities.js",
    anchor: "const unanswered = !known && !standing.isCanon",
    replacement: "const unanswered = false && !known && !standing.isCanon",
    expect: /A8: an unapproved primary is still counted, fail-closed/ },
  { id: "NC-5", defect: "an existing candidate is ignored, so Generate is offered over it", file: "entities.js",
    anchor: '(standing.file || candidates.length ? { kind: "review-primary"',
    replacement: '(false ? { kind: "review-primary"',
    expect: /A2: and the next step is reviewing it/ },
  { id: "NC-6", defect: "coverage keeps the warm accent while the primary is still needed", file: "reference-desk.js",
    anchor: "const coverageWarm=!decisionPending&&!generateHere&&!stripAct&&(!need||need.action.kind==='build-coverage');",
    replacement: "const coverageWarm=!decisionPending;",
    expect: /C1: exactly one warm action/ },
  { id: "NC-14", defect: "planned coverage is warm again when nothing is needed now", file: "reference-desk.js",
    anchor: "const coverageWarm=!decisionPending&&!generateHere&&!stripAct&&(!need||need.action.kind==='build-coverage');",
    replacement: "const coverageWarm=!decisionPending&&!generateHere&&!stripAct;",
    expect: /C3: with nothing needed now, no control is warm/ },
  { id: "NC-15", defect: "the coverage surfaces print the \"3/4\" fraction again", file: "entities.js",
    anchor: 'return raw.replace(/\\b3\\s*\\/\\s*4\\b/g, (match, offset) => (offset === 0 ? "Three-quarter" : "three-quarter"));',
    replacement: "return raw;",
    expect: /B3: its view rows name the three-quarter view in words|B1: the Desk's view button names it in words|C6: / },
  { id: "NC-7", defect: "the coverage summary calls the plan required views again", file: "shared-reference-media.js",
    anchor: 'const word = value?.word === "planned" ? "planned" : "required";',
    replacement: 'const word = "required";',
    expect: /B1: the coverage section is named Coverage and counts planned views/ },
  { id: "NC-8", defect: "Generate primary reference submits the paid request itself", file: "creation-studio.js",
    anchor: 'return openFalEntityGenerationModal(list, id, build.id, "", { resolveReturnFocus: options.resolveReturnFocus });',
    replacement: 'openFalEntityGenerationModal(list, id, build.id, "", { resolveReturnFocus: options.resolveReturnFocus }); return window.startFalEntityGeneration();',
    expect: /D2: nothing was submitted or permitted before the confirmation/ },
  { id: "NC-9", defect: "the paid dialog stops showing the prompt it will send", file: "fal-generation.js",
    anchor: '<div id="fal-entity-generation-view"></div>${promptMarkup}<p class="hint">',
    replacement: '<div id="fal-entity-generation-view"></div><p class="hint">',
    expect: /D3: the dialog shows the prompt that will be sent/ },
  { id: "NC-10", defect: "the submission skips the server's paid permit", file: "fal-generation.js",
    anchor: 'body: JSON.stringify(await paidDispatchPermitFor(gatedBody)) });\n    const data = await response.json();\n    if (!response.ok) throw new Error(data.error || "Could not start entity generation");',
    replacement: 'body: JSON.stringify(gatedBody) });\n    const data = await response.json();\n    if (!response.ok) throw new Error(data.error || "Could not start entity generation");',
    expect: /D4: START GENERATION asks for a paid permit, then submits/ },
  { id: "NC-11", defect: "the one-press path asks the assistant, so an unreachable Braidy blocks it", file: "creation-studio.js",
    anchor: "const build = await window.buildAssetCreationPrompt(list, id, false);",
    replacement: "const build = await window.buildAssetCreationPrompt(list, id, true);",
    expect: /E2: with the assistant unreachable, one press still reaches the paid confirmation/ },
  { id: "NC-12", defect: "the Desk disables Generate primary reference when the assistant is unreachable", file: "reference-desk.js",
    anchor: `data-rd-action="generate-primary" aria-describedby="rd-first-note"'`,
    replacement: `data-rd-action="generate-primary" aria-describedby="rd-first-note"'+(typeof capabilityState==='function'&&!capabilityState('text').ready?' disabled':'')`,
    expect: /E1: Generate primary reference is still offered, enabled/ },
  { id: "NC-13", defect: "the Braidy path is deleted instead of demoted", file: "creation-studio.js",
    anchor: `<button class="approve-btn" onclick="openAssetAutomationModal('\${list}','\${x.id}')"\${aiDisabledAttrs("text")}>Start Braidy run</button>`,
    replacement: "",
    expect: /F2: Start Braidy run is still inside it/ },
];

async function runControl(control) {
  const occurrences = readLF(control.file).split(control.anchor).length - 1;
  assert.strictEqual(occurrences, 1, `${control.id}: VACUOUS — its anchor occurs ${occurrences} times in public/${control.file}; it must move with the seam`);
  let loaded = 0;
  const mutateSource = (file, original) => {
    if (file !== control.file) return original;
    const source = original.replace(/\r\n/g, "\n");
    const mutated = source.replace(control.anchor, () => control.replacement);
    if (mutated !== source) loaded++;
    return mutated;
  };
  let caught = null;
  try { await suite.run({ mutateSource }); } catch (error) { caught = error; }
  assert.ok(loaded > 0, `${control.id}: VACUOUS — the mutated ${control.file} was never loaded`);
  assert.ok(caught, `${control.id}: ${control.defect} — and NOTHING caught it`);
  assert.ok(caught instanceof assert.AssertionError || caught.name === "AssertionError",
    `${control.id}: the suite must fail by assertion, not crash (${caught && caught.stack})`);
  assert.ok(control.expect.test(caught.message),
    `${control.id}: caught, but by the wrong assertion — expected ${control.expect}, got "${caught.message}"`);
  return caught.message.split("\n")[0];
}

async function main() {
  const baseline = await suite.run();
  assert.ok(baseline > 100, `baseline: the unmutated suite passes (${baseline} checks)`);
  const rows = [];
  for (const control of CONTROLS) rows.push(`${control.id} ${control.defect} -> caught: "${await runControl(control)}"`);
  console.log(`Reference-first canon negative controls: ${CONTROLS.length}/${CONTROLS.length} defects caught by the assertion that owns them (baseline ${baseline} checks green).`);
  for (const row of rows) console.log(`  ${row}`);
  console.log("Nothing on disk was modified. Provider calls made: 0.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
