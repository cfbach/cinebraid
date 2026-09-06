/* DOGFOOD UX CLARITY V1 — the eight things a real production run could not read.
 *
 * Every check below is a state a filmmaker was actually standing in when they
 * tried to start The Last Seat, written as the thing they could not tell:
 *
 *   U1  which provider the chip they pressed actually talks to, and in what protocol
 *   U2  whether a capability that says it is off is off, and whether its settings survive
 *   U3  which category a card on the shelf belongs to, and which chip filters to it
 *   U4  what an empty card is for, without being told twenty-seven times
 *   U5  what the single first task on an empty reference is
 *   U6  which of the two paths is the task and which is the alternative
 *   U7  that an empty decision surface is not work waiting for them
 *   U8  that coverage comes after the primary, not instead of it
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT CLAIM. It does not measure how any of
 * this looks — ring opacity, weight, rhythm and whether a cue reads as restrained
 * are human-acceptance items and are captured as screenshots instead. And it does
 * not re-prove the truth underneath: which file is canon, what a candidate is, and
 * what coverage requires are other suites' claims and are unchanged by this pass.
 *
 * Provider calls made by this suite: 0. It renders and reads; it never dispatches.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* THE ASSISTANT PANEL IS CONFIG-DRIVEN, so it is rendered against a fixture
   config rather than whatever this machine happens to have. `config.js` resolves
   CINEBRAID_CONFIG_PATH at require time, so this is set before the harness — and
   therefore config.js — is first loaded. */
const fixtureConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-uxclarity-"));
const fixtureConfigPath = path.join(fixtureConfigDir, "config.json");
/* The configuration dogfood proved works: an OpenAI-compatible server serving
   Qwen for text, vision pointed at a provider that serves no vision model, and
   continuity not configured at all. */
fs.writeFileSync(fixtureConfigPath, JSON.stringify({
  activeProject: "fixture",
  assistant: { provider: "custom", visionProvider: "ollama" },
  customBaseUrl: "http://127.0.0.1:18434/v1",
  customModel: "qwen3.8-27b-fp8",
  customVisionModel: "",
  customThinking: "disabled",
  ollamaVisionModel: "",
  continuity: {},
  generation: { fal: { enabled: false } },
}), "utf8");
process.env.CINEBRAID_CONFIG_PATH = fixtureConfigPath;

const { render, buildFixture } = require("./render-harness");

const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
/* The rendered surface is HTML, not a DOM. This narrows a claim to one block so
   an assertion cannot pass on a match that belongs to a different section. */
function within(html, openTag, closeHint) {
  const start = html.indexOf(openTag);
  assert.ok(start >= 0, `expected to find ${openTag}`);
  const rest = html.slice(start + openTag.length);
  const end = rest.indexOf(closeHint);
  return end >= 0 ? rest.slice(0, end) : rest;
}
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks++; };

/* ---------------------------------------------------------------------------
   FIXTURE. One character in the exact state Rex Vandar was in: a default state
   with no approved primary, no media, no candidates, and shots that use it. */
function emptyReferenceFixture() {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-EMPTY";
  character.name = "Rex Vandar";
  character.prefix = "CHAR-EMPTY";
  character.approvedFile = "";
  character.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "", notes: "Primary identity." },
  ];
  character.coverageSlots = [];
  return project;
}

async function main() {
  /* =======================================================================
     U1 — A PROVIDER IS NAMED FOR THE SERVER IT ACTUALLY TALKS TO.
     The detour dogfood hit was a 404: "Local AI" was picked for a vLLM server,
     and `ollama` posts Ollama's own /api/chat, which vLLM does not serve. */
  const views = read("public/views.js");
  const server = read("server.js");
  const llm = read("llm.js");

  ok(/\["ollama", "Ollama",/.test(views), "U1: the Ollama chip is named Ollama");
  ok(/\["custom", "OpenAI-compatible server",/.test(views),
    "U1: the custom chip is named for the protocol it speaks");
  ok(/vLLM, LM Studio, llama\.cpp/.test(views),
    "U1: the OpenAI-compatible chip names the servers that belong to it");
  /* THE IDS ARE THE STORED VALUES AND MUST NOT MOVE. A rename that migrated
     settings would be a different change from the one this pass made. */
  ok(views.includes(`setAssistantProvider('ollama')`) || /"ollama"/.test(views),
    "U1: the ollama id is unchanged");
  ok(/"custom"/.test(views), "U1: the custom id is unchanged");
  /* No user-facing label may still claim the old, untrue names. */
  eq(/>Local AI</.test(views), false, "U1: no chip still reads Local AI");
  eq(/>Custom server</.test(views), false, "U1: no chip still reads Custom server");
  eq(/"Local AI"|"Custom AI server"/.test(server), false,
    "U1: the server's provider label map names the real providers");
  eq(/"Local AI"|"Local vision"|"Custom AI server"/.test(llm), false,
    "U1: a runtime error names the server it actually called");
  ok(/"Ollama"/.test(llm) && /"OpenAI-compatible server"/.test(llm),
    "U1: llm.js labels name Ollama and the OpenAI-compatible server");
  /* The selected provider is the text assistant, and the panel says so. */
  ok(/TEXT ASSISTANT · BRAIDY/.test(views),
    "U1: the panel names the selected provider as the text/Braidy assistant");
  ok(/Test \$\{esc\(providerLabel\(provider\)\)\}/.test(views),
    "U1: Test connection names the provider it tests");

  /* =======================================================================
     U2 — A CAPABILITY THAT IS OFF LOOKS OFF, AND KEEPS ITS SETTINGS. */
  const settings = read("public/settings.js");
  ok(/settings-inactive-fields/.test(views),
    "U2: an inactive capability's fields get their own subordinated group");
  /* THE VALUES SURVIVE. Two independent guarantees, and the suite pins both:
     the fields stay in the DOM (a closed <details> is still queryable), and the
     reader falls back to the stored value even if an element is absent. */
  ok(/inactiveFields\("vision"/.test(views) && /cfg-custom-vision/.test(views),
    "U2: the vision model input is subordinated, not dropped");
  ok(/inactiveFields\("continuity"/.test(views)
    && /cfg-continuity-base/.test(views) && /cfg-continuity-model/.test(views),
    "U2: the continuity endpoint and model inputs are subordinated, not dropped");
  ok(/v\("#cfg-continuity-base", CONFIG\.continuity\?\.baseUrl \|\| ""\)/.test(settings)
    && /v\("#cfg-custom-vision", CONFIG\.customVisionModel \|\| ""\)/.test(settings),
    "U2: saving falls back to the stored value, so an off capability cannot be blanked");
  /* A disabled capability must not print a model as if one were live. */
  ok(/visionConfigured = !visionOff && !!visionModel/.test(views),
    "U2: 'configured' means a model was actually named for the resolved provider");
  ok(/visionFieldIsHere = visionProvider === provider/.test(views),
    "U2: the remedy points at the box that actually feeds vision");

  /* The rendered panel, against the fixture config above. */
  const settingsHtml = (await render("#/settings", buildFixture(),
    { storage: { "cinebraid-focused:fixture:settings-task:settings": "assistant" } })).html;
  ok(/class="policy-options assistant-options"/.test(settingsHtml),
    "U2: the assistant panel renders");
  ok(/>Ollama</.test(settingsHtml) && />OpenAI-compatible server</.test(settingsHtml),
    "U1: the rendered chips carry the corrected names");
  eq(/>Local AI</.test(settingsHtml) || />Custom server</.test(settingsHtml), false,
    "U1: the rendered chips carry neither old name");
  /* Each capability states its own standing, and the standing is derived rather
     than asserted: text has a model, vision resolves to a provider that serves
     none, continuity was never configured. */
  const capabilityStates = [...settingsHtml.matchAll(
    /class="assistant-capability" data-capability="([a-z]+)" data-state="([a-z]+)"/g)]
    .reduce((acc, [, name, state]) => Object.assign(acc, { [name]: state }), {});
  eq(Object.keys(capabilityStates).length, 3,
    "U2: text, vision and continuity each state their own standing");
  eq(capabilityStates.text, "on", "U2: a text assistant with a model reads as on");
  eq(capabilityStates.vision, "incomplete",
    "U2: vision pointed at a provider serving no model does not read as on");
  eq(capabilityStates.continuity, "off", "U2: unconfigured continuity reads as off");
  /* THE VALUES ARE STILL IN THE DOCUMENT. This is what makes saving while a
     capability is off non-destructive: a closed <details> is still queryable, so
     `assistantConfigPatch()` reads the stored value rather than a missing one. */
  ok(settingsHtml.includes(`id="cfg-continuity-base"`),
    "U2: the continuity endpoint input is still in the document");
  ok(settingsHtml.includes(`id="cfg-continuity-model"`),
    "U2: the continuity model input is still in the document");
  const inactive = within(settingsHtml, `<details class="settings-inactive-fields" data-inactive="continuity">`, "</details>");
  ok(inactive.includes(`id="cfg-continuity-base"`) && inactive.includes(`id="cfg-continuity-model"`),
    "U2: and they are inside the subordinated group rather than at full weight");

  /* =======================================================================
     U3 — THE SHELF'S CATEGORY CHIPS AND ITS CARDS AGREE. */
  const app = read("public/app.js");
  const css = read("public/styles.css");
  ok(/data-tabs="\$\{attr\(base\)\}"/.test(app) && /data-tab-key="\$\{attr\(key\)\}"/.test(app),
    "U3: a tab declares which tab it is; the stylesheet decides what that looks like");
  for (const key of ["characters", "locations", "props", "vehicles", "audio"]) {
    ok(css.includes(`.workspace-tabs[data-tabs="library"] .workspace-tab[data-tab-key="${key}"]{--cat:var(--cat-`),
      `U3: the ${key} chip carries the ${key} category token`);
  }
  ok(/\.library-card-shell\[data-reference-category\] \.library-preview\{/.test(css),
    "U3: the category cue reaches the media well");
  /* RESTRAINT IS PART OF THE REQUIREMENT: an inset hairline, never a fill. */
  ok(/box-shadow:inset 0 0 0 1px color-mix\(in srgb,var\(--cat\)/.test(css),
    "U3: the well's cue is a 1px inset ring, not a background");
  eq(/\.library-preview\{[^}]*background:var\(--cat\)/.test(css), false,
    "U3: no category colour fills a card");
  /* Canon is production truth and All is the current action; neither is a category. */
  eq(css.includes(`.workspace-tab[data-tab-key="canon"]{--cat`), false,
    "U3: Canon keeps Canon semantics and is not given a category colour");
  eq(css.includes(`.workspace-tab[data-tab-key="all"]{--cat`), false,
    "U3: All stays the neutral current action");

  /* =======================================================================
     U4 — AN EMPTY CARD STOPS REPEATING ITS INSTRUCTION. */
  const shelf = (await render("#/library/characters", emptyReferenceFixture())).html;
  ok(/class="library-card-shell" data-reference-category="characters"/.test(shelf),
    "U4: the shelf renders category-declaring cards");
  eq(/Add the first reference/.test(shelf), false,
    "U4: no card repeats the instruction line");
  ok(/class="library-add-cue" aria-hidden="true"/.test(shelf),
    "U4: an empty card still offers an add affordance, and it is decorative");
  /* ONE FOCUS TARGET PER CARD. The affordance must not add a tab stop to every
     empty card on a shelf of twenty-seven, so it lives inside the card's link. */
  const card = within(shelf, `<div class="library-card-shell" data-reference-category="characters">`, "</div></div>");
  eq(/<button/.test(card.split("library-add-cue")[0].split("<a class=\"library-card")[1] || ""), false,
    "U4: the cue is not a second focusable control on the card");
  ok(/<a class="library-card [^"]*"[^>]*>[\s\S]*library-add-cue/.test(shelf),
    "U4: the cue sits inside the card's own link, which is the one focus target");

  /* =======================================================================
     U5, U6, U8 — THE EMPTY REFERENCE STATES ONE TASK AND TWO PATHS. */
  const empty = (await render("#/character/CHAR-EMPTY", emptyReferenceFixture())).html;
  ok(/class="reference-primary-hero is-missing"[^>]*data-first-task="primary"/.test(empty),
    "U5: with no primary, no candidates and no media, the hero composes the first task");
  ok(/Create the image that establishes Rex Vandar&#39;s appearance for this production|Create the image that establishes Rex Vandar's appearance for this production/.test(empty),
    "U5: the task says what the image is for");
  const pathsBlock = within(empty, `<div class="reference-primary-paths">`, "</div>");
  const pathButtons = [...pathsBlock.matchAll(/<button class="([^"]+)"[^>]*onclick="([^"]+)"[^>]*>([^<]*)</g)];
  eq(pathButtons.length, 2, "U5: exactly two paths are offered");
  const labels = pathButtons.map(([, , , text]) => text.trim());
  ok(labels.includes("Generate reference"), "U5: Generate reference is one of them");
  ok(labels.includes("Upload existing"), "U6: Upload existing is the other");
  /* U5's whole point: this routes to the workflow that already existed rather
     than to anything new. `openEntityCreationSection` is the same handler the
     assisted-tools fold's "Build primary prompt" has always called. */
  const generate = pathButtons.find(([, , , text]) => text.trim() === "Generate reference");
  ok(generate[2].includes("openEntityCreationSection"),
    "U5: Generate routes to the existing reference builder, not to new machinery");
  const upload = pathButtons.find(([, , , text]) => text.trim() === "Upload existing");
  ok(upload[2].includes("entity-file"), "U6: Upload keeps the existing file-import handler");
  /* U6 — the upload is a standard control, and its explanation is not inside it. */
  eq(/Upload existing<\/button>/.test(pathsBlock), true,
    "U6: the upload is a single-line action, not a two-line banner");
  eq(/<small>/.test(pathsBlock), false, "U6: no path button carries a second line inside it");
  ok(/class="reference-path-note"/.test(empty),
    "U6: the explanatory copy sits outside the buttons");
  /* WITH NO GENERATION PROVIDER CONFIGURED, the fixture's own state, the primary
     weight belongs to the path that can actually complete. */
  ok(upload[1].includes("approve-btn recommended") && generate[1].includes("ghost-btn"),
    "U5: with generation unconfigured, Upload carries the primary weight and Generate does not claim it");
  /* U8 — coverage stays visible and stays second. */
  const afterLine = within(empty, `<small class="reference-primary-after">`, "</small>");
  ok(afterLine.trim().startsWith("After the primary is approved:"),
    "U8: what comes after the primary is stated as sequence, not as a backlog already owed");

  /* =======================================================================
     U7 — AN EMPTY DECISION SURFACE DOES NOT COMPETE WITH THE FIRST TASK,
     AND A CANDIDATE RESTORES THE WHOLE WORKFLOW. */
  const emptyFold = /<details class="fold compact-entity-section entity-candidate-section bounded-source-section" data-candidates="0" >/.test(empty);
  ok(emptyFold, "U7: at zero the fold carries its real count and is not open");
  eq(/data-candidates="0" open>/.test(empty), false,
    "U7: with nothing waiting, the fold is quiet rather than open");

  /* One imported file on the reference and nothing assigned to it — the shape
     an upload leaves behind, which is what a candidate IS. Scan rows carry a
     name and a url, the same as the ones the server produces. */
  const withCandidate = emptyReferenceFixture();
  /* DISCOVERY IS NOT OWNERSHIP — a filename that merely looks like this
     reference's is a "possible match", not a candidate. `candidateFiles` is the
     durable claim an upload writes, so the fixture writes one too rather than
     relying on the prefix, which would have produced an unclaimed file and a
     decision surface that was correctly still empty. */
  withCandidate.characters[0].candidateFiles = [{ stored: "CHAR-EMPTY-CANDIDATE.png", original: "rex-01.png" }];
  const busy = (await render("#/character/CHAR-EMPTY", withCandidate, {
    scan: {
      anchors: [{ name: "CHAR-EMPTY-CANDIDATE.png", url: "/assets/anchors/CHAR-EMPTY-CANDIDATE.png" }],
      plates: [], props: [], vehicles: [], audio: [], media: [], shots: {},
    },
  })).html;
  ok(/data-candidates="1" open>/.test(busy),
    "U7: the moment something is waiting, the decision surface is open again with its real count");
  ok(/class="entity-candidate-filters"/.test(busy),
    "U7: the workflow filters come back with the candidate");
  /* The hero stops composing the first-task state once there is something to decide. */
  eq(/data-first-task="primary"/.test(busy), false,
    "U7: with a candidate present the hero returns to its normal next-action shape");

  console.log(`Dogfood UX clarity suite passed ${checks} checks across provider truth (U1), disabled-capability legibility with settings preserved (U2), category identity on the shelf (U3), the empty card's repeated line (U4), one first task with the two existing paths (U5/U6), and the quiet-then-restored decision surface with coverage kept second (U7/U8). Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
