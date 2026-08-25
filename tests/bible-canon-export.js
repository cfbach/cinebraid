/* CineBraid — Public Alpha UX Slice 2: CANON-SAFE PROJECT BIBLE + EXPORT V1.
 *
 * THE QUESTION THIS SUITE GOVERNS, and there is exactly one:
 *
 *     MAY THE PROJECT BIBLE CALL THIS CURRENT APPROVED CANON?
 *
 * The convergence audit found one blocker-grade answer that was wrong.
 *
 *   P0  A shot frame held an approved image from revision R1. A targeted repair
 *       draft was authored against it — openCandidateCorrection() registers the
 *       draft into `frame.generationPackages` the moment the repair modal OPENS —
 *       and nothing was generated and nothing was approved. The Bible nevertheless
 *       published the draft's instructions
 *
 *           "CORRECT THE EXISTING FRAME / Edit #image1 rather than creating a new
 *            composition. / CORRECTIONS / The left glove is the wrong colour."
 *
 *       under FRAME PACKAGE, beneath the R1 image, on a page headed "Latest
 *       approved canon". The same draft became the shot's headline `prompt`.
 *
 * WHY IT HAPPENED, in one line: the Bible gated its MEDIA on the authority ledger
 * and chose its PROMPTS by recency. Two different rules for two halves of one
 * claim, and only one of them was a rule about approval.
 *
 * WHAT THE FIX IS: public/shared-bible-canon.js. A prompt reaches the Bible only
 * through the approved bytes it produced —
 *
 *     current receipt -> receipt.value -> the candidate row filing that file
 *                     -> sourceBuildId -> the prompt library
 *
 * — and if any link is missing the answer is ABSENT, never "the newest package".
 * The same projection answers the screen and the export, so this suite spends most
 * of its checks on AGREEMENT rather than on either surface alone.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It forms no opinion about what an approval is.
 * Every canon answer it checks came from the shipped authority kernel through the
 * shipped projection; a receipt this suite decided to honour itself would be the
 * defect wearing a test's clothes.
 *
 * NO PROJECT DATA IS TOUCHED. NO PROVIDER OR PAID CALL IS MADE. One disposable
 * server is started, under a temporary config and projects root, for the route
 * half; every other check is a pure function call.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");

let checks = 0;
const notes = [];
const note = (line) => notes.push(line);
const ok = (value, message) => { checks += 1; assert(value, message); };
const equal = (actual, expected, message) => { checks += 1; assert.strictEqual(actual, expected, message); };
const deepEqual = (actual, expected, message) => { checks += 1; assert.deepStrictEqual(actual, expected, message); };
const absent = (haystack, needle, message) => { checks += 1; assert(!String(haystack).includes(needle), message); };
const present = (haystack, needle, message) => { checks += 1; assert(String(haystack).includes(needle), message); };

/* Line endings are normalised on read: this repository checks out with
   core.autocrlf=true, so an anchor written with \n would match nothing. */
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

/* ===========================================================================
   LOADING THE SHIPPED MODULE, optionally mutated.

   `new Function` rather than `vm.runInNewContext`, deliberately: a vm realm gives
   back arrays and objects whose prototypes are not the host's, and
   deepStrictEqual then fails against host literals while printing identical JSON.
   Everything below stays in one realm.

   The `require` shim is also a proof, used by EXP8: the module may reach exactly
   two files, and anything else — a network client above all — throws by name.
   =========================================================================== */
const ALLOWED_REQUIRES = ["./shared-production-authority.js", "./shared-build-history.js"];
function loadBibleCanon(mutate) {
  let source = readLF("public/shared-bible-canon.js");
  if (mutate) source = mutate(source);
  const factory = new Function("module", "exports", "require", source);
  const shim = (id) => {
    if (!ALLOWED_REQUIRES.includes(id)) {
      throw new Error(`the Bible projection reached for "${id}", which it may not require`);
    }
    return require(path.join(ROOT, "public", id.replace(/^\.\//, "")));
  };
  const holder = { exports: {} };
  factory(holder, holder.exports, shim);
  return holder.exports;
}
const BibleCanon = loadBibleCanon();

/* ===========================================================================
   FIXTURES.

   Every approval is a full, valid receipt whose live edge agrees with it, because
   the kernel fails closed on anything less and a fixture that gets it wrong would
   look like a product bug. Nothing here fabricates history: each case states what
   a person did, and the ledger says the same thing.
   =========================================================================== */

const COMMAND_FOR_KIND = {
  "shot-frame": "approve-shot-frame",
  "shot-motion": "approve-shot-motion",
  "shot-delivery": "approve-shot-delivery",
  "entity-state": "approve-entity-state",
};
const targetKey = (t) =>
  t.kind === "shot-frame" ? `shot-frame:${t.shotId}#${t.frameId}`
  : t.kind === "shot-motion" ? `shot-motion:${t.shotId}#${t.unitKey}`
  : t.kind === "shot-delivery" ? `shot-delivery:${t.shotId}`
  : `entity-state:${t.list}:${t.entityId}#${t.stateId}`;

function approve(P, target, value, options = {}) {
  const receipts = P.productionAuthority.receipts;
  const sequence = receipts.length + 1;
  const row = {
    id: options.id || `authority-${String(sequence).padStart(6, "0")}`,
    sequence,
    actor: "human",
    act: "explicit-approval",
    command: COMMAND_FOR_KIND[target.kind],
    kind: target.kind,
    targetKey: targetKey(target),
    shotId: target.shotId || "",
    frameId: target.frameId || "",
    unitKey: target.unitKey || "",
    list: target.list || "",
    entityId: target.entityId || "",
    stateId: target.stateId || "",
    slotId: "",
    value,
    assetId: options.assetId || "",
    at: options.at || "2026-08-20T00:00:00.000Z",
    status: options.status || "current",
    supersededBy: options.supersededBy || "",
    supersededAt: options.supersededAt || "",
    revokedAt: options.revokedAt || "",
    revocationReason: options.revocationReason || "",
    note: "",
    provenance: { manualAction: `gesture-fixture-${sequence}`, via: "bible-canon-fixture", gesture: "click" },
  };
  receipts.push(row);
  return row;
}

/* The three prompts every shot scenario is built from. They are deliberately
   unmistakable for one another in a grep of an exported file. */
const P1 = "Wide hull-camera composition. The worker stands at the open panel, sodium key light from frame left.";
const P2_REPAIR = "CORRECT THE EXISTING FRAME\nEdit #image1 rather than creating a new composition.\n\nCORRECTIONS\nThe left glove is the wrong colour. Repaint it oxide red.";
const P3 = "Wide hull-camera composition, oxide-red left glove, sodium key light from frame left.";

function baseProject() {
  return {
    meta: {
      title: "Canon Test Project",
      format: "Short film",
      version: "v1",
      hubVersion: "v5.5.0",
      models: [{ id: "m-img", name: "GPT Image 2", type: "image" }],
      defaults: { stillModel: "m-img", videoModel: "" },
      world: { setting: "Industrial station", include: "", reject: "" },
      styleBlocks: [],
    },
    qcChecklist: ["Identity holds", "Geometry holds"],
    scenes: [{ id: "SC-01", title: "Maintenance Bay" }],
    characters: [], locations: [], props: [], vehicles: [], audio: [],
    shots: [],
    promptBuildsById: {},
    promptSnapshotsById: {},
    productionAuthority: { version: 1, receipts: [] },
  };
}

function addBuild(P, id, packageId, prompt, extra = {}) {
  P.promptBuildsById[id] = {
    id, packageId, prompt,
    kind: extra.kind || "guided-frame",
    scope: extra.scope || "frame:frame-a",
    profileId: "gpt-image-2/t2i",
    profileName: extra.profileName || "GPT Image 2",
    references: extra.references || [],
    revision: extra.revision || 1,
    revisionReason: extra.revisionReason || "compiled",
  };
  return id;
}

/* ONE LOCKED SHOT WITH ONE FRAME, plus the prompt library and candidate rows the
   product writes at generation. Every scenario below is this shape with one thing
   changed, so a difference in the result is attributable to that one thing. */
function frameShot(options = {}) {
  const P = baseProject();
  addBuild(P, "b-p1", "S-01-A-R01", P1);
  addBuild(P, "b-p3", "S-01-A-R02", P3, { revision: 2 });
  addBuild(P, "b-repair", "S-01-A-CORRECTION-R02", P2_REPAIR, { kind: "candidate-correction", revisionReason: "candidate-correction", revision: 2 });
  P.shots.push({
    id: "S-01",
    scene: "SC-01",
    title: "Hull check",
    desc: "A worker checks the hull.",
    status: "LOCKED",
    workflowStatus: "APPROVED",
    route: "frames-to-motion",
    dur: 6,
    keyframes: [{
      id: "frame-a", label: "A", title: "Opening frame", description: "Worker at panel.",
      required: true,
      winner: options.winner === undefined ? "R1.png" : options.winner,
      generationPackages: (options.packages || ["b-p1"]).map((buildId) => ({ buildId, scope: "frame:frame-a" })),
    }],
    clips: [],
    candidateFiles: options.candidates || [
      { stored: "R1.png", original: "R1.png", frameId: "frame-a", decision: "shortlist", approvedAt: "2026-08-20T00:00:00.000Z", sourceBuildId: "b-p1", sourcePackageId: "b-p1" },
    ],
    promptBuilds: [],
    generationPackages: [],
    creationBrief: {},
  });
  return P;
}

const SHOT_MEDIA = (names) => (shotId) => (shotId === "S-01" ? names.map((name) => ({ name, url: `/assets/shots/S-01/takes/${name}` })) : []);

function project(P, options = {}) {
  return BibleCanon.bibleCanonProjection(P, {
    media: options.media || {},
    shotMedia: options.shotMedia || SHOT_MEDIA(["R1.png", "R2.png"]),
    ownedMedia: options.ownedMedia,
    modelName: (id) => (P.meta.models || []).find((m) => m.id === id)?.name || "",
  });
}
const frameOf = (doc) => doc.shots[0].keyframes[0];

/* An entity scenario: two continuity states, each generated by its own request, so
   a projection that let one state answer for another is visible immediately. */
function entityProject() {
  const P = baseProject();
  P.characters.push({
    id: "CHAR-KAI",
    name: "Kai",
    notes: "Hull technician, second shift.",
    block: "KAI — 34, close-cropped hair, oil-stained utility coat, steel-toed boots.",
    driftNotes: "The coat gets dirtier as the film runs; never cleaner.",
    approvedFile: "KAI_DEFAULT.png",
    continuityStates: [
      { id: "state-default", name: "Work coat", isDefault: true, approvedFile: "KAI_DEFAULT.png", notes: "Default authority." },
      { id: "state-burned", name: "Burned coat", approvedFile: "KAI_BURNED.png", appliesTo: "After the fire" },
    ],
    candidateFiles: [
      { stored: "KAI_DEFAULT.png", decision: "shortlist", prompt: "Kai in a clean work coat, three-quarter portrait, neutral studio light.", generationModel: "gpt-image-2", sourceBuildId: "b-kai-default" },
      { stored: "KAI_BURNED.png", decision: "shortlist", prompt: "Kai in a fire-scorched work coat, three-quarter portrait, neutral studio light.", generationModel: "gpt-image-2", sourceBuildId: "b-kai-burned" },
    ],
    made: [],
    prompts: [],
  });
  P.characters.push({
    id: "CHAR-RHEA",
    name: "Rhea",
    notes: "Deck supervisor.",
    block: "RHEA — 41, silver braid, quilted flight jacket.",
    approvedFile: "RHEA_DEFAULT.png",
    continuityStates: [{ id: "state-default", name: "Flight jacket", isDefault: true, approvedFile: "RHEA_DEFAULT.png" }],
    candidateFiles: [{ stored: "RHEA_DEFAULT.png", decision: "shortlist", prompt: "Rhea in a quilted flight jacket, three-quarter portrait.", generationModel: "gpt-image-2", sourceBuildId: "b-rhea-default" }],
  });
  approve(P, { kind: "entity-state", list: "characters", entityId: "CHAR-KAI", stateId: "state-default" }, "KAI_DEFAULT.png");
  approve(P, { kind: "entity-state", list: "characters", entityId: "CHAR-KAI", stateId: "state-burned" }, "KAI_BURNED.png");
  approve(P, { kind: "entity-state", list: "characters", entityId: "CHAR-RHEA", stateId: "state-default" }, "RHEA_DEFAULT.png");
  return P;
}
const ANCHOR_POOL = ["KAI_DEFAULT.png", "KAI_BURNED.png", "RHEA_DEFAULT.png", "KAI_REJECTED.png"]
  .map((name) => ({ name, url: `/assets/anchors/${name}` }));

/* ===========================================================================
   BIBLE1 - BIBLE10
   =========================================================================== */

function bibleCases() {
  /* ---- BIBLE1. A current approved revision. The Bible shows the
     authority-linked representation, and the prompt names the bytes it made. */
  {
    const P = frameShot();
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const frame = frameOf(project(P));
    equal(frame.winner.name, "R1.png", "BIBLE1: canon media is the approved file");
    equal(frame.authority.receiptId, "authority-000001", "BIBLE1: the canon item cites the receipt that supports it");
    equal(frame.authority.value, "R1.png", "BIBLE1: the receipt names the same bytes the page shows");
    equal(frame.package.prompt, P1, "BIBLE1: the published prompt is the one that produced the approved image");
    equal(frame.package.boundTo, "R1.png", "BIBLE1: the prompt states which approved bytes it produced");
    equal(frame.package.source, "prompt-build", "BIBLE1: the link resolved through the prompt library");
    equal(frame.representationStatus, "current", "BIBLE1: the representation is current");
    note("BIBLE1  approved revision publishes its own prompt, bound to its own bytes");
  }

  /* ---- BIBLE1b. THE SAME RULE AT THE DELIVERY EDGE. A shot that declares no
     frames publishes its deliverable's prompt as the shot headline. That headline
     used to be `latestPackage -> latestBuild -> promptOptions.favorite ->
     promptOptions[0]`: four fallbacks, not one of them an approval. */
  {
    const P = frameShot();
    P.shots[0].keyframes = [];
    P.shots[0].promptOptions = [{ id: "OPT-1", favorite: true, text: "A favourite draft nobody approved." }];
    P.shots[0].candidateFiles = [{ stored: "DELIVERY.mp4", sourceBuildId: "b-p1" }];
    P.shots[0].creationBrief = { approvedMotionFile: "DELIVERY.mp4" };
    approve(P, { kind: "shot-delivery", shotId: "S-01" }, "DELIVERY.mp4");
    const doc = project(P, { shotMedia: SHOT_MEDIA(["DELIVERY.mp4"]) });
    const shot = doc.shots[0];
    equal(shot.delivery.winner.name, "DELIVERY.mp4", "BIBLE1b: the approved deliverable is canon media");
    equal(shot.winner.name, "DELIVERY.mp4", "BIBLE1b: and is the shot headline when no frame holds canon");
    equal(shot.prompt.text, P1, "BIBLE1b: the headline prompt is the deliverable's, not the favourite draft");
    equal(shot.prompt.boundTo, "DELIVERY.mp4", "BIBLE1b: bound to the approved bytes");
    absent(JSON.stringify(shot), "A favourite draft", "BIBLE1b: a favourited draft is not canon");
    ok(doc.appendix.some((row) => row.material === "saved-prompt" && row.label === "OPT-1"),
      "BIBLE1b: it is supporting material instead");
    present(BibleCanon.bibleCanonMarkdown(doc, { preset: "canon" }), "Approved deliverable: `DELIVERY.mp4`",
      "BIBLE1b: and the export names it as the deliverable rather than repeating a frame");
    note("BIBLE1b the delivery edge publishes its own prompt, and a favourited draft is not an approval");
  }

  /* ---- BIBLE2. THE P0. Approved R1 plus an unexecuted targeted-repair draft.
     Nothing was generated from the draft and nobody approved anything new. */
  {
    const P = frameShot({ packages: ["b-p1", "b-repair"] });
    P.shots[0].candidateFiles[0].correctionBuildIds = ["b-repair"];
    P.shots[0].candidateFiles[0].currentCorrectionBuildId = "b-repair";
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const doc = project(P);
    const frame = frameOf(doc);
    equal(frame.winner.name, "R1.png", "BIBLE2: canon media stays on R1");
    equal(frame.package.prompt, P1, "BIBLE2: canon stays on P1 — the repair draft does not replace it");
    absent(JSON.stringify(doc.shots), "oxide red", "BIBLE2: the repair draft appears nowhere in the shot canon");
    ok(doc.appendix.length === 0 || !doc.appendix.some((row) => row.status === "current"),
      "BIBLE2: nothing in supporting material claims to be current");
    note("BIBLE2  the unexecuted targeted-repair draft never becomes canon (the P0)");
  }

  /* ---- BIBLE3. R2 was generated. Nobody approved it. */
  {
    const P = frameShot({
      packages: ["b-p1", "b-p3"],
      candidates: [
        { stored: "R1.png", frameId: "frame-a", decision: "shortlist", sourceBuildId: "b-p1" },
        { stored: "R2.png", frameId: "frame-a", decision: "unreviewed", sourceBuildId: "b-p3" },
      ],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const doc = project(P);
    equal(frameOf(doc).winner.name, "R1.png", "BIBLE3: an unapproved candidate does not become canon media");
    equal(frameOf(doc).package.prompt, P1, "BIBLE3: an unapproved candidate's prompt does not become canon");
    absent(JSON.stringify(doc.shots), "oxide-red left glove", "BIBLE3: R2's prompt is absent from canon");
    note("BIBLE3  a generated but unapproved candidate leaves canon untouched");
  }

  /* ---- BIBLE4. R2 was generated and REJECTED. */
  {
    const P = frameShot({
      packages: ["b-p1", "b-p3"],
      candidates: [
        { stored: "R1.png", frameId: "frame-a", decision: "shortlist", sourceBuildId: "b-p1" },
        { stored: "R2.png", frameId: "frame-a", decision: "rejected", sourceBuildId: "b-p3" },
      ],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const doc = project(P);
    equal(frameOf(doc).winner.name, "R1.png", "BIBLE4: a rejected candidate does not become canon media");
    equal(frameOf(doc).package.prompt, P1, "BIBLE4: a rejected candidate's prompt does not become canon");
    note("BIBLE4  a rejected candidate leaves canon untouched");
  }

  /* ---- BIBLE5. R2 was approved and supersedes R1. Canon moves. */
  {
    const P = frameShot({
      winner: "R2.png",
      packages: ["b-p1", "b-p3"],
      candidates: [
        { stored: "R1.png", frameId: "frame-a", decision: "shortlist", sourceBuildId: "b-p1" },
        { stored: "R2.png", frameId: "frame-a", decision: "shortlist", sourceBuildId: "b-p3" },
      ],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png",
      { status: "superseded", supersededBy: "authority-000002", supersededAt: "2026-08-21T00:00:00.000Z" });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R2.png", { at: "2026-08-21T00:00:00.000Z" });
    const frame = frameOf(project(P));
    equal(frame.winner.name, "R2.png", "BIBLE5: canon media follows the new approval");
    equal(frame.package.prompt, P3, "BIBLE5: the published prompt follows the new approval");
    equal(frame.package.boundTo, "R2.png", "BIBLE5: and is bound to the new bytes");
    equal(frame.authority.receiptId, "authority-000002", "BIBLE5: the canon item cites the current receipt, not the superseded one");
    note("BIBLE5  an approved supersession moves canon, prompt and receipt together");
  }

  /* ---- BIBLE6. The R2 approval is withdrawn. The Bible must follow current
     authority — which is now nothing — and must NOT fall back to the newest
     surviving row, because R1's receipt is superseded and nobody restored it. */
  {
    const P = frameShot({
      winner: "R2.png",
      packages: ["b-p1", "b-p3"],
      candidates: [
        { stored: "R1.png", frameId: "frame-a", decision: "shortlist", sourceBuildId: "b-p1" },
        { stored: "R2.png", frameId: "frame-a", decision: "shortlist", sourceBuildId: "b-p3" },
      ],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png",
      { status: "superseded", supersededBy: "authority-000002", supersededAt: "2026-08-21T00:00:00.000Z" });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R2.png",
      { status: "revoked", revokedAt: "2026-08-22T00:00:00.000Z", revocationReason: "withdrawn", at: "2026-08-21T00:00:00.000Z" });
    const doc = project(P);
    const frame = frameOf(doc);
    equal(frame.winner, null, "BIBLE6: a withdrawn approval leaves no canon media");
    equal(frame.authority, null, "BIBLE6: and no authority to cite");
    equal(frame.package, null, "BIBLE6: and no canon prompt");
    absent(JSON.stringify(doc.shots), P1, "BIBLE6: the Bible does not fall back to the superseded R1 prompt");
    absent(JSON.stringify(doc.shots), P3, "BIBLE6: nor does it keep the revoked R2 prompt");
    ok(doc.appendix.some((row) => row.status === "historic" && row.detail === "R2.png"),
      "BIBLE6: the withdrawn selection is kept as supporting material, truthfully labelled");
    note("BIBLE6  a withdrawn approval removes canon and does not promote the next-newest");
  }

  /* ---- BIBLE7. Historic authority exists; there is no current approval. */
  {
    const P = frameShot();
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png",
      { status: "revoked", revokedAt: "2026-08-22T00:00:00.000Z", revocationReason: "withdrawn" });
    const doc = project(P);
    equal(frameOf(doc).winner, null, "BIBLE7: historic authority is not current canon media");
    equal(frameOf(doc).package, null, "BIBLE7: historic authority publishes no canon prompt");
    const row = doc.appendix.find((entry) => entry.detail === "R1.png");
    ok(row, "BIBLE7: the historic selection is still reported");
    equal(row.status, "historic", "BIBLE7: and is labelled historic, never current");
    note("BIBLE7  historic authority is reported as history and never as canon");
  }

  /* ---- BIBLE8. A stale pointer with no supporting authority at all. */
  {
    const P = frameShot({ winner: "GHOST.png", candidates: [] });
    const doc = project(P, { shotMedia: SHOT_MEDIA(["GHOST.png"]) });
    equal(frameOf(doc).winner, null, "BIBLE8: a pointer nobody approved yields no canon media");
    equal(frameOf(doc).package, null, "BIBLE8: and no canon prompt");
    equal(doc.shots[0].winner, null, "BIBLE8: the shot headline also fails closed");
    ok(doc.appendix.some((row) => row.detail === "GHOST.png" && row.status === "historic"),
      "BIBLE8: the stale pointer is reported as supporting material rather than silently dropped");
    note("BIBLE8  a stale pointer fails closed and is reported, not published");
  }

  /* ---- BIBLE9. Factual canon without an approved visual representation.
     Read two ways, because both are real: an entity with NO approved state at all,
     and a state declared beside an approved one with nothing behind it. */
  {
    const P = entityProject();
    /* (a) an entity whose only state has never been approved. */
    P.characters.push({
      id: "CHAR-VESS", name: "Vess", notes: "Night dispatcher.",
      block: "VESS — 28, shaved head, headset permanently on.",
      continuityStates: [{ id: "state-default", name: "Dispatch", isDefault: true }],
    });
    const doc = project(P, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
    ok(!doc.characters.some((row) => row.id === "CHAR-VESS"),
      "BIBLE9a: an entity with no approved state is not in the canon body");
    equal(doc.pending.characters, 1, "BIBLE9a: it is counted as in progress instead");
    absent(JSON.stringify(doc.characters), "VESS — 28", "BIBLE9a: and no visual canon is invented for it");

    /* (b) an entity that DOES hold canon keeps the factual fields its author
       wrote, which are canonical by authorship and not by any generation. */
    const kai = doc.characters.find((row) => row.id === "CHAR-KAI");
    equal(kai.block, "KAI — 34, close-cropped hair, oil-stained utility coat, steel-toed boots.",
      "BIBLE9b: the filmmaker's own identity block survives as factual canon");
    equal(kai.driftNotes, "The coat gets dirtier as the film runs; never cleaner.",
      "BIBLE9b: as does the drift note");
    note("BIBLE9  factual canon survives; visual canon is never invented");
  }

  /* ---- BIBLE10. No leakage between entities, or between one entity's states. */
  {
    const P = entityProject();
    /* A third state, declared with a pointer and never approved. It is exactly the
       shape that used to print its `approvedFile` under an approved heading. */
    P.characters[0].continuityStates.push({ id: "state-wet", name: "Wet coat", approvedFile: "KAI_REJECTED.png" });
    const doc = project(P, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
    const kai = doc.characters.find((row) => row.id === "CHAR-KAI");
    const rhea = doc.characters.find((row) => row.id === "CHAR-RHEA");
    deepEqual(kai.continuityStates.map((s) => s.id).sort(), ["state-burned", "state-default"],
      "BIBLE10: only approved states are in the canon body");
    deepEqual(kai.continuityStates.map((s) => s.approvedFile).sort(), ["KAI_BURNED.png", "KAI_DEFAULT.png"],
      "BIBLE10: each canon state carries its own approved file");
    equal(kai.continuityStates.find((s) => s.id === "state-default").package.boundTo, "KAI_DEFAULT.png",
      "BIBLE10: the default state's prompt is bound to the default state's bytes");
    equal(kai.continuityStates.find((s) => s.id === "state-burned").package.boundTo, "KAI_BURNED.png",
      "BIBLE10: the burned state's prompt is bound to the burned state's bytes");
    present(kai.continuityStates.find((s) => s.id === "state-burned").package.prompt, "fire-scorched",
      "BIBLE10: and says what that state actually is");
    absent(JSON.stringify(kai.continuityStates.find((s) => s.id === "state-default")), "fire-scorched",
      "BIBLE10: one state's prompt does not leak into another's");
    absent(JSON.stringify(kai), "RHEA", "BIBLE10: one entity's material does not leak into another's");
    absent(JSON.stringify(rhea), "KAI_", "BIBLE10: and not in the other direction");
    absent(JSON.stringify(kai.continuityStates), "KAI_REJECTED.png",
      "BIBLE10: a declared state with an unapproved pointer contributes nothing to canon");
    ok(doc.appendix.some((row) => row.subjectId === "CHAR-KAI" && row.label === "Wet coat" && row.status === "historic"),
      "BIBLE10: that state is reported as supporting material, against the right subject");
    note("BIBLE10 no authority leaks between entities or between one entity's states");
  }
}

/* ===========================================================================
   PROMPT / PACKAGE COHERENCE — the resolver's own failure modes.

   Absence has to be a REASON, not a blank, or "we could not find it" and "there is
   nothing to find" become the same answer and neither is actionable.
   =========================================================================== */

function coherenceCases() {
  const cases = [
    ["a file no candidate row files", [], "no-candidate-record"],
    ["a candidate row that recorded no build", [{ stored: "R1.png" }], "no-recorded-build"],
    ["a candidate row naming a build the library has lost", [{ stored: "R1.png", sourceBuildId: "b-gone" }], "build-unavailable"],
  ];
  for (const [label, candidates, expected] of cases) {
    const P = frameShot({ candidates });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const frame = frameOf(project(P));
    ok(frame.winner, `coherence: ${label} still shows the approved image`);
    equal(frame.package, null, `coherence: ${label} publishes no prompt`);
    equal(frame.representationAbsence, expected, `coherence: ${label} reports "${expected}"`);
  }
  ok(BibleCanon.BIBLE_REPRESENTATION_ABSENCES.length === 4,
    "coherence: the vocabulary of absences is declared once, by the module");

  /* A frozen snapshot on the candidate row is a legitimate answer — it IS the
     record of the build that made these bytes — but only when it is that build. */
  {
    const P = frameShot({
      candidates: [{
        stored: "R1.png", sourceBuildId: "b-gone",
        sourcePackageSnapshot: { id: "b-gone", packageId: "S-01-A-R01", prompt: P1, profileName: "GPT Image 2" },
      }],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const frame = frameOf(project(P));
    equal(frame.package.prompt, P1, "coherence: a frozen snapshot of the row's own build is publishable");
    equal(frame.package.source, "frozen-snapshot", "coherence: and says where it came from");
  }
  {
    const P = frameShot({
      candidates: [{
        stored: "R1.png", sourceBuildId: "b-gone",
        sourcePackageSnapshot: { id: "b-somebody-else", packageId: "OTHER", prompt: P2_REPAIR },
      }],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const frame = frameOf(project(P));
    equal(frame.package, null, "coherence: a snapshot naming a DIFFERENT build is somebody else's provenance");
    equal(frame.representationAbsence, "build-unavailable", "coherence: and is reported as unavailable, not published");
  }

  /* A generation record enters canon only when it names a canon file. */
  {
    const P = entityProject();
    P.characters[0].made = [
      { model: "m-img", files: "KAI_DEFAULT.png", prompt: "The record for the approved default.", date: "2026-08-19" },
      { model: "m-img", files: "KAI_SCRATCH.png", prompt: "The record for a file that is not canon.", date: "2026-08-19" },
    ];
    const doc = project(P, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
    const kai = doc.characters.find((row) => row.id === "CHAR-KAI");
    deepEqual(kai.made.map((row) => row.files), ["KAI_DEFAULT.png"],
      "coherence: only the generation record naming a canon file is in the canon body");
    equal(kai.made[0].modelName, "GPT Image 2", "coherence: and it resolves its model name");
    ok(doc.appendix.some((row) => row.material === "generation-record" && row.label === "KAI_SCRATCH.png"),
      "coherence: the other is supporting material");
  }

  /* Saved draft prompts have no output edge at all and are never canon. */
  {
    const P = entityProject();
    P.characters[0].prompts = [{ id: "PR-01", text: "A saved draft that nothing was ever made from." }];
    const doc = project(P, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
    absent(JSON.stringify(doc.characters), "A saved draft that nothing",
      "coherence: a saved draft prompt is not canon");
    ok(doc.appendix.some((row) => row.material === "saved-prompt" && row.status === "draft"),
      "coherence: it is supporting material, labelled draft");
  }

  /* WHAT SUPPORTING MATERIAL MEANS, pinned so it cannot drift into a dumping
     ground. Coverage and expression slots are supporting selections and the
     projection is handed them, but the Bible has never published them — listing
     them would be new product surface, and there are enough per entity to bury the
     one thing the section exists to say. */
  {
    const P = entityProject();
    P.characters[0].coverageSlots = [
      { id: "cov-front", label: "Front", selectedFile: "KAI_COVERAGE_FRONT.png" },
      { id: "cov-side", label: "Side", selectedFile: "KAI_COVERAGE_SIDE.png" },
    ];
    P.characters[0].expressionSlots = [{ id: "exp-calm", label: "Calm", selectedFile: "KAI_EXP_CALM.png" }];
    const doc = project(P, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
    absent(JSON.stringify(doc.characters), "KAI_COVERAGE_FRONT.png",
      "coherence: a coverage selection is not canon");
    absent(JSON.stringify(doc.appendix), "KAI_COVERAGE_FRONT.png",
      "coherence: nor is it listed as supporting material — supporting material means what the canon filter removed");
    absent(JSON.stringify(doc.appendix), "KAI_EXP_CALM.png",
      "coherence: the same for expression selections");
    /* Every state in this fixture is approved, so the canon filter removed nothing
       and the section is empty — three slots added and not one row. */
    deepEqual(doc.appendix, [],
      "coherence: adding coverage and expression slots adds nothing to supporting material");
  }
  note(`coherence: absence is a reason (${BibleCanon.BIBLE_REPRESENTATION_ABSENCES.join(", ")}), never a silent fallback`);
}

/* ===========================================================================
   EXP1 - EXP8
   =========================================================================== */

function exportCases() {
  const markdown = (P, preset, options) => BibleCanon.bibleCanonMarkdown(project(P, options), { preset });

  /* ---- EXP1. Approved R1 plus an unexecuted repair draft. */
  {
    const P = frameShot({ packages: ["b-p1", "b-repair"] });
    P.shots[0].candidateFiles[0].currentCorrectionBuildId = "b-repair";
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const canon = markdown(P, "canon");
    present(canon, P1, "EXP1: Canon Only exports the approved prompt");
    absent(canon, "oxide red", "EXP1: Canon Only never exports the unexecuted repair draft");
    present(canon, "`R1.png`", "EXP1: and names the approved image");
    note("EXP1  Canon Only exports R1/P1 and never the repair draft");
  }

  /* ---- EXP2. Rejected R2. */
  {
    const P = frameShot({
      packages: ["b-p1", "b-p3"],
      candidates: [
        { stored: "R1.png", frameId: "frame-a", sourceBuildId: "b-p1" },
        { stored: "R2.png", frameId: "frame-a", decision: "rejected", sourceBuildId: "b-p3" },
      ],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const canon = markdown(P, "canon");
    present(canon, P1, "EXP2: Canon Only exports R1");
    absent(canon, "oxide-red left glove", "EXP2: and not the rejected R2's prompt");
    absent(canon, "`R2.png`", "EXP2: and not the rejected file");
    note("EXP2  Canon Only exports R1 when R2 was rejected");
  }

  /* ---- EXP3. Approved R2 supersedes R1. */
  {
    const P = frameShot({
      winner: "R2.png",
      packages: ["b-p1", "b-p3"],
      candidates: [
        { stored: "R1.png", frameId: "frame-a", sourceBuildId: "b-p1" },
        { stored: "R2.png", frameId: "frame-a", sourceBuildId: "b-p3" },
      ],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png",
      { status: "superseded", supersededBy: "authority-000002" });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R2.png");
    const canon = markdown(P, "canon");
    present(canon, P3, "EXP3: Canon Only exports the current approval");
    absent(canon, P1, "EXP3: and not the superseded one");
    note("EXP3  Canon Only follows a supersession");
  }

  /* ---- EXP4. No current approved visual representation. */
  {
    const P = frameShot({ packages: ["b-p1", "b-repair"] });
    const canon = markdown(P, "canon");
    present(canon, "No approved image.", "EXP4: the export says so truthfully");
    absent(canon, P1, "EXP4: and substitutes no prompt");
    absent(canon, "oxide red", "EXP4: and certainly not the newest draft");
    note("EXP4  with nothing approved the export says so and substitutes nothing");
  }

  /* ---- EXP5 and NC-BIBLE6's positive half. The canonical body is byte-identical
     across the two presets, which is structural: canonBodyLines() is never given
     the preset. */
  {
    const P = frameShot({ packages: ["b-p1", "b-repair"] });
    P.shots[0].candidateFiles[0].currentCorrectionBuildId = "b-repair";
    P.characters.push({
      id: "CHAR-KAI", name: "Kai", block: "KAI — 34.",
      continuityStates: [{ id: "state-default", name: "Work coat", isDefault: true, approvedFile: "KAI_DEFAULT.png" }],
      candidateFiles: [{ stored: "KAI_DEFAULT.png", prompt: "Kai in a clean work coat." }],
    });
    P.characters.push({
      id: "CHAR-VESS", name: "Vess", block: "VESS — 28.",
      continuityStates: [{ id: "state-default", name: "Dispatch", isDefault: true, approvedFile: "VESS_UNAPPROVED.png" }],
    });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    approve(P, { kind: "entity-state", list: "characters", entityId: "CHAR-KAI", stateId: "state-default" }, "KAI_DEFAULT.png");
    const options = { media: { characters: ANCHOR_POOL.concat([{ name: "VESS_UNAPPROVED.png", url: "/assets/anchors/VESS_UNAPPROVED.png" }]) } };
    const canon = markdown(P, "canon", options);
    const withAppendix = markdown(P, "canon-appendix", options);
    ok(withAppendix.startsWith(canon), "EXP5: the canonical body is a byte-exact prefix of Canon + Appendix");
    present(withAppendix, BibleCanon.BIBLE_APPENDIX_HEADING, "EXP5: the appendix is separated by its own heading");
    present(withAppendix, "Historic — no current approval", "EXP5: appendix rows keep truthful status labels");
    present(withAppendix, "VESS_UNAPPROVED.png", "EXP5: supporting material is preserved rather than deleted");
    absent(canon, "VESS_UNAPPROVED.png", "EXP5: and never appears in the canonical body");
    equal(withAppendix.indexOf(BibleCanon.BIBLE_APPENDIX_HEADING), canon.length,
      "EXP5: the appendix begins exactly where the canonical body ends");
    note("EXP5  Canon + Appendix adds a labelled section and changes not one byte of the body");
  }

  /* ---- EXP7. Determinism. Nothing in the projection or the serializer reads a
     clock, so the same project exports the same bytes. */
  {
    const P = frameShot({ packages: ["b-p1", "b-repair"] });
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    const runs = [markdown(P, "canon"), markdown(P, "canon"), markdown(P, "canon")];
    equal(new Set(runs).size, 1, "EXP7: repeated export of an unchanged project is byte-identical");
    const appendixRuns = [markdown(P, "canon-appendix"), markdown(P, "canon-appendix")];
    equal(new Set(appendixRuns).size, 1, "EXP7: and so is Canon + Appendix");
    const source = readLF("public/shared-bible-canon.js");
    ok(!/new Date\(|Date\.now\(|Math\.random\(/.test(source),
      "EXP7: the projection reads no clock and no randomness, which is why determinism holds");
    note("EXP7  export is deterministic, and structurally so");
  }

  /* ---- EXP8. Local only. Three independent proofs, because one is not enough:
     the module may not even REQUIRE a network client; neither route calls one; and
     the serialised document contains no URL a reader would be sent to. */
  {
    const source = readLF("public/shared-bible-canon.js");
    ok(!/\bfetch\s*\(|XMLHttpRequest|require\(["']https?["']\)|require\(["']node:https?["']\)/.test(source),
      "EXP8: the projection contains no network call");
    /* The require shim above already refuses anything but the two shared modules,
       and every projection in this suite ran through it. */
    let refused = "";
    try { loadBibleCanon((text) => text.replace("function text(value)", "require(\"https\");\nfunction text(value)")); }
    catch (error) { refused = error.message; }
    present(refused, "which it may not require", "EXP8: the loader would refuse a network require, so the clean load is a real result");
    const P = frameShot();
    approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
    absent(markdown(P, "canon-appendix"), "http", "EXP8: the exported document contains no outbound URL");
    note("EXP8  export is local-only: no network require, no network call, no outbound URL");
  }
}

/* ===========================================================================
   THE ROUTE HALF — EXP6, and the screen/export equivalence the slice is for.
   =========================================================================== */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function writeRouteFixture(dir) {
  for (const folder of ["anchors", "plates", "props", "audio", "media", "docs", path.join("shots", "S-01", "takes")]) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", "R1.png"), "r1");
  fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", "R2.png"), "r2");
  fs.writeFileSync(path.join(dir, "anchors", "KAI_DEFAULT.png"), "kai");
  fs.writeFileSync(path.join(dir, "anchors", "KAI_BURNED.png"), "kai-burned");

  const P = frameShot({ packages: ["b-p1", "b-repair"] });
  P.shots[0].candidateFiles[0].currentCorrectionBuildId = "b-repair";
  P.shots[0].candidateFiles[0].correctionBuildIds = ["b-repair"];
  approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
  const entities = entityProject();
  P.characters = entities.characters.filter((row) => row.id === "CHAR-KAI");
  for (const receipt of entities.productionAuthority.receipts) {
    if (receipt.entityId !== "CHAR-KAI") continue;
    approve(P, { kind: "entity-state", list: "characters", entityId: "CHAR-KAI", stateId: receipt.stateId }, receipt.value);
  }
  /* A declared state with a pointer nobody approved — the shape that used to print
     its filename under an approved heading. */
  P.characters[0].continuityStates.push({ id: "state-wet", name: "Wet coat", approvedFile: "KAI_REJECTED.png" });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(P, null, 2));
  return P;
}

async function routeCases() {
  const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-bible-canon-"));
  const CONFIG_PATH = path.join(TEMP, "config.json");
  const PROJECTS_ROOT = path.join(TEMP, "projects");
  const PROJECT_DIR = path.join(PROJECTS_ROOT, "canon-project");
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  writeRouteFixture(PROJECT_DIR);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ activeProject: "canon-project", providers: {}, agents: {} }, null, 2));

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let attempt = 0; attempt < 150 && !up; attempt++) {
      try { up = (await fetch(base + "/api/scan")).ok; } catch { /* not listening yet */ }
      if (!up) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(up, `the disposable server never came up. stderr:\n${stderr.join("")}`);

    const screen = await (await fetch(base + "/api/bible")).json();

    /* The P0, at the route the browser actually calls. */
    equal(screen.shots[0].keyframes[0].winner.name, "R1.png", "route: the screen shows the approved image");
    equal(screen.shots[0].keyframes[0].package.prompt, P1, "route: and the prompt that produced it");
    absent(JSON.stringify(screen.shots), "oxide red", "route: the repair draft is absent from shot canon");
    absent(JSON.stringify(screen.characters), "KAI_REJECTED.png", "route: an unapproved state pointer is absent from entity canon");
    ok(screen.appendix.some((row) => row.label === "Wet coat"), "route: it is in supporting material instead");

    /* ---- EXP6. The exported canon is not "equivalent to" the screen's canon —
       it is the screen's own payload, serialised. Any second export-side truth
       implementation would break this exactly. */
    const canonResponse = await fetch(base + "/api/bible/export?preset=canon");
    equal(canonResponse.status, 200, "EXP6: the export route answers");
    equal(canonResponse.headers.get("content-type"), "text/markdown; charset=utf-8", "EXP6: as markdown");
    equal(canonResponse.headers.get("content-disposition"), 'attachment; filename="canon-test-project-bible.md"',
      "EXP6: with a deterministic project-based filename the filmmaker never types");
    const canonBody = await canonResponse.text();
    equal(canonBody, BibleCanon.bibleCanonMarkdown(screen, { preset: "canon" }),
      "EXP6: the exported canon is the on-screen projection serialised, byte for byte");

    const appendixResponse = await fetch(base + "/api/bible/export?preset=canon-appendix");
    const appendixBody = await appendixResponse.text();
    equal(appendixResponse.headers.get("content-disposition"), 'attachment; filename="canon-test-project-bible-with-appendix.md"',
      "EXP6: and the second preset has its own deterministic name");
    equal(appendixBody, BibleCanon.bibleCanonMarkdown(screen, { preset: "canon-appendix" }),
      "EXP6: as is Canon + Appendix");
    ok(appendixBody.startsWith(canonBody), "EXP6: the two presets share one canonical body at the route too");
    present(canonBody, P1, "EXP6: the exported canon carries the approved prompt");
    absent(canonBody, "oxide red", "EXP6: and never the repair draft");
    present(appendixBody, "Wet coat", "EXP6: the appendix carries the unapproved state");
    absent(canonBody, "Wet coat", "EXP6: which the canonical body does not");

    /* EXP7 at the route: two identical requests, identical bytes. */
    const again = await (await fetch(base + "/api/bible/export?preset=canon")).text();
    equal(again, canonBody, "EXP7: the route is deterministic across requests");

    const bad = await fetch(base + "/api/bible/export?preset=everything");
    equal(bad.status, 400, "route: an unknown preset is refused rather than guessed");
    present((await bad.json()).error, "canon, canon-appendix", "route: and the refusal names the presets that exist");

    /* No provider was configured and nothing tried to reach one. */
    absent(stderr.join(""), "fal.ai", "EXP8: the server reached no provider while serving the Bible");
    absent(stderr.join(""), "api.openai.com", "EXP8: nor any model host");
    note("EXP6  screen and export are one projection: the export is the /api/bible payload serialised");
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 120));
    try { fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows may still hold a handle */ }
  }
}

/* ===========================================================================
   THE SEPARATION, ASSERTED AGAINST THE SHIPPED SOURCE.

   Two properties no fixture can show, because they are about what the code is
   allowed to reach for at all.
   =========================================================================== */

function architectureCases() {
  const projectionSource = readLF("public/shared-bible-canon.js");
  const codeOnly = projectionSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

  ok(!/correctionBuildIds|currentCorrectionBuildId/.test(codeOnly),
    "architecture: the projection must never read a correction pointer — those are repairs authored AGAINST canon, not the build that made it");
  ok(!/generationPackages|promptBuilds\b/.test(codeOnly),
    "architecture: the projection must never read a package LIST — reading one is how recency got mistaken for approval");
  ok(/currentHumanAuthority|entityProductionTruth/.test(codeOnly),
    "architecture: it must ask the shipped authority reader");
  ok(!/function currentHumanAuthority|function entityProductionTruth/.test(codeOnly),
    "architecture: and must not define its own");

  const serverSource = readLF("server.js");
  const route = serverSource.slice(serverSource.indexOf("function bibleProjection"), serverSource.indexOf("/* ---- project management ----"));
  ok(route.length > 200, "architecture: the Bible routes were located in server.js");
  equal((route.match(/BibleCanon\.bibleCanonProjection\(/g) || []).length, 1,
    "architecture: exactly one place derives the Bible's canon");
  ok(!/resolvePromptBuildList|\.reverse\(\)|generationPackages/.test(route),
    "architecture: the routes no longer walk package lists");
  ok(/app\.get\("\/api\/bible"[\s\S]*bibleProjection\(/.test(route) && /app\.get\("\/api\/bible\/export"[\s\S]*bibleProjection\(/.test(route),
    "architecture: both the screen route and the export route read the same projection");
  ok(!/\bfetch\(|https\.request|http\.request/.test(route),
    "EXP8: neither Bible route makes an outbound call");

  /* EVERY ENTITY LIST GETS A MEDIA POOL. Rewriting the route's media object from
     folder keys to list keys is exactly the edit that drops one silently — the
     projection would then publish an approved vehicle with no image and nothing
     would say why. Both halves are pinned: the route supplies all five, and the
     module's own list of five is the thing being supplied. */
  const mediaMap = route.slice(route.indexOf("const media = {"), route.indexOf("const ownerIndexes"));
  for (const listName of BibleCanon.BIBLE_ENTITY_LISTS) {
    ok(new RegExp(`\\b${listName}:\\s*listMedia\\(`).test(mediaMap),
      `architecture: the route must supply a media pool for ${listName} — a missing one publishes approved canon with no image`);
  }
  deepEqual(BibleCanon.BIBLE_ENTITY_LISTS, ["characters", "locations", "props", "vehicles", "audio"],
    "architecture: the five entity lists the Bible publishes are declared once, by the module");

  /* The page renders what it is handed and decides nothing. */
  const page = readLF("public/bible.js");
  ok(!/resolvePromptBuild|productionAuthority|currentHumanAuthority|\.reverse\(\)/.test(page),
    "architecture: the Bible page must not re-derive canon in the browser");
  ok(/B\.appendix/.test(page), "architecture: the page renders the projection's appendix rather than inventing a category");
  ok(!/Latest approved canon/.test(page) && !/Latest approved material/.test(readLF("public/bible.html")),
    "copy: 'Latest approved' is gone — 'latest' is the word that invited newest-wins");
  ok(/Current approved canon/.test(page), "copy: the page says CURRENT approved canon");

  /* EVERY PROMPT THE PAGE PRINTS NAMES THE BYTES IT PRODUCED, and it names them
     from `boundTo` — the projection's own record of the binding — rather than from
     a filename the renderer picked up somewhere else. That heading is the whole
     invariant, stated where a filmmaker reads it, in the same words the export
     writes. Four surfaces print a prompt; all four say it. */
  const boundLabels = [...page.matchAll(/block\("APPROVED PROMPT FOR " \+ ([\w.]+)/g)].map((match) => match[1]);
  deepEqual(boundLabels.sort(), ["f.package.boundTo", "m.package.boundTo", "s.prompt.boundTo", "st.package.boundTo"],
    "copy: every prompt the page publishes is headed with the approved file it produced");
  ok(!/block\("APPROVED PROMPT"/.test(page) && !/block\("APPROVED PROMPT · /.test(page),
    "copy: no prompt heading claims approval without naming what it approved");
  note("architecture: one projection, two routes, a page that only renders");
  note("copy: every published prompt is headed 'APPROVED PROMPT FOR <the file it produced>', on screen and in the file");
}

/* ===========================================================================
   NO NEW PRODUCT BUREAUCRACY (brief section 9).
   =========================================================================== */

function bureaucracyCases() {
  const projectionSource = readLF("public/shared-bible-canon.js");
  const serverSource = readLF("server.js");
  const route = serverSource.slice(serverSource.indexOf("function bibleProjection"), serverSource.indexOf("/* ---- project management ----"));
  ok(!/approveBible|bibleApproval|bibleAuthority|bibleLedger/i.test(projectionSource + route),
    "bureaucracy: the Bible gains no approval step and no ledger of its own");
  ok(!/app\.(post|put|delete)\("\/api\/bible/.test(serverSource),
    "bureaucracy: the Bible is read-only — no route writes through it");
  const html = readLF("public/bible.html");
  ok(!/<input(?![^>]*id="bible-search")/.test(html.replace(/<input id="bible-search"[^>]*>/, "")),
    "bureaucracy: the export asks for no configuration and no filename");
  ok(/preset=canon"/.test(html) && /preset=canon-appendix"/.test(html),
    "bureaucracy: both presets are one click, with no dialog between");
  note("bureaucracy: no Bible approval step, no Bible ledger, no export configuration");
}

/* =========================================================================== */

async function main() {
  bibleCases();
  coherenceCases();
  exportCases();
  architectureCases();
  bureaucracyCases();
  await routeCases();
  for (const line of notes) console.log("  " + line);
  console.log(`Bible canon + export suite passed ${checks} checks: BIBLE1-BIBLE10, prompt/package coherence with named absences, EXP1-EXP8, and the screen/export equivalence that makes them one projection.`);
}

module.exports = {
  loadBibleCanon, approve, baseProject, addBuild, frameShot, entityProject, project, frameOf,
  SHOT_MEDIA, ANCHOR_POOL, P1, P2_REPAIR, P3, targetKey, COMMAND_FOR_KIND, freePort, writeRouteFixture,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
