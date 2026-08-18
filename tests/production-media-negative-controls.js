/* Negative controls for tests/production-media.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces one specific way the production-media projection, the Generated
 * Media destination or the Universal Media Inspector could lie -- IN MEMORY, by mutating
 * a copy of the shipped source and rebuilding the module from it, so nothing on disk is
 * touched and no control can be "restored" by a checkout that also discards real work.
 *
 * Each control carries a PROBE RECEIPT: the mutation asserts the text it is replacing was
 * really present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing. That is the specific mistake
 * Production-State Honesty exposed -- controls that had drifted onto a dead path and were
 * proving that a line nobody executed could be broken.
 *
 * EVERY CONTROL BREAKS A DIFFERENT MECHANISM, and names the check that has to fail. A
 * control that fires for the same reason as its neighbour is proving one thing twice and
 * nothing once.
 *
 * WHAT IS NOT HERE. Real clicks, the live modal, stale metadata surviving a switch, the
 * responsive bands and horizontal overflow are properties of a live document; their
 * controls live in tests/production-media-real-browser.py, which resolves media by
 * filename, paints an approved chip on a recommendation and drops rejected media inside a
 * running Chromium and requires all three to be caught.
 *
 * NO PROJECT DATA IS TOUCHED, NO PAID CALL AND NO PROVIDER CALL.
 */

const assert = require("assert");

const suite = require("./production-media.js");
const { SOURCES, build } = suite;

const notes = [];
let CONTROL_COUNT = 0;
const EXERCISED = new Set();

/* A mutation that must find what it is replacing. */
function mutate(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

/* Runs one named check against a build made from mutated source and requires it to fail.
   A control that passes is a control that has stopped controlling anything. */
function control(label, checkName, patch, expectation) {
  CONTROL_COUNT += 1;
  EXERCISED.add(checkName);
  assert.strictEqual(typeof suite[checkName], "function",
    `${label} names ${checkName}, which tests/production-media.js does not export`);
  const sources = { ...SOURCES, ...patch };
  let deps;
  let failed = false;
  try {
    deps = build(sources);
  } catch (error) {
    /* A mutation that makes the module unloadable proves nothing about the check. */
    throw new Error(`${label}: the mutated source did not load, so the control proves nothing: ${error.message}`);
  }
  try {
    suite[checkName](deps);
  } catch (error) {
    if (error instanceof assert.AssertionError) failed = true;
    else throw error;
  }
  assert.ok(failed, `${label}: ${checkName} accepted the broken build. ${expectation}`);
  notes.push(`  ${label} -- ${checkName} failed as required`);
}

/* ===========================================================================
   IDENTITY -- the two domains, and the rule that resolves them.
   =========================================================================== */
notes.push("Identity:");

control("C1 the two identity domains are flattened into one field", "checkIdentity",
  { projection: mutate(SOURCES.projection,
      "      identity: deepFreeze({\n        ledger: identity.ledger,\n        library: identity.library,",
      "      assetId: identity.ledger.value || identity.library.value,\n      identity: deepFreeze({\n        ledger: identity.ledger,\n        library: identity.library,",
      "C1") },
  "A generic assetId is exactly the collision shared-media-disposition.js's header exists to prevent: a library row's id and a ledger id are different things, and one field makes them interchangeable.");

control("C2 a project-library id is accepted as a ledger identity", "checkIdentity",
  { projection: mutate(SOURCES.projection,
      "  function isLedgerIdentity(value) {\n    return typeof P4?.isLedgerAssetId === \"function\" ? P4.isLedgerAssetId(value) : false;\n  }",
      "  function isLedgerIdentity(value) {\n    return typeof value === \"string\" && value.length > 0;\n  }",
      "C2") },
  "Accepting any non-empty string as durable identity is the cross-domain shortcut: a blocking row's `blocking-media-1` would mint an `asset:` key that resolves to nothing the ledger knows.");

control("C3 the key falls back to a bare filename", "checkIdentity",
  { projection: mutate(SOURCES.projection,
      "    const path = text(it.path);\n    return path ? `path:${path}` : \"\";",
      "    const path = text(it.path);\n    const bare = path.slice(path.lastIndexOf(\"/\") + 1);\n    return bare ? `path:${bare}` : \"\";",
      "C3") },
  "Two shots can hold same-named takes. Keying on a basename is the false-linkage class C1 removed from the indexer, and it would merge SH010's frame with SH020's.");

/* ===========================================================================
   DISPOSITION AND AUTHORITY -- where a second opinion could grow.
   =========================================================================== */
notes.push("Disposition and authority:");

control("C4 disposition is re-derived from the candidate row instead of from P4", "checkDisposition",
  { projection: mutate(SOURCES.projection,
      "      disposition: deepFreeze({\n        role: text(disposition.role) || \"candidate\",",
      "      disposition: deepFreeze({\n        role: ENTITY_APPROVED_DECISIONS.includes(text(row.decision)) ? \"approved\" : text(row.decision) === \"rejected\" ? \"rejected\" : \"candidate\",",
      "C4") },
  "The prop is approved by an EDGE and has no candidate row at all. A reader that decides disposition from the row calls production canon a candidate -- the same shape of disagreement P4-SEM-C2 was written to end.");

control("C5 an approval target is labelled from free text instead of the stored edge", "checkAuthority",
  { projection: mutate(SOURCES.projection,
      "    const targets = list(disposition.targets).map((edge) => deepFreeze({\n      kind: text(edge.kind),",
      "    const targets = list(disposition.targets).map((edge) => deepFreeze({\n      kind: \"reference\",",
      "C5") },
  "Authority is a relationship between an image and a DECLARED target. Inventing a label disconnected from the stored edge is how 'what is this authority for' stops being answerable.");

/* ===========================================================================
   SEMANTIC SAFETY -- the section the whole batch rests on.
   =========================================================================== */
notes.push("Semantic safety:");

control("C6 a passing AI review is treated as an approval", "checkSemanticSafety",
  /* 1D-04 re-expressed the anchor. `approved` used to be a four-way disjunction
     and this control added AI pass as a fifth term. It is a single source now —
     the authority receipt — so the mutation adds the AI term to THAT, which is
     the same defect against the code that exists. */
  { projection: mutate(SOURCES.projection,
      "    const approved = receiptBacked === true;",
      "    const approved = receiptBacked === true\n      || Object.values(record(it.structuredReviews)).some((review) => record(review).pass === true)\n      || record(it.aiReview).pass === true;",
      "C6") },
  "AI PASS must cause nothing by itself. This is the hidden auto-approval the brief forbids, and it would silently promote every well-reviewed candidate to canon.");

control("C7 the recommendation vocabulary gains a decision word", "checkSemanticSafety",
  { projection: mutate(SOURCES.projection,
      'const PRODUCTION_MEDIA_RECOMMENDATIONS = deepFreeze(["approve", "alternate", "correct", "reject"]);',
      'const PRODUCTION_MEDIA_RECOMMENDATIONS = deepFreeze(["approve", "approved", "alternate", "correct", "reject"]);',
      "C7") },
  "A suggestion and an act must not share a token. The moment they do, a renderer keyed on the value prints one for the other and an AI recommendation reads as an approval.");

control("C8 an AI recommendation is painted as an APPROVED chip", "checkRendering",
  { results: mutate(SOURCES.results,
      '    const statusWord = { approved: "APPROVED", historic: "HISTORIC", candidate: "CANDIDATE", rejected: "REJECTED" }[row.disposition.role] || "";',
      '    const statusWord = row.aiRecommendation.value === "approve" ? "APPROVED" : { approved: "APPROVED", historic: "HISTORIC", candidate: "CANDIDATE", rejected: "REJECTED" }[row.disposition.role] || "";',
      "C8") },
  "The card's status chip must print the DISPOSITION. Letting a recommendation reach it is the single most dangerous confusion in the batch: a grid of AI-liked candidates would read as a grid of approved canon.");

control("C9 the Inspector words a recommendation as a human approval", "checkRendering",
  { inspector: mutate(SOURCES.inspector,
      '    approve: "Suggests approving",',
      '    approve: "Approved by you",',
      "C9") },
  "The Inspector's recommendation block must never use the human-decision wording. Two blocks saying 'Approved by you' is one block claiming a person did something nobody did.");

control("C10 rejected media is dropped from the destination", "checkRendering",
  { results: mutate(SOURCES.results,
      '    if (tab === "rejected") return records.filter((row) => row.disposition.role === "rejected");',
      '    if (tab === "rejected") return [];',
      "C10") },
  "Rejected media is evidence of a decision. This control leaves Current looking entirely correct and silently empties the Rejected tab, which is exactly how history disappears without anybody noticing.");

/* ===========================================================================
   PROVENANCE AND MONEY -- answering a question that was not asked.
   =========================================================================== */
notes.push("Provenance and money:");

control("C11 an unloadable generation record reports as 'not recorded'", "checkProvenance",
  { projection: mutate(SOURCES.projection,
      '    if (jobState === "unavailable")\n      return deepFreeze({ state: "unavailable", amount: null, currency: "", confidence: "", basis: "", reason: "generation-record-unavailable" });',
      '    if (jobState === "unavailable")\n      return deepFreeze({ state: "not-recorded", amount: null, currency: "", confidence: "", basis: "", reason: "generation-record-unavailable" });',
      "C11") },
  "A cost the browser could not load and a cost nobody recorded are different facts. Collapsing them tells a filmmaker their project has no generation history whenever the ledger is simply not in the room.");

control("C12 a missing job is indistinguishable from a ledger that never loaded", "checkProvenance",
  { projection: mutate(SOURCES.projection,
      '      reason: jobsAvailable ? "job-not-in-ledger" : "generation-ledger-not-loaded",',
      '      reason: "generation-ledger-not-loaded",',
      "C12") },
  "With the ledger loaded, a named job that is absent means the row is gone; with it unloaded, it means nothing was fetched. One reason for both hides a real data loss behind a configuration state.");

control("C13 an unknown cost renders as zero", "checkProvenance",
  { projection: mutate(SOURCES.projection,
      '    if (!estimate || !Object.keys(record(estimate)).length)\n      return deepFreeze({ state: "not-recorded", amount: null, currency: "", confidence: "", basis: "", reason: "job-records-no-accounting" });',
      '    if (!estimate || !Object.keys(record(estimate)).length)\n      return deepFreeze({ state: "priced", amount: 0, currency: "usd", confidence: "estimated", basis: "estimated-at-submission", reason: "" });',
      "C13") },
  "$0.00 for unknown is the exact fiction generation-cost.js was written to prevent. A legacy job that predates cost recording would read as a job that cost nothing.");

control("C14 a shot candidate's prompt is reconstructed from its build", "checkProvenance",
  { projection: mutate(SOURCES.projection,
      '    return deepFreeze({ state: "not-recorded", value: "", source: "" });',
      '    const build = text(record(row).sourceBuildId);\n    if (build) return deepFreeze({ state: "known", value: `Prompt for ${build}`, source: "resolved-build" });\n    return deepFreeze({ state: "not-recorded", value: "", source: "" });',
      "C14") },
  "The build's CURRENT text is not the historical request. Presenting it as the prompt that ran is fake precision about the one field a filmmaker would use to reproduce a result.");

control("C15 provider and model are inferred when unrecorded", "checkProvenance",
  { projection: mutate(SOURCES.projection,
      "    const model = text(it.generationModel) || text(generation.model) || text(job.model);",
      "    const model = text(it.generationModel) || text(generation.model) || text(job.model) || \"openai/gpt-image-2\";",
      "C15") },
  "An imported planning file has no model. Defaulting to the one the project happens to use is inventing provenance for media CineBraid did not generate -- and it is indistinguishable, on screen, from a real record.");

/* ===========================================================================
   POPULATION, PURITY AND ACTIONS.
   =========================================================================== */
notes.push("Population, purity and actions:");

control("C16 locked delivery copies are enumerated as separate results", "checkPopulation",
  { projection: mutate(SOURCES.projection,
      "      for (const item of list(shotScan.blocking)) {",
      "      for (const item of [...list(shotScan.blocking), ...list(shotScan.locked)]) {",
      "C16") },
  "A locked file is a delivery copy of media already in Results under its own identity. Listing it makes one production result look like two, and its ledger identity would collide with the original's.");

control("C17 the projection creates a candidate row for media that has none", "checkPurity",
  { projection: mutate(SOURCES.projection,
      "            const row = P4.candidateRowFor(it, entry.name) || {};",
      "            let row = P4.candidateRowFor(it, entry.name);\n            if (!row) { row = { stored: entry.name, decision: \"unreviewed\" }; it.candidateFiles = list(it.candidateFiles); it.candidateFiles.push(row); }",
      "C17") },
  "This is the exact mistake shared-media-disposition.js's header warns about: entityCandidateRow() CAN create, and a resolver that runs inside a render must not. The prop is approved with no candidate row at all, so opening Generated Media would silently write one into project.json.");

control("C18 records are returned mutable", "checkPurity",
  { projection: mutate(SOURCES.projection,
      "  function deepFreeze(value) {\n    if (value && typeof value === \"object\" && !Object.isFrozen(value)) {\n      Object.freeze(value);\n      for (const key of Object.keys(value)) deepFreeze(value[key]);\n    }\n    return value;\n  }",
      "  function deepFreeze(value) {\n    return value;\n  }",
      "C18") },
  "A caller that can edit a projected record can persist one, and a rendering that gets persisted has become production state -- the exact line this module must not cross.");

control("C19 a paid action survives into the offered list", "checkActions",
  { projection: mutate(SOURCES.projection,
      "      if (action.paid || action.destructive) continue;",
      "      if (action.destructive) continue;",
      "C19") },
  "The paid drop must be structural. Removing it means a future edit adding a one-click regenerate produces a working button instead of no button at all.");

control("C20 decisions are offered on media with no candidate row", "checkActions",
  { projection: mutate(SOURCES.projection,
      '  const DECIDABLE_KINDS = deepFreeze(["entity-reference", "shot-still", "shot-motion"]);',
      '  const DECIDABLE_KINDS = deepFreeze(["entity-reference", "shot-still", "shot-motion", "shot-blocking", "project-media"]);',
      "C20") },
  "A blocking guide has no approval edge anywhere in the model. An Approve button there is a control with nowhere to write, implying a disposition the product cannot change.");

/* ===========================================================================
   THE DESTINATION AND ITS RELATIONSHIP TO O4.
   =========================================================================== */
notes.push("The destination:");

control("C21 the Generated Media route loses the creator shell", "checkDestination",
  { shell: mutate(SOURCES.shell,
      '    "results",\n    "characters",',
      '    "characters",',
      "C21") },
  "Generated Media is a creator workspace. Dropping it from the declaration takes the Assistant and the Terminal with it, silently, on a route where a filmmaker is making production decisions.");

control("C22 the stage strip learns about the project-level route", "checkDestination",
  { stageSurfaces: mutate(SOURCES.stageSurfaces,
      '      shotId: view === "shot" && renderedRouteIsCurrent() ? currentTargetId() : "",',
      '      shotId: (view === "shot" || view === "results") && renderedRouteIsCurrent() ? currentTargetId() : "",',
      "C22") },
  "The O4 strip describes ONE shot's workflow. Mounting it on a project-level destination would make Generated Media look like a sixth stage, which is precisely what the brief forbids.");

/* ===========================================================================
   REVIEW ASSESSMENT (P1-3) -- the three ways the form's defaults get back in.
   =========================================================================== */
notes.push("Review assessment:");

control("C25 the untouched form structure is admitted as a review", "checkReviewAssessment",
  { projection: mutate(SOURCES.projection,
      "    if (!performed) return [];",
      "    if (!performed && !keys.length && !text(raw.summary)) return [];",
      "C25") },
  "This is the defect itself: candidateRecord() normalises every candidate it touches, so admitting a review whenever categories EXIST puts '1 review on record' and five PASS marks on an image nobody opened -- and on one a person rejected.");

control("C26 a default pass is reported as an assessed outcome", "checkReviewAssessment",
  { projection: mutate(SOURCES.projection,
      "          outcome: shotReviewCategoryAssessed(item) ? known(item.severity) : known(\"\"),",
      "          outcome: known(item.severity),",
      "C26") },
  "A category left at the form's default carries no observation. Reporting its severity hands a surface the word 'pass' to print, which is precisely the unearned PASS mark -- the projection must give it nothing to print instead.");

control("C27 the Inspector omits an unrecorded outcome instead of stating it", "checkReviewAssessment",
  { inspector: mutate(SOURCES.inspector,
      '${entry.outcome.state === "known" ? `<em>${esc(entry.outcome.value)}</em>` : `<em class="mi-unknown">No recorded observation</em>`}',
      '${entry.outcome.state === "known" ? `<em>${esc(entry.outcome.value)}</em>` : ""}',
      "C27") },
  "Silence is not a third answer. A category row showing its name and nothing else, beside rows that carry findings, reads as 'checked, fine' -- the distinction the projection preserved has to survive the renderer.");

/* ===========================================================================
   STYLE.
   =========================================================================== */
notes.push("Style:");

control("C23 an O5 surface is painted from a frozen literal", "checkStyle",
  { styles: mutate(SOURCES.styles,
      ".results-notice{margin:10px 0 0;padding:10px 12px;border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:var(--r-sm);background:var(--surface);",
      ".results-notice{margin:10px 0 0;padding:10px 12px;border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:var(--r-sm);background:rgba(20,24,27,.96);",
      "C23") },
  "A hardcoded dark surface is the defect .focused-inspector already had: it stays near-black under the light theme while its ink goes dark. Tokens are what make the light theme correct by construction.");

control("C24 the .focused-inspector dark literal returns", "checkStyle",
  { styles: mutate(SOURCES.styles,
      ".focused-inspector{position:sticky;top:72px;display:grid;gap:14px;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--surface);",
      ".focused-inspector{position:sticky;top:72px;display:grid;gap:14px;padding:16px;border:1px solid var(--line);border-radius:16px;background:rgba(20,24,27,.96);",
      "C24") },
  "This is the known light-theme defect O5 was authorized to correct. A control that does not watch it come back is a correction nobody is protecting.");

/* ===========================================================================
   COVERAGE OF THE SUITE ITSELF.
   Every exported check must be controlled by something, or it is a check nobody has
   watched fail. Two are excluded with a reason rather than silently: their properties are
   structural rather than mutable in a way a source patch can express.
   =========================================================================== */
const UNCONTROLLED = {
  checkReviews: "Every failure mode of the review envelope -- a borrowed reviewer, a merged schema, a lost timestamp -- is asserted positively against two genuinely different persisted shapes. A mutation that broke one would break checkRendering too, and a control that fires for its neighbour's reason proves nothing of its own.",
  checkDeduplication: "The dedup rule IS the key rule, and C1/C2/C3 already break the key three different ways. A fourth control here would fire for C3's reason.",
  checkScale: "A timing bound cannot be controlled by a source patch without making the control itself a benchmark, which is the thing the check deliberately is not.",
};
for (const name of Object.keys(suite)) {
  if (!name.startsWith("check")) continue;
  if (EXERCISED.has(name)) continue;
  assert(UNCONTROLLED[name],
    `${name} is exported by tests/production-media.js and no negative control exercises it. Add a control or declare why it cannot have one.`);
}

console.log(`O5 production media negative controls OK -- ${CONTROL_COUNT} controls, all caught`);
for (const line of notes) console.log(line);
console.log("  uncontrolled by declaration:");
for (const [name, why] of Object.entries(UNCONTROLLED)) console.log(`    ${name} -- ${why.slice(0, 96)}...`);
