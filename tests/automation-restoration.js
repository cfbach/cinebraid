const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");
const RELEASE_VERSION = require("../package.json").version;

const root = path.join(__dirname, "..");
const automation = fs.readFileSync(path.join(root, "public/automation.js"), "utf8");
const creation = fs.readFileSync(path.join(root, "public/creation-studio.js"), "utf8");
const sceneAutomation = fs.readFileSync(path.join(root, "public/scene-automation.js"), "utf8");
const server = fs.readFileSync(path.join(root, "src/server/server.js"), "utf8");

/* `standing` is the capability record's own authority, and every record
   /api/agents/status sends carries one — server.js `capabilityCheck` stamps it on the
   way out. A fixture that carries only the legacy `ready` boolean describes a record
   the server does not produce: the browser reads it as "not resolved yet" rather than
   as ready, `visionCanReview` refuses, and the blocking review below returns at its
   vision guard without ever calling /api/llm/review. render-harness's
   `readyCapability` carries the field for the same reason; this local helper shadows
   it, so it has to say the same thing. */
function readyAgents() {
  const ready = (label) => ({ ready: true, standing: "ready", label, provider: "test", model: "test-model", message: "", action: "" });
  return { enabled: true, manualMode: false, capabilities: { text: ready("Text"), vision: ready("Vision"), verifier: ready("Verifier"), embedding: ready("Embedding"), technical: ready("Technical") }, agents: [] };
}

async function main() {
  assert(automation.includes("AUTOMATE FULL SHOT"));
  assert(automation.includes("reviewBlockingAttempts"));
  assert(automation.includes("USE RECOMMENDED GUIDE"));
  assert(automation.includes("v664ReviewExistingBlockingForRun"));
  assert(automation.includes("reviewExistingBlocking"));
  assert(automation.includes("reviewSceneAfterShot"));
  assert(automation.includes("v664ReviewSceneAfterShot"));
  assert(creation.includes("REVIEW ALL WITH AI") || creation.includes("AI REVIEW & RECOMMEND"));
  assert(creation.includes("blocking-review-pill"));
  assert(creation.includes("Full shot automation"));
  assert(sceneAutomation.includes("Full scene automation & continuity"));
  assert(sceneAutomation.includes("OPTIONAL ASSISTED SCENE"));
  assert(server.includes("PROJECT-BIBLE AUTHORITY IMAGES"));
  assert(server.includes("authorityImages"));
  assert(server.includes("APPROVED VISUAL STYLE"));
  assert(require(path.join(root, "package.json")).version === `${RELEASE_VERSION}`);

  const project = buildFixture();
  project.meta.workflowEmphasis = "assisted";
  project.mediaAssets.push(
    { id: "blocking-review-a", file: "BLOCK-A.png", storagePath: "shots/L1-01/blocking/BLOCK-A.png", title: "Blocking A", kind: "image", links: [{ id: "blocking-review-link-a", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "returned", generationInput: false, order: 20 }] },
    { id: "blocking-review-b", file: "BLOCK-B.png", storagePath: "shots/L1-01/blocking/BLOCK-B.png", title: "Blocking B", kind: "image", links: [{ id: "blocking-review-link-b", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "returned", generationInput: false, order: 21 }] },
  );
  const rendered = await render("#/shot/L1-01", project, {
    storage: {
      "cinebraid-focused:fixture:shot-task:L1-01": "look",
      "cinebraid-guided-panel:fixture:L1-01:blocking": "1",
    },
    agentStatus: readyAgents(),
  });
  assert(rendered.html.includes("REVIEW ALL WITH AI") || rendered.html.includes("AI REVIEW & RECOMMEND"), "assisted blocking must expose group review");
  assert(rendered.html.includes("AUTOMATE FULL SHOT"), "shot workspace must expose full-shot automation");
  assert(rendered.html.includes("Scene continuity &amp; automation") || rendered.html.includes("Scene continuity & automation"), "shot workspace must link to scene continuity and automation");

  rendered.context.fetch = async (url) => {
    assert.strictEqual(url, "/api/llm/review");
    return {
      ok: true,
      json: async () => ({
        files: ["BLOCK-A.png", "BLOCK-B.png"],
        review: {
          reviews: [
            { n: 1, score: 68, pass: false, explicitPass: true, explicitScore: true, notes: "Weak depth and contact points." },
            { n: 2, score: 93, pass: true, explicitPass: true, explicitScore: true, notes: "Best camera, scale, and contact points." },
          ],
          suggested: 2,
          rationale: "Blocking B is the strongest composition guide.",
        },
        strategy: { mode: "bounded-blocking-review" },
      }),
    };
  };
  rendered.context.flushPendingProjectSave = async () => {};
  rendered.context.route = () => {};
  rendered.context.toast = () => {};
  await rendered.context.reviewBlockingAttempts("L1-01", "", false);
  const reviewState = vm.runInContext(`(() => {
    const shot = shotById("L1-01");
    const summary = blockingAttemptReviewSummary(shot);
    return {
      suggestedAssetId: summary.record.suggestedAssetId,
      score: summary.recommendation && summary.recommendation.score,
      pass: summary.recommendation && summary.recommendation.pass,
      reviewed: summary.reviewed,
    };
  })()`, rendered.context);
  assert.strictEqual(JSON.stringify(reviewState), JSON.stringify({ suggestedAssetId: "blocking-review-b", score: 93, pass: true, reviewed: 2 }));

  rendered.context.useRecommendedBlockingAttempt("L1-01", "");
  const active = vm.runInContext(`(() => {
    const shot = shotById("L1-01");
    return { activeId: ensureShotCreation(shot).activeBlockingAssetId, linkState: P.mediaAssets.find((asset) => asset.id === "blocking-review-b").links[0].blockingState };
  })()`, rendered.context);
  assert.strictEqual(JSON.stringify(active), JSON.stringify({ activeId: "blocking-review-b", linkState: "active" }));

  console.log("Automation restoration suite passed blocking group review/recommendation, guide selection, explicit full-shot automation, scene handoff, Project Bible authority review, and manual-first scene collapse.");
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error); process.exit(1); });
