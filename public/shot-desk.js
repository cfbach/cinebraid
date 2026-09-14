/* A+ Shot Desk is a presentation of the returned-media projection. It owns no
   production selection, receipt, provider request, or approval persistence. */
(function () {
  "use strict";
  const sessions = new Map();
  let active = null;
  let focusNext = "";
  let pendingApproval = null;
  const frameLabel = (m) => `Frame ${m.item.owner.frameLabel || m.item.owner.frameId}`;
  const modalOpen = () => { const modal = document.getElementById("modal"); return modal && !modal.classList.contains("hidden"); };
  const e = (value) => esc(String(value ?? ""));
  const a = (value) => attr(String(value ?? ""));
  const button = (id, label, extra = "") => `<button id="${id}" class="sd-button" data-sd-action="${id}" ${extra}>${label}</button>`;
  const current = () => active && resolve(active.shotId, active.key);
  function resolve(shotId, key) {
    const model = shotDeskPresentation(returnedReviewProjectionForBrowser(), shotId, key);
    const shot = shotById(shotId);
    if (model.state !== "ready" || !shot) return { ...model, shot };
    const row = candidateRecord(shot, model.item.candidate.name, false);
    const guide = candidateReviewGuide(shot, candidateSourceBuild(row));
    const frame = (shot.keyframes || []).find((f) => f.id === model.item.owner.frameId);
    return { ...model, shot, row, frame, guide: guide?.url ? guide : null };
  }
  function stateFor(m) {
    const id = `${activeProjectSlug()}:${m.shot.id}:${m.item.owner.frameId}`;
    if (!sessions.has(id)) sessions.set(id, { inspection: matchMedia("(min-width: 1360px)").matches, panel: "intent", comparison: "", peer: "" });
    return sessions.get(id);
  }
  function imageLabel(m, key) {
    const index = m.candidates.findIndex((row) => row.key === key);
    return index < 0 ? "Image" : `Image ${index + 1}`;
  }
  function peers(m) { return m.candidates.filter((row) => row.key !== m.item.key); }
  function comparison(m, state) {
    if (state.comparison === "guide" && m.guide) return { url: m.guide.url, label: m.guide.source === "source-build" ? "Guide from original request" : "Current blocking guide" };
    if (state.comparison === "approved" && m.approvedComparison) return { url: m.approvedComparison.url, label: "Current human-approved image" };
    if (state.comparison === "candidates") {
      const rows = peers(m);
      const peer = rows.find((r) => r.key === state.peer) || rows[0];
      if (peer) { state.peer = peer.key; return { url: peer.candidate.url, label: `${imageLabel(m, peer.key)} · comparison only` }; }
    }
    state.comparison = "";
    return null;
  }
  function envelope(value) {
    if (value?.state === "known") return typeof value.value === "object" ? JSON.stringify(value.value) : value.value;
    return value?.state === "unavailable" ? "Unavailable" : "Not recorded";
  }
  function inspection(m, panel) {
    if (panel === "provenance") {
      const record = window.CineBraidMediaInspector?.recordFor(m.item.key);
      const p = record?.provenance;
      return `<p>This image keeps its production identity and recorded source through approval.</p><dl><dt>Provider</dt><dd>${e(envelope(p?.provider))}</dd><dt>Model</dt><dd>${e(envelope(p?.model))}</dd><dt>Human decision</dt><dd>${e(m.decisionLabel)}</dd></dl><details><summary>Original prompt</summary><pre>${e(envelope(p?.prompt))}</pre></details><details><summary>File &amp; durable identity</summary><dl><dt>File</dt><dd>${e(m.item.candidate.name)}</dd><dt>Media ID</dt><dd>${e(record?.identity?.ledger?.state === "known" ? record.identity.ledger.value : m.item.candidate.assetId || "Legacy file; no durable ID recorded")}</dd></dl></details>${button("sd-full-record", "Open full media record")}`;
    }
    const frame = m.frame || {};
    const brief = m.shot.creation?.frameWorkflows?.[frame.id]?.action || frame.description || m.shot.desc || "";
    const ai = m.row?.structuredReview?.ai;
    return `<h3>${e(frame.title || frame.label || m.item.owner.frameLabel || "Shot image")}</h3>${brief ? `<p>${e(brief)}</p>` : "<p>No separate image brief has been recorded for this frame.</p>"}${m.shot.howItFeels ? `<h4>Feeling</h4><p>${e(m.shot.howItFeels)}</p>` : ""}<h4>Your decision</h4><p>${m.canApprove ? `Approve this image for ${e(frameLabel(m))}.` : e(m.decisionLabel) + ` for ${e(frameLabel(m))}.`} Looking, selecting and comparing leave approval unchanged.</p>${ai ? `<details><summary>Recorded Braidy assessment</summary><p>Advisory only. Your approval remains separate.</p><pre>${e(ai.summary || ai.notes || "An assessment is recorded. Open the review notes for its detailed findings.")}</pre></details>` : ""}${button("sd-review-notes", "Review notes &amp; correction…")}`;
  }
  function media(url, label, primary) {
    return `<figure class="sd-media"><img ${primary ? 'id="sd-primary-image"' : 'id="sd-comparison-image"'} src="${a(url)}" alt="${a(label)}"><figcaption>${e(label)}</figcaption><div class="sd-media-error" role="status" hidden><span>Image could not be loaded. Your review target has been kept.</span><button class="sd-button" data-sd-retry>Retry image</button></div></figure>`;
  }
  function context(shot, m) {
    const scene = sceneById(shot.scene);
    return `<header class="sd-context"><nav class="sd-crumb" aria-label="Production context"><a href="#/production">Production</a><span aria-hidden="true">/</span>${scene ? `<a href="#/scene/${a(encodeURIComponent(scene.id))}">${e(scene.title || scene.id)}</a><span aria-hidden="true">/</span>` : ""}<span>${e(shot.id)}</span></nav><div class="sd-heading"><h1 id="sd-heading" tabindex="-1">${e(shot.title || shot.id)}</h1>${m?.item ? `<span class="sd-frame">${e(frameLabel(m))}</span>` : ""}<a class="sd-back" href="#/shot/${a(encodeURIComponent(shot.id))}">Shot preparation</a></div></header>`;
  }
  function view(shot, key) {
    document.body.classList.add("shot-desk-active");
    active = { shotId: shot.id, key };
    const m = resolve(shot.id, key);
    if (m.state !== "ready") {
      const words = m.state === "unavailable" ? ["This image is unavailable", "CineBraid cannot currently resolve this exact image. The review has not moved to another candidate."] : ["This review target has changed", "The linked image no longer belongs to this shot and frame, or its record is missing. No other image has been selected in its place."];
      return `<section class="shot-desk" data-shot-desk>${context(shot, m)}<div class="sd-empty"><h2>${words[0]}</h2><p role="status">${words[1]}</p>${button("sd-refresh", "Try again")}<a class="sd-back" href="#/shot/${a(encodeURIComponent(shot.id))}">Return to shot</a></div></section>`;
    }
    const state = stateFor(m), target = comparison(m, state);
    const selected = imageLabel(m, key);
    const open = state.inspection && matchMedia("(min-width: 1360px)").matches;
    const targetName = `${shot.id} · ${frameLabel(m)}`;
    return `<section class="shot-desk" data-shot-desk>${context(shot, m)}<div class="sd-body ${open ? "sd-inspection-open" : ""}"><section class="sd-viewer" aria-label="Shot image review"><div class="sd-toolbar"><span class="sd-selection-label">${selected} of ${m.candidates.length}</span><div class="sd-tools">${peers(m).length ? button("sd-compare-candidates", "Compare candidates", `aria-pressed="${state.comparison === "candidates"}"`) : ""}${m.guide ? button("sd-compare-guide", "Compare with guide", `aria-pressed="${state.comparison === "guide"}"`) : ""}${m.approvedComparison ? button("sd-compare-approved", "Compare with current approved image", `aria-pressed="${state.comparison === "approved"}"`) : ""}${button("sd-provenance", "Provenance", `aria-expanded="${open && state.panel === "provenance"}"`)}${button("sd-inspect", "Shot intention", `aria-expanded="${open && state.panel === "intent"}"`)}</div></div>${target ? `<div class="sd-compare-controls">${state.comparison === "candidates" && peers(m).length > 1 ? `<label>Compare against <select id="sd-compare-peer">${peers(m).map((r) => `<option value="${a(r.key)}" ${r.key === state.peer ? "selected" : ""}>${e(imageLabel(m, r.key))}</option>`).join("")}</select></label>` : `<span>${e(target.label)}</span>`}${button("sd-close-comparison", "Back to single image")}</div>` : ""}<div class="sd-canvas ${target ? "is-comparing" : ""}">${media(m.item.candidate.url, "Selected for review", true)}${target ? media(target.url, target.label, false) : ""}</div><div class="sd-candidates" aria-label="Choose an image to review">${m.candidates.map((r, i) => `<button id="sd-candidate-${i}" class="sd-candidate" data-sd-key="${a(r.key)}" aria-pressed="${r.key === key}" aria-label="Review image ${i + 1}${r.key === key ? ", selected" : ""}"><img src="${a(r.candidate.url)}" alt=""><span>Image ${i + 1}</span></button>`).join("")}</div></section><aside class="sd-inspection" aria-label="${state.panel === "provenance" ? "Provenance" : "Shot intention"}"><header><h2>${state.panel === "provenance" ? "Provenance" : "Shot intention"}</h2>${button("sd-close-inspection", "Close", 'aria-label="Close inspection rail"')}</header><div class="sd-inspection-content">${open ? inspection(m, state.panel) : ""}</div></aside></div><footer class="sd-decision"><div><strong id="sd-decision-state" class="sd-decision-state" role="status" tabindex="-1">${e(m.decisionLabel)}</strong><small>${m.canApprove ? `Your approval will set the image for ${e(targetName)}.` : `Decision applies to ${e(targetName)}.`}</small></div><div class="sd-decision-actions">${m.canReject ? '<button id="sd-reject" data-sd-action="sd-reject">Reject image</button>' : ""}${m.canApprove ? '<button id="sd-approve" class="sd-primary" data-sd-action="sd-approve" disabled>Approve image…</button>' : ""}</div></footer></section>`;
  }
  function repaint(focus) { focusNext = focus || ""; route(); }
  function choose(key, index) {
    const m = current();
    if (m?.state !== "ready" || !m.candidates.some((r) => r.key === key)) return;
    focusNext = `sd-candidate-${index}`;
    const href = shotReviewHref(m.shot.id, key);
    if (location.hash === href) mount(); else location.hash = href;
  }
  function showInspection(panel) {
    const m = current(); if (m?.state !== "ready") return;
    const state = stateFor(m); state.panel = panel;
    if (!matchMedia("(min-width: 1360px)").matches) {
      openModal(`<div class="sd-inspection-dialog"><header><h3>${panel === "provenance" ? "Provenance" : "Shot intention"}</h3><button class="cancel" onclick="closeModal()">Close</button></header><div class="sd-inspection-content">${inspection(m, panel)}</div></div>`);
    } else { state.inspection = true; repaint(panel === "provenance" ? "sd-provenance" : "sd-inspect"); }
  }
  function approve() {
    const m = current(), img = document.getElementById("sd-primary-image");
    if (m?.state !== "ready" || !m.canApprove || !img?.complete || !img.naturalWidth) return toast("This image is not available for approval.");
    // Retain the shipped confirmation, hidden target, trusted click and authority writer.
    pendingApproval = { projectSlug: activeProjectSlug(), shotId: m.shot.id, frameId: m.item.owner.frameId, key: m.item.key, name: m.item.candidate.name };
    approveGuidedFrame(m.shot.id, m.item.owner.frameId, m.item.candidate.name);
    const box = document.querySelector("#modal .modal-box");
    if (!box || !document.getElementById("approve-target")) return;
    box.classList.add("sd-confirmation");
    box.querySelector("h3").textContent = "Approve this image?";
    const sub = box.querySelector(".modal-sub");
    if (sub) sub.textContent = `${m.shot.id} · ${frameLabel(m)}`;
    const preview = box.querySelector(".approval-preview");
    if (preview) {
      const opening = (m.shot.keyframes || [])[0]?.id === m.item.owner.frameId;
      preview.className = "sd-confirm-preview";
      preview.innerHTML = `<img src="${a(m.item.candidate.url)}" alt="Selected candidate for ${a(m.shot.id)}"><div><b>${e(m.shot.title || m.shot.id)}</b><span>${e(frameLabel(m))}${m.frame?.title ? ` · ${e(m.frame.title)}` : ""}</span></div>`;
      preview.insertAdjacentHTML("afterend", `<div class="sd-confirm-effects"><p>This becomes the human-approved image for this frame${opening ? " and the current shot still" : ""}.</p>${m.approvedComparison ? "<p>It replaces the current approved image for this frame. Motion that depends on the replaced image may need review again.</p>" : ""}<p>Other frames and project references are not approved by this decision.</p></div>`);
    }
    const confirm = box.querySelector('[onclick="confirmApproveTake()"]');
    if (confirm) confirm.textContent = "Approve image";
    // The native modal helper encounters a hidden target input first.
    // Focus the visible safe action without changing its trap or approval handler.
    box.querySelector(".cancel")?.focus({ preventScroll: true });
    focusNext = "sd-decision-state";
  }
  function action(id) {
    if (id === "sd-refresh") return repaint("sd-heading");
    const m = current(); if (m?.state !== "ready") return;
    const state = stateFor(m);
    if (id === "sd-approve") return approve();
    if (id === "sd-reject") { if (m.canReject) { focusNext = "sd-decision-state"; rejectReturnedResult(m.shot.id, m.item.candidate.name); } return; }
    if (id === "sd-full-record") return window.inspectMedia?.(m.item.key);
    if (id === "sd-review-notes") return openCandidateReview(m.shot.id, m.item.owner.frameId, m.item.candidate.name);
    if (id === "sd-provenance" || id === "sd-inspect") return showInspection(id === "sd-provenance" ? "provenance" : "intent");
    if (id === "sd-close-inspection") { state.inspection = false; return repaint("sd-inspect"); }
    const modes = { "sd-compare-candidates": "candidates", "sd-compare-guide": "guide", "sd-compare-approved": "approved", "sd-close-comparison": "" };
    if (Object.hasOwn(modes, id)) {
      const opener = { candidates: "sd-compare-candidates", guide: "sd-compare-guide", approved: "sd-compare-approved" }[state.comparison] || "sd-inspect";
      state.comparison = modes[id]; return repaint(id === "sd-close-comparison" ? opener : id);
    }
  }
  function mount() {
    const root = document.querySelector("[data-shot-desk]");
    document.body.classList.toggle("shot-desk-active", !!root);
    if (!root) { active = null; focusNext = ""; return; }
    root.querySelectorAll(".sd-media > img").forEach((img) => {
      const update = () => {
        const good = img.complete && img.naturalWidth > 0;
        const failed = img.complete && !img.naturalWidth;
        img.parentElement.querySelector(".sd-media-error").hidden = !failed;
        if (img.id === "sd-primary-image") {
          const approveButton = root.querySelector("#sd-approve");
          if (approveButton) approveButton.disabled = !good;
        }
      };
      img.onload = update; img.onerror = update; update();
    });
    if (focusNext && !modalOpen()) { const el = document.getElementById(focusNext); focusNext = ""; el?.focus({ preventScroll: true }); }
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-sd-action], [data-sd-key], [data-sd-retry]");
    if (!target || !active) return;
    if (target.hasAttribute("data-sd-key")) return choose(target.dataset.sdKey, [...target.parentElement.children].indexOf(target));
    if (target.hasAttribute("data-sd-retry")) { const img = target.closest(".sd-media").querySelector("img"); const src = img.src; img.removeAttribute("src"); img.src = src; return; }
    action(target.dataset.sdAction);
  });
  document.addEventListener("change", (event) => {
    if (event.target.id !== "sd-compare-peer") return;
    const m = current(); if (m?.state !== "ready") return;
    stateFor(m).peer = event.target.value; repaint("sd-compare-peer");
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target.closest(".sd-candidate");
    if (!target || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...target.parentElement.children], index = buttons.indexOf(target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); choose(buttons[next].dataset.sdKey, next);
  });
  let resizePending = false;
  matchMedia("(min-width: 1360px)").addEventListener("change", () => {
    if (!active) return;
    if (modalOpen()) { resizePending = true; return; }
    repaint("sd-heading");
  });
  // Keep the modal's original return-focus node mounted until it has closed.
  const modal = document.getElementById("modal");
  if (modal) new MutationObserver(() => {
    if (resizePending && !modalOpen()) {
      resizePending = false;
      if (active) setTimeout(() => {
        if (active && !modalOpen()) repaint(document.activeElement?.id || "sd-heading");
      }, 0);
    }
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  // Follow only the exact identity reported by the existing approval/rename path.
  // An old path must never fall through to a winner or the next available image.
  window.addEventListener("cinebraid:take-approved", (event) => {
    const d = event.detail, pending = pendingApproval;
    pendingApproval = null;
    if (!d || !pending || !active || active.key !== pending.key || active.shotId !== pending.shotId || activeProjectSlug() !== pending.projectSlug || d.projectSlug !== pending.projectSlug || d.shotId !== pending.shotId || d.previousName !== pending.name || d.frameId !== pending.frameId) return;
    const items = returnedReviewProjectionForBrowser()?.items || [];
    const item = items.find((r) => r.shotId === pending.shotId && r.owner.frameId === pending.frameId && r.candidate.name === d.name && r.candidate.receiptBacked && (!d.assetId || r.key === "asset:" + d.assetId || r.candidate.assetId === d.assetId));
    if (!item) return;
    active.key = item.key;
    history.replaceState(history.state, "", shotReviewHref(pending.shotId, item.key));
    focusNext = "sd-decision-state";
  });
  window.addEventListener("cinebraid:route-rendered", mount);
  window.CineBraidShotDesk = {
    handles(shot, key) {
      const item = candidateReviewContext(returnedReviewProjectionForBrowser(), key);
      return !item || item.owner.kind !== "shot-motion";
    },
    view,
  };
})();
