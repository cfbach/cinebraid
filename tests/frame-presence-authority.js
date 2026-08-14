/* FRAME-SPECIFIC TEMPORAL PRESENCE. Dogfood Pass #2 A3, forensic audit F6.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: an entity a frame declares
 * ABSENT contributes no positive subject or action fact to that frame's compiled
 * prompt, and a contradiction that survives anyway stops the request before a
 * provider sees it.
 *
 * THE CASE, from the pass. Shot S01-01, "The Illustration Breathes":
 *
 *     Frame A   the Chimbley Sweep MUST BE ABSENT
 *     during    the Sweep begins to resolve
 *     Frame B   the Sweep is visible and readable
 *
 * CineBraid compiled Frame A text containing a tiny Sweep figure, and GPT Image 2
 * did exactly what it was told on a paid render. The reviewer could not have
 * caught it: it would have been checking the candidate against a requirement that
 * was already corrupted.
 *
 * WHY THE FIXTURE IS THREE FRAMES AND NOT TWO. Absence at the start and presence
 * at the end is only half the contract; the middle frame is where `enters` has to
 * behave DIFFERENTLY from `absent`, and a two-frame fixture would pass with a
 * naive "any declaration suppresses the entity" implementation.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. buildContext and defaultSpec are pure
 * functions over a project literal; nothing in this file opens a socket.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const PromptEngine = require("../prompt-engine");
const Presence = require("../public/shared-frame-presence");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

/* ===========================================================================
   The fixture. A named character who must be absent at the start, a second
   entity that is present throughout, and a location — so "the declaration
   suppressed everything" would fail as loudly as "the declaration did nothing".
*/
const SWEEP = "CHAR-X-SWEEP";
const WIDOW = "CHAR-X-WIDOW";
const ROOFTOPS = "LOC-X-ROOFTOPS";

function fixture(presenceByFrame = {}) {
  const frameWorkflows = {};
  for (const [frameId, map] of Object.entries(presenceByFrame)) {
    frameWorkflows[frameId] = { [Presence.RUNTIME_FRAME_PRESENCE_KEY]: { ...map } };
  }
  return {
    meta: { title: "Presence fixture", world: {}, aspectRatio: "16:9" },
    scenes: [{ id: "SC-01", title: "Rooftops", whatHappens: "The Chimbley Sweep resolves out of the illustration while the Widow watches." }],
    characters: [
      { id: SWEEP, name: "Chimbley Sweep", block: "Soot-dark coat, brush over the shoulder.", approvedFile: "SWEEP.png", continuityStates: [] },
      { id: WIDOW, name: "Widow Ashgrove", block: "Black crepe, teacup in hand.", approvedFile: "WIDOW.png", continuityStates: [] },
    ],
    locations: [{ id: ROOFTOPS, name: "London Rooftops", block: "Slate pitches and chimney stacks.", approvedFile: "ROOFTOPS.png", continuityStates: [] }],
    props: [], vehicles: [], audio: [],
    shots: [{
      id: "S01-01", scene: "SC-01", title: "The Illustration Breathes",
      desc: "A tiny figure of the Chimbley Sweep stands among the chimney stacks as the Widow looks on.",
      positioning: "The Sweep is upper-left of frame; the Widow holds the lower-right third.",
      characters: [SWEEP, WIDOW], codes: [ROOFTOPS], risks: [],
      keyframes: [
        { id: "fr-a", label: "A", title: "Empty rooftops", description: "Slate and smoke, nobody yet.", required: true },
        { id: "fr-mid", label: "B", title: "The reveal begins", description: "A shape starts to resolve out of the ink.", required: true },
        { id: "fr-b", label: "C", title: "The Sweep readable", description: "The Sweep is fully drawn.", required: true },
      ],
      clips: [],
      creationBrief: { locationId: ROOFTOPS, frameWorkflows },
    }],
  };
}

const ABSENT_A = { "fr-a": { [SWEEP]: "absent" }, "fr-mid": { [SWEEP]: "enters" }, "fr-b": { [SWEEP]: "present" } };

/* ===========================================================================
   1. THE DECLARATION. Reading it, and what silence means. */

const project = fixture(ABSENT_A);
const shot = project.shots[0];

eq(Presence.resolveFramePresence(shot, "fr-a", SWEEP), "absent", "a frame's own declaration is read");
eq(Presence.resolveFramePresence(shot, "fr-mid", SWEEP), "enters", "each frame answers for itself");
eq(Presence.resolveFramePresence(shot, "fr-b", SWEEP), "present", "including the end of the progression");
eq(Presence.resolveFramePresence(shot, "fr-a", WIDOW), "",
  "an entity the frame says nothing about inherits — absence means inherit, exactly as in the state binding, and must never be manufactured into 'present'");
eq(Presence.resolveFramePresence(shot, "fr-none", SWEEP), "", "an unknown frame declares nothing");
eq(Presence.resolveFramePresence(fixture(), "fr-a", SWEEP), "", "a shot with no declarations at all behaves exactly as before this batch");
eq(Presence.normalizeFramePresence("ABSENT"), "absent", "the vocabulary is case-insensitive at the boundary");
eq(Presence.normalizeFramePresence("maybe"), "", "and closed — an unknown word is not a declaration");

eq(Presence.absentEntityIdsForFrame(shot, "fr-a"), [SWEEP], "only `absent` forbids presence");
eq(Presence.absentEntityIdsForFrame(shot, "fr-mid"), [],
  "`enters` does NOT — the entity is on screen for part of that frame's moment, so a positive fact about it is truthful");
eq(Presence.absentEntityIdsForFrame(shot, "fr-b"), [], "and neither does `present`");

const bindings = Presence.readShotPresenceBindings(shot, { frameIds: ["fr-a", "fr-mid", "fr-b"] });
eq(bindings.frames.map((frame) => frame.frameId), ["fr-a", "fr-mid", "fr-b"],
  "frame order follows the shot's own frames, not the map's insertion order");

/* ===========================================================================
   2. COMPILATION. The whole point.

   Frame A must compile with NO positive Sweep fact anywhere: not in the identity
   canon, not in the subject descriptors, not in the visual grounding, not in the
   blocking entity list, and not by way of the shot description or scene beat that
   name him. */

function specFor(frameId, source = project) {
  const context = PromptEngine.buildContext(source, "S01-01", "", { frameId });
  return { context, spec: PromptEngine.defaultSpec(context, "shot-still", "t2i", [], null) };
}

const a = specFor("fr-a");
eq(a.spec.framePresence.absent.map((entry) => entry.id), [SWEEP], "the spec carries the declaration it was compiled under");
eq(a.spec.identityCanon.filter((line) => /Chimbley Sweep/i.test(line)), [], "Frame A carries no Sweep identity canon");
eq(a.spec.promptEntities.map((entry) => entry.id), [WIDOW],
  "and no Sweep subject descriptor — while the Widow, who is not declared absent, is untouched");
eq(a.spec.visualGrounding.filter((entry) => entry.entityId === SWEEP), [], "and no Sweep visual grounding");
eq(a.spec.blockingEntities.filter((entry) => entry.id === SWEEP), [], "and no Sweep blocking descriptor");
ok(a.spec.identityCanon.some((line) => /Widow/i.test(line)), "the rest of the shot compiles normally — this is a subtraction of one fact, not a blank frame");

/* The narrative that names him. This is the sentence that produced the wrong
   render, and appending the frame directive after it did not repair it. */
eq(a.context.shot.description, "", "the shot description is withheld from Frame A because it states the Sweep positively");
eq(a.context.scene.beat, "", "so is the scene beat, for the same reason");
eq(a.context.shot.positioning, "", "and the staging line that places him upper-left");
eq(a.spec.framePresence.withheldNarrative.map((entry) => entry.field).sort(),
  ["scene.whatHappens", "shot.desc", "shot.positioning"],
  "and each withholding is RECORDED — a creator whose description vanished from a prompt is owed the reason");
ok(!/Chimbley Sweep/i.test(a.spec.initialState.subject || ""), "so the compiled subject cannot carry him either");
ok(!/Chimbley Sweep/i.test(JSON.stringify(a.spec.actions || [])), "nor the action list");

/* The absence is STATED, not merely omitted. Generic "avoid unrequested
   characters" was already present before this batch and did not save S01-01,
   because the Sweep was not unrequested — the prompt had asked for him. */
ok(a.spec.mustAvoid.some((line) => /Chimbley Sweep must not appear/i.test(line)),
  "the model is told about the absence explicitly");
ok(a.spec.mustAvoid.some((line) => /reflections, shadows, silhouettes and background figures/i.test(line)),
  "including the forms a 'tiny figure' actually takes");

/* The middle and end frames. */
const mid = specFor("fr-mid");
eq(mid.spec.framePresence.absent, [], "`enters` forbids nothing");
ok(mid.spec.promptEntities.some((entry) => entry.id === SWEEP), "so the Sweep's descriptor is present in the middle frame");
ok(mid.context.shot.description.length > 0, "and the shot description is not withheld there");

const b = specFor("fr-b");
ok(b.spec.promptEntities.some((entry) => entry.id === SWEEP), "the end frame includes the Sweep");
ok(b.spec.identityCanon.some((line) => /Chimbley Sweep/i.test(line)), "with his identity canon intact");
eq(b.spec.mustAvoid.filter((line) => /Chimbley Sweep must not appear/i.test(line)), [], "and no absence requirement");

/* A shot with no declarations must be byte-identical to the old behaviour. */
const undeclared = specFor("fr-a", fixture());
ok(/Chimbley Sweep/i.test(undeclared.spec.identityCanon.join(" ")),
  "a project that declares nothing compiles exactly as it did before this batch — the contract is opt-in");
eq(PromptEngine.buildContext(fixture(), "S01-01", "").framePresence.absent, [],
  "and a caller that supplies no frameId at all is unaffected");

/* REFERENCE ATTACHMENT AND FRAME PRESENCE ARE DIFFERENT FACTS. The Sweep's
   reference stays attached for identity continuity; what he loses is the
   positive assertion. This is the property B15/H3 correction depends on. */
ok(a.context.references.some((ref) => ref.id === SWEEP),
  "the absent character's reference is STILL ATTACHED — presence and attachment are separate facts, and stripping the reference would break identity continuity for the frames around it");

/* ===========================================================================
   3. THE CONTRADICTION CHECK. What happens when the creator's own text
      disagrees with the creator's own declaration. */

const absentSweep = [{ id: SWEEP, name: "Chimbley Sweep" }];

eq(Presence.framePresenceContradictions({ absentEntities: [], spec: { narrativePurpose: "The Chimbley Sweep waves." } }), [],
  "no declared absence means no scanning at all");

const structural = Presence.framePresenceContradictions({
  absentEntities: absentSweep,
  spec: { identityCanon: ["Chimbley Sweep: soot-dark coat"] },
});
eq(structural.length, 1, "a machine-generated positive list naming an absent entity is a contradiction");
eq(structural[0].surface, "identity canon", "and the surface is named so the fix is obvious");

const prose = Presence.framePresenceContradictions({
  absentEntities: absentSweep,
  spec: { narrativePurpose: "A tiny figure of the Chimbley Sweep stands at the stack." },
});
eq(prose.length, 1, "a positive prose clause is a contradiction");
ok(/tiny figure/.test(prose[0].fragment), "and the exact clause is quoted — 'a contradiction was detected' is not actionable");

/* THE NEGATION ALLOWANCE, and why it has to exist. The S01-01 frame direction
   the creator actually wrote was "no Chimbley Sweep visible". A check that
   flagged every mention would block the correctly-authored case and teach people
   to stop declaring absence at all. */
for (const clause of [
  "No Chimbley Sweep visible.",
  "The Chimbley Sweep is not yet visible.",
  "Empty rooftops, without the Chimbley Sweep.",
  "The Chimbley Sweep is off-screen.",
  "Before the Chimbley Sweep appears.",
]) {
  eq(Presence.framePresenceContradictions({ absentEntities: absentSweep, spec: { narrativePurpose: clause } }), [],
    `a clause that DENIES presence is not a contradiction: ${clause}`);
}

/* Clause-level, not paragraph-level: one negation elsewhere must not excuse a
   positive sentence. */
const mixed = Presence.framePresenceContradictions({
  absentEntities: absentSweep,
  spec: { narrativePurpose: "The rooftops are empty of people. The Chimbley Sweep raises his brush." },
});
eq(mixed.length, 1, "a negated clause does not excuse a positive one in the same passage");

/* Substring safety: a different entity whose name merely contains the tokens. */
eq(Presence.framePresenceContradictions({
  absentEntities: [{ id: "CHAR-SWEEPER", name: "Sweeper" }],
  spec: { narrativePurpose: "The sweepers guild banner hangs over the alley." },
}), [], "matching is word-bounded — 'sweepers' is not 'Sweeper'");

/* THE SHORT FORM. The dogfood staging line said "The Sweep", not "The Chimbley
   Sweep", and a full-name-only scan would have carried it straight into the
   frame that excludes him. */
eq(Presence.presenceNameParts("Chimbley Sweep"), ["Chimbley", "Sweep"], "capitalised name parts are the short forms people use");
eq(Presence.presenceNameParts("Flight case"), ["Flight"],
  "a lowercase part is an ordinary English word and is NOT derived — 'case' would fire on 'in case of rain'");
eq(Presence.presenceNameParts("Sweeper"), ["Sweeper"], "a single-word name yields one part");
eq(Presence.presenceTokensFor({ id: "CHAR-X", name: "Sweeper" }).includes("Sweeper"), true,
  "and a single-word name is matched by the name itself, so nothing is lost");
eq(Presence.framePresenceContradictions({
  absentEntities: absentSweep,
  spec: { narrativePurpose: "The Sweep is upper-left of frame." },
}).length, 1, "so the short form is caught");
eq(Presence.framePresenceContradictions({
  absentEntities: [{ id: "PROP-CASE", name: "Flight case" }],
  spec: { narrativePurpose: "In case of rain the awning comes down." },
}), [], "and the lowercase-part rule keeps an ordinary word from becoming a false positive");

/* One finding per surface and fragment, not one per place the same sentence
   reached. */
const deduped = Presence.framePresenceContradictions({
  absentEntities: absentSweep,
  spec: { narrativePurpose: "The Chimbley Sweep waves." },
  prompt: "The Chimbley Sweep waves.",
});
eq(deduped.length, 1, "the same sentence reaching the spec and the final prompt is one problem, not two");

/* ===========================================================================
   4. THE GATE. Where the contradiction actually stops a request. */

const server = read("server.js");
ok(/FRAME_PRESENCE_CONTRADICTION/.test(server), "the compile route refuses a contradicting frame");
ok(/framePresenceContradictions\(\{[\s\S]{0,200}absentEntities/.test(server), "using the shared check");
ok(/Nothing was sent to a provider/.test(server), "and says so, because a blocked paid render needs that sentence");
/* The refusal is positioned AFTER compile and BEFORE the response — there is no
   provider call in this route at all, so the guarantee is structural: the check
   runs on the compiled text, and a 409 returns it for inspection rather than
   discarding the creator's work. */
ok(/res\.status\(409\)\.json\(\{[\s\S]{0,900}?compiledPrompt: compiled\.prompt/.test(server),
  "and returns the compiled prompt so the creator can see exactly what was refused");

const automation = read("public/automation.js");
ok(/v670FramePresenceContradictions/.test(automation),
  "automation preflight catches it before a run is authorized, so a run that cannot compile is never startable");

const studio = read("public/creation-studio.js");
ok(/frameId,\s*\n\s*\/\* WHICH FRAME|frameId,/.test(studio), "the browser sends the frame id with every frame compile");
ok(/setFramePresence/.test(studio), "and a writer exists, so the contract is reachable rather than theoretical");
ok(/guidedFramePresencePanel/.test(studio), "with a control on the frame card itself");

/* The declaration is production truth: an assistant rewrite may not soften it. */
const engine = read("prompt-engine.js");
ok(/out\.framePresence = fallback\.framePresence/.test(engine),
  "validateSpec takes the declaration from the deterministic fallback only — a supplied or assistant-rewritten spec may not drop, soften or invent one");

console.log(`Frame-presence suite passed ${checks} checks: the declaration and its inherit-by-silence rule, absent/enters/present compiling differently, positive facts and naming narrative withheld for a declared-absent entity, the explicit absence requirement, reference attachment preserved, the negation-aware contradiction detector, and the refusal that stops a contradicting frame before any provider request.`);
