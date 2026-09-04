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
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const { Kernel } = require("./authority-kernel-private");
const { render, rawFixture, withCanon } = require("./render-harness.js");
const seam = require(path.join(ROOT, "authority-write-seam"));

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

const NCR_ANCHOR = `  let refusal = typeof createReplacementRefusal === "function"
    ? createReplacementRefusal(certificate)
    : "";`;
/* 1. NO POST-RESPONSE VALIDATION AT ALL. This is the shipped defect: the
      pre-POST verdict is treated as a permit to replace, later. */
const NCR_UNCONDITIONAL = `  let refusal = "";`;
/* 2. A BOOLEAN, RE-ASKED, BUT NOT TIED TO WHICH PROJECT IT IS ABOUT. */
const NCR_BOOLEAN_ONLY = `  let refusal = projectSaveSettled().settled ? "" : "the project you have open is not saved";`;
/* 3. IDENTITY ONLY, NOT TIED TO THE PROJECT'S LATEST SAVED REVISION. */
const NCR_IDENTITY_ONLY = `  let refusal = (certificate && certificate.slug === ACTIVE_PROJECT_SLUG && certificate.epoch === PROJECT_OPEN_EPOCH) ? "" : "different project";`;

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
  anchorIn("public/creation-studio.js", NCR_ANCHOR, "NC-B1R-1");

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
  evaluate(page.context, `P.meta.logline = "EDIT-DURING-CREATE"; dirty(); return 1;`);
  const marker = gate.marker();
  gate.release();
  await settle(page.context);

  const seen = evaluate(page.context, `return { hash: location.hash };`);
  const reloads = gate.since(marker).filter((row) => row.url === "/api/project").length;

  /* THE DEFECT IS GENUINELY VISIBLE: the project was replaced anyway. */
  ok(reloads >= 1, "NC-B1R-1 REPRODUCED: the reverted build loads Film B despite the refused intervening save");
  equal(seen.hash, "#/production", "NC-B1R-1 REPRODUCED: and moves the window into it");

  await mustFail("NC-B1R-1", "Film B is not loaded", async () => {
    equal(reloads, 0, "Film B is not loaded — no project read followed the refused save");
  });
  note("NC-B1R-1 removing the post-response validation restores `save once -> POST -> unconditional load`: Film B loads on top of a refused intervening save");
}

async function ncr2_booleanWithoutIdentity() {
  anchorIn("public/creation-studio.js", NCR_ANCHOR, "NC-B1R-2");

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
  const reloads = gate.since(marker).filter((row) => row.url === "/api/project").length;

  ok(reloads >= 1,
    "NC-B1R-2 REPRODUCED: a stale create response replaces whichever project is now open");
  await mustFail("NC-B1R-2", "does not blindly replace", async () => {
    equal(reloads, 0, "a stale create response does not blindly replace whichever project is now open");
  });
  note("NC-B1R-2 re-asking projectSaveSettled() after the POST without tying it to the project the creation began from lets a stale response replace a different film");
}

async function ncr3_identityWithoutRevision() {
  anchorIn("public/creation-studio.js", NCR_ANCHOR, "NC-B1R-3");

  const gate = racingFetch();
  const page = await render("#/create", rawFixture(), {
    fetch: gate.hook,
    mutateSource: replacing("creation-studio.js", NCR_ANCHOR, NCR_IDENTITY_ONLY),
  });
  await evaluateAsync(page.context, `await flushPendingProjectSave(); return 1;`);
  startPress(page.context);
  await untilInFlight(gate);
  gate.setSaveStatus(422, { error: "Project failed validation.", code: "PROJECT_VALIDATION_FAILED" });
  evaluate(page.context, `P.meta.logline = "EDIT-THEN-REFUSED"; dirty(); return 1;`);
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

  const reloads = gate.since(marker).filter((row) => row.url === "/api/project").length;
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

/* R-B1R — THE RETIREMENT. The shape `POST then load()` with nothing between them
   must not come back, whatever the checks are renamed to. */
function rb1r_replacementFenceRetirement() {
  const studio = codeOnly(readLF("public/creation-studio.js"));
  const at = studio.indexOf("async function startManualProjectCommit(");
  ok(at >= 0, "R-B1R: startManualProjectCommit is still the commit");
  const body = studio.slice(at, studio.indexOf("\n}", at));

  const postAt = body.indexOf('fetch("/api/projects/new"');
  const loadAt = body.indexOf("await load()");
  ok(postAt >= 0 && loadAt > postAt, "R-B1R: it still POSTs the creation and then opens the project");

  const between = body.slice(postAt, loadAt);
  ok(/createReplacementRefusal\s*\(/.test(between),
    "R-B1R RETIRED: the replacement must be validated between the create response and load() — "
    + "`save once -> POST -> unconditional load` must not come back");
  ok(/createReplacementCertificate\s*\(/.test(body),
    "R-B1R: and the validation is against a certificate taken before the POST, not a fresh boolean");
  /* The certificate must be taken BEFORE the request, or it certifies the wrong
     moment and the whole fence is decorative. */
  ok(body.indexOf("createReplacementCertificate(") < postAt,
    "R-B1R: the certificate is taken before the create request goes out");
  /* And nothing may be awaited between the final verdict and the replacement. */
  const verdictAt = body.lastIndexOf("if (refusal) {");
  const commitAt = body.indexOf("await load()");
  ok(verdictAt >= 0 && commitAt > verdictAt, "R-B1R: the final verdict precedes the replacement");
  ok(!/await\s+(?!load\(\))/.test(body.slice(body.indexOf("/* ---- COMMIT"), commitAt)),
    "R-B1R RETIRED: nothing may be awaited between the final verdict and load(), or the answer is stale again");
  note("R-B1R the create response is never acted on without validating the certificate taken before it, and nothing is awaited between that verdict and the replacement");
}

async function main() {
  await nc_b1_resolvedFlushIsNotSaved();
  await nc_b2_openProjectWriterReturns();
  await nc_b3_deletionWithoutRevocation();
  await ncr1_unconditionalLoad();
  await ncr2_booleanWithoutIdentity();
  await ncr3_identityWithoutRevision();
  rb1r_replacementFenceRetirement();
  console.log(`AT1 boundary corrections negative controls: ${checks} checks passed`);
  for (const line of notes) console.log("  - " + line);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
