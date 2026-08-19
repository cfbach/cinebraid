/* ---------- canon docs ---------- */
window.openDoc = async (i, btn) => {
  document
    .querySelectorAll(".doc-tab")
    .forEach((t) => t.classList.remove("on"));
  if (btn) btn.classList.add("on");
  const raw = await (
    await fetch("/api/docs/" + encodeURIComponent(window._docs[i]))
  ).text();
  $("#doc-body").innerHTML = md(raw);
};
function md(src) {
  const lines = esc(src).split("\n");
  let out = [],
    inCode = false,
    inTable = false;
  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  for (const L of lines) {
    if (L.startsWith("```")) {
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(L);
      continue;
    }
    if (/^\|/.test(L)) {
      if (/^\|[\s:\-|]+\|$/.test(L)) continue;
      if (!inTable) {
        out.push("<table>");
        inTable = true;
      }
      out.push(
        "<tr>" +
          L.split("|")
            .slice(1, -1)
            .map((c) => "<td>" + inline(c.trim()) + "</td>")
            .join("") +
          "</tr>",
      );
      continue;
    } else if (inTable) {
      out.push("</table>");
      inTable = false;
    }
    if (/^---+\s*$/.test(L)) {
      out.push("<hr>");
      continue;
    }
    const h = L.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^[-*]\s+/.test(L)) {
      out.push("<li>" + inline(L.replace(/^[-*]\s+/, "")) + "</li>");
      continue;
    }
    if (L.trim() === "") {
      out.push("");
      continue;
    }
    out.push("<p>" + inline(L) + "</p>");
  }
  if (inTable) out.push("</table>");
  if (inCode) out.push("</pre>");
  return out.join("\n");
}

window.copyText = (t) =>
  navigator.clipboard.writeText(t).then(() => toast("Copied"));

/* ---------- canonical intake (drop → name into the code scheme) ---------- */
const VIEW_LIST = {
  character: "characters",
  location: "locations",
  prop: "props",
  vehicle: "vehicles",
  sound: "audio",
  characters: "characters",
  locations: "locations",
  props: "props",
  vehicles: "vehicles",
  audio: "audio",
};
/* The reference workspace has two ways in — the "UPLOAD REFERENCES" button, which opens
   the file picker directly, and a drop target. The drop target is the older of the two
   and no longer exists: `#entity-dz` is not rendered anywhere in the product. This
   function returned on its absence before reaching the line that gives the file input
   its change handler, so choosing a file did exactly nothing — no request, no error, no
   state change, on every Reference in every project. The frames uploader guards on both
   its own elements and renders both, which is why importing a frame always worked.
   The picker is now wired on the input alone, and the drop target is handled only if it
   is there. */
function wireEntityDropzone(view, id) {
  const list = VIEW_LIST[view] || view;
  const input = document.getElementById("entity-file");
  if (!input) return;
  input.onchange = () => intakeModal(list, id, [...input.files]);
  const dz = document.getElementById("entity-dz");
  if (!dz) return;
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
  dz.addEventListener("drop", (e) =>
    intakeModal(list, id, [...e.dataTransfer.files]),
  );
}
function intakeModal(list, id, files) {
  if (!files.length) return;
  const it = P[list].find((x) => x.id === id);
  const pendingState = window._pendingEntityStateUpload && window._pendingEntityStateUpload.list === list && window._pendingEntityStateUpload.id === id
    ? window._pendingEntityStateUpload
    : null;
  const targetState = pendingState ? entityStateById(it, pendingState.stateId) : null;
  window._intake = { list, id, files, targetStateId: targetState?.id || "", targetStateName: targetState?.name || "" };
  openModal(`<h3>Upload candidates — ${files.length} file(s)</h3><div class="modal-sub">${targetState ? `TARGET · ${esc(targetState.name || "CONTINUITY STATE")} · ` : ""}ORIGINAL FILENAMES ARE RETAINED IN METADATA · PRODUCTION NAMES ARE ASSIGNED ONLY ON APPROVAL</div>
    <div class="approval-preview"><b>${esc(it.name || it.id)}</b><span>${esc(files.map((f) => f.name).join(", ")).slice(0, 180)}</span></div>
    <div class="form-field"><label>Made with (optional provenance)</label><select id="in-model" class="status-select"><option value="">— not recorded —</option>${(P.meta.models || []).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select></div>
    <div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="submit-btn" onclick="doIntake()">UPLOAD CANDIDATES</button></div>`);
}
window.doIntake = async () => {
  const { list, id, files, targetStateId = "", targetStateName = "" } = window._intake,
    model = document.getElementById("in-model")?.value || "",
    it = P[list].find((x) => x.id === id),
    type = ENTITY_MEDIA[list];
  closeModal();
  const saved = [],
    original = [];
  const prefix = (it.prefix || it.anchorPrefix || it.id).replace(/-+$/, "");
  const stamp = Date.now().toString(36).toUpperCase();
  for (let i = 0; i < files.length; i++) {
    const f = files[i],
      ext = f.name.includes(".")
        ? f.name.slice(f.name.lastIndexOf(".")).toLowerCase()
        : ".png";
    const name = `${prefix}-CANDIDATE-${stamp}-${String(i + 1).padStart(2, "0")}${ext}`;
    const r = await fetch(
      "/api/media/upload?type=" + type + "&name=" + encodeURIComponent(name) + projectSlugParam(),
      {
        method: "POST",
        headers: { "Content-Type": f.type || "application/octet-stream" },
        body: f,
      },
    );
    const d = await r.json();
    if (r.ok) {
      saved.push(d.name);
      original.push({ stored: d.name, original: f.name, ...(targetStateId ? { targetStateId, targetStateName } : {}) });
    }
  }
  it.candidateFiles = [...(it.candidateFiles || []), ...original];
  if (model && saved.length)
    (it.made = it.made || []).push({
      model,
      files: saved.join(", "),
      prompt: "",
      date: new Date().toISOString().slice(0, 10),
    });
  if (entityWorkflowState(it).key === "DRAFT") {
    it.workflowStatus = "IN PROGRESS";
    it.status = "IN PROGRESS";
  }
  dirty();
  SCAN = await (await fetch("/api/scan")).json();
  window._pendingEntityStateUpload = null;
  /* SLICE 3: the candidate grid these files land in moved into `reference`.
     Writing the retired `review` id would still resolve through legacyMap, but it
     would leave a stale id in storage that every later read has to translate. */
  if (targetStateId) window.selectBoundedTask?.("entity-task", `${list}:${id}`, "reference");
  else route();
  toast(saved.length + ` candidate file(s) uploaded${targetStateName ? ` for ${targetStateName}` : ""}`);
};

/* ---------- clip mutations ---------- */
window.setClip = (id, ci, k, v) => {
  const s = shotById(id);
  s.clips[ci][k] = v;
  dirty();
};
window.delClip = (id, ci) => {
  confirmModal(
    "Remove this motion segment? Candidate files stay on disk.",
    () => {
      const s = shotById(id);
      s.clips.splice(ci, 1);
      normalizeShotV5(s);
      dirty();
      route();
    },
    { title: "Remove motion segment", confirmLabel: "REMOVE" },
  );
};
window.addClip = (id) => {
  const s = shotById(id);
  normalizeShotV5(s);
  const i = s.clips.length,
    label = alphaLabel(i),
    from =
      s.keyframes[Math.min(i, s.keyframes.length - 1)]?.id ||
      s.keyframes[0]?.id ||
      "";
  s.clips.push({
    id: "seg-" + Date.now().toString(36),
    suffix: label.toLowerCase(),
    label,
    title: "New motion segment",
    dur: 5,
    kind: "i2v",
    note: "",
    motionPrompt: "",
    fromFrame: from,
    toFrame: "",
    generationPackages: [],
  });
  SHOT_SEGMENT_STATE[id] = s.clips[s.clips.length - 1].id;
  dirty();
  route();
};

/* ---------- streamlined approval ---------- */
function projectCode() {
  const words = String(P.meta.code || P.meta.title || "PROJECT")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.filter((w) => !["THE", "A", "AN"].includes(w)).join("-") || "PROJECT"
  ).slice(0, 18);
}
function canonicalSuggestion(id, name, target = "shot") {
  const s = shotById(id),
    dot = name.lastIndexOf("."),
    ext = dot >= 0 ? name.slice(dot).toLowerCase().replace(/^\./, "") : "png";
  let slot = "PRIMARY";
  if (target.startsWith("frame:"))
    slot = "FRAME_" + (frameById(s, target.slice(6))?.label || "X");
  else if (target.startsWith("segment:"))
    slot =
      "MOTION_" +
      ((s.clips || []).find((c) => unitKey(c) === target.slice(8))?.label ||
        "X");
  else if (target !== "shot") {
    const [ci, edge] = target.split(":");
    const c = s.clips?.[+ci];
    slot =
      (c?.suffix || "A").toUpperCase() +
      (edge === "first" ? "_FIRST" : edge === "last" ? "_LAST" : "");
  }
  const versionPadding = Math.max(2, Math.min(5, Number(CONFIG?.naming?.versionPadding || 3) || 3));
  const fallbackStem = `${projectCode()}_${id}_${slot}`.replace(/[^A-Z0-9_-]/g, "_");
  const used = takesFor(id).filter((t) => t.name.toUpperCase().includes(id.toUpperCase())).length;
  const template = String(CONFIG?.naming?.filenameTemplate || "{project}_{shot}_{slot}_V{version}.{ext}");
  const sceneMatch = String(id || "").match(/SC\d+/i);
  const scene = sceneMatch ? sceneMatch[0].toUpperCase() : (s?.sceneId || "SC00").toUpperCase();
  const tokens = {
    project: projectCode(),
    scene,
    shot: String(id || "SHOT").toUpperCase(),
    slot,
    stage: target.startsWith("segment:") ? "MOTION" : target.startsWith("frame:") ? "FRAME" : "SHOT",
    state: "DEFAULT",
    version: String(used + 1).padStart(versionPadding, "0"),
    ext,
  };
  const rendered = template.replace(/\{(project|scene|shot|slot|stage|state|version|ext)\}/gi, (_, key) => tokens[key.toLowerCase()] || "");
  const cleaned = rendered.replace(/[^A-Z0-9_.-]/gi, "_").replace(/_+/g, "_").replace(/\._/, ".");
  return cleaned.includes(".") ? cleaned : `${fallbackStem}_V${String(used + 1).padStart(versionPadding, "0")}.${ext}`;
}
window.approveTake = (id, name) => {
  const s = shotById(id);
  normalizeShotV5(s);
  window._approval = { id, name };
  const video = isVideo(name);
  const targets = video
    ? (s.clips || [])
        .filter((c) => !["plan", "post"].includes(c.kind))
        .map((c) => ({
          v: "segment:" + unitKey(c),
          l: `Motion ${c.label || c.suffix} — ${c.title}`,
        }))
    : (s.keyframes || []).map((f) => ({
        v: "frame:" + f.id,
        l: `Frame ${f.label} — ${f.title}`,
      }));
  const target =
    targets.find((o) => {
      if (o.v.startsWith("frame:")) return !frameById(s, o.v.slice(6))?.winner;
      const c = (s.clips || []).find((x) => unitKey(x) === o.v.slice(8));
      return !c?.videoWinner;
    })?.v ||
    targets[0]?.v ||
    "shot";
  openModal(
    `<h3>Approve version — ${esc(id)}</h3><div class="modal-sub">ASSIGN THIS ${video ? "VIDEO" : "IMAGE"} TO ITS EXACT PLACE IN THE SHOT PLAN</div><div class="approval-preview"><b>${esc(name)}</b><span>${video ? "Motion output" : "Approved keyframe"}</span></div>${targets.length ? `<div class="form-field"><label>Approve as</label><select id="approve-target" class="status-select" onchange="updateApprovalName()">${targets.map((o) => `<option value="${o.v}" ${o.v === target ? "selected" : ""}>${esc(o.l)}</option>`).join("")}<option value="shot">Primary shot output</option></select></div>` : `<input type="hidden" id="approve-target" value="shot">`}<div class="form-field"><label>Generated canonical filename</label><input id="approve-name" value="${attr(canonicalSuggestion(id, name, target))}"><div class="hint">CineBraid generates this automatically. Edit only for an exceptional naming requirement.</div></div><div class="approval-note">${s.submissionNote ? `Submitter note: ${esc(s.submissionNote)}` : "No submission note."}</div><div class="modal-actions"><button class="changes-btn" onclick="closeModal();requestShotChanges('${id}')">Request changes</button><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="confirmApproveTake()">APPROVE VERSION</button></div>`,
  );
};
window.updateApprovalName = () => {
  const a = window._approval;
  if (!a) return;
  const target = document.getElementById("approve-target")?.value || "shot";
  const el = document.getElementById("approve-name");
  if (el) el.value = canonicalSuggestion(a.id, a.name, target);
};
window.confirmApproveTake = async () => {
  const { id, name } = window._approval || {};
  if (!id) return;
  const s = shotById(id),
    target = document.getElementById("approve-target")?.value || "shot",
    requested = document.getElementById("approve-name")?.value.trim();
  /* THE CANON WRITE IS THE FIRST THING THAT HAPPENS, AND IT IS SYNCHRONOUS.
   *
   * Batch 1D minted a capability here, awaited a rename, and then committed
   * whatever filename came back. The acceptance audit spent that target-only
   * token on CHANGED.png/asset-B while the modal displayed DISPLAYED.png/asset-A.
   *
   * The order is inverted, and inverting it is what deletes the whole class:
   *
   *     approve the bytes the person is looking at, inside their click
   *     THEN rename them, if they asked for a rename
   *     THEN move the receipt with them
   *
   * That is strictly more honest than the old order — the creator approved the
   * image in front of them, and the canonical filename is a storage decision
   * that follows — and it needs no capability, because nothing crosses an
   * `await`. If the rename fails the approval still stands on the original
   * name, which is what the toast has always said happens.
   *
   * A video approval targets the shot's DELIVERY pointer, because `opening` is
   * deliberately null for video. */
  const displayedAssetId = (takesFor(id).find((item) => item.name === name) || {}).assetId || "";
  const at = new Date().toISOString();
  const video = isVideo(name);
  const previousActiveName = target === "shot"
    ? s.winner || ""
    : target.startsWith("frame:")
      ? frameById(s, target.slice(6))?.winner || ""
      : target.startsWith("segment:")
        ? (s.clips || []).find((x) => unitKey(x) === target.slice(8))?.videoWinner || ""
        : "";
  let complete = false,
    label = "VERSION APPROVED";
  /* CLASSIFICATION B — A MOTION UNIT'S START/END FRAME POINTERS ARE NOT CANON.
     `clips[i].winner` and `clips[i].winnerEnd` select WHICH APPROVED STILLS a
     motion unit interpolates between. They are inputs to a generation, not
     production output, and the Canon they depend on is the frame authority that
     approved those stills in the first place. */
  const motionEdgeTarget = !(target === "shot" || target.startsWith("frame:") || target.startsWith("segment:"));
  /* WHICH TARGET THIS CLICK APPROVED. The rename below moves those exact bytes,
     so the receipt repair is scoped to this one target — a filename is not an
     identity, and a global sweep rewrote canon for unrelated objects that
     happened to share a name. */
  let canonTarget = null;
  try {
    if (target === "shot") {
      const opening = video ? null : (s.keyframes || [])[0];
      /* THE STILL CASE. The opening frame and the shot are ONE authority edge —
         the shot's winner IS the opening frame's. One receipt, addressed to the
         frame, so the gate predicate finds it whichever way the run named it. */
      if (opening) {
        canonTarget = { kind: "shot-frame", shotId: id, frameId: opening.id };
        approveFrameCanon(P, { shotId: id, frameId: opening.id, value: name, assetId: displayedAssetId, at, via: "shot-take-approval" });
      } else {
        canonTarget = { kind: "shot-delivery", shotId: id };
        /* An approved video IS the shot's deliverable, so it goes through the
           delivery boundary rather than writing `s.winner` with no receipt. */
        approveDeliveryCanon(P, { shotId: id, value: name, assetId: displayedAssetId, at, via: "shot-take-approval" });
      }
    } else if (target.startsWith("frame:")) {
      const f = frameById(s, target.slice(6));
      if (f) canonTarget = { kind: "shot-frame", shotId: id, frameId: f.id };
      if (f) approveFrameCanon(P, { shotId: id, frameId: f.id, value: name, assetId: displayedAssetId, at, via: "shot-take-approval" });
      label = "FRAME APPROVED";
    } else if (target.startsWith("segment:")) {
      const unitId = target.slice(8);
      const c = (s.clips || []).find((x) => unitKey(x) === unitId);
      if (c) canonTarget = { kind: "shot-motion", shotId: id, unitKey: c.id || unitId };
      if (c) approveMotionCanon(P, { shotId: id, unitKey: c.id || unitId, value: name, assetId: displayedAssetId, at, via: "shot-take-approval" });
      label = "MOTION APPROVED";
    }
  } catch (error) {
    return toast(error.message || "That file could not be approved");
  }

  /* EVERYTHING BELOW IS AFTER THE DECISION. The rename moves the bytes and the
     receipt follows them; nothing here can change WHAT was approved. */
  let finalName = name, renamedAssetId = "";
  if (requested && requested !== name) {
    const r = await fetch("/api/media/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectSlug: ACTIVE_PROJECT_SLUG,
        dir: "shots/" + id + "/takes",
        from: name,
        to: requested,
      }),
    });
    const d = await r.json();
    if (r.ok) {
      finalName = d.name;
      renamedAssetId = d.assetId || "";
      if (typeof renameCandidateRecord === "function")
        renameCandidateRecord(s, name, finalName);
      /* P4-SEM-C3. renameCandidateRecord() moves the candidate row's `stored`
         and retargets selectedCandidate — and nothing else. Every WINNER edge
         pointing at the renamed file kept the old name, so approving a take
         under a new filename could leave s.winner, another frame's winner, a
         clip's videoWinner or canonicalName naming a file no longer on disk.
         This enumerates the edges rather than remembering them. */
      repairShotApprovalIdentity(s, { from: name, to: finalName, assetId: renamedAssetId });
      /* AND THE RECEIPT FOLLOWS THE BYTES. Without this the receipt names a file
         the edge no longer carries, and the next read revokes a decision a
         person really made. */
      /* Scoped to the target this click approved, and refused if the identity
         no longer proves the same bytes — in which case the approval reads as
         historic rather than being silently repointed. */
      if (canonTarget) repairCanonValue(P, { ...canonTarget, from: name, to: finalName, assetId: renamedAssetId || displayedAssetId });
      SCAN = await (await fetch("/api/scan")).json();
    } else toast("Could not rename; approval kept the original filename");
  }
  const approvedAssetId = (takesFor(id).find((item) => item.name === finalName) || {}).assetId || renamedAssetId || displayedAssetId;
  if (target.startsWith("frame:") || target.startsWith("segment:")) complete = shotApprovalComplete(s);
  /* `creationBrief.approvedMotionFile` USED TO BE WRITTEN HERE, as a
     "convenience pointer". It is the shot's DELIVERY edge, so approving one
     motion take silently produced a delivery pointer nobody had approved —
     a raw pointer establishing something that looks like canon. Approving a
     motion take is not deciding the shot's deliverable; Mark as final is. */
  if (motionEdgeTarget) {
    const [ci, edge] = target.split(":");
    if (edge === "last") {
      s.clips[+ci].winnerEnd = finalName;
      stampShotApprovalIdentity(s.clips[+ci], "winnerEnd", approvedAssetId);
    } else {
      s.clips[+ci].winner = finalName;
      stampShotApprovalIdentity(s.clips[+ci], "winner", approvedAssetId);
    }
    complete = (s.clips || []).filter(clipNeedsWinner).every(clipDone);
  }
  if (typeof guidedClearApprovalTarget === "function")
    guidedClearApprovalTarget(s, target, finalName);
  if (typeof markCandidateApproved === "function")
    markCandidateApproved(s, finalName, target);
  if (!video && previousActiveName && previousActiveName !== finalName && typeof guidedFrameApprovalChanged === "function")
    guidedFrameApprovalChanged(id, target, previousActiveName, finalName);
  if (complete) {
    s.workflowStatus = "APPROVED";
    s.status = "LOCKED";
    s.reviewStatus = "";
    s.approvedAt = new Date().toISOString();
    s.canonicalName = finalName;
  } else {
    s.workflowStatus = "IN PROGRESS";
    s.status = "BUILT";
  }
  dirty();
  closeModal();
  route();
  /* A run parked on "approve this frame" is satisfied by THIS act even though the
     act happened outside the run's own modal. Reconciling here is what stops
     Assistant, Global Activity and the Terminal asserting a decision the creator
     has just taken. Fire-and-forget: the same reconciliation runs on every read,
     so a failure here delays convergence rather than losing it. */
  if (typeof v670ReconcileAfterApproval === "function") v670ReconcileAfterApproval();
  stampCeremony(complete ? "APPROVED" : label);
  toast(
    complete
      ? "Required outputs approved and added to the live Bible"
      : "Approved — remaining frame or motion decisions are still open",
  );
  if (!video && (target === "shot" || target.startsWith("frame:")) && typeof guidedFrameSequenceInputs === "function" && typeof reviewGuidedFrameSequence === "function") {
    const inputs = guidedFrameSequenceInputs(s);
    const visionReady = typeof capabilityState === "function" && capabilityState("vision")?.ready;
    if (inputs.length >= 2 && visionReady) setTimeout(() => reviewGuidedFrameSequence(id), 350);
  }
};

window.setWinner = (id, name) => approveTake(id, name);
function entityCanonicalSuggestion(list, id, name, stateId = "") {
  const x = P[list].find((e) => e.id === id),
    st = stateId ? entityStateById(x, stateId) : null,
    dot = name.lastIndexOf("."),
    ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  const suffix = st && !st.isDefault ? `_${String(st.name || "state").replace(/[^A-Z0-9_-]/gi, "_").toUpperCase()}` : "";
  const stem = `${x.id}_PRIMARY${suffix}`.replace(/[^A-Z0-9_-]/gi, "_").toUpperCase();
  const used = entityMedia(list, x).filter((m) =>
    m.name.toUpperCase().startsWith(stem + "_V"),
  ).length;
  return `${stem}_V${String(used + 1).padStart(3, "0")}${ext}`;
}
/* CONTINUATION IS A LINEAGE QUESTION, NOT A LIST POSITION.

   Dogfood #2 A6 / forensic F5. This used to rotate cyclically through the whole
   state list — `[...slice(index+1), ...slice(0,index)]` — so after the final
   descendant it wrapped round and offered an ancestor, and the copy beside it
   said the ancestor would derive from the state just approved. Accepting that
   offer then reparented the ancestor beneath its own descendant.

   public/shared-state-lineage.js owns the rule; these two functions are its call
   sites and hold no opinion of their own. */
function entityApprovalContinuationStates(entity, currentStateId) {
  const states = entityStateListRead(entity, true);
  const byId = new Map(states.map((state) => [state.id, state]));
  return continuationCandidates(states, currentStateId)
    .map((candidate) => byId.get(candidate.id))
    .filter(Boolean);
}
function entityApprovalContinuationOutcome(entity, currentStateId) {
  return continuationOutcome(entityStateListRead(entity, true), currentStateId);
}
function entitySuggestedContinuationState(entity, currentStateId) {
  return entityApprovalContinuationOutcome(entity, currentStateId).suggestedStateId;
}
/* OPEN THE EXACT EDITOR, IN THE WORKSPACE THAT CONTAINS IT.

   The coverage subview and the selected state were being written, but the entity
   workspace's TASK was not — so a continuation launched from Review re-rendered
   Review, where no continuity-state editor exists, and the creator saw nothing
   happen. Coverage is where continuity states live, so the task is selected
   explicitly rather than left to whatever the workspace last remembered. */
function revealEntityContinuityState(stateId) {
  const routeParts = String(location.hash || "").split("/");
  const view = routeParts[1] || "", id = decodeURIComponent(routeParts[2] || "");
  const list = ({character:"characters",location:"locations",prop:"props",vehicle:"vehicles"})[view] || "";
  if (list && id) {
    window.boundedWriteFocusedTask?.("entity-task", `${list}:${id}`, "coverage");
    window.boundedWriteState?.("selected:entity-coverage-view", `${list}:${id}`, "states");
    window.boundedWriteState?.("selected:continuity-state", `${list}:${id}`, stateId);
    window.route?.();
  }
  setTimeout(() => {
    const outer = document.querySelector?.(".continuity-states");
    if (outer) outer.open = true;
    const card = [...(document.querySelectorAll?.("[data-continuity-state-id]") || [])]
      .find((item) => item.dataset?.continuityStateId === stateId);
    if (!card) return;
    const studio = card.querySelector?.(".entity-state-generation");
    if (studio) studio.open = true;
    card.scrollIntoView?.({ behavior: "smooth", block: "start" });
    setTimeout(() => card.querySelector?.(".continuity-state-delta textarea")?.focus?.(), 80);
  }, 50);
}
window.approveEntityFile = (list, id, name, stateId = "") => {
  const x = P[list].find((e) => e.id === id),
    states = entityStateListRead(x, true),
    media = entityMedia(list, x);
  if (!media.length) return toast("Add or generate a candidate before approving a reference");
  const requestedState = entityStateById(x, stateId || "state-default") || states[0];
  const selected = media.find((item) => item.name === name)
    || media.find((item) => item.name === requestedState?.approvedFile)
    || media.find((item) => item.name === x.approvedFile)
    || media[media.length - 1];
  window._entityApproval = { list, id, name: selected.name, stateId: requestedState?.id || "state-default" };
  openModal(
    `<div class="entity-approval-modal"><h3>Approve reference — ${esc(x.name || id)}</h3><div class="modal-sub">ASSIGN ONE CANDIDATE TO ONE CONTINUITY STATE</div><div class="entity-approval-modal-layout"><figure><div id="entity-approval-preview">${isVideo(selected.name) ? `<video muted controls src="${attr(selected.url)}"></video>` : `<img src="${attr(selected.url)}" alt="Candidate to approve">`}</div><figcaption id="entity-approval-file-caption">${esc(selected.name)}</figcaption></figure><div class="entity-approval-fields"><div class="form-field"><label>Candidate file</label><select id="entity-approve-file" onchange="syncEntityApprovalModal()">${media.map((item) => `<option value="${attr(item.name)}" ${item.name === selected.name ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></div><div class="form-field"><label>Approve for continuity state</label><select id="entity-approve-target" onchange="syncEntityApprovalModal()">${states.map((st) => `<option value="${attr(st.id)}" ${String(requestedState?.id || "state-default") === String(st.id) ? "selected" : ""}>${esc(st.name || "Default")}${st.appliesTo ? ` · ${esc(st.appliesTo)}` : ""}</option>`).join("")}</select></div><div class="entity-approval-target-summary" id="entity-approval-target-summary"></div><div class="form-field"><label>Generated canonical filename</label><input id="entity-approve-name" value="${attr(entityCanonicalSuggestion(list, id, selected.name, requestedState?.id || "state-default"))}"></div><p class="hint">The selected state will show this image in the live Project Bible. Other states and candidates are unchanged.</p><div class="form-field entity-approval-continuation"><label>Continue to another version after approval</label><select id="entity-approve-next" onchange="syncEntityApprovalContinuation()"></select><small id="entity-approve-next-note">Approve only, or continue directly into another continuity-state editor.</small></div></div></div><div class="modal-actions entity-approval-actions"><button class="changes-btn" onclick="closeModal();requestEntityChanges('${list}','${id}')">Request changes</button><div><button class="cancel" onclick="closeModal()">Cancel</button><button class="ghost-btn" onclick="confirmEntityApproval(false)">APPROVE ONLY</button><button id="entity-approve-continue" class="approve-btn large" onclick="confirmEntityApproval(true)">APPROVE & EDIT NEXT STATE</button></div></div></div>`,
  );
  syncEntityApprovalModal();
};
window.syncEntityApprovalModal = () => {
  const current = window._entityApproval || {};
  const x = P[current.list]?.find((item) => item.id === current.id);
  if (!x) return;
  const fileName = document.getElementById("entity-approve-file")?.value || current.name || "";
  const stateId = document.getElementById("entity-approve-target")?.value || current.stateId || "state-default";
  const targetChanged = current.stateId && current.stateId !== stateId;
  const state = entityStateById(x, stateId);
  const media = entityMedia(current.list, x).find((item) => item.name === fileName);
  current.name = fileName;
  current.stateId = stateId;
  const preview = document.getElementById("entity-approval-preview");
  if (preview && media) preview.innerHTML = isVideo(media.name) ? `<video muted controls src="${attr(media.url)}"></video>` : `<img src="${attr(media.url)}" alt="Candidate to approve">`;
  const caption = document.getElementById("entity-approval-file-caption");
  if (caption) caption.textContent = fileName;
  const summary = document.getElementById("entity-approval-target-summary");
  if (summary) summary.innerHTML = `<span>APPROVAL TARGET</span><b>${esc(state?.name || "Default")}</b><small>${esc(state?.appliesTo || (state?.isDefault ? "Primary project-wide state" : "No scene/shot range assigned"))}</small>`;
  const nameInput = document.getElementById("entity-approve-name");
  const alreadyApproved = entityApprovalBadges(x, fileName).length > 0;
  if (nameInput) nameInput.value = alreadyApproved ? fileName : entityCanonicalSuggestion(current.list, current.id, fileName, stateId);
  const nextSelect = document.getElementById("entity-approve-next");
  if (nextSelect) {
    const previous = targetChanged ? "" : nextSelect.value;
    /* Ancestors are absent from this list by construction, so the ring that
       offered an already-approved parent after the final descendant cannot form. */
    const nextStates = entityApprovalContinuationStates(x, stateId);
    nextSelect.innerHTML = `<option value="">Approve only — stay on this asset</option>${nextStates.map((item) => `<option value="${attr(item.id)}">Edit ${esc(item.name || "next state")}${item.approvedFile ? " · currently approved" : " · needs reference"}</option>`).join("")}`;
    const validPrevious = nextStates.some((item) => item.id === previous);
    nextSelect.value = validPrevious ? previous : entitySuggestedContinuationState(x, stateId);
  }
  syncEntityApprovalContinuation();
};
window.syncEntityApprovalContinuation = () => {
  const current = window._entityApproval || {};
  const x = P[current.list]?.find((item) => item.id === current.id);
  if (!x) return;
  const stateId = document.getElementById("entity-approve-target")?.value || current.stateId || "state-default";
  const state = entityStateById(x, stateId);
  const nextStateId = document.getElementById("entity-approve-next")?.value || "";
  const states = entityStateListRead(x, true);
  /* A stale form value cannot move the creator onto an ancestor: the id is
     re-checked against the lineage rule rather than trusted because it is in the
     select. */
  const nextState = nextStateId && isValidContinuation(states, stateId, nextStateId) ? entityStateById(x, nextStateId) : null;
  const outcome = entityApprovalContinuationOutcome(x, stateId);
  const continueButton = document.getElementById("entity-approve-continue");
  if (continueButton) {
    continueButton.disabled = !nextState;
    continueButton.textContent = nextState ? `APPROVE & EDIT ${String(nextState.name || "NEXT STATE").toUpperCase()}` : "APPROVE & EDIT NEXT STATE";
  }
  const nextNote = document.getElementById("entity-approve-next-note");
  if (!nextNote) return;
  if (nextState) {
    /* THE DERIVATION DIRECTION IS READ FROM THE GRAPH. The old copy asserted that
       whatever was selected derived from what was just approved, which was
       exactly backwards when the ring offered an ancestor. */
    const derivation = continuationDerivation(states, stateId, nextState.id);
    nextNote.textContent = derivation.derivesFromCurrent
      ? `${nextState.name || "The selected state"} derives from the newly approved ${state?.name || "current"} reference. Its state-delta editor opens immediately.`
      : derivation.parentName
        ? `${nextState.name || "The selected state"} derives from ${derivation.parentName}, not from ${state?.name || "this state"}. Its state-delta editor opens immediately and its lineage is unchanged.`
        : `${nextState.name || "The selected state"} has no declared parent. Its state-delta editor opens immediately.`;
    return;
  }
  /* A FINISHED CHAIN SAYS SO. It used to wrap back to the root instead. */
  nextNote.textContent = outcome.kind === "complete"
    ? outcome.reason === "no-further-states"
      ? "This is the only continuity state on this reference. Approving completes it."
      : "Every remaining continuity state on this reference already has an image. Approving completes the chain."
    : "Approve this reference and remain on the asset page.";
};
window.confirmEntityApproval = async (continueToNext = false) => {
  const { list, id } = window._entityApproval || {};
  if (!list) return;
  const x = P[list].find((e) => e.id === id),
    name = document.getElementById("entity-approve-file")?.value || window._entityApproval.name || "",
    targetStateId = document.getElementById("entity-approve-target")?.value || "state-default",
    targetState = entityStateById(x, targetStateId),
    requestedNextStateId = continueToNext ? document.getElementById("entity-approve-next")?.value || "" : "",
    /* Re-validated at the writer. `isValidContinuation` excludes the current
       state and every ancestor of it, so an id that survived a stale render
       cannot open an editor the lineage rule forbids. */
    nextStateId = requestedNextStateId && isValidContinuation(entityStateListRead(x, true), targetStateId, requestedNextStateId) ? requestedNextStateId : "",
    nextState = nextStateId ? entityStateById(x, nextStateId) : null,
    to = document.getElementById("entity-approve-name")?.value.trim();
  const originalApprovalRow = entityCandidateRow(x, name, false);
  const approvedIsCoverageSheet = typeof entityCandidateIsCoverageSheet === "function" && entityCandidateIsCoverageSheet(x, name);
  if (continueToNext && !nextState && !approvedIsCoverageSheet) {
    return toast(requestedNextStateId
      ? "That state cannot follow this one — it is what this state derives from. Choose a state further down the chain."
      : "Choose the continuity state to edit next");
  }
  /* CANON FIRST, INSIDE THE CLICK, ON THE BYTES THE CREATOR IS LOOKING AT.
     The shot-side twin carries the full argument; the shape is identical here.
     The same command still applies the ownership veto, so a file whose owner is
     unresolved or contested cannot be made canon from this screen. A refusal
     writes nothing and says why. */
  const displayedAssetId = (entityMedia(list, x).find((item) => item.name === name) || {}).assetId || "";
  const entityAuthorityStateId = targetState?.id || targetStateId || "state-default";
  try {
    approveEntityStateCanon(P, {
      list, entityId: id, stateId: entityAuthorityStateId, value: name, assetId: displayedAssetId,
      at: new Date().toISOString(), via: "entity-approval-modal",
    });
  } catch (error) {
    return toast(error.message || "That file cannot be approved for this reference");
  }
  let finalName = name, renamedAssetId = "";
  if (to && name && to !== name) {
    const r = await fetch("/api/media/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug: ACTIVE_PROJECT_SLUG, dir: ENTITY_MEDIA[list], from: name, to }),
    });
    const d = await r.json();
    if (r.ok) {
      finalName = d.name;
      renamedAssetId = d.assetId || "";
      /* P4-SEM-C2. This used to be four hand-written patches — states,
         entity.approvedFile, the candidate row, generatedCandidates[] — and the
         list was incomplete: coverageSlots[] and expressionSlots[] were never
         repaired, so renaming a file a coverage slot already held left that slot
         pointing at a filename that no longer existed. Enumerating the edges is
         what makes that class of miss impossible. */
      repairApprovalIdentity(x, { from: name, to: finalName, assetId: renamedAssetId, states: entityStateListRead(x, true) });
      /* And the receipt follows the bytes, for the reason given at the shot-side
         twin: otherwise the next read revokes a decision a person really made. */
      /* Scoped to the entity state this click approved. See the shot-side twin. */
      repairCanonValue(P, {
        kind: "entity-state", list, entityId: id, stateId: entityAuthorityStateId,
        from: name, to: finalName, assetId: renamedAssetId || displayedAssetId,
      });
      SCAN = await (await fetch("/api/scan")).json();
    } else toast("Rename failed; approved with original filename");
  }
  const approvedAssetId = (entityMedia(list, x).find((item) => item.name === finalName) || {}).assetId || renamedAssetId || displayedAssetId;
  if (targetState?.isDefault || targetStateId === "state-default") {
    for (const childState of ensureEntityStateList(x, true)) if (!childState.isDefault) childState.parentValidation = null;
    if (!approvedIsCoverageSheet && typeof ensureCoverageSlots === "function" && list !== "characters") {
      const slots = ensureCoverageSlots(list, x);
      if (!slots.some((slot) => slotSelectedFile(slot))) {
        const preferredId = ({ props: "hero", vehicles: "front-three-quarter", locations: "establishing" })[list];
        const coverageSlot = slots.find((slot) => slot.id === preferredId) || slots[0];
        if (coverageSlot) {
          /* K-alpha: seeding a view from the approved primary SELECTS a
             supporting reference. It is not a second approval, and the record
             says so. Ownership is already settled — these are the entity's own
             approved bytes. */
          assignSlotReference(coverageSlot, { fileName: finalName, at: new Date().toISOString(), via: "seeded-from-primary-reference", by: "cinebraid" });
          stampApprovalIdentity(coverageSlot, approvedAssetId);
          coverageSlot.notes = coverageSlot.notes || "Automatically seeded from the first approved primary reference.";
        }
      }
    }
    if (list === "characters") {
      x.primaryAngleAssignment = {
        status: "unassigned",
        sourceFile: finalName,
        updatedAt: new Date().toISOString(),
        note: "Primary identity references are not silently assigned to an angle slot.",
      };
    }
  }
  const row = entityCandidateRow(x, finalName, false) || entityCandidateRow(x, name, false);
  const currentReview = typeof entityCandidateTargetReview === "function" ? entityCandidateTargetReview(x, finalName) : null;
  if (row) {
    if (row.decision === "rejected") row.decision = "unreviewed";
    row.decision = approvedIsCoverageSheet ? "approved-sheet-source" : "approved-reference";
    row.humanApproved = true;
    row.humanApprovedWithoutAI = !currentReview?.pass;
    row.reviewRequired = false;
    row.decidedAt = new Date().toISOString();
    row.approvalProvenance = { source: "human", aiReviewed: !!currentReview, aiPassed: !!currentReview?.pass, approvedAt: row.decidedAt };
  }
  if (nextState) {
    /* NAVIGATION MUTATES NO LINEAGE. NONE.

       This was `nextState.parentStateId = targetStateId` unconditionally — the
       write that closed the dogfood cycle. The first repair narrowed it to
       "establish a first parent only", and the acceptance audit correctly called
       that a different rule wearing the invariant's name: it offered an orphan
       state as a continuation and watched a navigation button declare its
       ancestry. There is no write here now, of any kind. Continuation candidates
       are descendants, so the state being opened already has its parentage, and
       establishing parentage is a separate, explicit act. */
    if (!nextState.generationMode || nextState.generationMode === "derive") nextState.generationMode = "derive";
  }
  x.workflowStatus = "APPROVED";
  x.status = "APPROVED";
  x.reviewStatus = "";
  x.approvedAt = new Date().toISOString();
  dirty();
  closeModal();
  await route();
  /* This approval may be exactly what an automation run is parked on. See
     v670ReconcileAfterApproval — the gate leaves every activity surface now,
     not at the next poll. */
  if (typeof v670ReconcileAfterApproval === "function") v670ReconcileAfterApproval();
  if (targetState && !targetState.isDefault && targetState.approvedFile && String(targetState.notes || "").trim()) {
    const capability = typeof capabilityState === "function" ? capabilityState("vision") : { ready: false };
    if (capability.ready) setTimeout(() => validateContinuityStateAgainstParent(list, id, targetState.id), 220);
  }
  if (approvedIsCoverageSheet && typeof openCoverageSheetExtractor === "function") {
    rememberWorkspaceSection?.(entityCoverageSectionKey?.(list, id, originalApprovalRow?.coverageSheetType === "expressions" ? "expressions" : "angles"), true);
    setTimeout(() => openCoverageSheetExtractor(list, id, finalName), 50);
  } else if (nextState) revealEntityContinuityState(nextState.id);
  stampCeremony(`APPROVED · ${targetState?.name || "DEFAULT"}`);
  toast(approvedIsCoverageSheet
    ? `Approved ${finalName} as a sheet source — extract its individual views next`
    : nextState
      ? `Approved ${finalName} for ${targetState?.name || "Default"} — editing ${nextState.name || "next state"}`
      : `Approved ${finalName} for ${targetState?.name || "Default"}`);
};
window.approveEntity = (list, id) => {
  const x = P[list].find((e) => e.id === id),
    media = entityMedia(list, x);
  if (media.length)
    return approveEntityFile(
      list,
      id,
      (media.find((m) => m.name === x.approvedFile) || media[media.length - 1])
        .name,
    );
  x.workflowStatus = "APPROVED";
  x.status = "APPROVED";
  x.approvedAt = new Date().toISOString();
  dirty();
  route();
};
