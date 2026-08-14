/* CineBraid — Generated Media, the project-level destination for production results.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: there is ONE place a filmmaker can
   go to find everything CineBraid has created or accepted into this production, and
   it agrees with every stage-local grid because all of them read the same projection.

   ---------------------------------------------------------------------------
   THE NAME. "Generated Media" rather than "Results", and rather than "Library".

   `#/library` already ships under the label REFERENCES and is a list of ENTITIES —
   characters, locations, props — not of files. Calling this one Library would put two
   different nouns behind one word in the same navigation. "Results" was the other
   candidate and was rejected because the surface also holds imported and hand-made
   media that CineBraid did not produce; "Generated Media" is what the product calls
   the thing a filmmaker is actually looking for ("where did that generation go"), and
   the imported rows sit inside it as an acknowledged minority rather than the label
   being wrong for the majority. The ROUTE is `#/results` because that is what the
   destination IS to the workflow, and the route name is not visible to a filmmaker.

   ---------------------------------------------------------------------------
   WHAT THIS IS NOT.

   * NOT A FILE BROWSER. It shows production media with a disposition, an owner and a
     provenance. Caches, sidecars, backups and locked delivery copies are excluded by
     public/shared-production-media.js and the exclusions are declared there.

   * NOT A DAM. No folders, no tags, no saved searches, no bulk operations, no query
     language. Four status views and one context filter, both derived from fields the
     records actually carry.

   * NOT A REPLACEMENT FOR STAGE-LOCAL MEDIA. A shot's own candidate grid is where a
     filmmaker works; this is where they look when they do not know where something
     went. Both now open the same Inspector.

   * NOT A SECOND OPINION. Every disposition, every count and every badge comes out of
     the projection. This file sorts and paginates. It decides nothing.

   ---------------------------------------------------------------------------
   THE DEFAULT VIEW IS "CURRENT", and that is the whole ordering argument.

   A destination that opens on ALL buries the two things a filmmaker came for —
   what is approved, and what is waiting on them — under every rejected take the
   production has ever produced. So the default shows approved and candidate media
   with APPROVED PINNED FIRST, and rejected work is one visible click away rather than
   hidden. Nothing is dropped: `Rejected` is a tab with a count, and the count is
   rendered even when it is large, because a surface that hides its own history reads
   as a surface that lost it. */

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
      if (pinApproved) {
        const rank = (row) => (row.disposition.role === "approved" ? 0 : 1);
        const byRole = rank(a) - rank(b);
        if (byRole) return byRole;
      }
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
    if (tab === "candidates") return records.filter((row) => row.disposition.role === "candidate");
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
  function cardMarkup(row) {
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
    const statusWord = { approved: "APPROVED", candidate: "CANDIDATE", rejected: "REJECTED" }[row.disposition.role] || "";
    const recommended = row.aiRecommendation.state === "known" && row.disposition.role !== "approved"
      ? `<span class="results-card-ai" title="An AI reviewer suggested this. It is not an approval.">AI SUGGESTED</span>`
      : "";
    const authority = row.disposition.targets.length
      ? `<small class="results-card-authority">${esc(row.disposition.targets.map((target) => target.label || target.kind).slice(0, 2).join(" · "))}</small>`
      : "";
    return `<button type="button" class="results-card role-${attr(row.disposition.role)}"
      data-results-card="1" data-mi-key="${attr(row.key)}" data-role="${attr(row.disposition.role)}" data-kind="${attr(row.kind)}"
      onclick="window.inspectMedia('${attr(row.key)}')"
      aria-label="${attr(`Inspect ${row.file.name} — ${statusWord.toLowerCase()}`)}">
      <span class="results-card-media">${preview}<span class="results-card-status status-${attr(row.disposition.role)}">${esc(statusWord)}</span>${recommended}</span>
      <span class="results-card-body"><span class="results-card-kind">${esc(kindWords)}</span><b>${esc(owner)}</b><small>${esc(row.file.name)}</small>${authority}</span>
    </button>`;
  }

  /* ==========================================================================
     THE VIEW. */
  function resultsView(tab = "current") {
    if (!RESULTS_TABS.includes(tab)) tab = "current";
    if (typeof productionMediaRecords !== "function" || typeof P === "undefined" || !P)
      return `<div class="empty-state"><h2>Generated Media is unavailable</h2><p>The production media projection did not load.</p></div>`;

    const built = window.CineBraidMediaInspector?.projection?.() || null;
    const records = built ? built.records : [];
    const counts = built ? built.counts : { total: 0, approved: 0, candidate: 0, rejected: 0 };
    const kindFilter = currentKindFilter();

    const inTab = tabRecords(records, tab);
    const filtered = kindFilter === "all" ? inTab : inTab.filter((row) => row.kind === kindFilter);
    const ordered = orderRecords(filtered, tab === "current");
    const page = boundedPage(ordered, "results", "all", RESULTS_PAGE_SIZE);
    const pager = boundedPagerMarkup("results", "all", page, "media");

    const tabs = workspaceTabs("results", tab, [
      ["current", "Current", counts.approved + counts.candidate],
      ["approved", "Approved", counts.approved],
      ["candidates", "Candidates", counts.candidate],
      ["rejected", "Rejected", counts.rejected],
    ]);

    /* Counts on the kind filter are computed over the CURRENT TAB, so a number never
       promises media the click will not show. */
    const kindChips = RESULTS_KIND_FILTERS.map(([value, label]) => {
      const count = value === "all" ? inTab.length : inTab.filter((row) => row.kind === value).length;
      return `<button type="button" class="results-kind-chip ${kindFilter === value ? "on" : ""}" data-results-kind="${attr(value)}"
        onclick="setResultsKindFilter('${attr(value)}')" aria-pressed="${kindFilter === value ? "true" : "false"}">${esc(label)} <span>${count}</span></button>`;
    }).join("");

    /* THE LEDGER NOTICE, printed rather than swallowed. When the generation ledger was
       never loaded, every provenance block in this project will say so; saying it once
       here as well is the difference between a surface that looks incomplete and one
       that explains why. */
    const ledgerNote = built && built.jobsAvailable === false
      ? `<p class="results-notice" data-results-ledger="unavailable">Generation records are not loaded in this session, so provider, model and cost cannot be shown for generated media. Disposition, authority and review are unaffected.</p>`
      : "";

    const collapsed = built && built.duplicatesCollapsed > 0
      ? `<p class="results-notice" data-results-collapsed="${built.duplicatesCollapsed}">${esc(`${built.duplicatesCollapsed} file${built.duplicatesCollapsed === 1 ? "" : "s"} reachable from more than one place ${built.duplicatesCollapsed === 1 ? "is" : "are"} shown once, by durable identity.`)}</p>`
      : "";

    const empty = tab === "rejected"
      ? `<div class="empty-state"><h2>Nothing has been rejected</h2><p>Rejected media is kept here as evidence of a decision, not deleted.</p></div>`
      : counts.total
        ? `<div class="empty-state"><h2>No media matches this filter</h2><p>Change the status view or the media filter to see the other ${plural(counts.total, "file")} in this production.</p></div>`
        : `<div class="empty-state"><div class="empty-mark">◎</div><h2>No production media yet</h2><p>Generated, imported and approved media appears here as soon as this production has some.</p></div>`;

    return `<div class="view-head"><div><div class="eyebrow">Generated Media</div><span class="view-title">Generated Media</span>
      <div class="view-sub">Everything CineBraid has created or accepted into this production, with what it is authority for.</div></div></div>
      ${tabs}
      <div class="results-controls" role="group" aria-label="Filter by media kind">${kindChips}</div>
      ${ledgerNote}${collapsed}${pager}
      <div class="results-grid" data-results-grid="1" data-results-tab="${attr(tab)}" data-results-count="${page.rows.length}">
        ${page.rows.map(cardMarkup).join("") || empty}
      </div>
      ${pager}`;
  }

  window.resultsView = resultsView;
  window.CineBraidResults = {
    RESULTS_TABS,
    RESULTS_KIND_FILTERS,
    resultsView,
    orderRecords,
    tabRecords,
    cardMarkup,
    currentKindFilter,
  };
})();
