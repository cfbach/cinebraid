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
  openModal(`<h3>Upload candidates — ${files.length} file(s)</h3><div class="modal-sub">${targetState ? `TARGET · ${esc(targetState.name || "CONTINUITY STATE")} · ` : ""}ORIGINAL FILENAMES ARE RETAINED IN METADATA · FILES KEEP THE NAME THEY ARE IMPORTED UNDER</div>
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
  /* AN IMPORT IS NOT AN IMPORT UNTIL STORAGE HAS IT.

     What an approval is ABOUT lives in these rows: which file, what the filmmaker
     said it is, and which continuity state it was brought in for. All three were
     written to `P` and armed with dirty(), and dirty() only arms — so an import
     whose metadata save was refused still opened an approval modal, and the
     approval that followed named a candidate, a structure and a target that
     storage had never seen.

     So the write is settled here, deliberately, before anything downstream calls
     this import ready. Awaiting the flush is not the proof: queueProjectSave
     reports every refusal it can recover from by RESOLVING, so the flush is
     awaited FIRST and the verdict is asked SECOND, which is the discipline
     projectSaveSettled() was written for.

     A REFUSED IMPORT IS RETAINED, NOT DISCARDED. The rows stay in P and the files
     stay on disk; what is withheld is the claim that they are ready to approve.
     The approval modal asks the same question again through the durable baseline,
     so it opens showing the image and its target and simply does not enable
     confirmation. */
  dirty();
  await flushPendingProjectSave();
  const settled = typeof projectSaveSettled === "function" ? projectSaveSettled() : { settled: true };
  SCAN = await (await fetch("/api/scan")).json();
  window._pendingEntityStateUpload = null;
  /* SLICE 3: the candidate grid these files land in moved into `reference`.
     Writing the retired `review` id would still resolve through legacyMap, but it
     would leave a stale id in storage that every later read has to translate. */
  if (targetStateId) window.selectBoundedTask?.("entity-task", `${list}:${id}`, "reference");
  else route();
  if (!settled.settled) {
    return toast(`${saved.length} candidate file(s) are on disk but this import is not saved yet, so they cannot be approved. ${settled.reason}`);
  }
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
    /* C2 GLOBAL: authority source only - behaviour unchanged. */
    const visionReady = typeof visionCanReview === "function" && visionCanReview(capabilityState("vision"));
    if (inputs.length >= 2 && visionReady) setTimeout(() => reviewGuidedFrameSequence(id), 350);
  }
};

window.setWinner = (id, name) => approveTake(id, name);
/* `entityCanonicalSuggestion()` STOOD HERE, and it is gone rather than left
   unused. It generated the production filename an entity primary-reference
   approval renamed its candidate to, and Alpha does not rename: the approved
   image keeps the name it was imported under. Leaving the generator behind would
   leave the product looking as though it still assigns production names on
   approval when it does not — see the note in confirmEntityApproval() for why the
   rename went, and for the fact that production naming is a separate, deferred
   concern rather than an abandoned one. The shot-side twin, canonicalSuggestion(),
   is untouched: shot approvals still rename and this slice does not touch them. */
/* CONTINUATION IS A LINEAGE QUESTION, NOT A LIST POSITION.

   Dogfood #2 A6 / forensic F5. This used to rotate cyclically through the whole
   state list — `[...slice(index+1), ...slice(0,index)]` — so after the final
   descendant it wrapped round and offered an ancestor, and the copy beside it
   said the ancestor would derive from the state just approved. Accepting that
   offer then reparented the ancestor beneath its own descendant.

   public/shared-state-lineage.js owns the rule; these two functions are its call
   sites and hold no opinion of their own. */
/* C7 — A STATE THAT IS ALREADY CANON IS NOT REMAINING WORK.
 *
 * `continuationCandidates` answers a LINEAGE question — which states descend from
 * this one — and deliberately knows nothing about receipts; its own note says
 * `hasImage` is "not is approved". Offering its raw output as continuation targets
 * therefore kept approved descendants in the list, so a chain whose remaining
 * states were all approved still rendered a continuation selector and a second
 * APPROVE & EDIT NEXT STATE, while `continuationOutcome` was simultaneously
 * reporting `complete`. The selector and the outcome disagreed.
 *
 * Approval is a RECEIPT question, so it is asked of `entityStateTruth`, the
 * projection every other authority reader on this surface uses — never of
 * `approvedFile`, which is a pointer a state can hold with nothing behind it. Only
 * `canon` is excluded: a historic pointer and a state with no image are both still
 * work someone has to finish, and both remain offerable.
 *
 * The lineage rule itself is untouched. Ancestors are still absent by construction,
 * cycles are still impossible, and nothing here can add a target the lineage module
 * did not already allow — this only removes ones that are finished. Where the truth
 * projection cannot be computed, nothing is removed, because withdrawing a valid
 * continuation on a missing reader is the worse failure. */
function entityApprovalContinuationStates(entity, currentStateId, list = "") {
  const states = entityStateListRead(entity, true);
  const byId = new Map(states.map((state) => [state.id, state]));
  const rows = continuationCandidates(states, currentStateId)
    .map((candidate) => byId.get(candidate.id))
    .filter(Boolean);
  const collection = String(list || "") || (typeof entityListOf === "function" ? entityListOf(entity) : "");
  const truth = collection && typeof entityStateTruth === "function" ? entityStateTruth(collection, entity) : null;
  if (!truth || truth.available === false) return rows;
  return rows.filter((state) => truth.of(state).standing !== "canon");
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
/* TWO OPERATIONS, ONE FUNCTION, AND THE MODE SAYS WHICH.

   `primary-authority` assigns one single reference as an entity state's identity.
   `sheet-source` accepts a multi-view sheet as material to extract from. It
   writes no identity, and confirmEntityApproval() has always skipped the canon
   call for it.

   THE MODE IS PASSED IN, NOT INFERRED FROM THE FILE. Deciding "this file
   classifies as a sheet, therefore the filmmaker must have meant sheet source"
   turns an eligibility FAILURE into an operation, which is how an undeclared
   candidate would eventually find its way into a workflow nobody chose. The
   caller already knows: the card renders USE AS SHEET SOURCE and sets
   `continuation = "extract"` (public/entities.js), and that intent now travels
   the last hop instead of being dropped here. */
/* ==========================================================================
   ALPHA — A PREPARED MEDIA IDENTITY, BOUND TO THE IMAGE ON SCREEN.

   THE DEFECT. `/api/scan` composes its answer and only then schedules the pass
   that gives a file its durable identity, so a candidate imported seconds ago is
   routinely listed with no `assetId` at all. The approval modal read that listing
   and handed the kernel an empty identity, and every later reader that has to
   prove "these are the same bytes" had nothing to prove it with. Waiting for
   another scan is timing, not a contract, and timing is what failed.

   WHAT REPLACES IT. Before the confirm button is enabled, CineBraid asks the
   server a positive question about ONE file — the exact one displayed — and gets
   a typed answer back: ready, pending, or unavailable. Ready carries the stable
   assetId the ledger already holds, or the one a bounded stat-only pass just
   established for it. Nothing is hashed, nothing else in the project is touched,
   and a candidate that was already indexed keeps the identity it already had.

   WHAT READINESS IS BOUND TO, because a readiness that outlives what it described
   is worse than none: the project and the open it belongs to, the exact candidate
   filename, the exact continuity state, the durable declaration that says this
   file is a single reference, the durable ownership claim that says this entity
   owns it, this window's save generation, and the identity the live scan reports
   for that filename. Any of those moving withdraws the button.

   IT GRANTS NOTHING. This decides what may be OFFERED. The kernel remains the
   only thing that can approve anything and still refuses independently. */
let ENTITY_APPROVAL_READINESS = null;
let ENTITY_APPROVAL_PREPARE_TOKEN = 0;
/* The question currently being asked of the server, by key — not a boolean. A
   selection can change while a request is in flight, and "a request is out" is
   not the same statement as "a request is out about THIS". */
let ENTITY_APPROVAL_PREPARING = "";

/* The facts that identify what the modal is currently asking about. */
function entityApprovalWant() {
  const current = window._entityApproval || {};
  return {
    list: String(current.list || ""),
    id: String(current.id || ""),
    stateId: String(document.getElementById("entity-approve-target")?.value || current.stateId || "state-default"),
    name: String(document.getElementById("entity-approve-file")?.value || current.name || ""),
    mode: current.mode === "sheet-source" ? "sheet-source" : "primary-authority",
  };
}

/* IS THE THING BEING APPROVED DURABLE YET.

   An approval is a statement about a candidate, a declared structure and a
   target state. If any of those three is still only in this tab, the approval
   would name something storage has never seen — which is exactly what happened
   when an import's metadata save failed and the modal opened anyway. So the
   question is asked of the DURABLE BASELINE, not of the draft in front of us. */
function durableApprovalContext(want) {
  const baseline = typeof durableProjectBaseline === "function" ? durableProjectBaseline() : null;
  if (!baseline) {
    return { ok: false, reason: "no-baseline", message: "This window has not confirmed what is stored for this project yet." };
  }
  const entity = (Array.isArray(baseline[want.list]) ? baseline[want.list] : []).find((row) => row && row.id === want.id);
  if (!entity) {
    return { ok: false, reason: "entity-not-durable", message: "This reference has not been saved yet, so nothing can be approved for it." };
  }
  /* `state-default` is legal with no stored states at all — the kernel treats the
     entity itself as that target — so its absence is not a refusal. Any other
     state must actually exist in the stored document. */
  if (want.stateId !== "state-default" && !entityStateById(entity, want.stateId)) {
    return { ok: false, reason: "state-not-durable", message: "This continuity state has not been saved yet, so it cannot be an approval target." };
  }
  const structure = typeof referenceArtifactStructureOf === "function"
    ? String(referenceArtifactStructureOf(entity, want.name) || "") : "";
  const mayHold = typeof artifactMayHoldPrimaryAuthority === "function" && artifactMayHoldPrimaryAuthority(structure) === true;
  if (!mayHold) {
    return {
      ok: false,
      reason: "structure-not-durable",
      message: structure === "sheet"
        ? "This file is recorded as a coverage sheet, so it cannot become this reference's identity."
        : "What this file is has not been saved yet, so it cannot become this reference's identity.",
    };
  }
  const owned = typeof buildEntityOwnerIndex === "function" && typeof entityOwnsMedia === "function"
    ? entityOwnsMedia(buildEntityOwnerIndex(baseline, want.list), want.id, want.name) : false;
  if (!owned) {
    return { ok: false, reason: "ownership-not-durable", message: "This file is not durably recorded as belonging to this reference." };
  }
  return { ok: true, reason: "", message: "" };
}

/* Synchronous, and it must stay that way: the trusted click asks this and then
   commits Canon with no yield in between, which is what makes the answer still
   true at the moment it is acted on. Returns the reason it is NOT ready, or null. */
function entityApprovalReadinessRefusal(readiness, want) {
  if (!readiness) return { code: "not-prepared", message: "Preparing this image for approval…" };
  if (readiness.status !== "ready") {
    return { code: readiness.status, message: readiness.message || "This image is not ready to approve yet." };
  }
  if (readiness.slug !== ACTIVE_PROJECT_SLUG) {
    return { code: "project-changed", message: "The open project changed, so this image has to be prepared again." };
  }
  if (readiness.epoch !== PROJECT_OPEN_EPOCH) {
    return { code: "project-reopened", message: "This project was reopened, so this image has to be prepared again." };
  }
  if (readiness.list !== want.list || readiness.entityId !== want.id) {
    return { code: "entity-changed", message: "The reference changed, so this image has to be prepared again." };
  }
  if (readiness.stateId !== want.stateId) {
    return { code: "target-changed", message: "The approval target changed, so this image has to be prepared again." };
  }
  if (readiness.fileName !== want.name) {
    return { code: "candidate-changed", message: "The selected candidate changed, so this image has to be prepared again." };
  }
  if (readiness.saveGeneration !== PROJECT_SAVE_GENERATION) {
    return { code: "project-advanced", message: "This project was saved again, so this image has to be prepared again." };
  }
  const settled = typeof projectSaveSettled === "function" ? projectSaveSettled() : { settled: true };
  if (!settled.settled) {
    return { code: settled.code || "not-settled", message: settled.reason || "This project has changes that are not saved yet." };
  }
  const durable = durableApprovalContext(want);
  if (!durable.ok) return { code: durable.reason, message: durable.message };
  /* THE PREPARED IDENTITY, RE-ASKED OF THE LIVE LISTING. A background pass can
     retire a row, and a replaced file acquires a different one — either way the
     identity that was prepared is no longer the identity of what is on screen. */
  const entity = P[want.list]?.find((row) => row && row.id === want.id);
  const live = entity ? entityMedia(want.list, entity).find((row) => row.name === want.name) : null;
  if (!live) {
    return { code: "candidate-missing", message: "That candidate is no longer available on this reference." };
  }
  if (String(live.assetId || "") !== readiness.assetId) {
    return { code: "identity-stale", message: "This file's stored identity changed, so it has to be prepared again." };
  }
  return null;
}

/* THE EXACT QUESTION A READINESS RECORD IS THE ANSWER TO.

   Preparation re-runs the whole modal sync when it finishes, and the sync asks
   for preparation — so without this, an answer of "pending" or "unavailable"
   would ask the same question again forever. Holding the question alongside the
   answer means a settled answer is re-asked only when the question changes:
   another candidate, another state, another project, another accepted save. The
   filmmaker can also ask again deliberately, which is what the recheck below is
   for, and that is the only thing that re-asks an unchanged question. */
function entityApprovalReadinessKey(want) {
  return [ACTIVE_PROJECT_SLUG, PROJECT_OPEN_EPOCH, PROJECT_SAVE_GENERATION, want.list, want.id, want.stateId, want.name].join("|");
}
window.recheckEntityApprovalIdentity = () => {
  ENTITY_APPROVAL_READINESS = null;
  ENTITY_APPROVAL_PREPARING = "";
  renderEntityApprovalReadiness();
};

/* THE PREPARING/UNAVAILABLE LINE, AND THE BUTTON THAT FOLLOWS IT.

   Subtractive only. Everything that decides whether an approval is OFFERABLE at
   all — an eligible candidate, a valid continuation — has already run and set
   these buttons; this can withdraw them and never restore them, so a readiness
   answer can never re-enable a control eligibility withdrew. When readiness
   arrives, the whole sync runs again from the top instead. */
function renderEntityApprovalReadiness() {
  const line = document.getElementById("entity-approval-readiness");
  const confirmButton = document.getElementById("entity-approve-confirm");
  const continueButton = document.getElementById("entity-approve-continue");
  /* Asked on every ordinary edit now, so it answers in one lookup when there is
     no approval modal on screen rather than computing a verdict for nobody. */
  if (!line && !confirmButton && !continueButton) return;
  const want = entityApprovalWant();
  if (want.mode === "sheet-source") return;
  const refusal = entityApprovalReadinessRefusal(ENTITY_APPROVAL_READINESS, want);
  const ready = !refusal;
  const preparing = ENTITY_APPROVAL_PREPARING || !ENTITY_APPROVAL_READINESS || ENTITY_APPROVAL_READINESS.status === "pending";
  if (line) {
    line.dataset.state = ready ? "ready" : preparing ? "preparing" : "unavailable";
    const sentence = ready
      ? `Ready to approve · ${want.name}`
      : preparing ? "Preparing this image for approval…" : refusal.message;
    /* A settled "not ready" is re-asked only when the filmmaker asks, so the way
       to ask is on screen beside the reason rather than hidden in a reload. */
    line.innerHTML = esc(sentence) + (ready || preparing
      ? ""
      : ` <button type="button" class="ghost-btn entity-approval-recheck" onclick="recheckEntityApprovalIdentity()">TRY AGAIN</button>`);
  }
  if (confirmButton && !ready) confirmButton.disabled = true;
  if (continueButton && !ready) continueButton.disabled = true;
  /* AND IT ASKS FOR WHAT IT DOES NOT HAVE. Rendering and preparing were separate
     acts, so a readiness invalidated by something other than a selection change —
     an ordinary save landing under the open modal, which advances this window's
     save generation — left the modal saying "prepare this again" with nothing
     preparing it. The question is asked wherever the answer is found missing;
     the key below is what stops that becoming a loop. */
  if (!ready) prepareEntityApprovalIdentity();
}

/* One request, about one file, and only when the answer we hold is not already
   the answer to the question being asked. */
window.prepareEntityApprovalIdentity = async () => {
  const want = entityApprovalWant();
  if (want.mode === "sheet-source" || !want.list || !want.id || !want.name) return null;
  const key = entityApprovalReadinessKey(want);
  if (ENTITY_APPROVAL_READINESS && ENTITY_APPROVAL_READINESS.key === key) return ENTITY_APPROVAL_READINESS;
  /* A request is already out about this exact question. */
  if (ENTITY_APPROVAL_PREPARING === key) return null;
  const token = ++ENTITY_APPROVAL_PREPARE_TOKEN;
  ENTITY_APPROVAL_PREPARING = key;
  ENTITY_APPROVAL_READINESS = null;
  renderEntityApprovalReadiness();
  const slug = ACTIVE_PROJECT_SLUG;
  const epoch = PROJECT_OPEN_EPOCH;
  const saveGeneration = PROJECT_SAVE_GENERATION;
  let prepared = null;
  try {
    const response = await fetch("/api/media/prepare-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, dir: ENTITY_MEDIA[want.list], name: want.name }),
    });
    prepared = await response.json().catch(() => ({}));
    if (!response.ok) prepared = { status: "unavailable", reason: String(prepared?.error || "request-failed") };
  } catch (error) {
    prepared = { status: "pending", reason: String(error?.message || error) };
  }
  /* A later question has been asked; this answer is about something else, and
     the newer request owns the flag. */
  if (token !== ENTITY_APPROVAL_PREPARE_TOKEN) return null;
  ENTITY_APPROVAL_PREPARING = "";
  ENTITY_APPROVAL_READINESS = {
    status: prepared?.status === "ready" && prepared?.assetId ? "ready" : prepared?.status === "pending" ? "pending" : "unavailable",
    reason: String(prepared?.reason || ""),
    message: entityApprovalPreparationMessage(prepared),
    assetId: String(prepared?.assetId || ""),
    contentHash: String(prepared?.contentHash || ""),
    size: Number(prepared?.size || 0),
    mtimeMs: Number(prepared?.mtimeMs || 0),
    slug, epoch, saveGeneration, key,
    list: want.list, entityId: want.id, stateId: want.stateId, fileName: want.name,
  };
  /* AND THE LISTING IS RE-READ, BECAUSE PREPARING CHANGED WHAT IT SAYS.

     `/api/scan` composes its answer before the identity pass runs, so the SCAN
     this window is holding is exactly the one that reported no identity for a
     freshly imported file. Preparation has just established that identity; not
     re-reading would leave the modal comparing a prepared id against a listing
     that predates it and concluding, correctly but uselessly, that the two
     disagree. Re-read once, only for a READY answer, and only for this file's
     sake — after which "the scan disagrees" means what it should: something
     changed these bytes or retired their row. */
  if (ENTITY_APPROVAL_READINESS.status === "ready") {
    try {
      const refreshed = await (await fetch("/api/scan")).json();
      if (token !== ENTITY_APPROVAL_PREPARE_TOKEN) return null;
      SCAN = refreshed;
    } catch {
      /* A listing that could not be re-read leaves readiness to fail its own
         agreement check, which is the fail-closed direction. */
    }
  }
  /* Re-run the whole offer from the top, so an approval that is now ready gets
     its button back through the same rules that withdrew it. */
  syncEntityApprovalModal();
  return ENTITY_APPROVAL_READINESS;
};

/* The reason, in the filmmaker's terms rather than the ledger's. */
function entityApprovalPreparationMessage(prepared) {
  const reason = String(prepared?.reason || "");
  if (prepared?.status === "ready") return "";
  if (reason === "file-missing") return "CineBraid cannot find this file where it was imported, so it cannot be approved.";
  if (reason === "not-indexable") return "CineBraid cannot record a durable identity for this file, so it cannot be approved.";
  if (reason === "ledger-unreadable" || reason === "ledger-newer-than-build") {
    return "CineBraid cannot read this project's media record, so it cannot confirm which image this is.";
  }
  if (reason === "no-contained-project" || reason === "no-project-directory" || reason === "path-outside-project") {
    return "CineBraid cannot locate this file inside the open project.";
  }
  if (prepared?.status === "pending") return "Preparing this image for approval…";
  return "CineBraid could not prepare this image for approval.";
}

/* ==========================================================================
   ALPHA — THE PENDING APPROVAL SURFACE.

   One trusted decision, one submission, and the filmmaker looking at the exact
   image and target it was about until its outcome is known. Nothing here takes a
   decision: retry replays the receipt that was already created inside the click,
   and every path that cannot prove what happened asks storage first. */
function pendingApprovalAuthorityTarget(record) {
  return { kind: "entity-state", list: record.meta.list, entityId: record.meta.entityId, stateId: record.meta.stateId };
}

window.showPendingApprovalSurface = () => {
  const record = typeof approvalSubmissionPending === "function" ? approvalSubmissionPending() : null;
  if (!record) return;
  const meta = record.meta || {};
  const outcome = record.outcome || "saving";
  const preview = meta.url
    ? `<figure><div id="entity-approval-preview"><img src="${attr(meta.url)}" alt="The image this approval was taken on"></div><figcaption>${esc(meta.fileName || "")}</figcaption></figure>`
    : "";
  const target = `<div class="entity-approval-target-summary"><span>APPROVAL TARGET</span><b>${esc(meta.entityName || meta.entityId || "")} · ${esc(meta.stateName || "Default")}</b><small>${esc(meta.fileName || "")}</small></div>`;
  const headline = {
    saving: "Saving approval…",
    unknown: "Checking whether approval was saved…",
    changed: "This project changed while the approval was being saved",
    refused: "Your approval has not been saved",
    uncommitted: "Your approval has not been saved",
  }[outcome] || "Saving approval…";
  const explanation = {
    saving: "CineBraid is writing this approval. It is not approved until storage accepts it.",
    unknown: "CineBraid is asking storage what it actually holds for this reference. Nothing else is written until that is known.",
    changed: record.reason || "Nothing was written. Review the current state of this reference and approve again if it is still what you want.",
    refused: record.reason || "Nothing was written, and this reference is unchanged.",
    uncommitted: record.reason || "Nothing was written, and this reference is unchanged.",
  }[outcome] || "";
  /* THE ACTIONS FOLLOW WHAT IS KNOWN, AND A REFUSAL IS NOT OFFERED A RETRY.
     A fail-closed authority or validation refusal means this exact payload is
     invalid; resending it cannot help, so the only honest action is to look at
     what the project actually holds now and decide again. */
  const actions = outcome === "saving" || outcome === "unknown"
    ? `<button class="cancel" onclick="resolvePendingApprovalOutcome()">CHECK AGAIN</button>`
    : outcome === "uncommitted"
      ? `<button class="cancel" onclick="leavePendingApprovalUnapproved()">LEAVE UNAPPROVED</button><button class="approve-btn large" onclick="retryPendingApproval()">RETRY SAVING APPROVAL</button>`
      : `<button class="approve-btn large" onclick="reviewCurrentApprovalState()">REVIEW CURRENT STATE</button>`;
  /* THE NOTE SAYS WHAT THE BUTTON BESIDE IT ACTUALLY DOES. Both actions reopen
     the project as it is stored; only one of them is called "leave unapproved". */
  const note = outcome === "uncommitted" || outcome === "changed" || outcome === "refused"
    ? `<p class="hint">${outcome === "uncommitted" ? "Leaving this unapproved" : "Reviewing the current state"} reopens this project as it is stored. This candidate, what it is, and the state it was for were all saved before you approved it, so the image stays exactly where it is and you can review it again.</p>`
    : "";
  /* HELD, NOT MERELY SHOWN. This dialog is the only place the decision behind it
     can be resolved, so Escape, the backdrop and every generic close are refused
     until one of its own actions releases it — see the modal lock in app.js. */
  openModal(`<div class="entity-approval-modal entity-approval-pending" data-approval-outcome="${attr(outcome)}"><h3>${esc(headline)}</h3><div class="modal-sub">THIS REFERENCE IS APPROVED ONLY WHEN STORAGE HAS ACCEPTED IT</div><div class="entity-approval-modal-layout">${preview}<div class="entity-approval-fields">${target}<p>${esc(explanation)}</p>${note}</div></div><div class="modal-actions entity-approval-actions">${actions}</div></div>`,
    { lock: APPROVAL_RECOVERY_LOCK, lockMessage: approvalRecoveryMessage() });
};

/* ASK STORAGE WHAT IT ACTUALLY HOLDS, before retrying, before abandoning, and
   before any second submission is allowed. */
window.resolvePendingApprovalOutcome = async () => {
  const record = typeof approvalSubmissionPending === "function" ? approvalSubmissionPending() : null;
  if (!record) return;
  record.outcome = "unknown";
  showPendingApprovalSurface();
  let stored;
  try {
    stored = await readStoredProjectDocument(record.slug);
  } catch (error) {
    record.outcome = "unknown";
    record.reason = error.message || "CineBraid could not read the stored project.";
    return showPendingApprovalSurface();
  }
  const receipt = typeof currentHumanAuthority === "function"
    ? currentHumanAuthority(stored.project, pendingApprovalAuthorityTarget(record)) : null;
  const meta = record.meta || {};
  if (receipt && String(receipt.value || "") === meta.fileName && String(receipt.assetId || "") === String(meta.assetId || "")) {
    /* THE EXACT DECISION IS ALREADY DURABLE. A lost response is not a lost
       approval, and a second receipt for the same decision is the one thing a
       retry must never produce. */
    return completePendingApproval(record, stored);
  }
  if (receipt) {
    /* Committed once, and something else is current now. Historic stays historic. */
    record.outcome = "changed";
    record.reason = `${String(receipt.value || "Another image")} is currently approved for this state, so this approval was not applied.`;
    return showPendingApprovalSurface();
  }
  if (stored.revision && record.baselineRevision && stored.revision !== record.baselineRevision) {
    record.outcome = "changed";
    record.reason = "The stored project moved on while this approval was in flight, so it was not applied.";
    return showPendingApprovalSurface();
  }
  record.outcome = "uncommitted";
  record.reason = "Storage does not hold this approval, and the project is otherwise unchanged.";
  showPendingApprovalSurface();
};

/* THE SAME DECISION ARRIVING AGAIN, NOT A NEW ONE. It replays the captured
   successor and its receipt; the Canon command is not called a second time. */
window.retryPendingApproval = async () => {
  const record = typeof approvalSubmissionPending === "function" ? approvalSubmissionPending() : null;
  if (!record) return;
  if (record.outcome !== "uncommitted") return resolvePendingApprovalOutcome();
  record.outcome = "saving";
  showPendingApprovalSurface();
  const resolved = await dispatchApprovalSubmission(record);
  if (resolved.outcome === "committed") return completePendingApproval(record, null);
  if (resolved.outcome === "unknown") return resolvePendingApprovalOutcome();
  showPendingApprovalSurface();
};

/* The two ways a filmmaker walks away from a decision storage did not take. Both
   reopen the project as it is stored: the uncommitted receipt only ever existed
   in this tab, and the candidate, its declared structure and its intended target
   were all saved before the approval was offered, so the image stays exactly
   where it is and can be reviewed again. An approval that IS durable is never
   revoked here — a committed record has already left this surface. */
function abandonPendingApproval(message) {
  const record = typeof approvalSubmissionPending === "function" ? approvalSubmissionPending() : null;
  if (!record || record.outcome === "committed") return;
  endApprovalSubmission(record.id);
  toast(message);
  location.reload();
}
window.leavePendingApprovalUnapproved = () => abandonPendingApproval("Left unapproved — the image is still here for later");
window.reviewCurrentApprovalState = () => abandonPendingApproval("Reopening this project so you can review its current state");

const ENTITY_APPROVAL_MODES = ["primary-authority", "sheet-source"];
window.approveEntityFile = (list, id, name, stateId = "", mode = "primary-authority") => {
  const x = P[list].find((e) => e.id === id),
    states = entityStateListRead(x, true),
    media = entityMedia(list, x);
  const sheetSource = ENTITY_APPROVAL_MODES.includes(mode) && mode === "sheet-source";
  if (!media.length) return toast("Add or generate a candidate before approving a reference");
  const requestedState = entityStateById(x, stateId || "state-default") || states[0];
  /* AN EXPLICIT NAME IS HONOURED — including a sheet, because "use as sheet
     source" opens this same modal deliberately. The FALLBACKS are eligibility
     aware, which is what makes "choose replacement" on a bad primary useful:
     without this, the fallback is `requestedState.approvedFile`, which for the
     entity that needs correcting IS the sheet, so the modal opened offering the
     wrong image back as its own replacement. */
  /* THE OFFER FAILS CLOSED, AND IT ASKS THE PREDICATE THE KERNEL ASKS.
     Three legacy escape hatches used to survive here, and each one could put a
     candidate the kernel will refuse in front of a filmmaker as APPROVE:
       1. an empty eligible pool fell back to raw `media`;
       2. an explicit `name` was resolved against raw `media` before the pool;
       3. a missing classifier fell back to `!entityCandidateIsCoverageSheet`,
          the retired fail-OPEN shape that reads `undeclared` as eligible.
     All three are gone. THIS IS NOT THE AUTHORITY DECISION — the kernel remains
     the boundary and still refuses independently. This only stops the browser
     offering an action the shared predicate already knows cannot succeed. */
  const eligibleForPrimary = (fileName) => {
    /* NO LOCAL POLICY. If the shared classifier is not in this composition the
       answer is "cannot confirm", and cannot-confirm is not eligibility — the
       same discipline shared-authority-kernel.js applies when its resolver is
       missing. Re-deriving the rule here is how the two copies drifted before. */
    if (typeof referenceArtifactStructureOf !== "function") return false;
    if (typeof artifactMayHoldPrimaryAuthority !== "function") return false;
    return artifactMayHoldPrimaryAuthority(referenceArtifactStructureOf(x, fileName)) === true;
  };
  const eligiblePool = media.filter((item) => eligibleForPrimary(item.name));
  const namedMedia = name ? media.find((item) => item.name === name) : null;
  /* THE SHEET-SOURCE OPERATION CARRIES ITS OWN ENTRY CONDITION, and it is a
     POSITIVE one: the named file must be a DECLARED sheet. An undeclared file is
     not "close enough to a sheet" — it is a file nothing has classified, and
     handing it to an extractor would be the same guess this whole seam removes. */
  const namedStructure = namedMedia && typeof referenceArtifactStructureOf === "function"
    ? String(referenceArtifactStructureOf(x, namedMedia.name) || "") : "";
  if (sheetSource) {
    if (!namedMedia) return toast("Choose which sheet to use as a source");
    if (namedStructure !== "sheet") {
      return toast(`${namedMedia.name} is not recorded as a coverage sheet, so it cannot be used as one. Say which it is when you import it.`);
    }
  } else if (!eligiblePool.length) {
    return toast("None of these files is recorded as a single reference image, so none can become this reference's identity. Say which one is a single reference when you import it, or map it to a state or view first.");
  }
  const selected = sheetSource
    ? namedMedia
    : eligiblePool.find((item) => item.name === name)
      || eligiblePool.find((item) => item.name === requestedState?.approvedFile)
      || eligiblePool.find((item) => item.name === x.approvedFile)
      || eligiblePool[eligiblePool.length - 1];
  window._entityApproval = { list, id, name: selected.name, stateId: requestedState?.id || "state-default", mode: sheetSource ? "sheet-source" : "primary-authority" };
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
  /* W9 — THE CONTINUATION IS OFFERED WHEN ONE EXISTS, AND ONLY THEN.
   *
   * The dogfood approved Folding Chair · Default with a second state, "Unfolded
   * for game night", sitting unapproved in the same prop — and the modal still
   * rendered "Continue to another version after approval" containing nothing but
   * "Approve only — stay on this asset", beside a permanently disabled
   * APPROVE & EDIT NEXT STATE. Two controls describing a choice that did not
   * exist.
   *
   * The reason is real production truth and is NOT a bug in this modal:
   * `continuationCandidates` walks DESCENDANTS, and Unfolded records no
   * `parentStateId`, so it is not a descendant of Default and there was genuinely
   * nothing to continue into. The modal's fault was rendering the furniture of a
   * choice anyway. Record the lineage (W11) and the same code offers
   * "Edit Unfolded for game night" without another line changing here.
   *
   * So the shape is driven by the continuation list rather than by the state
   * count. `states.length <= 1` still decides whether the STATE TARGET is a
   * readout or a selector — W8 keeps that selector, and a two-state reference
   * must never be told it has one state — but the continuation field and the
   * second action now appear only where a valid target exists. */
  const continuationTargets = entityApprovalContinuationStates(x, targetState.id, list);
  const canContinue = continuationTargets.length > 0;
  const stateField = singleState
    ? `<div class="form-field entity-approval-single-state" data-single-state="1"><label>Approve for continuity state</label><input id="entity-approve-target" type="hidden" value="${attr(targetState.id)}"><div class="entity-approval-single-state-readout"><b>${esc(targetState.name || "Default")}</b><small>${esc(targetState.appliesTo || (targetState.isDefault === false ? "No scene/shot range assigned" : "This reference has one continuity state."))}</small></div></div>`
    : `<div class="form-field"><label>Approve for continuity state</label><select id="entity-approve-target" onchange="syncEntityApprovalModal()">${states.map((st) => `<option value="${attr(st.id)}" ${String(requestedState?.id || "state-default") === String(st.id) ? "selected" : ""}>${esc(st.name || "Default")}${st.appliesTo ? ` · ${esc(st.appliesTo)}` : ""}</option>`).join("")}</select></div>`;
  /* Present but withdrawn, rather than absent: the target selector above can move
     to a state that DOES have somewhere to continue to, and syncEntityApprovalModal
     re-asks on every change. Hiding is what makes that reversible; omitting the
     element would strand the modal in whichever shape it opened in. */
  const continuationField = singleState
    ? ""
    : `<div class="form-field entity-approval-continuation" id="entity-approve-continuation-field" ${canContinue ? "" : "hidden"}><label>Continue to another version after approval</label><select id="entity-approve-next" onchange="syncEntityApprovalContinuation()"></select><small id="entity-approve-next-note">Approve only, or continue directly into another continuity-state editor.</small></div>`;
  /* The confirm control carries an id so the refresh below can withdraw it when
     the selection stops being eligible under this modal's own feet. */
  /* One real act gets one primary button. APPROVE ONLY only earns its qualifier
     where there is something else it could have been. */
  /* BOTH CONFIRM CONTROLS OPEN DISABLED, and only a prepared identity for the
     candidate and target actually on screen re-enables them. A button that is
     live before CineBraid can say which bytes it would approve is the whole
     defect this slice removes, so the safe state is the initial one. */
  const approvalActions = singleState
    ? `<button class="cancel" onclick="closeModal()">Cancel</button><button id="entity-approve-confirm" class="approve-btn large" disabled onclick="confirmEntityApproval(false)">APPROVE</button>`
    : `<button class="cancel" onclick="closeModal()">Cancel</button><button id="entity-approve-confirm" class="${canContinue ? "ghost-btn" : "approve-btn large"}" disabled onclick="confirmEntityApproval(false)">${canContinue ? "APPROVE ONLY" : "APPROVE"}</button><button id="entity-approve-continue" class="approve-btn large" disabled onclick="confirmEntityApproval(true)" ${canContinue ? "" : "hidden"}>APPROVE & EDIT NEXT STATE</button>`;
  /* THE SHEET-SOURCE MODAL SAYS WHAT IT DOES.
     It used to borrow the approval modal wholesale: "Approve reference", "ASSIGN
     ONE CANDIDATE TO ONE CONTINUITY STATE", "Approve for continuity state" and a
     button reading APPROVE — four statements of an authority this operation has
     never written. The words are now the operation's own.
     The FIELDS are hidden rather than removed: confirmEntityApproval() reads the
     same three element ids in both shapes, so the command it issues is unchanged
     and this stays a presentation convergence rather than a second writer.
     There is nothing to choose here — the sheet is the one that was named and the
     operation targets no state authority — so nothing is asked twice. */
  const sheetSourceMarkup = `<div class="entity-approval-modal entity-sheet-source-modal" data-approval-mode="sheet-source"><h3>Use reference sheet — ${esc(x.name || id)}</h3><div class="modal-sub">USE THIS SHEET AS A SOURCE FOR EXTRACTING REFERENCE VIEWS</div><div class="entity-approval-modal-layout"><figure><div id="entity-approval-preview">${isVideo(selected.name) ? `<video muted controls src="${attr(selected.url)}"></video>` : `<img src="${attr(selected.url)}" alt="Reference sheet to use as a source">`}</div><figcaption id="entity-approval-file-caption">${esc(selected.name)}</figcaption></figure><div class="entity-approval-fields"><div class="form-field entity-sheet-source-readout"><label>Reference sheet</label><div class="entity-approval-single-state-readout"><b>${esc(selected.name)}</b><small>Several views in one image. CineBraid will open the extractor so you can cut single views out of it.</small></div></div><input type="hidden" id="entity-approve-file" value="${attr(selected.name)}"><input type="hidden" id="entity-approve-target" value="${attr(targetState.id)}"><input type="hidden" id="entity-approve-name" value="${attr(selected.name)}"><p class="hint">This does not make the sheet ${esc(x.name || id)}'s identity reference, and it changes no approved image. Extracted views can be approved individually afterwards.</p></div></div><div class="modal-actions entity-approval-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="confirmEntityApproval(false)">USE SHEET</button></div></div>`;

  /* THE PRIMARY SELECTOR IS THE ELIGIBLE POOL, NOT `media`.
     Entry filtered correctly and then handed the filmmaker a dropdown of every
     file on the reference, so switching it re-opened the exact hole the entry
     check had just closed: an undeclared row presented as approvable, refused a
     click later by the kernel. One list, one predicate, both ends. */
  const primaryMarkup = `<div class="entity-approval-modal" data-approval-mode="primary-authority"><h3>Approve reference — ${esc(x.name || id)}</h3><div class="modal-sub">ASSIGN ONE CANDIDATE TO ONE CONTINUITY STATE</div><div class="entity-approval-modal-layout"><figure><div id="entity-approval-preview">${isVideo(selected.name) ? `<video muted controls src="${attr(selected.url)}"></video>` : `<img src="${attr(selected.url)}" alt="Candidate to approve">`}</div><figcaption id="entity-approval-file-caption">${esc(selected.name)}</figcaption></figure><div class="entity-approval-fields"><div class="form-field"><label>Candidate file</label><select id="entity-approve-file" onchange="syncEntityApprovalModal()">${eligiblePool.map((item) => `<option value="${attr(item.name)}" ${item.name === selected.name ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></div>${stateField}<div class="entity-approval-target-summary" id="entity-approval-target-summary"></div><div class="entity-approval-readiness" id="entity-approval-readiness" data-state="preparing" role="status" aria-live="polite">Preparing this image for approval&hellip;</div><p class="hint">The selected state will show this image in the live Project Bible. This image keeps the filename it was imported under, and other states and candidates are unchanged.</p>${continuationField}</div></div><div class="modal-actions entity-approval-actions"><button class="changes-btn" onclick="closeModal();requestEntityChanges('${list}','${id}')">Request changes</button><div>${approvalActions}</div></div></div>`;

  openModal(sheetSource ? sheetSourceMarkup : primaryMarkup);
  /* A modal that has just opened holds no prepared identity, whatever the last
     one held. Clearing before the first sync is what stops a previous
     candidate's readiness enabling this candidate's button for one frame. */
  ENTITY_APPROVAL_READINESS = null;
  ENTITY_APPROVAL_PREPARING = "";
  syncEntityApprovalModal();
};
window.syncEntityApprovalModal = () => {
  const current = window._entityApproval || {};
  const x = P[current.list]?.find((item) => item.id === current.id);
  if (!x) return;
  const requestedFile = document.getElementById("entity-approve-file")?.value || current.name || "";
  /* THE SAME BOUNDARY ON THE WAY BACK IN, AND ON EVERY PASS.
     A dropdown built from the eligible pool cannot OFFER an ineligible file, but
     this refresh reads whatever the element now holds, so a value set from
     anywhere else would walk past the entry check.
     IT RE-ASKS ABOUT THE CURRENT SELECTION TOO, which is the part that was
     missing: the first version only checked a file whose NAME had changed, so a
     row that turned undeclared or into a sheet while the modal sat open kept its
     selection simply because it was still called the same thing. Eligibility is
     a fact about the row, not about the filename, and it is recomputed here every
     time rather than cached from when the modal opened.
     Sheet-source has one file and no selector; its own structure is re-checked at
     the writer. This decides what is OFFERED; the kernel still decides what is
     written. */
  const primaryIntent = current.mode !== "sheet-source";
  const eligibleNow = (candidate) => (
    typeof referenceArtifactStructureOf === "function"
    && typeof artifactMayHoldPrimaryAuthority === "function"
    && Boolean(candidate)
    && artifactMayHoldPrimaryAuthority(referenceArtifactStructureOf(x, candidate)) === true
  );
  let fileName = requestedFile;
  let lostSelection = false;
  if (primaryIntent && !eligibleNow(fileName)) {
    /* The entry pool's own rule, applied again: another currently eligible
       candidate may take over, and if there is none this modal has nothing left
       to approve and says so rather than holding a selection it cannot write. */
    const stillEligible = (typeof entityMedia === "function" ? entityMedia(current.list, x) : [])
      .filter((item) => item.name !== fileName && eligibleNow(item.name));
    fileName = stillEligible.length ? stillEligible[stillEligible.length - 1].name : "";
    lostSelection = true;
  }
  if (fileName !== requestedFile) {
    const revert = document.getElementById("entity-approve-file");
    if (revert) revert.value = fileName;
  }
  const confirmButton = document.getElementById("entity-approve-confirm");
  const continueButton = document.getElementById("entity-approve-continue");
  if (primaryIntent) {
    /* FAIL CLOSED VISIBLY. Nothing eligible left means no approval is available
       from this modal; confirmEntityApproval() refuses the same request on its
       own, so this is the offer agreeing with the writer rather than guarding it. */
    if (confirmButton) confirmButton.disabled = !fileName;
    if (continueButton) continueButton.disabled = !fileName;
  }
  if (lostSelection) {
    toast(fileName
      ? `That file is no longer recorded as a single reference image. Showing ${fileName} instead.`
      : "None of these files is recorded as a single reference image any more, so there is nothing here to approve as this reference's identity.");
  }
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
  const nextSelect = document.getElementById("entity-approve-next");
  if (nextSelect) {
    const previous = targetChanged ? "" : nextSelect.value;
    /* Ancestors are absent from this list by construction, so the ring that
       offered an already-approved parent after the final descendant cannot form. */
    const nextStates = entityApprovalContinuationStates(x, stateId, current.list);
    /* PT1 / DF-04 — FILE ASSIGNMENT IS NOT APPROVAL, AND THIS LINE USED TO SAY IT WAS.

       The wording was `item.approvedFile ? " · currently approved" : " · needs
       reference"`. `approvedFile` is a POINTER — an edge a state can hold with no
       receipt behind it — so the one surface where approval is granted told the
       filmmaker `Edit Opened · currently approved` about a state the authority
       projection was simultaneously classifying `Historic · not approved`.

       There is one reader of that question in this application and it is the
       projection, so this asks it. Three standings, three sentences: only a
       receipt-backed state may be called approved, a pointer with no receipt is
       named as the historic selection it is, and a state with neither still needs
       a reference.

       PT1-C1 — AND "NEEDS REFERENCE" IS ITSELF A CLAIM. The first repair guarded
       only the case where entityStateTruth() is absent; it could not see the case
       where the truth reader is present and the PROJECTION UNDER IT is not, which
       used to hand back fabricated empty collections. A state holding a current
       approval was then offered as `Edit Opened · needs reference` — a different
       wrong answer, arrived at the same way.

       Three of these four branches are statements about authority, and none of
       them may be reached from an answer nobody could compute. `available` is
       asked first, and any standing this list does not recognise is treated as
       unavailable rather than falling through to the last line. */
    const continuationTruth = typeof entityStateTruth === "function" ? entityStateTruth(current.list, x) : null;
    const continuationStanding = (item) => {
      if (!continuationTruth || continuationTruth.available === false) return " · approval state unavailable";
      const standing = continuationTruth.of(item).standing;
      if (standing === "canon") return " · currently approved";
      if (standing === "historic") return " · historic, not approved";
      if (standing !== "missing") return " · approval state unavailable";
      return " · needs reference";
    };
    nextSelect.innerHTML = `<option value="">Approve only — stay on this asset</option>${nextStates.map((item) => `<option value="${attr(item.id)}">Edit ${esc(item.name || "next state")}${continuationStanding(item)}</option>`).join("")}`;
    const validPrevious = nextStates.some((item) => item.id === previous);
    nextSelect.value = validPrevious ? previous : entitySuggestedContinuationState(x, stateId);
    /* W9 — the shape follows the newly selected target. A state with nowhere to
       continue to withdraws the field and the second action and promotes APPROVE
       to the single primary act; a state that has somewhere restores all three.
       Both directions, because the target selector moves both ways. */
    const canContinueNow = nextStates.length > 0;
    const field = document.getElementById("entity-approve-continuation-field");
    const confirmButton = document.getElementById("entity-approve-confirm");
    const continueAction = document.getElementById("entity-approve-continue");
    if (field) field.hidden = !canContinueNow;
    if (continueAction) continueAction.hidden = !canContinueNow;
    if (confirmButton) {
      confirmButton.textContent = canContinueNow ? "APPROVE ONLY" : "APPROVE";
      confirmButton.className = canContinueNow ? "ghost-btn" : "approve-btn large";
    }
  }
  syncEntityApprovalContinuation();
  /* LAST WORD, AND ONLY EVER A WITHDRAWAL. Everything above decided what this
     modal may OFFER; this decides whether CineBraid can yet say which bytes it
     would approve, and asks for that answer if it cannot. */
  renderEntityApprovalReadiness();
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
/* EVERYTHING A COMPLETED APPROVAL DOES ONCE IT IS REAL.

   It used to run straight after dirty(), which only ARMS a write — so the
   ceremony, the automation reconciliation, the continuation and the navigation
   all fired for approvals storage had refused. They are gathered here so there is
   exactly one place that says "this happened", and exactly one caller allowed to
   reach it: a submission whose durable acceptance has been proven. A sheet source
   reaches it directly, because it writes no Canon and its ordinary save is
   unchanged by this slice. */
async function finishEntityApprovalCeremony(meta) {
  closeModal();
  await route();
  /* This approval may be exactly what an automation run is parked on. See
     v670ReconcileAfterApproval — the gate leaves every activity surface now,
     not at the next poll. */
  if (typeof v670ReconcileAfterApproval === "function") v670ReconcileAfterApproval();
  const entity = P[meta.list]?.find((row) => row && row.id === meta.entityId);
  const targetState = entity ? entityStateById(entity, meta.stateId) : null;
  if (!meta.sheetSource && targetState && !targetState.isDefault && targetState.approvedFile && String(targetState.notes || "").trim()) {
    /* C2 GLOBAL: authority source only - behaviour unchanged. */
    const capability = typeof capabilityState === "function" ? capabilityState("vision") : { standing: "checking" };
    if (visionCanReview(capability)) setTimeout(() => validateContinuityStateAgainstParent(meta.list, meta.entityId, targetState.id), 220);
  }
  if (meta.sheetSource && typeof openCoverageSheetExtractor === "function") {
    rememberWorkspaceSection?.(entityCoverageSectionKey?.(meta.list, meta.entityId, meta.coverageSheetType === "expressions" ? "expressions" : "angles"), true);
    setTimeout(() => openCoverageSheetExtractor(meta.list, meta.entityId, meta.fileName), 50);
  } else if (meta.nextStateId) revealEntityContinuityState(meta.nextStateId);
  /* THE COMPLETION NAMES THE AUTHORITY THAT WAS WRITTEN, AND A SHEET SOURCE
     WROTE NONE. Both lines used to say APPROVED regardless — the stamp
     unconditionally, and the toast in its own words — so accepting extraction
     material was reported as an approval for a continuity state that had not
     changed. */
  stampCeremony(meta.sheetSource ? "SHEET SOURCE SELECTED" : `APPROVED · ${meta.stateName || "DEFAULT"}`);
  toast(meta.sheetSource
    ? `${meta.fileName} is ready as a reference sheet — extract its individual views next`
    : meta.nextStateName
      ? `Approved ${meta.fileName} for ${meta.stateName || "Default"} — editing ${meta.nextStateName}`
      : `Approved ${meta.fileName} for ${meta.stateName || "Default"}`);
}

/* The one door out of the pending surface that ends in an approval. `stored` is
   present only when the outcome was discovered by reading storage rather than by
   the response to the write — a lost response is still a durable approval, and
   this is where the window catches up with it. */
async function completePendingApproval(record, stored = null) {
  if (stored && typeof adoptDurableApprovalOutcome === "function") adoptDurableApprovalOutcome(record, stored);
  endApprovalSubmission(record.id);
  await finishEntityApprovalCeremony(record.meta);
}

window.confirmEntityApproval = async (continueToNext = false) => {
  const { list, id } = window._entityApproval || {};
  if (!list) return;
  /* ONE TRUSTED DECISION AT A TIME. A second click — a double click, or a second
     approval started while the first is still unresolved — must not produce a
     second receipt for a decision whose outcome nobody knows yet. */
  if (typeof approvalSubmissionPending === "function" && approvalSubmissionPending()) {
    showPendingApprovalSurface();
    return toast("An approval is still being saved. Resolve it before approving again.");
  }
  const x = P[list].find((e) => e.id === id),
    name = document.getElementById("entity-approve-file")?.value || window._entityApproval.name || "",
    targetStateId = document.getElementById("entity-approve-target")?.value || "state-default",
    targetState = entityStateById(x, targetStateId),
    requestedNextStateId = continueToNext ? document.getElementById("entity-approve-next")?.value || "" : "",
    /* Re-validated at the writer. `isValidContinuation` excludes the current
       state and every ancestor of it, so an id that survived a stale render
       cannot open an editor the lineage rule forbids. */
    nextStateId = requestedNextStateId && isValidContinuation(entityStateListRead(x, true), targetStateId, requestedNextStateId) ? requestedNextStateId : "",
    nextState = nextStateId ? entityStateById(x, nextStateId) : null;
  const originalApprovalRow = entityCandidateRow(x, name, false);
  /* THE MODE CHOOSES THE WORKFLOW. THE STRUCTURE ONLY SAYS WHETHER IT IS ALLOWED.
     This used to read the artifact's class and pick a workflow from it, so a row
     that became a sheet while the modal was open silently converted a primary
     approval into a sheet-source acceptance — an operation the filmmaker never
     asked for, announced as one they did. Structure is now a precondition
     checked INSIDE the operation that was already chosen, and it can only refuse;
     it can no longer switch.
     Both arms re-read the row NOW rather than trusting what was true when the
     modal opened, which is the same reason syncEntityApprovalModal() re-asks. */
  const approvalMode = window._entityApproval?.mode === "sheet-source" ? "sheet-source" : "primary-authority";
  const structureNow = typeof referenceArtifactStructureOf === "function"
    ? String(referenceArtifactStructureOf(x, name) || "") : "";
  const approvedIsCoverageSheet = approvalMode === "sheet-source";
  if (approvedIsCoverageSheet) {
    if (structureNow !== "sheet") {
      return toast(`${name || "That file"} is no longer recorded as a coverage sheet, so it cannot be used as one. Nothing was changed.`);
    }
  } else {
    const mayHoldPrimary = typeof artifactMayHoldPrimaryAuthority === "function"
      && artifactMayHoldPrimaryAuthority(structureNow) === true;
    if (!mayHoldPrimary) {
      return toast(structureNow === "sheet"
        ? `${name || "That file"} is a coverage sheet — several views in one image — so it cannot be this reference's identity. Use it as a sheet source instead. Nothing was changed.`
        : `${name || "That file"} is not recorded as a single reference image, so it cannot become this reference's identity. Nothing was changed.`);
    }
  }
  if (continueToNext && !nextState && !approvedIsCoverageSheet) {
    return toast(requestedNextStateId
      ? "That state cannot follow this one — it is what this state derives from. Choose a state further down the chain."
      : "Choose the continuity state to edit next");
  }
  const entityAuthorityStateId = targetState?.id || targetStateId || "state-default";
  /* THE PREPARED IDENTITY, RE-ASKED SYNCHRONOUSLY, INSIDE THE CLICK.

     The whole point of preparing before the button is enabled is that this check
     costs nothing here: it is a comparison, it yields to nothing, and it is the
     last statement before Canon. If it refuses, the modal says why and asks for a
     prepared identity again — it never falls back to approving with whatever the
     scan happened to know, which is the defect this slice removes. */
  let preparedAssetId = "";
  if (!approvedIsCoverageSheet) {
    const want = { list, id, stateId: entityAuthorityStateId, name, mode: "primary-authority" };
    const refusal = entityApprovalReadinessRefusal(ENTITY_APPROVAL_READINESS, want);
    if (refusal) {
      ENTITY_APPROVAL_READINESS = null;
      ENTITY_APPROVAL_PREPARING = "";
      renderEntityApprovalReadiness();
      return toast(refusal.message);
    }
    preparedAssetId = ENTITY_APPROVAL_READINESS.assetId;
  }
  /* Withdrawn before anything is written, so a second click on the same gesture
     finds no live control. The refusal path below restores them. */
  const confirmButton = document.getElementById("entity-approve-confirm");
  const continueButton = document.getElementById("entity-approve-continue");
  if (confirmButton) confirmButton.disabled = true;
  if (continueButton) continueButton.disabled = true;
  /* CANON FIRST, INSIDE THE CLICK, ON THE BYTES THE CREATOR IS LOOKING AT.
     The shot-side twin carries the full argument; the shape is identical here.
     The same command still applies the ownership veto, so a file whose owner is
     unresolved or contested cannot be made canon from this screen. A refusal
     writes nothing and says why.

     USE AS SHEET SOURCE IS NOT AN IDENTITY DECISION. Accepting a sheet source
     records the decision on the row and opens the extractor. It moves NO primary
     pointer, so an entity that already has a real identity reference keeps it.
     The kernel refuses this target as well — see enforceTargetPolicy — and that
     refusal is the guarantee; this branch is what stops the filmmaker meeting an
     error message for an action the product deliberately offers. */
  if (!approvedIsCoverageSheet) {
    try {
      approveEntityStateCanon(P, {
        list, entityId: id, stateId: entityAuthorityStateId, value: name, assetId: preparedAssetId,
        at: new Date().toISOString(), via: "entity-approval-modal",
      });
    } catch (error) {
      syncEntityApprovalModal();
      return toast(error.message || "That file cannot be approved for this reference");
    }
  }
  /* NO RENAME. THE APPROVED IMAGE KEEPS THE NAME IT WAS IMPORTED UNDER.

     This is where the primary-reference approval used to POST /api/media/rename,
     move the file to a generated production name, repair every pointer that named
     it and then repair the receipt to follow the bytes. The move happened before
     the authority write was accepted, so a refused save left the file renamed with
     no durable approval behind it — and where the receipt had been written with
     no identity, repairCanonValue correctly refused to follow, leaving the pointer
     naming the new file and the receipt naming the old one. The authority seam
     then refused the pair, which is the correct fail-closed answer to a document
     the browser had already made inconsistent.

     Alpha removes the operation rather than sequencing it more carefully: a
     production filename is an ADDRESS, not an identity and not the decision, and
     nothing in the product needs it to change at the moment of approval. There is
     no background rename, no post-approval housekeeping pass and no staged
     relocation standing in for it — the bytes stay exactly where the filmmaker
     put them. Production naming can be reconsidered after Alpha as its own
     idempotent concern, decoupled from this decision.

     repairCanonValue, repairApprovalIdentity, the receipt validators and the
     media identity schema are untouched. They are simply no longer asked to
     repair a receipt after this approval moved its file, because it does not. */
  const finalName = name;
  const approvedAssetId = preparedAssetId
    || (entityMedia(list, x).find((item) => item.name === finalName) || {}).assetId || "";
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
  const meta = {
    list,
    entityId: id,
    entityName: x.name || id,
    stateId: entityAuthorityStateId,
    stateName: targetState?.name || "Default",
    fileName: finalName,
    assetId: approvedAssetId,
    url: (entityMedia(list, x).find((item) => item.name === finalName) || {}).url || "",
    nextStateId: nextState?.id || "",
    nextStateName: nextState?.name || "",
    sheetSource: approvedIsCoverageSheet,
    coverageSheetType: originalApprovalRow?.coverageSheetType || "",
  };
  /* SHEET SOURCE IS UNCHANGED BY THIS SLICE. It writes no Canon, so it has no
     durable authority outcome to wait for and saves exactly as it always has. */
  if (approvedIsCoverageSheet) {
    dirty();
    return finishEntityApprovalCeremony(meta);
  }
  /* APPROVED IN THIS TAB IS NOT APPROVED. The decision is now a submission, and
     the filmmaker keeps looking at the image and the exact target it was for
     until storage has either accepted it or said why it did not. */
  const submission = beginApprovalSubmission(meta);
  showPendingApprovalSurface();
  const resolved = await dispatchApprovalSubmission(submission);
  if (resolved.outcome === "committed") return completePendingApproval(submission, null);
  if (resolved.outcome === "unknown") return resolvePendingApprovalOutcome();
  showPendingApprovalSurface();
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
