/* The registered-workflow record: discovery, registration, and staleness.
 *
 * A workflow folder is CONFIGURATION. CineBraid does not own the files in it, does not
 * copy them, does not repair them and never writes to them — a filmmaker's ComfyUI
 * workflows stay a filmmaker's ComfyUI workflows, and the only thing recorded here is
 * what CineBraid was told about them and what it observed.
 *
 * WHAT A REGISTRATION IS
 *
 *     relativePath   identity. Stable, human-readable, and the same string the
 *                    filmmaker sees in their own folder.
 *     contentHash    sha256 of the bytes AS OF the last scan.
 *     format         api | ui | unknown | unparseable, from comfy-workflow.js.
 *     mapping        the CONFIRMED semantic bindings, or none.
 *     mappedHash     the hash the mapping was confirmed AGAINST.
 *     validatedAtConfirmation  that the mapping fitted the file WHEN A HUMAN AGREED TO IT.
 *
 * That last field is deliberately not called `lastValidation`. Whether a mapping still
 * fits is never read from this record — workflowState() recomputes it from the bytes on
 * disk on every single read, so a workflow edited outside CineBraid is caught by the next
 * screen that looks at it rather than by the dispatch that used it. A stored `valid` flag
 * would be a second answer to a question that already has one, and the older answer is
 * always the wrong one. What IS worth keeping is the historical fact: at this moment, a
 * person looked at this mapping against this content and it fitted.
 *
 * `contentHash` and `mappedHash` are two fields on purpose. One says what the file is;
 * the other says what a human was looking at when they agreed to it. A workflow whose
 * two hashes differ is not broken — it is UNREVIEWED, which is a different sentence and
 * a different screen, and collapsing them into one "valid" flag is how an edited graph
 * gets dispatched under a mapping nobody has seen since.
 *
 * WHY ITS OWN FILE rather than data/config.json.
 *
 * accounts-api.js keeps account connections inside config.json and says why: the secret
 * registry only masks what goes through config.js, so a private credential file would
 * be a credential store outside the one mechanism that protects credentials. That
 * argument is about SECRETS, and this registry holds none — a relative path, a hash and
 * a node id are not credentials and are deliberately not maskable.
 *
 * The argument that decides it the other way is mergeConfig(): PUT /api/config is a
 * deep MERGE, and a deep merge over an array of registrations cannot express a removal.
 * A workflow deleted from the folder would survive every subsequent save. So the
 * registry is its own atomically-written document beside config.json, and the two
 * SCALARS a merge handles correctly — server URL and folder — stay in config.json where
 * every other setting lives.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  ComfyWorkflowError,
  detectWorkflowFormat,
  inspectWorkflow,
  mappingFromRequest,
  suggestMappings,
  validateMapping,
  workflowContentHash,
} = require("./comfy-workflow");

const REGISTRY_VERSION = 1;
const REGISTRY_PATH = process.env.CINEBRAID_COMFY_REGISTRY_PATH
  ? path.resolve(process.env.CINEBRAID_COMFY_REGISTRY_PATH)
  : path.join(__dirname, "data", "comfy-workflows.json");

/* A ceiling on what a scan will read, so pointing the setting at a large tree is a slow
   answer rather than a hung server. Both are stated to the filmmaker when they bite. */
const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_FILES = 400;
const MAX_WORKFLOW_BYTES = 8 * 1024 * 1024;

class ComfyRegistryError extends Error {
  constructor(code, message, detail = {}, status = 400) {
    super(message);
    this.name = "ComfyRegistryError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function nowIso() {
  return new Date().toISOString();
}

/* ---------------------------------------------------------------------------
   The folder.

   An absolute path the filmmaker typed. It is validated on every use rather than
   trusted from the moment it was saved, because a folder that existed when it was
   configured can be gone, renamed or on an unplugged drive by the time a scan runs —
   and "0 workflows found" is a much worse answer than "that folder is not there". */
function resolveWorkflowFolder(configured) {
  const raw = text(configured);
  if (!raw) throw new ComfyRegistryError("COMFY_FOLDER_UNSET", "No ComfyUI workflow folder is set.", {}, 400);
  const expanded = raw.startsWith("~")
    ? path.join(process.env.USERPROFILE || process.env.HOME || "", raw.slice(1))
    : raw;
  const resolved = path.resolve(expanded);
  if (!path.isAbsolute(resolved))
    throw new ComfyRegistryError("COMFY_FOLDER_INVALID", "The workflow folder must be a full path.", { folder: raw }, 400);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new ComfyRegistryError("COMFY_FOLDER_MISSING", `CineBraid cannot see the folder ${resolved}.`, { folder: resolved }, 400);
  }
  if (!stat.isDirectory())
    throw new ComfyRegistryError("COMFY_FOLDER_NOT_A_FOLDER", `${resolved} is a file, not a folder.`, { folder: resolved }, 400);
  /* Resolved through its real path so a junction pointing somewhere else is read as
     what it actually is — the same test server.js's realDirectory() applies to a
     workspace root, for the same reason. */
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/* A file's identity WITHIN the folder. Rejected if it escapes — a registration is a
   name inside a configured folder, and a name that resolves outside it is not one. */
function resolveWorkflowFile(folder, relativePath) {
  const rel = text(relativePath).replace(/\\/g, "/");
  if (!rel) throw new ComfyRegistryError("COMFY_WORKFLOW_UNNAMED", "No workflow was named.", {}, 400);
  if (rel.startsWith("/") || /^[a-zA-Z]:/.test(rel) || rel.split("/").some((part) => part === "" || part === "." || part === ".."))
    throw new ComfyRegistryError("COMFY_WORKFLOW_PATH_INVALID", "A workflow is named by its place inside the workflow folder.", { relativePath }, 400);
  const file = path.resolve(folder, rel);
  const inside = path.relative(folder, file);
  if (inside.startsWith("..") || path.isAbsolute(inside))
    throw new ComfyRegistryError("COMFY_WORKFLOW_OUTSIDE_FOLDER", "That workflow is not inside the workflow folder.", { relativePath }, 400);
  return file;
}

/* ---------------------------------------------------------------------------
   Discovery. Read-only, bounded, and it never writes the registry. */
function scanWorkflowFolder(configuredFolder) {
  const folder = resolveWorkflowFolder(configuredFolder);
  const found = [];
  let truncated = false;

  const walk = (dir, depth) => {
    if (truncated || depth > MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; /* an unreadable subfolder is not a reason to fail the whole scan */
    }
    for (const entry of entries) {
      if (found.length >= MAX_SCAN_FILES) { truncated = true; return; }
      const full = path.join(dir, entry.name);
      /* Symlinks are not followed. A folder setting that can be made to read an
         arbitrary place on disk by planting a link in it is a path-authority hole, and
         a workflow folder has no need of one. */
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }
      if (!entry.isFile() || !/\.json$/i.test(entry.name)) continue;
      found.push(full);
    }
  };
  walk(folder, 0);

  const workflows = found
    .map((file) => describeWorkflowFile(folder, file))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en", { numeric: true }));
  return { folder, workflows, truncated, scannedAt: nowIso() };
}

function describeWorkflowFile(folder, file) {
  const relativePath = path.relative(folder, file).replace(/\\/g, "/");
  const base = { relativePath, name: path.basename(file) };
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { ...base, readable: false, bytes: 0, format: "unreadable", reason: "CineBraid could not read this file." };
  }
  if (stat.size > MAX_WORKFLOW_BYTES)
    return { ...base, readable: false, bytes: stat.size, format: "unreadable", reason: `This file is ${Math.round(stat.size / 1048576)} MB; CineBraid reads workflows up to ${MAX_WORKFLOW_BYTES / 1048576} MB.` };
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return { ...base, readable: false, bytes: stat.size, format: "unreadable", reason: "CineBraid could not read this file." };
  }
  const detected = detectWorkflowFormat(bytes);
  return {
    ...base,
    readable: true,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    contentHash: workflowContentHash(bytes),
    format: detected.format,
    nodeCount: detected.nodeCount,
    /* The executability claim, made once and made honestly. */
    executable: detected.format === "api",
    reason: detected.reason || "",
    action: detected.action || "",
  };
}

/* ---------------------------------------------------------------------------
   The durable registry.

   Same write discipline as config.js: temp file carrying pid + time + random bytes,
   fsync, back up the readable primary, atomic rename. A corrupt registry recovers from
   its .bak and otherwise REFUSES — inventing an empty registry would silently discard
   every confirmed mapping a filmmaker has, which is the one thing this file exists to
   keep. */
function emptyRegistry() {
  return { registryVersion: REGISTRY_VERSION, workflows: [] };
}

function parseRegistry(raw) {
  const parsed = JSON.parse(raw.replace(/^﻿/, ""));
  if (!isRecord(parsed) || !Array.isArray(parsed.workflows)) throw new Error("Registry document has the wrong shape.");
  return { registryVersion: Number(parsed.registryVersion) || REGISTRY_VERSION, workflows: parsed.workflows.filter(isRecord) };
}

function readRegistry() {
  const backup = `${REGISTRY_PATH}.bak`;
  if (!fs.existsSync(REGISTRY_PATH)) {
    if (!fs.existsSync(backup)) return emptyRegistry();
    try {
      return parseRegistry(fs.readFileSync(backup, "utf8"));
    } catch {
      return emptyRegistry();
    }
  }
  try {
    return parseRegistry(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch (primaryError) {
    try {
      return parseRegistry(fs.readFileSync(backup, "utf8"));
    } catch {
      throw new ComfyRegistryError(
        "COMFY_REGISTRY_UNREADABLE",
        `CineBraid could not read ${REGISTRY_PATH}, and its backup is unusable either. Nothing was overwritten.`,
        { file: REGISTRY_PATH, detail: String(primaryError.message || primaryError) },
        409,
      );
    }
  }
}

function writeRegistry(registry) {
  const payload = JSON.stringify({ registryVersion: REGISTRY_VERSION, workflows: registry.workflows }, null, 2);
  JSON.parse(payload);
  const dir = path.dirname(REGISTRY_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(REGISTRY_PATH)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (fs.existsSync(REGISTRY_PATH)) {
      try { fs.copyFileSync(REGISTRY_PATH, `${REGISTRY_PATH}.bak`); } catch {}
    }
    fs.renameSync(temp, REGISTRY_PATH);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
  return registry;
}

/* ---------------------------------------------------------------------------
   Registration state, recomputed against the file on disk every time it is asked for.

   Nothing here trusts a stored `valid` flag. The registry stores what was CONFIRMED;
   whether that confirmation still fits is derived from the current bytes, on every
   read, so a workflow edited outside CineBraid is caught by the next screen that looks
   at it rather than by the dispatch that used it. */
const WORKFLOW_STATES = ["unmapped", "ready", "changed", "broken", "unreadable", "not-executable"];

function workflowState(record, described) {
  if (!described || !described.readable) return { state: "unreadable", reason: described?.reason || "CineBraid can no longer read this workflow file.", problems: [] };
  if (!described.executable)
    return { state: "not-executable", reason: described.reason, action: described.action, problems: [] };
  if (!isRecord(record?.mapping) || !isRecord(record.mapping.bindings) || !Object.keys(record.mapping.bindings).length)
    return { state: "unmapped", reason: "CineBraid does not yet know which node carries the prompt.", action: "Confirm this workflow's inputs.", problems: [] };

  let inspection;
  try {
    inspection = inspectWorkflow(fs.readFileSync(record.__file));
  } catch (error) {
    return { state: "unreadable", reason: error.message, problems: [] };
  }
  const validated = validateMapping(record.mapping, inspection);
  const contentMoved = text(record.mappedHash) && text(record.mappedHash) !== text(described.contentHash);

  if (!validated.ok)
    return {
      state: "broken",
      reason: contentMoved
        ? "This workflow changed and some of its confirmed inputs no longer fit."
        : "Some of this workflow's confirmed inputs no longer fit.",
      action: "Review the inputs before running it.",
      problems: validated.problems,
      broken: validated.broken,
      modes: validated.modes,
    };
  if (contentMoved)
    return {
      state: "changed",
      reason: "This workflow changed since its inputs were confirmed. Every confirmed input still fits.",
      action: "Review the inputs, or run it as it is.",
      problems: [],
      modes: validated.modes,
    };
  return { state: "ready", reason: "", problems: [], modes: validated.modes };
}

/* The whole picture one screen needs: every file in the folder, joined to whatever
   CineBraid has recorded about it, with the state derived fresh. Registrations whose
   file has vanished are reported as `unreadable` rather than dropped — a mapping is
   work a person did, and deleting it because a drive was unplugged is not CineBraid's
   call to make. */
function listWorkflows(configuredFolder) {
  const scan = scanWorkflowFolder(configuredFolder);
  const registry = readRegistry();
  const byPath = new Map(registry.workflows.map((row) => [text(row.relativePath), row]));
  const seen = new Set();

  const rows = scan.workflows.map((described) => {
    const record = byPath.get(described.relativePath);
    seen.add(described.relativePath);
    const withFile = record ? { ...record, __file: path.join(scan.folder, described.relativePath) } : null;
    const state = workflowState(withFile, described);
    return {
      ...described,
      registered: Boolean(record),
      mappingVersion: record?.mapping?.mappingVersion || null,
      mappedHash: record?.mappedHash || "",
      confirmedAt: record?.mapping?.confirmedAt || "",
      bindings: record?.mapping?.bindings || {},
      ...state,
    };
  });

  const orphans = registry.workflows
    .filter((row) => !seen.has(text(row.relativePath)))
    .map((row) => ({
      relativePath: text(row.relativePath),
      name: path.basename(text(row.relativePath)),
      readable: false,
      registered: true,
      executable: false,
      format: "missing",
      state: "unreadable",
      reason: "This workflow is registered but is no longer in the workflow folder.",
      action: "Put the file back, or remove the registration.",
      bindings: row?.mapping?.bindings || {},
      problems: [],
    }));

  return { folder: scan.folder, truncated: scan.truncated, scannedAt: scan.scannedAt, workflows: [...rows, ...orphans] };
}

/* One workflow, with its graph inspected and CineBraid's suggestions — the payload a
   mapping editor needs. Suggestions are computed here and returned; they are never
   written, so the registry cannot contain one. */
function describeForMapping(configuredFolder, relativePath) {
  const folder = resolveWorkflowFolder(configuredFolder);
  const file = resolveWorkflowFile(folder, relativePath);
  if (!fs.existsSync(file))
    throw new ComfyRegistryError("COMFY_WORKFLOW_MISSING", "That workflow is not in the workflow folder.", { relativePath }, 404);
  const described = describeWorkflowFile(folder, file);
  if (!described.executable)
    throw new ComfyRegistryError(
      "COMFY_WORKFLOW_NOT_EXECUTABLE",
      described.reason || "CineBraid runs the API version of a ComfyUI workflow.",
      { relativePath, format: described.format, action: described.action || "" },
      409,
    );
  const inspection = inspectWorkflow(fs.readFileSync(file));
  const registry = readRegistry();
  const record = registry.workflows.find((row) => text(row.relativePath) === described.relativePath) || null;
  const state = workflowState(record ? { ...record, __file: file } : null, described);
  return {
    ...described,
    nodes: inspection.nodes,
    outputNodes: inspection.outputNodes,
    suggestions: suggestMappings(inspection),
    registered: Boolean(record),
    bindings: record?.mapping?.bindings || {},
    mappedHash: record?.mappedHash || "",
    ...state,
  };
}

/* THE ONLY WRITER OF A CONFIRMED MAPPING.
 *
 * `confirmedAt` is minted here, at the moment a person's save request is handled, and
 * mappingFromRequest() refuses to produce a binding without one. A suggestion posted
 * back verbatim is still a confirmation, because a person pressed Save on it — what is
 * impossible is a mapping arriving in the registry without anyone having done so. */
function confirmMapping(configuredFolder, relativePath, requestedBindings) {
  const folder = resolveWorkflowFolder(configuredFolder);
  const file = resolveWorkflowFile(folder, relativePath);
  if (!fs.existsSync(file))
    throw new ComfyRegistryError("COMFY_WORKFLOW_MISSING", "That workflow is not in the workflow folder.", { relativePath }, 404);
  const bytes = fs.readFileSync(file);
  const described = describeWorkflowFile(folder, file);
  if (!described.executable)
    throw new ComfyRegistryError(
      "COMFY_WORKFLOW_NOT_EXECUTABLE",
      described.reason || "CineBraid runs the API version of a ComfyUI workflow.",
      { relativePath, format: described.format, action: described.action || "" },
      409,
    );
  const inspection = inspectWorkflow(bytes);
  const confirmedAt = nowIso();
  const mapping = mappingFromRequest(requestedBindings, inspection, confirmedAt);

  const registry = readRegistry();
  const row = {
    relativePath: described.relativePath,
    registeredAt: nowIso(),
    contentHash: described.contentHash,
    /* The hash the human was looking at. This is what makes "changed since you
       confirmed it" answerable at all. */
    mappedHash: described.contentHash,
    format: described.format,
    nodeCount: described.nodeCount,
    mapping,
    /* A historical fact, not a live one — see the module header. */
    validatedAtConfirmation: { at: confirmedAt, contentHash: described.contentHash, ok: true },
  };
  const index = registry.workflows.findIndex((entry) => text(entry.relativePath) === described.relativePath);
  if (index >= 0) row.registeredAt = text(registry.workflows[index].registeredAt) || row.registeredAt;
  if (index >= 0) registry.workflows[index] = row; else registry.workflows.push(row);
  writeRegistry(registry);
  return { ...describeForMapping(configuredFolder, relativePath) };
}

function forgetWorkflow(relativePath) {
  const registry = readRegistry();
  const before = registry.workflows.length;
  registry.workflows = registry.workflows.filter((row) => text(row.relativePath) !== text(relativePath));
  if (registry.workflows.length !== before) writeRegistry(registry);
  return { removed: before - registry.workflows.length };
}

/* The dispatch-time read. Returns the bytes, the confirmed mapping and the state — and
 * REFUSES anything that is not `ready` or `changed`.
 *
 * `changed` is allowed through deliberately and is not a silent pass: every confirmed
 * binding has been revalidated against the current bytes and still fits, and the run's
 * provenance records both hashes so the difference is legible afterwards. What is
 * refused is `broken` — a binding that no longer fits — which is the case the brief
 * names, and it is refused here rather than at the screen, so a caller that skips the
 * screen is refused too. */
function loadForDispatch(configuredFolder, relativePath) {
  const folder = resolveWorkflowFolder(configuredFolder);
  const file = resolveWorkflowFile(folder, relativePath);
  if (!fs.existsSync(file))
    throw new ComfyRegistryError("COMFY_WORKFLOW_MISSING", "That workflow is no longer in the workflow folder.", { relativePath }, 404);
  const bytes = fs.readFileSync(file);
  const described = describeWorkflowFile(folder, file);
  const registry = readRegistry();
  const record = registry.workflows.find((row) => text(row.relativePath) === described.relativePath);
  if (!record)
    throw new ComfyRegistryError("COMFY_WORKFLOW_UNREGISTERED", "This workflow's inputs have not been confirmed yet.", { relativePath }, 409);
  const state = workflowState({ ...record, __file: file }, described);
  if (state.state !== "ready" && state.state !== "changed")
    throw new ComfyRegistryError(
      state.state === "broken" ? "COMFY_MAPPING_BROKEN" : "COMFY_WORKFLOW_NOT_RUNNABLE",
      state.reason || "This workflow cannot run yet.",
      { relativePath, state: state.state, problems: state.problems || [], action: state.action || "" },
      409,
    );
  return {
    relativePath: described.relativePath,
    file,
    bytes,
    contentHash: described.contentHash,
    mappedHash: text(record.mappedHash),
    format: described.format,
    mapping: record.mapping,
    state: state.state,
    modes: state.modes || [],
  };
}

module.exports = {
  MAX_SCAN_DEPTH,
  MAX_SCAN_FILES,
  MAX_WORKFLOW_BYTES,
  REGISTRY_PATH,
  REGISTRY_VERSION,
  WORKFLOW_STATES,
  ComfyRegistryError,
  ComfyWorkflowError,
  confirmMapping,
  describeForMapping,
  describeWorkflowFile,
  forgetWorkflow,
  listWorkflows,
  loadForDispatch,
  readRegistry,
  resolveWorkflowFile,
  resolveWorkflowFolder,
  scanWorkflowFolder,
  workflowState,
};
