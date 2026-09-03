/* CineBraid — AT1: ACTION TRUTH / FIRST-PRESS RELIABILITY.
 *
 * THE PRODUCT RULE THIS SUITE GOVERNS, and it is one sentence:
 *
 *     IF CINEBRAID OFFERS AN ENABLED ACTION, PRESSING IT MUST EITHER PERFORM
 *     THE NAMED ACT, OR TRUTHFULLY TAKE THE FILMMAKER TO THE EXACT PLACE WHERE
 *     THAT ACT CAN BE PERFORMED.
 *
 * CineBraid must not offer a control that its own enforcement layer already
 * knows will fail. The September 3 production-truth audit found the enforcement
 * layer generally CORRECT and the OFFER wrong, which is why nothing in this
 * suite relaxes a refusal. Every check here is about what was offered, and about
 * what completing the act actually does.
 *
 * THE SIX DEFECTS, AND WHAT EACH ONE LOOKED LIKE TO A FILMMAKER:
 *
 *   A  The shipped sample opened with four enabled Confirm buttons on the first
 *      screen, and the kernel refused every one of them:
 *      AUTHORITY_ARTIFACT_UNDECLARED, because no candidate row said whether the
 *      image was a single view or a multi-view sheet.
 *
 *   B  Readiness answered "would the veto allow it" from OWNERSHIP ALONE, so the
 *      artifact-structure veto beside it was invisible to the offer. That is the
 *      mechanism behind A, and it would have produced the next one too.
 *
 *   C  A project with no shots printed ADD THE FIRST SHOT on a primary button
 *      and answered the press with "Every shot has been delivered".
 *
 *   D  Start a project promises, in its own words, "Whatever you start here
 *      becomes its own project. The one you have open now is not changed."
 *      Typing a title under Start manually renamed the OPEN project and queued
 *      the rename to be saved.
 *
 *   E  Deleting a non-default continuity state that held current Canon removed
 *      the edge and left the receipt current, so the write seam refused every
 *      later save with AUTHORITY_EDGE_RECEIPT_MISMATCH and unrelated edits were
 *      stranded until reload.
 *
 *   F  Production's NEXT ACTION card — an <a href> — wore the performing
 *      control's exact words, so "MARK SHOT FINAL" appeared on a link that marks
 *      nothing final, in the same product as a button that does.
 *
 *   G  Every refusal was a 2.2-second toast and nothing else, so a filmmaker who
 *      pressed and looked back found the control unchanged and the reason gone.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT DO. It forms no opinion about what is
 * approvable. Every verdict it checks is the kernel's, every approval it makes
 * is written by the shipped command inside a delivered trusted gesture, and
 * every refusal it asserts is one the shipped enforcement layer produced. A
 * verdict this suite computed itself would be the defect wearing a test's
 * clothes.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const { Kernel, Private } = require("./authority-kernel-private");
const Readiness = require(path.join(PUBLIC, "shared-shot-readiness.js"));
const Coverage = require(path.join(PUBLIC, "shared-coverage.js"));
const { installTestManualActionSource } = require("./authority-test-gesture.js");
const { render, rawFixture, emptyFixture, withCanon } = require("./render-harness.js");

const GESTURE = installTestManualActionSource(Kernel);
const AT = "2026-09-03T10:00:00.000Z";

let checks = 0;
const notes = [];
const note = (line) => notes.push(line);
function ok(value, message) { checks += 1; assert(value, message); }
function equal(actual, expected, message) { checks += 1; assert.strictEqual(actual, expected, message); }
function deepEqual(actual, expected, message) { checks += 1; assert.deepStrictEqual(actual, expected, message); }

const clone = (value) => JSON.parse(JSON.stringify(value));
const SAMPLE_PATH = path.join(ROOT, "projects", "cinebraid-sample", "project.json");
const sample = () => JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));
const readSource = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
/* Comments are stripped wherever this suite asks "can that function reach that
   writer?" — a note explaining a rule NAMES the thing the rule forbids, which is
   what a reader needs and exactly what an absence check must not trip over. The
   same helper tests/readiness-action-projection.js keeps, for the same reason. */
const codeOnly = (source) => String(source).replace(/\/\*[\s\S]*?\*\//g, "");

function evaluate(context, body) {
  return vm.runInContext(`(() => { ${body} })()`, context);
}
function evaluateAsync(context, body) {
  return vm.runInContext(`(async () => { ${body} })()`, context);
}

/* Every entity-state target the shipped sample carries, derived FROM the sample
   rather than listed here, so a re-seed that adds a reference is covered without
   this suite being edited to notice it. */
function sampleStateTargets(project) {
  const rows = [];
  for (const list of ["characters", "locations", "props", "vehicles"]) {
    for (const entity of project[list] || []) {
      for (const state of entity.continuityStates || []) {
        if (!state.approvedFile) continue;
        rows.push({
          kind: "entity-state", list, entityId: entity.id, stateId: state.id,
          value: state.approvedFile, assetId: state.approvedAssetId || "",
        });
      }
    }
  }
  return rows;
}

/* ===========================================================================
   A — THE SHIPPED SAMPLE'S FIRST ACTION ACTUALLY SUCCEEDS.

   The release archive contains this fixture, so a filmmaker's first press in a
   fresh install is one of these. The check is not "the sample parses": it is
   that the exact confirmations the sample INTENDS are valid under the CURRENT
   receipt and coverage authority, and that performing one writes a receipt.
   =========================================================================== */

function a_shippedSampleFirstAction() {
  const project = sample();
  const targets = sampleStateTargets(project);
  ok(targets.length >= 4, `A1: the shipped sample offers reference confirmations to check (${targets.length})`);

  /* 1. STRUCTURE IS DECLARED, and declared the way manual intake declares it. */
  for (const target of targets) {
    const entity = (project[target.list] || []).find((row) => row.id === target.entityId);
    const structure = Coverage.referenceArtifactStructureOf(entity, target.value);
    equal(structure, "single",
      `A2 ${target.entityId}/${target.stateId}: ${target.value} is declared a single view, not left undeclared`);
    equal(Coverage.artifactMayHoldPrimaryAuthority(structure), true,
      `A2 ${target.entityId}/${target.stateId}: and may therefore hold primary identity authority`);
  }

  /* 2. THE KERNEL'S OWN PREFLIGHT SAYS YES to every one of them. */
  for (const target of targets) {
    const verdict = Kernel.canonApprovalPreflight(project, { ...target, at: AT });
    equal(verdict.ok, true,
      `A3 ${target.entityId}/${target.stateId}: the shipped veto permits the confirmation (${verdict.code} ${verdict.message})`);
  }

  /* 3. AND THE OFFER AGREES. The readiness queue is what the surface renders. */
  const feed = Readiness.evaluateProjectReadiness(clone(project));
  const queue = (feed.historic && feed.historic.items) || [];
  ok(queue.length >= 4, `A4: the sample's references are queued for confirmation (${queue.length})`);
  for (const item of queue) {
    equal(item.ownership.wouldRefuse, false,
      `A4 ${item.key}: offered as immediately executable, with no known veto behind it`);
  }

  /* 4. PERFORMING IT WRITES A RECEIPT. Through the shipped command, inside one
        delivered trusted gesture — the same path the Confirm button takes. */
  const live = clone(project);
  const first = targets[0];
  const receipt = GESTURE.gesture(() => Kernel.approveEntityStateCanon(live, {
    list: first.list, entityId: first.entityId, stateId: first.stateId,
    value: first.value, assetId: first.assetId, at: AT, via: "at1-sample-suite",
  }));
  ok(receipt && receipt.id, "A5: the sample's guided first action writes an authority receipt");
  equal(receipt.status, "current", "A5: and the receipt is current");
  equal(Kernel.hasCurrentHumanAuthority(live, first), true,
    "A5: so the reference now holds Canon, which is what the filmmaker was told would happen");
  equal(Kernel.validateAuthorityLedger(live).trusted, true, "A5: and the resulting ledger is readable");

  /* 5. DEPENDENT READINESS MOVES. The confirmation leaves the queue. */
  const after = Readiness.evaluateProjectReadiness(live);
  const stillQueued = ((after.historic && after.historic.items) || []).map((row) => row.key);
  ok(!stillQueued.some((key) => key.includes(first.entityId) && key.includes(first.stateId)),
    "A6: and the confirmed reference is no longer waiting for confirmation");

  note(`A the shipped sample's ${targets.length} reference confirmations are valid under current authority, and the first one writes a receipt`);
}

/* ===========================================================================
   B — PREFLIGHT KNOWS EVERY DETERMINISTIC ENFORCEMENT VETO.

   PARITY, not a list of remembered codes: each case is put to the WRITER and to
   the PREFLIGHT, and the two must agree. A veto the writer raises and the
   preflight does not is exactly the defect — an enabled control over a refusal.
   =========================================================================== */

function b_preflightVetoParity() {
  const base = sample();
  const good = {
    kind: "entity-state", list: "characters", entityId: "CHAR-COURIER",
    stateId: "state-default", value: "CHAR-COURIER-FRONT.png", assetId: "",
  };

  /* Each case names a deterministic refusal the writer can raise from PROJECT
     STATE or REQUEST SHAPE. The gesture veto is deliberately absent: a gesture
     is a property of the act, not of the project, and the press supplies it. */
  const cases = [
    {
      label: "an undeclared artifact structure",
      project: (P) => { P.characters[0].candidateFiles = []; },
      request: () => ({ ...good }),
    },
    {
      label: "a coverage sheet offered as identity",
      project: (P) => { P.characters[0].candidateFiles = [{ stored: "CHAR-COURIER-FRONT.png", coverageJobType: "sheet" }]; },
      request: () => ({ ...good }),
    },
    {
      label: "a file this reference does not own",
      project: () => {},
      request: () => ({ ...good, value: "SOMEBODY-ELSES-FILE.png" }),
    },
    {
      label: "a target this project does not have",
      project: () => {},
      request: () => ({ ...good, entityId: "CHAR-NOBODY" }),
    },
    {
      label: "no media named at all",
      project: () => {},
      request: () => ({ ...good, value: "" }),
    },
    {
      label: "silence about the media's identity",
      project: () => {},
      request: () => { const it = { ...good }; delete it.assetId; return it; },
    },
    {
      label: "an incomplete target",
      project: () => {},
      request: () => ({ ...good, list: "" }),
    },
    {
      label: "an unreadable approval ledger",
      project: (P) => { P.productionAuthority = { version: 99, receipts: "not a list" }; },
      request: () => ({ ...good }),
    },
  ];

  const observed = [];
  for (const row of cases) {
    const project = clone(base);
    row.project(project);
    const request = row.request();

    /* WHAT THE WRITER ACTUALLY DOES, asked first so the expectation is never a
       memory of the enforcement layer — it IS the enforcement layer. */
    let thrown = null;
    try {
      GESTURE.gesture(() => Kernel.approveEntityStateCanon(clone(project), { ...request, at: AT, via: "at1-parity" }));
    } catch (error) { thrown = error; }
    ok(thrown, `B1 ${row.label}: the writer refuses it`);
    ok(String(thrown.code || "").startsWith("AUTHORITY_"),
      `B1 ${row.label}: with a typed authority refusal (${thrown.code})`);

    /* AND WHAT THE OFFER WOULD HAVE BELIEVED. */
    const verdict = Kernel.canonApprovalPreflight(project, { ...request, at: AT });
    equal(verdict.ok, false, `B2 ${row.label}: preflight refuses it too, so no enabled control is offered`);
    equal(verdict.code, thrown.code,
      `B2 ${row.label}: and names the same refusal the writer raises (preflight ${verdict.code} vs writer ${thrown.code})`);
    ok(String(verdict.message || "").length > 0, `B2 ${row.label}: with a sentence saying what is required`);
    observed.push(thrown.code);
  }

  /* THE SET IS NOT ACCIDENTALLY NARROW. Eight cases that all produced the same
     code would satisfy every assertion above and prove nothing. */
  ok(new Set(observed).size >= 5,
    `B3: the parity cases exercise genuinely different vetoes (${[...new Set(observed)].sort().join(", ")})`);

  /* PREFLIGHT DOES NOT MUTATE — invariant 6 of the kernel — and this asks it of
     a request that WOULD have written an edge had it been the real command. */
  const untouched = clone(base);
  const before = JSON.stringify(untouched);
  Kernel.canonApprovalPreflight(untouched, { ...good, at: AT });
  equal(JSON.stringify(untouched), before, "B4: asking the preflight changes nothing in the project");

  /* AND THE OFFER SURFACE READS IT. Readiness must carry no second opinion. */
  const undeclared = clone(base);
  undeclared.characters[0].candidateFiles = [];
  const feed = Readiness.evaluateProjectReadiness(undeclared);
  const row = ((feed.historic && feed.historic.items) || []).find((item) => item.key.includes("CHAR-COURIER"));
  ok(row, "B5: the undeclared reference is still listed, because it is still waiting");
  equal(row.ownership.wouldRefuse, true, "B5: but it is not offered as immediately executable");
  equal(row.ownership.code, "AUTHORITY_ARTIFACT_UNDECLARED", "B5: and the row names the kernel's refusal code");
  ok(/no record of what kind of image/i.test(row.ownership.reason),
    "B5: carrying the kernel's own requirement sentence rather than a paraphrase: " + row.ownership.reason);

  note(`B preflight and enforcement agree on ${cases.length} deterministic vetoes, and readiness reads the preflight instead of guessing`);
}

/* ===========================================================================
   C — A PROJECT WITH NO SHOTS OFFERS SHOT CREATION, AND PERFORMS IT.
   =========================================================================== */

async function c_emptyProjectFirstShot() {
  const project = emptyFixture();
  equal(project.shots.length, 0, "C1 precondition: the project has no shots");

  const page = await render("#/production", project);
  const seen = await evaluateAsync(page.context, `
    const home = await productionHomeView();
    const primary = projectPrimaryProductionAction();
    return {
      primaryKind: primary.kind,
      primaryLabel: primary.label,
      homeButton: (home.split('onclick="continueProduction()">')[1] || "").split("<")[0],
      claimsDelivered: /has been delivered|are delivered/i.test(home),
    };
  `);

  equal(seen.primaryKind, "add-first-shot", "C2: the project's primary action is to add the first shot");
  equal(seen.primaryLabel, "ADD THE FIRST SHOT", "C2: and says so");
  equal(seen.homeButton, "ADD THE FIRST SHOT", "C2: which is exactly what Production's primary button renders");
  equal(seen.claimsDelivered, false, "C2: and nothing on the page claims anything has been delivered");

  /* THE PRESS. What matters is not the message — it is that the real creation
     flow opens. addShot() is the shipped owner and it creates the first scene
     too, which is what lets a zero-shot project reach it at all. */
  const pressed = evaluate(page.context, `
    continueProduction();
    const modal = document.getElementById("modal");
    return {
      modalHtml: modal ? modal.innerHTML : "",
      toast: (document.getElementById("toast") || {}).textContent || "",
    };
  `);
  ok(/New shot/i.test(pressed.modalHtml),
    "C3: pressing it opens the real New shot flow: " + pressed.modalHtml.slice(0, 140));
  ok(!/has been delivered/i.test(pressed.toast),
    "C3: and CineBraid does not answer with a completion claim: " + pressed.toast);

  /* THE SHOTS BOARD HEAD offered a bare CONTINUE with no empty guard at all. */
  const board = await render("#/shots/board", emptyFixture());
  const boardSeen = evaluate(board.context, `
    const primary = projectPrimaryProductionAction();
    return { kind: primary.kind, label: primary.label };
  `);
  equal(boardSeen.kind, "add-first-shot", "C4: the Shots board answers the same question the same way");
  equal(boardSeen.label, "ADD THE FIRST SHOT", "C4: from the same owner, so the two heads cannot disagree");

  note("C a zero-shot project offers ADD THE FIRST SHOT, and pressing it opens the real New shot flow");
}

/* ===========================================================================
   D — START MANUALLY CREATES A PROJECT AND DOES NOT EDIT THE OPEN ONE.

   This is the trust boundary, so the proof is a byte comparison of the open
   project taken before and after every manual-start field is edited.
   =========================================================================== */

async function d_manualStartSeparation() {
  const project = rawFixture();
  project.meta.title = "The Open Film";
  project.meta.format = "Feature film";
  project.meta.aspectRatio = "2.39:1";

  const page = await render("#/create", project, { storage: { "cinebraid-creation-start-path": "scratch" } });

  const seen = evaluate(page.context, `
    const view = creationStudioView();
    const before = JSON.stringify(P);
    /* Every manual-start field, edited the way the rendered control edits it. */
    setManualStartField("title", "A Completely Different Film");
    setManualStartField("format", "Music video");
    setManualStartField("aspectRatio", "9:16");
    const after = JSON.stringify(P);
    return {
      promise: /becomes its own project/i.test(view),
      offersManualPanel: view.includes("data-manual-identity"),
      offersCommit: view.includes("data-manual-start-commit"),
      /* The rendered inputs must not be seeded from the open project either:
         showing the open film's title in a box that claims to describe a new one
         is how a rename reads as a creation. */
      showsOpenTitleInField: /value="The Open Film"[^>]*onchange="setManualStartField/.test(view),
      identical: before === after,
      title: P.meta.title,
      format: P.meta.format,
      aspect: P.meta.aspectRatio,
      draft: JSON.parse(JSON.stringify(window.__cinebraidManualStart)),
    };
  `);

  equal(seen.promise, true, "D1: the screen makes the promise that whatever starts here becomes its own project");
  equal(seen.offersManualPanel, true, "D1: and Start manually renders its identity panel");
  equal(seen.offersCommit, true, "D1: with an explicit control that creates the project");
  equal(seen.showsOpenTitleInField, false, "D2: the fields are not seeded from the project already open");
  equal(seen.identical, true, "D3: editing every manual-start field leaves the open project byte-for-byte unchanged");
  equal(seen.title, "The Open Film", "D3: its title is untouched");
  equal(seen.format, "Feature film", "D3: its format is untouched");
  equal(seen.aspect, "2.39:1", "D3: its aspect ratio is untouched");
  /* Field by field rather than deepEqual: the draft crosses the vm realm
     boundary, so its prototype is the page's and not this suite's. */
  equal(seen.draft.title, "A Completely Different Film", "D4: what the filmmaker typed is held as a draft instead");
  equal(seen.draft.format, "Music video", "D4: including the format");
  equal(seen.draft.aspectRatio, "9:16", "D4: and the aspect ratio");

  /* AND THE SAVE LOOP IS NOT WOKEN. `dirty()` on the open project is what turned
     a mis-click into a durable rename, so the setter must not be able to reach
     it — asserted at the source, where the absence is the guarantee. */
  const studio = readSource("public/creation-studio.js");
  const setter = (codeOnly(studio).split("window.setManualStartField = ")[1] || "").split("};")[0];
  ok(setter.length > 0, "D5: setManualStartField is where the manual-start fields are written");
  ok(!/\bdirty\s*\(/.test(setter), "D5: and it cannot mark the open project dirty: " + setter.trim().slice(0, 160));
  ok(!/\bP\.meta\b/.test(setter), "D5: nor write to the open project's metadata at all");

  /* THE COMMIT USES THE SHIPPED CREATION ROUTE — the same one newProject() uses.
     A second creation architecture is exactly what this slice was told not to
     invent, so the route is asserted rather than assumed. */
  ok(/startManualProject[\s\S]{0,1600}\/api\/projects\/new/.test(studio),
    "D6: completing a manual start commits through /api/projects/new, the shipped creation route");

  note("D typing every Start manually field leaves the open project byte-identical, and the commit uses the shipped creation route");
}

/* ===========================================================================
   E — DELETING A CANON-HOLDING CONTINUITY STATE REVOKES BEFORE IT REMOVES.

   The highest-risk path in the slice: it touches receipts, save integrity and a
   filmmaker's unsaved work at once.
   =========================================================================== */

function canonStateProject() {
  const project = rawFixture();
  const entity = project.characters[0];
  const anchor = entity.approvedFile || "KAI-ANCHOR.png";
  entity.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: anchor },
    { id: "state-rain", name: "Rain-soaked", isDefault: false, parentStateId: "state-default", approvedFile: "KAI-RAIN.png" },
  ];
  entity.candidateFiles = [
    ...(entity.candidateFiles || []),
    { stored: "KAI-RAIN.png", original: "kai-rain.png", coverageJobType: "single-reference", targetStateId: "state-rain" },
  ];
  withCanon(project, [{
    kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain", value: "KAI-RAIN.png",
  }]);
  return { project, entityId: entity.id };
}

async function e_canonStateDeletion() {
  const { project, entityId } = canonStateProject();
  const target = { kind: "entity-state", list: "characters", entityId, stateId: "state-rain" };

  /* PRECONDITION, asked of the kernel: the state genuinely holds current Canon. */
  equal(Kernel.hasCurrentHumanAuthority(project, target), true,
    "E1 precondition: the non-default state holds current human authority");

  const page = await render(`#/character/${entityId}`, project);

  const seen = page.gesture.act(() => evaluate(page.context, `
    const entity = P.characters.find((row) => row.id === ${JSON.stringify(entityId)});
    const index = entity.continuityStates.findIndex((row) => row.id === "state-rain");

    /* AN UNRELATED, UNSAVED EDIT MADE FIRST. This is the work that used to be
       stranded behind a receipt the filmmaker could not see or withdraw. */
    entity.notes = "An unrelated note the filmmaker typed before deleting anything";
    P.meta.logline = "An unrelated logline typed in the same session";

    removeContinuityState("characters", entity.id, index);

    const ledger = P.productionAuthority || { receipts: [] };
    const receipt = (ledger.receipts || []).find((row) => row.stateId === "state-rain");
    return {
      stateGone: !entity.continuityStates.some((row) => row.id === "state-rain"),
      defaultKept: entity.continuityStates.some((row) => row.id === "state-default"),
      receiptExists: !!receipt,
      receiptStatus: receipt ? receipt.status : "",
      receiptReason: receipt ? receipt.revocationReason : "",
      receiptRevokedBy: receipt ? receipt.revokedBy : "",
      receiptVia: receipt ? receipt.revokedVia : "",
      stillCanon: hasCurrentHumanAuthority(P, { kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain" }),
      ledgerTrusted: validateAuthorityLedger(P).trusted,
      unrelatedNote: entity.notes,
      unrelatedLogline: P.meta.logline,
      after: JSON.parse(JSON.stringify(P)),
    };
  `));

  /* 1. THE AUTHORITY WAS WITHDRAWN THROUGH THE CANONICAL WRITER. */
  equal(seen.receiptExists, true, "E2: the receipt is still in the ledger — nothing was deleted by hand");
  equal(seen.receiptStatus, "revoked", "E2: and it was revoked");
  equal(seen.receiptReason, "target-removed", "E2: for the reason that is true — the target was removed, not cleared");
  equal(seen.receiptRevokedBy, "human", "E2: recorded as a human revocation, which is what a delete confirmation is");
  equal(seen.receiptVia, "confirmed-target-removal",
    "E2: with the same provenance the accepted shot-side removal path records");

  /* 2. THE STATE IS GONE AND THE PROJECT IS CONSISTENT. */
  equal(seen.stateGone, true, "E3: the state was removed");
  equal(seen.defaultKept, true, "E3: and the base state it derived from was not");
  equal(seen.stillCanon, false, "E3: nothing still claims that target holds Canon");
  equal(seen.ledgerTrusted, true, "E3: and the resulting ledger is readable");

  /* 3. NO ORPHANED RECEIPT — the condition the write seam refuses on. */
  const orphan = (seen.after.productionAuthority.receipts || [])
    .filter((row) => row.status === "current" && row.kind === "entity-state")
    .find((row) => {
      const entity = (seen.after[row.list] || []).find((e) => e.id === row.entityId);
      if (!entity) return true;
      return !(entity.continuityStates || []).some((s) => s.id === row.stateId);
    });
  equal(orphan, undefined, "E4: no current receipt is left pointing at a state that no longer exists");

  /* 4. THE UNRELATED WORK SURVIVED. */
  equal(seen.unrelatedNote, "An unrelated note the filmmaker typed before deleting anything",
    "E5: the unrelated edit made before the delete is still there");
  equal(seen.unrelatedLogline, "An unrelated logline typed in the same session",
    "E5: and so is the unrelated project-level edit");

  /* 5. AND THE RESULT IS A DECLARABLE HUMAN CANON TRANSITION. This is the same
        oracle the Authority Write Seam consults, asked directly rather than
        through a paraphrase of it. */
  const transition = Kernel.authorityWriteTransition(project, seen.after);
  ok(transition, "E6: the write seam's oracle can describe the transition this delete produced");
  equal(transition.declaration.transitionKind, "HUMAN_CANON_TRANSITION",
    "E6: as a human Canon transition, which is what a filmmaker deleting a state is");
  ok(transition.declaration.receiptIds.length >= 1,
    "E6: naming the receipt it withdrew, so the save can declare it");

  note("E deleting a Canon-holding state revokes through the canonical writer, removes the state, orphans no receipt, and keeps unrelated unsaved work");
}

/* A DELETE THAT MUST STILL BE REFUSED — and refused VISIBLY. Revoking authority
   for a removal that then does not happen would withdraw a filmmaker's approval
   and leave the state sitting there without it. */
async function e2_refusedDeletionKeepsAuthority() {
  const { project, entityId } = canonStateProject();
  const entity = project.characters.find((row) => row.id === entityId);
  /* A grandchild, so the planner refuses: a state with children cannot go. */
  entity.continuityStates.push({ id: "state-storm", name: "Storm", isDefault: false, parentStateId: "state-rain", approvedFile: "" });

  const page = await render(`#/character/${entityId}`, project);
  const seen = page.gesture.act(() => evaluate(page.context, `
    const entity = P.characters.find((row) => row.id === ${JSON.stringify(entityId)});
    const index = entity.continuityStates.findIndex((row) => row.id === "state-rain");
    /* The continuity states live in the reference's coverage workspace, which is
       where the × the filmmaker presses actually is. Open it, so this asserts the
       rendered page rather than a store the page might not read. */
    const context = "characters:" + entity.id;
    boundedWriteState("selected:entity-coverage-view", context, "states");
    boundedWriteState("selected:continuity-state", context, "state-rain");
    selectBoundedTask("entity-task", context, "coverage");
    removeContinuityState("characters", entity.id, index);
    const main = (document.getElementById("main") || { innerHTML: "" }).innerHTML;
    const receipt = (P.productionAuthority.receipts || []).find((row) => row.stateId === "state-rain");
    return {
      stateKept: entity.continuityStates.some((row) => row.id === "state-rain"),
      receiptStatus: receipt ? receipt.status : "",
      stillCanon: hasCurrentHumanAuthority(P, { kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain" }),
      refusalRendered: main.includes('data-action-refusal="continuity-state:characters:' + entity.id + ':state-rain"'),
      refusalText: (main.split("CineBraid did not make this change</b><span>")[1] || "").split("</span>")[0],
      offersDismiss: main.indexOf("dismissActionRefusal(") >= 0,
    };
  `));

  equal(seen.stateKept, true, "E7: a state with children is still refused");
  equal(seen.receiptStatus, "current", "E7: and its Canon was NOT withdrawn for a removal that did not happen");
  equal(seen.stillCanon, true, "E7: the state still holds its authority");
  equal(seen.refusalRendered, true, "E7: and the reason is rendered beside the state whose × was pressed, not only in a toast");
  ok(/derives from it/.test(seen.refusalText),
    "E7: saying what is required next, in the sentence the deletion planner produced: " + seen.refusalText);
  equal(seen.offersDismiss, true, "E7: and it is the filmmaker who clears it, not a 2.2-second timer");

  note("E7 a refused deletion withdraws no authority — the plan is asked before the receipt is touched — and says why, visibly");
}

/* ===========================================================================
   F — A CONTROL'S WORDS MATCH WHAT PRESSING IT DOES.
   =========================================================================== */

async function f_actionLabelsMatchBehaviour() {
  const page = await render("#/production", rawFixture());

  const seen = evaluate(page.context, `
    /* Every readiness action code the product can name, put through both
       renderings: the words for a control that PERFORMS the act, and the words
       for one that TRAVELS to it. */
    const codes = Object.keys(READINESS_ACTION_WORDS);
    const rows = codes.map((code) => ({
      code,
      performing: readinessActionWords({ code }),
      navigating: readinessNavigationWords({ code }),
    }));
    return { rows, unknown: readinessNavigationWords({ code: "a-code-that-does-not-exist" }) };
  `);

  ok(seen.rows.length >= 20, `F1: every readiness action is covered (${seen.rows.length})`);
  for (const row of seen.rows) {
    ok(row.navigating && row.navigating !== "Open the next action",
      `F1 ${row.code}: has navigation wording of its own`);
    ok(row.navigating !== row.performing,
      `F2 ${row.code}: the navigating control and the performing control do not share a label ("${row.performing}" / "${row.navigating}")`);
  }
  equal(seen.unknown, "Open the next action",
    "F3: an unmapped code still describes travel truthfully rather than guessing at an act");

  /* AND THE SHIPPED SURFACES USE THE RIGHT ONE. Production's NEXT ACTION card is
     an <a href>, so it must carry navigation words; Finish & Delivery's button
     performs the act, so it keeps the verb. */
  const app = readSource("public/app.js");
  ok(/href: `#\/shot\/\$\{ready\.shotId\}`[\s\S]{0,400}readinessNavigationWords/.test(app),
    "F4: the READY branch of the project's next action labels its link as travel");
  ok(/href: `#\/shot\/\$\{first\.shotId\}`[\s\S]{0,400}readinessNavigationWords/.test(app),
    "F4: and so does the outstanding-shot branch");
  const studio = readSource("public/creation-studio.js");
  ok(/markGuidedStillFinal[\s\S]{0,120}Mark shot final/.test(studio),
    "F5: the control that actually marks a shot final keeps the action verb");

  note(`F all ${seen.rows.length} readiness actions have distinct performing and navigating wording, and each shipped control uses the one that matches it`);
}

/* ===========================================================================
   G — A REFUSAL THE FILMMAKER PRESSED FOR STAYS ON THE SCREEN.
   =========================================================================== */

async function g_refusalsPersist() {
  const project = sample();
  /* A legitimately non-satisfiable confirmation: the declaration is removed, so
     the kernel refuses and the surface must say so where the press happened. */
  project.characters[0].candidateFiles = [];
  const page = await render("#/production", project);

  const seen = evaluate(page.context, `
    const feed = projectShotReadiness();
    const item = (feed.historic.items || []).find((row) => row.key.includes("CHAR-COURIER"));
    const queue = historicConfirmationMarkup(feed);
    return {
      found: !!item,
      offeredExecutable: queue.includes("confirmHistoricSelection('" + (item ? item.key : "") + "')"),
      rendersRequirement: /Cannot confirm yet/.test(queue),
      requirementText: (queue.split("Cannot confirm yet</b><span>")[1] || "").split("</span>")[0],
      refusalCode: (queue.match(/data-refusal-code="([^"]+)"/) || [])[1] || "",
    };
  `);

  equal(seen.found, true, "G1 precondition: the unconfirmable reference is still queued");
  equal(seen.offeredExecutable, false, "G1: no misleading executable Confirm is offered for an act that cannot succeed");
  equal(seen.rendersRequirement, true, "G1: the requirement is rendered in its place");
  equal(seen.refusalCode, "AUTHORITY_ARTIFACT_UNDECLARED", "G1: named by the kernel's own refusal code");
  ok(/no record of what kind of image/i.test(seen.requirementText),
    "G2: in the kernel's own words, saying what is required next: " + seen.requirementText);

  /* THE PERSISTENT STORE ITSELF: recorded, rendered, survives a re-render, and
     is cleared by the filmmaker rather than by a timer. */
  const persisted = evaluate(page.context, `
    recordActionRefusal("probe-key", "A refusal sentence the filmmaker must still be able to read.", "PROBE_CODE");
    const first = actionRefusalMarkup("probe-key");
    const second = actionRefusalMarkup("probe-key");
    const beforeDismiss = first;
    dismissActionRefusal("probe-key");
    return { first, survivesRerender: first === second && second !== "", afterDismiss: actionRefusalMarkup("probe-key"), beforeDismiss };
  `);
  ok(/A refusal sentence the filmmaker must still be able to read/.test(persisted.first),
    "G3: a recorded refusal renders its sentence in full");
  ok(/data-refusal-code="PROBE_CODE"/.test(persisted.first), "G3: and carries the refusal code with it");
  equal(persisted.survivesRerender, true, "G4: it does not clear itself on a timer");
  equal(persisted.afterDismiss, "", "G4: it is dismissed by the filmmaker, not by a timeout");

  note("G a refusal is rendered beside the control that offered the act, in the authority layer's own words, until the filmmaker dismisses it");
}


/* E8 — AND THE PROJECT CAN ACTUALLY BE SAVED AFTERWARDS.
 *
 * The stranding is what made this defect expensive, and the stranding happened at
 * the WRITE SEAM rather than in the browser. So the proof is the shipped seam
 * itself, driven with an in-memory boundary: the AT1-E successor must persist, and
 * the pre-AT1 successor must be refused with the exact code the audit reported.
 * Nothing here paraphrases the seam - persistProjectSuccessor is the real one. */
function e8_saveSucceedsThroughTheSeam() {
  const { WRITE_CLASSES, createAuthorityWriteSeam } = require(path.join(ROOT, "authority-write-seam"));
  const crypto = require("crypto");
  const Lineage = require(path.join(PUBLIC, "shared-state-lineage.js"));

  const boundary = (current) => {
    let stored = clone(current), writes = 0;
    const revision = () => JSON.stringify(crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex"));
    const seam = createAuthorityWriteSeam({
      resolveFile: () => "project.json",
      exists: () => true,
      readProject: () => clone(stored),
      revisionFor: () => revision(),
      validateProject: () => ({ ok: true, errors: [] }),
      writeProject: (_file, successor) => { stored = clone(successor); writes += 1; },
    });
    return { seam, revision, stored: () => clone(stored), writes: () => writes };
  };
  const UNRELATED = "an unrelated edit made in the same session";

  /* 1. THE AT1-E SEQUENCE PERSISTS. */
  {
    const { project: current, entityId } = canonStateProject();
    const successor = clone(current);
    const x = successor.characters.find((row) => row.id === entityId);
    const planned = Lineage.planStateDeletion(x.continuityStates, "state-rain", {});
    equal(planned.remove, true, "E8 precondition: the planner permits the removal");
    GESTURE.gesture(() => Private.revokeEntityStateCanon(successor, {
      list: "characters", entityId, stateId: "state-rain",
      at: AT, via: "confirmed-target-removal", reason: "target-removed", clearEdge: false,
    }));
    Lineage.applyStateDeletion(x.continuityStates, "state-rain", {});
    x.notes = UNRELATED;

    const mem = boundary(current);
    const outcome = mem.seam.persistProjectSuccessor({
      slug: "p", successor, writeClass: WRITE_CLASSES.CANON_TRANSITION,
      expectedRevision: mem.revision(),
      transitionMetadata: Kernel.authorityWriteTransition(current, successor).declaration,
    });
    equal(outcome.ok, true, "E8: the shipped write seam ACCEPTS the save (" + JSON.stringify(outcome.refusal || {}) + ")");
    equal(mem.writes(), 1, "E8: and the document was actually written once");
    const after = mem.stored();
    const saved = after.characters.find((row) => row.id === entityId);
    ok(!saved.continuityStates.some((row) => row.id === "state-rain"), "E8: the state is gone in the SAVED document");
    equal(saved.notes, UNRELATED, "E8: and the unrelated edit made in the same session was saved with it");
    const receipt = (after.productionAuthority.receipts || []).find((row) => row.stateId === "state-rain");
    equal(receipt.status, "revoked", "E8: the receipt is durably revoked");
    equal(receipt.revocationReason, "target-removed", "E8: for the reason that is true");
  }

  /* 2. THE PRE-AT1 SEQUENCE IS REFUSED - the stranding, reproduced exactly. */
  {
    const { project: current, entityId } = canonStateProject();
    const successor = clone(current);
    const x = successor.characters.find((row) => row.id === entityId);
    Lineage.applyStateDeletion(x.continuityStates, "state-rain", {});
    x.notes = UNRELATED;

    const mem = boundary(current);
    const outcome = mem.seam.persistProjectSuccessor({
      slug: "p", successor, writeClass: WRITE_CLASSES.CANON_TRANSITION,
      expectedRevision: mem.revision(),
      transitionMetadata: Kernel.authorityWriteTransition(current, successor).declaration,
    });
    equal(outcome.ok, false, "E8 control: removing the state WITHOUT revoking is refused by the seam");
    equal(outcome.refusal.code, "AUTHORITY_EDGE_RECEIPT_MISMATCH",
      "E8 control: with the exact code the audit reported");
    equal(mem.writes(), 0,
      "E8 control: nothing is written, which is how the unrelated edit became stranded");
  }

  note("E8 the shipped write seam accepts the AT1-E save with the unrelated edit intact, and refuses the pre-AT1 one with AUTHORITY_EDGE_RECEIPT_MISMATCH");
}

async function main() {
  a_shippedSampleFirstAction();
  b_preflightVetoParity();
  await c_emptyProjectFirstShot();
  await d_manualStartSeparation();
  await e_canonStateDeletion();
  await e2_refusedDeletionKeepsAuthority();
  e8_saveSucceedsThroughTheSeam();
  await f_actionLabelsMatchBehaviour();
  await g_refusalsPersist();
  for (const line of notes) console.log(line);
  console.log(`action-truth-first-press: ${checks} assertions passed`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
