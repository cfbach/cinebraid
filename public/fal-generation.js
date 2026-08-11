/* ---------- optional fal image generation ---------- */
function falGenerationConfig() {
  return CONFIG?.generation?.fal || {};
}

function falResolutionValue(kind = "frame") {
  const cfg = falGenerationConfig();
  return kind === "blocking" ? (cfg.blockingResolution || "1k") : (cfg.frameResolution || "1k");
}
/* The saved MiniMax H3 resolution. Read here rather than written into each dialog so
   the "H3 default resolution" field in Settings is the only thing that decides what the
   paid motion dialog opens at. */
function falH3ResolutionValue() {
  const saved = String(falGenerationConfig().h3Resolution || "").toUpperCase();
  return ["768P", "2K"].includes(saved) ? saved : "2K";
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
    /* Deliberately not a variety of "failed". The filmmaker's next move after a failure
       is to generate again, and that is the one move that can buy this shot twice. */
    UNRESOLVED: "Submission status unknown",
    ORPHANED: "Ran at the provider · not collected here",
  };
  return map[job?.status] || String(job?.status || "");
}
/* Where CineBraid does not know what happened to a paid request. */
function falJobUnresolved(job) {
  return String(job?.status || "") === "UNRESOLVED";
}
/* Plain language, no jargon, no stack traces, and no reassurance CineBraid cannot give.
   It says what was done, what is unknown, and what to do about it. */
function falUnresolvedExplanation(job) {
  const where = job?.model ? ` (${job.model})` : "";
  return `CineBraid sent this request to the provider${where} but lost contact before it could confirm whether it was accepted. The generation may be running and may have been charged. Check the provider before generating this shot again.`;
}
/* The only exit, and it needs a person who has actually looked. CineBraid never guesses
   and never times this out — waiting is not evidence that a request was refused. */
window.reconcileFalGeneration = async (jobId, outcome) => {
  try {
    const response = await fetch(`/api/generation/fal/jobs/${jobId}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not record what you found.");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    closeModal();
    route();
    toast(outcome === "not-accepted" ? "Recorded as not accepted — you can generate this again" : "Recorded as accepted at the provider");
  } catch (error) {
    toast("Could not record the outcome: " + error.message);
  }
};
window.openFalUnresolvedModal = (jobId) => {
  const job = (FAL_GENERATION_JOBS || []).find((row) => row.id === jobId);
  if (!job) return toast("That generation is no longer listed");
  const fact = (label, value) => (value ? `<span>${esc(label)}: ${esc(String(value))}</span>` : "");
  openModal(`<h3>Submission status unknown</h3><p class="modal-confirm-message">${esc(falUnresolvedExplanation(job))}</p><div class="candidate-evidence-facts">${fact("Provider", job.provider || "fal")}${fact("Model", job.model)}${fact("Backend", job.backendId)}${fact("Sent", job.createdAt)}${fact("Request id", job.externalId || "never received")}${fact("Shot", job.shotId)}</div><p class="hint">Open the provider's dashboard and look for this request. Then record what you found — CineBraid will not decide this for you, and it will not let you generate this shot again until you do.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="chip" onclick="reconcileFalGeneration('${attr(job.id)}','accepted')">It was accepted</button><button class="approve-btn" onclick="reconcileFalGeneration('${attr(job.id)}','not-accepted')">It was NOT accepted — safe to retry</button></div>`);
};
function falGenerationInline(shotId, purpose, frameId = "") {
  const job = falGenerationJob(shotId, purpose, frameId);
  if (!job) return "";
  const active = falJobActive(job), done = job.status === "COMPLETED", failed = job.status === "FAILED";
  const unknown = falJobUnresolved(job);
  /* An unresolved job gets its own class, its own icon and its own action. What it must
     never get is a "Try again" button sitting where a failure's would be. */
  return `<div class="fal-job-strip ${unknown ? "unresolved" : active ? "active" : done ? "done" : failed ? "failed" : ""}"><div><span>${unknown ? "?" : active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${unknown ? esc(falUnresolvedExplanation(job)) : `${esc(job.model || "GPT Image 2")}${job.outputCount ? ` · ${job.outputCount} option${job.outputCount === 1 ? "" : "s"}` : ""}${job.error ? ` · ${esc(job.error)}` : ""}`}</small></div></div><div>${unknown ? `<button class="chip" onclick="openFalUnresolvedModal('${attr(job.id)}')">Check and resolve</button>` : active ? `<button class="chip" onclick="refreshFalGeneration('${job.id}',true)">Refresh</button><button class="chip danger" onclick="cancelFalGeneration('${job.id}')">Cancel</button>` : failed ? `<button class="chip" onclick="openFalGenerationModal('${purpose}','${shotId}','${frameId}')">Try again</button>` : ""}</div></div>`;
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
  /* A fresh blocking frame and a frame pass both compile through the GenerationPlan
     architecture now, and open the capability-aware dialog. A blocking REVISION edits
     an existing attempt, which the compiled path does not carry yet — blocking mode
     takes no references at all — so it stays on the path it has always used rather
     than being half-converted into an edit that would write production identity into
     a frame whose whole contract is that it carries none. */
  const revising = purpose === "blocking"
    && String(ensureShotCreation(s).blockingRevisionRequest || "").trim()
    && String(ensureShotCreation(s).blockingRevisionSourceAssetId || "");
  if (!revising && typeof openFalFrameGenerationModal === "function")
    return openFalFrameGenerationModal(purpose, shotId, frameId, buildId);
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
    aspectRatio: shotAspectLabel(P, s),
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
${state.name || "Continuity state"}${state.appliesTo ? `
SCENE / SHOT SCOPE: ${String(state.appliesTo).trim()} — honour any setting, location or moment this names.` : ""}

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
  /* Shown, not chosen. The prompt in `build` was compiled at this ratio minutes ago;
     a picker here could only disagree with it, and when it did the request won and the
     prompt was left describing a frame nobody was going to get. */
  const aspectLabel = referenceAspectLabel(list);
  const stateSummary = state ? `<div class="fal-revision-summary"><b>${esc(state.name || "Continuity state")}</b><p>${esc(state.notes || "No state delta entered.")}</p><small>${effectiveMode === "derive" ? `Editing from ${esc(parentInfo?.parent?.name || "parent state")} · ${esc(parentInfo?.file || "")}` : requestedMode === "derive" ? `The selected parent has no approved image, so this run will create independently.` : "Creating independently from entity canon and the state delta."}</small></div>` : "";
  openModal(`<h3>Generate ${state ? `${esc(state.name || "state")} ` : ""}${esc(typeLabel)} reference candidates</h3><div class="modal-sub">FAL · GPT IMAGE 2${refs.length ? " EDIT / REFERENCE-GUIDED" : " TEXT-TO-IMAGE"}</div>${stateSummary}<div class="candidate-evidence-facts"><span>${esc(entity.id)}</span>${state ? `<span>Target · ${esc(state.name || "State")}</span>` : ""}<span>${refs.length} input${refs.length === 1 ? "" : "s"}</span><span>Candidate only · approval required</span></div><div class="two-col"><label><span>Number of options</span><select id="fal-entity-output-count">${[1,2,3,4].map((n) => `<option value="${n}" ${n === count ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><span>Quality</span><select id="fal-entity-quality">${["low","medium","high"].map((value) => `<option value="${value}" ${value === quality ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></label><label><span>Resolution</span><select id="fal-entity-resolution">${falResolutionOptions(resolution)}</select></label></div><div class="candidate-evidence-facts" data-fal-entity-aspect="${attr(aspectLabel)}"><span>Aspect ratio · ${esc(aspectLabel)}</span><span>${esc(typeLabel)} reference format · matches the compiled prompt</span></div><p class="hint">This submits a paid FAL image request. Returned files are added as unapproved ${esc(typeLabel)} candidates${state ? ` targeted to ${esc(state.name || "this state")}` : ""}. They do not become canon until you explicitly approve one.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="startFalEntityGeneration()">START GENERATION</button></div>`);
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
    aspectRatio: referenceAspectLabel(list),
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
    /* From the resolver, not from the modal. The compiled prompt already committed to
       this shape; reading a control here is what let the two disagree. */
    aspectRatio: referenceAspectLabel(request.list),
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
    aspectRatio: shotAspectLabel(P, s),
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
  const unknown = falJobUnresolved(job);
  return `<div class="fal-job-strip h3 ${unknown ? "unresolved" : active ? "active" : done ? "done" : failed ? "failed" : ""}"><div><span>${unknown ? "?" : active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${unknown ? esc(falUnresolvedExplanation(job)) : `${esc(job.profileName || "MiniMax H3")} · ${esc(String(job.profileMode || "motion").toUpperCase())}${job.durationSeconds ? ` · ${job.durationSeconds}s` : ""}${job.error ? ` · ${esc(job.error)}` : ""}`}</small></div></div><div>${unknown ? `<button class="chip" onclick="openFalUnresolvedModal('${attr(job.id)}')">Check and resolve</button>` : active ? `<button class="chip" onclick="refreshFalGeneration('${job.id}',true)">Refresh</button><button class="chip danger" onclick="cancelFalGeneration('${job.id}')">Cancel</button>` : failed ? `<button class="chip" onclick="openFalH3MotionModal('${job.shotId}','${job.sourceBuildId || ""}')">Try again</button>` : ""}</div></div>`;
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
/* The dialog shows the COMPILED PLAN, because the compiled plan is what is sent.
 *
 * It used to show the prompt-engine's own text and the server used to dispatch that
 * same string, so "what you confirmed" and "what was sent" matched by coincidence. Now
 * the server compiles the shot's approved package into a GenerationPlan and serialises
 * that; this dialog asks for the identical compilation and renders it. The compiler is
 * deterministic — no clock, no network, no assistant — so the preview and the dispatch
 * cannot drift apart.
 *
 * Every number here comes from that response. Nothing about MiniMax H3 or about fal is
 * hard-coded on this screen any more, which is why a stale 2,000-character limit could
 * sit in the interface for as long as it did. */
window.updateFalH3CostEstimate = () => {
  const request = window._falH3MotionRequest || {};
  const duration = Number(document.getElementById("fal-h3-duration")?.value || request.durationSeconds || 5);
  const resolution = document.getElementById("fal-h3-resolution")?.value || request.resolution || falH3ResolutionValue();
  const refs = request.references || [];
  const images = refs.filter((ref) => ref.mediaType === "image").length;
  const videos = refs.filter((ref) => ref.mediaType === "video").length;
  const estimate = falH3CostEstimate(duration, images, videos, resolution);
  const target = document.getElementById("fal-h3-cost-estimate");
  if (target) target.innerHTML = `<b>${esc(estimate.label)}</b><span>${esc(estimate.detail)}</span>`;
};
/* The effective ceiling: MiniMax H3's own limit intersected with fal's. The dialog is
   told the number rather than deciding it, and says which layer set it. */
function falH3PromptLimit() {
  return Number(window._falH3MotionRequest?.maxPromptCharacters) || 7000;
}
/* What an edit removed, checked against the compiler's own record with the same
   deterministic test the compiler uses on its own output. Not a review and not a
   refusal — the words are the filmmaker's — but the cost of the change is stated before
   it is paid for rather than discovered in the result. */
window.reviewFalH3PromptEdit = async () => {
  const request = window._falH3MotionRequest;
  const panel = document.getElementById("fal-h3-edit-coverage");
  if (!request || !panel) return;
  const prompt = String(document.getElementById("fal-h3-prompt-editor")?.value ?? "");
  if (prompt.trim() === String(request.compiledPrompt || "").trim()) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const gate = falH3AspectGate();
  const preview = await fetchFalH3Plan(request.shotId, request.buildId, {
    durationSeconds: Number(document.getElementById("fal-h3-duration")?.value || request.durationSeconds),
    resolution: document.getElementById("fal-h3-resolution")?.value || request.resolution,
    aspectRatio: gate.carriesAspectRatio ? gate.value : "",
    profileMode: request.profileMode,
    prompt,
  });
  if (!preview) return;
  const lost = preview.editedCoverage?.lost || [];
  const checked = preview.editedCoverage?.checked || [];
  panel.hidden = false;
  panel.innerHTML = lost.length
    ? `<div><b>Your edit drops ${lost.length} of ${checked.length} directed element${lost.length === 1 ? "" : "s"}</b><small>${esc(lost.map((row) => row.label).join(", "))}. That may be exactly what you intended — CineBraid is recording it, not blocking it. The compiled original is preserved either way.</small></div>`
    : `<div class="ok"><b>Your edit keeps all ${checked.length} directed elements</b><small>Every piece of direction CineBraid wrote into the prompt is still present in your version.</small></div>`;
};
window.updateFalH3PromptEditor = () => {
  const request = window._falH3MotionRequest || {};
  const editor = document.getElementById("fal-h3-prompt-editor");
  const prompt = String(editor?.value ?? request.prompt ?? "");
  request.prompt = prompt;
  const limit = falH3PromptLimit();
  const count = document.getElementById("fal-h3-prompt-count");
  const fact = document.getElementById("fal-h3-prompt-fact");
  const warning = document.getElementById("fal-h3-prompt-warning");
  const changed = prompt.trim() !== String(request.compiledPrompt || "").trim();
  if (count) {
    count.textContent = `${prompt.length.toLocaleString()}/${limit.toLocaleString()}`;
    count.classList.toggle("over", prompt.length > limit);
  }
  if (fact) fact.textContent = `${prompt.length.toLocaleString()}/${limit.toLocaleString()} prompt characters${changed ? " · edited" : ""}`;
  if (warning) {
    warning.hidden = !!prompt.trim() && prompt.length <= limit;
    /* Guarded: the counter is not worth losing the whole dialog over if the panel's
       markup ever changes underneath it. */
    const detail = warning.querySelector && warning.querySelector("small");
    if (detail) detail.textContent = !prompt.trim()
      ? "Enter a prompt before submitting a paid request."
      : `Shorten this prompt to ${limit.toLocaleString()} characters before a paid submission. CineBraid will not trim it for you — a prompt cut to fit is a shot you did not direct.`;
  }
  updateFalH3AspectGuard();
};
/* The format this dialog would actually send, checked against MiniMax H3's own list.
   The same resolver runs on the server, so the screen and the dispatch cannot disagree. */
window.falH3AspectGate = () => {
  const request = window._falH3MotionRequest || {};
  const select = document.getElementById("fal-h3-aspect");
  const requested = select ? select.value : request.aspectRatio || (request.profileMode === "r2v" ? "adaptive" : "16:9");
  return h3AspectSupport(request.profileMode, requested);
};
/* Shown in place, next to the control that caused it, and it takes the submit button
   with it. Nothing is dispatched, nothing is charged, and every prompt, frame,
   keyframe and setting in this dialog is left exactly as the user left it. */
window.updateFalH3AspectGuard = () => {
  const panel = document.getElementById("fal-h3-aspect-warning");
  const gate = falH3AspectGate();
  if (panel) {
    panel.hidden = gate.ok;
    if (!gate.ok) panel.innerHTML = `<div><b>MiniMax H3 cannot deliver ${esc(gate.requested || "this format")}</b><small>${esc(gate.message)}</small></div>`;
  }
  /* The full submit condition rather than a one-way disable: choosing a format H3 does
     accept has to give the button back, or the refusal becomes a dead end. A backend
     refusal from the compiled plan holds the button down on its own. */
  const submit = document.getElementById("fal-h3-submit");
  if (submit) {
    const prompt = String(document.getElementById("fal-h3-prompt-editor")?.value ?? "");
    submit.disabled = !gate.ok
      || !prompt.trim()
      || prompt.length > falH3PromptLimit()
      || !!window._falH3MotionRequest?.refusal
      || !!window._falH3Submitting;
  }
};
window.resetFalH3PromptEditor = () => {
  const request = window._falH3MotionRequest || {};
  const editor = document.getElementById("fal-h3-prompt-editor");
  if (editor) editor.value = request.compiledPrompt || "";
  const panel = document.getElementById("fal-h3-edit-coverage");
  if (panel) { panel.hidden = true; panel.innerHTML = ""; }
  updateFalH3PromptEditor();
};
/* Re-compiles when an output setting changes, because duration and format are compiler
   inputs: a different duration is a different plan, and showing the old prompt beside a
   new duration would put the dialog back to guessing. */
window.refreshFalH3Plan = async () => {
  const request = window._falH3MotionRequest;
  if (!request || window._falH3Submitting) return;
  const duration = Number(document.getElementById("fal-h3-duration")?.value || request.durationSeconds);
  const resolution = document.getElementById("fal-h3-resolution")?.value || request.resolution;
  const gate = falH3AspectGate();
  const edited = String(document.getElementById("fal-h3-prompt-editor")?.value ?? "");
  const keepEdit = edited.trim() && edited.trim() !== String(request.compiledPrompt || "").trim();
  const preview = await fetchFalH3Plan(request.shotId, request.buildId, {
    durationSeconds: duration,
    resolution,
    aspectRatio: gate.carriesAspectRatio ? gate.value : "",
    profileMode: request.profileMode,
  });
  if (!preview) return;
  Object.assign(request, preview, { prompt: keepEdit ? edited : preview.compiledPrompt });
  const editor = document.getElementById("fal-h3-prompt-editor");
  if (editor && !keepEdit) editor.value = preview.compiledPrompt;
  renderFalH3PlanPanels();
  updateFalH3CostEstimate();
  updateFalH3PromptEditor();
};
async function fetchFalH3Plan(shotId, buildId, extra = {}) {
  try {
    const response = await fetch("/api/generation/fal/h3/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId, sourceBuildId: buildId, ...extra }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast(data.error || "CineBraid could not compile this MiniMax H3 package");
      return null;
    }
    return data;
  } catch (error) {
    toast("Could not compile the MiniMax H3 request: " + error.message);
    return null;
  }
}
/* The provider input order, read from the plan's own bindings rather than renumbered
   here. "Image 1" on this screen is the reference the request will actually carry in
   that slot — which is the whole point of binding by role instead of array position. */
function falH3BindingRows(request) {
  const bindings = request?.dispatch?.bindings || [];
  if (!bindings.length) return "";
  const byRef = new Map((request.references || []).map((ref) => [ref.refId, ref]));
  const FIELD_LABELS = {
    image_url: "Opening frame",
    end_image_url: "Final frame",
    reference_image_urls: "Image",
    reference_video_urls: "Video",
    reference_audio_urls: "Audio",
  };
  return bindings.map((binding) => {
    const ref = byRef.get(binding.refId) || {};
    const label = FIELD_LABELS[binding.field] || binding.field;
    const slot = binding.index == null ? label : `${label} ${binding.index + 1}`;
    return `<li><b>${esc(slot)}</b><span>${esc(ref.label || binding.refId)} · ${esc(String(binding.role || "reference").replace(/-/g, " "))}${ref.purpose ? ` · ${esc(ref.purpose)}` : ""}</span></li>`;
  }).join("");
}
/* What the compiler could not carry, in the compiler's own words. A shot that loses a
   piece of direction now says so on the way in rather than silently. */
function falH3WarningRows(request) {
  const rows = (request?.warnings || []).filter((row) => row && row.message);
  if (!rows.length) return "";
  return `<section class="h3-plan-warnings"><b>${rows.length} note${rows.length === 1 ? "" : "s"} from compilation</b><ul>${rows.map((row) => `<li><span>${esc(row.message)}</span>${row.action ? `<small>${esc(row.action)}</small>` : ""}</li>`).join("")}</ul></section>`;
}
function renderFalH3PlanPanels() {
  const request = window._falH3MotionRequest || {};
  /* The same honest option list the frame dialog shows, read-only here. MiniMax H3 is
     the only executable motion path today and this is where a filmmaker finds that
     out — beside the models that cannot yet generate and the sentence saying why. */
  const options = document.getElementById("fal-h3-options");
  if (options && typeof renderGenerationOptions === "function")
    options.innerHTML = renderGenerationOptions(request.options, "animate-shot", request.selectedOptionId);
  const sequence = document.getElementById("fal-h3-sequence");
  if (sequence) {
    const rows = falH3BindingRows(request);
    sequence.innerHTML = rows ? `<b>Exact provider inputs</b><small>Each approved reference and the request field it fills. Bound by its production role, not by list order.</small><ol>${rows}</ol>` : "";
    sequence.hidden = !rows;
  }
  const notes = document.getElementById("fal-h3-plan-warnings");
  if (notes) notes.innerHTML = falH3WarningRows(request);
  const refusalPanel = document.getElementById("fal-h3-refusal");
  if (refusalPanel) {
    const refusal = request.refusal;
    refusalPanel.hidden = !refusal;
    if (refusal) refusalPanel.innerHTML = `<div><b>This package cannot be submitted as it stands</b><small>${esc(refusal.error)}</small></div>`;
  }
}
window.openFalH3MotionModal = async (shotId, buildId = "") => {
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
  /* Unsaved edits reach the server through the project document, and the plan is
     compiled from the stored package — so the save has to land before the compile. */
  if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
  const requestedDuration = Math.max(1, Math.min(60, Number(build.durationSeconds || c.motionDuration || 5) || 5));
  const ratio = profile.mode === "r2v" ? (productionAspect(P)?.label || "adaptive") : projectAspectLabel(P);
  const aspectGate = h3AspectSupport(profile.mode, ratio);
  const preview = await fetchFalH3Plan(shotId, build.id, {
    durationSeconds: requestedDuration,
    resolution: falH3ResolutionValue(),
    aspectRatio: aspectGate.carriesAspectRatio && aspectGate.ok ? aspectGate.value : ratio,
    profileMode: profile.mode,
  });
  if (!preview) return;

  const clientRequestId = `h3-${shotId}-${build.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  /* Resolved from the plan's own references, so the option list answers the question
     for the shot as compiled rather than for a hypothetical one. */
  const motionOptions = typeof fetchGenerationOptions === "function"
    ? await fetchGenerationOptions("animate-shot", (preview.references || []).map((row) => ({ role: row.role, mediaType: row.mediaType })), { durationSeconds: Number(preview.durationSeconds) || undefined })
    : null;
  const readyMotion = (motionOptions?.options || []).filter((option) => option.actionable);
  window._falH3MotionRequest = {
    ...preview,
    options: motionOptions,
    selectedOptionId: readyMotion.find((option) => option.modelId.startsWith("minimax-h3/"))?.optionId || readyMotion[0]?.optionId || "",
    shotId,
    buildId: build.id,
    profileId: preview.profile?.id || profile.id,
    profileName: preview.profile?.name || profile.name,
    profileMode: preview.mode || profile.mode,
    packageId: build.packageId || "",
    prompt: preview.compiledPrompt,
    clientRequestId,
  };
  window._falH3Submitting = false;
  const request = window._falH3MotionRequest;
  const images = (preview.references || []).filter((ref) => ref.mediaType === "image");
  const videos = (preview.references || []).filter((ref) => ref.mediaType === "video");
  const audio = (preview.references || []).filter((ref) => ref.mediaType === "audio");
  const limit = Number(preview.maxPromptCharacters) || 7000;
  const promptReady = preview.compiledPrompt.length <= limit;
  const [durationLow, durationHigh] = Array.isArray(preview.durationRange) && preview.durationRange.length === 2
    ? preview.durationRange
    : [5, 15];
  const durationOptions = Array.from({ length: Math.max(1, durationHigh - durationLow + 1) }, (_, i) => durationLow + i);
  const resolutions = Array.isArray(preview.resolutions) && preview.resolutions.length ? preview.resolutions : ["2K", "768P"];
  /* Named honestly: where the effective ceiling is tighter than MiniMax H3's own, the
     screen says which layer narrowed it instead of asserting either number as "the
     H3 limit". */
  const limitNote = limit < Number(preview.modelMaxPromptCharacters || 7000)
    ? `MiniMax H3 reads ${Number(preview.modelMaxPromptCharacters).toLocaleString()} characters; this backend accepts ${limit.toLocaleString()}.`
    : `MiniMax H3 and this backend both accept ${limit.toLocaleString()} characters.`;
  const durationNote = Array.isArray(preview.modelDurationRange) && (durationLow !== preview.modelDurationRange[0] || durationHigh !== preview.modelDurationRange[1])
    ? `MiniMax H3 itself renders ${preview.modelDurationRange[0]}–${preview.modelDurationRange[1]}s; this backend renders ${durationLow}–${durationHigh}s.`
    : `${durationLow}–${durationHigh} seconds.`;
  /* The shot asked for a length this backend cannot render. Said plainly, next to the
     picker, BEFORE the paid action — because submitting will refuse it rather than
     quietly render a different length, and the filmmaker is the one who chooses the
     replacement. */
  const askedDuration = Number(preview.durationRequested) || 0;
  const durationChanged = askedDuration > 0 && askedDuration !== Number(preview.durationSeconds);
  const durationBanner = durationChanged
    ? `<div id="fal-h3-duration-notice" class="guided-prompt-error"><div><b>This shot is written as ${esc(String(askedDuration))} seconds, which this backend cannot render</b><small>MiniMax H3 renders from ${preview.modelDurationRange[0]}s, but fal accepts ${durationLow}–${durationHigh}s. ${preview.durationSeconds}s is selected below — confirm it or choose another length. CineBraid will not change the length of your shot for you: submitting ${esc(String(askedDuration))}s is refused, not adjusted.</small></div></div>`
    : "";

  openModal(`<div class="h3-generation-modal"><header class="h3-generation-head"><div><span>MINIMAX H3 · PAID GENERATION</span><h3>Generate with ${esc(request.profileName)}</h3><p>This is the request CineBraid compiled from the approved package. Confirm the inputs, the prompt and the estimated spend before submission.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="h3-generation-scroll"><div class="modal-sub">FAL · ${esc(preview.dispatch?.model || "minimax/h3")} · compiled by ${esc(preview.compiler?.packId || "minimax-h3")} ${esc(preview.compiler?.packVersion || "")}</div><div class="candidate-evidence-facts"><span>${images.length} image${images.length === 1 ? "" : "s"}</span><span>${videos.length} video${videos.length === 1 ? "" : "s"}</span><span>${audio.length} audio</span><span id="fal-h3-prompt-fact">${preview.compiledPrompt.length.toLocaleString()}/${limit.toLocaleString()} prompt characters</span><span>Native stereo audio</span></div><div id="fal-h3-refusal" class="guided-prompt-error" hidden></div><div id="fal-h3-options"></div><section id="fal-h3-sequence" class="h3-submit-sequence" hidden></section>${durationBanner}<section class="h3-generation-settings"><h4>Output settings</h4><div class="h3-settings-grid"><label><span>Duration</span><select id="fal-h3-duration" onchange="refreshFalH3Plan()">${durationOptions.map((n)=>`<option value="${n}" ${n===Number(preview.durationSeconds)?"selected":""}>${n} seconds</option>`).join("")}</select><small>${esc(durationNote)}</small></label><label><span>Resolution</span><select id="fal-h3-resolution" onchange="refreshFalH3Plan()">${resolutions.map((value)=>`<option value="${attr(value)}" ${value===preview.resolution?"selected":""}>${esc(value)}</option>`).join("")}</select></label>${preview.carriesAspectRatio ? `<label><span>Aspect ratio</span><select id="fal-h3-aspect" onchange="refreshFalH3Plan()">${aspectGate.ok ? "" : `<option value="${attr(ratio)}" selected>${esc(ratio)} — not supported</option>`}${aspectGate.supported.map((value)=>`<option value="${attr(value)}" ${value===preview.aspectRatio?"selected":""}>${esc(value)}</option>`).join("")}</select></label>` : ""}</div></section><div id="fal-h3-aspect-warning" class="guided-prompt-error" ${aspectGate.ok ? "hidden" : ""}>${aspectGate.ok ? "" : `<div><b>MiniMax H3 cannot deliver ${esc(ratio)}</b><small>${esc(aspectGate.message)}</small></div>`}</div><div id="fal-h3-cost-estimate" class="h3-cost-estimate"></div><div id="fal-h3-plan-warnings"></div><div id="fal-h3-prompt-warning" class="guided-prompt-error" ${promptReady ? "hidden" : ""}><div><b>Prompt is not ready for submission</b><small>${promptReady ? "" : `Shorten this prompt to ${limit.toLocaleString()} characters before a paid submission.`}</small></div></div><section class="h3-prompt-editor"><header><div><b>Edit prompt before generation</b><small>This is the prompt CineBraid compiled and the exact text that will be sent. ${esc(limitNote)} The compiled package is preserved; any change is saved as a linked manual revision and recorded beside the compiled original.</small></div><span id="fal-h3-prompt-count">${preview.compiledPrompt.length.toLocaleString()}/${limit.toLocaleString()}</span></header><textarea id="fal-h3-prompt-editor" oninput="updateFalH3PromptEditor()" onchange="reviewFalH3PromptEdit()">${esc(preview.compiledPrompt)}</textarea><div id="fal-h3-edit-coverage" class="h3-edit-coverage" hidden></div><div class="h3-prompt-editor-actions"><label><span>Revision note · optional</span><input id="fal-h3-prompt-edit-reason" placeholder="Clarified timing, removed duplicate action…"></label><button class="ghost-btn" onclick="resetFalH3PromptEditor()">Reset compiled prompt</button></div></section><p class="hint">This submits one paid MiniMax H3 request through FAL. The returned MP4 is saved as an unapproved video candidate in this shot. The request uses an idempotency key to prevent an accidental double submission from this dialog.</p></div><footer class="modal-actions h3-generation-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="fal-h3-submit" class="approve-btn large" onclick="startFalH3MotionGeneration()" ${promptReady && aspectGate.ok && !preview.refusal ? "" : "disabled"}>START H3 GENERATION</button></footer></div>`);
  setTimeout(() => { renderFalH3PlanPanels(); updateFalH3CostEstimate(); updateFalH3PromptEditor(); }, 0);
};
window.startFalH3MotionGeneration = async () => {
  const request = window._falH3MotionRequest;
  if (!request || window._falH3Submitting) return;
  const limit = falH3PromptLimit();
  const editedPrompt = String(document.getElementById("fal-h3-prompt-editor")?.value ?? request.prompt ?? "").trim();
  if (!editedPrompt) return toast("Enter a MiniMax H3 prompt before generation");
  if (editedPrompt.length > limit) return toast(`MiniMax H3 prompt exceeds this configuration's ${limit.toLocaleString()}-character limit`);
  if (request.refusal) return toast(request.refusal.error);
  /* Checked again at the moment of dispatch rather than only when the dialog opened,
     so a retry, a resumed dialog or a changed picker cannot walk past the refusal.
     Returning here leaves the dialog, the prompt and every setting untouched. */
  const gate = falH3AspectGate();
  if (!gate.ok) {
    updateFalH3AspectGuard();
    return toast(gate.message);
  }
  request.prompt = editedPrompt;
  const revisionReason = String(document.getElementById("fal-h3-prompt-edit-reason")?.value || "Edited in the MiniMax H3 generation preflight").trim();
  /* An edit is recorded as its own revision of the package, so the compiled original
     and the text the filmmaker chose to send both survive. The build the SERVER
     compiles from is deliberately left as the original: an edit changes the prompt
     that is dispatched, never the structured direction it was compiled from. */
  if (editedPrompt !== String(request.compiledPrompt || "").trim() && typeof createManualMotionPromptRevision === "function") {
    try {
      const revised = createManualMotionPromptRevision(request.shotId, request.buildId, editedPrompt, revisionReason);
      if (revised?.id) request.revisionBuildId = revised.id;
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
    /* The package the server compiles. References, endpoints, roles and settings all
       come from it; this request body carries no reference list of its own, because a
       second list is a second chance to disagree with the one that was approved. */
    sourceBuildId: request.buildId,
    packageId: request.packageId,
    profileId: request.profileId,
    profileName: request.profileName,
    profileFamily: "minimax-h3",
    profileMode: request.profileMode,
    /* The text to send. Identical to the compiled prompt unless it was edited above, in
       which case the server records both. */
    prompt: request.prompt,
    outputCount: 1,
    durationSeconds: Number(document.getElementById("fal-h3-duration")?.value || request.durationSeconds || 5),
    resolution: document.getElementById("fal-h3-resolution")?.value || request.resolution || falH3ResolutionValue(),
    aspectRatio: gate.carriesAspectRatio ? gate.value : request.aspectRatio || "",
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

