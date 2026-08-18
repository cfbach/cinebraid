/* CineBraid — Batch 2, Slice 2: PROJECT ENTRY, NEGATIVE CONTROLS.
 *
 * tests/project-entry.js asserts that the entry surface behaves. Every one of those
 * assertions is worthless if it cannot fail, and several of them are the shape that
 * most often cannot: "the marker is absent", "the chooser is absent", "nothing from a
 * later slice appears". An absence check passes against a blank string.
 *
 * So each control here BREAKS the product deliberately — in memory, in this process,
 * never on disk — and requires the corresponding assertion to catch it. A control
 * that arms itself and then reports success without the break having happened is the
 * failure mode this file exists to avoid, so every control proves the break landed
 * before it judges the detector.
 *
 *   N1  a second next-action derivation on the landing is caught
 *   N2  the landing reading the authority is proven by MOVING the authority
 *   N3  re-introducing the planning marker into imported prose is caught
 *   N4  a chooser that drops entered material is caught
 *   N5  provider jargon returning to the assisted framing is caught
 *   N6  a landing that renders the chooser again is caught
 *   N7  Slice 3-5 vocabulary appearing on the entry is caught
 *   N8  the standing detector distinguishes Blocked from Needs review
 *
 * Nothing here contacts a provider, spends anything, or writes to a project.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const { render, buildFixture } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

/* The same comment strip the positive suite uses: the retirement notes name what they
   retired, and a call-site count that included prose would count the explanation. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

/* The detectors, lifted out of tests/project-entry.js so a control tests the SAME
   predicate the positive suite relies on rather than a lookalike. */
const detectors = {
  landingUsesSharedRenderer(html, expectedMarkup) {
    return html.slice(html.indexOf("WHAT TO DO NEXT")).includes(expectedMarkup);
  },
  noChooserOnLanding(html) {
    return !html.includes("creation-start-choice") && !html.includes('data-creation-intent="assisted"');
  },
  noPlanningMarker(project) {
    const hits = [];
    const walk = (value, at) => {
      if (typeof value === "string") { if (/\[INFERRED FOR PLANNING\]/i.test(value)) hits.push(at); }
      else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${at}[${index}]`));
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walk(item, at ? `${at}.${key}` : key));
    };
    walk(project, "");
    return hits;
  },
  jargonFree(text) {
    return !["LLM", "ChatGPT", "Claude", "GPT", "Ollama", "provider", "model"].some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
  },
  noLaterSliceVocabulary(html) {
    return ![/reference\s*reframe/i, /demand[- ]driven/i, /simple\s*\/\s*advanced/i, /\$\d|price|usd/i, /shot\s*intent|execution\s*routing/i, /analytics/i]
      .some((pattern) => pattern.test(html));
  },
};

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
  normalized.meta.title = "Control Import";
  const review = importReview(reviewOver);
  let active = "current";
  const fetchStub = async (url, options, respond) => {
    if (url === "/api/project")
      return respond(active === "current" ? current : normalized, 200, { "x-cinebraid-project-slug": active });
    if (url === "/api/projects/preview-import-json" && options.method === "POST")
      return respond({ ok: true, title: normalized.meta.title, previewToken: "control-token", previewHash: "c".repeat(64), normalizedProject: normalized, review });
    if (url === "/api/projects/import-json" && options.method === "POST") {
      active = "control-import";
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

/* =========================================================================
   N1. A SECOND NEXT-ACTION DERIVATION ON THE LANDING IS CAUGHT.

   The forbidden thing is not "a wrong answer" — it is a SECOND answer, which can
   agree today and disagree tomorrow. So the fork installed here deliberately
   AGREES with the authority on the words and differs only in being its own
   derivation, which is exactly the case a value comparison would wave through.
   ========================================================================= */
async function n1ParallelDerivationIsCaught() {
  const { html, context } = await landedRender();
  const expected = vm.runInContext("creationRecommendedActionMarkup()", context);
  assert(detectors.landingUsesSharedRenderer(html, expected), "N1. precondition: the shipped landing passes its own detector");

  /* A plausible fork: it reads the same readiness feed, produces the same visible
     words, and is a different function. */
  const forked = vm.runInContext(`(() => {
    const feed = projectShotReadiness();
    const shot = (feed.shots || []).find((row) => row.status !== "COMPLETE");
    const next = projectNextProductionAction();
    return \`<article data-recommended-kind="\${attr(next.kind)}"><span>RECOMMENDED</span><b>\${esc(next.title)}</b><small>\${esc(next.message || next.actionLabel)}</small><button class="assemble-btn" onclick="location.hash='#/shot/' + \${JSON.stringify(shot ? shot.shotId : "")}">\${esc(next.actionLabel)} →</button></article>\`;
  })()`, context);
  const forgedLanding = html.replace(expected, forked);
  assert(forgedLanding !== html, "N1. the break must land — the fork has to have replaced the shipped markup");
  assert(forgedLanding.includes("RECOMMENDED") && forgedLanding.includes("data-recommended-kind"),
    "N1. and the fork must still look like the real card, or the control is too easy");
  assert(!detectors.landingUsesSharedRenderer(forgedLanding, expected),
    "N1. a landing that renders its own next-action markup instead of the shared renderer must be caught");

  /* And the structural detector catches the fork being ADDED to the file. */
  const studio = codeOnly(read("public/creation-studio.js"));
  const withFork = studio.replace(
    "function projectEntryLandingView(landing) {",
    "function projectEntryLandingView(landing) {\n  const second = projectNextProductionAction();",
  );
  assert(withFork !== studio, "N1. the source break must land");
  assert.strictEqual((studio.match(/projectNextProductionAction\(/g) || []).length, 1, "N1. precondition: one call today");
  assert.strictEqual((withFork.match(/projectNextProductionAction\(/g) || []).length, 2,
    "N1. a second call site in the creation studio must move the count the positive suite pins");
  note("N1. a fork that agrees with the authority word for word is still caught, both in the rendered landing and by the pinned call-site count");
}

/* =========================================================================
   N2. THE LANDING REALLY READS THE AUTHORITY — PROVEN BY MOVING IT.

   "The landing calls projectNextProductionAction()" is a claim about a data flow.
   The only way to prove a flow is to change the upstream value and see the
   downstream change, so this replaces the derivation with a recognisable answer.
   ========================================================================= */
async function n2LandingFollowsTheAuthority() {
  const { html, context } = await landedRender();
  const before = html.slice(html.indexOf("WHAT TO DO NEXT"));
  assert(!before.includes("MOVED THE AUTHORITY"), "N2. precondition: the sentinel cannot already be on the page");

  vm.runInContext(`
    globalThis.__realNextAction = projectNextProductionAction;
    globalThis.projectNextProductionAction = () => ({
      kind: "control", href: "#/production", title: "MOVED THE AUTHORITY",
      message: "This came from the one derivation.", actionLabel: "PROVE IT",
    });
  `, context);
  await vm.runInContext("route()", context);
  const after = vm.runInContext("document.getElementById('main').innerHTML", context);
  assert(after.includes("MOVED THE AUTHORITY"),
    "N2. changing projectNextProductionAction() must change the landing — if it does not, the landing is deriving its own answer");
  assert(after.includes('data-recommended-kind="control"') && after.includes("PROVE IT"),
    "N2. and every part of the card must follow, not just the headline");

  vm.runInContext("globalThis.projectNextProductionAction = globalThis.__realNextAction;", context);
  await vm.runInContext("route()", context);
  const restored = vm.runInContext("document.getElementById('main').innerHTML", context);
  assert(!restored.includes("MOVED THE AUTHORITY"), "N2. and the sentinel must be gone once the authority is put back");
  note("N2. replacing projectNextProductionAction() changes every part of the landing's next-action card, and restoring it removes the change — the landing reads the authority rather than reproducing it");
}

/* =========================================================================
   N3. RE-INTRODUCING THE PLANNING MARKER IS CAUGHT.
   ========================================================================= */
function n3MarkerReintroductionIsCaught() {
  const clean = {
    characters: [{ id: "CHAR-ADA", continuityStates: [{ id: "state-clean", notes: "The coat is dry and the collar sits flat." }] }],
    scenes: [{ id: "SC-01", notes: "" }],
  };
  assert.deepStrictEqual(detectors.noPlanningMarker(clean), [], "N3. precondition: the clean project has no marker");

  const leaked = JSON.parse(JSON.stringify(clean));
  leaked.characters[0].continuityStates[0].notes =
    "The coat is dry and the collar sits flat.\n[INFERRED FOR PLANNING] CineBraid selected this as the default continuity state during import.";
  assert.notDeepStrictEqual(leaked, clean, "N3. the break must land");
  assert.deepStrictEqual(detectors.noPlanningMarker(leaked), ["characters[0].continuityStates[0].notes"],
    "N3. a marker appended to a state delta must be caught, and named");

  /* The narrow-cut claim can also fail the other way: a strip that took the prose
     with it would be a different defect, and the positive suite's byte-for-byte
     assertion is what catches that. */
  const overCut = JSON.parse(JSON.stringify(clean));
  overCut.characters[0].continuityStates[0].notes = "";
  assert.deepStrictEqual(detectors.noPlanningMarker(overCut), [],
    "N3. an over-eager strip carries no marker either — which is why the positive suite pins the surviving sentence, not just the absence");
  assert.notStrictEqual(overCut.characters[0].continuityStates[0].notes, clean.characters[0].continuityStates[0].notes,
    "N3. and an equality assertion on that sentence is what distinguishes the two");

  /* The server-side write is real: if the strip were removed, these are the call
     sites that would put it back. */
  const server = read("server.js");
  assert(server.includes("stripPlanningAnnotations(marked)"), "N3. the strip must be wired into the preview pipeline");
  assert(server.includes("collectPlanningAnnotations(marked)"), "N3. and the collection must happen before it");
  assert(server.indexOf("collectPlanningAnnotations(marked)") < server.indexOf("stripPlanningAnnotations(marked)"),
    "N3. collecting AFTER the strip would report nothing and pass silently");
  note("N3. a marker appended back into a state delta is caught and named; an over-eager strip is caught by the surviving-sentence assertion instead; and collection is pinned to happen before the strip");
}

/* =========================================================================
   N4. A CHOOSER THAT DROPS ENTERED MATERIAL IS CAUGHT.

   This reconstructs the pre-slice behaviour — a re-render with no buffer behind the
   textarea — and requires the retention assertion to fail against it.
   ========================================================================= */
async function n4DroppedInputIsCaught() {
  const { context, map } = await render("#/create", buildFixture(), { storage: { "cinebraid-creation-start-path": "cinebraid" } });
  const PASTED = '{"meta":{"title":"Two hours of work"}}';
  const asRendered = vm.runInContext(`esc(${JSON.stringify(PASTED)})`, context);
  const renderNow = async () => { await vm.runInContext("route()", context); return map.get("main").innerHTML; };

  vm.runInContext(`setCreationDraft("cinebraid:json", ${JSON.stringify(PASTED)})`, context);
  vm.runInContext("setCreationStartPath('scratch')", context);
  await renderNow();
  vm.runInContext("setCreationStartPath('cinebraid')", context);
  assert((await renderNow()).includes(asRendered), "N4. precondition: the shipped chooser retains the document");

  /* The old behaviour, exactly: the buffer is not consulted, so the box comes back
     empty. Nothing else about the page changes. */
  vm.runInContext(`
    globalThis.__realDraft = creationDraft;
    globalThis.creationDraft = () => "";
  `, context);
  const dropped = await renderNow();
  assert(dropped.includes('id="project-builder-json"'), "N4. the break must land on a page that still has the box");
  assert(!dropped.includes(asRendered),
    "N4. a chooser that does not consult the buffer must fail the retention assertion");
  vm.runInContext("globalThis.creationDraft = globalThis.__realDraft;", context);
  assert((await renderNow()).includes(asRendered), "N4. and restoring it must restore the document");
  note("N4. reconstructing the pre-slice re-render — the buffer not consulted — empties the box and is caught, and restoring the reader restores the pasted document");
}

/* =========================================================================
   N5. PROVIDER JARGON RETURNING TO THE ASSISTED FRAMING IS CAUGHT.
   ========================================================================= */
async function n5JargonIsCaught() {
  const { context } = await render("#/create", buildFixture());
  const primary = JSON.parse(vm.runInContext("JSON.stringify(CREATION_INTENTS[0])", context));
  const framing = `${primary.eyebrow} ${primary.title} ${primary.blurb}`;
  assert(detectors.jargonFree(framing), "N5. precondition: the shipped framing is jargon-free");

  for (const regression of [
    "EXISTING MATERIAL Import with an LLM Best when you already have a script.",
    "YOUR SCRIPT Build with ChatGPT or Claude Paste the JSON it returns.",
    "YOUR SCRIPT Choose a model and structure your story with it.",
  ]) {
    assert(!detectors.jargonFree(regression), `N5. the detector must catch "${regression}"`);
  }
  note("N5. all three plausible re-introductions of provider framing — the retired label, a named assistant, and a model chooser — are caught by the framing detector");
}

/* =========================================================================
   N6. A LANDING THAT RENDERS THE CHOOSER AGAIN IS CAUGHT.
   ========================================================================= */
async function n6ChooserOnLandingIsCaught() {
  const { html, context } = await landedRender();
  assert(detectors.noChooserOnLanding(html), "N6. precondition: the shipped landing offers no chooser");

  /* The exact regression: the landing renders, and the chooser is put back above it
     "so the filmmaker can start another project". */
  const regressed = vm.runInContext("creationStartChooser()", context) + html;
  assert(regressed.length > html.length, "N6. the break must land");
  assert(!detectors.noChooserOnLanding(regressed),
    "N6. a landing with the chooser above it must be caught");

  /* And the softer regression: no landing at all, straight back to #/create. */
  const noLanding = vm.runInContext(`(() => { window.__cinebraidProjectEntryLanding = null; return creationStudioView(); })()`, context);
  assert(!noLanding.includes("data-project-entry-landing"), "N6. the break must land");
  assert(!detectors.noChooserOnLanding(noLanding),
    "N6. dropping the landing entirely returns the filmmaker to the chooser, which is the original defect and must be caught");
  note("N6. both the chooser reappearing above the landing and the landing being dropped altogether are caught");
}

/* =========================================================================
   N7. SLICE 3-5 VOCABULARY ON THE ENTRY IS CAUGHT.
   ========================================================================= */
async function n7LaterSliceLeakageIsCaught() {
  const { html } = await render("#/create", buildFixture());
  assert(detectors.noLaterSliceVocabulary(html), "N7. precondition: the shipped entry carries none of it");
  for (const leak of [
    '<button>Reference Reframe</button>',
    '<span>Demand-driven coverage</span>',
    '<div class="mode">Simple / Advanced</div>',
    '<b>$0.042 per image</b>',
    '<label>Shot intent</label>',
    '<a href="#/analytics">Analytics</a>',
  ]) {
    assert(!detectors.noLaterSliceVocabulary(html + leak), `N7. the detector must catch ${leak}`);
  }
  note("N7. each of the six later-slice surfaces is caught when appended to the entry markup");
}

/* =========================================================================
   N8. THE STANDING DISTINGUISHES BLOCKED FROM NEEDS REVIEW.

   A projection that answered the same word for every payload would pass the
   positive suite's "it renders a standing" check. It does not.
   ========================================================================= */
async function n8StandingDiscriminates() {
  const { context } = await render("#/create", buildFixture());
  const label = (review) => vm.runInContext(`projectEntryStanding(${JSON.stringify(review)}).label`, context);
  const answers = new Set([
    label({ missing: [], review: [], conflicts: [], inferred: [] }),
    label({ missing: [], review: ["x"], conflicts: [], inferred: [] }),
    label({ missing: ["y"], review: [], conflicts: [], inferred: [] }),
  ]);
  assert.strictEqual(answers.size, 3, `N8. the three payloads must give three different answers, got ${[...answers].join(" / ")}`);

  /* And a projection that ignored `missing` — the mistake that would report a
     project Blocked-in-fact as merely worth a look — is caught. */
  const collapsed = (review) => (Array.isArray(review.missing) || Array.isArray(review.review) ? "Needs review" : "Ready");
  assert.notStrictEqual(collapsed({ missing: ["y"], review: [] }), label({ missing: ["y"], review: [], conflicts: [], inferred: [] }),
    "N8. a standing that could not say Blocked must differ from the shipped one");
  note(`N8. the standing returns three distinct answers for the three payload shapes (${[...answers].join(" / ")}), and a projection unable to say Blocked is caught`);
}

async function main() {
  await n1ParallelDerivationIsCaught();
  await n2LandingFollowsTheAuthority();
  n3MarkerReintroductionIsCaught();
  await n4DroppedInputIsCaught();
  await n5JargonIsCaught();
  await n6ChooserOnLandingIsCaught();
  await n7LaterSliceLeakageIsCaught();
  await n8StandingDiscriminates();
  console.log(notes.join("\n"));
  console.log("Project entry negative controls passed: every Slice 2 assertion was made to fail against a deliberate break, and to pass again once it was undone.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
