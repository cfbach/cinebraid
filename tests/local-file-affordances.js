/* LOCAL FILE AFFORDANCES V1 — the invariants.
 *
 * THE ONE SENTENCE THIS SUITE HOLDS:
 *
 *     IF CINEBRAID SAYS A MEDIA ITEM EXISTS LOCALLY, THE FILMMAKER CAN REVEAL OR
 *     COPY THE EXACT AUTHORITATIVE FILE; IF IT DOES NOT EXIST LOCALLY, CINEBRAID
 *     SAYS SO.
 *
 * Every assertion below is one half of that: either "the exact file, resolved from
 * durable identity" or "and otherwise, the truth instead of a plausible folder".
 *
 * WHY THIS OPENS NO EXPLORER WINDOWS. The launcher takes an injectable spawner, so
 * the suite asserts the EXACT argv and the EXACT options that would reach
 * CreateProcess — which is the thing that can be wrong — without a window per case.
 * Section 7 goes one step further and performs a REAL Windows process launch with
 * the same options against a harmless echo program, so "no shell interprets these
 * characters" is measured rather than asserted. Two real Explorer launches were
 * performed by hand and are recorded in the candidate's report.
 *
 * The negative controls live in tests/local-file-affordances-negative-controls.js:
 * this file asserts the guarantees, that one proves they can fail.
 */

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const Affordance = require(path.join(ROOT, "local-file-affordance"));
const Shared = require(path.join(ROOT, "public", "shared-local-file"));

/* Canonicalised at the source. P1 makes the resolver answer with the PHYSICAL
   project directory, and %TEMP% is itself under a reparse point on some Windows
   installs — so a fixture rooted at the uncanonicalised temp path would compare
   unequal for a reason that has nothing to do with what is being tested. */
const TEMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-localfile-")));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const CONFIG_PATH = path.join(TEMP, "config.json");

const FILM_A = "film-a";
const FILM_B = "film-b";
const A_DIR = path.join(PROJECTS_ROOT, FILM_A);
const B_DIR = path.join(PROJECTS_ROOT, FILM_B);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/* THE FILENAMES THAT MATTER, and every one of them is LEGAL ON WINDOWS — which is
   the constraint that decides the set. Win32 forbids < > : " / \ | ? * in a
   filename, so those cannot arrive from a filesystem and testing them as names
   would be testing a state that cannot occur. `"` is handled separately, as a
   refusal, because it is the only character that could close the launcher's
   quoting and therefore the only one worth refusing rather than passing through.

   What remains is every character that IS legal in a filename and IS significant
   to cmd.exe or PowerShell — which is exactly the set a shell-string
   implementation would have got wrong. */
const HOSTILE_NAMES = [
  "plain frame.png",                    /* space */
  "take & retake (2).png",              /* ampersand, parentheses */
  "caret^and%PATH%.png",                /* caret, environment-variable syntax */
  "semi;colon.png",                     /* command separator */
  "quote'apostrophe.png",               /* single quote */
  "bang!subshell$(id)`x`.png",          /* history expansion, substitution, backticks */
  "brace{a}bracket[b]at@.png",          /* brace and bracket expansion */
  "日本語-éèü-Ωμ.png",                   /* Unicode outside Latin-1 */
  "comma,in,name.png",                  /* the character /select, itself parses on */
  "  leading and trailing spaces .png", /* whitespace at both ends of the stem */
];

let passes = 0;
function ok(message) {
  passes += 1;
  console.log(`  ok  ${message}`);
}
function section(title) {
  console.log(`\n${title}`);
}

/* ---------------------------------------------------------------------------
   FIXTURE. Two projects that share filenames on purpose — that shared name is the
   whole of proof FILE-8. */
function projectDocument(title) {
  return {
    meta: { title, format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [{ id: "CHAR-RHEA", name: "Rhea", continuityStates: [{ id: "state-default", name: "Default", isDefault: true }] }],
    locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{
      id: "S-01", scene: "SC-01", title: "Rhea", desc: "Rhea waits.",
      characters: ["CHAR-RHEA"], codes: [],
      creationBrief: { propIds: [], vehicleIds: [], frameWorkflows: {} },
      keyframes: [], clips: [], candidateFiles: [],
    }],
    agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  };
}

function makeProject(dir, title, extras = []) {
  for (const sub of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const sub of ["takes", "locked", "blocking"])
    fs.mkdirSync(path.join(dir, "shots", "S-01", sub), { recursive: true });
  /* The SAME basename in both projects. */
  fs.writeFileSync(path.join(dir, "anchors", "CHAR-RHEA.png"), PNG);
  fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", "S-01_FRAME_A.png"), PNG);
  fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", "S-01_MOTION.mp4"), PNG);
  fs.writeFileSync(path.join(dir, "media", "planning-board.png"), PNG);
  fs.writeFileSync(path.join(dir, "docs", "notes.md"), "# notes\n");
  for (const name of extras) fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", name), PNG);
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(projectDocument(title), null, 2));
}

/* A ledger written directly, the way a pass would have left it. Written here
   rather than by running an indexing pass because this suite is about RESOLUTION,
   and a fixture that depends on a background pass having converged is a fixture
   that fails for a reason it is not testing. */
function writeLedger(dir, rows) {
  fs.writeFileSync(path.join(dir, "media-assets.json"), JSON.stringify({
    schemaVersion: 1,
    assets: rows.map((row) => ({
      assetId: row.assetId,
      hashState: "unhashed",
      contentHash: null,
      mediaType: row.mediaType || "image",
      role: "unknown",
      source: "unknown",
      lifecycle: "candidate",
      scope: {},
      storage: { path: row.path, bytes: 8, mtimeMs: 1, ...(row.missing ? { missing: true } : {}) },
      legacy: {},
      indexedAt: "2026-01-01T00:00:00.000Z",
    })),
  }, null, 2));
}

const ASSET_A_ANCHOR = "asset-" + "a".repeat(32);
const ASSET_A_FRAME = "asset-" + "b".repeat(32);
const ASSET_A_MOTION = "asset-" + "c".repeat(32);
const ASSET_A_GONE = "asset-" + "d".repeat(32);
const ASSET_A_FLAGGED = "asset-" + "e".repeat(32);
const ASSET_B_ANCHOR = "asset-" + "f".repeat(32);
const ASSET_UNKNOWN = "asset-" + "9".repeat(32);

fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
makeProject(A_DIR, "Film A", HOSTILE_NAMES);
makeProject(B_DIR, "Film B");
/* Recorded, then removed from disk behind CineBraid's back. FILE-6. */
fs.writeFileSync(path.join(A_DIR, "shots", "S-01", "takes", "S-01_REMOVED.png"), PNG);
/* And one the ledger itself already knows has gone: the other route into `missing`. */
writeLedger(A_DIR, [
  { assetId: ASSET_A_ANCHOR, path: "anchors/CHAR-RHEA.png" },
  { assetId: ASSET_A_FRAME, path: "shots/S-01/takes/S-01_FRAME_A.png" },
  { assetId: ASSET_A_MOTION, path: "shots/S-01/takes/S-01_MOTION.mp4", mediaType: "video" },
  { assetId: ASSET_A_GONE, path: "shots/S-01/takes/S-01_REMOVED.png" },
  { assetId: ASSET_A_FLAGGED, path: "shots/S-01/takes/S-01_FLAGGED.png", missing: true },
]);
writeLedger(B_DIR, [{ assetId: ASSET_B_ANCHOR, path: "anchors/CHAR-RHEA.png" }]);

/* ---------------------------------------------------------------------------
   P1 FIXTURE — the two reparse points at the PROJECT-ROOT boundary.

   `film-alias` and `film-escape` are junctions, not directories. Both carry a
   readable project.json through the link (the outside one is a complete project),
   so the server's own scope check passes and the request reaches the resolver —
   which is the code path that has to refuse. A fixture whose junction failed the
   scope check earlier would prove nothing about the boundary.

   Junction creation needs no privilege on Windows, but it can be refused by a
   locked-down environment, so it is recorded rather than assumed and the P1
   sections skip with a stated reason if it did not happen. */
const OUTSIDE_PROJECT = path.join(TEMP, "outside-project");
const FILM_ALIAS = "film-alias";
const FILM_ESCAPE = "film-escape";
const ALIAS_DIR = path.join(PROJECTS_ROOT, FILM_ALIAS);
const ESCAPE_DIR = path.join(PROJECTS_ROOT, FILM_ESCAPE);
const ASSET_OUTSIDE = "asset-" + "7".repeat(32);

makeProject(OUTSIDE_PROJECT, "Outside The Root");
writeLedger(OUTSIDE_PROJECT, [{ assetId: ASSET_OUTSIDE, path: "anchors/CHAR-RHEA.png" }]);

let JUNCTIONS = { cross: false, escape: false, why: "" };
try {
  fs.symlinkSync(A_DIR, ALIAS_DIR, "junction");
  JUNCTIONS.cross = true;
} catch (error) {
  JUNCTIONS.why = String(error && error.code);
}
try {
  fs.symlinkSync(OUTSIDE_PROJECT, ESCAPE_DIR, "junction");
  JUNCTIONS.escape = true;
} catch (error) {
  JUNCTIONS.why = String(error && error.code);
}

fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  activeProject: FILM_A,
  assistant: { provider: "ollama", visionProvider: "ollama" },
}, null, 2));

const inA = (key) => Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_A, key });
const inB = (key) => Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_B, key });

/* ===========================================================================
   1. THE SHARED CONTRACT — identity in, never a filesystem path. */
function sharedContract() {
  section("1. the key is an identity, and the browser can only mint one");

  const record = {
    identity: { ledger: { state: "known", value: ASSET_A_FRAME }, path: "shots/S-01/takes/S-01_FRAME_A.png" },
    file: { name: "S-01_FRAME_A.png" },
  };
  assert.strictEqual(Shared.localFileKey(record), `asset:${ASSET_A_FRAME}`,
    "a record with a durable identity keys on that identity");
  ok("a durable ledger identity wins over the stored path");

  /* A scan row: what every thumbnail in the product already holds. */
  assert.strictEqual(
    Shared.localFileKey({ name: "CHAR-RHEA.png", url: "/assets/anchors/CHAR-RHEA.png", assetId: ASSET_A_ANCHOR }),
    `asset:${ASSET_A_ANCHOR}`);
  assert.strictEqual(
    Shared.localFileKey({ name: "CHAR-RHEA.png", url: "/assets/anchors/CHAR-RHEA.png" }),
    "path:anchors/CHAR-RHEA.png",
    "a project whose ledger pass has never run still addresses its media by stored path");
  ok("a scan row keys identically whether or not the ledger has run");

  assert.strictEqual(
    Shared.localFileKey({ url: "/assets/shots/S-01/takes/" + encodeURIComponent("take & retake (2).png") }),
    "path:shots/S-01/takes/take & retake (2).png");
  ok("an escaped url decodes back to the exact stored path");

  /* FILE-5. Media CineBraid knows about that is not stored locally: a provider url
     is not an /assets/ url, so no key exists and no server is asked. */
  for (const url of ["https://fal.media/files/panda/output.png", "data:image/png;base64,iVBOR", ""]) {
    assert.strictEqual(Shared.localFileKey({ name: "output.png", url }), "",
      `a non-local url must mint no key: ${url}`);
    assert.strictEqual(Shared.localFileAddress({ name: "output.png", url }).state, "not-local");
  }
  ok("FILE-5 a provider result that was never collected reads not-local, with no key and no round trip");

  assert.strictEqual(Shared.localFileAddress(null).state, "unresolvable");
  assert.strictEqual(Shared.localFileAddress({ url: "/assets/anchors/CHAR-RHEA.png" }).state, "addressable");
  assert.ok(!Shared.LOCAL_FILE_STATES.includes("addressable"),
    "`addressable` is not an answer and must not be a member of the answer vocabulary");
  ok("addressability is separated from existence, so nothing claims a file before looking");

  assert.strictEqual(Shared.localFileWords("not-local"), "Not stored locally yet");
  assert.strictEqual(Shared.localFileWords("missing"),
    "File is no longer available at its recorded local path");
  assert.strictEqual(Shared.localFileActionable("missing"), false,
    "a missing file must never be offered a reveal button");
  assert.strictEqual(Shared.localFileActionable("not-local"), false);
  assert.strictEqual(Shared.localFileActionable("available"), true);
  ok("only `available` earns the actions, and every other state has words of its own");
}

/* ===========================================================================
   2. PATH GRAMMAR. */
function pathGrammar() {
  section("2. a path key names project media, or it names nothing");
  const good = [
    "anchors/CHAR-RHEA.png",
    "plates/PLATE.png",
    "media/planning-board.png",
    "audio/room-tone.wav",
    "shots/S-01/takes/S-01_FRAME_A.png",
    "shots/S-01/locked/S-01.mp4",
    "shots/S-01/blocking/S-01_BLOCKING.png",
    "shots/S-01/takes/take & retake (2).png",
    "shots/S-01/takes/日本語.png",
  ];
  for (const value of good)
    assert.strictEqual(Shared.isProjectRelativeMediaPath(value), true, `expected accepted: ${value}`);
  ok(`${good.length} real project media paths accepted, Unicode and metacharacters included`);

  const bad = [
    "../../../../Windows/System32/drivers/etc/hosts",
    "anchors/../../../secret.png",
    "anchors/../../film-b/anchors/CHAR-RHEA.png",
    "shots/../../../etc/passwd",
    "shots/../S-01/takes/x.png",
    "C:/Windows/System32/notepad.exe",
    "c:\\Windows\\System32\\notepad.exe",
    "/etc/passwd",
    "//server/share/file.png",
    "\\\\server\\share\\file.png",
    "project.json",
    "media-assets.json",
    "docs/notes.md",
    "backups/project-2026.json",
    "anchors",
    "anchors//CHAR-RHEA.png",
    "anchors/./CHAR-RHEA.png",
    "shots/../../anchors/CHAR-RHEA.png",
    "shots/S-01/secrets/x.png",
    "anchors/deeper/CHAR-RHEA.png",
    "anchors/CHAR\u0000.png",
    "",
  ];
  for (const value of bad)
    assert.strictEqual(Shared.isProjectRelativeMediaPath(value), false, `expected refused: ${value}`);
  ok(`${bad.length} traversal, absolute, UNC, sidecar and out-of-shape paths refused`);

  for (const value of bad)
    assert.strictEqual(Shared.parseLocalFileKey(`path:${value}`).domain, "", `key must not parse: path:${value}`);
  for (const key of ["asset:not-an-id", "asset:asset-XYZ", "asset:", "library:media-1", "nonsense", "", ":", "asset"])
    assert.strictEqual(Shared.parseLocalFileKey(key).domain, "", `key must not parse: ${key}`);
  ok("the server-side parser refuses every one of them, plus every malformed identity");
}

/* ===========================================================================
   3. FILE-1 / FILE-2 / FILE-3. */
function resolvesExactFile() {
  section("3. durable identity resolves to the exact file on disk");

  const anchor = inA(`asset:${ASSET_A_ANCHOR}`);
  assert.strictEqual(anchor.state, "available");
  assert.strictEqual(anchor.resolvedBy, "ledger");
  assert.strictEqual(anchor.path, path.join(A_DIR, "anchors", "CHAR-RHEA.png"));
  assert.strictEqual(fs.readFileSync(anchor.path).length, PNG.length, "the resolved path is a real file");
  ok("FILE-1 approved local Reference: resolved through the ledger to the exact file");

  const frame = inA(`asset:${ASSET_A_FRAME}`);
  assert.strictEqual(frame.state, "available");
  assert.strictEqual(frame.path, path.join(A_DIR, "shots", "S-01", "takes", "S-01_FRAME_A.png"));
  ok("FILE-2 returned/generated candidate: same guarantee, same resolution");

  const motion = inA(`asset:${ASSET_A_MOTION}`);
  assert.strictEqual(motion.state, "available");
  assert.strictEqual(path.extname(motion.path), ".mp4", "a non-still type resolves identically");
  ok("FILE-3 motion/video output: a non-still durable local representation resolves");

  const byPath = inA("path:media/planning-board.png");
  assert.strictEqual(byPath.state, "available");
  assert.strictEqual(byPath.resolvedBy, "path");
  assert.strictEqual(byPath.path, path.join(A_DIR, "media", "planning-board.png"));
  ok("a project with no durable id for a file still reaches it by its stored path");

  /* IDENTITY BEATS PATH, PROVEN BY DISAGREEMENT. The ledger row for the anchor is
     asked for through a key that ALSO carries a different stored path; the ledger's
     recorded path is the one that answers. */
  assert.strictEqual(inA(`asset:${ASSET_A_FRAME}`).path, frame.path);
  assert.notStrictEqual(inA(`asset:${ASSET_A_FRAME}`).path, inA("path:anchors/CHAR-RHEA.png").path);
  ok("the ledger's recorded path is authoritative when a durable identity is supplied");

  /* LF5: copy reads the SAME resolution as reveal, so they cannot disagree. */
  assert.strictEqual(inA(`asset:${ASSET_A_ANCHOR}`).path, anchor.path);
  ok("LF5 copy and reveal share one resolution — they cannot name different files");
}

/* ===========================================================================
   4. FILE-6. */
async function missingFile() {
  section("4. a file that left its recorded location is reported, never guessed at");

  fs.unlinkSync(path.join(A_DIR, "shots", "S-01", "takes", "S-01_REMOVED.png"));
  const gone = inA(`asset:${ASSET_A_GONE}`);
  assert.strictEqual(gone.state, "missing");
  assert.strictEqual(gone.path, "", "a missing file yields NO path to act on");
  assert.strictEqual(gone.recordedPath, path.join(A_DIR, "shots", "S-01", "takes", "S-01_REMOVED.png"),
    "the recorded location is reported so the filmmaker can go and look");
  assert.strictEqual(gone.message, "File is no longer available at its recorded local path");
  ok("FILE-6 the answer is `missing`, with the recorded path and no actionable path");

  /* The other route to the same answer: the ledger row itself already says gone. */
  const flagged = inA(`asset:${ASSET_A_FLAGGED}`);
  assert.strictEqual(flagged.state, "missing");
  assert.strictEqual(flagged.path, "");
  ok("a row the ledger already marked missing answers the same way, without a stat");

  /* And a path key whose file is not there. */
  const goneByPath = inA("path:shots/S-01/takes/S-01_REMOVED.png");
  assert.strictEqual(goneByPath.state, "missing");
  assert.strictEqual(goneByPath.path, "");
  ok("and so does the same file addressed by its stored path");

  /* NOTHING UNRELATED IS OPENED: not the parent folder, not the project folder. */
  let spawned = 0;
  const result = await Affordance.revealLocalFile({
    projectsRoot: PROJECTS_ROOT, slug: FILM_A, key: `asset:${ASSET_A_GONE}`, platform: "win32",
    spawner: () => { spawned += 1; return {}; },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.state, "missing");
  assert.strictEqual(spawned, 0, "a missing file must launch NOTHING — not even the parent folder");
  ok("FILE-6 no process is launched at all: no unrelated directory is opened");
}

/* ===========================================================================
   5. FILE-8. */
function projectSeparation() {
  section("5. Film A's file is not reachable through Film B");

  assert.ok(fs.existsSync(path.join(A_DIR, "anchors", "CHAR-RHEA.png")));
  assert.ok(fs.existsSync(path.join(B_DIR, "anchors", "CHAR-RHEA.png")));

  const crossed = inB(`asset:${ASSET_A_ANCHOR}`);
  assert.strictEqual(crossed.state, "unresolvable");
  assert.strictEqual(crossed.reason, "identity-not-in-ledger");
  assert.strictEqual(crossed.path, "");
  ok("FILE-8 an identity minted in Film A resolves nowhere under Film B, despite the shared filename");

  assert.strictEqual(inA(`asset:${ASSET_A_ANCHOR}`).path, path.join(A_DIR, "anchors", "CHAR-RHEA.png"));
  assert.strictEqual(inB(`asset:${ASSET_B_ANCHOR}`).path, path.join(B_DIR, "anchors", "CHAR-RHEA.png"));
  assert.notStrictEqual(inA(`asset:${ASSET_A_ANCHOR}`).path, inB(`asset:${ASSET_B_ANCHOR}`).path);
  ok("each project resolves its own identity to its own file");

  assert.strictEqual(inB("path:anchors/CHAR-RHEA.png").path, path.join(B_DIR, "anchors", "CHAR-RHEA.png"),
    "a stored path is always resolved against the project it was asked for");
  for (const key of [
    "path:../film-a/anchors/CHAR-RHEA.png",
    "path:anchors/../../film-a/anchors/CHAR-RHEA.png",
  ]) {
    const escaped = inB(key);
    assert.strictEqual(escaped.state, "unresolvable");
    assert.strictEqual(escaped.path, "");
  }
  ok("a path key cannot climb out of the project it was asked for");

  assert.strictEqual(inA(`asset:${ASSET_UNKNOWN}`).state, "unresolvable");
  for (const slug of ["..", ".", "../film-a", "film-a/anchors", "", "  ", "C:\\Windows"])
    assert.strictEqual(
      Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug, key: `asset:${ASSET_A_ANCHOR}` }).state,
      "unresolvable", `slug must not resolve: ${JSON.stringify(slug)}`);
  ok("an unknown identity and an uncontained slug are both refusals, never fallbacks");

  /* A POISONED LEDGER ROW, which is a reachable state rather than a paranoid one.
     `media-assets.json` is a plain file beside project.json; the store validates on
     WRITE and not on read, so a hand-edited or restored-from-elsewhere sidecar can
     name anything. The ledger's recorded path is trusted for WHICH FILE, never for
     WHERE — containment is proven on the joined result, after the lookup. */
  const poisoned = path.join(PROJECTS_ROOT, "poisoned");
  fs.mkdirSync(path.join(poisoned, "anchors"), { recursive: true });
  fs.writeFileSync(path.join(poisoned, "project.json"), JSON.stringify(projectDocument("Poisoned")));
  const POISON = ["../../../../Windows/System32/notepad.exe", "../film-a/anchors/CHAR-RHEA.png", "..", "/etc/passwd", "C:/Windows/System32/notepad.exe"];
  writeLedger(poisoned, POISON.map((value, index) => ({
    assetId: "asset-" + String(index).repeat(32).slice(0, 32), path: value,
  })));
  POISON.forEach((value, index) => {
    const answer = Affordance.localFileAffordance({
      projectsRoot: PROJECTS_ROOT,
      slug: "poisoned",
      key: "asset:asset-" + String(index).repeat(32).slice(0, 32),
    });
    assert.notStrictEqual(answer.state, "available", `a poisoned ledger row must not resolve: ${value}`);
    assert.strictEqual(answer.path, "", `a poisoned ledger row must yield no path: ${value}`);
  });
  ok(`${POISON.length} hand-edited ledger rows naming paths outside the project are refused — the ledger says WHICH file, never WHERE`);
}

/* ===========================================================================
   6. LF3 — the launch shape. */
function launchShape() {
  section("6. Explorer is launched with arguments, never with a shell string");

  const reveal = Affordance.explorerRevealCommand("C:\\Films\\take & retake (2).png");
  assert.strictEqual(reveal.file, "explorer.exe");
  assert.deepStrictEqual(reveal.args, ['/select,"C:\\Films\\take & retake (2).png"']);
  assert.strictEqual(reveal.options.shell, false, "there is no shell");
  assert.strictEqual(reveal.options.windowsVerbatimArguments, true);
  ok("the reveal command is ONE verbatim argument: /select,\"<path>\" — no shell");

  const open = Affordance.explorerOpenCommand("C:\\Films\\Film A (2026)");
  assert.strictEqual(open.file, "explorer.exe");
  assert.deepStrictEqual(open.args, ["C:\\Films\\Film A (2026)"]);
  assert.strictEqual(open.options.shell, false);
  assert.notStrictEqual(open.options.windowsVerbatimArguments, true,
    "a bare directory needs no verbatim mode and must not silently acquire one");
  ok("the folder command is a plain argv member, no shell, no verbatim mode");

  for (const interpreter of ["cmd", "cmd.exe", "powershell", "pwsh", "/c", "-Command", "&&", "||"])
    assert.ok(!reveal.args[0].includes(interpreter) && reveal.file !== interpreter,
      `no command interpreter may appear in the launch: ${interpreter}`);
  assert.strictEqual(reveal.args.length, 1);
  ok("no command interpreter is named and there is exactly one argument");

  for (const hostile of ['C:\\a"; start calc.exe; "b.png', "C:\\x\u0000y.png", ""])
    assert.throws(
      () => Affordance.explorerRevealCommand(hostile),
      (error) => error && error.name === "LocalFileError",
      `must refuse: ${JSON.stringify(hostile)}`);
  ok("a quote, a NUL and an empty target are refused outright rather than escaped");

  /* Windows-first, said out loud rather than failing silently elsewhere. */
  assert.strictEqual(Affordance.fileManagerAvailable("win32"), true);
  assert.strictEqual(Affordance.fileManagerAvailable("darwin"), false);
  assert.strictEqual(Affordance.fileManagerAvailable("linux"), false);
  ok("V1 is Windows-only and reports that rather than pretending on other platforms");
}

/* ===========================================================================
   7. FILE-7 — every hostile filename, through the real launcher and through a
   REAL Windows process launch. */
async function hostileFilenames() {
  section("7. every hostile filename reaches the child process intact");

  for (const name of HOSTILE_NAMES) {
    const key = `path:shots/S-01/takes/${name}`;
    const answer = inA(key);
    assert.strictEqual(answer.state, "available", `expected ${name} to resolve`);
    assert.strictEqual(answer.path, path.join(A_DIR, "shots", "S-01", "takes", name));

    let seen = null;
    const result = await Affordance.revealLocalFile({
      projectsRoot: PROJECTS_ROOT, slug: FILM_A, key, platform: "win32",
      spawner: (file, args, options) => { seen = { file, args, options }; return {}; },
    });
    assert.strictEqual(result.ok, true, `expected ${name} to launch`);
    assert.strictEqual(seen.file, "explorer.exe");
    assert.strictEqual(seen.args.length, 1, `${name} must be one argument, never split`);
    assert.strictEqual(seen.args[0], `/select,"${answer.path}"`, `${name} must reach Explorer byte-for-byte`);
    assert.ok(seen.args[0].endsWith(`${name}"`), `${name} must not be truncated`);
    assert.strictEqual(seen.options.shell, false);
  }
  ok(`FILE-7 ${HOSTILE_NAMES.length} filenames with spaces, &, ^, %, ;, !, $(), backticks, braces, brackets, commas, apostrophes and Unicode pass through as one intact argument`);

  /* A REAL WINDOWS PROCESS LAUNCH, against a harmless program that prints the argv
     it received. This is the part a stub cannot fake: it proves CreateProcess
     delivered the path as ONE argument and that nothing expanded `%PATH%`, ran
     `$(id)`, split on `&` or truncated at `;`.

     TWO FORMS, because the launcher uses two:

       ORDINARY ARGV      what `Open project folder` sends. Node quotes, the C
                          runtime unquotes, and the value arrives whole.
       VERBATIM           what `Show in Explorer` sends. Node hands the command
                          line to CreateProcess untouched.

     The verbatim form has a harness-only wrinkle worth stating rather than hiding:
     in verbatim mode Node does not quote the EXECUTABLE path either, so a receiver
     under `C:\Program Files\...` is split at its own space before it ever runs. The
     shipped call is unaffected — it names `explorer.exe`, which has no space — but
     it means this half of the round-trip can only run where the node binary's own
     path has none. It is skipped with a reason rather than quietly dropped, and
     what it would have proven is covered by the two real Explorer launches recorded
     in the candidate's report. */
  if (process.platform !== "win32") {
    ok("(real process round-trip skipped — not Windows)");
    return;
  }

  const echo = path.join(TEMP, "echo-argv.js");
  fs.writeFileSync(echo, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");

  for (const name of HOSTILE_NAMES) {
    const target = path.join(A_DIR, "shots", "S-01", "takes", name);
    const command = Affordance.explorerOpenCommand(target);
    const run = spawnSync(process.execPath, [echo, ...command.args], { encoding: "utf8", shell: false });
    assert.strictEqual(run.error, undefined, `spawn failed for ${name}: ${run.error && run.error.message}`);
    const received = JSON.parse(run.stdout);
    assert.strictEqual(received.length, 1,
      `${name}: CreateProcess must deliver exactly one argument, got ${JSON.stringify(received)}`);
    assert.strictEqual(received[0], target, `${name}: the child must receive the path unaltered and uninterpreted`);
  }
  ok("a REAL CreateProcess round-trip delivers each hostile path as one uninterpreted argument");

  if (/\s/.test(process.execPath)) {
    ok(`(verbatim round-trip skipped — this node binary's own path contains a space: ${process.execPath})`);
    return;
  }
  for (const name of HOSTILE_NAMES) {
    const target = path.join(A_DIR, "shots", "S-01", "takes", name);
    const command = Affordance.explorerRevealCommand(target);
    const run = spawnSync(process.execPath, [echo, ...command.args], {
      encoding: "utf8",
      windowsVerbatimArguments: command.options.windowsVerbatimArguments,
      shell: false,
    });
    assert.strictEqual(run.error, undefined, `spawn failed for ${name}: ${run.error && run.error.message}`);
    const received = JSON.parse(run.stdout);
    /* The quotes are consumed by the receiver's own argv parsing, which is exactly
       the behaviour that makes `/select,"<path>"` reach explorer.exe as one token. */
    assert.strictEqual(received.length, 1, `${name}: verbatim must deliver one argument, got ${JSON.stringify(received)}`);
    assert.strictEqual(received[0], `/select,${target}`, `${name}: the switch and the path must arrive together`);
  }
  ok("and the verbatim reveal form delivers /select,<path> as one argument through real CreateProcess");
}

/* ===========================================================================
   8. FILE-4 — the project folder. */
async function projectFolder() {
  section("8. Open project folder opens the active project's real root");

  const folder = Affordance.projectFolderAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_A });
  assert.strictEqual(folder.state, "available");
  assert.strictEqual(folder.path, A_DIR);
  assert.ok(fs.statSync(folder.path).isDirectory());
  ok("FILE-4 the project folder resolves to the slug's directory");

  /* NOT RECONSTRUCTED FROM THE TITLE. */
  const title = JSON.parse(fs.readFileSync(path.join(A_DIR, "project.json"), "utf8")).meta.title;
  assert.strictEqual(title, "Film A");
  assert.notStrictEqual(path.basename(folder.path), title);
  ok("and it is the slug's directory, not a path rebuilt from the project's title");

  assert.strictEqual(Affordance.projectFolderAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_B }).path, B_DIR);
  for (const slug of ["..", ".", "", "film-a/anchors", "../film-a"])
    assert.strictEqual(
      Affordance.projectFolderAffordance({ projectsRoot: PROJECTS_ROOT, slug }).state,
      "unresolvable", `folder slug must not resolve: ${JSON.stringify(slug)}`);
  ok("each project opens its own folder, and an uncontained slug opens none");

  let seen = null;
  const opened = await Affordance.openProjectFolder({
    projectsRoot: PROJECTS_ROOT, slug: FILM_A, platform: "win32",
    spawner: (file, args, options) => { seen = { file, args, options }; return {}; },
  });
  assert.strictEqual(opened.ok, true);
  assert.deepStrictEqual(seen.args, [A_DIR]);
  assert.strictEqual(seen.options.shell, false);
  ok("and it launches explorer.exe on that exact directory, with no shell");
}

/* ===========================================================================
   9. A directory is not a file. */
function directoriesAreNotFiles() {
  section("9. only a regular file inside the project is revealable");
  fs.mkdirSync(path.join(A_DIR, "anchors", "subfolder"), { recursive: true });
  const dir = inA("path:anchors/subfolder");
  assert.strictEqual(dir.state, "unresolvable");
  assert.strictEqual(dir.reason, "not-a-file");
  ok("a directory that matches the media shape is still refused — it is not the file claimed");
}

/* ===========================================================================
   10. THE HTTP SEAM. One server, and no Explorer window. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function httpSeam() {
  section("10. the HTTP seam takes an identity and nothing else");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(base + "/api/me")).ok) break; } catch {}
    if (Date.now() > deadline) { child.kill(); throw new Error(`Server did not start:\n${output}`); }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  const post = async (route, body) => {
    const response = await fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  try {
    const scan = await (await fetch(base + "/api/scan?project=" + FILM_A)).json();
    const anchorRow = (scan.anchors || []).find((row) => row.name === "CHAR-RHEA.png");
    assert.ok(anchorRow, `expected the scan to list the anchor: ${JSON.stringify(scan.anchors)}`);
    const key = Shared.localFileKey(anchorRow);
    assert.ok(key.startsWith("asset:") || key.startsWith("path:"), `expected a usable key, got ${key}`);
    ok("the shipped scan row is enough to mint a key — no surface assembles one");

    const resolved = await post("/api/local-file/resolve", { key, projectSlug: FILM_A });
    assert.strictEqual(resolved.status, 200);
    assert.strictEqual(resolved.data.state, "available");
    assert.strictEqual(resolved.data.path, path.join(A_DIR, "anchors", "CHAR-RHEA.png"));
    ok("POST /api/local-file/resolve answers with the exact absolute file");

    const crossed = await post("/api/local-file/resolve", { key: `asset:${ASSET_A_ANCHOR}`, projectSlug: FILM_B });
    assert.strictEqual(crossed.data.state, "unresolvable");
    assert.notStrictEqual(crossed.data.path, path.join(B_DIR, "anchors", "CHAR-RHEA.png"));
    ok("FILE-8 over HTTP: Film A's identity resolves to nothing in Film B's context");

    /* LF2. An arbitrary machine path is not addressable, in ANY field. */
    const hostFile = path.join(TEMP, "outside.txt");
    fs.writeFileSync(hostFile, "outside the projects root");
    for (const body of [
      { key: `path:${hostFile.replace(/\\/g, "/")}`, projectSlug: FILM_A },
      { key: "path:../../outside.txt", projectSlug: FILM_A },
      { key: `path:${hostFile}`, projectSlug: FILM_A },
      { key: "path:C:/Windows/System32/notepad.exe", projectSlug: FILM_A },
      { key: "path:anchors/../../../outside.txt", projectSlug: FILM_A },
      { key: "", path: hostFile, projectSlug: FILM_A },
      { key: "", file: hostFile, projectSlug: FILM_A },
      { key: "", absolutePath: hostFile, projectSlug: FILM_A },
      { key: "", target: hostFile, projectSlug: FILM_A },
    ]) {
      const answer = await post("/api/local-file/resolve", body);
      assert.strictEqual(answer.data.state, "unresolvable",
        `an arbitrary machine path must not resolve: ${JSON.stringify(body)}`);
      assert.strictEqual(answer.data.path || "", "");
    }
    ok("LF2 no body shape reaches a path outside the project — there is no path-taking endpoint");

    const unknown = await post("/api/local-file/resolve", { key, projectSlug: "no-such-film" });
    assert.strictEqual(unknown.status, 404);
    assert.strictEqual(unknown.data.code, "PROJECT_NOT_FOUND");
    const climbing = await post("/api/local-file/resolve", { key, projectSlug: "../film-b" });
    assert.strictEqual(climbing.status, 404);
    ok("an unknown or uncontained project slug is refused, not quietly replaced by the active project");

    /* No slug: the ACTIVE project answers, which config.activeProject says is Film A. */
    const active = await post("/api/local-file/resolve", { key: `asset:${ASSET_A_FRAME}` });
    assert.strictEqual(active.data.slug, FILM_A);
    assert.strictEqual(active.data.state, "available");
    assert.strictEqual(active.data.path, path.join(A_DIR, "shots", "S-01", "takes", "S-01_FRAME_A.png"));
    ok("with no slug the ACTIVE project answers, through the same containment");

    /* FILE-6 over HTTP: the reveal route refuses truthfully and launches nothing.
       Safe to call for real — a missing file never reaches the launcher. */
    const revealGone = await post("/api/local-file/reveal", { key: `asset:${ASSET_A_GONE}`, projectSlug: FILM_A });
    assert.strictEqual(revealGone.status, 200, "a refusal is an answer, not a 500");
    assert.strictEqual(revealGone.data.ok, false);
    assert.strictEqual(revealGone.data.state, "missing");
    assert.strictEqual(revealGone.data.message, "File is no longer available at its recorded local path");
    ok("FILE-6 over HTTP: POST /api/local-file/reveal refuses truthfully and opens nothing");

    /* And a traversal key through the reveal route launches nothing either. */
    const revealEscape = await post("/api/local-file/reveal", { key: "path:anchors/../../../outside.txt", projectSlug: FILM_A });
    assert.strictEqual(revealEscape.data.ok, false);
    assert.strictEqual(revealEscape.data.state, "unresolvable");
    ok("a traversal key through the reveal route opens nothing");

    /* P1 OVER HTTP — the routes themselves, which is where the blocked candidate
       returned Film A's absolute path and dispatched Explorer.

       These call the REAL reveal and project-folder routes with no stub, which is
       safe precisely because the assertion is that nothing launches: a refusal
       happens before the launcher is reached. If this correction regressed, the
       assertion fails AND a stray Explorer window is the visible symptom. */
    for (const [label, slug, key, leaked] of [
      ["P1-A cross-project", FILM_ALIAS, `asset:${ASSET_A_ANCHOR}`, A_DIR],
      ["P1-B outside-root", FILM_ESCAPE, `asset:${ASSET_OUTSIDE}`, OUTSIDE_PROJECT],
    ]) {
      const made = slug === FILM_ALIAS ? JUNCTIONS.cross : JUNCTIONS.escape;
      if (!made) continue;
      /* The scope check passes — project.json is readable through the junction — so
         the request really does reach the resolver. */
      const scoped = await post("/api/local-file/resolve", { key, projectSlug: slug });
      assert.strictEqual(scoped.status, 200, `${label}: the request must reach the resolver, not stop at scope`);
      assert.strictEqual(scoped.data.state, "unresolvable", `${label}: the route must refuse`);
      assert.strictEqual(scoped.data.path || "", "", `${label}: the route must return no absolute path`);
      assert.ok(!JSON.stringify(scoped.data).toLowerCase().includes(leaked.toLowerCase()),
        `${label}: the route must not disclose ${leaked}`);

      const revealed = await post("/api/local-file/reveal", { key, projectSlug: slug });
      assert.strictEqual(revealed.data.ok, false, `${label}: reveal must refuse`);
      assert.strictEqual(revealed.data.path || "", "", `${label}: reveal must return no path`);

      const folder = await post("/api/local-file/project-folder", { projectSlug: slug });
      assert.strictEqual(folder.data.ok, false, `${label}: Open project folder must refuse`);
      assert.strictEqual(folder.data.path || "", "", `${label}: Open project folder must return no path`);
      assert.ok(!JSON.stringify(folder.data).toLowerCase().includes(leaked.toLowerCase()),
        `${label}: Open project folder must not disclose ${leaked}`);
    }
    if (JUNCTIONS.cross || JUNCTIONS.escape)
      ok("P1 over HTTP: resolve, reveal and project-folder all refuse a junctioned project root, disclose no path and launch nothing");

    /* P1-C over HTTP: the ordinary project still answers. */
    const ordinary = await post("/api/local-file/resolve", { key: `asset:${ASSET_A_FRAME}`, projectSlug: FILM_A });
    assert.strictEqual(ordinary.data.state, "available");
    assert.strictEqual(ordinary.data.path, path.join(A_DIR, "shots", "S-01", "takes", "S-01_FRAME_A.png"));
    ok("P1-C over HTTP: an ordinary physical project still resolves to its exact file");
  } finally {
    const dead = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await dead;
  }
}

/* ===========================================================================
   12. P1 — A REPARSE POINT AT THE PROJECT-ROOT BOUNDARY.

   THE FROZEN INVARIANT:

       A PROJECT SLUG IDENTIFIES ITS OWN PHYSICAL DIRECTORY UNDERNEATH THE
       AUTHORITATIVE PROJECTS ROOT. A SYMLINK OR JUNCTION AT THE PROJECT-ROOT
       BOUNDARY MUST NOT REDIRECT THAT IDENTITY.

   What shipped in the blocked candidate validated the project directory
   LEXICALLY, which is a statement about a NAME. `projects/film-b` as a junction
   passed every one of those tests and named `projects/film-a` — so the seam read
   Film A's ledger under Film B's identity, returned Film A's absolute path, and
   dispatched Explorer. Measured, not theorised: both cases answered `available`.

   Every assertion here is named `P1-x` so that a regression to lexical-only
   validation fails at a sentence that says what broke. */
async function projectRootJunctions() {
  section("12. P1 — a junction at the project-root boundary redirects nothing");

  if (!JUNCTIONS.cross && !JUNCTIONS.escape) {
    ok(`(P1 junction proofs skipped — this environment refused to create one: ${JUNCTIONS.why})`);
    return;
  }

  /* A spawner that records instead of launching. Every adversarial case below goes
     through the real reveal path; none of them opens a window. */
  const launches = [];
  const spy = (file, args) => { launches.push({ file, args }); return {}; };

  /* ---- P1-A: cross-project root junction ---- */
  if (JUNCTIONS.cross) {
    assert.ok(fs.lstatSync(ALIAS_DIR).isSymbolicLink(), "fixture invalid: film-alias must be a junction");
    assert.ok(fs.existsSync(path.join(ALIAS_DIR, "project.json")),
      "fixture invalid: the junction must carry a readable project.json, or the refusal proves nothing");
    assert.strictEqual(
      fs.realpathSync.native(ALIAS_DIR).toLowerCase(), A_DIR.toLowerCase(),
      "fixture invalid: film-alias must physically be film-a");

    /* The project directory is refused BEFORE any ledger read. */
    const resolved = require(path.join(ROOT, "media-asset-service"))
      .resolvePhysicalProjectDir(PROJECTS_ROOT, FILM_ALIAS);
    assert.strictEqual(resolved.ok, false, "P1-A project-directory validation must refuse a cross-project junction");
    assert.strictEqual(resolved.reason, "project-root-redirected");
    assert.strictEqual(resolved.realDir, "", "P1-A a refused project directory yields no directory at all");
    ok("P1-A project-directory validation refuses `film-alias -> film-a` and names the reason");

    /* The ledger is never consulted: Film A's id does not answer under the alias. */
    const located = require(path.join(ROOT, "media-asset-service")).assetLocation({
      projectsRoot: PROJECTS_ROOT, slug: FILM_ALIAS, assetId: ASSET_A_ANCHOR,
    });
    assert.strictEqual(located.known, false, "P1-A the ledger must not be read through a redirected project root");
    ok("P1-A assetLocation refuses too — Film A's ledger is not read under Film B's identity");

    /* The affordance refuses, and discloses no path. */
    const answer = Affordance.localFileAffordance({
      projectsRoot: PROJECTS_ROOT, slug: FILM_ALIAS, key: `asset:${ASSET_A_ANCHOR}`,
    });
    assert.strictEqual(answer.state, "unresolvable", "P1-A a Film A asset must not resolve under an aliased slug");
    assert.strictEqual(answer.reason, "project-root-redirected");
    assert.strictEqual(answer.path, "", "P1-A no absolute path may be returned");
    assert.strictEqual(answer.recordedPath, "", "P1-A and none may leak through recordedPath either");
    ok("P1-A Show in Explorer / Copy file path resolve to nothing — no Film A path is disclosed");

    /* Including by stored path, which is the other domain. */
    const byPath = Affordance.localFileAffordance({
      projectsRoot: PROJECTS_ROOT, slug: FILM_ALIAS, key: "path:anchors/CHAR-RHEA.png",
    });
    assert.strictEqual(byPath.state, "unresolvable");
    assert.strictEqual(byPath.path, "");
    ok("P1-A and the `path:` domain is refused identically — the boundary is checked before the domain");

    /* Nothing is launched. */
    const revealed = await Affordance.revealLocalFile({
      projectsRoot: PROJECTS_ROOT, slug: FILM_ALIAS, key: `asset:${ASSET_A_ANCHOR}`,
      platform: "win32", spawner: spy,
    });
    assert.strictEqual(revealed.ok, false);
    assert.strictEqual(revealed.path, "");
    assert.deepStrictEqual(launches, [], "P1-A Explorer must not be spawned for an aliased project");
    ok("P1-A Explorer is not spawned");

    /* And Film A / Film B separation is untouched by the correction. */
    assert.strictEqual(
      Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_A, key: `asset:${ASSET_A_ANCHOR}` }).path,
      path.join(A_DIR, "anchors", "CHAR-RHEA.png"));
    assert.strictEqual(
      Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_B, key: `asset:${ASSET_B_ANCHOR}` }).path,
      path.join(B_DIR, "anchors", "CHAR-RHEA.png"));
    assert.strictEqual(
      Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_B, key: `asset:${ASSET_A_ANCHOR}` }).state,
      "unresolvable");
    ok("P1-A Film A / Film B separation still holds through their real directories");
  }

  /* ---- P1-B: outside-root junction ---- */
  if (JUNCTIONS.escape) {
    assert.ok(fs.lstatSync(ESCAPE_DIR).isSymbolicLink(), "fixture invalid: film-escape must be a junction");
    assert.ok(fs.existsSync(path.join(ESCAPE_DIR, "media-assets.json")),
      "fixture invalid: the outside project must be complete, or the refusal proves nothing");

    const resolved = require(path.join(ROOT, "media-asset-service"))
      .resolvePhysicalProjectDir(PROJECTS_ROOT, FILM_ESCAPE);
    assert.strictEqual(resolved.ok, false, "P1-B a project root pointing outside the root must be refused");
    assert.strictEqual(resolved.reason, "project-root-redirected");
    ok("P1-B project-directory validation refuses a junction leading outside the projects root");

    const located = require(path.join(ROOT, "media-asset-service")).assetLocation({
      projectsRoot: PROJECTS_ROOT, slug: FILM_ESCAPE, assetId: ASSET_OUTSIDE,
    });
    assert.strictEqual(located.known, false, "P1-B no ledger outside the projects root may be read");
    ok("P1-B the outside project's ledger is not read");

    const answer = Affordance.localFileAffordance({
      projectsRoot: PROJECTS_ROOT, slug: FILM_ESCAPE, key: `asset:${ASSET_OUTSIDE}`,
    });
    assert.strictEqual(answer.state, "unresolvable");
    assert.strictEqual(answer.path, "");
    assert.strictEqual(answer.recordedPath, "");
    /* Belt and braces: nothing anywhere in the answer names the outside location. */
    assert.ok(!JSON.stringify(answer).toLowerCase().includes(OUTSIDE_PROJECT.toLowerCase()),
      "P1-B no path outside the projects root may appear anywhere in the answer");
    ok("P1-B asset resolution refuses and discloses no outside absolute path");

    const before = launches.length;
    await Affordance.revealLocalFile({
      projectsRoot: PROJECTS_ROOT, slug: FILM_ESCAPE, key: `asset:${ASSET_OUTSIDE}`,
      platform: "win32", spawner: spy,
    });
    assert.strictEqual(launches.length, before, "P1-B nothing may be launched for an escaping project root");
    ok("P1-B nothing is launched");
  }

  /* ---- P1-D: the project folder, against BOTH junction cases ---- */
  for (const [label, slug, made] of [["cross-project", FILM_ALIAS, JUNCTIONS.cross], ["outside-root", FILM_ESCAPE, JUNCTIONS.escape]]) {
    if (!made) continue;
    const folder = Affordance.projectFolderAffordance({ projectsRoot: PROJECTS_ROOT, slug });
    assert.strictEqual(folder.state, "unresolvable", `P1-D Open project folder must refuse the ${label} junction`);
    assert.strictEqual(folder.reason, "project-root-redirected");
    assert.strictEqual(folder.path, "", `P1-D and disclose no directory for the ${label} junction`);

    const before = launches.length;
    const opened = await Affordance.openProjectFolder({
      projectsRoot: PROJECTS_ROOT, slug, platform: "win32", spawner: spy,
    });
    assert.strictEqual(opened.ok, false);
    assert.strictEqual(launches.length, before, `P1-D Explorer must not open the ${label} junction`);
  }
  ok("P1-D Open project folder uses the same validation and follows neither junction");

  /* ---- P1-C: an ordinary physical project is unaffected ---- */
  const ordinary = require(path.join(ROOT, "media-asset-service"))
    .resolvePhysicalProjectDir(PROJECTS_ROOT, FILM_B);
  assert.strictEqual(ordinary.ok, true, "P1-C an ordinary project directory must still validate");
  assert.strictEqual(ordinary.realDir, B_DIR);
  assert.strictEqual(
    Affordance.projectFolderAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_B }).path, B_DIR);
  assert.strictEqual(
    Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_B, key: "path:anchors/CHAR-RHEA.png" }).state,
    "available");
  const stillWorks = await Affordance.revealLocalFile({
    projectsRoot: PROJECTS_ROOT, slug: FILM_A, key: `asset:${ASSET_A_ANCHOR}`,
    platform: "win32", spawner: spy,
  });
  assert.strictEqual(stillWorks.ok, true, "P1-C an ordinary project must still reveal");
  assert.strictEqual(launches.length, 1, "P1-C exactly one launch, and it is the legitimate one");
  assert.strictEqual(launches[0].args[0], `/select,"${path.join(A_DIR, "anchors", "CHAR-RHEA.png")}"`);
  ok("P1-C ordinary physical projects are untouched — resolve, folder and reveal all still work");

  /* ---- P1-E: the supported workspace.mediaRoot mechanism is not redefined ---- */
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const affordanceSource = stripComments(fs.readFileSync(path.join(ROOT, "local-file-affordance.js"), "utf8"));
  const serviceSource = stripComments(fs.readFileSync(path.join(ROOT, "media-asset-service.js"), "utf8"));
  for (const [name, source] of [["local-file-affordance.js", affordanceSource], ["media-asset-service.js", serviceSource]])
    for (const token of ["mediaRoot", "syncConfiguredMediaRoot", "copyMissingTree", "configuredWorkspacePath"])
      assert.ok(!source.includes(token), `P1-E ${name} must not reach the workspace media-root mechanism (${token})`);
  const serverSource = stripComments(fs.readFileSync(path.join(ROOT, "server.js"), "utf8"));
  assert.ok(/function syncConfiguredMediaRoot\(/.test(serverSource),
    "P1-E the supported media-root sync must still exist, unchanged by this seam");
  const localFileBlock = serverSource.slice(
    serverSource.indexOf("function localFileScope"),
    serverSource.indexOf("app.post(", serverSource.indexOf('app.post("/api/local-file/project-folder"') + 20));
  assert.ok(!localFileBlock.includes("mediaRoot") && !localFileBlock.includes("syncConfiguredMediaRoot"),
    "P1-E no local-file route touches the media-root mechanism");
  /* And behaviourally: media that arrived through a media-root sync is an ordinary
     file in the project's own media/ folder, and still resolves. */
  assert.strictEqual(
    Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug: FILM_A, key: "path:media/planning-board.png" }).state,
    "available");
  ok("P1-E workspace.mediaRoot is untouched — synced media is an ordinary project file and still resolves");
}

/* ---------------------------------------------------------------------------
   THE STRUCTURAL PROOFS. Read from source, because they are claims about what the
   code CANNOT do rather than about what it did on one input. */
function structure() {
  section("11. the seam cannot grow a path-taking endpoint or a shell");
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const server = stripComments(fs.readFileSync(path.join(ROOT, "server.js"), "utf8"));
  const affordance = stripComments(fs.readFileSync(path.join(ROOT, "local-file-affordance.js"), "utf8"));

  /* Every local-file route is loopback-gated. A count, not a vibe: a fourth route
     that forgot the gate fails this. */
  const routes = [...server.matchAll(/app\.(get|post)\("(\/api\/local-file\/[^"]+)"/g)].map((m) => m[2]).sort();
  assert.deepStrictEqual(routes, ["/api/local-file/project-folder", "/api/local-file/resolve", "/api/local-file/reveal"],
    "exactly three local-file routes, and a fourth has to be argued for in a diff");
  assert.strictEqual((server.match(/if \(!requireLocalMachine\(req, res\)\) return;/g) || []).length, routes.length,
    "every local-file route gates on the peer being this machine");
  ok("three routes, each gated on the request coming from the computer CineBraid runs on");

  /* The routes read `key` and a project slug. Nothing else from the body reaches
     the resolver. */
  const blockStart = server.indexOf("function localFileScope");
  const lastRoute = server.indexOf('app.post("/api/local-file/project-folder"');
  const blockEnd = server.indexOf("app.post(", lastRoute + 20);
  assert.ok(blockStart > 0 && lastRoute > blockStart && blockEnd > lastRoute,
    "expected to locate the local-file route block in server.js");
  const routeBlock = server.slice(blockStart, blockEnd);
  assert.ok(routeBlock.includes("/api/local-file/resolve") && routeBlock.includes("/api/local-file/reveal"),
    "the extracted block must really contain all three routes");
  for (const field of [
    "req.body?.path", "req.body.path", "req.body?.file", "req.body.file",
    "req.body?.absolutePath", "req.body?.target", "req.query.path", "req.query.file",
  ])
    assert.ok(!routeBlock.includes(field), `the local-file routes must not read ${field}`);
  /* The only body fields the block names at all. */
  const bodyReads = [...new Set([...routeBlock.matchAll(/req\.body\?\.(\w+)/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(bodyReads, ["key", "project", "projectSlug"],
    "the local-file routes read a media identity and a project slug, and nothing else");
  ok("no local-file route reads a filesystem path out of the request — only `key` and a project slug");

  /* LF3, structurally: no shell anywhere in the launcher. */
  for (const token of ["exec(", "execSync", "execFile", "shell: true", "cmd.exe", "powershell", "spawnSync"])
    assert.ok(!affordance.includes(token), `local-file-affordance.js must not reference ${token}`);
  assert.ok(/shell: false/.test(affordance), "the launcher states shell: false explicitly");
  ok("LF3 the launcher contains no exec, no shell and no command interpreter");

  /* THE KEY NEVER ENTERS A SCRIPT CONTEXT. `'` is a legal Windows filename
     character, and an HTML parser decodes `&#39;` in an attribute BEFORE the
     handler text is parsed as JavaScript — so a key inside an inline onclick is
     broken for any file whose name contains an apostrophe. It travels as data. */
  const client = stripComments(fs.readFileSync(path.join(ROOT, "public", "local-file-actions.js"), "utf8"));
  assert.ok(!/onclick=/.test(client),
    "the local-file slot must not build inline handlers — the key travels as a data attribute");
  assert.ok(/data-local-file-key=/.test(client) && /addEventListener\("click"/.test(client),
    "the key is read back from the slot by a delegated listener");
  for (const sink of ["innerHTML = key", "eval(", "new Function(", "setAttribute(\"onclick\""])
    assert.ok(!client.includes(sink), `public/local-file-actions.js must not use ${sink}`);
  ok("the media identity never reaches a script context — it is data on the slot, read by one listener");

  /* LF2, structurally: the ledger is still read through its one owner. */
  for (const ledgerModule of ["media-assets", "media-asset-store", "media-asset-indexer", "media-asset-verify"])
    assert.ok(!new RegExp(`require\\(["'./]*${ledgerModule}["']\\)`).test(affordance),
      `local-file-affordance.js must not import ${ledgerModule} — the ledger has one owner`);
  assert.ok(/require\("\.\/media-asset-service"\)/.test(affordance),
    "it reaches durable identity through the ledger's single owner");
  for (const symbol of ["readLedger", "writeLedger", "writeLedgerSync", "indexProject", "verifyAssets"])
    assert.ok(!new RegExp(`\\b${symbol}\\s*\\(`).test(affordance),
      `local-file-affordance.js must not call ${symbol}`);
  ok("durable identity is read through media-asset-service.js — no second ledger reader");
}

(async function main() {
  sharedContract();
  pathGrammar();
  resolvesExactFile();
  await missingFile();
  projectSeparation();
  launchShape();
  await hostileFilenames();
  await projectFolder();
  directoriesAreNotFiles();
  await projectRootJunctions();
  await httpSeam();
  structure();
  console.log(`\nLOCAL FILE AFFORDANCES V1 — ${passes} assertions held.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
