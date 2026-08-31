/* Negative controls for tests/braidy-rail.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces ONE specific way Braidy could be wrong — IN MEMORY, by mutating a
 * copy of the shipped source — and then proves the matching assertion actually
 * notices. Nothing on disk is touched, so no control can be "restored" by a checkout
 * that also discards real work.
 *
 * EACH CONTROL CARRIES A PROBE RECEIPT. The mutation asserts the text it is replacing
 * was present at an exact occurrence count, so a control cannot quietly become a
 * no-op when the source is refactored and start "passing" against nothing.
 *
 * A MUTATION THAT BREAKS THE FILE PROVES NOTHING. If the mutated source throws
 * something other than an AssertionError, the control fails loudly and says so: that
 * is a broken edit, not a caught defect, and counting it as a detection is how a
 * harness starts scoring its own bugs as coverage.
 *
 * EVERY CONTROL BREAKS A DIFFERENT MECHANISM and names the check that has to fail.
 * Two controls that fire for the same reason prove one thing twice and nothing once.
 *
 * NO MODEL IS CALLED, NO SERVER IS STARTED, NO PROJECT IS READ.
 */

const assert = require("assert");

const suite = require("./braidy-rail.js");
const { SOURCES } = suite;

const notes = [];
const note = (line) => notes.push(line);

function mutate(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

const EXERCISED = new Set();
let CONTROL_COUNT = 0;

async function control(label, checkName, patch, expectation) {
  CONTROL_COUNT += 1;
  EXERCISED.add(checkName);
  assert.strictEqual(typeof suite[checkName], "function",
    `${label} names ${checkName}, which tests/braidy-rail.js does not export`);
  const sources = { ...SOURCES, ...patch };
  let failed = false;
  let message = "";
  try {
    await suite[checkName](sources);
  } catch (error) {
    if (error instanceof assert.AssertionError) {
      failed = true;
      message = String(error.message).split("\n")[0];
    } else {
      throw new Error(`${label}: ${checkName} threw ${error.name} instead of failing an assertion — the mutation broke the module rather than the property.\n${error.stack}`);
    }
  }
  assert.ok(failed, `${label}: ${checkName} accepted the broken build. ${expectation}`);
  note(`  ${label} — ${checkName}: ${message}`);
  return message;
}

/* ===========================================================================
   THE RAIL'S ROLE. The failure that costs the most, because a second Activity feed
   looks like a feature until two surfaces disagree about a cost.
   =========================================================================== */

async function railRoleControls() {
  note("The rail is Braidy and not a second Activity feed:");

  await control("C1 Braidy prints the Terminal's cost column", "checkRailIsBraidyNotActivity",
    { rail: mutate(SOURCES.rail,
        `      + `.concat('`<span class="cb-braidy-id"><b>Braidy</b>'),
        `      + `.concat('`<span class="cb-braidy-cost">COST $0.00</span><span class="cb-braidy-id"><b>Braidy</b>'),
        "C1") },
    "A production would have two places to read a cost from, and one of them would be a narration surface with no ledger behind it.");

  await control("C2 Braidy reaches for the run list to narrate it", "checkRailIsBraidyNotActivity",
    { rail: mutate(SOURCES.rail,
        "  function agentStatus() {",
        "  function runRows() { return typeof AUTOMATION_RUNS === \"undefined\" ? [] : AUTOMATION_RUNS; }\n  function agentStatus() {",
        "C2") },
    "Braidy would become a second enumerator of activity, free to bucket a run differently from the Terminal that owns it.");

  await control("C3 Braidy is appended under the status sections instead of above them", "checkRailIsBraidyNotActivity",
    { surfaces: mutate(SOURCES.surfaces,
        "      + braidyBlock()\n      + `<header class=\"cb-assistant-head\">",
        "      + `<header class=\"cb-assistant-head\">",
        "C3").replace(
        "      + `<button type=\"button\" class=\"cb-assistant-action\" onclick=\"openGlobalAutomationActivity()\">Open activity details</button></footer></div>`;",
        "      + braidyBlock()\n      + `<button type=\"button\" class=\"cb-assistant-action\" onclick=\"openGlobalAutomationActivity()\">Open activity details</button></footer></div>`;") },
    "Opening the rail to ask something would begin with a status list, which is the arrangement that made the Assistant read as a duplicate Activity in the first place.");

  await control("C3b the composer is only rendered when Braidy has something to say", "checkRailIsBraidyNotActivity",
    { rail: mutate(SOURCES.rail,
        "      + `<div class=\"cb-braidy-compose\">`",
        "      + `${THREAD.length ? \"\" : \"<hr>\"}<div class=\"cb-braidy-compose\">`",
        "C3b") },
    "The element sequence would change with state, and the reconciler — which patches by POSITION — would replace the composer on the next activity repaint, taking a half-typed question with it.");
}

/* ===========================================================================
   THE FACTS. Read-only is the whole reason handing them over is safe.
   =========================================================================== */

async function factControls() {
  note("The deterministic facts are read-only context:");

  /* The freeze is the OUTER one, so this shadows it for the length of braidyHandoff
     rather than deleting a line. The handoff object itself is still frozen — which is
     the point: the control has to reach past the assertion that would have caught a
     cruder break, and land on the nested facts nobody would notice. */
  await control("C4 the handoff freezes itself but not the facts inside it", "checkFactsAreReadOnlyContext",
    { contract: mutate(SOURCES.contract,
        "  function braidyHandoff(input = {}) {\n    const intent = braidyText(input.intent);",
        "  function braidyHandoff(input = {}) {\n    const deepFreeze = Object.freeze;\n    const intent = braidyText(input.intent);",
        "C4") },
    "An interpretation would be able to edit its own evidence, which is the one thing that makes handing CineBraid's answers over unsafe.");

  await control("C5 the handoff keeps the caller's object instead of copying it", "checkFactsAreReadOnlyContext",
    { contract: mutate(SOURCES.contract,
        "  function braidyFacts(input) {\n    const facts = {};\n    if (!input || typeof input !== \"object\") return facts;",
        "  function braidyFacts(input) {\n    const facts = input && typeof input === \"object\" ? input : {};\n    if (!input || typeof input !== \"object\") return facts;",
        "C5") },
    "A caller mutating its own object after handing it over would silently change what Braidy was told, and the two would never be compared.");

  await control("C6 the facts stop being given to the model at all", "checkFactsAreReadOnlyContext",
    { contract: mutate(SOURCES.contract,
        "    if (Object.keys(handoff.facts || {}).length)\n      lines.push(`What CineBraid already knows, which you may rely on and must not contradict: ${JSON.stringify(handoff.facts)}`);",
        "    if (false)\n      lines.push(`What CineBraid already knows, which you may rely on and must not contradict: ${JSON.stringify(handoff.facts)}`);",
        "C6") },
    "Braidy would be answering about a shot it had been told nothing about, which is guessing with a citation format.");
}

/* ===========================================================================
   AUTHORITY. The line the whole slice exists to hold.
   =========================================================================== */

async function authorityControls() {
  note("An advisory result does not become production truth:");

  await control("C7 a model's answer is stamped deterministic", "checkAdvisoryIsNotProductionTruth",
    { contract: mutate(SOURCES.contract,
        "      kind: \"advisory\",\n      authority: \"advisory\",",
        "      kind: \"advisory\",\n      authority: \"deterministic\",",
        "C7") },
    "Every downstream reader that checks authority would treat a sentence as an established fact.");

  await control("C8 a requirement can be made without a deterministic source", "checkAdvisoryIsNotProductionTruth",
    { contract: mutate(SOURCES.contract,
        "    if (!source)\n      throw new Error(\"A Braidy requirement needs the deterministic source that established it.\");",
        "    if (false)\n      throw new Error(\"A Braidy requirement needs the deterministic source that established it.\");",
        "C8") },
    "Prose could invent a blocker, and an invented blocker is indistinguishable on screen from a real one.");

  await control("C9 the rail gains a paid control", "checkAdvisoryIsNotProductionTruth",
    { rail: mutate(SOURCES.rail,
        "  function actionsMarkup(actions) {",
        "  function generateNow(shotId) { return openFalGenerationModal(\"frame\", shotId, \"\"); }\n  function actionsMarkup(actions) {",
        "C9") },
    "A surface whose whole claim is that it only advises would be able to spend money.");

  await control("C10 Braidy grows a second assistant backend", "checkAdvisoryIsNotProductionTruth",
    { rail: mutate(SOURCES.rail,
        "      const response = await fetch(\"/api/project/ask\", {",
        "      await fetch(\"/api/braidy/chat\", { method: \"POST\" });\n      const response = await fetch(\"/api/project/ask\", {",
        "C10") },
    "A second orchestration is the thing this slice was told not to build; it would also be a request nothing in Settings governs.");
}

/* ===========================================================================
   THE HANDOFF'S DESTINATION.
   =========================================================================== */

async function handoffControls() {
  note("A contextual action resolves back to the exact owning task:");

  await control("C11 the stage control reads the live route instead of the handoff", "checkActionResolvesToOwningTask",
    { contract: mutate(SOURCES.contract,
        "      call: (target, stageId) => `selectBoundedTask('shot-task','${target.id}','${stageId}')`,",
        "      call: (target, stageId) => `selectBoundedTask('shot-task',String(location.hash).split('/')[2],'${stageId}')`,",
        "C11") },
    "The control would open whatever the filmmaker had navigated to since asking, not the shot the answer is about.");

  await control("C12 an unsatisfiable destination is rendered against a missing step", "checkActionResolvesToOwningTask",
    { contract: mutate(SOURCES.contract,
        "      if (action.needsStage && !handoff.stageId) continue;",
        "      if (false) continue;",
        "C12") },
    "A control would call the shipped task selector with an empty step id, which is a click that goes nowhere and reads as a broken product.");

  await control("C12b the seed handoff is cached on the first paint", "checkActionResolvesToOwningTask",
    { rail: mutate(SOURCES.rail,
        "  function activeHandoff() {\n    const seed = routeSeed();",
        "  let SEED = null;\n  function activeHandoff() {\n    if (SEED) return HANDOFF || SEED;\n    const seed = routeSeed();\n    SEED = seedHandoff();",
        "C12b") },
    "Every question after the first would be answered about the shot the filmmaker happened to be on when the rail first painted, with nothing on screen saying so.");

  await control("C12c the handoff is offered with nothing behind it to answer", "checkActionResolvesToOwningTask",
    { surfaces: mutate(SOURCES.surfaces,
        "    try { if (typeof braidy.capability === \"function\" && !braidy.capability().available) return \"\"; } catch { return \"\"; }",
        "",
        "C12c") },
    "The only outcome of clicking it would be the assistant refusing, in a rail that has already said in its own words what is missing.");

  await control("C13 the rail's stage handoff composes its own reason instead of O1's", "checkActionResolvesToOwningTask",
    { surfaces: mutate(SOURCES.surfaces,
        "        blockedReason: stage.blockedReason || \"\",",
        "        why: stage.blockedReason || \"\",",
        "C13") },
    "Braidy would be handed a differently-named fact, and the one thing the handoff exists to guarantee — that Braidy reads CineBraid's own words — would be unverifiable.");
}

/* ===========================================================================
   QUALIFICATION.
   =========================================================================== */

async function qualificationControls() {
  note("No qualified-champion claim exists while the standing is none:");

  await control("C14 reachability is read as qualification", "checkNoQualifiedChampionClaim",
    { contract: mutate(SOURCES.contract,
        "    const qualified = !!champion && standing === \"qualified\" && !!model && model === champion;",
        "    const qualified = available;",
        "C14") },
    "An endpoint answering would be presented as a model that passed a frozen product gate — the exact claim the current research standing forbids.");

  await control("C15 the shipped record quietly names a champion", "checkNoQualifiedChampionClaim",
    { contract: mutate(SOURCES.contract,
        "    champion: null,\n    standing: \"none\",",
        "    champion: \"qwen3.6:35b-a3b\",\n    standing: \"qualified\",",
        "C15") },
    "A research control would become the product's champion by edit rather than by evaluation, which is how a lab result ships as a promise.");

  await control("C15b the standing is stamped on the element but never said out loud", "checkNoQualifiedChampionClaim",
    { rail: mutate(SOURCES.rail,
        "        + `${cap.note ? `<p>${esc_(cap.note)}</p>` : \"\"}</article>`;",
        "        + `</article>`;",
        "C15b") },
    "The filmmaker would see nothing telling them the assistant answering is their own and not a certified one; a data attribute is a fact for a suite, not a disclosure for a person.");

  await control("C16 any champion qualifies whatever model is configured", "checkNoQualifiedChampionClaim",
    { contract: mutate(SOURCES.contract,
        "    const qualified = !!champion && standing === \"qualified\" && !!model && model === champion;",
        "    const qualified = !!champion && standing === \"qualified\";",
        "C16") },
    "A qualification earned by one model would be claimed on behalf of every other, which is worse than claiming nothing.");
}

/* ===========================================================================
   THE EXISTING CONFIGURED ASSISTANT.
   =========================================================================== */

async function configuredControls() {
  note("An existing configured assistant is neither broken nor relabelled:");

  await control("C17 a working assistant is disabled for want of a champion", "checkConfiguredAssistantIsNotRelabelled",
    { contract: mutate(SOURCES.contract,
        "    const available = !!capability.ready;",
        "    const available = !!capability.ready && !!(qualification && qualification.champion);",
        "C17") },
    "Working functionality a filmmaker configured themselves would stop, on the grounds that CineBraid has not yet certified anything — a regression dressed as caution.");

  await control("C18 Braidy restates the capability message in its own words", "checkConfiguredAssistantIsNotRelabelled",
    { contract: mutate(SOURCES.contract,
        "      message: braidyText(capability.message),",
        "      message: capability.ready ? \"\" : \"Braidy is unavailable.\",",
        "C18") },
    "The precise, actionable diagnosis CineBraid already produces would be replaced by a vaguer one, and the filmmaker would lose the instruction that fixes it.");
}

/* ===========================================================================
   PRESENTATION.
   =========================================================================== */

async function presentationControls() {
  note("The presence follows the request and settles back:");

  await control("C19 a stale failure outranks a live request", "checkProcessingAnimationFollowsRequest",
    { contract: mutate(SOURCES.contract,
        "      if (tokens.pending) return { state: \"thinking\", reason: \"pending\" };\n      if (tokens.failed) return { state: \"attention\", reason: \"failed\" };",
        "      if (tokens.failed) return { state: \"attention\", reason: \"failed\" };\n      if (tokens.pending) return { state: \"thinking\", reason: \"pending\" };",
        "C19") },
    "A question that is genuinely running would be drawn as a previous failure, which is the reading that makes somebody ask it again.");

  await control("C20 the acknowledge pose never expires", "checkResponseSettlesBack",
    { rail: mutate(SOURCES.rail,
        "    ACKNOWLEDGE_UNTIL = Date.now() + ACKNOWLEDGE_MS;",
        "    ACKNOWLEDGE_UNTIL = Date.now() + 1e12;",
        "C20") },
    "A one-shot response would become a permanent pose, which is exactly the perpetual movement the presentation vocabulary exists to avoid.");

  /* The REFUSAL path only. Deleting the shared `PENDING = null` would break the
     success path too and be caught by the wrong assertion, which would leave the
     refusal branch itself still unwatched. */
  await control("C21 a refused request stays pending", "checkResponseSettlesBack",
    { rail: mutate(SOURCES.rail,
        "    if (failure) {\n      FAILURE = failure;",
        "    if (failure) {\n      PENDING = { id, controller, intent: handoff.intent };\n      FAILURE = failure;",
        "C21") },
    "Braidy would think forever about a question that had already been refused, and the send control would stay disabled with it.");

  await control("C22 reduced motion changes the state instead of the movement", "checkReducedMotion",
    { contract: mutate(SOURCES.contract,
        "    const decided = decide();",
        "    const decided = reducedMotion ? { state: \"idle\", reason: \"idle\" } : decide();",
        "C22") },
    "A reader who asked for less movement would be told less truth: a running request would be drawn as idle.");

  await control("C23 the acknowledge animation loops", "checkReducedMotion",
    { styles: mutate(SOURCES.styles,
        ".cb-braidy[data-braidy-state=\"acknowledge\"] .cb-braidy-presence{animation:cb-braidy-ack .42s ease-out 1}",
        ".cb-braidy[data-braidy-state=\"acknowledge\"] .cb-braidy-presence{animation:cb-braidy-ack .42s ease-out infinite}",
        "C23") },
    "A mascot bouncing continuously beside the work is the failure mode the brief named first.");
}

/* ===========================================================================
   STALENESS.
   =========================================================================== */

async function stalenessControls() {
  note("A stale or closed request cannot leave Braidy thinking:");

  await control("C24 a superseded response is allowed to settle", "checkStaleRequestCannotStick",
    { rail: mutate(SOURCES.rail,
        "    if (id !== SEQUENCE) return null;",
        "    if (false) return null;",
        "C24") },
    "The answer to a question the filmmaker had already replaced would appear as the answer to the one they are waiting for.");

  await control("C25 aborting leaves the pending flag set", "checkStaleRequestCannotStick",
    { rail: mutate(SOURCES.rail,
        "    SEQUENCE += 1;\n    try { PENDING.controller.abort(); } catch {}\n    PENDING = null;",
        "    SEQUENCE += 1;\n    try { PENDING.controller.abort(); } catch {}",
        "C25") },
    "Braidy would be thinking about a question that had been cancelled, permanently, with nothing left able to clear it.");

  /* The two halves of the project-switch guard, separately. A conversation that
     survives a switch and a subscription that can never fire are different defects
     with the same symptom, and one control cannot tell them apart. */
  await control("C26a a conversation survives a switch to another production", "checkStaleRequestCannotStick",
    { rail: mutate(SOURCES.rail,
        "    if (slug === PROJECT_KEY) return;\n    PROJECT_KEY = slug;\n    reset();",
        "    if (slug === PROJECT_KEY) return;\n    PROJECT_KEY = slug;",
        "C26a") },
    "Braidy would keep answering about shots the open production does not have, in a rail that looks like it is describing the current one.");

  await control("C26b the project guard subscribes to an event nothing dispatches", "checkStaleRequestCannotStick",
    { rail: mutate(SOURCES.rail,
        "  window.addEventListener(\"cinebraid:workspace-updated\", syncProject);\n  window.addEventListener(\"cinebraid:route-rendered\", syncProject);",
        "  window.addEventListener(\"cinebraid:project-changed\", syncProject);",
        "C26b") },
    "The guard would read as present in the source and never run once — the exact defect this listener replaced, and the reason it is asserted against the events CineBraid actually emits.");

  await control("C26 closing the rail stops aborting the outstanding question", "checkStaleRequestCannotStick",
    { surfaces: mutate(SOURCES.surfaces,
        "    if (!open) { braidySignal(\"abort\", \"That question was stopped when the rail was closed.\"); closeRailMount(); }",
        "    if (!open) closeRailMount();",
        "C26") },
    "A request would keep running behind a surface nobody can see and settle onto a rail that is no longer mounted.");
}

/* ===========================================================================
   ACTION MINTING.
   =========================================================================== */

async function mintingControls() {
  note("A model cannot mint an executable action:");

  await control("C27 the response becomes an input to the controls", "checkModelCannotMintAnAction",
    { contract: mutate(SOURCES.contract,
        "  function braidyOfferedActions(handoff) {\n    if (!handoff || !Array.isArray(handoff.destinations)) return deepFreeze([]);\n    const offered = [];\n    for (const destination of handoff.destinations) {",
        "  function braidyOfferedActions(handoff, response) {\n    if (!handoff || !Array.isArray(handoff.destinations)) return deepFreeze([]);\n    const offered = [];\n    const asked = response && typeof response === \"string\" ? (/\"actionId\":\"([a-z-]+)\"/.exec(response) || [])[1] : \"\";\n    for (const destination of [...handoff.destinations, asked].filter(Boolean)) {",
        "C27") },
    "Free-form prose would be able to name a control, which is the whole shape of a prompt-injection into the interface.");

  await control("C28 the action table is consulted through the prototype chain", "checkModelCannotMintAnAction",
    { contract: mutate(SOURCES.contract,
        "    return Object.prototype.hasOwnProperty.call(BRAIDY_ACTIONS, key) ? BRAIDY_ACTIONS[key] : null;",
        "    return BRAIDY_ACTIONS[key] || null;",
        "C28") },
    "Every method on Object.prototype would resolve to something, and \"constructor\" would resolve to a function.");

  await control("C29 an unsafe id is escaped instead of refused", "checkModelCannotMintAnAction",
    { contract: mutate(SOURCES.contract,
        "    return id && BRAIDY_ID_PATTERN.test(id) ? id : \"\";",
        "    return id.replace(/'/g, \"\");",
        "C29") },
    "CineBraid would be deciding how to encode an id it never minted, which is how an injection seam is built one repair at a time.");
}

/* ===========================================================================
   OPTIONALITY, COMPACTION, REGISTER, BACKEND.
   =========================================================================== */

async function remainingControls() {
  note("Braidy is optional, compact by layout, plainly spoken and singular:");

  await control("C30 a failing Braidy takes the deterministic rail down with it", "checkBraidyIsNotAGate",
    { surfaces: mutate(SOURCES.surfaces,
        "    try { return braidy.railMarkup(); } catch { return \"\"; }",
        "    return braidy.railMarkup();",
        "C30") },
    "An assistant nobody is required to use would be able to stop the rail that works without it — the definition of a gate.");

  /* Not a source mutation but a TREE mutation: one production file that has learned
     Braidy exists. That is how the optionality is actually lost — not by the rail
     changing, but by a generation or review path acquiring a reference and, one repair
     later, a dependency. */
  await control("C30b a production path learns that Braidy exists", "checkBraidyIsNotAGate",
    { clientFiles: { ...suite.readClientFiles(), "creation-studio.js": "if (window.CineBraidBraidy) blockGeneration();" } },
    "A shot workflow that can see Braidy is a shot workflow that can come to need it, and the whole claim that Braidy is optional rests on none of them being able to.");

  await control("C31 the compact register truncates instead of splitting", "checkCompactionIsNotTruncation",
    { contract: mutate(SOURCES.contract,
        "    const rest = paragraphs.slice(lead.length);",
        "    const rest = [];",
        "C31") },
    "A legitimately long answer would be silently cut, and the filmmaker would act on half of what Braidy said.");

  await control("C32 the first paragraph is cut to fit the budget", "checkCompactionIsNotTruncation",
    { contract: mutate(SOURCES.contract,
        "      if (lead.length && words + next > budget) break;",
        "      if (words + next > budget) break;",
        "C32") },
    "An answer whose first paragraph is over the register would render as nothing at all, which reads as a broken assistant rather than a long one.");

  await control("C33 stock authority boilerplate returns to the instruction", "checkRecommendationVersusRequirement",
    { contract: mutate(SOURCES.contract,
        "Say plainly when a choice is the filmmaker's, without using stock phrases for it.",
        "Say 'that is a filmmaker decision' whenever a choice is not yours.",
        "C33") },
    "The phrase becomes a tic, and a tic stops carrying the meaning it was added for.");

  await control("C34 the rail is coupled to a specific model", "checkNoSecondBackend",
    { rail: mutate(SOURCES.rail,
        "  const INPUT_ID = \"cb-braidy-input\";",
        "  const INPUT_ID = \"cb-braidy-input\";\n  const PREFERRED_MODEL = \"qwen3.6:35b-a3b\";",
        "C34") },
    "The interface would start depending on a runtime and a quantization rather than on a declared capability, which is what makes the capability seam replaceable.");
}

/* ---------------------------------------------------------------------------
   RUN. */

async function runAll() {
  await railRoleControls();
  await factControls();
  await authorityControls();
  await handoffControls();
  await qualificationControls();
  await configuredControls();
  await presentationControls();
  await stalenessControls();
  await mintingControls();
  await remainingControls();

  /* EVERY CHECK THE MAIN SUITE PUBLISHES MUST HAVE BEEN WATCHED FAIL. A check with no
     control is a check nobody has seen do anything. */
  const published = Object.keys(suite).filter((name) => name.startsWith("check"));
  const unexercised = published.filter((name) => !EXERCISED.has(name));
  assert.deepStrictEqual(unexercised, [],
    `these checks have no negative control and have never been observed to fail: ${unexercised.join(", ")}`);

  return { notes, count: CONTROL_COUNT, published: published.length };
}

module.exports = { runAll, mutate, control };

if (require.main === module) {
  runAll()
    .then(({ notes: lines, count, published }) => {
      for (const line of lines) console.log(line);
      console.log(`Braidy rail negative controls passed: ${count} mutations, each landed on the live path and each caught by the check that owns it; all ${published} published checks exercised.`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
