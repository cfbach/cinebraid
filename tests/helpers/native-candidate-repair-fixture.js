const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { disposableRoot } = require("./disposable-root");
const Mask = require("../../src/media/image-mask");
const Kernel = require("../../public/shared-authority-kernel");
const { installTestManualActionSource } = require("../authority-test-gesture");
function png(width = 16, height = 9, pixel = () => [80, 90, 100, 255]) {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) image.data.set(pixel(i), i * 4);
  return PNG.sync.write(image);
}
function fixture(suppliedWorkspace) {
  const workspace = suppliedWorkspace || disposableRoot("native-candidate-repair");
  const project = { meta: { title: "Disposable repair", aspectRatio: "16:9", schemaVersion: "6.6", hubVersion: "v6.0.0" }, world: { visualStyle: "Flat cel illustration" },
    scenes: [{ id: "SC-1", title: "Threshold" }], characters: [], props: [], locations: [], vehicles: [], audio: [],
    shots: [{ id: "SH-1", scene: "SC-1", title: "Contact repair", desc: "Original Canon", creationBrief: {},
      keyframes: [{ id: "FR-A", label: "A" }], candidateFiles: [{ stored: "BASE.png", frameId: "FR-A", mediaType: "image", sourceBuildId: "historical-stale" }] }] };
  const dir = workspace.writeProject("repair-fixture", project), owner = { slug: "repair-fixture", dir }, assets = [];
  function media(relative, bytes) {
    const file = path.join(dir, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    const stat = fs.statSync(file), assetId = "asset-" + Mask.digest(Buffer.from(relative)).slice(0, 32);
    const row = { assetId, hashState: "hashed", contentHash: "sha256:" + Mask.digest(bytes), mediaType: "image", scope: {},
      role: "frame-candidate", source: "imported", lifecycle: "candidate", legacy: {}, indexedAt: new Date().toISOString(),
      storage: { path: relative, bytes: stat.size, mtimeMs: stat.mtimeMs } };
    assets.push(row); fs.writeFileSync(path.join(dir, "media-assets.json"), JSON.stringify({ schemaVersion: 1, assets })); return row;
  }
  const base = media("shots/SH-1/takes/BASE.png", png());
  project.shots[0].candidateFiles[0].assetId = base.assetId;
  const manual = installTestManualActionSource(Kernel), appearances = [];
  for (const [list, id, name, stateId, relative, role] of [
    ["props", "CHAIR", "Chair", "state-default", "props/CHAIR.png", "prop"],
    ["characters", "REX", "Rex", "state-default", "anchors/REX.png", "identity"],
    ["props", "SWORD", "Sword", "state-carried", "props/SWORD.png", "prop"],
  ]) {
    const a = media(relative, png(16, 9, () => [120, 80, 40, 255]));
    project[list].push({ id, name, prefix: id, candidateFiles: [{ stored: path.basename(relative), mediaKind: "image", coverageJobType: "single-reference" }],
      continuityStates: [{ id: "state-default", name: "Default", isDefault: true }, ...(stateId === "state-default" ? [] : [{ id: stateId, name: "Carried", parentStateId: "state-default" }])] });
    const receipt = manual.gesture(() => Kernel.approveEntityStateCanon(project, { list, entityId: id, stateId, value: path.basename(relative), assetId: a.assetId, via: "disposable-fixture" }));
    appearances.push({ list, entityId: id, stateId, assetId: a.assetId, approvalReceiptId: receipt.id, contentHash: a.contentHash.slice(7), role });
  }
  project.characters.push({ id: "GUARDIAN", name: "Guardian", visualDescription: "A giant horned guardian with glowing eyes", continuityStates: [{ id: "state-default", isDefault: true }] });
  project.shots[0].characters = ["REX", "GUARDIAN"];
  project.shots[0].risks = ["full-shot transformation into another visual language"];
  project.promptBuildsById = { "historical-stale": { id: "historical-stale", kind: "guided-frame", frameId: "FR-A", prompt: "Stale whole-shot prompt", references: [
    { key: "old-guardian", role: "identity", label: "Historical guardian", entityId: "GUARDIAN", url: "/assets/anchors/OLD-GUARDIAN.png" },
    { key: "old-gate", role: "location", label: "Historical gate", url: "/assets/plates/OLD-GATE.png" }] } };
  const body = { projectSlug: owner.slug, shotId: "SH-1", frameId: "FR-A", sourceCandidate: "BASE.png", baseAssetId: base.assetId, baseHash: base.contentHash.slice(7),
    appearances, change: "Repair only the left hand contact and remove the duplicate hilt. One folded chair and one sheathed sword.",
    preserve: "Preserve camera, gate and background.\nKeep flat cel style and approved chair design.", avoid: "No guardian.\nNo additional gate reference.",
    guide: { name: "CONTACT.png", base64: png(3, 2).toString("base64"), instruction: "Left-hand contact geometry only; no appearance authority." },
    mask: { name: "MASK.png", sourceConvention: "alpha-transparent-edit", base64: png(16, 9, i => [0, 0, 0, i % 16 < 3 ? 0 : 255]).toString("base64") } };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project));
  return { workspace, owner, project, body, base, media, png, cleanup: () => workspace.cleanup() };
}
module.exports = { fixture, png };
if (require.main === module) {
  const root = process.argv[2];
  if (!root) throw Error("A disposable projects root is required.");
  const workspace = { projectsRoot: root, writeProject(slug, project) {
    const dir = path.join(root, slug); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project)); return dir;
  }, cleanup() {} };
  const f = fixture(workspace);
  fs.writeFileSync(path.join(root, "repair-inputs.json"), JSON.stringify(f.body));
  fs.writeFileSync(path.join(root, "guide.png"), Buffer.from(f.body.guide.base64, "base64"));
  fs.writeFileSync(path.join(root, "mask.png"), Buffer.from(f.body.mask.base64, "base64"));
}
