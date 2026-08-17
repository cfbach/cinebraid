/* CINEBRAID — local production hub server.
   Run: npm start  →  http://localhost:4477 */
const REQUIRED_NODE_MAJOR = 18;
const DETECTED_NODE_VERSION = String(process.env.CINEBRAID_TEST_NODE_VERSION || process.versions.node || "0.0.0");
if ((Number(DETECTED_NODE_VERSION.split(".")[0]) || 0) < REQUIRED_NODE_MAJOR) {
  console.error(`CineBraid requires Node.js ${REQUIRED_NODE_MAJOR} or newer; detected ${DETECTED_NODE_VERSION}.`);
  process.exit(1);
}
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { llm, embed, vision, isLocalProviderEndpoint, resolveVisionTarget } = require("./llm");
const {
  configHealth,
  maskSecretValue,
  maskSecrets,
  mergeConfig,
  migrateConfigFile,
  readConfig,
  restoreSecrets,
  writeConfig,
} = require("./config");
const PromptEngine = require("./prompt-engine");
const { annotateProfileLibraryExecution } = require("./generation-options");
const { httpStatusForError } = require("./http-errors");
const { resolveShotEntities, shotEntityTokenMatches, unresolvedShotDependencies, entityVisualDescription, resolveShotDuration, lossyShotCodeTokens } = require("./public/shared-entities");
const { referenceAspectLabel, aspectRatioMentions } = require("./public/shared-aspect");
const { deriveLipSync, lipSyncRequiredFrom } = require("./public/shared-lip-sync");
const Coverage = require("./public/shared-coverage");
const Continuity = require("./public/shared-continuity");
const EntityOwnership = require("./public/shared-entity-ownership");
const FramePresence = require("./public/shared-frame-presence");
const ProductionAuthority = require("./public/shared-production-authority");
const ShotReadiness = require("./public/shared-shot-readiness");
/* There is nothing to wire. The Canon kernel depends on
   public/shared-entity-ownership.js directly — by `require` in Node, by name in
   the browser's shared scope — so the ownership veto cannot be handed over,
   forgotten, or replaced with a different answer after boot. This line used to
   be `ProductionAuthority.useEntityOwnershipResolver(EntityOwnership)`. */
const { createContinuityCache } = require("./continuity-cache");
const ContinuityJson = require("./continuity-json");
const { resolvePromptBuild, resolvePromptBuildList, normalizePromptBuildHistory, registerPromptBuild, promptBuildRef, applyPromptBuildRetention } = require("./public/shared-build-history");
const { SimpleZipWriter } = require("./zip-stream");
const AgentSuite = require("./agent-suite");
const { registerFalGeneration } = require("./fal-generation");
const { registerAutomationRuns } = require("./automation-runs");
const { createGenerationPoller } = require("./generation-poller");
const { isAccountCallbackPath, registerAccountConnections } = require("./accounts-api");
const { createRequestBoundary, createRequestPosture } = require("./request-origin");
/* The MediaAsset ledger's single production entry point. server.js talks to this
   module and never to media-assets/-store/-indexer/-verify directly, so there is
   one answer to when the identity ledger changes and who changed it. */
const MediaAssetService = require("./media-asset-service");

const app = express();
const PORT = process.env.PORT || 4477;
const LAN_OPT_IN = process.argv.includes("--lan") || /^(1|true|yes)$/i.test(String(process.env.CINEBRAID_LAN || ""));
const HOST = String(process.env.CINEBRAID_HOST || (LAN_OPT_IN ? "0.0.0.0" : "127.0.0.1")).trim() || "127.0.0.1";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DEFAULT_PROJECTS_ROOT = process.env.CINEBRAID_PROJECTS_ROOT
  ? path.resolve(process.env.CINEBRAID_PROJECTS_ROOT)
  : path.join(__dirname, "projects");
function resolveWorkspacePath(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback ? path.resolve(fallback) : "";
  const expanded = raw.startsWith("~/") || raw === "~"
    ? path.join(process.env.HOME || process.env.USERPROFILE || __dirname, raw.slice(1))
    : raw;
  return path.resolve(expanded);
}
function projectsRoot(config = readConfig()) {
  return resolveWorkspacePath(config.workspace?.projectRoot, DEFAULT_PROJECTS_ROOT);
}
function configuredWorkspacePath(key, config = readConfig()) {
  return resolveWorkspacePath(config.workspace?.[key], "");
}

function safeEnsureDirectory(dir) {
  if (!dir) return "";
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.cinebraid-write-test-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  return dir;
}
function copyMissingTree(source, destination) {
  if (!source || !destination || !fs.existsSync(source)) return { copied: 0, skipped: 0 };
  fs.mkdirSync(destination, { recursive: true });
  let copied = 0, skipped = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name), dest = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      const nested = copyMissingTree(src, dest);
      copied += nested.copied; skipped += nested.skipped;
    } else if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest); copied += 1;
    } else skipped += 1;
  }
  return { copied, skipped };
}
function workspaceStatus(config = readConfig()) {
  const root = projectsRoot(config);
  return {
    projectRoot: root,
    mediaRoot: configuredWorkspacePath("mediaRoot", config),
    outputRoot: configuredWorkspacePath("outputRoot", config),
    backupRoot: configuredWorkspacePath("backupRoot", config),
    projectRootExists: fs.existsSync(root),
    activeProject: config.activeProject || "",
  };
}

const AGENT_RUNTIME = {
  queue: [],
  active: 0,
  running: new Set(),
  cancelled: new Set(),
  workload: new Map(),
};
function uid(prefix = "id") {
  return (
    prefix +
    "-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

const MEDIA_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".webm",
  ".mov",
  ".wav",
  ".mp3",
  ".m4a",
  ".flac",
  ".ogg",
]);

/* Reconcile legacy defaults before any route reads the configuration.

   A configuration that cannot be read is NOT resolved here by inventing defaults.
   Doing that is what destroyed credentials and switched off passcodes: the corrupt
   bytes were replaced by DEFAULT_CONFIG, which has no editorPass. The startup path
   now records the fault and lets the request boundary refuse, so the file is left
   exactly as it was found and the user can still recover from it. */
let CONFIG_FAULT = null;
try {
  migrateConfigFile();
} catch (error) {
  if (error?.code !== "CONFIG_UNREADABLE") throw error;
  CONFIG_FAULT = error;
  console.error(
    "CineBraid could not read its settings, and the backup copy could not be read either.\n"
    + `  settings : ${error.detail?.path || ""}\n`
    + `  backup   : ${error.detail?.backupPath || ""}\n`
    + "Nothing has been changed. CineBraid is refusing to start with empty settings, because that\n"
    + "would switch off any passcode you had set and discard every connected account. Repair or\n"
    + "remove the settings file and start CineBraid again.",
  );
}

/* ---- multi-project: each folder under projects/ is fully self-contained ---- */
function activeSlug() {
  const c = readConfig();
  /* config.activeProject is the one project reference that never passed through a
     route: data/config.json can be hand-edited, and PUT /api/config merges whatever
     it is given. Since PROJECT_DIR() is derived from this value and is the root every
     path-containment check trusts, it is proven contained here — at the single
     boundary where the stored value becomes a directory. */
  const slug = containedProjectSlug(c.activeProject);
  if (slug && fs.existsSync(path.join(projectsRoot(), slug))) return slug;
  const list = listProjects();
  return list[0]?.slug || null;
}
function listProjects() {
  if (!fs.existsSync(projectsRoot())) return [];
  return fs
    .readdirSync(projectsRoot())
    .filter((d) => fs.existsSync(path.join(projectsRoot(), d, "project.json")))
    .map((slug) => {
      try {
        const m = JSON.parse(
          fs.readFileSync(
            path.join(projectsRoot(), slug, "project.json"),
            "utf8",
          ),
        ).meta;
        return { slug, title: m.title || slug, format: m.format || "" };
      } catch {
        return { slug, title: slug, format: "" };
      }
    });
}
function listArchivedProjects() {
  const archiveRoot = path.join(projectsRoot(), ".archive");
  if (!fs.existsSync(archiveRoot)) return [];
  return fs.readdirSync(archiveRoot)
    .filter((name) => fs.existsSync(path.join(archiveRoot, name, "project.json")))
    .map((archiveName) => {
      const dir = path.join(archiveRoot, archiveName);
      let meta = {}, manifest = {};
      try { meta = readJsonSync(path.join(dir, "project.json")).meta || {}; } catch {}
      try { manifest = readJsonSync(path.join(dir, ".cinebraid-archive.json")); } catch {}
      return {
        archiveName,
        slug: manifest.originalSlug || archiveName,
        title: meta.title || manifest.originalSlug || archiveName,
        format: meta.format || "",
        archivedAt: manifest.archivedAt || "",
      };
    })
    .sort((a,b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
}
function listTrashedProjects() {
  const trashRoot = path.join(projectsRoot(), ".trash");
  if (!fs.existsSync(trashRoot)) return [];
  return fs.readdirSync(trashRoot)
    .filter((name) => fs.existsSync(path.join(trashRoot, name, "project.json")))
    .map((trashName) => {
      const dir = path.join(trashRoot, trashName);
      let meta = {}, manifest = {};
      try { meta = readJsonSync(path.join(dir, "project.json")).meta || {}; } catch {}
      try { manifest = readJsonSync(path.join(dir, ".cinebraid-trash.json")); } catch {}
      const inferredSlug = trashName.replace(/-\d{4}-\d{2}-\d{2}T.*$/, "");
      return {
        trashName,
        slug: manifest.originalSlug || inferredSlug || trashName,
        title: meta.title || manifest.originalSlug || inferredSlug || trashName,
        format: meta.format || "",
        deletedAt: manifest.deletedAt || "",
      };
    })
    .sort((a,b) => String(b.deletedAt || b.trashName).localeCompare(String(a.deletedAt || a.trashName)));
}
function PROJECT_DIR() {
  return path.join(projectsRoot(), activeSlug() || "_none");
}
function DATA() {
  return path.join(PROJECT_DIR(), "project.json");
}
/* Windows tooling (PowerShell's Out-File -Encoding utf8, Notepad) writes a UTF-8 BOM that
   JSON.parse rejects. Every JSON file CineBraid reads goes through here so a BOM is never
   the difference between a readable and an unreadable project. */
function parseJsonText(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ""));
}
function readJsonSync(file) {
  return parseJsonText(fs.readFileSync(file, "utf8"));
}
function cleanProjectSlug(value) {
  const slug = path.basename(String(value || "").trim());
  if (!slug || slug !== String(value || "").trim())
    throw new Error("Invalid project slug.");
  return slug;
}
/* A project slug that provably addresses a directory INSIDE projectsRoot().

   cleanProjectSlug rejects every separator-bearing form, but two values survive it
   because they are their own basename: "." and "..". The second is the dangerous one.
   PROJECT_DIR() is path.join(projectsRoot(), activeSlug()), so an activeProject of
   ".." moves it to the PARENT of the projects root — and PROJECT_DIR() is the root
   that every containment check in this codebase resolves against. A poisoned value
   therefore RELOCATES the boundary rather than tripping any check, which is why the
   slug being sanitised-looking is not enough and its resolved directory has to be
   proven contained.

   Containment is proven by path semantics, never by string prefix: `path.relative`
   cannot be fooled by a sibling whose name merely starts with the root's
   (projects-good vs projects), and a legitimate slug is by definition exactly one
   path segment below the root. */
function containedProjectSlug(value, root = projectsRoot()) {
  let slug;
  try {
    slug = cleanProjectSlug(value);
  } catch {
    return "";
  }
  const base = path.resolve(root);
  const target = path.resolve(base, slug);
  const rel = path.relative(base, target);
  if (!rel) return ""; /* "." — the projects root itself is not a project */
  if (path.isAbsolute(rel)) return ""; /* a different drive or share */
  if (rel === ".." || rel.startsWith(".." + path.sep) || rel.startsWith("../")) return "";
  if (rel.split(/[\\/]/).length !== 1) return ""; /* must be a direct child */
  return slug;
}
/* Every :slug route resolves its directory here, so this is the second call site of
   the containment rule above — and until now it was the one that did not use it.

   cleanProjectSlug alone is not containment: ".." is its own basename, so it passed,
   and `path.join(projectsRoot(), "..")` is the PARENT of the projects root. A raw
   `PUT /api/projects/../project` therefore wrote fully caller-controlled JSON to a
   file outside the root, left a `.bak` beside it, and `GET /api/projects/../backups`
   listed that directory. Browsers and Node's fetch normalise `..` away, which is why
   this survived every existing test; curl --path-as-is and a raw socket do not.

   containedProjectSlug already proves the resolved directory is a direct child by
   path semantics. Using it here rather than adding a third sanitizer keeps one
   answer to "is this slug inside the root". */
function projectDirForSlug(value, requireExisting = true) {
  const slug = containedProjectSlug(value);
  if (!slug) throw new Error("Invalid project slug.");
  const dir = path.join(projectsRoot(), slug),
    file = path.join(dir, "project.json");
  if (requireExisting && !fs.existsSync(file))
    throw new Error(`No such project: ${slug}`);
  return { slug, dir, file };
}

const PROJECT_BACKUP_LIMIT = 10;
function projectBackupDir(file) {
  const configured = configuredWorkspacePath("backupRoot");
  if (!configured) return path.join(path.dirname(file), "backups");
  const slug = path.basename(path.dirname(file));
  return path.join(configured, slug);
}
function projectBackupName(reason = "save") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const cleanReason = String(reason || "save").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "save";
  return `project-${stamp}-${cleanReason}.json`;
}
/* The exact grammar projectBackupName produces, and nothing else.

   This regex is a DELETION AUTHORITY, not a display filter: createProjectBackup
   unlinks everything past the retention limit that this matches. It used to be
   /^project-.*\.json$/i, which matches project-plan.json, project-notes.json,
   project-2019-budget.json and any exported project a user keeps — and
   workspace.backupRoot is a free-text path field, so pointing it at an existing
   folder was one paste away. A single ordinary autosave then permanently deleted
   the user's files, with no trash, no .bak, and a try/catch that swallowed every
   error. Ownership is now established by the filename CineBraid itself emits:
   an ISO stamp with `:`/`.` replaced by `-`, then a lowercase reason. */
const PROJECT_BACKUP_NAME = /^project-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9_-]+\.json$/;
function isCineBraidBackupName(name) {
  return PROJECT_BACKUP_NAME.test(String(name || ""));
}
function listProjectBackups(file) {
  const dir = projectBackupDir(file);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(isCineBraidBackupName)
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
}
function createProjectBackup(file, reason = "save") {
  if (!fs.existsSync(file)) return null;
  const dir = projectBackupDir(file);
  fs.mkdirSync(dir, { recursive: true });
  let name = projectBackupName(reason);
  let destination = path.join(dir, name);
  let suffix = 1;
  while (fs.existsSync(destination)) {
    name = projectBackupName(`${reason}-${suffix++}`);
    destination = path.join(dir, name);
  }
  fs.copyFileSync(file, destination);
  const backups = listProjectBackups(file);
  backups.slice(PROJECT_BACKUP_LIMIT).forEach((entry) => {
    /* Re-checked at the point of deletion, not only at the point of listing. The
       list is what decides retention order; this is what decides that a file may
       be unlinked at all, and the two are worth keeping separate. */
    if (!isCineBraidBackupName(entry.name)) return;
    try { fs.unlinkSync(path.join(dir, entry.name)); } catch {}
  });
  return name;
}
function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validateProjectForSave(project) {
  const errors = [];
  if (!plainObject(project)) return { ok: false, errors: ["Project payload must be a JSON object."] };
  if (!plainObject(project.meta)) errors.push("meta must be an object.");
  const required = ["scenes", "shots", "characters", "locations", "props"];
  const optional = ["vehicles", "audio", "mediaAssets", "jobs", "agentRuns", "decisions", "sessions"];
  for (const key of required) if (!Array.isArray(project[key])) errors.push(`${key} must be an array.`);
  for (const key of optional) if (project[key] != null && !Array.isArray(project[key])) errors.push(`${key} must be an array when present.`);
  const collections = ["scenes", "shots", "characters", "locations", "props", "vehicles", "audio"];
  for (const key of collections) {
    const rows = Array.isArray(project[key]) ? project[key] : [];
    const seen = new Set();
    rows.forEach((row, index) => {
      if (!plainObject(row)) { errors.push(`${key}[${index}] must be an object.`); return; }
      const id = String(row.id || "").trim();
      if (!id) errors.push(`${key}[${index}] is missing id.`);
      else if (seen.has(id)) errors.push(`${key} contains duplicate id ${id}.`);
      else seen.add(id);
    });
  }
  const sceneIds = new Set((Array.isArray(project.scenes) ? project.scenes : []).map((row) => String(row.id || "").trim()).filter(Boolean));
  (Array.isArray(project.shots) ? project.shots : []).forEach((shot, index) => {
    const sceneId = String(shot?.scene || "").trim();
    if (!sceneId) errors.push(`shots[${index}] is missing scene.`);
    else if (!sceneIds.has(sceneId)) errors.push(`Shot ${shot?.id || index} references missing scene ${sceneId}.`);
    for (const key of ["characters", "codes", "risks", "keyframes", "clips", "candidateFiles"]) {
      if (shot?.[key] != null && !Array.isArray(shot[key])) errors.push(`Shot ${shot?.id || index} field ${key} must be an array.`);
    }
  });
  return { ok: errors.length === 0, errors: errors.slice(0, 50) };
}
function normalizeProjectCollections(project) {
  for (const key of ["vehicles", "audio", "mediaAssets", "jobs", "agentRuns", "decisions", "sessions"]) {
    if (project[key] == null) project[key] = [];
  }
  return project;
}

/* Single gate for "is this project safe to open?". Both GET /api/project and the switch
   endpoint go through it, so the server can never make a project active that it would then
   fail to serve. Failures name the project and the real file path — never a guessed one. */
function inspectProjectFile(value) {
  const requested = String(value || "").trim();
  let slug, file;
  try {
    ({ slug, file } = projectDirForSlug(requested, false));
  } catch {
    return {
      ok: false, status: 404, slug: requested, title: requested, file: "", reason: "invalid-name",
      error: `“${requested}” is not a valid project name, so CineBraid did not open it.`,
    };
  }
  if (!fs.existsSync(file))
    return {
      ok: false, status: 404, slug, title: slug, file, reason: "missing",
      error: `CineBraid could not open “${slug}” because its project file is missing.`,
    };
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    return {
      ok: false, status: 422, slug, title: slug, file, reason: "unreadable", detail: error.message,
      error: `CineBraid could not open “${slug}” because its project file could not be read. Nothing was changed.`,
    };
  }
  let project;
  try {
    project = parseJsonText(raw);
  } catch (error) {
    return {
      ok: false, status: 422, slug, title: slug, file, reason: "invalid-json", detail: error.message,
      error: `CineBraid could not open “${slug}” because its project file is not valid JSON. The file is untouched and the project you were in is still open.`,
    };
  }
  if (!plainObject(project))
    return {
      ok: false, status: 422, slug, title: slug, file, reason: "invalid-shape",
      error: `CineBraid could not open “${slug}” because its project file does not contain a project. The file is untouched and the project you were in is still open.`,
    };
  const title = String(project.meta?.title || "").trim() || slug;
  const validation = validateProjectForSave(normalizeProjectCollections(project));
  if (!validation.ok)
    return {
      ok: false, status: 422, slug, title, file, reason: "invalid-structure", issues: validation.errors,
      detail: validation.errors[0] || "",
      error: `CineBraid could not open “${title}” because its project file is missing information CineBraid needs. The file is untouched and the project you were in is still open.`,
    };
  return { ok: true, slug, title, file, project };
}
function projectFailurePayload(inspected) {
  return {
    error: inspected.error,
    projectFailure: {
      slug: inspected.slug,
      title: inspected.title,
      path: inspected.file,
      reason: inspected.reason,
      detail: inspected.detail || "",
      issues: inspected.issues || [],
    },
  };
}

function atomicWriteJson(file, value, { backup = true } = {}) {
  const payload = JSON.stringify(value, null, 2),
    dir = path.dirname(file),
    temp = path.join(
      dir,
      `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
    );
  JSON.parse(payload);
  fs.mkdirSync(dir, { recursive: true });
  let fd;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (backup && fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
    fs.renameSync(temp, file);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
}
/* ---- project save revision --------------------------------------------------

   A token for the EXACT bytes currently stored for a project, used as an ETag.

   The whole-document save had no concurrency control of any kind: PUT replaced
   the file with whatever the client sent and answered 200. Two tabs — or one tab
   left open while a generation ingested on the server — meant the slower client
   silently destroyed the other's work and was told "Saved".

   Deliberately NOT meta.version: that is a product-version string ("6.6.4-studio.2"
   in the shipped sample, "v1" on new projects) that nothing increments and nothing
   checks, and reusing it would make a display field load-bearing. Hashing the
   stored bytes needs no schema change, no migration and no bookkeeping, and is
   automatically correct for the server-side writers that never go through this
   route (agent runs, generation ingest, coordinator applies): whatever changed
   the file changed the revision. */
function projectRevisionFor(file) {
  try {
    return `"${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}"`;
  } catch (error) {
    if (error?.code === "ENOENT") return ""; // nothing stored yet
    throw error;
  }
}
/* ---- explicit project ownership for media writes ----------------------------

   The media routes resolved their destination from PROJECT_DIR() — the globally
   active project at the moment the write ran. An upload is a request body that
   can take a long time to arrive; a rename follows a modal the user may leave
   open. Switching projects in between silently redirected the write into a
   project that had nothing to do with it.

   A caller that knows which project it means says so, and that project is
   resolved through the contained helper Repair A established. A caller that does
   not is served the active project exactly as before, so nothing that worked
   stops working — but every browser path now names its project. */
function ownedProjectDir(req) {
  const requested = String(
    req.query?.slug ?? req.body?.projectSlug ?? req.query?.projectSlug ?? "",
  ).trim();
  if (!requested) return PROJECT_DIR();
  return projectDirForSlug(requested).dir; // throws on unknown or out-of-root
}
function mediaOwnerStatus(error) {
  return /No such project|Invalid project slug/.test(String(error?.message || "")) ? 404 : 400;
}
function projectAIPolicy() {
  try {
    return (
      readJsonSync(DATA()).meta?.aiPolicy ||
      "project-default"
    );
  } catch {
    return "project-default";
  }
}
/* A local-only project is asking for its material to stay on this machine. That is a
   property of the endpoint, not of the provider's name: a custom OpenAI-compatible
   server on loopback satisfies it, the same provider pointed at a remote host does
   not, and neither does an Ollama URL on another computer. Per-task routing is
   deliberately ignored here — under this policy one provider is chosen for
   everything, and if none of them is local the request is refused rather than sent. */
function localOnlyTextProvider() {
  const cfg = readConfig();
  if (
    (cfg.assistant?.provider || "ollama") === "custom" &&
    isLocalProviderEndpoint(cfg.customBaseUrl)
  )
    return "custom";
  if (isLocalProviderEndpoint(cfg.ollamaUrl)) return "ollama";
  throw new Error(
    "This project is set to local-only AI, and no AI provider is configured with an endpoint on this machine. Point Ollama or the custom AI server at this computer in Settings, or change the project's AI policy.",
  );
}
function aiProviderOverride() {
  const policy = projectAIPolicy();
  if (policy === "disabled")
    throw new Error("AI features are disabled for this project.");
  return policy === "local-only" ? localOnlyTextProvider() : null;
}
/* Vision resolves exactly as it did before. Multi-image review stays on its existing
   provider path until the declared-entity single-image continuity engine is ported,
   so local-only vision is not re-pointed at a custom server as part of that. */
function aiVisionProviderOverride() {
  const policy = projectAIPolicy();
  if (policy === "disabled")
    throw new Error("AI features are disabled for this project.");
  return policy === "local-only" ? "ollama" : null;
}
/* Continuity observation resolves separately from general vision, and is the
   only vision consumer that reaches the single-image service. Repointing
   aiVisionProviderOverride() would drag the multi-image review routes there
   too, and those send up to 32 images. */
/* Where continuity's single-image requests actually go.

   Its own endpoint when one is configured, otherwise the connection the chosen
   provider already has. That fallback is what makes the field additive: an
   install written before it existed resolves exactly as it did.

   A key is inherited only alongside an inherited address. Sending the general
   custom server's credential to a different host because both happen to be
   called "custom" would be a leak, not a convenience. */
function continuityConnection(cfg = readConfig()) {
  const provider = cfg.continuity?.visionProvider || "";
  const ownBase = String(cfg.continuity?.baseUrl || "").trim();
  const inheritedBase = provider === "openai" ? cfg.openaiBaseUrl : provider === "custom" ? cfg.customBaseUrl : "";
  const inheritedKey = provider === "openai" ? cfg.openaiKey : provider === "custom" ? cfg.customKey : "";
  return {
    provider,
    baseUrl: ownBase || String(inheritedBase || ""),
    apiKey: String(cfg.continuity?.apiKey || (ownBase ? "" : inheritedKey || "")),
    model: continuityVisionModel(cfg),
    /* True when continuity is not riding on the general provider's connection. */
    standalone: !!ownBase,
  };
}
function continuityVisionProvider() {
  const cfg = readConfig();
  const policy = projectAIPolicy();
  if (policy === "disabled")
    throw new Error("AI features are disabled for this project.");
  const connection = continuityConnection(cfg);
  if (!connection.provider)
    throw new Error(
      "Continuity observation has no provider. Choose an OpenAI-compatible AI server for continuity in Settings — it is configured separately from general vision because it sends exactly one image per request.",
    );
  if (policy === "local-only" && !isLocalProviderEndpoint(connection.baseUrl))
    throw new Error(
      "This project is set to local-only AI, and the continuity observation provider is not on this machine. Point the continuity endpoint at this computer in Settings, or change the project's AI policy.",
    );
  return connection.provider;
}
function continuityVisionModel(cfg = readConfig()) {
  const provider = cfg.continuity?.visionProvider || "";
  if (!provider) return "";
  return cfg.continuity?.visionModel || providerCapabilityModel(provider, cfg, "vision") || "";
}
const SUBDIRS = ["anchors", "plates", "props", "vehicles", "audio", "media", "shots", "docs"];
function ensureDirs(dir) {
  for (const d of SUBDIRS) fs.mkdirSync(path.join(dir, d), { recursive: true });
}

/* one-time migration from the v1 single-project layout */
(function migrate() {
  const oldData = path.join(__dirname, "data", "project.json");
  const oldProj = path.join(__dirname, "project");
  if (!fs.existsSync(oldData)) return;
  fs.mkdirSync(projectsRoot(), { recursive: true });
  let slug = "project-1";
  try {
    slug = (readJsonSync(oldData).meta.title || slug)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  } catch {}
  const dest = path.join(projectsRoot(), slug);
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(oldData, path.join(dest, "project.json"));
  if (fs.existsSync(oldProj))
    for (const d of SUBDIRS) {
      const src = path.join(oldProj, d);
      if (fs.existsSync(src))
        fs.cpSync(src, path.join(dest, d), { recursive: true });
    }
  ensureDirs(dest);
  const c = readConfig();
  c.activeProject = slug;
  writeConfig(c);
  fs.renameSync(oldData, oldData + ".migrated");
  console.log("  Migrated existing project → projects/" + slug);
})();

const BLANK = () => ({
  meta: {
    title: "New Project",
    format: "",
    version: "v1",
    hubVersion: "v6.0.0",
    schemaVersion: "6.6",
    aiPolicy: "project-default",
    workflowEmphasis: "manual",
    promptProfilesVersion: "2026-07",
    promptDefaults: {
      imageProfile: "gpt-image-2/t2i",
      compositeProfile: "gpt-image-2/multi-reference",
      /* The default has to be a target this build can actually dispatch. MiniMax H3 is
         the video family CineBraid owns a pack and an adapter for; image-to-video is
         what a first motion pass from an approved frame needs. */
      videoProfile: "minimax-h3/i2v",
    },
    aspectRatio: "",
    globalStylePrompt: "",
    globalNegativePrompt: "",
    world: { setting: "", include: "", reject: "" },
    styleBlocks: [],
    statusVocab: ["UNBUILT", "BUILT", "NEEDS POST", "LOCKED"],
    defaults: { stillModel: "", videoModel: "" },
    models: [],
  },
  qcChecklist: [
    "Identity & side continuity — checked against anchor sheet, mirror-check done, drift-prone features verified",
    "Geometry & contact points — hands touch what they touch, correct orientation",
    "Tone drift — not too clean, not too pretty; era and world correct",
    "Motif & continuity compliance — recurring details per canon",
    "Text accuracy — all legible strings; rechecked after upscale/edit",
  ],
  characters: [],
  locations: [],
  props: [],
  vehicles: [],
  audio: [],
  scenes: [],
  shots: [],
  mediaAssets: [],
  finishJobs: [],
  jobs: [],
  decisions: [],
  agentRuns: [],
  sessions: [
    {
      n: 1,
      date: new Date().toISOString().slice(0, 10),
      summary: "Project created in CineBraid.",
      carryForward: ["Set the global visual style, then create the first reusable reference."],
    },
  ],
});

/* ---- request provenance: Host, then Origin ----
   Mounted before the body parser and before the auth gate, so it applies in the
   shipped default posture too — the posture where no passcode is set and every
   caller is otherwise treated as an editor, which is exactly where a page the user
   merely visited could drive the whole API. */
app.use(createRequestBoundary(createRequestPosture({
  host: HOST,
  port: PORT,
  lanOptIn: LAN_OPT_IN,
  allowedHosts: process.env.CINEBRAID_ALLOWED_HOSTS,
})));

/* ---- configuration health ----
   Every route below reads the configuration, so a configuration that cannot be read
   is answered once, here, with an explanation — rather than 57 call sites each
   silently receiving defaults. Re-checked per request so repairing the file brings
   CineBraid back without a restart. */
app.use((req, res, next) => {
  const health = CONFIG_FAULT ? { ok: false } : configHealth();
  if (health.ok) { CONFIG_FAULT = null; return next(); }
  const message = "CineBraid could not read its settings, and the backup copy could not be read either. "
    + "Nothing has been changed — your settings file is exactly as CineBraid found it. Repair or remove it, "
    + "then start CineBraid again.";
  if (req.path.startsWith("/api/")) return res.status(503).json({ error: message, code: "CONFIG_UNREADABLE" });
  return res.status(503).type("html").send(
    `<!doctype html><meta charset="utf-8"><title>CineBraid — settings unreadable</title>`
    + `<body style="font:16px system-ui;margin:3rem;max-width:38rem"><h1 style="font-size:1.2rem">CineBraid could not read its settings</h1>`
    + `<p>${message}</p></body>`,
  );
});

app.use(express.json({ limit: "25mb" }));

/* ---- access control: OFF until an editor passcode is set in Settings ----
   editor passcode → full app. viewer passcode → /bible only (read-only).
   If viewer passcode is empty while editor passcode is set, the Bible is open to anyone who can reach the server. */
function authSecret() {
  const c = readConfig();
  if (!c.authSecret) {
    c.authSecret = crypto.randomBytes(24).toString("hex");
    writeConfig(c);
  }
  return c.authSecret;
}
function sign(role) {
  return (
    role +
    "." +
    crypto.createHmac("sha256", authSecret()).update(role).digest("hex")
  );
}
function roleFrom(req) {
  const m = /(?:^|;\s*)ahub=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const [role] = m[1].split(".");
  return ["editor", "viewer"].includes(role) && m[1] === sign(role)
    ? role
    : null;
}
app.post("/api/login", (req, res) => {
  const c = readConfig();
  const pass = String(req.body.pass || "");
  const role =
    c.editorPass && pass === c.editorPass
      ? "editor"
      : c.viewerPass && pass === c.viewerPass
        ? "viewer"
        : null;
  if (!role) return res.status(401).json({ error: "Wrong passcode" });
  res.setHeader(
    "Set-Cookie",
    "ahub=" + sign(role) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
  );
  res.json({ ok: true, role });
});
app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "ahub=; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => {
  const enabled = !!readConfig().editorPass;
  res.json({ authEnabled: enabled, role: enabled ? roleFrom(req) : "editor" });
});
/* What an unauthenticated browser may fetch: the sign-in page, and exactly the
   files that page loads from this server.

   The brand images were missing from this list. The sign-in page itself was
   exempt and its stylesheet was exempt, so with a passcode set the page rendered
   perfectly — except that /cinebraid-logo-xs.png was answered with a 302 to
   /login.html. The <img> received an HTML document where a PNG should have been,
   failed to decode, and drew a broken-image icon on the first screen any LAN
   user ever sees. A page you cannot fully load until you have signed in is no
   use as the page you sign in on.

   Nothing here is a disclosure: these are the brand assets that page has always
   served to anyone who can reach it, alongside the stylesheet that was already
   exempt. Add a file to login.html and it belongs here too —
   tests/brand-logo-asset.js fails until it is. */
const PRE_AUTH_PATHS = [
  "/login.html",
  "/styles.css",
  "/cinebraid-logo-xs.png",
  "/cinebraid-mark.svg",
  "/api/login",
  "/api/me",
  "/favicon.ico",
];
app.use((req, res, next) => {
  const c = readConfig();
  if (!c.editorPass) {
    req.role = "editor";
    return next();
  } // auth off → local mode
  req.role = roleFrom(req);
  const p = req.path;
  if (PRE_AUTH_PATHS.includes(p)) return next();
  /* The OAuth callback is a navigation the provider caused, not one the app made,
     so it cannot be gated on a passcode session the way a settings route is. It is
     not ungated: the route itself refuses any peer that is not this machine, and
     accepts only a `state` this server minted, that has not expired, and that can
     be spent once. That is a stronger claim than "someone has an editor cookie". */
  if (isAccountCallbackPath(p)) return next();
  const bibleScope =
    p === "/bible.html" ||
    p === "/bible.js" ||
    p === "/api/bible" ||
    p.startsWith("/assets/");
  if (bibleScope) {
    if (req.role || !c.viewerPass) return next(); // open bible if no viewer pass set
    return p.startsWith("/api/")
      ? res.status(401).json({ error: "Sign in" })
      : res.redirect("/login.html");
  }
  if (req.role === "editor") return next();
  if (req.role === "viewer")
    return p.startsWith("/api/")
      ? res.status(403).json({ error: "Editor only" })
      : res.redirect("/bible.html");
  return p.startsWith("/api/")
    ? res.status(401).json({ error: "Sign in" })
    : res.redirect("/login.html");
});
app.use(
  "/",
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
      if (/\.(?:html|js|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, max-age=0");
        res.setHeader("Pragma", "no-cache");
      }
    },
  }),
);
// Media-only delivery. Never mount the project root: project.json, docs, backups and
// other internal files must not be reachable from the collaborator-facing Bible.
app.get("/assets/*", (req, res) => {
  const rel = String(req.params[0] || "").replace(/\\/g, "/");
  const allowedRoot =
    /^(anchors|plates|props|vehicles|audio|media)\/[^/]+$/.test(rel) ||
    /^shots\/[\w.-]+\/(takes|locked|blocking)\/[^/]+$/.test(rel);
  const ext = path.extname(rel).toLowerCase();
  if (!allowedRoot || !MEDIA_EXT.has(ext))
    return res.status(404).send("Not found");
  const root = path.resolve(PROJECT_DIR());
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
    return res.status(404).send("Not found");
  res.sendFile(file);
});

/* ---- project data ---- */
app.get("/api/project", (req, res) => {
  try {
    const slug = activeSlug();
    if (!slug) return res.status(404).json({ error: "No active project." });
    const inspected = inspectProjectFile(slug);
    if (!inspected.ok)
      return res.status(inspected.status).json(projectFailurePayload(inspected));
    res.setHeader("X-CineBraid-Project-Slug", inspected.slug);
    /* The revision the client must echo back on save. Read straight from the
       stored bytes, so it describes the document this response was built from. */
    const revision = projectRevisionFor(projectDirForSlug(inspected.slug).file);
    if (revision) {
      res.setHeader("ETag", revision);
      res.setHeader("X-CineBraid-Project-Revision", revision);
    }
    const project = inspected.project;
    normalizePromptBuildHistory(project, { applyRetention: false });
    /* The document this response was built from is handed straight to the ledger,
       so activation costs no second read and indexes exactly what was served. */
    noteProjectActivity("open", inspected.slug, project);
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: "Could not open the active project — " + e.message });
  }
});
/* Seconds a shot actually declares, under any supported alias, and 0 when it
   declares none. Report surfaces want the stored number or nothing — never the
   compiler's invented default — so this reads the shared resolver but refuses
   its fallback. Both readers used to consult only `sec || duration`, which
   reported 0 for every shot the current editor wrote. */
function shotListDurationSeconds(shot) {
  const resolved = resolveShotDuration(shot);
  return resolved.wasDefaulted ? 0 : resolved.seconds;
}
function projectReadinessIssues(P) {
  const issues = [], seenShotIssues = new Set(), entityIssues = new Map();
  const addShotIssue = (kind, message, href, shotId = "", entityId = "") => {
    const key = `${kind}:${shotId}:${entityId}:${message}`;
    if (seenShotIssues.has(key)) return;
    seenShotIssues.add(key);
    issues.push({ kind, message, href, shotId, shotIds: shotId ? [shotId] : [], entityId });
  };
  const addEntityIssue = (kind, message, href, shotId = "", entityId = "") => {
    const key = `${kind}:${entityId}`;
    const current = entityIssues.get(key) || { kind, message, href, shotId, entityId, shotIds: [] };
    if (shotId && !current.shotIds.includes(shotId)) current.shotIds.push(shotId);
    if (!current.shotId && shotId) current.shotId = shotId;
    entityIssues.set(key, current);
  };
  const entityLists = { character: "characters", location: "locations", prop: "props", vehicle: "vehicles" };
  const entityRoutes = { character: "character", location: "location", prop: "prop", vehicle: "vehicle" };
  for (const shot of P.shots || []) {
    const unresolved = unresolvedShotDependencies(P, shot);
    for (const dependency of unresolved) {
      const type = String(dependency.type || "reference").replace(/-/g, " ");
      addShotIssue("unresolved-reference", `${shot.id} references missing ${type} ${dependency.id}. Relink or remove it in Shot Inputs.`, `#/shot/${encodeURIComponent(shot.id)}`, shot.id, dependency.id);
    }
    /* `codes[]` resolution is deliberately unchanged; only its losses are now
       reported. A token that is not an exact id either had specificity thrown
       away by the prefix compatibility rule, matched more than one entity, or
       named nothing — and until now all three were silent. */
    const reportedUnresolved = new Set(unresolved.map((row) => String(row.id)));
    for (const code of lossyShotCodeTokens(P, shot)) {
      if (code.status === "unresolved") {
        if (reportedUnresolved.has(code.token)) continue;
        addShotIssue("code-unresolved", `${shot.id} lists ${code.token} in its shot codes, but it does not name a known production entity. Relink or remove it in Shot Inputs.`, `#/shot/${encodeURIComponent(shot.id)}`, shot.id, code.token);
        continue;
      }
      if (code.status === "ambiguous") {
        addShotIssue("code-ambiguous", `${shot.id} shot code ${code.token} matches more than one entity (${code.matches.map((match) => match.id).join(", ")}); CineBraid is using ${code.id}. Use the exact id in Shot Inputs.`, `#/shot/${encodeURIComponent(shot.id)}`, shot.id, code.id);
        continue;
      }
      addShotIssue("code-reinterpreted", `${shot.id} shot code ${code.token} resolves to ${code.id} using legacy compatibility; the "${code.discarded}" part is ignored, so any reference-view specificity it carried is lost.`, `#/shot/${encodeURIComponent(shot.id)}`, shot.id, code.id);
    }
    const context = PromptEngine.buildContext(P, shot.id, "");
    if (!String(context.shot.description || "").trim() && !String(context.scene.beat || "").trim()) addShotIssue("shot-description", `${shot.id} has no description or scene beat.`, `#/shot/${encodeURIComponent(shot.id)}`, shot.id);
    if (context.shot.durationWasDefaulted) addShotIssue("shot-duration", `${shot.id} has no explicit duration.`, `#/shot/${encodeURIComponent(shot.id)}`, shot.id);
    for (const ref of context.references || []) {
      if (ref.type === "audio") continue;
      const list = entityLists[ref.type], route = entityRoutes[ref.type];
      if (!list || !route) continue;
      const entity = (P[list] || []).find((item) => String(item.id) === String(ref.id));
      const href = `#/${route}/${encodeURIComponent(ref.id || "")}`;
      if (!String(ref.canon || "").trim()) addEntityIssue("entity-canon", `${ref.name || ref.id} has no canon text.`, href, shot.id, ref.id);
      /* NON-AUTHORITATIVE BY CONSTRUCTION: this reports the ABSENCE of an image,
         which pointer presence answers correctly and a receipt does not. It makes
         no claim that a present image was approved, and the wording no longer
         says it did — a legacy project full of unreceipted pointers is not
         "missing references", it is pending approval, which the reference page
         reports as HISTORIC. */
      if (!String(ref.approvedFile || "").trim()) addEntityIssue("entity-reference", `${ref.name || ref.id} has no reference image.`, href, shot.id, ref.id);
      else if (!entityApprovedDiskPath(list, entity)) addEntityIssue("missing-file", `${ref.name || ref.id} points to an approved file that is missing from disk.`, href, shot.id, ref.id);
    }
  }
  for (const issue of entityIssues.values()) {
    const affected = issue.shotIds.length;
    const message = affected > 1 ? `${issue.message} Affects ${affected} shots.` : issue.message;
    issues.push({ ...issue, message });
  }
  return issues;
}
/* Where each entity list keeps its media on disk, for the readiness oracle below.
   entityApprovedDiskPath() carries the same map as a literal and explains at its
   own declaration why it cannot read this one; tests/shot-readiness.js asserts the
   two agree, so the duplication is checked rather than hoped. */
const ENTITY_MEDIA_DIR = { characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" };

/* THE MEDIA ORACLE READINESS IS ALLOWED TO HAVE.
 *
 * public/shared-shot-readiness.js cannot reach a filesystem by construction, so the
 * caller supplies the listing it resolves approvals against. This is that listing,
 * and every part of how it is built is a constraint rather than an implementation
 * detail:
 *
 *   IT DOES NOT CALL scanProject(). That function syncs a configured media root
 *   (which COPIES FILES) and schedules a MediaAsset activation pass. Both are real
 *   work with real side effects, and readiness is answered on every render of the
 *   production home view. Asking "what can I work on" must not move bytes around.
 *
 *   IT READS NO BYTES. `listMedia` is readdir plus an extension filter, and
 *   `identityIndex` reads the ledger sidecar that is already on disk. Neither opens
 *   a media file, so a project sitting in OneDrive/Dropbox/Drive is not hydrated by
 *   being asked whether it is ready. media-asset-verify.js owns byte reads and says
 *   why: hashing is a deliberate act with a visible cost, never a side effect.
 *
 *   IT IS CACHED PER CALL, NOT ACROSS CALLS. One directory is listed at most once
 *   per readiness answer, and the cache dies with the request — a cached listing
 *   that outlived the request would make a deleted file keep reading as present.
 *
 * The identity index is what makes the answer rename-proof: with it, an approval
 * whose file was renamed still resolves through resolveApprovalMedia(), which is
 * identity-first. Without it the resolver falls back to the filename and behaves
 * exactly as it did before media identity existed. */
function readinessMediaOracle() {
  const directories = new Map();
  let identity = null;
  const listing = (rel) => {
    if (!directories.has(rel)) {
      if (identity === null) identity = mediaIdentityIndex();
      directories.set(rel, listMedia(rel, identity));
    }
    return directories.get(rel);
  };
  return {
    mediaListing: (list, entityId) => {
      const folder = ENTITY_MEDIA_DIR[String(list || "")];
      return folder && entityId ? listing(folder) : [];
    },
    shotMediaListing: (shotId) => {
      const id = path.basename(String(shotId || ""));
      return id ? listing(path.join("shots", id, "takes")) : [];
    },
  };
}

/* ONE READINESS VERDICT IN THIS PAYLOAD, AND IT IS `readiness`.
 *
 * THE CORRECTION THE ACCEPTANCE AUDIT REQUIRED. This route used to return the
 * legacy list as a top-level `issues` array beside the new derivation, and the two
 * competed: a project whose only problem was an unconfirmed pointer answered
 * `issues: []` — which every consumer reads as "nothing to resolve, this is ready"
 * — next to `readiness.status: "NEEDS_DECISION"` for the same reference. Two
 * truths, and the older one was the one that looked like an all-clear.
 *
 * The legacy projection is KEPT, because it answers a genuinely useful and
 * genuinely different question: is the project SET UP — descriptions, durations,
 * canon text, relinked references, files on disk. In particular its
 * `entity-reference` issue stays POINTER-BASED, exactly as its own comment says:
 * it reports the ABSENCE of an image and makes no claim that a present image was
 * approved. That reading is correct for what it answers.
 *
 * What changed is that it can no longer be MISTAKEN for the verdict. It moves
 * inside a `setup` envelope that names what it answers and states plainly that it
 * is not a readiness verdict, and the top-level `issues` key is gone rather than
 * kept as an alias — an alias would leave the ambiguity in place while adding a
 * second spelling of it. A consumer reading `data.issues` now gets `undefined`,
 * which is a loud break rather than a silent wrong answer. */
function shotReadinessProjection(P) {
  return ShotReadiness.evaluateProjectReadiness(P, readinessMediaOracle());
}
const PROJECT_SETUP_ANSWERS = "project-setup-completeness";
app.get("/api/project/readiness", (req, res) => {
  try {
    const project = readProject();
    res.json({
      checkedAt: new Date().toISOString(),
      /* The verdict. READY / BLOCKED / NEEDS_DECISION belong to this and to
         nothing else in the response. */
      readiness: shotReadinessProjection(project),
      setup: {
        answers: PROJECT_SETUP_ANSWERS,
        /* Stated in the payload rather than only in a comment, so a machine
           consumer can see that an empty list is not an all-clear. */
        isReadinessVerdict: false,
        issues: projectReadinessIssues(project),
      },
    });
  } catch (error) {
    res.status(httpStatusForError(error)).json({ error: error.message || "Could not check project readiness" });
  }
});
app.put("/api/projects/:slug/project", (req, res) => {
  try {
    /* Containment first, unconditionally: an out-of-root slug is refused before
       any revision reasoning, so Repair A's boundary stays the outermost gate. */
    const { slug, file } = projectDirForSlug(req.params.slug),
      current = fs.existsSync(file)
      ? readJsonSync(file)
      : {};

    /* Optimistic concurrency. The client must say which document it edited; if
       storage has moved on, its body is stale by definition and is refused
       whole. No deep merge is attempted — silently interleaving two divergent
       documents is how a lost update becomes an unexplainable one. */
    const storedRevision = projectRevisionFor(file);
    const requested = String(req.headers["if-match"] || "").trim();
    if (storedRevision && !requested)
      return res.status(428).json({
        error: "This save did not say which version of the project it edited. Reload CineBraid and try again.",
        code: "PROJECT_REVISION_REQUIRED",
        slug,
        revision: storedRevision,
      });
    if (storedRevision && requested !== "*" && requested !== storedRevision)
      return res.status(409).json({
        error: "This project changed while this view was open, so the save was refused to protect the newer version. Reload to continue from the current project.",
        code: "PROJECT_REVISION_CONFLICT",
        slug,
        revision: storedRevision,
        yourRevision: requested,
        action: "reload",
      });

    const incoming = normalizeProjectCollections({
      ...req.body,
      agentRuns: Array.isArray(current.agentRuns) ? current.agentRuns : [],
    });
    normalizePromptBuildHistory(incoming, { applyRetention: false });
    const validation = validateProjectForSave(incoming);
    if (!validation.ok) return res.status(422).json({ error: "Project validation failed.", issues: validation.errors });
    const backup = createProjectBackup(file, "autosave");
    atomicWriteJson(file, incoming);
    const revision = projectRevisionFor(file);
    if (revision) {
      res.setHeader("ETag", revision);
      res.setHeader("X-CineBraid-Project-Revision", revision);
    }
    res.json({ ok: true, slug, backup, revision });
    setTimeout(() => {
      if (activeSlug() === slug) maybeAutoIndex();
    }, 100);
  } catch (e) {
    res.status(/No such project|Invalid project slug/.test(e.message) ? 404 : 500).json({ error: e.message });
  }
});
app.get("/api/projects/:slug/backups", (req, res) => {
  try {
    const { slug, file } = projectDirForSlug(req.params.slug);
    res.json({ ok: true, slug, backups: listProjectBackups(file) });
  } catch (e) {
    res.status(/No such project|Invalid project slug/.test(e.message) ? 404 : 500).json({ error: e.message });
  }
});
app.post("/api/projects/:slug/backups", (req, res) => {
  try {
    const { slug, file } = projectDirForSlug(req.params.slug);
    const name = createProjectBackup(file, "manual");
    res.json({ ok: true, slug, name, backups: listProjectBackups(file) });
  } catch (e) {
    res.status(/No such project|Invalid project slug/.test(e.message) ? 404 : 500).json({ error: e.message });
  }
});
app.post("/api/projects/:slug/restore", (req, res) => {
  try {
    const { slug, file } = projectDirForSlug(req.params.slug);
    const name = path.basename(String(req.body?.name || ""));
    if (!/^project-.*\.json$/i.test(name)) return res.status(400).json({ error: "Choose a valid project backup." });
    const backupFile = path.join(projectBackupDir(file), name);
    if (!backupFile.startsWith(projectBackupDir(file) + path.sep) || !fs.existsSync(backupFile)) return res.status(404).json({ error: "Backup not found." });
    const restored = normalizeProjectCollections(readJsonSync(backupFile));
    normalizePromptBuildHistory(restored, { applyRetention: false });
    const validation = validateProjectForSave(restored);
    if (!validation.ok) return res.status(422).json({ error: "Backup validation failed.", issues: validation.errors });
    const safetyBackup = createProjectBackup(file, "before-restore");
    atomicWriteJson(file, restored);
    res.json({ ok: true, slug, restored: name, safetyBackup });
  } catch (e) {
    res.status(/No such project|Invalid project slug/.test(e.message) ? 404 : 500).json({ error: e.message });
  }
});
app.put("/api/project", (req, res) =>
  res.status(409).json({
    error:
      "Project saves must include the project slug. Reload CineBraid before saving again.",
  }),
);

/* Reads a project by slug. The default is the active project, which is what
   every synchronous route wants; asynchronous work passes the slug it captured
   when it started so a project switch cannot move it. */
function readProject(slug = activeSlug()) {
  const project = readJsonSync(slug ? projectDirForSlug(slug).file : DATA());
  normalizePromptBuildHistory(project, { applyRetention: false });
  project.jobs = Array.isArray(project.jobs) ? project.jobs : [];
  project.decisions = Array.isArray(project.decisions) ? project.decisions : [];
  project.agentRuns = Array.isArray(project.agentRuns) ? project.agentRuns : [];
  return project;
}

function writeProject(project, slug = activeSlug()) {
  if (!slug) throw new Error("No active project.");
  atomicWriteJson(projectDirForSlug(slug).file, project);
}

/* ---- media scan ---- */
function syncConfiguredMediaRoot() {
  const config = readConfig();
  if (config.workspace?.syncMode !== "assisted") return { copied: 0, skipped: 0 };
  const root = configuredWorkspacePath("mediaRoot", config);
  if (!root || !fs.existsSync(root)) return { copied: 0, skipped: 0 };
  const slug = activeSlug() || "";
  const scoped = slug && fs.existsSync(path.join(root, slug)) ? path.join(root, slug) : root;
  let copied = 0, skipped = 0;
  for (const subdir of SUBDIRS.filter((item) => item !== "docs")) {
    const source = path.join(scoped, subdir);
    if (!fs.existsSync(source)) continue;
    const result = copyMissingTree(source, path.join(PROJECT_DIR(), subdir));
    copied += result.copied; skipped += result.skipped;
  }
  return { copied, skipped, source: scoped };
}
/* P4-SEM-C2 — a READ-ONLY projection of the MediaAsset ledger: project-relative
   path -> durable assetId.

   C1 gave every file an identity and kept it entirely server-side, so nothing the
   browser writes could carry it. This is the one place that identity crosses to
   the client, and it crosses as a fact about a file rather than as an authority
   over anything: the ledger still decides nothing about approval, and a project
   whose ledger has never run simply reports no ids at all.

   Three properties are deliberate. It READS and never writes, so INV-R1 holds and
   listing media cannot mint anything. It CANNOT THROW into a response — an
   unreadable ledger yields an empty index and the scan answers exactly as it did
   before C2, because losing an optional id is not a reason to fail a scan that
   the whole application depends on. And it SKIPS rows marked missing, so an
   identity retained for a file that no longer exists can never shadow a live one.

   Built once per scan and passed down, rather than read per directory: a project
   with fifty shots calls listMedia over 150 times.

   Routed through MediaAssetService rather than reading the ledger here. C1 made
   that module the single production importer of the ledger and pinned the count
   at one (tests/media-asset-activation-boundary.js); a second reader in server.js
   would be a second answer to "who reads the ledger, and when", which is the
   property activation was granted in exchange for. */
function mediaIdentityIndex() {
  return MediaAssetService.identityIndex({ projectsRoot: projectsRoot(), slug: activeSlug() });
}
function listMedia(rel, identity = null) {
  const dir = path.join(PROJECT_DIR(), rel);
  if (!fs.existsSync(dir)) return [];
  const relPosix = rel.split(path.sep).join("/");
  return fs
    .readdirSync(dir)
    .filter((f) => MEDIA_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => {
      const assetId = identity ? identity.get(`${relPosix}/${f}`) : "";
      return {
        name: f,
        url: "/assets/" + relPosix + "/" + f,
        /* Absent, not empty, when the ledger does not know this file. An empty
           string would read as "identity was looked up and is blank"; omitting
           the key says "this project has no identity for it", which is the
           legal and expected state for media indexed before its first pass. */
        ...(assetId ? { assetId } : {}),
      };
    });
}
/* ---- MediaAsset identity activation (P4-SEM-C1) ----

   Every media file a project holds acquires a durable assetId that survives the
   rename its own approval performs. The pass runs OFF the request path: this
   function schedules and returns immediately, so no route ever waits on readdir,
   stat or a digest, and a failure inside the pass cannot reach the response.

   Four callers, and they are the only ones. Two of them are what "the project
   became active" means in this product — GET /api/project is the document read
   every load and every switch performs, and POST /api/projects/switch is the
   explicit move. GET /api/scan is how new media acquires identity without
   restarting CineBraid: it is the product's own media re-enumeration, so anything
   that causes CineBraid to look at the media folders again also causes the ledger
   to catch up. The service throttles and coalesces that burst. POST
   /api/media/rename is the fourth, and the only one that is never throttled,
   because a rename is a change CineBraid itself just made to the filesystem.

   `project` is passed when the caller already parsed the document, so a normal
   open costs one project.json read rather than two. */
function noteProjectActivity(reason, slug = activeSlug(), project = null) {
  if (!slug) return;
  MediaAssetService.activateProject({
    projectsRoot: projectsRoot(),
    slug,
    reason,
    project,
    /* Chunks stop writing if the user moves to another project mid-pass. */
    activeSlug,
  });
}

function scanProject() {
  const sync = syncConfiguredMediaRoot();
  const shotsDir = path.join(PROJECT_DIR(), "shots");
  const shots = {};
  const identity = mediaIdentityIndex();
  if (fs.existsSync(shotsDir))
    for (const id of fs.readdirSync(shotsDir))
      shots[id] = {
        takes: listMedia(path.join("shots", id, "takes"), identity),
        locked: listMedia(path.join("shots", id, "locked"), identity),
        blocking: listMedia(path.join("shots", id, "blocking"), identity),
      };
  return {
    anchors: listMedia("anchors", identity),
    plates: listMedia("plates", identity),
    props: listMedia("props", identity),
    vehicles: listMedia("vehicles", identity),
    audio: listMedia("audio", identity),
    media: listMedia("media", identity),
    shots,
    workspaceSync: sync,
  };
}
app.get("/api/scan", (req, res) => {
  const scan = scanProject();
  /* After the sync copy, so media just brought in from a configured mediaRoot is
     visible to the pass. Scheduled, never awaited — the scan answers now. */
  noteProjectActivity("scan");
  res.json(scan);
});
app.post(
  "/api/shots/:id/take",
  express.raw({ type: "*/*", limit: "400mb" }),
  (req, res) => {
    try {
      const id = path.basename(req.params.id);
      const name = path
        .basename(String(req.query.name || "take.png"))
        .replace(/[^\w.\-]/g, "_");
      const dir = path.join(ownedProjectDir(req), "shots", id, "takes");
      fs.mkdirSync(dir, { recursive: true });
      let final = name,
        n = 1;
      while (fs.existsSync(path.join(dir, final))) {
        const dot = name.lastIndexOf(".");
        final = name.slice(0, dot) + "_" + ++n + name.slice(dot);
      }
      fs.writeFileSync(path.join(dir, final), req.body);
      res.json({ ok: true, name: final });
    } catch (error) {
      res.status(mediaOwnerStatus(error)).json({ error: error.message });
    }
  },
);

app.post(
  "/api/shots/:id/blocking",
  express.raw({ type: "*/*", limit: "400mb" }),
  (req, res) => {
    try {
      const id = path.basename(String(req.params.id || ""));
      if (!id) return res.status(400).json({ error: "shot id required" });
      const requested = path
        .basename(String(req.query.name || `${id}_BLOCKING.png`))
        .replace(/[^\w.\-]/g, "_");
      const ext = path.extname(requested).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext))
        return res.status(400).json({ error: "Blocking frames must be still images" });
      const dir = path.join(ownedProjectDir(req), "shots", id, "blocking");
      fs.mkdirSync(dir, { recursive: true });
      const stem = path.basename(requested, ext) || `${id}_BLOCKING`;
      let final = stem + ext, n = 1;
      while (fs.existsSync(path.join(dir, final))) final = `${stem}_${++n}${ext}`;
      fs.writeFileSync(path.join(dir, final), req.body);
      const storagePath = `shots/${id}/blocking/${final}`;
      res.json({ ok: true, name: final, storagePath, url: `/assets/${storagePath.split("/").map(encodeURIComponent).join("/")}` });
    } catch (error) {
      res.status(400).json({ error: error.message || "Could not store blocking frame" });
    }
  },
);

app.post(
  "/api/media/upload",
  express.raw({ type: "*/*", limit: "400mb" }),
  (req, res) => {
    try {
    const type = String(req.query.type || "");
    if (!["anchors", "plates", "props", "vehicles", "audio", "media"].includes(type))
      return res.status(400).json({ error: "bad type" });
    const name = path
      .basename(String(req.query.name || "file.png"))
      .replace(/[^\w.\-]/g, "_");
    const dir = path.join(ownedProjectDir(req), type);
    fs.mkdirSync(dir, { recursive: true });
    let final = name,
      n = 1;
    while (fs.existsSync(path.join(dir, final))) {
      const dot = name.lastIndexOf(".");
      final = name.slice(0, dot) + "_" + ++n + name.slice(dot);
    }
    fs.writeFileSync(path.join(dir, final), req.body);
    res.json({ ok: true, name: final });
    } catch (error) {
      res.status(mediaOwnerStatus(error)).json({ error: error.message });
    }
  },
);
app.post("/api/media/rename", async (req, res) => {
  const { dir, from, to } = req.body || {};
  const safeDir = ["anchors", "plates", "props", "vehicles", "audio", "media"].includes(dir)
    ? dir
    : /^shots\/[\w.\-]+\/(takes|locked|blocking)$/.test(dir)
      ? dir
      : null;
  if (!safeDir) return res.status(400).json({ error: "bad dir" });
  let owned;
  try {
    owned = ownedProjectDir(req);
  } catch (error) {
    return res.status(mediaOwnerStatus(error)).json({ error: error.message });
  }
  const src = path.join(
    owned,
    safeDir,
    path.basename(String(from || "")),
  );
  const ext = path.extname(String(from || ""));
  let toName = path.basename(String(to || "")).replace(/[^\w.\-]/g, "_");
  if (!toName.toLowerCase().endsWith(ext.toLowerCase())) toName += ext;
  const dst = path.join(owned, safeDir, toName);
  if (!fs.existsSync(src))
    return res.status(404).json({ error: "source missing" });
  if (fs.existsSync(dst)) return res.status(409).json({ error: "name taken" });
  /* The only place CineBraid moves a media file, and the route both approval paths
     go through. A rename is provably the same media only if a digest was captured
     while the file still existed at the old path, so the ledger is given its one
     chance to take one — before the move, never after. Costs a single hash, and
     nothing when the row is already verified. It cannot throw and cannot refuse:
     an unanchored rename is the pre-C1 behaviour, not a reason to block an
     approval. */
  const renamedSlug = path.basename(owned);
  const anchor = await MediaAssetService.anchorBeforeRename({
    projectsRoot: projectsRoot(),
    slug: renamedSlug,
    path: `${safeDir}/${path.basename(src)}`,
  });
  fs.renameSync(src, dst);
  /* And the pass that reconciles the move: the new path is discovered, hashed as a
     new arrival, and matched to the digest just anchored. "rename" rather than
     "scan" because the filesystem provably just changed, so this pass must not be
     collapsed into the scan throttle. */
  noteProjectActivity("rename", renamedSlug);
  /* P4-SEM-C4 — the generation ledger follows the bytes too.
   *
   * C2 repairs every entity approval edge and C3 repairs every shot winner edge,
   * both from the browser, because both records live in project.json. A job
   * record does not: `outputs[]` is server-owned, the browser has no write path
   * to it, and nothing repaired it. So approving a generated take under its
   * canonical name left the job that produced it naming a file no longer on
   * disk — the forward provenance edge breaking at exactly the moment the media
   * became canon.
   *
   * Awaited rather than fired and forgotten: the repair is durable before this
   * route reports success, so a client that reloads the job list immediately
   * cannot read the pre-rename names back. It costs one small JSON read when no
   * job names the file, which is the common case. It never throws. */
  await FalGeneration.repairJobMediaIdentity({
    slug: renamedSlug,
    dir: safeDir,
    from: path.basename(src),
    to: toName,
    assetId: anchor?.assetId || "",
  });
  /* P4-SEM-C2 — the anchored identity, handed back to the caller that is about to
     repair its own pointers.

     This route already proved the two filenames name the same media: it hashed the
     file before moving it, which is the only moment at which that can be proven.
     C1 kept the result to itself, so the approval flow could only repair edges by
     matching the old string. Returning the id lets the edge record WHAT it points
     at, so the next rename is repaired by identity instead.

     Omitted, never empty, when the rename could not be anchored — no ledger yet, no
     row, or an unreadable sidecar. That is the pre-C1 state and is not an error;
     the caller falls back to filename repair exactly as before. */
  res.json({ ok: true, name: toName, ...(anchor?.assetId ? { assetId: anchor.assetId } : {}) });
});

app.post("/api/shots/:id/use-reference", (req, res) => {
  try {
    const id = path.basename(String(req.params.id || ""));
    if (!id) return res.status(400).json({ error: "shot id required" });
    const source = resolveProjectAssetUrl(String(req.body?.url || ""));
    const ext = path.extname(source).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext))
      return res.status(400).json({ error: "Only still-image references can become a shot image" });
    const dir = path.join(ownedProjectDir(req), "shots", id, "takes");
    fs.mkdirSync(dir, { recursive: true });
    const requested = path.basename(
      String(req.body?.name || `${id}_APPROVED_BASE${ext}`),
    ).replace(/[^\w.\-]/g, "_");
    const stem = path.basename(requested, path.extname(requested)) || `${id}_APPROVED_BASE`;
    let final = stem + ext;
    let n = 1;
    while (fs.existsSync(path.join(dir, final)))
      final = `${stem}_${++n}${ext}`;
    fs.copyFileSync(source, path.join(dir, final));
    res.json({
      ok: true,
      name: final,
      url: `/assets/shots/${encodeURIComponent(id)}/takes/${encodeURIComponent(final)}`,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || "Could not use reference" });
  }
});

app.post("/api/shots/:id/folder", (req, res) => {
  try {
    const id = path.basename(req.params.id);
    const owned = ownedProjectDir(req);
    fs.mkdirSync(path.join(owned, "shots", id, "takes"), { recursive: true });
    fs.mkdirSync(path.join(owned, "shots", id, "locked"), { recursive: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(mediaOwnerStatus(error)).json({ error: error.message });
  }
});

app.post("/api/reference-pack", async (req, res) => {
  try {
    const refs = Array.isArray(req.body.references)
      ? req.body.references.slice(0, 24)
      : [];
    if (!refs.length)
      return res.status(400).json({ error: "Select at least one reference" });
    const shotId = String(req.body.shotId || "shot").replace(/[^a-z0-9_.-]+/gi, "-");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${shotId}_reference-pack.zip"`,
    );
    const archive = new SimpleZipWriter(res);
    const manifest = [];
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i] || {};
      const file = resolveProjectAssetUrl(ref.url);
      const original = path.basename(file);
      const role = String(ref.role || "reference").replace(/[^a-z0-9_-]+/gi, "-");
      const name = `${String(i + 1).padStart(2, "0")}-${role}-${original}`;
      await archive.addFile(name, file);
      manifest.push({
        order: i + 1,
        role: ref.role || "reference",
        label: ref.label || original,
        file: name,
        instruction: ref.instruction || "",
      });
    }
    await archive.addBuffer(
      "REFERENCE_MANIFEST.json",
      JSON.stringify({ shotId, references: manifest }, null, 2),
    );
    await archive.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.end();
  }
});

/* ---- canon docs ---- */
app.get("/api/docs", (req, res) => {
  const dir = path.join(PROJECT_DIR(), "docs");
  res.json(
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .sort()
      : [],
  );
});
app.get("/api/docs/:name", (req, res) => {
  const f = path.join(PROJECT_DIR(), "docs", path.basename(req.params.name));
  if (!fs.existsSync(f)) return res.status(404).send("Not found");
  res.type("text/plain").send(fs.readFileSync(f, "utf8"));
});

/* ---- config (credentials stay server-side; masked on read) ----
   Which fields are credentials is declared once, in config.js's CONFIG_SECRETS.
   Both halves below derive from it, so a new secret is a line in that list rather
   than an edit to a mask list here and a restore list a few lines down. */
app.get("/api/config", (req, res) => {
  const c = readConfig();
  const safe = maskSecrets(c);
  /* FAL's displayed key reflects the FAL_KEY environment override, which is not
     part of the stored config and so is not something the registry can see. */
  if (safe.generation?.fal) {
    const envFalKey = process.env.FAL_KEY || "";
    safe.generation.fal.apiKey = maskSecretValue(envFalKey || c.generation?.fal?.apiKey);
    safe.generation.fal.keySource = envFalKey ? "environment" : c.generation?.fal?.apiKey ? "settings" : "none";
  }
  res.json(safe);
});
app.put("/api/config", (req, res) => {
  const current = readConfig();
  const body = req.body && typeof req.body === "object" ? req.body : {};

  /* Account connections are not editable through the general config endpoint.
     Two distinct failures are prevented by one rule.

     The first is silent credential loss: `accounts` is an array, so a merge
     replaces it wholesale, and the masked projection a client echoes back has the
     OAuth tokens removed by the registry. Merging that echo would store accounts
     whose credentials had quietly become empty.

     The second is the mirror image: a patch that adds an ACCOUNT THE SERVER HAS
     NEVER SEEN, carrying a mask marker where a credential goes. The registry
     correctly refuses to turn a marker into a secret, so the result would be a
     connection recorded with an empty credential — a broken account that looks
     configured.

     Compared against the projection BEFORE restoreSecrets runs, because restore is
     what turns the echo back into stored values and would make every incoming
     shape look different. A client that round-trips exactly what GET returned
     changes nothing and is accepted; anything else is refused by name, so a caller
     is told where account changes belong rather than having them ignored. */
  if (Object.prototype.hasOwnProperty.call(body, "accounts")) {
    const projection = JSON.stringify(maskSecrets(current).accounts || []);
    if (JSON.stringify(body.accounts) !== projection) {
      return res.status(400).json({
        error: "Account connections are managed from Settings → Accounts, not through general configuration.",
        code: "ACCOUNT_ENDPOINT_REQUIRED",
      });
    }
  }

  const patch = restoreSecrets(body, current);
  delete patch.accounts;

  const storageKeys = ["projectRoot", "mediaRoot", "outputRoot", "backupRoot"];
  const attemptedStorageKeys = storageKeys.filter((key) => Object.prototype.hasOwnProperty.call(patch.workspace || {}, key));
  if (attemptedStorageKeys.length) {
    return res.status(400).json({
      error: `Storage paths cannot be changed through the general config endpoint (${attemptedStorageKeys.join(", ")}). Use Settings → Files & storage so CineBraid can validate access, copy missing projects, and report the migration safely.`,
      code: "WORKSPACE_SETTINGS_ENDPOINT_REQUIRED",
    });
  }

  writeConfig(mergeConfig(current, patch));
  res.json({ ok: true });
});


app.get("/api/workspace/status", (req, res) => {
  try { res.json({ ok: true, ...workspaceStatus() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.post("/api/workspace/settings", (req, res) => {
  try {
    const current = readConfig();
    const incoming = req.body && typeof req.body === "object" ? req.body : {};
    const requestedWorkspace = { ...(current.workspace || {}), ...(incoming.workspace || {}) };
    const requestedNaming = { ...(current.naming || {}), ...(incoming.naming || {}) };
    const previousRoot = projectsRoot(current);
    const nextConfig = mergeConfig(current, { workspace: requestedWorkspace, naming: requestedNaming });
    const nextRoot = projectsRoot(nextConfig);
    const paths = [nextRoot, configuredWorkspacePath("mediaRoot", nextConfig), configuredWorkspacePath("outputRoot", nextConfig), configuredWorkspacePath("backupRoot", nextConfig)].filter(Boolean);
    paths.forEach(safeEnsureDirectory);
    let migration = { copied: 0, skipped: 0, movedRoot: false };
    if (path.resolve(previousRoot) !== path.resolve(nextRoot) && fs.existsSync(previousRoot)) {
      const result = copyMissingTree(previousRoot, nextRoot);
      migration = { ...result, movedRoot: true, from: previousRoot, to: nextRoot };
    }
    writeConfig(nextConfig);
    res.json({ ok: true, migration, ...workspaceStatus(nextConfig) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not apply workspace settings" });
  }
});

app.post("/api/assistant/test", async (req, res) => {
  try {
    const provider = String(
      req.body?.provider || readConfig().assistant?.provider || "ollama",
    );
    if (provider === "none")
      return res.json({
        ok: true,
        provider,
        message: "AI assistance is disabled.",
      });
    const text = await llm(
      "prompt",
      "Reply with exactly: CineBraid assistant connected",
      "Connection test.",
      40,
      provider,
    );
    const message = String(text || "").trim();
    if (!message) throw new Error("Assistant connected but returned an empty final response. For local Qwen models, confirm CineBraid can use Ollama native chat with thinking disabled.");
    if (!/cinebraid assistant connected/i.test(message)) throw new Error(`Assistant returned an unexpected test response: ${message.slice(0, 180)}`);
    res.json({ ok: true, provider, message });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/project/ask", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question)
      return res.status(400).json({ error: "Write a project question first." });
    const cfg = readConfig();
    const provider = cfg.assistant?.provider || "ollama";
    if (provider === "none" || projectAIPolicy() === "disabled")
      return res
        .status(400)
        .json({ error: "AI assistance is disabled for this project." });
    const P = readProject();
    const mediaScan = scanProject();
    const compact = {
      project: {
        title: P.meta?.title || "",
        format: P.meta?.format || "",
        world: P.meta?.world || {},
        decisions: (P.decisions || []).slice(-30),
      },
      scenes: (P.scenes || []).map((sc) => ({
        id: sc.id,
        title: sc.title,
        whatHappens: sc.whatHappens || "",
        howItFeels: sc.howItFeels || "",
        stage: sc.stage || "",
      })),
      shots: (P.shots || []).map((s) => ({
        id: s.id,
        scene: s.scene,
        title: s.title,
        description: s.desc || "",
        positioning: s.positioning || "",
        workflowStatus: s.workflowStatus || "",
        characters: s.characters || [],
        codes: s.codes || [],
        keyframes: (s.keyframes || []).map((f) => ({
          label: f.label,
          title: f.title,
          /* MB-PT-02: the assistant is told what is APPROVED, so it must be
             told the truth. A pointer is not an approval. */
          approved: ProductionAuthority.hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: s.id, frameId: f.id }),
          description: f.description || "",
        })),
        motion: (s.clips || []).map((c) => ({
          label: c.label || c.suffix,
          title: c.title,
          duration: c.dur,
          method: c.kind,
          direction: c.motionPrompt || c.note || "",
          fromFrame: c.fromFrame || "",
          toFrame: c.toFrame || "",
          packageCount: (c.generationPackages || []).length,
          approved: ProductionAuthority.hasCurrentHumanAuthority(P, { kind: "shot-motion", shotId: s.id, unitKey: c.id || c.suffix || "" }),
        })),
        candidateCount: (mediaScan.shots?.[s.id]?.takes || []).length,
        notes: s.notes || "",
        risks: s.risks || [],
      })),
      continuity: {
        characters: (P.characters || []).map((x) => ({
          id: x.id,
          name: x.name,
          block: x.block || "",
          driftNotes: x.driftNotes || "",
          states: x.continuityStates || [],
        })),
        locations: (P.locations || []).map((x) => ({
          id: x.id,
          name: x.name,
          notes: x.notes || "",
          states: x.continuityStates || [],
        })),
        props: (P.props || []).map((x) => ({
          id: x.id,
          name: x.name,
          notes: x.notes || "",
          states: x.continuityStates || [],
        })),
        vehicles: (P.vehicles || []).map((x) => ({
          id: x.id,
          name: x.name,
          notes: x.notes || "",
          states: x.continuityStates || [],
        })),
      },
    };
    const system = `You are the CineBraid project planning assistant. Answer only from the supplied project record. Be concise and operational. Cite shot IDs and scene IDs whenever possible. Distinguish facts from suggestions. Never claim to have changed the project. If information is missing, say so.`;
    const answer = await llm(
      "prompt",
      system,
      `PROJECT RECORD:
${JSON.stringify(compact)}

QUESTION:
${question}`,
      5000,
      provider,
    );
    res.json({ ok: true, provider, answer: String(answer || "").trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---- simple local system health ---- */
async function probeJson(url, timeoutMs = 1800, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, headers });
    if (!r.ok) return { ok: false, error: "HTTP " + r.status };
    return { ok: true, data: await r.json().catch(() => ({})) };
  } catch (e) {
    return {
      ok: false,
      error: e.name === "AbortError" ? "timeout" : e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

const OLLAMA_MODEL_CACHE = { at: 0, base: "", result: null };
function cleanModelName(value) {
  return String(value || "").trim();
}
function exactModelReady(names, configuredName) {
  const wanted = cleanModelName(configuredName);
  if (!wanted) return false;
  return (names || []).some((name) => {
    const installed = cleanModelName(name);
    if (installed === wanted) return true;
    // Ollama may report an untagged model as :latest. Explicit tags remain exact.
    return !wanted.includes(":") && installed === wanted + ":latest";
  });
}
async function ollamaInventory(cfg = readConfig(), force = false) {
  const base = String(cfg.ollamaUrl || "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
  if (
    !force &&
    OLLAMA_MODEL_CACHE.result &&
    OLLAMA_MODEL_CACHE.base === base &&
    Date.now() - OLLAMA_MODEL_CACHE.at < 10000
  )
    return OLLAMA_MODEL_CACHE.result;
  const probe = await probeJson(base + "/api/tags", 2200);
  const result = {
    ok: probe.ok,
    error: probe.error || "",
    base,
    models: (probe.data?.models || [])
      .map((x) => x.name || x.model)
      .filter(Boolean),
  };
  OLLAMA_MODEL_CACHE.at = Date.now();
  OLLAMA_MODEL_CACHE.base = base;
  OLLAMA_MODEL_CACHE.result = result;
  return result;
}

/* A custom provider's failure is described without repeating anything about where it
   lives. Network errors carry the URL they failed against, and this text reaches the
   browser. */
function safeProviderError(error) {
  const text = String(error || "").trim();
  if (!text) return "";
  if (/^HTTP \d+$/.test(text)) return text;
  if (text === "timeout") return "timeout";
  return "unreachable";
}
const CUSTOM_MODEL_CACHE = { at: 0, base: "", result: null };
/* Readiness for a custom OpenAI-compatible provider. The inventory deliberately
   carries no base URL: unlike the Ollama endpoint, which the operator sets and reads
   back in Settings, a custom endpoint may be an internal service the browser must
   never learn about. */
/* One probe of one OpenAI-compatible endpoint. Each caller brings its own memo
   slot, because continuity may be pointed at a different address than the
   general custom provider and the two answers must not overwrite each other. */
async function openAiCompatibleInventory(base, key, cache, force = false) {
  const address = String(base || "").trim().replace(/\/$/, "");
  if (!address) return { ok: false, configured: false, error: "", models: [] };
  if (!force && cache.result && cache.base === address && Date.now() - cache.at < 10000)
    return cache.result;
  const probe = await probeJson(address + "/models", 2200, key ? { authorization: "Bearer " + key } : {});
  const listed = Array.isArray(probe.data?.data)
    ? probe.data.data
    : Array.isArray(probe.data?.models)
      ? probe.data.models
      : [];
  const result = {
    ok: probe.ok,
    configured: true,
    error: safeProviderError(probe.error),
    models: listed.map((x) => x?.id || x?.name || x?.model).filter(Boolean).slice(0, 40),
  };
  cache.at = Date.now();
  cache.base = address;
  cache.result = result;
  return result;
}
async function customInventory(cfg = readConfig(), force = false) {
  return openAiCompatibleInventory(cfg.customBaseUrl, cfg.customKey, CUSTOM_MODEL_CACHE, force);
}
const CONTINUITY_MODEL_CACHE = { at: 0, base: "", result: null };
/* Continuity's own endpoint answers for itself. When it is riding on the
   general custom connection this is the same probe, so nothing is asked twice. */
async function continuityInventory(cfg = readConfig(), force = false) {
  const connection = continuityConnection(cfg);
  if (!connection.provider || !connection.baseUrl) return { ok: false, configured: false, error: "", models: [] };
  if (!connection.standalone && connection.provider === "custom") return customInventory(cfg, force);
  return openAiCompatibleInventory(connection.baseUrl, connection.apiKey, CONTINUITY_MODEL_CACHE, force);
}
const UNPROBED_CUSTOM = { ok: false, configured: false, error: "", models: [] };
/* One inventory read per status request, for every provider that request can consult.
   A custom endpoint is contacted only when something is actually routed to it. */
async function providerInventories(cfg = readConfig(), force = false) {
  const usesCustom =
    cfg.assistant?.provider === "custom" ||
    resolvedVisionProvider(cfg) === "custom" ||
    /* Continuity can be the only consumer pointed at the custom endpoint —
       that is the intended Spark runtime, where general vision is Ollama and
       Ollama may be stopped. Its readiness still has to be answerable. */
    (cfg.continuity?.visionProvider === "custom" && !String(cfg.continuity?.baseUrl || "").trim()) ||
    Object.values(cfg.routing || {}).includes("custom");
  const usesContinuity = !!cfg.continuity?.visionProvider;
  return {
    ollama: await ollamaInventory(cfg, force),
    custom: usesCustom ? await customInventory(cfg, force) : UNPROBED_CUSTOM,
    continuity: usesContinuity ? await continuityInventory(cfg, force) : UNPROBED_CUSTOM,
  };
}

app.get("/api/system/health", async (req, res) => {
  const c = readConfig();
  const provider = c.assistant?.provider || "ollama";
  const inventories = await providerInventories(c, req.query?.refresh === "1");
  const ollama = inventories.ollama;
  const names = ollama.models || [];
  const modelReady = (configuredName) =>
    exactModelReady(names, configuredName);
  const ff = spawnSync("ffmpeg", ["-version"], {
    encoding: "utf8",
    timeout: 1500,
  });
  const configured = {
    ollama: ollama.ok,
    anthropic: !!c.anthropicKey,
    openai: !!c.openaiKey,
    custom: !!c.customBaseUrl && !!c.customModel,
    none: true,
  };
  const capabilities = assistantCapabilities(c, inventories);
  /* Health answers "can CineBraid do this", not "where does it go to do it".
     Provider addresses and keys stay on the server. */
  const publicCapability = (row) => ({
    ready: !!row.ready,
    provider: row.provider,
    model: row.model || "",
  });
  res.json({
    assistant: {
      provider,
      visionProvider: c.assistant?.visionProvider || "same",
      configured: !!configured[provider],
      label:
        {
          ollama: "Local AI",
          anthropic: "Claude API",
          openai: "OpenAI API",
          custom: "Custom AI server",
          none: "No AI",
        }[provider] || provider,
      text: publicCapability(capabilities.text),
      vision: publicCapability(capabilities.vision),
      continuity: publicCapability(capabilities.continuity),
      embedding: publicCapability(capabilities.embedding),
    },
    custom: {
      configured: configured.custom,
      inUse: inventories.custom.configured,
      reachable: inventories.custom.ok,
      error: inventories.custom.error,
      textModel: c.customModel || "",
      visionModel: c.customVisionModel || "",
      models: inventories.custom.models,
    },
    ollama: {
      ok: ollama.ok,
      error: ollama.error || "",
      models: names,
      planner: c.ollamaModel,
      vision: c.ollamaVisionModel,
      embedding: c.ollamaEmbedModel,
      plannerReady: modelReady(c.ollamaModel),
      visionReady: modelReady(c.ollamaVisionModel),
      embeddingReady: modelReady(c.ollamaEmbedModel),
    },
    ffmpeg: {
      ok: ff.status === 0,
      version: (ff.stdout || "").split("\n")[0] || "",
    },
  });
});

/* ---- external LLM Project Builder → validated separate project ---- */
const PROJECT_BUILDER_DIR = path.join(__dirname, "resources", "project-builder");
const IMPORT_PREVIEWS = new Map();
const IMPORT_PREVIEW_TTL_MS = 30 * 60 * 1000;

app.get("/api/project-builder/system-prompt", (req, res) => {
  const file = path.join(
    PROJECT_BUILDER_DIR,
    "CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt",
  );
  if (!fs.existsSync(file))
    return res.status(404).send("Project Builder prompt unavailable.");
  res.type("text/plain").sendFile(file);
});

app.get("/api/project-builder/kit", async (req, res) => {
  try {
    const files = [
      "CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt",
      "CINEBRAID_PROJECT_BUILDER_USER_TEMPLATE.txt",
      "CINEBRAID_PROJECT_SCHEMA_v6.5.3.json",
      "CINEBRAID_PROJECT_BUILDER_MINIMAL_EXAMPLE.json",
      "QUICK_START.md",
      "README.md",
    ].filter(Boolean);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="CineBraid_Project_Builder_Prompt_Kit_v6.5.3.zip"',
    );
    const archive = new SimpleZipWriter(res);
    for (const name of files) {
      const file = path.join(PROJECT_BUILDER_DIR, name);
      if (!fs.existsSync(file))
        throw new Error(`Missing Project Builder resource: ${name}`);
      await archive.addFile(name, file);
    }
    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: error.message });
    else res.destroy(error);
  }
});

function builderArray(value) {
  return Array.isArray(value) ? value : [];
}

function builderObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function builderNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function builderLabel(index) {
  let value = index + 1,
    label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function addBuilderMarker(text, marker, message) {
  const value = String(text || "").trim();
  if (value.includes(marker)) return value;
  return [value, `${marker} ${message}`].filter(Boolean).join("\n");
}

function normalizeBuilderContinuityStates(entity, kind, warnings) {
  const id = String(entity?.id || "(missing id)"),
    states = builderArray(entity?.continuityStates).map((state) => {
      const source = builderObject(state);
      const notes = String(
        source.notes ||
        source.stateDelta ||
        source.delta ||
        source.changeOnly ||
        source.change ||
        source.changes ||
        source.description ||
        source.visualDescription ||
        source.instructions ||
        source.prompt ||
        "",
      );
      return {
        ...source,
        id: String(source.id || ""),
        name: String(source.name || ""),
        appliesTo: String(source.appliesTo || ""),
        approvedFile: String(source.approvedFile || ""),
        notes,
        isDefault: source.isDefault === true,
        /* THE SOURCE LINEAGE THE IMPORT ACTUALLY STATED, under any of the names
           it is written with — `derivesFrom` is OFP's, and ofp-migrate-rules.js
           maps CineBraid's `parentStateId` onto it, so a round trip has to read
           both. Resolved below; unresolvable values are dropped rather than
           written as a dangling parent. */
        __declaredSource: String(
          source.parentStateId || source.derivesFrom || source.parentState || source.derivedFrom || "",
        ).trim(),
      };
    });
  if (!states.length) {
    warnings.push(
      `${kind} ${id} had no continuity states; CineBraid added a structural default state.`,
    );
    return [
      {
        id: "state-default",
        name: "Default",
        appliesTo: "",
        approvedFile: "",
        notes:
          "[INFERRED FOR PLANNING] CineBraid added the required baseline continuity state during import.",
        isDefault: true,
      },
    ];
  }
  const defaults = states
    .map((state, index) => (state.isDefault ? index : -1))
    .filter((index) => index >= 0);
  if (!defaults.length) {
    states[0].isDefault = true;
    states[0].notes = addBuilderMarker(
      states[0].notes,
      "[INFERRED FOR PLANNING]",
      "CineBraid selected this as the default continuity state during import.",
    );
    warnings.push(
      `${kind} ${id} had no default continuity state; CineBraid selected the first state.`,
    );
  } else if (defaults.length > 1) {
    const keep = defaults[0];
    states.forEach((state, index) => {
      state.isDefault = index === keep;
    });
    states[keep].notes = addBuilderMarker(
      states[keep].notes,
      "[INFERRED FOR PLANNING]",
      "CineBraid kept this as the only default continuity state during import.",
    );
    warnings.push(
      `${kind} ${id} had multiple default continuity states; CineBraid kept the first one.`,
    );
  }
  return resolveBuilderStateLineage(states, kind, id, warnings);
}

/* SOURCE LINEAGE, SETTLED AT IMPORT — WHERE IT IS STILL CHEAP TO ANSWER.
 *
 * A derived continuity state that records no source cannot be generated
 * ("Heavy soot has no valid parent state") and cannot be validated against its
 * parent. That used to be discovered only when the filmmaker pressed START on a
 * run, with nothing on that screen able to fix it. It is discovered here now.
 *
 * THREE RULES, AND NONE OF THEM GUESSES:
 *   - An EXPLICIT source is preserved. It may be written as an id or as the exact
 *     name of exactly one state; anything else does not resolve.
 *   - An UNRESOLVABLE source is dropped and named in a warning. Writing it through
 *     would make the whole collection invalid (`parent-missing`) and block adding
 *     any state at all.
 *   - A MISSING source is left missing and named in a warning. CineBraid does not
 *     pick one — that is the human decision the state card and the run preflight
 *     now offer. The old normaliser that filled it in with the default state is
 *     exactly what 1D-06 removed.
 * The default state is the root and never carries one. */
function resolveBuilderStateLineage(states, kind, id, warnings) {
  const byId = new Map(states.filter((state) => state.id).map((state) => [state.id, state]));
  const byName = new Map();
  for (const state of states) {
    const name = String(state.name || "").trim().toLowerCase();
    if (!name) continue;
    byName.set(name, byName.has(name) ? null : state); /* null marks an ambiguous name */
  }
  const missing = [];
  for (const state of states) {
    const declared = state.__declaredSource;
    delete state.__declaredSource;
    if (state.isDefault) {
      state.parentStateId = "";
      continue;
    }
    if (!declared) {
      state.parentStateId = "";
      missing.push(state.name || state.id || "(unnamed state)");
      continue;
    }
    const named = byName.get(declared.toLowerCase());
    const resolved = byId.get(declared) || named || null;
    if (!resolved || resolved === state) {
      state.parentStateId = "";
      missing.push(state.name || state.id || "(unnamed state)");
      warnings.push(
        `${kind} ${id} state "${state.name || state.id}" says it derives from "${declared}", which is not a state on this reference. CineBraid did not choose a replacement.`,
      );
      continue;
    }
    state.parentStateId = resolved.id;
  }
  if (missing.length) {
    warnings.push(
      `${kind} ${id} has ${missing.length} continuity state${missing.length === 1 ? "" : "s"} that do not record what they derive from (${missing.join(", ")}). Choose a source state for each before generating them; CineBraid will not choose one for you.`,
    );
  }
  return states;
}

function builderCoverageAlias(kind, slot) {
  const label = String(slot?.label || slot?.name || slot?.id || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!label) return "";
  if (kind === "character") {
    if (/\b(front|frontal)\b/.test(label) && !/(three|3) quarter|rear|behind|back/.test(label)) return "front";
    if (/(three|3) quarter/.test(label) && !/rear|behind|back/.test(label)) return "front-three-quarter";
    if (/profile|side view|left side|right side/.test(label)) return "profile";
    if (/\b(rear|back)\b/.test(label) && !/(three|3) quarter/.test(label)) return "rear";
    if (/face|head|portrait|close up|closeup/.test(label)) return "detail-face";
    if (/expression|emotion/.test(label)) return "expression";
  }
  if (kind === "prop") {
    if (/front|hero/.test(label) && !/(three|3) quarter/.test(label)) return "hero";
    if (/(three|3) quarter/.test(label)) return "three-quarter";
    if (/profile|side/.test(label)) return "side";
    if (/rear|back/.test(label)) return "rear";
    if (/top|overhead/.test(label)) return "top";
    if (/detail|close up|closeup|function|hands?/.test(label)) return "detail";
  }
  if (kind === "vehicle") {
    if (/front/.test(label) && /(three|3) quarter/.test(label)) return "front-three-quarter";
    if (/rear|back/.test(label) && /(three|3) quarter/.test(label)) return "rear-three-quarter";
    if (/front/.test(label)) return "front";
    if (/rear|back/.test(label)) return "rear";
    if (/left/.test(label)) return "left-side";
    if (/right/.test(label)) return "right-side";
    if (/interior|cockpit|cabin/.test(label)) return "interior";
    if (/detail|close up|closeup/.test(label)) return "detail";
  }
  if (kind === "location") {
    if (/master|establish/.test(label)) return "establishing";
    if (/reverse/.test(label)) return "reverse";
    if (/left/.test(label)) return "left-coverage";
    if (/right/.test(label)) return "right-coverage";
    if (/action|hero zone|key zone/.test(label)) return "action-zone";
    if (/entrance|exit|door/.test(label)) return "entrance-exit";
    if (/detail/.test(label)) return "detail-zone";
    if (/overhead|top|layout|floor plan/.test(label)) return "overhead";
  }
  return "";
}

/* An imported slot, with its requirement collapsed to the one canonical field.
   Import is a legacy input path, so every encoding a kit might carry is READ —
   the enum, the continuity-state spelling, the boolean — and exactly one is
   WRITTEN. The boolean is dropped rather than mirrored: keeping it would hand
   the imported project the same two-encodings problem the import was fixing. */
function builderCoverageRequirement(slot) {
  const record = builderObject(slot);
  const declared = Coverage.requirementTrace(record).requirement;
  const { required, referenceRequirement, ...rest } = record;
  return { ...rest, requirement: declared };
}

function normalizeBuilderCoverage(source, kind) {
  const defaultSlots = {
    character: [["front","Front",true],["front-three-quarter","3/4 front",true],["profile","Profile",true],["rear","Rear",true],["detail-face","Face / detail",false],["expression","Expression / optional detail",false]],
    location: [["establishing","Master establishing",true],["reverse","Reverse angle",true],["left-coverage","Left-facing coverage",false],["right-coverage","Right-facing coverage",false],["action-zone","Key action zone",true],["entrance-exit","Entrance / exit",false],["detail-zone","Detail zone",false],["overhead","Overhead / layout",false]],
    prop: [["hero","Front / hero",true],["three-quarter","3/4 view",true],["side","Side",true],["rear","Rear",false],["top","Top",false],["detail","Detail / function close-up",true]],
    vehicle: [["front","Front",true],["rear","Rear",true],["left-side","Left side",true],["right-side","Right side",true],["front-three-quarter","Front 3/4",true],["rear-three-quarter","Rear 3/4",false],["interior","Interior / cockpit",false],["detail","Detail",false]],
  }[kind] || [];
  /* THE IMPORTER USED TO MANUFACTURE THE DISAGREEMENT. `required: slot?.required
     !== false` was applied unconditionally, so a kit that supplied
     `requirement: "not-required"` and no boolean came out of import carrying
     `required: true` beside it — a contradiction the kit never wrote, created by
     the reader of the kit. The supplied encodings are now interpreted once,
     through the shared contract, and re-expressed as the single enum. */
  const supplied = builderArray(source.coverageSlots).map((slot) => ({
    ...builderCoverageRequirement(slot),
    id: String(slot?.id || "").trim(),
    label: String(slot?.label || slot?.name || "").trim(),
    /* S6 — a slot holds a SELECTED supporting file. The imported key may be the
       legacy `approvedFile`; what this build writes is `selectedFile`, and the
       status it derives is "selected", never "approved". */
    selectedFile: String(slot?.selectedFile || slot?.approvedFile || ""),
    notes: String(slot?.notes || slot?.characteristics || ""),
    status: String(slot?.status === "approved" ? "selected" : slot?.status || ((slot?.selectedFile || slot?.approvedFile) ? "selected" : "missing")),
  })).filter((slot) => slot.id || slot.label);
  const defaultIds = new Set(defaultSlots.map(([id]) => id));
  const slots = [];
  for (const suppliedSlot of supplied) {
    const alias = defaultIds.has(suppliedSlot.id) ? suppliedSlot.id : builderCoverageAlias(kind, suppliedSlot);
    if (alias) {
      const existing = slots.find((slot) => slot.id === alias);
      const defaultLabel = defaultSlots.find(([id]) => id === alias)?.[1] || suppliedSlot.label || alias;
      const detail = String(suppliedSlot.notes || suppliedSlot.label || "").trim();
      if (existing) {
        if (!existing.selectedFile && suppliedSlot.selectedFile) existing.selectedFile = suppliedSlot.selectedFile;
        if (detail && detail.toLowerCase() !== String(defaultLabel).toLowerCase() && !String(existing.notes || "").includes(detail)) {
          existing.notes = [existing.notes, `Imported view detail: ${detail}`].filter(Boolean).join("\n");
        }
        /* SELECTED, never approved. Deriving "approved" from file presence is
           how a supporting reference acquired an approval nobody made. */
        existing.status = existing.selectedFile ? "selected" : "missing";
        continue;
      }
      slots.push({ ...suppliedSlot, id: alias, label: defaultLabel, notes: detail && detail.toLowerCase() !== String(defaultLabel).toLowerCase() ? `Imported view detail: ${detail}` : suppliedSlot.notes });
      continue;
    }
    slots.push(suppliedSlot);
  }
  for (const [id,label,required] of defaultSlots) {
    const existing = slots.find((slot) => slot.id === id);
    if (existing) {
      existing.label = existing.label || label;
      /* builderCoverageRequirement() already gave every supplied slot exactly one
         requirement, so there is nothing left to fill in here. The line that used
         to sit here filled in the template's boolean and could contradict the
         enum the kit supplied. */
    } else slots.push({ id, label, requirement: Coverage.templateRequirement(required), selectedFile: "", notes: "", status: "missing" });
  }
  return slots;
}

function normalizeBuilderEntity(entity, kind, index, warnings) {
  const source = builderObject(entity),
    id = String(source.id || "").trim(),
    normalized = {
      ...source,
      id,
      name: String(source.name || "").trim(),
      notes: String(source.notes || ""),
      visualDescription: String(source.visualDescription || ""),
      prefix: String(source.prefix || id),
      status: String(source.status || "NOT STARTED"),
      workflowStatus: String(source.workflowStatus || "DRAFT"),
      approvedFile: String(source.approvedFile || ""),
      promptPackages: builderArray(source.promptPackages),
      assetPromptBuilds: builderArray(source.assetPromptBuilds),
      coverageDescription: String(source.coverageDescription || source.visualDescription || ""),
      coverageCharacteristics: String(source.coverageCharacteristics || source.identityAnchors || source.doNotChange || ""),
      coverageGenerationNotes: String(source.coverageGenerationNotes || source.coverageNotes || ""),
      coverageSlots: normalizeBuilderCoverage(source, kind),
      expressionSlots: kind === "character" ? builderArray(source.expressionSlots).map((slot, index) => ({
        ...builderCoverageRequirement(slot),
        id: String(slot?.id || `expression-${index + 1}`),
        label: String(slot?.label || slot?.name || `Expression ${index + 1}`),
        selectedFile: String(slot?.selectedFile || slot?.approvedFile || ""),
        notes: String(slot?.notes || slot?.performance || ""),
        status: String(slot?.status === "approved" ? "selected" : slot?.status || ((slot?.selectedFile || slot?.approvedFile) ? "selected" : "missing")),
      })) : builderArray(source.expressionSlots),
    };
  if (kind === "character") {
    normalized.role = String(source.role || "");
    normalized.block = String(source.block || "");
    normalized.driftNotes = String(source.driftNotes || "");
    normalized.expressions = String(source.expressions || "");
    normalized.anchorPrefix = String(source.anchorPrefix || id);
  }
  normalized.continuityStates = normalizeBuilderContinuityStates(
    normalized,
    kind,
    warnings,
  );
  return normalized;
}

function normalizeBuilderScene(scene, index, warnings) {
  const source = builderObject(scene),
    tier = ["A", "B"].includes(String(source.tier || "").toUpperCase())
      ? String(source.tier).toUpperCase()
      : "B";
  let notes = String(source.notes || "");
  if (!source.tier) {
    notes = addBuilderMarker(
      notes,
      "[INFERRED FOR PLANNING]",
      "CineBraid assigned supporting tier B during import.",
    );
    warnings.push(
      `Scene ${source.id || index + 1} had no tier; CineBraid assigned tier B.`,
    );
  }
  return {
    ...source,
    id: String(source.id || "").trim(),
    title: String(source.title || "").trim(),
    tier,
    stage: source.stage ?? "",
    characters: builderArray(source.characters).map(String),
    whatHappens: String(source.whatHappens || ""),
    howItFeels: String(source.howItFeels || ""),
    notes,
    audio: builderObject(source.audio),
  };
}

function normalizeBuilderKeyframes(shot, warnings) {
  const shotId = String(shot.id || "SHOT"),
    supplied = builderArray(shot.keyframes);
  if (!supplied.length) {
    warnings.push(
      `Shot ${shotId} had no keyframes; CineBraid created an opening planning frame from the shot description.`,
    );
    return [
      {
        id: `${shotId}-A`,
        label: "A",
        title: "Opening frame",
        winner: null,
        description: [shot.desc, shot.positioning].filter(Boolean).join(" — "),
        notes:
          "[INFERRED FOR PLANNING] CineBraid created the required opening frame during import; review its composition before generation.",
        required: true,
        generationPackages: [],
      },
    ];
  }
  return supplied.map((frame, index) => {
    const source = builderObject(frame),
      label = String(source.label || builderLabel(index)),
      id = String(source.id || `${shotId}-${label}`).trim();
    if (!source.id)
      warnings.push(
        `Shot ${shotId} keyframe ${label} had no id; CineBraid assigned ${id}.`,
      );
    return {
      ...source,
      id,
      label,
      title: String(source.title || (index ? `Frame ${label}` : "Opening frame")),
      winner: source.winner ?? null,
      description: String(source.description || ""),
      notes: String(source.notes || ""),
      required: source.required !== false,
      generationPackages: builderArray(source.generationPackages),
    };
  });
}


function normalizeBuilderMotionBrief(source, shotAudio = {}, duration = 0) {
  const raw = builderObject(source.motionBrief || source.motionAudioBrief);
  const performance = builderObject(raw.performance);
  const camera = builderObject(raw.camera);
  const dialogue = builderObject(raw.dialogue);
  const sound = builderObject(raw.sound);
  const output = builderObject(raw.output);
  const line = String(dialogue.line ?? source.line ?? shotAudio.line ?? "");
  const speakerId = String(dialogue.speakerId ?? source.speakerId ?? shotAudio.speakerId ?? "");
  const rawSfx = sound.sfxEvents ?? source.sfxEvents ?? source.sfx ?? shotAudio.sfx ?? [];
  const sfxEvents = Array.isArray(rawSfx)
    ? rawSfx.map((event) => typeof event === "string"
      ? { timing: "", event, source: "", intensity: "restrained", distance: "near", diegetic: true }
      : {
          timing: String(event?.timing || ""),
          event: String(event?.event || event?.sound || event?.description || ""),
          source: String(event?.source || ""),
          intensity: String(event?.intensity || "restrained"),
          distance: String(event?.distance || "near"),
          diegetic: event?.diegetic !== false,
        })
    : String(rawSfx || "").trim()
      ? [{ timing: "", event: String(rawSfx), source: "", intensity: "restrained", distance: "near", diegetic: true }]
      : [];
  return {
    schemaVersion: 1,
    performance: {
      action: String(performance.action ?? source.motionPrompt ?? source.note ?? ""),
      emotion: String(performance.emotion ?? source.emotion ?? shotAudio.emotion ?? ""),
      delivery: String(performance.delivery ?? source.delivery ?? shotAudio.delivery ?? ""),
      facial: String(performance.facial || ""),
      gaze: String(performance.gaze || ""),
      bodyLanguage: String(performance.bodyLanguage || ""),
      objectInteraction: String(performance.objectInteraction || ""),
      secondaryMotion: String(performance.secondaryMotion || ""),
      endingState: String(performance.endingState || ""),
      staticConstraints: String(performance.staticConstraints || ""),
      prohibitedMotion: String(performance.prohibitedMotion || ""),
    },
    camera: {
      movement: String(camera.movement || ""),
      timing: String(camera.timing || ""),
      framing: String(camera.framing || ""),
      lensBehavior: String(camera.lensBehavior || ""),
    },
    dialogue: {
      line,
      speakerId,
      speakerName: String(dialogue.speakerName || ""),
      language: String(dialogue.language ?? source.language ?? shotAudio.language ?? "English"),
      emotion: String(dialogue.emotion ?? source.emotion ?? shotAudio.emotion ?? ""),
      delivery: String(dialogue.delivery ?? source.delivery ?? shotAudio.delivery ?? ""),
      pace: String(dialogue.pace ?? source.pace ?? shotAudio.pace ?? "natural"),
      volume: String(dialogue.volume ?? source.volume ?? shotAudio.volume ?? "normal"),
      startTime: String(dialogue.startTime || ""),
      endTime: String(dialogue.endTime || ""),
      locked: dialogue.locked !== false,
      /* The second, independently written copy of the same bad rule, on the path that
         WRITES DURABLE PROJECT DATA. An imported shot with any line came back with
         lipSyncRequired true, which is why a stored `true` cannot be trusted as a
         filmmaker's decision and why nothing stored is converted: the level is derived
         on read, and the boolean now follows it instead of leading it.

         A level the document actually declared is carried through untouched; one it did
         not is left empty rather than filled in with a derived answer, so importing a
         project never manufactures an authority the source never claimed. */
      lipSync: String(dialogue.lipSync || ""),
      lipSyncRequired: lipSyncRequiredFrom({ ...dialogue, line }),
      voiceDesign: String(dialogue.voiceDesign || ""),
    },
    sound: {
      sfxEvents,
      ambience: String(sound.ambience ?? source.ambience ?? shotAudio.ambience ?? ""),
      music: String(sound.music ?? source.music ?? shotAudio.music ?? ""),
      silence: String(sound.silence || ""),
      priorities: String(sound.priorities || ""),
    },
    output: {
      resolution: String(output.resolution || "model-default"),
      nativeAudio: output.nativeAudio !== false,
    },
    additionalDirection: String(raw.additionalDirection || ""),
    durationSeconds: builderNumber(raw.durationSeconds || duration),
  };
}

function normalizeBuilderClips(shot, frames, warnings) {
  const shotId = String(shot.id || "SHOT"),
    /* The import path's own copy of the clip vocabulary, and the one that decides what
       a Project Builder document is allowed to say. Without `t2v` an imported
       text-to-video unit was downgraded to `plan` — a planning-only unit that cannot
       generate at all — and told the filmmaker its kind was unknown. */
    allowedKinds = new Set(["t2v", "i2v", "flf", "r2v", "plan", "post", "reuse", "hold"]),
    /* The kinds that begin from no frame. `plan`, `post` and `reuse` produce nothing
       from a still; `t2v` produces video from the prompt alone. Linking a start frame
       to any of them states a dependency the workflow does not have. */
    framelessKinds = ["t2v", "plan", "post", "reuse"],
    firstFrame = frames[0]?.id || "",
    lastFrame = frames.at(-1)?.id || "";
  return builderArray(shot.clips).map((clip, index) => {
    const source = builderObject(clip),
      label = String(source.label || builderLabel(index)),
      id = String(source.id || `${shotId}-M${String(index + 1).padStart(2, "0")}`).trim();
    let kind = String(source.kind || "i2v").toLowerCase(),
      fromFrame = String(source.fromFrame || ""),
      toFrame = String(source.toFrame || "");
    if (!source.id)
      warnings.push(
        `Shot ${shotId} motion unit ${label} had no id; CineBraid assigned ${id}.`,
      );
    if (!allowedKinds.has(kind)) {
      warnings.push(
        `Shot ${shotId} motion unit ${id} used unknown kind ${kind || "(blank)"}; CineBraid changed it to planning-only.`,
      );
      kind = "plan";
    }
    if (!fromFrame && !framelessKinds.includes(kind) && firstFrame) {
      fromFrame = firstFrame;
      warnings.push(
        `Shot ${shotId} motion unit ${id} had no starting frame; CineBraid linked ${firstFrame}.`,
      );
    }
    if (kind === "flf" && !toFrame && frames.length > 1) {
      toFrame = lastFrame;
      warnings.push(
        `Shot ${shotId} FLF unit ${id} had no ending frame; CineBraid linked ${lastFrame}.`,
      );
    }
    return {
      ...source,
      id,
      suffix: String(source.suffix || label.toLowerCase()),
      label,
      title: String(source.title || `Motion ${label}`),
      dur: builderNumber(source.dur),
      kind,
      motionPrompt: String(source.motionPrompt || source.note || ""),
      note: String(source.note || source.motionPrompt || ""),
      line: String(source.line || ""),
      speakerId: String(source.speakerId || ""),
      audioNote: String(source.audioNote || source.vo || ""),
      voiceEntityId: String(source.voiceEntityId || ""),
      vo: String(source.vo || ""),
      sfx: Array.isArray(source.sfx) ? source.sfx.map((item) => typeof item === "string" ? item : item?.event || item?.sound || "").filter(Boolean).join("; ") : String(source.sfx || ""),
      ambience: String(source.ambience || ""),
      music: String(source.music || ""),
      emotion: String(source.emotion || ""),
      delivery: String(source.delivery || ""),
      language: String(source.language || ""),
      pace: String(source.pace || ""),
      volume: String(source.volume || ""),
      motionBrief: normalizeBuilderMotionBrief(source, builderObject(shot.audio), builderNumber(source.dur)),
      fromFrame,
      toFrame,
      generationPackages: builderArray(source.generationPackages),
    };
  });
}

function normalizeBuilderShot(shot, index, warnings) {
  const source = builderObject(shot),
    normalized = {
      ...source,
      id: String(source.id || "").trim(),
      scene: String(source.scene || "").trim(),
      title: String(source.title || "").trim(),
      desc: String(source.desc || ""),
      route: String(source.route || "GENERATE").toUpperCase(),
      codes: builderArray(source.codes).map(String),
      characters: builderArray(source.characters).map(String),
      positioning: String(source.positioning || ""),
      risks: builderArray(source.risks).map(String),
      safe: String(source.safe || ""),
      status: String(source.status || "UNBUILT"),
      workflowStatus: String(source.workflowStatus || "DRAFT"),
      notes: String(source.notes || ""),
      winner: source.winner ?? null,
      motionPrompt: String(source.motionPrompt || ""),
      dur: builderNumber(source.dur),
      audio: (() => {
        const audio = builderObject(source.audio);
        return {
          ...audio,
          line: String(audio.line || ""),
          speakerId: String(audio.speakerId || ""),
          note: String(audio.note || audio.vo || ""),
          voiceEntityId: String(audio.voiceEntityId || ""),
          vo: String(audio.vo || ""),
          sfx: Array.isArray(audio.sfx) ? audio.sfx.map((item) => typeof item === "string" ? item : item?.event || item?.sound || "").filter(Boolean).join("; ") : String(audio.sfx || ""),
          ambience: String(audio.ambience || ""),
          music: String(audio.music || ""),
          emotion: String(audio.emotion || ""),
          delivery: String(audio.delivery || ""),
          language: String(audio.language || ""),
          pace: String(audio.pace || ""),
          volume: String(audio.volume || ""),
          sync: String(audio.sync || ""),
        };
      })(),
      continuityStateSelections: builderObject(source.continuityStateSelections),
      candidateFiles: builderArray(source.candidateFiles),
      stageApprovals: builderObject(source.stageApprovals),
      generationPackages: builderArray(source.generationPackages),
      promptBuilds: builderArray(source.promptBuilds),
      imagePromptPackages: builderArray(source.imagePromptPackages),
      referenceInstructions: builderObject(source.referenceInstructions),
      referenceRoles: builderObject(source.referenceRoles),
      referenceSelection: builderObject(source.referenceSelection),
    };
  normalized.keyframes = normalizeBuilderKeyframes(normalized, warnings);
  normalized.clips = normalizeBuilderClips(
    { ...normalized, clips: source.clips },
    normalized.keyframes,
    warnings,
  );
  if (!normalized.dur && normalized.clips.length) {
    const planned = normalized.clips.reduce(
      (total, clip) => total + builderNumber(clip.dur),
      0,
    );
    if (planned > 0) {
      normalized.dur = planned;
      normalized.notes = addBuilderMarker(
        normalized.notes,
        "[INFERRED FOR PLANNING]",
        "CineBraid set shot duration from the imported motion-unit durations.",
      );
      warnings.push(
        `Shot ${normalized.id || index + 1} had no duration; CineBraid used the ${planned}-second motion total.`,
      );
    }
  }
  return normalized;
}

function normalizeImportedProject(raw) {
  const warnings = [],
    source = JSON.parse(JSON.stringify(raw)),
    blank = BLANK(),
    project = {
      ...blank,
      ...source,
      meta: {
        ...blank.meta,
        ...builderObject(source.meta),
        world: {
          ...blank.meta.world,
          ...builderObject(source.meta?.world),
        },
        promptDefaults: {
          ...blank.meta.promptDefaults,
          ...builderObject(source.meta?.promptDefaults),
        },
        hubVersion: "v6.0.0",
      },
    };
  const suppliedChecks = builderArray(source.qcChecklist)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (suppliedChecks.length === 5) project.qcChecklist = suppliedChecks;
  else {
    const combined = [...suppliedChecks, ...blank.qcChecklist].filter(
      (item, index, list) => item && list.indexOf(item) === index,
    );
    project.qcChecklist = combined.slice(0, 5);
    warnings.push(
      `qcChecklist contained ${suppliedChecks.length} usable items; CineBraid completed it to exactly five review checks.`,
    );
  }
  project.characters = builderArray(source.characters).map((item, index) =>
    normalizeBuilderEntity(item, "character", index, warnings),
  );
  project.locations = builderArray(source.locations).map((item, index) =>
    normalizeBuilderEntity(item, "location", index, warnings),
  );
  project.props = builderArray(source.props).map((item, index) =>
    normalizeBuilderEntity(item, "prop", index, warnings),
  );
  project.vehicles = builderArray(source.vehicles).map((item, index) =>
    normalizeBuilderEntity(item, "vehicle", index, warnings),
  );
  project.scenes = builderArray(source.scenes).map((item, index) =>
    normalizeBuilderScene(item, index, warnings),
  );
  project.shots = builderArray(source.shots).map((item, index) =>
    normalizeBuilderShot(item, index, warnings),
  );
  project.audio = builderArray(source.audio).map((item, index) => {
    const audio = builderObject(item);
    return {
      ...audio,
      id: String(audio.id || `AUDIO-${String(index + 1).padStart(2, "0")}`).trim(),
      name: String(audio.name || audio.id || `Audio ${index + 1}`).trim(),
      description: String(audio.description || ""),
      notes: String(audio.notes || ""),
      role: String(audio.role || ""),
      sameObjectAs: String(audio.sameObjectAs || ""),
      cleanMaster: audio.cleanMaster === true,
      approvedFile: String(audio.approvedFile || ""),
      status: String(audio.status || "NOT STARTED"),
    };
  });
  for (const key of [
    "mediaAssets",
    "finishJobs",
    "jobs",
    "decisions",
    "sessions",
    "agentRuns",
  ])
    project[key] = builderArray(source[key]);
  return { project, warnings };
}

function validateImportedProject(raw) {
  const errors = [],
    warnings = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return {
      errors: ["Project Builder output must be one JSON object."],
      warnings,
    };
  if (!raw.meta || !String(raw.meta.title || "").trim())
    errors.push("Project JSON needs meta.title.");
  if (!Array.isArray(raw.qcChecklist) || raw.qcChecklist.length !== 5)
    errors.push("qcChecklist must contain exactly five items after normalization.");

  const arrayKeys = [
    "characters",
    "locations",
    "props",
    "vehicles",
    "scenes",
    "shots",
    "audio",
    "mediaAssets",
    "finishJobs",
    "jobs",
    "decisions",
    "sessions",
    "agentRuns",
  ];
  for (const key of arrayKeys)
    if (!Array.isArray(raw[key])) errors.push(`${key} must be an array.`);

  const idPattern = /^[A-Z0-9_-]+$/;
  const entityById = new Map();
  function uniqueRecords(list, label) {
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
      const id = String(item?.id || "");
      if (!id) errors.push(`${label} record is missing an id.`);
      else if (!idPattern.test(id))
        errors.push(
          `${label} id ${id} must use uppercase letters, numbers, _ or - only.`,
        );
      else if (seen.has(id)) errors.push(`Duplicate ${label} id: ${id}.`);
      seen.add(id);
    }
    return seen;
  }
  const characterIds = uniqueRecords(raw.characters, "character"),
    locationIds = uniqueRecords(raw.locations, "location"),
    propIds = uniqueRecords(raw.props, "prop"),
    vehicleIds = uniqueRecords(raw.vehicles, "vehicle"),
    sceneIds = uniqueRecords(raw.scenes, "scene");
  uniqueRecords(raw.shots, "shot");

  for (const [kind, list] of [
    ["character", raw.characters],
    ["location", raw.locations],
    ["prop", raw.props],
    ["vehicle", raw.vehicles],
  ]) {
    for (const entity of Array.isArray(list) ? list : []) {
      entityById.set(entity.id, entity);
      if (!String(entity.name || "").trim())
        errors.push(`${kind} ${entity.id || "(missing id)"} needs a name.`);
      const states = Array.isArray(entity.continuityStates)
        ? entity.continuityStates
        : [];
      if (!states.length)
        errors.push(
          `${kind} ${entity.id || "(missing id)"} needs a default continuity state.`,
        );
      const defaults = states.filter((state) => state?.isDefault === true);
      if (defaults.length !== 1)
        errors.push(
          `${kind} ${entity.id || "(missing id)"} must have exactly one default continuity state.`,
        );
      const stateIds = new Set();
      for (const state of states) {
        const stateId = String(state?.id || "");
        if (!stateId)
          errors.push(`${kind} ${entity.id} has a continuity state without an id.`);
        else if (stateIds.has(stateId))
          errors.push(
            `${kind} ${entity.id} has duplicate continuity state id ${stateId}.`,
          );
        stateIds.add(stateId);
      }
      if (entity.approvedFile || states.some((state) => state?.approvedFile))
        warnings.push(
          `${kind} ${entity.id} carries reference filenames; they will be cleared because files are not part of Project Builder JSON.`,
        );
    }
  }

  for (const scene of Array.isArray(raw.scenes) ? raw.scenes : []) {
    if (!String(scene.title || "").trim())
      errors.push(`Scene ${scene.id || "(missing id)"} needs a title.`);
    for (const id of Array.isArray(scene.characters) ? scene.characters : [])
      if (!characterIds.has(id))
        errors.push(`Scene ${scene.id} references unknown character ${id}.`);
  }

  for (const shot of Array.isArray(raw.shots) ? raw.shots : []) {
    if (!String(shot.title || "").trim())
      errors.push(`Shot ${shot.id || "(missing id)"} needs a title.`);
    if (!sceneIds.has(shot.scene))
      errors.push(
        `Shot ${shot.id || "(missing id)"} references unknown scene ${shot.scene || "(blank)"}.`,
      );
    for (const id of Array.isArray(shot.characters) ? shot.characters : [])
      if (!characterIds.has(id))
        errors.push(`Shot ${shot.id} references unknown character ${id}.`);
    for (const id of Array.isArray(shot.codes) ? shot.codes : [])
      if (![...(raw.locations || []), ...(raw.props || []), ...(raw.vehicles || []), ...(raw.audio || [])].some((entity) => shotEntityTokenMatches(id, entity?.id)))
        errors.push(
          `Shot ${shot.id} references unknown location/prop/vehicle/audio code ${id}.`,
        );

    const frames = Array.isArray(shot.keyframes) ? shot.keyframes : [];
    if (!frames.length) errors.push(`Shot ${shot.id} needs at least one keyframe.`);
    const frameIds = new Set();
    for (const frame of frames) {
      const frameId = String(frame?.id || "");
      if (!frameId) errors.push(`Shot ${shot.id} has a keyframe without an id.`);
      else if (frameIds.has(frameId))
        errors.push(`Shot ${shot.id} has duplicate keyframe id ${frameId}.`);
      frameIds.add(frameId);
      if (frame?.winner || (frame?.generationPackages || []).length)
        warnings.push(
          `Shot ${shot.id} included generated keyframe state; winners and generation packages will be cleared.`,
        );
    }
    const clipIds = new Set();
    for (const clip of Array.isArray(shot.clips) ? shot.clips : []) {
      const clipId = String(clip?.id || "");
      if (!clipId)
        errors.push(`Shot ${shot.id} has a motion unit without an id.`);
      else if (clipIds.has(clipId))
        errors.push(`Shot ${shot.id} has duplicate motion unit id ${clipId}.`);
      clipIds.add(clipId);
      if (clip.fromFrame && !frameIds.has(clip.fromFrame))
        errors.push(
          `Shot ${shot.id} motion unit ${clipId} references unknown fromFrame ${clip.fromFrame}.`,
        );
      if (clip.toFrame && !frameIds.has(clip.toFrame))
        errors.push(
          `Shot ${shot.id} motion unit ${clipId} references unknown toFrame ${clip.toFrame}.`,
        );
      if (clip.kind === "flf" && (!clip.fromFrame || !clip.toFrame))
        errors.push(
          `Shot ${shot.id} FLF motion unit ${clipId} needs both fromFrame and toFrame.`,
        );
      if (clip.kind === "r2v" && (clip.dur < 4 || clip.dur > 15))
        warnings.push(
          `Shot ${shot.id} reference-led motion unit ${clipId} is ${clip.dur || 0}s; Seedance Omni packages support 4–15s, so split or retime this unit before motion generation.`,
        );
    }
    const selections =
      shot.continuityStateSelections &&
      typeof shot.continuityStateSelections === "object"
        ? shot.continuityStateSelections
        : {};
    for (const [entityId, stateId] of Object.entries(selections)) {
      const entity = entityById.get(entityId);
      if (!entity)
        errors.push(
          `Shot ${shot.id} selects continuity for unknown entity ${entityId}.`,
        );
      else if (
        !(entity.continuityStates || []).some((state) => state.id === stateId)
      )
        errors.push(
          `Shot ${shot.id} selects unknown state ${stateId} for ${entityId}.`,
        );
    }
    if (
      shot.winner ||
      (shot.candidateFiles || []).length ||
      (shot.generationPackages || []).length ||
      (shot.promptBuilds || []).length ||
      (shot.imagePromptPackages || []).length
    )
      warnings.push(
        `Shot ${shot.id} included generated or approved output state; it will be cleared during import.`,
      );
  }
  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

function clearUnsupportedBuilderClaims(project, warnings) {
  /* BATCH 1B — AN IMPORTED AUTHORITY LEDGER IS NOT THIS PROJECT'S HISTORY.

     This function already strips every approved edge an import claims, because
     CineBraid cannot verify media it did not produce. The durable authority
     receipts are records ABOUT those edges, so they go the same way: keeping
     them would let an imported document assert that a person here approved
     something, which is the one claim the whole batch exists to make
     unforgeable-by-accident.

     Dropping them is also safe in the other direction — a receipt with no edge
     behind it satisfies nothing, so this is belt as well as braces. */
  if (project[ProductionAuthority.PRODUCTION_AUTHORITY_LEDGER_KEY]) {
    const imported = ProductionAuthority.authorityReceipts(project).length;
    delete project[ProductionAuthority.PRODUCTION_AUTHORITY_LEDGER_KEY];
    if (imported) warnings.push(`The import carried ${imported} production-approval record${imported === 1 ? "" : "s"}. CineBraid cannot verify approvals made elsewhere, so they were not adopted; approve here to establish authority.`);
  }
  for (const list of ["characters", "locations", "props", "vehicles"])
    for (const entity of project[list] || []) {
      entity.approvedFile = "";
      entity.promptPackages = [];
      entity.assetPromptBuilds = [];
      if (/approved|locked|complete/i.test(String(entity.workflowStatus || "")))
        entity.workflowStatus = "DRAFT";
      for (const state of entity.continuityStates || []) state.approvedFile = "";
    }
  for (const shot of project.shots || []) {
    shot.winner = null;
    shot.candidateFiles = [];
    shot.stageApprovals = {};
    shot.generationPackages = [];
    shot.promptBuilds = [];
    shot.imagePromptPackages = [];
    shot.referenceInstructions = {};
    shot.referenceRoles = {};
    shot.referenceSelection = {};
    if (/approved|locked|complete|built/i.test(String(shot.workflowStatus || "")))
      shot.workflowStatus = "DRAFT";
    for (const frame of shot.keyframes || []) {
      frame.winner = null;
      frame.generationPackages = [];
    }
    for (const clip of shot.clips || []) clip.generationPackages = [];
  }
  for (const key of [
    "mediaAssets",
    "finishJobs",
    "jobs",
    "decisions",
    "sessions",
    "agentRuns",
  ])
    if ((project[key] || []).length) {
      warnings.push(
        `${key} was cleared because Project Builder imports contain planning data, not generated media or runtime history.`,
      );
      project[key] = [];
    }
}

function importedProjectShape(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Project Builder output must be one JSON object.");
  const normalized = normalizeImportedProject(raw),
    validation = validateImportedProject(normalized.project);
  if (validation.errors.length)
    throw new Error(
      `Project Builder validation failed:\n- ${validation.errors.join("\n- ")}`,
    );
  const warnings = [...normalized.warnings, ...validation.warnings];
  clearUnsupportedBuilderClaims(normalized.project, warnings);
  return { project: normalized.project, warnings: [...new Set(warnings)] };
}

function projectBuilderCounts(project) {
  const source = builderObject(project);
  return {
    characters: builderArray(source.characters).length,
    locations: builderArray(source.locations).length,
    props: builderArray(source.props).length,
    vehicles: builderArray(source.vehicles).length,
    scenes: builderArray(source.scenes).length,
    shots: builderArray(source.shots).length,
    keyframes: builderArray(source.shots).reduce(
      (total, shot) => total + builderArray(shot?.keyframes).length,
      0,
    ),
    motionUnits: builderArray(source.shots).reduce(
      (total, shot) => total + builderArray(shot?.clips).length,
      0,
    ),
  };
}

function prepareImportedProjectForPreview(project) {
  const prepared = structuredClone(project);
  prepared.sessions = [
    {
      n: 1,
      date: new Date().toISOString().slice(0, 10),
      summary: "Project imported from CineBraid Project Builder JSON.",
      carryForward: [
        "Review all imported planning assumptions against the original source documents.",
      ],
    },
  ];
  return prepared;
}

function importPreviewHash(project) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(project))
    .digest("hex");
}

function pruneImportPreviews() {
  const cutoff = Date.now() - IMPORT_PREVIEW_TTL_MS;
  for (const [token, preview] of IMPORT_PREVIEWS)
    if (preview.createdAt < cutoff) IMPORT_PREVIEWS.delete(token);
  while (IMPORT_PREVIEWS.size > 24)
    IMPORT_PREVIEWS.delete(IMPORT_PREVIEWS.keys().next().value);
}

function shortReviewValue(value, limit = 360) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function projectBuilderReview(project, warnings = [], sourceCounts = {}) {
  const inferred = [],
    conflicts = [],
    missing = [],
    review = [];
  const walk = (value, pathName) => {
    if (typeof value === "string") {
      if (/\[INFERRED FOR PLANNING\]/i.test(value))
        inferred.push({ path: pathName, value: shortReviewValue(value) });
      if (/\[SOURCE CONFLICT\]/i.test(value))
        conflicts.push({ path: pathName, value: shortReviewValue(value) });
    } else if (Array.isArray(value))
      value.forEach((item, index) => walk(item, `${pathName}[${index}]`));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([key, item]) =>
        walk(item, pathName ? `${pathName}.${key}` : key),
      );
  };
  walk(project, "");
  if (!(project.scenes || []).length) missing.push("Project: no scenes imported");
  if (!(project.shots || []).length) missing.push("Project: no shots imported");
  for (const [kind, list, type] of [
    ["Character", project.characters || [], "character"],
    ["Location", project.locations || [], "location"],
    ["Prop", project.props || [], "prop"],
    ["Vehicle", project.vehicles || [], "vehicle"],
  ])
    for (const item of list) {
      const description = entityVisualDescription(item, type);
      if (!description) missing.push(`${kind} ${item.id}: visual description`);
      if (!(item.continuityStates || []).length)
        missing.push(`${kind} ${item.id}: continuity state`);
    }
  for (const scene of project.scenes || []) {
    if (!String(scene.whatHappens || "").trim())
      missing.push(`Scene ${scene.id}: what happens`);
    if (!String(scene.howItFeels || "").trim())
      review.push(`Scene ${scene.id}: add emotional or tonal intent`);
    if (!(project.shots || []).some((shot) => shot.scene === scene.id))
      review.push(`Scene ${scene.id}: no shots are assigned`);
  }
  for (const shot of project.shots || []) {
    if (!String(shot.desc || "").trim())
      missing.push(`Shot ${shot.id}: action description`);
    if (!String(shot.positioning || "").trim())
      missing.push(`Shot ${shot.id}: framing, placement, and contact guidance`);
    if (!String(shot.safe || "").trim())
      review.push(`Shot ${shot.id}: add a simpler fallback that preserves the beat`);
    for (const frame of shot.keyframes || [])
      if (!String(frame.description || "").trim())
        review.push(`Shot ${shot.id} frame ${frame.label || frame.id}: description needs review`);
    for (const clip of shot.clips || []) {
      if (!["plan", "post", "reuse"].includes(clip.kind) && !String(clip.motionPrompt || "").trim())
        review.push(`Shot ${shot.id} motion unit ${clip.label || clip.id}: motion direction is empty`);
      if (clip.kind === "r2v" && (clip.dur < 4 || clip.dur > 15))
        review.push(
          `Shot ${shot.id} motion unit ${clip.label || clip.id}: reference-led duration must be retimed or split to 4–15 seconds`,
        );
    }
  }
  review.push(
    ...conflicts.map(
      (item) => `Resolve source conflict at ${item.path}: ${item.value}`,
    ),
  );
  const removed = warnings.filter((warning) =>
    /cleared|approval|generated|runtime|filenames|history/i.test(warning),
  );
  const otherWarnings = warnings.filter((warning) => !removed.includes(warning));
  return {
    counts: projectBuilderCounts(project),
    sourceCounts,
    inferred: inferred
      .filter(
        (item, index, list) =>
          list.findIndex(
            (other) => other.path === item.path && other.value === item.value,
          ) === index,
      )
      .slice(0, 100),
    conflicts: conflicts
      .filter(
        (item, index, list) =>
          list.findIndex(
            (other) => other.path === item.path && other.value === item.value,
          ) === index,
      )
      .slice(0, 100),
    missing: [...new Set(missing)].slice(0, 100),
    removed: [...new Set(removed)].slice(0, 100),
    review: [...new Set([...review, ...otherWarnings])].slice(0, 100),
    continuity: [
      ...project.characters.map((entity) => ({ kind: "Character", entity })),
      ...project.locations.map((entity) => ({ kind: "Location", entity })),
      ...project.props.map((entity) => ({ kind: "Prop", entity })),
      ...(project.vehicles || []).map((entity) => ({ kind: "Vehicle", entity })),
    ]
      .flatMap(({ kind, entity }) =>
        (entity.continuityStates || []).map((state) => ({
          kind,
          entityId: entity.id,
          entityName: entity.name,
          stateId: state.id,
          stateName: state.name,
          isDefault: state.isDefault === true,
          notes: shortReviewValue(state.notes),
          inferred: /\[INFERRED FOR PLANNING\]/i.test(state.notes || ""),
        })),
      )
      .filter((state) => state.inferred || state.isDefault)
      .slice(0, 100),
    outline: project.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      tier: scene.tier,
      whatHappens: scene.whatHappens,
      howItFeels: scene.howItFeels,
      shots: project.shots
        .filter((shot) => shot.scene === scene.id)
        .map((shot) => ({
          id: shot.id,
          title: shot.title,
          duration: shot.dur,
          route: shot.route,
          description: shot.desc,
          positioning: shot.positioning,
          characters: shot.characters,
          codes: shot.codes,
          risks: shot.risks,
          safe: shot.safe,
          keyframes: (shot.keyframes || []).map((frame) => ({
            id: frame.id,
            label: frame.label,
            title: frame.title,
            description: frame.description,
            required: frame.required !== false,
          })),
          motionUnits: (shot.clips || []).map((clip) => ({
            id: clip.id,
            label: clip.label,
            title: clip.title,
            kind: clip.kind,
            duration: clip.dur,
            fromFrame: clip.fromFrame,
            toFrame: clip.toFrame,
            motionPrompt: clip.motionPrompt,
            dialogue: clip.motionBrief?.dialogue || null,
            sound: clip.motionBrief?.sound || null,
            performance: clip.motionBrief?.performance || null,
          })),
        })),
    })),
  };
}

app.post("/api/projects/preview-import-json", (req, res) => {
  try {
    pruneImportPreviews();
    const source = req.body?.project,
      imported = importedProjectShape(source),
      project = prepareImportedProjectForPreview(imported.project),
      previewHash = importPreviewHash(project),
      previewToken = crypto.randomBytes(24).toString("base64url"),
      sourceCounts = projectBuilderCounts(source),
      review = projectBuilderReview(project, imported.warnings, sourceCounts);
    IMPORT_PREVIEWS.set(previewToken, {
      createdAt: Date.now(),
      hash: previewHash,
      project,
      warnings: imported.warnings,
      review,
    });
    res.json({
      ok: true,
      title: project.meta.title,
      previewToken,
      previewHash,
      normalizedProject: project,
      review,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/projects/import-json", (req, res) => {
  try {
    pruneImportPreviews();
    const token = String(req.body?.previewToken || ""),
      expectedHash = String(req.body?.previewHash || ""),
      preview = IMPORT_PREVIEWS.get(token);
    if (!preview)
      throw new Error(
        "This import preview is missing or expired. Validate the JSON again before importing.",
      );
    if (!expectedHash || expectedHash !== preview.hash)
      throw new Error("The reviewed import hash does not match this preview.");
    const project = structuredClone(preview.project);
    const title = String(project.meta.title).trim();
    let slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "project";
    let n = 1,
      base = slug;
    while (fs.existsSync(path.join(projectsRoot(), slug))) slug = base + "-" + ++n;
    const dir = path.join(projectsRoot(), slug);
    ensureDirs(dir);
    atomicWriteJson(path.join(dir, "project.json"), project, { backup: false });
    const config = readConfig();
    config.activeProject = slug;
    writeConfig(config);
    IMPORT_PREVIEWS.delete(token);
    res.json({
      ok: true,
      slug,
      previewHash: preview.hash,
      warnings: preview.warnings,
      counts: projectBuilderCounts(project),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/* ---- export: app state → markdown (app is the source of truth) ---- */
app.post("/api/export", (req, res) => {
  try {
    const P = readJsonSync(DATA());
    const md = buildMarkdown(P);
    const name =
      "EXPORT_" +
      (P.meta.title || "project").replace(/\W+/g, "_") +
      "_" +
      new Date().toISOString().slice(0, 10) +
      ".md";
    const configuredOutput = configuredWorkspacePath("outputRoot");
    const dir = configuredOutput
      ? path.join(configuredOutput, activeSlug() || "project")
      : path.join(PROJECT_DIR(), "docs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), md);
    res.json({ ok: true, name, path: path.join(dir, name), external: Boolean(configuredOutput) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/export/packages", async (req, res) => {
  try {
    const P = readProject();
    const ids = [...new Set((req.body?.shotIds || []).map(String))]
      .filter((id) => (P.shots || []).some((s) => s.id === id))
      .slice(0, 200);
    if (!ids.length)
      return res.status(400).json({ error: "Select at least one valid shot." });
    const projectName = String(P.meta?.title || "CineBraid").replace(
      /[^a-z0-9_-]+/gi,
      "_",
    );
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${projectName}_generation_packages.zip"`,
    );
    const archive = new SimpleZipWriter(res);
    const scan = scanProject();
    for (const id of ids) {
      const s = P.shots.find((x) => x.id === id);
      if (!s) continue;
      const base = id.replace(/[^a-z0-9_.-]+/gi, "_");
      const summary = {
        id: s.id,
        scene: s.scene,
        title: s.title,
        description: s.desc || "",
        positioning: s.positioning || "",
        workflowStatus: s.workflowStatus || "",
        keyframes: s.keyframes || [],
        motion: s.clips || [],
        candidateFiles: s.candidateFiles || [],
        continuityStateSelections: s.continuityStateSelections || {},
      };
      await archive.addBuffer(
        `${base}/shot-plan.json`,
        JSON.stringify(summary, null, 2),
      );
      const lines = [
        `# ${s.id} — ${s.title}`,
        "",
        s.desc || "",
        "",
        s.positioning || "",
      ];
      for (const f of s.keyframes || []) {
        lines.push(
          "",
          `## Frame ${f.label} — ${f.title || ""}`,
          f.description || "",
          f.winner ? `Approved file: ${f.winner}` : "Approved file: none",
        );
        const framePackages = resolvePromptBuildList(P, f.generationPackages || []),
          pkg = framePackages.at(-1);
        if (pkg)
          lines.push(
            "",
            `### Current compiled prompt · revision ${pkg.revision || framePackages.length}`,
            pkg.prompt || "",
          );
        for (let pi = 0; pi < framePackages.length; pi++) {
          const revision = framePackages[pi];
          await archive.addBuffer(
            `${base}/packages/frame-${f.label || "frame"}-r${revision.revision || pi + 1}.json`,
            JSON.stringify(revision, null, 2),
          );
        }
        if (f.winner) {
          const file = path.join(
            PROJECT_DIR(),
            "shots",
            s.id,
            "takes",
            path.basename(f.winner),
          );
          if (fs.existsSync(file))
            await archive.addFile(
              `${base}/frames/${f.label}_${path.basename(f.winner)}`,
              file,
            );
        }
      }
      for (const c of s.clips || []) {
        lines.push(
          "",
          `## Motion ${c.label || c.suffix || ""} — ${c.title || ""}`,
          `Method: ${c.kind || "i2v"} · Duration: ${c.dur || 0}s`,
          c.motionPrompt || c.note || "",
        );
        const motionPackages = resolvePromptBuildList(P, c.generationPackages || []),
          pkg = motionPackages.at(-1);
        if (pkg)
          lines.push(
            "",
            `### Current compiled prompt · revision ${pkg.revision || motionPackages.length}`,
            pkg.prompt || "",
          );
        for (let pi = 0; pi < motionPackages.length; pi++) {
          const revision = motionPackages[pi];
          await archive.addBuffer(
            `${base}/packages/motion-${c.label || c.suffix || "unit"}-r${revision.revision || pi + 1}.json`,
            JSON.stringify(revision, null, 2),
          );
        }
        if (c.videoWinner) {
          const file = path.join(
            PROJECT_DIR(),
            "shots",
            s.id,
            "takes",
            path.basename(c.videoWinner),
          );
          if (fs.existsSync(file))
            await archive.addFile(
              `${base}/motion/${c.label || c.suffix}_${path.basename(c.videoWinner)}`,
              file,
            );
        }
      }
      await archive.addBuffer(`${base}/package.txt`, lines.join("\n"));
      const takes = scan.shots?.[s.id]?.takes || [];
      await archive.addBuffer(
        `${base}/candidate-index.json`,
        JSON.stringify(
          {
            candidates: takes.map((x) => x.name),
            reviewRecords: s.candidateFiles || [],
          },
          null,
          2,
        ),
      );
    }
    await archive.finalize();
  } catch (e) {
    console.error("Package export failed:", e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.destroy(e);
  }
});

function buildMarkdown(P) {
  const L = [];
  const oneLine = (x) =>
    String(x || "")
      .replace(/\s+/g, " ")
      .trim();
  const stateLines = (x) =>
    (x.continuityStates || []).map(
      (st) =>
        `  - **${st.name || st.id || "State"}**${st.appliesTo ? ` — ${st.appliesTo}` : ""}${st.approvedFile ? ` · ref: ${st.approvedFile}` : ""}${st.notes ? ` — ${oneLine(st.notes)}` : ""}`,
    );
  L.push(
    "# " +
      P.meta.title +
      " — PROJECT STATE (exported " +
      new Date().toISOString().slice(0, 10) +
      ")",
  );
  L.push(
    "*Exported from CineBraid — the hub is the live source of truth; this file is a planning snapshot for reading, handoff, and AI-assistant sessions.*\n",
  );
  L.push(
    "**Format:** " +
      (P.meta.format || "") +
      "  \n**Version:** " +
      (P.meta.version || "") +
      "  \n**CineBraid schema:** " +
      (P.meta.hubVersion || "v5.0") +
      "\n",
  );
  L.push("## CHARACTERS");
  for (const c of P.characters || []) {
    L.push("### " + c.id + " — " + c.name + " (" + (c.status || "") + ")");
    if (c.block) L.push("```\n" + c.block + "\n```");
    if (c.driftNotes) L.push("- Drift: " + c.driftNotes);
    if ((c.continuityStates || []).length)
      L.push("- Continuity states:", ...stateLines(c));
  }
  L.push("\n## LOCATIONS");
  for (const l of P.locations || []) {
    L.push(
      "- **" +
        l.id +
        "** " +
        l.name +
        " (" +
        (l.status || "") +
        ") — " +
        (l.notes || ""),
    );
    if ((l.continuityStates || []).length)
      L.push("  - Continuity states:", ...stateLines(l));
  }
  L.push("\n## PROPS");
  for (const p of P.props || []) {
    L.push(
      "- **" +
        p.id +
        "** " +
        p.name +
        " (" +
        (p.status || "") +
        ") — " +
        (p.notes || ""),
    );
    if ((p.continuityStates || []).length)
      L.push("  - Continuity states:", ...stateLines(p));
  }
  L.push("\n## VEHICLES");
  for (const v of P.vehicles || []) {
    L.push(
      "- **" +
        v.id +
        "** " +
        v.name +
        " (" +
        (v.status || "") +
        ") — " +
        (v.notes || ""),
    );
    if ((v.continuityStates || []).length)
      L.push("  - Continuity states:", ...stateLines(v));
  }
  L.push("\n## AUDIO CANON");
  for (const x of P.audio || []) {
    L.push(
      "### " +
        x.id +
        " — " +
        x.name +
        " (" +
        (x.status || "") +
        ")" +
        (x.sameObjectAs ? " — same source as " + x.sameObjectAs : ""),
    );
    if (x.notes) L.push(x.notes);
    for (const pr of x.prompts || []) L.push("```\n" + pr.text + "\n```");
  }
  L.push("\n## SCENES & SHOTS");
  for (const sc of P.scenes || []) {
    L.push(
      "### " + sc.id + " — " + sc.title + "  [TIER " + (sc.tier || "B") + "]",
    );
    if (sc.whatHappens) L.push("*Beat:* " + sc.whatHappens);
    if (sc.howItFeels) L.push("*Feel:* " + sc.howItFeels);
    L.push("| Shot | Title | Dur | Frames | Motion | Status | Safe version |");
    L.push("|---|---|---:|---|---|---|---|");
    for (const s of (P.shots || []).filter((x) => x.scene === sc.id)) {
      const d = s.clips?.length
        ? s.clips.reduce((a, c) => a + (+c.dur || 0), 0)
        : s.dur || 0;
      const frames =
        (s.keyframes || [])
          .map((f) => `${f.label || "?"}${f.winner ? " ✓" : ""}`)
          .join(" · ") || "—";
      const motion =
        (s.clips || [])
          .map(
            (c) =>
              `${c.label || c.suffix || "?"} ${String(c.kind || "plan").toUpperCase()}${c.videoWinner ? " ✓" : ""}`,
          )
          .join(" · ") || "—";
      L.push(
        "| " +
          s.id +
          " | " +
          s.title +
          " | " +
          d +
          "s | " +
          frames +
          " | " +
          motion +
          " | " +
          (s.workflowStatus || s.status || "") +
          " | " +
          (s.safe || "") +
          " |",
      );
    }
    for (const s of (P.shots || []).filter((x) => x.scene === sc.id)) {
      L.push("", `#### ${s.id} — ${s.title}`);
      if (s.desc) L.push("- **Plan:** " + oneLine(s.desc));
      if (s.positioning)
        L.push("- **Framing / blocking:** " + oneLine(s.positioning));
      if (
        s.continuityStateSelections &&
        Object.keys(s.continuityStateSelections).length
      ) {
        L.push(
          "- **Continuity selections:** " +
            Object.entries(s.continuityStateSelections)
              .map(([id, state]) => `${id} = ${state}`)
              .join("; "),
        );
      }
      for (const f of s.keyframes || []) {
        L.push(
          `- **Frame ${f.label || "?"} — ${f.title || "Keyframe"}**${f.required === false ? " (optional)" : ""}${f.winner ? ` · approved: ${f.winner}` : ""}`,
        );
        if (f.description) L.push("  - " + oneLine(f.description));
        const pkg = resolvePromptBuildList(P, f.generationPackages || []).at(-1);
        if (pkg?.prompt)
          L.push(
            `  - Package (${pkg.profileName || pkg.profileId || "general"}): ${oneLine(pkg.prompt)}`,
          );
      }
      for (const c of s.clips || []) {
        const from =
          (s.keyframes || []).find((f) => f.id === c.fromFrame)?.label || "?";
        const to =
          (s.keyframes || []).find((f) => f.id === c.toFrame)?.label || "";
        L.push(
          `- **Motion ${c.label || c.suffix || "?"} — ${c.title || "Motion unit"}** · ${String(c.kind || "plan").toUpperCase()} · ${from}${to ? " → " + to : ""} · ${c.dur || 0}s${c.videoWinner ? ` · approved: ${c.videoWinner}` : ""}`,
        );
        if (c.motionPrompt || c.note)
          L.push("  - " + oneLine(c.motionPrompt || c.note));
        if (c.line) L.push("  - DIALOGUE: " + oneLine(c.line));
        if (c.audioNote || c.vo) L.push("  - VO NOTE: " + oneLine(c.audioNote || c.vo));
        const pkg = resolvePromptBuildList(P, c.generationPackages || []).at(-1);
        if (pkg?.prompt)
          L.push(
            `  - Package (${pkg.profileName || pkg.profileId || "general"}): ${oneLine(pkg.prompt)}`,
          );
      }
      for (const b of resolvePromptBuildList(P, s.promptBuilds || []))
        L.push(
          "- **Legacy compiled build (" +
            (b.profileName || b.profileId || "profile") +
            ", " +
            (b.profileVersion || "unversioned") +
            "):** " +
            oneLine(b.prompt) +
            ((b.outcomeTags || []).length
              ? " _(outcomes: " + b.outcomeTags.join(", ") + ")_"
              : ""),
        );
    }
  }
  if (P.meta.models?.length) {
    L.push("\n## MODELS (planning targets)");
    for (const m of P.meta.models)
      L.push(
        "- **" +
          m.name +
          "** (" +
          m.type +
          (m.refSyntax ? ", refs: " + m.refSyntax : "") +
          ") — " +
          (m.notes || ""),
      );
  }
  if (P.meta.styleBlocks?.length) {
    L.push("\n## STYLE BLOCKS (locked)");
    for (const b of P.meta.styleBlocks)
      L.push(
        "### " +
          b.name +
          (b.stage ? " [stage " + b.stage + "]" : "") +
          "\n```\n" +
          b.text +
          "\n```",
      );
  }
  L.push("\n## SESSION LOG");
  for (const s of [...(P.sessions || [])].reverse()) {
    L.push("### Session " + s.n + " — " + s.date);
    L.push(s.summary || "");
    if (s.carryForward?.length)
      L.push("Carry-forward: " + s.carryForward.join("; "));
  }
  return L.join("\n");
}

/* No zero-argument projectDir. Generation is the longest-running asynchronous
   work in the product, and handing it a resolver that follows the globally
   active project is what let a switch mid-generation write one project's
   document over another's. It receives the means to resolve an EXPLICIT slug
   instead, and captures one before its first await. */
/* The returned handle is the P4-SEM-C4 job-record repair, and it is the only
   thing this module hands back. POST /api/media/rename calls it so the
   generation ledger follows the bytes without acquiring a second writer — see
   fal-generation.js repairJobMediaIdentity for why the commit chain matters. */
const FalGeneration = registerFalGeneration(app, {
  readConfig,
  readProject,
  writeProject,
  activeSlug,
  projectDirForSlug,
});
const AutomationRuns = registerAutomationRuns(app, {
  projectDir: PROJECT_DIR,
  readProject,
  activeSlug,
  projectReadinessIssues,
});
/* ---- the server-side ingest reaper -----------------------------------------
 *
 * Keeps ALREADY-SUBMITTED generation work moving without waiting for something to
 * ask, and records a run whose lease has lapsed as interrupted instead of leaving
 * it claiming to be running. It cannot start work: the only generation capability
 * it is handed is FalGeneration.recovery, which reads the ledger and collects
 * results, and holds no submission path at all. See generation-poller.js.
 *
 * Every project, not just the active one. A generation belongs permanently to
 * the project it started for — the same rule the ownership capture in
 * fal-generation.js exists for — so switching projects must not be what strands
 * a paid render. The automation-run correction stays with the active project,
 * because that ledger has exactly one writer and it is bound to that project. */
const GenerationPoller = createGenerationPoller({
  listProjectSlugs: () => listProjects().map((project) => project.slug),
  recovery: FalGeneration.recovery,
  reconcileStaleRuns: AutomationRuns.reconcileStaleRuns,
  log: (message) => console.log(message),
});
GenerationPoller.start();
/* Account connections take config and the listening port and nothing else. No
   project reader, no project writer, no project directory — the absence of those
   three is the structural statement that connecting an account cannot touch a
   production. The port is passed because the OAuth redirect must name this
   machine's own loopback address, and a request header is not evidence of that. */
registerAccountConnections(app, {
  readConfig,
  writeConfig,
  serverPort: PORT,
});

/* ---- model-aware Prompt Compiler ---- */
/* The prompt catalogue leaves here carrying ONE fact it does not hold itself: whether
   this build can actually dispatch each profile. The catalogue describes how to write
   for a model; whether CineBraid owns a pack that compiles it and an adapter that can
   send it is a fact about CineBraid's code, and generation-options.js is where that
   is declared beside the serializers. Without it a screen reading this list has no way
   to tell a wired model from a written-up one, which is how a motion target could be
   chosen and then fail to have a Generate button at all. */
app.get("/api/prompt/profiles", (req, res) => {
  try {
    res.json(annotateProfileLibraryExecution(PromptEngine.profileLibrary()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function serverContinuityStateDelta(state) {
  if (!state) return "";
  return String(
    state.notes ||
    state.stateDelta ||
    state.delta ||
    state.changeOnly ||
    state.change ||
    state.changes ||
    state.description ||
    state.visualDescription ||
    state.instructions ||
    state.prompt ||
    "",
  ).trim();
}

function assetPromptContext(P, list, entity, state = null, parentState = null, generationMode = "independent") {
  const type = list === "characters" ? "character" : list === "locations" ? "location" : list === "vehicles" ? "vehicle" : "prop";
  const baseDescription = entityVisualDescription(entity, type);
  const stateName = String(state?.name || "").trim();
  const stateDelta = serverContinuityStateDelta(state);
  const stateScope = String(state?.appliesTo || "").trim();
  const parentName = String(parentState?.name || "").trim();
  /* The scene/shot scope is production intent about where and when the state
     happens. The reviewer is given it, so the compiler must be too — otherwise
     generation and review are arguing about two different states. */
  const scopeLine = stateScope ? `This state is used for: ${stateScope}. Honour any setting, location or moment it names.` : "";
  const description = state && !state.isDefault
    ? [
        baseDescription,
        `Continuity target: ${stateName || "alternate state"}.`,
        scopeLine,
        stateDelta ? `Apply only this state change: ${stateDelta}` : "Apply the named continuity state without redesigning the entity.",
        parentName ? `The visual parent is ${parentName}; preserve every feature not explicitly changed by this state.` : "Preserve every base-canon feature not explicitly changed by this state.",
      ].filter(Boolean).join("\n")
    /* A base state is still a named state. "Rain-soaked arrival · Exterior
       arrival" carried both the moment and the setting, and the default-state
       branch used to discard both, leaving generation with the description
       alone while review was judging against the state. */
    : [
        baseDescription,
        stateName && stateName.toLowerCase() !== "default" ? `Base continuity state: ${stateName}.` : "",
        scopeLine,
        stateDelta ? `Base-state requirements: ${stateDelta}` : "",
      ].filter(Boolean).join("\n");
  const globalStyle = String(P.meta?.globalStylePrompt || "").trim();
  const styleBlocks = [
    ...(P.meta?.styleBlocks || []).filter((b) => b.id !== "global-style"),
    ...(globalStyle
      ? [{ id: "global-style", name: "Global visual style", text: globalStyle }]
      : []),
  ];
  const purpose = type === "character" ? "reference-sheet" : "shot-still";
  const subject =
    type === "character"
      ? `${entity.name || entity.id}. ${description}`
      : type === "location"
        ? `${entity.name || entity.id}. ${description}. Empty environment plate with no people or characters.`
        : type === "vehicle"
          ? `${entity.name || entity.id}. ${description}. Clean vehicle design reference with no driver, passengers, people, or unrelated objects.`
          : `${entity.name || entity.id}. ${description}. Isolated hero prop reference with no hands or people.`;
  const staging =
    type === "character"
      ? "One production-ready full-body character anchor, neutral stance, readable silhouette, consistent proportions and wardrobe."
      : type === "location"
        ? "Wide master plate that clearly establishes the usable layout, entrances, surfaces, important geometry and practical light sources."
        : type === "vehicle"
          ? "Vehicle fully visible at a useful three-quarter angle, with silhouette, proportions, construction, materials, finish, scale and functional details clearly readable."
          : "Object centered and fully visible at a useful three-quarter angle, with scale, construction, materials and wear clearly readable.";
  /* THE reference-generation format, from the one resolver every request builder
     already reads. It is not the production delivery format and never was: this
     compile produces a character anchor, a location plate or an object card, and the
     provider request has always asked for exactly that shape. Handing the compiler
     `meta.aspectRatio` instead is what let a 16:9 project write "Output at 16:9" into
     a prompt whose request said 3:4 — the model was given two answers and the request
     won, silently. */
  const referenceRatio = referenceAspectLabel(list);
  /* The legacy free-text format ("Short film · 16:9") reaches the prompt advisor as
     context, and it carried the same contradiction one indirection further back: the
     advisor reads the delivery ratio and writes "16:9 composition" into staging or
     camera prose the compiler then emits verbatim. The medium survives; the ratio
     inside it is restated as the one this reference is actually being generated at. */
  const productionFormat = String(P.meta?.format || "");
  const referenceFormat = aspectRatioMentions(productionFormat)
    .reduce((text, mention) => text.split(mention).join(referenceRatio), productionFormat);
  return {
    project: {
      title: P.meta?.title || "",
      format: referenceFormat,
      world: {
        ...(P.meta?.world || {}),
        reject:
          P.meta?.globalNegativePrompt || P.meta?.world?.reject || "",
        /* world.aspectRatio is the compiler's second reader (`spec.aspectRatio ||
           spec.world?.aspectRatio`). Left at the production format it would reinstate
           the contradiction the moment the first reader was empty. */
        aspectRatio: referenceRatio,
      },
      styleBlocks,
      qcChecklist: P.qcChecklist || [],
      aspectRatio: referenceRatio,
    },
    scene: {
      id: "ASSET",
      title: `${type} reference creation`,
      beat: `Create the approved ${type} reference before shot composition.`,
      feeling: "Clear, production-usable and continuity-safe.",
      stage: "",
    },
    shot: {
      id: entity.id,
      parentShotId: entity.id,
      segmentId: "",
      title: entity.name || entity.id,
      description: subject,
      positioning: staging,
      durationSeconds: 1,
      motionDirection: "",
      outputPlan: "reference",
      clips: [],
      risks: [],
      safeVersion: "",
      audio: { dialogue: "", sfx: "", clipDialogue: [] },
    },
    references: [],
    purpose,
    assetType: type,
    state: state
      ? {
          id: state.id || "state-default",
          name: stateName || (state.isDefault ? "Default" : "State"),
          isDefault: !!state.isDefault,
          delta: stateDelta,
          generationMode: state.isDefault ? "independent" : generationMode,
          parentStateId: parentState?.id || "",
          parentStateName: parentName,
          /* CANON ONLY. This fed the compiled prompt and the provider payload a
             raw pointer as the parent's approved image. */
          parentApprovedFile: parentState
            ? ((ProductionAuthority.entityProductionTruth(P, list, entity.id).canon || [])
              .find((row) => row.stateId === parentState.id) || {}).value || ""
            : "",
        }
      : null,
  };
}

app.post("/api/prompt/asset-compile", async (req, res) => {
  try {
    const P = readProject();
    const list = String(req.body.list || "");
    if (!["characters", "locations", "props", "vehicles"].includes(list))
      return res.status(400).json({ error: "Unsupported asset type" });
    const entity = (P[list] || []).find((x) => x.id === req.body.id);
    if (!entity) return res.status(404).json({ error: "Asset not found" });
    const states = Array.isArray(entity.continuityStates) ? entity.continuityStates.filter(Boolean) : [];
    const requestedStateId = String(req.body.stateId || "").trim();
    /* No stateId means "the base reference", which is still a named state the
       director may have titled and scoped. Resolving the entity's own default
       record here is what lets its name and scene scope reach the compiler; it
       is the same record the reviewer is already judging against. */
    const state = requestedStateId
      ? states.find((item) => String(item.id) === requestedStateId)
      : states.find((item) => item.isDefault) || null;
    if (requestedStateId && !state) return res.status(400).json({ error: "Continuity state not found" });
    /* MB-PT-04, SERVER SIDE — EXACT ANCESTRY, AND IT FAILS CLOSED.
     *
     * The browser resolvers were corrected and this route independently
     * reintroduced the old rule: it accepted a caller-supplied parent id, and
     * when that did not resolve it substituted the DEFAULT state. So a state
     * carrying `parentStateId: "ghost"` compiled a prompt against the default
     * image — an operational reparent of an immutable state, performed by the
     * compiler, after the client had already refused to do it.
     *
     * An existing state has the parent IT RECORDS. The caller does not get to
     * name one, and there is no substitute. */
    const recordedParentId = String(state?.parentStateId || "").trim();
    const parentState = state && !state.isDefault
      ? states.find((item) => String(item.id) === recordedParentId && String(item.id) !== String(state.id)) || null
      : null;
    if (state && !state.isDefault && !parentState) {
      return res.status(400).json({
        error: recordedParentId
          ? `${state.name || "This continuity state"} records a parent state (${recordedParentId}) that no longer exists. Repair its lineage before compiling a prompt for it.`
          : `${state.name || "This continuity state"} does not record what it derives from. Create it from the reference you mean, or generate it independently.`,
        code: "STATE_ANCESTRY_UNRESOLVED",
      });
    }
    const generationMode = state && !state.isDefault && req.body.generationMode === "derive" ? "derive" : "independent";
    const profile = PromptEngine.getProfile(req.body.profileId);
    const derivedEdit = !!(state && !state.isDefault && generationMode === "derive" && profile?.mode === "edit");
    if (!profile || profile.mediaType !== "image" || !["t2i", "edit"].includes(profile.mode) || (profile.mode === "edit" && !derivedEdit))
      return res.status(400).json({ error: state && !state.isDefault ? "Choose a text-to-image profile, or a reference-edit profile when deriving from an approved parent state" : "Choose a text-to-image profile" });
    /* AND THE PARENT MUST BE CANON, NOT MERELY PRESENT.
     *
     * `parentApprovedFile` was read straight off the record and then shipped as
     * `role: "base"`, `approved: true`, labelled "Approved … reference". A
     * pointer nobody approved became the editable base of production output —
     * the server-side twin of the browser defect, using the same words. It is
     * populated only from receipt-backed canon now; a historic parent produces
     * no base and the route says why. */
    const parentCanon = parentState
      ? (ProductionAuthority.entityProductionTruth(P, list, entity.id).canon || [])
        .find((row) => row.stateId === parentState.id) || null
      : null;
    const parentApprovedFile = parentCanon ? parentCanon.value : "";
    if (derivedEdit && !parentApprovedFile) {
      const held = parentState ? (parentState.approvedFile || (parentState.isDefault ? entity.approvedFile || "" : "")) : "";
      return res.status(400).json({
        error: held
          ? `${state.name || "Continuity state"} derives from ${parentState.name || "its parent"}, whose image ${held} has never been approved as canon. Approve it before using a reference-edit profile.`
          : `${state.name || "Continuity state"} needs an approved parent-state image before using a reference-edit profile`,
        code: "PARENT_NOT_CANON",
      });
    }
    const references = derivedEdit ? [{
      key: `continuity-parent:${parentState?.id || "state-default"}`,
      label: `Canon ${parentState?.name || "parent state"} reference`,
      asset: parentApprovedFile,
      role: "base",
      mediaType: "image",
      approved: true,
      instruction: `Editable parent-state base for ${state.name || "the target state"}. Preserve every feature not explicitly changed by the continuity delta.`,
    }] : [];
    const context = assetPromptContext(P, list, entity, state, parentState, generationMode);
    const purpose = context.purpose;
    const fallback = PromptEngine.defaultSpec(
      context,
      purpose,
      profile.mode,
      references,
      null,
    );
    fallback.shotId = entity.id;
    fallback.purpose = purpose;
    fallback.initialState.subject = context.shot.description;
    fallback.initialState.staging = context.shot.positioning;
    fallback.initialState.camera =
      context.assetType === "location"
        ? "Wide master establishing plate with practical, readable geometry."
        : context.assetType === "character"
          ? "Full-body production anchor with neutral perspective and clear silhouette."
          : context.assetType === "vehicle"
            ? "Full-vehicle three-quarter production reference with neutral perspective and an unobstructed silhouette."
            : "Clean hero-object reference framing.";
    fallback.initialState.environment =
      context.assetType === "location"
        ? context.shot.description
        : "Simple unobtrusive background that does not contaminate the asset design.";
    fallback.camera.framing = fallback.initialState.camera;
    fallback.visualStyle = context.project.styleBlocks.map((b) => b.text).filter(Boolean);
    fallback.mustPreserve = [
      context.assetType === "character"
        ? "the described identity, age, proportions, wardrobe, materials and distinguishing features"
        : context.assetType === "location"
          ? "the described layout, architecture, materials, entrances, important geometry and practical lighting logic"
          : context.assetType === "vehicle"
            ? "the described vehicle silhouette, proportions, scale, materials, finish, construction, functional details and identifying features"
            : "the described design, scale, materials, construction, wear, identifying details, and any exact embedded photograph, mural, artwork, print, text, label, map, document or screen content",
      state && !state.isDefault
        ? `the exact camera, crop, perspective, identity, design, proportions, materials, layout, embedded content and details from ${parentState?.name || "the base entity"} that the ${state.name || "target"} state does not explicitly change`
        : "",
    ];
    fallback.mustAvoid = [
      context.project.world?.reject
        ? `world violations: ${context.project.world.reject}`
        : "",
      context.assetType === "location"
        ? "people, characters, crowds, foreground bodies or unexplained props"
        : context.assetType === "character"
          ? "extra characters, duplicated limbs, cropped feet, identity drift or an environment that competes with the character"
          : context.assetType === "vehicle"
            ? "drivers, passengers, people, duplicate vehicles, cropped wheels, distorted body panels, unreadable silhouette, labels or a dramatic environment that obscures the design"
            : "hands, people, duplicate objects, labels or an environment that obscures the object",
      state && !state.isDefault
        ? "unrequested redesign, identity drift, changed camera or crop, changed proportions, replaced materials, substituted embedded photographs/artwork/text, altered architecture or unaffected details, or any visual change outside the stated continuity delta"
        : "",
    ].filter(Boolean);
    const directive = String(req.body.directive || "").trim();
    const continuityAction = state && !state.isDefault && serverContinuityStateDelta(state)
      ? [
          `EDIT ONLY THIS CONTINUITY DELTA: ${serverContinuityStateDelta(state)}`,
          "Keep the parent image's camera, crop, perspective, composition, identity, geometry, materials and all unaffected pixels stable.",
          context.assetType === "location" ? "Do not move, add, remove, mirror or redesign walls, openings, doors, windows, fixed fixtures, landmarks or set dressing." : "",
          context.assetType === "prop" ? "Do not replace or reinterpret any embedded photograph, mural, artwork, text, label, map, document, print or screen content." : "",
        ].filter(Boolean).join("\n")
      : "";
    if (continuityAction || directive) {
      fallback.actions = [{ start: 0, end: 1, action: [continuityAction, directive].filter(Boolean).join("\n") }];
      if (directive) fallback.initialState.staging = [fallback.initialState.staging, directive].filter(Boolean).join("\n");
      /* stagingBlock() reads initialState.staging only when stagingLines is empty,
         and for an asset brief it never is - positioning always fills it. Written
         to initialState alone, the directive reached the spec and then vanished
         from every compiled prompt: the reference workspace's own "Asset-specific
         direction" field and durable automation's pass-to-pass correction were
         both being discarded at exactly this line. */
      if (directive) {
        fallback.stagingLines = [
          ...(fallback.stagingLines || []),
          ...directive.split("\n").map((line) => line.trim()).filter(Boolean),
        ];
      }
    }
    let spec = fallback;
    let llmUsed = false;
    let llmWarning = "";
    if (req.body.useLLM === true && projectAIPolicy() !== "disabled") {
      try {
        const assistant = await requestAssistantResult(
          "prompt",
          PromptEngine.buildSpecSystem(profile),
          PromptEngine.buildSpecUser(
            context,
            profile,
            purpose,
            profile.mode,
            references,
            null,
            directive,
          ),
          {
            label: `${context.assetType || "Reference"} prompt advisor`,
            maxTokens: 8000,
            provider: aiProviderOverride(),
            parse: (raw) => PromptEngine.validateSpec(PromptEngine.extractJsonObject(raw), fallback),
          },
        );
        spec = assistant.value;
        llmUsed = true;
        if (assistant.recovered) llmWarning = `Assistant recovered on attempt ${assistant.attempts} of 3.`;
      } catch (e) {
        spec = fallback;
        llmWarning = `Assistant shaping was unavailable; compiled from the written brief instead: ${e.message}`;
      }
    }
    const built = PromptEngine.compile(profile, spec, references);
    res.json({
      profile,
      spec,
      compiledPrompt: built.prompt,
      providerPayload: built.payload,
      warnings: [llmWarning, ...(built.warnings || [])].filter(Boolean),
      confirmations: built.confirmations || [],
      references: built.references || references,
      llmUsed,
      sourceContext: context,
      state: context.state,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function resolveProjectAssetUrl(url) {
  const rel = String(url || "")
    .replace(/^\/assets\//, "")
    .replace(/\\/g, "/");
  const allowedRoot =
    /^(anchors|plates|props|vehicles|audio|media)\/[^/]+$/.test(rel) ||
    /^shots\/[\w.-]+\/(takes|locked|blocking)\/[^/]+$/.test(rel);
  const ext = path.extname(rel).toLowerCase();
  if (!allowedRoot || !MEDIA_EXT.has(ext))
    throw new Error("Unsupported or unsafe media reference");
  const root = path.resolve(PROJECT_DIR());
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
    throw new Error("Referenced media is missing");
  return file;
}

app.post("/api/prompt/analyze", async (req, res) => {
  try {
    const visionProvider = aiVisionProviderOverride();
    const refs = (req.body.references || [])
      .filter((r) => r.url && /\.(png|jpe?g|webp)$/i.test(r.url))
      .slice(0, 8);
    if (!refs.length)
      return res
        .status(400)
        .json({ error: "Select at least one image reference." });
    const files = refs.map((r) => resolveProjectAssetUrl(r.url));
    const images = files.map((f) => fs.readFileSync(f).toString("base64"));
    const analysisShape = {
      frames: [
        {
          n: 1,
          role: "",
          subjects: [
            {
              identity: "",
              screenPosition: "",
              orientation: "",
              pose: "",
              gaze: "",
              hands: "",
            },
          ],
          camera: { shotSize: "", height: "", angle: "", lensIntent: "" },
          environment: { summary: "", importantGeometry: [] },
          continuityRisks: [],
        },
      ],
      camera: { summary: "", shotSize: "", movement: "", lensIntent: "" },
      transition: { requiredChanges: [], invariants: [], conflicts: [] },
      globalRisks: [],
    };
    const system = [
      "You are CineBraid's objective production-frame analyzer.",
      "Inspect the supplied images in order.",
      "Do not write a creative prompt and do not invent hidden details.",
      "Return ONLY valid JSON with this shape:",
      JSON.stringify(analysisShape),
      "When first-frame and last-frame roles are supplied, compare them and identify the physical transition, invariants and conflicts.",
    ].join("\n");
    const user =
      "IMAGE ORDER / ROLES:\n" +
      refs
        .map(
          (r, i) =>
            `${i + 1}. ${r.role || "reference"} — ${r.label || path.basename(files[i])}`,
        )
        .join("\n");
    const assistant = await requestVisionResult(system, user, images, {
      label: "Production-frame analyzer",
      maxTokens: 5000,
      provider: visionProvider,
      parse: (raw) => PromptEngine.extractJsonObject(raw),
    });
    const analysis = assistant.value;
    const cfg = readConfig();
    res.json({
      analysis,
      engine:
        visionProvider ||
        cfg.assistant?.visionProvider ||
        cfg.assistant?.provider ||
        "ollama",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function generationInputReferences(
  profile,
  references,
  allowAdditionalReferences = false,
) {
  const refs = Array.isArray(references) ? references : [];
  const result = { references: refs, dropped: [], warnings: [] };
  const refName = (ref) => String(ref?.label || ref?.name || ref?.key || ref?.role || "unnamed reference");
  if (
    profile.mediaType !== "video" ||
    profile.mode === "r2v" ||
    allowAdditionalReferences
  )
    return result;
  if (profile.mode === "i2v") {
    const firstCandidates = refs.filter((r) => ["first-frame", "base"].includes(r.role));
    const first = firstCandidates[0] || null;
    result.references = first ? [first] : [];
    result.dropped = refs.filter((ref) => ref !== first);
    if (result.dropped.length)
      result.warnings.push(`${profile.name} image-to-video uses one opening frame. Not sent: ${result.dropped.map(refName).join(", ")}.`);
    if (firstCandidates.length > 1)
      result.warnings.push(`${profile.name} received ${firstCandidates.length} possible opening frames and selected ${refName(first)} because it appeared first in the generation-input order.`);
    if (!first)
      result.warnings.push(`${profile.name} needs one reference with role first-frame or base before this prompt can be used for generation.`);
    return result;
  }
  if (profile.mode === "flf") {
    const firstCandidates = refs.filter((r) => ["first-frame", "base"].includes(r.role));
    const lastCandidates = refs.filter((r) => ["last-frame", "end-frame"].includes(r.role));
    const first = firstCandidates[0] || null;
    const last = lastCandidates[0] || null;
    result.references = [first, last].filter(Boolean);
    result.dropped = refs.filter((ref) => ref !== first && ref !== last);
    if (result.dropped.length)
      result.warnings.push(`${profile.name} first/last-frame mode sends only the selected endpoints. Not sent: ${result.dropped.map(refName).join(", ")}.`);
    if (firstCandidates.length > 1)
      result.warnings.push(`${profile.name} received ${firstCandidates.length} possible first frames and selected ${refName(first)} because it appeared first in the generation-input order.`);
    if (lastCandidates.length > 1)
      result.warnings.push(`${profile.name} received ${lastCandidates.length} possible last frames and selected ${refName(last)} because it appeared first in the generation-input order.`);
    if (!first) result.warnings.push(`${profile.name} first/last-frame mode is missing its first-frame input.`);
    if (!last) result.warnings.push(`${profile.name} first/last-frame mode is missing its last-frame input; do not submit this package as FLF until an endpoint is assigned.`);
    return result;
  }
  return result;
}

function stripAssistantThinking(value) {
  return cleanModelJson(value)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .trim();
}

function motionRevisionArray(value) {
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === "string"
          ? item
          : item?.note || item?.reason || item?.summary || item?.change || item?.title || "",
      )
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function parseAssistantMotionRevision(raw, profile) {
  const queue = [{ value: raw, changes: [] }];
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    let text = stripAssistantThinking(item.value);
    if (!text || seen.has(text)) continue;
    seen.add(text);

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      try {
        parsed = PromptEngine.extractJsonObject(text);
      } catch {}
    }

    if (parsed !== null) {
      if (typeof parsed === "string") {
        queue.unshift({ value: parsed, changes: item.changes });
        continue;
      }
      if (Array.isArray(parsed)) {
        for (const value of parsed) queue.push({ value, changes: item.changes });
        continue;
      }
      if (parsed && typeof parsed === "object") {
        const changes = [
          ...item.changes,
          ...motionRevisionArray(parsed.changes),
          ...motionRevisionArray(parsed.changeSummary),
          ...motionRevisionArray(parsed.notes),
        ].slice(0, 8);
        const candidates = [
          parsed.directive,
          parsed.revisedDirective,
          parsed.motionDirection,
          parsed.motionPrompt,
          parsed.revisedPrompt,
          parsed.prompt,
          parsed.output,
          parsed.text,
          parsed.content,
          parsed.result,
          parsed.message,
        ].filter((value) => value !== undefined && value !== null);
        if (parsed.choices?.[0]?.message?.content)
          candidates.unshift(parsed.choices[0].message.content);
        for (const value of candidates)
          queue.unshift({ value: typeof value === "string" ? value : JSON.stringify(value), changes });
        continue;
      }
    }

    const labelled = text.match(
      /(?:^|\n)\s*(?:DIRECTIVE|REVISED (?:MOTION )?DIRECTION|MOTION PROMPT)\s*:\s*([\s\S]*?)(?=\n\s*(?:CHANGES?|NOTES?)\s*:|$)/i,
    );
    if (labelled) {
      const changesBlock = text.match(/\n\s*(?:CHANGES?|NOTES?)\s*:\s*([\s\S]*)$/i);
      const changes = changesBlock
        ? changesBlock[1]
            .split(/\r?\n/)
            .map((x) => x.replace(/^\s*[-*•]\s*/, "").trim())
            .filter(Boolean)
            .slice(0, 8)
        : item.changes;
      queue.unshift({ value: labelled[1], changes });
      continue;
    }

    // Recover a JSON string value even when the surrounding object is malformed.
    const malformedDirective = text.match(
      /["'](?:directive|revisedDirective|motionDirection|motionPrompt)["']\s*:\s*("(?:\\.|[^"\\])*")/i,
    );
    if (malformedDirective) {
      try {
        queue.unshift({ value: JSON.parse(malformedDirective[1]), changes: item.changes });
        continue;
      } catch {}
    }

    if (/^\s*[\[{]/.test(text) || /["'](?:directive|changes)["']\s*:/.test(text)) continue;
    const normalized = PromptEngine.deterministicMotionRevision(profile, text);
    if (!normalized || normalized.length > 1800) continue;
    return {
      directive: normalized,
      changes: item.changes.length
        ? item.changes
        : ["Clarified the observable motion and removed non-prompt commentary."],
    };
  }
  throw new Error("Local model returned neither a usable motion direction nor a recoverable structured response");
}

function motionImproveSystem(profile, hasAudioIntent) {
  const familyRule =
    profile.family === "kling-3"
      ? "Use one compact natural-language motion paragraph. Put subject and environmental motion first and camera behavior last."
      : profile.family === "happy-horse-1.1"
        ? "Keep visible motion concise. Include native audio behavior only when audio was supplied."
        : profile.family === "wan-2.7"
          ? "Describe observable subject, environment, and camera motion without headings; CineBraid adds Wan structure and negative prompting later."
          : profile.family === "ltx-2.3"
            ? "Use a chronological flowing action description that can unfold across the selected duration."
            : profile.family === "seedance-2"
              ? "Use chronological physical action and explicit camera behavior; do not repeat reference contracts."
              : "Use concise observable motion and camera language.";
  return [
    `You are a motion-direction editor for ${profile.name}.`,
    "Rewrite only the user's motion intent so it is clearer and physically executable for the selected video target.",
    familyRule,
    "Do not describe the still image, identity, wardrobe, geometry, lighting, or composition except where a named element must remain still.",
    "Do not add preservation boilerplate, negative prompting, model settings, global constraints, reference instructions, or invented story details.",
    "The user payload may include a canonical motionBrief and locked fields. Never rewrite locked dialogue, speaker identity, persistent voice design, duration, or start/end-frame roles. Improve only physical action, performance clarity, camera chronology, and the phrasing of supplied sound direction.",
    hasAudioIntent
      ? "Use only the supplied audio, dialogue, sound, or cue information; do not invent additional sounds."
      : "No audio intent was supplied. Do not mention audio, synchronization, sound, music, silence, chirps, pulses, or cues.",
    "Return ONLY valid JSON with this shape: {\"directive\":\"one to three concise sentences\",\"changes\":[\"brief note\"]}.",
    "The directive value must be plain prompt text, never another JSON object or markdown block.",
  ].join("\n");
}

function removeUnsuppliedAudioClaims(value) {
  return String(value || "")
    .replace(
      /(?:^|[.!?]\s+)(?:Audio|Native audio|Sound|Music|Silence|Dialogue|Voice|Lip[- ]?sync)\s*:\s*[^.!?]*[.!?]?/gi,
      " ",
    )
    .replace(
      /\s+(?:in sync|synchronized|timed|phase-synced)\s+with\s+(?:the\s+|a\s+)?(?:audio|sound|music|beat|chirp|voice|dialogue|cue)[^.!?]*/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function blockingImproveSystem(profile) {
  return [
    `You are CineBraid's blocking-plan editor for ${profile.name}.`,
    "Rewrite the structural plan for a flat greyscale storyboard frame, not a finished image prompt.",
    "Resolve contradictions in favor of the primary visual action and the user's additional direction.",
    "For tight inserts and physical-contact shots, make the action large in frame and reduce the environment.",
    "Do not add identity canon, wardrobe, materials, colour, lighting, style, dialogue, sound, or new story content.",
    "Use only these enum values:",
    "emphasis: full-scene | balanced | action-insert",
    "shotSize: extreme-wide | wide | medium-wide | medium | medium-close | close-up | extreme-close",
    "height: ground-level | low | eye-level | high | overhead",
    "angle: level | low-angle | high-angle | dutch-left | dutch-right",
    "lens: ultra-wide | wide | normal | telephoto",
    "view: front | three-quarter-left | three-quarter-right | profile-left | profile-right | rear | over-the-shoulder",
    "layout: rule-of-thirds | centered | symmetrical | negative-left | negative-right | foreground-frame",
    "crop: full-scene | full-body | knees-up | waist-up | bust | detail",
    "Return ONLY JSON: {\"emphasis\":\"\",\"camera\":{\"shotSize\":\"\",\"height\":\"\",\"angle\":\"\",\"lens\":\"\",\"view\":\"\",\"layout\":\"\",\"crop\":\"\"},\"environmentEmphasis\":\"minimal|supporting|full\",\"primaryAction\":\"\",\"layoutLines\":[\"\"],\"conflictsResolved\":[\"\"]}.",
  ].join("\n");
}
function compactBlockingImprovePayload(context, req, blockingPlan) {
  const shot = context?.shot || {};
  const composition = req.body?.composition || shot.composition || {};
  return {
    shot: {
      id: shot.id || "",
      title: shot.title || "",
      action: shot.desc || shot.description || "",
      staging: shot.positioning || "",
      risks: Array.isArray(shot.risks) ? shot.risks.slice(0, 12) : [],
    },
    sceneBeat: context?.scene?.beat || context?.scene?.whatHappens || "",
    frameBrief: req.body?.blockingFrameBrief || "",
    additionalDirection: req.body?.blockingDirection || "",
    currentComposition: {
      camera: composition.camera || {},
      aspectRatio: composition.aspectRatio || "",
      elements: (Array.isArray(composition.elements) ? composition.elements : []).slice(0, 16).map((item) => ({
        id: item.id || "",
        referenceKey: item.referenceKey || "",
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        depth: item.depth || "",
        facing: item.facing || "",
        view: item.view || "",
        crop: item.crop || "",
        notes: String(item.notes || "").slice(0, 240),
      })),
    },
    deterministicPlan: blockingPlan,
  };
}
function assistantErrorIsPermanent(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "assistance is disabled",
    "vision assistance is disabled",
    "no anthropic api key",
    "no openai api key",
    "base url is not set",
    "model is not set",
    "unknown prompt profile",
    "not configured",
  ].some((token) => message.includes(token));
}
function assistantRetryInstruction(attempt, label = "Assistant") {
  if (!attempt) return "";
  return `

RECOVERY ATTEMPT ${attempt + 1} OF 3 FOR ${String(label).toUpperCase()}
The previous response failed, was empty, was truncated, or could not be parsed. Return one complete response only. Do not include markdown fences, commentary before the response, or a trailing explanation. Keep the answer compact enough to finish.`;
}
async function requestAssistantResult(task, system, user, options = {}) {
  const label = options.label || "Assistant";
  const maxTokens = Number(options.maxTokens || 2600);
  const provider = options.provider || aiProviderOverride();
  const model = options.model;
  const parse = typeof options.parse === "function" ? options.parse : (raw) => raw;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await llm(
        task,
        system + assistantRetryInstruction(attempt, label),
        user,
        attempt ? Math.min(maxTokens, Number(options.retryMaxTokens || maxTokens)) : maxTokens,
        provider,
        model,
        { responseFormat: options.responseFormat || "" },
      );
      if (!String(raw || "").trim()) throw new Error(`${label} returned an empty response`);
      return { value: parse(raw), attempts: attempt + 1, recovered: attempt > 0 };
    } catch (error) {
      lastError = error;
      if (assistantErrorIsPermanent(error)) break;
    }
  }
  const suffix = lastError?.message ? `: ${lastError.message}` : "";
  throw new Error(`${label} failed after 3 attempts${suffix}`);
}
async function requestStrictAssistantJson(system, payload, options = {}) {
  return requestAssistantResult("prompt", system, JSON.stringify(payload), {
    ...options,
    parse: (raw) => PromptEngine.extractJsonObject(raw),
    retryMaxTokens: Math.min(Number(options.maxTokens || 2600), 2200),
    responseFormat: "json",
  });
}
async function requestVisionResult(system, user, images, options = {}) {
  const label = options.label || "Vision assistant";
  const maxTokens = Number(options.maxTokens || 3000);
  /* Resolved once, here, and then dispatched explicitly. A caller that records
     provenance therefore records what was actually asked, not what Settings say
     by the time anyone looks — and every retry goes to the same target. */
  const target = resolveVisionTarget(options.provider || aiVisionProviderOverride(), options.model);
  const provider = target.provider;
  const model = target.model;
  const parse = typeof options.parse === "function" ? options.parse : (raw) => raw;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const retryUser = attempt
        ? `${user}

RECOVERY ATTEMPT ${attempt + 1} OF 3
The previous vision response failed, was empty, was truncated, or could not be parsed. Return one complete compact response only, with no markdown fences or extra commentary.`
        : user;
      const raw = await vision(system, retryUser, images, maxTokens, provider, model);
      if (!String(raw || "").trim()) throw new Error(`${label} returned an empty response`);
      return { value: parse(raw), attempts: attempt + 1, recovered: attempt > 0, provider, model };
    } catch (error) {
      lastError = error;
      if (assistantErrorIsPermanent(error)) break;
    }
  }
  const suffix = lastError?.message ? `: ${lastError.message}` : "";
  throw new Error(`${label} failed after 3 attempts${suffix}`);
}
function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function deterministicComposerProposal(context, references, composition, options = {}) {
  const refs = (references || []).filter((ref) => ref && ref.key);
  const placeable = refs.filter((ref) => !["base", "location", "composition"].includes(ref.role) && ref.sourceType !== "location");
  const base = refs.find((ref) => ref.url && (["base", "location", "composition"].includes(ref.role) || ref.sourceType === "location"));
  const plan = PromptEngine.buildBlockingPlan(context, composition, options);
  const text = [options.frameBrief, options.direction, context.shot.description, context.shot.positioning].filter(Boolean).join("\n").toLowerCase();
  const ranked = [...placeable].sort((a, b) => {
    const score = (ref) => [ref.entityName, ref.displayName, ref.label, ref.entityId].filter(Boolean).reduce((n, token) => n + (text.includes(String(token).toLowerCase()) ? 3 : 0), 0) + (ref.role === "prop" ? 1 : 0);
    return score(b) - score(a);
  });
  const existing = Array.isArray(composition?.elements) ? composition.elements : [];
  const elements = [];
  if (options.mode === "review" && existing.length) {
    for (const item of existing) elements.push({
      elementId: item.id || "",
      referenceKey: item.referenceKey,
      x: +item.x || .5,
      y: +item.y || .5,
      w: +item.w || .25,
      h: +item.h || .25,
      depth: item.depth || "midground",
      facing: item.facing || "camera",
      view: item.view || "reference-view",
      crop: item.crop || "none",
      notes: item.notes || "",
    });
  } else if (plan.emphasis === "action-insert") {
    if (ranked[0]) elements.push({ referenceKey: ranked[0].key, x: .43, y: .52, w: .7, h: .78, depth: "foreground", facing: "camera", view: ranked[0].angleTag ? "reference-view" : "three-quarter-left", crop: "partial-left", notes: "Dominant action subject; keep the physical contact area visible." });
    if (ranked[1]) elements.push({ referenceKey: ranked[1].key, x: .57, y: .73, w: .34, h: .28, depth: "foreground", facing: "camera", view: "reference-view", crop: "none", notes: "Place directly at the primary contact point." });
  } else {
    ranked.slice(0, 4).forEach((ref, index) => {
      const positions = [[.32,.56],[.68,.56],[.5,.72],[.5,.35]];
      const [x,y] = positions[index];
      elements.push({ referenceKey: ref.key, x, y, w: ref.role === "prop" ? .26 : .3, h: ref.role === "prop" ? .25 : .5, depth: index < 2 ? "midground" : "foreground", facing: index % 2 ? "screen-left" : "screen-right", view: "reference-view", crop: "none", notes: "" });
    });
  }
  const issues = [...plan.conflictsResolved];
  if (!placeable.length) issues.push("No placeable character, prop, or vehicle references are attached; camera guidance can still be applied.");
  if (options.mode === "review" && plan.emphasis === "action-insert") {
    const largest = Math.max(0, ...existing.map((item) => Number(item.w || 0)));
    if (largest < .5) issues.push("The primary staged element is too small for the requested action insert; increase it to at least half the frame width.");
  }
  return {
    mode: options.mode === "review" ? "review" : "suggest",
    summary: plan.emphasis === "action-insert" ? "Prioritize the physical action as a tight insert and suppress the wider environment." : plan.emphasis === "full-scene" ? "Establish the full spatial context with readable subject separation." : "Balance the primary action with enough environment to orient the viewer.",
    camera: plan.camera,
    environmentBaseKey: base?.key || "",
    elements,
    issues,
    rationale: plan.layoutLines,
    replaceLayout: options.mode !== "review" && !existing.length,
  };
}
function normalizeComposerProposal(raw, fallback, references, composition) {
  const source = raw && typeof raw === "object" ? raw : {};
  const validRefs = new Map((references || []).filter((ref) => ref?.key).map((ref) => [ref.key, ref]));
  const existing = new Map((composition?.elements || []).map((item) => [item.id, item]));
  const allowed = {
    shotSize: new Set(["extreme-wide","wide","medium-wide","medium","medium-close","close-up","extreme-close"]),
    height: new Set(["ground-level","low","eye-level","high","overhead"]),
    angle: new Set(["level","low-angle","high-angle","dutch-left","dutch-right"]),
    lens: new Set(["ultra-wide","wide","normal","telephoto"]),
    view: new Set(["front","three-quarter-left","three-quarter-right","profile-left","profile-right","rear","over-the-shoulder"]),
    layout: new Set(["rule-of-thirds","centered","symmetrical","negative-left","negative-right","foreground-frame"]),
    crop: new Set(["full-scene","full-body","knees-up","waist-up","bust","detail"]),
  };
  const camera = { ...(fallback.camera || {}) };
  if (source.camera && typeof source.camera === "object") for (const [key, values] of Object.entries(allowed)) if (values.has(source.camera[key])) camera[key] = source.camera[key];
  const elements = [];
  const input = Array.isArray(source.elements) ? source.elements : fallback.elements || [];
  for (const item of input) {
    const current = existing.get(item.elementId) || {};
    const referenceKey = String(item.referenceKey || current.referenceKey || "");
    const ref = validRefs.get(referenceKey);
    if (!ref || ["base","location","composition"].includes(ref.role) || ref.sourceType === "location") continue;
    elements.push({
      elementId: String(item.elementId || current.id || ""), referenceKey,
      x: clampNumber(item.x, Number(current.x || .5), 0, 1), y: clampNumber(item.y, Number(current.y || .5), 0, 1),
      w: clampNumber(item.w, Number(current.w || .25), .08, 1), h: clampNumber(item.h, Number(current.h || .25), .08, 1),
      depth: ["background","midground","foreground"].includes(item.depth) ? item.depth : current.depth || "midground",
      facing: ["camera","screen-left","screen-right","away-camera"].includes(item.facing) ? item.facing : current.facing || "camera",
      view: ["reference-view","front","three-quarter-left","three-quarter-right","side-left","side-right","rear","overhead"].includes(item.view) ? item.view : current.view || "reference-view",
      crop: ["none","partial-left","partial-right","partial-bottom","silhouette"].includes(item.crop) ? item.crop : current.crop || "none",
      notes: String(item.notes || current.notes || "").trim().slice(0, 400),
    });
  }
  const requestedBase = validRefs.get(source.environmentBaseKey);
  const baseKey = requestedBase?.url ? source.environmentBaseKey : fallback.environmentBaseKey || "";
  return {
    mode: source.mode === "review" ? "review" : fallback.mode || "suggest",
    summary: String(source.summary || fallback.summary || "Staging proposal ready.").trim().slice(0, 500),
    camera,
    environmentBaseKey: baseKey,
    elements: elements.length ? elements : fallback.elements || [],
    issues: [...new Set((Array.isArray(source.issues) ? source.issues : fallback.issues || []).map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 10),
    rationale: [...new Set((Array.isArray(source.rationale) ? source.rationale : fallback.rationale || []).map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 10),
    replaceLayout: source.replaceLayout == null ? !!fallback.replaceLayout : !!source.replaceLayout,
  };
}
function composerAssistSystem(mode, references) {
  const keys = (references || []).map((ref) => `${ref.key}: ${ref.label || ref.entityName || ref.role}`).join("\n");
  return [
    `You are CineBraid's ${mode === "review" ? "visual staging reviewer" : "visual staging planner"}.`,
    "Return a proposal for camera and 2D staging; do not write a final image prompt.",
    "The user's explicit frame brief and additional direction outrank imported defaults.",
    "For tight inserts, enlarge the primary action and minimize the environment.",
    "Use only the supplied referenceKey values. Never invent a reference.",
    "Do not silently remove existing elements in review mode.",
    `Available references:\n${keys || "none"}`,
    "Return ONLY JSON: {\"mode\":\"suggest|review\",\"summary\":\"\",\"camera\":{\"shotSize\":\"\",\"height\":\"\",\"angle\":\"\",\"lens\":\"\",\"view\":\"\",\"layout\":\"\",\"crop\":\"\"},\"environmentBaseKey\":\"\",\"elements\":[{\"elementId\":\"\",\"referenceKey\":\"\",\"x\":0.5,\"y\":0.5,\"w\":0.3,\"h\":0.4,\"depth\":\"midground\",\"facing\":\"camera\",\"view\":\"reference-view\",\"crop\":\"none\",\"notes\":\"\"}],\"issues\":[\"\"],\"rationale\":[\"\"],\"replaceLayout\":false}.",
  ].join("\n");
}


app.post("/api/composer/assist", async (req, res) => {
  try {
    const P = readJsonSync(DATA());
    const context = PromptEngine.buildContext(P, req.body.shotId, "");
    const references = Array.isArray(req.body.references) ? req.body.references : [];
    const composition = req.body.composition && typeof req.body.composition === "object" ? req.body.composition : context.shot.composition || {};
    const mode = req.body.mode === "review" ? "review" : "suggest";
    const options = { mode, frameBrief: String(req.body.frameBrief || ""), direction: String(req.body.direction || ""), emphasis: String(req.body.emphasis || "auto") };
    const fallback = deterministicComposerProposal(context, references, composition, options);
    let proposal = fallback, llmUsed = false, warning = "";
    if (req.body.useLLM !== false && projectAIPolicy() !== "disabled") {
      try {
        const assistant = await requestAssistantResult(
          "prompt",
          composerAssistSystem(mode, references),
          JSON.stringify({ shot: context.shot, scene: context.scene, frameBrief: options.frameBrief, additionalDirection: options.direction, currentComposition: composition, deterministicProposal: fallback }, null, 2),
          {
            label: "Staging assistant",
            maxTokens: 4200,
            provider: aiProviderOverride(),
            parse: (raw) => normalizeComposerProposal(PromptEngine.extractJsonObject(raw), fallback, references, composition),
          },
        );
        proposal = assistant.value;
        llmUsed = true;
        if (assistant.recovered) warning = `Staging assistant recovered on attempt ${assistant.attempts} of 3.`;
      } catch (error) {
        warning = `Staging assistant unavailable; showing the deterministic proposal instead. ${error.message}`;
      }
    }
    res.json({ proposal, llmUsed, warning });
  } catch (error) {
    res.status(httpStatusForError(error)).json({ error: error.message || "Could not prepare staging guidance" });
  }
});

app.post("/api/prompt/compile", async (req, res) => {
  try {
    const P = readProject();
    const profile = PromptEngine.getProfile(req.body.profileId);
    if (!profile)
      return res.status(400).json({ error: "Unknown prompt profile" });
    const purpose = req.body.purpose || (profile.mediaType === "video" ? "motion" : "first-frame");
    if (!PromptEngine.SUPPORTED_PROMPT_PURPOSES.includes(purpose))
      return res.status(400).json({ error: `Unknown prompt purpose. Accepted values: ${PromptEngine.SUPPORTED_PROMPT_PURPOSES.join(", ")}` });
    /* WHICH FRAME. Without it the compiler has only the shot, and a frame's
       declared absence cannot override shot membership because the compiler
       never learns which frame is being built (Dogfood #2 A3). Optional: a
       request that names no frame compiles exactly as it always did. */
    const context = PromptEngine.buildContext(
      P,
      req.body.shotId,
      req.body.segmentId || "",
      { frameId: String(req.body.frameId || "") },
    );
    const allBuilds = (P.shots || []).flatMap((s) =>
      resolvePromptBuildList(P, s.promptBuilds || []).map((b) => ({ ...b, shotId: s.id })),
    );
    const matchedBuilds = allBuilds.filter(
      (b) =>
        b.profileId === profile.id ||
        (b.mode === profile.mode &&
          b.profileId?.startsWith(profile.family + "/")),
    );
    context.promptExperience = {
      successfulExamples: matchedBuilds
        .filter((b) => (b.outcomeTags || []).includes("worked"))
        .slice(-3)
        .map((b) => ({
          shotId: b.shotId,
          prompt: b.prompt,
          outcomeTags: b.outcomeTags,
        })),
      commonFailureTags: [
        ...new Set(
          matchedBuilds
            .flatMap((b) => b.outcomeTags || [])
            .filter((t) => t !== "worked"),
        ),
      ].slice(0, 8),
    };
    const selectedReferencesRaw = Array.isArray(req.body.references)
      ? req.body.references
      : [];
    const selectedReferences = profile.mediaType === "video"
      ? selectedReferencesRaw.filter((ref) => !ref.blocking && !["blocking-frame", "storyboard", "animatic-frame"].includes(ref.sourceRole))
      : selectedReferencesRaw;
    const referenceSelection = generationInputReferences(
      profile,
      selectedReferences,
      req.body.allowAdditionalReferences === true,
    );
    const references = referenceSelection.references;

    const fallback = PromptEngine.defaultSpec(
      context,
      purpose,
      profile.mode,
      references,
      req.body.mediaAnalysis || null,
    );
    if (Number.isFinite(Number(req.body.durationSeconds)) && Number(req.body.durationSeconds) > 0)
      fallback.durationSeconds = Number(req.body.durationSeconds);
    if (purpose === "blocking") {
      fallback.blockingLabels = req.body.blockingLabels !== false;
      fallback.blockingEmphasis = PromptEngine.normalizeBlockingEmphasis(req.body.blockingEmphasis || "auto");
      fallback.blockingDirection = String(req.body.blockingDirection || "").trim();
    }
    const compactImageToVideoMotion =
      profile.mediaType === "video" &&
      profile.mode === "i2v" &&
      purpose === "motion";
    let spec = req.body.spec
        ? PromptEngine.validateSpec(req.body.spec, fallback)
        : fallback,
      llmUsed = false,
      llmWarning = "",
      blockingPlan = purpose === "blocking" ? PromptEngine.buildBlockingPlan(context, req.body.composition || context.shot.composition, { emphasis: req.body.blockingEmphasis, direction: req.body.blockingDirection, frameBrief: req.body.blockingFrameBrief }) : null,
      blockingImprovementNotes = [];
    const sourceDirective = String(req.body.directive || "").trim();
    const writtenDirective = PromptEngine.normalizeMotionDirective(sourceDirective);
    const suppliedAudio = req.body.audio && typeof req.body.audio === "object" ? req.body.audio : {};
    if (Object.keys(suppliedAudio).length) {
      const requestedLine = String(suppliedAudio.line || suppliedAudio.dialogue || "");
      const requestedSpeakerId = String(suppliedAudio.speakerId || fallback.audio?.speakerId || "");
      const requestedVoiceEntityId = String(suppliedAudio.voiceEntityId || fallback.audio?.voiceEntityId || "");
      const speaker = (P.characters || []).find((item) => String(item.id || "") === requestedSpeakerId) || null;
      const voiceEntity = (P.audio || []).find((item) => String(item.id || "") === requestedVoiceEntityId) || null;
      const canonicalVoice = voiceEntity?.sameObjectAs
        ? (P.audio || []).find((item) => String(item.id || "") === String(voiceEntity.sameObjectAs)) || null
        : null;
      const voiceRelationship = voiceEntity?.sameObjectAs
        ? `${voiceEntity.name || voiceEntity.id} is the same source voice as ${canonicalVoice?.name || voiceEntity.sameObjectAs}${voiceEntity.role ? ` (${voiceEntity.role})` : ""}`
        : "";
      fallback.audio = {
        ...fallback.audio,
        ...suppliedAudio,
        dialogue: requestedLine,
        speakerId: requestedSpeakerId,
        speakerName: String(speaker?.name || requestedSpeakerId),
        voiceEntityId: requestedVoiceEntityId,
        voiceEntityName: String(voiceEntity?.name || requestedVoiceEntityId),
        voiceDesign: String(speaker?.audio?.voiceDesignPrompt || fallback.audio?.voiceDesign || ""),
        voiceRelationship,
        cleanMaster: !!voiceEntity?.cleanMaster || !!canonicalVoice?.cleanMaster,
      };
      spec.audio = { ...fallback.audio };
    }
    const suppliedMotionBrief = req.body.motionBrief && typeof req.body.motionBrief === "object" ? req.body.motionBrief : null;
    if (suppliedMotionBrief) {
      fallback.motionBrief = suppliedMotionBrief;
      spec = PromptEngine.applyMotionAudioBrief(spec, suppliedMotionBrief);
    }
    const meaningfulAudioContext = String(req.body.audioContext || "")
      .split(/\r?\n/)
      .filter((line) => !/^\s*Synchronization:\s*(?:natural|none)\s*$/i.test(line))
      .join("\n")
      .trim();
    const hasAudioIntent = [
      suppliedAudio.dialogue,
      suppliedAudio.sfx,
      suppliedAudio.ambience,
      meaningfulAudioContext,
      suppliedMotionBrief?.dialogue?.line,
      suppliedMotionBrief?.sound?.ambience,
      suppliedMotionBrief?.sound?.music,
      ...(Array.isArray(suppliedMotionBrief?.sound?.sfxEvents) ? suppliedMotionBrief.sound.sfxEvents.map((item) => item?.event || "") : []),
    ].some((value) => String(value || "").trim()) || selectedReferences.some((ref) => ["audio-timing", "sound-reference"].includes(ref.role));
    let effectiveDirective = writtenDirective,
      improvedDirective = "",
      improvementNotes = [];
    if (
      profile.mediaType === "video" &&
      purpose === "motion" &&
      writtenDirective &&
      req.body.improveMotion === true &&
      projectAIPolicy() !== "disabled"
    ) {
      try {
        const assistant = await requestAssistantResult(
          "prompt",
          motionImproveSystem(profile, hasAudioIntent),
          JSON.stringify({
            original: writtenDirective,
            audioContext: hasAudioIntent ? meaningfulAudioContext : "",
            intensity: req.body.motionIntensity || "subtle",
            preserveComposition: req.body.preserveComposition !== false,
            durationSeconds: spec.durationSeconds,
            profile: { id: profile.id, family: profile.family, mode: profile.mode, strategy: profile.strategy },
            motionBrief: suppliedMotionBrief,
            locked: {
              dialogue: suppliedMotionBrief?.dialogue?.locked !== false ? suppliedMotionBrief?.dialogue?.line || "" : "",
              speakerId: suppliedMotionBrief?.dialogue?.speakerId || "",
              voiceDesign: suppliedMotionBrief?.dialogue?.voiceDesign || fallback.audio?.voiceDesign || "",
              durationSeconds: spec.durationSeconds,
              startFrameRole: profile.mode === "i2v" || profile.mode === "flf" ? "approved start frame" : "",
              endFrameRole: profile.mode === "flf" ? "approved end frame" : "",
            },
          }),
          {
            label: "Motion prompt advisor",
            maxTokens: 2200,
            provider: aiProviderOverride(),
            parse: (raw) => parseAssistantMotionRevision(raw, profile),
          },
        );
        const parsed = assistant.value;
        improvedDirective = PromptEngine.deterministicMotionRevision(
          profile,
          hasAudioIntent ? parsed.directive : removeUnsuppliedAudioClaims(parsed.directive),
        );
        improvementNotes = parsed.changes;
        if (!improvedDirective || improvedDirective.replace(/\s+/g, " ").toLowerCase() === writtenDirective.replace(/\s+/g, " ").toLowerCase()) {
          improvedDirective = PromptEngine.deterministicMotionRevision(profile, writtenDirective);
          improvementNotes.push("The assistant did not materially improve the motion brief, so CineBraid kept a cleaned deterministic revision.");
        }
        effectiveDirective = improvedDirective;
        llmUsed = true;
        if (assistant.recovered) improvementNotes.unshift(`Assistant recovered on attempt ${assistant.attempts} of 3.`);
      } catch (e) {
        improvedDirective = PromptEngine.deterministicMotionRevision(profile, writtenDirective);
        effectiveDirective = improvedDirective;
        improvementNotes = ["The assistant response could not be used; CineBraid recovered and cleaned the original motion intent before compiling it."];
        llmWarning = `Assistant motion rewrite unavailable; compiled the cleaned motion direction instead. ${e.message}`;
      }
    }
    if (purpose === "blocking" && req.body.improveBlocking === true) {
      if (projectAIPolicy() !== "disabled") {
        try {
          const assistant = await requestStrictAssistantJson(
            blockingImproveSystem(profile),
            compactBlockingImprovePayload(context, req, blockingPlan),
            { label: "Blocking assistant", maxTokens: 2600, provider: aiProviderOverride() },
          );
          blockingPlan = PromptEngine.normalizeBlockingPlan(assistant.value, blockingPlan);
          blockingPlan.source = "assistant";
          blockingImprovementNotes = blockingPlan.conflictsResolved || [];
          llmUsed = true;
        } catch (error) {
          llmWarning = `Blocking prompt is ready. Assistant refinement did not return usable structured output, so CineBraid used its deterministic structural plan. You can generate the blocking frame now. Details: ${error.message}`;
        }
      } else {
        llmWarning = "Blocking prompt is ready. Assistant refinement is disabled, so CineBraid used its deterministic structural plan. You can generate the blocking frame now.";
      }
    }
    if (profile.mediaType === "image" && effectiveDirective && !req.body.spec) {
      spec.actions = [{ start: 0, end: 1, action: effectiveDirective }];
      spec.initialState.subject = [spec.initialState.subject, effectiveDirective]
        .filter(Boolean)
        .join("\n");
    }
    if (profile.mediaType === "video" && purpose === "motion" && effectiveDirective) {
      spec.actions = [
        {
          start: 0,
          end: spec.durationSeconds,
          action: effectiveDirective,
        },
      ];
      if (hasAudioIntent)
        spec.audio = { ...spec.audio, ...suppliedAudio };
      else
        spec.audio = { dialogue: "", sfx: "", ambience: "" };
      if (req.body.motionIntensity)
        spec.performance = { ...spec.performance, movementIntensity: String(req.body.motionIntensity).replace(/-/g, " ") };
      if (hasAudioIntent && req.body.motionSync && !["none", "natural"].includes(req.body.motionSync))
        spec.audio = { ...spec.audio, ambience: [spec.audio?.ambience, `Synchronization: ${req.body.motionSync}`].filter(Boolean).join(". ") };
    }
    if (
      !compactImageToVideoMotion &&
      !req.body.spec &&
      req.body.improveMotion !== true &&
      req.body.improveBlocking !== true &&
      req.body.useLLM !== false &&
      projectAIPolicy() !== "disabled"
    ) {
      try {
        const assistant = await requestAssistantResult(
          "prompt",
          PromptEngine.buildSpecSystem(profile),
          PromptEngine.buildSpecUser(
            context,
            profile,
            purpose,
            profile.mode,
            references,
            req.body.mediaAnalysis || null,
            effectiveDirective || "",
          ),
          {
            label: `${purpose === "motion" ? "Motion" : "Frame"} prompt advisor`,
            maxTokens: 7000,
            provider: aiProviderOverride(),
            parse: (raw) => PromptEngine.validateSpec(PromptEngine.extractJsonObject(raw), fallback),
          },
        );
        spec = assistant.value;
        llmUsed = true;
        if (assistant.recovered) llmWarning = `Assistant recovered on attempt ${assistant.attempts} of 3.`;
      } catch (e) {
        llmWarning =
          "Local planning model unavailable; compiled from deterministic project context instead. " +
          e.message;
      }
    }
    spec = PromptEngine.applyStructuredDirection(spec, req.body.composition || context.shot.composition, purpose === "motion" ? (req.body.motionPlan || context.shot.motionPlan) : null, references);
    if (suppliedMotionBrief) spec = PromptEngine.applyMotionAudioBrief(spec, suppliedMotionBrief);
    if (purpose === "blocking") spec = PromptEngine.applyBlockingPlan(spec, context, req.body.composition || context.shot.composition, { emphasis: req.body.blockingEmphasis, direction: req.body.blockingDirection, frameBrief: req.body.blockingFrameBrief, plan: blockingPlan });
    const compiled = PromptEngine.compile(profile, spec, references);
    /* THE CONTRADICTION CHECK, at the last point where the compiled text exists
       and no provider has been asked for anything.

       CineBraid's own positive lists have already had the absent entity removed,
       so a finding here means the CREATOR's frame direction still states the
       entity positively — which is a real disagreement between two things the
       creator wrote, and the only honest resolution is to say so rather than to
       silently pick one. The compiled result is returned so they can see exactly
       what would have been sent. */
    const presenceContradictions = FramePresence.framePresenceContradictions({
      absentEntities: spec.framePresence?.absent || [],
      spec,
      prompt: compiled.prompt,
    });
    if (presenceContradictions.length) {
      return res.status(409).json({
        error: `This frame declares ${presenceContradictions.map((item) => item.entityName).filter((name, index, all) => all.indexOf(name) === index).join(", ")} absent, but the compiled prompt still describes ${presenceContradictions.length === 1 ? "it" : "them"} as present. Nothing was sent to a provider.`,
        code: "FRAME_PRESENCE_CONTRADICTION",
        contradictions: presenceContradictions,
        framePresence: spec.framePresence,
        compiledPrompt: compiled.prompt,
      });
    }
    if (referenceSelection.warnings.length)
      compiled.warnings.unshift(...referenceSelection.warnings);
    if (referenceSelection.dropped.length)
      compiled.confirmations.unshift(
        `${profile.mode.toUpperCase()} input policy kept ${references.length} required provider input${references.length === 1 ? "" : "s"} and left ${referenceSelection.dropped.length} linked reference${referenceSelection.dropped.length === 1 ? "" : "s"} as planning context only.`,
      );
    if (compactImageToVideoMotion && req.body.improveMotion !== true && req.body.useLLM !== false)
      compiled.confirmations.unshift(
        "I2V prompt compiled directly from the written motion direction to prevent LLM over-description.",
      );
    if (req.body.improveMotion === true && improvedDirective)
      compiled.confirmations.unshift(`Motion direction was rewritten for ${profile.name} before compilation.`);
    /* Say what was withheld. A creator whose shot description disappeared from a
       frame prompt deserves the reason rather than a shorter prompt. */
    for (const withheld of spec.framePresence?.withheldNarrative || []) {
      compiled.confirmations.unshift(
        `${withheld.field} was withheld from this frame because it describes ${withheld.entityIds.join(", ")}, which this frame declares absent. The frame's own description is the authority here.`,
      );
    }
    if (llmWarning) compiled.warnings.unshift(llmWarning);
    res.json({
      profile,
      spec,
      framePresence: spec.framePresence || null,
      compiledPrompt: compiled.prompt,
      warnings: compiled.warnings,
      confirmations: compiled.confirmations,
      productionRisks: spec.productionRisks || [],
      providerPayload: compiled.payload,
      references: compiled.references || references,
      referencePolicy:
        profile.mode === "i2v"
          ? "first-frame-only"
          : profile.mode === "flf"
            ? "first-and-last-only"
            : "profile-selected",
      llmUsed,
      originalDirective: writtenDirective,
      sourceDirectiveSanitized: sourceDirective !== writtenDirective,
      improvedDirective,
      improvementNotes,
      motionBrief: suppliedMotionBrief || null,
      lockedFields: suppliedMotionBrief ? ["dialogue.line", "dialogue.speakerId", "dialogue.voiceDesign", "durationSeconds", "frame roles"] : [],
      blockingPlan: spec.blockingPlan || null,
      blockingImprovementNotes,
      compilerVersion: "3.0.0",
      promptStyle: compactImageToVideoMotion
        ? `compact-${profile.family}-i2v`
        : profile.mode === "flf"
          ? `compact-${profile.family}-flf`
          : "model-aware",
      sourceContext: {
        shotId: context.shot.parentShotId || context.shot.id,
        segmentId: context.shot.segmentId || "",
        sceneId: context.scene.id,
        profileId: profile.id,
        profileVersion: profile.profileVersion,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    res.status(httpStatusForError(e)).json({ error: e.message });
  }
});

app.post("/api/prompt/critique", async (req, res) => {
  try {
    const profile = PromptEngine.getProfile(req.body.profileId);
    if (!profile)
      return res.status(400).json({ error: "Unknown prompt profile" });
    const deterministic = PromptEngine.checks(
      profile,
      req.body.spec || {},
      req.body.references || [],
    );
    let review = {
      issues: deterministic.warnings,
      strengths: deterministic.confirmations,
      revisedPrompt: "",
    };
    if (projectAIPolicy() !== "disabled") {
      try {
        const system = `You are a strict production prompt critic for ${profile.name}. Review the prompt against the supplied profile rules, shot specification and reference roles. Return ONLY JSON: {"issues":[""],"strengths":[""],"revisedPrompt":""}. Preserve canon. Do not add story content. Revise only when it improves model compatibility, chronology, reference clarity or continuity.`;
        const assistant = await requestAssistantResult(
          "critic",
          system,
          JSON.stringify(
            {
              profile,
              prompt: req.body.prompt || "",
              spec: req.body.spec || {},
              references: req.body.references || [],
            },
            null,
            2,
          ),
          {
            label: "Prompt advisor",
            maxTokens: 5000,
            provider: aiProviderOverride(),
            parse: (raw) => PromptEngine.extractJsonObject(raw),
          },
        );
        const parsed = assistant.value;
        review = {
          issues: Array.isArray(parsed.issues)
            ? parsed.issues.map(String)
            : deterministic.warnings,
          strengths: Array.isArray(parsed.strengths)
            ? parsed.strengths.map(String)
            : deterministic.confirmations,
          revisedPrompt: String(parsed.revisedPrompt || ""),
        };
      } catch (e) {
        review.issues = [
          ...review.issues,
          "Local critic unavailable: " + e.message,
        ];
      }
    }
    res.json(review);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---- local LLM: prompt drafting (suggest-only — returns variants, writes nothing) ---- */
const DRAFT_SYSTEM = [
  "You draft image-generation prompt variants for a film production run under the Anchor Method.",
  "You receive a BASE PROMPT containing reference-role lines and LOCKED style/continuity blocks.",
  "Reproduce every reference line and every locked block VERBATIM and in place.",
  "Vary ONLY the action, composition, and atmosphere language.",
  "Respond with ONLY a JSON array of exactly 3 full prompt strings:",
  "1. Tighter, more minimal action language.",
  "2. Atmosphere-forward language focused on light, texture, and air.",
  "3. An alternate coverage idea for the same story beat, with the different angle or framing stated in the prompt.",
  "No prose and no markdown fences.",
].join("\n");
app.post("/api/llm/draft", async (req, res) => {
  try {
    const assistant = await requestAssistantResult(
      "draft",
      DRAFT_SYSTEM,
      "SHOT: " +
        (req.body.title || "") +
        "\nBEAT: " +
        (req.body.beat || "") +
        "\n\nBASE PROMPT:\n" +
        (req.body.base || ""),
      {
        label: "Prompt variant advisor",
        maxTokens: 6000,
        provider: aiProviderOverride(),
        parse: (raw) => {
          const clean = raw.replace(/^```(json)?/m, "").replace(/```\s*$/m, "").trim();
          const variants = JSON.parse(clean);
          if (!Array.isArray(variants)) throw new Error("bad variant shape");
          return variants;
        },
      },
    );
    const variants = assistant.value;
    res.json({ variants: variants.slice(0, 3).map(String) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


/* ---- scene audio prompt builder: model-ready music + ambience directions ---- */
const SCENE_AUDIO_PROMPT_SYSTEM = `You are the audio prompt designer for a film production workspace. Convert the supplied scene intent into four editable production outputs while preserving the user's story, mood, chronology, and exclusions. Do not invent dialogue, lyrics, instruments, genres, or story events that contradict the supplied material.

Return ONLY valid JSON with this exact shape:
{"elevenLabsPrompt":"","sunoPrompt":"","ambiencePrompt":"","audioNotes":"","summary":"","changes":[""],"warnings":[""]}

ELEVEN MUSIC PROMPT:
- Natural-language music direction suitable for Eleven Music.
- Include genre/style when supported, emotional tone, instrumentation, texture, tempo or pace, structural arc, intended scene use, and whether it is instrumental only.
- Include useful exclusions such as no vocals, no heroic melody, no trailer percussion, or no abrupt ending when the source supports them.
- Prefer specific, coherent direction over a long list of disconnected tags.

SUNO PROMPT:
- A concise but conversational style-of-music description suitable for Custom Mode.
- State instrumental-only when vocals are not explicitly requested.
- Include genre/style, mood, instrumentation, energy/tempo, and the beginning-to-ending arc.
- Do not imitate or name living artists.

AMBIENCE / SFX BED:
- Describe non-musical room tone, diegetic machinery, environmental textures, transition cues, silence, and recurring sound motifs.
- Keep it separate from the score and make chronology clear when the scene has state changes.

AUDIO NOTES:
- Give mix priorities, motif continuity, diegetic-versus-score guidance, dialogue ducking, silence requirements, and handoff notes for an editor.

If the source is too vague, create a restrained useful draft and put the uncertainty in warnings. Never add vocals or lyrics unless they are explicitly requested.`;
app.post("/api/llm/build-scene-audio-prompts", async (req, res) => {
  try {
    const P = readJsonSync(DATA());
    const sceneId = String(req.body?.sceneId || "").trim();
    const scene = (P.scenes || []).find((item) => String(item.id) === sceneId);
    if (!scene) return res.status(404).json({ error: "Scene not found" });
    const shots = (P.shots || []).filter((shot) => String(shot.scene) === sceneId);
    const shotAudio = shots.map((shot) => {
      const audio = shot.audio || {};
      const pieces = [
        audio.line ? `Dialogue (${audio.speakerId || "speaker"}): ${audio.line}` : "",
        audio.emotion ? `Emotion: ${audio.emotion}` : "",
        audio.delivery ? `Delivery: ${audio.delivery}` : "",
        audio.sfx ? `SFX: ${typeof audio.sfx === "string" ? audio.sfx : JSON.stringify(audio.sfx)}` : "",
        audio.ambience ? `Ambience: ${audio.ambience}` : "",
        audio.music ? `Music: ${audio.music}` : "",
        audio.sync ? `Sync: ${audio.sync}` : "",
      ].filter(Boolean);
      return pieces.length ? `${shot.id} · ${shot.title || "Untitled shot"}\n${pieces.join("\n")}` : "";
    }).filter(Boolean);
    const source = {
      scene: { id: scene.id, title: scene.title || "", beat: scene.whatHappens || "", feel: scene.howItFeels || "", durationSeconds: shots.reduce((sum, shot) => sum + shotListDurationSeconds(shot), 0) },
      sourceDirection: String(req.body?.sourceDirection || ""),
      existing: req.body?.existing || scene.audio || {},
      shotAudio,
      world: P.meta?.world || {},
    };
    const assistant = await requestAssistantResult(
      "scene-audio-prompts",
      SCENE_AUDIO_PROMPT_SYSTEM,
      JSON.stringify(source, null, 2),
      {
        label: "Scene audio prompt builder",
        maxTokens: 3200,
        provider: aiProviderOverride(),
        parse: (raw) => {
          const parsed = PromptEngine.extractJsonObject(raw);
          if (!parsed || typeof parsed !== "object") throw new Error("assistant returned an invalid audio prompt package");
          for (const key of ["elevenLabsPrompt", "sunoPrompt", "ambiencePrompt", "audioNotes"]) {
            if (!String(parsed[key] || "").trim()) throw new Error(`assistant omitted ${key}`);
          }
          return {
            elevenLabsPrompt: String(parsed.elevenLabsPrompt).trim(),
            sunoPrompt: String(parsed.sunoPrompt).trim(),
            ambiencePrompt: String(parsed.ambiencePrompt).trim(),
            audioNotes: String(parsed.audioNotes).trim(),
            summary: String(parsed.summary || "Model-ready scene audio prompts created.").trim(),
            changes: Array.isArray(parsed.changes) ? parsed.changes.map(String).filter(Boolean).slice(0, 10) : [],
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).filter(Boolean).slice(0, 10) : [],
          };
        },
      },
    );
    return res.json({ ok: true, result: assistant.value });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Scene audio prompt building failed" });
  }
});

/* ---- vision review: adaptive batches for reliable local/cloud triage ---- */
const REVIEW_BATCH_SYSTEM = `You are a continuity and quality reviewer for an AI film production. Review ONLY the supplied candidate images against the canon criteria. Candidate IDs may not start at 1. Use the exact candidate IDs supplied. You are triage, not the final director. Be concrete and terse. Return ONLY valid JSON, no fences:
{"reviews":[{"n":1,"pass":true,"score":85,"notes":"specific visible findings"}]}
Score 0-100 for overall suitability. Do not rank candidates that are not in this batch.`;
const REVIEW_FINAL_SYSTEM = `You are making a final comparison between a small set of finalist images for an AI film production. Use the exact original candidate IDs supplied. Compare the images directly against canon and against each other. You are triage, not the final director. Return ONLY valid JSON, no fences:
{"reviews":[{"n":1,"pass":true,"score":90,"notes":"specific concise findings"}],"ranking":[1],"suggested":1,"rationale":"one sentence"}`;
const IMG_ONLY = (f) => /\.(png|jpe?g|webp)$/i.test(f);
const REVIEW_BATCH_SIZE = 4;
const REVIEW_MAX_FILES = 24;
function cleanModelJson(raw) {
  return String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}
function parseReviewJson(raw) {
  try {
    return JSON.parse(cleanModelJson(raw));
  } catch {
    return null;
  }
}
function normalizeReviewItems(parsed, ids, fillMissing = true) {
  const rows = Array.isArray(parsed?.reviews) ? parsed.reviews : [];
  const used = new Set();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    let n = Number(row.n);
    if (!ids.includes(n) && n >= 1 && n <= ids.length) n = ids[n - 1];
    if (!ids.includes(n) || used.has(n)) continue;
    used.add(n);
    const explicitPass = typeof row.pass === "boolean";
    const explicitScore = row.score !== null && row.score !== "" && typeof row.score !== "undefined" && Number.isFinite(Number(row.score));
    const score = Math.max(0, Math.min(100, explicitScore ? Number(row.score) : 0));
    out.push({
      n,
      pass: row.pass === true,
      explicitPass,
      explicitScore,
      score,
      notes: String(row.notes || (explicitPass ? "No specific note returned." : "The vision model omitted an explicit pass/fail decision.")).trim(),
    });
  }
  if (fillMissing)
    for (const n of ids)
      if (!used.has(n))
        out.push({
          n,
          pass: false,
          explicitPass: false,
          explicitScore: false,
          score: 0,
          notes:
            "The vision model did not return a structured assessment for this candidate.",
        });
  return out;
}
function normalizeRanking(xs, ids) {
  const out = [];
  for (const x of Array.isArray(xs) ? xs : []) {
    let n = Number(x);
    if (!ids.includes(n) && n >= 1 && n <= ids.length) n = ids[n - 1];
    if (ids.includes(n) && !out.includes(n)) out.push(n);
  }
  return out;
}
function reviewCriteria(P, kind, list, id, frameId = "") {
  let files = [],
    criteria = [],
    title = id;
  if (kind === "entity") {
    const e = (P[list] || []).find((x) => x.id === id);
    if (!e) throw Object.assign(new Error("not found"), { status: 404 });
    const type = { characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" }[
      list
    ];
    const dir = path.join(ownedProjectDir(req), type);
    /* THE SERVER SIDE OF DOGFOOD #2 A4. This filtered the directory by
       `f.toUpperCase().startsWith(prefix)`, so the batch reviewer admitted every
       `CHAR-SWEEP-YOUNG…` file into `CHAR-SWEEP`'s review exactly as the browser
       pool did. Repairing only the client would have left the server able to
       write the same wrong-owner review, which is the fifth thing the forensic
       audit says Dogfood #2 missed. One rule, both sides. */
    const ownerIndex = EntityOwnership.buildEntityOwnerIndex(P, list);
    files = EntityOwnership.filterEntityFileNames(
      ownerIndex,
      e.id,
      (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => IMG_ONLY(f)),
    )
      .sort()
      .map((f) => path.join(dir, f));
    criteria = [
      e.block ? "IDENTITY (must match exactly): " + e.block : "",
      e.driftNotes ? "DRIFT-PRONE (verify each): " + e.driftNotes : "",
      e.notes ? "NOTES: " + e.notes : "",
      P.meta.world?.setting ? "WORLD/ERA: " + P.meta.world.setting : "",
      P.meta.world?.reject ? "MUST NOT CONTAIN: " + P.meta.world.reject : "",
    ];
  } else if (kind === "blocking") {
    const s = P.shots.find((x) => x.id === id);
    if (!s) throw Object.assign(new Error("not found"), { status: 404 });
    const creation = s.creationBrief || {};
    const resolved = resolveShotEntities(P, s);
    const chars = resolved.characters;
    const props = resolved.props;
    const location = resolved.locations.find((item) => item.id === creation.locationId) || resolved.locations[0] || null;
    const frame = frameId ? (s.keyframes || []).find((item) => String(item.id) === String(frameId)) || (s.keyframes || [])[0] : (s.keyframes || [])[0] || null;
    const frameState = frame ? (creation.frameWorkflows || {})[frame.id] || {} : {};
    const frameDirection = [
      frameState.action || frame?.description || s.desc || "",
      frameState.staging || s.positioning || "",
      frameState.camera || "",
      frameState.notes || "",
    ].filter(Boolean);
    files = (P.mediaAssets || [])
      .filter((asset) => (asset.links || []).some((link) => String(link.targetType) === "shot" && String(link.targetId) === id && String(link.role) === "blocking-frame" && (!frameId || !link.blockingFrameId || String(link.blockingFrameId) === String(frameId))))
      .map((asset) => projectAssetPath(asset.storagePath || (asset.file ? `media/${asset.file}` : "")))
      .filter((file) => file && fs.existsSync(file) && IMG_ONLY(path.basename(file)));
    criteria = [
      `BLOCKING REVIEW TARGET: ${s.title || s.id}`,
      frame ? `PRIMARY FRAME ${frame.label || "A"} MUST MATCH: ${frameDirection[0] || "Match the planned shot frame."}` : `SHOT ACTION MUST MATCH: ${s.desc || ""}`,
      frameDirection.slice(1).length ? "STAGING / CAMERA / CONTACT POINTS: " + frameDirection.slice(1).join(" | ") : "",
      location ? `LOCATION TO HONOR: ${location.name || location.id} · ${location.notes || location.block || location.description || "Use the approved location only as a layout authority."}` : "",
      ...chars.map((c) => `CHARACTER POSITION / SCALE AUTHORITY: ${c.name || c.id} · ${c.block || c.notes || "approved identity"}`),
      ...props.map((prop) => `PROP POSITION / SCALE AUTHORITY: ${prop.name || prop.id} · ${prop.notes || prop.block || prop.description || "approved prop design"}`),
      "REVIEW PRIORITY: camera angle, crop, spacing, silhouette readability, pose, relative scale, depth staging, and contact points.",
      "IGNORE: finished materials, texture quality, location-decoration drift, or final style polish unless they harm the blocking usefulness.",
    ];
    title = `${id} blocking`;
  } else {
    const s = P.shots.find((x) => x.id === id);
    if (!s) throw Object.assign(new Error("not found"), { status: 404 });
    const dir = path.join(PROJECT_DIR(), "shots", id, "takes");
    const disk = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(
      IMG_ONLY,
    );
    const metadataOrder = (s.candidateFiles || [])
      .map((x) => x.stored || x.name)
      .filter(Boolean);
    const ordered = [
      ...metadataOrder.filter((n) => disk.includes(n)),
      ...disk.filter((n) => !metadataOrder.includes(n)).sort(),
    ];
    files = ordered.map((f) => path.join(dir, f));
    const resolved = resolveShotEntities(P, s);
    const chars = resolved.characters;
    const creation = s.creationBrief || {};
    const frame = frameId ? (s.keyframes || []).find((item) => item.id === frameId) : (s.keyframes || [])[0];
    const frameState = frame ? (creation.frameWorkflows || {})[frame.id] || {} : {};
    const props = resolved.props;
    const location = resolved.locations.find((item) => item.id === creation.locationId) || resolved.locations[0] || null;
    const frameDirection = [frameState.action || frame?.description || s.desc || "", frameState.staging || (frame === (s.keyframes || [])[0] ? s.positioning || "" : ""), frameState.camera || "", frameState.notes || ""].filter(Boolean);
    criteria = [
      `SHOT: ${s.title || s.id}`,
      frame ? `FRAME ${frame.label || "A"} REQUIREMENT: ${frameDirection[0] || "Match the planned shot frame."}` : "SHOT REQUIREMENT: " + (s.desc || ""),
      frameDirection.slice(1).length ? "ADDITIONAL DIRECTION / CAMERA / CONTACT: " + frameDirection.slice(1).join(" | ") : "",
      location ? `LOCATION ${location.name || location.id} MUST MATCH: ${location.notes || location.block || location.description || "approved location design and geometry"}` : "",
      ...chars.map((c) => `CHARACTER ${c.name || c.id} MUST MATCH: ${c.block || c.notes || "approved identity"}${c.driftNotes ? ` | DRIFT RISKS: ${c.driftNotes}` : ""}`),
      ...props.map((prop) => `PROP ${prop.name || prop.id} MUST MATCH: ${prop.notes || prop.block || prop.description || "approved prop design, scale, materials, and state"}`),
      P.meta.world?.setting ? "WORLD / ERA: " + P.meta.world.setting : "",
      P.meta.world?.reject ? "MUST NOT CONTAIN: " + P.meta.world.reject : "",
      (s.risks || []).length ? "KNOWN RISKS: " + s.risks.join("; ") : "",
      "QC CHECKLIST: " + (P.qcChecklist || []).join(" | "),
    ];
  }
  return { files, criteria: criteria.filter(Boolean), title };
}
app.post("/api/llm/review", async (req, res) => {
  try {
    const visionProvider = aiVisionProviderOverride();
    const P = readJsonSync(DATA());
    const { kind, list, id, frameId } = req.body || {};
    const source = reviewCriteria(P, kind, list, id, frameId || "");
    const requestedNames = Array.isArray(req.body?.fileNames)
      ? [...new Set(req.body.fileNames.map((name) => path.basename(String(name))))].slice(0, REVIEW_MAX_FILES)
      : [];
    if (requestedNames.length) {
      const allowed = new Set(requestedNames);
      source.files = source.files.filter((file) => allowed.has(path.basename(file)));
    }
    const totalFiles = source.files.length;
    const files = source.files.slice(0, REVIEW_MAX_FILES);
    if (!files.length)
      return res.status(400).json({ error: "no candidate images on disk" });
    const names = files.map((f) => path.basename(f));
    const criteriaText = source.criteria.join("\n");
    const aggregate = [];
    const batches = [];

    for (let offset = 0; offset < files.length; offset += REVIEW_BATCH_SIZE) {
      const batchFiles = files.slice(offset, offset + REVIEW_BATCH_SIZE);
      const ids = batchFiles.map((_, i) => offset + i + 1);
      const batchNames = batchFiles.map((f) => path.basename(f));
      const images = batchFiles.map((f) =>
        fs.readFileSync(f).toString("base64"),
      );
      const assistant = await requestVisionResult(
        REVIEW_BATCH_SYSTEM,
        "CANDIDATE IDS / IMAGE ORDER:\n" +
          batchNames.map((n, i) => ids[i] + " = " + n).join("\n") +
          "\n\nCRITERIA:\n" +
          criteriaText,
        images,
        {
          label: "Candidate review assistant",
          maxTokens: 1800,
          provider: visionProvider,
          parse: (raw) => {
            const parsed = parseReviewJson(raw);
            if (!parsed) throw new Error("vision model returned an unstructured review");
            return normalizeReviewItems(parsed, ids);
          },
        },
      );
      const reviews = assistant.value;
      aggregate.push(...reviews);
      batches.push({ ids, count: ids.length });
    }

    const preliminary = [...aggregate].sort(
      (a, b) =>
        b.score - a.score || (b.pass ? 1 : 0) - (a.pass ? 1 : 0) || a.n - b.n,
    );
    const finalistIds = preliminary
      .slice(0, Math.min(REVIEW_BATCH_SIZE, preliminary.length))
      .map((x) => x.n);
    let finalParsed = null;
    if (finalistIds.length > 1) {
      const finalistFiles = finalistIds.map((n) => files[n - 1]);
      const finalistImages = finalistFiles.map((f) =>
        fs.readFileSync(f).toString("base64"),
      );
      const prior = finalistIds
        .map((n) => {
          const x = aggregate.find((r) => r.n === n);
          return `${n} = ${names[n - 1]} | preliminary ${x?.score || 0}/100 | ${x?.notes || ""}`;
        })
        .join("\n");
      const assistant = await requestVisionResult(
        REVIEW_FINAL_SYSTEM,
        "FINALIST IDS / IMAGE ORDER:\n" +
          finalistIds
            .map((n, i) => `${n} = ${path.basename(finalistFiles[i])}`)
            .join("\n") +
          "\n\nPRELIMINARY OBSERVATIONS:\n" +
          prior +
          "\n\nCRITERIA:\n" +
          criteriaText,
        finalistImages,
        {
          label: "Finalist review assistant",
          maxTokens: 2200,
          provider: visionProvider,
          parse: (raw) => {
            const parsed = parseReviewJson(raw);
            if (!parsed) throw new Error("vision model returned an unstructured finalist review");
            return parsed;
          },
        },
      );
      finalParsed = assistant.value;
    }

    const finalReviews = finalParsed
      ? normalizeReviewItems(finalParsed, finalistIds, false)
      : [];
    const merged = aggregate
      .map((x) => finalReviews.find((y) => y.n === x.n) || x)
      .sort((a, b) => a.n - b.n);
    let ranking = finalParsed
      ? normalizeRanking(finalParsed.ranking, finalistIds)
      : [];
    if (!ranking.length) ranking = preliminary.map((x) => x.n);
    for (const x of preliminary.map((x) => x.n))
      if (!ranking.includes(x)) ranking.push(x);
    let suggested = Number(finalParsed?.suggested);
    if (
      !finalistIds.includes(suggested) &&
      suggested >= 1 &&
      suggested <= finalistIds.length
    )
      suggested = finalistIds[suggested - 1];
    if (!finalistIds.includes(suggested)) suggested = ranking[0];
    const rationale = String(
      finalParsed?.rationale ||
        `Compared ${files.length} candidates in ${batches.length} small batch${batches.length === 1 ? "" : "es"} and rechecked the strongest finalists.`,
    );
    res.json({
      files: names,
      review: { reviews: merged, ranking, suggested, rationale },
      strategy: {
        mode:
          files.length > REVIEW_BATCH_SIZE
            ? "batched-finalists"
            : "small-batch",
        batchSize: REVIEW_BATCH_SIZE,
        batches: batches.length,
        finalists: finalistIds,
        reviewed: files.length,
        total: totalFiles,
        omitted: Math.max(0, totalFiles - files.length),
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});


const DERIVED_FRAME_REVIEW_SYSTEM = `You are reviewing dependent still frames for an AI filmmaking workflow. The first images are candidate outputs and have explicit candidate IDs. Later images are labelled CONTEXT and are not candidates. Compare each candidate to the target frame brief and to the approved parent frame, blocking guide, and appearance references. Preserve identity, location, camera logic, lighting continuity, and every unchanged feature from the parent. Require the requested action/state change to be clearly visible. For start/end-frame workflows, judge whether the image is a clean, plausible endpoint for motion interpolation. Return ONLY valid JSON, no markdown fences:
{"reviews":[{"n":1,"pass":true,"score":85,"notes":"specific continuity and endpoint findings"}],"ranking":[1],"suggested":1,"rationale":"one sentence"}`;

/* The approved image that IS a given entity state's authority, or "" for none.
   Read-only: it looks at disk and at the project record and writes to neither.

   `state?.approvedFile || entity.approvedFile` used to end this function, and
   that `||` was a silent substitution. A frame that declares "Rhea is
   rain-soaked" resolves the rain-soaked state correctly, finds it has no
   approved reference of its own, and then received the CLEAN image as its
   character identity authority — the exact wrong-authority generation P4-SEM-B
   set out to make impossible, one layer below where PR #58 fixed the preflight.

   Continuity.stateApprovedFile() owns the rule now, shared with the browser
   preflight and the browser reference package so the three cannot drift. What
   remains here is resolving WHICH state record answers, and it deliberately
   matches resolveStateRecord(): an id naming no state on this entity falls to
   the entity's default rather than to nothing, because a binding that names a
   state the entity does not declare is the format layer's `disputed` statement
   to report, not this function's to enforce — and the automation preflight
   reads it the same way. A declared non-default state that simply has no
   approved file is a different thing entirely, and that one answers "". */
/* THE LITERAL STAYS INLINE, AND THAT IS NOT AN OVERSIGHT. Three suites lift this
   declaration out of server.js and evaluate it in a sandbox, on purpose, so that
   they exercise the shipped rule rather than a copy of it. A module-level constant
   referenced here is not in that sandbox's scope, and hoisting it turns every one
   of those proofs into a ReferenceError — a control that fails for the wrong
   reason is a control that has stopped testing anything.

   It must agree with ENTITY_MEDIA_DIR, and tests/shot-readiness.js asserts that
   the two say the same thing rather than leaving it to be noticed later. */
function entityApprovedDiskPath(list, entity, stateId = "") {
  const folder = { characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" }[list];
  if (!folder || !entity) return "";
  const states = Array.isArray(entity.continuityStates) ? entity.continuityStates : [];
  const requested = stateId ? states.find((item) => String(item?.id) === String(stateId)) : null;
  const state = requested || states.find((item) => item?.isDefault) || null;
  const file = Continuity.stateApprovedFile(entity, state);
  const full = path.join(PROJECT_DIR(), folder, path.basename(file));
  return file && fs.existsSync(full) && IMG_ONLY(full) ? full : "";
}
function derivedFrameContext(P, shot, frame) {
  const context = [];
  const frames = shot.keyframes || [];
  const index = frames.findIndex((item) => String(item.id) === String(frame.id));
  const add = (file, label, role) => {
    if (!file || !fs.existsSync(file) || !IMG_ONLY(file) || context.some((item) => item.file === file) || context.length >= 8) return;
    context.push({ file, label, role });
  };
  if (index > 0) {
    const previous = frames[index - 1];
    const previousFile = path.join(PROJECT_DIR(), "shots", shot.id, "takes", path.basename(previous?.winner || ""));
    add(previousFile, `Approved Frame ${previous?.label || index}`, "approved parent frame / exact continuity base");
  }
  const creation = shot.creationBrief || {};
  const state = (creation.frameWorkflows || {})[frame.id] || {};
  const blockingId = state.automationBlockingAssetId || creation.activeBlockingAssetId || "";
  const blocking = (P.mediaAssets || []).find((asset) => String(asset.id) === String(blockingId));
  if (blocking) add(projectAssetPath(blocking.storagePath || blocking.file), blocking.title || blocking.file, "frame-specific composition guide");
  const resolved = resolveShotEntities(P, shot);
  const location = resolved.locations.find((item) => item.id === creation.locationId) || resolved.locations[0];
  /* P4-SEM-B. This used to read the frame's own workflow maps directly, which
     meant it honoured a frame override and then fell straight past the SHOT's
     declared state to the entity's default - so a shot that declared "Rhea is
     rain-soaked" generated every unoverridden frame against the clean
     authority. The declared state and the image it selects were two truths.
     One resolver answers now, the same one the continuity manifest and the
     `continuity` profile use: frame, then shot, then the entity's default. */
  const declared = (kind, entity) => (entity ? Continuity.resolveDeclaredStateId(shot, frame.id, kind, entity.id) : "");
  add(entityApprovedDiskPath("locations", location, declared("location", location)), location?.name || "Approved location", "location design authority");
  for (const character of resolved.characters || []) add(entityApprovedDiskPath("characters", character, declared("character", character)), character.name || character.id, "character identity authority");
  for (const prop of resolved.props || []) add(entityApprovedDiskPath("props", prop, declared("prop", prop)), prop.name || prop.id, "prop design authority");
  for (const vehicle of resolved.vehicles || []) add(entityApprovedDiskPath("vehicles", vehicle, declared("vehicle", vehicle)), vehicle.name || vehicle.id, "vehicle design authority");
  return context;
}

const SCENE_REVIEW_SYSTEM = `You are a scene continuity reviewer for an AI film production. You judge a SEQUENCE of approved shot stills against the Project Bible and approved authority images, not isolated aesthetics. The first labelled images are SHOT frames in exact edit order. Any later labelled AUTHORITY images are reference truth, never additional shots. Distinguish intentional progression from accidental drift. Fail visible character, wardrobe/state, embedded-content, prop construction, location architecture/geography, camera-axis, scale, or narrative-progression contradictions. Review whole-scene consistency, adjacent-shot transitions, and shot-specific continuity. Return ONLY valid JSON, no markdown fences.
{
  "verdict":"needs_corrections",
  "summary":"one concise paragraph",
  "scores":{
    "visualQuality":0,
    "narrativeReadability":0,
    "characterConsistency":0,
    "locationConsistency":0,
    "propContinuity":0,
    "geography":0
  },
  "strengths":["..."],
  "priorityIssues":[{"id":"ISS-1","severity":"high","summary":"...","detail":"...","shotIds":["S01-03","S01-04"],"recommendation":"..."}],
  "pairFindings":[{"fromShotId":"S01-03","toShotId":"S01-04","severity":"medium","summary":"...","recommendation":"..."}],
  "shotFindings":[{"shotId":"S01-04","title":"...","severity":"high","summary":"...","compareShotIds":["S01-03","S01-05"],"recommendation":"..."}],
  "nextAction":"..."
}`;
function approvedStillNameForSceneReview(shot) {
  if (!shot) return "";
  const openingFrame = (shot.keyframes || [])[0] || null;
  return String(shot.winner || openingFrame?.winner || "").trim();
}
function approvedStillPathForSceneReview(shot) {
  const name = approvedStillNameForSceneReview(shot);
  if (!name || /\.(mp4|mov|avi|webm|mp3|wav|m4a)$/i.test(name)) return null;
  const file = path.join(PROJECT_DIR(), "shots", shot.id, "takes", path.basename(name));
  return fs.existsSync(file) ? file : null;
}
function normalizeSceneReview(parsed, scene, rows) {
  const ids = new Set(rows.map((row) => row.shot.id));
  const clamp = (value) => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
  const cleanSeverity = (value) => {
    const key = String(value || "medium").toLowerCase();
    return ["low", "medium", "high"].includes(key) ? key : "medium";
  };
  const scores = parsed && typeof parsed === "object" && parsed.scores && typeof parsed.scores === "object" ? parsed.scores : {};
  const rawScoreValues = Object.values(scores).map(Number).filter(Number.isFinite);
  const scoreScale = rawScoreValues.length && Math.max(...rawScoreValues) <= 5 ? 20 : rawScoreValues.length && Math.max(...rawScoreValues) <= 10 ? 10 : 1;
  const sceneScore = (value) => clamp(Number(value) * scoreScale);
  const cleaned = {
    verdict: String(parsed?.verdict || "needs_corrections"),
    summary: String(parsed?.summary || "The scene continuity review returned no summary.").trim(),
    scores: {
      visualQuality: sceneScore(scores.visualQuality),
      narrativeReadability: sceneScore(scores.narrativeReadability),
      characterConsistency: sceneScore(scores.characterConsistency),
      locationConsistency: sceneScore(scores.locationConsistency),
      propContinuity: sceneScore(scores.propContinuity),
      geography: sceneScore(scores.geography),
    },
    strengths: Array.isArray(parsed?.strengths) ? parsed.strengths.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8) : [],
    priorityIssues: Array.isArray(parsed?.priorityIssues) ? parsed.priorityIssues.map((item, index) => ({
      id: String(item?.id || `ISS-${index + 1}`),
      severity: cleanSeverity(item?.severity),
      summary: String(item?.summary || item?.detail || `Priority issue ${index + 1}`).trim(),
      detail: String(item?.detail || item?.summary || "").trim(),
      shotIds: Array.isArray(item?.shotIds) ? item.shotIds.map((value) => String(value || "").trim()).filter((value) => ids.has(value)) : [],
      recommendation: String(item?.recommendation || "").trim(),
    })) : [],
    pairFindings: Array.isArray(parsed?.pairFindings) ? parsed.pairFindings.map((item) => ({
      fromShotId: ids.has(String(item?.fromShotId || "").trim()) ? String(item.fromShotId).trim() : "",
      toShotId: ids.has(String(item?.toShotId || "").trim()) ? String(item.toShotId).trim() : "",
      severity: cleanSeverity(item?.severity),
      summary: String(item?.summary || item?.detail || "").trim(),
      recommendation: String(item?.recommendation || "").trim(),
    })).filter((item) => item.fromShotId && item.toShotId && item.summary) : [],
    shotFindings: Array.isArray(parsed?.shotFindings) ? parsed.shotFindings.map((item) => ({
      shotId: ids.has(String(item?.shotId || "").trim()) ? String(item.shotId).trim() : "",
      title: String(item?.title || "").trim(),
      severity: cleanSeverity(item?.severity),
      summary: String(item?.summary || item?.detail || "").trim(),
      compareShotIds: Array.isArray(item?.compareShotIds) ? item.compareShotIds.map((value) => String(value || "").trim()).filter((value) => ids.has(value)) : [],
      recommendation: String(item?.recommendation || "").trim(),
    })).filter((item) => item.shotId && item.summary) : [],
    nextAction: String(parsed?.nextAction || "").trim(),
    sceneId: scene.id,
    updatedAt: new Date().toISOString(),
  };
  return cleaned;
}
app.post("/api/llm/review-scene", async (req, res) => {
  try {
    const visionProvider = aiVisionProviderOverride();
    const P = readJsonSync(DATA());
    const sceneId = String(req.body?.sceneId || "").trim();
    const scene = (P.scenes || []).find((item) => String(item.id) === sceneId);
    if (!scene) return res.status(404).json({ error: "Scene not found" });
    const shots = (P.shots || []).filter((shot) => String(shot.scene) === sceneId);
    const rows = shots.map((shot) => ({ shot, file: approvedStillPathForSceneReview(shot) })).filter((row) => row.file).slice(0, 24);
    if (rows.length < 2) return res.status(400).json({ error: "Approve at least two stills in this scene before running a scene review." });
    const shotImages = rows.map((row) => fs.readFileSync(row.file).toString("base64"));
    const expectedChanges = Array.isArray(req.body?.expectedChanges) ? req.body.expectedChanges.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const referenced = { characters: new Map(), locations: new Map(), props: new Map(), vehicles: new Map() };
    for (const { shot } of rows) {
      const resolved = resolveShotEntities(P, shot);
      for (const type of ["characters", "locations", "props", "vehicles"]) {
        for (const item of resolved[type] || []) if (!referenced[type].has(item.id)) referenced[type].set(item.id, item);
      }
    }
    const authorityImages = [];
    for (const type of ["characters", "locations", "props", "vehicles"]) {
      for (const item of referenced[type].values()) {
        if (authorityImages.length >= 8) break;
        const file = entityApprovedDiskPath(type, item, "");
        if (file && fs.existsSync(file)) authorityImages.push({ file, label: `${type.slice(0, -1).toUpperCase()} AUTHORITY · ${item.name || item.id} · ${path.basename(file)}` });
      }
    }
    const images = [...shotImages, ...authorityImages.map((row) => fs.readFileSync(row.file).toString("base64"))];
    const shotLines = rows.map((row, index) => {
      const shot = row.shot;
      const prev = shots[shots.indexOf(shot) - 1];
      const next = shots[shots.indexOf(shot) + 1];
      const resolved = resolveShotEntities(P, shot);
      const characterIds = (resolved.characters || []).map((item) => item.name || item.id).join(", ");
      const locationIds = (resolved.locations || []).map((item) => item.name || item.id).join(", ");
      const propIds = [...(resolved.props || []), ...(resolved.vehicles || [])].map((item) => item.name || item.id).join(", ");
      return [
        `${index + 1} = ${shot.id} · ${shot.title || "Untitled shot"} · ${Math.round(shotListDurationSeconds(shot))}s`,
        shot.desc ? `Action: ${shot.desc}` : "",
        shot.positioning ? `Staging: ${shot.positioning}` : "",
        characterIds ? `Characters: ${characterIds}` : "",
        locationIds ? `Locations: ${locationIds}` : "",
        propIds ? `Props: ${propIds}` : "",
        prev ? `Previous shot: ${prev.id}` : "",
        next ? `Next shot: ${next.id}` : "",
      ].filter(Boolean).join("\n");
    }).join("\n\n");
    const authority = [
      ...(referenced.characters.size ? ["CHARACTER AUTHORITIES:\n" + [...referenced.characters.values()].map((item) => `- ${item.name || item.id}: ${item.block || item.notes || item.driftNotes || "approved character identity"}`).join("\n")] : []),
      ...(referenced.locations.size ? ["LOCATION AUTHORITIES:\n" + [...referenced.locations.values()].map((item) => `- ${item.name || item.id}: ${item.description || item.notes || item.block || "approved location"}`).join("\n")] : []),
      ...((referenced.props.size || referenced.vehicles.size) ? ["PROP / VEHICLE AUTHORITIES:\n" + [...referenced.props.values(), ...referenced.vehicles.values()].map((item) => `- ${item.name || item.id}: ${item.description || item.notes || item.block || "approved prop or vehicle"}`).join("\n")] : []),
    ].join("\n\n");
    const projectBible = [
      P.meta?.visualStyle ? `APPROVED VISUAL STYLE: ${P.meta.visualStyle}` : "",
      P.meta?.world?.setting ? `WORLD / ERA: ${P.meta.world.setting}` : "",
      P.meta?.world?.reject ? `MUST NOT APPEAR: ${P.meta.world.reject}` : "",
      (P.qcChecklist || []).length ? `PROJECT QC: ${(P.qcChecklist || []).join(" | ")}` : "",
    ].filter(Boolean).join("\n");
    const imageOrder = [
      ...rows.map((row, index) => `${index + 1} = SHOT ${row.shot.id} · ${row.shot.title || "Untitled"}`),
      ...authorityImages.map((row, index) => `${rows.length + index + 1} = ${row.label}`),
    ].join("\n");
    const user = [
      `SCENE: ${scene.id} · ${scene.title || "Untitled scene"}`,
      scene.whatHappens ? `SCENE BEAT: ${scene.whatHappens}` : "",
      scene.howItFeels ? `SCENE FEEL: ${scene.howItFeels}` : "",
      expectedChanges.length ? `INTENTIONAL EXPECTED PROGRESSION:\n- ${expectedChanges.join("\n- ")}` : "INTENTIONAL EXPECTED PROGRESSION: none supplied. Treat visible changes cautiously and flag uncertain drift.",
      "IMAGE ORDER (SHOT FRAMES FIRST, THEN PROJECT-BIBLE AUTHORITY IMAGES):",
      imageOrder,
      "SHOT INTENT / EDIT ORDER:",
      shotLines,
      projectBible,
      authority,
      "REVIEW TASK:\n1) judge whether the sequence reads coherently to a viewer, 2) compare every shot to the approved Project Bible and authority images, 3) identify the highest-priority continuity breaks, 4) flag adjacent-shot transition problems, 5) give shot-specific correction recommendations, 6) respect only the intentional changes listed above.",
    ].filter(Boolean).join("\n\n");
    const assistant = await requestVisionResult(SCENE_REVIEW_SYSTEM, user, images, {
      label: "Scene continuity reviewer",
      maxTokens: 2600,
      provider: visionProvider,
      parse: (raw) => {
        const parsed = parseReviewJson(raw);
        if (!parsed) throw new Error("vision model returned an unstructured scene review");
        return normalizeSceneReview(parsed, scene, rows);
      },
    });
    return res.json({ ok: true, review: assistant.value });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Scene continuity review failed" });
  }
});


const SCENE_CORRECTION_REVIEW_SYSTEM = `You are reviewing candidate repairs for one shot inside an AI-film scene. Judge each candidate against the exact continuity finding, the approved previous and next shots, and the target shot's written intent. A candidate may look attractive but must fail if it does not solve the stated sequence break. Return ONLY valid JSON, no fences:
{"reviews":[{"n":1,"pass":true,"score":88,"notes":"specific visible continuity judgment"}],"ranking":[1],"suggested":1,"rationale":"one concise sentence"}`;
app.post("/api/llm/review-scene-correction", async (req, res) => {
  try {
    const visionProvider = aiVisionProviderOverride();
    const P = readJsonSync(DATA());
    const sceneId = String(req.body?.sceneId || "").trim();
    const targetShotId = String(req.body?.targetShotId || "").trim();
    const scene = (P.scenes || []).find((item) => String(item.id) === sceneId);
    const target = (P.shots || []).find((item) => String(item.id) === targetShotId && String(item.scene) === sceneId);
    if (!scene || !target) return res.status(404).json({ error: "Scene correction target was not found" });
    const requested = [...new Set((Array.isArray(req.body?.fileNames) ? req.body.fileNames : []).map((item) => path.basename(String(item))))].slice(0, 4);
    const takeDir = path.join(PROJECT_DIR(), "shots", targetShotId, "takes");
    const candidates = requested.map((name) => ({ name, file: path.join(takeDir, name) })).filter((item) => IMG_ONLY(item.name) && fs.existsSync(item.file));
    if (!candidates.length) return res.status(400).json({ error: "No scene-correction candidates were found on disk" });
    const sceneShots = (P.shots || []).filter((shot) => String(shot.scene) === sceneId);
    const targetIndex = sceneShots.findIndex((shot) => shot.id === targetShotId);
    const previous = sceneShots[targetIndex - 1] || null, next = sceneShots[targetIndex + 1] || null;
    const previousFile = approvedStillPathForSceneReview(previous), nextFile = approvedStillPathForSceneReview(next);
    const packageInfo = req.body?.package && typeof req.body.package === "object" ? req.body.package : {};
    const resolved = resolveShotEntities(P, target);
    const canon = [
      ...(resolved.characters || []).map((item) => `CHARACTER ${item.name || item.id}: ${item.block || item.notes || item.driftNotes || "approved identity"}`),
      ...(resolved.locations || []).map((item) => `LOCATION ${item.name || item.id}: ${item.notes || item.block || item.description || "approved location"}`),
      ...(resolved.props || []).map((item) => `PROP ${item.name || item.id}: ${item.notes || item.block || item.description || "approved prop"}`),
      ...(resolved.vehicles || []).map((item) => `VEHICLE ${item.name || item.id}: ${item.notes || item.block || item.description || "approved vehicle"}`),
    ].join("\n");
    const reviews = [];
    for (let index = 0; index < candidates.length; index++) {
      const images = [candidates[index].file, previousFile, nextFile].filter(Boolean).map((file) => fs.readFileSync(file).toString("base64"));
      const imageOrder = [
        `1 = candidate repair for ${targetShotId}`,
        previousFile ? `2 = approved previous shot ${previous.id}` : "",
        nextFile ? `${previousFile ? 3 : 2} = approved next shot ${next.id}` : "",
      ].filter(Boolean).join("\n");
      const user = [
        `SCENE: ${scene.id} · ${scene.title || "Untitled scene"}`,
        `TARGET SHOT: ${target.id} · ${target.title || "Untitled shot"}`,
        target.desc ? `TARGET ACTION: ${target.desc}` : "",
        target.positioning ? `TARGET STAGING: ${target.positioning}` : "",
        packageInfo.summary ? `CONTINUITY FAILURE: ${packageInfo.summary}` : "",
        packageInfo.recommendation ? `REQUIRED REPAIR: ${packageInfo.recommendation}` : "",
        `IMAGE ORDER:\n${imageOrder}`,
        canon ? `APPROVED AUTHORITIES:\n${canon}` : "",
        "Judge whether image 1 actually fixes the stated scene break while preserving all unaffected target-shot details and connecting naturally to the adjacent approved shots. Return one review row using n=1.",
      ].filter(Boolean).join("\n\n");
      const assistant = await requestVisionResult(SCENE_CORRECTION_REVIEW_SYSTEM, user, images, {
        label: `Scene correction reviewer ${index + 1}`,
        maxTokens: 1200,
        provider: visionProvider,
        parse: (raw) => {
          const parsed = parseReviewJson(raw);
          if (!parsed) throw new Error("vision model returned an unstructured scene-correction review");
          const row = normalizeReviewItems(parsed, [1])[0];
          return { row, rationale: String(parsed.rationale || row.notes || "") };
        },
      });
      reviews.push({ ...assistant.value.row, n: index + 1 });
    }
    const ranked = [...reviews].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return res.json({
      files: candidates.map((item) => item.name),
      review: {
        reviews,
        ranking: ranked.map((item) => item.n),
        suggested: ranked[0]?.n || 1,
        rationale: ranked[0]?.notes || "Scene correction candidates reviewed in context.",
      },
      context: [previous?.id, target.id, next?.id].filter(Boolean),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Scene correction review failed" });
  }
});

app.post("/api/llm/review-derived-frame", async (req, res) => {
  try {
    const P = readJsonSync(DATA());
    const shotId = String(req.body?.shotId || ""), frameId = String(req.body?.frameId || "");
    const shot = (P.shots || []).find((item) => String(item.id) === shotId);
    const frame = shot && (shot.keyframes || []).find((item) => String(item.id) === frameId);
    if (!shot || !frame) return res.status(404).json({ error: "shot frame not found" });
    const requested = [...new Set((Array.isArray(req.body?.fileNames) ? req.body.fileNames : []).map((item) => path.basename(String(item))))].slice(0, 6);
    const takeDir = path.join(PROJECT_DIR(), "shots", shot.id, "takes");
    const candidates = requested.map((name) => ({ name, file: path.join(takeDir, name) })).filter((item) => IMG_ONLY(item.name) && fs.existsSync(item.file));
    if (!candidates.length) return res.status(400).json({ error: "no derived-frame candidates on disk" });
    const context = derivedFrameContext(P, shot, frame);
    const creation = shot.creationBrief || {}, state = (creation.frameWorkflows || {})[frame.id] || {};
    const frameRequirement = [state.action || frame.description || shot.desc || "", state.staging || "", state.camera || "", state.notes || ""].filter(Boolean).join("\n");
    const labels = [
      ...candidates.map((item, index) => `Image ${index + 1} = CANDIDATE ${index + 1} · ${item.name}`),
      ...context.map((item, index) => `Image ${candidates.length + index + 1} = CONTEXT · ${item.label} · ${item.role}`),
    ];
    const images = [...candidates, ...context].map((item) => fs.readFileSync(item.file).toString("base64"));
    const ids = candidates.map((_, index) => index + 1);
    const assistant = await requestVisionResult(
      DERIVED_FRAME_REVIEW_SYSTEM,
      `IMAGE ORDER\n${labels.join("\n")}\n\nTARGET FRAME ${frame.label || ""}\n${frameRequirement}\n\nSHOT / WORLD CONSTRAINTS\n${reviewCriteria(P, "shot", null, shot.id, frame.id).criteria.join("\n")}\n\nOnly rank candidate IDs ${ids.join(", ")}. Context images are comparison authority and must never be ranked.`,
      images,
      {
        label: `Derived Frame ${frame.label || ""} review assistant`,
        maxTokens: 2400,
        provider: aiVisionProviderOverride(),
        parse: (raw) => {
          const parsed = parseReviewJson(raw);
          if (!parsed) throw new Error("vision model returned an unstructured derived-frame review");
          return parsed;
        },
      },
    );
    const parsed = assistant.value;
    const reviews = normalizeReviewItems(parsed, ids);
    const ranking = normalizeRanking(parsed.ranking, ids).length ? normalizeRanking(parsed.ranking, ids) : [...reviews].sort((a, b) => b.score - a.score).map((item) => item.n);
    let suggested = Number(parsed.suggested);
    if (!ids.includes(suggested)) suggested = ranking[0];
    res.json({
      files: candidates.map((item) => item.name),
      review: { reviews, ranking, suggested, rationale: String(parsed.rationale || "Compared dependent-frame candidates against the approved parent and target-frame requirements.") },
      context: context.map((item) => ({ label: item.label, role: item.role, file: path.basename(item.file) })),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "derived-frame review failed" });
  }
});


const FRAME_SEQUENCE_REVIEW_SYSTEM = `You are reviewing approved still frames that will be used as image-to-video, first/last-frame, or multi-keyframe anchors in one continuous shot. The images are in exact temporal order. Judge whether they depict the SAME camera setup, same environment, same fixed architecture, same practical lights, same background objects, same character identity/wardrobe, and same prop construction except for the explicitly intended frame-to-frame changes. A beautiful frame must FAIL when an unintended light appears or disappears, background geometry shifts, exposure/grade changes materially, character scale or camera position drifts, or a prop changes construction. Return ONLY valid JSON, no markdown:
{"pass":false,"score":0,"summary":"concise result","categories":{"camera":{"score":0,"note":""},"environment":{"score":0,"note":""},"lighting":{"score":0,"note":""},"character":{"score":0,"note":""},"props":{"score":0,"note":""},"intendedProgression":{"score":0,"note":""}},"blockingIssues":["specific visible mismatch"],"warnings":["minor concern"],"nextAction":"specific correction advice"}`;

function clampSequenceScore(value) {
  const n = Number(value);
  return Math.max(0, Math.min(100, Number.isFinite(n) ? Math.round(n) : 0));
}
function normalizeFrameSequenceReview(parsed) {
  const categories = {};
  for (const key of ["camera", "environment", "lighting", "character", "props", "intendedProgression"]) {
    const row = parsed?.categories?.[key] || {};
    categories[key] = { score: clampSequenceScore(row.score), note: String(row.note || "").trim() };
  }
  const scores = Object.values(categories).map((row) => row.score).filter(Number.isFinite);
  const score = clampSequenceScore(parsed?.score ?? (scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0));
  const blockingIssues = (Array.isArray(parsed?.blockingIssues) ? parsed.blockingIssues : []).map(String).map((x)=>x.trim()).filter(Boolean).slice(0,12);
  const warnings = (Array.isArray(parsed?.warnings) ? parsed.warnings : []).map(String).map((x)=>x.trim()).filter(Boolean).slice(0,12);
  const hardCategoryFail = ["camera", "environment", "lighting", "character", "props"].some((key) => categories[key].score < 75);
  const pass = parsed?.pass === true && score >= 80 && !blockingIssues.length && !hardCategoryFail;
  return {
    pass,
    score,
    summary: String(parsed?.summary || (pass ? "Approved frame sequence is stable enough for motion." : "Frame sequence needs continuity correction before motion.")).trim(),
    categories,
    blockingIssues,
    warnings,
    nextAction: String(parsed?.nextAction || (pass ? "Proceed to motion generation." : "Correct the highest-priority mismatch and run the sequence review again.")).trim(),
    reviewedAt: new Date().toISOString(),
  };
}

app.post("/api/llm/review-frame-sequence", async (req, res) => {
  try {
    const P = readJsonSync(DATA());
    const shotId = String(req.body?.shotId || "");
    const shot = (P.shots || []).find((item) => String(item.id) === shotId);
    if (!shot) return res.status(404).json({ error: "shot not found" });
    const requestedIds = Array.isArray(req.body?.frameIds) ? req.body.frameIds.map(String) : [];
    const frames = (shot.keyframes || []).filter((frame) => !requestedIds.length || requestedIds.includes(String(frame.id))).slice(0, 8);
    const rows = frames.map((frame, index) => {
      const name = String(frame?.winner || "").trim();
      const file = name ? path.join(PROJECT_DIR(), "shots", shot.id, "takes", path.basename(name)) : "";
      return { frame, index, name, file };
    }).filter((row) => row.name && fs.existsSync(row.file) && IMG_ONLY(row.file));
    if (rows.length < 2) return res.status(400).json({ error: "At least two approved frame images are required for sequence review." });
    const creation = shot.creationBrief || {};
    const workflows = creation.frameWorkflows || {};
    const labels = rows.map((row, index) => {
      const state = workflows[row.frame.id] || {};
      const intent = [state.action || row.frame.description || "", state.staging || "", state.camera || "", state.notes || ""].filter(Boolean).join(" | ");
      return `Image ${index + 1} = Frame ${row.frame.label || index + 1} · ${row.name}\nINTENDED STATE: ${intent || "No explicit state change supplied; preserve all visible continuity."}`;
    });
    const images = rows.map((row) => fs.readFileSync(row.file).toString("base64"));
    const user = [
      `SHOT ${shot.id} · ${shot.title || "Untitled"}`,
      `SHOT PURPOSE: ${shot.desc || shot.description || ""}`,
      `FRAME ORDER:\n${labels.join("\n\n")}`,
      "Review the sequence as one continuous camera setup. Treat only the written intended state changes as permitted differences. Pay special attention to background practical lights, windows/openings, tunnel/set geometry, exposure, character scale, hand/prop placement, and any new or missing background object.",
    ].join("\n\n");
    const assistant = await requestVisionResult(FRAME_SEQUENCE_REVIEW_SYSTEM, user, images, {
      label: `Frame sequence continuity · ${shot.id}`,
      maxTokens: 2200,
      provider: aiVisionProviderOverride(),
      parse: (raw) => {
        const parsed = parseReviewJson(raw);
        if (!parsed) throw new Error("vision model returned an unstructured frame-sequence review");
        return normalizeFrameSequenceReview(parsed);
      },
    });
    return res.json({ ok: true, frameIds: rows.map((row) => row.frame.id), files: rows.map((row) => row.name), review: assistant.value });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "frame-sequence review failed" });
  }
});

const CANDIDATE_REVIEW_SYSTEM = `You are a production-frame reviewer for an AI filmmaking workflow. Image 1 is the returned candidate. Any blocking guide and numbered appearance references are separately labelled in the user message. Judge visible evidence only. A composition guide controls crop, camera, staged positions, relative scale, depth order, facing, spacing, and contact points; it does not control identity, style, material, colour, lighting, text, or era. Appearance references control only their assigned design roles and must not donate their source composition. Return ONLY valid JSON, no markdown fences:
{"categories":{"composition":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"references":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"requirements":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"style":{"severity":"pass|minor|major|blocking","note":"specific visible finding"},"cleanliness":{"severity":"pass|minor|major|blocking","note":"specific visible finding"}},"references":[{"token":"#image2","label":"reference label","severity":"pass|minor|major|blocking","note":"specific visible finding"}],"summary":"concise director-facing summary","recommendation":"approve|alternate|correct|reject"}`;

function candidateReviewSeverity(value) {
  const normalized = String(value || "pass").toLowerCase();
  return ["pass", "minor", "major", "blocking"].includes(normalized) ? normalized : "pass";
}
function normalizeStructuredCandidateReview(parsed, referenceLabels) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const categories = {};
  for (const key of ["composition", "references", "requirements", "style", "cleanliness"]) {
    const row = source.categories?.[key] || {};
    categories[key] = { severity: candidateReviewSeverity(row.severity), note: String(row.note || "").trim() };
  }
  const allowed = new Map((referenceLabels || []).map((row) => [row.token, row]));
  const references = [];
  for (const row of Array.isArray(source.references) ? source.references : []) {
    const token = String(row?.token || "").trim();
    if (!allowed.has(token) || references.some((item) => item.token === token)) continue;
    references.push({ token, label: String(row.label || allowed.get(token).label || ""), severity: candidateReviewSeverity(row.severity), note: String(row.note || "").trim() });
  }
  for (const [token, row] of allowed) if (!references.some((item) => item.token === token)) references.push({ token, label: row.label, severity: "pass", note: "" });
  const recommendation = ["approve", "alternate", "correct", "reject"].includes(String(source.recommendation || "").toLowerCase()) ? String(source.recommendation).toLowerCase() : "correct";
  return { categories, references, summary: String(source.summary || "").trim(), recommendation };
}
function projectAssetPath(value) {
  let rel = String(value || "").trim();
  if (!rel) return "";
  if (rel.startsWith("/assets/")) rel = rel.slice(8).split("/").map((part) => decodeURIComponent(part)).join("/");
  rel = rel.replace(/^\/+/, "").replace(/\\/g, "/");
  const root = path.resolve(PROJECT_DIR());
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !MEDIA_EXT.has(path.extname(file).toLowerCase())) return "";
  return file;
}
function activeBlockingAssetForReview(P, shot) {
  const activeId = shot.creationBrief?.activeBlockingAssetId || "";
  return (P.mediaAssets || []).find((asset) => (asset.links || []).some((link) => link.targetType === "shot" && String(link.targetId) === String(shot.id) && ["blocking-frame", "storyboard", "animatic-frame"].includes(link.role) && (asset.id === activeId || link.blockingState === "active"))) || null;
}
function candidateReviewBuild(P, shot, fileName, requestedId) {
  const row = (shot.candidateFiles || []).find((item) => (item.stored || item.name) === fileName) || {};
  const id = String(requestedId || row.sourcePackageId || "");
  return P.promptBuildsById?.[id] || row.sourcePackageSnapshot || row.packageSnapshot || null;
}
app.post("/api/llm/review-candidate", async (req, res) => {
  try {
    const visionProvider = aiVisionProviderOverride();
    const P = readJsonSync(DATA());
    const shotId = path.basename(String(req.body?.shotId || ""));
    const frameId = String(req.body?.frameId || "");
    const fileName = path.basename(String(req.body?.fileName || ""));
    const shot = (P.shots || []).find((item) => item.id === shotId);
    if (!shot) return res.status(404).json({ error: "shot not found" });
    const candidatePath = path.join(PROJECT_DIR(), "shots", shotId, "takes", fileName);
    if (!fileName || !fs.existsSync(candidatePath) || !IMG_ONLY(fileName)) return res.status(400).json({ error: "candidate image is unavailable" });
    const frame = frameId ? (shot.keyframes || []).find((item) => item.id === frameId) : (shot.keyframes || [])[0];
    const build = candidateReviewBuild(P, shot, fileName, req.body?.buildId);
    const guideAsset = activeBlockingAssetForReview(P, shot);
    const guidePath = guideAsset ? projectAssetPath(guideAsset.storagePath || (guideAsset.file ? `media/${guideAsset.file}` : "")) : "";
    const images = [fs.readFileSync(candidatePath).toString("base64")];
    const inputLabels = [{ image: 1, token: "candidate", label: fileName, role: "returned candidate" }];
    let nextImage = 2;
    if (guidePath) {
      images.push(fs.readFileSync(guidePath).toString("base64"));
      inputLabels.push({ image: nextImage++, token: "guide", label: guideAsset.title || guideAsset.file || "Blocking guide", role: "authoritative composition guide" });
    }
    const referenceLabels = [];
    for (let index = 0; index < (build?.references || []).length && images.length < 8; index++) {
      const ref = build.references[index] || {};
      if (String(ref.mediaType || "image") !== "image" || ref.role === "composition") continue;
      const file = projectAssetPath(ref.url || ref.storagePath || "");
      if (!file || file === guidePath) continue;
      const token = ref.token || `#image${index + 1}`;
      images.push(fs.readFileSync(file).toString("base64"));
      const label = String(ref.label || ref.entityName || ref.key || ref.role || "Reference");
      inputLabels.push({ image: nextImage, token, label, role: ref.role || "appearance reference" });
      referenceLabels.push({ token, label, image: nextImage });
      nextImage++;
    }
    const sourcePrompt = String(build?.prompt || "").slice(0, 8000);
    const user = `INPUT IMAGE ORDER\n${inputLabels.map((item) => `Image ${item.image} = ${item.token} · ${item.label} · ${item.role}`).join("\n")}\n\nSHOT REQUIREMENT\n${frame?.description || shot.desc || shot.title || shot.id}\n${shot.positioning ? `Additional staging: ${shot.positioning}` : ""}\n${(shot.risks || []).length ? `Known production risks: ${shot.risks.join("; ")}` : ""}\n\nORIGINAL NUMBERED REFERENCE CONTRACTS\n${(build?.references || []).map((ref, index) => `${ref.token || `#image${index + 1}`} · ${ref.label || ref.key || ref.role}: ${ref.instruction || ref.role || "reference"}`).join("\n") || "No frozen reference contracts were recorded."}\n\nORIGINAL COMPILED PROMPT\n${sourcePrompt || "Not recorded."}`;
    const assistant = await requestVisionResult(CANDIDATE_REVIEW_SYSTEM, user, images, {
      label: "Frame candidate reviewer",
      maxTokens: 2800,
      provider: visionProvider,
      parse: (raw) => {
        const parsed = parseReviewJson(raw);
        if (!parsed) throw new Error("vision model returned an unstructured review");
        return normalizeStructuredCandidateReview(parsed, referenceLabels);
      },
    });
    res.json({ review: assistant.value, inputLabels, assistantAttempts: assistant.attempts });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "candidate review failed" });
  }
});

/* The reference-review contract: authority mode, criterion ownership, state
   semantics and finding classification. Extracted so it can be exercised on its
   own; the route below assembles inputs and this decides what they mean. */
const ReferenceReview = require("./reference-review-contract");
const {
  ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
  ENTITY_CANDIDATE_REVIEW_SYSTEM,
  entityReviewStateRecord,
  entityReviewParentState,
  entityReviewFolder,
  entityReviewType,
  entityReviewCanon,
  entityReviewHardCheckRequirements,
  entityReviewAuthorityMode,
  entityReviewRelatedStates,
  entityReviewAuthoritySignature,
  entityReviewDeclaredRequirements,
  entityReviewDeclaredStateContract,
  normalizeEntityCandidateReview,
} = ReferenceReview;

app.post("/api/llm/review-entity-candidate", async (req, res) => {
  try {
    const visionProvider = aiVisionProviderOverride();
    const P = readJsonSync(DATA());
    const list = String(req.body?.list || "");
    const id = String(req.body?.id || "");
    const fileName = path.basename(String(req.body?.fileName || ""));
    const folder = entityReviewFolder(list);
    if (!folder) return res.status(400).json({ error: "unsupported entity type" });
    const entity = (P[list] || []).find((item) => String(item.id) === id);
    if (!entity) return res.status(404).json({ error: "entity not found" });
    const candidateRow = (entity.candidateFiles || []).find((item) => String(item?.stored || item?.name || item?.original || "") === fileName) || {};
    const coverageSlot = candidateRow.targetCoverageSlotId
      ? ([...(entity.coverageSlots || []), ...(entity.expressionSlots || [])].find((item) => String(item?.id) === String(candidateRow.targetCoverageSlotId)) || null)
      : null;
    const candidatePath = path.join(PROJECT_DIR(), folder, fileName);
    if (!fileName || !IMG_ONLY(fileName) || !fs.existsSync(candidatePath)) return res.status(400).json({ error: "candidate image is unavailable" });
    const state = entityReviewStateRecord(entity, String(req.body?.stateId || candidateRow.targetStateId || "state-default"));
    const images = [fs.readFileSync(candidatePath).toString("base64")];
    const inputLabels = [{ image: 1, label: fileName, role: "candidate under review", fileName }];
    const seen = new Set([fileName]);
    const addEntityFile = (name, label, role) => {
      const safe = path.basename(String(name || ""));
      if (!safe || seen.has(safe) || !IMG_ONLY(safe) || images.length >= 12) return;
      const full = path.join(PROJECT_DIR(), folder, safe);
      if (!fs.existsSync(full)) return;
      seen.add(safe);
      images.push(fs.readFileSync(full).toString("base64"));
      inputLabels.push({ image: images.length, label, role, fileName: safe });
    };
    const defaultState = entityReviewStateRecord(entity, "state-default");
    const parentState = entityReviewParentState(entity, state);
    /* S8A — WHAT THE REVIEWER IS TOLD DEPENDS ON WHETHER ANYBODY APPROVED IT.
     *
     * These three inputs were labelled "approved reference" and
     * "primary identity / design authority" from raw pointers, with no receipt
     * predicate anywhere — the server-side twin of the coverage-automation
     * defect the Dogfood #2 audit reproduced. The image still travels either
     * way, because it is genuinely useful context; what changes is whether the
     * reviewer is told it decides anything. */
    const canonValues = new Set(
      (ProductionAuthority.entityProductionTruth(P, list, entity.id).canon || []).map((row) => row.value).filter(Boolean),
    );
    const addStateFile = (file, name, canonRole, historicRole) => {
      const value = String(file || "");
      if (!value) return;
      const isCanon = canonValues.has(value);
      addEntityFile(value, `${name} ${isCanon ? "canon reference" : "historic reference"}`, isCanon ? canonRole : historicRole);
    };
    const HISTORIC_ROLE = "previously selected, not approved as canon — context only";
    if (parentState) addStateFile(parentState.approvedFile || (parentState.isDefault ? entity.approvedFile : ""), parentState.name || "Parent", "exact parent-state editable canon", HISTORIC_ROLE);
    addStateFile(defaultState.approvedFile || entity.approvedFile, defaultState.name || "Default", "primary identity / design canon", HISTORIC_ROLE);
    if (state.id !== defaultState.id) addStateFile(state.approvedFile, state.name || "Target state", "existing target-state canon / replacement comparison", HISTORIC_ROLE);
    const allCoverage = [...(entity.coverageSlots || []), ...(entity.expressionSlots || [])]
      .filter((slot) => Coverage.coverageSlotFile(slot))
      .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
    for (const slot of allCoverage) {
      /* K-alpha: a coverage view is a SUPPORTING reference. It used to be sent
         to the reviewer as "approved alternate-view design authority", which is
         one of the places the slot's undeclared authority became visible. The
         image still travels — it is useful context — under a label that does
         not make it canon. */
      addEntityFile(Coverage.coverageSlotFile(slot), `${slot.label || slot.id} selected view`, list === "locations" ? "same-location supporting view (context only)" : "supporting alternate view (context only)");
    }
    const targetType = entityReviewType(list);
    for (const asset of P.mediaAssets || []) {
      if (images.length >= 12) break;
      const link = (asset.links || []).find((item) => String(item.targetType) === targetType && String(item.targetId) === id && item.agentContext !== false);
      if (!link) continue;
      const file = projectAssetPath(asset.storagePath || (asset.file ? `media/${asset.file}` : ""));
      if (!file || !IMG_ONLY(path.basename(file))) continue;
      const safe = path.basename(file);
      if (seen.has(safe)) continue;
      seen.add(safe);
      images.push(fs.readFileSync(file).toString("base64"));
      inputLabels.push({ image: images.length, label: asset.title || asset.file || "Supporting reference", role: link.role || "supporting entity reference", fileName: safe });
    }
    const hasAuthority = inputLabels.length > 1;
    const authorityMode = entityReviewAuthorityMode(hasAuthority);
    const requiredHardChecks = entityReviewHardCheckRequirements(list, entity, state, coverageSlot, candidateRow, hasAuthority);
    const authoritySignature = entityReviewAuthoritySignature(list, entity, state, coverageSlot, inputLabels, requiredHardChecks, authorityMode);
    const hardCheckContract = requiredHardChecks.length
      ? `

MANDATORY HARD CHECKS
${requiredHardChecks.map((key) => `- ${key}: MUST be returned and true or the candidate fails.`).join("\n")}`
      : "";
    /* The mode block is the fix for the circular bootstrap: the reviewer is told
       in the request whether an authority is supposed to exist, so "none was
       supplied" stops reading as a fault in the workflow that creates it. */
    const authorityContract = hasAuthority
      ? `

AUTHORITY MODE: VALIDATE_AGAINST_AUTHORITY
${inputLabels.length - 1} approved authority image${inputLabels.length === 2 ? "" : "s"} accompany this candidate. Compare against them and report identity drift honestly.`
      : `

AUTHORITY MODE: ESTABLISH_AUTHORITY
No approved visual authority exists for ${entity.name || entity.id} · ${state.name || "Default"} yet. This workflow exists to create the first one, so there is nothing to compare against and that is correct. Judge the candidate ONLY against the written canon and target-state semantics above. Do not lower the score, raise any category, fail any hard check, or write any finding because approved authority images were not supplied. If the candidate satisfies the canon and the target state, say so plainly — a human will decide whether it becomes the authority.`;
    const relatedStates = entityReviewRelatedStates(entity, state);
    /* Phase 5: a candidate that belongs to a sibling state must be nameable as
       such. The roster is evidence for that judgement, never a reassignment. */
    const relatedStateContract = relatedStates.length
      ? `

RELATED STATES OF THIS ${entityReviewType(list).toUpperCase()} — DO NOT ACCEPT ONE OF THESE INSTEAD
${relatedStates.map((row) => `- ${row.name}${row.appliesTo ? ` · scope: ${row.appliesTo}` : ""} (${row.relation})${row.notes ? ` · ${row.notes}` : ""}`).join("\n")}
Decide which state the candidate actually depicts. Set stateMatch.matchesRequestedState to false and name the closer state in stateMatch.closerState whenever the candidate matches one of the above more closely than the requested "${state.name || "Default"}". A candidate that is visually coherent but belongs to a related state is not a pass for the requested state.`
      : `

STATE MATCH
Confirm the candidate depicts the requested "${state.name || "Default"}" state. Set stateMatch.matchesRequestedState to false if it depicts a materially different moment, setting or condition.`;
    const coverageContract = coverageSlot
      ? `

COVERAGE REVIEW TARGET
SLOT: ${coverageSlot.label || coverageSlot.id}
EXPECTED VIEW: ${candidateRow.referenceView || coverageSlot.id}
SLOT NOTES: ${coverageSlot.notes || "none"}
SOURCE SHEET: ${candidateRow.coverageCrop?.sourceSheet || "not recorded"}
The candidate must be the requested angle/expression AND remain the exact same underlying authority. For locations, compare all supplied approved views as one spatial model; incompatible architecture or topology is blocking.`
      : "";
    const stateContract = !state.isDefault
      ? `

DERIVED-STATE CONTRACT
Only this requested delta may change: ${state.notes || "No concrete visual delta was supplied."}
Everything else—including camera/crop, identity, dimensions, embedded imagery or artwork, architecture, materials, wear not named in the delta, and fixed layout—must remain unchanged.`
      : "";
    /* B2a. The delta, cut into a checklist CineBraid owns, so the reviewer
       answers requirements rather than authoring them — and so an observation
       ("the seal is absent") can be compared against the declared expectation
       ("the seal is broken") instead of being folded into a verdict. */
    const declaredState = entityReviewDeclaredRequirements(state);
    const declaredStateContract = entityReviewDeclaredStateContract(declaredState, {
      hasAuthority,
      authorityCount: Math.max(0, inputLabels.length - 1),
      parentStateName: parentState?.name || defaultState?.name || "",
    });
    const user = `INPUT IMAGE ORDER
${inputLabels.map((item) => `Image ${item.image} = ${item.label} · ${item.role}`).join("\n")}${authorityContract}

REVIEW CONTRACT
${entityReviewCanon(P, list, entity, state)}${stateContract}${declaredStateContract}${relatedStateContract}${coverageContract}${hardCheckContract}

Return a score, explicit model pass/fail, all hard checks, the stateMatch decision, all six factor findings, a concise summary, and a recommendation.${hasAuthority ? " A required hard check must be false when evidence is insufficient; never guess continuity." : " No hard check may be failed for the absence of approved authority images."}`;
    const assistant = await requestVisionResult(ENTITY_CANDIDATE_REVIEW_SYSTEM, user, images, {
      label: "Entity candidate reviewer",
      maxTokens: 3200,
      provider: visionProvider,
      parse: (raw) => {
        const parsed = parseReviewJson(raw);
        if (!parsed) throw new Error("vision model returned an unstructured review");
        return normalizeEntityCandidateReview(parsed, {
          requiredHardChecks,
          authoritySignature,
          authorityMode,
          derivedState: !state.isDefault,
          parentStateName: entityReviewParentState(entity, state)?.name || "",
          declaredRequirements: declaredState.requirements,
          omittedRequirements: declaredState.omitted,
          driftComparisonAvailable: hasAuthority,
        });
      },
    });
    res.json({
      review: assistant.value,
      state: { id: state.id || "state-default", name: state.name || "Default", appliesTo: state.appliesTo || "" },
      relatedStates,
      inputLabels,
      requiredHardChecks,
      declaredRequirements: declaredState.requirements,
      authorityMode,
      authoritySignature,
      /* Who actually served this review, resolved at dispatch and reported with
         the result. A later Settings change must not be able to rewrite the
         attribution of a review that has already run. */
      reviewer: { provider: assistant.provider || "", model: assistant.model || "" },
      contractVersion: ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
      assistantAttempts: assistant.attempts,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "entity candidate review failed" });
  }
});

async function performShotCandidateReview(shotId) {
  const visionProvider = aiVisionProviderOverride();
  const P = readJsonSync(DATA());
  const source = reviewCriteria(P, "shot", null, shotId);
  const totalFiles = source.files.length;
  const files = source.files.slice(0, REVIEW_MAX_FILES);
  if (!files.length) throw new Error("no candidate images on disk");
  const names = files.map((f) => path.basename(f));
  const criteriaText = source.criteria.join("\n");
  const aggregate = [],
    batches = [];
  for (let offset = 0; offset < files.length; offset += REVIEW_BATCH_SIZE) {
    const batchFiles = files.slice(offset, offset + REVIEW_BATCH_SIZE);
    const ids = batchFiles.map((_, i) => offset + i + 1);
    const batchNames = batchFiles.map((f) => path.basename(f));
    const images = batchFiles.map((f) => fs.readFileSync(f).toString("base64"));
    const assistant = await requestVisionResult(
      REVIEW_BATCH_SYSTEM,
      "CANDIDATE IDS / IMAGE ORDER:\n" +
        batchNames.map((n, i) => ids[i] + " = " + n).join("\n") +
        "\n\nCRITERIA:\n" +
        criteriaText,
      images,
      {
        label: "Agent candidate review assistant",
        maxTokens: 1800,
        provider: visionProvider,
        model: readConfig().agents?.models?.vision || undefined,
        parse: (raw) => {
          const parsed = parseReviewJson(raw);
          if (!parsed) throw new Error("vision model returned an unstructured review");
          return normalizeReviewItems(parsed, ids);
        },
      },
    );
    aggregate.push(...assistant.value);
    batches.push({ ids, count: ids.length });
  }
  const preliminary = [...aggregate].sort(
    (a, b) =>
      b.score - a.score || (b.pass ? 1 : 0) - (a.pass ? 1 : 0) || a.n - b.n,
  );
  const finalistIds = preliminary
    .slice(0, Math.min(REVIEW_BATCH_SIZE, preliminary.length))
    .map((x) => x.n);
  let finalParsed = null;
  if (finalistIds.length > 1) {
    const finalistFiles = finalistIds.map((n) => files[n - 1]);
    const prior = finalistIds
      .map((n) => {
        const x = aggregate.find((r) => r.n === n);
        return `${n} = ${names[n - 1]} | preliminary ${x?.score || 0}/100 | ${x?.notes || ""}`;
      })
      .join("\n");
    const assistant = await requestVisionResult(
      REVIEW_FINAL_SYSTEM,
      "FINALIST IDS / IMAGE ORDER:\n" +
        finalistIds
          .map((n, i) => `${n} = ${path.basename(finalistFiles[i])}`)
          .join("\n") +
        "\n\nPRELIMINARY OBSERVATIONS:\n" +
        prior +
        "\n\nCRITERIA:\n" +
        criteriaText,
      finalistFiles.map((f) => fs.readFileSync(f).toString("base64")),
      {
        label: "Agent finalist review assistant",
        maxTokens: 2200,
        provider: visionProvider,
        model: readConfig().agents?.models?.vision || undefined,
        parse: (raw) => {
          const parsed = parseReviewJson(raw);
          if (!parsed) throw new Error("vision model returned an unstructured finalist review");
          return parsed;
        },
      },
    );
    finalParsed = assistant.value;
  }
  const finalReviews = finalParsed
    ? normalizeReviewItems(finalParsed, finalistIds, false)
    : [];
  const merged = aggregate
    .map((x) => finalReviews.find((y) => y.n === x.n) || x)
    .sort((a, b) => a.n - b.n);
  let ranking = finalParsed
    ? normalizeRanking(finalParsed.ranking, finalistIds)
    : [];
  if (!ranking.length) ranking = preliminary.map((x) => x.n);
  for (const x of preliminary.map((x) => x.n))
    if (!ranking.includes(x)) ranking.push(x);
  let suggested = Number(finalParsed?.suggested);
  if (
    !finalistIds.includes(suggested) &&
    suggested >= 1 &&
    suggested <= finalistIds.length
  )
    suggested = finalistIds[suggested - 1];
  if (!finalistIds.includes(suggested)) suggested = ranking[0];
  return {
    files: names,
    review: {
      reviews: merged,
      ranking,
      suggested,
      rationale: String(
        finalParsed?.rationale ||
          `Compared ${files.length} candidates in ${batches.length} small batches and rechecked the strongest finalists.`,
      ),
    },
    strategy: {
      mode:
        files.length > REVIEW_BATCH_SIZE ? "batched-finalists" : "small-batch",
      batchSize: REVIEW_BATCH_SIZE,
      batches: batches.length,
      finalists: finalistIds,
      reviewed: files.length,
      total: totalFiles,
      omitted: Math.max(0, totalFiles - files.length),
    },
  };
}

/* ---- declared-entity continuity: single-image observation ----------------

   The only vision consumer that sends exactly one image. Everything about the
   request is the contract qualified on the Spark: the prompt, the generated
   entity-keyed schema, and the sampling settings. None of it is assembled
   here — it comes from public/shared-continuity.js so the app and the offline
   contract tests cannot drift apart. */
const CONTINUITY_MAX_IMAGES = 1;

/* HIT/MISS tracing is opt-in: it is useful during qualification and noise in
   normal use. Cache corruption is always reported, because it silently costs
   model calls and is worth knowing about. */
const CONTINUITY_DEBUG = !!process.env.CINEBRAID_CONTINUITY_DEBUG;
function continuityLog(message) {
  if (CONTINUITY_DEBUG) console.log(`  continuity: ${message}`);
}
const continuityCache = createContinuityCache({
  projectDir: PROJECT_DIR,
  atomicWriteJson,
  log: (message) => console.log(`  continuity: ${message}`),
});

/* One resolution, used for both halves of a request: where it is dispatched
   and how its evidence is addressed. Deriving them separately is how a cache
   could start answering for a connection that is no longer the one in use.

   `endpoint` is handed to the dispatcher only when continuity has an address of
   its own; riding on the chosen provider's connection stays the default path,
   byte-identical to Phase 2. `endpointHash` is always the EFFECTIVE address —
   after the inherit-or-override rule has been applied — so an install that
   inherits is fingerprinted by what it actually reaches, not by a blank field. */
function continuityExecution(cfg = readConfig()) {
  const connection = continuityConnection(cfg);
  return {
    endpoint: connection.standalone ? { baseUrl: connection.baseUrl, apiKey: connection.apiKey } : null,
    endpointHash: continuityCache.endpointFingerprint(connection.baseUrl),
  };
}
function continuityFrameImage(P, shot, frameId, requestedFile) {
  const frames = Array.isArray(shot.keyframes) ? shot.keyframes : [];
  const frame = frameId ? frames.find((item) => String(item.id) === String(frameId)) : frames[0];
  if (frameId && !frame) throw Object.assign(new Error("frame not found"), { status: 404 });
  /* Only a basename is ever accepted, and only from this shot's own takes
     directory. The browser never names a path. */
  const name = path.basename(String(requestedFile || frame?.winner || shot.winner || ""));
  if (!name) throw Object.assign(new Error("This frame has no approved still to observe."), { status: 400 });
  if (!IMG_ONLY(name)) throw Object.assign(new Error("Continuity observation needs a still image."), { status: 400 });
  const file = path.join(PROJECT_DIR(), "shots", String(shot.id), "takes", name);
  const root = path.resolve(PROJECT_DIR());
  if (!path.resolve(file).startsWith(root + path.sep) || !fs.existsSync(file))
    throw Object.assign(new Error("The requested frame image is not available."), { status: 400 });
  return { frame: frame || null, name, file };
}
/* Deliberately not requestVisionResult(): that helper appends recovery text to
   the user message between attempts, and the observation prompt is part of the
   qualified contract. A retry here re-sends the identical request. */
async function requestContinuityObservation(system, user, imageB64, schema, options = {}) {
  if (!Array.isArray(imageB64) || imageB64.length !== CONTINUITY_MAX_IMAGES)
    throw Object.assign(
      new Error(`Continuity observation sends exactly one image; ${Array.isArray(imageB64) ? imageB64.length : 0} were prepared.`),
      { status: 500 },
    );
  const requestOptions = {
    jsonSchema: schema,
    schemaName: Continuity.OBSERVATION_SCHEMA_NAME,
    contract: Continuity.OBSERVATION_REQUEST_CONTRACT,
    /* Where, not what. The body below is unchanged — this only says which
       OpenAI-compatible service receives it, because continuity's endpoint is
       configured separately from the general custom provider's. */
    endpoint: options.endpoint || null,
  };
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await vision(system, user, imageB64, Continuity.OBSERVATION_REQUEST_CONTRACT.max_tokens, options.provider, options.model, requestOptions);
      if (!String(raw || "").trim()) throw new Error("Continuity observation returned an empty response.");
      return { raw, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (assistantErrorIsPermanent(error) || /reasoning but no final answer/i.test(String(error?.message || ""))) break;
    }
  }
  throw new Error(`Continuity observation failed: ${lastError?.message || "unknown error"}`);
}

/* Cache-first observation. One code path serves /observe and /compare, so a
   comparison can never take a different route to the model than a direct
   observation does.

   On a MISS the request is byte-for-byte the qualified Phase 2 request: the
   cache wraps that path, it does not participate in it. */
async function observeContinuityFrame(P, shot, frameId, requestedFile, context) {
  const image = continuityFrameImage(P, shot, frameId, requestedFile);
  const resolvedFrameId = image.frame?.id || String(frameId || "");
  const manifest = Continuity.buildContinuityManifest(P, shot, resolvedFrameId);
  if (!manifest.entities.length)
    throw Object.assign(
      new Error("This shot declares no tracked continuity entities. Assign its cast, location or props before observing a frame."),
      { status: 400 },
    );

  const imageHash = continuityCache.hashImageFile(image.file);
  const identity = {
    contractVersion: Continuity.CONTINUITY_OBSERVATION_CONTRACT_VERSION,
    promptVersion: Continuity.OBSERVATION_PROMPT_VERSION,
    imageHash,
    manifestHash: manifest.manifestHash,
    provider: context.provider,
    model: context.model || "",
    /* Fingerprint of the address this request will actually be executed
       against, resolved by the same continuityConnection() call that chose
       where to dispatch it — so cache identity IS execution identity rather
       than a second guess at it. */
    endpointHash: context.endpointHash || "",
  };
  const key = continuityCache.observationKey(identity);
  const entityIds = manifest.entities.map((row) => row.entity_id);

  const hit = continuityCache.lookup(key, { ...identity, key, entityIds });
  if (hit) {
    /* status/usable are derived, so an entry written before they existed gains
       them on read from the flags and states it already stores. No cache format
       bump and no re-observation. */
    const cachedValidation = hit.validation.status
      ? hit.validation
      : (() => {
        const status = Continuity.observationStatus(hit.validation.flags, hit.validation.states);
        return { ...hit.validation, status, usable: status !== "invalid", blockingFlags: [...new Set((hit.validation.flags || []).filter((flag) => Continuity.OBSERVATION_FLAG_SCOPE[flag.code] === "set").map((flag) => flag.code))].sort() };
      })();
    continuityLog(`HIT  ${key.slice(0, 12)} ${shot.id}/${resolvedFrameId} img=${imageHash.slice(0, 8)} man=${manifest.manifestHash.slice(0, 8)}`);
    return {
      cached: true, key, imageHash, manifest, image, frameId: resolvedFrameId,
      observation: hit.observation, validation: cachedValidation, attempts: 0,
      provider: identity.provider, model: identity.model,
      recovery: ContinuityJson.RECOVERY_NONE,
    };
  }
  continuityLog(`MISS ${key.slice(0, 12)} ${shot.id}/${resolvedFrameId} img=${imageHash.slice(0, 8)} man=${manifest.manifestHash.slice(0, 8)} -> ${identity.provider}`);

  const schema = Continuity.buildObservationSchema(manifest);
  const prompt = Continuity.buildObservationPrompt(manifest);
  const images = [fs.readFileSync(image.file).toString("base64")];
  const assistant = await requestContinuityObservation(prompt.system, prompt.user, images, schema, context);
  /* Tolerant only about the serialization envelope. A valid response takes the
     normal path untouched; a response the decoder failed to terminate is closed
     structurally and then judged by exactly the same validator. Recovery cannot
     make a schema-invalid answer acceptable — it can only stop a complete,
     correct observation being discarded over a missing brace. */
  const decoded = ContinuityJson.parseContinuityResponse(cleanModelJson(assistant.raw));
  if (!decoded.ok)
    throw Object.assign(
      new Error("The continuity provider did not return parsable JSON for a strict schema request."),
      { status: 502 },
    );
  if (decoded.recovery !== ContinuityJson.RECOVERY_NONE)
    /* Always logged, like cache corruption: it is a provider anomaly worth
       knowing about. Identifiers only — never the response, never the image. */
    console.log(`  continuity: continuity_response_recovered method=${decoded.recovery} shot=${shot.id} frame=${resolvedFrameId}`);
  const parsed = decoded.value;
  const validation = Continuity.validateObservationSet(manifest, parsed);
  const observation = { coordinate_mode: validation.coordinate_mode, entities: validation.entities };
  const stored = {
    ok: validation.ok, status: validation.status, usable: validation.usable,
    blockingFlags: validation.blockingFlags, flags: validation.flags, states: validation.states,
    invalidEntityIds: validation.invalidEntityIds, contractVersion: validation.contractVersion,
  };

  /* A truthful observation is evidence even when it is uncertain: heavy
     occlusion and unreadable attributes are answers, and re-asking the model
     will not make them go away. What is never cached is a non-answer — a
     provider error, an empty reply, or output that could not be parsed at all,
     none of which reach this point.

     Admission is the validation contract's own answer. validation.usable is
     false exactly when the set cannot be trusted: a set-wide integrity failure
     such as a wrong coordinate frame, or a response in which no declared record
     survived. Deciding this here from a separate rule is how the two drifted
     apart in the first place. */
  const usable = validation.usable;
  if (usable) {
    await continuityCache.store({
      key, observedAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(),
      shotId: String(shot.id), frameId: resolvedFrameId, imageName: image.name,
      imageHash, manifestHash: manifest.manifestHash,
      contractVersion: identity.contractVersion, promptVersion: identity.promptVersion,
      provider: identity.provider, model: identity.model,
      /* The fingerprint, never the address. Which connection produced this
         evidence is internal provenance the cache needs; a deployment's
         endpoint is not something to write into a project directory. */
      endpointHash: identity.endpointHash,
      observation, validation: stored,
    });
  } else {
    continuityLog(`NOSTORE ${key.slice(0, 12)} validation.status=${validation.status}${validation.blockingFlags.length ? ` (${validation.blockingFlags.join(",")})` : ""}`);
  }

  return {
    cached: false, key, imageHash, manifest, image, frameId: resolvedFrameId,
    observation, validation: stored, attempts: assistant.attempts,
    provider: identity.provider, model: identity.model,
    /* Diagnostics for the next qualification run, deliberately NOT persisted:
       the cache stores the normalized observation, and how its transport
       envelope arrived says nothing about the evidence. */
    recovery: decoded.recovery,
  };
}
function continuityObservationResponse(result) {
  return {
    cached: result.cached,
    fileName: result.image.name,
    imageHash: result.imageHash,
    manifestHash: result.manifest.manifestHash,
    observation: result.observation,
    validation: result.validation,
  };
}

app.post("/api/continuity/observe", async (req, res) => {
  try {
    const provider = continuityVisionProvider();
    const cfg = readConfig();
    const P = readJsonSync(DATA());
    const shotId = path.basename(String(req.body?.shotId || ""));
    const shot = (P.shots || []).find((item) => String(item.id) === shotId);
    if (!shot) return res.status(404).json({ error: "shot not found" });
    const model = continuityVisionModel(cfg) || undefined;
    const execution = continuityExecution(cfg);
    const result = await observeContinuityFrame(P, shot, String(req.body?.frameId || ""), req.body?.fileName, { provider, model, ...execution });
    return res.json({
      ok: true,
      shotId,
      frameId: result.frameId,
      fileName: result.image.name,
      manifest: {
        manifestVersion: result.manifest.manifestVersion,
        contractVersion: result.manifest.contractVersion,
        manifestHash: result.manifest.manifestHash,
        n: result.manifest.n,
        entities: result.manifest.entities,
      },
      observation: result.observation,
      validation: result.validation,
      /* Provider identity only. The endpoint address and key stay server-side. */
      engine: {
        provider: result.provider, model: result.model,
        promptVersion: Continuity.OBSERVATION_PROMPT_VERSION,
        schemaName: Continuity.OBSERVATION_SCHEMA_NAME,
        imagesSent: result.cached ? 0 : 1, attempts: result.attempts,
        /* "none" unless the decoder failed to terminate its JSON and CineBraid
           closed it. Reported so a qualification run can measure the rate
           without scraping logs; nothing stores or renders it. */
        recovery: result.recovery || ContinuityJson.RECOVERY_NONE,
      },
      imageHash: result.imageHash,
      cached: result.cached,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "continuity observation failed" });
  }
});

/* Deterministic comparison. Two independently observed frames are compared by
   stable entity id inside CineBraid. The model is never shown both frames and
   is never asked to compare anything — on a warm cache this route makes no
   provider request at all. */
app.post("/api/continuity/compare", async (req, res) => {
  try {
    const provider = continuityVisionProvider();
    const cfg = readConfig();
    const P = readJsonSync(DATA());
    const shotId = path.basename(String(req.body?.shotId || ""));
    const shot = (P.shots || []).find((item) => String(item.id) === shotId);
    if (!shot) return res.status(404).json({ error: "shot not found" });
    const frameA = String(req.body?.frameA || "");
    const frameB = String(req.body?.frameB || "");
    if (!frameA || !frameB) return res.status(400).json({ error: "Two frames are required to compare." });
    if (frameA === frameB) return res.status(400).json({ error: "Choose two different frames to compare." });
    const model = continuityVisionModel(cfg) || undefined;
    const execution = continuityExecution(cfg);

    const a = await observeContinuityFrame(P, shot, frameA, req.body?.fileNameA, { provider, model, ...execution });
    const b = await observeContinuityFrame(P, shot, frameB, req.body?.fileNameB, { provider, model, ...execution });

    /* Frame manifests may legitimately differ — an entity can be declared on
       one frame and not the other. The union is compared so a declaration
       difference surfaces as a missing record (human review) rather than being
       silently dropped or invented. */
    const union = [...a.manifest.entities];
    const seen = new Set(union.map((row) => row.entity_id));
    for (const row of b.manifest.entities) if (!seen.has(row.entity_id)) { union.push(row); seen.add(row.entity_id); }
    union.sort((x, y) => (x.entity_id < y.entity_id ? -1 : x.entity_id > y.entity_id ? 1 : 0));
    const comparisonManifest = { ...a.manifest, entities: union, n: union.length };

    const sideA = { entities: a.observation.entities, states: a.validation.states };
    const sideB = { entities: b.observation.entities, states: b.validation.states };
    const raw = Continuity.compareObservations(sideA, sideB, comparisonManifest);
    const comparison = Continuity.applyIntent(raw, {
      shot,
      manifestA: a.manifest,
      manifestB: b.manifest,
      humanIntentional: plainObject(shot.continuityIntentAccepted),
    });

    const labelA = a.image.frame?.label ? `Frame ${a.image.frame.label}` : "the first frame";
    const labelB = b.image.frame?.label ? `Frame ${b.image.frame.label}` : "the second frame";
    /* Presentation semantics come from the shared core, so the words a user
       reads are the same words the offline suites assert. */
    const described = Continuity.describeComparison(comparison, comparisonManifest, {
      frameALabel: labelA,
      frameBLabel: labelB,
    });
    /* An unusable observation is an analysis failure, not a continuity verdict.
       Saying so here keeps every caller from re-deriving it from flags. */
    const analysis = {
      usable: a.validation.usable !== false && b.validation.usable !== false,
      unusableFrames: [
        ...(a.validation.usable === false ? [{ side: "a", frameId: a.frameId, label: labelA }] : []),
        ...(b.validation.usable === false ? [{ side: "b", frameId: b.frameId, label: labelB }] : []),
      ],
      notes: a.validation.status === "usable_with_notes" || b.validation.status === "usable_with_notes",
    };

    return res.json({
      ok: true,
      comparisonVersion: comparison.comparisonVersion,
      shotId,
      frameA: { frameId: a.frameId, fileName: a.image.name, label: a.image.frame?.label || "" },
      frameB: { frameId: b.frameId, fileName: b.image.name, label: b.image.frame?.label || "" },
      observations: { a: continuityObservationResponse(a), b: continuityObservationResponse(b) },
      analysis,
      entities: described.entities,
      outcomeCounts: described.counts,
      changes: comparison.changes,
      uncertain: comparison.uncertain,
      shadeDrift: comparison.shade_drift,
      attributeUnreadable: comparison.attribute_unreadable,
      presenceUncertain: comparison.presence_uncertain,
      invalidRecords: comparison.invalid_records,
      summary: {
        label: comparison.label,
        content: comparison.content,
        needsReview: comparison.needsReview,
        nearMissIntentCount: comparison.nearMissIntentCount,
        nEntities: comparison.n_entities,
        changes: comparison.changes.length,
        uncertain: comparison.uncertain.length,
        shadeDrift: comparison.shade_drift.length,
        attributeUnreadable: comparison.attribute_unreadable.length,
        presenceUncertain: comparison.presence_uncertain.length,
        invalidRecords: comparison.invalid_records.length,
      },
      intentDescriptors: comparison.intentDescriptors,
      engine: {
        provider, model: model || "",
        promptVersion: Continuity.OBSERVATION_PROMPT_VERSION,
        modelComparisonCalls: 0,
        providerRequests: (a.cached ? 0 : 1) + (b.cached ? 0 : 1),
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "continuity comparison failed" });
  }
});

/* Purge derived evidence. Never touches media or project data. Scoped to the
   active project and filtered only by identifiers the app already owns — no
   cache keys and no paths are accepted from the browser. */
app.delete("/api/continuity/cache", async (req, res) => {
  try {
    const shotId = req.query?.shotId ? path.basename(String(req.query.shotId)) : "";
    const frameId = req.query?.frameId ? String(req.query.frameId) : "";
    if (frameId && !shotId) return res.status(400).json({ error: "A frame purge needs its shot." });
    if (shotId) {
      const P = readJsonSync(DATA());
      if (!(P.shots || []).some((item) => String(item.id) === shotId)) return res.status(404).json({ error: "shot not found" });
    }
    const before = continuityCache.stats().size;
    const result = await continuityCache.purge({ shotId, frameId });
    return res.json({ ok: true, scope: frameId ? "frame" : shotId ? "shot" : "project", shotId, frameId, removed: result.removed || 0, before, after: result.size });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "continuity cache purge failed" });
  }
});
app.get("/api/continuity/cache", (req, res) => {
  try {
    return res.json({ ok: true, ...continuityCache.stats() });
  } catch (error) {
    return res.status(500).json({ error: error.message || "continuity cache is unavailable" });
  }
});

/* ---- bounded local agent suite ---- */
const AGENT_LABELS = {
  coordinator: "Production Coordinator",
  continuity: "Continuity Inspector",
  librarian: "Project Librarian",
  reviewer: "Candidate Reviewer",
  promptGuardian: "Prompt Guardian",
  system: "System Assistant",
};
function agentEnabled(type, cfg = readConfig()) {
  return !!cfg.agents?.enabled && cfg.agents?.[type]?.enabled !== false;
}
function agentRuns(P) {
  P.agentRuns = Array.isArray(P.agentRuns) ? P.agentRuns : [];
  return P.agentRuns;
}
function agentIndexMeta(P = null) {
  const file = path.join(PROJECT_DIR(), "agent-index.json");
  if (!fs.existsSync(file)) return { ready: false, stale: true };
  try {
    const x = readJsonSync(file);
    const project = P || readProject();
    const currentFingerprint = AgentSuite.projectSourceFingerprint(
      project,
      PROJECT_DIR(),
    );
    const stale =
      !x.sourceFingerprint || x.sourceFingerprint !== currentFingerprint;
    return {
      ready: true,
      stale,
      createdAt: x.createdAt,
      count: x.count,
      embeddingModel: x.embeddingModel,
      freshness: stale ? "STALE" : "CURRENT",
      reason: !x.sourceFingerprint
        ? "Rebuild once to enable freshness tracking."
        : stale
          ? "Project planning records or source documents changed."
          : "Index matches the current project record.",
    };
  } catch (e) {
    return { ready: false, stale: true, error: e.message };
  }
}
function resolvedVisionProvider(cfg) {
  const selected = cfg.assistant?.visionProvider || "same";
  return selected === "same"
    ? cfg.assistant?.provider || "ollama"
    : selected;
}
function providerConfigured(provider, cfg) {
  if (provider === "ollama") return true;
  if (provider === "anthropic") return !!cfg.anthropicKey;
  if (provider === "openai") return !!cfg.openaiKey;
  if (provider === "custom")
    return !!cfg.customBaseUrl && !!cfg.customModel;
  return provider === "none";
}
/* agents.models.* name exact Ollama tags, so they cannot describe a model on another
   provider. Every other provider states its own models in its own settings. */
function providerCapabilityModel(provider, cfg, kind) {
  if (provider === "custom")
    return kind === "vision"
      ? cfg.customVisionModel || cfg.customModel || ""
      : cfg.customModel || "";
  if (provider === "openai")
    return kind === "vision"
      ? cfg.openaiVisionModel || cfg.openaiModel || ""
      : cfg.openaiModel || "";
  if (provider === "anthropic")
    return kind === "vision"
      ? cfg.anthropicVisionModel || cfg.anthropicModel || ""
      : cfg.anthropicModel || "";
  return "";
}
function capabilityCheck(label, provider, ollamaModel, inventories, cfg, kind = "text") {
  const model = providerCapabilityModel(provider, cfg, kind) || ollamaModel;
  if (provider === "none")
    return {
      ready: false,
      label,
      provider,
      model: model || "",
      message: `${label} is disabled in AI Assistant settings.`,
      action: "Choose an AI provider in Settings.",
    };
  if (provider === "ollama") {
    const inventory = inventories.ollama;
    if (!inventory.ok)
      return {
        ready: false,
        label,
        provider,
        model: model || "",
        message: `Ollama is not reachable at ${inventory.base}.`,
        action: `Start Ollama, then retry. Expected model: ${model || "not configured"}.`,
      };
    if (!cleanModelName(model))
      return {
        ready: false,
        label,
        provider,
        model: "",
        message: `${label} has no model configured.`,
        action: "Choose an exact Ollama model tag in Settings.",
      };
    if (!exactModelReady(inventory.models, model))
      return {
        ready: false,
        label,
        provider,
        model,
        message: `${label} model \"${model}\" is not installed.`,
        action: `ollama pull ${model}`,
      };
    return {
      ready: true,
      label,
      provider,
      model,
      message: `${label} is ready with ${model}.`,
      action: "",
    };
  }
  if (!providerConfigured(provider, cfg))
    return {
      ready: false,
      label,
      provider,
      model: model || "",
      message: `${label} provider ${provider} is not configured.`,
      action: "Complete the provider connection in Settings.",
    };
  /* A configured custom server still has to answer. Ollama's readiness is not part of
     this: a healthy custom text provider is enough to work with, and an unreachable
     one fails closed rather than leaving controls enabled that cannot run. */
  if (provider === "custom") {
    const custom = inventories.custom || UNPROBED_CUSTOM;
    if (!custom.ok)
      return {
        ready: false,
        label,
        provider,
        model: model || "",
        message: `${label} cannot reach the custom AI server${custom.error ? ` (${custom.error})` : ""}.`,
        action: "Start the custom AI server, or correct its address and key in Settings, then retry.",
      };
    if (custom.models.length && !custom.models.includes(model))
      return {
        ready: false,
        label,
        provider,
        model: model || "",
        message: `${label} model "${model}" is not served by the custom AI server.`,
        action: `Use one of the served model names: ${custom.models.slice(0, 6).join(", ")}.`,
      };
    return {
      ready: true,
      label,
      provider,
      model,
      message: `${label} is ready with ${model}.`,
      action: "",
    };
  }
  return {
    ready: true,
    label,
    provider,
    model: model || "provider default",
    message: `${label} is configured through ${provider}.`,
    action: "",
  };
}
function summarizeReadiness(hard, soft, readyDetail) {
  const blocked = hard.filter((x) => !x.ready);
  const degraded = soft.filter((x) => !x.ready);
  const checks = [...hard, ...soft];
  if (blocked.length)
    return {
      status: "blocked",
      label: "NEEDS SETUP",
      detail: blocked[0].message,
      action: blocked[0].action,
      checks,
    };
  if (degraded.length)
    return {
      status: "degraded",
      label: "FALLBACK READY",
      detail: degraded[0].message,
      action: degraded[0].action,
      checks,
    };
  return {
    status: "ready",
    label: "READY",
    detail: readyDetail,
    action: "",
    checks,
  };
}
async function agentReadiness(type, cfg = readConfig(), inventories = null) {
  const inv = inventories || (await providerInventories(cfg));
  const textProvider = cfg.assistant?.provider || "ollama";
  const visionProvider = resolvedVisionProvider(cfg);
  const plannerModel = cfg.agents?.models?.coordinator || cfg.ollamaModel;
  const verifierModel =
    cfg.agents?.models?.verifier ||
    cfg.agents?.models?.coordinator ||
    cfg.ollamaModel;
  const visionModel = cfg.agents?.models?.vision || cfg.ollamaVisionModel;
  const embeddingModel =
    cfg.agents?.models?.embedding || cfg.ollamaEmbedModel;
  const coderModel = cfg.agents?.models?.coder || "";
  const text = (label, model = plannerModel) =>
    capabilityCheck(label, textProvider, model, inv, cfg);
  const visual = (label) =>
    capabilityCheck(label, visionProvider, visionModel, inv, cfg, "vision");
  const localEmbedding = capabilityCheck(
    "Local semantic search",
    "ollama",
    embeddingModel,
    inv,
    cfg,
  );

  if (type === "librarian")
    return summarizeReadiness(
      [localEmbedding],
      [],
      `Semantic indexing will use ${embeddingModel}.`,
    );
  if (type === "continuity")
    return summarizeReadiness(
      [visual("Visual inspection"), text("Continuity verification", verifierModel)],
      [],
      "Visual inspection and continuity verification are ready.",
    );
  if (type === "reviewer")
    return summarizeReadiness(
      [visual("Candidate vision review")],
      [],
      "Candidate vision review is ready.",
    );
  if (type === "coordinator")
    return summarizeReadiness(
      [text("AI prioritization", plannerModel)],
      [],
      "AI prioritization is ready.",
    );
  if (type === "promptGuardian")
    return summarizeReadiness(
      [text("Prompt verification", verifierModel)],
      [],
      "AI verification and deterministic playbook checks are ready.",
    );
  if (type === "system")
    return summarizeReadiness(
      [text("Technical analysis", coderModel || plannerModel)],
      [],
      "Runtime checks and technical-model analysis are ready.",
    );
  return summarizeReadiness([], [], "Agent is ready.");
}
/* Continuity's readiness, answered from the fields continuity actually uses.

   It deliberately does NOT go through providerConfigured(), which asks a custom
   provider for customBaseUrl AND customModel — customModel being the general
   TEXT model, which continuity never sends anything to. A valid standalone
   continuity service was reported unready because an unrelated text model was
   blank. Readiness now asks the three questions that are true of continuity:
   which provider, at which address, serving which model. */
function continuityCapability(cfg = readConfig(), inventories = null) {
  const label = "Continuity observation";
  const connection = continuityConnection(cfg);
  const base = { label, provider: connection.provider || "none", model: connection.model || "" };
  /* Unset is not the same as switched off, and the generic "disabled in AI
     Assistant settings / choose an AI provider" answer sends a user to the
     wrong control: continuity has its own provider precisely because it is not
     the general vision provider. It says so in its own words. */
  if (!connection.provider)
    return { ...base, ready: false, message: "Continuity analysis isn't configured.", action: "Choose a continuity vision provider in Settings." };
  if (!connection.baseUrl)
    return { ...base, ready: false, message: `${label} has no endpoint.`, action: "Set the continuity endpoint in Settings — the OpenAI-compatible base URL, including /v1." };
  if (!connection.model)
    return { ...base, ready: false, message: `${label} has no model.`, action: "Name the model the continuity server serves, in Settings." };
  if (connection.provider === "openai" && !connection.apiKey)
    return { ...base, ready: false, message: `${label} has no OpenAI key.`, action: "Complete the OpenAI connection in Settings." };
  const inventory = (inventories && inventories.continuity) || UNPROBED_CUSTOM;
  if (!inventory.configured)
    return { ...base, ready: false, message: `${label} has not been contacted yet.`, action: "Reopen Settings to retry the connection." };
  if (!inventory.ok)
    return { ...base, ready: false, message: `${label} cannot reach its AI server${inventory.error ? ` (${inventory.error})` : ""}.`, action: "Start the continuity AI server, or correct its address in Settings, then retry." };
  if (inventory.models.length && !inventory.models.includes(connection.model))
    return { ...base, ready: false, message: `${label} model "${connection.model}" is not served by the continuity AI server.`, action: `Use one of the served model names: ${inventory.models.slice(0, 6).join(", ")}.` };
  return { ...base, ready: true, message: `${label} is ready with ${connection.model}.`, action: "" };
}
function assistantCapabilities(cfg = readConfig(), inventories = null) {
  const inv = inventories || {
    ollama: { ok: false, models: [], base: cfg.ollamaUrl || "" },
    custom: UNPROBED_CUSTOM,
  };
  const textProvider = cfg.assistant?.provider || "ollama";
  const visionProvider = resolvedVisionProvider(cfg);
  const plannerModel = cfg.agents?.models?.coordinator || cfg.ollamaModel;
  const verifierModel =
    cfg.agents?.models?.verifier ||
    cfg.agents?.models?.coordinator ||
    cfg.ollamaModel;
  const visionModel = cfg.agents?.models?.vision || cfg.ollamaVisionModel;
  const embeddingModel = cfg.agents?.models?.embedding || cfg.ollamaEmbedModel;
  const coderModel = cfg.agents?.models?.coder || plannerModel;
  return {
    text: capabilityCheck("Text assistance", textProvider, plannerModel, inv, cfg),
    verifier: capabilityCheck(
      "Prompt verification",
      textProvider,
      verifierModel,
      inv,
      cfg,
    ),
    vision: capabilityCheck(
      "Vision assistance",
      visionProvider,
      visionModel,
      inv,
      cfg,
      "vision",
    ),
    /* Embeddings stay their own route. Not every text provider serves them — the
       qualified Nemotron deployment answers /v1/embeddings with 404 — so semantic
       search keeps asking Ollama for a small embedding model. */
    continuity: continuityCapability(cfg, inv),
    embedding: capabilityCheck(
      "Local semantic search",
      "ollama",
      embeddingModel,
      inv,
      cfg,
    ),
    technical: capabilityCheck(
      "Technical analysis",
      textProvider,
      coderModel,
      inv,
      cfg,
    ),
  };
}
function readinessError(type, readiness) {
  const label = AGENT_LABELS[type] || type;
  return `${label} cannot start. ${readiness.detail}${
    readiness.action ? " " + readiness.action : ""
  }`;
}
function persistAgentRun(id, mutate) {
  const P = readProject(),
    run = agentRuns(P).find((x) => x.id === id);
  if (!run) return null;
  mutate(run, P);
  run.updatedAt = new Date().toISOString();
  writeProject(P);
  return run;
}
class AgentCancelledError extends Error {
  constructor() {
    super("Agent run cancelled");
    this.name = "AgentCancelledError";
  }
}
function assertAgentNotCancelled(id) {
  if (AGENT_RUNTIME.cancelled.has(id)) throw new AgentCancelledError();
}
function updateAgentRun(id, progress, message) {
  assertAgentNotCancelled(id);
  persistAgentRun(id, (r) => {
    r.progress = Math.max(0, Math.min(100, Number(progress) || 0));
    r.message = String(message || "");
  });
}
function agentWorkload(type, cfg = readConfig()) {
  const model =
    type === "librarian"
      ? cfg.agents?.models?.embedding || cfg.ollamaEmbedModel || "embedding model"
      : ["continuity", "reviewer"].includes(type)
        ? cfg.agents?.models?.vision || cfg.ollamaVisionModel || "vision model"
        : type === "system" && cfg.agents?.models?.coder
          ? cfg.agents.models.coder
          : cfg.agents?.models?.coordinator || cfg.ollamaModel || "planner model";
  const resource =
    type === "librarian"
      ? "embedding"
      : ["continuity", "reviewer"].includes(type)
        ? "vision"
        : type === "system"
          ? "technical"
          : "planner";
  return { resource, model };
}

async function enqueueAgentRun(type, scope = {}) {
  const cfg = readConfig();
  if (!cfg.agents?.enabled)
    throw new Error("Local Agent Suite is disabled in Settings.");
  if (!agentEnabled(type, cfg))
    throw new Error((AGENT_LABELS[type] || type) + " is disabled in Settings.");
  const readiness = await agentReadiness(type, cfg);
  if (readiness.status === "blocked")
    throw new Error(readinessError(type, readiness));
  const P = readProject(),
    workload = agentWorkload(type, cfg);
  const run = {
    id: uid("agent"),
    type,
    label: AGENT_LABELS[type] || type,
    scope,
    status: "QUEUED",
    progress: 0,
    message:
      readiness.status === "degraded"
        ? "Queued with deterministic fallback available"
        : `Waiting for ${workload.resource} task slot`,
    workload,
    readiness: readiness.status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: "",
  };
  agentRuns(P).push(run);
  P.agentRuns = P.agentRuns.slice(-80);
  writeProject(P);
  AGENT_RUNTIME.queue.push({ id: run.id, type, scope, workload });
  pumpAgentQueue();
  return run;
}
async function executeAgentRun(item) {
  const cfg = readConfig();
  const P = readProject();
  const update = (pct, msg) => updateAgentRun(item.id, pct, msg);
  let result;
  assertAgentNotCancelled(item.id);
  update(2, "Starting " + (AGENT_LABELS[item.type] || item.type));
  if (item.type === "librarian")
    result = await AgentSuite.buildIndex({
      P,
      projectDir: PROJECT_DIR(),
      embedFn: embed,
      embeddingModel: cfg.agents?.models?.embedding || cfg.ollamaEmbedModel,
      update,
    });
  else if (item.type === "coordinator")
    result = await AgentSuite.runCoordinator({
      P,
      scan: scanProject(),
      projectDir: PROJECT_DIR(),
      llmFn: llm,
      visionFn: vision,
      embedFn: embed,
      config: cfg.agents || {},
      scope: item.scope || {},
      update,
    });
  else if (item.type === "continuity")
    result = await AgentSuite.runContinuity({
      P,
      projectDir: PROJECT_DIR(),
      visionFn: vision,
      llmFn: llm,
      config: cfg.agents || {},
      scope: item.scope || {},
      update,
    });
  else if (item.type === "reviewer")
    result = await AgentSuite.runCandidateTriage({
      reviewFn: performShotCandidateReview,
      scope: item.scope || {},
      update,
    });
  else if (item.type === "promptGuardian")
    result = await AgentSuite.runPromptGuardian({
      P,
      scope: item.scope || {},
      llmFn: llm,
      config: cfg.agents || {},
      update,
    });
  else if (item.type === "system")
    result = await AgentSuite.runSystemAssistant({
      projectDir: PROJECT_DIR(),
      config: cfg.agents || {},
      llmFn: llm,
      update,
    });
  else throw new Error("Unknown agent type");
  assertAgentNotCancelled(item.id);
  persistAgentRun(item.id, (r) => {
    r.status = "COMPLETED";
    r.progress = 100;
    r.message = "Complete";
    r.finishedAt = new Date().toISOString();
    r.result = result;
  });
}
function pumpAgentQueue() {
  const limit = Math.max(
    1,
    Math.min(3, Number(readConfig().agents?.maxConcurrent) || 1),
  );
  while (AGENT_RUNTIME.active < limit && AGENT_RUNTIME.queue.length) {
    const item = AGENT_RUNTIME.queue.shift();
    if (AGENT_RUNTIME.cancelled.has(item.id)) continue;
    AGENT_RUNTIME.active++;
    AGENT_RUNTIME.running.add(item.id);
    AGENT_RUNTIME.workload.set(item.id, item.workload || agentWorkload(item.type));
    persistAgentRun(item.id, (r) => {
      r.status = "RUNNING";
      r.startedAt = new Date().toISOString();
      r.message = `Using ${(item.workload || {}).model || "configured model"}`;
    });
    executeAgentRun(item)
      .catch((e) => {
        const cancelled =
          e instanceof AgentCancelledError ||
          AGENT_RUNTIME.cancelled.has(item.id);
        persistAgentRun(item.id, (r) => {
          r.status = cancelled ? "CANCELLED" : "FAILED";
          r.error = cancelled ? "" : e.message;
          r.message = cancelled ? "Cancelled" : "Failed";
          r.finishedAt = new Date().toISOString();
        });
      })
      .finally(() => {
        AGENT_RUNTIME.active--;
        AGENT_RUNTIME.running.delete(item.id);
        AGENT_RUNTIME.workload.delete(item.id);
        AGENT_RUNTIME.cancelled.delete(item.id);
        pumpAgentQueue();
      });
  }
}
function reconcileOrphanedAgentRuns(P) {
  const live = new Set([
    ...AGENT_RUNTIME.queue.map((x) => x.id),
    ...AGENT_RUNTIME.running,
  ]);
  let changed = false;
  for (const run of agentRuns(P)) {
    if (
      ["QUEUED", "RUNNING", "CANCELLING"].includes(run.status) &&
      !live.has(run.id)
    ) {
      run.status = "FAILED";
      run.message = "Interrupted by CineBraid restart";
      run.error =
        "This agent run was active when CineBraid stopped. Start a new run; no production records were changed.";
      run.finishedAt = new Date().toISOString();
      run.updatedAt = run.finishedAt;
      changed = true;
    }
  }
  if (changed) writeProject(P);
  return P;
}
function cancelAgentRun(id) {
  const P = readProject();
  const run = agentRuns(P).find((x) => x.id === id);
  if (!run) return { found: false };
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status))
    return { found: true, run };
  const queuedIndex = AGENT_RUNTIME.queue.findIndex((x) => x.id === id);
  if (queuedIndex >= 0) {
    AGENT_RUNTIME.queue.splice(queuedIndex, 1);
    const updated = persistAgentRun(id, (r) => {
      r.status = "CANCELLED";
      r.message = "Cancelled before start";
      r.finishedAt = new Date().toISOString();
    });
    return { found: true, run: updated };
  }
  if (!AGENT_RUNTIME.running.has(id)) {
    const updated = persistAgentRun(id, (r) => {
      r.status = "CANCELLED";
      r.message = "Cancelled";
      r.finishedAt = new Date().toISOString();
    });
    return { found: true, run: updated };
  }
  AGENT_RUNTIME.cancelled.add(id);
  const updated = persistAgentRun(id, (r) => {
    r.status = "CANCELLING";
    r.message = "Cancellation requested; the current model call may finish first";
  });
  return { found: true, run: updated };
}
async function maybeAutoIndex() {
  const cfg = readConfig();
  if (
    !cfg.agents?.enabled ||
    !cfg.agents?.autoIndex ||
    !agentEnabled("librarian", cfg)
  )
    return;
  const P = readProject();
  const busy = agentRuns(P).some((r) =>
    ["QUEUED", "RUNNING", "CANCELLING"].includes(r.status),
  );
  // Background indexing yields to every interactive planner or vision task on the Spark.
  if (busy) return;
  const idx = agentIndexMeta(P);
  if (idx.ready && !idx.stale) return;
  try {
    await enqueueAgentRun("librarian", { automatic: true });
  } catch {}
}
app.get("/api/agents/status", async (req, res) => {
  const cfg = readConfig();
  const P = reconcileOrphanedAgentRuns(readProject());
  const inventories = await providerInventories(cfg);
  const readiness = Object.fromEntries(
    await Promise.all(
      Object.keys(AGENT_LABELS).map(async (id) => [
        id,
        await agentReadiness(id, cfg, inventories),
      ]),
    ),
  );
  const capabilities = assistantCapabilities(cfg, inventories);
  res.json({
    enabled: !!cfg.agents?.enabled,
    manualMode: !capabilities.text.ready,
    capabilities,
    maxConcurrent: cfg.agents?.maxConcurrent || 1,
    active: AGENT_RUNTIME.active,
    queued: AGENT_RUNTIME.queue.length,
    workload: {
      running: [...AGENT_RUNTIME.workload.entries()].map(([id, x]) => ({ id, ...x })),
      queued: AGENT_RUNTIME.queue.map((x) => ({ id: x.id, type: x.type, ...(x.workload || {}) })),
      policy: (cfg.agents?.maxConcurrent || 1) === 1 ? "one-heavy-task" : "bounded-concurrency",
    },
    index: agentIndexMeta(P),
    localModels: {
      ok: inventories.ollama.ok,
      error: inventories.ollama.error,
      base: inventories.ollama.base,
      count: inventories.ollama.models.length,
    },
    playbook: {
      loaded: !!AgentSuite.PLAYBOOK,
      version: "STILL Prompt Playbook v1",
      tools: ["GPT Image 2", "Seedance 2", "Wan 2.7"],
    },
    agents: Object.entries(AGENT_LABELS).map(([id, label]) => ({
      id,
      label,
      enabled: agentEnabled(id, cfg),
      readiness: readiness[id],
    })),
    runs: [...agentRuns(P)].reverse().slice(0, 40),
  });
});
app.post("/api/agents/run", async (req, res) => {
  try {
    const type = String(req.body?.type || ""),
      scope = req.body?.scope || {};
    if (!AGENT_LABELS[type])
      return res.status(400).json({ error: "Unknown agent" });
    res.json({ ok: true, run: await enqueueAgentRun(type, scope) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/agents/runs/:id/cancel", (req, res) => {
  const result = cancelAgentRun(req.params.id);
  result.found
    ? res.json({ ok: true, run: result.run })
    : res.status(404).json({ error: "Agent run not found" });
});
app.post("/api/agents/runs/:id/archive", (req, res) => {
  const run = persistAgentRun(req.params.id, (r) => {
    r.archived = true;
  });
  run
    ? res.json({ ok: true })
    : res.status(404).json({ error: "Agent run not found" });
});
app.post("/api/agents/runs/:id/proposals/:index/dismiss", (req, res) => {
  const i = Number(req.params.index);
  const run = persistAgentRun(req.params.id, (r) => {
    if (r.result?.proposals?.[i]) r.result.proposals[i].dismissed = true;
  });
  run
    ? res.json({ ok: true })
    : res.status(404).json({ error: "Agent run not found" });
});

function findAgentRunForApply(P, id, expectedType) {
  const run = agentRuns(P).find((x) => x.id === id);
  if (!run) throw new Error("Agent run not found");
  if (run.status !== "COMPLETED") throw new Error("Agent run is not complete");
  if (expectedType && run.type !== expectedType)
    throw new Error("This apply action does not match the agent run");
  return run;
}
app.post("/api/agents/runs/:id/apply-prompt", (req, res) => {
  try {
    const P = readProject(),
      run = findAgentRunForApply(P, req.params.id, "promptGuardian"),
      replacement = String(run.result?.proposedPrompt || "").trim();
    if (!replacement) throw new Error("Prompt Guardian did not produce a replacement prompt");
    const shot = (P.shots || []).find((x) => x.id === run.scope?.shotId);
    if (!shot) throw new Error("Target shot was not found");
    const segmentId = String(run.scope?.segmentId || ""),
      unit = (shot.clips || []).find(
        (x) => String(x.id || x.suffix || "") === segmentId,
      );
    if (!unit) throw new Error("Target motion unit was not found");
    const packageRefs = unit.generationPackages || [];
    resolvePromptBuildList(P, packageRefs).forEach((resolved, i) => {
      const canonical = P.promptBuildsById?.[resolved.id];
      if (!canonical) return;
      if (!Number(canonical.revision)) canonical.revision = i + 1;
      if (!canonical.revisionReason) canonical.revisionReason = "compiled";
      if (!canonical.immutableAt) canonical.immutableAt = canonical.date || new Date().toISOString();
    });
    const packages = resolvePromptBuildList(P, packageRefs),
      packageId = run.result?.target?.packageId,
      pack =
        (packageId && packages.find((x) => x.id === packageId)) ||
        packages[packages.length - 1];
    if (!pack) throw new Error("The saved generation package is no longer available");
    const previousPrompt = String(pack.prompt || ""),
      appliedAt = new Date().toISOString(),
      revisions = packages.map((x) => Number(x.revision) || 0),
      nextRevision = Math.max(0, ...revisions) + 1,
      revised = JSON.parse(JSON.stringify(pack));
    revised.id = uid("pkg");
    revised.date = appliedAt;
    revised.revision = nextRevision;
    revised.revisionReason = "prompt-guardian";
    revised.parentPackageId = pack.id || "";
    revised.immutableAt = appliedAt;
    revised.prompt = replacement;
    revised.providerPayload = revised.providerPayload || {};
    revised.providerPayload.prompt = replacement;
    revised.guardianHistory = [
      {
        runId: run.id,
        appliedAt,
        sourcePackageId: pack.id || "",
        previousPrompt,
        replacementPrompt: replacement,
      },
    ];
    revised.updatedAt = appliedAt;
    const revisedBuildId = registerPromptBuild(P, revised);
    packageRefs.push(promptBuildRef(revisedBuildId, { kind: revised.kind || "guided-motion", scope: revised.scope || `segment:${unit.id || unit.suffix || ""}`, revisionReason: "prompt-guardian" }));
    applyPromptBuildRetention(P);
    const storedRevision = resolvePromptBuild(P, revisedBuildId);
    run.result.appliedAt = appliedAt;
    run.result.appliedPackageId = storedRevision.id;
    run.result.sourcePackageId = pack.id || "";
    run.result.previousPrompt = previousPrompt;
    run.updatedAt = appliedAt;
    writeProject(P);
    res.json({
      ok: true,
      shotId: shot.id,
      segmentId: unit.id || unit.suffix || "",
      package: storedRevision,
      sourcePackage: pack,
      run,
    });
  } catch (e) {
    res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
  }
});
function applyStageChange(P, shot, change) {
  const pathValue = String(change?.path || ""),
    value = change?.value;
  if (pathValue === "shot.desc" || pathValue === "shot.positioning") {
    shot[pathValue.split(".")[1]] = String(value || "").trim();
    return true;
  }
  if (pathValue === "shot.characters") {
    const valid = new Set((P.characters || []).map((x) => x.id));
    shot.characters = [...new Set([...(shot.characters || []), ...(Array.isArray(value) ? value : [])])].filter((x) => valid.has(x));
    return true;
  }
  if (pathValue === "shot.codes") {
    const valid = new Set(
      [...(P.locations || []), ...(P.props || []), ...(P.vehicles || []), ...(P.audio || [])].map(
        (x) => x.id,
      ),
    );
    shot.codes = [...new Set([...(shot.codes || []), ...(Array.isArray(value) ? value : [])])].filter((x) => valid.has(x));
    return true;
  }
  const frameMatch = /^frame:([^.]*)\.(title|description|notes)$/.exec(pathValue);
  if (frameMatch) {
    const frame = (shot.keyframes || []).find((x) => x.id === frameMatch[1]);
    if (!frame) return false;
    frame[frameMatch[2]] = String(value || "").trim();
    return true;
  }
  const segmentMatch = /^segment:([^.]*)\.(title|motionPrompt|vo|kind|dur)$/.exec(pathValue);
  if (segmentMatch) {
    const unit = (shot.clips || []).find((x) => x.id === segmentMatch[1]);
    if (!unit) return false;
    const field = segmentMatch[2];
    if (field === "dur") unit.dur = Math.max(0, Math.min(120, Number(value) || 0));
    else if (field === "kind") {
      if (!["i2v", "flf", "r2v", "plan", "post", "reuse"].includes(value))
        return false;
      unit.kind = value;
    } else {
      unit[field] = String(value || "").trim();
      if (field === "motionPrompt") unit.note = unit.motionPrompt;
    }
    return true;
  }
  return false;
}
app.post("/api/agents/runs/:id/apply-stage", (req, res) => {
  try {
    const P = readProject(),
      run = findAgentRunForApply(P, req.params.id, "coordinator"),
      draft = run.result?.stageDraft;
    if (!draft || !Array.isArray(draft.changes))
      throw new Error("This coordinator run does not contain a shot-stage draft");
    const shot = (P.shots || []).find((x) => x.id === draft.shotId);
    if (!shot) throw new Error("Target shot was not found");
    const applied = [];
    for (const change of draft.changes)
      if (applyStageChange(P, shot, change)) applied.push(change.path);
    if (!applied.length) throw new Error("No valid stage changes were available to apply");
    const now = new Date().toISOString();
    shot.agentChangeHistory = Array.isArray(shot.agentChangeHistory)
      ? shot.agentChangeHistory
      : [];
    shot.agentChangeHistory.push({
      runId: run.id,
      agent: "Production Coordinator",
      stage: draft.stage,
      appliedAt: now,
      fields: applied,
    });
    shot.agentChangeHistory = shot.agentChangeHistory.slice(-30);
    run.result.appliedAt = now;
    run.result.appliedFields = applied;
    run.updatedAt = now;
    writeProject(P);
    res.json({ ok: true, shotId: shot.id, applied, run });
  } catch (e) {
    res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
  }
});


/* ---- search: semantic via local embeddings, plain-text fallback ---- */
const EMB_CACHE = path.join(__dirname, "data", "embeddings.json");
function searchCorpus(P) {
  const docs = [];
  for (const s of P.shots)
    docs.push({
      type: "shot",
      id: s.id,
      title: s.id + " — " + s.title,
      text: [
        s.title,
        s.desc,
        s.positioning,
        s.safe,
        s.notes,
        (s.risks || []).join("\n"),
        (s.promptOptions || []).map((o) => o.text).join("\n"),
        resolvePromptBuildList(P, s.promptBuilds || []).map((b) => b.prompt).join("\n"),
        resolvePromptBuildList(P, s.generationPackages || []).map((b) => b.prompt).join("\n"),
        (s.clips || [])
          .flatMap((c) => [
            c.title,
            c.note,
            c.motionPrompt,
            ...resolvePromptBuildList(P, c.generationPackages || []).map((g) => g.prompt),
          ])
          .join("\n"),
        s.motionPrompt,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  for (const [list, type] of [
    ["characters", "character"],
    ["locations", "location"],
    ["props", "prop"],
  ])
    for (const e of P[list])
      docs.push({
        type,
        id: e.id,
        title: e.id + " — " + e.name,
        text: [
          e.name,
          e.block,
          e.driftNotes,
          e.notes,
          e.role,
          (e.made || []).map((g) => g.prompt).join("\n"),
          (e.prompts || []).map((p) => p.text).join("\n"),
        ]
          .filter(Boolean)
          .join("\n"),
      });
  for (const b of P.meta.styleBlocks || [])
    docs.push({
      type: "style",
      id: b.id,
      title: "Style — " + b.name,
      text: b.text,
    });
  for (const s of P.sessions)
    docs.push({
      type: "session",
      id: String(s.n),
      title: "Session " + s.n,
      text: [s.summary, (s.carryForward || []).join("\n")].join("\n"),
    });
  return docs;
}
function hashStr(t) {
  let h = 0;
  for (let i = 0; i < t.length; i++) {
    h = (h * 31 + t.charCodeAt(i)) | 0;
  }
  return String(h);
}
const cos = (a, b) => {
  let d = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb);
};
app.post("/api/search", async (req, res) => {
  const q = String(req.body.q || "").trim();
  if (!q) return res.json({ mode: "none", results: [] });
  const P = readJsonSync(DATA());
  const docs = searchCorpus(P);
  try {
    if (projectAIPolicy() === "disabled") throw new Error("AI search disabled");
    let cache = {};
    try {
      cache = readJsonSync(EMB_CACHE);
    } catch {}
    const missing = docs.filter((d) => !cache[hashStr(d.text)]);
    for (let i = 0; i < missing.length; i += 16) {
      const batch = missing.slice(i, i + 16);
      const vecs = await embed(
        batch.map((d) => d.title + "\n" + d.text.slice(0, 2000)),
      );
      batch.forEach((d, j) => (cache[hashStr(d.text)] = vecs[j]));
    }
    if (missing.length) fs.writeFileSync(EMB_CACHE, JSON.stringify(cache));
    const [qv] = await embed([q]);
    const scored = docs
      .map((d) => ({ ...d, score: cos(qv, cache[hashStr(d.text)]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    res.json({
      mode: "semantic",
      results: scored.map((d) => ({
        type: d.type,
        id: d.id,
        title: d.title,
        snippet: d.text.slice(0, 160),
      })),
    });
  } catch (e) {
    // Ollama unavailable → plain text fallback
    const ql = q.toLowerCase();
    const hits = docs
      .map((d) => ({
        ...d,
        score:
          (d.title.toLowerCase().includes(ql) ? 2 : 0) +
          (d.text.toLowerCase().includes(ql) ? 1 : 0),
      }))
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    res.json({
      mode: "text (embeddings offline)",
      results: hits.map((d) => {
        const i = d.text.toLowerCase().indexOf(ql);
        return {
          type: d.type,
          id: d.id,
          title: d.title,
          snippet:
            d.text.slice(Math.max(0, i - 40), i + 120) || d.text.slice(0, 160),
        };
      }),
    });
  }
});

/* ---- the Bible: only approved / locked canon ---- */
app.get("/api/bible", (req, res) => {
  try {
    const P = readJsonSync(DATA());
    /* MB-PT-02 — THE BIBLE PUBLISHES CANON, AND CANON IS A RECEIPT.
        `x.status === "APPROVED"` is a WORKFLOW word a run can write. An entity
        is in the Bible's approved set when the creator approved at least one of
        its states, which is a question only the ledger answers. */
    const entityCanonFiles = (listName, entity) => new Set(
      (ProductionAuthority.entityProductionTruth(P, listName, entity && entity.id).canon || [])
        .map((row) => row.value).filter(Boolean),
    );
    const approvedIn = (listName) => (x) => entityCanonFiles(listName, x).size > 0;
    const media = {
      anchors: listMedia("anchors"),
      plates: listMedia("plates"),
      props: listMedia("props"),
      vehicles: listMedia("vehicles"),
      audio: listMedia("audio"),
    };
    const modelName = (id) =>
      (P.meta.models || []).find((m) => m.id === id)?.name || "";
    /* Same exact-ownership rule as the review pool and the entity workspace. A
       Bible export that still matched by prefix would publish a child entity's
       reference under its parent's name. */
    const withMedia = (listName, list, pool) => {
      const ownerIndex = EntityOwnership.buildEntityOwnerIndex(P, listName);
      return list.map((e) => {
        const matched = EntityOwnership.filterEntityMedia(ownerIndex, e.id, pool);
        /* CANON ONLY. This fell back to EVERY owned file when the entity had no
            raw pointer, so a supporting image entered a document that describes
            itself as approved production truth. An entity with no canon
            contributes no approved media, which is the honest answer. */
        const canonFiles = entityCanonFiles(listName, e);
        const selected = matched.filter((m) => canonFiles.has(m.name));
        return {
          ...e,
          made: (e.made || []).map((g) => ({
            ...g,
            modelName: modelName(g.model),
          })),
          media: selected,
        };
      });
    };
    const shots = P.shots
      .filter((s) => s.status === "LOCKED" || s.workflowStatus === "APPROVED")
      .map((s) => {
        const takes = listMedia(path.join("shots", s.id, "takes"));
        const locked = listMedia(path.join("shots", s.id, "locked"));
        const allMedia = [
          ...takes,
          ...locked.filter((x) => !takes.some((t) => t.name === x.name)),
        ];
        const findMedia = (name) =>
          name ? allMedia.find((t) => t.name === name) || null : null;
        const keyframes = (s.keyframes || []).map((f, i) => ({
          id: f.id || `frame-${i + 1}`,
          label: f.label || String.fromCharCode(65 + i),
          title: f.title || `Frame ${String.fromCharCode(65 + i)}`,
          description: f.description || "",
          notes: f.notes || "",
          required: f.required !== false,
          /* CANON ONLY. `f.winner` is a pointer; the Bible publishes decisions. */
          winner: ProductionAuthority.hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: s.id, frameId: f.id })
            ? findMedia(f.winner)
            : null,
          package:
            resolvePromptBuildList(P, f.generationPackages || [])
              .slice()
              .reverse()
              .find((g) => g.prompt) || null,
        }));
        const motions = (s.clips || []).map((c, i) => {
          const from =
            keyframes.find((f) => f.id === c.fromFrame)?.label ||
            keyframes[0]?.label ||
            "";
          const to = keyframes.find((f) => f.id === c.toFrame)?.label || "";
          return {
            id: c.id || `motion-${i + 1}`,
            label: c.label || c.suffix || String.fromCharCode(65 + i),
            title: c.title || "Motion unit",
            kind: c.kind || "plan",
            from,
            to,
            dur: +c.dur || 0,
            direction: c.motionPrompt || c.note || "",
            line: c.line || "",
            speakerId: c.speakerId || "",
            audioNote: c.audioNote || c.vo || "",
            winner: ProductionAuthority.hasCurrentHumanAuthority(P, { kind: "shot-motion", shotId: s.id, unitKey: c.id || c.suffix || "" })
              ? findMedia(c.videoWinner)
              : null,
            package:
              resolvePromptBuildList(P, c.generationPackages || [])
                .slice()
                .reverse()
                .find((g) => g.prompt) || null,
          };
        });
        /* `locked[0]` IS DELETED. It promoted the first file that happened to be
            on disk into a document that says these media are approved — file
            presence standing in for a decision. The shot headline is the opening
            frame's canon, or the shot's canon deliverable, or nothing. */
        const primaryFrame = keyframes.find((f) => f.winner)?.winner;
        const deliveryCanon = ProductionAuthority.hasCurrentHumanAuthority(P, { kind: "shot-delivery", shotId: s.id })
          ? findMedia(s.finalStillFile || (s.creationBrief || {}).finalStillFile || (s.creationBrief || {}).approvedMotionFile)
          : null;
        const winner = primaryFrame || deliveryCanon || null;
        const latestPackage = [
          ...keyframes.map((f) => f.package),
          ...motions.map((m) => m.package),
        ]
          .filter(Boolean)
          .at(-1);
        const latestBuild = resolvePromptBuildList(P, s.promptBuilds || [])
          .slice()
          .reverse()
          .find((b) => b.prompt);
        const fav = latestPackage
          ? {
              text: latestPackage.prompt,
              refs: (latestPackage.references || []).map(
                (r, i) =>
                  "#image" + (i + 1) + " = " + (r.label || r.key || r.role),
              ),
              profileName: latestPackage.profileName,
              profileVersion: latestPackage.profileVersion,
            }
          : latestBuild
            ? {
                text: latestBuild.prompt,
                refs: (latestBuild.references || []).map(
                  (r, i) =>
                    "#image" + (i + 1) + " = " + (r.label || r.key || r.role),
                ),
                profileName: latestBuild.profileName,
                profileVersion: latestBuild.profileVersion,
              }
            : (s.promptOptions || []).find((o) => o.favorite) ||
              (s.promptOptions || [])[0] ||
              null;
        const scene = P.scenes.find((x) => x.id === s.scene);
        const mid = s.stillModel || (P.meta.defaults || {}).stillModel;
        const vid = s.videoModel || (P.meta.defaults || {}).videoModel;
        return {
          id: s.id,
          title: s.title,
          scene: scene?.title || s.scene,
          dur: motions.length
            ? motions.reduce((n, m) => n + m.dur, 0)
            : +s.dur || 0,
          route: s.route,
          winner,
          stillModel: modelName(mid),
          videoModel: modelName(vid),
          motionPrompt: s.motionPrompt || "",
          keyframes,
          motions,
          prompt: fav
            ? {
                text: fav.text,
                refs: fav.refs || [],
                profileName: fav.profileName || "",
                profileVersion: fav.profileVersion || "",
              }
            : null,
        };
      });
    res.json({
      meta: {
        title: P.meta.title,
        format: P.meta.format,
        version: P.meta.version,
        hubVersion: P.meta.hubVersion || "v5.0",
      },
      models: P.meta.models || [],
      world: P.meta.world || null,
      styleBlocks: P.meta.styleBlocks || [],
      qcChecklist: P.qcChecklist || [],
      characters: withMedia("characters", P.characters.filter(approvedIn("characters")), media.anchors),
      locations: withMedia("locations", P.locations.filter(approvedIn("locations")), media.plates),
      props: withMedia("props", P.props.filter(approvedIn("props")), media.props),
      vehicles: withMedia("vehicles", (P.vehicles || []).filter(approvedIn("vehicles")), media.vehicles || []),
      audio: withMedia("audio", (P.audio || []).filter(approvedIn("audio")), media.audio),
      shots,
      pending: {
        characters: P.characters.filter((x) => !approvedIn("characters")(x)).length,
        locations: P.locations.filter((x) => !approvedIn("locations")(x)).length,
        props: P.props.filter((x) => !approvedIn("props")(x)).length,
        vehicles: (P.vehicles || []).filter((x) => !approvedIn("vehicles")(x)).length,
        audio: (P.audio || []).filter((x) => !approvedIn("audio")(x)).length,
        shots: P.shots.filter(
          (s) => s.status !== "LOCKED" && s.workflowStatus !== "APPROVED",
        ).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
/* ---- project management ---- */
app.get("/api/projects", (req, res) =>
  res.json({ active: activeSlug(), projects: listProjects(), archived: listArchivedProjects(), trashed: listTrashedProjects() }),
);
/* The switch is only committed once the target project has been read and validated. A project
   that cannot be opened never becomes active, so the server and the interface can never end up
   pointing at different projects and a later edit cannot land in the failed target. */
app.post("/api/projects/switch", (req, res) => {
  const inspected = inspectProjectFile(req.body?.slug);
  if (!inspected.ok)
    return res.status(inspected.status).json(projectFailurePayload(inspected));
  const c = readConfig();
  c.activeProject = inspected.slug;
  writeConfig(c);
  /* After the switch is committed, so the pass indexes the project that is now
     active and its own activeSlug guard agrees with it. */
  noteProjectActivity("switch", inspected.slug, inspected.project);
  res.json({ ok: true, slug: inspected.slug, title: inspected.title });
});
app.post("/api/projects/:slug/archive", (req, res) => {
  try {
    const { slug, dir } = projectDirForSlug(req.params.slug);
    const archiveRoot = path.join(projectsRoot(), ".archive");
    fs.mkdirSync(archiveRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let archiveName = `${slug}-${stamp}`, archiveDir = path.join(archiveRoot, archiveName), suffix = 1;
    while (fs.existsSync(archiveDir)) {
      archiveName = `${slug}-${stamp}-${suffix++}`;
      archiveDir = path.join(archiveRoot, archiveName);
    }
    fs.renameSync(dir, archiveDir);
    fs.writeFileSync(path.join(archiveDir, ".cinebraid-archive.json"), JSON.stringify({ originalSlug: slug, archivedAt: new Date().toISOString() }, null, 2));
    const remaining = listProjects();
    const c = readConfig();
    if (c.activeProject === slug || !remaining.some((project) => project.slug === c.activeProject)) c.activeProject = remaining[0]?.slug || "";
    writeConfig(c);
    res.json({ ok: true, slug, archiveName, nextActive: c.activeProject || null });
  } catch (e) {
    res.status(/No such project|Invalid project slug/.test(e.message) ? 404 : 500).json({ error: e.message });
  }
});
app.post("/api/projects/archive/:archiveName/restore", (req, res) => {
  try {
    const archiveName = cleanProjectSlug(req.params.archiveName);
    const archiveDir = path.join(projectsRoot(), ".archive", archiveName);
    if (!fs.existsSync(path.join(archiveDir, "project.json"))) return res.status(404).json({ error: "No such archived project" });
    let manifest = {};
    try { manifest = readJsonSync(path.join(archiveDir, ".cinebraid-archive.json")); } catch {}
    let slug = cleanProjectSlug(manifest.originalSlug || archiveName.replace(/-\d{4}-\d{2}-\d{2}T.*$/, "") || "restored-project");
    const base = slug;
    let suffix = 1;
    while (fs.existsSync(path.join(projectsRoot(), slug))) slug = `${base}-restored-${suffix++}`;
    const targetDir = path.join(projectsRoot(), slug);
    fs.renameSync(archiveDir, targetDir);
    try { fs.unlinkSync(path.join(targetDir, ".cinebraid-archive.json")); } catch {}
    res.json({ ok: true, slug });
  } catch (e) {
    res.status(/Invalid project slug/.test(e.message) ? 400 : 500).json({ error: e.message });
  }
});
app.post("/api/projects/trash/:trashName/restore", (req, res) => {
  try {
    const trashName = cleanProjectSlug(req.params.trashName);
    const trashDir = path.join(projectsRoot(), ".trash", trashName);
    if (!fs.existsSync(path.join(trashDir, "project.json"))) return res.status(404).json({ error: "No such trashed project" });
    let manifest = {};
    try { manifest = readJsonSync(path.join(trashDir, ".cinebraid-trash.json")); } catch {}
    let slug = cleanProjectSlug(manifest.originalSlug || trashName.replace(/-\d{4}-\d{2}-\d{2}T.*$/, "") || "restored-project");
    const base = slug;
    let suffix = 1;
    while (fs.existsSync(path.join(projectsRoot(), slug))) slug = `${base}-restored-${suffix++}`;
    const targetDir = path.join(projectsRoot(), slug);
    fs.renameSync(trashDir, targetDir);
    try { fs.unlinkSync(path.join(targetDir, ".cinebraid-trash.json")); } catch {}
    res.json({ ok: true, slug });
  } catch (e) {
    res.status(/Invalid project slug/.test(e.message) ? 400 : 500).json({ error: e.message });
  }
});
app.delete("/api/projects/:slug", (req, res) => {
  try {
    const { slug, dir } = projectDirForSlug(req.params.slug);
    const projects = listProjects();
    const trashRoot = path.join(projectsRoot(), ".trash");
    fs.mkdirSync(trashRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let trashName = `${slug}-${stamp}`;
    let trashDir = path.join(trashRoot, trashName);
    let suffix = 1;
    while (fs.existsSync(trashDir)) {
      trashName = `${slug}-${stamp}-${suffix++}`;
      trashDir = path.join(trashRoot, trashName);
    }
    fs.renameSync(dir, trashDir);
    fs.writeFileSync(path.join(trashDir, ".cinebraid-trash.json"), JSON.stringify({ originalSlug: slug, deletedAt: new Date().toISOString() }, null, 2));
    const remaining = projects.filter((project) => project.slug !== slug);
    const c = readConfig();
    if (c.activeProject === slug || !remaining.some((project) => project.slug === c.activeProject))
      c.activeProject = remaining[0]?.slug || "";
    writeConfig(c);
    res.json({ ok: true, slug, nextActive: c.activeProject || null, recoverable: true, trashName });
  } catch (e) {
    res.status(/No such project|Invalid project slug/.test(e.message) ? 404 : 500).json({ error: e.message });
  }
});

app.post("/api/projects/new", (req, res) => {
  const title = (req.body.title || "New Project").trim();
  let slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project";
  let n = 1,
    base = slug;
  while (fs.existsSync(path.join(projectsRoot(), slug))) slug = base + "-" + ++n;
  const dir = path.join(projectsRoot(), slug);
  ensureDirs(dir);
  const blank = BLANK();
  blank.meta.title = title;
  blank.meta.format = String(req.body.format || "").trim();
  blank.meta.aspectRatio = String(req.body.aspectRatio || "").trim();
  blank.meta.globalStylePrompt = String(req.body.globalStylePrompt || "").trim();
  blank.meta.globalNegativePrompt = String(req.body.globalNegativePrompt || "").trim();
  blank.meta.world.setting = String(req.body.worldSetting || "").trim();
  blank.meta.world.reject = blank.meta.globalNegativePrompt;
  if (blank.meta.globalStylePrompt)
    blank.meta.styleBlocks.push({
      id: "global-style",
      name: "Global visual style",
      text: blank.meta.globalStylePrompt,
      stage: "",
    });
  const firstScene = String(req.body.firstScene || "").trim();
  if (firstScene)
    blank.scenes.push({
      id: "SC-01",
      title: firstScene,
      tier: "B",
      stage: "",
      characters: [],
      whatHappens: "",
      howItFeels: "",
      audio: {},
    });
  atomicWriteJson(path.join(dir, "project.json"), blank, { backup: false });
  const c = readConfig();
  c.activeProject = slug;
  writeConfig(c);
  res.json({ ok: true, slug });
});

const httpServer = app.listen(PORT, HOST, () => {
  const localUrl = `http://127.0.0.1:${PORT}`;
  const exposure = LOOPBACK_HOSTS.has(HOST)
    ? "Local-only mode: other devices cannot connect."
    : "WARNING: LAN mode exposes CineBraid to devices that can reach this computer. Set an editor passcode before using paid providers or sensitive projects.";
  console.log(`\n  CINEBRAID → ${localUrl}\n  Bind address: ${HOST}\n  ${exposure}\n  Projects root: ${projectsRoot()}\n`);
});

/* Release the port on shutdown.
   Keep-alive connections hold the listener open, so closing sockets explicitly is what
   actually frees the port; without it close() waits for idle clients and the port stays
   bound. Windows delivers SIGINT/SIGBREAK for Ctrl+C and Ctrl+Break, but a forced
   TerminateProcess runs no handler at all - that case is handled by launching the server
   directly (see .claude/launch.json) so the terminated process IS this one, rather than an
   npm wrapper whose child would be orphaned. */
let shuttingDown = false;
function shutdownServer(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  CineBraid received ${signal}; closing the listener on port ${PORT}.`);
  /* Stop scheduling recovery immediately, and hold the exit until a collection that had
     already begun reaches a truthful boundary. Closing the listener does nothing to a
     sweep that is mid-collection of an already-paid result, and exiting underneath one
     is what left the next boot to collect it a second time. The wait is bounded by the
     poller's own grace window, which is deliberately shorter than the force-exit below,
     so recovery can never be the reason CineBraid fails to exit. See
     generation-poller.js stop(). */
  const recoverySettled = GenerationPoller.stop().catch(() => ({ waited: false, timedOut: false }));
  const forceExit = setTimeout(() => {
    console.error("  CineBraid shutdown timed out; exiting.");
    process.exit(1);
  }, 5000);
  if (typeof forceExit.unref === "function") forceExit.unref();
  const listenerClosed = new Promise((resolve) => httpServer.close(resolve));
  if (typeof httpServer.closeAllConnections === "function") httpServer.closeAllConnections();
  Promise.all([recoverySettled, listenerClosed]).then(([recovery]) => {
    if (recovery?.waited)
      console.log(recovery.timedOut
        ? "  CineBraid stopped waiting for background recovery; nothing partial was written."
        : "  CineBraid waited for background recovery to finish before exiting.");
    clearTimeout(forceExit);
    process.exit(0);
  });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => shutdownServer(signal));
}
