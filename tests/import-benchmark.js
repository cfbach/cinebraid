const assert = require("assert");
const fs = require("fs");
const path = require("path");

const FIXTURES = path.join(__dirname, "fixtures", "import-benchmark");
const candidateRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixtureNames = fs
  .readdirSync(FIXTURES)
  .filter((name) => fs.existsSync(path.join(FIXTURES, name, "expectations.json")))
  .sort();

function array(value) {
  return Array.isArray(value) ? value : [];
}
function ids(project, key) {
  return new Set(array(project[key]).map((item) => String(item?.id || "")));
}
function recall(expected, actual) {
  if (!expected.length) return 1;
  return expected.filter((id) => actual.has(id)).length / expected.length;
}
function projectText(project) {
  return JSON.stringify(project);
}
function scoreFixture(expectations, project) {
  const sections = [
    ["sceneIds", "scenes"],
    ["shotIds", "shots"],
    ["characterIds", "characters"],
    ["locationIds", "locations"],
    ["propIds", "props"],
  ];
  const sectionScores = sections.map(([expectedKey, projectKey]) =>
    recall(array(expectations[expectedKey]), ids(project, projectKey)),
  );
  const text = projectText(project);
  const dialogue = array(expectations.dialogue);
  const dialogueScore = dialogue.length
    ? dialogue.filter((line) => text.includes(line)).length / dialogue.length
    : 1;
  const forbidden = array(expectations.forbiddenText);
  const forbiddenScore = forbidden.length
    ? forbidden.filter((term) => !text.toLowerCase().includes(term.toLowerCase())).length /
      forbidden.length
    : 1;
  const conflictCount = (text.match(/\[SOURCE CONFLICT\]/gi) || []).length;
  const conflictScore =
    conflictCount >= Number(expectations.minimumConflictMarkers || 0) ? 1 : 0;
  const shots = array(project.shots);
  const frameScore = shots.length
    ? shots.filter((shot) => array(shot.keyframes).length >= 1).length / shots.length
    : 0;
  const referenceLed = shots.flatMap((shot) => array(shot.clips)).filter((clip) => clip.kind === "r2v");
  const durationScore = referenceLed.length
    ? referenceLed.filter((clip) => Number(clip.dur) >= 4 && Number(clip.dur) <= 15).length /
      referenceLed.length
    : 1;
  const entities = ["characters", "locations", "props"].flatMap((key) => array(project[key]));
  const continuityScore = entities.length
    ? entities.filter(
        (entity) =>
          array(entity.continuityStates).length &&
          array(entity.continuityStates).filter((state) => state.isDefault === true).length === 1,
      ).length / entities.length
    : 1;
  const sceneShotCounts = expectations.sceneShotCounts || {};
  const countChecks = Object.entries(sceneShotCounts).map(
    ([sceneId, count]) => shots.filter((shot) => shot.scene === sceneId).length === count,
  );
  const planCountScore = countChecks.length
    ? countChecks.filter(Boolean).length / countChecks.length
    : 1;
  const titleScore = String(project.meta?.title || "") === String(expectations.title || "") ? 1 : 0;
  const parts = [
    ...sectionScores,
    dialogueScore,
    forbiddenScore,
    conflictScore,
    frameScore,
    durationScore,
    continuityScore,
    planCountScore,
    titleScore,
  ];
  return {
    score: parts.reduce((sum, value) => sum + value, 0) / parts.length,
    dialogueScore,
    forbiddenScore,
    conflictCount,
    frameScore,
    durationScore,
    continuityScore,
    planCountScore,
  };
}

const results = [];
for (const name of fixtureNames) {
  const fixture = path.join(FIXTURES, name);
  const expectations = JSON.parse(fs.readFileSync(path.join(fixture, "expectations.json"), "utf8"));
  const candidate = candidateRoot
    ? path.join(candidateRoot, `${name}.json`)
    : path.join(fixture, "expected-project.json");
  assert(fs.existsSync(candidate), `Missing candidate for ${name}: ${candidate}`);
  const project = JSON.parse(fs.readFileSync(candidate, "utf8"));
  const sourceFiles = fs
    .readdirSync(fixture)
    .filter((file) => file.endsWith(".md") && file !== "README.md");
  assert(sourceFiles.length >= 1, `${name} needs source material`);
  const result = scoreFixture(expectations, project);
  results.push({ fixture: name, ...result });
}
console.table(
  results.map((result) => ({
    fixture: result.fixture,
    score: result.score.toFixed(3),
    dialogue: result.dialogueScore.toFixed(2),
    forbidden: result.forbiddenScore.toFixed(2),
    conflicts: result.conflictCount,
    frames: result.frameScore.toFixed(2),
    omniDuration: result.durationScore.toFixed(2),
    continuity: result.continuityScore.toFixed(2),
    shotPlan: result.planCountScore.toFixed(2),
  })),
);
if (!candidateRoot)
  for (const result of results)
    assert(result.score >= 0.98, `${result.fixture} reference output scored ${result.score}`);
else if (results.some((result) => result.score < 0.7)) process.exitCode = 2;
