/* ---------- candidate review, provenance and package freshness ---------- */
const CANDIDATE_DECISIONS = ["unreviewed", "shortlist", "rejected"];
let CANDIDATE_COMPARE = new Set();

function candidateRecord(s, name, create = true) {
  s.candidateFiles = Array.isArray(s.candidateFiles) ? s.candidateFiles : [];
  let row = s.candidateFiles.find((x) => (x.stored || x.name) === name);
  if (!row && create) {
    row = {
      stored: name,
      original: name,
      addedAt: new Date().toISOString(),
      decision: "unreviewed",
      notes: "",
      labels: [],
    };
    s.candidateFiles.push(row);
  }
  if (!row) return null;
  if (!CANDIDATE_DECISIONS.includes(row.decision)) row.decision = "unreviewed";
  row.labels = Array.isArray(row.labels) ? row.labels : [];
  row.notes = String(row.notes || "");
  if (typeof normalizeCandidateStructuredReview === "function") normalizeCandidateStructuredReview(row);
  row.correctionBuildIds = Array.isArray(row.correctionBuildIds) ? row.correctionBuildIds : [];
  return row;
}
function candidateAutomationProvenanceMarkup(row, shotId, name) {
  const report = row?.automationReport;
  if (!report) return "";
  return `<section class="candidate-automation-provenance"><span>AUTOMATION GENERATION RECORD</span><b>${esc(report.runId || row.automationRunId || "Durable run")}</b><small>${esc(report.stepKey || row.automationStepKey || "")} · ${esc(report.status || "captured")} · ${esc(report.capturedAt ? new Date(report.capturedAt).toLocaleString() : "")}</small><button type="button" class="chip" onclick="copyCandidateAutomationReport('${shotId}','${attr(name)}')">COPY RUN REPORT</button></section>`;
}
window.copyCandidateAutomationReport = async (shotId, name) => {
  const shot = shotById(shotId), row = shot ? candidateRecord(shot, name, false) : null;
  if (!row?.automationReport) return toast("No automation report is attached");
  const text = JSON.stringify(row.automationReport, null, 2);
  try { await navigator.clipboard.writeText(text); toast("Attached automation report copied"); }
  catch { openModal(`<h3>Automation generation record</h3><textarea class="automation-debug-text" readonly>${esc(text)}</textarea><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`); }
};
function normalizeCandidateReviewSchema(s, takes = []) {
  let changed = false;
  s.candidateFiles = Array.isArray(s.candidateFiles) ? s.candidateFiles : [];
  for (const t of takes) {
    const before = s.candidateFiles.length;
    candidateRecord(s, t.name, true);
    if (s.candidateFiles.length !== before) changed = true;
  }
  for (const row of s.candidateFiles) {
    const old = row.decision;
    if (!CANDIDATE_DECISIONS.includes(row.decision)) row.decision = "unreviewed";
    if (old !== row.decision) changed = true;
    if (!Array.isArray(row.labels)) {
      row.labels = [];
      changed = true;
    }
    if (row.notes == null) {
      row.notes = "";
      changed = true;
    }
  }
  return changed;
}
function renameCandidateRecord(s, from, to) {
  const row = candidateRecord(s, from, false);
  if (!row || from === to) return;
  row.stored = to;
  row.renamedFrom = [...new Set([...(row.renamedFrom || []), from])].slice(-8);
  row.renamedAt = new Date().toISOString();
  if (CANDIDATE_COMPARE.has(`${s.id}:${from}`)) {
    CANDIDATE_COMPARE.delete(`${s.id}:${from}`);
    CANDIDATE_COMPARE.add(`${s.id}:${to}`);
  }
}
function allShotPackages(s) {
  const rows = [];
  const add = (list, scope, label) =>
    resolvePromptBuildList(P, list || []).forEach((pack) => rows.push({ pack, scope, label }));
  add(s.generationPackages, "shot", "Shot");
  (s.keyframes || []).forEach((f) =>
    add(f.generationPackages, `frame:${f.id}`, `Frame ${f.label || "?"}`),
  );
  (s.clips || []).forEach((c) =>
    add(
      c.generationPackages,
      `segment:${unitKey(c)}`,
      `Motion ${c.label || c.suffix || "?"}`,
    ),
  );
  return rows.sort(
    (a, b) => String(b.pack.date || "").localeCompare(String(a.pack.date || "")),
  );
}
function normalizePackageList(list, scope = "") {
  if (!Array.isArray(list)) return false;
  let changed = false;
  list.forEach((entry, index) => {
    const pack = resolvePromptBuild(P, entry);
    if (!pack || pack.missing) return;
    const canonical = P.promptBuildsById?.[pack.id] || pack;
    if (!canonical.scope && scope) { canonical.scope = scope; changed = true; }
    if (!canonical.revision) { canonical.revision = index + 1; changed = true; }
    if (!canonical.revisionReason) { canonical.revisionReason = "compiled"; changed = true; }
    if (!canonical.immutableAt) { canonical.immutableAt = canonical.date || new Date().toISOString(); changed = true; }
  });
  return changed;
}
function normalizeShotPackageHistory(s) {
  let changed = normalizePackageList(s.generationPackages || [], "shot");
  (s.keyframes || []).forEach((f) => {
    if (normalizePackageList(f.generationPackages || [], `frame:${f.id}`))
      changed = true;
  });
  (s.clips || []).forEach((c) => {
    if (normalizePackageList(c.generationPackages || [], `segment:${unitKey(c)}`))
      changed = true;
  });
  return changed;
}
function packageInputSnapshot(s, pack, refs = [], direction = "") {
  const frame = pack.frameId ? frameById(s, pack.frameId) : null;
  const unit = pack.segmentId
    ? (s.clips || []).find((x) => unitKey(x) === String(pack.segmentId))
    : null;
  const first = unit ? frameById(s, unit.fromFrame) : null;
  const last = unit ? frameById(s, unit.toFrame) : null;
  const media = shotMediaLinks(s)
    .filter(({ link }) => link.generationInput)
    .map(({ asset, link }) => [asset.id, asset.file || "", link.role || ""])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return {
    direction: String(direction || "").trim(),
    frameWinner: frame?.winner || "",
    firstFrameWinner: first?.winner || "",
    lastFrameWinner: last?.winner || "",
    generationMedia: media,
    references: (refs || [])
      .map((x) => [x.key || "", x.url || "", x.role || "", x.mediaType || "", x.instruction || ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
}
function appendPackageRevision(list, pack, reason = "compiled", parent = null) {
  const revisions = resolvePromptBuildList(P, list || []).map((x) => Number(x.revision) || 0);
  pack.revision = Math.max(0, ...revisions) + 1;
  pack.revisionReason = reason;
  pack.parentPackageId = parent?.id || pack.parentPackageId || "";
  pack.immutableAt = pack.date || new Date().toISOString();
  const buildId = registerPromptBuild(P, pack);
  list.push(promptBuildRef(buildId, { scope: pack.scope || "", kind: pack.kind || "", revisionReason: reason }));
  applyPromptBuildRetention(P);
  return resolvePromptBuild(P, buildId);
}
function currentDirectionForPackage(s, pack) {
  const directive = s.packagePlanner?.directiveByScope?.[pack.scope] || "";
  let base = "";
  if (pack.frameId) base = frameById(s, pack.frameId)?.description || "";
  else if (pack.segmentId) {
    const unit = (s.clips || []).find(
      (x) => unitKey(x) === String(pack.segmentId),
    );
    base = unit?.motionPrompt || unit?.note || "";
  } else base = s.motionPrompt || "";
  return [base, directive].filter(Boolean).join("\n").trim();
}
function currentSnapshotForPackage(s, pack) {
  const available =
      typeof promptReferenceOptions === "function" ? promptReferenceOptions(s) : [],
    refs = (pack.references || []).map((saved) => {
      const current = available.find((x) => x.key === saved.key);
      return current ? { ...saved, url: current.url, label: current.label } : saved;
    });
  return packageInputSnapshot(
    s,
    pack,
    refs,
    currentDirectionForPackage(s, pack),
  );
}
function packageStaleReasons(s, pack) {
  const saved = pack?.dependencySnapshot;
  if (!saved) return [];
  const now = currentSnapshotForPackage(s, pack),
    reasons = [];
  if (String(saved.direction || "") !== String(now.direction || ""))
    reasons.push("written direction changed");
  if (String(saved.frameWinner || "") !== String(now.frameWinner || ""))
    reasons.push("approved frame changed");
  if (
    String(saved.firstFrameWinner || "") !== String(now.firstFrameWinner || "")
  )
    reasons.push("approved start frame changed");
  if (
    String(saved.lastFrameWinner || "") !== String(now.lastFrameWinner || "")
  )
    reasons.push("approved end frame changed");
  if (
    JSON.stringify(saved.generationMedia || []) !==
    JSON.stringify(now.generationMedia || [])
  )
    reasons.push("approved generation media changed");
  if (JSON.stringify(saved.references || []) !== JSON.stringify(now.references || []))
    reasons.push("approved reference file changed");
  return [...new Set(reasons)];
}
function shotPackageStaleReasons(s) {
  return allShotPackages(s).flatMap(({ pack, label }) =>
    packageStaleReasons(s, pack).map(
      (reason) => `${label} package r${pack.revision || "?"}: ${reason}`,
    ),
  );
}
function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}
function packageOptionRows(s) {
  return allShotPackages(s).map(({ pack, label }) => ({
    value: pack.id,
    label: `${label} · r${pack.revision || "?"} · ${pack.profileName || pack.profileId || "package"}`,
    pack,
  }));
}
function candidateSourceLabel(row) {
  const snap = row.packageSnapshot;
  if (!snap) return "SOURCE NOT RECORDED";
  return `r${snap.revision || "?"} · ${snap.profileName || snap.profileId || "package"}`;
}
window.toggleCandidateCompare = (id, name, checked) => {
  const key = `${id}:${name}`;
  if (checked) {
    const current = [...CANDIDATE_COMPARE].filter((x) => x.startsWith(id + ":"));
    if (current.length >= 2) {
      CANDIDATE_COMPARE.delete(current[0]);
    }
    CANDIDATE_COMPARE.add(key);
  } else CANDIDATE_COMPARE.delete(key);
  route();
};
window.clearCandidateCompare = (id) => {
  [...CANDIDATE_COMPARE]
    .filter((x) => x.startsWith(id + ":"))
    .forEach((x) => CANDIDATE_COMPARE.delete(x));
  route();
};
window.setCandidateDecision = (id, name, decision) => {
  const s = shotById(id),
    row = candidateRecord(s, name);
  row.decision = row.decision === decision ? "unreviewed" : decision;
  row.reviewedAt = new Date().toISOString();
  dirty();
  route();
};
window.editCandidateDetails = (id, name) => {
  const s = shotById(id),
    row = candidateRecord(s, name),
    options = packageOptionRows(s),
    labels = ["best identity", "best motion", "best composition", "best continuity"];
  window._candidateEdit = { id, name };
  openModal(`<div class="candidate-detail-modal"><h3>Candidate details — ${esc(name)}</h3><div class="modal-sub">REVIEW NOTES AND FROZEN SOURCE PACKAGE</div><label>Decision<select id="candidate-decision"><option value="unreviewed" ${row.decision === "unreviewed" ? "selected" : ""}>Unreviewed</option><option value="shortlist" ${row.decision === "shortlist" ? "selected" : ""}>Shortlist</option><option value="rejected" ${row.decision === "rejected" ? "selected" : ""}>Rejected</option></select></label><label>Source package<select id="candidate-package"><option value="">Not recorded</option>${options.map((x) => `<option value="${attr(x.value)}" ${row.sourcePackageId === x.value ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select><span class="hint">Saving copies the complete package into this candidate. Later package edits cannot change its provenance.</span></label><label>Review notes<textarea id="candidate-notes" placeholder="What works, what fails, and what to preserve next time.">${esc(row.notes)}</textarea></label><div class="candidate-label-editor">${labels.map((x) => `<label><input type="checkbox" value="${attr(x)}" ${row.labels.includes(x) ? "checked" : ""}>${esc(x)}</label>`).join("")}</div>${row.aiReview ? `<div class="candidate-ai-note"><b>Latest AI triage · ${Math.round(+row.aiReview.score || 0)}/100</b><span>${esc(row.aiReview.notes || "")}</span></div>` : ""}${candidateAutomationProvenanceMarkup(row, id, name)}<div class="modal-actions">${row.approvedAt ? `<button class="ghost-btn" onclick="closeModal();markCandidateForFinish('${id}','${attr(name)}')">MARK FOR FINISHING</button>` : ""}<button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="saveCandidateDetails()">SAVE DETAILS</button></div></div>`);
};
window.saveCandidateDetails = () => {
  const { id, name } = window._candidateEdit || {};
  if (!id) return;
  const s = shotById(id),
    row = candidateRecord(s, name),
    packageId = document.getElementById("candidate-package")?.value || "",
    source = allShotPackages(s).find((x) => x.pack.id === packageId)?.pack;
  row.decision = document.getElementById("candidate-decision")?.value || "unreviewed";
  row.notes = document.getElementById("candidate-notes")?.value.trim() || "";
  row.labels = [...document.querySelectorAll(".candidate-label-editor input:checked")].map((x) => x.value);
  row.sourcePackageId = source?.id || "";
  row.packageSnapshot = source ? cloneJSON(source) : null;
  row.provenanceSavedAt = source ? new Date().toISOString() : "";
  row.reviewedAt = new Date().toISOString();
  dirty();
  closeModal();
  route();
  toast("Candidate details saved");
};
window.compareSelectedCandidates = (id) => {
  const s = shotById(id),
    names = [...CANDIDATE_COMPARE]
      .filter((x) => x.startsWith(id + ":"))
      .map((x) => x.slice(id.length + 1));
  if (names.length !== 2) return toast("Select exactly two candidates");
  const cards = names.map((name) => {
    const take = takesFor(id).find((x) => x.name === name),
      row = candidateRecord(s, name);
    return `<article><header><b>${esc(name)}</b><span>${esc(row.decision.toUpperCase())}</span></header><div class="candidate-compare-media">${isVideo(name) ? `<video controls muted src="${take?.url || ""}"></video>` : `<img src="${take?.url || ""}" alt="">`}</div><div class="candidate-compare-facts"><span>${esc(candidateSourceLabel(row))}</span>${row.aiReview ? `<span>AI ${Math.round(+row.aiReview.score || 0)}/100</span>` : ""}</div><p>${esc(row.notes || "No review notes yet.")}</p><div class="candidate-compare-actions"><button class="chip" onclick="closeModal();editCandidateDetails('${id}','${attr(name)}')">EDIT NOTES</button><button class="approve-btn" onclick="closeModal();approveTake('${id}','${attr(name)}')">APPROVE</button></div></article>`;
  });
  openModal(`<div class="candidate-compare-modal"><h3>A/B candidate comparison — ${esc(id)}</h3><div class="modal-sub">COMPARE THE OUTPUTS; THE DIRECTOR MAKES THE FINAL PICK</div><div class="candidate-compare-grid">${cards.join("")}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div></div>`);
};
function storeCandidateAIReview(id, data) {
  const s = shotById(id),
    reviews = data?.review?.reviews || [],
    files = data?.files || [],
    at = new Date().toISOString();
  reviews.forEach((review) => {
    const name = files[Number(review.n) - 1];
    if (!name) return;
    const row = candidateRecord(s, name);
    row.aiReview = {
      score: Number(review.score) || 0,
      pass: !!review.pass,
      notes: String(review.notes || ""),
      reviewedAt: at,
      strategy: data.strategy?.mode || "",
    };
  });
  if (reviews.length) dirty();
}
function markCandidateApproved(s, name, target) {
  const row = candidateRecord(s, name);
  row.approvedAt = new Date().toISOString();
  row.approvedTarget = target || "shot";
  row.decision = "shortlist";
}
function finishJobById(id) {
  P.finishJobs = Array.isArray(P.finishJobs) ? P.finishJobs : [];
  return P.finishJobs.find((job) => job.id === id) || null;
}
window.markCandidateForFinish = (shotId, name) => {
  const s = shotById(shotId),
    row = candidateRecord(s, name);
  if (!row.approvedAt) return toast("Approve the image first");
  const existing = shotFinishJobs(shotId).find(
    (job) => job.sourceFile === name && job.approvedTarget === (row.approvedTarget || "shot"),
  );
  if (existing) return editFinishJob(existing.id);
  window._finishDraft = { shotId, name, approvedTarget: row.approvedTarget || "shot" };
  const video = isVideo(name);
  openModal(`<h3>Mark for finishing — ${esc(name)}</h3><div class="modal-sub">QUEUE A QC-TRACKED ${video ? "VIDEO" : "STILL"} FINISH PASS WITHOUT REPLACING THE APPROVED ORIGINAL</div><label>Finish type<select id="finish-type">${video ? `<option value="video-upscale">Video upscale</option><option value="interpolation">Frame interpolation</option><option value="video-cleanup">Artifact cleanup</option><option value="video-repair">Repair / retake</option><option value="post">Color / post</option>` : `<option value="upscale">Upscale</option><option value="cleanup">Cleanup</option><option value="text-fix">Text fix</option><option value="repair">Repair / retouch</option><option value="post">Color / post</option>`}</select></label><label>Target resolution / notes<input id="finish-resolution" placeholder="${video ? "e.g. 4K, 24fps delivery" : "e.g. 4K landscape"}"></label><label>Instructions<textarea id="finish-notes" placeholder="Preserve timing, composition, identity, and crop. Describe only the finish operation."></textarea></label><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="createFinishJob()">MARK READY</button></div>`);
};
window.createFinishJob = () => {
  const draft = window._finishDraft || {};
  if (!draft.shotId) return;
  P.finishJobs = Array.isArray(P.finishJobs) ? P.finishJobs : [];
  P.finishJobs.push({
    id: `finish-${Date.now().toString(36)}`,
    scope: "shot",
    shotId: draft.shotId,
    sourceFile: draft.name,
    approvedTarget: draft.approvedTarget || "shot",
    type: document.getElementById("finish-type")?.value || "upscale",
    targetResolution: document.getElementById("finish-resolution")?.value.trim() || "",
    notes: document.getElementById("finish-notes")?.value.trim() || "",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  dirty();
  closeModal();
  route();
  toast("Finish job added to the shot");
};
window.setFinishJobField = (jobId, field, value) => {
  const job = finishJobById(jobId);
  if (!job) return;
  job[field] = value;
  job.updatedAt = new Date().toISOString();
  dirty();
};
window.editFinishJob = (jobId) => {
  const job = finishJobById(jobId);
  if (!job) return;
  const s = shotById(job.shotId),
    takeOptions = takesFor(job.shotId).map((t) => `<option value="${attr(t.name)}" ${job.resultFile === t.name ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  openModal(`<div class="candidate-detail-modal"><h3>Finish job — ${esc(job.sourceFile || job.id)}</h3><div class="modal-sub">TRACK RESULT IMPORT, QC, AND OPTIONAL PROMOTION</div><label>Status<select id="finish-status"><option value="ready" ${job.status === "ready" ? "selected" : ""}>Ready for finishing</option><option value="in-progress" ${job.status === "in-progress" ? "selected" : ""}>In progress</option><option value="result-received" ${job.status === "result-received" ? "selected" : ""}>Result received</option><option value="qc-approved" ${job.status === "qc-approved" ? "selected" : ""}>QC approved</option><option value="changes-requested" ${job.status === "changes-requested" ? "selected" : ""}>Changes requested</option><option value="promoted" ${job.status === "promoted" ? "selected" : ""}>Promoted active</option></select></label><label>Result file<select id="finish-result"><option value="">Not imported yet</option>${takeOptions}</select><span class="hint">Import the upscaled or retouched file into this shot's takes folder, then select it here.</span></label><label>QC / notes<textarea id="finish-job-notes">${esc(job.notes || "")}</textarea></label><div class="modal-actions"><button class="changes-btn" onclick="deleteFinishJob('${job.id}')">Delete job</button><button class="cancel" onclick="closeModal()">Cancel</button><button class="ghost-btn" onclick="saveFinishJob('${job.id}')">Save</button>${job.resultFile ? `<button class="approve-btn" onclick="saveFinishJob('${job.id}',true)">SAVE + PROMOTE RESULT</button>` : ""}</div></div>`);
};
window.saveFinishJob = (jobId, promote = false) => {
  const job = finishJobById(jobId);
  if (!job) return;
  job.status = document.getElementById("finish-status")?.value || job.status || "ready";
  job.resultFile = document.getElementById("finish-result")?.value || "";
  job.notes = document.getElementById("finish-job-notes")?.value.trim() || "";
  job.updatedAt = new Date().toISOString();
  dirty();
  closeModal();
  if (promote) return promoteFinishJob(jobId);
  route();
  toast("Finish job saved");
};
window.deleteFinishJob = (jobId) => {
  P.finishJobs = (P.finishJobs || []).filter((job) => job.id !== jobId);
  dirty();
  closeModal();
  route();
  toast("Finish job removed");
};
window.promoteFinishJob = (jobId) => {
  const job = finishJobById(jobId);
  if (!job || !job.resultFile) return toast("Choose the imported result file first");
  const s = shotById(job.shotId),
    target = String(job.approvedTarget || "shot");
  if (target === "shot") s.winner = job.resultFile;
  else if (target.startsWith("frame:")) {
    const f = frameById(s, target.slice(6));
    if (f) f.winner = job.resultFile;
  } else if (target.startsWith("segment:")) {
    const seg = (s.clips || []).find((x) => unitKey(x) === target.slice(8));
    if (seg) seg.videoWinner = job.resultFile;
  }
  const row = candidateRecord(s, job.resultFile, true);
  row.approvedAt = new Date().toISOString();
  row.approvedTarget = target;
  row.decision = "shortlist";
  row.finishedFrom = job.sourceFile || "";
  job.promotedAt = new Date().toISOString();
  job.status = "promoted";
  job.updatedAt = job.promotedAt;
  dirty();
  route();
  toast("Finished result promoted to the active approved asset");
};
window.restorePackageRevision = (shotId, scope, packageId) => {
  const s = shotById(shotId);
  let target = s;
  if (scope.startsWith("frame:")) target = frameById(s, scope.slice(6));
  else if (scope.startsWith("segment:"))
    target = (s.clips || []).find((x) => unitKey(x) === scope.slice(8));
  const list = target?.generationPackages || [],
    source = resolvePromptBuildList(P, list).find((x) => x.id === packageId);
  if (!source) return toast("Package revision no longer exists");
  const copy = cloneJSON(source);
  copy.id = `pkg-${Date.now().toString(36)}`;
  copy.date = new Date().toISOString();
  copy.restoredFromPackageId = source.id;
  delete copy.guardianHistory;
  appendPackageRevision(list, copy, "restored", source);
  dirty();
  route();
  toast(`Restored as revision ${copy.revision}`);
};

/* ---------- v6.1 structured candidate review and correction ---------- */
const CANDIDATE_REVIEW_CATEGORIES = [
  ["composition", "Composition", "Crop, camera, positions, scale, depth order, facing, spacing, and contact points."],
  ["references", "Reference adherence", "Identity, design, selected angle, detail region, and appearance-only boundaries."],
  ["requirements", "Shot requirements", "Required action, objects, relationships, and exclusions from the shot brief."],
  ["style", "Style", "Rendering treatment, hard style boundaries, period, lighting, and unwanted visual drift."],
  ["cleanliness", "Cleanliness", "Labels, guide marks, contact-sheet panels, duplicates, malformed anatomy, and artifacts."],
];
const CANDIDATE_REVIEW_SEVERITIES = ["pass", "minor", "major", "blocking"];

function normalizeCandidateStructuredReview(row) {
  if (!row || typeof row !== "object") return null;
  const review = row.structuredReview = row.structuredReview && typeof row.structuredReview === "object" ? row.structuredReview : {};
  review.categories = review.categories && typeof review.categories === "object" ? review.categories : {};
  for (const [key] of CANDIDATE_REVIEW_CATEGORIES) {
    const item = review.categories[key] && typeof review.categories[key] === "object" ? review.categories[key] : {};
    item.severity = CANDIDATE_REVIEW_SEVERITIES.includes(item.severity) ? item.severity : "pass";
    item.note = String(item.note || "");
    review.categories[key] = item;
  }
  review.references = Array.isArray(review.references) ? review.references.map((item) => ({
    token: String(item?.token || ""),
    label: String(item?.label || ""),
    severity: CANDIDATE_REVIEW_SEVERITIES.includes(item?.severity) ? item.severity : "pass",
    note: String(item?.note || ""),
  })) : [];
  review.summary = String(review.summary || "");
  review.ai = review.ai && typeof review.ai === "object" ? review.ai : null;
  return review;
}

function candidateSourceBuild(row) {
  if (!row) return null;
  const ids = [
    row.sourceBuildId,
    row.sourcePackageId,
    row.packageSnapshot?.id,
    row.sourcePackageSnapshot?.id,
  ].filter(Boolean);
  for (const id of ids) {
    const canonical = resolvePromptBuild(P, id);
    if (canonical && !canonical.missing) return canonical;
    const byPackage = Object.values(P?.promptBuildsById || {}).find((build) => build?.packageId === id);
    if (byPackage) {
      const resolved = resolvePromptBuild(P, byPackage.id);
      if (resolved && !resolved.missing) return resolved;
    }
  }
  return row.sourcePackageSnapshot || row.packageSnapshot || null;
}

function candidateReviewTake(s, name) {
  return (takesFor(s.id) || []).find((take) => take.name === name) || null;
}

function candidateReviewGuide(s, build = null) {
  const frozen = (build?.references || []).find((ref) => String(ref?.mediaType || "image") === "image" && (ref.role === "composition" || ref.blocking === true) && ref.url);
  if (frozen) return {
    name: frozen.label || frozen.entityName || frozen.file || "Blocking guide",
    file: frozen.file || "",
    url: frozen.url,
    assetId: frozen.assetId || frozen.key || "",
    source: "source-build",
  };
  const row = typeof activeBlockingRow === "function" ? activeBlockingRow(s) : null;
  if (!row) return null;
  return {
    name: row.asset.title || row.asset.originalName || row.asset.file || "Blocking guide",
    file: row.asset.file || "",
    url: mediaAssetUrl(row.asset),
    assetId: row.asset.id,
    source: "active-guide",
  };
}

function candidateReviewReferenceRows(build, review) {
  const saved = new Map((review?.references || []).map((item) => [item.token, item]));
  return (build?.references || [])
    .filter((ref) => String(ref.mediaType || "image") === "image")
    .map((ref, index) => {
      const token = ref.token || `#image${index + 1}`;
      const current = saved.get(token) || {};
      return {
        token,
        label: String(ref.label || ref.entityName || ref.key || ref.role || "Reference"),
        role: String(ref.role || "reference"),
        instruction: String(ref.instruction || ""),
        file: String(ref.file || ""),
        url: String(ref.url || ""),
        severity: CANDIDATE_REVIEW_SEVERITIES.includes(current.severity) ? current.severity : "pass",
        note: String(current.note || ""),
      };
    });
}

function candidateSeverityOptions(selected) {
  const labels = { pass: "Pass", minor: "Minor", major: "Major", blocking: "Blocking" };
  return CANDIDATE_REVIEW_SEVERITIES.map((value) => `<option value="${value}" ${selected === value ? "selected" : ""}>${labels[value]}</option>`).join("");
}

function candidateReviewWorst(review) {
  const order = { pass: 0, minor: 1, major: 2, blocking: 3 };
  const values = [
    ...Object.values(review?.categories || {}).map((item) => item?.severity || "pass"),
    ...(review?.references || []).map((item) => item?.severity || "pass"),
  ];
  return values.sort((a, b) => (order[b] || 0) - (order[a] || 0))[0] || "pass";
}

function candidateReviewSeverityLabel(value) {
  return { pass: "Pass", minor: "Minor", major: "Major", blocking: "Blocking" }[value] || "Pass";
}

function candidateReviewStatusData(review, approved = false) {
  const reviewed = !!(review?.reviewedAt || review?.ai?.reviewedAt);
  const worst = candidateReviewWorst(review);
  if (approved) return { tone: "approved", label: "APPROVED", note: "This frame is complete and ready for the next shot stage." };
  if (!reviewed) return { tone: "pending", label: "REVIEW NEEDED", note: "Open only the checks that need attention, then approve, keep, reject, or build a correction." };
  if (worst === "pass") return { tone: "pass", label: "READY TO APPROVE", note: "Every recorded check passes. The candidate is ready for your approval decision." };
  return { tone: worst, label: `${worst.toUpperCase()} ISSUE`, note: "The review contains a visible issue. Correct it or knowingly accept it before approval." };
}

function candidateCorrectionActivityMarkup(s, frame, row) {
  const buildId = row?.currentCorrectionBuildId || (row?.correctionBuildIds || []).at(-1) || "";
  if (!buildId) return "";
  const build = resolvePromptBuild(P, buildId);
  if (!build || build.missing) return "";
  const job = candidateCorrectionJob(build.id, row.stored || row.name || "");
  const active = typeof falJobActive === "function" && falJobActive(job);
  const status = job ? (typeof falJobStatusLabel === "function" ? falJobStatusLabel(job) : job.status) : "Correction ready";
  return `<section class="candidate-correction-activity ${active ? "active" : job?.status === "COMPLETED" ? "done" : job?.status === "FAILED" ? "failed" : ""}"><div><span>${active ? '<i class="spin">◌</i>' : job?.status === "COMPLETED" ? "✓" : job?.status === "FAILED" ? "!" : "↻"}</span><div><b>${esc(status)}</b><small>${esc(build.packageId || "Correction package")}${job?.error ? ` · ${esc(job.error)}` : ""}</small></div></div><button class="chip" onclick="openCandidateCorrectionModal('${s.id}','${frame?.id || ""}','${attr(row.stored || row.name || "")}','${build.id}')">OPEN CORRECTION</button></section>`;
}

function candidateReviewBadge(row) {
  const review = normalizeCandidateStructuredReview(row);
  if (!review?.reviewedAt && !review?.ai?.reviewedAt) return "";
  const worst = candidateReviewWorst(review);
  const label = worst === "pass" ? "REVIEW PASS" : `${worst.toUpperCase()} ISSUE`;
  return `<span class="candidate-review-badge severity-${attr(worst)}">${esc(label)}</span>`;
}

function candidateReviewEvidence(s, frame, row, build, guide) {
  const referenceRows = candidateReviewReferenceRows(build, normalizeCandidateStructuredReview(row));
  return `<details class="candidate-review-evidence"><summary>Prompt and numbered-reference evidence <span>${referenceRows.length}</span></summary><div class="candidate-review-evidence-body"><div class="candidate-evidence-facts"><span>Shot ${esc(s.id)}</span><span>Frame ${esc(frame?.label || "A")}</span><span>${esc(build?.profileName || build?.profileId || "Source profile not recorded")}</span><span>${esc(build?.packageId || build?.id || "Build not recorded")}</span>${guide ? `<span>Guide: ${esc(guide.name)}</span>` : ""}</div><div class="candidate-evidence-brief"><b>Visible requirement</b><p>${esc(frame?.description || s.desc || "No frame description recorded.")}</p>${s.positioning ? `<p>${esc(s.positioning)}</p>` : ""}</div>${referenceRows.length ? `<div class="candidate-reference-contracts">${referenceRows.map((ref) => `<article><b>${esc(ref.token)} · ${esc(ref.label)}</b><span>${esc(ref.role)}</span><p>${esc(ref.instruction || "No specific reference instruction recorded.")}</p></article>`).join("")}</div>` : `<div class="guided-empty-inline"><b>No frozen numbered-reference list.</b><span>This candidate can still be reviewed against its shot and guide.</span></div>`}${build?.prompt ? `<details><summary>Original compiled prompt</summary><pre>${esc(build.prompt)}</pre></details>` : ""}</div></details>`;
}

function candidateReviewModalMarkup(s, frame, take, row, build, guide) {
  const review = normalizeCandidateStructuredReview(row);
  const refs = candidateReviewReferenceRows(build, review);
  const ai = review.ai;
  const frameIndex = Math.max(0, (s.keyframes || []).findIndex((item) => item.id === frame?.id));
  const approvedName = frame?.winner || (frameIndex === 0 ? s.winner : "");
  const approved = approvedName === take.name;
  const status = candidateReviewStatusData(review, approved);
  const categoryRows = CANDIDATE_REVIEW_CATEGORIES.map(([key, label, help]) => {
    const item = review.categories[key];
    const open = item.severity !== "pass" || !!item.note;
    return `<details class="candidate-rubric-row severity-${attr(item.severity)}" data-review-category="${attr(key)}" ${open ? "open" : ""}><summary><div><b>${esc(label)}</b><small>${esc(help)}</small></div><span id="candidate-review-severity-label-${attr(key)}" class="candidate-severity-pill severity-${attr(item.severity)}">${esc(candidateReviewSeverityLabel(item.severity))}</span></summary><div class="candidate-rubric-editor"><label><span>Rating</span><select id="candidate-review-severity-${attr(key)}" onchange="updateCandidateReviewUI()">${candidateSeverityOptions(item.severity)}</select></label><textarea id="candidate-review-note-${attr(key)}" placeholder="Record only visible, actionable findings." oninput="updateCandidateReviewUI()">${esc(item.note)}</textarea></div></details>`;
  }).join("");
  const referenceRows = refs.length ? refs.map((ref, index) => {
    const open = ref.severity !== "pass" || !!ref.note;
    return `<details class="candidate-reference-review severity-${attr(ref.severity)}" data-review-reference="${index}" ${open ? "open" : ""}><summary><div><b>${esc(ref.token)} · ${esc(ref.label)}</b><small>${esc(ref.role)}${ref.file ? ` · ${esc(ref.file)}` : ""}</small></div><span id="candidate-reference-severity-label-${index}" class="candidate-severity-pill severity-${attr(ref.severity)}">${esc(candidateReviewSeverityLabel(ref.severity))}</span></summary><div class="candidate-reference-editor"><p>${esc(ref.instruction || "No explicit contract recorded.")}</p><label><span>Rating</span><select id="candidate-reference-severity-${index}" onchange="updateCandidateReviewUI()">${candidateSeverityOptions(ref.severity)}</select></label><textarea id="candidate-reference-note-${index}" placeholder="Was this numbered reference followed, ignored, or allowed to donate the wrong composition?" oninput="updateCandidateReviewUI()">${esc(ref.note)}</textarea><input type="hidden" id="candidate-reference-token-${index}" value="${attr(ref.token)}"><input type="hidden" id="candidate-reference-label-${index}" value="${attr(ref.label)}"></div></details>`;
  }).join("") : `<div class="guided-empty-inline"><b>No numbered references to score.</b><span>Review composition, requirements, style, and cleanliness above.</span></div>`;
  const approveButton = approved
    ? `<button class="approve-btn candidate-approved-button" disabled>✓ APPROVED</button>`
    : `<button class="approve-btn" onclick="approveCandidateFromReview()">APPROVE</button>`;
  return `<div class="candidate-review-modal ${approved ? "is-approved" : ""}"><header class="candidate-review-title"><div><span>FRAME ${esc(frame?.label || "A")} · CANDIDATE REVIEW</span><h3>${esc(take.name)}</h3><p>Compare the image, record only visible issues, then make the decision.</p></div><div class="candidate-review-title-actions"><span class="candidate-review-head-status state-${attr(status.tone)}">${esc(status.label)}</span><button class="cancel" onclick="closeModal()">Close</button></div></header>${approved ? `<section class="candidate-review-complete"><i>✓</i><div><b>Frame ${esc(frame?.label || "A")} is approved</b><span>This review is complete. Close the dialog and follow the green Next Action card to continue.</span></div></section>` : ""}<div class="candidate-review-layout"><section class="candidate-review-visual"><div class="candidate-review-view-buttons"><button class="chip on" data-candidate-review-view="candidate" onclick="setCandidateReviewView('candidate',this)">Candidate</button>${guide ? `<button class="chip" data-candidate-review-view="guide" onclick="setCandidateReviewView('guide',this)">Guide</button><button class="chip" data-candidate-review-view="side" onclick="setCandidateReviewView('side',this)">Side by side</button><button class="chip" data-candidate-review-view="overlay" onclick="setCandidateReviewView('overlay',this)">Overlay</button>` : ""}</div><div id="candidate-review-stage" class="candidate-review-stage view-candidate"><figure class="candidate-layer candidate-result"><img src="${attr(take.url)}" alt="Candidate image"><figcaption>Candidate</figcaption></figure>${guide ? `<figure class="candidate-layer candidate-guide"><img src="${attr(guide.url)}" alt="Blocking guide"><figcaption>${esc(guide.name)}</figcaption></figure>` : ""}</div>${guide ? `<label class="candidate-overlay-control"><span>Guide opacity</span><input id="candidate-guide-opacity" type="range" min="0" max="100" value="50" oninput="setCandidateGuideOpacity(this.value)"><output id="candidate-guide-opacity-output">50%</output></label>` : `<div class="candidate-no-guide">No active blocking guide. Composition review uses the written frame requirement.</div>`}${candidateReviewEvidence(s, frame, row, build, guide)}</section><section class="candidate-review-form"><section id="candidate-review-readiness" class="candidate-review-readiness state-${attr(status.tone)}"><i class="assistant-mood" aria-hidden="true"><span class="assistant-eye left"></span><span class="assistant-eye right"></span><span class="assistant-mouth"></span></i><div><span>ASSISTANT READ</span><b id="candidate-review-readiness-label">${esc(status.label)}</b><small id="candidate-review-readiness-note">${esc(status.note)}</small></div></section><details class="candidate-review-rubric" open><summary><div><span>STRUCTURED RUBRIC</span><b>Open only the categories that need notes</b></div><span>${CANDIDATE_REVIEW_CATEGORIES.length}</span></summary>${categoryRows}</details><details class="candidate-reference-review-section"><summary>Numbered-reference diagnosis <span>${refs.length}</span></summary><div class="candidate-reference-review-body">${referenceRows}</div></details>${ai ? `<details class="candidate-structured-ai"><summary><b>Assistant review</b><span>${esc(String(ai.recommendation || "review").toUpperCase())}</span></summary><div class="candidate-structured-ai-body"><p>${esc(ai.summary || "")}</p>${Object.entries(ai.categories || {}).map(([key, item]) => `<div><b>${esc(key.replace(/([A-Z])/g, " $1"))} · ${esc(String(item.severity || "pass").toUpperCase())}</b><span>${esc(item.note || "")}</span></div>`).join("")}</div></details>` : ""}<details class="candidate-review-summary" ${review.summary ? "open" : ""}><summary>Director summary <span>${review.summary ? "Added" : "Optional"}</span></summary><textarea id="candidate-review-summary" placeholder="What works, what fails, and what a correction must preserve.">${esc(review.summary)}</textarea></details></section></div>${candidateCorrectionActivityMarkup(s, frame, row)}<footer class="candidate-review-actions"><div class="candidate-review-tools"><button class="ghost-btn" onclick="runCandidateStructuredVisionReview('${s.id}','${frame?.id || ""}','${attr(take.name)}')"${aiDisabledAttrs("vision")}>AI REVIEW</button><button class="changes-btn" onclick="buildCandidateCorrectionPrompt()">BUILD CORRECTION</button><details class="candidate-review-more"><summary>More</summary><div><button class="ghost-btn" onclick="saveCandidateStructuredReview(false)">SAVE REVIEW</button>${build?.id ? `<button class="chip" onclick="pinCandidateSourceBuild('${s.id}','${attr(take.name)}')">PIN SOURCE BUILD</button><button class="chip" onclick="viewCandidateSourceBuild('${s.id}','${attr(take.name)}')">VIEW SOURCE BUILD</button>` : ""}${(guidedFrameCandidateRows(s, frame, takesFor(s.id), guidedFrames(s).findIndex((item) => item.id === frame?.id)) || []).length > 1 ? `<button class="chip" onclick="chooseCandidateComparison('${s.id}','${frame?.id || ""}','${attr(take.name)}')">COMPARE</button>` : ""}</div></details></div><div class="candidate-review-decisions"><button class="chip" onclick="setCandidateReviewOutcome('alternate')">KEEP AS ALTERNATE</button><button class="chip danger" onclick="setCandidateReviewOutcome('rejected')">REJECT</button>${approveButton}</div></footer></div>`;
}

window.openCandidateReview = (shotId, frameId, name) => {
  const s = shotById(shotId);
  if (!s) return;
  const frame = frameById(s, frameId) || (s.keyframes || [])[0] || null;
  const take = candidateReviewTake(s, name);
  if (!take) return toast("Candidate file is unavailable");
  const row = candidateRecord(s, name, true);
  normalizeCandidateStructuredReview(row);
  const build = candidateSourceBuild(row);
  const guide = candidateReviewGuide(s, build);
  window._candidateReviewDraft = { shotId, frameId: frame?.id || frameId || "", name };
  openModal(candidateReviewModalMarkup(s, frame, take, row, build, guide));
};

window.updateCandidateReviewUI = () => {
  const order = { pass: 0, minor: 1, major: 2, blocking: 3 };
  let worst = "pass";
  const updateRow = (select, label, row) => {
    const value = CANDIDATE_REVIEW_SEVERITIES.includes(select?.value) ? select.value : "pass";
    if ((order[value] || 0) > (order[worst] || 0)) worst = value;
    if (label) {
      label.textContent = candidateReviewSeverityLabel(value);
      label.className = `candidate-severity-pill severity-${value}`;
    }
    if (row) row.className = row.className.replace(/\s*severity-(pass|minor|major|blocking)\b/g, "") + ` severity-${value}`;
  };
  for (const [key] of CANDIDATE_REVIEW_CATEGORIES) {
    updateRow(
      document.getElementById(`candidate-review-severity-${key}`),
      document.getElementById(`candidate-review-severity-label-${key}`),
      document.querySelector(`[data-review-category="${key}"]`),
    );
  }
  document.querySelectorAll("[data-review-reference]").forEach((row) => {
    const index = row.dataset.reviewReference;
    updateRow(
      document.getElementById(`candidate-reference-severity-${index}`),
      document.getElementById(`candidate-reference-severity-label-${index}`),
      row,
    );
  });
  const approved = !!document.querySelector(".candidate-review-modal.is-approved");
  const status = approved
    ? { tone: "approved", label: "APPROVED", note: "This frame is complete and ready for the next shot stage." }
    : worst === "pass"
      ? { tone: "pass", label: "READY TO APPROVE", note: "Every current check passes. Save the review or approve the candidate." }
      : { tone: worst, label: `${worst.toUpperCase()} ISSUE`, note: "The review contains a visible issue. Correct it or knowingly accept it before approval." };
  const readiness = document.getElementById("candidate-review-readiness");
  if (readiness) readiness.className = `candidate-review-readiness state-${status.tone}`;
  const label = document.getElementById("candidate-review-readiness-label");
  if (label) label.textContent = status.label;
  const note = document.getElementById("candidate-review-readiness-note");
  if (note) note.textContent = status.note;
  const head = document.querySelector(".candidate-review-head-status");
  if (head && !approved) {
    head.className = `candidate-review-head-status state-${status.tone}`;
    head.textContent = status.label;
  }
};

window.setCandidateReviewView = (mode, button) => {
  const stage = document.getElementById("candidate-review-stage");
  if (!stage) return;
  stage.className = `candidate-review-stage view-${mode}`;
  document.querySelectorAll("[data-candidate-review-view]").forEach((item) => item.classList.toggle("on", item === button));
};

window.setCandidateGuideOpacity = (value) => {
  const stage = document.getElementById("candidate-review-stage"), output = document.getElementById("candidate-guide-opacity-output");
  if (stage) stage.style.setProperty("--guide-opacity", Math.max(0, Math.min(100, Number(value) || 0)) / 100);
  if (output) output.textContent = `${Math.round(Number(value) || 0)}%`;
};

window.saveCandidateStructuredReview = (closeAfter = true) => {
  const draft = window._candidateReviewDraft || {};
  const s = shotById(draft.shotId), row = s ? candidateRecord(s, draft.name, true) : null;
  if (!row) return null;
  const review = normalizeCandidateStructuredReview(row);
  for (const [key] of CANDIDATE_REVIEW_CATEGORIES) {
    review.categories[key] = {
      severity: document.getElementById(`candidate-review-severity-${key}`)?.value || "pass",
      note: document.getElementById(`candidate-review-note-${key}`)?.value.trim() || "",
    };
  }
  review.references = [...document.querySelectorAll("[data-review-reference]")].map((node) => {
    const index = node.dataset.reviewReference;
    return {
      token: document.getElementById(`candidate-reference-token-${index}`)?.value || "",
      label: document.getElementById(`candidate-reference-label-${index}`)?.value || "",
      severity: document.getElementById(`candidate-reference-severity-${index}`)?.value || "pass",
      note: document.getElementById(`candidate-reference-note-${index}`)?.value.trim() || "",
    };
  });
  review.summary = document.getElementById("candidate-review-summary")?.value.trim() || "";
  review.reviewedAt = new Date().toISOString();
  row.reviewedAt = review.reviewedAt;
  dirty();
  if (closeAfter) { closeModal(); route(); toast("Candidate review saved"); }
  return review;
};

window.setCandidateReviewOutcome = (outcome) => {
  const draft = window._candidateReviewDraft || {}, s = shotById(draft.shotId), row = s ? candidateRecord(s, draft.name, true) : null;
  if (!row) return;
  saveCandidateStructuredReview(false);
  row.decision = outcome === "alternate" ? "shortlist" : "rejected";
  row.reviewedAt = new Date().toISOString();
  dirty();
  closeModal();
  route();
  toast(outcome === "alternate" ? "Candidate kept as an alternate" : "Candidate rejected");
};

window.approveCandidateFromReview = () => {
  const draft = window._candidateReviewDraft || {};
  saveCandidateStructuredReview(false);
  closeModal();
  if (draft.frameId && typeof approveGuidedFrame === "function") approveGuidedFrame(draft.shotId, draft.frameId, draft.name);
  else approveTake(draft.shotId, draft.name);
};

function candidateCorrectionIssues(review) {
  const issues = [];
  for (const [key, label] of CANDIDATE_REVIEW_CATEGORIES) {
    const item = review?.categories?.[key];
    if (item && item.severity !== "pass") issues.push({ kind: key, label, severity: item.severity, note: item.note });
  }
  for (const item of review?.references || []) if (item.severity !== "pass") issues.push({ kind: "reference", label: item.token, severity: item.severity, note: item.note, referenceLabel: item.label });
  if (!issues.length && review?.ai) {
    for (const [key, item] of Object.entries(review.ai.categories || {})) if (item?.severity && item.severity !== "pass") issues.push({ kind: key, label: key, severity: item.severity, note: item.note || "" });
    for (const item of review.ai.references || []) if (item?.severity && item.severity !== "pass") issues.push({ kind: "reference", label: item.token || item.image || "reference", severity: item.severity, note: item.note || "", referenceLabel: item.label || "" });
  }
  return issues;
}

function candidateCorrectionInstruction(issue) {
  const note = issue.note ? ` ${issue.note.replace(/\s+/g, " ").trim()}` : "";
  if (issue.kind === "composition") return `Restore the blocking guide's crop, camera, broad staged positions, relative scale, depth order, facing, overlap, spacing, and contact points. Treat the guide as geometry only; do not copy its architecture, fence or gate pattern, terrain, set dressing, materials, colour, texture, lighting, or finished style.${note}`;
  if (issue.kind === "references") return `Correct identity and design using only the assigned numbered appearance references; do not inherit their source framing, background, pose, or scale-in-frame.${note}`;
  if (issue.kind === "requirements") return `Restore every required object, relationship, action-readable pose, environment requirement, and exclusion from the shot brief without adding new story content.${note}`;
  if (issue.kind === "style") return `Correct the assigned rendering treatment and preserve hard style boundaries without blending, photorealistic drift, or unrequested lighting changes.${note}`;
  if (issue.kind === "cleanliness") return `Remove labels, guide marks, contact-sheet panels, duplicates, malformed geometry, and visible generation artifacts while preserving unaffected approved regions.${note}`;
  return `${issue.label}${issue.referenceLabel ? ` (${issue.referenceLabel})` : ""}: correct only the recorded reference failure.${note}`;
}

function candidateCorrectionIsLocationReference(ref) {
  const text = [ref?.role, ref?.sourceType, ref?.referenceKind, ref?.label, ref?.entityName].filter(Boolean).join(" ");
  return /\b(location|environment|background|set|plate|architecture|terrain|interior|exterior)\b/i.test(text);
}

function candidateCorrectionNeedsLocationAuthority(issues, build) {
  const refs = build?.references || [];
  return issues.some((issue) => {
    if (issue.kind === "reference") {
      const ref = refs.find((item, index) => (item.token || `#image${index + 1}`) === issue.label);
      if (candidateCorrectionIsLocationReference(ref)) return true;
    }
    return /\b(background|environment|location|architecture|fence|gate|terrain|set dressing|window|door|surface|material|lighting)\b/i.test(`${issue.label || ""} ${issue.note || ""}`);
  });
}

function candidateCorrectionReferenceInstruction(ref) {
  const original = String(ref?.instruction || "").trim();
  if (candidateCorrectionIsLocationReference(ref)) {
    return `Location-design authority only. Reconstruct the finished architecture, fence or gate design, terrain, background arrangement, surfaces, set dressing, materials, colour, texture, and lighting from this reference. Do not copy its camera framing. ${original}`.trim();
  }
  if (/\b(prop|vehicle|object)\b/i.test(`${ref?.role || ""} ${ref?.sourceType || ""}`)) {
    return `Object-design authority only. Preserve the assigned prop or vehicle design and details without copying the source composition, background, pose, or scale-in-frame. ${original}`.trim();
  }
  return `Identity and appearance authority only. Preserve the assigned character or subject design without copying the source framing, background, pose, or scale-in-frame. ${original}`.trim();
}

function candidateCorrectionPackage(s, frame, take, row, review) {
  const build = candidateSourceBuild(row) || {};
  const guide = candidateReviewGuide(s, build);
  const issues = candidateCorrectionIssues(review);
  if (!issues.length) return null;
  const originalRefs = Array.isArray(build.references) ? build.references : [];
  const maxRecovered = guide ? 14 : 15;
  const omittedRefs = originalRefs.filter((ref) => String(ref?.mediaType || "image") === "image" && ref.role !== "composition" && ref.url !== guide?.url && !ref.url);
  const sourceRefs = originalRefs
    .filter((ref) => String(ref?.mediaType || "image") === "image" && ref.role !== "composition" && ref.url !== guide?.url && ref.url)
    .slice(0, maxRecovered);
  const baseCount = guide ? 2 : 1;
  const referenceTokenMap = new Map();
  const correctionSourceRefs = sourceRefs.map((ref, index) => {
    const originalToken = ref.token || `#image${originalRefs.indexOf(ref) + 1}`;
    const correctionToken = `#image${baseCount + index + 1}`;
    referenceTokenMap.set(originalToken, correctionToken);
    return { ...ref, originalToken, correctionToken, instruction: candidateCorrectionReferenceInstruction(ref) };
  });
  const refs = [
    { key: `candidate:${s.id}:${take.name}`, label: `Candidate to correct — ${take.name}`, file: take.name, url: take.url, role: "base", mediaType: "image", instruction: "Editable base. Preserve only unaffected regions and details that the review explicitly marked as passing." },
    ...(guide ? [{ key: `guide:${guide.assetId || frame.id}`, label: guide.name, file: guide.file, url: guide.url, role: "composition", mediaType: "image", instruction: "Geometry only: crop, camera, horizon, broad placement, relative scale, depth order, facing, overlap, spacing, and contact points. It supplies no finished environment or appearance design." }] : []),
    ...correctionSourceRefs,
  ];
  const legend = refs.map((ref, index) => `#image${index + 1} — ${ref.label}${ref.originalToken ? ` (original ${ref.originalToken})` : ""}: ${ref.instruction || "Use only for its assigned visual role."}`).join("\n");
  const remappedIssues = issues.map((issue) => issue.kind === "reference" && referenceTokenMap.has(issue.label)
    ? { ...issue, label: `${referenceTokenMap.get(issue.label)} (original ${issue.label})` }
    : issue);
  const failed = remappedIssues.map((issue) => `- [${issue.severity.toUpperCase()}] ${candidateCorrectionInstruction(issue)}`).join("\n");
  const failedKinds = new Set(issues.map((issue) => issue.kind));
  const passed = CANDIDATE_REVIEW_CATEGORIES
    .filter(([key]) => review.categories?.[key]?.severity === "pass" && !failedKinds.has(key))
    .map(([, label]) => label.toLowerCase());
  const needsLocation = candidateCorrectionNeedsLocationAuthority(issues, build);
  const hasLocation = correctionSourceRefs.some(candidateCorrectionIsLocationReference);
  const warnings = [];
  if (!build.id && !build.packageId) warnings.push("The original canonical production build could not be resolved. Only references still attached to this candidate can be recovered.");
  if (omittedRefs.length) warnings.push(`${omittedRefs.length} original image reference${omittedRefs.length === 1 ? " has" : "s have"} no usable URL and cannot be submitted to FAL.`);
  if (originalRefs.length > maxRecovered + (guide ? 1 : 0)) warnings.push("The original package exceeds FAL's 16-image limit; the earliest ordered appearance references were retained.");
  if (needsLocation && !hasLocation) warnings.push("This correction mentions the background or environment, but the recovered package has no usable approved location authority. Add or restore a location reference before relying on the result.");
  const preserveLine = passed.length
    ? `Preserve only the candidate regions that passed ${passed.join(", ")}; keep unaffected pixels and relationships stable without reinterpreting them.`
    : "Preserve only unaffected regions and successful details from #image1.";
  const environmentReplacement = needsLocation
    ? `\nDo not preserve an incorrect background merely because it exists in #image1. Replace failed environment regions from the approved location-design reference${hasLocation ? "s" : " package when available"}, while retaining only the guide's geometry.`
    : "";
  const guideRule = guide
    ? " Use #image2 only as the authoritative geometry scaffold. Do not widen, zoom out, reframe, reveal more of the scene, or inherit architecture, fence spacing, gate patterns, terrain details, set dressing, materials, colour, texture, lighting, labels, or finished style from it."
    : " Preserve the current crop unless a correction below explicitly changes it.";
  const prompt = `REFERENCE ASSIGNMENT\n${legend}\n\nCORRECT THE EXISTING FRAME\nEdit #image1 rather than creating a new composition.${guideRule}\n\nCORRECTIONS\n${failed}\n\nPRESERVE\n${preserveLine}${environmentReplacement}\nPreserve the original aspect ratio and return one clean production frame. Do not add labels, guide marks, split panels, comparison layouts, or explanatory text.`;
  const state = guidedFrameState(s, frame, guidedFrames(s).findIndex((item) => item.id === frame.id));
  const revision = resolvePromptBuildList(P, state.promptBuilds || []).length + 1;
  const now = new Date().toISOString();
  const id = `${s.id}-${frame.id}-correction-${Date.now().toString(36)}`;
  return {
    id,
    packageId: `${s.id}-${frame.label || "A"}-CORRECTION-R${String(revision).padStart(2, "0")}`,
    kind: "candidate-correction",
    scope: `frame:${frame.id}`,
    frameId: frame.id,
    frameLabel: frame.label || "A",
    sourceCandidate: take.name,
    parentBuildId: build.id || row.sourceBuildId || "",
    parentPackageId: build.packageId || row.sourcePackageLabel || row.sourcePackageId || "",
    profileId: build.profileId || state.profileId || "",
    profileName: build.profileName || build.profileId || "Correction prompt",
    prompt,
    references: refs,
    reviewSnapshot: cloneJSON(review),
    correctionWarnings: warnings,
    guideAssetId: guide?.assetId || "",
    guideSource: guide?.source || "",
    recoveredReferenceCount: correctionSourceRefs.length,
    productionRisks: build.productionRisks || s.risks || [],
    date: now,
    immutableAt: now,
    revision,
    revisionReason: "candidate-correction",
  };
}

function registerCandidateCorrectionBuild(s, frame, row, build) {
  const buildId = registerPromptBuild(P, build);
  const state = guidedFrameState(s, frame, guidedFrames(s).findIndex((item) => item.id === frame.id));
  const add = (list) => {
    const exists = (list || []).some((entry) => (entry?.buildId || entry) === buildId);
    if (!exists) list.push(promptBuildRef(buildId, { kind: "candidate-correction", scope: `frame:${frame.id}`, revisionReason: "candidate-correction" }));
  };
  state.promptBuilds = Array.isArray(state.promptBuilds) ? state.promptBuilds : [];
  add(state.promptBuilds);
  frame.generationPackages = Array.isArray(frame.generationPackages) ? frame.generationPackages : [];
  add(frame.generationPackages);
  s.generationPackages = Array.isArray(s.generationPackages) ? s.generationPackages : [];
  add(s.generationPackages);
  row.correctionBuildIds = Array.isArray(row.correctionBuildIds) ? row.correctionBuildIds : [];
  if (!row.correctionBuildIds.includes(buildId)) row.correctionBuildIds.push(buildId);
  row.currentCorrectionBuildId = buildId;
  applyPromptBuildRetention(P);
  dirty();
  return buildId;
}


function frameSequenceCorrectionRows(s) {
  return typeof guidedFrameSequenceInputs === "function" ? guidedFrameSequenceInputs(s) : [];
}
function frameSequenceCorrectionDefaultTarget(s) {
  const rows = frameSequenceCorrectionRows(s);
  return rows.at(-1) || rows[1] || rows[0] || null;
}
function frameSequenceCorrectionIssueText(review) {
  const categories = Object.entries(review?.categories || {})
    .filter(([, row]) => Number(row?.score || 0) < 80 || String(row?.note || "").trim())
    .map(([key, row]) => `${key.replace(/([A-Z])/g, " $1")}: ${row?.note || "Continuity mismatch."}`);
  return [...(review?.blockingIssues || []), ...categories, review?.nextAction || ""].filter(Boolean).join("\n");
}
function frameSequenceCorrectionLockRows(review) {
  const labels = {
    camera: "Camera, crop, lens and framing",
    environment: "Environment geometry and fixed architecture",
    lighting: "Background practical lights and baseline exposure",
    character: "Character identity, scale, wardrobe and screen position",
    props: "Unchanged props, console construction and embedded details",
  };
  return Object.entries(labels).map(([key, label]) => ({
    key,
    label,
    checked: true,
    note: review?.categories?.[key]?.note || "Preserve this category unless the intended delta explicitly changes it.",
  }));
}
window.openFrameSequenceCorrection = (shotId) => {
  const s = shotById(shotId);
  const review = s ? ensureShotCreation(s).frameSequenceReview : null;
  const rows = s ? frameSequenceCorrectionRows(s) : [];
  if (!s || rows.length < 2 || !review || review.pass) return toast("A failed approved frame sequence is required");
  const defaultAnchor = rows[0];
  const defaultTarget = frameSequenceCorrectionDefaultTarget(s);
  const locks = frameSequenceCorrectionLockRows(review);
  window._frameSequenceCorrection = { shotId, anchorFrameId: defaultAnchor.frame.id, targetFrameId: defaultTarget.frame.id };
  const options = rows.map((row) => `<option value="${attr(row.frame.id)}">Frame ${esc(row.frame.label)} · ${esc(row.frame.title || row.approved.name)}</option>`).join("");
  const previews = rows.map((row) => `<button type="button" class="frame-sequence-correction-preview" data-correction-frame-id="${attr(row.frame.id)}" onclick="openMediaTheatre('${attr(encodeURIComponent(row.approved.url))}','${attr(encodeURIComponent(`Frame ${row.frame.label} · ${row.approved.name}`))}','image')"><img src="${attr(row.approved.url)}" alt="Frame ${esc(row.frame.label)}"><span>Frame ${esc(row.frame.label)}</span><i data-correction-role></i></button>`).join("");
  const intended = String(defaultTarget.frame.description || defaultTarget.frame.title || s.desc || "").trim();
  openModal(`<div class="frame-sequence-correction-modal">
    <header class="frame-sequence-correction-head"><div><span>FRAME-SEQUENCE CORRECTION</span><h3>Fix continuity — ${esc(s.id)}</h3><p>Repair one approved frame without losing the original. CineBraid turns the failed review into preservation locks and builds a new editable correction prompt.</p></div><button class="cancel" onclick="closeModal()">Close</button></header>
    <section class="frame-sequence-correction-overview" aria-label="Correction workflow">
      <article class="is-user"><i>1</i><div><span>YOU CHOOSE</span><b>Anchor and repair frame</b><small>Select the trusted frame and the approved frame that needs correction.</small></div></article>
      <article class="is-user"><i>2</i><div><span>YOU EDIT</span><b>Intended change only</b><small>Describe only what should differ between the two frames.</small></div></article>
      <article class="is-auto"><i>3</i><div><span>CINEBRAID AUTOMATES</span><b>Correction package</b><small>Review findings become locked constraints and a new editable prompt. No paid request is submitted yet.</small></div></article>
    </section>
    <div class="frame-sequence-correction-scroll">
      <section class="frame-sequence-correction-section">
        <header><span>STEP 1 · YOU CHOOSE</span><b>Define the stable truth and the frame to repair</b></header>
        <div class="frame-sequence-correction-previews">${previews}</div>
        <div class="two-col frame-sequence-correction-targets"><label><span>Structural anchor</span><select id="sequence-correction-anchor" onchange="updateFrameSequenceCorrectionSummary()">${options}</select><small>The frame whose camera, geometry and unchanged details must win.</small></label><label><span>Frame to repair</span><select id="sequence-correction-target" onchange="updateFrameSequenceCorrectionSummary()">${options}</select><small>This approved image becomes the editable base. The current approval remains preserved until a replacement is approved.</small></label></div>
        <div id="sequence-correction-plan-summary" class="frame-sequence-correction-plan-summary" aria-live="polite"></div>
      </section>
      <section class="frame-sequence-correction-section">
        <header><span>STEP 2 · YOU EDIT</span><b>Confirm the only intended visual change</b></header>
        <label class="frame-sequence-correction-delta"><span>Intended change only</span><textarea id="sequence-correction-delta" placeholder="Describe only what should change between the anchor and target frame.">${esc(intended)}</textarea><small>Everything not named here remains locked. Edit this text before building the correction.</small></label>
        <label class="frame-sequence-correction-note"><span>Optional surgical direction</span><textarea id="sequence-correction-note" placeholder="Example: preserve the exact background practical lights and tunnel curve; change only the core activation and hand release."></textarea><small>This is added to the correction prompt as a director note.</small></label>
      </section>
      <section class="frame-sequence-correction-section is-automated">
        <header><span>STEP 3 · AUTO-FILLED BY CINEBRAID</span><b>Review the continuity locks created from the failed analysis</b><small>These are selected automatically. Uncheck a category only when the intended progression truly changes it.</small></header>
        <div class="frame-sequence-locks">${locks.map((row) => `<label><input type="checkbox" id="sequence-lock-${attr(row.key)}" ${row.checked ? "checked" : ""}><span><b>${esc(row.label)}</b><small>${esc(row.note)}</small></span></label>`).join("")}</div>
        <details class="frame-sequence-correction-findings"><summary>Read-only review evidence <span>Used automatically</span></summary><pre>${esc(frameSequenceCorrectionIssueText(review))}</pre></details>
      </section>
      <section class="frame-sequence-correction-alternatives">
        <header><span>OTHER WAYS TO FIX IT</span><b>Skip generation when you already have a better frame</b></header>
        <div><button class="ghost-btn" onclick="prepareFrameSequenceCorrectionUpload('${attr(shotId)}')">UPLOAD CORRECTED IMAGE</button><button class="ghost-btn" onclick="chooseFrameSequenceCorrectionCandidate('${attr(shotId)}')">CHOOSE EXISTING CANDIDATE</button><button class="chip" onclick="acceptFrameSequenceDifference('${attr(shotId)}')">MARK DIFFERENCE INTENTIONAL</button></div>
        <small>Marking a difference intentional adds it to the written progression and reruns review; it does not silently bypass continuity validation.</small>
      </section>
    </div>
    <footer class="frame-sequence-correction-actions"><div><small>Next: CineBraid creates a new editable correction prompt and opens the generation review screen.</small><button class="cancel" onclick="closeModal()">Cancel</button></div><button class="approve-btn large" onclick="buildFrameSequenceCorrection('${attr(shotId)}')">BUILD EDITABLE CORRECTION PROMPT</button></footer>
  </div>`);
  const anchor = document.getElementById("sequence-correction-anchor");
  const target = document.getElementById("sequence-correction-target");
  if (anchor) anchor.value = defaultAnchor.frame.id;
  if (target) target.value = defaultTarget.frame.id;
  updateFrameSequenceCorrectionSummary();
};
window.updateFrameSequenceCorrectionSummary = () => {
  const anchor = document.getElementById("sequence-correction-anchor");
  const target = document.getElementById("sequence-correction-target");
  const summary = document.getElementById("sequence-correction-plan-summary");
  if (!anchor || !target || !summary) return;
  const anchorLabel = anchor.selectedOptions?.[0]?.textContent || "Anchor frame";
  const targetLabel = target.selectedOptions?.[0]?.textContent || "Repair frame";
  const same = anchor.value === target.value;
  summary.classList.toggle("state-error", same);
  summary.innerHTML = same
    ? `<b>Choose two different frames.</b><span>The anchor cannot also be the editable repair target.</span>`
    : `<article><span>PRESERVE FROM</span><b>${esc(anchorLabel)}</b></article><i>→</i><article><span>EDIT THIS FRAME</span><b>${esc(targetLabel)}</b></article>`;
  document.querySelectorAll("[data-correction-frame-id]").forEach((button) => {
    const id = button.dataset.correctionFrameId;
    const role = button.querySelector("[data-correction-role]");
    button.classList.toggle("is-anchor", id === anchor.value);
    button.classList.toggle("is-target", id === target.value);
    if (role) role.textContent = id === anchor.value ? "ANCHOR" : id === target.value ? "REPAIR" : "";
  });
};
function frameSequenceSelectedTarget(shotId) {
  const s = shotById(shotId);
  const rows = s ? frameSequenceCorrectionRows(s) : [];
  const targetId = document.getElementById("sequence-correction-target")?.value || window._frameSequenceCorrection?.targetFrameId || rows.at(-1)?.frame.id || "";
  return { s, rows, target: rows.find((row) => row.frame.id === targetId) || rows.at(-1) || null };
}
window.prepareFrameSequenceCorrectionUpload = (shotId) => {
  const { s, target } = frameSequenceSelectedTarget(shotId);
  if (!s || !target) return toast("Choose a frame to repair");
  closeModal();
  boundedWriteState?.("selected:shot-frame", s.id, target.frame.id);
  ensureShotCreation(s).activeGuidedFrameId = target.frame.id;
  route();
  setTimeout(() => {
    document.querySelector(`[data-frame-id="${CSS.escape(target.frame.id)}"]`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    document.getElementById(`frame-file-${target.frame.id}`)?.click?.();
  }, 120);
};
window.chooseFrameSequenceCorrectionCandidate = (shotId) => {
  const { s, target } = frameSequenceSelectedTarget(shotId);
  if (!s || !target) return toast("Choose a frame to repair");
  closeModal();
  boundedWriteState?.("selected:shot-frame", s.id, target.frame.id);
  ensureShotCreation(s).activeGuidedFrameId = target.frame.id;
  route();
  setTimeout(() => document.querySelector(`[data-frame-id="${CSS.escape(target.frame.id)}"] .guided-frame-return`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 120);
};
function frameSequenceCorrectionPackage(s, anchor, target, review, intendedDelta, locks, note) {
  const row = candidateRecord(s, target.approved.name, true);
  const frameIndex = guidedFrames(s).findIndex((item) => item.id === target.frame.id);
  const state = guidedFrameState(s, target.frame, frameIndex);
  const sourceBuild = resolvePromptBuildList(P, state.promptBuilds || []).at(-1) || {};
  const refs = [
    { key: `sequence-target:${target.frame.id}`, token: "#image1", label: `Frame ${target.frame.label} current approved target`, role: "base", url: target.approved.url, instruction: "Editable target frame. Change only the confirmed intended progression." },
    { key: `sequence-anchor:${anchor.frame.id}`, token: "#image2", label: `Frame ${anchor.frame.label} structural continuity anchor`, role: "continuity-authority", url: anchor.approved.url, instruction: "Authoritative camera, crop, environment geometry, fixed lighting, scale and unchanged continuity reference." },
  ];
  for (const ref of sourceBuild.references || []) {
    if (!ref?.url || refs.some((item) => item.url === ref.url) || refs.length >= 16) continue;
    refs.push({ ...cloneJSON(ref), token: `#image${refs.length + 1}` });
  }
  const lockText = locks.length ? locks.join("\n- ") : "All unmentioned visual content";
  const findings = frameSequenceCorrectionIssueText(review);
  const prompt = `FRAME-SEQUENCE CONTINUITY CORRECTION\n\nREFERENCE CONTRACT\n#image1 is the editable approved target frame.\n#image2 is the structural continuity authority from the same shot. It controls camera, crop, environment geometry, unchanged lighting, character scale and unchanged prop placement.\n${refs.slice(2).map((ref, index) => `#image${index + 3} supplies only ${ref.role || "its assigned approved reference role"}: ${ref.label || ref.key || "reference"}.`).join("\n")}\n\nINTENDED PROGRESSION — CHANGE ONLY\n${intendedDelta || target.frame.description || "Apply only the target frame's written state change."}\n\nLOCK AND PRESERVE\n- ${lockText}\n- Preserve every unmentioned pixel relationship and production detail as closely as the model permits.\n- Do not mirror, reframe, redesign, relight, replace architecture, add practical lights, or shift subject scale unless explicitly named in the intended progression.\n\nREVIEW FINDINGS TO CORRECT\n${findings || "Correct the failed pair-continuity findings."}${note ? `\n\nDIRECTOR NOTE\n${note}` : ""}\n\nOUTPUT\nReturn one corrected clean production frame at the exact source aspect ratio. It must read as the next moment of #image2, not a reimagined shot.`;
  const now = new Date().toISOString();
  const revision = resolvePromptBuildList(P, state.promptBuilds || []).length + 1;
  return {
    id: `${s.id}-${target.frame.id}-sequence-correction-${Date.now().toString(36)}`,
    packageId: `${s.id}-${target.frame.label || "B"}-SEQUENCE-CORRECTION-R${String(revision).padStart(2, "0")}`,
    kind: "candidate-correction",
    scope: `frame:${target.frame.id}`,
    frameId: target.frame.id,
    frameLabel: target.frame.label || "B",
    sourceCandidate: target.approved.name,
    parentBuildId: sourceBuild.id || row.sourceBuildId || "",
    parentPackageId: sourceBuild.packageId || row.sourcePackageLabel || row.sourcePackageId || "",
    profileId: sourceBuild.profileId || state.profileId || "gpt-image-2/edit",
    profileName: sourceBuild.profileName || sourceBuild.profileId || "Sequence continuity correction",
    prompt,
    references: refs,
    reviewSnapshot: cloneJSON(review),
    correctionWarnings: [],
    sequenceAnchorFrameId: anchor.frame.id,
    sequenceAnchorFile: anchor.approved.name,
    sequenceTargetFrameId: target.frame.id,
    intendedDelta,
    lockedCategories: locks,
    date: now,
    immutableAt: now,
    revision,
    revisionReason: "frame-sequence-continuity-correction",
  };
}
window.buildFrameSequenceCorrection = (shotId) => {
  const s = shotById(shotId);
  const rows = s ? frameSequenceCorrectionRows(s) : [];
  const review = s ? ensureShotCreation(s).frameSequenceReview : null;
  const anchorId = document.getElementById("sequence-correction-anchor")?.value || rows[0]?.frame.id || "";
  const targetId = document.getElementById("sequence-correction-target")?.value || rows.at(-1)?.frame.id || "";
  const anchor = rows.find((row) => row.frame.id === anchorId);
  const target = rows.find((row) => row.frame.id === targetId);
  if (!s || !review || review.pass || !anchor || !target || anchor.frame.id === target.frame.id) return toast("Choose different anchor and repair frames");
  const intendedDelta = String(document.getElementById("sequence-correction-delta")?.value || "").trim();
  if (!intendedDelta) return toast("Describe the intended frame progression first");
  const locks = frameSequenceCorrectionLockRows(review).filter((row) => document.getElementById(`sequence-lock-${row.key}`)?.checked).map((row) => row.label);
  const note = String(document.getElementById("sequence-correction-note")?.value || "").trim();
  const row = candidateRecord(s, target.approved.name, true);
  const build = frameSequenceCorrectionPackage(s, anchor, target, review, intendedDelta, locks, note);
  const buildId = registerCandidateCorrectionBuild(s, target.frame, row, build);
  const c = ensureShotCreation(s);
  c.frameSequenceCorrection = { anchorFrameId: anchor.frame.id, targetFrameId: target.frame.id, buildId, autoReviewOnApproval: true, createdAt: new Date().toISOString(), intendedDelta };
  closeModal();
  openCandidateCorrectionModal(s.id, target.frame.id, target.approved.name, buildId);
};
window.acceptFrameSequenceDifference = (shotId) => {
  const { s, target } = frameSequenceSelectedTarget(shotId);
  const delta = String(document.getElementById("sequence-correction-delta")?.value || "").trim();
  const note = String(document.getElementById("sequence-correction-note")?.value || "").trim();
  if (!s || !target || !delta) return toast("Describe the intended difference first");
  const accepted = note || delta;
  const marker = `INTENTIONAL SEQUENCE DIFFERENCE: ${accepted}`;
  if (!String(target.frame.description || "").includes(marker)) target.frame.description = [target.frame.description, marker].filter(Boolean).join("\n");
  const c = ensureShotCreation(s);
  c.frameSequenceReview = null;
  c.frameSequenceCorrection = { anchorFrameId: frameSequenceCorrectionRows(s)[0]?.frame.id || "", targetFrameId: target.frame.id, autoReviewOnApproval: false, acceptedDifference: accepted, updatedAt: new Date().toISOString() };
  dirty(); closeModal(); route();
  setTimeout(() => reviewGuidedFrameSequence(shotId), 180);
};

function candidateCorrectionJob(buildId, sourceCandidate = "") {
  return [...(FAL_GENERATION_JOBS || [])]
    .filter((job) => job.purpose === "correction" && (!buildId || job.sourceBuildId === buildId) && (!sourceCandidate || job.sourceCandidate === sourceCandidate))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}

function candidateCorrectionWarningsMarkup(build) {
  const warnings = build?.correctionWarnings || [];
  return warnings.length ? `<div class="candidate-correction-warnings">${warnings.map((warning) => `<p><b>Warning</b>${esc(warning)}</p>`).join("")}</div>` : "";
}

function candidateCorrectionReferenceMarkup(build) {
  const refs = build?.references || [];
  return `<details class="candidate-correction-inputs" open><summary>Ordered input package <span>${refs.length} / 16</span></summary><div>${refs.map((ref, index) => `<article class="${candidateCorrectionIsLocationReference(ref) ? "location-authority" : ""}">${ref.url ? `<img src="${attr(ref.url)}" alt="${attr(ref.label || `Input ${index + 1}`)}">` : ""}<div><b>#image${index + 1} · ${esc(ref.label || ref.key || "Reference")}</b><span>${esc(ref.role || "reference")}${ref.originalToken ? ` · original ${esc(ref.originalToken)}` : ""}</span><p>${esc(ref.instruction || "Use only for the assigned role.")}</p></div></article>`).join("")}</div></details>`;
}

window.openCandidateCorrectionModal = (shotId, frameId, name, buildId = "") => {
  const s = shotById(shotId), frame = frameById(s, frameId) || (s?.keyframes || [])[0], row = s ? candidateRecord(s, name, true) : null;
  if (!s || !frame || !row) return toast("Correction source is unavailable");
  const id = buildId || row.currentCorrectionBuildId || (row.correctionBuildIds || []).at(-1) || "";
  const build = resolvePromptBuild(P, id);
  if (!build || build.missing) return toast("Correction build is unavailable");
  const job = candidateCorrectionJob(build.id, name);
  const active = typeof falJobActive === "function" && falJobActive(job);
  const ready = typeof falGenerationReady === "function" && falGenerationReady();
  const count = Number(falGenerationConfig?.().frameOutputs || 2);
  const quality = falGenerationConfig?.().frameQuality || "high";
  const resolution = falResolutionValue?.("frame") || "1k";
  window._candidateCorrectionDraft = { shotId, frameId: frame.id, name, buildId: build.id };
  const jobMarkup = job ? `<div class="fal-job-strip ${active ? "active" : job.status === "COMPLETED" ? "done" : job.status === "FAILED" ? "failed" : ""}"><div><span>${active ? '<i class="spin">◌</i>' : job.status === "COMPLETED" ? "✓" : job.status === "FAILED" ? "!" : "·"}</span><div><b>${esc(typeof falJobStatusLabel === "function" ? falJobStatusLabel(job) : job.status)}</b><small>${esc(job.model || "GPT Image 2 Edit")}${job.error ? ` · ${esc(job.error)}` : ""}</small></div></div><div>${active ? `<button class="chip" onclick="refreshCandidateCorrectionGeneration('${job.id}')">Refresh</button><button class="chip danger" onclick="cancelCandidateCorrectionGeneration('${job.id}')">Cancel</button>` : job.status === "FAILED" ? `<span>Adjust the correction and try again.</span>` : ""}</div></div>` : "";
  openModal(`<div class="candidate-correction-modal"><header><div><span>FRAME ${esc(frame.label || "A")} · TARGETED REPAIR</span><h3>Correction — ${esc(name)}</h3><p>The candidate remains the editable base. The guide supplies geometry only; recovered approved references supply finished appearance and location design.</p></div><button class="cancel" onclick="closeModal();route()">Close</button></header><div class="candidate-evidence-facts"><span>${esc(build.packageId)}</span><span>${esc(build.profileName || build.profileId || "Source profile")}</span><span>${(build.references || []).length} input${(build.references || []).length === 1 ? "" : "s"}</span><span>${esc(build.parentPackageId || "Original build unavailable")}</span></div>${candidateCorrectionWarningsMarkup(build)}${jobMarkup}<label class="candidate-correction-prompt"><span>Correction instructions</span><textarea id="candidate-correction-prompt">${esc(build.prompt || "")}</textarea><small>Editing this creates a new immutable correction revision when generation starts. The original production build and candidate remain unchanged.</small></label>${candidateCorrectionReferenceMarkup(build)}<div class="two-col candidate-correction-settings"><label><span>Number of options</span><select id="candidate-correction-output-count" ${active ? "disabled" : ""}>${[1,2,3,4].map((n) => `<option value="${n}" ${n === count ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><span>Quality</span><select id="candidate-correction-quality" ${active ? "disabled" : ""}>${["low","medium","high"].map((value) => `<option value="${value}" ${value === quality ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></label><label><span>Resolution</span><select id="candidate-correction-resolution" ${active ? "disabled" : ""}>${falResolutionOptions?.(resolution) || ""}</select></label></div><p class="hint">Generating submits a paid FAL edit request and returns each result to the existing Frame ${esc(frame.label || "A")} candidate list with correction provenance.</p><div class="modal-actions"><button class="ghost-btn" onclick="downloadCandidateCorrectionDraft()">Download</button><button class="ghost-btn" onclick="copyCandidateCorrectionDraft()">Copy correction</button>${ready ? `<button class="approve-btn large" onclick="startCandidateCorrectionGeneration()" ${active ? "disabled" : ""}>${active ? "CORRECTION IN PROGRESS" : "GENERATE CORRECTION WITH FAL"}</button>` : `<button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN FAL SETTINGS</button>`}</div></div>`);
};

window.buildCandidateCorrectionPrompt = () => {
  const draft = window._candidateReviewDraft || {}, s = shotById(draft.shotId);
  if (!s) return;
  const frame = frameById(s, draft.frameId) || (s.keyframes || [])[0], take = candidateReviewTake(s, draft.name), row = candidateRecord(s, draft.name, true);
  const review = saveCandidateStructuredReview(false);
  if (!frame || !take || !review) return;
  const build = candidateCorrectionPackage(s, frame, take, row, review);
  if (!build) return toast("Mark at least one issue before building a correction prompt");
  const buildId = registerCandidateCorrectionBuild(s, frame, row, build);
  openCandidateCorrectionModal(s.id, frame.id, take.name, buildId);
};

window.finalizeCandidateCorrectionDraft = () => {
  const draft = window._candidateCorrectionDraft || {}, s = shotById(draft.shotId), frame = frameById(s, draft.frameId), row = s ? candidateRecord(s, draft.name, true) : null;
  const source = resolvePromptBuild(P, draft.buildId);
  if (!s || !frame || !row || !source || source.missing) return null;
  const prompt = String(document.getElementById("candidate-correction-prompt")?.value || source.prompt || "").trim();
  if (!prompt) return null;
  if (prompt === String(source.prompt || "").trim()) return source;
  const now = new Date().toISOString();
  const state = guidedFrameState(s, frame, guidedFrames(s).findIndex((item) => item.id === frame.id));
  const revision = resolvePromptBuildList(P, state.promptBuilds || []).length + 1;
  const build = {
    ...cloneJSON(source),
    id: `${s.id}-${frame.id}-correction-${Date.now().toString(36)}`,
    packageId: `${s.id}-${frame.label || "A"}-CORRECTION-R${String(revision).padStart(2, "0")}`,
    prompt,
    parentCorrectionBuildId: source.id,
    revision,
    date: now,
    immutableAt: now,
    revisionReason: "candidate-correction-edit",
  };
  const buildId = registerCandidateCorrectionBuild(s, frame, row, build);
  window._candidateCorrectionDraft.buildId = buildId;
  return resolvePromptBuild(P, buildId);
};

window.copyCandidateCorrectionDraft = () => {
  const text = document.getElementById("candidate-correction-prompt")?.value || "";
  copyText(text);
};

window.downloadCandidateCorrectionDraft = () => {
  const draft = window._candidateCorrectionDraft || {}, build = resolvePromptBuild(P, draft.buildId);
  const text = document.getElementById("candidate-correction-prompt")?.value || build?.prompt || "";
  downloadCreationText(`${build?.packageId || draft.shotId + "-correction"}.txt`, text);
};

window.downloadCandidateCorrection = (shotId, buildId) => {
  const build = resolvePromptBuild(P, buildId);
  if (!build || build.missing) return toast("Correction build is unavailable");
  downloadCreationText(`${build.packageId || shotId + "-correction"}.txt`, build.prompt || "");
};

window.runCandidateStructuredVisionReview = async (shotId, frameId, name) => {
  const capability = capabilityState("vision");
  if (!capability.ready) return toast(`${capability.message} ${capability.action}`.trim());
  const s = shotById(shotId), row = candidateRecord(s, name, true), build = candidateSourceBuild(row);
  openModal(`<h3>Reviewing ${esc(name)}</h3><div class="modal-sub"><span class="spin">◌</span> COMPARING CANDIDATE, GUIDE, SHOT REQUIREMENTS, AND NUMBERED REFERENCES</div>`);
  const activityId = typeof v641StartManualActivity === "function" ? v641StartManualActivity("VISION AI · FRAME REVIEW", `Review ${name}`, "Comparing the candidate with its guide, shot requirements, and numbered production references.") : "";
  try {
    const response = await fetch("/api/llm/review-candidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId, frameId, fileName: name, buildId: build?.id || row.sourcePackageId || "" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Candidate review failed");
    const review = normalizeCandidateStructuredReview(row);
    review.ai = { ...(data.review || {}), reviewedAt: new Date().toISOString(), inputLabels: data.inputLabels || [] };
    row.reviewedAt = review.ai.reviewedAt;
    dirty();
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "completed", `Structured candidate review complete: ${String(data.review?.recommendation || "review").toUpperCase()}.`);
    openCandidateReview(shotId, frameId, name);
    toast("Assistant review added; confirm or override every finding");
  } catch (error) {
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "failed", error?.message || "Candidate review failed.");
    openModal(`<h3>Review failed</h3><div class="import-review" style="color:var(--red)">${esc(error.message)}</div><div class="modal-actions"><button class="cancel" onclick="closeModal();openCandidateReview('${shotId}','${frameId}','${attr(name)}')">Back to review</button></div>`);
  }
};

window.pinCandidateSourceBuild = (shotId, name) => {
  const s = shotById(shotId), row = s ? candidateRecord(s, name, true) : null, build = candidateSourceBuild(row);
  if (!build?.id || !P.promptBuildsById?.[build.id]) return toast("Source build is unavailable");
  P.promptBuildsById[build.id].pinned = true;
  dirty();
  toast("Source build pinned against retention");
};

window.viewCandidateSourceBuild = (shotId, name) => {
  const s = shotById(shotId), row = s ? candidateRecord(s, name, true) : null, build = candidateSourceBuild(row);
  if (!build) return toast("Source build is unavailable");
  openModal(`<div class="candidate-correction-modal"><h3>Original source build — ${esc(name)}</h3><div class="modal-sub">IMMUTABLE PROMPT HISTORY · ${esc(build.packageId || build.id || "BUILD")}</div><div class="candidate-evidence-facts"><span>${esc(build.profileName || build.profileId || "Profile not recorded")}</span><span>${(build.references || []).length} input${(build.references || []).length === 1 ? "" : "s"}</span>${P.promptBuildsById?.[build.id]?.pinned ? `<span>PINNED</span>` : ""}</div><pre>${esc(build.prompt || "No prompt stored.")}</pre><div class="modal-actions"><button class="cancel" onclick="closeModal();openCandidateReview('${shotId}','${window._candidateReviewDraft?.frameId || ""}','${attr(name)}')">Back</button><button class="approve-btn" onclick="copyText(${JSON.stringify(build.prompt || "").replace(/"/g, "&quot;")})">COPY ORIGINAL</button></div></div>`);
};

window.chooseCandidateComparison = (shotId, frameId, name) => {
  const s = shotById(shotId), frame = frameById(s, frameId) || (s.keyframes || [])[0];
  const index = guidedFrames(s).findIndex((item) => item.id === frame?.id);
  const others = guidedFrameCandidateRows(s, frame, takesFor(shotId), index).filter((take) => take.name !== name);
  if (!others.length) return toast("No other candidate is available");
  openModal(`<h3>Compare ${esc(name)}</h3><div class="modal-sub">CHOOSE ANOTHER RETURNED FRAME</div><div class="candidate-comparison-picker">${others.map((take) => `<button onclick="compareCandidatePair('${shotId}','${attr(name)}','${attr(take.name)}')"><img src="${attr(take.url)}" alt=""><span>${esc(take.name)}</span></button>`).join("")}</div><div class="modal-actions"><button class="cancel" onclick="closeModal();openCandidateReview('${shotId}','${frameId}','${attr(name)}')">Cancel</button></div>`);
};

window.compareCandidatePair = (shotId, first, second) => {
  CANDIDATE_COMPARE = new Set([`${shotId}:${first}`, `${shotId}:${second}`]);
  compareSelectedCandidates(shotId);
};
