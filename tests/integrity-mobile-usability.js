const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");
const { unresolvedShotDependencies } = require("../public/shared-entities");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

async function main() {
  const fixture = buildFixture();
  fixture.characters.find((row) => row.id === "KAI").continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    { id: "state-night", name: "Night", isDefault: false, approvedFile: "KAI-NIGHT.png" },
  ];
  const shot = fixture.shots.find((row) => row.id === "L1-01");
  shot.characters = [...(shot.characters || []), "MISSING-CHAR"];
  shot.creationBrief = {
    ...(shot.creationBrief || {}),
    locationId: "MISSING-LOC",
    propIds: ["PR-TOOL", "MISSING-PROP"],
    vehicleIds: ["MISSING-VEH"],
    motionPlan: { audio: { speakerId: "MISSING-CHAR", voiceEntityId: "MISSING-VOICE" } },
  };
  shot.audio = { speakerId: "MISSING-CHAR", voiceEntityId: "MISSING-VOICE" };
  shot.codes = [...(shot.codes || []), "MISSING-CHAR-night"];
  shot.continuityStateSelections = { "MISSING-CHAR": "state-night" };
  shot.clips[0].speakerId = "MISSING-CHAR";
  shot.clips[0].voiceEntityId = "MISSING-VOICE";

  const direct = unresolvedShotDependencies(fixture, shot);
  for (const id of ["MISSING-CHAR", "MISSING-LOC", "MISSING-PROP", "MISSING-VEH", "MISSING-VOICE"]) {
    assert(direct.some((row) => row.id === id), `shared resolver lost unresolved relationship ${id}`);
  }

  const rendered = await render("#/shot/L1-01", fixture, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
  });
  for (const id of ["MISSING-CHAR", "MISSING-LOC", "MISSING-PROP", "MISSING-VEH", "MISSING-VOICE"]) {
    assert(rendered.html.includes(id), `Shot Inputs must expose unresolved relationship ${id}`);
  }
  assert(rendered.html.includes("BLOCKING REFERENCE ISSUES"), "unresolved relationships must be visually blocking");
  assert(rendered.html.includes(">Relink<"), "unresolved relationships must offer Relink");
  assert(rendered.html.includes(">Remove<"), "unresolved relationships must offer Remove");

  vm.runInContext(`updateShotDependencyRelationship(P.shots.find((row)=>row.id==='L1-01'),'MISSING-CHAR','KAI')`, rendered.context);
  const repaired = JSON.parse(vm.runInContext(`JSON.stringify(P.shots.find((row)=>row.id==='L1-01'))`, rendered.context));
  assert(repaired.characters.includes("KAI") && !repaired.characters.includes("MISSING-CHAR"), "relink must repair character arrays");
  assert(repaired.codes.includes("KAI-night") && !repaired.codes.some((id) => id.startsWith("MISSING-CHAR")), "relink must repair derived code tokens");
  assert.strictEqual(repaired.audio.speakerId, "KAI", "relink must repair shot audio speaker IDs");
  assert.strictEqual(repaired.clips[0].speakerId, "KAI", "relink must repair clip speaker IDs");
  assert.strictEqual(repaired.creationBrief.motionPlan.audio.speakerId, "KAI", "relink must repair motion-plan speaker IDs");
  assert.strictEqual(repaired.continuityStateSelections.KAI, "state-night", "relink must preserve continuity-state selection");
  assert(!Object.prototype.hasOwnProperty.call(repaired.continuityStateSelections, "MISSING-CHAR"), "relink must remove stale continuity-state key");

  vm.runInContext(`updateShotDependencyRelationship(P.shots.find((row)=>row.id==='L1-01'),'MISSING-LOC','')`, rendered.context);
  const removed = JSON.parse(vm.runInContext(`JSON.stringify(P.shots.find((row)=>row.id==='L1-01'))`, rendered.context));
  assert.strictEqual(removed.creationBrief.locationId, "", "remove must clear stale location ID");

  vm.runInContext(`replaceEntityReferences('characters','KAI','')`, rendered.context);
  const afterDeletion = JSON.parse(vm.runInContext(`JSON.stringify(P.shots.find((row)=>row.id==='L1-01'))`, rendered.context));
  assert(!afterDeletion.characters.includes("KAI"), "entity deletion must remove the relationship from shot characters");
  assert(!afterDeletion.codes.some((id) => id === "KAI" || id.startsWith("KAI-") || id.startsWith("KAI_")), "entity deletion must remove derived code tokens");
  assert.strictEqual(afterDeletion.audio.speakerId, "", "entity deletion must clear shot-audio speaker relationships");
  assert.strictEqual(afterDeletion.clips[0].speakerId, "", "entity deletion must clear clip speaker relationships");
  assert(!Object.prototype.hasOwnProperty.call(afterDeletion.continuityStateSelections, "KAI"), "entity deletion must clear continuity-state relationship keys");

  const activityRender = await render("#/shot/L1-01", buildFixture());
  /* The floating strip was retired in Batch 2 Slice 1. The property it was asserted
     for — the persistent global indicator is quiet when nothing is happening and
     describes the work when something is — now belongs to the topbar chip, which is
     the only persistent global indicator left. Asserted on the chip, unchanged in
     substance. */
  activityRender.context.v641UpdateActivityButton();
  const chip = activityRender.context.document.getElementById("automation-activity-toggle");
  assert(chip, "the topbar activity chip must exist");
  assert(chip.innerHTML.includes("Idle"), "the idle activity chip must say so rather than imply work");
  const activityId = activityRender.context.v641StartManualActivity("LOCAL AI", "Build prompt", "Preparing deterministic prompt");
  assert(activityId, "manual activity should start");
  assert(chip.innerHTML.includes("Build prompt") || chip.innerHTML.includes("active"), "the active chip must describe current work");
  activityRender.context.setTimeout = () => 0;
  activityRender.context.v641FinishManualActivity(activityId, "completed", "Done");
  assert(chip.innerHTML.includes("Idle"), "the completed activity chip must return to idle");

  const settings = await render("#/settings", buildFixture(), { storage: { "cinebraid-focused:fixture:settings-task:settings": "project" } });
  const globalStyle = settings.html.match(/<textarea[^>]*onchange="setGlobalCreationField\('globalStylePrompt',this\.value\)"[^>]*>/)?.[0] || "";
  assert(globalStyle, "Settings must render the global visual style textarea");
  assert(/aria-label="Global visual style"|id="[^"]+"/.test(globalStyle), "global visual style textarea must have an accessible name");

  const shotNav = await render("#/shot/L1-01", {
    ...buildFixture(),
    shots: [
      { ...buildFixture().shots[0], id: "L1-00", title: "Previous setup" },
      { ...buildFixture().shots[0], id: "L1-01", title: "Hull check" },
      { ...buildFixture().shots[0], id: "L1-02", title: "Next setup" },
    ],
  });
  assert(/aria-label="Previous shot: Previous setup"/.test(shotNav.html), "previous-shot glyph must have a meaningful accessible name");
  assert(/aria-label="Next shot: Next setup"/.test(shotNav.html), "next-shot glyph must have a meaningful accessible name");

  const authorityFixture = buildFixture();
  authorityFixture.characters[0].continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    { id: "state-night", name: "Night", approvedFile: "" },
    { id: "state-dirty", name: "Dirty", approvedFile: "" },
  ];
  const authority = await render("#/character/KAI", authorityFixture);
  assert(authority.html.includes('class="entity-authority-label"'), "authority label must use explicit structure");
  assert(authority.html.includes('class="entity-authority-status"'), "authority count must use explicit structure");
  assert(!authority.html.includes("APPROVED AUTHORITY1/"), "authority label and count must not concatenate");

  const css = read("public/styles.css");
  assert(!css.includes("#automation-global-live-strip"), "the retired global live strip must leave no styling behind");
  assert(css.includes(".automation-compact-status"), "the compact run status a working page shows must be styled");
  assert(css.includes("min-height:40px"), "mobile controls must receive a minimum hit-area floor");

  const app = read("public/app.js");
  /* This used to require boundedWriteState('shot-task', …), which writes
     `cinebraid-bounded:…` while the shot workspace reads `cinebraid-focused:…` — so the
     assertion pinned a writer whose value nothing ever read, and the readiness link had
     never once opened Shot Inputs. The link now writes the declared scope through the
     canonical writer; tests/stage-model.js owns the key-agreement guarantee. */
  assert(app.includes('issue.kind === "unresolved-reference"') && app.includes("boundedWriteFocusedTask('${SHOT_STAGE_SCOPE}'"), "readiness links for unresolved relationships must open Shot Inputs");
  assert(app.includes('storedValue("cinebraid-library-tab", "all")'), "Reference Library category must restore from local storage");
  assert(app.includes('localStorage.setItem("cinebraid-library-tab", tab)'), "Reference Library category must persist after selection");

  console.log("Integrity and mobile usability suite passed unresolved-reference preservation/repair, readiness ownership, the one persistent activity indicator going idle -> active -> idle, accessible field/navigation labels, authority typography structure, mobile hit-area CSS, and persisted Library category.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
