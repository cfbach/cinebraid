/* Post-Authority-Write-Seam save truth: F-3 and F-4.
 *
 * Two non-blocking client findings from the independent Authority Write Seam V1
 * review. Neither is about the seam's semantics - the server is correct and is
 * not changed here. Both are about the browser telling the filmmaker something
 * that is not true about their own save.
 *
 * F-3  THE BROWSER BRANCHED ON HTTP 422 ALONE. The Authority Write Seam refuses a
 *      Canon policy violation with 422, and ordinary project validation refuses
 *      with 422 as well. Every one of them was presented as
 *
 *          "Production authority was not changed"
 *          "Not saved - approval change refused"
 *
 *      and offered REBASE & RETRY. So a document that merely failed validation
 *      was reported as a refused approval, and the single offered action re-read
 *      the stored baseline and resent the SAME document - an action that cannot
 *      resolve a validation failure no matter how many times it is taken.
 *
 * F-4  THE BROWSER SENT If-Match: "*" WHEN IT HAD NO REVISION. The seam requires
 *      an exact revision, so "*" could only ever be answered 409
 *      PROJECT_REVISION_CONFLICT - which the browser then presented as "this
 *      project changed while this view was open". Nobody had changed anything.
 *      A local precondition failure was being reported as somebody else's edit.
 *
 * WHAT THIS SUITE PROVES, in the order the review asked for it:
 *
 *   1. a genuine CANON_TRANSITION_REQUIRED 422 still gets the authority surface
 *   2. PROJECT_VALIDATION_FAILED does not claim authority was refused
 *   3. PROJECT_VALIDATION_FAILED does not offer a rebase that cannot help
 *   4. a missing revision puts NOTHING on the wire, and never If-Match "*"
 *   5. a genuine stale revision still follows the conflict/reload path
 *   6. an ordinary successful save is byte-for-byte the same act it was
 *   7. no refusal retries by itself, and no refusal writes anything durable
 *   8. and no deferred work QUEUED BEFORE the refusal retries after the resume
 *
 * CLAIM 8 IS THE HOLD CORRECTION. Independent review reproduced this against the
 * first candidate: open an older-schema project, and load() queues its migration
 * write-back as `setTimeout(() => dirty(), 50)`. Edit and flush before that fires,
 * take a 422, and the refusal correctly enters SAVE_BLOCKED - but it only cleared
 * `saveTimer`, and the migration callback was never in `saveTimer`. Resuming then
 * let that stale callback call dirty(), and a SECOND PUT went out at ~590ms
 * carrying the same revision and the same refused body, with no user edit behind
 * it. Section 8 pins it on a real clock, past both the 50ms trigger and the 500ms
 * autosave debounce.
 *
 * IT CARRIES ITS OWN NEGATIVE CONTROLS. Each reintroduces exactly one of the two
 * defects in memory, through the render harness's `mutateSource` hook - nothing
 * on disk is touched - observes the defect behaviourally first, and only then
 * requires the guarding section to go red.
 */
const assert = require("assert");
const vm = require("vm");

const { render, buildFixture } = require("./render-harness");

const SLUG = "fixture";
const R0 = '"0000000000000000000000000000000000000000000000000000000000000000"';
const R1 = '"1111111111111111111111111111111111111111111111111111111111111111"';

const CANON_REFUSAL = {
  ok: false,
  code: "CANON_TRANSITION_REQUIRED",
  error: "This ordinary save would change production authority. Use the explicit Canon transition protocol.",
  targets: [{ targetKey: "shot-frame:SH-01#fr-a", value: "A.png", assetId: "" }],
};
const VALIDATION_REFUSAL = {
  ok: false,
  code: "PROJECT_VALIDATION_FAILED",
  error: "Project validation failed.",
  issues: ["shots[0].dur must be a positive number"],
};
const STALE_REFUSAL = {
  ok: false,
  code: "PROJECT_REVISION_CONFLICT",
  error: "The project changed before this write, so the entire operation was refused.",
  action: "reload",
  revision: R1,
};
const REVISION_REQUIRED_REFUSAL = {
  ok: false,
  code: "PROJECT_REVISION_REQUIRED",
  error: "This write did not identify the project revision it read.",
};

/* Drain the loop until a CONDITION holds, never for a duration - the discipline
   tests/project-save-revision-race.js established for this same code path. */
async function settle(turns = 200) {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/* SECTION 8 IS THE ONE PLACE THAT MUST WAIT ON A REAL CLOCK. The retry it forbids
   is produced by two chained macrotask timers, and no amount of microtask draining
   reaches either - a settle()-only guard would report success against a build that
   still retries. Both durations are the product's own. */
const MIGRATION_TRIGGER_MS = 50;   // load()'s deferred migration write-back
const AUTOSAVE_DEBOUNCE_MS = 500;  // dirty()'s debounce
const PAST_BOTH_TIMERS_MS = MIGRATION_TRIGGER_MS + AUTOSAVE_DEBOUNCE_MS + 350;
const realDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The stored schema older than this build, which is what makes load() queue the
   migration write-back at all. Stated here rather than inherited from the fixture,
   so section 8 cannot quietly stop reproducing if the fixture is ever refreshed. */
function olderSchemaProject() {
  const project = buildFixture();
  project.meta.hubVersion = "v5.5.0";
  return project;
}
function currentSchemaProject() {
  const project = buildFixture();
  project.meta.hubVersion = "v6.0.0";
  project.meta.schemaVersion = "6.7";
  return project;
}

/* The transcript of what the browser actually put on the wire. `hasIfMatch` is
   recorded separately from its value, because "the header was absent" and "the
   header was empty" are different claims and F-4 is about the first one. */
function wireRecorder(replyFor = () => ({ status: 200 })) {
  const requests = [];
  return {
    requests,
    async fetch(url, options, response) {
      const ordinary = /^\/api\/projects\/[^/]+\/project$/.test(url) && options.method === "PUT";
      const transition = /^\/api\/projects\/[^/]+\/canon-transition$/.test(url) && options.method === "POST";
      if (!ordinary && !transition) return null;
      const headers = options.headers || {};
      const body = JSON.parse(options.body || "{}");
      const index = requests.length;
      const record = {
        index,
        url,
        method: options.method,
        hasIfMatch: Object.prototype.hasOwnProperty.call(headers, "If-Match"),
        ifMatch: headers["If-Match"],
        title: (transition ? body.successor : body)?.shots?.[0]?.title || "",
      };
      requests.push(record);
      const reply = replyFor(index) || { status: 200 };
      record.status = reply.status || 200;
      if (record.status === 200) return response({ ok: true, revision: R1 });
      return response(reply.body || {}, record.status);
    },
  };
}

async function viewInStepWithStorage(harness, options = {}) {
  const rendered = await render("#/production", options.project || buildFixture(), { ...options, fetch: harness.fetch });
  vm.runInContext(
    `ACTIVE_PROJECT_SLUG = ${JSON.stringify(SLUG)};`
    + ` PROJECT_REVISION = ${JSON.stringify(options.revision === undefined ? R0 : options.revision)};`
    + " PROJECT_CONFLICT = false; SAVE_BLOCKED = false; AUTHORITY_SAVE_REFUSED = false;",
    rendered.context,
  );
  return rendered.context;
}

const surfaces = (context) => vm.runInContext(`({
  modal: document.getElementById("modal").innerHTML,
  saveState: document.getElementById("save-state").querySelector("span:last-child").textContent,
  toast: document.getElementById("toast").textContent,
  conflict: PROJECT_CONFLICT,
  authorityRefused: AUTHORITY_SAVE_REFUSED,
  blocked: SAVE_BLOCKED,
  revision: PROJECT_REVISION,
  title: P.shots[0].title,
})`, context);

async function saveOnce(context, title) {
  return vm.runInContext(`(async () => {
    P.shots[0].title = ${JSON.stringify(title)};
    await queueProjectSave(captureProjectSave());
  })()`, context);
}

/* The claim every refusal section makes together: after the refusal, the most
   forceful save the product can make - an edit plus an explicit flush - puts
   nothing further on the wire. */
async function provePausedRatherThanRetrying(context, harness, label) {
  const before = harness.requests.length;
  await vm.runInContext(`(async () => {
    P.shots[0].title = "an edit made after the refusal";
    dirty();
    await flushPendingProjectSave();
    await SAVE_CHAIN;
  })()`, context);
  await settle();
  assert.strictEqual(harness.requests.length, before,
    `${label}: the refusal must pause saving, not retry it - ${harness.requests.length - before} further request(s) were sent`);
  assert.strictEqual(vm.runInContext("P.shots[0].title", context), "an edit made after the refusal",
    `${label}: the filmmaker's later edit must still be in this tab`);
  /* A paused view must not rest on the dirty state, whose mirrored wording is
     "saving in a moment". A latched CONFLICT is a different, accepted surface
     whose only action is the modal's reload, and is not restated here. */
  if (vm.runInContext("SAVE_BLOCKED", context))
    assert.strictEqual(
      vm.runInContext('document.getElementById("save-state").querySelector("span:last-child").textContent', context),
      "Not saved — saving is paused",
      `${label}: the indicator must not rest on "saving in a moment" while saving is paused`);
}

/* ===========================================================================
   1. A genuine authority refusal is still an authority refusal. */
async function canonRefusalSection(options = {}) {
  const harness = wireRecorder(() => ({ status: 422, body: CANON_REFUSAL }));
  const context = await viewInStepWithStorage(harness, options);
  await saveOnce(context, "an edit that would move production authority");
  const state = surfaces(context);

  assert.strictEqual(harness.requests.length, 1, "the save must have been attempted");
  assert.strictEqual(state.authorityRefused, true, "a Canon policy refusal must latch the authority refusal");
  assert.strictEqual(state.conflict, false, "and it is not a stale-document conflict");
  assert(/Production authority was not changed/.test(state.modal),
    "CANON_TRANSITION_REQUIRED keeps the authority surface");
  assert(/REBASE &amp; RETRY/.test(state.modal) && /rebaseAuthoritySave\(\)/.test(state.modal),
    "and keeps the rebase action, which for an authority refusal genuinely can resolve it");
  assert(/shot-frame:SH-01#fr-a/.test(state.modal), "the protected target is still named");
  assert.strictEqual(state.saveState, "Not saved — approval change refused");
  assert.strictEqual(state.title, "an edit that would move production authority",
    "the refused edit batch stays in this tab");
  console.log("  canon-refusal - CANON_TRANSITION_REQUIRED still receives the authority-refusal surface and its rebase action");
}

/* ===========================================================================
   2 + 3. A validation failure is reported as a validation failure, and is not
   offered an action that cannot resolve it. */
async function validationRefusalSection(options = {}) {
  const harness = wireRecorder(() => ({ status: 422, body: VALIDATION_REFUSAL }));
  const context = await viewInStepWithStorage(harness, options);
  await saveOnce(context, "an ordinary edit to a document the server will not accept");
  const state = surfaces(context);

  assert.strictEqual(harness.requests.length, 1, "the save must have been attempted");
  assert.strictEqual(state.authorityRefused, false,
    "THE FINDING: a project validation failure must not latch the authority refusal");

  /* Read as one surface, because a filmmaker reads it as one: the dialog, the
     indicator by the project title, and the toast. */
  const spoken = `${state.modal}\n${state.saveState}\n${state.toast}`;
  assert(!/authority/i.test(spoken),
    `THE FINDING: nothing shown may claim authority was involved:\n${spoken}`);
  assert(!/approval/i.test(spoken), `nor that an approval was refused:\n${spoken}`);
  assert(!/\bREBASE\b/i.test(spoken) && !/rebaseAuthoritySave/.test(state.modal),
    `THE FINDING: rebasing re-reads the stored baseline and resends the same document, so it cannot resolve a validation failure and must not be offered:\n${spoken}`);
  assert(!/changed while this view was open/.test(spoken),
    "and it is not presented as somebody else's edit either");

  assert(/did not pass validation/i.test(state.modal), "it says what actually happened");
  assert(/shots\[0\]\.dur must be a positive number/.test(state.modal),
    "and it repeats the server's own issue, which is the only actionable part");
  assert.strictEqual(state.saveState, "Not saved — project failed validation");
  assert.strictEqual(state.blocked, true, "saving pauses rather than repeating a refused body");
  assert.strictEqual(state.title, "an ordinary edit to a document the server will not accept",
    "and the unsaved work is still in this tab");

  await provePausedRatherThanRetrying(context, harness, "validation");

  /* The pause is a pause, not a dead end: resuming is an explicit act the
     filmmaker takes, never something the browser does on its own. */
  vm.runInContext("resumeProjectSaving();", context);
  assert.strictEqual(vm.runInContext("SAVE_BLOCKED", context), false,
    "the filmmaker can resume saving deliberately");
  console.log("  validation-refusal - PROJECT_VALIDATION_FAILED is reported as validation, claims no authority, offers no rebase, and pauses instead of retrying");
}

/* ===========================================================================
   4. No revision means no request - and never a wildcard. */
async function missingRevisionSection(options = {}) {
  const harness = wireRecorder(() => ({ status: 200 }));
  const context = await viewInStepWithStorage(harness, { ...options, revision: "" });
  await saveOnce(context, "an edit made by a view that never learned its revision");
  await settle();
  const state = surfaces(context);

  assert.deepStrictEqual(harness.requests.map((row) => row.ifMatch), [],
    `THE FINDING: a view with no revision must put NOTHING on the wire, and it sent ${JSON.stringify(harness.requests.map((row) => row.ifMatch))}`);
  assert(!harness.requests.some((row) => row.ifMatch === "*"),
    "and specifically never the wildcard the Authority Write Seam can only refuse");
  assert.strictEqual(state.conflict, false,
    "THE FINDING: this is a local save precondition, not a manufactured project conflict");
  assert.strictEqual(state.authorityRefused, false, "and nothing about it is an authority refusal");
  assert.strictEqual(state.blocked, true, "the view stops saving rather than sending a write it cannot make safe");
  assert(!/changed while this view was open/.test(state.modal),
    "and it does not tell the filmmaker somebody else edited their project");
  assert(/cannot identify the project revision|cannot save safely/i.test(`${state.modal}\n${state.saveState}`),
    `it names the actual problem:\n${state.modal}`);
  assert.strictEqual(state.title, "an edit made by a view that never learned its revision",
    "the unsaved work is still in this tab");

  /* The same rule for a job belonging to a project this view has left: its own
     captured revision is missing, so it is not sent either. */
  await vm.runInContext(`queueProjectSave({ slug: "left-behind", revision: 99,
    documentRevision: "", body: JSON.stringify(P) })`, context);
  await settle();
  assert.strictEqual(harness.requests.length, 0,
    "a queued save for another project with no captured revision is not sent with a wildcard either");

  await provePausedRatherThanRetrying(context, harness, "missing-revision");
  console.log("  missing-revision - a view with no revision sends nothing, reports a save precondition rather than a conflict, and does not retry");
}

/* ===========================================================================
   5. The guarantee that must not weaken. */
async function staleRevisionSection(options = {}) {
  const harness = wireRecorder(() => ({ status: 409, body: STALE_REFUSAL }));
  const context = await viewInStepWithStorage(harness, options);
  await saveOnce(context, "written by a view that has fallen behind");
  const state = surfaces(context);

  assert.strictEqual(harness.requests.length, 1, "the stale save is attempted exactly once");
  assert.strictEqual(harness.requests[0].ifMatch, R0,
    "it carries the exact revision this view read, so the server's check still fires");
  assert.strictEqual(state.conflict, true, "a genuine 409 still latches the conflict");
  assert(/changed while this view was open/.test(state.modal), "and still says so");
  assert(/RELOAD PROJECT/.test(state.modal), "offering the reload that genuinely resolves it");
  await provePausedRatherThanRetrying(context, harness, "stale-revision");
  console.log("  stale-revision - a genuine 409 still latches the conflict, keeps the reload path, and stops writing");
}

/* 5b. 428 is the same precondition F-4 is about, arriving from the server rather
   than caught locally - so it is not a conflict either. */
async function revisionRequiredSection(options = {}) {
  const harness = wireRecorder(() => ({ status: 428, body: REVISION_REQUIRED_REFUSAL }));
  const context = await viewInStepWithStorage(harness, options);
  await saveOnce(context, "a save whose revision never reached the server");
  const state = surfaces(context);

  assert.strictEqual(state.conflict, false,
    "428 PROJECT_REVISION_REQUIRED is not a conflict: nothing changed the project");
  assert.strictEqual(state.blocked, true, "it is the same save precondition, reported the same way");
  assert(!/changed while this view was open/.test(state.modal),
    "so it must not borrow the conflict wording either");
  console.log("  revision-required - a 428 is reported as the save precondition it is, not as somebody else's edit");
}

/* ===========================================================================
   6. The ordinary case is untouched. */
async function successfulSaveSection(options = {}) {
  const harness = wireRecorder(() => ({ status: 200 }));
  const context = await viewInStepWithStorage(harness, options);
  await saveOnce(context, "an ordinary edit");
  const state = surfaces(context);

  assert.strictEqual(harness.requests.length, 1, "one save, one request");
  assert.strictEqual(harness.requests[0].hasIfMatch, true, "an ordinary save still identifies what it read");
  assert.strictEqual(harness.requests[0].ifMatch, R0, "with the exact revision, unchanged by this repair");
  assert.strictEqual(harness.requests[0].title, "an ordinary edit", "and it carries the edit");
  assert.strictEqual(state.revision, R1, "the view ends in step with what it stored");
  assert.deepStrictEqual(
    { conflict: state.conflict, authorityRefused: state.authorityRefused, blocked: state.blocked },
    { conflict: false, authorityRefused: false, blocked: false },
    "and nothing is latched by a save that succeeded",
  );
  assert.strictEqual(state.saveState, "Saved");
  assert.strictEqual(state.modal, "", "a successful save shows the filmmaker nothing at all");
  console.log("  successful-save - a normal save is unchanged: exact revision, one request, no dialog, no latch");
}

/* ===========================================================================
   8. THE HOLD CORRECTION: deferred work queued BEFORE the refusal. */
async function refusedOlderSchemaView(harness, options = {}) {
  const context = await viewInStepWithStorage(harness, { ...options, project: olderSchemaProject() });

  /* THE PRECONDITION, AS A RECEIPT RATHER THAN AN ASSUMPTION. If a slow machine
     let the 50ms trigger fire before the refusal, the reproduction never happened
     and every assertion below would pass having tested nothing. This fails loudly
     instead. */
  assert.strictEqual(vm.runInContext("PENDING_SAVE_TRIGGERS.size", context), 1,
    "the older-schema open must have queued the migration write-back AND it must not have fired yet");

  await vm.runInContext(`(async () => {
    P.shots[0].title = "an edit the server will not accept";
    dirty();
    await flushPendingProjectSave();
    await SAVE_CHAIN;
  })()`, context);

  assert.strictEqual(harness.requests.length, 1, "exactly one PUT reached the server");
  assert.strictEqual(vm.runInContext("SAVE_BLOCKED", context), true, "and it was refused into the block");
  return context;
}

async function pendingTriggerSection(options = {}) {
  const harness = wireRecorder((index) => (index === 0 ? { status: 422, body: VALIDATION_REFUSAL } : { status: 200 }));
  const context = await refusedOlderSchemaView(harness, options);

  /* Read now, asserted after the wait: the BEHAVIOUR is the claim, and the empty
     registry is how it is achieved. Asserting the mechanism first would make a
     build that still retries fail for the tidier reason instead of the true one. */
  const pendingAfterBlock = vm.runInContext("PENDING_SAVE_TRIGGERS.size", context);

  /* Resumed BEFORE that trigger would have fired - the reproduction exactly. */
  vm.runInContext("resumeProjectSaving();", context);
  assert.strictEqual(harness.requests.length, 1, "resuming must not itself send anything");

  await realDelay(PAST_BOTH_TIMERS_MS);
  assert.strictEqual(harness.requests.length, 1,
    `THE BLOCKER: work queued before the refusal sent a second PUT after the resume - ${JSON.stringify(harness.requests.map((row) => ({ ifMatch: row.ifMatch, title: row.title })))}`);
  assert.strictEqual(pendingAfterBlock, 0,
    "THE CORRECTION: entering the block must drop the trigger that was queued before it");
  assert.strictEqual(vm.runInContext("P.shots[0].title", context), "an edit the server will not accept",
    "the unsaved edit is still in this tab");
  assert.strictEqual(vm.runInContext("SAVE_BLOCKED", context), false, "and saving is re-armed");

  /* RE-ARMED MEANS RE-ARMED. The next edit the filmmaker actually makes saves,
     exactly once, because this project is now one the server accepts. */
  await vm.runInContext(`(async () => {
    P.shots[0].title = "a later edit the filmmaker made";
    dirty();
    await flushPendingProjectSave();
    await SAVE_CHAIN;
  })()`, context);
  await realDelay(PAST_BOTH_TIMERS_MS);
  assert.strictEqual(harness.requests.length, 2, "a later user-driven edit saves exactly once");
  assert.strictEqual(harness.requests[1].title, "a later edit the filmmaker made");
  assert.strictEqual(vm.runInContext("SAVE_BLOCKED", context), false, "and it is not blocked by a save that succeeded");
  console.log("  pending-trigger - a migration write-back queued before the refusal is dropped by the block, sends nothing after the resume, and does not stop the next real edit saving");
}

/* 8b. The same resume when the document is STILL invalid: one further refusal
   for the one further edit, and still no retry of its own. */
async function stillInvalidAfterResumeSection(options = {}) {
  const harness = wireRecorder(() => ({ status: 422, body: VALIDATION_REFUSAL }));
  const context = await refusedOlderSchemaView(harness, options);
  vm.runInContext("resumeProjectSaving();", context);
  await realDelay(PAST_BOTH_TIMERS_MS);
  assert.strictEqual(harness.requests.length, 1, "the resume alone still sends nothing");

  await vm.runInContext(`(async () => {
    P.shots[0].title = "a later edit into a document the server still refuses";
    dirty();
    await flushPendingProjectSave();
    await SAVE_CHAIN;
  })()`, context);
  await realDelay(PAST_BOTH_TIMERS_MS);
  assert.strictEqual(harness.requests.length, 2,
    "the later edit is attempted exactly once and refused exactly once");
  const state = surfaces(context);
  assert.strictEqual(state.blocked, true, "the second refusal blocks again");
  assert.strictEqual(state.authorityRefused, false, "and still claims nothing about authority");
  assert(!/authority|approval|REBASE/i.test(`${state.modal}\n${state.saveState}`),
    `the second refusal must stay as truthful as the first:\n${state.modal}`);
  console.log("  still-invalid-after-resume - a resume into a still-invalid document costs exactly one further edit and one further truthful refusal");
}

/* 8c. Control: without the resume, the block holds on its own. */
async function blockedWithoutResumeSection(options = {}) {
  const harness = wireRecorder(() => ({ status: 422, body: VALIDATION_REFUSAL }));
  const context = await refusedOlderSchemaView(harness, options);
  await realDelay(PAST_BOTH_TIMERS_MS);
  assert.strictEqual(harness.requests.length, 1,
    "a block that is never resumed must stay at one PUT past both timers");
  assert.strictEqual(vm.runInContext("SAVE_BLOCKED", context), true, "and stay blocked");
  console.log("  blocked-without-resume - the block holds past both timers when nothing resumes it");
}

/* 8d. Control: a current-schema project queues no trigger at all, so its resume
   has nothing to retry either. The contrast is what makes 8 a claim about the
   queued trigger rather than about resuming. */
async function currentSchemaControlSection(options = {}) {
  const harness = wireRecorder((index) => (index === 0 ? { status: 422, body: VALIDATION_REFUSAL } : { status: 200 }));
  const context = await viewInStepWithStorage(harness, { ...options, project: currentSchemaProject() });
  assert.strictEqual(vm.runInContext("PENDING_SAVE_TRIGGERS.size", context), 0,
    "a current-schema open must queue no migration write-back");
  await vm.runInContext(`(async () => {
    P.shots[0].title = "an edit the server will not accept";
    dirty();
    await flushPendingProjectSave();
    await SAVE_CHAIN;
  })()`, context);
  assert.strictEqual(harness.requests.length, 1);
  vm.runInContext("resumeProjectSaving();", context);
  await realDelay(PAST_BOTH_TIMERS_MS);
  assert.strictEqual(harness.requests.length, 1,
    "a current-schema view must not produce a hidden retry after the resume either");
  console.log("  current-schema-control - a project with no queued trigger has nothing to retry, before or after the resume");
}

/* ===========================================================================
   NEGATIVE CONTROLS. */
const REPAIRED_BRANCH = `      if (r.status === 422) {
        if (ACTIVE_PROJECT_SLUG === job.slug) {
          if (isAuthorityRefusalCode(data?.code)) authoritySaveRefusal(data, job);
          else projectSaveRefusal(data);
        }
        return;
      }`;
const STATUS_ONLY_BRANCH = `      if (r.status === 422) {
        if (ACTIVE_PROJECT_SLUG === job.slug) authoritySaveRefusal(data, job);
        return;
      }`;
const REPAIRED_PRECONDITION = `    const documentRevision =
      (ACTIVE_PROJECT_SLUG === job.slug ? PROJECT_REVISION : job.documentRevision) || "";
    if (!documentRevision) {
      if (ACTIVE_PROJECT_SLUG === job.slug) saveRevisionUnavailable();
      return;
    }`;
const WILDCARD_FALLBACK = `    const documentRevision =
      (ACTIVE_PROJECT_SLUG === job.slug ? PROJECT_REVISION : job.documentRevision) || "*";`;
/* The block as the reviewed candidate wrote it - clearing only `saveTimer` - and
   the loose timer the migration write-back used to be scheduled with. */
const REPAIRED_BLOCK = `function blockSaving() {
  if (PROJECT_POST_COMMIT_DEPTH > 0) return refuseFromProjectDecoration();
  SAVE_BLOCKED = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  for (const timer of PENDING_SAVE_TRIGGERS) clearTimeout(timer);
  PENDING_SAVE_TRIGGERS.clear();
}`;
const BLOCK_WITHOUT_CANCEL = `function blockSaving() {
  if (PROJECT_POST_COMMIT_DEPTH > 0) return refuseFromProjectDecoration();
  SAVE_BLOCKED = true;
  clearTimeout(saveTimer);
  saveTimer = null;
}`;
const REPAIRED_TRIGGER = `  if (schemaWasOlder && migratedV5) scheduleSaveTrigger(() => dirty(), 50);`;
const LOOSE_TRIGGER = `  if (schemaWasOlder && migratedV5) setTimeout(() => dirty(), 50);`;

/* The reproduction itself, run against a MUTATED app.js: does a second PUT really
   go out after the resume? Nothing on disk is touched. */
async function observedRetryAfterResume(mutate) {
  const harness = wireRecorder((index) => (index === 0 ? { status: 422, body: VALIDATION_REFUSAL } : { status: 200 }));
  const context = await viewInStepWithStorage(harness, { mutateSource: mutate, project: olderSchemaProject() });
  await vm.runInContext(`(async () => {
    P.shots[0].title = "an edit the server will not accept";
    dirty();
    await flushPendingProjectSave();
    await SAVE_CHAIN;
  })()`, context);
  const afterRefusal = harness.requests.length;
  vm.runInContext("resumeProjectSaving();", context);
  await realDelay(PAST_BOTH_TIMERS_MS);
  return { afterRefusal, requests: harness.requests };
}

function sourceMutator(from, to) {
  const applied = new Set();
  const mutate = (file, original) => {
    if (file !== "app.js") return original;
    const code = original.replace(/\r\n/g, "\n");
    assert(code.includes(from), `negative control anchor no longer exists in app.js; update the control rather than deleting it:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in app.js:\n${from}`);
    const mutated = code.replace(from, to);
    assert.notStrictEqual(mutated, code, "the edit did not change app.js");
    applied.add(file);
    return mutated;
  };
  mutate.applied = applied;
  return mutate;
}

async function expectRed(label, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message.split("\n")[0];
    throw new Error(`${label}: the guard threw something that is not an assertion failure, so this is not a valid receipt:\n${error.stack || error.message}`);
  }
  throw new Error(`${label}: the guarded section PASSED with the defect reintroduced. The regression does not detect it.`);
}

async function negativeControlsSection() {
  const controls = [];

  /* NC-1 - the pre-repair branch: every 422 is an authority refusal. Observed
     behaviourally first, so the receipt is the defect and not just a red test. */
  {
    const mutate = sourceMutator(REPAIRED_BRANCH, STATUS_ONLY_BRANCH);
    const harness = wireRecorder(() => ({ status: 422, body: VALIDATION_REFUSAL }));
    const context = await viewInStepWithStorage(harness, { mutateSource: mutate });
    await saveOnce(context, "a validation failure read through the pre-repair branch");
    const state = surfaces(context);
    assert(mutate.applied.has("app.js"), "NC-1: app.js was never evaluated, so the defect never ran");
    assert(/Production authority was not changed/.test(state.modal),
      "NC-1 probe: the defect must actually mis-report the validation failure as an authority refusal");
    assert(/REBASE &amp; RETRY/.test(state.modal),
      "NC-1 probe: and must offer the rebase that cannot resolve it");
    const detected = await expectRed("NC-1", () =>
      validationRefusalSection({ mutateSource: sourceMutator(REPAIRED_BRANCH, STATUS_ONLY_BRANCH) }));
    controls.push({ id: "NC-1", defect: "every 422 is presented as an authority refusal, as it was before the repair", detected });
  }

  /* NC-2 - the wildcard fallback returns. */
  {
    const mutate = sourceMutator(REPAIRED_PRECONDITION, WILDCARD_FALLBACK);
    const harness = wireRecorder(() => ({ status: 409, body: STALE_REFUSAL }));
    const context = await viewInStepWithStorage(harness, { mutateSource: mutate, revision: "" });
    await saveOnce(context, "a revisionless save carrying the wildcard again");
    await settle();
    assert(mutate.applied.has("app.js"), "NC-2: app.js was never evaluated, so the defect never ran");
    assert.deepStrictEqual(harness.requests.map((row) => row.ifMatch), ["*"],
      "NC-2 probe: the defect must actually put the wildcard on the wire");
    assert.strictEqual(vm.runInContext("PROJECT_CONFLICT", context), true,
      "NC-2 probe: and the seam's refusal of it must surface as the manufactured project conflict the finding describes");
    const detected = await expectRed("NC-2", () =>
      missingRevisionSection({ mutateSource: sourceMutator(REPAIRED_PRECONDITION, WILDCARD_FALLBACK) }));
    controls.push({ id: "NC-2", defect: 'a missing revision falls back to If-Match "*" and is refused as a project conflict', detected });
  }

  /* NC-3 - the reviewed candidate's block: it clears `saveTimer` and nothing
     else, so the trigger queued before the refusal survives it. This is the
     defect independent review reproduced, reintroduced exactly. */
  {
    const mutate = sourceMutator(REPAIRED_BLOCK, BLOCK_WITHOUT_CANCEL);
    const observed = await observedRetryAfterResume(mutate);
    assert(mutate.applied.has("app.js"), "NC-3: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(observed.afterRefusal, 1, "NC-3 probe: the refusal must still have taken exactly one PUT");
    assert.strictEqual(observed.requests.length, 2,
      `NC-3 probe: the defect must actually send a SECOND PUT after the resume, and it sent ${observed.requests.length}`);
    assert.strictEqual(observed.requests[1].title, "an edit the server will not accept",
      "NC-3 probe: and that second PUT must carry the SAME refused body, with no user edit behind it");
    assert.strictEqual(observed.requests[1].ifMatch, observed.requests[0].ifMatch,
      "NC-3 probe: at the same revision - the retry the reproduction reported at ~590ms");
    const detected = await expectRed("NC-3", () =>
      pendingTriggerSection({ mutateSource: sourceMutator(REPAIRED_BLOCK, BLOCK_WITHOUT_CANCEL) }));
    controls.push({ id: "NC-3", defect: "the block clears only saveTimer, so a trigger queued before the refusal retries after the resume", detected });
  }

  /* NC-4 - the trigger is scheduled loose again. The block's cancellation is
     intact; it simply cannot see a timer nothing recorded. */
  {
    const mutate = sourceMutator(REPAIRED_TRIGGER, LOOSE_TRIGGER);
    const observed = await observedRetryAfterResume(mutate);
    assert(mutate.applied.has("app.js"), "NC-4: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(observed.requests.length, 2,
      `NC-4 probe: an untracked trigger must still retry after the resume, and it sent ${observed.requests.length} PUT(s)`);
    const detected = await expectRed("NC-4", () =>
      pendingTriggerSection({ mutateSource: sourceMutator(REPAIRED_TRIGGER, LOOSE_TRIGGER) }));
    controls.push({ id: "NC-4", defect: "the migration write-back is scheduled outside the registry, so the block cannot reach it", detected });
  }

  for (const row of controls) console.log(`  ${row.id} - ${row.defect}\n        detected: ${row.detected}`);
  assert.strictEqual(controls.length, 4, "every declared control must have produced a receipt");
}

async function main() {
  console.log("Post-authority save truth (F-3, F-4)");
  await canonRefusalSection();
  await validationRefusalSection();
  await missingRevisionSection();
  await staleRevisionSection();
  await revisionRequiredSection();
  await successfulSaveSection();
  await pendingTriggerSection();
  await stillInvalidAfterResumeSection();
  await blockedWithoutResumeSection();
  await currentSchemaControlSection();
  await negativeControlsSection();
  console.log("Post-authority save truth passed - 8 claims proven and 4 reintroduced defects detected.");
}

module.exports = {
  main,
  canonRefusalSection,
  validationRefusalSection,
  missingRevisionSection,
  staleRevisionSection,
  revisionRequiredSection,
  successfulSaveSection,
  pendingTriggerSection,
  stillInvalidAfterResumeSection,
  blockedWithoutResumeSection,
  currentSchemaControlSection,
};
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
