/* Negative controls for tests/bible-canon-export.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each
 * control below restores ONE way the Project Bible could publish something that is
 * not current approved canon — IN MEMORY, by mutating the shipped source as it is
 * loaded, so nothing on disk is touched and no control can be "restored" by a
 * checkout that also discards real work.
 *
 * EVERY CONTROL DOES TWO THINGS, IN THIS ORDER, AND THE ORDER IS THE POINT:
 *
 *   1. REPRODUCES THE USER-VISIBLE DEFECT. Not "a guard threw" — the actual words
 *      a filmmaker would read, rendered or serialised from the mutated build and
 *      asserted literally. A control that only proves an assertion exists has
 *      proved nothing about the product.
 *   2. REQUIRES THE POSITIVE GUARANTEE TO GO RED against that same build.
 *
 * Each mutation also carries a PROBE RECEIPT: it asserts the text it replaces was
 * actually present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing. The receipt is checked OUTSIDE
 * the mutated build — a control that guards itself with the same assert() it is
 * testing reports success while mutating nothing.
 *
 * Anchors are matched against LF-normalised source. This repository checks out
 * with core.autocrlf=true, so an anchor containing \n matches zero times in a
 * normal Windows working tree and the control silently aborts.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS
 * MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const Suite = require("./bible-canon-export.js");

let checks = 0;
const notes = [];
const note = (line) => notes.push(line);
const ok = (value, message) => { checks += 1; assert(value, message); };
const equal = (actual, expected, message) => { checks += 1; assert.strictEqual(actual, expected, message); };

const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

/* THE PROBE RECEIPT, CHECKED HERE AND NOT INSIDE THE MUTATED BUILD. */
function anchorIn(file, needle, label, expected = 1) {
  checks += 1;
  assert(!needle.includes("\r"), `${label}: an anchor must be written LF-only; normalise it before matching`);
  const hits = readLF(file).split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor in ${file}, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
}

/* A source mutation of the shipped projection, applied at load. */
function mutating(needle, replacement, label) {
  anchorIn("public/shared-bible-canon.js", needle, label);
  return Suite.loadBibleCanon((source) => source.split(needle).join(replacement));
}

/* Runs the body and requires it to throw, mentioning `because`. */
function mustFail(label, because, body) {
  checks += 1;
  let failure = null;
  try { body(); } catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
}

/* The positive suite's own fixtures, so a control cannot pass by testing a
   different project than the guarantee it is attacking. */
const { approve, frameShot, entityProject, SHOT_MEDIA, ANCHOR_POOL, P1, P2_REPAIR, P3 } = Suite;

function projectWith(Canon, P, options = {}) {
  return Canon.bibleCanonProjection(P, {
    media: options.media || {},
    shotMedia: options.shotMedia || SHOT_MEDIA(["R1.png", "R2.png"]),
    modelName: (id) => (P.meta.models || []).find((m) => m.id === id)?.name || "",
  });
}
const frameOf = (doc) => doc.shots[0].keyframes[0];

/* The P0 fixture, built once per control so mutations cannot share state:
   approved R1/P1, plus an unexecuted targeted-repair draft that the shipped modal
   registers into frame.generationPackages the moment it opens. */
function repairDraftFixture() {
  const P = frameShot({ packages: ["b-p1", "b-repair"] });
  P.shots[0].candidateFiles[0].correctionBuildIds = ["b-repair"];
  P.shots[0].candidateFiles[0].currentCorrectionBuildId = "b-repair";
  approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
  return P;
}

/* =========================================================================== */
/* NC-BIBLE1 — choose the newest prompt regardless of approval.                */
/* =========================================================================== */

function ncBible1() {
  /* The exact defect: resolve the frame's prompt from its package list's last row
     instead of from the approved bytes. This is what shipped. */
  const Canon = mutating(
    "  function approvedRepresentation(project, owner, approvedFile) {",
    "  function approvedRepresentation(project, owner, approvedFile) {\n"
    + "    const packages = list(record(owner).keyframes).map(record).flatMap((f) => list(f.generationPackages));\n"
    + "    const newest = packages.map((entry) => record(record(project).promptBuildsById)[text(record(entry).buildId)]).filter((b) => b && text(b.prompt)).pop();\n"
    + "    if (newest) return { representation: representationOf(newest, approvedFile, \"prompt-build\"), absence: \"\" };",
    "NC-BIBLE1");

  const doc = projectWith(Canon, repairDraftFixture());
  const frame = frameOf(doc);

  /* 1. THE LITERAL BAD STATE, in the payload the browser renders. */
  equal(frame.winner.name, "R1.png", "NC-BIBLE1: the approved image is still R1 — which is what makes the next line a lie");
  equal(frame.package.prompt, P2_REPAIR, "NC-BIBLE1: the unexecuted repair draft is published as the frame's approved prompt");
  ok(Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes("Repaint it oxide red"),
    "NC-BIBLE1: and CANON ONLY exports the repair instructions as approved production truth");

  /* 2. THE GUARANTEE MUST GO RED. */
  mustFail("NC-BIBLE1", "canon stays on P1",
    () => assert.strictEqual(frame.package.prompt, P1, "BIBLE2: canon stays on P1 — the repair draft does not replace it"));
  note("NC-BIBLE1 newest-prompt-wins restores the P0 verbatim and BIBLE2/EXP1 go red");
}

/* =========================================================================== */
/* NC-BIBLE2 — choose the latest generated candidate regardless of approval.   */
/* =========================================================================== */

function ncBible2() {
  const Canon = mutating(
    "      const receipt = receiptFor(project, target);\n      const file = text(record(receipt).value);",
    "      const receipt = receiptFor(project, target);\n"
    + "      const generated = list(s.candidateFiles).map(record).filter((row) => text(row.frameId) === frameId).pop();\n"
    + "      const file = text(record(generated).stored) || text(record(receipt).value);",
    "NC-BIBLE2");

  const P = frameShot({
    packages: ["b-p1", "b-p3"],
    candidates: [
      { stored: "R1.png", frameId: "frame-a", decision: "shortlist", sourceBuildId: "b-p1" },
      { stored: "R2.png", frameId: "frame-a", decision: "unreviewed", sourceBuildId: "b-p3" },
    ],
  });
  approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
  const doc = projectWith(Canon, P);
  const frame = frameOf(doc);

  equal(frame.winner.name, "R2.png", "NC-BIBLE2: an unreviewed candidate is published as the approved image");
  equal(frame.package.prompt, P3, "NC-BIBLE2: and its prompt travels with it into canon");
  ok(Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes("`R2.png`"),
    "NC-BIBLE2: CANON ONLY exports a file no human ever approved");

  mustFail("NC-BIBLE2", "an unapproved candidate does not become canon media",
    () => assert.strictEqual(frame.winner.name, "R1.png", "BIBLE3: an unapproved candidate does not become canon media"));
  note("NC-BIBLE2 latest-candidate-wins publishes an unapproved file and BIBLE3 goes red");
}

/* =========================================================================== */
/* NC-BIBLE3 — let a stale pointer stand in for current authority.             */
/* =========================================================================== */

function ncBible3() {
  const Canon = mutating(
    "  function receiptFor(project, target) {\n    if (!AUTHORITY || typeof AUTHORITY.currentHumanAuthority !== \"function\") return null;\n    return AUTHORITY.currentHumanAuthority(project, target) || null;",
    "  function receiptFor(project, target) {\n"
    + "    if (!AUTHORITY || typeof AUTHORITY.currentHumanAuthority !== \"function\") return null;\n"
    + "    const live = AUTHORITY.liveAuthorityValue(project, target);\n"
    + "    return AUTHORITY.currentHumanAuthority(project, target)\n"
    + "      || (live && live.value ? { id: \"\", at: \"\", value: live.value, assetId: live.assetId } : null);",
    "NC-BIBLE3");

  /* A frame whose pointer names a file with no receipt anywhere. */
  const P = frameShot({ winner: "GHOST.png", candidates: [{ stored: "GHOST.png", sourceBuildId: "b-p1" }] });
  const doc = projectWith(Canon, P, { shotMedia: SHOT_MEDIA(["GHOST.png"]) });
  const frame = frameOf(doc);

  ok(frame.winner && frame.winner.name === "GHOST.png",
    "NC-BIBLE3: a pointer nobody approved is published as the frame's approved image");
  equal(frame.authority.receiptId, "", "NC-BIBLE3: with no receipt behind it — the citation is empty and the page shows it anyway");
  ok(Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes("`GHOST.png`"),
    "NC-BIBLE3: and CANON ONLY exports it");

  mustFail("NC-BIBLE3", "a pointer nobody approved yields no canon media",
    () => assert.strictEqual(frame.winner, null, "BIBLE8: a pointer nobody approved yields no canon media"));

  /* THE SAME WEAKENING ON THE ENTITY SIDE, which is where the shipped Bible used
     to print every declared state's `approvedFile` under an approved heading:
     build the canon states from the DECLARED list and its raw pointers rather than
     from the receipts. */
  const Entity = mutating(
    "    const states = [];\n    const media = [];\n    for (const row of list(truth.canon).map(record)) {",
    "    const states = [];\n    const media = [];\n"
    + "    const byPointer = declared.map((state) => ({ stateId: text(state.id), stateName: text(state.name), isDefault: state.isDefault === true, value: text(state.approvedFile) })).filter((row) => row.value);\n"
    + "    for (const row of (byPointer.length ? byPointer : list(truth.canon).map(record))) {",
    "NC-BIBLE3-entity");

  const entities = entityProject();
  entities.characters[0].continuityStates.push({ id: "state-wet", name: "Wet coat", approvedFile: "KAI_REJECTED.png" });
  const entityDoc = projectWith(Entity, entities, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
  const kai = entityDoc.characters.find((row) => row.id === "CHAR-KAI");

  ok(kai.continuityStates.some((state) => state.approvedFile === "KAI_REJECTED.png"),
    "NC-BIBLE3: a declared state's raw pointer is published under CONTINUITY STATES as approved canon");
  equal(kai.continuityStates.find((state) => state.id === "state-wet").authority.receiptId, "",
    "NC-BIBLE3: with an empty citation — nobody approved it and the page says so nowhere");
  ok(Entity.bibleCanonMarkdown(entityDoc, { preset: "canon" }).includes("KAI_REJECTED.png"),
    "NC-BIBLE3: and CANON ONLY exports it as an approved image");

  mustFail("NC-BIBLE3-entity", "contributes nothing to canon",
    () => assert(!JSON.stringify(kai.continuityStates).includes("KAI_REJECTED.png"),
      "BIBLE10: a declared state with an unapproved pointer contributes nothing to canon"));
  note("NC-BIBLE3 a stale pointer standing in for a receipt republishes unapproved bytes on both the shot and entity sides; BIBLE8 and BIBLE10 go red");
}

/* =========================================================================== */
/* NC-BIBLE4 — let a historic / superseded approval render as current canon.   */
/* =========================================================================== */

function ncBible4() {
  const Canon = mutating(
    "  function receiptFor(project, target) {\n    if (!AUTHORITY || typeof AUTHORITY.currentHumanAuthority !== \"function\") return null;\n    return AUTHORITY.currentHumanAuthority(project, target) || null;",
    "  function receiptFor(project, target) {\n"
    + "    if (!AUTHORITY || typeof AUTHORITY.currentHumanAuthority !== \"function\") return null;\n"
    + "    const current = AUTHORITY.currentHumanAuthority(project, target);\n"
    + "    if (current) return current;\n"
    + "    const history = AUTHORITY.authorityReceiptsFor(project, target);\n"
    + "    return history.length ? history[history.length - 1] : null;",
    "NC-BIBLE4");

  /* R1 superseded by R2, and R2 then withdrawn. Current authority is nothing. */
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
  approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R2.png",
    { status: "revoked", revokedAt: "2026-08-22T00:00:00.000Z", revocationReason: "withdrawn" });
  const doc = projectWith(Canon, P);
  const frame = frameOf(doc);

  ok(frame.winner && frame.winner.name === "R2.png",
    "NC-BIBLE4: a withdrawn approval is republished as current canon");
  equal(frame.package.prompt, P3, "NC-BIBLE4: with the prompt of a revision nobody currently vouches for");
  ok(Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes(P3),
    "NC-BIBLE4: and CANON ONLY exports it as approved production truth");

  mustFail("NC-BIBLE4", "a withdrawn approval leaves no canon media",
    () => assert.strictEqual(frame.winner, null, "BIBLE6: a withdrawn approval leaves no canon media"));
  note("NC-BIBLE4 falling back to the newest historic receipt republishes a withdrawn approval and BIBLE6/BIBLE7 go red");
}

/* =========================================================================== */
/* NC-BIBLE5 — make the export walk raw latest prompts instead of the shared    */
/*             projection, and watch screen/export equivalence break.           */
/* =========================================================================== */

function ncBible5() {
  const Canon = Suite.loadBibleCanon();
  const P = repairDraftFixture();
  const doc = projectWith(Canon, P);

  /* THE SECOND TRUTH IMPLEMENTATION, written the obvious way somebody would write
     it if the export were built separately: walk the project, take the newest
     package with a prompt, print it under an approved heading. */
  function exportByWalkingRawProject(source) {
    const out = [`# ${source.meta.title} — Project Bible`, "", "## LOCKED SHOTS", ""];
    for (const shot of source.shots) {
      out.push(`### ${shot.id} — ${shot.title}`);
      for (const frame of shot.keyframes || []) {
        const newest = (frame.generationPackages || [])
          .map((entry) => source.promptBuildsById[entry.buildId])
          .filter((build) => build && build.prompt)
          .pop();
        out.push("", `**Frame ${frame.label} — ${frame.title}**`, `Approved image: \`${frame.winner}\``);
        if (newest) out.push("", `_Approved prompt for \`${frame.winner}\`_`, "```", newest.prompt, "```");
      }
      out.push("");
    }
    return out.join("\n") + "\n";
  }

  const shared = Canon.bibleCanonMarkdown(doc, { preset: "canon" });
  const rival = exportByWalkingRawProject(P);

  ok(rival.includes("Repaint it oxide red"),
    "NC-BIBLE5: an export that walks raw latest prompts publishes the unexecuted repair draft");
  ok(!shared.includes("Repaint it oxide red"),
    "NC-BIBLE5: while the shared projection does not — which is the disagreement");
  ok(shared.includes(P1) && !rival.includes(P1),
    "NC-BIBLE5: the two documents state different things about the same approved image");

  mustFail("NC-BIBLE5", "the exported canon is the on-screen projection serialised",
    () => assert.strictEqual(rival, shared, "EXP6: the exported canon is the on-screen projection serialised, byte for byte"));

  /* And the architectural guard that stops the second implementation being added:
     exactly one call site derives the Bible's canon. */
  const serverSource = readLF("server.js");
  const route = serverSource.slice(serverSource.indexOf("function bibleProjection"), serverSource.indexOf("/* ---- project management ----"));
  const mutatedRoute = route + "\napp.get(\"/api/bible/export2\", (req, res) => res.send(BibleCanon.bibleCanonProjection(readJsonSync(DATA()), {})));";
  mustFail("NC-BIBLE5-architecture", "exactly one place derives the Bible's canon",
    () => assert.strictEqual((mutatedRoute.match(/BibleCanon\.bibleCanonProjection\(/g) || []).length, 1,
      "architecture: exactly one place derives the Bible's canon"));
  note("NC-BIBLE5 a separate export-side truth implementation disagrees with the screen and EXP6 goes red");
}

/* =========================================================================== */
/* NC-BIBLE6 — let Canon + Appendix material leak into the Canon Only body.    */
/* =========================================================================== */

function ncBible6() {
  /* The leak written the way it happens in practice: the body builder is handed
     the preset and starts varying by it. */
  const Canon = mutating(
    "  function bibleCanonMarkdown(doc, options = {}) {\n    const requested = text(record(options).preset);\n    const preset = BIBLE_EXPORT_PRESETS.includes(requested) ? requested : \"canon\";\n    const body = canonBodyLines(doc);",
    "  function bibleCanonMarkdown(doc, options = {}) {\n"
    + "    const requested = text(record(options).preset);\n"
    + "    const preset = BIBLE_EXPORT_PRESETS.includes(requested) ? requested : \"canon\";\n"
    + "    const body = canonBodyLines(doc).concat(preset === \"canon\" ? list(record(doc).appendix).map((row) => `- ${text(record(row).label)} — ${text(record(row).detail)}`) : []);",
    "NC-BIBLE6");

  const P = repairDraftFixture();
  P.characters.push({
    id: "CHAR-VESS", name: "Vess", block: "VESS — 28.",
    continuityStates: [{ id: "state-default", name: "Dispatch", isDefault: true, approvedFile: "VESS_UNAPPROVED.png" }],
  });
  const options = { media: { characters: ANCHOR_POOL.concat([{ name: "VESS_UNAPPROVED.png", url: "/assets/anchors/VESS_UNAPPROVED.png" }]) } };
  const doc = projectWith(Canon, P, options);
  const canon = Canon.bibleCanonMarkdown(doc, { preset: "canon" });
  const withAppendix = Canon.bibleCanonMarkdown(doc, { preset: "canon-appendix" });

  ok(canon.includes("VESS_UNAPPROVED.png"),
    "NC-BIBLE6: CANON ONLY now carries a state nobody approved, with no label saying so");
  ok(!canon.includes("Historic — no current approval"),
    "NC-BIBLE6: and without the truthful status the appendix would have given it — which is what makes the leak a lie rather than a duplication");

  mustFail("NC-BIBLE6", "never appears in the canonical body",
    () => assert(!canon.includes("VESS_UNAPPROVED.png"), "EXP5: and never appears in the canonical body"));
  mustFail("NC-BIBLE6-prefix", "byte-exact prefix",
    () => assert(withAppendix.startsWith(canon) && withAppendix.length > canon.length,
      "EXP5: the canonical body is a byte-exact prefix of Canon + Appendix"));
  note("NC-BIBLE6 letting the body see the preset leaks unlabelled non-canon into CANON ONLY and EXP5 goes red");
}

/* =========================================================================== */
/* NC-BIBLE7 — publish a generation record for a file that is not canon.       */
/* =========================================================================== */

function ncBible7() {
  const Canon = mutating(
    "      if (namesCanon(entry.files)) {",
    "      if (true) {",
    "NC-BIBLE7");

  const P = entityProject();
  P.characters[0].made = [
    { model: "m-img", files: "KAI_DEFAULT.png", prompt: "The record for the approved default.", date: "2026-08-19" },
    { model: "m-img", files: "KAI_SCRATCH.png", prompt: "The record for a file that is not canon.", date: "2026-08-19" },
  ];
  const doc = projectWith(Canon, P, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
  const kai = doc.characters.find((row) => row.id === "CHAR-KAI");

  equal(kai.made.length, 2, "NC-BIBLE7: a generation record for a non-canon file is published in the canon body");
  ok(Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes("The record for a file that is not canon."),
    "NC-BIBLE7: and CANON ONLY exports it under an approved heading");

  mustFail("NC-BIBLE7", "only the generation record naming a canon file",
    () => assert.deepStrictEqual(kai.made.map((row) => row.files), ["KAI_DEFAULT.png"],
      "coherence: only the generation record naming a canon file is in the canon body"));
  note("NC-BIBLE7 publishing every generation record puts non-canon provenance under an approved heading");
}

/* =========================================================================== */
/* NC-BIBLE8 — read the correction pointer, which is the P0 by another field.  */
/* =========================================================================== */

function ncBible8() {
  const Canon = mutating(
    "    const buildId = text(row.sourceBuildId) || text(row.sourcePackageId);",
    "    const buildId = text(row.currentCorrectionBuildId) || text(row.sourceBuildId) || text(row.sourcePackageId);",
    "NC-BIBLE8");

  const doc = projectWith(Canon, repairDraftFixture());
  const frame = frameOf(doc);

  equal(frame.package.prompt, P2_REPAIR,
    "NC-BIBLE8: reading currentCorrectionBuildId republishes the repair draft as the approved prompt");
  ok(Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes("Edit #image1 rather than creating a new composition"),
    "NC-BIBLE8: and CANON ONLY exports edit instructions as approved production truth");

  mustFail("NC-BIBLE8", "canon stays on P1",
    () => assert.strictEqual(frame.package.prompt, P1, "BIBLE2: canon stays on P1 — the repair draft does not replace it"));

  /* And the architectural guard that forbids the field being read at all. */
  const codeOnly = readLF("public/shared-bible-canon.js")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1")
    .replace("const buildId = text(row.sourceBuildId)", "const buildId = text(row.currentCorrectionBuildId) || text(row.sourceBuildId)");
  mustFail("NC-BIBLE8-architecture", "never read a correction pointer",
    () => assert(!/correctionBuildIds|currentCorrectionBuildId/.test(codeOnly),
      "architecture: the projection must never read a correction pointer — those are repairs authored AGAINST canon, not the build that made it"));
  note("NC-BIBLE8 the same defect through the correction pointer is caught by BIBLE2 and by the architectural guard");
}

/* =========================================================================== */

function main() {
  ncBible1();
  ncBible2();
  ncBible3();
  ncBible4();
  ncBible5();
  ncBible6();
  ncBible7();
  ncBible8();
  for (const line of notes) console.log("  " + line);
  console.log(`Bible canon negative controls passed ${checks} checks: 8 controls, each reproducing the literal bad state a filmmaker would read and then requiring the positive guarantee to go red against the same build.`);
}

main();
