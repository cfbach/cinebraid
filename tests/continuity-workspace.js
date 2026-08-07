/* CineBraid declared-entity continuity — the shot workspace (Phase 4).

   Two questions, in order:

   1. Does the shared core turn engine findings into the five words a user
      reads, without the browser deciding anything? Everything in part one is
      pure and needs no DOM.

   2. Does the workspace render those words, gate on the right capability,
      persist what a user declares, and refuse to dress an analysis failure up
      as a continuity verdict? Part two renders the real client through the
      render harness against a stubbed continuity route.

   Offline throughout. No provider, no network, no model, and the real
   projects/ and data/ folders are never read or written. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");
const Continuity = require("../public/shared-continuity");

const ROOT = path.join(__dirname, "..");
const evaluate = (rendered, expression) => vm.runInContext(expression, rendered.context);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const pass = (line) => results.push(line);

/* ====================================================================
   PART ONE — presentation semantics, pure
   ==================================================================== */

const MANIFEST = {
  entities: [
    { entity_id: "CHAR-KAI", display_name: "Kai", entity_type: "character" },
    { entity_id: "PROP-MUG", display_name: "Enamel mug", entity_type: "prop" },
    { entity_id: "PROP-WATCH", display_name: "Wristwatch", entity_type: "prop" },
    { entity_id: "LOC-BRIDGE", display_name: "Bridge", entity_type: "location" },
    { entity_id: "VEH-CART", display_name: "Maintenance cart", entity_type: "vehicle" },
  ],
};
function emptyComparison(patch = {}) {
  return { changes: [], uncertain: [], shade_drift: [], attribute_unreadable: [], presence_uncertain: [], invalid_records: [], ...patch };
}

/* A comparison carrying one of each outcome, so the vocabulary is exercised
   end to end rather than one class at a time. */
const FIVE_OUTCOMES = emptyComparison({
  changes: [
    { entity_id: "PROP-MUG", kind: "removed", attribute: "presence", value_a: "present", value_b: "absent", display_name: "Enamel mug", label: "possible-continuity-error", intentSource: null, intentReason: "" },
    { entity_id: "CHAR-KAI", kind: "attribute", attribute: "state", value_a: "Jacket on", value_b: "Jacket removed", display_name: "Kai", label: "intended", intentSource: "declared-state-change", intentReason: 'Declared state changed from "Jacket on" to "Jacket removed".' },
  ],
  uncertain: [{ entity_id: "VEH-CART", kind: "occlusion-transition", value_a: "none", value_b: "partial", display_name: "Maintenance cart" }],
  attribute_unreadable: [{ entity_id: "PROP-WATCH", kind: "attribute-unreadable", attribute: "color", value_a: "silver", value_b: "uncertain", display_name: "Wristwatch" }],
});

{
  const described = Continuity.describeComparison(FIVE_OUTCOMES, MANIFEST, { frameALabel: "Frame A", frameBLabel: "Frame B" });
  const byId = Object.fromEntries(described.entities.map((row) => [row.entityId, row]));
  assert.strictEqual(byId["PROP-MUG"].outcome, "issue", "an undeclared presence loss is an issue");
  assert.strictEqual(byId["CHAR-KAI"].outcome, "expected", "a change matching a declared state is expected");
  assert.strictEqual(byId["VEH-CART"].outcome, "uncertain", "an occlusion transition is inconclusive, not a break");
  assert.strictEqual(byId["PROP-WATCH"].outcome, "review", "an unreadable tracked attribute needs a person");
  assert.strictEqual(byId["LOC-BRIDGE"].outcome, "stable", "an entity with no findings is stable");
  assert.deepStrictEqual(described.counts, { stable: 1, issue: 1, expected: 1, uncertain: 1, review: 1 }, "every outcome must be counted exactly once");
  pass("five outcomes: issue / expected / uncertain / review / stable resolve from one comparison");

  /* An expected finding is relabelled, never removed: showing that CineBraid
     noticed the change and knew it was intended is the whole point. */
  const kai = byId["CHAR-KAI"].findings[0];
  assert.strictEqual(kai.class, "expected");
  assert(kai.reason.includes("Declared state changed"), "an expected finding must say why it is expected");
  assert.strictEqual(kai.canMarkExpected, false, "an already-expected finding offers no declaration");
  assert.strictEqual(byId["CHAR-KAI"].findings.length, 1, "an expected change stays visible as its own finding");
  pass("expected findings stay visible and carry the reason they were expected");

  /* Human review must never be able to read as a hard failure. */
  for (const id of ["PROP-WATCH", "VEH-CART"]) {
    for (const finding of byId[id].findings) {
      assert.notStrictEqual(finding.class, "issue", `${id} must not be classed as an issue`);
      assert.strictEqual(finding.severity, "", `${id} must carry no severity — severity belongs to real breaks`);
      assert.strictEqual(finding.canMarkExpected, false, `${id} must never offer MARK EXPECTED`);
      assert.strictEqual(finding.expectedAction, null, `${id} must carry no declaration action`);
    }
  }
  pass("review and uncertain findings carry no severity and can never be declared expected");
}

/* Every deterministic bucket that is not a change must be unmarkable — that is
   what stops a declaration silently clearing unusable evidence. */
{
  const unusable = emptyComparison({
    uncertain: [
      { entity_id: "CHAR-KAI", kind: "identifiability", value_a: "yes", value_b: "no", display_name: "Kai" },
      { entity_id: "PROP-MUG", kind: "size", ratio: 0.4, display_name: "Enamel mug" },
      { entity_id: "LOC-BRIDGE", kind: "missing-record", display_name: "Bridge" },
    ],
    presence_uncertain: [{ entity_id: "VEH-CART", kind: "presence-uncertain", value_a: "uncertain", value_b: "present", display_name: "Maintenance cart" }],
    invalid_records: [{ entity_id: "PROP-WATCH", kind: "entity-record-invalid", state_a: "invalid", state_b: "present", display_name: "Wristwatch" }],
    shade_drift: [{ entity_id: "PROP-MUG", kind: "shade-drift", attribute: "color", value_a: "white", value_b: "cream", display_name: "Enamel mug" }],
  });
  const described = Continuity.describeComparison(unusable, MANIFEST);
  for (const row of described.entities)
    for (const finding of row.findings)
      assert.strictEqual(finding.canMarkExpected, false, `${finding.type} must not be declarable as intentional`);
  const byId = Object.fromEntries(described.entities.map((row) => [row.entityId, row]));
  assert.strictEqual(byId["PROP-WATCH"].outcome, "review", "an invalid record needs a person");
  assert.strictEqual(byId["LOC-BRIDGE"].outcome, "review", "a record present on only one frame needs a person");
  assert.strictEqual(byId["VEH-CART"].outcome, "review", "an uncertain presence needs a person");
  assert.strictEqual(byId["CHAR-KAI"].outcome, "uncertain", "an unidentifiable reading is inconclusive");
  assert.strictEqual(byId["PROP-MUG"].outcome, "uncertain", "shade drift and a size swing are inconclusive, never a break");
  pass("no unreadable, uncertain, missing or invalid finding can be declared intentional");
}

/* A near-miss note is a change, but an unresolved human question. */
{
  const nearMiss = emptyComparison({
    changes: [{ entity_id: "PROP-MUG", kind: "removed", attribute: "presence", value_a: "present", value_b: "absent", display_name: "Enamel mug", label: "possible-continuity-error", intentSource: "near-miss", intentReason: 'An expected change mentions this entity but does not describe this kind of change: "the mug is repainted".' }],
  });
  const row = Continuity.describeComparison(nearMiss, MANIFEST).entities.find((item) => item.entityId === "PROP-MUG");
  assert.strictEqual(row.outcome, "review", "a near-miss note must force review rather than pass or fail quietly");
  assert(row.findings[0].reason.includes("does not describe this kind of change"), "a near-miss must explain itself");
  pass("a near-miss intent note routes the entity to review and says why");
}

/* The declaration a MARK EXPECTED writes is chosen by the shared core, so the
   button and the writer can never disagree about what it means. */
{
  const cases = [
    [{ entity_id: "E", kind: "removed", attribute: "presence" }, { target: "intent", field: "allowPresenceChange", value: "may-leave" }],
    [{ entity_id: "E", kind: "added", attribute: "presence" }, { target: "intent", field: "allowPresenceChange", value: "may-enter" }],
    [{ entity_id: "E", kind: "moved", attribute: "centre_displacement" }, { target: "intent", field: "allowMovement", value: true }],
    [{ entity_id: "E", kind: "attribute", attribute: "color" }, { target: "intent", field: "allowColorChange", value: true }],
    [{ entity_id: "E", kind: "attribute", attribute: "state" }, { target: "intent", field: "allowStateChange", value: true }],
    /* Markings has no allowance in the Phase 1 intent contract, so it falls to
       the per-finding human record rather than to an invented catch-all. */
    [{ entity_id: "E", kind: "attribute", attribute: "markings" }, { target: "accepted", field: "E:attribute:markings", value: true }],
  ];
  for (const [finding, expected] of cases)
    assert.deepStrictEqual(Continuity.expectedActionFor(finding), expected, `wrong declaration for ${finding.kind}/${finding.attribute}`);
  pass("MARK EXPECTED maps every change to its structured declaration, and markings to the scoped human record");
}

/* The declaration must actually reclassify through the real engine. */
{
  const manifest = { entities: [{ entity_id: "PROP-MUG", display_name: "Enamel mug", entity_type: "prop", track_presence: true, track_movement: true, track_color: false, track_state: true, track_markings: false }] };
  const raw = emptyComparison({ changes: [{ entity_id: "PROP-MUG", kind: "removed", attribute: "presence", value_a: "present", value_b: "absent", display_name: "Enamel mug" }] });
  const before = Continuity.describeComparison(Continuity.applyIntent(raw, { shot: {}, manifestA: manifest, manifestB: manifest }), manifest);
  assert.strictEqual(before.entities[0].outcome, "issue");
  const action = Continuity.expectedActionFor({ entity_id: "PROP-MUG", kind: "removed", attribute: "presence" });
  const shot = { continuityIntent: { "PROP-MUG": { [action.field]: action.value } } };
  const after = Continuity.describeComparison(Continuity.applyIntent(raw, { shot, manifestA: manifest, manifestB: manifest }), manifest);
  assert.strictEqual(after.entities[0].outcome, "expected", "the declaration MARK EXPECTED writes must reclassify the finding");
  assert.strictEqual(after.entities[0].findings.length, 1, "the finding stays on screen after being declared expected");
  pass("a declaration written by MARK EXPECTED reclassifies deterministically through the real engine");
}

/* Nothing user-facing may be assembled from a validation flag code. */
{
  const source = fs.readFileSync(path.join(ROOT, "public", "continuity-workspace.js"), "utf8");
  for (const flag of Continuity.OBSERVATION_FLAGS)
    assert(!source.includes(flag), `the workspace must not branch on the validation flag "${flag}"`);
  for (const token of ["coordinate_mode", "bbox", "permille", "blockingFlags", "recordState"])
    assert(!source.includes(token), `the workspace must not read contract internals ("${token}")`);
  assert(source.includes("validation") === false || !/validation\.(flags|states)/.test(source), "the workspace must not read raw validation flags or states");
  pass("the workspace source names no validation flag, coordinate mode, bbox or contract internal");
}

/* ====================================================================
   PART TWO — the rendered workspace
   ==================================================================== */

async function main() {

const FRAMES_STORAGE = { "cinebraid-focused:fixture:shot-task:L1-01": "frames" };

function workspaceFixture() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.creationBrief = { locationId: "LOC-HULL", propIds: ["PR-TOOL"], vehicleIds: ["VEH-CART"], frameWorkflows: {} };
  const states = (name) => [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "", notes: "Primary approved reference." },
    { id: "state-alt", name: name, isDefault: false, parentStateId: "state-default", approvedFile: "", notes: `${name}.` },
  ];
  project.characters[0].continuityStates = states("Jacket removed");
  project.props[0].continuityStates = states("Damaged");
  project.vehicles[0].continuityStates = states("Muddy");
  project.locations[0].continuityStates = states("Night");
  return project;
}

/* One stub comparison carrying every outcome, shaped exactly as the compare
   route answers. The UI is a renderer, so the fixture is the contract. */
function comparePayload(patch = {}) {
  return {
    ok: true,
    shotId: "L1-01",
    frameA: { frameId: "frame-a", fileName: "FRAME_A.png", label: "A" },
    frameB: { frameId: "frame-b", fileName: "FRAME_B.png", label: "B" },
    observations: {
      a: { cached: true, fileName: "FRAME_A.png", validation: { status: "clean", usable: true } },
      b: { cached: true, fileName: "FRAME_B.png", validation: { status: "clean", usable: true } },
    },
    analysis: { usable: true, unusableFrames: [], notes: false },
    outcomeCounts: { stable: 1, issue: 1, expected: 1, uncertain: 1, review: 1 },
    entities: Continuity.describeComparison(FIVE_OUTCOMES, MANIFEST, { frameALabel: "Frame A", frameBLabel: "Frame B" }).entities,
    summary: { label: "human-review", needsReview: true, nEntities: 5 },
    engine: { provider: "custom", model: "nemotron_3_nano_omni", modelComparisonCalls: 0, providerRequests: 0 },
    ...patch,
  };
}

/* Renders the Frames stage, runs a continuity check against a stubbed route,
   and returns the resulting workspace HTML plus the calls the client made. */
async function renderCheck(payload, options = {}) {
  const calls = [];
  const rendered = await render("#/shot/L1-01", options.project || workspaceFixture(), {
    storage: { ...FRAMES_STORAGE, ...(options.storage || {}) },
    agentStatus: options.agentStatus,
    fetch: async (url, init, respond) => {
      if (!String(url).startsWith("/api/continuity")) return null;
      calls.push({ url: String(url), method: init?.method || "GET" });
      if (String(url).startsWith("/api/continuity/cache")) return respond({ ok: true, removed: 1 });
      return respond(options.responder ? options.responder(calls) : payload, options.status || 200);
    },
  });
  if (options.run !== false) {
    await evaluate(rendered, `runShotContinuityCheck("L1-01")`);
    await wait(30);
  }
  return { rendered, calls, html: () => rendered.document.getElementById("main").innerHTML };
}

/* --- the card itself ------------------------------------------------------ */
{
  const rendered = await render("#/shot/L1-01", workspaceFixture(), { storage: FRAMES_STORAGE });
  assert(rendered.html.includes('class="shot-continuity"'), "the Frames stage must carry a continuity section");
  assert(rendered.html.includes("CONTINUITY"), "the continuity section must be named");
  assert(rendered.html.includes("CHECK CONTINUITY"), "the continuity section must expose its primary action");
  assert(rendered.html.includes("Frame A → Frame B"), "the default comparison must be Frame A against Frame B");
  const continuityIndex = rendered.html.indexOf('class="shot-continuity"');
  const frameCardIndex = rendered.html.indexOf("guided-frame-card");
  assert(continuityIndex > 0 && (frameCardIndex < 0 || continuityIndex < frameCardIndex), "continuity must sit with the frame rail, not below one frame's candidate tray");
  pass("the continuity card renders inside the Frames stage, defaulting to Frame A → Frame B");

  /* Exactly one prominent continuity action: the superseded v6.6 pair review
     is retained, labelled by version, and folded away. */
  assert(rendered.html.includes("legacy-continuity-review"), "the v6.6 pair review must be retained");
  assert(rendered.html.includes("Pair continuity review (v6.6)"), "the retained review must be labelled as the older one");
  assert(rendered.html.includes("PAIR CONTINUITY CHECK REQUIRED"), "the retained review must keep its own stored state");
  assert(!/REVIEW SEQUENCE<|CONTINUITY CORRECTION REQUIRED/.test(rendered.html), "the motion gate must no longer present itself as a second continuity action");
  assert(rendered.html.includes("CHECK MOTION READINESS"), "the motion gate must name what it actually gates");
  pass("legacy pair review is retained, version-labelled and folded; only one prominent continuity action remains");
}

/* --- two approved frames are required ------------------------------------- */
{
  const project = workspaceFixture();
  project.shots[0].keyframes[1].winner = "";
  const rendered = await render("#/shot/L1-01", project, { storage: FRAMES_STORAGE });
  assert(rendered.html.includes("Continuity requires two approved frames"), "one approved frame must say what is missing");
  assert(!rendered.html.includes("CHECK CONTINUITY"), "a check that cannot run must not be offered as a broken button");
  pass("one approved frame explains the requirement instead of offering a broken check");
}

/* --- readiness is the continuity provider's own --------------------------- */
{
  const readyCapability = (label) => ({ ready: true, label, provider: "ollama", model: "fixture-model", message: `${label} is ready.`, action: "" });
  /* The intended runtime: generic multi-image vision is unavailable and
     continuity is ready. The check must remain usable. */
  const visionDown = await render("#/shot/L1-01", workspaceFixture(), {
    storage: FRAMES_STORAGE,
    agentStatus: { capabilities: { text: readyCapability("Text"), vision: { ready: false, message: "Ollama is not reachable.", action: "Start Ollama." }, continuity: readyCapability("Continuity observation"), embedding: readyCapability("Embedding"), verifier: readyCapability("Verifier"), technical: readyCapability("Technical") } },
  });
  assert(/onclick="runShotContinuityCheck\('L1-01'\)"/.test(visionDown.html), "continuity must stay usable when only generic vision is unavailable");
  assert(!visionDown.html.includes("Start Ollama"), "continuity must never blame the generic vision provider");

  const continuityDown = await render("#/shot/L1-01", workspaceFixture(), {
    storage: FRAMES_STORAGE,
    agentStatus: { capabilities: { text: readyCapability("Text"), vision: readyCapability("Vision assistance"), continuity: { ready: false, message: "Continuity analysis isn't configured.", action: "Choose a continuity vision provider in Settings." }, embedding: readyCapability("Embedding"), verifier: readyCapability("Verifier"), technical: readyCapability("Technical") } },
  });
  assert(continuityDown.html.includes("Continuity analysis isn&#39;t configured.") || continuityDown.html.includes("Continuity analysis isn't configured."), "an unconfigured continuity provider must say so");
  assert(continuityDown.html.includes("Choose a continuity vision provider in Settings"), "the message must point at the continuity provider setting");
  assert(/CHECK CONTINUITY<\/button>/.test(continuityDown.html) && /disabled[^>]*>CHECK CONTINUITY/.test(continuityDown.html), "an unconfigured check must be visibly disabled rather than absent");
  pass("continuity gating is independent of generic vision and names the continuity provider");
}

/* --- the result ----------------------------------------------------------- */
{
  const { html, rendered } = await renderCheck(comparePayload());
  const markup = html();
  for (const word of ["STABLE", "ISSUE", "EXPECTED", "UNCERTAIN", "REVIEW"])
    assert(markup.includes(word), `the summary must name ${word}`);
  assert(/outcome-issue[^>]*><i[^>]*>▲<\/i><b>1<\/b>/.test(markup), "each outcome must show its count");
  assert(markup.includes("Present in the first frame, absent in the second"), "an issue must say what changed");
  assert(markup.includes("Restore it, or declare that it may leave during this shot."), "an issue must recommend a next action");
  assert(markup.includes("MARK EXPECTED"), "a real change must offer the declaration");
  pass("the comparison summary renders all five outcome classes with counts, findings and next actions");

  /* Expected is visible, and reads differently from a break. */
  assert(markup.includes("State changed — as declared"), "an expected change must stay on screen");
  assert(markup.includes("Declared state changed from &quot;Jacket on&quot; to &quot;Jacket removed&quot;."), "an expected change must say why it was expected");
  assert(markup.includes("outcome-expected"), "expected must carry its own visual class");
  const expectedCard = markup.slice(markup.indexOf("outcome-expected"), markup.indexOf("outcome-expected") + 900);
  assert(!expectedCard.includes("MARK EXPECTED"), "an already-expected finding must not offer the declaration again");
  pass("expected findings stay visible, explain themselves and are styled apart from issues");

  /* Human review must not be dressed as a break. */
  const reviewCard = markup.slice(markup.indexOf("outcome-review"), markup.indexOf("outcome-review") + 900);
  assert(reviewCard.includes("Colour could not be compared"), "review must describe the evidence problem");
  assert(!/REVIEW · (HIGH|MEDIUM)/.test(markup), "review must never carry an issue severity");
  assert(!reviewCard.includes("MARK EXPECTED"), "review must not offer a declaration that would clear it");
  pass("human-review findings describe unreadable evidence and never look like hard issues");

  /* Stable entities are summarized. */
  assert(markup.includes("continuity-stable"), "stable entities must be summarized rather than carded");
  assert(markup.includes("1 entity is consistent across both frames"), "the stable summary must count and agree in number");
  assert(!/class="continuity-entity outcome-stable"/.test(markup), "a stable entity must not consume a finding card");
  pass("stable entities are summarized in one expandable line, never one card each");

  /* Provenance, not cache keys. */
  assert(markup.includes("Observed 2 frames · both cached"), "a warm comparison must say so plainly");
  assert(!/[0-9a-f]{16,}/.test(markup.slice(markup.indexOf("continuity-provenance"), markup.indexOf("continuity-provenance") + 400)), "provenance must not expose a hash");
  pass("cache provenance is a plain sentence with no hash or key");

  /* No endpoint, key or address may reach the browser surface. */
  for (const forbidden of ["http://", "https://fonts", "/v1/chat", "customBaseUrl", "api_key", "Authorization"]) {
    const section = markup.slice(markup.indexOf('class="shot-continuity"'));
    assert(!section.includes(forbidden), `the continuity surface leaked "${forbidden}"`);
  }
  pass("no endpoint, base URL or credential appears anywhere on the continuity surface");

  void rendered;
}

/* --- newly analyzed frames ------------------------------------------------ */
{
  const payload = comparePayload();
  payload.observations.a.cached = false;
  payload.observations.b.cached = false;
  const { html } = await renderCheck(payload);
  assert(html().includes("Observed 2 frames · 2 new analyses"), "a cold comparison must say both frames were analyzed");

  const half = comparePayload();
  half.observations.b.cached = false;
  const mixed = await renderCheck(half);
  assert(mixed.html().includes("Frame A cached · Frame B newly analyzed"), "a half-warm comparison must name which frame was re-read");
  pass("cached, half-warm and cold comparisons each report their own provenance");
}

/* --- usable_with_notes is not a failure ----------------------------------- */
{
  const payload = comparePayload();
  payload.observations.a.validation = { status: "usable_with_notes", usable: true };
  payload.analysis = { usable: true, unusableFrames: [], notes: true };
  const { html } = await renderCheck(payload);
  const markup = html();
  assert(!markup.includes("Continuity could not be evaluated"), "usable_with_notes must not render as an analysis failure");
  assert(markup.includes("continuity-outcome-counts"), "usable_with_notes must still render the normal verdict");
  assert(markup.includes("some readings were adjusted before comparison"), "a note-carrying observation should say so quietly");
  pass("an observation with notes renders a normal verdict, not a failure");
}

/* --- an unusable observation is an analysis failure ----------------------- */
{
  const payload = comparePayload();
  payload.observations.b.validation = { status: "invalid", usable: false };
  payload.analysis = { usable: false, unusableFrames: [{ side: "b", frameId: "frame-b", label: "Frame B" }], notes: false };
  const { html, calls } = await renderCheck(payload);
  const markup = html();
  assert(markup.includes("Continuity could not be evaluated."), "an unusable observation must refuse to produce a verdict");
  assert(markup.includes("Frame B returned an invalid observation"), "the failing frame must be named");
  assert(markup.includes("This is an analysis failure, not a continuity issue."), "an analysis failure must not be called a continuity issue");
  assert(markup.includes("RE-OBSERVE FRAME B"), "the failing frame must offer re-observation");
  assert(!markup.includes("continuity-outcome-counts"), "a fabricated comparison must not be shown alongside a failed analysis");
  assert.deepStrictEqual(calls.map((call) => call.method), ["POST"], "a failed analysis must not trigger extra requests");
  pass("an unusable observation renders an analysis failure with a per-frame recovery action, never a verdict");
}

/* --- re-observe uses only the supported purge and compare paths ----------- */
{
  const { rendered, calls } = await renderCheck(comparePayload());
  calls.length = 0;
  await evaluate(rendered, `reobserveShotContinuity("L1-01")`);
  await wait(10);
  const modal = rendered.document.getElementById("modal").innerHTML;
  assert(modal.includes("Re-observe frames") || modal.includes("RE-OBSERVE"), "re-observe must confirm before discarding stored analysis");
  assert(/Images, candidates and project records are not touched/.test(modal), "re-observe must state what it does not delete");
  await evaluate(rendered, `document.getElementById("modal-confirm-action").onclick()`);
  await wait(60);
  const purges = calls.filter((call) => call.method === "DELETE");
  assert.strictEqual(purges.length, 2, "re-observing a pair must purge exactly the two frames");
  for (const call of purges) {
    assert(/^\/api\/continuity\/cache\?shotId=L1-01&frameId=frame-[ab]$/.test(call.url), `unexpected purge target: ${call.url}`);
  }
  assert(calls.some((call) => call.method === "POST" && call.url === "/api/continuity/compare"), "re-observe must re-run the normal comparison");
  assert(!calls.some((call) => /key=|hash=|scope=/.test(call.url)), "the browser must never name a cache key, hash or purge scope");
  pass("re-observe purges only the two named frames and re-runs the normal comparison");
}

/* --- MARK EXPECTED writes a structured declaration ------------------------ */
{
  const { rendered } = await renderCheck(comparePayload());
  await evaluate(rendered, `markContinuityExpected("L1-01","PROP-MUG","removed","presence")`);
  await wait(40);
  const intent = evaluate(rendered, `JSON.stringify(P.shots[0].continuityIntent)`);
  assert.deepStrictEqual(JSON.parse(intent)["PROP-MUG"].allowPresenceChange, "may-leave", "marking a presence loss expected must declare that it may leave");
  assert.strictEqual(evaluate(rendered, `P.meta.schemaVersion`), "6.7", "writing a declaration must move the project to the 6.7 schema");

  /* The opposite direction must widen the declaration rather than overwrite it. */
  await evaluate(rendered, `markContinuityExpected("L1-01","PROP-MUG","added","presence")`);
  await wait(40);
  assert.strictEqual(JSON.parse(evaluate(rendered, `JSON.stringify(P.shots[0].continuityIntent)`))["PROP-MUG"].allowPresenceChange, "either", "declaring both directions must widen to either, never overwrite");

  /* Markings has no allowance, so it lands in the scoped human record. */
  await evaluate(rendered, `markContinuityExpected("L1-01","PROP-MUG","attribute","markings")`);
  await wait(40);
  const accepted = JSON.parse(evaluate(rendered, `JSON.stringify(P.shots[0].continuityIntentAccepted || {})`));
  assert.strictEqual(accepted["PROP-MUG:attribute:markings"], true, "a finding with no allowance must use the scoped per-finding record");
  assert.strictEqual(Object.keys(accepted).length, 1, "the human record must stay scoped to the one finding, not become a blanket exemption");
  pass("MARK EXPECTED writes the correct structured declaration, widens rather than overwrites, and never becomes a blanket exemption");
}

/* --- declared intent persists --------------------------------------------- */
{
  const { rendered } = await renderCheck(comparePayload(), { run: false });
  await evaluate(rendered, `setContinuityIntentField("L1-01","KAI","allowMovement",true)`);
  await evaluate(rendered, `setContinuityExpectedText("L1-01","KAI","Kai removes the jacket")`);
  const intent = JSON.parse(evaluate(rendered, `JSON.stringify(P.shots[0].continuityIntent)`));
  assert.strictEqual(intent.KAI.allowMovement, true, "a declared allowance must persist on the shot");
  assert.deepStrictEqual(intent.KAI.expected, ["Kai removes the jacket"], "expected prose must persist as the Phase 1 contract's own list");
  assert.strictEqual(evaluate(rendered, `P.meta.schemaVersion`), "6.7");

  /* A declaration returned to its default stores nothing at all. */
  await evaluate(rendered, `setContinuityIntentField("L1-01","KAI","allowMovement",false)`);
  await evaluate(rendered, `setContinuityExpectedText("L1-01","KAI","")`);
  assert.strictEqual(evaluate(rendered, `P.shots[0].continuityIntent === undefined`), true, "clearing every declaration must leave nothing stored");

  /* Renaming the entity must carry the declaration with it. */
  await evaluate(rendered, `setContinuityIntentField("L1-01","KAI","allowColorChange",true)`);
  await evaluate(rendered, `updateShotDependencyRelationship(P.shots[0], "KAI", "KAI-2")`);
  const relinked = JSON.parse(evaluate(rendered, `JSON.stringify(P.shots[0].continuityIntent)`));
  assert.strictEqual(relinked["KAI-2"]?.allowColorChange, true, "a relinked entity must keep its declared intent");
  assert.strictEqual(relinked.KAI, undefined, "the old id must not keep a stale declaration");
  pass("declared intent persists on the shot, clears completely, and follows an entity through a relink");
}

/* --- frame-level state selection ------------------------------------------ */
{
  const { rendered } = await renderCheck(comparePayload(), { run: false });
  const cases = [
    ["character", "KAI", "characterStateSelections"],
    ["prop", "PR-TOOL", "propStateSelections"],
    ["vehicle", "VEH-CART", "vehicleStateSelections"],
  ];
  for (const [kind, entityId, mapKey] of cases) {
    await evaluate(rendered, `setFrameContinuityState("L1-01","frame-b","${kind}","${entityId}","state-alt")`);
    const stored = evaluate(rendered, `P.shots[0].creationBrief.frameWorkflows["frame-b"].${mapKey}["${entityId}"]`);
    assert.strictEqual(stored, "state-alt", `${kind} frame state must persist in ${mapKey}`);
  }
  /* Locations keep their own single-value shape, which is what the server
     reads when it assembles a frame's design authorities. */
  await evaluate(rendered, `setFrameContinuityState("L1-01","frame-b","location","LOC-HULL","state-alt")`);
  assert.strictEqual(evaluate(rendered, `P.shots[0].creationBrief.frameWorkflows["frame-b"].locationStateId`), "state-alt", "a location frame state must use locationStateId");
  assert.strictEqual(evaluate(rendered, `P.shots[0].creationBrief.frameWorkflows["frame-b"].locationStateSelections === undefined`), true, "a location must not also grow a second storage shape");
  assert.strictEqual(evaluate(rendered, `P.meta.schemaVersion`), "6.7");

  /* And they must survive the frame-card render that rebuilds the record. */
  await evaluate(rendered, `route()`);
  await wait(20);
  assert.strictEqual(evaluate(rendered, `P.shots[0].creationBrief.frameWorkflows["frame-b"].characterStateSelections["KAI"]`), "state-alt", "a frame state must survive the frame workflow being normalized");
  assert.strictEqual(evaluate(rendered, `P.shots[0].creationBrief.frameWorkflows["frame-b"].locationStateId`), "state-alt", "a location frame state must survive normalization");
  pass("frame-level character, prop, vehicle and location states persist and survive frame-workflow normalization");

  /* Precedence: frame beats shot beats the entity default. */
  await evaluate(rendered, `P.shots[0].continuityStateSelections = { "KAI": "state-default" }`);
  assert.strictEqual(evaluate(rendered, `resolveDeclaredStateId(P.shots[0], "frame-b", "character", "KAI")`), "state-alt", "a frame selection must win over the shot selection");
  assert.strictEqual(evaluate(rendered, `resolveDeclaredStateId(P.shots[0], "frame-a", "character", "KAI")`), "state-default", "a frame with no selection must fall back to the shot");
  await evaluate(rendered, `setFrameContinuityState("L1-01","frame-b","character","KAI","")`);
  assert.strictEqual(evaluate(rendered, `resolveDeclaredStateId(P.shots[0], "frame-b", "character", "KAI")`), "state-default", "clearing a frame selection must fall back to the shot");
  await evaluate(rendered, `P.shots[0].continuityStateSelections = {}`);
  assert.strictEqual(evaluate(rendered, `resolveDeclaredStateId(P.shots[0], "frame-b", "character", "KAI")`), "", "with nothing declared, the entity's own default applies");
  pass("state precedence remains frame > shot > entity default");

  /* The surface itself has to be legible: one row per reference, one control
     per compared frame. */
  const markup = rendered.document.getElementById("main").innerHTML;
  assert(markup.includes("Frame states"), "the Frames stage must expose per-frame state selection");
  assert(markup.includes("Follow the shot — Default"), "an unselected frame must say what it currently inherits");
  pass("the frame-state surface names the inherited value rather than showing an empty control");
}

/* --- entity tracking ------------------------------------------------------ */
{
  const project = workspaceFixture();
  const rendered = await render("#/prop/PR-TOOL", project, { storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "states" } });
  assert(rendered.html.includes("Continuity tracking"), "the reference page must expose continuity tracking");
  assert(rendered.html.includes("Track only the attributes that genuinely have to stay the same"), "tracking must explain restraint");
  assert(rendered.html.includes("Multi-tone objects usually should not use automatic colour tracking"), "tracking must warn about colour on multi-tone objects");
  assert(!rendered.html.includes("allowedStateValues"), "derived contract machinery must not be presented as a production control");

  /* Colour is the one attribute that must stay off until asked for. */
  const colourChecked = /Colour<\/b>/.test(rendered.html) && /<input type="checkbox" checked[^>]*onchange="setEntityContinuityTracking\('props','PR-TOOL','color'/.test(rendered.html);
  assert(!colourChecked, "colour tracking must default to off");
  assert(/<input type="checkbox" checked[^>]*onchange="setEntityContinuityTracking\('props','PR-TOOL','presence'/.test(rendered.html), "presence must default to on");
  assert.strictEqual(evaluate(rendered, `resolveEntityTracking(P.props[0], null).color`), false, "the resolved default for colour is false");

  await evaluate(rendered, `setEntityContinuityTracking("props","PR-TOOL","color",true)`);
  assert.strictEqual(evaluate(rendered, `P.props[0].tracking.color`), true, "an explicit colour choice must persist");
  assert.strictEqual(evaluate(rendered, `P.meta.schemaVersion`), "6.7", "writing tracking must move the project to the 6.7 schema");
  /* Only the touched key is stored, so an untouched attribute still inherits. */
  assert.deepStrictEqual(Object.keys(JSON.parse(evaluate(rendered, `JSON.stringify(P.props[0].tracking)`))), ["color"], "only the attribute the user touched may be stored");
  await evaluate(rendered, `setEntityContinuityTracking("props","PR-TOOL","color",false)`);
  assert.strictEqual(evaluate(rendered, `P.props[0].tracking === undefined`), true, "returning every attribute to its default must store nothing");

  /* Composite units are configurable without a hierarchy editor. */
  await evaluate(rendered, `setEntityContinuityTracking("props","PR-TOOL","unit","composite-parent")`);
  assert.strictEqual(evaluate(rendered, `resolveEntityTracking(P.props[0], null).unit`), "composite-parent", "a prop must be able to declare itself one continuity unit");
  await evaluate(rendered, `setEntityContinuityTracking("props","PR-TOOL","unit","child")`);
  await evaluate(rendered, `setEntityContinuityTracking("props","PR-TOOL","parentEntityId","VEH-CART")`);
  assert.strictEqual(evaluate(rendered, `resolveEntityTracking(P.props[0], null).parentEntityId`), "VEH-CART", "a child part must be able to name its parent");
  await evaluate(rendered, `setEntityContinuityTracking("props","PR-TOOL","unit","self")`);
  assert.strictEqual(evaluate(rendered, `resolveEntityTracking(P.props[0], null).parentEntityId`), "", "leaving the child unit must drop the stale parent");
  pass("entity tracking persists, keeps colour off by default, stores only explicit choices, and configures composite units");

  /* Turning an entity off must remove it from the check entirely. */
  const offProject = workspaceFixture();
  offProject.props[0].tracking = { enabled: false };
  const shotRender = await render("#/shot/L1-01", offProject, { storage: FRAMES_STORAGE });
  assert(shotRender.html.includes("setContinuityIntentField('L1-01','KAI'"), "a tracked entity must still be offered continuity intent");
  assert(!shotRender.html.includes("setContinuityIntentField('L1-01','PR-TOOL'"), "an entity excluded from tracking must not be offered continuity intent");
  pass("an entity with tracking switched off leaves the continuity surface entirely");
}

/* --- schema behaviour ----------------------------------------------------- */
{
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert(/const PROJECT_SCHEMA_BASELINE_VERSION = "6\.6"/.test(app), "the baseline marker must stay 6.6");
  assert(/const PROJECT_SCHEMA_VERSION = "6\.7"/.test(app), "the current marker must be 6.7");

  /* Opening a 6.6 project must not claim a migration that did not happen. */
  const current = workspaceFixture();
  current.meta.hubVersion = "v6.0.0";
  current.meta.schemaVersion = "6.6";
  const opened = await render("#/shot/L1-01", current, { storage: FRAMES_STORAGE });
  assert.strictEqual(evaluate(opened, `P.meta.schemaVersion`), "6.6", "merely opening a 6.6 project must leave its marker alone");
  assert.strictEqual(evaluate(opened, `P.shots[0].continuityIntent === undefined`), true, "opening must not populate continuity intent");
  assert.strictEqual(evaluate(opened, `P.props[0].tracking === undefined`), true, "opening must not populate tracking objects");
  assert.strictEqual(evaluate(opened, `Object.keys(P.shots[0].creationBrief.frameWorkflows["frame-a"] || {}).some((k) => k.endsWith("StateSelections"))`), false, "opening must not populate frame state maps");

  /* One write moves it, and only then. */
  await evaluate(opened, `setContinuityIntentField("L1-01","KAI","allowMovement",true)`);
  assert.strictEqual(evaluate(opened, `P.meta.schemaVersion`), "6.7", "the first 6.7 field written must move the marker");

  /* A newer project is never downgraded, by opening or by writing. */
  const future = workspaceFixture();
  future.meta.hubVersion = "v7.2.0";
  future.meta.schemaVersion = "9.1";
  const ahead = await render("#/shot/L1-01", future, { storage: FRAMES_STORAGE });
  assert.strictEqual(evaluate(ahead, `P.meta.schemaVersion`), "9.1", "a future schema must survive being opened");
  await evaluate(ahead, `setContinuityIntentField("L1-01","KAI","allowMovement",true)`);
  assert.strictEqual(evaluate(ahead, `P.meta.schemaVersion`), "9.1", "a future schema must survive a 6.7 write");
  pass("6.6 projects open untouched and unpopulated, one continuity write moves them to 6.7, and a newer schema is never downgraded");
}

/* --- nothing that already worked stopped working -------------------------- */
{
  const project = workspaceFixture();
  const bible = await render("#/prop/PR-TOOL", project, { storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "states" } });
  assert(bible.html.includes("Continuity states"), "the Project Bible must keep its continuity states panel");
  assert(bible.html.includes("+ Add continuity state"), "state authoring must remain available");
  assert(bible.html.includes("Continuity-state chain"), "state-chain automation must remain available");
  const shot = await render("#/shot/L1-01", project, { storage: FRAMES_STORAGE });
  for (const text of ["FRAMES", "Import, choose, and approve images", "＋ Add frame"])
    assert(shot.html.includes(text), `the Frames stage lost "${text}"`);
  pass("the Project Bible state workflow and the rest of the Frames stage are unchanged");
}

}

main().then(
  () => console.log(`Continuity workspace suite passed:\n` + results.map((line) => `  - ${line}`).join("\n")),
  (error) => { console.error(error.stack || error.message || error); process.exitCode = 1; },
);
