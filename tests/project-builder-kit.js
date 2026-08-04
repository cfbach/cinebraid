const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "resources", "project-builder");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const schema = JSON.parse(read("CINEBRAID_PROJECT_SCHEMA_v6.5.3.json"));
const example = JSON.parse(read("CINEBRAID_PROJECT_BUILDER_MINIMAL_EXAMPLE.json"));
const prompt = read("CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt");
const template = read("CINEBRAID_PROJECT_BUILDER_USER_TEMPLATE.txt");
const quick = read("QUICK_START.md");
const readme = read("README.md");

assert.strictEqual(schema.$id, "https://cinebraid.local/schema/project-builder/v6.5.3");
assert.match(schema.title, /v6\.5\.3/);
assert.deepStrictEqual(JSON.parse(read("CINEBRAID_PROJECT_SCHEMA_v6.2.3.json")), schema);
assert.deepStrictEqual(JSON.parse(read("CINEBRAID_PROJECT_SCHEMA_v6.1_AUDIO_AWARE.json")), schema);
assert.deepStrictEqual(JSON.parse(read("CINEBRAID_PROJECT_SCHEMA_v6.0.json")), schema);
assert.match(prompt, /CineBraid v6\.5\.3 planning JSON object/);
assert.match(prompt, /Usually omit `meta\.promptDefaults`/);
assert.match(prompt, /REFERENCE, BLOCKING, AND CORRECTION PREPARATION/);
assert.match(template, /Omit approvals, candidates, winners/);
assert.match(quick, /Project Bible → Approved references → Blocking/);
assert.match(readme, /planning-only JSON/);
assert.match(prompt, /top-level `vehicles` collection/);
assert.strictEqual(example.vehicles.length, 1);
assert(schema.$defs.entity.properties.coverageSlots, "coverageSlots schema required");
assert(schema.$defs.character.allOf[1].properties.expressionSlots, "expressionSlots schema required");
assert.match(prompt, /REFERENCE COVERAGE \(v6\.5\.3\)/);

assert.strictEqual(example.meta.title, "Signal Room");
assert.strictEqual(example.qcChecklist.length, 5);
for (const key of ["characters", "locations", "props", "vehicles", "audio", "scenes", "shots"])
  assert(Array.isArray(example[key]), `${key} must be an array`);

const topIds = new Set();
for (const [kind, list] of [["character", example.characters], ["location", example.locations], ["prop", example.props], ["vehicle", example.vehicles], ["audio", example.audio], ["scene", example.scenes], ["shot", example.shots]]) {
  for (const item of list) {
    assert.match(item.id, /^[A-Z0-9_-]+$/, `${kind} id ${item.id}`);
    assert(!topIds.has(item.id), `duplicate top-level id ${item.id}`);
    topIds.add(item.id);
  }
}
const chars = new Set(example.characters.map((x) => x.id));
const entities = new Map([...example.characters, ...example.locations, ...example.props, ...example.vehicles].map((x) => [x.id, x]));
const audio = new Set(example.audio.map((x) => x.id));
const scenes = new Set(example.scenes.map((x) => x.id));
for (const entity of entities.values()) {
  assert.strictEqual(entity.continuityStates.filter((x) => x.isDefault === true).length, 1, `${entity.id} default state`);
}
for (const shot of example.shots) {
  assert(scenes.has(shot.scene), `${shot.id} scene resolves`);
  shot.characters.forEach((id) => assert(chars.has(id), `${shot.id} character ${id}`));
  shot.codes.forEach((id) => assert(topIds.has(id), `${shot.id} code ${id}`));
  assert(shot.keyframes.length >= 1, `${shot.id} keyframe required`);
  const frames = new Set(shot.keyframes.map((x) => x.id));
  for (const [entityId, stateId] of Object.entries(shot.continuityStateSelections || {})) {
    assert(entities.has(entityId), `${shot.id} state entity ${entityId}`);
    assert(entities.get(entityId).continuityStates.some((x) => x.id === stateId), `${shot.id} state ${stateId}`);
  }
  if (shot.audio?.speakerId) assert(chars.has(shot.audio.speakerId));
  if (shot.audio?.voiceEntityId) assert(audio.has(shot.audio.voiceEntityId));
  for (const clip of shot.clips || []) {
    if (clip.fromFrame) assert(frames.has(clip.fromFrame), `${clip.id} fromFrame`);
    if (clip.toFrame) assert(frames.has(clip.toFrame), `${clip.id} toFrame`);
    if (clip.kind === "flf") assert(clip.fromFrame && clip.toFrame, `${clip.id} FLF frames`);
    if (clip.kind === "r2v") assert(clip.dur >= 4 && clip.dur <= 15, `${clip.id} R2V duration`);
    if (clip.speakerId) assert(chars.has(clip.speakerId));
    if (clip.voiceEntityId) assert(audio.has(clip.voiceEntityId));
    if (clip.motionBrief) {
      assert.strictEqual(clip.motionBrief.dialogue.line, clip.line, `${clip.id} motion dialogue matches legacy line`);
      assert(chars.has(clip.motionBrief.dialogue.speakerId), `${clip.id} motion speaker resolves`);
      assert.strictEqual(clip.motionBrief.dialogue.locked, true, `${clip.id} dialogue locked`);
      assert(Array.isArray(clip.motionBrief.sound.sfxEvents), `${clip.id} structured SFX`);
    }
  }
}

const forbidden = new Set(["mediaAssets", "finishJobs", "jobs", "decisions", "sessions", "agentRuns", "candidateFiles", "promptBuilds", "imagePromptPackages", "generationPackages", "approvedFile", "winner", "stageApprovals", "referenceInstructions", "referenceRoles", "referenceSelection", "creationBrief", "composition"]);
function walk(value, pathName = "") {
  if (Array.isArray(value)) return value.forEach((x, i) => walk(x, `${pathName}[${i}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!forbidden.has(key), `runtime key ${pathName ? pathName + "." : ""}${key}`);
    walk(child, pathName ? `${pathName}.${key}` : key);
  }
}
walk(example);
console.log("Project Builder Prompt Kit v6.5.3 validation passed.");
