/* P4-SEM-C3 — durable identity for shot-side media edges.
 *
 * C2 gave entity approvals one answer to "what is this media, and what is it
 * authority for". A shot asks the identical question about its own media and had
 * no owner for it: every reader matched strings, and the approval rename repaired
 * the candidate row while leaving every winner edge behind.
 *
 * THE DEFECT THIS ENDS, stated precisely because it is subtle. There are exactly
 * two callers of POST /api/media/rename. C2 fixed the entity one. The shot one
 * (public/library-tools.js) called renameCandidateRecord(), which moves the
 * candidate row's `stored` and retargets selectedCandidate — and nothing else.
 * So approving a take under a new filename left s.winner, another frame's winner,
 * a clip's videoWinner and canonicalName all naming a file no longer on disk.
 *
 * WHAT IS NOT CLAIMED HERE. `winner` means "this edge points at that media". It
 * does NOT mean the media was creatively correct. Dogfood Pass #1 produced a good
 * video from a Frame A that violated its own shot requirement, and nothing in
 * this suite would have caught that — frame-intent validation is a different
 * layer and is deliberately absent from C3.
 *
 * NO PAID CALL IS POSSIBLE HERE: the render harness stubs fetch.
 */
const assert = require("assert");
const vm = require("vm");

const D = require("../public/shared-media-disposition");
const { render, buildFixture } = require("./render-harness");

const ID_A = "asset-" + "a".repeat(32);
const ID_B = "asset-" + "b".repeat(32);
const ID_C = "asset-" + "c".repeat(32);

/* A shot carrying every edge kind C3 owns, so a miss anywhere is visible. */
function chimbley(extra = {}) {
  return {
    id: "SH-010",
    winner: "TAKE_A.png",
    canonicalName: "TAKE_A.png",
    keyframes: [
      { id: "frame-a", label: "A", winner: "TAKE_A.png" },
      { id: "frame-b", label: "B", winner: "TAKE_B.png" },
    ],
    clips: [{ id: "motion-a", suffix: "a", kind: "flf", videoWinner: "CLIP.mp4", winner: "TAKE_A.png", winnerEnd: "TAKE_B.png" }],
    creationBrief: { approvedMotionFile: "CLIP.mp4" },
    candidateFiles: [
      { stored: "TAKE_C.png", decision: "rejected" },
      { stored: "TAKE_D.png", decision: "unreviewed" },
    ],
    ...extra,
  };
}
const SHOT_MEDIA = ["TAKE_A.png", "TAKE_B.png", "TAKE_C.png", "TAKE_D.png", "CLIP.mp4"]
  .map((name) => ({ name, url: `/assets/shots/SH-010/takes/${name}` }));

/* ===========================================================================
   1. The contract. */
function contractSection() {
  {
    const shot = chimbley();
    const edges = D.shotApprovalEdges(shot);
    /* Every edge kind is enumerated, not remembered. The pre-C3 rename knew
       about one of these; a reader walking this list cannot have that bug. */
    assert.deepStrictEqual(edges.map((e) => `${e.kind}:${e.field}`), [
      "shot:winner", "frame:winner", "frame:winner",
      "motion:videoWinner", "clip-first:winner", "clip-last:winnerEnd",
    ], "every shot approval field is enumerated, including the four C2's closeout did not name");
  }

  {
    const shot = chimbley();
    const seen = D.partitionShotMedia(shot, SHOT_MEDIA);
    assert.deepStrictEqual(seen.approved.map((r) => r.name).sort(), ["CLIP.mp4", "TAKE_A.png", "TAKE_B.png"]);
    assert.deepStrictEqual(seen.rejected.map((r) => r.name), ["TAKE_C.png"]);
    assert.deepStrictEqual(seen.candidates.map((r) => r.name), ["TAKE_D.png"]);
    /* Frame A is authority for three different things at once, and a reader
       choosing between takes needs all three — one image, several roles. */
    const a = seen.byName.get("TAKE_A.png");
    assert.deepStrictEqual(a.targets.map((t) => t.kind), ["shot", "frame", "clip-first"],
      "an approved shot image names every edge it is authority for");
  }

  {
    /* Approved outranks rejected — the same precedence C2 froze, because the live
       pointer is the newer fact. This is the guard against an alternate quietly
       becoming authority, and against authority quietly reading as an alternate. */
    const shot = chimbley();
    shot.candidateFiles.push({ stored: "TAKE_A.png", decision: "rejected" });
    assert.strictEqual(D.shotMediaDisposition(shot, "TAKE_A.png").role, "approved");
    assert.strictEqual(D.shotMediaDisposition(shot, "TAKE_C.png").role, "rejected",
      "and a rejected alternate does not drift into authority");
  }

  {
    /* Identity-first resolution: the filename on the edge is stale, the bytes
       moved, and the edge still resolves. */
    const shot = chimbley();
    D.stampShotApprovalIdentity(shot, "winner", ID_A);
    const edge = D.shotApprovalEdges(shot)[0];
    assert.strictEqual(D.resolveShotApprovalMedia(edge, [{ name: "MOVED.png", assetId: ID_A }])?.name, "MOVED.png",
      "an edge carrying identity resolves through a rename that broke its filename");
    assert.strictEqual(D.resolveShotApprovalMedia({ file: "TAKE_B.png", assetId: "" }, SHOT_MEDIA)?.name, "TAKE_B.png",
      "and an edge with no identity still resolves by filename");
    assert.strictEqual(D.resolveShotApprovalMedia({ file: "GONE.png", assetId: "" }, SHOT_MEDIA), null,
      "an edge matching nothing resolves to NOTHING — it never guesses a neighbour");
  }

  {
    /* A malformed id is refused rather than stored: a record carrying one would
       resolve to nothing while looking authoritative, which is strictly worse
       than carrying none, because the filename fallback is then skipped. */
    const frame = {};
    assert.strictEqual(D.stampShotApprovalIdentity(frame, "winner", "TAKE_A.png"), "");
    assert.strictEqual(D.stampShotApprovalIdentity(frame, "winner", "asset-nope"), "");
    assert.deepStrictEqual(frame, {}, "nothing is written when the value is refused");
    assert.strictEqual(D.stampShotApprovalIdentity(frame, "winner", ID_A), ID_A);
    assert.strictEqual(frame.winnerAssetId, ID_A, "the id field sits beside the field it identifies");
    D.clearShotApprovalIdentity(frame, "winner");
    assert.strictEqual("winnerAssetId" in frame, false, "and is cleared with the edge it identified");
  }

  {
    /* Reads never mutate — a legacy project must not be canonicalised by being
       looked at. */
    const shot = chimbley();
    const before = JSON.stringify(shot);
    D.shotApprovalEdges(shot);
    D.partitionShotMedia(shot, SHOT_MEDIA);
    D.staleShotApprovalEdges(shot, SHOT_MEDIA);
    assert.strictEqual(JSON.stringify(shot), before, "a shot disposition read writes nothing back");
  }

  {
    /* Stale pointers are DERIVED, never stored. */
    const stale = D.staleShotApprovalEdges(chimbley(), [{ name: "TAKE_D.png" }]);
    assert.deepStrictEqual([...new Set(stale.map((e) => e.kind))].sort(),
      ["clip-first", "clip-last", "frame", "motion", "shot"],
      "every edge pointing at media no longer present is reported");
  }
  console.log("  contract · every shot edge enumerated, roles and multi-target authority, identity-first resolution, refusal, clearing, read purity, derived staleness");
}

/* ===========================================================================
   2. The rename repair — the defect C3 exists to close. */
function repairSection() {
  {
    const shot = chimbley();
    const repaired = D.repairShotApprovalIdentity(shot, { from: "TAKE_A.png", to: "APPROVED_A.png", assetId: ID_A });

    /* THE MISS. Before C3, renameCandidateRecord() moved the candidate row and
       left every one of these behind. */
    assert.strictEqual(shot.winner, "APPROVED_A.png", "the shot winner is repaired");
    assert.strictEqual(shot.keyframes[0].winner, "APPROVED_A.png", "Frame A is repaired");
    assert.strictEqual(shot.clips[0].winner, "APPROVED_A.png", "the clip's first endpoint is repaired");
    assert.strictEqual(shot.canonicalName, "APPROVED_A.png", "and canonicalName, which is a copy of a winner");
    /* Untouched edges stay untouched. */
    assert.strictEqual(shot.keyframes[1].winner, "TAKE_B.png", "Frame B, which named a different file, is not disturbed");
    assert.strictEqual(shot.clips[0].videoWinner, "CLIP.mp4");
    assert(repaired.some((r) => r.kind === "canonical-name"), "the repair reports what it touched rather than leaving it to be inferred");

    /* Identity recorded while both names were known — the only moment CineBraid
       can prove they are the same media. */
    assert.strictEqual(shot.winnerAssetId, ID_A);
    assert.strictEqual(shot.keyframes[0].winnerAssetId, ID_A);
    /* And the point: a LATER rename is resolved by identity, not by a string. */
    assert.strictEqual(
      D.resolveShotApprovalMedia(D.shotApprovalEdges(shot)[0], [{ name: "MOVED_AGAIN.png", assetId: ID_A }])?.name,
      "MOVED_AGAIN.png", "once an edge carries identity, a later rename no longer breaks it");
  }

  {
    /* The motion edge and its derived copy travel together. */
    const shot = chimbley();
    D.repairShotApprovalIdentity(shot, { from: "CLIP.mp4", to: "FINAL.mp4", assetId: ID_C });
    assert.strictEqual(shot.clips[0].videoWinner, "FINAL.mp4");
    assert.strictEqual(shot.creationBrief.approvedMotionFile, "FINAL.mp4",
      "approvedMotionFile is a copy of the motion winner and moves with it");
    assert.strictEqual(shot.clips[0].videoWinnerAssetId, ID_C);
  }

  {
    /* An unanchored rename still repairs the filenames. That is the pre-C1 state,
       not a reason to break an approval. */
    const shot = chimbley();
    D.repairShotApprovalIdentity(shot, { from: "TAKE_B.png", to: "B2.png", assetId: "" });
    assert.strictEqual(shot.keyframes[1].winner, "B2.png");
    assert.strictEqual("winnerAssetId" in shot.keyframes[1], false, "and records no identity rather than inventing one");
  }

  {
    /* A rename of media no edge points at changes nothing. */
    const shot = chimbley();
    const before = JSON.stringify(shot);
    D.repairShotApprovalIdentity(shot, { from: "TAKE_D.png", to: "SOMETHING.png", assetId: ID_B });
    assert.strictEqual(JSON.stringify(shot), before, "an unrelated rename leaves every approval untouched");
  }
  console.log("  repair · shot/frame/clip/motion winners, canonicalName and approvedMotionFile all repaired; identity recorded once; unanchored renames still safe");
}

/* ===========================================================================
   3. The real surfaces: writers agree, readers resolve identity-first. */
async function surfacesSection(options = {}) {
  const project = buildFixture();
  const shot = project.shots.find((row) => row.id === "L1-01") || project.shots[0];
  const scan = {
    anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { [shot.id]: {
      takes: [
        { name: "FRAME_A.png", url: "/assets/x/FRAME_A.png", assetId: ID_A },
        { name: "FRAME_B.png", url: "/assets/x/FRAME_B.png", assetId: ID_B },
      ], locked: [], blocking: [],
    } },
  };
  const rendered = await render(`#/shot/${shot.id}`, project, { ...options, scan });

  /* The browser receives durable identity for shot media — C2's listMedia change
     already covered scanProject()'s shot directories, so C3 needed no server work.
     Asserted rather than assumed, because everything below depends on it. */
  const seen = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const s = P.shots.find((row) => row.id === ${JSON.stringify(shot.id)});
    const takes = takesFor(s.id);
    return {
      scanIdentity: takes.map((t) => t.assetId || ""),
      edges: shotApprovalEdges(s).map((e) => e.kind + ":" + e.file),
      badgesA: takeBadges(s, "FRAME_A.png"),
      partition: (() => { const p = partitionShotMedia(s, takes);
        return { approved: p.approved.map((r) => r.name), candidates: p.candidates.map((r) => r.name) }; })(),
    };
  })())`, rendered.context));

  assert.deepStrictEqual(seen.scanIdentity, [ID_A, ID_B],
    "shot media reaches the browser carrying durable identity");
  assert(seen.edges.includes("frame:FRAME_A.png") && seen.edges.includes("frame:FRAME_B.png"),
    "both frame endpoints are enumerated as approval edges");
  assert(seen.badgesA.includes("FRAME A"), "and the reader badges Frame A through the shared rule");
  assert.deepStrictEqual(seen.partition.approved.sort(), ["FRAME_A.png", "FRAME_B.png"],
    "both approved frame endpoints resolve as authority, neither disappears");

  /* Identity-first reading, in the page's own context: the edge keeps a filename
     that no longer exists while the bytes are present under a new name. */
  const survived = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const s = P.shots.find((row) => row.id === ${JSON.stringify(shot.id)});
    /* what an out-of-band rename looks like to the app */
    s.keyframes[0].winner = "GONE_A.png";
    s.keyframes[0].winnerAssetId = ${JSON.stringify(ID_A)};
    const takes = takesFor(s.id);
    return { badges: takeBadges(s, "FRAME_A.png"), any: (anyWinnerTake(s, takes) || {}).name || "" };
  })())`, rendered.context));
  assert(survived.badges.includes("FRAME A"),
    "a renamed approved frame is still recognised as Frame A through its identity");
  assert.strictEqual(survived.any, "FRAME_A.png",
    "and still resolves as a winner take rather than vanishing");

  console.log("  surfaces · shot media carries identity to the browser, both frame endpoints resolve, and a renamed winner survives through identity");
  return seen;
}

/* ===========================================================================
   4. Pre-C3 projects, and the writers agreeing. */
async function compatibilitySection(options = {}) {
  const project = buildFixture();
  const shot = project.shots.find((row) => row.id === "L1-01") || project.shots[0];
  /* The realistic post-C2, pre-C3 project: the LEDGER knows every shot file and
     the document knows none of them. That is the interesting case — a scan with
     no ids could not distinguish "never writes identity" from "had nothing to
     write", which is the difference this section exists to prove. */
  const scan = {
    anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { [shot.id]: {
      takes: [
        { name: "FRAME_A.png", url: "/assets/x/FRAME_A.png", assetId: ID_A },
        { name: "FRAME_B.png", url: "/assets/x/FRAME_B.png", assetId: ID_B },
      ],
      locked: [], blocking: [],
    } },
  };
  const before = JSON.stringify(shot);
  const rendered = await render(`#/shot/${shot.id}`, project, { ...options, scan });
  const after = JSON.parse(vm.runInContext(
    `JSON.stringify((() => { const s = P.shots.find((r) => r.id === ${JSON.stringify(shot.id)});
      return { doc: s, badges: takeBadges(s, "FRAME_A.png"), any: (anyWinnerTake(s, takesFor(s.id)) || {}).name || "" }; })())`,
    rendered.context));

  /* Scoped to the fields C3 owns. A blanket /AssetId/ match would also catch
     activeBlockingAssetId, blockingRevisionSourceAssetId and
     automationBlockingAssetId — pre-existing blocking pointers into
     P.mediaAssets[], seeded empty by ensureShotCreation() long before C3 and
     deliberately outside its scope, since those edges are already keyed by the
     library row's own id rather than by a filename. */
  for (const field of ["winnerAssetId", "videoWinnerAssetId", "winnerEndAssetId"])
    assert(!JSON.stringify(after.doc).includes(field),
      `rendering a pre-C3 project must not write ${field} into it — identity comes from an approval, never from a read`);
  assert(after.badges.includes("FRAME A"),
    "and a filename-only project still resolves its winners exactly as before");
  assert.strictEqual(after.any, "FRAME_A.png");
  assert.strictEqual(JSON.parse(before).keyframes[0].winner, after.doc.keyframes[0].winner,
    "no approval pointer moved");
  console.log("  compatibility · a pre-C3 project resolves identically and acquires no identity merely by being opened");
}

/* ===========================================================================
   5. C2 entity behaviour is untouched by the shot dialect. */
function c2UnchangedSection() {
  const entity = {
    id: "LOC-HULL", approvedFile: "A.png",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "A.png" }],
    coverageSlots: [{ id: "establishing", label: "Master establishing", approvedFile: "A.png" }],
    candidateFiles: [{ stored: "B.png", decision: "rejected" }],
  };
  const media = [{ name: "A.png" }, { name: "B.png" }, { name: "C.png" }];
  const p = D.partitionEntityMedia(entity, media);
  assert.deepStrictEqual(p.approved.map((r) => r.name), ["A.png"]);
  assert.deepStrictEqual(p.approved[0].targets.map((t) => t.kind), ["state", "coverage"]);
  assert.deepStrictEqual(p.rejected.map((r) => r.name), ["B.png"]);
  assert.deepStrictEqual(p.candidates.map((r) => r.name), ["C.png"]);
  /* The two dialects stay apart: an entity edge carries approvedAssetId, a shot
     edge carries <field>AssetId, and neither normaliser touches the other's
     vocabulary — the constraint media-assets.js:244 states. */
  D.stampApprovalIdentity(entity.coverageSlots[0], ID_A);
  assert.strictEqual(entity.coverageSlots[0].approvedAssetId, ID_A);
  assert.strictEqual(D.APPROVED_ASSET_ID_FIELD, "approvedAssetId");
  assert.strictEqual(D.shotAssetIdField("videoWinner"), "videoWinnerAssetId");
  console.log("  c2-unchanged · entity disposition and identity behave exactly as C2 left them, and the two dialects stay apart");
}

async function main() {
  console.log("P4-SEM-C3 shot media identity");
  contractSection();
  repairSection();
  await surfacesSection();
  await compatibilitySection();
  c2UnchangedSection();
  console.log("P4-SEM-C3 shot media identity passed.");
}

module.exports = { chimbley, SHOT_MEDIA, ID_A, ID_B, ID_C, contractSection, repairSection, surfacesSection, compatibilitySection, c2UnchangedSection, main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
