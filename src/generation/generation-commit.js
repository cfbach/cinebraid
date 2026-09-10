/* The serialisation chains every generation backend must share.
 *
 * WHY THIS IS A MODULE AND NOT A HELPER EACH BACKEND KEEPS.
 *
 * These three chains were written inside registerFalGeneration() to end a specific,
 * proven defect, recorded there in full: a generation is a long chain of awaits, and
 * two overlapping operations on one project each held a snapshot of the durable record
 * across their own network time, so whichever wrote last silently erased the other's
 * work. On the job ledger that rolled a completed job back to IN_QUEUE. On the project
 * document it dropped a candidate row while BOTH ledger rows still claimed delivery —
 * an already-paid result reduced to an unreferenced file.
 *
 * The fix is the chain. But a chain only orders the callers that share its Map. A
 * SECOND backend with its OWN Map is not a second chain, it is the absence of one: a
 * ComfyUI ingest and a fal refresh would both re-read, both mutate, and both write,
 * exactly as the two fal operations used to. The bug would come back through the door
 * marked "new provider", and it would come back on the record that holds the
 * filmmaker's results.
 *
 * So the Maps live HERE, at module scope, where `require` makes them one per process no
 * matter how many backends exist. That is the whole reason this file exists. It adds no
 * behaviour: fal-generation.js's `commit`, `commitProject` and `serializeJobOperation`
 * become one-line delegations and do exactly what they did before.
 *
 * THE CONTRACT EACH CHAIN KEEPS
 *
 *   re-read inside the turn   a mutation applies to CURRENT durable state, never to
 *                             what the caller read before its awaits.
 *   mutate is synchronous     that is what makes the turn indivisible, and it is also
 *                             what makes the file writes inside it safe — two
 *                             collections cannot pick the same filename, because
 *                             nextFile() and writeFileSync() run in the same turn.
 *   keyed on owner.dir        the narrowest key that still protects the record being
 *                             written. Two different projects never wait on each other.
 *   a failed turn does not    every link is `.catch(() => {})` before the next attaches,
 *   break the chain           so one caller's error cannot deadlock the project.
 */

const { readJobLedger, writeJobLedgerSync } = require("./generation-job-store");

/* One Map per chain, at module scope. See the header — this is the load-bearing
   property, not an implementation detail. */
const ledgerChains = new Map();
const projectChains = new Map();
const jobOperationChains = new Map();

function chain(map, key, run) {
  const previous = map.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  map.set(key, next.catch(() => {}));
  return next;
}

/* ---- the generation ledger -------------------------------------------------
   `mutate(jobs)` receives the freshly-read array and mutates it in place; whatever it
   returns is what the caller receives. */
function commitJobLedger(owner, mutate) {
  return chain(ledgerChains, owner.dir, () => {
    const jobs = readJobLedger(owner.dir).jobs;
    const result = mutate(jobs);
    writeJobLedgerSync(owner.dir, jobs);
    return result;
  });
}

/* ---- the project document --------------------------------------------------

   The reader and writer are injected because they are the server's. Both take the
   OWNER as their first argument, deliberately: the defect this chain exists beside is
   a zero-argument PROJECT_DIR()/readProject()/writeProject() that resolves whatever
   project happens to be active when a download finishes, so a signature that cannot be
   called without naming the owner is the shape that makes that mistake unavailable. */
function commitProjectDocument(owner, mutate, io) {
  const read = io && io.readProject;
  const write = io && io.writeProject;
  if (typeof read !== "function" || typeof write !== "function")
    throw new Error("commitProjectDocument needs an owner-addressed readProject and writeProject.");
  return chain(projectChains, owner.dir, () => {
    /* RE-READ INSIDE THE TURN. This one line is the whole mechanism: a turn that
       trusted the caller's copy would be the snapshot write again. */
    const project = read(owner);
    const result = mutate(project);
    write(owner, project);
    return result;
  });
}

/* ---- one whole operation per job -------------------------------------------
   Two collections of the same job must not both pass the `!job.ingestedAt` check and
   deliver the same result twice; ordering them makes the second observe the first's
   durable outcome. */
function serializeJobOperation(owner, jobId, run) {
  return chain(jobOperationChains, `${owner.dir}::${jobId}`, run);
}

module.exports = { commitJobLedger, commitProjectDocument, serializeJobOperation };
