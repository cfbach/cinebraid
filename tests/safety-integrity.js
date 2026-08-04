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
  assert(coverage.includes('id="coverage-crop-approve" type="checkbox"'), "direct approval must remain an explicit checkbox");
  assert(!coverage.includes('id="coverage-crop-approve" type="checkbox" checked'), "direct approval must default off");

  assert(entities.includes("entityCandidateIsCoverageSheet(entity, item.name)"), "single-angle selectors must exclude complete sheets");
  assert(entities.includes("replacementHistory"), "coverage authority replacement must preserve history");
  assert(entities.includes("Run and pass AI review before approving"), "coverage approval must enforce the review gate");
  assert(entities.includes("approved-expression"), "expression approvals must leave the candidate inbox");
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
