/* CINEBRAID — vanilla JS SPA. State = active project's project.json. Media = disk scan. */
let P = null,
  CONFIG = {},
  SCAN = { anchors: [], plates: [], props: [], vehicles: [], media: [], shots: {} },
  PROMPT_LIBRARY = { schemaVersion: 1, profiles: [] },
  AGENT_STATUS = { enabled: false, runs: [], agents: [], index: {} },
  FAL_GENERATION_JOBS = [],
  /* O5. Whether the generation ledger was actually FETCHED AND ANSWERED, which is a
     different fact from `FAL_GENERATION_JOBS.length === 0`. The ledger is requested
     only when fal is enabled and keyed, so on a project with generation off the array
     is empty because nothing asked — not because nothing was generated.
     public/shared-production-media.js needs that distinction to report a job as
     "unavailable" rather than as "not recorded", which is the difference between
     "CineBraid does not have the record here" and "no such record exists". */
  FAL_GENERATION_LEDGER_LOADED = false,
  AUTOMATION_RUNS = [],
  saveTimer = null,
  ACTIVE_PROJECT_SLUG = "",
  SAVE_CHAIN = Promise.resolve(),
  SAVE_REVISION = 0,
  SAVED_REVISION = 0,
  /* The server's token for the stored document this view was loaded from.
     SAVE_REVISION counts local edits; this identifies what is on disk. */
  PROJECT_REVISION = "",
  PROJECT_CONFLICT = false,
  AUTHORITY_SAVE_REFUSED = false,
  /* This view has stopped saving for a reason that is neither a stale document
     nor an authority refusal: the server refused the save itself, or this view
     cannot identify the revision it read. Both stop the automatic save loop,
     because repeating a request that will be refused for the same reason is a
     retry loop, not a recovery. */
  SAVE_BLOCKED = false,
  /* RECOVERY MODE. Null in ordinary operation; otherwise the server's description
     of the document this window refused to open, and the single fact that makes
     this window a protected one. It is not a display flag: while it is set no
     project write may leave this window, no revision change may install anything,
     and no commit may install a record — see the guards on dirty(),
     queueProjectSave(), watchProjectRevision() and commitPreparedProject().

     IT IS NEVER PERSISTED AND NEVER RESTORED FROM ANYWHERE. Quarantine is
     RE-DERIVED, on every open, from the server's own verdict about the stored
     bytes. A broken project is still broken after a reload, so the verdict is
     still the same one — and a repaired project simply opens, with nothing to
     clear, because there was never a stored flag saying otherwise. */
  PROJECT_QUARANTINE = null,
  SAVED_PROJECT_BASELINE = null,
  /* WHICH EXPLICIT OPEN THIS WINDOW IS. Advanced by a REPLACEMENT — boot, the
     switcher, a rollback, a restore, an archive, a delete, an import, a
     deliberate reopen, and the first-run terminal — and by nothing else. An
     ordinary same-project refresh is the SAME open reading a newer copy of its
     own record, so it must not move this. See the project load transaction. */
  PROJECT_OPEN_EPOCH = 0,
  /* And how the refreshes WITHIN one open are ordered against each other. The
     sequence is taken when a refresh starts; the watermark moves only when a
     refresh COMMITS, so a later request merely starting disqualifies nothing. */
  PROJECT_REFRESH_SEQUENCE = 0,
  PROJECT_REFRESH_COMMITTED = 0,
  /* THE SUCCESSFUL-SAVE GENERATION. Advanced once by every write THIS WINDOW made
     that storage ACCEPTED, and by a rebase that re-points the saved baseline at a
     different stored document. A refresh captures it when it starts and must find
     it unchanged to commit: a snapshot read before this window put something on
     disk is BEHIND the record, and installing it would roll the window back to a
     document the server no longer has.

     WHY NOT PROJECT_REVISION. The revision cannot answer that question, because a
     refresh COMMIT legitimately moves it — so requiring the revision to be
     unchanged would discard the second of two overlapping refreshes, which is the
     ordering the sequence and the watermark exist to get right. This counter moves
     only for the one event a prepared snapshot can be behind. Two tokens, two
     questions; neither substitutes for the other.

     Compared for EQUALITY and never for order. "Newer" is not a thing a client can
     ask of it or of an opaque revision string: a prepared snapshot is either from
     the generation its refresh began in, or it is not. */
  PROJECT_SAVE_GENERATION = 0;
let FILTER = { status: "", route: "", char: "", action: "unfinished" };
const storedValue = (key, fallback = null) => localStorage.getItem(key) ?? fallback;
FILTER.action = storedValue("cinebraid-shot-action-filter", "unfinished") || "unfinished";
let BOARD_MODE = storedValue("cinebraid-board-mode", "wall") || "wall";
let SHOT_BOARD_DENSITY = storedValue("cinebraid-shot-board-density", "compact") || "compact";
if (!["compact", "comfortable", "large"].includes(SHOT_BOARD_DENSITY)) SHOT_BOARD_DENSITY = "compact";
let LIBRARY_TAB = storedValue("cinebraid-library-tab", "all") || "all";
let COLLAPSED_SCENES = new Set(JSON.parse(storedValue("cinebraid-collapsed-scenes", "[]") || "[]"));
const storedJSON = (key, fallback = {}) => {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
};
let SHOT_VIEW_MODE = "focused";
let SHOT_SECTION_STATE = storedJSON("cinebraid-shot-section-state", {});
let SHOT_SEGMENT_STATE = storedJSON("cinebraid-shot-segment-state", {});
let SHOT_CANDIDATE_SIZE = storedValue("cinebraid-shot-candidate-size", "medium") || "medium";
let SAVE_STATE_TIMER = null;
let HELP_MODE = storedValue("cinebraid-help-mode", "helpful") || "helpful";
let PROJECT_BOARD_FILTER = storedValue("cinebraid-project-board-filter", "all") || "all";
let PROJECT_NAV_OPEN = storedValue("cinebraid-project-nav-open-v662", "0") === "1";
let BATCH_SHOTS = new Set();
let CURRENT_RENDER_ROUTE_KEY = "";
let ROUTE_RENDER_IN_PROGRESS = false;
let ROUTE_VIEW_RESTORE_TOKEN = 0;
let ROUTE_REQUEST_TOKEN = 0;
function projectWorkflowEmphasis() {
  return P?.meta?.workflowEmphasis === "assisted" ? "assisted" : "manual";
}
function manualFirstWorkflow() {
  return projectWorkflowEmphasis() === "manual";
}
/* The title used to call load(), which re-read the project from disk and threw the
   edit away before the queued save could run — while the indicator still read
   "Saved". It now takes the same autosave path as every other project field and
   refreshes the labels that display it. */
window.setProjectTitle = (value) => {
  if (!P?.meta) return;
  P.meta.title = String(value ?? "");
  applyProjectIdentity();
  dirty();
};
window.setProjectWorkflowEmphasis = (value) => {
  if (!P?.meta) return;
  P.meta.workflowEmphasis = value === "assisted" ? "assisted" : "manual";
  dirty();
  route();
  toast(P.meta.workflowEmphasis === "manual" ? "Manual-first workspace enabled" : "Assisted-production workspace enabled");
};
const $ = (s) => document.querySelector(s);
const esc = (t) =>
  String(t ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const attr = (t) => esc(t).replace(/'/g, "&#39;");
const helpAttr = (text, requirement = "") =>
  HELP_MODE === "minimal"
    ? ""
    : ` data-tip="${attr(text + (requirement ? " Requires: " + requirement : ""))}" tabindex="0"`;
const STATUSES = ["UNBUILT", "BUILT", "NEEDS POST", "LOCKED"]; // legacy storage values
/* The legacy per-entity status vocabulary ("NOT STARTED" … "APPROVED") no longer
   has a list here. Its only remaining reader was the chip row on the character
   voice panel, which wrote a second voice lifecycle onto the character; the
   stored values are still interpreted, by entityWorkflowState() and by
   public/shared-voice.js, but nothing offers them as a set of things to write. */
const WORKFLOW_STATES = [
  "DRAFT",
  "IN PROGRESS",
  "READY FOR REVIEW",
  "CHANGES REQUESTED",
  "APPROVED",
];
/* Count-aware wording. Every visible "N thing(s)" string goes through one of these so
   a project with exactly one shot never reads "1 shots". */
const plural = (n, one, many = one + "s") => `${n} ${Number(n) === 1 ? one : many}`;
const pluralWord = (n, one, many = one + "s") => (Number(n) === 1 ? one : many);

/* The only words allowed in a stage status slot, on the shot taskbar and the reference
   taskbar alike. Each names a state the work is actually in. Commands ("Set look"),
   time references ("Later") and bare counts ("2/3") are not statuses and must not
   appear here — a count belongs in the stage's description line instead. */
const STAGE_STATUS = {
  notStarted: "Not started",
  inProgress: "In progress",
  incomplete: "Incomplete",
  needsReview: "Needs review",
  nothingWaiting: "Nothing waiting",
  running: "Running",
  failed: "Failed",
  approved: "Approved",
  complete: "Complete",
  /* O4: was "Not needed yet". This key is produced by exactly one derivation —
     public/shared-stage-model.js's `blocked` status, for motion and deliver — and
     that model is explicit that it CANNOT tell a stage that will never be needed
     from one the shot has not reached: there is no not-applicable member, and
     inventing the distinction is named as a declared limitation. "Not needed yet"
     was that invented distinction wearing the strip's clothes. The stage has a real
     unmet prerequisite and the model states it, so the strip says so and shows the
     reason beside it. */
  blocked: "Blocked",
  /* DOGFOOD SLICE 0. Two words for two things the strip previously had to say with
     "Not started", which reads as a debt.

     `notRequired` is the answer of whatever the shot has DECLARED: nothing it has
     said asks for an authored frame, so Frames is not owed one. Originally this was
     a declared ROUTE's answer only, which left an undeclared shot reading
     "Not started — 0 of 1 frame approved" while the same screen's command summary
     read "0/0". The reading is now the canonical required-frame count, so a shot
     that has declared nothing gets the same honest word as one whose declared route
     asks for no frame. It is emphatically NOT the not-applicable distinction
     shared-stage-model.js declares it cannot make — that is about a stage being
     irrelevant to a shot forever, and this is a live reading of declarations the
     filmmaker can change at any time.

     `optional` is the answer for a stage the production visibly moved past: the work
     is still available, still reachable, and not outstanding. */
  notRequired: "Not required",
  optional: "Optional",
};

/* One name per production concept, used everywhere that concept is counted. "Delivered"
   and "Approved" are deliberately different words for deliberately different states:
   a shot is delivered when a final file is recorded on it, and approved when its
   workflow status is APPROVED. A shot can be either without being the other. */
/* THE WORKFLOW WORD IS NOT THE CANON WORD.
 *
 * `APPROVED` is a shot/reference LIFECYCLE state a run or a human can set; it
 * means "this record is signed off and closed", and it has never meant that a
 * person approved specific bytes as production truth. Two different facts wore
 * one word, and every audit of this codebase has tripped over it.
 *
 * The STORED token is unchanged — renaming it would be a data migration, and
 * nothing here migrates. Only the word a person reads changes. */
/* ALL FIVE, not only the one that collides. The collision is why this table
 * exists, but a table that renames APPROVED alone leaves a filmmaker reading
 * "Signed off" beside "IN PROGRESS" — one sentence-case word among four shouted
 * ones, which reads as a different KIND of fact rather than as the same field
 * holding a different value. Surfaces that want the shouted form keep their own
 * `text-transform:uppercase`; the WORD is decided here and nowhere else. */
const WORKFLOW_STATUS_LABELS = {
  DRAFT: "Draft",
  "IN PROGRESS": "In progress",
  "READY FOR REVIEW": "Ready for review",
  "CHANGES REQUESTED": "Changes requested",
  APPROVED: "Signed off",
};
/* The fallback is for a token this build does not know — a project written by a
   later version, say. It could not fire before: the literal carried a raw
   backspace byte where `\b` was meant, so the pattern was "a backspace followed
   by w" and an unknown token came back exactly as stored. */
const workflowStatusLabel = (key) => WORKFLOW_STATUS_LABELS[key]
  || String(key).toLowerCase().replace(/\b\w/, (c) => c.toUpperCase());
/* DELIVERED IS A DECISION, NOT A POINTER, and this predicate is where four
   surfaces used to learn otherwise — the nav badge, the Production tiles, the shot
   board and the scene cards all read it. It listed the four delivery pointer
   fields, any one of which a rename repair, a duplicate or a legacy project can
   leave standing with no `approve-shot-delivery` receipt behind it.
   shotDeliveryAuthority() asks the kernel instead, and is the same answer readiness,
   the shot lifecycle, the Deliver stage and Finish & Delivery now give. */
const shotIsDelivered = (s) => (typeof shotDeliveryAuthority === "function"
  ? shotDeliveryAuthority(P, s).final
  : false);
const shotIsApproved = (s) => workflowState(s).key === "APPROVED";

const skey = (s) => s.replace(/ /g, "");
const isVideo = (n) => /\.(mp4|webm|mov)$/i.test(n);
const isAudio = (n) => /\.(wav|mp3|m4a|flac|ogg)$/i.test(n);
const shotById = (id) => P.shots.find((x) => x.id === id);
const sceneById = (id) => P.scenes.find((x) => x.id === id);
const clipNeedsWinner = (c) =>
  ["hold", "i2v", "flf"].includes(c.kind || "hold");
/* A MOTION UNIT'S START/END FRAME POINTERS ARE NOT CANON — they select WHICH
   approved stills a unit interpolates between, and the canon they depend on is
   the frame authority that approved those stills. This predicate answers "is
   this unit configured", which is a workflow question, and it is used as such. */
const clipDone = (c) =>
  c.kind === "flf"
    ? !!(c.winner && c.winnerEnd)
    : clipNeedsWinner(c)
      ? !!c.winner
      : true;
/* IS THIS FRAME DONE — an AUTHORITY question, and it was answered by pointer
   presence. A legacy project therefore reported every frame complete and
   `shotApprovalComplete` unlocked delivery on decisions nobody had made. */
const frameDone = (s, f) => !!f && typeof hasCurrentHumanAuthority === "function"
  && hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: s && s.id, frameId: f.id });
const requiredFrames = (s) =>
  (s.keyframes || []).filter((f) => f.required !== false);
const motionUnitsForApproval = (s) =>
  (s.clips || []).filter(
    (c) => !["plan", "post", "reuse", "hold"].includes(c.kind),
  );
const shotApprovalComplete = (s) => {
  const frames = requiredFrames(s),
    motions = motionUnitsForApproval(s);
  const framesReady = !frames.length || frames.every((frame) => frameDone(s, frame));
  /* MOTION READINESS IS CANON TOO. `!!c.videoWinner` is a pointer, and a shot
     whose motion nobody approved is not complete. */
  const motionReady = !motions.length || motions.every((c) => typeof hasCurrentHumanAuthority === "function"
    && hasCurrentHumanAuthority(P, { kind: "shot-motion", shotId: s.id, unitKey: c.id || c.suffix || "" }));
  const sequenceReview = s?.creationBrief?.frameSequenceReview || null;
  const sequenceFiles = frames.map((frame) => frame.winner).filter(Boolean);
  const sequenceReady = frames.length < 2 || !!(
    sequenceReview?.pass === true &&
    Array.isArray(sequenceReview.files) &&
    sequenceReview.files.length === sequenceFiles.length &&
    sequenceReview.files.every((name, index) => name === sequenceFiles[index])
  );
  return (
    framesReady &&
    sequenceReady &&
    motionReady &&
    (frames.length || motions.length || !!s.winner)
  );
};
/* P4-SEM-C3. Both readers below resolve a winner edge IDENTITY FIRST, through the
   one shared rule, and fall back to the filename when either side carries no id —
   which is every pre-C3 project and every file the ledger has not verified. The
   search ORDER and the badge wording are preserved exactly; only the comparison
   changed, so a project with no identity behaves as it always did. */
const winnerEdgeName = (s, record, field, takes) => {
  const file = String(record?.[field] || "");
  if (!file) return "";
  const assetId = typeof shotAssetIdField === "function" ? record?.[shotAssetIdField(field)] : "";
  const resolved = typeof resolveApprovalMedia === "function"
    ? resolveApprovalMedia({ file, assetId: assetId || "" }, takes || [])
    : null;
  return resolved ? resolved.name : file;
};
const anyWinnerTake = (s, takes) => {
  const hit = (record, field) => {
    const name = winnerEdgeName(s, record, field, takes);
    return name ? takes.find((t) => t.name === name) : null;
  };
  for (const f of s.keyframes || []) {
    const t = hit(f, "winner");
    if (t) return t;
  }
  for (const c of s.clips || []) {
    const t = hit(c, "winner") || hit(c, "winnerEnd") || hit(c, "videoWinner");
    if (t) return t;
  }
  return s.winner ? hit(s, "winner") : null;
};
const takeBadges = (s, name, takes = takesFor(s.id)) => {
  const out = [];
  const is = (record, field) => !!name && winnerEdgeName(s, record, field, takes) === name;
  if (is(s, "winner")) out.push("SHOT WINNER");
  for (const f of s.keyframes || [])
    if (is(f, "winner")) out.push(`FRAME ${f.label || "?"}`);
  for (const c of s.clips || []) {
    if (is(c, "videoWinner"))
      out.push(`MOTION ${(c.label || c.suffix || "?").toUpperCase()}`);
    if (!(s.keyframes || []).length && is(c, "winner"))
      out.push(c.kind === "flf" ? c.suffix + " FIRST" : "WINNER · " + c.suffix);
    if (!(s.keyframes || []).length && is(c, "winnerEnd"))
      out.push(c.suffix + " LAST");
  }
  return out;
};
const shotDur = (s) =>
  s.clips?.length
    ? s.clips.reduce((x, c) => x + (+c.dur || 0), 0)
    : +s.dur || 0;
const mmss = (sec) =>
  Math.floor(sec / 60) + ":" + String(Math.round(sec % 60)).padStart(2, "0");

function stringDistance(a, b) {
  const left = String(a || "").toLowerCase(), right = String(b || "").toLowerCase();
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j], cost = left[i - 1] === right[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return previous[right.length];
}
function closestExistingId(id, ids = []) {
  const rows = (ids || []).map(String).filter(Boolean);
  if (!rows.length) return "";
  return rows.map((candidate) => ({ candidate, distance: stringDistance(id, candidate) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))[0]?.candidate || "";
}
function sharedNotFoundView(type, id, listHref, listLabel, existingIds = [], itemHrefPrefix = "") {
  const safeType = String(type || "Item"), safeId = String(id || "");
  const closest = closestExistingId(safeId, existingIds);
  const suggestionHref = closest && itemHrefPrefix ? `${String(itemHrefPrefix).replace(/\/?$/, "/")}${encodeURIComponent(closest)}` : "";
  const suggestion = suggestionHref && stringDistance(safeId, closest) <= Math.max(3, Math.ceil(Math.max(safeId.length, closest.length) * 0.45))
    ? `<p class="not-found-suggestion">Closest existing ID: <a href="${attr(suggestionHref)}">${esc(closest)}</a></p>`
    : "";
  return `<section class="not-found-state" role="status"><span>NOT FOUND</span><h1>${esc(safeType)} not found</h1><p>CineBraid could not find ${esc(safeType.toLowerCase())} <code>${esc(safeId || "(missing ID)")}</code>. It may have been renamed, deleted, or opened from a stale bookmark.</p>${suggestion}<div class="not-found-actions"><a class="approve-btn" href="${attr(listHref)}">Back to ${esc(listLabel)}</a></div></section>`;
}

/* ---------- persistence ---------- */
/* An appearance preview is exactly that: it lives in memory for as long as the
   Settings screen is open and is never written anywhere. Only Save writes it to
   the server and to this browser's stored theme, so closing Settings — or
   reloading — returns the interface to the last saved appearance. */
let APPEARANCE_PREVIEW = null;
function applyTheme() {
  const app = document.getElementById("app");
  if (!app) return;
  const appearance = CONFIG?.appearance || {};
  const preview = APPEARANCE_PREVIEW || {};
  const pick = (previewKey, storageKey, savedValue, fallback) =>
    preview[previewKey] != null ? String(preview[previewKey]) : localStorage.getItem(storageKey) || savedValue || fallback;
  const acc = pick("accent", "ahub-acc", appearance.accent, "blue");
  const surf = pick("surface", "ahub-surf", appearance.surface, "night");
  const scale = String(pick("scale", "cinebraid-ui-scale", appearance.scale, "100"));
  const font = pick("font", "cinebraid-ui-font", appearance.font, "studio");
  app.dataset.acc = acc;
  app.dataset.surf = surf;
  app.dataset.font = font;
  app.dataset.density = pick("density", "cinebraid-ui-density", appearance.density, "comfortable");
  if (document.documentElement?.style?.setProperty) document.documentElement.style.setProperty("--ui-scale", `${Math.max(90, Math.min(110, Number(scale) || 100)) / 100}`);
  document.body.dataset.help = HELP_MODE;
}
/* The production format, expressed as CSS custom properties.
 *
 * Display-only, exactly like applyTheme above: it reads the project record and writes
 * DOM variables, never the other way round. Opening or switching a project must not
 * write project data, so nothing here calls dirty() or normalizes stored values — a
 * malformed or absent ratio simply resolves to nothing and the 16/9 CSS fallbacks stand.
 *
 * Only the ratio and the review-canvas size are published. Every height cap is a
 * compile-time constant in the stylesheet, and no grid column width is derived from a
 * ratio: a track floor computed from a ratio can exceed its own ceiling and collapse the
 * layout. */
function applyProductionFormat() {
  const app = document.getElementById("app");
  if (!app || !app.style || typeof app.style.setProperty !== "function") return;
  const declared = P ? productionAspect(P) : null;
  const effective = declared || resolveAspect(CINEBRAID_ASPECT_FALLBACK);
  app.dataset.cbAspect = declared ? declared.label : "";
  app.style.setProperty("--cb-production-aspect", overviewAspectCss(effective));
  const canvas = selectionWell(effective.ratio);
  app.style.setProperty("--cb-selection-w", `${canvas.w}px`);
  app.style.setProperty("--cb-selection-h", `${canvas.h}px`);
}

/* A shot that declares its own format is shown in that format everywhere it appears —
   the board, the returned-results dashboard, its own workspace — not only inside the open
   Shot page. Shots that inherit resolve to the project's format, which is what the
   #app-level variables already carry, so the two agree by construction.

   Overview surfaces take the ratio alone: their width belongs to the grid, and a
   ratio-derived column width can invert a minmax() and collapse the layout. */
function shotWellStyle(shot) {
  const aspect = P ? shotOutputAspect(P, shot) : null;
  return aspect ? aspectStyleVars(aspect, { selection: false }) : "";
}
/* Review canvases take both dimensions, computed from the shot's effective ratio, so a
   9:16 shot inside a 16:9 production is judged tall rather than as a strip. The
   project-level variables remain only as the fallback for anything unscoped. */
function shotCanvasStyle(shot) {
  const aspect = P ? shotOutputAspect(P, shot) : null;
  return aspect ? aspectStyleVars(aspect) : "";
}

/* References keep their own shape. A character sheet, a prop plate or an angle choice is
   not a shot, so it is never forced into the production's output ratio — the well takes
   the asset's real dimensions once the browser knows them. Nothing is stored about an
   asset's size, so the only place to read it is the loaded image itself.

   The reference wells are named once here rather than tagged at every render site, so a
   new reference surface joins by adding one selector and no rendering code ever has to
   know what an aspect ratio is. Some of these wells are the image itself. */
const CB_INTRINSIC_WELLS =
  ".library-preview,.guided-input-thumb,.entity-authority-thumb,.state-approved-preview,.state-validation-thumbs img";

function applyIntrinsicAspect(well, img) {
  if (!well || !well.style || typeof well.style.setProperty !== "function") return;
  const aspect = intrinsicAspect(img.naturalWidth, img.naturalHeight);
  /* A separate property from the shot wells on purpose: a reference sitting inside a
     shot workspace must not inherit that shot's output ratio. */
  if (aspect) well.style.setProperty("--cb-intrinsic-aspect", overviewAspectCss(aspect));
}
/* Keyed on the src rather than a plain "already bound" flag, so swapping an image's
   source rebinds and recomputes instead of leaving the old shape in place. A cached
   image is already complete and never fires load, so it is handled directly. */
function bindIntrinsicAspect(root) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  const wells = typeof scope.querySelectorAll === "function"
    ? scope.querySelectorAll(CB_INTRINSIC_WELLS)
    : [];
  for (const well of wells) {
    const img = well.tagName === "IMG" ? well : well.querySelector?.("img");
    if (!img || !img.dataset) continue;
    const src = (typeof img.getAttribute === "function" && img.getAttribute("src")) || "";
    if (img.dataset.cbAspectSrc === src) continue;
    img.dataset.cbAspectSrc = src;
    if (img.complete && img.naturalWidth) {
      applyIntrinsicAspect(well, img);
      continue;
    }
    img.addEventListener("load", () => applyIntrinsicAspect(well, img), { once: true });
    /* An asset that cannot load keeps the bounded fallback well; `contain` means it was
       never going to be cropped either way. */
    img.addEventListener("error", () => {}, { once: true });
  }
}
/* Tabs, modals and comparison panels render without a route change, so route() alone
   would miss them. The observer is deliberately bounded to the two containers that hold
   rendered content, and coalesces a burst of mutations into one pass. */
let INTRINSIC_ASPECT_OBSERVER = null;
let INTRINSIC_ASPECT_PENDING = false;
function watchIntrinsicAspect() {
  if (INTRINSIC_ASPECT_OBSERVER || typeof MutationObserver === "undefined") return;
  const targets = ["#main", "#modal"]
    .map((selector) => document.querySelector(selector))
    .filter((node) => node && typeof node.querySelectorAll === "function");
  if (!targets.length) return;
  INTRINSIC_ASPECT_OBSERVER = new MutationObserver(() => {
    if (INTRINSIC_ASPECT_PENDING) return;
    INTRINSIC_ASPECT_PENDING = true;
    const run = () => {
      INTRINSIC_ASPECT_PENDING = false;
      bindIntrinsicAspect();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 0);
  });
  for (const target of targets)
    INTRINSIC_ASPECT_OBSERVER.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
}

window.setAppearancePreview = (options) => {
  APPEARANCE_PREVIEW = options ? { ...options } : null;
  applyTheme();
};

window.setTheme = (k, v) => {
  localStorage.setItem("ahub-" + k, v);
  applyTheme();
  route();
};
/* Called only once an appearance change has actually been saved, so this browser's
   stored theme can never disagree with the appearance recorded on the server. */
window.commitWorkspaceAppearance = (options = {}) => {
  if (options.accent) localStorage.setItem("ahub-acc", options.accent);
  if (options.surface) localStorage.setItem("ahub-surf", options.surface);
  if (options.scale) localStorage.setItem("cinebraid-ui-scale", String(options.scale));
  if (options.density) localStorage.setItem("cinebraid-ui-density", String(options.density));
  if (options.font) localStorage.setItem("cinebraid-ui-font", String(options.font));
  APPEARANCE_PREVIEW = null;
  applyTheme();
};
window.setProjectAIPolicy = (v) => {
  P.meta.aiPolicy = v;
  dirty();
  route();
  toast("Project AI policy updated");
};
window.setHelpMode = (v) => {
  HELP_MODE = v;
  localStorage.setItem("cinebraid-help-mode", v);
  applyTheme();
  route();
};
function alphaLabel(i) {
  let n = i + 1,
    out = "";
  while (n) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}
function newKeyframe(index, title = "") {
  const label = alphaLabel(index);
  return {
    id: "frame-" + label.toLowerCase() + "-" + Date.now().toString(36) + index,
    label,
    title: title || `${label === "A" ? "Opening" : "Key"} frame ${label}`,
    winner: null,
    description: "",
    notes: "",
    required: true,
    generationPackages: [],
  };
}
function normalizeShotV5(s) {
  let changed = false;
  s.clips = s.clips || [];
  if (!s.audio || typeof s.audio !== "object") { s.audio = {}; changed = true; }
  for (const key of ["line", "speakerId", "note", "voiceEntityId", "vo", "sfx", "ambience", "music", "emotion", "delivery", "language", "pace", "volume", "sync"]) {
    if (s.audio[key] == null) { s.audio[key] = ""; changed = true; }
  }
  if (!Array.isArray(s.keyframes)) {
    s.keyframes = [];
    changed = true;
    const files = [];
    for (const c of s.clips) {
      if (c.winner && !files.includes(c.winner)) files.push(c.winner);
      if (c.winnerEnd && !files.includes(c.winnerEnd)) files.push(c.winnerEnd);
    }
    if (s.winner && !files.includes(s.winner)) files.unshift(s.winner);
    const count = Math.max(
      1,
      files.length,
      s.clips.some((c) => c.kind === "flf") ? 2 : 1,
    );
    for (let i = 0; i < count; i++) {
      const f = newKeyframe(i);
      f.winner = files[i] || null;
      s.keyframes.push(f);
    }
  }
  /* BATCH 1B: THIS PROPAGATES AN EXISTING EDGE; IT ESTABLISHES NOTHING.

     Normalisation mirrors a shot's winner onto the opening frame record so both
     shapes agree. It mints no authority receipt, and it cannot: the opening
     frame already resolves through `shot.winner` in `liveAuthorityValue`, so
     copying the string changes what the record LOOKS like and not one thing
     about who decided it. A shot carrying a winner nobody approved is still a
     historic selection after this runs, on both records. */
  if (
    s.winner &&
    !isVideo(s.winner) &&
    !isAudio(s.winner) &&
    s.keyframes[0] &&
    !s.keyframes[0].winner
  ) {
    s.keyframes[0].winner = s.winner;
    changed = true;
  }
  s.keyframes.forEach((f, i) => {
    if (!f.id) {
      f.id = "frame-" + alphaLabel(i).toLowerCase();
      changed = true;
    }
    const label = alphaLabel(i);
    if (f.label !== label) {
      f.label = label;
      changed = true;
    }
    f.generationPackages = f.generationPackages || [];
    if (f.required == null) {
      f.required = true;
      changed = true;
    }
  });
  if (!s.clips.length && (s.motionPrompt || "").trim()) {
    s.clips = [
      {
        id: "seg-" + Date.now().toString(36),
        suffix: "a",
        label: "A",
        title: "Primary motion",
        dur: +s.dur || 5,
        kind: (s.route || "").includes("FLF")
          ? "flf"
          : (s.route || "").includes("R2V")
            ? "r2v"
            : "i2v",
        note: s.motionPrompt || "",
        motionPrompt: s.motionPrompt || "",
        fromFrame: s.keyframes[0]?.id || "",
        toFrame: "",
        generationPackages: [],
      },
    ];
    changed = true;
  }
  s.clips.forEach((c, i) => {
    if (!c.id) {
      c.id = "seg-" + (c.suffix || i) + "-" + Date.now().toString(36);
      changed = true;
    }
    const label = alphaLabel(i);
    if (c.label !== label) {
      c.label = label;
      changed = true;
    }
    if (!c.suffix) {
      c.suffix = label.toLowerCase();
      changed = true;
    }
    if (c.kind === "hold") {
      c.kind = (c.motionPrompt || c.note || "").trim() ? "i2v" : "plan";
      changed = true;
    } else if (
      /* `t2v` belongs here, and its absence was not cosmetic: a text-to-video clip
         was COERCED to i2v, which then demanded a paid still and a human approval
         gate the shot never needed. The route was already wired — the fal adapter
         serves t2v, minimax-h3/t2v is dispatchable, and the still gate already
         exempts it — so the only thing standing between an establishing shot and
         the workflow written for it was this list. */
      !["t2v", "i2v", "flf", "r2v", "plan", "post", "reuse"].includes(c.kind)
    ) {
      c.kind = "i2v";
      changed = true;
    }
    /* Only endpoint-driven routes begin from a shot frame. Description-only begins
       from direction, and reference-driven motion receives canonical references rather
       than an inferred opening-frame prerequisite. */
    if (!c.fromFrame && ["i2v", "flf"].includes(c.kind)) {
      c.fromFrame =
        s.keyframes[Math.min(i, s.keyframes.length - 1)]?.id ||
        s.keyframes[0]?.id ||
        "";
      changed = true;
    }
    if (c.kind === "flf" && !c.toFrame) {
      if (!s.keyframes[i + 1]) {
        s.keyframes.push(newKeyframe(s.keyframes.length));
        changed = true;
      }
      c.toFrame = s.keyframes[i + 1]?.id || "";
      changed = true;
    }
    for (const key of ["line", "speakerId", "audioNote", "voiceEntityId", "vo", "sfx", "ambience", "music", "emotion", "delivery", "language", "pace", "volume", "sync"]) {
      if (c[key] == null) { c[key] = ""; changed = true; }
    }
    c.generationPackages = c.generationPackages || [];
  });
  if (!s.creationBrief || typeof s.creationBrief !== "object") {
    s.creationBrief = {};
    changed = true;
  }
  if (!Array.isArray(s.creationBrief.propIds)) {
    s.creationBrief.propIds = [];
    changed = true;
  }
  if (!Array.isArray(s.creationBrief.promptBuilds)) {
    s.creationBrief.promptBuilds = [];
    changed = true;
  }
  if (!s.creationBrief.mode) {
    s.creationBrief.mode = "auto";
    changed = true;
  }
  const resolvedEntities = resolveShotEntities(P, s);
  const resolvedLocationId = resolvedEntities.locations[0]?.id || "";
  // Preserve stale explicit IDs so the Inputs workspace can show and repair them.
  // Only infer a location when the project has no explicit location relationship.
  /* AND NEVER OVER A DECISION THE FILMMAKER ALREADY MADE.
   *
   * This inference exists for imported and legacy documents, where a location
   * lives in `codes[]` and no primary was ever stored. It reads the first
   * resolvable location, which is a guess — harmless while the only alternative
   * is nothing, and wrong the moment a person has said "no primary plate".
   *
   * Clearing the primary on a shot that also has a SUPPORTING location left
   * `locationId` empty with the support still in `codes[]`, so the very next
   * normalisation promoted the support into primary. The filmmaker's clear
   * survived one render and was gone by the next load.
   *
   * WHY PRESENCE/ABSENCE CANNOT CARRY THIS, measured rather than assumed. The
   * obvious encoding — "key present and empty means explicitly cleared, key
   * absent means never decided" — was tested against the corpus in this
   * repository: 611 shots across 77 project documents. 533 carry no
   * `locationId` key at all, and 23 carry it PRESENT AND EMPTY — of which 16 are
   * real sanitized Overfit shots whose `codes[]` do name a location and which
   * depend on this inference to show a plate at all. Both existing shapes
   * already mean "please infer", so neither is free to mean "explicitly
   * cleared", and adopting that encoding would silently take the primary plate
   * away from 16 real shots on load.
   *
   * So the decision is recorded, additively, by the writer that makes it. It is
   * ABSENT on every one of those 611 shots, which is why no document changes
   * behaviour: absence reads exactly as it always did. */
  if (!String(s.creationBrief.locationId || "").trim() && resolvedLocationId
      && s.creationBrief[SHOT_NO_PRIMARY_LOCATION_KEY] !== true) {
    s.creationBrief.locationId = resolvedLocationId;
    changed = true;
  }
  const resolvedPropIds = resolvedEntities.props.map((x) => x.id);
  const preservedPropIds = (s.creationBrief.propIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const nextPropIds = [...new Set([...preservedPropIds, ...resolvedPropIds])];
  if (JSON.stringify(nextPropIds) !== JSON.stringify(s.creationBrief.propIds)) {
    s.creationBrief.propIds = nextPropIds;
    changed = true;
  }
  return changed;
}

/* THE ONE KEY THAT RECORDS "THIS SHOT HAS NO PRIMARY LOCATION, DELIBERATELY".
 *
 * Written by exactly one control — the picker's No-location choice, through
 * setShotCreationLocation — and deleted by any explicit location selection. Read
 * by exactly one reader, the inference guard above. It is not authority, it is
 * not a relationship, and it carries no state of its own: it is the difference
 * between "nobody has decided" and "somebody decided none", which is the only
 * fact the document did not already hold.
 *
 * Named here rather than spelled at each site so a reader, a writer and a test
 * cannot each invent their own. */
const SHOT_NO_PRIMARY_LOCATION_KEY = "noPrimaryLocation";

function projectCoverageTemplate(list) {
  const templates = {
    characters: [["front","Front",true],["front-three-quarter","3/4 front",true],["profile","Profile",true],["rear","Rear",true],["detail-face","Face / detail",false],["expression","Expression / optional detail",false]],
    props: [["hero","Front / hero",true],["three-quarter","3/4 view",true],["side","Side",true],["rear","Rear",false],["top","Top",false],["detail","Detail / function close-up",true]],
    vehicles: [["front","Front",true],["rear","Rear",true],["left-side","Left side",true],["right-side","Right side",true],["front-three-quarter","Front 3/4",true],["rear-three-quarter","Rear 3/4",false],["interior","Interior / cockpit",false],["detail","Detail",false]],
    locations: [["establishing","Master establishing",true],["reverse","Reverse angle",true],["left-coverage","Left-facing coverage",false],["right-coverage","Right-facing coverage",false],["action-zone","Key action zone",true],["entrance-exit","Entrance / exit",false],["detail-zone","Detail zone",false],["overhead","Overhead / layout",false]],
  };
  return (templates[list] || []).map(([id,label,required]) => ({ id,label,requirement:templateRequirement(required),approvedFile:"",notes:"",status:"missing",replacementHistory:[] }));
}
function projectExpressionTemplate(entity) {
  const raw = String(entity?.expressions || "neutral; focused; worried; determined; relieved; custom").split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  return (raw.length ? raw : ["Neutral","Focused","Worried","Determined","Relieved","Custom"]).map((label,index) => ({
    id: String(label || `Expression ${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || `expression-${index + 1}`,
    label,
    requirement: templateRequirement(index < 4),
    approvedFile: "",
    notes: "",
    status: "missing",
    replacementHistory: [],
  }));
}
/* The second copy, now the same one reader. See shared-coverage.js — this one
   also matched a row on `original`, the creator's pre-upload filename, so a file
   could be classified by a NEIGHBOURING row's name. */
function projectCandidateIsCoverageSheet(entity, fileName) {
  return isCoverageSheetArtifact(entity, fileName);
}
function normalizedCoverageAlias(list, slot) {
  const label = String(slot?.label || slot?.id || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!label) return "";
  if (list === "characters") {
    if (/\b(front|frontal)\b/.test(label) && !/(three|3) quarter|rear|behind|back/.test(label)) return "front";
    if (/(three|3) quarter/.test(label) && !/rear|behind|back/.test(label)) return "front-three-quarter";
    if (/profile|side view|left side|right side/.test(label)) return "profile";
    if (/\b(rear|back)\b/.test(label) && !/(three|3) quarter/.test(label)) return "rear";
    if (/face|head|portrait|close up|closeup/.test(label)) return "detail-face";
    if (/expression|emotion/.test(label)) return "expression";
  }
  if (list === "props") {
    if (/front|hero/.test(label) && !/(three|3) quarter/.test(label)) return "hero";
    if (/(three|3) quarter/.test(label)) return "three-quarter";
    if (/profile|side/.test(label)) return "side";
    if (/rear|back/.test(label)) return "rear";
    if (/top|overhead/.test(label)) return "top";
    if (/detail|close up|closeup|function|hands?/.test(label)) return "detail";
  }
  if (list === "vehicles") {
    if (/front/.test(label) && /(three|3) quarter/.test(label)) return "front-three-quarter";
    if (/rear|back/.test(label) && /(three|3) quarter/.test(label)) return "rear-three-quarter";
    if (/front/.test(label)) return "front";
    if (/rear|back/.test(label)) return "rear";
    if (/left/.test(label)) return "left-side";
    if (/right/.test(label)) return "right-side";
    if (/interior|cockpit|cabin/.test(label)) return "interior";
    if (/detail|close up|closeup/.test(label)) return "detail";
  }
  if (list === "locations") {
    if (/master|establish/.test(label)) return "establishing";
    if (/reverse/.test(label)) return "reverse";
    if (/left/.test(label)) return "left-coverage";
    if (/right/.test(label)) return "right-coverage";
    if (/action|hero zone|key zone/.test(label)) return "action-zone";
    if (/entrance|exit|door/.test(label)) return "entrance-exit";
    if (/detail/.test(label)) return "detail-zone";
    if (/overhead|top|layout|floor plan/.test(label)) return "overhead";
  }
  return "";
}
/* Merge a stored slot onto its template default WITHOUT canonicalising it.

   The old line here was `next.required = typeof next.required === "boolean" ?
   next.required : slot.required`, and it was a live defect in both directions:
   a stored slot authored as `requirement: "not-required"` but carrying no
   boolean had the template's `required: true` MINTED onto it while the project
   was merely being opened, and the Reference Inspector then read the minted
   boolean and called the slot required.

   The rule now is the one P0 §8 rule 1 states for the format and this function
   had drifted from: DEFAULTS ARE APPLIED AT USE, NEVER AT LOAD. A stored slot
   that already carries either encoding keeps exactly what it stored and gains
   nothing; only a slot the template is introducing for the first time — where
   there is no stored fact to overwrite — is seeded. */
/* The local is `merged`, not `next`. tests/reference-workspace-ux.js pins the
   legacy silent-angle branch by slicing app.js from `const wasSilentCharacterSeed`
   to the first `return next;`, so a second, earlier `return next;` would invert
   that slice and silently disable the guard rather than fail it. */
function seedCoverageRequirement(template, prior) {
  const { requirement: seeded, ...base } = template;
  const merged = { ...base, ...(prior || {}) };
  if (!("requirement" in merged) && !("referenceRequirement" in merged) && !("required" in merged)) merged.requirement = seeded;
  return merged;
}
function mergeCoverageSlotNotes(base, imported) {
  const detail = String(imported?.notes || imported?.label || "").trim();
  if (!detail || detail.toLowerCase() === String(base?.label || "").toLowerCase()) return String(base?.notes || "");
  const current = String(base?.notes || "").trim();
  return current.includes(detail) ? current : [current, `Imported view detail: ${detail}`].filter(Boolean).join("\n");
}
function normalizeReferenceCoverageData() {
  let changed = false;
  const warnings = [];
  for (const list of ["characters","locations","props","vehicles"]) {
    const seen = new Map();
    for (const entity of P[list] || []) {
      const id = String(entity?.id || "");
      if (id) {
        if (seen.has(id)) warnings.push(`Duplicate ${list.slice(0,-1)} id ${id}; references may resolve to the first matching record.`);
        else seen.set(id, true);
      }
      const defaults = projectCoverageTemplate(list);
      const existing = Array.isArray(entity.coverageSlots) ? entity.coverageSlots : [];
      const aliasGroups = new Map();
      for (const item of existing) {
        const alias = defaults.some((slot) => slot.id === item?.id) ? String(item.id) : normalizedCoverageAlias(list, item);
        if (!alias) continue;
        const rows = aliasGroups.get(alias) || [];
        rows.push(item);
        aliasGroups.set(alias, rows);
      }
      const merged = defaults.map((slot) => {
        const candidates = aliasGroups.get(slot.id) || [];
        const prior = candidates.find((item) => String(item?.id) === slot.id) || candidates.find((item) => slotSelectedFile(item)) || candidates[0];
        const next = seedCoverageRequirement(slot, prior);
        for (const imported of candidates.filter((item) => item !== prior)) {
          if (!slotSelectedFile(next) && slotSelectedFile(imported)) next.selectedFile = slotSelectedFile(imported);
          next.notes = mergeCoverageSlotNotes(next, imported);
        }
        /* S6 — THE FIELD MOVES, THE VALUE DOES NOT. A legacy slot carries its
           file under `approvedFile`; normalisation carries it forward under
           `selectedFile`, which is the same supporting selection under a name
           that cannot be misread as an approval. No media is touched and no
           history is dropped — only the key the value lives under. */
        next.selectedFile = slotSelectedFile(next);
        delete next.approvedFile;
        next.notes = String(next.notes || "");
        /* K-alpha — NORMALISATION MUST NOT REINSTATE THE WORD THE WRITERS GAVE
           UP. This line, and its two twins below, recompute a slot's status
           from file presence on EVERY project load. While it derived
           "approved", it silently undid the demotion: a slot correctly written
           as a selection came back as an approval the next time the project was
           opened, and no writer was at fault. Deriving "selected" is not a
           migration — `status` is already recomputed here unconditionally, and
           `approvedFile`, the actual data, is untouched. */
        next.status = next.selectedFile ? "selected" : "missing";
        next.replacementHistory = Array.isArray(next.replacementHistory) ? next.replacementHistory : [];
        /* Two legacy conditions used to be corrected here, by clearing the
           slot's approvedFile while the project was merely being opened. Both
           corrections were right about the data and wrong about the moment:
           opening a project is not a migration, and a filmmaker's approval is
           not CineBraid's to withdraw without being asked.

           So the value is preserved and the condition is reported instead,
           through dataIntegrityWarnings — the channel this function already
           owns, which the entity view lists and the app toasts on load. The
           correction itself belongs to the explicit migration framework. */
        const entityLabel = String(entity.name || entity.id || "entity");
        if (next.selectedFile && projectCandidateIsCoverageSheet(entity, next.selectedFile)) {
          warnings.push(`${entityLabel} — the "${next.label || next.id}" view is set to ${next.selectedFile}, which is a multi-view sheet rather than a single angle. The selection is kept as stored; extract the panel you meant before relying on this view.`);
        }
        const wasSilentCharacterSeed = list === "characters"
          && next.selectedFile
          && next.selectedFile === String(entity.approvedFile || "")
          && (next.provenance?.source === "primary-approved-reference" || /automatically seeded from (?:the )?(?:first )?approved primary reference/i.test(next.notes || ""));
        if (wasSilentCharacterSeed) {
          warnings.push(`${entityLabel} — the "${next.label || next.id}" view was filled in automatically from the primary reference ${next.selectedFile}, not chosen. The selection is kept as stored; confirm or reassign the angle before relying on it.`);
        }
        return next;
      });
      /* A custom slot has no template to fall back on, so it is seeded only when
         it declares nothing at all. `required: !!custom.required` used to coerce
         an undeclared slot to `false` here, which read as "planned" — the seed
         below says "planned" outright and stops writing the boolean to say it. */
      for (const custom of existing.filter((item) => item && !defaults.some((slot) => slot.id === item.id) && !normalizedCoverageAlias(list, item))) {
        merged.push({ ...seedCoverageRequirement({ requirement: templateRequirement(false) }, custom), selectedFile: slotSelectedFile(custom), notes: String(custom.notes || ""), status: slotSelectedFile(custom) ? "selected" : "missing", replacementHistory: Array.isArray(custom.replacementHistory) ? custom.replacementHistory : [] });
      }
      if (JSON.stringify(existing) !== JSON.stringify(merged)) { entity.coverageSlots = merged; changed = true; }
      if (list === "characters") {
        const desired = projectExpressionTemplate(entity);
        const priorSlots = Array.isArray(entity.expressionSlots) ? entity.expressionSlots : [];
        const desiredIds = new Set(desired.map((slot) => slot.id));
        const reconciled = desired.map((slot) => {
          const prior = priorSlots.find((item) => String(item?.id) === slot.id);
          const next = { ...seedCoverageRequirement(slot, prior), retired: false };
          /* The expression twin of the coverage migration above: same value,
             same supporting meaning, a key that cannot be misread. */
          next.selectedFile = slotSelectedFile(next);
          delete next.approvedFile;
          next.status = next.selectedFile ? "selected" : "missing";
          next.replacementHistory = Array.isArray(next.replacementHistory) ? next.replacementHistory : [];
          return next;
        });
        for (const stale of priorSlots.filter((slot) => slot && !desiredIds.has(String(slot.id)))) {
          /* `required: false` used to be written here purely to keep a retired
             slot out of the required set. `retired: true` already says that, and
             public/shared-coverage.js now reads it directly, so retirement no
             longer has to overwrite a requirement the filmmaker authored. */
          if (slotSelectedFile(stale)) reconciled.push({ ...stale, retired: true, status: "retired", label: String(stale.label || stale.id) + (String(stale.label || "").includes("retired") ? "" : " (retired)") });
        }
        if (JSON.stringify(priorSlots) !== JSON.stringify(reconciled)) { entity.expressionSlots = reconciled; changed = true; }
      }
    }
  }
  P.meta = P.meta || {};
  /* Recomputed from the record on every load, so it is a reading of the data
     rather than a change to it. Noticing a problem must not dirty the project:
     if writing the warning list counted as a change, a project would be saved
     for having been looked at, which is the behaviour this pass exists to end.
     A project with nothing to warn about and no stored list is left alone
     entirely, so opening a clean record adds not even an empty key. */
  const uniqueWarnings = [...new Set(warnings)];
  if (uniqueWarnings.length || Array.isArray(P.meta.dataIntegrityWarnings)) P.meta.dataIntegrityWarnings = uniqueWarnings;
  if (changed) {
    P.meta.schemaMigrations = P.meta.schemaMigrations || {};
    if (!P.meta.schemaMigrations.coverageV6533) P.meta.schemaMigrations.coverageV6533 = new Date().toISOString();
    if (!P.meta.schemaMigrations.coverageAliasesV6602) P.meta.schemaMigrations.coverageAliasesV6602 = new Date().toISOString();
  }
  return changed;
}

/* Stored data-shape markers. These are schema versions, not the application version
   (package.json) and not the per-project format version (P.meta.version). They must match
   the values server.js BLANK() writes for a new project. */
const HUB_SCHEMA_VERSION = "v6.0.0";
/* Two markers, because "what this build can write" and "what merely opening a
   project guarantees" stopped being the same question in 6.7.

   BASELINE is the shape normalizeProjectV5() repairs a record into. Opening a
   project may raise a record to it, and nothing further: a load must still
   leave a current file byte-identical.

   PROJECT_SCHEMA_VERSION is the shape this build can produce. 6.7 adds three
   user-writable continuity fields — entity.tracking, shot.continuityIntent and
   per-frame continuity state selections — all of which are absent-means-default
   and none of which exist until a user actually declares one. Stamping 6.7 onto
   every project that was merely opened would claim a migration that did not
   happen and rewrite files nobody edited, so the marker is raised by the
   writers instead (see markContinuitySchema). */
const PROJECT_SCHEMA_BASELINE_VERSION = "6.6";
const PROJECT_SCHEMA_VERSION = "6.7";
function schemaVersionParts(value) {
  const digits = String(value ?? "").match(/\d+/g);
  return digits ? digits.map(Number) : null;
}
/* True only when the stored marker is genuinely behind the current one. Missing or
   unreadable markers count as older (legacy records predate them). A marker that is equal
   or ahead is left untouched, so a newer project can never be downgraded by an older build. */
function schemaVersionIsOlder(stored, current) {
  const a = schemaVersionParts(stored), b = schemaVersionParts(current);
  if (!a) return true;
  if (!b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
function storedSchemaIsOlder(meta) {
  return (
    schemaVersionIsOlder(meta?.hubVersion, HUB_SCHEMA_VERSION) ||
    schemaVersionIsOlder(meta?.schemaVersion, PROJECT_SCHEMA_BASELINE_VERSION)
  );
}
/* Called by every writer of a 6.7 continuity field, immediately before dirty().
   The record now genuinely contains 6.7 data, so its marker should say so —
   and only then. schemaVersionIsOlder is the same guard normalization uses, so
   a project already at 6.7 or ahead of it is never touched or downgraded. */
function markContinuitySchema() {
  P.meta = P.meta || {};
  if (!schemaVersionIsOlder(P.meta.schemaVersion, PROJECT_SCHEMA_VERSION)) return false;
  P.meta.schemaVersion = PROJECT_SCHEMA_VERSION;
  return true;
}
if (typeof window !== "undefined") window.markContinuitySchema = markContinuitySchema;

function normalizeProjectV5() {
  let changed = false;
  /* 1D-06: legacy states whose derivation was never recorded. Reported, never
     filled in — see the state loop below. */
  const lineageWarnings = [];
  for (const key of ["characters", "locations", "props", "vehicles", "audio", "scenes", "shots"]) {
    if (!Array.isArray(P[key])) { P[key] = []; changed = true; }
  }
  if (typeof normalizePromptBuildHistory === "function" && normalizePromptBuildHistory(P, { applyRetention: false })) changed = true;
  if (normalizeReferenceCoverageData()) changed = true;
  (P.shots || []).forEach((s) => {
    if (normalizeShotV5(s)) changed = true;
    if (typeof normalizeCandidateReviewSchema === "function" && normalizeCandidateReviewSchema(s, SCAN.shots?.[s.id]?.takes || [])) changed = true;
    if (typeof normalizeShotPackageHistory === "function" && normalizeShotPackageHistory(s)) changed = true;
  });
  for (const list of ["characters", "locations", "props", "vehicles"])
    for (const x of P[list] || []) {
      if (!Array.isArray(x.continuityStates)) {
        x.continuityStates = [];
        changed = true;
      }
      if (!Array.isArray(x.assetPromptBuilds)) {
        x.assetPromptBuilds = [];
        changed = true;
      }
      if (x.creationDescription == null) {
        x.creationDescription = "";
        changed = true;
      }
      const before = JSON.stringify(x.continuityStates);
      if (!x.continuityStates.some((st) => st && st.isDefault)) {
        x.continuityStates.unshift({
          id: "state-default",
          name: "Default",
          appliesTo: "",
          approvedFile: x.approvedFile || "",
          approvedAssetId: x.approvedAssetId || "",
          notes: "Primary approved reference.",
          isDefault: true,
        });
      }
      x.continuityStates.forEach((st, i) => {
        if (!st.id) st.id = i === 0 ? "state-default" : "state-" + Date.now().toString(36) + "-" + i;
        if (!st.name) st.name = st.isDefault ? "Default" : `State ${i + 1}`;
        if (st.approvedFile == null) st.approvedFile = "";
        if (st.notes == null) st.notes = "";
        /* S12 — THE LEGACY DELTA MIGRATION HAPPENS HERE, AT LOAD, ON PURPOSE.
         *
         * It used to live inside the list builder, which meant a project was
         * migrated by whichever inspector, planner or renderer happened to read
         * it first. Normalisation is CineBraid's named, deliberate mutation of a
         * project it has just opened, so the migration belongs here and the
         * readers downstream can be pure. */
        if (!String(st.notes || "").trim() && typeof continuityStateDeltaText === "function") {
          const migratedDelta = continuityStateDeltaText(st);
          if (migratedDelta) st.notes = migratedDelta;
        }
        if (st.appliesTo == null) st.appliesTo = "";
        if (st.isDefault == null) st.isDefault = st.id === "state-default";
        /* 1D-06 — LOAD DOES NOT AUTHOR ANCESTRY. This filled a missing
           `parentStateId` with the default state on every open, which decides
           what a state derives from without asking the person who made it. A
           derivation is chosen at creation; an unrecorded one stays unrecorded
           and is reported below. The key is normalised to a string only when it
           already exists, so readers still see a consistent type. */
        if (st.isDefault === true && st.parentStateId != null) st.parentStateId = "";
        else if (st.parentStateId != null) st.parentStateId = String(st.parentStateId || "");
        if (!["derive", "independent"].includes(st.generationMode))
          st.generationMode = st.isDefault ? "independent" : "derive";
        if (st.assetPromptProfile == null) st.assetPromptProfile = "";
        if (st.assetPromptNotes == null) st.assetPromptNotes = "";
        if (!Array.isArray(st.assetPromptBuilds)) st.assetPromptBuilds = [];
      });
      /* 1D-06: what load does instead of filling ancestry — say so. Collected
         here and merged into the durable channel at the end of this pass, which
         is the same list the coverage normaliser above writes. */
      if (typeof validateStateCollection === "function") {
        const unrecorded = (validateStateCollection(x.continuityStates).legacy || [])
          .map((row) => (x.continuityStates.find((st) => st && st.id === row.id) || {}).name || row.id);
        if (unrecorded.length) {
          lineageWarnings.push(
            `${x.name || x.id} — ${unrecorded.length === 1 ? "the state" : "the states"} ${unrecorded.join(", ")} `
            + `${unrecorded.length === 1 ? "does" : "do"} not record what ${unrecorded.length === 1 ? "it derives" : "they derive"} from. `
            + `CineBraid will not guess. Create a new state from the reference you meant, or leave it as independent history.`,
          );
        }
      }
      const defaultState = x.continuityStates.find((st) => st && st.isDefault) || null;
      if (defaultState && x.approvedFile && !defaultState.approvedFile) {
        defaultState.approvedFile = x.approvedFile;
        defaultState.approvedAssetId = x.approvedAssetId || "";
      }
      if (defaultState?.approvedFile && (x.approvedFile !== defaultState.approvedFile || (x.approvedAssetId || "") !== (defaultState.approvedAssetId || ""))) {
        x.approvedFile = defaultState.approvedFile;
        x.approvedAssetId = defaultState.approvedAssetId || "";
      }
      if (before !== JSON.stringify(x.continuityStates)) changed = true;
    }
  if (!Array.isArray(P.mediaAssets)) {
    P.mediaAssets = [];
    changed = true;
  }
  if (!Array.isArray(P.finishJobs)) {
    P.finishJobs = [];
    changed = true;
  }
  P.finishJobs.forEach((job, i) => {
    if (!job.id) {
      job.id = "finish-" + Date.now().toString(36) + "-" + i;
      changed = true;
    }
    if (!job.type) {
      job.type = "upscale";
      changed = true;
    }
    if (!job.status) {
      job.status = "ready";
      changed = true;
    }
  });
  P.mediaAssets.forEach((asset, assetIndex) => {
    if (!asset.id) {
      asset.id = "media-" + Date.now().toString(36) + "-" + assetIndex;
      changed = true;
    }
    if (!Array.isArray(asset.links)) {
      asset.links = [];
      changed = true;
    }
    asset.links.forEach((link, linkIndex) => {
      if (!link.id) {
        link.id = "link-" + Date.now().toString(36) + "-" + assetIndex + "-" + linkIndex;
        changed = true;
      }
      if (link.agentContext == null) {
        link.agentContext = link.role !== "do-not-use";
        changed = true;
      }
      if (link.generationInput == null) {
        link.generationInput = false;
        changed = true;
      }
      if (link.order == null) {
        link.order = linkIndex;
        changed = true;
      }
      if (link.angleTag == null) {
        link.angleTag = "";
        changed = true;
      }
      if (link.priority == null) {
        link.priority = "supporting";
        changed = true;
      }
      if (link.referenceKind == null) {
        link.referenceKind = link.role === "turnaround-reference"
          ? "turnaround"
          : link.role === "detail-reference"
            ? "detail"
            : ["alternate-view", "character-reference", "prop-reference", "vehicle-reference", "location-reference"].includes(link.role)
              ? "single-angle"
              : "general";
        changed = true;
      }
      if (link.detailRegion == null) {
        link.detailRegion = "";
        changed = true;
      }
      if (link.availableAngles == null) {
        link.availableAngles = "";
        changed = true;
      }
    });
  });
  P.meta = P.meta || {};
  P.meta.styleBlocks = Array.isArray(P.meta.styleBlocks) ? P.meta.styleBlocks : [];
  P.meta.world = P.meta.world || { setting: "", include: "", reject: "" };
  if (P.meta.globalStylePrompt == null) {
    P.meta.globalStylePrompt = P.meta.styleBlocks.find((b) => b.id === "global-style")?.text || "";
    changed = true;
  }
  if (P.meta.globalNegativePrompt == null) {
    P.meta.globalNegativePrompt = P.meta.world.reject || "";
    changed = true;
  }
  if (P.meta.aspectRatio == null) {
    P.meta.aspectRatio = "";
    changed = true;
  }
  if (P.meta.globalStylePrompt && !P.meta.styleBlocks.some((b) => b.id === "global-style")) {
    P.meta.styleBlocks.unshift({ id: "global-style", name: "Global visual style", text: P.meta.globalStylePrompt, stage: "" });
    changed = true;
  }
  if (schemaVersionIsOlder(P.meta.hubVersion, HUB_SCHEMA_VERSION)) {
    P.meta.hubVersion = HUB_SCHEMA_VERSION;
    changed = true;
  }
  /* Baseline, not current: opening a project repairs it to the shape this file
     guarantees and stops there. The 6.7 marker belongs to the writers. */
  if (schemaVersionIsOlder(P.meta.schemaVersion, PROJECT_SCHEMA_BASELINE_VERSION)) {
    P.meta.schemaVersion = PROJECT_SCHEMA_BASELINE_VERSION;
    changed = true;
  }
  if (!P.meta.v5) {
    P.meta.v5 = { migratedAt: new Date().toISOString() };
    changed = true;
  }
  for (const item of P.audio || []) {
    if (item.cleanMaster == null) {
      item.cleanMaster = false;
      changed = true;
    }
    if (item.sameObjectAs == null) {
      item.sameObjectAs = "";
      changed = true;
    }
  }
  /* 1D-06: merge the unrecorded-derivation reports into the durable channel the
     coverage normaliser already owns, de-duplicated so reopening a project does
     not stack the same sentence. */
  if (lineageWarnings.length) {
    P.meta = P.meta || {};
    const existing = Array.isArray(P.meta.dataIntegrityWarnings) ? P.meta.dataIntegrityWarnings : [];
    P.meta.dataIntegrityWarnings = [...new Set([...existing, ...lineageWarnings])];
  }
  return changed;
}
function frameById(s, id) {
  return (s.keyframes || []).find((f) => f.id === id) || null;
}
function frameLabel(s, id) {
  const f = frameById(s, id);
  return f ? `Frame ${f.label}` : "No frame";
}
async function showFirstRunWorkspace(message = "") {
  /* PREPARE — this terminal's only asynchronous input. */
  const projectData = await fetch("/api/projects").then((r) => r.ok ? r.json() : ({ projects: [] })).catch(() => ({ projects: [] }));
  /* COMMIT — A REPLACEMENT TERMINAL, reachable only from an explicit open. It
     clears the record, so it is an open in every sense that matters and takes
     the epoch with it: deferred save work written against the project that was
     here dies rather than firing into an empty window. A refresh never arrives
     here — a refresh answered 404 discards instead — because entering first-run
     is a replacement and a refresh may not perform one. */
  beginProjectOpen();
  ACTIVE_PROJECT_SLUG = "";
  P = null;
  PROJECT_REVISION = "";
  SAVE_REVISION = 0;
  SAVED_REVISION = 0;
  SAVED_PROJECT_BASELINE = null;
  PROJECT_CONFLICT = false;
  SAVE_BLOCKED = false;
  AUTHORITY_SAVE_REFUSED = false;
  clearTimeout(saveTimer);
  saveTimer = null;
  const projectTitle = $("#project-title"), projectFormat = $("#project-format"), topbarProject = $("#topbar-project");
  if (projectTitle) {
    projectTitle.textContent = "Projects";
    projectTitle.setAttribute("aria-label", "Open the project menu");
  }
  if (projectFormat) projectFormat.textContent = "No project open";
  if (topbarProject) topbarProject.textContent = "CineBraid";
  /* The menu describes the open project. There is not one. */
  closeProjectMenu({ returnFocus: false });
  setSaveState("loading", "No project open");
  const existing = (projectData.projects || []).map((project) => `<button class="ghost-btn" onclick="switchProject('${attr(project.slug)}')">Open ${esc(project.title || project.slug)}</button>`).join("");
  $("#main").innerHTML = `<section class="first-run-state" role="status"><div class="first-run-mark">CB</div><div><span>WELCOME TO CINEBRAID</span><h1>Start with a project—or open the sample.</h1><p>CineBraid keeps approved references, continuity, shots, existing media and final deliveries together. AI and in-app generation are optional.</p>${message ? `<small>${esc(message)}</small>` : ""}<div class="first-run-actions"><button class="assemble-btn" onclick="newProject()">Create a project</button>${existing}</div><ol><li>Upload or map existing references.</li><li>Approve the production authorities.</li><li>Attach existing stills, video and audio to shots.</li><li>Mark each approved shot final.</li></ol></div></section>`;
}
/* A failed project load carries the server's structured description of the failure so the
   recovery screen can name the project and print the real file path instead of a guess. */
function projectLoadError(data) {
  const error = new Error(
    (data && data.error) || "CineBraid could not open the project.",
  );
  if (data && data.projectFailure) error.projectFailure = data.projectFailure;
  return error;
}
/* Nothing loaded, so nothing is saved. Put the chrome into an honest state and keep the
   project switcher labelled — it is the only way out of a failed load. */
function markProjectLoadFailure(failure) {
  const title = (failure && (failure.title || failure.slug)) || "";
  setSaveState("error", "Not loaded");
  const projectTitle = $("#project-title"),
    projectFormat = $("#project-format"),
    topbarProject = $("#topbar-project");
  if (projectTitle) {
    projectTitle.textContent = "Projects";
    projectTitle.setAttribute("aria-label", "Open the project menu");
  }
  if (projectFormat)
    projectFormat.textContent = title
      ? `Could not open ${title}`
      : "No project open";
  if (topbarProject) topbarProject.textContent = "CineBraid";
}
/* ===========================================================================
   RECOVERY MODE — THE PROTECTED FRONT DOOR TO THE RECOVERY MACHINERY.

   WHAT IT IS FOR. CineBraid refused to open a project because the stored
   document is not one it can safely trust. The filmmaker's work is in those
   bytes and nowhere else, so the only acceptable behaviours are: preserve them,
   say what is wrong, and offer the bounded set of operations that cannot make it
   worse. Opening into ordinary writable mode, discarding what could not be
   understood, repairing in place over the only copy, or showing a first-run
   screen as though the project never existed are all ways of losing it.

   WHICH FAILURES ENTER, AND WHY THAT LIST AND NOT ANOTHER. Quarantine is for
   PROJECT-INTEGRITY failures: the server read the stored bytes and could not turn
   them into a project it would serve. Those are the four 422 verdicts
   inspectProjectFile() produces, and they are the only conditions in which a
   document exists, holds the filmmaker's work, and must not be written.

   A MISSING or misnamed project (404) is deliberately NOT one of them: there are
   no bytes to protect, and the existing first-run screen with the project
   switcher beside it is the honest answer. Neither is a network failure, a 500,
   or any provider, account or setup problem — none of them is a verdict about
   the stored document, and routing them here would turn Recovery mode into the
   place CineBraid goes whenever anything at all goes wrong.

   HOW IT ENDS. Only a validated open. commitPreparedProject() is the one place
   the latch is cleared, and it clears it only after the server has served a
   document that passed its own open gate. Nothing here clears it because a
   screen changed, a route ran or a button was pressed.
   =========================================================================== */

/* The server's own reason codes for "the stored bytes are not a project I will
   serve" — exactly inspectProjectFile()'s 422 arms, with its two 404 arms absent
   on purpose. tests/recovery-quarantine.js drives the real server into every
   failure mode it has and asserts this classification for each, so the two sides
   cannot drift apart quietly. */
const PROJECT_QUARANTINE_REASONS = ["invalid-json", "invalid-shape", "invalid-structure", "unreadable"];
function projectFailureEntersQuarantine(failure) {
  return !!failure
    && PROJECT_QUARANTINE_REASONS.includes(String(failure.reason || ""))
    && !!String(failure.slug || "").trim();
}
/* ENTERING IS AN ACT, NOT A RENDER. The surface is the last thing this does; the
   first things are the ones that make the window safe. */
function enterProjectQuarantine(failure, message) {
  PROJECT_QUARANTINE = {
    slug: String(failure.slug || ""),
    title: String(failure.title || failure.slug || ""),
    path: String(failure.path || ""),
    reason: String(failure.reason || ""),
    detail: String(failure.detail || ""),
    issues: Array.isArray(failure.issues) ? failure.issues.slice() : [],
    revision: String(failure.revision || ""),
    size: Number.isFinite(failure.size) ? failure.size : null,
    modifiedAt: String(failure.modifiedAt || ""),
    message: String(message || failure.error || ""),
  };
  /* THE EXISTING WRITE-BLOCK, NOT A NEW ONE. blockSaving() is this product's one
     way to stop a view saving: it latches SAVE_BLOCKED, cancels the debounce and
     drops every deferred save-only callback armed before this moment — which is
     precisely the work that would otherwise fire half a second from now and write
     into the document being protected. */
  blockSaving();
  /* THE INDICATOR'S OWN PENDING WORK, WHICH THE SAVE LATCH DOES NOT REACH.
     An accepted save arms a timer that re-asserts "Saved" 1.6 seconds later. If
     the project is quarantined inside that window — a save lands, the file is
     replaced underneath it, the reopen refuses — the timer fires onto the
     Recovery screen and puts the word Saved above a project CineBraid has just
     said it could not open. That is the fake success state this mode exists to
     prevent, so the transition cancels it and states the truth in its place. */
  clearTimeout(SAVE_STATE_TIMER);
  setSaveState("error", "Not saved — this project is in Recovery mode");
  /* NO ORDINARY WRITABLE RECORD IS INSTALLED, because there is none to install:
     the document could not be read. Clearing these is what makes
     captureProjectSave() answer null and route() decline to render an ordinary
     workspace, so the protection does not rest on the latch alone. */
  P = null;
  ACTIVE_PROJECT_SLUG = "";
  PROJECT_REVISION = "";
  SAVED_PROJECT_BASELINE = null;
  SAVE_REVISION = 0;
  SAVED_REVISION = 0;
  if (document.body?.dataset) document.body.dataset.projectQuarantine = PROJECT_QUARANTINE.slug || "1";
  renderProjectQuarantineSurface();
}
function projectQuarantineDiagnostics() {
  const q = PROJECT_QUARANTINE;
  if (!q) return "";
  return JSON.stringify({
    project: { slug: q.slug, title: q.title },
    file: { path: q.path, size: q.size, modifiedAt: q.modifiedAt, revision: q.revision },
    refusal: { reason: q.reason, message: q.message, detail: q.detail, issues: q.issues },
  }, null, 2);
}
/* The note line every recovery action reports into, so an outcome lands where the
   filmmaker is looking rather than only in a toast that disappears. Reachable
   from settings.js, which owns the restore flow this surface reuses. */
function noteProjectRecoveryOutcome(message) {
  const note = document.getElementById("project-recovery-note");
  if (note) note.textContent = String(message || "");
}
/* SYNCHRONOUS, THEN PROGRESSIVELY COMPLETED. Everything needed to understand the
   refusal is in hand at the moment of the refusal and is written in one go; only
   the list of restorable backups needs the network, and it fills a slot that is
   already on screen. A surface that waited for that request would be blank for as
   long as it took, on the one screen that must never look like nothing happened. */
function renderProjectQuarantineSurface(note = "") {
  const main = document.getElementById("main");
  const q = PROJECT_QUARANTINE;
  if (!main || !q) return;
  const name = q.title || q.slug;
  const heading = name
    ? `CineBraid could not open “${esc(name)}”`
    : "CineBraid could not open this project";
  const stamp = [
    q.size != null ? `${q.size} bytes` : "",
    q.modifiedAt ? `last changed ${esc(q.modifiedAt)}` : "",
    q.revision ? `fingerprint ${esc(q.revision.replace(/"/g, "").slice(0, 12))}` : "",
  ].filter(Boolean).join(" · ");
  const where = q.path
    ? `<p class="project-failure-path">The project file is at <code>${esc(q.path)}</code>${stamp ? `<br><span>${stamp}</span>` : ""}</p>`
    : "";
  const issues = q.issues.length
    ? `<ul class="project-recovery-issues">${q.issues.slice(0, 8).map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>`
    : "";
  const detail = `<details class="project-failure-detail project-recovery-detail"><summary>Technical detail</summary><pre id="project-recovery-diagnostics">${esc(projectQuarantineDiagnostics())}</pre><div class="modal-actions"><button class="ghost-btn" onclick="copyProjectRecoveryDiagnostics()">Copy technical details</button></div></details>`;
  main.innerHTML = `<section class="empty-state project-failure-state project-recovery-state" role="alert" data-project-recovery="${attr(q.reason)}">`
    + `<span class="project-recovery-mark">RECOVERY MODE</span>`
    + `<h2>${heading}</h2>`
    + `<p>${esc(q.message || "The project file could not be read.")}</p>`
    + issues
    + `<p class="project-recovery-preserved"><b>The original project has not been modified.</b> CineBraid has not saved, repaired or deleted anything in it, and it will not until you choose one of the actions below.</p>`
    + where
    /* ONLY THE ACTIONS THAT ARE GENUINELY SUPPORTED FOR THIS FAILURE.
       `revision` is the hash of the stored bytes, so having one is the same fact
       as "CineBraid could read this file at all". Without it there is nothing to
       download and nothing a restore could name in its If-Match — offering either
       would be a button that answers with an error, which on this screen reads as
       a second failure rather than as an unavailable action. */
    + `<div class="modal-actions">`
    + `<button class="add-btn" onclick="retryQuarantinedProject()">Retry validation</button>`
    + (q.revision
      ? `<a class="ghost-btn" href="/api/projects/${encodeURIComponent(q.slug)}/project-file" download="${attr(q.slug)}-project.json">Download the original file</a>`
      : "")
    + `<button class="ghost-btn" onclick="openProjectSwitcher()">Open a different project</button>`
    + `</div>`
    + (q.revision
      ? `<p class="project-recovery-hint"><small>Downloading gives you a copy to keep or repair outside CineBraid. Restoring replaces the original with a backup, after preserving the current file first.</small></p>`
      : `<p class="project-recovery-hint"><small>CineBraid could not read this file at all, so it cannot copy it or replace it. Close anything else that has the project open, check the folder's permissions, then retry.</small></p>`)
    + `<div id="project-recovery-note" class="project-recovery-note" role="status">${esc(note)}</div>`
    + `<div id="project-recovery-backups" class="project-recovery-backups">Looking for backups…</div>`
    + detail
    + `</section>`;
  loadQuarantineBackups();
}
window.copyProjectRecoveryDiagnostics = () => {
  const text = projectQuarantineDiagnostics();
  if (!text) return;
  if (navigator?.clipboard?.writeText)
    navigator.clipboard.writeText(text).then(
      () => noteProjectRecoveryOutcome("Technical details copied."),
      () => noteProjectRecoveryOutcome("Could not copy — select the text below and copy it manually."),
    );
  else noteProjectRecoveryOutcome("Select the text below and copy it manually.");
};
/* THE EXISTING BACKUP LIST, ASKED FOR BY THE PROJECT THAT CANNOT BE OPENED.
   GET /api/projects/:slug/backups reads a directory and never parses the project,
   so it answers for a quarantined document exactly as it does for a healthy one.
   Nothing here is a second backup store. */
async function loadQuarantineBackups() {
  const slot = document.getElementById("project-recovery-backups");
  const q = PROJECT_QUARANTINE;
  if (!slot || !q || !q.slug) return;
  let backups = null;
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(q.slug)}/backups`, { cache: "no-store" });
    if (response.ok) backups = (await response.json()).backups || [];
  } catch { backups = null; }
  /* The window may have left Recovery mode, or entered it for another project,
     while this was on the wire. Either way this answer is about a screen that is
     no longer there. */
  if (!PROJECT_QUARANTINE || PROJECT_QUARANTINE.slug !== q.slug) return;
  if (backups === null)
    return void (slot.innerHTML = `<p><small>CineBraid could not read this project's backup folder.</small></p>`);
  if (!backups.length)
    return void (slot.innerHTML = `<p><small>No CineBraid backups were found for this project. Downloading the original file is the way to keep a copy.</small></p>`);
  /* A restore must name the exact document it replaces. Without a revision the
     server would refuse it, so the backups are listed as information — they exist,
     and they are where they always were — with no control that cannot work. */
  const restorable = !!q.revision;
  slot.innerHTML = `<h3>${restorable ? "Restore a backup" : "Backups found for this project"}</h3>`
    + `<p><small>${restorable
      ? "CineBraid preserves the current file before restoring, so this is reversible."
      : "CineBraid cannot restore into a file it could not read. These backups are untouched and are in the project's backups folder."}</small></p>`
    + `<div class="project-recovery-backup-list">${backups.slice(0, 10).map((backup) => `<article class="project-recovery-backup-row"><div><b>${esc(backup.name)}</b><small>${esc(backup.modifiedAt || "")}${backup.size != null ? ` · ${backup.size} bytes` : ""}</small></div>${restorable ? `<button class="approve-btn" onclick="restoreProjectBackup('${attr(backup.name)}')">Restore</button>` : ""}</article>`).join("")}</div>`;
}
/* RE-ASK THE SERVER. There is nothing to re-check locally: the verdict belongs to
   the stored bytes, so a retry is an ORDINARY OPEN and it is the same open every
   other caller performs. A repaired file therefore leaves Recovery mode through
   the ordinary gate rather than through anything this screen knows. */
window.retryQuarantinedProject = async () => {
  if (!PROJECT_QUARANTINE) return;
  noteProjectRecoveryOutcome("Re-checking the project…");
  try {
    const outcome = await load();
    if (outcome && outcome.committed) {
      if (typeof toast === "function") toast("Project opened");
      return;
    }
    renderProjectQuarantineSurface(
      ("The project still cannot be opened safely. " + ((outcome && outcome.reason) || "")).trim(),
    );
  } catch (error) {
    /* The same two statements bootstrap.js runs, so a retry that fails is
       indistinguishable from the failure that started this. */
    if (error?.projectFailure) {
      markProjectLoadFailure(error.projectFailure);
      renderProjectFailureScreen(error.projectFailure, error.message);
      noteProjectRecoveryOutcome("The project still cannot be opened safely.");
      return;
    }
    noteProjectRecoveryOutcome(error?.message || "CineBraid could not re-check this project.");
  }
};
/* The plain refusal screen, for a failure that is NOT a project-integrity verdict
   and therefore has no protected mode to enter. Unchanged, and still the ending
   for a refused switch that has a readable project to fall back to. */
function renderProjectFailureScreen(failure, message) {
  if (projectFailureEntersQuarantine(failure)) return enterProjectQuarantine(failure, message);
  const main = document.getElementById("main");
  if (!main) return;
  const name = (failure && (failure.title || failure.slug)) || "";
  const heading = name
    ? `CineBraid could not open “${esc(name)}”`
    : "CineBraid could not open this project";
  const where = failure && failure.path
    ? `<p class="project-failure-path">The project file is at <code>${esc(failure.path)}</code></p>`
    : "";
  const detail = failure && failure.detail
    ? `<details class="project-failure-detail"><summary>Technical detail</summary><pre>${esc(failure.detail)}</pre></details>`
    : "";
  main.innerHTML = `<section class="empty-state project-failure-state" role="alert"><h2>${heading}</h2><p>${esc(message || (failure && failure.error) || "The project file could not be read.")}</p>${where}<p><small>Your project data has not been deleted or changed. Open another project to keep working, or repair this file and reload.</small></p><div class="modal-actions"><button class="add-btn" onclick="openProjectSwitcher()">Open a different project</button><button class="ghost-btn" onclick="location.reload()">Reload</button></div>${detail}</section>`;
}
/* ===========================================================================
   THE PROJECT LOAD TRANSACTION — PREPARE → VALIDATE → COMMIT.

   TWO DIFFERENT ACTS USED TO SHARE ONE FUNCTION AND ONE SET OF ENDINGS.

     A REPLACEMENT installs another record: boot, the switcher, a rollback, a
     restore, an archive, a delete, an import, and a deliberate reopen of the
     same project. Only a replacement may clear the workspace, enter first-run,
     install another project identity or advance the project-open epoch.

     A REFRESH re-reads the record that is already open, because the SERVER
     committed something into it that the browser did not make — a finished
     generation. A refresh has exactly two endings: COMMIT what it read, or
     DISCARD it. It never installs another identity, never clears the workspace,
     never enters first-run and never advances the epoch.

   THE REQUESTED INTENT IS FIXED AT ENTRY AND CANNOT CHANGE. It is a parameter,
   never a derivation. A refresh does not become a replacement because `P` went
   null, because the slug emptied, because another load happened, because the
   response named a different project, because the server answered 404, or
   because any other runtime state moved. Every one of those is a reason to
   DISCARD. The two intents are two lifecycles below, and the statements that
   perform a replacement exist in only one of them.

   THE THREE PHASES:

     PREPARE   every asynchronous input, gathered before anything authoritative
               is touched — the project document, the media scan, the prompt
               library, the config, agent status, automation runs AND the
               generation ledger, which used to be read AFTER the record had
               already been installed. PREPARE mutates nothing a save depends on,
               so there is no state in which the window has taken delivery of
               half a project and is waiting on the other half.

     VALIDATE  one synchronous decision, taken against the live state of the
               window immediately before the commit, WITH NO AWAIT BETWEEN THEM.

     COMMIT    one synchronous, await-free mutation section. Everything it
               installs is already in hand.

   WHAT ORDERS TWO REFRESHES IS NEITHER THE EPOCH NOR A REVISION STRING.
   `PROJECT_OPEN_EPOCH` answers "which explicit open is this window", and an
   ordinary refresh is not a new open — advancing it there would make the refresh
   behind the one that just committed look like work from a previous open.
   Refreshes are ordered against each other by `PROJECT_REFRESH_SEQUENCE`, taken
   when the request STARTS, against `PROJECT_REFRESH_COMMITTED`, which moves only
   when a refresh actually COMMITS. So a later request merely being started
   disqualifies nothing: a response that is still the newest thing anyone
   installed may commit, however many requests were begun behind it. Revision
   tokens are opaque server strings and are never compared for order.
   =========================================================================== */

/* The requested intent, frozen here and read nowhere else. Anything that is not
   the explicit refresh request is a replacement, which is the safe direction: a
   caller that forgets to say gets the act that persists before it replaces. */
function requestedProjectIntent(options) {
  return options && options.intent === "refresh" ? "refresh" : "open";
}
async function load(options = {}) {
  /* Session-scoped derived display state belongs to the record it describes, so
     it is discarded by the replacement commit — see beginProjectOpen(), which
     calls resetContinuityWorkspaceState(). It is deliberately NOT discarded by a
     refresh: a same-project re-read is the same open reading a newer copy of its
     own record, and purging there would delete the verdicts describing the very
     work that just completed. */
  return requestedProjectIntent(options) === "refresh"
    ? runProjectRefresh()
    : runProjectReplacement();
}

/* ---------------------------------------------------------------------------
   PREPARE. */

/* EVERY ASYNCHRONOUS INPUT, GATHERED BEFORE ANYTHING AUTHORITATIVE MOVES.
   Nothing here writes `P`, the active slug, the project revision, the save
   counters, the saved baseline, the save latches, the save indicator, the
   continuity workspace, the project-open epoch or the refresh watermark. The
   return value is a candidate snapshot and nothing else. */
async function prepareProjectSnapshot({ claimRecovery = false } = {}) {
  const projectResponse = await fetch("/api/project", { cache: "no-store" });
  if (projectResponse.status === 404) {
    const data = await projectResponse.json().catch(() => ({}));
    return { available: false, message: data.error || "No project is available yet." };
  }
  if (!projectResponse.ok) {
    const data = await projectResponse.json().catch(() => ({}));
    throw projectLoadError(data);
  }
  const prepared = {
    available: true,
    /* The server's own answer about which project this document is, and the
       revision of the exact document the view would be built from. Both are read
       here and INSTALLED NOWHERE until the commit, so there is no window in
       which the identity has moved and the record has not. */
    slug: projectResponse.headers?.get?.("x-cinebraid-project-slug") || "",
    revision:
      projectResponse.headers?.get?.("x-cinebraid-project-revision") ||
      projectResponse.headers?.get?.("etag") ||
      "",
    falJobs: [],
    falLedgerLoaded: false,
    backgroundRecovery: null,
  };
  const loaded = await Promise.all([
    projectResponse.json(),
    fetch("/api/scan").then((r) => r.json()),
    fetch("/api/prompt/profiles")
      .then((r) => r.json())
      .catch(() => ({ profiles: [] })),
    fetch("/api/config")
      .then((r) => r.json())
      .catch(() => ({})),
    fetch("/api/agents/status")
      .then((r) => r.json())
      .catch(() => ({ enabled: false, runs: [], agents: [], index: {} })),
    fetch("/api/automation/runs")
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .catch(() => ({ runs: [] })),
  ]);
  prepared.project = loaded[0];
  prepared.scan = loaded[1];
  prepared.promptLibrary = loaded[2] || { profiles: [] };
  prepared.config = loaded[3] || {};
  prepared.agentStatus = loaded[4] || { enabled: false, runs: [], agents: [], index: {} };
  prepared.automationRuns = loaded[5]?.runs || [];
  await prepareGenerationLedger(prepared, { claimRecovery });
  return prepared;
}

/* THE GENERATION LEDGER IS AN INPUT, NOT AN AFTERWARDS.

   It used to be read AFTER the project had been installed and BEFORE the saved
   baseline and the indicator were settled, which put a whole network round-trip
   inside the commit. An edit made in that window could be refused by the server
   — a typed 422, saving paused, "Not saved" on screen — and then the ledger
   would land, the rest of the old load() would run, and it would overwrite that
   refusal with `SAVED_PROJECT_BASELINE = P` and a resting "Saved". The window is
   gone because the read happens here, where there is nothing yet to overwrite.

   It reads `prepared.config`, so it is a second await rather than a seventh
   entry in the Promise.all above. It is still entirely inside PREPARE. */
async function prepareGenerationLedger(prepared, { claimRecovery = false } = {}) {
  const falConfig = prepared.config.generation?.fal || {};
  if (!(falConfig.enabled && falConfig.keySource !== "none")) return prepared;
  /* What the server collected through its own background recovery rather than
     through a refresh from here — which is all the server can know, and all it
     says. The header marks THIS request as the one that takes delivery of the
     notice; the activity poll reads the same route and deliberately leaves it
     where it is. The URL is unchanged on purpose: it is matched exactly by route
     stubs and paid-call guards that have nothing to do with this.

     ONLY A REPLACEMENT CLAIMS IT. The notice explains work that is already in the
     record being installed, and an open is the moment to say so. A refresh cannot
     honestly take delivery: its snapshot may have been read BEFORE the sweep that
     produced the notice, so announcing it would attach the sentence to a record
     that does not contain the results. It reads the ledger plainly and leaves the
     notice for the next open. Nothing about FRESHNESS depends on this either way
     — that is watchProjectRevision()'s job, and it asks the server rather than
     waiting to be told. */
  await fetch("/api/generation/fal/jobs", claimRecovery ? { headers: { "x-cinebraid-claim-recovery": "1" } } : {})
    .then((r) => (r.ok ? r.json() : { jobs: [] }))
    .then((data) => {
      /* Loaded means the request was made AND answered. A refused or failed
         fetch leaves the flag false, so a surface reading provenance says the
         record is unavailable instead of claiming the project has no generation
         history. */
      prepared.falLedgerLoaded = Array.isArray(data.jobs);
      /* Announced only by the load that actually took delivery of it. A refresh
         leaves the notice where it is, so it must not announce it either — it
         would repeat the same sentence on every completion until some later open
         finally claimed it. */
      prepared.backgroundRecovery = claimRecovery ? (data.backgroundRecovery || null) : null;
      /* Admitted on the payload's own stated owner, exactly as the 3.5-second
         poll admits it — and against THE OWNER OF THE SNAPSHOT BEING PREPARED
         rather than whatever is installed at this instant. During a replacement
         the live slug is still the OUTGOING project, so asking the live global
         here would refuse the incoming project's own ledger. Refused rows leave
         the ledger EMPTY and unloaded rather than foreign. */
      const admitted = typeof v670AdmitActivityRows === "function"
        ? v670AdmitActivityRows(data, "jobs", prepared.slug)
        : { rows: data.jobs || [] };
      if (!admitted.rows) prepared.falLedgerLoaded = false;
      prepared.falJobs = admitted.rows || [];
    })
    .catch(() => {
      prepared.falJobs = [];
      prepared.falLedgerLoaded = false;
    });
  return prepared;
}

/* ---------------------------------------------------------------------------
   VALIDATE. */

/* THE ONE PLACE A DURABLE PROJECT WRITE THIS WINDOW DID NOT MAKE IS DECLARED.

   `PROJECT_SAVE_GENERATION` means: THE DURABLE PROJECT TRUTH THIS WINDOW OWNS HAS
   ADVANCED INDEPENDENTLY OF A REFRESH COMMIT. Two of those advances are declared
   inline because they already run inside this file's own save chain — an accepted
   write, and a rebase that re-points the saved baseline. The rest are not this
   window's writes at all: a generation completion asks the SERVER to ingest, and
   the server commits results into the open project's document without the browser
   sending a single byte of it. A snapshot prepared before that ingest is behind
   the record exactly as it would be behind an accepted save, and it has to be
   recognised the same way — otherwise a refresh that was prepared before the
   ingest, and whose follow-up refresh then failed, reinstalls the pre-ingest
   document over the newer one and rests on "Saved".

   ORDER IS THE CALLER'S RESPONSIBILITY, and it is the whole mechanism. Call this
   only once the mutation has DEFINITELY succeeded, and BEFORE the follow-up
   refresh starts. The follow-up then captures the new generation and commits
   normally, while every snapshot prepared before the ingest is stale — including
   when the follow-up itself fails.

   OWNERSHIP. `owner` is the slug the mutation was issued FOR, captured before the
   request went out. A completion for a project this window has since left changed
   nothing about the project it is looking at now and must not perturb its
   freshness. The open EPOCH is deliberately NOT compared as well: a mutation that
   lands after the same project has been reopened really did advance that project's
   durable truth, so counting it is right — and the worst it can do in the reopened
   window is discard a snapshot that was already fresh, which fails toward reading
   again rather than toward a silent rollback.

   IT DOES NOTHING ELSE. No indicator, no baseline, no revision, no counters, no
   record. One integer, on one condition. */
function noteCurrentProjectDurableAdvance(owner) {
  const slug = String(owner || "");
  if (!slug || !ACTIVE_PROJECT_SLUG || slug !== ACTIVE_PROJECT_SLUG) return false;
  PROJECT_SAVE_GENERATION += 1;
  return true;
}
/* ONE RESULT HANDLER FOR A ROUTE THAT SAYS WHETHER IT WROTE THE PROJECT.

   Three generation routes touch project.json only CONDITIONALLY — a cancel, a
   failed submission, a failed collection all write an entity's coverage-automation
   status, and only when the job is an entity-reference job whose entity has
   coverage automation configured. The browser cannot see that condition, so it
   must not infer it from a 2xx: guessing YES discards a perfectly good prepared
   refresh on every cancel, and guessing NO lets a prepared snapshot reinstall the
   pre-cancel coverage status. The routes answer `projectUpdated` and this is the
   one place that reads it, so both shipped cancel callers behave identically.

   THE REFRESH IS PART OF THE ANSWER. If the project really did move, this window
   is behind it; declaring that and then not going to look would leave the record
   on screen knowingly stale. */
async function applyProjectMutationResult(owner, data) {
  if (!data || data.projectUpdated !== true) return false;
  if (!noteCurrentProjectDurableAdvance(owner)) return false;
  await load({ intent: "refresh" });
  return true;
}

/* THE UNIVERSAL FRESHNESS CHECK: IS THIS WINDOW STILL CURRENT?

   This replaces a watch that listened for the ingest reaper specifically, and it
   is here because that shape could not work. The reaper is one of many things
   that write project.json — another window, an automation run, a restore, a
   cancel, a writer nobody has thought of yet — and a browser taught about each of
   them in turn is a list that only ever grows. The one it has not been taught
   about is the one that leaves it resting on "Saved" over a record the server has
   moved past. Worse, the reaper watch depended on THIS window having seen the job
   the sweep collected, so a generation started in another window was invisible to
   it by construction.

   THE SERVER'S CURRENT REVISION ANSWERS ALL OF THEM AT ONCE. It is a hash of the
   stored bytes: whatever changed the file changed the revision, and no knowledge
   of who wrote or why is needed to compare it. GET /api/projects/:slug/revision
   reads the bytes and hashes them — no parse, no activity, no write.

   EXACT EQUALITY, NEVER ORDER. Two revisions are the same document or they are
   not. Nothing here asks which is newer, because a content hash cannot say.

   WHAT IT DEPENDS ON, AND WHAT IT DELIBERATELY DOES NOT. A project open and a
   revision this window can name — nothing else. Not the generation ledger, not
   the activity drawer, not whether this window submitted anything. That is the
   whole point: it has to see a change made by a window it has never heard of.

   THIS WINDOW'S OWN SAVE IS NOT A FOREIGN CHANGE. An accepted write moves the
   stored revision AND this one, together. The chain is allowed to settle first,
   and the answer is then only acted on if this window's revision is still the one
   it asked about — so a save that lands mid-flight aborts the comparison instead
   of racing it, and the next tick simply agrees. */
let PROJECT_REVISION_WATCH = null;
window.watchProjectRevision = async () => {
  /* One in flight at a time; the interval is not a queue. */
  if (PROJECT_REVISION_WATCH) return PROJECT_REVISION_WATCH;
  /* A CHANGED REVISION IS NOT A REASON TO LEAVE RECOVERY MODE. This watch exists
     to notice that the stored document moved and to go and get it — which is the
     right instinct for a window holding a project and exactly the wrong one for a
     window protecting a document it refused to open. The bytes moving says nothing
     about whether they parse now; only an open can answer that, and only the
     filmmaker asks for one. The activity timer runs this every few seconds
     regardless of what is on screen, so the refusal is stated here rather than
     inferred from `P` being null a line later. */
  if (PROJECT_QUARANTINE) return null;
  if (!P || !ACTIVE_PROJECT_SLUG || !PROJECT_REVISION) return null;
  PROJECT_REVISION_WATCH = (async () => {
    try {
      /* Let this window's own save settle before asking, so its own accepted
         write is never read back as somebody else's change. */
      await SAVE_CHAIN.catch(() => {});
      if (!P || !ACTIVE_PROJECT_SLUG || !PROJECT_REVISION) return null;
      const owner = { slug: ACTIVE_PROJECT_SLUG, epoch: PROJECT_OPEN_EPOCH, revision: PROJECT_REVISION };
      const response = await fetch(`/api/projects/${encodeURIComponent(owner.slug)}/revision`, { cache: "no-store" });
      /* A REVISION THAT COULD NOT BE READ IS NOT A CHANGE. A network failure, a
         500, a 404 from a machine mid-restore: none of them is evidence that this
         window is stale, and inventing a conflict out of one would be the same
         untruth in the other direction. Say nothing and ask again next tick. */
      if (!response.ok) return null;
      const data = await response.json().catch(() => ({}));
      const serverRevision = String(data?.revision || "");
      if (!serverRevision) return null;
      /* BOUND TO THE OPEN THAT ASKED. A switch, a reopen or a save landing while
         this was on the wire makes the answer about a window that no longer
         exists; it must not be applied to the one that does. */
      if (owner.epoch !== PROJECT_OPEN_EPOCH || owner.slug !== ACTIVE_PROJECT_SLUG) return null;
      if (owner.revision !== PROJECT_REVISION) return null;
      if (serverRevision === PROJECT_REVISION) return null;
      return applyForeignProjectRevision(owner);
    } catch { return null; }
    finally { PROJECT_REVISION_WATCH = null; }
  })();
  return PROJECT_REVISION_WATCH;
};
/* WHAT A MISMATCH MEANS, AND THE THREE THINGS IT CAN MEAN.

   In every case the durable advance is declared first, through the same helper
   every other writer uses: that is what makes an already-prepared refresh stale,
   generically, without this path knowing anything about the refreshes in flight.
   What differs afterwards is only what this window is entitled to say. */
async function applyForeignProjectRevision(owner) {
  if (!noteCurrentProjectDurableAdvance(owner.slug)) return null;
  /* ALREADY NOT SAVING. A paused, refused or conflicted window is already telling
     the truest thing about itself, and a second surface on top of it would only
     bury the first. */
  if (SAVE_BLOCKED || AUTHORITY_SAVE_REFUSED || PROJECT_CONFLICT) return "already-refusing";
  /* AUTHORED WORK IS NEVER OVERWRITTEN. The stored document has moved under an
     edit this window still holds, so the save behind that edit is now genuinely
     stale — which is exactly what the accepted conflict surface says, and it says
     it before a doomed write goes out rather than after. `P` is untouched; the
     edit stays in this tab for the filmmaker to decide about. */
  if (projectHasUnsavedEdits()) {
    projectConflict({ error: "This project changed while this view was open. Reload to continue from the current project." });
    return "conflict";
  }
  /* CLEAN, so the honest thing is to go and get it. */
  setSaveState("loading", "Project changed — updating…");
  const outcome = await load({ intent: "refresh" }).catch(() => null);
  /* A committed refresh settles the indicator itself, and only then is Saved true
     again. Anything else leaves a window that is known to be behind the record,
     saying so and naming what would fix it. */
  if (!outcome || !outcome.committed) {
    setSaveState("error", "Project changed — refresh required");
    return "refresh-failed";
  }
  return "refreshed";
}
/* Authored work this window holds and storage does not. `SAVE_REVISION` counts
   local edits and `SAVED_REVISION` counts the ones a response has confirmed, so
   this is true from the moment of the edit until the write that carries it is
   accepted — debounce, in-flight and refused alike. */
function projectHasUnsavedEdits() {
  return !!P && SAVE_REVISION > SAVED_REVISION;
}
/* THE SINGLE FINAL AUTHORITY CHECK FOR A REFRESH.

   Synchronous, and the lifecycle below calls it with NO await between this
   answer and the commit that acts on it. Every failure returns a reason and the
   prepared snapshot is discarded whole — a refresh never merges, never installs
   part of what it read, and never escalates into a replacement. */
function projectRefreshRefusal(ticket, prepared) {
  if (!prepared || !prepared.available)
    return "the server no longer has this project to read";
  if (!P || !ACTIVE_PROJECT_SLUG)
    return "no project is open for a refresh to refresh";
  if (ticket.epoch !== PROJECT_OPEN_EPOCH)
    return "the project was explicitly replaced while this refresh was in flight";
  if (ticket.slug !== ACTIVE_PROJECT_SLUG)
    return "the project this refresh was started for is no longer the one open";
  if (!prepared.slug || prepared.slug !== ACTIVE_PROJECT_SLUG)
    return "the response describes a different project than the one open";
  if (ticket.sequence <= PROJECT_REFRESH_COMMITTED)
    return "a newer refresh of this open has already installed its snapshot";
  /* THE PREPARED SNAPSHOT MUST STILL BE FRESH.

     A refresh is several awaits long, and a save can be authored, dispatched and
     ACCEPTED inside it. When it is, the window and storage move on together to a
     revision the prepared snapshot predates — and the window is CLEAN again, so
     the unsaved-work rule below has nothing to catch. Committing there rolls the
     record back to a document the server no longer holds, silently, with the
     indicator resting on Saved and nothing left in flight to correct it.

     Equality only. The revisions cannot be ordered: they are opaque server tokens
     and the client has no way to tell which of two came first. */
  if (ticket.saveGeneration !== PROJECT_SAVE_GENERATION)
    return "this window saved to storage while this refresh was in flight, so the snapshot it read at "
      + (ticket.revision || "an unidentified revision") + " is behind the record";
  /* DIRTY AUTHORED WORK OUTRANKS REFRESH INSTALLATION, ALWAYS. Both shipped
     completion paths persist before they ask the server to ingest, so this is a
     backstop for an edit typed INSIDE the round-trip. It leaves the edit in the
     tab and unsaved rather than replacing it with the server's copy. */
  if (projectHasUnsavedEdits())
    return "this view holds unsaved authored work a refresh would overwrite";
  /* A refresh commit says "the record on screen is the record on disk" and rests
     the indicator on Saved. A window that has stopped saving has not reconciled
     anything, so that sentence would be false and the refusal on screen would be
     erased by a background re-read nobody asked for. */
  if (SAVE_BLOCKED || AUTHORITY_SAVE_REFUSED || PROJECT_CONFLICT)
    return "this view is not saving, and a refresh commit would erase that";
  return "";
}

/* ---------------------------------------------------------------------------
   COMMIT. */

/* A NEW OPEN. The only place the project-open epoch moves, and the only place
   the session-scoped continuity workspace is discarded — both are replacement
   acts. Refresh ordering is per-open, so the watermark starts again here; a
   refresh left over from the previous open is refused by the epoch check long
   before the watermark is consulted. */
function beginProjectOpen() {
  PROJECT_OPEN_EPOCH += 1;
  PROJECT_REFRESH_COMMITTED = 0;
  /* The record on screen is being replaced, so derived display state computed
     against it goes with it. The continuity map is additionally keyed by
     project, so a leak is structurally impossible either way; this also covers
     reopening the SAME project, where the slug never changes but the record
     does. */
  if (typeof resetContinuityWorkspaceState === "function") resetContinuityWorkspaceState();
  /* AT1-G. A refusal describes a change CineBraid declined to make to the record
     being replaced, so it goes with the record — including on a reopen of the
     same project, which the scoped key alone would let through. */
  if (typeof resetActionRefusals === "function") resetActionRefusals();
  return { intent: "open", epoch: PROJECT_OPEN_EPOCH, sequence: 0, slug: "" };
}
/* A refresh's ticket, taken when the request STARTS. The sequence orders it
   against the other refreshes of this open; the epoch and slug record which open
   it was started under, so a response that outlived that open can be recognised
   however many times the same project has been opened since. */
function beginProjectRefresh() {
  PROJECT_REFRESH_SEQUENCE += 1;
  return {
    intent: "refresh",
    epoch: PROJECT_OPEN_EPOCH,
    sequence: PROJECT_REFRESH_SEQUENCE,
    slug: ACTIVE_PROJECT_SLUG,
    /* The record this refresh is reading AGAINST. Captured here so that a write
       this window lands while the snapshot is still in flight can be recognised
       at the commit point — the revision is carried alongside it for the reason
       it can be reported in, and is never compared for order. */
    saveGeneration: PROJECT_SAVE_GENERATION,
    revision: PROJECT_REVISION,
  };
}
/* ONE SYNCHRONOUS, AWAIT-FREE MUTATION SECTION.

   There is no `await` in this function and none in anything it calls. Every
   value it installs was gathered during PREPARE and validated a statement ago,
   so the window moves from one whole project to another whole project with no
   observable state in between. */
/* THE ORDINARY PROJECT-OPEN SAFETY GATE, STATED AS ONE SYNCHRONOUS ANSWER.

   The server already refuses to serve a document that does not pass
   inspectProjectFile(), so a 200 with a document IS the validation — there is no
   second opinion this window could form that would be worth more. What is left
   for this side is the part the server cannot answer: whether a WRITABLE CONTEXT
   can actually be established from what arrived.

   A record with no slug cannot be addressed, and a record with no revision cannot
   be written at all — queueProjectSave() refuses a save with no revision, so a
   window opened without one is a window that silently cannot save. Neither is
   "normal mode", and leaving Recovery mode for either would be the same untruth
   the mode exists to prevent. */
function projectReplacementRefusal(prepared) {
  if (!prepared || prepared.available !== true)
    return "the server did not serve a project document";
  if (!prepared.project || typeof prepared.project !== "object" || Array.isArray(prepared.project))
    return "the server's answer did not contain a project";
  if (!prepared.slug)
    return "the server did not name the project this document belongs to";
  if (!prepared.revision)
    return "the server did not identify the revision of the document it served, so this view could not save";
  return "";
}
function commitPreparedProject(prepared, ticket) {
  /* LEAVING RECOVERY MODE IS THE COMMIT, AND ONLY THE COMMIT.

     This is the single place PROJECT_QUARANTINE is cleared, and the statement
     below is what earns it: the server served this document through its own open
     gate, and it arrived with the identity and revision a writable window needs.
     A quarantined window that reaches here without those keeps the latch and
     installs nothing — so no route, no hash change, no re-render and no button
     can put an unsafe project into a writable workspace by clearing a flag. */
  if (PROJECT_QUARANTINE && projectReplacementRefusal(prepared)) return false;
  /* A DEBOUNCE ARMED AGAINST THE RECORD BEING REPLACED IS CANCELLED, and this is
     deliberate rather than an omission.

     Dispatching it instead would be worse, not better. queueProjectSave() sends
     the LIVE `PROJECT_REVISION` whenever the job's slug matches the open project
     — correct for an ordinary queued save, because the revision only ever moves
     forward — so a save dispatched here would leave with the OUTGOING document
     authorised by the INCOMING record's revision, be accepted, and overwrite the
     record this commit just read. Cancelling leaves the edit in the tab; that is
     the behaviour every replacement has always had, and every shipped
     replacement caller — the switcher, archive, delete, rollback — flushes
     before it opens, so nothing reaches here with a timer armed.

     A REFRESH NEVER REACHES THIS LINE WITH ONE ARMED AT ALL: an armed timer
     means unsaved authored work, and VALIDATE refuses a dirty view outright. */
  clearTimeout(saveTimer);
  saveTimer = null;
  P = prepared.project;
  ACTIVE_PROJECT_SLUG = prepared.slug || ACTIVE_PROJECT_SLUG || "fixture";
  /* The revision of the exact document this view is being built from. Every save
     echoes it, so a save from a view that has fallen behind is refused rather
     than silently overwriting the newer project. */
  PROJECT_REVISION = prepared.revision;
  SCAN = prepared.scan;
  PROMPT_LIBRARY = prepared.promptLibrary;
  CONFIG = prepared.config;
  AGENT_STATUS = prepared.agentStatus;
  AUTOMATION_RUNS = prepared.automationRuns;
  FAL_GENERATION_JOBS = prepared.falJobs;
  FAL_GENERATION_LEDGER_LOADED = prepared.falLedgerLoaded;
  SAVE_REVISION = 0;
  SAVED_REVISION = 0;
  PROJECT_CONFLICT = false; // a fresh record is in step with storage again
  SAVE_BLOCKED = false; // and it carries the revision every save needs
  AUTHORITY_SAVE_REFUSED = false;
  /* Recovery mode ends here and nowhere else, on the far side of the gate at the
     top of this function — so the latch is dropped by the act of installing a
     validated record, not by anything that merely wanted it dropped. */
  PROJECT_QUARANTINE = null;
  if (document.body?.dataset) delete document.body.dataset.projectQuarantine;
  /* Session-scoped activity state follows the project the same way the
     continuity map does. It drops rows only when the slug genuinely changes,
     which is why a same-project refresh — where the slug is unchanged — keeps
     the live rows describing the work that just completed. */
  if (typeof v670ScopeActivityToProject === "function") v670ScopeActivityToProject(ACTIVE_PROJECT_SLUG);
  applyProjectRecordDefaults();
  /* Read the stored markers before normalization rewrites them. Loading must
     never persist on its own: the defaults applied above are display-only and
     stay in memory until the user makes a real edit. Only a record whose stored
     schema is genuinely older is written back, so opening an already-current
     project leaves the file byte-identical. */
  const schemaWasOlder = storedSchemaIsOlder(P.meta);
  const migratedV5 = normalizeProjectV5();
  SAVED_PROJECT_BASELINE = structuredClone(P);
  /* This refresh becomes the one later arrivals are ordered against. A
     replacement does not touch the watermark; beginProjectOpen() reset it. */
  if (ticket.intent === "refresh") PROJECT_REFRESH_COMMITTED = ticket.sequence;
  /* The project on screen is the project on disk, so the resting indicator is
     honest again. Nothing after this point may say otherwise. */
  setSaveState("saved", "Saved");
  /* THE BROWSER'S ONLY AUTONOMOUS SAVE TRIGGER, scheduled by the commit that
     decided a write is owed rather than by the decoration that follows it.
     scheduleSaveTrigger() binds it to this open, so it cannot fire into the
     next one. */
  if (schemaWasOlder && migratedV5) scheduleSaveTrigger(() => dirty(), 50);
  return true;
}
/* The display-only defaults every open applies in memory. Extracted so the
   commit above stays one readable list of authoritative writes. */
function applyProjectRecordDefaults() {
  P.meta.styleBlocks = P.meta.styleBlocks || [];
  P.meta.iterBudget = P.meta.iterBudget || { A: 12, B: 3 };
  P.meta.world = P.meta.world || { setting: "", include: "", reject: "" };
  P.meta.refSyntax = P.meta.refSyntax || "@imageN";
  P.meta.models = P.meta.models || [];
  P.audio = P.audio || [];
  P.decisions = P.decisions || [];
  P.jobs = P.jobs || [];
  P.agentRuns = P.agentRuns || [];
  P.meta.aiPolicy = P.meta.aiPolicy || "project-default";
  if (!P.meta.workflowEmphasis) P.meta.workflowEmphasis = "manual";
  P.meta.defaults = P.meta.defaults || { stillModel: "", videoModel: "" };
  P.meta.promptDefaults = P.meta.promptDefaults || {
    imageProfile: "gpt-image-2/t2i",
    /* Kept in step with the new-project default in server.js: a video default
       this build cannot dispatch is a dead end handed to every shot in the
       project. */
    videoProfile: "minimax-h3/i2v",
  };
  (P.shots || []).forEach((s) => {
    s.promptBuilds = s.promptBuilds || [];
  });
}

/* ---------------------------------------------------------------------------
   POST-COMMIT. */

/* POST-COMMIT DECORATION — ONE DEDICATED FUNCTION, AND NO CALLBACK WRAPPER.

   AN EARLIER VERSION OF THIS GUARDED POST-COMMIT WORK WITH A DEPTH COUNTER that
   every save-truth writer consulted. That was a false guarantee and it is gone. A
   counter raised around a synchronous call is not an asynchronous barrier: it
   falls the instant that call returns, so anything resuming after an await was
   never inside it — and holding it across awaits would have suppressed the
   filmmaker's own later edits, which is a worse failure than the one it claimed
   to prevent. A generic `afterCommit(run)` wrapper is also exactly the affordance
   that lets the next caller hand save-truth work to the transaction's tail.

   WHAT REPLACES IT IS STRUCTURE. This is the whole of the tail. It takes the
   prepared snapshot as DATA and takes no callback, so there is nothing generic to
   hand anything to. Its body is synchronous and presentational. It READS the
   committed record to label the chrome and WRITES none of it: not `P`, the slug,
   the revision, the save counters, the saved baseline, the save latches, the save
   indicator, the open epoch, the refresh watermark or the continuity workspace.
   Anything else it needs was gathered in PREPARE.

   EVERYTHING IT DEFERS CALLS ONE OF THREE NAMED FUNCTIONS, and
   tests/project-load-transaction.js pins that set exactly:

     - toast(), which writes one sentence into the toast element;
     - refreshAgentStatus(), which re-reads agent status;
     - resumeFalGenerationPolling(), which restarts the generation poller.

   The last two are HAND-OFFS TO INDEPENDENT PRODUCT LIFECYCLES rather than
   continuations of this transaction, and they carry no authority out of it. When
   the poller finds a finished generation it enters `load({ intent: "refresh" })`
   through the front door, takes its own ticket and passes its own VALIDATE —
   exactly as a click would. What commits then is a refresh's decision, made on
   its own evidence, not a leftover of this open. */
function decorateProjectCommit(prepared) {
  applyTheme();
  applyProductionFormat();
  watchIntrinsicAspect();
  applyProjectIdentity();
  if (!location.hash) location.hash = "#/production";
  route();
  const warnings = (P.meta?.dataIntegrityWarnings || []).length;
  if (warnings)
    setTimeout(
      () => toast(`${warnings} project data-integrity warning${warnings === 1 ? "" : "s"} found. Review Settings or Reports before relying on ambiguous IDs.`),
      120,
    );
  /* Work the server collected through background recovery rather than through a
     browser refresh. The results are already in the workspace; this is what says
     HOW they got there. The sentence is the server's — it is the only side that
     knows which collector won — and it deliberately makes no claim about what
     was open. */
  if (prepared.backgroundRecovery?.message)
    setTimeout(() => toast(prepared.backgroundRecovery.message), 200);
  if ((AGENT_STATUS.runs || []).some((x) => ["QUEUED", "RUNNING"].includes(x.status)))
    setTimeout(() => refreshAgentStatus(false), 400);
  if (typeof resumeFalGenerationPolling === "function")
    setTimeout(() => resumeFalGenerationPolling(), 500);
}

/* ---------------------------------------------------------------------------
   THE TWO LIFECYCLES. */

/* A REPLACEMENT. This is the only lifecycle that contains the statements that
   replace a project: beginProjectOpen(), which advances the epoch and discards
   the continuity workspace, and showFirstRunWorkspace(), which clears the record
   entirely. Neither appears in the refresh lifecycle at all. */
async function runProjectReplacement() {
  applyTheme();
  const prepared = await prepareProjectSnapshot({ claimRecovery: true });
  if (!prepared.available) {
    /* FIRST RUN IS NOT AN EXIT FROM RECOVERY MODE. "There is no project to open"
       is what the server says when the active project's file has gone missing —
       which, for a quarantined project, may mean nothing worse than a rename, with
       the folder and its backups still sitting there. Clearing the workspace and
       offering to create a new project would drop the one screen that can still
       reach them. The mode ends when a document is served and validated, and this
       is not that. */
    if (PROJECT_QUARANTINE) {
      renderProjectQuarantineSurface(
        "The project still cannot be opened safely. " + (prepared.message || "The server no longer has this project to read."),
      );
      return { intent: "open", committed: false, reason: prepared.message || "no project is available to open" };
    }
    await showFirstRunWorkspace(prepared.message);
    return { intent: "open", committed: false, reason: "no project is available to open" };
  }
  const ticket = beginProjectOpen();
  /* THE COMMIT IS ALLOWED TO REFUSE, and a refusal is not a commit. The only
     refusal it has is the Recovery-mode gate, so a window that has not been
     through one stays exactly where it was rather than being decorated as though
     a project had been installed. */
  if (!commitPreparedProject(prepared, ticket))
    return { intent: "open", committed: false, reason: projectReplacementRefusal(prepared) || "the project could not be installed safely" };
  decorateProjectCommit(prepared);
  return { intent: "open", committed: true, reason: "" };
}
/* A REFRESH. Every ending other than the commit is a discard, and a discard
   mutates nothing. */
async function runProjectRefresh() {
  /* NOTHING TO REFRESH. There is no installed project for this refresh to
     re-read, so it returns. It does not open one, it does not clear anything and
     it does not advance the epoch — the first-run screen belongs to an explicit
     open. */
  if (!P || !ACTIVE_PROJECT_SLUG)
    return { intent: "refresh", committed: false, reason: "no project is open for a refresh to refresh" };
  const ticket = beginProjectRefresh();
  let prepared = null;
  try {
    prepared = await prepareProjectSnapshot();
  } catch (error) {
    /* A refresh that could not read the project changes nothing. The failure
       screens belong to an explicit open, which is a request to see a project;
       this was a background re-read of one already on screen. */
    return { intent: "refresh", committed: false, reason: error?.message || "the project could not be re-read" };
  }
  /* VALIDATE, THEN COMMIT. THERE IS NO AWAIT BETWEEN THESE TWO STATEMENTS, and
     tests/project-load-transaction.js reads this function's own source to prove
     it. Everything the commit installs is already in hand. */
  const refusal = projectRefreshRefusal(ticket, prepared);
  if (refusal) return { intent: "refresh", committed: false, reason: refusal };
  commitPreparedProject(prepared, ticket);
  decorateProjectCommit(prepared);
  return { intent: "refresh", committed: true, reason: "" };
}
function setSaveState(state, label) {
  /* Settings → Project has no save button because the project record saves itself.
     Any panel that says so mirrors the real save chain, so the promise on screen and
     the state of the file on disk are the same statement. */
  document.querySelectorAll("[data-mirror-save-state]").forEach((mirror) => {
    mirror.dataset.state = state;
    mirror.textContent = {
      saved: "Saved automatically",
      saving: "Saving…",
      dirty: "Unsaved changes — saving in a moment",
      error: "Could not save — check the CineBraid server window",
      loading: "Opening…",
    }[state] || label;
  });
  const el = $("#save-state");
  if (!el) return;
  el.dataset.state = state;
  const text = el.querySelector("span:last-child");
  if (text) text.textContent = label;
}
function currentAuthorityTransition() {
  if (!SAVED_PROJECT_BASELINE || !P || typeof authorityWriteTransition !== "function")
    return { requiresTransition: false, declaration: { targetKeys: [], receiptIds: [], transitionKind: "HUMAN_CANON_TRANSITION" } };
  return authorityWriteTransition(SAVED_PROJECT_BASELINE, P);
}
/* DEFERRED WORK WHOSE ONLY PURPOSE IS "SAVE THIS SHORTLY".

   load() schedules exactly one: the migration write-back, which persists a
   normalisation the open already applied in memory. Nobody is behind it - no
   click, no new information - so it is the one kind of callback that can begin a
   save entirely on its own, long after it was queued.

   WHY THEY ARE TRACKED RATHER THAN LEFT LOOSE. A refusal clears `saveTimer`, but
   a callback queued BEFORE the refusal is not in `saveTimer` and survives it.
   Once resumeProjectSaving() clears the latch, that stale callback calls dirty()
   and the browser resends the same refused body, at the same revision, with no
   edit behind it - an automatic retry the filmmaker never asked for, which is
   precisely what a refusal must not produce. Entering the block drops all of
   them, so nothing queued before a refusal can act after it.

   WHAT DOES NOT BELONG HERE. A deferred continuation of a gesture - the coverage
   approval chain, a modal opened a tick later - cannot save on its own: it needs
   the act that follows it, and while SAVE_BLOCKED is set dirty() refuses that
   act too. Neither does work carrying genuinely new in-memory state, such as a
   completed generation the poller reviewed; cancelling that would discard the
   filmmaker's own work rather than protect it. */
const PENDING_SAVE_TRIGGERS = new Set();
function scheduleSaveTrigger(run, ms) {
  /* BOUND TO THE OPEN THAT CREATED IT, HERE RATHER THAN AT THE CALL SITE.
     Deferred save-only work is written against ONE record. If the project is
     replaced before the callback fires, that work describes a document that is
     gone — and dirty() reads the LIVE `P`, slug and revision, so it would
     produce a save of whatever project is open now, from work created for a
     project nobody is looking at any more. The binding lives in this scheduler
     rather than in each caller's callback, because a rule a caller supplies is a
     rule the next caller can forget. */
  const epoch = PROJECT_OPEN_EPOCH;
  const timer = setTimeout(() => {
    PENDING_SAVE_TRIGGERS.delete(timer);
    if (epoch !== PROJECT_OPEN_EPOCH) return;
    run();
  }, ms);
  PENDING_SAVE_TRIGGERS.add(timer);
  return timer;
}
/* THE ONE WAY INTO SAVE_BLOCKED. Every refusal that stops this view saving goes
   through here, so a later refusal surface cannot forget the cancellation and
   reintroduce the retry. */
function blockSaving() {
  SAVE_BLOCKED = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  for (const timer of PENDING_SAVE_TRIGGERS) clearTimeout(timer);
  PENDING_SAVE_TRIGGERS.clear();
}
function dirty() {
  clearTimeout(saveTimer);
  /* RECOVERY MODE REFUSES BEFORE IT COUNTS. Everything below this line describes
     a window that holds a project: it advances the local edit counter, says
     "Unsaved changes", and arms a write. A quarantined window holds no project at
     all, so all three would be untrue — and the third would be a write into a
     document CineBraid has just promised not to touch. */
  if (PROJECT_QUARANTINE) return setSaveState("error", "Not saved — this project is in Recovery mode");
  clearTimeout(SAVE_STATE_TIMER);
  SAVE_REVISION += 1;
  setSaveState("dirty", "Unsaved changes");
  if (AUTHORITY_SAVE_REFUSED) return;
  /* Saving is paused, so the resting "saving in a moment" the dirty state speaks
     would be untrue. The edit is kept; it is simply not on its way anywhere. */
  if (SAVE_BLOCKED) return setSaveState("error", "Not saved — saving is paused");
  const transition = currentAuthorityTransition();
  if (transition.requiresTransition) {
    saveTimer = null;
    queueProjectSave(captureProjectSave()).catch(() => {});
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    queueProjectSave(captureProjectSave()).catch(() => {});
  }, 500);
}
/* Media writes name the project they belong to
/* Media writes name the project they belong to, so a switch that happens while
   an upload body is still arriving cannot redirect the file. Empty before the
   first load, which the server reads as "the active project" — the old
   behaviour, kept for any caller that genuinely has nothing to name. */
function projectSlugParam() {
  return ACTIVE_PROJECT_SLUG
    ? `&slug=${encodeURIComponent(ACTIVE_PROJECT_SLUG)}`
    : "";
}
function captureProjectSave() {
  if (!P || !ACTIVE_PROJECT_SLUG) return null;
  const transition = currentAuthorityTransition();
  return {
    slug: ACTIVE_PROJECT_SLUG,
    revision: SAVE_REVISION,
    documentRevision: PROJECT_REVISION,
    body: JSON.stringify(P),
    baseline: SAVED_PROJECT_BASELINE ? structuredClone(SAVED_PROJECT_BASELINE) : null,
    transition: transition.requiresTransition ? transition.declaration : null,
  };
}
/* A stale view must stop writing, not keep retrying with a body that will be
   refused again. The message says what happened in one sentence and offers the
   only safe action; reconciling two divergent documents is not attempted. */
function projectConflict(data) {
  PROJECT_CONFLICT = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  setSaveState("error", "Not saved — project changed");
  const message = data?.error
    || "This project changed while this view was open. Reload to continue from the current project.";
  if (typeof toast === "function") toast(message);
  if (typeof openModal === "function")
    openModal(
      `<h3>This project changed while this view was open</h3>`
      + `<div class="modal-sub">YOUR LAST EDITS IN THIS TAB WERE NOT SAVED</div>`
      + `<p>${message}</p>`
      + `<div class="modal-actions"><button class="approve-btn large" onclick="location.reload()">RELOAD PROJECT</button></div>`,
    );
}
/* THE TYPED CODE SAYS WHAT HAPPENED. THE HTTP STATUS DOES NOT.

   Both the Authority Write Seam's Canon policies and ordinary project validation
   refuse a save with 422. Branching on the status alone presented every one of
   them as "Production authority was not changed / approval change refused", so a
   filmmaker whose document merely failed validation was told their approval had
   been refused - and was offered REBASE & RETRY, which re-reads the stored
   baseline and resends the SAME document. Rebasing cannot make an invalid
   document valid, so the only action on offer was one that could not work.

   The list below is the seam's authority policy refusals. Anything else arriving
   with a 422 is reported as the refusal it is rather than borrowed into this
   surface, because claiming authority was involved when it was not is the exact
   untruth this repair removes. */
const AUTHORITY_REFUSAL_CODES = new Set([
  "CANON_TRANSITION_REQUIRED",
  "CANON_DECLARATION_MISMATCH",
  "AUTHORITY_LEDGER_UNTRUSTED",
  "AUTHORITY_RECEIPT_INVALID",
  "AUTHORITY_TARGET_INVALID",
  "AUTHORITY_TARGET_AMBIGUOUS",
  "AUTHORITY_EDGE_RECEIPT_MISMATCH",
  "AUTHORITY_EDGE_WITHOUT_CURRENT_RECEIPT",
  "SYSTEM_INVALIDATION_DECLARATION_REQUIRED",
  "SYSTEM_INVALIDATION_SHAPE_INVALID",
  "SYSTEM_INVALIDATION_PROVENANCE_FORBIDDEN",
  "SYSTEM_INVALIDATION_PRECONDITION_FAILED",
]);
function isAuthorityRefusalCode(code) {
  return AUTHORITY_REFUSAL_CODES.has(String(code || ""));
}
/* A refused save that is NOT about production authority. The edits stay in this
   tab, the automatic save loop stops so the same refused body is not resent on
   every keystroke, and no rebase is offered because re-reading the stored
   baseline cannot resolve it. */
function projectSaveRefusal(data) {
  blockSaving();
  const validation = String(data?.code || "") === "PROJECT_VALIDATION_FAILED";
  setSaveState("error", validation ? "Not saved — project failed validation" : "Not saved — save refused");
  const message = data?.error
    || (validation
      ? "CineBraid checked this project before writing it and found a problem, so nothing was written."
      : "CineBraid did not write this save.");
  const issues = (data?.issues || [])
    .map((row) => (typeof row === "string" ? row : row?.message || row?.error || ""))
    .filter(Boolean);
  if (typeof toast === "function") toast(message);
  if (typeof openModal === "function") openModal(
    "<h3>" + (validation ? "This project did not pass validation, so it was not saved" : "The server refused this save") + "</h3>"
    + "<div class=\"modal-sub\">NOTHING WAS WRITTEN AND YOUR EDITS ARE STILL IN THIS TAB</div>"
    + "<p>" + esc(message) + "</p>"
    + (issues.length ? "<p><b>What failed</b><br>" + issues.map(esc).join("<br>") + "</p>" : "")
    + "<p>Saving is paused so the same refused save is not repeated. Undo the change that caused this and continue — CineBraid saves again on your next edit.</p>"
    + "<div class=\"modal-actions\"><button class=\"cancel\" onclick=\"location.reload()\">RELOAD AND DISCARD</button>"
    + "<button class=\"approve-btn large\" onclick=\"resumeProjectSaving()\">CONTINUE EDITING</button></div>",
  );
}
window.resumeProjectSaving = () => {
  SAVE_BLOCKED = false;
  closeModal();
  setSaveState("dirty", "Unsaved changes");
};
/* THIS VIEW CANNOT IDENTIFY THE PROJECT REVISION IT READ.

   The Authority Write Seam requires an exact revision, so the old If-Match "*"
   fallback could only ever be answered 409 PROJECT_REVISION_CONFLICT - which the
   browser then presented as "this project changed while this view was open".
   Nobody had changed anything; this view simply never learned which revision it
   was looking at. Nothing is put on the wire, and the problem is reported as the
   local save precondition it actually is. */
function saveRevisionUnavailable(data) {
  blockSaving();
  setSaveState("error", "Not saved — this window cannot identify the project revision");
  const message = data?.error
    || "CineBraid could not identify which stored version of this project this window is showing, so it did not write over the stored project.";
  if (typeof toast === "function") toast(message);
  if (typeof openModal === "function") openModal(
    "<h3>This window cannot save safely</h3>"
    + "<div class=\"modal-sub\">NOTHING WAS WRITTEN AND YOUR EDITS ARE STILL IN THIS TAB</div>"
    + "<p>" + esc(message) + "</p>"
    + "<p>Reopening the project restores saving. Edits made in this window since it stopped saving will be lost.</p>"
    + "<div class=\"modal-actions\"><button class=\"approve-btn large\" onclick=\"location.reload()\">REOPEN PROJECT</button></div>",
  );
}
function authoritySaveRefusal(data, job) {
  AUTHORITY_SAVE_REFUSED = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  setSaveState("error", "Not saved — approval change refused");
  const targets = (data?.targets || []).map((row) => row.targetKey).filter(Boolean);
  const message = data?.error || "This edit would change production authority outside its explicit protocol.";
  if (typeof toast === "function") toast(message);
  if (typeof openModal === "function") openModal(
    "<h3>Production authority was not changed</h3><div class=\"modal-sub\">THE EDIT BATCH IS STILL IN THIS TAB</div><p>" + esc(message) + "</p>"
    + (targets.length ? "<p><b>Protected targets</b><br>" + targets.map(esc).join("<br>") + "</p>" : "")
    + "<div class=\"modal-actions\"><button class=\"cancel\" onclick=\"location.reload()\">RELOAD</button><button class=\"approve-btn large\" onclick=\"rebaseAuthoritySave()\">REBASE &amp; RETRY</button></div>",
  );
}
window.rebaseAuthoritySave = async () => {
  if (!P || !ACTIVE_PROJECT_SLUG) return;
  try {
    const response = await fetch("/api/projects/" + encodeURIComponent(ACTIVE_PROJECT_SLUG) + "/project", { cache: "no-store" });
    const stored = await response.json();
    if (!response.ok) throw new Error(stored.error || "Could not reload the stored authority baseline");
    SAVED_PROJECT_BASELINE = structuredClone(stored);
    PROJECT_REVISION = response.headers?.get?.("x-cinebraid-project-revision") || response.headers?.get?.("etag") || PROJECT_REVISION;
    AUTHORITY_SAVE_REFUSED = false;
    /* The saved baseline now points at a different stored document, which is the
       same fact about freshness that an accepted write is. */
    PROJECT_SAVE_GENERATION += 1;
    closeModal();
    await queueProjectSave(captureProjectSave());
  } catch (error) { toast(error.message || "Could not rebase this save"); }
};
function queueProjectSave(job) {
  if (!job) return SAVE_CHAIN;
  const run = SAVE_CHAIN.catch(() => {}).then(async () => {
    if (PROJECT_CONFLICT || SAVE_BLOCKED) return; // this view is known stale or blocked; stop writing
    /* THE LAST GATE BEFORE ANY PROJECT WRITE LEAVES THIS WINDOW, and the reason it
       is stated separately from SAVE_BLOCKED even though quarantine sets that too.

       SAVE_BLOCKED is cleared by every commit — a window that opens a project is
       saving again, which is correct. Quarantine is not a save refusal that a
       later open resolves; it is a statement that a specific stored document must
       not be written, and it is cleared in exactly one place, by the commit that
       proved the document is safe. Both endpoints below are behind this line, so
       an ordinary save AND a Canon transition are refused by the same statement. */
    if (PROJECT_QUARANTINE) return;
    if (ACTIVE_PROJECT_SLUG === job.slug)
      setSaveState("saving", "Saving…");
    const headers = { "Content-Type": "application/json" };
    /* The exact revision this view loaded or last wrote. There is no wildcard:
       the Authority Write Seam requires an exact revision on every project write.

       RESOLVED HERE, AT SEND TIME, NOT WHEN THE JOB WAS QUEUED. captureProjectSave()
       snapshots PROJECT_REVISION when a save is ENQUEUED, and SAVE_CHAIN serialises
       only the sending. So two saves queued inside one server round-trip — a
       debounced dirty() followed by an explicit flush, which is ordinary during
       automation — both carried the same pre-save revision. The first succeeded and
       moved the stored document; the second was then refused 409
       PROJECT_REVISION_CONFLICT, the later edit was discarded, and PROJECT_CONFLICT
       latched so the view stopped saving entirely. Reading the live value here means
       a queued save inherits the revision produced by the save immediately ahead of
       it in its own chain.

       THIS DOES NOT WEAKEN OPTIMISTIC CONCURRENCY. PROJECT_REVISION only ever moves
       forward from load(), which reads what is actually stored, or from THIS view's
       own successful save. Nothing another window writes advances it, so a genuinely
       stale view still sends its last-known revision and is still refused — which is
       what tests/state-interleaving.js F-03 pins.

       A job whose project is no longer the active one keeps its captured revision:
       PROJECT_REVISION now describes a different document, and sending one project's
       revision for another's save is the ownership defect this file already refuses
       to make elsewhere.

       A VIEW WITH NO REVISION DOES NOT WRITE. This used to fall back to "*",
       which the seam can only answer 409 PROJECT_REVISION_CONFLICT - a normal
       project conflict manufactured out of a local precondition failure. */
    const documentRevision =
      (ACTIVE_PROJECT_SLUG === job.slug ? PROJECT_REVISION : job.documentRevision) || "";
    if (!documentRevision) {
      if (ACTIVE_PROJECT_SLUG === job.slug) saveRevisionUnavailable();
      return;
    }
    headers["If-Match"] = documentRevision;
    const successor = JSON.parse(job.body);
    let transitionDeclaration = job.transition;
    const transitionBaseline =
      ACTIVE_PROJECT_SLUG === job.slug ? SAVED_PROJECT_BASELINE : job.baseline;
    /* A second job can be captured while the first explicit transition is still
       in flight. Once the first commits, its receipt is already in the durable
       baseline: resending the captured declaration would claim a receipt changed
       when it did not. Re-derive the complete Canon delta only after the preceding
       job has settled, from that durable baseline and this job's exact successor. */
    if (transitionBaseline && typeof authorityWriteTransition === "function") {
      const comparison = authorityWriteTransition(transitionBaseline, successor);
      transitionDeclaration = comparison.requiresTransition ? comparison.declaration : null;
    }
    const isCanonTransition = transitionDeclaration && typeof transitionDeclaration === "object";
    const endpoint = isCanonTransition
      ? "/api/projects/" + encodeURIComponent(job.slug) + "/canon-transition"
      : "/api/projects/" + encodeURIComponent(job.slug) + "/project";
    const r = await fetch(endpoint, {
      method: isCanonTransition ? "POST" : "PUT",
      headers,
      body: isCanonTransition ? JSON.stringify({ successor, transition: transitionDeclaration }) : job.body,
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      if (r.status === 409) {
        if (ACTIVE_PROJECT_SLUG === job.slug) projectConflict(data);
        return;
      }
      /* 428 PROJECT_REVISION_REQUIRED is not a conflict either: nothing changed
         the project, this request simply did not identify what it read. */
      if (r.status === 428) {
        if (ACTIVE_PROJECT_SLUG === job.slug) saveRevisionUnavailable(data);
        return;
      }
      if (r.status === 422) {
        if (ACTIVE_PROJECT_SLUG === job.slug) {
          if (isAuthorityRefusalCode(data?.code)) authoritySaveRefusal(data, job);
          else projectSaveRefusal(data);
        }
        return;
      }
      throw new Error(data.error || "Project save failed");
    }
    const saved = await r.json().catch(() => ({}));
    if (ACTIVE_PROJECT_SLUG === job.slug) {
      /* Install the durable authority result before accepting its revision. P
         already contains the submitted edge; the server-returned ledger is the
         verifier's exact accepted record. Later ordinary edits remain in P. */
      const persisted = saved.project || successor;
      if (saved.project) {
        if (Object.prototype.hasOwnProperty.call(saved.project, "productionAuthority"))
          P.productionAuthority = structuredClone(saved.project.productionAuthority);
        else delete P.productionAuthority;
      }
      SAVED_PROJECT_BASELINE = structuredClone(persisted);
      AUTHORITY_SAVE_REFUSED = false;
      /* STORAGE ACCEPTED THIS WRITE. Any refresh snapshot read before now is
         behind the record; the generation is how such a snapshot is recognised at
         its commit point. Inside the same-project branch on purpose — a write
         accepted for a project this window has left changes nothing about the
         record on screen. */
      PROJECT_SAVE_GENERATION += 1;
      /* The document this view is now in step with. Without this the next save
         would carry the pre-save revision and be refused as stale. */
      PROJECT_REVISION =
        saved.revision || r.headers?.get?.("x-cinebraid-project-revision") || r.headers?.get?.("etag") || PROJECT_REVISION;
      SAVED_REVISION = Math.max(SAVED_REVISION, job.revision);
      if (job.revision === SAVE_REVISION) {
        setSaveState("saved", "Saved");
        SAVE_STATE_TIMER = setTimeout(
          () => setSaveState("saved", "Saved"),
          1600,
        );
      }
    }
  });
  SAVE_CHAIN = run;
  run.catch((error) => {
    if (ACTIVE_PROJECT_SLUG === job.slug) {
      setSaveState("error", "Save failed");
      toast(error.message || "Save failed — check server terminal");
    }
  });
  return run;
}
async function flushPendingProjectSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  /* Let an already queued transition settle before deciding that its
     revision still needs another request. A pre-check here duplicates the
     in-flight act because SAVED_REVISION advances only with its response. */
  await SAVE_CHAIN;
  if (AUTHORITY_SAVE_REFUSED || SAVE_BLOCKED) return;
  if (!P || !ACTIVE_PROJECT_SLUG || SAVE_REVISION <= SAVED_REVISION) return;
  await queueProjectSave(captureProjectSave());
}

/* ==========================================================================
   B1 — WHETHER THE OPEN PROJECT IS ACTUALLY SAVED, ANSWERED ONCE.

   AWAITING flushPendingProjectSave() PROVES NOTHING, and that is by design
   rather than by accident. queueProjectSave() reports every refusal it can
   RECOVER from by returning, not by throwing — a resolved promise is how this
   module says "the request is finished", never "the document was written".
   Six distinct outcomes above resolve without an exception:

     PROJECT_CONFLICT / SAVE_BLOCKED   the view is already known stale or paused
     PROJECT_QUARANTINE                this stored document must not be written
     no document revision              a local precondition failed; nothing sent
     409 PROJECT_REVISION_CONFLICT     projectConflict(), then return
     428 PROJECT_REVISION_REQUIRED     saveRevisionUnavailable(), then return
     422 (validation or authority)     projectSaveRefusal()/authoritySaveRefusal()

   And flushPendingProjectSave() itself returns early — resolved — when a refusal
   is ALREADY latched, so a caller that only awaits it cannot even tell that the
   project was refused before it asked.

   Any caller about to do something IRREVERSIBLE on the strength of "the open
   project is safe" must ask this instead. It is a read: it sends nothing, latches
   nothing, and clears nothing, so asking cannot change the answer. It reports the
   reason as well as the verdict, because a caller that must refuse has to say why.

   Callers await the flush FIRST and ask this SECOND. */
function projectSaveSettled() {
  if (!P || !ACTIVE_PROJECT_SLUG) {
    return { settled: false, code: "NO_OPEN_PROJECT", reason: "No project is open." };
  }
  if (PROJECT_QUARANTINE) {
    return {
      settled: false,
      code: "PROJECT_QUARANTINED",
      reason: "The stored project is quarantined, so CineBraid is not writing to it.",
    };
  }
  if (PROJECT_CONFLICT) {
    return {
      settled: false,
      code: "PROJECT_REVISION_CONFLICT",
      reason: "The project you have open changed in storage while this window was open, so its save was refused.",
    };
  }
  if (AUTHORITY_SAVE_REFUSED) {
    return {
      settled: false,
      code: "AUTHORITY_SAVE_REFUSED",
      reason: "The project you have open has an approval change its save was refused, so it is not saved.",
    };
  }
  if (SAVE_BLOCKED) {
    return {
      settled: false,
      code: "SAVE_BLOCKED",
      reason: "Saving is paused on the project you have open because its last save was refused.",
    };
  }
  if (SAVE_REVISION > SAVED_REVISION) {
    return {
      settled: false,
      code: "UNSAVED_EDITS",
      reason: "The project you have open still has edits that have not reached storage.",
    };
  }
  return { settled: true, code: "", reason: "" };
}
if (typeof window !== "undefined") window.projectSaveSettled = projectSaveSettled;

/* ==========================================================================
   B1 (RACE) — A SAVE VERDICT IS A SNAPSHOT, NOT A PERMIT TO REPLACE LATER.

   THE DEFECT THE FIRST B1 FIX LEFT BEHIND. projectSaveSettled() correctly
   answers "is the open project saved RIGHT NOW", and startManualProjectCommit()
   correctly asked it before POSTing /api/projects/new. But the POST is an
   `await`: the event loop is free for the whole round trip, and a filmmaker can
   open Settings and edit Film A inside it. The verdict was taken before that
   edit and was then used, several awaits later, to justify replacing the project
   the edit was made to. Loading Film B cancels Film A's pending save and resets
   its counters, so the edit went. Independent review reproduced the stronger
   case too: the intervening edit's save is REFUSED 422, SAVE_BLOCKED is true at
   the moment of replacement, projectSaveSettled() would say false — and the
   replacement proceeded anyway, discarding both the edit and the refusal.

   THE FENCE, AND IT IS THE ONE THIS FILE ALREADY USES. A refresh has exactly
   this problem — several awaits between reading a snapshot and installing it —
   and solves it with a ticket taken at the start (beginProjectRefresh) validated
   at the commit point. This is that pattern for replacement rather than refresh,
   and it compares the same facts: which open, which project, which durable
   generation, which stored revision, and which local edit counters.

   WHAT MAKES IT A CERTIFICATE RATHER THAN A BOOLEAN. It names the exact revision
   and generation that were certified. "Still settled" is not enough on its own:
   a window that saved a NEW revision mid-flight is settled again, and replacing
   there would discard an edit that was never certified. Equality on the
   generation and the revision is what distinguishes "nothing happened" from
   "something happened and then settled" — and those need different answers.

   IT WRITES NOTHING. Both halves are reads, so asking cannot change the answer,
   and taking a certificate cannot make a replacement more likely to be allowed. */
function createReplacementCertificate() {
  const settled = projectSaveSettled();
  if (!settled.settled) return { ok: false, code: settled.code, reason: settled.reason };
  return {
    ok: true,
    slug: ACTIVE_PROJECT_SLUG,
    epoch: PROJECT_OPEN_EPOCH,
    /* The durable truth this window owned when it was certified. Advanced by an
       accepted write, a rebase, and a server-side ingest — every way the stored
       document can move without a replacement. */
    saveGeneration: PROJECT_SAVE_GENERATION,
    /* The stored document that certificate describes. Compared for EQUALITY
       only: revisions are opaque server tokens and cannot be ordered. */
    revision: PROJECT_REVISION,
    saveRevision: SAVE_REVISION,
    savedRevision: SAVED_REVISION,
  };
}

/* "" when the certificate still describes the window, otherwise the reason it
   does not. Synchronous and await-free on purpose: the caller checks this and
   commits the replacement with no yield in between, which is what makes the
   answer still true at the moment it is acted on. */
function createReplacementRefusal(certificate) {
  /* An unusable certificate reports the SAVE STATE that made it unusable, not a
     sentence about when it was taken — this function is called twice, once with
     the certificate from before the request and once with a fresh one taken
     after the intervening save was carried through, and "when this creation
     began" would be false the second time. */
  if (!certificate || !certificate.ok) {
    return (certificate && certificate.reason) || "the project you have open is not saved";
  }
  if (!P || !ACTIVE_PROJECT_SLUG) return "no project is open to replace";
  /* SOURCE IDENTITY FIRST. A response that outlived the project it was started
     for must not replace whichever project happens to be open now. */
  if (certificate.slug !== ACTIVE_PROJECT_SLUG)
    return `the project this creation began from (${certificate.slug}) is no longer the one open`;
  if (certificate.epoch !== PROJECT_OPEN_EPOCH)
    return "the project was explicitly reopened or replaced while this creation was in flight";
  /* THEN WHETHER IT IS STILL SAVED AT ALL. This catches a refusal that ARRIVED
     during the flight — 422, 409, a block, a quarantine — which is the case
     where replacing would erase both the edit and the reason it was refused. */
  const settled = projectSaveSettled();
  if (!settled.settled)
    return settled.reason || "the project you have open is no longer saved";
  /* AND FINALLY WHETHER IT IS STILL THE SAME SAVED THING. A window that edited
     and successfully saved during the flight is settled again, at a revision
     this certificate never covered. That is not a refusal — it is a certificate
     that has to be taken again for the newer revision. */
  if (certificate.saveGeneration !== PROJECT_SAVE_GENERATION)
    return "this window's stored project advanced while the creation was in flight, so the earlier save proof is behind the record";
  if (certificate.revision !== PROJECT_REVISION)
    return "the stored revision this creation was certified against is no longer the one this window holds";
  if (certificate.saveRevision !== SAVE_REVISION || certificate.savedRevision !== SAVED_REVISION)
    return "the project you have open was edited while the creation was in flight";
  return "";
}
if (typeof window !== "undefined") {
  window.createReplacementCertificate = createReplacementCertificate;
  window.createReplacementRefusal = createReplacementRefusal;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ==========================================================================
   AT1-G — A REFUSAL THE FILMMAKER PRESSED FOR STAYS ON THE SCREEN.

   THE DEFECT. Every refusal on an action surface was reported by toast() above
   and by nothing else. It clears itself after 2.2 seconds, it is a single line
   with no room for a requirement, and it renders in a corner rather than beside
   the control that was pressed. A filmmaker who pressed Confirm and looked back
   at the button found the button unchanged, still offered, with no trace of why
   it had not worked — so the only available reading was that the press had been
   missed, and the honest thing CineBraid had actually said was gone.

   A toast is a fine NOTICE. It is not evidence, and it must not be the only
   record of a decision the application refused to make.

   WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT. It is not a global error
   subsystem and it does not intercept anything. It is a keyed store of the last
   refusal per action surface — the same shape and lifetime as CREATION_RESULTS
   in public/creation-studio.js, which already keeps a per-surface result across
   renders — and a renderer that surfaces choose to place beside their own
   control. Nothing is captured that a surface did not record, and a surface that
   records nothing renders nothing.

   OWNERSHIP: this browser tab. LIFETIME: until the act succeeds, the filmmaker
   dismisses it, or the tab reloads. Nothing is written to the project or the
   server — a refusal means the project did NOT change, and persisting evidence
   of a non-change into the document would be its own untruth.

   THE WORDING IS THE AUTHORITY LAYER'S OWN. `message` is passed through exactly
   as the kernel or the seam said it. This function does not rephrase a refusal,
   because the refusal sentences already name what is wrong and what would
   resolve it, and a second rendering of them is a second place for them to drift. */
/* SCOPED TO THE PROJECT IT IS ABOUT, the same three ways CONTINUITY_RUNS is.
 *
 * A refusal is derived display state about ONE project's record, and every key a
 * surface can build from is target coordinates: `state-default` is the literal id
 * every entity's primary reference uses, and entity ids are name-slugs, so two
 * films that each contain a location called Platform both address
 * `entity-state:locations:LOC-PLATFORM#state-default`. Un-scoped, one film's
 * refusal renders in the next — under the heading "CineBraid did not make this
 * change", about a change never attempted there, beside a control that in THAT
 * film would have succeeded. A store built to stop CineBraid saying untrue things
 * must not be able to say one.
 *
 * So: the key carries the project, a read revalidates it, a write evicts anything
 * from another project, and beginProjectOpen() clears the map outright — which is
 * what covers reopening the SAME project, where the slug never changes but the
 * record does. */
const ACTION_REFUSALS = window.__cinebraidActionRefusals || (window.__cinebraidActionRefusals = new Map());
function actionRefusalProject() {
  if (typeof ACTIVE_PROJECT_SLUG !== "undefined" && ACTIVE_PROJECT_SLUG) return String(ACTIVE_PROJECT_SLUG);
  if (typeof window !== "undefined" && window.ACTIVE_PROJECT_SLUG) return String(window.ACTIVE_PROJECT_SLUG);
  return "";
}
function actionRefusalKey(key) {
  const id = String(key == null ? "" : key);
  if (!id) return "";
  return `${actionRefusalProject()}::${id}`;
}
window.recordActionRefusal = (key, message, code = "") => {
  const id = actionRefusalKey(key);
  if (id) {
    const project = actionRefusalProject();
    /* Nothing from another project stays resident. */
    for (const [existing, row] of ACTION_REFUSALS) if (row?.projectKey !== project) ACTION_REFUSALS.delete(existing);
    ACTION_REFUSALS.set(id, {
      message: String(message || "That action could not be completed."),
      code: String(code || ""),
      projectKey: project,
    });
  }
};
window.clearActionRefusal = (key) => {
  ACTION_REFUSALS.delete(actionRefusalKey(key));
};
window.dismissActionRefusal = (key) => {
  ACTION_REFUSALS.delete(actionRefusalKey(key));
  route();
};
function actionRefusal(key) {
  const row = ACTION_REFUSALS.get(actionRefusalKey(key)) || null;
  /* Read-side revalidation. The key already scopes it; this makes a mismatch
     unrepresentable even if some future caller builds a key another way. */
  return row && row.projectKey === actionRefusalProject() ? row : null;
}
/* Called by beginProjectOpen(), which every project open funnels through. */
function resetActionRefusals() {
  ACTION_REFUSALS.clear();
}
/* Rendered by the surface that offered the act, immediately beside it. The
   dismiss control is the filmmaker's, never a timer's. */
function actionRefusalMarkup(key) {
  const refusal = actionRefusal(key);
  if (!refusal) return "";
  /* THE SURFACE'S OWN KEY, NOT THE STORAGE KEY. The project scoping is an
     internal addressing concern: rendering the prefixed key here would put the
     slug in the DOM for no reader, and — the part that actually broke — would
     hand dismissActionRefusal() a key it prefixes a SECOND time, so Dismiss
     would delete nothing and the refusal could never be cleared. */
  const surfaceKey = String(key == null ? "" : key);
  return `<div class="action-refusal prompt-check warn" role="status" data-action-refusal="${attr(surfaceKey)}"${refusal.code ? ` data-refusal-code="${attr(refusal.code)}"` : ""}><b>CineBraid did not make this change</b><span>${esc(refusal.message)}</span><button type="button" class="action-refusal-dismiss" onclick="dismissActionRefusal('${attr(surfaceKey)}')" aria-label="Dismiss this message">Dismiss</button></div>`;
}
function tally() {
  const c = {};
  P.shots.forEach((s) => {
    const k = workflowState(s).key;
    c[k] = (c[k] || 0) + 1;
  });
  const total = P.shots.reduce((a, s) => a + shotDur(s), 0);
  /* The breakdown below the totals is the workflow status of every shot, so it is
     labelled as such — otherwise "approved 2" reads as a contradiction of the
     "0/3 shots delivered" tile on Production, which counts a different thing. */
  /* ONLY THE STATES THIS FILM IS ACTUALLY IN.
     A five-row ladder in permanent chrome, three rows of it reading zero, is
     technical detail sitting where a filmmaker looks for their project. The
     breakdown is unchanged in what it counts; a state no shot is in is simply not
     listed, and the heading goes with it when there is nothing to head. */
  const breakdown = WORKFLOW_STATES.filter((k) => c[k]);
  $("#tally").innerHTML =
    `<div><b>${P.shots.length}</b> ${pluralWord(P.shots.length, "shot")} · <b>${P.scenes.length}</b> ${pluralWord(P.scenes.length, "scene")} · <b>${mmss(total)}</b></div>` +
    (breakdown.length
      ? `<div class="tally-heading">Shot workflow status</div>` +
        breakdown.map(
          (k) => `<div>${workflowStatusLabel(k).toLowerCase()} <b>${c[k]}</b></div>`,
        ).join("")
      : "");
}

/* ---------- project switcher ---------- */
let PROJECT_SWITCH_ERROR = null;
function clearProjectSwitcherError() {
  PROJECT_SWITCH_ERROR = null;
  const slot = document.getElementById("project-switcher-error");
  if (slot) {
    slot.innerHTML = "";
    slot.hidden = true;
  }
}
/* Keep the dialog open and explain the refusal in place: which project, which file, and the
   fact that the project the user was already in is untouched and still open. */
function showProjectSwitcherError(data, slug) {
  const failure = (data && data.projectFailure) || {};
  const name = failure.title || failure.slug || slug || "that project";
  const message =
    (data && data.error) || `CineBraid could not open “${name}”.`;
  PROJECT_SWITCH_ERROR = { failure, message, slug: failure.slug || slug || "" };
  const slot = document.getElementById("project-switcher-error");
  if (!slot) return toast(message);
  const where = failure.path
    ? `<span class="project-switcher-error-path">File: <code>${esc(failure.path)}</code></span>`
    : "";
  const detail = failure.detail
    ? `<details><summary>Technical detail</summary><pre>${esc(failure.detail)}</pre></details>`
    : "";
  slot.innerHTML = `<strong>Could not open “${esc(name)}”</strong><span>${esc(message)}</span>${where}${detail}`;
  slot.hidden = false;
  slot.scrollIntoView?.({ block: "nearest" });
}
async function openProjectSwitcher() {
  const { active, projects, archived = [], trashed = [] } = await (await fetch("/api/projects")).json();
  const activeRows = projects.length ? projects.map((p) => `<article class="project-switcher-row ${p.slug === active ? "active" : ""}">
    <button class="project-switcher-open" onclick="switchProject('${attr(p.slug)}')"><span>${p.slug === active ? "▸ " : ""}${esc(p.title)}</span><small>${esc(p.slug)}${p.format ? ` · ${esc(p.format)}` : ""}</small></button>
    <div class="project-switcher-actions"><button class="ghost-btn" onclick="event.stopPropagation();requestArchiveProject('${attr(p.slug)}','${attr(p.title || p.slug)}')">Archive</button><button class="danger-btn project-delete-btn" onclick="event.stopPropagation();requestDeleteProject('${attr(p.slug)}','${attr(p.title || p.slug)}')">Delete</button></div>
  </article>`).join("") : `<div class="guided-empty-inline"><b>No active projects.</b><span>Create a project or restore one from the archive.</span></div>`;
  const archivedRows = archived.length ? `<details class="project-archive-list"><summary>Archived projects <span>${archived.length}</span></summary><div>${archived.map((p) => `<article class="project-switcher-row archived"><div class="project-switcher-open"><span>${esc(p.title)}</span><small>${esc(p.slug)}${p.archivedAt ? ` · archived ${esc(new Date(p.archivedAt).toLocaleDateString())}` : ""}</small></div><div class="project-switcher-actions"><button class="approve-btn" onclick="restoreArchivedProject('${attr(p.archiveName)}')">Restore</button></div></article>`).join("")}</div></details>` : "";
  const trashedRows = trashed.length ? `<details class="project-archive-list project-trash-list"><summary>Recently deleted projects <span>${trashed.length}</span></summary><div>${trashed.map((p) => `<article class="project-switcher-row archived"><div class="project-switcher-open"><span>${esc(p.title)}</span><small>${esc(p.slug)}${p.deletedAt ? ` · deleted ${esc(new Date(p.deletedAt).toLocaleDateString())}` : ""}</small></div><div class="project-switcher-actions"><button class="approve-btn" onclick="restoreTrashedProject('${attr(p.trashName)}')">Restore</button></div></article>`).join("")}</div></details>` : "";
  openModal(`<div class="project-switcher-modal"><header><div><span>PROJECT MANAGEMENT</span><h3>Projects</h3><p>Open active work, archive projects you may return to, or restore recently deleted projects without using the file manager.</p></div></header><div id="project-switcher-error" class="project-switcher-error" role="alert" hidden></div><div class="project-switcher-list">${activeRows}</div>${archivedRows}${trashedRows}<div class="project-switcher-legend"><span><b>Archive</b> hides a project and keeps it restorable here.</span><span><b>Delete</b> moves the complete folder to recoverable trash; it remains restorable from this window.</span></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="add-btn" onclick="newProject()">+ New project</button></div></div>`);
  /* Reopening the dialog from a failure state must not lose the explanation of what failed. */
  if (PROJECT_SWITCH_ERROR)
    showProjectSwitcherError(
      { error: PROJECT_SWITCH_ERROR.message, projectFailure: PROJECT_SWITCH_ERROR.failure },
      PROJECT_SWITCH_ERROR.slug,
    );
}
/* ===========================================================================
   A2 — SHELL IDENTITY. WHICH PROJECT AM I IN, AND WHICH CINEBRAID IS THIS?

   WHAT WAS WRONG. The rail printed the project title and, directly beneath it,
   `P.meta.format + " · " + P.meta.version`. On the shipped sample that second
   value is "6.6.4-studio.2", and `.project-format` is uppercased, so what a
   filmmaker read under the title of their film was:

       THREE-SHOT SAMPLE · 6.6.4-STUDIO.2

   Every instinct says that is the application version. It is not. It is a
   PROJECT RECORD field — server.js's revision comment already says so plainly:
   a product-version string that nothing increments and nothing checks. It was
   three releases stale, it sat in the one place on screen where an application
   version belongs, and the application's actual version appeared nowhere in the
   running shell at all. The only truthful version-shaped string in the product
   was in the browser tab title.

   WHAT THIS DOES ABOUT IT. It separates the two questions and gives each one a
   place proportional to how often a filmmaker needs it:

     PROJECT   the title, big, at the top of the rail, with format beneath it.
               Nothing schema-shaped, nothing release-shaped.
     APP       "CineBraid <release>" — quiet, in the rail foot, from the
               canonical release identity and nowhere else.
     BUILD     "Development build" or "Build <id>" — one step in, in About,
               because which build you are running is a support question rather
               than a working one.

   NOTHING HERE DECIDES A VERSION. The release version is package.json's, read
   through release-identity.js by the server; the build id is supplied at
   package time or absent; the project fields are the project's. This file
   displays those three and invents none of them.
   =========================================================================== */

/* THE SHELL'S PROJECT LINES, WRITTEN IN ONE PLACE.

   They used to be written at four call sites with four slightly different
   opinions, which is how one of them kept a version string the others never
   had. One writer means one answer. */
function applyProjectIdentity() {
  const title = P?.meta?.title || "";
  const heading = document.getElementById("project-title");
  if (heading) {
    heading.textContent = title || "Projects";
    heading.setAttribute(
      "aria-label",
      title ? `Open the project menu — ${title} is open` : "Open the project menu",
    );
  }
  /* FORMAT ONLY. What the project is being made as is a filmmaker's fact and
     belongs under the title. `P.meta.version` is deliberately absent: see the
     block comment above, and tests/shell-identity.js, which fails if it comes
     back. It remains readable in About under Technical details, where a record
     field is understood as a record field. */
  const format = document.getElementById("project-format");
  if (format) format.textContent = P?.meta?.format || "";
  const topbar = document.getElementById("topbar-project");
  if (topbar) topbar.textContent = title || "CineBraid";
  if (PROJECT_MENU_OPEN) renderProjectMenu();
}

/* ---------------------------------------------------------------------------
   APPLICATION IDENTITY.

   Asked for once, because it cannot change while this page is loaded, and never
   assumed: until the answer arrives the foot says "CineBraid" and About says the
   identity is unavailable. A window that cannot reach its own server is allowed
   to say so; it is not allowed to make a version up. */
let APP_IDENTITY = null;
let APP_IDENTITY_STATE = "pending"; /* pending | ready | unavailable */

function appReleaseLabel() {
  const version = APP_IDENTITY?.app?.version || "";
  return version ? `CineBraid ${version}` : "CineBraid";
}
function appBuildLabel() {
  /* PENDING IS NOT UNAVAILABLE. The request is answered in a millisecond by a
     server on this machine, so nobody will see this — but "unavailable" is a
     claim about a request that has FINISHED, and saying it about one still in
     flight is the same species of small untruth this whole slice is removing. */
  if (APP_IDENTITY_STATE === "pending") return "";
  if (APP_IDENTITY_STATE !== "ready") return "Build identity unavailable";
  return APP_IDENTITY?.build?.label || "Development build";
}
function renderAppIdentity() {
  const line = document.getElementById("app-identity");
  if (line) line.textContent = appReleaseLabel();
  if (PROJECT_MENU_OPEN) renderProjectMenu();
}
async function loadAppIdentity() {
  try {
    const response = await fetch("/api/app-identity", { cache: "no-store" });
    const data = response.ok ? await response.json() : null;
    /* A shape check rather than a truthiness check: an empty object from a
       stubbed or older server has to read as "unavailable", not as a CineBraid
       with no version. */
    if (data && data.app && typeof data.app.version === "string" && data.app.version) {
      APP_IDENTITY = data;
      APP_IDENTITY_STATE = "ready";
    } else {
      APP_IDENTITY = null;
      APP_IDENTITY_STATE = "unavailable";
    }
  } catch {
    APP_IDENTITY = null;
    APP_IDENTITY_STATE = "unavailable";
  }
  renderAppIdentity();
}

/* ---------------------------------------------------------------------------
   THE PROJECT MENU.

   The title was already a button; it opened the full project-management dialog
   directly. That dialog is the right surface for archiving, deleting and
   restoring, and it stays exactly as it is — this menu neither replaces it nor
   reimplements any of it. What was missing was somewhere smaller to stand: a
   filmmaker who wants to check which project is open, jump to its settings, or
   find out which CineBraid this is should not have to open a window listing
   every project they have ever deleted.

   EVERY ENTRY IS AN ACTION THE PRODUCT ALREADY HAS. Nothing here is a new
   project capability, and nothing here is a second Settings. */
let PROJECT_MENU_OPEN = false;
let PROJECT_MENU_DISMISS = null;

function projectMenuActions() {
  const open = Boolean(P?.meta);
  return [
    { label: "Project settings", detail: "Title, format, aspect ratio and world", run: "openProjectSettingsFromMenu()", enabled: open },
    { label: "Switch project", detail: "Open, archive or restore a project", run: "openProjectSwitcherFromMenu()", enabled: true },
    { label: "New project", detail: "Start another project alongside this one", run: "newProjectFromMenu()", enabled: true },
    { label: "About CineBraid", detail: "Version and build details", run: "openAboutCineBraid()", enabled: true },
  ];
}

function renderProjectMenu() {
  const menu = document.getElementById("project-menu");
  if (!menu) return;
  const title = P?.meta?.title || "";
  const format = P?.meta?.format || "";
  const head = title
    ? `<div class="project-menu-head cb-section"><span class="cb-section-kicker">CURRENT PROJECT</span><b class="cb-section-title">${esc(title)}</b>${format ? `<span class="cb-help">${esc(format)}</span>` : ""}</div>`
    : `<div class="project-menu-head cb-empty"><b>No project open</b><span class="cb-help">Open one from Switch project, or start a new one.</span></div>`;
  const items = projectMenuActions()
    .map((action) => `<button type="button" class="cb-action" data-emphasis="quiet" data-project-menu-item="1"${action.enabled ? "" : " disabled"} onclick="${attr(action.run)}"><b>${esc(action.label)}</b><small>${esc(action.detail)}</small></button>`)
    .join("");
  /* The application's own identity, at the bottom, in the small type it earns.
     It is a different subject from everything above it, which is why it sits
     under a rule rather than in the action list. */
  const build = appBuildLabel();
  const identity = `<div class="project-menu-foot cb-meta"><span>${esc(appReleaseLabel())}</span>${build ? `<span>${esc(build)}</span>` : ""}</div>`;
  menu.innerHTML = `${head}<div class="project-menu-actions">${items}</div>${identity}`;
}

function projectMenuItems() {
  const menu = document.getElementById("project-menu");
  return [...(menu?.querySelectorAll?.("[data-project-menu-item]:not([disabled])") || [])];
}

function openProjectMenu({ focusFirst = true } = {}) {
  const menu = document.getElementById("project-menu");
  const button = document.getElementById("project-title");
  if (!menu || !button) return;
  renderProjectMenu();
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  PROJECT_MENU_OPEN = true;
  /* Dismissal is registered on the document rather than on the menu, because
     the ways a menu should close are mostly things that happen somewhere else:
     a click on the workspace, Escape from anywhere, a Tab that leaves it. */
  if (!PROJECT_MENU_DISMISS) {
    PROJECT_MENU_DISMISS = {
      click: (event) => {
        if (!PROJECT_MENU_OPEN) return;
        const inside = event.target?.closest?.(".project-owner");
        if (!inside) closeProjectMenu({ returnFocus: false });
      },
      keydown: (event) => {
        if (!PROJECT_MENU_OPEN) return;
        if (event.key === "Escape") {
          /* Stopped here so the shared handler in public/review.js does not read
             the same Escape as "close the dialog"; there is no dialog open, and
             a menu that dismissed the modal behind it would be a surprise. */
          event.stopPropagation();
          closeProjectMenu();
          return;
        }
        /* Tab is allowed to do what Tab does. The popover is not modal, so it
           closes when focus has actually LEFT it rather than on the first press:
           read after the default has moved focus, which is the only moment the
           question "is focus still in here?" has an answer. */
        if (event.key === "Tab") {
          setTimeout(() => {
            if (!PROJECT_MENU_OPEN) return;
            const owner = document.getElementById("project-menu")?.closest?.(".project-owner");
            if (!owner?.contains?.(document.activeElement)) closeProjectMenu({ returnFocus: false });
          }, 0);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = projectMenuItems();
        if (!items.length) return;
        event.preventDefault();
        const at = items.indexOf(document.activeElement);
        const next =
          event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (at + 1 + items.length) % items.length
          : (at - 1 + items.length) % items.length;
        items[next]?.focus?.();
      },
    };
    document.addEventListener("click", PROJECT_MENU_DISMISS.click);
    document.addEventListener("keydown", PROJECT_MENU_DISMISS.keydown, true);
  }
  if (focusFirst) setTimeout(() => projectMenuItems()[0]?.focus?.(), 0);
}

function closeProjectMenu({ returnFocus = true } = {}) {
  const menu = document.getElementById("project-menu");
  const button = document.getElementById("project-title");
  PROJECT_MENU_OPEN = false;
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
  if (PROJECT_MENU_DISMISS) {
    document.removeEventListener?.("click", PROJECT_MENU_DISMISS.click);
    document.removeEventListener?.("keydown", PROJECT_MENU_DISMISS.keydown, true);
    PROJECT_MENU_DISMISS = null;
  }
  if (returnFocus) button?.focus?.();
}

window.toggleProjectMenu = (options = {}) =>
  PROJECT_MENU_OPEN ? closeProjectMenu() : openProjectMenu(options);

/* The menu is a way IN to surfaces that already exist, so it gets out of the way
   before they open — otherwise a dialog would appear with a menu standing behind
   it. Focus goes back to the title button on the way out, and NOT because the
   menu is fussy about focus: openModal() records document.activeElement as the
   element to restore when the dialog closes, so leaving focus on a menu item
   that is now hidden is how Escape from About would drop the caller on <body>. */
window.openProjectSettingsFromMenu = () => {
  closeProjectMenu();
  /* Assigned, not routed. The navigation buttons in the rail do exactly this and
     let the hashchange listener render; a route() here would paint twice on every
     use, and do nothing extra on the one case where the hash is already #/settings
     — which is a person asking for the page they are already looking at. */
  location.hash = "#/settings";
};
window.openProjectSwitcherFromMenu = () => {
  closeProjectMenu();
  openProjectSwitcher();
};
window.newProjectFromMenu = () => {
  closeProjectMenu();
  newProject();
};

/* ABOUT — the one place the machinery is allowed to be visible.

   Two lines a person might quote in a bug report, and everything else folded
   away. The fold is where project record metadata lives: `meta.version`, the
   schema markers and the folder name are all diagnostic truth, and none of them
   is an application version, so this is where they can be read without being
   mistaken for one. */
window.openAboutCineBraid = () => {
  closeProjectMenu();
  const build = APP_IDENTITY?.build || null;
  const ready = APP_IDENTITY_STATE === "ready";
  const rows = [
    ["Release channel", ready ? APP_IDENTITY.app.channel || "stable" : "unavailable"],
    ["Build source", ready ? build?.source || "development" : "unavailable"],
    ["Build identifier", ready ? (build?.supplied ? build.id : "not supplied — development build") : "unavailable"],
    ["Project record version", P?.meta?.version || "—"],
    ["Project schema", `${P?.meta?.hubVersion || "—"} · ${P?.meta?.schemaVersion || "—"}`],
    ["Project folder", ACTIVE_PROJECT_SLUG || "—"],
  ];
  openModal(`<div class="about-cinebraid">
    <header class="cb-section"><span class="cb-section-kicker">ABOUT</span><h3 class="cb-section-title">CineBraid</h3><p class="cb-help">Which application you are running, and which build of it. A project's own version and schema belong to the project record and are listed separately below.</p></header>
    <div class="cb-meta about-identity"><span><b>Version</b>${esc(ready ? APP_IDENTITY.app.version : "unavailable")}</span><span><b>Build</b>${esc(appBuildLabel() || "checking…")}</span></div>
    ${ready ? "" : `<p class="cb-help">CineBraid could not read its own identity from this server. Reload the page; if it stays unavailable, this window is not talking to the server it was served from.</p>`}
    <details class="cb-disclosure"><summary>Technical details</summary><div class="cb-meta cb-meta-stack">${rows.map(([label, value]) => `<span><b>${esc(label)}</b>${esc(value)}</span>`).join("")}</div></details>
    <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>
  </div>`);
};

/* The title is the project menu's button. The full project-management dialog is
   still reachable, from inside the menu, unchanged. */
$("#project-title").onclick = () => toggleProjectMenu();
$("#project-title").onkeydown = (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  if (!PROJECT_MENU_OPEN) openProjectMenu();
};
/* Asked for once, at load, because it cannot change while this page is open. */
loadAppIdentity();
window.requestArchiveProject = (slug, title) => {
  confirmModal(`Archive “${title}”? It will disappear from the active project list but can be restored from this same window.`, async () => {
    try {
      await flushPendingProjectSave();
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/archive`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not archive project");
      location.hash = "#/production";
      await load();
      toast("Project archived");
    } catch (error) { toast(error.message || "Could not archive project"); }
  }, { title: "Archive project", confirmLabel: "ARCHIVE PROJECT" });
};
window.restoreArchivedProject = async (archiveName) => {
  try {
    const response = await fetch(`/api/projects/archive/${encodeURIComponent(archiveName)}/restore`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not restore project");
    closeModal();
    await openProjectSwitcher();
    toast(`Restored ${data.slug}`);
  } catch (error) { toast(error.message || "Could not restore project"); }
};
window.restoreTrashedProject = async (trashName) => {
  try {
    const response = await fetch(`/api/projects/trash/${encodeURIComponent(trashName)}/restore`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not restore deleted project");
    closeModal();
    await openProjectSwitcher();
    toast(`Restored ${data.slug}`);
  } catch (error) { toast(error.message || "Could not restore deleted project"); }
};
window.requestDeleteProject = (slug, title) => {
  confirmModal(
    `Delete “${title}”? CineBraid will close it and move the complete project folder to recoverable trash. You can restore it later from Project Management.`,
    async () => {
      try {
        await flushPendingProjectSave();
        const response = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not delete project");
        location.hash = "#/production";
        await load();
        toast("Project moved to trash");
      } catch (error) { toast(error.message || "Could not delete project"); }
    },
    { title: "Delete project", confirmLabel: "DELETE PROJECT" },
  );
};
/* Switching is atomic at the application-state level. The server refuses to activate a project
   it cannot read, and if the load still fails afterwards the active project is put back before
   anything is shown, so the interface and the server never disagree about which project is open
   and a later edit cannot be written into the project that failed. */
window.switchProject = async (slug) => {
  const previousSlug = ACTIVE_PROJECT_SLUG;
  clearProjectSwitcherError();
  try {
    await flushPendingProjectSave();
  } catch {
    /* the save chain reports its own failure; the switch below is still refused or rolled back */
  }
  let response, data;
  try {
    response = await fetch("/api/projects/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    data = await response.json().catch(() => ({}));
  } catch (error) {
    return showProjectSwitcherError(
      { error: error.message || "Could not reach CineBraid to switch project." },
      slug,
    );
  }
  if (!response.ok) return showProjectSwitcherError(data, slug);
  location.hash = "#/production";
  try {
    await load();
  } catch (error) {
    await rollbackProjectSwitch(previousSlug);
    return showProjectSwitcherError(
      { error: error.message, projectFailure: error.projectFailure },
      slug,
    );
  }
  closeModal();
  toast("Switched project");
};
/* Put the previously active project back after a post-switch load failure. If even that fails
   there is no readable project left, so fall back to the recovery screen rather than leaving
   the server pointing somewhere the interface is not. */
async function rollbackProjectSwitch(previousSlug) {
  if (!previousSlug) return;
  try {
    const response = await fetch("/api/projects/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: previousSlug }),
    });
    if (!response.ok) throw new Error("Could not reopen the previous project.");
    await load();
    await openProjectSwitcher();
  } catch (error) {
    markProjectLoadFailure(error.projectFailure);
    renderProjectFailureScreen(error.projectFailure, error.message);
  }
}
/* THE DELIVERY SHAPES A PROJECT IS ACTUALLY MADE IN. Suggestions with a free-text
   escape, exactly like the aspect presets beside them: the value is still the same
   `meta.format` string the record has always carried and shared-aspect.js still
   parses, so nothing new is persisted to make the control readable. */
const PROJECT_FORMAT_PRESETS = Object.freeze([
  ["", "Not decided yet"],
  ["Short film", "Short film"],
  ["Feature film", "Feature film"],
  ["Series episode", "Series episode"],
  ["Commercial", "Commercial"],
  ["Music video", "Music video"],
  ["Documentary", "Documentary"],
  ["Social / vertical", "Social / vertical"],
]);
/* THE THREE STARTING INTENTS, in the words the create screen uses. The stored value
   is the intent key the creation studio reads, so the modal and the chooser cannot
   drift into describing different paths. */
const PROJECT_START_INTENTS = Object.freeze([
  ["assisted", "Build with an AI assistant — Recommended"],
  ["cinebraid", "Open a CineBraid project file"],
  ["scratch", "Start manually"],
]);
window.newProject = () =>
  formModal(
    "New CineBraid project",
    [
      { k: "title", label: "Project title", ph: "The Black Lantern" },
      {
        k: "startMode",
        label: "How do you want to begin?",
        type: "select",
        options: PROJECT_START_INTENTS,
        value: "assisted",
      },
      {
        k: "format",
        label: "Format",
        type: "select",
        options: PROJECT_FORMAT_PRESETS,
        value: "",
        hint: "What this project is being made as. Change it any time in Settings → Project.",
      },
      {
        k: "aspectRatio",
        label: "Default aspect ratio",
        type: "select",
        options: [["", "Decide later — CineBraid shows 16:9"], ...CINEBRAID_ASPECT_PRESETS],
        value: "",
        hint: "The shape every shot is judged and generated in unless a shot overrides it.",
      },
    ],
    /* The global visual style is NOT asked for here any more. It shapes prompts that
       do not exist yet on a project with no references and no shots, so demanding it
       at creation asked the filmmaker to decide the look of a film before its first
       scene. It is offered on the create screen and editable in Settings → Project;
       the endpoint still accepts it, so nothing about the capability changed. */
    async (v) => {
      try {
        await flushPendingProjectSave();
      } catch (error) {
        return toast(error.message || "Save the current project before creating another one");
      }
      const r = await fetch("/api/projects/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: v.title || "New Project",
          format: v.format || "",
          aspectRatio: v.aspectRatio || "",
        }),
      });
      const d = await r.json();
      if (!r.ok) return toast(d.error || "Could not create project");
      const intent = PROJECT_START_INTENTS.some(([key]) => key === v.startMode) ? v.startMode : "assisted";
      localStorage.setItem("cinebraid-creation-start-path", intent);
      /* A new project has no import behind it, so it gets no import landing — and a
         landing left over from the last one must not sit on top of it. */
      window.__cinebraidProjectEntryLanding = null;
      location.hash = "#/create";
      await load();
      toast("Project created");
    },
  );

/* ---------- modal helpers ---------- */
let AGENT_RESULT_MODAL_TIMER = null;
let MODAL_RETURN_FOCUS = null;
let MODAL_KEY_HANDLER = null;
let MODAL_SCROLL_Y = 0;
let MODAL_ANCHOR_TOP = null;
function modalFocusable(root) {
  return [...(root?.querySelectorAll?.('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
    .filter((el) => !el.hidden && el.offsetParent !== null);
}
function openModal(inner) {
  const m = $("#modal");
  if (!m) return;
  /* A pointer click on a thumbnail does not always leave the trigger focused, so
     fall back to the element that dispatched the event still being handled. That
     is what lets Escape hand focus back to the thumbnail that was enlarged. */
  const dispatching = window.event?.currentTarget || window.event?.target?.closest?.("button, a[href], [tabindex]:not([tabindex='-1'])") || null;
  MODAL_RETURN_FOCUS = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : (dispatching && typeof dispatching.focus === "function" ? dispatching : null);
  MODAL_SCROLL_Y = Number(window.scrollY || document.documentElement?.scrollTop || 0);
  const modalAnchor = MODAL_RETURN_FOCUS?.closest?.("details.asset-creation-card, details.entity-state-generation, .settings-block, .shot-main");
  MODAL_ANCHOR_TOP = modalAnchor?.getBoundingClientRect?.().top ?? null;
  let content = String(inner || "");
  if (/<h3\b/i.test(content)) content = content.replace(/<h3\b(?![^>]*\bid=)/i, '<h3 id="cinebraid-modal-title"');
  else content = `<h3 id="cinebraid-modal-title" class="sr-only">Dialog</h3>${content}`;
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="cinebraid-modal-title">${content}</div>`;
  m.classList.remove("hidden");
  /* Modal content never goes through route(), so its reference imagery is bound here. */
  bindIntrinsicAspect(m);
  m.onclick = (event) => { if (event.target === m) closeModal(); };
  if (MODAL_KEY_HANDLER) m.removeEventListener?.("keydown", MODAL_KEY_HANDLER);
  MODAL_KEY_HANDLER = (event) => {
    if (event.key !== "Tab") return;
    const focusable = modalFocusable(m);
    if (!focusable.length) return event.preventDefault();
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  m.addEventListener?.("keydown", MODAL_KEY_HANDLER);
  setTimeout(() => {
    const target = m.querySelector?.("[autofocus], input, textarea, select, button, a[href], [tabindex]:not([tabindex='-1'])");
    target?.focus?.();
  }, 0);
}
/* O5 added the fourth argument and nothing else. `returnTo` is a production-media
   projection key: when the theatre was opened FROM the Universal Media Inspector, the
   way back is rendered so that looking at the picture larger does not cost the
   filmmaker the identity they were inspecting. Every one of the shipped call sites
   passes three arguments and is unaffected — absent means there is nowhere to go
   back to, which is the honest default for a thumbnail's own enlarge button. */
window.openMediaTheatre = (encodedUrl, encodedTitle = "Preview", kind = "", returnTo = "") => {
  let url = "", title = "Preview";
  try { url = decodeURIComponent(String(encodedUrl || "")); } catch { url = String(encodedUrl || ""); }
  try { title = decodeURIComponent(String(encodedTitle || "Preview")); } catch { title = String(encodedTitle || "Preview"); }
  if (!url) return toast("Preview media is unavailable");
  const mediaKind = kind || (isVideo(title) || /\.(mp4|webm|mov)(?:$|[?#])/i.test(url) ? "video" : "image");
  const media = mediaKind === "video"
    ? `<video controls autoplay playsinline preload="metadata" src="${attr(url)}"></video>`
    : mediaKind === "audio"
      ? `<audio controls autoplay preload="metadata" src="${attr(url)}"></audio>`
      : `<img src="${attr(url)}" alt="Enlarged view of ${attr(title)}">`;
  const back = String(returnTo || "")
    ? `<button class="ghost-btn" data-theatre-return="1" onclick="window.inspectMedia('${attr(returnTo)}')">Back to inspector</button>`
    : "";
  openModal(`<div class="media-theatre-modal" aria-label="Enlarged view of ${attr(title)}"><header><div><span>MEDIA PREVIEW</span><h3>${esc(title)}</h3><p>Large in-app inspection without leaving the shot workspace. Press Escape or Close to return.</p></div><button class="cancel" onclick="closeModal()" aria-label="Close the enlarged view of ${attr(title)}">Close</button></header><div class="media-theatre-stage">${media}</div><footer><span>${mediaKind === "video" ? "Use the player controls to review motion and audio." : mediaKind === "audio" ? "Use the player controls to review the audio." : "The complete source image, fitted to the workspace without cropping."}</span><div class="media-theatre-footer-actions">${back}<a class="ghost-btn" href="${attr(url)}" target="_blank" rel="noopener">Open original</a></div></footer></div>`);
};

window.closeModal = () => {
  if (AGENT_RESULT_MODAL_TIMER) {
    clearTimeout(AGENT_RESULT_MODAL_TIMER);
    AGENT_RESULT_MODAL_TIMER = null;
  }
  const m = $("#modal");
  if (!m) return;
  m.classList.add("hidden");
  m.onclick = null;
  if (MODAL_KEY_HANDLER) m.removeEventListener?.("keydown", MODAL_KEY_HANDLER);
  MODAL_KEY_HANDLER = null;
  const returnFocus = MODAL_RETURN_FOCUS;
  const returnScroll = MODAL_SCROLL_Y;
  const returnAnchorTop = MODAL_ANCHOR_TOP;
  MODAL_RETURN_FOCUS = null;
  MODAL_ANCHOR_TOP = null;
  setTimeout(() => {
    if (Number.isFinite(returnScroll)) window.scrollTo?.(0, returnScroll);
    returnFocus?.focus?.({ preventScroll: true });
    const anchor = returnFocus?.closest?.("details.asset-creation-card, details.entity-state-generation, .settings-block, .shot-main");
    if (anchor && Number.isFinite(returnAnchorTop)) {
      const delta = anchor.getBoundingClientRect().top - returnAnchorTop;
      if (Math.abs(delta) > 1) window.scrollBy?.(0, delta);
    }
  }, 0);
};
function confirmModal(message, onConfirm, options = {}) {
  const title = options.title || "Confirm action";
  const confirmLabel = options.confirmLabel || "CONFIRM";
  const danger = options.danger !== false;
  const content = options.html === true
    ? `<div class="modal-confirm-message">${String(message || "")}</div>`
    : `<p class="modal-confirm-message">${esc(message)}</p>`;
  openModal(`<h3>${esc(title)}</h3>${content}<div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="${danger ? "danger-btn" : "lock-btn"}" id="modal-confirm-action">${esc(confirmLabel)}</button></div>`);
  setTimeout(() => {
    const button = document.getElementById("modal-confirm-action");
    if (button) button.onclick = () => { closeModal(); onConfirm?.(); };
  }, 0);
}
window.confirmModal = confirmModal;

let LAST_TEST_NOTE_EXPORT = null;
window.openTestNote = async () => {
  let savedCount = 0;
  try {
    const response = await fetch("/api/test-feedback", { cache: "no-store" });
    const data = response.ok ? await response.json() : { notes: [] };
    savedCount = Array.isArray(data.notes) ? data.notes.length : 0;
  } catch (_) {}
  openModal(`<div class="test-note-modal"><h3>Leave feedback</h3><p>Capture what was confusing while you are still looking at it. CineBraid saves the note on this computer along with the page you were on and a short project summary. Nothing is sent anywhere automatically.</p><label><span>What happened?</span><textarea id="cinebraid-test-note" autofocus placeholder="What did you expect, what happened instead, or which term or button needed explaining?"></textarea></label><small>${savedCount ? `${plural(savedCount, "note")} already saved in this project.` : "No feedback saved in this project yet."}</small><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="saveTestNote()">Save note</button></div></div>`);
};
window.saveTestNote = async () => {
  const note = String(document.getElementById("cinebraid-test-note")?.value || "").trim();
  if (!note) return toast("Write your feedback first");
  const response = await fetch("/api/test-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, route: location.hash || "#/production" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return toast(data.error || "Could not save your feedback");
  LAST_TEST_NOTE_EXPORT = data;
  const summary = data.record?.projectSummary || {};
  openModal(`<div class="test-note-modal saved"><h3>Feedback saved on this computer</h3><p>File paths and keys were removed from the note before it was saved. Copy or download it when you are ready to share it.</p><div class="test-note-context"><span>${esc(data.record?.route || location.hash || "#/production")}</span><b>${Number(summary.shots || 0)} shots · ${plural(Number(summary.entities || 0), "reference")} · ${Number(summary.openReadinessIssues || 0)} readiness issues</b></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="ghost-btn" onclick="copySavedTestNote()">Copy note</button><button class="approve-btn" onclick="downloadSavedTestNote()">Download note</button></div></div>`);
};
window.copySavedTestNote = async () => {
  const text = String(LAST_TEST_NOTE_EXPORT?.markdown || "");
  if (!text) return toast("No saved feedback is open");
  try { await navigator.clipboard.writeText(text); toast("Feedback copied"); }
  catch { toast("Could not copy the feedback"); }
};
window.downloadSavedTestNote = () => {
  const text = String(LAST_TEST_NOTE_EXPORT?.markdown || ""), id = String(LAST_TEST_NOTE_EXPORT?.record?.id || "cinebraid-test-note");
  if (!text) return toast("No saved feedback is open");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  link.download = `${id}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

/* A `select` option is either a bare string — every caller that existed before
   Batch 2 Slice 2 — or a [value, label] pair, where the value is what gets stored and
   the label is what the filmmaker reads. The pair form is what lets a control be
   TYPED without inventing somewhere new to keep the answer: "16:9 — widescreen" on
   screen, `16:9` into the same `meta.aspectRatio` string the product already parses.
   `hint` renders the one sentence a typed control needs to stay honest about what it
   does, and is absent on every field that had none. */
function formModalOption(option, selected) {
  const value = Array.isArray(option) ? String(option[0]) : String(option);
  const label = Array.isArray(option) ? String(option[1]) : String(option);
  return `<option value="${attr(value)}" ${value === String(selected == null ? "" : selected) ? "selected" : ""}>${esc(label)}</option>`;
}
function formModal(title, fields, onSubmit) {
  window._formSubmit = () => {
    const vals = {};
    fields.forEach((f) => (vals[f.k] = $("#ff-" + f.k).value));
    closeModal();
    onSubmit(vals);
  };
  openModal(`<h3>${esc(title)}</h3>
    ${fields
      .map(
        (f) => `<div class="form-field"><label for="ff-${attr(f.k)}">${esc(f.label)}</label>
      ${
        f.type === "textarea"
          ? `<textarea id="ff-${f.k}" ${f.ph ? `placeholder="${attr(f.ph)}"` : ""}>${esc(f.value || "")}</textarea>`
          : f.type === "select"
            ? `<select id="ff-${f.k}">${f.options.map((o) => formModalOption(o, f.value)).join("")}</select>`
            : `<input id="ff-${f.k}" value="${attr(f.value || "")}" ${f.ph ? `placeholder="${attr(f.ph)}"` : ""}>`
      }${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</div>`,
      )
      .join("")}
    <div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button>
      <button class="lock-btn" onclick="_formSubmit()">SAVE</button></div>`);
  setTimeout(() => $("#ff-" + fields[0].k)?.focus(), 30);
}

/* ---------- routing ---------- */
document.querySelectorAll(".nav-btn[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      location.hash = "#/" + b.dataset.view;
      document.body.classList.remove("rail-open");
    }),
);
$("#rescan").onclick = async () => {
  SCAN = await (await fetch("/api/scan")).json();
  toast("Local folders synced");
  route();
};

$("#mobile-nav").onclick = () => document.body.classList.toggle("rail-open");
$("#global-add").onclick = () => openGlobalAdd();
window.addEventListener("hashchange", route);
function productionCount() {
  return P ? P.shots.filter((shot) => !shotIsDelivered(shot)).length : 0;
}
function updateChrome(view, navName) {
  const active = document.querySelector(`.nav-btn[data-view="${navName}"]`);
  const labels = {
    scene: "Scene",
    shot: "Shot",
    character: "Character",
    location: "Location",
    prop: "Prop",
    vehicle: "Vehicle",
    sound: "Audio asset",
    production: "Production",
    shots: "Shots",
    library: "References",
    results: "Generated Media",
    create: "New Project",
    reports: "Reports",
    settings: "Settings",
  };
  $("#topbar-view").textContent =
    labels[view] || active?.dataset.label || "CineBraid";
  $("#topbar-project").textContent = P.meta.title || "Untitled project";
  const work = productionCount();
  const workBadge = $("#production-nav-count");
  if (workBadge) {
    workBadge.textContent = work;
    workBadge.classList.toggle("hidden", !work);
  }
}
function routeSelectorValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function routeFocusSelector(element) {
  if (!element || element === document.body) return "";
  try {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const composerId = element.dataset?.composerElement;
    if (composerId) return `[data-composer-element="${routeSelectorValue(composerId)}"]`;
    const focusKey = element.dataset?.focusKey;
    if (focusKey) return `[data-focus-key="${routeSelectorValue(focusKey)}"]`;
    if (element.name) return `${String(element.tagName || "").toLowerCase()}[name="${routeSelectorValue(element.name)}"]`;
    for (const attrName of ["onchange", "oninput", "onclick"]) {
      const value = element.getAttribute?.(attrName);
      if (value) return `${String(element.tagName || "").toLowerCase()}[${attrName}="${routeSelectorValue(value)}"]`;
    }
  } catch {}
  return "";
}
function currentRouteKey() {
  const hash = String(location.hash || "#/production").split("?")[0];
  return `${ACTIVE_PROJECT_SLUG || "project"}:${hash || "#/production"}`;
}
function routeDetailsBaseKey(element) {
  if (!element) return "";
  const explicit = element.dataset?.uiStateKey || element.id;
  if (explicit) return `explicit:${explicit}`;
  for (const name of ["frameId", "guidedPanel", "entityStateGeneration", "entityContinuity", "composerElement", "focusKey"]) {
    const value = element.dataset?.[name];
    if (value) return `${name}:${value}`;
  }
  const toggle = String(element.getAttribute?.("ontoggle") || "").replace(/\s+/g, " ").trim();
  if (toggle) return `toggle:${toggle}`;
  const classes = String(element.className || "").split(/\s+/).filter(Boolean).sort().join(".");
  if (classes) return `details-class:${classes}`;
  const summary = String(element.querySelector?.(":scope > summary")?.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `details-summary:${summary}`;
}
function routeDetailsEntries(main) {
  const counts = new Map();
  return [...(main?.querySelectorAll?.("details") || [])].map((element) => {
    const base = routeDetailsBaseKey(element);
    const occurrence = counts.get(base) || 0;
    counts.set(base, occurrence + 1);
    return { element, key: `${base}::${occurrence}` };
  });
}
function routeViewAnchor(main, entries, active) {
  const activeDetails = active?.closest?.("details");
  const activeEntry = entries.find((entry) => entry.element === activeDetails);
  const mainRect = main?.getBoundingClientRect?.();
  if (activeEntry && mainRect) {
    return {
      key: activeEntry.key,
      offset: activeEntry.element.getBoundingClientRect().top - mainRect.top,
    };
  }
  if (!mainRect) return { key: "", offset: 0 };
  const visible = entries
    .map((entry) => ({ entry, rect: entry.element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > mainRect.top + 1 && rect.top < mainRect.bottom - 1)
    .sort((a, b) => Math.abs(a.rect.top - mainRect.top) - Math.abs(b.rect.top - mainRect.top))[0];
  return visible
    ? { key: visible.entry.key, offset: visible.rect.top - mainRect.top }
    : { key: "", offset: 0 };
}
function captureRouteViewState(targetRouteKey = currentRouteKey()) {
  try {
    if (!CURRENT_RENDER_ROUTE_KEY || CURRENT_RENDER_ROUTE_KEY !== targetRouteKey) return null;
    const main = $("#main"), active = document.activeElement;
    const details = routeDetailsEntries(main);
    const anchor = routeViewAnchor(main, details, active);
    return {
      routeKey: targetRouteKey,
      mainScrollTop: Number(main?.scrollTop || 0),
      mainScrollLeft: Number(main?.scrollLeft || 0),
      windowX: Number(window.scrollX || 0),
      windowY: Number(window.scrollY || 0),
      selector: routeFocusSelector(active),
      selectionStart: Number.isFinite(active?.selectionStart) ? active.selectionStart : null,
      selectionEnd: Number.isFinite(active?.selectionEnd) ? active.selectionEnd : null,
      selectionDirection: active?.selectionDirection || "none",
      disclosureState: Object.fromEntries(details.map(({ key, element }) => [key, !!element.open])),
      anchorKey: anchor.key,
      anchorOffset: anchor.offset,
    };
  } catch { return null; }
}
function applyRouteDisclosureState(state) {
  if (!state?.disclosureState) return new Map();
  const entries = routeDetailsEntries($("#main"));
  const map = new Map(entries.map((entry) => [entry.key, entry.element]));
  entries.forEach(({ key, element }) => {
    if (Object.prototype.hasOwnProperty.call(state.disclosureState, key))
      element.open = !!state.disclosureState[key];
  });
  return map;
}
function restoreRouteViewState(state) {
  if (!state) return;
  const token = ++ROUTE_VIEW_RESTORE_TOKEN;
  const main = $("#main");
  const details = applyRouteDisclosureState(state);
  try {
    if (main) {
      main.scrollTop = state.mainScrollTop || 0;
      main.scrollLeft = state.mainScrollLeft || 0;
    }
    if (typeof window.scrollTo === "function") window.scrollTo(state.windowX || 0, state.windowY || 0);
  } catch {}
  const finish = () => {
    if (token !== ROUTE_VIEW_RESTORE_TOKEN || currentRouteKey() !== state.routeKey) return;
    try {
      const currentMain = $("#main");
      const rememberedAnchor = details.get(state.anchorKey);
      const anchor = state.anchorKey ? ((rememberedAnchor?.isConnected ? rememberedAnchor : null) || new Map(routeDetailsEntries(currentMain).map((entry) => [entry.key, entry.element])).get(state.anchorKey)) : null;
      if (currentMain && anchor) {
        const currentOffset = anchor.getBoundingClientRect().top - currentMain.getBoundingClientRect().top;
        const delta = currentOffset - Number(state.anchorOffset || 0);
        if (Math.abs(delta) > 1) currentMain.scrollTop += delta;
      }
      const target = state.selector ? document.querySelector(state.selector) : null;
      if (target?.focus) {
        target.focus({ preventScroll: true });
        if (state.selectionStart != null && typeof target.setSelectionRange === "function")
          target.setSelectionRange(state.selectionStart, state.selectionEnd ?? state.selectionStart, state.selectionDirection || "none");
      }
    } catch {}
  };
  if (typeof requestAnimationFrame === "function")
    requestAnimationFrame(() => requestAnimationFrame(finish));
  else setTimeout(finish, 0);
}
/* `body[data-render-ready]` — THE FLAG THAT SAID YES WHILE IT WAS STILL RENDERING.
 *
 * public/bootstrap.js sets `renderReady` once, after the first `load()` resolves, and
 * nothing has ever cleared it again. It therefore answered "ready" for the rest of the
 * session, including in the middle of a route change — and eight real-browser suites
 * wait on exactly that flag before reading the page.
 *
 * tests/production-media-real-browser.py section 11 is where that became a failure the
 * founder would recognise: it navigates to a shot, waits for the flag, and asks for the
 * stage-local media handoff. Because the flag was already "1" from boot and a hash-only
 * `page.goto` does not reload the document, the wait returned instantly against the
 * PREVIOUS view's DOM and the handoff was reported missing on a build that renders it.
 * Measured on this machine: the handoff exists ~18ms after the hash changes on the
 * accepted baseline and on this branch alike, and the suite was reading before that.
 *
 * So the flag is armed per render now, which is what every suite already believes it
 * means. It is cleared when a render starts and restored when that render settles —
 * including on the failure path, because a workspace that failed to render has still
 * finished rendering and a suite must never be left waiting forever on it.
 *
 * The token guard is what keeps a superseded render from declaring the page ready
 * while the render that replaced it is still working. */
function markRouteRenderSettled(requestToken) {
  if (requestToken !== ROUTE_REQUEST_TOKEN) return;
  if (document.body?.dataset) document.body.dataset.renderReady = "1";
}
async function route(recoveryAttempt = false) {
  if (!P) return;
  const requestToken = ++ROUTE_REQUEST_TOKEN;
  if (document.body?.dataset) delete document.body.dataset.renderReady;
  try {
    const targetRouteKey = currentRouteKey();
    const routeParts = location.hash.split("/");
    const view = routeParts[1] || "production";
    const id = routeParts[2];
    /* Leaving Settings discards an unsaved appearance preview rather than letting it
       become permanent by accident. */
    if (view !== "settings" && APPEARANCE_PREVIEW) {
      APPEARANCE_PREVIEW = null;
      applyTheme();
    }
    const navName =
      {
        scene: "shots",
        shot: "shots",
        board: "shots",
        scenes: "shots",
        queue: "shots",
        runs: "runs",
        character: "library",
        location: "library",
        prop: "library",
        vehicle: "library",
        sound: "library",
        characters: "library",
        locations: "library",
        props: "library",
        vehicles: "library",
        audio: "library",
        sessions: "activity",
        canon: "sources",
      }[view] || view;
    document
      .querySelectorAll(".nav-btn[data-view]")
      .forEach((b) => b.classList.toggle("active", b.dataset.view === navName));
    updateChrome(view, navName);
    const routeViewState = captureRouteViewState(targetRouteKey);
    const fn = ROUTES[view] || ROUTES.production;
    const out = fn(decodeURIComponent(id || ""));
    const rendered = out instanceof Promise ? await out : out;
    if (requestToken !== ROUTE_REQUEST_TOKEN || targetRouteKey !== currentRouteKey()) {
      /* Superseded, or the hash moved under us. The render that replaced this one owns
         the flag; the guard inside makes this a no-op unless nothing replaced it. */
      markRouteRenderSettled(requestToken);
      return;
    }
    ROUTE_RENDER_IN_PROGRESS = true;
    $("#main").innerHTML = rendered;
    delete document.body.dataset.routeError;
    if (["canon", "sources"].includes(view) && window._docs?.length)
      openDoc(0, document.querySelector(".doc-tab"));
    if (view === "shot") {
      const shotId = decodeURIComponent(id || "");
      wireDropzone(shotId);
      wireShotWorkspace(shotId);
    }
    if (["character", "location", "prop", "vehicle", "sound"].includes(view))
      wireEntityDropzone(
        view === "sound" ? "audio" : view,
        decodeURIComponent(id || ""),
      );
    wireSearch();
    tally();
    /* The format can change under us — switching projects, or editing it in Settings —
       so it is reapplied with the view rather than only at load. */
    applyProductionFormat();
    bindIntrinsicAspect($("#main"));
    window.enhanceFocusedWorkspace?.();
    restoreRouteViewState(routeViewState);
    CURRENT_RENDER_ROUTE_KEY = targetRouteKey;
    ROUTE_RENDER_IN_PROGRESS = false;
    if (!routeViewState) {
      const main = $("#main");
      if (main) {
        main.scrollTop = 0;
        main.scrollLeft = 0;
      }
      if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
    }
    markRouteRenderSettled(requestToken);
    if (typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("cinebraid:route-rendered", { detail: { view, id: decodeURIComponent(id || "") } }));
  } catch (error) {
    ROUTE_RENDER_IN_PROGRESS = false;
    console.error("CineBraid route render failed:", error);
    document.body.dataset.routeError = error?.message || String(error);
    if (
      !recoveryAttempt &&
      window.__CINEBRAID_COMPOSER_607_READY &&
      typeof window.disableComposerEnhancements === "function"
    ) {
      window.disableComposerEnhancements(error, false);
      toast("Composer recovery mode enabled — restoring the stable workspace");
      /* The recovery render arms and settles the flag itself. */
      return route(true);
    }
    const message = esc(error?.message || String(error));
    const main = $("#main");
    if (main) {
      main.innerHTML = `<section class="empty-state route-recovery"><h2>This workspace could not render</h2><p>${message}</p><div class="modal-actions"><button class="add-btn" onclick="route()">Retry</button>${typeof window.reloadCineBraidSafe === "function" ? '<button class="ghost-btn" onclick="reloadCineBraidSafe()">Reload stable workspace</button>' : ""}</div><small>Your project data has not been deleted or replaced. The error is limited to the browser workspace.</small></section>`;
    }
    /* A failed render is a finished render. `data-route-error` says what happened;
       leaving the page permanently "not ready" would hang every waiter instead. */
    markRouteRenderSettled(requestToken);
  }
}

/* ---------- shared pieces ---------- */
function takesFor(id) {
  return SCAN.shots[id]?.takes || [];
}
/* mediaByPrefix() was here. It is DELETED rather than deprecated: Dogfood #2 A4
   was caused by it, and a prefix-matching media selector left in the file is a
   prefix-matching media selector a future caller will reach for. Ownership is
   answered by public/shared-entity-ownership.js and nowhere else. */
/* THE BADGE READS PROVENANCE NOW. Dogfood #2 A1: `APPROVED PICK` rendered from
   the presence of a winner alone, and scene automation could write that winner
   without anyone approving anything — so the board asserted a decision nobody had
   taken. Automation can no longer write the edge, but projects made before that
   repair still carry ones it did, and the board must not keep speaking for them.

   The run's own provenance record is the evidence: `approval: "director"` is a
   person, `"reused"` is a person's earlier decision, and `"automatic"` is not a
   decision at all. No record — the ordinary case for a manual approval — reads as
   approved, because the manual path is the one a person clicked through. */
function shotWinnerApprovalWord(s, name) {
  const wanted = String(name || "");
  if (!wanted) return "";
  let best = "";
  const rank = { director: 3, reused: 2, automatic: 1 };
  for (const entry of s?.generationRecords || []) {
    if (String(entry?.file || "") !== wanted && String(entry?.files || "") !== wanted) continue;
    const approval = String(entry?.approval || "");
    if (!rank[approval]) continue;
    if (!best || rank[approval] > rank[best]) best = approval;
  }
  return best;
}
/* THE BADGE ASKS THE LEDGER, NOT THE PROVENANCE RECORD.
 *
 * "APPROVED PICK" is the exact phrase the Dogfood #2 forensic audit found on a
 * machine-written edge, and it was still rendered from `shotWinnerApprovalWord`
 * — a word an automation RUN writes about itself. A pointer with no receipt is
 * HISTORIC and the badge says so; it is still shown, because it is real work the
 * creator can approve in one act. */
function shotWinnerBadgeMarkup(s, winner) {
  if (shotWinnerApprovalWord(s, winner?.name) === "automatic") {
    return '<span class="win-badge machine-pick" title="An automated run selected this. It is not an approval.">AUTOMATION PICK</span>';
  }
  const opening = (s?.keyframes || [])[0];
  const isCanon = typeof hasCurrentHumanAuthority === "function" && !!opening
    && hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: s.id, frameId: opening.id });
  return isCanon
    ? '<span class="win-badge">APPROVED PICK</span>'
    : '<span class="win-badge historic-pick" title="This image was selected but never approved as canon. Approve it to make it production truth.">HISTORIC PICK</span>';
}
function workflowState(s, takes = takesFor(s.id)) {
  const explicit = WORKFLOW_STATES.includes(s.workflowStatus)
    ? s.workflowStatus
    : "";
  let key = explicit;
  if (!key) {
    if (s.status === "LOCKED") key = "APPROVED";
    else if (s.reviewStatus === "CHANGES REQUESTED") key = "CHANGES REQUESTED";
    else if (anyWinnerTake(s, takes) || s.winner) key = "READY FOR REVIEW";
    else if (takes.length || s.status === "BUILT" || s.status === "NEEDS POST")
      key = "IN PROGRESS";
    else key = "DRAFT";
  }
  const cls = key.toLowerCase().replace(/ /g, "-");
  return { key, label: workflowStatusLabel(key), cls };
}
/* DOES THIS REFERENCE HAVE AN APPROVED IDENTITY, asked of the one owner.
 *
 * entityWorkflowState() answers a DESIGN-REVIEW question — draft, in progress,
 * ready for review, approved — and it answers it from `workflowStatus`/`status`,
 * two plain strings anything may write. Two surfaces were reading that word as
 * though it meant "a person approved this reference's identity":
 * promptReferenceOptions() published `approved: true` from it, and the References
 * stage called a shot ready from it. Neither consults the receipt ledger, so a
 * status word was acting as authority — and a sheet accepted as a SOURCE set it.
 *
 * Identity approval has exactly one owner, entityProductionTruth(), and it is the
 * same owner the entity page, the Bible and coverage automation already read.
 * This is a thin named reading of it, not a second flag: it stores nothing,
 * caches nothing, and returns false when it cannot tell which collection an
 * entity belongs to rather than guessing.
 *
 * `type` is carried by the records referenceRecordsForShot() builds; the scan is
 * the fallback for a bare entity, and it includes `audio`, which entityListOf()
 * in public/entities.js deliberately does not. */
const ENTITY_LIST_FOR_REFERENCE_TYPE = {
  Character: "characters", Location: "locations", Prop: "props", Vehicle: "vehicles", Audio: "audio",
};
function entityListForReference(entity) {
  if (!entity) return "";
  const byType = ENTITY_LIST_FOR_REFERENCE_TYPE[String(entity.type || "")];
  if (byType && (P[byType] || []).some((row) => row && row.id === entity.id)) return byType;
  for (const list of ["characters", "locations", "props", "vehicles", "audio"]) {
    if ((P[list] || []).some((row) => row && row.id === entity.id)) return list;
  }
  return "";
}
function entityIdentityCanonFiles(entity) {
  if (!entity || typeof entityProductionTruth !== "function") return new Set();
  const list = entityListForReference(entity);
  if (!list) return new Set();
  return new Set(entityProductionTruth(P, list, entity.id).canon.map((row) => row.value).filter(Boolean));
}
function entityHasIdentityCanon(entity) {
  return entityIdentityCanonFiles(entity).size > 0;
}
function entityWorkflowState(x) {
  let key = WORKFLOW_STATES.includes(x.workflowStatus) ? x.workflowStatus : "";
  if (!key) {
    if (x.status === "APPROVED") key = "APPROVED";
    else if (x.reviewStatus === "CHANGES REQUESTED") key = "CHANGES REQUESTED";
    else if (["CANDIDATE", "REVIEW"].includes(x.status))
      key = "READY FOR REVIEW";
    else if (x.status === "IN PROGRESS") key = "IN PROGRESS";
    else key = "DRAFT";
  }
  return {
    key,
    label: workflowStatusLabel(key),
    cls: key.toLowerCase().replace(/ /g, "-"),
  };
}
function legacyShotStatus(key, current = "UNBUILT") {
  if (key === "APPROVED") return "LOCKED";
  if (key === "DRAFT") return "UNBUILT";
  if (current === "NEEDS POST") return "NEEDS POST";
  return "BUILT";
}
function legacyEntityStatus(key) {
  return (
    {
      DRAFT: "NOT STARTED",
      "IN PROGRESS": "IN PROGRESS",
      "READY FOR REVIEW": "REVIEW",
      "CHANGES REQUESTED": "IN PROGRESS",
      APPROVED: "APPROVED",
    }[key] || "NOT STARTED"
  );
}
const OUTPUT_PLANS = {
  still: ["Still image", "hold"],
  animate: ["Animate approved image", "i2v"],
  flf: ["First and last frames", "flf"],
  references: ["Generate from references", "r2v"],
  post: ["Post-production only", "post"],
  reuse: ["Reuse existing media", "reuse"],
  sequence: ["Multi-clip sequence", "sequence"],
};
function outputPlanKey(s) {
  const clips = s.clips || [];
  if (clips.length > 1) return "sequence";
  const kind = clips[0]?.kind;
  return (
    {
      hold: "still",
      i2v: "animate",
      flf: "flf",
      r2v: "references",
      post: "post",
      reuse: "reuse",
    }[kind] ||
    ((s.route || "").includes("FLF")
      ? "flf"
      : (s.route || "").includes("COMPOSITE")
        ? "post"
        : "still")
  );
}
function outputPlanLabel(s) {
  return OUTPUT_PLANS[outputPlanKey(s)]?.[0] || "Still image";
}
window.setOutputPlan = (id, key) => {
  const s = shotById(id);
  if (!OUTPUT_PLANS[key]) return;
  if (key === "sequence") {
    if (!(s.clips || []).length)
      s.clips = [
        {
          suffix: "a",
          title: "Opening beat",
          dur: Math.max(1, Math.round((s.dur || 10) / 2)),
          kind: "i2v",
          note: "",
        },
        {
          suffix: "b",
          title: "Closing beat",
          dur: Math.max(1, Math.round((s.dur || 10) / 2)),
          kind: "i2v",
          note: "",
        },
      ];
  } else {
    const kind = OUTPUT_PLANS[key][1];
    const old = (s.clips || [])[0] || {};
    s.clips = [
      {
        suffix: "a",
        title: old.title || OUTPUT_PLANS[key][0],
        dur: +old.dur || +s.dur || 10,
        kind,
        note: old.note || "",
        line: old.line || "",
        speakerId: old.speakerId || "",
        audioNote: old.audioNote || old.vo || "",
        voiceEntityId: old.voiceEntityId || "",
        vo: old.vo || "",
        winner: old.winner || null,
        winnerEnd: kind === "flf" ? old.winnerEnd || null : null,
      },
    ];
  }
  s.route = {
    still: "GENERATE",
    animate: "GENERATE",
    flf: "GENERATE (FLF)",
    references: "GENERATE (R2V)",
    post: "COMPOSITE",
    reuse: "REUSE",
    sequence: "GENERATE",
  }[key];
  if (workflowState(s).key === "DRAFT") {
    s.workflowStatus = "IN PROGRESS";
    s.status = "BUILT";
  }
  dirty();
  route();
};
window.setShotWorkflow = (id, key) => {
  if (!WORKFLOW_STATES.includes(key)) return;
  const s = shotById(id);
  s.workflowStatus = key;
  s.status = legacyShotStatus(key, s.status);
  if (key !== "CHANGES REQUESTED") s.reviewStatus = "";
  dirty();
  route();
};
window.setEntityWorkflow = (list, id, key) => {
  if (!WORKFLOW_STATES.includes(key)) return;
  const x = P[list].find((e) => e.id === id);
  x.workflowStatus = key;
  x.status = legacyEntityStatus(key);
  if (key !== "CHANGES REQUESTED") x.reviewStatus = "";
  dirty();
  route();
};
window.submitShot = (id) => {
  const s = shotById(id);
  if (!takesFor(id).length)
    return toast("Add at least one candidate before submitting");
  formModal(
    "Submit for review",
    [
      {
        k: "note",
        label: "What changed? (optional)",
        type: "textarea",
        value: s.submissionNote || "",
        ph: "What should the reviewer focus on?",
      },
    ],
    (v) => {
      s.workflowStatus = "READY FOR REVIEW";
      s.status = "BUILT";
      s.reviewStatus = "";
      s.submissionNote = v.note || "";
      s.submittedAt = new Date().toISOString();
      dirty();
      route();
      toast("Submitted for review");
    },
  );
};
window.submitEntity = (list, id) => {
  const x = P[list].find((e) => e.id === id);
  const media = entityMedia(list, x);
  if (!media.length)
    return toast("Add at least one candidate before submitting");
  formModal(
    "Submit for review",
    [
      {
        k: "note",
        label: "What changed? (optional)",
        type: "textarea",
        value: x.submissionNote || "",
        ph: "What should the reviewer focus on?",
      },
    ],
    (v) => {
      x.workflowStatus = "READY FOR REVIEW";
      x.status = "REVIEW";
      x.reviewStatus = "";
      x.submissionNote = v.note || "";
      x.submittedAt = new Date().toISOString();
      dirty();
      route();
      toast("Submitted for review");
    },
  );
};
window.requestShotChanges = (id) =>
  formModal(
    "Request changes",
    [
      {
        k: "note",
        label: "What needs to change?",
        type: "textarea",
        ph: "Give one clear, actionable direction.",
      },
    ],
    (v) => {
      const s = shotById(id);
      s.workflowStatus = "CHANGES REQUESTED";
      s.reviewStatus = "CHANGES REQUESTED";
      s.reviewNote = v.note || "Changes requested";
      s.status = "BUILT";
      dirty();
      closeModal();
      route();
      toast("Changes requested");
    },
  );
window.requestEntityChanges = (list, id) =>
  formModal(
    "Request changes",
    [
      {
        k: "note",
        label: "What needs to change?",
        type: "textarea",
        ph: "Give one clear, actionable direction.",
      },
    ],
    (v) => {
      const x = P[list].find((e) => e.id === id);
      x.workflowStatus = "CHANGES REQUESTED";
      x.reviewStatus = "CHANGES REQUESTED";
      x.reviewNote = v.note || "Changes requested";
      x.status = "IN PROGRESS";
      dirty();
      closeModal();
      route();
      toast("Changes requested");
    },
  );
function entityInitials(id) {
  return (
    P.characters
      .find((x) => x.id === id)
      ?.name?.split(/\s+/)
      .map((x) => x[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || id.slice(0, 2).toUpperCase()
  );
}
function continuityStateDeltaText(state) {
  if (!state) return "";
  const fields = [
    "notes",
    "stateDelta",
    "delta",
    "changeOnly",
    "change",
    "changes",
    "description",
    "visualDescription",
    "instructions",
    "prompt",
  ];
  for (const key of fields) {
    const value = String(state[key] || "").trim();
    if (value) return value;
  }
  return "";
}
/* 1D-06 / PHASE 2 — THE PURE READ, SPLIT OUT OF THE MIGRATING ONE.
 *
 * `entityStateList` below is a READ + CREATE + MIGRATE hybrid: it inserts a
 * default state, rewrites notes, normalises generation fields and syncs the
 * entity's approved file. The 1C audit found `v627EntityPreflight` calling it,
 * which means opening the automation planner edited the project — the same
 * class of defect as the shot preflight closed in 1C, in the entity half.
 *
 * This is the reader every preflight, inspector and rendering path should use.
 * It answers the question and changes nothing. A caller that genuinely needs
 * the collection repaired calls the hybrid, deliberately, by its own name. */
function entityStateListRead(entity, includeDefault = true) {
  const states = Array.isArray(entity && entity.continuityStates) ? entity.continuityStates.filter(Boolean) : [];
  return includeDefault ? states : states.filter((st) => !st.isDefault);
}

/* THE NAMED MUTATION. `ensureEntityStateList` was `entityStateList`: a function
 * every reader in the product called, which inserts a default state, migrates
 * notes, fills generation fields and syncs the entity pointer. The 1D audit
 * opened an automation modal and watched a bare entity gain a continuityStates
 * array, a state-default, generationMode, prompt fields and a build array — the
 * project edited by the act of looking at it.
 *
 * The behaviour is unchanged and still wanted; what changed is that its name now
 * says it writes, so a reader reaching for it can see it is reaching for the
 * wrong one. `entityStateListRead` is the reader. */
function ensureEntityStateList(entity, includeDefault = true) {
  if (!entity) return [];
  entity.continuityStates = Array.isArray(entity.continuityStates)
    ? entity.continuityStates
    : [];
  if (!entity.continuityStates.some((st) => st && st.isDefault)) {
    entity.continuityStates.unshift({
      id: "state-default",
      name: "Default",
      appliesTo: "",
      approvedFile: entity.approvedFile || "",
      approvedAssetId: entity.approvedAssetId || "",
      notes: "Primary approved reference.",
      isDefault: true,
    });
  }
  const defaultState = entity.continuityStates.find((st) => st && st.isDefault) || entity.continuityStates[0] || null;
  entity.continuityStates.forEach((st) => {
    if (!st) return;
    const migratedDelta = continuityStateDeltaText(st);
    if (!String(st.notes || "").trim() && migratedDelta) st.notes = migratedDelta;
    /* 1D-06: this filled a missing key too, and for the same reason it must
       not — see the normaliser above. Reading a project does not decide what
       its states derive from. */
    if (!["derive", "independent"].includes(st.generationMode)) st.generationMode = st.isDefault ? "independent" : "derive";
    if (st.assetPromptProfile == null) st.assetPromptProfile = "";
    if (st.assetPromptNotes == null) st.assetPromptNotes = "";
    st.assetPromptBuilds = Array.isArray(st.assetPromptBuilds) ? st.assetPromptBuilds : [];
  });
  if (defaultState && entity.approvedFile && !defaultState.approvedFile) {
    defaultState.approvedFile = entity.approvedFile;
    defaultState.approvedAssetId = entity.approvedAssetId || "";
  }
  if (defaultState?.approvedFile && (entity.approvedFile !== defaultState.approvedFile || (entity.approvedAssetId || "") !== (defaultState.approvedAssetId || ""))) {
    entity.approvedFile = defaultState.approvedFile;
    entity.approvedAssetId = defaultState.approvedAssetId || "";
  }
  return includeDefault
    ? entity.continuityStates
    : entity.continuityStates.filter((st) => !st.isDefault);
}
/* S12A — A FUNCTION NAMED FOR A LOOKUP DOES A LOOKUP. This called the
 * initializer, so every `entityStateById` in an inspector, a planner or a
 * renderer was a write. It reads now; a caller that genuinely needs the
 * collection built calls `ensureEntityStateList` first, deliberately, by its own
 * name. */
function entityStateById(entity, stateId) {
  const states = entityStateListRead(entity, true);
  if (!stateId) return states.find((st) => st.isDefault) || states[0] || null;
  return states.find((st) => st.id === stateId) || null;
}
function selectedEntityStateForShot(s, entity) {
  return entityStateById(entity, s?.continuityStateSelections?.[entity.id] || "") || entityStateListRead(entity, true)[0] || null;
}
/* `st?.approvedFile || entity.approvedFile` used to end this function. Because
   ensureEntityStateList() keeps `entity.approvedFile` synced to the DEFAULT state's
   file, that `||` served the clean image for a request naming a declared
   non-default state with no approved reference of its own. The rule is one
   thing in one place now — Continuity.stateApprovedFile() — shared with the
   automation preflight and with server.js's authority selection. "" means no
   authority, and callers must show that rather than a plausible wrong image. */
function entityApprovedFileForState(entity, stateId = "") {
  return stateApprovedFile(entity, entityStateById(entity, stateId));
}
function entityApprovalBadges(entity, file) {
  return entityStateListRead(entity, true)
    .filter((st) => (st.approvedFile || "") === file)
    .map((st) => (st.isDefault ? "DEFAULT" : st.name || "STATE"));
}
function referenceRecordsForShot(s) {
  const resolved = resolveShotEntities(P, s);
  return [
    ...resolved.characters.map((x) => ({ type: "Character", route: "character", ...x })),
    ...resolved.locations.map((x) => ({ type: "Location", route: "location", ...x })),
    ...resolved.props.filter((x) => !(P.vehicles || []).some((v) => v.id === x.id)).map((x) => ({ type: "Prop", route: "prop", ...x })),
    ...(resolved.vehicles || []).map((x) => ({ type: "Vehicle", route: "vehicle", ...x })),
    ...resolved.audio.map((x) => ({ type: "Audio", route: "sound", ...x })),
  ];
}

// Project media helpers are defined in media.js.

function sceneReferenceRecords(sc) {
  const shots = P.shots.filter((s) => s.scene === sc.id);
  const refs = shots.flatMap(referenceRecordsForShot);
  return refs.filter(
    (x, i, a) => a.findIndex((y) => y.type === x.type && y.id === x.id) === i,
  );
}
function workflowChip(state) {
  return `<span class="workflow-chip wf-${state.cls}">${esc(state.label)}</span>`;
}
/* The badges on a shot card are one or two letters, so they carry their own accessible
   name as well as a tooltip: a character shows its initials, every other reference type
   shows its first letter. The board prints the key once above the cards. */
function shotRelationshipChips(s) {
  const all = referenceRecordsForShot(s);
  const chips = all
    .slice(0, 4)
    .map((x) => {
      const name = `${x.type}: ${x.name || x.id}`;
      return `<span class="relation-chip relation-${x.type.toLowerCase()}" title="${attr(name)}" aria-label="${attr(name)}">${esc(x.type === "Character" ? entityInitials(x.id) : x.type[0])}</span>`;
    })
    .join("");
  const more = Math.max(0, all.length - 4);
  return chips + (more ? `<span class="relation-more" title="${attr(plural(more, "more linked reference"))}" aria-label="${attr(plural(more, "more linked reference"))}">+${more}</span>` : "");
}
/* A one-line key for those badges, so a filmmaker never has to guess what "TC" or "P"
   means. It sits with the board controls rather than inside every card. */
function shotBadgeLegend() {
  const rows = [["Initials", "Character"], ["L", "Location"], ["P", "Prop"], ["V", "Vehicle"], ["A", "Audio"]];
  return `<div class="board-badge-legend"><span>CARD BADGES</span>${rows.map(([mark, meaning]) => `<b><i>${esc(mark)}</i>${esc(meaning)}</b>`).join("")}</div>`;
}
function shotReadinessFor(s, feed = projectShotReadiness()) {
  if (!s || !feed || feed.error) return null;
  return (feed.shots || []).find((row) => row.shotId === s.id) || null;
}
/* A SHOT-LOCAL PROJECTION, not a second next-action derivation. The readiness row owns
   status, requirements and action; this adds only the compact words board/list surfaces
   need. A caller rendering several shots passes the already-derived feed row. */
function shotProductionNextAction(s, readiness = shotReadinessFor(s)) {
  if (!readiness) {
    return { key: "unavailable", label: "Readiness unavailable", detail: "Open Production for details", status: "" };
  }
  const action = readiness.nextAction || {};
  return {
    key: action.code || String(readiness.status || "unavailable").toLowerCase(),
    label: readinessActionWords(action),
    detail: action.message || (READINESS_STATUS_WORDS[readiness.status] || readiness.status || ""),
    status: readiness.status,
    action,
    nextUnitId: readiness.nextUnitId || "",
  };
}
function shotReadinessTargetDestination(readiness) {
  const action = readiness?.nextAction?.code || "";
  return typeof shotReadinessDestinationForAction === "function"
    ? shotReadinessDestinationForAction(action)
    : null;
}
function shotReadinessTargetStage(readiness) {
  return shotReadinessTargetDestination(readiness)?.stageId || "";
}
/* Readiness names the next action. The declaration resolves its destination and,
   for a shot stage, the distinct panel vocabulary openGuidedPanel() accepts, so a
   stage id is never passed through as though it were a panel id. */
function shotReadinessTargetPanel(readiness) {
  return shotReadinessTargetDestination(readiness)?.panel || "";
}
function shotReadinessTargetRoute(readiness) {
  const destination = shotReadinessTargetDestination(readiness);
  return destination?.navigation?.kind === "route" ? destination.navigation.route || "" : "";
}
/* One router consumes both declared destination kinds. An action code never appears
   in this function: shared-stage-model.js owns WHERE it goes, while readiness owns
   WHICH code is true. Unknown and project-only codes refuse visibly and leave the
   current workspace untouched instead of falling through to a plausible panel. */
window.openShotReadinessAction = (shotId, actionCode) => {
  const destination = typeof shotReadinessDestinationForAction === "function"
    ? shotReadinessDestinationForAction(actionCode)
    : null;
  if (!destination) return toast("That next action has no shot-local destination");
  if (destination.navigation?.kind === "route" && destination.navigation.route) {
    location.hash = destination.navigation.route.replace(":shotId", encodeURIComponent(shotId || ""));
    return;
  }
  if (destination.navigation?.kind === "task-selection" && destination.panel) {
    return openGuidedPanel(shotId, destination.panel, destination.focus || "");
  }
  return toast("That next action has no actionable destination");
};

/* `nextProductionShot()` remains deleted: project and shot surfaces now both project
   evaluateProjectReadiness(), at their respective scopes. The project projection below
   still adds its existing prioritisation over those authoritative rows. */
/* ==========================================================================
   THE PROJECT'S NEXT ACTION — READ OFF CANONICAL READINESS, NOT DERIVED BESIDE IT.

   The shot-local projection above and this project-level recommendation read the
   same readiness feed. This owner retains the stronger project prioritisation already
   shipped; board/list/card consumers do not independently infer readiness from media.

   THIS IS NOT A SECOND READINESS PREDICATE. It asks evaluateProjectReadiness() —
   the same module the server answers from — and does two things with the answer it
   already emits:

     1. Prefers a shot the model itself calls READY.
     2. When none is, aggregates the model's own outstanding requirement rows by
        authority target and names the one blocking the most shots. Shared
        reference and setup work is what actually blocks a project, and telling a
        filmmaker to approve one reference that unblocks six shots is the highest
        leverage TRUE statement available — not a new judgement, a count.

   No status, no threshold and no ordering is invented here. Every code, message and
   target comes out of the readiness payload. */
const NEXT_ACTION_TARGET_ROUTES = {
  "shot-frame": (target) => `#/shot/${target.shotId}`,
  "shot-motion": (target) => `#/shot/${target.shotId}`,
  "shot-delivery": (target) => `#/shot/${target.shotId}`,
  "entity-state": (target) => (ENTITY_ROUTE[target.list] ? `#/${ENTITY_ROUTE[target.list]}/${encodeURIComponent(target.entityId || "")}` : "#/library"),
};
function nextActionTargetHref(target) {
  const build = target && NEXT_ACTION_TARGET_ROUTES[target.kind];
  return build ? build(target) : "";
}
/* Outstanding requirement rows from every shot, grouped by the authority target
   that would satisfy them. `shotIds` is the leverage: one entity state named by six
   shots is one approval that unblocks six. Shot-scoped targets group too — a parent
   frame blocks only its own shot, so it simply never wins the count. */
/* WHAT A SHOT IS ACTUALLY WAITING ON, AND THE ONE PLACE IT IS DECIDED.
 *
 * ONLY OUTSTANDING UNITS. A unit that already holds Canon still carries the
 * requirement rows it was evaluated against, and one of those rows can be a
 * reference nobody has confirmed — true, recorded, and blocking nothing, because
 * the work it guarded is done. Reading them made the project name "Resolve this
 * input · Kai — Default" as the next action for a shot whose only remaining
 * decision was to mark it final, and put the mark-final sentence under a heading
 * pointing at a character page. A blocker is something that is blocking.
 *
 * LIFTED OUT SO THE REFERENCE SURFACE CANNOT DISAGREE. `projectSharedBlockers`
 * below and entityReadinessObligations() both ask what a shot currently owes, and
 * an independent review found the reference surface answering a DIFFERENT
 * question — reading the entity's coverage template instead of the production's
 * requirements, and reporting "8 required references still needed" for a shot
 * whose next action was MARK SHOT FINAL. Two readers of one question is how that
 * happens, so there is one. */
/* AN INPUT THE SHOT DECLARES IS OWED BEFORE THE SHOT HAS SAID HOW IT IS MADE.
 *
 * Readiness attaches an `entity-state` requirement to EVERY unit, because every unit
 * consumes the shot's cast; the requirement is a fact about the SHOT rather than about
 * the unit carrying it. That distinction never showed while every frame of every project
 * was required by default — now that a shot which has declared nothing requires nothing,
 * gating these rows on `unit.required` would mean casting a character onto an undecided
 * shot raised no obligation at all, and the reference surface would report the approval
 * it needs as coverage plan.
 *
 * Unit-scoped requirements stay gated on `required`, because those ARE the work: a
 * frame's parent frame and a route's missing endpoint belong to the unit that owes them,
 * and letting an optional unit contribute them would put frame debt back through a side
 * door. Only the shot's own declared inputs cross. */
/* Declared by shared-shot-readiness.js, which uses the same list for the same reason:
   these are the requirements that belong to the SHOT rather than to the unit carrying
   them. Read rather than restated, so the reference surface and the readiness rollup
   cannot come to disagree about which rows survive an optional unit. */
function shotInputRequirementKinds() {
  return typeof SHOT_INPUT_REQUIREMENT_KINDS !== "undefined" && Array.isArray(SHOT_INPUT_REQUIREMENT_KINDS)
    ? SHOT_INPUT_REQUIREMENT_KINDS
    : [];
}
function outstandingReadinessRows(shot) {
  const units = shot?.units || [];
  const rows = [
    ...(shot?.requirements || []),
    ...units.filter((unit) => !unit.complete && unit.required).flatMap((unit) => unit.requirements || []),
    ...units.filter((unit) => !unit.complete && !unit.required)
      .flatMap((unit) => (unit.requirements || []).filter((row) => shotInputRequirementKinds().includes(row?.kind))),
  ];
  return rows.filter((row) => row && (row.state === "missing" || row.state === "needs-decision"));
}

/* THE CURRENT PRODUCTION OBLIGATIONS THAT NAME ONE REFERENCE.
 *
 * This is the A of the A/B split the reference surface needs:
 *
 *   A  CURRENT PRODUCTION REQUIREMENT   what the shots actually owe now. Rows
 *                                       produced by shared-shot-readiness.js,
 *                                       filtered by the predicate above, and
 *                                       nothing else. No threshold, no ranking,
 *                                       no second predicate.
 *   B  COVERAGE PLAN                    the entity's own template of useful
 *                                       material. Real, visible, and not work.
 *
 * Readiness raises exactly one kind of row about an entity — `entity-state`, one
 * per declared state per outstanding unit — and it raises NONE for coverage or
 * expression slots. That is the whole reason the two numbers could differ: the
 * surface was counting B and calling it A.
 *
 * EVALUATED ONLY FOR THE SHOTS THAT USE THIS REFERENCE, which
 * entityReferenceDemand() has already identified, rather than by deriving the
 * whole project feed on a reference page. A dormant reference costs nothing at
 * all; a used one costs its own shots. Same module, same oracle, same rows the
 * production feed would contain.
 *
 * FAILS CLOSED. `known: false` whenever the derivation cannot run or the demand
 * answer itself is uncertain, and the caller then keeps required work required. */
function entityReadinessObligations(list, entityId, demand) {
  const empty = { known: false, rows: [] };
  const wanted = String(entityId || "");
  if (!wanted || typeof evaluateShotReadiness !== "function") return empty;
  const answer = demand && typeof demand === "object" ? demand : null;
  if (!answer || answer.known !== true) return empty;
  if (!answer.demanded) return { known: true, rows: [] };
  const oracle = readinessOracleForBrowser();
  const shots = Array.isArray(P.shots) ? P.shots : [];
  const byTarget = new Map();
  try {
    for (const shotId of answer.shotIds || []) {
      const shot = shots.find((row) => row && String(row.id) === String(shotId));
      if (!shot) continue;
      const evaluated = evaluateShotReadiness(P, shot, oracle);
      for (const row of outstandingReadinessRows(evaluated)) {
        const target = row.target;
        if (!target || target.kind !== "entity-state") continue;
        if (String(target.list) !== String(list) || String(target.entityId) !== wanted) continue;
        const key = String(row.targetKey || target.key || "");
        const existing = byTarget.get(key);
        if (existing) {
          if (!existing.shotIds.includes(String(shot.id))) existing.shotIds.push(String(shot.id));
          continue;
        }
        byTarget.set(key, {
          key,
          stateId: String(target.stateId || ""),
          label: String(row.label || ""),
          state: String(row.state || ""),
          reason: String(row.reason || ""),
          shotIds: [String(shot.id)],
        });
      }
    }
  } catch {
    /* A derivation that cannot run must not be read as "nothing is owed". */
    return empty;
  }
  /* ONE ROW PER AUTHORITY TARGET, exactly as the Historic confirmation queue
     groups: six shots naming one reference is one decision, not six. */
  return { known: true, rows: [...byTarget.values()] };
}

function projectSharedBlockers(feed) {
  const groups = new Map();
  for (const shot of feed?.shots || []) {
    const rows = outstandingReadinessRows(shot);
    for (const row of rows) {
      const key = row.targetKey || `${row.kind}:${row.label}`;
      const group = groups.get(key) || { key, row, shotIds: [], occurrences: 0 };
      group.occurrences += 1;
      if (!group.shotIds.includes(shot.shotId)) group.shotIds.push(shot.shotId);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.shotIds.length - a.shotIds.length || b.occurrences - a.occurrences);
}
/* `feed` is optional so a caller that has already derived readiness — the
   production view renders both from one answer — does not evaluate the whole
   project a second time. */
function projectNextProductionAction(feed = projectShotReadiness()) {
  /* Readiness could not be derived at all. Saying nothing would be worse than saying
     that, and routing anywhere on the strength of it would be a guess. */
  if (!feed || feed.error) {
    return { kind: "unavailable", href: "#/production", title: "Readiness could not be derived", message: feed?.error || "CineBraid could not derive what to do next.", actionLabel: "OPEN PRODUCTION" };
  }
  if (feed.truthProblem) {
    /* ONE PROJECT PROBLEM IS ONE REPAIR ACTION, and the readiness panel directly
       above already states it. This points AT that action rather than restating it:
       repeating the words here would be the same lie of aggregation the readiness
       module removed when one corrupt ledger produced one repair per shot. */
    return { kind: "repair", href: "#/production", title: "Readiness cannot be answered yet", message: feed.truthProblem.message, actionLabel: "SEE PRODUCTION READINESS ABOVE" };
  }
  /* RETURNED MEDIA CAME BACK AND NOBODY HAS LOOKED AT IT.
   *
   * This tier is the review's second finding, and the defect was a routing one
   * rather than a counting one: with one candidate sitting unreviewed and no
   * filmmaker decision outstanding, Returned Results correctly said "1 returned
   * result waiting for review" while the primary action said PRODUCE THE FRAME —
   * so the recommended next act was to generate a second candidate for the frame
   * whose first candidate nobody had looked at.
   *
   * It sits above READY and below the project repair, which is exactly where the
   * existing design already put availability: a shared blocker outranks nothing
   * that can start now, and reviewing media the project has ALREADY PAID FOR is
   * more available than producing more of it. The integrity blocker — a ledger
   * nobody can read — still outranks everything, and `projectSharedBlockers` is
   * still consulted on exactly the condition it always was: no ready work.
   *
   * THE COUNTS ARE NOT MERGED. This reads returnedResultsAwaitingReview(), whose
   * scope is candidates awaiting review, and changes no filmmaker-decision count.
   * A project can truthfully show 0 decisions and still be told to review a
   * returned result, because those are two different questions. */
  /* One derivation, read twice: the review queue and the integrity blockers are two
     answers from the same projection, and asking for it twice would be two answers. */
  const returnedReview = returnedReviewProjectionForBrowser();
  const returned = returnedResultsAwaitingReview(returnedReview);
  if (returned.length) {
    const first = returned[0];
    const total = returnedResultCount(returned);
    const href = first.shot
      ? shotReviewHref(first.shot.id, first.reviewKey)
      : `#/${first.route}/${encodeURIComponent(first.entity?.id || "")}`;
    const shot = first.shot ? shotById(first.shot.id) : null;
    return {
      kind: "returned-result",
      shotId: first.shot ? first.shot.id : "",
      /* THE CANDIDATE THIS ACTION IS ABOUT, CARRIED IN THE ROUTE.
       *
       * It used to be reported here and dropped from the href, on the reasoning that the
       * shot workspace re-derives the same head of the same ordered queue. That holds
       * only while nothing changes in between — and the case that matters is exactly the
       * one where something did. With A decided between the render and the click, a
       * workspace that re-derived would put candidate B in front of the filmmaker under
       * an action that said A, and the next decision they took would be about a file
       * they never asked to see. The claim travels so the workspace can tell the
       * difference and say so. Empty for an entity reference row, which has a per-entity
       * route and no candidate identity. */
      reviewKey: first.reviewKey || "",
      href,
      returned: total,
      title: first.shot
        ? `${first.shot.id}${shot?.title ? ` · ${shot.title}` : ""}`
        : (first.entity?.name || first.entity?.id || "Returned result"),
      /* The queue's own sentence, then the scope, never a rewritten verdict. */
      message: `${first.label}. ${total > 1
        ? `${plural(total, "returned result")} are waiting for review across this project.`
        : "It is waiting for your review — approve it, keep it as an alternate, or reject it."}`,
      actionLabel: "REVIEW RETURNED RESULT",
    };
  }
  /* RETURNED MEDIA THE PROJECT STILL OWES A DECISION ON AND CANNOT FIND.
   *
   * The third finding, and it is a routing one again rather than a counting one: a
   * candidate row the project records as undecided, whose bytes are no longer on disk,
   * used to leave the projection entirely — so the shot read as having nothing
   * outstanding and this function fell through to READY and said PRODUCE THE FRAME.
   * CineBraid offering to spend money because it had lost track of something it already
   * had is the worst version of the defect this whole tier exists to prevent.
   *
   * It sits BELOW an actionable returned review — a result you can actually judge is
   * better work than an integrity notice — and ABOVE READY, which is the position that
   * stops the promotion. The project repair still outranks both, unchanged. */
  const unavailable = (returnedReview && returnedReview.blockers) || [];
  if (unavailable.length) {
    const first = unavailable[0];
    const shot = shotById(first.shotId);
    return {
      kind: "returned-media-unavailable",
      shotId: first.shotId,
      reviewKey: first.key || "",
      unavailable: unavailable.length,
      href: shotReviewHref(first.shotId, first.key),
      title: `${first.shotId}${shot?.title ? ` · ${shot.title}` : ""}`,
      message: `${first.candidate.name} is recorded as a returned result nobody has decided about, and the file is no longer in this project. ${unavailable.length > 1 ? `${plural(unavailable.length, "returned result")} are in this state.` : "Restore the file or dispose of the record before generating more."}`,
      actionLabel: "OPEN THE SHOT",
    };
  }
  const ready = (feed.shots || []).find((shot) => shot.status === "READY");
  if (ready) {
    const shot = shotById(ready.shotId);
    return {
      kind: "shot", shotId: ready.shotId, href: `#/shot/${ready.shotId}`,
      title: `${ready.shotId}${shot?.title ? ` · ${shot.title}` : ""}`,
      message: ready.nextAction?.message || "",
      /* AT1-F. `href` is what this control does, so its words say so. The ACT is
         still named in `message` and performed by its own owner on the shot. */
      actionLabel: readinessNavigationWords(ready.nextAction).toUpperCase(),
    };
  }
  const outstanding = (feed.shots || []).filter((shot) => shot.status !== "COMPLETE");
  if (!outstanding.length) return null;
  const blockers = projectSharedBlockers(feed);
  const top = blockers[0];
  if (top) {
    const shots = top.shotIds.length;
    const href = nextActionTargetHref(top.row.target) || `#/shot/${top.shotIds[0]}`;
    return {
      kind: "blocker", href, unblocks: shots, targetKey: top.key,
      title: top.row.label || "Required production input",
      /* The canonical shot message, then what resolving it buys — never a rewritten
         verdict. The leverage sentence is only added when it is genuinely shared. */
      message: `${outstanding.find((shot) => shot.shotId === top.shotIds[0])?.nextAction?.message || ""}${shots > 1 ? ` This is required by ${plural(shots, "shot")}.` : ""}`.trim(),
      actionLabel: shots > 1 ? `UNBLOCK ${shots} SHOTS` : "RESOLVE THIS INPUT",
    };
  }
  /* Outstanding shots with no requirement rows at all — a shot that declares nothing
     producible, for instance. Its own canonical action is the truthful answer. */
  const first = outstanding[0];
  const shot = shotById(first.shotId);
  return {
    kind: "shot", shotId: first.shotId, href: `#/shot/${first.shotId}`,
    title: `${first.shotId}${shot?.title ? ` · ${shot.title}` : ""}`,
    message: first.nextAction?.message || "",
    /* AT1-F, same reason as the READY branch above: this travels to the shot. */
    actionLabel: readinessNavigationWords(first.nextAction).toUpperCase(),
  };
}
/* AT1-C — ONE OWNER FOR THE PRIMARY PRODUCTION CONTROL: ITS WORDS AND ITS ACT.
 *
 * THE DEFECT. The label was derived on the Production head — `next ? "CONTINUE
 * PRODUCTION" : hasShots ? "NOTHING OUTSTANDING" : "ADD THE FIRST SHOT"` — and
 * the handler beside it read only `projectNextProductionAction()`, which returns
 * null for BOTH "nothing is outstanding" and "there is nothing at all". So a
 * project with no shots printed ADD THE FIRST SHOT on a primary button and
 * answered the press with "Every shot has been delivered": a completion claim
 * about a production that has not started, in place of the act the button named.
 *
 * Two readers of one question is how that happens, so there is one reader now.
 * The words and the act are decided together and cannot disagree, because the
 * same value produces both. `nothing-outstanding` keeps its exact wording — it
 * was the truthful case all along, and suites assert it. */
function projectPrimaryProductionAction(feed = projectShotReadiness()) {
  const next = projectNextProductionAction(feed);
  if (next) return { kind: "continue", label: "CONTINUE PRODUCTION", next };
  /* NO SHOTS IS NOT COMPLETION. A project that has never had a shot cannot have
     delivered one, and the act this offers is the one that starts the film. */
  if (!P.shots.length) return { kind: "add-first-shot", label: "ADD THE FIRST SHOT", next: null };
  return { kind: "nothing-outstanding", label: "NOTHING OUTSTANDING", next: null };
}
window.continueProduction = () => {
  const primary = projectPrimaryProductionAction();
  /* The real creation flow — the same one ＋ Add shot reaches — not a message
     about it. addShot() creates the first scene too when there is none. */
  if (primary.kind === "add-first-shot") return openContextualAdd("shot");
  if (primary.kind === "nothing-outstanding") return toast("Every shot has been delivered");
  location.hash = primary.next.href;
};
function slate(s, sceneId, readiness = null) {
  const takes = takesFor(s.id);
  const last = takes[takes.length - 1];
  const winner = anyWinnerTake(s, takes);
  const show = winner || last;
  const state = workflowState(s, takes);
  const thumb = show
    ? isVideo(show.name)
      ? `<video muted preload="metadata" src="${show.url}#t=0.1"></video>`
      : `<img src="${show.url}" alt="">`
    : `<div class="blueprint"><span class="bp-id">${esc(s.id)}</span><span class="bp-note">AWAITING CANDIDATE</span></div>`;
  const warning =
    state.key === "READY FOR REVIEW"
      ? '<span class="slate-alert">Needs decision</span>'
      : state.key === "CHANGES REQUESTED"
        ? '<span class="slate-alert changes">Changes requested</span>'
        : "";
  const refs = referenceRecordsForShot(s);
  const next = shotProductionNextAction(s, readiness || shotReadinessFor(s));
  /* The card itself is a link to the shot, so inspection needs its own control:
     enlarging must never navigate away from the board. */
  /* O5: INSPECT, NOT MERELY ENLARGE. The board's thumbnail is the shot's approved
     pick or its newest take — production media with a disposition, an authority and a
     provenance — so the control that was "make it bigger" now opens the Inspector,
     which offers the larger view as one of its own actions. inspectMediaFile falls
     back to the theatre for media the projection does not hold, so nothing that
     previewed before stops previewing. */
  const enlarge = show && !isVideo(show.name)
    ? `<button type="button" class="media-enlarge-btn slate-enlarge" onclick="event.preventDefault();event.stopPropagation();inspectMediaFile('${attr(encodeURIComponent(show.url))}','${attr(show.assetId || "")}','${attr(encodeURIComponent(`${s.id} · ${show.name}`))}','image')" aria-label="Inspect the ${attr(s.id)} image">Inspect</button>`
    : "";
  return `<article class="slate wf-card-${state.cls}">
    <div class="slate-top"><span class="slate-id">${esc(s.id)}</span><span class="dur-chip">${shotDur(s) ? shotDur(s) + "s" : ""}</span><span class="slate-route">${esc(outputPlanLabel(s))}</span>
      ${sceneId ? `<span class="move-btns"><button onclick="moveShot('${s.id}',-1)" title="Move up">↑</button><button onclick="moveShot('${s.id}',1)" title="Move down">↓</button></span>` : ""}</div>
    <div class="slate-thumb-shell"><a class="slate-thumb take-tile" href="#/shot/${s.id}" style="display:block;${attr(shotWellStyle(s))}">${thumb}${winner ? shotWinnerBadgeMarkup(s, winner) : ""}</a>${enlarge}</div>
    <a class="slate-body" href="#/shot/${s.id}">
      <div class="slate-title">${esc(s.title)}</div>
      <div class="state-pair"><span class="shot-next-chip next-${next.key}" title="Next action for this shot">${esc(next.label)}</span><small>${esc(next.detail)}</small></div>
      <div class="slate-relations">${shotRelationshipChips(s)}${warning}</div>
      <div class="slate-footer"><span>${plural(takes.length, "version")} · ${plural(refs.length, "reference")}</span><span>${s.submittedAt ? "submitted " + esc(s.submittedAt.slice(0, 10)) : s.audio?.line || (s.clips || []).some((c) => c.line) ? "Dialogue linked" : ""}</span></div>
    </a>
  </article>`;
}
window.toggleBatchShot = (id, on) => {
  on ? BATCH_SHOTS.add(id) : BATCH_SHOTS.delete(id);
  route();
};
window.clearBatchShots = () => {
  BATCH_SHOTS.clear();
  route();
};
window.selectSceneShots = (sceneId) => {
  P.shots
    .filter((s) => s.scene === sceneId)
    .forEach((s) => BATCH_SHOTS.add(s.id));
  route();
};
window.batchSetWorkflow = (key) => {
  if (!WORKFLOW_STATES.includes(key) || !BATCH_SHOTS.size) return;
  for (const id of BATCH_SHOTS) {
    const s = shotById(id);
    s.workflowStatus = key;
    s.status = legacyShotStatus(key, s.status);
  }
  dirty();
  route();
  toast(`${BATCH_SHOTS.size} shots updated`);
};
window.batchContinuityState = () => {
  if (!BATCH_SHOTS.size) return toast("Select shots first");
  const entities = [...P.characters, ...P.locations, ...P.props, ...(P.vehicles || [])].filter(
    (x) => (x.continuityStates || []).length,
  );
  if (!entities.length)
    return toast("Create a continuity state in the Library first");
  window._batchContinuity = entities;
  openModal(
    `<h3>Assign continuity state</h3><div class="modal-sub">APPLIES THE SELECTED STATE TO ${BATCH_SHOTS.size} SHOT${BATCH_SHOTS.size === 1 ? "" : "S"}</div><div class="form-field"><label>Reference and state</label><select id="batch-continuity-choice">${entities.flatMap((x) => (x.continuityStates || []).map((st) => `<option value="${attr(x.id + "|" + st.id)}">${esc(x.name || x.id)} — ${esc(st.name)}</option>`)).join("")}</select></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="confirmBatchContinuity()">ASSIGN</button></div>`,
  );
};
window.confirmBatchContinuity = () => {
  const [entityId, stateId] = (
    document.getElementById("batch-continuity-choice")?.value || "|"
  ).split("|");
  const declarations = [...BATCH_SHOTS].map((shotId) => ({ shotId, entityId, stateId }));
  const result = typeof applyShotStateDeclarationBatch === "function"
    ? applyShotStateDeclarationBatch(P, declarations)
    : { status: "invalid-declarations", changed: false };
  if (result.status !== "applied") {
    const reason = result.failure?.status;
    toast(SHOT_STATE_DECLARATION_RESULT_WORDS[reason]
      || "No shots changed because every selected shot must accept this continuity state.");
    return result;
  }
  closeModal();
  if (result.changed) dirty();
  route();
  toast(`Continuity state assigned to ${result.count} shot${result.count === 1 ? "" : "s"}`);
  return result;
};
window.batchHealthCheck = () => {
  if (!BATCH_SHOTS.size) return toast("Select shots first");
  const issues = projectHealthIssues().filter((x) =>
    BATCH_SHOTS.has(x.shot.id),
  );
  openModal(
    `<h3>Selected-shot health check</h3><div class="modal-sub">${BATCH_SHOTS.size} SHOTS · ${issues.length} ISSUE${issues.length === 1 ? "" : "S"}</div>${issues.map((x) => `<a class="qc-item" href="#/shot/${x.shot.id}" onclick="closeModal()"><span>${esc(x.type)} · ${esc(x.shot.id)}</span><small>${esc(x.msg)}</small></a>`).join("") || '<div class="canon-notes">No structural planning issues found.</div>'}<div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`,
  );
};
window.exportBatchPackages = async () => {
  if (!BATCH_SHOTS.size) return toast("Select shots first");
  const r = await fetch("/api/export/packages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shotIds: [...BATCH_SHOTS] }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    return toast("Export failed: " + (d.error || r.status));
  }
  const blob = await r.blob(),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(P.meta.title || "CineBraid").replace(/[^a-z0-9]+/gi, "_")}_packages.zip`;
  a.click();
};
function batchToolbar() {
  return `<div class="batch-toolbar ${BATCH_SHOTS.size ? "active" : ""}"><b>${BATCH_SHOTS.size} selected</b><select onchange="if(this.value){batchSetWorkflow(this.value);this.value=''}"><option value="">Set workflow…</option>${WORKFLOW_STATES.map((x) => `<option value="${x}">${workflowStatusLabel(x)}</option>`).join("")}</select><button onclick="batchContinuityState()">Assign continuity state</button><button onclick="batchHealthCheck()">Check health</button><button onclick="exportBatchPackages()">Export packages ZIP</button><button onclick="clearBatchShots()">Clear</button></div>`;
}

window.setBoardMode = (mode) => {
  BOARD_MODE = mode;
  localStorage.setItem("cinebraid-board-mode", mode);
  route();
};
window.setShotBoardDensity = (mode) => {
  if (!["compact", "comfortable", "large"].includes(mode)) return;
  SHOT_BOARD_DENSITY = mode;
  localStorage.setItem("cinebraid-shot-board-density", mode);
  route();
};
function shotBoardDensityControl() {
  const labels = { compact: "Compact", comfortable: "Standard", large: "Large" };
  return `<div class="board-density-control" aria-label="Shot preview size"><span>Card size</span><div class="board-density-buttons">${Object.entries(labels).map(([id, label]) => `<button type="button" class="${SHOT_BOARD_DENSITY === id ? "selected" : ""}" onclick="setShotBoardDensity('${id}')" aria-pressed="${SHOT_BOARD_DENSITY === id ? "true" : "false"}">${label}</button>`).join("")}</div></div>`;
}
window.toggleSceneCollapse = (id) => {
  COLLAPSED_SCENES.has(id)
    ? COLLAPSED_SCENES.delete(id)
    : COLLAPSED_SCENES.add(id);
  localStorage.setItem(
    "cinebraid-collapsed-scenes",
    JSON.stringify([...COLLAPSED_SCENES]),
  );
  route();
};

function runtimeBar(shots, target) {
  const total = shots.reduce((a, s) => a + shotDur(s), 0);
  if (!target) return `<div class="runtime-label">${mmss(total)} planned</div>`;
  const pct = Math.min(100, (total / target.max) * 100);
  const cls = total > target.max ? "over" : total >= target.min ? "ok" : "";
  return `<div class="runtime-bar"><div class="runtime-track"><div class="runtime-fill ${cls}" style="width:${pct}%"></div></div>
    <div class="runtime-label">${mmss(total)} planned · target ${mmss(target.min)}–${mmss(target.max)}${total > target.max ? " · OVER" : ""}</div></div>`;
}
function workspaceSectionStorageKey(key) {
  return `cinebraid-section:${ACTIVE_PROJECT_SLUG || "project"}:${String(key || "section")}`;
}
function workspaceSectionOpen(key, fallback = false) {
  try {
    const value = localStorage.getItem(workspaceSectionStorageKey(key));
    return value === null ? !!fallback : value === "1";
  } catch {
    return !!fallback;
  }
}
window.workspaceSectionOpen = workspaceSectionOpen;
function rememberWorkspaceSection(key, open) {
  if (ROUTE_RENDER_IN_PROGRESS) return;
  try { localStorage.setItem(workspaceSectionStorageKey(key), open ? "1" : "0"); } catch {}
}
window.rememberWorkspaceSection = rememberWorkspaceSection;
function workspaceStatusPill(label, tone = "neutral") {
  return `<span class="workspace-status-pill tone-${attr(tone)}">${esc(label)}</span>`;
}
const field = (label, inner) => {
  const markup = String(inner || "");
  const controlId = markup.match(/\sid=["']([^"']+)["']/i)?.[1] || "";
  const accessibleLabel = String(label || "Field").replace(/<[^>]+>/g, "").trim() || "Field";
  const namedMarkup = controlId
    ? markup
    : markup.replace(/<(input|textarea|select)(?=\s|>)/i, (match) => `${match} aria-label="${attr(accessibleLabel)}"`);
  return `<div class="field"><label${controlId ? ` for="${attr(controlId)}"` : ""}>${label}</label>${namedMarkup}</div>`;
};
const ta = (obj, key, list, id) =>
  `<textarea onchange="setVal('${list}','${id}','${key}',this.value)">${esc(obj[key] || "")}</textarea>`;
const inp = (obj, key, list, id) =>
  `<input value="${attr(obj[key] || "")}" onchange="setVal('${list}','${id}','${key}',this.value)">`;
window.setVal = (list, id, key, v) => {
  const o = P[list].find((x) => x.id === id);
  o[key] = v;
  if (list === "characters" && key === "expressions") normalizeReferenceCoverageData();
  dirty();
};
// nested setter for structured sub-objects (e.g. audio.voiceDesignPrompt)
window.setValNested = (list, id, obj, key, v) => {
  const o = P[list].find((x) => x.id === id);
  (o[obj] = o[obj] || {})[key] = v;
  dirty();
};
// textarea bound to obj[objKey][key]
const taN = (obj, objKey, key, list, id, ph = "") =>
  `<textarea placeholder="${attr(ph)}" onchange="setValNested('${list}','${id}','${objKey}','${key}',this.value)">${esc((obj[objKey] || {})[key] || "")}</textarea>`;
const inpN = (obj, objKey, key, list, id, ph = "") =>
  `<input placeholder="${attr(ph)}" value="${attr((obj[objKey] || {})[key] || "")}" onchange="setValNested('${list}','${id}','${objKey}','${key}',this.value)">`;

/* ---------- audio panels ---------- */
/* The character's voice, DERIVED.

   The voice entity in P.audio[] owns the voice record; the character points at
   it through `voiceId`, and this panel renders what the entity says. There is
   deliberately NO status writer here any more. The chip row that used to live
   on this panel wrote `character.audio.status` — a second, independently
   editable lifecycle that let a character claim APPROVED while the voice it
   described had never been started, and that migration rule M070 already
   preserves as a value open-film-project does not model.

   The state word below comes from entityWorkflowState() applied to the VOICE
   ENTITY — the same call, on the same record, that the audio entity's own page
   header makes. The two surfaces cannot print different words because they are
   not two computations. See public/shared-voice.js. */
function voiceLinkOptionsMarkup(c) {
  const rows = Array.isArray(P.audio) ? P.audio : [];
  if (!rows.length) return `<div class="hint">This project has no voice references yet. Add one under References → Audio, then link it here.</div>`;
  const current = String(c.voiceId || "");
  return `<select class="status-select" onchange="setVal('characters','${c.id}','voiceId',this.value)"><option value="">— no voice linked —</option>${rows.map((voice) => `<option value="${attr(voice.id)}" ${current === String(voice.id) ? "selected" : ""}>${esc(voice.name || voice.id)}${voice.cleanMaster ? " · clean master" : ""}</option>`).join("")}</select>`;
}
function voiceAuthorityMarkup(c) {
  const resolved = resolveCharacterVoice(P, c);
  const { outcome, voice, legacy, conflict } = resolved;
  /* The audio entity page route is "sound" — see ENTITY_ROUTE in entities.js. */
  const href = voice ? `#/sound/${encodeURIComponent(voice.id)}` : "";
  let word, detail;
  if (outcome === VOICE_OUTCOME.UNLINKED) {
    word = "No voice linked";
    detail = "Link a voice reference to give this character a voice.";
  } else if (outcome === VOICE_OUTCOME.UNRESOLVED) {
    word = "Voice reference not found";
    detail = `This character points at ${esc(resolved.voiceId)}, which this project does not contain. The reference is kept as written — relink it or clear it.`;
  } else {
    word = entityWorkflowState(voice).label;
    detail = resolved.hasApprovedRecording
      ? `Approved recording: ${esc(voice.approvedFile)}`
      : "No approved recording yet.";
  }
  /* Disclosure, not resolution. When a project carries the old character-side
     status AND a voice entity that disagrees, the voice entity is the answer —
     but the disagreement is shown rather than quietly discarded. Converting the
     old value is a migration's job, never a page load's. */
  const conflictMarkup = conflict
    ? `<div class="voice-authority-conflict"><b>This character carries an older voice status of its own</b><span>The character record says <code>${esc(conflict.characterStatus)}</code>; the linked voice reference says <code>${esc(entityWorkflowState(voice).label)}</code>. The voice reference is authoritative. The older value is still stored and has not been changed.</span></div>`
    : legacy.present && !voice
      ? `<div class="voice-authority-conflict"><b>This character carries an older voice status of its own</b><span>The character record says <code>${esc(legacy.status)}</code>, but no voice reference is linked, so there is nothing for it to describe. The value is still stored and has not been changed.</span></div>`
      : "";
  return `<div class="voice-authority state-${attr(outcome)}"><div class="voice-authority-head"><span class="voice-authority-label">VOICE STATE</span><b>${esc(word)}</b>${voice ? `<a class="chip" href="${href}">OPEN VOICE REFERENCE</a>` : ""}</div><small>${detail}</small></div>${conflictMarkup}`;
}
function voicePanel(c) {
  return `
  <div class="audio-panel">
    <div class="section-label">🎙 Voice — record the CLEAN master (degradation is post)</div>
    ${field("Voice reference (the voice this character speaks with)", voiceLinkOptionsMarkup(c))}
    ${voiceAuthorityMarkup(c)}
    <div class="section-label">Synthesis settings — how a voice might be generated, not who the voice is</div>
    ${field("ElevenLabs Voice Design prompt", taN(c, "audio", "voiceDesignPrompt", "characters", c.id, "natural-language voice description — age, register, cadence, texture, emotional register, audio quality"))}
    <div style="display:flex;gap:8px;margin:-4px 0 8px"><button class="copy-btn" onclick="copyText(((P.characters.find(x=>x.id==='${c.id}')||{}).audio||{}).voiceDesignPrompt||'')">COPY VOICE PROMPT</button></div>
    <div class="two-col">
      ${field("Voice tool", inpN(c, "audio", "voiceTool", "characters", c.id, "ElevenLabs Voice Design"))}
      ${field("Suno / alt voice prompt (optional)", taN(c, "audio", "sunoAltPrompt", "characters", c.id, "alternative voice generator prompt"))}
    </div>
    ${field("Voice notes (line-read direction, degradation-in-post, canon lines)", taN(c, "audio", "voiceNotes", "characters", c.id, "e.g. flat/procedural for logs; the L7 reset VO is the SAME clean take as L1"))}
  </div>`;
}
// scene music + ambience: ElevenLabs Music (primary) + Suno alt
function sceneAudioPanel(sc) {
  const a = sc.audio || {};
  return `
  <div class="audio-panel">
    <div class="section-label">🎵 Music & ambience — scene audio bed</div>
    <div class="two-col">
      ${field("Music — ElevenLabs Music prompt", taN(sc, "audio", "music", "scenes", sc.id, 'instrumentation + mood + texture; say "no melody" for a bed'))}
      ${field("Ambience / SFX bed", taN(sc, "audio", "ambience", "scenes", sc.id, "room tone, diegetic sources, motifs"))}
    </div>
    <div class="two-col">
      ${field("Music tool", inpN(sc, "audio", "musicTool", "scenes", sc.id, "ElevenLabs Music"))}
      ${field("Suno / alt music prompt (optional)", taN(sc, "audio", "sunoAltPrompt", "scenes", sc.id, "style/genre + mood tags"))}
    </div>
    ${field("Audio notes", taN(sc, "audio", "notes", "scenes", sc.id, "motif recurrence, mix direction, diegetic vs score"))}
    ${typeof sceneAudioPromptBuilderMarkup === "function" ? sceneAudioPromptBuilderMarkup(sc) : ""}
  </div>`;
}

function workspaceTabs(base, active, tabs) {
  return `<nav class="workspace-tabs">${tabs.map(([key, label, count]) => `<a class="workspace-tab ${active === key ? "on" : ""}" href="#/${base}/${key}">${esc(label)}${count != null ? ` <span>${count}</span>` : ""}</a>`).join("")}</nav>`;
}
/* WHICH FRAMES THIS SHOT CURRENTLY OWES, asked of the one readiness owner.
 *
 * `requiredFrames()` above reads `frame.required`, and newKeyframe() writes that `true`
 * on every frame of every project while no filmmaker-facing control writes it at all.
 * shared-shot-readiness.js is what decides requiredness from what the shot has actually
 * DECLARED, so a shot that has declared nothing — no route, no still delivery, no motion
 * unit — owes no frame there. Without this, the project log would go on reporting "1
 * required frame is not approved" for a shot the shot workspace correctly says owes
 * none: one fabrication, moved to a quieter screen.
 *
 * The stored flag survives as the fallback for the case readiness cannot answer at all,
 * where reporting nothing would be its own overclaim. The unit id format is
 * declaredUnits()'s own (`frame:<frameId>`), which is why this asks the module rather
 * than rebuilding its answer. */
function currentlyRequiredFrames(s, readiness) {
  if (!readiness) return requiredFrames(s);
  const required = new Set((readiness.units || [])
    .filter((unit) => unit.kind === "frame" && unit.required)
    .map((unit) => String(unit.id)));
  return (s.keyframes || []).filter((f) => required.has(`frame:${f.id}`));
}
function shotPlanningFlags(s, readiness = shotReadinessFor(s)) {
  normalizeShotV5(s);
  const frames = currentlyRequiredFrames(s, readiness),
    missingFrames = frames.filter((f) => !f.winner),
    missingMotion = (s.clips || []).filter(
      (c) =>
        !["post", "reuse", "hold"].includes(c.kind) &&
        !(c.motionPrompt || c.note || "").trim(),
    ),
    missingPackages = (s.clips || []).filter(
      (c) =>
        !["post", "reuse"].includes(c.kind) &&
        !(c.generationPackages || []).length,
    ),
    flfBlocked = (s.clips || []).filter(
      (c) =>
        c.kind === "flf" &&
        (!frameById(s, c.fromFrame)?.winner ||
          !frameById(s, c.toFrame)?.winner),
    );
  return { missingFrames, missingMotion, missingPackages, flfBlocked };
}
/* The readiness feed is derived ONCE and handed to every row. projectShotReadiness()
   evaluates the whole project on each call, so asking it per shot inside this loop would
   make a page that lists issues for N shots derive readiness N times. */
function projectHealthIssues(feed = projectShotReadiness()) {
  const issues = [];
  for (const s of P.shots) {
    const f = shotPlanningFlags(s, shotReadinessFor(s, feed));
    if (f.missingFrames.length)
      issues.push({
        type: "Frames",
        shot: s,
        msg: `${f.missingFrames.length} required frame${f.missingFrames.length === 1 ? " is" : "s are"} not approved`,
      });
    if (f.missingMotion.length)
      issues.push({
        type: "Motion",
        shot: s,
        msg: `${f.missingMotion.length} motion unit${f.missingMotion.length === 1 ? " needs" : "s need"} direction`,
      });
    if (f.flfBlocked.length)
      issues.push({
        type: "FLF",
        shot: s,
        msg: `${f.flfBlocked.length} first-to-last unit${f.flfBlocked.length === 1 ? " is" : "s are"} missing approved endpoints`,
      });
    if (!(s.desc || "").trim())
      issues.push({ type: "Plan", shot: s, msg: "Shot intent is empty" });
  }
  return issues;
}
function capabilityState(name) {
  return AGENT_STATUS?.capabilities?.[name] || {
    ready: false,
    message: `${name} capability is still being checked.`,
    action: "Open Settings to configure AI assistance.",
  };
}
function aiDisabledAttrs(name, extraRequirement = "") {
  const state = capabilityState(name),
    reason = [state.message, state.action, extraRequirement]
      .filter(Boolean)
      .join(" ");
  return `${state.ready ? "" : " disabled"}${state.ready ? "" : ` title="${attr(reason)}"`}${helpAttr(reason)}`;
}
window.refreshAgentStatus = async (render = false) => {
  try {
    const response = await fetch("/api/agents/status");
    if (response.ok) AGENT_STATUS = await response.json();
  } catch (_) {}
  if (render) route();
};

/* THE CANDIDATE A ROUTE CLAIMS, and the smallest mechanism that could carry it.
 *
 * `#/shot/<id>/review/<encoded projection key>`. A fourth and fifth path segment,
 * because route() reads the view at `split("/")[1]` and the id at `[2]` and every other
 * hash reader in the product does the same — public/focused-workspaces.js,
 * public/stage-surfaces.js, public/creator-surfaces.js, public/creator-state and
 * public/library-tools.js all stop at [2]. Nothing has to learn about the extra
 * segments, and the link is bookmarkable and shareable, which a hidden ownership store
 * would not be. A QUERY was not an option and public/live-activity.js says why: `?` is
 * not stripped before the id is read, so `#/shot/L1-01?review=x` resolves to no shot.
 *
 * The key is encodeURIComponent'd, so the `:` and `/` inside `path:shots/…` cannot add
 * segments of their own and the split stays exactly five parts.
 *
 * WHY THE ROUTE CARRIES IT AT ALL, since the shot workspace can derive the pending
 * review itself: because deriving it is exactly what must NOT happen when the claim is
 * stale. Production names candidate A; if A is decided before the link is opened, a
 * workspace that simply re-derived would present candidate B with no explanation and the
 * filmmaker's next decision would be about a file they never asked to see. */
function routeReviewClaim(hash = location.hash) {
  const parts = String(hash || "").split("/");
  if ((parts[1] || "") !== "shot" || (parts[3] || "") !== "review") return "";
  const raw = parts.slice(4).join("/");
  if (!raw) return "";
  try { return decodeURIComponent(raw); } catch { return raw; }
}
function shotReviewHref(shotId, reviewKey) {
  const base = `#/shot/${encodeURIComponent(shotId || "")}`;
  return reviewKey ? `${base}/review/${encodeURIComponent(reviewKey)}` : base;
}

/* THE ONE CALL INTO THE RETURNED-REVIEW PROJECTION.

   public/shared-returned-review.js is the single answer to "what returned media is
   waiting for a person, and which exact candidate owns that decision". It derives from
   public/shared-production-media.js — durable disposition, human decision, correction
   lineage — and from nothing else, so this function's whole job is assembling the same
   four inputs public/media-inspector.js assembles, from the app's own lexical bindings.

   THE BINDINGS ARE READ THROUGH `typeof`, NOT OFF `window`. P, SCAN and the generation
   ledger flags are lexical `let`s in this file; a module that read `window.P` would find
   undefined in a real browser and fail in total silence. */
function returnedReviewProjectionForBrowser() {
  if (typeof returnedReviewProjection !== "function") return null;
  return returnedReviewProjection({
    project: P,
    scan: typeof SCAN === "undefined" ? {} : SCAN,
    jobs: typeof FAL_GENERATION_JOBS === "undefined" ? [] : FAL_GENERATION_JOBS,
    /* The honest flag rather than `jobs.length`: the ledger is only requested when
       generation is enabled and keyed. */
    jobsAvailable: typeof FAL_GENERATION_LEDGER_LOADED === "undefined" ? false : FAL_GENERATION_LEDGER_LOADED === true,
    entityMedia: typeof entityMedia === "function" ? entityMedia : undefined,
    describeCorrection: describeReturnedCorrectionIntent,
  });
}
/* WHAT THE FILMMAKER ASKED FOR WHEN THEY SENT THIS BACK, and only if it was recorded.

   The correction package freezes the review that produced it as `reviewSnapshot`, and
   the shipped candidateCorrectionIssues() is what turns that into the list a correction
   prompt is built from. Reusing it is the point: the summary a filmmaker reads beside a
   repaired candidate names the same failures the repair was actually asked to fix. A
   build that cannot be resolved returns "", which the projection reports as no recorded
   intent rather than as an empty one. */
function describeReturnedCorrectionIntent(buildId) {
  if (!buildId || typeof resolvePromptBuild !== "function") return "";
  const build = resolvePromptBuild(P, buildId);
  if (!build || build.missing) return "";
  if (typeof candidateCorrectionIssues !== "function") return "";
  const issues = candidateCorrectionIssues(build.reviewSnapshot);
  if (!issues.length) return "";
  return issues.map((issue) => issue.referenceLabel || issue.label).filter(Boolean).join(", ");
}

/* RETURNED RESULTS, AND NOTHING ELSE. THE NAME IS THE FIX.
 *
 * This used to be called `projectDecisionItems`, and it fed two surfaces: the
 * Returned Results inbox, where it is exactly right, and the Production summary
 * tile labelled "N decisions waiting", where it was a rival answer to a question
 * canonical readiness already owns. A project with three outstanding filmmaker
 * decisions and no unreviewed candidate rendered "0 decisions waiting" beside
 * "1 DECISION · 0 BLOCKED" beside "3 existing selections need your confirmation",
 * in one viewport, and every one of those numbers was correct about its own scope.
 *
 * The scope this answers is narrow and worth answering: WHICH RETURNED CANDIDATES
 * ARE SITTING UNREVIEWED. It is a workflow queue over media that came back, it
 * makes no claim about authority, and it is not the filmmaker-decision count —
 * that is projectFilmmakerDecisions(), derived from readiness and from nothing
 * else. The word "decision" does not appear in what this renders.
 *
 * SLICE 3 CHANGED WHERE THE SHOT ROWS COME FROM AND NOTHING ELSE ABOUT THEM.
 *
 * The per-frame and per-shot-motion arithmetic that used to live here is now
 * public/shared-returned-review.js's, verbatim — including the deliberate asymmetry
 * that a FRAME settles on its own pick while MOTION settles at the shot. This function
 * GROUPS that queue into the rows the Returned Results inbox has always rendered.
 *
 * The reason is not tidiness. The shot workspace has to open on the exact candidate
 * that owns the review, and a second derivation of "which candidate is that" would be
 * free to disagree with the number Production is showing — a filmmaker told two results
 * are waiting, sent to a shot that offers a decision about neither. They now read one
 * array, so the count and the thing you are taken to cannot come apart.
 *
 * ENTITY REFERENCE ROWS ARE UNTOUCHED. Reference approval is a per-entity queue with
 * its own route and its own words, and the reference-demand model is out of scope for
 * this slice, so it is composed here rather than folded into the projection. */
function returnedResultsAwaitingReview(projection = returnedReviewProjectionForBrowser()) {
  const items = [];
  const queue = (projection && projection.queue) || [];
  for (const shot of P.shots || []) {
    const mine = queue.filter((row) => row.shotId === shot.id);
    const frames = mine.filter((row) => row.owner.kind === "shot-frame");
    const videos = mine.filter((row) => row.owner.kind === "shot-motion");
    /* `reviewKey` is the projection's own key for the FIRST candidate of this row, in
       the projection's own order. It is what makes Production's REVIEW RETURNED RESULT
       land on a named candidate instead of on a shot page. */
    if (frames.length) items.push({ shot, type: "image", count: frames.length, reviewKey: frames[0].key, label: `${frames.length} frame candidate${frames.length === 1 ? "" : "s"} to review` });
    if (videos.length) items.push({ shot, type: "video", count: videos.length, reviewKey: videos[0].key, label: `${videos.length} video candidate${videos.length === 1 ? "" : "s"} to review` });
  }
  for (const [list, route, label] of [["characters","character","Character"],["locations","location","Location"],["props","prop","Prop"],["audio","sound","Audio"]]) {
    for (const entity of P[list] || []) {
      const media = entityMedia(list, entity);
      const approved = entityApprovedFileForState(entity, "");
      if (media.length && !approved) items.push({ entity, route, type: "reference", count: media.length, reviewKey: "", label: `${label} reference needs approval` });
    }
  }
  return items;
}
/* HOW MANY RESULTS THESE ROWS ADD UP TO, and it is the number the rows themselves state.
 *
 * A shot row says "3 frame candidates to review" and stands for three decisions. An
 * entity row says "Character reference needs approval" and stands for ONE, whatever the
 * number of unapproved files behind it — that queue is per-entity and its own label
 * never claims otherwise. Summing `count` across both would put a number on screen that
 * no row underneath it accounts for, which is the divergence this slice exists to
 * remove. Both the Returned Results headline and Production's action read this. */
function returnedResultCount(items) {
  return (items || []).reduce((sum, item) => sum + (item.shot ? Number(item.count) || 1 : 1), 0);
}
function productionResultInbox(limit = 6) {
  const items = returnedResultsAwaitingReview();
  /* THE HEADLINE COUNTS WHAT THE ROWS ADD UP TO.
   *
   * Slice 3. This counted GROUPED ROWS while every row underneath it stated its own
   * candidate count, so a project with three candidates in one shot and one in another
   * read "2 returned results waiting for review" above rows reading "3 frame candidates
   * to review" and "1 frame candidate to review". Both numbers were derived from the
   * same array and neither was wrong about its own scope, which is precisely the class
   * of divergence Slice 1 removed everywhere else. */
  const waiting = returnedResultCount(items);
  /* THE HEADLINE NAMES ITS OWN SCOPE, IN BOTH DIRECTIONS. "Nothing waiting for
     review" was true of this queue and read as a statement about the whole
     production; "N decisions waiting" borrowed the word the Production summary
     uses for something else. Both now say `returned result`, which is the only
     thing this section has ever been about, so an empty inbox can sit beside an
     outstanding filmmaker decision without the two contradicting each other. */
  return `<section class="production-inbox"><header><div><span>RETURNED RESULTS</span><h2>${items.length ? `${plural(waiting, "returned result")} waiting for review` : "No returned result is waiting for review"}</h2><p>Results uploaded inside a frame or motion step appear here automatically. Decisions about approved work are shown above, in Production.</p></div></header>${items.length ? `<div class="production-inbox-list">${items.map((item) => {
    if (item.shot) {
      const takes = takesFor(item.shot.id), media = item.type === "video" ? takes.filter((take) => isVideo(take.name)).at(-1) : takes.filter((take) => !isVideo(take.name) && !isAudio(take.name)).at(-1);
      const preview = media ? (isVideo(media.name) ? `<video muted preload="metadata" src="${attr(media.url)}#t=0.1"></video>` : `<img src="${attr(media.url)}" alt="">`) : `<span>${item.type === "video" ? "VIDEO" : "FRAME"}</span>`;
      /* The row navigates to the shot; inspecting the candidate must not. */
      const enlarge = media && !isVideo(media.name)
        ? `<button type="button" class="media-enlarge-btn production-enlarge" onclick="event.preventDefault();event.stopPropagation();inspectMediaFile('${attr(encodeURIComponent(media.url))}','${attr(media.assetId || "")}','${attr(encodeURIComponent(`${item.shot.id} · ${media.name}`))}','image')" aria-label="Inspect the ${attr(item.shot.id)} candidate">Inspect</button>`
        : "";
      return `<div class="production-inbox-shell"><a href="#/shot/${item.shot.id}" class="production-inbox-item"><div style="${attr(shotWellStyle(item.shot))}">${preview}</div><section><b>${esc(item.shot.id)} · ${esc(item.shot.title)}</b><small>${esc(item.label)}</small></section><i>Review →</i></a>${enlarge}</div>`;
    }
    return `<a href="#/${item.route}/${item.entity.id}" class="production-inbox-item"><div><span>REF</span></div><section><b>${esc(item.entity.name || item.entity.id)}</b><small>${esc(item.label)}</small></section><i>Review →</i></a>`;
  }).join("")}</div>` : `<div class="production-inbox-empty">Newly returned images, videos, upscales, and reference candidates will collect here.</div>`}</section>`;
}
/* ---------------------------------------------------------------------------
   SHOT READINESS — THE BROWSER'S OWN CALL INTO THE SHARED DERIVATION.

   public/shared-shot-readiness.js is the single answer, and both callers ask it
   the same question with their own media oracle: the server hands it a directory
   listing built from readdir, this hands it the listing the app already holds. The
   semantics are not restated here, because a second statement of them is how three
   satisfaction predicates came to disagree in the first place.

   THE POOL IS THE UNFILTERED ONE, DELIBERATELY. entityMedia() applies the ownership
   filter and is the APPROVAL-CAPABLE pool; readiness is asking the different
   question "does this project still have the exact bytes this receipt names", and
   answering it through the ownership filter would report a present-but-unowned file
   as `approved-bytes-missing` — the wrong problem, with the wrong next action.
   Ownership is reported separately, as `contested-media-ownership` and as the
   per-row confirmation veto. */
function readinessOracleForBrowser() {
  return {
    mediaListing: (list) => (typeof entityMediaPool === "function" ? entityMediaPool(list) : []),
    shotMediaListing: (shotId) => takesFor(shotId),
  };
}
function projectShotReadiness() {
  if (typeof evaluateProjectReadiness !== "function") return null;
  try {
    return evaluateProjectReadiness(P, readinessOracleForBrowser());
  } catch (error) {
    /* A derivation that cannot run must not blank the production view. It says so
       instead, which is also how a missing shared module becomes visible rather
       than becoming a silently empty feed. */
    return { error: error.message || "Readiness could not be derived", counts: null, shots: [], historic: { items: [], uniqueTargets: 0, occurrences: 0 } };
  }
}
/* ===========================================================================
   ONE FILMMAKER-DECISION PROJECTION.

   "What meaningful decision needs me now?" had four answers on one screen, and
   three of them were derived somewhere other than canonical readiness. This is the
   only place that question is answered, and every surface that shows a number under
   the word DECISION reads it from here: the Production summary tile, the readiness
   pill, the scene cards and the shot board filters.

   IT DERIVES NOTHING. Every row is a shot readiness row the shared module already
   produced, filtered by the status that module already assigned. There is no
   threshold here, no ranking, no priority number and no second predicate — if this
   file ever decides on its own that something is a decision, the defect is back.

   ONE CORRUPT LEDGER IS ONE DECISION, not one per shot. When the project carries a
   truth problem every shot reports NEEDS_DECISION with `awaiting-project-repair`,
   because no shot's readiness can be answered — and counting those as N filmmaker
   decisions would be the same lie of aggregation shared-shot-readiness.js removed
   when one broken file produced one repair action per shot. The project's own
   single action is what is counted, and the shots are reported as unanswerable.

   WHAT IS DELIBERATELY NOT COUNTED HERE, each because it has its own named scope:
     returned candidates awaiting review   returnedResultsAwaitingReview()
     existing selections to confirm        feed.historic — grouped by authority
                                           target, so N shots sharing one reference
                                           are one confirmation, not N
     project setup items                   /api/project/readiness `setup`
     generation jobs and runs              the activity layer
   Each is a real, useful count. None of them is "decisions", and none of them may
   be rendered with that word. */
const FILMMAKER_DECISION_LABEL = "decision";
function projectFilmmakerDecisions(feed = projectShotReadiness()) {
  const rows = feed && !feed.error ? (feed.shots || []) : [];
  /* `delivered`, not `final`: the board, the tiles and the scene cards have always
     called this state Delivered, and the readiness rollup's COMPLETE is the same
     state. "Mark shot final" names the ACTION that reaches it. */
  const delivered = rows.filter((row) => row.status === "COMPLETE").map((row) => row.shotId);
  const blocked = rows.filter((row) => row.status === "BLOCKED").map((row) => row.shotId);
  if (!feed || feed.error) return { available: false, count: 0, shots: [], blocked, delivered, unanswerable: [], project: null };
  if (feed.truthProblem) {
    return {
      available: true,
      count: 1,
      shots: [],
      blocked,
      delivered,
      unanswerable: rows.map((row) => row.shotId),
      project: { code: feed.nextAction?.code || "repair-authority-ledger", message: feed.truthProblem.message },
    };
  }
  const shots = rows
    .filter((row) => row.status === "NEEDS_DECISION")
    .map((row) => ({ shotId: row.shotId, code: row.nextAction?.code || "", message: row.nextAction?.message || "" }));
  return { available: true, count: shots.length, shots, blocked, delivered, unanswerable: [], project: null };
}
/* The same projection, narrowed to one scene's shots. Scene cards summarise by
   READING THIS, never by re-deriving a scene-local status vocabulary of their own —
   which is how "1 shot waiting for review" came to sit under a summary tile
   reporting a different number for the same production. */
function sceneFilmmakerDecisions(sceneId, decisions = projectFilmmakerDecisions()) {
  const ids = new Set(P.shots.filter((shot) => shot.scene === sceneId).map((shot) => shot.id));
  const within = (list) => (list || []).filter((id) => ids.has(id));
  return {
    available: decisions.available,
    total: ids.size,
    count: decisions.shots.filter((row) => ids.has(row.shotId)).length,
    blocked: within(decisions.blocked).length,
    delivered: within(decisions.delivered).length,
    unanswerable: within(decisions.unanswerable).length,
  };
}
/* THE WORDS. A bare READY badge implies the shot will finish; it will not — it will
   run to its next human gate. So the status never appears without the action it is
   the status OF. The tokens come from the shared module; only the wording is here,
   for the same reason shared-stage-model.js leaves STAGE_STATUS in the UI layer. */
const READINESS_STATUS_WORDS = {
  READY: "READY",
  BLOCKED: "BLOCKED",
  NEEDS_DECISION: "NEEDS DECISION",
  COMPLETE: "COMPLETE",
};
const READINESS_ACTION_WORDS = {
  "repair-authority-ledger": "Repair the approval records",
  "awaiting-project-repair": "Await project repair",
  "establish-media-availability": "Check approved media",
  "confirm-existing-reference": "Confirm existing reference",
  "reapprove-revoked-reference": "Re-approve withdrawn reference",
  "resolve-relationship": "Resolve a shot input",
  "remove-stale-state-declaration": "Remove the stale state declaration",
  "resolve-state-declaration": "Resolve the declared state",
  "resolve-frame-state-declaration": "Resolve the frame state",
  "repair-presence-declaration": "Repair the frame presence",
  "resolve-media-ownership": "Resolve the media claim",
  "declare-producible-unit": "Declare what this shot produces",
  /* Not "Declare the delivery route": the contract's word is `deliveryRoute` and the
     filmmaker's question is how the shot gets made. Same rule as `mark-shot-final`
     above — the ledger's noun stays in the ledger. */
  "declare-shot-route": "Choose how this shot is made",
  "supply-approved-media": "Supply approved media",
  "prepare-references": "Prepare required references",
  "approve-parent-frame": "Approve the previous frame",
  "approve-required-frames": "Approve required frames",
  "produce-frame": "Produce the frame",
  "produce-motion": "Produce the motion",
  /* The durable decision, in the filmmaker's words rather than the ledger's. It is
     deliberately not "Approve" — this project already uses that word for accepting
     bytes, and the whole point of this action is that it is the OTHER decision. */
  "mark-shot-final": "Mark shot final",
  "nothing-outstanding": "Nothing outstanding",
};
function readinessActionWords(action) {
  const label = READINESS_ACTION_WORDS[action?.code] || "Next action";
  const count = Number(action?.count) || 0;
  /* Count-aware here rather than in the model, so "1 reference" never renders as
     "1 references" and the model keeps returning a token plus a number. */
  if (count > 1 && action?.code === "prepare-references") return `Prepare ${count} required references`;
  if (count > 1 && action?.code === "approve-required-frames") return `Approve ${count} required frames`;
  if (count > 1 && action?.code === "supply-approved-media") return `Supply ${count} approved files`;
  return label;
}
/* ==========================================================================
   AT1-F — THE SAME ANSWER, WORDED FOR A CONTROL THAT TRAVELS TO IT.

   READINESS_ACTION_WORDS above names the ACT. A control that PERFORMS the act
   should wear those words, and the two that do — Confirm in the historic queue,
   Mark shot final in Finish & Delivery — already do.

   THE DEFECT WAS THE OTHER HALF. Production's NEXT ACTION card is an `<a href>`
   and #/create's recommended card is a button that sets `location.hash`. Both
   were labelled with the ACT: "CONFIRM EXISTING REFERENCE →" on a link that
   confirms nothing, and "MARK SHOT FINAL →" on a link that marks nothing —
   sitting in the same product as a real Mark shot final button that does. Two
   visible controls, the same words, and only one of them performs the act. A
   filmmaker who pressed the wrong one had not made the decision they had just
   been told they were making.

   So a navigating control says where it goes. The action codes are the SAME
   codes — this is a second rendering of one answer, never a second answer — and
   the arrow the cards already append reads as travel rather than decoration.

   The fallback is deliberately "Open the next action" rather than a guess: a
   code with no phrasing here still describes travel truthfully. */
const READINESS_NAVIGATION_WORDS = {
  "repair-authority-ledger": "Open the approval records",
  "awaiting-project-repair": "Open project repair",
  "establish-media-availability": "Review approved media",
  "confirm-existing-reference": "Open confirmation",
  "reapprove-revoked-reference": "Review withdrawn reference",
  "resolve-relationship": "Open the shot input",
  "remove-stale-state-declaration": "Open the stale declaration",
  "resolve-state-declaration": "Open the declared state",
  "resolve-frame-state-declaration": "Open the frame state",
  "repair-presence-declaration": "Open the frame presence",
  "resolve-media-ownership": "Open the media claim",
  "declare-producible-unit": "Open what this shot produces",
  "declare-shot-route": "Open how this shot is made",
  "supply-approved-media": "Open approved media",
  "prepare-references": "Review required references",
  "approve-parent-frame": "Review the previous frame",
  "approve-required-frames": "Review required frames",
  "produce-frame": "Open the frame workspace",
  "produce-motion": "Open the motion workspace",
  "mark-shot-final": "Open the finish decision",
  "nothing-outstanding": "Open the shot",
};
function readinessNavigationWords(action) {
  return READINESS_NAVIGATION_WORDS[action?.code] || "Open the next action";
}
function historicConfirmationMarkup(feed) {
  const queue = feed?.historic;
  if (!queue?.items?.length) return "";
  const rows = queue.items.map((item) => {
    const shots = item.shotIds.length;
    const refused = item.ownership.wouldRefuse;
    const action = refused
      /* AT1-B/G. THE REQUIREMENT IS RENDERED, NOT HIDDEN IN A TOOLTIP. `reason`
         is now the kernel's own refusal sentence, which already names the file,
         what is wrong and what would resolve it — so it belongs on the screen at
         full length rather than truncated beside a `title` a pointer has to find.
         And `wouldRefuse` is now the kernel's own preflight rather than this
         surface's guess at it, so a row that reads Cannot confirm is a row the
         writer would genuinely refuse, and a row that offers Confirm is one it
         would genuinely accept. */
      ? `<span class="prompt-check warn"${item.ownership.code ? ` data-refusal-code="${attr(item.ownership.code)}"` : ""}><b>Cannot confirm yet</b><span>${esc(item.ownership.reason || "This file is not owned by this reference.")}</span></span>`
      : `<button class="approve-btn" onclick="confirmHistoricSelection('${attr(item.key)}')">Confirm</button>`;
    return `<li><div><b>${esc(item.label)}</b><small>${esc(item.value || "no file recorded")} · ${esc(item.key)}</small><em>Satisfies ${plural(item.requirementCount, "shot requirement")} across ${plural(shots, "shot")}</em>${actionRefusalMarkup(`historic-confirmation:${item.key}`)}</div>${action}</li>`;
  }).join("");
  const confirmable = queue.items.filter((item) => !item.ownership.wouldRefuse).length;
  /* THE BULK ACTION IS NOT A BLIND SHORTCUT. Every row it would write is listed
     directly above it, with its authority target, its file and what it unblocks, and
     the button names the exact count. It confirms only what is shown. */
  const bulk = confirmable > 1
    ? `<div class="historic-confirm-bulk"><button class="assemble-btn" onclick="confirmAllListedHistoricSelections()">Confirm the ${confirmable} listed above</button><small>Confirming is approving. Each one writes a production approval you can withdraw later.</small></div>`
    : "";
  /* SHIPS CLOSED, and nothing about it is hidden: the summary line carries the
     count, the word `confirmation` and the number of requirements it covers, and
     the NEXT ACTION card above states the first of these decisions outright. What
     changes is that four rows of administration no longer own the first viewport
     of a film's production page. One click is the whole list back. */
  return `<details class="production-readiness historic-confirm" data-readiness-action-surface="production-historic-confirmation"><summary><div><span>EXISTING SELECTIONS</span><b>${plural(queue.uniqueTargets, "existing selection")} need${queue.uniqueTargets === 1 ? "s" : ""} your confirmation</b></div><span>${queue.occurrences} REQUIREMENT${queue.occurrences === 1 ? "" : "S"}</span></summary><div class="historic-confirm-body"><p>These references are already in the project and nobody has approved them. Confirming one approves it everywhere it is used.</p><ul class="historic-confirm-list">${rows}</ul>${bulk}</div></details>`;
}
function shotReadinessFeedMarkup(feed, decisions = null) {
  if (!feed) return "";
  if (feed.error) return `<details class="production-readiness"><summary><div><span>PRODUCTION READINESS</span><b>Readiness could not be derived</b></div><span>UNAVAILABLE</span></summary><div class="production-readiness-list"><p>${esc(feed.error)}</p></div></details>`;
  const counts = feed.counts || { ready: 0, blocked: 0, needsDecision: 0, complete: 0 };
  /* ONE PROJECT TRUTH PROBLEM, RENDERED ONCE.
   *
   * The audit's second blocker: one corrupt ledger and three shots produced three
   * `repair-authority-ledger` rows and this renderer drew all three, because it
   * ignored `feed.truthProblem` and mapped each shot independently. The model now
   * emits the repair once, at the project level, and this reads it there. The shots
   * still appear — their readiness genuinely cannot be answered — but they say so
   * without each asking for the same repair. */
  const problem = feed.truthProblem
    ? `<div class="readiness-truth-problem" data-readiness-action-surface="production-project-repair" data-readiness-truth-problem="${attr(feed.truthProblem.reason)}"><b>${esc(readinessActionWords(feed.nextAction))}</b><span>${esc(feed.truthProblem.message)}</span>${feed.truthProblem.diagnostics?.length ? `<small>${esc(feed.truthProblem.diagnostics.map((row) => row.code).filter(Boolean).join(", "))}</small>` : ""}</div>`
    : "";
  const rows = (feed.shots || []).map((shot) => {
    const status = READINESS_STATUS_WORDS[shot.status] || shot.status;
    return `<a href="#/shot/${attr(shot.shotId)}"><b>${esc(shot.shotId)}</b><span class="readiness-status readiness-${attr(String(shot.status).toLowerCase())}">${esc(status)} · ${esc(readinessActionWords(shot.nextAction))}</span><small>${esc(shot.nextAction?.message || "")}</small><i>Open →</i></a>`;
  }).join("");
  /* The headline says what READY MEANS. "12 shots have work that can start now" is
     the claim this model supports; "12 shots will finish" is not. */
  const headline = feed.truthProblem
    ? "Readiness cannot be answered yet"
    : `${plural(counts.ready, "shot")} ${counts.ready === 1 ? "has" : "have"} work that can start now`;
  /* THE PILL READS THE ONE DECISION PROJECTION, NOT `counts.needsDecision`.
     They agree on an ordinary project and deliberately do not agree on a broken
     one: when the ledger cannot be read, every shot reports NEEDS_DECISION about
     the SAME single repair, and a pill saying "12 DECISIONS" there would send a
     filmmaker looking for twelve things to decide. */
  const decided = decisions || projectFilmmakerDecisions(feed);
  const pill = decided.available
    ? `${decided.count} ${FILMMAKER_DECISION_LABEL.toUpperCase()}${decided.count === 1 ? "" : "S"} · ${counts.blocked} BLOCKED`
    : "UNAVAILABLE";
  return `<details class="production-readiness shot-readiness" data-readiness-verdict="1" data-filmmaker-decisions="${attr(String(decided.count))}" ${counts.ready || feed.truthProblem ? "open" : ""}><summary><div><span>PRODUCTION READINESS</span><b>${esc(headline)}</b></div><span>${esc(pill)}</span></summary>${problem}<div class="production-readiness-list shot-readiness-list">${rows || "<p>This project has no shots yet.</p>"}</div>${feed.mediaCheck === "not-checked" ? `<p class="readiness-media-note">Readiness has not been given a media listing, so every approval's file is reported as unverified rather than assumed present.</p>` : ""}</details>`;
}
/* THE LEGACY PROJECTION, AS WHAT IT ACTUALLY IS.
 *
 * The audit's first blocker was that this block rendered "PROJECT READINESS — READY"
 * from an empty `issues` list at the same moment the canonical derivation said
 * NEEDS_DECISION about the same unconfirmed reference. The list is worth keeping —
 * missing descriptions, missing durations, missing canon text, unrelinked references
 * and files absent from disk are all real and all actionable — but it answers
 * whether the project is SET UP, not whether a shot can be produced.
 *
 * So the eyebrow, the headline and the pill all say setup, and the words READY and
 * NEEDS ATTENTION do not appear here at all. It is not styled into submission: it
 * has stopped making the claim. */
function projectSetupIssuesMarkup(setup) {
  const issues = setup?.issues || [];
  return `<details class="production-readiness project-setup" data-project-setup="1"><summary><div><span>PROJECT SETUP</span><b>${issues.length ? `${plural(issues.length, "setup item")} to resolve` : "No setup items found"}</b></div><span>${issues.length} ITEM${issues.length === 1 ? "" : "S"}</span></summary><div class="production-readiness-list">${issues.map((issue) => `<a href="${attr(issue.href || "#/production")}"${issue.kind === "unresolved-reference" && issue.targetId ? ` onclick="boundedWriteFocusedTask('${SHOT_STAGE_SCOPE}','${attr(issue.targetId)}','inputs')"` : ""}><b>${esc(String(issue.kind || "setup").replace(/-/g," "))}</b><span>${esc(issue.message || "Setup item")}</span><i>Open →</i></a>`).join("") || `<p>No missing descriptions, durations, canon text, reference pointers or absent files were found. This says nothing about whether a shot can be produced — see Production readiness above.</p>`}</div></details>`;
}
/* CONFIRMATION IS APPROVAL, AND IT GOES THROUGH THE SHIPPED COMMAND.
 *
 * There is no second approval system here and no bypass: each row calls the same
 * kernel command the approval modal calls, synchronously, inside the click that is
 * the human's decision. The kernel applies its own ownership veto, its own ledger
 * validation and its own receipt schema, so a row this surface offered but the
 * kernel refuses is REPORTED — never silently skipped and never forced. */
function commitHistoricConfirmation(item, at) {
  const target = item.target || {};
  if (target.kind === "entity-state") {
    approveEntityStateCanon(P, {
      list: target.list, entityId: target.entityId, stateId: target.stateId,
      value: item.value, assetId: item.assetId || "", at, via: "readiness-historic-confirmation",
    });
    return;
  }
  if (target.kind === "shot-frame") {
    approveFrameCanon(P, {
      shotId: target.shotId, frameId: target.frameId,
      value: item.value, assetId: item.assetId || "", at, via: "readiness-historic-confirmation",
    });
    return;
  }
  throw new Error(`CineBraid cannot confirm a ${target.kind || "unknown"} selection from this surface.`);
}
window.confirmHistoricSelection = (key) => {
  const refusalKey = `historic-confirmation:${key}`;
  clearActionRefusal(refusalKey);
  const feed = projectShotReadiness();
  const item = (feed?.historic?.items || []).find((row) => row.key === key);
  if (!item) return toast("That selection is no longer waiting for confirmation");
  try {
    commitHistoricConfirmation(item, new Date().toISOString());
  } catch (error) {
    /* AT1-G. This was a toast and nothing else: the Confirm button was still
       sitting there, unchanged, two seconds later, with no record of what the
       kernel had refused or what would resolve it. The kernel's own sentence is
       kept — it names the file, the reason and the next step. */
    recordActionRefusal(refusalKey, error.message || "That selection could not be confirmed", error.code || "");
    route();
    return toast(error.message || "That selection could not be confirmed");
  }
  dirty();
  route();
  toast(`Confirmed ${item.label}`);
};
window.confirmAllListedHistoricSelections = () => {
  const feed = projectShotReadiness();
  const items = (feed?.historic?.items || []).filter((row) => !row.ownership.wouldRefuse);
  if (!items.length) return toast("Nothing listed can be confirmed");
  /* ONE TIMESTAMP FOR ONE DECISION, and no `await` anywhere in this loop — the
     trusted gesture is the event currently being dispatched, and a suspension
     between two of these would end it partway through. */
  const at = new Date().toISOString();
  const confirmed = [], refused = [];
  for (const item of items) {
    const refusalKey = `historic-confirmation:${item.key}`;
    clearActionRefusal(refusalKey);
    try {
      commitHistoricConfirmation(item, at);
      confirmed.push(item.label);
    } catch (error) {
      /* AT1-G. The summary toast can only name the first refusal and then clears
         itself, so a bulk confirm that refused three rows left two of them with no
         explanation anywhere. Each refusal is recorded against its OWN row. */
      recordActionRefusal(refusalKey, error.message || "That selection could not be confirmed", error.code || "");
      refused.push(`${item.label}: ${error.message || "refused"}`);
    }
  }
  if (refused.length) route();
  if (confirmed.length) { dirty(); route(); }
  toast(refused.length
    ? `Confirmed ${confirmed.length}; ${refused.length} refused — ${refused[0]}`
    : `Confirmed ${plural(confirmed.length, "existing selection")}`);
};
async function productionHomeView() {
  /* `setup` only. The readiness VERDICT is derived locally from P below, through the
     same shared module the server uses — so the screen cannot end up showing an
     answer one request out of date, and there is no second verdict arriving over the
     wire to disagree with it. */
  let setup = { issues: [] };
  try {
    const response = await fetch("/api/project/readiness", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.setup) setup = data.setup;
  } catch {}
  /* Derived here rather than read off the fetched payload, so the feed is correct
     the instant a confirmation is written instead of one request later. The server
     answers the same question through the same module for its own callers.

     Derived ONCE and handed to both readers: the readiness panel and the NEXT
     ACTION card are two renderings of one answer, and evaluating the whole project
     twice per paint would be the cost of pretending otherwise. */
  const shotReadiness = projectShotReadiness();
  /* THE SAME ANSWER #/create SHOWS. One derivation, two screens. */
  /* AT1-C. Both the words on the primary control and what pressing it does come
     from this one value; `next` stays for the NEXT ACTION card below, which is a
     rendering of the same answer. */
  const primaryAction = projectPrimaryProductionAction(shotReadiness);
  const next = primaryAction.next;
  /* ONE COUNT, ONE MEANING, AND THE SAME OBJECT EVERY SUMMARY ON THIS PAGE READS.
     Derived once from the readiness answer already in hand, and handed down to the
     summary tile, the readiness pill and every scene card below. */
  const decisions = projectFilmmakerDecisions(shotReadiness);
  const hasShots = P.shots.length > 0;
  /* Three different states of a shot, counted three different ways, so each tile is
     labelled with the one it actually reports:
       delivered — a final still or video file is recorded on the shot
       approved  — the shot's workflow status is APPROVED (it may still need delivery)
       waiting   — a returned result is sitting unreviewed in the inbox           */
  /* Both sides of this now answer from the same place: `decisions.delivered` is the
     readiness rollup's COMPLETE set, and shotIsDelivered() asks the shared delivery
     projection. The fallback exists for a project whose readiness could not be
     derived at all, and it is no longer a different opinion. */
  const deliveredCount = decisions.available ? decisions.delivered.length : P.shots.filter(shotIsDelivered).length;
  const approvedCount = P.shots.filter(shotIsApproved).length;
  const readinessByShot = new Map((shotReadiness?.shots || []).map((row) => [row.shotId, row]));
  const deliveredIds = new Set(decisions.delivered || []);
  const isDelivered = (shot) => (decisions.available ? deliveredIds.has(shot.id) : shotIsDelivered(shot));
  const activeRows = P.shots.map((shot) => ({ shot, next: shotProductionNextAction(shot, readinessByShot.get(shot.id)) }))
    .filter((row) => !isDelivered(row.shot)).slice(0, 8);
  return `<div class="view-head production-home-head"><div><div class="eyebrow">Production</div><span class="view-title">${esc(P.meta.title)}</span><div class="view-sub">Continue the film from the next unfinished decision. Detailed tools stay inside each shot.</div></div><div class="production-home-actions"><button class="${next ? "ghost-btn" : "assemble-btn"}" onclick="continueProduction()">${esc(primaryAction.label)}</button><button class="add-btn" onclick="openContextualAdd('shot')">＋ Add shot</button></div></div>
  <div class="production-summary"><article title="A shot is delivered once you have marked it final in Finish &amp; Delivery. That decision is recorded as a production approval you can withdraw later, and a leftover file pointer with no approval behind it does not count."><b>${deliveredCount}/${P.shots.length}</b><span>${pluralWord(P.shots.length, "shot")} delivered</span></article><article title="A shot is signed off once its workflow status reaches Signed off. Signing a shot off is not the same as delivering it, and neither one approves an image."><b>${approvedCount}/${P.shots.length}</b><span>${pluralWord(P.shots.length, "shot")} signed off</span></article><article class="${decisions.available && decisions.count ? "review" : ""}" title="Shots that cannot move without a decision only you can make. This is the one decision count in CineBraid: the readiness list, the scene cards and the shot filters all report this same number.">${decisions.available ? `<b>${decisions.count}</b><span>${pluralWord(decisions.count, FILMMAKER_DECISION_LABEL)} ${decisions.count === 1 ? "needs" : "need"} you</span>` : `<b>—</b><span>decisions unavailable</span>`}</article><article><b>${mmss(P.shots.reduce((sum, shot) => sum + shotDur(shot), 0))}</b><span>planned runtime across ${plural(P.scenes.length, "scene")}</span></article></div>
  <!-- THE ORDER OF THIS PAGE IS THE POINT.
       What to do now, then the outstanding decisions behind it, then the detail.
       The next action used to render THIRD, below a four-row confirmation backlog
       that filled the first viewport with administration -- and the backlog's own
       first row is usually this very action, so the page led with the long form of
       its own answer. Nothing is derived differently; the card is the same card. -->
  ${next ? `<section class="production-next" data-next-action-kind="${attr(next.kind)}"${next.shotId ? ` data-next-action-shot="${attr(next.shotId)}"` : ""}${next.unblocks ? ` data-next-action-unblocks="${attr(String(next.unblocks))}"` : ""}><div><span>NEXT ACTION</span><h2>${esc(next.title)}</h2><p>${esc(next.message)}</p></div><a class="assemble-btn" href="${attr(next.href)}">${esc(next.actionLabel)} →</a></section>` : hasShots ? `<section class="production-next complete"><div><span>NOTHING OUTSTANDING</span><h2>All ${plural(P.shots.length, "shot")} are delivered</h2><p>Every declared unit holds approved authority and you have marked every shot final. Open Shots to inspect the delivered media, or add another shot.</p></div><a class="ghost-btn" href="#/shots/board">Open Shots →</a></section>` : `<section class="production-next"><div><span>NO SHOTS YET</span><h2>This project has no shots</h2><p>Add the first shot to start tracking scenes, frames and deliveries.</p></div><a class="assemble-btn" href="#/shots/board">Open Shots →</a></section>`}
  ${shotReadinessFeedMarkup(shotReadiness, decisions)}
  ${historicConfirmationMarkup(shotReadiness)}
  ${projectSetupIssuesMarkup(setup)}
  ${productionResultInbox()}
  <section class="production-active"><header><div><span>NOT YET DELIVERED</span><h2>Shots and their next action</h2></div><a href="#/shots/board">View all shots →</a></header>${activeRows.length ? `<div class="production-active-list">${activeRows.map(({shot,next}) => `<a href="#/shot/${shot.id}"><span class="next-${next.key}" title="Next action for this shot">${esc(next.label)}</span><div><b>${esc(shot.id)} · ${esc(shot.title)}</b><small>${esc(sceneById(shot.scene)?.title || shot.scene)} · ${esc(next.detail)}</small></div><i>→</i></a>`).join("")}</div>` : `<div class="production-inbox-empty">${hasShots ? "Every shot has been delivered." : "No shots have been added yet."}</div>`}</section>
  <section class="production-scenes"><header><div><span>SCENES</span><h2>Production progress</h2></div><a href="#/shots/scenes">Manage scenes →</a></header>${P.scenes.length ? `<div class="scene-progress-grid">${P.scenes.map((scene) => {
    /* THE SCENE CARD SUMMARISES THE SAME PROJECTION THE TILE ABOVE IT COUNTS.
       It used to say "N shots waiting for review" from its own scene-local read of
       NEEDS_DECISION — a third vocabulary for the same fact, and one that collided
       head-on with the Returned Results section's very different "waiting for
       review". A scene reports only what it is: how many of its shots are final,
       how many need a decision, and how many are blocked by a real prerequisite.
       There is no Approve Scene step, so a scene whose shots are all final is
       complete by saying so and asks for nothing. */
    const shots = P.shots.filter((shot) => shot.scene === scene.id);
    const scene_ = sceneFilmmakerDecisions(scene.id, decisions);
    const pct = shots.length ? Math.round(scene_.delivered / shots.length * 100) : 0;
    const complete = shots.length > 0 && scene_.delivered === shots.length;
    const parts = [];
    if (scene_.count) parts.push(`${plural(scene_.count, "shot")} ${scene_.count === 1 ? "needs" : "need"} a ${FILMMAKER_DECISION_LABEL}`);
    if (scene_.blocked) parts.push(`${plural(scene_.blocked, "shot")} blocked`);
    if (scene_.unanswerable) parts.push(`${plural(scene_.unanswerable, "shot")} unanswerable until the project is repaired`);
    const remaining = shots.length - scene_.delivered;
    return `<a href="#/scene/${scene.id}" class="scene-progress-card${complete ? " is-complete" : ""}" data-scene-decisions="${attr(String(scene_.count))}"><header><b>${esc(scene.title)}</b><span title="A shot is delivered once you have marked it final.">${scene_.delivered}/${shots.length} delivered</span></header><div class="progress-line"><i style="width:${pct}%"></i></div><footer>${complete ? `<span>Scene complete</span><span>Nothing outstanding</span>` : `<span>${esc(parts[0] || (decisions.available ? "No decision waiting" : "Decisions unavailable"))}</span><span>${esc(parts[1] || `${plural(remaining, "shot")} not delivered`)}</span>`}</footer></a>`;
  }).join("")}</div>` : `<div class="production-inbox-empty">No scenes have been added yet.</div>`}</section>`;
}
/* The records the add control can create, declared once so the chooser and the
   contextual entry point below cannot come to disagree about what a key means. */
const GLOBAL_ADD_CHOICES = [
  ["shot","Shot","Add a shot to an existing scene or create the first scene."],
  ["scene","Scene","Create a scene before adding its shots."],
  ["character","Character","Create an identity and reference pack."],
  ["location","Location","Create a reusable location plate and continuity states."],
  ["prop","Prop","Create an object reference and continuity states."],
  ["audio","Audio","Add dialogue, ambience, music, or timing material."],
  ["project","New project","Start from scratch or import structured material."],
];
window.openGlobalAdd = (preferred = "") => {
  const choices = GLOBAL_ADD_CHOICES;
  openModal(`<div class="global-add-modal"><h3>What are you adding?</h3><div class="modal-sub">Choose the record you need. CineBraid will take you to its one canonical workspace.</div><div class="global-add-grid">${choices.map(([key,label,note]) => `<button class="${preferred === key ? "recommended" : ""}" onclick="runGlobalAdd('${key}')"><b>${label}</b><span>${note}</span></button>`).join("")}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button></div></div>`);
};
/* ADD, WHERE THE SURFACE HAS ALREADY NAMED THE RECORD.
 *
 * A button that says "＋ Add shot", on a page that is only about shots, opened a
 * chooser whose first question was "What are you adding?" — and the filmmaker's answer
 * was the word already printed on the button they had just pressed. It is one extra
 * click and one moment of doubt about whether the button did what it said.
 *
 * THE GENERIC CHOOSER IS NOT REPLACED and is not weakened. `#global-add` in the shell
 * and the References page's Add — which is genuinely multi-entity, and passes "" on the
 * All and Canon tabs — still call openGlobalAdd() and still get the full grid. The only
 * difference is that a caller that already KNOWS the record type stops asking.
 *
 * An unrecognised key falls back to the chooser rather than to nothing, so a future
 * surface that names a record this build does not have still lands somewhere useful. */
window.openContextualAdd = (key = "") => {
  const target = String(key || "").trim();
  if (!GLOBAL_ADD_CHOICES.some(([choice]) => choice === target)) return openGlobalAdd(target);
  return runGlobalAdd(target);
};
window.runGlobalAdd = (key) => {
  closeModal();
  if (key === "shot") return addShot();
  if (key === "scene") return addScene();
  if (key === "character") return addEntity("characters");
  if (key === "location") return addEntity("locations");
  if (key === "prop") return addEntity("props");
  if (key === "audio") return addEntity("audio");
  if (key === "project") { location.hash = "#/create"; return; }
};


/* THE BOARD FILTERS ARE A THIRD READING OF THE SAME PROJECTION, so they read it.
 *
 * `complete` used to be decided by `shotIsDelivered` — the raw delivery pointer —
 * one branch ABOVE the readiness status, so a shot whose pointer was set without a
 * receipt filed under Delivered while the readiness list beside it still named a
 * decision. Canonical readiness answers both halves now: COMPLETE means marked
 * final, NEEDS_DECISION means one decision is outstanding, and the pointer is only
 * consulted when readiness could not be derived at all. */
function shotBoardActionCategory(shot, readiness = shotReadinessFor(shot)) {
  if (!readiness) return shotIsDelivered(shot) ? "complete" : "unfinished";
  if (readiness.status === "COMPLETE") return "complete";
  if (readiness.status === "NEEDS_DECISION") return "review";
  if (readiness.status === "BLOCKED") return "missing-inputs";
  if (readiness.status === "READY") return "ready";
  return "unfinished";
}
/* The undelivered set: every shot the Production page's own NOT YET DELIVERED list
   shows, which is the complement of the delivered filter and nothing else.

   The literal filter labels are written ONCE, in `defs` below, deliberately. A copy
   of one in a comment up here would quietly satisfy the source-text assertion in
   tests/clarity-consolidation.js that pins the shipped taxonomy — which is to say a
   comment would be holding a product contract up, and the rename it guards against
   would stop being caught. */
function shotBoardNotDelivered(shot, readiness = shotReadinessFor(shot)) {
  return shotBoardActionCategory(shot, readiness) !== "complete";
}
window.setShotActionFilter = (value) => {
  FILTER.action = value || "unfinished";
  localStorage.setItem("cinebraid-shot-action-filter", FILTER.action);
  if (typeof boundedWriteState === "function") boundedWriteState("page:shots", `board:${FILTER.status}:${FILTER.route}:${FILTER.char}:${FILTER.action}`, 0);
  route();
};
function shotBoardActionMatches(shot, feed = projectShotReadiness()) {
  const category = shotBoardActionCategory(shot, shotReadinessFor(shot, feed));
  if (!FILTER.action || FILTER.action === "all") return true;
  if (FILTER.action === "unfinished") return shotBoardNotDelivered(shot, shotReadinessFor(shot, feed));
  return category === FILTER.action;
}
function shotBoardActionFilters(feed = projectShotReadiness()) {
  /* Only ONE label changed here. "Needs a decision" is the same word the Production
     summary tile and the scene cards use, over the same rows; it used to read "Needs
     review", which is the phrase Returned Results uses for its own much narrower
     queue. The two delivery labels are the shipped board taxonomy and stay exactly
     as they were — "Mark shot final" is the name of an ACTION this slice introduced,
     and naming an action does not rename the state the board has always filtered on.
     tests/clarity-consolidation.js pins the first of them by its literal text, so it
     appears in this file exactly once, on the line below. */
  const defs = [["unfinished","Not delivered"],["review",`Needs a ${FILMMAKER_DECISION_LABEL}`],["missing-inputs","Missing inputs"],["ready",manualFirstWorkflow() ? "Ready for media" : "Ready to generate"],["complete","Delivered"],["all","All shots"]];
  const counts = Object.fromEntries(defs.map(([id]) => [id, P.shots.filter((shot) => id === "all" ? true : id === "unfinished" ? shotBoardNotDelivered(shot, shotReadinessFor(shot, feed)) : shotBoardActionCategory(shot, shotReadinessFor(shot, feed)) === id).length]));
  return `<nav class="board-action-filters" aria-label="Shot next-action filters">${defs.map(([id,label]) => `<button type="button" class="${FILTER.action===id?"selected":""}" onclick="setShotActionFilter('${id}')"><span>${esc(label)}</span><b>${counts[id]}</b></button>`).join("")}</nav>`;
}
function productionView(tab = "board") {
  if (!["board", "table", "scenes"].includes(tab)) tab = "board";
  const shotReadiness = projectShotReadiness();
  const readinessByShot = new Map((shotReadiness?.shots || []).map((row) => [row.shotId, row]));
  const approved = P.shots.filter(
    (s) => workflowState(s).key === "APPROVED",
  ).length;
  const review = P.shots.filter(
    (s) => workflowState(s).key === "READY FOR REVIEW",
  ).length;
  const ready = P.shots.filter(
    (s) =>
      workflowState(s).key === "APPROVED" &&
      ["animate", "flf", "references"].includes(outputPlanKey(s)),
  );
  const tabDefs = [["board", "Shot board"], ["scenes", "Scene directory"]];
  if (tab === "table") tab = "board";
  const tabs = workspaceTabs("production", tab, tabDefs);
  /* AT1-C. This head offered a bare CONTINUE on a project with no shots at all,
     and the press answered "Every shot has been delivered". Same owner as
     Production's primary control, so the two heads cannot say different things
     about the same project; CONTINUE keeps its short word when there is work. */
  /* HANDED THE FEED THIS VIEW ALREADY DERIVED. Calling it bare re-ran
     evaluateProjectReadiness() for the whole project a second time on every
     board paint — against this file's own rule, stated above productionHomeView,
     that the answer is derived ONCE and handed to every reader. */
  const boardPrimary = projectPrimaryProductionAction(shotReadiness);
  const head = `<div class="view-head board-head"><div><div class="eyebrow">Shots</div><span class="view-title">Shots</span><div class="view-sub">Track scene readiness, approved frames, and one clear next action for every shot.</div></div><div class="board-head-actions"><button class="assemble-btn" onclick="continueProduction()">${esc(boardPrimary.kind === "continue" ? "CONTINUE" : boardPrimary.label)}</button><button class="add-btn" onclick="openContextualAdd('shot')">＋ Add</button></div></div>${tabs}`;
  if (tab === "scenes") {
    const scenePage = boundedPage(P.scenes, "scenes", "overview", BOUNDED_PAGE_SIZES.scenes);
    return head + runtimeBar(P.shots, P.meta.targetRuntime) + `<div class="bounded-scene-list">${scenePage.rows.map((sc) => {
      const shots = P.shots.filter((s) => s.scene === sc.id), refs = sceneReferenceRecords(sc), done = shots.filter(shotIsApproved).length;
      return `<a class="scene-card" href="#/scene/${sc.id}"><div class="scene-card-head"><span class="scene-card-title">${esc(sc.title)}</span><span class="tier-badge ${sc.tier || "B"}">TIER ${sc.tier || "B"}</span><span class="scene-card-meta">${mmss(shots.reduce((a, s) => a + shotDur(s), 0))} · ${done}/${shots.length} ${pluralWord(shots.length, "shot")} signed off · ${plural(refs.length, "reference")}</span></div><div class="scene-card-beat">${esc(sc.whatHappens || "No scene beat written yet.")}</div></a>`;
    }).join("")}</div>${boundedPagerMarkup("scenes","overview",scenePage,"scenes")}`;
  }
  const routes = [
    ...new Set(P.shots.map((s) => outputPlanLabel(s)).filter(Boolean)),
  ];
  const filterBody = `<div class="toolbar"><select aria-label="Filter lifecycle" onchange="FILTER.status=this.value;route()"><option value="">All shots</option>${WORKFLOW_STATES.map((x) => `<option value="${x}" ${FILTER.status === x ? "selected" : ""}>${workflowStatusLabel(x)}</option>`).join("")}</select><select aria-label="Filter output" onchange="FILTER.route=this.value;route()"><option value="">Any output</option>${routes.map((r) => `<option value="${attr(r.toUpperCase())}" ${FILTER.route === r.toUpperCase() ? "selected" : ""}>${esc(r)}</option>`).join("")}</select><select aria-label="Filter character" onchange="FILTER.char=this.value;route()"><option value="">Any character</option>${P.characters.map((c) => `<option value="${c.id}" ${FILTER.char === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>`;
  const controls = `<div class="board-list-controls">${shotBoardActionFilters(shotReadiness)}${shotBoardDensityControl()}</div>${P.shots.length ? shotBadgeLegend() : ""}${tab === "table" ? batchToolbar() : ""}<details class="board-filter-fold" ${(FILTER.status || FILTER.route || FILTER.char) ? "open" : ""}><summary>More filters${(FILTER.status || FILTER.route || FILTER.char) ? " · active" : ""}</summary>${filterBody}</details>`;
  const filteredPairs = [];
  P.scenes.forEach((sc) => {
    P.shots.filter((shot) => shot.scene === sc.id).filter((shot) =>
      (!FILTER.status || workflowState(shot).key === FILTER.status) &&
      (!FILTER.route || outputPlanLabel(shot).toUpperCase() === FILTER.route) &&
      (!FILTER.char || (shot.characters || []).includes(FILTER.char)) &&
      shotBoardActionMatches(shot, shotReadiness)
    ).forEach((shot) => filteredPairs.push({ sc, shot }));
  });
  const boardPageKey = `board:${FILTER.status}:${FILTER.route}:${FILTER.char}:${FILTER.action}`;
  const shotPage = boundedPage(filteredPairs, "shots", boardPageKey, 5);
  const grouped = new Map();
  shotPage.rows.forEach(({ sc, shot }) => { if (!grouped.has(sc.id)) grouped.set(sc.id, { sc, shots: [] }); grouped.get(sc.id).shots.push(shot); });
  const body = [...grouped.values()].map(({ sc, shots }) => {
    const all = P.shots.filter((shot) => shot.scene === sc.id), collapsed = COLLAPSED_SCENES.has(sc.id), pending = all.filter((shot) => workflowState(shot).key === "READY FOR REVIEW").length, approvedCount = all.filter(shotIsApproved).length;
    return `<section class="log-strip ${collapsed ? "collapsed" : ""}"><div class="log-head"><button class="collapse-btn" onclick="toggleSceneCollapse('${sc.id}')" aria-label="${collapsed ? "Expand" : "Collapse"} ${attr(sc.title || sc.id)}" aria-expanded="${collapsed ? "false" : "true"}">${collapsed ? "▸" : "▾"}</button><a class="log-title" href="#/scene/${sc.id}">${esc(sc.title)}</a><span class="tier-badge ${sc.tier || "B"}">TIER ${sc.tier || "B"}</span>${pending ? `<span class="scene-attention">${plural(pending, "shot")} ready for review</span>` : ""}<span class="log-count" title="Shots in this scene whose workflow status has reached Signed off">${approvedCount}/${all.length} ${pluralWord(all.length, "shot")} signed off</span></div>${collapsed ? "" : `<div class="shot-row bounded-shot-page size-${SHOT_BOARD_DENSITY}">${shots.map((shot) => slate(shot, "", readinessByShot.get(shot.id))).join("")}</div>`}</section>`;
  }).join("") || (P.shots.length
    ? `<div class="empty-state"><h2>No shots match these filters</h2><p>Change a filter to see the other ${plural(P.shots.length, "shot")} in this project.</p></div>`
    : `<div class="empty-state"><h2>This project has no shots yet</h2><p>Add the first shot to start tracking scenes, frames and deliveries.</p><button class="add-btn" onclick="openContextualAdd('shot')">＋ Add shot</button></div>`);
  const pager = boundedPagerMarkup("shots",boardPageKey,shotPage,"shots");
  return head + controls + pager + body + pager;
}
/* S7 — THE LIBRARY SPEAKS THE THREE-CONCEPT LANGUAGE.
 *
 * `entityApprovedReferenceCount` is deleted. It counted `entity.approvedFile`,
 * every state's `approvedFile` AND every coverage and expression slot file into
 * one number, and `libraryCard` turned any nonzero result into CSS status
 * `approved`, a badge reading APPROVED, and copy reading "1 approved file". The
 * 1D audit rendered exactly that for an entity with NO Canon at all and one
 * selected supporting view, on a tab whose subtitle told the creator these media
 * "currently define production truth".
 *
 * Three counts now, from the one projection, and they never merge:
 *
 *   CANON       receipt-backed. The creator approved these exact bytes.
 *   REFERENCES  supporting selections. Useful; not production truth.
 *   HISTORIC    a pointer nobody currently vouches for.
 *
 * A reference-only entity reads REFERENCES, never APPROVED, and is not in the
 * Canon tab. */
function entityTruthCounts(list, entity) {
  const truth = typeof entityProductionTruth === "function"
    ? entityProductionTruth(P, list, entity && entity.id)
    : { canon: [], references: [], historic: [] };
  const canon = new Set(truth.canon.map((row) => row.value).filter(Boolean));
  const references = new Set(truth.references.map((row) => row.value).filter(Boolean));
  const historic = new Set(truth.historic.map((row) => row.value).filter(Boolean));
  /* A file that IS canon is not also counted as a reference or as history. One
     file, one strongest standing. */
  for (const name of canon) { references.delete(name); historic.delete(name); }
  return { canon: canon.size, references: references.size, historic: historic.size, canonFiles: canon };
}
function libraryCard(list, x, canonOnly = false) {
  const media = entityMedia(list, x), route = ENTITY_ROUTE[list];
  const counts = entityTruthCounts(list, x);
  /* The preview prefers Canon, then whatever pointer the entity carries, then
     the newest import — so a card always shows something, and showing it never
     implies it was approved. */
  const canonFile = [...counts.canonFiles][0] || "";
  const previewMedia = media.find((item) => item.name === canonFile)
    || media.find((item) => item.name === entityApprovedFileForState(x, ""))
    || media.at(-1);
  const preview = previewMedia ? (isAudio(previewMedia.name) ? '<span class="library-audio-icon">◉</span>' : isVideo(previewMedia.name) ? `<video muted src="${previewMedia.url}"></video>` : `<img src="${previewMedia.url}" alt="">`) : `<div class="library-empty">${esc((x.name || x.id).slice(0,1))}</div>`;
  const type = { characters: "Character", locations: "Location", props: "Prop", vehicles: "Vehicle", audio: "Audio" }[list];
  const status = counts.canon ? "canon" : counts.references ? "reference" : counts.historic ? "historic" : media.length ? "candidate" : "missing";
  const statusLabel = counts.canon ? "CANON" : counts.references ? "REFERENCES" : counts.historic ? "HISTORIC" : media.length ? "TO ORGANIZE" : "EMPTY";
  const parts = [];
  if (counts.canon) parts.push(plural(counts.canon, "canon file"));
  if (counts.references) parts.push(plural(counts.references, "supporting reference"));
  if (counts.historic) parts.push(`${plural(counts.historic, "historic pointer")} to confirm`);
  const unassigned = Math.max(0, media.length - counts.canon - counts.references - counts.historic);
  if (!canonOnly && unassigned) parts.push(plural(unassigned, "unassigned file"));
  const description = parts.length
    ? parts.join(" · ")
    : media.length ? `${plural(media.length, "imported file")} to organize` : "Add the first reference";
  /* Same reasoning as the shot board: the card navigates, so the reference image
     gets its own inspection control that does not open the reference page. */
  const enlarge = previewMedia && !isAudio(previewMedia.name) && !isVideo(previewMedia.name)
    ? `<button type="button" class="media-enlarge-btn library-enlarge" onclick="event.preventDefault();event.stopPropagation();inspectMediaFile('${attr(encodeURIComponent(previewMedia.url))}','${attr(previewMedia.assetId || "")}','${attr(encodeURIComponent(`${x.name || x.id} · ${previewMedia.name}`))}','image')" aria-label="Inspect the ${attr(x.name || x.id)} reference image">Inspect</button>`
    : "";
  return `<div class="library-card-shell"><a class="library-card ${status}" href="#/${route}/${x.id}"><div class="library-preview">${preview}<span class="library-status ${status}">${statusLabel}</span></div><div class="library-body"><span class="review-kind">${type}</span><b>${esc(x.name || x.id)}</b><small>${description}</small></div></a>${enlarge}</div>`;
}
function libraryView(tab = "all") {
  /* "approved" is still accepted as an incoming route so an old bookmark or a
     remembered tab lands somewhere sensible; it resolves to Canon. */
  if (tab === "approved") tab = "canon";
  if (!["all", "canon", "characters", "locations", "props", "vehicles", "audio"].includes(tab)) tab = "all";
  LIBRARY_TAB = tab;
  localStorage.setItem("cinebraid-library-tab", tab);
  const counts = {
    characters: P.characters.length,
    locations: P.locations.length,
    props: P.props.length,
    vehicles: (P.vehicles || []).length,
    audio: (P.audio || []).length,
  };
  const allLists = ["characters", "locations", "props", "vehicles", "audio"];
  /* THE CANON TAB IS RECEIPT-BACKED, FULL STOP. It was the "Approved" tab and it
     admitted any entity with any file in any slot. */
  const canonCount = allLists.flatMap((list) => (P[list] || []).map((entity) => ({ list, entity })))
    .filter(({ list, entity }) => entityTruthCounts(list, entity).canon > 0).length;
  const tabs = workspaceTabs("library", tab, [
    ["all", "All", Object.values(counts).reduce((a, b) => a + b, 0)],
    ["canon", "Canon", canonCount],
    ["characters", "Characters", counts.characters],
    ["locations", "Locations", counts.locations],
    ["props", "Props", counts.props],
    ["vehicles", "Vehicles", counts.vehicles],
    ["audio", "Audio", counts.audio],
  ]);
  const lists = tab === "all" || tab === "canon" ? allLists : [tab];
  let allRows = lists.flatMap((list) => (P[list] || []).map((entity) => ({ list, entity })));
  if (tab === "canon") allRows = allRows.filter(({ list, entity }) => entityTruthCounts(list, entity).canon > 0);
  const referencePage = boundedPage(allRows, "references", `library:${tab}`, BOUNDED_PAGE_SIZES.references);
  const add = `<button class="add-btn" onclick="openGlobalAdd('${tab === "all" || tab === "canon" ? "" : tab === "audio" ? "audio" : tab.slice(0,-1)}')">＋ Add reference</button>`;
  const pager = boundedPagerMarkup("references",`library:${tab}`,referencePage,"references");
  const title = "References";
  const subtitle = tab === "canon"
    ? "Only media you explicitly approved as canon. Supporting views, historic pointers, candidates and automation are hidden."
    : "Import work made anywhere, organize it into authoritative states and views, and use optional assisted tools only when needed.";
  return `<div class="view-head"><div><div class="eyebrow">References</div><span class="view-title">${title}</span><div class="view-sub">${subtitle}</div></div>${add}</div>${tabs}${pager}<div class="library-grid bounded-source-section">${referencePage.rows.map(({list,entity}) => libraryCard(list,entity,tab === "canon")).join("") || `<div class="empty-state"><div class="empty-mark">＋</div><h2>${tab === "canon" ? "Nothing is canon yet" : "No references yet"}</h2><p>${tab === "canon" ? "Approve an imported file as canon to add it here." : "Add a character, location, prop, vehicle, or audio asset."}</p><button class="add-btn" onclick="openGlobalAdd()">Add reference</button></div>`}</div>${pager}`;
}

function currentPromptOption(s) {
  const opts = s.promptOptions || [];
  return opts.find((o) => o.favorite) || opts[opts.length - 1] || null;
}
window.setCurrentPrompt = (id, value) => {
  const s = shotById(id);
  s.promptOptions = s.promptOptions || [];
  let o = currentPromptOption(s);
  if (!o) {
    o = { id: "prompt-1", text: "", refs: [], favorite: true };
    s.promptOptions.push(o);
  }
  o.text = value;
  o.favorite = true;
  s.promptOptions.forEach((x) => {
    if (x !== o) x.favorite = false;
  });
  if (workflowState(s).key === "DRAFT") {
    s.workflowStatus = "IN PROGRESS";
    s.status = "BUILT";
  }
  dirty();
};
const SHOT_STATE_DECLARATION_RESULT_WORDS = {
  "shot-not-found": "That shot no longer exists.",
  "entity-not-found": "That reference no longer exists.",
  "entity-not-attached": "Attach that reference to this shot before choosing its state.",
  "state-not-found": "That continuity state no longer exists.",
  "state-owned-by-different-entity": "That continuity state belongs to a different reference.",
  "invalid-declaration": "CineBraid could not safely change this shot state declaration.",
};
/* The browser layer renders the shared owner's closed result; it does not decide
   whether an entity owns a state. Both the shipped control and the compatibility
   entry point below cross this same deterministic boundary. */
function applyShotStateDeclarationFromUi(shotId, entityId, stateId) {
  const result = typeof applyShotStateDeclaration === "function"
    ? applyShotStateDeclaration(P, { shotId, entityId, stateId })
    : { status: "invalid-declaration", shotId, entityId, stateId };
  if (result.status !== "applied") {
    toast(SHOT_STATE_DECLARATION_RESULT_WORDS[result.status] || "The shot state declaration was refused.");
    return result;
  }
  if (result.changed) dirty();
  route();
  toast(result.operation === "cleared" ? "Shot continuity-state declaration cleared" : "Continuity state selected for this shot");
  return result;
}
function clearStaleShotStateDeclarationFromUi(shotId, entityId) {
  const result = typeof clearDetachedShotStateDeclaration === "function"
    ? clearDetachedShotStateDeclaration(P, { shotId, entityId })
    : { status: "invalid-declaration", shotId, entityId };
  if (result.status !== "applied") {
    toast(SHOT_STATE_DECLARATION_RESULT_WORDS[result.status] || "The stale shot state declaration was not removed.");
    return result;
  }
  if (result.operation === "retained-attached") {
    toast("That reference is still attached to this shot, so its declaration was kept.");
    route();
    return result;
  }
  if (result.changed) dirty();
  route();
  toast(result.changed ? "Stale shot state declaration removed" : "No stale shot state declaration remained");
  return result;
}
window.removeStaleShotStateDeclaration = (shotId, entityId) =>
  clearStaleShotStateDeclarationFromUi(shotId, entityId);
window.chooseShotContinuityState = (shotId, entityId, stateId) =>
  applyShotStateDeclarationFromUi(shotId, entityId, stateId);
/* Kept for old extensions and the pre-existing browser regression, but no longer
   permissive and deliberately not used by the rendered product control. */
window.setShotContinuityState = (shotId, entityId, stateId) =>
  applyShotStateDeclarationFromUi(shotId, entityId, stateId);

/* ---------- compact shot workspace ---------- */
const SHOT_VIEW_MODES = ["focused", "standard", "review", "expanded"];
function persistShotWorkspace() {
  localStorage.setItem(
        JSON.stringify(SHOT_SECTION_STATE),
  );
  localStorage.setItem(
        JSON.stringify(SHOT_SEGMENT_STATE),
  );
}
const SHOT_STAGE_ORDER = ["plan", "references", "frames", "motion", "packages", "review", "finish"];
const SHOT_STAGE_META = {
  plan: { label: "Shot plan", short: "Plan", section: "plan" },
  references: { label: "References", short: "Refs", section: "references" },
  frames: { label: "Keyframes", short: "Frames", section: "motion" },
  motion: { label: "Motion", short: "Motion", section: "motion" },
  packages: { label: "Packages", short: "Package", section: "packages" },
  review: { label: "Final review", short: "Review", section: "review" },
  finish: { label: "Finish & upscale", short: "Finish", section: "finish" },
};
function stageStable(value) {
  if (Array.isArray(value)) return value.map(stageStable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stageStable(value[key])]),
    );
  return value;
}
function stageHash(value) {
  const str = JSON.stringify(stageStable(value));
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function shotFinishJobs(shotId) {
  P.finishJobs = Array.isArray(P.finishJobs) ? P.finishJobs : [];
  return P.finishJobs.filter((job) => job.scope === "shot" && job.shotId === shotId);
}
function shotStageFacts(s, stage, takes = takesFor(s.id), refs = referenceRecordsForShot(s)) {
  normalizeShotV5(s);
  const gaps = [],
    frames = requiredFrames(s),
    motion = s.clips || [],
    mediaLinks = shotMediaLinks(s),
    generative = motion.filter((x) => !["plan", "post", "reuse"].includes(x.kind));
  let data = {};
  if (stage === "plan") {
    if ((s.desc || "").trim().length < 12) gaps.push("Write the visible shot action.");
    if ((s.positioning || "").trim().length < 8)
      gaps.push("Define framing, blocking, camera, or contact points.");
    data = { desc: s.desc || "", positioning: s.positioning || "", safe: s.safe || "" };
  } else if (stage === "references") {
    if (!refs.length && !mediaLinks.length)
      gaps.push("Link canon records or add animatic / planning media for this shot.");
    /* READY MEANS APPROVED, AND APPROVED MEANS A RECEIPT. This read
       entityWorkflowState() — a design-review word — so a reference whose only
       event was accepting a coverage SHEET as an extraction source reported this
       stage ready with no primary image and nobody's approval behind it. The
       question the stage is actually asking is "do these references have an
       approved identity", and that has one owner. */
    const unapproved = refs.filter((x) => !entityHasIdentityCanon(x));
    if (unapproved.length)
      gaps.push(`Approve or replace ${unapproved.map((x) => x.id).join(", ")}.`);
    data = {
      characters: [...(s.characters || [])].sort(),
      codes: [...(s.codes || [])].sort(),
      continuity: s.continuityStateSelections || {},
      states: refs.map((x) => {
        const selected = selectedEntityStateForShot(s, x);
        return [
          x.id,
          entityWorkflowState(x).key,
          selected?.id || "",
          selected?.name || "Default",
          selected?.approvedFile || x.approvedFile || "",
        ];
      }),
      media: mediaLinks.map(({ asset, link }) => [
        asset.id,
        asset.file || "",
        link.role || "",
        link.order || 0,
        link.beat || "",
        link.timecode || "",
        link.notes || "",
        link.visualAnalysis || "",
        link.analyzedAt || "",
        link.agentContext !== false,
        !!link.generationInput,
      ]),
    };
  } else if (stage === "frames") {
    if (!frames.length) gaps.push("Add at least one required keyframe.");
    frames.forEach((f) => {
      if ((f.description || "").trim().length < 8)
        gaps.push(`Describe Frame ${f.label || "?"}.`);
      if (!f.winner) gaps.push(`Approve Frame ${f.label || "?"}.`);
    });
    data = frames.map((f) => ({
      id: f.id,
      title: f.title || "",
      description: f.description || "",
      notes: f.notes || "",
      winner: f.winner || "",
      required: f.required !== false,
      sourceMediaId: f.sourceMediaId || "",
    }));
  } else if (stage === "motion") {
    if (!motion.length) gaps.push("Add at least one motion unit.");
    motion.forEach((c) => {
      if (!["post", "reuse"].includes(c.kind) && (c.motionPrompt || c.note || "").trim().length < 8)
        gaps.push(`Write direction for Motion ${c.label || c.suffix || "?"}.`);
      const first = frameById(s, c.fromFrame),
        last = frameById(s, c.toFrame);
      if (c.kind === "i2v" && !first?.winner)
        gaps.push(`Motion ${c.label || c.suffix || "?"} needs an approved start frame.`);
      if (c.kind === "flf" && (!first?.winner || !last?.winner))
        gaps.push(`Motion ${c.label || c.suffix || "?"} needs approved first and last frames.`);
    });
    data = motion.map((c) => ({
      id: c.id,
      title: c.title || "",
      kind: c.kind,
      dur: c.dur,
      fromFrame: c.fromFrame,
      toFrame: c.toFrame,
      direction: c.motionPrompt || c.note || "",
      vo: c.vo || "",
    }));
  } else if (stage === "packages") {
    frames.forEach((f) => {
      if (!f.winner && !(f.generationPackages || []).length)
        gaps.push(`Build a frame package for Frame ${f.label || "?"}.`);
    });
    generative.forEach((c) => {
      if (!c.videoWinner && !(c.generationPackages || []).length)
        gaps.push(`Build a motion package for Motion ${c.label || c.suffix || "?"}.`);
    });
    if (!frames.length && !generative.length && !shotPackageCount(s) && !s.winner)
      gaps.push("Build at least one relevant generation package or document the reuse/post route.");
    if (typeof shotPackageStaleReasons === "function")
      shotPackageStaleReasons(s).forEach((reason) => gaps.push(`Rebuild ${reason}.`));
    data = {
      shot: resolvePromptBuildList(P, s.generationPackages || []).map((x) => [x.id, x.revision || 0, x.profileId, x.prompt, x.dependencySnapshot || null]),
      frames: frames.map((f) => [f.id, f.winner || "", resolvePromptBuildList(P, f.generationPackages || []).map((x) => [x.id, x.revision || 0, x.profileId, x.prompt, x.dependencySnapshot || null])]),
      motion: motion.map((c) => [c.id, c.videoWinner || "", resolvePromptBuildList(P, c.generationPackages || []).map((x) => [x.id, x.revision || 0, x.profileId, x.prompt, x.dependencySnapshot || null])]),
      generationInputs: mediaLinks
        .filter(({ link }) => link.generationInput)
        .map(({ asset, link }) => [asset.id, asset.file || "", link.role || ""]),
    };
  } else if (stage === "review") {
    if (!shotApprovalComplete(s))
      gaps.push(
        takes.length
          ? "Approve the required frame and motion outputs."
          : "Add candidates, review them, and approve the required outputs.",
      );
    data = {
      workflow: workflowState(s, takes).key,
      winner: s.winner || "",
      frames: frames.map((f) => [f.id, f.winner || ""]),
      motion: generative.map((c) => [c.id, c.videoWinner || ""]),
      candidates: takes.map((x) => x.name).sort(),
      candidateDecisions: (s.candidateFiles || []).map((x) => [x.stored || x.name || "", x.decision || "unreviewed", x.notes || "", x.sourcePackageId || "", x.approvedTarget || "", x.structuredReview || null, x.correctionBuildIds || []]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
    };
  } else if (stage === "finish") {
    const jobs = shotFinishJobs(s.id);
    if (!jobs.length) gaps.push("Mark any approved stills that need upscaling or finishing.");
    jobs.forEach((job) => {
      if (!job.sourceFile) gaps.push("A finishing job is missing its approved source image.");
      if (["ready", "in-progress"].includes(job.status)) gaps.push(`Finish job ${job.label || job.type} is still in progress.`);
      if (job.status === "result-received" && !job.resultFile) gaps.push(`Finish job ${job.label || job.type} needs an imported result file for QC.`);
      if (job.status === "qc-approved" && !job.promotedAt) gaps.push(`Promote the finished result for ${job.label || job.type} or mark it complete without promotion.`);
    });
    data = jobs.map((job) => [job.id, job.type || "", job.sourceFile || "", job.resultFile || "", job.status || "", job.promotedAt || "", job.approvedTarget || "", job.notes || ""]);
  }
  return { stage, gaps: [...new Set(gaps)], ready: gaps.length === 0, fingerprint: stageHash(data), data };
}
function shotStageCanBeNotNeeded(s, stage) {
  const plan = outputPlanKey(s),
    motion = s.clips || [];
  if (stage === "references") return true;
  if (stage === "frames") return ["post", "reuse"].includes(plan);
  if (stage === "motion") return plan === "still";
  if (stage === "finish") return true;
  if (stage === "packages")
    return (
      ["post", "reuse"].includes(plan) ||
      (motion.length > 0 &&
        motion.every((x) => ["plan", "post", "reuse"].includes(x.kind)))
    );
  return false;
}
window.approveShotStage = (id, stage) => {
  const s = shotById(id),
    facts = shotStageFacts(s, stage);
  if (!facts.ready) {
    openModal(`<h3>${esc(SHOT_STAGE_META[stage]?.label || stage)} is not ready to check</h3><div class="modal-sub">THE CHECK MARK MEANS THE REQUIRED RECORDS ARE ACTUALLY PRESENT</div><div class="stage-gap-modal"><ul>${facts.gaps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div><div class="modal-actions"><button class="ghost-btn" onclick="closeModal();runShotStageAgent('${id}','${stage}','fill-gaps')"${agentDisabledAttrs("coordinator")}>Ask agent for help</button><button class="cancel" onclick="closeModal()">Close</button></div>`);
    return;
  }
  s.stageApprovals = s.stageApprovals || {};
  s.stageApprovals[stage] = {
    fingerprint: facts.fingerprint,
    snapshot: JSON.parse(JSON.stringify(facts.data)),
    approvedAt: new Date().toISOString(),
    source: "human-check",
  };
  dirty();
  route();
  toast(`${SHOT_STAGE_META[stage]?.label || stage} checked complete`);
};
window.markShotStageNotNeeded = (id, stage) => {
  const s = shotById(id);
  if (!s || !shotStageCanBeNotNeeded(s, stage)) return;
  const label = SHOT_STAGE_META[stage]?.label || stage;
  confirmModal(
    `Mark ${label} as not needed for this shot? The stage remains accessible and will return to Changed if its underlying records change.`,
    () => {
      const facts = shotStageFacts(s, stage);
      s.stageApprovals = s.stageApprovals || {};
      s.stageApprovals[stage] = {
        fingerprint: facts.fingerprint,
        snapshot: JSON.parse(JSON.stringify(facts.data)),
        approvedAt: new Date().toISOString(),
        source: "not-needed",
        reason:
          stage === "references"
            ? "No external continuity references required"
            : stage === "frames"
              ? "Post/reuse route does not require generated keyframes"
              : stage === "motion"
                ? "Held still output"
                : stage === "finish"
                  ? "No upscaling or finishing pass required"
                  : "Post/reuse route does not require a generation package",
      };
      dirty();
      route();
      toast(`${label} marked not needed`);
    },
    { title: `Mark ${label} not needed`, confirmLabel: "MARK NOT NEEDED", danger: false },
  );
};
window.clearShotStage = (id, stage) => {
  const s = shotById(id);
  if (s.stageApprovals) delete s.stageApprovals[stage];
  dirty();
  route();
  toast("Stage check cleared");
};
function shotPackageCount(s) {
  return (
    (s.generationPackages || []).length +
    (s.keyframes || []).reduce(
      (n, f) => n + (f.generationPackages || []).length,
      0,
    ) +
    (s.clips || []).reduce((n, c) => n + (c.generationPackages || []).length, 0)
  );
}
function wireShotWorkspace(id) {
  document.querySelectorAll(".shot-section[data-section]").forEach((el) => {
    el.addEventListener("toggle", () => {
      SHOT_SECTION_STATE[id] = SHOT_SECTION_STATE[id] || {};
      SHOT_SECTION_STATE[id][el.dataset.section] = el.open;
      persistShotWorkspace();
    });
  });
}
window.setShotViewMode = (mode) => {
  if (!SHOT_VIEW_MODES.includes(mode)) return;
  SHOT_VIEW_MODE = mode;
  localStorage.setItem("cinebraid-shot-view-mode", mode);
  const [, view, id] = location.hash.split("/");
  if (view === "shot" && id) delete SHOT_SECTION_STATE[decodeURIComponent(id)];
  persistShotWorkspace();
  route();
};
window.setShotCandidateSize = (size) => {
  if (!["compact", "medium", "large"].includes(size)) return;
  SHOT_CANDIDATE_SIZE = size;
  localStorage.setItem("cinebraid-shot-candidate-size", size);
  route();
};
window.resetShotLayout = (id) => {
  delete SHOT_SECTION_STATE[id];
  delete SHOT_SEGMENT_STATE[id];
  persistShotWorkspace();
  route();
  toast("Shot layout reset");
};
window.jumpShotSection = (id, key) => {
  SHOT_SECTION_STATE[id] = SHOT_SECTION_STATE[id] || {};
  SHOT_SECTION_STATE[id][key] = true;
  persistShotWorkspace();
  const el = document.getElementById(`shot-section-${key}`);
  if (el) {
    el.open = true;
    setTimeout(
      () => el.scrollIntoView({ behavior: "smooth", block: "start" }),
      40,
    );
  } else route();
};
function shotNeighbors(s) {
  const i = P.shots.findIndex((x) => x.id === s.id);
  return {
    prev: i > 0 ? P.shots[i - 1] : null,
    next: i >= 0 && i < P.shots.length - 1 ? P.shots[i + 1] : null,
  };
}
function activeSegmentKey(s) {
  const clips = s.clips || [];
  if (!clips.length) return "";
  if (Object.prototype.hasOwnProperty.call(SHOT_SEGMENT_STATE, s.id)) {
    const saved = SHOT_SEGMENT_STATE[s.id];
    if (saved === "") return "";
    if (clips.some((c) => unitKey(c) === saved)) return saved;
  }
  return unitKey(
    clips.find((c) => !(c.generationPackages || []).length) || clips[0],
  );
}
window.toggleShotSegment = (id, key) => {
  const s = shotById(id),
    cur = activeSegmentKey(s);
  SHOT_SEGMENT_STATE[id] = cur === key ? "" : key;
  if (SHOT_SEGMENT_STATE[id]) {
    const g = plannerState(s);
    g.tab = "motion";
    g.unit = key;
  }
  persistShotWorkspace();
  route();
};
window.planShotSegment = (id, key) => {
  const s = shotById(id),
    g = plannerState(s);
  g.tab = "motion";
  g.unit = key;
  SHOT_SEGMENT_STATE[id] = key;
  SHOT_SECTION_STATE[id] = SHOT_SECTION_STATE[id] || {};
  SHOT_SECTION_STATE[id].packages = true;
  persistShotWorkspace();
  route();
  setTimeout(
    () =>
      document
        .getElementById("shot-section-packages")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    60,
  );
};
window.setKeyframe = (id, i, k, v) => {
  const s = shotById(id);
  normalizeShotV5(s);
  s.keyframes[i][k] = v;
  dirty();
};
window.addKeyframe = (id) => {
  const s = shotById(id);
  normalizeShotV5(s);
  s.keyframes.push(newKeyframe(s.keyframes.length));
  dirty();
  route();
};
window.removeKeyframe = (id, i) => {
  const s = shotById(id);
  normalizeShotV5(s);
  if (s.keyframes.length <= 1) return;
  const removed = s.keyframes[i];
  confirmModal(
    `Remove Frame ${removed.label}? Candidate files stay on disk.`,
    () => {
      s.keyframes.splice(i, 1);
      s.clips.forEach((c) => {
        if (c.fromFrame === removed.id)
          c.fromFrame = s.keyframes[Math.max(0, i - 1)]?.id || s.keyframes[0]?.id || "";
        if (c.toFrame === removed.id) c.toFrame = "";
      });
      normalizeShotV5(s);
      dirty();
      route();
    },
    { title: `Remove Frame ${removed.label}`, confirmLabel: "REMOVE" },
  );
};
window.selectFramePackage = (id, frameId) => {
  const s = shotById(id),
    g = plannerState(s);
  g.tab = "frames";
  g.frameId = frameId;
  SHOT_SECTION_STATE[id] = SHOT_SECTION_STATE[id] || {};
  SHOT_SECTION_STATE[id].packages = true;
  persistShotWorkspace();
  route();
  setTimeout(
    () =>
      document
        .getElementById("shot-section-packages")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    60,
  );
};
window.setSegmentMode = (id, ci, kind) => {
  const s = shotById(id),
    c = s.clips[ci];
  c.kind = kind;
  if (kind === "flf" && !c.toFrame) {
    const fromIndex = Math.max(
      0,
      (s.keyframes || []).findIndex((f) => f.id === c.fromFrame),
    );
    if (!s.keyframes[fromIndex + 1])
      s.keyframes.push(newKeyframe(s.keyframes.length));
    c.toFrame = s.keyframes[fromIndex + 1].id;
  }
  if (kind !== "flf") c.toFrame = "";
  dirty();
  route();
};

function projectNavigator(current) {
  return `<aside class="project-navigator ${PROJECT_NAV_OPEN ? "open" : "closed"}"><button class="navigator-toggle" onclick="toggleProjectNavigator()" aria-label="${PROJECT_NAV_OPEN ? "Close project navigator" : "Open project navigator"}" aria-expanded="${PROJECT_NAV_OPEN ? "true" : "false"}" aria-controls="project-nav-list"${helpAttr(PROJECT_NAV_OPEN ? "Collapse the scene and shot navigator." : "Open the scene and shot navigator.")}>${PROJECT_NAV_OPEN ? "‹" : "›"}</button>${
    PROJECT_NAV_OPEN
      ? `<div class="navigator-head"><b>Project navigator</b><input placeholder="Filter shots" oninput="filterProjectNavigator(this.value)"></div><div id="project-nav-list" class="navigator-list">${P.scenes
          .map((sc) => {
            const shots = P.shots.filter((x) => x.scene === sc.id);
            return `<section><header><a href="#/scene/${sc.id}">${esc(sc.title)}</a><span>${shots.filter((x) => workflowState(x).key === "APPROVED").length}/${shots.length}</span></header>${shots
              .map((x) => {
                const st = workflowState(x);
                return `<a class="navigator-shot ${current?.id === x.id ? "on" : ""}" href="#/shot/${x.id}" data-search="${attr((x.id + " " + x.title + " " + sc.title).toLowerCase())}"><span class="nav-status wf-${st.cls}"></span><b>${esc(x.id)}</b><small>${esc(x.title)}</small></a>`;
              })
              .join("")}</section>`;
          })
          .join("")}</div>`
      : ""
  }</aside>`;
}
window.toggleProjectNavigator = () => {
  PROJECT_NAV_OPEN = !PROJECT_NAV_OPEN;
  localStorage.setItem(
    "cinebraid-project-nav-open-v662",
    PROJECT_NAV_OPEN ? "1" : "0",
  );
  route();
};
window.filterProjectNavigator = (v) => {
  const q = String(v || "").toLowerCase();
  document
    .querySelectorAll(".navigator-shot")
    .forEach((x) =>
      x.classList.toggle("filtered", q && !x.dataset.search.includes(q)),
    );
};
