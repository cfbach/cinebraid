/* ---------- drag-and-drop takes ---------- */
function wireDropzone(id) {
  const dz = $("#dropzone");
  const fileInput = $("#take-file");
  if (dz && fileInput) {
    dz.onclick = () => fileInput.click();
    fileInput.onchange = () => uploadTakes(id, fileInput.files);
    ["dragover", "dragenter"].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add("over");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove("over");
      }),
    );
    dz.addEventListener("drop", (e) => uploadTakes(id, e.dataTransfer.files));
  }
  wireGuidedFrameDropzones(id);
  wireGuidedMotionDropzone(id);
}
function latestGuidedPackageForFile(s, fileName, frameId = "") {
  const c = typeof ensureShotCreation === "function" ? ensureShotCreation(s) : (s.creationBrief || {});
  if (isVideo(fileName)) return latestPromptBuild(P, c.motionPromptBuilds || []);
  if (frameId && typeof guidedFrames === "function" && typeof guidedFrameState === "function") {
    const frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
    if (index >= 0) return latestPromptBuild(P, guidedFrameState(s, frames[index], index).promptBuilds);
  }
  return latestPromptBuild(P, c.promptBuilds || []);
}
function linkUploadedCandidatePackage(s, name, frameId = "") {
  if (typeof candidateRecord !== "function") return;
  const build = latestGuidedPackageForFile(s, name, frameId);
  const row = candidateRecord(s, name, true);
  if (frameId) row.frameId = frameId;
  if (!build) return;
  row.sourcePackageId = build.id || build.packageId || "";
  row.sourcePackageLabel = build.packageId || build.id || "";
  row.sourcePackageSnapshot = JSON.parse(JSON.stringify(build));
  row.sourceLinkedAt = new Date().toISOString();
}
function wireGuidedFrameDropzones(id) {
  document.querySelectorAll("[data-frame-dropzone]").forEach((dz) => {
    if (dz.dataset.wired) return;
    const frameId = dz.dataset.frameDropzone;
    const input = document.getElementById(`frame-file-${frameId}`);
    if (!input) return;
    dz.dataset.wired = "1";
    dz.onclick = () => input.click();
    input.onchange = () => uploadGuidedFrameFiles(id, frameId, input.files);
    ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => uploadGuidedFrameFiles(id, frameId, e.dataTransfer.files));
  });
}
async function uploadGuidedFrameFiles(id, frameId, files) {
  const selected = [...(files || [])].filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name));
  if (!selected.length) return toast("Choose one or more image files");
  const dz = document.querySelector(`[data-frame-dropzone="${frameId}"]`);
  if (dz) dz.childNodes[0].nodeValue = `UPLOADING ${selected.length} IMAGE${selected.length === 1 ? "" : "S"}…`;
  const s = shotById(id);
  s.candidateFiles = Array.isArray(s.candidateFiles) ? s.candidateFiles : [];
  let added = 0;
  for (const file of selected) {
    const response = await fetch(`/api/shots/${encodeURIComponent(id)}/take?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) continue;
    const existing = candidateRecord(s, data.name, true);
    existing.original = file.name;
    existing.addedAt = new Date().toISOString();
    existing.mediaType = "image";
    existing.frameId = frameId;
    linkUploadedCandidatePackage(s, data.name, frameId);
    added++;
  }
  if (added) {
    s.workflowStatus = "IN PROGRESS";
    s.status = "BUILT";
  }
  dirty();
  SCAN = await (await fetch("/api/scan")).json();
  route();
  toast(`${added} frame candidate${added === 1 ? "" : "s"} returned to CineBraid`);
}
function wireGuidedMotionDropzone(id) {
  const dz = document.getElementById("motion-dropzone"), input = document.getElementById("motion-file");
  if (!dz || !input || dz.dataset.wired) return;
  dz.dataset.wired = "1";
  dz.onclick = () => input.click();
  input.onchange = () => uploadGuidedMotionFiles(id, input.files);
  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => uploadGuidedMotionFiles(id, e.dataTransfer.files));
}
async function uploadGuidedMotionFiles(id, files) {
  const selected = [...(files || [])].filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(file.name));
  if (!selected.length) return toast("Choose one or more video files");
  const dz = document.getElementById("motion-dropzone");
  if (dz) dz.childNodes[0].nodeValue = `UPLOADING ${selected.length} VIDEO${selected.length === 1 ? "" : "S"}…`;
  const s = shotById(id);
  s.candidateFiles = s.candidateFiles || [];
  for (const f of selected) {
    const r = await fetch(`/api/shots/${encodeURIComponent(id)}/take?name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
    const d = await r.json();
    if (r.ok) {
      s.candidateFiles.push({ stored: d.name, original: f.name, addedAt: new Date().toISOString(), mediaType: "video" });
      linkUploadedCandidatePackage(s, d.name);
    }
  }
  s.workflowStatus = "IN PROGRESS";
  s.status = "BUILT";
  dirty();
  SCAN = await (await fetch("/api/scan")).json();
  route();
  toast(`${selected.length} video candidate${selected.length === 1 ? "" : "s"} added and linked to the latest motion package`);
}
async function uploadTakes(id, files) {
  if (!files?.length) return;
  const dz = $("#dropzone");
  dz.textContent = "UPLOADING " + files.length + "…";
  const s = shotById(id);
  s.candidateFiles = s.candidateFiles || [];
  for (const f of files) {
    const r = await fetch(
      "/api/shots/" + id + "/take?name=" + encodeURIComponent(f.name),
      {
        method: "POST",
        headers: { "Content-Type": f.type || "application/octet-stream" },
        body: f,
      },
    );
    const d = await r.json();
    if (r.ok) {
      s.candidateFiles.push({
        stored: d.name,
        original: f.name,
        addedAt: new Date().toISOString(),
      });
      linkUploadedCandidatePackage(s, d.name);
    }
  }
  if (workflowState(s).key === "DRAFT") {
    s.workflowStatus = "IN PROGRESS";
    s.status = "BUILT";
  }
  dirty();
  SCAN = await (await fetch("/api/scan")).json();
  route();
  toast(files.length + " candidate(s) added");
}

window.duplicateShot = (id) => {
  const s = shotById(id);
  if (!s) return;
  openModal(`<h3>Duplicate or inherit shot</h3><div class="modal-sub">START THE NEXT SHOT WITHOUT REBUILDING CONTINUITY</div><label>Copy mode<select id="duplicate-shot-mode"><option value="continuity">References, continuity, camera, and motion settings</option><option value="structure">Structure and descriptions only</option><option value="blank-motion">References and continuity, but clear motion</option></select></label><label>New title<input id="duplicate-shot-title" value="${attr(s.title + " — next")}"></label><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="confirmDuplicateShot('${id}')">CREATE SHOT</button></div>`);
};
window.confirmDuplicateShot = (id) => {
  const source = shotById(id);
  if (!source) return;
  const mode = document.getElementById("duplicate-shot-mode")?.value || "continuity";
  const siblings = P.shots.filter((shot) => shot.scene === source.scene);
  let n = siblings.length + 1, newId = `${source.scene}-${String(n).padStart(2, "0")}`;
  while (P.shots.some((shot) => shot.id === newId)) { n++; newId = `${source.scene}-${String(n).padStart(2, "0")}`; }
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = newId;
  copy.title = document.getElementById("duplicate-shot-title")?.value.trim() || `${source.title} — next`;
  copy.winner = null;
  copy.finalVideoFile = "";
  copy.candidateFiles = [];
  copy.candidateReview = {};
  copy.workflowStatus = "DRAFT";
  copy.status = "UNBUILT";
  copy.reviewStatus = "";
  copy.approvedAt = "";
  copy.stageApprovals = {};
  copy.generationPackages = [];
  copy.promptBuilds = [];
  copy.keyframes = [newKeyframe(0, "Opening frame")];
  copy.clips = [];
  copy.creationBrief = JSON.parse(JSON.stringify(source.creationBrief || {}));
  copy.creationBrief.promptBuilds = [];
  copy.creationBrief.motionPromptBuilds = [];
  copy.creationBrief.approvedMotionFile = "";
  copy.creationBrief.finalVideoFile = "";
  copy.creationBrief.referencePackDownloadedAt = "";
  copy.creationBrief.lastImagePackageId = "";
  copy.creationBrief.lastMotionPackageId = "";
  const copiedStateDeclarations = mode !== "structure"
    && copy.continuityStateSelections && typeof copy.continuityStateSelections === "object"
    && !Array.isArray(copy.continuityStateSelections)
    ? Object.entries(copy.continuityStateSelections).map(([entityId, stateId]) => ({
        shotId: newId,
        entityId,
        stateId: String(stateId || ""),
      }))
    : [];
  /* The cloned object never carries assignment authority. Duplication is a
     filtering operation, not the interactive batch transaction: after the new
     shot and all of its cloned relationships exist, each declaration is
     independently re-applied through the same canonical single-item owner.
     Valid declarations survive; stale, foreign, or otherwise invalid ones do
     not erase unrelated valid declarations. */
  copy.continuityStateSelections = {};
  if (mode === "structure") {
    copy.characters = [];
    copy.codes = [];
    copy.creationBrief.locationId = "";
    copy.creationBrief.propIds = [];
    copy.creationBrief.vehicleIds = [];
    if (copy.audio && typeof copy.audio === "object") copy.audio.speakerId = "";
    if (copy.creationBrief.motionPlan?.audio) copy.creationBrief.motionPlan.audio.speakerId = "";
    copy.creationBrief.disabledInputKeys = [];
  }
  if (mode === "blank-motion") {
    copy.motionPrompt = "";
    copy.creationBrief.motionDirection = "";
    copy.creationBrief.motionAudioNotes = "";
  }
  P.shots.push(copy);
  const copiedStateResults = typeof applyShotStateDeclaration === "function"
    ? copiedStateDeclarations.map((declaration) => applyShotStateDeclaration(P, declaration))
    : copiedStateDeclarations.map((declaration) => ({ status: "invalid-declaration", ...declaration }));
  const copiedStateRefusals = copiedStateResults.filter((result) => result.status !== "applied");
  for (const asset of P.mediaAssets || []) {
    const sourceLinks = (asset.links || []).filter((link) => link.targetType === "shot" && String(link.targetId) === String(id));
    for (const link of sourceLinks) asset.links.push({ ...JSON.parse(JSON.stringify(link)), id: `link-${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`, targetId: newId });
  }
  dirty();
  closeModal();
  location.hash = `#/shot/${newId}`;
  route();
  toast(copiedStateRefusals.length
    ? "Shot duplicated; " + (copiedStateResults.length - copiedStateRefusals.length) + " valid continuity declaration(s) kept and " + copiedStateRefusals.length + " incompatible declaration(s) skipped"
    : "Shot duplicated with reusable production context");
};

/* ---------- mutations ---------- */
window.addScene = () =>
  formModal(
    "New scene",
    [
      { k: "id", label: "Scene code (optional)", ph: "Auto-generated" },
      { k: "title", label: "Scene title", ph: "Arrival at the tavern" },
      { k: "beat", label: "What happens", type: "textarea", ph: "The traveler enters, scans the room, and approaches the bar." },
      { k: "feel", label: "How it should feel", type: "textarea", ph: "Suspicious, cramped, damp, and quietly dangerous." },
    ],
    (v) => {
      let id = creationSlug(v.id) || nextCreationId("scenes", "SC");
      if (sceneById(id)) return toast("That scene code already exists");
      P.scenes.push({
        id,
        title: v.title || `Scene ${P.scenes.length + 1}`,
        tier: "B",
        stage: "",
        characters: [],
        whatHappens: v.beat || "",
        howItFeels: v.feel || "",
        audio: {},
      });
      dirty();
      location.hash = "#/scene/" + id;
      route();
    },
  );
function revokeShotCanonForRemoval(shot) {
  if (!shot || typeof hasCurrentHumanAuthority !== "function") return;
  const revokeIfCurrent = (target, command, details) => {
    if (target && hasCurrentHumanAuthority(P, target)) command(P, {
      ...details, at: new Date().toISOString(), via: "confirmed-target-removal",
      reason: "target-removed", clearEdge: false,
    });
  };
  for (const frame of shot.keyframes || []) revokeIfCurrent(
    authorityTarget({ kind: "shot-frame", shotId: shot.id, frameId: frame.id }),
    revokeFrameCanon, { shotId: shot.id, frameId: frame.id },
  );
  for (const clip of shot.clips || []) {
    const key = clip.id || unitKey(clip);
    revokeIfCurrent(authorityTarget({ kind: "shot-motion", shotId: shot.id, unitKey: key }), revokeMotionCanon, { shotId: shot.id, unitKey: key });
  }
  revokeIfCurrent(authorityTarget({ kind: "shot-delivery", shotId: shot.id }), revokeDeliveryCanon, { shotId: shot.id });
}
function deletedTargetRecord(type, id, extra = {}) {
  P.meta = P.meta || {};
  P.meta.deletedTargets = Array.isArray(P.meta.deletedTargets) ? P.meta.deletedTargets : [];
  P.meta.deletedTargets.push({ type, id, deletedAt: new Date().toISOString(), ...extra });
}
window.delScene = (id) => {
  const shots = P.shots.filter((s) => s.scene === id);
  const runCount = (window.AUTOMATION_RUNS || []).filter((run) => run.targetId === id || shots.some((shot) => shot.id === run.targetId)).length;
  openModal(`<div class="dependency-delete-modal"><h3>Delete scene ${esc(id)}?</h3><p>This removes the scene and ${shots.length} shot${shots.length === 1 ? "" : "s"} from project data.</p><div class="dependency-impact-list"><b>Affected shots</b>${shots.length ? `<ul>${shots.slice(0,20).map((shot) => `<li>${esc(shot.id)} · ${esc(shot.title || "Untitled")}</li>`).join("")}</ul>` : `<span>No shots.</span>`}<small>${runCount} durable run/report record${runCount === 1 ? "" : "s"} will be retained and marked as deleted-target history. Shot media remains on disk.</small></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="danger-btn" id="delete-scene-confirm">DELETE SCENE & SHOTS</button></div></div>`);
  setTimeout(() => {
    const button = document.getElementById("delete-scene-confirm");
    if (!button) return;
    button.onclick = () => {
      shots.forEach((shot) => { revokeShotCanonForRemoval(shot); deletedTargetRecord("shot", shot.id, { scene: id, mediaRetained: true }); });
      deletedTargetRecord("scene", id, { shotIds: shots.map((shot) => shot.id), mediaRetained: true });
      P.scenes = P.scenes.filter((s) => s.id !== id);
      P.shots = P.shots.filter((s) => s.scene !== id);
      dirty(); closeModal(); location.hash = "#/production/scenes";
    };
  }, 0);
};
window.addShot = (sceneId) => {
  const hasScenes = !!P.scenes.length;
  const fields = [];
  if (hasScenes)
    fields.push({
      k: "scene",
      label: "Scene",
      type: "select",
      options: P.scenes.map((g) => g.id),
      value: sceneId || P.scenes[0]?.id,
    });
  else
    fields.push({
      k: "sceneTitle",
      label: "First scene title",
      ph: "Arrival at the tavern",
    });
  /* WHAT HAPPENS, NOT WHAT THE STILL SHOWS.
     "What must the still show?" assumed the shot begins by producing an image, which
     is one of five ways CineBraid can make a shot and is a decision this form has not
     asked for yet. The field is the shot's durable description — it is stored on
     `desc` and copied to `creationBrief.action`, and every route reads it — so it has
     to describe the event, not the artefact. Framing stays, marked optional, because
     it is supporting input for whichever route the filmmaker later declares. */
  fields.push(
    { k: "title", label: "Shot title", ph: "Traveler enters the tavern" },
    { k: "desc", label: "What happens in this shot?", type: "textarea", ph: "The traveler pushes through the warped door and pauses as the room turns toward him." },
    { k: "positioning", label: "Framing and placement (optional)", type: "textarea", ph: "Wide interior from behind the bar; traveler framed in the doorway, innkeeper foreground-left." },
    { k: "location", label: "Base location (optional)", type: "select", options: ["", ...P.locations.map((x) => x.id)], value: "" },
  );
  /* HOW IT IS MADE — OFFERED HERE, AND GENUINELY OPTIONAL.
     The list comes from the one route vocabulary, through the one presentation owner,
     so this form cannot offer a route the shot workspace does not. "Not decided yet"
     is first and is the default, and choosing it writes nothing at all. The field is
     omitted entirely if the intent surface has not loaded, rather than falling back to
     a hand-written route list that could drift from the contract. */
  const routeRows = typeof shotIntentChoiceRows === "function" ? shotIntentChoiceRows() : null;
  if (routeRows)
    fields.push({
      k: "deliveryRoute",
      label: "How is this shot made? (optional)",
      type: "select",
      options: routeRows,
      value: "",
      hint: "Leave this undecided if you do not know yet. Nothing is assumed for you: an undecided shot owes no frame and no motion, and you can choose or change this at any time from the shot.",
    });
  formModal("New shot", fields, (v) => {
    let sid = v.scene;
    if (!hasScenes) {
      sid = nextCreationId("scenes", "SC");
      P.scenes.push({
        id: sid,
        title: v.sceneTitle || "Scene 1",
        tier: "B",
        stage: "",
        characters: [],
        whatHappens: "",
        howItFeels: "",
        audio: {},
      });
    }
    if (!sceneById(sid)) return toast("Choose a scene");
    const siblings = P.shots.filter((s) => s.scene === sid);
    let n = siblings.length + 1;
    let id = sid + "-" + String(n).padStart(2, "0");
    while (P.shots.some((s) => s.id === id)) {
      n++;
      id = sid + "-" + String(n).padStart(2, "0");
    }
    const locationId = v.location || "";
    P.shots.push({
      id,
      scene: sid,
      title: v.title || "New shot",
      desc: v.desc || "",
      characters: [],
      positioning: v.positioning || "",
      route: "GENERATE",
      codes: locationId ? [locationId] : [],
      risks: [],
      safe: "",
      status: "UNBUILT",
      workflowStatus: "DRAFT",
      iterations: 0,
      notes: "",
      promptOptions: [],
      promptBuilds: [],
      winner: null,
      dur: 0,
      continuityStateSelections: {},
      keyframes: [newKeyframe(0)],
      clips: [],
      candidateFiles: [],
      stageApprovals: {},
      generationPackages: [],
      creationBrief: {
        locationId,
        propIds: [],
        mode: "auto",
        action: v.desc || "",
        staging: v.positioning || "",
        camera: "",
        notes: "",
        profileId: "",
        promptBuilds: [],
      },
    });
    /* THE ROUTE GOES THROUGH THE APPLICATION'S ONE WRITER, never onto the record from
       here. setShotIntent() is that writer: it goes through Slice 5a's route
       authority, refuses a value the normaliser does not recognise without touching
       the shot, and marks the continuity schema — three behaviours a second writer
       beside it would have to reimplement and would eventually reimplement
       differently. A suite asserts that this file names neither route-writing
       function by name, which is why they are described here instead.

       AN UNDECIDED SHOT GETS NO KEY. `deliveryRoute` is absent, not "", so a shot the
       filmmaker did not decide about serialises exactly as one created before this
       control existed, and nothing downstream can read a slot as a decision. */
    if (v.deliveryRoute && typeof setShotIntent === "function") setShotIntent(id, v.deliveryRoute);
    dirty();
    location.hash = "#/shot/" + id;
    route();
  });
};
window.delShot = (id) => {
  const shot = shotById(id);
  if (!shot) return;
  const takes = window.SCAN?.shots?.[id]?.takes || [];
  const runs = (window.AUTOMATION_RUNS || []).filter((run) => run.targetId === id);
  openModal(`<div class="dependency-delete-modal"><h3>Delete shot ${esc(id)}?</h3><p>${esc(shot.title || "Untitled shot")}</p><div class="dependency-impact-list"><b>Storage and history</b><span>${takes.length} take file${takes.length === 1 ? "" : "s"} remain on disk.</span><span>${runs.length} run/report record${runs.length === 1 ? "" : "s"} remain available as deleted-target history.</span></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="danger-btn" id="delete-shot-confirm">DELETE SHOT · KEEP MEDIA</button></div></div>`);
  setTimeout(() => {
    const button = document.getElementById("delete-shot-confirm");
    if (!button) return;
    button.onclick = () => {
      revokeShotCanonForRemoval(shot);
      deletedTargetRecord("shot", id, { scene: shot.scene, mediaRetained: true, takeCount: takes.length });
      P.shots = P.shots.filter((s) => s.id !== id);
      dirty(); closeModal(); location.hash = "#/scene/" + shot.scene;
    };
  }, 0);
};
window.moveShot = (id, dir) => {
  const s = shotById(id);
  const siblings = P.shots.filter((x) => x.scene === s.scene);
  const pos = siblings.indexOf(s);
  const target = siblings[pos + dir];
  if (!target) return;
  const i = P.shots.indexOf(s),
    j = P.shots.indexOf(target);
  [P.shots[i], P.shots[j]] = [P.shots[j], P.shots[i]];
  dirty();
  route();
};
window.toggleSceneChar = (sid, cid) => {
  const sc = sceneById(sid);
  sc.characters = sc.characters || [];
  sc.characters = sc.characters.includes(cid)
    ? sc.characters.filter((x) => x !== cid)
    : [...sc.characters, cid];
  dirty();
  route();
};
window.toggleShotChar = (id, cid) => {
  const s = shotById(id);
  s.characters = s.characters || [];
  const removing = s.characters.includes(cid);
  if (removing && typeof updateShotDependencyRelationship === "function") {
    /* Cast is the source list for every product speaker selector. Once a
       character leaves cast, clear every relationship that surface authored so
       no invisible speaker can keep a declaration/readiness blocker alive. The
       dependency owner rechecks attachment before it clears any declaration. */
    updateShotDependencyRelationship(s, cid, "");
  } else {
    s.characters = removing ? s.characters.filter((x) => x !== cid) : [...s.characters, cid];
    if (typeof clearDetachedShotStateDeclaration === "function")
      clearDetachedShotStateDeclaration(P, { shotId: id, entityId: cid });
  }
  dirty();
  route();
};
window.iter = (id, dv) => {
  const s = shotById(id);
  s.iterations = Math.max(0, (s.iterations || 0) + dv);
  dirty();
  route();
};
window.addOpt = (id) => {
  const s = shotById(id);
  s.promptOptions = s.promptOptions || [];
  s.promptOptions.push({
    id: "opt-" + (s.promptOptions.length + 1),
    text: "",
    refs: [],
    favorite: false,
  });
  dirty();
  route();
};
window.setOpt = (id, oid, k, v) => {
  shotById(id).promptOptions.find((o) => o.id === oid)[k] = v;
  dirty();
};
window.favOpt = (id, oid) => {
  shotById(id).promptOptions.forEach((o) => (o.favorite = o.id === oid));
  dirty();
  route();
  toast("Current prompt updated");
};
window.delOpt = (id, oid) => {
  const s = shotById(id);
  s.promptOptions = s.promptOptions.filter((o) => o.id !== oid);
  dirty();
  route();
};
window.addEntity = (list) => {
  const singular = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle", audio: "audio item" }[list] || list.slice(0, -1);
  formModal(
    "New " + singular,
    [
      {
        k: "id",
        label: "Code / id (optional)",
        ph: "Auto-generated",
      },
      { k: "name", label: "Name" },
      ...(list === "audio" ? [] : [{ k: "description", label: "Visual description", type: "textarea", ph: { characters: "Age, build, face, hair, clothing, materials, proportions, distinguishing details…", locations: "Architecture, layout, materials, age, light, atmosphere, important geometry…", props: "Shape, materials, scale, wear, construction, identifying details…", vehicles: "Vehicle class, silhouette, proportions, materials, finish, functional details, wear, identifying features…" }[list] }]),
    ],
    (v) => {
      const prefix = { characters: "CHAR", locations: "LOC", props: "PROP", vehicles: "VEH", audio: "AUDIO" }[list] || "ITEM";
      let id = creationSlug(v.id);
      if (!id && v.name) {
        const named = creationSlug(v.name);
        id = list === "characters" && named ? named : named ? `${prefix}-${named}` : "";
      }
      if (!id) id = nextCreationId(list, prefix);
      if (P[list].find((x) => x.id === id))
        id = nextCreationId(list, prefix);
      const base = {
        id,
        name: v.name || id,
        status: "NOT STARTED",
        workflowStatus: "DRAFT",
        prefix: id,
        creationDescription: v.description || "",
        assetPromptNotes: "",
        assetPromptProfile: "",
        assetPromptBuilds: [],
        coverageSlots: list === "audio" ? [] : (typeof coverageTemplateForList === "function" ? coverageTemplateForList(list) : []),
        /* Seeded in the one encoding this build authors. `requirement:"planned"`
           is what `required:false` has always meant to every reader. */
        expressionSlots: list === "characters" ? [
          { id: "neutral", label: "Neutral", requirement: templateRequirement(true), approvedFile: "", notes: "", status: "missing", replacementHistory: [] },
          { id: "focused", label: "Focused", requirement: templateRequirement(true), approvedFile: "", notes: "", status: "missing", replacementHistory: [] },
          { id: "worried", label: "Worried", requirement: templateRequirement(true), approvedFile: "", notes: "", status: "missing", replacementHistory: [] },
          { id: "determined", label: "Determined", requirement: templateRequirement(true), approvedFile: "", notes: "", status: "missing", replacementHistory: [] },
          { id: "relieved", label: "Relieved", requirement: templateRequirement(false), approvedFile: "", notes: "", status: "missing", replacementHistory: [] },
          { id: "custom", label: "Custom", requirement: templateRequirement(false), approvedFile: "", notes: "", status: "missing", replacementHistory: [] },
        ] : [],
        continuityStates: [{
          id: "state-default",
          name: "Default",
          appliesTo: "",
          approvedFile: "",
          notes: "Primary approved reference.",
          isDefault: true,
        }],
      };
      if (list === "characters")
        Object.assign(base, {
          role: "",
          block: v.description || "",
          driftNotes: "",
          anchors: [],
        });
      else base.notes = v.description || "";
      P[list].push(base);
      dirty();
      location.hash = `#/${ENTITY_ROUTE[list]}/${id}`;
      route();
    },
  );
};
function entityDependencyImpact(list, id) {
  const shotIds = new Set();
  const sceneIds = new Set();
  (P.scenes || []).forEach((scene) => {
    if ((scene.characters || []).includes(id)) sceneIds.add(scene.id);
  });
  (P.shots || []).forEach((shot) => {
    const records = typeof shotDependencyRecords === "function" ? shotDependencyRecords(P, shot) : [];
    const used = records.some((row) => row.id === id || row.sources.includes("codes") && (shot.codes || []).some((token) => shotEntityTokenMatches(token, id)));
    if (used) shotIds.add(shot.id);
  });
  return { shots: [...shotIds], scenes: [...sceneIds] };
}
function replaceEntityReferences(list, id, replacement = "") {
  const replaceArray = (rows) => (rows || []).flatMap((value) => value === id ? (replacement ? [replacement] : []) : [value]);
  (P.scenes || []).forEach((scene) => { scene.characters = replaceArray(scene.characters); });
  (P.shots || []).forEach((shot) => {
    if (typeof updateShotDependencyRelationship === "function") updateShotDependencyRelationship(shot, id, replacement);
    else {
      shot.characters = replaceArray(shot.characters);
      shot.codes = replaceArray(shot.codes);
      const brief = shot.creationBrief || {};
      if (brief.locationId === id) brief.locationId = replacement;
      brief.propIds = replaceArray(brief.propIds);
      brief.vehicleIds = replaceArray(brief.vehicleIds);
    }
  });
}
/* ==========================================================================
   B3 — DELETING A WHOLE REFERENCE REVOKES ITS CANON BEFORE IT REMOVES ANYTHING.

   THE DEFECT, AND IT STRANDED THE DOCUMENT EXACTLY AS AT1-E DID. delEntity()
   spliced the entity out of `P[list]`. That is a structural operation and it
   knows nothing about the authority ledger, so deleting a reference whose states
   held CURRENT Canon took their EDGES away with the record and left the RECEIPTS
   saying `status: "current"` about targets that no longer existed. The write seam
   compares the two on every save: the ordinary save was refused
   CANON_TRANSITION_REQUIRED, the Canon transition was refused
   AUTHORITY_EDGE_RECEIPT_MISMATCH, and zero writes occurred — so the project
   could not be saved at all afterwards, and every unrelated edit in the session
   was stuck behind receipts the filmmaker had no way to see or withdraw.

   This is the same defect the dedicated continuity-state path already fixed, on
   the path that removes ALL of an entity's states at once, and it is corrected
   the same way rather than a new way: PLAN, then WITHDRAW, then REMOVE.

     1. PLAN. Nothing is revoked for a removal that will not happen, and nothing
        is removed before every withdrawal is known to be possible. The plan is
        computed while the entity is still whole.
     2. WITHDRAW every current receipt through revokeEntityStateCanon(), the
        kernel's own command. No receipt is edited, no ledger row is deleted and
        no check is bypassed.
     3. REMOVE, and only then.

   IF ANY RECEIPT CANNOT BE WITHDRAWN, NOTHING HAPPENS AT ALL. A drifted receipt —
   one whose approved image was renamed or replaced after approval, so the live
   edge no longer matches it — cannot be withdrawn by any kernel command, because
   revokeCanon and systemInvalidateCanon both require currentHumanAuthority.
   Removing the entity anyway would strand the document, so the deletion is
   refused before a single mutation, the entity/state/receipt relationship is left
   exactly as it was, and the project stays saveable. The refusal names the states
   and what would make the reference removable.

   THE LEDGER IS RESTORED IF A REVOCATION FAILS MID-WAY. The plan already proved
   every row withdrawable, so this should not happen; if it ever does, a
   half-withdrawn ledger is the one outcome worse than either whole one.

   NO `await` ANYWHERE IN THIS PATH. revokeCanon() requires the trusted gesture to
   be the event currently dispatching, and a suspension would end it partway. */
function entityAuthorityStateIds(list, entity) {
  const ids = new Set();
  for (const state of entity.continuityStates || []) {
    const stateId = String((state && state.id) || "");
    if (stateId) ids.add(stateId);
  }
  /* A receipt can name a state this entity no longer lists. Removing the entity
     removes that receipt's target too, so it is part of the plan. */
  const receipts = (P.productionAuthority && P.productionAuthority.receipts) || [];
  for (const row of receipts) {
    if (!row || String(row.status) !== "current") continue;
    if (String(row.kind || "") !== "entity-state") continue;
    if (String(row.list || "") !== String(list)) continue;
    if (String(row.entityId || "") !== String(entity.id)) continue;
    const stateId = String(row.stateId || "");
    if (stateId) ids.add(stateId);
  }
  return [...ids];
}
/* Read-only. Returns the states that must be withdrawn and the states that
   cannot be, without touching either the entity or the ledger. */
function planEntityCanonWithdrawal(list, entity) {
  const withdraw = [];
  const blocked = [];
  if (typeof authorityTarget !== "function" || typeof authorityHistory !== "function"
    || typeof hasCurrentHumanAuthority !== "function" || typeof revokeEntityStateCanon !== "function") {
    return { withdraw, blocked, available: false };
  }
  for (const stateId of entityAuthorityStateIds(list, entity)) {
    const target = authorityTarget({ kind: "entity-state", list, entityId: entity.id, stateId });
    if (!target) continue;
    if (!authorityHistory(P, target).some((row) => row && String(row.status) === "current")) continue;
    if (hasCurrentHumanAuthority(P, target)) withdraw.push(stateId);
    else blocked.push(stateId);
  }
  return { withdraw, blocked, available: true };
}
function entityStateNames(entity, stateIds) {
  return stateIds
    .map((stateId) => ((entity.continuityStates || []).find((row) => row && row.id === stateId) || {}).name || stateId)
    .join(", ");
}
window.delEntity = (list, id) => {
  const impact = entityDependencyImpact(list, id);
  const alternatives = (P[list] || []).filter((row) => row.id !== id);
  openModal(`<div class="dependency-delete-modal"><h3>Delete ${esc(id)}?</h3><p>This reference is used by ${impact.shots.length} shot${impact.shots.length === 1 ? "" : "s"} and ${impact.scenes.length} scene${impact.scenes.length === 1 ? "" : "s"}.</p>${impact.shots.length || impact.scenes.length ? `<div class="dependency-impact-list"><b>Dependencies</b>${impact.scenes.length ? `<span>Scenes: ${impact.scenes.map(esc).join(", ")}</span>` : ""}${impact.shots.length ? `<span>Shots: ${impact.shots.slice(0,20).map(esc).join(", ")}${impact.shots.length > 20 ? "…" : ""}</span>` : ""}</div><label class="field"><span>Replace references with</span><select id="delete-entity-replacement"><option value="">Remove references without replacement</option>${alternatives.map((row) => `<option value="${attr(row.id)}">${esc(row.name || row.id)} · ${esc(row.id)}</option>`).join("")}</select></label>` : `<p class="hint">No scene or shot dependencies were found.</p>`}<div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="danger-btn" id="delete-entity-confirm">DELETE & UPDATE REFERENCES</button></div></div>`);
  setTimeout(() => {
    const button = document.getElementById("delete-entity-confirm");
    if (!button) return;
    button.onclick = () => {
      const replacement = document.getElementById("delete-entity-replacement")?.value || "";
      const entity = (P[list] || []).find((x) => x.id === id);
      if (!entity) return closeModal();
      const refusalKey = `entity-delete:${list}:${id}`;
      if (typeof clearActionRefusal === "function") clearActionRefusal(refusalKey);

      /* PLAN, BEFORE ANY MUTATION. */
      const plan = planEntityCanonWithdrawal(list, entity);
      if (plan.blocked.length) {
        const many = plan.blocked.length !== 1;
        const message =
          `${entity.name || id} still holds ${many ? "approval records" : "an approval record"} CineBraid cannot withdraw, `
          + `because the approved image for ${many ? "these states was" : "this state was"} renamed or replaced after it was `
          + `approved and the record no longer matches it: ${entityStateNames(entity, plan.blocked)}. `
          + `Re-approve ${many ? "those states' current images" : "that state's current image"}, then delete this reference. `
          + "Deleting it now would leave an approval naming a reference that no longer exists, and the project could not be saved.";
        if (typeof recordActionRefusal === "function") {
          recordActionRefusal(refusalKey, message, "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE");
        }
        closeModal();
        route();
        return toast(message);
      }

      /* WITHDRAW, all of it, before anything is removed. */
      if (plan.withdraw.length) {
        const ledgerBefore = JSON.parse(JSON.stringify(P.productionAuthority || null));
        const at = new Date().toISOString();
        try {
          for (const stateId of plan.withdraw) {
            revokeEntityStateCanon(P, {
              list, entityId: id, stateId,
              at, via: "confirmed-target-removal", reason: "target-removed", clearEdge: false,
            });
          }
        } catch (error) {
          /* The plan said every row was withdrawable, so reaching here means the
             ledger disagreed mid-way. Put it back exactly as it was and remove
             nothing: a half-withdrawn ledger is worse than either whole outcome. */
          if (ledgerBefore === null) delete P.productionAuthority;
          else P.productionAuthority = ledgerBefore;
          const message = `${entity.name || id} was not deleted: ${error.message || "an approval record could not be withdrawn"}. Nothing was changed.`;
          if (typeof recordActionRefusal === "function") {
            recordActionRefusal(refusalKey, message, error.code || "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE");
          }
          closeModal();
          route();
          return toast(message);
        }
      }

      /* REMOVE, and only now. */
      replaceEntityReferences(list, id, replacement);
      deletedTargetRecord(list.slice(0,-1), id, { replacement: replacement || null, affectedShots: impact.shots, affectedScenes: impact.scenes });
      P[list] = P[list].filter((x) => x.id !== id);
      dirty(); closeModal(); location.hash = `#/library/${list}`; route();
    };
  }, 0);
};
window.addSession = () =>
  formModal(
    "New session",
    [
      { k: "summary", label: "One-paragraph summary", type: "textarea" },
      {
        k: "cf",
        label: "Carry-forward items (separate with ;)",
        type: "textarea",
      },
    ],
    (v) => {
      const n = (P.sessions[P.sessions.length - 1]?.n || 0) + 1;
      P.sessions.push({
        n,
        date: new Date().toISOString().slice(0, 10),
        summary: v.summary || "",
        carryForward: (v.cf || "")
          .split(";")
          .map((x) => x.trim())
          .filter(Boolean),
      });
      dirty();
      route();
    },
  );
window.delSession = (n) => {
  confirmModal(
    "Remove session " + n + " from the log?",
    () => { P.sessions = P.sessions.filter((s) => s.n !== n); dirty(); route(); },
    { title: `Remove session ${n}`, confirmLabel: "REMOVE" },
  );
};

/* ---------- status + QC gate ---------- */
window.setStatus = (id, st) => {
  const s = shotById(id);
  if (st !== "LOCKED") {
    s.status = st;
    dirty();
    route();
    return;
  }
  const missing = (s.clips || []).filter(
    (c) => clipNeedsWinner(c) && !clipDone(c),
  );
  if (missing.length) {
    openModal(`<h3>Cannot lock — winners missing</h3>
      <div class="modal-sub">A SHOT LOCKS ONLY WHEN EVERY CLIP HAS ITS APPROVED FRAME</div>
      <div class="canon-notes">Missing: ${missing.map((c) => esc(c.suffix + " — " + c.title + (c.kind === "atomic-flf" ? " (needs FIRST + LAST)" : ""))).join("<br>")}</div>
      <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
    return;
  }
  openModal(`<h3>QC gate — ${esc(id)}</h3>
    <div class="modal-sub">RUN IN ORDER · A SHOT IS LOCKED ONLY PAST ALL FIVE</div>
    ${P.qcChecklist.map((q, i) => `<label class="qc-item"><input type="checkbox" onchange="this.closest('.qc-item').classList.toggle('done',this.checked); qcCheck()"> <span>${i + 1}. ${esc(q)}</span></label>`).join("")}
    <div class="modal-actions">
      <button class="cancel" onclick="closeModal()">Cancel</button>
      <button class="lock-btn" id="lock-btn" disabled onclick="confirmLock('${id}')">STAMP LOCKED</button>
    </div>`);
};
window.qcCheck = () => {
  $("#lock-btn").disabled = ![
    ...document.querySelectorAll(".qc-item input"),
  ].every((c) => c.checked);
};
window.confirmLock = (id) => {
  shotById(id).status = "LOCKED";
  dirty();
  closeModal();
  route();
  stampCeremony("LOCKED");
};
