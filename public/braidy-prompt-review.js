/* Postcompile Braidy review. The server owns model qualification, compilation,
 * reference authority, basis identity and the OpenAI credential. This browser
 * module only presents advisory text and records an explicitly chosen target
 * prompt revision. It never changes Shot Intent, reference decisions or Canon. */
(() => {
  "use strict";
  let serial = 0;
  let active = null;

  const h = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const messageOf = (row) => typeof row === "string" ? row : String(row?.message || row?.label || row?.code || "");
  const labelMode = (mode) => ({
    t2i: "Text to Image", blocking: "Blocking", edit: "Image Edit",
    inpaint: "Inpaint", "multi-reference": "Multi-reference",
    t2v: "Text to Video", i2v: "Image to Video",
    flf: "First / Last Frame", r2v: "Reference to Video",
  })[String(mode || "").toLowerCase()] || String(mode || "Generation");
  const current = (session) => {
    const modal = document.getElementById("modal");
    return active === session && !modal?.classList?.contains("hidden") &&
      document.getElementById("braidy-review-root")?.dataset.session === String(session.id);
  };
  const sourceBuild = (session) =>
    session.kind === "blocking"
      ? shotById(session.shotId)?.creationBrief?.blockingBuilds?.find((row) =>
        String(row.id || row.buildId) === String(session.buildId)) || null
      : typeof resolvePromptBuild === "function" ? resolvePromptBuild(P, session.buildId) : null;
  const sourceStillCurrent = (session) => {
    const shot = typeof shotById === "function" ? shotById(session.shotId) : null;
    const build = sourceBuild(session);
    if (!shot || !build || build.id !== session.buildId) return false;
    if (session.kind === "image" && String(build.frameId || "") !== String(session.frameId || "")) return false;
    const verdict = typeof packageFreshness === "function" ? packageFreshness(shot, build) : null;
    return !(verdict?.recorded && !verdict.current);
  };
  const targetLabel = (basis) => {
    const target = basis?.target || {};
    const model = target.modelName || target.modelId || target.model || "Target model";
    const mode = target.modeName || labelMode(target.mode);
    const escapedMode = String(mode).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return String(model).replace(new RegExp("\\s+[—–-]\\s+" + escapedMode + "$", "i"), "") + " · " + mode;
  };
  const basisArgs = (kind, shot, build) => {
    if (kind === "h3") {
      const mode = String(build.mode || build.profileId?.split("/")[1] || "");
      return {
        kind: "h3", shotId: shot.id, sourceBuildId: build.id,
        profileMode: mode, durationSeconds: Number(build.durationSeconds) || 5,
        resolution: typeof falH3ResolutionValue === "function" ? falH3ResolutionValue() : "2K",
        aspectRatio: mode === "r2v"
          ? (typeof productionAspect === "function" ? productionAspect(P)?.label : "") || "adaptive"
          : typeof projectAspectLabel === "function" ? projectAspectLabel(P) : "16:9",
      };
    }
    const cfg = typeof falGenerationConfig === "function" ? falGenerationConfig() : {};
    return {
      kind: "image", purpose: kind === "blocking" ? "blocking" : "frame", shotId: shot.id, sourceBuildId: build.id,
      aspectRatio: typeof shotAspectLabel === "function" ? shotAspectLabel(P, shot) : "16:9",
      outputCount: Number((kind === "blocking" ? cfg.blockingOutputs : cfg.frameOutputs) || 2),
    };
  };
  const request = async (path, body, signal) => {
    const response = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false)
      throw new Error(String(data.error || "Braidy could not review this target package."));
    return data;
  };
  const postBasis = (session, signal) => request("/api/assistant/braidy/basis", session.args, signal);
  const sameBasis = (a, b) => !!a && !!b && a === b;
  const warningRows = (rows) => Array.isArray(rows) ? rows.map(messageOf).filter(Boolean) : [];
  const list = (rows) => rows.length ? "<ul>" + rows.map((row) => "<li>" + h(row) + "</li>").join("") + "</ul>" : "<p>None recorded.</p>";
  const inputRows = (basis) => {
    const rows = Array.isArray(basis?.inputManifest) ? basis.inputManifest : [];
    if (!rows.length) return "<p>No bound media inputs for this target.</p>";
    return "<ol>" + rows.map((row, index) => {
      const slot = row.slot || row.providerField || row.field || row.binding || "Input " + (index + 1);
      const indexedSlot = row.providerIndex == null ? slot : slot + " " + (Number(row.providerIndex) + 1);
      const name = row.label || row.approvedFileName || row.filename || row.file || row.assetId || row.refId || "Bound input";
      const file = row.approvedFileName || row.filename || row.file || "";
      const role = row.role || row.semanticRole || "reference";
      const id = row.assetId || row.refId || "";
      const receipt = row.approvalStatus === "current-receipt-verified"
        ? "Current approval receipt verified" : "Current approval receipt not verified for Braidy";
      const target = row.approvalTarget && typeof row.approvalTarget === "object"
        ? Object.values(row.approvalTarget).filter(Boolean).join(" / ") : "";
      const identity = row.mediaIdentity?.sha256 ? "SHA-256 " + row.mediaIdentity.sha256 : "";
      const proof = [receipt, target, row.approvalReceiptId || "", identity].filter(Boolean).join(" · ");
      return "<li><b>" + h(indexedSlot) + "</b><span>" + h(name) + " · " + h(role) +
        (file && file !== name ? " · " + h(file) : "") +
        (id ? " · " + h(id) : "") + "</span><small>" + h(proof) + "</small></li>";
    }).join("") + "</ol>";
  };
  const busy = (session, note) => {
    const status = document.getElementById("braidy-review-status");
    if (status) { status.hidden = false; status.textContent = note; status.dataset.tone = "working"; }
    const button = document.getElementById("braidy-review-ask");
    if (button) button.disabled = true;
    const accept = document.getElementById("braidy-review-accept");
    if (accept) accept.disabled = true;
  };
  const report = (session, note, tone = "note") => {
    if (!current(session)) return;
    const status = document.getElementById("braidy-review-status");
    if (status) { status.hidden = false; status.textContent = note; status.dataset.tone = tone; }
    const button = document.getElementById("braidy-review-ask");
    if (button) button.disabled = false;
  };
  const proposalMarkup = (session, record) => {
    const proposal = record?.proposal || {};
    const notes = warningRows(proposal.materialChanges);
    const warnings = warningRows(proposal.warnings);
    const ambiguous = warningRows(proposal.unsupportedOrAmbiguous);
    const lost = Array.isArray(proposal.editedCoverage?.lost) ? proposal.editedCoverage.lost : [];
    const refusal = proposal.sendRefusal?.error || proposal.sendRefusal || "";
    return '<div class="braidy-proposal-meta"><b>Proposal ' + h(String(session.selectedProposal + 1)) +
      ' · ' + h(proposal.model || "OpenAI model") + '</b><span>Advisory only · no canonical change</span></div>' +
      '<label class="braidy-proposal-editor"><span>Proposed target prompt · editable before acceptance</span>' +
      '<textarea id="braidy-proposed-prompt" oninput="updateBraidyPromptReview()">' +
      h(record?.draftPrompt ?? proposal.proposedPrompt ?? "") + '</textarea></label>' +
      '<p class="braidy-reason">' + h(proposal.reasoningSummary || "No reason supplied.") + '</p>' +
      (refusal ? '<div class="braidy-warning"><b>Target request cannot use this proposal yet</b><p>' + h(refusal) + '</p></div>' : '') +
      (lost.length ? '<div class="braidy-warning"><b>Compiler coverage check: ' + lost.length + ' directed element' +
        (lost.length === 1 ? '' : 's') + ' no longer represented</b>' +
        list(lost.map((row) => row.label || row.id || row.code || 'Intent')) +
        '<p>Accepting this requires an explicit intentional-omission acknowledgement.</p></div>' : '') +
      '<div class="braidy-proposal-notes"><section><b>Material changes</b>' + list(notes) + '</section>' +
      '<section><b>Warnings</b>' + list(warnings) + '</section>' +
      '<section><b>Unsupported or ambiguous</b>' + list(ambiguous) + '</section></div>' +
      '<p class="braidy-proposal-basis">Bound to compilation ' +
      h(String(session.basis?.basisFingerprint || "").slice(0, 16)) + '… · ' +
      h(proposal.model || "") + '</p>';
  };
  const render = (session) => {
    if (!current(session)) return;
    const basis = session.basis || {};
    const target = basis.target || {};
    const title = document.getElementById("braidy-target-label");
    if (title) title.textContent = targetLabel(basis);
    const meta = document.getElementById("braidy-target-meta");
    if (meta) meta.textContent = [target.provider || "fal", target.endpoint || "",
      target.playbookId ? "Playbook " + target.playbookId +
        (target.playbookVersion ? " " + target.playbookVersion : "") : ""].filter(Boolean).join(" · ");
    const prompt = document.getElementById("braidy-deterministic-prompt");
    if (prompt) prompt.textContent = basis.deterministicPrompt || "";
    const currentPrompt = String(basis.currentSubmittedTargetPrompt || basis.deterministicPrompt || "");
    const currentTarget = document.getElementById("braidy-current-target");
    if (currentTarget) currentTarget.hidden = currentPrompt.trim() === String(basis.deterministicPrompt || "").trim();
    const currentText = document.getElementById("braidy-current-target-prompt");
    if (currentText) currentText.textContent = currentPrompt;
    const inputs = document.getElementById("braidy-bound-inputs");
    if (inputs) inputs.innerHTML = inputRows(basis);
    const warnings = warningRows(basis.warnings);
    const notes = document.getElementById("braidy-basis-warnings");
    if (notes) { notes.hidden = !warnings.length; notes.innerHTML = warnings.length ?
      "<b>Compiler notes and unsupported intent</b>" + list(warnings) : ""; }
    const source = sourceBuild(session);
    const difference = document.getElementById("braidy-package-difference");
    if (difference) {
      const differs = source?.prompt && String(source.prompt).trim() !== currentPrompt.trim();
      difference.hidden = !differs;
      if (differs) difference.textContent = "The saved authoring package wording differs from the target prompt that native request review would send. Braidy reviews the current submitted target wording; the production direction remains separate.";
    }
    const omission = document.getElementById("braidy-omission-confirm");
    if (omission) { omission.hidden = true; omission.innerHTML = ""; omission.dataset.prompt = ""; }
    const proposal = document.getElementById("braidy-proposal");
    if (proposal) proposal.innerHTML = session.proposals.length
      ? proposalMarkup(session, session.proposals[session.selectedProposal] || session.proposals.at(-1))
      : '<p class="braidy-empty">Ask Braidy for a model-aware advisory proposal, or keep this deterministic compilation. Nothing changes until you Accept or Edit.</p>';
    const compare = document.getElementById("braidy-proposal-compare");
    if (compare) {
      compare.hidden = session.proposals.length < 2;
      compare.innerHTML = session.proposals.length < 2 ? "" :
        '<label>Compare Braidy proposals <select onchange="selectBraidyPromptProposal(this.value)">' +
        session.proposals.map((row, i) => '<option value="' + i + '"' + (i === session.selectedProposal ? " selected" : "") +
          '>Proposal ' + (i + 1) + ' · ' + h(row.proposal?.model || "OpenAI") + '</option>').join("") +
        '</select></label>';
    }
    window.updateBraidyPromptReview();
  };
  const cancelPending = (session) => {
    session.sequence++;
    if (session.controller) session.controller.abort();
    session.controller = null;
  };
  const watchDismissal = (session) => {
    const modal = document.getElementById("modal");
    if (!modal || typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(() => {
      if (current(session)) return;
      cancelPending(session);
      observer.disconnect();
      if (active === session) active = null;
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["class"], childList: true });
    session.dismissObserver = observer;
  };
  window.closeBraidyPromptReview = () => {
    if (active) {
      cancelPending(active);
      active.dismissObserver?.disconnect();
    }
    active = null;
    closeModal();
  };
  window.openBraidyPromptReview = async (kind, shotId, buildId, frameId = "") => {
    const shot = typeof shotById === "function" ? shotById(shotId) : null;
    const build = kind === "blocking"
      ? shot?.creationBrief?.blockingBuilds?.find((row) => String(row.id || row.buildId) === String(buildId))
      : typeof resolvePromptBuild === "function" ? resolvePromptBuild(P, buildId) : null;
    if (!shot || !build) return toast("Compile a target package before asking Braidy.");
    if (kind === "h3" && !String(build.profileId || "").startsWith("minimax-h3/"))
      return toast("This motion package is not a qualified MiniMax H3 target.");
    if (kind === "image" && (!String(build.profileId || "").startsWith("gpt-image-2/") ||
      String(build.frameId || "") !== String(frameId || "")))
      return toast("This frame package is not a qualified GPT Image 2 target.");
    if (kind === "blocking" && String(build.profileId || "") !== "gpt-image-2/blocking")
      return toast("This blocking package is not a qualified GPT Image 2 target.");
    if (active) cancelPending(active);
    const session = {
      id: ++serial, kind, shotId, buildId, frameId, args: basisArgs(kind, shot, build),
      basis: null, proposals: [], selectedProposal: 0, sequence: 0, controller: null,
    };
    active = session;
    openModal('<div class="braidy-prompt-modal" id="braidy-review-root" data-session="' + session.id +
      '"><header><div><span>EXACT TARGET PROMPT REVIEW</span><h3 id="braidy-target-label">Preparing target compilation…</h3>' +
      '<p id="braidy-target-meta"></p></div><button class="cancel" onclick="closeBraidyPromptReview()">Close</button></header>' +
      '<div class="braidy-review-scroll"><p class="braidy-scope">Asking Braidy sends the deterministic compilation, current target wording, shot intent and bound-input metadata to OpenAI, not media bytes, and may incur API cost. Braidy cannot approve media, change the production brief or submit generation.</p>' +
      '<section class="braidy-basis"><header><b>Deterministic compiled request</b><small>This is the target-specific baseline without OpenAI. Normal request review shows the final text before any provider dispatch.</small></header>' +
      '<div id="braidy-current-target" hidden><b>Current saved target prompt · native review wording</b><pre id="braidy-current-target-prompt"></pre></div><pre id="braidy-deterministic-prompt"></pre><div id="braidy-package-difference" class="braidy-scope" hidden></div>' +
      '<details><summary>Ordered bound inputs and roles</summary><div id="braidy-bound-inputs"></div></details>' +
      '<div id="braidy-basis-warnings" class="braidy-warning" hidden></div></section>' +
      '<section class="braidy-advisory"><header><div><b>Braidy proposal</b><small>Uses the OpenAI model selected in isolated Settings. A successful connection is not an approval of its judgment.</small></div>' +
      '<button type="button" class="ghost-btn" id="braidy-review-ask" onclick="askBraidyPromptReview()">Ask Braidy</button></header>' +
      '<div id="braidy-review-status" role="status" hidden></div><div id="braidy-proposal-compare" hidden></div>' +
      '<div id="braidy-proposal"></div><div id="braidy-omission-confirm" class="braidy-warning" hidden></div></section></div>' +
      '<footer class="modal-actions"><button class="cancel" onclick="closeBraidyPromptReview()">Reject / keep current package</button>' +
      '<button id="braidy-review-accept" class="approve-btn large" onclick="acceptBraidyPromptReview()" disabled>Accept proposal</button></footer></div>');
    watchDismissal(session);
    busy(session, "Preparing the exact deterministic target package…");
    const sequence = ++session.sequence;
    const controller = new AbortController();
    session.controller = controller;
    try {
      if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
      if (!current(session) || sequence !== session.sequence) return;
      if (!sourceStillCurrent(session)) throw new Error("This package changed. Rebuild it before Braidy review.");
      const basis = await postBasis(session, controller.signal);
      if (!current(session) || sequence !== session.sequence) return;
      if (!sourceStillCurrent(session)) {
        report(session, "This package changed. Rebuild it before Braidy review.", "error");
        return;
      }
      session.basis = basis;
      render(session);
      report(session, "Deterministic compilation is ready. Braidy is optional.", "ok");
    } catch (error) {
      if (error?.name !== "AbortError") report(session, error.message, "error");
    } finally {
      if (session.controller === controller) session.controller = null;
    }
  };
  window.askBraidyPromptReview = async () => {
    const session = active;
    if (!session?.basis || !current(session)) return;
    cancelPending(session);
    const sequence = ++session.sequence;
    const controller = new AbortController();
    session.controller = controller;
    busy(session, "Checking package identity, then asking OpenAI for an advisory proposal…");
    try {
      if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
      if (!current(session) || sequence !== session.sequence || !sourceStillCurrent(session))
        throw new Error("This target package changed. Rebuild it before asking Braidy.");
      const fresh = await postBasis(session, controller.signal);
      if (!sameBasis(fresh.basisFingerprint, session.basis.basisFingerprint))
        throw new Error("The target compilation changed. Reopen Braidy review from the current package.");
      const result = await request("/api/assistant/braidy/improve",
        { ...session.args, baselineFingerprint: session.basis.basisFingerprint }, controller.signal);
      if (!current(session) || sequence !== session.sequence) return;
      if (!sameBasis(result.basisFingerprint, session.basis.basisFingerprint) || !sourceStillCurrent(session))
        throw new Error("The target changed during Braidy review. Reopen it from the current package.");
      if (!String(result.proposal?.proposedPrompt || "").trim())
        throw new Error("Braidy returned no usable prompt; the deterministic package is unchanged.");
      session.proposals.push(result);
      session.selectedProposal = session.proposals.length - 1;
      render(session);
      report(session, "Proposal received. Inspect, edit, accept, or reject it; no generation was sent.", "ok");
    } catch (error) {
      if (error?.name !== "AbortError") report(session, error.message, "error");
    } finally {
      if (session.controller === controller) session.controller = null;
      if (current(session)) {
        const button = document.getElementById("braidy-review-ask");
        if (button) button.disabled = false;
        window.updateBraidyPromptReview();
      }
    }
  };
  window.selectBraidyPromptProposal = (index) => {
    const session = active;
    const chosen = Number(index);
    if (!current(session) || !Number.isInteger(chosen) || !session.proposals[chosen]) return;
    const prior = session.proposals[session.selectedProposal];
    const draft = document.getElementById("braidy-proposed-prompt");
    if (prior && draft) prior.draftPrompt = draft.value;
    session.selectedProposal = chosen;
    render(session);
  };
  window.updateBraidyPromptReview = () => {
    const session = active;
    const button = document.getElementById("braidy-review-accept");
    if (!button || !session || !current(session)) return;
    const proposal = session.proposals[session.selectedProposal]?.proposal;
    const value = String(document.getElementById("braidy-proposed-prompt")?.value || "").trim();
    const currentProposal = session.proposals[session.selectedProposal];
    if (currentProposal && document.getElementById("braidy-proposed-prompt")) currentProposal.draftPrompt = document.getElementById("braidy-proposed-prompt").value;
    const omission = document.getElementById("braidy-omission-confirm");
    if (omission && !omission.hidden && omission.dataset.prompt !== value) {
      omission.hidden = true; omission.innerHTML = ""; omission.dataset.prompt = "";
    }
    const limit = session.kind === "h3" ? 7000 : 16000;
    const selected = session.proposals[session.selectedProposal];
    const refusedUnedited = selected?.proposal?.sendable === false && value === String(proposal?.proposedPrompt || "").trim();
    button.disabled = !proposal || !value || value.length > limit || !!session.controller || refusedUnedited;
    button.textContent = value && value !== String(proposal?.proposedPrompt || "").trim()
      ? "Save edited proposal" : "Accept proposal";
    const count = document.getElementById("braidy-prompt-count");
    if (count) count.textContent = value.length + "/" + limit;
  };
  /* A saved advisory revision belongs to one exact source compilation and output
   * settings. Recheck that basis before native paid review may load its wording. */
  window.showStaleBraidyReview = (error) => openModal('<div class="braidy-stale-review"><h3>Braidy target revision is out of date</h3><p>' +
    h(error || "The accepted target text no longer matches the current request.") +
    '</p><p>Rebuild this target package from the current shot and settings, then review the exact provider request again. The saved revision remains in history; nothing was submitted.</p>' +
    '<div class="modal-actions"><button class="cancel" onclick="closeModal()">Return to shot</button></div></div>');
  window.verifyBraidyRevisionBasis = async (kind, shotId, build, frameId = "") => {
    const review = build?.braidyReview;
    if (!review) return { ok: true };
    const refusal = (detail) => ({ ok: false, error: detail + " Rebuild the target package and review the new exact request before generation." });
    const accepted = String(review.acceptedPrompt || "").trim();
    if (!accepted || accepted !== String(build.prompt || "").trim() || !review.sourceBuildId ||
        !review.basisFingerprint || !review.packageFingerprint)
      return refusal("This Braidy revision has incomplete or changed provenance.");
    const shot = shotById(shotId);
    const session = { kind, shotId, buildId: review.sourceBuildId, frameId };
    const source = sourceBuild(session);
    if (!shot || !source || String(source.id) !== String(review.sourceBuildId))
      return refusal("The source package for this Braidy revision is unavailable.");
    try {
      if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
      const args = basisArgs(kind, shot, source);
      const fresh = await request("/api/assistant/braidy/basis", {
        ...args, baselineFingerprint: review.basisFingerprint, submittedPrompt: accepted,
      });
      if (!sameBasis(fresh.basisFingerprint, review.basisFingerprint) ||
          !sameBasis(fresh.packageFingerprint, review.packageFingerprint))
        return refusal("Production intent, bound inputs or output settings changed since this Braidy review.");
      return { ok: true, basis: fresh };
    } catch (error) {
      return refusal(error?.message || "The saved Braidy revision could not be verified.");
    }
  };
  const saveImageRevision = (session, prompt, review) => {
    const shot = shotById(session.shotId);
    const source = sourceBuild(session);
    const frames = guidedFrames(shot);
    const index = frames.findIndex((row) => row.id === session.frameId);
    if (!source || index < 0) throw new Error("The exact source frame package is unavailable.");
    const frame = frames[index];
    const state = guidedFrameState(shot, frame, index);
    const sequence = state.promptBuilds.length + 1;
    const revised = JSON.parse(JSON.stringify(source));
    revised.id = "guided-frame-braidy-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    revised.packageId = session.shotId + "-FRAME-" + (frame.label || "A") + "-R" + String(sequence).padStart(2, "0");
    revised.date = new Date().toISOString();
    revised.prompt = prompt;
    revised.parentBuildId = source.id;
    revised.parentPackageId = source.packageId || "";
    revised.revision = sequence;
    revised.manualEdited = true;
    revised.llmUsed = true;
    revised.editReason = "Braidy target-specific prompt review";
    revised.braidyReview = review;
    revised.providerPayload = revised.providerPayload && typeof revised.providerPayload === "object"
      ? { ...revised.providerPayload, prompt, parentBuildId: source.id, manualEdited: true }
      : revised.providerPayload;
    revised.confirmations = [...(source.confirmations || []),
      "Braidy advisory revision; canonical frame intent and approved media remain unchanged."];
    const id = registerPromptBuild(P, revised);
    state.promptBuilds.push(promptBuildRef(id, { kind: "guided-frame", revisionReason: "braidy-review" }));
    frame.generationPackages = Array.isArray(frame.generationPackages) ? frame.generationPackages : [];
    frame.generationPackages.push(promptBuildRef(id, { kind: "guided-frame", scope: "frame:" + frame.id, revisionReason: "braidy-review" }));
    shot.promptBuilds = Array.isArray(shot.promptBuilds) ? shot.promptBuilds : [];
    shot.promptBuilds.push(promptBuildRef(id, { kind: "guided-frame", revisionReason: "braidy-review" }));
    shot.generationPackages = Array.isArray(shot.generationPackages) ? shot.generationPackages : [];
    shot.generationPackages.push(promptBuildRef(id, { kind: "guided-frame", scope: "frame:" + frame.id, revisionReason: "braidy-review" }));
    if (typeof applyPromptBuildRetention === "function") applyPromptBuildRetention(P);
    dirty();
    return revised;
  };
  const saveBlockingRevision = (session, prompt, review) => {
    const shot = shotById(session.shotId);
    const builds = shot?.creationBrief?.blockingBuilds;
    const source = sourceBuild(session);
    if (!Array.isArray(builds) || !source) throw new Error("The exact blocking package is unavailable.");
    const revised = JSON.parse(JSON.stringify(source));
    revised.id = "blocking-braidy-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    revised.packageId = session.shotId + "-BLOCKING-R" + String(builds.length + 1).padStart(2, "0");
    revised.date = new Date().toISOString();
    revised.prompt = prompt;
    revised.parentBuildId = source.id;
    revised.parentPackageId = source.packageId || "";
    revised.revision = builds.length + 1;
    revised.manualEdited = true;
    revised.llmUsed = true;
    revised.editReason = "Braidy target-specific prompt review";
    revised.braidyReview = review;
    revised.providerPayload = revised.providerPayload && typeof revised.providerPayload === "object"
      ? { ...revised.providerPayload, prompt, parentBuildId: source.id, manualEdited: true }
      : revised.providerPayload;
    revised.confirmations = [...(source.confirmations || []),
      "Braidy advisory revision; canonical blocking direction and approved media remain unchanged."];
    builds.push(revised);
    dirty();
    return revised;
  };
  const saveMotionRevision = (session, prompt, review) => {
    const revised = createManualMotionPromptRevision(session.shotId, session.buildId, prompt,
      "Braidy target-specific prompt review", { force: prompt !== String(session.basis.deterministicPrompt || "").trim() });
    if (!revised?.manualEdited || revised.id === session.buildId) return revised;
    const stored = P.promptBuildsById?.[revised.id];
    if (!stored) throw new Error("The linked motion revision was not stored.");
    stored.braidyReview = review;
    stored.llmUsed = true;
    stored.confirmations = [...(stored.confirmations || []),
      "Braidy advisory revision; canonical motion direction and approved media remain unchanged."];
    dirty();
    return stored;
  };
  window.acceptBraidyPromptReview = async () => {
    const session = active;
    if (!session?.basis || !current(session) || !session.proposals.length) return;
    const selected = session.proposals[session.selectedProposal];
    const proposal = selected?.proposal || {};
    const prompt = String(document.getElementById("braidy-proposed-prompt")?.value || "").trim();
    if (!prompt) return report(session, "A target prompt is required.", "error");
    if (prompt.length > (session.kind === "h3" ? 7000 : 16000))
      return report(session, "This prompt exceeds the review limit; edit it before accepting.", "error");
    cancelPending(session);
    const sequence = ++session.sequence;
    const controller = new AbortController();
    session.controller = controller;
    busy(session, "Checking that this proposal still matches the exact current compilation…");
    try {
      if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
      if (!current(session) || sequence !== session.sequence || !sourceStillCurrent(session))
        throw new Error("This package changed. Rebuild it before accepting a Braidy proposal.");
      const fresh = await postBasis(session, controller.signal);
      if (!current(session) || sequence !== session.sequence) return;
      if (!sameBasis(fresh.basisFingerprint, session.basis.basisFingerprint))
        throw new Error("This proposal is out of date: production intent, inputs, model or settings changed. Reopen review.");
      const source = sourceBuild(session);
      if (!source || source.id !== session.buildId) throw new Error("The source package is unavailable.");
      const nativePrompt = String(session.basis.currentSubmittedTargetPrompt ||
        session.basis.deterministicPrompt || "").trim();
      if (prompt === nativePrompt) {
        window.closeBraidyPromptReview();
        toast("The proposal matches the existing target package. No revision was needed.");
        return;
      }
      const acceptedPlan = await request("/api/assistant/braidy/basis",
        { ...session.args, baselineFingerprint: session.basis.basisFingerprint, submittedPrompt: prompt }, controller.signal);
      if (!current(session) || sequence !== session.sequence) return;
      if (!sameBasis(acceptedPlan.basisFingerprint, session.basis.basisFingerprint))
        throw new Error("The target changed while checking the accepted wording. Reopen review.");
      if (acceptedPlan.sendRefusal || acceptedPlan.sendable === false)
        throw new Error(String(acceptedPlan.sendRefusal?.error || acceptedPlan.sendRefusal || "This wording cannot be sent to this target."));
      const lost = Array.isArray(acceptedPlan.editedCoverage?.lost) ? acceptedPlan.editedCoverage.lost : [];
      const omissionPanel = document.getElementById("braidy-omission-confirm");
      const acknowledged = omissionPanel?.dataset.prompt === prompt &&
        document.getElementById("braidy-omission-ack")?.checked;
      if (lost.length && !acknowledged) {
        if (omissionPanel) {
          omissionPanel.hidden = false;
          omissionPanel.dataset.prompt = prompt;
          omissionPanel.innerHTML = "<b>This revision no longer covers " + lost.length + " directed element" +
            (lost.length === 1 ? "" : "s") + "</b><p>" + h(lost.map((row) => row.label || row.id || row.code || "Intent").join(", ")) +
            ".</p><label><input id=\"braidy-omission-ack\" type=\"checkbox\"> I intentionally accept these omissions in this target prompt.</label>";
        }
        throw new Error("Review the uncovered intent and acknowledge the intentional omission before accepting.");
      }
      const review = {
        basisFingerprint: session.basis.basisFingerprint,
        packageFingerprint: acceptedPlan.packageFingerprint || "",
        generationSettings: acceptedPlan.generationSettings || session.basis.generationSettings || {},
        sourceBuildId: session.buildId,
        model: proposal.model || "",
        responseId: proposal.responseId || "",
        target: session.basis.target || {},
        deterministicPrompt: session.basis.deterministicPrompt || "",
        proposedPrompt: proposal.proposedPrompt || "",
        acceptedPrompt: prompt,
        materialChanges: proposal.materialChanges || [],
        warnings: proposal.warnings || [],
        unsupportedOrAmbiguous: proposal.unsupportedOrAmbiguous || [],
        reasoningSummary: proposal.reasoningSummary || "",
        editedCoverage: acceptedPlan.editedCoverage || null,
        intentionalOmissions: lost.map((row) => row.label || row.id || row.code || "Intent"),
        selectedAt: new Date().toISOString(),
      };
      const revised = session.kind === "h3"
        ? saveMotionRevision(session, prompt, review)
        : session.kind === "blocking"
          ? saveBlockingRevision(session, prompt, review)
          : saveImageRevision(session, prompt, review);
      if (!revised?.id || revised.id === session.buildId)
        throw new Error("The target revision could not be saved.");
      window.closeBraidyPromptReview();
      route();
      toast("Braidy proposal saved as a target-specific revision. Review the exact provider request before generation.");
    } catch (error) {
      if (error?.name !== "AbortError") report(session, error.message, "error");
    } finally {
      if (session.controller === controller) session.controller = null;
      if (current(session)) {
        const ask = document.getElementById("braidy-review-ask");
        if (ask) ask.disabled = false;
        window.updateBraidyPromptReview();
      }
    }
  };
})();