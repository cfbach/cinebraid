/* ---------- v6.5.3 coverage automation & sheet extraction ---------- */
(function () {
  const COVERAGE_RUNS = window.COVERAGE_RUNS || (window.COVERAGE_RUNS = new Map());
  const COVERAGE_SUBMISSION_LOCKS = window.COVERAGE_SUBMISSION_LOCKS || (window.COVERAGE_SUBMISSION_LOCKS = new Map());
  function coverageLockKey(list, entityId, kind, target = "") { return `${list}:${entityId}:${kind}:${target}`; }
  function coverageClientRequestId(list, entityId, kind, target = "") { return `coverage:${ACTIVE_PROJECT_SLUG || "project"}:${list}:${entityId}:${kind}:${target}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`; }
  function setCoverageLock(key, value = true) { if (value) COVERAGE_SUBMISSION_LOCKS.set(key, Date.now()); else COVERAGE_SUBMISSION_LOCKS.delete(key); }
  function coverageLocked(key) { return COVERAGE_SUBMISSION_LOCKS.has(key); }
  function updateCoverageTerminalState(list, entity) {
    const slots = list === "characters" && entity.coverageAutomation?.sheetType === "expressions" ? ensureExpressionSlots(entity) : ensureCoverageSlots(list, entity);
    const required = slots.filter((slot) => isRequiredCoverage(slot) && !slot.retired);
    const missing = required.filter((slot) => !slotSelectedFile(slot)).length;
    if (!entity.coverageAutomation) return;
    if (!missing) { entity.coverageAutomation.status = "completed"; entity.coverageAutomation.completedAt = new Date().toISOString(); }
    else if (["sheet-ready-for-review","slot-candidates-ready","ready-for-review"].includes(entity.coverageAutomation.status)) entity.coverageAutomation.status = "needs-attention";
    entity.coverageAutomation.missingRequired = missing;
  }
  function entityFor(list, id) { return (P[list] || []).find((item) => item.id === id); }
  function entityTypeLabel(list) { return ({ characters: "character", locations: "location", props: "prop", vehicles: "vehicle" })[list] || "asset"; }
  function entityFolder(list) { return ({ characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" })[list] || "media"; }
  /* Coverage keeps its own override first — a coverage sheet may describe the
     entity differently from the production canon — then defers to the one
     shared rule instead of repeating a fourth guess at the same question. */
  function entityIdentityText(list, entity) {
    return String(entity.coverageDescription || "").trim() || entityVisualDescription(entity, list);
  }
  /* S8A — THE CANONICAL IDENTITY INPUT REQUIRES CURRENT CANON.
   *
   * This used to read `entity.approvedFile` or the default state's raw
   * `approvedFile` with no receipt predicate at all, and `submitCoverageJob`
   * then serialized whatever it found as `role: "identity-authority"` under the
   * label "primary approved authority". The 1D audit drove a project with a null
   * ledger to the dispatch boundary and watched an unreceipted LEGACY.png go out
   * as this entity's identity authority.
   *
   * A raw pointer is HISTORIC. It stays visible — `historicPrimaryPointer()`
   * below is how a surface offers it — but it is not what this entity looks
   * like until a person says so. */
  function canonPrimaryRow(list, entity) {
    if (!entity || typeof entityProductionTruth !== "function") return null;
    const truth = entityProductionTruth(P, list, entity.id);
    return truth.canon.find((row) => row.isDefault) || truth.canon[0] || null;
  }
  function primaryReference(list, entity) {
    const row = canonPrimaryRow(list, entity);
    if (!row) return null;
    /* Identity first, filename second, so an image renamed since the approval
       still resolves instead of silently becoming "no primary reference". */
    return resolveApprovalMedia({ file: row.value, assetId: row.assetId || "" }, entityMedia(list, entity));
  }
  /* What is sitting there with nobody's name on it. Offered to the creator as
     something they may confirm in one act; never used as identity input. */
  function historicPrimaryPointer(list, entity) {
    if (!entity || typeof entityProductionTruth !== "function") return null;
    const truth = entityProductionTruth(P, list, entity.id);
    const row = truth.historic.find((item) => item.isDefault) || truth.historic[0] || null;
    if (!row) return null;
    const item = resolveApprovalMedia({ file: row.value, assetId: row.assetId || "" }, entityMedia(list, entity));
    return item ? { ...item, historic: true, basis: row.basis } : null;
  }
  /* S8 — THE REFERENCE PACKAGE, NAMED FOR WHAT EACH IMAGE IS FOR.
   *
   * Roles express PURPOSE. `identity-canon` is receipt-backed and is the only
   * member that carries any authority claim; everything else is context the
   * model may look at. The old names — `identity-authority` for a raw pointer,
   * `approved-view` for a slot selection — were the two halves of the same
   * mistake, and both are gone. */
  function coverageReferencePackage(list, entity, targetSlot = null) {
    const primary = primaryReference(list, entity);
    const media = entityMedia(list, entity);
    const desired = targetSlot ? coverageSlotViewTag(list, targetSlot) : "custom";
    const refs = [];
    const add = (item, slot = null, score = 0, kind = "supporting-view") => {
      if (!item?.url || entityCandidateIsCoverageSheet(entity, item.name) || refs.some((row) => row.item.name === item.name)) return;
      refs.push({ item, slot, score, kind });
    };
    add(primary, null, 1000, "identity-canon");
    for (const slot of ensureCoverageSlots(list, entity)) {
      const slotFile = slotSelectedFile(slot);
      if (!slotFile || entityCandidateIsCoverageSheet(entity, slotFile)) continue;
      /* Identity first, filename second — the same rule primaryReference() uses,
         so a coverage view and the primary cannot disagree about whether the
         image they both point at still exists. */
      const item = resolveApprovalMedia({ file: slotFile, assetId: slot.selectedAssetId || slot.approvedAssetId || "" }, media);
      if (!item) continue;
      const candidateView = coverageSlotViewTag(list, slot);
      const score = targetSlot && typeof referenceViewScore === "function"
        ? referenceViewScore(desired, candidateView, { referenceKind: "single-angle", priority: slot.id === targetSlot.id ? "primary" : "supporting" })
        : slot.id === targetSlot?.id ? 100 : 10;
      add(item, slot, score, "supporting-view");
    }
    const primaryRow = refs.find((row) => row.kind === "identity-canon") || null;
    const rest = refs.filter((row) => row !== primaryRow).sort((a, b) => b.score - a.score || String(a.slot?.id || "").localeCompare(String(b.slot?.id || "")));
    const ordered = primaryRow ? [primaryRow, ...rest] : rest;
    return ordered.slice(0, list === "locations" ? 10 : 8);
  }
  function missingCoverageSlots(list, entity, includeOptional = false) {
    const slots = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : (entity.coverageSlots || []);
    return slots.filter((slot) => !slotSelectedFile(slot) && (includeOptional || isRequiredCoverage(slot)));
  }
  function coverageSlotViewTag(list, slot) {
    const map = {
      front: "front",
      "front-three-quarter": "front-three-quarter-left",
      profile: "left-profile",
      rear: "rear",
      hero: "front",
      "three-quarter": "front-three-quarter-left",
      side: "left-profile",
      top: "top",
      detail: "detail",
      "left-side": "left-profile",
      "right-side": "right-profile",
      "front-three-quarter": "front-three-quarter-left",
      "rear-three-quarter": "rear-three-quarter-left",
      interior: "interior",
      establishing: "front-three-quarter-left",
      reverse: "rear-three-quarter-left",
      "left-coverage": "left-profile",
      "right-coverage": "right-profile",
      "action-zone": "detail",
      "entrance-exit": "detail",
      "detail-zone": "detail",
      overhead: "top",
      "detail-face": "detail",
      expression: "detail",
    };
    return map[slot.id] || "custom";
  }
  function coverageSheetSlots(list, entity, sheetType) {
    const slots = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : (entity.coverageSlots || []);
    if (sheetType === "expressions") return (typeof ensureExpressionSlots === "function" ? ensureExpressionSlots(entity) : (entity.expressionSlots || [])).filter((slot) => !slot.retired);
    if (list === "characters") return slots.filter((slot) => ["front", "front-three-quarter", "profile", "rear"].includes(slot.id));
    if (list === "vehicles") return slots.filter((slot) => ["front", "rear", "left-side", "right-side", "front-three-quarter", "rear-three-quarter"].includes(slot.id));
    if (list === "props") return slots.filter((slot) => ["hero", "three-quarter", "side", "rear", "top", "detail"].includes(slot.id));
    return slots.filter((slot) => isRequiredCoverage(slot)).slice(0, 4);
  }
  function coverageSheetPrompt(list, entity, sheetType, slots, userDirection = "") {
    const identity = entityIdentityText(list, entity);
    const names = slots.map((slot) => slot.label).join(", ");
    const immutable = String(entity.coverageCharacteristics || entity.driftNotes || entity.coverageNotes || "").trim();
    const common = [
      `Create one high-resolution ${sheetType === "expressions" ? "expression reference sheet" : "multi-view reference sheet"} for the SAME ${entityTypeLabel(list)} shown in the supplied canon reference.`,
      identity ? `DESIGN DESCRIPTION: ${identity}` : "Preserve every visible identifying feature from the supplied reference.",
      immutable ? `IMMUTABLE CHARACTERISTICS: ${immutable}` : "Keep silhouette, proportions, materials, colors, construction and distinguishing details identical in every panel.",
      `PANELS IN THIS EXACT ORDER: ${names}.`,
      "Use clean, even lighting and a plain neutral background. Keep generous gutters between panels. Do not overlap panels. Do not place text, labels, borders, arrows, captions or watermarks inside the generated image. CineBraid will label and crop the panels after generation.",
      "Each panel must show one clear, useful production reference rather than a dramatic scene. Keep scale and rendering style consistent across the entire sheet.",
      userDirection ? `ADDITIONAL DIRECTION: ${userDirection}` : "",
    ];
    if (sheetType === "expressions") common.push("Use head-and-shoulders framing with the same camera height and lighting in every panel. Change only facial expression and subtle performance; do not change identity, hair, wardrobe or accessories.");
    else if (list === "characters") common.push("Use neutral standing poses, full body visible, arms relaxed and unobstructed. Preserve face, anatomy, costume and accessories exactly.");
    else if (list === "props") common.push("Center the object in every panel, fully visible where possible. Keep exact dimensions, materials, wear, part count and functional construction consistent. If the prop contains a photograph, mural, artwork, map, document, print, label, text or screen image, preserve that exact embedded content in every panel; never substitute a similar image.");
    else if (list === "vehicles") common.push("Show the complete vehicle at consistent scale. Preserve body construction, wheel placement, doors, windows, materials, finish and functional details.");
    else if (list === "locations") common.push("Treat all panels as camera viewpoints of one physically coherent location. Preserve the exact floor plan, topology, walls, openings, doors, windows, fixed fixtures, structural landmarks, surfaces, set dressing and scale relationships across every view. Do not invent a plausible alternative room. When an area is not visible in one authority, infer it only from the other approved views and never contradict them.");
    return common.filter(Boolean).join("\n\n");
  }
  function coverageSlotPrompt(list, entity, slot, userDirection = "") {
    const identity = entityIdentityText(list, entity);
    const immutable = String(entity.coverageCharacteristics || entity.driftNotes || entity.coverageNotes || "").trim();
    const contract = list === "locations"
      ? "SPATIAL CONTINUITY LOCK: all supplied approved images are views of one physical location. Preserve the exact floor plan, topology, wall and opening placement, doors, windows, fixed fixtures, structural landmarks, material boundaries, set dressing and scale relationships. Move only the camera to the requested view. Do not invent, remove, mirror, relocate or redesign architecture."
      : list === "props"
        ? "PROP CONTENT LOCK: preserve the exact object, dimensions, material, construction and wear. Preserve any embedded photograph, mural, artwork, text, label, map, document, print or screen image exactly; do not substitute similar content."
        : list === "characters"
          ? "CHARACTER IDENTITY LOCK: preserve the exact same face, anatomy, proportions, hair, wardrobe construction and accessories while changing only the camera angle."
          : "VEHICLE DESIGN LOCK: preserve exact silhouette, construction, wheels, panels, openings, materials and components while changing only the camera angle.";
    return [
      `Create the ${slot.label} production reference for the exact same ${entityTypeLabel(list)} shown across the supplied reference package.`,
      identity ? `DESIGN DESCRIPTION: ${identity}` : "Preserve every visible identifying feature from every supplied image.",
      immutable ? `IMMUTABLE CHARACTERISTICS: ${immutable}` : "Preserve silhouette, proportions, colors, materials, construction and distinguishing details.",
      contract,
      `TARGET VIEW: ${slot.label}. ${slot.notes || ""}`,
      "The output must be a clean future-generation authority, not a dramatic reinterpretation. The requested angle must be unambiguous. No text labels, borders or watermarks.",
      userDirection ? `ADDITIONAL DIRECTION: ${userDirection}` : "",
    ].filter(Boolean).join("\n\n");
  }
  async function submitCoverageJob(list, entity, options) {
    const authorities = coverageReferencePackage(list, entity, options.slot || null);
    const primary = authorities[0]?.item || null;
    /* S8 — EVERY ROLE NAMES A PURPOSE. Only `identity-canon` is receipt-backed,
       and only it makes a claim; a supporting view travels as context and says
       so in its role, its label and its instruction. */
    const refs = authorities.map((row, index) => {
      const isCanon = row.kind === "identity-canon";
      const environment = list === "locations";
      const expression = !isCanon && row.slot && (entity.expressionSlots || []).some((slot) => slot.id === row.slot.id);
      return {
        key: isCanon ? "coverage-identity-canon" : `coverage-supporting-view:${row.slot?.id || index}`,
        token: `#image${index + 1}`,
        label: isCanon ? `${entity.name || entity.id} canon identity` : `${row.slot?.label || "Selected view"} of ${entity.name || entity.id}`,
        role: isCanon ? "identity-canon" : environment ? "environment-reference" : expression ? "expression-reference" : "supporting-view",
        instruction: environment && !isCanon
          ? "This image is one viewpoint of the same exact physical space. Preserve shared geometry, topology, fixed landmarks and material boundaries; move only the camera."
          : isCanon
            ? "Use as the exact identity/design canon. Preserve the asset; change only to the requested view."
            : "Use this selected supporting view to preserve construction and details visible from this side. Context only — it is not production truth.",
        url: row.item.url,
        sourceFile: row.item.name,
      };
    });
    const body = {
      purpose: "entity-reference",
      entityList: list,
      entityId: entity.id,
      entityType: entityTypeLabel(list),
      sourceBuildId: options.sourceBuildId || `coverage-${Date.now().toString(36)}`,
      prompt: options.prompt,
      references: refs,
      /* `referenceManifest`, not `authorityManifest`. Most of what travels here
         is not authority, and the key said otherwise on every job. */
      referenceManifest: refs.map((ref) => ({ token: ref.token, label: ref.label, role: ref.role, sourceFile: ref.sourceFile || "" })),
      /* One source of truth for the contract version: a hard-coded copy here
         silently kept stamping v2 onto jobs after the contract moved on. */
      authorityContractVersion: typeof ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION === "string" ? ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION : "reference-authority-v3",
      outputCount: options.outputCount || 1,
      quality: options.quality || "high",
      resolution: options.resolution || "4k",
      aspectRatio: options.aspectRatio || "16:9",
      coverageJobType: options.coverageJobType || "sheet",
      coverageSheetType: options.coverageSheetType || "angles",
      targetCoverageSlotId: options.slot?.id || "",
      targetCoverageSlotName: options.slot?.label || "",
      coverageSourceFile: primary?.name || "",
      // Explicit provenance for edit/reference jobs. This is not a correction
      // requirement, but it prevents support reports from looking source-less.
      sourceCandidate: primary?.name || "",
      clientRequestId: options.clientRequestId || coverageClientRequestId(list, entity.id, options.coverageJobType || "sheet", options.slot?.id || options.coverageSheetType || ""),
    };
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not start coverage generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    pollFalGeneration(data.job.id);
    return data.job;
  }
  window.openCoverageAutomationModal = (list, entityId, defaultMode = "hybrid") => {
    if (list === "locations" && defaultMode === "hybrid") defaultMode = "individual";
    const entity = entityFor(list, entityId);
    if (!entity) return toast("Reference asset is unavailable");
    const primary = primaryReference(list, entity);
    if (!primary) return toast("Approve a primary/default reference before automating coverage");
    if (!falGenerationReady()) return toast("Enable FAL image generation first");
    const missingRequired = missingCoverageSlots(list, entity, false);
    const expressionOption = list === "characters" ? `<option value="expressions">Expression sheet</option>` : "";
    window._coverageAutomation = { list, entityId };
    rememberWorkspaceSection(entityCoverageSectionKey(list, entityId, "angles"), true);
    openModal(`<div class="coverage-automation-modal"><header><div><span>COVERAGE AUTOMATION</span><h3>${esc(entity.name || entity.id)}</h3><p>Generate a large multi-view sheet, extract approved crops, and individually regenerate only weak or missing slots.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="coverage-automation-summary"><img src="${attr(primary.url)}" alt="Approved primary reference"><div><b>Approved source</b><span>${esc(primary.name)}</span><small>${missingRequired.length} required coverage slot${missingRequired.length === 1 ? "" : "s"} still missing.</small></div></div><div class="two-col"><label><span>Generation mode</span><select id="coverage-mode" onchange="updateCoverageAutomationPlan()"><option value="hybrid" ${defaultMode === "hybrid" ? "selected" : ""}>Hybrid — sheet first, manual missing-view fallback</option><option value="sheet">Sheet first only</option><option value="individual">Generate missing slots individually</option></select></label><label><span>Sheet type</span><select id="coverage-sheet-type" onchange="updateCoverageAutomationPlan()"><option value="angles">Angle / viewpoint sheet</option>${expressionOption}</select></label><label><span>Resolution</span><select id="coverage-resolution"><option value="2k">2K</option><option value="4k" selected>4K recommended</option></select></label><label><span>Sheet candidates</span><select id="coverage-output-count" onchange="updateCoverageAutomationPlan()"><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option></select></label></div><label><span>Additional direction</span><textarea id="coverage-direction" placeholder="Panel order, pose constraints, critical details, expression list, or geometry notes.">${esc(entity.coverageGenerationNotes || "")}</textarea></label><div class="coverage-mode-note"><b>${list === "locations" ? "Location guidance" : "Hybrid behavior"}</b><span>${list === "locations" ? "Individual viewpoints are recommended for locations because a single generated sheet may invent incompatible architecture. A sheet remains available when you have a strong layout authority." : "Generate a consistent overview sheet first. Extract useful panels into slots, then generate only any remaining or rejected views individually."}</span></div><div id="coverage-spend-plan" class="coverage-spend-plan"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="coverage-start-button" class="approve-btn large" onclick="startCoverageAutomation()">START COVERAGE GENERATION</button></div></div>`);
    setTimeout(() => updateCoverageAutomationPlan(), 20);
  };
  window.openCoverageExpressionAutomation = (entityId) => {
    window.openCoverageAutomationModal("characters", entityId, "hybrid");
    setTimeout(() => { const select = document.getElementById("coverage-sheet-type"); if (select) select.value = "expressions"; }, 20);
  };
  window.updateCoverageAutomationPlan = () => {
    const req = window._coverageAutomation || {}, entity = entityFor(req.list, req.entityId);
    const mode = document.getElementById("coverage-mode")?.value || "hybrid";
    const sheetType = document.getElementById("coverage-sheet-type")?.value || "angles";
    const outputs = Number(document.getElementById("coverage-output-count")?.value || 1);
    const missing = entity ? (sheetType === "expressions" ? ensureExpressionSlots(entity) : missingCoverageSlots(req.list, entity, false)).filter((slot) => isRequiredCoverage(slot) && !slot.approvedFile && !slot.retired).length : 0;
    const requests = mode === "individual" ? missing : 1;
    const images = mode === "individual" ? requests * 3 : outputs;
    const potential = mode === "hybrid" ? ` · up to ${missing} later individual fallback request${missing === 1 ? "" : "s"}` : "";
    const el = document.getElementById("coverage-spend-plan");
    if (el) el.innerHTML = `<b>Confirmed first submission: ${requests} paid request${requests === 1 ? "" : "s"} · up to ${images} image${images === 1 ? "" : "s"}</b><span>${mode === "individual" ? "Each missing required slot is submitted separately." : "This submits the sheet only."}${potential}</span>`;
  };
  window.startCoverageAutomation = async (spendConfirmed = false) => {
    const req = window._coverageAutomation || {};
    const entity = entityFor(req.list, req.entityId);
    if (!entity) return toast("Coverage asset is unavailable");
    const mode = document.getElementById("coverage-mode")?.value || "hybrid";
    const sheetType = document.getElementById("coverage-sheet-type")?.value || "angles";
    const resolution = document.getElementById("coverage-resolution")?.value || "4k";
    const outputCount = Number(document.getElementById("coverage-output-count")?.value || 1);
    const direction = document.getElementById("coverage-direction")?.value || "";
    const lockKey = coverageLockKey(req.list, req.entityId, "automation", sheetType);
    if (coverageLocked(lockKey)) return toast("This coverage submission is already being prepared.");
    const requestedSlots = mode === "individual" ? missingCoverageSlots(req.list, entity, false) : [];
    const requestCount = mode === "individual" ? requestedSlots.length : 1;
    const imageCount = mode === "individual" ? requestCount * 3 : outputCount;
    if (requestCount > 2 && !spendConfirmed) {
      return confirmModal(`This will submit ${requestCount} paid FAL requests and may return up to ${imageCount} images.`, () => startCoverageAutomation(true), { title: "Confirm coverage generation", confirmLabel: `SUBMIT ${requestCount} REQUESTS` });
    }
    setCoverageLock(lockKey, true);
    const startButton = document.getElementById("coverage-start-button"); if (startButton) { startButton.disabled = true; startButton.textContent = "PREPARING…"; }
    entity.coverageGenerationNotes = direction;
    entity.coverageAutomation = { id: coverageClientRequestId(req.list, req.entityId, "run", sheetType), list: req.list, entityId: req.entityId, mode, sheetType, status: "starting", startedAt: new Date().toISOString(), jobs: [], requestCount, maximumImages: imageCount };
    rememberWorkspaceSection(entityCoverageSectionKey(req.list, req.entityId, sheetType === "expressions" ? "expressions" : "angles"), true);
    dirty();
    closeModal();
    route();
    try {
      if (mode === "sheet" || mode === "hybrid") {
        const slots = coverageSheetSlots(req.list, entity, sheetType);
        const prompt = coverageSheetPrompt(req.list, entity, sheetType, slots, direction);
        const job = await submitCoverageJob(req.list, entity, { prompt, outputCount, resolution, aspectRatio: sheetType === "expressions" ? "4:3" : "16:9", coverageJobType: "sheet", coverageSheetType: sheetType, clientRequestId: coverageClientRequestId(req.list, req.entityId, "sheet", sheetType) });
        entity.coverageAutomation.jobs.push(job.id);
        entity.coverageAutomation.status = "sheet-running";
        toast("Coverage sheet generation queued");
      } else {
        const slots = requestedSlots;
        if (!slots.length) throw new Error("All required coverage slots are already assigned");
        entity.coverageAutomation.status = "individual-running";
        for (const slot of slots) {
          const prompt = coverageSlotPrompt(req.list, entity, slot, direction);
          const job = await submitCoverageJob(req.list, entity, { prompt, outputCount: 3, resolution, aspectRatio: referenceAspectLabel(req.list), coverageJobType: "slot", coverageSheetType: "", slot, clientRequestId: coverageClientRequestId(req.list, req.entityId, "slot", slot.id) });
          entity.coverageAutomation.jobs.push(job.id);
        }
        toast(`${slots.length} missing coverage slot generation job${slots.length === 1 ? "" : "s"} queued`);
      }
      dirty();
      route();
    } catch (error) {
      entity.coverageAutomation.status = "failed";
      entity.coverageAutomation.error = error.message;
      dirty();
      route();
      toast("Coverage generation failed: " + error.message);
    } finally {
      setCoverageLock(lockKey, false);
    }
  };
  window.generateCoverageSlot = async (list, entityId, slotId) => {
    const entity = entityFor(list, entityId);
    const slot = (typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : entity?.coverageSlots || []).find((item) => item.id === slotId);
    if (!entity || !slot) return toast("Coverage slot is unavailable");
    if (!primaryReference(list, entity)) return toast("Approve the primary reference first");
    rememberWorkspaceSection(entityCoverageSectionKey(list, entityId, "angles"), true);
    const lockKey = coverageLockKey(list, entityId, "slot", slotId);
    if (coverageLocked(lockKey)) return toast(`${slot.label} generation is already being submitted.`);
    setCoverageLock(lockKey, true);
    try {
      const prompt = coverageSlotPrompt(list, entity, slot, entity.coverageGenerationNotes || "");
      await submitCoverageJob(list, entity, { prompt, outputCount: 3, resolution: "4k", aspectRatio: referenceAspectLabel(list), coverageJobType: "slot", slot, clientRequestId: coverageClientRequestId(list, entityId, "slot", slotId) });
      toast(`${slot.label} coverage candidates queued`);
      route();
    } catch (error) { toast("Coverage slot generation failed: " + error.message); }
    finally { setCoverageLock(lockKey, false); }
  };
  function candidateCoverageSheetRows(entity) {
    return (entity.candidateFiles || []).filter((row) => row.coverageJobType === "sheet" || /(?:SHEET|TURNAROUND|CONTACT)/i.test(row.stored || row.original || ""));
  }
  window.openCoverageSheetPicker = (list, entityId, preferredFile = "") => {
    const entity = entityFor(list, entityId);
    if (!entity) return;
    const media = entityMedia(list, entity).filter((item) => !isVideo(item.name));
    if (!media.length) return toast("Upload or generate a reference sheet first");
    if (preferredFile && media.some((item) => item.name === preferredFile)) {
      closeModal();
      return openCoverageSheetExtractor(list, entityId, preferredFile);
    }
    const known = new Set(candidateCoverageSheetRows(entity).map((row) => row.stored || row.original));
    const recognized = media.filter((item) => known.has(item.name));
    const other = media.filter((item) => !known.has(item.name));
    const cards = (items, badge) => items.map((item) => `<button onclick="closeModal();openCoverageSheetExtractor('${list}','${entityId}','${attr(item.name)}')"><img src="${attr(item.url)}" alt=""><span>${esc(item.name)}</span><b>${badge}</b></button>`).join("");
    openModal(`<div class="coverage-sheet-picker"><h3>Crop angles from a reference sheet</h3><p>Choose any uploaded or generated sheet. CineBraid leaves the original untouched and saves each selected panel as an individual angle reference.</p>${recognized.length ? `<section><h4>Recognized sheets</h4><div class="coverage-sheet-picker-grid">${cards(recognized,"REFERENCE SHEET")}</div></section>` : ""}${other.length ? `<section><h4>Other uploaded images</h4><p class="hint">Choose one when it contains multiple views, even if CineBraid did not generate or recognize it as a sheet.</p><div class="coverage-sheet-picker-grid other-images">${cards(other,"UPLOADED IMAGE")}</div></section>` : ""}<div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div></div>`);
  };
  const COVERAGE_CROP_LAYOUTS = Object.freeze({
    "3x1": { cols: 3, rows: 1, label: "3 columns" },
    "4x1": { cols: 4, rows: 1, label: "4 columns" },
    "2x2": { cols: 2, rows: 2, label: "2 × 2 grid" },
    "3x2": { cols: 3, rows: 2, label: "3 × 2 grid" },
  });
  function cropPresetForPanel(index, layout = "3x1") {
    const preset = COVERAGE_CROP_LAYOUTS[layout] || COVERAGE_CROP_LAYOUTS["3x1"];
    const total = preset.cols * preset.rows;
    const panel = Math.max(0, Math.min(total - 1, Number(index) || 0));
    return { x: (panel % preset.cols) * (100 / preset.cols), y: Math.floor(panel / preset.cols) * (100 / preset.rows), w: 100 / preset.cols, h: 100 / preset.rows };
  }
  function coverageCropPanelOptions(layout, selected = 0) {
    const preset = COVERAGE_CROP_LAYOUTS[layout] || COVERAGE_CROP_LAYOUTS["3x1"];
    return Array.from({ length: preset.cols * preset.rows }, (_, index) => `<option value="${index}" ${index === selected ? "selected" : ""}>Panel ${index + 1}</option>`).join("");
  }
  function coverageCropRender() {
    const state = window._coverageCrop;
    if (!state) return;
    const overlay = document.getElementById("coverage-crop-overlay");
    if (overlay) Object.assign(overlay.style, { left: `${state.crop.x}%`, top: `${state.crop.y}%`, width: `${state.crop.w}%`, height: `${state.crop.h}%` });
    for (const key of ["x", "y", "w", "h"]) {
      const input = document.getElementById(`coverage-crop-${key}`);
      if (input) input.value = Math.round(state.crop[key] * 10) / 10;
    }
    const slot = state.slots.find((item) => item.id === state.slotId);
    const label = document.getElementById("coverage-crop-target-label");
    if (label) label.textContent = slot?.label || "Coverage slot";
  }
  function coverageCropBindStage() {
    const stage = document.getElementById("coverage-crop-stage");
    if (!stage || stage._coverageBound) return;
    stage._coverageBound = true;
    let start = null;
    stage.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".coverage-crop-overlay")) return;
      const rect = stage.getBoundingClientRect();
      start = { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
      stage.setPointerCapture?.(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      if (!start || !window._coverageCrop) return;
      const rect = stage.getBoundingClientRect();
      const x2 = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
      const y2 = Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100));
      window._coverageCrop.crop = { x: Math.min(start.x, x2), y: Math.min(start.y, y2), w: Math.max(2, Math.abs(x2 - start.x)), h: Math.max(2, Math.abs(y2 - start.y)) };
      coverageCropRender();
    });
    stage.addEventListener("pointerup", () => { start = null; });
  }
  window.openCoverageSheetExtractor = (list, entityId, fileName, allowHumanOverride = false) => {
    const entity = entityFor(list, entityId);
    const media = entity && entityMedia(list, entity).find((item) => item.name === fileName);
    if (!entity || !media) return toast("Reference sheet is unavailable");
    const row = (entity.candidateFiles || []).find((item) => (item.stored || item.original) === fileName) || {};
    const sheetReview = typeof entityLatestCandidateReview === "function" ? entityLatestCandidateReview(entity, fileName) : null;
    if (!sheetReview?.pass && !row.sheetExtractionOverrideConfirmed && !allowHumanOverride) {
      return openModal(`<div class="coverage-human-override"><span>HUMAN OVERRIDE</span><h3>Crop this sheet without an AI pass?</h3><p>The image has not passed an optional sheet review. You can still crop it by human judgment; CineBraid will record that decision in provenance.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Go back</button><button class="approve-btn" onclick="closeModal();openCoverageSheetExtractor('${attr(list)}','${attr(entityId)}','${attr(fileName)}',true)">CONTINUE TO CROP</button></div></div>`);
    }
    if (!sheetReview?.pass && !row.sheetExtractionOverrideConfirmed && allowHumanOverride) {
      row.sheetExtractionOverrideConfirmed = true;
      row.sheetExtractionOverrideAt = new Date().toISOString();
      dirty();
    }
    const sheetType = row.coverageSheetType || "angles";
    let slots = coverageSheetSlots(list, entity, sheetType);
    if (!slots.length) slots = (typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : entity.coverageSlots || []).slice(0, 4);
    const firstMissing = slots.findIndex((slot) => !slotSelectedFile(slot));
    const firstIndex = firstMissing >= 0 ? firstMissing : 0;
    const layout = sheetType === "expressions" ? "3x2" : "3x1";
    const panelCount = COVERAGE_CROP_LAYOUTS[layout].cols * COVERAGE_CROP_LAYOUTS[layout].rows;
    const panelIndex = Math.max(0, Math.min(panelCount - 1, firstIndex));
    window._coverageCrop = { list, entityId, fileName, url: media.url, sheetType, slots, slotId: slots[firstIndex]?.id || slots[0]?.id || "", layout, panelIndex, crop: cropPresetForPanel(panelIndex, layout), sourceRow: row };
    openModal(`<div class="coverage-extractor-modal"><header><div><span>REFERENCE EXTRACTION</span><h3>${esc(entity.name || entity.id)}</h3><p>Turn one sheet into clean authority views. Select a target, choose the panel, fine-tune only when needed, then save.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><nav class="coverage-extractor-steps" aria-label="Reference extraction steps"><span class="active"><b>1</b> Choose target</span><span class="active"><b>2</b> Crop panel</span><span><b>3</b> Save authority</span></nav><div class="coverage-extractor-layout"><div><div id="coverage-crop-stage" class="coverage-crop-stage"><img id="coverage-crop-source" src="${attr(media.url)}" alt="Reference sheet"><div id="coverage-crop-overlay" class="coverage-crop-overlay"><span id="coverage-crop-target-label"></span></div></div><small>Drag anywhere on the sheet to redraw the crop. The layout and panel controls provide a fast starting point.</small></div><aside><label><span>Save this crop as</span><select id="coverage-crop-slot" onchange="selectCoverageCropSlot(this.value)">${slots.map((slot) => `<option value="${attr(slot.id)}" ${slot.id === window._coverageCrop.slotId ? "selected" : ""}>${esc(slot.label)}${slot.approvedFile ? " · already assigned" : ""}</option>`).join("")}</select></label><div class="coverage-crop-quick-grid"><label><span>Sheet layout</span><select id="coverage-crop-layout" onchange="setCoverageCropLayout(this.value)">${Object.entries(COVERAGE_CROP_LAYOUTS).map(([id,preset]) => `<option value="${id}" ${id === layout ? "selected" : ""}>${preset.label}</option>`).join("")}</select></label><label><span>Panel position</span><select id="coverage-crop-panel" onchange="setCoverageCropPanel(this.value)">${coverageCropPanelOptions(layout,panelIndex)}</select></label></div><div class="coverage-crop-navigation"><button class="ghost-btn" onclick="stepCoverageCropPanel(-1)">← Previous panel</button><button class="ghost-btn" onclick="stepCoverageCropPanel(1)">Next panel →</button></div><div class="coverage-crop-presets"><button onclick="applyCoverageCropPreset()">Reset to panel</button><button onclick="setCoverageCropFull()">Use full image</button></div><details class="coverage-crop-fine"><summary>Fine crop controls</summary><div class="coverage-crop-fields">${["x","y","w","h"].map((key) => `<label><span>${key.toUpperCase()} %</span><input id="coverage-crop-${key}" type="number" min="0" max="100" step="0.5" onchange="setCoverageCropField('${key}',this.value)"></label>`).join("")}</div></details><label><span>Extraction note</span><textarea id="coverage-crop-note" placeholder="Why this panel is authoritative or any limitations."></textarea></label><label class="checkline coverage-direct-override"><input id="coverage-crop-approve" type="checkbox"> Approve this crop immediately by human judgment</label><div class="coverage-review-gate"><b>Review is optional</b><span>Leave the box unchecked to save a candidate for AI or human review. Check it when the panel is already clearly authoritative.</span></div><div class="coverage-crop-provenance"><b>Source sheet</b><span>${esc(fileName)}</span><small>CineBraid stores the crop coordinates, panel layout, and source file so the angle can be traced later.</small></div></aside></div><div class="modal-actions coverage-extractor-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="ghost-btn" onclick="extractCoverageCrop(true)">SAVE CROP & CLOSE</button><button class="approve-btn large" onclick="extractCoverageCrop(false)">SAVE CROP & NEXT ANGLE</button></div></div>`);
    setTimeout(() => { coverageCropRender(); coverageCropBindStage(); }, 30);
  };
  window.selectCoverageCropSlot = (slotId) => {
    const state = window._coverageCrop;
    if (!state) return;
    state.slotId = slotId;
    coverageCropRender();
  };
  window.setCoverageCropLayout = (layout) => {
    const state = window._coverageCrop;
    if (!state || !COVERAGE_CROP_LAYOUTS[layout]) return;
    state.layout = layout;
    state.panelIndex = 0;
    const panel = document.getElementById("coverage-crop-panel");
    if (panel) panel.innerHTML = coverageCropPanelOptions(layout, 0);
    state.crop = cropPresetForPanel(0, layout);
    coverageCropRender();
  };
  window.setCoverageCropPanel = (value) => {
    const state = window._coverageCrop;
    if (!state) return;
    state.panelIndex = Math.max(0, Number(value) || 0);
    state.crop = cropPresetForPanel(state.panelIndex, state.layout);
    coverageCropRender();
  };
  window.stepCoverageCropPanel = (delta) => {
    const state = window._coverageCrop;
    if (!state) return;
    const preset = COVERAGE_CROP_LAYOUTS[state.layout] || COVERAGE_CROP_LAYOUTS["3x1"];
    const total = preset.cols * preset.rows;
    state.panelIndex = (state.panelIndex + Number(delta || 0) + total) % total;
    state.crop = cropPresetForPanel(state.panelIndex, state.layout);
    const panel = document.getElementById("coverage-crop-panel");
    if (panel) panel.value = String(state.panelIndex);
    coverageCropRender();
  };
  window.applyCoverageCropPreset = () => {
    const state = window._coverageCrop;
    if (!state) return;
    state.crop = cropPresetForPanel(state.panelIndex, state.layout);
    coverageCropRender();
  };
  window.setCoverageCropFull = () => { if (window._coverageCrop) { window._coverageCrop.crop = { x: 0, y: 0, w: 100, h: 100 }; coverageCropRender(); } };
  window.setCoverageCropField = (key, value) => {
    const state = window._coverageCrop;
    if (!state) return;
    state.crop[key] = Math.max(key === "w" || key === "h" ? 1 : 0, Math.min(100, Number(value) || 0));
    if (state.crop.x + state.crop.w > 100) state.crop.w = 100 - state.crop.x;
    if (state.crop.y + state.crop.h > 100) state.crop.h = 100 - state.crop.y;
    coverageCropRender();
  };
  window.extractCoverageCrop = async (closeAfter = false) => {
    const state = window._coverageCrop;
    const entity = state && entityFor(state.list, state.entityId);
    const slot = state?.slots.find((item) => item.id === state.slotId);
    const img = document.getElementById("coverage-crop-source");
    if (!state || !entity || !slot || !img?.naturalWidth) return toast("The source sheet is not ready");
    const sx = Math.round(img.naturalWidth * state.crop.x / 100), sy = Math.round(img.naturalHeight * state.crop.y / 100);
    const sw = Math.max(1, Math.round(img.naturalWidth * state.crop.w / 100)), sh = Math.max(1, Math.round(img.naturalHeight * state.crop.h / 100));
    const canvas = document.createElement("canvas"); canvas.width = sw; canvas.height = sh;
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1));
    if (!blob) return toast("Could not create the crop");
    const safeSlot = String(slot.id || "view").replace(/[^a-z0-9]+/gi, "-").toUpperCase();
    const name = `${entity.id}-COVERAGE-${safeSlot}-${Date.now().toString(36).toUpperCase()}.png`;
    const response = await fetch(`/api/media/upload?type=${encodeURIComponent(entityFolder(state.list))}&name=${encodeURIComponent(name)}${projectSlugParam()}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast(data.error || "Could not save the extracted crop");
    const approve = document.getElementById("coverage-crop-approve")?.checked === true;
    if (approve) closeAfter = true;
    const note = document.getElementById("coverage-crop-note")?.value || "";
    entity.candidateFiles = Array.isArray(entity.candidateFiles) ? entity.candidateFiles : [];
    const candidateRow = { stored: data.name, original: data.name, addedAt: new Date().toISOString(), decision: "unreviewed", reviewRequired: !approve, directApprovalRequested: !!approve, targetCoverageSlotId: slot.id, targetCoverageSlotName: slot.label, coverageGroup: state.sheetType === "expressions" ? "expressions" : "angles", coverageCrop: { sourceSheet: state.fileName, layout: state.layout, panelIndex: state.panelIndex, normalized: { ...state.crop }, sourceBuildId: state.sourceRow.sourceBuildId || "", generationJobId: state.sourceRow.generationJobId || "", manuallyAdjusted: true, note }, coverageJobType: "extracted-crop", referenceView: coverageSlotViewTag(state.list, slot) };
    entity.candidateFiles.push(candidateRow);
    SCAN = await fetch("/api/scan").then((r) => r.json());
    updateCoverageTerminalState(state.list, entity);
    dirty();
    rememberWorkspaceSection(entityCoverageSectionKey(state.list, state.entityId, state.sheetType === "expressions" ? "expressions" : "angles"), true);
    const nextSlot = state.slots.find((item) => item.id !== slot.id && !slotSelectedFile(item)) || null;
    closeModal();
    await route();
    if (!closeAfter && nextSlot) {
      setTimeout(() => {
        openCoverageSheetExtractor(state.list, state.entityId, state.fileName);
        setTimeout(() => selectCoverageCropSlot(nextSlot.id), 30);
      }, 40);
      toast(`${slot.label} extracted${approve ? " with human approval requested" : " as a review candidate"} — continue with ${nextSlot.label}`);
    } else {
      toast(approve ? `${slot.label} crop extracted — confirm human approval` : `${slot.label} crop extracted as a review candidate`);
      if (approve) setTimeout(() => approveCoverageCandidate(state.list, state.entityId, data.name, slot.id, true), 60);
      else setTimeout(() => openEntityCandidateReview(state.list, state.entityId, data.name, "state-default"), 60);
    }
  };
  window.openImportedReferenceMapper = (list, entityId) => {
    const entity = entityFor(list, entityId);
    if (!entity) return toast("Reference asset is unavailable");
    /* BATCH 1B: "Use an existing image" IS THE CLAIM SURFACE.

       Ownership authority now requires a durable claim, so a reference a creator
       dropped into the folder by hand is discoverable rather than
       approval-eligible — and this modal is exactly the human act that resolves
       that. It offers both groups, labelled honestly, and confirming the mapping
       writes the candidate row that constitutes the claim. Listing only the
       already-claimed pool here would have made the hand-import route
       unreachable, which is a worse answer than the defect. */
    const owned = entityMedia(list, entity).filter((item) => !isVideo(item.name));
    const unassigned = (typeof entityUnassignedMedia === "function" ? entityUnassignedMedia(list, entity) : []).filter((item) => !isVideo(item.name));
    const media = [...owned, ...unassigned];
    if (!media.length) return toast("Upload or generate reference images first");
    const coverage = ensureCoverageSlots(list, entity).filter((slot) => !slot.retired);
    const expressions = list === "characters" && typeof ensureExpressionSlots === "function" ? ensureExpressionSlots(entity).filter((slot) => !slot.retired) : [];
    const states = typeof entityStateList === "function" ? entityStateListRead(entity, true) : [];
    window._importedReferenceMap = { list, entityId };
    const targetOptions = [
      `<optgroup label="Continuity authority">${states.map((state) => `<option value="state:${attr(state.id)}">${esc(state.name || "Default")} state${state.approvedFile ? ` · currently ${esc(state.approvedFile)}` : ""}</option>`).join("")}</optgroup>`,
      `<optgroup label="Angles / views">${coverage.map((slot) => `<option value="coverage:${attr(slot.id)}">${esc(slot.label)}${slot.approvedFile ? ` · currently ${esc(slot.approvedFile)}` : ""}</option>`).join("")}</optgroup>`,
      expressions.length ? `<optgroup label="Expressions">${expressions.map((slot) => `<option value="expression:${attr(slot.id)}">${esc(slot.label)}${slot.approvedFile ? ` · currently ${esc(slot.approvedFile)}` : ""}</option>`).join("")}</optgroup>` : "",
    ].join("");
    const manualMode = typeof manualFirstWorkflow === "function" && manualFirstWorkflow();
    const visionReady = typeof capabilityState === "function" && !!capabilityState("vision")?.ready;
    const guidance = manualMode
      ? `<div class="prompt-check"><b>Map by human judgment</b><span>The selected file can become the authority for this exact state or view immediately. An optional AI check can be run first when vision assistance is available.</span></div>`
      : `<div class="prompt-check"><b>Choose authority deliberately</b><span>AI checking can compare this image against current authority, but only your assignment makes it authoritative.</span></div>`;
    const actions = manualMode
      ? `${visionReady ? `<button class="ghost-btn" onclick="confirmImportedReferenceMapping(false)">MAP FOR OPTIONAL AI CHECK</button>` : ""}<button class="approve-btn large" onclick="confirmImportedReferenceMapping(true)">MAP & ASSIGN</button>`
      : `<button class="ghost-btn" onclick="confirmImportedReferenceMapping(true)">ASSIGN MANUALLY</button><button class="approve-btn large" onclick="confirmImportedReferenceMapping(false)">MAP & AI CHECK</button>`;
    openModal(`<div class="imported-reference-mapper"><header><div><span>REFERENCE INTAKE</span><h3>Use an existing image</h3><p>Choose the faster path: assign one complete image to a single authority slot, or split a reference sheet into separate views.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="imported-reference-route-cards"><article><span>SINGLE IMAGE</span><b>Assign it directly</b><small>Best for one clean angle, expression, or continuity state.</small><button class="ghost-btn" onclick="document.getElementById('import-reference-target')?.focus()">Choose authority slot</button></article><article class="recommended"><span>REFERENCE SHEET</span><b>Crop individual views</b><small>Best for turnarounds, contact sheets, and multi-angle boards.</small><button class="approve-btn" onclick="cropCurrentImportedReference()">Open crop workspace</button></article></div><div class="two-col imported-reference-fields"><label><span>Existing image</span><select id="import-reference-file" onchange="updateImportedReferencePreview()">${owned.length ? `<optgroup label="Belongs to this reference">${owned.map((item) => `<option value="${attr(item.name)}">${esc(item.name)}</option>`).join("")}</optgroup>` : ""}${unassigned.length ? `<optgroup label="Possible match — assigning it claims it for this reference">${unassigned.map((item) => `<option value="${attr(item.name)}">${esc(item.name)}</option>`).join("")}</optgroup>` : ""}</select></label><label><span>Authority slot for single image</span><select id="import-reference-target">${targetOptions}</select></label></div><div class="imported-reference-preview" id="imported-reference-preview"></div>${guidance}<div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button>${actions}</div></div>`);
    setTimeout(() => updateImportedReferencePreview(), 20);
  };
  window.cropCurrentImportedReference = () => {
    const current = window._importedReferenceMap || {};
    const fileName = document.getElementById("import-reference-file")?.value || "";
    if (!current.list || !current.entityId || !fileName) return toast("Choose an image first");
    closeModal();
    openCoverageSheetPicker(current.list, current.entityId, fileName);
  };
  window.updateImportedReferencePreview = () => {
    const current = window._importedReferenceMap || {};
    const entity = entityFor(current.list, current.entityId);
    const fileName = document.getElementById("import-reference-file")?.value || "";
    const media = entity && entityMedia(current.list, entity).find((item) => item.name === fileName);
    const el = document.getElementById("imported-reference-preview");
    if (el) {
      const primaryReady = !!(entity && primaryReference(current.list, entity));
      const sheetKnown = !!(entity && entityCandidateIsCoverageSheet(entity, fileName));
      el.innerHTML = media ? `<img src="${attr(media.url)}" alt="Imported reference preview"><div class="imported-reference-preview-copy"><b>${esc(media.name)}</b><span>${sheetKnown ? "Recognized as a multi-view sheet. Crop its panels instead of assigning the full sheet to one angle." : "Use this as one authority image, or treat it as a sheet and crop the angles you need."}</span><div class="imported-reference-preview-actions"><button class="approve-btn" onclick="closeModal();openCoverageSheetPicker('${attr(current.list)}','${attr(current.entityId)}','${attr(fileName)}')">CROP ANGLES FROM THIS IMAGE</button>${primaryReady ? `<button class="ghost-btn" onclick="closeModal();openCoverageAutomationModal('${attr(current.list)}','${attr(current.entityId)}','hybrid')">GENERATE MISSING ANGLES</button>` : ""}</div></div>` : "";
    }
  };
  window.confirmImportedReferenceMapping = (directOverride = false) => {
    const current = window._importedReferenceMap || {};
    const entity = entityFor(current.list, current.entityId);
    const fileName = document.getElementById("import-reference-file")?.value || "";
    const target = document.getElementById("import-reference-target")?.value || "";
    if (!entity || !fileName || !target) return toast("Choose an image and a target");
    const [kind, targetId] = target.split(":");
    const row = entityCandidateRow(entity, fileName, true);
    row.importedMapping = { kind, targetId, mappedAt: new Date().toISOString(), source: "existing-project-media" };
    row.decision = "unreviewed";
    row.reviewRequired = !directOverride;
    if (kind === "coverage" || kind === "expression") {
      const slots = kind === "expression" ? ensureExpressionSlots(entity) : ensureCoverageSlots(current.list, entity);
      const slot = slots.find((item) => item.id === targetId);
      if (!slot) return toast("The selected coverage target is unavailable");
      row.targetCoverageSlotId = slot.id;
      row.targetCoverageSlotName = slot.label;
      row.coverageGroup = kind === "expression" ? "expressions" : "angles";
      row.referenceView = coverageSlotViewTag(current.list, slot);
      row.coverageJobType = "imported-reference";
      row.targetStateId = "state-default";
      row.targetStateName = "Default";
      dirty();
      closeModal();
      if (directOverride) return setTimeout(() => approveCoverageCandidate(current.list, current.entityId, fileName, slot.id, true), 30);
      try { localStorage.setItem(entityCandidateFilterKey(current.list, current.entityId), kind === "expression" ? "expressions" : "coverage"); } catch {}
      route();
      return setTimeout(() => openEntityCandidateReview(current.list, current.entityId, fileName, "state-default", "coverage"), 60);
    }
    const state = entityStateById(entity, targetId);
    if (!state) return toast("The selected continuity state is unavailable");
    delete row.targetCoverageSlotId;
    delete row.targetCoverageSlotName;
    delete row.coverageGroup;
    row.targetStateId = state.id;
    row.targetStateName = state.name || "Default";
    dirty();
    closeModal();
    if (directOverride) return setTimeout(() => approveEntityFile(current.list, current.entityId, fileName, state.id), 30);
    try { localStorage.setItem(entityCandidateFilterKey(current.list, current.entityId), "primary-state"); } catch {}
    route();
    setTimeout(() => openEntityCandidateReview(current.list, current.entityId, fileName, state.id, "entity"), 60);
  };
  window.seedCoverageFromPrimary = (list, entityId) => {
    const entity = entityFor(list, entityId);
    const primary = entity && primaryReference(list, entity);
    if (!entity || !primary) return toast("Approve a primary reference first");
    if (typeof entityCandidateIsCoverageSheet === "function" && entityCandidateIsCoverageSheet(entity, primary.name)) return toast("This is a multi-view sheet. Extract its panels instead of assigning the whole sheet to one angle.");
    const slots = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : entity.coverageSlots || [];
    if (list === "characters") {
      const assignable = slots.filter((slot) => ["front", "front-three-quarter", "profile", "rear", "detail-face"].includes(slot.id));
      return openModal(`<div class="primary-angle-assignment-modal"><header><div><span>PRIMARY IDENTITY → ANGLE SLOT</span><h3>Assign ${esc(primary.name)} deliberately</h3><p>The primary image remains the identity authority. Choose an angle only when this exact image clearly matches it.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="primary-angle-assignment-layout"><img src="${attr(primary.url)}" alt="Primary character reference"><div><label><span>Angle represented by this image</span><select id="primary-angle-slot"><option value="">Choose an angle…</option>${assignable.map((slot) => `<option value="${attr(slot.id)}">${esc(slot.label)}</option>`).join("")}</select></label><div class="prompt-check warn"><b>No automatic guess</b><span>CineBraid will not label a frontal primary as 3/4 or any other view without your confirmation.</span></div></div></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="confirmPrimaryCoverageAssignment('${attr(list)}','${attr(entityId)}')">ASSIGN SELECTED ANGLE</button></div></div>`);
    }
    const preferred = ({ props: "hero", vehicles: "front-three-quarter", locations: "establishing" })[list];
    const slot = slots.find((item) => item.id === preferred) || slots[0];
    if (!slot) return;
    /* K1C/K-alpha — SEEDING GOES THROUGH THE ONE SLOT WRITER TOO. This wrote
       `status: "approved"` directly: the primary reference IS canon, but
       pointing a view slot at it does not make the view an approval. The
       selection is real and is recorded; the claim is not. */
    const outcome = assignSlotReference(slot, {
      fileName: primary.name,
      at: new Date().toISOString(),
      via: "seeded-from-primary-reference",
      owner: { project: P, list, entityId: entity.id },
    });
    if (!outcome.assigned) return toast(outcome.message || `${primary.name} could not be assigned to ${slot.label || slot.id}`);
    slot.notes = slot.notes || "Selected from the primary approved reference as a supporting view.";
    slot.provenance = { source: "primary-approved-reference", authoritative: false, seededAt: new Date().toISOString(), explicit: true };
    dirty(); route(); toast(`${slot.label} selected from the primary reference`);
  };
  window.confirmPrimaryCoverageAssignment = (list, entityId) => {
    const entity = entityFor(list, entityId);
    const primary = entity && primaryReference(list, entity);
    const slotId = document.getElementById("primary-angle-slot")?.value || "";
    if (!entity || !primary || !slotId) return toast("Choose the angle represented by this image");
    const slots = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : entity.coverageSlots || [];
    const slot = slots.find((item) => item.id === slotId);
    if (!slot) return toast("Coverage slot is unavailable");
    /* K1C/K-alpha — the character arm of the same seeding act, routed for the
       same reason. The creator naming which angle this image represents is a
       deliberate human act; it is a SELECTION of a supporting view. */
    const assignedAt = new Date().toISOString();
    const outcome = assignSlotReference(slot, {
      fileName: primary.name,
      at: assignedAt,
      via: "primary-angle-assignment",
      owner: { project: P, list, entityId: entity.id },
    });
    if (!outcome.assigned) return toast(outcome.message || `${primary.name} could not be assigned to ${slot.label || slot.id}`);
    slot.notes = slot.notes || "Explicitly selected from the primary identity reference.";
    slot.provenance = { source: "primary-approved-reference", authoritative: false, assignedAt, explicit: true };
    entity.primaryAngleAssignment = { status: "assigned", sourceFile: primary.name, slotId, assignedAt };
    dirty();
    closeModal();
    route();
    toast(`${slot.label} selected from the primary reference`);
  };
  /* Exported the way focused-workspaces.js exports its inspector derivation, and
     for the same reason: this module is the third surface that answers "which
     views does this entity still owe?", and a suite proving three surfaces agree
     is worth nothing if it reimplements one of them. */
  /* primaryReference and coverageAuthorityReferences joined the bag for P4-SEM-C2
     and for the same stated reason. They are the automation-side answer to "which
     approved media does this entity have", and the manual selector is the other
     answer; a suite asserting the two agree has to call both for real. */
  window.__CINEBRAID_COVERAGE_AUTOMATION = { missingCoverageSlots, coverageSheetSlots, updateCoverageTerminalState, primaryReference, historicPrimaryPointer, coverageReferencePackage };
})();
