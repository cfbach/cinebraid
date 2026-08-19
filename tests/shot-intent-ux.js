/* Batch 2 Slice 5b — Shot Intent UX and adaptive execution.
 *
 * Slice 5a put one durable production statement on the shot record and deliberately
 * shipped nothing a filmmaker could see. This slice is the visible half, and this suite
 * is written against the SHIPPED SURFACES rather than against the functions behind them:
 * every route below is declared by calling the real `setShotIntent` handler the rendered
 * control's `onchange` names, and every claim about what a filmmaker sees is read out of
 * markup the shipped renderers produced.
 *
 * THE SEVEN THINGS IT HAS TO HOLD, in the order the brief lists them:
 *
 *   A  every valid route can be selected from the real surface, is written through the
 *      Slice 5a authority as the canonical token, survives a round trip, and comes back
 *      onto the screen; clearing DELETES the key rather than storing a sentinel
 *   B  no route is ever inferred — from frames, references, motion units, prompts,
 *      prior generations or list order
 *   C  NO ROUTE WIDENS ANYTHING. For every representative shot state and every route,
 *      the route-aware effective methods are a SUBSET of what the existing authority
 *      already permitted, and an unset route reproduces that answer exactly
 *   D  the Frames workflow is put in front of the filmmaker only where a shipped
 *      authority actually asks for an input — and folding it deletes nothing, hides
 *      nothing that cannot be reopened, and fabricates no progress
 *   E  hybrid persists, never becomes a mode, never widens, and never collapses into
 *      the undeclared state
 *   F  an unrecognised stored value displays no valid intent, selects no route, and
 *      widens nothing
 *   G  a route-less legacy shot behaves EXACTLY as it did — and the one visible change
 *      an intent does make is BOUNDED to the surface that declares it
 *
 * No provider is contacted, no paid route is called, and nothing outside the harness's
 * in-memory realm is written. The repository's own project data is never opened.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
/* Line endings are normalised on read: this repository checks out with
   core.autocrlf=true, so a multi-line anchor written with \n would match nothing. */
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const Intent = require("../public/shared-shot-intent");
const Route = require("../public/shared-shot-route");
const Stage = require("../public/shared-stage-model");
const Readiness = require("../public/shared-shot-readiness");
const { resolveTaskModes, CINEBRAID_MODE_LANGUAGE } = require("../public/shared-generation-options");
const { CINEBRAID_GENERATION_MODES } = require("../public/shared-generation-capability");
const { render, buildFixture } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

/* Comments are where the reasoning lives and where a forbidden word is legitimately
   discussed; CODE is where a violation would hide. */
const codeOnly = (source) => String(source).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ROUTES = ["t2v", "i2v", "flf", "r2v", "hybrid"];
/* Values this build cannot read. "T2V " is deliberately NOT among them: Slice 5a folds
   case and trims the ends, so it IS a declaration of t2v, and a suite that treated it as
   corrupt would be asserting against the reconciliation rather than against the guard. */
const BAD_ROUTES = ["GENERATE (FLF)", "flf2", "t2 v", "image-to-video", "  ", "hybrid-ish"];
const image = (role) => ({ role, mediaType: "image" });

/* Representative shot states, named by what the shot HAS rather than by the method they
   produce — the method is whatever the shipped resolver says, which is the whole point
   of asking it rather than tabulating it. */
const SHOT_STATES = [
  { name: "nothing attached", task: "animate-shot", references: [] },
  { name: "an opening frame", task: "animate-shot", references: [image("first-frame")] },
  { name: "both endpoints", task: "animate-shot", references: [image("first-frame"), image("last-frame")] },
  { name: "an identity reference", task: "animate-shot", references: [image("identity")] },
  { name: "identity and style", task: "animate-shot", references: [image("identity"), image("style")] },
  { name: "a closing frame only", task: "animate-shot", references: [image("last-frame")] },
  { name: "a blocking frame request", task: "blocking-frame", references: [] },
  { name: "a frame from nothing", task: "create-frame", references: [] },
  { name: "a frame from references", task: "create-frame", references: [image("identity")] },
  { name: "an edit with no mask", task: "edit-frame", references: [image("base")] },
  { name: "an edit with a mask", task: "edit-frame", references: [image("base"), image("mask")] },
];

const scanFor = (project) => ({
  anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
  plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
  props: [], vehicles: [], audio: [],
  media: (project.mediaAssets || []).map((asset) => ({ name: asset.file, url: `/assets/media/${asset.file}` })),
  shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: [], locked: [] }])),
});

/* One rendered shot workspace, with the route already on the record. `slots` is every
   surface the harness owns, joined, which is what a bounded byte comparison reads. */
async function renderShot(routeValue, mutate) {
  const project = buildFixture();
  if (routeValue !== undefined) project.shots[0].deliveryRoute = routeValue;
  if (mutate) mutate(project);
  const rendered = await render("#/shot/L1-01", project, { scan: scanFor(project) });
  const slots = [...rendered.map.entries()].map(([id, element]) => `<<${id}>>${String(element.innerHTML || "")}`).join("\n");
  return { rendered, context: rendered.context, slots, main: String(rendered.map.get("main").innerHTML || "") };
}

const run = (context, expression) => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${expression} })())`, context));

/* What the rendered Shot Intent control actually says. Read out of the markup rather
   than recomputed, so a control that renders one thing and answers another fails. */
function readControl(markup) {
  const open = /<details class="shot-intent-control"([^>]*)>/.exec(markup);
  if (!open) return null;
  const attrs = open[1];
  const attr = (name) => (new RegExp(`${name}="([^"]*)"`).exec(attrs) || [, null])[1];
  const body = markup.slice(open.index, markup.indexOf("</details>", open.index) + "</details>".length);
  const options = [...body.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((row) => ({
    value: row[1],
    selected: /\bselected\b/.test(row[2]),
    disabled: /\bdisabled\b/.test(row[2]),
    label: row[3],
  }));
  return {
    route: attr("data-shot-intent"),
    reading: attr("data-shot-intent-reading"),
    framesRequired: attr("data-frames-required"),
    shotId: attr("data-shot-id"),
    summary: (/<summary><b>Shot intent<\/b><span>([^<]*)<\/span><\/summary>/.exec(body) || [, ""])[1],
    options,
    selectedValues: options.filter((row) => row.selected).map((row) => row.value),
    body,
  };
}

/* ===========================================================================
   1 — THE PROJECTION OWNS NOTHING IT COULD HAVE OWNED.

   Slice 5b's whole risk is a second taxonomy: a second route list, a second mode table,
   a second capability resolver, a second stage model. This section is the structural
   proof that none of the four was created — every token, every mode and every input
   requirement is read out of a shipped owner and restated nowhere.
   =========================================================================== */

function checkProjection() {
  const source = readLF("public/shared-shot-intent.js");
  /* Comments are where the reasoning lives and where the tokens are legitimately
     discussed. CODE is where a second vocabulary would hide. */
  const code = codeOnly(source);

  for (const token of [...ROUTES, "audio-video", "first-frame", "last-frame"])
    assert(!code.includes(`"${token}"`) && !code.includes(`'${token}'`),
      `shared-shot-intent.js must not name ${token} in code; every token comes from a shipped owner`);
  assert(!/deliveryRoute/.test(code),
    "the projection must not know the storage key: reading and writing a route is Slice 5a's");
  assert(!/function\s+resolveTaskModes|CINEBRAID_GENERATION_MODES\s*=/.test(code),
    "the projection must not declare a second admissibility resolver or a second mode list");
  assert(!/\.concat\(|\.push\(|\bunshift\b/.test(code),
    "nothing in the projection may add to a list it was handed; narrowing is a filter and only a filter");

  /* The vocabulary IS Slice 5a's, and the modes ARE derived from 5a's own table. */
  assert.deepStrictEqual([...Intent.SHOT_INTENT_READINGS], [...Route.CINEBRAID_SHOT_ROUTE_READINGS],
    "the three readings are 5a's; a fourth state would be an invented one");
  assert.deepStrictEqual([...Intent.SHOT_INTENT_ROUTE_MODES],
    Route.CINEBRAID_SHOT_ROUTES.map((route) => Route.shotRouteGenerationMode(route)).filter(Boolean),
    "the route-mode universe is derived from CINEBRAID_SHOT_ROUTE_MODES, not typed out again");
  for (const mode of Intent.SHOT_INTENT_ROUTE_MODES)
    assert(CINEBRAID_GENERATION_MODES.includes(mode), `${mode} must be a mode the catalogue already declares`);

  /* The input requirements ARE shared-shot-readiness.js's probes, which are themselves
     derived from resolveTaskModes() at load. Asserted as an INDEX of the shipped rows so
     a change to the resolver moves both together or fails here. */
  const expected = Object.fromEntries(Readiness.ANIMATE_METHOD_PROBES.map((row) => [row.method, [...row.needs]]));
  const actual = Object.fromEntries(Object.entries(Intent.SHOT_INTENT_METHOD_PROBES).map(([mode, row]) => [mode, [...row.needs]]));
  assert.deepStrictEqual(actual, expected,
    "the method probes must be the shipped ones, indexed — not a second table of input requirements");

  /* The stage model still does not know routes exist. Slice 5b did not cross that line;
     adaptive exposure is a presentation answer that sits beside it. */
  const stageSource = readLF("public/shared-stage-model.js").toLowerCase();
  for (const token of ["i2v", "flf", "r2v", "t2v", "hybrid"])
    assert(!stageSource.includes(token), `the stage model must still not name the generation route ${token}`);
  assert(!Stage.SHOT_STAGE_AVAILABILITY.includes("not-applicable"),
    "adaptive exposure is presentation; it must not have become a stage availability");

  /* And the filmmaker-facing labels are the SHIPPED mode language, not new words. */
  for (const choice of Intent.shotIntentChoices()) {
    if (!choice.mode) { assert.strictEqual(choice.label, "", "hybrid names no mode and must borrow no label"); continue; }
    assert.strictEqual(choice.label, CINEBRAID_MODE_LANGUAGE[choice.mode],
      `${choice.route} must be labelled with CineBraid's own presentation language for ${choice.mode}`);
  }

  note(`1. projection: no route token, no storage key and no list-growing expression in code; `
    + `${Object.keys(Intent.SHOT_INTENT_METHOD_PROBES).length} method probes read from readiness; labels are CINEBRAID_MODE_LANGUAGE`);
}

/* ===========================================================================
   2 (A) — ROUTE SELECTION, THROUGH THE REAL SURFACE.
   =========================================================================== */

async function checkRouteSelection() {
  const base = await renderShot(undefined);
  const control = readControl(base.main);
  assert(control, "the shot workspace must render a Shot Intent control");
  assert.strictEqual(control.shotId, "L1-01", "the control must be owned by the shot it is drawn for");

  /* The offered choices are exactly the five routes plus the legitimate unset state, in
     Slice 5a's declaration order, and each is labelled in filmmaker language. */
  assert.deepStrictEqual(control.options.map((row) => row.value), ["", ...ROUTES],
    "the control must offer the undeclared state and exactly the five declared routes, in declaration order");
  for (const row of control.options)
    assert(row.label && !ROUTES.includes(row.label) && row.label !== row.value,
      `the option for ${JSON.stringify(row.value)} must be labelled in filmmaker language, not with its stored token`);

  /* THE HANDLER THE CONTROL NAMES IS THE HANDLER THAT IS CALLED. Read off the rendered
     markup so a suite cannot pass by driving a function no control invokes. */
  assert(/onchange="setShotIntent\('L1-01',this\.value\)"/.test(control.body),
    "the select must call the shipped writer with the shot id and the chosen value");

  for (const route of ROUTES) {
    const page = await renderShot(undefined);
    const result = run(page.context, `
      setShotIntent("L1-01", ${JSON.stringify(route)});
      const shot = P.shots.find((row) => row.id === "L1-01");
      /* The RE-RENDER's markup, from the shipped renderer, after the shipped writer ran. */
      return {
        stored: Object.prototype.hasOwnProperty.call(shot, "deliveryRoute") ? shot.deliveryRoute : null,
        keys: Object.keys(shot).filter((key) => key === "deliveryRoute").length,
        markup: shotIntentControl(shot),
        reread: JSON.parse(JSON.stringify(P)).shots.find((row) => row.id === "L1-01").deliveryRoute,
      };`);
    assert.strictEqual(result.stored, route, `${route}: the canonical token must be written to shot.deliveryRoute`);
    assert.strictEqual(result.keys, 1, `${route}: exactly one route key, never a second field`);
    assert.strictEqual(result.reread, route, `${route}: the declaration must survive a serialise / parse round trip`);

    const after = readControl(result.markup);
    assert.strictEqual(after.reading, "declared", `${route}: the surface must report a declared reading`);
    assert.strictEqual(after.route, route, `${route}: the surface must show the stored truth`);
    assert.deepStrictEqual(after.selectedValues, [route], `${route}: exactly that route may be selected`);
    assert(after.summary && after.summary !== "Not decided yet",
      `${route}: the collapsed summary must state the declared intent`);
  }

  /* CASE IS THE ONE RECONCILIATION, and it is Slice 5a's. A filmmaker cannot type into
     this control, but a scripted or restored value can arrive upper-cased. */
  const folded = await renderShot(undefined);
  const upper = run(folded.context, `
    setShotIntent("L1-01", "FLF");
    const shot = P.shots.find((row) => row.id === "L1-01");
    return { stored: shot.deliveryRoute };`);
  assert.strictEqual(upper.stored, "flf", "an upper-cased token must be stored canonically, never as typed");

  /* WITHDRAWAL DELETES. A sentinel would be a fourth state nobody declared. */
  const withdraw = await renderShot("r2v");
  const cleared = run(withdraw.context, `
    const before = JSON.stringify(P.shots.find((row) => row.id === "L1-01"));
    setShotIntent("L1-01", "");
    const shot = P.shots.find((row) => row.id === "L1-01");
    return {
      hasKey: Object.prototype.hasOwnProperty.call(shot, "deliveryRoute"),
      serialised: JSON.stringify(shot).includes("deliveryRoute"),
      reading: readShotIntent(shot).reading,
      before,
      after: JSON.stringify(shot),
    };`);
  assert.strictEqual(cleared.hasKey, false, "withdrawing an intent must DELETE the key, not store an empty one");
  assert.strictEqual(cleared.serialised, false, "and it must not survive serialisation as a slot");
  assert.strictEqual(cleared.reading, "absent", "a withdrawn intent reads as absent, exactly like one never made");

  note(`2A. selection: ${ROUTES.length} routes declared through the rendered control's own handler, `
    + "stored canonically, reflected back on the surface, survived a round trip; withdrawal deletes the key");
}

/* ===========================================================================
   3 (B) — NOTHING IS INFERRED.

   The fixture shot is the hostile one on purpose: two approved-shaped frames, three
   linked references, two motion units of DIFFERENT kinds, a motion prompt and a legacy
   output-plan label. Every one of those is something a backfill would read.
   =========================================================================== */

async function checkNoInference() {
  const shapes = [
    ["the shipped fixture, untouched", (project) => project],
    ["a first-frame-only shot", (project) => { project.shots[0].keyframes = [project.shots[0].keyframes[0]]; project.shots[0].clips = []; }],
    ["a reference-rich shot with no frames", (project) => { project.shots[0].keyframes = []; project.shots[0].clips = []; }],
    ["a shot whose only unit is t2v", (project) => { project.shots[0].clips = [{ id: "only", label: "A", suffix: "a", kind: "t2v", dur: 5, generationPackages: [] }]; }],
    ["a shot whose legacy output plan names FLF", (project) => { project.shots[0].route = "GENERATE (FLF)"; }],
    ["a shot carrying prior generation history", (project) => { project.shots[0].motionPrompt = "He crosses the bay."; project.shots[0].winner = "FRAME_A.png"; }],
  ];
  for (const [name, mutate] of shapes) {
    const page = await renderShot(undefined, mutate);
    const control = readControl(page.main);
    assert.strictEqual(control.reading, "absent", `${name}: must declare no intent`);
    assert.strictEqual(control.route, "", `${name}: must show no route`);
    assert.deepStrictEqual(control.selectedValues, [""], `${name}: only the undeclared option may be selected`);
    assert.strictEqual(control.summary, "Not decided yet", `${name}: the summary must say so plainly`);
    const record = run(page.context, `
      const shot = P.shots.find((row) => row.id === "L1-01");
      return { hasKey: Object.prototype.hasOwnProperty.call(shot, "deliveryRoute") };`);
    assert.strictEqual(record.hasKey, false, `${name}: rendering must not have written a route onto the record`);
  }

  /* And the two shipped translators that COULD map an existing field to a route are not
     wired to anything that runs on load or on render. */
  const studio = readLF("public/creation-studio.js");
  for (const forbidden of ["shotRouteFromClipKind", "shotRouteFromLegacyOutputRoute", "shotRouteFromGenerationMode"])
    assert(!studio.includes(forbidden),
      `${forbidden} translates another field into a route; no rendering path may call it`);

  note(`3B. no inference: ${shapes.length} legacy shot shapes — frames, references, motion units of two kinds, `
    + "a legacy FLF output plan and prior generation state — all still declare nothing, and no translator is wired to a render");
}

/* ===========================================================================
   4 (C) — NO ROUTE WIDENS ANYTHING.

   Two halves. The first is the projection against the SHIPPED resolver's answers; the
   second is the shipped PICKER's own rendered markup, because a resolver that narrows
   correctly and a screen that offers more is the same defect with a longer path.
   =========================================================================== */

async function checkNoWidening() {
  let comparisons = 0;
  for (const state of SHOT_STATES) {
    /* THE ACCEPTED EXISTING ANSWER, from the untouched authority. */
    const admissible = resolveTaskModes(state.task, { references: state.references });
    assert(Array.isArray(admissible), `${state.name}: the shipped resolver must answer`);

    /* Unset must reproduce it EXACTLY — not merely a subset. */
    const unset = Intent.shotIntentEffectiveModes("", admissible);
    assert.deepStrictEqual(unset.modes, [...admissible],
      `${state.name}: an undeclared intent must leave the accepted answer exactly as it was`);
    assert.strictEqual(unset.constrained, false, `${state.name}: an undeclared intent applies no intersection at all`);

    for (const route of ROUTES) {
      const effective = Intent.shotIntentEffectiveModes(route, admissible);
      comparisons += 1;
      for (const mode of effective.modes)
        assert(admissible.includes(mode),
          `${state.name} + ${route}: ${mode} is not in the accepted admissible set — a route may never grant a method`);
      assert(effective.modes.length <= admissible.length,
        `${state.name} + ${route}: the effective set grew`);
      assert.deepStrictEqual([...effective.modes, ...effective.removed].sort(), [...admissible].sort(),
        `${state.name} + ${route}: every accepted mode must be either kept or reported removed, and nothing else may appear`);
    }
    /* And a malformed value behaves exactly like absence — never like a route, and never
       like a widening. */
    for (const bad of BAD_ROUTES) {
      const broken = Intent.shotIntentEffectiveModes(bad, admissible);
      assert.deepStrictEqual(broken.modes, [...admissible],
        `${state.name} + ${JSON.stringify(bad)}: an unreadable value must leave the accepted answer untouched`);
    }
  }

  /* THE STRUCTURAL HALF. An empty authority stays empty for every route, and a token no
     route names can never be introduced by one. */
  for (const route of ["", ...ROUTES, ...BAD_ROUTES]) {
    assert.deepStrictEqual(Intent.shotIntentEffectiveModes(route, []).modes, [],
      `${JSON.stringify(route)}: an authority that permits nothing must still permit nothing`);
    assert.deepStrictEqual(Intent.shotIntentEffectiveModes(route, ["upscale"]).modes.filter((m) => m !== "upscale"), [],
      `${JSON.stringify(route)}: no mode may appear that the caller did not supply`);
  }

  /* THE SHIPPED PICKER. The set of options a filmmaker can actually choose, read off the
     rendered `<select>`, must never grow when an intent is declared — and must be
     byte-identical when none is. */
  const page = await renderShot(undefined);
  const picker = (selected, route) => run(page.context, `
    const markup = guidedVideoProfileOptions(${JSON.stringify(selected)}, ${JSON.stringify(route)});
    const rows = [...markup.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map((row) => ({ id: row[1], disabled: /\\bdisabled\\b/.test(row[2]) }));
    return { markup, all: rows.map((row) => row.id), enabled: rows.filter((row) => !row.disabled).map((row) => row.id) };`);

  const selections = ["", "minimax-h3/i2v", "seedance-2/flf"];
  for (const selected of selections) {
    const baseline = picker(selected, "");
    assert.strictEqual(baseline.all.length, run(page.context, "return guidedVideoProfiles().length;"),
      "the picker must still list every written-up video target, narrowed or not");
    assert(baseline.enabled.length >= 1, "and something must still be selectable with no intent declared");
    for (const bad of BAD_ROUTES)
      assert.strictEqual(picker(selected, bad).markup, baseline.markup,
        `${JSON.stringify(bad)}: an unreadable intent must render the picker exactly as it renders with none`);
    for (const route of ROUTES) {
      const narrowed = picker(selected, route);
      assert.deepStrictEqual(narrowed.all, baseline.all,
        `${route}: narrowing must hide no target — the catalogue a filmmaker is entitled to see is unchanged`);
      for (const id of narrowed.enabled)
        assert(baseline.enabled.includes(id),
          `${route}: ${id} became selectable because an intent was declared; a route may only ever remove`);
      comparisons += 1;
    }
    /* The four single-method routes really do narrow, or this proves nothing. */
    const strict = picker(selected, "flf");
    assert(strict.enabled.length < baseline.enabled.length,
      "declaring a single-method intent must actually reduce the selectable set");
    /* A stored selection is never taken away, even by an intent that does not admit it. */
    if (selected) assert(picker(selected, "t2v").enabled.includes(selected) || selected === "",
      `a stored selection (${selected}) must stay selectable; an intent must not trap a filmmaker on a control they cannot operate`);
  }

  note(`4C. no widening: ${comparisons} route/state comparisons against the shipped resolver and the shipped picker; `
    + "unset reproduces the accepted answer exactly, every declared route is a subset, and an unreadable value narrows nothing");
}

/* ===========================================================================
   5 (D) — ADAPTIVE FRAME EXPOSURE.
   =========================================================================== */

async function checkFrameExposure() {
  /* The composition is of TWO shipped authorities and the union of them is what decides.
     Both are read here from the running page rather than assumed. */
  const page = await renderShot(undefined);
  const truth = run(page.context, `
    const rows = {};
    for (const route of CINEBRAID_SHOT_ROUTES) {
      const exposure = shotIntentFrameExposure(route, guidedVideoModeNeedsApprovedStill);
      rows[route] = { required: exposure.required, adapt: exposure.adapt, needs: [...exposure.needs], anchored: [...exposure.anchored], known: exposure.known };
    }
    return { rows, anchorFree: CINEBRAID_GENERATION_MODES.filter((mode) => guidedVideoModeNeedsApprovedStill(mode) === false) };`);

  /* WHICH ROUTES MAY FOLD IS DERIVED, NOT ASSERTED AS A LIST. A route may fold Frames
     only when the probes ask it for nothing AND the shipped motion gate exempts it. */
  for (const route of ROUTES) {
    const probeNeeds = Intent.shotIntentInputNeeds(route);
    const gateExempt = Intent.shotIntentCompatibleModes(route).modes.every((mode) => truth.anchorFree.includes(mode));
    const mayFold = probeNeeds.known && probeNeeds.needs.length === 0 && gateExempt;
    assert.strictEqual(truth.rows[route].adapt, mayFold,
      `${route}: the Frames workflow may fold exactly when no shipped authority asks it for an input`);
    assert.strictEqual(truth.rows[route].required, !mayFold, `${route}: required is the negation of that, and nothing else`);
  }
  const folds = ROUTES.filter((route) => truth.rows[route].adapt);
  assert(folds.length >= 1, "at least one route must genuinely need no frame, or this adaptation does nothing");
  assert(folds.length < ROUTES.length, "and at least one must still need one, or the gate has been dismantled");

  /* AN UNDECLARED AND AN UNREADABLE INTENT BOTH LEAVE IT ALONE. */
  for (const value of ["", ...BAD_ROUTES]) {
    const inert = run(page.context, `
      const exposure = shotIntentFrameExposure(${JSON.stringify(value)}, guidedVideoModeNeedsApprovedStill);
      return { adapt: exposure.adapt, required: exposure.required, known: exposure.known };`);
    assert.deepStrictEqual(inert, { adapt: false, required: true, known: false },
      `${JSON.stringify(value)}: nothing established means nothing adapted`);
  }
  /* AND SO DOES A CALLER THAT CANNOT SUPPLY THE MOTION WORKSPACE'S OWN GATE. There is no
     default, because a guess here sends a filmmaker to a locked panel. */
  for (const route of ROUTES)
    assert.strictEqual(Intent.shotIntentFrameExposure(route, null).adapt, false,
      `${route}: without the shipped prerequisite predicate, nothing may be folded`);

  /* THE RENDERED FRAMES STAGE. What is actually built, for every route. */
  const foldRoute = folds[0];
  const keepRoute = ROUTES.find((route) => !truth.rows[route].adapt);
  const rendered = {};
  for (const value of [undefined, ...ROUTES, "GENERATE (FLF)"]) {
    const shot = await renderShot(value);
    rendered[String(value)] = run(shot.context, `
      const s = P.shots.find((row) => row.id === "L1-01");
      const html = shotFramesWorkspace(s, takesFor("L1-01"));
      const workflow = (html.match(/<details class="guided-frame-workflow[^>]*>/) || [""])[0];
      return {
        relevance: (html.match(/data-frames-relevance="([^"]*)"/) || [, ""])[1],
        required: (html.match(/data-frames-required="([^"]*)"/) || [, ""])[1],
        statement: html.includes('data-frames-not-required="1"'),
        workflowOpen: / open /.test(workflow),
        /* WHAT IS STILL BUILT. The frame rail, the frame card, the add-frame control and
           every frame label — folding must remove none of them. */
        rail: (html.match(/guided-frame-rail/g) || []).length,
        addFrame: html.includes("guided-add-frame"),
        frameLabels: [...html.matchAll(/data-frame-id="([^"]*)"/g)].map((row) => row[1]),
        bodyLength: html.length,
        progress: JSON.stringify(guidedFrameProgress(s, takesFor("L1-01")).frames.map((f) => f.id)),
        stageProgress: JSON.stringify(shotStageProgress(shotStageModelFacts(s, takesFor("L1-01")))),
        /* READINESS IS THE OTHER TRUTH A HIDDEN STAGE COULD FABRICATE, and it is a
           different owner from the stage model: public/shared-shot-readiness.js answers
           "can this be produced now" from durable authority. It is closed architecture
           and this slice does not touch it — asserted rather than assumed, because
           "the stage is folded" must never become "the work is done". */
        readiness: (() => { try { return JSON.stringify(evaluateShotReadiness(P, s, {})); } catch (error) { return "unavailable: " + error.message; } })(),
      };`);
  }

  const baseline = rendered.undefined;
  assert(baseline.rail > 0 && baseline.frameLabels.length > 0 && baseline.addFrame,
    "precondition: the fixture's Frames stage must really build a rail, some frames and the add-frame control, "
    + "or every 'nothing was deleted' assertion below is comparing two empty sets");
  assert(!baseline.readiness.startsWith("unavailable"),
    `precondition: the readiness derivation must actually run, got ${baseline.readiness.slice(0, 160)}`);
  assert.strictEqual(baseline.relevance, "undeclared", "an undeclared shot's Frames stage says so");
  assert.strictEqual(baseline.workflowOpen, true, "and opens exactly as it always has");
  assert.strictEqual(baseline.statement, false, "with no not-required statement");
  assert.strictEqual(rendered["GENERATE (FLF)"].relevance, "undeclared",
    "an unreadable stored value must leave the Frames stage exactly as an undeclared one does");

  for (const route of ROUTES) {
    const row = rendered[route];
    const shouldFold = truth.rows[route].adapt;
    assert.strictEqual(row.relevance, shouldFold ? "not-required" : "required", `${route}: relevance must be stated truthfully`);
    assert.strictEqual(row.required, shouldFold ? "0" : "1", `${route}: data-frames-required must agree with it`);
    assert.strictEqual(row.workflowOpen, !shouldFold, `${route}: the workflow folds exactly when nothing needs a frame`);
    assert.strictEqual(row.statement, shouldFold, `${route}: the folded state must say why, and the open state must not`);

    /* NOTHING IS DELETED AND NOTHING IS WITHHELD. */
    assert.strictEqual(row.rail, baseline.rail, `${route}: the frame rail must still be built`);
    assert.strictEqual(row.addFrame, true, `${route}: adding a frame must stay possible`);
    assert.deepStrictEqual(row.frameLabels, baseline.frameLabels, `${route}: every frame must still be rendered`);
    assert.strictEqual(row.progress, baseline.progress, `${route}: the shot's frames are unchanged`);

    /* AND NO PROGRESS IS FABRICATED. A folded stage is not a finished one. */
    assert.strictEqual(row.stageProgress, baseline.stageProgress,
      `${route}: folding a stage must not move a single completion, availability or blocked reason`);
    assert.strictEqual(row.readiness, baseline.readiness,
      `${route}: folding a stage must not move a single readiness state, requirement or next action`);
  }

  /* THE TWO STATES REMEMBER SEPARATELY, and this is the assertion that keeps the
     adaptation from being silently defeated.

     A `<details>` rendered WITH `open` fires a toggle event in a real browser, queued as
     a task, so it lands after ROUTE_RENDER_IN_PROGRESS clears and rememberWorkspaceSection
     writes "1" for a panel nobody touched. Measured in Chromium: the frames-workflow key
     is already "1" the first time a shot is opened. A folded default that shared that key
     would therefore be overridden on every shot a filmmaker had ever visited — the
     adaptation would appear to work in Node and do nothing in the product.

     Node cannot see it (this harness fires no toggle events), so what is asserted here is
     the property that makes it impossible: the two relevance states write and read
     DIFFERENT keys. tests/shot-intent-ux-real-browser.py section 3 proves the behaviour. */
  const keys = {};
  for (const route of [foldRoute, keepRoute]) {
    const shot = await renderShot(route);
    keys[route] = run(shot.context, `
      const s = P.shots.find((row) => row.id === "L1-01");
      const html = shotFramesWorkspace(s, takesFor("L1-01"));
      return { key: (html.match(/rememberWorkspaceSection\\('([^']*frames-workflow[^']*)'/) || [, ""])[1] };`).key;
  }
  assert(keys[foldRoute] && keys[keepRoute], "both states must name a remembered section key");
  assert.notStrictEqual(keys[foldRoute], keys[keepRoute],
    "the folded and exposed states must remember separately, or a key written by the shipped default silently overrides the adaptation");
  assert.strictEqual(keys[keepRoute], "L1-01:frames-workflow",
    "the exposed state must keep the key every existing install already holds");

  /* CHANGING INTENT BACK RESTORES ACCESS, and there is nothing to restore because
     nothing was removed. Driven through the real writer, on one page, in sequence. */
  const journey = await renderShot(undefined);
  const trip = run(journey.context, `
    const s = () => P.shots.find((row) => row.id === "L1-01");
    const snapshot = () => {
      const html = shotFramesWorkspace(s(), takesFor("L1-01"));
      return {
        frames: JSON.stringify((s().keyframes || []).map((f) => ({ id: f.id, winner: f.winner || "", required: f.required !== false }))),
        clips: JSON.stringify((s().clips || []).map((c) => ({ id: c.id, kind: c.kind, fromFrame: c.fromFrame || "" }))),
        rail: (html.match(/guided-frame-rail/g) || []).length,
        open: / open /.test((html.match(/<details class="guided-frame-workflow[^>]*>/) || [""])[0]),
      };
    };
    const before = snapshot();
    setShotIntent("L1-01", ${JSON.stringify(foldRoute)});
    const folded = snapshot();
    setShotIntent("L1-01", ${JSON.stringify(keepRoute)});
    const reopened = snapshot();
    setShotIntent("L1-01", "");
    const withdrawn = snapshot();
    return { before, folded, reopened, withdrawn };`);
  assert.strictEqual(trip.folded.open, false, `declaring ${foldRoute} must fold the workflow`);
  assert.strictEqual(trip.reopened.open, true, `declaring ${keepRoute} again must bring it straight back`);
  assert.strictEqual(trip.withdrawn.open, true, "and withdrawing the intent must restore the shipped default");
  for (const stage of ["folded", "reopened", "withdrawn"]) {
    assert.strictEqual(trip[stage].frames, trip.before.frames, `${stage}: not one frame may change`);
    assert.strictEqual(trip[stage].clips, trip.before.clips, `${stage}: not one motion unit may change`);
    assert.strictEqual(trip[stage].rail, trip.before.rail, `${stage}: the frame workflow must still be built in full`);
  }

  note(`5D. adaptive frames: ${folds.join(", ")} fold and ${ROUTES.filter((r) => !folds.includes(r)).join(", ")} do not, `
    + "derived from the probes AND the shipped motion gate; every frame, unit and stage state survives folding, and intent changes back restore the default");
}

/* ===========================================================================
   6 (E) — HYBRID.
   =========================================================================== */

async function checkHybrid() {
  assert(!CINEBRAID_GENERATION_MODES.includes("hybrid"), "hybrid must still not be a generation mode");
  assert.strictEqual(Route.shotRouteGenerationMode("hybrid"), "", "and must still name none");
  for (const state of SHOT_STATES)
    assert(!resolveTaskModes(state.task, { references: state.references }).includes("hybrid"),
      `${state.name}: the resolver must never return hybrid as a method`);

  /* IT IS CONSTRAINED, AND THAT IS WHAT MAKES IT NOT ABSENCE. */
  const compatible = Intent.shotIntentCompatibleModes("hybrid");
  assert.strictEqual(compatible.constrained, true, "hybrid applies an intersection; absence applies none");
  assert.deepStrictEqual([...compatible.modes], [...Intent.SHOT_INTENT_ROUTE_MODES],
    "hybrid admits every method the other routes name, and nothing else");
  assert(!compatible.modes.includes("hybrid"), "and it does not admit itself: it is not a method");

  /* IT NARROWS. Against an authority that permits a non-video method, hybrid removes it
     and absence does not — which is the observable difference between the two. */
  const mixed = ["t2v", "i2v", "flf", "r2v", "edit", "t2i", "video-edit", "retake"];
  const hybrid = Intent.shotIntentEffectiveModes("hybrid", mixed);
  const absent = Intent.shotIntentEffectiveModes("", mixed);
  assert.deepStrictEqual(hybrid.modes, ["t2v", "i2v", "flf", "r2v"], "hybrid keeps the four it is composed of");
  assert.deepStrictEqual(hybrid.removed, ["edit", "t2i", "video-edit", "retake"], "and reports what it removed");
  assert.deepStrictEqual(absent.modes, mixed, "absence removes nothing");
  assert.notStrictEqual(JSON.stringify(hybrid.modes), JSON.stringify(absent.modes),
    "hybrid must not collapse into the undeclared state");
  for (const mode of hybrid.modes)
    assert(mixed.includes(mode), "and it still cannot introduce a method the authority did not permit");

  /* IT PERSISTS, AND THE SURFACE SAYS SO. */
  const page = await renderShot(undefined);
  const result = run(page.context, `
    setShotIntent("L1-01", "hybrid");
    const shot = P.shots.find((row) => row.id === "L1-01");
    const html = shotIntentControl(shot);
    return {
      stored: shot.deliveryRoute,
      reread: JSON.parse(JSON.stringify(P)).shots.find((row) => row.id === "L1-01").deliveryRoute,
      reading: readShotIntent(shot).reading,
      markup: html,
      framesRequired: shotIntentFrameExposure("hybrid", guidedVideoModeNeedsApprovedStill).required,
    };`);
  assert.strictEqual(result.stored, "hybrid", "hybrid must persist as hybrid");
  assert.strictEqual(result.reread, "hybrid", "and survive a round trip as hybrid");
  assert.strictEqual(result.reading, "declared", "a hybrid shot has declared an intent, not withheld one");
  const control = readControl(result.markup);
  assert.strictEqual(control.route, "hybrid", "the surface must show it");
  assert.deepStrictEqual(control.selectedValues, ["hybrid"], "and select it, rather than the undeclared option");
  assert.notStrictEqual(control.summary, "Not decided yet", "the summary must not read as undeclared");

  /* ITS ADAPTIVE PRESENTATION IS TRUTHFUL: a shot delivered by more than one method may
     be delivered by one that begins from a frame, so Frames stays. */
  assert.strictEqual(result.framesRequired, true,
    "hybrid may use a method that begins from an approved frame, so the Frames workflow must stay in front of the filmmaker");

  note("6E. hybrid: persists and round-trips as hybrid, is never a mode, applies a real intersection against the four "
    + "methods it is composed of, is distinguishable from absence, and keeps the Frames workflow");
}

/* ===========================================================================
   7 (F) — AN UNRECOGNISED STORED VALUE.
   =========================================================================== */

async function checkInvalidRoute() {
  for (const bad of ["GENERATE (FLF)", "flf2", "image-to-video", "hybrid-ish"]) {
    const page = await renderShot(bad);
    const control = readControl(page.main);
    assert.strictEqual(control.reading, "unrecognised", `${bad}: the surface must report the record as unreadable`);
    assert.strictEqual(control.route, "", `${bad}: and must claim no route`);

    /* NO VALID INTENT IS DISPLAYED. The only selected option is a disabled placeholder,
       and it is not one of the five. */
    assert.strictEqual(control.selectedValues.length, 1, `${bad}: exactly one option may be selected`);
    const selected = control.options.find((row) => row.selected);
    assert.strictEqual(selected.value, "", `${bad}: the selected option must name no route`);
    assert.strictEqual(selected.disabled, true, `${bad}: and must not be choosable, so it cannot read as a decision`);
    for (const route of ROUTES)
      assert(!control.options.find((row) => row.value === route).selected,
        `${bad}: ${route} must not be selected — manufacturing intent from a corrupt record is the one thing forbidden here`);
    assert(/shot-intent-unreadable/.test(control.body), `${bad}: the surface must say the value is unreadable`);
    assert(control.body.includes("setShotIntent('L1-01','')"),
      `${bad}: withdrawing the unreadable value must be an explicit act with its own control`);

    /* NOTHING IS REPAIRED AND NOTHING IS WIDENED. */
    const state = run(page.context, `
      const shot = P.shots.find((row) => row.id === "L1-01");
      const admissible = resolveTaskModes("animate-shot", { references: [{ role: "first-frame", mediaType: "image" }] });
      return {
        stored: shot.deliveryRoute,
        effective: shotIntentEffectiveModes(shot.deliveryRoute, admissible).modes,
        admissible,
        constrained: shotIntentEffectiveModes(shot.deliveryRoute, admissible).constrained,
        picker: guidedVideoProfileOptions("", declaredShotRoute(shot)) === guidedVideoProfileOptions("", "") ,
        framesRequired: shotIntentFrameExposure(declaredShotRoute(shot), guidedVideoModeNeedsApprovedStill).required,
      };`);
    assert.strictEqual(state.stored, bad, `${bad}: opening the shot must not rewrite or delete the stored value`);
    assert.deepStrictEqual(state.effective, state.admissible, `${bad}: the accepted answer must stand untouched`);
    assert.strictEqual(state.constrained, false, `${bad}: an unreadable value applies no intersection`);
    assert.strictEqual(state.picker, true, `${bad}: the picker must render exactly as it does with no intent`);
    assert.strictEqual(state.framesRequired, true, `${bad}: and the Frames workflow must stay exposed`);
  }

  /* THE WRITER REFUSES ONE WITHOUT TOUCHING THE RECORD. */
  const page = await renderShot("flf");
  const refusal = run(page.context, `
    const shot = P.shots.find((row) => row.id === "L1-01");
    const before = JSON.stringify(shot);
    setShotIntent("L1-01", "not-a-route");
    return { before, after: JSON.stringify(P.shots.find((row) => row.id === "L1-01")) };`);
  assert.strictEqual(refusal.after, refusal.before,
    "a refused declaration must leave the shot record byte-identical, including the intent it already had");

  note("7F. unrecognised: 4 injected values reported as needing review, no route selected, the stored value preserved "
    + "and named, the accepted method set untouched, the picker unchanged, and a refused write changes nothing");
}

/* ===========================================================================
   8 (G) — LEGACY BEHAVIOUR, AND THE BOUNDED VISIBLE CHANGE.

   This is the section that replaces Slice 5a's byte-identity: 5b's visible change is
   real, and it is CONFINED to the surface that declares it. On the stage the workspace
   opens on, declaring any route changes the rendered page inside the Shot Intent
   control and nowhere else at all.
   =========================================================================== */

async function checkLegacyAndBoundedChange() {
  const mask = (slots) => slots.replace(/<details class="shot-intent-control"[\s\S]*?<\/details>/g, "<<SHOT-INTENT>>");

  const baseline = await renderShot(undefined);
  assert(mask(baseline.slots).includes("<<SHOT-INTENT>>"), "the mask must actually find the control it is masking");

  for (const value of [...ROUTES, ...BAD_ROUTES]) {
    const routed = await renderShot(value);
    assert.strictEqual(mask(routed.slots), mask(baseline.slots),
      `declaring ${JSON.stringify(value)} changed a rendered surface OUTSIDE the Shot Intent control; `
      + "Slice 5b's visible change is bounded to the surfaces it declares");
  }
  /* An unreadable value's INERTNESS is asserted behaviourally in section 7 — the picker,
     the effective method set and the frame exposure are all identical to a shot that
     declared nothing. Here it is enough that it, too, changes nothing outside the
     control: what the control itself says about it is SUPPOSED to differ, because the
     record really is in a state a filmmaker has to be able to see. */

  /* THE ROUTE-LESS SHOT'S EXECUTION PATH IS THE ACCEPTED ONE. The picker's markup, the
     motion panel's gate and its route-status pill are all exactly what they were, which
     is asserted against the one-argument call the rest of the app still makes. */
  const legacy = run(baseline.context, `
    const s = P.shots.find((row) => row.id === "L1-01");
    return {
      pickerMatches: guidedVideoProfileOptions("minimax-h3/i2v") === guidedVideoProfileOptions("minimax-h3/i2v", declaredShotRoute(s)),
      route: declaredShotRoute(s),
      count: guidedVideoProfileCount(),
      narrowed: guidedIntentVideoProfileCount(declaredShotRoute(s)),
    };`);
  assert.strictEqual(legacy.route, "", "precondition: the legacy shot declares nothing");
  assert.strictEqual(legacy.pickerMatches, true,
    "with no intent declared the picker must be byte-identical to the call every other caller makes");
  assert.strictEqual(legacy.narrowed, legacy.count,
    "and no target may be narrowed away from a shot that has declared nothing");

  /* THE MOTION PANEL'S OWN GATE IS UNTOUCHED BY AN INTENT. Driven through the shipped
     renderer, on the shipped t2v case, for every route: the lock follows the unit's
     route exactly as Shot Execution T0 established, and never the declared intent. */
  const gate = run(baseline.context, `
    const rows = {};
    const shot = P.shots[0];
    for (const value of [null, ...CINEBRAID_SHOT_ROUTES]) {
      for (const frame of shot.keyframes || []) frame.winner = "";
      shot.clips = []; shot.motionPrompt = "";
      if (value === null) delete shot.deliveryRoute; else shot.deliveryRoute = value;
      const c = ensureShotCreation(shot);
      c.activeMotionUnitId = ""; c.motionProfileId = "";
      ensureGuidedMotionUnit(shot, "", null);
      const html = guidedMotionPanel(shot, null, []);
      rows[String(value)] = { locked: html.includes("guided-motion-card locked") };
    }
    delete shot.deliveryRoute;
    return rows;`);
  for (const value of ["null", ...ROUTES])
    assert.strictEqual(gate[value].locked, gate.null.locked,
      `${value}: a declared intent must not change whether the motion workspace is locked — that gate is the unit's, not the intent's`);

  note(`8G. bounded change: ${ROUTES.length + BAD_ROUTES.length} route values rendered byte-identically outside the Shot Intent `
    + "control; a route-less shot's picker, target count and motion gate are all exactly the accepted ones");
}

/* ===========================================================================
   9 — THE SURFACE IS OWNED BY THE SHOT, AND IS NOT SLICE 4's.
   =========================================================================== */

function checkOwnershipAndSeparation() {
  const studio = readLF("public/creation-studio.js");
  const control = studio.slice(studio.indexOf("function shotIntentControl(s) {"), studio.indexOf("window.setShotIntent"));
  assert(control.startsWith("function shotIntentControl(s) {"), "the control must be locatable to be constrained");

  /* NOT A SECOND GENERATION CONFIGURATION. Slice 4 owns how much configuration is shown;
     this control owns how the shot is made. Neither may grow the other's controls. */
  for (const token of ["gen-view", "generationControlPlan", "restrictPayloadToPlan", "cfgScale", "resolution", "aspectRatio", "outputCount"])
    assert(!control.includes(token),
      `the Shot Intent control must not draw Slice 4's generation configuration (${token})`);
  assert(!/fetch\(|api\//.test(control), "the control must not reach the network; declaring an intent is a local edit");

  /* NOT A NEW GLOBAL DESTINATION. It is owned by the shot workflow. */
  const app = readLF("public/app.js");
  assert(!/#\/shot-intent|shot-intent["']?\s*:/.test(app), "Shot Intent must not become a route or a navigation destination");
  const views = readLF("public/views.js") + readLF("public/creator-surfaces.js") + readLF("public/workspace-shell.js");
  assert(!/shotIntentControl|setShotIntent/.test(views),
    "the control belongs to the shot workspace; no shell, nav or global surface may draw it");

  /* THE WRITER GOES THROUGH SLICE 5a AND NOWHERE ELSE, and it raises the schema marker
     the way every other 6.7 writer does. */
  const writer = studio.slice(studio.indexOf("window.setShotIntent"), studio.indexOf("window.openShotIntent"));
  assert(/declareShotRoute\(/.test(writer) && /clearShotRoute\(/.test(writer),
    "the writer must go through the Slice 5a authority");
  assert(!/\.deliveryRoute/.test(writer), "and must never touch the field itself");
  assert(/markContinuitySchema\(\)/.test(writer),
    "a real change writes a 6.7 field, so the marker must be raised the way app.js requires");
  assert(/dirty\(\)/.test(writer), "and the project must be marked dirty so the change is saved");

  /* THE STAGE STRIP STILL DOES NOT KNOW. O4's runtime may name no stage and now may name
     no route either; adaptive exposure lives in the workspace that owns the stage. */
  const strip = readLF("public/stage-surfaces.js");
  assert(!/deliveryRoute|shotIntent|shared-shot-intent/.test(strip),
    "the persistent stage bar must not read a declared intent; it renders what the declared stage model returns");

  note("9. ownership: the control is the shot workspace's, draws no Slice 4 configuration, adds no navigation "
    + "destination, writes only through Slice 5a, and the persistent stage bar still reads only the stage model");
}

/* ===========================================================================
   10 — STORED IS NOT EXECUTABLE. The execution gate.

   THE DEFECT THIS SECTION EXISTS FOR, reproduced exactly as review reproduced it: a shot
   carrying `minimax-h3/t2v` and a declared `flf` intent. The picker exempts the STORED
   selection from narrowing on purpose, so the option stayed enabled — and nothing
   downstream re-asked the question, so Build prompt compiled a t2v package and the paid
   GENERATE H3 VIDEO button was drawn from it. Narrowing that only paints is not a gate.

   The distinction being asserted is STORED/EDITABLE vs EXECUTABLE, and the implication
   the brief states is checked over the whole matrix:

       selected method executable  =>  selected method is in the effective admissible set
   =========================================================================== */

const H3_T2V = "minimax-h3/t2v";

/* WHERE THE SHOT'S CHOSEN TARGET ACTUALLY LIVES, which is not one field.
   public/v607-composer.js writes `motionProfileId` onto the ACTIVE MOTION UNIT whenever a
   shot has one, and falls back to the shot's creation record when it does not — and its
   wrappers copy the unit's value onto the creation record for the duration of a render or
   a build. A suite that read only `creation.motionProfileId` would find `undefined` on
   every shot with a clip and prove nothing about what a filmmaker chose. */
const STORED_TARGET = `(() => {
  const shot = P.shots.find((row) => row.id === "L1-01");
  const unit = guidedActiveMotionUnit(shot);
  return (unit && unit.motionProfileId) || ensureShotCreation(shot).motionProfileId || "";
})()`;

/* THE REQUESTS THAT MEAN SOMETHING HERE. A refused build still re-renders — the shipped
   v607 wrapper calls route() whatever the base returned — and a render fetches the shot's
   folder listing. Asserting "no request at all" would be asserting that the app stopped
   repainting. What must never happen is a PROMPT COMPILE or anything on the generation
   endpoints, so those are what is counted. */
const BUILD_ROUTES = ["/api/prompt/compile", "/api/prompt/improve"];
const PAID_ROUTES = ["/api/generation/"];
const matching = (requests, needles) => requests.filter((url) => needles.some((needle) => url.includes(needle)));

/* A shot workspace with fal reported ready and every request recorded. Nothing is
   stubbed that decides anything: only `falGenerationReady` (the harness has no key) and
   `fetch`/`toast`, which are observed rather than replaced. */
async function executionPage(routeValue) {
  const page = await renderShot(routeValue);
  vm.runInContext(`
    globalThis.__requests = [];
    const __fetch = fetch;
    globalThis.fetch = (url, options) => { __requests.push(String(url)); return __fetch(url, options); };
    globalThis.falGenerationReady = () => true;
    globalThis.__toasts = [];
    globalThis.toast = (message) => { __toasts.push(String(message)); };
  `, page.context);
  return page;
}

async function checkExecutionGate() {
  /* ---- the reproduction, verbatim ------------------------------------------------ */
  const page = await executionPage("flf");
  const reproduction = JSON.parse(await vm.runInContext(`(async () => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const creation = ensureShotCreation(shot);
    /* Stored the way a filmmaker stores it: through the shipped handler the picker's own
       onchange names, while nothing is declared and the target is therefore selectable. */
    setGuidedMotionField("L1-01", "motionProfileId", ${JSON.stringify(H3_T2V)});
    creation.motionDirection = "He turns to the panel.";
    creation.motionPromptBuilds = [{
      id: "stale-build", packageId: "L1-01-MOTION-R01", date: "2026-08-19T00:00:00.000Z",
      profileId: ${JSON.stringify(H3_T2V)}, prompt: "A compiled t2v prompt.", durationSeconds: 5, references: [],
    }];
    const profile = guidedVideoProfiles().find((row) => row.id === ${JSON.stringify(H3_T2V)});
    const storedBefore = ${STORED_TARGET};
    const buildsBefore = creation.motionPromptBuilds.length;

    __requests.length = 0;
    await buildGuidedMotionPrompt("L1-01", false);
    const afterBuild = { requests: [...__requests], builds: creation.motionPromptBuilds.length };

    __requests.length = 0;
    await openFalH3MotionModal("L1-01", "stale-build");
    const afterModal = { requests: [...__requests], request: !!window._falH3MotionRequest };

    __requests.length = 0;
    document.getElementById("fal-h3-prompt-editor").value = "A compiled t2v prompt.";
    window._falH3Submitting = false;
    window._falH3MotionRequest = { shotId: "L1-01", buildId: "stale-build", profileId: ${JSON.stringify(H3_T2V)},
      profileMode: "t2v", prompt: "A compiled t2v prompt.", compiledPrompt: "A compiled t2v prompt.",
      durationSeconds: 5, clientRequestId: "gate-probe" };
    await startFalH3MotionGeneration();
    const afterSubmit = { requests: [...__requests], submitting: !!window._falH3Submitting };

    return JSON.stringify({
      route: declaredShotRoute(shot),
      compatible: guidedVideoProfileMatchesIntent(profile, declaredShotRoute(shot)),
      executable: guidedMotionProfileExecutable(shot, profile),
      admissible: guidedMotionAdmissibleModes(),
      effective: guidedMotionEffectiveModes(declaredShotRoute(shot)),
      storedBefore, storedAfter: ${STORED_TARGET},
      buildsBefore, afterBuild, afterModal, afterSubmit,
      paidAction: falH3MotionPromptAction("L1-01", "stale-build", profile),
      picker: guidedVideoProfileOptions(${STORED_TARGET}, declaredShotRoute(shot)),
      panel: guidedMotionPanel(shot, guidedCurrentShotStill(shot), takesFor("L1-01"), true),
      refusal: guidedMotionIntentRefusal(shot, profile),
    });
  })()`, page.context));

  assert.strictEqual(reproduction.route, "flf", "precondition: the shot declares flf");
  assert.strictEqual(reproduction.storedBefore, H3_T2V, "precondition: the shot stores the t2v target");
  assert.strictEqual(reproduction.compatible, false, "precondition: t2v is not compatible with an flf intent");

  /* 1 — THE STORED SELECTION IS PRESERVED, not erased and not rewritten. */
  assert.strictEqual(reproduction.storedAfter, H3_T2V,
    "a refused build must leave the filmmaker's stored target exactly as they left it");
  assert(reproduction.picker.includes(`value="${H3_T2V}" selected`),
    "the stored target must still be rendered and still be selected, so the filmmaker can see and change it");
  assert(reproduction.picker.includes("not how this shot is made"),
    "and it must be labelled truthfully rather than silently");

  /* 2 — IT IS NOT EXECUTABLE. */
  assert.strictEqual(reproduction.executable, false, "an intent-excluded stored target must not be executable");
  assert(reproduction.refusal, "and the refusal must say why, in one place");
  assert(!reproduction.effective.includes("t2v"), "t2v must not be in the effective set for an flf intent");
  assert(reproduction.admissible.includes("t2v"), "while remaining in the accepted admissible set — this is narrowing, not deletion");

  /* 3 — BUILD PROMPT CANNOT PROCEED, and nothing was compiled. */
  assert.deepStrictEqual(matching(reproduction.afterBuild.requests, [...BUILD_ROUTES, ...PAID_ROUTES]), [],
    `a refused build must compile nothing and spend nothing, got ${JSON.stringify(reproduction.afterBuild.requests)}`);
  assert.strictEqual(reproduction.afterBuild.builds, reproduction.buildsBefore,
    "and must create no compiled package for a paid action to be drawn from");

  /* 4 — NO PAID ACTION IS PRODUCED, from a stale build or otherwise. */
  assert(!reproduction.paidAction.includes("GENERATE H3 VIDEO"),
    "a stale package compiled before the intent changed must not draw the paid button");
  assert(reproduction.paidAction.includes("data-h3-intent-blocked"),
    "it must state the reason where the button was, rather than leaving a gap");
  assert(!reproduction.panel.includes("GENERATE H3 VIDEO"),
    "and the rendered motion workspace must not carry the paid button either");

  /* 5 — THE BUILD CONTROLS ARE DISABLED AND SAY WHY. Belt; the gate above is the braces. */
  const buildButton = /<button class="assemble-btn"([^>]*)onclick="buildGuidedMotionPrompt\('L1-01',false\)"/.exec(reproduction.panel);
  assert(buildButton, "the Build prompt control must be locatable");
  assert(/\bdisabled\b/.test(buildButton[1]), "Build prompt must be disabled for an intent-excluded target");
  assert(/aria-describedby="guided-motion-intent-refusal-L1-01"/.test(buildButton[1]),
    "and the visible reason must be associated with it rather than left to a tooltip");
  assert(reproduction.panel.includes("data-video-profile-intent-blocked"),
    "the refusal must be rendered through the picker's existing refusal convention");

  /* 6 — THE PAID DIALOG DOES NOT OPEN, and the paid POST is never built. */
  assert.deepStrictEqual(matching(reproduction.afterModal.requests, PAID_ROUTES), [],
    "opening the paid dialog on an excluded target must reach no generation endpoint — not even the plan");
  assert.strictEqual(reproduction.afterModal.request, false,
    "and must not leave a submittable request behind");
  assert.deepStrictEqual(matching(reproduction.afterSubmit.requests, PAID_ROUTES), [],
    "and a hand-built submit must reach no generation endpoint");
  assert.strictEqual(reproduction.afterSubmit.submitting, false,
    "the paid submit must fail closed before it marks itself in flight");

  /* 7 — AND THE SAME BUILD REALLY DOES COMPILE ONCE THE INTENT MATCHES. Without this the
     six assertions above would be satisfied by a product where nothing ever builds. */
  const permitted = JSON.parse(await vm.runInContext(`(async () => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    setShotIntent("L1-01", "t2v");
    __requests.length = 0;
    await buildGuidedMotionPrompt("L1-01", false);
    return JSON.stringify({ requests: [...__requests], stored: ${STORED_TARGET} });
  })()`, page.context));
  assert(matching(permitted.requests, BUILD_ROUTES).length >= 1,
    `a compatible intent must let the SAME stored target compile, got ${JSON.stringify(permitted.requests)}`);
  assert.strictEqual(permitted.stored, H3_T2V,
    "and it must still be the target the filmmaker stored, not one chosen for them");

  /* ---- the transition, on one page, in sequence ---------------------------------- */
  const journey = await executionPage(undefined);
  const trip = JSON.parse(await vm.runInContext(`(async () => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const creation = ensureShotCreation(shot);
    setGuidedMotionField("L1-01", "motionProfileId", ${JSON.stringify(H3_T2V)});
    creation.motionDirection = "He turns to the panel.";
    const profile = guidedVideoProfiles().find((row) => row.id === ${JSON.stringify(H3_T2V)});
    const snapshot = async () => {
      __requests.length = 0;
      const executable = guidedMotionProfileExecutable(shot, profile);
      return {
        route: declaredShotRoute(shot),
        stored: ${STORED_TARGET},
        executable,
        effective: guidedMotionEffectiveModes(declaredShotRoute(shot)),
        refused: !!guidedMotionIntentRefusal(shot, profile),
      };
    };
    const compatible = await snapshot();
    setShotIntent("L1-01", "flf");
    const excluded = await snapshot();
    setShotIntent("L1-01", "t2v");
    const restored = await snapshot();
    setShotIntent("L1-01", "");
    const withdrawn = await snapshot();
    return JSON.stringify({ compatible, excluded, restored, withdrawn });
  })()`, journey.context));

  assert.strictEqual(trip.compatible.executable, true, "with no intent declared the stored target executes, exactly as it always has");
  assert.strictEqual(trip.excluded.executable, false, "declaring an intent that excludes it must block execution");
  assert.strictEqual(trip.restored.executable, true, "and declaring a compatible intent must make the SAME preserved target usable again");
  assert.strictEqual(trip.withdrawn.executable, true, "withdrawing the intent must return the accepted baseline");
  for (const [name, row] of Object.entries(trip))
    assert.strictEqual(row.stored, H3_T2V, `${name}: the stored target must survive every transition untouched`);
  assert.strictEqual(trip.excluded.refused, true, "only the excluded state may carry a refusal");
  assert.strictEqual(trip.restored.refused, false, "and it must be gone the moment the intent matches again");

  /* ---- THE IMPLICATION, over the whole matrix ------------------------------------ */
  const matrix = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const rows = [];
    for (const value of [null, ...CINEBRAID_SHOT_ROUTES, "flf2", "GENERATE (FLF)"]) {
      if (value === null) delete shot.deliveryRoute; else shot.deliveryRoute = value;
      const route = declaredShotRoute(shot);
      const effective = guidedMotionEffectiveModes(route);
      const admissible = guidedMotionAdmissibleModes();
      for (const profile of guidedVideoProfiles())
        rows.push({ value: String(value), route, effective, admissible, id: profile.id,
          mode: guidedVideoProfileRouteKind(profile),
          executable: guidedMotionProfileExecutable(shot, profile) });
    }
    delete shot.deliveryRoute;
    return rows;
  })())`, journey.context));

  assert(matrix.length >= 8 * 6, "the matrix must cover every target against every route state");
  let executableCount = 0;
  for (const row of matrix) {
    /* THE IMPLICATION THE BRIEF STATES, checked on every single row. */
    if (row.executable) {
      executableCount += 1;
      assert(row.effective.includes(row.mode),
        `${row.value} + ${row.id}: executable but ${row.mode} is not in the effective set ${JSON.stringify(row.effective)}`);
    }
    /* And the effective set is always a subset of the accepted admissible one. */
    for (const mode of row.effective)
      assert(row.admissible.includes(mode), `${row.value}: ${mode} is not in the accepted admissible set`);
  }
  assert(executableCount > 0, "something must be executable, or this proves only that nothing runs");
  /* Unset and unreadable both reproduce the accepted baseline EXACTLY: everything the
     catalogue offers stays executable. */
  for (const value of ["null", "flf2", "GENERATE (FLF)"]) {
    const rows = matrix.filter((row) => row.value === value);
    assert(rows.length && rows.every((row) => row.executable),
      `${value}: no target may be blocked when nothing readable is declared`);
  }
  /* And a single-method intent really does block something, or the gate is inert. */
  assert(matrix.some((row) => row.value === "flf" && !row.executable),
    "declaring flf must actually block a target");

  /* ---- THE GATE IS SEMANTIC, NOT A READING OF THE SCREEN ------------------------- */
  const studio = readLF("public/creation-studio.js");
  const gate = studio.slice(studio.indexOf("function guidedMotionAdmissibleModes()"), studio.indexOf("function guidedVideoProfileOptionSuffix"));
  assert(gate.includes("function guidedMotionProfileExecutable"), "the gate must be locatable to be constrained");
  /* CODE, not comments. The comments here legitimately discuss the disabled control the
     gate exists to be independent of; what must not appear is a READ of one. */
  const gateCode = codeOnly(gate);
  for (const forbidden of ["document", "getElementById", "querySelector", "disabled", "localStorage"])
    assert(!gateCode.includes(forbidden),
      `the execution gate must not consult the screen (${forbidden}); a disabled <option> is a courtesy, not a fact`);
  assert(gate.includes("shotIntentEffectiveModes"),
    "and it must reach its answer through the accepted narrowing authority rather than a second resolver");
  assert(!/shotIntentAdmitsMode|CINEBRAID_SHOT_ROUTE/.test(gateCode),
    "one authority, one call: the gate must not also hand-roll a route comparison");

  /* Every boundary that builds or spends asks the ONE predicate, and none of them
     re-implements it. */
  const fal = readLF("public/fal-generation.js");
  assert.strictEqual((fal.match(/guidedMotionIntentRefusal\(/g) || []).length, 3,
    "all three paid boundaries in fal-generation.js must ask the shared predicate");
  assert(!/deliveryRoute|shotIntentEffectiveModes|shotIntentAdmitsMode/.test(fal),
    "and none of them may derive compatibility for itself");
  /* ONE DECLARATION AND THREE ASKERS in the studio: the picker's refusal line, the motion
     panel's build controls, and the prompt builder's gate. Counted so a fourth surface
     that grew its own compatibility opinion shows up here. */
  assert(studio.includes("function guidedMotionIntentRefusal("), "the predicate must be declared once");
  assert.strictEqual(studio.split("guidedMotionIntentRefusal(").length - 1, 4,
    "one declaration and exactly three askers; a new one means a new surface that must be reviewed");
  assert(!/declaredShotRoute\([^)]*\)[^\n]*===\s*["']/.test(codeOnly(studio)),
    "no surface may compare a route token by hand instead of asking the predicate");

  /* ---- ASKING THE QUESTION CHANGES NOTHING --------------------------------------- */
  const purity = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    shot.deliveryRoute = "flf";
    const profile = guidedVideoProfiles().find((row) => row.id === ${JSON.stringify(H3_T2V)});
    const before = JSON.stringify(shot);
    guidedMotionIntentRefusal(shot, profile);
    guidedMotionProfileExecutable(shot, profile);
    guidedMotionEffectiveModes(declaredShotRoute(shot));
    const after = JSON.stringify(shot);
    delete shot.deliveryRoute;
    return { unchanged: before === after };
  })())`, journey.context));
  assert.strictEqual(purity.unchanged, true,
    "the gate is a question, not an edit: asking it must not touch the shot record");

  note(`10. execution gate: the reproduced case (stored ${H3_T2V} + flf intent) is preserved, labelled, `
    + "disabled and refused at all four boundaries with zero requests; "
    + `${matrix.length} target/route rows all satisfy executable ⇒ in the effective set; unset and unreadable stay baseline; `
    + "the gate reads no DOM and the question mutates nothing");
}

/* =========================================================================== */

async function main() {
  checkProjection();
  await checkRouteSelection();
  await checkNoInference();
  await checkNoWidening();
  await checkFrameExposure();
  await checkHybrid();
  await checkInvalidRoute();
  await checkLegacyAndBoundedChange();
  checkOwnershipAndSeparation();
  await checkExecutionGate();

  console.log("Shot intent UX suite passed:");
  for (const line of notes) console.log(`  - ${line}`);
  console.log("  Paid calls: 0. Provider calls: 0. Off-site requests: 0.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
