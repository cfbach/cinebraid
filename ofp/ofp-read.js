"use strict";

/* Reading a project, with INV-R1 held by the guard rather than by intention.

   This is the entry point P1 offers, and it is deliberately not wired into
   CineBraid's normal save/load. Nothing here changes how a real project is
   opened or persisted; the runtime still reads and writes legacy
   `schemaVersion 6.7` documents exactly as it did. This module exists so the
   contract can be exercised from tests and a CLI without a browser and without
   a route that could be reached by accident.

   THE CANONICAL FILE NAME IS PINNED HERE.

       project.ofp.json

   Pinned because `.gitattributes` has to name it to hold the LF rule, and a
   name that is decided in two places is a name that will differ in two places.
   The legacy document keeps its own name, `project.json`, and keeps its own
   lineage. */

const fs = require("fs");
const path = require("path");

const { validateOfpDocument } = require("./ofp-validate");
const { withNoWritesUnder } = require("./ofp-fs-guard");

const CANONICAL_FILENAME = "project.ofp.json";
const LEGACY_FILENAME = "project.json";

/* Read and validate one document. The read happens inside the write guard, so
   a validator that grew a cache, an index or a `.bak` would fail here rather
   than in a review six months later. */
function readOfpDocument(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  const guardRoot = options.guardRoot ? path.resolve(options.guardRoot) : path.dirname(resolved);
  const { result, attempts } = withNoWritesUnder(guardRoot, () => {
    /* utf8, and the strict parser rejects a BOM rather than silently eating it,
       because a BOM in a canonical document is a contract violation worth
       naming (PowerShell redirection adds one on this platform). */
    const text = fs.readFileSync(resolved, "utf8");
    return { text, validation: validateOfpDocument(text, options) };
  });
  return { file: resolved, guardRoot, writeAttempts: attempts, ...result };
}

/* Inspect a project directory without deciding anything about it.

   Prefers the canonical document when one exists, falls back to the legacy one,
   and reports plainly when neither does. Finding a legacy `project.json` is a
   completely ordinary outcome and produces a legacy classification - never a
   conversion, never a draft file, never a write. */
function inspectProject(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const canonical = path.join(root, CANONICAL_FILENAME);
  const legacy = path.join(root, LEGACY_FILENAME);
  const file = fs.existsSync(canonical) ? canonical : fs.existsSync(legacy) ? legacy : null;
  if (!file)
    return { projectRoot: root, file: null, validation: null, writeAttempts: [], reason: `neither ${CANONICAL_FILENAME} nor ${LEGACY_FILENAME} is present` };
  return { projectRoot: root, ...readOfpDocument(file, { ...options, guardRoot: root }) };
}

/* A content+metadata snapshot of every file under a root, for proving INV-R1
   from the outside as well as from the guard. The guard proves no write was
   attempted; this proves nothing changed and nothing appeared. Both, because
   they fail in different ways: a guard that was never armed passes vacuously,
   and a snapshot comparison cannot see a file that was written and deleted. */
function snapshotTree(root) {
  const resolved = path.resolve(root);
  const entries = new Map();
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) { walk(full); continue; }
      entries.set(path.relative(resolved, full).split(path.sep).join("/"), {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        /* The bytes themselves, not a digest: a comparison failure should be
           able to say what changed, and project files are small. */
        bytes: fs.readFileSync(full).toString("base64"),
      });
    }
  }
  if (fs.existsSync(resolved)) walk(resolved);
  return entries;
}

function diffSnapshots(before, after) {
  const changes = [];
  for (const [name, state] of after) {
    const previous = before.get(name);
    if (!previous) { changes.push({ name, change: "created" }); continue; }
    if (previous.bytes !== state.bytes) changes.push({ name, change: "content-changed" });
    else if (previous.mtimeMs !== state.mtimeMs) changes.push({ name, change: "mtime-changed" });
  }
  for (const name of before.keys()) if (!after.has(name)) changes.push({ name, change: "removed" });
  return changes;
}

module.exports = { CANONICAL_FILENAME, LEGACY_FILENAME, readOfpDocument, inspectProject, snapshotTree, diffSnapshots };
