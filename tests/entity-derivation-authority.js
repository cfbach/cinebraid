/* ENTITY-STATE DERIVATION AUTHORITY — only Canon parent media may enable it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SUITE EXISTS, AND WHAT WAS WRONG WITH THE ONE IT REPLACES.
 *
 * The previous pass shipped a "historic parent cannot reach paid dispatch"
 * regression that was FALSELY GREEN. It did not call the shipped dispatch path
 * at all — it wrote its own `if (standing !== "canon") throw` inside the test
 * and then asserted that its own throw happened. It would have passed against
 * a product with no guard whatsoever, and it did: `startFalEntityGeneration`
 * was computing derive mode from `!!parentInfo.media` the whole time.
 *
 * EVERY TEST BELOW CALLS THE REAL SHIPPED FUNCTION. The paid paths are captured
 * at the LAST POSSIBLE POINT — a fetch double standing in for the transport —
 * so what is asserted is the request body CineBraid actually tried to send.
 * Nothing here re-implements a guard.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE. The fetch double answers
 * /api/generation/fal/jobs locally; no request leaves the process.
 */
const assert = require("assert");
const vm = require("vm");
const { render, rawFixture, withCanon } = require("./render-harness");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

const TINY = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3C/svg%3E";
const PARENT_FILE = "PR-TOOL-PLATE.png";
const SCAN = {
  anchors: [], plates: [], vehicles: [], audio: [], media: [], shots: {},
  props: [{ name: PARENT_FILE, url: TINY, assetId: "asset-P" }],
};

/* A prop whose default state holds an image, and a child that derives from it.
   `canon: true` gives the default state a receipt; `false` leaves it HISTORIC,
   which is the shape of every pre-receipt project. */
function derivationProject({ canon }) {
  const project = rawFixture();
  const prop = project.props.find((row) => row.id === "PR-TOOL") || project.props[0];
  prop.id = "PR-TOOL";
  prop.name = "Panel tool";
  prop.prefix = "PR-TOOL";
  prop.creationDescription = "Compact steel maintenance tool with a black rubber grip.";
  prop.approvedFile = PARENT_FILE;
  prop.approvedAssetId = canon ? "asset-P" : "";
  prop.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: PARENT_FILE, approvedAssetId: canon ? "asset-P" : "", notes: "Clean tool." },
    {
      id: "state-worn", name: "Worn", isDefault: false, parentStateId: "state-default",
      approvedFile: "", notes: "Scratched casing and chipped grip.", generationMode: "derive",
      assetPromptBuilds: [{
        id: "build-worn", date: "2026-08-15T00:00:00.000Z", stateId: "state-worn", stateName: "Worn",
        profileId: "gpt-image-2/edit", profileName: "GPT Image 2 · Reference Edit",
        prompt: "COMPILED WORN STATE INSTRUCTION", warnings: [], confirmations: [],
      }],
    },
  ];
  prop.candidateFiles = [{ stored: PARENT_FILE, decision: "unreviewed" }];
  project.props = [prop];
  return canon
    ? withCanon(project, { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: PARENT_FILE, assetId: "asset-P" })
    : project;
}

/* Render the prop page with FAL enabled and the provider transport doubled.
   `sent` collects every generation request the product actually issued. */
async function page({ canon, task = "states" }) {
  const sent = [];
  const rendered = await render("#/prop/PR-TOOL", derivationProject({ canon }), {
    scan: SCAN,
    /* Open the continuity-state workspace and the derived state's generation
       card — the surfaces whose readiness copy is under test. */
    storage: {
      "cinebraid-focused:fixture:entity-task:props:PR-TOOL": task,
      "cinebraid-bounded:fixture:selected:continuity-state:props:PR-TOOL": "state-worn",
      "cinebraid-section:fixture:entity:props:PR-TOOL:continuity-states": "1",
      "cinebraid-section:fixture:entity:props:PR-TOOL:state-generation:state-worn": "1",
    },
    fetch: async (url, options, respond) => {
      if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, defaults: {} });
      if (url === "/api/generation/fal/jobs" && options.method === "POST") {
        /* THE LAST POINT BEFORE TRANSPORT. Whatever is here is what CineBraid
           tried to send to a paid provider. */
        sent.push(JSON.parse(options.body || "{}"));
        return respond({ ok: true, job: { id: `job-${sent.length}`, status: "IN_QUEUE", purpose: "entity-reference" } });
      }
      if (url === "/api/llm/review-entity-candidate") {
        sent.push({ __validation: true, body: JSON.parse(options.body || "{}") });
        return respond({ ok: true, review: { pass: true, score: 90, categories: {} } });
      }
      return null;
    },
  });
  rendered.sent = sent;
  rendered.said = [];
  rendered.context.toast = (message) => rendered.said.push(String(message));
  vm.runInContext(
    `CONFIG.generation = CONFIG.generation || {}; CONFIG.generation.fal = { enabled: true, apiKey: "t" }; pollFalGeneration = () => {};`,
    rendered.context,
  );
  return rendered;
}
const evaluate = (rendered, expression) => vm.runInContext(expression, rendered.context);
const json = (rendered, expression) => JSON.parse(evaluate(rendered, `JSON.stringify(${expression})`));

async function main() {
  /* =========================================================================
     1 — PROMPT MODE. The shipped resolvers, called directly. */
  {
    const historic = await page({ canon: false });
    const state = 'P.props[0].continuityStates.find((r) => r.id === "state-worn")';
    const derivation = json(historic, `assetStateDerivation("props", P.props[0], ${state})`);
    eq(derivation.standing, "historic", "the parent image was never approved");
    ok(derivation.media, "the image is still resolvable — it may travel as context");
    eq(derivation.canDerive, false, "but derivation is not available");
    eq(derivation.mode, "independent", "the effective mode is independent");
    eq(derivation.file, "", "and no approved parent file is produced");
    eq(derivation.contextFile, PARENT_FILE, "while the image itself is still named, for context");
    eq(derivation.reason, "parent-not-canon", "and the reason is stated");
    eq(evaluate(historic, `assetStatePromptMode("props", P.props[0], ${state})`), "t2i",
      "so the compiler is not put into edit mode");

    const canon = await page({ canon: true });
    const approved = json(canon, `assetStateDerivation("props", P.props[0], ${state})`);
    eq(approved.canDerive, true, "an approved parent DOES enable derivation");
    eq(approved.file, PARENT_FILE, "and produces the approved parent file");
    eq(evaluate(canon, `assetStatePromptMode("props", P.props[0], ${state})`), "edit",
      "and the compiler edits from it");
  }

  /* =========================================================================
     2 — generateMoreEntityStateCandidates. THE REAL FUNCTION, and the request
     body captured immediately before transport. */
  {
    const historic = await page({ canon: false });
    await historic.context.generateMoreEntityStateCandidates("props", "PR-TOOL", "state-worn", "build-worn", false);
    const jobs = historic.sent.filter((row) => !row.__validation);
    eq(jobs.length, 1, "the request is issued — a historic parent does not block generation, it blocks DERIVATION");
    eq(jobs[0].derivationMode, "independent", "and it is dispatched independently");
    eq(jobs[0].parentApprovedFile, "", "with no approved parent file");
    ok(!(jobs[0].references || []).some((ref) => ref.role === "base"),
      `no reference is a base — got ${JSON.stringify((jobs[0].references || []).map((r) => r.role))}`);
    ok(!(jobs[0].references || []).some((ref) => /approved reference/i.test(ref.label || "")),
      "and none is labelled an approved reference");

    const canon = await page({ canon: true });
    await canon.context.generateMoreEntityStateCandidates("props", "PR-TOOL", "state-worn", "build-worn", false);
    const canonJobs = canon.sent.filter((row) => !row.__validation);
    eq(canonJobs.length, 1, "an approved parent also dispatches");
    eq(canonJobs[0].derivationMode, "derive", "but as a derivation");
    eq(canonJobs[0].parentApprovedFile, PARENT_FILE, "naming the approved parent file");
    ok((canonJobs[0].references || []).some((ref) => ref.role === "base"), "with a real editable base");
  }

  /* =========================================================================
     3 — startFalEntityGeneration. THE PAID DISPATCH BOUNDARY.

     Codex's exact capture: open the modal, press generate, read the body that
     went to the provider. The request the modal stashed is deliberately left
     claiming `requestedMode: "derive"`, because the boundary must decide for
     itself rather than trusting what an earlier screen recorded. */
  {
    const historic = await page({ canon: false });
    historic.context.openFalEntityGenerationModal("props", "PR-TOOL", "build-worn", "state-worn");
    const stashed = json(historic, "window._falEntityGenerationRequest || {}");
    eq(stashed.effectiveMode, "independent", "the modal itself opens in independent mode");
    /* Forge the stale claim the boundary must not trust. */
    evaluate(historic, `window._falEntityGenerationRequest.requestedMode = "derive"; window._falEntityGenerationRequest.effectiveMode = "derive";`);
    await historic.context.startFalEntityGeneration();
    const dispatched = historic.sent.filter((row) => !row.__validation);
    eq(dispatched.length, 1, "the paid request was issued");
    eq(dispatched[0].derivationMode, "independent",
      "and the DISPATCH BOUNDARY re-decided: a historic parent cannot derive, whatever the modal recorded");
    eq(dispatched[0].parentApprovedFile, "", "no approved parent file reached the provider");
    ok(!(dispatched[0].references || []).some((ref) => ref.role === "base"),
      "and no base reference reached the provider");
    ok(!/Approved .*reference/i.test(JSON.stringify(dispatched[0].references || [])),
      "nor any approved-reference label");

    const canon = await page({ canon: true });
    canon.context.openFalEntityGenerationModal("props", "PR-TOOL", "build-worn", "state-worn");
    await canon.context.startFalEntityGeneration();
    const canonDispatch = canon.sent.filter((row) => !row.__validation);
    eq(canonDispatch.length, 1, "an approved parent dispatches too");
    eq(canonDispatch[0].derivationMode, "derive", "as a derivation");
    eq(canonDispatch[0].parentApprovedFile, PARENT_FILE, "naming the approved parent");
  }

  /* =========================================================================
     4 — GENERATION REFERENCES. The shipped builder, both standings. */
  {
    const historic = await page({ canon: false });
    const refs = json(historic, [
      '(() => { const e = P.props[0]; const st = e.continuityStates.find((r) => r.id === "state-worn");',
      '  return entityGenerationReferences("props", e, { state: st, mode: "derive" }).map((r) => ({ role: r.role, label: r.label })); })()',
    ].join("\n"));
    ok(!refs.some((row) => row.role === "base"), `a historic parent is never a base — got ${JSON.stringify(refs)}`);
    ok(refs.some((row) => row.role === "historic-reference"), "it travels under a role that says what it is");
    ok(!refs.some((row) => /approved/i.test(row.label || "")), "and nothing about it is labelled approved");
  }

  /* =========================================================================
     5 — READINESS COPY. PARENT EDIT / READY TO DERIVE / "Derived from approved". */
  {
    const historic = await page({ canon: false });
    const html = evaluate(historic, `document.getElementById("main").innerHTML`);
    ok(!/DERIVE FROM /.test(html), "a historic parent produces no DERIVE FROM banner");
    ok(/PARENT NOT APPROVED/.test(html), "it says the parent has not been approved");
    ok(!/Derived from approved/.test(html), "and no tray claims the state derives from an approved parent");

    const canon = await page({ canon: true });
    const canonHtml = evaluate(canon, `document.getElementById("main").innerHTML`);
    ok(/DERIVE FROM /.test(canonHtml), "an approved parent DOES produce the derive banner");
    ok(!/PARENT NOT APPROVED/.test(canonHtml), "and no not-approved warning");
  }

  /* =========================================================================
     6 — VALIDATION. The shipped path, and what it submits. */
  {
    const historic = await page({ canon: false });
    /* Give the target an image so the only thing missing is approval. */
    evaluate(historic, `P.props[0].continuityStates.find((r) => r.id === "state-worn").approvedFile = "PR-TOOL-WORN.png";`);
    await historic.context.validateContinuityStateAgainstParent("props", "PR-TOOL", "state-worn");
    eq(historic.sent.filter((row) => row.__validation).length, 0,
      "an unapproved pair is never submitted to validation as approved");
    ok(historic.said.some((line) => /approve/i.test(line)),
      `and the creator is told what is missing — got ${JSON.stringify(historic.said)}`);
  }

  /* =========================================================================
     7 — CORRECTION. It must not switch a state into derive from a historic parent. */
  {
    const historic = await page({ canon: false });
    const before = evaluate(historic, `P.props[0].continuityStates.find((r) => r.id === "state-worn").generationMode`);
    const snapshot = evaluate(historic, "JSON.stringify(P)");
    await historic.context.correctContinuityStateFromParent("props", "PR-TOOL", "state-worn");
    eq(evaluate(historic, `P.props[0].continuityStates.find((r) => r.id === "state-worn").generationMode`), before,
      "correction does not rewrite the generation mode from a historic parent");
    eq(evaluate(historic, "JSON.stringify(P)"), snapshot, "and writes nothing at all");
    eq(historic.sent.filter((row) => !row.__validation).length, 0, "and dispatches nothing");
    ok(historic.said.some((line) => /approved as canon|Approve the parent/i.test(line)),
      `and says why — got ${JSON.stringify(historic.said)}`);
  }

  /* =========================================================================
     8 — THE CONTRADICTORY ROW. Codex reproduced a row that said
     "Historic, not approved" and "APPROVED" at the same time, with an
     accessibility label calling the same image approved authority. */
  {
    const historic = await page({ canon: false, task: "approved" });
    const html = evaluate(historic, `document.getElementById("main").innerHTML`);
    ok(/Historic, not approved/.test(html), "the row still reports the pointer as historic");
    ok(!/<em>APPROVED<\/em>/.test(html), "and does not simultaneously badge it APPROVED");
    ok(/<em>HISTORIC<\/em>/.test(html), "it badges it HISTORIC");
    ok(!/Preview approved [^"]*authority/.test(html),
      "and no accessibility label describes historic media as approved authority");
    ok(/Preview the historic .* which has not been approved/.test(html),
      "the label says what the image actually is");

    const canon = await page({ canon: true, task: "approved" });
    const canonHtml = evaluate(canon, `document.getElementById("main").innerHTML`);
    ok(/<em>CANON<\/em>/.test(canonHtml), "an approved state badges CANON");
    ok(/Preview the approved .* canon image/.test(canonHtml), "with a label that matches");
    ok(!/Historic, not approved/.test(canonHtml), "and no historic note");
  }

  /* =========================================================================
     9 — THE SERVER COMPILER, through the same product decision. A historic
     parent cannot become design/identity authority in the compiled context.
     (The route-level refusal is covered end-to-end in
     tests/reference-aspect-consistency.js against a live server; this pins the
     browser-side request that reaches it.) */
  {
    const historic = await page({ canon: false });
    const compiled = json(historic, [
      '(() => { const e = P.props[0]; const st = e.continuityStates.find((r) => r.id === "state-worn");',
      '  const d = assetStateDerivation("props", e, st);',
      '  return { mode: d.mode, parentApprovedFile: d.file, promptMode: assetStatePromptMode("props", e, st) }; })()',
    ].join("\n"));
    eq(compiled.parentApprovedFile, "", "the browser never asks the compiler to edit from an unapproved parent");
    eq(compiled.promptMode, "t2i", "and never requests an edit profile for one");
  }

  console.log(`Entity derivation authority suite passed ${checks} checks: prompt mode, more-candidates, paid dispatch, generation references, readiness copy, validation, correction, row semantics and compiler request — every one through the shipped path. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
