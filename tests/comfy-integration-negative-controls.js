/* Negative controls for ComfyUI Foothold V1.
 *
 * A regression suite that has never failed is a claim, not evidence. Each control below
 * reintroduces exactly ONE of the defects this slice exists to prevent, and asserts that
 * the REAL guard — the same function tests/comfy-integration.js runs in the green path,
 * not a restatement of it — fails.
 *
 *   NC-1  a broken workflow mapping still dispatches
 *   NC-2  a Film-A result attaches to Film-B
 *   NC-3  a delivered result bypasses the shared candidate writer
 *   NC-4  a workflow file changes and the stale mapping is silently used
 *   NC-5  a suggestion is treated as a confirmation nobody made
 *   NC-6  a local render is recorded as a hosted charge
 *   NC-7  a raw filesystem path is accepted as workflow identity
 *   NC-8  a non-loopback ComfyUI address is dialled
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Each defect is introduced
 * by compiling a MODIFIED COPY of the real source in memory and installing it in the
 * module cache before the routes are built, so the running code IS the broken code.
 *
 * AN EXCEPTION IS NOT PROOF A CONTROL RAN. Every mutation carries a receipt: the anchor
 * must exist, must be unique, and must actually change the source. A control that
 * silently matched nothing would report itself green while proving nothing, which is the
 * failure mode this file exists to avoid.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const Suite = require("./comfy-integration");

const applied = [];
const notes = [];
const note = (line) => notes.push(line);

/* Line endings are a checkout detail. This repo checks out CRLF on Windows, so a
   multi-line anchor written with \n would match nothing there and the control would
   report itself stale instead of biting. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function mutateOnce(source, needle, replacement, label) {
  const text = String(source).replace(/\r\n/g, "\n");
  const occurrences = text.split(needle).length - 1;
  assert.strictEqual(occurrences, 1, `NEGATIVE CONTROL ANCHOR STALE — ${label} matched ${occurrences} times, expected exactly 1`);
  const next = text.replace(needle, replacement);
  assert.notStrictEqual(next, text, `NEGATIVE CONTROL — ${label} changed nothing`);
  applied.push(label);
  return next;
}

/* Compile a modified copy of a real module and put it in the cache under its real
   filename, so every dependant that is required afterwards gets the broken one. */
function installBroken(relativePath, mutate, label) {
  const filename = path.join(ROOT, relativePath);
  const source = mutate(readLF(filename), label);
  const compiled = new Module(filename, null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  compiled.loaded = true;
  require.cache[filename] = compiled;
  return compiled.exports;
}

/* Only an AssertionError counts as detection. A syntax error, a module-load failure or
   an unrelated crash means the control did not test what it claims and is re-thrown.
 *
 * AND A STALE ANCHOR IS NOT DETECTION EITHER. mutateOnce() throws an AssertionError when
 * its needle matches zero times, and without the guard below that assertion would be
 * counted as "the guard fired" — a control whose mutation never happened reporting itself
 * green. This file was written before that hole was closed and NC-2 fell straight into
 * it, which is exactly why the receipt is checked rather than trusted. */
const CONTROL_FAILURES = [/ANCHOR STALE/, /changed nothing/];
async function mustBeCaught(label, run) {
  let caught = null;
  try {
    await run();
  } catch (error) {
    if (error && error.code === "ERR_ASSERTION") caught = error;
    else throw error;
  }
  assert(caught, `NEGATIVE CONTROL DID NOT BITE — ${label}: the defect was reintroduced and nothing failed`);
  const message = String(caught.message);
  for (const pattern of CONTROL_FAILURES)
    assert(!pattern.test(message),
      `NEGATIVE CONTROL BROKE ITSELF — ${label}: ${message}. The mutation never reached the source, so nothing about the product was proven.`);
  note(`${label} → caught by "${message.split("\n")[0]}"`);
}

async function withHarness(options, run) {
  /* The hook the fake ComfyUI fires mid-download needs the harness, which does not
     exist until after the server is listening. A holder closes that loop without
     reordering anything. */
  const holder = {};
  const comfy = await Suite.startFakeComfy({
    ...(options.comfy || {}),
    ...(options.onView ? { onView: () => options.onView(holder.harness) } : {}),
  });
  const harness = await Suite.makeHarness({ comfyBaseUrl: comfy.baseUrl, mutate: options.mutate });
  holder.harness = harness;
  try {
    const folder = Suite.writeWorkflowFolder(path.join(harness.dir, "workflows"), options.files || { "smoke.json": Suite.apiWorkflow() });
    harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { workflowFolder: folder } } }));
    return await run({ harness, comfy, folder });
  } finally {
    harness.close();
    comfy.close();
  }
}

async function confirm(harness, bindings, relativePath = "smoke.json") {
  return Suite.call(harness, "POST", "/api/generation/comfy/workflow/mapping", { relativePath, bindings });
}
const DISPATCH = { shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json", prompt: "a lighthouse" };

/* ===========================================================================
   NC-1 — a broken workflow mapping still dispatches.

   Removes buildDispatchGraph's refusal, so a mapping pointing at a node that no longer
   exists is applied to whatever is there. The green path's claim is that a stale
   binding never reaches ComfyUI. */
async function nc1() {
  await mustBeCaught("NC-1 a broken mapping still dispatches", () => withHarness({
    mutate: () => {
      installBroken("comfy-workflow.js", (source, label) => mutateOnce(
        source,
        `  const validated = validateMapping(mapping, inspection);
  if (!validated.ok)
    throw new ComfyWorkflowError(
      "COMFY_MAPPING_BROKEN",`,
        `  const validated = validateMapping(mapping, inspection);
  if (false)
    throw new ComfyWorkflowError(
      "COMFY_MAPPING_BROKEN",`,
        label,
      ), "NC-1 buildDispatchGraph refusal");
      /* And the registry's own gate, so the defect is genuinely reachable rather than
         stopped one layer earlier by a different guard. */
      installBroken("comfy-registry.js", (source, label) => mutateOnce(
        source,
        `  if (state.state !== "ready" && state.state !== "changed")`,
        `  if (false)`,
        label,
      ), "NC-1 loadForDispatch state gate");
    },
  }, async ({ harness, comfy, folder }) => {
    await confirm(harness, { positivePrompt: { nodeId: "6", input: "text" }, negativePrompt: { nodeId: "7", input: "text" } });
    const broken = Suite.apiWorkflow();
    delete broken["7"];
    fs.writeFileSync(path.join(folder, "smoke.json"), JSON.stringify(broken, null, 2));
    const attempt = await Suite.call(harness, "POST", "/api/generation/comfy/jobs", DISPATCH);
    /* THE GREEN-PATH CLAIM, restated as the assertion the defect must break. */
    assert.strictEqual(attempt.data.code, "COMFY_MAPPING_BROKEN", "a mapping whose node is gone must refuse before dispatch");
    assert.strictEqual(comfy.state.prompts.length, 0, "and nothing may reach ComfyUI");
  }));
}

/* ===========================================================================
   NC-2 — a Film-A result attaches to Film-B.

   Redirects the PROJECT WRITE inside collect() to whichever project happens to be
   active when the download finishes, instead of the one that ordered the render. That is
   the defect fal-generation.js's ownership capture exists to prevent, stated in its own
   header: "the download landed in the new project's shots folder and the OLD project's
   whole document was written over."

   TWO OTHER GUARDS HAD TO BE STEPPED PAST TO REACH IT, and recording that is the point
   of writing the control rather than assuming one:

     the ledger is per project, so a wrong owner cannot even FIND the job — which is why
     the mutation redirects the write and not the lookup;
     the shot is re-found inside the commit turn, so a wrong project with different shot
     ids refuses — which is why Film B is given a shot with the SAME id here.

   Shot ids repeating across two films is not a contrivance; `SC-01-01` is the first shot
   of almost every CineBraid project. That is exactly the case where a redirected write
   would succeed quietly. */
async function nc2() {
  await mustBeCaught("NC-2 a Film-A result attaches to Film-B", () => withHarness({
    /* THE RACE, REPRODUCED RATHER THAN APPROXIMATED. The refresh is issued while Film A
       is open, so the captured owner is correct and the job is found; the switch happens
       DURING the download, which is the only stretch of the flow where real seconds pass
       and a filmmaker is free to go elsewhere. */
    onView: (harness) => harness.setActive("film-b"),
    mutate: () => {
      installBroken("comfy-generation.js", (source, label) => mutateOnce(
        source,
        `      const outputs = await commitProject(owner, (P) => {`,
        `      const outputs = await commitProject(ownerForSlug(activeSlug()), (P) => {`,
        label,
      ), "NC-2 owner-addressed project write in collect");
    },
  }, async ({ harness }) => {
    /* Film B gets a shot with the same id as Film A's, which is the ordinary case. */
    const filmBFile = path.join(harness.projectsRoot, "film-b", "project.json");
    const filmBDoc = JSON.parse(fs.readFileSync(filmBFile, "utf8"));
    filmBDoc.shots.push({ id: "SC-01-01", title: "Film B's own first shot", candidateFiles: [], keyframes: [] });
    fs.writeFileSync(filmBFile, JSON.stringify(filmBDoc, null, 2));

    await confirm(harness, { positivePrompt: { nodeId: "6", input: "text" } });
    const sent = await Suite.call(harness, "POST", "/api/generation/comfy/jobs", DISPATCH);
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.data));
    /* Film A is still open when the collection starts. The switch fires from inside the
       download, through the onView hook above. */
    const collected = await Suite.call(harness, "POST", `/api/generation/comfy/jobs/${sent.data.job.id}/refresh`);
    assert.strictEqual(collected.status, 200, `the collection itself must succeed: ${JSON.stringify(collected.data)}`);

    /* THE CLAIM: Film B's document is untouched, whatever happened to Film A's. */
    const filmB = harness.project("film-b");
    const filmBShot = filmB.shots.find((row) => row.id === "SC-01-01");
    assert.strictEqual((filmBShot.candidateFiles || []).length, 0,
      "a result ordered by Film A must never attach to Film B");
    assert.strictEqual(harness.takes("film-b", "SC-01-01").length, 0, "and must never write a file into it");
    /* AND FILM A KEEPS ITS OWN. A control that only checked B would pass if the result
       vanished entirely, which is a different defect and not an acceptable one. */
    harness.setActive("film-a");
    assert.strictEqual((harness.project("film-a").shots[0].candidateFiles || []).length, 1,
      "and the film that ordered it must receive it");
  }));
}

/* ===========================================================================
   NC-3 — a delivered result bypasses the shared candidate writer.

   Replaces writeShotCandidates with a hand-rolled push that writes the bytes and a row
   of its own — the "second candidate archive" this slice exists to prevent. The row it
   writes is missing the provenance fields the shipped review projection reads, so the
   result becomes a file the product cannot explain. */
async function nc3() {
  await mustBeCaught("NC-3 a delivered result bypasses the shared candidate writer", () => withHarness({
    mutate: () => {
      installBroken("comfy-generation.js", (source, label) => mutateOnce(
        source,
        `        const written = writeShotCandidates({`,
        `        const written = (() => {
          const dir = require("path").join(owner.dir, "shots", shot.id, "takes");
          require("fs").mkdirSync(dir, { recursive: true });
          const rows = [];
          downloads.forEach((download, index) => {
            const name = \`bypass_\${index + 1}.png\`;
            require("fs").writeFileSync(require("path").join(dir, name), download.buffer);
            shot.candidateFiles = Array.isArray(shot.candidateFiles) ? shot.candidateFiles : [];
            shot.candidateFiles.push({ stored: name, decision: "unreviewed" });
            rows.push({ type: "candidate", name });
          });
          return rows;
        })();
        const unusedWriter = () => writeShotCandidates({`,
        label,
      ), "NC-3 shared candidate writer");
    },
  }, async ({ harness }) => {
    await confirm(harness, { positivePrompt: { nodeId: "6", input: "text" } });
    const sent = await Suite.call(harness, "POST", "/api/generation/comfy/jobs", DISPATCH);
    await Suite.call(harness, "POST", `/api/generation/comfy/jobs/${sent.data.job.id}/refresh`);
    const candidate = harness.project().shots[0].candidateFiles[0];
    /* THE CLAIM: a delivered result carries the provenance the shipped review path
       reads. A row written by anything but the one writer does not. */
    assert.strictEqual(candidate.generationProvider, "ComfyUI", "a delivered candidate must record which backend produced it");
    assert.strictEqual(candidate.generationJobId, sent.data.job.id, "and the job that ordered it");
    assert.strictEqual(candidate.generationRequestId, "fixture-prompt-1", "and the provider's own request id");
  }));
}

/* ===========================================================================
   NC-4 — a workflow file changes and the stale mapping is silently used.

   Makes workflowState() compare the mapped hash to itself, so an edited file reports
   `ready` instead of `changed`. The green path's claim is not that an edit is refused —
   a harmless edit runs — it is that the run RECORDS which file it ran, so the
   difference stays legible afterwards. */
async function nc4() {
  await mustBeCaught("NC-4 a changed workflow is recorded as unchanged", () => withHarness({
    mutate: () => {
      installBroken("comfy-registry.js", (source, label) => mutateOnce(
        source,
        `  const contentMoved = text(record.mappedHash) && text(record.mappedHash) !== text(described.contentHash);`,
        `  const contentMoved = false;`,
        label,
      ), "NC-4 changed-workflow detection");
      installBroken("comfy-generation.js", (source, label) => mutateOnce(
        source,
        `        changedSinceConfirmed: Boolean(workflow.mappedHash) && workflow.mappedHash !== workflow.contentHash,`,
        `        changedSinceConfirmed: false,`,
        label,
      ), "NC-4 provenance change flag");
    },
  }, async ({ harness, folder }) => {
    await confirm(harness, { positivePrompt: { nodeId: "6", input: "text" } });
    const edited = Suite.apiWorkflow();
    edited["5"].inputs.height = 768;
    fs.writeFileSync(path.join(folder, "smoke.json"), JSON.stringify(edited, null, 2));

    const listed = await Suite.call(harness, "GET", "/api/generation/comfy/workflows");
    assert.strictEqual(listed.data.workflows[0].state, "changed",
      "an edited workflow must read as changed, not as the file the mapping was confirmed against");

    const sent = await Suite.call(harness, "POST", "/api/generation/comfy/jobs", DISPATCH);
    const job = harness.jobs().at(-1);
    assert.strictEqual(job.comfy.workflow.changedSinceConfirmed, true,
      "and a run against an edited file must say so in its provenance");
    void sent;
  }));
}

/* ===========================================================================
   NC-5 — a suggestion is treated as a confirmation nobody made.

   Removes the confirmation stamp requirement, so a binding can enter the registry
   without a person having agreed to it. This is the control the whole
   suggestion/confirmation split exists for. */
async function nc5() {
  await mustBeCaught("NC-5 a suggestion becomes a confirmation nobody made", () => withHarness({
    mutate: () => {
      installBroken("comfy-workflow.js", (source, label) => mutateOnce(
        source,
        `    if (!text(binding.confirmedAt)) {
      fail("unconfirmed", \`\${semantic.label} was never confirmed by anyone.\`, "Open the workflow's inputs and confirm this mapping.");
      continue;
    }`,
        `    if (false) {
      fail("unconfirmed", \`\${semantic.label} was never confirmed by anyone.\`, "Open the workflow's inputs and confirm this mapping.");
      continue;
    }`,
        label,
      ), "NC-5 confirmation gate in validateMapping");
    },
  }, async ({ harness }) => {
    const W = require(path.join(ROOT, "comfy-workflow.js"));
    const inspection = W.inspectWorkflow(Suite.apiWorkflow());
    /* Exactly what suggestMappings produces, posted straight into the registry with no
       confirmation stamp — a machine agreeing with itself. */
    const suggested = W.suggestMappings(inspection).positivePrompt[0];
    const unconfirmed = { mappingVersion: 1, bindings: { positivePrompt: { nodeId: suggested.nodeId, input: suggested.input } } };
    const checked = W.validateMapping(unconfirmed, inspection);
    assert.strictEqual(checked.ok, false, "a binding with no confirmation must never validate");
    assert(checked.problems.some((row) => row.code === "unconfirmed"),
      "and the reason must be that nobody confirmed it");
    void harness;
  }));
}

/* ===========================================================================
   NC-6 — a local render is recorded as a hosted charge.

   Swaps the local accounting for the metered shape fal records. The contract itself is
   the guard: validateCostEstimate refuses a metered estimate with no amount, and
   validateGenerationResult refuses a local_native result that is not free_local. */
async function nc6() {
  await mustBeCaught("NC-6 a local render is recorded as a hosted charge", () => withHarness({
    mutate: () => {
      installBroken("comfy-generation.js", (source, label) => mutateOnce(
        source,
        `    costClass: "free_local",
    estimate: { costClass: "free_local", unit: "none", amount: 0, confidence: "quoted", quotedAt: at },`,
        `    costClass: "metered_api",
    estimate: { costClass: "metered_api", unit: "usd", amount: 0.04, confidence: "estimated", quotedAt: at },`,
        label,
      ), "NC-6 local accounting");
    },
  }, async ({ harness }) => {
    await confirm(harness, { positivePrompt: { nodeId: "6", input: "text" } });
    const sent = await Suite.call(harness, "POST", "/api/generation/comfy/jobs", DISPATCH);
    const job = harness.jobs().at(-1) || {};
    const Contracts = require(path.join(ROOT, "generation-contracts.js"));
    /* THE CLAIM, three ways: the recorded class, the contract's own rule, and the
       authorisation consequence a filmmaker would feel. */
    assert.strictEqual(job.accounting?.costClass, "free_local",
      "a render on this machine must never be recorded as a hosted charge");
    assert.strictEqual(Contracts.requiresExplicitAuthorization(job.accounting?.estimate), false,
      "and must never acquire a paid confirmation it has no reason to need");
    void sent;
  }));
}

/* ===========================================================================
   NC-7 — a raw filesystem path is accepted as workflow identity.

   Removes the containment checks, so a caller can name any file on the machine as a
   "workflow". The folder is configuration; it is not a licence to read the disk.

   BOTH checks are removed, and that is the finding this control records: the shape test
   on the name and the resolved-path containment are two independent guards, and
   deleting only the first was not enough to reintroduce the defect. A control that
   removed one and passed would have been proving the OTHER one works while claiming to
   test the first. */
async function nc7() {
  await mustBeCaught("NC-7 a raw filesystem path is accepted as workflow identity", () => withHarness({
    mutate: () => {
      installBroken("comfy-registry.js", (source, label) => {
        const withoutShapeTest = mutateOnce(
          source,
          `  if (rel.startsWith("/") || /^[a-zA-Z]:/.test(rel) || rel.split("/").some((part) => part === "" || part === "." || part === ".."))`,
          `  if (false)`,
          `${label} (name shape)`,
        );
        return mutateOnce(
          withoutShapeTest,
          `  if (inside.startsWith("..") || path.isAbsolute(inside))`,
          `  if (false)`,
          `${label} (resolved containment)`,
        );
      }, "NC-7 workflow path containment");
    },
  }, async ({ harness, folder }) => {
    const outside = path.join(harness.dir, "outside-secret.json");
    fs.writeFileSync(outside, JSON.stringify(Suite.apiWorkflow()));
    const Registry = require(path.join(ROOT, "comfy-registry.js"));
    let code = "";
    try {
      Registry.describeForMapping(folder, "../outside-secret.json");
    } catch (error) {
      code = String(error.code || "");
    }
    assert(["COMFY_WORKFLOW_PATH_INVALID", "COMFY_WORKFLOW_OUTSIDE_FOLDER", "COMFY_WORKFLOW_MISSING"].includes(code),
      `a workflow named by a path outside the folder must be refused; got ${code || "no refusal at all"}`);
  }));
}

/* ===========================================================================
   NC-8 — a non-loopback ComfyUI address is dialled.

   Removes the loopback boundary. V1's whole networking claim is that a user-typed
   address cannot become an outbound request to anywhere but this machine. */
async function nc8() {
  await mustBeCaught("NC-8 a non-loopback ComfyUI address is dialled", async () => {
    installBroken("comfy-client.js", (source, label) => mutateOnce(
      source,
      `  if (!isLocalProviderEndpoint(origin))`,
      `  if (false)`,
      label,
    ), "NC-8 loopback boundary");
    const Client = require(path.join(ROOT, "comfy-client.js"));
    for (const address of ["http://192.168.1.50:8188", "http://10.0.0.9:8188", "http://comfy.example.com"]) {
      let code = "";
      try {
        Client.assertReachableEndpoint(address);
      } catch (error) {
        code = String(error.code || "");
      }
      assert.strictEqual(code, "COMFY_URL_NOT_LOCAL", `${address} must be refused before any request is made`);
    }
  });
}

/* =========================================================================== */
async function main() {
  await nc1();
  await nc2();
  await nc3();
  await nc4();
  await nc5();
  await nc6();
  await nc7();
  await nc8();
  assert.strictEqual(new Set(applied).size, applied.length, "every mutation label must be distinct");
  console.log(`ComfyUI foothold V1 negative controls passed: ${notes.length} deliberate defects reintroduced in memory, every one detected by the guard that owns it.`);
  for (const line of notes) console.log(`  - ${line}`);
  console.log(`  mutations applied: ${applied.join(" · ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
