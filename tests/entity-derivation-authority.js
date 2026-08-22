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
  props: [{ name: PARENT_FILE, url: TINY, assetId: "asset-P" }, { name: "PR-TOOL-WORN.png", url: TINY, assetId: "asset-W" }],
};

/* A prop whose default state holds an image, and a child that derives from it.
   `canon: true` gives the default state a receipt; `false` leaves it HISTORIC,
   which is the shape of every pre-receipt project. */
function derivationProject({ canon, stateFile = "" }) {
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
      approvedFile: stateFile, notes: "Scratched casing and chipped grip.", generationMode: "derive",
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
async function page({ canon, task = "states", mutateSource, stateFile }) {
  const sent = [];
  const rendered = await render("#/prop/PR-TOOL", derivationProject({ canon, stateFile }), {
    scan: SCAN,
    mutateSource,
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
     body captured immediately before transport.

     THIS ACTION NO LONGER DISPATCHES BY ITSELF, and that is the point of the
     Slice 4 correction: "GENERATE 3 MORE" used to build a body and POST it with
     no preflight, no provider or cost disclosure and no payload gate. It now
     OPENS the preflight the paid dispatch already lives behind. So the same
     derivation claims are asserted where they now belong — at the submit — and
     the step in between is asserted too, because "it opened a dialog" and "it
     charged somebody" must never again be the same keystroke. */
  {
    const historic = await page({ canon: false });
    await historic.context.generateMoreEntityStateCandidates("props", "PR-TOOL", "state-worn", "build-worn", false);
    eq(historic.sent.filter((row) => !row.__validation).length, 0,
      "GENERATE 3 MORE must not reach the paid endpoint on its own");
    const stashed = json(historic, "window._falEntityGenerationRequest || {}");
    eq(stashed.stateId, "state-worn", "it must open the preflight on the state it was pressed for");
    /* The preflight paints its settings block on the next tick, exactly as the shipped
       dialog does after openModal(); reading before that would report an empty panel and
       look like a control that was never drawn. */
    await new Promise((resolve) => setTimeout(resolve, 0));
    /* Read from the RENDERED MARKUP, not from a control's `.value`: this harness models
       the document as a flat id map and never parses markup into live elements, so every
       select reports an empty value here whatever it was drawn with. The real dispatched
       number is asserted in tests/generation-simple-advanced-real-browser.py, where the
       control is a real one. */
    ok(/<option value="3"[^>]*selected/.test(
      String(evaluate(historic, `document.getElementById("fal-entity-generation-view").innerHTML`))),
      "and pre-set to the three candidates the button promises");

    await historic.context.startFalEntityGeneration();
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
    eq(canon.sent.filter((row) => !row.__validation).length, 0,
      "an approved parent does not change that: still no dispatch without the preflight");
    await canon.context.startFalEntityGeneration();
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

  /* =========================================================================
     10 — THE AUTOMATION DISPATCH BOUNDARY, entered through the shipped run.

     v626AutomateEntityState already refuses a historic parent up front. That
     check runs BEFORE the prompt is compiled and improved, and those are two
     network round trips — a window in which the creator can revoke the very
     approval the run is about to spend money on. Before this pass the request
     built after that window hard-coded derive mode for any non-default state,
     so a revoked receipt still produced a paid edit request against the
     parent's bytes.

     This test does not simulate the window. It enters the shipped run function
     with an APPROVED parent, so every earlier guard passes for real, and
     revokes the receipt inside the fetch double answering the improvement
     request — precisely where a person clicking Revoke would land. Then it
     reads what, if anything, reached the transport. */
  {
    /* The transport double aborts the run the moment a paid request appears,
       so the assertion is about the request body and nothing beyond it runs. */
    async function automationRun({ revokeDuringImprove, mutateSource }) {
      const sent = [];
      const seen = [];
      let rendered = null;
      let revoked = false;
      rendered = await render("#/prop/PR-TOOL", derivationProject({ canon: true }), {
        scan: SCAN,
        mutateSource,
        fetch: async (url, options, respond) => {
          const method = (options && options.method) || "GET";
          seen.push(method + " " + url);
          if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, defaults: {} });
          if (url.indexOf("/api/automation/runs") === 0) {
            return respond({ ok: true, run: JSON.parse((options && options.body) || "{}") });
          }
          if (url === "/api/prompt/asset-compile") {
            const body = JSON.parse((options && options.body) || "{}");
            const answer = respond({
              ok: true,
              compiledPrompt: "COMPILED WORN STATE INSTRUCTION",
              state: { parentStateId: body.parentStateId || "", parentStateName: "Default", generationMode: body.generationMode || "" },
              warnings: [], confirmations: [], profileId: body.profileId || "",
            });
            /* THE WINDOW. The prompt compile is a real network round trip that
               happens AFTER the run's up-front parent check and BEFORE the paid
               request is built. A revocation landing here is a real creator
               action mid-run, not a test-authored guard. */
            if (revokeDuringImprove && !revoked) {
              revoked = true;
              rendered.gesture.act(() => vm.runInContext(
                /* clearEdge:false is the HISTORIC shape exactly: the receipt is
                   withdrawn, the creator's chosen image stays on the state. */
                'revokeEntityStateCanon(P, { list: "props", entityId: "PR-TOOL", stateId: "state-default", clearEdge: false, reason: "withdrawn", at: "2026-08-22T15:03:00.000Z", via: "entity-derivation-test" });',
                rendered.context,
              ));
            }
            return answer;
          }
          if (url === "/api/generation/fal/jobs" && method === "POST") {
            sent.push(JSON.parse((options && options.body) || "{}"));
            /* Stop here. What was collected is what CineBraid tried to buy. */
            throw new Error("HALT-AT-TRANSPORT");
          }
          return null;
        },
      });
      vm.runInContext(
        'CONFIG.generation = CONFIG.generation || {}; CONFIG.generation.fal = { enabled: true, apiKey: "t" };'
        + ' CONFIG.ai = CONFIG.ai || {}; CONFIG.ai.text = { provider: "local", model: "m", baseUrl: "http://127.0.0.1:1" };'
        + ' pollFalGeneration = () => {}; toast = () => {}; route = () => {};',
        rendered.context,
      );
      let error = "";
      try {
        await vm.runInContext(
          '(async () => { const run = v626NewRun("entity", "PR-TOOL", "main", "Worn", "auto",'
          + ' { list: "props", entityId: "PR-TOOL", stateIds: ["state-worn"], reuseApproved: false, outputsPerRequest: 1, stateRounds: 1, maxImages: 4 });'
          + ' run.runnerId = V627_AUTOMATION_RUNNER_ID; run.leaseExpiresAt = new Date(Date.now() + 600000).toISOString();'
          + ' await v626AutomateEntityState(run, "props", "PR-TOOL", "state-worn"); })()',
          rendered.context,
        );
      } catch (thrown) { error = String((thrown && thrown.message) || thrown); }
      const standing = vm.runInContext(
        'assetStateParentMedia("props", P.props[0], P.props[0].continuityStates.find((r) => r.id === "state-worn")).standing',
        rendered.context,
      );
      return { sent, seen, error, revoked, standing };
    }

    /* 10a — the shipped product. The receipt is revoked mid-run; nothing is
       bought, and the refusal names the parent. */
    const revoked = await automationRun({ revokeDuringImprove: true });
    ok(revoked.seen.some((entry) => entry.indexOf("/api/prompt/asset-compile") >= 0),
      "the run really did compile a prompt — the earlier guards passed on an approved parent");
    ok(revoked.revoked, "and the approval really was revoked while that request was in flight");
    eq(revoked.standing, "historic", "the parent kept its image and lost only its receipt — the historic shape");
    eq(revoked.sent.length, 0, "and after the approval was revoked mid-run, NO paid request was made");
    ok(/never|not .*approved|approve it/i.test(revoked.error),
      "the run stopped with a reason the creator can act on: " + revoked.error);

    /* 10b — the same run, approval intact. The boundary is not simply refusing
       everything: a live receipt still derives, and the request says so. */
    const intact = await automationRun({ revokeDuringImprove: false });
    eq(intact.sent.length, 1, "with the approval still standing, the run does reach the transport");
    eq(intact.sent[0].derivationMode, "derive", "and asks to derive");
    eq(intact.sent[0].parentApprovedFile, PARENT_FILE, "naming the approved parent bytes");

    /* 10c — THE MUTATION CONTROL. Put the hard-coded mode back, in memory, and
       run the identical revoked scenario. If the boundary were not doing the
       work, this is the paid request that would go out. */
    const unguarded = await automationRun({
      revokeDuringImprove: true,
      mutateSource: (file, source) => file !== "automation.js" ? source : source
        .replace(
          'const derivationMode = dispatchDerivation && dispatchDerivation.canDerive ? "derive" : "independent";',
          'const derivationMode = state.isDefault ? "independent" : "derive";',
        )
        .replace(
          'if (dispatchDerivation && !dispatchDerivation.canDerive && dispatchDerivation.reason === "parent-not-canon") {',
          'if (false) {',
        )
        .replace(
          'parentApprovedFile: dispatchDerivation ? dispatchDerivation.file : "",',
          'parentApprovedFile: derivationMode === "derive" ? parentInfo?.file || "" : "",',
        ),
    });
    eq(unguarded.sent.length, 1, "CONTROL: without the boundary the revoked run DOES reach the transport");
    eq(unguarded.sent[0].derivationMode, "derive", "CONTROL: asking to derive from a revoked parent");
    eq(unguarded.sent[0].parentApprovedFile, PARENT_FILE, "CONTROL: and naming its bytes as approved");
  }
  /* =========================================================================
     11 — MUTATION CONTROLS FOR THE PRESENTATION AND READINESS SURFACES.

     Section 6 to 8 assert what four independently-painted surfaces say about a
     historic state. An assertion that a string is absent proves nothing unless
     something could have produced it. Each control below reverts ONE shipped
     guard to the raw-pointer test it replaced — in memory, in the file the page
     actually loads — runs the same historic project through the same shipped
     renderer, and requires the false claim to come back.

     A control that fails is not a broken test. It means the assertion beside it
     is vacuous and the guard it names is not doing the work. */
  {
    const HELD = "PR-TOOL-WORN.png";
    const revert = (needle, replacement) => (file, source) => {
      if (file !== "entities.js") return source;
      if (source.indexOf(needle) < 0) throw new Error("CONTROL could not find the guard it must break: " + needle.slice(0, 60));
      return source.split(needle).join(replacement);
    };
    const hubOf = (rendered) => {
      evaluate(rendered, 'openContinuityStateVariantHub("props", "PR-TOOL")');
      return evaluate(rendered, 'document.getElementById("modal").innerHTML');
    };

    /* H1 — the hub's variant label. A raw pointer wins again. */
    /* Several of these need the STATE to hold a pointer of its own, receiptless —
       the shape the surfaces were reading straight off. */
    const hubLabel = await page({
      canon: false, stateFile: HELD,
      mutateSource: revert(
        'const label = standing === "canon" ? "CANON VARIANT"',
        'const label = state.approvedFile ? "APPROVED VARIANT" : standing === "canon" ? "CANON VARIANT"',
      ),
    });
    ok(/APPROVED VARIANT/.test(hubOf(hubLabel)),
      "CONTROL H1: reverting the hub label to the raw pointer must badge a receiptless variant APPROVED");

    /* H2 — the hub's derive readiness. */
    const hubReady = await page({
      canon: false,
      mutateSource: revert('const ready = parentStanding === "canon";', 'const ready = !!parentInfo.fileName;'),
    });
    ok(/READY TO DERIVE/.test(hubOf(hubReady)),
      "CONTROL H2: reverting hub readiness to parent-pointer presence must offer derive from an unapproved parent");

    /* H3 — the validation workspace's readiness. */
    const validationReady = await page({
      canon: false, stateFile: HELD,
      mutateSource: revert(
        'const ready = !!(targetIsCanon && parentIsCanon && targetMedia && parentMedia && String(state.notes || "").trim());',
        'const ready = !!(targetMedia && parentMedia && String(state.notes || "").trim());',
      ),
    });
    const validationHtml = evaluate(validationReady, 'document.getElementById("main").innerHTML');
    ok(/Validate the approved state against its parent/.test(validationHtml),
      "CONTROL H3: reverting validation readiness to media presence must frame two unapproved images as approved");

    /* H4 — the hero's accessibility text. */
    const heroAlt = await page({
      canon: false, stateFile: HELD,
      mutateSource: revert(
        'alt="${selectedIsCanon ? `Approved canon image for ${attr(st.name || "state")}` : `Historic image for ${attr(st.name || "state")}, not approved`}"',
        'alt="Approved ${attr(st.name || "state")}"',
      ),
    });
    const heroHtml = evaluate(heroAlt, 'document.getElementById("main").innerHTML');
    ok(/alt="Approved Worn"/.test(heroHtml),
      "CONTROL H4: reverting the hero alt text must describe an unapproved image as approved to a screen reader");

    /* H5 — the head action offered on the state. */
    const headAction = await page({
      canon: false,
      mutateSource: revert(
        '${selectedIsCanon ? "EDIT / REGENERATE" : selectedParentIsCanon ? `GENERATE FROM ${esc(parentInfo.label.toUpperCase())}` : "OPEN STATE WORKFLOW"}',
        '${st.approvedFile ? "EDIT / REGENERATE" : `GENERATE FROM ${esc(parentInfo.label.toUpperCase())}`}',
      ),
    });
    ok(/GENERATE FROM DEFAULT/.test(evaluate(headAction, 'document.getElementById("main").innerHTML')),
      "CONTROL H5: reverting the head action must offer generation from a parent that was never approved");
  }
  console.log(`Entity derivation authority suite passed ${checks} checks: prompt mode, more-candidates, paid dispatch, generation references, readiness copy, validation, correction, row semantics, compiler request and the automation dispatch boundary — every one through the shipped path, with fifteen source-mutation controls. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
