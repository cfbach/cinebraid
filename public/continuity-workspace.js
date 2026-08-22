/* CINEBRAID — declared-entity continuity: the shot workspace surface.

   This file renders and writes. It does not judge.

   Every verdict word on screen — STABLE, ISSUE, EXPECTED, UNCERTAIN, REVIEW —
   and every sentence describing a finding arrives already decided from
   public/shared-continuity.js by way of /api/continuity/compare. Nothing here
   reads a validation flag code, a bounding box, an enum, or a raw model note,
   and nothing here recomputes a comparison from observation fields. If a word
   on screen looks wrong, the fix belongs in the shared core, where the offline
   suites can assert it without a browser.

   What this file owns:
     - the CONTINUITY section inside the FRAMES stage
     - the frame pair being compared
     - declared continuity intent, per shot and per entity
     - per-frame continuity state selection (the 6.7 writers)
     - re-observation, which purges derived evidence and never media */

/* The comparison is derived evidence, not project truth: the observations
   behind it are already cached server-side and a repeat check is usually
   instant, so a result lives for the session and is never written into
   project.json.

   It is keyed by PROJECT and shot, not by shot alone. Shot ids are only unique
   inside a project — two projects routinely both have an L1-01 — and switching
   projects replaces P in place without reloading the page, so a map keyed by
   shot id alone served the previous project's verdict, declarations and all, to
   the next one. Scoping the key is the fix rather than clearing on switch:
   every project load path would otherwise need its own hook, and the one that
   was missed is exactly how this reached acceptance. A stale entry now cannot
   be addressed, whichever path opened the project. */
const CONTINUITY_RUNS = new Map();
function continuityProjectKey() {
  if (typeof ACTIVE_PROJECT_SLUG !== "undefined" && ACTIVE_PROJECT_SLUG) return String(ACTIVE_PROJECT_SLUG);
  if (typeof window !== "undefined" && window.ACTIVE_PROJECT_SLUG) return String(window.ACTIVE_PROJECT_SLUG);
  return "";
}
function continuityRunKey(shotId) {
  const project = continuityProjectKey();
  return project ? `${project}::${String(shotId)}` : "";
}
function continuityRun(shotId) {
  const key = continuityRunKey(shotId);
  if (!key) return null;
  const run = CONTINUITY_RUNS.get(key) || null;
  /* Read-side revalidation. The key already scopes it; this makes a mismatch
     unrepresentable even if some future caller builds a key another way. */
  return run && run.projectKey === continuityProjectKey() ? run : null;
}
function setContinuityRun(shotId, value) {
  const project = continuityProjectKey();
  const key = continuityRunKey(shotId);
  if (!key) return;
  /* Nothing from another project stays resident. */
  for (const [existing, run] of CONTINUITY_RUNS)
    if (run?.projectKey !== project) CONTINUITY_RUNS.delete(existing);
  if (value) CONTINUITY_RUNS.set(key, { ...value, projectKey: project });
  else CONTINUITY_RUNS.delete(key);
}
/* Called by load(), which every project open funnels through. A verdict was
   computed against the project record being replaced, so it does not survive
   the replacement — including a reopen of the same project, where the scoped
   key alone would have let it through. */
function resetContinuityWorkspaceState() {
  CONTINUITY_RUNS.clear();
}

const CONTINUITY_OUTCOME_ORDER = ["stable", "issue", "expected", "uncertain", "review"];
const CONTINUITY_OUTCOME_MARKS = { stable: "✓", issue: "▲", expected: "◆", uncertain: "?", review: "●" };
const CONTINUITY_OUTCOME_WORDS = { stable: "Stable", issue: "Issue", expected: "Expected", uncertain: "Uncertain", review: "Review" };
const CONTINUITY_KIND_WORDS = { character: "Character", location: "Location", prop: "Prop", vehicle: "Vehicle" };

/* A bare number beside a fold that visibly contains rows reads as a count of
   the rows. It is not — it counts what production has actually declared, which
   is usually none of them. Say the noun, or say nothing. */
function continuityFoldCount(total, singular, plural) {
  return total ? ` · ${total} ${total === 1 ? singular : plural}` : "";
}

/* Readiness is the continuity provider's own, never generic vision. On the
   intended runtime the multi-image vision provider is deliberately unavailable
   while continuity is ready, so borrowing that answer would disable a working
   instrument and then blame the wrong setting for it. */
function continuityCapability() {
  const state = typeof capabilityState === "function" ? capabilityState("continuity") : null;
  if (state && typeof state.ready === "boolean") return state;
  return {
    ready: false,
    message: "Continuity analysis isn't configured.",
    action: "Choose a continuity vision provider in Settings.",
  };
}

function continuityApprovedFrames(s, takes = takesFor(s.id)) {
  const frames = typeof guidedFrames === "function" ? guidedFrames(s) : (s.keyframes || []);
  return frames
    .map((frame, index) => ({ frame, index, approved: guidedFrameApproved(s, frame, takes, index) }))
    .filter((row) => !!row.approved);
}
/* A → B first, then every other ordered pair. Comparing a frame with a later
   frame is the only direction that means anything in a shot. */
function continuityFramePairs(rows) {
  const pairs = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++)
      pairs.push({ id: `${rows[i].frame.id}|${rows[j].frame.id}`, a: rows[i], b: rows[j] });
  return pairs.slice(0, 10);
}
function continuityFrameWord(row) {
  return `Frame ${row?.frame?.label || "?"}`;
}
function continuitySelectedPair(s, pairs) {
  if (!pairs.length) return null;
  const ids = pairs.map((pair) => pair.id);
  const selected = boundedSelected("continuity-pair", s.id, ids, ids[0]);
  return pairs.find((pair) => pair.id === selected) || pairs[0];
}

/* The entities this shot declares and continuity is allowed to judge. Same
   resolver the manifest builder uses, so the rows on screen are the rows the
   model was asked about. */
function continuityEntityRows(s) {
  const records = typeof shotDependencyRecords === "function" ? shotDependencyRecords(P, s) || [] : [];
  const kinds = typeof VISUAL_ENTITY_KINDS !== "undefined" ? VISUAL_ENTITY_KINDS : ["character", "location", "prop", "vehicle"];
  const rows = [];
  const seen = new Set();
  for (const record of records) {
    if (!record?.resolved || !record.entity || !kinds.includes(record.type)) continue;
    const id = String(record.entity.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const tracking = typeof resolveEntityTracking === "function"
      ? resolveEntityTracking(record.entity, null)
      : { enabled: true };
    rows.push({ type: record.type, entity: record.entity, tracking });
  }
  return rows.filter((row) => row.tracking.enabled !== false);
}

/* ---------- declared intent ---------------------------------------------- */

function shotContinuityIntent(s, entityId) {
  return typeof resolveEntityIntent === "function"
    ? resolveEntityIntent(s, entityId)
    : { expected: [], allowPresenceChange: "no", allowMovement: false, allowColorChange: false, allowStateChange: false, note: "" };
}
/* Writes into shot.continuityIntent, the Phase 1 contract, and nowhere else.
   A declaration that is back at its default is removed rather than stored as a
   negative, so "nothing is declared" stays representable. */
function writeContinuityIntent(s, entityId, mutate) {
  s.continuityIntent = s.continuityIntent && typeof s.continuityIntent === "object" ? s.continuityIntent : {};
  const current = { ...shotContinuityIntent(s, entityId) };
  mutate(current);
  const empty = current.allowPresenceChange === "no"
    && !current.allowMovement && !current.allowColorChange && !current.allowStateChange
    && !(current.expected || []).length && !String(current.note || "").trim();
  if (empty) delete s.continuityIntent[entityId];
  else s.continuityIntent[entityId] = current;
  if (!Object.keys(s.continuityIntent).length) delete s.continuityIntent;
}

window.setContinuityIntentField = (shotId, entityId, fieldName, value) => {
  const s = shotById(shotId);
  if (!s) return toast("Shot is unavailable");
  writeContinuityIntent(s, entityId, (intent) => {
    if (fieldName === "allowPresenceChange") intent.allowPresenceChange = String(value || "no");
    else intent[fieldName] = !!value;
  });
  markContinuitySchema();
  dirty();
  route();
};
window.setContinuityExpectedText = (shotId, entityId, text) => {
  const s = shotById(shotId);
  if (!s) return toast("Shot is unavailable");
  writeContinuityIntent(s, entityId, (intent) => {
    intent.expected = String(text || "").split("\n").map((row) => row.trim()).filter(Boolean).slice(0, 24);
  });
  markContinuitySchema();
  dirty();
};

/* MARK EXPECTED. The action is recomputed from the finding by the same shared
   function the server used to offer it, so the button and the writer can never
   disagree about what a declaration means.

   Only a finding the comparison classed as a real change carries one: unreadable
   evidence, uncertain presence and invalid records live in other buckets, are
   never offered the control, and could not be cleared by a declaration anyway —
   applyIntent labels changes and nothing else, so the human-review floor holds
   structurally rather than by the UI being careful. */
window.markContinuityExpected = (shotId, entityId, type, attribute) => {
  const s = shotById(shotId);
  if (!s) return toast("Shot is unavailable");
  if (typeof expectedActionFor !== "function") return toast("Continuity intent is unavailable");
  const action = expectedActionFor({ entity_id: entityId, kind: type, attribute: attribute || "" });
  if (action.target === "intent") {
    writeContinuityIntent(s, entityId, (intent) => {
      if (action.field !== "allowPresenceChange") { intent[action.field] = true; return; }
      /* Declaring the opposite direction as well would over-permit: a shot that
         already allows leaving and now also allows entering says "either". */
      const current = intent.allowPresenceChange;
      intent.allowPresenceChange = current === "no" || current === action.value ? action.value : "either";
    });
  } else {
    s.continuityIntentAccepted = s.continuityIntentAccepted && typeof s.continuityIntentAccepted === "object" ? s.continuityIntentAccepted : {};
    s.continuityIntentAccepted[action.field] = true;
  }
  markContinuitySchema();
  dirty();
  toast("Declared as intentional — rechecking");
  /* Reclassification is deterministic and the observations are cached, so the
     honest thing is to re-run the comparison rather than hide the card. */
  runShotContinuityCheck(shotId, { silent: true });
};

/* ---------- per-frame continuity state ------------------------------------ */

/* Locations keep their own shape. `locationStateId` is a single value on the
   frame record and is what server.js reads when it assembles the frame's
   design authorities; props, characters and vehicles are per-entity maps. The
   reader in shared-continuity.js honours both, so this writes each in the
   structure that already exists rather than inventing a third. */
const CONTINUITY_STATE_MAP_KEYS = {
  character: "characterStateSelections",
  prop: "propStateSelections",
  vehicle: "vehicleStateSelections",
};
function frameStateSelection(s, frameId, kind, entityId) {
  const workflow = (ensureShotCreation(s).frameWorkflows || {})[frameId];
  if (!workflow || typeof workflow !== "object") return "";
  if (kind === "location") {
    const explicit = workflow.locationStateSelections;
    if (explicit && typeof explicit === "object" && !Array.isArray(explicit) && String(explicit[entityId] || ""))
      return String(explicit[entityId]);
    return String(workflow.locationStateId || "");
  }
  const map = workflow[CONTINUITY_STATE_MAP_KEYS[kind]];
  return map && typeof map === "object" ? String(map[entityId] || "") : "";
}
window.setFrameContinuityState = (shotId, frameId, kind, entityId, stateId) => {
  const s = shotById(shotId);
  if (!s) return toast("Shot is unavailable");
  const c = ensureShotCreation(s);
  const workflow = c.frameWorkflows[frameId] = c.frameWorkflows[frameId] && typeof c.frameWorkflows[frameId] === "object"
    ? c.frameWorkflows[frameId]
    : {};
  const value = String(stateId || "");
  if (kind === "location") {
    /* The shared binding reader honours the older per-entity location map before
       the bare locationStateId. Clear that exact legacy entry while repairing it,
       or writing the current frame control would leave the invalid higher-priority
       override in force and falsely appear successful. */
    const explicit = workflow.locationStateSelections;
    if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
      delete explicit[entityId];
      if (!Object.keys(explicit).length) delete workflow.locationStateSelections;
    }
    if (value) workflow.locationStateId = value;
    else delete workflow.locationStateId;
  } else {
    const key = CONTINUITY_STATE_MAP_KEYS[kind] || CONTINUITY_STATE_MAP_KEYS.prop;
    const map = workflow[key] = workflow[key] && typeof workflow[key] === "object" ? workflow[key] : {};
    if (value) map[entityId] = value;
    else delete map[entityId];
    if (!Object.keys(map).length) delete workflow[key];
  }
  markContinuitySchema();
  dirty();
  route();
};

/* ---------- running a check ----------------------------------------------- */

window.runShotContinuityCheck = async (shotId, options = {}) => {
  const s = shotById(shotId);
  if (!s) return toast("Shot is unavailable");
  const capability = continuityCapability();
  if (!capability.ready) return toast(capability.message || "Continuity analysis isn't configured.");
  const rows = continuityApprovedFrames(s);
  const pairs = continuityFramePairs(rows);
  const pair = continuitySelectedPair(s, pairs);
  if (!pair) return toast("Continuity requires two approved frames");
  /* A check outlives its own await. If the project is switched while the
     comparison is in flight, the answer belongs to the project that asked for
     it and must not be written into whichever one is open when it lands. */
  const askedBy = continuityProjectKey();
  const stillOurs = () => continuityProjectKey() === askedBy;
  setContinuityRun(shotId, { status: "working", pairId: pair.id, labelA: continuityFrameWord(pair.a), labelB: continuityFrameWord(pair.b) });
  route();
  try {
    if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
    const response = await fetch("/api/continuity/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shotId,
        frameA: pair.a.frame.id,
        frameB: pair.b.frame.id,
        fileNameA: pair.a.approved.name,
        fileNameB: pair.b.approved.name,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Continuity check failed");
    if (!stillOurs()) return;
    setContinuityRun(shotId, { status: "done", pairId: pair.id, labelA: continuityFrameWord(pair.a), labelB: continuityFrameWord(pair.b), data });
    route();
    if (!options.silent) toast(continuityRunHeadline(data));
  } catch (error) {
    if (!stillOurs()) return;
    setContinuityRun(shotId, { status: "error", pairId: pair.id, labelA: continuityFrameWord(pair.a), labelB: continuityFrameWord(pair.b), error: error.message });
    route();
    if (!options.silent) toast("Continuity check failed: " + error.message);
  }
};
function continuityRunHeadline(data) {
  if (!data?.analysis?.usable) return "Continuity could not be evaluated";
  const counts = data.outcomeCounts || {};
  if (counts.issue) return `${counts.issue} continuity issue${counts.issue === 1 ? "" : "s"}`;
  if (counts.review) return "Continuity needs human review";
  if (counts.uncertain) return "Continuity is inconclusive for some entities";
  return "Continuity is stable";
}

/* Re-observation discards derived evidence for the named frames and asks
   again. It removes nothing else: no media, no candidate, no project record.
   Cache keys and purge scopes stay server-side — the browser names a shot and
   a frame, which are things it already owns. */
window.reobserveShotContinuity = (shotId, side = "") => {
  const s = shotById(shotId);
  if (!s) return toast("Shot is unavailable");
  const rows = continuityApprovedFrames(s);
  const pair = continuitySelectedPair(s, continuityFramePairs(rows));
  if (!pair) return toast("Continuity requires two approved frames");
  const targets = side === "a" ? [pair.a] : side === "b" ? [pair.b] : [pair.a, pair.b];
  const names = targets.map(continuityFrameWord).join(" and ");
  confirmModal(
    `Run the visual analysis again for ${names}? The stored analysis is discarded and each frame is looked at fresh. Images, candidates and project records are not touched.`,
    async () => {
      const askedBy = continuityProjectKey();
      setContinuityRun(shotId, { status: "working", pairId: pair.id, labelA: continuityFrameWord(pair.a), labelB: continuityFrameWord(pair.b) });
      route();
      try {
        for (const target of targets) {
          const response = await fetch(`/api/continuity/cache?shotId=${encodeURIComponent(shotId)}&frameId=${encodeURIComponent(target.frame.id)}`, { method: "DELETE" });
          if (!response.ok) throw new Error((await response.json()).error || "Could not clear the stored analysis");
        }
      } catch (error) {
        if (continuityProjectKey() !== askedBy) return;
        setContinuityRun(shotId, { status: "error", pairId: pair.id, error: error.message });
        route();
        return toast("Re-observe failed: " + error.message);
      }
      /* The purge is scoped to a shot in whichever project was active when the
         request went out; re-checking under a different one would be nonsense. */
      if (continuityProjectKey() !== askedBy) return;
      runShotContinuityCheck(shotId);
    },
    { title: "Re-observe frames", confirmLabel: "RE-OBSERVE", danger: false },
  );
};

/* ---------- markup -------------------------------------------------------- */

function continuityOutcomeCountsMarkup(counts) {
  return `<ul class="continuity-outcome-counts">${CONTINUITY_OUTCOME_ORDER.map((outcome) => {
    const value = Number(counts?.[outcome] || 0);
    return `<li class="outcome-${outcome} ${value ? "" : "is-zero"}"><i aria-hidden="true">${CONTINUITY_OUTCOME_MARKS[outcome]}</i><b>${value}</b><span>${CONTINUITY_OUTCOME_WORDS[outcome]}</span></li>`;
  }).join("")}</ul>`;
}
/* Provenance in one plain line. Whether a frame had to be looked at again is
   worth knowing; the key that decided it is not. */
function continuityProvenanceMarkup(data) {
  const cachedA = !!data?.observations?.a?.cached;
  const cachedB = !!data?.observations?.b?.cached;
  const labelA = data.frameA?.label ? `Frame ${data.frameA.label}` : "First frame";
  const labelB = data.frameB?.label ? `Frame ${data.frameB.label}` : "Second frame";
  const provenance = cachedA && cachedB
    ? "both cached"
    : !cachedA && !cachedB
      ? "2 new analyses"
      : `${cachedA ? labelA : labelB} cached · ${cachedA ? labelB : labelA} newly analyzed`;
  /* Only worth saying next to a verdict. Beside a failed analysis it is noise. */
  const notes = data?.analysis?.notes && data?.analysis?.usable ? " · some readings were adjusted before comparison" : "";
  return `<p class="continuity-provenance">Observed 2 frames · ${esc(provenance)}${esc(notes)}</p>`;
}

/* The class chip is repeated on a finding only when the card holds more than
   one, because a single-finding card already says it once in its header and
   reading the same word twice makes the card look like a debug dump. */
function continuityFindingRowMarkup(shotId, finding, showClass) {
  const transition = finding.from || finding.to
    ? `<span class="continuity-transition"><b>${esc(finding.from || "—")}</b><i aria-hidden="true">→</i><b>${esc(finding.to || "—")}</b></span>`
    : "";
  const action = finding.canMarkExpected
    ? `<div class="continuity-finding-actions"><button type="button" class="chip" onclick="markContinuityExpected('${attr(shotId)}','${attr(finding.entityId)}','${attr(finding.type)}','${attr(finding.attribute || "")}')">MARK EXPECTED</button></div>`
    : "";
  return `<li class="continuity-finding class-${attr(finding.class)}">
    ${showClass ? `<span class="continuity-finding-class">${esc(CONTINUITY_OUTCOME_LABELS[finding.class] || finding.class)}${finding.severity ? ` · ${esc(String(finding.severity).toUpperCase())}` : ""}</span>` : ""}
    <b>${esc(finding.headline)}</b>
    ${transition}
    ${finding.detail ? `<small>${esc(finding.detail)}</small>` : ""}
    ${finding.reason ? `<em>${esc(finding.reason)}</em>` : ""}
    ${finding.recommendation ? `<p>${esc(finding.recommendation)}</p>` : ""}
    ${action}
  </li>`;
}
function continuityEntityCardMarkup(shotId, row) {
  const single = row.findings.length === 1 ? row.findings[0] : null;
  const severity = single && single.severity && single.class === row.outcome ? ` · ${esc(String(single.severity).toUpperCase())}` : "";
  return `<article class="continuity-entity outcome-${attr(row.outcome)}">
    <header><span class="continuity-outcome">${esc(CONTINUITY_OUTCOME_LABELS[row.outcome] || row.outcome)}${severity}</span><b>${esc(row.displayName)}</b><small>${esc(CONTINUITY_KIND_WORDS[row.kind] || row.kind)}</small></header>
    <ul class="continuity-finding-list">${row.findings.map((finding) => continuityFindingRowMarkup(shotId, finding, row.findings.length > 1)).join("")}</ul>
  </article>`;
}
/* Stable entities are the majority in a healthy shot and each deserves a line,
   not a card. They stay named, because "CineBraid looked and found nothing"
   only means something if you can see what it looked at. */
function continuityStableMarkup(rows) {
  if (!rows.length) return "";
  return `<details class="continuity-stable" ${rows.length <= 3 ? "open" : ""}><summary><span class="continuity-outcome">STABLE</span><b>${rows.length} ${rows.length === 1 ? "entity is" : "entities are"} consistent across both frames</b></summary><ul>${rows.map((row) => `<li><b>${esc(row.displayName)}</b><small>${esc(CONTINUITY_KIND_WORDS[row.kind] || row.kind)}</small></li>`).join("")}</ul></details>`;
}

function continuityAnalysisErrorMarkup(shotId, data) {
  const frames = data.analysis.unusableFrames || [];
  const named = frames.map((row) => row.label).join(" and ") || "One frame";
  const side = frames.length === 1 ? frames[0].side : "";
  return `<div class="continuity-analysis-error">
    <b>Continuity could not be evaluated.</b>
    <p>${esc(named)} returned an invalid observation, so there is nothing safe to compare. Re-observe the ${frames.length === 1 ? "frame" : "frames"} or review the ${frames.length === 1 ? "image" : "images"} manually. This is an analysis failure, not a continuity issue.</p>
    <button type="button" class="approve-btn" onclick="reobserveShotContinuity('${attr(shotId)}','${attr(side)}')">RE-OBSERVE ${esc(frames.length === 1 ? named.toUpperCase() : "BOTH FRAMES")}</button>
  </div>`;
}

function continuityResultMarkup(shotId, run) {
  if (!run) return "";
  if (run.status === "working")
    return `<div class="continuity-result state-working"><i class="spin">◌</i><div><b>Checking ${esc(run.labelA || "the first frame")} against ${esc(run.labelB || "the second frame")}…</b><small>Each frame is looked at on its own. CineBraid does the comparison.</small></div></div>`;
  if (run.status === "error")
    return `<div class="continuity-result state-error"><b>Continuity check failed</b><p>${esc(run.error || "The continuity provider did not answer.")}</p><button type="button" class="ghost-btn" onclick="runShotContinuityCheck('${attr(shotId)}')">TRY AGAIN</button></div>`;
  const data = run.data;
  if (!data) return "";
  if (!data.analysis?.usable)
    return `<div class="continuity-result state-unusable">${continuityAnalysisErrorMarkup(shotId, data)}${continuityProvenanceMarkup(data)}</div>`;
  const entities = Array.isArray(data.entities) ? data.entities : [];
  const stable = entities.filter((row) => row.outcome === "stable");
  const flagged = entities
    .filter((row) => row.outcome !== "stable")
    .sort((a, b) => CONTINUITY_OUTCOME_ORDER.indexOf(b.outcome) - CONTINUITY_OUTCOME_ORDER.indexOf(a.outcome));
  return `<div class="continuity-result state-done">
    ${continuityOutcomeCountsMarkup(data.outcomeCounts)}
    ${continuityProvenanceMarkup(data)}
    <div class="continuity-entity-list">${flagged.map((row) => continuityEntityCardMarkup(shotId, row)).join("")}</div>
    ${continuityStableMarkup(stable)}
    <div class="continuity-secondary-actions"><button type="button" class="ghost-btn" onclick="reobserveShotContinuity('${attr(shotId)}')">RE-OBSERVE</button></div>
  </div>`;
}

/* ---------- declared intent surface --------------------------------------- */

function continuityIntentPanelMarkup(s, rows) {
  if (!rows.length) return "";
  const key = `${s.id}:continuity-intent`;
  const declared = rows.filter((row) => {
    const intent = shotContinuityIntent(s, row.entity.id);
    return intent.allowPresenceChange !== "no" || intent.allowMovement || intent.allowColorChange || intent.allowStateChange || intent.expected.length;
  }).length;
  const allowances = typeof PRESENCE_ALLOWANCES !== "undefined" ? PRESENCE_ALLOWANCES : ["no", "may-leave", "may-enter", "either"];
  const allowanceWords = { no: "Must stay as it is", "may-leave": "May leave", "may-enter": "May enter", either: "May leave or enter" };
  const body = rows.map((row) => {
    const intent = shotContinuityIntent(s, row.entity.id);
    const id = row.entity.id;
    const toggle = (fieldName, label) => `<label class="checkline"><input type="checkbox" ${intent[fieldName] ? "checked" : ""} onchange="setContinuityIntentField('${attr(s.id)}','${attr(id)}','${attr(fieldName)}',this.checked)"> ${esc(label)}</label>`;
    return `<article class="continuity-intent-row">
      <header><b>${esc(row.entity.name || id)}</b><small>${esc(CONTINUITY_KIND_WORDS[row.type] || row.type)}</small></header>
      <label class="continuity-intent-presence"><span>Presence</span><select onchange="setContinuityIntentField('${attr(s.id)}','${attr(id)}','allowPresenceChange',this.value)">${allowances.map((value) => `<option value="${attr(value)}" ${intent.allowPresenceChange === value ? "selected" : ""}>${esc(allowanceWords[value] || value)}</option>`).join("")}</select></label>
      <div class="continuity-intent-toggles">${toggle("allowMovement", "May move")}${toggle("allowColorChange", "Colour may change")}${toggle("allowStateChange", "State may change")}</div>
      <label class="continuity-intent-note"><span>Other expected changes — one per line</span><textarea rows="2" placeholder="Kai removes the jacket" onchange="setContinuityExpectedText('${attr(s.id)}','${attr(id)}',this.value)">${esc((intent.expected || []).join("\n"))}</textarea></label>
    </article>`;
  }).join("");
  return `<details class="fold continuity-intent" ${workspaceSectionOpen(key, false) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Declared continuity intent${esc(continuityFoldCount(declared, "declaration", "declarations"))}</summary><p class="hint">Declare a change before it is found and CineBraid reports it as expected instead of a break. Prefer a frame state below for anything the Bible can already name.</p><div class="continuity-intent-grid">${body}</div></details>`;
}

/* ---------- per-frame state surface --------------------------------------- */

function continuityFrameStatePanelMarkup(s, rows, pair) {
  if (!rows.length) return "";
  const key = `${s.id}:continuity-frame-states`;
  const allFrames = (typeof guidedFrames === "function" ? guidedFrames(s) : (s.keyframes || []))
    .map((frame, index) => ({ frame, index }));
  /* Pair controls keep their existing order. Invalid overrides outside the active
     approved pair are appended so every readiness producer has a reachable repair
     control, including an unapproved frame that cannot yet participate in a visual
     comparison. */
  const invalidFrameIds = new Set();
  for (const row of rows) {
    const owned = new Set((typeof entityStateListRead === "function" ? entityStateListRead(row.entity, true) : (row.entity.continuityStates || []))
      .map((state) => String(state?.id || "")).filter(Boolean));
    for (const frameRow of allFrames) {
      const current = frameStateSelection(s, frameRow.frame.id, row.type, row.entity.id);
      if (current && !owned.has(current)) invalidFrameIds.add(String(frameRow.frame.id));
    }
  }
  const frames = [];
  for (const frameRow of pair ? [pair.a, pair.b] : [])
    if (frameRow?.frame?.id && !frames.some((row) => row.frame.id === frameRow.frame.id)) frames.push(frameRow);
  for (const frameRow of allFrames)
    if (invalidFrameIds.has(String(frameRow.frame.id)) && !frames.some((row) => row.frame.id === frameRow.frame.id)) frames.push(frameRow);
  if (!frames.length) return "";
  const declared = rows.reduce((total, row) => total + frames.filter((frameRow) => frameStateSelection(s, frameRow.frame.id, row.type, row.entity.id)).length, 0);
  const body = rows.map((row) => {
    const states = typeof entityStateList === "function" ? entityStateListRead(row.entity, true) : (row.entity.continuityStates || []);
    const hasInvalid = frames.some((frameRow) => {
      const current = frameStateSelection(s, frameRow.frame.id, row.type, row.entity.id);
      return !!current && !states.some((state) => String(state.id || "") === current);
    });
    if (states.length < 2 && !hasInvalid) return "";
    const cells = frames.map((frameRow) => {
      const current = frameStateSelection(s, frameRow.frame.id, row.type, row.entity.id);
      const invalid = !!current && !states.some((state) => String(state.id || "") === current);
      const inherited = typeof resolveDeclaredStateId === "function" ? resolveDeclaredStateId(s, "", row.type, row.entity.id) : "";
      const effective = typeof resolveStateRecord === "function" ? resolveStateRecord(row.entity, inherited) : states[0];
      const invalidOption = invalid
        ? `<option value="${attr(current)}" selected disabled>Invalid override · ${esc(current)} is not owned by ${esc(row.entity.name || row.entity.id)}</option>`
        : "";
      return `<label data-frame-state-declaration-invalid="${invalid ? "1" : "0"}" data-frame-state-frame="${attr(frameRow.frame.id)}" data-frame-state-entity="${attr(row.entity.id)}"><span>${esc(continuityFrameWord(frameRow))}</span><select aria-label="State for ${attr(row.entity.name || row.entity.id)} on ${attr(continuityFrameWord(frameRow))}" onchange="setFrameContinuityState('${attr(s.id)}','${attr(frameRow.frame.id)}','${attr(row.type)}','${attr(row.entity.id)}',this.value)"><option value="" ${current ? "" : "selected"}>Follow the shot — ${esc(effective?.name || "Default")}</option>${invalidOption}${states.map((state) => `<option value="${attr(state.id)}" ${!invalid && current === state.id ? "selected" : ""}>${esc(state.name || "State")}</option>`).join("")}</select></label>`;
    }).join("");
    return `<article class="continuity-state-row"><header><b>${esc(row.entity.name || row.entity.id)}</b><small>${esc(CONTINUITY_KIND_WORDS[row.type] || row.type)}</small></header><div class="continuity-state-cells">${cells}</div></article>`;
  }).join("");
  if (!body) return "";
  return `<details class="fold continuity-frame-states" data-readiness-action-surface="shot-frame-state-declaration" ${workspaceSectionOpen(key, false) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Frame states${esc(continuityFoldCount(declared, "override", "overrides"))}</summary><p class="hint">Set a frame-specific state when a change is intentional. Otherwise the frame follows the shot, then the reference default. Invalid overrides remain visible until this frame control changes them.</p><div class="continuity-state-grid">${body}</div></details>`;
}

/* ---------- the section --------------------------------------------------- */

function guidedContinuityPanel(s, takes) {
  const rows = continuityApprovedFrames(s, takes);
  const pairs = continuityFramePairs(rows);
  const pair = continuitySelectedPair(s, pairs);
  const capability = continuityCapability();
  const entityRows = continuityEntityRows(s);
  const run = continuityRun(s.id);
  /* A result that belongs to a different pair is not this comparison's result. */
  const currentRun = run && pair && run.pairId === pair.id ? run : null;

  const chooser = pairs.length > 1
    ? `<label class="continuity-pair-choice"><span class="sr-only">Frames to compare</span><select onchange="selectBoundedItem('continuity-pair','${attr(s.id)}',this.value)">${pairs.map((option) => `<option value="${attr(option.id)}" ${option.id === pair.id ? "selected" : ""}>${esc(continuityFrameWord(option.a))} → ${esc(continuityFrameWord(option.b))}</option>`).join("")}</select></label>`
    : "";

  let body = "";
  let action = "";
  if (rows.length < 2) {
    body = `<p class="continuity-requirement">Continuity requires two approved frames. Approve a second frame in this shot and the check becomes available.</p>`;
  } else if (!entityRows.length) {
    body = `<p class="continuity-requirement">This shot declares no tracked references yet. Assign its cast, location or props in Inputs so CineBraid knows what to hold consistent.</p>`;
  } else if (!capability.ready) {
    body = `<p class="continuity-requirement">${esc(capability.message || "Continuity analysis isn't configured.")} ${esc(capability.action || "Choose a continuity vision provider in Settings.")}</p>`;
    action = `<button type="button" class="approve-btn" disabled title="${attr([capability.message, capability.action].filter(Boolean).join(" "))}">CHECK CONTINUITY</button>`;
  } else {
    action = `<button type="button" class="approve-btn" onclick="runShotContinuityCheck('${attr(s.id)}')" ${currentRun?.status === "working" ? "disabled" : ""}>${currentRun?.status === "working" ? "CHECKING…" : currentRun ? "CHECK AGAIN" : "CHECK CONTINUITY"}</button>`;
    body = currentRun
      ? continuityResultMarkup(s.id, currentRun)
      : `<p class="continuity-requirement">Each frame is observed on its own against this shot's declared references. CineBraid compares the two readings — the model never sees both frames.</p>`;
  }

  return `<section class="shot-continuity" data-shot-continuity="${attr(s.id)}">
    <header>
      <div><span>CONTINUITY</span><b>${pair ? `${esc(continuityFrameWord(pair.a))} → ${esc(continuityFrameWord(pair.b))}` : "Compare two approved frames"}</b><small>Declared references, checked one frame at a time and compared here.</small></div>
      <div class="shot-continuity-actions">${chooser}${action}</div>
    </header>
    ${body}
    ${continuityFrameStatePanelMarkup(s, entityRows, pair)}
    ${continuityIntentPanelMarkup(s, entityRows)}
  </section>`;
}

if (typeof window !== "undefined") {
  window.guidedContinuityPanel = guidedContinuityPanel;
  window.continuityApprovedFrames = continuityApprovedFrames;
  window.continuityFramePairs = continuityFramePairs;
  window.continuityEntityRows = continuityEntityRows;
  window.frameStateSelection = frameStateSelection;
  window.continuityCapability = continuityCapability;
  window.setContinuityRun = setContinuityRun;
  window.continuityRun = continuityRun;
  window.continuityProjectKey = continuityProjectKey;
  window.resetContinuityWorkspaceState = resetContinuityWorkspaceState;
}
