/* CineBraid — the declared filmmaking stage model, shared by browser and Node the
   same way public/shared-coverage.js and public/shared-continuity.js are shared.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: CineBraid knows what its
   filmmaking stages are because they are declared here, not because somebody can
   infer them from whatever DOM children happen to render today.

   ---------------------------------------------------------------------------
   WHAT THIS REPLACED. Before this module the five shot stages were stated five
   separate times, all inside public/creation-studio.js, and a sixth time as a
   source-text assertion in tests/clarity-consolidation.js:

     boundedShotTaskbarMarkup()   `defs`               id + label + detail + order
     boundedShotSelectedTask()    `ids`                order + allow-list
     boundedShotSelectedTask()    `legacyMap`          legacy stored id -> stage
     guidedShotWorkspaceView()    `renderers`          stage -> workspace renderer
     GUIDED_PANEL_TASKS                                legacy panel key -> stage

   Nothing kept them in agreement. A stage added to `defs` and not to `ids` was a
   button that could be pressed and never selected; a stage in `ids` with no entry
   in `renderers` silently fell through to Frames. public/focused-workspaces.js
   held a sixth answer built from DOM child order and CSS class names, which is
   the one this module exists to make unnecessary.

   ---------------------------------------------------------------------------
   THREE PROPERTIES THAT ARE STRUCTURAL HERE RATHER THAN MERELY TESTED.

   * NOTHING IS STORED. No shot carries a per-stage status field and this module
     never writes one. Every availability, completion and recommendation is DERIVED, on
     every call, from a fact record the caller assembles out of authoritative
     project data. A caller that persists the result has created the second
     workflow truth this module exists to prevent.

     (public/app.js still contains an older seven-stage model — SHOT_STAGE_ORDER,
     SHOT_STAGE_META, approveShotStage, markShotStageNotNeeded — which DID persist
     stage status into `shot.stageApprovals`. It is unreachable: SHOT_STAGE_ORDER
     has no reader and the three writers have no callers. It is deliberately left
     in place because `stageApprovals` is still carried by server.js and the OFP
     migration rules, so deleting it is a persistence change, not an O1 change.
     tests/stage-model.js pins it inert so it cannot quietly become a rival truth.)

   * NO GENERATION ROUTE IS DECLARED HERE. References define what the world is,
     shot direction defines what happens, and the generation route decides how it
     is executed — a stage is none of those three. Not one of the four generation
     route names appears anywhere in this file, and a stage's completion never reads
     a frame COUNT. "Two approved frames exist" is a fact about frames; it is not a
     directorial decision to constrain both endpoints, and this module must never
     turn the first into the second. tests/stage-model-negative-controls.js breaks
     exactly that line and requires a failure.

   * AVAILABILITY AND COMPLETION ARE DIFFERENT QUESTIONS, and are returned as
     separate fields. "Blocked" is not "not started", and "optional" is not
     "complete". See THE VOCABULARY below.

   ---------------------------------------------------------------------------
   THE VOCABULARY, frozen here because it is the thing that used to be re-guessed
   per screen.

     availability   "available"  the stage's work can proceed now.
                    "blocked"    a real prerequisite is unmet. blockedReason says
                                 which, in the filmmaker's words.

                    Availability is NOT reachability. All five stages are always
                    selectable in the taskbar — that is deliberate, and principle
                    8 (primary actions stay visible and explain prerequisites)
                    depends on it. Availability answers "can I do this work yet",
                    not "can I look at it".

                    There is no "not-applicable" member. A shot record declares no
                    per-stage generation route today, so nothing in the project
                    data can distinguish "this shot will never need motion" from
                    "this shot has not got there yet". Inventing the distinction
                    would be a guess, so it is reported as a declared limitation
                    instead. See SHOT_STAGE_LIMITATIONS.

     completion     "not-started" | "in-progress" | "needs-review" | "complete"

                    Completion describes the WORK, and is derived independently of
                    any machine that happens to be running. A frames stage with an
                    automation run in flight still has whatever completion its
                    approved frames give it.

     activity       "" | "running" | "awaiting-review" | "failed" | "interrupted"

                    What a machine is doing on this stage right now, mirrored from
                    the automation run. Separate from completion for the reason
                    above. `interrupted` is known to be overloaded upstream; this
                    module passes it through unchanged rather than reinterpreting
                    it, which would be a second opinion about run state.

     optional       declared, not derived: may this stage be skipped outright.

   `tone` and `statusKey` are the SHIPPED PRESENTATION PROJECTION of the three
   fields above, returned here so the taskbar keeps rendering exactly what it
   rendered before this module existed. `statusKey` names a key in the UI's own
   STAGE_STATUS wording table (public/app.js) — the words stay in the UI layer,
   because centralising unrelated UI text is not what this file is for. Likewise
   `note` is a TOKEN plus its counts, never a sentence: the caller formats it with
   its own count-aware wording so "1 reference" never becomes "1 references". */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  /* The one storage scope shot stage selection lives in. public/bounded-rendering.js
     keys `cinebraid-focused:<project>:<scope>:<id>` off it, and every writer in the
     app must use that key or its write is invisible to the reader — which is exactly
     how two stage-navigation writers came to do nothing at all. */
  const SHOT_STAGE_SCOPE = "shot-task";

  const AVAILABILITY = ["available", "blocked"];
  const COMPLETION = ["not-started", "in-progress", "needs-review", "complete"];
  const ACTIVITY = ["", "running", "awaiting-review", "failed", "interrupted"];

  /* ==========================================================================
     THE DECLARATION.

     Order is the explicit `order` integer, not the array index, so a reader that
     sorts is reading a declared fact rather than an incidental one. Both are kept
     in agreement by tests/stage-model.js.

     `task.id` is stated separately from the stage `id` even though the two strings
     are equal today. They answer different questions: `id` is the stage's stable
     semantic name, `task.id` is the value stored in browser workspace state and
     already present in existing installs. Renaming the visible workspace must not
     force a stored-value migration, and vice versa.

     `authority` names the APPROVED production authority that feeds the stage.
     Human approval establishes canon; an AI PASS is not on this list because an
     AI recommendation is not an approval and causes nothing on its own. */
  const SHOT_STAGES = deepFreeze([
    {
      id: "inputs",
      order: 1,
      label: "Inputs",
      detail: "Cast, assets and source media",
      purpose: "Establish what the shot is and which approved authorities feed it.",
      task: { scope: SHOT_STAGE_SCOPE, id: "inputs" },
      navigation: { kind: "task-selection", route: "#/shot/:shotId" },
      panels: ["inputs"],
      panelViews: {},
      legacyTaskIds: [],
      optional: true,
      authority: ["approved-entity-references", "linked-project-media"],
      prerequisites: [],
      next: ["look", "frames"],
    },
    {
      id: "look",
      order: 2,
      /* NOT renamed to "Shot Planning". The workspace this stage implements is
         still blocking and approved references, and renaming shipped UI on the
         strength of a likely direction would be a claim the code does not yet
         support. The declaration is the thing that makes the later rename cheap:
         a broader planning stage changes `label`, `purpose` and `panels` here,
         and no reader has to be found again. */
      label: "Look & blocking",
      detail: "Camera, staging and approved references",
      purpose: "Decide how the shot is staged and which approved look governs it.",
      task: { scope: SHOT_STAGE_SCOPE, id: "look" },
      navigation: { kind: "task-selection", route: "#/shot/:shotId" },
      panels: ["blocking", "composer"],
      /* The two look sub-views are one stage with a tab, so a panel target has to
         say which tab as well as which stage. */
      panelViews: { blocking: "blocking", composer: "authority" },
      legacyTaskIds: ["blocking", "composer"],
      optional: true,
      authority: ["approved-entity-references", "approved-blocking-guide"],
      prerequisites: [],
      next: ["frames"],
    },
    {
      id: "frames",
      order: 3,
      label: "Frames",
      detail: "Import, choose and approve stills",
      purpose: "Create and approve the shot's still frames, required and optional.",
      task: { scope: SHOT_STAGE_SCOPE, id: "frames" },
      navigation: { kind: "task-selection", route: "#/shot/:shotId" },
      panels: ["still", "review", "frames"],
      panelViews: {},
      legacyTaskIds: ["automation"],
      /* Not declared optional, and that is a limitation being reported rather than
         a policy being endorsed — see SHOT_STAGE_LIMITATIONS.frames-not-optional. */
      optional: false,
      authority: ["approved-entity-references", "approved-blocking-guide", "approved-continuity-states"],
      prerequisites: [],
      next: ["motion", "deliver"],
    },
    {
      id: "motion",
      order: 4,
      label: "Motion & sound",
      detail: "Attach video, dialogue and audio",
      purpose: "Give the shot movement and sound, or attach video made elsewhere.",
      task: { scope: SHOT_STAGE_SCOPE, id: "motion" },
      navigation: { kind: "task-selection", route: "#/shot/:shotId" },
      panels: ["motion", "motionCreate", "motionAudio"],
      panelViews: {},
      legacyTaskIds: [],
      optional: true,
      authority: ["approved-frames", "approved-entity-references", "approved-audio-references"],
      /* ONE prerequisite, named, and deliberately count-free. "Required frames are
         approved" is true of a shot with one approved frame and a second frame the
         filmmaker marked not required, which is the reference-rich case that must
         be able to proceed without a deliberate ending frame. A prerequisite
         phrased as "two approved frames" would have made the endpoint constraint an
         accident of how many frames exist. */
      prerequisites: [{ id: "required-frames-approved", reason: "Approve the required frames first" }],
      next: ["deliver"],
    },
    {
      id: "deliver",
      order: 5,
      label: "Deliver",
      detail: "Finish, repair, upscale and finalize",
      purpose: "Finish the approved result and lock it for delivery.",
      task: { scope: SHOT_STAGE_SCOPE, id: "deliver" },
      navigation: { kind: "task-selection", route: "#/shot/:shotId" },
      panels: ["finish"],
      panelViews: {},
      legacyTaskIds: ["finish"],
      optional: false,
      authority: ["approved-frame", "approved-motion-take"],
      prerequisites: [{ id: "approved-result", reason: "Approve a still or a video first" }],
      next: [],
    },
  ]);

  /* What this model cannot currently answer, stated rather than guessed. Each entry
     names the project data that would have to exist before the answer could be
     derived. tests/stage-model.js asserts these stay declared for as long as the
     condition holds, so a limitation cannot be quietly dropped instead of fixed. */
  const SHOT_STAGE_LIMITATIONS = deepFreeze({
    "no-not-applicable": {
      question: "Is this stage not yet relevant to this shot, as opposed to not started?",
      why: "A shot record declares no per-stage generation route, so nothing distinguishes a shot that will never need motion from one that has not reached motion.",
      wouldNeed: "a declared shot delivery route on the shot record",
    },
    "frames-not-optional": {
      question: "May Frames be skipped entirely for a reference-only or description-only shot?",
      why: "The shipped runtime gates the motion workspace on approved required frames regardless of how the shot would be generated, so declaring Frames optional would describe a path the app does not currently offer.",
      wouldNeed: "a motion workspace whose prerequisite depends on the shot's chosen generation route",
    },
  });

  const SHOT_STAGE_IDS = deepFreeze(SHOT_STAGES.map((stage) => stage.id));

  function stageText(value) {
    return String(value == null ? "" : value).trim();
  }

  function shotStage(id) {
    const key = stageText(id);
    return SHOT_STAGES.find((stage) => stage.id === key) || null;
  }

  /* Legacy panel key -> stage. The panel keys are the `data-guided-panel` values
     that cross-workspace actions have always used; they are declared per stage so
     the mapping and the workspace that owns the panel cannot drift apart. */
  function shotStageForPanel(panelKey) {
    const key = stageText(panelKey);
    return SHOT_STAGES.find((stage) => stage.panels.includes(key)) || null;
  }

  /* The sub-view a panel target implies, or "" when the stage has no tabs. */
  function shotStagePanelView(panelKey) {
    const key = stageText(panelKey);
    const stage = shotStageForPanel(key);
    return stage ? stage.panelViews[key] || "" : "";
  }

  /* A stored workspace-state value written by an older build -> the stage it means
     now. Returns "" for a value that is already a current stage id, so a caller can
     tell "this needs translating" from "this is fine". */
  function shotStageForLegacyTaskId(stored) {
    const key = stageText(stored);
    if (!key || SHOT_STAGE_IDS.includes(key)) return null;
    return SHOT_STAGES.find((stage) => stage.legacyTaskIds.includes(key)) || null;
  }

  /* ==========================================================================
     THE FACT RECORD.

     Everything derived below reads ONLY these fields. They are assembled by the
     caller out of authoritative project data (approved frames, linked references,
     the active blocking guide, the shot lifecycle, the automation run) — this
     module deliberately cannot reach the project itself, which is what keeps it
     testable in Node against representative shot states and keeps it incapable of
     mutating anything. */
  const SHOT_STAGE_FACT_KEYS = deepFreeze([
    "referenceCount",
    "missingReferenceCount",
    "blockingGuideActive",
    "blockingGuideCandidateCount",
    "frameTotal",
    "frameApprovedCount",
    "frameNeedsReview",
    "requiredFramesApproved",
    "motionCandidateCount",
    "activityStatus",
    "lifecycleKey",
    "deliveryIntent",
  ]);

  function stageCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function normaliseShotStageFacts(facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const activity = stageText(raw.activityStatus);
    return {
      referenceCount: stageCount(raw.referenceCount),
      missingReferenceCount: stageCount(raw.missingReferenceCount),
      blockingGuideActive: !!raw.blockingGuideActive,
      blockingGuideCandidateCount: stageCount(raw.blockingGuideCandidateCount),
      frameTotal: stageCount(raw.frameTotal),
      frameApprovedCount: stageCount(raw.frameApprovedCount),
      frameNeedsReview: !!raw.frameNeedsReview,
      requiredFramesApproved: !!raw.requiredFramesApproved,
      motionCandidateCount: stageCount(raw.motionCandidateCount),
      activityStatus: ACTIVITY.includes(activity) ? activity : "",
      lifecycleKey: stageText(raw.lifecycleKey),
      deliveryIntent: stageText(raw.deliveryIntent),
    };
  }

  /* ==========================================================================
     THE DERIVATIONS.

     One function per stage, each returning the same shape. The shipped taskbar's
     `tone` and `statusKey` are produced here alongside the semantic fields so the
     two can never disagree — a stage cannot report "complete" to a future stage
     strip while painting "Needs review" on the taskbar. */

  function stageResult(stage, parts) {
    return {
      id: stage.id,
      order: stage.order,
      label: stage.label,
      detail: stage.detail,
      purpose: stage.purpose,
      optional: stage.optional,
      availability: parts.availability,
      blockedReason: parts.blockedReason || "",
      completion: parts.completion,
      activity: parts.activity || "",
      statusKey: parts.statusKey,
      tone: parts.tone,
      note: parts.note || null,
      authority: stage.authority,
      next: stage.next,
      recommendedNext: parts.recommendedNext || "",
    };
  }

  function inputsState(stage, facts) {
    if (facts.missingReferenceCount) {
      return stageResult(stage, {
        availability: "available",
        completion: "in-progress",
        statusKey: "incomplete",
        tone: "attention",
        note: { key: "references-missing", count: facts.missingReferenceCount },
      });
    }
    if (facts.referenceCount) {
      return stageResult(stage, {
        availability: "available",
        completion: "complete",
        statusKey: "complete",
        tone: "complete",
        note: { key: "references-linked", count: facts.referenceCount },
      });
    }
    return stageResult(stage, { availability: "available", completion: "not-started", statusKey: "notStarted", tone: "pending" });
  }

  function lookState(stage, facts) {
    if (facts.blockingGuideActive)
      return stageResult(stage, { availability: "available", completion: "complete", statusKey: "complete", tone: "complete" });
    if (facts.blockingGuideCandidateCount) {
      return stageResult(stage, {
        availability: "available",
        completion: "needs-review",
        statusKey: "needsReview",
        tone: "attention",
        note: { key: "blocking-guides-to-choose", count: facts.blockingGuideCandidateCount },
      });
    }
    return stageResult(stage, { availability: "available", completion: "not-started", statusKey: "notStarted", tone: "pending" });
  }

  function framesState(stage, facts) {
    /* Completion is computed FIRST and without reference to the run, because what a
       machine is doing is not how far the work has got. The projection below then
       prefers the run for the status slot, which is what the shipped taskbar does. */
    const note = { key: "frames-approved", count: facts.frameApprovedCount, total: facts.frameTotal };
    const completion = facts.frameNeedsReview
      ? "needs-review"
      : facts.requiredFramesApproved
        ? "complete"
        : facts.frameApprovedCount
          ? "in-progress"
          : "not-started";
    if (facts.activityStatus) {
      const attention = facts.activityStatus === "failed" || facts.activityStatus === "interrupted";
      return stageResult(stage, {
        availability: "available",
        completion,
        activity: facts.activityStatus,
        statusKey: facts.activityStatus === "failed" ? "failed" : facts.activityStatus === "awaiting-review" ? "needsReview" : "running",
        tone: attention ? "attention" : "active",
      });
    }
    if (facts.frameNeedsReview)
      return stageResult(stage, { availability: "available", completion, statusKey: "needsReview", tone: "attention", note });
    if (facts.requiredFramesApproved)
      return stageResult(stage, { availability: "available", completion, statusKey: "approved", tone: "complete", note });
    return stageResult(stage, {
      availability: "available",
      completion,
      statusKey: facts.frameApprovedCount ? "inProgress" : "notStarted",
      tone: "pending",
      note,
    });
  }

  function motionState(stage, facts) {
    /* The runtime opens the motion workspace when the required frames are approved
       OR when video has already come back, so availability says exactly that. Note
       what it does not say: nothing here counts approved frames, and nothing here
       chooses how the motion will be generated. */
    const open = facts.requiredFramesApproved || facts.motionCandidateCount > 0;
    const availability = open ? "available" : "blocked";
    const blockedReason = open ? "" : stage.prerequisites[0].reason;
    if (facts.lifecycleKey === "final" || facts.lifecycleKey === "motion-approved")
      return stageResult(stage, { availability, blockedReason, completion: "complete", statusKey: "approved", tone: "complete", recommendedNext: "deliver" });
    if (facts.lifecycleKey === "review-motion")
      return stageResult(stage, { availability, blockedReason, completion: "needs-review", statusKey: "needsReview", tone: "attention" });
    if (facts.requiredFramesApproved)
      return stageResult(stage, { availability, blockedReason, completion: "not-started", statusKey: "notStarted", tone: "pending" });
    return stageResult(stage, {
      availability,
      blockedReason,
      completion: "not-started",
      statusKey: "blocked",
      tone: "optional",
      note: { key: "blocked-reason", reason: blockedReason },
    });
  }

  function deliverState(stage, facts) {
    if (facts.lifecycleKey === "final")
      return stageResult(stage, { availability: "available", completion: "complete", statusKey: "complete", tone: "complete" });
    if (facts.lifecycleKey === "motion-approved" || facts.lifecycleKey === "still-ready")
      return stageResult(stage, { availability: "available", completion: "not-started", statusKey: "notStarted", tone: "pending" });
    const blockedReason = stage.prerequisites[0].reason;
    return stageResult(stage, {
      availability: "blocked",
      blockedReason,
      completion: "not-started",
      statusKey: "blocked",
      tone: "optional",
      note: { key: "blocked-reason", reason: blockedReason },
    });
  }

  const DERIVATIONS = { inputs: inputsState, look: lookState, frames: framesState, motion: motionState, deliver: deliverState };

  /* The one genuinely recommended handoff, or "" where none honestly exists.
     Frames -> Motion is recommended only when the shot has said it wants motion:
     an undecided shot gets no recommendation rather than a guess, because
     overclaiming a next step is how a workspace starts lying about the work. */
  function recommendedNextFor(stageId, facts) {
    if (stageId === "inputs") return "look";
    if (stageId === "look") return "frames";
    if (stageId === "frames") {
      if (!facts.requiredFramesApproved) return "";
      if (facts.deliveryIntent === "motion") return "motion";
      if (facts.deliveryIntent === "still") return "deliver";
      return "";
    }
    return "";
  }

  function shotStageState(stageId, facts) {
    const stage = shotStage(stageId);
    if (!stage) return null;
    const resolved = normaliseShotStageFacts(facts);
    const state = DERIVATIONS[stage.id](stage, resolved);
    const recommended = state.recommendedNext || recommendedNextFor(stage.id, resolved);
    /* A recommendation that is not a declared successor is a bug, not a shortcut. */
    return { ...state, recommendedNext: stage.next.includes(recommended) ? recommended : "" };
  }

  function shotStageProgress(facts) {
    const resolved = normaliseShotStageFacts(facts);
    return SHOT_STAGES.map((stage) => shotStageState(stage.id, resolved));
  }

  /* Which stage navigation should select when the filmmaker has expressed no
     preference: the first one a machine is working on, then the first needing
     attention, then the first not yet done, and finally the last declared stage.
     The final fallback is read off the declaration rather than written as "deliver",
     so adding a sixth stage cannot leave this pointing at the fifth. */
  function recommendedShotStageId(facts) {
    const states = shotStageProgress(facts);
    for (const tone of ["active", "attention", "pending"]) {
      const match = states.find((state) => state.tone === tone);
      if (match) return match.id;
    }
    return SHOT_STAGE_IDS[SHOT_STAGE_IDS.length - 1];
  }

  /* The whole of stage selection, in one place: a stored value is honoured when it
     names a declared stage, translated when it names a stage an older build called
     something else, and otherwise replaced by the recommendation. `index` handles
     the oldest stored form of all, a bare number, which is the only reading under
     which DOM order was ever the truth — it is accepted for compatibility and
     resolved against the DECLARED order, never against rendered children. */
  function resolveShotStageId(stored, facts) {
    const key = stageText(stored);
    if (SHOT_STAGE_IDS.includes(key)) return key;
    const legacy = shotStageForLegacyTaskId(key);
    if (legacy) return legacy.id;
    if (/^\d+$/.test(key)) {
      const index = Math.max(0, Math.min(SHOT_STAGE_IDS.length - 1, Number(key)));
      return SHOT_STAGE_IDS[index];
    }
    return recommendedShotStageId(facts);
  }

  return {
    SHOT_STAGE_SCOPE,
    SHOT_STAGES,
    SHOT_STAGE_IDS,
    SHOT_STAGE_LIMITATIONS,
    SHOT_STAGE_FACT_KEYS,
    SHOT_STAGE_AVAILABILITY: deepFreeze(AVAILABILITY),
    SHOT_STAGE_COMPLETION: deepFreeze(COMPLETION),
    SHOT_STAGE_ACTIVITY: deepFreeze(ACTIVITY),
    shotStage,
    shotStageForPanel,
    shotStagePanelView,
    shotStageForLegacyTaskId,
    normaliseShotStageFacts,
    shotStageState,
    shotStageProgress,
    recommendedShotStageId,
    resolveShotStageId,
  };
});
