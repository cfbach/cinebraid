/* CineBraid — LOCAL FILE AFFORDANCES V1, the server half.
 *
 * CineBraid is Windows-first and local-first. Wherever it shows a real media file
 * that actually exists on this machine, the filmmaker should be able to reach that
 * exact file. This module answers where the file is, and opens Explorer on it.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES THAT SHAPE EVERY LINE BELOW.
 *
 * 1. THE BROWSER NEVER NAMES A FILESYSTEM PATH.
 *
 *    There is deliberately no `{ path: "C:\\whatever" }` endpoint here. A caller
 *    supplies a DURABLE MEDIA IDENTITY — `asset:<ledger id>` or `path:<project
 *    relative media path>`, the same two-domain key the production-media
 *    projection already mints — and this module resolves the project root itself,
 *    resolves the identity inside it, and proves containment. The reach a caller
 *    has is therefore exactly the reach GET /assets/<path> already grants: media
 *    directories of one project it is entitled to. Nothing new became addressable.
 *
 * 2. THE PROJECT ROOT IS RESOLVED, NEVER RECEIVED.
 *
 *    Which project is decided from a contained slug through the helper the caller
 *    passes in — the same containment the rest of the server applies to
 *    `config.activeProject`. A media identity belonging to Film A cannot resolve
 *    through Film B's root merely because the filenames match, because the root is
 *    chosen first and the identity is looked up INSIDE it.
 *
 * 3. NO SHELL, EVER.
 *
 *    Explorer is launched with `spawn(..., { shell: false })`. A filename may
 *    legally contain a space, `&`, `^`, `%`, `(`, `)`, `;`, `!`, `'` and any
 *    Unicode; through a shell every one of those is a hazard, and through
 *    CreateProcess none of them is. `explorerRevealCommand()` is exported pure so
 *    a test can inspect the exact argv without opening a window.
 *
 * ---------------------------------------------------------------------------
 * THE WINDOWS DETAIL THAT IS NOT A DETAIL, measured on this platform rather than
 * assumed:
 *
 *    spawn("explorer.exe", ["/select," + file])            OPENS THE WRONG FOLDER
 *    spawn("explorer.exe", ['/select,"' + file + '"'],
 *          { windowsVerbatimArguments: true })             selects the exact file
 *
 * Node quotes an argv member containing a space as one MSVCRT token — `"/select,C:
 * \My Shots\a.png"` — and explorer.exe does not parse its command line that way.
 * It silently drops the argument and opens the user's Documents folder instead,
 * which is precisely the confident-wrong-answer this slice exists to prevent, and
 * it is invisible in every test that only asserts the process started.
 *
 * `windowsVerbatimArguments` is NOT a shell. It stops Node re-quoting and hands the
 * string to CreateProcess, which passes it to explorer.exe and to nothing else, so
 * no metacharacter is ever interpreted by anything. The only character that could
 * close the quoting is `"`, and Win32 forbids it in a filename — this module still
 * refuses rather than relying on that, because a guarantee that depends on a
 * platform rule nobody restated is a guarantee that erodes.
 *
 * A DIRECTORY needs none of this: a bare path is an ordinary argv member that
 * explorer.exe handles correctly however Node quotes it, so `Open project folder`
 * uses the plain array form and gains nothing from verbatim mode.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DOES NOT DO. It does not move, rename, copy, delete or repair a
 * file, and it does not try to find a file that is not where its record says. A
 * missing file is REPORTED, and the filmmaker decides. It writes nothing anywhere.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const MediaAssetService = require("./media-asset-service");
const {
  localFileWords,
  parseLocalFileKey,
} = require("./public/shared-local-file");

/* explorer.exe exits 1 on success. It is a shell verb dispatcher, not a program
   with an exit contract, and treating a non-zero status as failure is how a
   working reveal gets reported as broken. Only a SPAWN error means it did not
   run. */
const EXPLORER = "explorer.exe";

class LocalFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocalFileError";
    this.code = code;
  }
}

/* ---------------------------------------------------------------------------
   RESOLUTION.

   P1 — ONE PROJECT-DIRECTORY RESOLVER FOR THIS WHOLE SEAM, and it is PHYSICAL.

   `MediaAssetService.resolvePhysicalProjectDir` proves the slug is one segment
   below the projects root AND that the directory it names really is that slug's
   own directory under the canonical root — so a junction at `projects/film-b`
   cannot make Film A's media, Film A's ledger or Film A's folder answer under Film
   B's identity, and cannot point a project at somewhere outside the root at all.

   EVERY entry point below goes through this one function. There is deliberately
   not a stricter rule for revealing a file and a weaker one for opening a folder:
   that split is exactly how the first version of this seam ended up refusing a
   junctioned media path while happily opening a junctioned project root. */
function projectDirectory(projectsRoot, slug) {
  return MediaAssetService.resolvePhysicalProjectDir(projectsRoot, slug);
}

/* Which refusals the caller is owed a distinct reason for. A redirected project
   root is not "no such project" — the directory is right there — and saying so is
   what makes the state debuggable rather than mysterious. */
function projectRefusalReason(resolved) {
  return resolved && resolved.reason ? resolved.reason : "no-contained-project";
}

/* Containment, proven the way server.js's insideDirectory() proves it, and applied
   to the JOINED result rather than to the fragment. A fragment that passed its
   grammar check can still resolve outside once joined — on Windows a trailing dot
   or space is stripped by the filesystem, and a device name is not a file — so the
   answer that matters is about the path that will actually be handed to Explorer. */
function containedFile(projectDir, relativePath) {
  const base = path.resolve(projectDir);
  const target = path.resolve(base, relativePath);
  const rel = path.relative(base, target);
  if (!rel) return "";
  if (path.isAbsolute(rel)) return "";
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || rel.startsWith("../")) return "";
  return target;
}

/* The real path, once, and only to compare. A junction or symlink inside a media
   directory can point anywhere, and server.js already settled the policy for that
   case at insideRealDirectory(): containment is decided on real paths and a
   redirection out of the root is refused rather than followed. Restated here for
   the reveal seam rather than a different rule being invented for it.

   A path that cannot be realpath'd — because it is not there — is NOT refused
   here: that is the `missing` case, and it is answered by the caller with the
   recorded location so the filmmaker learns what went.

   THE COST, STATED. A filmmaker who junctions `projects/<slug>/media` onto a fast
   drive gets a refusal from this seam while GET /assets/<path> — which checks
   containment lexically — still shows them the picture. That is a real
   inconsistency and it is the direction chosen on purpose: revealing opens a
   native window on a location and is a filesystem-authority act, closer in kind to
   the migration write that established this rule than to serving bytes over a
   socket. CineBraid's supported way to keep media elsewhere is `workspace.mediaRoot`,
   which copies it in, not a reparse point under the project root.

   P1 — `realProjectDir` IS PASSED IN, ALREADY PROVEN. It used to be derived here
   with `fs.realpathSync(projectDir)`, which made the comparison worthless the
   moment the PROJECT directory was itself a junction: the real target and the real
   project root both resolved into Film A, `path.relative` said "contained", and the
   check passed while the whole project identity had been redirected. The boundary
   is now settled once, before this runs, and this measures against that answer. */
function escapesRealRoot(realProjectDir, target) {
  let realRoot;
  let realTarget;
  try {
    realRoot = fs.realpathSync.native(realProjectDir);
  } catch {
    return false; /* no root to compare against; ordinary containment already held */
  }
  try {
    realTarget = fs.realpathSync.native(target);
  } catch {
    return false; /* nothing there — `missing`, not an escape */
  }
  const normalise = (value) => (process.platform === "win32" ? String(value).toLowerCase() : String(value));
  const base = path.resolve(normalise(realRoot));
  const resolved = path.resolve(normalise(realTarget));
  const rel = path.relative(base, resolved);
  if (!rel) return true;
  if (path.isAbsolute(rel)) return true;
  return rel === ".." || rel.startsWith(`..${path.sep}`) || rel.startsWith("../");
}

/* ---------------------------------------------------------------------------
   THE ANSWER.

   localFileAffordance({ projectsRoot, slug, key }) -> one of the four states
   public/shared-local-file.js declares, plus what the surface needs to act:

     available      `path` is an absolute file that exists right now
     missing        `recordedPath` is where the durable record says it should be
     not-local      CineBraid knows the identity and has no local file for it
     unresolvable   the identity did not survive validation, or names nothing

   `resolvedBy` names WHICH domain answered, so a surface can say "resolved by
   durable identity" honestly rather than implying one when the other was used. */
function localFileAffordance(options = {}) {
  const key = String(options.key || "");
  const parsed = parseLocalFileKey(key);
  const answer = (state, extra = {}) => ({
    state,
    key,
    path: "",
    recordedPath: "",
    resolvedBy: "",
    message: localFileWords(state),
    ...extra,
  });

  if (!parsed.domain) return answer("unresolvable", { reason: "malformed-identity" });

  /* P1 — THE PROJECT DIRECTORY IS VALIDATED BEFORE ANYTHING ELSE HAPPENS, and in
     particular before the ledger is read. A junctioned project root would otherwise
     have already answered from another project's ledger by the time any path was
     examined. */
  const resolved = projectDirectory(options.projectsRoot, options.slug);
  if (!resolved.ok) return answer("unresolvable", { reason: projectRefusalReason(resolved) });
  const projectDir = resolved.realDir;

  /* IDENTITY FIRST. A durable assetId survives the rename an approval performs; a
     stored path does not. When the ledger knows this id, its recorded path is the
     authoritative one and the key's own path domain is never consulted. */
  let relativePath = "";
  let resolvedBy = "";
  if (parsed.domain === "asset") {
    const located = MediaAssetService.assetLocation({
      projectsRoot: options.projectsRoot,
      slug: options.slug,
      assetId: parsed.value,
    });
    /* An id this project's ledger does not hold. Emphatically NOT a reason to fall
       back to a filename or to another project's ledger: an identity that resolves
       nowhere resolves nowhere. */
    if (!located.known) return answer("unresolvable", { reason: "identity-not-in-ledger" });
    relativePath = located.path;
    resolvedBy = "ledger";
    /* The ledger itself already recorded this file as gone. Report that without
       touching the disk — it is the same answer, arrived at from the record. */
    if (located.missing) {
      const recorded = containedFile(projectDir, relativePath);
      return answer("missing", { recordedPath: recorded || path.join(projectDir, relativePath), resolvedBy });
    }
  } else {
    relativePath = parsed.value;
    resolvedBy = "path";
  }

  const target = containedFile(projectDir, relativePath);
  if (!target) return answer("unresolvable", { reason: "outside-project", resolvedBy });
  if (escapesRealRoot(projectDir, target))
    return answer("unresolvable", { reason: "redirected-outside-project", resolvedBy });

  let stat;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
      return answer("missing", { recordedPath: target, resolvedBy });
    return answer("unresolvable", { reason: "unreadable", resolvedBy });
  }
  /* A directory is not the media file this identity claims to be. Revealing it
     would open something, which reads as success. */
  if (!stat.isFile()) return answer("unresolvable", { reason: "not-a-file", resolvedBy });

  return answer("available", { path: target, recordedPath: target, resolvedBy });
}

/* ---------------------------------------------------------------------------
   THE PROJECT FOLDER.

   Resolved from the contained slug, exactly like every media identity above, and
   NEVER reconstructed from the project's title. Two projects may share a title;
   only one of them is the directory the filmmaker is working in. */
function projectFolderAffordance(options = {}) {
  /* P1 — THE SAME RESOLVER THE MEDIA PATH USES. Opening a folder looked like the
     harmless half of this seam and was the more dangerous one: it took the project
     directory at its word, so a junction pointed `Open project folder` at another
     project — or at any directory on the machine — and Explorer went there. */
  const resolved = projectDirectory(options.projectsRoot, options.slug);
  if (!resolved.ok)
    return {
      state: "unresolvable",
      path: "",
      reason: projectRefusalReason(resolved),
      message: localFileWords("unresolvable"),
    };
  const projectDir = resolved.realDir;
  let stat;
  try {
    stat = fs.statSync(projectDir);
  } catch {
    /* `unresolvable`, not `missing`. A media file goes missing while its durable
       record stays true; a project folder that is not there means there is no such
       project, which is a different sentence and must not borrow the media one.
       The reason carries the detail without inventing a fifth state. */
    return {
      state: "unresolvable",
      path: "",
      recordedPath: projectDir,
      reason: "no-project-directory",
      message: "CineBraid cannot find a folder for this project",
    };
  }
  if (!stat.isDirectory())
    return { state: "unresolvable", path: "", reason: "not-a-directory", message: localFileWords("unresolvable") };
  return { state: "available", path: projectDir, recordedPath: projectDir, message: "Stored on this computer" };
}

/* ---------------------------------------------------------------------------
   THE COMMANDS, pure, so the argv can be asserted without opening a window.

   Both refuse a `"` outright. It cannot occur in a Win32 filename, so this can
   only fire on a value that did not come from the filesystem — and that is exactly
   when refusing matters. */
function assertQuotable(target) {
  const value = String(target || "");
  if (!value) throw new LocalFileError("LOCAL_FILE_NO_TARGET", "No file was named.");
  if (value.includes('"'))
    throw new LocalFileError("LOCAL_FILE_UNSAFE_PATH", "That location cannot be opened safely.");
  if (value.includes("\0"))
    throw new LocalFileError("LOCAL_FILE_UNSAFE_PATH", "That location cannot be opened safely.");
  return value;
}

/* `/select,"<file>"` as ONE verbatim argument. The quotes belong around the path,
   inside the switch's own argument — not around the whole token, which is what
   Node's default quoting produces and what explorer.exe ignores. */
function explorerRevealCommand(file) {
  const value = assertQuotable(file);
  return {
    file: EXPLORER,
    args: [`/select,"${value}"`],
    options: { windowsVerbatimArguments: true, windowsHide: false, detached: true, stdio: "ignore", shell: false },
  };
}

/* A plain argv member. No verbatim mode, because explorer.exe parses a lone path
   correctly however Node quotes it, and verbatim mode would then be an unearned
   exception to "let Node do the quoting". */
function explorerOpenCommand(directory) {
  const value = assertQuotable(directory);
  return {
    file: EXPLORER,
    args: [value],
    options: { windowsHide: false, detached: true, stdio: "ignore", shell: false },
  };
}

/* ---------------------------------------------------------------------------
   LAUNCHING.

   `spawner` is injectable so the suites can prove the exact argv and the exact
   options without opening dozens of Explorer windows. The default is
   child_process.spawn and nothing else — there is no shell path to fall back to.

   Resolves as soon as the process is known to have STARTED. Waiting for explorer
   to exit would mean waiting for a status that is 1 on success, and holding a
   request open for a window the user is already looking at. */
function launch(command, spawner = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawner(command.file, command.args, command.options);
    } catch (error) {
      return reject(new LocalFileError("LOCAL_FILE_LAUNCH_FAILED", String(error?.message || error)));
    }
    /* Detached, and released, so CineBraid does not keep a handle on a window the
       filmmaker owns and a shutdown does not take their Explorer with it. */
    if (child && typeof child.unref === "function") child.unref();

    /* A stub spawner returns a plain object. It has already told us everything it
       is going to, so answering now is correct rather than a timeout in disguise. */
    if (!child || typeof child.once !== "function") return resolve({ launched: true });

    /* Node emits exactly one of these for every spawn, so there is no third
       outcome to time out on — and no race to arbitrate with a timer.

       `spawn` is the settle point rather than `exit`, deliberately: explorer.exe
       exits 1 on success, so waiting for a status would mean either holding the
       request open for a window the filmmaker is already looking at, or reading a
       working reveal as a failure. */
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    child.once("error", (error) =>
      finish(reject, new LocalFileError("LOCAL_FILE_LAUNCH_FAILED", String(error?.message || error))));
    child.once("spawn", () => finish(resolve, { launched: true }));
  });
}

/* Windows-first, and it says so rather than pretending. V1 ships one file manager;
   Finder and the Linux desktops are explicitly out of scope, and a surface that
   silently did nothing on another platform would be the dishonest version. */
function fileManagerAvailable(platform = process.platform) {
  return platform === "win32";
}

const UNSUPPORTED_PLATFORM_MESSAGE =
  "Opening a file manager is supported on Windows in this version of CineBraid.";

async function revealLocalFile(options = {}) {
  const answer = localFileAffordance(options);
  if (answer.state !== "available") return { ok: false, ...answer };
  if (!fileManagerAvailable(options.platform))
    return { ok: false, ...answer, state: "unsupported", message: UNSUPPORTED_PLATFORM_MESSAGE };
  await launch(explorerRevealCommand(answer.path), options.spawner);
  return { ok: true, ...answer };
}

async function openProjectFolder(options = {}) {
  const answer = projectFolderAffordance(options);
  if (answer.state !== "available") return { ok: false, ...answer };
  if (!fileManagerAvailable(options.platform))
    return { ok: false, ...answer, state: "unsupported", message: UNSUPPORTED_PLATFORM_MESSAGE };
  await launch(explorerOpenCommand(answer.path), options.spawner);
  return { ok: true, ...answer };
}

module.exports = {
  EXPLORER,
  LocalFileError,
  UNSUPPORTED_PLATFORM_MESSAGE,
  containedFile,
  explorerOpenCommand,
  explorerRevealCommand,
  fileManagerAvailable,
  launch,
  localFileAffordance,
  openProjectFolder,
  projectFolderAffordance,
  revealLocalFile,
};
