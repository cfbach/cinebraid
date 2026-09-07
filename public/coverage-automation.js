/* ---------- v6.5.3 coverage automation & sheet extraction ---------- */
(function () {
  const COVERAGE_RUNS = window.COVERAGE_RUNS || (window.COVERAGE_RUNS = new Map());
  const COVERAGE_SUBMISSION_LOCKS = window.COVERAGE_SUBMISSION_LOCKS || (window.COVERAGE_SUBMISSION_LOCKS = new Map());
  function coverageLockKey(list, entityId, kind, target = "") { return `${list}:${entityId}:${kind}:${target}`; }
  function coverageClientRequestId(list, entityId, kind, target = "") { return `coverage:${ACTIVE_PROJECT_SLUG || "project"}:${list}:${entityId}:${kind}:${target}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`; }
  function setCoverageLock(key, value = true) { if (value) COVERAGE_SUBMISSION_LOCKS.set(key, Date.now()); else COVERAGE_SUBMISSION_LOCKS.delete(key); }
  function coverageLocked(key) { return COVERAGE_SUBMISSION_LOCKS.has(key); }
  /* WHICH SLOTS A COVERAGE TASK IS ANSWERABLE TO — THE ONE OWNER.

     A coverage task is identified by its `sheetType`: `expressions` is answerable
     to the expression slots, everything else to the angle board. This function is
     the only place that decides, and every surface that shows, prices, enables,
     stamps, requests or dispatches coverage work reads it.

     THE HOLD REVIEW FOUND WHAT HAPPENS WITHOUT THAT. The expression modal priced
     its quote from the expression slots while startCoverageAutomation derived its
     request list from missingCoverageSlots(), which reads the ANGLE board and
     nothing else. Two owners, one screen, and the disagreement was in both
     directions at once: with expressions complete and one angle missing the quote
     said "no paid request to submit" and the handler submitted an ANGLE job; with
     one expression missing and every angle filled the quote said one paid request
     and the handler submitted nothing. */
  function coverageSlotsForTask(list, entity, sheetType) {
    return list === "characters" && String(sheetType || "") === "expressions"
      ? (typeof ensureExpressionSlots === "function" ? ensureExpressionSlots(entity) : entity?.expressionSlots || [])
      : (typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : entity?.coverageSlots || []);
  }
  /* THE WORK ONE COVERAGE TASK WOULD DO, right now. The quote, the paid control,
     the run stamp, the request list and the dispatch boundary all call this and
     nothing else, so a run cannot be priced against one requirement and submitted
     against another. Required-and-unfilled, exactly as missingCoverageSlots()
     already answered it for angles — isRequiredCoverage() already excludes a
     retired slot, and `!slot.retired` is stated as well because a reader should
     not have to know that. */
  function missingCoverageWork(list, entity, sheetType) {
    return coverageSlotsForTask(list, entity, sheetType)
      .filter((slot) => slot && !slot.retired && isRequiredCoverage(slot) && !slotSelectedFile(slot));
  }
  /* WHICH SLOTS THIS RUN WAS LAUNCHED AGAINST. A run carries its own `sheetType`,
     so the run projection asks the one owner above rather than repeating it. */
  function coverageRunSlots(list, entity, run = entity?.coverageAutomation) {
    return coverageSlotsForTask(list, entity, run?.sheetType);
  }
  /* THE LIVE REQUIREMENT, counted through the one owner. summariseCoverage() is
     what the coverage board prints, so the run and the board cannot report two
     different numbers — which is precisely what the Aug 26 dogfood pass saw. */
  function coverageRunCoverage(list, entity, run = entity?.coverageAutomation) {
    if (!entity) return { known: false };
    if (typeof summariseCoverage !== "function") return { known: false };
    return { known: true, missingRequired: summariseCoverage(coverageRunSlots(list, entity, run)).missingRequired };
  }
  /* WHAT THE RUN LOOKS LIKE RIGHT NOW, for every surface that shows one. This is
     the derivation; nothing persists it and every reader calls it fresh. */
  function coverageRunState(list, entity, run = entity?.coverageAutomation) {
    if (!run || typeof coverageRunReconciliation !== "function") return null;
    return coverageRunReconciliation(run, coverageRunCoverage(list, entity, run));
  }
  /* A WITHIN-RENDER CACHE OF A DERIVATION, and no longer durable in any sense.
   *
   * This used to be the one durable writer of the run's terminal state. It is not any
   * more: entity.coverageAutomation is server-owned, and server.js's prepareSuccessor()
   * restores the authoritative record wholesale over whatever an ordinary save carries.
   * Anything written here is discarded on the next save, deliberately — an independent
   * reviewer showed a generic PUT terminating a live run with a stale completedAt, and
   * "terminating removes privilege" turned out not to make a generic save an authorised
   * lifecycle writer.
   *
   * NOTHING DEPENDS ON THE WRITE. coverageRunReconciliation() derives `completed` from
   * the live requirement for every reader, fresh, whatever the stored word says — see
   * its `goal: "satisfied"` arm. And the run does leave its live state: ingestEntity()
   * moves it when the last job returns, and updateEntityCoverageRun() writes the failure
   * states, both through INTERNAL_NONAUTHORITY_WRITE.
   *
   * Kept because the in-memory value is what the current render reads before the next
   * refresh, and because the states it names are still the states this workflow reaches. */
  function updateCoverageTerminalState(list, entity) {
    if (!entity?.coverageAutomation) return;
    const state = coverageRunState(list, entity);
    if (!state || !state.known) return;
    if (state.goal === "satisfied" && state.status === "completed") {
      entity.coverageAutomation.status = "completed";
      entity.coverageAutomation.completedAt = entity.coverageAutomation.completedAt || new Date().toISOString();
    } else if (state.goal === "outstanding" && COVERAGE_RUN_REVIEW_STATUSES.includes(String(entity.coverageAutomation.status || ""))) {
      entity.coverageAutomation.status = "needs-attention";
    }
    entity.coverageAutomation.missingRequired = state.missingRequired;
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
  /* CORRECTION 2 — WHAT COULD BE GENERATED AND HOW IT IS DESCRIBED ARE DIFFERENT
   * QUESTIONS WITH DIFFERENT OWNERS.
   *
   * The WORK SET is missingCoverageSlots() / missingCoverageWork(), selected through
   * isRequiredCoverage() — the STRUCTURAL coverage plan. It is unchanged by this
   * correction and by the one before it, and it must not shrink because no shot is
   * waiting: an entity's coverage package is a completeness fact, and generating it
   * is exactly what this dialog is for.
   *
   * The WORDS are the other question, and this dialog was answering it with the
   * structural one: "4 required coverage slots still missing", on the same screen
   * as a board whose every chip read Planned and a strip that read NEEDED NOW ·
   * None. One state, two answers, and the louder one was wrong.
   *
   * So the description asks the presentation owner the boards already ask —
   * effectiveReferenceRequirement(), over the pair entityDemandContext() resolves
   * from the two shipped demand owners. NOTHING IS INFERRED IN THIS FILE: it
   * contains no demand derivation of its own, and N12 proves it by breaking
   * effectiveReferenceRequirement() in memory and watching this sentence change.
   *
   * "Required" survives for the case where it is true. When the demand answer
   * cannot be obtained, effectiveReferenceRequirement() still answers `required`,
   * and this says so in the words it always used — cannot-prove-safe is not
   * known-no-demand. */
  function coverageWorkSummary(list, entity, work, sheetType) {
    const expressions = sheetType === "expressions";
    const slotWord = expressions ? "expression" : "coverage";
    const viewWord = expressions ? "expression" : "coverage view";
    const rows = (work || []).filter(Boolean);
    const demand = typeof entityDemandContext === "function" ? entityDemandContext(list, entity) : null;
    const owed = typeof effectiveReferenceRequirement === "function"
      ? rows.filter((slot) => effectiveReferenceRequirement(slot, demand) === "required").length
      : rows.length;
    if (owed) return `${owed} required ${slotWord} slot${owed === 1 ? "" : "s"} still missing.`;
    if (rows.length) return `${rows.length} planned ${viewWord}${rows.length === 1 ? "" : "s"} not filled yet. Nothing is required by current shots.`;
    return `Every ${viewWord} in the coverage plan has an image selected.`;
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
  /* `sheetType` names WHICH KIND OF REFERENCE this slot is, and it is honoured
     rather than assumed. Every contract arm below says "changing only the camera
     angle" — the right instruction for a viewpoint and the wrong one for an
     expression. Until the correction above, an expression slot could never reach
     this function, so the wording was never wrong in practice; now that it can,
     the expression contract is stated, in the SAME sentence the expression SHEET
     path already uses, so there is one wording for the concept. */
  function coverageSlotPrompt(list, entity, slot, userDirection = "", sheetType = "angles") {
    const expressions = list === "characters" && String(sheetType || "") === "expressions";
    const identity = entityIdentityText(list, entity);
    const immutable = String(entity.coverageCharacteristics || entity.driftNotes || entity.coverageNotes || "").trim();
    const contract = expressions
      ? "CHARACTER IDENTITY LOCK: preserve the exact same face, anatomy, proportions, hair, wardrobe construction and accessories. Change only facial expression and subtle performance; do not change identity, hair, wardrobe or accessories."
      : list === "locations"
        ? "SPATIAL CONTINUITY LOCK: all supplied approved images are views of one physical location. Preserve the exact floor plan, topology, wall and opening placement, doors, windows, fixed fixtures, structural landmarks, material boundaries, set dressing and scale relationships. Move only the camera to the requested view. Do not invent, remove, mirror, relocate or redesign architecture."
        : list === "props"
          ? "PROP CONTENT LOCK: preserve the exact object, dimensions, material, construction and wear. Preserve any embedded photograph, mural, artwork, text, label, map, document, print or screen image exactly; do not substitute similar content."
          : list === "characters"
            ? "CHARACTER IDENTITY LOCK: preserve the exact same face, anatomy, proportions, hair, wardrobe construction and accessories while changing only the camera angle."
            : "VEHICLE DESIGN LOCK: preserve exact silhouette, construction, wheels, panels, openings, materials and components while changing only the camera angle.";
    return [
      `Create the ${slot.label} ${expressions ? "expression" : "production"} reference for the exact same ${entityTypeLabel(list)} shown across the supplied reference package.`,
      identity ? `DESIGN DESCRIPTION: ${identity}` : "Preserve every visible identifying feature from every supplied image.",
      immutable ? `IMMUTABLE CHARACTERISTICS: ${immutable}` : "Preserve silhouette, proportions, colors, materials, construction and distinguishing details.",
      contract,
      `${expressions ? "TARGET EXPRESSION" : "TARGET VIEW"}: ${slot.label}. ${slot.notes || ""}`,
      expressions ? "Use head-and-shoulders framing with even lighting and a plain neutral background." : "",
      `The output must be a clean future-generation authority, not a dramatic reinterpretation. The requested ${expressions ? "expression" : "angle"} must be unambiguous. No text labels, borders or watermarks.`,
      userDirection ? `ADDITIONAL DIRECTION: ${userDirection}` : "",
    ].filter(Boolean).join("\n\n");
  }
  async function submitCoverageJob(list, entity, options) {
    /* THE DISPATCH BOUNDARY, AND IT FAILS CLOSED.

       This is the one function that posts to the paid route, and it is reachable
       without any of the surfaces above: startCoverageAutomation reads its mode
       from the DOM, and generateCoverageSlot is a global with no rendered caller
       at all. So the slot a request names is checked against the group the request
       DECLARES, here, rather than trusted from whoever assembled the options.

       This is the leak the hold review found, stopped at the seam that spends the
       money: an expression run whose work set came from the angle board submitted
       an ANGLE slot under `coverageSheetType` "angles" while the dialog beside it
       said no paid request was due.

       IT CHECKS MEMBERSHIP, NOT MISSINGNESS. Deliberately regenerating a slot that
       already holds a file is a real capability and this must not remove it; the
       "is there any work" question belongs to startCoverageAutomation, which asks
       missingCoverageWork() and refuses an empty set before it writes anything. */
    if (options.coverageJobType === "slot") {
      const group = String(options.coverageSheetType || "") === "expressions" ? "expressions" : "angles";
      const slotId = String(options.slot?.id || "");
      const belongs = !!slotId && coverageSlotsForTask(list, entity, group).some((row) => row && String(row.id) === slotId);
      if (!belongs)
        throw new Error(`${options.slot?.label || slotId || "That slot"} is not ${group === "expressions" ? "an expression" : "a coverage"} slot on ${entity.name || entity.id}. Nothing was submitted.`);
    }
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
      /* WHAT THIS PRESS IS, so the server's run record describes the work it is running.
         These group jobs into runs and carry the planner's own quote onto the record;
         none of them grants anything - the surface is the server operation's. */
      coverageMode: options.coverageMode || "",
      ...(Number(options.requestCount) > 0 ? { coverageRequestCount: Number(options.requestCount) } : {}),
      ...(Number(options.maximumImages) > 0 ? { coverageMaximumImages: Number(options.maximumImages) } : {}),
      targetCoverageSlotId: options.slot?.id || "",
      targetCoverageSlotName: options.slot?.label || "",
      coverageSourceFile: primary?.name || "",
      // Explicit provenance for edit/reference jobs. This is not a correction
      // requirement, but it prevents support reports from looking source-less.
      sourceCandidate: primary?.name || "",
      clientRequestId: options.clientRequestId || coverageClientRequestId(list, entity.id, options.coverageJobType || "sheet", options.slot?.id || options.coverageSheetType || ""),
      /* THE VIEW THIS SCREEN WAS SHOWING, and nothing about privilege.
       *
       * `simple` is the narrower of the two readings and it is LOSSLESS here: the coverage
       * surface owns only the candidate count and quality, both production-tier controls
       * that render in either view. The SURFACE is deliberately absent - see below. */
      generationRequest: generationRequestDeclaration({ surface: CINEBRAID_REQUEST_SURFACE_IDS.referenceAutomation, viewMode: "simple" }),
    };
    /* THE COVERAGE OPERATION IS THE SERVER'S, and this asks it to run.
     *
     * This used to POST straight to the paid route carrying `reference-automation` and a
     * coverage run record it had written into the project itself. An independent reviewer
     * showed why that could never be sound: an ordinary project save could author the same
     * record, and then any request could claim the same surface. Neither the record nor
     * the surface is this file's to assert any more.
     *
     * So the browser says what it wants done. /api/generation/fal/coverage/jobs
     * establishes the real run through the server's own writer and dispatches through the
     * same paid boundary with its own context - the request body is unchanged and is
     * still restricted, priced, bounded and prepared exactly once. */
    const response = await fetch("/api/generation/fal/coverage/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
    /* THE MODE SELECT NOW SHOWS THE MODE THE CALLER ASKED FOR. It marked only
       `hybrid` as selected, so the location branch at the top of this function —
       which deliberately chooses `individual`, because a generated location sheet
       can invent incompatible architecture — rendered a dialog whose paid button
       submitted a sheet anyway. A control that takes a different decision from the
       one it names is the same defect family as a status that describes a
       different project from the one on screen. */
    openModal(`<div class="coverage-automation-modal"><header><div><span>COVERAGE AUTOMATION</span><h3>${esc(entity.name || entity.id)}</h3><p>Generate a large multi-view sheet, extract approved crops, and individually regenerate only weak or missing slots.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="coverage-automation-summary"><img src="${attr(primary.url)}" alt="Approved primary reference"><div><b>Approved source</b><span>${esc(primary.name)}</span><small id="coverage-missing-summary">${esc(coverageWorkSummary(list, entity, missingRequired, "angles"))}</small></div></div><div class="two-col"><label><span>Generation mode</span><select id="coverage-mode" onchange="updateCoverageAutomationPlan()"><option value="hybrid" ${defaultMode === "hybrid" ? "selected" : ""}>Hybrid — sheet first, manual missing-view fallback</option><option value="sheet" ${defaultMode === "sheet" ? "selected" : ""}>Sheet first only</option><option value="individual" ${defaultMode === "individual" ? "selected" : ""}>Generate missing slots individually</option></select></label><label><span>Sheet type</span><select id="coverage-sheet-type" onchange="updateCoverageAutomationPlan()"><option value="angles">Angle / viewpoint sheet</option>${expressionOption}</select></label><label><span>Resolution</span><select id="coverage-resolution"><option value="2k">2K</option><option value="4k" selected>4K recommended</option></select></label><label><span>Sheet candidates</span><select id="coverage-output-count" onchange="updateCoverageAutomationPlan()"><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option></select></label></div><label><span>Additional direction</span><textarea id="coverage-direction" placeholder="Panel order, pose constraints, critical details, expression list, or geometry notes.">${esc(entity.coverageGenerationNotes || "")}</textarea></label><div class="coverage-mode-note"><b>${list === "locations" ? "Location guidance" : "Hybrid behavior"}</b><span>${list === "locations" ? "Individual viewpoints are recommended for locations because a single generated sheet may invent incompatible architecture. A sheet remains available when you have a strong layout authority." : "Generate a consistent overview sheet first. Extract useful panels into slots, then generate only any remaining or rejected views individually."}</span></div><div id="coverage-spend-plan" class="coverage-spend-plan"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="coverage-start-button" class="approve-btn large" onclick="startCoverageAutomation()">START COVERAGE GENERATION</button></div></div>`);
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
    /* THE SAME OWNER THE HANDLER USES. This branch used to assemble its own set —
       expression slots one way, angle slots the other — and read `!slot.approvedFile`,
       a key assignSlotReference() DELETES, so every assigned expression priced as
       another paid request. It now asks missingCoverageWork() for this task, which
       is the identical call startCoverageAutomation makes. */
    const work = entity ? missingCoverageWork(req.list, entity, sheetType) : [];
    const missing = work.length;
    const requests = mode === "individual" ? missing : 1;
    const images = mode === "individual" ? requests * 3 : outputs;
    const potential = mode === "hybrid" ? ` · up to ${missing} later individual fallback request${missing === 1 ? "" : "s"}` : "";
    const el = document.getElementById("coverage-spend-plan");
    /* NOTHING TO GENERATE IS A REAL PLAN, and it is the one this dialog used to
       misprice. "Generate missing slots individually" with nothing missing is a
       zero-request submission that the start handler would have thrown on AFTER
       stamping a `starting` run onto the reference — so the quote says so and the
       paid button below is disabled to match. */
    /* THE QUOTE SAYS WHAT IT COSTS, and it does not do the arithmetic itself.
       This plan named a request count and an image count and stopped, so the one
       question a filmmaker asks before a paid button — how much — was answered
       nowhere on the dialog. The number comes from the same owner every other
       paid surface reads (public/shared-generation-rate.js): configuredImageRate()
       reads the configured per-image rate, generationPriceLine() turns it and a
       quantity into a sentence. `images` is the bounded quantity this dialog has
       already derived from missingCoverageWork(), so the quote is priced against
       exactly the work the button beside it will submit.
       An unconfigured rate prints the owner's own "unavailable" line rather than
       a guess, and still says the request is paid. */
    const price = typeof generationPriceLine === "function" && typeof configuredImageRate === "function"
      ? generationPriceLine({ rate: configuredImageRate(typeof CONFIG === "object" ? CONFIG : {}), quantity: images, local: false })
      : null;
    const priceMarkup = price
      ? `<em class="coverage-spend-price is-${attr(price.kind)}" data-coverage-price-kind="${attr(price.kind)}"${price.amount == null ? "" : ` data-coverage-price-amount="${attr(String(price.amount))}"`}>${esc(price.headline)} · ${esc(price.detail)}</em>`
      : "";
    if (el) el.innerHTML = requests
      ? `<b>Confirmed first submission: ${requests} paid request${requests === 1 ? "" : "s"} · up to ${images} image${images === 1 ? "" : "s"}</b><span>${mode === "individual" ? "Each unfilled slot in the coverage plan is submitted separately." : "This submits the sheet only."}${potential}</span>${priceMarkup}`
      : `<b data-coverage-spend-plan="none">No paid request to submit</b><span>Every ${sheetType === "expressions" ? "expression" : "coverage view"} in the coverage plan already has an image selected. Choose a sheet mode to generate new material, or close this dialog.</span>`;
    /* THE CONTROL HEARS THE QUOTE. A derived plan that the button beside it does
       not obey is the same defect as a derived count nobody reads. */
    /* THE HEADER SAYS THE SAME NUMBER AS THE QUOTE. It is rendered once, when the
       dialog opens, from the ANGLE board — so an expression dialog headlined an
       angle count above a quote that had already been corrected to count
       expressions. Same number, said twice, from two owners; it is refreshed here
       from the one owner whenever the task changes. */
    const summary = document.getElementById("coverage-missing-summary");
    if (summary) summary.innerHTML = esc(coverageWorkSummary(req.list, entity, work, sheetType));
    const start = document.getElementById("coverage-start-button");
    if (start && !start.dataset.coverageSubmitting) {
      start.disabled = !requests;
      start.title = requests ? "" : "Nothing in this reference's coverage plan is unfilled.";
    }
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
    /* THE REQUEST LIST IS THE QUOTE'S LIST. This read missingCoverageSlots(), which
       answers for the ANGLE board whatever task the dialog is on — so an expression
       run requested angles, or requested nothing while an expression was missing. */
    const requestedSlots = mode === "individual" ? missingCoverageWork(req.list, entity, sheetType) : [];
    const requestCount = mode === "individual" ? requestedSlots.length : 1;
    const imageCount = mode === "individual" ? requestCount * 3 : outputCount;
    /* THE REFUSAL MOVED IN FRONT OF THE RECORD.
       "Generate missing slots individually" with nothing missing used to stamp a
       `starting` run onto the reference, mark the project dirty, close the dialog
       and THEN throw — leaving a failed coverage run behind for a submission that
       was never possible. Current truth is asked before anything is written, and
       an empty work set is answered as an empty work set. */
    if (!requestCount) return toast(`Every ${sheetType === "expressions" ? "expression" : "coverage view"} in the coverage plan already has an image selected.`);
    if (requestCount > 2 && !spendConfirmed) {
      return confirmModal(`This will submit ${requestCount} paid FAL requests and may return up to ${imageCount} images.`, () => startCoverageAutomation(true), { title: "Confirm coverage generation", confirmLabel: `SUBMIT ${requestCount} REQUESTS` });
    }
    setCoverageLock(lockKey, true);
    const startButton = document.getElementById("coverage-start-button"); if (startButton) { startButton.dataset.coverageSubmitting = "1"; startButton.disabled = true; startButton.textContent = "PREPARING…"; }
    entity.coverageGenerationNotes = direction;
    /* THE RUN RECORD IS NOT WRITTEN HERE ANY MORE. It is server-owned operational state:
       the coverage route establishes it, and server.js's prepareSuccessor() restores the
       authoritative copy over whatever an ordinary save happens to be carrying, so a value
       written here would be discarded on the next save and could never be authoritative.
       What this screen shows about the run comes back from the server with the refresh
       below. */
    rememberWorkspaceSection(entityCoverageSectionKey(req.list, req.entityId, sheetType === "expressions" ? "expressions" : "angles"), true);
    dirty();
    closeModal();
    route();
    try {
      /* THE RUN RECORD HAS TO REACH THE SERVER BEFORE THE FIRST PAID REQUEST DOES.
       *
       * `dirty()` only schedules a save. Every other paid dispatcher in CineBraid already
       * flushes before it POSTs — this one did not, and it did not matter while nothing
       * server-side read the record. It matters now: the paid boundary corroborates the
       * `reference-automation` surface against `entity.coverageAutomation`, and a run
       * whose record is still sitting in a debounce timer would be refused its own
       * surface. Awaited, so a save that fails surfaces here rather than as a puzzling
       * refusal on the request after it. */
      await flushPendingProjectSave();
      if (mode === "sheet" || mode === "hybrid") {
        const slots = coverageSheetSlots(req.list, entity, sheetType);
        const prompt = coverageSheetPrompt(req.list, entity, sheetType, slots, direction);
        const job = await submitCoverageJob(req.list, entity, { prompt, outputCount, resolution, aspectRatio: sheetType === "expressions" ? "4:3" : "16:9", coverageJobType: "sheet", coverageSheetType: sheetType, coverageMode: mode, requestCount, maximumImages: imageCount, clientRequestId: coverageClientRequestId(req.list, req.entityId, "sheet", sheetType) });
        void job;
        toast("Coverage sheet generation queued");
      } else {
        const slots = requestedSlots;
        if (!slots.length) throw new Error("All required coverage slots are already assigned");
        for (const slot of slots) {
          /* THE PAYLOAD SAYS WHICH KIND OF THING IT IS ASKING FOR. `coverageSheetType`
             was hard-coded empty here, which submitCoverageJob defaults to "angles" —
             so a returned expression candidate would have been filed against the angle
             board. The prompt is asked for the same task for the same reason: an
             expression request must not arrive worded as a camera angle. */
          const prompt = coverageSlotPrompt(req.list, entity, slot, direction, sheetType);
          await submitCoverageJob(req.list, entity, { prompt, outputCount: 3, resolution, aspectRatio: referenceAspectLabel(req.list), coverageJobType: "slot", coverageSheetType: sheetType === "expressions" ? "expressions" : "", coverageMode: mode, requestCount, maximumImages: imageCount, slot, clientRequestId: coverageClientRequestId(req.list, req.entityId, "slot", slot.id) });
        }
        toast(`${slots.length} missing coverage slot generation job${slots.length === 1 ? "" : "s"} queued`);
      }
      /* The run the SERVER recorded, read back. Its status and job list are the only
         authoritative ones now, and this screen renders them rather than a local guess. */
      if (typeof load === "function") await load({ intent: "refresh" });
      route();
    } catch (error) {
      /* A failed run is the server's to record too — updateEntityCoverageRun() already
         writes `failed` / `needs-attention` onto the run it owns. This reads the result
         instead of asserting one. */
      if (typeof load === "function") await load({ intent: "refresh" }).catch(() => {});
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
  /* The third copy, now the same one reader. This one was the widest: it tested
     the regex against `row.stored || row.original` and never consulted
     `coverageSheetType` at all, so it disagreed with the other two about the same
     row. Asking the reader is what makes that impossible. */
  function candidateCoverageSheetRows(entity) {
    return (entity.candidateFiles || []).filter((row) => referenceArtifactStructure(row) === "sheet");
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
  /* R4 — AN ACTION RETURNS THE FILMMAKER TO WHERE IT WAS ASKED FOR.
   *
   * "Save crop & use" and "Map & assign" both name a coverage view, do their work
   * on it, and used to leave the filmmaker somewhere else: a re-render of
   * whichever stage happened to be selected, with the coverage detail possibly
   * shut and certainly not scrolled to the slot that had just been filled — or,
   * on the unchecked crop path, on top of a Candidate Review modal nobody asked
   * for. The work landed correctly every time; it was invisible.
   *
   * This writes the three shipped selection keys the coverage stage already
   * reads, so the next render opens on the coverage stage, on the right board,
   * with the target slot selected. It writes NOTHING about the project: these are
   * per-user view selections in localStorage, the same ones the demand panel's
   * own "Open this view" button writes, and they are set BEFORE the caller's
   * route() so one render lands in the right place instead of two.
   *
   * The expression rail is keyed on the entity id alone and the coverage rail on
   * `list:id`; getting that wrong writes a selection nothing reads. */
  function returnToCoverageSlot(list, entityId, group, slotId) {
    const context = `${list}:${entityId}`;
    const expressions = group === "expressions";
    if (typeof boundedWriteFocusedTask === "function") boundedWriteFocusedTask("entity-task", context, "coverage");
    if (typeof boundedWriteState !== "function") return;
    boundedWriteState("selected:entity-coverage-view", context, expressions ? "expressions" : "coverage");
    if (slotId) boundedWriteState(`selected:${expressions ? "expression-slot" : "coverage-slot"}`, expressions ? entityId : context, slotId);
  }
  window.returnToCoverageSlot = returnToCoverageSlot;
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
    /* The sheet workflow's own condition: more than one view on this sheet is
       still empty, so "and then the next one" is a real offer rather than a
       button that reopens the extractor on nothing. */
    const moreToCrop = slots.filter((item) => !slotSelectedFile(item)).length > 1;
    /* R3 — THE CROP IS THE INTERACTION; EVERYTHING ELSE WAS COMPETING WITH IT.
     *
     * This modal exposed eleven controls at once — target, sheet layout, panel
     * position, previous/next, reset, use-full-image, four numeric crop fields, a
     * note, a save-and-use checkbox, a four-line explanation of what the checkbox
     * meant, the source-sheet metadata, and three bottom actions. The good part
     * (drag on the sheet to draw the crop) was surrounded by its own settings.
     *
     * The normal path is now the four things a filmmaker uses every time: WHICH
     * VIEW this becomes, the large draggable crop, previous/next panel, and save.
     * The rest is behind "Fine tune", closed:
     *
     *   sheet layout, panel position  a faster starting rectangle; dragging
     *                                 already reaches every one of them
     *   reset / use full image        recovery, not routine
     *   X / Y / W / H                 numeric equivalents of the drag
     *   extraction note               optional provenance prose
     *   source sheet metadata         a statement of what is stored, not a control
     *
     * NOTHING IS REMOVED. Every id above is still emitted, so
     * setCoverageCropLayout()'s `panel.innerHTML` write, stepCoverageCropPanel()'s
     * `panel.value` write, setCoverageCropField() and coverageCropRender() all
     * still find their elements — a closed <details> hides its contents, it does
     * not withhold them from getElementById. Provenance storage is untouched:
     * extractCoverageCrop() still records the layout, panel index, normalized
     * crop, source sheet and note on the candidate row, and "Save crop & use"
     * still performs the accepted one-action assignment with no second
     * confirmation.
     *
     * THE TARGET LIST NOW ASKS THE OWNER THAT ANSWERS. "· already assigned" hung
     * off `slot.approvedFile` — the key assignSlotReference() DELETES when it
     * writes `selectedFile` (public/shared-entity-slots.js) — so the marker was
     * unreachable for every view filled by the current writer, which is every
     * view a filmmaker has ever assigned. This function already knew better
     * twice: `firstMissing` above and `moreToCrop` below both ask
     * slotSelectedFile(), which is why the extractor opens on the first EMPTY
     * view while the list beside it calls that same view unfilled. One fact,
     * three reads, one of them through a deleted key.
     *
     * The consequence was not cosmetic: a filmmaker cropping a second panel was
     * offered a target that looked free and could overwrite a view they had
     * already assigned, with nothing on screen saying so — the opposite of R8's
     * "the intended slot converges visibly". No owner moves and no state is
     * added; the label now reads the same predicate the rest of the function
     * does. */
    openModal(`<div class="coverage-extractor-modal"><header><div><span>REFERENCE EXTRACTION</span><h3>${esc(entity.name || entity.id)}</h3><p>Turn one sheet into clean authority views. Select a target, choose the panel, fine-tune only when needed, then save.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><nav class="coverage-extractor-steps" aria-label="Reference extraction steps"><span class="active"><b>1</b> Choose target</span><span class="active"><b>2</b> Crop panel</span><span><b>3</b> Save authority</span></nav><div class="coverage-extractor-layout"><div><div id="coverage-crop-stage" class="coverage-crop-stage"><img id="coverage-crop-source" src="${attr(media.url)}" alt="Reference sheet"><div id="coverage-crop-overlay" class="coverage-crop-overlay"><span id="coverage-crop-target-label"></span></div></div><small>Drag anywhere on the sheet to redraw the crop. The layout and panel controls provide a fast starting point.</small></div><aside><label><span>Save this crop as</span><select id="coverage-crop-slot" onchange="selectCoverageCropSlot(this.value)">${slots.map((slot) => `<option value="${attr(slot.id)}" ${slot.id === window._coverageCrop.slotId ? "selected" : ""}>${esc(slot.label)}${slotSelectedFile(slot) ? " · already assigned" : ""}</option>`).join("")}</select></label><div class="coverage-crop-navigation"><button class="ghost-btn" onclick="stepCoverageCropPanel(-1)">← Previous panel</button><button class="ghost-btn" onclick="stepCoverageCropPanel(1)">Next panel →</button></div><div class="coverage-review-gate"><b>Review is optional</b><span>Save crop &amp; use puts this crop into the view above in one action. Save as candidate keeps it without changing the view. Neither is a canon approval, and an AI check can be run afterwards either way.</span></div><details class="coverage-crop-advanced"><summary>Fine tune</summary><div><div class="coverage-crop-quick-grid"><label><span>Sheet layout</span><select id="coverage-crop-layout" onchange="setCoverageCropLayout(this.value)">${Object.entries(COVERAGE_CROP_LAYOUTS).map(([id,preset]) => `<option value="${id}" ${id === layout ? "selected" : ""}>${preset.label}</option>`).join("")}</select></label><label><span>Panel position</span><select id="coverage-crop-panel" onchange="setCoverageCropPanel(this.value)">${coverageCropPanelOptions(layout,panelIndex)}</select></label></div><div class="coverage-crop-presets"><button onclick="applyCoverageCropPreset()">Reset to panel</button><button onclick="setCoverageCropFull()">Use full image</button></div><div class="coverage-crop-fields">${["x","y","w","h"].map((key) => `<label><span>${key.toUpperCase()} %</span><input id="coverage-crop-${key}" type="number" min="0" max="100" step="0.5" onchange="setCoverageCropField('${key}',this.value)"></label>`).join("")}</div><label><span>Extraction note</span><textarea id="coverage-crop-note" placeholder="Why this panel is authoritative or any limitations."></textarea></label><div class="coverage-crop-provenance"><b>Source sheet</b><span>${esc(fileName)}</span><small>CineBraid stores the crop coordinates, panel layout, and source file so the angle can be traced later.</small></div></div></details></aside></div><div class="modal-actions coverage-extractor-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="ghost-btn" onclick="extractCoverageCrop({ assign: false })">SAVE AS CANDIDATE</button>${moreToCrop ? `<button class="ghost-btn" onclick="extractCoverageCrop({ assign: false, next: true })">SAVE & NEXT VIEW</button>` : ""}<button class="approve-btn large" onclick="extractCoverageCrop({ assign: true })">SAVE CROP & USE</button></div></div>`);
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
  /* ALPHA R3 / R8 — THE ATOMIC ACTION IS NAMED ON THE BUTTON THAT PERFORMS IT.
   *
   * "Save crop & use" was already accepted, already atomic and already correct —
   * and it was spelled as a checkbox called "Save this crop and use it for this
   * view" sitting above two buttons that both said SAVE CROP and neither of which
   * said USE. So the one-action path was a two-control path, the filmmaker had to
   * read a four-line explanation to find out which combination assigned, and the
   * commonest outcome of pressing the big button was a candidate they had not
   * asked for.
   *
   * The two acts the brief distinguishes are now the two controls:
   *
   *   SAVE CROP & USE     assign: true   — save, assign the named view, return to
   *                                        Coverage. One press, no confirmation.
   *   SAVE AS CANDIDATE   assign: false  — save, change no view.
   *   SAVE & NEXT VIEW    assign: false  — the candidate path, continued onto the
   *                                        next empty view of the same sheet.
   *                                        This is exactly what the old default
   *                                        button did, kept and renamed.
   *
   * NOTHING BELOW CHANGED SHAPE. The crop, the upload, the candidate row, the
   * provenance, `reviewRequired`, the scan refresh and the coverage hand-off are
   * the same writes in the same order; `approve` is simply read from the caller
   * instead of from a DOM element. A boolean argument is still accepted, meaning
   * what it always meant, so a page mid-session cannot break on an old handler. */
  window.extractCoverageCrop = async (options = false) => {
    const settings = options && typeof options === "object" ? options : { assign: false, next: options !== true };
    const assign = settings.assign === true;
    /* Continuation belongs to the candidate path alone, because an assignment may
       still raise the REPLACE question and reopening the extractor over it would
       bury a decision the filmmaker has to make. */
    const continueToNext = !assign && settings.next === true;
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
    const approve = assign;
    const note = document.getElementById("coverage-crop-note")?.value || "";
    entity.candidateFiles = Array.isArray(entity.candidateFiles) ? entity.candidateFiles : [];
    const candidateRow = { stored: data.name, original: data.name, addedAt: new Date().toISOString(), decision: "unreviewed", reviewRequired: !approve, directApprovalRequested: !!approve, targetCoverageSlotId: slot.id, targetCoverageSlotName: slot.label, coverageGroup: state.sheetType === "expressions" ? "expressions" : "angles", coverageCrop: { sourceSheet: state.fileName, layout: state.layout, panelIndex: state.panelIndex, normalized: { ...state.crop }, sourceBuildId: state.sourceRow.sourceBuildId || "", generationJobId: state.sourceRow.generationJobId || "", manuallyAdjusted: true, note }, coverageJobType: "extracted-crop", referenceView: coverageSlotViewTag(state.list, slot) };
    entity.candidateFiles.push(candidateRow);
    SCAN = await fetch("/api/scan").then((r) => r.json());
    updateCoverageTerminalState(state.list, entity);
    dirty();
    const group = state.sheetType === "expressions" ? "expressions" : "angles";
    rememberWorkspaceSection(entityCoverageSectionKey(state.list, state.entityId, group), true);
    /* R4 — back to the view this crop was made for, whichever branch runs. */
    returnToCoverageSlot(state.list, state.entityId, group, slot.id);
    const nextSlot = state.slots.find((item) => item.id !== slot.id && !slotSelectedFile(item)) || null;
    closeModal();
    await route();
    if (continueToNext && nextSlot) {
      setTimeout(() => {
        openCoverageSheetExtractor(state.list, state.entityId, state.fileName);
        setTimeout(() => selectCoverageCropSlot(nextSlot.id), 30);
      }, 40);
      toast(`${slot.label} extracted as a review candidate — continue with ${nextSlot.label}`);
    } else {
      /* NO SECOND CONFIRMATION, AND THE COPY NO LONGER ASKS FOR ONE.
         The assignment below already completes the filmmaker's explicit
         "approve this crop immediately by human judgment" — it always did — but
         the toast beside it said "confirm human approval", so the one gesture
         read as two and the slot appeared to be waiting on the person who had
         just filled it. It is also called directly rather than through a 60ms
         timer: nothing here is waiting on layout, and a deferred write is a
         write that can be raced by the next navigation.
         approveCoverageCandidate() may still raise a REPLACE confirmation. That
         is a question about displacing a view the slot already holds, which is a
         different question from approving this crop, and it stays. */
      /* R4, THE OTHER HALF. The non-assigning branch — SAVE AS CANDIDATE, and
         before the alpha pass the unticked checkbox — used to open Candidate
         Review on a 60ms timer, and the human pass found that the worst hand-off
         on the screen: the button that had just been pressed said SAVE CROP, not
         REVIEW, and the answer to pressing it was a modal about a decision the
         filmmaker had not asked to make — on top of the Coverage board they had
         been working in, which they then had to dismiss to see the result.

         Candidate Review is not removed and is not harder to reach. It is one
         press away on the candidate's own card ("OPTIONAL AI CHECK", written by
         entities.js's entityCandidateCard), which is where a request to review
         something belongs: on the thing. What changed is that CineBraid no
         longer opens it on the filmmaker's behalf after a save. */
      if (approve) approveCoverageCandidate(state.list, state.entityId, data.name, slot.id, true, { confirmed: true });
      else toast(`${slot.label} crop saved as a candidate — review it from the candidate card whenever you want to`);
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
    /* THE SAME DELETED KEY, ON THE OTHER SURFACE THAT OFFERS A TARGET. Two of the
       three groups below described what a target currently holds by reading
       `slot.approvedFile`, which assignSlotReference() removes — so "Use an
       existing image" listed every assigned view and expression as though it were
       empty. The Continuity authority group above them was RIGHT the whole time,
       because a continuity state genuinely owns an `approvedFile` of its own
       (see public/app.js ensureEntityStateList); slots were renamed to
       `selectedFile` and these two lines were not brought along. One dropdown was
       telling the truth in its first group and not in its other two.
       slotSelectedFile() is the reader for the slot namespace, and is now asked. */
    const targetOptions = [
      `<optgroup label="Continuity authority">${states.map((state) => `<option value="state:${attr(state.id)}">${esc(state.name || "Default")} state${state.approvedFile ? ` · currently ${esc(state.approvedFile)}` : ""}</option>`).join("")}</optgroup>`,
      `<optgroup label="Angles / views">${coverage.map((slot) => `<option value="coverage:${attr(slot.id)}">${esc(slot.label)}${slotSelectedFile(slot) ? ` · currently ${esc(slotSelectedFile(slot))}` : ""}</option>`).join("")}</optgroup>`,
      expressions.length ? `<optgroup label="Expressions">${expressions.map((slot) => `<option value="expression:${attr(slot.id)}">${esc(slot.label)}${slotSelectedFile(slot) ? ` · currently ${esc(slotSelectedFile(slot))}` : ""}</option>`).join("")}</optgroup>` : "",
    ].join("");
    const manualMode = typeof manualFirstWorkflow === "function" && manualFirstWorkflow();
    /* C2 GLOBAL: authority source only — behaviour unchanged. */
    const visionReady = typeof visionCanReview === "function" && visionCanReview(capabilityState("vision"));
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
      /* R4 — "MAP & ASSIGN" IS AN ASSIGNMENT, so it lands on the view it named.
         The other button on this modal is labelled MAP FOR OPTIONAL AI CHECK /
         MAP & AI CHECK, which IS the filmmaker explicitly asking for a review —
         so that branch still opens Candidate Review, and must. The finding is
         about actions that do not ask for a review getting one anyway. */
      if (directOverride) {
        returnToCoverageSlot(current.list, current.entityId, kind === "expression" ? "expressions" : "angles", slot.id);
        return setTimeout(() => approveCoverageCandidate(current.list, current.entityId, fileName, slot.id, true), 30);
      }
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
  /* The run's LIVE state, published for the surfaces that show one. entities.js
     renders the coverage-run banner and must read the same reconciliation this
     module's own dialogs read; a second derivation over there is exactly the
     duplicate truth the Aug 26 pass found. */
  window.coverageRunState = coverageRunState;
  window.__CINEBRAID_COVERAGE_AUTOMATION = { missingCoverageSlots, missingCoverageWork, coverageSheetSlots, coverageSlotsForTask, coverageRunSlots, coverageRunCoverage, coverageRunState, updateCoverageTerminalState, primaryReference, historicPrimaryPointer, coverageReferencePackage, coverageSlotPrompt, submitCoverageJob };
})();
