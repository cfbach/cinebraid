/* LOCAL FILE AFFORDANCES V1 — NEGATIVE CONTROLS.
 *
 * tests/local-file-affordances.js asserts the guarantees. This file proves those
 * assertions can FAIL — that each one is load-bearing rather than a sentence that
 * happens to be true about any implementation.
 *
 * THE TECHNIQUE. Every control below builds the DEFECTIVE implementation — the one
 * a reasonable person would have written — runs it against the same fixture, and
 * asserts two things:
 *
 *     the defective implementation really does produce the wrong answer, and
 *     the shipped implementation does not.
 *
 * A control that only asserted the second half would still pass if the guarantee
 * were unreachable, which is exactly the failure mode a negative-control suite
 * exists to catch.
 *
 * The three the slice named explicitly are controls 1, 2 and 3. Controls 4 to 7 are
 * the defects this seam actually came close to shipping, one of which it DID ship
 * during development and which no argv assertion would have caught.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const Affordance = require(path.join(ROOT, "local-file-affordance"));
const Shared = require(path.join(ROOT, "public", "shared-local-file"));

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-localfile-neg-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const A_DIR = path.join(PROJECTS_ROOT, "film-a");
const B_DIR = path.join(PROJECTS_ROOT, "film-b");
const OUTSIDE = path.join(TEMP, "not-a-project");

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

let passes = 0;
function ok(message) {
  passes += 1;
  console.log(`  ok  ${message}`);
}
function section(title) {
  console.log(`\n${title}`);
}

/* ---------------------------------------------------------------------------
   FIXTURE. Two projects holding files with the SAME basenames, plus a directory
   outside the projects root holding a secret. */
function makeProject(dir, marker) {
  for (const sub of ["anchors", "plates", "props", "vehicles", "audio", "media"])
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  fs.mkdirSync(path.join(dir, "shots", "S-01", "takes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "shots", "S-02", "takes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "anchors", "CHAR-RHEA.png"), Buffer.concat([PNG, Buffer.from(marker)]));
  /* The SAME basename in two different shots of the SAME project — control 2. */
  fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", "BLOCK.png"), Buffer.concat([PNG, Buffer.from(`${marker}-S01`)]));
  fs.writeFileSync(path.join(dir, "shots", "S-02", "takes", "BLOCK.png"), Buffer.concat([PNG, Buffer.from(`${marker}-S02`)]));
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ meta: { title: marker } }));
}
function writeLedger(dir, rows) {
  fs.writeFileSync(path.join(dir, "media-assets.json"), JSON.stringify({
    schemaVersion: 1,
    assets: rows.map((row) => ({
      assetId: row.assetId, hashState: "unhashed", contentHash: null, mediaType: "image",
      role: "unknown", source: "unknown", lifecycle: "candidate", scope: {},
      storage: { path: row.path, bytes: 8, mtimeMs: 1 }, legacy: {}, indexedAt: "2026-01-01T00:00:00.000Z",
    })),
  }, null, 2));
}

const ASSET_A = "asset-" + "a".repeat(32);
const ASSET_A_S01 = "asset-" + "1".repeat(32);
const ASSET_A_S02 = "asset-" + "2".repeat(32);
const ASSET_B = "asset-" + "b".repeat(32);

fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
fs.mkdirSync(OUTSIDE, { recursive: true });
fs.writeFileSync(path.join(OUTSIDE, "secret.png"), PNG);
makeProject(A_DIR, "Film A");
makeProject(B_DIR, "Film B");
writeLedger(A_DIR, [
  { assetId: ASSET_A, path: "anchors/CHAR-RHEA.png" },
  { assetId: ASSET_A_S01, path: "shots/S-01/takes/BLOCK.png" },
  { assetId: ASSET_A_S02, path: "shots/S-02/takes/BLOCK.png" },
]);
writeLedger(B_DIR, [{ assetId: ASSET_B, path: "anchors/CHAR-RHEA.png" }]);

const shipped = (slug, key) => Affordance.localFileAffordance({ projectsRoot: PROJECTS_ROOT, slug, key });

/* ===========================================================================
   CONTROL 1 — ACCEPTING A RAW ARBITRARY CLIENT PATH.

   The endpoint the slice forbids: `POST /open-path { path: "C:\\whatever" }`. It
   is the obvious implementation, it is one line, and it hands the browser the
   filesystem. */
section("control 1 — an endpoint that accepts a client-supplied path");
{
  /* THE DEFECT, as it would have been written. */
  function defectiveOpenPath(body) {
    const target = String(body.path || "");
    return fs.existsSync(target) ? { state: "available", path: target } : { state: "missing", path: "" };
  }

  const secret = path.join(OUTSIDE, "secret.png");
  const machineFile = process.platform === "win32"
    ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
    : "/etc/hosts";

  /* The defect really is a defect: it reaches outside the projects root. */
  assert.strictEqual(defectiveOpenPath({ path: secret }).state, "available",
    "control invalid: the defective endpoint was supposed to reach outside the root");
  assert.strictEqual(defectiveOpenPath({ path: secret }).path, secret);
  ok("the defective path-taking endpoint reaches a file outside every project — the control is live");

  if (fs.existsSync(machineFile)) {
    assert.strictEqual(defectiveOpenPath({ path: machineFile }).state, "available");
    ok(`and it reaches ${path.basename(machineFile)} on this machine`);
  }

  /* THE SHIPPED SEAM REFUSES EVERY SHAPE OF THE SAME REQUEST. */
  const attempts = [
    `path:${secret}`,
    `path:${secret.replace(/\\/g, "/")}`,
    "path:../not-a-project/secret.png",
    "path:anchors/../../not-a-project/secret.png",
    "path:anchors/../../../not-a-project/secret.png",
    `path:${machineFile}`,
    `path:${machineFile.replace(/\\/g, "/")}`,
    "path:C:/Windows/System32/notepad.exe",
    "path://server/share/x.png",
  ];
  for (const key of attempts) {
    const answer = shipped("film-a", key);
    assert.strictEqual(answer.state, "unresolvable", `must refuse: ${key}`);
    assert.strictEqual(answer.path, "", `must yield no path: ${key}`);
  }
  ok(`the shipped seam refuses all ${attempts.length} of them and yields no path`);

  /* AND THERE IS NO SUCH ENDPOINT TO CALL. Structural, because "we validated it"
     is a weaker claim than "the shape does not exist". */
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/\/open-path/.test(server), "no /open-path route may exist");
  const localFileHandlers = server.slice(
    server.indexOf("function localFileScope"),
    server.indexOf("app.post(", server.indexOf('app.post("/api/local-file/project-folder"') + 20));
  assert.ok(!/req\.body[?.]*\.path\b/.test(localFileHandlers),
    "no local-file route may read a path from the body");
  ok("and no route of that shape exists in server.js at all");
}

/* ===========================================================================
   CONTROL 2 — RECONSTRUCTING A PATH FROM THE DISPLAY FILENAME.

   The second obvious implementation: the surface already shows `BLOCK.png`, so
   glue it to a media folder and reveal that. It works on every test project that
   has one shot, and it silently reveals the WRONG FILE the moment two shots hold a
   file with the same name — which is the normal state of a production. */
section("control 2 — a path rebuilt from the displayed filename or title");
{
  /* THE DEFECT: the basename plus a guessed folder. */
  function defectiveByName(slug, displayName) {
    const dir = path.join(PROJECTS_ROOT, slug, "shots", "S-01", "takes");
    const guess = path.join(dir, displayName);
    return fs.existsSync(guess) ? { state: "available", path: guess } : { state: "missing", path: "" };
  }

  const s01 = path.join(A_DIR, "shots", "S-01", "takes", "BLOCK.png");
  const s02 = path.join(A_DIR, "shots", "S-02", "takes", "BLOCK.png");
  assert.notStrictEqual(fs.readFileSync(s01).toString("hex"), fs.readFileSync(s02).toString("hex"),
    "control invalid: the two BLOCK.png files must really be different files");

  /* The defect answers S-01's file for S-02's media, confidently. */
  const guessed = defectiveByName("film-a", "BLOCK.png");
  assert.strictEqual(guessed.state, "available");
  assert.strictEqual(guessed.path, s01);
  assert.notStrictEqual(guessed.path, s02, "control invalid: the guess was supposed to land on the wrong shot");
  ok("the filename-reconstructing implementation confidently returns S-01's file for S-02's media");

  /* THE SHIPPED SEAM CANNOT BE ASKED THAT QUESTION. A bare basename is not a key. */
  assert.strictEqual(Shared.localFileKey({ name: "BLOCK.png" }), "",
    "a display name alone must not mint a key");
  assert.strictEqual(Shared.localFileKey({ name: "BLOCK.png", url: "BLOCK.png" }), "");
  assert.strictEqual(Shared.parseLocalFileKey("path:BLOCK.png").domain, "",
    "a bare basename is not a project media path");
  assert.strictEqual(shipped("film-a", "path:BLOCK.png").state, "unresolvable");
  ok("a bare display name mints no key and parses as nothing");

  /* And each shot's media resolves to its OWN file, by identity and by full path. */
  assert.strictEqual(shipped("film-a", `asset:${ASSET_A_S01}`).path, s01);
  assert.strictEqual(shipped("film-a", `asset:${ASSET_A_S02}`).path, s02);
  assert.strictEqual(shipped("film-a", "path:shots/S-01/takes/BLOCK.png").path, s01);
  assert.strictEqual(shipped("film-a", "path:shots/S-02/takes/BLOCK.png").path, s02);
  ok("and two shots sharing a filename resolve to two different files, by identity and by stored path");

  /* THE TITLE, LIKEWISE. The project document says "Film A"; the folder is film-a,
     and a resolver built on the title finds nothing. */
  const title = JSON.parse(fs.readFileSync(path.join(A_DIR, "project.json"), "utf8")).meta.title;
  assert.strictEqual(title, "Film A");
  assert.ok(!fs.existsSync(path.join(PROJECTS_ROOT, title)),
    "control invalid: a folder named after the title must not exist");
  assert.strictEqual(Affordance.projectFolderAffordance({ projectsRoot: PROJECTS_ROOT, slug: title }).state,
    "unresolvable", "the title is not a slug and must resolve to nothing");
  assert.strictEqual(Affordance.projectFolderAffordance({ projectsRoot: PROJECTS_ROOT, slug: "film-a" }).path, A_DIR);
  ok("the project folder resolves from the slug and not from the title — the title resolves to nothing");
}

/* ===========================================================================
   CONTROL 3 — REVEALING A FILM-A FILE THROUGH FILM-B'S CONTEXT. */
section("control 3 — one project's identity resolved in another project's context");
{
  /* THE DEFECT: resolve the identity anywhere under the projects root, because the
     ids are globally unique so surely the project does not matter. */
  function defectiveGlobalLookup(assetId) {
    for (const slug of fs.readdirSync(PROJECTS_ROOT)) {
      const ledgerFile = path.join(PROJECTS_ROOT, slug, "media-assets.json");
      if (!fs.existsSync(ledgerFile)) continue;
      const row = JSON.parse(fs.readFileSync(ledgerFile, "utf8")).assets
        .find((asset) => asset.assetId === assetId);
      if (row) return { state: "available", path: path.join(PROJECTS_ROOT, slug, row.storage.path) };
    }
    return { state: "unresolvable", path: "" };
  }
  /* AND ITS COUSIN: fall back to the matching filename when the id is not found. */
  function defectiveFilenameFallback(slug, assetId, knownPath) {
    const ledgerFile = path.join(PROJECTS_ROOT, slug, "media-assets.json");
    const row = JSON.parse(fs.readFileSync(ledgerFile, "utf8")).assets.find((a) => a.assetId === assetId);
    if (row) return { state: "available", path: path.join(PROJECTS_ROOT, slug, row.storage.path) };
    const guess = path.join(PROJECTS_ROOT, slug, knownPath);
    return fs.existsSync(guess) ? { state: "available", path: guess } : { state: "unresolvable", path: "" };
  }

  const aFile = path.join(A_DIR, "anchors", "CHAR-RHEA.png");
  const bFile = path.join(B_DIR, "anchors", "CHAR-RHEA.png");
  assert.notStrictEqual(fs.readFileSync(aFile).toString("hex"), fs.readFileSync(bFile).toString("hex"),
    "control invalid: the two projects' anchors must really be different files");

  /* Both defects cross the boundary, in opposite directions. */
  assert.strictEqual(defectiveGlobalLookup(ASSET_A).path, aFile);
  ok("a project-blind global lookup resolves Film A's identity while Film B is the context");
  const fallen = defectiveFilenameFallback("film-b", ASSET_A, "anchors/CHAR-RHEA.png");
  assert.strictEqual(fallen.state, "available");
  assert.strictEqual(fallen.path, bFile, "control invalid: the fallback was supposed to land on Film B's file");
  ok("and a filename fallback answers Film B's file for an identity that belongs to Film A");

  /* THE SHIPPED SEAM DOES NEITHER. */
  const crossed = shipped("film-b", `asset:${ASSET_A}`);
  assert.strictEqual(crossed.state, "unresolvable");
  assert.strictEqual(crossed.reason, "identity-not-in-ledger");
  assert.strictEqual(crossed.path, "");
  assert.notStrictEqual(crossed.path, aFile);
  assert.notStrictEqual(crossed.path, bFile);
  ok("the shipped seam resolves it to NOTHING — neither the other project's file nor the matching name");

  /* And the reveal launches nothing at all for it. */
  let spawned = 0;
  return Affordance.revealLocalFile({
    projectsRoot: PROJECTS_ROOT, slug: "film-b", key: `asset:${ASSET_A}`, platform: "win32",
    spawner: () => { spawned += 1; return {}; },
  }).then((result) => {
    assert.strictEqual(result.ok, false);
    assert.strictEqual(spawned, 0, "a cross-project identity must launch no process");
    ok("and no process is launched for a cross-project identity");
    return rest();
  });
}

function rest() {
  /* =========================================================================
     CONTROL 4 — A SHELL, AND WHY THE FILENAMES WOULD NOT SURVIVE ONE.

     Not hypothetical: `spawn(..., { shell: true })` is the one-character change
     that makes the launcher work on a developer's own tidy filenames and mangle a
     real production's. */
  section("control 4 — shell-string execution mangles legal Windows filenames");
  if (process.platform === "win32") {
    const echo = path.join(TEMP, "echo-argv.js");
    fs.writeFileSync(echo, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    /* THE THREE THAT CMD.EXE RELIABLY DESTROYS. Not every legal filename character
       is significant to cmd — `;`, `,`, `{}`, `[]` and `!` come through it intact —
       and listing only the ones that genuinely break keeps this control honest
       rather than lucky. The shipped launcher does not depend on knowing which is
       which, and that is the point: with no shell, the question never arises.

       `caret^and%PATH%.png` is the one worth watching: cmd expands `%PATH%`, so a
       single filename becomes the machine's entire PATH, split at every space. */
    const hostile = ["take & retake (2).png", "caret^and%PATH%.png", "plain frame.png"];
    let mangled = 0;
    for (const name of hostile) {
      const target = path.join(A_DIR, "shots", "S-01", "takes", name);
      /* THE DEFECT: a command line handed to cmd.exe. */
      const viaShell = spawnSync(`node ${echo} ${target}`, [], { shell: true, encoding: "utf8" });
      let received = null;
      try { received = JSON.parse(viaShell.stdout); } catch { received = null; }
      if (!received || received.length !== 1 || received[0] !== target) mangled += 1;

      /* THE SHIPPED FORM: an argv array, no shell. */
      const command = Affordance.explorerOpenCommand(target);
      const viaArgv = spawnSync(process.execPath, [echo, ...command.args], { encoding: "utf8", shell: false });
      const delivered = JSON.parse(viaArgv.stdout);
      assert.strictEqual(delivered.length, 1, `${name}: the shipped argv form must deliver one argument`);
      assert.strictEqual(delivered[0], target, `${name}: the shipped argv form must deliver the path whole`);
    }
    assert.strictEqual(mangled, hostile.length,
      `control invalid: every one of these was supposed to be mangled by a shell, ${mangled}/${hostile.length} were`);
    ok(`a shell mangles all ${hostile.length} filenames; the shipped argv form delivers every one intact`);
  } else {
    ok("(shell-mangling control skipped — not Windows)");
  }

  /* =========================================================================
     CONTROL 5 — THE DEFECT THIS SLICE ACTUALLY SHIPPED, BRIEFLY.

     `spawn("explorer.exe", ["/select," + file])` is the form every example on the
     internet gives, it passes every argv assertion, and on Windows 11 it OPENS THE
     USER'S DOCUMENTS FOLDER when the path contains a space — because Node quotes
     the whole token and explorer.exe does not parse its command line that way.

     Nothing about the argv is wrong; what is wrong is the QUOTING, and that is
     only visible from the shape of the string. So the shape is pinned. */
  section("control 5 — Node's default quoting silently defeats /select");
  {
    const target = "C:\\Films\\Film A\\shots\\S-01\\takes\\take & retake (2).png";
    const naive = ["/select," + target];
    const shippedCommand = Affordance.explorerRevealCommand(target);

    assert.notDeepStrictEqual(shippedCommand.args, naive,
      "the shipped reveal must NOT be the naive form — it opens the wrong folder");
    assert.strictEqual(shippedCommand.options.windowsVerbatimArguments, true,
      "the reveal must hand its command line to CreateProcess unquoted by Node");
    assert.strictEqual(shippedCommand.args[0], `/select,"${target}"`,
      "the quotes belong around the PATH, inside the switch's argument");
    /* The naive form carries no quotes of its own, which is precisely why Node adds
       its own around the whole token and explorer.exe then ignores the switch. */
    assert.ok(!naive[0].includes('"'), "control invalid: the naive form was supposed to be unquoted");
    ok("the shipped reveal is not the naive /select,<path> form, and the difference is pinned");

    /* And the folder command must NOT acquire verbatim mode by copy-paste: a bare
       directory is handled correctly by ordinary quoting, and verbatim mode there
       would be an unearned exception. */
    const folder = Affordance.explorerOpenCommand("C:\\Films\\Film A");
    assert.notStrictEqual(folder.options.windowsVerbatimArguments, true);
    assert.ok(!folder.args[0].includes('"'), "the folder argument carries no quotes of its own");
    ok("and the folder command did not inherit verbatim mode by imitation");
  }

  /* =========================================================================
     CONTROL 6 — A MISSING FILE FALLING BACK TO SOMETHING PLAUSIBLE. */
  section("control 6 — a missing file that opens the parent or the project folder");
  return (async () => {
    const recorded = path.join(A_DIR, "anchors", "CHAR-RHEA.png");
    fs.unlinkSync(recorded);

    /* THE DEFECT: if the file is gone, open its folder — the user probably wants to
       look around. It is helpful, it is one line, and it reads as success. */
    function defectiveFallback(target) {
      return fs.existsSync(target)
        ? { launch: target, selected: true }
        : { launch: path.dirname(target), selected: false };
    }
    const fallen = defectiveFallback(recorded);
    assert.strictEqual(fallen.launch, path.join(A_DIR, "anchors"));
    assert.strictEqual(fallen.selected, false);
    ok("the helpful fallback opens the parent folder for a file that is not there — and looks like success");

    /* THE SHIPPED SEAM REFUSES, AND LAUNCHES NOTHING. */
    const answer = shipped("film-a", `asset:${ASSET_A}`);
    assert.strictEqual(answer.state, "missing");
    assert.strictEqual(answer.path, "");
    assert.strictEqual(answer.recordedPath, recorded, "the recorded location is reported rather than opened");

    const launches = [];
    const result = await Affordance.revealLocalFile({
      projectsRoot: PROJECTS_ROOT, slug: "film-a", key: `asset:${ASSET_A}`, platform: "win32",
      spawner: (file, args) => { launches.push(args); return {}; },
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(launches, [], "nothing at all may be launched for a missing file");
    assert.strictEqual(result.message, "File is no longer available at its recorded local path");
    ok("the shipped seam launches nothing and says exactly what is wrong");

    /* And the shared contract refuses to offer the actions for that state. */
    assert.strictEqual(Shared.localFileActionable("missing"), false);
    assert.strictEqual(Shared.localFileActionable("not-local"), false);
    assert.strictEqual(Shared.localFileActionable("unresolvable"), false);
    ok("and the shared contract offers no reveal button for any state but `available`");

    /* =======================================================================
       CONTROL 7 — LEXICAL CONTAINMENT FOOLED BY A REPARSE POINT.

       `target.startsWith(root + sep)` is the containment check that reads
       correctly and is wrong: a junction under the project root resolves anywhere,
       and every string test passes. */
    section("control 7 — string-prefix containment admits a junction out of the project");
    let junction = "";
    try {
      junction = path.join(A_DIR, "media", "escape");
      fs.symlinkSync(OUTSIDE, junction, "junction");
    } catch (error) {
      junction = "";
      ok(`(junction control skipped — this environment refused to create one: ${error.code})`);
    }
    if (junction) {
      const through = path.join(junction, "secret.png");
      /* THE DEFECT: lexical containment. The path plainly begins with the project
         root, so it passes — and it resolves outside every project. */
      const lexicallyContained = path.resolve(through).startsWith(path.resolve(A_DIR) + path.sep);
      assert.strictEqual(lexicallyContained, true,
        "control invalid: the junctioned path was supposed to pass a string-prefix test");
      assert.strictEqual(
        fs.realpathSync.native(through).toLowerCase(),
        fs.realpathSync.native(path.join(OUTSIDE, "secret.png")).toLowerCase(),
        "control invalid: the junction was supposed to lead outside the project");
      ok("a junction under the project root passes a string-prefix containment check and leads outside it");

      /* THE SHIPPED SEAM REFUSES IT. `media/escape/secret.png` is three segments
         under a flat media directory, so the grammar refuses it first — and the
         real-path check refuses the two-segment form too. */
      assert.strictEqual(shipped("film-a", "path:media/escape/secret.png").state, "unresolvable");

      /* The two-segment form, which the grammar DOES admit, and which only the
         real-path check can refuse. */
      const shallow = path.join(A_DIR, "media", "secret-link.png");
      let shallowMade = false;
      try {
        fs.symlinkSync(path.join(OUTSIDE, "secret.png"), shallow, "file");
        shallowMade = true;
      } catch { /* file symlinks need a privilege junctions do not */ }
      if (shallowMade) {
        assert.strictEqual(Shared.isProjectRelativeMediaPath("media/secret-link.png"), true,
          "control invalid: the shallow form was supposed to pass the grammar");
        const answer = shipped("film-a", "path:media/secret-link.png");
        assert.strictEqual(answer.state, "unresolvable");
        assert.strictEqual(answer.reason, "redirected-outside-project");
        assert.strictEqual(answer.path, "");
        ok("and a link that passes the grammar is still refused, by real-path containment, with the reason named");
      } else {
        ok("(shallow file-symlink control skipped — this environment refused to create one)");
      }
    }

    /* =======================================================================
       CONTROL 8 — THE MEDIA IDENTITY INSIDE AN INLINE onclick.

       The obvious way to wire two buttons, and it was written that way first. An
       HTML parser decodes character references in an attribute value BEFORE the
       handler text reaches the JavaScript engine, so a key escaped the way every
       other attribute in this codebase is escaped — `'` to `&#39;` — arrives at the
       engine as a bare apostrophe that closes the string literal.

       `'` is legal in a Windows filename, so this is not a theoretical input: it is
       the filmmaker who called a take `rhea's close-up.png`. */
    section("control 8 — a media identity interpolated into an inline handler");
    {
      const key = "path:shots/S-01/takes/rhea's close-up.png";
      assert.strictEqual(Shared.parseLocalFileKey(key).domain, "path",
        "control invalid: an apostrophe filename must be a legitimate key");

      /* THE DEFECT: the escaping every other attribute here uses, in a script
         context where it does not hold. */
      const escaped = key.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      const defectiveMarkup = `<button onclick="reveal('${escaped}')">Show in Explorer</button>`;
      /* What the JavaScript engine actually receives, once the parser has decoded
         the attribute value. */
      const handlerText = defectiveMarkup
        .replace(/^.*onclick="/, "").replace(/">.*$/, "")
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      assert.strictEqual(handlerText, "reveal('path:shots/S-01/takes/rhea's close-up.png')");
      assert.throws(() => new Function(handlerText), SyntaxError,
        "control invalid: the decoded handler was supposed to be a syntax error");
      ok("the inline-handler form decodes to a JavaScript syntax error for an apostrophe filename");

      /* THE SHIPPED FORM builds no handler at all. */
      const client = fs.readFileSync(path.join(ROOT, "public", "local-file-actions.js"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/onclick=/.test(client), "the shipped slot builds no inline handler");
      assert.ok(/data-local-file-key=/.test(client), "the key travels as a data attribute");
      assert.ok(/addEventListener\("click"/.test(client), "and is read back by a delegated listener");
      ok("the shipped slot puts the identity in a data attribute and reads it back with one listener");

      /* And the key really does survive an attribute round trip as data, which is
         the property the inline form does not have. */
      const asAttribute = key.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      const decoded = asAttribute.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      assert.strictEqual(decoded, key, "a data attribute round-trips the key exactly");
      ok("and an apostrophe in a data attribute decodes back to an apostrophe, not to a broken string");
    }

    console.log(`\nLOCAL FILE AFFORDANCES V1 NEGATIVE CONTROLS — ${passes} controls held.`);
  })();
}
