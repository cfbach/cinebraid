/* CineBraid — MOTION INTENT: what a motion plan DECLARES, and what it merely DEFAULTS.
 *
 * Browser and Node, the same way public/shared-frame-presence.js is shared, and
 * deliberately its sibling: that file owns whether an entity is IN THE FRAME AT ALL,
 * this one owns whether a statement about how it MOVES was made by a filmmaker or
 * manufactured by a blank control.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS ENDS (Dogfood, 2026-08-26, shot TLS-002).
 *
 * The shot was a swamp journey. Its declared action was a travelling walk cycle. The
 * compiled MiniMax H3 prompt told the model the character "maintains a still posture
 * with subtle natural breathing and blinking", and the returned video did exactly that.
 *
 * Nothing in the project said "stand still". Every one of the three routes that put it
 * there read a control the filmmaker had never touched:
 *
 *   1. structuredMotionSummary() iterated the shot's CAST and, for a character with no
 *      entry in `plan.subjects` at all, printed
 *      "<name> remains still except for natural breathing and blinking."
 *      With no free-text direction that summary becomes the motion unit's `note`, which
 *      buildContext() reads as the shot's description AND its motionDirection, which
 *      defaultSpec() turns into `actions[0]`. No assistant is involved.
 *   2. The same sentence is sent verbatim as the directive on the Improve path, where an
 *      assistant paraphrases it into the sentence the dogfood pass actually saw.
 *   3. applyStructuredDirection() read `item.action || "still"` for a plan entry whose
 *      every field was the normalizer's own default, and PREPENDED the result — so
 *      `action.primary`, the one intent a motion package cannot be without, became
 *      "CH-REX still" and the declared walk was demoted to a secondary beat.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, and it is the whole module.
 *
 *     A DEFAULT MAY FILL AN UNKNOWN. IT MAY NEVER MAKE A STATEMENT.
 *
 * A control the filmmaker never addressed carries no intent, so it produces SILENCE —
 * not "still", not "static", not "locked", not "hold the final state". Silence is what
 * lets a legitimate model-side default fill the gap honestly, and it is the only reading
 * under which a blank form cannot contradict a written one.
 *
 * The inverse is equally load-bearing and is why this file is not a filter over the word
 * "still": a DECLARED stillness is real filmmaking and must survive untouched. "Rex holds
 * absolutely still while the water settles" is a direction. An untouched dropdown is not.
 *
 * ---------------------------------------------------------------------------
 * THE UNIT OF THE ANSWER IS A FIELD, NEVER A ROW.
 *
 * HOLD CORRECTION, blocker 1. The first pass asked this question per ROW — "is this
 * camera declared?" — and an emitter that got `true` then wrote the whole row. So
 * touching camera INTENSITY made the untouched `move` speak as `locked-off camera with
 * no drift`; touching timing PACING made the untouched `holdEnd` require settle-and-hold;
 * touching environment INTENSITY made the untouched `action` assert stability. One
 * declared member promoted every default beside it, which is the original defect wearing
 * a smaller coat.
 *
 * `fields` is therefore the answer, and `declared` is only ever the convenience question
 * "is there anything here at all". A caller that emits must ask per field —
 * motionFieldDeclared(), or `.fields.includes(...)` — and every emitter in this
 * repository does.
 *
 * ---------------------------------------------------------------------------
 * HOW A DECLARATION IS RECOGNISED. TWO READINGS, AND THE SECOND IS THE FALLBACK.
 *
 *   MARKED     The writer recorded the field. `entry.declaredFields` is a list of the
 *              keys a filmmaker's own edit wrote, appended by the composer's setters at
 *              the moment of the edit. This is the only reading that can hear someone
 *              deliberately choosing a value that happens to equal the default — picking
 *              "Remain still" on purpose, or setting the camera back to locked.
 *   DIVERGENT  The stored value differs from the canonical default for that field. This
 *              is what every project written before this contract existed can be read
 *              with, and it is exact for every value except the default itself.
 *
 * A field is declared when EITHER reading says so. There is no migration: unmarked data
 * degrades to the divergent reading, which is what it always effectively meant, and a
 * marked field is simply heard more precisely from the next edit onward.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS NOT.
 *
 *   the motion plan's shape        public/v607-composer.js normalizeMotionPlan607(),
 *                                  which fills the defaults. It reads the table below
 *                                  rather than restating it, so the normalizer and the
 *                                  declaration test cannot drift into disagreeing about
 *                                  what "default" means.
 *   the sentences                  public/v607-composer.js (the composer summary) and
 *                                  prompt-engine.js (the spec). This file returns
 *                                  TOKENS and booleans and writes no filmmaker language.
 *   a contradiction detector       there is deliberately none. Preventing a default from
 *                                  speaking removes the contradiction at its source; a
 *                                  reader that searched compiled prose for stillness
 *                                  words would be the phrase blacklist this repair
 *                                  exists to avoid.
 *   an arbiter between two         two DECLARED values that disagree are a disagreement
 *   declared values                between two things a filmmaker wrote, and this module
 *                                  refuses to silently pick one. Only default-versus-
 *                                  declared is decided here.
 *
 * Deliberately absent, and required to stay absent:
 *   - file or network I/O
 *   - provider or model awareness
 *   - Date.now(), new Date(), Math.random()
 *   - any mutation of anything passed in
 *   - UI wording
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  const CINEBRAID_MOTION_INTENT_CONTRACT = "cinebraid.motion-intent/1";

  /* The key a writer appends to. Named once so a setter, a reader and a test cannot
     disagree about it by typing it differently. */
  const MOTION_INTENT_DECLARED_KEY = "declaredFields";

  function motionIntentFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) motionIntentFreeze(value[key]);
    }
    return value;
  }
  function motionIntentText(value) {
    return String(value == null ? "" : value).trim();
  }
  function motionIntentRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /* ==========================================================================
     THE CANONICAL BLANK, one dimension at a time.

     Every value here is what public/v607-composer.js normalizeMotionPlan607() writes
     into a field nobody has set. It is the definition of "the filmmaker said nothing",
     and it is the only place that definition exists. */
  const MOTION_PLAN_DEFAULTS = motionIntentFreeze({
    subject: {
      action: "still",
      direction: "",
      intensity: "subtle",
      look: "",
      targetId: "",
      targetLabel: "",
      destination: "",
      notes: "",
    },
    prop: {
      action: "static",
      direction: "",
      targetId: "",
      targetLabel: "",
      destination: "",
      notes: "",
    },
    camera: {
      move: "locked",
      direction: "",
      intensity: "subtle",
      style: "smooth",
      framing: "preserve",
    },
    environment: {
      action: "static",
      intensity: "subtle",
      notes: "",
    },
    timing: {
      onset: "immediate",
      pacing: "natural",
      holdEnd: true,
      secondary: "",
    },
    /* HOLD CORRECTION, blocker 2. The audio row is here so a DECLARED motion-audio mode
       can be recognised as one. `none` is what an untouched plan carries, so a stored
       `lip-sync-reference` is a decision under the divergent reading alone — which is
       what makes every project written before this contract read correctly. */
    audio: {
      mode: "none",
      referenceKey: "",
      speakerId: "",
      voiceEntityId: "",
      lipSync: false,
      direction: "",
    },
  });

  const MOTION_INTENT_DIMENSIONS = motionIntentFreeze(Object.keys(MOTION_PLAN_DEFAULTS));

  /* `targetLabel` is written by the composer as a CONSEQUENCE of setting `targetId`,
     never on its own, so it is not evidence of a decision by itself. Reading it as one
     would let a stale label keep an entry alive after its target was cleared. */
  const MOTION_INTENT_DERIVED_FIELDS = motionIntentFreeze({
    subject: ["targetLabel"],
    prop: ["targetLabel"],
    camera: [],
    environment: [],
    timing: [],
    /* `lipSync` is recomputed from `mode` by the normalizer on every pass, so it is a
       restatement of a decision rather than one of its own. */
    audio: ["lipSync"],
  });

  function motionPlanDefaults(dimension) {
    const row = MOTION_PLAN_DEFAULTS[motionIntentText(dimension)];
    return row ? { ...row } : null;
  }

  /* Same value, compared the way the stored record actually varies: a boolean control
     round-trips through a checkbox and a JSON file, so `false` and `"false"` are one
     answer, and an absent field is the default rather than a difference. */
  function motionIntentSame(value, fallback) {
    if (value === undefined || value === null) return true;
    if (typeof fallback === "boolean") return Boolean(value) === fallback;
    return motionIntentText(value) === motionIntentText(fallback);
  }

  function motionIntentMarked(entry) {
    const marks = motionIntentRecord(entry) ? entry[MOTION_INTENT_DECLARED_KEY] : null;
    return Array.isArray(marks) ? marks.map(motionIntentText).filter(Boolean) : [];
  }

  /* ==========================================================================
     ONE ENTRY'S READING.

     `declared` is the answer every caller in this repository actually wants; `fields`
     and `reasons` exist so a surface, a provenance record or a failing test can say
     WHICH value was heard and under which reading, rather than reporting a bare boolean
     nobody can check. An unrecognised dimension is `known: false` and declares nothing —
     absence and a value this build cannot read behave identically, exactly as
     public/shared-shot-intent.js treats an unreadable route. */
  function motionEntryDeclaration(dimension, entry) {
    const key = motionIntentText(dimension);
    const defaults = MOTION_PLAN_DEFAULTS[key];
    if (!defaults) {
      return motionIntentFreeze({ dimension: key, known: false, present: false, declared: false, fields: [], reasons: {} });
    }
    if (!motionIntentRecord(entry)) {
      return motionIntentFreeze({ dimension: key, known: true, present: false, declared: false, fields: [], reasons: {} });
    }
    const derived = MOTION_INTENT_DERIVED_FIELDS[key] || [];
    const marked = new Set(motionIntentMarked(entry));
    const fields = [];
    const reasons = {};
    for (const field of Object.keys(defaults)) {
      if (derived.includes(field)) continue;
      if (marked.has(field)) {
        fields.push(field);
        reasons[field] = "marked";
        continue;
      }
      if (!motionIntentSame(entry[field], defaults[field])) {
        fields.push(field);
        reasons[field] = "divergent";
      }
    }
    return motionIntentFreeze({
      dimension: key,
      known: true,
      present: true,
      declared: fields.length > 0,
      fields,
      reasons,
    });
  }

  function motionEntryDeclared(dimension, entry) {
    return motionEntryDeclaration(dimension, entry).declared;
  }

  /* THE QUESTION EVERY EMITTER MUST ACTUALLY ASK.
     One field at a time, so a declared sibling can never speak for an untouched one.
     A derived field is never declared, and an unrecognised dimension or field is `false`
     rather than an error — absence and unreadability behave identically here. */
  function motionFieldDeclared(dimension, entry, field) {
    return motionEntryDeclaration(dimension, entry).fields.includes(motionIntentText(field));
  }

  /* ==========================================================================
     THE WHOLE PLAN'S READING.

     `declared` and `defaulted` are flat lists of `{dimension, id}` so a compiler can
     record what it took and what it withheld without re-walking the plan. A subject or
     prop with no entry at all appears in NEITHER: nothing was stored, so there is
     nothing to have withheld. Only an entry that exists and says nothing is `defaulted`,
     because that is the one a reader would otherwise have believed. */
  function motionPlanDeclaration(plan) {
    const source = motionIntentRecord(plan) ? plan : {};
    const declared = [];
    const defaulted = [];
    const subjects = {};
    const props = {};
    for (const [collection, dimension, out] of [
      ["subjects", "subject", subjects],
      ["props", "prop", props],
    ]) {
      const rows = motionIntentRecord(source[collection]) ? source[collection] : {};
      for (const id of Object.keys(rows)) {
        const reading = motionEntryDeclaration(dimension, rows[id]);
        out[id] = reading;
        (reading.declared ? declared : defaulted).push({ dimension, id });
      }
    }
    const singles = {};
    for (const dimension of ["camera", "environment", "timing", "audio"]) {
      const reading = motionEntryDeclaration(dimension, source[dimension]);
      singles[dimension] = reading;
      if (reading.present) (reading.declared ? declared : defaulted).push({ dimension, id: "" });
    }
    return motionIntentFreeze({
      contract: CINEBRAID_MOTION_INTENT_CONTRACT,
      subjects,
      props,
      camera: singles.camera,
      environment: singles.environment,
      timing: singles.timing,
      audio: singles.audio,
      declared,
      defaulted,
      anyDeclared: declared.length > 0,
    });
  }

  /* Convenience readings, so a caller iterating a cast or a prop list asks one question
     instead of assembling the plan reading itself. A subject with no entry and a subject
     whose entry is entirely default give the same answer, which is the point. */
  function motionSubjectDeclared(plan, subjectId) {
    const rows = motionIntentRecord(plan) && motionIntentRecord(plan.subjects) ? plan.subjects : {};
    return motionEntryDeclared("subject", rows[motionIntentText(subjectId)]);
  }
  function motionPropDeclared(plan, propId) {
    const rows = motionIntentRecord(plan) && motionIntentRecord(plan.props) ? plan.props : {};
    return motionEntryDeclared("prop", rows[motionIntentText(propId)]);
  }
  function motionCameraDeclared(plan) {
    return motionEntryDeclared("camera", motionIntentRecord(plan) ? plan.camera : null);
  }
  function motionEnvironmentDeclared(plan) {
    return motionEntryDeclared("environment", motionIntentRecord(plan) ? plan.environment : null);
  }
  function motionTimingDeclared(plan) {
    return motionEntryDeclared("timing", motionIntentRecord(plan) ? plan.timing : null);
  }
  function motionAudioDeclared(plan) {
    return motionEntryDeclared("audio", motionIntentRecord(plan) ? plan.audio : null);
  }

  /* ==========================================================================
     THE ONE THING A WRITER NEEDS, and it mutates nothing.

     Returns the `declaredFields` list an entry should carry once a filmmaker has set
     `field` on it. The caller assigns it, so the mutation stays with the setter that
     owns the record and this module keeps its no-write guarantee. A derived field is
     never marked: `targetLabel` is written for the filmmaker, not by them. */
  function motionDeclaredFieldsWith(dimension, entry, field) {
    const key = motionIntentText(dimension);
    const name = motionIntentText(field);
    const existing = motionIntentMarked(entry);
    if (!MOTION_PLAN_DEFAULTS[key]) return existing;
    if (!name || !(name in MOTION_PLAN_DEFAULTS[key])) return existing;
    if ((MOTION_INTENT_DERIVED_FIELDS[key] || []).includes(name)) return existing;
    return existing.includes(name) ? existing : [...existing, name];
  }

  return {
    CINEBRAID_MOTION_INTENT_CONTRACT,
    MOTION_INTENT_DECLARED_KEY,
    MOTION_INTENT_DIMENSIONS,
    MOTION_INTENT_DERIVED_FIELDS,
    MOTION_PLAN_DEFAULTS,
    motionPlanDefaults,
    motionEntryDeclaration,
    motionEntryDeclared,
    motionFieldDeclared,
    motionPlanDeclaration,
    motionSubjectDeclared,
    motionPropDeclared,
    motionCameraDeclared,
    motionEnvironmentDeclared,
    motionTimingDeclared,
    motionAudioDeclared,
    motionDeclaredFieldsWith,
  };
});
