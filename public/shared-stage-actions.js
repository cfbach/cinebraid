/* CineBraid — the persistent stage-action contract, shared by browser and Node the
   same way public/shared-stage-model.js and public/shared-creator-state.js are.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: the actions CineBraid offers in a
   fixed place on screen are DERIVED from the stage the declared model returned, so a
   persistent button cannot say a stage is ready when the declaration says it is
   blocked.

   ---------------------------------------------------------------------------
   WHAT THIS IS NOT. It is not a workflow engine, and it is not a second opinion
   about anything.

   * IT DECIDES NO AVAILABILITY. `availability` and `disabledReason` are copied,
     unchanged, off the O1 stage state the caller was handed. There is no rule in
     this file that can make an action available when the stage is blocked, and none
     that can invent a reason the declaration did not give. tests/stage-surfaces-negative-controls.js
     re-derives one locally and requires the suite to go red for it.

   * IT NAMES NO PANEL. The target a primary action opens is the stage's OWN first
     declared panel, read from public/shared-stage-model.js. A literal map from stage
     to panel here would be the sixth statement of the stage list that O1 was written
     to delete.

   * IT INVOKES NOTHING. Every action carries an `invoke` DESCRIPTION — a token and
     its arguments — and the runtime turns that into the shipped call. This module
     cannot reach a handler, a project, a route or a DOM, which is what lets Node
     drive it against representative stage states.

   * IT PERSISTS NOTHING. Actions are derived on every call from a frozen input and
     returned frozen. Nothing here is stored on a shot, and a caller that stored one
     would have turned a rendering into production state.

   ---------------------------------------------------------------------------
   THE PAID / DESTRUCTIVE REFUSAL, which is structural rather than a convention.

   Making actions persistent makes them easier to hit — that is the entire point —
   and the actions it must NOT make easier to hit are the ones that spend money or
   throw work away. So both are declared fields, and `stageActions()` DROPS any
   candidate whose `paid` or `destructive` flag is true rather than rendering it
   differently. A future edit that adds a persistent one-click paid retry therefore
   produces no button at all, which is a visible failure, instead of a button that
   works. Approval is likewise absent, and absent by construction: see
   STAGE_ACTION_LIMITATIONS.

   ---------------------------------------------------------------------------
   THE VOCABULARY.

     id             stable action name. Not a label, not a stage id.

     emphasis       "primary"    the action that advances THIS stage's work.
                    "advance"    the declared handoff to the recommended next stage.

                    There is deliberately no "secondary". An action that operates on
                    one candidate, one asset or one setting belongs beside that
                    object, and a persistent bar that accepted a third tier would
                    become the junk drawer this contract exists to keep it out of.

     availability   "available" | "blocked", COPIED from the stage state.

     disabledReason the declaration's own words, empty when available. An action that
                    is blocked with no reason is a worse answer than no action, so
                    the builder refuses to emit one.

     advances       does invoking this change which stage the workspace shows.

     invoke         { kind: "open-panel", shotId, panel }   the shipped cross-panel
                                                            handoff, openGuidedPanel.
                    { kind: "select-stage", shotId, stageId } the shipped stage
                                                            selection, selectBoundedTask.

   `label` is built here from the DECLARED stage label plus one verb, so the words a
   filmmaker reads on the bar and the words on the strip are the same words. */

(function (root, factory) {
  const model = typeof module !== "undefined" && module.exports
    ? require("./shared-stage-model.js")
    : root;
  const api = factory(model);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function (model) {
  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  function actionText(value) {
    return String(value == null ? "" : value).trim();
  }

  const STAGE_ACTION_EMPHASIS = deepFreeze(["primary", "advance"]);
  const STAGE_ACTION_INVOKE_KINDS = deepFreeze(["open-panel", "select-stage"]);

  /* The only two verbs. "Review" is used where the declared model said the stage's
     work is waiting on a human judgement, which is the one case where the filmmaker
     is being asked for something rather than offered somewhere to go. Every other
     completion gets the neutral verb, because "Continue Frames" on a stage with one
     approved frame would be reading intent into a count. */
  const STAGE_ACTION_VERB = deepFreeze({ "needs-review": "Review", default: "Open" });

  /* What a persistent action surface cannot honestly offer today, stated rather than
     approximated. Each entry names what would have to exist first. tests/stage-surfaces.js
     asserts these stay declared for as long as the condition holds. */
  const STAGE_ACTION_LIMITATIONS = deepFreeze({
    "no-approval-action": {
      question: "May the persistent surface approve the thing the stage is waiting on?",
      why: "Approval establishes canon and is performed on ONE named candidate; the persistent surface is stage-scoped and holds no candidate, so an approve button here would either approve something the filmmaker did not choose or be a link wearing an approval's clothes.",
      wouldNeed: "nothing — approval is meant to stay beside the candidate it approves",
    },
    "no-generation-action": {
      question: "May the persistent surface start a generation?",
      why: "Every generation CineBraid can dispatch is paid, and which route is executable depends on the shot's chosen target rather than on its stage. A persistent one-click paid action is the specific risk this contract refuses.",
      wouldNeed: "a per-stage generation route on the shot record, and a decision that paid work should be one click from anywhere",
    },
    "no-stage-completion-action": {
      question: "May the persistent surface mark a stage complete?",
      why: "Completion is DERIVED by public/shared-stage-model.js from approved production authorities and is never stored. An action that marked a stage complete would have to write the per-stage status that model exists to not have.",
      wouldNeed: "a stored per-stage status, which O1 declined on purpose",
    },
  });

  function stageDeclaration(stageId) {
    return typeof model?.shotStage === "function" ? model.shotStage(stageId) : null;
  }

  /* The panel a stage's own work lives in: its FIRST declared panel. Reading it here
     rather than mapping it means a stage whose workspace moves takes its persistent
     action with it. */
  function stagePrimaryPanel(stageId) {
    return stageDeclaration(stageId)?.panels?.[0] || "";
  }

  function stageLabel(stageId) {
    return stageDeclaration(stageId)?.label || "";
  }

  /* Every candidate goes through here, and the refusals are the point. An action
     that is blocked with no reason, that names no invocation, that costs money or
     that destroys something is DROPPED — the caller gets a shorter list rather than
     a button that misleads. */
  function acceptAction(candidate) {
    if (!candidate) return null;
    const id = actionText(candidate.id);
    const stageId = actionText(candidate.stageId);
    const label = actionText(candidate.label);
    const availability = candidate.availability === "blocked" ? "blocked" : "available";
    const disabledReason = availability === "blocked" ? actionText(candidate.disabledReason) : "";
    if (!id || !stageId || !label) return null;
    if (availability === "blocked" && !disabledReason) return null;
    if (!STAGE_ACTION_EMPHASIS.includes(candidate.emphasis)) return null;
    if (!candidate.invoke || !STAGE_ACTION_INVOKE_KINDS.includes(candidate.invoke.kind)) return null;
    if (candidate.paid === true || candidate.destructive === true) return null;
    return {
      id,
      stageId,
      label,
      availability,
      disabledReason,
      emphasis: candidate.emphasis,
      advances: candidate.advances === true,
      paid: false,
      destructive: false,
      invoke: { ...candidate.invoke },
    };
  }

  /* ==========================================================================
     THE DERIVATION.

     `state` is a public/shared-stage-model.js stage state and nothing else — the
     same object the strip renders. `shotId` is the record the invocations address.
     Returns at most two actions, in the order they should be read.

     WHAT IS NOT READ, and each absence is a rule from the brief:

       a frame count       two approved frames imply nothing about first/last-frame
                           motion, so no action's existence depends on how many
                           frames there are.
       a generation route  none is declared per stage, and none is consulted.
       an AI verdict       a recommendation is not an approval and causes nothing.
       `state.activity`    what a machine is doing does not change what the
                           filmmaker may do; the strip shows activity, the bar does
                           not gate on it. */
  function stageActions(state, shotId) {
    const id = actionText(shotId);
    const stageId = actionText(state?.id);
    if (!id || !stageId || !stageDeclaration(stageId)) return deepFreeze([]);

    const panel = stagePrimaryPanel(stageId);
    const verb = STAGE_ACTION_VERB[state.completion] || STAGE_ACTION_VERB.default;
    const candidates = [
      panel && {
        id: "open-stage-work",
        stageId,
        label: `${verb} ${stageLabel(stageId)}`,
        /* Copied, never re-decided. This is the whole contract in one line. */
        availability: state.availability,
        disabledReason: state.blockedReason,
        emphasis: "primary",
        advances: false,
        invoke: { kind: "open-panel", shotId: id, panel },
      },
    ];

    /* NO RECOMMENDATION IS A RESULT. An empty `recommendedNext` is the declared model
       saying it does not know what should happen next, and the honest rendering of
       that is no advance action — not a Continue pointed at whichever stage comes
       next in the list, which is the guess principle 9 forbids. */
    const next = actionText(state.recommendedNext);
    if (next && stageDeclaration(next)) {
      candidates.push({
        id: "continue-to-next-stage",
        stageId,
        label: `Continue to ${stageLabel(next)}`,
        /* An advance is offered on the strength of the recommendation, and the
           recommendation is only ever produced for a stage whose own work is done —
           so it carries this stage's availability, not the next stage's. Selecting a
           stage is navigation; O1 is explicit that availability is not reachability. */
        availability: state.availability,
        disabledReason: state.blockedReason,
        emphasis: "advance",
        advances: true,
        invoke: { kind: "select-stage", shotId: id, stageId: next },
      });
    }

    return deepFreeze(candidates.map(acceptAction).filter(Boolean));
  }

  return {
    STAGE_ACTION_EMPHASIS,
    STAGE_ACTION_INVOKE_KINDS,
    STAGE_ACTION_VERB,
    STAGE_ACTION_LIMITATIONS,
    stagePrimaryPanel,
    stageActions,
  };
});
