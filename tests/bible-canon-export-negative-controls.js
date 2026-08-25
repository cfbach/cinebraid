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
  return mutatingMany([[needle, replacement]], label);
}
/* Some defects take more than one edit to restore honestly — a channel that both
   collects a value and returns it, say. Every anchor gets its own probe receipt. */
function mutatingMany(edits, label) {
  edits.forEach(([needle], index) => anchorIn("public/shared-bible-canon.js", needle, `${label}[${index}]`));
  return Suite.loadBibleCanon((source) =>
    edits.reduce((text, [needle, replacement]) => text.split(needle).join(replacement), source));
}
/* The same, against the shipped page renderer. A control that reproduced a
   rendering defect by writing its own renderer would be testing the control. */
function mutatingPage(needle, replacement, label) {
  anchorIn("public/bible.js", needle, label);
  return Suite.loadBiblePage((source) => source.split(needle).join(replacement));
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
const { approve, frameShot, entityProject, motionShot, SHOT_MEDIA, MOTION_MEDIA, ANCHOR_POOL, P1, P2_REPAIR, P3, CLIP_DRAFT, SHOT_DRAFT } = Suite;
const Canon = Suite.loadBibleCanon();

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

/* RE-POINTED, NOT WEAKENED. This control used to attack the rule "a made[] record
   enters canon only when it names a canon file" — filename matching, which the
   independent review found was itself a second prompt-truth path. The rule is now
   "made[] never enters canon", so the control restores the whole shipped channel:
   the projection collects the records, the Markdown serialiser prints them under
   "Made with", and the entity card prints them under "MADE WITH". All three halves
   existed together before the repair, and restoring only the first proves nothing a
   filmmaker could see — which is what the second review round caught here.

   THE DISTINCT FAILURE MODE, and it is not NC-BIBLE13's. NC-BIBLE13 is about ONE
   approved file acquiring a SECOND, contradicting prompt. This is about a record
   that names a file which is not canon at all — `KAI_SCRATCH.png` — being published
   in a document whose opening line says every entry in it was approved. Both are
   real; neither implies the other. */
function ncBible7() {
  const Canon = mutatingMany([
    /* 1. the projection collects them again */
    [
      "    for (const entry of list(x.made).map(record)) {\n      if (!text(entry.prompt)) continue;\n      appendix.push({",
      "    const made = [];\n"
      + "    for (const entry of list(x.made).map(record)) {\n"
      + "      if (!text(entry.prompt)) continue;\n"
      + "      made.push({ model: text(entry.model), files: text(entry.files), prompt: text(entry.prompt) });\n"
      + "      appendix.push({",
    ],
    /* 2. and returns them in the canon body */
    ["      continuityStates: states,\n      canonStateCount: states.length,",
     "      continuityStates: states,\n      made,\n      canonStateCount: states.length,"],
    /* 3. and the shipped Markdown serialiser prints them, exactly as it did */
    [
      "        else if (state.representationNote) out.push(\"\", `_${state.representationNote}_`);\n      }",
      "        else if (state.representationNote) out.push(\"\", `_${state.representationNote}_`);\n"
      + "      }\n"
      + "      for (const entry of list(row.made)) {\n"
      + "        out.push(\"\", `**Made with ${entry.model || \"an unrecorded model\"}** — \\`${entry.files}\\``, ...fence(entry.prompt));\n"
      + "      }",
    ],
  ], "NC-BIBLE7");
  /* 4. and so does the shipped entity card, through the real renderer */
  const Page = mutatingPage(
    "      ${states}\n    </div></article>`;",
    "      ${states}\n"
    + "      ${(x.made || []).map((g) => (g.prompt ? block(\"MADE WITH · \" + (g.modelName || \"?\") + (g.files ? \" · \" + g.files : \"\"), g.prompt) : \"\")).join(\"\")}\n"
    + "    </div></article>`;",
    "NC-BIBLE7-page");

  const NOT_CANON_FILE = "KAI_SCRATCH.png";
  const NOT_CANON_RECORD = "The record for a file that is not canon.";
  const P = entityProject();
  P.characters[0].made = [
    { model: "m-img", files: "KAI_DEFAULT.png", prompt: "The record for the approved default.", date: "2026-08-19" },
    { model: "m-img", files: NOT_CANON_FILE, prompt: NOT_CANON_RECORD, date: "2026-08-19" },
  ];
  const doc = projectWith(Canon, P, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
  const kai = doc.characters.find((row) => row.id === "CHAR-KAI");

  /* THE FILE IS NOT CANON, which is what makes publishing its record a lie rather
     than a duplication. Stated before the bad state, so the bad state means
     something. */
  ok(!kai.continuityStates.some((state) => state.approvedFile === NOT_CANON_FILE),
    "NC-BIBLE7: KAI_SCRATCH.png is not any approved state's file");
  equal(kai.made.length, 2, "NC-BIBLE7: every hand-written record is collected into the canon body");

  /* 1. THE LITERAL BAD STATE, IN WHAT A FILMMAKER READS — both surfaces. */
  const exported = Canon.bibleCanonMarkdown(doc, { preset: "canon" });
  const canonBody = exported.slice(0, exported.indexOf(Canon.BIBLE_APPENDIX_HEADING) + 1 || exported.length);
  ok(canonBody.includes(NOT_CANON_RECORD),
    "NC-BIBLE7: CANON ONLY publishes a generation record for a file that is not canon");
  ok(canonBody.includes(`\`${NOT_CANON_FILE}\``),
    "NC-BIBLE7: naming that file under a heading in a document that says everything in it was approved");
  ok(/\*\*Made with m-img\*\* — `KAI_SCRATCH\.png`/.test(canonBody),
    "NC-BIBLE7: as a Made with line, which is how the defect actually read");

  const rendered = Suite.screenText(Page.entityCard(kai, "CHARACTER"));
  ok(rendered.includes("MADE WITH · ? · " + NOT_CANON_FILE),
    "NC-BIBLE7: and the shipped entity card prints it on screen too");
  ok(rendered.includes(NOT_CANON_RECORD),
    "NC-BIBLE7: with the prompt text a person would copy out of it");

  /* 2. THE GUARANTEES MUST GO RED — the projection one and the output one. */
  mustFail("NC-BIBLE7", "no `made` channel at all",
    () => assert.strictEqual(kai.made, undefined, "E1: and the canon body has no `made` channel at all"));
  mustFail("NC-BIBLE7-output", "while the canonical body carries none of them",
    () => assert(!Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes("Names a canon file.")
      && !Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes(NOT_CANON_RECORD),
      "E4: while the canonical body carries none of them"));
  note("NC-BIBLE7 restoring the made[] channel publishes a record for a NON-CANON file in CANON ONLY and on the entity card; E1 and E4 go red");
}

/* =========================================================================== */
/* NC-BIBLE9 — a raw shot motion draft, with zero authority, enters canon.     */
/* =========================================================================== */

function ncBible9() {
  const Canon = mutating(
    "      route: text(s.route),\n      winner,\n      keyframes,",
    "      route: text(s.route),\n      winner,\n      motionPrompt: text(s.motionPrompt),\n      keyframes,",
    "NC-BIBLE9");
  /* And a serializer that prints it, so the bad state is rendered rather than
     merely present in a payload. */
  const Serialised = (doc) => {
    const body = Canon.bibleCanonMarkdown(doc, { preset: "canon" });
    const draft = doc.shots.map((s) => s.motionPrompt).filter(Boolean);
    return draft.length ? body.replace("## WHAT APPROVED MEANS", `**Motion prompt**\n\`\`\`\n${draft.join("\n")}\n\`\`\`\n\n## WHAT APPROVED MEANS`) : body;
  };

  const P = motionShot({ draft: "" });
  const doc = projectWith(Canon, P, { shotMedia: MOTION_MEDIA });

  equal(P.productionAuthority.receipts.length, 0, "NC-BIBLE9: the fixture holds no approval of any kind");
  equal(doc.shots[0].motionPrompt, SHOT_DRAFT,
    "NC-BIBLE9: and a raw shot motion draft is carried in current canon anyway");
  ok(Serialised(doc).includes(SHOT_DRAFT),
    "NC-BIBLE9: and it serialises above WHAT APPROVED MEANS, in a document that says everything in it is approved");

  mustFail("NC-BIBLE9", "no canon field to live in",
    () => assert.strictEqual(doc.shots[0].motionPrompt, undefined,
      "M1: the raw shot draft has no canon field to live in"));
  note("NC-BIBLE9 a raw shot motion draft with zero authority reaches canon and M1 goes red");
}

/* =========================================================================== */
/* NC-BIBLE10 — a raw clip motion draft, zero authority, enters Canon Only.    */
/* =========================================================================== */

function ncBible10() {
  const Canon = mutating(
    "        dur: +c.dur || 0,\n        /* DIALOGUE AND VOICE NOTES STAY.",
    "        dur: +c.dur || 0,\n        direction: text(c.motionPrompt) || text(c.note),\n        /* DIALOGUE AND VOICE NOTES STAY.",
    "NC-BIBLE10");
  const Markdown = mutating(
    "        if (motion.line) out.push(`Dialogue — ${oneLine(motion.line)}`);",
    "        if (motion.direction) out.push(oneLine(motion.direction));\n"
    + "        if (motion.line) out.push(`Dialogue — ${oneLine(motion.line)}`);",
    "NC-BIBLE10-markdown");

  const P = motionShot({ shotDraft: "" });
  const doc = projectWith(Canon, P, { shotMedia: MOTION_MEDIA });
  /* The projection mutation supplies the field; the serializer mutation prints it.
     Applying them separately keeps each anchor honest about what it restores. */
  const withDirection = { ...doc, shots: doc.shots.map((s) => ({ ...s, motions: s.motions.map((m) => ({ ...m, direction: CLIP_DRAFT })) })) };
  const canon = Markdown.bibleCanonMarkdown(withDirection, { preset: "canon" });

  equal(doc.shots[0].motions[0].direction, CLIP_DRAFT,
    "NC-BIBLE10: the raw clip draft is carried as the motion unit's canon description");
  equal(doc.shots[0].motions[0].winner, null, "NC-BIBLE10: while the unit holds no approved output at all");
  ok(canon.includes(CLIP_DRAFT), "NC-BIBLE10: and CANON ONLY exports it under LOCKED SHOTS");

  mustFail("NC-BIBLE10", "no canon field to live in",
    () => assert.strictEqual(doc.shots[0].motions[0].direction, undefined,
      "M2: the raw clip draft has no canon field to live in"));
  mustFail("NC-BIBLE10-export", "CANON ONLY does not export it",
    () => assert(!canon.includes(CLIP_DRAFT), "M2: CANON ONLY does not export it"));
  note("NC-BIBLE10 a raw clip motion draft with zero authority reaches CANON ONLY and M2 goes red");
}

/* =========================================================================== */
/* NC-BIBLE11 — three current authorities, and the serializer omits delivery.  */
/* =========================================================================== */

function ncBible11() {
  const Canon = mutating(
    "      if (shot.delivery) {\n        out.push(\"\", \"**Approved deliverable**\");",
    "      if (false) {\n        out.push(\"\", \"**Approved deliverable**\");",
    "NC-BIBLE11");

  const P = frameShot();
  P.shots[0].clips = [{ id: "seg-a", suffix: "a", label: "A", title: "Primary motion", dur: 5, videoWinner: "M1.mp4" }];
  P.shots[0].creationBrief = { approvedMotionFile: "D1.mp4" };
  P.shots[0].candidateFiles.push({ stored: "M1.mp4", sourceBuildId: "b-p1" });
  P.shots[0].candidateFiles.push({ stored: "D1.mp4", sourceBuildId: "b-p3" });
  approve(P, { kind: "shot-frame", shotId: "S-01", frameId: "frame-a" }, "R1.png");
  approve(P, { kind: "shot-motion", shotId: "S-01", unitKey: "seg-a" }, "M1.mp4");
  approve(P, { kind: "shot-delivery", shotId: "S-01" }, "D1.mp4");
  const doc = projectWith(Canon, P, { shotMedia: SHOT_MEDIA(["R1.png", "M1.mp4", "D1.mp4"]) });
  const canon = Canon.bibleCanonMarkdown(doc, { preset: "canon" });

  ok(doc.shots[0].keyframes[0].authority && doc.shots[0].motions[0].authority && doc.shots[0].delivery.authority,
    "NC-BIBLE11: three current receipts exist and the projection retains all three");
  ok(canon.includes("R1.png") && canon.includes("M1.mp4"),
    "NC-BIBLE11: the export represents two of them");
  ok(!canon.includes("D1.mp4"),
    "NC-BIBLE11: and silently drops the third — a deliverable somebody approved is nowhere in the document");

  mustFail("NC-BIBLE11", "CANON ONLY represents delivery authority",
    () => assert(canon.includes("D1.mp4"), "D6: CANON ONLY represents delivery authority"));
  note("NC-BIBLE11 a serializer that skips delivery erases one of three approvals and D6 goes red");
}

/* =========================================================================== */
/* NC-BIBLE12 — the approved audio prompt exports but does not render.         */
/* =========================================================================== */

function ncBible12() {
  /* AN AUDIO-SPECIFIC PATH THROUGH THE REAL RENDERER. The shipped defect was a
     bespoke audio card that read id, name, notes and media and nothing the
     projection had resolved about approval; this restores the same behaviour inside
     entityCard() itself, so the control drives the function the page actually calls
     rather than a copy of it written here. */
  const Page = mutatingPage(
    "${st.approvedFile ? `<code>${esc(st.approvedFile)}</code>` : \"\"}${approvedPromptBlock(st)}",
    "${st.approvedFile ? `<code>${esc(st.approvedFile)}</code>` : \"\"}${type === \"AUDIO\" ? \"\" : approvedPromptBlock(st)}",
    "NC-BIBLE12");

  const P = Suite.audioProject();
  const doc = Suite.audioDoc(P);
  const screen = Suite.screenText(doc.audio.map((x) => Page.entityCard(x, "AUDIO")).join("\n"));
  const exported = Canon.bibleCanonMarkdown(doc, { preset: "canon" });

  ok(exported.includes(Suite.AUDIO_PROMPT),
    "NC-BIBLE12: CANON ONLY carries the approved audio's producing prompt");
  ok(!screen.includes(Suite.AUDIO_PROMPT),
    "NC-BIBLE12: and the screen does not — the same approval says two different things");
  ok(screen.includes("RAIN_BED.wav"),
    "NC-BIBLE12: while both agree the media is approved, which is what makes the gap invisible");

  mustFail("NC-BIBLE12", "the screen represents the audio producing prompt",
    () => assert(screen.includes(Suite.AUDIO_PROMPT), "equivalence: the screen represents the audio producing prompt"));
  note("NC-BIBLE12 a bespoke audio renderer drops the approved prompt the export prints, and equivalence goes red");
}

/* =========================================================================== */
/* NC-BIBLE13 — a conflicting same-file made[] prompt joins current canon.     */
/* =========================================================================== */

function ncBible13() {
  const Canon = mutatingMany([
    [
      "    for (const entry of list(x.made).map(record)) {\n      if (!text(entry.prompt)) continue;\n      appendix.push({",
      "    const canonFiles = new Set(states.map((state) => text(state.approvedFile)).filter(Boolean));\n"
      + "    const made = [];\n"
      + "    for (const entry of list(x.made).map(record)) {\n"
      + "      if (!text(entry.prompt)) continue;\n"
      + "      if (text(entry.files).split(/[,;\\s]+/).some((name) => canonFiles.has(name))) made.push({ model: text(entry.model), files: text(entry.files), prompt: text(entry.prompt) });\n"
      + "      appendix.push({",
    ],
    ["      continuityStates: states,\n      canonStateCount: states.length,",
     "      continuityStates: states,\n      made,\n      canonStateCount: states.length,"],
  ], "NC-BIBLE13");
  const Markdown = mutating(
    "        else if (state.representationNote) out.push(\"\", `_${state.representationNote}_`);\n      }",
    "        else if (state.representationNote) out.push(\"\", `_${state.representationNote}_`);\n"
    + "      }\n"
    + "      for (const entry of list(row.made)) out.push(\"\", `**Made with ${entry.model}** — \\`${entry.files}\\``, ...fence(entry.prompt));",
    "NC-BIBLE13-markdown");

  const P = entityProject();
  P.characters = [P.characters[0]];
  P.characters[0].continuityStates = [P.characters[0].continuityStates[0]];
  P.characters[0].made = [{
    model: "m-img", files: "KAI_DEFAULT.png", date: "2026-08-19",
    prompt: "CONFLICTING: Kai in a RED jumpsuit, full-length, harsh overhead light.",
  }];
  const doc = projectWith(Canon, P, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });
  const kai = doc.characters[0];
  const canon = Markdown.bibleCanonMarkdown(doc, { preset: "canon" });

  equal(kai.continuityStates[0].package.prompt,
    "Kai in a clean work coat, three-quarter portrait, neutral studio light.",
    "NC-BIBLE13: the true producing prompt is still resolved from the candidate chain");
  equal(kai.made.length, 1, "NC-BIBLE13: and a filename match has minted a second one beside it");
  ok(canon.includes("clean work coat") && canon.includes("CONFLICTING"),
    "NC-BIBLE13: CANON ONLY now states two contradictory prompts for one approved image");

  mustFail("NC-BIBLE13", "CANON ONLY carries only one prompt for one image",
    () => assert(!canon.includes("CONFLICTING"), "E2: and CANON ONLY carries only one prompt for one image"));
  note("NC-BIBLE13 filename matching mints a second, contradicting canon prompt and E2 goes red");
}

/* =========================================================================== */
/* NC-BIBLE14 — missing provenance is silently omitted again.                  */
/* =========================================================================== */

function ncBible14() {
  const Canon = mutating(
    "  function representationNoteFor(hasMedia, representation, form) {\n    return hasMedia && !representation ? missingProvenanceNote(form) : \"\";",
    "  function representationNoteFor(hasMedia, representation, form) {\n    return \"\";",
    "NC-BIBLE14");

  /* Motion, deliverable and entity state — the three surfaces the review found
     silent. Each holds current approved media whose producing prompt is unknown. */
  const Pm = motionShot({ draft: "", shotDraft: "", videoWinner: "M1.mp4", candidates: [] });
  approve(Pm, { kind: "shot-motion", shotId: "S-01", unitKey: "seg-a" }, "M1.mp4");
  const dm = projectWith(Canon, Pm, { shotMedia: MOTION_MEDIA });

  const Pd = motionShot({ draft: "", shotDraft: "", candidates: [] });
  Pd.shots[0].creationBrief = { approvedMotionFile: "D1.mp4" };
  approve(Pd, { kind: "shot-delivery", shotId: "S-01" }, "D1.mp4");
  const dd = projectWith(Canon, Pd, { shotMedia: MOTION_MEDIA });

  const Pe = entityProject();
  Pe.characters[0].candidateFiles = [];
  const de = projectWith(Canon, Pe, { media: { characters: ANCHOR_POOL }, shotMedia: () => [] });

  const NOTE = "was not recorded";
  for (const [what, item, doc] of [
    ["motion", dm.shots[0].motions[0], dm],
    ["deliverable", dd.shots[0].delivery, dd],
    ["entity state", de.characters[0].continuityStates[0], de],
  ]) {
    ok(item.winner || item.media, `NC-BIBLE14: the ${what} holds current approved media`);
    equal(item.representationAbsence, "no-candidate-record", `NC-BIBLE14: whose provenance is known to be missing`);
    equal(item.representationNote, "", `NC-BIBLE14: and the ${what} says nothing about it`);
    ok(!Canon.bibleCanonMarkdown(doc, { preset: "canon" }).includes(NOTE),
      `NC-BIBLE14: so CANON ONLY presents the ${what} as if no prompt were expected`);
  }

  mustFail("NC-BIBLE14", "a motion unit says so, with the video noun",
    () => assert.strictEqual(dm.shots[0].motions[0].representationNote,
      "The prompt behind this approved video was not recorded.",
      "provenance: a motion unit says so, with the video noun"));
  mustFail("NC-BIBLE14-entity", "an entity state says so",
    () => assert.strictEqual(de.characters[0].continuityStates[0].representationNote,
      "The prompt behind this approved image was not recorded.",
      "provenance: an entity state says so"));
  note("NC-BIBLE14 silent absence makes an unrecorded prompt look like an unremarkable one, and the provenance gate goes red");
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
  ncBible9();
  ncBible10();
  ncBible11();
  ncBible12();
  ncBible13();
  ncBible14();
  ncBible8();
  for (const line of notes) console.log("  " + line);
  console.log(`Bible canon negative controls passed ${checks} checks: 14 controls, each reproducing the literal bad state a filmmaker would read and then requiring the positive guarantee to go red against the same build.`);
}

main();
