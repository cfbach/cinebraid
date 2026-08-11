"use strict";

/* The Open Film Project draft contract, declared once.

   This file is the single source of truth for four things that would otherwise
   drift apart:

     1. what a record may contain            (structural validation)
     2. the order keys are written in        (canonical file form, rule 5)
     3. whether a collection is ordered      (canonical collection order, rule 6)
     4. which types are addressable subjects (the resolver's containment table)

   §4 is why the containment table is derived from here rather than typed out a
   second time in the resolver: two hand-maintained copies of the same table is
   how a resolver starts accepting a subject the schema does not model. A test
   asserts the derived table equals the frozen P0 §3 table exactly.

   Shape is deliberately JSON-Schema-compatible - `type`, `properties`,
   `required`, `enum`, `items` mean what they mean in JSON Schema - so this can
   become a real schema document later without any key moving. The extra keys
   (`record`, `collection`, `ref`, `subjectRef`, `passthrough`) are contract
   metadata JSON Schema has no vocabulary for.

   Property insertion order IS the declared order. That is safe because no OFP
   field name is an integer-like string, which is the one case where V8 reorders
   object keys; a test asserts it stays that way.

   RESERVED TERMINOLOGY. P0 §12 reserves traditional filmmaking terms so they
   cannot acquire a different meaning before the profiles that need them exist.
   Nothing here is named `take`, `slug`, `stage`, `plate`, `unit`, `timecode`,
   `slate`, `sceneNumber`, `setup`, `page`, `eighths`, `castNumber`, `roll`,
   `board` or `day`. A test enforces that list against this file. */

/* ---- shared field shapes ------------------------------------------------- */

const ID = { type: "string", role: "id" };

/* An RFC 3339 UTC instant at second precision, with a literal Z. Local offsets
   are excluded because two documents that mean the same instant must hash the
   same, and "+00:00" and "Z" do not. */
const INSTANT = { type: "string", pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/ };

/* ---- core records -------------------------------------------------------- */

const ANCHOR = {
  type: "object",
  properties: {
    id: ID,
    /* A citation point in a source document. P0 §12 reserves `anchor` for
       exactly this meaning; what must not use the name is media references,
       which are `references[]` with a `purpose`. */
    elementKind: { type: "string", enum: ["heading", "action", "dialogue", "parenthetical", "transition", "other"] },
    text: { type: "string" },
  },
  required: ["id"],
};

const SOURCE = {
  type: "object",
  properties: {
    id: ID,
    kind: { type: "string", enum: ["screenplay", "treatment", "outline", "bible", "notes", "other"] },
    title: { type: "string" },
    uri: { type: "string" },
    anchors: { type: "array", record: "anchor", collection: "set", items: ANCHOR },
  },
  required: ["id"],
};

const SCENE = {
  type: "object",
  properties: {
    id: ID,
    title: { type: "string" },
    summary: { type: "string" },
    setting: {
      type: "object",
      properties: {
        locationId: { type: "string", ref: "location" },
        /* Deliberately WITHOUT an "unspecified" member. P0 §5 adds one only
           where production genuinely distinguishes a deliberate non-decision,
           and names exactly two fields: duration.basis and framing.lens. A case
           can be made for time of day, but making it here would be widening a
           frozen decision on my own authority. P2+ can argue for it explicitly. */
        timeOfDay: { type: "string", enum: ["dawn", "day", "dusk", "night", "continuous"] },
      },
      required: [],
    },
    order: {
      type: "object",
      properties: { script: { type: "integer" }, edit: { type: "integer" } },
      required: [],
    },
  },
  required: ["id"],
};

const FRAME = {
  type: "object",
  properties: {
    id: ID,
    role: { type: "string", enum: ["first", "last", "intermediate", "other"] },
    description: { type: "string" },
  },
  required: ["id"],
};

const MOTION = {
  type: "object",
  properties: {
    id: ID,
    description: { type: "string" },
    durationSeconds: { type: "number" },
  },
  required: ["id"],
};

const RELATION = {
  type: "object",
  properties: {
    id: ID,
    kind: { type: "string", enum: ["part-of", "fallback-for", "bookend-of", "continues", "other"] },
    targetShotId: { type: "string", ref: "shot" },
    note: { type: "string" },
  },
  required: ["id"],
};

const SHOT = {
  type: "object",
  properties: {
    id: ID,
    sceneId: { type: "string", ref: "scene" },
    title: { type: "string" },
    description: { type: "string" },
    order: {
      type: "object",
      properties: { script: { type: "integer" }, edit: { type: "integer" } },
      required: [],
    },
    framing: {
      type: "object",
      properties: {
        size: { type: "string", enum: ["extreme-wide", "wide", "medium-wide", "medium", "medium-close", "close", "extreme-close"] },
        angle: { type: "string", enum: ["eye", "high", "low", "overhead", "dutch", "over-shoulder"] },
        /* One of exactly two fields carrying an explicit `unspecified` member.
           P0 §5: add it only where production genuinely distinguishes "we have
           deliberately not decided" from "nobody has said". A director who has
           declined to specify the lens has made a decision, and it must survive
           a tool that discards statements[] - which is why it lives in the
           field's own enum rather than in evidence. */
        lens: { type: "string", enum: ["wide-angle", "normal", "telephoto", "macro", "anamorphic", "unspecified"] },
        movement: { type: "string", enum: ["static", "pan", "tilt", "dolly", "track", "crane", "handheld", "zoom"] },
      },
      required: [],
    },
    duration: {
      type: "object",
      properties: {
        /* The one nullable field in this contract revision, and it is nullable
           because production genuinely distinguishes three states here: the key
           absent (this shot carries no duration slot at all), null (the slot
           exists and its length has never been set), and a number. P0 §5 allows
           null only where the contract declares it, so the declaration is here
           rather than everywhere. */
        seconds: { type: "number", nullable: true },
        /* The second field with an explicit `unspecified`, for the same reason. */
        basis: { type: "string", enum: ["authored", "estimated", "measured", "unspecified"] },
      },
      required: [],
    },
    setting: {
      type: "object",
      properties: {
        locationId: { type: "string", ref: "location" },
        coverageId: { type: "string" },
      },
      required: [],
    },
    subjects: {
      type: "array",
      collection: "ordered",
      items: {
        type: "object",
        properties: {
          entityId: { type: "string", ref: "entity" },
          role: { type: "string" },
        },
        required: ["entityId"],
      },
    },
    frames: { type: "array", record: "frame", collection: "ordered", items: FRAME },
    motion: { type: "array", record: "motion", collection: "ordered", items: MOTION },
    relations: { type: "array", record: "relation", collection: "set", items: RELATION },
    /* Ordered data within a record, never sorted (rule 6). */
    risks: { type: "array", collection: "ordered", items: { type: "string" } },
  },
  required: ["id"],
};

const ENTITY_STATE = {
  type: "object",
  properties: {
    id: ID,
    name: { type: "string" },
    isDefault: { type: "boolean" },
    derivesFrom: { type: "string" },
    delta: { type: "string" },
  },
  required: ["id"],
};

const COVERAGE = {
  type: "object",
  properties: {
    id: ID,
    name: { type: "string" },
    description: { type: "string" },
    /* P4-SEM-A. Authored production intent, and the reason it fails the semantic
       test hard: a project reloaded without it cannot tell a gap from a
       deliberate non-requirement, and no derivation can recover the difference.

       Optional, because absence is a legal reading — a slot nobody has declared
       anything about is not the same fact as a slot declared `required`, and
       defaulting one into the other at load would break P0 §8 rule 1. Readers
       apply their default AT USE; public/shared-coverage.js is the one that does.

       Three members and no `unspecified`: absence already carries that meaning
       here, and P0 §5 admits an explicit member only where production genuinely
       distinguishes a deliberate non-decision from silence. It does not here.

       The counts a UI prints over these values - "2 of 4 required views" - stay
       derived. Nothing in this contract stores a coverage total, a completion
       fraction or a readiness percentage, and P0 §5 is why. */
    requirement: { type: "string", enum: ["required", "planned", "not-required"] },
  },
  required: ["id"],
};

/* The voice link, and the reason it is shaped this way.

   Dogfood showed character-owned voices reading like peer-level audio
   references in the UI. The frozen P1 direction is explicitly NOT to fix that
   by making voice a child of character: voice stays a first-class addressable
   entity in `entities.voices[]`, and the character points AT it.

   That single decision is what makes all seven required cases representable:
   a character may link several voices with different roles (primary, alternate
   language, ADR, performance variant); one voice may be linked by several
   characters, so a voice is reusable; and a voice linked by nobody - narrator,
   announcer, a non-visible voice - is an ordinary, valid entity rather than an
   orphan. A `characterId` on the voice would have destroyed all four
   properties at once.

   The links carry no `id` and are therefore not subjects. That is deliberate:
   the containment table is the frozen list of addressable types and this is not
   on it. A statement addresses the whole list (`path: "/voices"`), which the
   claim binding covers deterministically. */
const VOICE_LINK = {
  type: "object",
  properties: {
    voiceId: { type: "string", ref: "voice" },
    role: { type: "string", enum: ["primary", "alternate-language", "adr", "performance-variant", "other"] },
    language: { type: "string" },
  },
  required: ["voiceId"],
};

const CHARACTER = {
  type: "object",
  properties: {
    id: ID,
    name: { type: "string" },
    description: { type: "string" },
    role: { type: "string" },
    aliases: { type: "array", collection: "ordered", items: { type: "string" } },
    voices: { type: "array", collection: "ordered", items: VOICE_LINK },
    states: { type: "array", record: "state", collection: "set", items: ENTITY_STATE },
    /* P4-SEM-A. Characters own coverage for the same reason locations, props and
       vehicles do: CineBraid has always given them view slots — front, 3/4,
       profile, rear — through the same ensureCoverageSlots() mechanism, and this
       contract had nowhere to put them, so M008 preserved the whole collection
       into the legacy extension and another client saw an opaque blob.

       This is the generic COVERAGE record, not a second character-shaped one.
       `state` already had four owners and `coverage` three; coverage now has the
       same four, which is why the containment table gains a scope and no new
       addressable record type.

       Expressions (`expressionSlots[]`) are deliberately NOT folded in here.
       Whether they become coverage records with a discriminator is reconciliation
       §18 Q3, and it is unsettled; collapsing them on the way past would decide
       it by accident. They stay preserved by M014's cluster until Q3 is answered. */
    coverage: { type: "array", record: "coverage", collection: "set", items: COVERAGE },
  },
  required: ["id"],
};

const LOCATION = {
  type: "object",
  properties: {
    id: ID,
    name: { type: "string" },
    description: { type: "string" },
    states: { type: "array", record: "state", collection: "set", items: ENTITY_STATE },
    coverage: { type: "array", record: "coverage", collection: "set", items: COVERAGE },
  },
  required: ["id"],
};

const PROP = {
  type: "object",
  properties: {
    id: ID,
    name: { type: "string" },
    description: { type: "string" },
    states: { type: "array", record: "state", collection: "set", items: ENTITY_STATE },
    coverage: { type: "array", record: "coverage", collection: "set", items: COVERAGE },
  },
  required: ["id"],
};

const VEHICLE = {
  type: "object",
  properties: {
    id: ID,
    name: { type: "string" },
    description: { type: "string" },
    states: { type: "array", record: "state", collection: "set", items: ENTITY_STATE },
    coverage: { type: "array", record: "coverage", collection: "set", items: COVERAGE },
  },
  required: ["id"],
};

const VOICE = {
  type: "object",
  properties: {
    id: ID,
    name: { type: "string" },
    description: { type: "string" },
    /* `kind` lets a standalone voice describe itself, so a narrator is not
       merely "a voice no character claimed". */
    kind: { type: "string", enum: ["character", "narrator", "announcer", "non-visible", "other"] },
    language: { type: "string" },
  },
  required: ["id"],
};

const ASSET = {
  type: "object",
  properties: {
    id: ID,
    kind: { type: "string", enum: ["image", "video", "audio", "other"] },
    mediaType: { type: "string" },
    digest: { type: "string" },
  },
  required: ["id"],
};

const REFERENCE = {
  type: "object",
  properties: {
    id: ID,
    purpose: { type: "string", enum: ["identity-front", "identity-profile", "identity-detail", "location-view", "prop-view", "style", "other"] },
    /* A subject-ref, validated by the same grammar statements use. The audit
       had this as a field named `id` holding a composite "sh-0100/fr-a";
       P0 §3 corrects it to a real subject reference. */
    subject: { type: "string", subjectRef: true },
    assetId: { type: "string", ref: "asset" },
    note: { type: "string" },
  },
  required: ["id"],
};

const STATEMENT = {
  type: "object",
  properties: {
    id: ID,
    target: {
      type: "object",
      properties: {
        /* Deliberately NOT marked `subjectRef`. The generic subject-reference
           check would report the same broken target a second time under a
           second code; statement targets are owned by the statement pass, which
           resolves subject and path together and reports them as
           statement.target.unresolvable / .array-traversal / .malformed. One
           problem, one diagnostic. */
        subject: { type: "string" },
        path: { type: "string" },
      },
      required: [],
    },
    /* `closedEnum` marks a frozen vocabulary. An unknown member here is not a
       newer revision adding a value - the five acts are frozen and changing
       them requires a format-version change - so the semantic pass owns it as
       an error rather than the structural pass warning about it. */
    kind: { type: "string", enum: ["cited", "suggested", "observed", "approved", "disputed"], closedEnum: true },
    claim: {
      type: "object",
      properties: {
        hash: { type: "string", pattern: /^sha256:[0-9a-f]{64}$/ },
        /* Advisory, never compared. Written once at statement creation and
           never recomputed on save - otherwise a change to the preview
           formatter would rewrite every file in the project (INV-R3). */
        preview: { type: "string" },
      },
      required: ["hash"],
    },
    actor: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["human", "model", "tool", "source"] },
        name: { type: "string" },
      },
      required: ["kind"],
    },
    at: INSTANT,
    evidence: {
      type: "object",
      properties: {
        sourceId: { type: "string", ref: "source" },
        anchors: { type: "array", collection: "ordered", items: { type: "string" } },
        assetId: { type: "string", ref: "asset" },
        observationId: { type: "string" },
      },
      required: [],
    },
    candidates: {
      type: "array",
      collection: "ordered",
      items: {
        type: "object",
        properties: {
          /* The one place a value is stored rather than hashed: a conflict is
             about competing values, at least one of which is not in the
             document. Any JSON value, so no `type` constraint. */
          value: {},
          note: { type: "string" },
          sourceId: { type: "string", ref: "source" },
          anchors: { type: "array", collection: "ordered", items: { type: "string" } },
        },
        required: ["value"],
      },
    },
    note: { type: "string" },
  },
  required: ["id", "target", "kind", "claim", "at"],
};

/* ---- the document -------------------------------------------------------- */

const DOCUMENT = {
  type: "object",
  properties: {
    format: {
      type: "object",
      properties: {
        id: { type: "string", const: "open-film-project" },
        /* The CONTRACT version. Never the CineBraid application version. */
        version: { type: "string" },
        /* A scalar array inside a record, so array order is data and the writer
           never sorts it (rule 6). Declaring the profiles in the order they
           layer is more useful than declaring them alphabetically. */
        profiles: { type: "array", collection: "ordered", items: { type: "string" } },
        extensions: { type: "object", passthrough: true },
        generator: {
          type: "object",
          properties: { name: { type: "string" }, version: { type: "string" } },
          required: [],
        },
      },
      required: ["id", "version"],
    },
    meta: {
      type: "object",
      properties: {
        title: { type: "string" },
        /* The film's own draft label ("v2.1"), not a format version. */
        draft: { type: "string" },
        logline: { type: "string" },
        synopsis: { type: "string" },
        aspectRatio: { type: "string" },
      },
      required: [],
    },
    sources: { type: "array", record: "source", collection: "set", items: SOURCE },
    story: {
      type: "object",
      properties: {
        scenes: { type: "array", record: "scene", collection: "ordinal", items: SCENE },
      },
      required: [],
    },
    shots: { type: "array", record: "shot", collection: "ordinal", items: SHOT },
    entities: {
      type: "object",
      properties: {
        characters: { type: "array", record: "character", collection: "set", items: CHARACTER },
        locations: { type: "array", record: "location", collection: "set", items: LOCATION },
        props: { type: "array", record: "prop", collection: "set", items: PROP },
        vehicles: { type: "array", record: "vehicle", collection: "set", items: VEHICLE },
        voices: { type: "array", record: "voice", collection: "set", items: VOICE },
      },
      required: [],
    },
    assets: { type: "array", record: "asset", collection: "set", items: ASSET },
    references: { type: "array", record: "reference", collection: "set", items: REFERENCE },
    /* Declared present, interior deferred to the `continuity` profile, which
       this contract revision does not model. Preserved verbatim and NOT
       reported key by key: reporting every field of a profile we have not
       written yet would be noise, not a finding. */
    continuity: { type: "object", passthrough: true, profile: "continuity" },
    statements: { type: "array", record: "statement", collection: "set", items: STATEMENT },
    /* Foreign content by definition. Preserved as parsed, re-serialized with
       keys in JCS order (rule 11), never inspected, never coerced. */
    extensions: { type: "object", passthrough: true },
  },
  required: ["format"],
};

/* ---- derived: the containment table --------------------------------------

   Walked out of the schema so the resolver and the schema cannot disagree.
   Each entry says where records of that type live and what may contain them. */

function deriveContainment() {
  const table = {};
  /* `container` is the property path from the OWNER record's root, so a shot's
     frames are "frames" while the project's scenes are "story.scenes". `scopes`
     is a list because `state` genuinely has four owners and `coverage` three;
     collapsing it to one would silently drop three of them. */
  function record(type, scope, container) {
    const existing = table[type];
    if (!existing) { table[type] = { scopes: [scope], container }; return; }
    if (!existing.scopes.includes(scope)) existing.scopes.push(scope);
    if (existing.container !== container)
      throw new Error(`containment conflict: ${type} lives at ${existing.container} under ${existing.scopes[0]} and at ${container} under ${scope}`);
  }
  function walkObject(spec, ownerType, prefix) {
    if (!spec || spec.type !== "object" || !spec.properties) return;
    for (const [key, child] of Object.entries(spec.properties)) {
      if (!child || typeof child !== "object") continue;
      const here = prefix ? `${prefix}.${key}` : key;
      if (child.type === "array" && child.record) {
        record(child.record, ownerType, here);
        /* Records nested inside this record are scoped to it, and their
           container path restarts at the nested record's own root. */
        walkObject(child.items, child.record, "");
        continue;
      }
      /* A plain object is a path segment, not an owner - `story` contains
         scenes but is not itself an addressable record. */
      if (child.type === "object" && !child.passthrough) walkObject(child, ownerType, here);
    }
  }
  walkObject(DOCUMENT, "project", "");
  return table;
}

const CONTAINMENT = deriveContainment();

/* Every record type that may appear as a subject step, in the frozen order of
   P0 §3's table. */
const SUBJECT_TYPES = Object.keys(CONTAINMENT);

module.exports = {
  DOCUMENT,
  CONTAINMENT,
  SUBJECT_TYPES,
  /* Exported for the serializer, the validator and the key-order experiment. */
  records: { SOURCE, ANCHOR, SCENE, SHOT, FRAME, MOTION, RELATION, CHARACTER, LOCATION, PROP, VEHICLE, VOICE, ENTITY_STATE, COVERAGE, ASSET, REFERENCE, STATEMENT, VOICE_LINK },
};
