/* Regression tests for the D1/D2 data-safety repair.

   D1 - loading the application must not persist the project. Only a record whose stored
        schema is genuinely older may be written back, and no schema marker may be downgraded.
   D2 - the Settings backup list must address the active project slug through the shared
        script-scoped binding, and must surface a load failure instead of rendering an
        empty (reassuring) list.

   Everything below runs against synthetic fixtures or an os.tmpdir() copy. The real
   projects/ and data/ folders are never read or written. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

const SAVE_DEBOUNCE_MS = 500;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* P, ACTIVE_PROJECT_SLUG and ROUTES are let/const bindings, so they live in the context's
   lexical scope rather than on its global object - the same scoping rule that caused D2.
   They must be reached with vm.runInContext, exactly as the existing suites do. */
const evaluate = (rendered, expression) => vm.runInContext(expression, rendered.context);

/* settings() renders only the selected tab, so the recovery panel has to be chosen through
   the app's own tab mechanism rather than by hardcoding its localStorage key. */
const SELECT_RECOVERY_TAB =
  'selectBoundedTask("settings-task", "settings", "recovery"); ROUTES.settings();';

/* Records every project PUT the client issues, and applies it to a temp file the way the
   real server would, so the file can be byte-compared afterwards. */
function projectSaveRecorder(filePath) {
  const puts = [];
  return {
    puts,
    fetch: async (url, options = {}, respond) => {
      if (options.method === "PUT" && /^\/api\/projects\/[^/]+\/project$/.test(url)) {
        puts.push({ url, body: options.body });
        fs.writeFileSync(filePath, JSON.stringify(JSON.parse(options.body), null, 2));
        return respond({ ok: true });
      }
      return null;
    },
  };
}

/* Loads a project through the real client boot path and reports whether the file changed. */
async function loadAndCompare(project, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-d1-"));
  const file = path.join(dir, "project.json");
  try {
    fs.writeFileSync(file, JSON.stringify(project, null, 2));
    const before = fs.readFileSync(file);
    const recorder = projectSaveRecorder(file);
    const rendered = await render("#/production", project, { fetch: recorder.fetch });
    await wait(SAVE_DEBOUNCE_MS + 250); // outlast dirty()'s debounce
    const after = fs.readFileSync(file);
    return {
      label,
      identical: before.equals(after),
      putCount: recorder.puts.length,
      hubVersion: evaluate(rendered, "P.meta.hubVersion"),
      schemaVersion: evaluate(rendered, "P.meta.schemaVersion"),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------- D1 ---------- */

async function testCurrentProjectIsNotRewrittenOnLoad() {
  const project = buildFixture();
  project.meta.hubVersion = "v6.0.0";
  project.meta.schemaVersion = "6.6";
  const result = await loadAndCompare(project, "schema-current");
  assert.strictEqual(result.putCount, 0, "loading a current project must not issue a project PUT");
  assert(result.identical, "loading a current project must leave project.json byte-identical");
}

/* The shipped sample stores a release string in hubVersion ("v6.6.4-studio.2"). That parses
   as newer than the v6.0.0 marker, so it must be left alone rather than clobbered. */
async function testNewerSchemaMarkerIsNeverDowngraded() {
  const project = buildFixture();
  project.meta.hubVersion = "v6.6.4-studio.2";
  project.meta.schemaVersion = "6.6";
  const result = await loadAndCompare(project, "marker-ahead");
  assert.strictEqual(
    result.hubVersion,
    "v6.6.4-studio.2",
    "a hubVersion ahead of the current marker must not be downgraded",
  );
  assert.strictEqual(result.putCount, 0, "a project with a newer marker must not be rewritten");
  assert(result.identical, "a project with a newer marker must stay byte-identical");
}

async function testFutureSchemaVersionIsNeverDowngraded() {
  const project = buildFixture();
  project.meta.hubVersion = "v7.2.0";
  project.meta.schemaVersion = "9.1";
  const result = await loadAndCompare(project, "future");
  assert.strictEqual(result.hubVersion, "v7.2.0", "a future hubVersion must survive an older build");
  assert.strictEqual(result.schemaVersion, "9.1", "a future schemaVersion must survive an older build");
  assert.strictEqual(result.putCount, 0, "a future project must not be rewritten on load");
}

/* A genuinely older record must still migrate forward exactly once. */
async function testGenuinelyOlderProjectStillMigrates() {
  const project = buildFixture();
  project.meta.hubVersion = "v5.0.0";
  project.meta.schemaVersion = "6.0";
  const result = await loadAndCompare(project, "legacy");
  assert.strictEqual(result.putCount, 1, "a legacy project must be migrated forward and persisted once");
  assert.strictEqual(result.hubVersion, "v6.0.0", "legacy hubVersion must be upgraded to the current marker");
  assert.strictEqual(result.schemaVersion, "6.6", "legacy schemaVersion must be upgraded to the current marker");
  assert(!result.identical, "a legacy project is expected to change when it migrates");
}

/* An explicit user edit must still autosave, so the D1 fix cannot have disabled saving. */
async function testExplicitEditStillAutosaves() {
  const project = buildFixture();
  project.meta.hubVersion = "v6.0.0";
  project.meta.schemaVersion = "6.6";
  const recorder = projectSaveRecorder(path.join(os.tmpdir(), "cinebraid-d1-edit-ignored.json"));
  const rendered = await render("#/production", project, { fetch: recorder.fetch });
  await wait(SAVE_DEBOUNCE_MS + 250);
  assert.strictEqual(recorder.puts.length, 0, "precondition: load alone saves nothing");
  evaluate(rendered, 'P.meta.title = "Edited by the user"; dirty();');
  await wait(SAVE_DEBOUNCE_MS + 250);
  assert.strictEqual(recorder.puts.length, 1, "an explicit edit must still autosave");
  assert(
    JSON.parse(recorder.puts[0].body).meta.title === "Edited by the user",
    "the autosaved body must carry the user's edit",
  );
}

/* ---------- D2 ---------- */

async function testBackupRequestUsesActiveSlug() {
  const requested = [];
  const backups = [{ name: "project-2026-01-01T00-00-00-000Z-autosave.json", modifiedAt: new Date().toISOString(), size: 2048 }];
  const rendered = await render("#/production", buildFixture(), {
    fetch: async (url, options = {}, respond) => {
      if (url.includes("/backups")) {
        requested.push(url);
        return respond({ backups });
      }
      return null;
    },
  });
  // The harness reports the fixture project under the slug "fixture".
  assert.strictEqual(evaluate(rendered, "ACTIVE_PROJECT_SLUG"), "fixture", "precondition: a slug is active");
  const html = await evaluate(rendered, SELECT_RECOVERY_TAB);
  assert(requested.length > 0, "the settings view must request the backup list");
  assert(
    requested.every((url) => url === "/api/projects/fixture/backups"),
    `backup request must address the active slug, got ${JSON.stringify(requested)}`,
  );
  assert(
    !requested.some((url) => url.includes("//backups")),
    "the backup request must never contain an empty slug segment",
  );
  assert(html.includes("project-backup-list"), "existing backups must render as a list");
  assert(
    html.includes("project-2026-01-01T00-00-00-000Z-autosave.json"),
    "the returned backup name must be rendered",
  );
  assert(html.includes(">fixture<"), "the active slug must be shown in the recovery panel");
}

async function testBackupFailureIsVisibleNotSilent() {
  const rendered = await render("#/production", buildFixture(), {
    fetch: async (url, options = {}, respond) => {
      if (url.includes("/backups")) return respond({ error: "Project not found" }, 404);
      return null;
    },
  });
  const html = await evaluate(rendered, SELECT_RECOVERY_TAB);
  assert(html.includes("backup-list-error"), "a failed backup lookup must render an error state");
  assert(html.includes("Project not found"), "the server's reason must be surfaced to the user");
  assert(
    !html.includes("No rotating backups yet"),
    "a failed lookup must not masquerade as an empty backup list",
  );
}

async function testAbsentProjectIsReportedVisibly() {
  const rendered = await render("#/production", buildFixture(), { fetch: async () => null });
  evaluate(rendered, 'ACTIVE_PROJECT_SLUG = "";');
  const html = await evaluate(rendered, SELECT_RECOVERY_TAB);
  assert(html.includes("backup-list-error"), "no active project must render a visible notice");
  assert(html.includes("No project is open"), "the notice must explain why backups are unavailable");
  assert(
    !html.includes("No rotating backups yet"),
    "an absent project must not appear to simply have zero backups",
  );
}

async function main() {
  await testCurrentProjectIsNotRewrittenOnLoad();
  await testNewerSchemaMarkerIsNeverDowngraded();
  await testFutureSchemaVersionIsNeverDowngraded();
  await testGenuinelyOlderProjectStillMigrates();
  await testExplicitEditStillAutosaves();
  await testBackupRequestUsesActiveSlug();
  await testBackupFailureIsVisibleNotSilent();
  await testAbsentProjectIsReportedVisibly();
  console.log(
    "Data-safety repair suite passed: load leaves the project byte-identical, schema markers never downgrade, legacy records still migrate, explicit edits still autosave, and the backup list uses the active slug and fails visibly.",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
