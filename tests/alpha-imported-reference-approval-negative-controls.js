/* ALPHA IMPORTED-REFERENCE APPROVAL — NEGATIVE CONTROLS.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each
 * control below reintroduces exactly ONE of the mechanisms behind the reproduced
 * failure — IN MEMORY, through the render harness's `mutateSource` hook, so
 * nothing on disk is touched — observes the defect behaviourally, and only then
 * requires the guarding claim to go red.
 *
 * Every control carries a PROBE RECEIPT: it asserts its anchor is present in the
 * live source exactly once before mutating. A control whose anchor has drifted is
 * a control that is quietly mutating nothing, and it fails loudly here rather
 * than reporting a success it never earned.
 *
 * NC-1  Approve with the SCAN's identity instead of the prepared one. This is the
 *       original defect: a fresh import is listed with no assetId, so the receipt
 *       carried an empty identity.
 * NC-2  Enable confirmation without a prepared identity. The button was live the
 *       moment the modal opened, which is what let NC-1 be reached at all.
 * NC-3  Announce the approval on dirty() instead of on durable acceptance. This
 *       is what told the filmmaker a refused approval had been saved.
 * NC-4  Rename the approved candidate to a production name inside the approval.
 *       This is the destructive half: the bytes moved before authority accepted.
 * NC-5  Dispatch queued snapshots while an approval outcome is unresolved.
 *
 * NO PROVIDER CALL IS MADE. NOTHING OUTSIDE THIS PROCESS IS WRITTEN.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { render, buildFixture, harnessAssetId, settleApprovalReadiness, HARNESS_PROJECT_REVISION } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const SLUG = "fixture";
const CANDIDATE = "PR-TOOL-CANDIDATE-MK1-01.png";

let checks = 0;

function readLF(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}
/* THE PROBE RECEIPT. A control that no longer matches the live source is not a
   passing control; it is a control that stopped running. */
function anchorIn(file, needle, label, expected = 1) {
  checks += 1;
  const hits = readLF(file).split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor in ${file}, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
}
function replacing(file, needle, replacement) {
  return (name, contents) => {
    if (name !== file) return contents;
    return String(contents).replace(/\r\n/g, "\n").split(needle).join(replacement);
  };
}
/* Some mechanisms are two lines in two places — the pre-fix build both READ the
   identity from the scan listing and had nothing that noticed the listing
   disagreeing with a prepared one. Restoring one mechanism may therefore need
   more than one edit; what must stay true is that it restores ONE mechanism. */
function replacingMany(file, pairs) {
  return (name, contents) => {
    if (name !== file) return contents;
    let out = String(contents).replace(new RegExp(String.fromCharCode(13, 10), "g"), String.fromCharCode(10));
    for (const [needle, replacement] of pairs) out = out.split(needle).join(replacement);
    return out;
  };
}
/* Runs the body and requires it to throw, mentioning `because`. */
async function mustFail(label, because, body) {
  checks += 1;
  let failure = null;
  try { await body(); } catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
}
async function drain(turns = 220) {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setImmediate(resolve));
}

function importedFixture() {
  const project = buildFixture();
  const prop = project.props[0];
  prop.approvedFile = "";
  prop.approvedAssetId = "";
  prop.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "", notes: "Primary approved reference." }];
  prop.candidateFiles = [{ stored: CANDIDATE, original: "folding-chair.png", coverageJobType: "single-reference" }];
  delete project.productionAuthority;
  return project;
}
/* The listing a fresh import really produces: present, and with no identity. */
function importedScan() {
  return { anchors: [], plates: [], props: [{ name: CANDIDATE, url: `/assets/props/${CANDIDATE}` }], vehicles: [], audio: [], media: [], shots: {} };
}

function wire(options = {}) {
  const record = { requests: [], stored: null, revision: HARNESS_PROJECT_REVISION, transitions: 0 };
  record.count = (pattern) => record.requests.filter((row) => pattern.test(row.url)).length;
  record.fetch = async (url, init, response) => {
    const method = String(init?.method || "GET");
    record.requests.push({ url, method });
    if (/canon-transition$/.test(url) && method === "POST") {
      record.transitions += 1;
      const payload = JSON.parse(init.body || "{}");
      if (options.refuse) {
        return response({ ok: false, code: "AUTHORITY_EDGE_RECEIPT_MISMATCH", error: "The edge and its receipt disagree." }, 422);
      }
      record.stored = payload.successor;
      record.revision = `"accepted-${record.transitions}"`;
      return response({ ok: true, slug: SLUG, revision: record.revision, project: payload.successor });
    }
    if (/^\/api\/projects\/[^/]+\/project$/.test(url) && method === "PUT") {
      if (options.refuse) return response({ ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed." }, 422);
      record.stored = JSON.parse(init.body || "{}");
      return response({ ok: true, slug: SLUG, revision: record.revision });
    }
    if (/^\/api\/projects\/[^/]+\/project$/.test(url) && method === "GET") {
      return response(record.stored || {}, 200, { "x-cinebraid-project-revision": record.revision, etag: record.revision });
    }
    if (url === "/api/media/rename") return response({ ok: true, name: "PR_TOOL_PRIMARY_V001.png" });
    return null;
  };
  return record;
}

async function openApproval(options = {}) {
  const harness = options.wire || wire(options);
  const project = importedFixture();
  const rendered = await render("#/prop/PR-TOOL", project, {
    scan: importedScan(), fetch: harness.fetch, mutateSource: options.mutateSource,
  });
  harness.stored = JSON.parse(JSON.stringify(project));
  vm.runInContext(
    `ACTIVE_PROJECT_SLUG = ${JSON.stringify(SLUG)}; PROJECT_REVISION = ${JSON.stringify(HARNESS_PROJECT_REVISION)};`
    + " PROJECT_CONFLICT = false; SAVE_BLOCKED = false; AUTHORITY_SAVE_REFUSED = false;"
    + " window.__stamps = []; window.__toasts = [];"
    + " window.stampCeremony = (text) => { window.__stamps.push(String(text)); };"
    + " const priorToast = window.toast; window.toast = (text) => { window.__toasts.push(String(text)); return priorToast ? priorToast(text) : undefined; };"
    + " window.__reloads = 0; location.reload = () => { window.__reloads += 1; };",
    rendered.context);
  rendered.context.approveEntityFile("props", "PR-TOOL", CANDIDATE, "state-default", "primary-authority");
  return { rendered, harness };
}

const read = (rendered) => vm.runInContext(`(() => {
  const confirm = document.getElementById("entity-approve-confirm");
  const prop = P.props.find(x => x.id === "PR-TOOL");
  const truth = entityProductionTruth(P, "props", "PR-TOOL");
  return {
    confirmDisabled: confirm ? confirm.disabled === true : null,
    canon: truth.canon.length,
    canonAsset: (truth.canon[0] || {}).assetId || "",
    receipts: ((P.productionAuthority || {}).receipts || []).length,
    stamps: window.__stamps.slice(),
    toasts: window.__toasts.slice(),
  };
})()`, rendered.context);

/* ===========================================================================
   NC-1 — APPROVE WITH WHATEVER THE SCAN HAPPENED TO KNOW.

   The original defect exactly: `displayedAssetId` read from the scan listing,
   which for a freshly imported candidate is absent. The receipt is then written
   with an empty identity, and every later reader that must prove which bytes
   were approved has nothing to prove it with.
   =========================================================================== */
const NC1_ANCHOR = "    preparedAssetId = ENTITY_APPROVAL_READINESS.assetId;";
const NC1_BREAK = '    preparedAssetId = (entityMedia(list, x).find((item) => item.name === name) || {}).assetId || "";';

/* The other half of the same mechanism: the pre-fix build had nothing that
   noticed the live listing disagreeing with a prepared identity, because there
   was no prepared identity to disagree with. */
const NC1_STALE_ANCHOR = 'if (String(live.assetId || "") !== readiness.assetId) {';
const NC1_STALE_BREAK = "if (false) {";

async function nc1_approveWithScanIdentity() {
  anchorIn("public/library-tools.js", NC1_ANCHOR, "NC-1");
  anchorIn("public/library-tools.js", NC1_STALE_ANCHOR, "NC-1 (staleness half)");
  const { rendered } = await openApproval({
    mutateSource: replacingMany("library-tools.js", [[NC1_ANCHOR, NC1_BREAK], [NC1_STALE_ANCHOR, NC1_STALE_BREAK]]),
  });
  /* The defect is reachable only from the state the fix removed, so the scan is
     put back to its pre-preparation shape immediately before the click. */
  await settleApprovalReadiness(rendered);
  vm.runInContext(`SCAN.props = [{ name: ${JSON.stringify(CANDIDATE)}, url: "/assets/props/${CANDIDATE}" }];`, rendered.context);
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain();
  const seen = read(rendered);

  /* OBSERVED FIRST: the empty-identity receipt really comes back. */
  checks += 1;
  assert.strictEqual(seen.receipts, 1, "NC-1 did not reproduce: no receipt was written at all");
  checks += 1;
  assert.strictEqual(seen.canonAsset, "",
    "NC-1 did not reproduce: the receipt still carried a durable identity, so the control is not exercising the defect");

  /* AND ONLY THEN: the guarding claim must go red. */
  await mustFail("NC-1", "carrying the prepared durable identity", async () => {
    assert.strictEqual(seen.canonAsset, harnessAssetId(`props/${CANDIDATE}`), "carrying the prepared durable identity");
  });
}

/* ===========================================================================
   NC-2 — LET THE BUTTON BE LIVE BEFORE IDENTITY IS PREPARED.

   What made NC-1 reachable. Confirmation was available the instant the modal
   opened, so the approval could always outrun the identity pass.
   =========================================================================== */
const NC2_ANCHOR = "  if (confirmButton && !ready) confirmButton.disabled = true;";
const NC2_BREAK = "  if (confirmButton && !ready) confirmButton.disabled = false;";

async function nc2_confirmLiveBeforePreparation() {
  anchorIn("public/library-tools.js", NC2_ANCHOR, "NC-2");
  const { rendered } = await openApproval({ mutateSource: replacing("library-tools.js", NC2_ANCHOR, NC2_BREAK) });
  const seen = read(rendered);

  checks += 1;
  assert.strictEqual(seen.confirmDisabled, false,
    "NC-2 did not reproduce: confirmation was still withheld, so the control is not exercising the defect");

  await mustFail("NC-2", "confirmation is withheld before identity is prepared", async () => {
    assert.strictEqual(seen.confirmDisabled, true, "confirmation is withheld before identity is prepared");
  });
}

/* ===========================================================================
   NC-3 — ANNOUNCE THE APPROVAL ON dirty() INSTEAD OF ON ACCEPTANCE.

   dirty() only ARMS a write. Announcing there is what reported an approval the
   authority seam had refused — and reopening then showed it unapproved.
   =========================================================================== */
const NC3_ANCHOR = "  const submission = beginApprovalSubmission(meta);\n  showPendingApprovalSurface();";
const NC3_BREAK = "  const submission = beginApprovalSubmission(meta);\n  finishEntityApprovalCeremony(meta);";

async function nc3_announceBeforeDurable() {
  anchorIn("public/library-tools.js", NC3_ANCHOR, "NC-3");
  const { rendered } = await openApproval({
    refuse: true, mutateSource: replacing("library-tools.js", NC3_ANCHOR, NC3_BREAK),
  });
  await settleApprovalReadiness(rendered);
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain();
  const seen = read(rendered);

  checks += 1;
  assert.ok(seen.stamps.some((line) => /^APPROVED/.test(line)),
    "NC-3 did not reproduce: the refused approval was not announced, so the control is not exercising the defect");

  await mustFail("NC-3", "nothing was stamped approved", async () => {
    assert.ok(!seen.stamps.some((line) => /^APPROVED/.test(line)), "nothing was stamped approved");
  });
}

/* ===========================================================================
   NC-4 — PUT THE PRODUCTION RENAME BACK INSIDE THE APPROVAL.

   The destructive half. The file moves before authority has accepted anything,
   so a refused save leaves the bytes renamed with no durable approval behind
   them — and the receipt repair that was supposed to follow correctly refuses
   when the receipt's original identity was empty.
   =========================================================================== */
const NC4_ANCHOR = "  const finalName = name;\n  const approvedAssetId = preparedAssetId";
const NC4_BREAK = "  const finalName = name;\n  await fetch(\"/api/media/rename\", { method: \"POST\", headers: { \"Content-Type\": \"application/json\" },"
  + " body: JSON.stringify({ projectSlug: ACTIVE_PROJECT_SLUG, dir: ENTITY_MEDIA[list], from: name, to: \"PR_TOOL_PRIMARY_V001.png\" }) });\n"
  + "  const approvedAssetId = preparedAssetId";

async function nc4_renameInsideApproval() {
  anchorIn("public/library-tools.js", NC4_ANCHOR, "NC-4");
  const { rendered, harness } = await openApproval({
    refuse: true, mutateSource: replacing("library-tools.js", NC4_ANCHOR, NC4_BREAK),
  });
  await settleApprovalReadiness(rendered);
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain();

  checks += 1;
  assert.strictEqual(harness.count(/\/api\/media\/rename/), 1,
    "NC-4 did not reproduce: no rename request was made, so the control is not exercising the defect");

  await mustFail("NC-4", "no rename was requested", async () => {
    assert.strictEqual(harness.count(/\/api\/media\/rename/), 0, "no rename was requested");
  });
}

/* ===========================================================================
   NC-5 — DISPATCH QUEUED SNAPSHOTS WHILE THE OUTCOME IS UNRESOLVED.

   SAVE_CHAIN recovers from a failed link and carries on. While an approval's
   outcome is unknown, the next queued snapshot carries that same unresolved
   authority state, and sending it either races the decision or replaces it.
   =========================================================================== */
const NC5_ANCHOR = "  if (submission && submission.job && job !== submission.job) return SAVE_CHAIN;";
const NC5_BREAK = "  if (false) return SAVE_CHAIN;";

async function nc5_autosaveWhileUnresolved() {
  anchorIn("public/app.js", NC5_ANCHOR, "NC-5");
  const harness = wire({});
  /* The transition throws, so the outcome is genuinely unknown and the pending
     record stays open — the exact window the guard exists for. */
  const thrown = { count: 0 };
  const baseFetch = harness.fetch;
  harness.fetch = async (url, init, response) => {
    if (/canon-transition$/.test(url) && String(init?.method) === "POST" && thrown.count === 0) {
      thrown.count += 1;
      harness.requests.push({ url, method: "POST" });
      harness.transitions += 1;
      throw new Error("network unreachable");
    }
    return baseFetch(url, init, response);
  };
  const { rendered } = await openApproval({ wire: harness, mutateSource: replacing("app.js", NC5_ANCHOR, NC5_BREAK) });
  await settleApprovalReadiness(rendered);
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain();
  const before = harness.requests.length;
  vm.runInContext("P.meta.title = 'Edited while uncertain'; dirty();", rendered.context);
  await drain(60);
  const dispatched = harness.requests.length - before;

  checks += 1;
  assert.ok(dispatched > 0,
    "NC-5 did not reproduce: nothing was dispatched even with the guard removed, so the control is not exercising the defect");

  await mustFail("NC-5", "no snapshot carrying the unresolved authority state went out", async () => {
    assert.strictEqual(dispatched, 0, "no snapshot carrying the unresolved authority state went out");
  });
}

async function main() {
  await nc1_approveWithScanIdentity();
  await nc2_confirmLiveBeforePreparation();
  await nc3_announceBeforeDurable();
  await nc4_renameInsideApproval();
  await nc5_autosaveWhileUnresolved();
  console.log(
    `Alpha imported-reference approval negative controls passed ${checks} checks: each of the five mechanisms behind the `
    + "reproduced failure — approving on the scan's absent identity, a confirm control live before preparation, announcing on "
    + "dirty() rather than on durable acceptance, renaming the candidate inside the approval, and dispatching queued snapshots "
    + "while the outcome is unresolved — was reintroduced in memory, observed, and shown to turn its guarding claim red. "
    + "Provider calls made: 0.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
