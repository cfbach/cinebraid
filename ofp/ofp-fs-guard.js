"use strict";

/* INV-R1, enforced by mechanism.

       OPENING OR VALIDATING A PROJECT WRITES NOTHING.

       project.json is byte-identical, no .bak is produced, and no file is
       created inside the project directory. It holds for legacy, canonical,
       draft, newer-than-supported and structurally invalid documents alike.

   P-1 repaired one destructive load path - coverage normalization was clearing
   `approvedFile` and dirtying the project on open. Repairing one path is not
   the same as holding the invariant, and "we are careful" is not a mechanism:
   index rebuilds, caches and telemetry all want to write on open, and each one
   arrives with a good reason. So the guard wraps `fs` and refuses, rather than
   a test comparing hashes afterwards and hoping it looked in the right place.

   A hash comparison can only prove that a file it thought to check came back
   the same. This proves that no write was ATTEMPTED anywhere under the root,
   including files that did not exist before and would therefore hash to
   nothing on the way in.

   Scope is deliberately the project root and nothing else. Config bootstrap
   outside the project directory is not a violation, and sidecars that live
   elsewhere are unaffected. */

const fs = require("fs");
const path = require("path");

/* Every fs entry point that can create, modify, move or remove something.
   Listed explicitly rather than pattern-matched on the name, because a list
   that must be edited when Node adds an API is safer than a regex that
   silently stops matching one. */
const WRITE_METHODS = [
  "writeFile", "writeFileSync", "appendFile", "appendFileSync",
  "open", "openSync", "createWriteStream",
  "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync",
  "rename", "renameSync", "rm", "rmSync", "rmdir", "rmdirSync",
  "unlink", "unlinkSync", "truncate", "truncateSync", "ftruncate", "ftruncateSync",
  "copyFile", "copyFileSync", "cp", "cpSync",
  "link", "linkSync", "symlink", "symlinkSync",
  "chmod", "chmodSync", "chown", "chownSync", "utimes", "utimesSync",
  "write", "writeSync", "writev", "writevSync",
];

const PROMISES_WRITE_METHODS = [
  "writeFile", "appendFile", "open", "mkdir", "mkdtemp", "rename", "rm", "rmdir",
  "unlink", "truncate", "copyFile", "cp", "link", "symlink", "chmod", "chown", "utimes",
];

/* `open` and `openSync` are on the list because that is how a write begins, but
   opening for reading is the normal way to read a file. Only the flags that can
   modify count. */
function flagsAreWriteCapable(flags) {
  if (flags === undefined || flags === null) return false;
  if (typeof flags === "number") {
    /* O_WRONLY(1) | O_RDWR(2) | O_CREAT(64) | O_TRUNC(512) | O_APPEND(1024),
       taken from fs.constants so the numbers are the platform's own. */
    const writable = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;
    return (flags & writable) !== 0;
  }
  return /[waxr]\+|^[wax]/.test(String(flags));
}

class InvR1Violation extends Error {
  constructor(method, target, root) {
    super(`INV-R1 violated: fs.${method} would write ${target} inside the project root ${root}. Opening or validating a project must write nothing.`);
    this.name = "InvR1Violation";
    this.method = method;
    this.target = target;
    this.root = root;
  }
}

function isInside(root, candidate) {
  if (typeof candidate !== "string" || !candidate) return false;
  let resolved;
  try {
    resolved = path.resolve(candidate);
  } catch { return false; }
  const relative = path.relative(root, resolved);
  /* "" means the root itself, which counts. A relative path that climbs out
     with ".." or is absolute is somewhere else entirely. */
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathOf(argument) {
  if (typeof argument === "string") return argument;
  if (argument instanceof URL) return argument.pathname;
  if (Buffer.isBuffer(argument)) return argument.toString();
  return null;
}

/* Run `work` with every fs write path under `root` refused.

   Returns { result, attempts } where `attempts` lists every refused call - so a
   test can assert not merely that nothing was written but that the guard was
   actually armed and watching the right directory. Violations throw by default;
   `collectOnly` records them and lets the call return undefined instead, which
   is how a test can observe several violations in one run rather than only the
   first. */
function withNoWritesUnder(root, work, { collectOnly = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const attempts = [];
  const restore = [];

  function guard(owner, method, isPromises) {
    const original = owner[method];
    if (typeof original !== "function") return;
    restore.push(() => { owner[method] = original; });
    owner[method] = function guarded(...args) {
      const target = pathOf(args[0]);
      /* `open` defaults to "r", so an open with no flags is a read and is let
         through. `createWriteStream` defaults to "w" - the name says so - and is
         always a write. Getting this backwards is how a guard passes vacuously. */
      const opensForWrite = (method === "open" || method === "openSync")
        ? flagsAreWriteCapable(args[1] && typeof args[1] === "object" && args[1].flags !== undefined ? args[1].flags : args[1])
        : true;
      if (target !== null && opensForWrite && isInside(resolvedRoot, target)) {
        const violation = new InvR1Violation(method, target, resolvedRoot);
        attempts.push({ method, target, isPromises });
        if (!collectOnly) throw violation;
        return undefined;
      }
      return original.apply(this, args);
    };
  }

  for (const method of WRITE_METHODS) guard(fs, method, false);
  for (const method of PROMISES_WRITE_METHODS) guard(fs.promises, method, true);

  try {
    return { result: work(), attempts };
  } finally {
    /* Restored in reverse so nested guards unwind cleanly, and in a finally so
       a throw inside `work` cannot leave the process with a patched fs. */
    for (let index = restore.length - 1; index >= 0; index--) restore[index]();
  }
}

module.exports = { withNoWritesUnder, InvR1Violation, WRITE_METHODS, PROMISES_WRITE_METHODS, isInside };
