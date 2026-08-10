"use strict";

/* Strict JSON parsing for Open Film Project documents.

   Two things the platform parser cannot do, both of them contract rules:

   1. Reject duplicate object keys (canonical serialization rule 13). JSON.parse
      silently keeps the LAST of a duplicate set, so `{"id":"a","id":"b"}` is a
      document two conforming readers may read two different ways. There is no
      way to observe the duplicate through JSON.parse either - a reviver is
      handed the already-merged object - so the contract carries its own scanner.

   2. Reject a leading byte-order mark. Rule 1 is "UTF-8, no BOM", and it is
      written down because PowerShell redirection adds one on this platform. A
      BOM makes JSON.parse throw with a position but no explanation; naming it
      is the difference between a fixable report and a mystery.

   Everything else is RFC 8259 as written. This parser is deliberately not
   lenient: no comments, no trailing commas, no single quotes, no NaN. A
   permissive reader is how a format acquires an undocumented dialect. */

class OfpJsonError extends Error {
  constructor(code, message, offset, text) {
    /* Line and column are computed from the offset rather than tracked during
       the scan, so the hot path stays a plain index walk. */
    let line = 1;
    let column = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text.charCodeAt(i) === 0x0a) { line++; column = 1; } else { column++; }
    }
    super(`${message} (line ${line}, column ${column})`);
    this.name = "OfpJsonError";
    this.code = code;
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

function parseJsonStrict(text) {
  if (typeof text !== "string") throw new TypeError("parseJsonStrict expects a string");
  if (text.charCodeAt(0) === 0xfeff)
    throw new OfpJsonError("json.bom", "document starts with a byte-order mark; canonical documents are UTF-8 with no BOM", 0, text);

  let at = 0;

  function fail(code, message, offset = at) {
    throw new OfpJsonError(code, message, offset, text);
  }

  function skipWhitespace() {
    while (at < text.length && WHITESPACE.has(text.charCodeAt(at))) at++;
  }

  function expect(character) {
    if (text[at] !== character) fail("json.syntax", `expected ${JSON.stringify(character)}`);
    at++;
  }

  function parseString() {
    expect('"');
    let out = "";
    for (;;) {
      if (at >= text.length) fail("json.syntax", "unterminated string");
      const code = text.charCodeAt(at);
      if (code === 0x22) { at++; return out; }
      if (code === 0x5c) {
        at++;
        const escape = text[at];
        at++;
        if (escape === '"') out += '"';
        else if (escape === "\\") out += "\\";
        else if (escape === "/") out += "/";
        else if (escape === "b") out += "\b";
        else if (escape === "f") out += "\f";
        else if (escape === "n") out += "\n";
        else if (escape === "r") out += "\r";
        else if (escape === "t") out += "\t";
        else if (escape === "u") {
          const hex = text.slice(at, at + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("json.syntax", "malformed \\u escape", at);
          out += String.fromCharCode(parseInt(hex, 16));
          at += 4;
        } else fail("json.syntax", `unknown escape \\${escape ?? ""}`, at - 1);
        continue;
      }
      /* RFC 8259: unescaped control characters are not permitted in a string. */
      if (code < 0x20) fail("json.syntax", `unescaped control character U+${code.toString(16).padStart(4, "0")} in string`);
      out += text[at];
      at++;
    }
  }

  function parseNumber() {
    const start = at;
    if (text[at] === "-") at++;
    if (text[at] === "0") at++;
    else if (text[at] >= "1" && text[at] <= "9") { while (text[at] >= "0" && text[at] <= "9") at++; }
    else fail("json.syntax", "malformed number", start);
    if (text[at] === ".") {
      at++;
      if (!(text[at] >= "0" && text[at] <= "9")) fail("json.syntax", "malformed number: digits must follow the decimal point", start);
      while (text[at] >= "0" && text[at] <= "9") at++;
    }
    if (text[at] === "e" || text[at] === "E") {
      at++;
      if (text[at] === "+" || text[at] === "-") at++;
      if (!(text[at] >= "0" && text[at] <= "9")) fail("json.syntax", "malformed number: digits must follow the exponent", start);
      while (text[at] >= "0" && text[at] <= "9") at++;
    }
    return Number(text.slice(start, at));
  }

  function parseLiteral(word, value) {
    if (text.slice(at, at + word.length) !== word) fail("json.syntax", `expected ${word}`);
    at += word.length;
    return value;
  }

  function parseValue(depth) {
    /* A bounded depth keeps a hostile or corrupt document from exhausting the
       stack inside a validator that is supposed to report rather than crash. */
    if (depth > 200) fail("json.depth", "document nests deeper than 200 levels");
    skipWhitespace();
    const character = text[at];
    if (character === "{") return parseObject(depth);
    if (character === "[") return parseArray(depth);
    if (character === '"') return parseString();
    if (character === "t") return parseLiteral("true", true);
    if (character === "f") return parseLiteral("false", false);
    if (character === "n") return parseLiteral("null", null);
    if (character === "-" || (character >= "0" && character <= "9")) return parseNumber();
    if (at >= text.length) fail("json.syntax", "unexpected end of document");
    fail("json.syntax", `unexpected character ${JSON.stringify(character)}`);
  }

  function parseObject(depth) {
    expect("{");
    const out = {};
    const seen = new Set();
    skipWhitespace();
    if (text[at] === "}") { at++; return out; }
    for (;;) {
      skipWhitespace();
      const keyOffset = at;
      if (text[at] !== '"') fail("json.syntax", "object keys must be strings");
      const key = parseString();
      if (seen.has(key))
        throw new OfpJsonError("json.duplicate-key", `duplicate object key ${JSON.stringify(key)}`, keyOffset, text);
      seen.add(key);
      skipWhitespace();
      expect(":");
      /* Assigned through defineProperty so a key named __proto__ becomes an own
         data property rather than reassigning the prototype - otherwise a
         document could make its own content invisible to every later reader. */
      Object.defineProperty(out, key, { value: parseValue(depth + 1), writable: true, enumerable: true, configurable: true });
      skipWhitespace();
      if (text[at] === ",") { at++; continue; }
      if (text[at] === "}") { at++; return out; }
      fail("json.syntax", "expected ',' or '}'");
    }
  }

  function parseArray(depth) {
    expect("[");
    const out = [];
    skipWhitespace();
    if (text[at] === "]") { at++; return out; }
    for (;;) {
      out.push(parseValue(depth + 1));
      skipWhitespace();
      if (text[at] === ",") { at++; continue; }
      if (text[at] === "]") { at++; return out; }
      fail("json.syntax", "expected ',' or ']'");
    }
  }

  const value = parseValue(0);
  skipWhitespace();
  if (at < text.length) fail("json.syntax", "unexpected trailing content after the document");
  return value;
}

module.exports = { parseJsonStrict, OfpJsonError };
