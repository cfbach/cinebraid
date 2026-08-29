/* Negative controls for tests/shot-intent-ux.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces ONE of the defects Slice 5b exists to prevent — IN MEMORY, through
 * an in-memory Module or the render harness's mutateSource hook, so nothing on disk is
 * touched and no control can be "restored" by a checkout that also discards real work —
 * and then proves the guard notices.
 *
 * Every control carries a PROBE RECEIPT: the mutation asserts the text it is replacing
 * was actually present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing.
 *
 * THE CONTROLS ARE CHOSEN TO BREAK DIFFERENT MECHANISMS, because the failures this slice
 * is most exposed to are not crashes. They are: a route that quietly widens what may be
 * generated, an intent nobody declared, a folded stage that turns out to have deleted
 * something, and a corrupt record that becomes a decision.
 *
 * NO PROJECT DATA IS TOUCHED, NO PAID CALL AND NO PROVIDER CALL.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const INTENT_FILE = path.join(PUBLIC, "shared-shot-intent.js");

/* Line endings are normalised on read: this repository checks out with
   core.autocrlf=true, so a multi-line anchor written with \n would match nothing and
   take the control's meaning with it. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const INTENT_SOURCE = readLF(INTENT_FILE);

const Intent = require("../public/shared-shot-intent");
const { resolveTaskModes } = require("../public/shared-generation-options");
const { render, buildFixture } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

const ROUTES = ["t2v", "i2v", "flf", "r2v", "hybrid"];
const image = (role) => ({ role, mediaType: "image" });

/* A mutation that must find what it is replacing. */
function mutate(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

/* A harness mutateSource hook scoped to one file, with the same probe receipt. */
function replacing(file, needle, replacement, label, expected = 1) {
  return (name, contents) => {
    if (name !== file) return contents;
    return mutate(String(contents).replace(/\r\n/g, "\n"), needle, replacement, label, expected);
  };
}

/* Compile a mutated module in memory under its real filename, so its own require()s
   resolve normally. The file on disk is opened read-only and never written. */
function compileModule(file, source) {
  const compiled = new Module(file, null);
  compiled.filename = file;
  compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(source, file);
  return compiled.exports;
}

/* Runs the body and requires it to throw, mentioning `because`. */
async function mustFail(label, because, body) {
  let failure = null;
  try { await body(); }
  catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
  note(`  ${label} — failed as required`);
}

const scanFor = (project) => ({
  anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
  plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
  props: [], vehicles: [], audio: [],
  media: (project.mediaAssets || []).map((asset) => ({ name: asset.file, url: `/assets/media/${asset.file}` })),
  shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: [], locked: [] }])),
});

async function renderShot(routeValue, options = {}) {
  const project = buildFixture();
  if (routeValue !== undefined) project.shots[0].deliveryRoute = routeValue;
  const rendered = await render("#/shot/L1-01", project, { scan: scanFor(project), ...options });
  const slots = [...rendered.map.entries()].map(([id, element]) => `<<${id}>>${String(element.innerHTML || "")}`).join("\n");
  return { context: rendered.context, slots, main: String(rendered.map.get("main").innerHTML || "") };
}
const run = (context, expression) => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${expression} })())`, context));

/* ===========================================================================
   THE PROJECTION'S OWN SEMANTICS — the narrowing that must never widen.
   =========================================================================== */

async function projectionControls() {
  const admissible = resolveTaskModes("animate-shot", { references: [image("first-frame")] });
  assert.deepStrictEqual(admissible, ["i2v"], "precondition: the shipped resolver still answers i2v for an opening frame");

  /* NC-1 — THE INTERSECTION BECOMES A UNION. This is the whole slice's failure mode in
     one character: a route that ADDS its own method to whatever the authority permitted
     is a route that grants generation authority nothing else granted. */
  await mustFail(
    "NC-1 the narrowing unions the route's methods into the authority's answer",
    "is not in the accepted admissible set",
    () => {
      const broken = compileModule(INTENT_FILE, mutate(INTENT_SOURCE,
        "    const modes = supplied.filter((mode) => compatible.modes.includes(mode));",
        "    const modes = [...new Set([...supplied.filter((mode) => compatible.modes.includes(mode)), ...compatible.modes])];",
        "NC-1"));
      for (const route of ROUTES)
        for (const mode of broken.shotIntentEffectiveModes(route, admissible).modes)
          assert(admissible.includes(mode),
            `${route}: ${mode} is not in the accepted admissible set — a route may never grant a method`);
    },
  );

  /* NC-2 — AN UNREADABLE VALUE FALLS BACK TO A ROUTE. Absence and corruption both have
     to mean "apply no intersection"; a fallback that picked the first route would make a
     hand-edited document silently constrain a shot to text-to-video. */
  await mustFail(
    "NC-2 an unrecognised value falls back to the first declared route",
    "must leave the accepted answer exactly as it was",
    () => {
      const broken = compileModule(INTENT_FILE, mutate(INTENT_SOURCE,
        '    if (!route) return deepFreeze({ route: "", constrained: false, modes: [] });',
        "    if (!route) return deepFreeze({ route: CINEBRAID_SHOT_ROUTES[0], constrained: true, modes: [shotRouteGenerationMode(CINEBRAID_SHOT_ROUTES[0])] });",
        "NC-2"));
      for (const value of ["", "GENERATE (FLF)", "flf2", "hybrid-ish"])
        assert.deepStrictEqual(broken.shotIntentEffectiveModes(value, admissible).modes, [...admissible],
          `${JSON.stringify(value)}: must leave the accepted answer exactly as it was`);
    },
  );

  /* NC-3 — HYBRID COLLAPSES INTO ABSENCE. Returning `constrained: false` for hybrid
     makes a declared production statement behaviourally identical to never having made
     one, which is the specific thing Slice 5a's vocabulary exists to prevent. */
  await mustFail(
    "NC-3 hybrid is treated as though no intent were declared",
    "must not collapse into the undeclared state",
    () => {
      const broken = compileModule(INTENT_FILE, mutate(INTENT_SOURCE,
        "    /* The route that names no single method: every method the other routes name. */\n    return deepFreeze({ route, constrained: true, modes: [...SHOT_INTENT_ROUTE_MODES] });",
        '    return deepFreeze({ route: "", constrained: false, modes: [] });',
        "NC-3"));
      const mixed = ["t2v", "i2v", "flf", "r2v", "edit", "t2i"];
      assert.notStrictEqual(
        JSON.stringify(broken.shotIntentEffectiveModes("hybrid", mixed).modes),
        JSON.stringify(broken.shotIntentEffectiveModes("", mixed).modes),
        "hybrid must not collapse into the undeclared state");
    },
  );

  /* NC-4 — HYBRID IS GIVEN A MODE OF ITS OWN. `hybrid` names no single method; making it
     one would put a token in an effective-method list that no generation contract, no
     adapter and no serializer has ever heard of. */
  await mustFail(
    "NC-4 hybrid is admitted as a generation method",
    "cannot introduce a method the authority did not permit",
    () => {
      const broken = compileModule(INTENT_FILE, mutate(INTENT_SOURCE,
        "    const modes = supplied.filter((mode) => compatible.modes.includes(mode));",
        '    const modes = supplied.filter((mode) => compatible.modes.includes(mode)).concat(compatible.route === "hybrid" ? ["hybrid"] : []);',
        "NC-4"));
      const supplied = ["t2v", "i2v"];
      for (const mode of broken.shotIntentEffectiveModes("hybrid", supplied).modes)
        assert(supplied.includes(mode), `${mode}: cannot introduce a method the authority did not permit`);
    },
  );

  /* NC-5 - FRAME EXPOSURE REINTRODUCES A NON-FRAME REQUIREMENT.
     r2v requires a canonical reference, but that does not make Frames required. */
  await mustFail(
    "NC-5 a reference requirement is misclassified as a frame requirement",
    "canonical route requires no frame input",
    () => {
      const broken = compileModule(INTENT_FILE, mutate(INTENT_SOURCE,
        "    const required = routeNeeds.framesRequired === true;",
        "    const required = routeNeeds.needs.length > 0;",
        "NC-5"));
      assert.strictEqual(broken.shotIntentFrameExposure("r2v").adapt, true,
        "r2v: Frames folds because the canonical route requires no frame input");
    },
  );

  note(`  projection controls ran against ${ROUTES.length} routes and the shipped resolver's own answer`);
}

/* ===========================================================================
   THE RENDERED SURFACES.
   =========================================================================== */

async function surfaceControls() {
  const baseline = await renderShot(undefined);
  const framesFor = (context) => run(context, `
    const s = P.shots.find((row) => row.id === "L1-01");
    const html = shotFramesWorkspace(s, takesFor("L1-01"));
    return {
      relevance: (html.match(/data-frames-relevance="([^"]*)"/) || [, ""])[1],
      rail: (html.match(/guided-frame-rail/g) || []).length,
      addFrame: html.includes("guided-add-frame"),
      frames: [...html.matchAll(/data-frame-id="([^"]*)"/g)].map((row) => row[1]),
      stageProgress: JSON.stringify(shotStageProgress(shotStageModelFacts(s, takesFor("L1-01")))),
    };`);
  const baseFrames = framesFor(baseline.context);
  assert(baseFrames.rail > 0 && baseFrames.frames.length > 0,
    "precondition: the fixture's Frames stage must really build a rail and some frames");

  /* NC-6 — FOLDING BECOMES REMOVING. The one thing adaptive exposure must never be: a
     stage that stops being built because the shot said it did not need it. The frames,
     their candidates and their approvals are still on the record, and a workspace that
     does not render them has hidden production truth rather than de-emphasised it. */
  await mustFail(
    "NC-6 a folded Frames stage stops building the frame workflow at all",
    "the frame workflow must still be built in full",
    async () => {
      const page = await renderShot("t2v", {
        mutateSource: replacing("creation-studio.js",
          "  return `<section class=\"shot-frames-workspace\" data-frames-relevance=\"${attr(relevance)}\"",
          "  if (exposure.adapt) return `<section class=\"shot-frames-workspace\" data-frames-relevance=\"${attr(relevance)}\" data-frames-required=\"0\">${statement}</section>`;\n  return `<section class=\"shot-frames-workspace\" data-frames-relevance=\"${attr(relevance)}\"",
          "NC-6"),
      });
      const folded = framesFor(page.context);
      assert.strictEqual(folded.rail, baseFrames.rail, "the frame workflow must still be built in full");
      assert.deepStrictEqual(folded.frames, baseFrames.frames, "the frame workflow must still be built in full");
    },
  );

  /* NC-7 - THE CANONICAL REQUIRED-FRAME COUNT IS WITHHELD FROM THE STAGE MODEL.

     REWRITTEN, not deleted. This control used to withhold `routeRequirementsKnown`,
     because the stage model gated frame optionality on it: known route AND zero
     required frames. The shot-intent closure pass made the gate the COUNT alone --
     an undeclared shot that owes no frame may skip the stage too, and gating on the
     declaration left it reported as not-skippable while its own status word said
     "not required". So withholding `routeRequirementsKnown` no longer breaks
     anything, and left as it was this control would have gone on passing against a
     mechanism it had stopped touching.

     It now corrupts the fact that actually carries the answer, at its source: the
     route's own frame-role count, replaced by how many frame RECORDS the shot happens
     to carry. A description-only shot then reports a required frame it never asked
     for and its Frames stage stops being skippable. The guarantee is unchanged --
     the canonical route answer, and nothing else, decides frame optionality -- and
     the control is aimed at the live path again. */
  await mustFail(
    "NC-7 canonical frame optionality is hidden from the stage model",
    "must project canonical frame optionality",
    async () => {
      const page = await renderShot("t2v", {
        mutateSource: replacing("creation-studio.js",
          "  const routeRequiredFrameCount = routeNeeds.known ? routeNeeds.frameNeeds.length : 0;",
          "  const routeRequiredFrameCount = routeNeeds.known ? progress.frames.length : 0;",
          "NC-7"),
      });
      const folded = framesFor(page.context);
      const frames = JSON.parse(folded.stageProgress).find((stage) => stage.id === "frames");
      assert.strictEqual(frames.optional, true,
        "description-only Frames must project canonical frame optionality");
    },
  );

  /* NC-8 — THE PICKER'S RULE BECOMES AN OR. Dispatchability and the declared intent must
     both hold; ORing them lets a declared route make a target CineBraid has no adapter
     for selectable, which is a Generate button with nothing behind it — the exact defect
     public/shared-generation-options.js was written to end. */
  await mustFail(
    "NC-8 a declared intent makes an undispatchable target selectable",
    "became selectable because an intent was declared",
    async () => {
      const page = await renderShot(undefined, {
        mutateSource: replacing("creation-studio.js",
          "  const selectable = (profile) => (guidedVideoProfileDispatchable(profile) && guidedVideoProfileMatchesIntent(profile, route)) || profile.id === selected;",
          "  const selectable = (profile) => guidedVideoProfileDispatchable(profile) || guidedVideoProfileMatchesIntent(profile, route) || profile.id === selected;",
          "NC-8"),
      });
      /* Every profile is dispatchable in the harness's annotated library, so both pages
         have to create an undispatchable one for the control to have something to widen
         ONTO. THE BASELINE COMES FROM THE UNMUTATED BUILD: an OR also widens the
         no-intent case, so comparing the mutated build against itself would find nothing
         wrong with it — which is exactly how this control could have passed vacuously. */
      const enabled = (context, route) => run(context, `
        for (const profile of PROMPT_LIBRARY.profiles)
          if (profile.mediaType === "video" && profile.family === "kling-3") profile.execution = { dispatchable: false, reason: "no adapter" };
        const markup = guidedVideoProfileOptions("", ${JSON.stringify(route)});
        return [...markup.matchAll(/<option value="([^"]*)"([^>]*)>/g)].filter((row) => !/\\bdisabled\\b/.test(row[2])).map((row) => row[1]);`);
      const shipped = await renderShot(undefined);
      const base = enabled(shipped.context, "");
      assert(!base.some((id) => id.startsWith("kling-3/")),
        "probe receipt: the shipped build must already refuse the target this control widens onto");
      for (const route of ROUTES)
        for (const id of enabled(page.context, route))
          assert(base.includes(id), `${route}: ${id} became selectable because an intent was declared`);
    },
  );

  /* NC-9 — THE SURFACE INFERS FROM THE LEGACY OUTPUT-PLAN FIELD. `shot.route` is free
     text and three different output plans write the same "GENERATE"; reading it as an
     intent puts the filmmaker's name on a decision the record does not contain. */
  await mustFail(
    "NC-9 the Shot Intent surface reads the legacy output-plan field as an intent",
    "must declare no intent",
    async () => {
      const page = await renderShot(undefined, {
        mutateSource: replacing("creation-studio.js",
          "  const intent = readShotIntent(s);",
          "  const intent = readShotIntent(Object.prototype.hasOwnProperty.call(s, \"deliveryRoute\") ? s : { ...s, deliveryRoute: shotRouteFromLegacyOutputRoute(s.route || \"\").route });",
          "NC-9"),
      });
      const reading = run(page.context, `
        const s = P.shots.find((row) => row.id === "L1-01");
        s.route = "GENERATE (FLF)";
        const markup = shotIntentControl(s);
        return { reading: (markup.match(/data-shot-intent-reading="([^"]*)"/) || [, ""])[1] };`);
      assert.strictEqual(reading.reading, "absent", "a shot with no declared route must declare no intent");
    },
  );

  /* NC-10 — WITHDRAWAL STORES A SENTINEL. Slice 5a deletes the key so a shot that never
     had an intent and one whose intent was withdrawn serialise identically; storing ""
     leaves a slot a later reader could mistake for a decision. */
  await mustFail(
    "NC-10 withdrawing an intent stores an empty value instead of deleting the key",
    "must DELETE the key",
    async () => {
      const page = await renderShot("flf", {
        mutateSource: replacing("creation-studio.js",
          "    const cleared = clearShotRoute(s);",
          '    const cleared = { ok: true, changed: true, reason: "" }; s.deliveryRoute = "";',
          "NC-10"),
      });
      const after = run(page.context, `
        setShotIntent("L1-01", "");
        const shot = P.shots.find((row) => row.id === "L1-01");
        return { hasKey: Object.prototype.hasOwnProperty.call(shot, "deliveryRoute") };`);
      assert.strictEqual(after.hasKey, false, "withdrawing an intent must DELETE the key, not store an empty one");
    },
  );

  /* NC-11 — THE WRITER BYPASSES THE SLICE 5a NORMALISER. Assigning the field directly is
     a second way to set it, and a second way to set it is a second normaliser: the value
     reaches the record without being canonicalised or refused. */
  await mustFail(
    "NC-11 the writer assigns the route field instead of declaring it",
    "must be written to shot.deliveryRoute",
    async () => {
      const page = await renderShot(undefined, {
        mutateSource: replacing("creation-studio.js",
          "  const declaration = declareShotRoute(s, raw);",
          '  s.deliveryRoute = raw; const declaration = { ok: true, changed: true, route: raw, reason: "" };',
          "NC-11"),
      });
      const stored = run(page.context, `
        setShotIntent("L1-01", "FLF");
        const shot = P.shots.find((row) => row.id === "L1-01");
        return { stored: shot.deliveryRoute };`);
      assert.strictEqual(stored.stored, "flf", "the canonical token must be written to shot.deliveryRoute");
    },
  );

  /* NC-12 — A CORRUPT RECORD SELECTS A ROUTE. The placeholder is disabled precisely so
     an unreadable value cannot read as "not decided yet" OR as any of the five; making
     it a real, choosable, selected option manufactures the intent Slice 5a refuses to. */
  await mustFail(
    "NC-12 an unreadable stored value selects a valid intent",
    "must not be choosable",
    async () => {
      const page = await renderShot("flf2", {
        mutateSource: replacing("creation-studio.js",
          '    ? `<option value="" disabled selected>${esc(SHOT_INTENT_UI_WORDS.unrecognised)}</option>`',
          '    ? `<option value="" selected>${esc(SHOT_INTENT_UI_WORDS.absent)}</option>`',
          "NC-12"),
      });
      const option = /<option value=""([^>]*)>/.exec(page.main);
      assert(option, "the control must render its placeholder");
      assert(/\bdisabled\b/.test(option[1]),
        "the selected option must not be choosable, so it cannot read as a decision");
    },
  );

  /* NC-13 — THE VISIBLE CHANGE STOPS BEING BOUNDED. Slice 5b is allowed to change the
     Shot Intent control and the Frames stage's own exposure and nothing else; a route
     token leaking into the command summary is a rendered surface changing for a reason
     the slice never declared. */
  await mustFail(
    "NC-13 a declared intent changes a rendered surface outside the control that declares it",
    "changed a rendered surface OUTSIDE the Shot Intent control",
    async () => {
      const hook = replacing("creation-studio.js",
        "<article><span>Open stage</span>",
        "<article><span>Intent</span><b>${esc(declaredShotRoute(s) || \"none\")}</b><small>declared route</small></article><article><span>Open stage</span>",
        "NC-13");
      const mask = (slots) => slots.replace(/<details class="shot-intent-control"[\s\S]*?<\/details>/g, "<<SHOT-INTENT>>");
      const unrouted = await renderShot(undefined, { mutateSource: hook });
      const routed = await renderShot("flf", { mutateSource: hook });
      assert.strictEqual(mask(routed.slots), mask(unrouted.slots),
        "declaring a route changed a rendered surface OUTSIDE the Shot Intent control");
    },
  );

  note(`  surface controls ran against a fixture whose Frames stage builds ${baseFrames.frames.length} frames`);
}

/* ===========================================================================
   THE EXECUTION GATE — stored is not executable.

   The defect review reproduced was not a wrong answer; it was a right answer nobody
   asked. The picker exempted the STORED selection from narrowing on purpose, and every
   boundary downstream took the exemption as permission. So each control below removes
   ONE of the four places the question is now asked, and requires the guard to notice.
   =========================================================================== */

const H3_T2V = "minimax-h3/t2v";
const BUILD_ROUTES = ["/api/prompt/compile", "/api/prompt/improve"];
const PAID_ROUTES = ["/api/generation/"];
const matching = (requests, needles) => requests.filter((url) => needles.some((needle) => url.includes(needle)));

async function excludedPage(options = {}) {
  const page = await renderShot("flf", options);
  vm.runInContext(`
    const __shot = P.shots[0];
    __shot.characters = [];
    __shot.codes = [];
    const __creation = ensureShotCreation(__shot);
    __creation.locationId = "";
    __creation.propIds = [];
    const __scan = SCAN?.shots?.["L1-01"];
    if (__scan) __scan.takes = (__shot.keyframes || []).filter((frame) => frame.winner)
      .map((frame) => ({ name: frame.winner, url: "/assets/shots/L1-01/takes/" + frame.winner }));
    globalThis.__requests = [];
    const __fetch = fetch;
    globalThis.fetch = (url, opts) => { __requests.push(String(url)); return __fetch(url, opts); };
    globalThis.falGenerationReady = () => true;
    globalThis.toast = () => {};
  `, page.context);
  const ready = run(page.context, `
    setGuidedMotionField("L1-01", "motionProfileId", ${JSON.stringify(H3_T2V)});
    const shot = P.shots.find((row) => row.id === "L1-01");
    const creation = ensureShotCreation(shot);
    creation.motionDirection = "He turns to the panel.";
    creation.motionPromptBuilds = [{ id: "stale-build", packageId: "P1", date: "2026-08-19T00:00:00.000Z",
      profileId: ${JSON.stringify(H3_T2V)}, prompt: "A compiled t2v prompt.", durationSeconds: 5, references: [] }];
    const unit = guidedActiveMotionUnit(shot);
    return { route: declaredShotRoute(shot), stored: (unit && unit.motionProfileId) || creation.motionProfileId || "" };`);
  assert.strictEqual(ready.route, "flf", "probe receipt: the page must really declare flf");
  assert.strictEqual(ready.stored, H3_T2V, "probe receipt: the page must really store the excluded target");
  return page;
}

async function executionControls() {
  /* NC-14 — THE DEFECT ITSELF, PUT BACK. The execution predicate exempts the stored
     selection exactly as the picker does, so "still selected" means "still runnable" and
     an excluded target compiles a package again. */
  await mustFail(
    "NC-14 the execution predicate exempts the stored selection, as the picker does",
    "must compile nothing",
    async () => {
      const page = await excludedPage({
        mutateSource: replacing("creation-studio.js",
          "function guidedMotionProfileExecutable(s, profile) {\n  const mode = guidedVideoProfileRouteKind(profile);",
          "function guidedMotionProfileExecutable(s, profile) {\n  if (profile && profile.id === ensureShotCreation(s).motionProfileId) return true;\n  const unit = guidedActiveMotionUnit(s);\n  if (profile && unit && profile.id === unit.motionProfileId) return true;\n  const mode = guidedVideoProfileRouteKind(profile);",
          "NC-14"),
      });
      const result = JSON.parse(await vm.runInContext(`(async () => {
        __requests.length = 0;
        try { await buildGuidedMotionPrompt("L1-01", false); } catch (error) {}
        return JSON.stringify({ requests: [...__requests] });
      })()`, page.context));
      assert.deepStrictEqual(matching(result.requests, [...BUILD_ROUTES, ...PAID_ROUTES]), [],
        `an excluded target must compile nothing, got ${JSON.stringify(result.requests)}`);
    },
  );

  /* NC-15 — THE PROMPT-CONSTRUCTION BOUNDARY IS REMOVED and only the disabled button is
     left. This is the control that proves a disabled control is not a gate: the button
     is still drawn disabled, and the handler still compiles when it is called. */
  await mustFail(
    "NC-15 the prompt builder trusts the disabled button instead of asking",
    "must compile nothing",
    async () => {
      const page = await excludedPage({
        mutateSource: replacing("creation-studio.js",
          "  const intentRefusal = guidedMotionIntentRefusal(s, profile);\n  if (intentRefusal) return toast(intentRefusal);\n  const unit = ensureGuidedMotionUnit(s, current?.name || \"\", profile);",
          "  const unit = ensureGuidedMotionUnit(s, current?.name || \"\", profile);",
          "NC-15"),
      });
      const result = JSON.parse(await vm.runInContext(`(async () => {
        const panel = guidedMotionPanel(P.shots.find((row) => row.id === "L1-01"), null, takesFor("L1-01"), true);
        __requests.length = 0;
        try { await buildGuidedMotionPrompt("L1-01", false); } catch (error) {}
        return JSON.stringify({ requests: [...__requests], stillDisabled: /class="assemble-btn"[^>]*disabled/.test(panel) });
      })()`, page.context));
      assert.strictEqual(result.stillDisabled, true,
        "probe receipt: the button must still LOOK blocked, or this control proves nothing about the gate");
      assert.deepStrictEqual(matching(result.requests, [...BUILD_ROUTES, ...PAID_ROUTES]), [],
        `an excluded target must compile nothing, got ${JSON.stringify(result.requests)}`);
    },
  );

  /* NC-16 — THE PAID-ACTION GATE IS REMOVED, so a package compiled before the intent
     changed draws the paid button again. This is the stale-build attack. */
  await mustFail(
    "NC-16 a stale package draws the paid button again",
    "must not draw the paid button",
    async () => {
      const page = await excludedPage({
        mutateSource: replacing("fal-generation.js",
          "  if (refusal)\n    return `<p class=\"prompt-check warn h3-generate-intent-blocked\" data-h3-intent-blocked=\"${attr(shotId)}\">${esc(refusal)}</p>`;\n",
          "",
          "NC-16"),
      });
      const markup = run(page.context, `
        const profile = guidedVideoProfiles().find((row) => row.id === ${JSON.stringify(H3_T2V)});
        return { action: falH3MotionPromptAction("L1-01", "stale-build", profile) };`).action;
      assert(!markup.includes("GENERATE H3 VIDEO"),
        "a package compiled before the intent changed must not draw the paid button");
    },
  );

  /* NC-17 — THE PAID DIALOG OPENS. Reached by a "Try again" chip or by a direct call,
     both of which bypass the rendered picker entirely. */
  await mustFail(
    "NC-17 the paid dialog opens for an excluded target",
    "must reach no generation endpoint",
    async () => {
      const page = await excludedPage({
        mutateSource: replacing("fal-generation.js",
          "  const intentRefusal = typeof guidedMotionIntentRefusal === \"function\" ? guidedMotionIntentRefusal(s, profile) : \"\";\n  if (intentRefusal) return toast(intentRefusal);\n",
          "",
          "NC-17"),
      });
      /* The ungated opener runs on into a plan fetch the harness cannot satisfy and
         throws somewhere downstream. That is not the finding — the finding is the
         request it made on the way — so the throw is swallowed and the assertion below
         is what has to fail. A control that failed on the crash instead would be firing
         for the wrong reason. */
      const result = JSON.parse(await vm.runInContext(`(async () => {
        __requests.length = 0;
        try { await openFalH3MotionModal("L1-01", "stale-build"); } catch (error) {}
        return JSON.stringify({ requests: [...__requests] });
      })()`, page.context));
      assert.deepStrictEqual(matching(result.requests, PAID_ROUTES), [],
        `an excluded target must reach no generation endpoint, got ${JSON.stringify(result.requests)}`);
    },
  );

  /* NC-18 — THE PAID POST ITSELF. A dialog opened while the intent still matched, left
     open, and submitted after it changed: the one path the three gates above cannot see. */
  await mustFail(
    "NC-18 a dialog opened before the intent changed can still submit",
    "must reach no generation endpoint",
    async () => {
      const page = await excludedPage({
        mutateSource: replacing("fal-generation.js",
          "  const gateRefusal = typeof guidedMotionIntentRefusal === \"function\" ? guidedMotionIntentRefusal(gateShot, gateProfile) : \"\";\n  if (gateRefusal) return toast(gateRefusal);\n",
          "",
          "NC-18"),
      });
      const result = JSON.parse(await vm.runInContext(`(async () => {
        document.getElementById("fal-h3-prompt-editor").value = "A compiled t2v prompt.";
        /* The dialog's own aspect control, filled the way an open dialog fills it. Left
           empty, falH3AspectGate() refuses on a missing format and the POST is never
           reached for a reason that has nothing to do with this control. */
        document.getElementById("fal-h3-aspect").value = "16:9";
        window._falH3Submitting = false;
        window._falH3MotionRequest = { shotId: "L1-01", buildId: "stale-build", profileId: ${JSON.stringify(H3_T2V)},
          profileMode: "t2v", prompt: "A compiled t2v prompt.", compiledPrompt: "A compiled t2v prompt.",
          durationSeconds: 5, clientRequestId: "nc-18" };
        __requests.length = 0;
        try { await startFalH3MotionGeneration(); } catch (error) {}
        return JSON.stringify({ requests: [...__requests] });
      })()`, page.context));
      assert.deepStrictEqual(matching(result.requests, PAID_ROUTES), [],
        `an excluded target must reach no generation endpoint, got ${JSON.stringify(result.requests)}`);
    },
  );

  /* NC-19 — THE GATE READS THE SCREEN. Compatibility decided from whether an `<option>`
     happens to be disabled is compatibility a page script can switch off. */
  await mustFail(
    "NC-19 the gate decides compatibility from the rendered option",
    "must compile nothing",
    async () => {
      const page = await excludedPage({
        mutateSource: replacing("creation-studio.js",
          "function guidedMotionProfileExecutable(s, profile) {\n  const mode = guidedVideoProfileRouteKind(profile);",
          "function guidedMotionProfileExecutable(s, profile) {\n  const node = typeof document !== \"undefined\" && document.getElementById(\"cinebraid-motion-target\");\n  if (node && node.dataset && node.dataset.enabled === \"1\") return true;\n  const mode = guidedVideoProfileRouteKind(profile);",
          "NC-19"),
      });
      const result = JSON.parse(await vm.runInContext(`(async () => {
        /* Exactly what a devtools console, a restored page or a stale render can do. */
        document.getElementById("cinebraid-motion-target").dataset.enabled = "1";
        __requests.length = 0;
        try { await buildGuidedMotionPrompt("L1-01", false); } catch (error) {}
        return JSON.stringify({ requests: [...__requests] });
      })()`, page.context));
      assert.deepStrictEqual(matching(result.requests, [...BUILD_ROUTES, ...PAID_ROUTES]), [],
        `an excluded target must compile nothing, got ${JSON.stringify(result.requests)}`);
    },
  );

  note("  execution controls ran against the reproduced case: stored " + H3_T2V + " under an flf intent");
}

/* =========================================================================== */

async function main() {
  await projectionControls();
  await surfaceControls();
  await executionControls();

  /* The suite's own honesty check: nothing on disk moved. */
  assert.strictEqual(readLF(INTENT_FILE), INTENT_SOURCE,
    "a control wrote to public/shared-shot-intent.js; every mutation must live in memory");

  console.log(`Shot intent UX negative controls passed: ${notes.filter((line) => line.includes("failed as required")).length} controls fired.`);
  for (const line of notes) console.log(line);
  console.log("  Every mutation lived in memory; nothing on disk was written.");
  console.log("  Paid calls: 0. Provider calls: 0. Off-site requests: 0.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
