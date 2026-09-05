/* Negative controls for Civitai Foothold V1.
 *
 * A regression suite that has never failed is a claim, not evidence. Each control below
 * reintroduces exactly ONE of the defects this slice exists to prevent, and asserts that
 * the REAL guard — the same function tests/civitai-integration.js runs in the green path,
 * not a restatement of it — fails.
 *
 *   NC-1   the permit stops binding the provider request, so a quote for request A
 *          authorizes the submission of request B
 *   NC-2   the dispatch boundary stops recomputing the request digest before it spends
 *   NC-3   the recorded cost is the figure the CALLER sent rather than the one the server
 *          obtained from Civitai
 *   NC-4   the approved-price ceiling is removed, so a risen price is paid silently
 *   NC-5   a remote success CineBraid could not download is recorded as delivered
 *   NC-6   a LAN caller can steer a paid request
 *   NC-7   an identity-only connection can spend Buzz
 *   NC-8   a returned candidate arrives already approved
 *   NC-9   an expired workflow is recorded as a plain failure
 *   NC-10  a provider-supplied result address is fetched wherever it points
 *   NC-11  Buzz is recorded in the units a US-dollar backend uses
 *   NC-12  Connect asks for permission to spend, breaking the promise Settings prints
 *   NC-13  a scope CineBraid cannot read is treated as permission to spend
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Each defect is introduced
 * by compiling a MODIFIED COPY of the real source in memory and installing it in the
 * module cache before the routes are built, so the running code IS the broken code.
 *
 * AN EXCEPTION IS NOT PROOF A CONTROL RAN. Every mutation carries a receipt: the anchor
 * must exist, must be unique, and must actually change the source. A control that silently
 * matched nothing would report itself green while proving nothing, which is the failure
 * mode this file exists to avoid — so `applied` is asserted non-empty for every control.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const Suite = require("./civitai-integration");

const notes = [];
const note = (line) => notes.push(line);
let applied = [];

/* Normalised to LF before matching. Anchors span lines, and on a Windows checkout with
   core.autocrlf on they would arrive as \r\n — the anchor would not match, the control
   would report itself as stale, and the failure would look like a source change rather
   than a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function mutateOnce(source, needle, replacement, label) {
  assert(source.includes(needle), `${label}: the anchor no longer exists; this control must be updated, not deleted:\n${needle}`);
  assert.strictEqual(source.split(needle).length - 1, 1, `${label}: the anchor must be unique:\n${needle}`);
  const next = source.replace(needle, replacement);
  assert.notStrictEqual(next, source, `${label}: the edit changed nothing, so the control would test the real code`);
  return next;
}

/* Compile a modified copy of a real module IN MEMORY and install it in the cache, so the
   routes built afterwards are built on the defect. */
function installBroken(relative, transform, label) {
  const filename = require.resolve(path.join(ROOT, relative));
  const source = transform(readLF(filename), label);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  require.cache[filename] = compiled;
  compiled._compile(source, filename);
  compiled.loaded = true;
  applied.push(`${label} -> ${relative}`);
}

/* Run the whole positive suite with one module broken, and require it to fail.
 *
 * The suite is re-required fresh each time because it captures nothing at load, and the
 * MUTATE seam is what makes the defect survive the harness's own cache eviction — main()
 * builds many harnesses and each one clears the Civitai modules, so a control that
 * installed a broken copy only once would be testing the real code by the second harness. */
async function control({ id, label, guards, mutate }) {
  applied = [];
  delete require.cache[require.resolve("./civitai-integration")];
  const suite = require("./civitai-integration");
  suite.MUTATE = mutate;
  let detected = null;
  const log = console.log;
  console.log = () => {};
  try {
    await suite.main();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = error;
  } finally {
    console.log = log;
    suite.MUTATE = null;
    delete require.cache[require.resolve("./civitai-integration")];
  }
  assert(applied.length, `${id}: no mutation was applied, so nothing below proves anything`);
  assert(detected, `NEGATIVE CONTROL ${id} FAILED: with "${label}" reintroduced, the suite still passed. It cannot detect the defect it exists for.`);
  note(`${id}: ${label} -> caught by "${guards}" (${String(detected.message).split("\n")[0].slice(0, 110)})`);
}

async function main() {
  /* -------------------------------------------------------------------------
     NC-1 — the permit stops binding the provider request.

     This is the generic seam change, removed. Without requestFingerprint in the permit's
     scope, the digest of the body is not part of what was authorized, and a quote obtained
     for one prompt authorizes the submission of another. */
  await control({
    id: "NC-1",
    label: "the paid permit's scope no longer carries the provider request digest",
    guards: "the binding — a mutation after authorization must be refused at dispatch",
    mutate: () => installBroken("paid-dispatch-permit.js", (source, label) => mutateOnce(
      source,
      'const SCOPE_FIELDS = ["purpose", "surface", "viewMode", "shotId", "frameId", "entityList", "entityId", "buildId", "requestFingerprint"];',
      'const SCOPE_FIELDS = ["purpose", "surface", "viewMode", "shotId", "frameId", "entityList", "entityId", "buildId"];',
      label,
    ), "NC-1"),
  });

  /* -------------------------------------------------------------------------
     NC-2 — the dispatch boundary stops recomputing the digest.

     The permit still carries it; the boundary simply stops checking. A mutation is then
     caught only by the authorize route, which the browser is free not to call. */
  await control({
    id: "NC-2",
    label: "the dispatch boundary no longer recomputes the request digest before spending",
    guards: "the binding — a mutation after authorization must be refused at dispatch",
    mutate: () => installBroken("civitai-generation.js", (source, label) => mutateOnce(
      source,
      'if (PaidPermit.paidScopeFingerprint(dispatchScopeFor(req.body, built.fingerprint)) !== text(membership.scopeFingerprint))',
      'if (false && PaidPermit.paidScopeFingerprint(dispatchScopeFor(req.body, built.fingerprint)) !== text(membership.scopeFingerprint))',
      label,
    ), "NC-2"),
  });

  /* -------------------------------------------------------------------------
     NC-3 — the recorded cost becomes the caller's claim.

     The number a filmmaker reads afterwards must be the number Civitai gave the server,
     not one that arrived on the wire. This is the same principle shared-generation-rate.js
     holds for fal: the quote and the record derive from one source, or they drift. */
  await control({
    id: "NC-3",
    label: "the durable cost is taken from the request body instead of from Civitai",
    guards: "the recorded figure is the one the SERVER obtained, not the one the caller sent",
    mutate: () => installBroken("civitai-generation.js", (source, label) => mutateOnce(
      source,
      "const quote = { amount: fresh.amount, quotedAt: at };",
      "const quote = { amount: Number(req.body?.authorizedAmount), quotedAt: at };",
      label,
    ), "NC-3"),
  });

  /* -------------------------------------------------------------------------
     NC-4 — the ceiling is removed and a risen price is paid silently. */
  await control({
    id: "NC-4",
    label: "a price higher than the one a person approved is submitted anyway",
    guards: "a price that rose past the approved figure must refuse",
    mutate: () => installBroken("civitai-generation.js", (source, label) => mutateOnce(
      source,
      "if (fresh.amount > approved)",
      "if (false && fresh.amount > approved)",
      label,
    ), "NC-4"),
  });

  /* -------------------------------------------------------------------------
     NC-5 — a remote success CineBraid could not download is called delivered.

     The most expensive lie available to this integration: the record says a paid result
     was delivered, `ingestedAt` is stamped, and the bytes are nowhere. */
  await control({
    id: "NC-5",
    label: "a materialization failure after a remote success is recorded as COMPLETED",
    guards: "a remote success CineBraid could not materialize is neither COMPLETED nor FAILED",
    mutate: () => installBroken("civitai-generation.js", (source, label) => mutateOnce(
      source,
      "          row.status = ledgerStatus(Lifecycle.UNRESOLVED);\n          row.error = `Civitai finished this generation, but CineBraid could not download the result:",
      "          row.status = ledgerStatus(\"COMPLETED\");\n          row.ingestedAt = nowIso();\n          row.error = `Civitai finished this generation, but CineBraid could not download the result:",
      label,
    ), "NC-5"),
  });

  /* -------------------------------------------------------------------------
     NC-6 — a LAN caller can steer a paid request.

     The ComfyUI lesson, one category more expensive: there, a LAN peer could steer a free
     local render; here it could steer the operator's money. */
  await control({
    id: "NC-6",
    label: "the Civitai routes answer a non-loopback peer",
    guards: "every Civitai route refuses a real non-loopback peer",
    mutate: () => installBroken("civitai-generation.js", (source, label) => mutateOnce(
      source,
      "  function requireLocalMachine(req, res) {\n    if (isLoopbackRequest(req)) return true;",
      "  function requireLocalMachine(req, res) {\n    if (true) return true;\n    if (isLoopbackRequest(req)) return true;",
      label,
    ), "NC-6"),
  });

  /* -------------------------------------------------------------------------
     NC-7 — an identity-only connection can spend.

     Settings promises, in the panel a person reads before pressing Connect, that
     connecting "generates nothing and spends nothing". This removes the check that makes
     the promise true. */
  await control({
    id: "NC-7",
    label: "a connection granted identity only is allowed to spend Buzz",
    guards: "an identity-only connection refuses before any provider contact",
    mutate: () => installBroken("civitai-generation.js", (source, label) => mutateOnce(
      source,
      "if (requireGeneration && isOAuth && !CivitaiProvider.hasGenerationGrant(grantedScope))",
      "if (false && requireGeneration && isOAuth && !CivitaiProvider.hasGenerationGrant(grantedScope))",
      label,
    ), "NC-7"),
  });

  /* -------------------------------------------------------------------------
     NC-8 — a returned candidate arrives approved.

     Patched in the SHARED writer, deliberately: that is the file whose whole point is that
     "a returned result is a proposal", and a Civitai-local copy of the rule would prove
     only that the copy exists. */
  await control({
    id: "NC-8",
    label: "a returned result is written as an approved candidate",
    guards: "the result is an unreviewed candidate — nothing is approved by arriving",
    mutate: () => installBroken("generation-candidate-ingest.js", (source, label) => mutateOnce(
      source,
      '    decision: "unreviewed",',
      '    decision: "approved",',
      label,
    ), "NC-8"),
  });

  /* -------------------------------------------------------------------------
     NC-9 — `expired` is recorded as a plain failure.

     Civitai lists `expired` as terminal, but it means the RESULT expired — Buzz may
     already have been spent. Calling it FAILED invites the one action that pays twice. */
  await control({
    id: "NC-9",
    label: "an unrecognised or expired remote state is recorded as FAILED",
    guards: "a state this product has no word for is UNRESOLVED, not a guess",
    mutate: () => installBroken("civitai-generation.js", (source, label) => mutateOnce(
      source,
      "    default:\n      return ledgerStatus(Lifecycle.UNRESOLVED);",
      '    default:\n      return ledgerStatus("FAILED");',
      label,
    ), "NC-9"),
  });

  /* -------------------------------------------------------------------------
     NC-10 — the one address CineBraid does not choose is followed anywhere. */
  await control({
    id: "NC-10",
    label: "a provider-supplied result address is fetched wherever it points",
    guards: "a result address cannot be a file, a private range or a link-local address",
    mutate: () => installBroken("civitai-client.js", (source, label) => mutateOnce(
      source,
      "  if (MOCK_ORCHESTRATOR && (url.protocol === \"http:\" || url.protocol === \"https:\") && loopbackHostname(url.hostname)) return url;",
      "  return url;",
      label,
    ), "NC-10"),
  });

  /* -------------------------------------------------------------------------
     NC-11 — Buzz is recorded in the unit a US-dollar backend uses.

     The second generic seam change, undone at its source: if the estimate says `usd`, the
     summary adds it to the dollar total and a ten-Buzz render becomes ten dollars. */
  await control({
    id: "NC-11",
    label: "a quoted Buzz cost is recorded with the unit a dollar-priced backend uses",
    guards: "Buzz is recorded as Buzz and never lands in the US dollar total",
    mutate: () => installBroken("civitai-generation.js", (source, label) => mutateOnce(
      source,
      'const CIVITAI_COST_UNIT = "buzz";',
      'const CIVITAI_COST_UNIT = "usd";',
      label,
    ), "NC-11"),
  });

  /* -------------------------------------------------------------------------
     NC-12 — Connect asks for permission to spend.

     The product rule O3 settled, removed at its source: `buildAuthorization` ignores the
     grant word and always sends the wide scope, so pressing "Connect Civitai" would put a
     person in front of a consent screen asking for permission to spend their Buzz — while
     the Settings panel above the button still promises that connecting spends nothing. */
  await control({
    id: "NC-12",
    label: "Connect asks for the spending scope instead of identity only",
    guards: "Connect asks scope 1; spending is a separate grant",
    mutate: () => installBroken("account-provider-civitai.js", (source, label) => mutateOnce(
      source,
      'const AUTHORIZATION_GRANTS = { identity: PHASE_SCOPE, generation: GENERATION_SCOPE };',
      'const AUTHORIZATION_GRANTS = { identity: GENERATION_SCOPE, generation: GENERATION_SCOPE };',
      label,
    ), "NC-12"),
  });

  /* -------------------------------------------------------------------------
     NC-13 — an unreadable scope is read as permission.

     `hasGenerationGrant` fails OPEN. A connection whose grant CineBraid cannot parse —
     older than this code, or malformed — would be treated as allowed to spend, and the
     discovery would happen at the provider, after a permit had been minted. */
  await control({
    id: "NC-13",
    label: "a scope CineBraid cannot read is treated as permission to spend",
    guards: "an unreadable scope is never a yes",
    mutate: () => installBroken("account-provider-civitai.js", (source, label) => mutateOnce(
      source,
      '  if (!/^\\d+$/.test(raw)) return false;',
      '  if (!/^\\d+$/.test(raw)) return true;',
      label,
    ), "NC-13"),
  });

  /* The real modules, green, after every control has been undone. */
  for (const key of Object.keys(require.cache))
    if (/civitai-(client|workflow|generation)\.js$|account-provider-civitai\.js$|paid-dispatch-permit\.js$|generation-candidate-ingest\.js$/.test(key))
      delete require.cache[key];
  delete require.cache[require.resolve("./civitai-integration")];
  const log = console.log;
  console.log = () => {};
  try {
    await require("./civitai-integration").main();
  } finally {
    console.log = log;
  }

  console.log([
    `Civitai Foothold V1 negative controls passed: ${notes.length} deliberate defects reintroduced in memory — every one detected by the property that guards it, and the real modules green afterwards. Nothing was written to disk, nothing was reverted with git, and no real Buzz was spent.`,
    ...notes.map((line) => `  - ${line}`),
  ].join("\n"));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
module.exports = { main };
