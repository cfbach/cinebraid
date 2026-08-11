/* Negative controls for voice runtime ownership.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * below reintroduces exactly one of the defects P4-SEM Wave 0 exists to remove —
 * the character owning a lifecycle of its own again, the character surface
 * ignoring the voice entity, provider configuration moving the character-to-voice
 * relationship, the dialogue binding being dropped during consolidation, a second
 * voice record being written back during the save cycle, and legacy voice
 * information being silently discarded — and asserts that the guarding suite
 * FAILS.
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Node modules are
 *   patched by compiling a modified copy IN MEMORY; the shipped browser scripts
 *   are patched through the render harness's `mutateSource` hook, which mutates
 *   the string it is about to evaluate and never the file. A broad `git checkout`
 *   can therefore never be the thing that undoes a control.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt:
 *   each anchor must exist, must be unique, and must actually change the source,
 *   and the DEFECT ITSELF must be observed through a behavioural probe before the
 *   guarded suite's failure is allowed to count as detection. A control whose
 *   anchor has gone stale reports itself as stale rather than passing quietly.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE, for the same reasons as the positive
 * suite: the render harness stubs fetch, and the one real server runs against a
 * temporary projects root with no credentials and no audio dispatch path.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
/* Normalised to LF before matching. Anchors span lines, and on a Windows checkout
   with core.autocrlf on they would arrive as \r\n — the anchor would not match,
   the control would report itself as stale, and the failure would look like a
   source change rather than a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* Everything a patch may invalidate, including the positive suite itself: it
   captures its module references at require time, so a stale copy would exercise
   the real code and the control would report a false pass. */
const IN_SCOPE = [
  path.join(PUBLIC, "shared-voice.js"),
  path.join(PUBLIC, "shared-entities.js"),
  path.join(__dirname, "voice-runtime-ownership.js"),
];
const inScope = (key) => IN_SCOPE.includes(key);

function applyEdits(label, original, edits) {
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${label}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${label}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${label}; the control would test the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${label} was not modified at all`);
  return code;
}

function evict() {
  for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
}

/* Compile a modified copy of a Node module IN MEMORY, install it in the cache,
   run, restore. Every in-scope module is evicted first so the positive suite
   resolves to the patched copy rather than the one it captured at require time. */
async function patchedModule(relative, edits, run) {
  const file = require.resolve(path.join(ROOT, relative));
  const code = applyEdits(relative, readLF(file), edits);
  const saved = new Map();
  for (const key of Object.keys(require.cache)) if (inScope(key)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const copy = new Module(file, module);
    copy.filename = file;
    copy.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = copy;
    copy._compile(code, file);
    copy.loaded = true;
    return await run();
  } finally {
    evict();
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

/* The same edits, applied to the shipped browser scripts as the render harness
   evaluates them. `applied` is the receipt that the file was actually reached —
   a typo in a filename would otherwise mutate nothing and look like a pass. */
function sourceMutator(editsByFile) {
  const applied = new Set();
  const mutate = (file, original) => {
    const edits = editsByFile[file];
    if (!edits) return original;
    applied.add(file);
    return applyEdits(file, original.replace(/\r\n/g, "\n"), edits);
  };
  mutate.applied = applied;
  mutate.expected = Object.keys(editsByFile);
  return mutate;
}

/* The positive suite, freshly compiled against whatever is currently in the
   cache. Only the suite itself is dropped: evicting the whole in-scope set here
   would delete the module patchedModule() just installed and quietly restore the
   real code. */
function freshSuite() {
  delete require.cache[path.join(__dirname, "voice-runtime-ownership.js")];
  return require("./voice-runtime-ownership");
}

/* Did the guarded phase actually fail? An assertion failure is detection; any
   other error is the control breaking, and is reported as such. */
async function expectRed(label, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message.split("\n")[0];
    throw new Error(`${label}: the guard threw something that is not an assertion failure, so this is not a valid receipt:\n${error.stack || error.message}`);
  }
  throw new Error(`${label}: the guarded suite PASSED with the defect reintroduced. The regression test does not detect it.`);
}

const results = [];
async function control({ id, defect, mutatesModule, mutatesBrowser, probe, guard }) {
  const mutate = mutatesBrowser ? sourceMutator(mutatesBrowser) : null;
  const body = async () => {
    const suite = freshSuite();
    /* The probe must OBSERVE the reintroduced defect. Without this receipt an
       anchor that silently stopped matching, or a patch that changed nothing that
       runs, would throw somewhere unrelated and be counted as the guard working. */
    await probe(suite, mutate);
    const detected = await expectRed(id, () => guard(suite, mutate));
    /* Checked AFTER the guard: a control whose probe needs no render only reaches
       the browser scripts once the guarded phase renders. Still a hard assertion —
       a filename that never matched means the browser-side half of the defect
       never ran, and the receipt would be for the wrong thing. */
    if (mutate)
      for (const file of mutate.expected)
        assert(mutate.applied.has(file), `${id}: ${file} was never evaluated, so the browser-side defect never ran`);
    results.push({ id, defect, detected });
  };
  if (mutatesModule) await patchedModule(mutatesModule.file, mutatesModule.edits, body);
  else await body();
}

async function main() {
  /* ---------------------------------------------------------------- NC-A
     The character owns an independent completion answer again: whatever the old
     character-side status says wins over the voice entity. */
  await control({
    id: "NC-A",
    defect: "character-side status outranks the voice entity",
    mutatesModule: {
      file: "public/shared-voice.js",
      edits: [[
        `  let outcome;
  if (!voiceId) outcome = VOICE_OUTCOME.UNLINKED;`,
        `  let outcome;
  if (legacy.present) outcome = legacy.outcome;
  else if (!voiceId) outcome = VOICE_OUTCOME.UNLINKED;`,
      ]],
    },
    probe: async (suite) => {
      const Voice = require("../public/shared-voice");
      const project = suite.voiceFixture();
      const conflict = project.characters.find((row) => row.id === "CHAR-CONFLICT");
      const resolved = Voice.resolveCharacterVoice(project, conflict);
      assert.strictEqual(resolved.outcome, Voice.VOICE_OUTCOME.READY,
        "NC-A probe: the character was expected to out-rank its unfinished voice");
      assert.strictEqual(Voice.voiceEntityOutcome(Voice.voiceById(project, "VOICE-CONFLICT")), Voice.VOICE_OUTCOME.NOT_STARTED,
        "NC-A probe: the voice entity really is unfinished, so the two now disagree");
    },
    guard: (suite) => suite.resolverCases(),
  });

  /* ---------------------------------------------------------------- NC-B
     The character surface ignores the voice entity and renders only the old
     character-side copy. */
  await control({
    id: "NC-B",
    defect: "character surface reads the old copy instead of the voice entity",
    mutatesBrowser: {
      "app.js": [[
        `    word = entityWorkflowState(voice).label;
    detail = resolved.hasApprovedRecording
      ? \`Approved recording: \${esc(voice.approvedFile)}\`
      : "No approved recording yet.";`,
        `    word = entityWorkflowState({ status: legacy.status }).label;
    detail = "No approved recording yet.";`,
      ]],
    },
    probe: async (suite, mutate) => {
      const { render } = require("./render-harness");
      const project = suite.voiceFixture();
      const page = await suite.renderCharacter(project, "CHAR-RHEA", { mutateSource: mutate });
      const entity = await render("#/sound/VOICE-RHEA-CLEAN", project, { mutateSource: mutate });
      assert.notStrictEqual(suite.renderedVoiceWord(page.html), suite.renderedEntityWord(entity.html),
        "NC-B probe: the two surfaces were expected to disagree");
    },
    guard: (suite, mutate) => suite.surfaceCases({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-C
     Provider configuration rewrites which voice belongs to a character. */
  await control({
    id: "NC-C",
    defect: "provider settings rewrite the character-to-voice relationship",
    mutatesBrowser: {
      "app.js": [[
        `  const current = String(c.voiceId || "");`,
        `  if (typeof CONFIG !== "undefined" && CONFIG?.generation?.provider === "elevenlabs") c.voiceId = rows[rows.length - 1]?.id || c.voiceId;
  const current = String(c.voiceId || "");`,
      ]],
    },
    probe: async (suite, mutate) => {
      const project = suite.voiceFixture();
      assert.strictEqual(project.characters.find((row) => row.id === "CHAR-RHEA").voiceId, "VOICE-RHEA-CLEAN",
        "NC-C probe: the fixture starts linked to its own voice");
      const view = await suite.renderCharacter(project, "CHAR-RHEA", {
        mutateSource: mutate,
        fetch: (url, _options, response) => (url === "/api/config" ? response({ generation: { provider: "elevenlabs" } }) : null),
      });
      assert.strictEqual(suite.appProject(view).characters.find((row) => row.id === "CHAR-RHEA").voiceId, "VOICE-NARRATOR",
        "NC-C probe: choosing a provider was expected to move the character's voice");
    },
    guard: (suite, mutate) => suite.surfaceCases({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-D
     Consolidation drops the per-shot dialogue binding. */
  await control({
    id: "NC-D",
    defect: "the shot's bound voice stops being a resolved dependency",
    mutatesModule: {
      file: "public/shared-entities.js",
      edits: [[
        `  add("audio", audio.voiceEntityId, "audio.voiceEntityId");`,
        `  /* NC-D: the dialogue binding is no longer resolved. */`,
      ]],
    },
    mutatesBrowser: {
      "shared-entities.js": [[
        `  add("audio", audio.voiceEntityId, "audio.voiceEntityId");`,
        `  /* NC-D: the dialogue binding is no longer resolved. */`,
      ]],
    },
    probe: async (suite) => {
      const shots = require("../public/shared-entities");
      const project = suite.voiceFixture();
      const shot = project.shots.find((row) => row.id === "L1-09");
      const bound = shots.shotDependencyRecords(project, shot)
        .filter((row) => row.type === "audio" && row.sources.includes("audio.voiceEntityId"));
      assert.strictEqual(bound.length, 0, "NC-D probe: the dialogue binding was expected to be dropped");
      assert.strictEqual(shot.audio.voiceEntityId, "VOICE-RHEA-CLEAN",
        "NC-D probe: the stored binding is still there, so only its resolution was lost");
    },
    guard: (suite, mutate) => suite.surfaceCases({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-E
     Viewing a character writes a second, independent voice record back onto it,
     which the next save then persists. */
  await control({
    id: "NC-E",
    defect: "a second voice lifecycle is written back during the save cycle",
    mutatesBrowser: {
      "app.js": [[
        `function voicePanel(c) {
  return \``,
        `function voicePanel(c) {
  const synced = resolveCharacterVoice(P, c);
  (c.audio = c.audio || {}).status = synced.outcome === VOICE_OUTCOME.READY ? "APPROVED" : "NOT STARTED";
  return \``,
      ]],
    },
    probe: async (suite, mutate) => {
      const project = suite.voiceFixture();
      assert.strictEqual(project.characters.find((row) => row.id === "CHAR-RHEA").audio, undefined,
        "NC-E probe: the character starts with no lifecycle of its own");
      const view = await suite.renderCharacter(project, "CHAR-RHEA", { mutateSource: mutate });
      assert.strictEqual(suite.appProject(view).characters.find((row) => row.id === "CHAR-RHEA").audio?.status, "APPROVED",
        "NC-E probe: merely viewing the character was expected to mint a second record");
    },
    guard: (suite, mutate) => suite.surfaceCases({ mutateSource: mutate }),
  });

  /* NC-E, second half: the same defect must also be caught after a REAL save and
     reload, because that is where a manufactured record becomes permanent. */
  await control({
    id: "NC-E2",
    defect: "the manufactured record survives a real save and reload",
    mutatesBrowser: {
      "app.js": [[
        `function voicePanel(c) {
  return \``,
        `function voicePanel(c) {
  const synced = resolveCharacterVoice(P, c);
  (c.audio = c.audio || {}).status = synced.outcome === VOICE_OUTCOME.READY ? "APPROVED" : "NOT STARTED";
  return \``,
      ]],
    },
    probe: async (suite, mutate) => {
      const view = await suite.renderCharacter(suite.voiceFixture(), "CHAR-RHEA", { mutateSource: mutate });
      assert.strictEqual(suite.appProject(view).characters.find((row) => row.id === "CHAR-RHEA").audio?.status, "APPROVED",
        "NC-E2 probe: the second record is being minted");
    },
    guard: (suite, mutate) => suite.saveReloadCase({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-F
     Legacy voice information on a project that has only the old representation is
     silently discarded instead of preserved and disclosed. */
  await control({
    id: "NC-F",
    defect: "legacy character-side voice information is dropped",
    mutatesModule: {
      file: "public/shared-voice.js",
      edits: [[
        `  if (!status) return { present: false, status: "", outcome: "" };
  return { present: true, status, outcome: voiceEntityOutcome({ status }) };`,
        `  return { present: false, status: String(status && ""), outcome: "" };`,
      ]],
    },
    probe: async (suite) => {
      const Voice = require("../public/shared-voice");
      const project = suite.voiceFixture();
      const legacy = project.characters.find((row) => row.id === "CHAR-LEGACY");
      assert.strictEqual(legacy.audio.status, "APPROVED", "NC-F probe: the stored value is still on the record");
      assert.strictEqual(Voice.resolveCharacterVoice(project, legacy).legacy.present, false,
        "NC-F probe: the stored value was expected to become invisible to every reader");
    },
    guard: (suite) => suite.resolverCases(),
  });

  /* NC-F, second half: the same drop applied to the shipped browser copy, so the
     character page stops disclosing a legacy-only project's voice information. */
  await control({
    id: "NC-F2",
    defect: "the character page stops disclosing legacy-only voice information",
    mutatesBrowser: {
      "shared-voice.js": [[
        `  if (!status) return { present: false, status: "", outcome: "" };
  return { present: true, status, outcome: voiceEntityOutcome({ status }) };`,
        `  return { present: false, status: String(status && ""), outcome: "" };`,
      ]],
    },
    probe: async (suite, mutate) => {
      const page = await suite.renderCharacter(suite.voiceFixture(), "CHAR-LEGACY", { mutateSource: mutate });
      assert(!page.html.includes("voice-authority-conflict"),
        "NC-F2 probe: the legacy disclosure was expected to disappear from the page");
    },
    guard: (suite, mutate) => suite.surfaceCases({ mutateSource: mutate }),
  });

  const width = Math.max(...results.map((row) => row.id.length));
  console.log("Voice runtime ownership negative controls — every deliberate defect was reached and detected:\n");
  for (const row of results)
    console.log(`  ${row.id.padEnd(width)}  RED   ${row.defect}\n  ${" ".repeat(width)}        caught by: ${row.detected}`);
  console.log(`\n${results.length} controls, ${results.length} detected, 0 undetected. Provider calls made: 0.`);
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
module.exports = { main };
