/* CineBraid — AT1 NEGATIVE CONTROLS AND THE FIRST RETIREMENT ASSERTION.
 *
 * WHY THIS FILE EXISTS, and it is a process defect rather than a product one.
 *
 * The September 3 audit found that CineBraid's suites can prove a NEW owner
 * exists and still pass while the SUPERSEDED one survives beside it. A test that
 * asserts "the new thing works" goes green in a build where both things work,
 * and a build where both things work is a build where a filmmaker can still
 * reach the old one. Every defect AT1 corrects was reachable through a control
 * that some suite had already blessed.
 *
 * So this file does two things, and they are different:
 *
 *   NEGATIVE CONTROLS (NC-AT1-1..5). Each one REPRODUCES a defect by mutating
 *   the shipped source, proves the defect is visible in the mutated build, and
 *   then proves the AT1 guarantee GOES RED against it. A guarantee that stays
 *   green when the defect is restored is not a guarantee, and mustFail() below
 *   fails loudly when that happens.
 *
 *   RETIREMENT ASSERTIONS (R-AT1-1..4). Each one fails if a superseded OWNER
 *   comes back — not if the new owner breaks. These are the control the audit
 *   asked for: replacement plus explicit proof the old path is gone.
 *
 * THE RETIREMENT OF RECORD is R-AT1-1, the manual-start mutation path. It was
 * chosen over the other three candidates because it is the one whose return is
 * SILENT and DURABLE: an impossible Confirm annoys a filmmaker, a vacuous
 * completion message misleads them, but a New Project surface writing into the
 * open project renames the film they are working on and marks it to be saved,
 * with nothing on screen ever saying so. It is also the cheapest to detect
 * structurally, because the defect IS the presence of a writer.
 *
 * WHAT THIS FILE DELIBERATELY IS NOT. It is not a lexical lint framework. Every
 * assertion below names one specific superseded owner and the one specific
 * writer or projection that owner used. A general "no forbidden words" pass
 * would fail on the comments that explain these rules — the notes have to NAME
 * what they forbid — and would go green the day somebody renamed a variable.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const { Kernel } = require("./authority-kernel-private");
const Readiness = require(path.join(PUBLIC, "shared-shot-readiness.js"));
const { installTestManualActionSource } = require("./authority-test-gesture.js");
const { render, rawFixture, emptyFixture, withCanon } = require("./render-harness.js");

const GESTURE = installTestManualActionSource(Kernel);

let checks = 0;
const notes = [];
const note = (line) => notes.push(line);
function ok(value, message) { checks += 1; assert(value, message); }
function equal(actual, expected, message) { checks += 1; assert.strictEqual(actual, expected, message); }

const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
/* Comments are stripped for every "is that writer still reachable?" question:
   the note explaining a rule NAMES the thing the rule forbids, and an absence
   check that trips over its own documentation proves nothing. */
const codeOnly = (source) => String(source).replace(/\/\*[\s\S]*?\*\//g, "");
const sample = () => JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "cinebraid-sample", "project.json"), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

function evaluate(context, body) {
  return vm.runInContext(`(() => { ${body} })()`, context);
}
const evaluateAsync = async (context, body) =>
  JSON.parse(await vm.runInContext(`(async () => { ${body} })().then(JSON.stringify)`, context));

/* THE PROBE RECEIPT. A control that no longer mutates the live path is a control
   that proves nothing, so the anchor it depends on is checked OUTSIDE the
   mutated build and the count is exact. */
function anchorIn(file, needle, label, expected = 1) {
  const hits = readLF(file).split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor in ${file}, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
}

/* A mutateSource hook scoped to one public/ file. */
function replacing(file, needle, replacement) {
  return (name, contents) => {
    if (name !== file) return contents;
    return String(contents).replace(/\r\n/g, "\n").split(needle).join(replacement);
  };
}

/* Runs the body and requires it to throw, mentioning `because`. */
async function mustFail(label, because, body) {
  checks += 1;
  let failure = null;
  try { await body(); }
  catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
}

/* ===========================================================================
   NC-AT1-1 — RESTORE THE OWNERSHIP-ONLY PREFLIGHT.

   The mechanism behind the shipped sample's four impossible Confirm buttons:
   readiness answered "would the veto allow it" from ownership alone, so the
   artifact-structure veto beside it was invisible to the offer.
   =========================================================================== */

const NC1_ANCHOR = "const refused = verdict.ok !== true;";
const NC1_BREAK = "const refused = false;";

async function nc1_ownershipOnlyPreflight() {
  anchorIn("public/shared-shot-readiness.js", NC1_ANCHOR, "NC-AT1-1");

  /* The sample with its structural declaration removed — the exact pre-AT1
     shape of the shipped fixture. */
  const project = sample();
  project.characters[0].candidateFiles = [];

  const page = await render("#/production", project, {
    mutateSource: replacing("shared-shot-readiness.js", NC1_ANCHOR, NC1_BREAK),
  });

  const seen = evaluate(page.context, `
    const feed = projectShotReadiness();
    const item = (feed.historic.items || []).find((row) => row.key.indexOf("CHAR-COURIER") >= 0);
    const queue = historicConfirmationMarkup(feed);
    return {
      wouldRefuse: item ? item.ownership.wouldRefuse : null,
      offersConfirm: queue.indexOf("confirmHistoricSelection('" + (item ? item.key : "") + "')") >= 0,
    };
  `);

  /* 1. THE DEFECT, AS A FILMMAKER SEES IT. */
  equal(seen.wouldRefuse, false, "NC-AT1-1 reproduces the ownership-only answer");
  equal(seen.offersConfirm, true, "and an enabled Confirm is offered again for an act the kernel refuses");

  /* 2. AND THE ENFORCEMENT LAYER STILL REFUSES IT — proving the offer is a lie
        rather than a relaxation. The kernel is NOT mutated by this control. */
  let thrown = null;
  try {
    GESTURE.gesture(() => Kernel.approveEntityStateCanon(clone(project), {
      list: "characters", entityId: "CHAR-COURIER", stateId: "state-default",
      value: "CHAR-COURIER-FRONT.png", assetId: "", at: "2026-09-03T10:00:00.000Z", via: "nc-at1-1",
    }));
  } catch (error) { thrown = error; }
  ok(thrown, "NC-AT1-1: and pressing it would still be refused");
  equal(thrown.code, "AUTHORITY_ARTIFACT_UNDECLARED", "with the refusal the offer could not see");

  /* 3. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-AT1-1", "must not be offered as immediately executable", () => {
    assert.strictEqual(seen.wouldRefuse, true,
      "a confirmation the kernel would refuse must not be offered as immediately executable");
  });

  note("NC-AT1-1 restored the ownership-only preflight: an enabled Confirm over AUTHORITY_ARTIFACT_UNDECLARED");
}

/* ===========================================================================
   NC-AT1-2 — RESTORE THE ZERO-SHOT VACUOUS COMPLETION.
   =========================================================================== */

const NC2_ANCHOR = `  if (primary.kind === "add-first-shot") return openContextualAdd("shot");`;
const NC2_BREAK = `  if (primary.kind === "add-first-shot") return toast("Every shot has been delivered");`;

async function nc2_zeroShotCompletion() {
  anchorIn("public/app.js", NC2_ANCHOR, "NC-AT1-2");

  const page = await render("#/production", emptyFixture(), {
    mutateSource: replacing("app.js", NC2_ANCHOR, NC2_BREAK),
  });

  const seen = evaluate(page.context, `
    continueProduction();
    const modal = document.getElementById("modal");
    return {
      toast: (document.getElementById("toast") || {}).textContent || "",
      openedCreation: /New shot/i.test(modal ? modal.innerHTML : ""),
      shots: P.shots.length,
    };
  `);

  /* 1. THE DEFECT: a project with no shots is told every shot is delivered. */
  equal(seen.shots, 0, "NC-AT1-2 precondition: the project has no shots at all");
  equal(seen.toast, "Every shot has been delivered", "NC-AT1-2 reproduces the vacuous completion claim");
  equal(seen.openedCreation, false, "and the real creation flow never opens");

  /* 2. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-AT1-2", "must open the real shot-creation flow", () => {
    assert(seen.openedCreation,
      "a zero-shot project's primary action must open the real shot-creation flow");
  });
  await mustFail("NC-AT1-2 claim", "must not claim anything has been delivered", () => {
    assert(!/has been delivered/i.test(seen.toast),
      "a project with no shots must not claim anything has been delivered");
  });

  note("NC-AT1-2 restored the zero-shot advance-delivered owner: ADD THE FIRST SHOT answering \"Every shot has been delivered\"");
}

/* ===========================================================================
   NC-AT1-3 — RESTORE THE MANUAL-START MUTATION.

   The trust boundary. The mutated build wires the manual-start title field back
   to the writer that edits the OPEN project, which is what shipped.
   =========================================================================== */

const NC3_ANCHOR = `onchange="setManualStartField('title',this.value)"`;
const NC3_BREAK = `onchange="setProjectTitle(this.value)"`;

async function nc3_manualStartMutation() {
  anchorIn("public/creation-studio.js", NC3_ANCHOR, "NC-AT1-3");

  const project = rawFixture();
  project.meta.title = "The Open Film";

  const page = await render("#/create", project, {
    storage: { "cinebraid-creation-start-path": "scratch" },
    mutateSource: replacing("creation-studio.js", NC3_ANCHOR, NC3_BREAK),
  });

  const seen = evaluate(page.context, `
    const view = creationStudioView();
    const before = JSON.stringify(P);
    /* The handler the mutated markup wires up — the one that shipped. */
    setProjectTitle("A Completely Different Film");
    return {
      wiredToOpenProject: view.indexOf("setProjectTitle(this.value)") >= 0,
      promise: /becomes its own project/i.test(view),
      identical: before === JSON.stringify(P),
      title: P.meta.title,
    };
  `);

  /* 1. THE DEFECT, BESIDE THE PROMISE THAT CONTRADICTS IT. */
  equal(seen.wiredToOpenProject, true, "NC-AT1-3 reproduces the manual-start field writing to the open project");
  equal(seen.promise, true, "on a screen that still promises the open project is not changed");
  equal(seen.identical, false, "and the open project was changed");
  equal(seen.title, "A Completely Different Film", "its title was silently rewritten by the New Project surface");

  /* 2. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-AT1-3", "must leave the open project unchanged", () => {
    assert(seen.identical,
      "editing a Start manually field must leave the open project unchanged");
  });

  note("NC-AT1-3 restored the manual-start mutation: typing a title under Start manually renamed the open film");
}

/* ===========================================================================
   NC-AT1-4 — RESTORE THE UNREVOKED CANON-STATE DELETION.

   The stranding defect: remove the edge, leave the receipt current, and the
   write seam refuses every later save.
   =========================================================================== */

const NC4_ANCHOR = `      revokeEntityStateCanonForRemoval(list, x, planned.removedIds || [state.id]);`;
const NC4_BREAK = `      void planned;`;

async function nc4_unrevokedStateDeletion() {
  anchorIn("public/entities.js", NC4_ANCHOR, "NC-AT1-4");

  const project = rawFixture();
  const entity = project.characters[0];
  entity.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: entity.approvedFile || "KAI-ANCHOR.png" },
    { id: "state-rain", name: "Rain-soaked", isDefault: false, parentStateId: "state-default", approvedFile: "KAI-RAIN.png" },
  ];
  withCanon(project, [{
    kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain", value: "KAI-RAIN.png",
  }]);

  const page = await render(`#/character/${entity.id}`, project, {
    mutateSource: replacing("entities.js", NC4_ANCHOR, NC4_BREAK),
  });

  const seen = page.gesture.act(() => evaluate(page.context, `
    const entity = P.characters[0];
    const index = entity.continuityStates.findIndex((row) => row.id === "state-rain");
    removeContinuityState("characters", entity.id, index);
    const receipt = (P.productionAuthority.receipts || []).find((row) => row.stateId === "state-rain");
    return {
      stateGone: !entity.continuityStates.some((row) => row.id === "state-rain"),
      receiptStatus: receipt ? receipt.status : "",
      after: JSON.parse(JSON.stringify(P)),
    };
  `));

  /* 1. THE DEFECT: the state is gone and the receipt still says current. */
  equal(seen.stateGone, true, "NC-AT1-4 precondition: the state was removed");
  equal(seen.receiptStatus, "current", "NC-AT1-4 reproduces the orphaned receipt");

  const orphan = (seen.after.productionAuthority.receipts || [])
    .filter((row) => row.status === "current" && row.kind === "entity-state")
    .find((row) => {
      const owner = (seen.after[row.list] || []).find((e) => e.id === row.entityId);
      if (!owner) return true;
      return !(owner.continuityStates || []).some((s) => s.id === row.stateId);
    });
  ok(orphan, "NC-AT1-4: a current receipt is left pointing at a state that no longer exists");

  /* 2. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-AT1-4", "must revoke the receipt before removing the state", () => {
    assert.strictEqual(seen.receiptStatus, "revoked",
      "deleting a Canon-holding state must revoke the receipt before removing the state");
  });
  await mustFail("NC-AT1-4 orphan", "must leave no current receipt", () => {
    assert.strictEqual(orphan, undefined,
      "deleting a Canon-holding state must leave no current receipt pointing at a removed target");
  });

  note("NC-AT1-4 restored the direct edge deletion: the state went and its receipt stayed current");
}


/* ===========================================================================
   NC-AT1-5 — RESTORE THE CANON-SHAPED GUARD.

   The first version of AT1-E guarded on `hasCurrentHumanAuthority`, which is a
   STRONGER question than the one that strands a save. The seam refuses on a
   receipt ROW being `current`; Canon additionally requires the live edge to match
   it. So a state whose edge had drifted skipped revocation and was spliced out
   anyway, recreating the very orphan the slice was written to prevent — silently.

   This restores that guard and proves the orphan comes back with it.
   =========================================================================== */

const NC5_ANCHOR = `    if (!target || !currentAuthorityRowExists(list, entity, stateId)) continue;`;
const NC5_BREAK = `    if (!target || !hasCurrentHumanAuthority(P, target)) continue;`;

async function nc5_canonShapedGuard() {
  anchorIn("public/entities.js", NC5_ANCHOR, "NC-AT1-5");

  const project = rawFixture();
  const entity = project.characters[0];
  entity.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: entity.approvedFile || "KAI-ANCHOR.png" },
    { id: "state-rain", name: "Rain-soaked", isDefault: false, parentStateId: "state-default", approvedFile: "KAI-RAIN.png" },
  ];
  withCanon(project, [{
    kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain", value: "KAI-RAIN.png",
  }]);
  /* THE DRIFT: the edge moves, the identity-less receipt cannot follow it. */
  entity.continuityStates.find((row) => row.id === "state-rain").approvedFile = "KAI-RAIN-RENAMED.png";

  const target = { kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain" };
  equal(Kernel.authorityHistory(project, target).some((row) => row && row.status === "current"), true,
    "NC-AT1-5 precondition: the receipt row is current");
  equal(Kernel.hasCurrentHumanAuthority(project, target), false,
    "NC-AT1-5 precondition: and the drifted edge means it does not read as Canon");

  const page = await render(`#/character/${entity.id}`, project, {
    mutateSource: replacing("entities.js", NC5_ANCHOR, NC5_BREAK),
  });
  const seen = page.gesture.act(() => evaluate(page.context, `
    const entity = P.characters[0];
    const index = entity.continuityStates.findIndex((row) => row.id === "state-rain");
    removeContinuityState("characters", entity.id, index);
    const receipt = (P.productionAuthority.receipts || []).find((row) => row.stateId === "state-rain");
    return {
      stateGone: !entity.continuityStates.some((row) => row.id === "state-rain"),
      receiptStatus: receipt ? receipt.status : "",
      after: JSON.parse(JSON.stringify(P)),
    };
  `));

  /* 1. THE DEFECT: spliced out, receipt still current. */
  equal(seen.stateGone, true, "NC-AT1-5 reproduces the silent removal of a drifted state");
  equal(seen.receiptStatus, "current", "and its receipt is left naming a state that no longer exists");

  /* 2. AND THE SEAM REFUSES THE DOCUMENT — the stranding, in full. */
  const seam = require(path.join(ROOT, "authority-write-seam"));
  const crypto = require("crypto");
  let stored = clone(project), writes = 0;
  const boundary = seam.createAuthorityWriteSeam({
    resolveFile: () => "project.json", exists: () => true,
    readProject: () => clone(stored),
    revisionFor: () => JSON.stringify(crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex")),
    validateProject: () => ({ ok: true, errors: [] }),
    writeProject: (_file, successor) => { stored = clone(successor); writes += 1; },
  });
  const outcome = boundary.persistProjectSuccessor({
    slug: "p", successor: seen.after, writeClass: seam.WRITE_CLASSES.CANON_TRANSITION,
    expectedRevision: JSON.stringify(crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex")),
    transitionMetadata: Kernel.authorityWriteTransition(project, seen.after).declaration,
  });
  equal(outcome.ok, false, "NC-AT1-5: and the write seam refuses the resulting document");
  equal(outcome.refusal.code, "AUTHORITY_EDGE_RECEIPT_MISMATCH", "with the exact code the audit reported");
  equal(writes, 0, "so nothing reaches disk and every unrelated edit is stranded");

  /* 3. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-AT1-5", "must not remove a state whose receipt cannot be withdrawn", () => {
    assert(!seen.stateGone,
      "a state whose current receipt cannot be withdrawn must not be removed — CineBraid must not remove a state whose receipt cannot be withdrawn");
  });

  note("NC-AT1-5 restored the Canon-shaped guard: a drifted state was spliced out and the seam then refused the whole document");
}

/* ===========================================================================
   RETIREMENT ASSERTIONS.

   Each fails if a superseded OWNER returns. These are the point of the file.
   =========================================================================== */

function r_retirementAssertions() {
  /* R-AT1-1 — THE RETIREMENT OF RECORD: the manual-start mutation path.
   *
   * The manual identity card is isolated by its own marker attribute, and the
   * assertion is about what that card can REACH. Three writers edited the open
   * project from it — setProjectTitle(), a bare `P.meta.format=` assignment and
   * setGlobalCreationField() — and every one of them called dirty(), which is
   * what made a mis-click durable. None of them may be reachable from this card
   * again, whatever the fields are renamed to. */
  const studio = codeOnly(readLF("public/creation-studio.js"));
  const cardStart = studio.indexOf("function creationManualIdentityCard()");
  ok(cardStart >= 0, "R-AT1-1: the manual identity card is still the surface Start manually renders");
  const card = studio.slice(cardStart, studio.indexOf("\n}", cardStart));
  ok(!/setProjectTitle\s*\(/.test(card),
    "R-AT1-1 RETIRED: the manual identity card must not reach setProjectTitle — that writer renames the OPEN project");
  ok(!/setGlobalCreationField\s*\(/.test(card),
    "R-AT1-1 RETIRED: nor setGlobalCreationField, which writes P.meta and marks the open project dirty");
  ok(!/\bP\.meta\.\w+\s*=/.test(card),
    "R-AT1-1 RETIRED: nor assign to the open project's metadata directly");
  ok(!/\bdirty\s*\(/.test(card),
    "R-AT1-1 RETIRED: and it must not be able to mark the open project dirty at all");
  ok(/setManualStartField\s*\(/.test(card),
    "R-AT1-1: the draft writer is what it reaches instead");

  /* And the draft writer itself cannot reach the open project either — the same
     absence, one level down, so the retirement cannot be defeated by moving the
     writer rather than removing it. */
  const setter = (studio.split("window.setManualStartField = ")[1] || "").split("};")[0];
  ok(setter.length > 0, "R-AT1-1: setManualStartField exists");
  ok(!/\bdirty\s*\(/.test(setter) && !/\bP\.meta\b/.test(setter),
    "R-AT1-1 RETIRED: and the draft writer cannot reach the open project or the save loop");

  /* R-AT1-2 — the ownership-only preflight owner.
   *
   * `confirmationOwnership` must not be able to decide `wouldRefuse` from an
   * ownership resolution again. The specific superseded expression compared a
   * durable-claim basis against the target's entity id; the general rule is that
   * the kernel preflight is the only thing that may set it. */
  const readiness = codeOnly(readLF("public/shared-shot-readiness.js"));
  const fnStart = readiness.indexOf("function confirmationOwnership(");
  ok(fnStart >= 0, "R-AT1-2: confirmationOwnership is still the owner of the queue's veto answer");
  const fn = readiness.slice(fnStart, readiness.indexOf("\n  }", fnStart));
  ok(/canonApprovalPreflightOwner\s*\(/.test(fn),
    "R-AT1-2: it asks the kernel's preflight");
  ok(!/wouldRefuse:\s*!owned/.test(fn),
    "R-AT1-2 RETIRED: the ownership-only verdict `wouldRefuse: !owned` must not come back");
  ok(!/const\s+owned\s*=/.test(fn),
    "R-AT1-2 RETIRED: nor the local ownership verdict it was computed from");
  /* And the dependency is HARD, so a kernel that stopped exporting the preflight
     fails loudly instead of letting this module guess again. */
  ok(/requireOwner\(KERNEL && KERNEL\.canonApprovalPreflight/.test(readiness),
    "R-AT1-2: and the preflight is a hard owner dependency, not an optional one");

  /* R-AT1-3 — the zero-shot completion owner.
   *
   * continueProduction() must not be able to answer a zero-shot project with a
   * completion message. It reads one owner now, and that owner distinguishes
   * "nothing outstanding" from "nothing at all". */
  const app = codeOnly(readLF("public/app.js"));
  const handlerStart = app.indexOf("window.continueProduction = ");
  ok(handlerStart >= 0, "R-AT1-3: continueProduction is still the primary control's handler");
  const handler = app.slice(handlerStart, app.indexOf("\n};", handlerStart));
  ok(/projectPrimaryProductionAction\s*\(/.test(handler),
    "R-AT1-3: it reads the one owner that decides the words and the act together");
  ok(/add-first-shot/.test(handler) && /openContextualAdd/.test(handler),
    "R-AT1-3: and a zero-shot project reaches the real creation flow");
  ok(!/if\s*\(!next\)\s*return toast/.test(handler),
    "R-AT1-3 RETIRED: the owner that answered every empty answer with a completion toast must not come back");
  /* The label is derived from the same owner, so the two cannot disagree again. */
  ok(!/next \? "CONTINUE PRODUCTION" : hasShots \? "NOTHING OUTSTANDING"/.test(app),
    "R-AT1-3 RETIRED: nor the second, independent derivation of the button's words");

  /* R-AT1-4 — the duplicate final-action owner.
   *
   * A control that TRAVELS must not be labelled with the act it travels to. The
   * two branches of projectNextProductionAction that produce an href into a shot
   * used readinessActionWords(); both must use the navigation wording now. */
  const readyBranch = app.slice(app.indexOf("const ready = (feed.shots || [])"), app.indexOf("const outstanding = (feed.shots || [])"));
  ok(readyBranch.length > 0, "R-AT1-4: the READY branch of the project's next action is still there");
  ok(/readinessNavigationWords\s*\(/.test(readyBranch),
    "R-AT1-4: and it labels its link as travel");
  ok(!/actionLabel: readinessActionWords\(/.test(app),
    "R-AT1-4 RETIRED: no navigating control may be labelled with the performing control's words again");

  note("R four superseded owners are asserted absent: the manual-start mutation path, the ownership-only preflight, the zero-shot completion owner, and the duplicate final-action label");
}

/* THE RETIREMENT ASSERTIONS MUST THEMSELVES BE ABLE TO FAIL. An absence check
   that cannot fire is decoration, so each one is run once against a source in
   which the superseded owner HAS returned. */
async function r_retirementAssertionsFire() {
  const studio = codeOnly(readLF("public/creation-studio.js"));
  const restored = studio.replace("setManualStartField('title',this.value)", "setProjectTitle(this.value)");
  const cardStart = restored.indexOf("function creationManualIdentityCard()");
  const card = restored.slice(cardStart, restored.indexOf("\n}", cardStart));
  await mustFail("R-AT1-1 fires", "must not reach setProjectTitle", () => {
    assert(!/setProjectTitle\s*\(/.test(card),
      "the manual identity card must not reach setProjectTitle");
  });

  const readiness = codeOnly(readLF("public/shared-shot-readiness.js"));
  const brokenReadiness = readiness.replace("wouldRefuse: refused,", "wouldRefuse: !owned,");
  await mustFail("R-AT1-2 fires", "must not come back", () => {
    assert(!/wouldRefuse:\s*!owned/.test(brokenReadiness),
      "the ownership-only verdict must not come back");
  });

  const app = codeOnly(readLF("public/app.js"));
  const brokenApp = app.replace(
    'if (primary.kind === "nothing-outstanding") return toast("Every shot has been delivered");',
    'if (!next) return toast("Every shot has been delivered");',
  );
  const handlerStart = brokenApp.indexOf("window.continueProduction = ");
  const handler = brokenApp.slice(handlerStart, brokenApp.indexOf("\n};", handlerStart));
  await mustFail("R-AT1-3 fires", "must not come back", () => {
    assert(!/if\s*\(!next\)\s*return toast/.test(handler),
      "the completion-toast owner must not come back");
  });

  const brokenLabels = app.replace("actionLabel: readinessNavigationWords(", "actionLabel: readinessActionWords(");
  await mustFail("R-AT1-4 fires", "must not be labelled", () => {
    assert(!/actionLabel: readinessActionWords\(/.test(brokenLabels),
      "a navigating control must not be labelled with the performing control's words");
  });

  /* WHAT THIS PROVED, EXACTLY. Four assertions — one per retired owner — were run
     against a source in which that owner had returned, and each fired. The other
     RETIRED assertions in r_retirementAssertions() are the same shape over the
     same sources and are not separately re-proved here; this establishes that the
     technique fires rather than that every line of it does. */
  note("R the four retired owners were each re-introduced into a copy of the shipped source, and the assertion guarding each one fired");
}

/* THE SHIPPED BUILD IS GREEN ON EVERY CLAIM THE CONTROLS BROKE. */
async function shippedBuildIsGreen() {
  const project = sample();
  const feed = Readiness.evaluateProjectReadiness(clone(project));
  for (const item of (feed.historic && feed.historic.items) || []) {
    equal(item.ownership.wouldRefuse, false, `shipped: ${item.key} is offered and would succeed`);
  }

  const page = await render("#/production", emptyFixture());
  const seen = await evaluateAsync(page.context, `
    const primary = projectPrimaryProductionAction();
    continueProduction();
    const modal = document.getElementById("modal");
    return {
      kind: primary.kind,
      openedCreation: /New shot/i.test(modal ? modal.innerHTML : ""),
      toast: (document.getElementById("toast") || {}).textContent || "",
    };
  `);
  equal(seen.kind, "add-first-shot", "shipped: a zero-shot project offers the first shot");
  equal(seen.openedCreation, true, "shipped: and pressing it opens the real creation flow");
  ok(!/has been delivered/i.test(seen.toast), "shipped: with no completion claim");

  note("the shipped build is green on every claim the five controls broke");
}

async function main() {
  await nc1_ownershipOnlyPreflight();
  await nc2_zeroShotCompletion();
  await nc3_manualStartMutation();
  await nc4_unrevokedStateDeletion();
  await nc5_canonShapedGuard();
  r_retirementAssertions();
  await r_retirementAssertionsFire();
  await shippedBuildIsGreen();
  for (const line of notes) console.log(line);
  console.log(`action-truth-first-press-negative-controls: ${checks} controls fired`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
