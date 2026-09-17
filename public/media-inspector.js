/* Universal read-only Media Inspector. Human decisions stay in the exact owning workflow. */

(function () {
  if (typeof document === "undefined") return;

  /* The media currently inspected, so the theatre can hand the filmmaker back and so
     a decision taken inside the Inspector can repaint the same record rather than
     guessing which one was open. A KEY, never a copy of the record: a cached record
     is a record that can be stale, and the Inspector's whole claim is that it shows
     current truth. */
  let INSPECTED_KEY = "";
  let inspectionSession=null, theatreKey="";

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
    /* Dogfood #2 A1. A pre-repair project can carry a winner edge scene
       automation wrote without anyone deciding. It is neither "approved by you"
       nor "no decision yet", and printing either would be a false statement
       about production canon in the surface built to be exact about it. */
    if (decision.state === "machine-selected") return { tone: "candidate", label: "Selected by automation", detail: "An automated run selected this. It is not an approval — approve or reject it to make a production decision.", note: "No human decision recorded" };
    /* REASON NOT RECORDED, said plainly. Neither candidate dialect has a reason field —
       public/shared-production-media.js declares that gap — so the Inspector states the
       absence rather than leaving a blank a reader would fill in for themselves, and
       rather than inferring one from a review that may have had nothing to do with the
       decision. */
    if (decision.state === "rejected") return { tone: "rejected", label: "Rejected by you", detail: "A person rejected this. It is kept as evidence.", note: "Reason not recorded" };
    return { tone: "candidate", label: "No decision yet", detail: "Nobody has approved or rejected this." };
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
    if (!url) return `<div class="mi-preview mi-preview-empty"><span>Original unavailable. The recorded asset is retained.</span></div>`;
    if (!["image","video","audio"].includes(row.file.mediaType)) return `<div class="mi-preview mi-preview-empty"><span>No preview for this media type. Inspect the original through File details.</span></div>`;
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
        ${localFileMarkup(row)}
      </div>
    </section>`;
  }

  /* LOCAL FILE AFFORDANCES V1 — a QUIET slot beside the identity domains, which is
     where it belongs: reaching the file on disk is a fact about identity, not a
     production decision.

     Deliberately NOT in the action bar. That row carries approve / reject /
     restore — acts that change what a production believes — and putting `Show in
     Explorer` beside them would give a file-manager convenience the same weight as
     an approval. It is also why these two are not added to the projection's
     `actions` list: public/shared-production-media.js decides which DECISIONS are
     valid on a piece of media, and revealing a file is not one of them.

     The slot renders itself from the shared contract and hydrates after the paint.
     This file learns no path and performs no fetch. */
  function localFileMarkup(row) {
    const local = window.CineBraidLocalFile;
    if (!local || typeof local.localFileSlotMarkup !== "function") return "";
    return local.localFileSlotMarkup(row, { label: "On this computer" });
  }

  /* Called after every paint of the Inspector, including the repaint a decision
     triggers, because the modal is rebuilt wholesale each time and the slot that
     was hydrated belonged to the markup that has just been replaced. Fire and
     forget: whether a file is on disk must never hold up a modal. */
  function hydrateLocalFile() {
    const local = window.CineBraidLocalFile;
    if (!local || typeof local.hydrateLocalFileSlots !== "function") return;
    const modal = document.getElementById("modal");
    Promise.resolve(local.hydrateLocalFileSlots(modal || document)).catch(() => {});
  }

  /* PRODUCTION STATUS, and the reason the three blocks are three blocks. A single
     badge would have to choose one of them to show, and whichever it chose would be
     read as the answer to all three questions. */
  function statusMarkup(row) {
    const decision = decisionWords(row);
    const recommendation = recommendationWords(row);
    const reviewed = row.reviews.length;
    const slotViews = window.CineBraidMediaDiscovery?.slotSelection?.(row) || null;
    return `<section class="mi-section mi-status" data-mi-section="status">
      <h4>Production status</h4>
      <div class="mi-status-grid">
        <article class="mi-decision tone-${attr(decision.tone)}" data-mi-human-decision="${attr(row.humanDecision.state)}">
          <span>Decision</span><b>${esc(decision.label)}</b><small>${esc(decision.detail)}</small>
          ${row.humanDecision.decidedAt.state === "known" ? `<em>${esc(timeWords(row.humanDecision.decidedAt.value))}</em>` : ""}
          ${decision.note ? `<em data-mi-rejection-reason="not-recorded">${esc(decision.note)}</em>` : ""}
          ${row.humanDecision.approvedWithoutAI.state === "known" ? `<i>Approved without a current AI check.</i>` : ""}
        </article>
        <article class="mi-disposition tone-${attr(row.disposition.role)}" data-mi-disposition="${attr(row.disposition.role)}">
          <span>Disposition</span><b>${esc(slotViews ? "Selected for " + slotViews.join(" · ") : { approved: "Approved", historic: "Historic selection", candidate: "Candidate", rejected: "Rejected" }[row.disposition.role] || row.disposition.role)}</b>
          <small>${esc(row.disposition.role === "approved"
            ? "This media is the authority for at least one target."
            /* EV2-7: a coverage or expression view selection is a current supporting selection. The disposition stays historic; only the words say what is recorded. */
            : slotViews
              ? "Selected as a supporting view. A view selection is not an approval, and it is not production canon."
            /* 1D-04: an edge points here, but no human approval receipt stands
               behind it. The Inspector is the surface built to be exact about
               production canon, so it says which of the two it is looking at. */
            : row.disposition.role === "historic"
              ? "Something selected this for a target, but nobody has approved it. It is not production canon until you approve it."
              : row.disposition.role === "rejected" ? "Retained so the decision stays auditable." : "Not the authority for any target.")}</small>
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
        ${factRow("Setup shown", provenance.viewMode)}
        ${costMarkup(provenance.cost)}
      </div>
      ${provenance.removedKeys.length ? `<p class="mi-note" data-mi-removed-keys="${attr(provenance.removedKeys.join(","))}">${esc(`This request did not carry ${provenance.removedKeys.join(", ")}. The generation setup that ordered it did not offer ${provenance.removedKeys.length === 1 ? "that control" : "those controls"}, so the saved default was used instead of a value nobody chose.`)}</p>` : ""}
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
  function discovery(row){return window.CineBraidMediaDiscovery?.compose(activeProject(),[row],typeof SCAN==='undefined'?[]:SCAN.mediaInventory||[]).find(r=>r.key===row.key);}
  function encodedKey(key){return encodeURIComponent(key).replace(/'/g,'%27');}
  function ownerToken(use){const c=use.context;return encodeURIComponent(JSON.stringify([use.kind,c.shotId.value,c.entityList.value,c.entityId.value,c.stateId.value,c.frameId.value,c.coverageSlotId.value,use.file.name])).replace(/'/g,"%27");}
  function ownerLabel(use){return use.kind==='shot-blocking'?'Open shot':use.context.shotId.value?'Review in '+(use.kind==='shot-motion'?'Motion Results':'Frame Results'):use.context.entityList.value==='audio'?'Review in audio workflow':use.context.entityId.value?'Review in Reference Desk':'';}
  /* EV2-7 — ONE ACTION PER DISTINCT RECORDED USE, and never the same button twice.
     Two uses that return to the same place under the same words are one destination: the words are what a reader chooses between, so two identical buttons are
     one button rendered twice. The destination is the exact place owner() navigates to — the shot and its review kind, or the entity, state and view — so two
     uses that differ in where they land keep their own action. The use row above each button names which use it belongs to; the label stays short. */
  function destinationKey(use){const c=use.context;return [ownerLabel(use),use.kind==='shot-blocking'?'shot':use.kind,c.shotId.value,c.entityList.value,c.entityId.value,c.stateId.value,c.coverageSlotId.value].join('|');}
  function destinations(uses,relationships){
    const seen=new Map();uses.forEach((use,index)=>{const label=ownerLabel(use);if(!label)return;const key=destinationKey(use);if(!seen.has(key))seen.set(key,{label,index,use,useLabel:String(relationships?.[index]?.label||'')});});
    /* Two destinations that would wear the same words are two buttons a reader cannot tell apart, so both name their exact use instead. */
    const out=[...seen.values()],counts=new Map();for(const entry of out)counts.set(entry.label,(counts.get(entry.label)||0)+1);
    for(const entry of out)if(counts.get(entry.label)>1&&entry.useLabel)entry.label='Open '+entry.useLabel;
    return out;
  }
  function ownerButton(row,entry,primary){return `<button class="rd-button${primary?' rd-primary':''}" data-mi-action="open-owner" data-mi-use="${attr(String(entry.index))}" onclick="CineBraidMediaInspector.owner(decodeURIComponent('${attr(encodedKey(row.key))}'),'${attr(ownerToken(entry.use))}')">${esc(entry.label)}</button>`;}
  /* EV2-7: labelled, separate facts. Category, decision, AI recommendation, media type and source are five different questions; none is printed inside another. */
  const AVAILABILITY_WORDS={available:'Available',missing:'Missing',unavailable:'Unavailable',unknown:'Not checked'};
  const ARTIFACT_WORDS={'reference-sheet':'Reference sheet','coverage-view':'Coverage view','primary-state':'Reference image'};
  const factItem=(key,label,value,note='')=>`<div data-md-fact="${attr(key)}"><dt>${esc(label)}</dt><dd>${esc(value)}${note?`<small>${esc(note)}</small>`:''}</dd></div>`;
  /* EV2-7 — THE NORMAL READING PATH IS SHORT: what was decided, what a reviewer suggested, and what this is. Media type, source, a recorded availability that is
     not a problem and the rights gap are true but quiet, so they sit in Details rather than competing with the decision. Nothing moved changes what is claimed. */
  function summaryMarkup(d,uses){
    const D=CineBraidMediaDiscovery,also=(d.categories||[]).filter(c=>c!==d.category),single=uses.length===1?recommendationWords(uses[0]):null;
    const summary=D.decisionSummary(d,140),structure=D.structureLabel(d),unavailable=d.availability!=='available';
    const availability=factItem('availability','Original availability',AVAILABILITY_WORDS[d.availability]||d.availability);
    return `<section class="mi-section md-summary"><dl class="md-facts">${factItem('decision','Decision',summary.text,summary.uses.length>1?'One line per recorded use below.':'')}${factItem('ai','AI recommendation',single?single.label:'Shown for each use below','Advisory only. An AI recommendation is not an approval.')}${factItem('category','Category',D.categoryLabel(d.category),also.length?'Also: '+also.map(D.categoryLabel).join(' · '):'')}${unavailable?availability:''}</dl><details class="mi-quiet"><summary>Details</summary><dl class="md-facts">${unavailable?'':availability}${factItem('type','Media type',D.typeLabel(d.type))}${factItem('source','Source',D.sources[d.source]||'Not recorded')}${structure?factItem('structure','Artifact structure',structure):''}${factItem('rights','Rights','Rights not recorded','Rights knowledge does not establish clearance or prohibit use.')}</dl></details></section>`;
  }
  function useFactsMarkup(use,rel,heading=''){
    const used=(rel.usedIn||[]).map(u=>u.label+(u.inherited?' (via shot)':'')).join(' · '),artifact=use.kind==='entity-reference'&&ARTIFACT_WORDS[use.context.workflow?.value]||'';
    /* The row's own heading already names the owner; repeating it as "Belongs to" is the same name twice. */
    const belongs=(rel.belongsTo||[]).map(b=>b.label).join(' · ')||'Project library',owned=!!heading&&(heading===belongs||heading.startsWith(belongs+' · '));
    return `<dl class="md-facts md-use-facts">${owned?'':factItem('belongs','Belongs to',belongs)}${factItem('used','Used in',used||'No recorded production use')}${artifact?factItem('artifact','Artifact',artifact):''}${rel.decision==='selected'?factItem('use-decision','Decision','Selected for '+rel.selectedFor.join(' · '),'A view selection is not an approval.'):factItem('use-decision','Decision',decisionWords(use).label)}${factItem('use-ai','AI recommendation',recommendationWords(use).label)}</dl>`;
  }
  function inspectorMarkup(row) {
    const d=discovery(row),uses=row.relationships?.length?row.relationships:[row],D=CineBraidMediaDiscovery;
    /* One destination action, in one place: in the footer when the whole asset returns to a single place, otherwise on the use row it belongs to. */
    const routes=destinations(uses,d.relationships),single=routes.length===1,byUse=new Map(routes.map(entry=>[entry.index,entry]));
    const preview=row.file.url&&['image','video','audio'].includes(row.file.mediaType)?`<button class="ghost-btn" data-mi-action="open-full-preview" onclick="CineBraidMediaInspector.invoke(decodeURIComponent('${attr(encodedKey(row.key))}'),'open-full-preview')">Open full preview</button>`:'';
    return `<div class="media-inspector-modal md-inspector" data-media-inspector="1" data-mi-key="${attr(row.key)}" data-mi-kind="${attr(row.kind)}" data-mi-scope="${attr(row.scope)}"><header><div><span>Media Inspector</span><h3>${esc(d.title)}</h3><p>${esc(D.contextLine(d.related.map(r=>r.label),3)||'Project media')}</p></div><button class="cancel" onclick="CineBraidMediaInspector.dismiss()">${inspectionSession?.resume?'Back to selection':'Close'}</button></header><div class="media-inspector-body"><div class="media-inspector-stage">${previewMarkup({...row,file:{...row.file,url:d.url,mediaType:d.type}})}</div><div class="media-inspector-detail">${summaryMarkup(d,uses)}<section class="mi-section mi-uses" data-mi-section="uses" data-mi-use-count="${uses.length}"><h4>Recorded uses</h4>${uses.map((use,i)=>{const heading=d.relationships[i].label,entry=byUse.get(i);return `<article class="md-use" data-mi-use-row="${i}"><b>${esc(heading)}</b>${useFactsMarkup(use,d.relationships[i],heading)}${use.availability?.state&&use.availability.state!=='available'?`<p>This recorded use is ${esc(use.availability.state)}. Review its binding in the owning workflow.</p>`:''}${authorityMarkup(use)}${entry&&!single?ownerButton(row,entry,false):''}</article>`;}).join('')}</section><details class="mi-quiet"><summary>Review &amp; AI recommendation</summary>${uses.map(use=>statusMarkup(use)+reviewMarkup(use)).join('')}</details><details class="mi-quiet"><summary>Details · origin, cost and file identifiers</summary>${uses.map(use=>provenanceMarkup(use)).join('')}${identityMarkup(row)}</details></div></div><footer class="modal-actions mi-actions">${single?ownerButton(row,routes[0],true):routes.length?'':'<span>No decision workflow is recorded for this asset.</span>'}${preview}</footer></div>`;
  }
  /* A card repainted while the Inspector was open is found again by its durable key, so Close returns to the same identity. */
  function returnTarget(key){return document.querySelector('[data-md] [data-md-open="'+CSS.escape(key)+'"]');}
  function inspectInventory(row,options={}){
    inspectionSession={...options,origin:CineBraidMediaReturn.capture({resume:options.resume})};INSPECTED_KEY=row.key;
    const visual=row.availability==='available'?(row.type==='image'?`<img src="${attr(row.url)}" alt="${attr(row.title)}">`:row.type==='video'?`<video controls preload="metadata" src="${attr(row.url)}"></video>`:row.type==='audio'?`<audio controls preload="metadata" src="${attr(row.url)}"></audio>`:'<p>No preview for this media type.</p>'):`<p>Original ${esc(row.availability)}. The asset record is retained.</p>`;
    const D=CineBraidMediaDiscovery,also=(row.categories||[]).filter(c=>c!==row.category);
    const markup=`<div class="md-inspector media-inspector-modal" data-media-inspector><header><h3>${esc(row.title)}</h3><button class="cancel" onclick="CineBraidMediaInspector.dismiss()">${options.resume?'Back to selection':'Close'}</button></header><div class="media-inspector-body"><div class="media-inspector-stage mi-preview">${visual}</div><div class="media-inspector-detail"><h4>Production media</h4><dl class="md-facts">${factItem('category','Category',D.categoryLabel(row.category),also.length?'Also: '+also.map(D.categoryLabel).join(' · '):'')}${factItem('decision','Decision',D.decisionLabel(row),'No target-specific decision is recorded.')}${factItem('type','Media type',D.typeLabel(row.type))}${factItem('source','Source',D.sources[row.source]||'Not recorded')}${factItem('availability','Original availability',AVAILABILITY_WORDS[row.availability]||row.availability)}</dl><p>Rights not recorded</p><p>Adding a reference candidate does not approve it.</p><details><summary>File details &amp; identifiers</summary><p>${esc(row.assetId)}</p><p>${esc(row.fileName)}</p>${row.availability==='available'?`<a href="${attr(row.url)}" target="_blank" rel="noopener">Open original</a>`:''}</details></div></div></div>`;
    if(options.resume)updateOpenModal(markup);else openModal(markup,{resolveReturnFocus:()=>returnTarget(row.key)});
    document.querySelector("[data-media-inspector] .cancel")?.focus({preventScroll:true});
  }
  document.addEventListener?.('keydown',event=>{if(event.key==='Escape'&&theatreKey&&document.querySelector('.media-theatre-modal')){event.preventDefault();event.stopImmediatePropagation();inspect(theatreKey);return;}if(event.key==='Escape'&&inspectionSession?.resume&&document.querySelector('[data-media-inspector]')){event.preventDefault();event.stopImmediatePropagation();dismiss();}},true);
  function dismiss(){if(inspectionSession?.resume){const resume=inspectionSession.resume;inspectionSession=null;INSPECTED_KEY='';resume();}else closeModal();}
  function owner(key,token=""){
    const row=recordFor(key);if(!row)return false;const uses=row.relationships?.length?row.relationships:[row];const use=token?uses.find(use=>ownerToken(use)===token):uses[0];if(!use)return toast("This recorded use changed. Close the Inspector and inspect it again.");
    const c=use.context,shot=c.shotId.value,list=c.entityList.value,id=c.entityId.value;let hash='';
    if(shot){hash=use.kind==='shot-blocking'?'#/shot/'+encodeURIComponent(shot):typeof shotReviewHref==='function'?shotReviewHref(shot,use.key):'#/shot/'+encodeURIComponent(shot);}
    else if(list==='audio'&&id){hash='#/sound/'+encodeURIComponent(id);}
    else if(id&&list){if(!window.CineBraidReferenceDesk?.selectContext({list,id,stateId:c.stateId.value||'',candidateName:use.file.name,assetId:use.identity.ledger.value||''}))return toast('This reference use changed. Return and refresh the project.');hash=window.CineBraidResults&&c.stateId.value?CineBraidResults.href({list,id,stateId:c.stateId.value,slotId:c.coverageSlotId.value||''},use.key+'|'+use.file.name):'#/'+({characters:'character',locations:'location',props:'prop',vehicles:'vehicle',audio:'sound'}[list]||'library')+'/'+encodeURIComponent(id);}
    if(!hash)return false;
    return CineBraidMediaReturn.go(hash,inspectionSession?.origin||CineBraidMediaReturn.capture());
  }

  /* ==========================================================================
     OPENING.

     THE bounded helper the whole product uses. Every media surface calls this with a
     durable projection key and nothing else — no surface reconstructs Inspector data
     for itself, which is the property that keeps one Inspector from becoming six. */
  function inspect(key, options={}) {
    const wanted = String(key || "");
    const row = recordFor(wanted);
    if (!row) {
      const inventory=typeof SCAN==='undefined'?[]:SCAN.mediaInventory||[];
      const model=CineBraidMediaDiscovery.compose(activeProject(),[],inventory).find(r=>r.key===wanted);
      if(model)return inspectInventory(model,options);
      INSPECTED_KEY = "";
      return toast("That media is no longer in this project");
    }
    /* SET BEFORE THE PAINT, so a decision taken from inside the modal repaints the
       record that is actually open. Cleared by close, so a stale key can never
       resurface behind a later modal. */
    const already=!!document.querySelector("#modal:not(.hidden) [data-media-inspector]");
    if(!already&&theatreKey!==wanted)inspectionSession={...options,origin:options.origin||CineBraidMediaReturn.capture({resume:options.resume})};
    INSPECTED_KEY = row.key;
    if(options.resume||already||theatreKey===wanted)updateOpenModal(inspectorMarkup(row));else openModal(inspectorMarkup(row),{resolveReturnFocus:()=>returnTarget(row.key)});
    theatreKey="";
    document.querySelector("[data-media-inspector] .cancel")?.focus({preventScroll:true});
    hydrateLocalFile();
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
    updateOpenModal(inspectorMarkup(row));
    hydrateLocalFile();
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
      theatreKey=row.key;
      window.openMediaTheatre(
        encodeURIComponent(row.file.url),
        encodeURIComponent(row.file.title.state === "known" ? row.file.title.value : name),
        row.file.mediaType,
        row.key,
      );
      return true;
    }

    if (id === "open-owner") return owner(key);
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
    inspectInventory,
    dismiss,
    owner,
    invoke,
    refresh,
    projection,
    recordFor,
    inspectorMarkup,
    inspectedKey: () => INSPECTED_KEY,
    clear: () => { INSPECTED_KEY = ""; theatreKey=""; inspectionSession=null; },
  };
})();
