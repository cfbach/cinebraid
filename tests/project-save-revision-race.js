/* The project-save revision race, and the conflict behaviour that must survive it.
 *
 * THE DEFECT THIS ENDS, found by CI rather than by review. The Windows browser gate
 * failed on tests/focused-workspaces-real-browser.py with one console error:
 *
 *     Failed to load resource: the server responded with a status of 409 (Conflict)
 *
 * Traced to PUT /api/projects/<slug>/project, and the two saves either side of it
 * carried the IDENTICAL If-Match:
 *
 *     HTTP 200  PUT  slug=dogfood-sample  ifmatch=09d91e3a82e3...
 *     HTTP 409  PUT  slug=dogfood-sample  ifmatch=09d91e3a82e3...
 *
 * captureProjectSave() snapshots PROJECT_REVISION when a save is ENQUEUED, and
 * SAVE_CHAIN serialises only the sending. So two saves queued inside one server
 * round-trip - a debounced dirty() followed by an explicit flush, which is what
 * every automation turn does - both captured the pre-save revision. The first
 * succeeded and moved the stored document; the second was refused, its edit was
 * discarded, and PROJECT_CONFLICT latched so the view stopped saving at all.
 *
 * It is a real product defect, not a test artefact: it reproduces identically on the
 * pre-C4 base, and it needs only a save slow enough that a second one is queued
 * behind it. A fast machine hides it; a loaded CI runner does not.
 *
 * THE SERVER IS CORRECT AND IS NOT CHANGED. Refusing a save whose base revision has
 * moved is exactly what tests/state-interleaving.js F-03 pins, and section 3 below
 * proves this repair does not soften it.
 *
 * NO TIMING IS USED TO CREATE THE RACE. The first response is held on an explicit
 * barrier the test releases, so the interleaving is identical on every machine and
 * every run - the discipline tests/state-interleaving.js already established.
 */
const assert = require("assert");
const vm = require("vm");

const { render, buildFixture } = require("./render-harness");

const SLUG = "fixture";
const R0 = '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';
const R1 = '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"';
const R2 = '"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"';

function barrier() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

/* Wait for a CONDITION, never for a duration. queueProjectSave() chains its send
   off SAVE_CHAIN, so the request is dispatched on a microtask rather than
   synchronously; this drains the loop until the state the assertion is about
   actually exists. A bound is kept so a genuine hang fails loudly instead of
   waiting for the runner's timeout. */
async function until(predicate, what) {
  for (let turn = 0; turn < 10000; turn++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`condition never held: ${what}`);
}

/* A save recorder that can hold any single PUT open. `saves` is the ordered
   transcript of what the browser actually put on the wire. */
function saveHarness({ hold = -1, statusFor = () => 200 } = {}) {
  const saves = [];
  const gate = barrier();
  const revisions = [R1, R2];
  return {
    saves,
    releaseHeld: gate.release,
    async fetch(url, options, response) {
      if (!/^\/api\/projects\/[^/]+\/project$/.test(url) || options.method !== "PUT") return null;
      const index = saves.length;
      const record = {
        index,
        url,
        ifMatch: (options.headers || {})["If-Match"],
        title: JSON.parse(options.body || "{}").shots?.[0]?.title || "",
      };
      saves.push(record);
      if (index === hold) await gate.promise;
      const status = statusFor(index);
      record.status = status;
      if (status !== 200)
        return response({
          error: "This project changed while this view was open.",
          code: "PROJECT_REVISION_CONFLICT",
          action: "reload",
          revision: R2,
        }, status);
      return response({ ok: true, revision: revisions[index] || R2 });
    },
  };
}

async function contextFor(harness, options = {}) {
  const project = buildFixture();
  const rendered = await render("#/production", project, { ...options, fetch: harness.fetch });
  /* The view is now in step with a stored document, exactly as load() leaves it. */
  vm.runInContext(
    `ACTIVE_PROJECT_SLUG = ${JSON.stringify(SLUG)}; PROJECT_REVISION = ${JSON.stringify(R0)}; PROJECT_CONFLICT = false;`,
    rendered.context,
  );
  return rendered.context;
}

/* ===========================================================================
   1. Two saves queued inside one round-trip. */
async function racedSavesSection(options = {}) {
  const harness = saveHarness({ hold: 0 });
  const context = await contextFor(harness, options);

  /* Both jobs are captured and queued BEFORE the first response exists - the
     production sequence exactly: a debounced dirty() lands, and a flush follows
     while its request is still in flight. */
  vm.runInContext(`
    __raced = (async () => {
      P.shots[0].title = "edit one";
      const a = queueProjectSave(captureProjectSave());
      P.shots[0].title = "edit two";
      const b = queueProjectSave(captureProjectSave());
      await a;
      await b;
      return { revision: PROJECT_REVISION, conflict: PROJECT_CONFLICT };
    })();
  `, context);

  /* The first request is now on the wire and held. The second is queued behind it
     and cannot have been sent, because the barrier has not been released - that is
     what makes the interleaving deterministic rather than a function of how fast
     this machine is. */
  await until(() => harness.saves.length >= 1, "the first save reached the server");
  assert.strictEqual(harness.saves.length, 1, "the second save must still be queued behind the first");
  assert.strictEqual(harness.saves[0].ifMatch, R0, "the first save carries the revision the view loaded");
  harness.releaseHeld();

  const outcome = await vm.runInContext("__raced", context);

  assert.strictEqual(harness.saves.length, 2, "both saves must reach the server");
  assert.strictEqual(harness.saves[1].ifMatch, R1,
    "THE REPAIR: the second save must carry the revision the first one produced, not the one it was queued with");
  assert.notStrictEqual(harness.saves[1].ifMatch, harness.saves[0].ifMatch,
    "two serialized saves must never put the same If-Match on the wire - that is the 409 CI reported");
  assert.deepStrictEqual(harness.saves.map((row) => row.status), [200, 200],
    "and both saves succeed rather than the later edit being refused");
  assert.strictEqual(harness.saves[1].title, "edit two",
    "the save that would have been refused is the one carrying the newer edit");
  assert.strictEqual(outcome.conflict, false,
    "PROJECT_CONFLICT must not latch, because nothing external changed the project");
  assert.strictEqual(outcome.revision, R2, "the view ends in step with what it last stored");
  console.log("  raced - two saves queued inside one round-trip send different revisions, both succeed, and the later edit is the one that lands");
}

/* ===========================================================================
   2. The ordinary case is unchanged. */
async function sequentialSection(options = {}) {
  const harness = saveHarness();
  const context = await contextFor(harness, options);
  const outcome = await vm.runInContext(`(async () => {
    P.shots[0].title = "first";
    await queueProjectSave(captureProjectSave());
    P.shots[0].title = "second";
    await queueProjectSave(captureProjectSave());
    return { revision: PROJECT_REVISION, conflict: PROJECT_CONFLICT };
  })()`, context);
  assert.deepStrictEqual(harness.saves.map((row) => row.ifMatch), [R0, R1],
    "a save that waits for the one before it already behaved correctly and still does");
  assert.strictEqual(outcome.conflict, false);
  console.log("  sequential - a save awaited to completion still sends the revision its predecessor produced");
}

/* ===========================================================================
   3. THE GUARANTEE THAT MUST NOT WEAKEN.

   A view whose stored document was changed by somebody else is still stale, is
   still refused, and still stops writing. PROJECT_REVISION only moves forward
   from load() or from THIS view's own successful save, so nothing another window
   writes can advance it - which is precisely why reading it at send time is safe. */
async function staleViewSection(options = {}) {
  const harness = saveHarness({ statusFor: () => 409 });
  const context = await contextFor(harness, options);
  const outcome = await vm.runInContext(`(async () => {
    P.shots[0].title = "written by a view that has fallen behind";
    await queueProjectSave(captureProjectSave());
    const afterConflict = PROJECT_CONFLICT;
    /* A stale view must stop writing, not keep retrying a body that will be refused. */
    P.shots[0].title = "and again";
    await queueProjectSave(captureProjectSave());
    return { afterConflict, conflict: PROJECT_CONFLICT };
  })()`, context);

  assert.strictEqual(harness.saves.length, 1,
    "after a 409 the view must stop writing rather than retry the refused body");
  assert.strictEqual(harness.saves[0].ifMatch, R0,
    "the stale view still sends its own last-known revision, so the server's check still fires");
  assert.strictEqual(outcome.afterConflict, true, "the refusal latches PROJECT_CONFLICT");
  assert.strictEqual(outcome.conflict, true, "and it stays latched");
  console.log("  stale-view - an externally changed project still refuses the save, latches the conflict and stops writing");
}

/* ===========================================================================
   4. A save for a project that is no longer the active one keeps its own
   revision, because PROJECT_REVISION now describes a different document. */
async function foreignSlugSection(options = {}) {
  const harness = saveHarness({ hold: 0 });
  const context = await contextFor(harness, options);
  vm.runInContext(`
    __foreign = (async () => {
      P.shots[0].title = "queued for the project we are leaving";
      const a = queueProjectSave(captureProjectSave());
      /* The user switches project while that save is still in flight. */
      ACTIVE_PROJECT_SLUG = "another-project";
      PROJECT_REVISION = ${JSON.stringify(R2)};
      const b = queueProjectSave({ slug: ${JSON.stringify(SLUG)}, revision: 99,
        documentRevision: ${JSON.stringify(R0)}, body: JSON.stringify(P) });
      await a;
      await b;
      return true;
    })();
  `, context);
  await until(() => harness.saves.length >= 1, "the first save reached the server");
  harness.releaseHeld();
  await vm.runInContext("__foreign", context);
  assert.strictEqual(harness.saves[1].ifMatch, R0,
    "a save for a project that is no longer active keeps the revision it captured, rather than borrowing another project's");
  console.log("  foreign-slug - a queued save for a project the view has left does not borrow the new project's revision");
}

async function main() {
  console.log("Project-save revision race");
  await racedSavesSection();
  await sequentialSection();
  await staleViewSection();
  await foreignSlugSection();
  console.log("Project-save revision race passed.");
}

module.exports = { main, racedSavesSection, sequentialSection, staleViewSection, foreignSlugSection };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
