(function (root, factory) {
  /* ONE OWNER IS PASSED IN, and it is resolved LATE on purpose.
     public/index.html loads this module BEFORE public/shared-shot-route.js, so a
     browser-side `root.canonicalShotRoute` captured here would be `undefined` forever.
     The live global object is handed over instead and the function is read at CALL
     time — see shotRouteOwner(), which fails loudly rather than falling back, because a
     fallback would be a second reading of the route vocabulary. */
  const api = factory({ route: typeof module === "object" && module.exports ? require("./shared-shot-route.js") : root });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function (OWNERS) {
  const ROUTE = OWNERS && OWNERS.route;
  function shotRouteOwner() {
    const owner = ROUTE && ROUTE.canonicalShotRoute;
    if (typeof owner !== "function")
      throw new Error("shared-build-history.js needs canonicalShotRoute() from shared-shot-route.js; load that module first");
    return owner;
  }
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

  /* =========================================================================
     PACKAGE FRESHNESS - THE COMPARISON, OWNED ONCE.

     A compiled package records what it was made from, in `dependencySnapshot`. It is
     STALE when the production would now supply something different. That comparison
     used to live entirely in public/review-provenance.js, where the money boundary
     could not reach it: POST /api/generation/fal/jobs is a Node process and
     review-provenance.js is browser-lexical - no module.exports, and a transitive
     closure that runs through promptReferenceOptions(), the disk scan and the profile
     library.

     So the COMPARISON moved here and the EVIDENCE did not. This module is dual-mode and
     the server already requires it. review-provenance.js now calls packageDependencyDrift()
     with the full snapshot it has always built; fal-generation.js calls the same function
     with the fields a Node process can read out of the project document alone.

     THAT IS ONE OWNER WITH TWO EVIDENCE SETS, NOT TWO ANSWERS. Every reason string, every
     comparison and every skip rule below is shared. A field neither side supplied is
     skipped rather than compared against undefined, which is the same rule the original
     already applied to the three motion keys a historic package never recorded - a
     comparison nobody has evidence for is not a finding. The server therefore reports a
     SUBSET of the browser's reasons and can never invent one the browser would not give.

     What the server deliberately does not supply, and why:
       - `references`  needs promptReferenceOptions(), whose closure spans four
                       browser-only files. Porting it would be a second reference
                       catalogue, which is exactly the competing architecture this
                       refuses to build.
       - `mode`        the browser reads it through guidedVideoProfiles(), which
                       public/motion-sound-composer.js narrows to the families it
                       supports. A server reading data/model-profiles.json directly
                       would answer for a profile the browser cannot see, and the two
                       would disagree. Left to the browser, which owns the narrowing. */

  /* The browser twin is unitKey() in public/planning.js and the bodies are identical.
     Named apart so a reader cannot mistake this for a second definition of that one. */
  function buildUnitKey(unit) {
    return unit ? String(unit.id || unit.suffix) : "shot";
  }
  function buildFrameById(shot, id) {
    return (shot?.frames || []).find((frame) => String(frame?.id) === String(id)) || null;
  }
  function buildUnitFor(shot, pack) {
    if (!pack?.segmentId) return null;
    return (shot?.clips || []).find((clip) => buildUnitKey(clip) === String(pack.segmentId)) || null;
  }

  /* WHAT THE PROJECT DOCUMENT ALONE SAYS about a package's inputs. Every read below is a
     plain field on the shot, its frames, its clips or project.mediaAssets - no catalogue,
     no disk, no profile library - which is why it is computable identically on both sides,
     and why public/review-provenance.js now builds its own snapshot on top of this rather
     than beside it. */
  function packageProjectInputs(project, shot, pack, direction) {
    const unit = buildUnitFor(shot, pack);
    const frame = pack?.frameId ? buildFrameById(shot, pack.frameId) : null;
    const first = unit ? buildFrameById(shot, unit.fromFrame) : null;
    const last = unit ? buildFrameById(shot, unit.toFrame) : null;
    const assets = Array.isArray(project?.mediaAssets) ? project.mediaAssets : [];
    const media = assets
      .flatMap((asset) => (Array.isArray(asset?.links) ? asset.links : [])
        .filter((link) => link?.targetType === "shot" && String(link.targetId) === String(shot?.id))
        .map((link) => ({ asset, link })))
      .filter(({ link }) => link.generationInput)
      .map(({ asset, link }) => [asset.id, asset.file || "", link.role || ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return {
      direction: String(direction || "").trim(),
      frameWinner: frame?.winner || "",
      firstFrameWinner: first?.winner || "",
      lastFrameWinner: last?.winner || "",
      generationMedia: media,
    };
  }

  /* THE WRITTEN DIRECTION a package would be compiled from now. Plain reads again, and
     the same three-way choice public/review-provenance.js has always made: a frame
     package takes the frame's description, a motion package takes the unit's own text,
     and a shot-level package takes the shot's - each joined with the planner's directive
     for that scope. */
  function packageDirection(shot, pack) {
    const directive = shot?.packagePlanner?.directiveByScope?.[pack?.scope] || "";
    let base = "";
    if (pack?.frameId) base = buildFrameById(shot, pack.frameId)?.description || "";
    else if (pack?.segmentId) {
      const unit = buildUnitFor(shot, pack);
      base = unit?.motionPrompt || unit?.note || "";
    } else base = shot?.motionPrompt || "";
    return [base, directive].filter(Boolean).join("\n").trim();
  }

  /* The motion inputs a package's own text STATES, read from the shot as it is now.
     `mode` is deliberately absent - see the note above.

     THE DECLARED DELIVERY ROUTE IS RECORDED HERE, AND ONLY HERE.

     A route is a durable statement about how the SHOT is delivered, and its whole
     vocabulary - t2v/i2v/flf/r2v/hybrid - is about motion. A motion prompt compiles
     through a different branch with a different endpoint contract for each of them, so
     changing the route changes what this package was made FOR. That is dependency
     drift, and it is what the accepted decision "changing the route stales affected
     packages" means.

     WHICH IS WHY IT IS NOT IN packageProjectInputs(). That reader answers for EVERY
     package; a frame package's compiled t2i prompt does not branch on the shot's
     delivery route, and changing i2v to r2v does not make the picture it describes
     wrong - it makes the frame no longer REQUIRED, which is readiness's answer and
     already given. Recording the route there would stale every frame package on every
     route change: a blanket revision bump wearing a dependency's name. `pack.segmentId`
     is the discriminator this function has always used for "this is a motion package",
     and the route rides it.

     CANONICAL, NEVER INFERRED. The value comes from shared-shot-route.js, so a stored
     token this build cannot read folds to "" exactly as it does everywhere else, and an
     undeclared shot records "" - a real fact about the build, not a guess. Nothing here
     reads a frame, a clip kind, a profile, a provider or a filename to produce one.

     BOTH SIDES CAN SUPPLY IT, unlike `mode`: `shot.deliveryRoute` is a plain durable
     field, so the server's packageProjectFreshness() reports route drift too and the
     two evidence sets agree rather than diverging. */
  function packageMotionInputs(shot, pack) {
    if (!pack?.segmentId) return null;
    const brief = shot?.creationBrief || {};
    const unit = buildUnitFor(shot, pack);
    return {
      durationSeconds: Number(brief.motionDuration || unit?.dur || 0) || 0,
      profileId: String(brief.motionProfileId || pack.profileId || ""),
      deliveryRoute: shotRouteOwner()(shot?.deliveryRoute),
    };
  }

  /* A field is compared only when BOTH sides have it. `undefined` on either side means
     nobody has evidence, and a difference nobody has evidence for is not a difference. */
  function comparable(saved, now, key) {
    return saved?.[key] !== undefined && now?.[key] !== undefined;
  }
  function packageDependencyDrift({ saved, now, missingReferences } = {}) {
    if (!saved) return [];
    const reasons = [];
    const at = now || {};
    if (comparable(saved, at, "direction") && String(saved.direction || "") !== String(at.direction || ""))
      reasons.push("written direction changed");
    if (comparable(saved, at, "frameWinner") && String(saved.frameWinner || "") !== String(at.frameWinner || ""))
      reasons.push("approved frame changed");
    if (comparable(saved, at, "firstFrameWinner") && String(saved.firstFrameWinner || "") !== String(at.firstFrameWinner || ""))
      reasons.push("approved start frame changed");
    if (comparable(saved, at, "lastFrameWinner") && String(saved.lastFrameWinner || "") !== String(at.lastFrameWinner || ""))
      reasons.push("approved end frame changed");
    if (comparable(saved, at, "generationMedia")
      && JSON.stringify(saved.generationMedia || []) !== JSON.stringify(at.generationMedia || []))
      reasons.push("approved generation media changed");
    /* Named before the generic array comparison, because "an input is gone" is a
       different fact from "an input changed" and sends the filmmaker somewhere else.
       Only a caller that can enumerate what the production may currently supply passes
       this; a caller that cannot passes nothing and gets neither reference reason. */
    const missing = Array.isArray(missingReferences) ? missingReferences : null;
    if (missing && missing.length)
      reasons.push(missingReferenceReason(missing));
    if ((!missing || !missing.length) && comparable(saved, at, "references")
      && JSON.stringify(saved.references || []) !== JSON.stringify(at.references || []))
      reasons.push("approved reference file changed");
    if (comparable(saved, at, "durationSeconds") && Number(saved.durationSeconds || 0) !== Number(at.durationSeconds || 0))
      reasons.push("duration changed to " + Number(at.durationSeconds || 0) + "s - the compiled prompt still states " + Number(saved.durationSeconds || 0) + "s");
    if (comparable(saved, at, "mode") && String(saved.mode || "") !== String(at.mode || ""))
      reasons.push("execution method changed to " + String(at.mode || "none").toUpperCase() + " - the compiled prompt is " + String(saved.mode || "none").toUpperCase());
    if (comparable(saved, at, "profileId") && String(saved.profileId || "") !== String(at.profileId || ""))
      reasons.push("target model changed to " + String(at.profileId || "none") + " - the compiled prompt targets " + String(saved.profileId || "none"));
    /* THE DELIVERY ROUTE, under the same rule as every field above it: compared only
       when BOTH sides recorded one. A package compiled before the route was captured
       has no `deliveryRoute` key, so it is skipped rather than declared stale on
       evidence nobody has - which is how a legacy package is handled without inventing
       a route it never had. */
    if (comparable(saved, at, "deliveryRoute") && String(saved.deliveryRoute || "") !== String(at.deliveryRoute || ""))
      reasons.push("delivery route changed to " + routeWord(at.deliveryRoute) + " - this prompt was compiled for " + routeWord(saved.deliveryRoute));
    return [...new Set(reasons)];
  }
  /* "NOT DECIDED" rather than "NONE": withdrawing a route is a real production state
     and reads as one, where `none` would read like a missing value. */
  function routeWord(value) {
    const route = String(value || "");
    return route ? route.toUpperCase() : "NOT DECIDED";
  }
  function missingReferenceReason(missing) {
    const count = missing.length === 1 ? "an input" : missing.length + " inputs";
    return count + " this prompt was compiled from can no longer be supplied by this shot: " + missing.join(", ");
  }

  /* THE SERVER'S ANSWER, assembled from the functions above and handed to the one
     comparator. A package with no recorded snapshot returns `recorded: false` and no
     reasons - refusing on an absence would block every package compiled before
     dependencies were captured, on evidence nobody has. */
  function packageProjectFreshness(project, shot, pack) {
    const saved = pack && pack.dependencySnapshot;
    if (!saved) return { current: true, recorded: false, reasons: [], evidence: "none" };
    const now = {
      ...packageProjectInputs(project, shot, pack, packageDirection(shot, pack)),
      ...(packageMotionInputs(shot, pack) || {}),
    };
    const reasons = packageDependencyDrift({ saved, now });
    return {
      current: !reasons.length,
      recorded: true,
      reasons,
      /* Named so a caller cannot mistake a partial verdict for the whole one. The
         browser's evidence is `full`; this one has not looked at references or at
         execution method. */
      evidence: "project-document",
    };
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
    packageDependencyDrift,
    packageDirection,
    packageMotionInputs,
    packageProjectFreshness,
    packageProjectInputs,
  };
});
