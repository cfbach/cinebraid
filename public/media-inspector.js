/* CineBraid — the Universal Media Inspector.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: any important piece of production
   media, wherever a filmmaker clicked it, opens the SAME inspection surface reading
   the SAME projection — so "what is this, and what authority does it have" has one
   answer instead of one per grid.

   ---------------------------------------------------------------------------
   WHAT THIS IS NOT.

   * IT IS NOT A SOURCE OF TRUTH. Every field comes from
     public/shared-production-media.js, which reads the records their own owners
     wrote. This file contains no approval rule, no disposition rule and no cost
     arithmetic. It renders tokens into words and nothing else — the same constraint
     public/shared-continuity.js holds for continuity and public/stage-surfaces.js
     holds for stages.

   * IT IS NOT A SECOND DECISION WRITER. `approve`, `reject` and `restore` dispatch
     the SHIPPED handlers — approveEntityFile / approveTake open their existing
     confirmation modals, setEntityCandidateDecision / setCandidateDecision are the
     existing decision writers. Nothing here writes to a project.

   * IT IS NOT A SECOND REVIEW TRIGGER. The Inspector SHOWS what a review said and
     hands off to the shipped review modal, which is where running or re-running one
     already lives. A second dispatcher would be a second place that could attribute a
     review, and "the reviewer that actually ran, never the current Settings value" is
     only true while there is one.

   * IT IS NOT THE THEATRE. Clean fullscreen viewing is openMediaTheatre() and stays
     there. The Inspector offers it as `Open full preview` and the theatre offers the
     way back, so opening the picture larger never costs the filmmaker the identity
     they were inspecting.

   ---------------------------------------------------------------------------
   THE THREE CONCEPTS THAT ARE RENDERED SEPARATELY, ON PURPOSE.

     HUMAN DECISION      what a person decided. Rendered first, largest, and with the
                         only treatment that reads as authority.
     AI RECOMMENDATION   what a reviewer SUGGESTED. Advisory wording, always, and the
                         word "approved" can never appear in it.
     AI REVIEW           that a review happened, by whom, when, and what it found.

   A candidate an AI recommended and nobody approved renders as CANDIDATE with an
   advisory note. There is no code path in this file that can turn a recommendation
   into an approval, and the words are separated at the source: `decisionWords()`
   reads humanDecision and nothing else, `recommendationWords()` reads
   aiRecommendation and nothing else, and neither can see the other's input.

   ---------------------------------------------------------------------------
   MISSING DATA IS PRINTED, NOT HIDDEN. Every uncertain field arrives as a {state,
   value} triple and is rendered through one function, `fact()`, so there is exactly
   one place in CineBraid that decides how an unknown looks. `not-recorded` reads
   "Not recorded", `unavailable` reads "Generation record unavailable", and neither
   can render as an empty string, a dash or a zero. */

(function () {
  if (typeof document === "undefined") return;

  /* The media currently inspected, so the theatre can hand the filmmaker back and so
     a decision taken inside the Inspector can repaint the same record rather than
     guessing which one was open. A KEY, never a copy of the record: a cached record
     is a record that can be stale, and the Inspector's whole claim is that it shows
     current truth. */
  let INSPECTED_KEY = "";

  function activeProject() {
    return typeof P === "undefined" ? null : P;
  }

  /* THE ONE CALL into the projection. Assembles the four inputs from the app's own
     bindings — all lexical `let`s in public/app.js, so they are read through typeof
     rather than off `window`, which is the defect public/focused-workspaces.js
     documents at its own activeProject(). */
  function projection() {
    if (typeof productionMediaRecords !== "function") return null;
    const project = activeProject();
    if (!project) return null;
    return productionMediaRecords({
      project,
      scan: typeof SCAN === "undefined" ? {} : SCAN,
      jobs: typeof FAL_GENERATION_JOBS === "undefined" ? [] : FAL_GENERATION_JOBS,
      /* The honest flag, not `jobs.length`. See public/app.js: the ledger is only
         requested when generation is enabled and keyed. */
      jobsAvailable: typeof FAL_GENERATION_LEDGER_LOADED === "undefined" ? false : FAL_GENERATION_LEDGER_LOADED === true,
      /* The shipped owner of "which files belong to this entity", preferred over the
         projection's own restatement of the same rule. */
      entityMedia: typeof entityMedia === "function" ? entityMedia : undefined,
    });
  }

  function recordFor(key) {
    const built = projection();
    if (!built) return null;
    return built.records.find((row) => row.key === String(key || "")) || null;
  }

  /* ==========================================================================
     WORDS.

     One function per uncertain field so a surface cannot invent a fifth way to say
     "we do not know". `fact()` is the only renderer of a knowledge triple in the
     Inspector, and every branch of it produces visible text. */
  const UNKNOWN_WORDS = {
    "not-recorded": "Not recorded",
    "not-applicable": "Not applicable",
    unavailable: "Generation record unavailable",
  };

  function fact(triple, options = {}) {
    const it = triple && typeof triple === "object" ? triple : {};
    const state = String(it.state || "not-recorded");
    if (state === "known" && String(it.value || "").trim())
      return `<b>${esc(options.format ? options.format(it.value) : it.value)}</b>`;
    return `<b class="mi-unknown">${esc(options.unknown || UNKNOWN_WORDS[state] || "Not recorded")}</b>`;
  }

  function factRow(label, triple, options = {}) {
    return `<article><span>${esc(label)}</span>${fact(triple, options)}</article>`;
  }

  const KIND_WORDS = {
    "entity-reference": "Reference image",
    "shot-still": "Shot still",
    "shot-motion": "Motion result",
    "shot-blocking": "Blocking guide",
    "project-media": "Planning media",
  };

  /* THE AUTHORITY WORDS. Built from the target the P4 edge actually stored — its kind
     and its own label — and never from free text this file invented. An edge whose
     record carried no label falls back to its id, which is what the edge itself
     returns, rather than to a sentence describing what the kind usually means. */
  const TARGET_KIND_WORDS = {
    primary: "Primary reference",
    state: "Continuity state",
    coverage: "Coverage view",
    expression: "Expression",
    shot: "Shot image",
    frame: "Frame",
    motion: "Motion",
    "clip-first": "Clip first frame",
    "clip-last": "Clip last frame",
  };

  /* HUMAN DECISION WORDS. Reads humanDecision and nothing else — it is not passed the
     recommendation and cannot consult it. */
  function decisionWords(row) {
    const decision = row.humanDecision;
    if (decision.state === "approved") return { tone: "approved", label: "Approved by you", detail: "A person approved this. It is production canon." };
    /* REASON NOT RECORDED, said plainly. Neither candidate dialect has a reason field —
       public/shared-production-media.js declares that gap — so the Inspector states the
       absence rather than leaving a blank a reader would fill in for themselves, and
       rather than inferring one from a review that may have had nothing to do with the
       decision. */
    if (decision.state === "rejected") return { tone: "rejected", label: "Rejected by you", detail: "A person rejected this. It is kept as evidence.", note: "Reason not recorded" };
    return { tone: "candidate", label: "No human decision yet", detail: "Nobody has approved or rejected this." };
  }

  /* AI RECOMMENDATION WORDS. Reads aiRecommendation and nothing else. Note that no
     branch produces the word "approved": a suggestion to approve is rendered as
     "Suggests approving", which is a different sentence about a different actor. */
  const RECOMMENDATION_WORDS = {
    approve: "Suggests approving",
    alternate: "Suggests another candidate",
    correct: "Suggests correcting",
    reject: "Suggests rejecting",
  };

  function recommendationWords(row) {
    const value = String(row.aiRecommendation.value || "");
    if (row.aiRecommendation.state !== "known" || !RECOMMENDATION_WORDS[value])
      return { tone: "none", label: "No AI recommendation", detail: "" };
    return {
      tone: value === "approve" ? "positive" : "attention",
      label: RECOMMENDATION_WORDS[value],
      detail: "Advisory only. An AI recommendation is not an approval and changes nothing on its own.",
    };
  }

  const REVIEW_KIND_WORDS = {
    "entity-structured-review": "Reference authority review",
    "shot-ai-triage": "Candidate AI triage",
    "shot-structured-review": "Candidate review notes",
  };

  const RELATION_WORDS = {
    "correction-of": "Corrected from",
    "corrected-into": "Corrected into",
    "finished-from": "Finished from",
    "renamed-from": "Previously named",
    "revised-from-library-asset": "Revised from library asset",
  };

  function timeWords(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }

  /* MONEY, and the one place it is formatted. `priced` is the ONLY state that yields
     a number, so there is no branch here that can produce $0.00 for an unknown. */
  function costMarkup(cost) {
    if (cost.state === "priced") {
      const amount = Number(cost.amount);
      const shown = amount < 0.01 && amount > 0 ? amount.toFixed(4) : amount.toFixed(2);
      return `<article><span>Cost</span><b>${esc(`${String(cost.currency || "usd").toUpperCase()} ${shown}`)}</b><small>Estimated at submission, not a charged amount.</small></article>`;
    }
    const words = {
      "not-priced": ["Cost not priced", "This output is metered by the provider and CineBraid has no rate for it."],
      "not-recorded": ["Cost not recorded", "Nothing recorded what this cost."],
      unavailable: ["Generation record unavailable", "CineBraid does not have this generation record loaded, so its cost cannot be read here."],
    }[cost.state] || ["Cost not recorded", ""];
    return `<article><span>Cost</span><b class="mi-unknown">${esc(words[0])}</b>${words[1] ? `<small>${esc(words[1])}</small>` : ""}</article>`;
  }

  /* ==========================================================================
     SECTIONS. */

  function previewMarkup(row) {
    const url = row.file.url;
    if (!url) return `<div class="mi-preview mi-preview-empty"><span>This file is not on disk</span></div>`;
    if (row.file.mediaType === "video")
      return `<div class="mi-preview"><video controls muted playsinline preload="metadata" src="${attr(url)}#t=0.1"></video></div>`;
    if (row.file.mediaType === "audio")
      return `<div class="mi-preview"><audio controls preload="metadata" src="${attr(url)}"></audio></div>`;
    return `<div class="mi-preview"><img src="${attr(url)}" alt="${attr(`Inspected media ${row.file.name}`)}"></div>`;
  }

  function identityMarkup(row) {
    const context = row.context;
    const owner = context.shotId.state === "known"
      ? `${context.shotId.value}${context.frameLabel.state === "known" ? ` · Frame ${context.frameLabel.value}` : ""}`
      : context.entityName.state === "known"
        ? context.entityName.value
        : "";
    return `<section class="mi-section mi-identity" data-mi-section="identity">
      <h4>What this is</h4>
      <div class="mi-facts">
        <article><span>Media kind</span><b>${esc(KIND_WORDS[row.kind] || row.kind)}</b></article>
        <article><span>Belongs to</span>${owner ? `<b>${esc(owner)}</b>` : `<b class="mi-unknown">Not attached to a shot or reference</b>`}</article>
        <article><span>File</span><b>${esc(row.file.name)}</b></article>
        ${factRow("Added", row.file.addedAt, { format: timeWords })}
      </div>
      <div class="mi-identity-domains" data-mi-identity>
        <article data-mi-domain="ledger"><span>Durable media identity</span>${fact(row.identity.ledger, { unknown: "No durable identity yet" })}</article>
        <article data-mi-domain="library"><span>Project library row</span>${fact(row.identity.library, { unknown: "Not a library row" })}</article>
        <article data-mi-domain="path"><span>Stored at</span><b>${esc(row.identity.path || "Unknown location")}</b></article>
      </div>
    </section>`;
  }

  /* PRODUCTION STATUS, and the reason the three blocks are three blocks. A single
     badge would have to choose one of them to show, and whichever it chose would be
     read as the answer to all three questions. */
  function statusMarkup(row) {
    const decision = decisionWords(row);
    const recommendation = recommendationWords(row);
    const reviewed = row.reviews.length;
    return `<section class="mi-section mi-status" data-mi-section="status">
      <h4>Production status</h4>
      <div class="mi-status-grid">
        <article class="mi-decision tone-${attr(decision.tone)}" data-mi-human-decision="${attr(row.humanDecision.state)}">
          <span>Human decision</span><b>${esc(decision.label)}</b><small>${esc(decision.detail)}</small>
          ${row.humanDecision.decidedAt.state === "known" ? `<em>${esc(timeWords(row.humanDecision.decidedAt.value))}</em>` : ""}
          ${decision.note ? `<em data-mi-rejection-reason="not-recorded">${esc(decision.note)}</em>` : ""}
          ${row.humanDecision.approvedWithoutAI.state === "known" ? `<i>Approved without a current AI check.</i>` : ""}
        </article>
        <article class="mi-disposition tone-${attr(row.disposition.role)}" data-mi-disposition="${attr(row.disposition.role)}">
          <span>Disposition</span><b>${esc({ approved: "Approved", candidate: "Candidate", rejected: "Rejected" }[row.disposition.role] || row.disposition.role)}</b>
          <small>${esc(row.disposition.role === "approved" ? "This media is the authority for at least one target." : row.disposition.role === "rejected" ? "Retained so the decision stays auditable." : "Not yet chosen for any target.")}</small>
        </article>
        <article class="mi-recommendation tone-${attr(recommendation.tone)}" data-mi-recommendation="${attr(row.aiRecommendation.value || "none")}">
          <span>AI recommendation</span><b>${esc(recommendation.label)}</b>
          ${recommendation.detail ? `<small>${esc(recommendation.detail)}</small>` : `<small>No reviewer has suggested anything for this media.</small>`}
        </article>
        <article class="mi-review-state" data-mi-reviewed="${reviewed ? "yes" : "no"}">
          <span>AI review</span><b${reviewed ? "" : ' class="mi-unknown"'}>${esc(reviewed ? `${reviewed} review${reviewed === 1 ? "" : "s"} on record` : "Never reviewed")}</b>
          <small>${esc(reviewed ? "A review raises information. It approves nothing." : "Nothing has reviewed this media.")}</small>
        </article>
      </div>
    </section>`;
  }

  function authorityMarkup(row) {
    if (!row.disposition.targets.length)
      return `<section class="mi-section mi-authority" data-mi-section="authority" data-mi-target-count="0">
        <h4>Authority</h4><p class="mi-empty">This media is not the authority for anything. Approving it is what gives it authority.</p></section>`;
    const rows = row.disposition.targets.map((target) => `<li data-mi-target-kind="${attr(target.kind)}">
      <b>${esc(TARGET_KIND_WORDS[target.kind] || target.kind)}</b>
      <span>${esc(target.label || target.id || "")}</span>
      <small>${target.assetId.state === "known" ? "Bound by durable identity" : "Bound by filename"}</small></li>`).join("");
    return `<section class="mi-section mi-authority" data-mi-section="authority" data-mi-target-count="${row.disposition.targets.length}">
      <h4>Authority</h4>
      <p class="mi-note">What this media is authority for, from the approval edges the project stores.</p>
      <ul class="mi-targets">${rows}</ul>
    </section>`;
  }

  function reviewMarkup(row) {
    if (!row.reviews.length)
      return `<section class="mi-section mi-review" data-mi-section="review" data-mi-review-count="0">
        <h4>Review</h4><p class="mi-empty">No AI review has been recorded for this media.</p></section>`;
    const rows = row.reviews.map((review) => {
      const verdict = review.verdict.pass === true ? "Passed" : review.verdict.pass === false ? "Raised issues" : "No verdict recorded";
      const evidence = review.evidence.length
        /* AN OUTCOME THE RECORD DOES NOT CARRY IS PRINTED, NOT SKIPPED. Omitting it left
           a row showing a category name and nothing else, which reads as "checked, fine"
           beside its neighbours that do carry a finding. The projection distinguishes an
           assessed result from a category no one recorded an observation about
           (public/shared-production-media.js, shotStructuredReview); this is the surface
           that has to keep them visibly apart. */
        ? `<ul class="mi-evidence">${review.evidence.map((entry) => `<li data-mi-evidence-outcome="${attr(entry.outcome.state)}"><b>${esc(entry.label.value || "Requirement")}</b>${entry.expected.state === "known" ? `<span>Expected: ${esc(entry.expected.value)}</span>` : ""}${entry.observed.state === "known" ? `<span>Observed: ${esc(entry.observed.value)}</span>` : ""}${entry.outcome.state === "known" ? `<em>${esc(entry.outcome.value)}</em>` : `<em class="mi-unknown">No recorded observation</em>`}</li>`).join("")}</ul>`
        : "";
      const blockers = review.blockers.length
        ? `<ul class="mi-blockers">${review.blockers.map((entry) => `<li><b>${esc(entry.label.value || "Issue")}</b><span>${esc(entry.note.value || "")}</span><em>${esc(entry.severity.value || "")}</em></li>`).join("")}</ul>`
        : "";
      return `<article class="mi-review-row" data-mi-review-kind="${attr(review.kind)}">
        <header>
          <b>${esc(REVIEW_KIND_WORDS[review.kind] || review.kind)}</b>
          <span data-mi-review-verdict>${esc(verdict)}${review.verdict.score != null ? ` · ${Math.round(review.verdict.score)}/100` : ""}</span>
          ${review.assessment ? `<span class="mi-review-assessed${review.assessment.assessed ? "" : " mi-unknown"}" data-mi-review-assessed="${attr(review.assessment.assessed)}" data-mi-review-categories="${attr(review.assessment.categories)}">${esc(review.assessment.assessed ? `${review.assessment.assessed} of ${review.assessment.categories} categories assessed` : "No category was assessed")}</span>` : ""}
        </header>
        <div class="mi-facts">
          ${factRow("Reviewer", review.reviewer.provider, { unknown: "Reviewer not recorded" })}
          ${factRow("Reviewer model", review.reviewer.model, { unknown: "Model not recorded" })}
          ${factRow("Reviewed", review.reviewedAt, { format: timeWords, unknown: "Time not recorded" })}
          ${review.semantic.label.state === "known" ? factRow("Declared state", review.semantic.label) : ""}
        </div>
        ${review.summary.state === "known" ? `<p class="mi-review-summary">${esc(review.summary.value)}</p>` : ""}
        ${evidence}${blockers}
      </article>`;
    }).join("");
    return `<section class="mi-section mi-review" data-mi-section="review" data-mi-review-count="${row.reviews.length}">
      <h4>Review</h4>
      <p class="mi-note">What a reviewer observed. A review raises attention; it never establishes canon.</p>
      ${rows}
    </section>`;
  }

  function provenanceMarkup(row) {
    const provenance = row.provenance;
    const jobWords = provenance.job.state === "resolved"
      ? fact(provenance.job.id)
      : provenance.job.state === "unavailable"
        ? `<b class="mi-unknown">${esc(provenance.job.id.value)} — record unavailable</b>`
        : `<b class="mi-unknown">No generation job</b>`;
    const lineage = provenance.lineage.length
      ? `<ul class="mi-lineage">${provenance.lineage.map((entry) => `<li><span>${esc(RELATION_WORDS[entry.relation] || entry.relation)}</span><b>${esc(entry.value)}</b></li>`).join("")}</ul>`
      : `<p class="mi-empty">No lineage is recorded for this media.</p>`;
    return `<section class="mi-section mi-provenance" data-mi-section="provenance" data-mi-job-state="${attr(provenance.job.state)}">
      <h4>Provenance</h4>
      ${provenance.job.state === "unavailable" ? `<p class="mi-note mi-note-warn">This media names a generation job that CineBraid does not have loaded here, so its provider record and cost cannot be read. That is different from there being no record.</p>` : ""}
      <div class="mi-facts">
        ${factRow("Provider", provenance.provider)}
        ${factRow("Model", provenance.model)}
        ${factRow("Mode", provenance.mode)}
        <article><span>Generation job</span>${jobWords}</article>
        ${factRow("Provider request", provenance.requestId)}
        ${factRow("Resolution", provenance.resolution)}
        ${costMarkup(provenance.cost)}
      </div>
      <div class="mi-prompt" data-mi-prompt="${attr(provenance.prompt.state)}">
        <span>Prompt</span>
        ${provenance.prompt.state === "known"
          ? `<pre>${esc(provenance.prompt.value)}</pre>`
          : `<p class="mi-empty">The prompt for this media was never recorded against it. CineBraid will not show the current wording of a later build as if it were the request that ran.</p>`}
      </div>
      <div class="mi-lineage-block"><span>Lineage</span>${lineage}</div>
    </section>`;
  }

  /* ==========================================================================
     ACTIONS.

     Rendered from the projection's own bounded list. This function adds no action of
     its own and cannot: `invoke()` dispatches a fixed switch over the same ids. */
  const ACTION_WORDS = {
    "open-full-preview": "Open full preview",
    "open-owner": "Open in workspace",
    "view-review": "Open review",
    approve: "Approve",
    reject: "Reject",
    restore: "Restore to candidates",
  };

  function actionsMarkup(row) {
    const buttons = row.actions.map((id) => {
      const primary = id === "approve";
      return `<button type="button" class="${primary ? "approve-btn" : "ghost-btn"}" data-mi-action="${attr(id)}"`
        + ` onclick="window.CineBraidMediaInspector.invoke('${attr(row.key)}','${attr(id)}')">${esc(ACTION_WORDS[id] || id)}</button>`;
    }).join("");
    return `<div class="modal-actions mi-actions" data-mi-action-count="${row.actions.length}">
      <button class="cancel" onclick="closeModal()">Close</button>${buttons}</div>`;
  }

  function inspectorMarkup(row) {
    return `<div class="media-inspector-modal" data-media-inspector="1" data-mi-key="${attr(row.key)}" data-mi-kind="${attr(row.kind)}" data-mi-scope="${attr(row.scope)}">
      <header>
        <div><span>MEDIA INSPECTOR</span><h3>${esc(row.file.title.state === "known" ? row.file.title.value : row.file.name)}</h3>
        <p>${esc(KIND_WORDS[row.kind] || row.kind)} · ${esc(row.identity.resolvedBy === "ledger" ? "Resolved by durable identity" : row.identity.resolvedBy === "library" ? "Resolved by project library row" : "Resolved by stored path")}</p></div>
      </header>
      <div class="media-inspector-body">
        <div class="media-inspector-stage">${previewMarkup(row)}</div>
        <div class="media-inspector-detail">
          ${identityMarkup(row)}${statusMarkup(row)}${authorityMarkup(row)}${reviewMarkup(row)}${provenanceMarkup(row)}
        </div>
      </div>
      ${actionsMarkup(row)}
    </div>`;
  }

  /* ==========================================================================
     OPENING.

     THE bounded helper the whole product uses. Every media surface calls this with a
     durable projection key and nothing else — no surface reconstructs Inspector data
     for itself, which is the property that keeps one Inspector from becoming six. */
  function inspect(key) {
    const wanted = String(key || "");
    const row = recordFor(wanted);
    if (!row) {
      INSPECTED_KEY = "";
      return toast("That media is no longer in this project");
    }
    /* SET BEFORE THE PAINT, so a decision taken from inside the modal repaints the
       record that is actually open. Cleared by close, so a stale key can never
       resurface behind a later modal. */
    INSPECTED_KEY = row.key;
    openModal(inspectorMarkup(row));
    return true;
  }

  /* Re-read and repaint the open Inspector. Called after a decision writer ran, so
     the surface shows the decision rather than the state before it. Silent when the
     Inspector is not open — a decision taken from a grid must not open one. */
  function refresh() {
    if (!INSPECTED_KEY) return false;
    const modal = document.getElementById("modal");
    if (!modal || modal.classList.contains("hidden")) return false;
    if (!modal.querySelector("[data-media-inspector]")) return false;
    const row = recordFor(INSPECTED_KEY);
    if (!row) return false;
    openModal(inspectorMarkup(row));
    return true;
  }

  /* ==========================================================================
     INVOCATION.

     A fixed switch over the projection's own action ids. Every branch calls a SHIPPED
     handler, and the action is re-read from current truth before dispatch so an
     action that stopped being valid between paint and click does nothing. */
  function invoke(key, actionId) {
    const row = recordFor(key);
    const id = String(actionId || "");
    if (!row || !row.actions.includes(id)) return false;
    const context = row.context;
    const entityList = context.entityList.value;
    const entityId = context.entityId.value;
    const shotId = context.shotId.value;
    const name = row.file.name;

    if (id === "open-full-preview") {
      /* The theatre, with the way back. `returnTo` is what stops opening the picture
         larger from costing the filmmaker the identity they were inspecting. */
      if (typeof window.openMediaTheatre !== "function") return false;
      window.openMediaTheatre(
        encodeURIComponent(row.file.url),
        encodeURIComponent(row.file.title.state === "known" ? row.file.title.value : name),
        row.file.mediaType,
        row.key,
      );
      return true;
    }

    if (id === "open-owner") {
      const route = shotId
        ? `#/shot/${encodeURIComponent(shotId)}`
        : entityList && entityId
          ? `#/${({ characters: "character", locations: "location", props: "prop", vehicles: "vehicle", audio: "sound" })[entityList] || "library"}/${encodeURIComponent(entityId)}`
          : "";
      if (!route) return false;
      closeModal();
      location.hash = route;
      return true;
    }

    if (id === "view-review") {
      closeModal();
      if (shotId && typeof window.openCandidateReview === "function") {
        window.openCandidateReview(shotId, context.frameId.value || "", name);
        return true;
      }
      if (entityList && entityId && typeof window.openEntityCandidateReview === "function") {
        window.openEntityCandidateReview(entityList, entityId, name, context.stateId.value || "");
        return true;
      }
      return false;
    }

    if (id === "approve") {
      /* The shipped approval modals. Both replace this modal with their own
         confirmation, which is deliberate: an approval names a target, and choosing
         that target is what those modals are for. */
      closeModal();
      if (shotId && typeof window.approveTake === "function") { window.approveTake(shotId, name); return true; }
      if (entityList && entityId && typeof window.approveEntityFile === "function") {
        window.approveEntityFile(entityList, entityId, name, context.stateId.value || "");
        return true;
      }
      return false;
    }

    if (id === "reject" || id === "restore") {
      if (shotId && typeof window.setCandidateDecision === "function") {
        /* The shot writer TOGGLES: `row.decision === decision ? "unreviewed" : decision`.
           So BOTH acts send "rejected" — on a candidate it rejects, and on an
           already-rejected row it clears back to unreviewed. Sending "unreviewed" for
           the restore would instead SET the literal token on a row that is not holding
           it, which is a different write from the one the shipped UI performs. */
        window.setCandidateDecision(shotId, name, "rejected");
      } else if (entityList && entityId && typeof window.setEntityCandidateDecision === "function") {
        /* The entity writer ASSIGNS rather than toggling, so the restore names the
           token it wants. Two dialects, two calls, and neither is coerced through the
           other — the constraint media-assets.js states and C2's closeout repeated. */
        window.setEntityCandidateDecision(entityList, entityId, name, id === "reject" ? "rejected" : "unreviewed");
      } else return false;
      /* The decision writers call route(), which repaints the page beneath. The
         Inspector is a modal and is not repainted by that, so it is refreshed here —
         and it must show the decision, not the state before it. */
      refresh();
      return true;
    }
    return false;
  }

  /* ==========================================================================
     THE HAND-OFF EXISTING SURFACES USE.

     A shipped thumbnail holds `{name, url, assetId?}` and nothing else, which is
     exactly what the key is made of — so a surface names its media and stops there.
     No caller assembles Inspector data, and no caller needs to know what a projection
     key looks like.

     FALLS BACK TO THE THEATRE rather than failing. Some media a filmmaker can click
     is genuinely NOT production media with a disposition — a scene-linked planning
     file, a reference the projection excludes by declaration. For those the honest
     answer is the picture, not an Inspector full of "Not recorded" implying a
     production record that was lost. The fallback is silent because it is not an
     error; it is the correct surface for that file. */
  function inspectFile(encodedUrl, assetId = "", encodedTitle = "", kind = "") {
    let url = "";
    try { url = decodeURIComponent(String(encodedUrl || "")); } catch { url = String(encodedUrl || ""); }
    const key = typeof productionMediaKeyForFile === "function"
      ? productionMediaKeyForFile({ url, assetId: String(assetId || "") })
      : "";
    if (key && recordFor(key)) return inspect(key);
    /* IDENTITY FIRST, THEN PATH — the same precedence resolveApprovalMedia() uses, and
       here for the same reason. Not every surface holds the ledger id: a blocking
       viewer works from a project-library row, and a planning thumbnail from a link.
       Those callers pass no assetId, so the key above is a `path:` key and misses the
       record whose durable key is `asset:`. Matching on the record's own stored PATH
       finds it, and the Inspector then opens under its real durable identity.

       This is not a cross-domain shortcut. Nothing here tries a library id against
       the ledger; it resolves within the path domain and lets the projection say what
       the durable identity is. */
    const built = projection();
    if (built && url) {
      const path = url.startsWith("/assets/") ? decodeURIComponent(url.slice("/assets/".length)) : "";
      const match = path ? built.records.find((row) => row.identity.path === path) : null;
      if (match) return inspect(match.key);
    }
    if (typeof window.openMediaTheatre === "function")
      return window.openMediaTheatre(encodedUrl, encodedTitle || encodedUrl, kind);
    return false;
  }

  window.inspectMedia = inspect;
  window.inspectMediaFile = inspectFile;
  window.CineBraidMediaInspector = {
    inspect,
    inspectFile,
    invoke,
    refresh,
    projection,
    recordFor,
    inspectorMarkup,
    inspectedKey: () => INSPECTED_KEY,
    clear: () => { INSPECTED_KEY = ""; },
  };
})();
