/* CineBraid — SHOT READINESS, the smallest truthful answer to one question:

       CAN THIS BE PRODUCED NOW, FROM THIS PROJECT'S CURRENT PRODUCTION STATE?

   Shared by browser and Node the same way public/shared-stage-model.js and
   public/shared-coverage.js are shared, and deliberately in their family: it is a
   DERIVATION, not a store. It caches nothing, writes nothing, persists nothing and
   reaches no filesystem, network, clock or DOM.

   ---------------------------------------------------------------------------
   READY MEANS ONE THING, AND IT IS NARROWER THAN IT LOOKS. SAY IT IN THE UI.

       READY  =  this shot has an executable next production action now
       READY  ≠  this shot can run unattended to completion

   A shot is READY when its NEXT OUTSTANDING REQUIRED UNIT is executable. Later
   units of the same shot are routinely blocked behind an approval that does not
   exist yet — approving Frame A is a prerequisite for deriving Frame B, and both
   required frames are a prerequisite for motion. That is the honest answer, not an
   approximation: reporting the shot BLOCKED would hide work available right now,
   and reporting it ready-to-completion would promise something no shot with a
   dependent frame can deliver.

   A surface that renders `READY 12` beside a run-everything button is therefore
   making a claim this module does not: twelve shots have work that can START.

   ---------------------------------------------------------------------------
   THE THREE STATES, AND THEIR PRECEDENCE.

     READY           every required input of this unit is satisfied by current
                     durable authority, and at least one execution method is
                     admissible
     BLOCKED         at least one required input is absent, and CineBraid can name
                     exactly what would satisfy it
     NEEDS_DECISION  at least one requirement cannot be resolved truthfully without
                     a person, and CineBraid must not guess

     NEEDS_DECISION > BLOCKED > READY

   A unit with both a missing prerequisite and an unresolvable requirement is
   NEEDS_DECISION, because preparing the missing thing would be work performed
   against a target CineBraid cannot state.

   COMPLETE exists only in the SHOT ROLLUP and never on a unit. It is not a fourth
   readiness state — it is the existing done semantics, carried through: every
   declared unit already holds Canon. "Is it ready" is not a question about
   finished work, and a feed that counted finished shots as READY would keep
   offering work that does not exist.

   DELIBERATELY NOT IN THIS MODEL: `nearly-ready`, `75%-ready`, `almost-there`,
   `2 of 3 references`, `automation-ready`. Each of the first four is a
   PRESENTATION derivation a surface may compute from `counts` at any time; none is
   a state a shot can be IN. The fifth is a durable flag that would go stale the
   instant an approval was revoked, and it would be the second workflow truth
   shared-stage-model.js exists to prevent. Adding a presentation state to a
   semantic model is exactly how the stage model came to be stated five times in
   one file.

   ---------------------------------------------------------------------------
   THIS MODULE OWNS VERY LITTLE, AND THAT IS THE POINT.

   Owns:  the three-state vocabulary and its precedence; producible-unit
          decomposition; the composition of the satisfaction predicate;
          next-action selection; the deduplicated Historic confirmation queue.

   Does NOT own, and must never re-derive:
     what Canon is                    the authority kernel, through
                                      currentHumanAuthority() / historicSelection()
     which state a shot declares      resolveDeclaredStateId() (the binding contract)
     whether a state exists on an     stateIdBelongsToEntity(), owner-scoped —
       entity                         there is no global state lookup and must
                                      never be one
     which file an approval resolves  resolveApprovalMedia(), identity-first
       to
     which entities a shot needs      shotDependencyRecords()
     which tokens are ambiguous       lossyShotCodeTokens()
     who is absent from a frame       absentEntityIdsForFrame()
     is a presence record readable    framePresenceRecordStatus()
     who owns a file                  resolveMediaOwnership()
     which methods exist              resolveTaskModes()

   A NEGATIVE CONTROL BREAKS THE "CALL THE KERNEL, NEVER READ AN EDGE" LINE AND
   REQUIRES A FAILURE. If this module ever reads `entity.approvedFile`,
   `frame.winner` or `shot.winner` to decide satisfaction, it has become a second
   place authority is decided, and the whole receipt model is back to being
   assumable.

   ---------------------------------------------------------------------------
   IT MUST NEVER READ BYTES.

   media-asset-verify.js is "the only code that reads media bytes" and states the
   rule directly: a project may sit in OneDrive/Dropbox/Drive, where reading a file
   DOWNLOADS it, so hashing is "a deliberate act with a visible cost, never a side
   effect". Readiness runs on every render.

   So there is no `fs` here, no `require` of a hasher, and no existence test of its
   own. Media usability is answered from a LISTING the caller supplies, through the
   canonical resolver, and the answer states which oracle was used:

     mediaListing(list, entityId) / shotMediaListing(shotId)
                        resolveApprovalMedia() decides. A file renamed since the
                        approval still resolves, because identity beats filename.
                        mediaCheck: "resolveApprovalMedia"
     fileExists(name)   degraded filename-only fallback. CANNOT see a rename.
                        mediaCheck: "file-name-only"
     neither            NOTHING IS KNOWN, and nothing is assumed. The requirement
                        becomes `media-availability-unknown` — a decision, not a
                        satisfaction — so the unit cannot be executable on an
                        approval whose bytes nobody has looked for.
                        mediaCheck: "not-checked"

   UNKNOWN STAYS UNKNOWN. An earlier version of this module rejected only
   `unavailable` and let every other answer fall through to satisfied, so a caller
   that supplied no oracle got a READY shot with `mediaCheck: "not-checked"` sitting
   beside it as the only hint. That is promoting unknown to READY: a field
   describing the evidence does not undo a claim made without it.

   Reporting `mediaCheck` is still not decoration — a surface must be able to say
   WHICH oracle answered — but it is no longer the only thing standing between an
   unchecked approval and an executable unit.

   ---------------------------------------------------------------------------
   THE BOUNDARY WITH generationBinding, AND IT IS ABSOLUTE.

   This module answers CAN THIS BE PRODUCED NOW. It does not answer WAS THAT
   ALREADY-MADE FRAME PRODUCED AGAINST AUTHORITY THAT HAS SINCE CHANGED. That is
   historical drift, it is owned by generationBinding, and it is not this pass.

   Readiness therefore NEVER READS A JOB RECORD. A revoked authority makes the shot
   NEEDS_DECISION for its NEXT production and says nothing whatsoever about any
   frame already generated from it — and it must not, because `recorded: false` on
   a pre-baseline job means UNKNOWN-NO-RECORD, never "no references were used".

   ---------------------------------------------------------------------------
   WHAT READINESS DELIBERATELY DOES NOT CHECK.

     ENVIRONMENT. Whether fal is enabled, whether an adapter is dispatchable,
     whether an assistant is reachable. Those are facts about THIS MACHINE RIGHT
     NOW, not about the production. A shot is production-READY and
     environment-blocked, and collapsing the two means a project looks unready
     because an API key expired. shared-generation-options.js already keeps
     CAPABILITY-COMPATIBLE, CONNECTED and DISPATCHABLE apart for the same reason.
     A surface reports them as a SEPARATE AXIS.

     COVERAGE COMPLETENESS. A required coverage slot is an ENTITY completeness
     fact, not a shot prerequisite. Slots are References and never Canon
     (shared-entity-slots.js); a shot needs the entity's STATE authority, not its
     turnaround.

     LIP SYNC ROUTING. `CINEBRAID_LIP_SYNC_LEVELS` distinguishes `implied`
     (unknown) from `critical` (a human requirement), and lip sync adds NO
     reference requirement — a speaking character needs the same identity
     authority either way. What `critical` would do is CONSTRAIN THE ADMISSIBLE
     METHOD SET, and doing that needs a lip-sync capability flag that
     CINEBRAID_CAPABILITY_FLAGS does not have (`nativeAudio` is not known to be the
     right proxy). Narrowing on a guess would be a method table returning by the
     back door. So `critical` is reported as a STATED CONSTRAINT on the unit and
     the method set is left unnarrowed.

   Deliberately absent, and required to stay absent:
     - file or network I/O, and any byte read
     - provider, adapter or model awareness
     - Date.now(), new Date(), Math.random()
     - any mutation of the project, shot, frame or entity passed in
     - any persisted result. A surface that caches this has created the second
       workflow truth. It costs a fraction of a millisecond per shot; there is no
       excuse.
     - UI wording. Every value below is a TOKEN. `message` fields are English
       because a next action without a sentence is not actionable, but a surface
       may rewrite them and must key its own logic off the tokens. */

(function (root, factory) {
  const nodeModule = typeof module !== "undefined" && module.exports;
  /* Loaded exactly the way public/shared-production-media.js loads its siblings:
     required in Node, read off the one shared browser scope otherwise. Every one
     of these is a HARD dependency — this module has no fallback reasoning for a
     missing owner, because a fallback would be a second answer to a question that
     already has one. */
  const authority = nodeModule ? require("./shared-production-authority.js") : root;
  const kernel = nodeModule
    ? require("./shared-authority-kernel.js")
    : (root && root.CineBraidAuthorityKernel ? root.CineBraidAuthorityKernel : null);
  const disposition = nodeModule ? require("./shared-media-disposition.js") : root;
  const entities = nodeModule ? require("./shared-entities.js") : root;
  const continuity = nodeModule ? require("./shared-continuity.js") : root;
  const binding = nodeModule ? require("./shared-continuity-binding.js") : root;
  const presence = nodeModule ? require("./shared-frame-presence.js") : root;
  const ownership = nodeModule ? require("./shared-entity-ownership.js") : root;
  const options = nodeModule ? require("./shared-generation-options.js") : root;
  const lipSync = nodeModule ? require("./shared-lip-sync.js") : root;
  const route = nodeModule ? require("./shared-shot-route.js") : root;
  const api = factory({ authority, kernel, disposition, entities, continuity, binding, presence, ownership, options, lipSync, route });
  if (nodeModule) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function (OWNERS) {
  const AUTHORITY = OWNERS.authority;
  const KERNEL = OWNERS.kernel;
  const DISPOSITION = OWNERS.disposition;
  const ENTITIES = OWNERS.entities;
  const CONTINUITY = OWNERS.continuity;
  const BINDING = OWNERS.binding;
  const PRESENCE = OWNERS.presence;
  const OWNERSHIP = OWNERS.ownership;
  const OPTIONS = OWNERS.options;
  const LIP_SYNC = OWNERS.lipSync;
  const ROUTE = OWNERS.route;

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }
  function text(value) {
    return String(value == null ? "" : value).trim();
  }
  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  /* ==========================================================================
     THE VOCABULARY. Every one of these is a closed set, and a surface switches on
     the token rather than matching a sentence. */

  const SHOT_READINESS_CONTRACT = "cinebraid.shot-readiness/1";

  /* Three, and no fourth on a unit. */
  const SHOT_READINESS_STATUSES = deepFreeze(["READY", "BLOCKED", "NEEDS_DECISION"]);

  /* The rollup adds the existing done semantics, and only there. */
  const SHOT_ROLLUP_STATUSES = deepFreeze([...SHOT_READINESS_STATUSES, "COMPLETE"]);

  const READINESS_REQUIREMENT_STATES = deepFreeze(["satisfied", "missing", "needs-decision", "optional", "waived"]);

  /* WHY CineBraid believes an input is required. `inferred` is a statement about
     DISCOVERY ORDER, not about confidence — shotDependencyRecords() sets it when a
     dependency was first seen through a token pattern or a state-selection key
     rather than an authored field, which means adding a continuity selection to a
     shot can flip an authored dependency to `inferred` while nothing about the
     authoring changed. A surface must NOT present it as "CineBraid guessed this". */
  const READINESS_REQUIREMENT_BASES = deepFreeze(["authored", "inferred", "derived", "declared-absent"]);

  /* BLOCKED reasons. `producible` says whether CineBraid could make the thing;
     the one that cannot is the one whose next action reads SUPPLY, never PREPARE. */
  const READINESS_BLOCKED_REASONS = deepFreeze([
    "no-approved-reference",
    "required-frame-not-approved",
    "parent-frame-not-approved",
    "approved-bytes-missing",
  ]);

  /* NEEDS_DECISION reasons, each with a one-line answer to "why must a machine not
     decide this". */
  const READINESS_DECISION_REASONS = deepFreeze([
    /* media exists that nobody approved. Confirming it is a production decision. */
    "historic-selection-unconfirmed",
    /* a person withdrew this approval and the pointer survived. Re-approving is theirs. */
    "authority-revoked-pointer-remains",
    /* the shot names an entity that is not in the project. Relink vs remove changes the film. */
    "unresolved-relationship",
    /* a token matches more than one entity. Filename/prefix specificity is exactly
       the reasoning that must not settle it. */
    "code-ambiguous",
    /* the token names no known entity at all. */
    "code-names-nothing",
    /* the shot asked for a state the entity does not have. The runtime resolver
       falls back to the default so a renderer has something to draw; readiness must
       NOT, or it reproduces the state-substitution defect one layer up. */
    "declared-state-not-on-entity",
    /* CineBraid cannot tell who this frame excludes. */
    "presence-declaration-malformed",
    /* two references durably claim the same bytes. */
    "contested-media-ownership",
    /* THE APPROVAL IS INTACT AND WHETHER ITS BYTES ARE THERE IS NOT KNOWN.
       Distinct from `approved-bytes-missing`, which is the answer when a listing
       was consulted and the file was not in it. Here nothing was consulted, so
       CineBraid has no answer — and the one thing it must not do is supply one.
       See the UNKNOWN STAYS UNKNOWN note on productionInputSatisfaction. */
    "media-availability-unknown",
    /* project-level, reported ONCE at the top and never as N missing references. */
    "authority-ledger-unreadable",
    /* SLICE 1 ADDITION, and stated as one rather than smuggled in. The research's
       fixtures all declared at least one keyframe. A shot that declares no frames,
       no clips and no motion intent has no producible unit at all, and none of the
       reasons above describes it. It is a DECISION because only a person can say
       what this shot produces — the same gap shared-stage-model.js already declares
       as SHOT_STAGE_LIMITATIONS["no-not-applicable"], surfaced here instead of
       being guessed at. */
    "no-producible-unit-declared",
  ]);

  /* A method is never `unsupported` here. Environment is a separate axis (see the
     header), so the ONLY reason a method is contraindicated by readiness is that an
     input it needs is absent — which is a fact about the production and is fixable
     by producing that input. A test asserts the token `unsupported` never appears. */
  const READINESS_CONTRAINDICATION_REASONS = deepFreeze(["missing-prerequisite"]);

  const READINESS_MEDIA_CHECKS = deepFreeze(["resolveApprovalMedia", "file-name-only", "not-checked"]);

  const READINESS_UNIT_KINDS = deepFreeze(["frame", "motion"]);

  /* Decisions first, then inputs that must be supplied, then inputs CineBraid can
     prepare, then the work itself. */
  const READINESS_NEXT_ACTIONS = deepFreeze([
    /* PROJECT-LEVEL ONLY. One corrupt ledger is one repair, however many shots it
       makes unanswerable, so no shot ever carries this code. */
    "repair-authority-ledger",
    /* What a shot says instead, so a surface can show the shot as unanswerable
       without turning one project failure into N identical human actions. */
    "awaiting-project-repair",
    "establish-media-availability",
    "confirm-existing-reference",
    "reapprove-revoked-reference",
    "resolve-relationship",
    "resolve-state-declaration",
    "repair-presence-declaration",
    "resolve-media-ownership",
    "declare-producible-unit",
    "supply-approved-media",
    "prepare-references",
    "approve-parent-frame",
    "approve-required-frames",
    "produce-frame",
    "produce-motion",
    "nothing-outstanding",
  ]);

  /* What this model cannot answer, declared rather than guessed — the shape
     shared-stage-model.js's SHOT_STAGE_LIMITATIONS and shared-production-media.js's
     PRODUCTION_MEDIA_UNAVAILABLE both use. A declared gap cannot be quietly filled
     with a plausible answer, and a test requires each to stay declared. */
  const SHOT_READINESS_UNAVAILABLE = deepFreeze({
    "audio-entity-authority": {
      question: "Is the audio entity this shot names approved?",
      why: "The authority kernel's target kinds are shot-frame, shot-motion, shot-delivery and entity-state over characters/locations/props/vehicles. An audio entity has no authority target, so there is nothing to ask for a receipt about. Unresolved audio relationships ARE reported.",
      wouldNeed: "an authority target kind covering audio entities",
    },
    "lip-sync-method-narrowing": {
      question: "Which methods can satisfy a lip-sync-critical shot?",
      why: "Lip sync constrains the method set rather than the input set, and CINEBRAID_CAPABILITY_FLAGS has no lip-sync member. `nativeAudio` is not established as the right proxy, and narrowing on a guess would be a sparse method table by the back door.",
      wouldNeed: "a lip-sync capability flag on the model/backend capability layers",
    },
    "environment-readiness": {
      question: "Can this machine actually dispatch the admissible method right now?",
      why: "Deliberately a separate axis. Dispatchability and connection are facts about this installation, not about the production, and folding them in makes a project look unready because a key expired.",
      wouldNeed: "nothing — the caller asks shared-generation-options.js and reports it beside this answer",
    },
    "historical-drift": {
      question: "Was an already-generated frame produced against authority that has since changed?",
      why: "Owned by generationBinding and explicitly out of scope. Readiness never reads a job record.",
      wouldNeed: "a separate feature with a separate name",
    },
  });

  const SHOT_READINESS_UNAVAILABLE_KEYS = deepFreeze(Object.keys(SHOT_READINESS_UNAVAILABLE));

  /* ==========================================================================
     THE OWNERS, ASKED BY NAME.

     Each accessor exists so a missing owner is a loud, single failure rather than a
     quiet wrong answer scattered across the derivation. */

  function requireOwner(value, name, from) {
    if (typeof value !== "function") {
      throw new Error(`shared-shot-readiness.js needs ${name}() from ${from}; load that module first`);
    }
    return value;
  }
  const currentHumanAuthority = requireOwner(AUTHORITY && AUTHORITY.currentHumanAuthority, "currentHumanAuthority", "shared-production-authority.js");
  const historicSelection = requireOwner(AUTHORITY && AUTHORITY.historicSelection, "historicSelection", "shared-production-authority.js");
  const authorityTargetOf = requireOwner(AUTHORITY && AUTHORITY.authorityTarget, "authorityTarget", "shared-production-authority.js");
  const validateAuthorityLedger = requireOwner(KERNEL && KERNEL.validateAuthorityLedger, "validateAuthorityLedger", "shared-authority-kernel.js");
  const resolveApprovalMediaOwner = requireOwner(DISPOSITION && DISPOSITION.resolveApprovalMedia, "resolveApprovalMedia", "shared-media-disposition.js");
  const shotDependencyRecordsOwner = requireOwner(ENTITIES && ENTITIES.shotDependencyRecords, "shotDependencyRecords", "shared-entities.js");
  const lossyShotCodeTokensOwner = requireOwner(ENTITIES && ENTITIES.lossyShotCodeTokens, "lossyShotCodeTokens", "shared-entities.js");
  const resolveDeclaredStateIdOwner = requireOwner(CONTINUITY && CONTINUITY.resolveDeclaredStateId, "resolveDeclaredStateId", "shared-continuity.js");
  const resolveStateRecordOwner = requireOwner(CONTINUITY && CONTINUITY.resolveStateRecord, "resolveStateRecord", "shared-continuity.js");
  const stateIdBelongsToEntityOwner = requireOwner(BINDING && BINDING.stateIdBelongsToEntity, "stateIdBelongsToEntity", "shared-continuity-binding.js");
  const framePresenceRecordStatusOwner = requireOwner(PRESENCE && PRESENCE.framePresenceRecordStatus, "framePresenceRecordStatus", "shared-frame-presence.js");
  const absentEntityIdsForFrameOwner = requireOwner(PRESENCE && PRESENCE.absentEntityIdsForFrame, "absentEntityIdsForFrame", "shared-frame-presence.js");
  const buildEntityOwnerIndexOwner = requireOwner(OWNERSHIP && OWNERSHIP.buildEntityOwnerIndex, "buildEntityOwnerIndex", "shared-entity-ownership.js");
  const resolveMediaOwnershipOwner = requireOwner(OWNERSHIP && OWNERSHIP.resolveMediaOwnership, "resolveMediaOwnership", "shared-entity-ownership.js");
  const resolveTaskModesOwner = requireOwner(OPTIONS && OPTIONS.resolveTaskModes, "resolveTaskModes", "shared-generation-options.js");
  const deriveLipSyncOwner = requireOwner(LIP_SYNC && LIP_SYNC.deriveLipSync, "deriveLipSync", "shared-lip-sync.js");
  const canonicalShotRouteOwner = requireOwner(ROUTE && ROUTE.canonicalShotRoute, "canonicalShotRoute", "shared-shot-route.js");
  const shotRouteGenerationModeOwner = requireOwner(ROUTE && ROUTE.shotRouteGenerationMode, "shotRouteGenerationMode", "shared-shot-route.js");
  const VISUAL_KINDS = list(CONTINUITY && CONTINUITY.VISUAL_ENTITY_KINDS).length
    ? list(CONTINUITY.VISUAL_ENTITY_KINDS)
    : ["character", "location", "prop", "vehicle"];
  const KIND_LISTS = record(CONTINUITY && CONTINUITY.ENTITY_KIND_LISTS);

  /* ==========================================================================
     METHOD TRUTH, DERIVED FROM THE SHIPPED RESOLVER RATHER THAN TABULATED.

     resolveTaskModes(task, inputs) is the Shot Execution machinery's own answer:
     four lines that derive the mode from what is ATTACHED. For "animate-shot" it
     returns exactly ONE mode — the operational answer — and that is correct for a
     dispatcher and wrong for a readiness surface, because a mode it did not name
     may still be genuinely reachable from a DIFFERENT valid subset of the same
     inputs. On the H3 adapter that difference is material: i2v/flf refuse every
     non-endpoint reference while r2v sends them.

     So the probe set below is not a method table and carries no ranking, no score
     and no preference. Each row is an INPUT SHAPE, and the mode is whatever the
     shipped resolver says that shape produces. Change the resolver and these change
     with it; nothing here restates its rule.

     `needs` is the shape's own role list, so an unreachable mode can name exactly
     which input is absent — which is the whole difference between
     `missing-prerequisite` and `unsupported`. */
  const ANIMATE_INPUT_SHAPES = [
    { needs: [] },
    { needs: ["reference"] },
    { needs: ["first-frame"] },
    { needs: ["first-frame", "last-frame"] },
  ];
  function shapeInputs(needs) {
    return { references: needs.map((role) => ({ role, mediaType: "image" })) };
  }
  const ANIMATE_METHOD_PROBES = deepFreeze(ANIMATE_INPUT_SHAPES.map((shape) => ({
    needs: [...shape.needs],
    method: text(list(resolveTaskModesOwner("animate-shot", shapeInputs(shape.needs)))[0]),
  })).filter((row) => row.method));

  /* The universe of animate-shot methods, as the shipped resolver defines it. */
  const ANIMATE_METHODS = deepFreeze([...new Set(ANIMATE_METHOD_PROBES.map((row) => row.method))]);


  /* THE DECLARED ROUTE'S REQUIRED INPUTS, derived here beside the method probes that
     establish them. Shot Intent presents this answer; readiness enforces it. Keeping
     both on this owner makes it impossible for the surface to say "no frames" while
     the production derivation silently applies another route's prerequisites. */
  const FRAME_INPUT_ROLES = deepFreeze(["first-frame", "last-frame"]);
  function shotRouteInputNeeds(value) {
    const route = canonicalShotRouteOwner(value);
    if (!route) return deepFreeze({ route: "", constrained: false, known: false, modes: [], needs: [], frameNeeds: [], framesRequired: false });
    const namedMode = shotRouteGenerationModeOwner(route);
    const modes = namedMode ? [namedMode] : [...ANIMATE_METHODS];
    const probes = modes.map((mode) => ANIMATE_METHOD_PROBES.find((row) => row.method === mode) || null);
    if (probes.some((row) => !row))
      return deepFreeze({ route, constrained: true, known: false, modes: deepFreeze(modes), needs: [], frameNeeds: [], framesRequired: false });
    const needs = [...new Set(probes.flatMap((row) => row.needs))];
    const frameNeeds = needs.filter((role) => FRAME_INPUT_ROLES.includes(role));
    return deepFreeze({
      route,
      constrained: true,
      known: true,
      modes: deepFreeze(modes),
      needs: deepFreeze(needs),
      frameNeeds: deepFreeze(frameNeeds),
      framesRequired: frameNeeds.length > 0,
    });
  }
  const METHOD_INPUT_LABELS = deepFreeze({
    "first-frame": "an approved opening frame",
    "last-frame": "an approved closing frame",
    reference: "at least one approved reference",
  });

  /* ==========================================================================
     THE ONE SATISFACTION PREDICATE.

     CURRENT SOURCE ANSWERS THIS QUESTION IN SEVERAL INCOMPATIBLE WAYS, and Slice 1
     exists to make it single rather than to add another. Both halves are composed
     here and nowhere else:

       half one — is it approved?   THE RECEIPT. currentHumanAuthority(). Never a
                                    pointer, never a winner, never approvedFile.
       half two — does the approval  resolveApprovalMedia(), identity-first, over a
                  resolve to usable   listing the caller supplies. Never a byte read.
                  media?

     The composition already existed, unnamed, at exactly one call site —
     coverage-automation.js primaryReference() pairs the receipt with
     resolveApprovalMedia() and refuses when it cannot resolve, at the coverage
     dispatch boundary. This is that behaviour, named, and reused rather than
     reinvented.

     Returns a REQUIREMENT ROW. It decides nothing about the shot. */
  function productionInputSatisfaction(project, request, oracle = {}) {
    const it = record(request);
    const target = it.target ? authorityTargetOf(it.target) : null;
    const base = {
      id: text(it.id),
      kind: text(it.kind),
      label: text(it.label),
      basis: READINESS_REQUIREMENT_BASES.includes(text(it.basis)) ? text(it.basis) : "authored",
      target: target ? { ...target } : null,
      targetKey: target ? text(target.key) : "",
      required: it.required !== false,
      producible: true,
      value: "",
      assetId: "",
      satisfiedBy: "",
      mediaCheck: "not-checked",
      reason: "",
      detail: "",
    };
    if (!target) {
      /* A requirement with no complete target is not a requirement this module may
         answer. It is only ever produced deliberately — an unresolved relationship
         is reported as its own decision row, not as a satisfaction failure. */
      return deepFreeze({ ...base, state: "needs-decision", reason: "unresolved-relationship", producible: false });
    }

    const receipt = currentHumanAuthority(project, target);
    if (receipt) {
      const value = text(receipt.value);
      const assetId = text(receipt.assetId);
      const media = resolveMediaFor(target, { file: value, assetId }, oracle);
      if (media.state === "unavailable") {
        /* THE HUMAN DECISION IS INTACT. The receipt is valid, the live edge matches
           it, nothing was withdrawn, and the kernel still returns it — it does no
           I/O by design, so Canon is unaffected by a filesystem fact. What is absent
           is BYTES.

           That makes it BLOCKED, not NEEDS_DECISION: the BLOCKED test is "CineBraid
           can name exactly what would satisfy it", and it can — THAT FILE. There is
           no ambiguity of the kind every decision reason carries. And it is
           `producible: false`, because generation cannot restore a specific approved
           image; a new image would be a DIFFERENT image needing a new approval. The
           next action therefore reads SUPPLY and never PREPARE. */
        return deepFreeze({
          ...base,
          state: "missing",
          reason: "approved-bytes-missing",
          producible: false,
          value,
          assetId,
          satisfiedBy: text(receipt.id),
          mediaCheck: media.mediaCheck,
          detail: value,
        });
      }
      /* UNKNOWN STAYS UNKNOWN — THE CORRECTION THE ACCEPTANCE AUDIT REQUIRED.
       *
       * This used to reject only `unavailable` and let every other answer fall
       * through to satisfied. So a caller that supplied no media oracle got
       * `satisfied` and a READY shot for an approval whose bytes nobody had
       * looked for, with `mediaCheck: "not-checked"` sitting beside it as the
       * only hint. The audit called that promoting unknown to READY, and it was
       * right: a field describing the evidence does not undo a claim made
       * without it.
       *
       * IT IS A DECISION, NOT A BLOCKER, and the distinction is exact. BLOCKED
       * means CineBraid can name what would satisfy the requirement; here it
       * cannot name anything, because it does not know whether anything is
       * wrong. What it knows is that establishing the fact COSTS SOMETHING —
       * media-asset-verify.js is explicit that reading bytes is "a deliberate
       * act with a visible cost, never a side effect", since a cloud-backed
       * project downloads the file. A cost a person must authorise is a
       * decision, and that is the honest bucket.
       *
       * The receipt is still cited: the human decision is intact and is not
       * what is in doubt. `producible: false`, because generating something new
       * does not answer a question about existing bytes. */
      if (media.state !== "available") {
        return deepFreeze({
          ...base,
          state: "needs-decision",
          reason: "media-availability-unknown",
          producible: false,
          value,
          assetId,
          satisfiedBy: text(receipt.id),
          mediaCheck: media.mediaCheck,
          detail: value,
        });
      }
      return deepFreeze({
        ...base,
        state: "satisfied",
        value,
        assetId,
        satisfiedBy: text(receipt.id),
        mediaCheck: media.mediaCheck,
      });
    }

    /* HISTORIC IS ITS OWN OUTCOME, and that is the load-bearing choice.

       Rounding it UP to satisfied lets automation execute against media nobody
       approved — the invariant the whole authority kernel exists to protect.
       Rounding it DOWN to missing tells a filmmaker to generate a reference they
       are already looking at, and spends money replacing work that is fine. */
    const past = historicSelection(project, target);
    if (past) {
      const revoked = text(past.basis) === "authority-revoked";
      return deepFreeze({
        ...base,
        state: "needs-decision",
        reason: revoked ? "authority-revoked-pointer-remains" : "historic-selection-unconfirmed",
        producible: false,
        value: text(past.value),
        assetId: text(past.assetId),
        detail: text(past.basis),
      });
    }

    return deepFreeze({
      ...base,
      state: "missing",
      reason: text(it.missingReason) || "no-approved-reference",
      producible: it.producible !== false,
    });
  }

  /* THE MEDIA HALF, and the only place an oracle is consulted.

     `state` is `available` / `unavailable` / `unknown`. `unknown` is a real answer
     and the honest one when no oracle was supplied — it must never be rounded to
     available, and it must never cause a byte read to settle it. */
  function resolveMediaFor(target, edge, oracle) {
    const it = record(oracle);
    const file = text(record(edge).file);
    if (!file) return { state: "unknown", mediaCheck: "not-checked" };
    const listing = mediaListingFor(target, it);
    if (listing) {
      const resolved = resolveApprovalMediaOwner({ file, assetId: text(record(edge).assetId) }, listing);
      return { state: resolved ? "available" : "unavailable", mediaCheck: "resolveApprovalMedia", media: resolved || null };
    }
    if (typeof it.fileExists === "function") {
      /* DEGRADED, AND SAID SO. A filename test cannot see a rename, so an approval
         whose file was legitimately renamed reads as unavailable here while the
         listing oracle resolves it correctly. */
      return { state: it.fileExists(file) ? "available" : "unavailable", mediaCheck: "file-name-only" };
    }
    return { state: "unknown", mediaCheck: "not-checked" };
  }

  function mediaListingFor(target, oracle) {
    const it = record(target);
    if (it.kind === "entity-state" && typeof oracle.mediaListing === "function") {
      return list(oracle.mediaListing(text(it.list), text(it.entityId)));
    }
    if ((it.kind === "shot-frame" || it.kind === "shot-motion" || it.kind === "shot-delivery")
      && typeof oracle.shotMediaListing === "function") {
      return list(oracle.shotMediaListing(text(it.shotId)));
    }
    return null;
  }

  /* ==========================================================================
     WHICH ENTITIES THIS UNIT NEEDS, AND IN WHICH STATE. */

  function entityRequirementsFor(project, shot, frameId, context) {
    const rows = [];
    const absent = new Set(list(absentEntityIdsForFrameOwner(shot, frameId)).map(text));
    for (const dependency of context.dependencies) {
      const type = text(dependency.type);
      if (!VISUAL_KINDS.includes(type)) continue;
      const entityId = text(dependency.id);
      if (!dependency.resolved || !dependency.entity) continue;
      const listName = text(KIND_LISTS[type]);
      if (!listName) continue;
      const entity = dependency.entity;
      const basis = dependency.inferred ? "inferred" : "authored";
      const label = `${text(entity.name) || entityId}`;

      /* PRESENCE AND REFERENCE ATTACHMENT ARE DIFFERENT FACTS. An entity this frame
         explicitly declares absent is WAIVED for this frame — it is not missing, and
         demanding its approval would block a frame the filmmaker deliberately wrote
         it out of. */
      if (absent.has(entityId)) {
        rows.push(deepFreeze({
          id: `entity-state:${listName}:${entityId}`,
          kind: "entity-state",
          label,
          basis: "declared-absent",
          state: "waived",
          reason: "",
          detail: "declared absent in this frame",
          required: false,
          producible: false,
          target: null,
          targetKey: "",
          value: "",
          assetId: "",
          satisfiedBy: "",
          mediaCheck: "not-checked",
        }));
        continue;
      }

      const declaredId = text(resolveDeclaredStateIdOwner(shot, frameId, type, entityId));
      /* OWNER-SCOPED, AND THERE IS NO GLOBAL LOOKUP. Twelve entities in the real
         corpus all declare `state-default`, so "does this state exist" is only ever
         a question about THIS entity's own catalogue. */
      if (declaredId && !stateIdBelongsToEntityOwner(list(entity.continuityStates), declaredId)) {
        rows.push(deepFreeze({
          id: `entity-state:${listName}:${entityId}`,
          kind: "entity-state",
          label,
          basis,
          state: "needs-decision",
          reason: "declared-state-not-on-entity",
          detail: declaredId,
          required: true,
          producible: false,
          target: null,
          targetKey: "",
          value: "",
          assetId: "",
          satisfiedBy: "",
          mediaCheck: "not-checked",
        }));
        continue;
      }

      const stateId = declaredId || text(record(resolveStateRecordOwner(entity, "")).id) || "state-default";
      const stateName = text(record(resolveStateRecordOwner(entity, stateId)).name) || "Default";
      const row = productionInputSatisfaction(
        project,
        {
          id: `entity-state:${listName}:${entityId}#${stateId}`,
          kind: "entity-state",
          label: `${label} — ${stateName}`,
          basis: declaredId ? basis : (basis === "inferred" ? "inferred" : "authored"),
          target: { kind: "entity-state", list: listName, entityId, stateId },
          missingReason: "no-approved-reference",
        },
        context.oracle,
      );
      /* A CONTEST HAS NO OWNER, and confirming or approving contested bytes is a
         decision. Asked only where there is a value to contest. */
      const contested = contestedClaimFor(project, listName, row.value || row.detail, context);
      rows.push(contested
        ? deepFreeze({ ...row, state: "needs-decision", reason: "contested-media-ownership", producible: false, detail: contested.claimants.join(", ") })
        : row);
    }
    return rows;
  }

  function contestedClaimFor(project, listName, fileName, context) {
    const name = text(fileName);
    if (!name || !listName) return null;
    let index = context.ownerIndexes[listName];
    if (index === undefined) {
      index = buildEntityOwnerIndexOwner(project, listName);
      context.ownerIndexes[listName] = index;
    }
    const resolution = record(resolveMediaOwnershipOwner(index, name));
    return resolution.contested === true ? { claimants: list(resolution.claimants).map(text) } : null;
  }

  /* ==========================================================================
     RELATIONSHIP TRUTH — reported once per shot, not once per unit.

     An unresolved entity or an ambiguous code is a fact about the SHOT's inputs.
     Attaching it to every unit would report the same decision three times and make
     a two-frame shot look twice as broken as a one-frame shot. */
  function relationshipRequirements(project, shot, context) {
    const rows = [];
    for (const dependency of context.dependencies) {
      if (dependency.resolved) continue;
      rows.push(deepFreeze({
        id: `relationship:${text(dependency.type)}:${text(dependency.id)}`,
        kind: "relationship",
        label: `${text(dependency.type)} ${text(dependency.id)}`,
        basis: dependency.inferred ? "inferred" : "authored",
        state: "needs-decision",
        reason: "unresolved-relationship",
        detail: list(dependency.sources).map(text).join(", "),
        required: true,
        producible: false,
        target: null,
        targetKey: "",
        value: "",
        assetId: "",
        satisfiedBy: "",
        mediaCheck: "not-checked",
      }));
    }
    const reported = new Set(rows.map((row) => text(row.label).split(" ").pop()));
    for (const code of list(lossyShotCodeTokensOwner(project, shot))) {
      const status = text(code.status);
      /* `reinterpreted` is deliberately NOT a readiness decision. It is a real loss
         and the existing project-readiness issue list already reports it, but the
         token DOES resolve to exactly one entity, so the requirement it produces is
         answerable and the shot is not waiting on a person for it. */
      if (status !== "ambiguous" && status !== "unresolved") continue;
      if (status === "unresolved" && reported.has(text(code.token))) continue;
      rows.push(deepFreeze({
        id: `code:${text(code.token)}`,
        kind: "relationship",
        label: text(code.token),
        basis: "inferred",
        state: "needs-decision",
        reason: status === "ambiguous" ? "code-ambiguous" : "code-names-nothing",
        detail: status === "ambiguous" ? list(code.matches).map((match) => text(record(match).id)).join(", ") : "",
        required: true,
        producible: false,
        target: null,
        targetKey: "",
        value: "",
        assetId: "",
        satisfiedBy: "",
        mediaCheck: "not-checked",
      }));
    }
    return rows;
  }

  /* ==========================================================================
     PRODUCIBLE UNITS — derived ONLY from what the shot actually declares.

     Nothing is manufactured. No closing frame for a one-frame shot, and no motion
     unit for a still shot: inventing either would make readiness report work the
     filmmaker never asked for.

     THE `deliveryIntent` DIALECTS. Current source writes this field from two
     places with two spellings — the composer and public/app.js write "motion",
     shared-authority-kernel.js writes "video" when a delivery approval lands — so
     both are read here. A reader that knew only one would silently drop the motion
     unit of every shot the other writer touched. */
  const MOTION_INTENTS = deepFreeze(["motion", "video"]);

  function declaredUnits(shot) {
    const s = record(shot);
    const creation = record(s.creationBrief);
    const routeNeeds = shotRouteInputNeeds(s.deliveryRoute);
    const units = [];
    const frames = list(s.keyframes).map(record).filter((frame) => text(frame.id));
    frames.forEach((frame, index) => {
      const isFirst = index === 0;
      const isLast = frames.length > 1 && index === frames.length - 1;
      const routeRequired = (isFirst && routeNeeds.needs.includes("first-frame"))
        || (isLast && routeNeeds.needs.includes("last-frame"));
      units.push({
        id: `frame:${text(frame.id)}`,
        kind: "frame",
        label: `Frame ${text(frame.label) || String(index + 1)}`,
        frame,
        frameId: text(frame.id),
        index,
        /* A declared route governs which endpoint units are required without editing
           or deleting the stored frames. With no route, the legacy authored flag keeps
           its exact meaning. */
        required: routeNeeds.known ? routeRequired : frame.required !== false,
        target: { kind: "shot-frame", shotId: text(s.id), frameId: text(frame.id) },
      });
    });
    const clips = list(s.clips).map(record).filter((clip) => text(clip.id));
    for (const clip of clips) {
      units.push({
        id: `motion:${text(clip.id)}`,
        kind: "motion",
        label: `Motion ${text(clip.suffix) || text(clip.id)}`,
        clip,
        required: true,
        target: { kind: "shot-motion", shotId: text(s.id), unitKey: text(clip.id) },
      });
    }
    if (!clips.length && (MOTION_INTENTS.includes(text(creation.deliveryIntent)) || routeNeeds.known)) {
      units.push({
        id: "motion:shot",
        kind: "motion",
        label: "Motion",
        clip: null,
        required: true,
        target: { kind: "shot-motion", shotId: text(s.id), unitKey: "shot" },
      });
    }
    return units;
  }

  /* ==========================================================================
     ONE UNIT. */

  function evaluateUnit(project, shot, unit, context) {
    const requirements = [];
    const frames = context.units.filter((row) => row.kind === "frame");

    if (unit.kind === "frame") {
      /* A DECLARATION CINEBRAID CANNOT READ IS STILL A DECLARATION, and reading it
         as silence is the failure mode the final dispatch gate was repaired for.
         Readiness surfaces it earlier rather than duplicating that gate. */
      const status = record(framePresenceRecordStatusOwner(shot, unit.frameId));
      if (status.malformed === true) {
        requirements.push(deepFreeze({
          id: `presence:${unit.frameId}`,
          kind: "presence",
          label: unit.label,
          basis: "derived",
          state: "needs-decision",
          reason: "presence-declaration-malformed",
          detail: text(status.reason),
          required: true,
          producible: false,
          target: null,
          targetKey: "",
          value: "",
          assetId: "",
          satisfiedBy: "",
          mediaCheck: "not-checked",
        }));
      }
      requirements.push(...entityRequirementsFor(project, shot, unit.frameId, context));
      /* THE PARENT FRAME. A derived structural prerequisite, and only where the
         shot's own workflow says this frame continues from the previous one. */
      if (unit.index > 0) {
        const workflow = record(record(record(shot).creationBrief).frameWorkflows)[unit.frameId];
        if (record(workflow).usePreviousFrame !== false) {
          const previous = frames[unit.index - 1];
          if (previous) {
            requirements.push(productionInputSatisfaction(project, {
              id: `parent-frame:${previous.frameId}`,
              kind: "shot-frame",
              label: previous.label,
              basis: "derived",
              target: previous.target,
              missingReason: "parent-frame-not-approved",
            }, context.oracle));
          }
        }
      }
    } else {
      requirements.push(...entityRequirementsFor(project, shot, "", context));
      for (const frame of frames) {
        const row = productionInputSatisfaction(project, {
          id: `required-frame:${frame.frameId}`,
          kind: "shot-frame",
          label: frame.label,
          basis: "derived",
          target: frame.target,
          missingReason: "required-frame-not-approved",
        }, context.oracle);
        /* AN UNREQUIRED FRAME NEVER BLOCKS MOTION. It is reported as optional, and
           the method it would unlock is named — which is the difference between
           "optional" and "pointless". */
        requirements.push(frame.required || row.state === "satisfied"
          ? row
          : deepFreeze({ ...row, state: "optional", required: false, reason: "", unlocks: unlockedByFrame(frames, frame) }));
      }
      /* A route can require an endpoint before a corresponding frame record exists.
         The route declared the input, so readiness must represent the gap instead of
         falling back to a frameless method. No frame record is manufactured. */
      const presentRoles = new Set();
      if (frames.length) presentRoles.add("first-frame");
      if (frames.length > 1) presentRoles.add("last-frame");
      for (const role of context.routeNeeds.needs.filter((item) => item === "first-frame" || item === "last-frame")) {
        if (presentRoles.has(role)) continue;
        requirements.push(deepFreeze({
          id: `route-input:${role}`,
          kind: "shot-frame",
          label: role === "first-frame" ? "Opening frame" : "Closing frame",
          basis: "derived",
          state: "missing",
          reason: "required-frame-not-approved",
          detail: "",
          required: true,
          producible: true,
          target: null,
          targetKey: "",
          value: "",
          assetId: "",
          satisfiedBy: "",
          mediaCheck: "not-checked",
        }));
      }
      /* Reference-driven intent needs at least one canonical visual reference. Entity
         requirements name the real authority targets when present; this generic row is
         only the honest answer when the shot declares none at all. */
      if (context.routeNeeds.needs.includes("reference")
          && !requirements.some((row) => row.kind === "entity-state")) {
        requirements.push(deepFreeze({
          id: "route-input:reference",
          kind: "reference",
          label: "Approved motion reference",
          basis: "derived",
          state: "missing",
          reason: "no-approved-reference",
          detail: "",
          required: true,
          producible: true,
          target: null,
          targetKey: "",
          value: "",
          assetId: "",
          satisfiedBy: "",
          mediaCheck: "not-checked",
        }));
      }

    }
    const methods = unit.kind === "motion"
      ? animateMethods(requirements, frames, context.routeNeeds)
      : createFrameMethods(requirements);

    const counts = countRequirements(requirements);
    const status = counts.needsDecision ? "NEEDS_DECISION"
      : counts.missing ? "BLOCKED"
        : methods.admissible ? "READY" : "BLOCKED";
    const complete = !!currentHumanAuthority(project, unit.target);
    return deepFreeze({
      id: unit.id,
      kind: unit.kind,
      label: unit.label,
      required: unit.required,
      complete,
      existingAuthority: complete ? "canon" : "",
      status,
      requirements: deepFreeze(requirements),
      counts,
      admissible: methods.admissible,
      alsoAdmissible: deepFreeze(methods.alsoAdmissible),
      contraindicated: deepFreeze(methods.contraindicated),
      nextAction: unitNextAction(unit, requirements, status, methods),
    });
  }

  function unlockedByFrame(frames, frame) {
    /* Which method this optional frame would make reachable, asked of the shipped
       resolver rather than asserted: approving the first frame adds `first-frame`,
       approving the last adds `last-frame`. */
    const needs = frame.index === 0 ? ["first-frame"] : ["first-frame", "last-frame"];
    const probe = ANIMATE_METHOD_PROBES.find((row) => row.needs.length === needs.length && row.needs.every((role, index) => role === needs[index]));
    return probe ? probe.method : "";
  }

  function countRequirements(requirements) {
    const counts = { required: 0, satisfied: 0, missing: 0, needsDecision: 0, optional: 0, waived: 0 };
    for (const row of requirements) {
      if (row.state === "satisfied") { counts.required += 1; counts.satisfied += 1; continue; }
      if (row.state === "missing") { counts.required += 1; counts.missing += 1; continue; }
      if (row.state === "needs-decision") { counts.required += 1; counts.needsDecision += 1; continue; }
      if (row.state === "optional") { counts.optional += 1; continue; }
      counts.waived += 1;
    }
    return deepFreeze(counts);
  }

  /* WHAT THIS UNIT COULD BE MADE WITH, right now.

     `admissible` is the shipped resolver's own answer over what is ACTUALLY
     attached — the operational/default choice, and it is reported as exactly that.
     `alsoAdmissible` is every other mode the same resolver returns for a valid
     SUBSET of the same inputs. Naming them separately is the correction the
     research's Fixture F failure demands: a deterministic tie-break is not evidence
     that one method is uniquely superior, and hiding the alternatives would present
     it as though it were. */
  function animateMethods(requirements, frames, routeNeeds) {
    const satisfied = new Set(requirements.filter((row) => row.state === "satisfied").map((row) => row.id));
    const first = frames[0];
    const last = frames.length > 1 ? frames[frames.length - 1] : null;
    const have = new Set();
    if (first && satisfied.has(`required-frame:${first.frameId}`)) have.add("first-frame");
    if (last && satisfied.has(`required-frame:${last.frameId}`)) have.add("last-frame");
    if (requirements.some((row) => row.kind === "entity-state" && row.state === "satisfied")) have.add("reference");

    const references = [];
    if (have.has("first-frame")) references.push({ role: "first-frame", mediaType: "image" });
    if (have.has("last-frame")) references.push({ role: "last-frame", mediaType: "image" });
    if (have.has("reference")) references.push({ role: "reference", mediaType: "image" });
    const resolved = text(list(resolveTaskModesOwner("animate-shot", { references }))[0]);
    const considered = routeNeeds.known
      ? ANIMATE_METHOD_PROBES.filter((row) => routeNeeds.modes.includes(row.method))
      : ANIMATE_METHOD_PROBES;
    const reachable = considered.filter((row) => row.needs.every((role) => have.has(role)));
    /* A declared route narrows the operational answer; it never lets the resolver's
       frameless fallback bypass a missing route input. */
    const admissible = routeNeeds.known
      ? text((reachable.find((row) => row.method === resolved) || reachable[0] || {}).method)
      : resolved;
    const alsoAdmissible = [...new Set(reachable.map((row) => row.method))].filter((method) => method && method !== admissible);
    const contraindicated = considered
      .filter((row) => !row.needs.every((role) => have.has(role)))
      .map((row) => {
        const missing = row.needs.filter((role) => !have.has(role));
        return {
          method: row.method,
          /* NEVER `unsupported`. The input is absent; the method is not refused. */
          reason: "missing-prerequisite",
          missing: [...missing],
          message: `needs ${missing.map((role) => METHOD_INPUT_LABELS[role] || role).join(" and ")}`,
        };
      })
      .filter((row) => row.method && row.method !== admissible);
    return { admissible, alsoAdmissible, contraindicated };
  }

  function createFrameMethods(requirements) {
    const references = requirements
      .filter((row) => row.kind === "entity-state" && row.state === "satisfied")
      .map(() => ({ role: "reference", mediaType: "image" }));
    const modes = list(resolveTaskModesOwner("create-frame", { references })).map(text).filter(Boolean);
    return { admissible: modes[0] || "", alsoAdmissible: modes.slice(1), contraindicated: [] };
  }

  /* ==========================================================================
     THE NEXT USEFUL ACTION. Decisions first, because preparing a missing thing
     while a decision is outstanding is work performed against a target CineBraid
     cannot state. Then inputs that must be SUPPLIED, then inputs CineBraid can
     PREPARE, then the work itself. */
  const DECISION_ACTIONS = deepFreeze({
    "historic-selection-unconfirmed": "confirm-existing-reference",
    "authority-revoked-pointer-remains": "reapprove-revoked-reference",
    "unresolved-relationship": "resolve-relationship",
    "code-ambiguous": "resolve-relationship",
    "code-names-nothing": "resolve-relationship",
    "declared-state-not-on-entity": "resolve-state-declaration",
    "presence-declaration-malformed": "repair-presence-declaration",
    "contested-media-ownership": "resolve-media-ownership",
    "media-availability-unknown": "establish-media-availability",
  });

  function action(code, message, count = 0) {
    return deepFreeze({ code, message, count });
  }

  function unitNextAction(unit, requirements, status, methods) {
    const decisions = requirements.filter((row) => row.state === "needs-decision");
    if (decisions.length) {
      const first = decisions[0];
      const code = DECISION_ACTIONS[first.reason] || "resolve-relationship";
      const same = decisions.filter((row) => row.reason === first.reason);
      return action(code, decisionMessage(first, same.length), same.length);
    }
    const supply = requirements.filter((row) => row.state === "missing" && row.producible === false);
    if (supply.length) {
      return action(
        "supply-approved-media",
        supply.length === 1
          ? `Supply the approved file ${supply[0].detail || supply[0].label} — it is approved but the project no longer has it.`
          : `Supply ${supply.length} approved files the project no longer has.`,
        supply.length,
      );
    }
    const frameGaps = requirements.filter((row) => row.state === "missing" && row.kind === "shot-frame");
    if (frameGaps.length) {
      const parent = frameGaps.filter((row) => row.reason === "parent-frame-not-approved");
      if (parent.length) return action("approve-parent-frame", `Approve ${parent[0].label} first.`, parent.length);
      return action("approve-required-frames", `Approve ${frameGaps.length} required frame${frameGaps.length === 1 ? "" : "s"}.`, frameGaps.length);
    }
    const references = requirements.filter((row) => row.state === "missing");
    if (references.length) {
      return action("prepare-references", `Prepare ${references.length} required reference${references.length === 1 ? "" : "s"}.`, references.length);
    }
    if (status !== "READY") {
      return action("nothing-outstanding", "No execution method is admissible for this unit.", 0);
    }
    return unit.kind === "motion"
      ? action("produce-motion", `Produce ${unit.label}${methods.admissible ? ` using ${methods.admissible}` : ""}.`, 1)
      : action("produce-frame", `Produce ${unit.label}${methods.admissible ? ` using ${methods.admissible}` : ""}.`, 1);
  }

  function decisionMessage(row, count) {
    const more = count > 1 ? ` (${count} on this unit)` : "";
    if (row.reason === "historic-selection-unconfirmed") {
      return `${row.label} points at ${row.value || "existing media"}, which nobody has approved. Confirm it as the approved reference, or replace it.${more}`;
    }
    if (row.reason === "authority-revoked-pointer-remains") {
      return `${row.label} still points at ${row.value || "existing media"} after its approval was withdrawn. Approve it again, or replace it.${more}`;
    }
    if (row.reason === "declared-state-not-on-entity") {
      return `${row.label} asks for state ${row.detail}, which this entity does not have. Choose a state it does have, or add it.${more}`;
    }
    if (row.reason === "presence-declaration-malformed") {
      return `${row.label} has a frame-presence declaration CineBraid cannot read (${row.detail || "unrecognised value"}). Repair it before generating.${more}`;
    }
    if (row.reason === "contested-media-ownership") {
      return `${row.label} names media claimed by more than one reference (${row.detail}). Resolve the claim first.${more}`;
    }
    if (row.reason === "code-ambiguous") {
      return `${row.label} matches more than one entity (${row.detail}). Use the exact id.${more}`;
    }
    if (row.reason === "code-names-nothing") {
      return `${row.label} names no known entity. Relink or remove it.${more}`;
    }
    if (row.reason === "media-availability-unknown") {
      return `${row.label} is approved, but CineBraid has not been told whether ${row.value || "its file"} is still present. Checking reads the file, so it is not done automatically — check it to make this executable.${more}`;
    }
    return `${row.label} cannot be resolved without a decision.${more}`;
  }

  /* ==========================================================================
     ONE SHOT. */

  /* `projectTruth` is an INTERNAL pass-down, and evaluateProjectReadiness() is its
     only caller: the ledger is a whole-project read, so validating it once per feed
     rather than once per shot is the difference the research measured. It cannot
     change the answer — omit it and the same value is derived here. */
  function evaluateShotReadiness(project, shot, options = {}, projectTruth = undefined) {
    const P = record(project);
    const s = record(shot);
    const context = buildContext(P, s, options, projectTruth);
    if (context.truthProblem) {
      /* ONE CORRUPT LEDGER IS ONE REPAIR, NOT ONE PER SHOT.
       *
       * This used to return `repair-authority-ledger` here, so a three-shot
       * project produced three identical repair actions and the surface rendered
       * all three — the exact fan-out the acceptance audit reproduced, and the
       * lie of aggregation this branch exists to prevent, reappearing as
       * duplicated human work instead of as duplicated blockers.
       *
       * The shot still reports what is true of IT: its readiness cannot be
       * answered, and it carries the project problem so a surface can explain
       * why. The repair itself is the PROJECT's action, emitted once by
       * evaluateProjectReadiness(). */
      return deepFreeze({
        shotId: text(s.id),
        status: "NEEDS_DECISION",
        nextUnitId: "",
        nextAction: action("awaiting-project-repair", "This shot's readiness cannot be answered until the project's approval records are repaired.", 0),
        units: deepFreeze([]),
        requirements: deepFreeze([]),
        optionalOutstanding: deepFreeze([]),
        counts: countRequirements([]),
        constraints: deepFreeze([]),
        mediaCheck: context.mediaCheck,
        truthProblem: context.truthProblem,
      });
    }

    const relationships = relationshipRequirements(P, s, context);
    const units = context.units.map((unit) => evaluateUnit(P, s, unit, context));
    const outstanding = units.filter((unit) => !unit.complete && unit.required);
    const optionalOutstanding = units.filter((unit) => !unit.complete && !unit.required).map((unit) => unit.id);

    let status;
    let nextUnitId = "";
    let next;
    if (relationships.length) {
      /* A SHOT-LEVEL DECISION OUTRANKS EVERY UNIT. The shot names something
         CineBraid cannot resolve, so no unit of it can be planned truthfully. */
      status = "NEEDS_DECISION";
      const first = relationships[0];
      next = action(DECISION_ACTIONS[first.reason] || "resolve-relationship", decisionMessage(first, relationships.filter((row) => row.reason === first.reason).length), relationships.length);
    } else if (!units.length) {
      status = "NEEDS_DECISION";
      next = action("declare-producible-unit", "This shot declares no frame, no motion unit and no motion intent, so there is nothing to produce yet.", 0);
    } else if (!outstanding.length) {
      /* THE EXISTING DONE SEMANTICS, CARRIED THROUGH. Not a readiness state. */
      status = "COMPLETE";
      next = action("nothing-outstanding", "Every declared unit of this shot already holds approved authority.", 0);
    } else {
      const unit = outstanding[0];
      status = unit.status;
      nextUnitId = unit.id;
      next = unit.nextAction;
    }

    const all = [...relationships, ...units.flatMap((unit) => list(unit.requirements))];
    return deepFreeze({
      shotId: text(s.id),
      status,
      nextUnitId,
      nextAction: next,
      units: deepFreeze(units),
      requirements: deepFreeze(relationships),
      optionalOutstanding: deepFreeze(optionalOutstanding),
      counts: countRequirements(all),
      constraints: shotConstraints(s),
      mediaCheck: context.mediaCheck,
      truthProblem: null,
    });
  }

  /* STATED, NEVER ACTED ON — see SHOT_READINESS_UNAVAILABLE["lip-sync-method-narrowing"].

     Asked of shared-lip-sync.js rather than read off the field, because the level is
     a DERIVATION with a precedence order (`implied` is the unknown, `critical` is a
     human requirement, and a line's mere presence is never promoted to `critical`).
     Re-reading `audio.lipSync` here would be a second answer to a question that
     already has one, and would report `critical` for a shot whose only evidence is
     that somebody typed a line. */
  function shotConstraints(shot) {
    const out = [];
    if (text(deriveLipSyncOwner(record(record(shot).audio))) === "critical") out.push({ code: "lip-sync", value: "critical" });
    return deepFreeze(out);
  }

  /* THE ONE PROJECT-LEVEL TRUTH PROBLEM, DERIVED IN ONE PLACE.
   *
   * A ledger nobody can read makes every approval in the project unrecognisable.
   * Answering that as N missing references per shot would be a lie of aggregation —
   * it would send a filmmaker to prepare references that are already approved — and
   * answering it as N repair actions is the same mistake wearing the other hat: one
   * broken file becoming one job per shot.
   *
   * So it is derived HERE, once, and both the project feed and every shot read the
   * same frozen object. It used to be constructed in two places, which is how the
   * feed came to hoist one shot's copy while each shot also carried its own action. */
  function projectTruthProblem(project) {
    const ledger = record(validateAuthorityLedger(project));
    if (ledger.trusted !== false) return null;
    return deepFreeze({
      reason: "authority-ledger-unreadable",
      diagnostics: deepFreeze(list(ledger.diagnostics).map((row) => ({ ...record(row) }))),
      message: "This project's approval records cannot be read, so no approval in it can be recognised. Repair them before production continues.",
    });
  }

  function buildContext(project, shot, options, projectTruth) {
    const oracle = record(options);
    const mediaCheck = typeof oracle.mediaListing === "function"
      ? "resolveApprovalMedia"
      : typeof oracle.fileExists === "function" ? "file-name-only" : "not-checked";
    const routeNeeds = shotRouteInputNeeds(record(shot).deliveryRoute);
    return {
      oracle,
      mediaCheck,
      truthProblem: projectTruth === undefined ? projectTruthProblem(project) : projectTruth,
      dependencies: list(shotDependencyRecordsOwner(project, shot)),
      routeNeeds,
      units: declaredUnits(shot),
      ownerIndexes: {},
    };
  }

  /* ==========================================================================
     THE PROJECT FEED. */

  function evaluateProjectReadiness(project, options = {}) {
    const P = record(project);
    const ledger = record(validateAuthorityLedger(P));
    /* Derived once and handed down, so every shot cites the same problem and the
       ledger is validated once per feed rather than once per shot. */
    const truthProblem = projectTruthProblem(P);
    const shots = list(P.shots).map(record).filter((shot) => text(shot.id));
    const rows = shots.map((shot) => evaluateShotReadiness(P, shot, options, truthProblem));
    const counts = { total: rows.length, ready: 0, blocked: 0, needsDecision: 0, complete: 0 };
    for (const row of rows) {
      if (row.status === "READY") counts.ready += 1;
      else if (row.status === "BLOCKED") counts.blocked += 1;
      else if (row.status === "NEEDS_DECISION") counts.needsDecision += 1;
      else if (row.status === "COMPLETE") counts.complete += 1;
    }
    return deepFreeze({
      contract: SHOT_READINESS_CONTRACT,
      authority: deepFreeze({
        present: ledger.present === true,
        trusted: ledger.trusted !== false,
        receiptCount: list(ledger.receipts).length,
      }),
      truthProblem,
      /* THE PROJECT'S OWN ACTION, AND THE ONLY PLACE `repair-authority-ledger`
         APPEARS IN THIS PAYLOAD. `null` when there is no project-level problem:
         readiness is a per-shot question, and inventing a project verdict here
         would be a second thing capable of declaring the production ready. */
      nextAction: truthProblem ? action("repair-authority-ledger", truthProblem.message, 1) : null,
      mediaCheck: rows.length ? rows[0].mediaCheck : "not-checked",
      counts: deepFreeze(counts),
      shots: deepFreeze(rows),
      historic: historicConfirmationQueue(P, options, rows),
      unavailable: SHOT_READINESS_UNAVAILABLE,
    });
  }

  /* ==========================================================================
     THE HISTORIC CONFIRMATION QUEUE — DEDUPLICATED BY AUTHORITY TARGET.

     471 shot requirements collapsed to 53 human confirmations on the research
     corpus, and the 23-shot project alone collapsed 327 occurrences to 17. That
     ratio is why this is grouped by `authorityTarget().key` and by nothing else.

     NOT BY FILENAME, and not by label. A filename is not an identity — it is
     exactly the reasoning resolveMediaOwnership() refuses, and the reasoning
     repairCanonValue() was scoped away from after a global filename rewrite once
     moved an entity's Canon onto bytes nobody approved. "One row = one decision"
     is true here because a row IS one authority target.

     THIS FUNCTION ESTABLISHES NOTHING. It reports what a person could confirm and
     whether the shipped ownership veto would allow it. Writing the receipt is the
     kernel's four named commands, called from a real gesture, and nothing here is
     a shortcut around them. */
  function historicConfirmationQueue(project, options = {}, evaluated = null) {
    const P = record(project);
    const rows = evaluated || list(P.shots).map(record).filter((shot) => text(shot.id))
      .map((shot) => evaluateShotReadiness(P, shot, options));
    const byKey = new Map();
    let occurrences = 0;
    for (const shot of rows) {
      const all = [...list(shot.requirements), ...list(shot.units).flatMap((unit) => list(unit.requirements))];
      for (const requirement of all) {
        if (requirement.reason !== "historic-selection-unconfirmed" && requirement.reason !== "authority-revoked-pointer-remains") continue;
        if (!requirement.targetKey) continue;
        occurrences += 1;
        const existing = byKey.get(requirement.targetKey);
        if (existing) {
          existing.requirementCount += 1;
          if (!existing.shotIds.includes(shot.shotId)) existing.shotIds.push(shot.shotId);
          continue;
        }
        byKey.set(requirement.targetKey, {
          key: requirement.targetKey,
          target: { ...record(requirement.target) },
          kind: text(record(requirement.target).kind),
          label: requirement.label,
          value: requirement.value,
          assetId: requirement.assetId,
          basis: requirement.detail,
          reason: requirement.reason,
          requirementCount: 1,
          shotIds: [shot.shotId],
        });
      }
    }
    const items = [...byKey.values()].map((row) => deepFreeze({
      ...row,
      shotIds: deepFreeze([...row.shotIds]),
      /* WOULD THE SHIPPED VETO ALLOW IT. Asked per row, because "Confirm all" is
         only honest if the confirmations would not throw — and a project assembled
         by dragging files into a library can easily hold unowned or contested media
         even though the research corpus held none. */
      ownership: confirmationOwnership(P, row),
    })).sort((a, b) => (b.requirementCount - a.requirementCount) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return deepFreeze({
      occurrences,
      uniqueTargets: items.length,
      items: deepFreeze(items),
    });
  }

  function confirmationOwnership(project, row) {
    const target = record(row.target);
    if (text(target.kind) !== "entity-state") {
      /* A shot frame has no ownership concept — the bytes live in the shot's own
         takes directory and no entity claims them. */
      return deepFreeze({ applicable: false, status: "not-applicable", contested: false, claimants: deepFreeze([]), wouldRefuse: false, reason: "" });
    }
    const listName = text(target.list);
    const index = buildEntityOwnerIndexOwner(project, listName);
    const resolution = record(resolveMediaOwnershipOwner(index, text(row.value)));
    const owned = text(resolution.basis) === "durable-claim" && text(resolution.ownerId) === text(target.entityId);
    return deepFreeze({
      applicable: true,
      status: text(resolution.status),
      contested: resolution.contested === true,
      claimants: deepFreeze(list(resolution.claimants).map(text)),
      wouldRefuse: !owned,
      reason: owned ? "" : text(resolution.basis) || "unowned",
    });
  }

  return {
    SHOT_READINESS_CONTRACT,
    SHOT_READINESS_STATUSES,
    SHOT_ROLLUP_STATUSES,
    READINESS_REQUIREMENT_STATES,
    READINESS_REQUIREMENT_BASES,
    READINESS_BLOCKED_REASONS,
    READINESS_DECISION_REASONS,
    READINESS_CONTRAINDICATION_REASONS,
    READINESS_MEDIA_CHECKS,
    READINESS_UNIT_KINDS,
    READINESS_NEXT_ACTIONS,
    SHOT_READINESS_UNAVAILABLE,
    SHOT_READINESS_UNAVAILABLE_KEYS,
    ANIMATE_METHODS,
    ANIMATE_METHOD_PROBES,
    shotRouteInputNeeds,
    productionInputSatisfaction,
    evaluateShotReadiness,
    evaluateProjectReadiness,
    historicConfirmationQueue,
  };
});
