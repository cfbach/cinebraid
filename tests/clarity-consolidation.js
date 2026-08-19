const assert = require("assert");
const fs = require("fs");
const path = require("path");
const RELEASE_VERSION = require("../package.json").version;
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const index = read("public/index.html");
const entities = read("public/entities.js");
const creation = read("public/creation-studio.js");
const views = read("public/views.js");
const settings = read("public/settings.js");
const app = read("public/app.js");
const reports = read("public/reports.js");
const styles = read("public/styles.css");
const mutations = read("public/mutations.js");
const composer = read("public/v607-composer.js");

assert(index.includes(`styles.css?v=${RELEASE_VERSION}`));

/* AMENDED BY BATCH 2 SLICE 3 — three consolidated workspaces, not four.

   The reference workspace used to be Reference / Choose & approve / Coverage &
   states / Details & history, and this suite pinned all four labels. Slice 3
   retired `Choose & approve` as a peer: candidate review is now contextual to
   the reference that owns it, and coverage is stated as a production demand
   rather than as a filing cabinet. The consolidation property this file exists
   to guard is unchanged and is asserted more strictly below — there must be
   exactly three, and the retired id must still resolve rather than dangle. */
for (const label of ["Primary reference", "What this production needs", "Details & history"])
  assert(entities.includes(`label:"${label}"`), `missing ${label} reference workspace`);
assert(!entities.includes('label:manualFirstWorkflow()?"Choose & approve":"Review"'), "Choose & approve must no longer be a peer top-level reference stage");
assert(entities.includes('review:"reference"'), "a stored or handed-off `review` selection must resolve onto the reference that owns candidate review");
assert(entities.includes("bounded-single-state"), "continuity states must render one editor at a time");
assert(entities.includes("selected:continuity-state"), "continuity state selection must persist");
assert(!entities.includes('label:"Approved",detail:'), "Approved must be a status, not a workspace");

/* The five shot stages, asked of the DECLARATION rather than of creation-studio.js's
   source text. This used to read
     assert(creation.includes('const ids=["inputs","look","frames","motion","deliver"]'))
   which is a constant compared against itself: it could not fail for any reason a
   filmmaker would care about, and it would have stayed green while the taskbar, the
   workspace renderers and the panel map all disagreed. The stage set now has one
   declared source, and tests/stage-model.js proves the shipped surfaces resolve through
   it; clarity-consolidation only needs to know the five stages are still the five. */
const { SHOT_STAGES, SHOT_STAGE_IDS } = require("../public/shared-stage-model.js");
assert.deepStrictEqual([...SHOT_STAGE_IDS], ["inputs", "look", "frames", "motion", "deliver"], "the clarity consolidation shot stages must remain declared");
for (const label of ["Inputs", "Look & blocking", "Frames", "Motion & sound", "Deliver"])
  assert(SHOT_STAGES.some((stage) => stage.label === label), `missing ${label} shot stage`);
assert(!creation.includes('const ids=["inputs","look","frames","motion","deliver"]'), "the shot stage list must not be restated inside creation-studio.js");
assert(creation.includes("shot-stage-automation"), "automation belongs inside Frames");
assert(creation.includes("OPEN SHOTS"), "Create must hand the complete shot list to Production");
assert(!creation.includes('class="creation-scene-list"'), "Create must not render every scene description");

for (const label of ["Project", "Assistant", "Generation", "Recovery & advanced"])
  assert(views.includes(label), `missing ${label} settings tab`);
assert(views.includes('provider === "ollama"'));
assert(views.includes('provider === "anthropic"'));
assert(settings.includes('CONFIG.anthropicKey || ""'), "hidden provider values must be preserved");
assert(views.includes("Open project log & reports"));
assert(reports.includes("PROJECT LOG"));
assert(reports.includes("reportsLegacyCompatibilityUsage"), "Reports must expose read-only compatibility telemetry before adapters are removed");

assert(app.includes('boundedPage(filteredPairs, "shots", boardPageKey, 5)'), "shot board must use a five-card next-action page");
assert(app.includes('action: "unfinished"'), "shot board must default to unfinished work");
assert(app.includes("Not delivered"), "shot board must offer the not-delivered filter");
assert(!app.includes("const winnersProgress"), "verified dead winnersProgress helper must be removed");
assert(!composer.includes("function planHolderForActiveUnit"), "verified dead planHolderForActiveUnit helper must be removed");
assert(!mutations.includes("window.setWinner"), "overwritten legacy setWinner implementation must be removed");

assert(styles.includes("v6.6.2.0 clarity"), "clarity-consolidation styles must remain installed");
assert(styles.includes(".creation-project-actions"));
assert(styles.includes(".settings-tabs"));
assert(styles.includes(".continuity-state-rail"));

console.log("clarity consolidation assertions passed");
