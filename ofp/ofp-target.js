"use strict";

/* Stable target addressing.

       target := { subject?: <subject-ref>, path?: <json-pointer> }

   `subject` is a "/"-joined chain of `type:id` steps naming a RECORD; `path` is
   an ordinary RFC 6901 pointer rooted at that record. Subject omitted means the
   document root. Path omitted or "" means the whole record.

   One restriction does all the work:

       Resolution MUST fail if traversing `path` would enter an array.

   That is what makes array indexes structurally incapable of being identity,
   rather than merely discouraged by a lint. It also makes root-scoped targets
   safe for free: `/meta/title` resolves and `/shots/0/framing` cannot, with no
   special case for the root. Anything whose elements deserve their own evidence
   has to become an identifiable collection - and is then reachable as a
   subject, which is the modelling question being forced at the right moment.

   Note the asymmetry, because it is the entire design: finding `shot:sh-0100`
   walks the `shots` array, and that is fine, because the record is found by ID
   and the position is never recorded. The prohibition is on `path`, where a
   position WOULD become the address. */

const { CONTAINMENT } = require("./ofp-schema");

const SUBJECT_STEP_PATTERN = /^([A-Za-z][A-Za-z0-9-]*):(.+)$/;

/* A sentinel, because `undefined` is also a legitimate "the key is not there"
   and the claim payload must be able to tell the two apart deliberately rather
   than by accident. */
const ABSENT = Symbol("ofp.absent");

function parseSubjectRef(text) {
  if (typeof text !== "string" || text.length === 0)
    return { ok: false, reason: "subject must be a non-empty string" };
  const steps = [];
  for (const raw of text.split("/")) {
    const match = SUBJECT_STEP_PATTERN.exec(raw);
    if (!match) return { ok: false, reason: `subject step ${JSON.stringify(raw)} is not of the form type:id` };
    steps.push({ type: match[1], id: match[2] });
  }
  return { ok: true, steps };
}

/* RFC 6901, unchanged. "" is the whole document/record; anything else must
   start with "/". `~1` is "/" and `~0` is "~", in that order. */
function parseJsonPointer(text) {
  if (text === undefined || text === null || text === "") return { ok: true, tokens: [] };
  if (typeof text !== "string") return { ok: false, reason: "path must be a string" };
  if (text[0] !== "/") return { ok: false, reason: `path ${JSON.stringify(text)} must be empty or start with "/"` };
  const tokens = [];
  for (const raw of text.slice(1).split("/")) {
    if (/~(?![01])/.test(raw)) return { ok: false, reason: `path segment ${JSON.stringify(raw)} contains an invalid "~" escape` };
    tokens.push(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return { ok: true, tokens };
}

function formatTargetString(target) {
  const subject = target && typeof target.subject === "string" ? target.subject : "";
  const path = target && typeof target.path === "string" ? target.path : "";
  return `${subject}#${path}`;
}

function descendContainer(record, containerPath) {
  let current = record;
  for (const segment of containerPath.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/* Resolve a subject-ref to a record. Returns
   { ok, record, ownerType } or { ok: false, code, reason }. */
function resolveSubject(document, subjectRef) {
  const parsed = parseSubjectRef(subjectRef);
  if (!parsed.ok) return { ok: false, code: "malformed", reason: parsed.reason };

  let current = document;
  let ownerType = "project";
  for (const step of parsed.steps) {
    const containment = CONTAINMENT[step.type];
    if (!containment)
      return { ok: false, code: "unresolvable", reason: `${JSON.stringify(step.type)} is not an addressable record type` };
    /* Subject types are specific, never a generic `entity`, so "you said
       character, that is a prop" is caught here rather than accepted. */
    if (!containment.scopes.includes(ownerType))
      return { ok: false, code: "unresolvable", reason: `${step.type} cannot appear inside ${ownerType}; it is contained by ${containment.scopes.join(" / ")}` };
    const collection = descendContainer(current, containment.container);
    if (!Array.isArray(collection))
      return { ok: false, code: "unresolvable", reason: `${containment.container} is missing or not an array` };
    const found = collection.find((entry) => entry && typeof entry === "object" && entry.id === step.id);
    if (found === undefined)
      return { ok: false, code: "unresolvable", reason: `no ${step.type} with id ${JSON.stringify(step.id)}` };
    current = found;
    ownerType = step.type;
  }
  return { ok: true, record: current, ownerType };
}

/* Resolve a full target. Returns

     { ok: true,  present, value, record, targetString }
     { ok: false, code, reason, targetString }

   `code` is "unresolvable", "array-traversal" or "malformed". `present` false
   with ok true is the ABSENT case: the address is valid, the document has no
   value there, and the claim payload must OMIT `v` rather than set it null. */
function resolveTarget(document, target) {
  const targetString = formatTargetString(target);
  if (!target || typeof target !== "object" || Array.isArray(target))
    return { ok: false, code: "malformed", reason: "target must be an object", targetString };

  let record = document;
  if (target.subject !== undefined) {
    if (typeof target.subject !== "string")
      return { ok: false, code: "malformed", reason: "target.subject must be a string", targetString };
    const subject = resolveSubject(document, target.subject);
    if (!subject.ok) return { ...subject, targetString };
    record = subject.record;
  }

  const pointer = parseJsonPointer(target.path);
  if (!pointer.ok) return { ok: false, code: "malformed", reason: pointer.reason, targetString };

  let current = record;
  let present = true;
  for (const token of pointer.tokens) {
    if (Array.isArray(current))
      return {
        ok: false,
        code: "array-traversal",
        reason: `path enters an array at ${JSON.stringify(token)}; array positions can never be identity`,
        targetString,
      };
    if (!present) continue;
    if (current === null || typeof current !== "object")
      return { ok: false, code: "unresolvable", reason: `path traverses ${current === null ? "null" : typeof current}, which has no members`, targetString };
    if (!Object.prototype.hasOwnProperty.call(current, token)) {
      /* The address is well-formed and the document simply has no value there.
         Keep walking so that a later token entering an array is still reported
         as array traversal rather than being masked by the absence. */
      present = false;
      current = undefined;
      continue;
    }
    current = current[token];
  }

  return { ok: true, present, value: present ? current : ABSENT, record, targetString };
}

module.exports = {
  ABSENT,
  SUBJECT_STEP_PATTERN,
  parseSubjectRef,
  parseJsonPointer,
  formatTargetString,
  resolveSubject,
  resolveTarget,
};
