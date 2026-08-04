/* CineBraid v6.5.0 — Reports & Production Intelligence. */
const REPORTS_FILTER = { status: "", target: "", page: 0 };
let REPORTS_REFRESH_TOKEN = 0;

function reportsTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toLocaleString() : "—";
}
function reportsDuration(run) {
  const start = Date.parse(run?.createdAt || "");
  const end = Date.parse(run?.completedAt || run?.updatedAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const total = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
function reportsStatusTone(status) {
  return status === "completed" ? "done" : ["failed", "cancelled", "interrupted"].includes(status) ? "failed" : ["running", "awaiting-review"].includes(status) ? "active" : "pending";
}
function reportsStatusLabel(status) { return String(status || "unknown").replace(/-/g, " ").toUpperCase(); }
function reportsRunTypeLabel(type) { return String(type || "automation").replace(/-/g, " ").toUpperCase(); }
function reportsTargetOptions(rows) {
  return (rows || []).map((row) => `<option value="${attr(row.id)}" ${REPORTS_FILTER.target === row.id ? "selected" : ""}>${esc(row.label)} · ${esc(row.id)}</option>`).join("");
}
window.setReportsFilter = (key, value) => { REPORTS_FILTER[key] = value; REPORTS_FILTER.page = 0; route(); };
window.setReportsPage = (value) => { REPORTS_FILTER.page = Math.max(0, Number(value) || 0); route(); };
window.openAutomationReport = (runId) => { location.hash = `#/reports/${encodeURIComponent(runId || "")}`; };

function reportsHistoryMarkup(runs, selectedId, meta = {}, targetOptions = []) {
  const total = Number(meta.total || 0), page = Number(meta.page || 0), pages = Math.max(1, Number(meta.pages || 1)), pageSize = Number(meta.pageSize || 50);
  const start = total ? page * pageSize + 1 : 0, end = Math.min(total, (page + 1) * pageSize);
  const pager = pages > 1 ? `<nav class="bounded-pager" aria-label="Report pages"><button type="button" ${page <= 0 ? "disabled" : ""} onclick="setReportsPage(${page - 1})">Previous</button><span>${start}–${end} of ${total}</span><button type="button" ${page >= pages - 1 ? "disabled" : ""} onclick="setReportsPage(${page + 1})">Next</button></nav>` : "";
  return `<section class="reports-history bounded-source-section"><header><div><span>RUN HISTORY</span><h2>${plural(total, "automation run")}</h2>${total > pageSize ? `<p>Showing ${pageSize} runs at a time.</p>` : ""}</div></header><div class="reports-filters"><label><span>Status</span><select onchange="setReportsFilter('status',this.value)"><option value="">All statuses</option>${["running","awaiting-review","completed","failed","interrupted","cancelled","archived"].map((status) => `<option value="${status}" ${REPORTS_FILTER.status === status ? "selected" : ""}>${esc(reportsStatusLabel(status))}</option>`).join("")}</select></label><label><span>Target</span><select onchange="setReportsFilter('target',this.value)"><option value="">All targets</option>${reportsTargetOptions(targetOptions)}</select></label></div>${pager}<div class="reports-run-list">${runs.map((run) => `<a class="reports-run-row state-${attr(reportsStatusTone(run.status))} ${run.id === selectedId ? "selected" : ""}" href="#/reports/${encodeURIComponent(run.id)}"><div><span>${esc(reportsRunTypeLabel(run.type))}</span><b>${esc(run.label || run.targetId || run.id)}</b><small>${esc(run.targetId || "No target")} · ${esc(run.stage || run.summary || "No stage recorded")}</small></div><div class="reports-run-facts"><span><b>${Number(run.revision || 0)}</b> revision</span><span><b>${Number(run.usage?.imagesGenerated || 0)}</b> images</span><span><b>${Number(run.usage?.imageRequests || 0)}</b> requests</span><span><b>${esc(reportsDuration(run))}</b> elapsed</span></div><div class="reports-run-status"><b>${esc(reportsStatusLabel(run.status))}</b><small>${esc(reportsTime(run.updatedAt || run.createdAt))}</small></div></a>`).join("") || `<div class="reports-empty"><b>No runs match these filters.</b><span>Change the status or target filter to see more history.</span></div>`}</div>${pager}</section>`;
}

function reportsTimelineMarkup(run) {
  const steps = Object.values(run?.steps || {}).sort((a, b) => String(a.startedAt || a.updatedAt || "").localeCompare(String(b.startedAt || b.updatedAt || "")));
  return `<div class="reports-timeline">${steps.map((step) => `<article class="state-${attr(reportsStatusTone(step.status))}"><i>${step.status === "completed" || step.status === "skipped" ? "✓" : step.status === "failed" ? "×" : step.status === "running" ? "●" : step.status === "needs-review" ? "!" : "○"}</i><div><b>${esc(step.label || step.key)}</b><span>${esc(typeof v641StepSystem === "function" ? v641StepSystem(step) : step.kind || "CineBraid")}${Number(step.attempt || 0) ? ` · attempt ${Number(step.attempt)}${Number(step.maxAttempts || 0) ? `/${Number(step.maxAttempts)}` : ""}` : ""}</span>${step.error ? `<p>${esc(step.error)}</p>` : ""}</div><small>${esc(reportsStatusLabel(step.status))}</small></article>`).join("") || `<div class="reports-empty"><span>No steps were recorded for this run.</span></div>`}</div>`;
}
function reportsPromptsMarkup(prompts) {
  return `<div class="reports-record-stack">${(prompts || []).map((row, index) => `<details><summary><div><span>PROMPT ${index + 1}</span><b>${esc(row.label || row.key || "Prompt revision")}</b></div><small>${esc(row.packageId || row.buildId || "No package ID")}</small></summary>${row.prompt ? `<pre>${esc(row.prompt)}</pre>` : ""}${row.revision ? `<div class="reports-revision"><b>Revision</b><p>${esc(row.revision)}</p></div>` : ""}</details>`).join("") || `<div class="reports-empty"><span>No prompt revisions were recorded.</span></div>`}</div>`;
}
function reportsReviewsMarkup(reviews) {
  return `<div class="reports-record-stack">${(reviews || []).map((row) => `<details><summary><div><span>REVIEW</span><b>${esc(row.label || row.key || "Candidate review")}</b></div><small>${Number.isFinite(Number(row.score)) ? `${Math.round(Number(row.score))}/100` : "No score"} · ${row.pass === true ? "PASS" : row.pass === false ? "FLAGGED" : "NO DISPOSITION"}</small></summary><div class="reports-review-facts"><span>Winner: <b>${esc(row.winner || "None")}</b></span><span>Attempt: <b>${Number(row.attempt || 0)}</b></span><span>Files: <b>${(row.files || []).length}</b></span></div><pre>${esc(JSON.stringify(row.review || {}, null, 2))}</pre>${row.revision ? `<div class="reports-revision"><b>Next-round revision</b><p>${esc(row.revision)}</p></div>` : ""}</details>`).join("") || `<div class="reports-empty"><span>No structured reviews were recorded.</span></div>`}</div>`;
}
function reportsProviderJobsMarkup(jobs) {
  return `<div class="reports-provider-grid">${(jobs || []).map((job) => `<article class="state-${attr(reportsStatusTone(String(job.status || "").toLowerCase()))}"><header><span>${esc(String(job.purpose || "generation").toUpperCase())}</span><b>${esc(job.status || "UNKNOWN")}</b></header><p>${esc(job.model || "GPT Image 2")}</p><small>${Number(job.outputCount || 0)} outputs · ${esc(job.id || "No job ID")}</small>${job.providerRequestId || job.requestId ? `<code>${esc(job.providerRequestId || job.requestId)}</code>` : ""}${job.automationStepKey || job.operationKey ? `<small>Operation key: <b>${esc(job.automationStepKey || job.operationKey)}</b></small>` : ""}${job.error ? `<p class="reports-error">${esc(job.error)}</p>` : ""}<details><summary>Provider record</summary><pre>${esc(JSON.stringify(job, null, 2))}</pre></details></article>`).join("") || `<div class="reports-empty"><span>No provider jobs are linked to this run.</span></div>`}</div>`;
}
function reportsReferenceMarkup(rows) {
  return `<div class="reports-reference-list">${(rows || []).map((row) => `<article><div><span>${esc(row.targetShotId || "TARGET")}</span><b>${esc(row.sourceCandidate || "No editable source recorded")}</b></div><small>${(row.referenceManifest || []).length} reference manifest item${(row.referenceManifest || []).length === 1 ? "" : "s"}</small><details><summary>Manifest</summary><pre>${esc(JSON.stringify(row.referenceManifest || [], null, 2))}</pre></details></article>`).join("") || `<div class="reports-empty"><span>No correction reference manifest is attached.</span></div>`}</div>`;
}
function reportsDetailMarkup(report) {
  if (!report) return `<section class="reports-detail empty"><div class="reports-empty"><b>Select a run to inspect it.</b><span>Full prompts, reviews, references, provider jobs, logs, approvals, usage, and diagnostics load only after selection.</span></div></section>`;
  const run = report.run || {}, analysis = report.analysis || {}, approvals = Object.values(run.steps || {}).filter((step) => step.result?.humanApproved === true || String(step.kind || "").includes("approval"));
  const errors = Object.values(run.steps || {}).filter((step) => step.error || step.status === "failed");
  return `<section class="reports-detail"><header><div><span>RUN DETAIL</span><h2>${esc(run.label || run.targetId || run.id)}</h2><p>${esc(run.summary || run.stage || "No summary recorded.")}</p></div><div class="reports-detail-status state-${attr(reportsStatusTone(run.status))}"><b>${esc(reportsStatusLabel(run.status))}</b><small>${esc(run.id || "")}</small></div></header><div class="reports-detail-actions"><button class="ghost-btn" onclick="copyAutomationSupportSummary('${attr(run.id)}')">COPY SUPPORT SUMMARY</button><button class="ghost-btn" onclick="copyAutomationDebugReport('${attr(run.id)}')">COPY DEBUG JSON</button><button class="ghost-btn" onclick="downloadAutomationRunReport('${attr(run.id)}')">DOWNLOAD RAW JSON</button><button class="approve-btn" onclick="downloadAutomationDiagnosticBundle('${attr(run.id)}')">DOWNLOAD DIAGNOSTIC BUNDLE</button>${run.status === "completed" ? `<button class="changes-btn" onclick="flagAutomationRunInefficient('${attr(run.id)}')">FLAG INEFFICIENT</button>` : ""}<a class="ghost-btn" href="${attr(typeof v641RunRoute === "function" ? v641RunRoute(run) : "#/production")}">OPEN WORKSPACE</a></div><div class="reports-summary-grid"><article><span>Revision</span><b>${Number(run.revision || 0)}</b></article><article><span>Images generated</span><b>${Number(run.usage?.imagesGenerated || 0)}</b></article><article><span>Recorded requests</span><b>${Number(run.usage?.imageRequests || 0)}</b></article><article><span>Accepted requests</span><b>${Number(analysis.providerRequestsAccepted || 0)}</b></article><article><span>Review calls</span><b>${Number(run.usage?.reviewCalls || 0)}</b></article><article><span>Highest pass</span><b>${Number(analysis.highestPassUsed || 0)}</b></article><article><span>Elapsed</span><b>${esc(reportsDuration(run))}</b></article><article><span>Classification</span><b>${esc(String(analysis.classification || "unknown").replace(/_/g, " "))}</b></article></div>${analysis.warnings?.length ? `<section class="reports-analysis-warnings"><header><b>Optimization signals</b><span>${analysis.warnings.length}</span></header>${analysis.warnings.map((item) => `<p>${esc(item)}</p>`).join("")}</section>` : ""}<details class="reports-detail-section" open><summary>Step timeline <span>${Object.keys(run.steps || {}).length}</span></summary>${reportsTimelineMarkup(run)}</details><details class="reports-detail-section"><summary>Prompts and revisions <span>${(report.prompts || []).length}</span></summary>${reportsPromptsMarkup(report.prompts)}</details><details class="reports-detail-section"><summary>Review records <span>${(report.reviews || []).length}</span></summary>${reportsReviewsMarkup(report.reviews)}</details><details class="reports-detail-section"><summary>Reference manifest <span>${(report.referenceManifest || []).length}</span></summary>${reportsReferenceMarkup(report.referenceManifest)}</details><details class="reports-detail-section"><summary>Provider jobs and operation keys <span>${(report.providerJobs || []).length}</span></summary>${reportsProviderJobsMarkup(report.providerJobs)}</details><details class="reports-detail-section"><summary>Human approvals <span>${approvals.length}</span></summary><pre>${esc(JSON.stringify(approvals, null, 2))}</pre></details><details class="reports-detail-section"><summary>Logs and errors <span>${(run.logs || []).length + errors.length}</span></summary><div class="reports-log-list">${(run.logs || []).map((entry) => `<p class="${attr(entry.tone || "info")}"><b>${esc(reportsTime(entry.at))}</b>${esc(entry.message || "")}</p>`).join("") || `<div class="reports-empty"><span>No run logs recorded.</span></div>`}</div>${errors.length ? `<pre>${esc(JSON.stringify(errors, null, 2))}</pre>` : ""}</details><details class="reports-detail-section reports-efficiency-feedback"><summary>Efficiency feedback <span>${run.feedback?.inefficient ? "FLAGGED" : "OPTIONAL"}</span></summary><div><textarea id="automation-efficiency-note" placeholder="Describe repeated complaints, unnecessary passes, weak first-round prompting, wrong references, or other avoidable work.">${esc(run.feedback?.note || "")}</textarea><button class="changes-btn" onclick="saveAutomationEfficiencyFeedback('${attr(run.id)}')">SAVE EFFICIENCY FEEDBACK</button></div></details>${run.feedback?.inefficient ? `<section class="reports-user-feedback"><span>USER EFFICIENCY NOTE</span><p>${esc(run.feedback.note || "Flagged without a note")}</p></section>` : ""}</section>`;
}
function reportsOptimizationMarkup(summary) {
  if (!summary) return "";
  const rate = Math.max(0, Number(CONFIG?.generation?.fal?.estimatedCostPerImage || 0));
  const estimated = rate ? Number(summary.totals?.imagesGenerated || 0) * rate : 0;
  return `<details class="reports-optimization"><summary><div><span>WHERE EFFORT WENT</span><b>Totals from ${plural(Number(summary.runCount || 0), "recorded run")}</b></div><span>EXPAND</span></summary><div class="reports-optimization-body"><div class="reports-summary-grid"><article><span>Total generated images</span><b>${Number(summary.totals?.imagesGenerated || 0)}</b></article><article><span>Provider requests accepted</span><b>${Number(summary.totals?.providerRequestsAccepted || 0)}</b></article><article><span>Assistant calls</span><b>${Number(summary.totals?.assistantCalls || 0)}</b></article><article><span>Review calls</span><b>${Number(summary.totals?.reviewCalls || 0)}</b></article><article><span>First-pass completion rate</span><b>${Number(summary.quality?.firstPassSuccessRate || 0)}%</b></article><article><span>Failed before acceptance</span><b>${Number(summary.quality?.failedBeforeAcceptance || 0)}</b></article><article><span>Failed after acceptance</span><b>${Number(summary.quality?.failedAfterAcceptance || 0)}</b></article><article><span>Human approvals</span><b>${Number(summary.quality?.humanApprovals || 0)}</b></article>${rate ? `<article><span>Configured cost estimate</span><b>$${estimated.toFixed(2)}</b><small>At $${rate.toFixed(3)} per image; not provider billing.</small></article>` : ""}</div><div class="reports-optimization-columns"><section><header><b>Highest-effort targets</b></header>${(summary.highestEffortTargets || []).map((row) => `<article><div><b>${esc(row.label || row.targetId)}</b><small>${esc(row.targetId)} · ${Number(row.runs || 0)} runs</small></div><span>pass ${Number(row.highestPassUsed || 0)} · ${Number(row.images || 0)} images</span></article>`).join("") || `<div class="reports-empty"><span>No generation history yet.</span></div>`}</section><section><header><b>Repeated review complaints</b></header>${(summary.repeatedComplaints || []).map((row) => `<article><p>${esc(row.reason)}</p><span>${Number(row.count || 0)} repeats</span></article>`).join("") || `<div class="reports-empty"><span>No repeated complaint clusters detected.</span></div>`}</section><section><header><b>User inefficiency notes</b></header>${(summary.inefficientFeedback || []).map((row) => `<article><div><b>${esc(row.label || row.targetId)}</b><p>${esc(row.note)}</p></div><a href="#/reports/${encodeURIComponent(row.runId)}">VIEW RUN</a></article>`).join("") || `<div class="reports-empty"><span>No runs have been flagged inefficient.</span></div>`}</section></div></div></details>`;
}


function reportsLegacyCompatibilityUsage() {
  const shots = P.shots || [];
  const entities = [...(P.characters || []), ...(P.locations || []), ...(P.props || []), ...(P.vehicles || [])];
  const rows = [
    { label: "Shots still using the older status field", count: shots.filter((shot) => shot.status && !shot.workflowStatus).length, detail: "CineBraid reads the old status for these shots. Setting a workflow status on the shot replaces it." },
    { label: "Dialogue kept as a note instead of a spoken line", count: shots.filter((shot) => shot.audio?.vo && !shot.audio?.line).length, detail: "CineBraid reads the note until the exact spoken line is filled in." },
    { label: "Continuity states with notes in an older field", count: entities.reduce((total, entity) => total + (entity.continuityStates || []).filter((state) => !state.notes && [state.description, state.stateDelta, state.changeOnly, state.instructions].some((value) => String(value || "").trim())).length, 0), detail: "These move into the state's own notes the next time CineBraid tidies the project." },
    { label: "Shots with one approved still from an older layout", count: shots.filter((shot) => shot.winner && !(shot.keyframes || []).some((frame) => frame.winner)).length, detail: "Kept so older approved shots stay visible while their frame records are brought up to date." },
  ];
  return rows.filter((row) => row.count > 0);
}

function reportsProjectLogMarkup(docs = []) {
  const issues = typeof projectHealthIssues === "function" ? projectHealthIssues() : [];
  const recent = [...(P.decisions || []), ...(P.sessions || []).map((x) => ({ date: x.date, text: x.summary }))]
    .filter((x) => x && (x.text || x.summary || x.decision)).slice(-12).reverse();
  const legacy = reportsLegacyCompatibilityUsage();
  const older = legacy.reduce((n,row)=>n+row.count,0);
  return `<details class="reports-project-log"><summary><div><span>PROJECT LOG</span><b>${plural(issues.length, "issue")} · ${plural(docs.length, "source document")} · ${plural(older, "record in an older format", "records in an older format")}</b></div><span>EXPAND</span></summary><div class="project-log-grid"><section><h4>Integrity checks</h4>${issues.length?`<div class="health-issue-list">${issues.slice(0,20).map((x)=>`<a href="#/shot/${x.shot.id}"><b>${esc(x.shot.id)}</b><small>${esc(x.msg)}</small></a>`).join("")}</div>`:`<p class="hint">No problems were found in this project's records.</p>`}</section><section><h4>Recent record</h4>${recent.length?`<div class="project-log-list">${recent.map((x)=>`<article><b>${esc(x.date || "")}</b><span>${esc(x.text || x.summary || x.decision || "")}</span></article>`).join("")}</div>`:`<p class="hint">No recent decisions or sessions.</p>`}</section><section class="project-legacy-usage"><h4>Records in an older format</h4>${legacy.length?`<div class="project-log-list">${legacy.map((row)=>`<article><b>${row.count} · ${esc(row.label)}</b><span>${esc(row.detail)}</span></article>`).join("")}</div>`:`<p class="hint">Nothing in this project is stored in an older format.</p>`}<small>CineBraid reads these correctly. They are listed so an older project is never quietly rewritten behind your back.</small></section></div></details>`;
}

async function reportsView(selectedId = "") {
  const token = ++REPORTS_REFRESH_TOKEN;
  try {
    const [historyResponse, summaryResponse, docsResponse] = await Promise.all([
      fetch(`/api/automation/runs?view=history&page=${REPORTS_FILTER.page}&pageSize=${BOUNDED_PAGE_SIZES.reports}&status=${encodeURIComponent(REPORTS_FILTER.status)}&target=${encodeURIComponent(REPORTS_FILTER.target)}`, { cache: "no-store" }),
      fetch("/api/automation/reports/summary", { cache: "no-store" }),
      fetch("/api/docs", { cache: "no-store" }).catch(() => null),
    ]);
    const historyData = await historyResponse.json().catch(() => ({}));
    const summaryData = await summaryResponse.json().catch(() => ({}));
    const docs = docsResponse?.ok ? await docsResponse.json().catch(() => []) : [];
    if (!historyResponse.ok) throw new Error(historyData.error || "Could not load run history");
    if (!summaryResponse.ok) throw new Error(summaryData.error || "Could not load optimization summary");
    let report = null;
    if (selectedId) {
      const response = await fetch(`/api/automation/runs/${encodeURIComponent(selectedId)}/report`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load the selected run report");
      report = data.report || null;
    }
    if (token !== REPORTS_REFRESH_TOKEN) return "";
    const runs = historyData.runs || [];
    REPORTS_FILTER.page = Number(historyData.page || 0);
    return `<div class="view-head reports-head"><div><div class="eyebrow">Reports</div><span class="view-title">Reports</span><div class="view-sub">Look back at every automated run, download a diagnostic file for support, and see where generation effort was repeated.</div></div><div class="view-head-actions"><button class="approve-btn" onclick="openProductionSummaryExport()">Export production summary</button></div></div>${reportsProjectLogMarkup(docs)}${reportsOptimizationMarkup(summaryData.summary)}<div class="reports-layout">${reportsHistoryMarkup(runs, selectedId, historyData, historyData.targetOptions || [])}${reportsDetailMarkup(report)}</div>`;
  } catch (error) {
    return `<div class="view-head"><div><div class="eyebrow">Reports</div><span class="view-title">Reports unavailable</span></div></div><div class="reports-empty"><b>${esc(error.message || "Could not load reports")}</b><span>Refresh the page or verify the active project files.</span></div>`;
  }
}

window.openProductionSummaryExport = () => {
  openModal(`<h3>Export production summary</h3><p class="modal-sub">Download this project’s run totals, how many attempts each shot took, review notes that keep repeating, and any run you flagged as wasteful. File paths and keys are removed before the file is written.</p><div class="modal-actions"><button class="approve-btn" onclick="downloadProductionSummary('markdown')">Download Markdown</button><button class="ghost-btn" onclick="downloadProductionSummary('json')">Download JSON</button><button class="cancel" onclick="closeModal()">Cancel</button></div>`);
};
window.downloadProductionSummary = (format) => {
  const value = format === "json" ? "json" : "markdown";
  const link = document.createElement("a");
  link.href = `/api/automation/reports/export?format=${encodeURIComponent(value)}`;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
  closeModal();
};

window.reportsView = reportsView;
