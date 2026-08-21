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
  PROJECT_CONFLICT = false;
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
  const heading = document.getElementById("project-title");
  if (heading) {
    heading.textContent = P.meta.title;
    heading.setAttribute("aria-label", `Open the project switcher — ${P.meta.title} is open`);
  }
  const topbar = document.getElementById("topbar-project");
  if (topbar) topbar.textContent = P.meta.title;
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
const shotIsDelivered = (s) => {
  const c = s?.creationBrief || {};
  return !!(c.finalVideoFile || c.finalStillFile || s?.finalVideoFile || s?.finalStillFile);
};
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
  if (!String(s.creationBrief.locationId || "").trim() && resolvedLocationId) {
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
function projectCandidateIsCoverageSheet(entity, fileName) {
  const row = (entity?.candidateFiles || []).find((item) => String(item?.stored || item?.name || item?.original || "") === String(fileName || "")) || {};
  return row.coverageJobType === "sheet" || !!row.coverageSheetType || /(?:SHEET|TURNAROUND|CONTACT)/i.test(String(fileName || ""));
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
      if (x.approvedFile && x.continuityStates[0] && !x.continuityStates[0].approvedFile) x.continuityStates[0].approvedFile = x.approvedFile;
      if ((x.continuityStates[0] || {}).approvedFile && x.approvedFile !== x.continuityStates[0].approvedFile) x.approvedFile = x.continuityStates[0].approvedFile;
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
  const projectData = await fetch("/api/projects").then((r) => r.ok ? r.json() : ({ projects: [] })).catch(() => ({ projects: [] }));
  ACTIVE_PROJECT_SLUG = "";
  P = null;
  const projectTitle = $("#project-title"), projectFormat = $("#project-format"), topbarProject = $("#topbar-project");
  if (projectTitle) projectTitle.textContent = "CineBraid";
  if (projectFormat) projectFormat.textContent = "No project open";
  if (topbarProject) topbarProject.textContent = "CineBraid";
  setSaveState("loading", "No project open");
  const existing = (projectData.projects || []).map((project) => `<button class="ghost-btn" onclick="switchProject('${attr(project.slug)}')">Open ${esc(project.title || project.slug)}</button>`).join("");
  $("#main").innerHTML = `<section class="first-run-state" role="status"><div class="first-run-mark">CB</div><div><span>WELCOME TO CINEBRAID</span><h1>Start with a project—or open the sample.</h1><p>CineBraid keeps approved references, continuity, shots, existing media and final deliveries together. AI and in-app generation are optional.</p>${message ? `<small>${esc(message)}</small>` : ""}<div class="first-run-actions"><button class="assemble-btn" onclick="newProject()">Create a project</button>${existing}</div><ol><li>Upload or map existing references.</li><li>Approve the production authorities.</li><li>Attach existing stills, video and audio to shots.</li><li>Finalize the approved result.</li></ol></div></section>`;
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
    projectTitle.setAttribute("aria-label", "Open the project switcher");
  }
  if (projectFormat)
    projectFormat.textContent = title
      ? `Could not open ${title}`
      : "No project open";
  if (topbarProject) topbarProject.textContent = "CineBraid";
}
function renderProjectFailureScreen(failure, message) {
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
async function load() {
  applyTheme();
  /* Every project open goes through here — boot, the switcher, a rollback, a
     restore, a delete, an import — so this is the one place that can honestly
     say "the record on screen is being replaced". Session-scoped derived
     display state is discarded with it. The continuity map is additionally
     keyed by project, so a leak is structurally impossible either way; this
     also covers reopening the SAME project, where the slug never changes but
     the record does. */
  if (typeof resetContinuityWorkspaceState === "function") resetContinuityWorkspaceState();
  const projectResponse = await fetch("/api/project");
  if (projectResponse.status === 404) {
    const data = await projectResponse.json().catch(() => ({}));
    await showFirstRunWorkspace(data.error || "No project is available yet.");
    return;
  }
  if (!projectResponse.ok) {
    const data = await projectResponse.json().catch(() => ({}));
    throw projectLoadError(data);
  }
  const loaded = await Promise.all([
    (async () => {
      ACTIVE_PROJECT_SLUG =
        projectResponse.headers?.get?.("x-cinebraid-project-slug") ||
        ACTIVE_PROJECT_SLUG ||
        "fixture";
      /* Session-scoped activity state follows the project the same way the
         continuity map above does. It is scoped HERE rather than beside that call
         because the slug is only known now, and it drops rows only when the slug
         genuinely changes — load() is also the same-project refresh that runs when
         a generation completes, and those rows describe that work. */
      if (typeof v670ScopeActivityToProject === "function") v670ScopeActivityToProject(ACTIVE_PROJECT_SLUG);
      /* The revision of the exact document this view was built from. Every save
         echoes it, so a save from a view that has fallen behind is refused
         rather than silently overwriting the newer project. */
      PROJECT_REVISION =
        projectResponse.headers?.get?.("x-cinebraid-project-revision") ||
        projectResponse.headers?.get?.("etag") ||
        "";
      return projectResponse.json();
    })(),
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
      .then((r) => r.ok ? r.json() : { runs: [] })
      .catch(() => ({ runs: [] })),
  ]);
  P = loaded[0];
  clearTimeout(saveTimer);
  saveTimer = null;
  SAVE_REVISION = 0;
  SAVED_REVISION = 0;
  PROJECT_CONFLICT = false; // a fresh load is in step with storage again
  SCAN = loaded[1];
  PROMPT_LIBRARY = loaded[2] || { profiles: [] };
  CONFIG = loaded[3] || {};
  AGENT_STATUS = loaded[4] || {
    enabled: false,
    runs: [],
    agents: [],
    index: {},
  };
  AUTOMATION_RUNS = loaded[5]?.runs || [];
  FAL_GENERATION_JOBS = [];
  FAL_GENERATION_LEDGER_LOADED = false;
  const falConfig = CONFIG.generation?.fal || {};
  /* What the server collected through its own background recovery rather than through a
     refresh from here — which is all the server can know, and all it says. The header marks THIS
     request — the initial ledger load — as the one that takes delivery of the notice,
     so the activity drawer's 3.5-second refresh of the same route neither consumes it
     nor repeats it. The URL is unchanged on purpose: it is matched exactly by route
     stubs and paid-call guards that have nothing to do with this. Announced through the
     ordinary toast; nothing new. */
  let backgroundRecovery = null;
  if (falConfig.enabled && falConfig.keySource !== "none") {
    /* Loaded means the request was made AND answered. A refused or failed fetch
       leaves the flag false, so a surface reading provenance says the record is
       unavailable instead of claiming the project has no generation history. */
    FAL_GENERATION_JOBS = await fetch("/api/generation/fal/jobs", { headers: { "x-cinebraid-claim-recovery": "1" } })
      .then((r) => r.ok ? r.json() : { jobs: [] })
      .then((data) => {
        FAL_GENERATION_LEDGER_LOADED = Array.isArray(data.jobs);
        backgroundRecovery = data.backgroundRecovery || null;
        /* Admitted on the payload's own stated owner, exactly as the 3.5-second
           poll admits it. This is the FIRST read of the ledger and it had no check
           at all: the project header and the ledger are two requests, and a switch
           between them lands another project's jobs in the opening view. Refused
           rows leave the ledger EMPTY and unloaded rather than foreign — a surface
           reading provenance then says the record is unavailable, which is true. */
        const admitted = typeof v670AdmitActivityRows === "function"
          ? v670AdmitActivityRows(data, "jobs")
          : { rows: data.jobs || [] };
        if (!admitted.rows) FAL_GENERATION_LEDGER_LOADED = false;
        return admitted.rows || [];
      })
      .catch(() => []);
  }
  applyTheme();
  applyProductionFormat();
  watchIntrinsicAspect();
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
    /* Kept in step with the new-project default in server.js: a video default this
       build cannot dispatch is a dead end handed to every shot in the project. */
    videoProfile: "minimax-h3/i2v",
  };
  (P.shots || []).forEach((s) => {
    s.promptBuilds = s.promptBuilds || [];
  });
  /* Read the stored markers before normalization rewrites them. Loading must never persist
     on its own: defaults applied above are display-only and stay in memory until the user
     makes a real edit. Only a record whose stored schema is genuinely older is written back,
     so opening an already-current project leaves the file byte-identical. */
  const schemaWasOlder = storedSchemaIsOlder(P.meta);
  const migratedV5 = normalizeProjectV5();
  $("#project-title").textContent = P.meta.title;
  $("#project-title").setAttribute("aria-label", `Open the project switcher — ${P.meta.title} is open`);
  $("#project-format").textContent =
    (P.meta.format || "") + (P.meta.version ? " · " + P.meta.version : "");
  $("#topbar-project").textContent = P.meta.title;
  /* The project on screen is the project on disk, so the resting indicator is honest again. */
  setSaveState("saved", "Saved");
  if (!location.hash) location.hash = "#/production";
  route();
  if ((P.meta?.dataIntegrityWarnings || []).length) setTimeout(() => toast(`${P.meta.dataIntegrityWarnings.length} project data-integrity warning${P.meta.dataIntegrityWarnings.length === 1 ? "" : "s"} found. Review Settings or Reports before relying on ambiguous IDs.`), 120);
  /* Work the server collected through background recovery rather than through a
     browser refresh. The results are already in the workspace; this is what says HOW
     they got there. The sentence is the server's — it is the only side that knows
     which collector won — and it deliberately makes no claim about what was open. */
  if (backgroundRecovery?.message) setTimeout(() => toast(backgroundRecovery.message), 200);
  if (schemaWasOlder && migratedV5) setTimeout(() => dirty(), 50);
  if (
    (AGENT_STATUS.runs || []).some((x) =>
      ["QUEUED", "RUNNING"].includes(x.status),
    )
  )
    setTimeout(() => refreshAgentStatus(false), 400);
  if (typeof resumeFalGenerationPolling === "function")
    setTimeout(() => resumeFalGenerationPolling(), 500);
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
function dirty() {
  clearTimeout(saveTimer);
  clearTimeout(SAVE_STATE_TIMER);
  SAVE_REVISION += 1;
  setSaveState("dirty", "Unsaved changes");
  saveTimer = setTimeout(() => {
    saveTimer = null;
    queueProjectSave(captureProjectSave()).catch(() => {});
  }, 500);
}
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
  return {
    slug: ACTIVE_PROJECT_SLUG,
    revision: SAVE_REVISION,
    documentRevision: PROJECT_REVISION,
    body: JSON.stringify(P),
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
function queueProjectSave(job) {
  if (!job) return SAVE_CHAIN;
  const run = SAVE_CHAIN.catch(() => {}).then(async () => {
    if (PROJECT_CONFLICT) return; // this view is known stale; stop writing
    if (ACTIVE_PROJECT_SLUG === job.slug)
      setSaveState("saving", "Saving…");
    const headers = { "Content-Type": "application/json" };
    /* "*" only for a document that has never been stored; otherwise the exact
       revision this view loaded or last wrote.

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
       to make elsewhere. */
    headers["If-Match"] =
      (ACTIVE_PROJECT_SLUG === job.slug ? PROJECT_REVISION : job.documentRevision) || "*";
    const r = await fetch(
      `/api/projects/${encodeURIComponent(job.slug)}/project`,
      {
        method: "PUT",
        headers,
        body: job.body,
      },
    );
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      if (r.status === 409 || r.status === 428) {
        if (ACTIVE_PROJECT_SLUG === job.slug) projectConflict(data);
        return;
      }
      throw new Error(data.error || "Project save failed");
    }
    const saved = await r.json().catch(() => ({}));
    if (ACTIVE_PROJECT_SLUG === job.slug) {
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
  if (!P || !ACTIVE_PROJECT_SLUG || SAVE_REVISION <= SAVED_REVISION) {
    await SAVE_CHAIN;
    return;
  }
  await queueProjectSave(captureProjectSave());
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 2200);
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
$("#project-title").onclick = openProjectSwitcher;
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
  ["assisted", "Build from a script/story with AI — Recommended"],
  ["cinebraid", "Import a CineBraid project"],
  ["scratch", "Start from scratch"],
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
  openModal(`<h3>${esc(title)}</h3><p class="modal-confirm-message">${esc(message)}</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="${danger ? "danger-btn" : "lock-btn"}" id="modal-confirm-action">${esc(confirmLabel)}</button></div>`);
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
  if (entity.continuityStates[0]?.approvedFile && entity.approvedFile !== entity.continuityStates[0].approvedFile)
    entity.approvedFile = entity.continuityStates[0].approvedFile;
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
    return openGuidedPanel(shotId, destination.panel);
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
function projectSharedBlockers(feed) {
  const groups = new Map();
  for (const shot of feed?.shots || []) {
    const rows = [...(shot.requirements || []), ...(shot.units || []).flatMap((unit) => unit.requirements || [])];
    for (const row of rows) {
      if (row.state !== "missing" && row.state !== "needs-decision") continue;
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
  const ready = (feed.shots || []).find((shot) => shot.status === "READY");
  if (ready) {
    const shot = shotById(ready.shotId);
    return {
      kind: "shot", shotId: ready.shotId, href: `#/shot/${ready.shotId}`,
      title: `${ready.shotId}${shot?.title ? ` · ${shot.title}` : ""}`,
      message: ready.nextAction?.message || "",
      actionLabel: readinessActionWords(ready.nextAction).toUpperCase(),
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
    actionLabel: readinessActionWords(first.nextAction).toUpperCase(),
  };
}
window.continueProduction = () => {
  const next = projectNextProductionAction();
  if (!next) return toast("Every shot is complete");
  location.hash = next.href;
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
  for (const id of BATCH_SHOTS) {
    const s = shotById(id);
    s.continuityStateSelections = s.continuityStateSelections || {};
    s.continuityStateSelections[entityId] = stateId;
  }
  closeModal();
  dirty();
  route();
  toast("Continuity state assigned");
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
function shotPlanningFlags(s) {
  normalizeShotV5(s);
  const frames = requiredFrames(s),
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
function projectHealthIssues() {
  const issues = [];
  for (const s of P.shots) {
    const f = shotPlanningFlags(s);
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

function projectDecisionItems() {
  const items = [];
  for (const shot of P.shots || []) {
    const takes = takesFor(shot.id) || [];
    const frames = typeof guidedFrames === "function" ? guidedFrames(shot) : (shot.keyframes || []);
    let framePending = 0;
    for (let i = 0; i < frames.length; i++) {
      const rows = typeof guidedFrameCandidateRows === "function"
        ? guidedFrameCandidateRows(shot, frames[i], takes, i)
        : takes.filter((take) => !isVideo(take.name) && !isAudio(take.name));
      /* WORKFLOW QUEUE, NOT AUTHORITY. "has this frame already been picked" is
         what decides whether its candidates still read as unreviewed; it makes
         no claim that anybody approved the pick. */
      const alreadyPicked = rows.some((row) => row.name === frames[i]?.winner);
      if (rows.length && !alreadyPicked) framePending += rows.length;
    }
    const videos = takes.filter((take) => isVideo(take.name));
    const approvedVideo = (shot.creationBrief?.approvedMotionFile || shot.creationBrief?.finalVideoFile || (shot.clips || []).find((clip) => clip.videoWinner)?.videoWinner);
    if (framePending) items.push({ shot, type: "image", count: framePending, label: `${framePending} frame candidate${framePending === 1 ? "" : "s"} to review` });
    if (videos.length && !approvedVideo) items.push({ shot, type: "video", count: videos.length, label: `${videos.length} video candidate${videos.length === 1 ? "" : "s"} to review` });
  }
  for (const [list, route, label] of [["characters","character","Character"],["locations","location","Location"],["props","prop","Prop"],["audio","sound","Audio"]]) {
    for (const entity of P[list] || []) {
      const media = entityMedia(list, entity);
      const approved = entityApprovedFileForState(entity, "");
      if (media.length && !approved) items.push({ entity, route, type: "reference", count: media.length, label: `${label} reference needs approval` });
    }
  }
  return items;
}
function productionResultInbox(limit = 6) {
  const items = projectDecisionItems();
  return `<section class="production-inbox"><header><div><span>RETURNED RESULTS</span><h2>${items.length ? `${plural(items.length, "decision")} waiting` : "Nothing waiting for review"}</h2><p>Results uploaded inside a frame or motion step appear here automatically.</p></div></header>${items.length ? `<div class="production-inbox-list">${items.map((item) => {
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
  "resolve-state-declaration": "Resolve the declared state",
  "repair-presence-declaration": "Repair the frame presence",
  "resolve-media-ownership": "Resolve the media claim",
  "declare-producible-unit": "Declare what this shot produces",
  "supply-approved-media": "Supply approved media",
  "prepare-references": "Prepare required references",
  "approve-parent-frame": "Approve the previous frame",
  "approve-required-frames": "Approve required frames",
  "produce-frame": "Produce the frame",
  "produce-motion": "Produce the motion",
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
function historicConfirmationMarkup(feed) {
  const queue = feed?.historic;
  if (!queue?.items?.length) return "";
  const rows = queue.items.map((item) => {
    const shots = item.shotIds.length;
    const refused = item.ownership.wouldRefuse;
    const action = refused
      ? `<span class="prompt-check warn" title="${attr(`CineBraid will not approve this file for this reference: ${item.ownership.reason}`)}">Cannot confirm — ${esc(item.ownership.reason || "not owned")}</span>`
      : `<button class="approve-btn" onclick="confirmHistoricSelection('${attr(item.key)}')">Confirm</button>`;
    return `<li><div><b>${esc(item.label)}</b><small>${esc(item.value || "no file recorded")} · ${esc(item.key)}</small><em>Satisfies ${plural(item.requirementCount, "shot requirement")} across ${plural(shots, "shot")}</em></div>${action}</li>`;
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
function shotReadinessFeedMarkup(feed) {
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
  return `<details class="production-readiness shot-readiness" data-readiness-verdict="1" ${counts.ready || feed.truthProblem ? "open" : ""}><summary><div><span>PRODUCTION READINESS</span><b>${esc(headline)}</b></div><span>${counts.needsDecision} DECISION${counts.needsDecision === 1 ? "" : "S"} · ${counts.blocked} BLOCKED</span></summary>${problem}<div class="production-readiness-list shot-readiness-list">${rows || "<p>This project has no shots yet.</p>"}</div>${feed.mediaCheck === "not-checked" ? `<p class="readiness-media-note">Readiness has not been given a media listing, so every approval's file is reported as unverified rather than assumed present.</p>` : ""}</details>`;
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
  const feed = projectShotReadiness();
  const item = (feed?.historic?.items || []).find((row) => row.key === key);
  if (!item) return toast("That selection is no longer waiting for confirmation");
  try {
    commitHistoricConfirmation(item, new Date().toISOString());
  } catch (error) {
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
    try {
      commitHistoricConfirmation(item, at);
      confirmed.push(item.label);
    } catch (error) {
      refused.push(`${item.label}: ${error.message || "refused"}`);
    }
  }
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
  const next = projectNextProductionAction(shotReadiness);
  const decisions = projectDecisionItems();
  const hasShots = P.shots.length > 0;
  /* Three different states of a shot, counted three different ways, so each tile is
     labelled with the one it actually reports:
       delivered — a final still or video file is recorded on the shot
       approved  — the shot's workflow status is APPROVED (it may still need delivery)
       waiting   — a returned result is sitting unreviewed in the inbox           */
  const deliveredCount = P.shots.filter(shotIsDelivered).length;
  const approvedCount = P.shots.filter(shotIsApproved).length;
  const readinessByShot = new Map((shotReadiness?.shots || []).map((row) => [row.shotId, row]));
  const activeRows = P.shots.map((shot) => ({ shot, next: shotProductionNextAction(shot, readinessByShot.get(shot.id)) }))
    .filter((row) => !shotIsDelivered(row.shot)).slice(0, 8);
  return `<div class="view-head production-home-head"><div><div class="eyebrow">Production</div><span class="view-title">${esc(P.meta.title)}</span><div class="view-sub">Continue the film from the next unfinished decision. Detailed tools stay inside each shot.</div></div><div class="production-home-actions"><button class="assemble-btn" onclick="continueProduction()">${next ? "CONTINUE PRODUCTION" : hasShots ? "NOTHING OUTSTANDING" : "ADD THE FIRST SHOT"}</button><button class="add-btn" onclick="openGlobalAdd('shot')">＋ Add shot</button></div></div>
  <div class="production-summary"><article title="A shot is delivered once a final still or video file is recorded on it."><b>${deliveredCount}/${P.shots.length}</b><span>${pluralWord(P.shots.length, "shot")} delivered</span></article><article title="A shot is signed off once its workflow status reaches Signed off. Signing a shot off is not the same as delivering it, and neither one approves an image."><b>${approvedCount}/${P.shots.length}</b><span>${pluralWord(P.shots.length, "shot")} signed off</span></article><article class="review" title="Returned results that are waiting for you to choose or approve."><b>${decisions.length}</b><span>${pluralWord(decisions.length, "decision")} waiting</span></article><article><b>${mmss(P.shots.reduce((sum, shot) => sum + shotDur(shot), 0))}</b><span>planned runtime across ${plural(P.scenes.length, "scene")}</span></article></div>
  <!-- THE ORDER OF THIS PAGE IS THE POINT.
       What to do now, then the outstanding decisions behind it, then the detail.
       The next action used to render THIRD, below a four-row confirmation backlog
       that filled the first viewport with administration -- and the backlog's own
       first row is usually this very action, so the page led with the long form of
       its own answer. Nothing is derived differently; the card is the same card. -->
  ${next ? `<section class="production-next" data-next-action-kind="${attr(next.kind)}"${next.shotId ? ` data-next-action-shot="${attr(next.shotId)}"` : ""}${next.unblocks ? ` data-next-action-unblocks="${attr(String(next.unblocks))}"` : ""}><div><span>NEXT ACTION</span><h2>${esc(next.title)}</h2><p>${esc(next.message)}</p></div><a class="assemble-btn" href="${attr(next.href)}">${esc(next.actionLabel)} →</a></section>` : hasShots ? `<section class="production-next complete"><div><span>NOTHING OUTSTANDING</span><h2>Every declared unit of all ${plural(P.shots.length, "shot")} holds approved authority</h2><p>Readiness has nothing left to ask for. Open Shots to inspect or deliver the approved media, or add another shot.</p></div><a class="ghost-btn" href="#/shots/board">Open Shots →</a></section>` : `<section class="production-next"><div><span>NO SHOTS YET</span><h2>This project has no shots</h2><p>Add the first shot to start tracking scenes, frames and deliveries.</p></div><a class="assemble-btn" href="#/shots/board">Open Shots →</a></section>`}
  ${shotReadinessFeedMarkup(shotReadiness)}
  ${historicConfirmationMarkup(shotReadiness)}
  ${projectSetupIssuesMarkup(setup)}
  ${productionResultInbox()}
  <section class="production-active"><header><div><span>NOT YET DELIVERED</span><h2>Shots and their next action</h2></div><a href="#/shots/board">View all shots →</a></header>${activeRows.length ? `<div class="production-active-list">${activeRows.map(({shot,next}) => `<a href="#/shot/${shot.id}"><span class="next-${next.key}" title="Next action for this shot">${esc(next.label)}</span><div><b>${esc(shot.id)} · ${esc(shot.title)}</b><small>${esc(sceneById(shot.scene)?.title || shot.scene)} · ${esc(next.detail)}</small></div><i>→</i></a>`).join("")}</div>` : `<div class="production-inbox-empty">${hasShots ? "Every shot has been delivered." : "No shots have been added yet."}</div>`}</section>
  <section class="production-scenes"><header><div><span>SCENES</span><h2>Production progress</h2></div><a href="#/shots/scenes">Manage scenes →</a></header>${P.scenes.length ? `<div class="scene-progress-grid">${P.scenes.map((scene) => {
    const shots = P.shots.filter((shot) => shot.scene === scene.id), done = shots.filter(shotIsDelivered).length, pct = shots.length ? Math.round(done / shots.length * 100) : 0;
    const waiting = shots.filter((shot) => readinessByShot.get(shot.id)?.status === "NEEDS_DECISION").length;
    return `<a href="#/scene/${scene.id}" class="scene-progress-card"><header><b>${esc(scene.title)}</b><span title="Shots delivered in this scene">${done}/${shots.length} delivered</span></header><div class="progress-line"><i style="width:${pct}%"></i></div><footer><span>${plural(waiting, "shot")} waiting for review</span><span>${plural(shots.length - done, "shot")} not delivered</span></footer></a>`;
  }).join("")}</div>` : `<div class="production-inbox-empty">No scenes have been added yet.</div>`}</section>`;
}
window.openGlobalAdd = (preferred = "") => {
  const choices = [
    ["shot","Shot","Add a shot to an existing scene or create the first scene."],
    ["scene","Scene","Create a scene before adding its shots."],
    ["character","Character","Create an identity and reference pack."],
    ["location","Location","Create a reusable location plate and continuity states."],
    ["prop","Prop","Create an object reference and continuity states."],
    ["audio","Audio","Add dialogue, ambience, music, or timing material."],
    ["project","New project","Start from scratch or import structured material."],
  ];
  openModal(`<div class="global-add-modal"><h3>What are you adding?</h3><div class="modal-sub">Choose the record you need. CineBraid will take you to its one canonical workspace.</div><div class="global-add-grid">${choices.map(([key,label,note]) => `<button class="${preferred === key ? "recommended" : ""}" onclick="runGlobalAdd('${key}')"><b>${label}</b><span>${note}</span></button>`).join("")}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button></div></div>`);
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


function shotBoardActionCategory(shot, readiness = shotReadinessFor(shot)) {
  if (shotIsDelivered(shot)) return "complete";
  if (readiness?.status === "NEEDS_DECISION") return "review";
  if (readiness?.status === "BLOCKED") return "missing-inputs";
  if (readiness?.status === "READY") return "ready";
  return "unfinished";
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
  if (FILTER.action === "unfinished") return !shotIsDelivered(shot);
  return category === FILTER.action;
}
function shotBoardActionFilters(feed = projectShotReadiness()) {
  const defs = [["unfinished","Not delivered"],["review","Needs review"],["missing-inputs","Missing inputs"],["ready",manualFirstWorkflow() ? "Ready for media" : "Ready to generate"],["complete","Delivered"],["all","All shots"]];
  const counts = Object.fromEntries(defs.map(([id]) => [id, P.shots.filter((shot) => id === "all" ? true : id === "unfinished" ? !shotIsDelivered(shot) : shotBoardActionCategory(shot, shotReadinessFor(shot, feed)) === id).length]));
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
  const head = `<div class="view-head board-head"><div><div class="eyebrow">Shots</div><span class="view-title">Shots</span><div class="view-sub">Track scene readiness, approved frames, and one clear next action for every shot.</div></div><div class="board-head-actions"><button class="assemble-btn" onclick="continueProduction()">CONTINUE</button><button class="add-btn" onclick="openGlobalAdd('shot')">＋ Add</button></div></div>${tabs}`;
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
    : `<div class="empty-state"><h2>This project has no shots yet</h2><p>Add the first shot to start tracking scenes, frames and deliveries.</p><button class="add-btn" onclick="openGlobalAdd('shot')">＋ Add shot</button></div>`);
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
window.setShotContinuityState = (shotId, entityId, stateId) => {
  const s = shotById(shotId);
  s.continuityStateSelections = s.continuityStateSelections || {};
  if (stateId) s.continuityStateSelections[entityId] = stateId;
  else delete s.continuityStateSelections[entityId];
  dirty();
  route();
};

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
    const unapproved = refs.filter((x) => entityWorkflowState(x).key !== "APPROVED");
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
