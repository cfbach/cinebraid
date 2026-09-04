/* CineBraid — AT1 BOUNDARY CORRECTIONS (B1, B2, B3).
 *
 * Three blockers an independent boundary review reproduced against the AT1
 * candidate. Each one is a TRUST BOUNDARY rather than a bug in a field, and each
 * one is proved here through the shipped control and the shipped seam.
 *
 *   B1  startManualProjectCommit() treated `await flushPendingProjectSave()`
 *       RESOLVING as proof the open project was saved. It is not. The save loop
 *       reports 409, 422 and 428 by calling their refusal surface and RETURNING,
 *       and flushPendingProjectSave() returns early when a refusal is already
 *       latched. So a filmmaker whose save had just been refused pressed CREATE
 *       THIS PROJECT, CineBraid created and opened a different project, and the
 *       unsaved edit and the refusal they were being asked to act on both went.
 *
 *   B2  Start manually shipped writers into the OPEN project below its identity
 *       card: Project Look wrote P.meta through setGlobalCreationField() and
 *       called dirty(), and the same disclosure offered addEntity() and addShot().
 *       AT1-D fixed the identity card and R-AT1-1 pinned only that card, so the
 *       reachable writers one card lower survived the slice that existed to
 *       remove them.
 *
 *   B3  delEntity() spliced a whole reference out of the project while its
 *       states' authority receipts were still `current`, which is the AT1-E
 *       defect on the path that removes every state at once: the document then
 *       failed NORMAL_SAVE with CANON_TRANSITION_REQUIRED and the Canon
 *       transition with AUTHORITY_EDGE_RECEIPT_MISMATCH, and could not be saved
 *       at all.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT DO. It forms no opinion about what is
 * approvable or saveable. Every refusal it asserts is produced by the shipped
 * enforcement layer, every revocation is written by the shipped kernel command
 * inside a delivered trusted gesture, and B3's saveability is answered by the
 * real Authority Write Seam rather than by this file.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const { Kernel } = require("./authority-kernel-private");
const { render, rawFixture, withCanon } = require("./render-harness.js");
const seam = require(path.join(ROOT, "authority-write-seam"));

let checks = 0;
const notes = [];
const note = (line) => notes.push(line);
function ok(value, message) {
  checks += 1;
  assert.ok(value, message);
}
function equal(actual, expected, message) {
  checks += 1;
  assert.strictEqual(actual, expected, message);
}
const clone = (value) => JSON.parse(JSON.stringify(value));
function evaluate(context, body) {
  return vm.runInContext(`(() => { ${body} })()`, context);
}
function evaluateAsync(context, body) {
  return vm.runInContext(`(async () => { ${body} })()`, context);
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/* The real Authority Write Seam, asked whether a document can actually be
   stored. This is the question B3 is about, so it is answered by the shipped
   boundary rather than by an assertion in this file. */
function persist(project, successor, writeClass = seam.WRITE_CLASSES.NORMAL_SAVE, transition = {}) {
  let stored = clone(project);
  let writes = 0;
  const revision = () => JSON.stringify(crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex"));
  const boundary = seam.createAuthorityWriteSeam({
    resolveFile: () => "project.json",
    exists: () => true,
    readProject: () => clone(stored),
    revisionFor: revision,
    validateProject: () => ({ ok: true, errors: [] }),
    writeProject: (_file, next) => { stored = clone(next); writes += 1; },
  });
  const outcome = boundary.persistProjectSuccessor({
    slug: "p", successor, writeClass, expectedRevision: revision(), transitionMetadata: transition,
  });
  return { outcome, writes };
}

/* ===========================================================================
   B1 — CREATING A PROJECT REQUIRES A POSITIVELY CONFIRMED SAVE.
   =========================================================================== */

/* A save response that REFUSES without throwing — which is the whole premise of
   the defect. 409 and 422 both land here. */
function refusingFetch(status, body) {
  const calls = [];
  return {
    calls,
    hook: async (url, options, respond) => {
      calls.push({ url, method: (options && options.method) || "GET" });
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) return respond(body, status);
      if (url === "/api/projects/new") return respond({ slug: "new-project", title: "Created" }, 200);
      return null;
    },
  };
}

async function pressCreateAfter(status, body) {
  const project = rawFixture();
  const fetcher = refusingFetch(status, body);
  const page = await render("#/create", project, { fetch: fetcher.hook });

  const seen = await evaluateAsync(page.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "The New Film");
    setManualStartField("format", "Short film");
    setManualStartField("aspectRatio", "16:9");

    /* An unsaved edit in the OPEN project — the work the defect discarded. */
    P.meta.logline = "An unrelated logline typed before pressing create";
    dirty();

    const titleBefore = P.meta.title;
    /* The save that will be refused. It RESOLVES: that is the premise. */
    let flushThrew = false;
    try { await flushPendingProjectSave(); } catch { flushThrew = true; }

    const settled = projectSaveSettled();
    await startManualProject();

    const main = (document.getElementById("main") || { innerHTML: "" }).innerHTML;
    return {
      flushThrew,
      settled,
      titleBefore,
      titleAfter: P.meta.title,
      logline: P.meta.logline,
      draftTitle: manualStartDraft().title,
      hash: location.hash,
      refusalRendered: main.indexOf('data-action-refusal="manual-start"') >= 0,
      refusalText: (main.split("CineBraid did not make this change</b><span>")[1] || "").split("</span>")[0],
    };
  `);
  seen.createCalls = fetcher.calls.filter((row) => row.url === "/api/projects/new").length;
  return { seen, calls: fetcher.calls };
}

async function b1_createRequiresConfirmedSave() {
  /* B1.1 — the predicate answers each refusal truthfully, and asking is a read. */
  const page = await render("#/create", rawFixture());
  const states = evaluate(page.context, `
    const out = {};
    const snapshot = () => JSON.stringify(P);
    const before = snapshot();
    out.cleanIsSettled = projectSaveSettled().settled;

    SAVE_REVISION = SAVED_REVISION + 1;
    out.unsaved = projectSaveSettled();
    SAVE_REVISION = SAVED_REVISION;

    PROJECT_CONFLICT = true;  out.conflict = projectSaveSettled();  PROJECT_CONFLICT = false;
    AUTHORITY_SAVE_REFUSED = true; out.authority = projectSaveSettled(); AUTHORITY_SAVE_REFUSED = false;
    SAVE_BLOCKED = true; out.blocked = projectSaveSettled(); SAVE_BLOCKED = false;

    out.unchanged = snapshot() === before;
    out.settledAgain = projectSaveSettled().settled;
    return out;
  `);
  equal(states.cleanIsSettled, true, "B1.1: a clean, saved project is settled");
  equal(states.unsaved.settled, false, "B1.1: pending edits are not settled");
  equal(states.unsaved.code, "UNSAVED_EDITS", "B1.1: and it says which");
  equal(states.conflict.code, "PROJECT_REVISION_CONFLICT", "B1.1: a 409-conflicted view is not settled");
  equal(states.authority.code, "AUTHORITY_SAVE_REFUSED", "B1.1: an authority-refused save is not settled");
  equal(states.blocked.code, "SAVE_BLOCKED", "B1.1: a paused save loop is not settled");
  equal(states.unchanged, true, "B1.1: asking the predicate mutates nothing");
  equal(states.settledAgain, true, "B1.1: and it is a read, so the answer comes back");

  /* B1.2 — 409. The save resolves, and creation must still not happen. */
  const conflict = await pressCreateAfter(409, { error: "This project changed in storage.", code: "PROJECT_REVISION_CONFLICT" });
  equal(conflict.seen.flushThrew, false,
    "B1.2 premise: a 409 save RESOLVES — there is no exception for a caller to catch");
  equal(conflict.seen.settled.settled, false, "B1.2: and the project is not settled afterwards");
  equal(conflict.seen.settled.code, "PROJECT_REVISION_CONFLICT", "B1.2: named as the conflict it is");
  equal(conflict.seen.createCalls, 0, "B1.2: no POST to /api/projects/new occurred");
  equal(conflict.seen.titleAfter, conflict.seen.titleBefore, "B1.2: the open project was not switched or renamed");
  equal(conflict.seen.logline, "An unrelated logline typed before pressing create",
    "B1.2: the unsaved edit survived");
  equal(conflict.seen.draftTitle, "The New Film", "B1.2: and the draft survived, so the press can be repeated");
  equal(conflict.seen.refusalRendered, true, "B1.2: the refusal is on screen where the button was pressed");
  ok(/not saved|refused|changed in storage/i.test(conflict.seen.refusalText),
    "B1.2: saying which project is blocking and why: " + conflict.seen.refusalText);

  /* B1.3 — 422, both flavours the save loop distinguishes. */
  const validation = await pressCreateAfter(422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" });
  equal(validation.seen.flushThrew, false, "B1.3 premise: a 422 save resolves too");
  equal(validation.seen.settled.settled, false, "B1.3: and leaves the project unsettled");
  equal(validation.seen.createCalls, 0, "B1.3: no POST to /api/projects/new occurred");
  equal(validation.seen.logline, "An unrelated logline typed before pressing create", "B1.3: the unsaved edit survived");
  equal(validation.seen.refusalRendered, true, "B1.3: with the reason kept on screen");

  const authority = await pressCreateAfter(422, {
    error: "This edit would change production authority outside its explicit protocol.",
    code: "AUTHORITY_EDGE_RECEIPT_MISMATCH",
  });
  equal(authority.seen.settled.code, "AUTHORITY_SAVE_REFUSED",
    "B1.3: an authority 422 is recognised as an authority refusal");
  equal(authority.seen.createCalls, 0, "B1.3: and it too creates nothing");

  /* B1.4 — THE REFUSAL DOES NOT CLEAR THE PROJECT'S OWN REFUSAL STATE. */
  const preserved = await evaluateAsync((await render("#/create", rawFixture(), {
    fetch: refusingFetch(422, { error: "refused", code: "PROJECT_VALIDATION_FAILED" }).hook,
  })).context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Another Film");
    P.meta.logline = "still here";
    dirty();
    await flushPendingProjectSave();
    const blockedBefore = SAVE_BLOCKED;
    await startManualProject();
    return { blockedBefore, blockedAfter: SAVE_BLOCKED, logline: P.meta.logline };
  `);
  equal(preserved.blockedBefore, true, "B1.4 premise: the refused save paused the save loop");
  equal(preserved.blockedAfter, true, "B1.4: and the attempted creation did not clear that refusal state");
  equal(preserved.logline, "still here", "B1.4: nor the unsaved edit behind it");

  /* B1.5 — AND A LEGITIMATE SUCCESSFUL SAVE ALLOWS CREATION NORMALLY. */
  const okCalls = [];
  const good = await render("#/create", rawFixture(), {
    fetch: async (url, options, respond) => {
      okCalls.push({ url, method: (options && options.method) || "GET" });
      if (/\/api\/projects\/[^/]+\/project$/.test(url)) {
        return respond({ project: null, revision: "rev-2" }, 200, { "x-cinebraid-project-revision": "rev-2" });
      }
      if (url === "/api/projects/new") return respond({ slug: "the-new-film", title: "The New Film" }, 200);
      return null;
    },
  });
  const created = await evaluateAsync(good.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "The New Film");
    P.meta.logline = "an edit that will be saved";
    dirty();
    await flushPendingProjectSave();
    const settled = projectSaveSettled();
    await startManualProject();
    return { settled, draftTitle: manualStartDraft().title };
  `);
  equal(created.settled.settled, true, "B1.5: a save the server accepted leaves the project settled");
  equal(okCalls.filter((row) => row.url === "/api/projects/new").length, 1,
    "B1.5: so the create request is sent exactly once");
  equal(created.draftTitle, "", "B1.5: and the draft is consumed, because the project it described now exists");

  note("B1 creation is gated on projectSaveSettled(), not on a resolved flush: 409, both 422 flavours and a latched refusal each create nothing and preserve the open project's unsaved work; an accepted save still creates normally");
}

/* ===========================================================================
   B2 — START MANUALLY CONTAINS NO WRITER INTO THE OPEN PROJECT.
   =========================================================================== */

async function b2_manualStartIsolation() {
  const project = rawFixture();
  project.meta.title = "Film A";
  const page = await render("#/create", project);

  const seen = evaluate(page.context, `
    setCreationStartPath("scratch");
    route();
    const main = (document.getElementById("main") || { innerHTML: "" }).innerHTML;

    /* FILM A EXACTLY AS IT STANDS, before anything on this screen is touched. */
    const before = JSON.stringify(P);
    const revisionBefore = SAVE_REVISION;

    /* EVERY REACHABLE FIELD ON THE MANUAL CREATION SURFACE. The identity fields
       are the draft's; if any other editable control still reaches the open
       project, one of these snapshots moves. */
    setManualStartField("title", "Film B");
    setManualStartField("format", "Feature film");
    setManualStartField("aspectRatio", "2.39:1");

    return {
      main,
      before,
      after: JSON.stringify(P),
      revisionBefore,
      revisionAfter: SAVE_REVISION,
      draft: JSON.parse(JSON.stringify(manualStartDraft())),
      /* What the surface actually offers a filmmaker to press or type into. */
      handlers: (main.match(/on(?:change|click)="([^"]+)"/g) || []).map((row) => row.slice(row.indexOf('"') + 1, -1)),
      hasStyleCard: main.indexOf('id="creation-global-style"') >= 0,
      hasNextDisclosure: main.indexOf("data-manual-next") >= 0,
      hasIdentityCard: main.indexOf("data-manual-identity") >= 0,
      hasCommit: main.indexOf("data-manual-start-commit") >= 0,
    };
  `);

  equal(seen.hasIdentityCard, true, "B2.1: Start manually still renders the project's own identity card");
  equal(seen.hasCommit, true, "B2.1: with the one explicit act that creates the separate project");

  /* THE ISOLATION ITSELF. */
  equal(seen.after, seen.before, "B2.2: Film A is byte-identical after every reachable field was edited");
  equal(seen.revisionAfter, seen.revisionBefore, "B2.2: and its dirty revision did not move");
  equal(seen.draft.title, "Film B", "B2.2: while the draft took the values");
  equal(seen.draft.format, "Feature film", "B2.2: format too");
  equal(seen.draft.aspectRatio, "2.39:1", "B2.2: and aspect");

  /* AND THE WRITERS ARE NOT REACHABLE AT ALL — the retirement, at the surface. */
  equal(seen.hasStyleCard, false,
    "B2.3 RETIRED: Project Look is not on the create screen — it wrote P.meta and called dirty()");
  equal(seen.hasNextDisclosure, false,
    "B2.3 RETIRED: nor the disclosure that carried it, addEntity() and addShot()");
  const forbidden = seen.handlers.filter((handler) =>
    /setGlobalCreationField\s*\(|setProjectTitle\s*\(|\baddEntity\s*\(|\baddShot\s*\(|\bdirty\s*\(/.test(handler));
  equal(forbidden.length, 0,
    "B2.3 RETIRED: no rendered handler on the manual creation surface reaches an open-project writer: " + JSON.stringify(forbidden));

  /* B2.4 — CREATE PRODUCES FILM B WITH THE DRAFT VALUES, AND FILM A IS UNCHANGED. */
  const posts = [];
  const commitPage = await render("#/create", (() => { const p = rawFixture(); p.meta.title = "Film A"; return p; })(), {
    fetch: async (url, options, respond) => {
      if (/\/api\/projects\/[^/]+\/project$/.test(url)) return respond({ revision: "rev-2" }, 200, { "x-cinebraid-project-revision": "rev-2" });
      if (url === "/api/projects/new") {
        posts.push(JSON.parse(String((options && options.body) || "{}")));
        return respond({ slug: "film-b", title: "Film B" }, 200);
      }
      return null;
    },
  });
  const committed = await evaluateAsync(commitPage.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    setManualStartField("format", "Feature film");
    setManualStartField("aspectRatio", "2.39:1");
    const before = { title: P.meta.title, style: P.meta.globalStylePrompt || "", aspect: P.meta.aspectRatio || "" };
    await startManualProject();
    return { before, after: { title: P.meta.title, style: P.meta.globalStylePrompt || "", aspect: P.meta.aspectRatio || "" } };
  `);
  equal(posts.length, 1, "B2.4: creating posts once to the shipped creation route");
  equal(posts[0].title, "Film B", "B2.4: with the draft's title");
  equal(posts[0].format, "Feature film", "B2.4: its format");
  equal(posts[0].aspectRatio, "2.39:1", "B2.4: and its aspect ratio");
  /* Film A's identity is untouched by creating Film B. A successful create
     reloads, and the harness serves Film A back, so this is read after the
     reload: the draft's title, format and aspect went to the NEW project and
     none of them landed on the one that was open. */
  equal(committed.after.title, "Film A", "B2.4: Film A was not renamed by creating Film B");
  equal(committed.after.title, committed.before.title, "B2.4: its title is what it was");
  equal(committed.after.style, committed.before.style, "B2.4: its global style is what it was");
  equal(committed.after.aspect, committed.before.aspect, "B2.4: and its aspect ratio is what it was");

  note("B2 the manual creation surface's only editable controls are the draft's: every reachable field leaves the open project byte-identical with an unmoved dirty revision, Project Look and the addEntity/addShot disclosure are gone, the read-only glance stays, and create posts the draft's values");
}

/* ===========================================================================
   B3 — WHOLE-REFERENCE DELETION REVOKES CANON BEFORE IT REMOVES.
   =========================================================================== */

function entityCanonProject({ states = 1, drift = false } = {}) {
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
  const rows = [{ kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain", value: "KAI-RAIN.png" }];
  if (states > 1) rows.push({ kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-default", value: anchor });
  withCanon(project, rows);
  if (drift) {
    /* The approved image was renamed after approval. The receipt still names the
       old file and carries no asset identity, so no kernel command can withdraw
       it — the shipped, documented drift outcome. */
    entity.continuityStates[1].approvedFile = "KAI-RAIN-RENAMED.png";
  }
  return { project, entityId: entity.id };
}

async function deleteEntityThrough(page, entityId) {
  evaluate(page.context, `delEntity("characters", ${JSON.stringify(entityId)}); return 1;`);
  await tick(); // delEntity wires its confirm handler on a macrotask
  return page.gesture.act(() => evaluate(page.context, `
    document.getElementById("delete-entity-confirm").onclick();
    const main = (document.getElementById("main") || { innerHTML: "" }).innerHTML;
    return {
      entityGone: !P.characters.some((row) => row.id === ${JSON.stringify(entityId)}),
      receipts: (P.productionAuthority && P.productionAuthority.receipts || []).map((row) => ({
        stateId: row.stateId, status: row.status, reason: row.revocationReason,
      })),
      ledgerTrusted: validateAuthorityLedger(P).trusted,
      refusalRendered: main.indexOf('data-action-refusal="entity-delete:characters:' + ${JSON.stringify(entityId)} + '"') >= 0,
      refusalText: (main.split("CineBraid did not make this change</b><span>")[1] || "").split("</span>")[0],
      unrelated: P.meta.logline || "",
      after: JSON.parse(JSON.stringify(P)),
    };
  `));
}

async function b3_wholeReferenceDeletion() {
  /* B3.1 — NO CURRENT AUTHORITY: deletion is ordinary and still works. */
  const plain = rawFixture();
  const plainId = plain.characters[0].id;
  delete plain.productionAuthority;
  const plainPage = await render(`#/character/${plainId}`, plain);
  const plainSeen = await deleteEntityThrough(plainPage, plainId);
  equal(plainSeen.entityGone, true, "B3.1: a reference holding no current authority still deletes");
  equal(plainSeen.refusalRendered, false, "B3.1: with no refusal");
  equal(persist(plain, plainSeen.after).outcome.ok, true, "B3.1: and the result saves through the real seam");

  /* B3.2 — ONE CURRENT CANON STATE: revoked, then removed, then saveable. */
  const one = entityCanonProject();
  equal(Kernel.hasCurrentHumanAuthority(one.project, {
    kind: "entity-state", list: "characters", entityId: one.entityId, stateId: "state-rain",
  }), true, "B3.2 precondition: the state genuinely holds current Canon");

  const onePage = await render(`#/character/${one.entityId}`, one.project);
  evaluate(onePage.context, `P.meta.logline = "an unrelated edit made in the same session"; return 1;`);
  const oneSeen = await deleteEntityThrough(onePage, one.entityId);

  equal(oneSeen.entityGone, true, "B3.2: the reference is removed");
  const rainReceipt = oneSeen.receipts.find((row) => row.stateId === "state-rain");
  ok(rainReceipt, "B3.2: its receipt still exists — revocation is a status, not a deletion");
  equal(rainReceipt.status, "revoked", "B3.2: and it was WITHDRAWN rather than left current");
  equal(rainReceipt.reason, "target-removed", "B3.2: through the kernel's own removal vocabulary");
  equal(oneSeen.ledgerTrusted, true, "B3.2: the ledger is still trusted afterwards");
  equal(oneSeen.unrelated, "an unrelated edit made in the same session", "B3.2: the unrelated pending edit survived");

  const normal = persist(one.project, oneSeen.after);
  equal(normal.outcome.ok, true,
    "B3.2: and the document saves through the real seam — the defect made this CANON_TRANSITION_REQUIRED: "
    + JSON.stringify(normal.outcome.error || normal.outcome.code || ""));
  equal(normal.writes, 1, "B3.2: with a real write, not a refused one");

  /* B3.3 — TWO CURRENT RECEIPTS: every one planned and withdrawn before removal. */
  const many = entityCanonProject({ states: 2 });
  const manyPage = await render(`#/character/${many.entityId}`, many.project);
  const manySeen = await deleteEntityThrough(manyPage, many.entityId);
  equal(manySeen.entityGone, true, "B3.3: the reference is removed");
  equal(manySeen.receipts.filter((row) => row.status === "current").length, 0,
    "B3.3: and NO receipt for it is left current: " + JSON.stringify(manySeen.receipts));
  equal(manySeen.receipts.filter((row) => row.status === "revoked").length, 2,
    "B3.3: both were withdrawn");
  equal(persist(many.project, manySeen.after).outcome.ok, true, "B3.3: and the result saves");

  /* B3.4 — A DRIFTED RECEIPT: refused, with zero partial mutation. */
  const drifted = entityCanonProject({ drift: true });
  const driftTarget = { kind: "entity-state", list: "characters", entityId: drifted.entityId, stateId: "state-rain" };
  equal(Kernel.hasCurrentHumanAuthority(drifted.project, driftTarget), false,
    "B3.4 precondition: the drifted receipt no longer matches the live edge");
  ok((drifted.project.productionAuthority.receipts || []).some((row) => row.stateId === "state-rain" && row.status === "current"),
    "B3.4 precondition: yet the receipt ROW is still current, which is what strands a save");

  const driftPage = await render(`#/character/${drifted.entityId}`, drifted.project);
  const beforeDrift = evaluate(driftPage.context, `P.meta.logline = "an unrelated edit"; return JSON.stringify(P);`);
  const driftSeen = await deleteEntityThrough(driftPage, drifted.entityId);

  equal(driftSeen.entityGone, false, "B3.4: the reference is NOT removed");
  equal(JSON.stringify(driftSeen.after), beforeDrift,
    "B3.4: and NOTHING was mutated — no partial withdrawal, no replaced reference, no deletion record");
  const driftReceipt = driftSeen.receipts.find((row) => row.stateId === "state-rain");
  equal(driftReceipt.status, "current", "B3.4: the receipt is left exactly as it was");
  equal(driftSeen.refusalRendered, true, "B3.4: the reason is on the reference whose deletion was refused");
  ok(/renamed or replaced/i.test(driftSeen.refusalText),
    "B3.4: naming the cause: " + driftSeen.refusalText);
  ok(/Re-approve/i.test(driftSeen.refusalText),
    "B3.4: and what would make the reference removable: " + driftSeen.refusalText);
  equal(persist(drifted.project, driftSeen.after).outcome.ok, true,
    "B3.4: and the project is still saveable, which is the whole point of refusing");

  note("B3 whole-reference deletion plans every withdrawal first: one and two current receipts are revoked through the kernel then removed and the result saves, a drifted receipt refuses with zero mutation and a saveable project, and an unrelated pending edit survives");
}

async function main() {
  await b1_createRequiresConfirmedSave();
  await b2_manualStartIsolation();
  await b3_wholeReferenceDeletion();
  console.log(`AT1 boundary corrections: ${checks} checks passed`);
  for (const line of notes) console.log("  - " + line);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
