/* CineBraid — AT1 BOUNDARY CORRECTIONS: NEGATIVE CONTROLS.
 *
 * Three corrections, three reverts. Each control below puts the SHIPPED defect
 * back by mutating the shipped source at a named anchor, proves the defect is
 * genuinely visible in the mutated build, and then proves the guarantee in
 * tests/at1-boundary-corrections.js GOES RED against it.
 *
 * A guarantee that stays green when its defect is restored is not a guarantee.
 * mustFail() fails loudly when that happens, and anchorIn() fails loudly when a
 * control stops mutating the live path — so a rewrite that moves the code cannot
 * quietly turn these into no-ops.
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
function ok(value, message) { checks += 1; assert.ok(value, message); }
function equal(actual, expected, message) { checks += 1; assert.strictEqual(actual, expected, message); }
const clone = (value) => JSON.parse(JSON.stringify(value));
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
/* Comments are stripped for every "is that shape still there?" question: the
   note explaining a rule NAMES what the rule forbids, and a structural check
   that trips over its own documentation proves nothing. */
const codeOnly = (source) => String(source).replace(/\/\*[\s\S]*?\*\//g, "");
function evaluate(context, body) { return vm.runInContext(`(() => { ${body} })()`, context); }
function evaluateAsync(context, body) { return vm.runInContext(`(async () => { ${body} })()`, context); }
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function anchorIn(file, needle, label, expected = 1) {
  const hits = readLF(file).split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor in ${file}, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
}
function replacing(file, needle, replacement) {
  return (name, contents) => {
    if (name !== file) return contents;
    return String(contents).replace(/\r\n/g, "\n").split(needle).join(replacement);
  };
}
async function mustFail(label, because, body) {
  checks += 1;
  let failure = null;
  try { await body(); } catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
}
function persist(project, successor) {
  let stored = clone(project);
  let writes = 0;
  const revision = () => JSON.stringify(crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex"));
  const boundary = seam.createAuthorityWriteSeam({
    resolveFile: () => "project.json", exists: () => true,
    readProject: () => clone(stored), revisionFor: revision,
    validateProject: () => ({ ok: true, errors: [] }),
    writeProject: (_file, next) => { stored = clone(next); writes += 1; },
  });
  const outcome = boundary.persistProjectSuccessor({
    slug: "p", successor, writeClass: seam.WRITE_CLASSES.NORMAL_SAVE,
    expectedRevision: revision(), transitionMetadata: {},
  });
  return { outcome, writes };
}

/* ===========================================================================
   NC-B1 — RESTORE "A RESOLVED FLUSH MEANS SAVED".

   The shipped defect: startManualProjectCommit() proceeded on the flush promise
   resolving. 409 resolves. So creation happened on top of a refused save.
   =========================================================================== */

const NC1_ANCHOR = `  const settled = typeof projectSaveSettled === "function" ? projectSaveSettled() : { settled: true };`;
const NC1_BREAK = `  const settled = { settled: true };`;

async function nc_b1_resolvedFlushIsNotSaved() {
  anchorIn("public/creation-studio.js", NC1_ANCHOR, "NC-B1");

  const calls = [];
  const hook = async (url, options, respond) => {
    calls.push({ url, method: (options && options.method) || "GET" });
    if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
      return respond({ error: "This project changed in storage.", code: "PROJECT_REVISION_CONFLICT" }, 409);
    }
    if (url === "/api/projects/new") return respond({ slug: "new-project", title: "Created" }, 200);
    return null;
  };

  const page = await render("#/create", rawFixture(), {
    fetch: hook,
    mutateSource: replacing("creation-studio.js", NC1_ANCHOR, NC1_BREAK),
  });
  const seen = await evaluateAsync(page.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "The New Film");
    P.meta.logline = "An unrelated logline typed before pressing create";
    dirty();
    let threw = false;
    try { await flushPendingProjectSave(); } catch { threw = true; }
    const refused = PROJECT_CONFLICT;
    await startManualProject();
    return { threw, refused };
  `);

  /* THE DEFECT IS GENUINELY VISIBLE IN THE MUTATED BUILD. */
  equal(seen.threw, false, "NC-B1: the 409 save resolves — there is no exception, which is the whole premise");
  equal(seen.refused, true, "NC-B1: and the view is genuinely conflicted afterwards");
  const created = calls.filter((row) => row.url === "/api/projects/new").length;
  equal(created, 1, "NC-B1 REPRODUCED: the reverted build creates a project on top of a refused save");

  /* AND THE GUARANTEE GOES RED AGAINST IT. */
  await mustFail("NC-B1", "no POST to /api/projects/new occurred", async () => {
    equal(created, 0, "no POST to /api/projects/new occurred");
  });

  note("NC-B1 reverting the positive-save guard lets a 409-refused save be followed by a real project creation; the B1 guarantee fails against that build");
}

/* ===========================================================================
   NC-B2 — PUT AN OPEN-PROJECT WRITER BACK ON THE CREATE SCREEN.

   The shipped defect: Project Look sat below the identity card and wrote P.meta
   through setGlobalCreationField(), which calls dirty().
   =========================================================================== */

const NC2_ANCHOR = `  <p class="creation-path-handoff" data-manual-after-create>`;
const NC2_BREAK = `  <details id="creation-global-style" data-manual-next><summary>Project Look</summary><textarea onchange="setGlobalCreationField('globalStylePrompt',this.value)"></textarea></details>
  <p class="creation-path-handoff" data-manual-after-create>`;

async function nc_b2_openProjectWriterReturns() {
  anchorIn("public/creation-studio.js", NC2_ANCHOR, "NC-B2");

  const project = rawFixture();
  project.meta.title = "Film A";
  const page = await render("#/create", project, {
    mutateSource: replacing("creation-studio.js", NC2_ANCHOR, NC2_BREAK),
  });
  const seen = evaluate(page.context, `
    setCreationStartPath("scratch");
    route();
    const main = (document.getElementById("main") || { innerHTML: "" }).innerHTML;
    const before = JSON.stringify(P);
    const revisionBefore = SAVE_REVISION;
    /* The filmmaker edits the style on the CREATE screen. */
    setGlobalCreationField("globalStylePrompt", "Cold industrial naturalism");
    return {
      main,
      changed: JSON.stringify(P) !== before,
      style: P.meta.globalStylePrompt,
      revisionMoved: SAVE_REVISION !== revisionBefore,
      hasStyleCard: main.indexOf('id="creation-global-style"') >= 0,
      handlers: (main.match(/on(?:change|click)="([^"]+)"/g) || []).map((row) => row.slice(row.indexOf('"') + 1, -1)),
    };
  `);

  /* THE DEFECT IS GENUINELY VISIBLE. */
  equal(seen.hasStyleCard, true, "NC-B2 REPRODUCED: Project Look is back on the create screen");
  equal(seen.changed, true, "NC-B2 REPRODUCED: and editing it changed the project that was already open");
  equal(seen.style, "Cold industrial naturalism", "NC-B2 REPRODUCED: with the value written into P.meta");
  equal(seen.revisionMoved, true, "NC-B2 REPRODUCED: and the open project's dirty revision moved, so it would be SAVED");

  /* AND THE GUARANTEE GOES RED AGAINST IT. */
  const forbidden = seen.handlers.filter((handler) => /setGlobalCreationField\s*\(/.test(handler));
  await mustFail("NC-B2", "no rendered handler on the manual creation surface reaches an open-project writer", async () => {
    equal(forbidden.length, 0,
      "no rendered handler on the manual creation surface reaches an open-project writer: " + JSON.stringify(forbidden));
  });

  note("NC-B2 restoring a single setGlobalCreationField control to the manual creation surface edits the open film and advances its dirty revision; the B2 isolation assertion fails against that build");
}

/* ===========================================================================
   NC-B3 — REMOVE THE PLAN-FIRST REVOCATION FROM WHOLE-REFERENCE DELETION.

   The shipped defect: delEntity() spliced the entity out while its receipts were
   still current, and the document could not be saved afterwards.
   =========================================================================== */

const NC3_ANCHOR = `      const plan = planEntityCanonWithdrawal(list, entity);`;
const NC3_BREAK = `      const plan = { withdraw: [], blocked: [], available: true };`;

async function nc_b3_deletionWithoutRevocation() {
  anchorIn("public/mutations.js", NC3_ANCHOR, "NC-B3");

  const project = rawFixture();
  const entity = project.characters[0];
  entity.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: entity.approvedFile || "KAI-ANCHOR.png" },
    { id: "state-rain", name: "Rain-soaked", isDefault: false, parentStateId: "state-default", approvedFile: "KAI-RAIN.png" },
  ];
  withCanon(project, [{
    kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain", value: "KAI-RAIN.png",
  }]);
  equal(Kernel.hasCurrentHumanAuthority(project, {
    kind: "entity-state", list: "characters", entityId: entity.id, stateId: "state-rain",
  }), true, "NC-B3 precondition: the state holds current Canon before the deletion");

  const page = await render(`#/character/${entity.id}`, project, {
    mutateSource: replacing("mutations.js", NC3_ANCHOR, NC3_BREAK),
  });
  evaluate(page.context, `delEntity("characters", ${JSON.stringify(entity.id)}); return 1;`);
  await tick();
  const seen = page.gesture.act(() => evaluate(page.context, `
    document.getElementById("delete-entity-confirm").onclick();
    const receipt = (P.productionAuthority.receipts || []).find((row) => row.stateId === "state-rain");
    return {
      entityGone: !P.characters.some((row) => row.id === ${JSON.stringify(entity.id)}),
      receiptStatus: receipt ? receipt.status : "",
      after: JSON.parse(JSON.stringify(P)),
    };
  `));

  /* THE DEFECT IS GENUINELY VISIBLE: the entity is gone, the receipt is not. */
  equal(seen.entityGone, true, "NC-B3 REPRODUCED: the reverted build removes the reference");
  equal(seen.receiptStatus, "current",
    "NC-B3 REPRODUCED: and leaves its receipt current, naming a target that no longer exists");

  /* AND THAT IS EXACTLY WHAT STRANDS THE DOCUMENT. Asked of the real seam. */
  const stranded = persist(project, seen.after);
  equal(stranded.outcome.ok, false, "NC-B3 REPRODUCED: the resulting document cannot be saved");
  equal(stranded.writes, 0, "NC-B3 REPRODUCED: with zero writes");
  const strandedCode = String((stranded.outcome.refusal || {}).code || "");
  ok(/CANON_TRANSITION_REQUIRED|AUTHORITY_EDGE_RECEIPT_MISMATCH/.test(strandedCode),
    "NC-B3 REPRODUCED: refused by the authority write seam: " + strandedCode
    + " — " + String((stranded.outcome.refusal || {}).message || ""));

  /* AND THE CANON-TRANSITION CLASS REFUSES IT TOO, which is what "zero writes"
     meant in the reproduction: neither write class can store this document. */
  const asTransition = (() => {
    let stored = clone(project); let writes = 0;
    const revision = () => JSON.stringify(crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex"));
    const boundary = seam.createAuthorityWriteSeam({
      resolveFile: () => "project.json", exists: () => true,
      readProject: () => clone(stored), revisionFor: revision,
      validateProject: () => ({ ok: true, errors: [] }),
      writeProject: (_file, next) => { stored = clone(next); writes += 1; },
    });
    const outcome = boundary.persistProjectSuccessor({
      slug: "p", successor: seen.after, writeClass: seam.WRITE_CLASSES.CANON_TRANSITION,
      expectedRevision: revision(), transitionMetadata: {},
    });
    return { outcome, writes };
  })();
  equal(asTransition.outcome.ok, false, "NC-B3 REPRODUCED: the Canon-transition class refuses it as well");
  equal(asTransition.writes, 0, "NC-B3 REPRODUCED: also with zero writes");

  /* AND THE GUARANTEE GOES RED AGAINST IT. */
  await mustFail("NC-B3", "the document saves through the real seam", async () => {
    equal(stranded.outcome.ok, true, "the document saves through the real seam");
  });

  note("NC-B3 removing the plan-first revocation orphans the receipt and the real write seam refuses the document with zero writes; the B3 guarantee fails against that build");
}

/* ===========================================================================
   NC-B1R — THE REPLACEMENT FENCE, REVERTED THREE WAYS.

   The founder's requirement is that this suite fail if anyone reintroduces
   `save once -> POST -> unconditional load`, and also that it fail for the two
   weaker fences that look like a fix and are not. All three mutate the SAME
   anchor — the one line that decides whether the replacement may proceed — so
   there is exactly one place a future rewrite has to keep honest.
   =========================================================================== */

/* THE DECISION EXPRESSION, EVERYWHERE IT IS ASKED.
 *
 * The commit now validates the certificate TWICE — once when the create response
 * lands, and once after the activation round trip — so a control that broke only
 * the first would be caught by the second and would never fire. The anchor is
 * therefore the shared call itself, and every site is mutated: that is what makes
 * these controls reproduce the defect rather than a half of it. */
const NCR_ANCHOR = `createReplacementRefusal(certificate)`;
const NCR_SITES = 2;
/* 1. NO VALIDATION AT ALL. This is the shipped defect: the pre-POST verdict is
      treated as a permit to replace, later. */
const NCR_UNCONDITIONAL = `""`;
/* 2. A BOOLEAN, RE-ASKED, BUT NOT TIED TO WHICH PROJECT IT IS ABOUT. */
const NCR_BOOLEAN_ONLY = `(projectSaveSettled().settled ? "" : "the project you have open is not saved")`;
/* 3. IDENTITY ONLY, NOT TIED TO THE PROJECT'S LATEST SAVED REVISION. */
const NCR_IDENTITY_ONLY = `((certificate && certificate.slug === ACTIVE_PROJECT_SLUG && certificate.epoch === PROJECT_OPEN_EPOCH) ? "" : "different project")`;

function racingFetch({ createSlug = "film-b" } = {}) {
  const calls = [];
  let release = null;
  let saveStatus = 200;
  let saveBody = null;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    calls,
    release: () => release(),
    setSaveStatus(status, body) { saveStatus = status; saveBody = body || null; },
    createCount: () => calls.filter((row) => row.url === "/api/projects/new").length,
    marker() { return calls.length; },
    since(m) { return calls.slice(m); },
    hook: async (url, options, respond) => {
      calls.push({ url, method: (options && options.method) || "GET", body: (options && options.body) || "" });
      if (url === "/api/projects/new") { await gate; return respond({ ok: true, slug: createSlug }, 200); }
      /* The commit PREPARES the new project before activating it, so the stub
         must serve that project's own document and scoped scan. It is a GET;
         the save on the same path is not. */
      if (((options && options.method) || "GET") === "GET") {
        if (url === `/api/projects/${createSlug}/project`) {
          return respond(rawFixture(), 200, { "x-cinebraid-project-slug": createSlug, "x-cinebraid-project-revision": `rev-${createSlug}`, etag: `rev-${createSlug}` });
        }
        if (url.startsWith("/api/scan?project=")) {
          return respond({ anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} }, 200);
        }
      }
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
        if (saveStatus === 200) {
          return respond({ ok: true, revision: `rev-${calls.length}` }, 200, { "x-cinebraid-project-revision": `rev-${calls.length}` });
        }
        return respond(saveBody || { error: "refused", code: "PROJECT_VALIDATION_FAILED" }, saveStatus);
      }
      if (url === "/api/projects/switch") return respond({ ok: true, slug: createSlug }, 200);
      return null;
    },
  };
}
const startPress = (context) => evaluate(context, `
  setCreationStartPath("scratch");
  setManualStartField("title", "Film B");
  globalThis.__press = startManualProject();
  return 1;`);
const settle = (context) => evaluateAsync(context, `return await globalThis.__press;`);
async function untilInFlight(gate) {
  for (let i = 0; i < 200 && gate.createCount() === 0; i++) await tick();
  if (gate.createCount() === 0) throw new Error("the create request never reached the wire");
}

async function ncr1_unconditionalLoad() {
  anchorIn("public/creation-studio.js", NCR_ANCHOR, "NC-B1R-1", NCR_SITES);

  const gate = racingFetch();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCR_ANCHOR, NCR_UNCONDITIONAL),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  startPress(page.context);
  await untilInFlight(gate);
  /* The filmmaker edits Film A while the create request is on the wire, and
     that edit's save is refused. */
  gate.setSaveStatus(422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" });
  /* ORDINARY EDITS ARE NOW REFUSED AT THE SEAM while a replacement
     transaction owns this project — that is CENTRAL-1, and dirty() would
     decline this. What the CERTIFICATE exists for is the state that can
     still move without dirty(): a save queued before the press landing or
     being refused mid-flight, and a durable advance this window did not
     author. So the unsaved work is expressed directly here, which is
     exactly the condition the certificate compares. */
  evaluate(page.context, `P.meta.logline = "EDIT-DURING-CREATE";
    SAVE_REVISION += 1; setSaveState("dirty", "Unsaved changes");
    return 1;`);
  const marker = gate.marker();
  gate.release();
  await settle(page.context);

  const seen = evaluate(page.context, `return { hash: location.hash };`);
  const reloads = gate.since(marker).filter((row) => row.url === "/api/projects/switch").length;

  /* THE DEFECT IS GENUINELY VISIBLE: the project was replaced anyway. */
  ok(reloads >= 1, "NC-B1R-1 REPRODUCED: the reverted build loads Film B despite the refused intervening save");
  equal(seen.hash, "#/production", "NC-B1R-1 REPRODUCED: and moves the window into it");

  await mustFail("NC-B1R-1", "Film B is not loaded", async () => {
    equal(reloads, 0, "Film B is not loaded — no project read followed the refused save");
  });
  note("NC-B1R-1 removing the post-response validation restores `save once -> POST -> unconditional load`: Film B loads on top of a refused intervening save");
}

async function ncr2_booleanWithoutIdentity() {
  anchorIn("public/creation-studio.js", NCR_ANCHOR, "NC-B1R-2", NCR_SITES);

  const gate = racingFetch();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCR_ANCHOR, NCR_BOOLEAN_ONLY),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  startPress(page.context);
  await untilInFlight(gate);
  /* The filmmaker legitimately opens a DIFFERENT project mid-flight. It is
     clean and saved, so a re-asked boolean says yes about the wrong film. */
  const moved = evaluate(page.context, `
    beginProjectOpen();
    ACTIVE_PROJECT_SLUG = "some-other-film";
    return { slug: ACTIVE_PROJECT_SLUG, settled: projectSaveSettled().settled };`);
  equal(moved.settled, true, "NC-B1R-2: the project now open is itself saved, so a bare boolean is satisfied");
  const marker = gate.marker();
  gate.release();
  await settle(page.context);
  const reloads = gate.since(marker).filter((row) => row.url === "/api/projects/switch").length;

  ok(reloads >= 1,
    "NC-B1R-2 REPRODUCED: a stale create response replaces whichever project is now open");
  await mustFail("NC-B1R-2", "does not blindly replace", async () => {
    equal(reloads, 0, "a stale create response does not blindly replace whichever project is now open");
  });
  note("NC-B1R-2 re-asking projectSaveSettled() after the POST without tying it to the project the creation began from lets a stale response replace a different film");
}

async function ncr3_identityWithoutRevision() {
  anchorIn("public/creation-studio.js", NCR_ANCHOR, "NC-B1R-3", NCR_SITES);

  const gate = racingFetch();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCR_ANCHOR, NCR_IDENTITY_ONLY),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  startPress(page.context);
  await untilInFlight(gate);
  gate.setSaveStatus(422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" });
  /* The unsaved work, and the save that carries it, dispatched explicitly: the
     debounce that would normally arm this belongs to dirty(), which the
     transaction guard declines. What is under test here is the FENCE's reading
     of a refusal that landed mid-flight, so the refusal is made to land. */
  await evaluateAsync(page.context, `
    P.meta.logline = "EDIT-THEN-REFUSED";
    SAVE_REVISION += 1; setSaveState("dirty", "Unsaved changes");
    await queueProjectSave(captureProjectSave());
    return 1;`);
  /* Wait for the refusal to actually land, and record the state the fence will
     be looking at — BEFORE the replacement, because the replacement is what
     erases it. */
  for (let i = 0; i < 200; i++) {
    if (evaluate(page.context, `return SAVE_BLOCKED;`)) break;
    await tick();
  }
  const beforeRelease = evaluate(page.context,
    `return { blocked: SAVE_BLOCKED, settled: projectSaveSettled().settled, slug: ACTIVE_PROJECT_SLUG };`);
  /* Same project, same open — so an identity-only fence is satisfied, while the
     project it names is demonstrably not saved. */
  equal(beforeRelease.blocked, true, "NC-B1R-3: Film A is blocked by its refused save when the fence runs");
  equal(beforeRelease.settled, false, "NC-B1R-3: and is truthfully unsaved, which identity alone cannot see");

  const marker = gate.marker();
  gate.release();
  await settle(page.context);

  const reloads = gate.since(marker).filter((row) => row.url === "/api/projects/switch").length;
  const seen = evaluate(page.context, `return { blocked: SAVE_BLOCKED, settled: projectSaveSettled().settled };`);
  equal(seen.blocked, false,
    "NC-B1R-3 REPRODUCED: the replacement erased the save-blocked state it should have respected");
  ok(reloads >= 1,
    "NC-B1R-3 REPRODUCED: an identity-only fence replaces a project whose latest revision was never stored");
  await mustFail("NC-B1R-3", "Film B is not loaded", async () => {
    equal(reloads, 0, "Film B is not loaded — no project read followed the refused save");
  });
  note("NC-B1R-3 a fence that checks WHICH project but not whether that project's latest revision is stored replaces Film A while its edit is refused and unsaved");
}

/* R-B1R — THE RETIREMENT, FOR THE ATOMIC SHAPE.
 *
 * Three shapes must not come back, and each one independently failed review:
 *
 *   1. `POST -> await load()` — an asynchronous open after the activation, which
 *      leaves an interval where the server has switched and this window has not.
 *   2. The put-back: activate unconditionally, discover the source is stale, and
 *      switch the server back to the captured project. That can overwrite a
 *      legitimate switch to a third project, and can itself fail.
 *   3. An unconditional activation, which is what made a put-back necessary.
 *
 * This asserts the replacement, not the checks around it: prepare BEFORE the
 * activation, activate CONDITIONALLY, install SYNCHRONOUSLY. */
function rb1r_replacementFenceRetirement(sourceText) {
  const studio = codeOnly(sourceText === undefined ? readLF("public/creation-studio.js") : sourceText);
  const at = studio.indexOf("async function startManualProjectCommit(");
  ok(at >= 0, "R-B1R: startManualProjectCommit is still the commit");
  const body = studio.slice(at, studio.indexOf("\n}", at));

  const postAt = body.indexOf('fetch("/api/projects/new"');
  const prepareAt = body.indexOf("prepareProjectLoad(");
  const switchAt = body.indexOf('fetch("/api/projects/switch"');
  const installAt = body.indexOf("commitPreparedProjectLoad(");
  ok(postAt >= 0, "R-B1R: the creation still goes through the shipped route");
  ok(prepareAt > postAt, "R-B1R: the new project is prepared after it is created");
  ok(switchAt > prepareAt, "R-B1R: and PREPARED BEFORE it is activated");
  ok(installAt > switchAt, "R-B1R: the install follows the activation");

  /* 1. NO ASYNCHRONOUS OPEN, ANYWHERE IN THIS PATH. */
  ok(!/\bawait\s+load\s*\(/.test(body),
    "R-B1R RETIRED: `await load()` must not come back — an asynchronous open after the activation "
    + "is the interval this shape exists to remove");
  ok(!/\bload\s*\(\s*\)/.test(body),
    "R-B1R RETIRED: nor any other call to the combined open");

  /* 2. NOTHING IS AWAITED BETWEEN A CONFIRMED ACTIVATION AND THE INSTALL.
     Measured from the END of the activation's own error handling — the point at
     which the switch is known to have succeeded — rather than from the request,
     because reading the response body is itself an await and is part of
     confirming it. */
  const confirmedAt = body.indexOf('"manual-start:activation-refused"');
  ok(confirmedAt > switchAt && confirmedAt < installAt,
    "R-B1R: the activation's refusal path sits between the request and the install");
  const awaitsBetween = (body.slice(confirmedAt, installAt).match(/\bawait\b/g) || []);
  equal(awaitsBetween.length, 0,
    "R-B1R RETIRED: nothing may be awaited between a confirmed activation and the install — "
    + `that interval is the whole defect (found ${awaitsBetween.length})`);
  const afterInstall = body.slice(installAt);
  ok(!/\bawait\b/.test(afterInstall),
    "R-B1R RETIRED: and nothing may be awaited after the install either — the hash, the route and the "
    + "lock release are part of the same synchronous breath");

  /* 3. THE ACTIVATION IS CONDITIONAL, AND THERE IS NO PUT-BACK. */
  ok(/expectedActiveProject/.test(body),
    "R-B1R: the activation states which project it believes is active, so the server can refuse it");
  const switchCalls = (body.match(/fetch\("\/api\/projects\/switch"/g) || []).length;
  equal(switchCalls, 1,
    "R-B1R RETIRED: exactly ONE switch request may exist in this path — a second one is the put-back, "
    + "which could overwrite a legitimate switch to a third project");
  ok(!/sourceSlug/.test(body),
    "R-B1R RETIRED: the captured source slug the put-back switched back to must not come back");

  /* 4. AND THE TRANSACTION IS LOCKED. */
  const studioAll = studio;
  ok(/beginManualReplacement\s*\(/.test(studioAll) && /endManualReplacement\s*\(/.test(studioAll),
    "R-B1R: the transaction takes a replacement lock");
  const press = studioAll.slice(studioAll.indexOf("window.startManualProject = async"));
  ok(/finally\s*\{[^}]*endManualReplacement\s*\(/.test(press.replace(/\n/g, " ")),
    "R-B1R: and releases it in a finally, so no refusal can strand the window between two projects");

  note("R-B1R the new project is prepared before it is activated, the activation is conditional and happens exactly once, the install is synchronous with nothing awaited around it, and the put-back is gone");
}

/* ===========================================================================
   NC-ACTIVE — RESTORE THE ACTIVATION-AT-CREATION MUTATION.

   The residual half of B1. The replacement fence kept the WINDOW in Film A when
   it refused, but POST /api/projects/new had already written `activeProject`, so
   the browser said A and the config said B. A reload then opened the project the
   fence had just declined to switch to, discarding the edit the refusal existed
   to protect.

   This puts the unconditional mutation back — the exact pre-correction three
   lines — and proves the reload case fails with it. It runs against a REAL
   server and reads the REAL config file, because "what does a reload open" is a
   question about stored state.
   =========================================================================== */

const { spawn } = require("child_process");
const os = require("os");

const NCA_ANCHOR = `  if (req.body.activate !== false) {
    const c = readConfig();
    c.activeProject = slug;
    writeConfig(c);
  }
  res.json({ ok: true, slug });`;
/* The shipped defect: activation is not a separate act. */
const NCA_BREAK = `  const c = readConfig();
  c.activeProject = slug;
  writeConfig(c);
  res.json({ ok: true, slug });`;

/* Runs a real server against a COPY of server.js with the mutation applied, so
   the negative control exercises the route rather than a description of it. */
async function withMutatedServer(anchor, replacement, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-nca-"));
  fs.mkdirSync(path.join(dir, "projects"), { recursive: true });
  const source = fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8");
  const normalized = source.replace(/\r\n/g, "\n");
  assert.strictEqual(normalized.split(anchor).length - 1, 1,
    "probe receipt: NC-ACTIVE expected exactly one occurrence of its anchor in server.js. "
    + "The control is no longer mutating the live path and must be rewritten.");
  const mutatedPath = path.join(ROOT, "src/server/server.__nca-mutated.js");
  fs.writeFileSync(mutatedPath, normalized.split(anchor).join(replacement));

  const configPath = path.join(dir, "config.json");
  const port = 4960 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, [mutatedPath], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_HOST: "127.0.0.1",
           CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: path.join(dir, "projects") },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 200; i++) {
      try { await fetch(`${base}/api/app-identity`); break; }
      catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    return await body({
      base,
      activeProject: () => {
        try { return JSON.parse(fs.readFileSync(configPath, "utf8")).activeProject || ""; } catch { return ""; }
      },
      create: async (title, extra = {}) => {
        const response = await fetch(`${base}/api/projects/new`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, ...extra }),
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
      },
    });
  } finally {
    try { child.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(mutatedPath, { force: true }); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function nc_active_activationAtCreation() {
  await withMutatedServer(NCA_ANCHOR, NCA_BREAK, async (server) => {
    const filmA = await server.create("Film A");
    equal(server.activeProject(), filmA.body.slug, "NC-ACTIVE precondition: Film A is the active project");

    /* The manual path's request — it asks NOT to activate. The reverted route
       has no such concept and activates anyway. */
    const filmB = await server.create("Film B", { activate: false });
    equal(filmB.status, 200, "NC-ACTIVE: the creation still succeeds");
    equal(server.activeProject(), filmB.body.slug,
      "NC-ACTIVE REPRODUCED: the reverted route activates Film B despite being asked not to");
    ok(server.activeProject() !== filmA.body.slug,
      "NC-ACTIVE REPRODUCED: so a reload would open Film B while the window is still in Film A");

    /* AND THE GUARANTEE GOES RED AGAINST IT. This is the assertion the shipped
       build passes in tests/at1-boundary-corrections.js ACTIVE-S2. */
    await mustFail("NC-ACTIVE", "the ACTIVE project is still Film A", async () => {
      equal(server.activeProject(), filmA.body.slug, "the ACTIVE project is still Film A");
    });
  });
  note("NC-ACTIVE restoring the activation-at-creation mutation makes a create-without-activate request move activeProject anyway, so a reload opens the project the fence refused to switch to; the ACTIVE guarantee fails against that build");
}

/* ===========================================================================
   NC-FINAL — THE SIX WAYS THE ATOMIC SHAPE CAN BE UNDONE.

   Each control restores one part of a shape that independently failed review and
   proves the guarantee goes red against it. Three are behavioural (the defect is
   visible in a running build) and three are structural (the defect is a shape,
   and R-B1R is the assertion that reads it).
   =========================================================================== */

/* A harness that models the conditional switch, so a control can show what
   happens when the condition is removed from either side. */
function conditionalHarness({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let activeProject = sourceSlug;
  let releasePrepare = null;
  const prepareGate = new Promise((r) => { releasePrepare = r; });
  let holdPrepare = false;
  return {
    calls,
    releasePrepare: () => releasePrepare(),
    holdPrepare() { holdPrepare = true; },
    setActiveProject(slug) { activeProject = slug; },
    activeProject: () => activeProject,
    switchCalls: () => calls.filter((row) => row.url === "/api/projects/switch")
      .map((row) => { try { return JSON.parse(row.body); } catch { return {}; } }),
    hook: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      const body = String((options && options.body) || "");
      calls.push({ url, method, body });
      if (url === "/api/projects/new") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (request.activate !== false) activeProject = createSlug;
        return respond({ ok: true, slug: createSlug }, 200);
      }
      if (url === "/api/projects/switch") {
        const request = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (Object.prototype.hasOwnProperty.call(request, "expectedActiveProject")
          && String(request.expectedActiveProject || "") !== activeProject) {
          return respond({ ok: false, code: "PROJECT_ACTIVE_CONFLICT", error: "The active project changed.", activeProject }, 409);
        }
        activeProject = String(request.slug || activeProject);
        return respond({ ok: true, slug: activeProject }, 200);
      }
      if (method === "GET" && url === `/api/projects/${createSlug}/project`) {
        if (holdPrepare) await prepareGate;
        const project = rawFixture(); project.meta.title = "Film B";
        return respond(project, 200, { "x-cinebraid-project-slug": createSlug, "x-cinebraid-project-revision": "rev-b", etag: "rev-b" });
      }
      if (method === "GET" && url.startsWith("/api/scan?project=")) {
        return respond({ anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} }, 200);
      }
      if (/\/api\/projects\/[^/]+\/(project|canon-transition)$/.test(url)) {
        return respond({ ok: true, revision: `rev-${calls.length}` }, 200, { "x-cinebraid-project-revision": `rev-${calls.length}` });
      }
      return null;
    },
  };
}
const pressAndSettle = async (context) => {
  evaluate(context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    ACTIVE_PROJECT_SLUG = "film-a";
    globalThis.__press = startManualProject();
    return 1;`);
  return evaluateAsync(context, `return await globalThis.__press;`);
};

/* ---- 1. UNCONDITIONAL SWITCH RESTORED (behavioural). ------------------- */
const NCF1_ANCHOR = `body: JSON.stringify({ slug: MANUAL_START_PENDING.slug, expectedActiveProject: certificate.slug }),`;
const NCF1_BREAK = `body: JSON.stringify({ slug: MANUAL_START_PENDING.slug }),`;

async function ncf1_unconditionalSwitch() {
  anchorIn("public/creation-studio.js", NCF1_ANCHOR, "NC-FINAL-1");
  const gate = conditionalHarness();
  gate.holdPrepare();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCF1_ANCHOR, NCF1_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  const press = pressAndSettle(page.context);
  for (let i = 0; i < 300 && !gate.calls.some((row) => row.url === "/api/projects/film-b/project"); i++) await tick();
  /* A third project legitimately becomes active while this is preparing. */
  gate.setActiveProject("film-c");
  gate.releasePrepare();
  await press;

  equal(gate.activeProject(), "film-b",
    "NC-FINAL-1 REPRODUCED: an unconditional switch overwrites the project the filmmaker moved to");
  await mustFail("NC-FINAL-1", "Film C remains server-active", async () => {
    equal(gate.activeProject(), "film-c", "Film C remains server-active");
  });
  note("NC-FINAL-1 removing expectedActiveProject from the activation lets a stale transaction overwrite a legitimate switch to a third project");
}

/* ---- 2. THE SERVER'S CONDITION REMOVED (behavioural, real server). ----- */
const NCF3_ANCHOR = `  if (Object.prototype.hasOwnProperty.call(req.body || {}, "expectedActiveProject")) {
    const expected = containedProjectSlug(String(req.body.expectedActiveProject || "")) || "";
    const current = activeSlug() || "";
    if (expected !== current) {
      return res.status(409).json({
        ok: false,
        code: "PROJECT_ACTIVE_CONFLICT",
        error: "The active project changed before this switch, so it was not made.",
        expected,
        activeProject: current,
      });
    }
  }`;
const NCF3_BREAK = `  /* the condition, removed */`;

async function ncf3_serverConditionRemoved() {
  await withMutatedServer(NCF3_ANCHOR, NCF3_BREAK, async (server) => {
    const filmA = await server.create("Film A");
    const filmC = await server.create("Film C");
    equal(server.activeProject(), filmC.body.slug, "NC-FINAL-3 precondition: Film C is active");
    const filmB = await server.create("Film B", { activate: false });
    /* A transaction that began while Film A was active tries to activate B. */
    const response = await fetch(`${server.base}/api/projects/switch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: filmB.body.slug, expectedActiveProject: filmA.body.slug }),
    });
    equal(response.status, 200,
      "NC-FINAL-3 REPRODUCED: without the condition the server accepts a switch whose expectation is wrong");
    equal(server.activeProject(), filmB.body.slug,
      "NC-FINAL-3 REPRODUCED: and Film C is overwritten");
    await mustFail("NC-FINAL-3", "the switch is refused", async () => {
      equal(response.status, 409, "the switch is refused");
    });
  });
  note("NC-FINAL-3 removing the server's expected-active check lets a stale transaction overwrite whichever project is actually current — the check and the write must be one section in the route");
}

/* ---- 3. THE REPLACEMENT LOCK REMOVED (behavioural). ------------------- */
const NCF6_ANCHOR = `  if (!MANUAL_REPLACEMENT.active) return false;
  if (String(hash || "").startsWith("#/create")) return false;`;
const NCF6_BREAK = `  return false;
  if (String(hash || "").startsWith("#/create")) return false;`;

async function ncf6_lockRemoved() {
  anchorIn("public/creation-studio.js", NCF6_ANCHOR, "NC-FINAL-6");
  const gate = conditionalHarness();
  gate.holdPrepare();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCF6_ANCHOR, NCF6_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  const press = pressAndSettle(page.context);
  for (let i = 0; i < 300 && !gate.calls.some((row) => row.url === "/api/projects/film-b/project"); i++) await tick();

  const navigated = await evaluateAsync(page.context, `
    location.hash = "#/shots";
    await route();
    return { hash: location.hash };`);
  equal(navigated.hash, "#/shots",
    "NC-FINAL-6 REPRODUCED: without the lock the filmmaker navigates into the outgoing project mid-transaction");
  await mustFail("NC-FINAL-6", "navigating into the open project during the transaction is refused", async () => {
    equal(navigated.hash, "#/create", "navigating into the open project during the transaction is refused");
  });
  gate.releasePrepare();
  await press;
  note("NC-FINAL-6 removing the replacement lock lets the filmmaker navigate into the outgoing project while it is being replaced, which is where an uncertified edit gets made and discarded");
}

/* ---- 4-6. THE THREE SHAPES, READ FROM THE SOURCE. --------------------- */
/* R-B1R is the assertion that owns these, so each control mutates the source and
   proves R-B1R itself goes red — which is what makes R-B1R load-bearing rather
   than decorative. */
async function ncf_structuralShapes() {
  const source = readLF("public/creation-studio.js");

  /* PUT-BACK RESTORED: a second switch, back to the captured source. */
  const putBack = source.replace(
    `    const because = String(refusal).replace(/\\s*\\.\\s*$/, "");`,
    `    await fetch("/api/projects/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: certificate.slug }) });
    const because = String(refusal).replace(/\\s*\\.\\s*$/, "");`);
  ok(putBack !== source, "NC-FINAL-2: the put-back control mutated the live path");
  await mustFail("NC-FINAL-2", "exactly ONE switch request may exist", async () => {
    rb1r_replacementFenceRetirement(putBack);
  });

  /* ASYNC LOAD RESTORED after the activation. */
  const asyncLoad = source.replace(
    "  if (!commitPreparedProjectLoad(prepared, transition)) {",
    "  await load();\n  if (!commitPreparedProjectLoad(prepared)) {");
  ok(asyncLoad !== source, "NC-FINAL-4: the async-load control mutated the live path");
  await mustFail("NC-FINAL-4", "`await load()` must not come back", async () => {
    rb1r_replacementFenceRetirement(asyncLoad);
  });

  /* AN AWAIT INSERTED between a confirmed activation and the install. */
  const insertedAwait = source.replace(
    "  if (!commitPreparedProjectLoad(prepared, transition)) {",
    "  await flushPendingProjectSave();\n  if (!commitPreparedProjectLoad(prepared)) {");
  ok(insertedAwait !== source, "NC-FINAL-5: the inserted-await control mutated the live path");
  await mustFail("NC-FINAL-5", "nothing may be awaited between a confirmed activation and the install", async () => {
    rb1r_replacementFenceRetirement(insertedAwait);
  });

  note("NC-FINAL-2/4/5 restoring the put-back, restoring an asynchronous open after the activation, and inserting a single await before the install each make R-B1R go red — the three shapes that independently failed review cannot come back silently");
}
/* ===========================================================================
   NC-MODAL — THE FIVE WAYS THE MODAL COMMIT CAN BE UNDONE.

   The previous shape guarded dirty(), and that control had to be retired with it:
   the guard it protected was itself the defect. These replace it, and one of them
   is specifically the reproduction of that mistake — `P` changed with the
   counters standing still.
   =========================================================================== */

function modalGate({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let activeProject = sourceSlug;
  let releaseCreate = null;
  const createGate = new Promise((r) => { releaseCreate = r; });
  return {
    calls,
    releaseCreate: () => releaseCreate(),
    activeProject: () => activeProject,
    setActiveProject(slug) { activeProject = slug; },
    hook: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      const body = String((options && options.body) || "");
      calls.push({ url, method, body });
      if (url === "/api/projects/new") { await createGate; return respond({ ok: true, slug: createSlug }, 200); }
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
        return respond({ ok: true, revision: `rev-${calls.length}` }, 200, { "x-cinebraid-project-revision": `rev-${calls.length}` });
      }
      return null;
    },
  };
}
/* The same trusted-delivery model the focused suite uses: capture listeners run
   first, and a stopped event never reaches its handler. */
function ncTrustedInteraction(page, type, run) {
  let stopped = false;
  const event = {
    type, isTrusted: true, target: page.context.document.getElementById("main"),
    preventDefault() {}, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; },
  };
  for (const handler of (page.documentListeners.get(type) || []).slice()) {
    handler(event);
    if (stopped) break;
  }
  if (stopped) return { delivered: false };
  run();
  return { delivered: true };
}
const ncPressHeld = (context) => evaluate(context, `
  setCreationStartPath("scratch");
  setManualStartField("title", "Film B");
  ACTIVE_PROJECT_SLUG = "film-a";
  globalThis.__press = startManualProject();
  return 1;`);
async function ncUntilCreate(gate) {
  for (let i = 0; i < 400; i++) { if (gate.calls.some((row) => row.url === "/api/projects/new")) return; await tick(); }
  throw new Error("the create request never reached the wire");
}

/* ---- 1 & 2. THE INTERACTION FENCE, REMOVED. --------------------------- */
const NCM_ANCHOR = `  beginInteractionFence("opening that project");`;
const NCM_BREAK = `  /* the modal interaction fence, removed */`;

async function ncm_fenceRemoved() {
  anchorIn("public/creation-studio.js", NCM_ANCHOR, "NC-MODAL-1");
  const gate = modalGate();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCM_ANCHOR, NCM_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  ncPressHeld(page.context);
  await ncUntilCreate(gate);

  /* The route() and switchProject() guards are untouched in this build, and are
     doing their job — this is the control that says they are not the mechanism. */
  const lockIntact = await evaluateAsync(page.context, `
    const busy = manualReplacementBusy();
    location.hash = "#/shots";
    await route();
    return { busy, heldTheHash: location.hash === "#/create" };`);
  equal(lockIntact.busy, true, "NC-MODAL-1: the presentation lock is active in this build");
  equal(lockIntact.heldTheHash, true, "NC-MODAL-1: and still refuses navigation, exactly as before");

  const before = evaluate(page.context, `return { document: JSON.stringify(P), scenes: P.scenes.length };`);
  const delivered = ncTrustedInteraction(page, "click", () => evaluate(page.context, `
    addScene();
    const field = document.getElementById("ff-title");
    if (field) field.value = "A scene the lock never saw";
    if (typeof _formSubmit === "function") _formSubmit();
    return 1;`));
  const after = evaluate(page.context, `return { document: JSON.stringify(P), scenes: P.scenes.length };`);

  equal(delivered.delivered, true,
    "NC-MODAL-2 REPRODUCED: without the fence a trusted `+ Add → Scene` reaches its handler");
  ok(after.document !== before.document,
    "NC-MODAL-1 REPRODUCED: and the project document changes — the exact reproduction, with the route/switch guards fully intact");
  ok(after.scenes > before.scenes, "NC-MODAL-1 REPRODUCED: a scene is added to the film being replaced");

  await mustFail("NC-MODAL-1", "never reached addScene()", async () => {
    equal(delivered.delivered, false, "the editing action never reached addScene() — the fence refused delivery");
  });
  await mustFail("NC-MODAL-2", "deep-equal before and after", async () => {
    equal(after.document, before.document, "the project document is deep-equal before and after every attempted interaction");
  });
  gate.releaseCreate();
  await evaluateAsync(page.context, `try { await globalThis.__press; } catch {} return 1;`);
  note("NC-MODAL-1/2 removing the central interaction fence lets trusted `+ Add → Scene` reach its handler and change the document, with route() and switchProject() guards fully intact — they explain, the fence enforces");
}

/* ---- 3. THE dirty() SUPPRESSION, RESTORED. ---------------------------- */
const NCM3_ANCHOR = `function dirty() {
  clearTimeout(saveTimer);`;
const NCM3_BREAK = `function dirty() {
  clearTimeout(saveTimer);
  if (PROJECT_TRANSITION && PROJECT_TRANSITION_WORK === 0) return;`;

async function ncm3_dirtySuppressionRestored() {
  anchorIn("public/app.js", NCM3_ANCHOR, "NC-MODAL-3");
  const gate = modalGate();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("app.js", NCM3_ANCHOR, NCM3_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  ncPressHeld(page.context);
  await ncUntilCreate(gate);

  /* A legitimate internal mutation — not a user action, so the fence does not
     touch it and must not. */
  const seen = evaluate(page.context, `
    const beforeDocument = JSON.stringify(P);
    const beforeRevision = SAVE_REVISION;
    P.meta.logline = "BACKGROUND-MUTATION";
    dirty();
    return {
      changed: JSON.stringify(P) !== beforeDocument,
      revisionMoved: SAVE_REVISION !== beforeRevision,
      settled: projectSaveSettled().settled,
    };`);

  equal(seen.changed, true, "NC-MODAL-3 REPRODUCED: the document changed");
  equal(seen.revisionMoved, false,
    "NC-MODAL-3 REPRODUCED: and the counters did NOT — the suppression is back");
  equal(seen.settled, true,
    "NC-MODAL-3 REPRODUCED: so projectSaveSettled() reports a settled project that no longer matches what it describes");

  await mustFail("NC-MODAL-3", "dirty() RECORDED it", async () => {
    ok(seen.revisionMoved, "dirty() RECORDED it — the counters advance normally, which is what the old guard concealed");
  });
  gate.releaseCreate();
  await evaluateAsync(page.context, `try { await globalThis.__press; } catch {} return 1;`);
  note("NC-MODAL-3 restoring the dirty() suppression reproduces `P changed / counters unchanged / settled true` — the state the certificate cannot detect and the reason the guard was removed");
}

/* ---- 4. THE INSTALL OWNERSHIP CHECK, REMOVED. ------------------------- */
const NCM4_ANCHOR = `  if (ownership) {
    if (!PROJECT_TRANSITION || PROJECT_TRANSITION.token !== ownership.token) return false;
    if (ACTIVE_PROJECT_SLUG !== ownership.sourceSlug) return false;
    if (PROJECT_OPEN_EPOCH !== ownership.epoch) return false;
  }`;
const NCM4_BREAK = `  /* ownership, unchecked */`;

async function ncm4_installOwnershipRemoved() {
  anchorIn("public/app.js", NCM4_ANCHOR, "NC-MODAL-4");
  const page = await render("#/create", rawFixture(), {
    mutateSource: replacing("app.js", NCM4_ANCHOR, NCM4_BREAK),
  });
  const seen = evaluate(page.context, `
    const prepared = { available: true, slug: "film-b", revision: "rev-b",
      project: JSON.parse(JSON.stringify(P)),
      scan: { anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} },
      config: {}, promptLibrary: { profiles: [] }, agentStatus: {}, automationRuns: [],
      falJobs: [], falLedgerLoaded: false, backgroundRecovery: null };
    const owned = beginProjectTransition("opening another project");
    const ownedCopy = { token: owned.token, sourceSlug: owned.sourceSlug, epoch: owned.epoch };
    const fenceSaysYes = createReplacementRefusal(createReplacementCertificate()) === "";
    beginProjectOpen();
    ACTIVE_PROJECT_SLUG = "film-c";
    const installed = commitPreparedProjectLoad(prepared, ownedCopy);
    endProjectTransition(owned.token);
    return { fenceSaysYes, installed };`);
  equal(seen.fenceSaysYes, true, "NC-MODAL-4: the earlier fence was satisfied when the snapshot was prepared");
  equal(seen.installed, true,
    "NC-MODAL-4 REPRODUCED: without the ownership check a superseded snapshot installs on the strength of that fence alone");
  await mustFail("NC-MODAL-4", "refuses a superseded transaction", async () => {
    equal(seen.installed, false, "the install ownership check refuses a superseded transaction anyway");
  });
  note("NC-MODAL-4 a stale prepared snapshot still installs whenever the synchronous ownership check is absent, however valid the certificate that authorised its preparation was");
}

/* ---- 5. THE FENCE FAILS TO RELEASE. ----------------------------------- */
const NCM5_ANCHOR = `    endInteractionFence();`;
const NCM5_BREAK = `    /* released only on success */ if (false) endInteractionFence();`;

async function ncm5_fenceNeverReleases() {
  anchorIn("public/creation-studio.js", NCM5_ANCHOR, "NC-MODAL-5");
  const gate = modalGate();
  gate.setActiveProject("film-c");   /* the activation will conflict */
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCM5_ANCHOR, NCM5_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  ncPressHeld(page.context);
  await ncUntilCreate(gate);
  gate.releaseCreate();
  await evaluateAsync(page.context, `try { await globalThis.__press; } catch {} return 1;`);

  const stranded = evaluate(page.context, `return { fence: interactionFenceActive() };`);
  const usable = ncTrustedInteraction(page, "click", () => 1);
  equal(stranded.fence, true,
    "NC-MODAL-5 REPRODUCED: an error path that does not release leaves the fence up");
  equal(usable.delivered, false,
    "NC-MODAL-5 REPRODUCED: and the window is stranded — no interaction is delivered ever again");
  await mustFail("NC-MODAL-5", "the interaction fence released", async () => {
    equal(stranded.fence, false, "the interaction fence released");
  });
  note("NC-MODAL-5 releasing the fence anywhere but a finally strands the window inert after a failed activation, which is worse than the race it closes");
}

/* ---- AND THE FENCE MUST NOT DEGRADE INTO A LIST OF CONTROLS. ---------- */
function ncm_fenceNotAList() {
  const app = codeOnly(readLF("public/app.js"));
  const at = app.indexOf("function interactionFenceHandler(");
  ok(at >= 0, "NC-MODAL: the interaction fence handler is still the boundary");
  const handler = app.slice(at, app.indexOf("\n}", at));
  ok(/isTrusted\s*!==\s*true/.test(handler),
    "NC-MODAL: it fences trusted events only, so internal and background work is untouched");
  for (const control of ["addScene", "addShot", "addEntity", "setGlobalCreationField", "newProject", "global-add"]) {
    ok(!new RegExp(control).test(handler),
      `NC-MODAL RETIRED: the fence must not name ${control} — the guarantee is the boundary, not a list of controls`);
  }
  /* And dirty() must not have grown a transaction opinion again. */
  const dirtyAt = app.indexOf("function dirty()");
  const dirtyBody = app.slice(dirtyAt, app.indexOf("\n}", dirtyAt));
  ok(!/PROJECT_TRANSITION/.test(dirtyBody),
    "NC-MODAL RETIRED: dirty() must not consult the replacement transaction — that guard ran after the mutation");
  note("NC-MODAL the fence names no control and fences only trusted events, and dirty() holds no opinion about replacement transactions");
}

/* ===========================================================================
   NC-QUIET — THE SIX WAYS THE QUIESCENCE GATE CAN BE UNDONE.

   The headline is NC-QUIET-0: it restores the shipped reproduction end to end —
   a pending Blocking → Improve, a creation begun anyway, the prompt continuation
   landing during the activation round trip, and Film B installing over the
   completed build. Everything else here removes one part of the gate.
   =========================================================================== */

function quietGate({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let activeProject = sourceSlug;
  let releaseCompile = null;
  let releaseSwitch = null;
  const compileGate = new Promise((r) => { releaseCompile = r; });
  const switchGate = new Promise((r) => { releaseSwitch = r; });
  let holdSwitch = false;
  return {
    calls,
    releaseCompile: () => releaseCompile(),
    releaseSwitch: () => releaseSwitch(),
    holdSwitch() { holdSwitch = true; },
    activeProject: () => activeProject,
    creates: () => calls.filter((row) => row.url === "/api/projects/new"),
    hook: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      const body = String((options && options.body) || "");
      calls.push({ url, method, body });
      if (url === "/api/prompt/compile") {
        await compileGate;
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
          if (holdSwitch) await switchGate;
          return respond({ ok: false, code: "PROJECT_ACTIVE_CONFLICT", error: "changed", activeProject }, 409);
        }
        activeProject = String(request.slug || activeProject);
        if (holdSwitch) await switchGate;
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
        return respond({ ok: true, revision: `rev-${calls.length}` }, 200, { "x-cinebraid-project-revision": `rev-${calls.length}` });
      }
      return null;
    },
  };
}
async function ncUntilCompile(gate) {
  for (let i = 0; i < 400; i++) {
    if (gate.calls.some((row) => row.url === "/api/prompt/compile")) return;
    await tick();
  }
  throw new Error("the prompt compile never reached the wire");
}

/* ---- 0. THE HEADLINE: THE EXACT SHIPPED REPRODUCTION. ----------------- */
const NCQ_ANCHOR = `    const busy = typeof projectQuiescenceRefusal === "function" ? projectQuiescenceRefusal() : "";
    if (busy) return refuse(busy, "manual-start:not-quiescent");`;
const NCQ_BREAK = `    /* the quiescence gate, removed */`;

async function ncq0_shippedReproduction() {
  anchorIn("public/creation-studio.js", NCQ_ANCHOR, "NC-QUIET-0");
  const gate = quietGate();
  gate.holdSwitch();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCQ_ANCHOR, NCQ_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);

  /* 1-3. Blocking → Improve is running and its response is held. */
  evaluate(page.context, `globalThis.__improve = buildBlockingPrompt("L1-01", true); return 1;`);
  await ncUntilCompile(gate);
  const buildsBefore = evaluate(page.context, `return ensureShotCreation(shotById("L1-01")).blockingBuilds.length;`);

  /* 4-5. The creation begins anyway, and the response lands during the
     activation round trip. */
  evaluate(page.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    globalThis.__press = startManualProject();
    return 1;`);
  for (let i = 0; i < 400 && gate.calls.filter((row) => row.url === "/api/projects/switch").length === 0; i++) await tick();
  gate.releaseCompile();
  await evaluateAsync(page.context, `try { await globalThis.__improve; } catch {} return 1;`);

  /* 6. The continuation mutated Film A while the replacement was in flight. */
  const mutated = evaluate(page.context, `
    return { builds: ensureShotCreation(shotById("L1-01")).blockingBuilds.length,
             prompt: (ensureShotCreation(shotById("L1-01")).blockingBuilds.at(-1) || {}).prompt || "" };`);
  ok(mutated.builds > buildsBefore,
    "NC-QUIET-0 REPRODUCED: the held prompt continuation mutated Film A during the replacement");
  equal(mutated.prompt, "An improved blocking prompt", "NC-QUIET-0 REPRODUCED: with the completed build on it");

  /* 7. And Film B installs over it. */
  gate.releaseSwitch();
  await evaluateAsync(page.context, `try { await globalThis.__press; } catch {} return 1;`);
  const after = evaluate(page.context, `
    return { title: P.meta.title,
             builds: ensureShotCreation(shotById("L1-01") || { id: "L1-01" }).blockingBuilds.length };`);
  equal(after.title, "Film B", "NC-QUIET-0 REPRODUCED: Film B installed over the newer Film A");
  ok(after.builds < mutated.builds || !evaluate(page.context, `return !!shotById("L1-01");`),
    "NC-QUIET-0 REPRODUCED: and the completed build is gone with it");

  await mustFail("NC-QUIET-0", "no project was created while the operation was pending", async () => {
    equal(gate.creates().length, 0, "no project was created while the operation was pending");
  });
  note("NC-QUIET-0 removing the quiescence gate restores the shipped reproduction end to end: a pending Blocking → Improve, a creation begun anyway, the continuation mutating Film A during activation, and Film B installing over the completed build");
}

/* ---- 1. THE BLOCKING REQUEST IS NO LONGER REGISTERED. ----------------- */
const NCQ1_ANCHOR = `  if (value && value.status === "busy" && typeof beginProjectAsyncMutation === "function") {
    beginProjectAsyncMutation(guidedPromptOpLabel(kind, value.action), key);
  }`;
const NCQ1_BREAK = `  /* the lease, no longer taken */`;

async function ncq1_leaseNotTaken() {
  anchorIn("public/creation-studio.js", NCQ1_ANCHOR, "NC-QUIET-1");
  const gate = quietGate();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCQ1_ANCHOR, NCQ1_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `globalThis.__improve = buildBlockingPrompt("L1-01", true); return 1;`);
  await ncUntilCompile(gate);
  const seen = evaluate(page.context, `return {
    busy: !!guidedPromptOp("blocking", "L1-01", ""),
    leases: projectAsyncMutationsInFlight().length,
    refusal: projectQuiescenceRefusal() };`);
  equal(seen.busy, true, "NC-QUIET-1: the operation is genuinely running");
  equal(seen.leases, 0, "NC-QUIET-1 REPRODUCED: but it holds no lease");
  equal(seen.refusal, "", "NC-QUIET-1 REPRODUCED: so the project reports itself quiescent while it is not");
  await mustFail("NC-QUIET-1", "holds a named project-mutation lease", async () => {
    equal(seen.leases, 1, "it holds a named project-mutation lease while it is pending");
  });
  gate.releaseCompile();
  await evaluateAsync(page.context, `try { await globalThis.__improve; } catch {} return 1;`);
  note("NC-QUIET-1 if the shipped Blocking → Improve stops taking a lease, the project reports quiescence while that operation is still pending");
}

/* ---- 2. CREATION CHECKS ONLY projectSaveSettled(). -------------------- */
async function ncq2_settledOnly() {
  const gate = quietGate();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    /* The gate replaced by the check it is NOT: saved, but not quiescent. */
    mutateSource: replacing("creation-studio.js", NCQ_ANCHOR,
      `    const busy = projectSaveSettled().settled ? "" : "not saved";
    if (busy) return refuse(busy, "manual-start:not-quiescent");`),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  evaluate(page.context, `globalThis.__improve = buildBlockingPrompt("L1-01", true); return 1;`);
  await ncUntilCompile(gate);
  const settledButBusy = evaluate(page.context, `return {
    settled: projectSaveSettled().settled, leases: projectAsyncMutationsInFlight().length };`);
  equal(settledButBusy.settled, true, "NC-QUIET-2: the project IS saved");
  equal(settledButBusy.leases, 1, "NC-QUIET-2: and is NOT quiescent");
  await evaluateAsync(page.context, `
    setCreationStartPath("scratch"); setManualStartField("title", "Film B");
    await startManualProject(); return 1;`);
  equal(gate.creates().length, 1,
    "NC-QUIET-2 REPRODUCED: a settled-only check creates the project on top of pending work");
  await mustFail("NC-QUIET-2", "no project was created while the operation was pending", async () => {
    equal(gate.creates().length, 0, "no project was created while the operation was pending");
  });
  gate.releaseCompile();
  await evaluateAsync(page.context, `try { await globalThis.__improve; } catch {} return 1;`);
  note("NC-QUIET-2 checking only projectSaveSettled() lets a creation begin on a saved project that is still busy — saved and quiescent are different questions");
}

/* ---- 3. A GAP BETWEEN THE CHECK AND THE LOCK. ------------------------- */
async function ncq3_checkThenLockGap() {
  /* The gate moved BEFORE the fence, with an await in between — the ordering the
     correction exists to avoid. */
  const gapped = `  const busy = typeof projectQuiescenceRefusal === "function" ? projectQuiescenceRefusal() : "";
  if (busy) return refuse(busy, "manual-start:not-quiescent");
  await Promise.resolve();
  beginInteractionFence("opening that project");`;
  anchorIn("public/creation-studio.js", `  beginInteractionFence("opening that project");`, "NC-QUIET-3");
  const gate = quietGate();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: (name, contents) => {
      if (name !== "creation-studio.js") return contents;
      return String(contents).replace(/\r\n/g, "\n")
        .split(NCQ_ANCHOR).join("")
        .split(`  beginInteractionFence("opening that project");`).join(gapped);
    },
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);

  /* Quiescent at the check; a job starts inside the gap. */
  const raced = await evaluateAsync(page.context, `
    setCreationStartPath("scratch"); setManualStartField("title", "Film B");
    const quietAtCheck = projectQuiescenceRefusal() === "";
    const press = startManualProject();
    /* The gap: the fence is not up yet, so this starts. */
    const fenceUpImmediately = interactionFenceActive();
    globalThis.__improve = buildBlockingPrompt("L1-01", true);
    const leases = projectAsyncMutationsInFlight().length;
    await press;
    return { quietAtCheck, fenceUpImmediately, leases };`);
  equal(raced.quietAtCheck, true, "NC-QUIET-3: the project was quiescent when the gate read it");
  equal(raced.fenceUpImmediately, false,
    "NC-QUIET-3 REPRODUCED: the fence was NOT yet up, so new work could start inside the gap");
  equal(raced.leases, 1, "NC-QUIET-3 REPRODUCED: and it did — a lease exists on a transaction that accepted quiescence");
  await mustFail("NC-QUIET-3", "owns the window before quiescence is acted on", async () => {
    equal(raced.fenceUpImmediately, true, "the interaction fence owns the window before quiescence is acted on");
  });
  gate.releaseCompile();
  await evaluateAsync(page.context, `try { await globalThis.__improve; } catch {} return 1;`);
  note("NC-QUIET-3 checking quiescence before taking the fence, with any await between, lets new project-mutating work start after the answer was accepted");
}

/* ---- 4. A LEASE THAT IS NOT RELEASED ON FAILURE. ---------------------- */
const NCQ4_ANCHOR = `  if (typeof releaseProjectAsyncMutationsByKey === "function") releaseProjectAsyncMutationsByKey(key);`;
const NCQ4_BREAK = `  if (typeof releaseProjectAsyncMutationsByKey === "function" && value && value.status === "busy") releaseProjectAsyncMutationsByKey(key);`;

async function ncq4_leaseNotReleased() {
  anchorIn("public/creation-studio.js", NCQ4_ANCHOR, "NC-QUIET-4");
  const gate = quietGate();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCQ4_ANCHOR, NCQ4_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `globalThis.__improve = buildBlockingPrompt("L1-01", true); return 1;`);
  await ncUntilCompile(gate);
  gate.releaseCompile();
  await evaluateAsync(page.context, `try { await globalThis.__improve; } catch {} return 1;`);
  const stranded = evaluate(page.context, `return {
    leases: projectAsyncMutationsInFlight().length, refusal: projectQuiescenceRefusal() };`);
  equal(stranded.leases, 1,
    "NC-QUIET-4 REPRODUCED: the completed operation left its lease behind");
  ok(stranded.refusal.length > 0,
    "NC-QUIET-4 REPRODUCED: so CineBraid believes the project is permanently busy and no creation can ever begin");
  await mustFail("NC-QUIET-4", "released afterwards", async () => {
    equal(stranded.leases, 0, "and released afterwards — a failure never leaves CineBraid believing the project is busy");
  });
  note("NC-QUIET-4 releasing the lease only on the busy path strands it after the operation finishes, and the project can never be created from again");
}

/* ---- 5. ONE OF SEVERAL LEASES REPORTING QUIESCENCE. ------------------- */
async function ncq5_partialQuiescence() {
  const page = await render("#/create", rawFixture(), {
    /* Quiescence answered from the FIRST lease rather than from all of them. */
    mutateSource: replacing("app.js",
      `  if (!pending.length && !automationRunning) return "";`,
      `  if (pending.length <= 1 && !automationRunning) return "";`),
  });
  const seen = evaluate(page.context, `
    const a = beginProjectAsyncMutation("Frame prompt compilation", "frame:L1-01:frame-a");
    const b = beginProjectAsyncMutation("Motion prompt compilation", "motion:L1-01:");
    const both = projectQuiescenceRefusal();
    a.release();
    const afterOne = projectQuiescenceRefusal();
    const inFlightAfterOne = projectAsyncMutationsInFlight().length;
    b.release();
    return { both, afterOne, inFlightAfterOne };`);
  equal(seen.inFlightAfterOne, 1, "NC-QUIET-5: one operation is still pending after the other finishes");
  equal(seen.afterOne, "",
    "NC-QUIET-5 REPRODUCED: yet quiescence is reported, because the answer came from a count rather than from every lease");
  await mustFail("NC-QUIET-5", "releasing one is not quiescence", async () => {
    ok(seen.afterOne.length > 0, "releasing one is not quiescence");
  });
  note("NC-QUIET-5 answering quiescence from anything but ALL pending leases reports a quiet project while an operation is still running");
}

/* ---- 6. THE dirty() SUPPRESSION, RESTORED. ---------------------------- */
/* Kept from the previous slice: the lease registry only helps if the mutation it
   fails to prevent is still recorded honestly. */
const NCQ6_ANCHOR = `function dirty() {
  clearTimeout(saveTimer);`;
const NCQ6_BREAK = `function dirty() {
  clearTimeout(saveTimer);
  if (PROJECT_TRANSITION && PROJECT_TRANSITION_WORK === 0) return;`;

async function ncq6_dirtySuppression() {
  anchorIn("public/app.js", NCQ6_ANCHOR, "NC-QUIET-6");
  const gate = quietGate();
  gate.holdSwitch();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("app.js", NCQ6_ANCHOR, NCQ6_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);
  evaluate(page.context, `
    setCreationStartPath("scratch"); setManualStartField("title", "Film B");
    globalThis.__press = startManualProject(); return 1;`);
  for (let i = 0; i < 400 && gate.calls.filter((row) => row.url === "/api/projects/switch").length === 0; i++) await tick();
  const seen = evaluate(page.context, `
    const beforeDocument = JSON.stringify(P);
    const beforeRevision = SAVE_REVISION;
    P.meta.logline = "BACKGROUND-MUTATION";
    dirty();
    return { changed: JSON.stringify(P) !== beforeDocument,
             revisionMoved: SAVE_REVISION !== beforeRevision,
             settled: projectSaveSettled().settled };`);
  equal(seen.changed, true, "NC-QUIET-6 REPRODUCED: the document changed");
  equal(seen.revisionMoved, false, "NC-QUIET-6 REPRODUCED: and the counters did not");
  equal(seen.settled, true, "NC-QUIET-6 REPRODUCED: so the window reports a settled project it no longer describes");
  await mustFail("NC-QUIET-6", "dirty() recorded it", async () => {
    ok(seen.revisionMoved, "dirty() recorded it, so the window is truthfully unsaved");
  });
  gate.releaseSwitch();
  await evaluateAsync(page.context, `try { await globalThis.__press; } catch {} return 1;`);
  note("NC-QUIET-6 restoring the dirty() suppression reproduces `P changed / counters unchanged / settled true`, which no certificate and no lease can detect");
}

/* ---- AND THE SEAM MUST NOT DEGRADE INTO A LIST OF OPERATIONS. --------- */
function ncq_seamNotAList() {
  const studio = codeOnly(readLF("public/creation-studio.js"));
  const at = studio.indexOf("function setGuidedPromptOp(");
  ok(at >= 0, "NC-QUIET: setGuidedPromptOp is still the seam every prompt build passes through");
  const seam = studio.slice(at, studio.indexOf("\n}", at));
  ok(/beginProjectAsyncMutation\s*\(/.test(seam), "NC-QUIET: and it takes the lease");
  ok(/releaseProjectAsyncMutationsByKey\s*\(/.test(seam), "NC-QUIET: and releases it");
  for (const op of ["buildBlockingPrompt", "buildGuidedFramePrompt", "buildGuidedMotionPrompt", "buildAssetCreationPrompt"]) {
    ok(!new RegExp(op).test(seam),
      `NC-QUIET RETIRED: the seam must not name ${op} — the guarantee is the shared helper, not a list of operations`);
  }
  const app = codeOnly(readLF("public/app.js"));
  const quiescence = app.slice(app.indexOf("function projectQuiescenceRefusal()"),
    app.indexOf("\n}", app.indexOf("function projectQuiescenceRefusal()")));
  ok(/projectAsyncMutationsInFlight\s*\(/.test(quiescence),
    "NC-QUIET: quiescence is answered from the registry, not from a named operation");
  note("NC-QUIET the lease is taken and released at the shared prompt-op helper, which names no operation, and quiescence is answered from the registry");
}
/* ===========================================================================
   NC-AUDIO — THE SCENE-AUDIO LEASE, REMOVED.

   One control, and it restores the closure review's exact reproduction: a pending
   scene-audio build, a manual creation that proceeds anyway, the assistant
   response mutating Film A during the transaction, Film B installing over it, and
   the audio result and its build record going with it.

   Only the scene-audio lease is removed. Every other lease, the modal fence, the
   certificate, the conditional activation and the install ownership check are
   left exactly as shipped — so what this proves is that THIS row was load-bearing.
   =========================================================================== */

const NCA_AUDIO_ANCHOR = `  const lease = typeof beginProjectAsyncMutation === "function"
    ? beginProjectAsyncMutation("Scene audio prompt building", \`scene-audio:\${sceneId}\`)
    : null;`;
const NCA_AUDIO_BREAK = `  const lease = null;`;

function audioGateNC({ createSlug = "film-b", sourceSlug = "film-a" } = {}) {
  const calls = [];
  let activeProject = sourceSlug;
  let releaseAudio = null;
  let releaseSwitch = null;
  const audioGate = new Promise((r) => { releaseAudio = r; });
  const switchGate = new Promise((r) => { releaseSwitch = r; });
  let holdSwitch = false;
  return {
    calls,
    releaseAudio: () => releaseAudio(),
    releaseSwitch: () => releaseSwitch(),
    holdSwitch() { holdSwitch = true; },
    creates: () => calls.filter((row) => row.url === "/api/projects/new"),
    switchCalls: () => calls.filter((row) => row.url === "/api/projects/switch"),
    hook: async (url, options, respond) => {
      const method = (options && options.method) || "GET";
      const body = String((options && options.body) || "");
      calls.push({ url, method, body });
      if (url === "/api/llm/build-scene-audio-prompts") {
        await audioGate;
        return respond({
          result: {
            elevenLabsPrompt: "AUDIO-MUSIC-RESULT", sunoPrompt: "AUDIO-SUNO-RESULT",
            ambiencePrompt: "AUDIO-AMBIENCE-RESULT", audioNotes: "AUDIO-NOTES-RESULT",
            summary: "Model-ready scene audio prompts created.", changes: [],
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
          if (holdSwitch) await switchGate;
          return respond({ ok: false, code: "PROJECT_ACTIVE_CONFLICT", error: "changed", activeProject }, 409);
        }
        activeProject = String(request.slug || activeProject);
        if (holdSwitch) await switchGate;
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
        return respond({ ok: true, revision: `rev-${calls.length}` }, 200, { "x-cinebraid-project-revision": `rev-${calls.length}` });
      }
      return null;
    },
  };
}

async function nca_sceneAudioLeaseRemoved() {
  anchorIn("public/audio-prompt-builder.js", NCA_AUDIO_ANCHOR, "NC-AUDIO");
  const gate = audioGateNC();
  gate.holdSwitch();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("audio-prompt-builder.js", NCA_AUDIO_ANCHOR, NCA_AUDIO_BREAK),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  evaluate(page.context, `ACTIVE_PROJECT_SLUG = "film-a"; return 1;`);

  /* 1-3. The scene audio build is running, its response held. */
  evaluate(page.context, `globalThis.__audio = buildSceneAudioPrompts("SC-01"); return 1;`);
  for (let i = 0; i < 400 && !gate.calls.some((row) => row.url === "/api/llm/build-scene-audio-prompts"); i++) await tick();
  const undeclared = evaluate(page.context, `return {
    leases: projectAsyncMutationsInFlight().length, refusal: projectQuiescenceRefusal() };`);
  equal(undeclared.leases, 0, "NC-AUDIO REPRODUCED: the pending audio build declares nothing");
  equal(undeclared.refusal, "",
    "NC-AUDIO REPRODUCED: so the project reports itself quiescent while the assistant round trip is open");

  /* 4. The creation proceeds anyway. */
  evaluate(page.context, `
    setCreationStartPath("scratch");
    setManualStartField("title", "Film B");
    globalThis.__press = startManualProject();
    return 1;`);
  for (let i = 0; i < 400 && gate.switchCalls().length === 0; i++) await tick();
  equal(gate.creates().length, 1,
    "NC-AUDIO REPRODUCED: Film B is created while the audio build is still pending");

  /* 5-6. The response lands during the transaction and mutates Film A. */
  gate.releaseAudio();
  await evaluateAsync(page.context, `try { await globalThis.__audio; } catch {} return 1;`);
  const mutated = evaluate(page.context, `
    const audio = (sceneById("SC-01") || {}).audio || {};
    return { music: audio.music || "", builds: (audio.promptBuilds || []).length };`);
  equal(mutated.music, "AUDIO-MUSIC-RESULT",
    "NC-AUDIO REPRODUCED: the assistant response wrote the audio prompts onto Film A mid-transaction");
  ok(mutated.builds > 0, "NC-AUDIO REPRODUCED: with its build record");

  /* 7. And Film B installs over it. */
  gate.releaseSwitch();
  await evaluateAsync(page.context, `try { await globalThis.__press; } catch {} return 1;`);
  const lost = evaluate(page.context, `
    const audio = (sceneById("SC-01") || {}).audio || {};
    return { title: P.meta.title, music: audio.music || "", builds: (audio.promptBuilds || []).length };`);
  equal(lost.title, "Film B", "NC-AUDIO REPRODUCED: Film B installed over the newer Film A");
  equal(lost.music, "", "NC-AUDIO REPRODUCED: and the audio result is gone with it");
  equal(lost.builds, 0, "NC-AUDIO REPRODUCED: including its build record");

  /* AND THE GUARANTEE GOES RED AGAINST IT. */
  await mustFail("NC-AUDIO", "Film B is not created while the audio build is pending", async () => {
    equal(gate.creates().length, 0, "Film B is not created while the audio build is pending");
  });
  note("NC-AUDIO removing only the scene-audio lease restores the closure review's exact reproduction: the pending assistant response mutates Film A during the transaction and Film B installs over the audio result and its build record");
}
async function main() {
  await nc_b1_resolvedFlushIsNotSaved();
  await nc_b2_openProjectWriterReturns();
  await nc_b3_deletionWithoutRevocation();
  await ncr1_unconditionalLoad();
  await ncr2_booleanWithoutIdentity();
  await ncr3_identityWithoutRevision();
  rb1r_replacementFenceRetirement();
  await nc_active_activationAtCreation();
  await ncf1_unconditionalSwitch();
  await ncf3_serverConditionRemoved();
  await ncf6_lockRemoved();
  await ncf_structuralShapes();
  await ncm_fenceRemoved();
  await ncm3_dirtySuppressionRestored();
  await ncm4_installOwnershipRemoved();
  await ncm5_fenceNeverReleases();
  ncm_fenceNotAList();
  await ncq0_shippedReproduction();
  await ncq1_leaseNotTaken();
  await ncq2_settledOnly();
  await ncq3_checkThenLockGap();
  await ncq4_leaseNotReleased();
  await ncq5_partialQuiescence();
  await ncq6_dirtySuppression();
  ncq_seamNotAList();
  await nca_sceneAudioLeaseRemoved();
  console.log(`AT1 boundary corrections negative controls: ${checks} checks passed`);
  for (const line of notes) console.log("  - " + line);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
