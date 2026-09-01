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
  /* R1 — A CHOOSER WITH NOTHING TO CHOOSE IS NOT A CHOICE.
   *
   * `P.meta.models` is the project's own model list, and in the common case it is
   * empty — so this rendered a dropdown whose only option was "— not recorded —".
   * A control offering one non-answer asks the filmmaker to make a decision that
   * does not exist, and it costs a field of vertical space to do it.
   *
   * The CAPABILITY is untouched: `doIntake()` still reads `#in-model` and still
   * writes the `made` provenance record when a model is chosen. What changed is
   * that the chooser only appears once there is something to choose. doIntake()
   * already reads the element with `?.value || ""`, so the absent field is the
   * same "not recorded" answer the single option was standing for. */
  const provenanceModels = P.meta.models || [];
  openModal(`<h3>Upload candidates — ${files.length} file(s)</h3><div class="modal-sub">${targetState ? `TARGET · ${esc(targetState.name || "CONTINUITY STATE")} · ` : ""}ORIGINAL FILENAMES ARE RETAINED IN METADATA · PRODUCTION NAMES ARE ASSIGNED ONLY ON APPROVAL</div>
    <div class="approval-preview"><b>${esc(it.name || it.id)}</b><span>${esc(files.map((f) => f.name).join(", ")).slice(0, 180)}</span></div>
    <div class="form-field"><label>What are these files?</label><select id="in-structure" class="status-select" onchange="syncIntakeStructure()"><option value="">— choose —</option><option value="single-reference">Single reference image</option><option value="sheet">Coverage / multi-view sheet</option></select><small class="hint" id="in-structure-note">CineBraid cannot tell one reference from a multi-view sheet by looking at the file, and it will not guess. Only a single reference can become this asset&rsquo;s identity; a sheet is a source you extract views from.</small></div>
    ${provenanceModels.length ? `<div class="form-field"><label>Made with (optional provenance)</label><select id="in-model" class="status-select"><option value="">— not recorded —</option>${provenanceModels.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select></div>` : ""}
    <div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="submit-btn" id="in-submit" disabled onclick="doIntake()">UPLOAD CANDIDATES</button></div>`);
  syncIntakeStructure();
}
/* THE ONE THING THE APPLICATION CANNOT SEE, ASKED ONCE, AT THE ONLY MOMENT A
 * PERSON IS HOLDING THE ANSWER.
 *
 * doIntake() persisted `{stored, original}` and nothing else, so an ordinary
 * reference and a four-panel turnaround arrived structurally identical. The
 * classifier called both `undeclared` and the authority boundary let both become
 * an identity, which is fail-OPEN: no evidence is not evidence of eligibility.
 *
 * WHY IT IS ASKED RATHER THAN INFERRED. There is no honest signal in the file.
 * A filename cannot say it — that heuristic is deleted and the reasons are in
 * public/shared-coverage.js. Dimensions and aspect ratio cannot say it either; a
 * 16:9 image is as likely to be an establishing shot as a two-panel board, and
 * guessing from pixels is the same mistake wearing better clothes.
 *
 * WHY IT IS ASKED EVEN WHEN A CONTINUITY STATE IS THE TARGET. A pending state
 * upload records `targetStateId`, which is a fact about WHERE the image is
 * going, not about WHAT it is — a filmmaker can drop a turnaround onto a state
 * slot, and that is precisely the gesture that produced the original defect. The
 * import MAPPER is different and is not asked twice: it writes
 * `importedMapping.kind`, which is a claim the person made about one image and
 * one single-view target, and shared-coverage.js reads it.
 *
 * The answer is written as `coverageJobType`, the field the shared classifier
 * already keys on, so nothing new has to be taught to read it. */
const INTAKE_STRUCTURES = ["single-reference", "sheet"];
window.syncIntakeStructure = () => {
  const chosen = document.getElementById("in-structure")?.value || "";
  const submit = document.getElementById("in-submit");
  if (submit) submit.disabled = !chosen;
  const note = document.getElementById("in-structure-note");
  if (note && chosen) {
    note.textContent = chosen === "sheet"
      ? "Saved as a coverage sheet: a source for extraction. It will not be offered as this asset's identity reference."
      : "Saved as a single reference image, which can be approved as this asset's identity.";
  }
};
window.doIntake = async () => {
  const { list, id, files, targetStateId = "", targetStateName = "" } = window._intake,
    model = document.getElementById("in-model")?.value || "",
    /* Re-read at the writer, not carried from the click, and refused rather than
       defaulted: a silent default would be the guess this whole seam exists to
       avoid. */
    structure = document.getElementById("in-structure")?.value || "",
    it = P[list].find((x) => x.id === id),
    type = ENTITY_MEDIA[list];
  /* The button is disabled without a choice; this is the writer saying the same
     thing, so a replayed or scripted call cannot land undeclared rows either. */
  if (!INTAKE_STRUCTURES.includes(structure)) return toast("Say whether these files are a single reference or a coverage sheet");
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
      original.push({ stored: d.name, original: f.name, coverageJobType: structure, ...(targetStateId ? { targetStateId, targetStateName } : {}) });
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
    `<h3>Approve version — ${esc(id)}</h3><div class="modal-sub">ASSIGN THIS ${video ? "VIDEO" : "IMAGE"} TO ITS EXACT PLACE IN THE SHOT PLAN</div><div class="approval-preview"><b>${esc(name)}</b><span>${video ? "Motion output" : "Approved keyframe"}</span></div>${targets.length ? `<div class="form-field"><label>Approve as</label><select id="approve-target" class="status-select" onchange="updateApprovalName()">${targets.map((o) => `<option value="${o.v}" ${o.v === target ? "selected" : ""}>${esc(o.l)}</option>`).join("")}<option value="shot">Primary shot output</option></select></div>` : `<input type="hidden" id="approve-target" value="shot">`}<input type="hidden" id="approve-name" value="${attr(canonicalSuggestion(id, name, target))}"><div class="approval-note">${s.submissionNote ? `Submitter note: ${esc(s.submissionNote)}` : "No submission note."}</div><div class="modal-actions"><button class="changes-btn" onclick="closeModal();requestShotChanges('${id}')">Request changes</button><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="confirmApproveTake()">APPROVE VERSION</button></div>`,
  );
};
/* THE CARRIED NAME FOLLOWS THE TARGET. This modal is the one that lets the filmmaker
   retarget the approval, and the canonical name depends on which target it is, so the
   hidden value is recomputed when they change it. It updates a value the dialog holds
   on the filmmaker's behalf; there is nothing here for them to read or type. */
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
    /* THE FILENAME IS BOOKKEEPING, AND CINEBRAID DOES IT.

       This still reads the value the dialog carries. What changed is that the dialog
       no longer ASKS for it. All three approval modals used to put a visible,
       editable text field here -- captioned "Canonical filename" and nothing else on
       two of the three -- between the image and the APPROVE button, in a dialog whose
       only real question is whether these are the right bytes. A storage decision
       presented as a decision is still a decision.

       The convention is not lost, and it was never per-approval. It is
       CONFIG.naming.filenameTemplate -- a project setting with its own live preview in
       Settings -- and canonicalSuggestion() is the shipped reader of it. A studio
       naming requirement belongs there, where it applies to every approval, rather
       than in a field somebody has to retype correctly each time.

       NOTHING ABOUT STORAGE CHANGED, and that is deliberate. The value is the one
       every filmmaker who left the field alone was already sending; the rename call
       below, its failure toast, the receipt repair that follows the bytes, and the
       order of all three are byte-for-byte as they were. This slice removed a
       question, not a mechanism. */
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
      /* A TARGET THAT NO LONGER EXISTS IS A REFUSAL, NOT A SKIPPED LINE.
       *
       * These two branches wrote canon under `if (f)` / `if (c)` and then fell
       * through to the whole success path regardless. When the slot had gone —
       * the dialog names a target and the frame list can change under it, which
       * is what Remove Frame does — NOTHING was approved and the product said
       * "Required outputs approved and added to the live Bible", stamped
       * FRAME APPROVED, set the shot to APPROVED/LOCKED and recorded
       * `approvedTarget` on the candidate row. A durable claim of an approval
       * with no receipt behind it: the one thing the receipt model exists to
       * make impossible, reintroduced by an if with no else.
       *
       * Throwing hands it to the catch below, which is already the shipped
       * refusal for "the kernel would not take this" — so an unwritable target
       * and a refused write now fail the same way, before the rename, the row
       * write and the ceremony. */
      if (!f) throw new Error("That frame is no longer part of this shot, so nothing was approved");
      canonTarget = { kind: "shot-frame", shotId: id, frameId: f.id };
      approveFrameCanon(P, { shotId: id, frameId: f.id, value: name, assetId: displayedAssetId, at, via: "shot-take-approval" });
      label = "FRAME APPROVED";
    } else if (target.startsWith("segment:")) {
      const unitId = target.slice(8);
      const c = (s.clips || []).find((x) => unitKey(x) === unitId);
      if (!c) throw new Error("That motion unit is no longer part of this shot, so nothing was approved");
      canonTarget = { kind: "shot-motion", shotId: id, unitKey: c.id || unitId };
      approveMotionCanon(P, { shotId: id, unitKey: c.id || unitId, value: name, assetId: displayedAssetId, at, via: "shot-take-approval" });
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
  /* AN EXPLICIT NAME IS HONOURED — including a sheet, because "use as sheet
     source" opens this same modal deliberately. The FALLBACKS are eligibility
     aware, which is what makes "choose replacement" on a bad primary useful:
     without this, the fallback is `requestedState.approvedFile`, which for the
     entity that needs correcting IS the sheet, so the modal opened offering the
     wrong image back as its own replacement. */
  /* ELIGIBILITY IS ASKED OF THE SHARED PREDICATE, NOT INFERRED FROM "NOT A SHEET".
     `!isCoverageSheet` is the retired fail-OPEN shape: it treats `undeclared` as
     eligible, so this pool would offer back a candidate the authority kernel then
     refuses with AUTHORITY_ARTIFACT_UNDECLARED — which is exactly the sequence the
     2026-09-01 dogfood recorded, an APPROVE FOR DEFAULT button followed by a
     refusal. artifactMayHoldPrimaryAuthority() is the same predicate the kernel
     applies, so the pre-write offer and the write now agree.
     THIS IS NOT THE AUTHORITY DECISION. The kernel remains the boundary; this only
     stops the UI proposing a fallback it knows would be refused, and the explicit
     `name` argument is still honoured below exactly as before — including a sheet,
     because "use as sheet source" opens this same modal deliberately. */
  const eligiblePool = media.filter((item) => (
    typeof referenceArtifactStructureOf === "function" && typeof artifactMayHoldPrimaryAuthority === "function"
      ? artifactMayHoldPrimaryAuthority(referenceArtifactStructureOf(x, item.name)) === true
      : !entityCandidateIsCoverageSheet(x, item.name)
  ));
  const pool = eligiblePool.length ? eligiblePool : media;
  const selected = media.find((item) => item.name === name)
    || pool.find((item) => item.name === requestedState?.approvedFile)
    || pool.find((item) => item.name === x.approvedFile)
    || pool[pool.length - 1];
  window._entityApproval = { list, id, name: selected.name, stateId: requestedState?.id || "state-default" };
  /* SINGLE-STATE APPROVAL — A CHOICE WITH ONE OPTION IS NOT A CHOICE.
   *
   * Most references have exactly one continuity state: Default. This modal asked
   * such a reference's approval to be routed through a dropdown containing only
   * "Default", and then offered "Continue to another version after approval" with
   * nothing to continue to, and a primary action reading APPROVE & EDIT NEXT
   * STATE that was permanently disabled beside a secondary reading APPROVE ONLY.
   * Four controls, one real act.
   *
   * When there is one legitimate state, it is now stated rather than chosen, the
   * continuation field is absent, and the single approval action is primary and
   * says APPROVE. When two or more genuinely exist, everything below is exactly
   * what it was — same select, same continuation list, same lineage rule, same
   * two actions.
   *
   * CANON AUTHORITY IS UNTOUCHED IN BOTH SHAPES. `confirmEntityApproval()` is the
   * only writer either way, it still reads the same three element ids, and the
   * hidden input carries the state id when the select is absent — so the command
   * it issues is byte-identical to the one the two-state form issues for the same
   * approval. Nothing here decides what may be approved; the boundary still does.
   * Request changes stays available in both shapes. */
  const singleState = states.length <= 1;
  const targetState = requestedState || states[0] || { id: "state-default", name: "Default" };
  const stateField = singleState
    ? `<div class="form-field entity-approval-single-state" data-single-state="1"><label>Approve for continuity state</label><input id="entity-approve-target" type="hidden" value="${attr(targetState.id)}"><div class="entity-approval-single-state-readout"><b>${esc(targetState.name || "Default")}</b><small>${esc(targetState.appliesTo || (targetState.isDefault === false ? "No scene/shot range assigned" : "This reference has one continuity state."))}</small></div></div>`
    : `<div class="form-field"><label>Approve for continuity state</label><select id="entity-approve-target" onchange="syncEntityApprovalModal()">${states.map((st) => `<option value="${attr(st.id)}" ${String(requestedState?.id || "state-default") === String(st.id) ? "selected" : ""}>${esc(st.name || "Default")}${st.appliesTo ? ` · ${esc(st.appliesTo)}` : ""}</option>`).join("")}</select></div>`;
  const continuationField = singleState
    ? ""
    : `<div class="form-field entity-approval-continuation"><label>Continue to another version after approval</label><select id="entity-approve-next" onchange="syncEntityApprovalContinuation()"></select><small id="entity-approve-next-note">Approve only, or continue directly into another continuity-state editor.</small></div>`;
  const approvalActions = singleState
    ? `<button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="confirmEntityApproval(false)">APPROVE</button>`
    : `<button class="cancel" onclick="closeModal()">Cancel</button><button class="ghost-btn" onclick="confirmEntityApproval(false)">APPROVE ONLY</button><button id="entity-approve-continue" class="approve-btn large" onclick="confirmEntityApproval(true)">APPROVE & EDIT NEXT STATE</button>`;
  openModal(
    `<div class="entity-approval-modal"><h3>Approve reference — ${esc(x.name || id)}</h3><div class="modal-sub">ASSIGN ONE CANDIDATE TO ONE CONTINUITY STATE</div><div class="entity-approval-modal-layout"><figure><div id="entity-approval-preview">${isVideo(selected.name) ? `<video muted controls src="${attr(selected.url)}"></video>` : `<img src="${attr(selected.url)}" alt="Candidate to approve">`}</div><figcaption id="entity-approval-file-caption">${esc(selected.name)}</figcaption></figure><div class="entity-approval-fields"><div class="form-field"><label>Candidate file</label><select id="entity-approve-file" onchange="syncEntityApprovalModal()">${media.map((item) => `<option value="${attr(item.name)}" ${item.name === selected.name ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></div>${stateField}<div class="entity-approval-target-summary" id="entity-approval-target-summary"></div><input type="hidden" id="entity-approve-name" value="${attr(entityCanonicalSuggestion(list, id, selected.name, requestedState?.id || "state-default"))}"><p class="hint">The selected state will show this image in the live Project Bible. Other states and candidates are unchanged.</p>${continuationField}</div></div><div class="modal-actions entity-approval-actions"><button class="changes-btn" onclick="closeModal();requestEntityChanges('${list}','${id}')">Request changes</button><div>${approvalActions}</div></div></div>`,
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
  /* The carried name follows the candidate and the state, and it carries one real
     rule with it: a candidate ALREADY approved somewhere on this reference keeps the
     name it has, because renaming it would move bytes another approved state points
     at. That rule lives here rather than in a field nobody should be reading. */
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
    /* Carried, not asked -- the shot-side twin at confirmApproveTake() carries the
       argument, and the shape is identical here. */
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
  /* USE AS SHEET SOURCE IS NOT AN IDENTITY DECISION, AND NOW THE CODE AGREES
     WITH THE COPY.
     `approvedIsCoverageSheet` was computed eleven lines above and spent on a
     toast and a navigation branch, while this call ran unconditionally — so
     accepting a turnaround as an extraction source wrote the entity's primary
     pointer to a six-panel image and, a few lines below, filed the row as
     `decision: "approved-sheet-source"`. Both statements were recorded; only one
     of them was true.
     Accepting a sheet source records the decision on the row and opens the
     extractor. It moves NO primary pointer, so an entity that already has a real
     identity reference keeps it. The kernel refuses this target as well — see
     enforceTargetPolicy — and that refusal is the guarantee; this branch is what
     stops the filmmaker meeting an error message for an action the product
     deliberately offers. */
  if (!approvedIsCoverageSheet) {
    try {
      approveEntityStateCanon(P, {
        list, entityId: id, stateId: entityAuthorityStateId, value: name, assetId: displayedAssetId,
        at: new Date().toISOString(), via: "entity-approval-modal",
      });
    } catch (error) {
      return toast(error.message || "That file cannot be approved for this reference");
    }
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
  /* ...and neither is anything downstream of it. Accepting a sheet source moved
     no primary, so the child states' validations are still answers about the
     same parent image, and there is no new identity for an angle slot to be
     "unassigned" against. Both writes below used to run for a sheet. */
  if (!approvedIsCoverageSheet && (targetState?.isDefault || targetStateId === "state-default")) {
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
  /* ACCEPTING A SOURCE IS PROGRESS, NOT APPROVAL.
     This ran for a sheet too, and `entityWorkflowState()` reads exactly these
     fields — so "use as sheet source" on a reference with NO primary and NO
     receipt made it report APPROVED, which promptReferenceOptions() then
     published as `approved: true` with `defaultRole: "identity"`, and which the
     References stage read as ready. A status word became a second authority
     system by being believed.
     A sheet source moves the reference forward, so it is recorded as in
     progress; it does not claim the design was approved, because nothing was. */
  if (approvedIsCoverageSheet) {
    if (entityWorkflowState(x).key === "DRAFT") { x.workflowStatus = "IN PROGRESS"; x.status = "IN PROGRESS"; }
  } else {
    x.workflowStatus = "APPROVED";
    x.status = "APPROVED";
    x.reviewStatus = "";
    x.approvedAt = new Date().toISOString();
  }
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
