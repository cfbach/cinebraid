/* The declared shot delivery route — one durable production statement, one vocabulary.
 *
 * WHAT A ROUTE IS. A filmmaker deciding "this shot is a first/last-frame shot" has made a
 * production decision, in the same way that deciding a lens is "unspecified" is a
 * decision. It is intent about HOW the shot is meant to be delivered. It survives the
 * model that happens to be connected today, the price of that model, and whichever
 * provider is reachable this afternoon.
 *
 * WHAT A ROUTE IS NOT, and every one of these has its own owner already:
 *
 *     a model choice            data/model-definitions.json + the profile a shot stores
 *     a provider choice         data/provider-surfaces.json, resolved per installation
 *     a cost                    public/shared-generation-rate.js
 *     availability              public/shared-generation-options.js
 *     a recommendation          nothing derives one here; `catalogue.priority` ranks
 *     what CAN be generated     resolveTaskModes(), from what the shot actually has
 *
 * A route NARROWS nothing in this slice and WIDENS nothing ever. It is stored, carried
 * and read; no function in this file consults project state to choose one, and no caller
 * anywhere derives generation admissibility from one. resolveTaskModes() is untouched.
 *
 * WHY THE VOCABULARY IS THE ONE ALREADY IN THE REPOSITORY. `t2v`, `i2v`, `flf` and `r2v`
 * are how CineBraid has spelled these four concepts since long before this file:
 * shared-generation-capability.js declares them in CINEBRAID_GENERATION_MODES,
 * resolveTaskModes() returns them, server.js's import normaliser admits them as clip
 * kinds, and data/model-profiles.json stores them on 47 profiles. A parallel `T2V`
 * spelling would mean every reader has to know both, so the uppercase form used in
 * research prose is treated as a CASE dialect of the same token and nothing more.
 *
 * `hybrid` is the fifth, and it is deliberately NOT a generation mode. A shot may be
 * delivered by more than one method — public/app.js already recognises the shape as a
 * multi-clip `sequence`, where each motion unit carries its own `kind` — and saying so is
 * a real production statement. It names no mode precisely because it names no single
 * method, which is also why it can never widen anything.
 *
 * WHERE IT LIVES. `shot.deliveryRoute`, a scalar string on the shot record. The name is
 * the repository's own: public/shared-stage-model.js's SHOT_STAGE_LIMITATIONS entry
 * `no-not-applicable` says in as many words that what it lacks is "a declared shot
 * delivery route on the shot record".
 *
 * THREE NEIGHBOURING FIELDS IT IS NOT, because all three already exist on or beside a
 * shot and confusing any of them with this would be a silent semantic merge:
 *
 *     shot.route                   legacy free text — "GENERATE", "GENERATE (FLF)",
 *                                  "GENERATE (R2V)", "COMPOSITE", "REUSE". It answers
 *                                  "does CineBraid make this at all", and three
 *                                  different output plans write the same "GENERATE", so
 *                                  it cannot carry a route without losing information.
 *     creationBrief.deliveryIntent still vs motion — WHAT is delivered, not how. A dozen
 *                                  motion-panel writers set it to "motion" as a side
 *                                  effect of editing, which is exactly why durable
 *                                  intent must not live beside it.
 *     clip.kind                    per motion unit, not per shot. A shot's route and its
 *                                  units' kinds are different statements at different
 *                                  scales; this file never derives one from the other.
 *
 * ABSENCE IS ABSENCE. A shot with no declared route has the key MISSING — not "", not
 * "unknown", not a guess reconstructed from its frames, its references, its prior
 * generations or its prompt wording. Nothing in this file writes a route that was not
 * handed to it by a caller that already had the decision, and `clearShotRoute` deletes
 * the key rather than storing an empty one. That is the same shape shot.continuityIntent
 * uses, and for the same reason.
 *
 * MALFORMED IS NOT SOMETHING ELSE. An unrecognised value is reported by name and read as
 * NO declared route. It never becomes the nearest valid one. This is the policy
 * server.js's clip normaliser already established for an unknown `kind`: warn, and demote
 * to a value that cannot generate, rather than pick a neighbour.
 *
 * Pure. No network, no filesystem, no clock. `declareShotRoute` and `clearShotRoute` edit
 * exactly the one key they are named for on the record they are given, and nothing else.
 */

/* The storage key, declared once so a reader, a writer, a migration rule and a test
   cannot each spell it for themselves. */
const CINEBRAID_SHOT_ROUTE_FIELD = "deliveryRoute";

/* The canonical stored values, in the order the vocabulary is declared rather than
   alphabetically — nothing may read a ranking into this list. */
const CINEBRAID_SHOT_ROUTES = ["t2v", "i2v", "flf", "r2v", "hybrid"];

/* How a stored value reads. Three states, because "nobody declared one" and "somebody
   stored something this build does not recognise" are different facts and a reader that
   collapsed them would report a corrupted record as an undecided one. */
const CINEBRAID_SHOT_ROUTE_READINGS = ["absent", "declared", "unrecognised"];

/* route -> the CINEBRAID_GENERATION_MODES member that means the same thing, or "" where
   no single mode does. The four video modes are the same tokens, which is the point:
   this table exists to say that the equivalence is EXACT for four of them and ABSENT for
   `hybrid`, not to translate between two spellings.

   Nothing in CineBraid turns this into permission. A mode named here is a mode the
   catalogue already knows; whether a shot may generate in it is resolveTaskModes()'s
   answer, from the shot's own inputs, and this file is not consulted. */
const CINEBRAID_SHOT_ROUTE_MODES = {
  t2v: "t2v",
  i2v: "i2v",
  flf: "flf",
  r2v: "r2v",
  /* Declared empty rather than omitted: a reader must be able to see that hybrid was
     considered and has no mode, instead of inferring it from a missing key. */
  hybrid: "",
};

/* The legacy `shot.route` dialect, and the ONLY two of its values that carry a route.

   public/app.js reads this field in two places today — `(s.route || "").includes("FLF")`
   and `.includes("R2V")` — to choose a clip kind, and window.setOutputPlan writes exactly
   these strings. So the mapping below is not a new claim; it is the one the running app
   already makes, written down.

   "GENERATE" is absent on purpose. setOutputPlan writes it for `still`, `animate` AND
   `sequence`, so it is three different plans wearing one word and reading a route out of
   it would be a guess. "COMPOSITE" and "REUSE" are absent because they describe a shot
   CineBraid does not generate at all. */
const CINEBRAID_SHOT_ROUTE_LEGACY_TOKENS = { FLF: "flf", R2V: "r2v" };

function shotRouteText(value) {
  return String(value == null ? "" : value).trim();
}

function shotRouteRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/* The one reconciliation. Case and surrounding whitespace only — a token that is not one
   of the five after folding is not one of the five, and no distance, prefix or substring
   reasoning is applied to it. "i2 v", "image-to-video" and "GENERATE (FLF)" all return ""
   here; the last of those has its own named translator below because it belongs to a
   different field. */
function canonicalShotRoute(value) {
  /* A ROUTE IS A STRING. `["flf"]` stringifies to "flf" and `{toString(){return "flf"}}`
     does too, so a reader that coerced first would accept a one-element array out of a
     hand-edited document as a declaration. The type is checked before the token is. */
  if (typeof value !== "string") return "";
  const token = value.trim().toLowerCase();
  return CINEBRAID_SHOT_ROUTES.includes(token) ? token : "";
}

/* What a shot's record actually says, with the stored value kept beside the reading so a
   caller can report the bad token rather than only its own disappointment. */
function readShotRoute(shot) {
  const record = shotRouteRecord(shot);
  if (!Object.prototype.hasOwnProperty.call(record, CINEBRAID_SHOT_ROUTE_FIELD))
    return { reading: "absent", route: "", stored: null, reason: "" };
  const stored = record[CINEBRAID_SHOT_ROUTE_FIELD];
  /* An explicit null or empty string is the same production fact as a missing key — the
     slot exists and nobody has declared anything into it. It is read as absent rather
     than as a bad value, because a record that once held a route and was cleared is not
     corrupt. */
  if (stored === null || shotRouteText(stored) === "")
    return { reading: "absent", route: "", stored, reason: "" };
  const route = canonicalShotRoute(stored);
  if (route) return { reading: "declared", route, stored, reason: "" };
  return {
    reading: "unrecognised",
    route: "",
    stored,
    reason: `${JSON.stringify(stored)} is not one of ${CINEBRAID_SHOT_ROUTES.join(", ")}`,
  };
}

/* The canonical route, or "" for both absent and unrecognised. The two are the same
   answer to "what may I rely on", and different answers to "what does the file say" —
   which is what readShotRoute is for. */
function declaredShotRoute(shot) {
  return readShotRoute(shot).route;
}

/* THE ONLY WRITER. It takes a decision that has already been made somewhere that owns
   making it, canonicalises the spelling, and refuses anything else without touching the
   record. It reads no other field of the shot, so it cannot infer.

   Slice 5a ships no caller. That is deliberate: declaring a route is a filmmaker's act
   and the surface for it is Slice 5b's. shared-generation-capability.js established the
   same shape — a contract that exists, is exercised by fixtures, and waits for its
   wiring — rather than a field with a writer nobody asked for. */
function declareShotRoute(shot, value) {
  const record = shotRouteRecord(shot);
  if (record !== shot)
    return { ok: false, reading: "absent", route: "", changed: false, reason: "a route can only be declared on a shot record" };
  const route = canonicalShotRoute(value);
  if (!route)
    return {
      ok: false,
      reading: "unrecognised",
      route: "",
      changed: false,
      reason: `${JSON.stringify(shotRouteText(value))} is not one of ${CINEBRAID_SHOT_ROUTES.join(", ")}; the shot's declared route was left unchanged`,
    };
  const changed = shot[CINEBRAID_SHOT_ROUTE_FIELD] !== route;
  shot[CINEBRAID_SHOT_ROUTE_FIELD] = route;
  return { ok: true, reading: "declared", route, changed, reason: "" };
}

/* Undeclaring. The key is DELETED rather than set to "", so a shot that never had a route
   and a shot whose route was withdrawn serialise identically and neither carries a slot
   a later reader could mistake for a decision. */
function clearShotRoute(shot) {
  const record = shotRouteRecord(shot);
  if (record !== shot) return { ok: false, changed: false, reason: "a route can only be cleared from a shot record" };
  if (!Object.prototype.hasOwnProperty.call(shot, CINEBRAID_SHOT_ROUTE_FIELD))
    return { ok: true, changed: false, reason: "" };
  delete shot[CINEBRAID_SHOT_ROUTE_FIELD];
  return { ok: true, changed: true, reason: "" };
}

/* What a FACT RECORD carries. "" for absent and for unrecognised, because a fact record
   states what is true and an unreadable token is not a route. The distinction survives in
   readShotRoute for whoever needs to report it. */
function shotRouteFactValue(shot) {
  return declaredShotRoute(shot);
}

/* route -> generation mode. "" for hybrid and for anything unrecognised. */
function shotRouteGenerationMode(route) {
  const key = canonicalShotRoute(route);
  return key ? CINEBRAID_SHOT_ROUTE_MODES[key] : "";
}

/* generation mode -> route, for the four where CineBraid has established the equivalence.
   Every other mode in CINEBRAID_GENERATION_MODES — `t2i`, `edit`, `video-edit`,
   `audio-video`, `retake`, `v2v`, the audio three — returns "", because a route is a
   statement about a whole shot and those are not. */
function shotRouteFromGenerationMode(mode) {
  const token = shotRouteText(mode).toLowerCase();
  const route = canonicalShotRoute(token);
  return route && route !== "hybrid" && CINEBRAID_SHOT_ROUTE_MODES[route] === token ? route : "";
}

/* The legacy `shot.route` dialect -> route, or "" with the reason it carries none. Kept
   as its own named function rather than folded into canonicalShotRoute, so that a caller
   translating an old output-plan label has to say that is what it is doing. */
function shotRouteFromLegacyOutputRoute(value) {
  const text = shotRouteText(value).toUpperCase();
  if (!text) return { route: "", reason: "no legacy output route was stored" };
  for (const [token, route] of Object.entries(CINEBRAID_SHOT_ROUTE_LEGACY_TOKENS))
    if (text.includes(token)) return { route, reason: "" };
  return {
    route: "",
    reason: `the legacy output route ${JSON.stringify(shotRouteText(value))} names no delivery route`,
  };
}

/* clip.kind -> route. The three motion kinds that are also route tokens map across; the
   frameless and non-generative kinds (`plan`, `post`, `reuse`, `hold`) do not, and `t2v`
   does. This translates ONE unit's kind and says nothing about the shot that contains it:
   a shot's route is declared, never counted up from its clips. */
function shotRouteFromClipKind(kind) {
  const route = canonicalShotRoute(kind);
  return route && route !== "hybrid" ? route : "";
}

/* Bring a value that arrived from outside CineBraid onto the canonical spelling, in
   place, or remove it. Used at the import boundary, where server.js already normalises a
   Project Builder document's clip kinds the same way and warns by name when it drops one.

   `dropped` is returned rather than thrown so the caller can raise its own warning in its
   own words; the record is left with NO route, which is the state that permits nothing. */
function normaliseStoredShotRoute(shot) {
  const reading = readShotRoute(shot);
  if (reading.reading === "absent") {
    /* An explicit null or "" is tidied away so a document from elsewhere cannot leave an
       empty slot behind, but it is not a drop: nothing was declared. */
    const had = shotRouteRecord(shot) === shot && Object.prototype.hasOwnProperty.call(shot, CINEBRAID_SHOT_ROUTE_FIELD);
    if (had) clearShotRoute(shot);
    return { route: "", changed: had, dropped: false, stored: reading.stored, reason: "" };
  }
  if (reading.reading === "unrecognised") {
    clearShotRoute(shot);
    return { route: "", changed: true, dropped: true, stored: reading.stored, reason: reading.reason };
  }
  const changed = shot[CINEBRAID_SHOT_ROUTE_FIELD] !== reading.route;
  shot[CINEBRAID_SHOT_ROUTE_FIELD] = reading.route;
  return { route: reading.route, changed, dropped: false, stored: reading.stored, reason: "" };
}

const SHOT_ROUTE_EXPORTS = {
  CINEBRAID_SHOT_ROUTE_FIELD,
  CINEBRAID_SHOT_ROUTES,
  CINEBRAID_SHOT_ROUTE_READINGS,
  CINEBRAID_SHOT_ROUTE_MODES,
  CINEBRAID_SHOT_ROUTE_LEGACY_TOKENS,
  canonicalShotRoute,
  readShotRoute,
  declaredShotRoute,
  declareShotRoute,
  clearShotRoute,
  shotRouteFactValue,
  shotRouteGenerationMode,
  shotRouteFromGenerationMode,
  shotRouteFromLegacyOutputRoute,
  shotRouteFromClipKind,
  normaliseStoredShotRoute,
};

if (typeof window !== "undefined") Object.assign(window, SHOT_ROUTE_EXPORTS);
if (typeof module !== "undefined" && module.exports) module.exports = SHOT_ROUTE_EXPORTS;
