/* CINEBRAID — declared-entity continuity: shared deterministic core.

   Browser and Node, the same way public/shared-entities.js is shared.

   This is a faithful port of the contract that was qualified on the DGX Spark
   (arm F, "declared_entities_final", 51/51 JSON-valid, 51/51 schema-valid,
   0 missing / 0 undeclared entity ids, 0 truncations). The reference
   implementation is harness/frozen/fin_contract.py in the evaluation tree; the
   raw model output it was qualified against is replayed offline by
   tests/continuity-observation.js.

   Where this file and that reference disagree, the reference wins. The only
   deliberate additions are the ones CineBraid needs and the evaluation had no
   opinion on: building the manifest out of the Project Bible, and treating a
   near-miss free-text intent as human review rather than as intent.

   The model observes ONE image against a production-declared entity list.
   CineBraid compares. Everything here is the CineBraid half: pure, so the same
   inputs always produce a byte-identical result.

   Deliberately absent, and required to stay absent:
     - file or network I/O
     - provider or model awareness
     - Date.now(), new Date(), Math.random()
     - any mutation of the project record passed in */

const CONTINUITY_MANIFEST_VERSION = "continuity-manifest-v1";
const CONTINUITY_OBSERVATION_CONTRACT_VERSION = "declared_entities_final";
const CONTINUITY_COMPARISON_VERSION = "continuity-comparison-v1";

/* ---------- sha-256 ------------------------------------------------------

   A manifest hash must be computable in the browser and in Node, from the same
   code, synchronously. Node's crypto is not in the browser and SubtleCrypto is
   async, so the algorithm is carried here and checked against require("crypto")
   by the manifest suite, including both message-padding boundaries. */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
function rotr32(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  /* FIPS 180-4 padding is minimal: the message, one 0x80 byte, the fewest zero
     bytes that leave room for a 64-bit big-endian bit length. */
  const total = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = data.length * 8;
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(total - 4, bitLength >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let block = 0; block < total; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = (rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((value) => value.toString(16).padStart(8, "0")).join("");
}
/* Canonical JSON: sorted keys, no whitespace. Hashing JSON.stringify() output
   would make the hash depend on key insertion order, which is a property of the
   code that built the object rather than of the data. */
function canonicalJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
}
const MANIFEST_HASH_LENGTH = 20;
function compareStrings(a, b) {
  /* Locale-independent: localeCompare depends on host ICU data, which would
     make the manifest hash machine-dependent. */
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------- the qualified vocabulary -------------------------------------
   Verbatim from fin_contract.py. These are closed enums, not free text: that
   is what makes the comparison exact equality instead of string heuristics. */
const PRESENCE_VALUES = ["present", "absent", "uncertain"];
const OCCLUSION_VALUES = ["none", "partial", "heavy", "uncertain", "not-applicable"];
const IDENTIFIABLE_VALUES = ["yes", "no", "uncertain"];
const MARKINGS_VALUES = ["none", "text", "pattern", "not-applicable", "uncertain"];
const COLOR_VALUES = [
  "black", "white", "grey", "slate", "silver", "cream", "beige", "tan", "brown",
  "red", "maroon", "orange", "amber", "yellow", "gold", "green", "teal", "blue",
  "navy", "purple", "pink", "multicoloured", "not-applicable", "uncertain",
];
const EVIDENCE_MAX = 48;
/* Shade drift is reported separately from a colour change: neighbouring names
   inside a family are a lighting/compression artefact far more often than a
   continuity break. */
const COLOUR_FAMILIES = [
  ["white", "cream", "beige"],
  ["grey", "slate", "silver"],
  ["blue", "navy"],
  ["red", "maroon"],
  ["orange", "amber", "gold"],
  ["green", "teal"],
];
/* Movement is geometric, not textual: centre displacement in normalized units,
   and an area ratio band outside which the reading is treated as unreliable. */
const MOVE_THRESHOLD = 0.02;
const SIZE_RATIO_LO = 0.80;
const SIZE_RATIO_HI = 1.25;
const CONTINUITY_UNITS = ["self", "composite-parent", "child"];

function colourFamily(value) {
  for (let index = 0; index < COLOUR_FAMILIES.length; index++)
    if (COLOUR_FAMILIES[index].includes(value)) return index;
  return null;
}
function sameColourFamily(a, b) {
  const fa = colourFamily(a);
  return fa !== null && fa === colourFamily(b);
}

/* ---------- tracking policy ---------------------------------------------

   colour defaults to FALSE. That is not caution for its own sake: asking for
   one colour on a genuinely multi-tone object produced every false positive
   the qualified benchmark recorded, so a project that has never declared an
   answer must not be able to generate that finding by default. */
const DEFAULT_TRACKING = {
  enabled: true,
  presence: true,
  movement: true,
  color: false,
  state: true,
  markings: false,
  unit: "self",
  parentEntityId: "",
  allowedStateValues: null,
  identityCues: "",
};
const TRACKING_BOOLEAN_KEYS = ["enabled", "presence", "movement", "color", "state", "markings"];
/* identityCues is where a production disambiguates a hard object — "two-tone by
   design, do not report a single colour". The qualified checklist renders one
   identity line per entity, so there is nowhere else for such a note to go. */
const TRACKING_TEXT_KEYS = ["parentEntityId", "identityCues"];
const VISUAL_ENTITY_KINDS = ["character", "location", "prop", "vehicle"];
const ENTITY_KIND_LISTS = { character: "characters", location: "locations", prop: "props", vehicle: "vehicles" };

function cleanText(value, limit = 400) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
}
/* A patch contributes only the keys it actually carries, with the right type.
   An absent key means "inherit", not "false" — otherwise a per-state override
   that only wants to enable colour would silently disable presence. */
function mergeTracking(base, patch) {
  const merged = { ...base, allowedStateValues: base.allowedStateValues ? [...base.allowedStateValues] : null };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return merged;
  for (const key of TRACKING_BOOLEAN_KEYS) if (typeof patch[key] === "boolean") merged[key] = patch[key];
  for (const key of TRACKING_TEXT_KEYS) if (typeof patch[key] === "string") merged[key] = cleanText(patch[key], 240);
  /* "composite" is the spelling the CineBraid design used; the qualified
     contract calls the same thing composite-parent. */
  const unit = patch.unit === "composite" ? "composite-parent" : patch.unit;
  if (CONTINUITY_UNITS.includes(unit)) merged.unit = unit;
  if (Array.isArray(patch.allowedStateValues))
    merged.allowedStateValues = patch.allowedStateValues.map((row) => cleanText(row, 48)).filter(Boolean).slice(0, 24);
  return merged;
}
function resolveEntityTracking(entity, state) {
  return mergeTracking(mergeTracking(DEFAULT_TRACKING, entity && entity.tracking), state && state.tracking);
}

/* ---------- declared shot intent ----------------------------------------
   A missing declaration is {} and means "nothing is declared", never
   "everything is allowed". */
const PRESENCE_ALLOWANCES = ["no", "may-leave", "may-enter", "either"];
const DEFAULT_INTENT = {
  expected: [],
  allowPresenceChange: "no",
  allowMovement: false,
  allowColorChange: false,
  allowStateChange: false,
  note: "",
};
function resolveEntityIntent(shot, entityId) {
  const declared = shot && shot.continuityIntent && typeof shot.continuityIntent === "object"
    ? shot.continuityIntent[entityId]
    : null;
  const intent = { ...DEFAULT_INTENT, expected: [] };
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return intent;
  if (Array.isArray(declared.expected))
    intent.expected = declared.expected.map((row) => cleanText(row, 240)).filter(Boolean).slice(0, 24);
  if (PRESENCE_ALLOWANCES.includes(declared.allowPresenceChange)) intent.allowPresenceChange = declared.allowPresenceChange;
  for (const key of ["allowMovement", "allowColorChange", "allowStateChange"])
    if (typeof declared[key] === "boolean") intent[key] = declared[key];
  if (typeof declared.note === "string") intent.note = cleanText(declared.note, 400);
  return intent;
}

/* ---------- tracked entity manifest --------------------------------------

   Derived on demand, never stored. Rows carry the qualified declaration
   verbatim (snake_case, exactly the fields fin_contract.py reads) plus two
   cb_ annotations CineBraid needs for intent. The cb_ fields are NOT hashed:
   they are never sent to the model, so changing a declared state selection
   must not throw away a valid observation of an unchanged image. */
const OBSERVATION_RELEVANT_FIELDS = [
  "entity_id",
  "display_name",
  "entity_type",
  "parent_entity_id",
  "continuity_unit",
  "identity_cues",
  "allowed_state_values",
  "track_presence",
  "track_movement",
  "track_color",
  "track_state",
  "track_markings",
];

function entityStateRecords(entity) {
  return Array.isArray(entity && entity.continuityStates) ? entity.continuityStates.filter(Boolean) : [];
}
/* Read-only: unlike ensureEntityStateList() in app.js this never repairs the entity,
   because a manifest build must not mutate the project. */
function resolveStateRecord(entity, stateId) {
  const states = entityStateRecords(entity);
  const wanted = stateId ? states.find((state) => String(state.id) === String(stateId)) : null;
  if (wanted) return wanted;
  return states.find((state) => state && state.isDefault) || states[0] || { id: "state-default", name: "Default", notes: "" };
}
/* THE APPROVED REFERENCE ONE STATE ACTUALLY HAS. Read-only, like everything
   else here, and the ONLY owner of the rule.

   A state's approval is its OWN approvedFile. `entity.approvedFile` answers for
   the DEFAULT state and for an entity that declares no states at all, because
   that is the file the default is seeded from and kept synced to; it is the
   default's image and it cannot answer for "rain-soaked". Without that
   distinction a declared non-default state with no reference of its own
   silently reports the default's, so a request for rain-soaked Rhea is served
   clean Rhea — the substitution this function exists to make impossible.

   MISSING IS AN ANSWER. "" means no authority, and every caller must be able to
   act on that rather than receive a plausible wrong image. Manufacturing one,
   here or in a caller, is the defect.

   `state` is a RECORD from this entity's own catalogue, never a bare id: state
   ids are owner-scoped and twelve entities in the real corpus all declare
   `state-default`. Resolving the id is the caller's job (resolveStateRecord()
   here, entityStateById() in the browser); this answers only the file question.

   The rule is not new — public/automation.js has read parent states this way
   since state chains existed, and PR #58 named it there. It lives here now so
   the browser preflight, the browser reference package and server.js's
   authority selection cannot hold three copies that drift. */
function stateApprovedFile(entity, state) {
  if (!entity) return "";
  if (!state) return String(entity.approvedFile || "");
  if (state.isDefault) return String(state.approvedFile || entity.approvedFile || "");
  return String(state.approvedFile || "");
}
/* frame-level selection, then shot-level, then the entity default.

   P4-SEM-B: the precedence itself is no longer stated here. It is one canonical
   contract in public/shared-continuity-binding.js, which the OFP `continuity`
   profile, the migration rule and the frame's design-authority selection all
   resolve through as well - so a project cannot declare one state and generate
   against another. This function keeps its signature and its exact meaning; it
   is now the runtime ENTRY POINT to the rule rather than a second copy of it.

   `kind` survives because a bare `locationStateId` on a frame record carries no
   entity of its own, and the caller asking about a location entity is what says
   which entity it belongs to. */
function continuityBindingContract() {
  if (typeof readShotStateBindings === "function" && typeof resolveBoundStateId === "function")
    return { readShotStateBindings, resolveBoundStateId };
  const global = typeof globalThis !== "undefined" ? globalThis : {};
  if (typeof global.readShotStateBindings === "function" && typeof global.resolveBoundStateId === "function")
    return { readShotStateBindings: global.readShotStateBindings, resolveBoundStateId: global.resolveBoundStateId };
  return null;
}
function resolveDeclaredStateId(shot, frameId, kind, entityId) {
  const contract = continuityBindingContract();
  /* Loud rather than silently unresolved. A missing contract means the shared
     module did not load, and returning "" would look exactly like "this shot
     declares nothing" while quietly generating against the wrong state. */
  if (!contract) throw new Error("shared-continuity-binding.js must load before shared-continuity.js: the declared-state precedence lives there");
  const bindings = contract.readShotStateBindings(shot, {
    locationEntityId: kind === "location" ? String(entityId || "") : "",
  });
  return contract.resolveBoundStateId(bindings, frameId, entityId);
}
/* One short sentence naming the object, not the full canon block: the
   qualified checklist gives the model an identity cue, not a design brief. */
function entityIdentityCues(entity, tracking) {
  if (tracking.identityCues) return tracking.identityCues;
  return cleanText(entity.creationDescription || entity.description || entity.block || entity.notes || "", 240);
}
/* The state vocabulary the model may answer with. Production's explicit list
   wins; otherwise the entity's own declared continuity states are the natural
   vocabulary, which is what makes CineBraid's Bible the authority. */
function entityAllowedStateValues(entity, tracking) {
  if (Array.isArray(tracking.allowedStateValues)) return tracking.allowedStateValues.length ? tracking.allowedStateValues : null;
  if (!tracking.state) return null;
  const names = entityStateRecords(entity)
    .map((state) => cleanText(state.name || "", 48))
    .filter(Boolean);
  const unique = [...new Set(names)].sort(compareStrings);
  return unique.length > 1 ? unique : null;
}

function buildContinuityManifest(project, shot, frameId = "") {
  const P = project && typeof project === "object" ? project : {};
  const s = shot && typeof shot === "object" ? shot : {};
  const records = resolveDependencyRecords(P, s);
  const entities = [];
  const seen = new Set();
  for (const record of records) {
    if (!record || !record.resolved || !record.entity) continue;
    if (!VISUAL_ENTITY_KINDS.includes(record.type)) continue;
    const entity = record.entity;
    const entityId = String(entity.id || "");
    if (!entityId || seen.has(entityId)) continue;
    const stateId = resolveDeclaredStateId(s, frameId, record.type, entityId);
    const state = resolveStateRecord(entity, stateId);
    const tracking = resolveEntityTracking(entity, state);
    if (tracking.enabled === false) continue;
    seen.add(entityId);
    entities.push({
      entity_id: entityId,
      display_name: cleanText(entity.name || entityId, 160),
      entity_type: record.type,
      parent_entity_id: tracking.parentEntityId || null,
      continuity_unit: tracking.unit,
      identity_cues: entityIdentityCues(entity, tracking),
      allowed_state_values: entityAllowedStateValues(entity, tracking),
      track_presence: tracking.presence !== false,
      track_movement: tracking.movement !== false,
      track_color: tracking.color === true,
      track_state: tracking.state !== false,
      track_markings: tracking.markings === true,
      /* CineBraid-side annotations. Never sent, never hashed. */
      cb_declared_state_id: String(state.id || "state-default"),
      cb_declared_state_name: cleanText(state.name || "Default", 160),
    });
  }
  entities.sort((a, b) => compareStrings(a.entity_id, b.entity_id));
  const hashPayload = entities.map((row) => {
    const picked = {};
    for (const field of OBSERVATION_RELEVANT_FIELDS) picked[field] = row[field];
    return picked;
  });
  return {
    manifestVersion: CONTINUITY_MANIFEST_VERSION,
    contractVersion: CONTINUITY_OBSERVATION_CONTRACT_VERSION,
    shotId: String(s.id || ""),
    frameId: String(frameId || ""),
    n: entities.length,
    entities,
    manifestHash: sha256Hex(CONTINUITY_OBSERVATION_CONTRACT_VERSION + "\n" + canonicalJson(hashPayload)).slice(0, MANIFEST_HASH_LENGTH),
  };
}
function resolveDependencyRecords(project, shot) {
  const fn = typeof shotDependencyRecords === "function"
    ? shotDependencyRecords
    : (typeof globalThis !== "undefined" && typeof globalThis.shotDependencyRecords === "function"
      ? globalThis.shotDependencyRecords
      : null);
  return fn ? (fn(project, shot) || []) : [];
}

/* ---------- observation schema -------------------------------------------

   Generated per manifest, because that is what makes the guarantees
   structural rather than hopeful: `entities` is a closed object whose keys are
   exactly the declared entity ids and whose `required` names every one of
   them. The model cannot invent an entity, omit an entity, duplicate an
   entity, or split one into parts, because the grammar has no room for it.

   No oneOf anywhere: it caused constrained-decoding whitespace loops and
   truncations on the qualified vLLM path. bbox uses anyOf, which did not. */
function entityRecordSchema(entity) {
  const states = [...(Array.isArray(entity.allowed_state_values) ? entity.allowed_state_values : []), "not-applicable", "uncertain"];
  return {
    type: "object",
    additionalProperties: false,
    required: ["presence", "occlusion", "identifiable", "bbox", "color", "state", "markings", "evidence"],
    properties: {
      presence: { type: "string", enum: PRESENCE_VALUES },
      occlusion: { type: "string", enum: OCCLUSION_VALUES },
      identifiable: { type: "string", enum: IDENTIFIABLE_VALUES },
      bbox: {
        anyOf: [
          { type: "array", minItems: 4, maxItems: 4, items: { type: "integer", minimum: 0, maximum: 1000 } },
          { type: "null" },
        ],
      },
      color: { type: "string", enum: COLOR_VALUES },
      state: { type: "string", enum: states },
      markings: { type: "string", enum: MARKINGS_VALUES },
      evidence: { type: "string", maxLength: EVIDENCE_MAX },
    },
  };
}
function buildObservationSchema(manifest) {
  const properties = {};
  for (const entity of (manifest && manifest.entities) || []) properties[entity.entity_id] = entityRecordSchema(entity);
  return {
    type: "object",
    additionalProperties: false,
    required: ["coordinate_mode", "entities"],
    properties: {
      coordinate_mode: { type: "string", enum: ["permille"] },
      entities: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(properties).sort(compareStrings),
        properties,
      },
    },
  };
}

/* ---------- observation prompt -------------------------------------------

   A verbatim port of fin_contract.build_prompt(). This wording is part of the
   qualified system, not decoration: the anti-confirmation-bias framing is what
   stops the model treating a checklist as evidence, and the three-shape
   summary is what keeps records inside the grammar. It must not be reworded,
   restyled or merged with CineBraid's other review prompts.

   tests/continuity-prompt-contract.js asserts byte identity against the system
   prompts recorded in the qualification's own request bodies. */
const OBSERVATION_PROMPT_VERSION = "arm-F-anti-confirmation-bias";
const OBSERVATION_USER_MESSAGE = "Check each declared entity against this frame.";

/* Entities are rendered in the order the manifest declares them. CineBraid's
   builder sorts by entity id, so its own manifests render sorted; the frozen
   reference manifests render in their own order. Both reproduce exactly. */
function observationChecklist(manifest) {
  const lines = [];
  for (const entity of (manifest && manifest.entities) || []) {
    const block = [`- ${entity.entity_id} ("${entity.display_name}", ${entity.entity_type})`];
    if (entity.parent_entity_id) block.push(`  worn by / part of: ${entity.parent_entity_id}`);
    if (entity.continuity_unit === "composite-parent") block.push("  COMPOSITE: report as ONE record covering the whole unit.");
    if (entity.continuity_unit === "child") block.push("  CHILD: a distinct tracked part of its parent.");
    block.push(`  ${entity.identity_cues}`);
    lines.push(block.join("\n"));
  }
  return lines.join("\n");
}
function buildObservationPrompt(manifest) {
  const system = `You are shown EXACTLY ONE photographic frame from a film set.

The production has asked you to CHECK each declared entity below. This list is a
CHECKLIST, not evidence. Declaration does NOT mean the entity is present. An entity may be
completely absent from this frame. Report presence:"absent" whenever the visible pixels do
not support it. Never infer presence merely because an entity id appears in the checklist.

You have not been shown any other image. Do not use comparative language.

THE CHECKLIST FOR THIS SET:
${observationChecklist(manifest)}

How to answer:
- Use ONLY the visible pixels of this frame.
- Do not infer hidden, off-screen or previously visible entities from scene context or from
  what would normally be there.
- Do NOT assume worn accessories are still present. A watch, ring or badge may have been
  removed between shots. Check the pixels.
- A declared entity that was removed between shots MUST be reported absent, even though it
  is still on the checklist.
- Never fabricate a bounding box for an absent entity.

PRESENCE AND OCCLUSION ARE DIFFERENT QUESTIONS. Answer them separately.
  presence  - do the visible pixels support this entity being in the frame at all?
              present | absent | uncertain
  occlusion - for an entity that IS present, how much of it is covered by something in
              front of it?  none | partial | heavy | uncertain
              For an absent entity, occlusion is "not-applicable".

Each record must be exactly one of three shapes:
  PRESENT    presence:"present",  occlusion: none | partial | heavy | uncertain,
             bbox: four integers.
  ABSENT     presence:"absent",   occlusion:"not-applicable", bbox: null,
             identifiable: no | uncertain.
  UNCERTAIN  presence:"uncertain", occlusion:"uncertain", identifiable:"uncertain",
             bbox: four integers only if you can localise a possible remnant, else null.

coordinate_mode is always "permille". bbox is EXACTLY FOUR INTEGERS from 0 to 1000, in the
order [x0, y0, x1, y1], as thousandths of the image width and height.

identifiable describes whether you could tell what it is from the visible evidence alone.
evidence is a short factual note about what you can actually see, at most ${EVIDENCE_MAX}
characters.
If an attribute cannot be read from the pixels use "uncertain"; if it does not apply use
"not-applicable". Never guess hidden content.`;
  return { system, user: OBSERVATION_USER_MESSAGE };
}

/* ---------- qualified request contract -----------------------------------

   The sampling and decoding settings the 51/51 run was qualified at. They are
   part of the contract, not user preferences: a director changing the general
   assistant temperature must not silently invalidate continuity
   qualification. The provider layer applies these AFTER any configured
   generic options so they always win. */
const OBSERVATION_REQUEST_CONTRACT = Object.freeze({
  temperature: 0.2,
  top_k: 1,
  max_tokens: 4096,
  stream: false,
  chat_template_kwargs: Object.freeze({ enable_thinking: false }),
});
const OBSERVATION_SCHEMA_NAME = "declared_entities_final";

/* ---------- deterministic post-validation --------------------------------

   recordState is the qualified three-shape check. It classifies and never
   coerces: a record that does not match one of the three legal shapes is
   invalid, and an invalid record is excluded from automatic verdicts rather
   than repaired into a confident-looking answer. */
function bboxIsValid(bbox) {
  return Array.isArray(bbox) && bbox.length === 4 && bbox.every((value) => Number.isInteger(value) && value >= 0 && value <= 1000);
}
function recordState(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "invalid";
  const { presence, occlusion, identifiable, bbox } = record;
  const boxOk = bboxIsValid(bbox);
  if (presence === "present")
    return ["none", "partial", "heavy", "uncertain"].includes(occlusion) && boxOk ? "present" : "invalid";
  if (presence === "absent")
    return occlusion === "not-applicable" && bbox === null && ["no", "uncertain"].includes(identifiable) ? "absent" : "invalid";
  if (presence === "uncertain")
    return occlusion === "uncertain" && identifiable === "uncertain" && (bbox === null || boxOk) ? "uncertain" : "invalid";
  return "invalid";
}
const OBSERVATION_FLAGS = [
  "malformed_response",
  "missing_entity_id",
  "undeclared_entity_id",
  "invalid_coordinate_mode",
  "invalid_record_shape",
  "invalid_enum",
  "untracked_attribute_discarded",
];
/* How far a flag reaches. `ok` answers "did this response need any handling at
   all", which is the right question for qualification metrics and the wrong one
   for a UI: a deterministic policy action makes ok false while leaving the
   evidence perfectly good.

   policy  CineBraid did something deliberate and safe. The evidence stands.
   entity  This one record cannot be trusted. Phase 1 already excludes it from
           automatic verdicts and routes it to human review; the rest of the
           set is untouched.
   set     The whole response cannot be trusted, so no record in it can be.
           Both of these are unreachable while constrained decoding is working:
           coordinate_mode is a single-value enum and entities is a closed
           object, so seeing them means the grammar did not hold. */
const OBSERVATION_FLAG_SCOPE = {
  untracked_attribute_discarded: "policy",
  missing_entity_id: "entity",
  undeclared_entity_id: "entity",
  invalid_record_shape: "entity",
  invalid_enum: "entity",
  malformed_response: "set",
  /* Every bbox in the response is read as permille. A different coordinate
     frame silently corrupts movement and size for every entity at once, so it
     poisons the set rather than one record. */
  invalid_coordinate_mode: "set",
};
const OBSERVATION_STATUSES = ["clean", "usable_with_notes", "invalid"];

/* Whether the RECORD SET is safe to use. Deliberately not a continuity verdict:
   it says nothing about pass/fail, about occlusion, or about whether a change
   was intended. A heavily occluded or uncertain observation is a truthful
   answer and is usable — the comparison layer is what routes it to review. */
function observationStatus(flags, states) {
  const codes = (Array.isArray(flags) ? flags : []).map((flag) => flag && flag.code).filter(Boolean);
  const stateValues = Object.values(states && typeof states === "object" ? states : {});
  const poisoned = codes.some((code) => OBSERVATION_FLAG_SCOPE[code] === "set");
  /* Nothing left to use is also unusable, however it happened. */
  const nothingUsable = stateValues.length > 0 && stateValues.every((value) => value === "invalid");
  if (poisoned || nothingUsable) return "invalid";
  return codes.length ? "usable_with_notes" : "clean";
}
function validateObservationSet(manifest, parsed) {
  const declared = ((manifest && manifest.entities) || []);
  const flags = [];
  const addFlag = (code, entityId, field, detail) => flags.push({ code, entityId: String(entityId || ""), field: String(field || ""), detail: String(detail || "") });
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  const supplied = root && root.entities && typeof root.entities === "object" && !Array.isArray(root.entities) ? root.entities : null;
  if (!supplied) addFlag("malformed_response", "", "", "The response did not contain an entities object.");
  if (root && root.coordinate_mode !== undefined && root.coordinate_mode !== "permille")
    addFlag("invalid_coordinate_mode", "", "coordinate_mode", `coordinate_mode was ${JSON.stringify(root.coordinate_mode)}; the contract is "permille".`);

  const declaredIds = new Set(declared.map((row) => row.entity_id));
  for (const key of supplied ? Object.keys(supplied).sort(compareStrings) : [])
    if (!declaredIds.has(key)) addFlag("undeclared_entity_id", key, "", "The model returned an entity id production did not declare.");

  const entities = {};
  const states = {};
  for (const row of declared) {
    const id = row.entity_id;
    const raw = supplied ? supplied[id] : undefined;
    if (raw === undefined || raw === null) {
      addFlag("missing_entity_id", id, "", "The model returned no record for this declared entity.");
      entities[id] = { presence: "uncertain", occlusion: "uncertain", identifiable: "uncertain", bbox: null, color: "uncertain", state: "uncertain", markings: "uncertain", evidence: "" };
      states[id] = "invalid";
      continue;
    }
    const record = {
      presence: raw.presence,
      occlusion: raw.occlusion,
      identifiable: raw.identifiable,
      bbox: raw.bbox === undefined ? null : raw.bbox,
      color: raw.color,
      state: raw.state,
      markings: raw.markings,
      evidence: typeof raw.evidence === "string" ? raw.evidence.slice(0, EVIDENCE_MAX) : "",
    };
    /* Structural fields are always meaningful: recordState reads them, so an
       illegal value here makes the whole record untrustworthy. */
    for (const [field, values] of [["presence", PRESENCE_VALUES], ["occlusion", OCCLUSION_VALUES], ["identifiable", IDENTIFIABLE_VALUES]])
      if (!values.includes(record[field])) addFlag("invalid_enum", id, field, `${field} was ${JSON.stringify(record[field])}, which is not a contract value.`);

    /* Tracked attributes. Two different things can go wrong here and they mean
       different things, so they are kept apart:

         not tracked   CineBraid never asked, so whatever came back is
                       irrelevant. It is discarded to "not-applicable" and the
                       comparison never looks at it. A policy note.

         tracked but illegal   CineBraid did ask, and the answer is unusable.
                       The value is NOT coerced and NOT guessed at: it is
                       neutralised to "uncertain", which is the contract's own
                       word for "could not be read". The comparison then reports
                       it as an unreadable attribute and routes it to review,
                       which is exactly right — an illegal value must never be
                       able to become a colour, markings or state CHANGE.

       Neutralising one attribute leaves the rest of the record alone: presence
       and bbox evidence on the same entity stay usable, and other entities are
       untouched. */
    for (const [field, track, values] of [
      ["color", "track_color", COLOR_VALUES],
      ["state", "track_state", [...(Array.isArray(row.allowed_state_values) ? row.allowed_state_values : []), "not-applicable", "uncertain"]],
      ["markings", "track_markings", MARKINGS_VALUES],
    ]) {
      if (row[track] === false) {
        if (record[field] !== "not-applicable" && record[field] !== undefined) {
          addFlag("untracked_attribute_discarded", id, field, `${field} was returned but is not tracked for this entity; the value was discarded.`);
          record[field] = "not-applicable";
        }
        continue;
      }
      if (!values.includes(record[field])) {
        addFlag("invalid_enum", id, field, `${field} was ${JSON.stringify(record[field])}, which is not a contract value for this entity; it was treated as unreadable and never compared.`);
        record[field] = "uncertain";
      }
    }
    const state = recordState(record);
    if (state === "invalid") addFlag("invalid_record_shape", id, `The record does not match a legal present/absent/uncertain shape (presence=${JSON.stringify(record.presence)}, occlusion=${JSON.stringify(record.occlusion)}, bbox=${record.bbox === null ? "null" : JSON.stringify(record.bbox)}).`);
    entities[id] = record;
    states[id] = state;
  }

  flags.sort((a, b) => compareStrings(a.entityId, b.entityId) || compareStrings(a.code, b.code) || compareStrings(a.detail, b.detail));
  const status = observationStatus(flags, states);
  return {
    contractVersion: CONTINUITY_OBSERVATION_CONTRACT_VERSION,
    manifestHash: String((manifest && manifest.manifestHash) || ""),
    /* Unchanged meaning, kept for compatibility and for the qualification
       metrics: the response needed no handling of any kind. */
    ok: flags.length === 0,
    /* Whether the record set is safe to use. This is the question a caller
       almost always means, and the one ok answers badly. */
    status,
    usable: status !== "invalid",
    blockingFlags: [...new Set(flags.filter((flag) => OBSERVATION_FLAG_SCOPE[flag.code] === "set").map((flag) => flag.code))].sort(compareStrings),
    flags,
    coordinate_mode: "permille",
    entities,
    states,
    invalidEntityIds: Object.keys(states).filter((id) => states[id] === "invalid").sort(compareStrings),
  };
}

/* ---------- comparison engine --------------------------------------------
   Pure, O(n), indexed by stable entity id. No geometry matching, no model, no
   clock. A direct port of fin_contract.compare(). */
function bboxCentre(box) {
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}
function bboxArea(box) {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}
function bboxNormalize(box) {
  return box ? box.map((value) => value / 1000) : null;
}
function compareObservations(sideA, sideB, manifest, options = {}) {
  const cameraLocked = options.cameraLocked !== false;
  const rows = ((manifest && manifest.entities) || []).slice().sort((a, b) => compareStrings(a.entity_id, b.entity_id));
  const A = (sideA && sideA.entities) || {};
  const B = (sideB && sideB.entities) || {};
  const statesA = (sideA && sideA.states) || {};
  const statesB = (sideB && sideB.states) || {};
  const changes = [], uncertain = [], shadeDrift = [], attributeUnreadable = [], presenceUncertain = [], invalidRecords = [];

  for (const declaration of rows) {
    const id = declaration.entity_id;
    const a = A[id];
    const b = B[id];
    const displayName = declaration.display_name;
    if (a === undefined || b === undefined) {
      uncertain.push({ entity_id: id, kind: "missing-record", display_name: displayName });
      continue;
    }
    const sa = statesA[id] || recordState(a);
    const sb = statesB[id] || recordState(b);
    if (sa === "invalid" || sb === "invalid") {
      invalidRecords.push({ entity_id: id, kind: "entity-record-invalid", state_a: sa, state_b: sb, display_name: displayName });
      continue;
    }
    if (sa === "uncertain" || sb === "uncertain")
      presenceUncertain.push({ entity_id: id, kind: "presence-uncertain", value_a: a.presence, value_b: b.presence, display_name: displayName });
    else if (declaration.track_presence && sa !== sb)
      changes.push({ entity_id: id, kind: sb === "absent" ? "removed" : "added", attribute: "presence", value_a: a.presence, value_b: b.presence, display_name: displayName });

    if (sa === "present" && sb === "present") {
      if (a.identifiable !== "yes" || b.identifiable !== "yes")
        uncertain.push({ entity_id: id, kind: "identifiability", value_a: a.identifiable, value_b: b.identifiable, display_name: displayName });
      /* An occlusion transition is not a change, it is a reason the reading
         may not be comparable. It goes to human review either way. */
      if (a.occlusion !== b.occlusion)
        uncertain.push({ entity_id: id, kind: "occlusion-transition", value_a: a.occlusion, value_b: b.occlusion, display_name: displayName });
      for (const [attribute, track] of [["color", "track_color"], ["state", "track_state"], ["markings", "track_markings"]]) {
        if (!declaration[track]) continue;
        const ca = a[attribute];
        const cb = b[attribute];
        if (ca === cb) continue;
        const base = { entity_id: id, attribute, value_a: ca, value_b: cb, display_name: displayName };
        if (ca === "uncertain" || cb === "uncertain") attributeUnreadable.push({ ...base, kind: "attribute-unreadable" });
        else if (ca === "not-applicable" || cb === "not-applicable") attributeUnreadable.push({ ...base, kind: "attribute-not-applicable" });
        else if (attribute === "color" && sameColourFamily(ca, cb)) shadeDrift.push({ ...base, kind: "shade-drift" });
        else changes.push({ ...base, kind: "attribute" });
      }
      const na = bboxNormalize(a.bbox);
      const nb = bboxNormalize(b.bbox);
      const [ax, ay] = bboxCentre(na);
      const [bx, by] = bboxCentre(nb);
      const distance = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
      const areaA = bboxArea(na);
      const areaB = bboxArea(nb);
      const ratio = Math.max(areaA, areaB) > 0 ? Math.min(areaA, areaB) / Math.max(areaA, areaB) : 1;
      /* Movement is only meaningful when the camera did not move. Camera and
         framing continuity is a separate instrument that does not exist yet,
         so an unlocked camera simply suppresses the movement finding. */
      if (declaration.track_movement && cameraLocked && distance > MOVE_THRESHOLD)
        changes.push({ entity_id: id, kind: "moved", attribute: "centre_displacement", distance: Math.round(distance * 10000) / 10000, display_name: displayName });
      if (!(ratio >= SIZE_RATIO_LO && ratio <= SIZE_RATIO_HI))
        uncertain.push({ entity_id: id, kind: "size", ratio: Math.round(ratio * 1000) / 1000, display_name: displayName });
    }
  }
  return {
    comparisonVersion: CONTINUITY_COMPARISON_VERSION,
    changes, uncertain, shade_drift: shadeDrift,
    attribute_unreadable: attributeUnreadable,
    presence_uncertain: presenceUncertain,
    invalid_records: invalidRecords,
    n_entities: rows.length,
  };
}

/* ---------- declared intent ----------------------------------------------

   A visual change is not automatically a continuity error, and the model is
   never asked whether one was intended: CineBraid already knows. Intent is
   matched structurally against the finding's kind/attribute/entity, not by
   reading prose about it.

   Free text is supported because productions write in prose, but it is
   deliberately constrained: the entity must be named AND a keyword for that
   kind of change must appear. A near miss — the entity is named but the change
   described is a different one — does NOT pass. It forces human review, so a
   vague note can never silently approve a real break. */
const INTENT_KEYWORDS = {
  removed: ["remove", "removes", "removed", "removing", "leave", "leaves", "left", "exit", "exits", "take away", "takes away", "taken away", "put away", "puts away", "gone", "picks up", "pick up", "picked up", "carried off"],
  added: ["enter", "enters", "entered", "arrive", "arrives", "arrived", "bring", "brings", "brought", "appear", "appears", "appeared", "set down", "sets down", "place", "places", "placed", "put down", "puts down", "added"],
  moved: ["move", "moves", "moved", "shift", "shifts", "shifted", "reposition", "repositions", "slide", "slides", "picks up", "pick up", "sets down", "set down", "put down", "puts down", "hands", "passes"],
  color: ["colour", "color", "colours", "colors", "recolour", "recolor", "repaint", "repainted", "stained", "dyed"],
  state: ["change", "changes", "changed", "state", "become", "becomes", "became", "switch", "switches", "torn", "dirty", "wet", "open", "opens", "closed", "closes"],
  markings: ["marking", "markings", "label", "logo", "text", "pattern", "printed"],
};
function normalizeIntentText(value) {
  return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function findingKeywordBucket(finding) {
  if (finding.kind === "removed" || finding.kind === "added" || finding.kind === "moved") return finding.kind;
  return finding.attribute;
}
/* Declared allowances and structural state changes become descriptors of the
   same shape, so matching stays one deterministic comparison. */
function buildIntentDescriptors(shot, manifestA, manifestB) {
  const descriptors = [];
  const byIdA = new Map(((manifestA && manifestA.entities) || []).map((row) => [row.entity_id, row]));
  const byIdB = new Map(((manifestB && manifestB.entities) || []).map((row) => [row.entity_id, row]));
  for (const id of [...byIdA.keys()].sort(compareStrings)) {
    const a = byIdA.get(id);
    const b = byIdB.get(id);
    /* 1. Structural: production declared a different continuity state for the
          two frames. No text matching, the strongest available signal. */
    if (b && a.cb_declared_state_id !== b.cb_declared_state_id)
      descriptors.push({ kind: "attribute", attribute: "state", entity_ids: [id], source: "declared-state-change", reason: `Declared state changed from "${a.cb_declared_state_name}" to "${b.cb_declared_state_name}".` });
    /* 2. Explicit per-entity allowances. */
    const intent = resolveEntityIntent(shot, id);
    if (intent.allowPresenceChange === "may-leave" || intent.allowPresenceChange === "either")
      descriptors.push({ kind: "removed", attribute: "presence", entity_ids: [id], source: "allowance", reason: "This shot declares the entity may leave." });
    if (intent.allowPresenceChange === "may-enter" || intent.allowPresenceChange === "either")
      descriptors.push({ kind: "added", attribute: "presence", entity_ids: [id], source: "allowance", reason: "This shot declares the entity may enter." });
    if (intent.allowMovement)
      descriptors.push({ kind: "moved", attribute: "centre_displacement", entity_ids: [id], source: "allowance", reason: "This shot declares the entity may move." });
    if (intent.allowColorChange)
      descriptors.push({ kind: "attribute", attribute: "color", entity_ids: [id], source: "allowance", reason: "This shot declares the entity's colour may change." });
    if (intent.allowStateChange)
      descriptors.push({ kind: "attribute", attribute: "state", entity_ids: [id], source: "allowance", reason: "This shot declares the entity's state may change." });
  }
  return descriptors;
}
function matchesDescriptor(finding, descriptor) {
  if (descriptor.kind !== finding.kind) return false;
  if (descriptor.attribute !== undefined && descriptor.attribute !== null && descriptor.attribute !== finding.attribute) return false;
  if (Array.isArray(descriptor.entity_ids) && !descriptor.entity_ids.includes(finding.entity_id)) return false;
  if (descriptor.value_b !== undefined && descriptor.value_b !== null && descriptor.value_b !== finding.value_b) return false;
  return true;
}
/* Returns "matched" | "near-miss" | null for the human-authored prose. */
function expectedTextVerdict(finding, declaration, intent) {
  const tokens = [finding.entity_id, declaration && declaration.display_name].map(normalizeIntentText).filter(Boolean);
  const bucket = findingKeywordBucket(finding);
  const keywords = (INTENT_KEYWORDS[bucket] || []).map(normalizeIntentText);
  let nearMiss = null;
  for (const phrase of intent.expected) {
    const normalized = normalizeIntentText(phrase);
    if (!normalized || !tokens.some((token) => token && normalized.includes(token))) continue;
    if (keywords.some((keyword) => normalized.includes(keyword))) return { verdict: "matched", phrase };
    if (!nearMiss) nearMiss = phrase;
  }
  return nearMiss ? { verdict: "near-miss", phrase: nearMiss } : null;
}

/* Port of fin_contract.classify(), plus CineBraid's near-miss rule and the
   per-finding provenance the UI will need. Expected findings stay VISIBLE:
   they are relabelled, never removed. */
function applyIntent(comparison, context = {}) {
  const shot = context.shot || null;
  const manifestA = context.manifestA || context.manifest || null;
  const manifestB = context.manifestB || context.manifest || null;
  const declarations = new Map(((manifestA && manifestA.entities) || []).map((row) => [row.entity_id, row]));
  const humanIntentional = context.humanIntentional && typeof context.humanIntentional === "object" ? context.humanIntentional : {};
  const descriptors = [...buildIntentDescriptors(shot, manifestA, manifestB), ...(Array.isArray(context.descriptors) ? context.descriptors : [])];

  let nearMissCount = 0;
  const changes = comparison.changes.map((finding) => {
    const declaration = declarations.get(finding.entity_id) || null;
    const intent = resolveEntityIntent(shot, finding.entity_id);
    const descriptor = descriptors.find((row) => matchesDescriptor(finding, row));
    if (descriptor)
      return { ...finding, label: "intended", intentSource: descriptor.source || "descriptor", intentReason: descriptor.reason || "" };
    const text = expectedTextVerdict(finding, declaration, intent);
    if (text && text.verdict === "matched")
      return { ...finding, label: "intended", intentSource: "expected-text", intentReason: `Matched declared expected change: "${text.phrase}".` };
    if (text && text.verdict === "near-miss") {
      nearMissCount += 1;
      return { ...finding, label: "possible-continuity-error", intentSource: "near-miss", intentReason: `An expected change mentions this entity but does not describe this kind of change: "${text.phrase}".` };
    }
    if (humanIntentional[`${finding.entity_id}:${finding.kind}:${finding.attribute || ""}`] === true)
      return { ...finding, label: "intended", intentSource: "human", intentReason: "A person marked this difference intentional." };
    return { ...finding, label: "possible-continuity-error", intentSource: null, intentReason: "" };
  });

  const content = !changes.length
    ? "no-change"
    : changes.some((row) => row.label === "possible-continuity-error") ? "possible-continuity-error" : "intended";
  /* The human-review floor. Nothing in this core can auto-pass heavy or
     unreadable occlusion, an uncertain presence, an unreadable tracked
     attribute, an invalid record, or a near-miss intent note. */
  const needsReview = !!(comparison.uncertain.length
    || comparison.attribute_unreadable.length
    || comparison.presence_uncertain.length
    || comparison.invalid_records.length
    || nearMissCount
    || context.designatedOcclusion === true);
  return {
    ...comparison,
    changes,
    label: needsReview ? "human-review" : content,
    content,
    needsReview,
    nearMissIntentCount: nearMissCount,
    intentDescriptors: descriptors,
  };
}

/* ---------- presentation semantics ---------------------------------------

   Phase 4 puts continuity in front of a user, and the rule that keeps it
   trustworthy is that the UI renders a verdict it was given rather than
   deriving one. Every judgement below is a restatement of a finding the Phase 1
   engine already produced: which bucket it came out of, and what applyIntent
   labelled it. Nothing here reads a validation flag code, a bbox, an enum or a
   raw model note, and nothing here can turn one class of finding into another.

   Deliberately here rather than in the browser: the same function has to answer
   for the offline suites, so a rendered word can be asserted without a DOM. */
const CONTINUITY_OUTCOMES = ["stable", "issue", "expected", "uncertain", "review"];
/* Worst first. An entity shows the single outcome that most needs a person. */
const OUTCOME_RANK = { review: 4, issue: 3, uncertain: 2, expected: 1, stable: 0 };
const CONTINUITY_OUTCOME_LABELS = {
  stable: "STABLE",
  issue: "ISSUE",
  expected: "EXPECTED",
  uncertain: "UNCERTAIN",
  review: "REVIEW",
};

/* ==========================================================================
   DID THE CORRECTION ACTUALLY MAKE IT BETTER?

   The founder smoke ran Fix Continuity on an already-approved Frame B, got back
   a replacement that was visibly worse AND still failed continuity, and CineBraid
   presented it as APPROVE SUGGESTED — because `winner` was "highest score in this
   pass", a ranking among the correction's own candidates that never once looked at
   the thing it was supposed to improve.

   A correction is a CLAIM ABOUT A COMPARISON, so it is judged as one. The approved
   original is scored by the SAME reviewer, against the SAME stated failure and
   required repair, with the SAME adjacent shots in frame — so the baseline means
   "what this exact question scores when nothing was changed". A candidate above it
   improved; a candidate below it damaged something the repair was not asked to
   touch; a candidate level with it did nothing.

   THREE RULES THIS ENCODES:
     - Worse than the original is a REGRESSION even if the reviewer passed it.
     - Passing the review is necessary for improvement and not sufficient: a repair
       that scores no better than the untouched original has not improved it, and
       resolving that contradiction in the correction's favour is what shipped a
       worse frame as the fix.
     - No baseline means NOT COMPARABLE, never "fine". Fail closed.

   `recommendableCorrection` is the only clause that matters at the gate: nothing
   but a proven improvement may ever be offered as the fix. This decides nothing
   about approval — a person still approves, and may still choose a candidate this
   function calls a regression, knowing that is what it is. */
const CORRECTION_OUTCOMES = ["improvement", "no-improvement", "regression", "unknown"];
const CORRECTION_OUTCOME_LABELS = {
  improvement: "IMPROVEMENT",
  "no-improvement": "NO IMPROVEMENT",
  regression: "REGRESSION",
  unknown: "NOT COMPARABLE",
};
/* Scores come from a vision model, so a point or two is noise rather than a
   finding. Three is the band inside which the two images are called equal. */
const CORRECTION_SCORE_MARGIN = 3;
/* A SCORE, OR NOTHING. NEVER A COERCION.
 *
 * This was `Number(row.score)` behind a `Number.isFinite` check, which reads as
 * strict and is not: `Number(null)`, `Number("")`, `Number("  ")` and `Number([])`
 * are all 0, and 0 is finite. Independent review reproduced the consequence — an
 * approved original recorded as `{ available: true, score: null }` became a
 * baseline of ZERO, and an 80-point challenger against it was classified a
 * demonstrated improvement and offered as the fix. The exact fail-open this
 * classifier exists to prevent, arriving through the arithmetic instead of the
 * logic.
 *
 * Two conditions now, and both are about whether a number was actually STATED:
 *
 *   1. the value is a finite `number` primitive. Not a numeric string, not an
 *      empty array, not null — those are absences wearing a number's clothes.
 *   2. the row does not say it was unscored. server.js's normalizeReviewItems
 *      clamps a missing score to 0 and records `explicitScore: false` beside it,
 *      so a reviewer that returned no score produces a perfectly finite ZERO. That
 *      zero is not a baseline and not a result; reading it as one is the same
 *      defect one layer up.
 *
 * Returning null puts the pair in NOT COMPARABLE, which fails closed: it can never
 * be recommended and never becomes SUGGESTED. */
function correctionScore(row) {
  if (!row || typeof row !== "object") return null;
  if (row.explicitScore === false) return null;
  return typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null;
}
function classifyCorrectionOutcome(baseline, candidate) {
  const before = correctionScore(baseline);
  const after = correctionScore(candidate);
  if (before === null || after === null || !baseline || baseline.available === false) {
    return { outcome: "unknown", delta: null, baselineScore: before, candidateScore: after };
  }
  const delta = Math.round(after - before);
  if (delta < -CORRECTION_SCORE_MARGIN) return { outcome: "regression", delta, baselineScore: before, candidateScore: after };
  const passed = candidate && candidate.pass === true;
  if (passed && delta > CORRECTION_SCORE_MARGIN) return { outcome: "improvement", delta, baselineScore: before, candidateScore: after };
  return { outcome: "no-improvement", delta, baselineScore: before, candidateScore: after };
}
function recommendableCorrection(verdict) {
  return !!verdict && verdict.outcome === "improvement";
}
/* One sentence, in production English, for whichever surface has to say it. */
function describeCorrectionOutcome(verdict) {
  if (!verdict || verdict.outcome === "unknown") {
    return "The approved original could not be scored by the same reviewer, so CineBraid cannot say whether this is better or worse than what you already approved.";
  }
  const delta = Number(verdict.delta);
  const size = Math.abs(delta);
  if (verdict.outcome === "regression") return `Scored ${size} lower than the approved original on the same review. This is worse than what you already approved.`;
  if (verdict.outcome === "improvement") return `Scored ${size} higher than the approved original on the same review, and the reviewer accepts the repair.`;
  return `Scored within ${CORRECTION_SCORE_MARGIN} of the approved original on the same review. It is not a measurable improvement on what you already approved.`;
}

const ATTRIBUTE_WORDS = { color: "Colour", state: "State", markings: "Markings", centre_displacement: "Position" };
function attributeWord(attribute) {
  return ATTRIBUTE_WORDS[attribute] || "Attribute";
}
/* The contract's own vocabulary, said in production English. These are closed
   enums, so this is a lookup and never a parse. */
const VALUE_WORDS = {
  present: "present", absent: "absent", uncertain: "not readable",
  none: "unobstructed", partial: "partly obstructed", heavy: "heavily obstructed",
  "not-applicable": "not tracked", yes: "identifiable", no: "not identifiable",
  text: "text", pattern: "pattern", multicoloured: "multi-tone",
};
function valueWord(value) {
  const key = String(value == null ? "" : value);
  return VALUE_WORDS[key] || key.replace(/-/g, " ");
}

/* Which structured declaration would make this change expected. Returned as
   data so the writer stays one deterministic switch and the UI never invents an
   allowance of its own. `intent` targets shot.continuityIntent; `accepted`
   targets the per-finding human record applyIntent already reads, and is used
   only where the intent contract has no field that could say it. */
function expectedActionFor(finding) {
  if (finding.kind === "removed") return { target: "intent", field: "allowPresenceChange", value: "may-leave" };
  if (finding.kind === "added") return { target: "intent", field: "allowPresenceChange", value: "may-enter" };
  if (finding.kind === "moved") return { target: "intent", field: "allowMovement", value: true };
  if (finding.kind === "attribute" && finding.attribute === "color") return { target: "intent", field: "allowColorChange", value: true };
  if (finding.kind === "attribute" && finding.attribute === "state") return { target: "intent", field: "allowStateChange", value: true };
  return { target: "accepted", field: `${finding.entity_id}:${finding.kind}:${finding.attribute || ""}`, value: true };
}

/* Short enough that the from → to line underneath carries the specifics
   instead of saying them a second time in prose. */
const CHANGE_HEADLINES = {
  removed: "Presence changed",
  added: "Presence changed",
  moved: "Position changed",
};
const CHANGE_RECOMMENDATIONS = {
  removed: "Restore it, or declare that it may leave during this shot.",
  added: "Remove it, or declare that it may enter during this shot.",
  moved: "Return it to its first position, or declare that it may move.",
};

/* One finding, said once, in the words a production uses. `class` is the
   five-value outcome; `type` is the engine's own kind so an advanced view can
   still group by it without the normal card exposing it. */
/* One short line saying why a change is not a break. The engine's own
   intentReason is used verbatim wherever it adds something the card does not
   already show; the declared-state case is the exception, because it restates
   the from → to transition printed directly above it. */
function intendedReason(finding, frameB) {
  if (finding.intentSource === "declared-state-change") return `Matches the state declared for ${frameB}.`;
  return finding.intentReason || "";
}
function describeFinding(finding, bucket, options = {}) {
  const frameB = options.frameBLabel || "the second frame";
  const base = {
    entityId: finding.entity_id,
    displayName: finding.display_name || finding.entity_id,
    type: finding.kind,
    attribute: finding.attribute || "",
    from: "", to: "",
    detail: "", recommendation: "", reason: "",
    canMarkExpected: false,
    expectedAction: null,
  };
  if (bucket === "changes") {
    const intended = finding.label === "intended";
    const attribute = finding.kind === "attribute" ? attributeWord(finding.attribute) : "";
    const headline = finding.kind === "attribute"
      ? `${attribute} changed`
      : CHANGE_HEADLINES[finding.kind] || "Changed between the two frames";
    const from = finding.kind === "attribute" ? valueWord(finding.value_a) : finding.kind === "moved" ? "" : valueWord(finding.value_a);
    const to = finding.kind === "attribute" ? valueWord(finding.value_b) : finding.kind === "moved" ? "" : valueWord(finding.value_b);
    return {
      ...base,
      class: intended ? "expected" : "issue",
      severity: intended ? "" : finding.kind === "removed" || finding.kind === "added" ? "high" : "medium",
      headline: intended ? `${headline} — as declared` : headline,
      from, to,
      /* A presence or attribute change is fully said by the transition line, so
         there is no detail sentence to add. Movement has no transition — the
         displacement is a number nobody should have to read — so its one line
         is where the explanation goes. */
      detail: finding.kind === "moved" ? "Its centre moved further than a locked camera can explain." : "",
      reason: intended
        ? intendedReason(finding, frameB)
        : finding.intentSource === "near-miss" ? finding.intentReason || "" : "",
      recommendation: intended ? "" : CHANGE_RECOMMENDATIONS[finding.kind] || "Correct the change, or declare it as intentional.",
      /* Only a real observed change can be declared intentional. Unreadable
         evidence and invalid records are in other buckets and never reach here,
         so no declaration can quietly approve them. */
      canMarkExpected: !intended,
      expectedAction: intended ? null : expectedActionFor(finding),
    };
  }
  if (bucket === "shadeDrift")
    return {
      ...base, class: "uncertain", severity: "",
      headline: "Shade drift only",
      from: valueWord(finding.value_a), to: valueWord(finding.value_b),
      detail: "Neighbouring shades of the same colour family are usually lighting, not a continuity break.",
    };
  if (bucket === "attributeUnreadable")
    return {
      ...base, class: "review", severity: "",
      headline: `${attributeWord(finding.attribute)} could not be compared`,
      from: valueWord(finding.value_a), to: valueWord(finding.value_b),
      detail: `The ${attributeWord(finding.attribute).toLowerCase()} reading was not usable on one of the two frames, so it was never compared.`,
      recommendation: "Check this attribute yourself, or re-observe the frame.",
    };
  if (bucket === "presenceUncertain")
    return {
      ...base, class: "review", severity: "",
      headline: "Presence could not be established",
      from: valueWord(finding.value_a), to: valueWord(finding.value_b),
      detail: "One of the two frames gave no usable answer about whether this was there.",
      recommendation: "Confirm by eye, or re-observe the frame.",
    };
  if (bucket === "invalidRecords")
    return {
      ...base, class: "review", severity: "",
      headline: "No usable reading for this entity",
      detail: "The analysis returned nothing that could be compared for this entity, so it was excluded from every automatic verdict.",
      recommendation: "Re-observe the frames, or check this entity by eye.",
    };
  /* comparison.uncertain — evidence-quality notes. Nothing is known to have
     changed; the reading simply was not reliable enough to say. */
  if (finding.kind === "missing-record")
    return {
      ...base, class: "review", severity: "",
      headline: "This entity was not reported on both frames",
      detail: "It is declared on one frame and not the other, so there is nothing to compare.",
      recommendation: "Check the declared cast, location and props for both frames.",
    };
  if (finding.kind === "identifiability")
    return {
      ...base, class: "uncertain", severity: "",
      headline: "Not confidently identifiable",
      from: valueWord(finding.value_a), to: valueWord(finding.value_b),
      detail: "It was visible but could not be identified with confidence, so its details were not judged.",
    };
  if (finding.kind === "occlusion-transition")
    return {
      ...base, class: "uncertain", severity: "",
      headline: "How much is visible changed",
      from: valueWord(finding.value_a), to: valueWord(finding.value_b),
      detail: "A different amount of it is obstructed in each frame, so the two readings are not directly comparable.",
    };
  if (finding.kind === "size")
    return {
      ...base, class: "uncertain", severity: "",
      headline: "Apparent size changed sharply",
      detail: "It occupies a very different amount of the frame, which usually means the camera moved rather than the object.",
    };
  return { ...base, class: "uncertain", severity: "", headline: "Could not be judged automatically" };
}

const COMPARISON_BUCKETS = [
  ["changes", "changes"],
  ["uncertain", "uncertain"],
  ["shade_drift", "shadeDrift"],
  ["attribute_unreadable", "attributeUnreadable"],
  ["presence_uncertain", "presenceUncertain"],
  ["invalid_records", "invalidRecords"],
];

/* A per-entity rollup carrying the five-value outcome and fully described
   findings, so one card can be rendered per entity without reassembling six
   parallel arrays or re-deciding anything. Presentation only. */
function describeComparison(comparison, manifest, options = {}) {
  const rows = new Map();
  for (const declaration of (manifest && manifest.entities) || [])
    rows.set(declaration.entity_id, {
      entityId: declaration.entity_id,
      displayName: declaration.display_name,
      kind: declaration.entity_type,
      outcome: "stable",
      verdict: "pass",
      findings: [],
      /* Retained for callers that already group by the engine's own buckets. */
      changes: [], uncertain: [], shadeDrift: [],
      attributeUnreadable: [], presenceUncertain: [], invalidRecords: [],
    });
  for (const [source, field] of COMPARISON_BUCKETS)
    for (const finding of (comparison && comparison[source]) || []) {
      const row = rows.get(finding.entity_id);
      if (!row) continue;
      row[field].push(finding);
      row.findings.push(describeFinding(finding, field, options));
    }
  for (const row of rows.values()) {
    for (const finding of row.findings)
      if (OUTCOME_RANK[finding.class] > OUTCOME_RANK[row.outcome]) row.outcome = finding.class;
    /* A near-miss note is an unresolved human question even though the finding
       itself is a plain change; applyIntent counts it into needsReview for the
       same reason. */
    if (row.changes.some((finding) => finding.intentSource === "near-miss")) row.outcome = "review";
    row.verdict = row.outcome === "stable" ? "pass" : row.outcome === "uncertain" ? "review" : row.outcome;
    row.findings.sort((a, b) => (OUTCOME_RANK[b.class] - OUTCOME_RANK[a.class]) || compareStrings(a.headline, b.headline));
  }
  const entities = [...rows.values()];
  const counts = { stable: 0, issue: 0, expected: 0, uncertain: 0, review: 0 };
  for (const row of entities) counts[row.outcome] += 1;
  return { entities, counts };
}

const CONTINUITY_EXPORTS = {
  CONTINUITY_MANIFEST_VERSION,
  CONTINUITY_OBSERVATION_CONTRACT_VERSION,
  CONTINUITY_COMPARISON_VERSION,
  MANIFEST_HASH_LENGTH,
  PRESENCE_VALUES, OCCLUSION_VALUES, IDENTIFIABLE_VALUES, MARKINGS_VALUES, COLOR_VALUES,
  COLOUR_FAMILIES, EVIDENCE_MAX, MOVE_THRESHOLD, SIZE_RATIO_LO, SIZE_RATIO_HI, CONTINUITY_UNITS,
  DEFAULT_TRACKING, DEFAULT_INTENT, PRESENCE_ALLOWANCES,
  VISUAL_ENTITY_KINDS, ENTITY_KIND_LISTS, OBSERVATION_RELEVANT_FIELDS, OBSERVATION_FLAGS,
  INTENT_KEYWORDS,
  sha256Hex, canonicalJson,
  colourFamily, sameColourFamily,
  mergeTracking, resolveEntityTracking, resolveEntityIntent,
  resolveStateRecord, resolveDeclaredStateId, stateApprovedFile,
  buildContinuityManifest, buildObservationSchema, entityRecordSchema,
  OBSERVATION_PROMPT_VERSION, OBSERVATION_USER_MESSAGE, OBSERVATION_SCHEMA_NAME,
  OBSERVATION_REQUEST_CONTRACT, observationChecklist, buildObservationPrompt,
  bboxIsValid, recordState, validateObservationSet,
  OBSERVATION_FLAG_SCOPE, OBSERVATION_STATUSES, observationStatus,
  compareObservations, buildIntentDescriptors, matchesDescriptor, applyIntent,
  normalizeIntentText,
  CONTINUITY_OUTCOMES, CONTINUITY_OUTCOME_LABELS,
  CORRECTION_OUTCOMES, CORRECTION_OUTCOME_LABELS, CORRECTION_SCORE_MARGIN,
  correctionScore, classifyCorrectionOutcome, recommendableCorrection, describeCorrectionOutcome,
  expectedActionFor, describeFinding, describeComparison,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(CONTINUITY_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) {
  /* Node has no script-tag load order, so the dependencies are taken directly. */
  const shared = require("./shared-entities");
  globalThis.shotDependencyRecords = globalThis.shotDependencyRecords || shared.shotDependencyRecords;
  /* Assigned, not defaulted. `shotDependencyRecords` above uses `x = x || y`
     because a browser-shaped harness may have installed it first and the two
     are the same function either way. The binding contract is different: the
     module this line just required IS the authority, and deferring to whatever
     a previous load left on globalThis is how a reloaded or patched copy gets
     silently ignored while the stale one keeps answering. */
  const binding = require("./shared-continuity-binding");
  globalThis.readShotStateBindings = binding.readShotStateBindings;
  globalThis.resolveBoundStateId = binding.resolveBoundStateId;
  module.exports = CONTINUITY_EXPORTS;
}
