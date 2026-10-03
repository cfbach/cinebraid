/* Transient repair authoring. Only explicit Build commits target history/files. */
(() => {
  let draft = null, epoch = 0, modalEpoch = 0;
  window.addEventListener("cinebraid:modal-opened", () => modalEpoch++);
  const live = d => draft === d && d.slug === ACTIVE_PROJECT_SLUG && d.openEpoch === PROJECT_OPEN_EPOCH;
  function dispose() {
    if (draft) for (const file of Object.values(draft.files || {})) if (file?.url) URL.revokeObjectURL(file.url);
    draft = null;
  }
  const observer = new MutationObserver(() => {
    if (draft && (!document.getElementById("candidate-repair") || document.getElementById("modal")?.classList.contains("hidden"))) dispose();
  });
  window.addEventListener("DOMContentLoaded", () => observer.observe(document.getElementById("modal"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }));
  function ordered() {
    const d = draft;
    const refs = (d?.inventory.appearances || []).filter((_, n) => document.getElementById(`repair-choose-${n}`)?.checked)
      .map((ref, n) => ({ ...ref, role: document.getElementById(`repair-role-${d.inventory.appearances.indexOf(ref)}`)?.value || ref.role,
        instruction: document.getElementById(`repair-instruction-${d.inventory.appearances.indexOf(ref)}`)?.value || "", order: n }));
    return refs;
  }
  let orderEpoch = 0;
  window.updateCandidateRepairSummary = async () => {
    if (!draft) return;
    const own = draft, ticket = ++orderEpoch;
    const host = document.getElementById("repair-order");
    const references = [{ key: "base", role: "base", label: own.inventory.base.label }, ...ordered(),
      ...(own.files.guide ? [{ key: "guide", role: "composition", label: own.files.guide.file.name }] : [])];
    host.innerHTML = '<li role="status">Resolving exact input order…</li>';
    try {
      const response = await fetch("/api/generation/candidate-repair/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ references }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      if (!live(own) || ticket !== orderEpoch) return;
      host.innerHTML = result.references.map((r, n) => `<li><b>Image ${n + 1} — ${esc(r.production.label)}</b><small>${esc(r.role)} · ${r.role === "base" ? "candidate canvas; no approval authority" : r.role === "composition" ? "technical; no approval authority" : "current human receipt"}</small></li>`).join("") +
        (own.files.mask ? `<li><b>Separate mask — ${esc(own.files.mask.file.name)}</b><small>Binds only to exact Image 1</small></li>` : "");
    } catch (e) { if (live(own) && ticket === orderEpoch) host.textContent = e.message; }
  };
  window.filterCandidateRepairAppearances = value => {
    document.querySelectorAll("[data-repair-appearance]").forEach(row => { row.hidden = !row.dataset.repairAppearance.includes(value.toLowerCase()); });
  };
  window.setCandidateRepairFile = (kind, input) => {
    if (!draft) return;
    const previous = draft.files[kind]; if (previous?.url) URL.revokeObjectURL(previous.url);
    const file = input.files?.[0]; draft.files[kind] = file ? { file, url: URL.createObjectURL(file) } : null;
    const preview = document.getElementById(`repair-${kind}-preview`);
    preview.innerHTML = file ? `<img src="${attr(draft.files[kind].url)}" alt="${kind === "mask" ? "Imported technical mask" : "Technical geometry guide"}"><small>${esc(file.name)} · not approval authority</small>` : "";
    updateCandidateRepairSummary();
  };
  window.openNativeCandidateRepair = async (shotId, frameId, name) => {
    dispose(); const ticket = ++epoch, slug = ACTIVE_PROJECT_SLUG, openEpoch = PROJECT_OPEN_EPOCH;
    const query = new URLSearchParams({ shotId, frameId, sourceCandidate: name });
    openModal('<h3>Repair current candidate</h3><p role="status">Loading exact candidate and current human receipts…</p><button class="cancel" onclick="closeModal()">Cancel</button>');
    const loadingModal = modalEpoch;
    try {
      const response = await fetch(`/api/generation/candidate-repair/inputs?${query}`), inventory = await response.json();
      if (!response.ok) throw Error(inventory.error);
      if (ticket !== epoch || loadingModal !== modalEpoch || slug !== ACTIVE_PROJECT_SLUG || openEpoch !== PROJECT_OPEN_EPOCH || document.getElementById("modal").classList.contains("hidden")) return;
      draft = { slug, openEpoch, inventory, files: {}, busy: false };
      const appearances = inventory.appearances.map((r, n) => `<article class="repair-appearance" data-repair-appearance="${attr(r.label.toLowerCase())}">
        <label><input type="checkbox" id="repair-choose-${n}" onchange="updateCandidateRepairSummary()"><img src="${attr(r.url)}" alt=""><span><b>${esc(r.label)}</b><small>Current human approval · ${esc(r.approvalReceiptId)}</small></span></label>
        <label><span>Semantic role</span><select id="repair-role-${n}" onchange="updateCandidateRepairSummary()">${inventory.roles.map(role => `<option ${role === r.role ? "selected" : ""}>${role}</option>`).join("")}</select></label>
        <label><span>Appearance use / limits</span><input id="repair-instruction-${n}" placeholder="Appearance only; no source pose, camera or rendering"></label></article>`).join("");
      openModal(`<div id="candidate-repair" class="candidate-repair"><header><div><span>FRAME ${esc(frameById(shotById(shotId), frameId)?.label || "")} · TARGET PACKAGE</span><h3>Repair current candidate</h3><p>Build from current authority. This does not approve the candidate or change Canon. Historical inputs are not inherited.</p></div><button class="cancel" onclick="closeModal()">Cancel</button></header>
        <div class="repair-scroll"><section class="repair-base"><img src="${attr(inventory.base.url)}" alt="Selected candidate edit base"><div><b>Edit base — ${esc(name)}</b><p>Candidate / not approval authority</p><code>${esc(inventory.base.assetId)}</code><small>SHA-256 ${esc(inventory.base.contentHash)}</small></div></section>
        <div class="repair-direction"><label><span>Change only</span><textarea id="repair-change" placeholder="Describe the bounded repair; no full-frame reroll."></textarea></label><label><span>Preserve</span><textarea id="repair-preserve" placeholder="Unchanged composition, camera, background and style."></textarea></label><label><span>Exclude / avoid</span><textarea id="repair-avoid" placeholder="Explicit exclusions and unwanted artifacts."></textarea></label></div>
        <section><h4>Appearance references — exact current states</h4><p>Choose only the appearances this edit needs. Each selection retains its own current receipt.</p><label><span>Find an entity / state</span><input type="search" oninput="filterCandidateRepairAppearances(this.value)"></label><div class="repair-appearances">${appearances || "No current verified appearance approvals are available."}</div></section>
        <div class="repair-technical"><section><h4>Technical geometry guide</h4><p>Unapproved technical pixels are allowed for geometry/contact only.</p><label><span>Import PNG guide / crop</span><input type="file" accept="image/png" id="repair-guide" onchange="setCandidateRepairFile('guide',this)"></label><label><span>Guide use / limits</span><textarea id="repair-guide-instruction" placeholder="Geometry only; no design, proportions, rendering or surrounding-pixel authority."></textarea></label><div id="repair-guide-preview" class="repair-file-preview"></div></section>
        <section><h4>Mask bound to ${esc(name)}</h4><label><span>Import PNG mask</span><input type="file" accept="image/png" id="repair-mask" onchange="setCandidateRepairFile('mask',this)"></label><label><span>Source convention — required</span><select id="repair-mask-convention"><option value="">Choose explicitly</option><option value="alpha-transparent-edit">Alpha: transparent editable / opaque preserved</option><option value="white-edit-black-preserve">Black/white: white editable / black preserved</option></select></label><p>Dimensions must match Image 1. fal receives an actual white-edit / black-preserve PNG in mask_url. Results still need review.</p><div id="repair-mask-preview" class="repair-file-preview"></div></section></div>
        <section><h4>Selected package</h4><p>Image 1 stays the canvas. Build previews the exact canonical role order before request review.</p><ol id="repair-order"></ol><small>Technical files become durable project dependencies only when you explicitly Build. Braidy is not qualified for repair; deterministic Build remains available.</small></section><p id="repair-error" role="alert"></p></div>
        <footer class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="repair-build" class="approve-btn" onclick="buildNativeCandidateRepair()">Build repair package</button></footer></div>`);
      updateCandidateRepairSummary();
    } catch (e) { if (ticket === epoch && loadingModal === modalEpoch && slug === ACTIVE_PROJECT_SLUG && openEpoch === PROJECT_OPEN_EPOCH && !document.getElementById("modal").classList.contains("hidden")) openModal(`<h3>Repair unavailable</h3><p>${esc(e.message)}</p><button class="cancel" onclick="closeModal()">Close</button>`); }
  };
  function readFile(file) { return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(Error("Could not read technical PNG.")); reader.readAsDataURL(file);
  }); }
  window.buildNativeCandidateRepair = async () => {
    const own = draft; if (!own || own.busy || !live(own)) return;
    const body = { projectSlug: own.slug, shotId: own.inventory.shotId, frameId: own.inventory.frameId,
      sourceCandidate: own.inventory.sourceCandidate, baseAssetId: own.inventory.base.assetId, baseHash: own.inventory.base.contentHash,
      appearances: ordered(), change: document.getElementById("repair-change").value, preserve: document.getElementById("repair-preserve").value,
      avoid: document.getElementById("repair-avoid").value };
    const guideInstruction = document.getElementById("repair-guide-instruction").value, convention = document.getElementById("repair-mask-convention").value;
    own.busy = true; document.getElementById("repair-build").disabled = true;
    const release = beginProjectServerWrite();
    try {
      for (const kind of ["guide", "mask"]) if (own.files[kind]) {
        const f = own.files[kind].file;
        if (f.size > 4 * 1024 * 1024) throw Error("Technical PNG limit is 4 MB.");
        body[kind] = { name: f.name, base64: await readFile(f), ...(kind === "mask" ? { sourceConvention: convention } : { instruction: guideInstruction }) };
      }
      if (!live(own)) return;
      await flushPendingProjectSave();
      if (!live(own) || !projectSaveSettled().settled) throw Error("Resolve the project's save state before Build.");
      const response = await fetch("/api/generation/candidate-repair/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || "Repair Build failed.");
      await applyProjectMutationResult(own.slug, { projectUpdated: true });
      if (!live(own)) return;
      const build = resolvePromptBuild(P, result.buildId);
      const buildEpoch = epoch;
      openModal('<h3>Repair package built</h3><p role="status">Preparing exact native input review…</p><button class="cancel" onclick="closeModal()">Close</button>');
      dispose(); const previewModal = modalEpoch;
      const preview = await fetchFalImagePlan("correction", body.shotId, result.buildId);
      if (buildEpoch !== epoch || previewModal !== modalEpoch || document.getElementById("modal").classList.contains("hidden") || own.slug !== ACTIVE_PROJECT_SLUG || own.openEpoch !== PROJECT_OPEN_EPOCH) return;
      openModal(`<div class="candidate-repair"><h3>Repair package built</h3><p>Durable inputs and exact roles are stored with ${esc(build.packageId)}. No approval or Canon changed.</p>${falFrameReferenceRows(preview)}<p>Braidy is not qualified for repair. Review the deterministic compiled request.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="openFalFrameGenerationModal('correction','${attr(body.shotId)}','${attr(body.frameId)}','${attr(result.buildId)}')">Review image request</button></div></div>`);
    } catch (e) { if (live(own)) document.getElementById("repair-error").textContent = e.message; else toast(e.message); }
    finally { release(); if (live(own)) { own.busy = false; document.getElementById("repair-build").disabled = false; } }
  };
})();
