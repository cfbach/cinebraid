const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const VERSION = require(path.join(ROOT, "package.json")).version;
const SAMPLE_PROJECT = "cinebraid-sample";
const MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".wav", ".mp3", ".m4a", ".flac", ".ogg"]);

/* Directories this walk must not descend into. Releases are built with
   `git archive`, so anything gitignored is excluded from a real release by
   construction - but this walk reads the filesystem, where they are still present.
   Without .venv-browser here, installing the browser test runtime makes the release
   check fail on Playwright's own bundled icons. */
const NOT_SHIPPED = new Set(["node_modules", ".venv-browser", ".git", "dist"]);

/* Media that ships on purpose, named one file at a time.

   The rule this list qualifies exists to stop a private project's media reaching a
   release, so it is deliberately not relaxed into "anything under public/" - and
   pointedly not into "anything under public/assets/" either, which would let a future
   directory of anything ride along under a Braidy-shaped exemption. The application's
   own brand mark and the six Braidy V3.2 sprite exports the Assistant rail draws are
   the images outside the sanitized sample that belong in a release; a stray PNG
   anywhere else still fails.

   These six are also the release's proof that Braidy is not broken art in a shipped
   build: the loop below requires every allowlisted file to be present, so dropping one
   fails here rather than rendering an empty box on somebody's first run. */
const SHIPPED_MEDIA = new Set([
  "public/cinebraid-logo-xs.png",
  "public/assets/assistant-character/braidy-idle-soft-v32.png",
  "public/assets/assistant-character/braidy-listening-v32.png",
  "public/assets/assistant-character/braidy-processing-v32.png",
  "public/assets/assistant-character/braidy-acknowledge-v32.png",
  "public/assets/assistant-character/braidy-needs-decision-v32.png",
  "public/assets/assistant-character/braidy-front-v32.png",
]);

// Repository-only presentation assets. These exact files never belong in runtime archives.
const REPOSITORY_PRESENTATION_MEDIA = new Set([
  ".github/assets/social-preview.png",
  ".github/assets/screenshots/production-overview.png",
  ".github/assets/screenshots/shot-workspace.png",
  ".github/assets/screenshots/reference-review.png",
]);

function walkFiles(root, current = root, out = []) {
  if (!fs.existsSync(current)) return out;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (NOT_SHIPPED.has(entry.name)) continue;
    const file = path.join(current, entry.name);
    if (entry.isDirectory()) walkFiles(root, file, out);
    else out.push(path.relative(root, file).split(path.sep).join("/"));
  }
  return out;
}

function sanitizedProjectCheck(root, repositoryTree = false) {
  const projectsRoot = path.join(root, "projects");
  assert(fs.existsSync(projectsRoot), "release projects folder is missing");
  /* `repositoryTree` finally does something, and this is the distinction it was named
     for. An ARCHIVE may contain nothing but the sample — a `.archive/` or `.trash/`
     inside one would be somebody's retired project shipped to strangers, so the
     archive call site stays absolute.
     A WORKING TREE is different: those two folders are runtime state CineBraid creates
     inside whatever projects root it is pointed at, and `.gitignore:144` already closes
     `/projects/*`, so neither can reach an archive in the first place. Counting a folder
     the application made for itself as shipped project content failed this check for a
     reason that has nothing to do with publication.
     What it still refuses either way is what it was written for: an ordinary project
     directory beside the sample. */
  const projects = fs.readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !(repositoryTree && entry.name.startsWith(".")))
    .map((entry) => entry.name)
    .sort();
  assert.deepStrictEqual(projects, [SAMPLE_PROJECT], `release projects must contain only ${SAMPLE_PROJECT}; found ${projects.join(", ") || "none"}`);
  const sampleFile = path.join(projectsRoot, SAMPLE_PROJECT, "project.json");
  assert(fs.existsSync(sampleFile), "sanitized sample project is missing project.json");
  const sample = JSON.parse(fs.readFileSync(sampleFile, "utf8"));
  assert.strictEqual(sample.meta?.workflowEmphasis, "manual", "sample project must open in manual-first mode");
  const files = walkFiles(root);
  const strayMedia = files.filter((file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())
    && !file.startsWith(`projects/${SAMPLE_PROJECT}/`)
    && !SHIPPED_MEDIA.has(file)
    && !(repositoryTree && REPOSITORY_PRESENTATION_MEDIA.has(file)));
  /* The allowlist must name something that is actually there: a renamed or dropped
     brand asset would otherwise leave a permanently unused exemption behind. */
  for (const shipped of SHIPPED_MEDIA)
    assert(files.includes(shipped), `${shipped} is allowlisted as shipped media but is not in the release`);
  assert.deepStrictEqual(strayMedia, [], `release contains media outside the sanitized sample: ${strayMedia.join(", ")}`);
}

function findPackageRoot(dir) {
  if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  const queue = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name));
  while (queue.length) {
    const current = queue.shift();
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "node_modules") queue.push(path.join(current, entry.name));
    }
  }
  return "";
}

function structuralCheck() {
  const rootMarkdown = fs.readdirSync(ROOT).filter((name) => name.endsWith(".md"));
  assert(rootMarkdown.length <= 8, `release root contains ${rootMarkdown.length} Markdown files`);
  const releaseDir = path.join(ROOT, "docs", "releases", `v${VERSION}`);
  assert(fs.existsSync(releaseDir), `release documentation folder is missing: ${releaseDir}`);
  for (const suffix of ["RELEASE_NOTES", "PATCH_INSTALL", "VERIFICATION_REPORT"]) {
    const name = `CINEBRAID_v${VERSION}_${suffix}.md`;
    assert(fs.existsSync(path.join(releaseDir, name)), `release documentation is missing ${name}`);
  }
  sanitizedProjectCheck(ROOT, true);
  console.log(`Release package structure passed for CineBraid ${VERSION}.`);
}

function packagedCheck(zipPath) {
  const absoluteZip = path.resolve(zipPath);
  assert(fs.existsSync(absoluteZip), `release zip does not exist: ${absoluteZip}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-package-smoke-"));
  try {
    const unpack = spawnSync("unzip", ["-q", absoluteZip, "-d", temp], { encoding: "utf8" });
    assert.strictEqual(unpack.status, 0, `could not unzip release: ${unpack.stderr || unpack.stdout}`);
    const packageRoot = findPackageRoot(temp);
    assert(packageRoot, "unzipped release does not contain package.json");
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    assert.strictEqual(pkg.version, VERSION, "unzipped release version does not match source version");
    sanitizedProjectCheck(packageRoot);
    const check = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "check:quick"], {
      cwd: packageRoot,
      env: { ...process.env, CINEBRAID_PACKAGE_SMOKE_CHILD: "1" },
      encoding: "utf8",
      timeout: 15 * 60 * 1000,
      maxBuffer: 24 * 1024 * 1024,
    });
    if (check.error) throw check.error;
    assert.strictEqual(check.status, 0, `untouched release failed npm run check:quick:\n${check.stdout}\n${check.stderr}`);
    console.log(`Untouched release archive passed npm run check:quick: ${path.basename(absoluteZip)}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.env.CINEBRAID_PACKAGE_SMOKE_CHILD === "1") {
  console.log("Nested release package smoke skipped inside untouched archive check.");
} else {
  structuralCheck();
  if (process.env.CINEBRAID_RELEASE_ZIP) packagedCheck(process.env.CINEBRAID_RELEASE_ZIP);
}
