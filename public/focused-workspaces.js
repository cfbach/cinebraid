/* CineBraid v6.6.0.2 — Focused Workspaces stabilization
 * Progressive enhancement over the existing route renderer. It intentionally
 * avoids changing persistent project data: selected task, pagination, and
 * inspector visibility are browser-workspace state only.
 */
(function () {
  const PAGE_SIZE = { candidates: 12, reports: 50, shots: 40 };
  const FOCUSED_DETAIL_VIEWS = new Set(["shot", "scene", "character", "location", "prop", "vehicle", "sound"]);
  let scheduled = false;
  let activeTaskContext = null;

  function safeText(value) { return String(value == null ? "" : value); }

  /* ===========================================================================
     THE PAGE'S SHARED RUNTIME — and the reason none of the code below ever ran.

     public/app.js declares project state as `let P` at the top level of a classic
     script, and ACTIVE_PROJECT_SLUG, AUTOMATION_RUNS, esc, shotById and sceneById
     the same way. A top-level `let`/`const` lives in the page's global LEXICAL
     scope, which is NOT the global object — so `window.P` was `undefined` in
     Chromium on every route, `enhance()` returned at its own `!window.P` guard
     before touching the DOM, and this module loaded, exported its API, and did
     nothing. Only the render harness ever appeared to exercise it, and only
     because a suite passed the entity in by hand.

     Every public/*.js shares that one global scope, so the bare name resolves the
     live binding app.js writes. These accessors READ it; they do not copy it.
     There is one project object, no snapshot, and nothing to keep in sync — a
     mutation made anywhere in the app is visible here on the next read.

     `window.<name>` is deliberately not consulted as a fallback. A second place to
     look is a second place to write, and the point of reading the authoritative
     binding is that there is only one truth to read.

     The `typeof` guard is the idiom public/bounded-rendering.js already uses for
     ACTIVE_PROJECT_SLUG. It is required rather than decorative: this file is also
     evaluated standalone by tests/focused-workspaces.js, where no app.js has run
     and a bare reference would throw. */
  function activeProject() { return typeof P === "undefined" ? null : P; }
  function activeProjectSlug() { return typeof ACTIVE_PROJECT_SLUG === "undefined" ? "" : safeText(ACTIVE_PROJECT_SLUG); }
  function activeAutomationRuns() { return typeof AUTOMATION_RUNS !== "undefined" && Array.isArray(AUTOMATION_RUNS) ? AUTOMATION_RUNS : []; }
  function findShot(id) { return typeof shotById === "function" ? shotById(id) : null; }
  function findScene(id) { return typeof sceneById === "function" ? sceneById(id) : null; }
  /* app.js's own `esc`, or a byte-identical local one. Every call site used to read
     `window.esc ? window.esc(x) : x`, and `window.esc` is undefined for the same
     reason `window.P` was — so the fallback branch was the only branch, and it
     interpolated raw text into innerHTML. Nobody saw it because nothing here
     rendered. Escaping is not optional now that it does. */
  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  function escapeText(value) {
    return typeof esc === "function" ? esc(value) : safeText(value).replace(/[&<>"]/g, (character) => ESCAPES[character]);
  }

  function routeParts() {
    const parts = String(location.hash || "#/production").split("/");
    return { view: parts[1] || "production", id: decodeURIComponent(parts[2] || "") };
  }
  function isFocusedDetailView(view) {
    return FOCUSED_DETAIL_VIEWS.has(String(view || ""));
  }
  function syncFocusedRouteMode(view) {
    if (!document.body) return;
    const normalized = String(view || "production");
    document.body.dataset.focusedRoute = normalized;
    if (isFocusedDetailView(normalized)) document.body.dataset.focusedWorkspace = "1";
    else delete document.body.dataset.focusedWorkspace;
  }
  function storageKey(kind, id) {
    const project = activeProjectSlug() || activeProject()?.meta?.id || "project";
    return `cinebraid-focused:${project}:${kind}:${id || "root"}`;
  }
  function readState(kind, id, fallback = "") {
    try { return localStorage.getItem(storageKey(kind, id)) || fallback; }
    catch { return fallback; }
  }
  function writeState(kind, id, value) {
    try { localStorage.setItem(storageKey(kind, id), safeText(value)); } catch {}
  }
  function statusForElement(element) {
    const explicit = String(element?.dataset?.taskStatus || element?.dataset?.status || "").toLowerCase();
    const known = {
      attention: { tone: "attention", label: "Needs attention" },
      blocked: { tone: "attention", label: "Needs attention" },
      failed: { tone: "attention", label: "Needs attention" },
      active: { tone: "active", label: "In progress" },
      running: { tone: "active", label: "In progress" },
      complete: { tone: "complete", label: "Complete" },
      approved: { tone: "complete", label: "Complete" },
      optional: { tone: "optional", label: "Optional" },
      pending: { tone: "pending", label: "Ready" },
      ready: { tone: "pending", label: "Ready" },
    };
    if (known[explicit]) return known[explicit];
    const text = safeText(element?.textContent).toLowerCase();
    if (/no approved|approved reference missing|missing required|failed|needs attention|blocked|\berror\b/.test(text)) return known.attention;
    if (/working|running|in progress|generating|reviewing|waiting for provider/.test(text)) return known.active;
    if (/optional|not started|no candidates|no input/.test(text)) return known.optional;
    if (/approved|completed|\bcomplete\b|final delivery locked|guide active/.test(text)) return known.complete;
    return known.pending;
  }
  function slugTaskId(value, fallback) {
    const clean = safeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return clean || fallback;
  }
  function taskIdForElement(element, index) {
    if (element?.dataset?.taskId) return element.dataset.taskId;
    const panel = element?.dataset?.guidedPanel;
    let id = panel || "";
    if (!id && element?.classList?.contains("automation-card")) id = "automation";
    if (!id && element?.classList?.contains("guided-frame-workflow")) id = "frames";
    if (!id && element?.classList?.contains("asset-creation-card")) id = "primary";
    if (!id && element?.classList?.contains("entity-approved-section")) id = "approved";
    if (!id && element?.classList?.contains("entity-candidate-section")) id = "candidates";
    if (!id && element?.classList?.contains("entity-coverage-section")) id = "coverage";
    if (!id && element?.classList?.contains("entity-expression-section")) id = "expressions";
    if (!id && element?.classList?.contains("continuity-states")) id = "states";
    if (!id && element?.classList?.contains("scene-review-panel")) id = "continuity-review";
    if (!id && element?.classList?.contains("scene-automation-panel")) id = "scene-automation";
    if (!id && element?.classList?.contains("audio-panel")) id = "audio";
    if (!id) id = slugTaskId(taskLabel(element, index)[0], `task-${index + 1}`);
    element.dataset.taskId = id;
    return id;
  }
  function taskDescriptors(tasks) {
    return tasks.map((element, index) => ({ element, id: taskIdForElement(element, index), status: statusForElement(element), index }));
  }
  function taskLabel(element, index) {
    const panel = element?.dataset?.guidedPanel;
    const known = {
      inputs: ["References", "Cast, assets, source media"],
      blocking: ["Blocking", "Camera, scale and staging"],
      composer: ["Reference review", "Appearance authorities"],
      motion: ["Motion & audio", "Movement, dialogue and sound"],
      finish: ["Finish & Delivery", "Optional finishing, then the final decision"],
    };
    if (known[panel]) return known[panel];
    if (element?.classList?.contains("automation-card")) return ["Automation", "Durable still generation"];
    if (element?.classList?.contains("guided-frame-workflow")) return ["Frames", "Create and approve stills"];
    const summary = element?.querySelector?.(":scope > summary");
    const title = summary?.querySelector?.("h1,h2,h3,b")?.textContent || summary?.textContent || `Task ${index + 1}`;
    return [safeText(title).trim().replace(/\s+/g, " ").slice(0, 52), ""];
  }
  function nextTaskIndex(tasks) {
    const descriptors = taskDescriptors(tasks);
    let row = descriptors.find((task) => task.status.tone === "attention");
    if (row) return row.index;
    row = descriptors.find((task) => task.status.tone === "active");
    if (row) return row.index;
    row = descriptors.find((task) => task.status.tone !== "complete" && task.status.tone !== "optional");
    if (row) return row.index;
    row = descriptors.find((task) => task.status.tone !== "complete");
    return row ? row.index : Math.max(0, tasks.length - 1);
  }
  function resolveTaskSelection(tasks, stored, fallbackIndex) {
    const descriptors = taskDescriptors(tasks);
    if (/^\d+$/.test(String(stored || ""))) {
      const legacy = descriptors[Math.max(0, Math.min(descriptors.length - 1, Number(stored)))];
      return legacy?.id || descriptors[fallbackIndex]?.id;
    }
    const match = descriptors.find((row) => row.id === stored);
    const fallback = descriptors[fallbackIndex] || descriptors[0];
    if (!match) return fallback?.id || "";
    if (match.status.tone === "complete") {
      const unresolved = descriptors.find((row) => ["attention", "active", "pending"].includes(row.status.tone));
      if (unresolved && unresolved.id !== match.id) return unresolved.id;
    }
    return match.id;
  }
  function buildTaskbar(tasks, kind, id, activeTaskId, onSelect) {
    const nav = document.createElement("nav");
    nav.className = "focused-taskbar";
    nav.setAttribute("aria-label", "Workspace tasks");
    tasks.forEach((task, index) => {
      const [label, detail] = taskLabel(task, index);
      const status = statusForElement(task);
      const taskId = taskIdForElement(task, index);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.taskId = taskId;
      button.className = `focused-task-button tone-${status.tone}${taskId === activeTaskId ? " selected" : ""}`;
      button.innerHTML = `<i></i><span><b>${escapeText(label)}</b>${detail ? `<small>${escapeText(detail)}</small>` : ""}</span><em>${status.label}</em>`;
      button.addEventListener("click", () => {
        writeState(kind, id, taskId);
        onSelect(taskId);
      });
      nav.appendChild(button);
    });
    return nav;
  }
  function applyTaskSelection(tasks, taskId, bar) {
    const descriptors = taskDescriptors(tasks);
    const selected = descriptors.find((row) => row.id === taskId) || descriptors[0];
    descriptors.forEach((row) => {
      const visible = row.id === selected?.id;
      row.element.classList.toggle("focused-task-hidden", !visible);
      row.element.hidden = !visible;
      if (visible && row.element.tagName === "DETAILS") row.element.open = true;
    });
    bar?.querySelectorAll("button[data-task-id]").forEach((button) => button.classList.toggle("selected", button.dataset.taskId === selected?.id));
    if (activeTaskContext) activeTaskContext.taskId = selected?.id || "";
  }
  function shotInspector(shot) {
    const aside = document.createElement("aside");
    aside.className = "focused-inspector";
    const refs = typeof window.shotCreationReferences === "function" ? window.shotCreationReferences(shot) : [];
    const readyRefs = refs.filter((row) => row.url).length;
    const frames = Array.isArray(shot?.keyframes) ? shot.keyframes : [];
    const approvedFrames = frames.filter((frame) => frame.winner).length;
    const run = activeAutomationRuns().find((row) => row.targetId === shot?.id && (typeof window.v670RunUnsettled === "function" ? window.v670RunUnsettled(row) : ["running", "awaiting-review", "failed"].includes(row.status)));
    aside.innerHTML = `<header><span>SHOT INSPECTOR</span><b>${escapeText(shot?.id || "Shot")}</b><p>${escapeText(shot?.title || "")}</p></header><div class="focused-inspector-facts"><article><span>References</span><b>${readyRefs}/${refs.length}</b></article><article><span>Frames</span><b>${approvedFrames}/${frames.length || 1}</b></article><article><span>Duration</span><b>${Number(shot?.sec || shot?.duration || 0) || "—"}s</b></article><article><span>Workflow</span><b>${escapeText(window.workflowState?.(shot)?.label || shot?.workflowStatus || "Draft")}</b></article></div><section><b>Current production note</b><p>${escapeText(shot?.desc || shot?.positioning || "No additional shot note.")}</p></section>${run ? `<section class="focused-inspector-alert${typeof window.v670RunTone === "function" ? ` state-${window.v670RunTone(run)}` : ""}"><b>${escapeText(run.label || "Automation")}</b><p>${escapeText(run.stage || run.summary || run.status)}</p><button type="button" data-open-activity="${run.id}">Open activity</button></section>` : `<section><b>Activity</b><p>No active operation for this shot.</p></section>`}`;
    aside.querySelector("[data-open-activity]")?.addEventListener("click", (event) => window.CineBraidCreatorSurfaces?.expandTerminal?.(event.currentTarget.dataset.openActivity));
    return aside;
  }
  function disclosureFallbackLabel(element) {
    if (element.classList.contains("asset-creation-card")) return ["Create primary reference", "Build or improve the identity authority"];
    if (element.classList.contains("entity-approved-section")) return ["Approved references", "Canonical state authorities"];
    if (element.classList.contains("entity-candidate-section")) return ["Other candidates", "Review, approve, or reject"];
    if (element.classList.contains("entity-coverage-section")) return ["Coverage board", "Angles and viewpoints"];
    if (element.classList.contains("entity-expression-section")) return ["Expression board", "Facial and performance coverage"];
    if (element.classList.contains("continuity-states")) return ["Continuity states", "Appearance and condition variants"];
    if (element.classList.contains("entity-rejected-candidates")) return ["Rejected candidates", "Retained on disk"];
    return ["Reference details", "Additional production information"];
  }
  function ensureDisclosureLabels(root) {
    root.querySelectorAll("details").forEach((element) => {
      let summary = element.querySelector(":scope > summary");
      if (!summary) {
        summary = document.createElement("summary");
        element.insertBefore(summary, element.firstChild);
      }
      const readable = safeText(summary.textContent).replace(/[⌄▾▸]/g, "").trim();
      if (readable) return;
      const [label, detail] = disclosureFallbackLabel(element);
      summary.classList.add("generated-disclosure-summary");
      summary.innerHTML = `<span><b>${escapeText(label)}</b><small>${escapeText(detail)}</small></span><em>Ready</em>`;
    });
  }
  function enhanceShot(root, id) {
    if (root.dataset.focusedShot === "1" && !root.querySelector(".focused-workspace-shell")) delete root.dataset.focusedShot;
    ensureDisclosureLabels(root);
    const shell = root.querySelector(".guided-shot-shell");
    const stack = shell?.querySelector(".guided-work-stack");
    if (!shell || !stack || shell.dataset.focused === "1") return;
    if (shell.dataset.bounded === "1") {
      shell.dataset.focused = "1";
      root.dataset.focusedShot = "1";
      const shot = findShot(id);
      if (shot && !shell.querySelector(":scope > .focused-inspector")) shell.appendChild(shotInspector(shot));
      activeTaskContext = { bounded: true, kind: "shot-task", id, taskId: shell.dataset.selectedTask || "" };
      return;
    }
    shell.dataset.focused = "1";
    root.dataset.focusedShot = "1";
    shell.classList.add("focused-workspace-shell");
    const shot = findShot(id);
    /* NO SHOT TASKBAR IS BUILT HERE, and that is the point of O1.

       This branch used to spread the work stack's rendered children, filter them by tag
       and CSS class, and turn whatever survived into the shot's stages — their identity
       from a class name, their order from the order they happened to render in, and
       their status from a regular expression run over the panel's visible text. That
       made the DOM the workflow model: inserting a presentational <section> into the
       stack added a stage, and reordering two panels renumbered the workflow.

       CineBraid's shot stages are declared in public/shared-stage-model.js and
       rendered by the bounded workspace above, which states its selection in
       data-selected-task. A shot shell without data-bounded means that workspace did
       not render; the honest response is to leave the panels alone rather than invent
       five stages that agree with nothing. The inspector is still attached — it reads
       the shot record, not the DOM, so it was never part of the problem.

       The helpers this branch used are still live for the scene and legacy entity
       routes, which answer a different question and are deliberately not migrated. */
    /* Cleared rather than left alone: selectFocusedTask() acts on whatever context was
       set last, and a shot route that establishes none must not inherit the previous
       route's. */
    activeTaskContext = null;
    if (shot) shell.appendChild(shotInspector(shot));
  }
  function entityListName(view) {
    return ({ character: "characters", location: "locations", prop: "props", vehicle: "vehicles", sound: "audio" })[view] || "";
  }
  function buildEntityNavigator(list, id) {
    const aside = document.createElement("aside");
    aside.className = "focused-subnav";
    const singular = ({ characters: "Characters", locations: "Locations", props: "Props", vehicles: "Vehicles", audio: "Audio" })[list] || "References";
    const rows = Array.isArray(activeProject()?.[list]) ? activeProject()[list] : [];
    const pageSize = window.BOUNDED_PAGE_SIZES?.references || 40;
    let pageInfo = window.boundedPage ? window.boundedPage(rows, "references", `navigator:${list}`, pageSize) : { rows, page: 0, pages: 1, total: rows.length, start: 0, end: rows.length };
    if (id && !pageInfo.rows.some((row) => row.id === id)) {
      const selectedIndex = rows.findIndex((row) => row.id === id);
      if (selectedIndex >= 0 && window.boundedWriteState) {
        window.boundedWriteState("page:references", `navigator:${list}`, Math.floor(selectedIndex / pageSize));
        pageInfo = window.boundedPage(rows, "references", `navigator:${list}`, pageSize);
      }
    }
    aside.innerHTML = `<header><span>REFERENCE LIBRARY</span><b>${singular}</b><input type="search" placeholder="Filter visible ${singular.toLowerCase()}" aria-label="Filter reference list"></header><div class="focused-subnav-list">${pageInfo.rows.map((row) => `<a href="#/${({characters:"character",locations:"location",props:"prop",vehicles:"vehicle",audio:"sound"})[list]}/${encodeURIComponent(row.id)}" class="${row.id === id ? "selected" : ""}" data-filter="${safeText(`${row.id} ${row.name || ""}`).toLowerCase().replace(/"/g, "&quot;")}"><i class="wf-${safeText(row.workflowStatus || row.status || "draft").toLowerCase().replace(/[^a-z0-9]+/g, "-")}"></i><span><b>${escapeText(row.name || row.id)}</b><small>${escapeText(row.id)}</small></span></a>`).join("")}</div>${window.boundedPagerMarkup ? window.boundedPagerMarkup("references",`navigator:${list}`,pageInfo,"reference navigator") : ""}`;
    const input = aside.querySelector("input");
    input?.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      aside.querySelectorAll("[data-filter]").forEach((row) => row.hidden = !!query && !row.dataset.filter.includes(query));
    });
    return aside;
  }

  /* THE FRACTION THE INSPECTOR PRINTS, and the line P4-SEM-A exists for.

     This used to be `coverage.filter((slot) => slot.required !== false)` — the
     legacy boolean alone, with the requirement enum never consulted. A slot
     declared "not required" without a `required: false` twin was counted here and
     excluded by the coverage board, so the same project showed "1 of 3" on one
     screen and "1 of 2" on the other. The derivation is now the shared one, which
     is the same function the board calls, so the two cannot differ. */
  function inspectorCoverage(entity) {
    const slots = Array.isArray(entity?.coverageSlots) ? entity.coverageSlots : [];
    const summary = window.summariseCoverage ? window.summariseCoverage(slots) : { required: 0, approvedRequired: 0 };
    return { required: summary.required, approved: summary.approvedRequired };
  }
  function entityInspector(entity, list) {
    const aside = document.createElement("aside");
    aside.className = "focused-inspector";
    const { required, approved } = inspectorCoverage(entity);
    const candidates = Array.isArray(entity?.candidateFiles) ? entity.candidateFiles.filter((row) => row.decision !== "rejected" && !decisionIsSlotSelection(row.decision)).length : 0;
    aside.innerHTML = `<header><span>Reference details</span><b>${escapeText(entity?.id || "Reference")}</b><p>${escapeText(entity?.name || "")}</p></header><div class="focused-inspector-facts"><article><span>Design status</span><b>${escapeText(window.entityWorkflowState?.(entity)?.label || entity?.workflowStatus || entity?.status || "Draft")}</b></article><article><span>Coverage</span><b>${approved}/${required}</b></article><article><span>Candidates</span><b>${candidates}</b></article><article><span>States</span><b>${Array.isArray(entity?.continuityStates) ? entity.continuityStates.length : 0}</b></article></div><section><b>Identity / design authority</b><p>${escapeText(entity?.driftNotes || entity?.block || entity?.notes || "No authority note recorded.")}</p></section><section><b>Working on this reference</b><p>One stage at a time. Use the tabs above to move between the primary reference, what this production needs, and the details and history.</p></section>`;
    return aside;
  }
  function enhanceEntity(root, view, id) {
    if (root.dataset.focusedEntity === "1" && !root.querySelector(".focused-entity-shell")) delete root.dataset.focusedEntity;
    if (root.dataset.focusedEntity === "1") return;
    ensureDisclosureLabels(root);
    const list = entityListName(view);
    const entity = activeProject()?.[list]?.find((row) => row.id === id);
    if (!list || !entity) return;
    root.dataset.focusedEntity = "1";
    const original = [...root.childNodes];
    const shell = document.createElement("div"); shell.className = "focused-entity-shell";
    const center = document.createElement("section"); center.className = "focused-entity-main";
    original.forEach((node) => center.appendChild(node));
    shell.appendChild(buildEntityNavigator(list, id));
    shell.appendChild(center);
    shell.appendChild(entityInspector(entity, list));
    root.appendChild(shell);
    const boundedPage = center.querySelector(".bounded-entity-page");
    if (boundedPage) {
      activeTaskContext = { bounded: true, kind: "entity-task", id: `${list}:${id}`, taskId: boundedPage.dataset.selectedTask || "" };
      return;
    }
    const tasks = [...center.querySelectorAll(":scope > details.compact-entity-section, :scope > details.creation-card, :scope > details.continuity-states")];
    if (!tasks.length) return;
    const fallback = nextTaskIndex(tasks);
    const contextId = `${list}:${id}`;
    const active = resolveTaskSelection(tasks, readState("entity-task", contextId, ""), fallback);
    writeState("entity-task", contextId, active);
    const bar = buildTaskbar(tasks, "entity-task", contextId, active, (taskId) => applyTaskSelection(tasks, taskId, bar));
    center.insertBefore(bar, tasks[0]);
    activeTaskContext = { kind: "entity-task", id: contextId, tasks, bar, taskId: active };
    applyTaskSelection(tasks, active, bar);
  }
  function paginate(container, itemSelector, size, key) {
    if (!container || container.dataset.focusedPaginated === "1") return;
    const items = [...container.querySelectorAll(`:scope > ${itemSelector}`)];
    if (items.length <= size) return;
    container.dataset.focusedPaginated = "1";
    let page = Math.max(0, Number(readState("page", key, 0)) || 0);
    const pages = Math.ceil(items.length / size);
    const controls = document.createElement("nav"); controls.className = "focused-pagination";
    const render = () => {
      page = Math.max(0, Math.min(pages - 1, page));
      items.forEach((item, index) => item.hidden = index < page * size || index >= (page + 1) * size);
      controls.innerHTML = `<button type="button" ${page === 0 ? "disabled" : ""}>Previous</button><span>${page + 1} / ${pages} · ${items.length} items</span><button type="button" ${page >= pages - 1 ? "disabled" : ""}>Next</button>`;
      const buttons = controls.querySelectorAll("button");
      buttons[0].onclick = () => { page--; writeState("page", key, page); render(); container.scrollIntoView({ block: "start" }); };
      buttons[1].onclick = () => { page++; writeState("page", key, page); render(); container.scrollIntoView({ block: "start" }); };
    };
    container.after(controls); render();
  }
  function focusSlotBoards(root, routeId) {
    root.querySelectorAll(".coverage-slot-grid,.expression-slot-grid").forEach((grid, boardIndex) => {
      if (grid.dataset.focusedSlots === "1") return;
      const cards = [...grid.children].filter((item) => item.matches("article"));
      if (cards.length < 2) return;
      grid.dataset.focusedSlots = "1";
      let selected = Math.max(0, Math.min(cards.length - 1, Number(readState("slot", `${routeId}:${boardIndex}`, 0)) || 0));
      const rail = document.createElement("nav"); rail.className = "focused-slot-rail";
      const render = () => {
        cards.forEach((card, index) => {
          const visible = index === selected;
          card.hidden = !visible;
          card.classList.toggle("focused-slot-selected", visible);
          card.setAttribute("aria-hidden", visible ? "false" : "true");
        });
        rail.querySelectorAll("button").forEach((button, index) => {
          button.classList.toggle("selected", index === selected);
          button.setAttribute("aria-pressed", index === selected ? "true" : "false");
        });
      };
      cards.forEach((card, index) => {
        const button = document.createElement("button"); button.type = "button";
        const name = card.querySelector("header b")?.textContent || `Slot ${index + 1}`;
        const state = statusForElement(card);
        button.className = `tone-${state.tone}`;
        button.innerHTML = `<i></i><span>${escapeText(name)}</span><small>${state.label}</small>`;
        button.onclick = () => { selected = index; writeState("slot", `${routeId}:${boardIndex}`, selected); render(); };
        rail.appendChild(button);
      });
      grid.before(rail); render();
    });
  }
  function enhanceScene(root, id) {
    if (root.dataset.focusedScene === "1" && !root.querySelector(".focused-scene-page")) delete root.dataset.focusedScene;
    if (root.dataset.focusedScene === "1") return;
    ensureDisclosureLabels(root);
    const scene = findScene(id);
    if (!scene) return;
    root.dataset.focusedScene = "1";
    root.classList.add("focused-scene-page");
    const taskCandidates = [...root.children].filter((element) => element.matches(".audio-panel,.scene-review-panel,.scene-automation-panel,details.fold,.shot-row"));
    if (!taskCandidates.length) return;
    const fallback = nextTaskIndex(taskCandidates);
    const active = resolveTaskSelection(taskCandidates, readState("scene-task", id, ""), fallback);
    writeState("scene-task", id, active);
    const bar = buildTaskbar(taskCandidates, "scene-task", id, active, (taskId) => applyTaskSelection(taskCandidates, taskId, bar));
    const insertion = root.querySelector(".two-col") || taskCandidates[0];
    insertion?.parentNode?.insertBefore(bar, insertion?.nextSibling || insertion);
    activeTaskContext = { kind: "scene-task", id, tasks: taskCandidates, bar, taskId: active };
    applyTaskSelection(taskCandidates, active, bar);
  }
  function enhanceCollections(root, view, id) {
    // v6.6.1 source renderers paginate before HTML construction. Keep this only as a legacy fallback.
    root.querySelectorAll(".entity-candidate-grid:not(.bounded-source-section .entity-candidate-grid)").forEach((container, index) => {
      if (!container.closest(".bounded-source-section")) paginate(container, ".entity-candidate-card", PAGE_SIZE.candidates, `${view}:${id}:candidates:${index}`);
    });
    root.querySelectorAll(".reports-run-list").forEach((container) => { if (!container.closest(".bounded-source-section")) paginate(container, ".reports-run-row", PAGE_SIZE.reports, "reports"); });
    root.querySelectorAll(".shot-row").forEach((container, index) => { if (!container.classList.contains("bounded-shot-page")) paginate(container, "a,article", PAGE_SIZE.shots, `${view}:${id}:shots:${index}`); });
    if (!root.querySelector(".bounded-single-slot")) focusSlotBoards(root, `${view}:${id}`);
  }

  function explainDisabledActions(root) {
    root.querySelectorAll('button[disabled][data-tip],button[disabled][title]').forEach((button) => {
      if (button.dataset.blockerExplained === "1") return;
      const reason = button.dataset.tip || button.getAttribute("title") || "This action is not ready yet.";
      if (!reason || button.closest('.policy-options')) return;
      button.dataset.blockerExplained = "1";
      const note = document.createElement("small");
      note.className = "disabled-action-reason";
      note.innerHTML = `<b>Not ready:</b> ${escapeText(reason)}${/settings/i.test(reason) ? ' <a href="#/settings">Open Settings →</a>' : ''}`;
      button.insertAdjacentElement("afterend", note);
    });
  }

  function enhance() {
    scheduled = false;
    const { view, id } = routeParts();
    syncFocusedRouteMode(view);
    const root = document.getElementById("main");
    if (!root || !activeProject()) return;
    if (view === "shot") enhanceShot(root, id);
    else if (["character", "location", "prop", "vehicle", "sound"].includes(view)) enhanceEntity(root, view, id);
    else if (view === "scene") enhanceScene(root, id);
    enhanceCollections(root, view, id);
    explainDisabledActions(root);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(enhance));
  }
  window.selectFocusedTask = (taskId) => {
    if (!activeTaskContext) return false;
    if (activeTaskContext.bounded) {
      window.selectBoundedTask?.(activeTaskContext.kind, activeTaskContext.id, taskId);
      return true;
    }
    const match = taskDescriptors(activeTaskContext.tasks).find((row) => row.id === taskId);
    if (!match) return false;
    writeState(activeTaskContext.kind, activeTaskContext.id, taskId);
    applyTaskSelection(activeTaskContext.tasks, taskId, activeTaskContext.bar);
    match.element.scrollIntoView?.({ behavior: "smooth", block: "start" });
    return true;
  };
  /* inspectorCoverage is exported so a suite can drive the inspector's OWN
     arithmetic rather than a copy of it. Proving two surfaces agree is worth
     nothing if the test reimplements one of them. */
  /* activeProject is exported for the same reason: a suite must be able to ask the
     module which object it is reading and compare it by IDENTITY to the app's own
     `P`. "Same numbers" is not the same claim as "same object", and only the second
     one rules out a snapshot that has not drifted yet. */
  window.__CINEBRAID_FOCUSED = { statusForElement, nextTaskIndex, routeParts, isFocusedDetailView, syncFocusedRouteMode, ensureDisclosureLabels, taskIdForElement, resolveTaskSelection, inspectorCoverage, activeProject };
  window.enhanceFocusedWorkspace = enhance;
  window.addEventListener("hashchange", () => { syncFocusedRouteMode(routeParts().view); schedule(); });
  window.addEventListener("load", () => { syncFocusedRouteMode(routeParts().view); schedule(); });
  window.addEventListener("cinebraid:route-rendered", schedule);
  window.addEventListener("cinebraid:workspace-updated", schedule);
  const start = () => {
    syncFocusedRouteMode(routeParts().view);
    schedule();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
