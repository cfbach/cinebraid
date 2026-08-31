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
const crypto = require("crypto");
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
  /* The two registries the art has to be named in. Carried as sources so a control can
     hand the check a relaxed detector or a release that dropped a sprite, rather than
     editing either file on disk. */
  exposure: readSource("tests/public-exposure.js"),
  release: readSource("tests/release-package-smoke.js"),
  server: readSource("server.js"),
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
  /* EVERY HANDOFF IN THIS CHECK IS BUILT THROUGH HERE, so a contract that has started
     refusing ordinary facts fails an assertion that says so rather than throwing a
     refusal out of the suite. Refusing the wrong things and copying the wrong things
     are both defects, and both belong to this check. */
  const accept = (input, said) => {
    try {
      return api.braidyHandoff(input);
    } catch (error) {
      return assert.fail(`${said}: ${error.message}`);
    }
  };
  const handoff = accept({
    intent: "plan",
    origin: { surface: "creator-rail-stage", route: "#/shot/L1-01" },
    target: { kind: "shot", id: "L1-01", label: "L1-01" },
    stageId: "frames",
    facts: { stage: "Frames", availability: "blocked", blockedReason: "Confirm the required production reference", references: ["ref-a"] },
  }, "the stage block CineBraid actually hands over was refused");

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

  /* And the copy is a copy, in both directions, ALL THE WAY DOWN.

     The first version of this copied one level. A nested object kept the caller's
     identity, an array inside an object kept the caller's identity, and the deepFreeze
     that followed therefore reached out of Braidy and froze the caller's own live
     objects — a surface that handed over a shot block would find its next push()
     throwing. An array inside an array was worse than aliased: it was spread as an
     object and arrived as {"0":"deep"}, silently corrupting the evidence.

     The wired stage payload is flat, so none of that was reachable in the product
     today. It was reachable through the public contract, which is what a contract is
     for, so the whole graph is proved here rather than the one shape a caller happens
     to use. */
  const nestedObject = { reason: "reference-unconfirmed" };
  const nestedArray = ["ref-a"];
  const inArray = { id: "CHAR-1" };
  const graph = {
    stage: "Frames",
    block: { detail: nestedObject, list: nestedArray },
    entities: [inArray],
    matrix: [["deep"]],
  };
  const deep = accept({ intent: "review", target: { kind: "shot", id: "L1-02" }, facts: graph },
    "a record of strings, objects and arrays was refused; these are the fact types the contract exists to carry");

  /* 1-4. Nothing in the copied graph is anything the caller still holds. */
  assert.notStrictEqual(deep.facts, graph, "the fact record itself must be a copy");
  assert.notStrictEqual(deep.facts.block, graph.block, "a nested object must be a copy");
  assert.notStrictEqual(deep.facts.block.detail, nestedObject, "an object nested two deep must be a copy");
  assert.notStrictEqual(deep.facts.block.list, nestedArray, "an array inside an object must be a copy");
  assert.notStrictEqual(deep.facts.entities[0], inArray, "an object inside an array must be a copy");
  assert.ok(Array.isArray(deep.facts.matrix[0]),
    "an array inside an array must still be an array; spreading it as an object turns a list into {\"0\":…} and corrupts the fact");
  assert.deepStrictEqual([...deep.facts.matrix[0]], ["deep"]);

  /* 5-7. And the caller keeps everything it handed over, unfrozen. Braidy freezes its
     OWN copy; freezing a caller's live object is a worse bug than the one the freeze
     exists to prevent, and it looks exactly like the feature working. */
  for (const [label, held] of [["the record", graph], ["a nested object", nestedObject],
    ["a nested array", nestedArray], ["an object inside an array", inArray]]) {
    assert.ok(!Object.isFrozen(held), `handing facts over froze ${label} the caller still owns`);
  }
  /* Said as the caller would find out: by using its own object afterwards. */
  nestedArray.push("ref-b");
  nestedObject.reason = "MUTATED BY CALLER";
  inArray.id = "MUTATED";
  graph.stage = "Motion";

  /* 8. The copy is frozen through. */
  assert.ok(Object.isFrozen(deep.facts.block) && Object.isFrozen(deep.facts.block.detail)
    && Object.isFrozen(deep.facts.block.list) && Object.isFrozen(deep.facts.entities[0])
    && Object.isFrozen(deep.facts.matrix[0]),
    "every node of the copied graph must be frozen, not only the root");

  /* 9-10. And none of the caller's edits reached it. */
  assert.strictEqual(deep.facts.stage, "Frames");
  assert.strictEqual(deep.facts.block.detail.reason, "reference-unconfirmed");
  assert.strictEqual([...deep.facts.block.list].length, 1);
  assert.strictEqual(deep.facts.entities[0].id, "CHAR-1");

  /* 11. A shape the record cannot carry is REFUSED where it is handed over, not
     silently dropped at JSON.stringify time or thrown much later at request time. */
  const UNSUPPORTED = [
    ["a function", () => {}], ["a symbol", Symbol("s")], ["a BigInt", 10n],
    ["a Date", new Date(0)], ["a Map", new Map()], ["a Set", new Set()],
    ["a class instance", new (class Thing { constructor() { this.x = 1; } })()],
    ["NaN", NaN], ["Infinity", Infinity],
  ];
  for (const [label, value] of UNSUPPORTED) {
    assert.throws(() => api.braidyHandoff({ intent: "ask", target: { kind: "project" }, facts: { probe: value } }),
      /Braidy cannot carry/,
      `${label} was accepted as a fact; it cannot survive the request in the shape CineBraid recorded it`);
  }
  /* Refused wherever it is, not only at the top. */
  assert.throws(() => api.braidyHandoff({ intent: "ask", target: { kind: "project" }, facts: { a: { b: [{ c: new Date(0) }] } } }),
    /facts\.a\.b\.0\.c/, "the refusal must name where the unsupported fact is, not just that there was one");

  /* A null prototype is still a plain record and is carried. */
  const bare = Object.assign(Object.create(null), { x: 1 });
  assert.strictEqual(accept({ intent: "ask", target: { kind: "project" }, facts: { bare } },
    "a null-prototype record is a plain record and must be carried").facts.bare.x, 1);

  /* 12. A cycle is refused deterministically. Copying it is not an option — the walk
     would not terminate — and aliasing it would leave a caller-owned node inside the
     frozen graph, which is the whole defect. */
  const cycle = { name: "self" };
  cycle.self = cycle;
  assert.throws(() => api.braidyHandoff({ intent: "ask", target: { kind: "project" }, facts: { cycle } }),
    /refers back to something that contains it/, "a cycle must be refused rather than walked or aliased");
  assert.ok(!Object.isFrozen(cycle), "a refused cycle must leave the caller's object untouched");
  /* The same value used twice in different branches is not a cycle and is carried. */
  const shared = { tag: "used-twice" };
  const twice = accept({ intent: "ask", target: { kind: "project" }, facts: { left: shared, right: shared } },
    "a value used twice in different branches is not a cycle and must be carried");
  assert.strictEqual(twice.facts.left.tag, "used-twice");
  assert.notStrictEqual(twice.facts.left, twice.facts.right, "a value used twice is copied twice; only a value containing itself is a cycle");
  assert.ok(!Object.isFrozen(shared));

  /* And a graph deeper than the record is bounded to is refused rather than walked. */
  let tower = { end: true };
  for (let i = 0; i < 12; i += 1) tower = { down: tower };
  assert.throws(() => api.braidyHandoff({ intent: "ask", target: { kind: "project" }, facts: tower }),
    /nested deeper than/, "facts are a bounded record; an unbounded graph must be refused");

  note("Facts: the whole graph is copied and frozen independently — nested objects, arrays, objects inside arrays and arrays inside arrays all identity-distinct, the caller's own nodes left unfrozen and mutable, cycles and unsupported shapes refused where they are handed over with the path named, and the record framed to the model as CineBraid's answer rather than as raw material");
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
  const stillMarkup = still.braidy.railMarkup();
  assert.ok(stillMarkup.includes('data-braidy-motion="none"'),
    "a reduced-motion reader must be served by the markup");
  const moving = loadRail(sources);
  assert.ok(moving.braidy.railMarkup().includes('data-braidy-motion="on"'));

  /* THE STRIP IS REPLACED, not merely stopped. A stopped animation on an eight-frame
     sheet still shows whichever cel it froze on; the reduced-motion answer is the
     package's single static FRONT frame, and the sheet is one box wide so there is
     nothing left to cycle even if something tried. */
  for (const state of [...api.BRAIDY_PRESENTATION_STATES]) {
    const sprite = api.braidySprite(state, { reducedMotion: true });
    assert.strictEqual(sprite.file, api.BRAIDY_STATIC_SPRITE.file,
      `reduced motion on "${state}" resolves to ${sprite.file}; every state must fall back to the one static frame`);
    assert.strictEqual(sprite.frames, 1, "the reduced-motion sprite must be a single frame, not a stopped strip");
    assert.strictEqual(sprite.still, true);
  }
  assert.ok(stillMarkup.includes(`background-image:url(&quot;${api.BRAIDY_SPRITE_BASE}${api.BRAIDY_STATIC_SPRITE.file}&quot;)`),
    "the rendered rail must actually load the static frame under reduced motion");
  assert.ok(stillMarkup.includes('data-braidy-still="1"'), "the markup must say the sprite is a still");
  assert.ok(!stillMarkup.includes('data-braidy-still="0"'));

  /* And the state stays legible without motion, in the two places that do not depend
     on the sprite at all. */
  assert.ok(/data-braidy-state="[a-z]+"/.test(stillMarkup), "the state must remain stamped under reduced motion");
  const pendingStill = loadRail(sources, { reducedMotion: true });
  pendingStill.braidy.ask("Anything?");
  const pendingMarkup = pendingStill.braidy.railMarkup();
  assert.ok(pendingMarkup.includes('data-braidy-state="thinking"') && /Thinking about it\./.test(pendingMarkup),
    "with no movement to read, the words must still say what Braidy is doing");

  const styles = sources.styles;
  const states = [...api.BRAIDY_PRESENTATION_STATES];
  assert.ok(/@media\(prefers-reduced-motion:reduce\)\{[^}]*cb-braidy-presence/.test(styles.replace(/\s+/g, "")),
    "the stylesheet must also stop Braidy's animation under a reduced-motion preference");
  assert.ok(styles.includes('.cb-braidy[data-braidy-motion="none"] .cb-braidy-presence'),
    "the stamped answer must be honoured by the stylesheet, not only recorded in the markup");
  /* THE GUARD HAS TO OUTRANK THE STATE RULES, not merely exist. Every state selector
     is three compound parts; a bare `.cb-braidy-presence[data-braidy-still="1"]` is
     two and loses to all five, which would leave an eight-frame keyframe walking a
     one-frame sheet and painting blank cells in the mode that exists to hold still.
     Equal weight plus later position is what makes it bite. */
  const guardAt = styles.indexOf('.cb-braidy .cb-braidy-presence[data-braidy-still="1"]{animation:none}');
  assert.notStrictEqual(guardAt, -1,
    "the still guard must be scoped under .cb-braidy so it weighs the same as the state rules it has to override");
  for (const state of states) {
    const ruleAt = styles.indexOf(`.cb-braidy[data-braidy-state="${state}"] .cb-braidy-presence{animation:`);
    assert.notStrictEqual(ruleAt, -1, `the stylesheet has no animation rule for "${state}"`);
    assert.ok(ruleAt < guardAt,
      `the "${state}" animation is declared after the still guard; at equal specificity it would win and cycle a one-frame sheet`);
  }

  /* THE TWO EVENT CUES RUN ONCE. This is the package's own classification — an
     ACKNOWLEDGE or NEEDS_DECISION that looped would be the demanding mascot the V3.2
     production notes were written to avoid. */
  for (const state of ["acknowledge", "attention"]) {
    const rule = new RegExp(`\\.cb-braidy\\[data-braidy-state="${state}"\\] \\.cb-braidy-presence\\{animation:cb-braidy-${state} \\d+ms step-end 1 forwards\\}`);
    assert.ok(rule.test(styles), `the ${state} cue must be declared as a single run that holds its last cel`);
    assert.ok(!new RegExp(`cb-braidy-${state} [^}]*infinite`).test(styles), `${state} must never loop`);
  }
  for (const state of ["idle", "listening", "thinking"]) {
    assert.ok(new RegExp(`animation:cb-braidy-${state} \\d+ms step-end infinite`).test(styles),
      `${state} is an ambient state and must repeat`);
  }

  note("Reduced motion: the derivation returns motion \"none\" without changing the state, every state falls back to the one static FRONT frame rather than a frozen strip, the words still say what Braidy is doing, and the two event cues are declared as single runs while the three ambient states repeat");
}

/* ===========================================================================
   10. A STALE OR CLOSED REQUEST CANNOT LEAVE BRAIDY THINKING.

   Three ways it could: the rail is closed while a question is outstanding, a second
   question supersedes the first, and a response arrives after either. All three end
   the same way, because there is one sequence number and it is the only thing allowed
   to settle anything.
   =========================================================================== */

async function checkStaleRequestCannotStick(sources = SOURCES) {
  const api = loadContract(sources.contract);
  /* Closed. */
  const closed = loadRail(sources);
  closed.braidy.ask("What now?");
  assert.strictEqual(closed.braidy.presentation().state, "thinking");

  /* THE SPRITE IS PART OF THIS. A presentation state that left thinking while the
     rendered strip stayed on PROCESSING would keep Braidy visibly working on a
     question nobody is waiting for — the same defect one layer down, and invisible to
     every assertion about tokens. */
  const working = api.braidySprite("thinking").file;
  assert.ok(closed.braidy.railMarkup().includes(`data-braidy-sprite="${working}"`),
    "a live request must actually draw the working animation");
  closed.braidy.abort("That question was stopped when the rail was closed.");
  const afterAbort = closed.braidy.railMarkup();
  assert.ok(!afterAbort.includes(`data-braidy-sprite="${working}"`),
    "the working animation is still on screen after the request was aborted; the strip must stop with the state that selected it");
  assert.ok(afterAbort.includes(`data-braidy-sprite="${api.braidySprite("attention").file}"`),
    "a stopped question settles onto the decision cue, not onto nothing");
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

  note("Staleness: aborting clears pending, stops the working strip and discards the late answer, a superseded question's answer never lands while the live one still does, closing the rail aborts, losing the production resets, a project switch clears the conversation, and every signal Braidy subscribes to is one CineBraid dispatches");
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

  /* AND IT CANNOT CHOOSE A SPRITE EITHER. The answer above asked for a file by name;
     the drawn sprite is whatever the closed table returns for the presentation state,
     which is derived from request tokens the answer cannot reach. */
  const drawn = /data-braidy-sprite="([^"]+)"/.exec(markup);
  assert.ok(drawn, "the rail must record which sprite it drew");
  const drawnState = /data-braidy-state="([a-z]+)"/.exec(markup)[1];
  assert.strictEqual(drawn[1], api.braidySprite(drawnState).file,
    "the rendered sprite is not the one the table returns for the rendered state; something other than the presentation state chose the image");
  assert.ok(!/braidy-(excited|bounce|wiggle|dance|angry)/.test(markup),
    "no sprite outside the five mapped states may be referenced from a rendered rail");

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
   16. THE ART IS REAL, IT IS THE PACKAGE'S, AND IT IS UNEDITED.

   Braidy V3.2 — the knot-forward production library — is authored outside this
   repository. Six exported PNG strips were copied in and nothing else: not the 64x64
   Aseprite master, not the build or verification scripts, not the review boards, not
   the GIF QA previews, not the 2x/4x/8x packs. Fifteen kilobytes.

   THE LEDGER BELOW IS THE PROVENANCE RECORD. Each row is the file's path inside the
   authoring package and the SHA-256 that package's own
   docs/BRAIDY_PACKAGE_MANIFEST_V32.sha256 records for it. The copied bytes are hashed
   here and must equal it, so "unedited" is a measurement rather than a claim — and an
   asset re-exported, rescaled or touched up to make something pass fails this before
   it reaches anything else.
   =========================================================================== */

/* source path in C:/CineBraid/Braidy_Sprites, and that package's manifest hash. */
const ADOPTED_ART = Object.freeze([
  Object.freeze({ file: "braidy-idle-soft-v32.png", source: "exports/v32/animations/idle_soft.png", sha256: "cce5a67a3987db995f0d57ac85203b1107fc718290a9a055b6808d182e2b366d", tag: "IDLE_SOFT" }),
  Object.freeze({ file: "braidy-listening-v32.png", source: "exports/v32/animations/listening.png", sha256: "b5a7b656b3a2dbd633c922a9d5e9542416e169b973f87aa0b989b62f9e4f28a1", tag: "LISTENING" }),
  Object.freeze({ file: "braidy-processing-v32.png", source: "exports/v32/animations/processing.png", sha256: "81ac5119960cbd943e7da47207bc64202b1845d2fe17dcbce6a74026a8e82f78", tag: "PROCESSING" }),
  Object.freeze({ file: "braidy-acknowledge-v32.png", source: "exports/v32/animations/acknowledge.png", sha256: "d8384fa81d274075d2ea394cf2b455ad459a8581ff9fcd5dca0e7c87dd068d99", tag: "ACKNOWLEDGE" }),
  Object.freeze({ file: "braidy-needs-decision-v32.png", source: "exports/v32/animations/needs_decision.png", sha256: "82582272ddeda72bc38f4c35932d2017499446acea351fce45ab4abaf85b3b76", tag: "NEEDS_DECISION" }),
  Object.freeze({ file: "braidy-front-v32.png", source: "previews/v32/braidy_front_v32.png", sha256: "3dd9026268806b020deac50370d621c30f2b22bac134cd32e632aa34921f887d", tag: "FRONT" }),
]);

/* The canonical frame the whole package is authored at, and the box the rail draws in.
   64 into 32 is exactly one device pixel per source pixel at a ratio of 2. */
const CANONICAL_FRAME = 64;

/* Enough of a PNG header to answer three questions without a decoder: how wide the
   strip is, whether it carries an alpha channel, and whether it is a PNG at all. */
function pngHeader(file) {
  const head = Buffer.alloc(33);
  const handle = fs.openSync(file, "r");
  try { fs.readSync(handle, head, 0, 33, 0); } finally { fs.closeSync(handle); }
  assert.strictEqual(head.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} is not a PNG`);
  assert.strictEqual(head.subarray(12, 16).toString("ascii"), "IHDR", `${file} does not start with IHDR`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), depth: head[24], colorType: head[25] };
}

function checkSpriteAssets(sources = SOURCES) {
  const api = loadContract(sources.contract);
  const dir = sources.assetDir || path.join(ROOT, "public", "assets", "assistant-character");

  /* ---- the bytes are the package's ---- */
  const shipped = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  assert.deepStrictEqual(shipped, ADOPTED_ART.map((row) => row.file).sort(),
    "the runtime asset directory must hold exactly the six adopted files and nothing else; a stray export is an asset nobody verified");
  for (const row of ADOPTED_ART) {
    const file = path.join(dir, row.file);
    const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.strictEqual(digest, row.sha256,
      `${row.file} does not match the hash BRAIDY_PACKAGE_MANIFEST_V32.sha256 records for ${row.source}. The art is adopted unedited; a re-export or a touch-up is not the approved asset.`);
    const png = pngHeader(file);
    assert.strictEqual(png.height, CANONICAL_FRAME, `${row.file} is not ${CANONICAL_FRAME}px tall; it is not the canonical frame`);
    assert.strictEqual(png.colorType, 6, `${row.file} carries no alpha channel; the rail composites Braidy over the panel and an opaque sprite would render a box`);
    assert.strictEqual(png.width % CANONICAL_FRAME, 0, `${row.file} is not a whole number of ${CANONICAL_FRAME}px frames wide`);
  }

  /* ---- every product state resolves to one of them ---- */
  const states = [...api.BRAIDY_PRESENTATION_STATES];
  assert.deepStrictEqual(Object.keys(api.BRAIDY_SPRITES).sort(), [...states].sort(),
    "the sprite table and the presentation states must be the same five; a state with no art renders nothing and art with no state ships for nobody");
  for (const state of states) {
    const sprite = api.braidySprite(state);
    assert.ok(sprite, `state "${state}" resolves to no sprite`);
    const row = ADOPTED_ART.find((entry) => entry.file === sprite.file);
    assert.ok(row, `state "${state}" names ${sprite.file}, which is not one of the adopted files`);
    assert.strictEqual(sprite.tag, row.tag, `state "${state}" claims tag ${sprite.tag} but its file is the ${row.tag} export`);
    /* The frame count is read off the actual image rather than trusted from the table,
       so a metadata edit cannot silently describe a strip that is not there. */
    const png = pngHeader(path.join(dir, sprite.file));
    assert.strictEqual(sprite.frames, png.width / CANONICAL_FRAME,
      `the table says "${state}" has ${sprite.frames} frames; ${sprite.file} contains ${png.width / CANONICAL_FRAME}`);
    assert.strictEqual(sprite.durations.length, sprite.frames, `"${state}" has one duration per frame or the timing is not the art's`);
    assert.strictEqual(sprite.totalMs, sprite.durations.reduce((sum, ms) => sum + ms, 0));
    assert.strictEqual(sprite.sheetWidth, sprite.frames * api.BRAIDY_SPRITE_SIZE);
  }

  /* ---- no placeholder survives anywhere ---- */
  const everywhere = [sources.contract, sources.rail, sources.surfaces, sources.styles].join("\n");
  for (const token of ["data-braidy-art=\"absent\"", "cb-braidy-loop", "BRAIDY_ASSET_NEEDED"]) {
    assert.ok(!everywhere.includes(token),
      `the placeholder token ${token} survives; the art is here and nothing may still be standing in for it`);
  }
  const markup = loadRail(sources).braidy.railMarkup();
  assert.ok(markup.includes('data-braidy-art="v32"'), "the rendered rail must declare which asset generation it is drawing");
  assert.ok(!markup.includes('data-braidy-art="unresolved"'), "no state may render without art");

  /* ---- the mapping is the package's, and it is the restrained reading ---- */
  assert.strictEqual(api.BRAIDY_SPRITES.idle.tag, "IDLE_SOFT",
    "idle must draw the restrained IDLE_SOFT the package maps its own creator-facing idle to, not the busier ambient IDLE");
  assert.strictEqual(api.BRAIDY_SPRITES.thinking.tag, "PROCESSING",
    "a request in flight is work, so it draws PROCESSING; THINKING belongs to the package's cognitive mix and would have Braidy look contemplative while CineBraid is simply executing");
  assert.strictEqual(api.BRAIDY_SPRITES.attention.tag, "NEEDS_DECISION",
    "attention must draw the dedicated point-and-beacon cue rather than an alarm");
  assert.strictEqual(api.BRAIDY_SPRITES.acknowledge.loop, false, "acknowledge is an event cue and plays once");
  assert.strictEqual(api.BRAIDY_SPRITES.attention.loop, false, "the decision cue plays once and gets out of the way");
  for (const ambient of ["idle", "listening", "thinking"]) {
    assert.strictEqual(api.BRAIDY_SPRITES[ambient].loop, true, `${ambient} is an ambient state and repeats`);
  }
  /* None of the loud library is reachable. The package ships EXCITED, BOUNCE, WIGGLE,
     DANCE and ANGRY; a working editor is not the place for any of them. */
  for (const loud of ["EXCITED", "BOUNCE", "WIGGLE", "DANCE_SWAY", "DANCE_STEP", "ANGRY", "SURPRISED", "EXCITED_BIG", "HAPPY"]) {
    assert.ok(!Object.values(api.BRAIDY_SPRITES).some((sprite) => sprite.tag === loud),
      `the ${loud} animation is mapped to a rail state; celebration and personality tags are not ambient UI`);
  }

  /* ---- a name cannot become a path ---- */
  for (const hostile of ["../../server.js", "/etc/passwd", "braidy-idle-soft-v32.png", "constructor", "toString",
    "__proto__", "excited", "", "  ", "assets/assistant-character/braidy-front-v32.png"]) {
    assert.strictEqual(api.braidySprite(hostile), null,
      `braidySprite accepted "${hostile}"; only the five declared states may resolve to an image, and never a caller-supplied path`);
  }
  const railCode = codeOnly(sources.rail);
  assert.ok(!/BRAIDY_SPRITE_BASE\s*\+/.test(railCode) && !/assets\/assistant-character\/\$\{/.test(railCode),
    "the rail must not build a sprite path itself; the only path in the runtime is the one the closed table returns");

  /* ---- the stylesheet's timing IS the art's timing ---- */
  const flat = sources.styles.replace(/\s+/g, "");
  for (const state of states) {
    const sprite = api.braidySprite(state);
    const block = new RegExp(`@keyframescb-braidy-${state}\\{([^}]*\\}[^@]*?)\\}(?=@|\\.|/|$)`);
    const start = flat.indexOf(`@keyframescb-braidy-${state}{`);
    assert.notStrictEqual(start, -1, `the stylesheet declares no keyframes for "${state}"`);
    let depth = 0, end = -1;
    for (let i = flat.indexOf("{", start); i < flat.length; i += 1) {
      if (flat[i] === "{") depth += 1;
      else if (flat[i] === "}") { depth -= 1; if (!depth) { end = i; break; } }
    }
    const body = flat.slice(flat.indexOf("{", start) + 1, end);
    const stops = [...body.matchAll(/([\d.]+)%\{background-position-x:(-?\d+)px\}/g)]
      .map((m) => ({ pct: Number(m[1]), x: Number(m[2]) }));
    assert.strictEqual(stops.length, sprite.frames,
      `"${state}" has ${sprite.frames} frames but ${stops.length} keyframe stops; the stylesheet and the art disagree about the animation`);
    let elapsed = 0;
    stops.forEach((stop, index) => {
      const expected = (elapsed * 100) / sprite.totalMs;
      assert.ok(Math.abs(stop.pct - expected) < 0.01,
        `"${state}" frame ${index} starts at ${stop.pct}% and the art says ${expected.toFixed(4)}%. The stops are the authored durations or the motion is not the one that was approved.`);
      /* `|| 0` because -0 is what `-0 * size` produces and assert distinguishes it
         from the 0 parsed out of the stylesheet. */
      assert.strictEqual(stop.x, -(index * api.BRAIDY_SPRITE_SIZE) || 0,
        `"${state}" frame ${index} is offset ${stop.x}px; the window must advance exactly one ${api.BRAIDY_SPRITE_SIZE}px cell per frame`);
      elapsed += sprite.durations[index];
    });
    assert.ok(flat.includes(`animation:cb-braidy-${state}${sprite.totalMs}msstep-end`),
      `"${state}" must run for the ${sprite.totalMs}ms the art was authored at, with step-end so cels do not blend`);
  }
  assert.ok(flat.includes("image-rendering:pixelated"), "the package requires nearest-neighbour rendering; anything else blurs 64px art");
  /* Read from the unflattened source: `flex:0 0 auto` loses its spaces in `flat`. */
  assert.ok(/\.cb-braidy-presence\{[^}]*width:32px;height:32px/.test(sources.styles),
    "the presence must be the 32px box the 64px frame divides into exactly");

  /* ---- the acknowledge state lasts exactly as long as its animation ---- */
  const ackMs = /const ACKNOWLEDGE_MS = (\d+);/.exec(codeOnly(sources.rail));
  assert.ok(ackMs, "the rail must declare how long the acknowledge pose lasts");
  assert.strictEqual(Number(ackMs[1]), api.BRAIDY_SPRITES.acknowledge.totalMs,
    "the acknowledge pose must last exactly as long as the ACKNOWLEDGE animation; a longer state holds a finished cel and a shorter one cuts the cue off");

  /* ---- the research namespace stays out of the product ---- */
  for (const row of ADOPTED_ART) {
    const repoPath = `public/assets/assistant-character/${row.file}`;
    assert.ok(!repoPath.startsWith("braidy/") && !repoPath.startsWith("research/"),
      `${repoPath} sits in the historical research namespace that tests/public-exposure.js forbids`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, "braidy")), "a top-level braidy/ directory is the research namespace and must never exist in the product");
  assert.ok(!fs.existsSync(path.join(ROOT, "research")), "a top-level research/ directory must never exist in the product");
  assert.ok(sources.exposure.includes('p.startsWith("braidy/") || p.startsWith("research/")'),
    "the public-exposure detector must still forbid the research namespaces; adopting art is not a reason to relax it");

  /* ---- the URL the browser asks for actually reaches them ----

     public/assets/ and the project-media route share the /assets/ prefix. The static
     mount is declared FIRST, so a request for a shipped sprite is answered from
     public/ before the media handler ever sees it — and that handler would refuse it
     anyway, because its allowlist names anchors, plates, props, vehicles, audio, media
     and shot takes and nothing else. Reordering those two declarations would 404 every
     frame of Braidy while every unit test in this file still passed, which is why the
     order is asserted here rather than left to be rediscovered in a browser. */
  const staticAt = sources.server.indexOf('express.static(path.join(__dirname, "public")');
  const mediaAt = sources.server.indexOf('app.get("/assets/*"');
  assert.notStrictEqual(staticAt, -1, "server.js must serve public/ statically");
  assert.notStrictEqual(mediaAt, -1, "server.js must still have its project-media route");
  assert.ok(staticAt < mediaAt,
    "the project-media /assets/* route is declared before the static mount; it would intercept every Braidy sprite request and answer 404");
  assert.ok(!/anchors\|plates\|props\|vehicles\|audio\|media\|assistant-character/.test(sources.server),
    "the project-media route must not be widened to serve the character; the sprites are static files and are served as static files");

  /* ---- and a release actually carries them ---- */
  for (const row of ADOPTED_ART) {
    assert.ok(sources.release.includes(`public/assets/assistant-character/${row.file}`),
      `${row.file} is not named in the release media allowlist; a release would either drop it or fail on it as stray media`);
  }

  note(`Art: six V3.2 exports adopted byte-for-byte against BRAIDY_PACKAGE_MANIFEST_V32.sha256, all RGBA 64px-tall strips; five states map to the package's own tags with idle on IDLE_SOFT and thinking on PROCESSING; no name can become a path; every keyframe stop is the authored duration; the research namespace stays absent and the release carries all six`);
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
  checkSpriteAssets();
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
  checkSpriteAssets,
  ADOPTED_ART,
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
