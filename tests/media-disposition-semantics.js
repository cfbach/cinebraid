/* P4-SEM-C2 — media disposition semantics and durable approval identity.
 *
 * Two claims, and they are the two halves of C2:
 *
 *   SEMANTIC.  An approved image is discoverable on every surface that lists the
 *              media it belongs to. It is marked as approved, it names what it is
 *              authority for, and it is not confused with a candidate or with a
 *              rejected alternate.
 *
 *   IDENTITY.  An approval records WHICH BYTES it approved, so the edge survives
 *              the rename the approval itself performs — and so does every other
 *              edge pointing at the same file, including the coverage and
 *              expression slots the pre-C2 repair never reached.
 *
 * WHY THE SEMANTIC HALF IS TESTED AT ALL, since it looks like presentation:
 * Dogfood Pass #1 (2026-08-12, §7.2) approved a London Rooftops source and then
 * could not find it. public/entities.js built an `approvedNames` Set and
 * subtracted it from BOTH the active and the rejected candidate lists, so the
 * approved authority left the screen; public/coverage-automation.js read the same
 * approvedFile and ranked it first. Two readers, one field, opposite answers. The
 * regression that matters is not "a badge renders" — it is "the approved image is
 * still reachable", and that is asserted against the real rendered surface rather
 * than against a helper this suite could reimplement.
 *
 * NO PAID CALL IS POSSIBLE HERE. The render harness stubs fetch, and the ledger
 * work runs against a temporary projects root with no credentials.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const Disposition = require("../public/shared-media-disposition");
const MediaAssetService = require("../media-asset-service");
const { render, buildFixture } = require("./render-harness");

const ID_A = "asset-" + "a".repeat(32);
const ID_B = "asset-" + "b".repeat(32);

/* The dogfood shape, reduced to the parts that carry the defect: one approved
   authority that two different edges point at, one rejected alternate, one
   undecided candidate. */
function rooftops(extra = {}) {
  return {
    id: "LOC-HULL",
    name: "London Rooftops",
    prefix: "LOC-HULL",
    approvedFile: "LOC-HULL-A.png",
    continuityStates: [{ id: "state-default", name: "Moonlit night", isDefault: true, approvedFile: "LOC-HULL-A.png" }],
    coverageSlots: [{ id: "establishing", label: "Master establishing", requirement: "required", approvedFile: "LOC-HULL-A.png" }],
    candidateFiles: [
      { stored: "LOC-HULL-B.png", decision: "rejected" },
      { stored: "LOC-HULL-C.png", decision: "unreviewed" },
    ],
    ...extra,
  };
}
const ROOFTOP_MEDIA = ["LOC-HULL-A.png", "LOC-HULL-B.png", "LOC-HULL-C.png"]
  .map((name) => ({ name, url: `/assets/plates/${name}` }));

/* ===========================================================================
   1. The contract. */
function contractSection() {
  {
    const entity = rooftops();
    const seen = Disposition.partitionEntityMedia(entity, ROOFTOP_MEDIA);
    assert.deepStrictEqual(seen.approved.map((row) => row.name), ["LOC-HULL-A.png"],
      "the approved authority must be RETURNED by the partition, not subtracted from it");
    assert.deepStrictEqual(seen.candidates.map((row) => row.name), ["LOC-HULL-C.png"]);
    assert.deepStrictEqual(seen.rejected.map((row) => row.name), ["LOC-HULL-B.png"]);
    /* Approval is a relationship, not a property. One image is authority for two
       different things here and a creator choosing between images needs both. */
    assert.deepStrictEqual(seen.approved[0].targets.map((target) => `${target.kind}:${target.label}`),
      ["state:Moonlit night", "coverage:Master establishing"],
      "an approved image must name WHAT it is authority for, not merely that it is approved");
  }

  {
    /* Precedence, inherited rather than invented: the pre-C2 reader excluded
       approved names from the rejected list too, so a rejected candidate that was
       later approved already read as approved. */
    const entity = rooftops();
    entity.candidateFiles.push({ stored: "LOC-HULL-A.png", decision: "rejected" });
    const seen = Disposition.mediaDisposition(entity, "LOC-HULL-A.png");
    assert.strictEqual(seen.role, "approved",
      "a live approval outranks a stale rejection on the same file — the pointer is the newer fact");
    assert.strictEqual(seen.rejected, false);
  }

  {
    /* Absence of identity is legal and is the state of every pre-C2 project. */
    const seen = Disposition.partitionEntityMedia(rooftops(), ROOFTOP_MEDIA);
    assert.strictEqual(seen.approved[0].assetId, "", "a project with no ledger reports no identity, and that is not a defect");
    assert.strictEqual(seen.approved.length, 1, "and it still resolves the approval by filename exactly as before");
  }

  {
    /* Identity-first resolution: the filename on the edge is stale, the bytes moved,
       and the edge still resolves. This is the property C1 handed to C2. */
    const edge = { file: "OLD-NAME.png", assetId: ID_A };
    const media = [{ name: "APPROVED-RENAMED.png", assetId: ID_A }, { name: "OTHER.png", assetId: ID_B }];
    /* Optional chaining rather than a bare dereference: when this guarantee breaks
       the resolver returns null, and a TypeError would not be a usable receipt for
       the negative control that reintroduces exactly that. */
    assert.strictEqual(Disposition.resolveApprovalMedia(edge, media)?.name, "APPROVED-RENAMED.png",
      "an edge carrying identity resolves through the rename that broke its filename");
    assert.strictEqual(Disposition.resolveApprovalMedia({ file: "OTHER.png", assetId: "" }, media)?.name, "OTHER.png",
      "and an edge with no identity still resolves by filename");
    assert.strictEqual(Disposition.resolveApprovalMedia({ file: "GONE.png", assetId: "" }, media), null,
      "an edge that matches nothing resolves to NOTHING — it never guesses a neighbour");
  }

  {
    /* A malformed identity is refused rather than stored. A record carrying one
       would resolve to nothing while looking authoritative; a record carrying none
       falls back to the filename and still works. */
    const slot = {};
    assert.strictEqual(Disposition.stampApprovalIdentity(slot, "LOC-HULL-A.png"), "",
      "a filename is not an identity and must be refused");
    assert.strictEqual(Disposition.stampApprovalIdentity(slot, ""), "");
    assert.deepStrictEqual(slot, {}, "and nothing is written when the value is refused");
    assert.strictEqual(Disposition.stampApprovalIdentity(slot, ID_A), ID_A);
    assert.strictEqual(slot.approvedAssetId, ID_A);
  }

  {
    /* NOTHING IS MUTATED BY A READ — a legacy project must not be canonicalised
       merely by being rendered. ensureEntityStateList() normalises, which is why this
       module never calls it. */
    const entity = { id: "LOC-BARE", approvedFile: "ONLY.png" };
    const before = JSON.stringify(entity);
    Disposition.partitionEntityMedia(entity, [{ name: "ONLY.png" }]);
    Disposition.staleApprovalEdges(entity, [{ name: "ONLY.png" }]);
    assert.strictEqual(JSON.stringify(entity), before, "a disposition read must write nothing back");
    /* And a stateless entity still reports its primary approval. */
    const seen = Disposition.partitionEntityMedia(entity, [{ name: "ONLY.png" }]);
    assert.strictEqual(seen.approved.length, 1, "an entity with no continuity states still has an approved primary");
    assert.strictEqual(seen.approved[0].targets[0].kind, "primary");
  }

  {
    /* Stale pointers are DERIVED, never stored. */
    const entity = rooftops();
    const stale = Disposition.staleApprovalEdges(entity, [{ name: "LOC-HULL-C.png" }]);
    assert.deepStrictEqual(stale.map((edge) => edge.kind), ["state", "coverage"],
      "both edges pointing at a file that is no longer on disk are reported");
    assert(!("staleApprovals" in entity), "and nothing about it is written into the document");
  }
  console.log("  contract · approved/candidate/rejected, approval targets, identity-first resolution, refusal of malformed ids, read purity, derived staleness");
}

/* ===========================================================================
   2. The rename repair — the defect C2 exists to close. */
function repairSection() {
  {
    const entity = rooftops();
    const repaired = Disposition.repairApprovalIdentity(entity, { from: "LOC-HULL-A.png", to: "LOC-HULL-APPROVED.png", assetId: ID_A });

    /* THE MISS. Before C2 the approval rename patched states, entity.approvedFile,
       the candidate row and generatedCandidates[] — and never coverageSlots[]. A
       coverage slot approving the renamed file was left pointing at a filename
       that no longer existed. */
    assert.strictEqual(entity.coverageSlots[0].approvedFile, "LOC-HULL-APPROVED.png",
      "the coverage slot must be repaired — this is the edge the pre-C2 rename silently broke");
    assert.strictEqual(entity.continuityStates[0].approvedFile, "LOC-HULL-APPROVED.png");
    assert.strictEqual(entity.approvedFile, "LOC-HULL-APPROVED.png");
    assert(repaired.some((row) => row.kind === "coverage"), "and the repair reports what it touched rather than leaving it to be inferred");

    /* Identity was recorded while both names were known, which is the only moment
       CineBraid can prove they are the same media. */
    assert.strictEqual(entity.coverageSlots[0].approvedAssetId, ID_A);
    assert.strictEqual(entity.continuityStates[0].approvedAssetId, ID_A);

    /* And the whole point: the SECOND rename is resolvable by identity even
       against a listing where the filename has moved again. */
    const edges = Disposition.approvalEdges(entity);
    const moved = [{ name: "MOVED-AGAIN.png", assetId: ID_A }];
    assert.strictEqual(Disposition.resolveApprovalMedia(edges[0], moved).name, "MOVED-AGAIN.png",
      "once an edge carries identity, a later rename no longer breaks it");
  }

  {
    /* Expression slots, the other collection the pre-C2 repair never reached. */
    const entity = rooftops({ expressionSlots: [{ id: "neutral", label: "Neutral", approvedFile: "LOC-HULL-A.png" }] });
    Disposition.repairApprovalIdentity(entity, { from: "LOC-HULL-A.png", to: "RENAMED.png", assetId: ID_A });
    assert.strictEqual(entity.expressionSlots[0].approvedFile, "RENAMED.png");
  }

  {
    /* A rename with no anchored identity still repairs the filenames. An
       unanchored rename is the pre-C1 state, not a reason to break an approval. */
    const entity = rooftops();
    Disposition.repairApprovalIdentity(entity, { from: "LOC-HULL-A.png", to: "RENAMED.png", assetId: "" });
    assert.strictEqual(entity.coverageSlots[0].approvedFile, "RENAMED.png");
    assert.strictEqual("approvedAssetId" in entity.coverageSlots[0], false,
      "and it records no identity rather than inventing one");
  }

  {
    /* A default state whose own approvedFile is empty resolves THROUGH the
       entity's. Its edge reports the old name without holding it, and the repair
       must not write a key the document did not have — P0 §8 rule 9, and what the
       pre-C2 repair also never did. */
    const entity = {
      id: "LOC", approvedFile: "A.png",
      continuityStates: [{ id: "state-default", name: "Default", isDefault: true }],
    };
    Disposition.repairApprovalIdentity(entity, { from: "A.png", to: "B.png", assetId: ID_A });
    assert.strictEqual(entity.approvedFile, "B.png", "the entity's own pointer moves");
    assert.strictEqual("approvedFile" in entity.continuityStates[0], false,
      "while a state that only INHERITED the name does not acquire one");
    assert.strictEqual("approvedAssetId" in entity.continuityStates[0], false,
      "and acquires no identity either");
  }

  {
    /* An unrelated file's rename must not disturb an approval. */
    const entity = rooftops();
    const before = JSON.stringify(entity);
    Disposition.repairApprovalIdentity(entity, { from: "LOC-HULL-C.png", to: "SOMETHING.png", assetId: ID_B });
    assert.strictEqual(entity.coverageSlots[0].approvedFile, "LOC-HULL-A.png", "the approved authority is untouched");
    assert.notStrictEqual(JSON.stringify(entity), before, "while the candidate row that did move is updated");
    assert.strictEqual(entity.candidateFiles[1].stored, "SOMETHING.png");
  }
  console.log("  repair · coverage and expression slots repaired, identity recorded at the one provable moment, unanchored renames still safe");
}

/* ===========================================================================
   3. The real surfaces. Two readers, one answer. */
async function surfacesSection(options = {}) {
  const project = buildFixture();
  const location = project.locations.find((row) => row.id === "LOC-HULL") || project.locations[0];
  Object.assign(location, rooftops({ id: location.id, prefix: location.prefix || location.id }));

  const scan = {
    anchors: [], props: [], vehicles: [], audio: [], media: [], shots: {},
    plates: ROOFTOP_MEDIA.map((item) => ({ ...item })),
  };
  const rendered = await render(`#/location/${location.id}`, project, {
    ...options,
    scan,
    storage: { [`cinebraid-focused:fixture:entity-task:locations:${location.id}`]: "review" },
  });
  const html = rendered.context.document.getElementById("main").innerHTML;

  /* THE DOGFOOD REGRESSION. The approved image must be ON the Choose & approve
     surface. This is asserted against the rendered DOM, not against the partition
     helper, because the defect was that a real screen dropped it. */
  /* Asserted on the CARD, not on the filename. The entity header prints the
     approved filename too, so a substring match would still pass with the image
     missing from the selector — which is precisely the state being guarded
     against. */
  assert(html.includes(`data-candidate-file="LOC-HULL-A.png"`),
    "the approved authority must appear on the Choose & approve surface — Dogfood Pass #1 lost exactly this image from exactly this screen");
  assert(html.includes("entity-approved-authority"),
    "and it must be presented as approved authority rather than mixed into the undecided candidates");
  assert(html.includes(`data-media-role="approved"`),
    "the surface must carry enough semantic information to distinguish approved from unapproved media");
  assert(html.includes("Master establishing"),
    "and it must say what the image is authority FOR, not merely that it is approved");
  /* The other two are still where they were. */
  assert(html.includes("LOC-HULL-C.png"), "undecided candidates remain available to choose from");
  assert(html.includes(`data-media-role="candidate"`), "and are marked as candidates rather than as authority");

  /* Two readers, one answer. coverage-automation.js resolves the reference
     package through its own function; the partition resolves it through the
     shared one. Proving they agree is worth nothing if the test reimplements
     either, so both are called for real inside the page's own context. */
  const agreement = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const entity = P.locations.find((row) => row.id === ${JSON.stringify(location.id)});
    const media = entityMedia("locations", entity);
    const partition = partitionEntityMedia(entity, media);
    return {
      manual: partition.approved.map((row) => row.name),
      automation: (window.__CINEBRAID_COVERAGE_AUTOMATION.coverageReferencePackage("locations", entity) || []).map((row) => row.item.name),
      roles: media.map((item) => mediaDisposition(entity, item.name).role),
    };
  })())`, rendered.context));
  assert.deepStrictEqual(agreement.manual, ["LOC-HULL-A.png"]);
  assert(agreement.automation.includes("LOC-HULL-A.png"),
    "coverage automation must resolve the same approved authority the manual surface now shows");
  assert.deepStrictEqual(agreement.roles, ["approved", "rejected", "candidate"],
    "and every item resolves to exactly one role, through the one resolver");
  /* Dogfood §7.1, the same invariant in a dropdown: a coverage selector listing
     approved and unapproved media together must say which is which, or a creator
     can pick an unapproved image believing they are working from canon. */
  /* The sub-view key was added by Batch 2 Slice 3. `What this production needs`
     leads with a demand list and keeps the angle / expression / continuity boards
     behind a toggle, so a suite that wants to inspect the coverage SELECTOR has to
     select that board the way a filmmaker would. The Dogfood §7.1 invariant below
     is unchanged and is still asserted against exactly that selector. */
  const coverage = await render(`#/location/${location.id}`, project, {
    ...options,
    scan,
    storage: {
      [`cinebraid-focused:fixture:entity-task:locations:${location.id}`]: "coverage",
      [`cinebraid-bounded:fixture:selected:entity-coverage-view:locations:${location.id}`]: "coverage",
    },
  });
  const coverageHtml = coverage.context.document.getElementById("main").innerHTML;
  assert(coverageHtml.includes(`data-media-role="approved"`),
    "the coverage selector must mark which of its options is already approved");
  /* Both authorities, not just the one this editor happens to be about. The image
     is canon for the continuity state AND the coverage view, and a creator about
     to replace it needs to know the full extent of what they are replacing. */
  /* CHANGED IN BATCH 1D — the labels are unchanged, the word in front of them
     is not.

     OLD EXPECTATION: "— approved · Moonlit night · Master establishing". The
     fixture declares those two edges and carries NO authority ledger, so under
     1D-04 nobody has approved this image and the selector must not say they
     have. The 1C acceptance audit's MB-1C-04 is exactly this sentence appearing
     for a project with no receipts in it.

     WHAT THIS ASSERTION IS FOR IS UNCHANGED and is still asserted in full: a
     creator about to replace an option is told EVERYTHING that option is
     already used for — both edges, not just the one this editor is about — so
     the consequence of replacing it is visible. That was always the point; the
     approval claim was riding along beside it. */
  assert(coverageHtml.includes("— selected, not approved · Moonlit night · Master establishing"),
    "name everything that option is already used for, so replacing it is visibly consequential");
  assert(!coverageHtml.includes("— approved · Moonlit night"),
    "and do not call it approved while no receipt says a person did");
  assert(coverageHtml.includes(`data-media-role="rejected"`),
    "a rejected alternate must not be offered as though it were undecided");

  console.log("  surfaces · the approved authority is reachable on Choose & approve, marked, named, identical to what automation resolves, and distinguished in the coverage selector");
  return { html, agreement };
}

/* ===========================================================================
   4. Compatibility with a project that has never seen C2. */
async function compatibilitySection(options = {}) {
  const project = buildFixture();
  const location = project.locations.find((row) => row.id === "LOC-HULL") || project.locations[0];
  /* The realistic post-C1, pre-C2 project: the LEDGER knows every file's identity
     and project.json carries none. That is the interesting case — a scan with no
     ids could not distinguish "never writes identity" from "had nothing to write". */
  Object.assign(location, rooftops({ id: location.id, prefix: location.prefix || location.id }));
  const before = JSON.parse(JSON.stringify(location));

  const scan = {
    anchors: [], props: [], vehicles: [], audio: [], media: [], shots: {},
    plates: ROOFTOP_MEDIA.map((item, index) => ({ ...item, assetId: index ? ID_B : ID_A })),
  };
  const rendered = await render(`#/location/${location.id}`, project, {
    ...options,
    scan,
    storage: { [`cinebraid-focused:fixture:entity-task:locations:${location.id}`]: "review" },
  });
  const after = JSON.parse(vm.runInContext(
    `JSON.stringify(P.locations.find((row) => row.id === ${JSON.stringify(location.id)}))`, rendered.context));

  /* Rendering a legacy project must not stamp identity into it. Identity is
     written by an explicit approval, never by looking at a screen.

     The coverage collection legitimately GROWS on render — ensureCoverageSlots()
     seeds the template, which is long-standing behaviour this batch does not
     touch. So the claim is asserted precisely rather than by comparing the whole
     array: every approval pointer says what it said, and no identity was minted. */
  assert(!JSON.stringify(after).includes("approvedAssetId"),
    "no identity field appears anywhere in a project that was only read");
  assert.strictEqual(after.approvedFile, before.approvedFile);
  assert.strictEqual(after.continuityStates[0].approvedFile, before.continuityStates[0].approvedFile);
  /* The slot value moved key during load — `approvedFile` became `selectedFile`,
     because a supporting reference must not carry the word approved. The VALUE
     is what this assertion is about, and it is unchanged. */
  const slotAfter = after.coverageSlots.find((slot) => slot.id === "establishing");
  assert.strictEqual(slotAfter.selectedFile || slotAfter.approvedFile,
    before.coverageSlots[0].selectedFile || before.coverageSlots[0].approvedFile,
    "the selected view still points where it pointed");
  assert.deepStrictEqual(after.candidateFiles.map((row) => `${row.stored}:${row.decision}`),
    before.candidateFiles.map((row) => `${row.stored}:${row.decision}`), "and no candidate decision moved");
  console.log("  compatibility · a pre-C2 project renders identically and acquires no identity merely by being opened");
}

/* ===========================================================================
   5. The identity projection — the one way an id reaches the browser. */
function projectionSection() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-c2-"));
  try {
    const dir = path.join(root, "proj");
    fs.mkdirSync(path.join(dir, "plates"), { recursive: true });
    fs.writeFileSync(path.join(dir, "media-assets.json"), JSON.stringify({
      schemaVersion: 1,
      assets: [
        { assetId: ID_A, storage: { path: "plates/LOC-HULL-A.png", bytes: 4, mtimeMs: 1 } },
        { assetId: ID_B, storage: { path: "plates/GONE.png", bytes: 4, mtimeMs: 1, missing: true } },
      ],
    }));
    const index = MediaAssetService.identityIndex({ projectsRoot: root, slug: "proj" });
    assert.strictEqual(index.get("plates/LOC-HULL-A.png"), ID_A, "a live row projects its identity");
    assert.strictEqual(index.has("plates/GONE.png"), false,
      "a row retained for a file that has disappeared must never answer for a path a live file may now occupy");

    /* Never throws, and containment holds. */
    fs.writeFileSync(path.join(dir, "media-assets.json"), "{ not json");
    assert.strictEqual(MediaAssetService.identityIndex({ projectsRoot: root, slug: "proj" }).size, 0,
      "an unreadable ledger yields no identity rather than failing a media listing");
    assert.strictEqual(MediaAssetService.identityIndex({ projectsRoot: root, slug: "../escape" }).size, 0,
      "and the projection cannot be pointed outside the projects root");
    assert.strictEqual(MediaAssetService.identityIndex({ projectsRoot: root, slug: "absent" }).size, 0,
      "a project with no ledger is the normal state, not an error");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("  projection · identity crosses to the client for live rows only, and never throws into a response");
}

async function main() {
  console.log("P4-SEM-C2 media disposition semantics");
  contractSection();
  repairSection();
  await surfacesSection();
  await compatibilitySection();
  projectionSection();
  console.log("P4-SEM-C2 media disposition semantics passed.");
}

module.exports = { rooftops, ROOFTOP_MEDIA, contractSection, repairSection, surfacesSection, compatibilitySection, projectionSection, main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
