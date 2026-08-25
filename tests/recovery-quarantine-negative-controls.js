/* Recovery / Quarantine V1 — negative controls.
 *
 * WHAT A CONTROL HERE HAS TO DO. Break one guarantee IN MEMORY, show that the
 * product then does the unsafe thing for real — a write lands, an unsafe project
 * becomes writable — and show that the assertion in tests/recovery-quarantine.js
 * which claims to catch it actually goes red. A control that only proves an
 * assertion fires has proved nothing about whether the danger was real.
 *
 * NC-RQ-0  the mutator itself: every anchor these controls use resolves exactly
 *          once whether the checkout is LF, CRLF or lone-CR.
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
const fs = require("fs");
const path = require("path");
const { render, buildFixture, HARNESS_PROJECT_REVISION } = require("./render-harness");
const { QUARANTINE_FAILURE_KEYS } = require("./recovery-quarantine");

const PUBLIC = path.join(__dirname, "..", "public");
const SLUG = "control-broken";
const results = [];
function pass(id, what) {
  results.push(id);
  console.log(`[NC-RQ] ${id} PASS — ${what}`);
}

/* THE LINE ENDING IS A PROPERTY OF THE CHECKOUT, NOT OF THE CODE.
 *
 * This repository is `* text=auto` with `core.autocrlf=true`, so public/app.js is
 * stored with LF and arrives on a Windows working tree with CRLF — while the same
 * commit on Linux, in a release archive, or in a working tree an editor has already
 * normalised, arrives with LF. A mutation anchor written with "\n" therefore matched
 * in one checkout of the identical commit and matched NOTHING in another.
 *
 * That is the worst possible failure mode for a negative control. A control whose
 * anchor silently stops matching does not fail quietly — it aborts before it has
 * tested anything, and the suites after it in `check:ci` never run at all. And an
 * anchor that failed OPEN instead would be worse still: the control would report
 * that the product survived a mutation that was never applied.
 *
 * So both sides are normalised to one internal convention before anything is counted
 * or replaced, and neither side is allowed to depend on which checkout this is. */
const NEWLINE = /\r\n|\r/g;
function normalizeNewlines(text) {
  return String(text).replace(NEWLINE, "\n");
}

/* EVERY MUTATION THIS SUITE MAKES, IN ONE PLACE.
   Hoisted so NC-RQ-0 can enumerate them: a portability proof that only checked the
   anchors it happened to know about would go green the day someone adds a fifth. */
const EDITS = {
  "NC-RQ-1": [
    { label: "queueProjectSave quarantine guard", file: "app.js", from: "    if (PROJECT_QUARANTINE) return;", to: "    if (false) return;" },
    { label: "dirty() quarantine guard", file: "app.js", from: `  if (PROJECT_QUARANTINE) return setSaveState("error", "Not saved — this project is in Recovery mode");`, to: "  if (false) return;" },
    { label: "entry write-block", file: "app.js", from: "  blockSaving();\n  /* THE INDICATOR'S OWN PENDING WORK", to: "  /* THE INDICATOR'S OWN PENDING WORK" },
  ],
  "NC-RQ-2": [
    { label: "revalidation gate", file: "app.js", from: "  if (PROJECT_QUARANTINE && projectReplacementRefusal(prepared)) return false;", to: "  if (false) return false;" },
  ],
  "NC-RQ-3": [
    { label: "deferred-work cancellation", file: "app.js", from: "  for (const timer of PENDING_SAVE_TRIGGERS) clearTimeout(timer);\n  PENDING_SAVE_TRIGGERS.clear();", to: "  /* control: deferred work survives */" },
    { label: "queueProjectSave quarantine guard", file: "app.js", from: "    if (PROJECT_QUARANTINE) return;", to: "    if (false) return;" },
    { label: "SAVE_BLOCKED latch", file: "app.js", from: "  SAVE_BLOCKED = true;\n  clearTimeout(saveTimer);", to: "  SAVE_BLOCKED = false;\n  clearTimeout(saveTimer);" },
  ],
  /* The shape of the mistake: a screen changed, so the mode must be over. */
  "NC-RQ-4": [
    {
      label: "clear Recovery mode from navigation",
      file: "app.js",
      from: "async function route(recoveryAttempt = false) {\n  if (!P) return;",
      to: "async function route(recoveryAttempt = false) {\n  PROJECT_QUARANTINE = null;\n  if (document.body?.dataset) delete document.body.dataset.projectQuarantine;\n  if (!P) return;",
    },
  ],
};
const ALL_EDITS = Object.values(EDITS).flat();

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

/* A mutation that does not apply is a control that ran against the shipped code and
   reported success, so every way that can happen is loud:

     BROKEN      an anchor that matches zero times, or more times than expected — the
                 code moved under the control and it no longer describes anything.
     NOT ARMED   an anchor that matched but changed nothing, because `from` and `to`
                 became the same text.
     MISSED      an edit whose file never came past, so it was never applied at all;
                 verify() catches that after the render rather than inside it.

   The counting and the replacement both happen on normalised text, and so does the
   anchor, so none of the three answers can change with the checkout. */
function mutator(edits) {
  const applied = new Map(edits.map((edit) => [edit.label, 0]));
  const targets = new Set(edits.map((edit) => edit.file));
  return {
    applied,
    verify() {
      for (const [label, count] of applied)
        assert.strictEqual(count, 1, `the control did not apply its mutation "${label}" — it ran against the shipped code`);
    },
    fn(file, source) {
      /* A file this control does not touch keeps its bytes exactly as the checkout
         has them. Only what is being mutated is normalised, and only so that the
         mutation can be found. */
      if (!targets.has(file)) return source;
      let out = normalizeNewlines(source);
      for (const edit of edits) {
        if (edit.file !== file) continue;
        const from = normalizeNewlines(edit.from), to = normalizeNewlines(edit.to);
        const occurrences = out.split(from).length - 1;
        assert.strictEqual(occurrences, 1, `"${edit.label}" must match exactly once in ${file}, found ${occurrences}`);
        const before = out;
        out = out.replace(from, to);
        assert.notStrictEqual(out, before, `"${edit.label}" matched but changed nothing — the control is not armed`);
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

/* NC-RQ-0 — THE CONTROLS' OWN PORTABILITY, PROVED WHEREVER THIS RUNS.
 *
 * Three checkout shapes are built in memory from the real public/app.js and every
 * anchor the four controls use is resolved against each of them. Nothing on disk is
 * touched and no checkout is required to be in any particular state, so this proof
 * is the same proof on a CRLF Windows working tree, an LF one, and CI. */
function ncrq0MutatorPortability() {
  const raw = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const lf = normalizeNewlines(raw);
  const crlf = lf.replace(/\n/g, "\r\n");
  const cr = lf.replace(/\n/g, "\r");
  assert.ok(lf.includes("\n"), "the fixture source must have line breaks to be worth normalising");
  assert.strictEqual(normalizeNewlines(crlf), lf, "CRLF must normalise to the same text as LF");
  assert.strictEqual(normalizeNewlines(cr), lf, "a lone CR must normalise to the same text as LF");

  const anchors = ALL_EDITS.filter((edit) => edit.file === "app.js");
  assert.ok(anchors.length >= 6, `the portability proof must cover every anchor, found ${anchors.length}`);
  const multiline = anchors.filter((edit) => edit.from.includes("\n"));
  assert.ok(multiline.length >= 3, `the controls must still contain the multiline anchors this proof exists for, found ${multiline.length}`);

  /* THE HAZARD, DEMONSTRATED. Without normalisation a multiline anchor finds nothing
     at all in a CRLF checkout — not a wrong count, zero — which is what aborted this
     suite and everything behind it in check:ci on an ordinary Windows working tree. */
  for (const edit of multiline) {
    assert.strictEqual(
      crlf.split(edit.from).length - 1, 0,
      `"${edit.label}": the un-normalised multiline anchor must be shown to find nothing under CRLF`,
    );
    assert.strictEqual(
      lf.split(edit.from).length - 1, 1,
      `"${edit.label}": ...and to find exactly one under LF, which is why this was invisible`,
    );
  }

  /* THE FIX, DEMONSTRATED. Every anchor, single-line and multiline, resolves exactly
     once in all three shapes once both sides are normalised. */
  for (const [label, text] of [["LF", lf], ["CRLF", crlf], ["lone CR", cr]]) {
    const normalized = normalizeNewlines(text);
    for (const edit of anchors)
      assert.strictEqual(
        normalized.split(normalizeNewlines(edit.from)).length - 1, 1,
        `${label}: "${edit.label}" must resolve exactly once after normalisation`,
      );
  }

  /* AND THE REAL MUTATOR, END TO END, PER CONTROL, ON ALL THREE. One mutator with one
     output — not a Windows branch and a Linux branch that happen to agree today. Each
     control's own edit list is run, so this proves the thing each control actually
     does rather than an arrangement of anchors no control uses. */
  const SHAPES = [["LF", lf], ["CRLF", crlf], ["lone CR", cr]];
  for (const [id, edits] of Object.entries(EDITS)) {
    const outputs = SHAPES.map(([label, text]) => {
      const control = mutator(edits);
      const out = control.fn("app.js", text);
      control.verify();
      assert.notStrictEqual(out, normalizeNewlines(text), `${id} under ${label}: the mutator must actually change the source`);
      return [label, out];
    });
    for (const [label, out] of outputs)
      assert.strictEqual(out, outputs[0][1], `${id} under ${label}: the mutated source must be identical to the ${outputs[0][0]} result`);
  }

  /* A file the control does not target is handed back untouched, bytes and all. */
  const untouched = mutator(EDITS["NC-RQ-2"]).fn("settings.js", crlf);
  assert.strictEqual(untouched, crlf, "a file with no edits must be returned exactly as the checkout has it");

  /* AND THE HONESTY PROPERTIES STILL BITE. Each of these is a way a control could
     quietly stop testing anything, and each must throw. */
  assert.throws(
    () => mutator([{ label: "absent", file: "app.js", from: "this text is not in app.js at all", to: "x" }]).fn("app.js", crlf),
    /must match exactly once in app\.js, found 0/,
    "BROKEN: an anchor that matches nothing must fail loudly",
  );
  assert.throws(
    () => mutator([{ label: "ambiguous", file: "app.js", from: "function ", to: "function " }]).fn("app.js", crlf),
    /must match exactly once in app\.js, found (?:[2-9]|\d\d+)/,
    "BROKEN: an anchor that matches more than once must fail loudly",
  );
  assert.throws(
    () => mutator([{ label: "inert", file: "app.js", from: "  blockSaving();\r\n  /* THE INDICATOR'S OWN PENDING WORK", to: "  blockSaving();\n  /* THE INDICATOR'S OWN PENDING WORK" }]).fn("app.js", crlf),
    /matched but changed nothing — the control is not armed/,
    "NOT ARMED: an anchor whose replacement is the same text must fail loudly",
  );
  const missed = mutator(EDITS["NC-RQ-2"]);
  assert.throws(
    () => missed.verify(),
    /did not apply its mutation "revalidation gate"/,
    "MISSED: an edit whose file never came past must fail loudly",
  );
  pass("NC-RQ-0", "every anchor these controls use resolves exactly once under LF, CRLF and lone-CR, the real mutator produces byte-identical output from all three, an un-normalised multiline anchor is shown to find nothing under CRLF, and BROKEN / NOT ARMED / MISSED all still throw");
}

/* NC-RQ-1 — the quarantine write-block. */
async function ncrq1() {
  const control = mutator(EDITS["NC-RQ-1"]);
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

  /* The shipped build, same script: the same job reaches nothing. */
  const shipped = await quarantinedWindow();
  await shipped.view.context.queueProjectSave(saveJob());
  assert.strictEqual(shipped.log.writes().length, 0, "the shipped build must write nothing");
  shipped.view.context.dirty();
  assert.match(
    shipped.view.map.get("save-state").querySelector("span:last-child").textContent,
    /Recovery mode/i,
    "the shipped build must name Recovery mode",
  );
  pass("NC-RQ-1", "with the write-block removed an ordinary save PUTs the unsafe project at its own quarantined slug, and the indicator stops naming Recovery mode");
}

/* NC-RQ-2 — installing a project the safety gate refused. */
async function ncrq2() {
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

  const control = mutator(EDITS["NC-RQ-2"]);
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
  const control = mutator(EDITS["NC-RQ-3"]);
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
  const control = mutator(EDITS["NC-RQ-4"]);
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
    /* First, because every control below is only worth what its anchors are worth. */
    ncrq0MutatorPortability();
    await ncrq1();
    await ncrq2();
    await ncrq3();
    await ncrq4();
    console.log(
      `Recovery / Quarantine V1 negative controls passed: ${results.length}/5 — the mutator resolves its anchors identically under LF, CRLF and lone-CR, `
      + "and each removed guarantee reproduced the real unsafe behaviour "
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

module.exports = { normalizeNewlines, EDITS };
