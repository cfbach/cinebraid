/* The real-browser gate: run every Playwright suite and prove a browser started.

   A suite that skips is not a suite that passed. Before this gate existed the
   distinction had nowhere to live: each suite printed "skipped: Python Playwright
   is not installed." and exited 0, `tests/run-full-check.js` counted it among the
   98 that passed, and five browser suites contributed zero assertions to every
   green run for as long as anyone had been reading them.

   Two things are checked here, and the second is the one that matters:

     1. the suite exits 0, and
     2. the suite printed the receipt that tests/browser_runtime.py emits only
        after pw.chromium.launch() actually returned a browser.

   Requirement 2 is why starting Python cannot be mistaken for exercising the UI.
   CINEBRAID_BROWSER_REQUIRED is exported to the children so a missing runtime
   fails inside the suite as well, rather than relying on this runner alone. */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const os = require("os");
const TestIsolation = require("../src/server/test-isolation");
const { LEDGER_ENV, readLedger, verifyLedgerEntries } = require("./helpers/disposable-root");

const ROOT = path.resolve(__dirname, "..");
const RECEIPT = /^\[browser-runtime\] (.+): launched Chromium (\S+) \((.+)\)$/;

/* Suites that must launch a browser and must pass. Named by npm script so the
   gate and package.json cannot drift into disagreeing about which file runs. */
const SUITES = [
  "check:ev2-3-browser",
  "check:ev2-3-selector-browser",
  "check:ev2-4-visual-browser",
  "check:ev2-5-browser",
  "check:ev2-5-mobile-browser",

  "check:manual-browser",
  "check:browser-real",
  "check:reference-loop-browser",
  "check:h3-browser",
  "check:preview-layout",
  "check:ui-state",
  "check:board-density-browser",
  "check:c2b-browser",
  "check:brand-logo-browser",
  "check:lan-passcode-browser",
  "check:generation-defaults-browser",
  "check:generation-truth-browser",
  "check:state-honesty-browser",
  "check:stage-model-browser",
  "check:workspace-shell-browser",
  "check:creator-surfaces-browser",
  "check:stage-surfaces-browser",
  "check:production-media-browser",
  "check:candidate-review-browser",
  "check:focused-browser",
  "check:entity-truth-browser",
  "check:state-binding-browser",
  "check:alpha-loop-browser",
  "check:shot-readiness-browser",
  "check:founder-p0-browser",
  "check:quiet-shell-browser",
  /* A2. Beside the A1 shell suite: the two measure the same chrome, one for what
     it owns and one for what it says it is. */
  "check:shell-identity-browser",
  "check:project-entry-browser",
  "check:reference-reframe-browser",
  "check:simple-advanced-browser",
  "check:shot-intent-browser",
  "check:shot-intent-front-browser",
  "check:broll-browser",
  "check:reference-first-canon-browser",
  "check:authority-browser",
  /* The post-AT1 shot-side removal slice. It sits beside check:authority-browser
     because it asks the same boundary the same question from the other side: what a
     real Chromium and the real save path do when a shot holding a receipt nothing can
     withdraw is deleted. */
  "check:shot-canon-removal-browser",
  "check:save-truth-browser",
  "check:bible-canon-browser",
  "check:returned-review-browser",
  "check:ev2-6-browser",
  "check:launch-language-browser",
  "check:reference-demand-browser",
  "check:references-alpha-browser",
];

/* Suites that launch a browser and are known to fail, pinned to the reason.

   These three were never reachable from `npm run check`, `check:ci` or
   `check:quick` - unlike the five above they were not merely skipping, they were
   not wired into anything at all. Running them for the first time showed all
   three have drifted away from the shipped UI. Repairing them means changing
   test harnesses rather than product code, which is a different piece of work
   from making browser QA run, so they are recorded here instead of fixed here.

   A quarantine that only tolerates failure is how the original skips became
   invisible, so this one is pinned in both directions: the suite must still
   launch a browser, and it must still fail for THIS reason. A suite that starts
   passing fails the gate asking to be promoted; a suite that breaks in a new way
   fails the gate too. Neither can pass unnoticed. */
const QUARANTINED = [
  {
    suite: "check:motion-edit",
    expect: "fal-h3-prompt-editor",
    why: "UNPROVEN: that the H3 motion prompt editor opens and can be edited from the motion workspace. " +
      "FIRST FAILURE: #fal-h3-prompt-editor never becomes visible. The recorded reason used to be the " +
      "cross-origin write refusal from its fabricated origin; that is no longer where it stops, so the " +
      "entry is re-pinned to what it actually fails on now.",
  },
  {
    suite: "check:continuity-browser",
    expect: "FIX CONTINUITY",
    why: "UNPROVEN: that the continuity workspace offers a repair control for a drifted state. " +
      "FIRST FAILURE: asserts a 'FIX CONTINUITY' control the shipped continuity UI no longer labels that way.",
  },
  {
    suite: "check:continuity-workspace-browser",
    expect: 'hidden <section class="shot-continuity"',
    why: "UNPROVEN: that opening a shot shows its continuity workspace. FIRST FAILURE: .shot-continuity " +
      "resolves but stays hidden, so the suite never reaches its own assertions. The recorded reason was a " +
      "per-frame state <select> (continuity-state-row); it now stops one level earlier, on the section itself.",
  },
  /* SPLIT OUT OF A GREEN SUITE, NOT INVENTED HERE. Each of these two ran inside a larger
     suite whose required proof now passes, and each is a later, independent contract that
     had been unreachable behind an earlier failure. Splitting keeps the required proof in
     the gate and keeps the unproven contract visible and pinned, rather than deleting an
     assertion or holding a whole suite red for something it does not exist to prove. */
  {
    suite: "check:state-honesty-frame-review",
    expect: "the frame reviewer must send its own frame's attempts",
    why: "UNPROVEN: that reviewBlockingAttempts() sends the frame's own attempts to /api/llm/review and " +
      "reads the stored verdict back onto the attempt card. FIRST FAILURE: no request is issued at all - " +
      "`calls` returns empty. A separate AI-review contract from the keyed-identity invariant " +
      "check:state-honesty-browser proves, and unreachable behind C2 until that was fixed. Post-Alpha " +
      "test debt; no AI-review product behaviour was changed for it.",
  },
  {
    suite: "check:h3-motion-handoff",
    expect: 'resolved to hidden <section class="frames-to-motion-cta state-pass">',
    why: "UNPROVEN: that the Frames workspace hands off into Motion & sound once the required frames are " +
      "approved. FIRST FAILURE, re-read for PR #74: the hand-off is no longer held shut - with the required " +
      "frames approved the section now renders state-pass, its button enabled - but it sits inside the " +
      "Frames workflow disclosure, which folds once the frames step is complete (the accepted EV2-7 Shot " +
      "Desk ruling, f8bbde2), so the suite's wait for a VISIBLE .frames-to-motion-cta times out. The " +
      "hand-off itself stays reachable as the visible \"Continue to Motion & sound\". The claim stays " +
      "unproven until the suite opens the completed section the way a filmmaker would and presses the " +
      "hand-off it now finds enabled; that rewrite, and promotion out of quarantine, are follow-up F2. " +
      "check:h3-browser still proves the keyframe panel itself against the same real fixture.",
  },
];

/* Same launcher reasoning as tests/run-full-check.js: Node refuses to spawn a
   .cmd without a shell since CVE-2024-27980, and npm hands its own CLI path to
   the scripts it launches. */
function npmLauncher() {
  const fromNpm = process.env.npm_execpath;
  if (fromNpm && fromNpm.endsWith(".js")) return { command: process.execPath, prefix: [fromNpm], shell: false };
  const beside = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return require("fs").existsSync(beside)
    ? { command: process.execPath, prefix: [beside], shell: false }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", prefix: [], shell: process.platform === "win32" };
}
const launcher = npmLauncher();

/* Each suite reports every disposable workspace it builds to its own ledger, and runs
   declared as a test, so every server it starts refuses a settings file or projects root
   that is not disposable (src/server/test-isolation.js). */
const LEDGER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-gate-ledger-"));
process.on("exit", () => { try { fs.rmSync(LEDGER_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
function runSuite(name) {
  const startedAt = Date.now();
  const ledger = path.join(LEDGER_DIR, `${name.replace(/[^a-z0-9-]+/gi, "-")}.jsonl`);
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(launcher.command, [...launcher.prefix, "run", "--silent", name], {
    cwd: ROOT,
    encoding: "utf8",
    shell: launcher.shell,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CINEBRAID_BROWSER_REQUIRED: "1", CINEBRAID_TEST_MODE: "1", [LEDGER_ENV]: ledger },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  process.stdout.write(output);
  const environments = readLedger(ledger);
  const isolation = { environments: environments.length, isolationProblems: verifyLedgerEntries(environments) };
  if (result.error) {
    return { name, launched: false, status: 1, seconds: 0, detail: result.error.message, output, ...isolation };
  }
  const receipts = output.split(/\r?\n/).map((line) => line.match(RECEIPT)).filter(Boolean);
  return {
    name,
    output,
    launched: receipts.length > 0,
    chromium: receipts.length ? receipts[0][2] : "",
    source: receipts.length ? receipts[0][3] : "",
    receipts: receipts.length,
    ...isolation,
    status: result.status == null ? 1 : result.status,
    seconds: (Date.now() - startedAt) / 1000,
    detail: "",
  };
}

/* Isolation, proved rather than asserted in a comment.

   Three checks, because a suite can be wrong in three places.

   1. Every suite runs declared as a test and reports the disposable workspaces it builds
      to a ledger. Each reported settings file and projects root must be disposable, and
      each workspace must be gone when the suite exits.
   2. The live configuration locations — this checkout's data/ settings and the account's
      per-user settings directories — are compared by existence, size and modification
      time before and after the run. Their contents are never read by this part.
   3. The whole gate is still bracketed by a byte census of data/ and projects/. Anything
      a browser suite writes to the checkout's own settings or the shipped sample fails
      the gate and names the file.

   Bytes are compared, not normalised: the same file is being read twice on one
   machine, so line endings cannot differ between the two reads. */
const WATCHED = ["data", "projects"];

/* Files CineBraid writes for itself the first time it opens the shipped sample, which a
   fresh clone legitimately does not have. Their CREATION is the application
   bootstrapping, not a test writing where it should not - CI proved this by failing on
   exactly it. Their MODIFICATION is still damage and still fails.

   data/config.json is NOT on this list any more. Every browser suite now owns disposable
   settings, and a server declared as a test refuses the checkout's own settings file
   before reading it, so that file appearing during a gate run is damage, not
   bootstrapping.

   EXACT PATHS ONLY, never a pattern or a directory. A stray test project appearing
   under projects/ is precisely the failure this census exists to catch, and it still
   is: every new directory, every other new file, and every modification to a file the
   sample ships all remain damage. Only these two named files may appear.

   projects/cinebraid-sample/media-assets.json joined the list with P4-SEM-C1. Opening
   a project now mints a durable assetId per media file, and six of these suites open
   the shipped sample through the real server - so the sample acquiring its identity
   ledger IS the application bootstrapping, in exactly the sense data/config.json
   already was. CI proved this one too, by failing on exactly it while a developer
   machine that had run the gate before passed: the file was already there, so the
   census saw it unchanged rather than created.

   Its .bak is exempt for the same reason, and the reasoning is worth recording
   because it changed. The ledger is written twice across a gate run by design: the
   first server start indexes the sample stat-only, and a later one anchors those
   identities to their bytes. The store copies the previous primary aside before
   replacing it, so the second write is what produces the .bak. Both writes are the
   application converging on its own state, neither is a suite writing where it
   should not, and refusing the .bak would only mean the gate failed on the ledger
   working correctly. */
const FIRST_RUN_ARTIFACTS = new Set([
  "projects/cinebraid-sample/media-assets.json",
  "projects/cinebraid-sample/media-assets.json.bak",
]);

function census() {
  const seen = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile())
        seen.set(path.relative(ROOT, full).split(path.sep).join("/"),
          crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex"));
    }
  };
  for (const dir of WATCHED) walk(path.join(ROOT, dir));
  return seen;
}

/* Existence, size and modification time of every live configuration location. */
function liveCensus() {
  const seen = new Map();
  const stamp = (target) => {
    try { const stat = fs.statSync(target); return stat.isDirectory() ? "directory" : `${stat.size}:${stat.mtimeMs}`; }
    catch { return "absent"; }
  };
  for (const location of TestIsolation.liveConfigurationLocations(ROOT)) {
    seen.set(location.path, stamp(location.path));
    for (const name of ["config.json", "config.json.bak"]) seen.set(path.join(location.path, name), stamp(path.join(location.path, name)));
  }
  return seen;
}

const before = census();
const liveBefore = liveCensus();

const results = SUITES.map(runSuite);
const quarantine = QUARANTINED.map((row) => ({ ...row, ...runSuite(row.suite) }));

const after = census();
const damage = [];
for (const [file, hash] of before) {
  if (!after.has(file)) damage.push(`deleted  ${file}`);
  else if (after.get(file) !== hash) damage.push(`modified ${file}`);
}
const bootstrapped = [];
for (const file of after.keys()) {
  if (before.has(file)) continue;
  if (FIRST_RUN_ARTIFACTS.has(file)) bootstrapped.push(file);
  else damage.push(`created  ${file}`);
}
const liveAfter = liveCensus();
for (const [target, stamp] of liveBefore) {
  if (liveAfter.get(target) !== stamp) damage.push(`changed live configuration location ${target}`);
}
const reported = [...results, ...quarantine];
for (const row of reported) {
  for (const problem of row.isolationProblems || []) damage.push(`${row.name}: ${problem}`);
}
const environmentsReported = reported.reduce((sum, row) => sum + (row.environments || 0), 0);
const suitesReporting = reported.filter((row) => row.environments).length;

const names = [...results, ...quarantine].map((row) => row.name);
const column = Math.max(...names.map((name) => name.length));
console.log(`\n${"".padEnd(column)}  BROWSER   EXIT  TIME     CHROMIUM`);
for (const row of [...results, ...quarantine]) {
  const verdict = row.launched ? "launched" : "NONE    ";
  const chromium = row.launched ? `${row.chromium} (${row.source})` : row.detail || "no launch receipt";
  console.log(`${row.name.padEnd(column)}  ${verdict}  ${String(row.status).padEnd(4)}  ${row.seconds.toFixed(1).padStart(5)}s  ${chromium}`);
}

const failed = results.filter((row) => row.status !== 0);
const silent = results.filter((row) => row.status === 0 && !row.launched);
const executed = results.filter((row) => row.status === 0 && row.launched);

/* Quarantine verdicts. Three ways to be wrong and only one way to be as expected. */
const escaped = quarantine.filter((row) => row.status === 0);
const drifted = quarantine.filter((row) => row.status !== 0 && !row.output.includes(row.expect));
const mute = quarantine.filter((row) => !row.launched);
const pinned = quarantine.filter((row) => row.status !== 0 && row.launched && row.output.includes(row.expect));

const totalReceipts = [...results, ...quarantine].reduce((sum, row) => sum + (row.receipts || 0), 0);

console.log(`\ngated     launched ${SUITES.length}   executed ${executed.length}   skipped ${silent.length}   failed ${failed.length}`);
console.log(`quarantine launched ${QUARANTINED.length}   failing as recorded ${pinned.length}`);
console.log(`browser launches ${totalReceipts}`);
console.log(`isolation  ${before.size} files under ${WATCHED.join("/ and ")}/ ${damage.length ? `CHANGED (${damage.length})` : "byte-identical after the run"}`);
if (bootstrapped.length)
  console.log(`           first run created ${bootstrapped.join(", ")} (docs/qa/BROWSER_TESTS.md)`);
console.log(`disposable ${environmentsReported} workspaces reported by ${suitesReporting} suites, every one disposable and removed${damage.some((row) => row.includes(" was ")) ? " — NOT" : ""}`);
console.log(`live       ${liveBefore.size} live configuration locations ${[...liveBefore].every(([target, stamp]) => liveAfter.get(target) === stamp) ? "unchanged" : "CHANGED"}`);
for (const row of pinned) console.log(`  known stale  ${row.name} — ${row.why}`);

if (failed.length || silent.length || escaped.length || drifted.length || mute.length || damage.length) {
  for (const row of damage) console.error(`NOT ISOLATED  browser QA ${row}`);
  for (const row of failed) console.error(`FAILED   ${row.name} exited ${row.status}`);
  for (const row of silent)
    console.error(`NO BROWSER  ${row.name} exited 0 without launching Chromium — a skip must not count as coverage.`);
  for (const row of escaped)
    console.error(`PROMOTE  ${row.name} now passes. Move it from QUARANTINED to SUITES in tests/run-browser-gate.js.`);
  for (const row of drifted)
    console.error(`CHANGED  ${row.name} no longer fails on "${row.expect}". Re-read the failure and update its quarantine entry.`);
  for (const row of mute)
    console.error(`NO BROWSER  ${row.name} did not launch Chromium, so its recorded failure proves nothing.`);
  console.error("\nCineBraid browser gate failed.");
  process.exit(1);
}

console.log(`\nCineBraid browser gate passed: ${executed.length} suites each launched a real Chromium and asserted against it; ${pinned.length} quarantined suites launched and failed exactly as recorded; ${before.size} files under ${WATCHED.join("/ and ")}/ were byte-identical afterwards.`);
