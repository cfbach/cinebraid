/* Recovery / Quarantine V1 — negative controls.
 *
 * WHAT A CONTROL HERE HAS TO DO. Break one guarantee IN MEMORY, show that the
 * product then does the unsafe thing for real — a write lands, an unsafe project
 * becomes writable — and show that the assertion in tests/recovery-quarantine.js
 * which claims to catch it actually goes red. A control that only proves an
 * assertion fires has proved nothing about whether the danger was real.
 *
 * NC-RQ-1  remove the quarantine write-block: an ordinary save writes the unsafe project.
 * NC-RQ-2  allow a normal project install after failed validation: the unsafe project
 *          enters the writable UI.
 * NC-RQ-3  let deferred save work survive the transition: a write is attempted after
 *          Recovery mode has begun.
 * NC-RQ-4  clear Recovery mode from UI/navigation state: ordinary mode opens without
 *          ever passing the safety gate.
 *
 * Nothing on disk is touched. Provider/model calls: 0.
 */
const assert = require("assert");
const { render, buildFixture, HARNESS_PROJECT_REVISION } = require("./render-harness");
const { QUARANTINE_FAILURE_KEYS } = require("./recovery-quarantine");

const SLUG = "control-broken";
const results = [];
function pass(id, what) {
  results.push(id);
  console.log(`[NC-RQ] ${id} PASS — ${what}`);
}

/* The refusal the server sends for an unparseable project. Its field list is
   asserted against the running server in tests/recovery-quarantine.js A2, so this
   cannot quietly stop describing the real thing. */
const FAILURE = {
  slug: SLUG,
  title: "Control Broken",
  path: `C:\\CineBraid\\projects\\${SLUG}\\project.json`,
  reason: "invalid-json",
  detail: "Unexpected end of JSON input",
  issues: [],
  revision: '"c0ffee"',
  size: 31,
  modifiedAt: "2026-01-01T00:00:00.000Z",
};
const PAYLOAD = {
  error: "CineBraid could not open “Control Broken” because its project file is not valid JSON. The file is untouched and the project you were in is still open.",
  projectFailure: FAILURE,
};
assert.deepStrictEqual(
  Object.keys(FAILURE).sort(),
  QUARANTINE_FAILURE_KEYS,
  "the control's payload must be the shape the server actually sends",
);

/* A mutation that does not apply is a control that ran against the shipped code
   and reported success. Every edit is required to match exactly once, and the
   tally is checked after the render rather than inside it. */
function mutator(edits) {
  const applied = new Map(edits.map((edit) => [edit.label, 0]));
  return {
    applied,
    verify() {
      for (const [label, count] of applied)
        assert.strictEqual(count, 1, `the control did not apply its mutation "${label}" — it ran against the shipped code`);
    },
    fn(file, source) {
      let out = source;
      for (const edit of edits) {
        if (edit.file !== file) continue;
        const occurrences = out.split(edit.from).length - 1;
        assert.strictEqual(occurrences, 1, `"${edit.label}" must match exactly once in ${file}, found ${occurrences}`);
        out = out.replace(edit.from, edit.to);
        applied.set(edit.label, applied.get(edit.label) + 1);
      }
      return out;
    },
  };
}

function recorder() {
  const calls = [];
  return {
    calls,
    writes: () => calls.filter((call) =>
      /^(PUT|POST)$/.test(call.method)
      && /\/api\/(project|projects\/[^/]+\/(project|canon-transition))$/.test(call.url)),
    hook: (url, options) => {
      calls.push({ url, method: String(options?.method || "GET").toUpperCase(), body: options?.body || "" });
      return null;
    },
  };
}
async function quarantinedWindow({ mutate = null } = {}) {
  const log = recorder();
  const view = await render("#/production", buildFixture(), {
    allowRenderError: true,
    mutateSource: mutate,
    fetch: async (url, options, response) => {
      log.hook(url, options);
      if (url === "/api/project") return response(PAYLOAD, 422);
      return null;
    },
  });
  return { view, log };
}
/* A window that opened normally and holds a writable record — the starting state
   for the controls about work that was already in flight. */
async function openWindow({ mutate = null } = {}) {
  const log = recorder();
  const view = await render("#/production", buildFixture(), {
    mutateSource: mutate,
    fetch: async (url, options) => { log.hook(url, options); return null; },
  });
  return { view, log };
}
function saveJob() {
  return {
    slug: SLUG,
    revision: 1,
    documentRevision: FAILURE.revision,
    body: JSON.stringify(buildFixture()),
    baseline: null,
    transition: null,
  };
}
/* The main suite's assertion, re-run here. It must hold on the shipped build and
   throw on the mutated one; a control whose assertion passes either way is not
   guarding anything. */
async function mustFail(what, check) {
  let threw = null;
  try { await check(); } catch (error) { threw = error; }
  assert.ok(threw, `the mutated build must fail the assertion that ${what}`);
  return threw;
}

/* NC-RQ-1 — the quarantine write-block. */
async function ncrq1() {
  const control = mutator([
    { label: "queueProjectSave quarantine guard", file: "app.js", from: "    if (PROJECT_QUARANTINE) return;", to: "    if (false) return;" },
    { label: "dirty() quarantine guard", file: "app.js", from: `  if (PROJECT_QUARANTINE) return setSaveState("error", "Not saved — this project is in Recovery mode");`, to: "  if (false) return;" },
    { label: "entry write-block", file: "app.js", from: "  blockSaving();\n  /* THE INDICATOR'S OWN PENDING WORK", to: "  /* THE INDICATOR'S OWN PENDING WORK" },
  ]);
  const { view, log } = await quarantinedWindow({ mutate: control.fn });
  control.verify();

  /* THE UNSAFE BEHAVIOUR, FOR REAL. A job handed to the one exit every project
     write leaves through now reaches the network, addressed at the quarantined
     project, with the revision of the document CineBraid refused to open. */
  await view.context.queueProjectSave(saveJob());
  const writes = log.writes();
  assert.strictEqual(writes.length, 1, "the control must reproduce a real write, not merely a failed assertion");
  assert.strictEqual(writes[0].url, `/api/projects/${SLUG}/project`, "the write must land on the quarantined project");
  assert.strictEqual(writes[0].method, "PUT");

  await mustFail("no write leaves a quarantined window", () =>
    assert.strictEqual(log.writes().length, 0, "an ordinary save must not write while quarantined"));

  /* And the indicator stops telling the truth alongside it. */
  view.context.dirty();
  const label = view.map.get("save-state").querySelector("span:last-child").textContent;
  await mustFail("the indicator names Recovery mode", () => assert.match(label, /Recovery mode/i));
  pass("NC-RQ-1", "with the write-block removed an ordinary save PUTs the unsafe project at its own quarantined slug, and the indicator stops naming Recovery mode");
}

/* NC-RQ-2 — installing a project the safety gate refused. */
async function ncrq2() {
  const gate = "  if (PROJECT_QUARANTINE && projectReplacementRefusal(prepared)) return false;";
  const unvalidated = {
    /* Exactly what a load of the broken project could hand a commit: the server
       answered, but with no revision this window could write against. */
    available: true,
    project: buildFixture(),
    slug: SLUG,
    revision: "",
    scan: { characters: [], locations: [], props: [], audio: [], shots: {} },
    promptLibrary: { profiles: [] },
    config: {},
    agentStatus: { enabled: false, runs: [], agents: [], index: {} },
    automationRuns: [], falJobs: [], falLedgerLoaded: false,
  };
  const ticket = { intent: "open", epoch: 1, sequence: 0, slug: "" };

  /* The shipped build refuses it and stays protected. */
  const shipped = await quarantinedWindow();
  assert.strictEqual(shipped.view.context.commitPreparedProject(unvalidated, ticket), false);
  assert.strictEqual(shipped.view.context.captureProjectSave(), null, "the shipped build must install nothing");
  assert.strictEqual(shipped.view.document.body.dataset.projectQuarantine, SLUG);

  const control = mutator([{ label: "revalidation gate", file: "app.js", from: gate, to: "  if (false) return false;" }]);
  const { view } = await quarantinedWindow({ mutate: control.fn });
  control.verify();

  /* THE UNSAFE BEHAVIOUR, FOR REAL. The unvalidated record is installed, the
     protected surface is gone, and the window presents itself as an ordinary
     writable project. */
  assert.strictEqual(view.context.commitPreparedProject(unvalidated, ticket), true, "the control must reproduce a real install");
  assert.ok(view.context.captureProjectSave(), "the control must reproduce a writable window over the unsafe project");
  assert.strictEqual(view.document.body.dataset.projectQuarantine, undefined, "the control must reproduce an escape from the protected mode");
  assert.strictEqual(
    view.map.get("save-state").querySelector("span:last-child").textContent,
    "Saved",
    "the control must reproduce the fake success state: a project that failed validation, resting on Saved",
  );

  await mustFail("a refused snapshot is not committed", () =>
    assert.strictEqual(view.context.commitPreparedProject(unvalidated, ticket), false));
  await mustFail("a refused commit installs no record", () =>
    assert.strictEqual(view.context.captureProjectSave(), null));
  pass("NC-RQ-2", "with the revalidation gate removed a snapshot that failed the safety gate installs as an ordinary writable project and the indicator rests on Saved");
}

/* NC-RQ-3 — deferred work armed before the transition. */
async function ncrq3() {
  const cancellation = "  for (const timer of PENDING_SAVE_TRIGGERS) clearTimeout(timer);\n  PENDING_SAVE_TRIGGERS.clear();";
  const control = mutator([
    { label: "deferred-work cancellation", file: "app.js", from: cancellation, to: "  /* control: deferred work survives */" },
    { label: "queueProjectSave quarantine guard", file: "app.js", from: "    if (PROJECT_QUARANTINE) return;", to: "    if (false) return;" },
    { label: "SAVE_BLOCKED latch", file: "app.js", from: "  SAVE_BLOCKED = true;\n  clearTimeout(saveTimer);", to: "  SAVE_BLOCKED = false;\n  clearTimeout(saveTimer);" },
  ]);
  const { view, log } = await openWindow({ mutate: control.fn });
  control.verify();
  const context = view.context;

  /* Work armed against the record that is open, exactly as the shipped
     migration write-back arms it: a job captured now, sent later, by nobody. */
  const job = saveJob();
  let fired = false;
  context.scheduleSaveTrigger(() => { fired = true; context.queueProjectSave(job); }, 100);
  const before = log.writes().length;

  context.markProjectLoadFailure(FAILURE);
  context.renderProjectFailureScreen(FAILURE, PAYLOAD.error);
  await new Promise((resolve) => setTimeout(resolve, 600));

  /* THE UNSAFE BEHAVIOUR, FOR REAL. */
  assert.strictEqual(fired, true, "the control must reproduce deferred work surviving the transition");
  const writes = log.writes().slice(before);
  assert.strictEqual(writes.length, 1, "the control must reproduce a real post-quarantine write");
  assert.strictEqual(writes[0].url, `/api/projects/${SLUG}/project`, "the surviving work must write at the quarantined project");

  await mustFail("deferred work is cancelled by the transition", () => assert.strictEqual(fired, false));
  await mustFail("no write occurs after the transition", () =>
    assert.strictEqual(log.writes().length, before, "no write may occur after the transition to Recovery mode"));

  /* The shipped build, same script: the trigger never runs and nothing is sent. */
  const shipped = await openWindow();
  let shippedFired = false;
  const shippedBefore = shipped.log.writes().length;
  shipped.view.context.scheduleSaveTrigger(() => { shippedFired = true; shipped.view.context.queueProjectSave(saveJob()); }, 100);
  shipped.view.context.markProjectLoadFailure(FAILURE);
  shipped.view.context.renderProjectFailureScreen(FAILURE, PAYLOAD.error);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.strictEqual(shippedFired, false, "the shipped build must cancel deferred work at the transition");
  assert.strictEqual(shipped.log.writes().length, shippedBefore, "the shipped build must write nothing after the transition");
  pass("NC-RQ-3", "with the deferred-work cancellation removed, work armed before the transition fires after it and PUTs at the quarantined project; the shipped build cancels it and writes nothing");
}

/* NC-RQ-4 — leaving Recovery mode on UI state instead of revalidation. */
async function ncrq4() {
  /* The control clears the latch from navigation, which is the shape of the
     mistake: a screen changed, so the mode must be over. */
  const control = mutator([{
    label: "clear Recovery mode from navigation",
    file: "app.js",
    from: "async function route(recoveryAttempt = false) {\n  if (!P) return;",
    to: "async function route(recoveryAttempt = false) {\n  PROJECT_QUARANTINE = null;\n  if (document.body?.dataset) delete document.body.dataset.projectQuarantine;\n  if (!P) return;",
  }]);
  const unvalidated = {
    available: true, project: buildFixture(), slug: SLUG, revision: "",
    scan: { characters: [], locations: [], props: [], audio: [], shots: {} },
    promptLibrary: { profiles: [] }, config: {},
    agentStatus: { enabled: false, runs: [], agents: [], index: {} },
    automationRuns: [], falJobs: [], falLedgerLoaded: false,
  };
  const ticket = { intent: "open", epoch: 1, sequence: 0, slug: "" };

  const { view } = await quarantinedWindow({ mutate: control.fn });
  control.verify();
  assert.strictEqual(view.document.body.dataset.projectQuarantine, SLUG, "the window must start protected");

  /* THE UNSAFE BEHAVIOUR, FOR REAL. Navigation alone — no revalidation, no
     server verdict, no document — ends the protected mode, and the snapshot the
     safety gate would have refused then installs. */
  view.context.location.hash = "#/shots";
  await view.context.route();
  assert.strictEqual(view.document.body.dataset.projectQuarantine, undefined, "the control must reproduce a latch cleared by navigation alone");
  assert.strictEqual(view.context.commitPreparedProject(unvalidated, ticket), true, "the control must reproduce an install that never passed the gate");
  assert.ok(view.context.captureProjectSave(), "the control must reproduce a writable window reached without revalidation");

  await mustFail("navigation does not clear the latch", () =>
    assert.strictEqual(view.document.body.dataset.projectQuarantine, SLUG));

  /* The shipped build: the same navigation changes nothing, and the same
     snapshot is still refused. */
  const shipped = await quarantinedWindow();
  shipped.view.context.location.hash = "#/shots";
  await shipped.view.context.route();
  assert.strictEqual(shipped.view.document.body.dataset.projectQuarantine, SLUG, "the shipped build must stay protected across navigation");
  assert.match(shipped.view.map.get("main").innerHTML, /RECOVERY MODE/, "the protected surface must survive navigation");
  assert.strictEqual(shipped.view.context.commitPreparedProject(unvalidated, ticket), false, "the shipped build must still refuse the snapshot");
  assert.strictEqual(shipped.view.context.captureProjectSave(), null, "the shipped build must install nothing");

  /* And the one thing that DOES end it, on the shipped build: a served document
     with an addressable slug and a revision this window can write against. */
  assert.strictEqual(
    shipped.view.context.commitPreparedProject({ ...unvalidated, slug: "fixture", revision: HARNESS_PROJECT_REVISION }, ticket),
    true,
    "a validated snapshot must still be the way out",
  );
  assert.strictEqual(shipped.view.document.body.dataset.projectQuarantine, undefined);
  pass("NC-RQ-4", "with the latch cleared from navigation, ordinary mode opens over a project that never passed the safety gate; on the shipped build only a validated commit ends it");
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error("recovery-quarantine-negative-controls timed out");
    process.exit(1);
  }, 180000);
  watchdog.unref?.();
  try {
    await ncrq1();
    await ncrq2();
    await ncrq3();
    await ncrq4();
    console.log(
      `Recovery / Quarantine V1 negative controls passed: ${results.length}/4 — each removed guarantee reproduced the real unsafe behaviour `
      + "(a write at the quarantined slug, an unvalidated project installed as writable, deferred work firing after the transition, "
      + "and navigation ending the protected mode) and turned the corresponding assertion red. Provider/model calls: 0.",
    );
  } finally {
    clearTimeout(watchdog);
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
