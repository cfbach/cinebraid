/* Shared lip-sync derivation for the browser composer, the import normaliser and the
   Node prompt compiler.
 *
 * ONE QUESTION, ONE ANSWER, THREE VALUES.
 *
 * CineBraid derived this fact at two independently written sites — the browser composer
 * and the Project Builder import normaliser — and both wrote the same rule:
 *
 *     lipSyncRequired: dialogue.lipSyncRequired === true || !!line
 *
 * A LINE EXISTING MADE LIP SYNC REQUIRED. Every voice-over, every off-screen line, every
 * half of a phone call, every radio transmission and every back-to-camera delivery was
 * classified as needing the mouth to match the words. That is not a cosmetic mislabel:
 * it gates a whole class of generation route, and it is asserted about shots where the
 * speaker is not visible at all.
 *
 * The correction is not a better guess. It is admitting that the boolean had no room for
 * the answer that is usually true:
 *
 *     critical   the mouth must match the words — visible speech, on camera
 *     implied    a line exists and visible synchronisation is NOT established
 *     none       nothing to synchronise
 *
 * `implied` is the value CineBraid could not previously express, which is exactly why
 * the old code had to round it to `critical`.
 *
 * WHAT THIS MODULE WILL NOT DO. It never promotes to `critical` from line presence, and
 * it never reads prose looking for "V.O." or "on the phone" to decide the answer. An
 * unestablished fact stays unestablished: `implied` is that state, and it is the honest
 * output for a shot nobody has told us about. Only an explicit tri-state value or an
 * explicit human requirement produces `critical`.
 *
 * PROVENANCE, AND WHY NOTHING IS MIGRATED. A stored `lipSyncRequired: true` cannot be
 * trusted as a filmmaker's decision, because both derivation sites above WROTE that
 * value into durable project data whenever a line existed. Converting stored booleans to
 * a durable `critical` would launder a machine inference into production truth, so no
 * stored value is rewritten by this module or by anything that calls it. The reading is
 * derived on demand, existing projects keep exactly the bytes they had, and the two
 * sites stop manufacturing so that a `true` written from here on really is a decision.
 *
 * Nothing is mutated and nothing is read from configuration, a clock or the filesystem:
 * the same brief derives to the same level in the browser, in the server and in a test.
 */

const CINEBRAID_LIP_SYNC_LEVELS = Object.freeze(["none", "implied", "critical"]);

/* The shape both call sites already hold: a dialogue block, or anything carrying the
   same three fields. Kept permissive on purpose — the composer passes its `dialogue`
   object, the compiler passes `spec.audio`, and neither should have to reshape. */
function cineBraidLipSyncText(value) {
  return String(value == null ? "" : value).trim();
}

/* An explicit tri-state, where one has been recorded. This is the only input that can
   name `none` while a line exists, because only a human can say the mouth does not
   matter in a shot that has words in it. */
function explicitLipSyncLevel(source) {
  const declared = cineBraidLipSyncText(source && source.lipSync).toLowerCase();
  return CINEBRAID_LIP_SYNC_LEVELS.includes(declared) ? declared : "";
}

/* THE derivation. Everything that wants to know reads this and nothing re-derives it.
 *
 * Order is the whole meaning:
 *   1. an explicit tri-state wins outright — it is the only recorded answer
 *   2. no line, nothing to synchronise, and `none` is an absence rather than a fact
 *   3. an explicit boolean requirement is a human saying the mouth must match
 *   4. a line with nothing else established is `implied`, never `critical`
 */
function deriveLipSync(source) {
  const dialogue = source && typeof source === "object" ? source : {};
  const explicit = explicitLipSyncLevel(dialogue);
  if (explicit) return explicit;
  /* `line` in a composer brief, `dialogue` on a compiled spec. The same words. */
  const line = cineBraidLipSyncText(dialogue.line || dialogue.dialogue);
  if (!line) return "none";
  if (dialogue.lipSyncRequired === true) return "critical";
  return "implied";
}

/* The boolean-compatible accessor, so nothing downstream has to be rewritten on the same
   day the tri-state lands. `implied` reads as NOT required, which is the safe direction:
   it stops an unestablished fact from being asserted as a hard requirement, and it is
   what the old code should have said about an off-screen line all along. */
function lipSyncRequiredFrom(source) {
  return deriveLipSync(source) === "critical";
}

if (typeof window !== "undefined") {
  window.CINEBRAID_LIP_SYNC_LEVELS = CINEBRAID_LIP_SYNC_LEVELS;
  window.deriveLipSync = deriveLipSync;
  window.lipSyncRequiredFrom = lipSyncRequiredFrom;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CINEBRAID_LIP_SYNC_LEVELS,
    deriveLipSync,
    explicitLipSyncLevel,
    lipSyncRequiredFrom,
  };
}
