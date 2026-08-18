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
  assert.deepStrictEqual(intents, [
    ["assisted", "Build from a script/story with AI", true],
    ["cinebraid", "Import a CineBraid project", false],
    ["scratch", "Start from scratch", false],
  ], "A. the three starting intents are frozen, in this order, and only the first is recommended");

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
const IMPLEMENTATION_JARGON = ["LLM", "ChatGPT", "Claude", "GPT", "Ollama", "API key", "endpoint", "temperature", "token", "provider", "model"];
async function sectionAssistedFraming() {
  const { html, context } = await createRender();
  const intent = vm.runInContext("JSON.stringify(CREATION_INTENTS[0])", context);
  const primary = JSON.parse(intent);
  const framing = `${primary.eyebrow} ${primary.title} ${primary.blurb}`;
  for (const word of IMPLEMENTATION_JARGON)
    assert(!new RegExp(`\\b${word}\\b`, "i").test(framing),
      `B. the assisted intent's own words must not lead with "${word}": ${framing}`);
  assert(/script|story/i.test(primary.title), "B. the assisted intent must be named for what the filmmaker has");

  const head = html.slice(html.indexOf('id="creation-assisted"'));
  const heading = head.slice(0, head.indexOf("</div>", head.indexOf("<h3>")));
  for (const word of IMPLEMENTATION_JARGON)
    assert(!new RegExp(`\\b${word}\\b`, "i").test(heading),
      `B. the assisted card's heading must not lead with "${word}"`);

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
  assert(/no assistant is involved/i.test(cine.html), "C. the CineBraid path must say that no assistant is involved");

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
   D. SCRATCH IS STILL THERE, AND IS STILL THE MANUAL WORKSPACE.
   ========================================================================= */
async function sectionScratchRemains() {
  const { html } = await createRender({ storage: { "cinebraid-creation-start-path": "scratch" } });
  assert(html.includes('id="creation-scratch"'), "D. the scratch intent must render the manual workspace");
  for (const control of ["addEntity('locations')", "addEntity('characters')", "addShot()"])
    assert(html.includes(control), `D. the manual workspace must keep ${control}`);
  assert(html.includes("PROJECT AT A GLANCE"), "D. and its own project summary");
  note("D. the scratch intent renders the manual workspace with its reference and shot entry points intact");
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

  /* No new persistent field was invented to make either control readable. */
  const newProjectRoute = read("server.js").slice(read("server.js").indexOf('app.post("/api/projects/new"'));
  const accepted = [...newProjectRoute.slice(0, 1400).matchAll(/req\.body\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual([...new Set(accepted)], ["aspectRatio", "firstScene", "format", "globalNegativePrompt", "globalStylePrompt", "title", "worldSetting"],
    "F. project creation accepts exactly the fields it accepted before this slice");
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

  /* On the create screen it is a disclosure with no outstanding-work chip. */
  const blank = buildFixture();
  blank.meta.globalStylePrompt = "";
  blank.meta.styleBlocks = [];
  const scratch = await createRender({ project: blank, storage: { "cinebraid-creation-start-path": "scratch" } });
  const card = scratch.html.slice(scratch.html.indexOf('id="creation-global-style"'));
  assert(scratch.html.includes('<details id="creation-global-style"'), "G. the style card must be a disclosure");
  assert(/OPTIONAL/.test(card.slice(0, 400)), "G. and must say it is optional");
  assert(!/STEP 1/.test(card.slice(0, 400)), "G. it must no longer be step one");
  assert(!/creation-state warn/.test(card.slice(0, 400)), "G. and must not chip the filmmaker for not having done it");
  assert(!/Start here/.test(scratch.html), "G. nothing on the create screen may demand the look first");

  /* THE CAPABILITY IS MOVED, NOT REMOVED. Both editors still exist and still write
     through the same setter. */
  assert(card.includes("setGlobalCreationField('globalStylePrompt'"), "G. the create-screen editor still writes the style");
  const settings = await render("#/settings", buildFixture(), {
    storage: { "cinebraid-focused:fixture:settings-task:settings": "project" },
  });
  assert(settings.html.includes('id="cfg-global-visual-style"'), "G. Settings → Project still edits the global visual style");
  assert(settings.html.includes('list="cinebraid-format-presets"'), "G/F. and offers the same typed format suggestions the create screen does");
  note("G. the global look is a disclosure marked OPTIONAL on the create screen, absent from the create modal, and still fully editable in Settings → Project");
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
  console.log(notes.join("\n"));
  console.log("Project entry & import landing suite passed: three intents, retained source material, typed format/aspect, deferred style, Ready/Needs review/Blocked, the planning-marker boundary, and a landing whose next action is the single projectNextProductionAction().");
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
