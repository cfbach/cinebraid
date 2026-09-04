/* CineBraid — THE ONE CANON-SAFE PROJECT BIBLE PROJECTION.

   Shared by browser and Node the same way public/shared-production-media.js and
   public/shared-build-history.js are. Today its consumers are both server routes:
   GET /api/bible (the screen) and GET /api/bible/export (the file). That is the
   point — see "ONE PROJECTION, TWO RENDERINGS" below.

   ---------------------------------------------------------------------------
   THE DEFECT THIS ENDS (Public Alpha UX convergence, Slice 2, P0).

   The Bible gated its MEDIA on the authority ledger and chose its PROMPTS by
   recency:

       package: resolvePromptBuildList(P, f.generationPackages).reverse().find(g => g.prompt)

   openCandidateCorrection() registers a targeted-repair draft into
   `frame.generationPackages` the moment the repair modal OPENS. So merely looking
   at a repair — generating nothing, approving nothing — moved the newest entry to
   the end of that list, and the Bible published

       "CORRECT THE EXISTING FRAME / Edit #image1 rather than creating a new
        composition. / CORRECTIONS / The left glove is the wrong colour."

   under FRAME PACKAGE, directly beneath an image whose only approval was for the
   PREVIOUS revision. Instructional draft text read as approved production truth,
   and the same draft became the shot's headline `prompt`.

   Three smaller members of the same class travelled with it. `continuityStates`
   was passed through raw, so every declared state printed its `approvedFile`
   pointer whether or not a receipt stood behind it. `made[]` published every
   hand-authored generation record regardless of which file it named. Entities
   published every saved Phase 1 draft prompt.

   ---------------------------------------------------------------------------
   THE INVARIANT, stated once so no surface has to infer it.

       ONLY MATERIAL SUPPORTED BY CURRENT APPROVED AUTHORITY MAY BE PRESENTED AS
       CURRENT BIBLE CANON.

   Existence is not authority. Recency is not authority. A pointer is not
   authority. A draft is not authority. A generation is not authority. Only a
   current human receipt is, and this module never decides that question itself:
   every canon answer below comes from public/shared-production-authority.js, which
   is the kernel's reader. This file CONSUMES authority and defines none.

   ---------------------------------------------------------------------------
   PROMPT / PACKAGE COHERENCE, which is the whole of the P0.

   A prompt may appear under current approved canon only when it is the prompt that
   PRODUCED THE APPROVED BYTES. The chain is a chain, and every link is a record
   that already exists:

       current receipt  ->  receipt.value is a filename
       filename         ->  the candidate row that files it (stored | name | original)
       candidate row    ->  sourceBuildId / sourcePackageId, written at generation
       build id         ->  promptBuildsById, or the row's own frozen snapshot

   If any link is missing the answer is ABSENT, never "the newest package". Fail
   closed, and say why: absence is reported with a reason a person can act on.

   `row.correctionBuildIds` and `row.currentCorrectionBuildId` are DELIBERATELY NOT
   CONSULTED. They record repairs authored AGAINST an approved candidate, not the
   build that made it — reading them is the defect with a different field name.

   ---------------------------------------------------------------------------
   ONE PROJECTION, TWO RENDERINGS.

   bibleCanonProjection() answers what is canon. bibleCanonMarkdown() serialises
   it. The CANON ONLY body is built by canonBodyLines(), which is not given the
   preset and therefore cannot vary by it; CANON + APPENDIX is that same body with
   appendix lines concatenated after a delimiter. So the exported canon is not
   "equivalent to" the screen's canon — it is the same values, and the two presets
   share one body byte for byte.

   No clock, no filesystem, no network, no DOM. The caller supplies the media
   listing it already has. Nothing here writes, normalises, or caches: a Bible read
   must not canonicalise a legacy project merely by looking at it. And nothing here
   is time-dependent, so the same project exports the same bytes every time. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CineBraidBibleCanon = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const AUTHORITY = (typeof module === "object" && module.exports)
    ? require("./shared-production-authority.js")
    : root;
  const HISTORY = (typeof module === "object" && module.exports)
    ? require("./shared-build-history.js")
    : root;

  const BIBLE_CANON_CONTRACT = { version: 1, name: "bible-canon" };
  /* The five answers to "what is this material?". Nothing in the canon body may
     carry anything but "current". */
  const BIBLE_MATERIAL_STATUSES = ["current", "historic", "draft", "rejected", "absent"];
  const BIBLE_EXPORT_PRESETS = ["canon", "canon-appendix"];
  /* Why a canon item has no publishable prompt. Each is a different repair. */
  const BIBLE_REPRESENTATION_ABSENCES = ["no-candidate-record", "no-recorded-build", "build-unavailable", "no-prompt-recorded"];
  /* What a canon item IS, so the sentence about it can use the right noun. */
  const BIBLE_MEDIA_FORMS = ["image", "video", "audio"];
  const BIBLE_ENTITY_LISTS = ["characters", "locations", "props", "vehicles", "audio"];
  const APPENDIX_HEADING = "## SUPPORTING MATERIAL — NOT CANON";

  function text(value) { return String(value == null ? "" : value).trim(); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  /* ======================================================================== */
  /* 1. THE COHERENCE LINK — approved bytes back to the prompt that made them  */
  /* ======================================================================== */

  function candidateRowFor(owner, fileName) {
    const wanted = text(fileName);
    if (!wanted) return null;
    return list(record(owner).candidateFiles).map(record).find((row) =>
      text(row.stored) === wanted || text(row.name) === wanted || text(row.original) === wanted) || null;
  }

  function buildFromLibrary(project, buildId) {
    const id = text(buildId);
    if (!id) return null;
    const library = record(record(project).promptBuildsById);
    if (!library[id]) return null;
    if (HISTORY && typeof HISTORY.resolvePromptBuild === "function") {
      /* Through the shipped resolver, so composition and motion snapshots rehydrate
         exactly as they do everywhere else. A build the library has lost comes back
         as a `missing: true` placeholder, which is not a prompt. */
      const resolved = HISTORY.resolvePromptBuild(project, { buildId: id });
      if (resolved && !resolved.missing) return resolved;
      return null;
    }
    return library[id];
  }

  /* The frozen copy a candidate row carries. It is only usable when it IS the row's
     recorded build — a snapshot whose id names some other package is somebody
     else's provenance. A snapshot with no id at all predates the id convention and
     is accepted, because the row is the only thing that ever pointed at it. */
  function snapshotFor(row, buildId) {
    for (const snapshot of [record(row).sourcePackageSnapshot, record(row).packageSnapshot]) {
      const it = record(snapshot);
      if (!text(it.prompt)) continue;
      const named = text(it.id) || text(it.packageId);
      if (!named || named === text(buildId)) return it;
    }
    return null;
  }

  function representationOf(build, boundTo, source) {
    const it = record(build);
    const prompt = text(it.prompt);
    if (!prompt) return null;
    return {
      prompt,
      buildId: text(it.id),
      packageId: text(it.packageId),
      profileId: text(it.profileId),
      profileName: text(it.profileName),
      profileVersion: text(it.profileVersion),
      kind: text(it.kind),
      references: list(it.references).map((ref, index) => ({
        token: text(record(ref).token) || "#image" + (index + 1),
        label: text(record(ref).label) || text(record(ref).key) || text(record(ref).role),
        role: text(record(ref).role),
      })),
      /* THE WHOLE POINT, carried on the record rather than assumed by the reader:
         these bytes are what this prompt produced, and this is how we know. */
      boundTo: text(boundTo),
      source,
    };
  }

  /* THE ONE ANSWER to "what approved prompt belongs to THIS approved revision?".
     Used for shot frames, motion units, shot delivery and entity states alike, so
     no surface can grow its own weaker version. */
  function approvedRepresentation(project, owner, approvedFile) {
    const boundTo = text(approvedFile);
    if (!boundTo) return { representation: null, absence: "no-candidate-record" };
    const row = candidateRowFor(owner, boundTo);
    if (!row) return { representation: null, absence: "no-candidate-record" };
    /* An entity candidate records the request as sent, verbatim, at generation.
       That IS the prompt these bytes came from — the strongest link there is. */
    const recorded = text(row.prompt);
    if (recorded) {
      return {
        representation: representationOf(
          {
            prompt: recorded,
            id: text(row.sourceBuildId),
            packageId: text(row.sourcePackageLabel) || text(row.sourcePackageId),
            profileName: text(row.generationModel),
          },
          boundTo, "candidate-record"),
        absence: "",
      };
    }
    const buildId = text(row.sourceBuildId) || text(row.sourcePackageId);
    if (!buildId) return { representation: null, absence: "no-recorded-build" };
    const built = buildFromLibrary(project, buildId);
    if (built) {
      const representation = representationOf(built, boundTo, "prompt-build");
      return representation ? { representation, absence: "" } : { representation: null, absence: "no-prompt-recorded" };
    }
    const frozen = snapshotFor(row, buildId);
    if (frozen) return { representation: representationOf(frozen, boundTo, "frozen-snapshot"), absence: "" };
    return { representation: null, absence: "build-unavailable" };
  }

  /* ONE SENTENCE, WRITTEN ONCE.

     `no-candidate-record`, `build-unavailable` and the rest are diagnostic codes:
     precise, auditable, and not something a filmmaker should ever read. Every
     surface that has to say "there is approved media here but we cannot tell you
     what produced it" says it in these words, and the projection composes the
     sentence rather than each renderer translating a code its own way. Four
     surfaces used to answer this question and only two of them answered it at all. */
  function mediaFormOf(fileName, fallback) {
    const name = text(fileName).toLowerCase();
    if (/\.(mp4|webm|mov|m4v)$/.test(name)) return "video";
    if (/\.(wav|mp3|m4a|aac|ogg|flac)$/.test(name)) return "audio";
    if (/\.(png|jpe?g|webp|gif|avif)$/.test(name)) return "image";
    return BIBLE_MEDIA_FORMS.includes(text(fallback)) ? text(fallback) : "image";
  }
  function missingProvenanceNote(form) {
    const noun = BIBLE_MEDIA_FORMS.includes(text(form)) ? text(form) : "image";
    return `The prompt behind this approved ${noun} was not recorded.`;
  }
  /* Empty when there is a prompt to publish, or when there is no approved media to
     be missing a prompt FOR — silence is only wrong where a claim was made. */
  function representationNoteFor(hasMedia, representation, form) {
    return hasMedia && !representation ? missingProvenanceNote(form) : "";
  }

  /* ======================================================================== */
  /* 2. AUTHORITY — asked, never answered, here                               */
  /* ======================================================================== */

  function receiptFor(project, target) {
    if (!AUTHORITY || typeof AUTHORITY.currentHumanAuthority !== "function") return null;
    return AUTHORITY.currentHumanAuthority(project, target) || null;
  }

  function targetKeyOf(target) {
    const it = record(target);
    if (it.kind === "shot-frame") return `shot-frame:${text(it.shotId)}#${text(it.frameId)}`;
    if (it.kind === "shot-motion") return `shot-motion:${text(it.shotId)}#${text(it.unitKey)}`;
    if (it.kind === "shot-delivery") return `shot-delivery:${text(it.shotId)}`;
    return `entity-state:${text(it.list)}:${text(it.entityId)}#${text(it.stateId)}`;
  }

  function authorityFacts(receipt, target) {
    const it = record(receipt);
    return {
      targetKey: targetKeyOf(target),
      receiptId: text(it.id),
      at: text(it.at),
      value: text(it.value),
      assetId: text(it.assetId),
    };
  }

  function entityTruth(project, listName, entityId) {
    if (!AUTHORITY || typeof AUTHORITY.entityProductionTruth !== "function") {
      return { list: listName, entityId, canon: [], references: [], historic: [] };
    }
    return AUTHORITY.entityProductionTruth(project, listName, entityId);
  }

  /* ======================================================================== */
  /* 3. THE PROJECTION                                                        */
  /* ======================================================================== */

  function mediaFinder(pool) {
    const index = new Map();
    for (const item of list(pool)) if (text(record(item).name)) index.set(text(record(item).name), record(item));
    return (name) => index.get(text(name)) || null;
  }

  function entityProjection(project, listName, entity, pool, ownedNames) {
    const x = record(entity);
    const truth = entityTruth(project, listName, x.id);
    const find = mediaFinder(pool);
    const owned = ownedNames instanceof Set ? ownedNames : null;
    /* Exact ownership, unchanged from the shipped route: a Bible that matched media
       by prefix would publish a child entity's reference under its parent's name. */
    const visible = (name) => (!owned || owned.has(text(name))) ? find(name) : null;
    const appendix = [];

    const declared = list(x.continuityStates).map(record);
    const nameOfState = (stateId) => {
      const found = declared.find((state) => text(state.id) === text(stateId));
      return text(record(found).name) || (text(stateId) === "state-default" ? "Default" : text(stateId));
    };

    /* CANON STATES ONLY, and each one's file is the RECEIPT's value — never the
       state's own `approvedFile` pointer, which is what a stale pointer would ride
       in on. A declared state with no receipt is history, and says so. */
    const states = [];
    const media = [];
    for (const row of list(truth.canon).map(record)) {
      /* The canon row already carries the receipt entityProductionTruth read, so
         this cites it rather than revalidating the whole ledger once per state. */
      const facts = {
        targetKey: targetKeyOf({ kind: "entity-state", list: listName, entityId: text(x.id), stateId: text(row.stateId) }),
        receiptId: text(row.receiptId),
        at: text(row.at),
        value: text(row.value),
        assetId: text(row.assetId),
      };
      const declaredState = declared.find((state) => text(state.id) === text(row.stateId)) || {};
      const file = text(row.value);
      const item = visible(file);
      const resolved = approvedRepresentation(project, x, file);
      const form = mediaFormOf(file, listName === "audio" ? "audio" : "image");
      states.push({
        id: text(row.stateId),
        name: text(row.stateName) || nameOfState(row.stateId),
        isDefault: row.isDefault === true,
        appliesTo: text(declaredState.appliesTo),
        notes: text(declaredState.notes),
        approvedFile: file,
        media: item,
        authority: facts,
        form,
        package: resolved.representation,
        representationStatus: resolved.representation ? "current" : "absent",
        representationAbsence: resolved.absence,
        representationNote: representationNoteFor(!!file, resolved.representation, form),
      });
      if (item && !media.some((m) => text(m.name) === text(item.name))) media.push(item);
    }

    for (const row of list(truth.historic).map(record)) {
      appendix.push({
        material: "state",
        status: "historic",
        label: text(row.stateName) || nameOfState(row.stateId),
        detail: text(row.value),
        basis: text(row.basis),
        why: "A selection nobody currently vouches for. It is not canon until a person approves it.",
      });
    }
    for (const state of declared) {
      const stateId = text(state.id);
      if (!stateId) continue;
      if (states.some((row) => row.id === stateId)) continue;
      if (list(truth.historic).map(record).some((row) => text(row.stateId) === stateId)) continue;
      appendix.push({
        material: "state",
        status: "absent",
        label: text(state.name) || stateId,
        detail: "",
        why: "Declared, with no approved image behind it.",
      });
    }

    /* COVERAGE AND EXPRESSION SLOTS ARE DELIBERATELY NOT LISTED, and this is worth
       stating because entityProductionTruth hands them over and it would be easy.
       They are supporting selections — a third thing, never canon — but the Bible
       has never published them, so putting them here would be new product surface
       rather than preserved material, and there are enough of them per entity to
       swamp the one thing this section exists to say. The section means exactly
       one thing: MATERIAL THE CANON FILTER REMOVED, AND WHY. */

    /* `made[]` IS NEVER A PRODUCING PROMPT, and the reason is worth stating because
       the first version of this file got it wrong in a way that reads as careful.

       It filename-matched: a hand-authored record naming one of this entity's canon
       files was promoted into the canon body as that file's provenance. So a record
       saying `KAI_DEFAULT.png` could publish "Kai in a RED jumpsuit" beside the
       candidate row's true "Kai in a clean work coat", and CANON ONLY carried BOTH.
       Two current-canon prompts for one approved image, disagreeing.

       A FILENAME IS NOT PROVENANCE. It is a string a person typed into a free-text
       box next to a prompt they also typed; nothing checked that the generation
       described is the generation that made those bytes. The producing prompt comes
       from the same chain everything else uses — the approved candidate row and the
       build it names — or it does not come at all.

       These records are still kept. They are the filmmaker's own notes about how
       work was made, and they go where non-canon material goes. */
    for (const entry of list(x.made).map(record)) {
      if (!text(entry.prompt)) continue;
      appendix.push({
        material: "generation-record",
        status: "historic",
        label: text(entry.files) || "Unfiled generation record",
        detail: text(entry.prompt),
        why: "A generation record somebody wrote by hand. It names a file, which is not proof it produced one.",
      });
    }

    /* Saved Phase 1 prompts are working drafts with no output edge at all. */
    for (const saved of list(x.prompts).map(record)) {
      if (!text(saved.text)) continue;
      appendix.push({
        material: "saved-prompt",
        status: "draft",
        label: text(saved.id) || "Saved prompt",
        detail: text(saved.text),
        why: "A saved draft prompt. Nothing approved was made from it.",
      });
    }

    return {
      id: text(x.id),
      name: text(x.name),
      notes: text(x.notes),
      role: text(x.role),
      /* FACTUAL CANON THE FILMMAKER AUTHORED. Not derived from a generation and not
         a draft of one: the identity block and its drift note are the description
         itself, and they survive an entity having no approved image. */
      block: text(x.block),
      driftNotes: text(x.driftNotes),
      media,
      continuityStates: states,
      canonStateCount: states.length,
      appendix,
    };
  }

  function shotProjection(project, shot, pool) {
    const s = record(shot);
    const find = mediaFinder(pool);
    const appendix = [];

    const declaredFrames = list(s.keyframes).map(record);
    const keyframes = declaredFrames.map((f, index) => {
      const label = text(f.label) || String.fromCharCode(65 + index);
      const frameId = text(f.id) || `frame-${index + 1}`;
      const target = { kind: "shot-frame", shotId: text(s.id), frameId };
      const receipt = receiptFor(project, target);
      const file = text(record(receipt).value);
      const resolved = receipt
        ? approvedRepresentation(project, s, file)
        : { representation: null, absence: "" };
      if (!receipt && text(f.winner)) {
        appendix.push({
          material: "frame",
          status: "historic",
          label: `Frame ${label}`,
          detail: text(f.winner),
          why: "A frame selection with no current approval behind it.",
        });
      }
      const winner = receipt ? find(file) : null;
      const form = mediaFormOf(file, "image");
      return {
        id: frameId,
        label,
        title: text(f.title) || `Frame ${label}`,
        description: text(f.description),
        notes: text(f.notes),
        required: f.required !== false,
        winner,
        authority: receipt ? authorityFacts(receipt, target) : null,
        form,
        package: resolved.representation,
        representationStatus: resolved.representation ? "current" : "absent",
        representationAbsence: resolved.absence,
        representationNote: representationNoteFor(!!winner, resolved.representation, form),
      };
    });

    const motions = list(s.clips).map(record).map((c, index) => {
      const label = text(c.label) || text(c.suffix) || String.fromCharCode(65 + index);
      const unitKey = text(c.id) || text(c.suffix);
      const target = { kind: "shot-motion", shotId: text(s.id), unitKey };
      const receipt = unitKey ? receiptFor(project, target) : null;
      const file = text(record(receipt).value);
      const resolved = receipt
        ? approvedRepresentation(project, s, file)
        : { representation: null, absence: "" };
      if (!receipt && text(c.videoWinner)) {
        appendix.push({
          material: "motion",
          status: "historic",
          label: `Motion ${label}`,
          detail: text(c.videoWinner),
          why: "A motion selection with no current approval behind it.",
        });
      }
      /* THE MOTION DRAFT IS NOT THE MOTION'S CANON, and it is one field wearing two
         names: public/v607-composer.js writes `unit.motionPrompt = unit.note = value`
         from the one direction editor, so both are the same unapproved generation
         draft. The first version of this file copied it straight into the canon body
         as `direction`, which meant a shot with ZERO receipts published a motion
         prompt under a heading that says approved. Recency was gone and rawness had
         taken its place.

         What may be published is what published everything else: the recorded
         producing representation of a CURRENT motion approval. The draft is kept,
         subordinate, in supporting material — unless it is word for word the
         approved prompt, in which case repeating it says nothing. */
      const draft = text(c.motionPrompt) || text(c.note);
      if (draft && draft !== text(record(resolved.representation).prompt)) {
        appendix.push({
          material: "motion-draft",
          status: "draft",
          label: `Motion ${label} direction`,
          detail: draft,
          why: receipt
            ? "A motion direction draft. It is not the prompt that produced the approved output."
            : "A motion direction draft. Nothing approved was made from it.",
        });
      }
      const fromFrame = keyframes.find((frame) => frame.id === text(c.fromFrame));
      const toFrame = keyframes.find((frame) => frame.id === text(c.toFrame));
      const winner = receipt ? find(file) : null;
      const form = mediaFormOf(file, "video");
      return {
        id: unitKey || `motion-${index + 1}`,
        label,
        title: text(c.title) || "Motion unit",
        kind: text(c.kind) || "plan",
        from: text(record(fromFrame).label) || text(record(keyframes[0]).label),
        to: text(record(toFrame).label),
        dur: +c.dur || 0,
        /* DIALOGUE AND VOICE NOTES STAY. They are script the filmmaker wrote about
           the shot, the same class as a title or an identity block, and no
           generation claims to have produced them. Only the prompt-class field
           left. */
        line: text(c.line),
        speakerId: text(c.speakerId),
        audioNote: text(c.audioNote) || text(c.vo),
        winner,
        authority: receipt ? authorityFacts(receipt, target) : null,
        form,
        package: resolved.representation,
        representationStatus: resolved.representation ? "current" : "absent",
        representationAbsence: resolved.absence,
        representationNote: representationNoteFor(!!winner, resolved.representation, form),
      };
    });

    const deliveryTarget = { kind: "shot-delivery", shotId: text(s.id) };
    const deliveryReceipt = receiptFor(project, deliveryTarget);
    const deliveryFile = text(record(deliveryReceipt).value);
    const deliveryResolved = deliveryReceipt
      ? approvedRepresentation(project, s, deliveryFile)
      : { representation: null, absence: "" };
    /* A DELIVERABLE NOBODY CURRENTLY VOUCHES FOR IS STILL REPORTED, the same way a
       frame or a motion selection is. Without this a withdrawn or stale deliverable
       left the document in silence, which is the one outcome worse than showing it:
       the person who approved it has no way to see that it is gone. The edge is
       read through the kernel because a deliverable lives across several fields and
       this file does not get to know which. */
    if (!deliveryReceipt && AUTHORITY && typeof AUTHORITY.liveAuthorityValue === "function") {
      const stale = record(AUTHORITY.liveAuthorityValue(project, deliveryTarget));
      if (text(stale.value)) {
        appendix.push({
          material: "delivery",
          status: "historic",
          label: "Approved deliverable",
          detail: text(stale.value),
          why: "A deliverable with no current approval behind it.",
        });
      }
    }
    const deliveryWinner = deliveryReceipt ? find(deliveryFile) : null;
    const deliveryForm = mediaFormOf(deliveryFile, "video");
    const delivery = deliveryReceipt
      ? {
          winner: deliveryWinner,
          authority: authorityFacts(deliveryReceipt, deliveryTarget),
          form: deliveryForm,
          package: deliveryResolved.representation,
          representationStatus: deliveryResolved.representation ? "current" : "absent",
          representationAbsence: deliveryResolved.absence,
          representationNote: representationNoteFor(!!deliveryWinner, deliveryResolved.representation, deliveryForm),
        }
      : null;

    /* `locked[0]` and "the newest package" are BOTH deleted. The headline is the
       opening frame's canon, or the shot's approved deliverable, or nothing.

       IT IS A PICTURE, NOT A FACT, and that distinction is the whole of the second
       review finding. A shot can hold three current approvals at once — a frame, a
       motion unit, and its deliverable — and they are three separate things a
       person decided. `winner` picks ONE of them to show at the top so the page has
       a hero image. Every surface that renders it must still publish the other two;
       when a headline is allowed to stand in for the set, approving a frame silently
       deletes the deliverable from the document. */
    const primaryFrame = keyframes.find((frame) => frame.winner);
    const winner = (primaryFrame && primaryFrame.winner) || (delivery && delivery.winner) || null;

    for (const entry of list(s.promptOptions).map(record)) {
      if (!text(entry.text)) continue;
      appendix.push({
        material: "saved-prompt",
        status: "draft",
        label: text(entry.id) || "Saved shot prompt",
        detail: text(entry.text),
        why: "A saved draft prompt. Nothing approved was made from it.",
      });
    }
    /* The shot-level motion draft, held to the same rule as the per-unit one. It
       used to leave here as `motionPrompt` and render under MOTION PROMPT on a shot
       with no approvals at all. */
    const shotDraft = text(s.motionPrompt);
    if (shotDraft && shotDraft !== text(record(delivery && delivery.package).prompt)) {
      appendix.push({
        material: "motion-draft",
        status: "draft",
        label: "Shot motion direction",
        detail: shotDraft,
        why: delivery
          ? "A motion direction draft. It is not the prompt that produced the approved deliverable."
          : "A motion direction draft. Nothing approved was made from it.",
      });
    }

    /* THERE IS NO SEPARATE `prompt` FIELD ANY MORE. It existed for shots that
       declare no frames, and it was a second copy of the deliverable's prompt — the
       shape that let a surface publish delivery truth without ever mentioning
       delivery authority. One deliverable, one place: `delivery.package`. */
    return {
      id: text(s.id),
      title: text(s.title),
      sceneId: text(s.scene),
      dur: motions.length ? motions.reduce((total, m) => total + m.dur, 0) : +s.dur || 0,
      route: text(s.route),
      winner,
      keyframes,
      motions,
      delivery,
      appendix,
    };
  }

  /* options: { media: {characters, locations, props, vehicles, audio}, shotMedia(shotId) -> [],
               ownedMedia(list, entityId) -> Set<string> | null, modelName(id) -> string }

     `media` is keyed by ENTITY LIST, not by disk folder. Which folder a list's
     media lives in is the server's business and it already states that map; a
     second copy here would be a second place to get it wrong. */
  function bibleCanonProjection(project, options = {}) {
    const P = record(project);
    const opts = record(options);
    const pools = record(opts.media);
    const shotMedia = typeof opts.shotMedia === "function" ? opts.shotMedia : () => [];
    const ownedMedia = typeof opts.ownedMedia === "function" ? opts.ownedMedia : () => null;
    const modelName = typeof opts.modelName === "function" ? opts.modelName : () => "";

    const entities = {};
    const pending = {};
    const appendix = [];
    for (const listName of BIBLE_ENTITY_LISTS) {
      const rows = list(P[listName]).map(record).map((entity) =>
        entityProjection(P, listName, entity, list(pools[listName]), ownedMedia(listName, text(entity.id))));
      /* An entity is in the canon body when the creator approved at least one of
         its states. Unchanged: this is the shipped gate, and it is the right one. */
      entities[listName] = rows.filter((row) => row.canonStateCount > 0);
      pending[listName] = rows.length - entities[listName].length;
      for (const row of rows) {
        for (const item of row.appendix) {
          appendix.push({ ...item, scope: "entity", list: listName, subjectId: row.id, subjectName: row.name });
        }
      }
      for (const row of entities[listName]) delete row.appendix;
    }

    const declaredShots = list(P.shots).map(record);
    const locked = declaredShots.filter((s) => text(s.status) === "LOCKED" || text(s.workflowStatus) === "APPROVED");
    const scenes = list(P.scenes).map(record);
    const defaults = record(record(P.meta).defaults);
    const shots = locked.map((source) => {
      const row = shotProjection(P, source, shotMedia(text(source.id)));
      const scene = scenes.find((x) => text(x.id) === row.sceneId);
      for (const item of row.appendix) {
        appendix.push({ ...item, scope: "shot", subjectId: row.id, subjectName: row.title });
      }
      const { appendix: dropped, sceneId, ...rest } = row;
      return {
        ...rest,
        scene: text(record(scene).title) || sceneId,
        stillModel: modelName(text(source.stillModel) || text(defaults.stillModel)),
        videoModel: modelName(text(source.videoModel) || text(defaults.videoModel)),
      };
    });
    pending.shots = declaredShots.length - locked.length;

    return {
      contractVersion: BIBLE_CANON_CONTRACT.version,
      meta: {
        title: text(record(P.meta).title),
        format: text(record(P.meta).format),
        version: text(record(P.meta).version),
        hubVersion: text(record(P.meta).hubVersion) || "v5.0",
      },
      models: clone(list(record(P.meta).models)),
      world: record(P.meta).world ? clone(record(P.meta).world) : null,
      styleBlocks: clone(list(record(P.meta).styleBlocks)),
      qcChecklist: clone(list(P.qcChecklist)),
      characters: entities.characters,
      locations: entities.locations,
      props: entities.props,
      vehicles: entities.vehicles,
      audio: entities.audio,
      shots,
      pending,
      appendix,
    };
  }

  /* ======================================================================== */
  /* 4. THE EXPORT — one body, two presets                                    */
  /* ======================================================================== */

  function oneLine(value) { return text(value).replace(/\s+/g, " "); }
  function fence(value) { return ["```", text(value), "```"]; }

  function entitySection(heading, rows) {
    const out = [`## ${heading}`, ""];
    if (!rows.length) {
      out.push(`_No approved ${heading.toLowerCase()} yet._`, "");
      return out;
    }
    for (const row of rows) {
      out.push(`### ${row.name || row.id}`);
      if (row.notes || row.role) out.push(oneLine(row.notes || row.role));
      if (row.block) out.push("", "**Identity block**", ...fence(row.block));
      if (row.driftNotes) out.push("", `**Continuity / drift** — ${oneLine(row.driftNotes)}`);
      for (const state of row.continuityStates) {
        out.push("", `**${state.name}${state.isDefault ? " (default)" : ""}** — approved ${state.form} \`${state.approvedFile}\`${state.appliesTo ? ` · ${oneLine(state.appliesTo)}` : ""}`);
        if (state.notes) out.push(oneLine(state.notes));
        if (state.package) out.push("", `_Approved prompt for \`${state.package.boundTo}\`_`, ...fence(state.package.prompt));
        else if (state.representationNote) out.push("", `_${state.representationNote}_`);
      }
      out.push("");
    }
    return out;
  }

  function shotSection(rows) {
    const out = ["## LOCKED SHOTS", ""];
    if (!rows.length) {
      out.push("_No locked shots yet._", "");
      return out;
    }
    for (const shot of rows) {
      out.push(`### ${shot.id} — ${shot.title}`);
      out.push(`${shot.scene}${shot.dur ? ` · ${shot.dur}s` : ""}${shot.route ? ` · ${shot.route}` : ""}`);
      /* THREE INDEPENDENT AUTHORITY FACTS, SERIALISED AS THREE. There is no
         headline line here at all: the shot's hero image is a presentation choice
         and every canonical fact below names its own file. The version that printed
         one line for `shot.winner` let an approved frame stand in for an approved
         deliverable, and a shot holding all three approvals exported only two. */
      for (const frame of shot.keyframes) {
        out.push("", `**Frame ${frame.label} — ${frame.title}**${frame.required ? "" : " (optional)"}`);
        if (frame.description) out.push(oneLine(frame.description));
        out.push(frame.winner ? `Approved image: \`${frame.winner.name}\`` : "No approved image.");
        if (frame.package) out.push("", `_Approved prompt for \`${frame.package.boundTo}\`_`, ...fence(frame.package.prompt));
        else if (frame.representationNote) out.push("", `_${frame.representationNote}_`);
      }
      for (const motion of shot.motions) {
        /* PT3 — a motion unit nobody has timed is not a zero-second one. The
           projection carries an undeclared duration as 0, which is the shipped
           reading rule (shotDurationAlias(): only a positive finite number counts
           as supplied) — so the export says what that 0 means instead of
           printing it as a length. */
        out.push("", `**Motion ${motion.label} — ${motion.title}** · ${motion.from || "?"}${motion.to ? ` → ${motion.to}` : ""} · ${motion.dur ? `${motion.dur}s` : "duration not planned"}`);
        if (motion.line) out.push(`Dialogue — ${oneLine(motion.line)}`);
        if (motion.audioNote) out.push(`Voice note — ${oneLine(motion.audioNote)}`);
        out.push(motion.winner ? `Approved output: \`${motion.winner.name}\`` : "No approved output.");
        if (motion.package) out.push("", `_Approved prompt for \`${motion.package.boundTo}\`_`, ...fence(motion.package.prompt));
        else if (motion.representationNote) out.push("", `_${motion.representationNote}_`);
      }
      if (shot.delivery) {
        out.push("", "**Approved deliverable**");
        out.push(shot.delivery.winner
          ? `Approved ${shot.delivery.form}: \`${shot.delivery.winner.name}\``
          : `Approved ${shot.delivery.form}: \`${shot.delivery.authority.value}\` (not on disk)`);
        if (shot.delivery.package) out.push("", `_Approved prompt for \`${shot.delivery.package.boundTo}\`_`, ...fence(shot.delivery.package.prompt));
        else if (shot.delivery.representationNote) out.push("", `_${shot.delivery.representationNote}_`);
      }
      out.push("");
    }
    return out;
  }

  /* THE CANON BODY. It is not given the preset, so it cannot vary by it — which is
     what makes "Canon Only and Canon + Appendix say the same thing" structural
     rather than a promise. */
  function canonBodyLines(doc) {
    const it = record(doc);
    const meta = record(it.meta);
    const out = [
      `# ${meta.title || "Untitled project"} — Project Bible`,
      "",
      `**Format:** ${meta.format || "—"}  `,
      `**Version:** ${meta.version || "—"}`,
      "",
      "Every entry below is current approved canon: a person approved it, and the approval still stands. Nothing draft, rejected, superseded or merely generated appears in this section.",
      "",
    ];
    const world = record(it.world);
    if (world.setting || world.include || world.reject || list(it.styleBlocks).length) {
      out.push("## WORLD & STYLE", "");
      if (world.setting) out.push("**Setting & era**", ...fence(world.setting), "");
      if (world.include) out.push("**Include**", ...fence(world.include), "");
      if (world.reject) out.push("**Reject on sight**", ...fence(world.reject), "");
      for (const style of list(it.styleBlocks).map(record)) {
        if (!text(style.text)) continue;
        out.push(`**${text(style.name)}${text(style.stage) ? ` · stage ${text(style.stage)}` : ""}**`, ...fence(style.text), "");
      }
    }
    out.push(...entitySection("CHARACTERS", list(it.characters)));
    out.push(...entitySection("LOCATIONS", list(it.locations)));
    out.push(...entitySection("PROPS", list(it.props)));
    out.push(...entitySection("VEHICLES", list(it.vehicles)));
    out.push(...entitySection("AUDIO", list(it.audio)));
    out.push(...shotSection(list(it.shots)));
    if (list(it.qcChecklist).length) {
      out.push("## WHAT APPROVED MEANS", "");
      list(it.qcChecklist).forEach((check, index) => out.push(`${index + 1}. ${oneLine(check)}`));
      out.push("");
    }
    return out;
  }

  const APPENDIX_STATUS_LABEL = {
    historic: "Historic — no current approval",
    draft: "Draft — never approved",
    rejected: "Rejected",
    absent: "Nothing approved",
  };

  function appendixLines(doc) {
    const rows = list(record(doc).appendix).map(record);
    const out = [APPENDIX_HEADING, ""];
    if (!rows.length) {
      out.push("_Nothing to report. Every piece of material in this project is current approved canon._", "");
      return out;
    }
    out.push("This section is NOT canon. It is kept so useful production material is not lost, and every entry carries the reason it is not canon. Nothing here may be treated as approved.", "");
    for (const row of rows) {
      const subject = text(row.subjectName) || text(row.subjectId);
      const detail = text(row.detail);
      out.push(`- **${APPENDIX_STATUS_LABEL[text(row.status)] || "Not canon"}** · ${subject ? `${subject} · ` : ""}${text(row.label)}${detail && detail.length <= 120 ? ` — \`${oneLine(detail)}\`` : ""}`);
      out.push(`  ${text(row.why)}`);
    }
    out.push("");
    return out;
  }

  function bibleCanonMarkdown(doc, options = {}) {
    const requested = text(record(options).preset);
    const preset = BIBLE_EXPORT_PRESETS.includes(requested) ? requested : "canon";
    const body = canonBodyLines(doc);
    if (preset === "canon") return body.join("\n") + "\n";
    return body.concat(appendixLines(doc)).join("\n") + "\n";
  }

  function bibleExportFilename(doc, preset) {
    const title = text(record(record(doc).meta).title) || "project";
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
    return text(preset) === "canon-appendix" ? `${slug}-bible-with-appendix.md` : `${slug}-bible.md`;
  }

  return {
    BIBLE_CANON_CONTRACT,
    BIBLE_MATERIAL_STATUSES,
    BIBLE_EXPORT_PRESETS,
    BIBLE_REPRESENTATION_ABSENCES,
    BIBLE_MEDIA_FORMS,
    BIBLE_ENTITY_LISTS,
    BIBLE_APPENDIX_HEADING: APPENDIX_HEADING,
    bibleCanonProjection,
    bibleCanonMarkdown,
    bibleExportFilename,
    approvedRepresentation,
    /* Exported so the page prints the same sentence rather than composing its own
       from a diagnostic code. */
    missingProvenanceNote,
    mediaFormOf,
  };
});
