/* CineBraid — Braidy in the right rail.
 *
 * What this suite is for, in one line: Braidy can be useful without being believed.
 *
 * Everything below is about the difference between an assistant that INTERPRETS
 * CineBraid's answers and one that becomes a second source of them. The first is what
 * the rail is for; the second is how a filmmaker ends up generating a shot twice
 * because a sentence sounded like a status.
 *
 * NO MODEL IS CALLED. Every request in this file is answered by a stub inside the
 * realm, including the ones that "fail" and the one that never returns. No server is
 * started, no project is read, no provider is contacted and nothing is written to
 * disk.
 *
 * THE REALM. public/shared-braidy.js and public/braidy-rail.js are evaluated in a vm
 * context with a hand-built window, a controllable clock and a controllable fetch, so
 * a control in tests/braidy-rail-negative-controls.js can load a MUTATED copy of
 * either without touching the working tree. Values that cross the realm boundary are
 * spread into host structures before comparison — a vm-realm array fails
 * deepStrictEqual against a host literal while printing identically.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const readSource = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const SOURCES = {
  contract: readSource("public/shared-braidy.js"),
  rail: readSource("public/braidy-rail.js"),
  surfaces: readSource("public/creator-surfaces.js"),
  styles: readSource("public/styles.css"),
  index: readSource("public/index.html"),
};

const notes = [];
const note = (line) => notes.push(line);

const codeOnly = (source) =>
  String(source).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/* ---------------------------------------------------------------------------
   REALMS. */

function loadContract(source = SOURCES.contract) {
  const sandbox = { module: { exports: {} }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "shared-braidy.js" });
  return sandbox.module.exports;
}

/* A live Braidy with a clock and a request queue under the suite's control.

   `answer()` and `reject()` settle the OLDEST outstanding request, which is what makes
   the superseded-response control expressible at all: two requests can be in flight
   and the suite decides which one lands, and in what order. */
function loadRail(sources = SOURCES, options = {}) {
  const capability = options.capability === undefined
    ? { ready: true, provider: "ollama", model: "qwen3.6:35b-a3b", message: "", action: "" }
    : options.capability;
  const clock = { now: 1_000_000 };
  const timers = [];
  const requests = [];
  const painted = [];
  let field = { value: "" };

  const sandbox = {
    console,
    JSON,
    esc: (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    location: { hash: options.hash || "#/shot/L1-01" },
    P: { meta: { title: "Sample Production" } },
    ACTIVE_PROJECT_SLUG: options.slug || "sample-production",
    AGENT_STATUS: capability ? { capabilities: { text: capability } } : {},
    Date: { now: () => clock.now },
    setTimeout: (fn, ms) => { const handle = { fn, at: clock.now + Number(ms || 0), dead: false }; timers.push(handle); return handle; },
    clearTimeout: (handle) => { if (handle) handle.dead = true; },
    AbortController: class {
      constructor() { this.signal = { aborted: false }; }
      abort() { this.signal.aborted = true; }
    },
    fetch: (url, init) => new Promise((resolve, reject) => {
      requests.push({ url, init, resolve, reject, body: JSON.parse(String(init?.body || "{}")) });
    }),
    document: {
      readyState: "complete",
      getElementById: (id) => (id === "cb-braidy-input" ? field : null),
      querySelector: () => null,
      createElement: () => ({ innerHTML: "", firstElementChild: null }),
      addEventListener: () => {},
    },
  };
  sandbox.attr = (t) => sandbox.esc(t).replace(/'/g, "&#39;");
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const listeners = [];
  sandbox.window.addEventListener = (name, handler) => listeners.push([name, handler]);
  sandbox.window.matchMedia = () => ({ matches: !!options.reducedMotion });
  /* The rail owner is stubbed to record paints rather than to draw. What is under test
     is that Braidy asks for a repaint at the right moments, not what creator-surfaces
     does with one — that has its own suite. */
  sandbox.CineBraidCreatorSurfaces = {
    paint: () => { painted.push(1); },
    openRail: () => { painted.push("open"); },
  };

  vm.createContext(sandbox);
  vm.runInContext(sources.contract, sandbox, { filename: "shared-braidy.js" });
  vm.runInContext(sources.rail, sandbox, { filename: "braidy-rail.js" });

  const advance = (ms) => {
    clock.now += Number(ms || 0);
    for (const handle of [...timers]) {
      if (handle.dead || handle.at > clock.now) continue;
      handle.dead = true;
      handle.fn();
    }
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  return {
    sandbox,
    braidy: sandbox.window.CineBraidBraidy,
    contract: sandbox.window,
    listeners,
    fire: (name) => { for (const [subscribed, handler] of listeners) if (subscribed === name) handler(); },
    setSlug: (slug) => { sandbox.ACTIVE_PROJECT_SLUG = slug; },
    setHash: (hash) => { sandbox.location.hash = hash; },
    requests,
    painted,
    advance,
    settle,
    field,
    setField: (value) => { field.value = value; },
    answer: async (text) => {
      const request = requests.shift();
      assert.ok(request, "no request was outstanding to answer");
      request.resolve({ ok: true, json: async () => ({ ok: true, answer: text }) });
      await settle();
      return request;
    },
    refuse: async (status, error) => {
      const request = requests.shift();
      assert.ok(request, "no request was outstanding to refuse");
      request.resolve({ ok: false, status, json: async () => ({ error }) });
      await settle();
      return request;
    },
  };
}

/* Every file a production path could live in, by name. Read once here so a control
   in the negative-control suite can hand this check a tree with one extra reacher in
   it — a guarantee about what is NOT in the source is only a guarantee once something
   has been seen to put it there. */
function readClientFiles() {
  const clientDir = path.join(ROOT, "public");
  const files = {};
  for (const name of fs.readdirSync(clientDir)) {
    if (!/\.(js|html)$/.test(name)) continue;
    files[name] = fs.readFileSync(path.join(clientDir, name), "utf8");
  }
  files["server.js"] = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  return files;
}

/* The deterministic rail, so Braidy's effect on it can be measured rather than
   asserted. tests/creator-state.js already owns that realm; this borrows it. */
function loadRailOwner(sources = SOURCES) {
  return require("./creator-state.js").loadRuntime({ ...require("./creator-state.js").SOURCES, surfaces: sources.surfaces });
}

/* ===========================================================================
   1. THE RIGHT RAIL IS BRAIDY, AND IT IS NOT A SECOND ACTIVITY FEED.

   The Terminal is the chronological operational record: system, status, cost,
   duration, attempt, one row per event. Braidy is the creator-facing reading of the
   same production. A rail that reprinted the Terminal in kinder words would not be a
   second opinion — it would be a second place to look for the same list, and the
   first place a cost or a status could disagree with itself.
   =========================================================================== */

function checkRailIsBraidyNotActivity(sources = SOURCES) {
  const rail = loadRail(sources);
  const markup = rail.braidy.railMarkup();

  assert.ok(markup.includes('data-braidy="1"'), "the rail must actually render Braidy");
  assert.ok(markup.includes("cb-braidy-compose"), "Braidy is a place to ask something, so the composer is not optional");

  /* The Terminal's own vocabulary, and the row key it patches by. None of it belongs
     to a surface whose job is interpretation. */
  for (const token of ["data-activity-key", "cb-terminal", "COST", "DURATION", "ATTEMPT", "$"]) {
    assert.ok(!markup.includes(token),
      `Braidy renders "${token}"; that is the Activity Terminal's record and duplicating it here gives a production two places to disagree about itself`);
  }

  /* Proved from the source as well as from one render, because a feed is something a
     file GROWS. Braidy holds a conversation bounded by THREAD_LIMIT and reads no run,
     no job and no manual activity row — it cannot become a feed of them by accident. */
  const code = codeOnly(sources.rail);
  for (const reader of ["AUTOMATION_RUNS", "FAL_GENERATION_JOBS", "V641_MANUAL_ACTIVITIES", "v670ManualActivityRows",
    "v670MachineActiveRun", "v670WaitingForHumanRun", "falJobActive", "creatorState"]) {
    assert.ok(!new RegExp(`\\b${reader}\\b`).test(code),
      `public/braidy-rail.js reads ${reader}. Braidy interprets the production; enumerating activity is the Terminal's job and there must be exactly one enumerator`);
  }

  /* And it is composed into the rail ABOVE the deterministic sections, so opening the
     rail to ask something does not begin with a status list. */
  const surfaces = codeOnly(sources.surfaces);
  assert.ok(/braidyBlock\(\)\s*$|\+ braidyBlock\(\)/m.test(surfaces),
    "public/creator-surfaces.js must compose Braidy into the Assistant rail");
  const assistantStart = surfaces.indexOf('`<div class="cb-assistant" data-cb-assistant="1"');
  const headIndex = surfaces.indexOf("cb-assistant-head", assistantStart);
  const braidyIndex = surfaces.indexOf("braidyBlock()", assistantStart);
  assert.ok(braidyIndex > 0 && braidyIndex < headIndex,
    "Braidy must be composed before the deterministic head, not appended under the status sections");

  /* THE SKELETON IS THE SAME IN EVERY STATE, and this is a correctness property
     rather than a style one.

     The rail is repainted whenever activity changes — every 3.5s while anything is
     running — and public/live-activity.js's reconciler patches children BY POSITION.
     An element sequence that varied with state would let one of those repaints
     replace the composer while somebody was typing in it. Compared as a tag skeleton
     rather than as markup, because text and attributes are exactly what is meant to
     change. Verified against Chromium too: three repaints mid-typing keep the same
     textarea node, its value and its focus. */
  const THREAD_BODY = /(<div class="cb-braidy-thread"[^>]*>)[\s\S]*?(<\/div><div class="cb-braidy-compose")/;
  /* The thread's INTERIOR is exempt and has to be: it is where the conversation goes,
     it holds nothing focusable, and it is one element deep so its children cannot
     shift the composer's position. Everything outside it is compared. */
  const skeleton = (html) => (html.replace(THREAD_BODY, "$1$2").match(/<\/?[a-z]+/g) || []).join("");
  const idle = skeleton(loadRail(sources).braidy.railMarkup());
  const busy = loadRail(sources);
  busy.braidy.ask("A question");
  const trouble = loadRail(sources);
  trouble.braidy.abort("stopped");
  const unavailable = loadRail(sources, { capability: { ready: false, provider: "none", model: "", message: "off", action: "settings" } });
  for (const [label, other] of [["thinking", busy], ["attention", trouble], ["unavailable", unavailable]]) {
    assert.strictEqual(skeleton(other.braidy.railMarkup()), idle,
      `the rail's element skeleton changes between idle and ${label}; a repaint would replace the composer by position while somebody was typing in it`);
  }

  note("Rail: Braidy renders a conversation and a composer, carries none of the Terminal's columns or row keys, cannot read a run, a job or a manual activity, and holds the same element skeleton in every state so a repaint cannot replace the composer");
}

/* ===========================================================================
   2. THE FACTS HANDED TO BRAIDY ARE READ-ONLY CONTEXT.

   A handoff carries CineBraid's own answers so Braidy interprets them instead of
   guessing. The whole value of that disappears if the interpretation can edit its
   evidence, so the facts are frozen on the way in and the frozen copy is what travels.
   =========================================================================== */

function checkFactsAreReadOnlyContext(sources = SOURCES) {
  const api = loadContract(sources.contract);
  const handoff = api.braidyHandoff({
    intent: "plan",
    origin: { surface: "creator-rail-stage", route: "#/shot/L1-01" },
    target: { kind: "shot", id: "L1-01", label: "L1-01" },
    stageId: "frames",
    facts: { stage: "Frames", availability: "blocked", blockedReason: "Confirm the required production reference", references: ["ref-a"] },
  });

  assert.ok(Object.isFrozen(handoff), "a handoff must be frozen");
  assert.ok(Object.isFrozen(handoff.facts), "the deterministic facts must be frozen");
  assert.ok(Object.isFrozen(handoff.facts.references), "a fact that is a list must be frozen too, not just the object holding it");

  /* Non-strict assignment fails silently, which is exactly the way this could rot
     unnoticed. Read the value back rather than trusting the throw. */
  const mutate = () => {
    handoff.facts.availability = "ready";
    handoff.facts.references.push("ref-b");
  };
  try { mutate(); } catch { /* strict-mode callers throw; both outcomes are fine */ }
  assert.strictEqual(handoff.facts.availability, "blocked",
    "a fact CineBraid established was overwritten through the handoff");
  assert.strictEqual([...handoff.facts.references].length, 1,
    "a fact list CineBraid established was appended to through the handoff");

  /* The facts reach the model as CONTEXT, and the framing says what they are. */
  const question = api.braidyQuestion(handoff, "What should I do?");
  assert.ok(question.includes("blockedReason") && question.includes("Confirm the required production reference"),
    "the deterministic facts must actually be given to Braidy, or it is guessing");
  assert.ok(/may rely on and must not contradict/i.test(question),
    "the facts must be framed as CineBraid's answer rather than as raw material");

  /* And the copy is a copy, in both directions.

     The caller's own object must come back UNFROZEN. A handoff that froze what it was
     handed would reach out of Braidy and immobilise a caller's live state — the shot
     block a surface is still rendering from — which is a much worse bug than the one
     the freeze exists to prevent, and it would look like a Braidy feature working. */
  const original = { stage: "Frames" };
  const second = api.braidyHandoff({ intent: "review", target: { kind: "shot", id: "L1-02" }, facts: original });
  assert.ok(!Object.isFrozen(original),
    "handing facts over froze the caller's own object; the handoff must take a copy rather than claim what it was given");
  original.stage = "Motion";
  assert.strictEqual(second.facts.stage, "Frames", "the handoff must hold its own copy of the facts it was given");

  note("Facts: frozen through the handoff including nested lists, copied from the caller, and framed to the model as CineBraid's answer rather than as raw material");
}

/* ===========================================================================
   3. AN ADVISORY RESULT DOES NOT BECOME PRODUCTION TRUTH.

   Two shapes, and the difference between them is where the claim came from.
   braidyAdvisory() is the only thing prose can become. braidyRequirement() cannot be
   made at all without naming the deterministic source that established it.
   =========================================================================== */

function checkAdvisoryIsNotProductionTruth(sources = SOURCES) {
  const api = loadContract(sources.contract);

  const advisory = api.braidyAdvisory("The opening frame is already strong. I'd keep it.");
  assert.strictEqual(advisory.kind, "advisory");
  assert.strictEqual(advisory.authority, "advisory",
    "a model's answer must be stamped advisory; every reader that checks authority would otherwise treat a sentence as an established fact");
  assert.ok(Object.isFrozen(advisory), "an advisory result must be frozen so nothing downstream can promote it");
  for (const forbidden of ["ready", "approved", "blocked", "canon", "authority"]) {
    if (forbidden === "authority") continue;
    assert.ok(!(forbidden in advisory),
      `an advisory result carries "${forbidden}"; a production reader would find a field there to believe`);
  }

  /* A requirement cannot be conjured. */
  assert.throws(() => api.braidyRequirement({ statement: "This shot cannot be generated yet." }),
    /deterministic source/i,
    "a blocking claim with no deterministic source must be refused, or prose can invent a blocker");
  const requirement = api.braidyRequirement({ source: "shared-stage-model:blockedReason", statement: "Confirm the required production reference." });
  assert.strictEqual(requirement.authority, "deterministic");
  assert.notStrictEqual(requirement.kind, advisory.kind,
    "a recommendation and a requirement must not be the same shape, or a preference reads as a gate");

  /* Nothing in either Braidy file can write, approve, establish canon or spend money.
     Read from the source because this is a property of the whole file rather than of
     one call: a single added line is what it would take to lose it. */
  const code = codeOnly(sources.contract) + codeOnly(sources.rail);
  const FORBIDDEN = [
    "writeProject", "saveProject", "queueSave", "setVal", "setValNested", "markDirty",
    "approveCandidate", "approveAutomationCandidate", "setWinner", "markGuidedStillFinal", "markGuidedVideoFinal",
    "openFalGenerationModal", "falDispatch", "paidPermit", "issuePaidPermit", "requestPaidDispatch",
    "ProductionAuthority", "AuthorityKernel", "recordAuthority", "establishCanon",
  ];
  for (const name of FORBIDDEN) {
    assert.ok(!new RegExp(`\\b${name}\\b`).test(code),
      `Braidy references ${name}. An advisory surface that can reach a write, an approval, canon or a paid dispatch is not advisory`);
  }

  /* One request, and it is a question. */
  const fetches = codeOnly(sources.rail).match(/fetch\(/g) || [];
  assert.strictEqual(fetches.length, 1, `public/braidy-rail.js makes ${fetches.length} requests; Braidy asks exactly one thing and it is a question`);
  assert.ok(codeOnly(sources.rail).includes('"/api/project/ask"'),
    "Braidy must use the assistant route CineBraid already has, rather than a second assistant backend");

  note("Authority: prose can only become an advisory; a requirement needs a named deterministic source; neither file can reach a write, an approval, canon or a paid dispatch; one request, to the existing assistant route");
}

/* ===========================================================================
   4. A CONTEXTUAL ACTION RESOLVES BACK TO THE EXACT OWNING TASK.

   The point of carrying the origin and the target is that the control at the end of
   the conversation leads back to the thing the filmmaker was looking at when they
   asked — not to a similar thing, and not to whatever is on screen by then.
   =========================================================================== */

function checkActionResolvesToOwningTask(sources = SOURCES) {
  const api = loadContract(sources.contract);
  const handoff = api.braidyHandoff({
    intent: "plan",
    origin: { surface: "creator-rail-stage", route: "#/shot/L1-07" },
    target: { kind: "shot", id: "L1-07", label: "L1-07" },
    stageId: "frames",
    destinations: ["open-stage-task", "open-activity"],
  });

  const offered = [...api.braidyOfferedActions(handoff)].map((action) => ({ ...action }));
  assert.strictEqual(offered.length, 2, "both declared destinations must be offered");
  const stageAction = offered.find((action) => action.id === "open-stage-task");
  assert.ok(stageAction, "the stage destination must survive");
  assert.strictEqual(stageAction.call, "selectBoundedTask('shot-task','L1-07','frames')",
    "the control must call the shipped task selector against the exact shot and step the handoff named");
  assert.strictEqual(stageAction.target.id, "L1-07");
  assert.strictEqual(stageAction.stageId, "frames");

  /* A destination whose prerequisites the handoff did not supply is DROPPED, never
     rendered against a missing id. */
  const stageless = api.braidyHandoff({ intent: "plan", target: { kind: "shot", id: "L1-07" }, destinations: ["open-stage-task", "open-activity"] });
  const offeredStageless = [...api.braidyOfferedActions(stageless)].map((action) => ({ ...action }));
  assert.deepStrictEqual(offeredStageless.map((action) => action.id), ["open-activity"],
    "a stage control with no step to open must be dropped rather than rendered against nothing");

  /* The rendered control carries the target it resolves to, so what is on screen can
     be checked against what was handed over. */
  const rail = loadRail(sources, { hash: "#/shot/L1-07" });
  rail.braidy.braidyWith("plan", {
    origin: { surface: "creator-rail-stage", route: "#/shot/L1-07" },
    target: { kind: "shot", id: "L1-07", label: "L1-07" },
    stageId: "frames",
    destinations: ["open-stage-task"],
    askNow: false,
  });
  assert.strictEqual(rail.braidy.handoff().target.id, "L1-07", "the rail must hold the handoff it was given");
  assert.strictEqual(rail.braidy.handoff().intent, "plan");

  /* AN EXPLICIT HANDOFF GOVERNS WHILE THE FILMMAKER IS STILL ON WHAT IT NAMED, and is
     released when they are not. Both halves matter: the first is why a follow-up is
     still about the shot they asked about, and the second is why a question typed
     after navigating is about the shot in front of them.

     Derived on every call rather than cached. A cached seed would fix the target on
     the first paint, and every question afterwards would be answered about a shot the
     filmmaker had left, with nothing on screen saying so. */
  rail.setHash("#/shot/L1-09");
  assert.strictEqual(rail.braidy.handoff().target.id, "L1-09",
    "after navigating away the handoff must follow the route; a question typed here is about this shot");
  assert.strictEqual(rail.braidy.handoff().intent, "ask",
    "the explicit intent is released with the target it belonged to");
  rail.setHash("#/shot/L1-07");
  assert.strictEqual(rail.braidy.handoff().intent, "plan",
    "returning to the shot the handoff named must restore it rather than starting over");

  /* And the rail's own convergence point hands over the declared stage block. */
  const owner = loadRailOwner(sources);
  owner.sandbox.window.CineBraidBraidy = { railMarkup: () => "", capability: () => ({ available: true }) };
  owner.sandbox.braidyPlan = () => {};
  const suite = require("./creator-state.js");
  const state = owner.api.creatorState({
    context: suite.CONTEXT,
    activities: [],
    ...suite.stageFor("motion", suite.STAGE_FACTS.motionBlocked),
  });
  const railHtml = owner.surfaces.assistantMarkup(state);
  assert.ok(railHtml.includes("Plan with Braidy"), "the rail's stage block must offer the handoff");
  assert.ok(/braidyPlan\(\{/.test(railHtml.replace(/&quot;/g, '"')),
    "the stage handoff must be a braidyPlan call, not a bespoke request");
  const decoded = railHtml.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  assert.ok(decoded.includes('"id":"SAMPLE-01"'), "the stage handoff must name the shot it came from");
  assert.ok(decoded.includes('"blockedReason"'), "the stage handoff must carry the declared model's reason, not a sentence composed for Braidy");

  /* AND IT IS NOT OFFERED WHEN NOTHING CAN ANSWER IT. The only outcome of that control
     would be the assistant refusing, in a rail that has already said why. */
  owner.sandbox.window.CineBraidBraidy = { railMarkup: () => "", capability: () => ({ available: false }) };
  assert.ok(!owner.surfaces.assistantMarkup(state).includes("Plan with Braidy"),
    "the handoff must not be offered when Braidy has no assistant to answer with");

  note("Handoff: a destination resolves to the shipped selector against the exact shot and step, an unsatisfiable destination is dropped rather than rendered, and the rail's stage block hands over O1's own words");
}

/* ===========================================================================
   5. NO QUALIFIED-CHAMPION CLAIM EXISTS WHILE THE STANDING IS NONE.

   And the mechanism is real rather than a constant `false`: given a record that DOES
   name a champion and a configured model that IS it, the claim appears. That is the
   seam a future qualification would arrive through, and this is the check that proves
   it is a seam and not a stub.
   =========================================================================== */

function checkNoQualifiedChampionClaim(sources = SOURCES) {
  const api = loadContract(sources.contract);

  assert.strictEqual(api.BRAIDY_QUALIFICATION.champion, null,
    "the shipped qualification record must name no champion");
  assert.strictEqual(api.BRAIDY_QUALIFICATION.standing, "none");

  const ready = { ready: true, provider: "custom", model: "some-local-model", message: "", action: "" };
  const claim = api.braidyCapability(ready, api.BRAIDY_QUALIFICATION);
  assert.strictEqual(claim.qualified, false, "no model may be called qualified while the standing is none");
  assert.strictEqual(claim.standing, "none");
  assert.strictEqual(claim.champion, null);
  assert.ok(!/\bqualified\b/i.test(claim.label) || /not a CineBraid-qualified/i.test(claim.label),
    `the capability label claims qualification: ${claim.label}`);
  assert.ok(/not a CineBraid-qualified/i.test(claim.note),
    "a configured assistant must be described as configured rather than left to read as certified");

  /* The seam works in the other direction. */
  const qualified = api.braidyCapability(
    { ready: true, provider: "custom", model: "champion-model" },
    { champion: "champion-model", standing: "qualified" },
  );
  assert.strictEqual(qualified.qualified, true,
    "with a qualification record naming the configured model the claim must be expressible, or this is a hard-coded false rather than a seam");

  /* A champion that is not the configured model claims nothing. This is the failure
     mode the standing exists to prevent: a research control being read as the product's
     champion because a record exists somewhere. */
  const other = api.braidyCapability(
    { ready: true, provider: "custom", model: "some-local-model" },
    { champion: "champion-model", standing: "qualified" },
  );
  assert.strictEqual(other.qualified, false,
    "a qualified champion existing does not qualify whatever model happens to be configured");

  /* And a reachable endpoint is not a qualification either. */
  const reachableOnly = api.braidyCapability({ ready: true, provider: "custom", model: "" }, { champion: "champion-model", standing: "qualified" });
  assert.strictEqual(reachableOnly.qualified, false,
    "an endpoint answering is not a model passing a gate");

  /* Nothing in the shipped source asserts a champion by another route. */
  const code = codeOnly(sources.contract) + codeOnly(sources.rail) + codeOnly(sources.surfaces);
  assert.ok(!/PRODUCT_QUALIFIED_CHAMPION\s*[=:]\s*["'][^"']+["']/.test(code),
    "a champion must not be declared anywhere but the qualification record");

  const rail = loadRail(sources);
  const markup = rail.braidy.railMarkup();
  assert.ok(markup.includes('data-braidy-qualified="0"'),
    "the rendered rail must state that Braidy is not running on a qualified model");
  /* And it is SAID, not only stamped. An attribute is for a suite; the sentence is for
     the filmmaker, and it must be somewhere they read before asking anything. */
  assert.ok(/not a CineBraid-qualified one/i.test(markup),
    "the rail must tell the filmmaker in words that the assistant answering is theirs and not a qualified one");
  assert.ok(!/not a CineBraid-qualified one/i.test(markup.slice(0, markup.indexOf("cb-braidy-thread"))),
    "the note belongs where it is read once, not in the header standing over every conversation");

  note("Qualification: the shipped standing names no champion, no configured model is called qualified, a champion that is not the configured model claims nothing, and the claim IS expressible once a record names both — the seam is real");
}

/* ===========================================================================
   6. AN EXISTING CONFIGURED ASSISTANT IS NOT BROKEN AND NOT RELABELLED.

   Two failure modes, opposite directions. Disabling a working assistant because no
   champion exists would take away something that works today. Calling it Braidy-
   qualified because it answers would be the claim this whole slice must not make.
   =========================================================================== */

function checkConfiguredAssistantIsNotRelabelled(sources = SOURCES) {
  const api = loadContract(sources.contract);

  const working = api.braidyCapability({ ready: true, provider: "ollama", model: "qwen3.6:35b-a3b" }, api.BRAIDY_QUALIFICATION);
  assert.strictEqual(working.available, true,
    "a configured assistant that answers must stay available; a missing champion is not a reason to disable working functionality");
  assert.strictEqual(working.configured, true);
  assert.ok(working.label.includes("qwen3.6:35b-a3b"), "the filmmaker must be told which model is answering");
  assert.ok(/you configured/i.test(working.label), "it must be described as the assistant the filmmaker configured");

  /* The existing capability check's own words are passed through untouched, so the
     advice about what is wrong stays the advice CineBraid already gives. */
  const broken = api.braidyCapability(
    { ready: false, provider: "ollama", model: "qwen3.6:35b-a3b", message: "Ollama is not reachable at http://127.0.0.1:11434.", action: "Start Ollama, then retry." },
    api.BRAIDY_QUALIFICATION,
  );
  assert.strictEqual(broken.available, false);
  assert.strictEqual(broken.message, "Ollama is not reachable at http://127.0.0.1:11434.",
    "the existing capability message must reach the rail unchanged rather than being restated by Braidy");
  assert.strictEqual(broken.action, "Start Ollama, then retry.");

  /* And with no assistant at all the rail still renders and says so. */
  const rail = loadRail(sources, { capability: { ready: false, provider: "none", model: "", message: "AI assistance is disabled in AI Assistant settings.", action: "Choose an AI provider in Settings." } });
  const markup = rail.braidy.railMarkup();
  assert.ok(markup.includes("AI assistance is disabled"), "the rail must repeat CineBraid's own explanation");
  assert.ok(markup.includes("cb-braidy-send"), "the rail must still render rather than disappearing");
  assert.ok(/<button[^>]*cb-braidy-send[^>]*disabled/.test(markup),
    "with no assistant the send control must be disabled rather than failing on use");

  note("Configured assistants: a working one stays available and is named as the filmmaker's own, a broken one keeps CineBraid's existing message and action verbatim, and no assistant at all still renders a rail");
}

/* ===========================================================================
   7 & 8. THE PRESENCE FOLLOWS THE REQUEST, AND SETTLES BACK.

   The mascot is derived. It has no instruction channel, so there is no state it can
   be put into and left in.
   =========================================================================== */

function checkProcessingAnimationFollowsRequest(sources = SOURCES) {
  const api = loadContract(sources.contract);

  /* The derivation, in isolation and completely. */
  assert.strictEqual(api.braidyPresentation({ pending: true }).state, "thinking");
  assert.strictEqual(api.braidyPresentation({ pending: true, failed: true, acknowledging: true, inputActive: true }).state, "thinking",
    "a live request outranks every other token; anything else lets a stale flag describe a running request");
  assert.strictEqual(api.braidyPresentation({ failed: true }).state, "attention");
  assert.strictEqual(api.braidyPresentation({ acknowledging: true }).state, "acknowledge");
  assert.strictEqual(api.braidyPresentation({ inputActive: true }).state, "listening");
  assert.strictEqual(api.braidyPresentation({ awaitingChoice: true }).state, "listening",
    "waiting for the filmmaker is attentive, not alarmed");
  assert.strictEqual(api.braidyPresentation({}).state, "idle");
  assert.deepStrictEqual([...api.BRAIDY_PRESENTATION_STATES], ["idle", "listening", "thinking", "acknowledge", "attention"]);

  /* And live, against a real request. */
  const rail = loadRail(sources);
  rail.braidy.ask("Is this shot ready?");
  assert.strictEqual(rail.braidy.presentation().state, "thinking", "an outstanding request must show as thinking");
  assert.ok(rail.braidy.railMarkup().includes('data-braidy-state="thinking"'));
  assert.ok(/<button[^>]*cb-braidy-send[^>]*disabled/.test(rail.braidy.railMarkup()),
    "the send control must be disabled while a question is outstanding");

  note("Processing: pending outranks every other token, the five states are exhaustive, and a live request renders as thinking with the send control disabled");
}

async function checkResponseSettlesBack(sources = SOURCES) {
  const rail = loadRail(sources);
  rail.braidy.ask("Is this shot ready?");
  assert.strictEqual(rail.braidy.presentation().state, "thinking");

  await rail.answer("The opening frame is already strong. I'd keep it.");
  assert.strictEqual(rail.braidy.presentation().state, "acknowledge",
    "an answer arriving must be acknowledged rather than snapping straight back to idle");

  /* And the acknowledgement expires on its own. */
  rail.advance(2000);
  assert.strictEqual(rail.braidy.presentation().state, "idle",
    "the acknowledge pose must settle back without another request; a pose that needs an event to leave is a pose that gets stuck");
  assert.strictEqual(rail.braidy.presentationTokens().pending, false);

  /* A failure settles to attention, and stays there until something else happens
     rather than pretending to still be working. */
  const failing = loadRail(sources);
  failing.braidy.ask("Anything wrong here?");
  await failing.refuse(500, "The assistant request failed.");
  assert.strictEqual(failing.braidy.presentation().state, "attention",
    "a refused request must settle to attention; anything still reading as thinking is a question that is not running");
  assert.strictEqual(failing.braidy.presentationTokens().pending, false,
    "a refused request must stop being pending");
  failing.advance(60000);
  assert.strictEqual(failing.braidy.presentation().state, "attention",
    "a failure must not decay into idle on a timer; nothing was resolved");

  note("Settling: an answer acknowledges and then returns to idle with no further event; a refusal stops being pending at once and stays visible rather than decaying");
}

/* ===========================================================================
   9. REDUCED MOTION.

   Stamped on the element as well as handled in the stylesheet. A stylesheet is one
   edit away from being reorganised; the markup answer is the one a suite can hold.
   =========================================================================== */

function checkReducedMotion(sources = SOURCES) {
  const api = loadContract(sources.contract);
  assert.strictEqual(api.braidyPresentation({ pending: true, reducedMotion: true }).motion, "none");
  assert.strictEqual(api.braidyPresentation({ pending: true, reducedMotion: true }).state, "thinking",
    "reduced motion must remove the movement and not the meaning; the state is still what it is");
  assert.strictEqual(api.braidyPresentation({ pending: true }).motion, "on");

  const still = loadRail(sources, { reducedMotion: true });
  assert.ok(still.braidy.railMarkup().includes('data-braidy-motion="none"'),
    "a reduced-motion reader must be served by the markup");
  const moving = loadRail(sources);
  assert.ok(moving.braidy.railMarkup().includes('data-braidy-motion="on"'));

  const styles = sources.styles;
  assert.ok(/@media\(prefers-reduced-motion:reduce\)\{[^}]*cb-braidy/.test(styles.replace(/\s+/g, "")) ||
    /prefers-reduced-motion:reduce\)\{\.cb-braidy-loop/.test(styles.replace(/\s+/g, "")),
    "the stylesheet must also stop Braidy's animation under a reduced-motion preference");
  assert.ok(styles.includes('.cb-braidy[data-braidy-motion="none"]'),
    "the stamped answer must be honoured by the stylesheet, not only recorded in the markup");

  /* Nothing loops forever in the filmmaker's eye line. The two infinite animations are
     the idle drift and the thinking turn, both of which are the states they belong to;
     acknowledge runs once by declaration. */
  assert.ok(/cb-braidy-ack\s+\.?[\d.]+s\s+ease-out\s+1\b/.test(styles),
    "the acknowledge animation must be declared as a single run rather than a loop");
  assert.ok(!/cb-braidy-ack[^}]*infinite/.test(styles), "acknowledge must never loop");

  note("Reduced motion: the derivation returns motion \"none\" without changing the state, the rail stamps it, and the stylesheet honours both the stamp and the media query; acknowledge is declared as one run");
}

/* ===========================================================================
   10. A STALE OR CLOSED REQUEST CANNOT LEAVE BRAIDY THINKING.

   Three ways it could: the rail is closed while a question is outstanding, a second
   question supersedes the first, and a response arrives after either. All three end
   the same way, because there is one sequence number and it is the only thing allowed
   to settle anything.
   =========================================================================== */

async function checkStaleRequestCannotStick(sources = SOURCES) {
  /* Closed. */
  const closed = loadRail(sources);
  closed.braidy.ask("What now?");
  assert.strictEqual(closed.braidy.presentation().state, "thinking");
  closed.braidy.abort("That question was stopped when the rail was closed.");
  assert.strictEqual(closed.braidy.presentationTokens().pending, false, "aborting must clear the pending flag");
  assert.notStrictEqual(closed.braidy.presentation().state, "thinking",
    "a rail nobody can see must not still be thinking");
  /* And the response that eventually arrives settles nothing. */
  await closed.answer("A late answer nobody is waiting for.");
  assert.strictEqual(closed.braidy.thread().filter((entry) => entry.role === "braidy").length, 0,
    "a response to an aborted question must not be shown");
  assert.strictEqual(closed.braidy.presentationTokens().pending, false);

  /* Superseded. The FIRST request answers last, which is the ordering that would put a
     stale answer on screen if sequence were not the arbiter. */
  const superseded = loadRail(sources);
  superseded.braidy.ask("First question");
  superseded.braidy.ask("Second question");
  assert.strictEqual(superseded.requests.length, 2, "both questions must have been sent");
  await superseded.answer("Answer to the first");
  const afterStale = superseded.braidy.thread().filter((entry) => entry.role === "braidy");
  assert.strictEqual(afterStale.length, 0, "the superseded answer must not land");
  assert.strictEqual(superseded.braidy.presentationTokens().pending, true,
    "the live question is still outstanding and must still read as pending");
  await superseded.answer("Answer to the second");
  const settled = superseded.braidy.thread().filter((entry) => entry.role === "braidy");
  assert.strictEqual(settled.length, 1, "the live question's answer must land");
  assert.strictEqual(settled[0].advisory.text, "Answer to the second");

  /* The project going away clears the session outright. */
  const gone = loadRail(sources);
  gone.braidy.ask("Still here?");
  gone.braidy.reset();
  assert.strictEqual(gone.braidy.presentationTokens().pending, false);
  assert.strictEqual(gone.braidy.thread().length, 0, "a production that is not open leaves no conversation about it");

  /* AND SO DOES A DIFFERENT PROJECT BEING OPENED, which is not the same event.

     CineBraid emits no project-changed signal, so this is watched by value on the
     repaints Braidy already receives. A subscription to an event nothing dispatches
     would leave a conversation about another production's shots on screen while
     reading, in the source, exactly like a guarantee. */
  const switched = loadRail(sources, { slug: "first-production" });

  /* THE SUBSCRIPTION FIRST, because a guard wired to an event nothing dispatches and a
     guard that does nothing when it runs produce the identical symptom below. Checked
     in the order that lets each control name its own defect. */
  const subscribed = switched.listeners.map(([name]) => name);
  for (const signal of ["cinebraid:route-rendered", "cinebraid:workspace-updated"]) {
    assert.ok(subscribed.includes(signal), `Braidy must watch ${signal}, which CineBraid actually dispatches`);
  }
  const dispatched = new Set(["cinebraid:route-rendered", "cinebraid:workspace-updated", "cinebraid:activity-updated", "hashchange", "load"]);
  for (const signal of subscribed) {
    assert.ok(dispatched.has(signal),
      `Braidy subscribes to "${signal}", which nothing in CineBraid dispatches; a listener that can never fire is not a safeguard`);
  }

  switched.fire("cinebraid:route-rendered");
  switched.braidy.ask("What is left on this one?");
  await switched.answer("Two frames still need you.");
  assert.strictEqual(switched.braidy.thread().length, 2, "the conversation must exist before the switch");
  switched.setSlug("second-production");
  switched.fire("cinebraid:route-rendered");
  assert.strictEqual(switched.braidy.thread().length, 0,
    "a conversation about the previous production survived a project switch; it describes shots this production does not have");

  /* The rail owner is what calls both, and it is the only thing that knows. */
  const surfaces = codeOnly(sources.surfaces);
  assert.ok(/if \(!open\) \{ braidySignal\("abort"/.test(surfaces),
    "closing the rail must abort Braidy's outstanding question");
  assert.ok(/!context\.hasProject\) \{ braidySignal\("reset"\)/.test(surfaces),
    "a production going away must clear Braidy's session");

  note("Staleness: aborting clears pending and discards the late answer, a superseded question's answer never lands while the live one still does, closing the rail aborts, losing the production resets, a project switch clears the conversation, and every signal Braidy subscribes to is one CineBraid dispatches");
}

/* ===========================================================================
   11. A MODEL CANNOT MINT AN EXECUTABLE ACTION.

   The strongest thing that can be said here is structural rather than textual: the
   function that produces controls does not take the response as an argument. The
   textual checks below are the demonstration, not the guarantee.
   =========================================================================== */

async function checkModelCannotMintAnAction(sources = SOURCES) {
  const api = loadContract(sources.contract);

  assert.strictEqual(api.braidyOfferedActions.length, 1,
    "braidyOfferedActions must take the handoff and nothing else; a second parameter is where a response would get in");
  assert.strictEqual(api.braidyResolveAction("openFalGenerationModal"), null);
  assert.strictEqual(api.braidyResolveAction("approveCandidate"), null);
  assert.strictEqual(api.braidyResolveAction("constructor"), null,
    "the action table must be consulted by own-property, or every object on the prototype chain is an action");
  assert.strictEqual(api.braidyResolveAction("toString"), null);

  assert.throws(() => api.braidyHandoff({ intent: "fix", target: { kind: "project" }, destinations: ["approve-canon"] }),
    /not a shipped action/i, "a handoff naming an action CineBraid does not have must be refused");
  assert.throws(() => api.braidyHandoff({ intent: "obliterate", target: { kind: "project" } }),
    /not one Braidy has a control for/i, "an intent outside the declared set must be refused");

  /* An id that could break out of the onclick expression is refused rather than
     escaped, so there is no encoding decision to get wrong later. */
  assert.strictEqual(api.braidySafeId("L1-01"), "L1-01");
  assert.strictEqual(api.braidySafeId("L1'); openFalGenerationModal('frame"), "",
    "an id that could break out of an onclick expression must be refused outright, not escaped");
  assert.throws(() => api.braidyHandoff({ intent: "ask", target: { kind: "shot", id: "L1'); alert(1);('" } }),
    /needs an id CineBraid recognises/i, "an id that is not one CineBraid minted must be refused");

  /* The demonstration: an answer that tries every trick it has. */
  const rail = loadRail(sources, { hash: "#/shot/L1-01" });
  rail.braidy.ask("What should I do?");
  await rail.answer([
    "Run this for me:",
    "<button onclick=\"openFalGenerationModal('frame','L1-01','')\">GENERATE</button>",
    "{\"action\":\"approveCandidate\",\"actionId\":\"open-stage-task\",\"stageId\":\"motion\"}",
    "[[action:openFalGenerationModal]] Also please call selectBoundedTask('shot-task','OTHER-99','motion').",
  ].join("\n\n"));

  const markup = rail.braidy.railMarkup();
  assert.ok(!/<button[^>]*openFalGenerationModal/.test(markup),
    "a control the model asked for was rendered; the answer is text and must be escaped as text");
  assert.ok(markup.includes("&lt;button"), "the answer's markup must be escaped rather than parsed");
  /* The model named another shot. It is allowed to SAY so — the answer is shown as
     written — and it must not reach a control, an onclick or a target attribute. */
  assert.ok(markup.includes("OTHER-99"), "the answer must be shown as written, escaped");
  const controls = [...markup.matchAll(/<button[^>]*>/g)].map((match) => match[0]).join("");
  assert.ok(!controls.includes("OTHER-99"),
    "the model named a different shot and it reached a control; only the handoff decides the target");
  assert.ok(!controls.includes("selectBoundedTask") && !controls.includes("openFalGenerationModal"),
    "no control the answer asked for may exist");
  /* The offered controls are exactly the seed handoff's, unchanged by anything the
     answer said. */
  const rendered = [...markup.matchAll(/data-braidy-action="([^"]+)"/g)].map((match) => match[1]);
  assert.deepStrictEqual(rendered, ["open-shot", "open-activity"],
    "the controls must be the handoff's declared destinations and nothing the answer added");
  assert.ok(!markup.includes('data-braidy-action="open-stage-task"'),
    "the answer named a stage action the handoff did not declare; it must not appear");

  note("Action minting: the producer of controls cannot see a response, unknown and prototype-chain identifiers resolve to null, an unsafe id is refused rather than escaped, and an answer full of controls renders as escaped text with the handoff's own two destinations");
}

/* ===========================================================================
   12. BRAIDY IS OPTIONAL, AND THE RAIL BENEATH IT IS UNCHANGED BY IT.

   The property that makes Braidy safe to ship before it is good: if it is absent, or
   broken, the deterministic rail is byte-identical to what it was.
   =========================================================================== */

function checkBraidyIsNotAGate(sources = SOURCES) {
  const suite = require("./creator-state.js");
  const owner = loadRailOwner(sources);
  const state = owner.api.creatorState({
    context: suite.CONTEXT,
    activities: [suite.FIXTURES.working(), suite.FIXTURES.waitingApproval()],
    ...suite.stageFor("frames", suite.STAGE_FACTS.framesComplete),
  });

  const without = owner.surfaces.assistantMarkup(state);
  assert.ok(without.includes("Needs attention") || without.includes("Waiting for you"),
    "the deterministic rail must still render with Braidy absent");
  assert.ok(!without.includes("cb-braidy"), "with Braidy absent nothing of it may appear");

  /* A Braidy that throws must cost the rail nothing — and the throw must be CAUGHT
     here rather than allowed to escape, so a rail that stopped swallowing it fails an
     assertion instead of crashing the suite. A control that crashes its harness has
     proved the harness is fragile, not that the property is held. */
  owner.sandbox.window.CineBraidBraidy = { railMarkup: () => { throw new Error("Braidy exploded"); } };
  let broken = "";
  try {
    broken = owner.surfaces.assistantMarkup(state);
  } catch (error) {
    assert.fail(`a failing Braidy escaped into the deterministic rail (${error.message}); the rail must render without it`);
  }
  assert.strictEqual(broken, without,
    "a failing Braidy changed the deterministic rail; the rail must be exactly what it was without it");

  /* And a working one is ADDED to the rail rather than replacing any of it. */
  owner.sandbox.window.CineBraidBraidy = { railMarkup: () => '<section class="cb-braidy" data-braidy="1"></section>' };
  const withBraidy = owner.surfaces.assistantMarkup(state);
  assert.ok(withBraidy.includes('data-braidy="1"'));
  assert.strictEqual(withBraidy.replace('<section class="cb-braidy" data-braidy="1"></section>', ""), without,
    "Braidy must be composed into the rail without altering one byte of the deterministic sections");

  /* The rail is still opt-in, and Braidy did not make it otherwise. */
  const surfaceCode = codeOnly(sources.surfaces);
  assert.ok(surfaceCode.includes('localStorage.getItem(RAIL_OPEN_KEY) === "1"'),
    "the rail must remain closed until the filmmaker opens it");

  /* AND NO PRODUCTION PATH CAN REACH BRAIDY AT ALL.

     Measured across the whole client and the server rather than argued from the
     rail's behaviour: creating a project, importing one, producing a shot,
     generating, reviewing and finishing are carried out by files that do not know
     Braidy exists, so none of them can come to depend on it. The rail owner and the
     markup that loads the two files are the entire surface. */
  const REACH = /\b(CineBraidBraidy|braidy(?:Plan|Improve|Review|Fix|Ask|With|Block|Signal|StageAction|Handoff|Capability|Presentation))\b|braidy-rail|shared-braidy/;
  const ALLOWED = new Set(["braidy-rail.js", "shared-braidy.js", "creator-surfaces.js", "index.html"]);
  const files = sources.clientFiles || readClientFiles();
  const reached = Object.keys(files).filter((name) => !ALLOWED.has(name) && REACH.test(files[name])).sort();
  assert.deepStrictEqual(reached, [],
    `Braidy is reachable from ${reached.join(", ")}. A production path that knows Braidy exists is a production path that can come to need it.`);

  note("Optional: with Braidy absent the deterministic rail is unchanged, with Braidy throwing it is byte-identical, with Braidy working it is the same bytes plus the block, the rail is still opt-in, and no file outside the rail owner and the markup can reach Braidy at all");
}

/* ===========================================================================
   13. COMPACT IS A LAYOUT DECISION, NOT A CUT.

   Roughly 30-60 words is the register. It is applied by deciding what is shown first.
   Nothing is discarded, and a legitimately long answer stays whole.
   =========================================================================== */

async function checkCompactionIsNotTruncation(sources = SOURCES) {
  const api = loadContract(sources.contract);

  const long = ["First paragraph, short.", "Second paragraph " + "word ".repeat(80).trim() + ".", "Third paragraph."].join("\n\n");
  const split = api.braidySplitAnswer(long);
  const lead = [...split.lead];
  const rest = [...split.rest];
  assert.deepStrictEqual([...lead, ...rest], long.split("\n\n"),
    "every paragraph must survive the split; the lead and the remainder are the whole answer");
  assert.ok(lead.length >= 1, "the first paragraph is always shown");
  assert.ok(rest.length >= 1, "an answer over the register must have a remainder rather than being cut");

  /* A first paragraph longer than the whole budget is still shown whole. */
  const oneLong = "A single very long paragraph. " + "word ".repeat(120).trim();
  const single = api.braidySplitAnswer(oneLong);
  assert.deepStrictEqual([...single.lead], [oneLong], "a long first paragraph is shown whole, never cut to fit");
  assert.strictEqual([...single.rest].length, 0);

  const short = api.braidySplitAnswer("I'd keep the opening frame. It reads clearly and the eyeline is right.");
  assert.strictEqual(short.compact, true);
  assert.strictEqual([...short.rest].length, 0, "a compact answer needs no remainder and no control");

  /* And in the rail: the remainder is behind one control and the text is all there. */
  const rail = loadRail(sources);
  rail.braidy.ask("Talk me through it.");
  await rail.answer(long);
  const collapsed = rail.braidy.railMarkup();
  assert.ok(collapsed.includes("Explain more"), "a long answer must offer the rest rather than dropping it");
  assert.ok(!collapsed.includes("Third paragraph."), "the remainder starts collapsed");
  rail.braidy.explainMore();
  const expanded = rail.braidy.railMarkup();
  assert.ok(expanded.includes("Third paragraph."), "the remainder must be the answer verbatim");
  assert.strictEqual(rail.braidy.lastAnswer(), long, "the whole answer is retained whatever is shown");

  note("Compaction: the lead and remainder reconstruct the answer exactly, an over-long first paragraph is never cut, a compact answer gets no control, and the rail keeps the whole text whatever it shows");
}

/* ===========================================================================
   14. RECOMMENDATION AND REQUIREMENT ARE SAID DIFFERENTLY, AND NEITHER IS
       SAID AS BOILERPLATE.
   =========================================================================== */

function checkRecommendationVersusRequirement(sources = SOURCES) {
  const api = loadContract(sources.contract);
  const framing = { ...api.BRAIDY_INTENT_FRAMING };

  const handoff = api.braidyHandoff({ intent: "plan", target: { kind: "shot", id: "L1-01" } });
  const question = api.braidyQuestion(handoff, "");
  assert.ok(/one recommendation/i.test(question), "the register asks for one recommendation by default");
  assert.ok(/choice is the filmmaker's/i.test(question), "a human-owned choice must be named naturally when there is one");

  /* The banned boilerplate, in the shipped instruction AND in the rendered rail.
     These are the phrases that turn an honest ownership statement into a tic. */
  const BOILERPLATE = ["human authority required", "that's a filmmaker decision", "that is a filmmaker decision"];
  const surfaces = [sources.contract, sources.rail, sources.surfaces].join("\n").toLowerCase();
  for (const phrase of BOILERPLATE) {
    assert.ok(!surfaces.includes(phrase),
      `"${phrase}" appears in the shipped source; ownership is said naturally, in the sentence it belongs to`);
  }
  assert.ok(/without using stock phrases/i.test(question),
    "the instruction must ask for it plainly rather than leaving a stock phrase available");

  /* Every intent has framing, and none of them instructs Braidy to claim a change. */
  for (const intent of [...api.BRAIDY_INTENTS]) {
    assert.ok(framing[intent], `intent "${intent}" has no framing and would reach the model as nothing`);
  }
  assert.ok(/Do not claim to have changed anything/i.test(question),
    "Braidy must be told it cannot report a write; the server's own system prompt says the same and this is the second half of it");

  note(`Register: ${Object.keys(framing).length} intents each framed, one recommendation by default, ownership said plainly, and no stock authority phrase anywhere in the shipped source`);
}

/* ===========================================================================
   15. ONE ASSISTANT PATH, NOT A SECOND ONE.
   =========================================================================== */

function checkNoSecondBackend(sources = SOURCES) {
  const code = codeOnly(sources.rail);
  const routes = [...code.matchAll(/["'](\/api\/[^"']+)["']/g)].map((match) => match[1]);
  assert.deepStrictEqual(routes, ["/api/project/ask"],
    `Braidy reaches ${routes.join(", ") || "no route"}; it must use the one assistant route CineBraid already has`);

  /* No second orchestration: no retry ladder, no provider selection, no model choice.
     Those belong to server.js's requestAssistantResult and to Settings. */
  for (const token of ["anthropic", "openai", "ollama", "vllm", "sglang", "qwen", "modelOverride", "providerOverride"]) {
    assert.ok(!new RegExp(token, "i").test(code),
      `public/braidy-rail.js names "${token}"; the rail must be coupled to a capability and a route, never to a provider, a runtime or a model`);
  }

  /* The contract is loaded before the rail, and the rail before its consumer. */
  const index = sources.index;
  const contractAt = index.indexOf("shared-braidy.js");
  const railAt = index.indexOf("braidy-rail.js?");
  const surfacesAt = index.indexOf("creator-surfaces.js?");
  assert.ok(contractAt > 0 && railAt > contractAt, "the contract must load before the rail");
  assert.ok(surfacesAt > railAt, "the rail must load before creator-surfaces.js, which composes it on its first paint");

  note("Backend: one route, no provider, runtime or model name anywhere in the rail, and a load order that puts the contract before the rail and the rail before its consumer");
}

/* ---------------------------------------------------------------------------
   RUN. */

async function runAll() {
  checkRailIsBraidyNotActivity();
  checkFactsAreReadOnlyContext();
  checkAdvisoryIsNotProductionTruth();
  checkActionResolvesToOwningTask();
  checkNoQualifiedChampionClaim();
  checkConfiguredAssistantIsNotRelabelled();
  checkProcessingAnimationFollowsRequest();
  await checkResponseSettlesBack();
  checkReducedMotion();
  await checkStaleRequestCannotStick();
  await checkModelCannotMintAnAction();
  checkBraidyIsNotAGate();
  await checkCompactionIsNotTruncation();
  checkRecommendationVersusRequirement();
  checkNoSecondBackend();
  return notes;
}

module.exports = {
  SOURCES,
  readSource,
  codeOnly,
  loadContract,
  loadRail,
  loadRailOwner,
  readClientFiles,
  runAll,
  checkRailIsBraidyNotActivity,
  checkFactsAreReadOnlyContext,
  checkAdvisoryIsNotProductionTruth,
  checkActionResolvesToOwningTask,
  checkNoQualifiedChampionClaim,
  checkConfiguredAssistantIsNotRelabelled,
  checkProcessingAnimationFollowsRequest,
  checkResponseSettlesBack,
  checkReducedMotion,
  checkStaleRequestCannotStick,
  checkModelCannotMintAnAction,
  checkBraidyIsNotAGate,
  checkCompactionIsNotTruncation,
  checkRecommendationVersusRequirement,
  checkNoSecondBackend,
};

if (require.main === module) {
  runAll()
    .then((lines) => {
      for (const line of lines) console.log(line);
      console.log("Braidy rail suite passed: rail ownership, read-only facts, advisory authority, handoff resolution, qualification standing, presentation lifecycle, reduced motion, staleness, action minting, optionality, compaction and one backend.");
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
