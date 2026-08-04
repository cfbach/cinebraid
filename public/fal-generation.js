/* ---------- optional fal image generation ---------- */
function falGenerationConfig() {
  return CONFIG?.generation?.fal || {};
}

function falResolutionValue(kind = "frame") {
  const cfg = falGenerationConfig();
  return kind === "blocking" ? (cfg.blockingResolution || "1k") : (cfg.frameResolution || "1k");
}
function falResolutionOptions(selected = "1k") {
  return [["1k", "1K"], ["2k", "2K"], ["4k", "4K"]].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}
function falGenerationReady() {
  const cfg = falGenerationConfig();
  return cfg.enabled === true && Boolean(cfg.apiKey || cfg.keySource === "environment");
}
function falGenerationJob(shotId, purpose, frameId = "") {
  return [...(FAL_GENERATION_JOBS || [])]
    .filter((job) => job.shotId === shotId && job.purpose === purpose && (!frameId || job.frameId === frameId))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}
function falJobActive(job) {
  return !!job && ["SUBMITTING", "SUBMITTED", "IN_QUEUE", "IN_PROGRESS"].includes(job.status);
}
function falJobStatusLabel(job) {
  const map = {
    SUBMITTING: "Submitting",
    SUBMITTED: "Queued",
    IN_QUEUE: job?.queuePosition != null ? `Queued · position ${job.queuePosition}` : "Queued",
    IN_PROGRESS: "Generating",
    COMPLETED: "Results returned",
    FAILED: "Generation failed",
    CANCELLED: "Cancelled",
  };
  return map[job?.status] || String(job?.status || "");
}
function falGenerationInline(shotId, purpose, frameId = "") {
  const job = falGenerationJob(shotId, purpose, frameId);
  if (!job) return "";
  const active = falJobActive(job), done = job.status === "COMPLETED", failed = job.status === "FAILED";
  return `<div class="fal-job-strip ${active ? "active" : done ? "done" : failed ? "failed" : ""}"><div><span>${active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${esc(job.model || "GPT Image 2")}${job.outputCount ? ` · ${job.outputCount} option${job.outputCount === 1 ? "" : "s"}` : ""}${job.error ? ` · ${esc(job.error)}` : ""}</small></div></div><div>${active ? `<button class="chip" onclick="refreshFalGeneration('${job.id}',true)">Refresh</button><button class="chip danger" onclick="cancelFalGeneration('${job.id}')">Cancel</button>` : failed ? `<button class="chip" onclick="openFalGenerationModal('${purpose}','${shotId}','${frameId}')">Try again</button>` : ""}</div></div>`;
}
function falPromptAction(shotId, purpose, frameId, buildId, fallbackDownload) {
  if (!falGenerationReady()) return fallbackDownload || "";
  return `<button class="approve-btn fal-generate-btn" onclick="openFalGenerationModal('${purpose}','${shotId}','${frameId || ""}','${buildId || ""}')">GENERATE</button>`;
}
function falBlockingRevisionPrompt(s, build, sourceAssetId, request) {
  const base = String(build?.prompt || "").trim();
  if (!request) return base;
  const source = sourceAssetId ? "Edit the supplied blocking attempt." : "Create a new blocking attempt.";
  const alreadyCompiled = String(build?.revisionRequest || "").trim() === String(request || "").trim();
  const changes = alreadyCompiled
    ? "The prompt above already incorporates the requested structural changes; preserve them exactly."
    : `Apply these requested structural changes exactly: ${request}`;
  return `${base}\n\nBLOCKING REVISION\n${source} ${changes}\nPreserve all unaffected shot relationships. Keep the result a flat grayscale storyboard scaffold. Do not introduce finished identity, colour, materials, lighting, location design, texture, or production style.`;
}
window.openFalGenerationModal = (purpose, shotId, frameId = "", buildId = "") => {
  const s = shotById(shotId);
  if (!s) return;
  const cfg = falGenerationConfig();
  if (!falGenerationReady()) {
    openModal(`<h3>Connect FAL first</h3><p class="modal-confirm-message">Enable FAL image generation and add the API key in Settings. The key remains on the CineBraid server.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
    return;
  }
  const blocking = purpose === "blocking";
  const frame = frameId ? guidedFrames(s).find((item) => item.id === frameId) : null;
  const state = frame ? guidedFrameState(s, frame, guidedFrames(s).indexOf(frame)) : null;
  const build = blocking
    ? ensureShotCreation(s).blockingBuilds.find((item) => item.id === buildId) || ensureShotCreation(s).blockingBuilds.at(-1)
    : resolvePromptBuild(P, buildId) || latestPromptBuild(P, state?.promptBuilds || []);
  if (!build?.prompt) return toast("Build the prompt first");
  const count = blocking ? Number(cfg.blockingOutputs || 2) : Number(cfg.frameOutputs || 2);
  const quality = blocking ? cfg.blockingQuality || "low" : cfg.frameQuality || "high";
  const resolution = blocking ? falResolutionValue("blocking") : falResolutionValue("frame");
  const revision = blocking ? String(ensureShotCreation(s).blockingRevisionRequest || "").trim() : "";
  const sourceId = blocking ? String(ensureShotCreation(s).blockingRevisionSourceAssetId || "") : "";
  const sourceRow = sourceId ? blockingMediaRows(s).find(({ asset }) => asset.id === sourceId) : null;
  const profile = typeof profileById === "function" ? profileById(build.profileId || "") : null;
  window._falGenerationRequest = { purpose, shotId, frameId, buildId: build.id, packageId: build.packageId || "", prompt: build.prompt, frameLabel: frame?.label || "A", revision, sourceId, profileId: build.profileId || "", profileName: build.profileName || profile?.name || build.profileId || "", profileFamily: profile?.family || "" };
  openModal(`<h3>${blocking ? revision && sourceRow ? "Revise blocking attempt" : "Generate blocking options" : `Generate Frame ${esc(frame?.label || "A")} options`}</h3><div class="modal-sub">FAL · ${esc((build.profileName || build.profileId || "Prompt build").toUpperCase())}${blocking && revision && sourceRow ? " · EDIT" : ""}</div>${blocking && revision ? `<div class="fal-revision-summary"><b>Requested changes</b><p>${esc(revision)}</p>${sourceRow ? `<small>Using ${esc(sourceRow.asset.title || sourceRow.asset.file)} as the editable grayscale scaffold.</small>` : `<small>Generating a fresh blocking attempt from the revised prompt.</small>`}</div>` : ""}<div class="two-col"><label><span>Number of options</span><select id="fal-output-count">${[1,2,3,4].map((n)=>`<option value="${n}" ${n===count?"selected":""}>${n}</option>`).join("")}</select></label><label><span>Quality</span><select id="fal-quality">${["low","medium","high"].map((value)=>`<option value="${value}" ${value===quality?"selected":""}>${value[0].toUpperCase()+value.slice(1)}</option>`).join("")}</select></label><label><span>Resolution</span><select id="fal-resolution">${falResolutionOptions(resolution)}</select></label></div><p class="hint">This submits a paid FAL request. CineBraid will store returned images in this shot and link them to the prompt build.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="startFalGeneration()">START GENERATION</button></div>`);
};
window.startFalGeneration = async () => {
  const request = window._falGenerationRequest;
  if (!request) return;
  const s = shotById(request.shotId), blocking = request.purpose === "blocking";
  const frame = request.frameId ? guidedFrames(s).find((item) => item.id === request.frameId) : null;
  const build = blocking
    ? ensureShotCreation(s).blockingBuilds.find((item) => item.id === request.buildId)
    : resolvePromptBuild(P, request.buildId);
  if (!build) return toast("Prompt build is no longer available");
  let references = [];
  let prompt = build.prompt;
  if (blocking) {
    const c = ensureShotCreation(s), source = request.sourceId ? blockingMediaRows(s).find(({ asset }) => asset.id === request.sourceId) : null;
    prompt = falBlockingRevisionPrompt(s, build, source?.asset.id || "", request.revision);
    if (source && request.revision) references = [{ key: `blocking-revision:${source.asset.id}`, label: source.asset.title || source.asset.file, role: "composition", url: mediaAssetUrl(source.asset) }];
    c.blockingLastRevisionRequest = request.revision || "";
  } else {
    references = (build.references || []).filter((ref) => ref.url).map((ref) => ({ key: ref.key, label: ref.label, role: ref.role, url: ref.url }));
  }
  const body = {
    purpose: request.purpose,
    shotId: request.shotId,
    frameId: request.frameId,
    frameLabel: request.frameLabel,
    sourceBuildId: build.id,
    packageId: build.packageId || "",
    profileId: request.profileId || build.profileId || "",
    profileName: request.profileName || build.profileName || build.profileId || "",
    profileFamily: request.profileFamily || (typeof profileById === "function" ? (profileById(build.profileId || "")?.family || "") : ""),
    prompt,
    references,
    outputCount: Number(document.getElementById("fal-output-count")?.value || 1),
    quality: document.getElementById("fal-quality")?.value || (blocking ? "low" : "high"),
    resolution: document.getElementById("fal-resolution")?.value || (blocking ? falResolutionValue("blocking") : falResolutionValue("frame")),
    aspectRatio: ensureShotCreation(s).composition?.aspectRatio || P.meta?.aspectRatio || "16:9",
    revisionRequest: request.revision || "",
    revisedFromAssetId: request.sourceId || "",
  };
  closeModal();
  keepGuidedPanelOpen(s, blocking ? "blocking" : "");
  try {
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    route();
    toast("FAL generation queued");
    pollFalGeneration(data.job.id);
  } catch (error) { toast("FAL generation failed: " + error.message); route(); }
};

function falEntityGenerationJob(list, entityId, stateId = "") {
  return [...(FAL_GENERATION_JOBS || [])]
    .filter((job) => job.purpose === "entity-reference" && job.entityList === list && job.entityId === entityId && (stateId ? job.continuityStateId === stateId : !job.continuityStateId))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}
function falEntityGenerationInline(list, entityId, stateId = "") {
  const job = falEntityGenerationJob(list, entityId, stateId);
  if (!job) return "";
  const active = falJobActive(job), done = job.status === "COMPLETED", failed = job.status === "FAILED";
  return `<div class="fal-job-strip ${active ? "active" : done ? "done" : failed ? "failed" : ""}"><div><span>${active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${job.continuityStateName ? `${esc(job.continuityStateName)} · ` : ""}${esc(job.model || "GPT Image 2")}${job.outputCount ? ` · ${job.outputCount} candidate${job.outputCount === 1 ? "" : "s"}` : ""}${job.error ? ` · ${esc(job.error)}` : ""}</small></div></div><div>${active ? `<button class="chip" onclick="refreshFalGeneration('${job.id}',true)">Refresh</button><button class="chip danger" onclick="cancelFalGeneration('${job.id}')">Cancel</button>` : failed ? `<button class="chip" onclick="openFalEntityGenerationModal('${list}','${entityId}','','${stateId}')">Try again</button>` : ""}</div></div>`;
}
function falEntityPromptAction(list, entityId, buildId, fallbackDownload = "") {
  if (!falGenerationReady()) return fallbackDownload;
  return `<button class="approve-btn fal-generate-btn" onclick="openFalEntityGenerationModal('${list}','${entityId}','${buildId}')">GENERATE</button>`;
}
function falEntityStatePromptAction(list, entityId, stateId, buildId, fallbackDownload = "") {
  if (!falGenerationReady()) return fallbackDownload;
  return `<div class="inline-action-cluster"><button class="approve-btn fal-generate-btn" onclick="openFalEntityGenerationModal('${list}','${entityId}','${buildId}','${stateId}')">GENERATE STATE</button><button class="chip" onclick="generateMoreEntityStateCandidates('${list}','${entityId}','${stateId}','${buildId}',false)">GENERATE 3 MORE</button><button class="chip" onclick="generateMoreEntityStateCandidates('${list}','${entityId}','${stateId}','${buildId}',true)"${aiDisabledAttrs("text")}>IMPROVE + GENERATE 3</button>${fallbackDownload}</div>`;
}
function entityGenerationAuthorityRefs(list, entity, state = null, mode = "independent") {
  const media = typeof entityMedia === "function" ? entityMedia(list, entity) : [];
  const byName = new Map(media.map((item) => [item.name, item]));
  const refs = [];
  const add = (fileName, key, label, role, instruction) => {
    const item = byName.get(String(fileName || ""));
    if (!item?.url || refs.some((ref) => ref.url === item.url)) return;
    refs.push({ key, label, role, url: item.url, instruction, sourceFile: item.name });
  };
  if (state && !state.isDefault && mode === "derive") {
    const parentInfo = typeof assetStateParentMedia === "function" ? assetStateParentMedia(list, entity, state) : { parent: null, media: null, file: "" };
    if (parentInfo.media) refs.push({
      key: `state-parent:${list}:${entity.id}:${parentInfo.parent?.id || "parent"}`,
      label: `${parentInfo.parent?.name || "Parent state"} approved reference`,
      role: "base",
      url: parentInfo.media.url,
      sourceFile: parentInfo.file || parentInfo.media.name || "",
      instruction: `Exact editable parent for ${state.name || "the target state"}. Preserve the whole image and change only the written state delta.`,
    });
  }
  const defaultState = typeof entityStateList === "function" ? entityStateList(entity, true).find((item) => item.isDefault) : null;
  add(entity.approvedFile || defaultState?.approvedFile, `approved:${list}:${entity.id}`, `${entity.name || entity.id} primary approved authority`, list === "characters" ? "identity" : list === "locations" ? "location" : list === "vehicles" ? "vehicle" : "prop", list === "locations"
    ? "Exact location identity and spatial authority. Preserve fixed architecture, topology, openings, fixtures, landmark placement and proportions."
    : list === "props"
      ? "Exact prop authority. Preserve dimensions, materials, wear and any embedded photograph, artwork, printing, label, screen or document content."
      : "Exact approved identity and design authority.");
  const coverage = [...(entity.coverageSlots || []), ...(entity.expressionSlots || [])]
    .filter((slot) => slot?.approvedFile && !(typeof entityCandidateIsCoverageSheet === "function" && entityCandidateIsCoverageSheet(entity, slot.approvedFile)))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  for (const slot of coverage) add(slot.approvedFile, `approved-view:${slot.id}`, `${slot.label || slot.id} approved authority`, list === "locations" ? "location-geometry" : "approved-view", list === "locations"
    ? `This is another view of the same physical location. Use it to preserve shared geometry and reveal only what the requested camera angle would naturally see.`
    : `Approved ${slot.label || slot.id} view. Preserve design details visible from this side.`);
  return refs;
}
function entityGenerationReferences(list, entity, options = {}) {
  const type = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list];
  const state = options.state || null;
  const mode = options.mode || "independent";
  const refs = entityGenerationAuthorityRefs(list, entity, state, mode);
  const linked = typeof mediaLinksForTarget === "function" ? mediaLinksForTarget(type, entity.id) : [];
  for (const { asset, link } of linked) {
    if (!link.generationInput || !mediaIsImage(asset)) continue;
    const url = mediaAssetUrl(asset);
    if (!url || refs.some((ref) => ref.url === url)) continue;
    refs.push({
      key: `entity-media:${asset.id}`,
      label: asset.title || asset.originalName || asset.file,
      role: mediaPromptRole(link.role),
      url,
      instruction: referenceMetadataInstruction(link),
    });
  }
  return refs.slice(0, 16);
}
function entityGenerationIntegrityContract(list, entity, state, mode) {
  const lines = [
    "AUTHORITY CONTRACT — FAIL THE GENERATION RATHER THAN IMPROVISE",
    "Every supplied approved image depicts the same canonical asset. Treat them as one authority package, not as loose inspiration.",
  ];
  if (state && !state.isDefault && mode === "derive") {
    lines.push("#image1 is the exact editable parent image. Keep its camera, crop, perspective, dimensions, composition and all pixels outside the requested change as stable as the model permits.");
    lines.push(`CHANGE ONLY: ${String(state.notes || "No concrete state delta supplied").trim()}`);
    lines.push("Do not improve, reinterpret, replace, restyle or regenerate unaffected content.");
  }
  if (list === "locations") lines.push("SPATIAL LOCK: preserve the same walls, floor plan, openings, doors, windows, fixed fixtures, structural landmarks, topology, scale relationships, materials and set dressing. A plausible different room is incorrect.");
  if (list === "props") lines.push("OBJECT/CONTENT LOCK: preserve exact object shape, crop, proportions, material, wear and all embedded content. Any photograph, mural, artwork, text, label, map, document, screen image or printed design must remain the exact same content unless the delta explicitly names that content.");
  if (list === "characters") lines.push("IDENTITY LOCK: preserve face, body proportions, anatomy, hair, wardrobe construction, accessories and all unrequested continuity details.");
  if (list === "vehicles") lines.push("VEHICLE LOCK: preserve body construction, silhouette, wheel placement, openings, windows, panels, materials and functional components.");
  return lines.join("\n");
}
function entityGenerationPrompt(list, entity, build, refs, options = {}) {
  const state = options.state || null;
  const mode = options.mode || "independent";
  const legend = refs.map((ref, i) => `#image${i + 1} — ${ref.label}${ref.instruction ? `: ${ref.instruction}` : ""}`).join("\n");
  const contract = entityGenerationIntegrityContract(list, entity, state, mode);
  if (state && !state.isDefault) {
    if (mode === "derive" && refs[0]?.role === "base") {
      const delta = String(state.notes || "").trim();
      const extra = String(state.assetPromptNotes || "").trim();
      const target = build?.profileName || build?.profileId || "image edit";
      return `${contract}

REFERENCE PACKAGE
${legend}

DERIVED STATE EDIT
Edit #image1 directly. The parent image is the source of truth. Apply only the continuity delta below and preserve every unmentioned pixel, object, material, light source, camera choice, crop, and spatial relationship as closely as the model allows.

TARGET STATE
${state.name || "Continuity state"}

REQUIRED DELTA
${delta || "No concrete delta supplied. Do not generate until the state delta is defined."}${extra ? `

ADDITIONAL DIRECTION
${extra}` : ""}

OUTPUT
Return a single clean ${target} production frame at the source aspect ratio. Do not re-describe or re-create the parent state. Do not carry forward exclusions that contradict the required delta.`;
    }
    return `${contract}

${refs.length ? `REFERENCE PACKAGE
${legend}

` : ""}${build.prompt}

Create this state independently only because an approved parent image was unavailable. Preserve all unaffected canon exactly.`;
  }
  if (!refs.length) return build.prompt;
  return `${contract}\n\nREFERENCE PACKAGE\n${legend}\n\nCOMPILED REFERENCE INSTRUCTION\n${build.prompt}`;
}
window.openFalEntityGenerationModal = (list, entityId, buildId = "", stateId = "") => {
  const entity = (P[list] || []).find((item) => item.id === entityId);
  if (!entity) return toast("Entity is unavailable");
  if (!falGenerationReady()) {
    openModal(`<h3>Connect FAL first</h3><p class="modal-confirm-message">Enable FAL image generation and add the API key in Settings. The key remains on the CineBraid server.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
    return;
  }
  const state = stateId ? entityStateById(entity, stateId) : null;
  const builds = state ? assetStatePromptBuilds(state) : assetPromptBuilds(entity);
  const build = builds.find((item) => item.id === buildId) || builds.at(-1);
  if (!build?.prompt) return toast("Build the reference prompt first");
  const requestedMode = state ? assetStateGenerationMode(entity, state) : "independent";
  const parentInfo = state ? assetStateParentMedia(list, entity, state) : null;
  const effectiveMode = state && !state.isDefault && requestedMode === "derive" && parentInfo?.media ? "derive" : "independent";
  const refs = entityGenerationReferences(list, entity, { state, mode: effectiveMode });
  const cfg = falGenerationConfig(), count = Number(cfg.frameOutputs || 2), quality = cfg.frameQuality || "high", resolution = falResolutionValue("frame");
  const typeLabel = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list] || "entity";
  const workspaceAnchor = document.querySelector("details.asset-creation-card");
  window._falEntityGenerationRequest = { list, entityId, buildId: build.id, stateId: state?.id || "", requestedMode, effectiveMode, anchorTop: workspaceAnchor?.getBoundingClientRect?.().top };
  const defaultAspect = list === "characters" ? "3:4" : list === "locations" ? "16:9" : "4:3";
  const stateSummary = state ? `<div class="fal-revision-summary"><b>${esc(state.name || "Continuity state")}</b><p>${esc(state.notes || "No state delta entered.")}</p><small>${effectiveMode === "derive" ? `Editing from ${esc(parentInfo?.parent?.name || "parent state")} · ${esc(parentInfo?.file || "")}` : requestedMode === "derive" ? `The selected parent has no approved image, so this run will create independently.` : "Creating independently from entity canon and the state delta."}</small></div>` : "";
  openModal(`<h3>Generate ${state ? `${esc(state.name || "state")} ` : ""}${esc(typeLabel)} reference candidates</h3><div class="modal-sub">FAL · GPT IMAGE 2${refs.length ? " EDIT / REFERENCE-GUIDED" : " TEXT-TO-IMAGE"}</div>${stateSummary}<div class="candidate-evidence-facts"><span>${esc(entity.id)}</span>${state ? `<span>Target · ${esc(state.name || "State")}</span>` : ""}<span>${refs.length} input${refs.length === 1 ? "" : "s"}</span><span>Candidate only · approval required</span></div><div class="two-col"><label><span>Number of options</span><select id="fal-entity-output-count">${[1,2,3,4].map((n) => `<option value="${n}" ${n === count ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><span>Quality</span><select id="fal-entity-quality">${["low","medium","high"].map((value) => `<option value="${value}" ${value === quality ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></label><label><span>Resolution</span><select id="fal-entity-resolution">${falResolutionOptions(resolution)}</select></label></div><label><span>Aspect ratio</span><select id="fal-entity-aspect">${["1:1","4:3","3:4","16:9","9:16"].map((value) => `<option value="${value}" ${value === defaultAspect ? "selected" : ""}>${value}</option>`).join("")}</select></label><p class="hint">This submits a paid FAL image request. Returned files are added as unapproved ${esc(typeLabel)} candidates${state ? ` targeted to ${esc(state.name || "this state")}` : ""}. They do not become canon until you explicitly approve one.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="startFalEntityGeneration()">START GENERATION</button></div>`);
};

window.generateMoreEntityStateCandidates = async (list, entityId, stateId, buildId = "", improve = false) => {
  const entity = (P[list] || []).find((item) => item.id === entityId);
  const state = entity && stateId ? entityStateById(entity, stateId) : null;
  if (!entity || !state) return toast("Continuity state is unavailable");
  if (!falGenerationReady()) return toast("Enable FAL generation first");
  if (improve) {
    if (!capabilityState("text").ready) return toast(capabilityState("text").message || "The text assistant is unavailable.");
    await buildEntityStatePrompt(list, entityId, stateId, true);
  }
  const builds = state ? assetStatePromptBuilds(state) : assetPromptBuilds(entity);
  const build = (buildId && builds.find((item) => item.id === buildId)) || builds.at(-1);
  if (!build?.prompt) return toast("Build the state prompt first");
  const requestedMode = state ? assetStateGenerationMode(entity, state) : "independent";
  const parentInfo = state ? assetStateParentMedia(list, entity, state) : null;
  const effectiveMode = state && !state.isDefault && requestedMode === "derive" && parentInfo?.media ? "derive" : "independent";
  const references = entityGenerationReferences(list, entity, { state, mode: effectiveMode });
  const body = {
    purpose: "entity-reference",
    entityList: list,
    entityId: entity.id,
    entityType: { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list] || "entity",
    continuityStateId: state?.id || "",
    continuityStateName: state?.name || "",
    parentStateId: parentInfo?.parent?.id || "",
    parentStateName: parentInfo?.parent?.name || "",
    parentApprovedFile: effectiveMode === "derive" ? parentInfo?.file || "" : "",
    derivationMode: effectiveMode,
    sourceBuildId: build.id,
    profileId: build.profileId || "",
    profileName: build.profileName || build.profileId || "",
    profileFamily: typeof profileById === "function" ? (profileById(build.profileId || "")?.family || "") : "",
    prompt: entityGenerationPrompt(list, entity, build, references, { state, mode: effectiveMode }),
    references,
    outputCount: 3,
    quality: falGenerationConfig().frameQuality || "high",
    resolution: falResolutionValue("frame"),
    aspectRatio: list === "characters" ? "3:4" : list === "locations" ? "16:9" : "4:3",
  };
  try {
    await flushPendingProjectSave();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start state generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    route();
    toast(improve ? "State prompt improved and 3 new candidates queued" : "3 new state candidates queued");
    pollFalGeneration(data.job.id);
  } catch (error) {
    toast("State generation failed: " + error.message);
    route();
  }
};

window.startFalEntityGeneration = async () => {
  const request = window._falEntityGenerationRequest || {};
  const stableAnchorTop = Number.isFinite(request.anchorTop) ? request.anchorTop : document.querySelector("details.asset-creation-card")?.getBoundingClientRect?.().top;
  const entity = (P[request.list] || []).find((item) => item.id === request.entityId);
  const state = entity && request.stateId ? entityStateById(entity, request.stateId) : null;
  const builds = entity ? (state ? assetStatePromptBuilds(state) : assetPromptBuilds(entity)) : [];
  const build = builds.find((item) => item.id === request.buildId);
  if (!entity || !build?.prompt) return toast("Reference prompt is unavailable");
  const parentInfo = state ? assetStateParentMedia(request.list, entity, state) : null;
  const effectiveMode = state && !state.isDefault && request.requestedMode === "derive" && parentInfo?.media ? "derive" : "independent";
  const references = entityGenerationReferences(request.list, entity, { state, mode: effectiveMode });
  const body = {
    purpose: "entity-reference",
    entityList: request.list,
    entityId: entity.id,
    entityType: { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[request.list] || "entity",
    continuityStateId: state?.id || "",
    continuityStateName: state?.name || "",
    parentStateId: parentInfo?.parent?.id || "",
    parentStateName: parentInfo?.parent?.name || "",
    parentApprovedFile: effectiveMode === "derive" ? parentInfo?.file || "" : "",
    derivationMode: effectiveMode,
    sourceBuildId: build.id,
    profileId: build.profileId || "",
    profileName: build.profileName || build.profileId || "",
    profileFamily: typeof profileById === "function" ? (profileById(build.profileId || "")?.family || "") : "",
    prompt: entityGenerationPrompt(request.list, entity, build, references, { state, mode: effectiveMode }),
    references,
    outputCount: Number(document.getElementById("fal-entity-output-count")?.value || 1),
    quality: document.getElementById("fal-entity-quality")?.value || "high",
    resolution: document.getElementById("fal-entity-resolution")?.value || falResolutionValue("frame"),
    aspectRatio: document.getElementById("fal-entity-aspect")?.value || "4:3",
  };
  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start entity generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    // Keep the open reference builder stable; polling will refresh job state without collapsing or shifting the workspace.
    toast("FAL entity reference generation queued");
    const restoreReferenceBuilderPosition = () => {
      if (!Number.isFinite(stableAnchorTop)) return;
      const anchor = document.querySelector("details.asset-creation-card");
      if (!anchor) return;
      const delta = anchor.getBoundingClientRect().top - stableAnchorTop;
      if (Math.abs(delta) > 1) window.scrollBy?.(0, delta);
    };
    setTimeout(restoreReferenceBuilderPosition, 80);
    setTimeout(restoreReferenceBuilderPosition, 420);
    pollFalGeneration(data.job.id);
  } catch (error) {
    toast("Entity generation failed: " + error.message);
    route();
  }
};

window.startCandidateCorrectionGeneration = async () => {
  const draft = window._candidateCorrectionDraft || {};
  const s = shotById(draft.shotId), frame = s ? frameById(s, draft.frameId) : null;
  if (!s || !frame) return toast("Correction source is unavailable");
  const build = typeof finalizeCandidateCorrectionDraft === "function" ? finalizeCandidateCorrectionDraft() : resolvePromptBuild(P, draft.buildId);
  if (!build || build.missing || !build.prompt) return toast("Correction instructions are unavailable");
  const references = (build.references || []).filter((ref) => ref.url).slice(0, 16).map((ref, index) => ({
    key: ref.key || `image-${index + 1}`,
    token: `#image${index + 1}`,
    originalToken: ref.originalToken || "",
    label: ref.label || `Image ${index + 1}`,
    role: ref.role || "reference",
    instruction: ref.instruction || "",
    url: ref.url,
  }));
  if (!references.length || references[0].role !== "base") return toast("The editable candidate input is missing from the correction package");
  const body = {
    purpose: "correction",
    shotId: s.id,
    frameId: frame.id,
    frameLabel: frame.label || "A",
    sourceBuildId: build.id,
    packageId: build.packageId || "",
    profileId: build.profileId || "",
    profileName: build.profileName || build.profileId || "",
    profileFamily: typeof profileById === "function" ? (profileById(build.profileId || "")?.family || "") : "",
    parentBuildId: build.parentBuildId || "",
    parentPackageId: build.parentPackageId || "",
    sourceCandidate: build.sourceCandidate || draft.name || "",
    guideAssetId: build.guideAssetId || "",
    prompt: build.prompt,
    references,
    outputCount: Number(document.getElementById("candidate-correction-output-count")?.value || falGenerationConfig().frameOutputs || 1),
    quality: document.getElementById("candidate-correction-quality")?.value || falGenerationConfig().frameQuality || "high",
    resolution: document.getElementById("candidate-correction-resolution")?.value || falResolutionValue("frame"),
    aspectRatio: ensureShotCreation(s).composition?.aspectRatio || P.meta?.aspectRatio || "16:9",
  };
  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start correction generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    route();
    toast("FAL correction queued");
    pollFalGeneration(data.job.id);
  } catch (error) {
    toast("Correction generation failed: " + error.message);
    route();
  }
};

window.refreshCandidateCorrectionGeneration = async (jobId) => {
  const job = await refreshFalGeneration(jobId, true);
  if (!job) return;
  const buildId = job.sourceBuildId || "";
  setTimeout(() => openCandidateCorrectionModal(job.shotId, job.frameId, job.sourceCandidate || "", buildId), 0);
};

window.cancelCandidateCorrectionGeneration = async (jobId) => {
  await cancelFalGeneration(jobId);
  const job = (FAL_GENERATION_JOBS || []).find((item) => item.id === jobId);
  if (job) setTimeout(() => openCandidateCorrectionModal(job.shotId, job.frameId, job.sourceCandidate || "", job.sourceBuildId || ""), 0);
};

window.refreshFalGeneration = async (jobId, manual = false) => {
  try {
    const response = await fetch(`/api/generation/fal/jobs/${encodeURIComponent(jobId)}/refresh`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not refresh generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== jobId), data.job];
    if (data.job.status === "COMPLETED") {
      const blockingIds = (data.job.outputs || []).filter((out) => out.type === "blocking").map((out) => out.assetId);
      await load();
      toast(`${(data.job.outputs || []).length} FAL image${(data.job.outputs || []).length === 1 ? "" : "s"} returned`);
      if (blockingIds.length) setTimeout(() => openBlockingNamingModal(data.job.shotId, blockingIds), 0);
      return data.job;
    }
    if (manual) route();
    if (manual) toast(falJobStatusLabel(data.job));
    return data.job;
  } catch (error) { if (manual) toast("Could not refresh generation: " + error.message); return null; }
};
window.pollFalGeneration = async (jobId) => {
  const job = await refreshFalGeneration(jobId, false);
  if (job && falJobActive(job)) setTimeout(() => pollFalGeneration(jobId), 3500);
};
window.cancelFalGeneration = async (jobId) => {
  const response = await fetch(`/api/generation/fal/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) return toast(data.error || "Could not cancel generation");
  FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== jobId), data.job];
  route(); toast("Generation cancelled");
};
window.resumeFalGenerationPolling = () => {
  for (const job of FAL_GENERATION_JOBS || []) if (falJobActive(job)) pollFalGeneration(job.id);
};

/* ---------- MiniMax H3 motion generation on FAL ---------- */
function falH3MotionJob(shotId) {
  return [...(FAL_GENERATION_JOBS || [])]
    .filter((job) => job.purpose === "motion-h3" && job.shotId === shotId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}
function falH3MotionInline(shotId) {
  const job = falH3MotionJob(shotId);
  if (!job) return "";
  const active = falJobActive(job), done = job.status === "COMPLETED", failed = job.status === "FAILED";
  return `<div class="fal-job-strip h3 ${active ? "active" : done ? "done" : failed ? "failed" : ""}"><div><span>${active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${esc(job.profileName || "MiniMax H3")} · ${esc(String(job.profileMode || "motion").toUpperCase())}${job.durationSeconds ? ` · ${job.durationSeconds}s` : ""}${job.error ? ` · ${esc(job.error)}` : ""}</small></div></div><div>${active ? `<button class="chip" onclick="refreshFalGeneration('${job.id}',true)">Refresh</button><button class="chip danger" onclick="cancelFalGeneration('${job.id}')">Cancel</button>` : failed ? `<button class="chip" onclick="openFalH3MotionModal('${job.shotId}','${job.sourceBuildId || ""}')">Try again</button>` : ""}</div></div>`;
}
function falH3MotionPromptAction(shotId, buildId, profile) {
  if (!falGenerationReady() || profile?.family !== "minimax-h3") return "";
  return `<button class="approve-btn h3-generate-btn" onclick="openFalH3MotionModal('${shotId}','${buildId}')">GENERATE H3 VIDEO</button>`;
}
function falH3CostEstimate(duration, imageCount, videoCount, resolution = "2K") {
  const seconds = Math.max(5, Math.min(15, Number(duration || 5)));
  const base2K = seconds * 0.26;
  const extraImages = Math.max(0, Number(imageCount || 0) - 5) * 0.08;
  const total = base2K + extraImages;
  const resolutionNote = String(resolution).toUpperCase() === "2K"
    ? "Current public 2K rate"
    : "2K-rate reference; verify the current 768P rate on FAL";
  return {
    total,
    label: `${resolutionNote}: about $${total.toFixed(2)} USD`,
    detail: `${seconds}s output${extraImages ? ` + $${extraImages.toFixed(2)} for ${Math.max(0, imageCount - 5)} image${imageCount - 5 === 1 ? "" : "s"} beyond the first five` : ""}${videoCount ? "; reference-video usage is billed separately" : ""}. Pricing can change before submission.`,
  };
}
window.updateFalH3CostEstimate = () => {
  const request = window._falH3MotionRequest || {};
  const duration = Number(document.getElementById("fal-h3-duration")?.value || request.duration || 5);
  const resolution = document.getElementById("fal-h3-resolution")?.value || "2K";
  const refs = request.references || [];
  const images = refs.filter((ref) => ref.mediaType === "image").length;
  const videos = refs.filter((ref) => ref.mediaType === "video").length;
  const estimate = falH3CostEstimate(duration, images, videos, resolution);
  const target = document.getElementById("fal-h3-cost-estimate");
  if (target) target.innerHTML = `<b>${esc(estimate.label)}</b><span>${esc(estimate.detail)}</span>`;
};
window.updateFalH3PromptEditor = () => {
  const request = window._falH3MotionRequest || {};
  const editor = document.getElementById("fal-h3-prompt-editor");
  const prompt = String(editor?.value ?? request.prompt ?? "");
  request.prompt = prompt;
  const count = document.getElementById("fal-h3-prompt-count");
  const fact = document.getElementById("fal-h3-prompt-fact");
  const submit = document.getElementById("fal-h3-submit");
  const warning = document.getElementById("fal-h3-prompt-warning");
  const changed = prompt.trim() !== String(request.originalPrompt || "").trim();
  if (count) {
    count.textContent = `${prompt.length.toLocaleString()}/2,000`;
    count.classList.toggle("over", prompt.length > 2000);
  }
  if (fact) fact.textContent = `${prompt.length.toLocaleString()}/2,000 prompt characters${changed ? " · edited" : ""}`;
  if (warning) {
    warning.hidden = !!prompt.trim() && prompt.length <= 2000;
    warning.querySelector("small").textContent = !prompt.trim()
      ? "Enter a prompt before submitting a paid request."
      : "Shorten this prompt to 2,000 characters before a paid submission.";
  }
  if (submit) submit.disabled = !prompt.trim() || prompt.length > 2000 || window._falH3Submitting;
};
window.resetFalH3PromptEditor = () => {
  const request = window._falH3MotionRequest || {};
  const editor = document.getElementById("fal-h3-prompt-editor");
  if (editor) editor.value = request.originalPrompt || "";
  updateFalH3PromptEditor();
};
window.openFalH3MotionModal = (shotId, buildId = "") => {
  const s = shotById(shotId), c = s && ensureShotCreation(s);
  if (!s || !c) return toast("Shot is unavailable");
  if (!falGenerationReady()) {
    openModal(`<h3>Connect FAL first</h3><p class="modal-confirm-message">Enable FAL generation and add the API key in Settings. The key remains on the CineBraid server.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
    return;
  }
  const builds = resolvePromptBuildList(P, c.motionPromptBuilds || []);
  const build = builds.find((item) => item.id === buildId) || builds.at(-1);
  if (!build?.prompt) return toast("Build the MiniMax H3 prompt first");
  const profile = typeof profileById === "function" ? profileById(build.profileId || "") : (PROMPT_LIBRARY?.profiles || []).find((item) => item.id === build.profileId);
  if (profile?.family !== "minimax-h3") return toast("Select and build a MiniMax H3 motion profile first");
  const refs = (build.references || []).filter((ref) => ref.url).map((ref, index) => ({
    key: ref.key || `reference-${index + 1}`,
    token: ref.token || "",
    label: ref.label || ref.name || `Reference ${index + 1}`,
    role: ref.role || "reference",
    mediaType: ref.mediaType || (/\.(mp4|mov|m4v|webm)(?:$|[?#])/i.test(ref.url) ? "video" : /\.(wav|mp3|m4a|ogg|aac|flac)(?:$|[?#])/i.test(ref.url) ? "audio" : "image"),
    instruction: ref.instruction || "",
    url: ref.url,
  }));
  const duration = Math.max(5, Math.min(15, Number(build.durationSeconds || c.motionDuration || 5) || 5));
  const ratio = profile.mode === "r2v" ? (P.meta?.aspectRatio || "adaptive") : (P.meta?.aspectRatio || "16:9");
  const clientRequestId = `h3-${shotId}-${build.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  window._falH3MotionRequest = { shotId, buildId: build.id, profileId: profile.id, profileName: profile.name, profileMode: profile.mode, prompt: build.prompt, originalPrompt: build.prompt, references: refs, packageId: build.packageId || "", duration, aspectRatio: ratio, clientRequestId };
  window._falH3Submitting = false;
  const images = refs.filter((ref) => ref.mediaType === "image");
  const videos = refs.filter((ref) => ref.mediaType === "video");
  const audio = refs.filter((ref) => ref.mediaType === "audio");
  // Show the actual provider image order, including non-keyframe identity or
  // location references. This prevents a misleading independent renumbering.
  const sequenceRows = images.map((ref, index) => `<li><b>Image ${index + 1}</b><span>${esc(ref.label)} · ${esc(String(ref.role || "reference").replace(/-/g," "))}${ref.instruction ? ` · ${esc(ref.instruction)}` : ""}</span></li>`).join("");
  const promptReady = build.prompt.length <= 2000;
  openModal(`<div class="h3-generation-modal"><header class="h3-generation-head"><div><span>MINIMAX H3 · PAID GENERATION</span><h3>Generate with ${esc(profile.name)}</h3><p>Confirm provider inputs, output settings, prompt length, and estimated spend before submission.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="h3-generation-scroll"><div class="modal-sub">FAL · ${esc(profile.falEndpoint || "minimax/h3")}</div><div class="candidate-evidence-facts"><span>${images.length} image${images.length === 1 ? "" : "s"}</span><span>${videos.length} video${videos.length === 1 ? "" : "s"}</span><span>${audio.length} audio</span><span id="fal-h3-prompt-fact">${build.prompt.length.toLocaleString()}/2,000 prompt characters</span><span>Native stereo audio</span></div>${sequenceRows ? `<section class="h3-submit-sequence"><b>Actual FAL image order</b><small>This is the exact Image 1–N order sent to the provider.</small><ol>${sequenceRows}</ol></section>` : ""}<section class="h3-generation-settings"><h4>Output settings</h4><div class="h3-settings-grid"><label><span>Duration</span><select id="fal-h3-duration" onchange="updateFalH3CostEstimate()">${Array.from({length:11},(_,i)=>i+5).map((n)=>`<option value="${n}" ${n===duration?"selected":""}>${n} seconds</option>`).join("")}</select></label><label><span>Resolution</span><select id="fal-h3-resolution" onchange="updateFalH3CostEstimate()"><option value="2K" selected>2K</option><option value="768P">768P</option></select></label>${profile.mode === "r2v" || profile.mode === "t2v" ? `<label><span>Aspect ratio</span><select id="fal-h3-aspect">${["adaptive","21:9","16:9","4:3","1:1","3:4","9:16"].filter((value)=>profile.mode === "r2v" || value !== "adaptive").map((value)=>`<option value="${value}" ${value===ratio?"selected":""}>${value}</option>`).join("")}</select></label>` : ""}</div></section><div id="fal-h3-cost-estimate" class="h3-cost-estimate"></div><div id="fal-h3-prompt-warning" class="guided-prompt-error" ${promptReady ? "hidden" : ""}><div><b>Prompt is not ready for submission</b><small>${promptReady ? "" : "Shorten this prompt to 2,000 characters before a paid submission."}</small></div></div><section class="h3-prompt-editor"><header><div><b>Edit prompt before generation</b><small>The compiled package remains preserved. Any changes used for generation are saved as a linked manual revision.</small></div><span id="fal-h3-prompt-count">${build.prompt.length.toLocaleString()}/2,000</span></header><textarea id="fal-h3-prompt-editor" oninput="updateFalH3PromptEditor()">${esc(build.prompt)}</textarea><div class="h3-prompt-editor-actions"><label><span>Revision note · optional</span><input id="fal-h3-prompt-edit-reason" placeholder="Clarified timing, removed duplicate action…"></label><button class="ghost-btn" onclick="resetFalH3PromptEditor()">Reset compiled prompt</button></div></section><p class="hint">This submits one paid MiniMax H3 request through FAL. The returned MP4 is saved as an unapproved video candidate in this shot. The request uses an idempotency key to prevent an accidental double submission from this dialog.</p></div><footer class="modal-actions h3-generation-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="fal-h3-submit" class="approve-btn large" onclick="startFalH3MotionGeneration()" ${promptReady ? "" : "disabled"}>START H3 GENERATION</button></footer></div>`);
  setTimeout(() => { updateFalH3CostEstimate(); updateFalH3PromptEditor(); }, 0);
};
window.startFalH3MotionGeneration = async () => {
  const request = window._falH3MotionRequest;
  if (!request || window._falH3Submitting) return;
  const editedPrompt = String(document.getElementById("fal-h3-prompt-editor")?.value ?? request.prompt ?? "").trim();
  if (!editedPrompt) return toast("Enter a MiniMax H3 prompt before generation");
  if (editedPrompt.length > 2000) return toast("MiniMax H3 prompt exceeds the current 2,000-character FAL schema limit");
  request.prompt = editedPrompt;
  const revisionReason = String(document.getElementById("fal-h3-prompt-edit-reason")?.value || "Edited in the MiniMax H3 generation preflight").trim();
  if (editedPrompt !== String(request.originalPrompt || "").trim() && typeof createManualMotionPromptRevision === "function") {
    try {
      const revised = createManualMotionPromptRevision(request.shotId, request.buildId, editedPrompt, revisionReason);
      if (revised?.id) {
        request.buildId = revised.id;
        request.packageId = revised.packageId || request.packageId;
        request.profileId = revised.profileId || request.profileId;
        request.profileName = revised.profileName || request.profileName;
      }
    } catch (error) {
      return toast("Could not preserve the edited prompt revision: " + error.message);
    }
  }
  window._falH3Submitting = true;
  const button = document.getElementById("fal-h3-submit");
  if (button) { button.disabled = true; button.textContent = "SUBMITTING…"; }
  const body = {
    purpose: "motion-h3",
    clientRequestId: request.clientRequestId,
    shotId: request.shotId,
    sourceBuildId: request.buildId,
    packageId: request.packageId,
    profileId: request.profileId,
    profileName: request.profileName,
    profileFamily: "minimax-h3",
    profileMode: request.profileMode,
    prompt: request.prompt,
    references: request.references,
    outputCount: 1,
    durationSeconds: Number(document.getElementById("fal-h3-duration")?.value || request.duration || 5),
    resolution: document.getElementById("fal-h3-resolution")?.value || "2K",
    aspectRatio: document.getElementById("fal-h3-aspect")?.value || request.aspectRatio || (request.profileMode === "r2v" ? "adaptive" : "16:9"),
  };
  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start MiniMax H3 generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    route();
    toast(data.reused ? "Reattached to the existing MiniMax H3 request; no duplicate charge was submitted" : "MiniMax H3 video queued on FAL");
    pollFalGeneration(data.job.id);
  } catch (error) {
    toast("MiniMax H3 generation failed: " + error.message);
    route();
  } finally {
    window._falH3Submitting = false;
  }
};

