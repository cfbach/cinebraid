const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

async function main() {
  const app = read("public/app.js");
  const entities = read("public/entities.js");
  const coverage = read("public/coverage-automation.js");
  const serverFal = read("fal-generation.js");
  const css = read("public/styles.css");

  assert(app.includes("normalizeReferenceCoverageData"), "coverage migration must have an explicit normalization pass");
  assert(app.includes("if (normalizeReferenceCoverageData()) changed = true"), "coverage migration must run during project normalization");
  const ensureSlice = entities.slice(entities.indexOf("function ensureCoverageSlots"), entities.indexOf("window.setExpressionSlotField"));
  assert(!ensureSlice.includes("entity.coverageSlots ="), "render-time coverage helpers must not mutate project schema");
  assert(!ensureSlice.includes("entity.expressionSlots.push"), "render-time expression helpers must not reconcile schemas");

  assert(coverage.includes("COVERAGE_SUBMISSION_LOCKS"), "coverage client must lock repeated submissions immediately");
  assert(coverage.includes("clientRequestId"), "coverage jobs must carry idempotency keys");
  assert(serverFal.includes("existingByRequest"), "server must reuse duplicate client request IDs");
  assert(serverFal.includes("duplicatePrevented"), "server must prevent active duplicate coverage scope submissions");

  const extractSlice = coverage.slice(coverage.indexOf("window.extractCoverageCrop"), coverage.indexOf("window.seedCoverageFromPrimary"));
  assert(!/slot\.approvedFile\s*=\s*data\.name/.test(extractSlice), "crop extraction must not directly overwrite an authority");
  assert(extractSlice.includes("reviewRequired"), "extracted crops must record a review gate");
  /* ALPHA R3 — THE EXPLICIT ACT MOVED FROM A CHECKBOX ONTO THE BUTTON THAT NAMES
     IT, and the safety property is unchanged and stronger for it: assignment is
     now an ARGUMENT of the action, so no ambient DOM state, no stale checkbox and
     no re-render can turn a save into an assignment, and every caller that does
     not ask for one does not get one. */
  assert(!coverage.includes('id="coverage-crop-approve"'), "the ambient save-and-use checkbox must not come back");
  assert(/const assign = settings\.assign === true;/.test(coverage), "crop assignment must default off for any caller that does not ask");
  assert(/const approve = assign;/.test(coverage), "and must be decided by the caller's named action alone");
  assert(coverage.includes("extractCoverageCrop({ assign: true })") && coverage.includes("extractCoverageCrop({ assign: false })"),
    "with assigning and non-assigning saves offered as separate controls");

  assert(entities.includes("entityCandidateIsCoverageSheet(entity, item.name)"), "single-angle selectors must exclude complete sheets");
  assert(entities.includes("replacementHistory"), "coverage authority replacement must preserve history");
  /* 1D wording: a coverage view is SELECTED, not approved — the gate itself is
   unchanged and is what this asserts. */
  assert(entities.includes("Run and pass AI review before selecting"), "coverage selection must enforce the review gate");
  /* BATCH 1C: the literal this used to match moved out of entities.js. The
     property is unchanged — a candidate assigned to an expression slot must
     leave the assignment queue — but the queue now asks one shared predicate
     instead of matching two words inline, which is what let the rename to
     `selected-expression` half-land in the first place. So the check follows
     the logic: the queue consults the predicate, and the predicate knows both
     the current word and the legacy one a pre-1C project still carries. */
  assert(/coveragePassingAssignmentQueue[\s\S]{0,400}decisionIsSlotSelection\(row\.decision\)/.test(entities),
    "expression and coverage assignments must leave the candidate inbox, via the shared predicate");
  for (const word of ["selected-expression", "approved-expression", "selected-coverage", "approved-coverage"])
    assert(require("../public/shared-entity-slots").decisionIsSlotSelection(word), `${word} must be recognised as an assignment`);
  assert(serverFal.includes('"sheet-ready-for-review"'), "sheet jobs need a terminal ready-for-review state");
  assert(serverFal.includes('"slot-candidates-ready"'), "slot jobs need a terminal ready-for-review state");
  assert(coverage.includes("paid request"), "fan-out generation must disclose paid request counts");
  assert(coverage.includes("window.confirm"), "large fan-out submissions must require a second confirmation");

  assert(css.includes(".coverage-slot-card header div"), "coverage header copy must be stacked");
  assert(css.includes(".scene-review-summary>div"), "scene verdict copy must use a readable block layout");

  const project = buildFixture();
  const duplicate = structuredClone(project.characters[0]);
  duplicate.name = "Duplicate character";
  project.characters.push(duplicate);
  const rendered = await render(`#/character/${project.characters[0].id}`, project);
  assert(/duplicate/i.test(rendered.html), "duplicate IDs must produce a visible data-integrity warning");

  console.log("Safety and data-integrity suite passed explicit migrations, duplicate paid-job prevention, crop review gates, sheet filtering, approval history, terminal coverage states, fan-out confirmation, duplicate-ID warnings, and typography guards.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
