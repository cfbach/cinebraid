/* ALPHA — IMPORTED-REFERENCE APPROVAL.
 *
 * THE FILMMAKER OUTCOME THIS PINS, in one sentence: import a candidate, review
 * the exact target, approve once, reopen, and find the same approved result —
 * and if the approval cannot be saved, keep prior Canon unchanged, keep the
 * media where it is, keep the candidate and its target recoverable, and never
 * turn one human decision into two.
 *
 * WHAT WAS ACTUALLY BROKEN. Three things had to line up, and all three did:
 *
 *   1. `/api/scan` composes its answer BEFORE scheduling the identity pass, so a
 *      candidate imported seconds ago was listed with no assetId. The approval
 *      wrote a receipt with an empty identity.
 *   2. The approval then renamed the file to a generated production name and
 *      asked repairCanonValue() to move the receipt with the bytes.
 *      repairCanonValue() correctly REFUSES to repair a receipt whose original
 *      identity was empty — so the pointer named the new file and the receipt
 *      named the old one.
 *   3. The authority write seam then refused the mismatched pair with 422. The
 *      file had already moved. The browser had already said "Approved".
 *
 * WHAT THIS SUITE PROVES, and the shape of the fix it pins:
 *
 *   §1  The rename is GONE from entity primary-reference approval — not
 *       deferred, not backgrounded, not staged. The approved image keeps the
 *       name it was imported under, and the repair machinery is untouched but
 *       no longer asked to follow bytes this operation does not move.
 *   §2  Identity is prepared POSITIVELY for the one selected file, before the
 *       decision, through MediaAssetService — against a real filesystem.
 *   §3  Readiness is bound to what is on screen, and the confirm control follows
 *       it.
 *   §4  One trusted click produces one receipt and one accepted transition, and
 *       the approval is announced only after storage accepts it.
 *   §5  Every way it can fail leaves prior Canon, the media and the candidate
 *       exactly as they were, says so, and never mints a second decision.
 *
 * NO PROVIDER CALL IS MADE. NOTHING OUTSIDE A TEMP DIRECTORY IS WRITTEN.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const { render, buildFixture, harnessAssetId, settleApprovalReadiness, HARNESS_PROJECT_REVISION } = require("./render-harness");
const MediaAssetService = require("../media-asset-service");
const { readLedger } = require("../media-asset-store");

let checks = 0;
function ok(value, message) { checks += 1; assert.ok(value, message); }
function eq(actual, expected, message) { checks += 1; assert.strictEqual(actual, expected, message); }

const SLUG = "fixture";
const ASSET_ID = /^asset-[0-9a-f]{32}$/;

/* ------------------------------------------------------------------ fixtures */

const CANDIDATE = "PR-TOOL-CANDIDATE-MK1-01.png";
const SECOND_CANDIDATE = "PR-TOOL-CANDIDATE-MK1-02.png";
/* The name the removed generator would have produced. It exists in the scan for
   the occupied-destination case, and nothing in this slice may go near it. */
const WOULD_BE_PRODUCTION_NAME = "PR_TOOL_PRIMARY_V001.png";

function importedFixture(options = {}) {
  const project = buildFixture();
  const prop = project.props[0];
  prop.approvedFile = "";
  prop.approvedAssetId = "";
  prop.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "", notes: "Primary approved reference." },
  ];
  prop.candidateFiles = [
    { stored: CANDIDATE, original: "folding-chair.png", coverageJobType: "single-reference" },
    ...(options.second ? [{ stored: SECOND_CANDIDATE, original: "folding-chair-2.png", coverageJobType: "single-reference" }] : []),
  ];
  delete project.productionAuthority;
  return project;
}

/* THE SCAN A FRESH IMPORT ACTUALLY PRODUCES: the file is listed and carries NO
   identity, because the identity pass had not run when the response was built.
   That absence is the precondition of the original defect, so every browser
   section starts from it. */
function importedScan(options = {}) {
  const rows = [{ name: CANDIDATE, url: `/assets/props/${CANDIDATE}` }];
  if (options.second) rows.push({ name: SECOND_CANDIDATE, url: `/assets/props/${SECOND_CANDIDATE}` });
  if (options.occupied) rows.push({ name: WOULD_BE_PRODUCTION_NAME, url: `/assets/props/${WOULD_BE_PRODUCTION_NAME}`, assetId: harnessAssetId(`props/${WOULD_BE_PRODUCTION_NAME}`) });
  return {
    anchors: [], plates: [], props: rows, vehicles: [], audio: [], media: [], shots: {},
  };
}

/* One recorder for the whole wire. Every claim about "no rename happened", "one
   transition", "no second receipt" and "nothing was dispatched" is read off
   this, not inferred. */
function wire(options = {}) {
  const record = {
    requests: [],
    stored: null,
    revision: HARNESS_PROJECT_REVISION,
    transitions: 0,
  };
  record.urls = () => record.requests.map((row) => row.url);
  record.count = (pattern) => record.requests.filter((row) => pattern.test(row.url)).length;
  record.fetch = async (url, init, response) => {
    const method = String(init?.method || "GET");
    record.requests.push({ url, method, body: init?.body ? String(init.body) : "", ifMatch: (init?.headers || {})["If-Match"] || "" });
    if (/^\/api\/projects\/[^/]+\/canon-transition$/.test(url) && method === "POST") {
      record.transitions += 1;
      const payload = JSON.parse(init.body || "{}");
      const reply = options.onTransition ? options.onTransition(record.transitions, payload, record) : null;
      if (reply === "throw") throw new Error("network unreachable");
      /* Accepted: this stands in for the durable document, and every later read
         of stored authority answers from it. */
      if (!reply || reply.status === 200) {
        record.stored = payload.successor;
        record.revision = `"accepted-${record.transitions}"`;
        return response({ ok: true, slug: SLUG, revision: record.revision, project: payload.successor });
      }
      if (reply.commitThenLose) {
        record.stored = payload.successor;
        record.revision = `"accepted-${record.transitions}"`;
        throw new Error("response lost");
      }
      return response(reply.body || {}, reply.status);
    }
    if (/^\/api\/projects\/[^/]+\/project$/.test(url) && method === "PUT") {
      const reply = options.onOrdinarySave ? options.onOrdinarySave(record) : null;
      if (reply && reply.status !== 200) return response(reply.body || {}, reply.status);
      record.stored = JSON.parse(init.body || "{}");
      record.revision = `"ordinary-${record.requests.length}"`;
      return response({ ok: true, slug: SLUG, revision: record.revision });
    }
    if (/^\/api\/projects\/[^/]+\/project$/.test(url) && method === "GET") {
      return response(record.stored || {}, 200, {
        "x-cinebraid-project-revision": record.revision,
        etag: record.revision,
      });
    }
    if (url === "/api/projects/switch") return response({ ok: true, slug: "other" });
    return null;
  };
  return record;
}

async function openedApproval(options = {}) {
  const project = options.project || importedFixture(options);
  const scan = options.scan || importedScan(options);
  const harness = options.wire || wire(options);
  const rendered = await render("#/prop/PR-TOOL", project, { scan, fetch: harness.fetch });
  harness.stored = JSON.parse(JSON.stringify(project));
  vm.runInContext(
    `ACTIVE_PROJECT_SLUG = ${JSON.stringify(SLUG)};`
    + ` PROJECT_REVISION = ${JSON.stringify(HARNESS_PROJECT_REVISION)};`
    + " PROJECT_CONFLICT = false; SAVE_BLOCKED = false; AUTHORITY_SAVE_REFUSED = false;"
    + " window.__stamps = []; window.__toasts = [];"
    + " window.stampCeremony = (text) => { window.__stamps.push(String(text)); };"
    + " const priorToast = window.toast;"
    + " window.toast = (text) => { window.__toasts.push(String(text)); return priorToast ? priorToast(text) : undefined; };"
    + " window.__reloads = 0; location.reload = () => { window.__reloads += 1; };",
    rendered.context);
  rendered.context.approveEntityFile("props", "PR-TOOL", options.candidate || CANDIDATE, "state-default", "primary-authority");
  return { rendered, harness, project, scan };
}

const surfaces = (rendered) => vm.runInContext(`(() => {
  const line = document.getElementById("entity-approval-readiness");
  const confirm = document.getElementById("entity-approve-confirm");
  const prop = P.props.find(x => x.id === "PR-TOOL");
  const truth = entityProductionTruth(P, "props", "PR-TOOL");
  const row = (prop.candidateFiles || []).find(r => (r.stored || r.name) === ${JSON.stringify(CANDIDATE)}) || {};
  return {
    modal: document.getElementById("modal").innerHTML,
    readiness: line ? line.dataset.state : "",
    /* innerHTML, because the readiness line renders its sentence beside an
       optional TRY AGAIN control and the harness document derives no textContent
       from what a suite writes into innerHTML. */
    readinessText: line ? line.innerHTML : "",
    /* The named target is written into its own element after the modal opens, so
       it is read where it is written rather than off the modal's own markup. */
    targetSummary: (document.getElementById("entity-approval-target-summary") || {}).innerHTML || "",
    caption: (document.getElementById("entity-approval-file-caption") || {}).textContent || "",
    confirmDisabled: confirm ? confirm.disabled === true : null,
    canon: truth.canon.length,
    canonValue: (truth.canon[0] || {}).value || "",
    canonAsset: (truth.canon[0] || {}).assetId || "",
    receipts: ((P.productionAuthority || {}).receipts || []).length,
    approvedFile: prop.approvedFile || "",
    stateFile: (prop.continuityStates[0] || {}).approvedFile || "",
    decision: row.decision || "",
    rowStored: row.stored || "",
    stamps: window.__stamps.slice(),
    toasts: window.__toasts.slice(),
    reloads: window.__reloads,
    pending: !!(window.approvalSubmissionPending && window.approvalSubmissionPending()),
    pendingOutcome: (window.approvalSubmissionPending && window.approvalSubmissionPending() || {}).outcome || "",
    saveState: document.getElementById("save-state").querySelector("span:last-child").textContent,
  };
})()`, rendered.context);

async function drain(turns = 220) {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/* ==========================================================================
   §1  THE RENAME IS GONE FROM THIS OPERATION.
   ========================================================================== */
/* THE CODE, WITHOUT ITS PROSE. These functions carry long explanations of the
   defect they removed — including the name of the request that is gone — so a
   source proof that reads the comments would find the very string it is asserting
   the absence of, and pass or fail for the wrong reason. */
function codeOnly(text) {
  const source = String(text);
  let out = "";
  let mode = "code";
  for (let index = 0; index < source.length; index += 1) {
    const pair = source.slice(index, index + 2);
    if (mode === "code" && pair === "/*") { mode = "block"; index += 1; continue; }
    if (mode === "code" && pair === "//") { mode = "line"; index += 1; continue; }
    if (mode === "block" && pair === "*/") { mode = "code"; index += 1; out += " "; continue; }
    if (mode === "line" && source.charCodeAt(index) === 10) { mode = "code"; out += String.fromCharCode(10); continue; }
    if (mode === "code") out += source[index];
  }
  return out;
}

function testNoRenameInPrimaryApproval() {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "library-tools.js"), "utf8");
  const confirmBody = codeOnly((source.split("window.confirmEntityApproval")[1] || "").split("window.approveEntity =")[0] || "");
  const takeBody = codeOnly((source.split("window.confirmApproveTake")[1] || "").split("window.setWinner")[0] || "");
  ok(confirmBody.length > 400, "the entity approval writer is present to be inspected");

  /* R-1 — no rename request, in any form, from this operation. */
  ok(!/api\/media\/rename/.test(confirmBody),
    "R-1: entity primary-reference approval issues no rename request");
  /* R-2 — and nothing stands in for it: no background pass, no deferred move,
     no post-approval housekeeping that would rename it later. */
  for (const substitute of ["renameCandidateRecord", "repairApprovalIdentity", "repairCanonValue", "entityCanonicalSuggestion"]) {
    ok(!new RegExp(`\\b${substitute}\\s*\\(`).test(confirmBody),
      `R-2: entity approval no longer calls ${substitute}() — there are no bytes to follow`);
  }
  /* R-3 — the generator that produced the production name is gone rather than
     left unused, so nothing in the product still looks as though approval
     assigns one. */
  ok(!/function entityCanonicalSuggestion/.test(source),
    "R-3: the entity production-name generator is removed");
  ok(!/id="entity-approve-name"[^>]*value="\$\{attr\(entityCanonicalSuggestion/.test(source),
    "R-3: and the modal carries no generated production filename");
  /* R-4 — THE SHOT PATH IS UNTOUCHED. This slice is one operation wide. */
  ok(/api\/media\/rename/.test(takeBody), "R-4: shot take approval still renames, unchanged");
  ok(/function canonicalSuggestion/.test(source), "R-4: and its own name generator is untouched");
  /* R-5 — the repair machinery itself is not weakened; it is simply not called
     here. Proven behaviourally in §5. */
  const disposition = fs.readFileSync(path.join(__dirname, "..", "public", "shared-media-disposition.js"), "utf8");
  ok(/function repairApprovalIdentity/.test(disposition), "R-5: repairApprovalIdentity still exists");
  const kernel = fs.readFileSync(path.join(__dirname, "..", "public", "shared-authority-kernel.js"), "utf8");
  ok(/function repairCanonValue/.test(kernel), "R-5: repairCanonValue still exists");
  /* R-6 — no user-facing copy promises automatic production naming here. */
  ok(!/PRODUCTION NAMES ARE ASSIGNED ONLY ON APPROVAL/.test(source),
    "R-6: intake no longer promises production names on approval");
  ok(/FILES KEEP THE NAME THEY ARE IMPORTED UNDER/.test(source),
    "R-6: and says what actually happens instead");

  /* R-7 — THE CANON COMMAND IS STILL SYNCHRONOUS INSIDE THE TRUSTED CLICK.
     Everything asynchronous moved BEFORE the click (preparation) or AFTER the
     decision (the submission); nothing was inserted between the gesture and the
     kernel. */
  const beforeCanon = confirmBody.split("approveEntityStateCanon(")[0] || "";
  ok(!/\bawait\b/.test(beforeCanon),
    "R-7: nothing is awaited between entering the click and committing Canon");
  ok(/beginApprovalSubmission\(/.test(confirmBody) && /await dispatchApprovalSubmission\(/.test(confirmBody),
    "R-7: and the durable submission is what the click awaits afterwards");
}

/* ==========================================================================
   §2  IDENTITY IS PREPARED POSITIVELY, ON A REAL FILESYSTEM.
   ========================================================================== */
async function testPreparedIdentityOnDisk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-alpha-prepare-"));
  try {
    const projectDir = path.join(root, SLUG);
    fs.mkdirSync(path.join(projectDir, "props"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(importedFixture({ second: true })));
    /* Byte-identical imports, deliberately: equal content must never collapse
       two logical candidates into one identity. */
    const bytes = Buffer.from("PNGDATA-IDENTICAL");
    fs.writeFileSync(path.join(projectDir, "props", CANDIDATE), bytes);
    fs.writeFileSync(path.join(projectDir, "props", SECOND_CANDIDATE), bytes);
    MediaAssetService.resetActivationState();

    /* P-1 — a fresh import with NO ledger at all reaches a stable identity. */
    const first = await MediaAssetService.prepareAssetIdentity({ projectsRoot: root, slug: SLUG, path: `props/${CANDIDATE}` });
    eq(first.status, "ready", "P-1: a fresh import prepares to ready");
    ok(ASSET_ID.test(first.assetId), "P-1: with a well-formed durable assetId");
    eq(first.path, `props/${CANDIDATE}`, "P-1: naming the exact selected path");
    eq(first.size, bytes.length, "P-1: and the observed file");

    /* P-2 — asking again returns the SAME id. Preparation never re-mints. */
    const again = await MediaAssetService.prepareAssetIdentity({ projectsRoot: root, slug: SLUG, path: `props/${CANDIDATE}` });
    eq(again.assetId, first.assetId, "P-2: an existing identity is used, never replaced");
    eq(again.reason, "already-indexed", "P-2: and says it came from the ledger");

    /* P-3 — DUPLICATE CONTENT STAYS TWO LOGICAL ASSETS. */
    const second = await MediaAssetService.prepareAssetIdentity({ projectsRoot: root, slug: SLUG, path: `props/${SECOND_CANDIDATE}` });
    eq(second.status, "ready", "P-3: the duplicate-content import also prepares");
    ok(second.assetId !== first.assetId, "P-3: and keeps an identity of its own");

    /* P-4 — NO HYDRATION. Preparation reads no media bytes: every row is still
       unhashed, so a digest was never taken and cannot have been used as an id. */
    const ledger = readLedger(projectDir).ledger;
    const rows = ledger.assets.filter((asset) => asset.storage && /^props\//.test(asset.storage.path));
    eq(rows.length, 2, "P-4: both files are in the ledger");
    ok(rows.every((asset) => !asset.contentHash), "P-4: and preparation hashed nothing");
    ok(rows.every((asset) => asset.assetId !== asset.contentHash), "P-4: a digest is never the assetId");

    /* P-5 — refusals are typed, and they are refusals rather than fallbacks. */
    const missing = await MediaAssetService.prepareAssetIdentity({ projectsRoot: root, slug: SLUG, path: "props/NOT-THERE.png" });
    eq(missing.status, "unavailable", "P-5: a file that is not there cannot be prepared");
    eq(missing.reason, "file-missing", "P-5: and the reason names what to do about it");
    eq(missing.assetId, "", "P-5: no identity is invented for it");
    const escaped = await MediaAssetService.prepareAssetIdentity({ projectsRoot: root, slug: SLUG, path: "../outside.png" });
    eq(escaped.status, "unavailable", "P-5: a path outside the project is refused");
    const stray = await MediaAssetService.prepareAssetIdentity({ projectsRoot: root, slug: "..", path: `props/${CANDIDATE}` });
    eq(stray.status, "unavailable", "P-5: and so is a slug that is not one segment below the root");

    /* P-6 — AN ALREADY INDEXED CANDIDATE KEEPS ITS ID THROUGH THE SAME PATH.
       There is no separate "already indexed" flow to drift from this one. */
    MediaAssetService.resetActivationState();
    const reopened = await MediaAssetService.prepareAssetIdentity({ projectsRoot: root, slug: SLUG, path: `props/${CANDIDATE}` });
    eq(reopened.assetId, first.assetId, "P-6: reopening preserves the identity");
    eq(reopened.status, "ready", "P-6: through the same preparation seam");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    MediaAssetService.resetActivationState();
  }
}

/* ==========================================================================
   §3  READINESS IS BOUND TO WHAT IS ON SCREEN.
   ========================================================================== */
async function testReadinessBinding() {
  /* B-1 — the modal opens showing the image and the named target, saying it is
     preparing, with confirmation withheld. */
  const opened = await openedApproval();
  const before = surfaces(opened.rendered);
  eq(before.confirmDisabled, true, "B-1: confirmation is withheld before identity is prepared");
  eq(before.readiness, "preparing", "B-1: and the modal says it is preparing");
  ok(/Preparing this image for approval/.test(before.readinessText), "B-1: in those words");
  ok(before.modal.includes(CANDIDATE), "B-1: with the exact candidate still visible");
  ok(/APPROVAL TARGET/.test(before.targetSummary) && /Default/.test(before.targetSummary),
    "B-1: and the exact named target");
  eq(before.canon, 0, "B-1: and nothing has been approved");

  /* B-2 — once prepared, the control is offered, and the identity it holds is
     the one the ledger names for THIS path. */
  ok(await settleApprovalReadiness(opened.rendered), "B-2: preparation settles");
  const ready = surfaces(opened.rendered);
  eq(ready.readiness, "ready", "B-2: the modal says it is ready");
  eq(ready.confirmDisabled, false, "B-2: and offers confirmation");
  const prepared = vm.runInContext("ENTITY_APPROVAL_READINESS.assetId", opened.rendered.context);
  eq(prepared, harnessAssetId(`props/${CANDIDATE}`), "B-2: bound to this file's durable identity");

  /* B-3 — CHANGING THE CANDIDATE WITHDRAWS IT. A readiness prepared for one
     image may not approve another. */
  const two = await openedApproval({ second: true });
  ok(await settleApprovalReadiness(two.rendered), "B-3: prepares for the opening candidate");
  vm.runInContext(
    `document.getElementById("entity-approve-file").value = ${JSON.stringify(SECOND_CANDIDATE)};`
    + " syncEntityApprovalModal();", two.rendered.context);
  eq(surfaces(two.rendered).confirmDisabled, true, "B-3: selecting another candidate withdraws confirmation");
  const stale = vm.runInContext(
    `entityApprovalReadinessRefusal(ENTITY_APPROVAL_READINESS, { list: "props", id: "PR-TOOL", stateId: "state-default", name: ${JSON.stringify(SECOND_CANDIDATE)}, mode: "primary-authority" })`,
    two.rendered.context);
  ok(stale && /candidate-changed|not-prepared/.test(stale.code), "B-3: and the refusal names the change");
  ok(await settleApprovalReadiness(two.rendered), "B-3: the new candidate prepares in its own right");
  eq(vm.runInContext("ENTITY_APPROVAL_READINESS.fileName", two.rendered.context), SECOND_CANDIDATE,
    "B-3: and readiness now describes the newly displayed image");

  /* B-4 — A PROJECT THAT IS NOT SETTLED CANNOT APPROVE. This is the import whose
     metadata save failed: the candidate and its target are retained, the modal
     opens showing them, and confirmation is simply not available. */
  const unsettled = await openedApproval();
  ok(await settleApprovalReadiness(unsettled.rendered), "B-4: prepares while the project is settled");
  vm.runInContext("SAVE_REVISION = SAVED_REVISION + 1; renderEntityApprovalReadiness();", unsettled.rendered.context);
  const pendingSave = surfaces(unsettled.rendered);
  eq(pendingSave.confirmDisabled, true, "B-4: unsaved project state withdraws confirmation");
  ok(/not been saved|have not reached storage/i.test(pendingSave.readinessText),
    "B-4: and says the project is not saved rather than blaming the image");
  ok(pendingSave.modal.includes(CANDIDATE), "B-4: the candidate stays on screen and recoverable");
  ok(/APPROVAL TARGET/.test(pendingSave.targetSummary), "B-4: beside the target it was imported for");

  /* B-6 — CHANGING THE TARGET WITHDRAWS IT TOO. A readiness prepared for one
     continuity state may not approve another. */
  const retargeted = await openedApproval();
  ok(await settleApprovalReadiness(retargeted.rendered), "B-6: prepares for the opening target");
  const targetRefusal = vm.runInContext(
    'entityApprovalReadinessRefusal(ENTITY_APPROVAL_READINESS, { list: "props", id: "PR-TOOL",'
    + ' stateId: "state-other", name: ' + JSON.stringify(CANDIDATE) + ', mode: "primary-authority" })',
    retargeted.rendered.context);
  ok(targetRefusal && targetRefusal.code === "target-changed", "B-6: a different state is a different question");

  /* B-7 — AND SO DOES THE PROJECT MOVING UNDER IT: another project open, this
     project reopened, or this project's stored document advancing. */
  const moved = await openedApproval();
  ok(await settleApprovalReadiness(moved.rendered), "B-7: prepares while the project is still");
  const want = { list: "props", id: "PR-TOOL", stateId: "state-default", name: CANDIDATE, mode: "primary-authority" };
  const refusalFor = (mutation) => vm.runInContext(
    `(() => { ${mutation} return entityApprovalReadinessRefusal(ENTITY_APPROVAL_READINESS, ${JSON.stringify(want)}); })()`,
    moved.rendered.context);
  eq(refusalFor('ACTIVE_PROJECT_SLUG = "elsewhere";').code, "project-changed",
    "B-7: another project open invalidates readiness");
  vm.runInContext(`ACTIVE_PROJECT_SLUG = ${JSON.stringify(SLUG)};`, moved.rendered.context);
  eq(refusalFor("PROJECT_OPEN_EPOCH += 1;").code, "project-reopened",
    "B-7: reopening this project invalidates readiness");
  vm.runInContext("PROJECT_OPEN_EPOCH -= 1;", moved.rendered.context);
  eq(refusalFor("PROJECT_SAVE_GENERATION += 1;").code, "project-advanced",
    "B-7: the stored document advancing invalidates readiness");

  /* B-5 — A CANDIDATE WHOSE DECLARED STRUCTURE IS NOT DURABLE IS NOT APPROVABLE,
     even though the draft in this tab declares it. */
  const draftOnly = await openedApproval();
  vm.runInContext(
    "SAVED_PROJECT_BASELINE.props.find(x => x.id === 'PR-TOOL').candidateFiles = [];"
    + " ENTITY_APPROVAL_READINESS = null; renderEntityApprovalReadiness();", draftOnly.rendered.context);
  const notDurable = surfaces(draftOnly.rendered);
  eq(notDurable.confirmDisabled, true, "B-5: a declaration that is only in this tab cannot be approved from");
}

/* ==========================================================================
   §4  ONE CLICK, ONE RECEIPT, ANNOUNCED ONLY WHEN DURABLE.
   ========================================================================== */
async function testOneDurableApproval() {
  const { rendered, harness } = await openedApproval();
  ok(await settleApprovalReadiness(rendered), "D-0: prepared");
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain();
  const after = surfaces(rendered);

  /* D-1 — one trusted click, one receipt, one accepted transition. */
  eq(after.receipts, 1, "D-1: exactly one receipt exists");
  eq(harness.transitions, 1, "D-1: and exactly one Canon transition was accepted");
  eq(after.canon, 1, "D-1: with one current authority for this target");
  /* D-2 — on the exact bytes the filmmaker was looking at, under the name they
     were imported with. */
  eq(after.canonValue, CANDIDATE, "D-2: naming the exact candidate reviewed");
  eq(after.canonAsset, harnessAssetId(`props/${CANDIDATE}`), "D-2: carrying the prepared durable identity");
  ok(after.canonAsset !== "", "D-2: which is the empty-identity receipt the defect used to write");
  eq(after.approvedFile, CANDIDATE, "D-2: the entity pointer names the same file");
  eq(after.stateFile, CANDIDATE, "D-2: and so does the state pointer");
  eq(after.decision, "approved-reference", "D-2: and the candidate row records the human decision");

  /* D-3 — NO RENAME REQUEST WAS MADE, ANYWHERE IN THE OPERATION. */
  eq(harness.count(/\/api\/media\/rename/), 0, "D-3: no rename was requested");
  /* D-4 — and the announcement came after the durable acceptance, not before. */
  ok(after.stamps.some((line) => /^APPROVED/.test(line)), "D-4: the approval is announced");
  ok(after.toasts.some((line) => /^Approved /.test(line)), "D-4: and stated in the filmmaker's words");
  eq(after.pending, false, "D-4: with no submission left unresolved");

  /* D-5 — REOPENING FINDS THE SAME RESULT. The stored document is the one the
     seam accepted, and reading it back through the shared projection gives the
     same candidate, identity and state. */
  const reopened = await render("#/prop/PR-TOOL", harness.stored, { scan: importedScan() });
  const durable = vm.runInContext(`(() => {
    const truth = entityProductionTruth(P, "props", "PR-TOOL");
    return { canon: truth.canon.length, value: (truth.canon[0] || {}).value || "", assetId: (truth.canon[0] || {}).assetId || "" };
  })()`, reopened.context);
  eq(durable.canon, 1, "D-5: reopening finds one current authority");
  eq(durable.value, CANDIDATE, "D-5: the same candidate");
  eq(durable.assetId, harnessAssetId(`props/${CANDIDATE}`), "D-5: with the same durable identity");

  /* D-8 — AND THE WINDOW IS FREE AGAIN. A committed approval releases the
     submission, so ordinary saving and project switching resume, and the durable
     result is what a switch leaves behind. */
  eq(vm.runInContext("!!approvalSubmissionPending()", rendered.context), false,
    "D-8: no submission is held once the approval is durable");
  await vm.runInContext("switchProject('other')", rendered.context);
  await drain(40);
  eq(harness.count(/\/api\/projects\/switch/), 1, "D-8: a project switch is no longer refused");
  eq((harness.stored.productionAuthority || { receipts: [] }).receipts.length, 1,
    "D-8: and the durable receipt is untouched by leaving the project");

  /* D-9 — AN ALREADY INDEXED CANDIDATE TAKES THE SAME PATH. Its identity is used
     rather than replaced, and nothing relocates it either. */
  const indexedScan = importedScan();
  indexedScan.props[0].assetId = harnessAssetId(`props/${CANDIDATE}`);
  const indexed = await openedApproval({ scan: indexedScan });
  ok(await settleApprovalReadiness(indexed.rendered), "D-9: an already indexed candidate prepares");
  eq(vm.runInContext("ENTITY_APPROVAL_READINESS.assetId", indexed.rendered.context),
    harnessAssetId(`props/${CANDIDATE}`), "D-9: keeping the identity it already had");
  await indexed.rendered.gesture.act(() => indexed.rendered.context.confirmEntityApproval(false));
  await drain();
  eq(surfaces(indexed.rendered).canonAsset, harnessAssetId(`props/${CANDIDATE}`),
    "D-9: and approving carries that same identity");
  eq(indexed.harness.count(/\/api\/media\/rename/), 0, "D-9: through the same path, which renames nothing");

  /* D-6 — A DESTINATION THAT WOULD HAVE COLLIDED IS SIMPLY IRRELEVANT NOW. The
     file that occupies the old generated production name is never touched, and
     no naming question is asked. */
  const occupied = await openedApproval({ occupied: true });
  ok(await settleApprovalReadiness(occupied.rendered), "D-6: prepared with the destination name occupied");
  await occupied.rendered.gesture.act(() => occupied.rendered.context.confirmEntityApproval(false));
  await drain();
  const collided = surfaces(occupied.rendered);
  eq(occupied.harness.count(/\/api\/media\/rename/), 0, "D-6: still no rename request");
  eq(collided.canonValue, CANDIDATE, "D-6: the approved file is the candidate, at its imported name");
  ok(!collided.modal.includes(WOULD_BE_PRODUCTION_NAME), "D-6: and the occupying file is never named");
  ok(occupied.harness.stored.props[0].approvedFile === CANDIDATE,
    "D-6: the durable pointer names the candidate, not the occupied destination");

  /* D-7 — A DOUBLE CLICK IS ONE DECISION. */
  const doubled = await openedApproval();
  ok(await settleApprovalReadiness(doubled.rendered), "D-7: prepared");
  await doubled.rendered.gesture.act(() => {
    doubled.rendered.context.confirmEntityApproval(false);
    doubled.rendered.context.confirmEntityApproval(false);
  });
  await drain();
  const once = surfaces(doubled.rendered);
  eq(doubled.harness.transitions, 1, "D-7: two clicks produce one transition");
  eq(once.receipts, 1, "D-7: and one receipt");
}

/* ==========================================================================
   §5  EVERY FAILURE LEAVES CANON, MEDIA AND CANDIDATE RECOVERABLE.
   ========================================================================== */
async function testFailureLeavesEverythingRecoverable() {
  const refusals = [
    {
      name: "authority 422",
      reply: { status: 422, body: { ok: false, code: "AUTHORITY_EDGE_RECEIPT_MISMATCH", error: "The edge and its receipt disagree." } },
      outcome: "refused",
    },
    {
      name: "validation 422",
      reply: { status: 422, body: { ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed.", issues: ["bad"] } },
      outcome: "refused",
    },
    {
      name: "409 conflict",
      reply: { status: 409, body: { ok: false, code: "PROJECT_REVISION_CONFLICT", error: "The project changed before this write." } },
      outcome: "changed",
    },
  ];
  for (const scenario of refusals) {
    const harness = wire({ onTransition: () => scenario.reply });
    const { rendered } = await openedApproval({ wire: harness });
    ok(await settleApprovalReadiness(rendered), `F-0 (${scenario.name}): prepared`);
    await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
    await drain();
    const after = surfaces(rendered);

    /* F-1 — PRIOR CANON IS UNCHANGED IN STORAGE. */
    eq(harness.stored.props[0].approvedFile || "", "", `F-1 (${scenario.name}): stored Canon is unchanged`);
    eq((harness.stored.productionAuthority || { receipts: [] }).receipts.length, 0,
      `F-1 (${scenario.name}): and no receipt reached storage`);
    /* F-2 — THE MEDIA IS WHERE IT WAS. */
    eq(harness.count(/\/api\/media\/rename/), 0, `F-2 (${scenario.name}): nothing moved the file`);
    /* F-3 — THE CANDIDATE AND ITS TARGET ARE STILL ON SCREEN AND RECOVERABLE. */
    ok(after.modal.includes(CANDIDATE), `F-3 (${scenario.name}): the candidate is still named`);
    ok(/APPROVAL TARGET/.test(after.modal), `F-3 (${scenario.name}): beside its exact target`);
    eq(after.rowStored, CANDIDATE, `F-3 (${scenario.name}): and its row is intact`);
    /* F-4 — NO SUCCESS CEREMONY OF ANY KIND. */
    ok(!after.stamps.some((line) => /^APPROVED/.test(line)), `F-4 (${scenario.name}): nothing was stamped approved`);
    ok(!after.toasts.some((line) => /^Approved /.test(line)), `F-4 (${scenario.name}): and nothing said approved`);
    /* F-5 — THE OUTCOME IS NAMED, AND A FAIL-CLOSED REFUSAL IS NOT OFFERED A
       RETRY OF THE SAME INVALID PAYLOAD. */
    eq(after.pendingOutcome, scenario.outcome, `F-5 (${scenario.name}): the outcome is classified`);
    ok(!/RETRY SAVING APPROVAL/.test(after.modal), `F-5 (${scenario.name}): no useless retry is offered`);
    ok(/REVIEW CURRENT STATE/.test(after.modal), `F-5 (${scenario.name}): the filmmaker is sent to look at what is there`);
    /* F-6 — AND NOTHING WAS RESENT BY ITSELF. */
    eq(harness.transitions, 1, `F-6 (${scenario.name}): the refused submission is not retried automatically`);

    /* F-7 — LEAVING IT UNAPPROVED NEVER REVOKES ANYTHING DURABLE. */
    await vm.runInContext("reviewCurrentApprovalState()", rendered.context);
    await drain(20);
    const left = surfaces(rendered);
    eq(left.pending, false, `F-7 (${scenario.name}): the pending decision is released`);
    eq(left.reloads, 1, `F-7 (${scenario.name}): by reopening the project as it is stored`);
    eq((harness.stored.productionAuthority || { receipts: [] }).receipts.length, 0,
      `F-7 (${scenario.name}): and storage is still untouched`);
  }
}

/* A LOST RESPONSE IS NOT A LOST APPROVAL. */
async function testLostResponseResolvesToSuccess() {
  const harness = wire({ onTransition: (attempt) => (attempt === 1 ? { commitThenLose: true } : null) });
  const { rendered } = await openedApproval({ wire: harness });
  ok(await settleApprovalReadiness(rendered), "L-0: prepared");
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain();
  const after = surfaces(rendered);

  /* L-1 — the outcome was resolved by asking storage, not by assuming. */
  eq(harness.count(/^\/api\/projects\/[^/]+\/project$/), 1, "L-1: storage was read to settle the outcome");
  /* L-2 — and the answer was success, with no second receipt of any kind. */
  eq(harness.transitions, 1, "L-2: the decision was submitted exactly once");
  eq((harness.stored.productionAuthority || { receipts: [] }).receipts.length, 1,
    "L-2: storage holds exactly one receipt");
  eq(after.pending, false, "L-2: and the submission is resolved");
  /* L-3 — the ceremony ran, once, after the durable answer. */
  ok(after.stamps.some((line) => /^APPROVED/.test(line)), "L-3: the approval is announced once it is proven");
  eq(after.stamps.filter((line) => /^APPROVED/.test(line)).length, 1, "L-3: exactly once");
  eq(after.canonValue, CANDIDATE, "L-3: on the exact candidate");
}

/* A DECISION STORAGE NEVER TOOK, RETRIED — AS THE SAME DECISION. */
async function testTransientFailureRetriesTheSameDecision() {
  const harness = wire({ onTransition: (attempt) => (attempt === 1 ? "throw" : null) });
  const { rendered } = await openedApproval({ wire: harness });
  ok(await settleApprovalReadiness(rendered), "T-0: prepared");
  const receiptBefore = vm.runInContext(
    "JSON.stringify((P.productionAuthority || { receipts: [] }).receipts)", rendered.context);
  eq(receiptBefore, "[]", "T-0: nothing is approved yet");
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain();
  const unresolved = surfaces(rendered);

  /* T-1 — an unknown outcome is checked against storage before anything else. */
  eq(unresolved.pendingOutcome, "uncommitted", "T-1: storage said it does not hold this approval");
  ok(/RETRY SAVING APPROVAL/.test(unresolved.modal), "T-1: so a retry of the same decision is offered");
  ok(/LEAVE UNAPPROVED/.test(unresolved.modal), "T-1: beside keeping the image for later");
  ok(unresolved.modal.includes(CANDIDATE), "T-1: with the image and target still identified");
  ok(!unresolved.stamps.some((line) => /^APPROVED/.test(line)), "T-1: and nothing announced");

  /* T-2 — AN AUTOSAVE WHILE THE OUTCOME IS UNCERTAIN IS NOT DISPATCHED. */
  const wireLength = harness.requests.length;
  vm.runInContext("P.meta.title = 'Edited while uncertain'; dirty();", rendered.context);
  await drain(40);
  eq(harness.requests.length, wireLength,
    "T-2: no snapshot carrying the unresolved authority state went out");
  eq(vm.runInContext("SAVE_REVISION > SAVED_REVISION", rendered.context), true,
    "T-2: and the edit is still recorded as unsaved rather than silently dropped");
  eq(vm.runInContext("P.meta.title", rendered.context), "Edited while uncertain",
    "T-2: the unrelated edit itself is preserved");

  /* T-3 — A PROJECT SWITCH WHILE THE OUTCOME IS UNCERTAIN DOES NOT SILENTLY GO. */
  await vm.runInContext("switchProject('other')", rendered.context);
  await drain(40);
  eq(harness.count(/\/api\/projects\/switch/), 0, "T-3: the switch is refused");
  const kept = surfaces(rendered);
  ok(kept.modal.includes(CANDIDATE), "T-3: and the approval surface is kept in front of the filmmaker");
  ok(kept.toasts.some((line) => /settled|Resolve it/.test(line)), "T-3: with the reason said out loud");

  /* T-4 — THE RETRY REPLAYS THE SAME RECEIPT. It does not take the decision
     again: the receipt id submitted the second time is the one created inside
     the original click. */
  const firstReceiptId = vm.runInContext(
    "((P.productionAuthority || { receipts: [] }).receipts[0] || {}).id || ''", rendered.context);
  ok(firstReceiptId, "T-4: the click created one receipt in this tab");
  await vm.runInContext("retryPendingApproval()", rendered.context);
  await drain();
  const done = surfaces(rendered);
  eq(harness.transitions, 2, "T-4: exactly one further submission was made");
  eq((harness.stored.productionAuthority || { receipts: [] }).receipts.length, 1,
    "T-4: and storage holds ONE receipt, not two");
  eq(harness.stored.productionAuthority.receipts[0].id, firstReceiptId,
    "T-4: the same receipt the human click created");
  eq(done.pending, false, "T-4: the submission is resolved");
  ok(done.stamps.some((line) => /^APPROVED/.test(line)), "T-4: and only now is it announced");
  eq(harness.count(/\/api\/media\/rename/), 0, "T-4: no rename at any point");
}

/* ==========================================================================
   §6  WHILE THIS APPROVAL OWNS THE SAVE PATH, THE WORKSPACE IS NOT EDITABLE.

   THE DEFECT THE FIRST CANDIDATE LEFT BEHIND. The submission guard refused to
   DISPATCH an ordinary snapshot while an approval outcome was unresolved, which
   is right — but a refusal to persist is not a refusal to accept. The recovery
   dialog was dismissible by Escape, by the backdrop, and by any closeModal(), so
   a filmmaker could close it, carry on working, and then lose that work to the
   recovery action they eventually took. Two honest halves that together told a
   lie: the workspace looked like it was taking changes, and the save path had
   already decided it would not keep them.

   What is asserted here is that the two halves now agree, and that the fence is
   a property of ONE submission rather than of the product. */
async function testRecoveryOwnsTheSavePath() {
  const scenarios = [
    {
      name: "persistence failure",
      wire: () => wire({ onTransition: (attempt) => (attempt === 1 ? "throw" : null) }),
      outcome: "uncommitted",
      resolveWith: "retryPendingApproval()",
      keeps: ["RETRY SAVING APPROVAL", "LEAVE UNAPPROVED"],
    },
    {
      name: "authority refusal",
      wire: () => wire({
        onTransition: () => ({
          status: 422,
          body: { ok: false, code: "AUTHORITY_EDGE_RECEIPT_MISMATCH", error: "The edge and its receipt disagree." },
        }),
      }),
      outcome: "refused",
      resolveWith: "reviewCurrentApprovalState()",
      keeps: ["REVIEW CURRENT STATE"],
    },
  ];

  for (const scenario of scenarios) {
    const harness = scenario.wire();
    const { rendered } = await openedApproval({ wire: harness });
    ok(await settleApprovalReadiness(rendered), `R-0 (${scenario.name}): prepared`);
    await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
    await drain();
    const held = surfaces(rendered);
    eq(held.pendingOutcome, scenario.outcome, `R-0 (${scenario.name}): the outcome is classified`);
    for (const action of scenario.keeps) {
      ok(held.modal.includes(action), `R-0 (${scenario.name}): ${action} is offered`);
    }

    /* R-1 — ESCAPE DOES NOT DISMISS IT. Escape reaches closeModal() through the
       one shared keydown handler, so this is that handler's own act, not a
       simulation of it. */
    const escaped = vm.runInContext(`(() => {
      closeModal();
      const modal = document.getElementById("modal");
      return { hidden: modal.classList.contains("hidden"), html: modal.innerHTML.slice(0, 200) };
    })()`, rendered.context);
    eq(escaped.hidden, false, `R-1 (${scenario.name}): a generic close does not hide recovery`);
    ok(/entity-approval-pending/.test(escaped.html), `R-1 (${scenario.name}): and the decision is still on screen`);

    /* R-2 — NOR CAN ANOTHER DIALOG TAKE THE SURFACE. The backdrop handler and
       every inline Cancel go through the same closeModal(); an unrelated
       openModal() is refused for the same reason. */
    const displaced = vm.runInContext(`(() => {
      openModal("<h3>Something else entirely</h3>");
      const modal = document.getElementById("modal");
      return { html: modal.innerHTML, hidden: modal.classList.contains("hidden") };
    })()`, rendered.context);
    ok(/entity-approval-pending/.test(displaced.html),
      `R-2 (${scenario.name}): an unrelated dialog cannot replace an unresolved decision`);
    ok(!/Something else entirely/.test(displaced.html), `R-2 (${scenario.name}): it is refused, not layered`);
    eq(displaced.hidden, false, `R-2 (${scenario.name}): and recovery stays visible`);

    /* R-3 — THE WORKSPACE IS FENCED, AND THE DIALOG IS NOT. */
    const fence = vm.runInContext(`(() => ({
      active: interactionFenceActive(),
      message: interactionFenceMessage(),
      railInert: document.getElementById("rail") ? document.getElementById("rail").inert === true : null,
      workspaceInert: document.getElementById("workspace") ? document.getElementById("workspace").inert === true : null,
      modalInert: document.getElementById("modal") ? document.getElementById("modal").inert === true : null,
      appInert: document.getElementById("app") ? document.getElementById("app").inert === true : null,
    }))()`, rendered.context);
    eq(fence.active, true, `R-3 (${scenario.name}): recovery fences human input`);
    eq(fence.railInert, true, `R-3 (${scenario.name}): the rail is inert`);
    eq(fence.workspaceInert, true, `R-3 (${scenario.name}): the workspace is inert`);
    eq(fence.modalInert, false, `R-3 (${scenario.name}): the dialog is not — its own controls must work`);
    eq(fence.appInert, false, `R-3 (${scenario.name}): and CineBraid is not globally locked`);
    ok(/not been settled/.test(fence.message), `R-3 (${scenario.name}): the fence says why`);

    /* R-4 — SHOTS CANNOT BE REACHED. The address bar and the back button get
       past an inert shell, so navigation is refused where every view change
       passes through, and the hash is put back. */
    const navigated = await vm.runInContext(`(async () => {
      location.hash = "#/shot/L1-01";
      await route();
      return { hash: location.hash, modal: document.getElementById("modal").innerHTML.slice(0, 200) };
    })()`, rendered.context);
    eq(navigated.hash, "#/prop/PR-TOOL", `R-4 (${scenario.name}): navigating away is put back`);
    ok(/entity-approval-pending/.test(navigated.modal), `R-4 (${scenario.name}): with the decision still in front`);

    /* R-5 — AND NO ORDINARY WORK CAN REACH STORAGE MEANWHILE. */
    const wireLength = harness.requests.length;
    vm.runInContext("P.meta.title = 'Typed behind the fence'; dirty();", rendered.context);
    await drain(40);
    eq(harness.requests.length, wireLength, `R-5 (${scenario.name}): nothing is dispatched while recovery is open`);
    eq(harness.count(/\/api\/projects\/switch/), 0, `R-5 (${scenario.name}): and project switching stays blocked`);

    /* R-6 — THE FILMMAKER'S OWN ACTION RESOLVES IT, AND ONLY THAT. */
    await vm.runInContext(scenario.resolveWith, rendered.context);
    await drain();
    const released = surfaces(rendered);
    eq(released.pending, false, `R-6 (${scenario.name}): the decision is resolved`);
    const after = vm.runInContext(`(() => ({
      fence: interactionFenceActive(),
      railInert: document.getElementById("rail").inert === true,
      workspaceInert: document.getElementById("workspace").inert === true,
      lock: modalLockOwner(),
    }))()`, rendered.context);
    eq(after.fence, false, `R-6 (${scenario.name}): the fence is released`);
    eq(after.railInert, false, `R-6 (${scenario.name}): the rail is editable again`);
    eq(after.workspaceInert, false, `R-6 (${scenario.name}): so is the workspace`);
    eq(after.lock, "", `R-6 (${scenario.name}): and the dialog is dismissible again`);

    /* R-7 — ORDINARY EDITING WORKS AFTERWARDS. Retry committed, so its window
       saves; abandonment reloads, so this one asserts the reload happened and
       the window was released rather than left half-fenced. */
    if (scenario.outcome === "uncommitted") {
      const before = harness.requests.length;
      /* dirty() arms a debounced write; the product's own flush is what sends it
         now, and it is the same call switchProject() makes. Drained against a
         condition rather than slept for. */
      await vm.runInContext("(async () => { P.meta.title = 'Edited after recovery'; dirty(); await flushPendingProjectSave(); })()", rendered.context);
      await drain(80);
      ok(harness.requests.length > before, `R-7 (${scenario.name}): ordinary saving resumes`);
      eq(vm.runInContext("P.meta.title", rendered.context), "Edited after recovery",
        `R-7 (${scenario.name}): and the edit is the one that was made`);
      eq(vm.runInContext("!!approvalSubmissionPending()", rendered.context), false,
        `R-7 (${scenario.name}): with no decision still held`);
      /* And a plain dialog closes normally again. */
      const plain = vm.runInContext(`(() => { openModal("<h3>Ordinary dialog</h3>"); closeModal();
        return document.getElementById("modal").classList.contains("hidden"); })()`, rendered.context);
      eq(plain, true, `R-7 (${scenario.name}): and ordinary dialogs dismiss normally again`);
    } else {
      eq(released.reloads, 1, `R-7 (${scenario.name}): the project is reopened as it is stored`);
    }
  }
}

/* ==========================================================================
   §7  NO ORDINARY UNSAVED WORK EXISTS WHEN THE DECISION BEGINS.

   The other half of the invariant, and the half that is not new: preparation
   binds readiness to a settled project, and confirmEntityApproval() re-asks that
   synchronously inside the click. What §6 adds is that no new work can be
   entered afterwards; what this proves is that none was outstanding before.
   Together they are the reason the recovery reload cannot cost the filmmaker
   anything they had legitimately entered. */
async function testNoUnsavedWorkWhenTheDecisionBegins() {
  const harness = wire({});
  const { rendered } = await openedApproval({ wire: harness });
  ok(await settleApprovalReadiness(rendered), "S-0: prepared against a settled project");

  /* S-1 — an ordinary edit made while the modal is open withdraws the control,
     before it is pressed rather than after. */
  vm.runInContext("P.meta.title = 'Typed while the modal was open'; dirty();", rendered.context);
  const unsettled = surfaces(rendered);
  eq(unsettled.confirmDisabled, true, "S-1: unsaved work withdraws confirmation");
  ok(/not been saved|have not reached storage/i.test(unsettled.readinessText),
    "S-1: and says the project is not saved rather than blaming the image");

  /* S-2 — and the writer refuses it too, so a replayed or scripted click cannot
     take a decision while ordinary work is outstanding. */
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain(40);
  const refused = surfaces(rendered);
  eq(refused.canon, 0, "S-2: no Canon is written while unsaved work exists");
  eq(refused.receipts, 0, "S-2: and no receipt is minted");
  eq(refused.pending, false, "S-2: and no submission is opened");

  /* S-3 — once that work is durable the approval proceeds, and the work is in
     the document the approval is taken against. So a later recovery reload
     restores a project that already contains it. dirty() arms a debounced write;
     the product's own flush is what sends it now. */
  await vm.runInContext("flushPendingProjectSave()", rendered.context);
  await drain(120);
  eq(vm.runInContext("projectSaveSettled().settled", rendered.context), true, "S-3: the edit reaches storage");
  eq(harness.stored.meta.title, "Typed while the modal was open", "S-3: and storage holds it");
  ok(await settleApprovalReadiness(rendered), "S-3: readiness is re-established against the newer revision");
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await drain();
  const approved = surfaces(rendered);
  eq(approved.canon, 1, "S-3: the approval is taken");
  eq(harness.stored.meta.title, "Typed while the modal was open",
    "S-3: and the durable document that carries it still carries the earlier work");
  eq(harness.count(/\/api\/media\/rename/), 0, "S-3: with no rename, as before");
}

/* ==========================================================================
   NEGATIVE CONTROLS — the protections this slice must not have loosened.
   ========================================================================== */
async function testNegativeControlsStillFailClosed() {
  /* N-1 — NO TRUSTED GESTURE, NO CANON. Preparation is not authorisation. */
  const { rendered, harness } = await openedApproval();
  ok(await settleApprovalReadiness(rendered), "N-1: prepared");
  rendered.gesture.close();
  await rendered.context.confirmEntityApproval(false);
  await drain(40);
  const refused = surfaces(rendered);
  eq(refused.canon, 0, "N-1: a prepared identity does not approve without a human gesture");
  eq(refused.receipts, 0, "N-1: and mints no receipt");
  eq(harness.transitions, 0, "N-1: and writes nothing");

  /* N-2 — A SHEET STILL CANNOT BECOME AN IDENTITY, prepared or not. */
  const sheet = importedFixture();
  sheet.props[0].candidateFiles = [{ stored: CANDIDATE, original: "sheet.png", coverageJobType: "sheet", coverageSheetType: "angles" }];
  const sheetRun = await openedApproval({ project: sheet });
  await drain(40);
  const sheetState = surfaces(sheetRun.rendered);
  eq(sheetState.canon, 0, "N-2: a declared sheet writes no primary authority");
  ok(!/data-approval-mode="primary-authority"/.test(sheetState.modal) || sheetState.confirmDisabled !== false,
    "N-2: and is never offered as an approvable identity");

  /* N-3 — AN UNDECLARED CANDIDATE IS STILL NOT ELIGIBLE. */
  const undeclared = importedFixture();
  undeclared.props[0].candidateFiles = [{ stored: CANDIDATE, original: "mystery.png" }];
  const undeclaredRun = await openedApproval({ project: undeclared });
  await drain(40);
  eq(surfaces(undeclaredRun.rendered).canon, 0, "N-3: an undeclared candidate approves nothing");

  /* N-4 — THE RECEIPT VALIDATOR IS UNTOUCHED, PROVEN BY MAKING IT REFUSE.

     Two fail-closed behaviours this slice must not have loosened, both exercised
     against the shipped kernel rather than asserted from source:

       * a receipt whose durable identity does not match the live edge is not a
         current approval — the exact state the old rename sequence produced;
       * repairCanonValue() still refuses to move a receipt whose ORIGINAL
         identity was empty, which is why an approval taken before identity was
         prepared could never be repaired afterwards.

     Both remain true. The difference is that nothing now asks the second one to
     rescue the first, because this approval no longer moves its file. */
  const kernel = require("../public/shared-authority-kernel.js");
  const target = { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default" };
  const approved = await openedApproval();
  ok(await settleApprovalReadiness(approved.rendered), "N-4: prepared");
  await approved.rendered.gesture.act(() => approved.rendered.context.confirmEntityApproval(false));
  await drain();
  const stored = approved.harness.stored;
  ok(kernel.hasCurrentHumanAuthority(stored, target), "N-4: the durable approval reads as current");

  const tampered = JSON.parse(JSON.stringify(stored));
  tampered.props[0].continuityStates[0].approvedAssetId = "asset-" + "0".repeat(32);
  tampered.props[0].approvedAssetId = "asset-" + "0".repeat(32);
  ok(!kernel.hasCurrentHumanAuthority(tampered, target),
    "N-4: an edge whose identity no longer matches its receipt is not a current approval");

  const renamedBytes = JSON.parse(JSON.stringify(stored));
  renamedBytes.props[0].continuityStates[0].approvedFile = "SOMETHING-ELSE.png";
  renamedBytes.props[0].approvedFile = "SOMETHING-ELSE.png";
  ok(!kernel.hasCurrentHumanAuthority(renamedBytes, target),
    "N-4: and neither is an edge whose value no longer matches it");

  /* The repair that used to follow the rename, asked to move a receipt that
     never carried an identity. It refuses, exactly as it did before. */
  const emptyIdentity = JSON.parse(JSON.stringify(stored));
  for (const receipt of emptyIdentity.productionAuthority.receipts) receipt.assetId = "";
  emptyIdentity.props[0].continuityStates[0].approvedAssetId = "";
  emptyIdentity.props[0].approvedAssetId = "";
  let repairRefused = false;
  try {
    approved.rendered.context.repairCanonValue(emptyIdentity, {
      ...target, from: CANDIDATE, to: "RENAMED.png", assetId: harnessAssetId(`props/${CANDIDATE}`),
    });
  } catch (error) {
    repairRefused = true;
  }
  ok(repairRefused || emptyIdentity.productionAuthority.receipts.every((r) => r.value !== "RENAMED.png"),
    "N-4: a receipt with no original identity is still never repaired onto new bytes");
}

async function main() {
  testNoRenameInPrimaryApproval();
  await testPreparedIdentityOnDisk();
  await testReadinessBinding();
  await testOneDurableApproval();
  await testFailureLeavesEverythingRecoverable();
  await testLostResponseResolvesToSuccess();
  await testTransientFailureRetriesTheSameDecision();
  await testRecoveryOwnsTheSavePath();
  await testNoUnsavedWorkWhenTheDecisionBegins();
  await testNegativeControlsStillFailClosed();
  console.log(
    `Alpha imported-reference approval suite passed ${checks} checks: entity primary-reference approval performs no rename, `
    + "prepares one stable durable identity for the exact selected file before the trusted click, binds confirmation to what is "
    + "on screen, produces one receipt and one accepted transition per human decision, announces approval only after storage "
    + "accepts it, and leaves prior Canon, the media and the candidate recoverable through every refusal, lost response, "
    + "retry, autosave and project switch — and that while one is unresolved the recovery decision cannot be escaped, "
    + "navigated away from, or replaced, while no ordinary unsaved work existed when it began. Provider calls made: 0.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
