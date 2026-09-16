/* Production contact sheet. Legacy card helpers remain available to existing local surfaces. */

(function () {
  if (typeof window === "undefined") return;

  const RESULTS_TABS = ["current", "approved", "candidates", "rejected"];
  const RESULTS_PAGE_SIZE = 48;

  /* The context filter, derived from the projection's own media kinds. `all` is a
     view rather than a kind, so it is not in PRODUCTION_MEDIA_KINDS and is added here
     where it belongs — to the filter, not to the vocabulary. */
  const RESULTS_KIND_FILTERS = [
    ["all", "All media"],
    ["entity-reference", "References"],
    ["shot-still", "Frames"],
    ["shot-motion", "Motion"],
    ["shot-blocking", "Blocking"],
    ["project-media", "Planning"],
  ];

  function resultsFilterKey() {
    return "results-kind";
  }

  function currentKindFilter() {
    const stored = typeof boundedReadState === "function" ? boundedReadState("filter", resultsFilterKey(), "all") : "all";
    return RESULTS_KIND_FILTERS.some(([value]) => value === stored) ? stored : "all";
  }

  window.setResultsKindFilter = (value) => {
    if (typeof boundedWriteState === "function") boundedWriteState("filter", resultsFilterKey(), value);
    /* The page index belongs to the previous filter's result set, so it is reset
       rather than carried: page 3 of references is not page 3 of motion, and landing
       on an empty page after a filter change reads as "there is nothing here". */
    if (typeof boundedWriteState === "function") boundedWriteState("page:results", "all", 0);
    if (typeof route === "function") route();
  };

  /* ==========================================================================
     ORDERING.

     RELIABLE RECORDED FIELDS ONLY. `addedAt` is used where it is recorded and rows
     that never recorded one sort LAST rather than being given a zero date — a missing
     timestamp treated as 1970 would put the oldest-looking media at the bottom while
     claiming to know when it arrived. Ties fall back to the filename, which is stable
     and is the order the scan already returned. */
  function orderRecords(rows, pinApproved) {
    return [...rows].sort((a, b) => {
      const timeA = a.file.addedAt.state === "known" ? a.file.addedAt.value : "";
      const timeB = b.file.addedAt.state === "known" ? b.file.addedAt.value : "";
      if (timeA && timeB && timeA !== timeB) return timeB.localeCompare(timeA);
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;
      return String(a.file.name).localeCompare(String(b.file.name));
    });
  }

  function tabRecords(records, tab) {
    if (tab === "approved") return records.filter((row) => row.disposition.role === "approved");
    /* 1D-04: a HISTORIC row is a selection something made and nobody approved,
       so it sits with the work that is not canon yet — which is what it is —
       and carries its own status word on the card so the distinction from a
       plain candidate stays visible. Deliberately NOT a fifth tab: the tabs
       answer "is this canon", and historic and candidate share that answer. */
    if (tab === "candidates") return records.filter((row) => ["candidate", "historic"].includes(row.disposition.role));
    if (tab === "rejected") return records.filter((row) => row.disposition.role === "rejected");
    /* current — everything a filmmaker is still working with. */
    return records.filter((row) => row.disposition.role !== "rejected");
  }

  /* ==========================================================================
     THE CARD.

     The media is visually primary and the status is a small overlay on it, which is
     the difference between a production review surface and a photo gallery. Every
     card is a BUTTON that opens the Inspector — one interaction, everywhere, so a
     filmmaker never has to learn which grid enlarges and which navigates. */
  /* `options.action` lets another surface reuse this exact card to RETURN A
     SELECTION instead of opening the Inspector. It is the only thing a caller may
     change, and it changes nothing about what the card SAYS: the status word, the
     authority line and the AI-suggested marker are still this function's, so a
     picker cannot quietly present a rejected or unapproved file as something else.
     Omitted — which is every existing call — the card opens the Inspector exactly
     as before. */
  function cardMarkup(row, options = {}) {
    const action = typeof options.action === "function" ? options.action(row) : "";
    const url = row.file.url;
    const preview = !url
      ? `<div class="results-card-empty">Missing file</div>`
      : row.file.mediaType === "video"
        ? `<video muted preload="metadata" src="${attr(url)}#t=0.1"></video>`
        : row.file.mediaType === "audio"
          ? `<div class="results-card-audio">AUDIO</div>`
          : `<img loading="lazy" src="${attr(url)}" alt="">`;
    const owner = row.context.shotId.state === "known"
      ? `${row.context.shotId.value}${row.context.frameLabel.state === "known" ? ` · Frame ${row.context.frameLabel.value}` : ""}`
      : row.context.entityName.state === "known" ? row.context.entityName.value : "Project";
    const kindWords = {
      "entity-reference": "Reference",
      "shot-still": "Frame",
      "shot-motion": "Motion",
      "shot-blocking": "Blocking",
      "project-media": "Planning",
    }[row.kind] || row.kind;
    /* THE STATUS WORD IS THE DISPOSITION AND ONLY THE DISPOSITION. An AI
       recommendation gets its own separate marker below and can never be painted into
       this chip, because a card that said APPROVED because a model liked it is the
       exact confusion the whole batch exists to end. */
    /* 1D-04: HISTORIC is the fourth word, and it is the one that stops Results
       telling a filmmaker they approved something they did not. It reads as its
       own status on the card rather than borrowing APPROVED or hiding as a
       plain candidate. */
    const statusWord = { approved: "APPROVED", historic: "HISTORIC", candidate: "CANDIDATE", rejected: "REJECTED" }[row.disposition.role] || "";
    /* PT2 — A FLAG IS NOT A SUGGESTION, AND THIS CHIP USED TO SAY IT WAS.

       The condition was `row.aiRecommendation.state === "known"`, which tests
       whether a review EXISTS, not what it CONCLUDED. `state` is "known" for every
       value in the vocabulary, and a failing shot triage maps to `correct` — so
       three candidates, two of them flagged, all wore AI SUGGESTED, and a flagged
       asset collected decision weight it had not earned.

       The projection already carries the value; this reads it. `approve` is the one
       member of PRODUCTION_MEDIA_RECOMMENDATIONS that is affirmative, so it is the
       one that may wear an affirmative word. The other three are shown — a review
       that concluded something is not hidden — under a word that says what they
       are. Neither chip is a decision: the Inspector states the same distinction at
       length, and the status chip beside this one is still the disposition alone. */
    const recommendationValue = row.aiRecommendation.state === "known" ? String(row.aiRecommendation.value || "") : "";
    const recommended = row.disposition.role === "approved" || !recommendationValue
      ? ""
      : recommendationValue === "approve"
        ? `<span class="results-card-ai" title="An AI reviewer suggested this. It is not an approval.">AI SUGGESTED</span>`
        : `<span class="results-card-ai is-flagged" title="An AI reviewer flagged this. It is not an approval and it is not a suggestion.">AI FLAGGED</span>`;
    const authority = row.disposition.targets.length
      ? `<small class="results-card-authority">${esc(row.disposition.targets.map((target) => target.label || target.kind).slice(0, 2).join(" · "))}</small>`
      : "";
    return `<button type="button" class="results-card role-${attr(row.disposition.role)}"
      data-results-card="1" data-mi-key="${attr(row.key)}" data-role="${attr(row.disposition.role)}" data-kind="${attr(row.kind)}"
      onclick="${action || `window.inspectMedia('${attr(row.key)}')`}"
      aria-label="${attr(`${action ? "Choose" : "Inspect"} ${row.file.name} — ${statusWord.toLowerCase()}`)}">
      <span class="results-card-media">${preview}<span class="results-card-status status-${attr(row.disposition.role)}">${esc(statusWord)}</span>${recommended}</span>
      <span class="results-card-body"><span class="results-card-kind">${esc(kindWords)}</span><b>${esc(owner)}</b><small>${esc(row.file.name)}</small>${authority}</span>
    </button>`;
  }

  /* ==========================================================================
     THE VIEW. */
  const discoveryStates=new Map();
  function resultsView() {
    const built=window.CineBraidMediaInspector?.projection?.();
    if(!built)return '<div class="empty-state"><h2>Production media is unavailable</h2><p>Reload the project to try again.</p></div>';
    const key=ACTIVE_PROJECT_SLUG+':'+PROJECT_OPEN_EPOCH;
    if(!discoveryStates.has(key))discoveryStates.set(key,CineBraidMediaDiscovery.defaults());
    const state=discoveryStates.get(key);
    const records=()=>CineBraidMediaDiscovery.compose(P,window.CineBraidMediaInspector.projection()?.records||[],SCAN.mediaInventory||[]);
    return '<section class="production-contact-sheet"><header class="md-heading"><p>Production</p><h1>Production media</h1><p>Find your media. See where it belongs. Return to the work.</p></header>'+CineBraidMediaBrowser.mount('production',{state,records,select:row=>window.inspectMedia(row.key)})+(built.unresolvedReferences?.length?'<details class="md-unresolved"><summary>'+built.unresolvedReferences.length+' references need identity or availability attention</summary><p>These records have no resolvable media identity. Open their owning reference to inspect the recorded assignment.</p>'+built.unresolvedReferences.map(r=>'<p>'+esc(r.context.entityName.value||'Reference')+' · '+esc(r.file.name)+'</p>').join('')+'</details>':'')+'</section>';
  }

  window.addEventListener?.('cinebraid:route-rendered',()=>document.body.classList.toggle('production-media-active',!!document.querySelector('.production-contact-sheet')));
  window.resultsView = resultsView;
  window.CineBraidResults = {
    RESULTS_TABS,
    RESULTS_KIND_FILTERS,
    resultsView,
    openRelated(related) {
      const key=ACTIVE_PROJECT_SLUG+':'+PROJECT_OPEN_EPOCH;
      discoveryStates.set(key,{...CineBraidMediaDiscovery.defaults(),related,decision:'all'});
      location.hash='#/results';
    },
    orderRecords,
    tabRecords,
    cardMarkup,
    currentKindFilter,
  };
})();
