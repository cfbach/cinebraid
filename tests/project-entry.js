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
  await sectionSliceOnePreserved();
  await sectionNoLaterSliceLeakage();
  console.log(notes.join("\n"));
  console.log("Project entry & import landing suite passed: three intents, retained source material, typed format/aspect, deferred style, Ready/Needs review/Blocked, the planning-marker boundary, and a landing whose next action is the single projectNextProductionAction().");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
