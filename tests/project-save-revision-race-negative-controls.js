/* Negative controls for the project-save revision race.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * reintroduces exactly ONE defect this repair removes and asserts that the guarding
 * suite FAILS.
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. public/app.js is
 *   patched through the render harness's `mutateSource` hook, which mutates the
 *   string it is about to evaluate and never the file.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt: the
 *   anchor must exist, must be unique, must actually change the source, and the
 *   DEFECT ITSELF is observed through a behavioural probe - the second save putting
 *   the stale revision on the wire - before the guarded suite's failure is allowed
 *   to count as detection.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
/* Normalised to LF before matching: on a Windows checkout with core.autocrlf on, a
   multi-line anchor would arrive as \r\n, fail to match, and report itself as stale
   rather than as a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* The shipped line, and the pre-repair line it replaced. The wildcard fallback
   that used to close this expression is gone - the Authority Write Seam requires
   an exact revision - so NC-C below reintroduces it here rather than on the
   header assignment it no longer reaches. */
const REPAIRED = `    const documentRevision =
      (ACTIVE_PROJECT_SLUG === job.slug ? PROJECT_REVISION : job.documentRevision) || "";`;
const PRE_REPAIR = `    const documentRevision = job.documentRevision || "";`;

function applyEdits(label, original, edits) {
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${label}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${label}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${label}:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${label} was not modified at all`);
  return code;
}

function sourceMutator(editsByFile) {
  const applied = new Set();
  const mutate = (file, original) => {
    const edits = editsByFile[file];
    if (!edits) return original;
    applied.add(file);
    return applyEdits(file, original.replace(/\r\n/g, "\n"), edits);
  };
  mutate.applied = applied;
  mutate.expected = Object.keys(editsByFile);
  return mutate;
}

function freshSuite() {
  delete require.cache[path.join(__dirname, "project-save-revision-race.js")];
  return require("./project-save-revision-race");
}

async function expectRed(label, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message.split("\n")[0];
    throw new Error(`${label}: the guard threw something that is not an assertion failure, so this is not a valid receipt:\n${error.stack || error.message}`);
  }
  throw new Error(`${label}: the guarded suite PASSED with the defect reintroduced. The regression test does not detect it.`);
}

/* The probe: drive two saves queued inside one round-trip against the MUTATED
   app.js and read what actually went on the wire. */
async function observedRevisions(mutate) {
  const saves = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const project = buildFixture();
  const rendered = await render("#/production", project, {
    mutateSource: mutate,
    fetch: async (url, options, response) => {
      if (!/^\/api\/projects\/[^/]+\/project$/.test(url) || options.method !== "PUT") return null;
      const index = saves.length;
      saves.push({ ifMatch: (options.headers || {})["If-Match"] });
      if (index === 0) await held;
      return response({ ok: true, revision: index === 0 ? '"R1"' : '"R2"' });
    },
  });
  vm.runInContext(`ACTIVE_PROJECT_SLUG = "fixture"; PROJECT_REVISION = '"R0"'; PROJECT_CONFLICT = false;`, rendered.context);
  vm.runInContext(`
    __probe = (async () => {
      P.shots[0].title = "one";
      const a = queueProjectSave(captureProjectSave());
      P.shots[0].title = "two";
      const b = queueProjectSave(captureProjectSave());
      await a; await b;
    })();
  `, rendered.context);
  for (let turn = 0; turn < 10000 && saves.length < 1; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  release();
  await vm.runInContext("__probe", rendered.context);
  return saves.map((row) => row.ifMatch);
}

const results = [];

async function main() {
  /* ---------------------------------------------------------------- NC-A
     The pre-repair line, exactly: the revision is whatever was captured when the
     job was enqueued, so both queued saves put the same one on the wire and the
     second is refused. This is the defect GitHub CI reported. */
  {
    const mutate = sourceMutator({ "app.js": [[REPAIRED, PRE_REPAIR]] });
    const wire = await observedRevisions(mutate);
    assert.strictEqual(wire.length, 2, "NC-A probe: both saves must have reached the server");
    assert.strictEqual(wire[0], wire[1],
      `NC-A probe: the two queued saves now put the SAME If-Match on the wire (${JSON.stringify(wire)}) - the 409 CI reported`);
    assert.strictEqual(wire[1], '"R0"',
      "NC-A probe: and it is the pre-save revision, not the one the first save produced");
    const detected = await expectRed("NC-A", () =>
      freshSuite().racedSavesSection({ mutateSource: sourceMutator({ "app.js": [[REPAIRED, PRE_REPAIR]] }) }));
    assert(mutate.applied.has("app.js"), "NC-A: app.js was never evaluated, so the defect never ran");
    results.push({ id: "NC-A", defect: "the queued save sends the revision captured at enqueue time, as it did before the repair", detected });
  }

  /* ---------------------------------------------------------------- NC-B
     The over-correction: always read the live revision, ignoring which project the
     job belongs to. A save queued for the project the user has just left then
     borrows the NEW project's revision - one project's token authorising another
     project's write, which is the ownership defect app.js refuses elsewhere. */
  {
    const edit = [REPAIRED, `    const documentRevision = PROJECT_REVISION || "";`];
    const detected = await expectRed("NC-B", () =>
      freshSuite().foreignSlugSection({ mutateSource: sourceMutator({ "app.js": [edit] }) }));
    results.push({ id: "NC-B", defect: "the live revision is used even for a save belonging to a project the view has left", detected });
  }

  /* ---------------------------------------------------------------- NC-C
     Papering over the symptom instead of fixing the cause: send "*" so the server
     can never refuse. Optimistic concurrency is gone and a genuinely stale view
     silently overwrites newer work - the outcome section 3 exists to forbid. */
  {
    const edit = [REPAIRED, `    const documentRevision = "*";`];
    const detected = await expectRed("NC-C", () =>
      freshSuite().staleViewSection({ mutateSource: sourceMutator({ "app.js": [edit] }) }));
    results.push({ id: "NC-C", defect: "If-Match is weakened to '*', so a stale view is never refused", detected });
  }

  console.log("Project-save revision race negative controls");
  for (const row of results) console.log(`  ${row.id} - ${row.defect}\n        detected: ${row.detected}`);
  assert.strictEqual(results.length, 3, "every declared control must have produced a receipt");
  console.log(`Project-save revision race negative controls passed - ${results.length}/3 reintroduced defects were detected by the guarding suite.`);
}

module.exports = { main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
