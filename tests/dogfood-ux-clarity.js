/* DOGFOOD UX CLARITY V1 — the eight things a real production run could not read.
 *
 * Every check below is a state a filmmaker was actually standing in when they
 * tried to start The Last Seat, written as the thing they could not tell:
 *
 *   U1  which provider the chip they pressed actually talks to, and in what protocol
 *   A1  what Braidy uses, whether it is connected, and whether Vision/Continuity are on
 *   A2  provider choice living inside Configure rather than leading the screen
 *   A3  the minimum connection immediate, tuning one step deeper
 *   A4  Vision and Continuity configuring themselves
 *   A5  Test belonging to Braidy and naming what it checks
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
/* Everything in `block` after `key`. A disclosure that CONTAINS another one
   cannot be sliced with `within`, because the first </details> encountered
   closes the inner disclosure and would hide the rest of the outer one. */
function afterKey(block, key) {
  const start = block.indexOf(key);
  assert.ok(start >= 0, `expected to find ${key}`);
  return block.slice(start + key.length);
}

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
     U1/A1 — A PROVIDER IS NAMED FOR THE SERVER IT ACTUALLY TALKS TO.
     The detour dogfood hit was a 404: "Local AI" was picked for a vLLM server,
     and `ollama` posts Ollama's own /api/chat, which vLLM does not serve. */
  const views = read("public/views.js");
  const server = read("src/server/server.js");
  const llm = read("src/assistant/llm.js");

  ok(/\["ollama", "Ollama",/.test(views), "U1: the Ollama choice is named Ollama");
  ok(/\["custom", "OpenAI-compatible server",/.test(views),
    "U1: the custom choice is named for the protocol it speaks");
  ok(/vLLM, LM Studio, llama\.cpp/.test(views),
    "U1: the OpenAI-compatible choice names the servers that belong to it");
  /* THE IDS ARE THE STORED VALUES AND MUST NOT MOVE. A rename that migrated
     settings would be a different change from the one this pass made. */
  ok(/"ollama"/.test(views) && /"custom"/.test(views), "U1: the provider ids are unchanged");
  ok(/setAssistantProvider\('none'\)/.test(views),
    "A2: turning Braidy off is still the same `none` provider id");
  /* No user-facing label may still claim the old, untrue names. */
  eq(/>Local AI</.test(views), false, "U1: nothing still reads Local AI");
  eq(/>Custom server</.test(views), false, "U1: nothing still reads Custom server");
  eq(/"Local AI"|"Custom AI server"/.test(server), false,
    "U1: the server's provider label map names the real providers");
  eq(/"Local AI"|"Local vision"|"Custom AI server"/.test(llm), false,
    "U1: a runtime error names the server it actually called");
  ok(/"Ollama"/.test(llm) && /"OpenAI-compatible server"/.test(llm),
    "U1: llm.js labels name Ollama and the OpenAI-compatible server");

  /* =======================================================================
     A1 — CAPABILITY STATUS IS THE DEFAULT SURFACE. */
  const settingsHtml = (await render("#/settings", buildFixture(),
    { storage: { "cinebraid-focused:fixture:settings-task:settings": "assistant" }, agentStatus: { capabilities: { text: {standing:"ready",ready:true}, vision: {standing:"off",ready:false}, continuity: {standing:"off",ready:false} } } })).html;

  const cards = [...settingsHtml.matchAll(/<article class="capability-card" data-capability="([a-z]+)" data-state="([a-z]+)">/g)];
  eq(cards.length, 3, "A1: three capability cards carry the default surface");
  assert.deepStrictEqual(cards.map(([, name]) => name), ["braidy", "vision", "continuity"],
    "A1: Braidy first, then Vision, then Continuity");
  checks++;
  const cardBlock = (name) => within(settingsHtml,
    `data-capability="${name}"`, "</article>");
  /* Braidy states what it resolves to: the configured model id, the provider's
     real name, and the address of a server the filmmaker started themselves. */
  const braidy = cardBlock("braidy");
  ok(/<span class="capability-name">Braidy<\/span>/.test(braidy), "A1: the card is named Braidy");
  ok(braidy.includes("qwen3.8-27b-fp8"), "A1: Braidy prints the exact configured model id");
  ok(braidy.includes("OpenAI-compatible server"), "A1: and the provider it resolves to");
  ok(/<code>127\.0\.0\.1:18434<\/code>/.test(braidy),
    "A1: and the endpoint identity, host and port, not the whole URL");
  /* The fixture has no live status yet, so the panel must say it is checking
     rather than borrow "not reachable" from a question nobody has asked. */
  ok(/data-capability="braidy" data-state="(on|checking|unreachable)"/.test(settingsHtml),
    "A1: Braidy's state is derived from readiness, not asserted");
  /* A1 — A BLANK VISION MODEL IS NOT AN ACTIVE PROVIDER. */
  const vision = cardBlock("vision");
  ok(/data-capability="vision" data-state="off"/.test(settingsHtml),
    "A1: vision with no usable model reads off");
  ok(/<b class="capability-status">Off<\/b>/.test(vision),
    "A1: and says Off rather than naming a provider it cannot use");
  const continuity = cardBlock("continuity");
  ok(/data-capability="continuity" data-state="off"/.test(settingsHtml),
    "A1: unconfigured continuity reads off");
  ok(/<b class="capability-status">Off<\/b>/.test(continuity), "A1: and says so");

  /* A5 — TEST BELONGS TO BRAIDY AND SAYS WHAT IT CHECKS. */
  ok(/class="ghost-btn capability-test"[^>]*onclick="testAssistantConnection\(\)"/.test(braidy),
    "A5: the Test action lives in Braidy's card and calls the existing endpoint");
  eq(/testAssistantConnection/.test(vision) || /testAssistantConnection/.test(continuity), false,
    "A5: Vision and Continuity are given no test of their own in this pass");
  ok(/aria-label="Send a test message to OpenAI-compatible server"/.test(braidy),
    "A5: and it names the resolved text assistant it checks");
  ok(settingsHtml.includes(`id="assistant-test-note"`),
    "A5: the existing result element is still the one the test writes into");

  /* =======================================================================
     A2/A3/A4 — CONFIGURATION IS ONE INTERACTION DEEPER, IN THE RIGHT CARD. */
  /* A card's Configure runs to the end of that card, not to the first
     </details> — Advanced is nested inside it and would otherwise cut the slice
     short, hiding everything below it from these assertions. */
  const configureOf = (name, key) => afterKey(cardBlock(name), `data-ui-state-key="${key}"`);
  const braidyConfigure = configureOf("braidy", "assistant-configure:braidy");
  const visionConfigure = configureOf("vision", "assistant-configure:vision");
  const continuityConfigure = configureOf("continuity", "assistant-configure:continuity");
  /* NOT OPEN BY DEFAULT is the whole point: at page entry the surface is status,
     not plumbing. */
  for (const key of ["assistant-configure:braidy", "assistant-configure:vision", "assistant-configure:continuity"]) {
    eq(new RegExp(`data-ui-state-key="${key}" open`).test(settingsHtml), false,
      `A1: ${key} is closed at page entry`);
  }
  ok(braidyConfigure.includes('assistant-tier-options'), 'A2: capability first offers execution tier');
  ok(braidyConfigure.includes('setAssistantProvider(') && braidyConfigure.includes('#/settings/assistant-custom'), 'A2: runtime selection and its connection are deliberate');
  ok(visionConfigure.includes('assistant-vision-provider') && !visionConfigure.includes('#/settings/assistant-custom'), 'A4: an explicitly off image reader retains selection without a connection action');
  const activeVision=(await render('#/settings/assistant',buildFixture(),{agentStatus:{capabilities:{vision:{standing:'ready',ready:true}}}})).html;
  ok(activeVision.includes('#/settings/assistant-custom'), 'A4: the configured active reader links to its connection');
  for(const id of ['cfg-continuity-provider','cfg-continuity-base','cfg-continuity-model'])ok(continuityConfigure.includes(`id="${id}"`),'A4: continuity retains '+id);
  const connection=(await render('#/settings/assistant-custom',buildFixture())).html;
  for(const id of ['cfg-custom-url','cfg-custom-key','cfg-custom-model','cfg-custom-vision','cfg-custom-temperature','cfg-custom-top-k','cfg-custom-thinking'])ok(connection.includes(`id="${id}"`),'save: connection retains '+id);
  const advanced=connection.match(/<details[^>]*>[\s\S]*?Advanced request options[\s\S]*?<\/details>/)?.[0]||'';
  ok(advanced && !/^<details[^>]* open/.test(advanced),'advanced request controls are collapsed');
  for(const id of ['cfg-custom-temperature','cfg-custom-top-k','cfg-custom-thinking'])ok(advanced.includes(`id="${id}"`),'tuning remains in advanced '+id);
  for(const id of ['cfg-custom-url','cfg-custom-key','cfg-custom-model'])eq(advanced.includes(`id="${id}"`),false,'connection essentials remain outside advanced '+id);
  for(const id of ['cfg-ollama' ,'cfg-key','cfg-openai-key'])eq(connection.includes(`id="${id}"`),false,'save: unrelated provider field absent '+id);
  ok(connection.includes('value="http://127.0.0.1:18434/v1"') && connection.includes('qwen3.8-27b-fp8'),'save: configured values round-trip');
  ok(/id="cfg-custom-thinking"[\s\S]{0,400}?<option value="disabled" selected>/.test(connection),'save: thinking selection round-trips');
  for(const [standing,state] of [['off','off'],['ready','ready'],['configured-unavailable','unavailable'],['checking','checking']]){
    const h=(await render('#/settings/assistant',buildFixture(),{agentStatus:{capabilities:{vision:{standing,ready:standing==='ready'}}}})).html;
    ok(h.includes(`data-capability="vision" data-state="${state}"`),'capability standing is authoritative: '+standing);
  }

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
  ok(labels.includes("Generate primary reference"), "U5: Generate primary reference is one of them");
  ok(labels.includes("Upload existing"), "U6: Upload existing is the other");
  /* U5's whole point was that this routes to the workflow that already existed rather
     than to anything new. REFERENCE_FIRST_CANON_SIMPLIFICATION_V1 keeps that and removes
     the stop in the middle: generatePrimaryReference() runs the SAME rules-based builder
     (buildAssetCreationPrompt) and then opens the SAME paid preflight
     (openFalEntityGenerationModal), which is where the old route ended after four more
     presses. tests/reference-first-canon.js proves the composition and that nothing is
     submitted by it. */
  const generate = pathButtons.find(([, , , text]) => text.trim() === "Generate primary reference");
  ok(generate[2].includes("generatePrimaryReference("),
    "U5: Generate runs the existing builder and the existing paid preflight, not new machinery");
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

  console.log(`Dogfood UX clarity suite passed ${checks} checks across provider truth (U1), capability status as the default surface with configuration one step deeper and the save body unmoved (A1-A5), category identity on the shelf (U3), the empty card's repeated line (U4), one first task with the two existing paths (U5/U6), and the quiet-then-restored decision surface with coverage kept second (U7/U8). Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
