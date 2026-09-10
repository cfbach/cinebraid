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
 * A REAL SERVER IS STARTED, on a throwaway root and config, by the ACTIVE
 * checks only: "what does a reload open" is a question about stored state, and
 * nothing in a browser harness can answer it. NO PROJECT DATA IS TOUCHED. NO
 * PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const { Kernel } = require("./authority-kernel-private");
const { render, rawFixture, withCanon } = require("./render-harness.js");
const seam = require(path.join(ROOT, "src/authority/authority-write-seam"));

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

/* The manual create path now PREPARES the new project before it activates it, so
   every stub that drives a creation must be able to serve that project's own
   document and its scoped scan. Answering them here keeps each stub's own
   scenario about the thing it is testing. */
function preparedProjectRoutes(createSlug, project) {
  return (url, options, respond) => {
    if (url === `/api/projects/${createSlug}/project`) {
      return respond(project, 200, { "x-cinebraid-project-slug": createSlug, "x-cinebraid-project-revision": `rev-${createSlug}`, etag: `rev-${createSlug}` });
    }
    if (url.startsWith("/api/scan?project=")) return respond({ anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} }, 200);
    return null;
  };
}
/* A save response that REFUSES without throwing — which is the whole premise of
   the defect. 409 and 422 both land here. */
function refusingFetch(status, body) {
  const calls = [];
  return {
    calls,
    hook: async (url, options, respond) => {
      calls.push({ url, method: (options && options.method) || "GET" });
      const preparedRoute = preparedProjectRoutes("new-project", rawFixture())(url, options, respond);
      if (preparedRoute) return preparedRoute;
      if (url === "/api/projects/switch") return respond({ ok: true, slug: "new-project" }, 200);
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
      const method = (options && options.method) || "GET";
      okCalls.push({ url, method });
      /* The same path serves a SAVE (PUT) and the prepare READ (GET), and they
         are different answers — a save receipt is not a project document. */
      const preparedRoute = preparedProjectRoutes("the-new-film", rawFixture())(url, options, respond);
      if (method === "GET" && preparedRoute) return preparedRoute;
      if (url === "/api/projects/switch") return respond({ ok: true, slug: "the-new-film" }, 200);
      if (method !== "GET" && /\/api\/projects\/[^/]+\/project$/.test(url)) {
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
  const okBodies = [];
  const commitPage = await render("#/create", (() => { const p = rawFixture(); p.meta.title = "Film A"; return p; })(), {
    fetch: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      okBodies.push({ url, method, body: String((options && options.body) || "") });
      const filmB = rawFixture(); filmB.meta.title = "Film B";
      const preparedRoute = preparedProjectRoutes("film-b", filmB)(url, options, respond);
      if (method === "GET" && preparedRoute) return preparedRoute;
      if (url === "/api/projects/switch") return respond({ ok: true, slug: "film-b" }, 200);
      if (method !== "GET" && /\/api\/projects\/[^/]+\/project$/.test(url)) return respond({ revision: "rev-2" }, 200, { "x-cinebraid-project-revision": "rev-2" });
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
  /* The draft's title, format and aspect went to the NEW project and none of
     them landed on the one that was open. Film A was named "Film A" while the
     press was made — asserted before the commit — and the window is in Film B
     afterwards because a successful create now installs the prepared project
     rather than re-reading whatever the server had active. */
  equal(committed.before.title, "Film A", "B2.4: Film A was still itself when the press was made");
  equal(committed.after.title, "Film B", "B2.4: and the window opens the created project");
  const savesToFilmA = okBodies.filter((row) => row.method !== "GET"
    && /\/api\/projects\/[^/]+\/project$/.test(row.url));
  ok(!savesToFilmA.some((row) => /"title":"Film B"/.test(row.body)),
    "B2.4: no SAVE carrying the draft's title was written to Film A — it was not renamed: "
    + JSON.stringify(savesToFilmA.map((row) => row.url)));

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

/* ===========================================================================
   B1-RACE — THE SAVE PROOF MUST STILL BE TRUE AT THE MOMENT OF REPLACEMENT.

   The first B1 fix asked projectSaveSettled() before POSTing /api/projects/new.
   The POST is an await, so a filmmaker can edit Film A inside it, and the
   verdict was then used — several awaits later — to justify replacing the very
   project that edit was made to. Loading Film B cancels Film A's pending save
   and resets its counters, so the edit went. These hold the fence that closes
   that window, and every one of them drives the SHIPPED control.
   =========================================================================== */

/* A create response held open until the test releases it. Everything about the
   race happens inside this gate. */
function delayedCreation({ createSlug = "film-b" } = {}) {
  const calls = [];
  let release = null;
  /* Saves succeed until the test says otherwise. Film A must reach a genuinely
     saved state BEFORE the press, or the pre-POST guard refuses and the race
     under test never happens. */
  let saveStatus = 200;
  let saveBody = null;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    calls,
    release: () => release(),
    setSaveStatus(status, body) { saveStatus = status; saveBody = body || null; },
    createCount: () => calls.filter((row) => row.url === "/api/projects/new").length,
    since(marker) { return calls.slice(marker); },
    marker() { return calls.length; },
    hook: async (url, options, respond) => {
      calls.push({ url, method: (options && options.method) || "GET", body: (options && options.body) || "" });
      if (url === "/api/projects/new") {
        await gate;
        return respond({ ok: true, slug: createSlug }, 200);
      }
      /* THE PREPARE READ COMES FIRST, AND IT IS A GET. The same path serves the
         save (PUT/POST) and the new project's document (GET), and answering a
         read with a save receipt would hand the commit a document with no meta. */
      if (((options && options.method) || "GET") === "GET") {
        const preparedRoute = preparedProjectRoutes(createSlug, rawFixture())(url, options, respond);
        if (preparedRoute) return preparedRoute;
      }
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
        if (saveStatus === 200) {
          return respond({ ok: true, revision: `rev-${calls.length}` }, 200,
            { "x-cinebraid-project-revision": `rev-${calls.length}` });
        }
        return respond(saveBody || { error: "refused", code: "PROJECT_VALIDATION_FAILED" }, saveStatus);
      }
      if (url === "/api/projects/switch") return respond({ ok: true, slug: createSlug }, 200);
      return null;
    },
  };
}

/* Start the press without awaiting it, so the test can act inside the flight. */
function startPressInFlight(context) {
  return evaluate(context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    globalThis.__press = startManualProject();
    return 1;`);
}
const settlePress = (context) => evaluateAsync(context, `return await globalThis.__press;`);

/* The press must have got PAST its pre-POST guard and be waiting on the create
   response before the test edits Film A. Editing earlier lands inside the
   pre-POST flush instead, which is a different (already-covered) case and not
   the race under test. */
async function untilCreateInFlight(gate) {
  for (let i = 0; i < 200 && gate.createCount() === 0; i++) await tick();
  if (gate.createCount() === 0) throw new Error("the create request never reached the wire");
}

async function b1race_replacementFence() {
  /* ---- B1-RACE-6 first: the ordinary fast path is unchanged. ------------- */
  const fast = delayedCreation();
  const fastPage = await render("#/create", rawFixture(), { fetch: fast.hook });
  await evaluateAsync(fastPage.context, `await flushPendingProjectSave(); return 1;`);
  startPressInFlight(fastPage.context);
  await untilCreateInFlight(fast);
  fast.release();
  await settlePress(fastPage.context);
  const fastSeen = evaluate(fastPage.context, `
    return { hash: location.hash, draft: manualStartDraft().title,
             pending: (window.__cinebraidManualStartPending||{}).slug || "" };`);
  equal(fast.createCount(), 1, "B1-RACE-6: with no intervening edit the project is created once");
  equal(fastSeen.hash, "#/production", "B1-RACE-6: and the window moves into production as before");
  equal(fastSeen.draft, "", "B1-RACE-6: the draft is consumed");
  equal(fastSeen.pending, "", "B1-RACE-6: and nothing is left pending");

  /* ---- B1-RACE-1: edit during the flight, whose save then SUCCEEDS. ------ */
  const ok1 = delayedCreation();
  const page1 = await render("#/create", rawFixture(), { fetch: ok1.hook });
  await evaluateAsync(page1.context, `await flushPendingProjectSave(); return 1;`);
  const before1 = evaluate(page1.context, `return { settled: projectSaveSettled().settled, gen: PROJECT_SAVE_GENERATION };`);
  equal(before1.settled, true, "B1-RACE-1 precondition: Film A is saved before the press");

  startPressInFlight(page1.context);
  await untilCreateInFlight(ok1);
  /* THE RACE. An ordinary edit is now REFUSED at the seam while the transaction
     owns this project — that is CENTRAL-1, and dirty() declines it. What the
     CERTIFICATE exists for is the state that can still move without dirty(): a
     save queued before the press landing or being refused mid-flight, and a
     durable advance this window did not author. So the unsaved work is expressed
     directly here, which is exactly the condition the certificate compares. */
  const editedInFlight = evaluate(page1.context, `
    P.meta.logline = "EDIT-DURING-CREATE";
    SAVE_REVISION += 1; setSaveState("dirty", "Unsaved changes");
    return { unsaved: projectSaveSettled().settled === false, saveRevision: SAVE_REVISION };`);
  equal(editedInFlight.unsaved, true, "B1-RACE-1: the intervening edit leaves Film A unsaved mid-flight");

  const marker1 = ok1.marker();
  ok1.release();
  await settlePress(page1.context);

  /* The edit must have been carried through the ordinary save loop BEFORE the
     replacement, and the body that went out must contain it. */
  const savesAfter = ok1.since(marker1).filter((row) => /\/api\/projects\/[^/]+\/project$/.test(row.url));
  ok(savesAfter.length >= 1, "B1-RACE-1: the intervening edit was saved before the replacement");
  ok(savesAfter.some((row) => String(row.body).includes("EDIT-DURING-CREATE")),
    "B1-RACE-1: and the saved body carries it, so the edit reached storage");
  const after1 = evaluate(page1.context, `return { hash: location.hash, pending: (window.__cinebraidManualStartPending||{}).slug || "" };`);
  equal(after1.hash, "#/production", "B1-RACE-1: only then does Film B open");
  equal(after1.pending, "", "B1-RACE-1: and the creation is complete, with nothing left pending");
  equal(ok1.createCount(), 1, "B1-RACE-1: the project was created exactly once");

  /* ---- B1-RACE-2: the intervening edit's save is REFUSED 422. ------------ */
  const refused = delayedCreation();
  const page2 = await render("#/create", rawFixture(), { fetch: refused.hook });
  await evaluateAsync(page2.context, `await flushPendingProjectSave(); return 1;`);
  equal(evaluate(page2.context, `return projectSaveSettled().settled;`), true,
    "B1-RACE-2 precondition: Film A is saved before the press");
  const titleBefore2 = evaluate(page2.context, `return P.meta.title;`);
  /* From here the intervening save will be genuinely refused. */
  refused.setSaveStatus(422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" });
  startPressInFlight(page2.context);
  await untilCreateInFlight(refused);
  /* ORDINARY EDITS ARE NOW REFUSED AT THE SEAM while a replacement
     transaction owns this project — that is CENTRAL-1, and dirty() would
     decline this. What the CERTIFICATE exists for is the state that can
     still move without dirty(): a save queued before the press landing or
     being refused mid-flight, and a durable advance this window did not
     author. So the unsaved work is expressed directly here, which is
     exactly the condition the certificate compares. */
  evaluate(page2.context, `P.meta.logline = "EDIT-THEN-REFUSED";
    SAVE_REVISION += 1; setSaveState("dirty", "Unsaved changes");
    return 1;`);
  const marker2 = refused.marker();
  refused.release();
  await settlePress(page2.context);

  const after2 = evaluate(page2.context, `
    const main = (document.getElementById("main")||{innerHTML:""}).innerHTML;
    return {
      title: P.meta.title, logline: P.meta.logline, hash: location.hash,
      blocked: SAVE_BLOCKED, settled: projectSaveSettled().settled,
      saveRevision: SAVE_REVISION, savedRevision: SAVED_REVISION,
      pending: (window.__cinebraidManualStartPending||{}).slug || "",
      refusal: main.indexOf('data-action-refusal="manual-start"') >= 0,
      refusalText: (main.split("CineBraid did not make this change</b><span>")[1]||"").split("</span>")[0],
    };`);
  const reloadsAfter2 = refused.since(marker2).filter((row) => row.url === "/api/projects/switch").length;

  equal(reloadsAfter2, 0, "B1-RACE-2: Film B is not loaded — no project read followed the refused save");
  equal(after2.hash, "#/create", "B1-RACE-2: the hash is untouched, so the window did not move");
  equal(after2.title, titleBefore2, "B1-RACE-2: Film A is still the current project");
  equal(after2.logline, "EDIT-THEN-REFUSED", "B1-RACE-2: its edit remains");
  equal(after2.blocked, true, "B1-RACE-2: the save-blocked state remains truthful");
  equal(after2.settled, false, "B1-RACE-2: and the window still reports itself unsaved");
  ok(after2.saveRevision > after2.savedRevision,
    "B1-RACE-2: the save counters were NOT reset by a replacement that did not happen");
  equal(after2.refusal, true, "B1-RACE-2: the refusal is on screen where the button was pressed");
  ok(/did not switch to it/i.test(after2.refusalText),
    "B1-RACE-2: saying the project was created but not opened: " + after2.refusalText);
  equal(after2.pending, "film-b", "B1-RACE-2: and the created project is remembered rather than lost");
  equal(refused.createCount(), 1, "B1-RACE-2: it was created exactly once");

  /* ---- B1-RACE-5: pressing again finishes THAT project, and only it. ----- */
  refused.calls.length = 0;
  refused.setSaveStatus(200, null);
  const recovered = await evaluateAsync(page2.context, `
    /* The filmmaker resolves the refusal: saving resumes and the edit lands
       through the ordinary loop, not by moving a counter. */
    resumeProjectSaving();
    await flushPendingProjectSave();
    return { settled: projectSaveSettled().settled, logline: P.meta.logline };`);
  equal(recovered.logline, "EDIT-THEN-REFUSED", "B1-RACE-5: the edit that was refused is still the one being saved");
  equal(recovered.settled, true, "B1-RACE-5 precondition: Film A reaches a positively saved state");
  startPressInFlight(page2.context);
  await settlePress(page2.context);
  const after5 = evaluate(page2.context, `
    return { hash: location.hash, pending: (window.__cinebraidManualStartPending||{}).slug || "" };`);
  equal(refused.createCount(), 0,
    "B1-RACE-5: NO second POST to /api/projects/new — the pending creation is finished, not repeated");
  ok(refused.calls.some((row) => row.url === "/api/projects/switch" && String(row.body).includes("film-b")),
    "B1-RACE-5: the already-created project is opened by name");
  equal(after5.hash, "#/production", "B1-RACE-5: and it opens");
  equal(after5.pending, "", "B1-RACE-5: the pending creation is cleared once it is open");

  /* ---- B1-RACE-3: the intervening save is refused 409. ------------------- */
  const conflicted = delayedCreation();
  const page3 = await render("#/create", rawFixture(), { fetch: conflicted.hook });
  await evaluateAsync(page3.context, `await flushPendingProjectSave(); return 1;`);
  conflicted.setSaveStatus(409, { error: "This project changed in storage.", code: "PROJECT_REVISION_CONFLICT" });
  startPressInFlight(page3.context);
  await untilCreateInFlight(conflicted);
  evaluate(page3.context, `P.meta.logline = "EDIT-THEN-CONFLICT";
    SAVE_REVISION += 1; setSaveState("dirty", "Unsaved changes");
    return 1;`);
  const marker3 = conflicted.marker();
  conflicted.release();
  await settlePress(page3.context);
  const after3 = evaluate(page3.context, `
    return { logline: P.meta.logline, hash: location.hash, conflict: PROJECT_CONFLICT,
             settled: projectSaveSettled().settled,
             pending: (window.__cinebraidManualStartPending||{}).slug || "" };`);
  equal(conflicted.since(marker3).filter((row) => row.url === "/api/projects/switch").length, 0,
    "B1-RACE-3: a conflicted save also prevents the replacement");
  equal(after3.hash, "#/create", "B1-RACE-3: the window did not move");
  equal(after3.logline, "EDIT-THEN-CONFLICT", "B1-RACE-3: and the edit is still in the tab");
  equal(after3.conflict, true, "B1-RACE-3: the conflict is still declared");
  equal(after3.settled, false, "B1-RACE-3: and the window is truthfully unsaved");
  equal(after3.pending, "film-b", "B1-RACE-3: with the created project remembered");

  /* ---- B1-RACE-4: the SOURCE project changed while the request flew. ----- */
  const moved = delayedCreation();
  const page4 = await render("#/create", rawFixture(), { fetch: moved.hook });
  await evaluateAsync(page4.context, `await flushPendingProjectSave(); return 1;`);
  startPressInFlight(page4.context);
  await untilCreateInFlight(moved);
  /* The filmmaker legitimately opens a different project mid-flight. This is the
     shipped replacement act — the same one the switcher performs. */
  const movedTo = evaluate(page4.context, `
    beginProjectOpen();
    ACTIVE_PROJECT_SLUG = "some-other-film";
    return { slug: ACTIVE_PROJECT_SLUG, epoch: PROJECT_OPEN_EPOCH };`);
  const marker4 = moved.marker();
  moved.release();
  await settlePress(page4.context);
  const after4 = evaluate(page4.context, `
    return { slug: ACTIVE_PROJECT_SLUG, hash: location.hash,
             pending: (window.__cinebraidManualStartPending||{}).slug || "" };`);
  equal(moved.since(marker4).filter((row) => row.url === "/api/projects/switch").length, 0,
    "B1-RACE-4: a stale create response does not blindly replace whichever project is now open");
  equal(after4.slug, movedTo.slug, "B1-RACE-4: the project the filmmaker moved to is left alone");
  equal(after4.hash, "#/create", "B1-RACE-4: and nothing about its identity or hash was altered");
  equal(after4.pending, "film-b", "B1-RACE-4: the created project is remembered rather than lost or deleted");

  note("B1-RACE the pre-POST verdict is carried as a certificate (open epoch, project, durable generation, stored revision, edit counters) and re-checked with no await before the replacement: an intervening edit is saved first and only then replaced; a 422, a 409 or a project change leaves Film A current with its edit, refusal and counters intact; the created project is remembered and finished by the next press rather than created twice");
}

/* ===========================================================================
   ACTIVE — CREATING FILM B AND ACTIVATING IT ARE TWO ACTS.

   The replacement fence kept the WINDOW in Film A when it refused, but
   POST /api/projects/new had already written `activeProject` server-side. So the
   two disagreed: the browser said A, the config said B, and a reload opened the
   project the fence had just declined to switch to — discarding the edit the
   refusal existed to protect.

   The route now takes `activate` (default true, so every other caller is
   unchanged) and the manual path creates WITHOUT activating. Activation is one
   explicit act through the shipped switch route, at the commit.

   The first half of this section proves the SERVER's half against a real server
   and a real config file, because "what does a reload open" is a question about
   stored state and nothing in a browser harness can answer it. The second half
   proves the CLIENT's half, with the harness modelling the active project so a
   refused fence can be checked against both sides at once.
   =========================================================================== */

const { spawn } = require("child_process");
const os = require("os");

function freePortDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-active-"));
  fs.mkdirSync(path.join(dir, "projects"), { recursive: true });
  return dir;
}

/* A real CineBraid server on a throwaway root, so `activeProject` is read back
   from the config file the product actually writes. */
async function withRealServer(body) {
  const dir = freePortDir();
  const configPath = path.join(dir, "config.json");
  const projectsRoot = path.join(dir, "projects");
  const port = 4700 + Math.floor(Math.random() * 250);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_HOST: "127.0.0.1",
           CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 200; i++) {
      try { await fetch(`${base}/api/app-identity`); break; } catch { await tick(); await new Promise((r) => setTimeout(r, 100)); }
    }
    const activeProject = () => {
      try { return JSON.parse(fs.readFileSync(configPath, "utf8")).activeProject || ""; } catch { return ""; }
    };
    const create = async (title, extra = {}) => {
      const response = await fetch(`${base}/api/projects/new`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, ...extra }),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const switchTo = async (slug) => {
      const response = await fetch(`${base}/api/projects/switch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const projects = () => fs.readdirSync(projectsRoot)
      .filter((d) => fs.existsSync(path.join(projectsRoot, d, "project.json")));
    return await body({ base, activeProject, create, switchTo, projects, projectsRoot });
  } finally {
    try { child.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function active_serverSeparatesCreationFromActivation() {
  await withRealServer(async (server) => {
    /* The baseline caller — no flag — still creates AND activates. */
    const filmA = await server.create("Film A");
    equal(filmA.status, 200, "ACTIVE-S1: an ordinary creation succeeds");
    equal(server.activeProject(), filmA.body.slug,
      "ACTIVE-S1: every existing caller is unchanged — creation still activates by default");

    /* The manual path's creation — created on disk, NOT activated. */
    const filmB = await server.create("Film B", { activate: false });
    equal(filmB.status, 200, "ACTIVE-S2: a create-without-activate succeeds");
    ok(server.projects().includes(filmB.body.slug),
      "ACTIVE-S2: Film B exists on disk — it was created, only not made current");
    equal(server.activeProject(), filmA.body.slug,
      "ACTIVE-S2: and the ACTIVE project is still Film A, so a reload opens Film A");
    ok(fs.existsSync(path.join(server.projectsRoot, filmB.body.slug, "project.json")),
      "ACTIVE-S2: Film B is a complete, openable project, not a placeholder");

    /* Activation is the switch route, and it is what makes a reload open B. */
    const switched = await server.switchTo(filmB.body.slug);
    equal(switched.status, 200, "ACTIVE-S3: the shipped switch route activates it");
    equal(server.activeProject(), filmB.body.slug,
      "ACTIVE-S3: and only now does a reload open Film B");

  });
  note("ACTIVE-S the creation route separates creating from activating: `activate: false` leaves a complete project on disk without moving activeProject, the default still activates so no other caller changes, and the switch route is what a reload follows");
}

/* ---- the client half ---------------------------------------------------- */

/* A create/switch stub that MODELS the server's active project, so a refused
   fence can be checked on both sides at once. */
function activationHarness({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let release = null;
  let saveStatus = 200;
  let saveBody = null;
  let activeProject = sourceSlug;
  const created = new Set();
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    calls,
    release: () => release(),
    setSaveStatus(status, body) { saveStatus = status; saveBody = body || null; },
    activeProject: () => activeProject,
    createdProjects: () => [...created],
    createCount: () => calls.filter((row) => row.url === "/api/projects/new").length,
    switchCount: () => calls.filter((row) => row.url === "/api/projects/switch").length,
    switchTargets: () => calls.filter((row) => row.url === "/api/projects/switch")
      .map((row) => { try { return JSON.parse(row.body).slug; } catch { return ""; } }),
    marker() { return calls.length; },
    since(m) { return calls.slice(m); },
    hook: async (url, options, respond) => {
      const body = String((options && options.body) || "");
      calls.push({ url, method: (options && options.method) || "GET", body });
      if (url === "/api/projects/new") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        await gate;
        /* The project is created either way — that is the point. */
        created.add(createSlug);
        const activate = request.activate !== false;
        if (activate) activeProject = createSlug;
        return respond({ ok: true, slug: createSlug, activated: activate }, 200);
      }
      if (url === "/api/projects/switch") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        activeProject = String(request.slug || activeProject);
        return respond({ ok: true, slug: activeProject }, 200);
      }
      /* THE PREPARE READ COMES FIRST, AND IT IS A GET. The same path serves the
         save (PUT/POST) and the new project's document (GET), and answering a
         read with a save receipt would hand the commit a document with no meta. */
      if (((options && options.method) || "GET") === "GET") {
        const preparedRoute = preparedProjectRoutes(createSlug, rawFixture())(url, options, respond);
        if (preparedRoute) return preparedRoute;
      }
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
        if (saveStatus === 200) {
          return respond({ ok: true, revision: `rev-${calls.length}` }, 200,
            { "x-cinebraid-project-revision": `rev-${calls.length}` });
        }
        return respond(saveBody || { error: "refused", code: "PROJECT_VALIDATION_FAILED" }, saveStatus);
      }
      return null;
    },
  };
}

async function active_clientActivatesOnlyOnCommit() {
  /* ---- ACTIVE-5: the ordinary path still works, and activates exactly once. */
  const fast = activationHarness();
  const fastPage = await render("#/create", rawFixture(), { fetch: fast.hook });
  await evaluateAsync(fastPage.context, `await flushPendingProjectSave(); return 1;`);
  startPressInFlight(fastPage.context);
  await untilCreateInFlight(fast);
  equal(fast.activeProject(), "film-a",
    "ACTIVE-5: the project is created without becoming active");
  fast.release();
  await settlePress(fastPage.context);
  equal(evaluate(fastPage.context, `return location.hash;`), "#/production",
    "ACTIVE-5: ordinary creation still opens the new project");
  equal(fast.activeProject(), "film-b", "ACTIVE-5: which is now the active project");
  equal(fast.switchCount(), 1, "ACTIVE-5: activated by exactly one explicit switch");
  equal(fast.createCount(), 1, "ACTIVE-5: and created exactly once");

  /* ---- ACTIVE-1: delayed create + intervening 422. --------------------- */
  const refused = activationHarness();
  const page1 = await render("#/create", rawFixture(), { fetch: refused.hook });
  await evaluateAsync(page1.context, `await flushPendingProjectSave(); return 1;`);
  const titleBefore = evaluate(page1.context, `return P.meta.title;`);
  startPressInFlight(page1.context);
  await untilCreateInFlight(refused);
  refused.setSaveStatus(422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" });
  evaluate(page1.context, `P.meta.logline = "ACTIVE-EDIT-THEN-REFUSED";
    SAVE_REVISION += 1; setSaveState("dirty", "Unsaved changes");
    return 1;`);
  const marker1 = refused.marker();
  refused.release();
  await settlePress(page1.context);

  const after1 = evaluate(page1.context, `
    const main = (document.getElementById("main")||{innerHTML:""}).innerHTML;
    return { title: P.meta.title, logline: P.meta.logline, hash: location.hash,
             blocked: SAVE_BLOCKED, settled: projectSaveSettled().settled,
             pending: (window.__cinebraidManualStartPending||{}).slug || "",
             refusal: main.indexOf('data-action-refusal="manual-start"') >= 0 };`);

  ok(refused.createdProjects().includes("film-b"), "ACTIVE-1: Film B was successfully created");
  equal(refused.createCount(), 1, "ACTIVE-1: exactly once");
  equal(after1.title, titleBefore, "ACTIVE-1: the UI remains Film A");
  equal(after1.hash, "#/create", "ACTIVE-1: the window did not move");
  equal(refused.activeProject(), "film-a",
    "ACTIVE-1: and the SERVER's active project is still Film A — browser and server agree");
  equal(refused.since(marker1).filter((row) => row.url === "/api/projects/switch").length, 0,
    "ACTIVE-1: Film B was never loaded");
  equal(after1.logline, "ACTIVE-EDIT-THEN-REFUSED", "ACTIVE-1: Film A's edit remains");
  equal(after1.blocked, true, "ACTIVE-1: its refusal remains");
  equal(after1.refusal, true, "ACTIVE-1: and is on screen");
  equal(after1.pending, "film-b", "ACTIVE-1: Film B is remembered as the pending creation");

  /* ---- ACTIVE-4: recovery uses the pending B and activates it once. ----- */
  const beforeRecovery = refused.marker();
  refused.setSaveStatus(200, null);
  await evaluateAsync(page1.context, `
    resumeProjectSaving();
    await flushPendingProjectSave();
    return 1;`);
  equal(evaluate(page1.context, `return projectSaveSettled().settled;`), true,
    "ACTIVE-4 precondition: Film A reaches a positively saved state");
  startPressInFlight(page1.context);
  await settlePress(page1.context);
  const recoveryCalls = refused.since(beforeRecovery);
  equal(recoveryCalls.filter((row) => row.url === "/api/projects/new").length, 0,
    "ACTIVE-4: recovery issues NO second creation");
  equal(recoveryCalls.filter((row) => row.url === "/api/projects/switch").length, 1,
    "ACTIVE-4: exactly one legitimate switch activates the already-created project");
  equal(refused.activeProject(), "film-b", "ACTIVE-4: which is now active");
  equal(refused.createdProjects().length, 1, "ACTIVE-4: and only one project was ever created");
  equal(evaluate(page1.context, `return location.hash;`), "#/production", "ACTIVE-4: it opens");

  /* ---- ACTIVE-2: intervening edit that later saves. -------------------- */
  const saving = activationHarness();
  const page2 = await render("#/create", rawFixture(), { fetch: saving.hook });
  await evaluateAsync(page2.context, `await flushPendingProjectSave(); return 1;`);
  startPressInFlight(page2.context);
  await untilCreateInFlight(saving);
  evaluate(page2.context, `P.meta.logline = "ACTIVE-EDIT-THEN-SAVED";
    SAVE_REVISION += 1; setSaveState("dirty", "Unsaved changes");
    return 1;`);
  equal(saving.activeProject(), "film-a",
    "ACTIVE-2: Film B exists but is not active while Film A's save is pending");
  const marker2 = saving.marker();
  saving.release();
  await settlePress(page2.context);

  const savesBeforeSwitch = saving.since(marker2);
  const switchAt = savesBeforeSwitch.findIndex((row) => row.url === "/api/projects/switch");
  const savedAt = savesBeforeSwitch.findIndex((row) => /\/api\/projects\/[^/]+\/project$/.test(row.url)
    && String(row.body).includes("ACTIVE-EDIT-THEN-SAVED"));
  ok(savedAt >= 0, "ACTIVE-2: Film A's later revision was persisted");
  ok(switchAt >= 0 && savedAt < switchAt,
    "ACTIVE-2: and it was persisted BEFORE the switch that activates Film B");
  equal(saving.activeProject(), "film-b", "ACTIVE-2: only then is Film B active, so a reload opens it");
  equal(evaluate(page2.context, `return location.hash;`), "#/production", "ACTIVE-2: and it opens normally");

  /* ---- ACTIVE-3: the source project changed while the request flew. ---- */
  const moved = activationHarness();
  const page3 = await render("#/create", rawFixture(), { fetch: moved.hook });
  await evaluateAsync(page3.context, `await flushPendingProjectSave(); return 1;`);
  startPressInFlight(page3.context);
  await untilCreateInFlight(moved);
  /* The filmmaker opens a different project. The harness's active project moves
     with them, exactly as the switcher would move it. */
  evaluate(page3.context, `
    beginProjectOpen();
    ACTIVE_PROJECT_SLUG = "some-other-film";
    return 1;`);
  await moved.hook("/api/projects/switch", { method: "POST", body: JSON.stringify({ slug: "some-other-film" }) },
    (b, s) => ({ ok: true, status: s || 200, json: async () => b, headers: { get: () => null } }));
  equal(moved.activeProject(), "some-other-film", "ACTIVE-3 precondition: the filmmaker is in another project");
  const marker3 = moved.marker();
  moved.release();
  await settlePress(page3.context);

  const after3 = evaluate(page3.context, `return { slug: ACTIVE_PROJECT_SLUG, hash: location.hash,
    pending: (window.__cinebraidManualStartPending||{}).slug || "" };`);
  equal(after3.slug, "some-other-film", "ACTIVE-3: the browser stays in the project the filmmaker moved to");
  equal(moved.activeProject(), "some-other-film",
    "ACTIVE-3: and the stale create response does not overwrite the server's active project either");
  equal(moved.since(marker3).filter((row) => row.url === "/api/projects/switch").length, 0,
    "ACTIVE-3: nothing was loaded over it");
  equal(after3.pending, "film-b", "ACTIVE-3: Film B is kept as a pending creation rather than lost");

  note("ACTIVE the manual path creates Film B without activating it: a refused fence leaves browser AND server both naming Film A, an intervening edit is persisted before the activating switch, a stale response overwrites neither side, and recovery activates the already-created project with one switch and no second creation");
}

/* ===========================================================================
   FINAL-B1 — THE ATOMIC REPLACEMENT PROTOCOL.

   Three defects were reproduced against the previous shape, and they were not
   three bugs: they were one wrong shape, `activate B -> discover stale source ->
   restore A`. A failed put-back left the browser and the server naming different
   projects; a successful put-back could overwrite a legitimate switch to a third
   project; and the asynchronous open after the activation reopened the very
   interval the fence existed to close.

   The shape is now: LOCK, certify A, create B inactive, PREPARE B completely,
   revalidate, activate CONDITIONALLY, install SYNCHRONOUSLY. If this window is
   not ready to commit, B is never activated — so there is nothing to put back.
   =========================================================================== */

/* A harness that models the server's active project AND the conditional switch,
   with independent gates on the creation and the preparation so the test can
   act inside either. */
function atomicHarness({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let activeProject = sourceSlug;
  let saveStatus = 200;
  let saveBody = null;
  const created = new Set();
  let releaseCreate = null;
  let releasePrepare = null;
  const createGate = new Promise((r) => { releaseCreate = r; });
  const prepareGate = new Promise((r) => { releasePrepare = r; });
  let holdPrepare = false;
  return {
    calls,
    releaseCreate: () => releaseCreate(),
    releasePrepare: () => releasePrepare(),
    holdPrepare() { holdPrepare = true; },
    setSaveStatus(status, body) { saveStatus = status; saveBody = body || null; },
    setActiveProject(slug) { activeProject = slug; },
    activeProject: () => activeProject,
    createdProjects: () => [...created],
    createCount: () => calls.filter((row) => row.url === "/api/projects/new").length,
    switchCalls: () => calls.filter((row) => row.url === "/api/projects/switch")
      .map((row) => { try { return JSON.parse(row.body); } catch { return {}; } }),
    marker() { return calls.length; },
    since(m) { return calls.slice(m); },
    hook: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      const body = String((options && options.body) || "");
      calls.push({ url, method, body });

      if (url === "/api/projects/new") {
        await createGate;
        created.add(createSlug);
        /* activate:false is honoured — the project exists, inactive. */
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (request.activate !== false) activeProject = createSlug;
        return respond({ ok: true, slug: createSlug }, 200);
      }

      if (url === "/api/projects/switch") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        /* THE CONDITIONAL SWITCH, modelled exactly as the route implements it:
           the check and the write are one synchronous section. */
        if (Object.prototype.hasOwnProperty.call(request, "expectedActiveProject")
          && String(request.expectedActiveProject || "") !== activeProject) {
          return respond({
            ok: false, code: "PROJECT_ACTIVE_CONFLICT",
            error: "The active project changed before this switch, so it was not made.",
            expected: request.expectedActiveProject, activeProject,
          }, 409);
        }
        activeProject = String(request.slug || activeProject);
        return respond({ ok: true, slug: activeProject }, 200);
      }

      if (method === "GET" && url === `/api/projects/${createSlug}/project`) {
        if (holdPrepare) await prepareGate;
        const project = rawFixture();
        project.meta.title = "Film B";
        return respond(project, 200, {
          "x-cinebraid-project-slug": createSlug,
          "x-cinebraid-project-revision": `rev-${createSlug}`, etag: `rev-${createSlug}`,
        });
      }
      if (method === "GET" && url.startsWith("/api/scan?project=")) {
        return respond({ anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} }, 200);
      }
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
        if (saveStatus === 200) {
          return respond({ ok: true, revision: `rev-${calls.length}` }, 200,
            { "x-cinebraid-project-revision": `rev-${calls.length}` });
        }
        return respond(saveBody || { error: "refused", code: "PROJECT_VALIDATION_FAILED" }, saveStatus);
      }
      return null;
    },
  };
}

async function untilRequest(gate, predicate, label) {
  for (let i = 0; i < 300; i++) {
    if (gate.calls.some(predicate)) return;
    await tick();
  }
  throw new Error(`${label} never happened`);
}

async function final_b1_atomicReplacement() {
  /* ---- FINAL-B1-6: the ordinary path, and the shape it now has. --------- */
  const fast = atomicHarness();
  const fastPage = await render("#/create", rawFixture(), { fetch: fast.hook });
  await evaluateAsync(fastPage.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(fastPage.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startPressInFlight(fastPage.context);
  fast.releaseCreate();
  await settlePress(fastPage.context);

  const fastSeen = evaluate(fastPage.context, `return { title: P.meta.title, hash: location.hash,
    pending: (window.__cinebraidManualStartPending||{}).slug || "" };`);
  equal(fast.createCount(), 1, "FINAL-B1-6: one creation");
  equal(fast.switchCalls().length, 1, "FINAL-B1-6: one activation");
  equal(fast.switchCalls()[0].expectedActiveProject, "film-a",
    "FINAL-B1-6: which states the project it believes is active");
  equal(fast.activeProject(), "film-b", "FINAL-B1-6: and the server now names the new project");
  equal(fastSeen.title, "Film B", "FINAL-B1-6: the window installed the prepared project");
  equal(fastSeen.hash, "#/production", "FINAL-B1-6: and moved into it");
  equal(fastSeen.pending, "", "FINAL-B1-6: with nothing left pending");
  /* The create POST asked NOT to activate, so a reload before the switch would
     have opened Film A. */
  const createBody = JSON.parse(fast.calls.find((row) => row.url === "/api/projects/new").body);
  equal(createBody.activate, false, "FINAL-B1-6: the creation was explicitly inactive");

  /* ---- FINAL-B1-1: the lock refuses same-window navigation and switching. */
  const locked = atomicHarness();
  const page1 = await render("#/create", rawFixture(), { fetch: locked.hook });
  await evaluateAsync(page1.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page1.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startPressInFlight(page1.context);
  await untilRequest(locked, (row) => row.url === "/api/projects/new", "the creation");

  const duringLock = await evaluateAsync(page1.context, `
    const busy = manualReplacementBusy();
    /* The filmmaker tries to go back into Film A and edit it. */
    location.hash = "#/shots";
    await route();
    const hashAfterNavigation = location.hash;
    /* And tries to switch projects from the same window. */
    await switchProject("some-other-film");
    return {
      busy, hashAfterNavigation,
      toast: (document.getElementById("toast") || {}).textContent || "",
      slug: ACTIVE_PROJECT_SLUG,
    };`);
  equal(duringLock.busy, true, "FINAL-B1-1: the transaction reports itself busy");
  equal(duringLock.hashAfterNavigation, "#/create",
    "FINAL-B1-1: navigating into the open project during the transaction is refused, and the hash is put back");
  ok(/CineBraid is /.test(duringLock.toast),
    "FINAL-B1-1: and it says why rather than ignoring the press: " + duringLock.toast);
  equal(duringLock.slug, "film-a", "FINAL-B1-1: the same-window switch did not happen either");
  equal(locked.calls.filter((row) => row.url === "/api/projects/switch").length, 0,
    "FINAL-B1-1: no switch request was issued by that attempt");
  locked.releaseCreate();
  await settlePress(page1.context);

  /* ---- FINAL-B1-3: preload delay leaves A active on both sides. --------- */
  const slow = atomicHarness();
  slow.holdPrepare();
  const page3 = await render("#/create", rawFixture(), { fetch: slow.hook });
  await evaluateAsync(page3.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page3.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startPressInFlight(page3.context);
  slow.releaseCreate();
  await untilRequest(slow, (row) => row.url === "/api/projects/film-b/project", "the prepare read");

  /* The preparation is in flight. Nothing may have moved. */
  const midPrepare = evaluate(page3.context, `return { slug: ACTIVE_PROJECT_SLUG, title: P.meta.title, hash: location.hash };`);
  equal(slow.activeProject(), "film-a",
    "FINAL-B1-3: the SERVER still names Film A while the new project is being prepared");
  equal(midPrepare.slug, "film-a", "FINAL-B1-3: and so does the window");
  equal(midPrepare.hash, "#/create", "FINAL-B1-3: which has not moved");
  equal(slow.calls.filter((row) => row.url === "/api/projects/switch").length, 0,
    "FINAL-B1-3: NO activation has been issued — there is no interval in which B is active and unprepared");
  ok(slow.createdProjects().includes("film-b"), "FINAL-B1-3: even though B exists on disk already");
  slow.releasePrepare();
  await settlePress(page3.context);
  equal(slow.activeProject(), "film-b", "FINAL-B1-3: only once prepared is it activated");

  /* ---- FINAL-B1-2 / FINAL-B1-5: a legitimate C before the activation. --- */
  const raced = atomicHarness();
  raced.holdPrepare();
  const page2 = await render("#/create", rawFixture(), { fetch: raced.hook });
  await evaluateAsync(page2.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page2.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startPressInFlight(page2.context);
  raced.releaseCreate();
  await untilRequest(raced, (row) => row.url === "/api/projects/film-b/project", "the prepare read");
  /* A third project legitimately becomes active — another window, or the
     switcher — while this transaction is preparing. */
  raced.setActiveProject("film-c");
  raced.releasePrepare();
  await settlePress(page2.context);

  const after2 = evaluate(page2.context, `
    const main = (document.getElementById("main")||{innerHTML:""}).innerHTML;
    return { title: P.meta.title, hash: location.hash,
             pending: (window.__cinebraidManualStartPending||{}).slug || "",
             busy: manualReplacementBusy(),
             refusal: main.indexOf('data-action-refusal="manual-start"') >= 0,
             refusalText: (main.split("CineBraid did not make this change</b><span>")[1]||"").split("</span>")[0] };`);
  const switches = raced.switchCalls();
  equal(switches.length, 1, "FINAL-B1-2: exactly one switch was attempted");
  equal(switches[0].expectedActiveProject, "film-a", "FINAL-B1-2: stating the project this window believed active");
  equal(raced.activeProject(), "film-c",
    "FINAL-B1-2: the conditional switch refused, so Film C remains server-active");
  ok(!switches.some((row) => row.slug === "film-a"),
    "FINAL-B1-2: and NO put-back was issued — Film A was never restored over Film C");
  equal(after2.title, "Render Harness Project", "FINAL-B1-5: no browser replacement happened");
  equal(after2.hash, "#/create", "FINAL-B1-5: and the window did not move");
  equal(raced.createdProjects().length, 1, "FINAL-B1-2: Film B exists exactly once");
  equal(after2.pending, "film-b", "FINAL-B1-2: inactive, and remembered as pending");
  equal(after2.busy, false, "FINAL-B1-2: the lock was released safely");
  equal(after2.refusal, true, "FINAL-B1-5: the reason is on screen");
  ok(/did not switch to it/i.test(after2.refusalText), "FINAL-B1-5: " + after2.refusalText);

  /* ---- FINAL-B1-7: recovery reuses the pending B, activating it once. --- */
  const beforeRecovery = raced.marker();
  raced.setActiveProject("film-a");   /* the filmmaker comes back to Film A */
  evaluate(page2.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startPressInFlight(page2.context);
  await settlePress(page2.context);
  const recovery = raced.since(beforeRecovery);
  equal(recovery.filter((row) => row.url === "/api/projects/new").length, 0,
    "FINAL-B1-7: recovery issues NO second creation");
  equal(recovery.filter((row) => row.url === "/api/projects/switch").length, 1,
    "FINAL-B1-7: exactly one activation opens the project that already existed");
  equal(raced.createdProjects().length, 1, "FINAL-B1-7: still exactly one Film B");
  equal(raced.activeProject(), "film-b", "FINAL-B1-7: which is now active");
  equal(evaluate(page2.context, `return P.meta.title;`), "Film B", "FINAL-B1-7: and open");

  /* ---- FINAL-B1-4: no awaited work between activation and installation. -
     The behavioural half: the activation is the LAST request the transaction
     makes, so nothing was fetched between its response and the install. The
     structural half is R-B1R in the negative controls, which reads the source. */
  const instrumented = atomicHarness();
  const page4 = await render("#/create", rawFixture(), { fetch: instrumented.hook });
  await evaluateAsync(page4.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page4.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  const markerFour = instrumented.marker();
  /* EVERY REQUEST, STAMPED WITH WHICH PROJECT WAS INSTALLED WHEN IT WENT OUT.
     "Nothing awaited between the activation and the replacement" is precisely:
     no request left this window, after the activation was confirmed, while P was
     still the outgoing project. Requests made AFTER the install are ordinary
     rendering and are not the defect. */
  evaluate(page4.context, `
    globalThis.__seen = [];
    const original = globalThis.fetch;
    globalThis.fetch = (url, opts) => {
      globalThis.__seen.push({ url: String(url), title: (P && P.meta && P.meta.title) || "" });
      return original(url, opts);
    };
    return 1;`);
  startPressInFlight(page4.context);
  instrumented.releaseCreate();
  await settlePress(page4.context);

  const seen = evaluate(page4.context, `return globalThis.__seen;`);
  const switchAt = seen.map((row) => row.url).lastIndexOf("/api/projects/switch");
  ok(switchAt >= 0, "FINAL-B1-4: the activation happened");
  const afterActivation = seen.slice(switchAt + 1);
  const beforeInstall = afterActivation.filter((row) => row.title !== "Film B");
  equal(beforeInstall.length, 0,
    "FINAL-B1-4: NO request left this window between the confirmed activation and the installation: "
    + JSON.stringify(beforeInstall));
  ok(afterActivation.length > 0 && afterActivation.every((row) => row.title === "Film B"),
    "FINAL-B1-4: everything after it ran against the already-installed project");
  equal(evaluate(page4.context, `return P.meta.title;`), "Film B",
    "FINAL-B1-4: and the prepared project is installed");
  ok(seen.map((row) => row.url).indexOf("/api/projects/film-b/project") < switchAt,
    "FINAL-B1-4: every read the open needed happened BEFORE the activation");

  note("FINAL-B1 the transaction locks the window, creates the new project inactive, prepares it completely, revalidates, activates conditionally and installs synchronously: a preload delay leaves both sides naming the old project, a legitimate switch to a third project makes the activation refuse without any put-back, the activation is the last request before the install, and recovery reuses the created project");
}
/* ===========================================================================
   MODAL — THE COMMIT IS MODAL, AND dirty() TELLS THE TRUTH AGAIN.

   The previous shape guarded dirty(). That was too late: every caller mutates
   `P` and THEN calls dirty(), so the guard suppressed the record of a change
   that had already happened — `P` changed, counters unchanged,
   projectSaveSettled() answering true about a document it no longer described.

   Two mechanisms replace it, and they cover different things:

     THE INTERACTION FENCE protects human input. From the press until it settles,
     no TRUSTED event reaches an ordinary handler, so `+ Add`, a modal's Save,
     `+ Project`, Settings and their keyboard equivalents never run at all. `P` is
     not mutated, because the mutator is never called.

     THE REPLACEMENT CERTIFICATE protects concurrent internal and asynchronous
     change. Those are supposed to happen: dirty() records them, the counters
     move, and the certificate goes stale — so the prepared project refuses to
     install over a newer document rather than discarding it.

   Only trusted events are fenced, which is the line between the two. A trusted
   event is a person, and page script cannot forge the flag.
   =========================================================================== */

/* A TRUSTED INTERACTION, MODELLED THE WAY A BROWSER DELIVERS ONE.
 *
 * Capture listeners run first; if one calls stopImmediatePropagation the target's
 * own handler never runs. `documentListeners` lives in the harness's Node closure
 * — page script can register into it but cannot enumerate or fire it — so this is
 * the one place a genuinely un-forgeable "a person did this" can come from.
 *
 * Returns whether the interaction was DELIVERED to its handler. */
function trustedInteraction(page, type, run) {
  let stopped = false;
  let prevented = false;
  const event = {
    type,
    isTrusted: true,
    target: page.context.document.getElementById("main"),
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
    stopImmediatePropagation() { stopped = true; },
  };
  for (const handler of (page.documentListeners.get(type) || []).slice()) {
    handler(event);
    if (stopped) break;
  }
  if (stopped) return { delivered: false, prevented };
  run();
  return { delivered: true, prevented };
}

function modalHarness({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let activeProject = sourceSlug;
  let saveStatus = 200;
  let saveBody = null;
  let releaseSwitch = null;
  const switchGate = new Promise((r) => { releaseSwitch = r; });
  let holdSwitch = false;
  let createStatus = 200;
  let prepareStatus = 200;
  let releaseCreate = null;
  const createGate = new Promise((r) => { releaseCreate = r; });
  let holdCreate = false;
  return {
    calls,
    holdSwitch() { holdSwitch = true; },
    holdCreate() { holdCreate = true; },
    releaseCreate: () => releaseCreate(),
    releaseSwitch: () => releaseSwitch(),
    setSaveStatus(status, body) { saveStatus = status; saveBody = body || null; },
    setCreateStatus(status) { createStatus = status; },
    setPrepareStatus(status) { prepareStatus = status; },
    setActiveProject(slug) { activeProject = slug; },
    activeProject: () => activeProject,
    switchCalls: () => calls.filter((row) => row.url === "/api/projects/switch"),
    marker() { return calls.length; },
    since(m) { return calls.slice(m); },
    hook: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      const body = String((options && options.body) || "");
      calls.push({ url, method, body });
      if (url === "/api/projects/new") {
        if (holdCreate) await createGate;
        if (createStatus !== 200) return respond({ error: "Could not create project" }, createStatus);
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (request.activate !== false) activeProject = createSlug;
        return respond({ ok: true, slug: createSlug }, 200);
      }
      if (url === "/api/projects/switch") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (Object.prototype.hasOwnProperty.call(request, "expectedActiveProject")
          && String(request.expectedActiveProject || "") !== activeProject) {
          if (holdSwitch) await switchGate;
          return respond({ ok: false, code: "PROJECT_ACTIVE_CONFLICT", error: "The active project changed.", activeProject }, 409);
        }
        activeProject = String(request.slug || activeProject);
        if (holdSwitch) await switchGate;
        return respond({ ok: true, slug: activeProject }, 200);
      }
      if (method === "GET" && /\/api\/projects\/[^/]+\/project$/.test(url)) {
        if (prepareStatus !== 200) return respond({ error: "unreadable" }, prepareStatus);
        const slug = url.split("/")[3];
        const project = rawFixture();
        project.meta.title = slug === createSlug ? "Film B" : "Film C";
        return respond(project, 200, {
          "x-cinebraid-project-slug": slug,
          "x-cinebraid-project-revision": `rev-${slug}`, etag: `rev-${slug}`,
        });
      }
      if (method === "GET" && url.startsWith("/api/scan")) {
        return respond({ anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} }, 200);
      }
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
        if (saveStatus === 200) {
          return respond({ ok: true, revision: `rev-${calls.length}` }, 200, { "x-cinebraid-project-revision": `rev-${calls.length}` });
        }
        return respond(saveBody || { error: "refused", code: "PROJECT_VALIDATION_FAILED" }, saveStatus);
      }
      return null;
    },
  };
}
async function untilFenceUp(page) {
  for (let i = 0; i < 400; i++) {
    if (evaluate(page.context, `return interactionFenceActive();`)) return;
    await tick();
  }
  throw new Error("the interaction fence never came up");
}

async function modal_commitIsModal() {
  /* ---- MODAL-1 / 2 / 3: trusted input cannot reach a mutator. ----------- */
  for (const [label, status, body] of [
    ["an ordinary pending save", 200, null],
    ["a 409", 409, { error: "This project changed in storage.", code: "PROJECT_REVISION_CONFLICT" }],
    ["a 422", 422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" }],
  ]) {
    const gate = modalHarness();
    gate.holdSwitch();
    const page = await render("#/create", rawFixture(), { fetch: gate.hook });
    await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
    evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
    startPressInFlight(page.context);
    await untilFenceUp(page);
    gate.setSaveStatus(status, body);

    /* THE DOCUMENT ITSELF, not a counter. */
    const before = evaluate(page.context, `return {
      document: JSON.stringify(P), scenes: P.scenes.length, shots: P.shots.length,
      saveRevision: SAVE_REVISION, savedRevision: SAVED_REVISION };`);
    const marker = gate.marker();

    /* MODAL-1 — the exact reproduction: + Add → Scene → Save, as a person. */
    const addScene = trustedInteraction(page, "click", () => evaluate(page.context, `
      addScene();
      const field = document.getElementById("ff-title");
      if (field) field.value = "A scene typed mid-transaction";
      if (typeof _formSubmit === "function") _formSubmit();
      return 1;`));
    equal(addScene.delivered, false,
      `MODAL-1 (${label}): the editing action never reached addScene() — the fence refused delivery`);

    /* MODAL-2 — + Project, the same way. */
    const newProjectPress = trustedInteraction(page, "click", () => evaluate(page.context, `newProject(); return 1;`));
    equal(newProjectPress.delivered, false, `MODAL-2 (${label}): + Project cannot be reached either`);

    /* MODAL-3 — a Settings write, and its keyboard equivalent. */
    const settings = trustedInteraction(page, "change", () => evaluate(page.context,
      `setGlobalCreationField("globalStylePrompt", "typed mid-transaction"); return 1;`));
    equal(settings.delivered, false, `MODAL-3 (${label}): a Settings edit cannot be reached`);
    const keyboard = trustedInteraction(page, "keydown", () => evaluate(page.context, `addShot(); return 1;`));
    equal(keyboard.delivered, false, `MODAL-3 (${label}): nor its keyboard equivalent`);

    const after = evaluate(page.context, `return {
      document: JSON.stringify(P), scenes: P.scenes.length, shots: P.shots.length,
      saveRevision: SAVE_REVISION, savedRevision: SAVED_REVISION };`);
    equal(after.document, before.document,
      `MODAL-1 (${label}): the project document is deep-equal before and after every attempted interaction`);
    equal(after.scenes, before.scenes, `MODAL-1 (${label}): the scene count is unchanged`);
    equal(after.shots, before.shots, `MODAL-1 (${label}): and the shot count`);
    equal(after.saveRevision, before.saveRevision,
      `MODAL-1 (${label}): the revision is unchanged BECAUSE no mutation occurred`);
    equal(after.savedRevision, before.savedRevision, `MODAL-1 (${label}): and the saved counter with it`);
    equal(gate.since(marker).filter((row) => row.method !== "GET"
      && /\/api\/projects\/[^/]+\/project$/.test(row.url)).length, 0,
      `MODAL-1 (${label}): no save was sent, so none can be discarded later`);

    gate.releaseSwitch();
    await settlePress(page.context);
    equal(evaluate(page.context, `return interactionFenceActive();`), false,
      `MODAL-1 (${label}): the fence released`);
  }

  /* ---- MODAL-4: a background mutation is RECORDED and invalidates B. ---- */
  const background = modalHarness();
  /* HELD AT THE CREATE, not the switch: the mutation must land AFTER the open
     project has been certified, which is what makes the certificate go stale.
     Landing before certification is a different case — the pre-press guard —
     and it simply refuses to create anything. */
  background.holdCreate();
  const bgPage = await render("#/create", rawFixture(), { fetch: background.hook });
  await evaluateAsync(bgPage.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(bgPage.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startPressInFlight(bgPage.context);
  await untilFenceUp(bgPage);
  for (let i = 0; i < 400 && !background.calls.some((row) => row.url === "/api/projects/new"); i++) await tick();

  const bg = evaluate(bgPage.context, `
    const beforeRevision = SAVE_REVISION;
    const beforeSettled = projectSaveSettled().settled;
    /* NOT a user action: legitimate internal work, exactly as a background
       ingest or an automation completion would do it. The fence does not touch
       it, and must not. */
    P.meta.logline = "BACKGROUND-MUTATION";
    dirty();
    return {
      beforeRevision, beforeSettled,
      afterRevision: SAVE_REVISION,
      recorded: P.meta.logline,
      settledAfter: projectSaveSettled().settled,
    };`);
  equal(bg.beforeSettled, true, "MODAL-4 precondition: the project was settled when the transaction began");
  equal(bg.recorded, "BACKGROUND-MUTATION", "MODAL-4: the internal mutation changed P");
  ok(bg.afterRevision > bg.beforeRevision,
    "MODAL-4: dirty() RECORDED it — the counters advance normally, which is what the old guard concealed");
  equal(bg.settledAfter, false,
    "MODAL-4: so the window truthfully reports itself unsaved — never `P` changed with counters unchanged");

  background.releaseCreate();
  await settlePress(bgPage.context);
  const after4 = evaluate(bgPage.context, `
    const main = (document.getElementById("main")||{innerHTML:""}).innerHTML;
    return { title: P.meta.title, logline: P.meta.logline,
             pending: (window.__cinebraidManualStartPending||{}).slug || "",
             refusal: main.indexOf('data-action-refusal="manual-start"') >= 0 };`);
  /* Scanned across the whole transaction: the certificate goes stale the moment
     the counters move, so the fence flushes A BEFORE the activation — which is
     earlier than the held switch, not after it. */
  const savedBody = background.calls.find((row) => row.method !== "GET"
    && /\/api\/projects\/[^/]+\/project$/.test(row.url)
    && String(row.body).includes("BACKGROUND-MUTATION"));
  ok(savedBody && String(savedBody.body).includes("BACKGROUND-MUTATION"),
    "MODAL-4: A's change was carried through the ordinary save loop, not lost. calls="
    + JSON.stringify(background.calls.map((row) => row.method + " " + row.url)));
  ok(after4.title === "Film B" || after4.refusal === true,
    "MODAL-4: and B either installs only after that save settled, or refuses — never over an unsaved newer A");
  equal(after4.logline === "BACKGROUND-MUTATION" || after4.title === "Film B", true,
    "MODAL-4: the change is never silently discarded");

  /* ---- MODAL-5: an external switch to C still cannot be overwritten. ---- */
  const external = modalHarness();
  external.holdSwitch();
  const extPage = await render("#/create", rawFixture(), { fetch: external.hook });
  await evaluateAsync(extPage.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(extPage.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startPressInFlight(extPage.context);
  await untilFenceUp(extPage);
  external.setActiveProject("film-c");
  external.releaseSwitch();
  await settlePress(extPage.context);
  equal(external.activeProject(), "film-c",
    "MODAL-5: another window's switch to Film C survives — the conditional activation refused");
  equal(evaluate(extPage.context, `return P.meta.title;`), "Render Harness Project",
    "MODAL-5: and the stale prepared Film B did not install");

  /* ---- MODAL-6: success, and the window is editable again afterwards. --- */
  const fast = modalHarness();
  const fastPage = await render("#/create", rawFixture(), { fetch: fast.hook });
  await evaluateAsync(fastPage.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(fastPage.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startPressInFlight(fastPage.context);
  await settlePress(fastPage.context);
  const fastSeen = evaluate(fastPage.context, `return { title: P.meta.title, hash: location.hash,
    fence: interactionFenceActive(), owner: projectTransitionOwner(),
    pending: (window.__cinebraidManualStartPending||{}).slug || "" };`);
  equal(fast.calls.filter((row) => row.url === "/api/projects/new").length, 1, "MODAL-6: one create");
  equal(fast.switchCalls().length, 1, "MODAL-6: one conditional activation");
  equal(fastSeen.title, "Film B", "MODAL-6: the prepared project installed");
  equal(fastSeen.hash, "#/production", "MODAL-6: and the window moved into it");
  equal(fast.activeProject(), "film-b", "MODAL-6: current on the server too");
  equal(fastSeen.fence, false, "MODAL-6: the interaction fence released");
  equal(fastSeen.owner, null, "MODAL-6: and the transaction released its ownership");
  equal(fastSeen.pending, "", "MODAL-6: with nothing left pending");
  const editable = trustedInteraction(fastPage, "click", () => evaluate(fastPage.context, `
    const before = SAVE_REVISION; P.meta.logline = "after the transaction"; dirty();
    return SAVE_REVISION !== before;`));
  equal(editable.delivered, true, "MODAL-6: trusted interaction is delivered again afterwards");

  /* ---- MODAL-7: every failure path releases the fence. ------------------ */
  const failures = [
    /* A refused save needs something to save, or the flush sends nothing and the
       transaction has no reason to stop. */
    ["a refused save",
      (gate) => gate.setSaveStatus(422, { error: "refused", code: "PROJECT_VALIDATION_FAILED" }),
      `P.meta.logline = "an edit that will be refused"; dirty(); return 1;`],
    ["a failed creation", (gate) => gate.setCreateStatus(500), ""],
    ["a failed preparation", (gate) => gate.setPrepareStatus(500), ""],
    ["an activation conflict", (gate) => gate.setActiveProject("film-c"), ""],
  ];
  for (const [label, arrange, pageArrange] of failures) {
    const gate = modalHarness();
    const page = await render("#/create", rawFixture(), { fetch: gate.hook });
    await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
    evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
    if (pageArrange) evaluate(page.context, pageArrange);
    arrange(gate);
    startPressInFlight(page.context);
    await settlePress(page.context);
    const seen = evaluate(page.context, `return {
      fence: interactionFenceActive(), owner: projectTransitionOwner(),
      title: P.meta.title, busy: (document.body.dataset || {}).projectTransition || "" };`);
    equal(seen.fence, false, `MODAL-7 (${label}): the interaction fence released`);
    equal(seen.owner, null, `MODAL-7 (${label}): and the transaction ownership with it`);
    equal(seen.busy, "", `MODAL-7 (${label}): no busy state is left on the window`);
    equal(seen.title, "Render Harness Project", `MODAL-7 (${label}): the truthful current project remains`);
    const usable = trustedInteraction(page, "click", () => 1);
    equal(usable.delivered, true, `MODAL-7 (${label}): and the window accepts interaction again`);
  }

  note("MODAL the commit is modal at the interaction boundary: trusted +Add/Scene-Save/+Project/Settings and their keyboard equivalents are never delivered, so the document is deep-equal before and after and no counter moves because no mutation happened; a background mutation is recorded normally by dirty(), makes the certificate stale and is saved rather than lost; and the fence releases on success and on every failure path");
}

/* ===========================================================================
   QUIET — A REPLACEMENT BEGINS ONLY ON A SAVED AND QUIESCENT PROJECT.

   The interaction fence stops a person STARTING work during a replacement. It
   cannot stop work already running, and independent review found the gap: press
   Blocking → Improve, hold /api/prompt/compile, begin a manual creation, and the
   prompt's continuation lands during the activation round trip —
   `c.blockingBuilds.push(build); … dirty()` — mutating the project the
   replacement is about to install over, taking the completed build with it.

   The lease registry answers the other half. Work that begins against the open
   project, awaits, and can mutate `P` when it resumes holds a lease while it is
   pending, and a replacement will not begin while one is held.

   THE SEAM IS setGuidedPromptOp(), which all six shipped interactive prompt
   builders already call — busy before their await, cleared after their
   continuation has mutated the project. That bracket IS the dangerous window.
   guidedPromptRequest() would have been the wrong place: it returns before its
   caller pushes the build, so a lease released there would report quiescence
   while the mutation was still queued.
   =========================================================================== */

function quietHarness({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let activeProject = sourceSlug;
  let saveStatus = 200;
  let saveBody = null;
  let releaseCompile = null;
  const compileGate = new Promise((r) => { releaseCompile = r; });
  let compileStatus = 200;
  return {
    calls,
    releaseCompile: () => releaseCompile(),
    setCompileStatus(status) { compileStatus = status; },
    setSaveStatus(status, body) { saveStatus = status; saveBody = body || null; },
    setActiveProject(slug) { activeProject = slug; },
    activeProject: () => activeProject,
    creates: () => calls.filter((row) => row.url === "/api/projects/new"),
    switchCalls: () => calls.filter((row) => row.url === "/api/projects/switch"),
    saves: () => calls.filter((row) => row.method !== "GET" && /\/api\/projects\/[^/]+\/project$/.test(row.url)),
    marker() { return calls.length; },
    since(m) { return calls.slice(m); },
    hook: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      const body = String((options && options.body) || "");
      calls.push({ url, method, body });
      /* THE HELD REQUEST — the exact one the reproduction holds. */
      if (url === "/api/prompt/compile") {
        await compileGate;
        if (compileStatus !== 200) return respond({ error: "compile failed" }, compileStatus);
        /* The field the shipped builder actually reads. */
        return respond({ compiledPrompt: "An improved blocking prompt", profileId: "gpt-image-2/t2i", profileName: "GPT Image 2" }, 200);
      }
      if (url === "/api/projects/new") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (request.activate !== false) activeProject = createSlug;
        return respond({ ok: true, slug: createSlug }, 200);
      }
      if (url === "/api/projects/switch") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (Object.prototype.hasOwnProperty.call(request, "expectedActiveProject")
          && String(request.expectedActiveProject || "") !== activeProject) {
          return respond({ ok: false, code: "PROJECT_ACTIVE_CONFLICT", error: "changed", activeProject }, 409);
        }
        activeProject = String(request.slug || activeProject);
        return respond({ ok: true, slug: activeProject }, 200);
      }
      if (method === "GET" && /\/api\/projects\/[^/]+\/project$/.test(url)) {
        const slug = url.split("/")[3];
        const project = rawFixture();
        project.meta.title = slug === createSlug ? "Film B" : "Film C";
        return respond(project, 200, { "x-cinebraid-project-slug": slug, "x-cinebraid-project-revision": `rev-${slug}`, etag: `rev-${slug}` });
      }
      if (method === "GET" && url.startsWith("/api/scan")) {
        return respond({ anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} }, 200);
      }
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
        if (saveStatus === 200) {
          return respond({ ok: true, revision: `rev-${calls.length}` }, 200, { "x-cinebraid-project-revision": `rev-${calls.length}` });
        }
        return respond(saveBody || { error: "refused", code: "PROJECT_VALIDATION_FAILED" }, saveStatus);
      }
      return null;
    },
  };
}

/* Start the SHIPPED Blocking → Improve on the fixture's shot, without awaiting
   it. This is the exact reproduction's first step. */
function startBlockingImprove(page, shotId = "L1-01") {
  return evaluate(page.context, `
    globalThis.__improve = buildBlockingPrompt(${JSON.stringify(shotId)}, true);
    return {
      busy: !!guidedPromptOp("blocking", ${JSON.stringify(shotId)}, ""),
      leases: projectAsyncMutationsInFlight().map((row) => row.label),
    };`);
}
async function untilCompileInFlight(gate) {
  for (let i = 0; i < 400; i++) {
    if (gate.calls.some((row) => row.url === "/api/prompt/compile")) return;
    await tick();
  }
  throw new Error("the prompt compile never reached the wire");
}

async function quiet_projectQuiescence() {
  /* ---- QUIET-1: the exact reproduction, closed. ------------------------- */
  const gate = quietHarness();
  const page = await render("#/create", rawFixture(), { fetch: gate.hook });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);

  const started = startBlockingImprove(page);
  await untilCompileInFlight(gate);
  equal(started.busy, true, "QUIET-1: Blocking → Improve is running");
  equal(started.leases.join("|"), "Blocking prompt improvement",
    "QUIET-1: and it holds a named project-mutation lease while it is pending");

  const buildsBefore = evaluate(page.context, `
    return ensureShotCreation(shotById("L1-01")).blockingBuilds.length;`);
  const marker = gate.marker();
  await evaluateAsync(page.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    await startManualProject();
    return 1;`);

  const refusedSeen = evaluate(page.context, `
    const main = (document.getElementById("main")||{innerHTML:""}).innerHTML;
    return { title: P.meta.title, hash: location.hash,
             fence: interactionFenceActive(),
             stillBusy: !!guidedPromptOp("blocking", "L1-01", ""),
             pending: (window.__cinebraidManualStartPending||{}).slug || "",
             refusal: main.indexOf('data-action-refusal="manual-start"') >= 0,
             refusalText: (main.split("CineBraid did not make this change</b><span>")[1]||"").split("</span>")[0] };`);
  equal(gate.since(marker).filter((row) => row.url === "/api/projects/new").length, 0,
    "QUIET-1: no project was created while the operation was pending");
  equal(gate.since(marker).filter((row) => row.url === "/api/projects/switch").length, 0,
    "QUIET-1: and nothing was activated");
  equal(refusedSeen.title, "Render Harness Project", "QUIET-1: Film A remains current");
  equal(refusedSeen.pending, "", "QUIET-1: nothing is left pending, because nothing was created");
  equal(refusedSeen.fence, false, "QUIET-1: and the interaction fence released");
  equal(refusedSeen.stillBusy, true, "QUIET-1: the pending operation is still alive — it was not cancelled");
  equal(refusedSeen.refusal, true, "QUIET-1: the refusal is persistent");
  ok(/Blocking prompt improvement is still running/.test(refusedSeen.refusalText),
    "QUIET-1: and NAMES the operation: " + refusedSeen.refusalText);

  /* THE RESPONSE LANDS, and the build is recorded normally. */
  gate.releaseCompile();
  await evaluateAsync(page.context, `try { await globalThis.__improve; } catch {} return 1;`);
  const landed = evaluate(page.context, `
    return { builds: ensureShotCreation(shotById("L1-01")).blockingBuilds.length,
             leases: projectAsyncMutationsInFlight().length,
             settled: projectSaveSettled().settled };`);
  ok(landed.builds > buildsBefore, "QUIET-1: the build mutated Film A normally when the response landed");
  equal(landed.leases, 0, "QUIET-1: and its lease was released");
  equal(landed.settled, false, "QUIET-1: dirty() recorded it, so the window is truthfully unsaved");

  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  const saved = gate.saves().find((row) => String(row.body).includes("An improved blocking prompt"));
  ok(saved, "QUIET-1: the build reached durable storage");
  equal(evaluate(page.context, `return projectSaveSettled().settled;`), true, "QUIET-1: and Film A is Saved again");

  /* NOW the creation proceeds normally. */
  const marker2 = gate.marker();
  await evaluateAsync(page.context, `
    setManualStartField("title", "Film B");
    await startManualProject();
    return 1;`);
  equal(gate.since(marker2).filter((row) => row.url === "/api/projects/new").length, 1,
    "QUIET-1: once saved and quiescent, the retry creates the project");
  equal(evaluate(page.context, `return P.meta.title;`), "Film B", "QUIET-1: and it opens");

  /* ---- QUIET-2: the completion's save is refused. ----------------------- */
  const refusedGate = quietHarness();
  const page2 = await render("#/create", rawFixture(), { fetch: refusedGate.hook });
  await evaluateAsync(page2.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page2.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startBlockingImprove(page2);
  await untilCompileInFlight(refusedGate);
  refusedGate.setSaveStatus(422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" });
  refusedGate.releaseCompile();
  await evaluateAsync(page2.context, `try { await globalThis.__improve; } catch {} return 1;`);
  await evaluateAsync(page2.context, `await flushPendingProjectSave(); return 1;`);

  const afterRefusal = evaluate(page2.context, `
    return { builds: ensureShotCreation(shotById("L1-01")).blockingBuilds.length,
             blocked: SAVE_BLOCKED, settled: projectSaveSettled().settled };`);
  ok(afterRefusal.builds > 0, "QUIET-2: the build is on Film A");
  equal(afterRefusal.blocked, true, "QUIET-2: and its save was refused");
  const marker3 = refusedGate.marker();
  await evaluateAsync(page2.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    await startManualProject();
    return 1;`);
  equal(refusedGate.since(marker3).filter((row) => row.url === "/api/projects/new").length, 0,
    "QUIET-2: creation still does not begin");
  const stillA = evaluate(page2.context, `
    return { title: P.meta.title, builds: ensureShotCreation(shotById("L1-01")).blockingBuilds.length,
             blocked: SAVE_BLOCKED };`);
  equal(stillA.title, "Render Harness Project", "QUIET-2: Film A remains current");
  equal(stillA.builds, afterRefusal.builds, "QUIET-2: the build remains");
  equal(stillA.blocked, true, "QUIET-2: and the refusal remains");

  /* ---- QUIET-3: no check → lock gap. ------------------------------------ */
  const orderGate = quietHarness();
  const page3 = await render("#/create", rawFixture(), { fetch: orderGate.hook });
  await evaluateAsync(page3.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page3.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  const ordering = evaluate(page3.context, `
    /* The fence must already own the window by the time quiescence is read, so
       there is no instant at which both a new job and the transaction are
       admitted. Observed from inside the same synchronous stretch. */
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    const seen = [];
    const originalBegin = window.beginProjectAsyncMutation;
    window.beginProjectAsyncMutation = (label, key) => {
      seen.push({ label, fenceUp: interactionFenceActive() });
      return originalBegin(label, key);
    };
    globalThis.__press = startManualProject();
    /* A trusted press cannot arrive here — the fence is up — but a job that
       tried would find it already owned. */
    const fenceAtCheck = interactionFenceActive();
    window.beginProjectAsyncMutation = originalBegin;
    return { fenceAtCheck, seen };`);
  equal(ordering.fenceAtCheck, true,
    "QUIET-3: the interaction fence owns the window before quiescence is acted on — no gap to slip a job into");
  await evaluateAsync(page3.context, `try { await globalThis.__press; } catch {} return 1;`);
  /* And the reverse ordering: a job that starts FIRST makes the creation refuse. */
  const raceGate = quietHarness();
  const page3b = await render("#/create", rawFixture(), { fetch: raceGate.hook });
  await evaluateAsync(page3b.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page3b.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  startBlockingImprove(page3b);
  await untilCompileInFlight(raceGate);
  const marker4 = raceGate.marker();
  await evaluateAsync(page3b.context, `
    setCreationStartPath("scratch"); setManualStartField("title", "Film B");
    await startManualProject(); return 1;`);
  equal(raceGate.since(marker4).filter((row) => row.url === "/api/projects/new").length, 0,
    "QUIET-3: and when the job wins the race, the creation refuses — never both");
  raceGate.releaseCompile();
  await evaluateAsync(page3b.context, `try { await globalThis.__improve; } catch {} return 1;`);

  /* ---- QUIET-4: two leases, one released. ------------------------------- */
  const twoPage = await render("#/create", rawFixture());
  const two = evaluate(twoPage.context, `
    const a = beginProjectAsyncMutation("Frame prompt compilation", "frame:L1-01:frame-a");
    const b = beginProjectAsyncMutation("Motion prompt compilation", "motion:L1-01:");
    const both = projectQuiescenceRefusal();
    a.release();
    const afterOne = projectQuiescenceRefusal();
    b.release();
    const afterBoth = projectQuiescenceRefusal();
    return { both, afterOne, afterBoth };`);
  ok(two.both.length > 0, "QUIET-4: two pending operations block a creation");
  ok(two.afterOne.length > 0, "QUIET-4: releasing one is not quiescence");
  equal(two.afterBoth, "", "QUIET-4: only when both are released is the project quiet");

  /* ---- QUIET-5: every failure path releases its lease. ------------------ */
  for (const [label, arrange] of [
    ["a rejected request", (g) => g.setCompileStatus(500)],
    ["a successful request", () => {}],
  ]) {
    const failGate = quietHarness();
    arrange(failGate);
    const failPage = await render("#/create", rawFixture(), { fetch: failGate.hook });
    startBlockingImprove(failPage);
    await untilCompileInFlight(failGate);
    equal(evaluate(failPage.context, `return projectAsyncMutationsInFlight().length;`), 1,
      `QUIET-5 (${label}): the lease is held while pending`);
    failGate.releaseCompile();
    await evaluateAsync(failPage.context, `try { await globalThis.__improve; } catch {} return 1;`);
    equal(evaluate(failPage.context, `return projectAsyncMutationsInFlight().length;`), 0,
      `QUIET-5 (${label}): and released afterwards — a failure never leaves CineBraid believing the project is busy`);
    equal(evaluate(failPage.context, `return projectQuiescenceRefusal();`), "",
      `QUIET-5 (${label}): so the project reports itself quiet again`);
  }
  /* A continuation that throws must release too. */
  const throwPage = await render("#/create", rawFixture());
  const threw = evaluate(throwPage.context, `
    const lease = beginProjectAsyncMutation("A prompt compilation", "k");
    let caught = false;
    try { try { throw new Error("continuation failed"); } finally { lease.release(); } }
    catch { caught = true; }
    return { caught, inFlight: projectAsyncMutationsInFlight().length };`);
  equal(threw.caught, true, "QUIET-5: a throwing continuation still propagates");
  equal(threw.inFlight, 0, "QUIET-5: and its lease is released by the finally");

  /* ---- QUIET-6: read-only asynchronous work does not block. ------------- */
  const readPage = await render("#/create", rawFixture(), { fetch: quietHarness().hook });
  const readOnly = await evaluateAsync(readPage.context, `
    const before = projectAsyncMutationsInFlight().length;
    /* A poll and a plain read: neither can mutate P when it resumes, so neither
       takes a lease. */
    await fetch("/api/scan");
    await fetch("/api/config");
    return { before, after: projectAsyncMutationsInFlight().length, refusal: projectQuiescenceRefusal() };`);
  equal(readOnly.after, readOnly.before, "QUIET-6: read-only asynchronous work takes no lease");
  equal(readOnly.refusal, "", "QUIET-6: and does not prevent a creation");

  /* ---- QUIET-7: the fast path is unchanged. ----------------------------- */
  const fast = quietHarness();
  const fastPage = await render("#/create", rawFixture(), { fetch: fast.hook });
  await evaluateAsync(fastPage.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(fastPage.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  equal(evaluate(fastPage.context, `return projectQuiescenceRefusal();`), "",
    "QUIET-7: with nothing pending the project is quiescent");
  await evaluateAsync(fastPage.context, `
    setCreationStartPath("scratch"); setManualStartField("title", "Film B");
    await startManualProject(); return 1;`);
  const fastSeen = evaluate(fastPage.context, `return { title: P.meta.title, hash: location.hash,
    fence: interactionFenceActive(), leases: projectAsyncMutationsInFlight().length };`);
  equal(fast.creates().length, 1, "QUIET-7: one create");
  equal(fast.switchCalls().length, 1, "QUIET-7: one conditional activation");
  equal(fastSeen.title, "Film B", "QUIET-7: one synchronous install");
  equal(fastSeen.hash, "#/production", "QUIET-7: and the window moves into it");
  equal(fastSeen.fence, false, "QUIET-7: with the fence released");
  equal(fastSeen.leases, 0, "QUIET-7: and no lease left behind");

  note("QUIET a replacement begins only on a saved AND quiescent project: the shipped Blocking → Improve holds a named lease across its whole operation, a creation attempted while it is pending refuses without cancelling it, the build then lands, saves and lets the retry succeed; a refused completion keeps the refusal and still blocks; the fence takes the window before quiescence is read so there is no gap; leases release on success, failure and a throwing continuation; and read-only work never blocks");
}
/* ===========================================================================
   AUDIO — THE ONE UNCOVERED ASYNC CONTINUATION, CLOSED.

   The finite closure review enumerated the shipped continuations that can mutate
   `P` after an await and returned a single uncovered row:
   buildSceneAudioPrompts(). BUILD / IMPROVE WITH AI posts to
   /api/llm/build-scene-audio-prompts, awaits the assistant, and then writes the
   scene's music, Suno, ambience and notes fields, pushes a promptBuilds entry and
   calls dirty(). It took no lease, so a manual creation begun while it was
   pending proceeded and Film B installed over the completed audio build.

   It does not go through setGuidedPromptOp(), so it takes the same lease from the
   same registry directly. Nothing else about B1 changes.
   =========================================================================== */

function audioHarness({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let activeProject = sourceSlug;
  let saveStatus = 200;
  let saveBody = null;
  let releaseAudio = null;
  const audioGate = new Promise((r) => { releaseAudio = r; });
  let audioStatus = 200;
  return {
    calls,
    releaseAudio: () => releaseAudio(),
    setAudioStatus(status) { audioStatus = status; },
    setSaveStatus(status, body) { saveStatus = status; saveBody = body || null; },
    activeProject: () => activeProject,
    creates: () => calls.filter((row) => row.url === "/api/projects/new"),
    switchCalls: () => calls.filter((row) => row.url === "/api/projects/switch"),
    saves: () => calls.filter((row) => row.method !== "GET" && /\/api\/projects\/[^/]+\/project$/.test(row.url)),
    marker() { return calls.length; },
    since(m) { return calls.slice(m); },
    hook: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      const body = String((options && options.body) || "");
      calls.push({ url, method, body });
      /* THE HELD REQUEST — the exact one the reproduction holds. */
      if (url === "/api/llm/build-scene-audio-prompts") {
        await audioGate;
        if (audioStatus !== 200) return respond({ error: "The assistant was unavailable." }, audioStatus);
        return respond({
          result: {
            elevenLabsPrompt: "AUDIO-MUSIC-RESULT",
            sunoPrompt: "AUDIO-SUNO-RESULT",
            ambiencePrompt: "AUDIO-AMBIENCE-RESULT",
            audioNotes: "AUDIO-NOTES-RESULT",
            summary: "Model-ready scene audio prompts created.",
            changes: ["Music prompt rewritten"],
          },
        }, 200);
      }
      if (url === "/api/projects/new") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (request.activate !== false) activeProject = createSlug;
        return respond({ ok: true, slug: createSlug }, 200);
      }
      if (url === "/api/projects/switch") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (Object.prototype.hasOwnProperty.call(request, "expectedActiveProject")
          && String(request.expectedActiveProject || "") !== activeProject) {
          return respond({ ok: false, code: "PROJECT_ACTIVE_CONFLICT", error: "changed", activeProject }, 409);
        }
        activeProject = String(request.slug || activeProject);
        return respond({ ok: true, slug: activeProject }, 200);
      }
      if (method === "GET" && /\/api\/projects\/[^/]+\/project$/.test(url)) {
        const slug = url.split("/")[3];
        const project = rawFixture();
        project.meta.title = slug === createSlug ? "Film B" : "Film C";
        return respond(project, 200, { "x-cinebraid-project-slug": slug, "x-cinebraid-project-revision": `rev-${slug}`, etag: `rev-${slug}` });
      }
      if (method === "GET" && url.startsWith("/api/scan")) {
        return respond({ anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} }, 200);
      }
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
        if (saveStatus === 200) {
          return respond({ ok: true, revision: `rev-${calls.length}` }, 200, { "x-cinebraid-project-revision": `rev-${calls.length}` });
        }
        return respond(saveBody || { error: "refused", code: "PROJECT_VALIDATION_FAILED" }, saveStatus);
      }
      return null;
    },
  };
}
async function untilAudioInFlight(gate) {
  for (let i = 0; i < 400; i++) {
    if (gate.calls.some((row) => row.url === "/api/llm/build-scene-audio-prompts")) return;
    await tick();
  }
  throw new Error("the scene audio request never reached the wire");
}
const sceneAudioOf = (context, sceneId) => evaluate(context, `
  const scene = sceneById(${JSON.stringify(sceneId)}) || {};
  const audio = scene.audio || {};
  return { music: audio.music || "", suno: audio.sunoAltPrompt || "",
           ambience: audio.ambience || "", notes: audio.notes || "",
           builds: (audio.promptBuilds || []).length };`);

async function audio_sceneAudioQuiescence() {
  const sceneId = "SC-01";

  /* ---- AUDIO-1: the exact reproduction, closed. ------------------------- */
  const gate = audioHarness();
  const page = await render("#/create", rawFixture(), { fetch: gate.hook });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  const before = sceneAudioOf(page.context, sceneId);

  /* THE SHIPPED CONTINUATION, started and left pending. */
  const started = evaluate(page.context, `
    globalThis.__audio = buildSceneAudioPrompts(${JSON.stringify(sceneId)});
    return { leases: projectAsyncMutationsInFlight().map((row) => row.label) };`);
  await untilAudioInFlight(gate);
  equal(started.leases.join("|"), "Scene audio prompt building",
    "AUDIO-1: the scene audio build holds a named project-mutation lease before its request is pending");
  const quiescence = evaluate(page.context, `return projectQuiescenceRefusal();`);
  ok(/Scene audio prompt building is still running/.test(quiescence),
    "AUDIO-1: and quiescence reports THAT operation by name: " + quiescence);

  const marker = gate.marker();
  await evaluateAsync(page.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    await startManualProject();
    return 1;`);
  const refusedSeen = evaluate(page.context, `
    const main = (document.getElementById("main")||{innerHTML:""}).innerHTML;
    return { title: P.meta.title, slug: ACTIVE_PROJECT_SLUG, fence: interactionFenceActive(),
             pending: (window.__cinebraidManualStartPending||{}).slug || "",
             refusalText: (main.split("CineBraid did not make this change</b><span>")[1]||"").split("</span>")[0] };`);
  equal(gate.since(marker).filter((row) => row.url === "/api/projects/new").length, 0,
    "AUDIO-1: Film B is not created while the audio build is pending");
  equal(gate.since(marker).filter((row) => row.url === "/api/projects/switch").length, 0,
    "AUDIO-1: and nothing is activated");
  equal(refusedSeen.title, "Render Harness Project", "AUDIO-1: Film A remains current");
  equal(refusedSeen.pending, "", "AUDIO-1: nothing is left pending, because nothing was created");
  equal(refusedSeen.fence, false, "AUDIO-1: the interaction fence released");
  ok(/Scene audio prompt building is still running/.test(refusedSeen.refusalText),
    "AUDIO-1: and the refusal names the audio operation: " + refusedSeen.refusalText);
  equal(evaluate(page.context, `return projectAsyncMutationsInFlight().length;`), 1,
    "AUDIO-1: the pending audio work is still alive — it was not cancelled");

  /* THE RESPONSE LANDS. */
  gate.releaseAudio();
  await evaluateAsync(page.context, `try { await globalThis.__audio; } catch {} return 1;`);
  const after = sceneAudioOf(page.context, sceneId);
  equal(after.music, "AUDIO-MUSIC-RESULT", "AUDIO-1: the music prompt was written to Film A");
  equal(after.suno, "AUDIO-SUNO-RESULT", "AUDIO-1: the Suno prompt too");
  equal(after.ambience, "AUDIO-AMBIENCE-RESULT", "AUDIO-1: the ambience prompt too");
  equal(after.notes, "AUDIO-NOTES-RESULT", "AUDIO-1: and the audio notes");
  equal(after.builds, before.builds + 1, "AUDIO-1: with a promptBuilds record");
  const saved = gate.saves().find((row) => String(row.body).includes("AUDIO-MUSIC-RESULT"));
  ok(saved, "AUDIO-1: dirty() recorded it and the mutation reached storage");
  equal(evaluate(page.context, `return projectAsyncMutationsInFlight().length;`), 0,
    "AUDIO-1: the lease clears only afterwards");
  equal(evaluate(page.context, `return projectQuiescenceRefusal();`), "",
    "AUDIO-1: so the project is quiescent again");

  /* AND THE RETRY SUCCEEDS. */
  const marker2 = gate.marker();
  await evaluateAsync(page.context, `
    setManualStartField("title", "Film B");
    await startManualProject();
    return 1;`);
  equal(gate.since(marker2).filter((row) => row.url === "/api/projects/new").length, 1,
    "AUDIO-1: once saved and quiescent, the retry creates the project");
  equal(evaluate(page.context, `return P.meta.title;`), "Film B", "AUDIO-1: and Film B opens");

  /* ---- AUDIO-2: the completion's save is refused. ----------------------- */
  for (const [label, status, body] of [
    ["a 409", 409, { error: "This project changed in storage.", code: "PROJECT_REVISION_CONFLICT" }],
    ["a 422", 422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" }],
  ]) {
    const refusedGate = audioHarness();
    const page2 = await render("#/create", rawFixture(), { fetch: refusedGate.hook });
    await evaluateAsync(page2.context, `await flushPendingProjectSave(); return 1;`);
    evaluate(page2.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
    evaluate(page2.context, `globalThis.__audio = buildSceneAudioPrompts(${JSON.stringify(sceneId)}); return 1;`);
    await untilAudioInFlight(refusedGate);
    refusedGate.setSaveStatus(status, body);
    refusedGate.releaseAudio();
    await evaluateAsync(page2.context, `try { await globalThis.__audio; } catch {} return 1;`);

    const audioAfter = sceneAudioOf(page2.context, sceneId);
    equal(audioAfter.music, "AUDIO-MUSIC-RESULT", `AUDIO-2 (${label}): the audio result is on Film A`);
    equal(evaluate(page2.context, `return projectSaveSettled().settled;`), false,
      `AUDIO-2 (${label}): and its save was refused`);
    equal(evaluate(page2.context, `return projectAsyncMutationsInFlight().length;`), 0,
      `AUDIO-2 (${label}): the lease released even though the save was refused`);

    const marker3 = refusedGate.marker();
    await evaluateAsync(page2.context, `
      setCreationStartPath("scratch"); setManualStartField("title", "Film B");
      await startManualProject(); return 1;`);
    equal(refusedGate.since(marker3).filter((row) => row.url === "/api/projects/new").length, 0,
      `AUDIO-2 (${label}): creation remains blocked — by the save refusal, not by a stranded lease`);
    const stillA = evaluate(page2.context, `
      const main = (document.getElementById("main")||{innerHTML:""}).innerHTML;
      return { title: P.meta.title, settled: projectSaveSettled().settled,
               refusal: main.indexOf('data-action-refusal="manual-start"') >= 0 };`);
    equal(stillA.title, "Render Harness Project", `AUDIO-2 (${label}): Film A remains current`);
    equal(sceneAudioOf(page2.context, sceneId).music, "AUDIO-MUSIC-RESULT",
      `AUDIO-2 (${label}): the audio result remains`);
    equal(stillA.settled, false, `AUDIO-2 (${label}): the refusal remains truthful`);
    equal(stillA.refusal, true, `AUDIO-2 (${label}): and is on screen`);
  }

  /* ---- AUDIO-3: a failed build releases its lease. ---------------------- */
  const failGate = audioHarness();
  failGate.setAudioStatus(503);
  const page3 = await render("#/create", rawFixture(), { fetch: failGate.hook });
  evaluate(page3.context, `globalThis.__audio = buildSceneAudioPrompts(${JSON.stringify(sceneId)}); return 1;`);
  await untilAudioInFlight(failGate);
  equal(evaluate(page3.context, `return projectAsyncMutationsInFlight().length;`), 1,
    "AUDIO-3: the lease is held while the request is pending");
  failGate.releaseAudio();
  await evaluateAsync(page3.context, `try { await globalThis.__audio; } catch {} return 1;`);
  equal(evaluate(page3.context, `return projectAsyncMutationsInFlight().length;`), 0,
    "AUDIO-3: and a refused build releases it — a failure never blocks creation forever");
  equal(evaluate(page3.context, `return projectQuiescenceRefusal();`), "",
    "AUDIO-3: so the project reports itself quiescent again");

  note("AUDIO the scene audio prompt builder takes the same project-mutation lease before its request is pending and holds it across the response, every field it writes, its promptBuilds record, dirty() and the save: a creation attempted meanwhile is refused by name without cancelling it, the result then lands and reaches storage, the retry succeeds, a refused save keeps the result and the refusal, and a failed build releases the lease");
}
async function main() {
  await b1_createRequiresConfirmedSave();
  await b2_manualStartIsolation();
  await b3_wholeReferenceDeletion();
  await b1race_replacementFence();
  await active_serverSeparatesCreationFromActivation();
  await active_clientActivatesOnlyOnCommit();
  await final_b1_atomicReplacement();
  await modal_commitIsModal();
  await quiet_projectQuiescence();
  await audio_sceneAudioQuiescence();
  console.log(`AT1 boundary corrections: ${checks} checks passed`);
  for (const line of notes) console.log("  - " + line);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
