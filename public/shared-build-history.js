(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_PROMPT_BUILD_RETENTION = 12;

  function clean(value) { return String(value || "").trim(); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce((out, key) => {
        if (value[key] !== undefined) out[key] = stableValue(value[key]);
        return out;
      }, {});
    }
    return value;
  }
  function stableStringify(value) { return JSON.stringify(stableValue(value)); }
  function shortHash(value) {
    const text = typeof value === "string" ? value : stableStringify(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function ensurePromptHistory(project) {
    if (!project || typeof project !== "object") return project;
    project.meta = project.meta && typeof project.meta === "object" ? project.meta : {};
    project.promptBuildsById = project.promptBuildsById && typeof project.promptBuildsById === "object" && !Array.isArray(project.promptBuildsById) ? project.promptBuildsById : {};
    project.promptSnapshotsById = project.promptSnapshotsById && typeof project.promptSnapshotsById === "object" && !Array.isArray(project.promptSnapshotsById) ? project.promptSnapshotsById : {};
    const retention = Number(project.meta.promptBuildRetention);
    project.meta.promptBuildRetention = Number.isFinite(retention) && retention >= 1 ? Math.round(retention) : DEFAULT_PROMPT_BUILD_RETENTION;
    project.meta.promptHistoryVersion = 1;
    return project;
  }
  function snapshotId(project, kind, value) {
    if (value == null || typeof value !== "object") return "";
    ensurePromptHistory(project);
    const serialized = stableStringify(value);
    const base = `${kind}-${shortHash(serialized)}-${serialized.length}`;
    let id = base, suffix = 1;
    while (project.promptSnapshotsById[id] && stableStringify(project.promptSnapshotsById[id].value) !== serialized) id = `${base}-${++suffix}`;
    if (!project.promptSnapshotsById[id]) project.promptSnapshotsById[id] = { kind, value: clone(value) };
    return id;
  }
  function normalizeCanonicalBuild(project, raw) {
    const build = clone(raw || {});
    delete build.scope;
    delete build.pinned;
    if (build.inputs && build.inputs.composition && !build.compositionSnapshotId) {
      build.compositionSnapshotId = snapshotId(project, "composition", build.inputs.composition);
      build.inputs = { ...build.inputs };
      delete build.inputs.composition;
    }
    if (build.composition && !build.compositionSnapshotId) {
      build.compositionSnapshotId = snapshotId(project, "composition", build.composition);
      delete build.composition;
    }
    if (build.motionPlan && !build.motionSnapshotId) {
      build.motionSnapshotId = snapshotId(project, "motion", build.motionPlan);
      delete build.motionPlan;
    }
    return build;
  }
  function uniqueBuildId(project, raw) {
    ensurePromptHistory(project);
    const preferred = clean(raw?.id || raw?.packageId) || `build-${Date.now().toString(36)}-${shortHash(raw || {})}`;
    const normalized = normalizeCanonicalBuild(project, { ...raw, id: preferred });
    const existing = project.promptBuildsById[preferred];
    if (!existing || stableStringify(existing) === stableStringify(normalized)) return { id: preferred, build: normalized };
    const base = `${preferred}-${shortHash(normalized)}`;
    let id = base, n = 1;
    while (project.promptBuildsById[id] && stableStringify(project.promptBuildsById[id]) !== stableStringify({ ...normalized, id })) id = `${base}-${++n}`;
    return { id, build: { ...normalized, id } };
  }
  function registerPromptBuild(project, raw) {
    ensurePromptHistory(project);
    const { id, build } = uniqueBuildId(project, raw);
    project.promptBuildsById[id] = build;
    return id;
  }
  function promptBuildRef(id, extra = {}) {
    return { buildId: clean(id), ...extra };
  }
  function entryBuildId(entry) {
    if (typeof entry === "string") return clean(entry);
    if (entry && typeof entry === "object") return clean(entry.buildId || entry.id);
    return "";
  }
  function missingPromptBuild(id, extra = {}) {
    return {
      id: id || "missing-build",
      buildId: id || "",
      packageId: extra.packageId || "",
      kind: extra.kind || "",
      scope: extra.scope || "",
      missing: true,
      prompt: "",
      warnings: ["This historical prompt build is unavailable."],
    };
  }
  function resolvePromptBuild(project, entry) {
    if (!entry) return null;
    if (typeof entry === "object" && !entry.buildId) return entry;
    ensurePromptHistory(project);
    const id = entryBuildId(entry);
    const build = project.promptBuildsById[id];
    if (!build) return missingPromptBuild(id, typeof entry === "object" ? entry : {});
    const resolved = { ...clone(build) };
    if (build.compositionSnapshotId) resolved.composition = clone(project.promptSnapshotsById[build.compositionSnapshotId]?.value || null);
    if (build.motionSnapshotId) resolved.motionPlan = clone(project.promptSnapshotsById[build.motionSnapshotId]?.value || null);
    if (resolved.inputs && build.compositionSnapshotId) resolved.inputs = { ...resolved.inputs, composition: clone(project.promptSnapshotsById[build.compositionSnapshotId]?.value || null) };
    if (typeof entry === "object") {
      for (const key of ["kind", "scope", "pinned", "revisionReason"]) if (entry[key] != null) resolved[key] = entry[key];
    }
    return resolved;
  }
  function resolvePromptBuildList(project, list) {
    return (Array.isArray(list) ? list : []).map((entry) => resolvePromptBuild(project, entry)).filter(Boolean);
  }
  function latestPromptBuild(project, list) {
    const entries = Array.isArray(list) ? list : [];
    return entries.length ? resolvePromptBuild(project, entries[entries.length - 1]) : null;
  }
  function convertBuildList(project, list, defaults = {}) {
    if (!Array.isArray(list)) return { list: [], changed: !Array.isArray(list) };
    let changed = false;
    const converted = list.map((entry) => {
      if (typeof entry === "string") { changed = true; return promptBuildRef(entry, defaults); }
      if (entry && typeof entry === "object" && entry.buildId) {
        const next = { buildId: clean(entry.buildId) };
        for (const key of ["kind", "scope", "pinned", "revisionReason"]) if (entry[key] != null) next[key] = entry[key];
        for (const [key, value] of Object.entries(defaults)) if (next[key] == null && value != null) next[key] = value;
        if (stableStringify(next) !== stableStringify(entry)) changed = true;
        return next;
      }
      if (entry && typeof entry === "object") {
        const id = registerPromptBuild(project, entry);
        const extra = { ...defaults };
        for (const key of ["kind", "scope", "pinned", "revisionReason"]) if (entry[key] != null) extra[key] = entry[key];
        changed = true;
        return promptBuildRef(id, extra);
      }
      changed = true;
      return null;
    }).filter(Boolean);
    return { list: converted, changed };
  }
  function everyBuildList(project, visitor) {
    for (const shot of project.shots || []) {
      shot.promptBuilds = Array.isArray(shot.promptBuilds) ? shot.promptBuilds : [];
      shot.generationPackages = Array.isArray(shot.generationPackages) ? shot.generationPackages : [];
      visitor(shot, "promptBuilds", {});
      visitor(shot, "generationPackages", { scope: "shot" });
      const brief = shot.creationBrief = shot.creationBrief && typeof shot.creationBrief === "object" ? shot.creationBrief : {};
      brief.promptBuilds = Array.isArray(brief.promptBuilds) ? brief.promptBuilds : [];
      brief.motionPromptBuilds = Array.isArray(brief.motionPromptBuilds) ? brief.motionPromptBuilds : [];
      visitor(brief, "promptBuilds", { kind: "guided-frame" });
      visitor(brief, "motionPromptBuilds", { kind: "guided-motion" });
      brief.frameWorkflows = brief.frameWorkflows && typeof brief.frameWorkflows === "object" ? brief.frameWorkflows : {};
      for (const workflow of Object.values(brief.frameWorkflows)) {
        if (!workflow || typeof workflow !== "object") continue;
        workflow.promptBuilds = Array.isArray(workflow.promptBuilds) ? workflow.promptBuilds : [];
        visitor(workflow, "promptBuilds", { kind: "guided-frame" });
      }
      for (const frame of shot.keyframes || []) {
        frame.generationPackages = Array.isArray(frame.generationPackages) ? frame.generationPackages : [];
        visitor(frame, "generationPackages", { scope: `frame:${frame.id || ""}` });
      }
      for (const unit of shot.clips || []) {
        unit.generationPackages = Array.isArray(unit.generationPackages) ? unit.generationPackages : [];
        visitor(unit, "generationPackages", { scope: `segment:${unit.id || unit.suffix || ""}` });
      }
    }
  }
  function protectedBuildIds(project) {
    ensurePromptHistory(project);
    const ids = new Set();
    const byPackage = new Map();
    for (const [id, build] of Object.entries(project.promptBuildsById)) {
      if (build.packageId) byPackage.set(build.packageId, id);
      if (build.pinned) ids.add(id);
    }
    const add = (value) => {
      const key = clean(value);
      if (!key) return;
      if (project.promptBuildsById[key]) ids.add(key);
      if (byPackage.has(key)) ids.add(byPackage.get(key));
    };
    for (const shot of project.shots || []) {
      const brief = shot.creationBrief || {};
      add(brief.lastImagePackageId);
      add(brief.lastMotionPackageId);
      for (const row of shot.candidateFiles || []) {
        if (row.approvedAt || row.approvedTarget || row.sourcePackageId) add(row.sourcePackageId);
        add(row.sourcePackageSnapshot?.id || row.sourcePackageSnapshot?.packageId);
        add(row.packageSnapshot?.id || row.packageSnapshot?.packageId);
        for (const correctionId of row.correctionBuildIds || []) add(correctionId);
        add(row.currentCorrectionBuildId);
      }
      everyBuildList({ shots: [shot], meta: project.meta, promptBuildsById: project.promptBuildsById, promptSnapshotsById: project.promptSnapshotsById }, (owner, key) => {
        for (const entry of owner[key] || []) if (entry?.pinned) add(entryBuildId(entry));
      });
    }
    return ids;
  }
  function applyPromptBuildRetention(project, limit) {
    ensurePromptHistory(project);
    const cap = Math.max(1, Math.round(Number(limit || project.meta.promptBuildRetention || DEFAULT_PROMPT_BUILD_RETENTION)));
    project.meta.promptBuildRetention = cap;
    const protectedIds = protectedBuildIds(project);
    everyBuildList(project, (owner, key) => {
      const list = owner[key] || [];
      if (list.length <= cap) return;
      const keep = new Set(list.slice(-cap).map(entryBuildId));
      for (const id of protectedIds) keep.add(id);
      owner[key] = list.filter((entry) => keep.has(entryBuildId(entry)));
    });
    const referenced = new Set(protectedIds);
    everyBuildList(project, (owner, key) => (owner[key] || []).forEach((entry) => referenced.add(entryBuildId(entry))));
    for (const id of Object.keys(project.promptBuildsById)) if (!referenced.has(id)) delete project.promptBuildsById[id];
    const usedSnapshots = new Set();
    for (const build of Object.values(project.promptBuildsById)) {
      if (build.compositionSnapshotId) usedSnapshots.add(build.compositionSnapshotId);
      if (build.motionSnapshotId) usedSnapshots.add(build.motionSnapshotId);
    }
    for (const id of Object.keys(project.promptSnapshotsById)) if (!usedSnapshots.has(id)) delete project.promptSnapshotsById[id];
    return project;
  }
  function normalizePromptBuildHistory(project, options = {}) {
    ensurePromptHistory(project);
    let changed = false;
    everyBuildList(project, (owner, key, defaults) => {
      const result = convertBuildList(project, owner[key], defaults);
      if (result.changed) changed = true;
      owner[key] = result.list;
    });
    if (options.applyRetention) applyPromptBuildRetention(project, options.retention);
    return changed;
  }

  return {
    DEFAULT_PROMPT_BUILD_RETENTION,
    ensurePromptHistory,
    registerPromptBuild,
    promptBuildRef,
    resolvePromptBuild,
    resolvePromptBuildList,
    latestPromptBuild,
    normalizePromptBuildHistory,
    applyPromptBuildRetention,
    entryBuildId,
  };
});
