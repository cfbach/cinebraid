"use strict";

/* UNTRUSTED_IMPORT exclusive publish — NEGATIVE CONTROLS.
 *
 * The positive suite shows that a project document already published at the chosen
 * slug survives, and that the losing request lands beside it. That is only worth
 * something if the exclusive publish is what makes it true. Each control here
 * reintroduces one specific defect into the SHIPPED server.js, runs a real server on
 * the mutated source, and requires the exact damage back.
 *
 * Every control runs twice. PHASE 0 runs the shipped source and requires the damage
 * to be ABSENT — a control that "detects" something already broken detects nothing.
 * PHASE 1 runs the mutated source and requires it to be PRESENT. Each mutation is
 * proved to match the shipped text exactly once and to change it, so a needle that
 * has drifted can never be mistaken for a defect that came back.
 *
 * Both shipped callers are driven through every control: importing a CineBraid
 * project, and starting a blank one.
 *
 * Fixtures are isolated under os.tmpdir(). No provider is configured or contacted.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { ROOT, freePort } = require("./fixtures/mock-civitai");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-ui-nc-"));
const SERVER = path.join(ROOT, "src/server/server.js");
const SHIPPED = fs.readFileSync(SERVER, "utf8").replace(/\r\n/g, "\n");
const SCRATCH = new Set();

process.on("exit", () => { for (const file of SCRATCH) { try { fs.unlinkSync(file); } catch {} } });

/* ==========================================================================
   MUTATION
   ========================================================================== */

function applyMutations(source, edits) {
  let text = String(source).replace(/\r\n/g, "\n");
  edits.forEach((edit, index) => {
    const needle = String(edit.from).replace(/\r\n/g, "\n");
    const found = text.split(needle).length - 1;
    assert.strictEqual(found, 1,
      `edit ${index + 1}: the needle matched ${found} times in the shipped source, so this control is not armed`);
    const next = text.replace(needle, edit.to);
    assert.notStrictEqual(next, text, `edit ${index + 1}: the mutation produced no change`);
    text = next;
  });
  return text;
}

/* ==========================================================================
   A SERVER BUILT FROM ARBITRARY SOURCE

   The mutated copy is written next to server.js so its own `require("./…")` calls
   resolve exactly as they do in production, under a name `.gitignore` already
   covers, and it is removed on the way out and again at exit.
   ========================================================================== */

let scratchCounter = 0;
async function runServer(source, { configPath, projectsRoot }, body) {
  const isShipped = source === SHIPPED;
  const file = isShipped ? SERVER : path.join(path.dirname(SERVER), `server-ui-control-${process.pid}-${scratchCounter++}.tmp`);
  if (!isShipped) { fs.writeFileSync(file, source); SCRATCH.add(file); }
  const port = await freePort();
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot,
      FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/me`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const request = async (pathname, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      return { status: response.status, ok: response.ok, body: parsed, text };
    };
    return await body({ request });
  } finally {
    child.kill();
    if (!isShipped) { try { fs.unlinkSync(file); } catch {} SCRATCH.delete(file); }
  }
}

/* ==========================================================================
   THE INTERLEAVE

   Identical in shape to the positive suite: a competing publication that lands
   between the slug scan and the publish, triggered by the temp file the publish
   itself creates rather than by any duration.
   ========================================================================== */

const BULK = "S".repeat(9 * 1024 * 1024);
const FOREIGN = JSON.stringify({
  THE_OTHER_WRITER: true,
  meta: { title: "Published by someone else" },
}, null, 2);
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const slugFor = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

async function plantInPublishWindow(dir, file, budgetMs = 30000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { entries = []; }
    if (entries.some((name) => name.endsWith(".tmp"))) {
      try { fs.writeFileSync(file, FOREIGN, { flag: "wx" }); return "planted"; }
      catch (error) { return "could-not-plant:" + (error?.code || error?.message); }
    }
    if (fs.existsSync(file)) return "published-before-the-window-opened";
    if (Date.now() > deadline) return "no-temp-file-appeared";
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function sourceProject(title) {
  return {
    meta: {
      title, format: "Short film", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6",
      aiPolicy: "project-default", world: { setting: BULK },
    },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [],
    mediaAssets: [], jobs: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
    scenes: [{ id: "SC-01", title: "Arrival", whatHappens: "She arrives.", howItFeels: "Still." }],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "Wide", desc: "The harbour, wide.", positioning: "Locked frame.",
      dur: 5, workflowStatus: "DRAFT", characters: [], codes: [], risks: [], candidateFiles: [],
      creationBrief: {}, keyframes: [], clips: [],
    }],
  };
}

/* Runs one contested creation through one shipped caller on the given source, and
   reports what the request said and what is actually on disk. */
async function raceRun(source, caller, label) {
  const home = fs.mkdtempSync(path.join(TEMP, `${label}-`));
  const projectsRoot = path.join(home, "projects");
  const configPath = path.join(home, "config.json");
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    activeProject: "", accounts: [], assistant: { provider: "none", visionProvider: "none" },
    workspace: { projectRoot: projectsRoot.split(path.sep).join("/"), mediaRoot: "", outputRoot: "", backupRoot: "" },
  }, null, 2));

  const title = "Contested Project";
  const slug = slugFor(title);
  const dir = path.join(projectsRoot, slug), file = path.join(dir, "project.json");

  return runServer(source, { configPath, projectsRoot }, async ({ request }) => {
    let pending;
    if (caller === "new") {
      pending = request("/api/projects/new", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, globalStylePrompt: BULK }),
      });
    } else {
      const preview = await request("/api/projects/preview-import-json", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: sourceProject(title) }),
      });
      assert.strictEqual(preview.status, 200, preview.text.slice(0, 300));
      pending = request("/api/projects/import-json", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewToken: preview.body.previewToken, previewHash: preview.body.previewHash }),
      });
    }
    const interleave = await plantInPublishWindow(dir, file);
    const response = await pending;

    const respondedSlug = String(response.body?.slug || "");
    const respondedFile = respondedSlug ? path.join(projectsRoot, respondedSlug, "project.json") : "";
    const respondedTitle = respondedFile && fs.existsSync(respondedFile)
      ? String(JSON.parse(fs.readFileSync(respondedFile, "utf8"))?.meta?.title || "") : "";
    return {
      caller, slug, title, interleave, response, respondedSlug, respondedTitle,
      contestedSurvives: fs.existsSync(file) && fs.readFileSync(file, "utf8") === FOREIGN,
      contestedSha: fs.existsSync(file) ? sha(fs.readFileSync(file, "utf8")) : "",
      projects: fs.readdirSync(projectsRoot).sort(),
    };
  });
}

function requireInterleave(run) {
  assert.strictEqual(run.interleave, "planted",
    `${run.caller}: the competing publication had to land inside the window, got "${run.interleave}"`);
}

/* The window is a state, not a duration — but it still has to open. An attempt whose
   publish finished before this process was next scheduled proves nothing either way,
   so it is discarded and retried in a fresh workspace. A machine that never opens the
   window fails the control loudly; it never reports one it did not observe. */
async function racedRun(source, caller, label, tries = 4) {
  const misses = [];
  for (let attempt = 1; attempt <= tries; attempt++) {
    const run = await raceRun(source, caller, `${label}-${attempt}`);
    if (run.interleave === "planted") return run;
    misses.push(run.interleave);
  }
  throw new Error(`${caller}: the competing publication never landed inside the window — ${misses.join("; ")}`);
}

/* ==========================================================================
   THE CONTROLS
   ========================================================================== */

const RENAME_PUBLICATION_RESTORED = [{
  from: "      exclusive: isCreateOnlyWriteClass(context.writeClass),",
  to: "      exclusive: context.writeClass === WRITE_CLASSES.WORKSPACE_MIGRATION,",
}];

const EEXIST_READ_AS_PUBLISHED = [{
  from: "      fs.copyFileSync(temp, file, fs.constants.COPYFILE_EXCL);",
  to: "      try { fs.copyFileSync(temp, file, fs.constants.COPYFILE_EXCL); }\n"
    + "      catch (error) { if (error?.code !== \"EEXIST\") throw error; }",
}];

const RETRY_REMOVED = [{
  from: "    if (outcome.ok || outcome.refusal?.code !== \"PROJECT_DESTINATION_EXISTS\") return { slug, outcome };\n"
    + "    if (lost >= PROJECT_SLUG_COLLISION_LIMIT) return { slug, outcome };\n"
    + "    slug = base + \"-\" + ++n;",
  to: "    return { slug, outcome };",
}];

const CONTROLS = [
  {
    id: "NC-UI-1",
    title: "renameSync publication restored for UNTRUSTED_IMPORT",
    mutations: RENAME_PUBLICATION_RESTORED,
    shipped(run) {
      requireInterleave(run);
      assert.strictEqual(run.contestedSurvives, true,
        "the document published first must be exactly as its writer left it");
      assert.strictEqual(run.response.status, 200, run.response.text.slice(0, 300));
      assert.strictEqual(run.respondedSlug, run.slug + "-2",
        "and the request that lost the race lands beside it: " + JSON.stringify(run.response.body));
      assert.deepStrictEqual(run.projects, [run.slug, run.slug + "-2"],
        "two writers, two project documents");
    },
    mutated(run) {
      requireInterleave(run);
      assert.strictEqual(run.contestedSurvives, false,
        "a rename publication must destroy the document that got there first");
      assert.strictEqual(run.response.status, 200,
        "…while reporting success: " + JSON.stringify(run.response.body));
      assert.strictEqual(run.response.body.ok, true);
      assert.strictEqual(run.respondedSlug, run.slug,
        "at the very slug the other writer had already published to");
      assert.strictEqual(run.respondedTitle, run.title,
        "the destroyed document has been replaced by this request's own");
      assert.deepStrictEqual(run.projects, [run.slug],
        "two successful creations, one physical project document");
    },
  },
  {
    id: "NC-UI-2",
    title: "EEXIST read as an ordinary successful publication",
    mutations: EEXIST_READ_AS_PUBLISHED,
    shipped(run) {
      requireInterleave(run);
      assert.strictEqual(run.respondedSlug, run.slug + "-2");
      assert.strictEqual(run.respondedTitle, run.title,
        "the slug in the response holds the document this request created");
      assert.strictEqual(run.contestedSurvives, true);
    },
    mutated(run) {
      requireInterleave(run);
      /* Nothing is destroyed — the copy still refused. The damage is that the refusal
         was read as a publication, so the request is told it created a project it did
         not create, at a slug it does not own. */
      assert.strictEqual(run.contestedSurvives, true,
        "the exclusive copy still refuses, so the other writer's bytes are intact");
      assert.strictEqual(run.response.status, 200,
        "…and the request is told it succeeded: " + JSON.stringify(run.response.body));
      assert.strictEqual(run.respondedSlug, run.slug, "at the contested slug");
      assert.notStrictEqual(run.respondedTitle, run.title,
        "which holds somebody else's document — two writers, one project, both told it is theirs");
      assert.deepStrictEqual(run.projects, [run.slug],
        "and no second project was ever created");
    },
  },
  {
    id: "NC-UI-3",
    title: "route auto-suffix retry removed, exclusive publication kept",
    mutations: RETRY_REMOVED,
    shipped(run) {
      requireInterleave(run);
      assert.strictEqual(run.response.status, 200, run.response.text.slice(0, 300));
      assert.strictEqual(run.respondedSlug, run.slug + "-2",
        "the shipped route recovers from a lost publish the way it recovers from a taken name");
    },
    mutated(run) {
      requireInterleave(run);
      /* The point of this control: the UX is gone and the invariant is not. */
      assert.strictEqual(run.response.status, 409,
        "without the retry the caller is refused: " + JSON.stringify(run.response.body));
      assert.strictEqual(run.response.body.code, "PROJECT_DESTINATION_EXISTS",
        "truthfully, and with the same code a taken destination always had");
      assert.strictEqual(run.contestedSurvives, true,
        "SAFETY IS NOT THE RETRY: the first writer's bytes survive a broken UX untouched");
      assert.strictEqual(run.contestedSha, sha(FOREIGN), "byte for byte");
      assert.deepStrictEqual(run.projects, [run.slug],
        "and nothing was published for the refused request");
    },
  },
];

/* ==========================================================================
   RUN
   ========================================================================== */

(async () => {
  console.log("UNTRUSTED_IMPORT exclusive publish — negative controls\n");
  let caught = 0, broken = 0, missed = 0;

  for (const control of CONTROLS) {
    let mutatedSource;
    try { mutatedSource = applyMutations(SHIPPED, control.mutations); }
    catch (error) {
      broken += 1;
      console.log(`  NOT ARMED  ${control.id}  ${control.title}\n             ${error.message}`);
      continue;
    }

    for (const caller of ["new", "import"]) {
      const label = `${control.id.toLowerCase()}-${caller}`;
      try { control.shipped(await racedRun(SHIPPED, caller, label + "-shipped")); }
      catch (error) {
        broken += 1;
        console.log(`  BROKEN     ${control.id} (${caller})  ${control.title}`);
        console.log(`             the shipped source already fails this control: ${error.message}`);
        continue;
      }

      let damage = null;
      try { control.mutated(await racedRun(mutatedSource, caller, label + "-mutated")); }
      catch (error) { damage = error; }
      if (damage) {
        missed += 1;
        console.log(`  MISSED     ${control.id} (${caller})  ${control.title}`);
        console.log(`             the defect was reintroduced and nothing showed it: ${damage.message}`);
        continue;
      }
      caught += 1;
      console.log(`  caught     ${control.id} (${caller})  ${control.title}`);
    }
  }

  console.log(`\nUNTRUSTED_IMPORT negative controls: ${caught} caught · ${missed} missed · ${broken} broken; provider calls: 0.`);
  fs.rmSync(TEMP, { recursive: true, force: true });
  if (missed || broken || caught !== CONTROLS.length * 2) process.exit(1);
})().catch((error) => {
  console.error("\nUNTRUSTED_IMPORT negative controls FAILED\n", error);
  process.exit(1);
});
