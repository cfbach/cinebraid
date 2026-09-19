/* REFERENCE_FIRST_CANON_SIMPLIFICATION_V1 — one truthful "needed now", one first-canon action.
 *
 * The Last Seat integration proof met four figures for one prop on the way to its first
 * canon ("Prepare 5 required references" beside the chair's name, "0 of 4 required views",
 * "1 required reference", "Views 0/6") and seven generation-flavoured entry points, with the
 * paid path five presses deep. This suite holds the correction:
 *
 *   A  entityImmediateNeed() answers from readiness, in six truth states and fail-closed
 *   B  every reference surface prints that one answer, with coverage and continuity states
 *      named as themselves and a shot-wide total never presented as the entity's own count
 *   C  the one warm action follows the need: generate, review, or open the state. With nothing
 *      needed now nothing is warm; optional coverage stays reachable as a secondary control,
 *      and its views are named in words ("Three-quarter view"), never as a second fraction
 *   D  Generate primary reference compiles the rules-based prompt and opens the existing
 *      paid confirmation, showing the prompt that will be sent; nothing is submitted until
 *      START GENERATION, and that submission still passes the plan gate and the permit
 *   E  an unreachable assistant does not disable the rules-based path
 *   F  Upload, More options, the manual builder, Braidy, candidate review, provenance and
 *      the continuity-state workspace all stay reachable
 *
 * Provider calls made by this suite: 0. The paid dispatch is exercised against a harness
 * route that records the request and answers it; nothing leaves the process.
 *
 * `run({ mutateSource })` is exported so tests/reference-first-canon-negative-controls.js
 * can break a guarantee in memory and require the matching assertion to catch it. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { render, rawFixture, withCanon } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const DESK_RUNTIME = ["shared-reference-media.js", "reference-desk.js", "reference-coverage-build.js"];
const CHAIR = "PROP-CHAIR";
const COMPILED = "PURPOSE\nCreate a prop reference for Folding Chair.\n\nSUBJECT\nSlightly battered dull-gray metal folding chair, isolated hero prop reference.";

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks++; };

/* ---------------------------------------------------------------------------
   FIXTURE. The harness shot L1-01 uses Kai, the hull and the tool; this adds the
   Folding Chair to it. Only the shot's frames are canon, so the SHOT owes several
   references (its own total) while the CHAIR owes exactly one. `cast: false` is the
   chair no shot uses; `state` declares a required continuity state the shot needs. */
function fixture({ cast = true, candidate = false, primaryCanon = false, state = false, stateCanon = false } = {}) {
  const project = rawFixture();
  const states = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: primaryCanon ? "PROP-CHAIR-PRIMARY.png" : "" }];
  if (state) states.push({ id: "state-folded", name: "Folded", isDefault: false, parentStateId: "state-default", referenceRequirement: "required", generationMode: "derive",
    approvedFile: stateCanon ? "PROP-CHAIR-FOLDED.png" : "", notes: "Folded flat and carried under an arm." });
  const candidateFiles = [];
  if (candidate || primaryCanon) candidateFiles.push({ stored: "PROP-CHAIR-PRIMARY.png", original: "chair.png", decision: primaryCanon ? "approved" : "unreviewed", coverageJobType: "single-reference", targetStateId: "state-default" });
  if (stateCanon) candidateFiles.push({ stored: "PROP-CHAIR-FOLDED.png", original: "folded.png", decision: "approved", coverageJobType: "single-reference", targetStateId: "state-folded" });
  project.props.push({
    id: CHAIR, name: "Folding Chair", prefix: CHAIR, status: "NOT STARTED", workflowStatus: "DRAFT",
    visualDescription: "Slightly battered dull-gray metal folding chair with a small white label reading HALL PROPERTY.",
    approvedFile: primaryCanon ? "PROP-CHAIR-PRIMARY.png" : "",
    continuityStates: states,
    coverageSlots: [
      { id: "hero", label: "Front / hero", requirement: "required", selectedFile: "" },
      { id: "three-quarter", label: "3/4 view", requirement: "required", selectedFile: "" },
      { id: "side", label: "Side", requirement: "required", selectedFile: "" },
      { id: "rear", label: "Rear", requirement: "planned", selectedFile: "" },
      { id: "top", label: "Top", requirement: "planned", selectedFile: "" },
      { id: "detail", label: "Detail / function close-up", requirement: "required", selectedFile: "" },
    ],
    candidateFiles,
  });
  const shot = project.shots[0];
  if (cast) {
    shot.codes = [...(shot.codes || []), CHAIR];
    shot.continuityStateSelections = { [CHAIR]: state ? "state-folded" : "state-default" };
  }
  const rows = [];
  for (const s of project.shots) {
    for (const frame of s.keyframes || []) if (frame.winner) rows.push({ kind: "shot-frame", shotId: s.id, frameId: frame.id, value: frame.winner });
    for (const clip of s.clips || []) if (clip.videoWinner) rows.push({ kind: "shot-motion", shotId: s.id, unitKey: clip.id || clip.suffix || "", value: clip.videoWinner });
  }
  if (primaryCanon) rows.push({ kind: "entity-state", list: "props", entityId: CHAIR, stateId: "state-default", value: "PROP-CHAIR-PRIMARY.png" });
  if (stateCanon) rows.push({ kind: "entity-state", list: "props", entityId: CHAIR, stateId: "state-folded", value: "PROP-CHAIR-FOLDED.png" });
  return rows.length ? withCanon(project, rows) : project;
}

/* A recording harness: the rules-based compile answers with a fixed prompt, the paid
   permit and the job route answer the way the server does, and every request is kept. */
function harnessFetch(calls) {
  return async (url, options, respond) => {
    const method = String(options.method || "GET").toUpperCase();
    if (url === "/api/prompt/asset-compile" && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      calls.push({ url, method, body });
      return respond({ compiledPrompt: COMPILED, spec: {}, profile: { name: "GPT Image 2", profileVersion: "test" }, warnings: [], llmUsed: false });
    }
    if (url === "/api/generation/paid-permit" && method === "POST") {
      calls.push({ url, method, body: JSON.parse(options.body || "{}") });
      return respond({ paidPermitId: "permit-rfcs-1" });
    }
    if (url === "/api/generation/fal/jobs" && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      calls.push({ url, method, body });
      return respond({ ok: true, job: { id: "rfcs-job-1", status: "IN_QUEUE", purpose: body.purpose, entityList: body.entityList, entityId: body.entityId } });
    }
    return null;
  };
}

const SCAN_FILES = {
  candidate: [{ name: "PROP-CHAIR-PRIMARY.png", assetId: "", available: true, url: "/assets/props/PROP-CHAIR-PRIMARY.png", stateId: "" }],
  folded: [{ name: "PROP-CHAIR-FOLDED.png", assetId: "", available: true, url: "/assets/props/PROP-CHAIR-FOLDED.png", stateId: "state-folded" }],
};

/* Boot the real app in the harness, then the Desk runtime (not in the shared list), with
   the Desk's delegated click listener captured so a press is delivered the way the page
   receives it. */
async function boot(project, { mutateSource, files = [], textReady = true, generationReady = true } = {}) {
  const calls = [];
  const agentStatus = textReady ? {} : { capabilities: {
    text: { ready: false, standing: "unreachable", label: "Text assistance", provider: "custom", model: "offline", message: "Text assistance cannot reach the custom AI server (unreachable).", action: "" },
  } };
  const rendered = await render("#/production", project, { mutateSource, fetch: harnessFetch(calls), agentStatus });
  const run = (source) => vm.runInContext(source, rendered.context);
  run("globalThis.matchMedia = () => ({ matches: false, addEventListener() {} }); globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0); pollFalGeneration = () => {};");
  run(`CONFIG.generation = CONFIG.generation || {}; CONFIG.generation.fal = { ...(CONFIG.generation.fal || {}), enabled: ${generationReady ? "true" : "false"}, keySource: ${generationReady ? '"environment"' : '""'}, apiKey: "", textModel: "openai/gpt-image-2", frameOutputs: 1, frameQuality: "low", frameResolution: "2k" };`);
  for (const file of DESK_RUNTIME) {
    const original = fs.readFileSync(path.join(ROOT, "public", file), "utf8");
    const source = mutateSource ? String(mutateSource(file, original) ?? original) : original;
    if (file === "reference-desk.js") run("globalThis.__rfcsAdd = document.addEventListener; document.addEventListener = function (type, fn, options) { if (type === 'click') globalThis.__rfcsDeskClick = fn; return globalThis.__rfcsAdd.call(document, type, fn, options); };");
    vm.runInContext(source, rendered.context, { filename: file });
    if (file === "reference-desk.js") run("document.addEventListener = globalThis.__rfcsAdd;");
  }
  run(`SCAN.references = { characters: {}, locations: {}, props: { '${CHAIR}': ${JSON.stringify(files)} }, vehicles: {} };`);
  return { rendered, calls, run };
}
const chair = (run) => `P.props.find((x) => x.id === '${CHAIR}')`;
const needOf = (run) => JSON.parse(run(`JSON.stringify((() => { const n = entityImmediateNeed('props', ${chair()}); return { ...n, words: entityImmediateNeedWords(n) }; })())`));
const deskOf = (run) => run(`CineBraidReferenceDesk.view('props', '${CHAIR}')`);
const warm = (html) => [...html.matchAll(/<button type="button" (?:id="[^"]*" )?class="rd-button rd-primary"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
const shotTotal = (run) => Number(run(`(() => { const shot = evaluateShotReadiness(P, P.shots[0], readinessOracleForBrowser()); return outstandingReadinessRows(shot).filter((row) => row.target && row.target.kind === 'entity-state').length; })()`));
const toolsOf = async (booted, task) => {
  booted.run(`boundedWriteFocusedTask('entity-task', 'props:${CHAIR}', '${task}'); location.hash = '#/prop/${CHAIR}/tools';`);
  await booted.run("route()");
  return booted.run("document.getElementById('main').innerHTML");
};
const deskClick = (run, action) => run(`__rfcsDeskClick({ target: { id: '', closest: (sel) => /data-rd-action/.test(String(sel)) ? { dataset: { rdAction: '${action}' }, disabled: false, hasAttribute: () => false } : null } })`);
async function settle(run, expression, limit = 300) {
  for (let i = 0; i < limit; i++) {
    if (run(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

/* =========================================================================
   A + B + C — THE SIX TRUTH STATES, ONE ANSWER, EVERY SURFACE. */
async function testNoCanonNoCandidate(options) {
  const booted = await boot(fixture(), options);
  const need = needOf(booted.run);
  const obligations = JSON.parse(booted.run(`JSON.stringify(entityCurrentObligations('props', ${chair()}, entityReferenceDemandFor('props', ${chair()})))`));
  eq(obligations.known, true, "A1 baseline: readiness answers for the chair");
  eq(obligations.rows.length, 1, "A1 baseline: readiness owes exactly one row on the chair, its Default");
  eq(need.primary.length, 1, "A1: needed now is the readiness obligation on the primary");
  eq(need.now.length, obligations.rows.length, "A1: and counts exactly the readiness rows, no more");
  eq(need.words.now, "1 primary reference", "A1: in words, one primary reference");
  eq(need.action.kind, "generate-primary", "A1: with nothing to decide, the next step is the first canon");
  eq(need.views.length, 0, "A1: no coverage view is needed now while readiness can answer");
  eq(need.coverage.views.total, 4, "A1: coverage is counted over the plan (the four structurally required views)");
  eq(need.words.coverage, "0/4 planned views", "A1: and named as planned coverage");
  eq(need.words.recommended, "2 recommended", "A1: recommended views are counted beside it, not in it");
  ok(/required by Shot L1-01/.test(need.words.detail), `A1: the detail names who is waiting (${need.words.detail})`);

  /* One shot needs several references; the chair's own count stays one. */
  const total = shotTotal(booted.run);
  ok(total > 1, `A6 baseline: the shot owes several references (${total})`);
  const desk = deskOf(booted.run);
  eq((/data-rd-needs-now="(\d+)"/.exec(desk) || [])[1], "1", "A6: the Desk counts the chair's own obligation, not the shot's total");
  ok(!new RegExp(`\\b${total} (required |primary )?references?\\b`).test(desk), `A6: the shot's total of ${total} never appears as a reference count on the Desk`);

  /* B — the Desk states the need, then coverage, each labelled. */
  ok(/<p class="rd-need rd-need-now"><span>Needed now<\/span><b>1 primary reference<\/b>/.test(desk), "B1: the Desk says Needed now · 1 primary reference");
  ok(/<p class="rd-need rd-need-coverage"><span>Coverage<\/span><b>0\/4 planned views<\/b>/.test(desk), "B1: and Coverage · 0/4 planned views on its own line");
  ok(/<section class="rd-coverage"><header><h2>Coverage<\/h2><span>0 of 4 planned views filled<\/span>/.test(desk), "B1: the coverage section is named Coverage and counts planned views");
  ok(!/required views? (filled|remains?)/.test(desk), "B1: nothing on the Desk calls the plan required views");
  /* C — one warm action and it is the first canon. */
  eq(JSON.stringify(warm(desk)), JSON.stringify(["Generate primary reference"]), "C1: exactly one warm action, Generate primary reference");
  ok(/id="rd-generate-primary" class="rd-button rd-primary" data-rd-action="generate-primary"/.test(desk), "C1: on the canvas, as a real button");
  ok(!/disabled/.test((/<button type="button" id="rd-generate-primary"[^>]*>/.exec(desk) || [""])[0]), "C1: and not disabled");
  ok(/Nothing is sent or charged until you confirm there\./.test(desk), "C1: which says nothing is sent or charged before the confirmation");

  /* References card, Production needs, the hub and the hero say the same. */
  const library = booted.run("CineBraidReferenceDesk.library('all')");
  const card = (/<a class="rd-library-card"[^>]*href="#\/prop\/PROP-CHAIR">([\s\S]*?)<\/a>/.exec(library) || [])[1] || "";
  ok(/data-rd-card-need="1">Needed now · 1 primary reference</.test(card), "B2: the References card states the same immediate need");
  ok(/Coverage · 0\/4 planned views</.test(card), "B2: and names its coverage as coverage");
  ok(!/required views filled/.test(library), "B2: no References card calls coverage required views");
  const needs = await toolsOf(booted, "coverage");
  ok(/NEEDED NOW<\/span><b>1 primary reference<\/b>/.test(needs), "B3: Production needs says the same, by what it is");
  ok(/<span>COVERAGE<\/span><b>0\/4 planned views<\/b><small>2 recommended<\/small>/.test(needs), "B3: with coverage over the same plan, recommended beside it");
  ok(!/3\/4/.test(needs), "B3: no \"3/4\" fraction sits on Production needs beside its coverage fraction");
  eq(booted.run(`entityDemandRows('props', ${chair()}).find((row) => row.id === 'three-quarter').label`), "Three-quarter view", "B3: its view rows name the three-quarter view in words");
  const board = booted.run(`coverageBoardMarkup('props', ${chair()}, new Map(), [], entityDemandContext('props', ${chair()}))`);
  ok(/<span>Three-quarter view<\/span>/.test(board) && !/3\/4/.test(board), "B3: and so does the coverage board's view rail");
  ok(/<b>Three-quarter view<\/b><small>Missing<\/small>/.test(desk), "B1: the Desk's view button names it in words too");
  booted.run(`CineBraidBuildCoverage.open({ list: 'props', id: '${CHAIR}', stateId: 'state-default' })`);
  const build = booted.run("document.getElementById('modal').innerHTML");
  ok(/<th scope="row">Three-quarter view<\/th>/.test(build) && !/3\/4/.test(build), "B6: Build coverage's views table names it the same way");
  booted.run("closeModal()");
  const workspace = await toolsOf(booted, "reference");
  ok(/data-need-now="1" data-need-action="generate-primary"/.test(workspace), "B4: the primary workspace hero reads the same need");
  ok(/<span>Needed now<\/span><b>1 primary reference<\/b>/.test(workspace), "B4: in the same words");
  ok(/COVERAGE 0\/4 PLANNED VIEWS/.test(workspace), "B4: and the hub's coverage is the same fraction, named coverage");
  ok(/>Generate primary reference</.test(workspace) && /generatePrimaryReference\('props','PROP-CHAIR'/.test(workspace), "C1: the hero's first task is the same one-press action");
  return booted;
}

async function testCandidateNotApproved(options) {
  const booted = await boot(fixture({ candidate: true }), { ...options, files: SCAN_FILES.candidate });
  const need = needOf(booted.run);
  eq(need.words.now, "1 primary reference", "A2: with a candidate, the primary is still what is needed now");
  eq(need.action.kind, "review-primary", "A2: and the next step is reviewing it, not generating another");
  eq(JSON.stringify(need.candidates), JSON.stringify(["PROP-CHAIR-PRIMARY.png"]), "A2: the candidate is the one on the primary");
  ok(/1 candidate waiting for your decision/.test(need.words.detail), "A2: the detail says a decision is waiting");
  const desk = deskOf(booted.run);
  ok(!/data-rd-action="generate-primary"/.test(desk), "C2: no Generate primary reference is offered over an undecided candidate");
  eq(JSON.stringify(warm(desk)), JSON.stringify(["Approve reference…"]), "C2: the one warm action is approving the candidate");
  ok(/class="rd-button " data-rd-action="build"/.test(desk), "C2: coverage stays available, as a secondary control");
  const workspace = await toolsOf(booted, "reference");
  ok(/class="fold compact-entity-section entity-candidate-section bounded-source-section" data-candidates="1" open>/.test(workspace), "F3: candidate review is open on the primary workspace");
}

async function testPrimaryCanonCoverageIncomplete(options) {
  const booted = await boot(fixture({ candidate: true, primaryCanon: true }), { ...options, files: SCAN_FILES.candidate });
  const need = needOf(booted.run);
  eq(need.now.length, 0, "A3: with the primary canon and no state owed, nothing is needed now");
  eq(need.words.now, "None", "A3: in words, None");
  eq(need.action.kind, "complete", "A3: the need is complete");
  eq(need.words.coverage, "0/4 planned views", "A3: coverage is still reported, still as planned coverage");
  const desk = deskOf(booted.run);
  ok(!/data-rd-action="generate-primary"/.test(desk) && !/data-rd-action="approve"/.test(desk), "C3: an approved primary offers neither generation nor approval as its action");
  /* NOTHING NEEDED NOW IS NOT A CALL TO ACTION. Planned coverage is optional work: it stays in its section,
     reachable, as a secondary control, and nothing on the Desk carries the warm accent. */
  eq(JSON.stringify(warm(desk)), "[]", "C3: with nothing needed now, no control is warm — optional coverage must not look required");
  ok(/<button type="button" class="rd-button " data-rd-action="build" data-rd-build-slot="hero" data-rd-coverage-next="hero"\s*>Start coverage — Front \/ hero<\/button>/.test(desk),
    "C3: coverage stays reachable in its section, as a secondary control");
  ok(/Every current shot requirement on this prop is met/.test(desk), "C3: and the Desk says the need is met");
  /* The next view is named in words beside "1/4 planned views", never as a second fraction. */
  booted.run(`${chair()}.coverageSlots.find((s) => s.id === 'hero').selectedFile = 'PROP-CHAIR-PRIMARY.png';`);
  const continued = deskOf(booted.run);
  ok(/<p class="rd-need rd-need-coverage"><span>Coverage<\/span><b>1\/4 planned views<\/b>/.test(continued), "C6 baseline: one planned view is filled");
  ok(/<button type="button" class="rd-button " data-rd-action="build" data-rd-build-slot="three-quarter" data-rd-coverage-next="three-quarter"\s*>Continue coverage — Three-quarter view<\/button>/.test(continued),
    "C6: the continuation names the three-quarter view in words, as a secondary control");
  eq(JSON.stringify(warm(continued)), "[]", "C6: and still nothing is warm");
  ok(!/3\/4/.test(continued), "C6: no \"3/4\" sits beside \"1/4 planned views\" anywhere on the Desk");
  eq(booted.run(`${chair()}.coverageSlots.find((s) => s.id === 'three-quarter').label`), "3/4 view", "C6: the stored label is unchanged");
}

async function testRequiredStateMissing(options) {
  const booted = await boot(fixture({ candidate: true, primaryCanon: true, state: true }), { ...options, files: SCAN_FILES.candidate });
  const need = needOf(booted.run);
  eq(need.primary.length, 0, "A4: the canon primary is not needed now");
  eq(need.states.length, 1, "A4: the declared state the shot waits on is");
  eq(need.words.now, "1 continuity state", "A4: named as a continuity state, not as a reference count");
  eq(JSON.stringify(need.action), JSON.stringify({ kind: "open-state", stateId: "state-folded", label: "Folded" }), "A4: the next step opens that state");
  eq(need.words.states, "0/1 approved", "A4: continuity states are counted as states");
  const desk = deskOf(booted.run);
  eq(JSON.stringify(warm(desk)), JSON.stringify(["Open Folded →"]), "C4: the one warm action opens the next required state");
  ok(/<p class="rd-need rd-need-states"><span>Continuity states<\/span><b>0\/1 approved<\/b>/.test(desk), "B5: states have their own labelled line");
  /* The action writes the keys Production needs' own controls write, then goes there. */
  booted.run("globalThis.__rfcsHash = []; Object.defineProperty(location, 'hash', { configurable: true, get() { return globalThis.__rfcsHashValue || '#/prop/PROP-CHAIR'; }, set(v) { globalThis.__rfcsHashValue = v; globalThis.__rfcsHash.push(v); } });");
  deskClick(booted.run, "open-state");
  eq(booted.run("globalThis.__rfcsHash.join('|')"), "#/prop/PROP-CHAIR/tools", "F5: Open Folded goes to the reference tools");
  eq(booted.run(`boundedFocusedTask('entity-task', 'props:${CHAIR}', ['reference', 'coverage', 'details'], 'reference')`), "coverage", "F5: on Production needs");
  eq(booted.run(`boundedSelected('continuity-state', 'props:${CHAIR}', ['state-default', 'state-folded'], '')`), "state-folded", "F5: with that state's workspace selected");
  /* And approving the state completes the need, from the same reader. */
  /* A different state in view while the PRIMARY is what is needed: the strip carries the way back. */
  const other = await boot(fixture({ state: true, cast: true }), options);
  eq(needOf(other.run).action.kind, "generate-primary", "C5 baseline: the primary is not canon, so it is the next step");
  other.run(`CineBraidReferenceDesk.selectForResults({ list: 'props', id: '${CHAIR}', stateId: 'state-folded' })`);
  const folded = deskOf(other.run);
  ok(!/data-rd-action="generate-primary"/.test(folded), "C5: the Folded state's own canvas does not offer to generate the primary");
  eq(JSON.stringify(warm(folded)), JSON.stringify(["Show the primary reference"]), "C5: the one warm action takes the filmmaker back to the primary");
  deskClick(other.run, "show-primary");
  ok(/id="rd-generate-primary" class="rd-button rd-primary"/.test(deskOf(other.run)), "C5: which puts Generate primary reference in front of them");
  const done = await boot(fixture({ candidate: true, primaryCanon: true, state: true, stateCanon: true }), { ...options, files: [...SCAN_FILES.candidate, ...SCAN_FILES.folded] });
  const complete = needOf(done.run);
  eq(complete.action.kind, "complete", "A5: with the required state canon too, the need is complete");
  eq(complete.words.states, "1/1 approved", "A5: and the states line says so");
}

async function testNotUsedByAnyShot(options) {
  const booted = await boot(fixture({ cast: false }), options);
  const need = needOf(booted.run);
  eq(need.production.demanded, false, "A7 baseline: no shot uses the chair");
  eq(need.now.length, 0, "A7: nothing is needed now for a reference no shot uses");
  eq(need.words.now, "None", "A7: the Desk will not call its primary needed now");
  eq(need.words.detail, "No shot uses this prop yet", "A7: and says why");
  eq(need.action.kind, "generate-primary", "A7: the first canon is still the step that advances it");
  const desk = deskOf(booted.run);
  ok(/data-rd-needs-now="0"/.test(desk) && !/Needed now<\/span><b>1 /.test(desk), "A7: no Needed now count on the Desk");
}

/* Readiness cannot answer: the primary stays required, and so does the plan. */
async function testFailsClosed(options) {
  const booted = await boot(fixture(), options);
  booted.run("entityReadinessObligations = () => ({ known: false, rows: [] });");
  const need = needOf(booted.run);
  eq(need.known, false, "A8 baseline: readiness gives no answer");
  eq(need.primary.length, 1, "A8: an unapproved primary is still counted, fail-closed");
  eq(need.coverage.word, "required", "A8: and the plan keeps the word required, fail-closed");
  ok(/Readiness could not be checked here/.test(need.words.detail), "A8: the Desk says it could not check, rather than guessing");
  ok(/0 of 4 required views filled/.test(deskOf(booted.run)), "A8: the coverage section keeps saying required");
}

/* =========================================================================
   D + E — ONE PRESS TO THE EXISTING CONFIRMATION, NOTHING SENT BEFORE IT. */
async function testDirectConfirmationBoundary(options) {
  const booted = await boot(fixture(), { ...options, textReady: false });
  const { run, calls } = booted;
  eq(run("capabilityState('text').ready"), false, "E1 baseline: the assistant is unreachable");
  const desk = deskOf(run);
  ok(/data-rd-action="generate-primary"/.test(desk) && !/<button type="button" id="rd-generate-primary"[^>]*disabled/.test(desk), "E1: Generate primary reference is still offered, enabled");
  const before = run(`JSON.stringify(${chair()})`);
  deskClick(run, "generate-primary");
  /* Settle on the press having finished either way, then judge what it did, so a path that
     stops short fails on its own assertion rather than on a timeout. */
  const opened = await settle(run, "document.getElementById('modal').innerHTML.includes('START GENERATION')");
  ok(opened, "E2: with the assistant unreachable, one press still reaches the paid confirmation");
  const compile = calls.filter((c) => c.url === "/api/prompt/asset-compile");
  eq(compile.length, 1, "D1: one press compiles the prompt once");
  eq(compile[0].body.useLLM, false, "D1: with the rules-based compiler, never the assistant");
  eq(compile[0].body.id, CHAIR, "D1: for the chair");
  eq(calls.filter((c) => c.url === "/api/generation/fal/jobs" || c.url === "/api/generation/paid-permit").length, 0, "D2: nothing was submitted or permitted before the confirmation");
  const modal = run("document.getElementById('modal').innerHTML");
  ok(/START GENERATION/.test(modal) && /onclick="startFalEntityGeneration\(\)"/.test(modal), "D2: the existing paid dialog is open, with its own confirm");
  ok(/This submits a paid FAL image request\./.test(modal), "D2: which says the request is paid");
  const shown = (/<details class="fal-entity-prompt" data-fal-entity-prompt><summary>Prompt that will be sent[\s\S]*?<pre>([\s\S]*?)<\/pre>/.exec(modal) || [])[1] || "";
  const unescape = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  ok(unescape(shown).includes(COMPILED), "D3: the dialog shows the prompt that will be sent");
  ok(/rules-compiled/.test(modal), "D3: and says it was rules-compiled");
  const after = JSON.parse(run(`JSON.stringify(${chair()})`));
  eq(after.assetPromptBuilds.length, 1, "D1: the compiled prompt is recorded as a prompt build, as Prepare prompt records one");
  eq(JSON.stringify({ ...after, assetPromptBuilds: undefined }), JSON.stringify({ ...JSON.parse(before), assetPromptBuilds: undefined }), "D1: and nothing else on the chair changed");

  /* The confirm press is the one that sends, through the permit and the plan gate. */
  await run("startFalEntityGeneration()");
  const permit = calls.findIndex((c) => c.url === "/api/generation/paid-permit");
  const job = calls.findIndex((c) => c.url === "/api/generation/fal/jobs");
  ok(permit >= 0 && job > permit, "D4: START GENERATION asks for a paid permit, then submits");
  eq(calls.filter((c) => c.url === "/api/generation/fal/jobs").length, 1, "D4: exactly one paid request");
  const body = calls[job].body;
  eq(body.paidPermitId, "permit-rfcs-1", "D4: carrying the permit");
  eq(body.prompt, unescape(shown), "D4: and exactly the prompt the dialog showed");
  eq(body.purpose, "entity-reference", "D4: as an entity reference");
  eq(body.sourceBuildId, after.assetPromptBuilds[0].id, "D4: from the build this press compiled");
  ok(body.generationRequest && body.generationRequest.surface, "D4: declaring the request surface the server re-gates");
}

/* The action composes the two shipped steps and submits nothing itself. */
function testSourceBoundary() {
  const studio = fs.readFileSync(path.join(ROOT, "public", "creation-studio.js"), "utf8").replace(/\r\n/g, "\n");
  const body = studio.slice(studio.indexOf("window.generatePrimaryReference ="), studio.indexOf("};", studio.indexOf("window.generatePrimaryReference =")));
  ok(body.includes("window.buildAssetCreationPrompt(list, id, false)"), "D5: it compiles with the rules-based compiler (useLLM false)");
  ok(body.includes("openFalEntityGenerationModal(list, id, build.id"), "D5: and opens the existing paid preflight with that build");
  ok(!/startFalEntityGeneration|\/api\/generation|fetch\(/.test(body), "D5: it never submits, permits or fetches a generation route itself");
  const fal = fs.readFileSync(path.join(ROOT, "public", "fal-generation.js"), "utf8").replace(/\r\n/g, "\n");
  const start = fal.slice(fal.indexOf("window.startFalEntityGeneration ="), fal.indexOf("window.startCandidateCorrectionGeneration ="));
  ok(/restrictPayloadToPlan\(body, falFixedImageControlPlan\(generationViewPreference\(\), request\)\)/.test(start), "D5: the submission still restricts its payload through the plan");
  ok(/paidDispatchPermitFor\(gatedBody\)/.test(start), "D5: and still asks the server for a paid permit");
  const modal = fal.slice(fal.indexOf("window.openFalEntityGenerationModal ="), fal.indexOf("window.generateMoreEntityStateCandidates ="));
  ok(/const sentPrompt = entityGenerationPrompt\(list, entity, build, refs, \{ state, mode: effectiveMode \}\);/.test(modal)
    && /prompt: entityGenerationPrompt\(request\.list, entity, build, references, \{ state, mode: effectiveMode \}\)/.test(start),
  "D3: the dialog and the submission compose the prompt with the same function");
}

/* =========================================================================
   F — EVERYTHING THAT WAS REACHABLE STAYS REACHABLE. */
async function testCapabilitiesStayReachable(options) {
  const booted = await boot(fixture(), options);
  const desk = deskOf(booted.run);
  ok(/data-rd-action="upload"[^>]*>Upload existing</.test(desk), "F1: Upload existing is the secondary action");
  const more = (/<details class="rd-more" id="rd-more"><summary>More options<\/summary>([\s\S]*?)<\/details>/.exec(desk) || [])[1] || "";
  ok(/data-rd-action="choose"[^>]*>Choose from Production media</.test(more), "F1: Production media is under More options");
  ok(/data-rd-action="prompt"[^>]*>Edit the prompt, or use Braidy</.test(more), "F1: and so are the prompt and Braidy");
  ok(/data-rd-action="build"/.test(desk) && /data-rd-slot="hero"/.test(desk), "F1: Build coverage and each view remain on the Desk");
  const workspace = await toolsOf(booted, "reference");
  const card = (/<details class="reference-create-more"[\s\S]*?<\/details>\s*<\/section>/.exec(workspace) || [""])[0];
  ok(/<summary>More options <span>Edit the prompt, Braidy, manual controls<\/span><\/summary>/.test(card), "F2: the builder's paths are one named More options disclosure");
  ok(!/<details class="reference-create-more"[^>]* open[ >]/.test(workspace), "F2: closed by default, with no live work");
  for (const [label, pattern] of [["Start Braidy run", /Start Braidy run/], ["Show manual controls", /Show manual controls/], ["Prepare prompt", /buildAssetCreationPrompt\('props','PROP-CHAIR',false\)/], ["the visual description", /class="creation-description"/], ["the text-to-image target", /setAssetPromptProfile\('props','PROP-CHAIR'/]]) {
    ok(pattern.test(card), `F2: ${label} is still inside it`);
  }
  ok(/Upload existing/.test(workspace) && /Map imported references/.test(workspace) && /Crop reference sheet/.test(workspace), "F2: upload, mapping and sheet cropping stay on the workspace");
  ok(/OPTIONAL ASSISTED TOOLS/.test(workspace), "F2: the assisted tools fold is still there");
  /* openEntityCreationSection opens the disclosure and the manual panel through their own writers. */
  booted.run(`(() => { const nodes = {}; const panel = { hidden: true, hasAttribute: (n) => n === 'hidden' && panel.hidden, removeAttribute() { panel.hidden = false; }, setAttribute() { panel.hidden = true; }, getAttribute: () => 'asset-prompt:props:${CHAIR}:manual', contains: () => false };
    const more = { open: false }; const toggle = { setAttribute() {}, textContent: '' };
    const section = { hidden: false, getAttribute: () => 'props:${CHAIR}', querySelector: (s) => s === 'details.reference-create-more' ? more : s === '.reference-create-manual' ? panel : s === '.reference-manual-toggle' ? toggle : null, scrollIntoView() {}, classList: { add() {}, remove() {} } };
    globalThis.__rfcsSection = { section, more, panel };
    const original = document.querySelector.bind(document), all = document.querySelectorAll.bind(document);
    document.querySelector = (s) => s === '.reference-create-section' ? section : original(s);
    document.querySelectorAll = (s) => s === 'section.reference-create-section' ? [section] : all(s);
    openEntityCreationSection('props', '${CHAIR}');
    document.querySelector = original; document.querySelectorAll = all; })()`);
  eq(booted.run("__rfcsSection.more.open"), true, "F2: opening the builder opens More options");
  eq(booted.run("__rfcsSection.panel.hidden"), false, "F2: and reveals the manual panel");
  eq(booted.run(`workspaceSectionOpen('asset-prompt:props:${CHAIR}:more', false)`), true, "F2: remembering both");
  const details = await toolsOf(booted, "details");
  ok(/Details/.test(details), "F4: Details & history is still a task");
  booted.run(`boundedWriteState('selected:entity-detail-view', 'props:${CHAIR}', 'history')`);
  const history = await toolsOf(booted, "details");
  ok(/Generation records — provenance/.test(history), "F4: generation records and their provenance stay reachable");
  const needs = await toolsOf(booted, "coverage");
  ok(/class="continuity-states"/.test(needs) && /\+ Add continuity state/.test(needs), "F5: the continuity-state workspace stays on Production needs");
}

/* With no description the compiler has no input: the press takes the filmmaker to the field
   that holds it (the builder, under More options) and compiles nothing. */
async function testNoDescriptionGoesToTheBuilder(options) {
  const project = fixture();
  project.props.find((x) => x.id === CHAIR).visualDescription = "";
  const booted = await boot(project, options);
  deskOf(booted.run);
  deskClick(booted.run, "generate-primary");
  await settle(booted.run, "location.hash.endsWith('/tools')", 100);
  eq(booted.calls.filter((c) => c.url === "/api/prompt/asset-compile").length, 0, "F7: with no description, nothing is compiled");
  eq(booted.run("location.hash"), `#/prop/${CHAIR}/tools`, "F7: the press goes to the reference's builder");
  eq(booted.run(`boundedFocusedTask('entity-task', 'props:${CHAIR}', ['reference', 'coverage', 'details'], 'coverage')`), "reference", "F7: on the primary reference");
  eq(booted.run(`workspaceSectionOpen('asset-prompt:props:${CHAIR}:more', false) && workspaceSectionOpen('asset-prompt:props:${CHAIR}:manual', false)`), true, "F7: with More options and the manual controls open");
}

/* The paid dialog for a continuity state is the same preflight, now also showing its prompt. */
async function testStateDialogUnchangedBoundary(options) {
  const booted = await boot(fixture({ candidate: true, primaryCanon: true, state: true }), { ...options, files: SCAN_FILES.candidate });
  booted.run(`(() => { const e = ${chair()}; const s = e.continuityStates.find((x) => x.id === 'state-folded'); s.assetPromptBuilds = [{ id: 'state-build-1', prompt: 'Fold the chair flat.', profileId: 'gpt-image-2/t2i' }]; openFalEntityGenerationModal('props', '${CHAIR}', 'state-build-1', 'state-folded'); })()`);
  const modal = booted.run("document.getElementById('modal').innerHTML");
  ok(/Generate Folded prop reference candidates/.test(modal) && /START GENERATION/.test(modal), "F6: the continuity-state preflight still opens as it did");
  ok(/data-fal-entity-prompt/.test(modal), "F6: and shows the prompt it will send");
  eq(booted.calls.filter((c) => /\/api\/generation\//.test(c.url)).length, 0, "F6: opening it sends nothing");
}

async function run(options = {}) {
  checks = 0;
  await testNoCanonNoCandidate(options);
  await testCandidateNotApproved(options);
  await testPrimaryCanonCoverageIncomplete(options);
  await testRequiredStateMissing(options);
  await testNotUsedByAnyShot(options);
  await testFailsClosed(options);
  await testDirectConfirmationBoundary(options);
  testSourceBoundary();
  await testCapabilitiesStayReachable(options);
  await testNoDescriptionGoesToTheBuilder(options);
  await testStateDialogUnchangedBoundary(options);
  return checks;
}

module.exports = { run, fixture, boot, needOf, deskOf, COMPILED, CHAIR };

if (require.main === module) {
  run().then((count) => {
    console.log(`Reference-first canon suite passed ${count} checks: one immediate need from readiness in six truth states and fail-closed, the same words on the Desk, the References card, Production needs, the hub and the primary workspace, coverage and continuity states named as themselves, a shot-wide total never shown as the chair's own, one warm action that follows the need and none at all once nothing is needed now (optional coverage stays reachable as a secondary control, its views named in words, never "3/4"), Generate primary reference compiling the rules-based prompt and opening the existing paid confirmation with the prompt shown and nothing sent before START GENERATION, an unreachable assistant not disabling it, and every specialist path still reachable. Provider calls made: 0.`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
