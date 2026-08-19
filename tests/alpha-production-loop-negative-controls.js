/* Negative controls for the private-alpha production loop.
 *
 * A regression suite that has never failed is a claim, not evidence. Each control below
 * reintroduces exactly ONE of the six defects this batch removes and asserts that the
 * real guard — the same function tests/alpha-production-loop.js runs in the green path,
 * not a restatement of it — FAILS.
 *
 *   NC-A   openGuidedPanel() back to writing only the legacy openPanels map
 *   NC-B1  the default video target back to an unwired family
 *   NC-B2  the shipped default string back to an unwired family
 *   NC-C1  an unwired target allowed to look dispatchable
 *   NC-C2  the refusal removed, leaving a silent dead end
 *   NC-D1  a batch approval no longer marked as a human decision
 *   NC-D2  an AI pass implying a human approval
 *   NC-E   the false "remains available in Reports" promise restored
 *   NC-F1  the browser reader back to providerRequestId / requestId
 *   NC-F2  the lifecycle reader back to providerRequestId / requestId
 *   NC-G   the FLF motion-readiness gate bypassed by the new task selection
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Each defect is
 * introduced by evaluating a MODIFIED COPY of the source in memory.
 *
 * AN EXCEPTION IS NOT PROOF A CONTROL RAN. Every control carries a receipt: the anchor
 * must exist, must be unique, must actually change the source, and the DEFECT ITSELF
 * must be observed through a probe before the guard's failure counts as detection. Only
 * an AssertionError counts — a syntax error, a module-load failure or an unrelated
 * crash is re-thrown.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const Suite = require("./alpha-production-loop");

/* Line endings are a checkout detail. This repo checks out CRLF on Windows, so a
   multi-line anchor written with \n would match nothing there and the control would
   report itself stale instead of biting. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const LIFECYCLE_PATH = path.join(ROOT, "generation-lifecycle.js");
const LIFECYCLE_SOURCE = readLF(LIFECYCLE_PATH);

const applied = [];
function mutateOnce(source, needle, replacement, label) {
  const text = String(source).replace(/\r\n/g, "\n");
  const occurrences = text.split(needle).length - 1;
  assert.strictEqual(occurrences, 1, `NEGATIVE CONTROL ANCHOR STALE — ${label} matched ${occurrences} times, expected exactly 1`);
  const next = text.replace(needle, replacement);
  assert.notStrictEqual(next, text, `NEGATIVE CONTROL — ${label} changed nothing`);
  applied.push(label);
  return next;
}
/* A source-only patch for the browser scripts, handed to the render harness. */
function mutateScript(fileName, needle, replacement, label) {
  return (file, source) => (file === fileName ? mutateOnce(source, needle, replacement, label) : source);
}
/* A modified copy of a Node module, compiled in memory. Never on disk, so no checkout
   can be what undoes it. */
function brokenModule(file, mutate) {
  const mutated = mutate(readLF(file));
  const sandbox = { require: Module.createRequire(file), module: { exports: {} }, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(mutated, sandbox, { filename: `${path.basename(file)}.broken.js` });
  return sandbox.module.exports;
}

const results = [];
async function control({ id, label, guards, defect, guarded }) {
  const observed = await defect();
  assert(observed === true, `NEGATIVE CONTROL ${id}: the defect probe did not observe the reintroduced defect, so nothing below proves anything`);
  let detected = null;
  try {
    await guarded();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = error;
  }
  assert(detected, `NEGATIVE CONTROL ${id} FAILED: with "${label}" reintroduced, "${guards}" still passed. That test cannot detect the defect it exists for.`);
  results.push({ id, label, guards, outcome: String(detected.message).split("\n")[0].slice(0, 120) });
}

async function main() {
  /* ======================================================================
     NC-A — openGuidedPanel back to writing only the legacy openPanels map, and
     back to deciding from the scroll poll. The defect verbatim. */
  const A_ANCHOR = `  const s = shotById(id), c = ensureShotCreation(s);
  const task = selectGuidedPanelTask(s, key);`;
  const A_BROKEN = `  const s = shotById(id), c = ensureShotCreation(s);
  const task = "";`;
  const A_ANCHOR2 = `  if (task && boundedShotSelectedTask(s, takesFor(s.id)) !== task)
    return toast(\`Could not open the \${key} workspace.\`);
  await focusGuidedWorkspaceTarget(\`[data-guided-panel="\${key}"]\`);`;
  const A_BROKEN2 = `  const found = await focusGuidedWorkspaceTarget(\`[data-guided-panel="\${key}"]\`);
  if (!found) toast(\`Could not find the \${key} workspace.\`);`;
  const brokenNavigation = () => (file, source) => {
    if (file !== "creation-studio.js") return source;
    return mutateOnce(
      mutateOnce(source, A_ANCHOR, A_BROKEN, "NC-A openGuidedPanel writes only openPanels"),
      A_ANCHOR2, A_BROKEN2, "NC-A the DOM poll decides again",
    );
  };
  await control({
    id: "NC-A",
    label: "openGuidedPanel writing only the legacy openPanels map",
    guards: "Add motion opens the motion workspace from every other task",
    defect: async () => {
      const result = await Suite.crossPanelNavigation("frames", "motion", brokenNavigation());
      /* RECEIPT: the workspace is still on Frames, the motion panel was never built,
         and the filmmaker is told the workspace could not be found. */
      return result.after.task === "frames"
        && result.after.panelBuilt === false
        && result.after.said.join(" ").includes("Could not find the motion workspace");
    },
    guarded: () => Suite.testAddMotionFromEveryTask(brokenNavigation()),
  });

  /* And the same defect caught by the non-Motion half, so the repair cannot be a
     Motion-only special case that leaves Deliver and Inputs broken. */
  await control({
    id: "NC-A2",
    label: "the same regression seen from the other cross-panel actions",
    guards: "finish, inputs and composer all navigate through the same helper",
    defect: async () => {
      const result = await Suite.crossPanelNavigation("frames", "finish", brokenNavigation());
      return result.after.task === "frames" && result.after.panelBuilt === false;
    },
    guarded: () => Suite.testOtherCrossPanelActions(brokenNavigation()),
  });

  /* ======================================================================
     NC-B1 — the resolver's preference list back to the unwired families. */
  const B_ANCHOR = `  const dispatchable = profiles.filter(guidedVideoProfileDispatchable);
  const projectDefault = P.meta?.promptDefaults?.videoProfile || "";
  return (projectDefault && dispatchable.some((profile) => profile.id === projectDefault) ? projectDefault : "")`;
  const B_BROKEN = `  const dispatchable = profiles;
  const projectDefault = P.meta?.promptDefaults?.videoProfile || "";
  return (projectDefault && dispatchable.some((profile) => profile.id === projectDefault) ? projectDefault : "")`;
  const brokenDefault = () => mutateScript("creation-studio.js", B_ANCHOR, B_BROKEN, "NC-B1 default resolves without dispatchability");
  await control({
    id: "NC-B1",
    label: "the default video target resolving to an unwired family again",
    guards: "a fresh or stale project still opens on a target that can run",
    defect: async () => {
      const picker = await Suite.motionPickerMarkup("minimax-h3/i2v", brokenDefault());
      /* RECEIPT: with the fixture's stale seedance default, the picker opens on a
         target CineBraid owns no adapter for. */
      return picker.preferred === "seedance-2/i2v";
    },
    guarded: () => Suite.testFreshProjectResolvesToADispatchableTarget(brokenDefault()),
  });

  /* NC-B2 — the shipped default STRING back to an unwired family. Not a source
     mutation: the guard reads the declared defaults, so the control hands it the
     declaration the repair replaced. */
  await control({
    id: "NC-B2",
    label: "the shipped new-project default back to seedance-2/i2v",
    guards: "the shipped default video target is dispatchable",
    defect: async () => {
      /* RECEIPT: this is the exact string both files shipped before the repair. */
      const before = readLF(path.join(ROOT, "server.js"));
      return !before.includes(`videoProfile: "seedance-2/i2v"`);
    },
    guarded: () => Suite.testShippedDefaultIsDispatchable({
      "server.js": "seedance-2/i2v",
      "public/app.js": "seedance-2/i2v",
    }),
  });

  /* ======================================================================
     NC-C1 — an unwired target allowed to look dispatchable. */
  const C_ANCHOR = `function guidedVideoProfileDispatchable(profile) {
  return profile?.execution?.dispatchable === true;
}`;
  const C_BROKEN = `function guidedVideoProfileDispatchable(profile) {
  return !!profile;
}`;
  const brokenDispatchable = () => mutateScript("creation-studio.js", C_ANCHOR, C_BROKEN, "NC-C1 everything looks dispatchable");
  await control({
    id: "NC-C1",
    label: "an unwired video target appearing selectable and unlabelled",
    guards: "an unwired target is visibly unavailable in the picker",
    defect: async () => {
      const picker = await Suite.motionPickerMarkup("minimax-h3/i2v", brokenDispatchable());
      const dead = picker.options.slice(picker.options.indexOf(`<option value="seedance-2/i2v"`));
      /* RECEIPT: Seedance is pressable again and says nothing about being unrunnable,
         which is the dead end the audit hit. */
      return !dead.slice(0, 160).includes("disabled") && !dead.slice(0, 160).includes("not available in this build");
    },
    guarded: () => Suite.testUnsupportedTargetIsVisiblyUnavailable(brokenDispatchable()),
  });

  /* NC-C2 — the refusal removed. The target is still not dispatchable and still has no
     Generate button; the only thing lost is the sentence saying why. */
  /* ANCHOR MOVED BY BATCH 2 SLICE 5b, and the control is unchanged. The renderer now
     handles a SECOND reason a target can be unusable — the shot's declared intent
     excluding it — and that branch sits above this one. NC-C2 is still about the
     DISPATCH refusal going silent, so it still mutates the dispatch branch; the scenario
     below declares no intent, so the branch above it returns "" and control reaches this
     one exactly as it always did. */
  const C2_ANCHOR = `  if (!profile || guidedVideoProfileDispatchable(profile)) return "";
  const execution = profile.execution || {};`;
  const C2_BROKEN = `  if (profile || !profile) return "";
  const execution = profile.execution || {};`;
  const brokenRefusal = () => mutateScript("creation-studio.js", C2_ANCHOR, C2_BROKEN, "NC-C2 the refusal is silent again");
  await control({
    id: "NC-C2",
    label: "an unwired target failing silently with no stated reason",
    guards: "an unwired selection refuses with a reason and a working alternative",
    defect: async () => {
      const picker = await Suite.motionPickerMarkup("seedance-2/i2v", brokenRefusal());
      /* RECEIPT: no paid action AND no explanation — exactly the silent dead end. */
      return picker.refusal === "" && picker.generateAction === "";
    },
    guarded: () => Suite.testRefusalCarriesReasonAndAlternative(brokenRefusal()),
  });

  await control({
    id: "NC-C3",
    label: "the same silence at the built-prompt card, where the paid action would be",
    guards: "an unwired target cannot reach submission and says so in place of the action",
    defect: async () => {
      const picker = await Suite.motionPickerMarkup("seedance-2/i2v", brokenRefusal());
      return picker.refusal === "";
    },
    guarded: () => Suite.testUnsupportedTargetCannotReachSubmission(brokenRefusal()),
  });

  /* ======================================================================
     NC-D1 — a batch approval no longer marked as a human decision. The defect
     verbatim: the writer records its own vocabulary and nothing else. */
  const D1_ANCHOR = `function markBatchApprovalAsHumanDecision(row) {
  if (!row) return;
  row.humanApproved = true;
  row.humanApprovedWithoutAI = false;
}`;
  const D1_BROKEN = `function markBatchApprovalAsHumanDecision(row) {
  if (!row) return;
}`;
  const brokenBatchMark = () => mutateScript("review.js", D1_ANCHOR, D1_BROKEN, "NC-D1 batch approval unmarked");
  await control({
    id: "NC-D1",
    label: "a director's batch approval not recorded as a human decision",
    guards: "batch-approved reference, coverage and expression render as APPROVED BY YOU",
    defect: async () => {
      const result = await Suite.batchApproval("reference", brokenBatchMark());
      /* RECEIPT: the image is approved, the entity is APPROVED, and the panel still
         tells the director nobody has decided anything. */
      return result.decision === "approved-reference"
        && result.humanApproved === false
        && result.rendered.includes("NO HUMAN DECISION YET");
    },
    guarded: () => Suite.testBatchApprovalRendersAsHumanApproval(brokenBatchMark()),
  });

  /* NC-D2 — the opposite error, and the more dangerous one: an AI pass implying the
     human approval. */
  /* BATCH 1C: the label expression gained a fourth outcome — SELECTED BY YOU,
     for a supporting-reference commit that establishes no canon — so the anchor
     moved with it. The control is unchanged in intent: make a passing AI review
     read as a human approval, and require the invariant to notice. */
  /* SIMPLIFICATION PASS: the label gained a fifth outcome — APPROVED EARLIER ·
     NOT CURRENT CANON, for a row whose cached humanApproved no receipt
     supports — so the anchor moved with it. The control is unchanged in intent:
     make a passing AI review read as a human approval, and require the
     invariant to notice. */
  const D2_ANCHOR = `  const claimed = !selection && (row?.humanApproved || decision === "approved");`;
  const D2_BROKEN = `  const claimed = !selection && (row?.humanApproved || decision === "approved" || review?.pass);`;
  const brokenAiApproval = () => mutateScript("review.js", D2_ANCHOR, D2_BROKEN, "NC-D2 an AI pass reads as an approval");
  await control({
    id: "NC-D2",
    label: "a passing AI review rendering as a human approval",
    guards: "an AI pass alone is still NO HUMAN DECISION YET",
    defect: async () => {
      const result = await Suite.batchApproval("reference", brokenAiApproval());
      /* RECEIPT: an unreviewed candidate with a passing AI result now claims the
         director approved it. */
      return result.unreviewedRendering.includes("APPROVED BY YOU");
    },
    guarded: () => Suite.testAiPassAloneIsNotAnApproval(brokenAiApproval()),
  });

  /* ======================================================================
     NC-E — the false promise restored. */
  const E_ANCHOR = `  toast("Alert dismissed. The run is archived and stays in Reports until it ages out of the run history.");`;
  const E_BROKEN = `  toast("Alert dismissed. The run remains available in Reports.");`;
  const brokenPromise = () => mutateScript("live-activity.js", E_ANCHOR, E_BROKEN, "NC-E the unconditional Reports promise");
  await control({
    id: "NC-E",
    label: 'the "remains available in Reports" promise restored',
    guards: "the dismiss copy no longer promises indefinite availability",
    defect: async () => {
      const copy = await Suite.dismissCopy(brokenPromise());
      /* RECEIPT: the sentence retention does not honour is back on screen. */
      return copy.said.join(" ").includes("The run remains available in Reports.");
    },
    guarded: () => Suite.testDismissCopyDoesNotPromiseIndefiniteReports(brokenPromise()),
  });

  /* ======================================================================
     NC-F1 — the browser reader back to the fields no writer produces. */
  const F1_ANCHOR = `function falJobProviderRequestId(job) {
  return String(job?.externalId || "");
}`;
  const F1_BROKEN = `function falJobProviderRequestId(job) {
  return String(job?.providerRequestId || job?.requestId || "");
}`;
  const brokenBrowserReader = () => mutateScript("fal-generation.js", F1_ANCHOR, F1_BROKEN, "NC-F1 browser reads an invented field");
  await control({
    id: "NC-F1",
    label: "the browser reading providerRequestId / requestId off a job again",
    guards: "a historical row in the persisted externalId shape is recognised",
    defect: async () => {
      const rendered = await Suite.testHistoricalRowsNeedNoRewrite(brokenBrowserReader()).then(() => false).catch((error) => {
        /* RECEIPT: the stored id disappears — a real provider handle renders as
           nothing, which is precisely what the screens were showing. */
        return error instanceof assert.AssertionError && /the browser reads the same persisted field/.test(error.message);
      });
      return rendered;
    },
    guarded: () => Suite.testHistoricalRowsNeedNoRewrite(brokenBrowserReader()),
  });

  /* NC-F2 — the lifecycle reader, which is what decides whether a paid request was
     ever accepted. */
  const F2_ANCHOR = `function providerRequestId(job) {
  return String(job?.externalId || "");
}`;
  const F2_BROKEN = `function providerRequestId(job) {
  return String(job?.providerRequestId || job?.requestId || "");
}`;
  const brokenLifecycle = () => brokenModule(LIFECYCLE_PATH, (source) => mutateOnce(source, F2_ANCHOR, F2_BROKEN, "NC-F2 lifecycle reads an invented field"));
  await control({
    id: "NC-F2",
    label: "provider acceptance decided from fields nothing writes",
    guards: "acceptance is decided by the persisted handle and the real status vocabulary",
    defect: () => {
      const broken = brokenLifecycle();
      /* RECEIPT: a job the provider accepted and then failed is reported as one that
         never reached the provider — the diagnostic that tells a filmmaker no paid
         request was made when one was. */
      return broken.providerAcceptedRequest({ status: "FAILED", externalId: "req-1" }) === false;
    },
    guarded: () => Suite.testFailureAndUncertaintyClassifyFromRealFields(brokenLifecycle()),
  });

  /* ======================================================================
     NC-G — the FLF motion-readiness gate bypassed by the very thing this batch
     added. The task selection is moved ahead of the gate, so the motion workspace
     opens before the readiness decision. */
  const G_ANCHOR = `  if (approvedCount >= 2 && !sequenceReview?.pass) return toast(sequenceReview ? "Correct the frame-sequence continuity issues before creating motion" : "Run the frame-sequence continuity review before creating motion");`;
  const G_BROKEN = `  selectGuidedPanelTask(s, "motion");
  if (approvedCount >= 2 && !sequenceReview?.pass) return toast(sequenceReview ? "Correct the frame-sequence continuity issues before creating motion" : "Run the frame-sequence continuity review before creating motion");`;
  const brokenGate = () => mutateScript("creation-studio.js", G_ANCHOR, G_BROKEN, "NC-G the task selection jumps the readiness gate");
  await control({
    id: "NC-G",
    label: "the motion workspace selected ahead of the FLF readiness gate",
    guards: "the readiness gate refuses before the motion workspace is selected",
    defect: async () => {
      const result = await Suite.motionGateNavigationBehaviour(brokenGate());
      /* RECEIPT: two approved anchors, no passing readiness review, the refusal is
         still spoken — and the motion workspace opened anyway, putting a paid submit
         within reach ahead of the gate's decision. */
      return result.approvedCount >= 2 && result.reviewPassed === false
        && result.refused === true && result.selectedTask === "motion";
    },
    guarded: () => Suite.testMotionGateStillRefusesNavigation(brokenGate()),
  });

  /* Every control must have actually bitten. A control whose anchor silently stopped
     matching would otherwise report green for a guarantee it no longer guards. */
  const expected = [
    "NC-A openGuidedPanel writes only openPanels",
    "NC-A the DOM poll decides again",
    "NC-B1 default resolves without dispatchability",
    "NC-C1 everything looks dispatchable",
    "NC-C2 the refusal is silent again",
    "NC-D1 batch approval unmarked",
    "NC-D2 an AI pass reads as an approval",
    "NC-E the unconditional Reports promise",
    "NC-F1 browser reads an invented field",
    "NC-F2 lifecycle reads an invented field",
    "NC-G the task selection jumps the readiness gate",
  ];
  for (const label of expected) assert(applied.includes(label), `NEGATIVE CONTROL NEVER RAN — ${label}`);

  /* And the real modules are still intact afterwards: nothing was written. */
  assert.strictEqual(readLF(LIFECYCLE_PATH), LIFECYCLE_SOURCE, "generation-lifecycle.js on disk must be untouched");

  console.log(`Private-alpha production loop negative controls passed: ${results.length} deliberate defects reintroduced in memory, `
    + "every one detected by the guard that exists for it, every one with a live-defect receipt, and the real modules untouched on disk. "
    + "Provider calls made: 0.");
  for (const row of results) console.log(`  - ${row.id} ${row.label} -> caught by "${row.guards}" (${row.outcome})`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
