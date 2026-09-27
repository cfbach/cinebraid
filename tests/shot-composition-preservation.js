"use strict";
const assert = require("assert");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");
const plain = (value) => JSON.parse(JSON.stringify(value));

async function probe({ safe = false, mutateSource } = {}) {
  // Normalize a current project, then author values beyond the preview bounds.
  // A second render must not turn reads into edits.
  const seed = await render("#/shot/L1-01", buildFixture());
  const fixture = vm.runInContext("JSON.parse(JSON.stringify(P))", seed.context);
  const composition = fixture.shots[0].creationBrief.composition;
  composition.elements = [
    { id: "off-canvas", referenceKey: "", x: -.25, y: 1.25, w: .04, h: 1.4,
      depth: "foreground", facing: "away", view: "rear", crop: "none", notes: "Owner direction",
      locked: true, hidden: false, order: 3, extension: { retain: "verbatim" } },
    { id: "in-range", referenceKey: "", x: .25, y: .75, w: .3, h: .4,
      depth: "midground", facing: "camera", view: "reference-view", crop: "none", notes: "Control",
      locked: false, hidden: false, order: 4 },
  ];
  composition.baseFrame = { source: "auto", zoom: 3, panX: -75, panY: 75, rotation: 25, fit: "cover" };
  const authored = plain(composition);
  const { context } = await render("#/shot/L1-01", fixture, {
    storage: safe ? { "cinebraid-disable-v607-composer": "1" } : {}, mutateSource,
  });
  assert.deepStrictEqual(plain(vm.runInContext("P.shots[0].creationBrief.composition", context)), authored,
    "render must preserve authored composition");
  const result = vm.runInContext(`(() => {
    ROUTE_RENDER_IN_PROGRESS = false;
    let saves = 0;
    dirty = () => { saves++; };
    const shot = P.shots[0];
    const before = JSON.stringify(P);
    const preview = motionDirectorMap(shot, ensureShotCreation(shot));
    ensureShotCreation(shot);
    const afterRead = JSON.stringify(P);
    setVal('shots', shot.id, 'title', 'Unrelated title');
    const saved = JSON.parse(captureProjectSave().body);
    const beforeInvalid = JSON.stringify(P), beforeInvalidSaves = saves;
    for (const ratio of ['0:1', '1:0', '100:1', '1:100', 'invalid']) setShotAspectRatio(shot.id, ratio);
    const afterInvalid = JSON.stringify(P), afterInvalidSaves = saves;
    setShotAspectRatio(shot.id, '2:1');
    const edited = JSON.parse(captureProjectSave().body);
    return { before, afterRead, preview, saved, beforeInvalid, afterInvalid,
      beforeInvalidSaves, afterInvalidSaves, saves, edited };
  })()`, context);
  assert.strictEqual(result.afterRead, result.before, "repeated reads and preview must not mutate the project");
  const expected = JSON.parse(result.before);
  expected.shots[0].title = "Unrelated title";
  assert.deepStrictEqual(plain(result.saved), expected, "unrelated save must change only the title");
  assert.strictEqual(result.afterInvalid, result.beforeInvalid, "invalid composition edit must preserve data");
  assert.strictEqual(result.afterInvalidSaves, result.beforeInvalidSaves, "invalid composition edit must not save");
  expected.shots[0].creationBrief.composition.aspectRatio = "2:1";
  assert.deepStrictEqual(plain(result.edited), expected, "deliberate composition edit must change only its field");
  assert.strictEqual(result.saves, 2, "rename and valid composition edit each save once");
  if (!safe) assert.match(result.preview, /left:0%;top:100%;width:8%;height:100%/,
    "preview retains display bounds without rewriting authored geometry");
}

async function main() {
  await probe();
  await probe({ safe: true });
  for (const [file, from, to] of [
    ["creation-studio.js", "x: element.x ?? 0.5", "x: Math.max(0, Math.min(1, element.x ?? 0.5))"],
    ["v607-composer.js", "comp.baseFrame.zoom = comp.baseFrame.zoom ?? 1;", "comp.baseFrame.zoom = finite(comp.baseFrame.zoom, 1, 0.5, 2.5);"],
  ]) {
    let applied = false;
    await assert.rejects(() => probe({ mutateSource(name, source) {
      if (name !== file) return source;
      assert(source.includes(from), "negative-control anchor missing");
      applied = true;
      return source.replace(from, to);
    } }), /render must preserve authored composition/);
    assert(applied);
    console.log(`DETECTED read-time clamp in ${file}`);
  }
  console.log("PASS authored composition read/save preservation, safe mode, bounded preview, deliberate edit and invalid-edit controls.");
}
module.exports = { main, probe };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
