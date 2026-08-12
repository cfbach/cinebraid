const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");
const RELEASE_VERSION = require("../package.json").version;

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");


function extractBalanced(html, needle, tag) {
  const start = html.indexOf(needle);
  if (start < 0) return "";
  const re = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0, match;
  while ((match = re.exec(html))) {
    if (match[0][1] === "/") depth--; else depth++;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

function visibleTaskControls(html) {
  let count = 0;
  const detailStack = [];
  const token = /<\/?details\b[^>]*>|<button\b[^>]*>|<select\b[^>]*>|<input\b[^>]*>|<[^>]+role=["']listbox["'][^>]*>/gi;
  let match;
  while ((match = token.exec(html))) {
    const tag = match[0];
    if (/^<details/i.test(tag)) { detailStack.push(/\sopen(?:\s|>|=)/i.test(tag)); continue; }
    if (/^<\/details/i.test(tag)) { detailStack.pop(); continue; }
    if (detailStack.some((open) => !open)) continue;
    if (/disabled/i.test(tag)) continue;
    if (/^<input/i.test(tag)) {
      if (/type=["']?(hidden|file)/i.test(tag)) continue;
      if (!/type=["']?checkbox/i.test(tag)) continue;
    }
    count++;
  }
  return count;
}


function shotControlCounts(html) {
  const stack = [];
  const voidTags = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
  let visible = 0, total = 0, match;
  const token = /<\/?([a-z][\w-]*)\b[^>]*>/gi;
  while ((match = token.exec(html))) {
    const raw = match[0], tag = match[1].toLowerCase(), closing = raw.startsWith("</");
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const row = stack.pop();
        if (row.tag === tag) break;
      }
      continue;
    }
    const hidden = /\shidden(?:\s|>|=)/i.test(raw) || /aria-hidden=["']true/i.test(raw) || /style=["'][^"']*display\s*:\s*none/i.test(raw) || /class=["'][^"']*\b(?:hidden|is-hidden)\b/i.test(raw);
    const closedDetails = tag === "details" && !/\sopen(?:\s|>|=)/i.test(raw);
    const control = ["button","select","input","textarea"].includes(tag) || /role=["']listbox["']/i.test(raw);
    if (control) {
      if (!(tag === "input" && /type=["']?(?:hidden|file)/i.test(raw))) {
        total++;
        const disabled = /\sdisabled(?:\s|>|=)/i.test(raw);
        if (!disabled && !hidden && !stack.some((row) => row.hidden || row.closedDetails)) visible++;
      }
    }
    if (!voidTags.has(tag) && !raw.endsWith("/>")) stack.push({ tag, hidden, closedDetails });
  }
  return { visible, total };
}

function buttonLabels(html) {
  const out = [];
  for (const match of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    const label = match[1].replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
    if (label) out.push(label);
  }
  return out;
}

function inaccessibleButtonLabels(html) {
  const issues = [];
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attrs = match[1] || "";
    const aria = attrs.match(/aria-label=["']([^"']+)["']/i)?.[1]?.trim() || "";
    const text = match[2].replace(/<[^>]+>/g, " ").replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, " ").replace(/\s+/g, " ").trim();
    const name = aria || text;
    if (!name || (/^[^A-Za-z0-9]{1,2}$/.test(name) && !aria)) issues.push(name || "(empty)");
  }
  return issues;
}

function stripJsComments(source) {
  let out = "", state = "code", quote = "", escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1] || "";
    if (state === "code") {
      if (char === "/" && next === "/") { state = "line-comment"; out += "  "; i++; continue; }
      if (char === "/" && next === "*") { state = "block-comment"; out += "  "; i++; continue; }
      if (char === "'" || char === '"' || char === "`") { state = "string"; quote = char; escaped = false; }
      out += char;
      continue;
    }
    if (state === "line-comment") {
      if (char === "\n") { state = "code"; out += "\n"; } else out += " ";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") { state = "code"; out += "  "; i++; }
      else out += char === "\n" ? "\n" : " ";
      continue;
    }
    out += char;
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === quote) state = "code";
  }
  return out;
}

function orphanFrontendFunctions(frontendSources, supportingSources = [], allowlist = []) {
  const allow = new Set(allowlist);
  const corpus = [...frontendSources, ...supportingSources]
    .map((entry) => stripJsComments(entry.source || ""))
    .join("\n");
  const orphans = [];
  for (const entry of frontendSources) {
    const clean = stripJsComments(entry.source || "");
    for (const match of clean.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const name = match[1];
      if (allow.has(name)) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const uses = corpus.match(new RegExp(`(^|[^A-Za-z0-9_$])${escaped}(?=[^A-Za-z0-9_$]|$)`, "g")) || [];
      if (uses.length <= 1) orphans.push(`${entry.name}:${name}`);
    }
  }
  return orphans.sort();
}

async function main() {
  const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert(/function workspaceSectionOpen\s*\(/.test(appSource), "workspaceSectionOpen must be a real global function, not only a window property");
  assert(/window\.workspaceSectionOpen\s*=\s*workspaceSectionOpen/.test(appSource), "workspaceSectionOpen must remain available through window for inline handlers and compatibility");

  const index = read("public/index.html");
  const destinations = [...index.matchAll(/(?:data-view="([^"]+)"|href="\/bible\.html")/g)]
    .map((m) => m[1] || "bible")
    .filter((x, i, a) => a.indexOf(x) === i);
  assert.deepStrictEqual(destinations, ["production", "shots", "library", "bible", "reports", "settings"]);
  assert(!index.includes("mode-toggle"));
  assert(!index.includes("experimental-execution.js"));
  assert(!index.includes(">A<"), "retired amber A favicon must be gone");
  assert(index.includes(`styles.css?v=${RELEASE_VERSION}`), "frontend assets must be cache-busted after patch updates");
  assert(index.includes(`shared-entities.js?v=${RELEASE_VERSION}`), "shared entity resolver must load before the app");
  assert(index.includes(`shared-camera.js?v=${RELEASE_VERSION}`), "shared camera vocabulary must load before the app");
  assert(index.includes(`shared-aspect.js?v=${RELEASE_VERSION}`), "shared aspect-ratio model must load before the app");
  assert(index.includes(`shared-reference-views.js?v=${RELEASE_VERSION}`), "shared reference-view vocabulary must load before media and composer modules");
  assert(index.includes(`shared-continuity-binding.js?v=${RELEASE_VERSION}`), "shared declared-state binding contract must load as a cache-busted frontend module");
  assert(index.indexOf(`shared-continuity-binding.js?v=${RELEASE_VERSION}`) < index.indexOf(`shared-continuity.js?v=${RELEASE_VERSION}`),
    "and it must load before shared-continuity.js, whose resolveDeclaredStateId is now the entry point to the rule rather than a second copy of it");
  assert(index.includes(`shared-coverage.js?v=${RELEASE_VERSION}`), "shared coverage-requirement contract must load before every surface that counts views");
  assert(index.indexOf(`shared-coverage.js?v=${RELEASE_VERSION}`) < index.indexOf(`app.js?v=${RELEASE_VERSION}`),
    "and it must load before app.js, whose coverage templates seed through it");
  assert(index.includes(`shared-build-history.js?v=${RELEASE_VERSION}`), "shared prompt-history compatibility must load before the app");
  assert(index.includes(`shared-generation-capability.js?v=${RELEASE_VERSION}`), "shared generation capability must load before the app");
  assert(index.includes(`v607-composer.js?v=${RELEASE_VERSION}`), "composer module must be cache-busted after patch updates");
  assert(index.includes(`motion-sound-composer.js?v=${RELEASE_VERSION}`), "Motion & Sound Composer must load after the shot composer");
  assert(index.includes(`scene-automation.js?v=${RELEASE_VERSION}`), "scene automation must load after the durable automation runner");
  assert(index.includes(`coverage-automation.js?v=${RELEASE_VERSION}`), "coverage automation must load as a cache-busted frontend module");
  assert(read("public/review-provenance.js").includes("buildCandidateCorrectionPrompt"), "candidate review must create targeted correction prompts");
  assert(read("public/review-provenance.js").includes("openCandidateCorrectionModal"), "candidate corrections must expose an executable generation panel");
  assert(read("public/fal-generation.js").includes("startCandidateCorrectionGeneration"), "candidate corrections must submit through the existing FAL job path");
  assert(read("fal-generation.js").includes('purpose === "correction"'), "server-side FAL ingestion must preserve correction purpose and provenance");
  assert(read("public/review-provenance.js").includes("candidate-review-readiness"), "candidate review must expose a compact readiness state");
  const styles = read("public/styles.css");
  const media = read("public/media.js");
  assert(styles.includes(".modal-box:has(.candidate-review-modal)"), "candidate review must size the dialog parent instead of overflowing the default narrow modal");
  assert(styles.includes(".modal-box:has(.entity-approval-modal)"), "entity approval must size the dialog parent so the background covers the complete workflow");
  assert(read("public/library-tools.js").includes("APPROVE & EDIT NEXT STATE"), "entity approval must offer direct continuation into another continuity state");
  assert(read("public/library-tools.js").includes("nextState.parentStateId = targetStateId"), "approval continuation must derive the next state from the newly approved state");
  assert(styles.includes(".guided-next-action.is-ready"), "approved workflow stages must use an explicit green next-action state");
  assert(styles.includes(".guided-frame-return.is-approved"), "approved frame sections must expose a fixed green completion state");
  for (const legacyToken of ["shot-composer-canvas", "shot-composer-element", "composer-resize", "composer-selection-panel", "project-media-advanced"]) {
    assert(!styles.includes(legacyToken), `retired staging/metadata CSS remains: ${legacyToken}`);
  }
  assert(!media.includes("project-media-advanced"), "reference cards must not expose the old inline metadata matrix");
  assert(!media.includes("refmeta-priority"), "priority must be derived instead of requested in normal reference authoring");
  assert(!media.includes("refmeta-angles"), "available-angle sheets must remain readable without a permanent authoring field");
  assert(media.includes("link?.availableAngles"), "stored available-angle metadata must remain readable");
  assert(media.includes("defaultReferencePriority"), "new reference priority must use a working role-based default");
  assert(read("server.js").includes('app.post("/api/llm/review-candidate"'), "structured multimodal candidate review endpoint must remain available");
  assert(read("server.js").includes('app.post("/api/llm/review-entity-candidate"'), "state-specific structured entity candidate review endpoint must remain available");
  /* B2a: the declared delta reaches the reviewer as a checklist CineBraid owns,
     what comes back is compared rather than believed, and the review records
     which provider and model actually served it. */
  assert(read("server.js").includes("declaredRequirements: declaredState.requirements"), "the declared state delta must reach the review contract as data, not only as prompt prose");
  assert(read("reference-review-contract.js").includes('hardGateFailures.push("declared-state-unsatisfied")'), "an unsatisfied declared requirement must remain a hard gate");
  assert(read("server.js").includes("reviewer: { provider: assistant.provider || \"\", model: assistant.model || \"\" }"), "candidate review must report the provider and model that served it");
  assert(read("public/review.js").includes("openEntityCandidateReview"), "entity candidates must expose the structured vision review popup");
  const creationStudio = read("public/creation-studio.js");
  const automation = read("public/automation.js");
  const sceneAutomation = read("public/scene-automation.js");
  assert(automation.includes("runShotAutomation"), "shot workspace must expose durable still-chain automation");
  assert(automation.includes("v626OpeningBlocking"), "shot automation must include bounded opening blocking orchestration");
  assert(automation.includes("v626DerivativeBlocking"), "later frames must support frame-specific derivative blocking");
  assert(automation.includes("v626AutomateFrame"), "shot automation must process selected required frames parent-first");
  assert(automation.includes("runEntityAutomation"), "entity references must expose durable state-chain automation");
  assert(automation.includes("v626StateOrder"), "continuity-state automation must resolve parent dependencies");
  assert(sceneAutomation.includes("runSceneAutomation"), "scene pages must expose durable whole-scene still automation");
  const reports = read("public/reports.js");
  assert(index.includes('data-view="reports"'), "primary navigation must expose the Reports route");
  assert(index.includes(`reports.js?v=${RELEASE_VERSION}`), "Reports must load as a cache-busted frontend module");
  assert(reports.includes("RUN HISTORY"), "Reports must expose durable run history");
  assert(reports.includes("WHERE EFFORT WENT"), "Reports must aggregate project-wide generation effort");
  for (const fn of ["copyAutomationSupportSummary", "copyAutomationDebugReport", "downloadAutomationRunReport", "downloadAutomationDiagnosticBundle", "flagAutomationRunInefficient", "saveAutomationEfficiencyFeedback"]) assert(reports.includes(fn), `${fn} must remain reachable from Reports`);
  assert(read("automation-runs.js").includes('/api/automation/reports/summary'), "Reports must expose a project optimization summary endpoint");
  assert(read("automation-runs.js").includes('/api/automation/runs/:id/report'), "Reports must lazy-load selected run detail");
  assert(sceneAutomation.includes("Max frame passes per shot"), "scene automation must expose more than three configurable generation passes");
  assert(sceneAutomation.includes("maxCorrectionRounds"), "scene automation must include bounded continuity correction cycles");
  assert(sceneAutomation.includes("/api/llm/review-scene-correction"), "scene correction candidates must be reviewed against adjacent approved shots");
  assert(sceneAutomation.includes("v640SceneApplyContext"), "later scene shots must receive approved scene continuity context");
  assert(read("server.js").includes('app.post("/api/llm/review-scene"'), "the server must expose whole-scene continuity review");
  assert(read("server.js").includes('app.post("/api/llm/review-scene-correction"'), "the server must expose sequence-aware correction review");
  assert(read("automation-runs.js").includes("diagnostic.zip"), "automation runs must expose redacted diagnostic ZIP bundles");
  assert(read("automation-runs.js").includes("repairSceneCorrectionProvenance"), "failed scene corrections must be repairable before retry");
  assert(read("public/automation.js").includes("REPAIR & RETRY FAILED STEP"), "scene correction failures must expose repair-and-retry");
  assert(read("automation-runs.js").includes("result: source.result"), "scene run review and correction results must persist durably");
  assert(read("fal-generation.js").includes("reportedUsage"), "the server credit guard must include child-run usage in the parent scene budget");
  assert(read("automation-runs.js").includes('app.get("/api/automation/runs"'), "automation runs must persist per project");
  assert(read("fal-generation.js").includes("automationStepKey"), "paid FAL jobs must be idempotent per durable automation step");
  assert(read("server.js").includes('kind === "blocking"'), "vision review must support blocking candidate sets");
  assert(read("server.js").includes("compactBlockingImprovePayload"), "blocking improvement must send a compact payload instead of the full mutable shot record");
  assert(read("server.js").includes("requestStrictAssistantJson"), "blocking improvement must retry incomplete assistant JSON");
  assert(read("server.js").includes("failed after 3 attempts"), "assistant work must report three-attempt recovery rather than a raw parser error");
  assert(read("server.js").includes("for (let attempt = 0; attempt < 3; attempt++)"), "assistant work must receive an initial attempt plus two automatic retries");
  assert(creationStudio.includes("focusGuidedWorkspaceTarget"), "motion and frame CTAs must wait for the async route render before scrolling to their workspace");
  assert(creationStudio.includes('class="guided-video-target-control"'), "the video model selector must remain visible without opening a nested disclosure");
  for (const family of ["seedance-2", "kling-3", "ltx-2.3", "happy-horse-1.1"]) assert(creationStudio.includes(`"${family}"`), `video target selector must expose ${family}`);
  assert(read("prompt-engine.js").includes("referenceAwarePromptSpec"), "image and video compilation must replace ungrounded character names with reference-aware visual language");
  assert(creationStudio.includes("assistantWorkingCard"), "prompt workflows must expose the visual assistant working state");
  assert(styles.includes(".assistant-working-card"), "visual assistant working state must be styled");
  assert(automation.includes("automation-run-summary"), "automation completion summaries must use a full-width readable block");
  assert(styles.includes(".automation-run-summary"), "automation completion summary styling must prevent one-word-per-line wrapping");
  assert(styles.includes(".modal-box:has(.automation-plan-modal)"), "automation planners must size the dialog shell against the viewport");
  assert(styles.includes(".automation-plan-modal{box-sizing:border-box;width:100%;min-width:0"), "automation planner content must not force the old 760px overflow");
  assert(styles.includes(".automation-human-review"), "borderline automation results must expose a visual director review gate");
  assert(automation.includes("v627AcquireAutomationLease"), "durable runs must acquire a single-window server lease before orchestration");
  assert(automation.includes("v6211RevalidatePaidStepLease"), "every paid automation submission must immediately revalidate or reacquire its browser lease");
  assert(read("automation-runs.js").includes('/lease/revalidate'), "the server must expose atomic paid-step lease revalidation");
  assert(automation.includes("generationSettings: draft.generationSettings"), "automation runs must snapshot the confirmed image quality and resolution settings");
  assert(automation.includes("v6211RunGenerationSettings(run).blockingQuality"), "blocking automation must use the run's saved quality setting");
  assert(automation.includes("v6211RunGenerationSettings(run).frameResolution"), "frame and reference automation must use the run's saved resolution setting");
  assert(read("automation-runs.js").includes("lastPaidStepRevalidatedAt"), "run reports must preserve historical lease diagnostics after release");
  assert(automation.includes("V627_AUTOMATION_AUTO_APPROVE_SCORE = 85"), "automatic approval must use the explicit strong-pass threshold");
  assert(read("automation-runs.js").includes('code: "STALE_RUN"'), "stale run writes must be rejected instead of overwriting current state");
  assert(read("automation-runs.js").includes("cancelRequested: current.cancelRequested === true || body.cancelRequested === true"), "stop requests must remain sticky across stale browser saves");
  assert(read("automation-runs.js").includes("5 * 60_000"), "automation leases must tolerate ordinary background-tab throttling");
  assert(automation.includes('document.addEventListener("visibilitychange"'), "returning to a visible tab must immediately revalidate active automation leases");
  assert(automation.includes("LEASE LOST — RESUME REQUIRED"), "lease heartbeat failure must be visible in the run console");
  assert(automation.includes("V628_FAL_POLL_TIMEOUT_MS"), "provider polling must have a bounded browser wait deadline");
  assert(automation.includes("providerStillActive: true"), "timed-out polling must preserve the accepted provider job for resume");
  assert(automation.includes("Credit guard is not configured with a valid positive image cap"), "missing or zero automation caps must fail closed before paid submission");
  const llmAdapter = read("llm.js");
  assert(llmAdapter.includes('"/api/chat"'), "local Ollama text calls must use the native chat endpoint");
  assert(llmAdapter.includes("think: false"), "local thinking models must return usable final content instead of reasoning-only output");
  assert(llmAdapter.includes('payload.format = "json"'), "strict local tasks must request native structured JSON output");
  assert(read("server.js").includes("returned an empty final response"), "assistant connection testing must reject empty local-model output");
  assert(automation.includes("v628AttachShotAutomationProvenance"), "approved frames must retain durable automation provenance");
  assert(read("public/entities.js").includes("APPROVED IMAGES"), "reference pages must separate approved state images from the candidate pile");
  assert(read("public/entities.js").includes("Rejected candidates"), "failed entity generations must remain recoverable outside the active candidate grid");

  const views = read("public/views.js");
  const creation = read("public/creation-studio.js");
  const planning = read("public/planning.js");
  assert(!views.includes("ADVANCED_MODE"));
  assert(!creation.includes("toggleAdvancedMode"));
  assert(!creation.includes("Workflow override"));
  assert(!creation.includes("Intended output"));
  assert(!creation.includes("FIRST PROJECT SUCCESS"));
  assert(!creation.includes("REFERENCE READINESS"));
  assert(!creation.includes("function shotImageStudio"));
  assert(!creation.includes("function guidedShotImageStudio"));
  for (const legacyToken of ["shot-composer-canvas", "Stage references visually", "startComposerDrag", "startComposerResize", "addComposerElement", "setComposerCamera"]) {
    assert(!creation.includes(legacyToken), `legacy visual staging authoring remains: ${legacyToken}`);
  }
  assert(!read("public/v607-composer.js").includes("setComposerBase"), "reference review must not call the retired visual staging base selector");
  assert(!planning.includes("function unifiedGenerationPackagePanel"));
  assert(!planning.includes("setPackageReferenceInstruction"));
  assert(!planning.includes("movePackageReference"));
  assert(!planning.includes("comparePromptProfiles"));
  assert(!planning.includes("buildGenerationPackage"));
  assert(!planning.includes("promptBuilderPanel"));

  /* __pycache__ is Python bytecode for the real-browser suites. It is gitignored
     build output rather than a test file, and it appears the moment anything
     imports tests/browser_runtime.py without PYTHONDONTWRITEBYTECODE - which the
     runners set but an ad-hoc `python tests/...` does not. Listing it here would
     make this manifest fail based on how the suites were last invoked. */
  const tests = fs.readdirSync(path.join(ROOT, "tests")).filter((name) => name !== "__pycache__").sort();
  assert.deepStrictEqual(tests, [
    "account-connection-contract.js",
    "account-lan-safety.js",
    "account-provider-adapter.js",
    "account-secret-handling.js",
    "alpha-production-loop-negative-controls.js",
    "alpha-production-loop-real-browser.py",
    "alpha-production-loop.js",
    "api-smoke.js",
    "approval-reference-consistency.js",
    "asset-lifecycle.js",
    "automation-diagnostics.js",
    "automation-frame-preflight-negative-controls.js",
    "automation-frame-preflight.js",
    "automation-restoration.js",
    "backup-ownership.js",
    "blocking-automation-discoverability.js",
    "bounded-rendering.js",
    "brand-logo-asset.js",
    "brand-logo-real-browser.py",
    "browser-requirements.txt",
    "browser-workflow-exit.js",
    "browser-workflow.js",
    "browser_runtime.py",
    "build-history.js",
    "c2b-generation-real-browser.py",
    "candidate-review-semantics-negative-controls.js",
    "candidate-review-semantics-real-browser.py",
    "candidate-review-semantics.js",
    "clarity-consolidation.js",
    "composer-motion.js",
    "config-durability.js",
    "config-secret-registry.js",
    "continuity-cache.js",
    "continuity-compare-route.js",
    "continuity-comparison.js",
    "continuity-correction-modal.js",
    "continuity-correction-real-browser.py",
    "continuity-correction-workflow.js",
    "continuity-json-recovery.js",
    "continuity-manifest.js",
    "continuity-observation.js",
    "continuity-observe-route.js",
    "continuity-prompt-contract.js",
    "continuity-state-binding-negative-controls.js",
    "continuity-state-binding-real-browser.py",
    "continuity-state-binding.js",
    "continuity-validation-status.js",
    "continuity-workflow-real-browser.py",
    "continuity-workspace.js",
    "coverage-requirement-semantics-negative-controls.js",
    "coverage-requirement-semantics.js",
    "coverage-workflow.js",
    "current-behavior.js",
    "custom-provider-routing.js",
    "data-recovery-focused-state.js",
    "data-safety-repair.js",
    "deep-bot-safety.js",
    "external-test-readiness.js",
    "fal-generation.js",
    "fixtures",
    "focused-workspaces-real-browser.py",
    "focused-workspaces.js",
    "generation-capability.js",
    "generation-compiler-fixture.js",
    "generation-compiler-negative-controls.js",
    "generation-compiler.js",
    "generation-cost-history-negative-controls.js",
    "generation-cost-history.js",
    "generation-default-inheritance-negative-controls.js",
    "generation-default-inheritance.js",
    "generation-defaults-real-browser.py",
    "generation-job-contract.js",
    "generation-job-durability.js",
    "generation-options-negative-controls.js",
    "generation-options.js",
    "generation-policy-contracts.js",
    "generation-unresolved-negative-controls.js",
    "generation-unresolved.js",
    "gpt-image-2-pack.js",
    "h3-execution-fixture.js",
    "h3-execution-negative-controls.js",
    "h3-execution-wiring.js",
    "image-execution-fixture.js",
    "image-execution-wiring.js",
    "image-review-scale.js",
    "import-benchmark.js",
    "integrity-mobile-usability.js",
    "intent-loss-safety.js",
    "lan-passcode-real-browser.py",
    "lan-passcode-settings.js",
    "launch-blockers.js",
    "live-activity.js",
    "local-only-policy.js",
    "manual-first-parity.js",
    "manual-first-real-browser.py",
    "manual-first-workflow.js",
    "media-asset-backfill.js",
    "media-asset-identity.js",
    "media-asset-inertness.js",
    "media-asset-no-hydration.js",
    "media-asset-store.js",
    "media-asset-sync-safety.js",
    "media-asset-verify.js",
    "media-hash-extraction.js",
    "minimax-h3-real-browser.py",
    "minimax-h3.js",
    "model-definition-registry.js",
    "model-intelligence-negative-controls.js",
    "model-intelligence.js",
    "motion-prompt-editing-real-browser.py",
    "multi-aspect-media.js",
    "ofp-contract.js",
    "ofp-migration-negative-controls.js",
    "ofp-migration.js",
    "ofp-negative-controls.js",
    "ofp-overfit-conformance.js",
    "ofp-overfit-negative-controls.js",
    "ofp-read-invariant.js",
    "ofp-serialization.js",
    "openai-request-dialect.js",
    "private-preview-layout-real-browser.py",
    "private-preview-ux.js",
    "project-builder-kit.js",
    "project-path-containment.js",
    "project-switch-safety.js",
    "provider-health.js",
    "readiness-feedback.js",
    "real-browser-workflow.py",
    "reference-angle-routing.js",
    "reference-aspect-consistency.js",
    "reference-authority-deep-dive.js",
    "reference-automation-closed-loop.js",
    "reference-automation-real-browser.py",
    "reference-review-contract.js",
    "reference-workflow-repair.js",
    "reference-workspace-ux.js",
    "release-package-smoke.js",
    "render-harness.js",
    "request-boundary.js",
    "run-browser-gate.js",
    "run-full-check.js",
    "run-python-check.js",
    "safety-integrity.js",
    "settings-consistency.js",
    "shot-workspace-responsive-layout.js",
    "state-authority-substitution-negative-controls.js",
    "state-authority-substitution.js",
    "state-chain-recovery.js",
    "state-interleaving.js",
    "studio-repair.js",
    "ui-state-stability-real-browser.py",
    "v6641-usability.js",
    "v6642-board-density-real-browser.py",
    "v6642-board-density.js",
    "version-consistency.js",
    "voice-runtime-ownership-negative-controls.js",
    "voice-runtime-ownership.js",
    "windows-shutdown.js",
  ]);

  assert.deepStrictEqual(
    orphanFrontendFunctions(
      [{ name: "synthetic.js", source: "function used() {}\nused();\nfunction orphaned() {}" }],
    ),
    ["synthetic.js:orphaned"],
    "orphan guard must fail when a top-level function loses its only call site",
  );
  const frontendSourceEntries = fs.readdirSync(path.join(ROOT, "public"))
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => ({ name: `public/${name}`, source: read(`public/${name}`) }));
  const supportingSourceEntries = [
    ...fs.readdirSync(path.join(ROOT, "public"))
      .filter((name) => name.endsWith(".html"))
      .sort()
      .map((name) => ({ name: `public/${name}`, source: read(`public/${name}`) })),
    ...fs.readdirSync(path.join(ROOT, "tests"))
      .filter((name) => name.endsWith(".js"))
      .sort()
      .map((name) => ({ name: `tests/${name}`, source: read(`tests/${name}`) })),
    { name: "server.js", source: read("server.js") },
  ];
  assert.deepStrictEqual(
    orphanFrontendFunctions(frontendSourceEntries, supportingSourceEntries),
    [],
    "top-level frontend functions must have a reachable call site or explicit entry-point registration",
  );

  /* ---- the shipped scripts share one global scope ----

     public/*.js are plain <script> tags, not modules, so every top-level
     `const`, `let` and `class` lands in one shared lexical scope. Two files
     declaring the same name is a SyntaxError that stops the second script dead;
     C2b shipped exactly that - two shared files each declaring `const EXPORTS` -
     and it blanked the entire application. Every Node suite passed, because each
     file is individually valid and no Node suite ever loads them together.

     tests/generation-options.js section 12 already checks this by scanning each
     file for `^(const|let|class) name`. This is deliberately a second, different
     technique rather than a copy: a regex anchored at column 0 cannot see an
     indented top-level declaration, the second binding in `let a = 1, b = 2`, or
     a destructured one, and all three are real collisions. Handing the
     concatenation to the same V8 parser the browser uses answers the question
     exactly. `new vm.Script` parses without executing, so there are no side
     effects, and `var`/`function` redeclarations - legal in a browser - are
     correctly not flagged.

     Per PAGE, because each page is its own global scope: app.js and bible.js both
     declare `esc`, which is fine precisely because no page loads both. The load
     order comes from the HTML, so a script that is shipped but never loaded
     cannot hide in here either. */
  for (const page of ["index.html", "bible.html"]) {
    const html = read(`public/${page}`);
    const loadedScripts = [...html.matchAll(/<script src="([^"?]+\.js)/g)].map((match) => match[1]);
    assert(loadedScripts.length, `expected ${page} to load frontend scripts, found none`);
    if (page === "index.html")
      assert(loadedScripts.length > 30, `expected index.html to load the frontend scripts, found ${loadedScripts.length}`);
    for (const name of loadedScripts)
      assert(fs.existsSync(path.join(ROOT, "public", name)), `${page} loads public/${name}, which does not exist`);
    const globalScope = loadedScripts
      .map((name) => `/* ${name} */\n${read(`public/${name}`)}`)
      .join("\n;\n");
    try {
      new vm.Script(globalScope, { filename: `public/<scripts loaded by ${page}>` });
    } catch (error) {
      assert.fail(
        `the scripts ${page} loads do not share one global scope cleanly: ${error.message}\n` +
        "Two of them declare the same top-level const/let/class. In the browser the second " +
        "script throws and the page renders blank. Rename one binding - see the " +
        "GENERATION_OPTION_EXPORTS convention in public/shared-generation-options.js.");
    }
  }

  const app = read("public/app.js");
  const settings = read("public/settings.js");
  const server = read("server.js");
  assert(app.includes("flushPendingProjectSave"));
  assert(app.includes("/api/projects/${encodeURIComponent(job.slug)}/project"));
  assert(app.includes('falConfig.enabled && falConfig.keySource !== "none"'), "FAL job history must load only when the optional integration is configured");
  assert(!settings.includes("commitImport"));
  assert(!settings.includes("doImport"));
  assert(!server.includes('app.post("/api/import"'));
  assert(server.includes("IMPORT_PREVIEWS"));
  assert(server.includes("atomicWriteJson"));
  assert(server.includes('res.setHeader("Cache-Control", "no-store, max-age=0")'), "local frontend assets must not mix across patched versions");
  assert(app.includes("reloadCineBraidSafe"), "route recovery must expose a stable-workspace reload");
  assert(app.includes("disableComposerEnhancements"), "route failures must be able to restore the stable shot workspace");
  const composerGuard = read("public/v607-composer.js");
  assert(composerGuard.includes("composerSafeRequested"));
  assert(composerGuard.includes("restoreComposerOriginals607"));
  const frontendConfirmSources = ["public/app.js", "public/creation-studio.js", "public/mutations.js", "public/settings.js", "public/library-tools.js"].map(read).join("\n");
  assert(!/\bconfirm\s*\(/.test(frontendConfirmSources), "native browser confirms must not bypass the accessible modal system");

  const rootMarkdown = fs.readdirSync(ROOT).filter((name) => name.endsWith(".md"));
  assert(rootMarkdown.length <= 5, `root has ${rootMarkdown.length} markdown files`);
  assert(!fs.readdirSync(ROOT).some((name) => name.endsWith(".docx")));

  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === "node_modules" || name === ".git") continue;
      const full = path.join(dir, name), stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full); else files.push(full);
    }
  }
  walk(ROOT);
  const retiredPattern = new RegExp(["still", "house"].join(""), "i");
  /* Two files are exempt, by exact path and for one reason: they are preserved
     historical records, not product text.

     The frozen P0 architecture documents measured the real legacy corpus, and
     several of those project generations are literally named after the retired
     product - `<retired>-40`, `<retired>-41-gpt`. The name appears there as
     DATA, in a table of directories that exist on disk, and the whole value of
     a frozen decision record is that it says what was measured rather than what
     is comfortable to read now. Editing it to satisfy this guard would falsify
     a record that other phases are meant to be able to trust.

     The P3 corpus adds two more, for the same reason at one remove. The
     sanitized Overfit fixtures are derived from directories on disk, and seven
     of those directories are named after the retired product. The fixture IDs
     and lineage labels are named for the hub version instead, so the retired
     name survives in exactly two places: the `sourceRelative` table the build
     tool reads the archive with, and the manifest generated from it. Renaming
     either would mean the tool could no longer find the files, or the manifest
     could no longer say where a fixture came from - which is the whole point of
     a provenance record.

     The exemption is four exact paths, so the guard still fires for every other
     file including any new one. */
  const HISTORICAL_RECORDS = new Set([
    path.join("docs", "architecture", "CINEBRAID_CANONICAL_FORMAT_AUDIT_2026-08-09.md"),
    path.join("docs", "architecture", "CINEBRAID_P0_ARCHITECTURE_DECISION_2026-08-09.md"),
    path.join("scripts", "overfit-fixture-model.js"),
    path.join("tests", "fixtures", "ofp-migration", "overfit", "manifest.json"),
  ]);
  const retired = files.filter((file) => !HISTORICAL_RECORDS.has(path.relative(ROOT, file))
    && (retiredPattern.test(fs.readFileSync(file).toString("utf8")) || retiredPattern.test(path.basename(file))));
  assert.deepStrictEqual(retired, [], `retired name remains in: ${retired.join(", ")}`);
  /* And the exemption is not a licence: the guard must still catch the name in
     an ordinary file, so a typo in the path above cannot silently disable it. */
  assert(retiredPattern.test(["still", "house"].join("")), "the retired-name guard must still match the name it is for");
  for (const exempt of HISTORICAL_RECORDS)
    assert(fs.existsSync(path.join(ROOT, exempt)), `${exempt} is exempt from the retired-name guard and must therefore exist`);

  const { html } = await render("#/shot/L1-01", buildFixture(), { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "frames" } });
  assert(html.includes("NEXT ACTION"));
  assert(html.includes("Create and choose the images"));
  assert(!html.includes("Generation package"));
  assert(!html.includes("Review Inbox"));
  assert(!html.includes("Advanced workspace"));
  assert(!creation.includes("shotCreationReadiness"));
  assert(!creation.includes("buildSimpleShotPrompt"));
  assert(!creation.includes("guidedFlowSteps"));
  assert(creation.includes("GUIDED_PROMPT_OPS"));
  assert(creation.includes("AbortController"));
  assert(!creation.includes("busy: !!existing.busy"));
  assert(!creation.includes("const busy = !!c.motionBusy"));
  assert(creation.includes('selectedCandidate: existing.selectedCandidate || ""'), "candidate selection must survive rerender");
  assert(creation.includes("resetGuidedFrameApproval"), "approved frames must be resettable");
  assert(creation.includes("guidedFrameApprovalChanged"), "replacing a frame must reopen dependent motion");
  assert(creation.includes("visionReviewFrame"), "frame-specific vision review must remain available");
  assert(creation.includes("segmentId: unitKey(unit)"), "motion compile must target the guided segment");
  assert(creation.includes("durationSeconds: duration"), "motion compile must send the selected duration");
  assert(creation.includes("shotCreationReferences(s)"), "Seedance Omni must receive selected image references");
  assert(creation.includes("READY-TO-USE MOTION PROMPT"), "the final compiled motion prompt must be visible without opening a secondary disclosure");
  assert(creation.includes("sourceDirectiveSanitized"), "legacy compiler boilerplate recovery must be stored with the prompt build");
  assert(server.includes("parseAssistantMotionRevision"), "nested and plain-text motion revisions must be normalized server-side");
  assert(server.includes("removeUnsuppliedAudioClaims"), "assistant motion revisions must not invent audio when none was supplied");

  const promptFixture = buildFixture();
  promptFixture.shots[0].creationBrief = {
    motionProfileId: "kling-3/i2v",
    motionDirection: "The ship drifts slowly. Camera remains locked.",
    motionPromptBuilds: [{
      id: "motion-build-1",
      packageId: "L1-01-MOTION-R01",
      profileId: "kling-3/i2v",
      profileName: "Kling 3 — Image to Video",
      prompt: "From the supplied starting image, the ship drifts slowly. The camera does not move.",
      originalDirective: "The ship drifts slowly. Camera remains locked.",
      improvedDirective: "The ship drifts almost imperceptibly. Camera remains locked.",
      improvementNotes: ["Clarified the speed."],
      references: [{ role: "first-frame" }],
      durationSeconds: 5,
    }],
  };
  const promptRender = await render("#/shot/L1-01", promptFixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  assert(promptRender.html.includes("READY-TO-USE MOTION PROMPT"));
  assert(promptRender.html.includes("From the supplied starting image, the ship drifts slowly."));
  assert(promptRender.html.includes("Review revised motion direction"));
  assert(!promptRender.html.includes('&quot;directive&quot;'));

  const fixture = buildFixture();
  const states = [["approved frames", fixture, undefined]];
  const empty = structuredClone(fixture);
  empty.shots[0].keyframes.forEach((frame) => { frame.winner = null; frame.generationPackages = []; });
  empty.shots[0].clips = [];
  empty.shots[0].winner = null;
  states.push(["empty frame", empty, { anchors: [], plates: [], props: [], audio: [], media: [], shots: { "L1-01": { takes: [], locked: [] } } }]);
  states.push(["returned candidates", structuredClone(empty), undefined]);
  const oneFrame = structuredClone(fixture);
  oneFrame.shots[0].keyframes = [oneFrame.shots[0].keyframes[0]];
  oneFrame.shots[0].clips = [];
  states.push(["opening frame approved", oneFrame, undefined]);

  for (const [label, project, scan] of states) {
    const rendered = await render("#/shot/L1-01", project, { ...(scan ? { scan } : {}), storage: { "cinebraid-focused:fixture:shot-task:L1-01": "frames" } });
    let rest = rendered.html, cards = 0;
    while (true) {
      let card = extractBalanced(rest, '<details class="guided-frame-card', "details");
      if (!card) card = extractBalanced(rest, '<article class="guided-frame-card', "article");
      if (!card) break;
      cards++;
      assert(visibleTaskControls(card) <= 7, `${label} frame card exceeded the 7-control budget`);
      rest = rest.slice(rest.indexOf(card) + card.length);
    }
    assert(cards >= 1, `${label} rendered no frame card`);
    const motion = extractBalanced(rendered.html, '<details class="guided-work-panel guided-motion-card', "details");
    if (motion) assert(visibleTaskControls(motion) <= 7, `${label} motion step exceeded the 7-control budget`);
  }

  const stale = structuredClone(fixture);
  stale.shots[0].creationBrief = stale.shots[0].creationBrief || {};
  stale.shots[0].creationBrief.frameWorkflows = { "frame-a": { busy: true, busyLabel: "compile" } };
  stale.shots[0].creationBrief.motionBusy = true;
  stale.shots[0].creationBrief.motionBusyLabel = "improve";
  const staleFrameRender = await render("#/shot/L1-01", stale, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "frames" } });
  const staleMotionRender = await render("#/shot/L1-01", stale, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  assert(!staleFrameRender.html.includes("Compiling…"), "persisted frame busy state must not survive reload");
  assert(!staleMotionRender.html.includes("WORKING…"), "persisted motion busy state must not survive reload");

  const shotRender = await render("#/shot/L1-01", fixture);
  const controls = shotControlCounts(shotRender.html);
  assert(controls.visible <= 10, `default-visible shot controls: ${controls.visible}`);
  assert(controls.total <= 30, `total reachable shot controls: ${controls.total}`);

  const activityRender = await render("#/shot/L1-01", fixture);
  vm.runInContext(`AUTOMATION_RUNS=[{id:'budget-run',revision:1,type:'shot-chain',targetId:'L1-01',scope:'stills',label:'Budget run',status:'running',stage:'Generating',summary:'Working',createdAt:'2026-07-29T10:00:00Z',updatedAt:'2026-07-29T10:00:10Z',config:{maxImages:9},usage:{imagesGenerated:0,imageRequests:0,reviewCalls:0},current:{stepKey:'frame:a:generate'},steps:{'frame:a:generate':{key:'frame:a:generate',kind:'generation',status:'running',label:'Generate Frame A',attempt:1,maxAttempts:3,startedAt:'2026-07-29T10:00:00Z',updatedAt:'2026-07-29T10:00:10Z',activity:{system:'FAL · GPT IMAGE 2',state:'preparing'}}},logs:[]}]; V641_ACTIVITY_DRAWER_OPEN=true; v641RenderActivityDrawer();`, activityRender.context);
  const strip = activityRender.context.v642EnsureGlobalActivityStrip();
  activityRender.context.v642UpdateGlobalActivityStrip();
  const globalChromeMarkup = `<button>${strip.innerHTML}</button>${activityRender.context.document.getElementById("automation-activity-drawer").innerHTML}`;
  const globalControls = shotControlCounts(globalChromeMarkup);
  assert(globalControls.visible <= 4, `globally injected activity controls: ${globalControls.visible}`);
  assert(globalControls.total <= 4, `globally injected activity controls total: ${globalControls.total}`);
  const budgetRun = vm.runInContext(`AUTOMATION_RUNS[0]`, activityRender.context);
  const consoleControls = shotControlCounts(activityRender.context.v641LiveActivityMarkup(budgetRun));
  assert(consoleControls.visible <= 1, `default automation console controls: ${consoleControls.visible}`);
  assert(consoleControls.total <= 1, `default automation console controls total: ${consoleControls.total}`);
  const taskRailHtml = shotRender.html.toLowerCase();
  for (const label of ["inputs", "look &amp; blocking", "frames", "motion &amp; sound", "deliver"]) {
    assert(taskRailHtml.includes(label), `shot task rail is missing ${label}`);
  }
  assert.strictEqual((shotRender.html.match(/class="focused-task-button/g) || []).length, 5, "shot task rail must expose exactly five production stages");
  assert(/class="navigator-toggle"[^>]*aria-label="(?:Open|Close) project navigator"[^>]*aria-expanded="(?:true|false)"/.test(shotRender.html), "project navigator toggle must expose its accessible name and expanded state");
  assert.strictEqual((shotRender.html.match(/\bshot-primary-action\b/g) || []).length, 1, "shot route must render exactly one primary action");
  const shotActions = extractBalanced(shotRender.html, '<details class="guided-inline-actions', "details");
  for (const label of ["Rename shot", "Duplicate shot", "Import existing"]) assert(shotActions.includes(label), `Shot actions disclosure is missing ${label}`);
  for (const staleLabel of [">BUILD PROMPT<", ">IMPROVE<", ">USE AS GUIDE<"]) assert(!shotRender.html.includes(staleLabel), `shot route still uses mixed-case legacy label ${staleLabel}`);

  for (const [hash, type, backHref] of [["#/shot/DOES-NOT-EXIST","Shot","#/shots/board"],["#/scene/S99","Scene","#/shots/scenes"],["#/character/CH-NOPE","Character","#/library/characters"],["#/prop/PR-NOPE","Prop","#/library/props"]]) {
    const missing = await render(hash, fixture);
    assert(missing.html.includes('class="not-found-state"'), `${hash} must use the shared not-found state`);
    assert(missing.html.includes(`${type} not found`), `${hash} must name the missing record type`);
    assert(missing.html.includes(`href="${backHref}"`), `${hash} must link back to its list`);
  }

  const labels = new Set();
  for (const hash of ["#/production", "#/shots/board", "#/shots/scenes", "#/shot/L1-01", "#/library", "#/prop/PR-TOOL", "#/character/CH-KAI", "#/reports", "#/settings", "#/create"]) {
    const rendered = await render(hash, fixture);
    buttonLabels(rendered.html).forEach((label) => labels.add(label));
    assert.deepStrictEqual(inaccessibleButtonLabels(rendered.html), [], `${hash} rendered a glyph-only or empty button`);
  }
  const productionRender = await render("#/production", fixture);
  assert(productionRender.html.includes("PROJECT READINESS"), "Production must expose the shared read-only readiness roll-up");
  const reportsRender = await render("#/reports", fixture);
  assert(reportsRender.html.includes("Export production summary"), "Reports must expose the production summary export action");
  assert(labels.size <= 80, `distinct rendered button labels: ${labels.size}`);

  /* ---- the two aggregate runners must not diverge ----

     `npm run check:ci` and `npm run check` are separate lists maintained by hand, and
     they had silently drifted: twelve suites CI ran were missing from the full runner,
     so `npm run check` reported a pass while covering less. Rather than adding a third
     hand-maintained list, this derives the CI leaf set from package.json and requires
     the runner to account for every one of them.

     A suite is a leaf when its script does not chain other scripts; aggregates like
     check:continuity-core exist only to group leaves and are expanded rather than
     listed. */
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
  const runnerSource = fs.readFileSync(path.join(ROOT, "tests", "run-full-check.js"), "utf8");
  const declaredSuites = (arrayName) => {
    const body = runnerSource.split(`const ${arrayName} = [`)[1];
    assert(body, `run-full-check.js must declare ${arrayName}`);
    return body.split("];")[0].match(/"(check:[a-z0-9-]+)"/g)?.map((entry) => entry.slice(1, -1)) || [];
  };
  const runnerCovers = new Set([
    ...declaredSuites("nodeSuites"),
    ...declaredSuites("browserSuites"),
    ...declaredSuites("serialSuites"),
    ...declaredSuites("releaseSuites"),
  ]);
  const leavesOf = (name, seen = new Set()) => {
    const command = scripts[name];
    if (!command) return [name];
    const chained = [...command.matchAll(/npm run (check:[a-z0-9-]+)/g)].map((match) => match[1]);
    if (!chained.length) return [name];
    return chained.flatMap((child) => (seen.has(child) ? [] : (seen.add(child), leavesOf(child, seen))));
  };
  const ciLeaves = [...new Set(leavesOf("check:ci"))];
  assert(ciLeaves.length > 30, `expected check:ci to expand to many suites, got ${ciLeaves.length}`);
  const uncovered = ciLeaves.filter((suite) => !runnerCovers.has(suite));
  assert.deepStrictEqual(
    uncovered, [],
    `every suite check:ci runs must also be reachable from npm run check. Missing from tests/run-full-check.js: ${uncovered.join(", ")}`,
  );
  for (const suite of runnerCovers)
    assert(scripts[suite], `tests/run-full-check.js names "${suite}", which is not a package.json script`);

  console.log(`Current behavior suite passed navigation, single workflow, repository hygiene, golden-path controls <=7, control budgets ${controls.visible} shot / ${globalControls.visible} global chrome / ${consoleControls.visible} automation console, ${controls.total} reachable shot controls, and ${labels.size} distinct button labels.`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
