/* Build a disposable CineBraid environment.

   Usage:
     node scripts/qa-sandbox.js --out <dir> [--demo] [--force]
     npm run dogfood:sandbox                      creates the default dogfood sandbox

   CineBraid reads its configuration from CINEBRAID_CONFIG_PATH and its projects
   from CINEBRAID_PROJECTS_ROOT. Point both at a directory this script made and the
   running application cannot see, let alone modify, the founder's real projects or
   the repository's own data/ and projects/cinebraid-sample/. Previous QA sessions
   left stray projects and edited config behind precisely because they ran against
   the repository's own roots; this exists so that stops being possible.

   --demo additionally wires the copied sample so the capability-aware generation
   dialog is reachable without a paid request: it stores the durable blocking
   prompt build that `Create blocking frame` compiles from, and declares the
   shot's cast, location and prop. It writes NO credentials.

   The script prints the exact environment for the caller to use, and
   scripts/qa-sandbox.js --out <same dir> --force is the reset: delete and rebuild. */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SAMPLE = path.join(ROOT, "projects", "cinebraid-sample");

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1] : fallback;
}
const DEMO = process.argv.includes("--demo");
const FORCE = process.argv.includes("--force");
const OUT = path.resolve(arg("--out", path.join(os.tmpdir(), "cinebraid-dogfood")));

if (OUT === ROOT || OUT.startsWith(path.join(ROOT, "projects")) || OUT.startsWith(path.join(ROOT, "data"))) {
  console.error(`Refusing to build a sandbox inside the repository's own data (${OUT}). Choose a directory outside ${ROOT}.`);
  process.exit(1);
}

if (fs.existsSync(OUT)) {
  if (!FORCE) {
    console.error(`${OUT} already exists. Pass --force to delete and rebuild it, or choose another --out.`);
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
}

const projectsRoot = path.join(OUT, "projects");
const configPath = path.join(OUT, "config.json");
fs.mkdirSync(projectsRoot, { recursive: true });

/* A copy, never a link: the point is that editing the sandbox project cannot
   reach the shipped sample. Runtime artefacts from a previous run are left
   behind rather than copied forward. */
const SKIP = new Set(["backups", "generation-jobs.json", "agent-index.json", "test-feedback.json", "embeddings.json"]);
fs.cpSync(SAMPLE, path.join(projectsRoot, "dogfood-sample"), {
  recursive: true,
  filter: (source) => !SKIP.has(path.basename(source)),
});

const projectFile = path.join(projectsRoot, "dogfood-sample", "project.json");
const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
project.meta = { ...(project.meta || {}), title: `${project.meta?.title || "CineBraid Sample"} — dogfood copy` };

if (DEMO) {
  /* The shot the generation dialog is opened on. A blocking build is stored inline
     on the shot's creation brief, which is where buildBlockingPrompt() puts it and
     therefore where compileImageExecutionPlan() looks for it. */
  const shot = (project.shots || []).find((row) => row.id === "SAMPLE-03") || (project.shots || [])[0];
  if (!shot) {
    console.error("The sample project has no shots to wire for --demo.");
    process.exit(1);
  }
  shot.characters = ["CHAR-COURIER"];
  shot.creationBrief = { ...(shot.creationBrief || {}), locationId: "LOC-PLATFORM", propIds: ["PROP-PARCEL"] };
  shot.creationBrief.blockingBuilds = [{
    id: "blocking-dogfood-1",
    packageId: `${shot.id}-BLOCKING-R01`,
    date: "2026-08-09T00:00:00.000Z",
    profileId: "gpt-image-2/blocking",
    profileName: "GPT Image 2 — blocking",
    kind: "blocking-frame",
    prompt: "Stored blocking prompt text. The compiled request is rebuilt from the spec below.",
    spec: {
      schemaVersion: 1,
      purpose: "still",
      shotId: shot.id,
      narrativePurpose: "The courier opens the parcel under the platform lamp.",
      initialState: {
        subject: "The courier crouches over the blue parcel, hands on the seal.",
        staging: "", camera: "",
        environment: "A wet commuter platform at night, lit by one sodium lamp.",
      },
      finalState: { subject: "", staging: "", camera: "", environment: "" },
      actions: [],
      camera: { framing: "medium framing", movement: "", stability: "", lensIntent: "", timing: "" },
      performance: {},
      environmentMotion: [],
      stagingLines: ["The courier enters camera-left and crosses to centre frame."],
      mustPreserve: ["platform geometry and the parcel design"],
      mustAvoid: ["no new props"],
      identityCanon: [], driftRestatements: [], visualGrounding: [], promptEntities: [],
      productionRisks: [], promptWarnings: [], audio: {}, references: [],
      visualStyle: ["Flat greyscale blocking scaffold."],
      blockingEntities: [],
      world: { setting: "A wet commuter platform.", aspectRatio: "16:9" },
      aspectRatio: "16:9",
    },
    references: [], warnings: [], confirmations: [],
  }];
}
fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));

/* Manual-first and provider-free, exactly like a fresh install. No API keys are
   written: fal, the assistant and every account connection stay off until the
   person using the sandbox turns them on deliberately. */
fs.writeFileSync(configPath, JSON.stringify({
  activeProject: "dogfood-sample",
  assistant: { provider: "none", visionProvider: "none" },
  generation: { fal: { enabled: false } },
}, null, 2));

const quote = (value) => (/[ &()]/.test(value) ? `"${value}"` : value);
console.log(`Disposable CineBraid sandbox ready at ${OUT}`);
console.log(`  project        dogfood-sample${DEMO ? " (with a stored blocking prompt build)" : ""}`);
console.log(`  config         ${configPath}`);
console.log(`  projects root  ${projectsRoot}`);
console.log("\nPowerShell — start CineBraid against it:");
console.log(`  $env:CINEBRAID_CONFIG_PATH=${quote(configPath)}`);
console.log(`  $env:CINEBRAID_PROJECTS_ROOT=${quote(projectsRoot)}`);
console.log("  $env:PORT=3399");
console.log("  npm start");
console.log("\nThen open http://127.0.0.1:3399  ·  stop with Ctrl+C.");
console.log(`Reset it with:  node scripts/qa-sandbox.js --out ${quote(OUT)}${DEMO ? " --demo" : ""} --force`);
