/* CINEBRAID — CANON.
 *
 * Browser and Node, the same way public/shared-media-disposition.js is shared.
 *
 * ---------------------------------------------------------------------------
 * THE WHOLE MODEL, AND THERE IS NO SECOND PAGE.
 *
 *     CANON      a creator explicitly approved these exact bytes as production
 *                truth. A current receipt in this project's ledger, and a live
 *                edge that matches it exactly.
 *     REFERENCE  useful selected supporting media. May guide generation and
 *                review. Never establishes Canon. Lives in
 *                public/shared-entity-slots.js and has no receipt.
 *     HISTORIC   an old pointer with no current Canon behind it. Visible,
 *                traceable, never promoted.
 *
 * Six sentences this file has to make literally true:
 *
 *   1. HUMAN EXPLICITLY APPROVES CANON.
 *   2. AUTOMATION ONLY RECOMMENDS.
 *   3. SUPPORTING REFERENCES ARE NOT CANON.
 *   4. LEGACY POINTERS WITHOUT CURRENT CANON ARE HISTORIC.
 *   5. STATE ANCESTRY IS IMMUTABLE AFTER CREATION.
 *   6. PREFLIGHT DOES NOT MUTATE.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE LOOKS THE WAY IT DOES (Dogfood #2, the simplification pass).
 *
 * Batches 1B, 1C and 1D each added a guard and each failed acceptance, because
 * the shape being guarded kept offering a way around:
 *
 *   1B  the credential was a SHAPE two strings could forge.
 *   1C  the credential became an object identity — and shipped a synthetic
 *       source that minted one with no event at all.
 *   1D  the synthetic source went, and the credential became a CAPABILITY: a
 *       token minted in a click and spent by whatever code ran next. All
 *       twelve shipped surfaces minted target-only tokens, so the value and
 *       asset checks were optional on every real approval; and the gesture
 *       window stayed open across every Promise microtask in the event's
 *       macrotask. Meanwhile the rules themselves — ownership, edge reading,
 *       edge writing, persistence — were exported INSTALLERS that ordinary
 *       application code could replace after boot.
 *
 * THE SIMPLIFICATION IS A DELETION, NOT A SEVENTH GUARD.
 *
 *   THERE IS NO CAPABILITY.  A Canon write is a single synchronous call that
 *   happens inside the trusted user event itself. It names the target, the
 *   exact value and the exact asset identity in one statement. Nothing is
 *   minted, so nothing can be carried across an `await`, held by a later
 *   microtask, or spent on a decision the person never saw.
 *
 *   THERE ARE NO INSTALLERS.  Target validation, ownership, edge reading, edge
 *   writing, receipt validation, staging and persistence are private functions
 *   in this file. There is no parameter for them, no setter for them, and no
 *   exported name that reaches them. Application code cannot redefine
 *   production truth after boot because there is nothing to redefine.
 *
 * WHAT KEEPS "HUMAN" HONEST is one primitive the browser already gives us:
 * `event.isTrusted`, which the user agent sets and page script cannot forge.
 * The window it opens is closed on a MICROTASK, so it covers the synchronous
 * dispatch of the event and nothing that resumes after it. Automation lives in
 * continuations; it is never inside that window.
 *
 * CineBraid is a local, single-user application. This is NOT authentication,
 * NOT cryptographic provenance, and NOT a defence against a hostile operator of
 * the machine. The invariant that IS required, and the only one:
 *
 *     AUTOMATION AND ORDINARY INTERNAL APPLICATION PATHS MUST NOT BE ABLE TO
 *     SYNTHESIZE HUMAN PRODUCTION AUTHORITY.
 *
 * Deliberately absent, and required to stay absent:
 *   - file or network I/O
 *   - provider or model awareness
 *   - Date.now(), new Date(), Math.random() other than through a supplied `at`
 *   - UI wording. The kinds and codes below are TOKENS. */

/* ========================================================================== */
/* VOCABULARY                                                                 */
/* ========================================================================== */

/* EVERY PRODUCTION OBJECT A HUMAN CAN HOLD CANON OVER. A closed set of four.
 *
 * Coverage and expression slots are NOT here and must not come back. They are
 * supporting references; public/shared-entity-slots.js owns them, they carry no
 * receipt, and no consumer may read one as Canon. Removing an authority surface
 * is a smaller model than instrumenting one. */
const AUTHORITY_TARGET_KINDS = [
  "shot-frame",         /* the still approved for one frame; the opening frame's edge is also the shot's */
  "shot-motion",        /* the video approved for one motion unit */
  "shot-delivery",      /* the shot's final deliverable pointer, still or video */
  "entity-state",       /* a continuity state's approved reference */
];

/* Every durable entity collection that can own an entity-state authority
   pointer. Keep this aligned with shared-entity-ownership.js.

   THIS IS THE CANONICAL LIST AND IT IS EXPORTED. An independent safety layer
   that re-declares the entity set is not independent — it is a second copy that
   drifts, and the copy that drifts silently is the one that stops enumerating a
   list the kernel still resolves. Frozen because a canonical set an ordinary
   caller can shorten is the "installer" failure mode this file exists to end. */
const AUTHORITY_ENTITY_LISTS = Object.freeze(["characters", "locations", "props", "vehicles", "audio"]);

const AUTHORITY_COMMANDS = [
  "approve-shot-frame",
  "approve-shot-motion",
  "approve-shot-delivery",
  "approve-entity-state",
];

const AUTHORITY_COMMAND_FOR_KIND = {
  "shot-frame": "approve-shot-frame",
  "shot-motion": "approve-shot-motion",
  "shot-delivery": "approve-shot-delivery",
  "entity-state": "approve-entity-state",
};

const AUTHORITY_RECEIPT_STATES = ["current", "superseded", "revoked"];
const AUTHORITY_REVOCATION_REASONS = ["replaced", "withdrawn", "target-cleared", "target-removed"];

/* The only actor and the only act. A list of one each, on purpose. */
const AUTHORITY_ACTOR = "human";
const AUTHORITY_ACT = "explicit-approval";

/* Where the ledger lives, and the shape version it is written at. The version
   is VALIDATED, not decorative: a ledger written by a build this one does not
   understand is not something to read approvals out of, or append to. */
const AUTHORITY_LEDGER_KEY = "productionAuthority";
const AUTHORITY_LEDGER_VERSION = 1;

/* WHY A LEDGER OR A RECEIPT WAS REFUSED. Enumerated so a diagnostic surface can
   switch on a token and a repair tool can group by cause, rather than matching
   prose that will be reworded. */
const AUTHORITY_DIAGNOSTIC_CODES = [
  "ledger-not-an-object",
  "receipts-not-an-array",
  "receipt-not-an-object",
  "receipt-id-missing",
  "receipt-id-duplicated",
  "receipt-actor-not-human",
  "receipt-act-invalid",
  "receipt-command-invalid",
  "receipt-command-mismatched",
  "receipt-target-invalid",
  "receipt-target-key-mismatched",
  "receipt-value-missing",
  "receipt-status-invalid",
  "receipt-sequence-invalid",
  "receipt-sequence-duplicated",
  "receipt-provenance-missing",
  "target-multiple-current-receipts",
];

function kernelObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function kernelText(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function kernelList(value) {
  return Array.isArray(value) ? value : [];
}
function kernelInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function authorityError(code, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.authorityViolation = true;
  error.detail = kernelObject(detail);
  return error;
}

/* ========================================================================== */
/* 1. THE CANONICAL TARGET DESCRIPTOR                                         */
/* ========================================================================== */

/* ONE SHAPE FOR "WHICH PRODUCTION OBJECT", and one string that identifies it.
 *
 * An earlier audit accepted a receipt whose `targetId` matched while its
 * `shotId` and `frameId` named something else — the two were stored separately
 * and only one was compared. The key is DERIVED from the parts here, and
 * validation re-derives it, so the two cannot disagree without being caught.
 *
 * Returns null rather than a partial descriptor. A half-identified target is
 * exactly what lets a receipt for one frame answer for another. */
function authorityTarget(details) {
  const it = kernelObject(details);
  /* `kind` is the field; `targetType` is accepted for the call sites that
     already speak it, so both vocabularies resolve to one descriptor. */
  const kind = kernelText(it.kind || it.targetType);
  const shotId = kernelText(it.shotId);
  const frameId = kernelText(it.frameId);
  const unitKey = kernelText(it.unitKey || it.segmentId || it.clipId);
  const list = kernelText(it.list || it.entityList);
  const entityId = kernelText(it.entityId);
  const stateId = kernelText(it.stateId);
  const base = { kind, shotId: "", frameId: "", unitKey: "", list: "", entityId: "", stateId: "", slotId: "" };
  if (kind === "shot-frame") {
    if (!shotId || !frameId) return null;
    return { ...base, shotId, frameId, key: `shot-frame:${shotId}#${frameId}` };
  }
  if (kind === "shot-motion") {
    if (!shotId || !unitKey) return null;
    return { ...base, shotId, unitKey, key: `shot-motion:${shotId}#${unitKey}` };
  }
  if (kind === "shot-delivery") {
    if (!shotId) return null;
    return { ...base, shotId, key: `shot-delivery:${shotId}` };
  }
  if (kind === "entity-state") {
    if (!list || !entityId || !stateId) return null;
    return { ...base, list, entityId, stateId, key: `entity-state:${list}:${entityId}#${stateId}` };
  }
  return null;
}

function describeTarget(target) {
  const it = kernelObject(target);
  if (it.kind === "shot-frame") return `Frame ${it.frameId} of ${it.shotId}`;
  if (it.kind === "shot-motion") return `Motion ${it.unitKey} of ${it.shotId}`;
  if (it.kind === "shot-delivery") return `The final deliverable for ${it.shotId}`;
  if (it.kind === "entity-state") return `${it.list} ${it.entityId} state ${it.stateId}`;
  return "This edge";
}

/* ========================================================================== */
/* 2. IS A REAL PERSON DOING SOMETHING RIGHT NOW                              */
/* ========================================================================== */

/* THERE IS NO TOKEN. This is a live predicate, asked inside the Canon write.
 *
 * WHAT "RIGHT NOW" MEANS, and getting this exactly right took three attempts.
 *
 * `event.isTrusted` is set by the user agent and page script cannot forge it,
 * so a capture-phase listener knows a real person acted. The hard part is the
 * WINDOW — how long that stays true.
 *
 *   Batch 1D closed it with `setTimeout(fn, 0)`. Timers run after the microtask
 *   queue drains, so every `.then()` continuation in the event's macrotask still
 *   saw it open. The audit minted from one.
 *
 *   Closing on a microtask instead is WRONG IN THE OTHER DIRECTION, and only a
 *   real browser shows it: the event loop runs a microtask checkpoint whenever
 *   the JS stack empties, which is after EVERY listener — so a microtask queued
 *   during the capture phase runs before the target's own handler, and every
 *   approval in the product refuses.
 *
 * So the window is not a span of time at all. It is AN EVENT DISPATCH, and the
 * question is whether the code asking is running inside the one that opened it:
 *
 *     window.event === the trusted event this gesture was opened for
 *
 * `window.event` is set by the user agent around each listener invocation and
 * restored afterwards, so it is exactly true inside the synchronous handler and
 * exactly false in every continuation the handler queues — an `await` resumption,
 * a `.then()`, a timer, an automation loop. No timer, no span, no leak.
 *
 * In a bare Node process there is no dispatch to be inside; the composition that
 * owns the event target is the boundary, and the stored gesture is the whole
 * check. tests/render-harness.js sets `context.event` around its dispatch, so
 * the page code it runs is held to the same rule the browser holds it to. */
let TRUSTED_GESTURE = null;
let GESTURE_SEQUENCE = 0;

/* Composition installs a source once. Absent — which is the state in a bare
   Node process — every Canon write FAILS CLOSED. */
let MANUAL_ACTION_SOURCE = "";

function trustedGestureOpen() {
  return !!TRUSTED_GESTURE;
}
function manualActionSourceInstalled() {
  return MANUAL_ACTION_SOURCE;
}

/* THE EVENT CURRENTLY BEING DISPATCHED, or null.
 *
 * READ THROUGH THE PROTOTYPE ACCESSOR THE USER AGENT DEFINED, captured once at
 * install time. `window.event` is an attribute on the Window interface, so it
 * lives as an accessor on the prototype — and page script can shadow it with an
 * own property (`Object.defineProperty(window, "event", { get })`) that returns
 * whatever it likes. Calling the original getter with `window` as the receiver
 * steps over any such shadow, so the answer comes from the user agent rather
 * than from whoever last assigned to the name.
 *
 * This is not a defence against a hostile operator of the machine, which stays
 * explicitly out of scope. It closes the ORDINARY mistake: code that reassigns a
 * global and is then believed. */
let NATIVE_EVENT_GETTER = null;
function captureNativeEventGetter() {
  if (typeof window === "undefined" || !window) return;
  for (let scope = Object.getPrototypeOf(window); scope; scope = Object.getPrototypeOf(scope)) {
    const descriptor = Object.getOwnPropertyDescriptor(scope, "event");
    if (descriptor && typeof descriptor.get === "function") { NATIVE_EVENT_GETTER = descriptor.get; return; }
  }
}
function dispatchingEvent() {
  if (typeof window === "undefined" || !window) return null;
  if (NATIVE_EVENT_GETTER) {
    try { return NATIVE_EVENT_GETTER.call(window) || null; } catch { return null; }
  }
  return window.event || null;
}
/* Does this runtime report the current dispatch at all. A window without it is
   a runtime this build does not know how to scope a gesture in, and the answer
   there is to refuse rather than to fall back to a span of time — falling back
   is what every earlier batch did, and it is the hole each audit walked in. */
function dispatchScopeAvailable() {
  return typeof window !== "undefined" && !!window && "event" in window;
}

/* THE BROWSER INSTALLER, AND THE ONLY WAY THE WINDOW OPENS.
 *
 * INSTALL ONCE, AND ONLY FROM THE COMPOSITION THAT BOOTS THE PAGE.
 * public/bootstrap.js calls this before load(). Any later call is refused, so
 * page script cannot install a second source on an event target it controls and
 * then fire its own events at it.
 *
 * RETURNS `endGesture` TO ITS ONE CALLER. Not exported, not on `window`: the
 * composition root gets a handle that can only ever CLOSE the window, which is
 * the direction that refuses more Canon rather than less. A test composition
 * that must assert the refusal path uses it; nothing inside the page can. */
function installBrowserManualActionSource(target) {
  if (MANUAL_ACTION_SOURCE) return false;
  const root = target || (typeof document !== "undefined" ? document : null);
  if (!root || typeof root.addEventListener !== "function") return false;
  for (const type of ["click", "keydown", "change", "submit"]) {
    root.addEventListener(type, (event) => {
      if (!event || event.isTrusted !== true) return;
      GESTURE_SEQUENCE += 1;
      /* The EVENT is kept, not a timestamp. It is what the check compares. */
      TRUSTED_GESTURE = { id: `gesture-${GESTURE_SEQUENCE}`, kind: kernelText(type), event };
    }, true);
  }
  captureNativeEventGetter();
  MANUAL_ACTION_SOURCE = "browser-trusted-event";
  return { ok: true, endGesture: () => { TRUSTED_GESTURE = null; } };
}

/* THE ONE CHECK. Called inside the Canon write, never before it, never by a
   caller who then does something else with the answer. */
function requireTrustedGesture(what) {
  const gesture = TRUSTED_GESTURE;
  const refuse = () => {
    throw authorityError(
      "MANUAL_ACTION_REQUIRED",
      `${what} can only be approved by an explicit human approval action. No authority was written.`,
      { source: MANUAL_ACTION_SOURCE || "none" },
    );
  };
  if (!gesture) refuse();
  /* Wherever the runtime can tell us, the answer is whether we are INSIDE the
     dispatch of the very event this gesture was opened for. A continuation —
     `await`, `.then()`, a timer, an automation loop — is not. */
  if (dispatchScopeAvailable() && dispatchingEvent() !== gesture.event) refuse();
  return { id: gesture.id, kind: gesture.kind };
}

/* ========================================================================== */
/* 3. LEDGER VALIDATION — the whole schema, at every read                     */
/* ========================================================================== */

/* ONE RECEIPT, CHECKED COMPLETELY: id, actor, act, command, command/kind
   agreement, canonical target, target-key agreement with the component fields,
   value, status, sequence, and the marker that says a trusted human action
   issued it. */
function validateReceiptShape(row, index) {
  const problems = [];
  const receipt = kernelObject(row);
  const at = { index, id: kernelText(receipt.id) };
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { ok: false, receipt: null, problems: [{ code: "receipt-not-an-object", ...at }] };
  }
  if (!kernelText(receipt.id)) problems.push({ code: "receipt-id-missing", ...at });
  if (kernelText(receipt.actor) !== AUTHORITY_ACTOR) problems.push({ code: "receipt-actor-not-human", ...at, actor: kernelText(receipt.actor) });
  if (kernelText(receipt.act) !== AUTHORITY_ACT) problems.push({ code: "receipt-act-invalid", ...at, act: kernelText(receipt.act) });
  const command = kernelText(receipt.command);
  if (!AUTHORITY_COMMANDS.includes(command)) problems.push({ code: "receipt-command-invalid", ...at, command });
  const target = authorityTarget(receipt);
  if (!target) problems.push({ code: "receipt-target-invalid", ...at, kind: kernelText(receipt.kind || receipt.targetType) });
  else {
    /* THE KEY IS RE-DERIVED FROM THE PARTS. A stored key that disagrees with the
       fields beside it is a forgery. */
    if (kernelText(receipt.targetKey) && kernelText(receipt.targetKey) !== target.key) {
      problems.push({ code: "receipt-target-key-mismatched", ...at, stored: kernelText(receipt.targetKey), derived: target.key });
    }
    if (AUTHORITY_COMMAND_FOR_KIND[target.kind] !== command && AUTHORITY_COMMANDS.includes(command)) {
      problems.push({ code: "receipt-command-mismatched", ...at, command, kind: target.kind });
    }
  }
  if (!kernelText(receipt.value)) problems.push({ code: "receipt-value-missing", ...at });
  if (!AUTHORITY_RECEIPT_STATES.includes(kernelText(receipt.status))) problems.push({ code: "receipt-status-invalid", ...at, status: kernelText(receipt.status) });
  const sequence = kernelInteger(receipt.sequence);
  if (sequence === null || sequence < 1) problems.push({ code: "receipt-sequence-invalid", ...at, sequence: receipt.sequence });
  /* THE MARKER A TRUSTED HUMAN ACTION LEAVES. Not a credential — there is no
     credential — but a receipt that does not carry it was not written by this
     kernel, and the kernel will not vouch for it. */
  if (!kernelText(kernelObject(receipt.provenance).manualAction)) problems.push({ code: "receipt-provenance-missing", ...at });
  return { ok: !problems.length, receipt: problems.length ? null : { ...receipt, target }, problems };
}

/* THE WHOLE LEDGER, AND THE CROSS-ROW RULES no single row can enforce: unique
   ids, unique sequences, and EXACTLY ONE CURRENT RECEIPT PER TARGET.
 *
 * FAILS CLOSED AND DOES NOT REPAIR. A malformed ledger yields `trusted: false`
 * and a diagnostic list; every Canon question then answers "no". Silently
 * dropping the bad rows would invent an answer the project does not have. */
function validateAuthorityLedger(project) {
  const raw = kernelObject(project)[AUTHORITY_LEDGER_KEY];
  const diagnostics = [];
  if (raw === undefined || raw === null) {
    /* NO LEDGER IS NOT A MALFORMED LEDGER. It is a project in which nobody has
       approved anything yet — every pre-receipt project, and the honest answer
       for every legacy pointer in it. */
    return { present: false, trusted: true, version: AUTHORITY_LEDGER_VERSION, receipts: [], byTarget: new Map(), diagnostics };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({ code: "ledger-not-an-object" });
    return { present: true, trusted: false, version: 0, receipts: [], byTarget: new Map(), diagnostics };
  }
  const ledger = kernelObject(raw);
  if (ledger.receipts !== undefined && !Array.isArray(ledger.receipts)) {
    diagnostics.push({ code: "receipts-not-an-array" });
    return { present: true, trusted: false, version: kernelInteger(ledger.version) || 0, receipts: [], byTarget: new Map(), diagnostics };
  }
  const declaredVersion = kernelInteger(ledger.version) || 0;
  if (declaredVersion > AUTHORITY_LEDGER_VERSION || declaredVersion < 1) {
    diagnostics.push({
      code: "AUTHORITY_LEDGER_VERSION_UNSUPPORTED",
      message: `This project's approval records are written at version ${JSON.stringify(ledger.version)}, which this build of CineBraid does not read. No approval is recognised.`,
      version: ledger.version,
      supported: AUTHORITY_LEDGER_VERSION,
    });
    return { present: true, trusted: false, version: declaredVersion, receipts: [], byTarget: new Map(), diagnostics };
  }
  const rows = kernelList(ledger.receipts);
  const receipts = [];
  const seenIds = new Set();
  const seenSequences = new Set();
  for (let index = 0; index < rows.length; index++) {
    const outcome = validateReceiptShape(rows[index], index);
    diagnostics.push(...outcome.problems);
    if (!outcome.ok) continue;
    const id = kernelText(outcome.receipt.id);
    if (seenIds.has(id)) { diagnostics.push({ code: "receipt-id-duplicated", index, id }); continue; }
    seenIds.add(id);
    const sequence = kernelInteger(outcome.receipt.sequence);
    if (seenSequences.has(sequence)) { diagnostics.push({ code: "receipt-sequence-duplicated", index, id, sequence }); continue; }
    seenSequences.add(sequence);
    receipts.push(outcome.receipt);
  }
  /* Exactly one current per target. Two is not "the newest wins" — it is a
     ledger nobody can read. */
  const byTarget = new Map();
  for (const receipt of receipts) {
    const key = receipt.target.key;
    const bucket = byTarget.get(key) || { key, all: [], current: [] };
    bucket.all.push(receipt);
    if (kernelText(receipt.status) === "current") bucket.current.push(receipt);
    byTarget.set(key, bucket);
  }
  for (const bucket of byTarget.values()) {
    if (bucket.current.length > 1) {
      diagnostics.push({ code: "target-multiple-current-receipts", targetKey: bucket.key, ids: bucket.current.map((row) => kernelText(row.id)) });
    }
  }
  return {
    present: true,
    trusted: diagnostics.length === 0,
    version: kernelInteger(ledger.version) || 0,
    receipts,
    byTarget,
    diagnostics,
  };
}

/* The diagnostic a surface prints when a project's Canon cannot be read.
   Deterministic ordering, so the same damage produces the same message. */
function authorityLedgerDiagnostics(project) {
  const view = validateAuthorityLedger(project);
  return view.diagnostics
    .map((row) => ({ ...row }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : (Number(a.index) || 0) - (Number(b.index) || 0)));
}

/* ========================================================================== */
/* 4. THE LIVE EDGE — private, fixed, one implementation                      */
/* ========================================================================== */

/* WHERE EVERY CANON EDGE LIVES, for all four target kinds.
 *
 * This used to be installed from public/shared-production-authority.js through
 * `installAuthorityEdgeReader`, with a matching `installAuthorityEdgeWriter`,
 * an `installAuthorityOwnershipPolicy` and an `installAuthorityProjectCommitter`
 * beside them. All four were exported, none was install-once, and the 1D audit
 * replaced the writer with a closure that mutated the live project and threw.
 *
 * There is no installer now. The kernel knows CineBraid's document shape, and
 * the reader and writer below are the same knowledge stated twice — read where
 * the writer writes — so the post-commit "does the project agree with the
 * receipt" check compares like with like. */

/* A shot edge's durable asset identity. `stampShotApprovalIdentity` in
   shared-media-disposition.js writes `<field>AssetId`; the legacy
   `approvalIdentity.<field>` shape is still accepted on read because a project
   may carry it, but nothing writes it any more. */
function shotEdgeAssetId(record, field) {
  const it = kernelObject(record);
  return kernelText(it[`${field}AssetId`]) || kernelText(kernelObject(it.approvalIdentity)[field]);
}

/* Which half of the delivery pointer currently holds the shot's deliverable,
   and the identity stamped beside it. One place, so read and write and clear
   cannot disagree about what "the delivery edge" is. */
function deliveryEdgeOf(shot) {
  const s = kernelObject(shot);
  const creation = kernelObject(s.creationBrief);
  const shotStill = kernelText(s.finalStillFile);
  if (shotStill) return {
    form: "still", value: shotStill, assetId: kernelText(s.finalStillAssetId),
    recordId: kernelText(s.id), field: "finalStillFile",
  };
  const briefStill = kernelText(creation.finalStillFile);
  if (briefStill) return {
    form: "still", value: briefStill, assetId: kernelText(creation.finalStillAssetId),
    recordId: `${kernelText(s.id)}:creationBrief`, field: "finalStillFile",
  };
  const motion = kernelText(creation.approvedMotionFile);
  if (motion) return {
    form: "video", value: motion, assetId: kernelText(creation.approvedMotionAssetId),
    recordId: `${kernelText(s.id)}:creationBrief`, field: "approvedMotionFile",
  };
  return { form: "", value: "", assetId: "", recordId: "", field: "" };
}

function readAuthorityEdge(project, target) {
  const P = kernelObject(project);
  const it = kernelObject(target);
  const empty = (form = "") => ({ value: "", assetId: "", recordId: "", field: "", form });
  const shot = () => kernelList(P.shots).map(kernelObject).find((row) => kernelText(row.id) === it.shotId) || null;
  const entity = () => kernelList(P[it.list]).map(kernelObject).find((row) => kernelText(row.id) === it.entityId) || null;
  if (it.kind === "shot-frame") {
    const s = shot();
    if (!s) return empty();
    const frames = kernelList(s.keyframes).map(kernelObject);
    const index = frames.findIndex((row) => kernelText(row.id) === it.frameId);
    if (index < 0) return empty();
    const frame = frames[index], frameValue = kernelText(frame.winner);
    if (frameValue) return {
      value: frameValue, assetId: shotEdgeAssetId(frame, "winner"),
      recordId: kernelText(frame.id), field: "winner", form: "keyframe",
    };
    const shotValue = index === 0 ? kernelText(s.winner) : "";
    return shotValue ? {
      value: shotValue, assetId: shotEdgeAssetId(s, "winner"),
      recordId: kernelText(s.id), field: "winner", form: "shot-opening-frame",
    } : empty();
  }
  if (it.kind === "shot-motion") {
    const s = shot();
    if (!s) return empty();
    const matches = kernelList(s.clips).map(kernelObject)
      .filter((row) => kernelText(row.id) === it.unitKey || kernelText(row.suffix) === it.unitKey);
    if (matches.length !== 1) return empty(matches.length ? "ambiguous-motion-unit" : "");
    const unit = matches[0];
    return {
      value: kernelText(unit.videoWinner), assetId: shotEdgeAssetId(unit, "videoWinner"),
      recordId: kernelText(unit.id), field: "videoWinner", form: "motion-unit",
    };
  }
  if (it.kind === "shot-delivery") {
    const s = shot();
    return s ? deliveryEdgeOf(s) : empty();
  }
  if (it.kind === "entity-state") {
    const x = entity();
    if (!x) return empty();
    const state = kernelList(x.continuityStates).map(kernelObject)
      .find((row) => kernelText(row.id) === it.stateId);
    if (state) {
      const own = kernelText(state.approvedFile);
      if (own) return {
        value: own, assetId: kernelText(state.approvedAssetId),
        recordId: kernelText(state.id), field: "approvedFile", form: "continuity-state",
      };
      if (state.isDefault !== true) return empty();
    } else if (it.stateId !== "state-default") return empty();
    return {
      value: kernelText(x.approvedFile), assetId: kernelText(x.approvedAssetId),
      recordId: kernelText(x.id), field: "approvedFile", form: "entity-default",
    };
  }
  return empty();
}

function liveAuthorityEdge(project, target) {
  const wanted = authorityTarget(target);
  if (!wanted) return { value: "", assetId: "", recordId: "", field: "", form: "" };
  const edge = kernelObject(readAuthorityEdge(project, wanted));
  return {
    value: kernelText(edge.value), assetId: kernelText(edge.assetId),
    recordId: kernelText(edge.recordId), field: kernelText(edge.field), form: kernelText(edge.form),
  };
}

/* WRITING THE EDGE. The exact mirror of the reader above, and private for the
   same reason: a caller-supplied writer is a closure over whatever the caller
   chose, which is how the 1D audit mutated a live project from inside a
   transaction that then threw.

   Returns false when the target is not in the project, so the transaction can
   refuse before it writes a receipt for something that does not exist. */
function writeAuthorityEdge(draft, target, details) {
  const P = kernelObject(draft);
  const it = kernelObject(target);
  const value = kernelText(kernelObject(details).value);
  const assetId = kernelText(kernelObject(details).assetId);
  const at = kernelText(kernelObject(details).at);
  const stampShot = (record, field) => {
    if (!record) return;
    if (assetId) record[`${field}AssetId`] = assetId;
    else delete record[`${field}AssetId`];
    if (record.approvalIdentity && typeof record.approvalIdentity === "object") {
      delete record.approvalIdentity[field];
      if (!Object.keys(record.approvalIdentity).length) delete record.approvalIdentity;
    }
  };
  const shot = () => kernelList(P.shots).find((row) => row && kernelText(row.id) === it.shotId) || null;

  if (it.kind === "shot-frame") {
    const s = shot();
    if (!s) return false;
    const frames = kernelList(s.keyframes);
    const index = frames.findIndex((row) => row && kernelText(row.id) === it.frameId);
    if (index < 0) return false;
    frames[index].winner = value;
    stampShot(frames[index], "winner");
    if (index === 0) { s.winner = value; stampShot(s, "winner"); }
    return true;
  }
  if (it.kind === "shot-motion") {
    const s = shot();
    if (!s) return false;
    const units = kernelList(s.clips).filter((row) => row && (kernelText(row.id) === it.unitKey || kernelText(row.suffix) === it.unitKey));
    if (units.length !== 1) return false;
    units[0].videoWinner = value;
    stampShot(units[0], "videoWinner");
    return true;
  }
  if (it.kind === "shot-delivery") {
    const s = shot();
    if (!s) return false;
    s.creationBrief = s.creationBrief && typeof s.creationBrief === "object" ? s.creationBrief : {};
    if (!value) {
      delete s.finalStillFile;
      delete s.finalStillAssetId;
      delete s.creationBrief.finalStillFile;
      delete s.creationBrief.finalStillAssetId;
      delete s.creationBrief.approvedMotionFile;
      delete s.creationBrief.approvedMotionAssetId;
      for (const record of [s, s.creationBrief]) {
        if (!record.approvalIdentity || typeof record.approvalIdentity !== "object") continue;
        delete record.approvalIdentity.finalStillFile;
        delete record.approvalIdentity.approvedMotionFile;
        if (!Object.keys(record.approvalIdentity).length) delete record.approvalIdentity;
      }
      return true;
    }
    if (/\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(value)) {
      delete s.finalStillFile;
      delete s.finalStillAssetId;
      delete s.creationBrief.finalStillFile;
      delete s.creationBrief.finalStillAssetId;
      s.creationBrief.approvedMotionFile = value;
      if (assetId) s.creationBrief.approvedMotionAssetId = assetId;
      else delete s.creationBrief.approvedMotionAssetId;
      s.creationBrief.deliveryIntent = "video";
    } else {
      delete s.creationBrief.approvedMotionFile;
      delete s.creationBrief.approvedMotionAssetId;
      s.finalStillFile = value;
      s.creationBrief.finalStillFile = value;
      if (assetId) { s.finalStillAssetId = assetId; s.creationBrief.finalStillAssetId = assetId; }
      else { delete s.finalStillAssetId; delete s.creationBrief.finalStillAssetId; }
      s.creationBrief.deliveryIntent = "still";
    }
    return true;
  }
  if (it.kind === "entity-state") {
    const x = kernelList(P[it.list]).find((row) => row && kernelText(row.id) === it.entityId) || null;
    if (!x) return false;
    const states = kernelList(x.continuityStates);
    const state = states.find((row) => row && kernelText(row.id) === it.stateId) || null;
    if (!state && it.stateId !== "state-default") return false;
    if (state) {
      state.approvedFile = value;
      state.approvedAt = at;
      state.parentValidation = null;
      if (assetId) state.approvedAssetId = assetId;
      else delete state.approvedAssetId;
    }
    if (!state || state.isDefault === true || kernelText(state.id) === "state-default") {
      x.approvedFile = value;
      if (assetId) x.approvedAssetId = assetId;
      else delete x.approvedAssetId;
    }
    return true;
  }
  return false;
}

/* ========================================================================== */
/* 5. OWNERSHIP — a property of the target kind, not a parameter              */
/* ========================================================================== */

/* WHICH REFERENCE OWNS THESE BYTES.
 *
 * Batch 1C asked the caller for an `eligibility` callback and ran it only "if
 * function", so passing `() => ({ok:true})` made a contested file Canon. Batch
 * 1D deleted the parameter and replaced it with an exported
 * `installAuthorityOwnershipPolicy`, which ordinary code overwrote after boot
 * and then approved the same contested file.
 *
 * There is no parameter and no installer. The kernel depends on
 * public/shared-entity-ownership.js the way any module depends on another: by
 * name, resolved at call time. If that module is not in the composition, entity
 * Canon FAILS CLOSED rather than proceeding uninformed.
 *
 *   entity-state   the file must have exactly one durable owner, and it must be
 *                  the entity being approved. Zero owners, an inferred prefix
 *                  match, or two claimants all refuse.
 *   shot-*         no ownership concept — a shot's own take belongs to the shot. */
function ownershipModule() {
  if (typeof module !== "undefined" && module.exports) {
    try { return require("./shared-entity-ownership.js"); } catch { return null; }
  }
  if (typeof buildEntityOwnerIndex === "function" && typeof resolveMediaOwnership === "function") {
    return { buildEntityOwnerIndex, resolveMediaOwnership };
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.buildEntityOwnerIndex === "function" && typeof globalThis.resolveMediaOwnership === "function") {
    return { buildEntityOwnerIndex: globalThis.buildEntityOwnerIndex, resolveMediaOwnership: globalThis.resolveMediaOwnership };
  }
  return null;
}

function entityOwnershipVerdict(project, target, fileName) {
  const need = kernelObject(target);
  const name = kernelText(fileName);
  if (!name) return { ok: true };
  const owners = ownershipModule();
  if (!owners || typeof owners.buildEntityOwnerIndex !== "function" || typeof owners.resolveMediaOwnership !== "function") {
    return {
      ok: false,
      code: "AUTHORITY_OWNERSHIP_RESOLVER_UNAVAILABLE",
      message: `CineBraid cannot confirm which reference owns ${name}, so it will not make it canon. No authority was written.`,
    };
  }
  const resolution = kernelObject(owners.resolveMediaOwnership(owners.buildEntityOwnerIndex(project, need.list), name));
  if (resolution.contested === true) {
    return {
      ok: false,
      code: "AUTHORITY_OWNERSHIP_CONTESTED",
      message: `${name} is durably claimed by more than one reference (${kernelList(resolution.claimants).join(", ")}). Resolve the conflict before approving it. No authority was written.`,
    };
  }
  if (resolution.authoritative !== true || kernelText(resolution.ownerId) !== kernelText(need.entityId)) {
    return {
      ok: false,
      code: "AUTHORITY_OWNERSHIP_UNRESOLVED",
      message: `${name} is not durably owned by ${need.entityId}${kernelText(resolution.basis) === "prefix-inference" ? " — a filename match is a possible match, not ownership. Claim it for this reference first." : "."} No authority was written.`,
    };
  }
  return { ok: true };
}

/* THE SECOND VETO: IS THIS ARTIFACT THE KIND OF THING THAT MAY BE AN IDENTITY.
 *
 * Ownership asks WHOSE bytes these are. This asks WHAT THEY ARE, and the two are
 * independent: a coverage sheet an entity indisputably owns is still not that
 * entity's identity reference, because it is six views of a face rather than a
 * face. Approving one made every identity-dependent generation package a contact
 * sheet as though it were the character.
 *
 * WHY IT IS HERE AND NOT ON THE BUTTON. public/library-tools.js already computed
 * this fact — `approvedIsCoverageSheet` — and spent it on copy and navigation
 * while calling approveEntityStateCanon() unconditionally a few lines above. The
 * modal's own record even said `decision: "approved-sheet-source"` on a row whose
 * primary-authority receipt had already been written. A UI branch is a rule with
 * an off switch: a replay, a direct call, or the next surface that forgets to ask
 * walks straight past it. The boundary refuses instead, so there is no path that
 * can grant it.
 *
 * FAIL CLOSED ON THE RESOLVER, exactly as ownership does above. If
 * public/shared-coverage.js is not in the composition the kernel cannot ask what
 * the artifact is, and an unanswerable question is a refusal rather than a pass.
 *
 * WHAT IT DOES NOT DO. `undeclared` is eligible. Every hand-dropped import is
 * `undeclared` — doIntake() writes `{stored, original}` and nothing structural —
 * so refusing it would make ordinary primary approval impossible, which is the
 * opposite defect. The consequence is stated plainly rather than hidden: a
 * hand-dropped SHEET is `undeclared` and this gate does not stop it. Closing that
 * needs a declaration at import time, which is a new contract and not this
 * slice's to invent. */
function coverageStructureModule() {
  if (typeof module !== "undefined" && module.exports) {
    try { return require("./shared-coverage.js"); } catch { return null; }
  }
  if (typeof referenceArtifactStructureOf === "function" && typeof artifactMayHoldPrimaryAuthority === "function") {
    return { referenceArtifactStructureOf, artifactMayHoldPrimaryAuthority };
  }
  if (typeof globalThis !== "undefined"
    && typeof globalThis.referenceArtifactStructureOf === "function"
    && typeof globalThis.artifactMayHoldPrimaryAuthority === "function") {
    return {
      referenceArtifactStructureOf: globalThis.referenceArtifactStructureOf,
      artifactMayHoldPrimaryAuthority: globalThis.artifactMayHoldPrimaryAuthority,
    };
  }
  return null;
}

function entityArtifactVerdict(project, target, fileName) {
  const need = kernelObject(target);
  const name = kernelText(fileName);
  if (!name) return { ok: true };
  const structures = coverageStructureModule();
  if (!structures
    || typeof structures.referenceArtifactStructureOf !== "function"
    || typeof structures.artifactMayHoldPrimaryAuthority !== "function") {
    return {
      ok: false,
      code: "AUTHORITY_ARTIFACT_CLASSIFIER_UNAVAILABLE",
      message: `CineBraid cannot confirm what kind of image ${name} is, so it will not make it the identity reference. No authority was written.`,
    };
  }
  const entity = kernelList(kernelObject(project)[kernelText(need.list)])
    .map(kernelObject)
    .find((row) => kernelText(row.id) === kernelText(need.entityId)) || null;
  const structure = kernelText(structures.referenceArtifactStructureOf(entity, name));
  if (structures.artifactMayHoldPrimaryAuthority(structure) === true) return { ok: true };
  /* TWO REFUSALS, AND THEY ARE NOT THE SAME SENTENCE. A declared sheet is a
     statement about the artifact; an UNDECLARED one is a statement about this
     project's records. Saying "this is a coverage sheet" to somebody holding an
     ordinary photograph is a false claim about their file, and it sends them to
     an extractor that has nothing to extract. Each says what is true and what
     would resolve it. */
  if (structure === "sheet") {
    return {
      ok: false,
      code: "AUTHORITY_ARTIFACT_NOT_IDENTITY_ELIGIBLE",
      message: `${name} is a coverage sheet — several views in one image — so it cannot be the identity reference for ${kernelText(need.entityId)}. Approve it as a sheet source and extract a single view instead. No authority was written.`,
      detail: { structure },
    };
  }
  return {
    ok: false,
    code: "AUTHORITY_ARTIFACT_UNDECLARED",
    message: `CineBraid has no record of what kind of image ${name} is, and it will not guess — a multi-view sheet and a single reference look the same to it. Say which it is when you import it, or map it to a continuity state or view first. No authority was written.`,
    detail: { structure },
  };
}

/* THE POLICY VERDICTS, IN ONE LIST WITH ONE OWNER.
 *
 * Ownership first: WHOSE this is, then WHAT it is. A file the entity does not
 * own should say so before its structure is discussed.
 *
 * AT1-B. This list used to be an array literal inside enforceTargetPolicy, and
 * it was reachable ONLY by attempting the write. The offer surface therefore had
 * to guess what enforcement would say, and public/shared-shot-readiness.js
 * guessed with ownership alone — so every reference whose STRUCTURE was
 * undeclared was offered an enabled Confirm that the kernel then refused. The
 * shipped sample was four such buttons on a filmmaker's first screen.
 *
 * The verdicts are named here so that the offer and the refusal read the SAME
 * list. Not a copy of it, and not a summary of it: this function is the only
 * place the policy exists, canonApprovalPreflight() reads it without writing,
 * and enforceTargetPolicy() throws on it. Neither can drift, because there is
 * nothing left to drift from. */
function entityStatePolicyVerdicts(project, target, value) {
  return [
    kernelObject(entityOwnershipVerdict(project, target, value)),
    kernelObject(entityArtifactVerdict(project, target, value)),
  ];
}

function enforceTargetPolicy(project, target, value) {
  if (target.kind !== "entity-state") return;
  for (const verdict of entityStatePolicyVerdicts(project, target, value)) {
    if (verdict.ok === true) continue;
    throw authorityError(
      kernelText(verdict.code) || "AUTHORITY_OWNERSHIP_INELIGIBLE",
      kernelText(verdict.message) || `${describeTarget(target)} cannot be approved for this image.`,
      kernelObject(verdict.detail),
    );
  }
}

/* ========================================================================== */
/* 6. READING CANON                                                           */
/* ========================================================================== */

/* IS THERE CURRENT HUMAN CANON over this object.
 *
 * Four conditions, and every one of them is a counterexample a re-audit
 * reproduced when it was missing:
 *
 *   the LEDGER is trustworthy   — a malformed ledger answers "no" for
 *                                 everything, rather than for nothing
 *   exactly ONE current receipt — two current rows is unreadable, not "latest"
 *   the receipt is VALID        — full schema, checked in validateAuthorityLedger
 *   the EDGE still matches      — exactly, in both halves. FAIL CLOSED.
 *
 * Returns the receipt, never a boolean, because every caller that matters wants
 * to cite it. */
function currentHumanAuthority(project, target) {
  const wanted = authorityTarget(target);
  if (!wanted) return null;
  const view = validateAuthorityLedger(project);
  if (!view.trusted) return null;
  const bucket = view.byTarget.get(wanted.key);
  if (!bucket || bucket.current.length !== 1) return null;
  const receipt = bucket.current[0];
  const live = liveAuthorityEdge(project, wanted);
  if (!live.value) return null;
  /* S5 — IDENTITY IS SYMMETRIC.
   *
   * Batch 1D compared asset ids only "where both sides carry one", and the
   * audit deleted the live identity from an edge whose receipt named `asset-A`:
   * the filename still matched, so the approval survived pointing at bytes
   * nothing could confirm.
   *
   * THE RULE, and there is only one: the value must match exactly, and if the
   * RECEIPT records an asset identity the live edge must record the same one.
   * A live edge that has lost its identity is a contradiction, not a half-match
   * to be rounded up. A receipt with no identity — a project whose media ledger
   * had not been indexed when the creator approved — asks nothing extra.
   *
   * A legitimate rename does not need this to be loose: repairCanonValue() is
   * the explicit operation that moves an approval to new bytes and keeps the
   * receipt true. */
  if (live.value !== kernelText(receipt.value)) return null;
  const receiptAsset = kernelText(receipt.assetId);
  if (receiptAsset && receiptAsset !== kernelText(live.assetId)) return null;
  return receipt;
}

function hasCurrentHumanAuthority(project, target) {
  return !!currentHumanAuthority(project, target);
}

/* Every receipt for one target, oldest first — history, including superseded
   and revoked rows. Only from a trustworthy ledger. */
function authorityHistory(project, target) {
  const wanted = authorityTarget(target);
  if (!wanted) return [];
  const view = validateAuthorityLedger(project);
  if (!view.trusted) return [];
  return (view.byTarget.get(wanted.key) || { all: [] }).all.slice();
}

/* HISTORIC — A POINTER NOBODY CURRENTLY VOUCHES FOR. Not an error and not
   hidden: it is a real selection somebody's machine made, and the product shows
   it as something a person can accept in one act. It is never Canon. */
function historicSelection(project, target) {
  const wanted = authorityTarget(target);
  if (!wanted) return null;
  const live = liveAuthorityEdge(project, wanted);
  if (!live.value) return null;
  if (currentHumanAuthority(project, wanted)) return null;
  const view = validateAuthorityLedger(project);
  const bucket = view.byTarget.get(wanted.key);
  const priors = bucket ? bucket.all.filter((row) => kernelText(row.status) !== "current") : [];
  return {
    ...wanted,
    value: live.value,
    assetId: live.assetId,
    basis: !view.trusted ? "authority-ledger-unreadable" : priors.length ? "authority-revoked" : "no-human-receipt",
    priorReceiptCount: priors.length,
    requiresHumanApproval: true,
  };
}

/* ========================================================================== */
/* 6A. THE ONE PROJECTION — Canon, References, Historic                       */
/* ========================================================================== */

/* S9 — ONE ANSWER, DERIVED ONCE, READ BY EVERYBODY.
 *
 * The 1D audit's sharpest finding was not a missing guard: it was that
 * Generated Media, the Library and coverage automation each re-derived
 * "approved" from raw fields, and got three different answers for the same
 * entity. The Library counted every `slot.approvedFile` and rendered APPROVED;
 * coverage automation promoted a receipt-less `entity.approvedFile` to
 * identity-authority; Generated Media alone got it right.
 *
 * So there is one function. It is READ-ONLY DERIVED STATE — it writes nothing,
 * caches nothing, and is not a source of truth; it is the shared reading of the
 * two things that are (the receipt ledger, and the slots).
 *
 *   canon       receipt-backed, one entry per continuity state that has one
 *   references  supporting selections — coverage and expression slots
 *   historic    a pointer with no current Canon behind it */
function slotsModule() {
  if (typeof module !== "undefined" && module.exports) {
    try { return require("./shared-entity-slots.js"); } catch { return null; }
  }
  if (typeof slotSelectedFile === "function") return { slotSelectedFile };
  return null;
}
function selectedSlotFile(slot) {
  const it = kernelObject(slot);
  return kernelText(it.selectedFile) || kernelText(it.approvedFile);
}

function entityProductionTruth(project, list, entityId) {
  const P = kernelObject(project);
  const x = kernelList(P[list]).map(kernelObject).find((row) => kernelText(row.id) === kernelText(entityId)) || null;
  const empty = { list: kernelText(list), entityId: kernelText(entityId), canon: [], references: [], historic: [] };
  if (!x) return empty;
  const slots = slotsModule();
  const fileOf = slots && typeof slots.slotSelectedFile === "function" ? slots.slotSelectedFile : selectedSlotFile;
  const canon = [];
  const historic = [];
  /* Every continuity state is a Canon TARGET, whether or not it holds Canon.
     The default state answers for `entity.approvedFile`, which is the pointer
     every legacy project has and no legacy project has a receipt for. */
  const states = kernelList(x.continuityStates).map(kernelObject);
  const targets = states.length
    ? states.map((state) => ({ state, stateId: kernelText(state.id) })).filter((row) => row.stateId)
    : [{ state: { id: "state-default", name: "Default", isDefault: true }, stateId: "state-default" }];
  for (const { state, stateId } of targets) {
    const target = { kind: "entity-state", list, entityId, stateId };
    const receipt = currentHumanAuthority(P, target);
    if (receipt) {
      canon.push({
        stateId,
        stateName: kernelText(state.name) || (state.isDefault ? "Default" : stateId),
        isDefault: state.isDefault === true || stateId === "state-default",
        value: kernelText(receipt.value),
        assetId: kernelText(receipt.assetId),
        receiptId: kernelText(receipt.id),
        at: kernelText(receipt.at),
      });
      continue;
    }
    const past = historicSelection(P, target);
    if (past) {
      historic.push({
        stateId,
        stateName: kernelText(state.name) || (state.isDefault ? "Default" : stateId),
        isDefault: state.isDefault === true || stateId === "state-default",
        value: past.value,
        assetId: past.assetId,
        basis: past.basis,
        priorReceiptCount: past.priorReceiptCount,
      });
    }
  }
  /* SUPPORTING REFERENCES. Never Canon, never historic, never counted as
     either — a third thing, with its own name. */
  const references = [];
  for (const group of ["coverageSlots", "expressionSlots"]) {
    for (const slot of kernelList(x[group]).map(kernelObject)) {
      const value = kernelText(fileOf(slot));
      if (!value) continue;
      if (kernelText(slot.status) === "retired" || slot.retired === true) continue;
      references.push({
        group: group === "coverageSlots" ? "coverage" : "expression",
        slotId: kernelText(slot.id),
        label: kernelText(slot.label) || kernelText(slot.id),
        value,
        assetId: kernelText(slot.selectedAssetId) || kernelText(slot.approvedAssetId),
        /* Stated, so no consumer has to infer it and none may conclude
           otherwise: a selection is not an approval. */
        authoritative: false,
      });
    }
  }
  return { list: kernelText(list), entityId: kernelText(entityId), canon, references, historic };
}

/* ========================================================================== */
/* 7. THE ONE PRIVATE CANON COMMIT                                            */
/* ========================================================================== */

/* Structured-clone the parts a transaction may touch. Total for project
   documents, which are JSON by construction. */
function draftOf(project) {
  const source = kernelObject(project);
  if (typeof structuredClone === "function") return structuredClone(source);
  return JSON.parse(JSON.stringify(source));
}

/* Copy the draft's committed state back onto the live document, IN PLACE.
 *
 * WHY THIS IS A DEEP MERGE AND NOT AN ASSIGNMENT, learned the hard way: the
 * first version did `project[key] = draft[key]`, which replaces `project.shots`
 * with the draft's cloned array. Every reference a caller was already holding
 * then pointed at a detached object and its later writes went nowhere.
 *
 * Object identity is preserved wherever the shape matches, so a commit is
 * invisible to anything holding a reference — the property a browser page needs
 * and the one an in-place mutation model has always assumed.
 *
 * THERE IS NO `installAuthorityProjectCommitter`. Persistence is this, fixed. */
function mergeInPlace(live, next) {
  if (Array.isArray(live) && Array.isArray(next)) {
    for (let index = 0; index < next.length; index++) {
      const value = next[index];
      if (index < live.length && live[index] && value && typeof live[index] === "object" && typeof value === "object"
        && Array.isArray(live[index]) === Array.isArray(value)) {
        mergeInPlace(live[index], value);
      } else {
        live[index] = value;
      }
    }
    live.length = next.length;
    return live;
  }
  for (const key of Object.keys(live)) if (!(key in next)) delete live[key];
  for (const key of Object.keys(next)) {
    const value = next[key];
    const existing = live[key];
    if (existing && value && typeof existing === "object" && typeof value === "object" && Array.isArray(existing) === Array.isArray(value)) {
      mergeInPlace(existing, value);
    } else {
      live[key] = value;
    }
  }
  return live;
}

/* THE PRIVATE CANON COMMIT. Every Canon write in CineBraid comes through here,
 * and nothing outside this file can call it. The four named commands below are
 * the whole public surface; each fixes its own target kind, so there is no
 * request in which a caller names an arbitrary one.
 *
 * THE ORDER IS THE GUARANTEE:
 *
 *   1. resolve the target                      — nothing touched
 *   2. require value AND a stated identity     — nothing touched
 *   3. require a LIVE trusted human gesture    — nothing touched
 *   4. ownership veto for the target kind      — nothing touched
 *   5. DRAFT the document
 *   6. write the edge on the DRAFT
 *   7. supersede + append the receipt on the DRAFT
 *   8. VALIDATE the draft's whole ledger, and the edge/receipt correspondence
 *   9. commit the draft in one write, and re-read to prove it landed
 *
 * A failure at any step leaves the live document untouched, because until step
 * 9 nothing has been written to it. */
function commitCanon(project, request, kind) {
  const it = kernelObject(request);
  const target = authorityTarget({ ...it, kind });
  if (!target) {
    throw authorityError("AUTHORITY_TARGET_INCOMPLETE", "A Canon approval must name a complete target. No authority was written.");
  }
  const what = describeTarget(target);
  const value = kernelText(it.value);
  if (!value) {
    throw authorityError("AUTHORITY_VALUE_REQUIRED", `${what} cannot be approved without naming the media being approved. No authority was written.`);
  }
  /* S1A — THE IDENTITY IS NOT AN OPTIONAL PARAMETER A CALLER MAY FORGET.
   *
   * Batch 1D made `assetId` optional and every one of the twelve shipped
   * surfaces omitted it. A missing key is now an error; an explicit "" is the
   * caller stating that these bytes have no identity in this project, which is
   * a real and common answer and a different statement from silence. */
  if (!Object.prototype.hasOwnProperty.call(it, "assetId")) {
    throw authorityError(
      "AUTHORITY_ASSET_IDENTITY_REQUIRED",
      `${what} cannot be approved without stating the identity of the media being approved. No authority was written.`,
      { target: target.key, value },
    );
  }
  const assetId = kernelText(it.assetId);
  /* THE HUMAN, ASKED HERE AND NOWHERE ELSE. No token was minted earlier, so
     there is nothing that could have been minted for a different decision. */
  const gesture = requireTrustedGesture(what);
  enforceTargetPolicy(project, target, value);
  /* A ledger that is already unreadable is not something to append to. */
  const before = validateAuthorityLedger(project);
  if (!before.trusted) {
    throw authorityError(
      "AUTHORITY_LEDGER_UNREADABLE",
      `This project's approval records cannot be read, so CineBraid will not add to them. No authority was written. (${before.diagnostics.map((row) => row.code).join(", ")})`,
      { diagnostics: before.diagnostics },
    );
  }
  const draft = draftOf(project);
  const at = kernelText(it.at);
  if (writeAuthorityEdge(draft, target, { value, assetId, at }) === false) {
    throw authorityError(
      "AUTHORITY_TARGET_UNAVAILABLE",
      `${what} is not in this project, so there is nothing to approve. No authority was written.`,
    );
  }
  const ledger = draft[AUTHORITY_LEDGER_KEY] && typeof draft[AUTHORITY_LEDGER_KEY] === "object" && !Array.isArray(draft[AUTHORITY_LEDGER_KEY])
    ? draft[AUTHORITY_LEDGER_KEY]
    : {};
  ledger.version = kernelInteger(ledger.version) || AUTHORITY_LEDGER_VERSION;
  ledger.receipts = kernelList(ledger.receipts);
  for (const row of ledger.receipts) {
    const existing = kernelObject(row);
    const existingTarget = authorityTarget(existing);
    if (!existingTarget || existingTarget.key !== target.key || kernelText(existing.status) !== "current") continue;
    existing.status = "superseded";
    existing.supersededAt = at;
    existing.revocationReason = "replaced";
  }
  /* SEQUENCE AND ID ARE ALLOCATED AGAINST WHAT IS DURABLY THERE, not against a
     counter the document carries. A ledger whose `sequence` field had been
     reset minted a second `authority-000001`; deriving it from the maximum
     sequence actually present cannot. */
  const highest = ledger.receipts.reduce((max, row) => Math.max(max, kernelInteger(kernelObject(row).sequence) || 0), 0);
  const sequence = highest + 1;
  const usedIds = new Set(ledger.receipts.map((row) => kernelText(kernelObject(row).id)));
  let id = `authority-${String(sequence).padStart(6, "0")}`;
  let suffix = 1;
  while (usedIds.has(id)) { id = `authority-${String(sequence).padStart(6, "0")}-${++suffix}`; }
  const receipt = {
    id,
    sequence,
    actor: AUTHORITY_ACTOR,
    act: AUTHORITY_ACT,
    command: AUTHORITY_COMMAND_FOR_KIND[target.kind],
    kind: target.kind,
    targetKey: target.key,
    shotId: target.shotId,
    frameId: target.frameId,
    unitKey: target.unitKey,
    list: target.list,
    entityId: target.entityId,
    stateId: target.stateId,
    slotId: target.slotId,
    value,
    assetId,
    at,
    status: "current",
    supersededBy: "",
    supersededAt: "",
    revokedAt: "",
    revocationReason: "",
    note: kernelText(it.note),
    /* WHICH gesture issued this, and from which surface. */
    provenance: { manualAction: kernelText(gesture.id) || "manual-action", via: kernelText(it.via) || "unspecified-manual-surface", gesture: kernelText(gesture.kind) },
  };
  for (const row of ledger.receipts) {
    const existing = kernelObject(row);
    if (kernelText(existing.status) === "superseded" && !kernelText(existing.supersededBy) && authorityTarget(existing)?.key === target.key) existing.supersededBy = id;
  }
  ledger.receipts.push(receipt);
  draft[AUTHORITY_LEDGER_KEY] = ledger;
  /* The draft must be readable, and the edge it just wrote must be the one the
     receipt describes. This is what makes the returned receipt a statement
     about durable state rather than about an intention. */
  const after = validateAuthorityLedger(draft);
  if (!after.trusted) {
    throw authorityError(
      "AUTHORITY_TRANSACTION_INVALID",
      `${what} could not be approved: the resulting approval records would not be readable. Nothing was changed. (${after.diagnostics.map((row) => row.code).join(", ")})`,
      { diagnostics: after.diagnostics },
    );
  }
  if (!currentHumanAuthority(draft, target)) {
    throw authorityError(
      "AUTHORITY_EDGE_NOT_WRITTEN",
      `${what} could not be approved: the approval record and the project would not agree. Nothing was changed.`,
      { expected: value, observed: liveAuthorityEdge(draft, target).value },
    );
  }
  /* ONE WRITE, AND PROOF THAT IT LANDED. A non-extensible live root survives
     everything above — the draft is a clone and validates perfectly, and only
     the copy back fails, silently, because a refused property add is a no-op
     outside strict mode. So the live document is re-read and asked the same
     question the caller is about to believe the answer to. If the answer is no,
     the pre-image goes back and the caller gets an exception instead of a lie. */
  const preImage = draftOf(project);
  mergeInPlace(project, draft);
  if (!currentHumanAuthority(project, target)) {
    mergeInPlace(project, preImage);
    throw authorityError(
      "AUTHORITY_NOT_PERSISTED",
      `${what} could not be approved: the change could not be written to this project. Nothing was changed.`,
      { targetKey: target.key },
    );
  }
  return receipt;
}

/* WITHDRAWING CANON, on the same terms and through the same draft. The target
   kind decides which edge is cleared; nothing is inferred from the new value,
   because on a revocation there is no new value. */
function revokeCanon(project, request, kind) {
  const it = kernelObject(request);
  const target = authorityTarget({ ...it, kind });
  if (!target) throw authorityError("AUTHORITY_TARGET_INCOMPLETE", "A revocation must name a complete target. Nothing was changed.");
  requireTrustedGesture(describeTarget(target));
  const reason = kernelText(it.reason);
  if (!AUTHORITY_REVOCATION_REASONS.includes(reason) || reason === "replaced" || reason === "target-cleared")
    throw authorityError("AUTHORITY_REVOCATION_REASON_INVALID", "This human revocation reason is not recognised. Nothing was changed.", { reason });
  const view = validateAuthorityLedger(project);
  if (!view.trusted)
    throw authorityError("AUTHORITY_LEDGER_UNTRUSTED", "This project's authority ledger is not trustworthy. Nothing was changed.", { diagnostics: view.diagnostics });
  const receipt = currentHumanAuthority(project, target);
  if (!receipt)
    throw authorityError("AUTHORITY_CURRENT_RECEIPT_REQUIRED", "No matching current authority receipt can be revoked. Nothing was changed.", { targetKey: target.key });
  const draft = draftOf(project);
  if (it.clearEdge !== false) writeAuthorityEdge(draft, target, { value: "", assetId: "", at: kernelText(it.at) });
  const row = kernelList(kernelObject(draft[AUTHORITY_LEDGER_KEY]).receipts)
    .map(kernelObject).find((candidate) => kernelText(candidate.id) === kernelText(receipt.id));
  row.status = "revoked";
  row.revokedAt = kernelText(it.at);
  row.revocationReason = reason;
  row.revokedVia = kernelText(it.via);
  row.revokedBy = "human";
  mergeInPlace(project, draft);
  return [kernelText(row.id)];
}

function systemInvalidateCanon(project, request, kind) {
  const it = kernelObject(request);
  const target = authorityTarget({ ...it, kind });
  if (!target) throw authorityError("AUTHORITY_TARGET_INCOMPLETE", "A system invalidation must name a complete target. Nothing was changed.");
  if (kernelText(it.reason) !== "target-cleared")
    throw authorityError("AUTHORITY_REVOCATION_REASON_INVALID", "System invalidation only supports target-cleared. Nothing was changed.", { reason: kernelText(it.reason) });
  const view = validateAuthorityLedger(project);
  if (!view.trusted)
    throw authorityError("AUTHORITY_LEDGER_UNTRUSTED", "This project's authority ledger is not trustworthy. Nothing was changed.", { diagnostics: view.diagnostics });
  const receipt = currentHumanAuthority(project, target);
  if (!receipt)
    throw authorityError("AUTHORITY_CURRENT_RECEIPT_REQUIRED", "No matching current authority receipt can be invalidated. Nothing was changed.", { targetKey: target.key });
  const draft = draftOf(project);
  if (it.clearEdge !== false) writeAuthorityEdge(draft, target, { value: "", assetId: "", at: kernelText(it.at) });
  const row = kernelList(kernelObject(draft[AUTHORITY_LEDGER_KEY]).receipts)
    .map(kernelObject).find((candidate) => kernelText(candidate.id) === kernelText(receipt.id));
  row.status = "revoked";
  row.revokedAt = kernelText(it.at);
  row.revocationReason = "target-cleared";
  row.revokedBy = "system";
  delete row.revokedVia;
  delete row.revocationProvenance;
  mergeInPlace(project, draft);
  return [kernelText(row.id)];
}

/* A rename moved the bytes and the edge followed; the receipt has to follow or
   the next read revokes a decision a person really made.
 *
 * THIS IS LOAD-BEARING NOW. The shipped approval order is approve-then-rename:
 * Canon is committed synchronously inside the click, on the bytes the creator
 * was looking at, and the rename that follows moves the receipt with them. */
function repairCanonValue(project, change = {}) {
  const it = kernelObject(change);
  const from = kernelText(it.from);
  const to = kernelText(it.to);
  const assetId = kernelText(it.assetId);
  if (!from || !to || from === to) return [];
  /* SCOPED TO ONE TARGET, AND ONLY THE ONE THE CALLER JUST APPROVED.
   *
   * This used to walk the WHOLE ledger and rewrite every receipt whose value
   * happened to equal `from`. A filename is not an identity: renaming
   * `shots/SH-01/takes/A.png` rewrote an entity's canon receipt that named
   * `anchors/A.png`, and a decision nobody revisited pointed at bytes nobody
   * approved. A repair that can change WHICH BYTES ARE CANON is an approval, and
   * this is not an approval path. */
  const target = authorityTarget(it);
  if (!target) return [];
  if (!validateAuthorityLedger(project).trusted) return [];
  const draft = draftOf(project);
  const ledger = kernelObject(draft[AUTHORITY_LEDGER_KEY]);
  const repaired = [];
  for (const row of kernelList(ledger.receipts)) {
    const receipt = kernelObject(row);
    if (kernelText(receipt.status) !== "current") continue;
    if (kernelText(receipt.value) !== from) continue;
    if (authorityTarget(receipt)?.key !== target.key) continue;
    /* AND ONLY WHEN THE RECEIPT ITSELF CAN PROVE THE BYTES ARE THE SAME ONES.
     *
     * A rename MOVES bytes; it does not choose different ones. The only thing
     * that can testify to that after the fact is an identity the receipt
     * ALREADY held when the creator approved it. So:
     *
     *   receipt has an identity, and it matches   follow the move
     *   receipt has an identity, and it differs   refuse
     *   receipt has NO identity                   refuse
     *
     * The third case is the one Codex reproduced. This used to accept it and
     * then write the caller's new `assetId` into the old receipt — inventing
     * proof from the very operation being justified, and restoring Canon on
     * bytes nothing had ever tied to the decision. A receipt with no identity is
     * a decision about a FILENAME, and once that filename moves there is nothing
     * left that says the new file is what the creator approved.
     *
     * A refusal is not a loss. The edge and the receipt disagree,
     * `currentHumanAuthority` fails closed, and the pointer reads as HISTORIC —
     * visible, named, and one explicit click from being Canon again on bytes the
     * creator can actually see. */
    const recorded = kernelText(receipt.assetId);
    if (!recorded) continue;
    if (recorded !== assetId) continue;
    receipt.value = to;
    repaired.push(kernelText(receipt.id));
  }
  if (repaired.length) mergeInPlace(project, draft);
  return repaired;
}

/* ==========================================================================
   AT1-B — WOULD THIS APPROVAL BE REFUSED, ASKED WITHOUT ATTEMPTING IT.

   INVARIANT 6 OF THIS FILE IS "PREFLIGHT DOES NOT MUTATE", and this is the
   function that lets a surface obey it while still telling the truth.

   THE DEFECT THIS EXISTS FOR. `commitCanon` above applies a list of
   deterministic vetoes. Until this function, the ONLY way to learn any of them
   was to attempt the write and catch the throw — so every surface that wanted
   to decide whether to OFFER a Confirm had to re-derive the answer. Exactly one
   of them did (public/shared-shot-readiness.js), it re-derived ownership only,
   and the artifact-structure veto beside it was invisible to the offer. The
   result was an enabled primary control whose own enforcement layer already knew
   it would fail — which is the whole of the Action Truth rule.

   WHAT IT REPORTS, and every one is read off the very code that enforces it:

     AUTHORITY_TARGET_INCOMPLETE        authorityTarget() — the same resolver
     AUTHORITY_VALUE_REQUIRED           the same emptiness test
     AUTHORITY_ASSET_IDENTITY_REQUIRED  the same `hasOwnProperty` statement rule
     AUTHORITY_LEDGER_UNREADABLE        validateAuthorityLedger() — the same call
     AUTHORITY_TARGET_UNAVAILABLE       writeAuthorityEdge() ON A THROWAWAY DRAFT,
                                        so target resolution is not reimplemented
                                        here and cannot fall out of step with the
                                        writer it is predicting
     the entity-state policy verdicts   entityStatePolicyVerdicts() — the list
                                        enforceTargetPolicy() throws on

   WHAT IT DELIBERATELY DOES NOT REPORT. The trusted gesture. A gesture is a
   property of the ACT, not of the project, and asking for one here would either
   mint a credential outside a click or report a refusal that pressing the button
   would not produce. A surface preflights to decide what to OFFER; the human's
   press is what supplies the gesture.

   IT NEVER THROWS AND IT NEVER WRITES. A caller may run it on every paint. */
/* THE ENFORCEMENT LAYER'S SENTENCE, IN THE PREFLIGHT'S TENSE.
 *
 * Every refusal `commitCanon` throws ends by reporting what the attempt did to
 * the document — "No authority was written." / "Nothing was changed." — which is
 * exactly right for a refusal a filmmaker's press produced. A PREFLIGHT is
 * answering before any press, so forwarding those clauses verbatim tells somebody
 * who has pressed nothing that CineBraid tried and failed. The queue was doing
 * that on every paint.
 *
 * The wording still has ONE owner: this trims the outcome clause and keeps the
 * kernel's own requirement sentence — the half that names what is wrong and what
 * would resolve it — untouched. */
/* THE SMALLEST DOCUMENT THE WRITER CAN ANSWER THE EXISTENCE QUESTION ON.
 *
 * The probe below asks `writeAuthorityEdge` itself whether a target's host is in
 * this project, so that resolution is never reimplemented here and cannot drift
 * from the writer it predicts. The first version handed it `draftOf(project)` — a
 * deep clone of the WHOLE document — and readiness asks this once per queued row,
 * so a project with a large media ledger and a dozen unconfirmed references was
 * cloning the entire record a dozen times on every paint.
 *
 * `writeAuthorityEdge` reads exactly one collection: `P.shots` for the three shot
 * kinds, `P[target.list]` for an entity state. Nothing else on the document is
 * touched. So the probe is handed a shell holding a clone of that one list — same
 * answer, same writer, and the cost stops scaling with the rest of the project.
 * It is still a CLONE: the writer mutates what it is given, and the live document
 * must not be one of the things it can reach. */
function availabilityProbeDraft(project, target) {
  const source = kernelObject(project);
  const key = kernelObject(target).kind === "entity-state" ? kernelText(kernelObject(target).list) : "shots";
  const rows = kernelList(source[key]);
  const shell = {};
  shell[key] = typeof structuredClone === "function" ? structuredClone(rows) : JSON.parse(JSON.stringify(rows));
  return shell;
}

const PREFLIGHT_OUTCOME_CLAUSES = [" No authority was written.", " Nothing was changed."];
function preflightSentence(message) {
  let text = kernelText(message);
  for (const clause of PREFLIGHT_OUTCOME_CLAUSES) {
    if (text.endsWith(clause)) text = text.slice(0, -clause.length);
    if (text.endsWith(clause.trim())) text = text.slice(0, -clause.trim().length).trimEnd();
  }
  return text.trim();
}
function canonApprovalPreflight(project, request = {}) {
  const it = kernelObject(request);
  const refuse = (code, message, detail) => ({ ok: false, code, message: preflightSentence(message), detail: kernelObject(detail) });
  const target = authorityTarget(it);
  if (!target) return refuse("AUTHORITY_TARGET_INCOMPLETE", "A Canon approval must name a complete target.");
  const what = describeTarget(target);
  const value = kernelText(it.value);
  if (!value) return refuse("AUTHORITY_VALUE_REQUIRED", `${what} cannot be approved without naming the media being approved.`, { target: target.key });
  /* The same statement rule commitCanon applies: a missing key is silence, and
     silence is not an answer. An explicit "" is a real answer and passes. */
  if (!Object.prototype.hasOwnProperty.call(it, "assetId"))
    return refuse("AUTHORITY_ASSET_IDENTITY_REQUIRED", `${what} cannot be approved without stating the identity of the media being approved.`, { target: target.key, value });
  for (const verdict of target.kind === "entity-state" ? entityStatePolicyVerdicts(project, target, value) : []) {
    if (verdict.ok === true) continue;
    return refuse(
      kernelText(verdict.code) || "AUTHORITY_OWNERSHIP_INELIGIBLE",
      kernelText(verdict.message) || `${what} cannot be approved for this image.`,
      verdict.detail,
    );
  }
  const ledger = validateAuthorityLedger(project);
  if (!ledger.trusted)
    return refuse("AUTHORITY_LEDGER_UNREADABLE", `This project's approval records cannot be read, so CineBraid will not add to them. (${ledger.diagnostics.map((row) => row.code).join(", ")})`, { diagnostics: ledger.diagnostics });
  /* THE TARGET-EXISTS QUESTION, ASKED OF THE WRITER ITSELF. `writeAuthorityEdge`
     returns false for a host this project does not have, and it is handed a deep
     clone, so the real document is untouched and no second host-resolution
     reader exists to disagree with the first. */
  if (writeAuthorityEdge(availabilityProbeDraft(project, target), target, { value, assetId: kernelText(it.assetId), at: kernelText(it.at) }) === false)
    return refuse("AUTHORITY_TARGET_UNAVAILABLE", `${what} is not in this project, so there is nothing to approve.`, { target: target.key });
  return { ok: true, code: "", message: "", detail: {} };
}

/* ========================================================================== */
/* 8. THE FOUR NAMED CANON COMMANDS — the whole public write surface          */
/* ========================================================================== */

/* Thin, explicit, and each one fixes its target kind. There is no generic
   `commitAuthorityTransaction` any more: a caller cannot name a kind, cannot
   supply a policy, an eligibility predicate, an edge writer or a committer, and
   cannot reach the private commit above. */
function approveFrameCanon(project, request = {}) { return commitCanon(project, request, "shot-frame"); }
function approveMotionCanon(project, request = {}) { return commitCanon(project, request, "shot-motion"); }
function approveDeliveryCanon(project, request = {}) { return commitCanon(project, request, "shot-delivery"); }
function approveEntityStateCanon(project, request = {}) { return commitCanon(project, request, "entity-state"); }

function revokeFrameCanon(project, request = {}) { return revokeCanon(project, request, "shot-frame"); }
function revokeMotionCanon(project, request = {}) { return revokeCanon(project, request, "shot-motion"); }
function revokeDeliveryCanon(project, request = {}) { return revokeCanon(project, request, "shot-delivery"); }
function revokeEntityStateCanon(project, request = {}) { return revokeCanon(project, request, "entity-state"); }

function systemInvalidateFrameCanon(project, request = {}) { return systemInvalidateCanon(project, request, "shot-frame"); }
function systemInvalidateMotionCanon(project, request = {}) { return systemInvalidateCanon(project, request, "shot-motion"); }
function systemInvalidateDeliveryCanon(project, request = {}) { return systemInvalidateCanon(project, request, "shot-delivery"); }
function systemInvalidateEntityStateCanon(project, request = {}) { return systemInvalidateCanon(project, request, "entity-state"); }

/* THERE IS NO approveCoverageCanon AND NO approveExpressionCanon. Coverage and
   expression slots are supporting references; public/shared-entity-slots.js
   owns them, and a test asserts these names do not come back. */


/* The read-only half of Authority Write Seam V1. Browser capture and the Node
 * persistence primitive ask this same oracle which resolved targets and receipt
 * rows moved. It enumerates raw current rows from both documents, so damage in
 * either ledger cannot shrink the protected domain. */
function authorityTargetFromKey(key) {
  const raw = kernelText(key);
  let match = raw.match(/^shot-frame:([^#]+)#(.+)$/);
  if (match) return authorityTarget({ kind: "shot-frame", shotId: match[1], frameId: match[2] });
  match = raw.match(/^shot-motion:([^#]+)#(.+)$/);
  if (match) return authorityTarget({ kind: "shot-motion", shotId: match[1], unitKey: match[2] });
  match = raw.match(/^shot-delivery:(.+)$/);
  if (match) return authorityTarget({ kind: "shot-delivery", shotId: match[1] });
  match = raw.match(/^entity-state:([^:]+):([^#]+)#(.+)$/);
  return match ? authorityTarget({ kind: "entity-state", list: match[1], entityId: match[2], stateId: match[3] }) : null;
}
function authorityStable(value) {
  if (Array.isArray(value)) return value.map(authorityStable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = authorityStable(value[key]); return out; }, {});
}
function authorityStableJson(value) { return JSON.stringify(authorityStable(value)); }
function rawAuthorityRows(project) { return kernelList(kernelObject(kernelObject(project).productionAuthority).receipts); }
function rawAuthorityDomain(current, successor) {
  const targets = new Map();
  for (const project of [current, successor]) for (const rowValue of rawAuthorityRows(project)) {
    const row = kernelObject(rowValue);
    if (row.status !== "current") continue;
    const stored = kernelText(row.targetKey);
    if (stored) targets.set(stored, authorityTargetFromKey(stored));
    const derived = authorityTarget(row);
    if (derived) targets.set(derived.key, derived);
  }
  return targets;
}
function authorityTargetExists(project, target) {
  if (!target) return false;
  const P = kernelObject(project);
  const shot = kernelList(P.shots).map(kernelObject).find((row) => kernelText(row.id) === target.shotId);
  if (target.kind === "shot-delivery") return !!shot;
  if (target.kind === "shot-frame") return !!shot && kernelList(shot.keyframes).some((row) => kernelText(kernelObject(row).id) === target.frameId);
  if (target.kind === "shot-motion") return !!shot && kernelList(shot.clips).filter((row) => {
    const clip = kernelObject(row); return kernelText(clip.id) === target.unitKey || kernelText(clip.suffix) === target.unitKey;
  }).length > 0;
  if (target.kind === "entity-state") {
    const entity = kernelList(P[target.list]).map(kernelObject).find((row) => kernelText(row.id) === target.entityId);
    return !!entity && (target.stateId === "state-default" || kernelList(entity.continuityStates).some((row) => kernelText(kernelObject(row).id) === target.stateId));
  }
  return false;
}
function authorityEdgeTuple(project, target) {
  const edge = target ? liveAuthorityEdge(project, target) : {};
  return {
    value: kernelText(edge.value), assetId: kernelText(edge.assetId), recordId: kernelText(edge.recordId),
    field: kernelText(edge.field), form: kernelText(edge.form),
  };
}

/* A target is not removed merely because its old locator stops resolving. An
   ordinary successor can rename that locator (or make a motion locator
   ambiguous) while leaving the authority-bearing pointer intact. For the
   narrow target-removal exception, search the raw homes for the prior value or
   durable asset identity without trusting record ids. Shared values are
   deliberately ambiguous and therefore fail closed. */
function rawAuthorityPointers(project, target) {
  const P = kernelObject(project), pointers = [];
  const addShot = (record, field, identityField = `${field}AssetId`) => {
    const row = kernelObject(record);
    const value = kernelText(row[field]);
    const assetId = kernelText(row[identityField]) || kernelText(kernelObject(row.approvalIdentity)[field]);
    if (value || assetId) pointers.push({ value, assetId });
  };
  const addEntity = (record) => {
    const row = kernelObject(record);
    const value = kernelText(row.approvedFile), assetId = kernelText(row.approvedAssetId);
    if (value || assetId) pointers.push({ value, assetId });
  };
  for (const shotValue of kernelList(P.shots)) {
    const shot = kernelObject(shotValue), creation = kernelObject(shot.creationBrief);
    addShot(shot, "winner");
    for (const frame of kernelList(shot.keyframes)) addShot(frame, "winner");
    for (const clip of kernelList(shot.clips)) addShot(clip, "videoWinner");
    addShot(shot, "finalStillFile", "finalStillAssetId");
    addShot(creation, "finalStillFile", "finalStillAssetId");
    addShot(creation, "approvedMotionFile", "approvedMotionAssetId");
  }
  for (const list of AUTHORITY_ENTITY_LISTS) {
    for (const entityValue of kernelList(P[list])) {
      const entity = kernelObject(entityValue);
      addEntity(entity);
      for (const state of kernelList(entity.continuityStates)) addEntity(state);
    }
  }
  return pointers;
}
function authorityPointerSurvives(project, target, priorValue) {
  const prior = kernelObject(priorValue);
  /* A current receipt without a positive live value is already too damaged to
     prove safe removal through an ordinary save. */
  if (!kernelText(prior.value)) return true;
  return rawAuthorityPointers(project, target).some((next) =>
    (kernelText(prior.value) && kernelText(next.value) === kernelText(prior.value))
    || (kernelText(prior.assetId) && kernelText(next.assetId) === kernelText(prior.assetId)));
}
function authorityCanonicalLedger(project) {
  const ledger = kernelObject(project).productionAuthority;
  if (ledger === undefined) return "__absent__";
  const copy = JSON.parse(JSON.stringify(ledger));
  if (Array.isArray(copy?.receipts)) copy.receipts.sort((a, b) =>
    (kernelText(a?.id) + "\u0000" + authorityStableJson(a)).localeCompare(kernelText(b?.id) + "\u0000" + authorityStableJson(b)));
  return authorityStableJson(copy);
}
function authorityWriteTransition(current, successor) {
  const domain = rawAuthorityDomain(current, successor), targets = [];
  for (const [targetKey, target] of domain) {
    const before = authorityEdgeTuple(current, target), after = authorityEdgeTuple(successor, target);
    const beforeExists = authorityTargetExists(current, target), afterExists = authorityTargetExists(successor, target);
    if (authorityStableJson(before) !== authorityStableJson(after) || beforeExists !== afterExists)
      targets.push({ targetKey, target, before, after, beforeExists, afterExists });
  }
  targets.sort((a, b) => a.targetKey.localeCompare(b.targetKey));
  const beforeById = new Map(rawAuthorityRows(current).map((row) => [kernelText(kernelObject(row).id), row]));
  const afterById = new Map(rawAuthorityRows(successor).map((row) => [kernelText(kernelObject(row).id), row]));
  const receiptIds = new Set([...beforeById.keys(), ...afterById.keys()]), receiptChanges = [];
  for (const id of receiptIds) if (authorityStableJson(beforeById.get(id)) !== authorityStableJson(afterById.get(id)))
    receiptChanges.push({ id, before: beforeById.get(id), after: afterById.get(id) });
  receiptChanges.sort((a, b) => a.id.localeCompare(b.id));
  const affected = new Set(targets.map((row) => row.targetKey));
  for (const change of receiptChanges) for (const rowValue of [change.before, change.after]) {
    const row = kernelObject(rowValue), derived = authorityTarget(row);
    if (kernelText(row.targetKey)) affected.add(kernelText(row.targetKey));
    if (derived) affected.add(derived.key);
  }
  const targetKeys = [...affected].sort();
  const targetRemoval = receiptChanges.length > 0 && receiptChanges.every((change) => {
    const before = kernelObject(change.before), after = kernelObject(change.after), target = authorityTarget(before);
    return before.status === "current" && after.status === "revoked" && after.revocationReason === "target-removed"
      && target && !authorityTargetExists(successor, target)
      && !authorityPointerSurvives(successor, target, authorityEdgeTuple(current, target));
  }) && targets.every((row) => row.beforeExists && !row.afterExists
    && !authorityPointerSurvives(successor, row.target, row.before));
  return {
    domain: [...domain.keys()].sort(), targets, changedTargetKeys: targets.map((row) => row.targetKey),
    ledgerChanged: authorityCanonicalLedger(current) !== authorityCanonicalLedger(successor),
    receiptChanges,
    declaration: {
      targetKeys, receiptIds: receiptChanges.map((row) => row.id),
      transitionKind: receiptChanges.some((row) => kernelObject(row.after).revokedBy === "system") ? "SYSTEM_INVALIDATE" : "HUMAN_CANON_TRANSITION",
    },
    targetRemoval,
    requiresTransition: !targetRemoval && (targets.length > 0 || receiptChanges.length > 0),
  };
}

const AUTHORITY_KERNEL_EXPORTS = {
  AUTHORITY_TARGET_KINDS,
  AUTHORITY_ENTITY_LISTS,
  AUTHORITY_COMMANDS,
  AUTHORITY_COMMAND_FOR_KIND,
  AUTHORITY_RECEIPT_STATES,
  AUTHORITY_REVOCATION_REASONS,
  AUTHORITY_ACTOR,
  AUTHORITY_ACT,
  AUTHORITY_LEDGER_KEY,
  AUTHORITY_LEDGER_VERSION,
  AUTHORITY_DIAGNOSTIC_CODES,
  authorityError,
  authorityTarget,
  describeTarget,
  /* the human */
  installBrowserManualActionSource,
  manualActionSourceInstalled,
  trustedGestureOpen,
  /* ledger validation */
  validateReceiptShape,
  validateAuthorityLedger,
  authorityLedgerDiagnostics,
  /* reading */
  liveAuthorityEdge,
  currentHumanAuthority,
  hasCurrentHumanAuthority,
  authorityHistory,
  historicSelection,
  authorityWriteTransition,
  /* READ-ONLY, and the reason it is here rather than beside the commands: a
     surface asks this to decide what to OFFER. It writes nothing. */
  canonApprovalPreflight,
  /* the one projection — read-only derived state */
  entityProductionTruth,
  /* Only authority-creating commands are namespaced. Destructive and repair
     functions remain private classic-script owners, not a general module API. */
  approveFrameCanon,
  approveMotionCanon,
  approveDeliveryCanon,
  approveEntityStateCanon,
};

/* A NAMESPACE, NOT LOOSE GLOBALS — and this is not tidiness.
 *
 * Every public/*.js shares one lexical scope in the browser. Exporting the
 * kernel's names individually meant shared-production-authority.js, which
 * defines thin wrappers of the same names, SHADOWED the kernel functions those
 * wrappers call — and each wrapper called itself until the stack ran out. The
 * whole product blanked, and no Node suite could see it because Node has no
 * shared scope.
 *
 * The kernel is reached through one object nothing else is named. Only the
 * gesture-source installer and its two read-only predicates are also exposed
 * loosely, because bootstrap.js calls them by name and nothing redefines them. */
if (typeof window !== "undefined") {
  window.CineBraidAuthorityKernel = AUTHORITY_KERNEL_EXPORTS;
  for (const key of ["installBrowserManualActionSource", "manualActionSourceInstalled", "trustedGestureOpen"]) {
    window[key] = AUTHORITY_KERNEL_EXPORTS[key];
  }
}
if (typeof module !== "undefined" && module.exports) module.exports = AUTHORITY_KERNEL_EXPORTS;
