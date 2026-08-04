const assert = require("assert");
const {
  ensurePromptHistory,
  registerPromptBuild,
  promptBuildRef,
  resolvePromptBuild,
  resolvePromptBuildList,
  normalizePromptBuildHistory,
  applyPromptBuildRetention,
} = require("../public/shared-build-history");

function projectFixture() {
  return {
    meta: { title: "History fixture", promptBuildRetention: 2 },
    shots: [{
      id: "S01",
      promptBuilds: [],
      generationPackages: [],
      candidateFiles: [],
      creationBrief: { promptBuilds: [], motionPromptBuilds: [], frameWorkflows: {} },
      keyframes: [{ id: "frame-a", label: "A", generationPackages: [] }],
      clips: [{ id: "seg-a", suffix: "a", generationPackages: [] }],
    }],
  };
}

function countText(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function main() {
  const legacy = projectFixture();
  const build = {
    id: "guided-frame-1",
    packageId: "S01-FRAME-A-R01",
    date: "2026-07-25T00:00:00.000Z",
    prompt: "UNIQUE PROMPT PAYLOAD",
    profileId: "gpt-image-2/edit",
    inputs: { action: "Test", composition: { camera: { shotSize: "close" }, elements: [{ id: "x", x: 0.25 }] } },
    kind: "guided-frame",
  };
  const shot = legacy.shots[0];
  shot.creationBrief.promptBuilds.push(JSON.parse(JSON.stringify(build)));
  shot.keyframes[0].generationPackages.push(JSON.parse(JSON.stringify(build)));
  shot.promptBuilds.push({ ...JSON.parse(JSON.stringify(build)), kind: "guided-frame" });
  shot.generationPackages.push({ ...JSON.parse(JSON.stringify(build)), scope: "frame:frame-a" });

  assert.strictEqual(normalizePromptBuildHistory(legacy, { applyRetention: false }), true);
  assert.strictEqual(Object.keys(legacy.promptBuildsById).length, 1, "legacy copies with the same build ID must canonicalize once");
  assert.strictEqual(Object.keys(legacy.promptSnapshotsById).length, 1, "the immutable composition snapshot must be stored once");
  assert(shot.creationBrief.promptBuilds[0].buildId, "legacy prompt history must convert to references");
  assert(shot.keyframes[0].generationPackages[0].buildId, "legacy package history must convert to references");
  const serialized = JSON.stringify(legacy);
  assert.strictEqual(countText(serialized, "UNIQUE PROMPT PAYLOAD"), 1, "one logical compile must serialize one prompt record");
  assert.strictEqual(resolvePromptBuildList(legacy, shot.generationPackages)[0].prompt, "UNIQUE PROMPT PAYLOAD");

  const resolvedBefore = resolvePromptBuild(legacy, shot.creationBrief.promptBuilds[0]);
  resolvedBefore.inputs.composition.camera.shotSize = "wide";
  const resolvedAfter = resolvePromptBuild(legacy, shot.creationBrief.promptBuilds[0]);
  assert.strictEqual(resolvedAfter.inputs.composition.camera.shotSize, "close", "historical snapshots must remain immutable");
  const roundTrip = JSON.parse(JSON.stringify(legacy));
  assert.strictEqual(normalizePromptBuildHistory(roundTrip, { applyRetention: false }), false, "canonical migration must be idempotent");
  assert.strictEqual(resolvePromptBuildList(roundTrip, roundTrip.shots[0].promptBuilds)[0].prompt, "UNIQUE PROMPT PAYLOAD");

  const retained = projectFixture();
  ensurePromptHistory(retained);
  const retainedShot = retained.shots[0];
  for (let i = 1; i <= 4; i++) {
    const id = registerPromptBuild(retained, {
      id: `build-${i}`,
      packageId: `PKG-${i}`,
      date: `2026-07-25T00:00:0${i}.000Z`,
      prompt: `prompt ${i}`,
      inputs: { composition: { version: i } },
    });
    retainedShot.creationBrief.promptBuilds.push(promptBuildRef(id, { kind: "guided-frame" }));
    retainedShot.keyframes[0].generationPackages.push(promptBuildRef(id, { kind: "guided-frame", scope: "frame:frame-a" }));
  }
  const correctionId = registerPromptBuild(retained, { id: "correction-build", packageId: "CORRECTION-1", date: "2026-07-25T00:00:09.000Z", prompt: "targeted correction" });
  retainedShot.candidateFiles.push({ stored: "approved.png", approvedAt: "2026-07-25", sourcePackageId: "build-1", correctionBuildIds: [correctionId], currentCorrectionBuildId: correctionId });
  retainedShot.generationPackages.push(promptBuildRef(correctionId, { kind: "candidate-correction", scope: "frame:frame-a" }));
  applyPromptBuildRetention(retained, 2);
  const kept = new Set(retainedShot.keyframes[0].generationPackages.map((entry) => entry.buildId));
  assert.deepStrictEqual([...kept].sort(), ["build-1", "build-3", "build-4"], "retention must keep the newest records and approval-linked history");
  assert(!retained.promptBuildsById["build-2"], "unreferenced evicted records must leave the canonical store");
  assert(retained.promptBuildsById["build-1"], "approved-source records must remain protected");
  assert(retained.promptBuildsById[correctionId], "candidate correction builds must remain protected while linked to the candidate");

  const missing = resolvePromptBuild(retained, { buildId: "missing-build", scope: "frame:frame-a" });
  assert.strictEqual(missing.missing, true);
  assert(missing.warnings[0].includes("unavailable"), "dangling build IDs must render as a safe placeholder");

  console.log("Build-history suite passed canonical single-write storage, legacy conversion, immutable snapshots, retention protection, idempotence, and dangling-ID recovery.");
}

main();
