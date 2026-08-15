/* CineBraid v6.0.7.1 — Guarded Reference Packages and Composer Hardening */
(() => {
  const composerSafeRequested = (() => {
    try {
      return new URLSearchParams(location.search || "").get("safe") === "1" ||
        localStorage.getItem("cinebraid-disable-v607-composer") === "1";
    } catch {
      return false;
    }
  })();
  if (composerSafeRequested) {
    window.__CINEBRAID_COMPOSER_607_DISABLED = true;
    console.warn("CineBraid composer enhancements are disabled in safe mode.");
    return;
  }

  const composerOriginals607 = {
    ensureShotCreation: typeof ensureShotCreation === "function" ? ensureShotCreation : null,
    shotCreationPromptReferences: typeof shotCreationPromptReferences === "function" ? shotCreationPromptReferences : null,
    guidedFramePromptRefs: typeof guidedFramePromptRefs === "function" ? guidedFramePromptRefs : null,
    compositionSummary: typeof compositionSummary === "function" ? compositionSummary : null,
    compositionAugmentedReferences: typeof compositionAugmentedReferences === "function" ? compositionAugmentedReferences : null,
    guidedFrameCard: typeof guidedFrameCard === "function" ? guidedFrameCard : null,
    guidedFramePromptResult: typeof guidedFramePromptResult === "function" ? guidedFramePromptResult : null,
    composerElementCard: typeof composerElementCard === "function" ? composerElementCard : null,
    composerSelectionPanel: typeof composerSelectionPanel === "function" ? composerSelectionPanel : null,
    guidedShotComposerPanel: typeof guidedShotComposerPanel === "function" ? guidedShotComposerPanel : null,
    ensureGuidedMotionUnit: typeof ensureGuidedMotionUnit === "function" ? ensureGuidedMotionUnit : null,
    motionSubjectPlan: typeof motionSubjectPlan === "function" ? motionSubjectPlan : null,
    motionPropPlan: typeof motionPropPlan === "function" ? motionPropPlan : null,
    structuredMotionSummary: typeof structuredMotionSummary === "function" ? structuredMotionSummary : null,
    motionSubjectControls: typeof motionSubjectControls === "function" ? motionSubjectControls : null,
    motionPropControls: typeof motionPropControls === "function" ? motionPropControls : null,
    motionDirectorMap: typeof motionDirectorMap === "function" ? motionDirectorMap : null,
    guidedMotionReferences: typeof guidedMotionReferences === "function" ? guidedMotionReferences : null,
    guidedMotionPanel: typeof guidedMotionPanel === "function" ? guidedMotionPanel : null,
    guidedMotionPromptResult: typeof guidedMotionPromptResult === "function" ? guidedMotionPromptResult : null,
    setGuidedMotionField: typeof window.setGuidedMotionField === "function" ? window.setGuidedMotionField : null,
    buildGuidedFramePrompt: typeof window.buildGuidedFramePrompt === "function" ? window.buildGuidedFramePrompt : null,
    buildGuidedMotionPrompt: typeof window.buildGuidedMotionPrompt === "function" ? window.buildGuidedMotionPrompt : null,
    addComposerElement: typeof window.addComposerElement === "function" ? window.addComposerElement : null,
  };
  window.__cinebraidComposerOriginals607 = composerOriginals607;

  function restoreComposerOriginals607(reason, persist = false) {
    const restore = (name, original) => {
      if (typeof original !== "function") return;
      try { window[name] = original; } catch {}
      try { eval(`${name} = original`); } catch {}
    };
    for (const [name, original] of Object.entries(composerOriginals607)) restore(name, original);
    window.__CINEBRAID_COMPOSER_607_DISABLED = true;
    window.__CINEBRAID_COMPOSER_607_READY = false;
    window.__CINEBRAID_COMPOSER_607_ERROR = reason?.message || String(reason || "Composer disabled");
    if (persist) {
      try { localStorage.setItem("cinebraid-disable-v607-composer", "1"); } catch {}
    }
    console.error("CineBraid disabled the v6.0.7 composer enhancements and restored the stable shot workspace.", reason || "");
  }
  window.disableComposerEnhancements = restoreComposerOriginals607;
  window.enableComposerEnhancementsNextLoad = () => {
    try { localStorage.removeItem("cinebraid-disable-v607-composer"); } catch {}
    location.reload();
  };
  window.reloadCineBraidSafe = () => {
    try { localStorage.setItem("cinebraid-disable-v607-composer", "1"); } catch {}
    location.reload();
  };

  const requiredComposerFunctions607 = [
    "ensureShotCreation", "shotCreationReferences", "guidedFrames", "guidedCurrentShotStill",
    "guidedFrameApproved", "guidedFrameMode", "preferredCreationProfile", "guidedVideoProfiles",
    "guidedMotionPanel", "guidedMotionReferences", "structuredMotionSummary",
  ];
  const missingComposerFunctions607 = requiredComposerFunctions607.filter((name) => typeof window[name] !== "function");
  if (missingComposerFunctions607.length) {
    restoreComposerOriginals607(new Error(`Composer module mismatch: missing ${missingComposerFunctions607.join(", ")}`));
    return;
  }

  try {
  const clone = (value) => JSON.parse(JSON.stringify(value == null ? null : value));
  const finite = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  const textLabel = (value) => String(value || "").replace(/-/g, " ");
  const mediaTypeForRef = (ref) => ref?.mediaType || (isAudio(ref?.file || ref?.url || "") ? "audio" : isVideo(ref?.file || ref?.url || "") ? "video" : "image");
  const actualEntity = (id) => [...(P.characters || []), ...(P.locations || []), ...(P.props || []), ...(P.vehicles || [])].find((item) => item.id === id) || null;

  function normalizeMotionPlan607(plan) {
    const out = plan && typeof plan === "object" ? plan : {};
    out.camera = out.camera && typeof out.camera === "object" ? out.camera : {};
    out.camera.move = out.camera.move || "locked";
    out.camera.direction = out.camera.direction || "";
    out.camera.intensity = out.camera.intensity || "subtle";
    out.camera.style = out.camera.style || "smooth";
    out.camera.framing = out.camera.framing || "preserve";
    out.subjects = out.subjects && typeof out.subjects === "object" ? out.subjects : {};
    out.props = out.props && typeof out.props === "object" ? out.props : {};
    for (const item of Object.values(out.subjects)) {
      if (!item || typeof item !== "object") continue;
      item.action = item.action || "still";
      item.direction = item.direction || "";
      item.intensity = item.intensity || "subtle";
      item.look = item.look || "";
      item.targetId = item.targetId || "";
      item.targetLabel = item.targetLabel || "";
      item.destination = item.destination || "";
      item.notes = item.notes || "";
    }
    for (const item of Object.values(out.props)) {
      if (!item || typeof item !== "object") continue;
      item.action = item.action || "static";
      item.direction = item.direction || "";
      item.targetId = item.targetId || "";
      item.targetLabel = item.targetLabel || "";
      item.destination = item.destination || "";
      item.notes = item.notes || "";
    }
    out.environment = out.environment && typeof out.environment === "object" ? out.environment : {};
    out.environment.action = out.environment.action || "static";
    out.environment.intensity = out.environment.intensity || "subtle";
    out.environment.notes = out.environment.notes || "";
    out.timing = out.timing && typeof out.timing === "object" ? out.timing : {};
    out.timing.onset = out.timing.onset || "immediate";
    out.timing.pacing = out.timing.pacing || "natural";
    out.timing.holdEnd = out.timing.holdEnd !== false;
    out.timing.secondary = out.timing.secondary || "";
    out.audio = out.audio && typeof out.audio === "object" ? out.audio : {};
    out.audio.referenceKey = out.audio.referenceKey || "";
    out.audio.speakerId = out.audio.speakerId || "";
    out.audio.voiceEntityId = out.audio.voiceEntityId || "";
    out.audio.mode = ["none","generate-voice","lip-sync-reference"].includes(out.audio.mode) ? out.audio.mode : out.audio.lipSync ? "lip-sync-reference" : "none";
    out.audio.lipSync = out.audio.mode === "lip-sync-reference";
    out.audio.direction = out.audio.direction || "";
    return out;
  }

  const ensureShotCreation606 = ensureShotCreation;
  ensureShotCreation = window.ensureShotCreation = function ensureShotCreation607(s) {
    if (!s || typeof s !== "object") throw new Error("Shot record is unavailable");
    const base = ensureShotCreation606(s);
    const c = base && typeof base === "object"
      ? base
      : (s.creationBrief = s.creationBrief && typeof s.creationBrief === "object" ? s.creationBrief : {});
    c.composition = c.composition && typeof c.composition === "object" ? c.composition : {};
    const comp = c.composition;
    comp.baseFrame = comp.baseFrame && typeof comp.baseFrame === "object" ? comp.baseFrame : {};
    comp.baseFrame.source = comp.baseFrame.source || "auto";
    comp.baseFrame.zoom = finite(comp.baseFrame.zoom, 1, 0.5, 2.5);
    comp.baseFrame.panX = finite(comp.baseFrame.panX, 0, -50, 50);
    comp.baseFrame.panY = finite(comp.baseFrame.panY, 0, -50, 50);
    comp.baseFrame.rotation = finite(comp.baseFrame.rotation, 0, -15, 15);
    comp.baseFrame.fit = comp.baseFrame.fit || "cover";
    comp.guides = comp.guides && typeof comp.guides === "object" ? comp.guides : {};
    comp.guides.grid = comp.guides.grid !== false;
    comp.guides.snap = !!comp.guides.snap;
    comp.referenceSets = comp.referenceSets && typeof comp.referenceSets === "object" ? comp.referenceSets : {};
    comp.elements = (comp.elements || []).map((element, index) => ({
      ...element,
      locked: !!element.locked,
      hidden: !!element.hidden,
      order: Number.isFinite(+element.order) ? +element.order : index,
    }));
    c.motionPlan = normalizeMotionPlan607(c.motionPlan);
    s.clips = Array.isArray(s.clips) ? s.clips : [];
    c.activeMotionUnitId = c.activeMotionUnitId || s.clips[0]?.id || "";
    for (const unit of s.clips) {
      unit.motionPlan = unit.motionPlan && typeof unit.motionPlan === "object" ? normalizeMotionPlan607(unit.motionPlan) : null;
      unit.motionProfileId = unit.motionProfileId || "";
      unit.motionIntensity = unit.motionIntensity || "";
      if (unit.preserveComposition == null) unit.preserveComposition = null;
    }
    return c;
  };

  function referenceGroupKey(ref) {
    if (ref?.entityId && actualEntity(ref.entityId)) return `entity:${ref.entityId}`;
    if (ref?.assetId) return `asset:${ref.assetId}`;
    return `reference:${ref?.key || "unknown"}`;
  }
  function referenceGroupLabel(ref) {
    const entity = actualEntity(ref?.entityId);
    return entity?.name || ref?.label || "Reference set";
  }
  function stagedFacingView607(staged) {
    const facing = String(staged?.facing || "").toLowerCase();
    if (!facing) return "";
    if (/away|rear|back/.test(facing)) return "rear";
    if (/right/.test(facing)) return "right-profile";
    if (/left/.test(facing)) return "left-profile";
    if (/camera|front/.test(facing)) return "front";
    return "";
  }
  function desiredReferenceView607(s, group) {
    const c = ensureShotCreation(s);
    const explicit = c.composition.referenceSets[group.key] || {};
    if (explicit.desiredView) return explicit.desiredView;
    const keys = new Set(group.refs.map((ref) => ref.key));
    const staged = (c.composition.elements || []).find((element) => keys.has(element.referenceKey));
    if (staged?.view && staged.view !== "reference-view") return staged.view;
    const stagedFacing = stagedFacingView607(staged);
    if (stagedFacing) return stagedFacing;
    const fullText = [
      c.camera,
      c.action,
      c.staging,
      s.positioning,
      s.desc,
      ...(guidedFrames(s) || []).map((frame) => frame?.description || frame?.title || ""),
    ].filter(Boolean).join(" ");
    const entity = group.refs.map((ref) => actualEntity(ref.entityId)).find(Boolean) || null;
    const entityName = String(entity?.name || group.label || "").trim().toLowerCase();
    const specific = entityName ? fullText.split(/(?<=[.!?])\s+|\n+/).filter((part) => part.toLowerCase().includes(entityName)).join(" ") : "";
    const isCharacter = !!entity && (P.characters || []).some((item) => item.id === entity.id);
    const onlyCharacter = isCharacter && (s.characters || []).length === 1;
    const contextualText = specific || (onlyCharacter ? fullText : "");
    const inferred = contextualText && typeof inferReferenceViewFromText === "function" ? inferReferenceViewFromText(contextualText, "") : "";
    if (inferred) return inferred;
    const cameraView = String(c.composition.camera?.view || "");
    // `front` was historically written into every shot as a default, so it is
    // not strong enough to override rear/profile language elsewhere in the shot.
    if (cameraView && !["front", "reference-view"].includes(cameraView)) return cameraView;
    return "front-three-quarter-left";
  }
  function desiredReferenceRegion607(s, group) {
    const c = ensureShotCreation(s);
    const explicit = c.composition.referenceSets[group.key] || {};
    if (explicit.regionNote) return explicit.regionNote;
    const keys = new Set(group.refs.map((ref) => ref.key));
    const staged = (c.composition.elements || []).find((element) => keys.has(element.referenceKey));
    return staged?.notes || "";
  }
  function scoreReference607(s, group, ref) {
    const desiredView = desiredReferenceView607(s, group);
    const desiredRegion = desiredReferenceRegion607(s, group);
    let score = typeof referenceViewScore === "function"
      ? referenceViewScore(desiredView, ref.angleTag, {
          referenceKind: ref.referenceKind || "general",
          desiredRegion,
          detailRegion: ref.detailRegion || "",
          priority: ref.priority || "",
        })
      : (ref.priority === "primary" ? 20 : 0);
    const available = String(ref.availableAngles || "").toLowerCase();
    const desiredLabel = typeof referenceViewLabel === "function" ? referenceViewLabel(desiredView).toLowerCase() : String(desiredView || "").replace(/-/g, " ").toLowerCase();
    if (desiredLabel && available && desiredLabel.split(/\s+/).filter((x) => x.length > 3).some((token) => available.includes(token))) score += 45;
    if (ref.url) score += 12;
    if (ref.approved) score += 5;
    return score;
  }
  function composerReferenceGroups(s) {
    const c = ensureShotCreation(s);
    const groups = new Map();
    for (const ref of shotCreationReferences(s).filter((item) => shotInputEnabled(s, item.key))) {
      const key = referenceGroupKey(ref);
      if (!groups.has(key)) groups.set(key, { key, label: referenceGroupLabel(ref), refs: [] });
      groups.get(key).refs.push(ref);
    }
    return [...groups.values()].map((group) => {
      const explicit = c.composition.referenceSets[group.key] || null;
      const ranked = [...group.refs].sort((a, b) => scoreReference607(s, group, b) - scoreReference607(s, group, a));
      const primary = explicit?.primaryKey || ranked[0]?.key || "";
      let supporting;
      if (explicit) supporting = new Set(Array.isArray(explicit.supportingKeys) ? explicit.supportingKeys : []);
      else {
        const desiredRegion = desiredReferenceRegion607(s, group).toLowerCase();
        const candidates = ranked.filter((ref) => ref.key !== primary);
        const detail = candidates.find((ref) => {
          const region = String(ref.detailRegion || "").toLowerCase();
          return ref.referenceKind === "detail" && (!desiredRegion || !region || desiredRegion.split(/[^a-z0-9]+/).some((token) => token.length > 3 && region.includes(token)));
        });
        const desiredView = desiredReferenceView607(s, group);
        const alternate = candidates.find((ref) => {
          if (ref.key === detail?.key || !["single-angle", "turnaround", "contact-sheet"].includes(ref.referenceKind || "")) return false;
          if (["turnaround", "contact-sheet"].includes(ref.referenceKind || "")) return true;
          const compatibility = typeof referenceViewCompatibility === "function" ? referenceViewCompatibility(desiredView, ref.angleTag) : "unknown";
          return ["exact", "near", "unknown"].includes(compatibility) && scoreReference607(s, group, ref) >= 65;
        });
        supporting = new Set([detail?.key, alternate?.key].filter(Boolean).slice(0, 2));
      }
      return {
        ...group,
        primary,
        supporting,
        explicit: !!explicit,
        desiredView: desiredReferenceView607(s, group),
        regionNote: explicit?.regionNote || "",
        suggestedPrimary: !explicit,
      };
    });
  }
  function selectedReferenceKeys(s) {
    const c = ensureShotCreation(s);
    const keys = new Set();
    for (const group of composerReferenceGroups(s)) {
      if (group.primary) keys.add(group.primary);
      group.supporting.forEach((key) => keys.add(key));
    }
    for (const element of c.composition.elements || []) if (element.referenceKey) keys.add(element.referenceKey);
    return keys;
  }
  /* `frameId` reaches shotCreationReferences() so a frame that declares its own
     entity state is answered with THAT state's approved image. The selected-key
     set stays SHOT-scoped, and so does the reference key it matches against:
     composer selections are stored per shot, and a per-frame key would drop a
     director's chosen primary from every frame that overrides a state. */
  function selectedShotReferences(s, frameId = "") {
    const keys = selectedReferenceKeys(s);
    return shotCreationReferences(s, frameId).filter((ref) => ref.url && shotInputEnabled(s, ref.key) && keys.has(ref.key));
  }

  function baseFrameChoices(s) {
    const out = [{ value: "auto", label: "Automatic best base" }, { value: "blank", label: "Blank composition canvas" }];
    const current = guidedCurrentShotStill(s);
    /* Only a canon still is offered as a prompt BASE. A historic one is still
       on the shot and still visible; it is not an approved starting point. */
    if (current && current.isCanon) out.push({ value: `shot:${current.name}`, label: "Current approved shot image", ref: { key: `shot-current:${s.id}:${current.name}`, label: "Current approved shot image", file: current.name, url: current.url, role: "base", mediaType: "image", priority: "primary", approved: true } });
    guidedFrames(s).forEach((frame, index) => {
      const take = guidedFrameApproved(s, frame, takesFor(s.id), index);
      if (take) out.push({ value: `frame:${frame.id}:${take.name}`, label: `Approved Frame ${frame.label}`, ref: { key: `approved-frame:${frame.id}:${take.name}`, label: `Approved Frame ${frame.label}`, file: take.name, url: take.url, role: "base", mediaType: "image", priority: "primary", approved: true } });
    });
    for (const ref of shotCreationReferences(s).filter((item) => item.url && shotInputEnabled(s, item.key))) out.push({ value: `ref:${ref.key}`, label: `${ref.label} · ${guidedReferenceRoleLabel(ref)}`, ref });
    return out;
  }
  function selectedBaseFrame(s) {
    const c = ensureShotCreation(s), source = c.composition.baseFrame.source || "auto";
    const choices = baseFrameChoices(s);
    if (source === "blank") return null;
    if (source !== "auto") return choices.find((item) => item.value === source)?.ref || null;
    const current = choices.find((item) => item.value.startsWith("shot:"));
    if (current) return current.ref;
    const base = shotCreationReferences(s).find((ref) => ref.url && shotInputEnabled(s, ref.key) && ["base", "location", "composition"].includes(ref.role));
    return base || null;
  }
  function baseFrameInstruction(s) {
    const settings = ensureShotCreation(s).composition.baseFrame;
    const selected = selectedBaseFrame(s);
    const transforms = [];
    if (Math.abs(settings.zoom - 1) > 0.01) transforms.push(`${settings.zoom > 1 ? "zoom in" : "zoom out"} to ${Math.round(settings.zoom * 100)} percent`);
    if (Math.abs(settings.panX) > 0.5 || Math.abs(settings.panY) > 0.5) transforms.push(`shift the crop ${settings.panX > 0 ? "right" : settings.panX < 0 ? "left" : ""}${settings.panX && settings.panY ? " and " : ""}${settings.panY > 0 ? "down" : settings.panY < 0 ? "up" : ""}`.trim());
    if (Math.abs(settings.rotation) > 0.1) transforms.push(`rotate ${Math.abs(settings.rotation)} degrees ${settings.rotation > 0 ? "clockwise" : "counterclockwise"}`);
    if (selected?.blocking) {
      const adjustment = transforms.length ? ` Apply these layout adjustments: ${transforms.join(", ")}.` : "";
      return `Use this blocking/animatic frame only as a composition guide for camera framing, staged positions, scale, depth order, facing, spacing, and crop.${adjustment} Ignore identity, wardrobe, materials, colour, lighting, style, and all visible text.`;
    }
    return transforms.length ? `Use this as the visual base, then ${transforms.join(", ")}. Preserve its perspective unless the shot controls explicitly reinterpret it.` : "Use this as the visual base and preserve its perspective, geometry, and lighting unless the shot controls explicitly change them.";
  }

  shotCreationPromptReferences = window.shotCreationPromptReferences = function shotCreationPromptReferences607(s, frameId = "") {
    const refs = selectedShotReferences(s, frameId);
    const base = selectedBaseFrame(s);
    const groups = composerReferenceGroups(s);
    const out = [];
    if (base) out.push({ ...base, role: base.blocking ? "composition" : "base", mediaType: "image", priority: "primary", blockingAdherence: base.blockingAdherence || ensureShotCreation(s).blockingGuideAdherence || "strict", instruction: [baseFrameInstruction(s), base.instruction || ""].filter(Boolean).join(" ") });
    for (const ref of refs) {
      if (base && (ref.key === base.key || (ref.url && ref.url === base.url))) continue;
      const group = groups.find((item) => item.refs.some((candidate) => candidate.key === ref.key));
      const chosenView = ref.angleTag || group?.desiredView || "";
      const viewLabel = typeof referenceViewLabel === "function" ? referenceViewLabel(chosenView) : textLabel(chosenView);
      const kind = ref.referenceKind || "general";
      const metadata = [];
      if (["contact-sheet", "turnaround"].includes(kind)) {
        metadata.push(`This is a ${kind === "contact-sheet" ? "multi-angle contact sheet" : "turnaround"}. Use only the ${viewLabel || "shot-matching"} view or panel. Do not reproduce the sheet layout, panel borders, labels, or multiple views.`);
      } else if (kind === "detail") {
        metadata.push(`Use only for ${ref.detailRegion || viewLabel || "the specified detail region"}; do not inherit the source's wider framing.`);
      } else if (chosenView) {
        metadata.push(`Use the ${viewLabel} view for this shot.`);
      }
      if (ref.detailRegion && kind !== "detail") metadata.push(`Prioritize the ${ref.detailRegion} region.`);
      if (group?.regionNote) metadata.push(`Apply this reference only to the ${group.regionNote} region defined by the composition guide.`);
      const prepared = ref.role === "base"
        ? { ...ref, role: "location", instruction: `Use only for environmental continuity; ${base ? "the selected base frame controls composition." : "do not treat this as a mandatory composition base."} ${metadata.join(" ")} ${ref.instruction || ""}`.trim() }
        : { ...ref, guideRegion: group?.regionNote || "", selectedView: chosenView, instruction: [metadata.join(" "), ref.instruction || ""].filter(Boolean).join(" ") };
      out.push(prepared);
    }
    return out;
  };

  guidedFramePromptRefs = window.guidedFramePromptRefs = function guidedFramePromptRefs607(s, frame, index, state) {
    /* The frame's own declared states, resolved canonically downstream. */
    let out = shotCreationPromptReferences(s, frame?.id || "");
    if (index > 0 && state.usePreviousFrame) {
      const prev = guidedPreviousFrame(s, index);
      const take = prev ? guidedFrameApproved(s, prev, takesFor(s.id), index - 1) : null;
      if (take) {
        out = out.map((ref) => ref.role === "base" ? { ...ref, role: "location" } : ref).filter((ref) => ref.url !== take.url);
        out.unshift({ key: `previous-frame:${prev.id}:${take.name}`, entityId: s.id, label: `Approved Frame ${prev.label}`, file: take.name, url: take.url, role: "base", mediaType: "image", priority: "primary", approved: true, instruction: `Use approved Frame ${prev.label} as the exact starting composition and identity reference. Change only what Frame ${frame.label} requires.` });
      }
    }
    return compositionAugmentedReferences(s, out);
  };

  compositionSummary = window.compositionSummary = function compositionSummary607(s) {
    const c = ensureShotCreation(s), plan = c.composition, camera = plan.camera || {}, base = selectedBaseFrame(s);
    const pieces = [
      base ? `Base frame: ${base.label}. ${baseFrameInstruction(s)}` : "Base frame: blank canvas; construct the scene from assigned references.",
      `Frame setup: ${textLabel(camera.shotSize || "wide")}, ${textLabel(camera.height || "eye level")}, ${textLabel(camera.angle || "level")}, ${textLabel(camera.lens || "normal lens")}, ${textLabel(camera.view || "front view")}, ${textLabel(camera.layout || "rule of thirds")}, ${textLabel(camera.crop || "full scene")}.`,
      camera.reframe === "preserve-exact" ? "Preserve source framing exactly." : camera.reframe === "reinterpret" ? "Reinterpret the source framing to satisfy this composition." : "Preserve source framing loosely while matching this composition.",
      ...(plan.elements || []).filter((element) => !element.hidden).sort((a, b) => (+a.order || 0) - (+b.order || 0)).map((element) => compositionElementInstruction(s, element)),
      plan.mustInclude ? `Must include: ${plan.mustInclude}.` : "",
      plan.mustAvoid ? `Must avoid: ${plan.mustAvoid}.` : "",
    ];
    return pieces.filter(Boolean).join("\n");
  };
  compositionAugmentedReferences = window.compositionAugmentedReferences = function compositionAugmentedReferences607(s, refs) {
    return (refs || []).map((ref) => ({ ...ref }));
  };

  function profileById(id) { return (PROMPT_LIBRARY?.profiles || []).find((profile) => profile.id === id) || null; }
  function referenceScore(ref, index) {
    const roleScore = { base: 1200, "first-frame": 1180, "last-frame": 1160, identity: 900, location: 820, prop: 780, composition: 760, "continuity-state": 720, outfit: 680, body: 660, turnaround: 620, "alternate-view": 600, pose: 540, lighting: 420, reference: 300, "audio-timing": 1000, "motion-reference": 700 }[ref.role] || 350;
    return roleScore + (ref.priority === "primary" ? 180 : 0) + (ref.staged ? 100 : 0) - index / 1000;
  }
  function fitReferencesToProfile(profile, refs) {
    const rows = (refs || []).map((ref, index) => ({ ref, index, score: referenceScore(ref, index), mediaType: mediaTypeForRef(ref) }));
    // MiniMax H3 addresses each modality by provider-list order. Preserve the
    // deliberately constructed CineBraid order so sequential keyframes remain
    // Image 1..N and the UI, prompt, payload, and provenance all agree.
    if (profile?.family === "minimax-h3") rows.sort((a, b) => a.index - b.index);
    else rows.sort((a, b) => b.score - a.score);
    const totalLimit = Number.isFinite(+profile?.limits?.maxReferences) ? +profile.limits.maxReferences : rows.length;
    const typeLimits = {
      image: Number.isFinite(+profile?.limits?.maxImages) ? +profile.limits.maxImages : totalLimit,
      video: Number.isFinite(+profile?.limits?.maxVideos) ? +profile.limits.maxVideos : totalLimit,
      audio: Number.isFinite(+profile?.limits?.maxAudio) ? +profile.limits.maxAudio : (profile?.supports?.audio ? totalLimit : 0),
    };
    const counts = { image: 0, video: 0, audio: 0 }, assigned = [], dropped = [];
    for (const row of rows) {
      if (assigned.length >= totalLimit) { dropped.push({ ...row.ref, dropReason: `target limit of ${totalLimit} total references reached` }); continue; }
      if (counts[row.mediaType] >= typeLimits[row.mediaType]) { dropped.push({ ...row.ref, dropReason: `target ${row.mediaType} limit of ${typeLimits[row.mediaType]} reached` }); continue; }
      counts[row.mediaType] += 1;
      assigned.push({ ...row.ref, mediaType: row.mediaType });
    }
    return { assigned, dropped, counts, totalLimit, typeLimits };
  }
  function referenceAlias(profile, ref, refs) {
    const same = refs.filter((item) => mediaTypeForRef(item) === mediaTypeForRef(ref));
    const typeIndex = same.findIndex((item) => item.key === ref.key) + 1;
    const globalIndex = refs.findIndex((item) => item.key === ref.key) + 1;
    if (profile?.refSyntax === "typed-omni") return `@${mediaTypeForRef(ref)}${typeIndex}`;
    if (profile?.refSyntax === "typed-h3") {
      const kind = mediaTypeForRef(ref);
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${typeIndex}`;
    }
    if (profile?.refSyntax === "#imageN") return `#image${globalIndex}`;
    if (profile?.refSyntax === "@imageN") return `@image${globalIndex}`;
    return `Reference ${globalIndex}`;
  }
  function packagePreviewMarkup(profile, budget, title = "Generation package") {
    const assigned = budget.assigned || [], dropped = budget.dropped || [];
    return `<details class="composer-package-preview"><summary><div><b>${esc(title)}</b><small>${assigned.length} of ${budget.totalLimit} slots assigned${dropped.length ? ` · ${dropped.length} dropped` : ""}</small></div><span class="${dropped.length ? "warn" : "ok"}">${assigned.length}/${budget.totalLimit}</span></summary><div class="composer-package-list">${assigned.map((ref) => `<div><code>${esc(referenceAlias(profile, ref, assigned))}</code><span><b>${esc(ref.label || "Reference")}</b><small>${esc(guidedReferenceRoleLabel(ref))}${ref.instruction ? ` · ${esc(ref.instruction)}` : ""}</small></span></div>`).join("") || `<p>No reference inputs will be sent to this target.</p>`}</div>${dropped.length ? `<div class="composer-package-dropped"><b>Dropped by target limits</b>${dropped.map((ref) => `<span>${esc(ref.label || "Reference")} — ${esc(ref.dropReason)}</span>`).join("")}</div>` : ""}</details>`;
  }
  function frameReferenceBudget(s, frame, index, state) {
    const raw = guidedFramePromptRefsRaw607(s, frame, index, state).filter((ref) => ref.url);
    const mode = guidedFrameMode(state, raw);
    const profileId = preferredCreationProfile(mode, state.profileId || P.meta?.promptDefaults?.imageProfile || "");
    const profile = profileById(profileId);
    return { profile, profileId, mode, raw, ...fitReferencesToProfile(profile, raw) };
  }

  const guidedFramePromptRefsRaw607 = guidedFramePromptRefs;
  guidedFramePromptRefs = window.guidedFramePromptRefs = function guidedFramePromptRefsBudgeted(s, frame, index, state) {
    const raw = guidedFramePromptRefsRaw607(s, frame, index, state);
    const mode = guidedFrameMode(state, raw);
    const profile = profileById(preferredCreationProfile(mode, state.profileId || P.meta?.promptDefaults?.imageProfile || ""));
    return fitReferencesToProfile(profile, raw).assigned;
  };

  const guidedFrameCard606 = guidedFrameCard;
  guidedFrameCard = window.guidedFrameCard = function guidedFrameCard607(s, frame, index, takes) {
    const html = guidedFrameCard606(s, frame, index, takes);
    const state = guidedFrameState(s, frame, index);
    const budget = frameReferenceBudget(s, frame, index, state);
    return html.replace('<div class="guided-compile-bar guided-frame-compile">', `${packagePreviewMarkup(budget.profile, budget, `Frame ${frame.label} package`)}<div class="guided-compile-bar guided-frame-compile">`);
  };

  const framePromptResult606 = guidedFramePromptResult;
  guidedFramePromptResult = window.guidedFramePromptResult = function guidedFramePromptResult607(s, frame, build) {
    let html = framePromptResult606(s, frame, build);
    if (build.droppedReferences?.length) html = html.replace("</article>", `<details class="composer-package-dropped-result"><summary>${build.droppedReferences.length} reference${build.droppedReferences.length === 1 ? "" : "s"} omitted by target limits</summary>${build.droppedReferences.map((ref) => `<span>${esc(ref.label || "Reference")} — ${esc(ref.dropReason || "target limit")}</span>`).join("")}</details></article>`);
    return html;
  };

  const buildGuidedFramePrompt606 = window.buildGuidedFramePrompt;
  window.buildGuidedFramePrompt = async (id, frameId, useLLM = false) => {
    const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
    if (index < 0) return;
    const state = guidedFrameState(s, frames[index], index), budget = frameReferenceBudget(s, frames[index], index, state);
    await buildGuidedFramePrompt606(id, frameId, useLLM);
    const build = latestPromptBuild(P, state.promptBuilds);
    if (build) {
      build.droppedReferences = clone(budget.dropped);
      build.referenceBudget = { totalLimit: budget.totalLimit, typeLimits: budget.typeLimits, counts: budget.counts };
      dirty();
    }
  };

  function isLocationReference607(ref) {
    return !!ref && ((P.locations || []).some((item) => item.id === ref.entityId) || ["base", "location"].includes(ref.role));
  }
  window.openShotInputsPanel = (id) => {
    const s = shotById(id), c = ensureShotCreation(s);
    c.openPanels.inputs = true;
    dirty();
    route();
  };
  function composerEmptyState607(s) {
    const resolved = resolveShotEntities(P, s);
    const attached = [...resolved.characters, ...resolved.locations, ...resolved.props];
    if (!attached.length)
      return `<div class="guided-empty-inline"><b>No cast or assets yet.</b><span>Attach the shot location, characters, or props before staging it.</span><button class="ghost-btn" onclick="openShotInputsPanel('${s.id}')">CHOOSE CAST & ASSETS</button></div>`;
    /* WORKFLOW, NOT CANON. Staging needs a usable image on disk; whether the
       creator approved it is a different question and is not the one this
       message answers. The wording says so. */
    const missingFile = attached.filter((entity) => entity.approvedFile && !shotCreationReferences(s).some((ref) => ref.entityId === entity.id && ref.url));
    if (missingFile.length)
      return `<div class="guided-empty-inline"><b>${esc(missingFile.map((item) => item.name || item.id).join(", "))} reference image is missing from the local project folders.</b><span>Restore the file, then sync local folders.</span><button class="ghost-btn" onclick="document.getElementById('rescan')?.click()">SYNC LOCAL FOLDERS</button></div>`;
    const withoutImage = attached.filter((entity) => !entity.approvedFile);
    if (withoutImage.length)
      return `<div class="guided-empty-inline"><b>${esc(withoutImage.map((item) => item.name || item.id).join(", "))} ${withoutImage.length === 1 ? "has" : "have"} no reference image yet.</b><span>Open the attached record and approve a usable reference.</span><button class="ghost-btn" onclick="openShotInputsPanel('${s.id}')">REVIEW ATTACHED ASSETS</button></div>`;
    return `<div class="guided-empty-inline"><b>No usable staging references are enabled.</b><span>Re-enable an attached image in Source & References.</span><button class="ghost-btn" onclick="openShotInputsPanel('${s.id}')">MANAGE REFERENCES</button></div>`;
  }
  function referenceSetsMarkup(s) {
    const activeGuide = typeof activeBlockingRow === "function" ? activeBlockingRow(s) : null;
    let groups = composerReferenceGroups(s);
    if (activeGuide) {
      groups = groups.map((group) => {
        const refs = group.refs.filter((ref) => !ref.blocking && !["composition","blocking-frame","storyboard","animatic-frame"].includes(ref.role || ref.sourceRole));
        if (!refs.length) return null;
        const primary = refs.some((ref) => ref.key === group.primary) ? group.primary : refs[0].key;
        return { ...group, refs, primary, supporting: new Set([...group.supporting].filter((key) => refs.some((ref) => ref.key === key) && key !== primary)) };
      }).filter(Boolean);
    }
    if (!groups.length) return composerEmptyState607(s);
    return groups.map((group) => {
      const primaryRef = group.refs.find((ref) => ref.key === group.primary) || group.refs[0];
      const locationGroup = isLocationReference607(primaryRef);
      const desiredLabel = group.desiredView ? (typeof referenceViewLabel === "function" ? referenceViewLabel(group.desiredView) : textLabel(group.desiredView)) : "";
      const assigned = !!group.explicit;
      const headerAction = activeGuide
        ? `<span class="composer-assignment-state ${assigned ? "is-assigned" : "is-suggested"}">${assigned ? "ASSIGNED" : "SUGGESTED"}</span>`
        : !primaryRef?.url
          ? `<span class="composer-assignment-state">UNAVAILABLE</span>`
          : `<span class="composer-assignment-state ${assigned ? "is-assigned" : "is-suggested"}">${assigned ? "SELECTED" : "AUTO"}</span>`;
      const regionPlaceholder = locationGroup
        ? "background environment, gate, floor, sky…"
        : "camera-left figure, face placeholder, rear wheel…";
      const viewOptions = [["", "Auto from shot"], ...(typeof REFERENCE_VIEW_OPTIONS !== "undefined" ? REFERENCE_VIEW_OPTIONS.filter(([key]) => key && !["multi-angle", "custom"].includes(key)) : [])]
        .map(([value, label]) => `<option value="${attr(value)}" ${String((ensureShotCreation(s).composition.referenceSets[group.key] || {}).desiredView || "") === value ? "selected" : ""}>${esc(label)}</option>`).join("");
      return `<article class="composer-reference-set ${locationGroup ? "location-base-set" : ""}"><header><div><b>${esc(group.label)}</b><small>${group.refs.length} view${group.refs.length === 1 ? "" : "s"}${locationGroup ? " · environment" : desiredLabel ? ` · shot wants ${esc(desiredLabel)}` : ""}</small></div>${headerAction}</header>${!locationGroup ? `<label class="composer-view-override"><span>Reference angle</span><select onchange="setComposerReferenceDesiredView('${s.id}','${attr(group.key)}',this.value)">${viewOptions}</select><small>${group.explicit && (ensureShotCreation(s).composition.referenceSets[group.key] || {}).desiredView ? "Manual override" : `Auto-selected from shot context: ${esc(desiredLabel || "Front three-quarter")}`}</small></label>` : ""}${activeGuide ? `<label class="composer-guide-region"><span>Guide region / role</span><input data-guide-region="${attr(group.key)}" value="${attr(group.regionNote || "")}" onchange="setComposerReferenceRegion('${s.id}','${attr(group.key)}',this.value)" placeholder="${attr(regionPlaceholder)}"></label>` : ""}<div class="composer-reference-variants">${group.refs.map((ref) => {
        const primary = ref.key === group.primary, supporting = group.supporting.has(ref.key), unavailable = !ref.url;
        const kind = ref.referenceKind || "general";
        const angle = ref.angleTag ? (typeof referenceViewLabel === "function" ? referenceViewLabel(ref.angleTag) : textLabel(ref.angleTag)) : "";
        const metadata = [angle, ref.detailRegion || "", ["contact-sheet","turnaround"].includes(kind) ? (kind === "contact-sheet" ? "multi-angle sheet" : "turnaround") : ""].filter(Boolean).join(" · ");
        const route = isLocationReference607(ref) ? "location" : ref.role === "identity" ? "character" : "prop";
        const action = unavailable
          ? `<a class="chip" href="#/${route}/${attr(ref.entityId || "")}">OPEN</a>`
          : "";
        const edit = ref.assetId && ref.linkId ? `<button class="chip composer-tag-button" onclick="openReferenceMetadataEditor('${attr(ref.assetId)}','${attr(ref.linkId)}')">TAG</button>` : "";
        return `<div class="composer-reference-variant ${primary ? "primary" : ""} ${unavailable ? "unavailable" : ""}">${ref.url ? `<img src="${attr(ref.url)}" alt="" loading="lazy" decoding="async">` : `<span class="guided-input-placeholder">${esc((ref.label || "?").slice(0,1))}</span>`}<span class="composer-reference-copy"><b>${esc(ref.label || angle || "Reference")}</b><small>${esc(metadata || guidedReferenceRoleLabel(ref))}${unavailable ? ` · ${ref.approved ? "file missing" : "approval needed"}` : ""}${primary && group.suggestedPrimary && !group.explicit ? " · suggested match" : ""}</small></span><div class="composer-reference-controls"><label class="composer-choice"><input type="radio" name="primary-${attr(s.id)}-${attr(group.key)}" ${primary ? "checked" : ""} onchange="setComposerReferencePrimary('${s.id}','${attr(group.key)}','${attr(ref.key)}')"><span>Primary</span></label>${!primary ? `<label class="composer-choice"><input type="checkbox" ${supporting ? "checked" : ""} onchange="toggleComposerReferenceSupport('${s.id}','${attr(group.key)}','${attr(ref.key)}',this.checked)"><span>Support</span></label>` : `<span class="composer-primary-badge">SELECTED</span>`}${edit}${action}</div></div>`;
      }).join("")}</div></article>`;
    }).join("");
  }


  guidedShotComposerPanel = window.guidedShotComposerPanel = function guidedShotComposerPanel607(s, open = false) {
    const c = ensureShotCreation(s), plan = c.composition, activeGuide = typeof activeBlockingRow === "function" ? activeBlockingRow(s) : null;
    const refs = `<div class="composer-reference-tray grouped"><header><div><b>${activeGuide ? "Assign appearance references to the guide" : "Choose reference angles"}</b><small>${activeGuide ? "The guide controls geometry only. Choose the best identity, object, and location-design references for the finished frame." : "Choose one primary view per entity and optionally include a supporting detail when the target has room."}</small></div><button class="ghost-btn" onclick="openComposerReferenceModal('${s.id}')">Add project reference</button></header><div class="composer-reference-set-grid">${referenceSetsMarkup(s)}</div></div>`;
    const constraints = `<div class="composer-constraints"><label><span>Must include</span><input value="${attr(plan.mustInclude || "")}" onchange="setComposerConstraint('${s.id}','mustInclude',this.value)" placeholder="Required relationships, signs, contact points…"></label><label><span>Must avoid</span><input value="${attr(plan.mustAvoid || "")}" onchange="setComposerConstraint('${s.id}','mustAvoid',this.value)" placeholder="Wrong angle, duplicate prop, blocked face…"></label></div>`;
    const rule = activeGuide
      ? `<div class="blocking-geometry-rule"><b>Blocking is geometry only.</b> Preserve crop, camera, broad positions, scale, depth, pose, and contact points. Finished architecture, fence or gate patterns, terrain, surfaces, set dressing, materials, colour, and lighting come from the approved location references and canon—not from the grayscale guide.</div>`
      : `<div class="guided-next-note"><b>Reference setup:</b> choose the strongest angle for each visible entity. A blocking guide is recommended when exact composition matters.</div>`;
    const title = activeGuide ? "Assign references to blocking guide" : "Choose production references";
    return `<details class="guided-work-panel shot-composer-card v607" data-guided-panel="composer" ${guidedPanelOpen(s, "composer", open) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','composer',this.open)"><summary><div><span>FINAL REFERENCES · REVIEW</span><b>${title}</b><small>${activeGuide ? "Blocking controls where things are; approved references control what everything actually looks like." : "Select the exact identity, object, and location views used by the final-frame prompt."}</small></div><span class="guided-mode-pill ${activeGuide ? "ready" : ""}">${activeGuide ? "GUIDE + REFERENCES" : "REFERENCE SETS"}</span><i>⌄</i></summary><div class="guided-work-panel-body shot-composer-body"><div class="guide-first-assignment">${rule}${refs}${constraints}</div></div></details>`;
  };

  window.setComposerReferenceDesiredView = (id, groupKey, value) => {
    const s = shotById(id), c = ensureShotCreation(s), group = composerReferenceGroups(s).find((item) => item.key === groupKey);
    if (!group) return;
    const desiredView = String(value || "");
    const existing = c.composition.referenceSets[groupKey] || {};
    if (!desiredView) {
      if (existing.regionNote) c.composition.referenceSets[groupKey] = { regionNote: existing.regionNote };
      else delete c.composition.referenceSets[groupKey];
    } else {
      const ranked = [...group.refs].sort((a, b) => {
        const score = (ref) => typeof referenceViewScore === "function" ? referenceViewScore(desiredView, ref.angleTag, { referenceKind: ref.referenceKind || "general", priority: ref.priority || "" }) + (ref.url ? 12 : 0) + (ref.approved ? 5 : 0) : 0;
        return score(b) - score(a);
      });
      c.composition.referenceSets[groupKey] = { ...existing, desiredView, primaryKey: ranked[0]?.key || group.primary, supportingKeys: [] };
    }
    c.openPanels.composer = true;
    dirty(); route();
  };
  window.setComposerReferenceRegion = (id, groupKey, value) => {
    const s = shotById(id), c = ensureShotCreation(s), group = composerReferenceGroups(s).find((item) => item.key === groupKey);
    if (!group) return;
    const current = c.composition.referenceSets[groupKey] || { primaryKey: group.primary, supportingKeys: [...group.supporting] };
    c.composition.referenceSets[groupKey] = { ...current, regionNote: String(value || "").trim() };
    c.openPanels.composer = true;
    dirty();
  };
  window.setComposerReferencePrimary = (id, groupKey, refKey) => {
    const s = shotById(id), c = ensureShotCreation(s), group = composerReferenceGroups(s).find((item) => item.key === groupKey);
    if (!group) return;
    const oldPrimary = group.primary;
    const support = new Set([...group.supporting]);
    support.delete(refKey);
    if (oldPrimary && oldPrimary !== refKey) support.add(oldPrimary);
    c.composition.referenceSets[groupKey] = { ...(c.composition.referenceSets[groupKey] || {}), primaryKey: refKey, supportingKeys: [...support] };
    for (const element of c.composition.elements) if (element.referenceKey === oldPrimary) element.referenceKey = refKey;
    c.openPanels.composer = true;
    dirty(); route();
  };
  window.toggleComposerReferenceSupport = (id, groupKey, refKey, enabled) => {
    const s = shotById(id), c = ensureShotCreation(s), group = composerReferenceGroups(s).find((item) => item.key === groupKey);
    if (!group) return;
    const support = new Set([...group.supporting]);
    enabled ? support.add(refKey) : support.delete(refKey);
    c.composition.referenceSets[groupKey] = { ...(c.composition.referenceSets[groupKey] || {}), primaryKey: group.primary, supportingKeys: [...support] };
    c.openPanels.composer = true;
    dirty(); route();
  };
  window.setComposerConstraint = (id, key, value) => { const s = shotById(id); ensureShotCreation(s).composition[key] = value; dirty(); };

  function activeMotionUnit(s, create = true) {
    const c = ensureShotCreation(s);
    let unit = (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || (s.clips || [])[0] || null;
    if (!unit && create) unit = ensureGuidedMotionUnit(s, guidedCurrentShotStill(s)?.name || "", null);
    if (unit) c.activeMotionUnitId = unit.id;
    return unit;
  }
  function effectiveMotionPlan(s, unit = activeMotionUnit(s)) { return unit?.motionPlan ? normalizeMotionPlan607(unit.motionPlan) : ensureShotCreation(s).motionPlan; }
  function ensureUnitMotionPlan(s, unit = activeMotionUnit(s)) { if (!unit) return ensureShotCreation(s).motionPlan; if (!unit.motionPlan) unit.motionPlan = clone(ensureShotCreation(s).motionPlan); return normalizeMotionPlan607(unit.motionPlan); }
  function targetOptions(s, currentId = "") {
    const rows = [];
    const resolved = typeof resolveShotEntities === "function"
      ? resolveShotEntities(P, s)
      : { characters: [], props: [] };
    for (const x of resolved.characters || [])
      if (x.id !== currentId) rows.push({ id: x.id, label: x.name || x.id });
    for (const x of resolved.props || [])
      if (x.id !== currentId && !rows.some((row) => row.id === x.id)) rows.push({ id: x.id, label: x.name || x.id });
    for (const element of ensureShotCreation(s).composition.elements || []) {
      const ref = compositionReferenceByKey(s, element.referenceKey);
      const id = ref?.entityId || element.id;
      if (id !== currentId && !rows.some((row) => row.id === id))
        rows.push({ id, label: ref?.entityName || ref?.label || element.label || id });
    }
    return rows;
  }
  function targetLabelFor(s, targetId) { return targetOptions(s).find((item) => item.id === targetId)?.label || actualEntity(targetId)?.name || targetId || ""; }

  ensureGuidedMotionUnit = window.ensureGuidedMotionUnit = function ensureGuidedMotionUnit607(s, currentName = "", profile = null) {
    normalizeShotV5(s);
    const frames = guidedFrames(s), c = ensureShotCreation(s);
    let unit = (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || (s.clips || [])[0];
    if (!unit) {
      unit = { id: `seg-guided-${Date.now().toString(36)}`, suffix: "a", label: "A", title: "Primary motion", dur: 5, kind: "i2v", note: "", motionPrompt: "", fromFrame: frames[0]?.id || "", toFrame: "", generationPackages: [], motionPlan: null };
      s.clips = [unit];
    }
    c.activeMotionUnitId = unit.id;
    if (!unit.fromFrame) unit.fromFrame = frames[0]?.id || "";
    /* BATCH 1B: MOTION SETUP DOES NOT ESTABLISH FRAME AUTHORITY.

       This used to write `frames[0].winner = currentName` — a production
       authority edge, written as a side effect of opening the motion composer,
       by a function no human command ever reaches directly. It is exactly the
       "private re-answer" the architecture forbids. A motion unit points AT the
       opening frame; it does not decide what that frame is. Where the shot
       already carries an approved image the opening frame resolves through it
       anyway, so nothing that was true before this line stops being true. */
    if (profile?.mode === "flf" && !unit.toFrame) {
      const last = [...frames].reverse().find((frame, reverseIndex) => guidedFrameApproved(s, frame, takesFor(s.id), frames.length - 1 - reverseIndex));
      if (last && last.id !== unit.fromFrame) unit.toFrame = last.id;
    }
    if (profile?.mode) unit.kind = profile.mode === "audio-video" ? "r2v" : profile.mode;
    unit.generationPackages = unit.generationPackages || [];
    return unit;
  };
  motionSubjectPlan = window.motionSubjectPlan = function motionSubjectPlan607(holder, id) {
    holder.motionPlan = holder.motionPlan || holder;
    const plan = normalizeMotionPlan607(holder.motionPlan);
    plan.subjects[id] = plan.subjects[id] && typeof plan.subjects[id] === "object" ? plan.subjects[id] : { action: "still", direction: "", intensity: "subtle", look: "", targetId: "", targetLabel: "", destination: "", notes: "" };
    return plan.subjects[id];
  };
  motionPropPlan = window.motionPropPlan = function motionPropPlan607(holder, id) {
    holder.motionPlan = holder.motionPlan || holder;
    const plan = normalizeMotionPlan607(holder.motionPlan);
    plan.props[id] = plan.props[id] && typeof plan.props[id] === "object" ? plan.props[id] : { action: "static", direction: "", targetId: "", targetLabel: "", destination: "", notes: "" };
    return plan.props[id];
  };
  structuredMotionSummary = window.structuredMotionSummary = function structuredMotionSummary607(s) {
    const c = ensureShotCreation(s), unit = activeMotionUnit(s), plan = effectiveMotionPlan(s, unit), camera = plan.camera || {}, lines = [];
    if (camera.move && camera.move !== "none") lines.push(`Camera: ${textLabel(camera.move)}${camera.direction ? ` ${textLabel(camera.direction)}` : ""}, ${camera.intensity || "subtle"}, ${camera.style || "smooth"}; ${camera.framing === "allow-reframe" ? "reframing allowed" : "preserve the staged composition"}.`);
    for (const id of s.characters || []) {
      const x = P.characters.find((item) => item.id === id), p = plan.subjects[id] || { action: "still" }, target = p.targetLabel || targetLabelFor(s, p.targetId);
      if (p.action && p.action !== "still") lines.push(`${x?.name || id}: ${textLabel(p.action)}${target ? ` toward or in relation to ${target}` : p.direction ? ` toward ${textLabel(p.direction)}` : ""}${p.destination ? `, ending ${p.destination}` : ""}, ${p.intensity || "natural"}${p.look ? `; looks ${textLabel(p.look)}` : ""}${p.notes ? `; ${p.notes}` : ""}.`);
      else lines.push(`${x?.name || id} remains still except for natural breathing and blinking${p.notes ? `; ${p.notes}` : ""}.`);
    }
    for (const id of c.propIds || []) {
      const x = [...(P.props || []), ...(P.vehicles || [])].find((item) => item.id === id), p = plan.props[id] || { action: "static" }, target = p.targetLabel || targetLabelFor(s, p.targetId);
      lines.push(`${x?.name || id}: ${textLabel(p.action || "static")}${target ? ` in relation to ${target}` : p.direction ? ` ${textLabel(p.direction)}` : ""}${p.destination ? `, ending ${p.destination}` : ""}${p.notes ? `; ${p.notes}` : ""}.`);
    }
    const env = plan.environment || {};
    lines.push(env.action && env.action !== "static" ? `Environment: ${textLabel(env.action)}, ${env.intensity || "subtle"}${env.notes ? `; ${env.notes}` : ""}.` : "Environment remains stable unless explicitly animated above.");
    const timing = plan.timing || {};
    lines.push(`Timing: ${timing.onset || "immediate"} onset, ${timing.pacing || "natural"} pacing${timing.holdEnd ? "; settle and hold the final state" : ""}${timing.secondary ? `; secondary action: ${timing.secondary}` : ""}.`);
    const audio = plan.audio || {};
    if (audio.mode === "lip-sync-reference" && audio.referenceKey) { const ref = shotPlanningGenerationReferences(s, ["audio"]).find((item) => item.key === audio.referenceKey), speaker = P.characters.find((item) => item.id === audio.speakerId); lines.push(`${speaker?.name || audio.speakerId || "The selected character"} is the only speaking character and lip-syncs the dialogue from ${ref?.label || "the linked audio reference"}${audio.direction ? ` with ${audio.direction}` : ""}.`); }
    return lines.join("\n");
  };
  motionSubjectControls = window.motionSubjectControls = function motionSubjectControls607(s) {
    const plan = effectiveMotionPlan(s), targets = targetOptions(s);
    return (s.characters || []).map((id) => { const x = P.characters.find((item) => item.id === id), p = plan.subjects[id] || { action: "still", direction: "", intensity: "subtle", look: "", targetId: "", destination: "", notes: "" }; return `<article class="motion-director-subject"><header><b>${esc(x?.name || id)}</b><span>CHARACTER</span></header><div class="motion-director-grid"><label><span>Action</span><select onchange="setMotionSubject('${s.id}','${id}','action',this.value)">${composerOptions([["still","Remain still"],["idle","Subtle idle"],["head-turn","Head turn"],["look","Eye / gaze move"],["gesture","Gesture"],["walk","Walk"],["run","Run"],["sit","Sit"],["stand","Stand"],["enter-frame","Enter frame"],["exit-frame","Exit frame"],["interact-prop","Interact with target"]], p.action)}</select></label><label><span>Direction</span><select onchange="setMotionSubject('${s.id}','${id}','direction',this.value)">${composerOptions([["","Not specified"],["screen-left","Screen left"],["screen-right","Screen right"],["toward-camera","Toward camera"],["away-camera","Away from camera"]], p.direction)}</select></label><label><span>Target</span><select onchange="setMotionSubject('${s.id}','${id}','targetId',this.value)"><option value="">No direct target</option>${targets.filter((target) => target.id !== id).map((target) => `<option value="${attr(target.id)}" ${p.targetId === target.id ? "selected" : ""}>${esc(target.label)}</option>`).join("")}</select></label><label><span>Intensity</span><select onchange="setMotionSubject('${s.id}','${id}','intensity',this.value)">${composerOptions([["subtle","Subtle"],["natural","Natural"],["energetic","Energetic"]], p.intensity)}</select></label><label><span>Look</span><select onchange="setMotionSubject('${s.id}','${id}','look',this.value)">${composerOptions([["","Unspecified"],["camera-left","Camera left"],["camera-right","Camera right"],["toward-camera","Toward camera"],["away-camera","Away from camera"],["at-target","At selected target"]], p.look)}</select></label><label><span>End position</span><input value="${attr(p.destination || "")}" onchange="setMotionSubject('${s.id}','${id}','destination',this.value)" placeholder="at the driver-side door"></label><label class="wide"><span>Custom direction</span><input value="${attr(p.notes || "")}" onchange="setMotionSubject('${s.id}','${id}','notes',this.value)" placeholder="Reaches for the handle without crossing in front of the car…"></label></div></article>`; }).join("") || `<div class="guided-empty-inline"><b>No character assigned to this shot.</b><span>Add characters in Source & References before directing character movement.</span></div>`;
  };
  motionPropControls = window.motionPropControls = function motionPropControls607(s) {
    const c = ensureShotCreation(s), plan = effectiveMotionPlan(s), targets = targetOptions(s);
    return (c.propIds || []).map((id) => { const x = [...(P.props || []), ...(P.vehicles || [])].find((item) => item.id === id), p = plan.props[id] || { action: "static", direction: "", targetId: "", destination: "", notes: "" }; return `<article class="motion-director-subject"><header><b>${esc(x?.name || id)}</b><span>PROP / VEHICLE</span></header><div class="motion-director-grid"><label><span>Action</span><select onchange="setMotionProp('${s.id}','${id}','action',this.value)">${composerOptions([["static","Static"],["move","Move"],["picked-up","Picked up"],["set-down","Set down"],["open","Open"],["close","Close"],["start","Start"],["stop","Stop"],["pass-frame","Pass through frame"]], p.action)}</select></label><label><span>Direction</span><select onchange="setMotionProp('${s.id}','${id}','direction',this.value)">${composerOptions([["","Not specified"],["screen-left","Screen left"],["screen-right","Screen right"],["toward-camera","Toward camera"],["away-camera","Away from camera"]], p.direction)}</select></label><label><span>Target</span><select onchange="setMotionProp('${s.id}','${id}','targetId',this.value)"><option value="">No direct target</option>${targets.filter((target) => target.id !== id).map((target) => `<option value="${attr(target.id)}" ${p.targetId === target.id ? "selected" : ""}>${esc(target.label)}</option>`).join("")}</select></label><label><span>End position</span><input value="${attr(p.destination || "")}" onchange="setMotionProp('${s.id}','${id}','destination',this.value)" placeholder="stops at the curb"></label><label class="wide"><span>Custom direction</span><input value="${attr(p.notes || "")}" onchange="setMotionProp('${s.id}','${id}','notes',this.value)" placeholder="Car remains parked; headlights turn on…"></label></div></article>`; }).join("");
  };
  motionDirectorMap = window.motionDirectorMap = function motionDirectorMap607(s) {
    const c = ensureShotCreation(s), plan = c.composition, motion = effectiveMotionPlan(s), camera = motion.camera || {};
    const current = guidedCurrentShotStill(s);
    const refs = shotCreationReferences(s);
    const markers = (plan.elements || []).filter((element) => !element.hidden).map((element) => {
      const ref = refs.find((item) => item.key === element.referenceKey);
      const entityId = ref?.entityId || element.id;
      const subject = motion.subjects?.[entityId], prop = motion.props?.[entityId];
      const direction = subject?.direction || prop?.direction || "";
      const action = subject?.action || prop?.action || "";
      const target = subject?.targetLabel || prop?.targetLabel || targetLabelFor(s, subject?.targetId || prop?.targetId);
      return `<div class="motion-map-marker depth-${attr(element.depth || "midground")}" style="left:${finite(element.x,.5,0,1)*100}%;top:${finite(element.y,.5,0,1)*100}%;width:${finite(element.w,.25,.08,1)*100}%;height:${finite(element.h,.25,.08,1)*100}%"><span>${esc(ref?.entityName || ref?.label || element.label || "Element")}${target ? ` → ${esc(target)}` : ""}</span>${direction ? `<i>${motionDirectionGlyph(direction)}</i>` : `<i class="locked">•</i>`}${action && !["still","static"].includes(action) ? `<small>${esc(textLabel(action))}</small>` : ""}</div>`;
    }).join("");
    const base = current?.url
      ? `<img class="motion-map-base" src="${attr(current.url)}" alt="Approved opening frame">`
      : `<div class="motion-map-no-base"><b>No approved opening image available</b><span>Approve Frame A before directing motion.</span></div>`;
    return `<div class="motion-map-wrap"><div class="motion-map" style="aspect-ratio:${composerAspectStyle(plan.aspectRatio)}">${base}${markers}<div class="motion-camera-glyph"><b>CAMERA</b><span>${motionDirectionGlyph(camera.direction)} ${esc(textLabel(camera.move || "locked"))}</span></div></div><small>The approved opening frame is the actual video input. Outlines show assignments only; source-reference thumbnails are never composited into this preview.</small></div>`;
  };

  function motionUnitTabs(s) {
    const c = ensureShotCreation(s), unit = activeMotionUnit(s);
    return `<details class="motion-unit-tabs"><summary><div><b>Motion unit ${esc(unit?.label || "A")}</b><small>${esc(unit?.title || "Primary motion")} · ${+unit?.dur || 0}s · ${unit?.motionPlan ? "custom overrides" : "inherits shot defaults"}</small></div><span>${(s.clips || []).length} UNIT${(s.clips || []).length === 1 ? "" : "S"}</span></summary><div class="motion-unit-tab-body"><div>${(s.clips || []).map((item) => `<button class="${item.id === unit?.id ? "active" : ""}" onclick="selectMotionUnit('${s.id}','${item.id}')"><b>${esc(item.label || item.suffix || "Unit")}</b><span>${esc(item.title || "Motion")} · ${+item.dur || 0}s</span></button>`).join("")}<button onclick="addGuidedMotionUnit('${s.id}')">＋ Add unit</button></div>${unit ? `<footer><span>${unit.motionPlan ? "CUSTOM OVERRIDES" : "INHERITING SHOT DEFAULTS"}</span><button onclick="resetMotionUnitPlan('${s.id}','${unit.id}')">Reset to defaults</button><button onclick="setMotionUnitAsDefaults('${s.id}','${unit.id}')">Use as shot defaults</button></footer>` : ""}</div></details>`;
  }
  const guidedMotionReferencesRaw607 = guidedMotionReferences;
  function gatherMotionReferences607(s, current, profile) {
    /* MULTI-FRAME IS A DIFFERENT PACKAGE, and creation-studio.js already builds it.
     *
     * This collector knows two visual anchors: the opening frame and an optional
     * endpoint. MiniMax H3's multi-frame workflow is not two anchors — it is an
     * ORDERED SEQUENCE of approved beats, which is what the H3 keyframe panel exists
     * to author: it stores an enable flag, an order and a beat note per frame, and
     * tells the filmmaker those images are "sent to FAL in this exact order as
     * Image 1, Image 2, and onward".
     *
     * The implementation that honours that contract has always been the one in
     * creation-studio.js — it is the only producer of role `sequential-keyframe`
     * anywhere in the browser, and the compiler, the H3 pack and the fal serializer
     * have all understood that role since the panel shipped. This file captured it
     * on the line above and then never called it, so every multi-frame shot compiled
     * with one approved frame and the panel's ordering, its enable flags and its beat
     * notes reached nothing.
     *
     * Delegating is the whole repair: the sequence is built by its own author, and
     * the budgeting below still applies on top. */
    if (profile?.family === "minimax-h3" && profile.mode === "r2v")
      return guidedMotionReferencesRaw607(s, current, profile);
    /* TEXT TO VIDEO CARRIES NOTHING. fal's H3 t2v schema declares no reference media
       at all (`fal-h3-backend.js` modeSupport.t2v), so an image gathered here could
       only be dropped later — and a package preview listing references the request
       cannot hold is the same lie as a model picker offering a model that cannot run. */
    if (profile?.mode === "t2v") return [];
    const unit = activeMotionUnit(s), frames = guidedFrames(s), refs = [];
    const startFrame = frames.find((frame) => frame.id === unit?.fromFrame) || frames[0], startIndex = frames.indexOf(startFrame), startTake = startFrame ? guidedFrameApproved(s, startFrame, takesFor(s.id), startIndex) : current;
    if (startTake) refs.push({ key: `shot-start:${startFrame?.id || s.id}:${startTake.name}`, label: `Approved Frame ${startFrame?.label || "A"}`, url: startTake.url, role: "first-frame", mediaType: "image", priority: "primary", approved: true, instruction: "Use as the approved opening composition. Preserve geometry, identity, lighting, and continuity unless motion direction explicitly changes them." });
    if (unit?.toFrame && ["flf","r2v","audio-video"].includes(profile?.mode)) { const frame = frames.find((item) => item.id === unit.toFrame), index = frames.indexOf(frame), take = frame ? guidedFrameApproved(s, frame, takesFor(s.id), index) : null; if (take) refs.push({ key: `shot-last:${frame.id}:${take.name}`, label: `Approved Frame ${frame.label}`, url: take.url, role: "last-frame", mediaType: "image", priority: "primary", approved: true, instruction: "Use as the approved endpoint composition." }); }
    if (!profile || ["i2v","flf"].includes(profile.mode)) return refs;
    const imageRefs = compositionAugmentedReferences(s, selectedShotReferences(s)).filter((ref) => !ref.blocking && ref.url && !refs.some((item) => item.url === ref.url)).map((ref) => ({ ...ref, mediaType: "image", staged: ensureShotCreation(s).composition.elements.some((element) => element.referenceKey === ref.key && !element.hidden) }));
    const plan = effectiveMotionPlan(s, unit), audioPlan = plan.audio || {};
    const linked = shotPlanningGenerationReferences(s, ["video","audio"]).filter((ref) => ref.url && shotInputEnabled(s, ref.key)).map((ref) => ref.key === audioPlan.referenceKey ? { ...ref, role: "audio-timing", priority: "primary", instruction: [`Dialogue audio for ${P.characters.find((item) => item.id === audioPlan.speakerId)?.name || audioPlan.speakerId || "the selected character"}.`, audioPlan.mode === "lip-sync-reference" ? "Use the recorded words in this file for direct lip synchronization; do not generate a second voice." : "Use the file as the assigned audio source.", ref.instruction].filter(Boolean).join(" ") } : ref);
    return [...refs, ...imageRefs, ...linked];
  }
  function motionReferenceBudget(s, profile) {
    const current = guidedCurrentShotStill(s), raw = current ? gatherMotionReferences607(s, current, profile) : [];
    return { profile, raw, ...fitReferencesToProfile(profile, raw) };
  }
  guidedMotionReferences = window.guidedMotionReferences = function guidedMotionReferences607(s, current, profile) {
    return fitReferencesToProfile(profile, gatherMotionReferences607(s, current, profile)).assigned;
  };

  const guidedMotionPanel606 = guidedMotionPanel;
  guidedMotionPanel = window.guidedMotionPanel = function guidedMotionPanel607(s, current, takes, open = false) {
    const c = ensureShotCreation(s), unit = activeMotionUnit(s), defaultPlan = c.motionPlan, effective = effectiveMotionPlan(s, unit), savedDirection = c.motionDirection, savedDuration = c.motionDuration, savedProfile = c.motionProfileId, savedIntensity = c.motionIntensity, savedPreserve = c.preserveComposition, savedBuilds = c.motionPromptBuilds;
    c.motionPlan = effective;
    c.motionDirection = unit?.motionPrompt || unit?.note || savedDirection || "";
    c.motionDuration = unit?.dur || savedDuration;
    c.motionProfileId = unit?.motionProfileId || savedProfile;
    c.motionIntensity = unit?.motionIntensity || savedIntensity;
    c.preserveComposition = unit?.preserveComposition == null ? savedPreserve : unit.preserveComposition;
    c.motionPromptBuilds = savedBuilds.filter((entry) => { const build = resolvePromptBuild(P, entry); return !build?.segmentId || build.segmentId === unit?.id; });
    let html = guidedMotionPanel606(s, current, takes, open);
    const profileId = preferredGuidedVideoProfile(c.motionProfileId || ""), profile = guidedVideoProfiles().find((item) => item.id === profileId), budget = current ? motionReferenceBudget(s, profile) : { assigned: [], dropped: [], totalLimit: profile?.limits?.maxReferences || 0, profile };
    html = html.replace('<div class="guided-motion-main">', `<div class="guided-motion-main">${motionUnitTabs(s)}${packagePreviewMarkup(profile, budget, `Motion unit ${unit?.label || "A"} package`)}`);
    c.motionPlan = defaultPlan; c.motionDirection = savedDirection; c.motionDuration = savedDuration; c.motionProfileId = savedProfile; c.motionIntensity = savedIntensity; c.preserveComposition = savedPreserve; c.motionPromptBuilds = savedBuilds;
    return html;
  };
  window.selectMotionUnit = (id, unitId) => { const s = shotById(id), c = ensureShotCreation(s); c.activeMotionUnitId = unitId; c.openPanels.motion = true; dirty(); route(); };
  window.addGuidedMotionUnit = (id) => { const s = shotById(id), c = ensureShotCreation(s), frames = guidedFrames(s), index = (s.clips || []).length, unit = { id: `seg-guided-${Date.now().toString(36)}-${index}`, suffix: alphaLabel(index).toLowerCase(), label: alphaLabel(index), title: `Motion unit ${alphaLabel(index)}`, dur: 5, kind: "i2v", note: "", motionPrompt: "", fromFrame: frames[Math.min(index, frames.length - 1)]?.id || frames[0]?.id || "", toFrame: "", generationPackages: [], motionPlan: null }; s.clips.push(unit); c.activeMotionUnitId = unit.id; c.deliveryIntent = "motion"; dirty(); route(); };
  window.resetMotionUnitPlan = (id, unitId) => { const s = shotById(id), unit = (s.clips || []).find((item) => item.id === unitId); if (!unit) return; unit.motionPlan = null; unit.motionProfileId = ""; unit.motionIntensity = ""; unit.preserveComposition = null; dirty(); route(); toast("Motion unit reset to shot defaults"); };
  window.setMotionUnitAsDefaults = (id, unitId) => { const s = shotById(id), c = ensureShotCreation(s), unit = (s.clips || []).find((item) => item.id === unitId); if (!unit) return; c.motionPlan = clone(effectiveMotionPlan(s, unit)); dirty(); route(); toast("This unit is now the shot motion default"); };
  function activeUnitPlanForEdit(s) { const unit = activeMotionUnit(s); return ensureUnitMotionPlan(s, unit); }
  window.setMotionPlanField = (id, group, key, value) => { const s = shotById(id), c = ensureShotCreation(s), plan = activeUnitPlanForEdit(s); plan[group] = plan[group] && typeof plan[group] === "object" ? plan[group] : {}; plan[group][key] = value; c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion", "motionDirector"); dirty(); route(); };
  window.setMotionSubject = (id, subjectId, key, value) => { const s = shotById(id), c = ensureShotCreation(s), plan = activeUnitPlanForEdit(s); plan.subjects[subjectId] = plan.subjects[subjectId] || { action: "still", direction: "", intensity: "subtle", look: "", targetId: "", targetLabel: "", destination: "", notes: "" }; plan.subjects[subjectId][key] = value; if (key === "targetId") plan.subjects[subjectId].targetLabel = targetLabelFor(s, value); c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion", "motionDirector"); dirty(); route(); };
  window.setMotionProp = (id, propId, key, value) => { const s = shotById(id), c = ensureShotCreation(s), plan = activeUnitPlanForEdit(s); plan.props[propId] = plan.props[propId] || { action: "static", direction: "", targetId: "", targetLabel: "", destination: "", notes: "" }; plan.props[propId][key] = value; if (key === "targetId") plan.props[propId].targetLabel = targetLabelFor(s, value); c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion", "motionDirector"); dirty(); route(); };
  window.setSimpleMotionAudio = (id, key, value) => { const s = shotById(id), c = ensureShotCreation(s), plan = activeUnitPlanForEdit(s), audio = plan.audio; audio[key] = value; if (key === "mode") { audio.lipSync = value === "lip-sync-reference"; if (value !== "lip-sync-reference") audio.referenceKey = ""; } if (key === "referenceKey" && !value && audio.mode === "lip-sync-reference") audio.lipSync = false; c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion", "motionAudio"); dirty(); route(); };
  const setGuidedMotionField606 = window.setGuidedMotionField;
  window.setGuidedMotionField = (id, key, value) => {
    const s = shotById(id), c = ensureShotCreation(s), unit = activeMotionUnit(s);
    if (!unit) return setGuidedMotionField606(id, key, value);
    if (key === "motionDirection") { unit.motionPrompt = value; unit.note = value; c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion"); dirty(); return; }
    if (key === "motionDuration") { const profile = guidedVideoProfiles().find((item) => item.id === preferredGuidedVideoProfile(unit.motionProfileId || c.motionProfileId || "")); unit.dur = guidedClampedMotionDuration(value, profile); c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion"); dirty(); route(); return; }
    if (key === "motionProfileId") { unit.motionProfileId = value; const profile = guidedVideoProfiles().find((item) => item.id === value); unit.dur = guidedClampedMotionDuration(unit.dur || 5, profile); c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion"); dirty(); route(); return; }
    if (key === "motionIntensity") { unit.motionIntensity = value; c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion"); dirty(); return; }
    if (key === "preserveComposition") { unit.preserveComposition = value; c.deliveryIntent = "motion"; keepGuidedPanelOpen(s, "motion"); dirty(); return; }
    setGuidedMotionField606(id, key, value);
  };

  const motionPromptResult606 = guidedMotionPromptResult;
  guidedMotionPromptResult = window.guidedMotionPromptResult = function guidedMotionPromptResult607(s, build) {
    let html = motionPromptResult606(s, build);
    if (build.droppedReferences?.length) html = html.replace("</article>", `<details class="composer-package-dropped-result"><summary>${build.droppedReferences.length} reference${build.droppedReferences.length === 1 ? "" : "s"} omitted by target limits</summary>${build.droppedReferences.map((ref) => `<span>${esc(ref.label || "Reference")} — ${esc(ref.dropReason || "target limit")}</span>`).join("")}</details></article>`);
    return html;
  };
  const buildGuidedMotionPrompt606 = window.buildGuidedMotionPrompt;
  window.buildGuidedMotionPrompt = async (id, useLLM = false) => {
    const s = shotById(id), c = ensureShotCreation(s), unit = activeMotionUnit(s), defaultPlan = c.motionPlan, savedDirection = c.motionDirection, savedDuration = c.motionDuration, savedProfile = c.motionProfileId, savedIntensity = c.motionIntensity, savedPreserve = c.preserveComposition;
    keepGuidedPanelOpen(s, "motion");
    if (!unit) return toast("Add a motion unit first");
    const effective = effectiveMotionPlan(s, unit), profileId = preferredGuidedVideoProfile(unit.motionProfileId || savedProfile || ""), profile = guidedVideoProfiles().find((item) => item.id === profileId), current = guidedCurrentShotStill(s), budget = current ? motionReferenceBudget(s, profile) : { dropped: [], totalLimit: 0, counts: {} };
    c.motionPlan = effective; c.motionDirection = unit.motionPrompt || unit.note || ""; c.motionDuration = unit.dur || 5; c.motionProfileId = profileId; c.motionIntensity = unit.motionIntensity || savedIntensity; c.preserveComposition = unit.preserveComposition == null ? savedPreserve : unit.preserveComposition;
    await buildGuidedMotionPrompt606(id, useLLM);
    const build = latestPromptBuild(P, c.motionPromptBuilds);
    if (build) { build.segmentId = unit.id; build.segmentLabel = unit.label; build.droppedReferences = clone(budget.dropped); build.referenceBudget = { totalLimit: budget.totalLimit, typeLimits: budget.typeLimits, counts: budget.counts }; }
    unit.motionPrompt = c.motionDirection || unit.motionPrompt; unit.note = unit.motionPrompt; unit.motionProfileId = c.motionProfileId || profileId; unit.dur = c.motionDuration || unit.dur;
    c.motionPlan = defaultPlan; c.motionDirection = savedDirection; c.motionDuration = savedDuration; c.motionProfileId = savedProfile; c.motionIntensity = savedIntensity; c.preserveComposition = savedPreserve;
    dirty(); route();
  };
    window.__CINEBRAID_COMPOSER_607_READY = true;
    window.__CINEBRAID_COMPOSER_607_DISABLED = false;
  } catch (error) {
    restoreComposerOriginals607(error);
  }
})();
