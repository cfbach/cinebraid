/* CINEBRAID — declared-entity continuity: tolerant response deserialization.

   A 167-request qualification against the resident Nemotron found a decoder
   TERMINATION defect, not a reasoning defect. On a pathological run the model
   produces a substantially complete strict-schema observation, omits exactly
   one final closing brace, then emits thousands of characters of legal JSON
   whitespace until it hits max_tokens. finish_reason comes back "length",
   JSON.parse fails, and roughly 330 tokens of correct answer are thrown away
   after ~80 seconds. Raising max_tokens does not help — 4096, 6144 and 8192 all
   fail, and the failure just takes proportionally longer. A rarer variant emits
   a raw 0x0C form feed inside a string, which JSON also forbids.

   All 27 captured failures were recoverable: 25 by closing the structure, 2 by
   removing illegal control characters, and every recovered response then passed
   the existing strict validator unchanged.

   So this repairs the SERIALIZATION ENVELOPE and nothing else. It is not a JSON
   healer. The hard boundary:

     MAY   remove raw control characters JSON syntax cannot legally contain
     MAY   drop trailing legal whitespace
     MAY   append missing closing } and ] at EOF, in reverse nesting order

     NEVER insert a comma, colon, quote, property name, digit or value
     NEVER close an unterminated string
     NEVER complete a truncated number or keyword
     NEVER invent an entity, a field or an enum
     NEVER let a recovered object skip the strict validator

   The recovered text is re-parsed and then handed to the same
   validateObservationSet() every other observation goes through. Recovery
   cannot make a schema-invalid answer acceptable; it can only give the
   validator something to judge.

   Pure: no I/O, no clock, no randomness, no provider awareness. */

/* The observation schema nests root -> entities -> one entity -> bbox array,
   so a truncation at the deepest legal point leaves at most "]}}}"" outstanding.
   Four is that depth exactly. The observed defect was a single brace; the bound
   exists so this can never become an open-ended structural repair. */
const MAX_APPENDED_DELIMITERS = 4;
const RECOVERY_NONE = "none";
const RECOVERY_CONTROL = "control-character";
const RECOVERY_EOF = "eof-closure";
const RECOVERY_BOTH = "control-character+eof-closure";

/* Whitespace JSON permits between tokens. Everything else below 0x20 is
   illegal wherever it appears, and illegal inside a string even when it is one
   of these — RFC 8259 requires them escaped there. */
function isJsonWhitespace(code) {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/* Removes only raw C0 characters that JSON syntax cannot contain at the
   position they appear. String and escape state are tracked, so an escaped
   sequence like \f — a backslash and an "f", both perfectly legal text — is
   never touched, and a control character that is genuinely inside a string is.
   Printable content is never altered. */
function stripIllegalControlCharacters(text) {
  let out = "";
  let removed = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (code < 0x20 && (inString || !isJsonWhitespace(code))) {
      removed += 1;
      continue;
    }
    out += ch;
    if (escaped) { escaped = false; continue; }
    if (inString && ch === "\\") { escaped = true; continue; }
    if (ch === '"') inString = !inString;
  }
  return { text: out, removed };
}

/* What is still open at EOF, and whether closing it would be honest.

   `safe` is false the moment anything suggests the text is not simply an
   unfinished-but-coherent document: a mismatched closer, a negative depth, an
   unterminated string. The last-character rule is the one that stops a
   truncated VALUE being silently completed — `{"bbox":[1,2,3,12` would parse
   after appending "]}" and would then assert a coordinate the model never
   finished emitting. Requiring the final non-whitespace character to be a
   structural terminator (} ] or a closing quote) means the last value was
   fully written, so appending closers adds no information. */
function scanStructure(text) {
  const stack = [];
  let inString = false;
  let escaped = false;
  let lastMeaningful = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = false; lastMeaningful = '"'; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (isJsonWhitespace(text.charCodeAt(i))) continue;
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (!stack.length || stack[stack.length - 1] !== ch) return { safe: false, missing: "" };
      stack.pop();
    }
    lastMeaningful = ch;
  }
  if (inString) return { safe: false, missing: "" };
  if (!stack.length) return { safe: false, missing: "" };
  if (stack.length > MAX_APPENDED_DELIMITERS) return { safe: false, missing: "" };
  if (lastMeaningful !== "}" && lastMeaningful !== "]" && lastMeaningful !== '"') return { safe: false, missing: "" };
  return { safe: true, missing: stack.reverse().join("") };
}

/* Never throws. Returns the parsed value and how it was obtained; a caller
   handles a failure exactly the way it handled a JSON.parse failure before. */
function parseContinuityResponse(text) {
  const source = String(text == null ? "" : text);
  let firstError = null;
  /* The normal path returns the untouched value of the untouched text. A valid
     response is never inspected, rewritten or re-serialized. */
  try {
    return { ok: true, value: JSON.parse(source), recovery: RECOVERY_NONE };
  } catch (error) {
    firstError = error;
  }

  const cleaned = stripIllegalControlCharacters(source);
  let working = cleaned.text;
  if (cleaned.removed) {
    try {
      return { ok: true, value: JSON.parse(working), recovery: RECOVERY_CONTROL, removedControlCharacters: cleaned.removed };
    } catch { /* still unterminated; the structural pass may finish it */ }
  }

  /* Trailing whitespace is where the defect spends its token budget, and
     dropping it changes nothing a parser would have seen. */
  working = working.replace(/[ \t\n\r]+$/, "");
  const structure = scanStructure(working);
  if (!structure.safe) return { ok: false, recovery: RECOVERY_NONE, error: firstError };

  try {
    const value = JSON.parse(working + structure.missing);
    return {
      ok: true,
      value,
      recovery: cleaned.removed ? RECOVERY_BOTH : RECOVERY_EOF,
      removedControlCharacters: cleaned.removed,
      appendedDelimiters: structure.missing.length,
    };
  } catch {
    /* Appending closers did not produce valid JSON, so the text was missing
       something this is not allowed to supply. It stays malformed. */
    return { ok: false, recovery: RECOVERY_NONE, error: firstError };
  }
}

module.exports = {
  MAX_APPENDED_DELIMITERS,
  RECOVERY_NONE,
  RECOVERY_CONTROL,
  RECOVERY_EOF,
  RECOVERY_BOTH,
  stripIllegalControlCharacters,
  scanStructure,
  parseContinuityResponse,
};
