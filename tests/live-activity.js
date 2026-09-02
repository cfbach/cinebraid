const assert = require("assert");
const fs = require("fs");
const path = require("path");
const RELEASE_VERSION = require("../package.json").version;
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

/* Comments are stripped wherever this file asks "is that gone?". live-activity.js
   carries a retirement note that names the strip it retired, which is what a reader
   needs and exactly what an absence grep must not trip over. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

const index = read("public/index.html");
const automation = read("public/automation.js");
const scene = read("public/scene-automation.js");
const activity = read("public/live-activity.js");
const styles = read("public/styles.css");
const creation = read("public/creation-studio.js");
const review = read("public/review.js");
const provenance = read("public/review-provenance.js");
const sceneReview = read("public/scene-review.js");
const server = read("server.js");
const audioBuilder = read("public/audio-prompt-builder.js");

assert(index.includes('id="automation-activity-toggle"'), "topbar must expose the global activity button");
/* A1 retired the Global Activity drawer as an owner. Inverted rather than removed:
   an absent assertion would not notice the element coming back. */
assert(!index.includes('id="automation-activity-drawer"'), "the retired Global Activity drawer must not be in the workspace");
assert(index.includes(`live-activity.js?v=${RELEASE_VERSION}`), "live activity module must be cache-busted and loaded");
assert(index.indexOf(`scene-automation.js?v=${RELEASE_VERSION}`) < index.indexOf(`live-activity.js?v=${RELEASE_VERSION}`), "activity module must load after automation modules");
assert(automation.includes("v641SetStepActivity"), "durable automation must persist operation-level activity");
assert(automation.includes("No paid request has been submitted yet"), "FAL preparation must distinguish pre-paid work");
assert(automation.includes("providerAccepted: true"), "accepted FAL requests must be visible");
assert(automation.includes("reviewProgress"), "review progress must be persisted");
/* BATCH 2, SLICE 1 — WORKING PAGES SHOW A COMPACT RUN STATE, NOT A TIMELINE.
   v626AutomationPanel is the single source the six automation panels share, so this
   one assertion covers all six: shot, blocking, asset, entity-state, entity-chain and
   scene. The drawer still owns the detail. */
assert(automation.includes('typeof v670CompactRunStatusMarkup === "function" ? v670CompactRunStatusMarkup(run)'), "automation panels must render the compact run status");
assert(!codeOnly(automation).includes("v641LiveActivityMarkup"), "no automation panel may embed the full live timeline in a working page");
assert(!codeOnly(scene).includes("v641LiveActivityMarkup"), "the scene automation panel must not embed the full live timeline either");
assert(scene.includes("v641ReviewSceneCorrectionIncremental"), "scene correction reviews must update candidate-by-candidate");
assert(scene.includes("child run active"), "scene parent runs must expose their child-shot activity");
assert(activity.includes("LIVE AUTOMATION ACTIVITY"), "activity module must render current operation detail");
assert(activity.includes("PAID REQUEST ACCEPTED"), "provider state must clearly identify paid acceptance");
assert(activity.includes("PREPARING · NO CREDITS SUBMITTED"), "provider state must clearly identify pre-submission work");
assert(activity.includes("v641StandaloneFalJobs"), "manual FAL jobs must appear globally");
assert(activity.includes("v641StartManualActivity"), "manual AI and review calls must be globally visible");
assert(styles.includes(".automation-activity-drawer"), "activity drawer must have dedicated responsive styling");
assert(creation.includes("v641StartManualActivity"), "manual prompt-advisor calls must register global activity");
assert(review.includes("v641StartManualActivity"), "manual vision review must register global activity");
assert(provenance.includes("v641StartManualActivity"), "manual candidate review must register global activity");
assert(sceneReview.includes("v641StartManualActivity"), "manual scene review must register global activity");
assert(activity.includes("v642InstallUniversalActivityFetch"), "unwrapped AI and FAL calls must be captured by universal activity visibility");
/* ===========================================================================
   BATCH 2, SLICE 1 — EXACTLY ONE PERSISTENT GLOBAL ACTIVITY INDICATOR.

   #automation-activity-toggle (the topbar chip) and #automation-global-live-strip (a
   floating pill) rendered the IDENTICAL v6602ActivityStatus() answer. Two persistent
   global indicators for one derivation is two places to look for one sentence, and
   the strip shared the bottom of the screen with the Activity Terminal.

   The strip is retired. These assertions are written as an ABSENCE plus a COUNT so
   that neither bringing the strip back nor adding a third indicator can pass. */
const activityCode = codeOnly(activity);
assert(!activityCode.includes("automation-global-live-strip"), "the floating global live strip must not be rebuilt");
assert(!activityCode.includes("v642EnsureGlobalActivityStrip"), "the retired strip's factory must be gone");
assert(!activityCode.includes("v642UpdateGlobalActivityStrip"), "the retired strip's updater must be gone");
assert(!/insertBefore\(\s*strip/.test(activityCode), "live-activity.js must not insert a persistent banner into the workspace");
assert(!read("public/styles.css").includes("automation-global-live-strip"), "the retired strip must leave no styling behind");

/* THE COUNT. A persistent global indicator is a control that lives in the shipped
   chrome and reads v6602ActivityStatus(). There is one, and it is the topbar chip. */
const persistentIndicators = (activityCode.match(/v6602ActivityStatus\(\)/g) || []).length;
assert.strictEqual(persistentIndicators, 3,
  `v6602ActivityStatus() has ${persistentIndicators} occurrences; expected exactly three — its own definition, the single topbar chip that renders it, and the visually-hidden live region that speaks it`);
/* THE ANNOUNCEMENT IS A REAL ARIA LIVE REGION, not a JavaScript event. The retired
   strip carried aria-live as a side effect of being visible; the two are now separate
   mechanisms and only one of them has pixels. */
assert(activityCode.includes('document.getElementById("activity-live-region")'), "the announcer must write a real aria-live region");
assert(read("public/index.html").includes('id="activity-live-region"'), "the live region must be shipped chrome, not built by script");
assert(/aria-live="polite"[^>]*>|role="status"/.test(read("public/index.html")), "the live region must carry live-region semantics");
assert(activityCode.includes('document.getElementById("automation-activity-toggle")'), "the topbar chip must remain the one persistent global indicator");

/* THE ARIA-LIVE ANNOUNCEMENT SURVIVED THE STRIP. It was a separate mechanism that
   happened to sit beside it, and it is what the persistent creator surfaces repaint
   from — removing it would take away the app's only spoken notice that work changed. */
assert(activityCode.includes("function v670AnnounceActivityUpdate"), "the aria-live activity announcement must survive the strip's removal");
assert(activityCode.includes('new CustomEvent("cinebraid:activity-updated")'), "the activity announcement must still be dispatched");
assert(/v641UpdateActivityButton[\s\S]{0,1400}?v670AnnounceActivityUpdate\(\);/.test(activityCode),
  "every activity update must still end by announcing itself");

/* THE COMPACT STATE BORROWS ITS CLASSIFICATION AND DECIDES NOTHING. */
const compact = activityCode.slice(activityCode.indexOf("window.v670CompactRunStatusMarkup"));
const compactBody = compact.slice(0, compact.indexOf("\n};"));
assert(/v670RunTone\(run\)/.test(compactBody), "the compact run state must take its tone from the drawer row's own tone function");
assert(/v670MachineActiveRun\(run\)/.test(compactBody) && /v670WaitingForHumanRun\(run\)/.test(compactBody),
  "the compact run state must read the shipped activity predicates");
assert(/v670RunHeadline\(run\)/.test(compactBody), "the compact run state must print the same sentence the drawer row prints");
assert(!/run\.status/.test(compactBody),
  "the compact run state must never read run.status: a second reading of a raw status is a second classifier");
assert(!/approve|Approve|APPROVE|retryFailedAutomationStep|resumeAutomationRun|openFalGenerationModal/.test(compactBody),
  "no approval, recovery or paid control may move into the compact working-page status");

/* AND IT IS THE DRAWER ROW'S OWN SENTENCE, not a copy of it. */
assert(activityCode.includes("esc(v670RunHeadline(run))"), "the drawer row must print the shared headline");
assert.strictEqual((activityCode.match(/function v670RunHeadline/g) || []).length, 1, "there must be exactly one headline function");

/* RESULT HAND-OFF. Built from the declared stage model's own panel vocabulary. */
assert(activityCode.includes("shotStageForPanel(panel)"), "result routing must ask the declared stage model which stage owns a panel");
assert(activityCode.includes("shotStagePanelView(panel)"), "result routing must use the declared panel sub-view vocabulary");
assert(activityCode.includes("window.v670RunResultTarget"), "a completed run must be able to resolve a panel/stage-qualified result target");
assert(activityCode.includes("resolved: false"), "result routing must fall back to the workspace route rather than guessing");
assert(activityCode.includes("openRunResult"), "the drawer must hand off through the result opener");
assert(scene.includes("Continue from current scene"), "scene planning must support resume-aware continuation");
assert(scene.includes("reviewOnly"), "scene planning must support review-only continuation");
assert(audioBuilder.includes("buildSceneAudioPrompts"), "scene audio prompts must have a visible AI build workflow");
assert(server.includes("/api/llm/build-scene-audio-prompts"), "server must expose the scene audio prompt builder endpoint");

/* A1: the drawer sections are retired. The separation is now the shipped predicates',
   and this file must keep asking them rather than re-deriving the split. */
assert(activity.includes("filter(v670MachineActiveRun)") && activity.includes("filter(v670WaitingForHumanRun)"),
  "the activity layer must separate active work from human gates through the shipped predicates");
assert(activity.includes("NEEDS ATTENTION"), "activity drawer must separate failed and blocked work");
assert(!activity.includes("DIAGNOSTIC ZIP"), "activity drawer must not retain diagnostic export controls");
assert(!activity.includes("COPY SUMMARY"), "activity drawer must not retain support-summary export controls");
assert(!activity.includes("FLAG INEFFICIENT"), "activity drawer must not retain efficiency-report controls");
/* A1: VIEW REPORT moved with the other drawer-only affordances to the Activity
   Terminal row, which is now the owner. Reports still owns the evidence. */
assert(read("public/creator-surfaces.js").includes("VIEW REPORT"),
  "activity rows must link to the dedicated Reports route");
/* A1: the drawer carried a SECOND copy of the run actions. That duplicate is gone —
   which is the point — and the capability lives where it always really lived, with
   v626RunActions, the only owner that holds the run's type/targetId/scope and lease. */
assert(read("public/automation.js").includes("REPAIR & RETRY"),
  "scene correction failures must expose repair-and-retry from the task-local run actions");
assert(index.includes('data-view="reports"'), "the primary navigation must expose Reports");
assert(index.includes(`reports.js?v=${RELEASE_VERSION}`), "the Reports module must be loaded and cache-busted");

console.log("Live automation activity suite passed global drawer, universal AI/FAL capture, ONE persistent global activity indicator with the aria-live announcement intact, compact working-page run state with no embedded timeline, panel/stage-qualified result hand-off, resume-aware scene planning, audio prompt activity, nested child runs, incremental correction review progress, recovery actions, and work/report separation.");
