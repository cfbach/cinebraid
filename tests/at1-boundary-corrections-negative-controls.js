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

async function main() {
  await nc_b1_resolvedFlushIsNotSaved();
  await nc_b2_openProjectWriterReturns();
  await nc_b3_deletionWithoutRevocation();
  console.log(`AT1 boundary corrections negative controls: ${checks} checks passed`);
  for (const line of notes) console.log("  - " + line);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
