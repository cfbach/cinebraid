/* CineBraid — Batch 2, Slice 2: PROJECT ENTRY & IMPORT LANDING.
 *
 * The founder smoke found the first screen of the product answering a question the
 * filmmaker had not asked. "How do you want to start?" offered "Build manually" and
 * "Import with an LLM": one CineBraid workflow and one piece of somebody else's
 * software. A filmmaker holding a script had to work out that LLM was the door
 * marked *script*; a filmmaker holding a CineBraid project someone had sent them
 * had no door at all, because that import silently shared the LLM one.
 *
 * Four more things went wrong behind that door, and this suite is organised around
 * them because each one was reproduced before it was fixed:
 *
 *   * Switching paths destroyed everything typed or pasted. route() rebuilt #main,
 *     the textareas came back empty, and a whole assistant session's output was gone
 *     to one mis-click with no undo and no warning.
 *   * The review step listed five columns of findings and never said whether the
 *     import could proceed.
 *   * `[INFERRED FOR PLANNING] …` — CineBraid's own import bookkeeping — was written
 *     INTO continuity-state prose, which is the "State change / delta" field the
 *     filmmaker edits and the string the continuity contract receives as `stateDelta`.
 *   * A successful import set the hash back to #/create and returned the filmmaker to
 *     the chooser, having answered nothing about what had just been created.
 *
 * WHAT THIS SUITE PROVES AND WHERE:
 *
 *   A  the three frozen intents are the entry, in order, with the frozen words
 *   B  the assisted path's primary framing names no provider, model or runtime
 *   C  the CineBraid import is a distinct intent over the SAME accepted mechanism
 *   D  scratch remains reachable and renders the manual workspace
 *   E  entered material survives a path switch, and does not cross between paths
 *   F  format and aspect persist through the existing meta fields and shared presets
 *   G  the global visual style is offered, never demanded, and never removed
 *   H  Ready / Needs review / Blocked is a projection of the server's own review
 *   I  the planning marker cannot reach creative text, and real prose is untouched
 *   J  a successful import lands on a next-steps state, not on the chooser
 *   K  that landing's next action is projectNextProductionAction(), rendered through
 *      the one markup function that already owned it
 *   L  Slice 1's shell decisions are untouched
 *   M  nothing from Slice 3, 4 or 5 leaked into this surface
 *   N  an in-flight file read belongs to the intent that started it
 *   O  an authored planning marker is preserved while a generated one never appears
 *   P  a null next action produces no locally chosen production action
 *   Q  the stage strip describes the rendered workspace, not the requested URL
 *   R  the review never attributes the filmmaker's own prose to CineBraid
 *   S  an async validation or import belongs to the intent that started it
 *   T  source-origin wording claims presence, never intent, and a cross-origin
 *      collision at one path survives de-duplication
 *
 * Section I runs the real server, because the leak was in the real normalizer and a
 * source-level claim about it would prove nothing. Everything else runs in the render
 * harness, where the shipped scripts are evaluated and the shipped markup is read.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const net = require("net");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PLANNING_MARKER_IN = /\[INFERRED FOR PLANNING\]/i;
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const { render, buildFixture } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

const CREATION_STUDIO = read("public/creation-studio.js");
/* Comments are stripped wherever this suite asks "is that absent?" — the notes above
   each change name exactly what was retired, which is what a reader needs and exactly
   what an absence check must not trip over. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

function createRender(options = {}) {
  return render("#/create", options.project || buildFixture(), options);
}

/* =========================================================================
   A. THE ENTRY IS THE THREE INTENTS.
   ========================================================================= */
async function sectionEntryIsIntentFirst() {
  const { html, context } = await createRender();
  /* Parsed back through JSON: an array built inside the harness realm has a
     different Array.prototype, so deepStrictEqual against a host literal fails while
     printing something identical. */
  const intents = JSON.parse(vm.runInContext("JSON.stringify(CREATION_INTENTS.map((i) => [i.key, i.title, !!i.recommended]))", context));
  /* The words changed after the founder dogfood, for the reason the comment above
     already gives: a card names what the FILMMAKER has, and the action underneath is
     the obvious next move. The CineBraid card is the one the founder could not tell
     apart from the assisted one at a glance, so its title now names the file type
     itself. The order and the single recommendation are unchanged. */
  assert.deepStrictEqual(intents, [
    ["assisted", "Build with an AI assistant", true],
    ["cinebraid", "Open a CineBraid project file", false],
    ["scratch", "Start manually", false],
  ], "A. the three starting intents are frozen, in this order, and only the first is recommended");

  /* THE CINEBRAID CARD IS UNAMBIGUOUS BEFORE IT IS SELECTED. The founder read the
     two import paths as twins; the distinction has to survive at card level, in the
     one sentence a filmmaker reads before clicking anything. */
  const cineCard = JSON.parse(vm.runInContext("JSON.stringify(CREATION_INTENTS[1])", context));
  assert(/\.json/i.test(cineCard.blurb), "A. the CineBraid card must name the file type it takes");
  assert(/not for scripts or treatments/i.test(cineCard.blurb),
    "A. and must say, on the card itself, what it does not take");

  const rendered = [...html.matchAll(/data-creation-intent="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(rendered, ["assisted", "cinebraid", "scratch"],
    `A. the chooser must offer exactly the three intents in order, rendered ${JSON.stringify(rendered)}`);
  for (const [, title] of intents)
    assert(html.includes(title), `A. the chooser must say "${title}"`);
  assert(/aria-pressed="true"/.test(html), "A. the selected intent must be announced as pressed");
  assert(html.includes("Recommended"), "A. the recommended path must be marked as such");

  /* The retired framing, gone from the product rather than merely unselected. */
  const code = codeOnly(CREATION_STUDIO);
  assert(!/Import with an LLM/i.test(code), "A. the retired 'Import with an LLM' framing must not survive");
  assert(!/Two paths, one production-ready project/i.test(code), "A. the two-path headline must not survive");
  note(`A. #/create opens on ${rendered.join(" / ")}, the recommended one marked, and the retired LLM framing is gone`);
}

/* =========================================================================
   B. THE ASSISTED PATH IS NOT A PROVIDER SCREEN.
   ========================================================================= */
/* TWO DIFFERENT BANS, because they were protecting two different things and one list
   was doing both jobs.

   RUNTIME_JARGON is the real rule: the assisted path must never become a provider
   screen. None of these words may appear ANYWHERE on the card, which is a stronger
   guard than the single list this suite used to apply to the heading alone.

   The named consumer assistants are the opposite of a ban. The founder dogfood found
   a filmmaker unable to tell whether the conversion happened inside CineBraid, inside
   Braidy, or somewhere else, and no amount of "the AI assistant you already use"
   answered it. Naming ChatGPT, Claude and Gemini is the shortest true answer, so they
   are REQUIRED in the card's lead paragraph and still barred from the intent's own
   words on the chooser, which name what the filmmaker has rather than what they should
   go and open. */
const RUNTIME_JARGON = ["LLM", "GPT", "Ollama", "API key", "endpoint", "temperature", "token", "provider", "model"];
const NAMED_ASSISTANTS = ["ChatGPT", "Claude", "Gemini"];
const IMPLEMENTATION_JARGON = [...RUNTIME_JARGON, ...NAMED_ASSISTANTS];
async function sectionAssistedFraming() {
  const { html, context } = await createRender();
  const intent = vm.runInContext("JSON.stringify(CREATION_INTENTS[0])", context);
  const primary = JSON.parse(intent);
  const framing = `${primary.eyebrow} ${primary.title} ${primary.blurb}`;
  for (const word of IMPLEMENTATION_JARGON)
    assert(!new RegExp(`\\b${word}\\b`, "i").test(framing),
      `B. the assisted intent's own words must not lead with "${word}": ${framing}`);
  assert(/script|treatment|notes/i.test(primary.eyebrow),
    "B. the assisted intent must be labelled by what the filmmaker has");

  /* And the whole card, not only its heading, stays free of runtime jargon. */
  const head = html.slice(html.indexOf('id="creation-assisted"'));
  const card = head.slice(0, head.indexOf("</section>"));
  for (const word of RUNTIME_JARGON)
    assert(!new RegExp(`\\b${word}\\b`, "i").test(card),
      `B. the assisted card must not turn into a provider screen: "${word}"`);

  /* "LLM" is the specific word the old surface put in front of the filmmaker. It is
     gone from every path of this view, not merely demoted. */
  for (const stored of ["assisted", "cinebraid", "scratch"]) {
    const view = await createRender({ storage: { "cinebraid-creation-start-path": stored } });
    assert(!/\bLLM\b/.test(view.html), `B. "${stored}" must not render the word LLM`);
  }
  /* And the assisted path really does ask for the material, first. */
  assert(html.includes('id="creation-source-material"'), "B. the assisted path must offer a place for the script or story");
  assert(html.indexOf('id="creation-source-material"') < html.indexOf('id="project-builder-json"'),
    "B. the filmmaker's own material must come before the machine-readable step");
  note(`B. the assisted intent leads with "${primary.title}" and no path of #/create contains the word LLM`);
}

/* =========================================================================
   C. THE CINEBRAID IMPORT IS ITS OWN INTENT, OVER THE SAME MECHANISM.
   ========================================================================= */
async function sectionCineBraidImportDistinct() {
  const cine = await createRender({ storage: { "cinebraid-creation-start-path": "cinebraid" } });
  const assisted = await createRender({ storage: { "cinebraid-creation-start-path": "assisted" } });

  assert(cine.html.includes('id="creation-cinebraid"'), "C. the CineBraid intent must render its own card");
  assert(!cine.html.includes('id="creation-assisted"'), "C. and must not render the assisted card underneath it");
  assert(!assisted.html.includes('id="creation-cinebraid"'), "C. nor the other way round");
  assert(!cine.html.includes('id="creation-source-material"'),
    "C. importing a CineBraid project must not ask for a script — there is no assistant in this path");
  /* The path says what it wants in its first sentence. "No assistant is involved" was
     the earlier wording; it stated the fact by negation, which took a paragraph to
     land. The positive form is shorter and is the thing the filmmaker has to check
     against the file in their hand. */
  assert(/This expects a CineBraid project JSON/i.test(cine.html),
    "C. the CineBraid path must say what it expects, before anything else");
  for (const word of NAMED_ASSISTANTS)
    assert(!new RegExp(`\\b${word}\\b`, "i").test(cine.html.slice(cine.html.indexOf('id="creation-cinebraid"'))),
      `C. and must not name ${word} — there is no assistant in this path`);

  /* THE SAME ACCEPTED MECHANISM, NOT A SECOND ONE. Both cards render one JSON box,
     one result region, and one validate control, because the preview/commit path
     underneath them is the shipped one. */
  for (const [label, view] of [["cinebraid", cine.html], ["assisted", assisted.html]]) {
    assert.strictEqual((view.match(/id="project-builder-json"/g) || []).length, 1, `C. ${label}: one JSON box`);
    assert.strictEqual((view.match(/id="project-builder-result"/g) || []).length, 1, `C. ${label}: one result region`);
    assert(view.includes("importProjectBuilderJSON()"), `C. ${label}: the shipped validate handler`);
  }
  const code = codeOnly(CREATION_STUDIO);
  assert.strictEqual((code.match(/preview-import-json/g) || []).length, 1,
    "C. there must be exactly one caller of the preview endpoint — a second import path would be a second architecture");
  assert.strictEqual((code.match(/projects\/import-json/g) || []).length, 1,
    "C. and exactly one caller of the commit endpoint");
  note("C. the CineBraid intent is a separate card with no assistant framing, and both import intents share the single shipped preview/commit pair");
}

/* =========================================================================
   D. SCRATCH IS STILL THERE, AND IS NOW ONLY THE NEW PROJECT'S DRAFT.

   B2. This section used to require addEntity(), addShot() and "PROJECT AT A
   GLANCE" on the create screen, and every one of those is about the film the
   filmmaker ALREADY HAS OPEN: the two creation controls write records into it,
   and the glance rendered its scene, shot and approval counts on a screen that
   promises "The one you have open now is not changed." Independent boundary
   review reproduced the writer beside them. So the requirement is inverted, not
   dropped: scratch renders the draft and says where the rest lives.
   ========================================================================= */
async function sectionScratchRemains() {
  const { html } = await createRender({ storage: { "cinebraid-creation-start-path": "scratch" } });
  assert(html.includes('id="creation-scratch"'), "D. the scratch intent must render the manual workspace");
  assert(html.includes("data-manual-identity"), "D. which is the new project's own identity card");
  assert(html.includes("data-manual-start-commit"), "D. and the one act that creates it");
  for (const control of ["addEntity('locations')", "addEntity('characters')", "addShot()"])
    assert(!html.includes(control), `D. and it must NOT offer ${control}, which writes the open project`);
  assert(html.includes("PROJECT AT A GLANCE"),
    "D. the read-only glance stays — reading the open project is not editing it");
  assert(html.includes("data-manual-after-create"), "D. it says where those tools live once this project exists");
  note("D. the scratch intent renders the new project's draft plus a read-only glance — every writer into the open project is retired from it");
}

/* =========================================================================
   E. ENTERED MATERIAL SURVIVES A PATH SWITCH.

   This is the reproduction, run forwards: put material in, switch away, switch back,
   and read the markup the filmmaker would be looking at. Before this slice the
   textarea came back empty — proven in a real browser in
   tests/project-entry-real-browser.py, which is where a genuine paste can happen.
   ========================================================================= */
const PASTED = '{"meta":{"title":"Two hours of work"},"scenes":[]}';
const SCRIPT = "INT. DOCK - NIGHT\nAda walks the length of the dock.";
async function sectionSwitchingPreservesInput() {
  const { context, map } = await createRender({ storage: { "cinebraid-creation-start-path": "cinebraid" } });
  /* route() is async, so the markup a filmmaker would be looking at is only settled
     once it has resolved. setCreationStartPath fires its own route() and does not
     await it — shipped behaviour — so this awaits one of its own afterwards. */
  const renderNow = async () => {
    await vm.runInContext("route()", context);
    return map.get("main").innerHTML;
  };

  /* A textarea's content is escaped on the way out, so the comparison is made through
     the page's own escaper rather than against the raw string. */
  const asRendered = vm.runInContext(`esc(${JSON.stringify(PASTED)})`, context);
  vm.runInContext(`setCreationDraft("cinebraid:json", ${JSON.stringify(PASTED)})`, context);
  assert((await renderNow()).includes(asRendered), "E. precondition: the pasted document renders on its own path");

  vm.runInContext("setCreationStartPath('scratch')", context);
  assert(!(await renderNow()).includes(asRendered), "E. precondition: the scratch workspace does not render the import box at all");
  vm.runInContext("setCreationStartPath('cinebraid')", context);
  assert((await renderNow()).includes(asRendered),
    "E. switching away and back must return the pasted document, not an empty box");

  /* Each intent owns its own material. An assistant's output must not overwrite the
     CineBraid document the filmmaker is holding, and neither must the reverse. */
  vm.runInContext(`setCreationDraft("assisted:story", ${JSON.stringify(SCRIPT)})`, context);
  vm.runInContext("setCreationStartPath('assisted')", context);
  const assistedHtml = await renderNow();
  assert(assistedHtml.includes("Ada walks the length of the dock."), "E. the script survives on the assisted path");
  assert(!assistedHtml.includes("Two hours of work"), "E. and the CineBraid document does not bleed into it");
  vm.runInContext("setCreationStartPath('cinebraid')", context);
  assert((await renderNow()).includes(asRendered), "E. while the CineBraid document is still exactly where it was left");

  /* The stated lifetime, asserted rather than described: nothing durable was written. */
  const drafted = vm.runInContext("[...window.__cinebraidCreationDrafts.keys()].sort().join(',')", context);
  assert.strictEqual(drafted, "assisted:story,cinebraid:json", `E. one buffer per intent, got ${drafted}`);
  assert(!codeOnly(CREATION_STUDIO).includes("localStorage.setItem(creationDraftKeys"),
    "E. entered source material must not be persisted — the lifetime is this tab");
  note("E. a pasted document survives switching away and back, the two intents keep separate buffers, and neither is persisted");
}

/* =========================================================================
   F. FORMAT AND ASPECT: TYPED CONTROLS OVER THE FIELDS THAT ALREADY EXISTED.
   ========================================================================= */
/* The create modal is exercised through the harness's own fetch hook rather than by
   replacing globalThis.fetch: the modal's submit ends in load(), and a stub that
   answers /api/project with an empty object leaves the page with no project at all. */
function capturingNewProjectRender(options = {}) {
  const captured = { body: null };
  const hook = async (url, requestOptions, respond) => {
    if (url === "/api/projects/new" && requestOptions.method === "POST") {
      captured.body = JSON.parse(requestOptions.body);
      return respond({ ok: true, slug: "typed-project" });
    }
    return null;
  };
  return createRender({ ...options, fetch: hook }).then((rendered) => ({ ...rendered, captured }));
}
async function sectionFormatAndAspect() {
  const { context, captured } = await capturingNewProjectRender();
  vm.runInContext("newProject()", context);

  const fields = vm.runInContext("JSON.stringify(document.getElementById('modal').innerHTML)", context);
  const modal = JSON.parse(fields);
  assert(modal.includes('id="ff-format"'), "F. the modal must offer a format control");
  assert(modal.includes('id="ff-aspectRatio"'), "F. and an aspect control");

  /* The aspect options ARE the shared presets — the same list every other aspect
     control in the product reads, so a project cannot be created in a format the
     rest of the product does not recognise. */
  const presets = JSON.parse(vm.runInContext("JSON.stringify(CINEBRAID_ASPECT_PRESETS.map(([value]) => value))", context));
  for (const value of presets)
    assert(modal.includes(`value="${value}"`), `F. the aspect control must offer the shared preset ${value}`);

  vm.runInContext(`
    document.getElementById("ff-title").value = "Typed Project";
    document.getElementById("ff-format").value = "Short film";
    document.getElementById("ff-aspectRatio").value = "2.39:1";
    document.getElementById("ff-startMode").value = "cinebraid";
    _formSubmit();
  `, context);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const body = captured.body;
  assert(body, "F. the modal must reach /api/projects/new");
  assert.strictEqual(body.title, "Typed Project", "F. the title reaches the endpoint");
  assert.strictEqual(body.format, "Short film", "F. format is sent as the existing meta.format string");
  assert.strictEqual(body.aspectRatio, "2.39:1", "F. aspect is sent as the existing meta.aspectRatio string");

  /* And the chosen intent is what the create screen then opens on — the modal and the
     chooser cannot describe different paths. */
  const storedIntent = vm.runInContext("localStorage.getItem('cinebraid-creation-start-path')", context);
  assert.strictEqual(storedIntent, "cinebraid", `F. the modal's intent must be the chooser's intent, got ${storedIntent}`);

  /* Persistence is the existing model, unchanged: the project record still answers
     through the one shared resolver. */
  const label = vm.runInContext(`projectAspectLabel({ meta: { aspectRatio: "2.39:1" } })`, context);
  assert.strictEqual(label, "2.39:1", "F. the shared resolver still reads meta.aspectRatio");
  const fromFormat = vm.runInContext(`projectAspectLabel({ meta: { format: "2.39:1" } })`, context);
  assert.strictEqual(fromFormat, "2.39:1", "F. and the legacy meta.format fallback is untouched");

  /* No new persistent field was invented to make either control readable.

     Read the WHOLE route rather than its first 1400 characters: the slice was a
     proxy for "the part that builds the document", and a comment added above the
     response was enough to push a real field out of it. The persisted set is
     named explicitly, and `activate` is named explicitly as the one accepted
     field that is NOT persisted — it chooses whether the route also makes the
     new project current, which is a separate act (see B1's active-project
     fence). If it ever starts writing into the document, it belongs in the list
     above and this assertion fails until it is. */
  const routeStart = read("server.js").indexOf('app.post("/api/projects/new"');
  const newProjectRoute = read("server.js").slice(routeStart, read("server.js").indexOf("\n});", routeStart));
  const accepted = [...new Set([...newProjectRoute.matchAll(/req\.body\.(\w+)/g)].map((m) => m[1]))].sort();
  const PERSISTED = ["aspectRatio", "firstScene", "format", "globalNegativePrompt", "globalStylePrompt", "title", "worldSetting"];
  assert.deepStrictEqual(accepted, [...PERSISTED, "activate"].sort(),
    "F. project creation accepts exactly the fields it accepted before this slice, plus the non-persisted `activate` control");
  for (const field of PERSISTED)
    assert(newProjectRoute.includes(`blank.meta.${field}`) || field === "firstScene" || field === "worldSetting",
      `F. ${field} is still written into the created document`);
  assert(!/blank\.\w+[^\n]*activate/.test(newProjectRoute),
    "F. and `activate` is never written into the document — it only chooses whether the route activates the project");
  note(`F. format and aspect are typed selects that post ${JSON.stringify(body)} into the existing meta fields, from the shared preset list`);
}

/* =========================================================================
   G. THE GLOBAL LOOK IS OFFERED, NOT DEMANDED — AND NOT DELETED.
   ========================================================================= */
async function sectionGlobalStyleDeferred() {
  const { context } = await capturingNewProjectRender();
  vm.runInContext("newProject()", context);
  const modal = JSON.parse(vm.runInContext("JSON.stringify(document.getElementById('modal').innerHTML)", context));
  assert(!/ff-globalStyle/.test(modal), "G. creating a project must not ask for a global visual style");
  assert(!/visual style/i.test(modal), "G. nor mention one");

  /* B2. AND IT IS NOT ON THE CREATE SCREEN AT ALL ANY MORE.
   *
   * This used to assert the style card WAS on the create screen, "moved, not
   * removed". The move was the defect: its textareas write P.meta on the
   * currently open film and call dirty(), so a filmmaker setting a look for the
   * project they were about to create was editing the one they already had. It
   * is removed from that screen and still owned by Settings → Project, which is
   * what "not deleted" now means. */
  const blank = buildFixture();
  blank.meta.globalStylePrompt = "";
  blank.meta.styleBlocks = [];
  const scratch = await createRender({ project: blank, storage: { "cinebraid-creation-start-path": "scratch" } });
  assert(!scratch.html.includes('id="creation-global-style"'),
    "G. the style card must not be on the create screen — it writes the project already open");
  assert(!scratch.html.includes("setGlobalCreationField("),
    "G. and no create-screen control may reach that setter at all");
  assert(!/Start here/.test(scratch.html), "G. nothing on the create screen may demand the look first");

  /* THE CAPABILITY IS OWNED ELSEWHERE, NOT REMOVED. */
  const settings = await render("#/settings", buildFixture(), {
    storage: { "cinebraid-focused:fixture:settings-task:settings": "project" },
  });
  assert(settings.html.includes('id="cfg-global-visual-style"'), "G. Settings → Project still edits the global visual style");
  assert(settings.html.includes('list="cinebraid-format-presets"'), "G/F. and offers the same typed format suggestions the create screen does");
  note("G. the global look is absent from the create modal and from the create screen — where it edited the open project — and remains fully editable in Settings → Project");
}

/* =========================================================================
   H. READY / NEEDS REVIEW / BLOCKED, OFF THE SERVER'S OWN REVIEW.
   ========================================================================= */
async function sectionReviewStanding() {
  const { context } = await createRender();
  const standing = (review) => vm.runInContext(`projectEntryStanding(${JSON.stringify(review)}).label`, context);

  assert.strictEqual(standing({ missing: [], review: [], conflicts: [], inferred: [] }), "Ready",
    "H. an import the review found nothing in is Ready");
  assert.strictEqual(standing({ missing: [], review: ["Scene SC-01: add emotional or tonal intent"], conflicts: [], inferred: [] }), "Needs review",
    "H. a review line makes it Needs review");
  assert.strictEqual(standing({ missing: [], review: [], conflicts: [], inferred: [{ path: "a", value: "b" }] }), "Needs review",
    "H. so does an inferred value");
  assert.strictEqual(standing({ missing: ["Shot L1-01: action description"], review: [], conflicts: [], inferred: [] }), "Blocked",
    "H. a missing production input is Blocked");
  assert.strictEqual(standing({ missing: ["x"], review: ["y"], conflicts: ["z"], inferred: [{ path: "a", value: "b" }] }), "Blocked",
    "H. and missing outranks everything else");
  assert.strictEqual(standing({}), "Ready", "H. an empty payload states the empty answer rather than throwing");

  /* THE WORDS COME FROM THE REVIEW, NOT FROM HERE. */
  const reasons = vm.runInContext(`JSON.stringify(projectEntryStandingReasons({ missing: ["Shot L1-01: action description"], conflicts: [{ path: "characters[0].notes", value: "[SOURCE CONFLICT] two coats" }], review: ["Scene SC-01: no shots are assigned"] }))`, context);
  assert.deepStrictEqual(JSON.parse(reasons), [
    "Shot L1-01: action description",
    "Source conflict at characters[0].notes — [SOURCE CONFLICT] two coats",
    "Scene SC-01: no shots are assigned",
  ], "H. the standing repeats the review's sentences and never rewrites them");

  /* IT IS NOT A READINESS AUTHORITY. It never touches the readiness module, and the
     shot statuses it is deliberately NOT derived from are still the shipped ones. */
  const code = codeOnly(CREATION_STUDIO);
  const derivation = code.slice(code.indexOf("function projectEntryStanding("), code.indexOf("function projectEntryStandingMarkup("));
  for (const word of ["evaluateProjectReadiness", "projectShotReadiness", "READINESS", "NEEDS_DECISION"])
    assert(!derivation.includes(word), `H. the standing must not reach into readiness (${word})`);
  note("H. Ready / Needs review / Blocked is a pure projection of review.missing / review / conflicts / inferred, repeating the review's own sentences and touching no readiness derivation");
}

/* =========================================================================
   I. THE PLANNING MARKER CANNOT BECOME CREATIVE OUTPUT.

   Against the real server, because the leak was in the real normalizer.
   ========================================================================= */
/* Every adversarial authored shape independent review named, written by a filmmaker
   rather than produced by CineBraid. None of it may be altered by an import. */
const AUTHORED = {
  exact: "[INFERRED FOR PLANNING]",
  sentence: "Literal discussion: [INFERRED FOR PLANNING] is a bracketed phrase the prompt kit asks assistants to use.",
  lower: "we use [inferred for planning] in our own notes too",
  mixed: "House style: [Inferred For Planning] then a reason.",
  leading: "[INFERRED FOR PLANNING] at the very start of the note, written by me.",
  trailing: "Written by me, ending with [INFERRED FOR PLANNING]",
  multiple: "First [INFERRED FOR PLANNING] then more, then [INFERRED FOR PLANNING] again.",
  newlines: "Line one.\n[INFERRED FOR PLANNING] line two, mine.\nLine three.",
  punctuation: "See ([INFERRED FOR PLANNING]) — and also, [INFERRED FOR PLANNING]; yes.",
  conflict: "[SOURCE CONFLICT] Earlier draft says a blue coat.",
};
const AUTHORED_SOURCE = {
  meta: { title: "Marker Matrix", format: "Short film", notes: AUTHORED.sentence },
  characters: [{
    id: "CHAR-ADA", name: "Ada", description: AUTHORED.leading, notes: AUTHORED.conflict,
    driftNotes: AUTHORED.newlines,
    /* THE CASE A TEXTUAL STRIP CANNOT GET RIGHT: CineBraid makes an inference about
       THIS state (it has no default, so this one is chosen) while the filmmaker's own
       sentence about the marker is sitting in the very field the annotation used to be
       appended to. */
    continuityStates: [
      { id: "state-clean", name: "Clean coat", notes: AUTHORED.sentence },
      { id: "state-soaked", name: "Soaked coat", parentStateId: "state-clean", notes: AUTHORED.multiple },
    ],
  }],
  locations: [{ id: "LOC-DOCK", name: "Dock", description: AUTHORED.punctuation, continuityStates: [] }],
  props: [{ id: "PR-LAMP", name: "Lamp", description: AUTHORED.lower, continuityStates: [{ id: "s1", name: "Lit", isDefault: true, notes: AUTHORED.mixed }] }],
  vehicles: [],
  scenes: [{ id: "SC-01", title: "Arrival", whatHappens: AUTHORED.trailing, howItFeels: "Cold.", notes: AUTHORED.exact }],
  shots: [{
    id: "L1-01", scene: "SC-01", title: "Dock walk", desc: "Ada walks the length of the dock.",
    positioning: "Locked wide.", characters: ["CHAR-ADA"], codes: ["LOC-DOCK"],
    notes: AUTHORED.newlines, risks: [AUTHORED.exact, "ordinary risk"],
    clips: [{ kind: "i2v", dur: 6, motionPrompt: AUTHORED.sentence }],
  }],
};
const AUTHORED_CHECKS = [
  ["meta.notes", "sentence", "an authored sentence about the convention"],
  ["characters[0].description", "leading", "marker at the very start"],
  ["characters[0].notes", "conflict", "[SOURCE CONFLICT] left exactly alone"],
  ["characters[0].continuityStates[0].notes", "sentence", "the field CineBraid ALSO made an inference about"],
  ["characters[0].continuityStates[1].notes", "multiple", "two markers in one delta"],
  ["characters[0].driftNotes", "newlines", "a marker alone on its own line"],
  ["locations[0].description", "punctuation", "markers wrapped in punctuation"],
  ["props[0].description", "lower", "lower case"],
  ["props[0].continuityStates[0].notes", "mixed", "mixed case"],
  ["scenes[0].whatHappens", "trailing", "marker at the end"],
  ["scenes[0].notes", "exact", "the marker and nothing else"],
  ["shots[0].notes", "newlines", "a shot note CineBraid also inferred a duration for"],
  ["shots[0].risks[0]", "exact", "inside an array"],
  ["shots[0].clips[0].motionPrompt", "sentence", "inside a nested object"],
];
function valueAt(project, dotted) {
  return dotted.split(".").reduce((node, key) => {
    const indexed = key.match(/^(\w+)\[(\d+)\]$/);
    return indexed ? node?.[indexed[1]]?.[Number(indexed[2])] : node?.[key];
  }, project);
}

const LEAK_SOURCE = {
  meta: { title: "Marker Boundary", format: "Short film" },
  characters: [{
    id: "CHAR-ADA", name: "Ada", description: "A dock engineer in a patched grey coat.",
    continuityStates: [
      /* Real authored prose, which must come back byte for byte. */
      { id: "state-clean", name: "Clean coat", notes: "The coat is dry and the collar sits flat." },
      { id: "state-soaked", name: "Soaked coat", parentStateId: "state-clean", notes: "The coat is heavy with rain; the collar clings to her neck." },
    ],
  }],
  /* No continuity state at all: CineBraid invents one, and used to describe it in
     the invented state's own delta field. */
  locations: [{ id: "LOC-DOCK", name: "Dock", description: "A wet concrete dock under sodium light.", continuityStates: [] }],
  props: [], vehicles: [],
  /* No tier: CineBraid assigns one, and used to write that into the scene's notes. */
  scenes: [{ id: "SC-01", title: "Arrival", whatHappens: "Ada walks the dock.", howItFeels: "Cold." }],
  /* No keyframes and no duration: two more inferences, two more prose fields. */
  shots: [{
    id: "L1-01", scene: "SC-01", title: "Dock walk", desc: "Ada walks the length of the dock.",
    positioning: "Locked wide.", characters: ["CHAR-ADA"], codes: ["LOC-DOCK"],
    notes: "Shoot this before the tide turns.",
    clips: [{ kind: "i2v", dur: 6, motionPrompt: "She walks." }],
  }],
};

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function sectionPlanningMarkerBoundary() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-project-entry-"));
  const projectsRoot = path.join(temp, "projects");
  fs.mkdirSync(path.join(projectsRoot, "seed"), { recursive: true });
  fs.writeFileSync(path.join(projectsRoot, "seed", "project.json"), JSON.stringify({
    meta: { title: "Seed", format: "Test", version: "v1", hubVersion: "v5.5.0", aiPolicy: "project-default" },
    qcChecklist: [], characters: [], locations: [], props: [], audio: [], mediaAssets: [],
    scenes: [], shots: [], jobs: [], agentRuns: [], decisions: [], sessions: [],
  }));
  fs.writeFileSync(path.join(temp, "config.json"), JSON.stringify({ activeProject: "seed", provider: "none" }));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: path.join(temp, "config.json"), CINEBRAID_PROJECTS_ROOT: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try { if ((await fetch(`${base}/api/me`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }

    const preview = await (await fetch(`${base}/api/projects/preview-import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: LEAK_SOURCE }),
    })).json();
    assert(preview.normalizedProject, `I. the preview must succeed: ${JSON.stringify(preview).slice(0, 300)}`);

    const marked = (project) => {
      const hits = [];
      const walk = (value, at) => {
        if (typeof value === "string") { if (/\[INFERRED FOR PLANNING\]/i.test(value)) hits.push(at); }
        else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${at}[${index}]`));
        else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walk(item, at ? `${at}.${key}` : key));
      };
      walk(project, "");
      return hits;
    };

    /* THE INFERENCES REALLY HAPPENED — otherwise the absence below proves nothing. */
    assert(preview.review.inferred.length >= 4,
      `I. this fixture must provoke CineBraid's own inferences, got ${preview.review.inferred.length}`);
    for (const row of preview.review.inferred) {
      assert(row.path, "I. every reported inference must name the field it was made on");
      assert(/\[INFERRED FOR PLANNING\]/i.test(row.value), "I. and must quote what CineBraid decided");
    }

    /* AND THE PROJECT ITSELF CARRIES NONE OF IT. */
    assert.deepStrictEqual(marked(preview.normalizedProject), [],
      `I. the previewed project must contain no planning marker, found ${JSON.stringify(marked(preview.normalizedProject))}`);

    /* THE AUTHORED PROSE IS UNTOUCHED — the whole point of a narrow cut. */
    const character = preview.normalizedProject.characters[0];
    assert.strictEqual(character.continuityStates[0].notes, "The coat is dry and the collar sits flat.",
      "I. the state delta the filmmaker wrote must survive byte for byte");
    assert.strictEqual(character.continuityStates[1].notes, "The coat is heavy with rain; the collar clings to her neck.",
      "I. and so must an unmarked one");
    assert.strictEqual(preview.normalizedProject.shots[0].notes, "Shoot this before the tide turns.",
      "I. a shot note CineBraid appended to must keep the human sentence and lose only the annotation");
    assert.strictEqual(preview.normalizedProject.scenes[0].whatHappens, "Ada walks the dock.", "I. and the scene beat is untouched");

    /* THE REVIEW STILL FLAGS THE INFERRED CONTINUITY STATE, off the collected path
       rather than off prose that no longer contains the marker. */
    const inferredStates = preview.review.continuity.filter((state) => state.inferred);
    assert(inferredStates.length >= 1, "I. the continuity review must still mark the states CineBraid inferred");
    for (const state of preview.review.continuity)
      assert(!/\[INFERRED FOR PLANNING\]/i.test(state.notes || ""),
        "I. and must show the prose the project will actually hold");

    /* WHAT IS WRITTEN TO DISK IS WHAT WAS PREVIEWED. */
    const commit = await (await fetch(`${base}/api/projects/import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken: preview.previewToken, previewHash: preview.previewHash }),
    })).json();
    assert(commit.slug, `I. the commit must succeed: ${JSON.stringify(commit).slice(0, 300)}`);
    const written = JSON.parse(fs.readFileSync(path.join(projectsRoot, commit.slug, "project.json"), "utf8"));
    assert.deepStrictEqual(marked(written), [],
      `I. the project on disk must contain no planning marker, found ${JSON.stringify(marked(written))}`);
    assert.strictEqual(written.characters[0].continuityStates[0].notes, "The coat is dry and the collar sits flat.",
      "I. and the prose on disk is the prose the filmmaker wrote");

    /* THE SOURCE-CONFLICT MARKER IS DELIBERATELY NOT TOUCHED. It flags a
       contradiction only a human can settle, and tests/import-benchmark.js scores an
       import UP for carrying it. */
    const conflicted = JSON.parse(JSON.stringify(LEAK_SOURCE));
    conflicted.meta.title = "Conflict Boundary";
    conflicted.characters[0].notes = "[SOURCE CONFLICT] Earlier draft says a blue coat.";
    const conflictPreview = await (await fetch(`${base}/api/projects/preview-import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: conflicted }),
    })).json();
    assert.strictEqual(conflictPreview.normalizedProject.characters[0].notes, "[SOURCE CONFLICT] Earlier draft says a blue coat.",
      "I. a source-conflict marker must survive the import — it is a warning, not an annotation");
    assert(conflictPreview.review.conflicts.length >= 1, "I. and must still be reported");

    note(`I. the import made ${preview.review.inferred.length} planning inferences, reported all of them with paths, and wrote zero planning markers into the project — while every authored sentence, and the [SOURCE CONFLICT] marker, survived intact`);

    /* ---------------------------------------------------------------------
       O. AUTHORED vs GENERATED.

       The first correction removed the annotation by scanning every string for the
       marker, which truncated "Literal discussion: [INFERRED FOR PLANNING] is a
       bracketed phrase…" to "Literal discussion:". A textual scan cannot tell
       CineBraid's annotation from a human writing the same words, because by the time
       it runs the provenance is gone. So nothing is scanned and nothing is removed:
       the inference is recorded against the object it was made about, and the project
       never carries it in the first place.
       --------------------------------------------------------------------- */
    const authored = await (await fetch(`${base}/api/projects/preview-import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: AUTHORED_SOURCE }),
    })).json();
    assert(authored.normalizedProject, `O. the adversarial import must succeed: ${JSON.stringify(authored).slice(0, 300)}`);

    for (const [path, key, why] of AUTHORED_CHECKS)
      assert.strictEqual(valueAt(authored.normalizedProject, path), AUTHORED[key],
        `O. authored text must survive byte for byte — ${path} (${why})`);

    const generated = authored.review.inferred.filter((row) => row.origin === "cinebraid");
    const fromSource = authored.review.inferred.filter((row) => row.origin === "source");
    assert(generated.length >= 4, `O. this source must provoke CineBraid's own inferences, got ${generated.length}`);
    assert(fromSource.length >= AUTHORED_CHECKS.length - 2,
      `O. and every authored marker must still be REPORTED as an inferred value, got ${fromSource.length}`);
    /* The test is whether CINEBRAID'S OWN SENTENCE is in the project — not whether the
       marker is, because on the shared field the marker is the filmmaker's. */
    const projectText = JSON.stringify(authored.normalizedProject);
    for (const row of generated) {
      const sentence = row.value.replace(/^\[INFERRED FOR PLANNING\]\s*/i, "").replace(/…$/, "");
      assert(sentence.length > 20, `O. the control needs a real sentence to look for, got ${JSON.stringify(sentence)}`);
      assert(!projectText.includes(sentence),
        `O. CineBraid's own annotation must appear nowhere in the project — found "${sentence.slice(0, 60)}" for ${row.path}`);
    }
    assert(!/CineBraid (selected|added|assigned|created|kept|set) /.test(projectText),
      "O. and no import-bookkeeping sentence of any shape may be inside the project");
    /* The decisive pair: one path carries BOTH a generated inference and the
       filmmaker's own literal marker. The inference is reported there; the sentence is
       untouched. Nothing that reads prose could separate those two. */
    const sharedPath = "characters[0].continuityStates[0].notes";
    assert(generated.some((row) => row.path === sharedPath),
      "O. the shared-field case must actually provoke a generated inference on that field");
    assert.strictEqual(valueAt(authored.normalizedProject, sharedPath), AUTHORED.sentence,
      "O. and the filmmaker's sentence in that same field must be exactly as they wrote it");

    const authoredCommit = await (await fetch(`${base}/api/projects/import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken: authored.previewToken, previewHash: authored.previewHash }),
    })).json();
    const authoredOnDisk = JSON.parse(fs.readFileSync(path.join(projectsRoot, authoredCommit.slug, "project.json"), "utf8"));
    for (const [dotted, key] of AUTHORED_CHECKS)
      assert.strictEqual(valueAt(authoredOnDisk, dotted), AUTHORED[key],
        `O. and it must reach disk unchanged — ${dotted}`);
    const diskText = JSON.stringify(authoredOnDisk);
    assert(!/CineBraid (selected|added|assigned|created|kept|set) /.test(diskText),
      "O. and none of it may reach disk either");
    await sectionRenderedOriginIsTruthful(base);
    await sectionSourceWordingAndCollisions(base);
    note(`O. ${AUTHORED_CHECKS.length} adversarial authored markers — exact, lower, mixed, leading, trailing, repeated, newline-separated, punctuated, in arrays and nested objects — all survived byte for byte through preview and onto disk, while ${generated.length} generated inferences were reported and none was written; one field carried both at once`);
  } finally {
    child.kill();
  }
}

/* =========================================================================
   J + K. THE LANDING, AND WHERE ITS NEXT ACTION COMES FROM.
   ========================================================================= */
function importReview(over = {}) {
  return {
    counts: { characters: 1, locations: 1, props: 1, vehicles: 1, scenes: 1, shots: 1, keyframes: 2, motionUnits: 2 },
    sourceCounts: { characters: 1, locations: 1, props: 1, vehicles: 1, scenes: 1, shots: 1, keyframes: 0, motionUnits: 0 },
    inferred: [], conflicts: [], missing: [], removed: [], review: [], continuity: [], outline: [],
    ...over,
  };
}
async function landedRender(reviewOver = {}) {
  const current = buildFixture();
  const normalized = buildFixture();
  normalized.meta.title = "Landed Import";
  const review = importReview(reviewOver);
  let active = "current";
  const fetchStub = async (url, options, respond) => {
    if (url === "/api/project")
      return respond(active === "current" ? current : normalized, 200, { "x-cinebraid-project-slug": active });
    if (url === "/api/projects/preview-import-json" && options.method === "POST")
      return respond({ ok: true, title: normalized.meta.title, previewToken: "landing-token", previewHash: "b".repeat(64), normalizedProject: normalized, review });
    if (url === "/api/projects/import-json" && options.method === "POST") {
      active = "landed-import";
      return respond({ ok: true, slug: active, counts: { scenes: 2, shots: 3, characters: 1, locations: 1, props: 1, vehicles: 0 } });
    }
    return null;
  };
  const rendered = await render("#/create", current, { fetch: fetchStub, storage: { "cinebraid-creation-start-path": "cinebraid" } });
  rendered.context.document.getElementById("project-builder-json").value = JSON.stringify({ meta: { title: "Raw" } });
  await rendered.context.importProjectBuilderJSON();
  await rendered.context.commitProjectBuilderImport();
  return { ...rendered, html: rendered.map.get("main").innerHTML };
}

async function sectionSuccessfulImportLands() {
  const { html, context } = await landedRender({ review: ["Scene SC-01: add emotional or tonal intent"] });

  assert(html.includes("data-project-entry-landing"), "J. a successful import must land on the project-created state");
  assert(!html.includes("creation-start-choice"),
    "J. and must NOT return the filmmaker to the chooser they already answered");
  assert(!html.includes('data-creation-intent="assisted"'), "J. nor to the intent buttons");

  /* 1. WHAT WAS CREATED. */
  assert(html.includes("Landed Import"), "J. the landing must name the project it created");
  assert(/WHAT WAS CREATED/.test(html), "J. and say what was created");
  assert(/>2<\/b><span>scenes<\/span>/.test(html) && /<b>3<\/b><span>shots<\/span>/.test(html),
    "J. with the counts the import reported");
  assert(!/vehicles/.test(html.slice(html.indexOf("WHAT WAS CREATED"), html.indexOf("DOES ANYTHING NEED REVIEW"))),
    "J. and no zero-count row for something the import did not create");

  /* 2. WHETHER ANYTHING NEEDS REVIEW. */
  assert(html.includes('data-entry-standing="needs-review"'), "J. the landing must state the standing");
  assert(html.includes("Scene SC-01: add emotional or tonal intent"), "J. in the review's own words");

  /* 3. WHAT TO DO NEXT — and it must be the one authority. */
  const authority = JSON.parse(vm.runInContext("JSON.stringify(projectNextProductionAction())", context));
  const expected = vm.runInContext("creationRecommendedActionMarkup()", context);
  const block = html.slice(html.indexOf("WHAT TO DO NEXT"));
  assert(block.includes(expected),
    "K. the landing must render creationRecommendedActionMarkup() verbatim — the one function that owns the next action");
  assert(block.includes(`data-recommended-kind="${authority.kind}"`),
    `K. and therefore carry projectNextProductionAction()'s own kind (${authority.kind})`);
  assert(block.includes(authority.actionLabel), "K. and its own action label");
  assert(block.includes("continueProduction()"), "K. routed by the shipped hand-off, not by a second one");
  note(`J. a successful import lands on the created state (2 scenes / 3 shots), states "Needs review" in the review's words, and offers no chooser`);
  note(`K. its next action is creationRecommendedActionMarkup(), which is projectNextProductionAction() — rendered kind "${authority.kind}", label "${authority.actionLabel}"`);
}

async function sectionLandingStandingFollowsReview() {
  for (const [over, expected] of [
    [{}, "ready"],
    [{ inferred: [{ path: "shots[0].notes", value: "[INFERRED FOR PLANNING] x" }] }, "needs-review"],
    [{ missing: ["Shot L1-01: action description"] }, "blocked"],
  ]) {
    const { html } = await landedRender(over);
    assert(html.includes(`data-entry-standing="${expected}"`),
      `H/J. an import whose review was ${JSON.stringify(over)} must land as ${expected}`);
  }
  note("H/J. the landing's standing is the same projection the review step showed, for Ready, Needs review and Blocked alike");
}

/* THE SOLE-AUTHORITY CLAIM, MADE STRUCTURALLY.

   Counting call sites is what catches a second derivation being added later, when
   nobody is looking at this file. */
function sectionSingleNextActionAuthority() {
  const app = codeOnly(read("public/app.js"));
  const studio = codeOnly(CREATION_STUDIO);
  const definitions = (source) => (source.match(/function\s+projectNextProductionAction\s*\(/g) || []).length;
  assert.strictEqual(definitions(app), 1, "K. projectNextProductionAction() is defined exactly once, in public/app.js");
  for (const file of fs.readdirSync(path.join(ROOT, "public")).filter((name) => name.endsWith(".js") && name !== "app.js"))
    assert.strictEqual(definitions(read(`public/${file}`)), 0, `K. and nowhere else — found a definition in public/${file}`);

  /* Everything that renders a project-level next action goes through the one markup
     function, which calls the one derivation. */
  assert.strictEqual((studio.match(/function\s+creationRecommendedActionMarkup\s*\(/g) || []).length, 1,
    "K. one renderer for the recommended action");
  assert.strictEqual((studio.match(/projectNextProductionAction\(/g) || []).length, 1,
    "K. called from exactly one place in the creation studio — the landing reuses the renderer rather than the derivation");
  const landing = studio.slice(studio.indexOf("function projectEntryLandingView("), studio.indexOf("function creationStudioView("));
  assert(landing.includes("creationRecommendedActionMarkup()"), "K. and the landing is that reuse");
  for (const forbidden of ["nextProductionShot", "shotProductionNextAction", "evaluateProjectReadiness", "projectSharedBlockers"])
    assert(!landing.includes(forbidden), `K. the landing must not reach past the renderer to ${forbidden}`);
  note("K. projectNextProductionAction() is defined once in public/app.js, called once in the creation studio, and the landing reaches it only through creationRecommendedActionMarkup()");
}

/* =========================================================================
   L. SLICE 1 IS UNTOUCHED.
   ========================================================================= */
async function sectionSliceOnePreserved() {
  const shell = require("../public/shared-workspace-shell.js");
  const api = shell.CineBraidWorkspaceShell || shell;
  const state = api.creatorShellState({ view: "create", hasProject: true });
  assert.strictEqual(state.present, false, "L. #/create is still not a creator surface");
  assert.strictEqual(state.reason, "excluded-view", "L. for the reason Slice 1 recorded");
  assert.deepStrictEqual([...api.SHELL_RAIL_WIDTHS], [240, 340], "L. the rail widths are unchanged");
  assert.strictEqual(api.SHELL_CENTRE_FLOOR, 900, "L. and so is the centre floor");

  const index = read("public/index.html");
  assert(index.includes('id="activity-live-region"'), "L. Slice 1's announcer is still shipped");
  assert(!index.includes("automation-global-live-strip"), "L. and the retired strip is still retired");
  for (const file of ["public/creation-studio.js", "public/app.js", "public/views.js"])
    assert(!read(file).includes("automation-global-live-strip"), `L. Slice 2 must not resurrect the strip in ${file}`);
  note("L. #/create is still an excluded shell view, the rail geometry and centre floor are unchanged, and the retired activity strip stayed retired");
}

/* =========================================================================
   M. NOTHING FROM SLICE 3, 4 OR 5.
   ========================================================================= */
const LATER_SLICE_VOCABULARY = [
  ["Reference Reframe", /reference\s*reframe/i],
  ["demand-driven coverage", /demand[- ]driven|coverage\s*demand/i],
  ["Simple/Advanced generation", /simple\s*\/\s*advanced|advanced\s*mode/i],
  ["price truth", /\$\d|price|usd|cost estimate/i],
  ["shot intent / execution routing", /shot\s*intent|execution\s*routing/i],
  ["Reports → Analytics", /analytics/i],
  ["collaboration", /collaborat|invite a teammate|share with/i],
];
async function sectionNoLaterSliceLeakage() {
  const surfaces = [];
  for (const stored of ["assisted", "cinebraid", "scratch"])
    surfaces.push(await createRender({ storage: { "cinebraid-creation-start-path": stored } }));
  surfaces.push(await landedRender());
  for (const { html } of surfaces)
    for (const [label, pattern] of LATER_SLICE_VOCABULARY)
      assert(!pattern.test(html), `M. this slice must not surface ${label}`);

  /* And no generation-model or provider control was pulled forward onto the entry. */
  const entry = codeOnly(CREATION_STUDIO).slice(codeOnly(CREATION_STUDIO).indexOf("const CREATION_INTENTS"));
  for (const forbidden of ["CREATION_IMAGE_FAMILIES", "resolveCapability", "generation-picker", "profileId", "videoModel", "stillModel"])
    assert(!entry.includes(forbidden), `M. the entry surface must not reach generation machinery (${forbidden})`);
  note("M. none of Reference Reframe, demand-driven coverage, Simple/Advanced generation, price, shot intent, Analytics or collaboration appears on any entry surface, and no generation-model control was pulled forward");
}

/* =========================================================================
   N. AN IN-FLIGHT FILE READ BELONGS TO THE INTENT THAT STARTED IT.

   The read used to resolve its destination inside `onload`, so an ~8 MiB CineBraid
   project chosen on the CineBraid path and switched away from mid-read landed in
   `assisted:json` instead. This drives the shipped handler with a FileReader whose
   completion this suite controls, which is the only way to hold a read open across a
   path switch deterministically. The genuinely asynchronous evidence — a real
   multi-megabyte file, a real Chromium, a real switch while the bytes are still
   being read — is section 7 of tests/project-entry-real-browser.py.
   ========================================================================= */
function installControllableFileReader(context) {
  vm.runInContext(`
    globalThis.__reads = [];
    globalThis.FileReader = class {
      readAsText(file) { globalThis.__reads.push({ file, reader: this }); }
    };
    globalThis.__chooseFile = (name) => { readProjectBuilderFile({ files: [{ name }] }); return globalThis.__reads.length - 1; };
    globalThis.__finish = (index, text) => { const r = globalThis.__reads[index]; r.reader.result = text; r.reader.onload(); };
    globalThis.__fail = (index) => { const r = globalThis.__reads[index]; if (r.reader.onerror) r.reader.onerror(); };
  `, context);
}
async function sectionFileReadOwnership() {
  const { context } = await createRender({ storage: { "cinebraid-creation-start-path": "cinebraid" } });
  installControllableFileReader(context);
  const draft = (key) => vm.runInContext(`creationDraft(${JSON.stringify(key)})`, context);

  /* 1. the read is started on the CineBraid path and finishes on the assisted one. */
  const first = vm.runInContext(`__chooseFile("project.json")`, context);
  vm.runInContext("setCreationStartPath('assisted')", context);
  await vm.runInContext("route()", context);
  vm.runInContext(`__finish(${first}, "CINEBRAID-DOCUMENT")`, context);
  assert.strictEqual(draft("cinebraid:json"), "CINEBRAID-DOCUMENT",
    "N. a file chosen on the CineBraid path must land there however long the read takes");
  assert.strictEqual(draft("assisted:json"), "",
    "N. and must never be transferred to the intent that happened to be selected when it finished");

  /* 2. rapid A -> B -> C switching during a read changes nothing about ownership. */
  vm.runInContext("setCreationStartPath('assisted')", context);
  await vm.runInContext("route()", context);
  const second = vm.runInContext(`__chooseFile("assistant-output.json")`, context);
  for (const path of ["scratch", "cinebraid", "assisted", "scratch"]) {
    vm.runInContext(`setCreationStartPath('${path}')`, context);
    await vm.runInContext("route()", context);
  }
  vm.runInContext(`__finish(${second}, "ASSISTANT-OUTPUT")`, context);
  assert.strictEqual(draft("assisted:json"), "ASSISTANT-OUTPUT", "N. four switches mid-read do not move the bytes");
  assert.strictEqual(draft("cinebraid:json"), "CINEBRAID-DOCUMENT", "N. and the other buffer is untouched by any of it");

  /* 3. two selections on one buffer: last selection wins, whichever finishes first.
        The older, larger read completing afterwards must not resurrect itself. */
  vm.runInContext("setCreationStartPath('cinebraid')", context);
  await vm.runInContext("route()", context);
  const older = vm.runInContext(`__chooseFile("big.json")`, context);
  const newer = vm.runInContext(`__chooseFile("small.json")`, context);
  vm.runInContext(`__finish(${newer}, "NEWER")`, context);
  assert.strictEqual(draft("cinebraid:json"), "NEWER", "N. the newer selection lands");
  vm.runInContext(`__finish(${older}, "STALE-OLDER")`, context);
  assert.strictEqual(draft("cinebraid:json"), "NEWER",
    "N. and a stale read completing later must not overwrite it");

  /* 4. a failed read clears nothing and leaves the buffer the filmmaker's. */
  const failing = vm.runInContext(`__chooseFile("unreadable.json")`, context);
  vm.runInContext(`__fail(${failing})`, context);
  assert.strictEqual(draft("cinebraid:json"), "NEWER", "N. a failed read must not empty what was already there");
  const afterFailure = vm.runInContext(`__chooseFile("recovered.json")`, context);
  vm.runInContext(`__finish(${afterFailure}, "RECOVERED")`, context);
  assert.strictEqual(draft("cinebraid:json"), "RECOVERED", "N. and a later read still works after a failure");

  /* 5. the same completion delivered twice writes once. */
  vm.runInContext(`__finish(${afterFailure}, "REPLAYED")`, context);
  assert.strictEqual(draft("cinebraid:json"), "RECOVERED", "N. a replayed completion is a no-op");
  note("N. an in-flight file read keeps the intent that started it across four switches; last selection wins; a stale completion, a replay and a read failure all write nothing");
}

/* =========================================================================
   P. A NULL NEXT ACTION IS NOT A LICENCE TO CHOOSE ONE.
   ========================================================================= */
async function sectionNullAuthorityChoosesNothing() {
  const { context } = await landedRender();
  const shipped = vm.runInContext("creationRecommendedActionMarkup()", context);
  assert(shipped.includes("data-recommended-kind="), "P. precondition: the fixture produces a real next action");

  vm.runInContext(`
    globalThis.__realNextAction = projectNextProductionAction;
    globalThis.projectNextProductionAction = () => null;
  `, context);
  await vm.runInContext("route()", context);
  const html = vm.runInContext("document.getElementById('main').innerHTML", context);
  const card = (html.match(/<article[^>]*data-recommended-kind[\s\S]*?<\/article>/) || [""])[0];
  assert(card, "P. the landing must still say something when the authority names nothing");
  assert(card.includes('data-recommended-kind="none"'), `P. and must declare that it has no action, got ${card.slice(0, 160)}`);
  assert(card.includes("data-no-production-action"), "P. explicitly");
  assert(!/OPEN SHOTS/i.test(card), "P. the no-action card must not offer a production destination");
  assert(!/Nothing outstanding/i.test(card), "P. nor the retired locally-chosen verdict");
  assert(!/continueProduction\(\)/.test(card), "P. nor the hand-off that routes into production");
  assert(!/<button|<a /.test(card), "P. it offers no control at all — a control here would be a choice");

  /* The landing's ordinary navigation is INVARIANT: byte-identical whether or not the
     authority named an action, which is what makes it navigation rather than a
     fallback recommendation. */
  const lookAround = (source) => (source.match(/<article><span>OR LOOK AROUND<\/span>[\s\S]*?<\/article>/) || [""])[0];
  vm.runInContext("globalThis.projectNextProductionAction = globalThis.__realNextAction;", context);
  await vm.runInContext("route()", context);
  const withAction = vm.runInContext("document.getElementById('main').innerHTML", context);
  assert(lookAround(html) && lookAround(html) === lookAround(withAction),
    "P. the generic navigation block must be identical in both cases — a block that appeared only when the authority was silent would be a fallback");
  note("P. a null authority renders a no-action card carrying no control, no OPEN SHOTS and no production hand-off, while the landing's ordinary navigation is byte-identical either way");
}

/* =========================================================================
   Q. THE STAGE STRIP DESCRIBES THE RENDERED WORKSPACE.
   ========================================================================= */
function sectionStripFollowsRenderedRoute() {
  const source = codeOnly(read("public/stage-surfaces.js"));
  assert(source.includes("renderedRouteIsCurrent()"),
    "Q. the strip's context must consult the rendered route");
  assert(/shotId: view === "shot" && renderedRouteIsCurrent\(\)/.test(source),
    "Q. and must resolve no shot until the workspace it navigates has rendered");
  /* The guard has to survive a realm that never loaded public/app.js — every O4 suite
     evaluates this module on its own. */
  assert(source.includes('typeof CURRENT_RENDER_ROUTE_KEY === "undefined"'),
    "Q. with a typeof guard, or the O4 suites throw on an undeclared identifier");
  const app = codeOnly(read("public/app.js"));
  assert(app.includes("CURRENT_RENDER_ROUTE_KEY = targetRouteKey;"),
    "Q. app.js must still publish the rendered route key the strip reads");
  assert(app.includes("markRouteRenderSettled(requestToken)"),
    "Q. and must arm its render-ready flag per render rather than once at boot");
  const bootstrap = read("public/bootstrap.js");
  assert(bootstrap.includes('document.body.dataset.renderReady = "1"'),
    "Q. bootstrap still sets it after the first load, so nothing that waited on boot regressed");
  note("Q. the stage strip resolves its shot from the rendered route, guarded for realms without app.js, and renderReady is armed per render instead of once at boot");
}

/* =========================================================================
   R. WHO SAID IT — THE REVIEW NEVER ATTRIBUTES THE FILMMAKER'S PROSE TO CINEBRAID.

   The server reports `origin` on every inferred row. The renderer used to drop it and
   file both kinds under "Inferred values", and mark the continuity card `inferred`,
   so a filmmaker who had written `[INFERRED FOR PLANNING]` in their own state delta
   was shown their own sentence as a CineBraid decision.
   ========================================================================= */
const ORIGIN_SOURCE = {
  meta: { title: "Origin Matrix", format: "Short film" },
  characters: [{
    id: "CHAR-ADA", name: "Ada", description: "A dock engineer in a patched grey coat.",
    continuityStates: [
      /* Authored marker on a state CineBraid will ALSO decide about (no default is
         declared, so it picks this one): both origins land on one path. */
      { id: "state-clean", name: "Clean coat", notes: "[INFERRED FOR PLANNING] my own note about the convention." },
      /* Authored, lower case, and CineBraid decides nothing about it. */
      { id: "state-wet", name: "Wet coat", parentStateId: "state-clean", notes: "house style: [inferred for planning] then a reason" },
    ],
  }],
  /* No states at all: a genuine CineBraid inference with no authored marker near it. */
  locations: [{ id: "LOC-DOCK", name: "Dock", description: "A wet concrete dock.", continuityStates: [] }],
  props: [], vehicles: [],
  scenes: [{ id: "SC-01", title: "Arrival", whatHappens: "Ada walks the dock.", howItFeels: "Cold." }],
  shots: [{ id: "L1-01", scene: "SC-01", title: "Dock walk", desc: "Ada walks the dock.", positioning: "Locked wide.", characters: ["CHAR-ADA"], codes: ["LOC-DOCK"], clips: [{ kind: "i2v", dur: 6, motionPrompt: "She walks." }] }],
};
async function sectionRenderedOriginIsTruthful(base) {
  const preview = await (await fetch(`${base}/api/projects/preview-import-json`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: ORIGIN_SOURCE }),
  })).json();
  assert(preview.review, `R. the origin fixture must import: ${JSON.stringify(preview).slice(0, 300)}`);

  const cinebraid = preview.review.inferred.filter((row) => row.origin === "cinebraid");
  const fromSource = preview.review.inferred.filter((row) => row.origin === "source");
  assert(cinebraid.length >= 3, `R. the fixture must provoke real CineBraid inferences, got ${cinebraid.length}`);
  assert(fromSource.length >= 2, `R. and must carry authored markers, got ${fromSource.length}`);
  for (const row of preview.review.inferred)
    assert(row.origin === "cinebraid" || row.origin === "source", `R. every row must declare an origin, got ${row.origin}`);

  /* The server keeps the two apart on the continuity rows too — including the state
     that carries both. */
  const byState = Object.fromEntries(preview.review.continuity.map((state) => [state.stateId, state]));
  assert.strictEqual(byState["state-clean"].inferred, true, "R. CineBraid did choose state-clean as the default");
  assert.strictEqual(byState["state-clean"].sourceMarked, true, "R. and the filmmaker's own marker is on it too");
  assert.strictEqual(byState["state-wet"].inferred, false,
    "R. a state CineBraid decided nothing about must NOT be marked as its inference");
  assert.strictEqual(byState["state-wet"].sourceMarked, true, "R. it is marked in the source, and says so");
  assert.strictEqual(byState["state-default"].inferred, true, "R. the state CineBraid created is its own");
  assert.strictEqual(!!byState["state-default"].sourceMarked, false, "R. and carries no source marker");

  /* THE RENDERED DOCUMENT, not just the payload. */
  const { context } = await createRender();
  const markup = vm.runInContext(`(() => {
    const review = ${JSON.stringify(preview.review)};
    return {
      cine: projectBuilderReviewColumn("CineBraid planning decisions", "inferred", cinebraidInferences(review), "none"),
      source: projectBuilderReviewColumn("Marked in your source", "source", sourceInferences(review), "none"),
      continuity: projectBuilderContinuityReview(review.continuity),
      full: renderProjectBuilderReview({ title: "Origin Matrix", previewHash: "d".repeat(64), review }),
    };
  })()`, context);

  assert.strictEqual((markup.cine.match(/data-origin="source"/g) || []).length, 0,
    "R. no source-authored row may appear in the CineBraid column");
  assert.strictEqual((markup.source.match(/data-origin="cinebraid"/g) || []).length, 0,
    "R. and no CineBraid row in the source column");
  assert.strictEqual((markup.cine.match(/data-origin="cinebraid"/g) || []).length, cinebraid.length,
    "R. every CineBraid row is rendered, in its own column");
  assert.strictEqual((markup.source.match(/data-origin="source"/g) || []).length, fromSource.length,
    "R. and every authored row in its own");
  assert(/CineBraid planning decisions/.test(markup.full) && /Planning-marker text found in source/.test(markup.full),
    "R. the review must offer both headings");
  assert(!/>Inferred values</.test(markup.full),
    "R. and must not offer the single undifferentiated heading that hid the difference");

  const card = (id) => (markup.continuity.match(new RegExp(`<article[^>]*>(?:(?!</article>)[\\s\\S])*?${id}[\\s\\S]*?</article>`)) || [""])[0];
  assert(/data-continuity-origin="source"/.test(card("state-wet")),
    "R. a state marked only by the source must be labelled as the source's");
  assert(/Planning-marker text found in source/.test(card("state-wet")), "R. in words as well as in an attribute");
  assert(!/CineBraid decided this<\/em>/.test(card("state-wet")),
    "R. and must never claim CineBraid decided it");
  assert(!/class="inferred"/.test(card("state-wet")),
    "R. nor carry the class that means a CineBraid inference");
  assert(/data-continuity-origin="cinebraid\+source"/.test(card("state-clean")),
    "R. a state carrying both must say both rather than the louder one");
  assert(/source also contains planning-marker text/.test(card("state-clean")), "R. in words");
  assert(/data-continuity-origin="cinebraid"/.test(card("state-default")),
    "R. and a state CineBraid really created is its own");
  note(`R. ${cinebraid.length} CineBraid decisions and ${fromSource.length} source-origin rows render in separate columns with zero crossover; a source-only state reads "Planning-marker text found in source", a state carrying both says both, and the undifferentiated "Inferred values" heading is gone`);
}

/* =========================================================================
   S. AN ASYNC VALIDATION OR IMPORT BELONGS TO THE INTENT THAT STARTED IT.

   Both handlers used to ask `creationStartPath()` after their response arrived.
   Independent review reproduced the cost: start a CineBraid import, switch to the
   assisted path before it lands, and the CineBraid document is imported while the
   ASSISTANT'S material is cleared and the CineBraid source that really was consumed
   survives. The response is gated here so the switch is provably mid-flight; the
   genuinely networked version is section 10 of the real-browser suite.
   ========================================================================= */
function gatedImportRender(options = {}) {
  const current = buildFixture();
  const normalized = buildFixture();
  normalized.meta.title = options.title || "Gated Import";
  const gates = { preview: [], commit: [] };
  /* `open` releases the OLDEST waiting request, `openNewest` the most recent one.
      S4 needs the newer response to arrive first, which is the whole point of it. */
  const open = (kind, value) => { const g = gates[kind].shift(); if (g) g(value); };
  const openNewest = (kind, value) => { const g = gates[kind].pop(); if (g) g(value); };
  let active = "current";
  const fetchStub = async (url, requestOptions, respond) => {
    if (url === "/api/project")
      return respond(active === "current" ? current : normalized, 200, { "x-cinebraid-project-slug": active });
    if (url === "/api/projects/preview-import-json" && requestOptions.method === "POST") {
      const payload = await new Promise((resolve) => gates.preview.push(resolve));
      if (payload === "FAIL") return respond({ error: "Validation failed on purpose" }, 400);
      return respond({
        ok: true, title: normalized.meta.title, previewToken: `token-${payload}`, previewHash: "e".repeat(64),
        normalizedProject: normalized,
        review: { counts: { scenes: 1, shots: 1 }, sourceCounts: {}, inferred: [], conflicts: [], missing: [], removed: [], review: [], continuity: [], outline: [] },
      });
    }
    if (url === "/api/projects/import-json" && requestOptions.method === "POST") {
      const payload = await new Promise((resolve) => gates.commit.push(resolve));
      if (payload === "FAIL") return respond({ error: "Import refused on purpose" }, 400);
      active = "gated-import";
      return respond({ ok: true, slug: active, counts: { scenes: 1, shots: 1, characters: 1, locations: 1, props: 0, vehicles: 0 } });
    }
    return null;
  };
  return render("#/create", current, { fetch: fetchStub, storage: { "cinebraid-creation-start-path": "cinebraid" } })
    .then((rendered) => ({ ...rendered, open, openNewest, gates }));
}
async function sectionAsyncOperationOwnership() {
  const { context, open } = await gatedImportRender();
  const run = (code) => vm.runInContext(code, context);
  const draft = (key) => run(`creationDraft(${JSON.stringify(key)})`);
  const owners = () => run("[...window.__cinebraidCreationCandidates.keys()].sort().join(',')");
  const results = () => run("[...window.__cinebraidCreationResults.keys()].sort().join(',')");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  /* Material on BOTH intents. The assisted pair is the control: it is never touched. */
  run(`setCreationDraft("assisted:story", "INT. DOCK - NIGHT");`);
  run(`setCreationDraft("assisted:json", '{"assisted":true}');`);
  run(`setCreationDraft("cinebraid:json", '{"meta":{"title":"Mine"}}');`);
  const assistedStoryBefore = draft("assisted:story");
  const assistedJsonBefore = draft("assisted:json");

  /* 1. CineBraid validation, switched away mid-flight, then succeeding. */
  run(`document.getElementById("project-builder-json").value = '{"meta":{"title":"Mine"}}';`);
  run(`window.__validating = importProjectBuilderJSON();`);
  run("setCreationStartPath('assisted')");
  await run("route()");
  assert.strictEqual(owners(), "", "S1. precondition: nothing has landed while the request is still gated");
  open("preview", "one");
  await run("window.__validating");
  await settle();
  assert.strictEqual(owners(), "cinebraid",
    `S1. the candidate must belong to the intent that started the validation, got "${owners()}"`);
  assert.strictEqual(results(), "cinebraid", "S1. and so must the rendered result");
  assert.strictEqual(run("window._projectBuilderCandidate"), null,
    "S1. the visible intent must NOT be handed another intent's candidate");
  assert.strictEqual(draft("assisted:story"), assistedStoryBefore, "S1. the assisted script is untouched");
  assert.strictEqual(draft("assisted:json"), assistedJsonBefore, "S1. and so is the assisted document");

  /* 6. returning to the initiating intent finds the result waiting. */
  run("setCreationStartPath('cinebraid')");
  const returned = await run("(async () => { await route(); return document.getElementById('main').innerHTML; })()");
  assert(returned.includes("project-builder-review"),
    "S6. returning to the intent that started the validation must show its review");
  assert(run("!!window._projectBuilderCandidate"), "S6. and re-point the visible candidate at it");

  /* 7. import, switched away mid-flight, succeeding: only the initiating source goes. */
  run(`window.__importing = commitProjectBuilderImport();`);
  run("setCreationStartPath('assisted')");
  await run("route()");
  assert.strictEqual(draft("cinebraid:json"), '{"meta":{"title":"Mine"}}',
    "S7. precondition: nothing is consumed while the request is still gated");
  open("commit", "one");
  await run("window.__importing");
  await settle();
  assert.strictEqual(draft("cinebraid:json"), "", "S7. the source that WAS consumed is cleared");
  assert.strictEqual(draft("assisted:story"), assistedStoryBefore,
    "S7. and the assisted script — which this operation never touched — is byte-identical");
  assert.strictEqual(draft("assisted:json"), assistedJsonBefore, "S7. as is the assisted document");
  assert(run("!!window.__cinebraidProjectEntryLanding"), "S7. the import landed");
  assert.strictEqual(run("window.__cinebraidProjectEntryLanding.path"), "cinebraid",
    "S7. and the landing belongs to the intent that started it, not the visible one");
  note("S. a validation and an import each kept the intent that started them across a mid-flight switch; the assisted script and document were byte-identical throughout, only the consumed CineBraid document was cleared, and the landing was recorded for the initiating intent");
}

/* 2, 3, 4, 5, 8: the remaining ownership attacks, on a fresh realm each time so one
   failure cannot be mistaken for another's. */
async function sectionAsyncOwnershipAttacks() {
  /* 2. CineBraid validation -> switch -> FAILURE. Nothing of anyone's is cleared. */
  {
    const { context, open } = await gatedImportRender();
    const run = (code) => vm.runInContext(code, context);
    run(`setCreationDraft("assisted:story", "SCRIPT"); setCreationDraft("assisted:json", "ASSISTED");`);
    run(`setCreationDraft("cinebraid:json", "CINEBRAID");`);
    /* Valid JSON, so what fails is the SERVER's answer rather than JSON.parse — the
       control is about a failed request, not a malformed paste. */
    run(`document.getElementById("project-builder-json").value = '{"meta":{"title":"Mine"}}';`);
    run(`window.__op = importProjectBuilderJSON();`);
    run("setCreationStartPath('assisted')");
    await run("route()");
    open("preview", "FAIL");
    await run("window.__op");
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(run(`creationDraft("cinebraid:json")`), "CINEBRAID", "S2. a failed validation consumes nothing");
    assert.strictEqual(run(`creationDraft("assisted:story")`), "SCRIPT", "S2. and touches no other intent's script");
    assert.strictEqual(run(`creationDraft("assisted:json")`), "ASSISTED", "S2. nor its document");
    assert.strictEqual(run("[...window.__cinebraidCreationResults.keys()].join(',')"), "cinebraid",
      "S2. the error belongs to the intent that asked for it");
    assert(run("String(window.__cinebraidCreationResults.get('cinebraid')).includes('Validation failed on purpose')"),
      `S2. and says what went wrong, got ${run("String(window.__cinebraidCreationResults.get('cinebraid'))")}`);
    assert.strictEqual(run("window._projectBuilderCandidate"), null, "S2. the visible intent is handed nothing");
  }

  /* 3. an ASSISTED validation switched away from: same rule, other direction. */
  {
    const { context, open } = await gatedImportRender();
    const run = (code) => vm.runInContext(code, context);
    run("setCreationStartPath('assisted')");
    await run("route()");
    run(`setCreationDraft("cinebraid:json", "CINEBRAID");`);
    run(`document.getElementById("project-builder-json").value = '{"meta":{"title":"Assisted"}}';`);
    run(`window.__op = importProjectBuilderJSON();`);
    run("setCreationStartPath('cinebraid')");
    await run("route()");
    open("preview", "two");
    await run("window.__op");
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(run("[...window.__cinebraidCreationCandidates.keys()].join(',')"), "assisted",
      "S3. an assisted-started validation belongs to assisted");
    assert.strictEqual(run(`creationDraft("cinebraid:json")`), "CINEBRAID",
      "S3. and cannot clear the CineBraid buffer");
    assert.strictEqual(run("window._projectBuilderCandidate"), null,
      "S3. nor be shown under the CineBraid heading");
  }

  /* 4. an older request followed by a newer one for the SAME intent. */
  {
    const { context, open, openNewest } = await gatedImportRender();
    const run = (code) => vm.runInContext(code, context);
    run(`document.getElementById("project-builder-json").value = '{"meta":{"title":"A"}}';`);
    run(`window.__older = importProjectBuilderJSON();`);
    run(`window.__newer = importProjectBuilderJSON();`);
    openNewest("preview", "newer");
    await run("window.__newer");
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(run("window.__cinebraidCreationCandidates.get('cinebraid').previewToken"), "token-newer",
      "S4. the newer validation owns the slot");
    open("preview", "older");
    await run("window.__older");
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(run("window.__cinebraidCreationCandidates.get('cinebraid').previewToken"), "token-newer",
      "S4. and a stale older response landing afterwards must not replace it");
  }

  /* 5. A -> B -> C switching while a request is in flight. */
  {
    const { context, open } = await gatedImportRender();
    const run = (code) => vm.runInContext(code, context);
    run(`setCreationDraft("assisted:json", "ASSISTED"); setCreationDraft("assisted:story", "SCRIPT");`);
    run(`document.getElementById("project-builder-json").value = '{"meta":{"title":"C"}}';`);
    run(`window.__op = importProjectBuilderJSON();`);
    for (const path of ["assisted", "scratch", "assisted", "scratch"]) {
      run(`setCreationStartPath('${path}')`);
      await run("route()");
    }
    open("preview", "five");
    await run("window.__op");
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(run("[...window.__cinebraidCreationCandidates.keys()].join(',')"), "cinebraid",
      "S5. four switches mid-flight do not move ownership");
    assert.strictEqual(run(`creationDraft("assisted:json")`), "ASSISTED", "S5. and touch nothing on the way past");
    assert.strictEqual(run(`creationDraft("assisted:story")`), "SCRIPT", "S5. including the script");
  }

  /* 8. a blocked import leaves the initiating source exactly where it was. */
  {
    const { context, open } = await gatedImportRender();
    const run = (code) => vm.runInContext(code, context);
    run(`setCreationDraft("cinebraid:json", "CINEBRAID"); setCreationDraft("assisted:story", "SCRIPT");`);
    run(`document.getElementById("project-builder-json").value = '{"meta":{"title":"Mine"}}';`);
    run(`window.__v = importProjectBuilderJSON();`);
    open("preview", "eight");
    await run("window.__v");
    run(`window.__c = commitProjectBuilderImport();`);
    run("setCreationStartPath('assisted')");
    await run("route()");
    open("commit", "FAIL");
    await run("window.__c");
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(run(`creationDraft("cinebraid:json")`), "CINEBRAID",
      "S8. a blocked import must leave its own source exactly where it was");
    assert.strictEqual(run(`creationDraft("assisted:story")`), "SCRIPT", "S8. and every other intent's");
    assert(run("!window.__cinebraidProjectEntryLanding"), "S8. and must not land anywhere");
    assert(run("String(window.__cinebraidCreationResults.get('cinebraid')).includes('Import refused on purpose')"),
      "S8. the refusal is recorded for the intent that asked");
  }
  note("S. the remaining five attacks — failed validation, assisted-started validation, stale older response, four-switch churn, and a blocked import — each left every other intent's material byte-identical and every result with its own owner");
}

/* =========================================================================
   T. WHAT THE PAYLOAD ACTUALLY PROVES, AND WHAT DEDUPLICATION MUST NOT LOSE.

   T1. `origin === "source"` establishes exactly one thing: text matching the planning
   marker was in the document CineBraid was handed. It does NOT establish that a
   person meant it as an operative annotation, deliberately marked that field, or knew
   the phrase means anything here — a filmmaker writing a note ABOUT the convention
   produces an identical payload. The words must claim presence and stop.

   T2. Rows were de-duplicated on path + text alone. If a filmmaker's prose at a path
   is byte-identical to the annotation CineBraid recorded against that same path, that
   is two facts, and collapsing them left the field looking purely CineBraid's.
   ========================================================================= */
const INTENT_CLAIMING_WORDS = [
  /\bmarked in your source\b/i,
  /\byour source (?:also )?marked\b/i,
  /\byou marked\b/i,
  /\bthe filmmaker (?:marked|intended|declared)\b/i,
  /\bdeliberately\b/i,
  /\bintended\b/i,
  /\bannotated by\b/i,
];
/* The exact sentence CineBraid records when it picks a default continuity state — the
   text a filmmaker would have to write to collide with it. */
const COLLIDING_TEXT = "[INFERRED FOR PLANNING] CineBraid selected this as the default continuity state during import.";
function collisionSource(title, states) {
  return {
    meta: { title, format: "Short film" },
    characters: [{ id: "CHAR-ADA", name: "Ada", description: "A dock engineer.", continuityStates: states }],
    locations: [{ id: "LOC-DOCK", name: "Dock", description: "A wet dock.", continuityStates: [{ id: "l1", name: "Night", isDefault: true, notes: "Sodium light." }] }],
    props: [], vehicles: [],
    scenes: [{ id: "SC-01", title: "Arrival", tier: "A", whatHappens: "Ada walks.", howItFeels: "Cold." }],
    shots: [{ id: "L1-01", scene: "SC-01", title: "Walk", desc: "Ada walks.", positioning: "Wide.", dur: 6,
      characters: ["CHAR-ADA"], codes: ["LOC-DOCK"],
      keyframes: [{ id: "kf-a", label: "A", title: "Open", description: "Ada at the rail.", notes: "" }],
      clips: [{ kind: "i2v", dur: 6, motionPrompt: "She walks." }] }],
  };
}
async function sectionSourceWordingAndCollisions(base) {
  const preview = async (project) => (await (await fetch(`${base}/api/projects/preview-import-json`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project }),
  })).json());
  const NOTES_PATH = "characters[0].continuityStates[0].notes";

  /* ---- T1. the words --------------------------------------------------------- */
  const { context } = await createRender();
  const wordsFor = (state) => vm.runInContext(
    `projectBuilderContinuityReview([${JSON.stringify({ kind: "Character", entityId: "CHAR-ADA", entityName: "Ada", stateId: "state-x", stateName: "X", isDefault: false, notes: "prose", ...state })}])`,
    context);
  const sourceOnly = wordsFor({ inferred: false, sourceMarked: true });
  const cineOnly = wordsFor({ inferred: true, sourceMarked: false });
  const both = wordsFor({ inferred: true, sourceMarked: true });

  for (const pattern of INTENT_CLAIMING_WORDS)
    assert(!pattern.test(sourceOnly), `T1. source-origin wording must not claim intent (${pattern}): ${sourceOnly}`);
  assert(/Planning-marker text found in source/.test(sourceOnly),
    `T1. it must say what was found and stop, got ${sourceOnly}`);
  assert(!/class="inferred"/.test(sourceOnly),
    "T1. and a source-only row must never carry the class that means a CineBraid inference");
  assert(/data-continuity-origin="source"/.test(sourceOnly), "T1. its origin is source");

  assert(/CineBraid decided this/.test(cineOnly), "T1. a CineBraid decision may be described as one");
  assert(/data-continuity-origin="cinebraid"/.test(cineOnly), "T1. and is marked so");

  assert(/data-continuity-origin="cinebraid\+source"/.test(both), "T1. a combined row declares both origins");
  assert(/CineBraid decided this/.test(both) && /source also contains planning-marker text/.test(both),
    `T1. and separates the decision from the separate fact of matching text, got ${both}`);
  for (const pattern of INTENT_CLAIMING_WORDS)
    assert(!pattern.test(both), `T1. without claiming intent (${pattern}): ${both}`);

  /* The column heading and the whole review, on the same rule. */
  const full = vm.runInContext(`renderProjectBuilderReview({ title: "T", previewHash: "f".repeat(64), review: ${JSON.stringify({ counts: { scenes: 0, shots: 0, characters: 0, locations: 0, props: 0, vehicles: 0 }, sourceCounts: {}, inferred: [], conflicts: [], missing: [], removed: [], review: [], continuity: [], outline: [] })} })`, context);
  assert(/Planning-marker text found in source/.test(full), "T1. the column says what it holds");
  for (const pattern of INTENT_CLAIMING_WORDS)
    assert(!pattern.test(full), `T1. and the review as a whole claims no intent (${pattern})`);

  /* Every authored shape produces the same neutral treatment — the words cannot vary
     with where in the prose the phrase happens to sit. */
  const shapes = {
    alone: "[INFERRED FOR PLANNING]",
    beginning: "[INFERRED FOR PLANNING] then my own sentence.",
    middle: "My note; [INFERRED FOR PLANNING] appears here; and continues.",
    end: "My own sentence, ending with [INFERRED FOR PLANNING]",
    discussing: "Literal discussion: [INFERRED FOR PLANNING] is a bracketed phrase the prompt kit asks assistants to use.",
  };
  for (const [shape, text] of Object.entries(shapes)) {
    const answer = await preview(collisionSource(`Shape ${shape}`, [
      { id: "state-a", name: "A", isDefault: true, notes: "Dry." },
      { id: "state-b", name: "B", parentStateId: "state-a", notes: text },
    ]));
    const row = answer.review.inferred.find((item) => item.path === "characters[0].continuityStates[1].notes");
    assert(row && row.origin === "source", `T1. ${shape}: must be reported as source-origin, got ${JSON.stringify(row)}`);
    const state = answer.review.continuity.find((item) => item.stateId === "state-b");
    assert(state && state.inferred === false && state.sourceMarked === true,
      `T1. ${shape}: source presence must never be read as a CineBraid inference, got ${JSON.stringify(state)}`);
    assert.strictEqual(answer.normalizedProject.characters[0].continuityStates[1].notes, text,
      `T1. ${shape}: and the prose is untouched`);
  }

  /* ---- T2. the collision matrix ----------------------------------------------- */
  const originsAt = (answer, at) => answer.review.inferred.filter((row) => row.path === at).map((row) => row.origin).sort();
  const stateOf = (answer, id) => answer.review.continuity.find((row) => row.entityId === "CHAR-ADA" && row.stateId === id);

  /* 1. same path, same text, both origins — the case that used to collapse. */
  const one = await preview(collisionSource("Collide One", [
    { id: "state-a", name: "A", notes: COLLIDING_TEXT },
    { id: "state-b", name: "B", parentStateId: "state-a", notes: "Wet." },
  ]));
  assert.deepStrictEqual(originsAt(one, NOTES_PATH), ["cinebraid", "source"],
    "T2.1. a byte-identical collision at one path must keep BOTH provenance facts");
  assert.strictEqual(stateOf(one, "state-a").inferred, true, "T2.1. the CineBraid decision survives");
  assert.strictEqual(stateOf(one, "state-a").sourceMarked, true, "T2.1. and so does the source presence");
  const rendered = vm.runInContext(`projectBuilderContinuityReview(${JSON.stringify(one.review.continuity)})`, context);
  assert(/data-continuity-origin="cinebraid\+source"/.test(rendered),
    "T2.1. and the card renders as cinebraid+source rather than either alone");

  /* 2. same path, different text, both origins. */
  const two = await preview(collisionSource("Collide Two", [
    { id: "state-a", name: "A", notes: "[INFERRED FOR PLANNING] a different sentence entirely." },
    { id: "state-b", name: "B", parentStateId: "state-a", notes: "Wet." },
  ]));
  assert.deepStrictEqual(originsAt(two, NOTES_PATH), ["cinebraid", "source"], "T2.2. both survive when the text differs too");

  /* 3 + 4. same-origin duplicates still collapse. */
  const dupes = await preview(collisionSource("Collide Dupes", [
    { id: "state-a", name: "A", notes: `${COLLIDING_TEXT}\n${COLLIDING_TEXT}` },
    { id: "state-b", name: "B", parentStateId: "state-a", notes: "Wet." },
  ]));
  assert.deepStrictEqual(originsAt(dupes, NOTES_PATH), ["cinebraid", "source"],
    "T2.3/4. repeated identical text at one path yields one row per origin, not four");

  /* 5. source only. */
  const five = await preview(collisionSource("Collide Five", [
    { id: "state-a", name: "A", isDefault: true, notes: "Dry." },
    { id: "state-b", name: "B", parentStateId: "state-a", notes: "[INFERRED FOR PLANNING] my own aside." },
  ]));
  assert.deepStrictEqual(originsAt(five, NOTES_PATH), [], "T2.5. a state CineBraid decided nothing about reports nothing there");
  assert.strictEqual(stateOf(five, "state-b").inferred, false, "T2.5. and is not an inference");
  assert.strictEqual(stateOf(five, "state-b").sourceMarked, true, "T2.5. only a source presence");

  /* 6. CineBraid only. */
  const six = await preview(collisionSource("Collide Six", [
    { id: "state-a", name: "A", notes: "Dry." },
    { id: "state-b", name: "B", parentStateId: "state-a", notes: "Wet." },
  ]));
  assert.deepStrictEqual(originsAt(six, NOTES_PATH), ["cinebraid"], "T2.6. a CineBraid decision alone");
  assert.strictEqual(!!stateOf(six, "state-a").sourceMarked, false, "T2.6. with no source presence claimed");

  /* 7. the mixed project's grouping and counts stay truthful. */
  const mixed = one;
  const cineRows = mixed.review.inferred.filter((row) => row.origin === "cinebraid");
  const srcRows = mixed.review.inferred.filter((row) => row.origin === "source");
  assert.strictEqual(cineRows.length + srcRows.length, mixed.review.inferred.length,
    "T2.7. every row is one origin or the other, and nothing is uncounted");
  const columns = vm.runInContext(`(() => {
    const review = ${JSON.stringify(mixed.review)};
    return { cine: projectBuilderReviewColumn("CineBraid planning decisions", "inferred", cinebraidInferences(review), "none"),
             source: projectBuilderReviewColumn("Planning-marker text found in source", "source", sourceInferences(review), "none") };
  })()`, context);
  assert.strictEqual((columns.cine.match(/data-origin="cinebraid"/g) || []).length, cineRows.length,
    "T2.7. the CineBraid column's count is its rows");
  assert.strictEqual((columns.source.match(/data-origin="source"/g) || []).length, srcRows.length,
    "T2.7. and the source column's is its own");
  assert.strictEqual((columns.cine.match(/data-origin="source"/g) || []).length, 0, "T2.7. with no crossover");

  note(`T. source-origin wording says only that planning-marker text was found — asserted against ${INTENT_CLAIMING_WORDS.length} intent-claiming phrasings and five authored shapes — and a byte-identical cross-origin collision at one path now keeps both facts (${originsAt(one, NOTES_PATH).join("+")}), rendering as cinebraid+source, while same-origin duplicates still collapse`);
}

/* =========================================================================
   U. THE FOUNDER DOGFOOD CORRECTION.

   Native-browser dogfood accepted the backend and refused the surface. Seven findings,
   and each one below is the reproduction of a sentence a filmmaker could not answer
   from what was on screen:

     * which piece of software is about to read my screenplay?
     * is Braidy doing this?
     * is my script leaving this machine?
     * which of these two import boxes is mine?
     * do I have to set a Project Look before I have a project?
     * seventeen near-identical lines — is this import in trouble?
     * where is the decision I came here to make?

   These are presentation assertions on purpose. Nothing below touches the review
   payload, the standing projection, the preview token or the commit path — the
   sections above already own those, and section U would be the wrong place to
   discover that any of them had changed.
   ========================================================================= */
async function sectionExternalAssistantIsExplicit() {
  const { html } = await createRender({ storage: { "cinebraid-creation-start-path": "assisted" } });
  const card = html.slice(html.indexOf('id="creation-assisted"'), html.indexOf("</section>", html.indexOf('id="creation-assisted"')));

  /* WHO DOES THE CONVERSION. Named, because "an AI assistant" did not answer it. */
  for (const name of NAMED_ASSISTANTS)
    assert(card.includes(name), `U1. the lead must name ${name} — a filmmaker has to know which software this is`);
  assert(/another assistant/i.test(card),
    "U1. and must leave the list open, so it reads as the filmmaker's own choice");

  /* NOT BRAIDY, AND NOT AUTOMATICALLY. Both halves, because either alone misleads —
     and both in ONE line, because the founder's complaint about this card was that
     the same fact was explained three times in three boxes. */
  const truth = card.match(/<p class="creation-quiet-truth"[^>]*>([^<]*)<\/p>/);
  assert(truth, "U2. the card must carry the one quiet truth line");
  assert(/CineBraid doesn't send anything from this screen/i.test(truth[1]),
    "U3. which states that nothing leaves this screen");
  assert(/Braidy isn't used for this step/i.test(truth[1]),
    "U2. and that Braidy is not what does this");
  assert.strictEqual((card.match(/Braidy/g) || []).length, 1,
    "U2. said once — a fact repeated in three places is what made this card unreadable");

  /* Braidy is never described as the engine, anywhere in this surface. */
  const studio = codeOnly(CREATION_STUDIO);
  for (const claim of [/Braidy (?:will |can )?convert/i, /Braidy builds your project/i, /ask Braidy to build/i])
    assert(!claim.test(studio), `U2. no path may describe Braidy as the conversion engine (${claim})`);
  note("U1-U3. the assisted card names ChatGPT / Claude / Gemini as the filmmaker's own assistant, states that Braidy does not do this conversion, and states that nothing is sent from this screen");
}

async function sectionCopyInstructionsIsPrimary() {
  const { html } = await createRender({ storage: { "cinebraid-creation-start-path": "assisted" } });
  const card = html.slice(html.indexOf('id="creation-assisted"'), html.indexOf("</section>", html.indexOf('id="creation-assisted"')));

  /* ONE PRIMARY AT A TIME, AND IT FOLLOWS THE MATERIAL.
   *
   * With an empty box the useful copy is the instructions; with something in it, the
   * useful copy is one paste containing both. Offering both as equal green buttons
   * asked the filmmaker to decide something CineBraid already knows. */
  const emptyPrimary = card.match(/<button[^>]*class="assemble-btn creation-primary-copy"[^>]*onclick="([^"]*)"[^>]*>([^<]*)<\/button>/);
  assert(emptyPrimary, "U4. copying must be a primary action, not a ghost button beside a download");
  assert.strictEqual(emptyPrimary[1], "copyProjectBuilderSystemPrompt()", "U4. with no material, the primary copies the instructions");
  assert(/copy project builder instructions/i.test(emptyPrimary[2]),
    `U4. and says so, got "${emptyPrimary && emptyPrimary[2]}"`);

  const withStory = await createRender({ storage: { "cinebraid-creation-start-path": "assisted" } });
  vm.runInContext(`setCreationDraft("assisted:story", ${JSON.stringify(SCRIPT)})`, withStory.context);
  await vm.runInContext("route()", withStory.context);
  const filled = withStory.map.get("main").innerHTML;
  const filledPrimary = filled.match(/<button[^>]*class="assemble-btn creation-primary-copy"[^>]*onclick="([^"]*)"[^>]*>([^<]*)<\/button>/);
  assert(filledPrimary, "U4. the primary action survives material being entered");
  assert.strictEqual(filledPrimary[1], "copyProjectBuilderRequest()",
    "U4. with material present, the primary copies the instructions AND the material");
  assert(/copy instructions \+ my material/i.test(filledPrimary[2]),
    `U4. and says so, got "${filledPrimary && filledPrimary[2]}"`);
  for (const view of [card, filled])
    assert.strictEqual((view.match(/class="assemble-btn creation-primary-copy"/g) || []).length, 1,
      "U4. exactly one primary copy control in either state");

  /* THE INSTRUCTIONS ARE READABLE WITHOUT A DOWNLOAD. Deciding whether to paste
     something into your own assistant should not require unzipping six files. */
  assert(/data-instructions\b/.test(card), "U5. the instructions must be inspectable in place");
  const disclosure = card.slice(card.indexOf("data-instructions"));
  assert(/<summary>View instructions<\/summary>/.test(disclosure), "U5. behind a plainly named disclosure");
  assert(/data-instructions-text/.test(disclosure), "U5. with somewhere for the text to land");
  assert(!/<details class="creation-instructions"[^>]*\sopen/.test(card), "U5. closed until asked for");
  assert(card.includes("loadProjectBuilderInstructions(this)"), "U5. filled by the shipped loader");
  const studio = codeOnly(CREATION_STUDIO);
  assert.strictEqual((studio.match(/api\/project-builder\/system-prompt/g) || []).length, 3,
    "U5. the viewer reads the same served prompt the two copy handlers do — not a second copy of it");

  /* AND THE FULL KIT IS STILL THE ADVANCED OPTION. */
  const kit = card.match(/<a class="ghost-btn" href="\/api\/project-builder\/kit" download>([^<]*)<\/a>/);
  assert(kit, "U5. the full prompt kit must remain downloadable");
  assert(/download full prompt kit/i.test(kit[1]), `U5. named for what it is, got "${kit && kit[1]}"`);
  assert(/repeat or offline/i.test(card), "U5. with one line saying when a filmmaker would want it");

  /* The steps are labelled in the order they happen, and the labels are labels
     rather than a second explanation of the paragraph above them. */
  const steps = [...card.matchAll(/<span>Step (\d) · ([^<]*)<\/span>/g)].map((m) => m[2]);
  assert.deepStrictEqual(steps, ["Add your material", "Paste the project it returns"],
    `U4. the material and the return are labelled steps, got ${JSON.stringify(steps)}`);
  assert(/<b>Take it to your AI assistant<\/b>/.test(card), "U4. and step 2 is the hand-off");
  note(`U4-U5. the primary copy is "${emptyPrimary[2]}" empty and "${filledPrimary[2]}" with material, the instructions are readable in place, and "${kit[1]}" stays as the advanced option`);
}

async function sectionExistingProjectPathIsUnambiguous() {
  const { html } = await createRender({ storage: { "cinebraid-creation-start-path": "cinebraid" } });
  const card = html.slice(html.indexOf('id="creation-cinebraid"'), html.indexOf("</section>", html.indexOf('id="creation-cinebraid"')));

  /* WHAT BELONGS HERE, IN THE FIRST SENTENCE. The founder read this card as the
     Project Builder's twin; the answer has to be the first thing on it, not a
     paragraph the reader has to finish. */
  const lead = card.slice(card.indexOf("<p>"), card.indexOf("</p>"));
  assert(/This expects a CineBraid project JSON/i.test(lead),
    `U6. the path must open by saying what it expects: ${lead.slice(0, 160)}`);
  for (const kind of [/\.json/i, /backup/i, /someone sent you/i])
    assert(kind.test(card), `U6. and must say it takes ${kind}`);

  /* THE HAND-OFF, so the filmmaker who is in the wrong place is not simply told so. */
  assert(/data-cinebraid-scope/.test(card), "U7. the path must offer a way out for the wrong material");
  assert(/setCreationStartPath\('assisted'\)/.test(card),
    "U7. a filmmaker holding a script must be handed to the path that wants them");
  assert(/Have a screenplay, treatment or notes\?/i.test(card), "U7. in a sentence addressed to them");
  assert(/Build with an AI assistant/i.test(card), "U7. naming the path they should be on");
  assert(!card.includes("/api/project-builder/kit"),
    "U7. and the Prompt Kit must not be duplicated into this path — the issue was clarity, not missing function");
  note("U6-U7. the existing-project path opens by naming the CineBraid project JSON it expects, and hands a screenplay-holder to the assisted path");
}

async function sectionManualStartIsNotAChecklist() {
  const { html } = await createRender({ storage: { "cinebraid-creation-start-path": "scratch" } });

  /* IDENTITY FIRST — of the project being STARTED, not of the one already open.
   *
   * AT1-D. This assertion used to require the three fields to be wired to
   * `setProjectTitle(this.value)`, `P.meta.format=this.value;dirty()` and
   * `setGlobalCreationField('aspectRatio',this.value)`, under the heading "no new
   * persistence". The persistence half of that reasoning was right and is kept:
   * completing a manual start still writes through the shipped creation route and
   * this path still invents no storage of its own.
   *
   * The half that was wrong is WHICH PROJECT those handlers write to. All three
   * write `P.meta` — the project already open — and all three call `dirty()`. So
   * a filmmaker who opened Start a project, chose Start manually and typed a
   * title had renamed the film they were working on and queued the rename to be
   * saved, on a screen whose own words are "Whatever you start here becomes its
   * own project. The one you have open now is not changed." This assertion is
   * what kept that wiring in place, so it is corrected here rather than deleted:
   * the fields must reach the DRAFT writer, and must not be able to reach any of
   * the three writers that edit the open project. */
  assert(/data-manual-identity/.test(html), "U8. manual start must open on the project's own identity");
  for (const handler of ["setManualStartField('title',this.value)", "setManualStartField('format',this.value)", "setManualStartField('aspectRatio',this.value)"])
    assert(html.includes(handler), `U8. through the draft handler ${handler} — no new persistence, and no edit to the open project`);
  for (const retired of ["setProjectTitle(this.value)", "P.meta.format=this.value;dirty()", "setGlobalCreationField('aspectRatio',this.value)"])
    assert(!html.includes(retired),
      `U8. and never through ${retired}, which writes the project already open`);
  assert(/data-manual-start-commit/.test(html),
    "U8. with one explicit act that creates the separate project this screen promised");

  /* U9 — B2. THIS ASSERTION USED TO REQUIRE THE DEFECT.
   *
   * It demanded that "Look and references" be present, that Project Look live
   * inside it, and that addEntity()/addShot() stay reachable — on the CREATE
   * screen. Every one of those edits the project already open: Project Look's
   * textareas call setGlobalCreationField(), which calls dirty(), and addEntity
   * and addShot create records in the open film. Independent boundary review
   * reproduced exactly that, and this assertion is what kept the wiring in
   * place. Like U8 before it, it is corrected rather than deleted: what the
   * create screen may contain is the DRAFT, and nothing that writes the project
   * a filmmaker already has open.
   *
   * NOTHING IS LOST, and that is asserted where it is now true — Settings →
   * Project still owns the look, and the references and shots surfaces still own
   * their creation controls. */
  const identityAt = html.indexOf("data-manual-identity");
  assert(identityAt > -1, "U9. the create screen renders the new project's identity");
  assert(!/data-manual-next/.test(html),
    "U9. the 'Look and references' disclosure must not be on the create screen — it wrote the open project");
  assert(!/id="creation-global-style"/.test(html),
    "U9. nor Project Look, whose fields call setGlobalCreationField() and mark the open project dirty");
  for (const control of ["addEntity('locations')", "addEntity('characters')", "addEntity('props')", "addShot()"])
    assert(!html.includes(control),
      `U9. nor ${control}, which creates a record in the film that is already open`);
  assert(/data-manual-after-create/.test(html),
    "U9. and the screen says where those tools live once the project exists");
  /* The capability is still in the product, in the surface that owns it. */
  const settingsSource = fs.readFileSync(path.join(ROOT, "public", "views.js"), "utf8");
  assert(settingsSource.includes("setGlobalCreationField('globalStylePrompt'"),
    "U9. Settings → Project still owns the global style, so retiring it from the create screen removed no capability");

  /* AND IT SOUNDS LIKE STARTING A PROJECT. The structure was already light after the
     first correction; the copy still read as product documentation explaining what
     CineBraid needs from you. */
  assert(/<h3>Start with the basics<\/h3>/.test(html), "U9. the manual path opens on plain words");
  /* AT1-D: "the NEW project", because that is which one these fields describe,
     followed by the reassurance the screen's promise implies — the sentence a
     filmmaker needs when the boxes in front of them are empty and the film they
     were working on a moment ago is not. Same register, same length, one more
     true thing said. */
  assert(/Give the new project a name, format and frame\. You can decide everything else later\./.test(html),
    "U9. saying what to do and what can wait, in one sentence");
  assert(/Nothing here changes /.test(html),
    "U9. and naming the project that is NOT being edited, which is the promise this screen makes");
  /* B2. THE EMPTY-STATE FIRST ACTION BELONGED TO THE OPEN PROJECT.
     "Ready for the first scene" offered addShot() and addEntity('locations'),
     and both create records in the film already open. The empty state still
     orients — it is rendered off the open project and reading it is not editing
     it — but the two writers it carried are replaced by a link to the surface
     that owns them. */
  const blank = buildFixture();
  blank.scenes = [];
  blank.shots = [];
  const empty = await createRender({ project: blank, storage: { "cinebraid-creation-start-path": "scratch" } });
  assert(/Ready for the first scene/.test(empty.html),
    "U9. the empty state still orients a filmmaker whose open project has no scenes");
  assert(!/onclick="addShot\(\)"/.test(empty.html) && !/onclick="addEntity\(/.test(empty.html),
    "U9. but it must not OFFER the writers that create records in the open project");
  assert(/data-manual-after-create/.test(empty.html),
    "U9. it names where the look, references and shots live once this project exists");
  assert(/data-manual-start-commit/.test(empty.html),
    "U9. and its own first action is creating the project");
  note("U8-U9. manual start opens on the NEW project's title / format / aspect through the draft handler — never the writers that edit the project already open — in plain words, and B2 retired every remaining open-project writer from the surface below it");
}

/* =========================================================================
   V. THE WORDING THE FOUNDER ASKED TO BE RID OF.

   The first correction fixed the hierarchy and left the register wrong: slogan-like
   parallel phrasing, a desk metaphor, and the same fact explained in three places
   because each box had been written to stand alone. This is a copy control, and it
   is deliberately a blocklist — it names the specific phrasings that were retired,
   so a future edit cannot quietly restore the voice they belonged to.
   ========================================================================= */
const RETIRED_PHRASING = [
  "already on your desk",
  "HAND IT OVER",
  "Hand what you have written",
  "Three ways in",
  "hand it over",
  "Turn what you have written into",
  "not where a screenplay goes",
];
async function sectionWordingIsPlain() {
  const views = {};
  for (const stored of ["assisted", "cinebraid", "scratch"])
    views[stored] = (await createRender({ storage: { "cinebraid-creation-start-path": stored } })).html;

  for (const [stored, html] of Object.entries(views))
    for (const phrase of RETIRED_PHRASING)
      assert(!html.includes(phrase), `V1. "${phrase}" was retired from the ${stored} path and must not return`);

  /* NO FACT EXPLAINED TWICE ON ONE SCREEN. Three of these were each stated in two or
     three places at once, which is what made the surface read as documentation. */
  for (const [phrase, limit] of [["Braidy", 1], ["ChatGPT", 1], ["Project Builder instructions", 1]])
    assert((views.assisted.match(new RegExp(phrase, "g")) || []).length <= limit,
      `V2. "${phrase}" belongs on this screen once, not ${(views.assisted.match(new RegExp(phrase, "g")) || []).length} times`);

  /* SHORT, AND ADDRESSED TO A PERSON. The chooser's own words carry the whole
     decision, so they are the ones held to a length. */
  const intents = JSON.parse(vm.runInContext("JSON.stringify(CREATION_INTENTS)", (await createRender()).context));
  for (const intent of intents) {
    assert(intent.blurb.length <= 140,
      `V3. the ${intent.key} card is ${intent.blurb.length} characters; a card is read at a glance`);
    assert(!/—/.test(intent.title), `V3. and its title is a name, not a sentence with an aside`);
  }
  note(`V. ${RETIRED_PHRASING.length} retired phrasings stay retired, no fact on the assisted path is stated twice, and the three cards read in ${intents.map((i) => i.blurb.length).join("/")} characters`);
}

async function sectionImportPreviewIsSummaryFirst() {
  const { context } = await createRender();
  const review = {
    counts: { scenes: 3, shots: 16, characters: 2, locations: 7, props: 0, vehicles: 0, keyframes: 20, motionUnits: 12 },
    sourceCounts: { scenes: 3, shots: 16 },
    inferred: [{ path: "shots[0].notes", value: "[INFERRED FOR PLANNING] duration", origin: "cinebraid" }],
    conflicts: [],
    missing: [],
    removed: [],
    review: Array.from({ length: 16 }, (_, i) => `Shot S01-${String(i + 1).padStart(2, "0")}: add a simpler fallback for the risks this shot declares`)
      .concat(["Scene S02: add emotional or tonal intent"]),
    continuity: [{ kind: "Character", entityId: "CHAR-A", entityName: "Ada", stateId: "state-default", stateName: "Default", isDefault: true, notes: "", inferred: true, sourceMarked: false }],
    outline: [
      { id: "S01", title: "The Problem", tier: "A", whatHappens: "It begins.", howItFeels: "Uneasy.", shots: [
        { id: "S01-01", title: "Ada arrives", route: "GENERATE", duration: 6, description: "Ada walks in.", positioning: "Medium, frame left.", risks: ["Identity drift"], keyframes: [{ label: "A", description: "Ada at the door." }], motionUnits: [{ kind: "i2v", duration: 6, motionPrompt: "She walks." }] },
        { id: "S01-02", title: "The desk", route: "GENERATE", duration: 4, description: "The desk.", positioning: "Static.", risks: [], keyframes: [], motionUnits: [] },
      ] },
      { id: "S02", title: "Organize the World", tier: "B", whatHappens: "It continues.", howItFeels: "Steady.", shots: [] },
    ],
  };
  const html = vm.runInContext(`renderProjectBuilderReview(${JSON.stringify({ title: "Dogfood Import", previewHash: "a".repeat(64), review })})`, context);

  /* 1-2. WHAT PROJECT IS THIS, AND WHAT WILL CINEBRAID CREATE. */
  assert(html.includes("Dogfood Import"), "U10. the preview must name the project");
  const summary = html.slice(0, html.indexOf("import-issue-summary"));
  assert(/3 scenes · 16 shots · 2 characters · 7 locations/.test(summary),
    "U10. and say what it will create, in one line, above everything else");
  assert(!/0 props/.test(summary), "U10. without inventing a row for something the import does not contain");

  /* 3-4. IS ANYTHING BLOCKING, AND WHAT IS MERELY WORTH CHECKING. */
  assert(html.includes('data-entry-standing="needs-review"'), "U11. the standing is the same projection it always was");
  assert(html.indexOf('data-entry-standing') < html.indexOf("import-issue-summary"),
    "U11. and it comes before the findings rather than after them");

  /* 5. AND THE DECISION IS ON THE FIRST SCREEN. */
  const structureAt = html.indexOf('data-import-section="structure"');
  assert(html.indexOf('data-import-action="summary"') < structureAt,
    "U12. the import action must be reachable from the summary, above the detail");
  assert.strictEqual((html.match(/commitProjectBuilderImport\(\)/g) || []).length, 2,
    "U12. exactly two rendered import controls — summary and footer — and both are the one shipped commit");
  assert.strictEqual((html.match(/creation-next-step/g) || []).length, 1,
    "U12. with a single footer step, so the existing selector still names exactly one control");
  /* THE TWO EXACT-PREVIEW FACTS, ONE EACH. The summary and the footer both used to
     recite both of them, which is how a safety guarantee starts reading as filler.
     Both facts are still on the screen and neither is said twice. */
  assert(/Imports exactly what is shown here, as a separate project\./.test(html),
    "U12. the summary states that the import is exactly this preview, into its own project");
  assert(/Change the source and it needs validating again\./.test(html),
    "U12. and the footer states that editing the source invalidates it");
  assert(html.includes("Exact preview locked"), "U12. and the preview is still declared locked");
  note("U10-U12. the preview opens on title, what will be created, the standing, the grouped findings and the import button, in that order");
}

async function sectionRepeatedFindingsAreGrouped() {
  const { context } = await createRender();
  const lines = Array.from({ length: 16 }, (_, i) => `Shot S01-${String(i + 1).padStart(2, "0")}: add a simpler fallback for the risks this shot declares`);
  const summary = vm.runInContext(`projectBuilderIssueSummary(${JSON.stringify({ missing: [], conflicts: [], review: lines.concat(["Scene S02: add emotional or tonal intent"]) })})`, context);

  /* SAID ONCE, COUNTED HONESTLY. */
  assert(/<b>16 shots<\/b>/.test(summary), `U13. sixteen identical findings must read as one line: ${summary.slice(0, 400)}`);
  assert(/add a simpler fallback for the risks this shot declares/.test(summary),
    "U13. in the review's own words, not a re-worded summary");
  assert(/Show all 16/.test(summary), "U13. with a way to open all sixteen");
  assert(/<b>1 scene<\/b>/.test(summary), "U13. and a single finding still says one, in its own subject's word");

  /* AND EVERY ORIGINAL LINE IS STILL THERE. This is the whole safety property: the
     grouping is presentation, so nothing may be lost inside it. */
  for (const line of lines)
    assert(summary.includes(line), `U14. every individual finding must remain inspectable: ${line}`);
  assert.strictEqual((summary.match(/<li>Shot S01-/g) || []).length, 16, "U14. all sixteen, once each");

  /* SEVERITY IS UNTOUCHED — a review finding is never rendered as a blocker. */
  const blocked = vm.runInContext(`projectBuilderIssueSummary(${JSON.stringify({ missing: ["Shot S01-01: action description"], conflicts: [], review: ["Scene S02: add emotional or tonal intent"] })})`, context);
  const blockingBlock = blocked.slice(blocked.indexOf('data-issue-kind="blocking"'), blocked.indexOf('data-issue-kind="review"'));
  assert(blockingBlock.includes("action description"), "U15. what the server called missing renders as blocking");
  assert(!blockingBlock.includes("emotional or tonal intent"), "U15. and what it called review does not");
  assert(!summary.includes('data-issue-kind="blocking"'),
    "U15. an import with nothing missing must render no blocking block at all");

  /* Grouping never re-words. A finding with no colon is its own group of one. */
  const odd = vm.runInContext(`projectBuilderIssueSummary(${JSON.stringify({ missing: [], conflicts: [], review: ["qcChecklist contained 2 usable items; CineBraid completed it to exactly five review checks."] })})`, context);
  assert(odd.includes("qcChecklist contained 2 usable items"), "U14. an ungroupable finding survives verbatim");
  assert(/<b>1 item<\/b>/.test(odd), "U14. counted as one, with no subject invented for it");
  note("U13-U15. sixteen identical findings render as one countable line with all sixteen inspectable inside it, and the missing / review split is the server's own");
}

async function sectionStructureAndTechnicalAreDisclosed() {
  const { context } = await createRender();
  const review = {
    counts: { scenes: 2, shots: 2, characters: 1, locations: 1, props: 0, vehicles: 0 },
    sourceCounts: { scenes: 2, shots: 2 },
    inferred: [{ path: "shots[0].notes", value: "[INFERRED FOR PLANNING] x", origin: "cinebraid" }],
    conflicts: [], missing: [], removed: ["mediaAssets was cleared"], review: [],
    continuity: [{ kind: "Character", entityId: "CHAR-A", entityName: "Ada", stateId: "state-default", stateName: "Default", isDefault: true, notes: "", inferred: true, sourceMarked: false }],
    outline: [
      { id: "S01", title: "The Problem", tier: "A", whatHappens: "It begins.", howItFeels: "Uneasy.", shots: [{ id: "S01-01", title: "Ada arrives", route: "GENERATE", duration: 6, description: "Ada walks in.", positioning: "Medium, frame left.", risks: ["Identity drift"], keyframes: [{ label: "A", description: "Ada at the door." }], motionUnits: [{ kind: "i2v", duration: 6, motionPrompt: "She walks." }] }] },
      { id: "S02", title: "Organize the World", tier: "B", whatHappens: "It continues.", howItFeels: "Steady.", shots: [] },
    ],
  };
  const html = vm.runInContext(`renderProjectBuilderReview(${JSON.stringify({ title: "Disclosure", previewHash: "b".repeat(64), review })})`, context);

  /* NOTHING IS OPEN ON ARRIVAL EXCEPT THE DECISION. Not the structure, not the
     technical evidence, and — the founder's specific complaint — not the first scene. */
  for (const section of ["structure", "technical"]) {
    const open = new RegExp(`<details[^>]*data-import-section="${section}"[^>]*\\sopen`);
    assert(!open.test(html), `U16. the ${section} section must be closed on arrival`);
    assert(html.includes(`data-import-section="${section}"`), `U16. and must exist`);
  }
  assert(!/<details class="import-scene"[^>]*\sopen/.test(html), "U17. every scene must be closed, including the first");
  assert(!/<details class="import-shot"[^>]*\sopen/.test(html), "U17. and every shot inside it");

  /* THREE DEPTHS, EACH COMPLETE. Scene row, shot row, shot detail. */
  assert.strictEqual((html.match(/data-import-scene="/g) || []).length, 2, "U17. one row per scene");
  assert(/S01 · The Problem/.test(html) && /1 shot · tier A/.test(html), "U17. named and counted in the row itself");
  assert(/data-import-shot="S01-01"/.test(html), "U17. with a compact row per shot inside it");
  assert(/Medium, frame left\./.test(html) && /Identity drift/.test(html) && /She walks\./.test(html),
    "U17. and the full planning detail still present, one level deeper");

  /* THE EVIDENCE IS COMPLETE AND OUT OF THE WAY. */
  const technical = html.slice(html.indexOf('data-import-section="technical"'));
  assert(/PREVIEW SHA-256/.test(technical) && /b{64}/.test(technical), "U18. the hash lives in the technical section");
  assert(/import-count-comparison/.test(technical), "U18. so does the before/after counter grid");
  assert(/import-review-grid/.test(technical), "U18. and the six origin columns");
  assert(/import-continuity-list/.test(technical), "U18. and the continuity states");
  assert(!/PREVIEW SHA-256/.test(html.slice(0, html.indexOf('data-import-section="technical"'))),
    "U18. and none of it competes with the import decision above");
  assert(/downloadNormalizedProjectBuilderJSON\(\)/.test(technical), "U18. the normalized download is still offered");
  note("U16-U18. structure and technical evidence are both closed on arrival, scenes and shots open one depth at a time, and the hash, counters, origin columns and continuity states are all still rendered");
}

async function main() {
  await sectionEntryIsIntentFirst();
  await sectionAssistedFraming();
  await sectionCineBraidImportDistinct();
  await sectionScratchRemains();
  await sectionSwitchingPreservesInput();
  await sectionFormatAndAspect();
  await sectionGlobalStyleDeferred();
  await sectionReviewStanding();
  await sectionPlanningMarkerBoundary();
  await sectionSuccessfulImportLands();
  await sectionLandingStandingFollowsReview();
  sectionSingleNextActionAuthority();
  await sectionFileReadOwnership();
  await sectionNullAuthorityChoosesNothing();
  sectionStripFollowsRenderedRoute();
  await sectionAsyncOperationOwnership();
  await sectionAsyncOwnershipAttacks();
  await sectionSliceOnePreserved();
  await sectionNoLaterSliceLeakage();
  await sectionExternalAssistantIsExplicit();
  await sectionCopyInstructionsIsPrimary();
  await sectionExistingProjectPathIsUnambiguous();
  await sectionManualStartIsNotAChecklist();
  await sectionImportPreviewIsSummaryFirst();
  await sectionRepeatedFindingsAreGrouped();
  await sectionStructureAndTechnicalAreDisclosed();
  await sectionWordingIsPlain();
  console.log(notes.join("\n"));
  console.log("Project entry & import landing suite passed: three intents, retained source material, typed format/aspect, deferred style, Ready/Needs review/Blocked, the planning-marker boundary, a landing whose next action is the single projectNextProductionAction(), and the founder-dogfood surface corrections — external assistant named, Braidy excluded from the conversion, copy-instructions primary, existing-project path scoped, manual start un-gated, an import preview that answers the decision before it shows the evidence, and a final wording pass that keeps the retired phrasings retired.");
}

/* A HANG IS A FAILURE, NOT A PASS. Sections S gate their own responses; a gate this
   suite forgets to open leaves main() awaiting forever, Node drains its loop and exits
   0 having printed nothing. That is indistinguishable from success to npm, so it is
   made loud here. */
const watchdog = setTimeout(() => {
  console.error("Project entry suite timed out — a gated response was never released, or a section never settled.");
  process.exit(1);
}, 120000);
main().then(() => clearTimeout(watchdog)).catch((error) => {
  clearTimeout(watchdog);
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
