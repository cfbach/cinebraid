const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { registerAutomationRuns } = require("../src/automation/automation-runs");
const RELEASE_VERSION = require("../package.json").version;

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function origin(server) { return `http://127.0.0.1:${server.address().port}`; }
async function json(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  return { response, data };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-diagnostic-"));
  fs.writeFileSync(path.join(tmp, "project.json"), JSON.stringify({
    meta: { title: "Diagnostic Test" },
    scenes: [{ id: "SC-1", title: "Repair" }],
    shots: [{
      id: "S-1", scene: "SC-1", title: "Target", winner: "S-1_APPROVED.png",
      keyframes: [{ id: "S-1-A", label: "A", winner: "S-1_APPROVED.png" }],
      candidateFiles: [{ stored: "S-1_APPROVED.png", sourceBuildId: "frame-build-1", sourcePackageId: "frame-package-1" }],
    }],
    characters: [], locations: [], props: [], vehicles: [],
  }, null, 2));
  fs.writeFileSync(path.join(tmp, "generation-jobs.json"), JSON.stringify([{
    id: "fal-diagnostic-job-1", automationRunId: "automation-diagnostic-1", status: "FAILED", purpose: "correction",
    providerUrl: "https://provider.example/jobs/123?api_key=SECRET_QUERY_KEY_1234567890&mode=edit",
    error: "Provider rejected credential fal_SECRET_PROVIDER_KEY_12345678901234567890 from /mnt/private/cinebraid/job.json",
    outputs: [],
  }], null, 2));

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  registerAutomationRuns(app, { projectDir: () => tmp });
  const server = await listen(app);
  const base = origin(server);
  try {
    const run = {
      id: "automation-diagnostic-1", type: "scene-chain", targetId: "SC-1", scope: "correction:pkg-1",
      label: "Repair correction", mode: "correction-only", status: "failed", stage: "Needs attention", phase: "generation",
      config: { maxImages: 6, outputsPerRequest: 3, initialCorrectionPackages: [{ id: "pkg-1", targetShotId: "S-1", prompt: "Repair the target." }] },
      result: { correctionPackages: [{ id: "pkg-1", targetShotId: "S-1", prompt: "Repair the target." }] },
      usage: { imageRequests: 0, imagesGenerated: 0, assistantCalls: 0, reviewCalls: 0 },
      current: { stepKey: "scene-correction:pkg-1:round-1:generate", label: "Generate correction", phase: "generation" },
      steps: {
        "scene-correction:pkg-1:round-1:prompt": {
          key: "scene-correction:pkg-1:round-1:prompt", kind: "prompt", status: "completed", packageId: "pkg-1",
          shotId: "S-1", frameId: "S-1-A", label: "Build correction prompt", attempt: 1, maxAttempts: 3,
          result: { prompt: "Preserve creative identifier SHOTBRAIDREFERENCE123456789012345678901234567890 exactly." },
        },
        "scene-correction:pkg-1:round-1:generate": {
          key: "scene-correction:pkg-1:round-1:generate", kind: "generation", status: "failed", packageId: "pkg-1",
          shotId: "S-1", frameId: "S-1-A", label: "Generate correction", attempt: 1, maxAttempts: 3,
          error: "Correction generation requires sourceCandidate provenance. Provider echoed sk-SECRETERRORKEY123456789012345678901234 and /opt/cinebraid/private/run.json",
          activity: { system: "FAL · GPT IMAGE 2", state: "request rejected", providerAccepted: false },
        },
      },
      logs: [{ at: new Date().toISOString(), tone: "error", message: "Provider error key fal_LOGSECRET_123456789012345678901234567890 at https://provider.example/fail?token=URL_TOKEN_SECRET_1234567890 from /srv/cinebraid/private.log" }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const created = await json(`${base}/api/automation/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(run) });
    assert.strictEqual(created.response.status, 201, JSON.stringify(created.data));
    assert.strictEqual(created.data.run.steps[run.current.stepKey].activity.state, "request rejected", "step activity must persist through durable sanitization");

    const retried = await json(`${base}/api/automation/runs/${run.id}/retry-step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stepKey: run.current.stepKey }) });
    assert(retried.response.ok, JSON.stringify(retried.data));
    assert.strictEqual(retried.data.run.steps[run.current.stepKey].status, "pending");
    assert.strictEqual(retried.data.run.result.correctionPackages[0].sourceCandidate, "S-1_APPROVED.png", "retry must repair missing sourceCandidate provenance");
    assert.strictEqual(retried.data.run.config.initialCorrectionPackages[0].sourceBuildId, "frame-build-1");

    const feedback = await json(`${base}/api/automation/runs/${run.id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inefficient: true, note: "Repeated the same issue across three passes." }) });
    assert(feedback.response.ok, JSON.stringify(feedback.data));
    assert.strictEqual(feedback.data.run.feedback.inefficient, true);

    const summary = await json(`${base}/api/automation/runs/${run.id}/support-summary`);
    assert(summary.response.ok, JSON.stringify(summary.data));
    assert(summary.data.summary.includes(`CineBraid ${RELEASE_VERSION} support summary`));
    assert(summary.data.summary.includes("User flagged inefficient"));
    assert(!summary.data.summary.includes("SECRETERRORKEY"), "copyable support summaries must redact provider-echoed credentials");

    const report = await json(`${base}/api/automation/runs/${run.id}/report`);
    assert(report.response.ok, JSON.stringify(report.data));
    assert.strictEqual(report.data.report.run.id, run.id);
    assert(Array.isArray(report.data.report.prompts), "selected report detail must include prompts lazily");
    assert(Array.isArray(report.data.report.providerJobs), "selected report detail must include provider jobs lazily");

    const projectSummary = await json(`${base}/api/automation/reports/summary`);
    assert(projectSummary.response.ok, JSON.stringify(projectSummary.data));
    assert.strictEqual(projectSummary.data.summary.runCount, 1);
    assert(projectSummary.data.summary.highestEffortTargets.some((row) => row.targetId === "SC-1"));

    const history = await json(`${base}/api/automation/runs?view=history`);
    assert(history.response.ok, JSON.stringify(history.data));
    assert.strictEqual(history.data.runs[0].id, run.id);
    assert(!history.data.runs[0].steps, "Reports history must stay lightweight until a run is selected");

    const bundle = await fetch(`${base}/api/automation/runs/${run.id}/diagnostic.zip`);
    assert(bundle.ok);
    assert.strictEqual(bundle.headers.get("content-type"), "application/zip");
    const bytes = Buffer.from(await bundle.arrayBuffer());
    assert.strictEqual(bytes.subarray(0, 2).toString("ascii"), "PK", "diagnostic endpoint must return a ZIP archive");
    const storedZipText = bytes.toString("utf8");
    for (const secret of ["SECRET_QUERY_KEY_1234567890", "SECRET_PROVIDER_KEY", "SECRETERRORKEY", "LOGSECRET", "URL_TOKEN_SECRET", "/mnt/private", "/opt/cinebraid", "/srv/cinebraid"]) {
      assert(!storedZipText.includes(secret), `diagnostic bundle leaked ${secret}`);
    }
    assert(storedZipText.includes("api_key=[REDACTED]"), "credential-bearing URL parameters must keep the parameter name and redact the value");
    assert(storedZipText.includes("token=[REDACTED]"), "token query parameters must be redacted in free-text errors");
    assert(storedZipText.includes("[LOCAL_PATH]"), "broader absolute local paths must be redacted");
    assert(storedZipText.includes("SHOTBRAIDREFERENCE123456789012345678901234567890"), "creative prompt text must not be corrupted by entropy redaction");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("Automation diagnostic suite passed correction provenance repair, hardened redaction, lightweight Reports history, lazy run detail, project optimization summaries, efficiency feedback, support summaries, and ZIP bundles.");
}

main().catch((error) => { console.error(error); process.exit(1); });
