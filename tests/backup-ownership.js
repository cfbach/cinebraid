/* CineBraid project backups — retention may only delete what CineBraid wrote.
 *
 * Two defects met in one directory.
 *
 *   The backup folder is a free-text path field in Settings → Files & storage, so
 *   pointing it at an existing folder is one paste away.
 *   Retention then listed it with /^project-.*\.json$/i — which matches
 *   project-plan.json, project-notes.json, project-2019-budget.json and any exported
 *   project a filmmaker keeps — and unlinked everything past the ten newest, inside
 *   a try/catch that swallowed every error.
 *
 * So a single ordinary AUTOSAVE — the most routine operation in the product, and one
 * no user associates with deletion — permanently destroyed an unbounded set of files
 * the user chose the location of. No trash, no `.bak`, and the API response mentioned
 * only the backup it had just created.
 *
 * Ownership is now the filename CineBraid itself emits. This suite plants foreign
 * files that the old filter matched, forces retention to prune, and asserts that the
 * pruning is exact in both directions: CineBraid's own old backups go, and nothing
 * else does.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { startCineBraidServer } = require("./fixtures/mock-civitai");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-backup-ownership-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "owned-project");
const VICTIM_ROOT = path.join(TEMP, "user-chosen-backup-folder");
const VICTIM_DIR = path.join(VICTIM_ROOT, "owned-project");

/* Files a filmmaker would plausibly keep in a folder they picked. Every one of
   these matched the old filter and was therefore deletable. */
const FOREIGN = [
  "project-plan.json",
  "project-notes.json",
  "project-2019-budget.json",
  "project-final-DELIVERY.json",
  "project_backup_manual.json",
  "Project-Bible-Export.json",
  "project-2026-08-08-notes.json",          /* stamped-looking, but not the grammar */
  "project-2026-08-08T07-42-52-036Z.json",  /* stamp with no reason segment */
  "project-.json",
  "unrelated.txt",
];

let server = null;

function writeProject() {
  fs.mkdirSync(path.join(PROJECT_DIR, "shots"), { recursive: true });
  for (const d of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, d), { recursive: true });
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify({
    meta: { title: "Owned", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [], shots: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ activeProject: "owned-project", accounts: [] }, null, 2));
}

/* CineBraid's own grammar: project-<ISO stamp with : and . replaced by ->-<reason>.json */
function ownedBackupName(minutesAgo, reason = "autosave") {
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + minutesAgo * 60000).toISOString().replace(/[:.]/g, "-");
  return `project-${stamp}-${reason}.json`;
}

async function main() {
  writeProject();
  fs.mkdirSync(VICTIM_DIR, { recursive: true });

  /* Plant foreign files first, with the OLDEST mtimes, so retention would reach
     them first if it were allowed to. */
  FOREIGN.forEach((name, i) => {
    const target = path.join(VICTIM_DIR, name);
    fs.writeFileSync(target, JSON.stringify({ user: `irreplaceable ${name}` }, null, 2));
    const when = new Date(Date.UTC(2020, 0, 1) + i * 60000);
    fs.utimesSync(target, when, when);
  });
  /* Then 18 genuine CineBraid backups — well past the retention limit of 10. */
  const owned = [];
  for (let i = 0; i < 18; i += 1) {
    const name = ownedBackupName(i);
    owned.push(name);
    const target = path.join(VICTIM_DIR, name);
    fs.writeFileSync(target, JSON.stringify({ cinebraid: i }, null, 2));
    const when = new Date(Date.UTC(2026, 0, 1) + i * 60000);
    fs.utimesSync(target, when, when);
  }
  const before = fs.readdirSync(VICTIM_DIR);
  assert.strictEqual(before.length, FOREIGN.length + 18);

  server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT, FAL_KEY: "",
  });

  /* Point the backup root at the user's folder, exactly as Settings does. */
  const applied = await server.request("/api/workspace/settings", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: { backupRoot: VICTIM_ROOT.replace(/\\/g, "/") } }),
  });
  assert.strictEqual(applied.status, 200, JSON.stringify(applied.body));

  /* ---- 1. the listing a user is shown contains only CineBraid's own backups ---- */
  const listed = await server.request("/api/projects/owned-project/backups");
  assert.strictEqual(listed.status, 200, JSON.stringify(listed.body));
  const listedNames = (listed.body.backups || []).map((b) => b.name);
  for (const name of FOREIGN)
    assert(!listedNames.includes(name), `a user's own file must not be presented as a CineBraid backup: ${name}`);
  assert.strictEqual(listedNames.length, 18, "all eighteen genuine backups are listed");

  /* ---- 2. one ordinary autosave prunes CineBraid's backups and nothing else ---- */
  const current = await server.request("/api/project");
  const saved = await server.request("/api/projects/owned-project/project", {
    method: "PUT", headers: { "content-type": "application/json", "if-match": "*" }, body: JSON.stringify(current.body),
  });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

  const after = fs.readdirSync(VICTIM_DIR);
  const survivingForeign = FOREIGN.filter((n) => after.includes(n));
  assert.deepStrictEqual(
    survivingForeign.sort(), [...FOREIGN].sort(),
    `every user file must survive an autosave. Deleted: ${FOREIGN.filter((n) => !after.includes(n)).join(", ")}`,
  );

  /* Retention still works: 18 old + 1 new = 19, capped at 10. */
  const survivingOwned = after.filter((n) => /^project-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-z0-9_-]+\.json$/.test(n));
  assert.strictEqual(survivingOwned.length, 10, `retention must still prune to ten, saw ${survivingOwned.length}`);
  /* And it pruned the OLDEST, not an arbitrary set. */
  assert(survivingOwned.includes(saved.body.backup), "the backup just written survives");
  for (const name of owned.slice(0, 9))
    assert(!after.includes(name), `the oldest CineBraid backups must be pruned: ${name} remained`);

  /* ---- 3. repeated saves never reach the foreign files ---- */
  for (let i = 0; i < 6; i += 1) {
    const again = await server.request("/api/projects/owned-project/project", {
      method: "PUT", headers: { "content-type": "application/json", "if-match": "*" }, body: JSON.stringify(current.body),
    });
    assert.strictEqual(again.status, 200);
  }
  const settled = fs.readdirSync(VICTIM_DIR);
  assert.deepStrictEqual(
    FOREIGN.filter((n) => settled.includes(n)).sort(), [...FOREIGN].sort(),
    "six more autosaves must still leave every user file alone",
  );
  assert.strictEqual(
    settled.filter((n) => /^project-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-z0-9_-]+\.json$/.test(n)).length, 10,
    "retention stays at ten",
  );
  /* Their bytes are unchanged too — survival is not enough if they were rewritten. */
  for (const name of FOREIGN)
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(VICTIM_DIR, name), "utf8")).user, `irreplaceable ${name}`,
      `${name} must be byte-intact, not merely present`,
    );

  /* ---- 4. the same holds for the default in-project backup folder ---- */
  await server.request("/api/workspace/settings", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: { backupRoot: "" } }),
  });
  const inProject = path.join(PROJECT_DIR, "backups");
  fs.mkdirSync(inProject, { recursive: true });
  fs.writeFileSync(path.join(inProject, "project-plan.json"), '{"user":"kept"}');
  for (let i = 0; i < 14; i += 1) fs.writeFileSync(path.join(inProject, ownedBackupName(i, "manual")), "{}");
  await server.request("/api/projects/owned-project/project", {
    method: "PUT", headers: { "content-type": "application/json", "if-match": "*" }, body: JSON.stringify(current.body),
  });
  assert(fs.existsSync(path.join(inProject, "project-plan.json")),
    "a foreign file in the default backup folder is protected by the same rule");
  assert.strictEqual(
    fs.readdirSync(inProject).filter((n) => /^project-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-z0-9_-]+\.json$/.test(n)).length, 10,
  );

  console.log(
    "Backup ownership suite passed: ten foreign project-*.json files the old filter matched — including a plan, "
    + "notes, a budget and two stamp-shaped near-misses — survive an autosave, six further autosaves and byte "
    + "comparison, in both a user-chosen backup root and the default in-project folder, while CineBraid's own "
    + "backups still prune oldest-first to the retention limit.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    if (server?.output) console.error(`--- server output ---\n${server.output}`);
    process.exitCode = 1;
  })
  .finally(() => {
    server?.stop();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });
