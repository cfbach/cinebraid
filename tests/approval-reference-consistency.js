/* Approval reference consistency.
 *
 * F-18: approving a frame renames the take on disk and updated `winner` and
 * `candidateFiles[].stored` — but left every live `selectedCandidate` still
 * naming the old filename. Reproduced on the shipped sample: one APPROVE turned
 * 0 dangling media references into 5, three of which were semantic selections:
 *
 *     shots[].keyframes[].selectedCandidate
 *     shots[].creationBrief.frames[].selectedCandidate
 *     shots[].creationBrief.frameWorkflows.<id>.selectedCandidate
 *
 * The browser self-heals a frame it happens to re-render, so nothing looks
 * broken; the document at rest stays inconsistent, which is what export, import
 * and any durable identity built on these references would inherit.
 *
 * The other two dangling values — `candidateFiles[].original` and
 * `candidateFiles[].renamedFrom[]` — are HISTORICAL BY DESIGN. They record what
 * the file used to be called. This suite asserts they are preserved, because the
 * tempting fix (replace the old name everywhere it appears) would erase exactly
 * the provenance that makes a rename auditable.
 */
const assert = require("assert");
const path = require("path");
const vm = require("vm");

const { render, buildFixture } = require("./render-harness");

const OLD = "FRAME_B.png";
const NEW = "FRAME_B_APPROVED_v2.png";
const SHOT = "L1-01";

function fixtureWithSelections() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.candidateFiles = [
    { stored: "FRAME_A.png", original: "FRAME_A.png", decision: "unreviewed", notes: "", labels: [] },
    { stored: OLD, original: OLD, decision: "unreviewed", notes: "", labels: [] },
  ];
  shot.keyframes[1].selectedCandidate = OLD;
  shot.creationBrief = {
    frames: [
      { id: "frame-a", label: "A", selectedCandidate: "FRAME_A.png" },
      { id: "frame-b", label: "B", selectedCandidate: OLD },
    ],
    frameWorkflows: {
      "frame-a": { selectedCandidate: "FRAME_A.png" },
      "frame-b": { selectedCandidate: OLD },
    },
  };
  return project;
}

function inspect(context) {
  return vm.runInContext(
    `(() => {
       const s = P.shots.find((x) => x.id === "${SHOT}");
       const c = s.creationBrief || {};
       return {
         frameWinner: s.keyframes[1].winner || "",
         keyframeSelected: s.keyframes[1].selectedCandidate || "",
         siblingKeyframeSelected: s.keyframes[0].selectedCandidate || "",
         briefFrameSelected: ((c.frames || [])[1] || {}).selectedCandidate || "",
         siblingBriefSelected: ((c.frames || [])[0] || {}).selectedCandidate || "",
         workflowSelected: ((c.frameWorkflows || {})["frame-b"] || {}).selectedCandidate || "",
         siblingWorkflowSelected: ((c.frameWorkflows || {})["frame-a"] || {}).selectedCandidate || "",
         stored: (s.candidateFiles || []).map((r) => r.stored),
         originals: (s.candidateFiles || []).map((r) => r.original),
         renamedFrom: (s.candidateFiles || []).flatMap((r) => r.renamedFrom || []),
       };
     })()`,
    context,
  );
}

async function approve(project, { target, from, to }) {
  const { context } = await render(`#/shot/${SHOT}`, project, {
    fetch: async (url, options, response) => {
      if (url === "/api/media/rename") {
        const body = JSON.parse(options.body || "{}");
        /* The route echoes the stored name, and it is scoped to a project. */
        assert(body.projectSlug !== undefined, "an approval rename must name the project it belongs to");
        return response({ ok: true, name: path.basename(String(body.to || "")) });
      }
      return null;
    },
  });
  context.confirmModal = (message, action) => action();
  context.approveTake(SHOT, from);
  context.document.getElementById("approve-target").value = target;
  context.document.getElementById("approve-name").value = to;
  await context.confirmApproveTake();
  await new Promise((r) => setTimeout(r, 30));
  return context;
}

async function testApprovalRetargetsSelections() {
  const context = await approve(fixtureWithSelections(), { target: "frame:frame-b", from: OLD, to: NEW });
  const after = inspect(context);

  assert.strictEqual(after.frameWinner, NEW, "approval must record the new canonical filename as the winner");
  assert(after.stored.includes(NEW), "the candidate record must move to the new filename");

  /* The three semantic selections follow the rename, in the same mutation. */
  assert.strictEqual(after.keyframeSelected, NEW, "keyframes[].selectedCandidate must follow the rename");
  assert.strictEqual(after.briefFrameSelected, NEW, "creationBrief.frames[].selectedCandidate must follow the rename");
  assert.strictEqual(after.workflowSelected, NEW, "creationBrief.frameWorkflows[].selectedCandidate must follow the rename");

  /* Untouched frames keep their own selections. */
  assert.strictEqual(after.siblingBriefSelected, "FRAME_A.png", "an unrelated frame's selection must not move");
  assert.strictEqual(after.siblingWorkflowSelected, "FRAME_A.png", "an unrelated workflow's selection must not move");

  /* Provenance is history and must survive. */
  assert(after.originals.includes(OLD), "candidateFiles[].original must keep the name the file was created with");
  assert(after.renamedFrom.includes(OLD), "candidateFiles[].renamedFrom must record the previous name");

  /* No live selection may still name a file the rename retired. */
  const live = [after.keyframeSelected, after.briefFrameSelected, after.workflowSelected];
  assert(!live.includes(OLD), "no live selection may still point at the old filename");
}

async function testNoBlindGlobalReplacement() {
  /* A second candidate whose HISTORY contains the name being retired. A blanket
     replacement of the old string would rewrite this row's provenance too,
     making it claim it was once a file it never was. */
  const project = fixtureWithSelections();
  const shot = project.shots[0];
  shot.candidateFiles.push({
    stored: "FRAME_C.png",
    original: OLD,                 // this row genuinely started life under that name
    renamedFrom: [OLD],
    decision: "unreviewed",
    notes: "",
    labels: [],
  });

  const context = await approve(project, { target: "frame:frame-b", from: OLD, to: NEW });
  const state = vm.runInContext(
    `(() => {
       const s = P.shots.find((x) => x.id === "${SHOT}");
       const row = (s.candidateFiles || []).find((r) => r.stored === "FRAME_C.png");
       return { stored: row ? row.stored : "", original: row ? row.original : "", renamedFrom: row ? (row.renamedFrom || []) : [] };
     })()`,
    context,
  );

  assert.strictEqual(state.stored, "FRAME_C.png", "an unrelated candidate must keep its stored filename");
  assert.strictEqual(state.original, OLD, "an unrelated candidate's original name is history and must not be rewritten");
  assert.deepStrictEqual(state.renamedFrom, [OLD], "an unrelated candidate's rename history must not be rewritten");
}

async function testApprovalWithoutRenameChangesNothing() {
  /* Approving under the same filename must not disturb any selection. */
  const project = fixtureWithSelections();
  const context = await approve(project, { target: "frame:frame-b", from: OLD, to: OLD });
  const after = inspect(context);
  assert.strictEqual(after.frameWinner, OLD, "approving without a rename keeps the filename");
  assert.strictEqual(after.keyframeSelected, OLD, "a no-op approval must leave the keyframe selection alone");
  assert.strictEqual(after.briefFrameSelected, OLD, "a no-op approval must leave the brief selection alone");
  assert.strictEqual(after.workflowSelected, OLD, "a no-op approval must leave the workflow selection alone");
  assert.deepStrictEqual(after.renamedFrom, [], "a no-op approval must not invent rename history");
}

async function testLegacyShotWithoutCreationBrief() {
  /* A shot that predates creationBrief must approve normally. */
  const project = buildFixture();
  const shot = project.shots[0];
  delete shot.creationBrief;
  shot.candidateFiles = [{ stored: OLD, original: OLD, decision: "unreviewed", notes: "", labels: [] }];
  shot.keyframes[1].selectedCandidate = OLD;

  const context = await approve(project, { target: "frame:frame-b", from: OLD, to: NEW });
  const after = inspect(context);
  assert.strictEqual(after.frameWinner, NEW, "a legacy shot must still approve");
  assert.strictEqual(after.keyframeSelected, NEW, "a legacy shot's keyframe selection must still follow the rename");
}

async function testMediaAssetStaysDormant() {
  /* Approval must not mint MediaAsset identity. `P.mediaAssets` is the project's
     own media-link list and may already hold rows; what matters is that an
     approval adds none, and that no media-assets.json ledger is involved. */
  const project = fixtureWithSelections();
  const before = (project.mediaAssets || []).length;
  const context = await approve(project, { target: "frame:frame-b", from: OLD, to: NEW });
  const after = vm.runInContext(`Array.isArray(P.mediaAssets) ? P.mediaAssets.length : 0`, context);
  assert.strictEqual(after, before, "approval must not add MediaAsset rows");
}

async function main() {
  await testApprovalRetargetsSelections();
  await testNoBlindGlobalReplacement();
  await testApprovalWithoutRenameChangesNothing();
  await testLegacyShotWithoutCreationBrief();
  await testMediaAssetStaysDormant();
  console.log(
    "Approval reference consistency suite passed selection retargeting across keyframes, creationBrief frames and "
    + "frame workflows, preserved original/renamedFrom provenance, an unrelated candidate whose history contains the "
    + "retired name, a no-op approval, a legacy shot without creationBrief, and dormant MediaAssets.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
