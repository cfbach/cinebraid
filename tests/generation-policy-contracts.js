/* CineBraid cost and governance contracts.
 *
 * Neither is implemented in this phase. Both are shapes that later work replaces, and
 * the reason they exist now is that getting them wrong later would be a contract
 * change rather than an implementation change.
 *
 * The one conceptual assertion worth stating plainly, because it is easy to get
 * backwards: local does not mean approved. A free render on your own GPU is subject
 * to exactly the same model, licence, origin and recipe checks as a paid one.
 * Governance is not a spend control, and if it is ever implemented as one, running a
 * prohibited model locally becomes the way around it.
 *
 * Pure module. No provider is called, and there is no runtime call site anywhere.
 */
const assert = require("assert");
const C = require("../src/generation/generation-contracts");

function codes(result) {
  return result.errors.map((error) => error.code);
}
function estimateOk(estimate, label) {
  const result = C.validateCostEstimate(estimate);
  assert(result.ok, `${label} must validate. Errors: ${JSON.stringify(result.errors)}`);
}
function estimateRejects(estimate, code, label) {
  const result = C.validateCostEstimate(estimate);
  assert(!result.ok, `${label} must be rejected`);
  assert(codes(result).includes(code), `${label} must be rejected with ${code}, got ${JSON.stringify(result.errors)}`);
}

/* =====================================================================
   1. CostEstimate — every class, every unit, every confidence.
   ===================================================================== */
estimateOk({ costClass: "free_local", unit: "none", amount: 0, confidence: "quoted", quotedAt: "2026-08-08T00:00:00Z", note: "Render-PC-1 · ~35 s · no external cost." },
  "a free local render");
estimateOk({ costClass: "free_local", unit: "none", amount: 0, confidence: "estimated" }, "a free local estimate");
estimateOk({ costClass: "metered_api", unit: "usd", amount: 0.32, confidence: "estimated" }, "a metered API estimate");
estimateOk({ costClass: "metered_credits", unit: "buzz", amount: 480, confidence: "quoted", quotedAt: "2026-08-08T00:00:00Z", expiresAt: "2026-08-08T00:05:00Z", balanceAfter: 11920 },
  "a quoted credit cost with an expiry and a resulting balance");
estimateOk({ costClass: "metered_partner", unit: "images", amount: 8, confidence: "estimated", balanceAfter: null },
  "a partner cost with an unknown resulting balance");
estimateOk({ costClass: "metered_api", unit: "videoSeconds", amount: 10, confidence: "estimated" }, "a metered video-seconds cost");
estimateOk({ costClass: "metered_credits", unit: "buzz", confidence: "unknown" }, "a metered cost nobody can price");

estimateOk({
  costClass: "metered_credits", unit: "buzz", amount: 480, confidence: "quoted",
  quotedAt: "2026-08-08T00:00:00Z",
  breakdown: [{ label: "base", amount: 400 }, { label: "4 candidates", amount: 80 }],
}, "a deterministic breakdown");

estimateRejects({ costClass: "free_local", unit: "usd", amount: 0, confidence: "estimated" },
  "contradiction", "a free render measured in dollars");
estimateRejects({ costClass: "free_local", unit: "none", amount: 5, confidence: "estimated" },
  "contradiction", "a free render that costs something");
estimateRejects({ costClass: "metered_api", unit: "usd", confidence: "estimated" },
  "missing", "an estimated cost with no amount");
estimateRejects({ costClass: "metered_api", unit: "usd", amount: 1, confidence: "unknown" },
  "contradiction", "an unknown cost that somehow carries an amount");
estimateRejects({ costClass: "metered_api", unit: "usd", amount: 1, confidence: "quoted" },
  "missing", "a quote with no time on it");
estimateRejects({ costClass: "metered_api", unit: "usd", amount: -1, confidence: "estimated" },
  "out-of-range", "a negative cost");
estimateRejects({ costClass: "gratis", unit: "usd", amount: 1, confidence: "estimated" },
  "unsupported-value", "an unknown cost class");
estimateRejects({ costClass: "metered_api", unit: "credits", amount: 1, confidence: "estimated" },
  "unsupported-value", "an unknown unit");
estimateRejects({ costClass: "metered_api", unit: "usd", amount: 1, confidence: "probably" },
  "unsupported-value", "an unknown confidence");
estimateRejects({
  costClass: "metered_api", unit: "usd", amount: 1, confidence: "estimated",
  breakdown: [{ label: "base" }],
}, "invalid-type", "a breakdown line with no amount");

/* The rule that matters later, recorded now so it cannot drift before the phase that
   enforces it: a metered job whose cost is UNKNOWN needs confirmation however small
   the number looks. Nothing enforces this in Phase 1 — nothing dispatches. */
assert.strictEqual(C.requiresExplicitAuthorization({ costClass: "free_local", unit: "none", amount: 0, confidence: "estimated" }), false,
  "a free local render needs no spend confirmation");
assert.strictEqual(C.requiresExplicitAuthorization({ costClass: "metered_credits", unit: "buzz", confidence: "unknown" }), true,
  "an unpriced metered job always needs confirmation");
assert.strictEqual(C.requiresExplicitAuthorization({ costClass: "metered_api", unit: "usd", amount: 0.32, confidence: "quoted" }), true,
  "a priced metered job needs confirmation");
assert.strictEqual(C.requiresExplicitAuthorization({ costClass: "metered_api", unit: "usd", amount: 0, confidence: "quoted" }), false,
  "a metered job quoted at zero does not");
assert.strictEqual(C.requiresExplicitAuthorization(null), true, "an absent estimate is treated as unknown");

/* =====================================================================
   2. Governance seam.
   ===================================================================== */
function job(overrides = {}) {
  return {
    jobId: "gen-1",
    target: { kind: "shot-frame", shotId: "SC-01-01" },
    outputType: "image", mode: "t2i",
    inputs: { prompt: "x" },
    model: { modelId: "z-image/turbo" },
    routing: { selection: "auto_local", policy: "local_only" },
    accounting: { costClass: "free_local" },
    governance: { dataClassification: "INTERNAL" },
    ...overrides,
  };
}

/* Community is permissive. */
const permissive = C.resolveGovernance(job(), {
  model: { id: "z-image/turbo" }, backend: { id: "comfy" }, node: { id: "render-pc-1" },
  recipe: { recipeId: "zimage-turbo-t2i", recipeHash: "sha256:9c1e" },
  account: null, classification: "INTERNAL", aiPolicy: "project-default",
});
assert.strictEqual(permissive.allowed, true, "Community allows by default");
assert.strictEqual(permissive.policyId, "community-permissive-v1");
assert.deepStrictEqual(permissive.reasons, []);
assert.strictEqual(permissive.classification, "INTERNAL");

/* The one existing product rule that denies. */
const disabled = C.resolveGovernance(job(), { aiPolicy: "disabled", classification: "INTERNAL" });
assert.strictEqual(disabled.allowed, false, "a project with AI switched off generates nothing");
assert.strictEqual(disabled.reasons[0].code, "PROJECT_AI_DISABLED");
assert(disabled.reasons[0].message && disabled.reasons[0].action, "a denial explains itself and says what to do");

/* THE conceptual assertion. A free local render is denied by exactly the same rule as
   a paid one: cost is not the question governance is asking. */
const freeLocal = job({
  routing: { selection: "auto_local", policy: "local_only" },
  accounting: { costClass: "free_local" },
});
const deniedLocal = C.resolveGovernance(freeLocal, { aiPolicy: "disabled", classification: "INTERNAL" });
assert.strictEqual(deniedLocal.allowed, false,
  "local and free must not imply approved — running a prohibited model on your own GPU is still running it");
const deniedPaid = C.resolveGovernance(
  job({ routing: { selection: "backend", backendId: "fal", policy: "allow_paid_fallback" }, accounting: { costClass: "metered_api" } }),
  { aiPolicy: "disabled", classification: "INTERNAL" },
);
assert.deepStrictEqual(
  deniedLocal.reasons.map((reason) => reason.code),
  deniedPaid.reasons.map((reason) => reason.code),
  "the same policy must produce the same reasons whether the render is free or paid",
);

/* The resolver takes the whole tuple, so a future implementation can restrict on any
   of it without a contract change. None of these restrict anything today. */
const fullContext = C.resolveGovernance(job(), {
  model: { id: "z-image/turbo", vendor: "Tongyi Lab", license: null, origin: null, openWeights: true },
  backend: { id: "comfy", executionKind: "local_native" },
  node: { id: "render-pc-1", trustClass: "lan_approved", orchestratorLocation: "trusted_lan" },
  recipe: { recipeId: "zimage-turbo-t2i", version: 1, recipeHash: "sha256:9c1e", trustLevel: "OFFICIAL" },
  account: { connectionId: "acct-civitai-1", contractProfileId: "studio-no-training" },
  classification: "CONFIDENTIAL",
  aiPolicy: "project-default",
});
assert.strictEqual(fullContext.allowed, true, "Community ignores restrictions it does not implement");
assert.strictEqual(fullContext.classification, "CONFIDENTIAL", "the resolved classification is reported back");

/* Classification travels on the job when the caller does not override it. */
assert.strictEqual(
  C.resolveGovernance(job({ governance: { dataClassification: "RESTRICTED" } }), {}).classification,
  "RESTRICTED",
);
assert.strictEqual(C.resolveGovernance(job({ governance: {} }), {}).classification, "INTERNAL",
  "INTERNAL is the default, not PUBLIC");
const unknownClass = C.resolveGovernance(job(), { classification: "COSMIC" });
assert.strictEqual(unknownClass.allowed, false, "an unrecognised classification fails closed");
assert.strictEqual(unknownClass.reasons[0].code, "UNKNOWN_CLASSIFICATION");

/* =====================================================================
   3. Data classification.
   ===================================================================== */
assert.deepStrictEqual(C.DATA_CLASSIFICATIONS, ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);

/* Derived media inherits the HIGHEST classification among its parents. A shot that
   references a restricted sheet does not produce internal output, and this is the
   only reason the ancestry graph is worth having before Enterprise exists. */
assert.strictEqual(C.highestClassification(["PUBLIC", "INTERNAL"]), "INTERNAL");
assert.strictEqual(C.highestClassification(["INTERNAL", "RESTRICTED", "PUBLIC"]), "RESTRICTED");
assert.strictEqual(C.highestClassification(["CONFIDENTIAL", "INTERNAL"]), "CONFIDENTIAL");
assert.strictEqual(C.highestClassification([]), "PUBLIC", "nothing at all is public");
assert.strictEqual(C.highestClassification(["NONSENSE"]), "PUBLIC", "an unknown value cannot raise the level");
assert.strictEqual(C.highestClassification(["NONSENSE", "RESTRICTED"]), "RESTRICTED");
/* Order must not matter. */
assert.strictEqual(
  C.highestClassification(["RESTRICTED", "PUBLIC"]),
  C.highestClassification(["PUBLIC", "RESTRICTED"]),
);

/* =====================================================================
   4. Execution and trust vocabulary — three axes, never one enum.
   ===================================================================== */
assert.deepStrictEqual(C.EXECUTION_LOCATIONS,
  ["same_host", "trusted_lan", "remote_private", "hosted_partner", "hosted_api", "remote_public"]);
assert.deepStrictEqual(C.EXECUTION_KINDS, ["local_native", "comfy_partner", "hosted_api"]);
assert.deepStrictEqual(C.TRUST_CLASSES,
  ["loopback", "lan_approved", "lan_unapproved", "remote_credentialed", "remote_public"]);

/* The axes must stay three distinct vocabularies. A location is not a trust level:
   where work runs and whether CineBraid will send project media there are different
   questions, and an address answers only the first. 192.168.x.x is a trusted_lan
   ADDRESS and a lan_unapproved TRUST until an operator says otherwise. */
const axes = { locations: C.EXECUTION_LOCATIONS, kinds: C.EXECUTION_KINDS, trust: C.TRUST_CLASSES };
for (const [a, left] of Object.entries(axes))
  for (const [b, right] of Object.entries(axes))
    if (a < b)
      assert.notDeepStrictEqual(left, right, `${a} and ${b} must not be the same vocabulary`);

/* Two strings deliberately appear on more than one axis, and mean different things on
   each. They are listed explicitly so a future addition cannot quietly join them and
   re-collapse the model by accident. */
const SHARED_ACROSS_AXES = new Set(["hosted_api", "remote_public"]);
for (const value of C.EXECUTION_LOCATIONS)
  if (C.TRUST_CLASSES.includes(value) || C.EXECUTION_KINDS.includes(value))
    assert(SHARED_ACROSS_AXES.has(value),
      `"${value}" appears on more than one axis without being a known deliberate overlap`);
assert(C.EXECUTION_LOCATIONS.includes("hosted_api") && C.EXECUTION_KINDS.includes("hosted_api"),
  "hosted_api is both a place inference happens and a kind of execution");
assert(C.EXECUTION_LOCATIONS.includes("remote_public") && C.TRUST_CLASSES.includes("remote_public"),
  "remote_public is both a location and the trust level that location implies");
assert(!C.EXECUTION_KINDS.includes("trusted_lan") && !C.TRUST_CLASSES.includes("trusted_lan"),
  "trusted_lan is a location only — a LAN address does not grant trust");
assert(C.TRUST_CLASSES.includes("lan_unapproved") && !C.EXECUTION_LOCATIONS.includes("lan_unapproved"),
  "approval is a trust decision with no corresponding location");

assert.deepStrictEqual(C.COST_CLASSES, ["free_local", "metered_partner", "metered_api", "metered_credits"]);
assert(C.JOB_STATUSES.includes("unresolved"), "the ambiguous submission state must exist from the first contract");
assert(C.JOB_STATUSES.includes("importing"), "import is a state a crash can happen in");
for (const terminal of C.TERMINAL_JOB_STATUSES)
  assert(C.JOB_STATUSES.includes(terminal), `${terminal} must be a job status`);
assert(!C.TERMINAL_JOB_STATUSES.includes("unresolved"),
  "unresolved is not terminal — it is the state nobody may auto-resubmit from");

console.log(
  "Generation policy contract suite passed: every cost class, unit and confidence round-trips, an unpriced "
  + "metered job always requires authorization, governance denies a free local render on exactly the same "
  + "grounds as a paid one, classification inherits upward, and location, execution kind and trust stay three axes.",
);
