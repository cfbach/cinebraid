"use strict";

/* Two canonical forms, kept apart on purpose.

   FILE FORM  pretty, readable, deterministic - what a project on disk looks
              like, and what a human reviews in a git diff.
   HASH FORM  RFC 8785 JCS - compact, for claim binding and any digest.

   Conflating them is how a format acquires an unreadable serialization for no
   reason. They answer different questions and neither is a substitute.

   The file form's rules, from frozen P0 §8:

     1  UTF-8, no BOM              8  ECMAScript string escaping
     2  LF line endings            9  absent / null / "unspecified" all distinct
     3  2-space indent            10  empty collections kept iff present on load
     4  one trailing newline      11  unknown extensions preserved, JCS key order
     5  deterministic key order   12  unknown enum values preserved verbatim
     6  deterministic collections 13  duplicate object keys rejected at parse
     7  ECMAScript numbers

   Rule 9 is the workhorse, and it is a rule about the WRITER, not the schema:

       the writer MUST NOT emit a key that was absent on load,
       and MUST NOT drop a key that was present -
       even when its value equals the default.

   That single sentence is most of what makes a second save byte-identical to
   the first. A writer that helpfully fills in defaults produces a file that
   differs from the one it just read, and then every project in git churns.

   Rule 5 is the one P0 left open as Q1, so it is a parameter here rather than a
   decision baked into the code: `keyOrder: "schema"` writes declared keys in
   the order the schema declares them and then unknown keys in JCS order;
   `keyOrder: "jcs"` sorts everything. The experiment that settles it compares
   real documents written both ways. */

const { DOCUMENT } = require("./ofp-schema");
const { canonicalJson } = require("../public/shared-continuity");

const INDENT = "  ";
const KEY_ORDER = { SCHEMA: "schema", JCS: "jcs" };

/* Locale-independent, and it is the same ordering RFC 8785 specifies: compare
   by UTF-16 code unit. localeCompare would make the bytes depend on the host's
   ICU data, which is exactly the kind of machine-dependence this file exists to
   remove. */
function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderedKeys(spec, value, keyOrder) {
  const present = Object.keys(value);
  /* Foreign content always sorts, whatever mode the rest of the document is
     written in. There is no declared order for a subtree this contract does
     not model, so JCS order is the only deterministic choice available. */
  if (!spec || !spec.properties || spec.passthrough || keyOrder === KEY_ORDER.JCS)
    return [...present].sort(compareCodeUnits);
  const declared = Object.keys(spec.properties);
  const declaredPresent = declared.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
  const unknown = present.filter((key) => !Object.prototype.hasOwnProperty.call(spec.properties, key)).sort(compareCodeUnits);
  return [...declaredPresent, ...unknown];
}

function ordinalOf(record) {
  const order = record && typeof record === "object" ? record.order : undefined;
  const script = order && typeof order === "object" ? order.script : undefined;
  /* A record with no ordinal sorts after every record that has one, rather than
     at zero - "unset" is not "first". */
  return typeof script === "number" && Number.isFinite(script) ? script : Number.POSITIVE_INFINITY;
}

function idOf(record) {
  return record && typeof record === "object" && typeof record.id === "string" ? record.id : "";
}

/* Returns a NEW array; the input is never reordered in place. A serializer that
   mutates the document it was handed would make "inspecting is free" false in
   the least visible way possible. */
function orderCollection(spec, value) {
  const kind = spec && spec.collection;
  if (kind === "set") return [...value].sort((a, b) => compareCodeUnits(idOf(a), idOf(b)));
  if (kind === "ordinal")
    return [...value].sort((a, b) => {
      const left = ordinalOf(a);
      const right = ordinalOf(b);
      /* Ordinal first, then id. Sorting by both means array order and the
         declared ordinal can never disagree with each other. */
      if (left !== right) return left < right ? -1 : 1;
      return compareCodeUnits(idOf(a), idOf(b));
    });
  /* "ordered", or no declaration at all: array order is data. Scalar arrays
     inside a record - aliases, risks - are never sorted. */
  return value;
}

function serializeCanonical(document, options = {}) {
  const keyOrder = options.keyOrder === KEY_ORDER.JCS ? KEY_ORDER.JCS : KEY_ORDER.SCHEMA;

  function emit(spec, value, depth) {
    if (value === null) return "null";
    const type = typeof value;
    if (type === "string" || type === "boolean") return JSON.stringify(value);
    if (type === "number") {
      if (!Number.isFinite(value)) throw new Error(`cannot serialize the non-finite number ${value}`);
      /* JSON.stringify is ECMAScript Number::toString, which is precisely what
         RFC 8785 specifies, and it already normalizes -0 to 0. */
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      const items = orderCollection(spec, value);
      const inner = INDENT.repeat(depth + 1);
      const body = items.map((item) => inner + emit(spec && spec.items, item, depth + 1)).join(",\n");
      return `[\n${body}\n${INDENT.repeat(depth)}]`;
    }
    if (type === "object") {
      const keys = orderedKeys(spec, value, keyOrder);
      if (keys.length === 0) return "{}";
      const inner = INDENT.repeat(depth + 1);
      const properties = spec && spec.properties && !spec.passthrough ? spec.properties : null;
      const body = keys
        .map((key) => `${inner}${JSON.stringify(key)}: ${emit(properties ? properties[key] : undefined, value[key], depth + 1)}`)
        .join(",\n");
      return `{\n${body}\n${INDENT.repeat(depth)}}`;
    }
    throw new Error(`cannot serialize a value of type ${type}`);
  }

  /* Rule 4: exactly one trailing newline, and rule 2: the only line separators
     this function can produce are the "\n" written above. A CR reaching the
     file can therefore only come from inside a string, where it is data and is
     escaped as \r by JSON.stringify. */
  return `${emit(DOCUMENT, document, 0)}\n`;
}

/* RFC 8785. Reused rather than reimplemented: `canonicalJson` is already
   JCS-compatible for parsed-JSON input and is already checked against Node's
   crypto by the continuity manifest suite. */
function serializeHashForm(value) {
  return canonicalJson(value);
}

/* The declared key order for one record spec, exported so the drift guard can
   assert the writer and the schema still agree. P0 N5: schema-derived ordering
   depends on JS object key-insertion order surviving, which holds in V8 for
   non-integer keys - and no OFP field name is integer-like. */
function declaredKeyOrder(spec) {
  return spec && spec.properties ? Object.keys(spec.properties) : [];
}

module.exports = { serializeCanonical, serializeHashForm, declaredKeyOrder, compareCodeUnits, KEY_ORDER, INDENT };
