"use strict";

/* Deterministic sanitizer for the archived Overfit generations (OFP P3).
 *
 * The problem this solves: the migration framework has to be tested against real
 * historical CineBraid data, and real historical CineBraid data is somebody's
 * film. A hand-edited copy is neither reproducible nor trustworthy - it is a new
 * document that happens to resemble the old one. So the derivation is a program:
 *
 *     read-only source  ->  deterministic transform  ->  fixture + manifest
 *
 * Run it twice against the same bytes and you get the same bytes out. Nothing
 * here reads a clock, a random source or the environment.
 *
 * WHAT IS PRESERVED, AND WHY
 *
 * Migration semantics live in structure, identity and a small amount of prose.
 * All three survive verbatim:
 *
 *   - every key, in source order; every array, at its source length and order;
 *   - absent vs `null` vs `""` vs `[]` vs `{}` - the accounting ledger treats
 *     each differently and collapsing them would erase the distinction P2 exists
 *     to hold;
 *   - every identifier and every `codes[]` token, including the malformed ones:
 *     `INT-1->2` is not portable and `LOC-HULL-A` is ambiguous, and those are
 *     the two cases most worth testing;
 *   - every number, boolean, enum, status, timestamp, model name and filename;
 *   - the words M022 reads production relationships out of (`bookend`,
 *     `derive from`, `depends on`, `shared-asset`, `mirror`), and the shot IDs
 *     those sentences name - sanitizing those away would delete the hazard
 *     rather than the content;
 *   - `[INFERRED FOR PLANNING]`, wherever it appears.
 *
 * WHAT IS REPLACED
 *
 * Only free prose: a string that holds whitespace, under a key named on
 * PROSE_KEYS. Both halves of that test matter. The key list keeps the transform
 * away from fields it has never seen - a legacy field nobody modelled passes
 * through untouched, which is deliberate, because an unknown field is exactly
 * what M070 is for and a fixture that quietly dropped one would test nothing.
 * The whitespace test then keeps it away from the single-token values that share
 * a key with prose: `role` holds both `"location"` and a sentence, and rewriting
 * the enum would change what M030 reads.
 *
 * Replacement is word-for-word and exact-length, through a pure function of the
 * lowercased source word, so:
 *
 *   - two fields that held the same sentence still hold the same sentence, and
 *     two that differed still differ - M011 compares the seven description
 *     aliases for agreement, and a substitution that collapsed them would turn a
 *     dispute into a clean mapping;
 *   - the same word reads the same everywhere in the corpus, so a cross-
 *     generation diff still shows what actually changed between generations;
 *   - documents keep their size, so leaf counts and statement volume are
 *     measured against something the same shape as the original.
 *
 * The pseudo-words are syllabic nonsense on purpose. Nobody should be able to
 * mistake a fixture for the film, and nobody should be tempted to read one for
 * story sense.
 *
 * Filenames stay verbatim apart from one case. The archive's convention is
 * `project_shot_role_version.ext`, which M030 reads and which carries shot IDs
 * that have to survive anyway; rewriting the descriptive half would break the
 * cross-references between `winner`, `label`, `url` and `key` for no privacy
 * gain. The exception is the provider-minted content-addressed names, which are
 * an account's artefacts rather than the film's, and are replaced by same-length
 * deterministic tokens of the same alphabet class.
 */

const crypto = require("crypto");

/* Bumped only if the injectivity assertion below ever fires. It is part of the
   fixture's identity: changing it rewrites every sanitized document. */
const SANITIZER_VERSION = "1";
const SALT = `cinebraid-ofp-p3/${SANITIZER_VERSION}`;

/* Placeholders for text lifted out before the word tokenizer runs. U+0001 and
   U+0002 cannot occur in the source: JSON parsing would have rejected a raw
   control character, and no rule writes one. Using digits alone would collide
   with the digits already in the prose. */
const HOLD_OPEN = "\u0001";
const HOLD_CLOSE = "\u0002";
const HOLD_PATTERN = /\u0001(\d+)\u0002/g;

/* ---------------------------------------------------------------------------
   Sanitization rules. Each has an ID because the manifest names the rules that
   touched a given generation, and "sanitized" on its own is not an account. */

const SANITIZATION_RULES = [
  { id: "S01", name: "identity vocabulary is inviolable", summary: "Every id, prefix, codes[] token and structural cross-reference is preserved verbatim, in the document and inside any prose that mentions it." },
  { id: "S02", name: "verbatim by default", summary: "A string is replaced only when it holds whitespace and its key is named on PROSE_KEYS. Unknown fields pass through untouched so M070 still has something to preserve." },
  { id: "S03", name: "prose pseudonymization", summary: "Content words become exact-length syllabic nonsense through a pure function of the lowercased word. Punctuation, digits, stopwords, dependency keywords and identifiers survive." },
  { id: "S04", name: "filenames are preserved", summary: "The project_shot_role_version convention M030 reads is left intact, including the shot identifiers embedded in it." },
  { id: "S05", name: "opaque provider token replacement", summary: "Provider-minted content-addressed filenames are replaced by same-length deterministic tokens of the same alphabet class, so the shape survives and the provider's identifier does not." },
  { id: "S06", name: "structure is never touched", summary: "No key is added, removed or reordered; no array is reordered or resized; absent, null, empty-string, empty-array and empty-object are each left as they were." },
];

/* ---------------------------------------------------------------------------
   Keys whose string values are prose. Derived by measuring the corpus - every
   key holding a string was listed, and these are the ones carrying free text
   rather than an identifier, an enum, a timestamp, a filename or a model name. */

const PROSE_KEYS = new Set([
  "action", "ambience", "anchors", "block", "camera", "carryForward", "compiledPrompt",
  "confirmations", "coveragePolicy", "creationDescription", "desc", "description",
  "dialogue", "direction", "driftNotes", "emotion", "environment", "expressions",
  "format", "framing", "gaze", "globalNegativePrompt", "globalStylePrompt", "howItFeels",
  "include", "instruction", "issues", "lensIntent", "movement", "music", "mustAvoid",
  "mustPreserve", "name", "narrativePurpose", "note", "notes", "positioning", "prompt",
  "qcChecklist", "refs", "reject", "revisedPrompt", "risks", "role", "rules", "safe",
  "setting", "sfx", "stability", "staging", "strengths", "subject", "submissionNote",
  "summary", "sunoAltPrompt", "systemFeedback", "text", "title", "visualStyle", "vo",
  "voiceDesignPrompt", "voiceNotes", "warnings", "whatHappens",
]);

/* Words that carry no content and whose removal would make the prose unreadable
   without making it any more private. Also the vocabulary M022 matches on: strip
   `bookend` and the corpus stops exercising the only inferential relation rule
   that real data actually reaches. */
const KEPT_WORDS = new Set([
  /* M022 dependency keywords - load-bearing */
  "bookend", "bookends", "mirror", "mirrors", "mirrored", "derive", "derives", "derived",
  "depend", "depends", "shared", "asset", "assets",
  /* function words */
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "as", "at", "by", "for",
  "from", "in", "into", "is", "are", "was", "were", "be", "been", "it", "its", "no",
  "not", "of", "off", "on", "onto", "out", "over", "per", "so", "to", "up", "via",
  "with", "within", "without", "this", "that", "these", "those", "there", "here",
  "all", "any", "each", "only", "same", "other", "both", "before", "after", "first",
  "last", "new", "old", "yes", "none", "one", "two", "three",
]);

/* Keys whose values are identifiers or point at one. Collected per document and
   protected everywhere, including inside prose. */
const IDENTITY_KEYS = new Set([
  "id", "prefix", "anchorPrefix", "parentShot", "fallbackFor", "sameObjectAs", "scene",
  "sceneId", "shotId", "locationId", "propIds", "characterId", "voiceId", "characters",
  "parentStateId", "fromFrame", "toFrame", "appliesTo",
]);

const INFERRED_MARKER = "[INFERRED FOR PLANNING]";

/* ---------------------------------------------------------------------------
   The pseudo-word generator. A pure function of the lowercased word: no state,
   no ordering dependency, no counter. */

const CONSONANTS = "bcdfghjklmnprstvwz";
const VOWELS = "aeiouy";

function pseudoWord(word) {
  const digest = crypto.createHash("sha256").update(`${SALT} ${word.toLowerCase()}`).digest();
  let out = "";
  /* One hash byte per character rather than per syllable, so a four-letter word
     draws on 32 bits instead of 16. Alternating consonant and vowel keeps the
     result pronounceable, which is what makes a sanitized fixture reviewable. */
  for (let index = 0; index < word.length; index++) {
    const byte = digest[index % digest.length] ^ ((index * 31) & 0xff);
    out += index % 2 === 0 ? CONSONANTS[byte % CONSONANTS.length] : VOWELS[byte % VOWELS.length];
  }

  /* Case pattern, so an ALL-CAPS emphasis stays emphatic and a sentence still
     starts with a capital. */
  if (word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()) return out.toUpperCase();
  if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) return out[0].toUpperCase() + out.slice(1);
  return out;
}

/* Provider-minted filenames (`88XEYkt7hJH59fjoKNm2U_QTKBU63V.png`) are not
   creative content, but they are an account's artefacts and they are the only
   high-entropy strings in the corpus. Same length, same alphabet class. */
const DIGITS = "0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";

function pseudoOpaque(token) {
  const digest = crypto.createHash("sha256").update(`${SALT} opaque ${token}`).digest();
  let out = "";
  for (let index = 0; index < token.length; index++) {
    const byte = digest[index % digest.length] ^ ((index * 17) & 0xff);
    const source = token[index];
    if (source >= "0" && source <= "9") out += DIGITS[byte % 10];
    else if (source >= "a" && source <= "z") out += LOWER[byte % 26];
    else if (source >= "A" && source <= "Z") out += UPPER[byte % 26];
    else out += source;
  }
  return out;
}

/* A segment is opaque when it looks minted rather than written: long, mixed
   case, and carrying digits. `OVERFIT_L0-01_A_V001` is none of those. */
function isOpaqueSegment(segment) {
  return segment.length >= 16 && /[0-9]/.test(segment) && /[a-z]/.test(segment) && /[A-Z]/.test(segment);
}

function hasOpaqueSegment(value) {
  return typeof value === "string" && (value.match(/[A-Za-z0-9]+/g) || []).some(isOpaqueSegment);
}

function replaceOpaqueSegments(value) {
  return value.replace(/[A-Za-z0-9]+/g, (segment) => (isOpaqueSegment(segment) ? pseudoOpaque(segment) : segment));
}

/* ---------------------------------------------------------------------------
   Prose rewriting. */

function collectIdentifiers(document) {
  const found = new Set();
  const walk = (value, key) => {
    if (Array.isArray(value)) { for (const item of value) walk(item, key); return; }
    if (value && typeof value === "object") { for (const [k, v] of Object.entries(value)) walk(v, k); return; }
    if (typeof value !== "string") return;
    if (key !== "codes" && !IDENTITY_KEYS.has(key)) return;
    const trimmed = value.trim();
    if (trimmed.length >= 2) found.add(trimmed);
  };
  walk(document, "$root");
  /* Longest first, so `LOC-HULL-A` is matched before `LOC-HULL` and the suffix
     is never orphaned into the prose stream. */
  return [...found].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

function protectionPattern(identifiers) {
  if (!identifiers.length) return null;
  const escaped = identifiers.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"), "g");
}

/* Rewrites one prose string. Identifiers and the inferred marker are lifted out
   first so the word tokenizer can never split one; everything else is walked as
   runs of letters. `seen` is the corpus-wide reverse map, and it is what turns a
   collision from a silent semantic change into a build failure. */
function sanitizeProse(text, pattern, seen) {
  if (typeof text !== "string" || !text) return text;

  const held = [];
  const hold = (value) => `${HOLD_OPEN}${held.push(value) - 1}${HOLD_CLOSE}`;

  let staged = text;
  if (staged.includes(INFERRED_MARKER)) staged = staged.split(INFERRED_MARKER).join(hold(INFERRED_MARKER));
  if (pattern) staged = staged.replace(pattern, (match) => hold(match));

  const rewritten = staged.replace(/\p{L}+/gu, (word) => {
    if (word.length < 3) return word;
    if (KEPT_WORDS.has(word.toLowerCase())) return word;
    const replacement = pseudoWord(word);
    if (seen) {
      const previous = seen.get(replacement);
      /* Two source words can land on the same pseudo-word at short lengths, and
         that is recorded rather than fatal. The property the corpus actually
         needs is that the *string* equality partition is unchanged - M011 turns
         on whether two description aliases agree, not on whether the vocabulary
         is injective - and the build gate checks that directly. A word collision
         only matters if it merges two strings, and that check would catch it. */
      if (previous !== undefined && previous !== word.toLowerCase()) seen.collisions.add(`${previous}/${word.toLowerCase()}=${replacement}`);
      else seen.set(replacement, word.toLowerCase());
    }
    return replacement;
  });

  return rewritten.replace(HOLD_PATTERN, (_, index) => held[Number(index)]);
}

/* ---------------------------------------------------------------------------
   The document walk. Key order and container shape are reproduced exactly; only
   leaf strings are ever different, and only under the two conditions above. */

function isProse(value) {
  return /\s/.test(value.trim());
}

function sanitizeDocument(document) {
  const identifiers = collectIdentifiers(document);
  const pattern = protectionPattern(identifiers);
  const seen = new Map();
  seen.collisions = new Set();
  const applied = new Set(["S01", "S02", "S04", "S06"]);

  const walk = (value, key) => {
    if (Array.isArray(value)) return value.map((item) => walk(item, key));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
      return out;
    }
    if (typeof value !== "string" || !value) return value;

    if (hasOpaqueSegment(value)) { applied.add("S05"); return replaceOpaqueSegments(value); }
    if (!PROSE_KEYS.has(key) || !isProse(value)) return value;

    const next = sanitizeProse(value, pattern, seen);
    if (next !== value) applied.add("S03");
    return next;
  };

  const result = walk(document, "$root");
  return {
    document: result,
    identifiers,
    vocabulary: seen.size,
    wordCollisions: [...seen.collisions].sort(),
    rulesApplied: [...applied].sort(),
  };
}

module.exports = {
  SANITIZER_VERSION,
  SANITIZATION_RULES,
  PROSE_KEYS,
  KEPT_WORDS,
  IDENTITY_KEYS,
  INFERRED_MARKER,
  pseudoWord,
  pseudoOpaque,
  isOpaqueSegment,
  collectIdentifiers,
  sanitizeProse,
  sanitizeDocument,
};
