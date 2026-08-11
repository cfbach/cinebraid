/* P4-SEM Wave 0 — voice runtime ownership.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: a character and the voice entity
 * it points at cannot give two different answers to "is this voice ready?", because
 * only the voice entity is allowed to hold the answer.
 *
 * Before this batch the runtime carried voice in four places, and two of them were
 * lifecycles: `P.audio[].status` on the voice entity, and `character.audio.status`
 * written by a chip row on the character page. Nothing reconciled them — nothing
 * COULD, because `character.voiceId`, the link that would let anything compare the
 * two, was read by migration rule M017 and written by no part of the app. So a
 * character could sit at APPROVED while the voice it described had never been
 * started, and both screens were telling the truth as they knew it.
 *
 * The tests below drive the real runtime path: the shared resolver directly, the
 * two real rendered surfaces through the render harness, and a real save/reload
 * through a real server process.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing in this file dispatches a
 * generation of any kind. The render harness stubs `fetch` and the server section
 * spawns server.js against a temporary projects root with no provider credentials,
 * so there is no configured audio provider and no audio dispatch path to reach —
 * CineBraid has none (data/model-definitions.json records voice models as
 * catalogued only).
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const Voice = require("../public/shared-voice");
const { VOICE_OUTCOME } = Voice;
const { render, buildFixture } = require("./render-harness");

const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* ------------------------------------------------------------------ fixture */
/* One project carrying every voice shape that exists in the wild at once, so no
   case is tested against a project shaped only for it.

     CHAR-RHEA      linked to a ready voice                        (case 1)
     CHAR-VESS      linked to an unfinished voice                  (case 2)
     CHAR-LEGACY    ONLY the old character-side block, no link     (case 5)
     CHAR-CONFLICT  linked, and the old block disagrees with it    (case 7)
     CHAR-DANGLING  links to a voice this project does not contain
     VOICE-NARRATOR a voice nobody links, which is legal           (case 6) */
function voiceFixture() {
  const project = buildFixture();
  project.characters = [
    ...project.characters,
    { id: "CHAR-RHEA", name: "Rhea", block: "Field engineer.", voiceId: "VOICE-RHEA-CLEAN", continuityStates: [], coverageSlots: [] },
    { id: "CHAR-VESS", name: "Vess", block: "Dock supervisor.", voiceId: "VOICE-VESS-ROUGH", continuityStates: [], coverageSlots: [] },
    {
      id: "CHAR-LEGACY", name: "Legacy", block: "Authored before voice entities existed.",
      audio: { status: "APPROVED", voiceDesignPrompt: "Low, unhurried, mid-register.", voiceTool: "ElevenLabs Voice Design" },
      continuityStates: [], coverageSlots: [],
    },
    {
      id: "CHAR-CONFLICT", name: "Conflict", block: "Carries both representations, disagreeing.",
      voiceId: "VOICE-CONFLICT", audio: { status: "APPROVED" },
      continuityStates: [], coverageSlots: [],
    },
    { id: "CHAR-DANGLING", name: "Dangling", block: "Points at nothing.", voiceId: "VOICE-GONE", continuityStates: [], coverageSlots: [] },
  ];
  project.audio = [
    { id: "VOICE-RHEA-CLEAN", name: "Rhea Clean", notes: "Low, unhurried.", language: "en-GB", status: "APPROVED", workflowStatus: "APPROVED", approvedFile: "VOICE-RHEA-CLEAN.wav", cleanMaster: true },
    { id: "VOICE-VESS-ROUGH", name: "Vess Rough", notes: "Scratch take.", status: "IN PROGRESS", workflowStatus: "IN PROGRESS", approvedFile: "" },
    { id: "VOICE-CONFLICT", name: "Conflict Voice", notes: "Never started.", status: "NOT STARTED", workflowStatus: "DRAFT", approvedFile: "" },
    { id: "VOICE-NARRATOR", name: "Narrator", notes: "Linked by nobody, and that is legal.", status: "NOT STARTED", workflowStatus: "DRAFT", approvedFile: "" },
  ];
  /* The dialogue binding, which must survive consolidation untouched. */
  project.shots = [
    ...project.shots,
    {
      id: "L1-09", scene: "SC-01", title: "Rhea speaks", desc: "Rhea reports the hull reading.",
      dur: 6, workflowStatus: "DRAFT", characters: ["CHAR-RHEA"], codes: [], keyframes: [], clips: [], candidateFiles: [],
      audio: { line: "Hull reading is nominal.", speakerId: "CHAR-RHEA", voiceEntityId: "VOICE-RHEA-CLEAN", note: "", vo: "", sfx: "" },
    },
  ];
  return project;
}
const characterById = (project, id) => project.characters.find((row) => row.id === id);

/* The document the APP is holding, not the fixture we handed it.

   The render harness serves the project through a `json()` that structuredClones
   it, so the page edits a copy. Asserting "rendering did not mutate the project"
   against the fixture object would therefore assert nothing at all — it would
   pass even if the page rewrote every field it touched. Every no-mutation claim
   below reads the page's own `P` instead, which is also the exact document the
   real browser would PUT back on save. */
const appProject = (view) => JSON.parse(vm.runInContext("JSON.stringify(P)", view.context));

/* The character page opens on its "reference" task, and the voice panel lives
   under "details" — so a plain render of the route shows no voice at all. Which
   task is showing is remembered in localStorage, outside project data, under the
   render harness's project key. Selecting it here is what makes these assertions
   about the voice panel rather than about a default tab. */
function renderCharacter(project, id, options = {}) {
  return render(`#/character/${id}`, project, {
    ...options,
    storage: { [`cinebraid-focused:fixture:entity-task:characters:${id}`]: "details", ...(options.storage || {}) },
  });
}

/* The word the character page prints in its VOICE STATE slot. */
function renderedVoiceWord(html) {
  const match = /<span class="voice-authority-label">VOICE STATE<\/span><b>([^<]*)<\/b>/.exec(html);
  return match ? match[1] : null;
}
/* The word the audio entity's own page prints in its submission bar. */
function renderedEntityWord(html) {
  const match = /<div class="submission-bar"><div><b>([^<]*)<\/b>/.exec(html);
  return match ? match[1] : null;
}

/* ============================================================ 1. the resolver */
function resolverCases() {
  const project = voiceFixture();
  const resolve = (id) => Voice.resolveCharacterVoice(project, characterById(project, id));

  /* Case 1 — linked to a ready voice. */
  const rhea = resolve("CHAR-RHEA");
  assert.strictEqual(rhea.voiceId, "VOICE-RHEA-CLEAN");
  assert.strictEqual(rhea.voice.id, "VOICE-RHEA-CLEAN");
  assert.strictEqual(rhea.outcome, VOICE_OUTCOME.READY);
  assert.strictEqual(rhea.hasApprovedRecording, true);
  assert.strictEqual(rhea.conflict, null);
  assert.strictEqual(rhea.outcome, Voice.voiceEntityOutcome(project.audio[0]),
    "the character-facing outcome must BE the voice entity's outcome, not a parallel computation");

  /* Case 2 — linked to an unfinished voice. The character must not be able to
     report a further-along state than the voice it points at. */
  const vess = resolve("CHAR-VESS");
  assert.strictEqual(vess.outcome, VOICE_OUTCOME.IN_PROGRESS);
  assert.strictEqual(vess.hasApprovedRecording, false);
  assert.strictEqual(vess.outcome, Voice.voiceEntityOutcome(project.audio[1]));

  /* Case 5 — ONLY the legacy character-side representation. Preserved, reported,
     and explicitly not promoted into an answer. */
  const legacy = resolve("CHAR-LEGACY");
  assert.strictEqual(legacy.outcome, VOICE_OUTCOME.UNLINKED, "a character-side status is not a voice");
  assert.strictEqual(legacy.legacy.present, true, "the legacy value must be reported, never dropped");
  assert.strictEqual(legacy.legacy.status, "APPROVED", "the legacy value must be reported verbatim");
  assert.strictEqual(legacy.conflict, null, "with no voice entity there is no second opinion to conflict with");
  assert.strictEqual(characterById(project, "CHAR-LEGACY").audio.status, "APPROVED",
    "resolving must not mutate the character record");
  assert.strictEqual(
    Voice.characterVoiceProviderConfig(characterById(project, "CHAR-LEGACY")).voiceDesignPrompt,
    "Low, unhurried, mid-register.",
    "the design prompt is provider configuration and must survive untouched",
  );

  /* Case 6 — a voice entity nobody links. It exists, it is addressable, and no
     second lifecycle is manufactured for it. */
  const narrator = Voice.voiceById(project, "VOICE-NARRATOR");
  assert(narrator, "an unlinked voice is an ordinary entity");
  assert.strictEqual(Voice.voiceEntityOutcome(narrator), VOICE_OUTCOME.NOT_STARTED);
  const linked = new Set(project.characters.map((row) => row.voiceId).filter(Boolean));
  assert.strictEqual(linked.has("VOICE-NARRATOR"), false, "the fixture's narrator really is unlinked");

  /* Case 7 — the two old representations genuinely disagree. */
  const conflict = resolve("CHAR-CONFLICT");
  assert.strictEqual(conflict.outcome, VOICE_OUTCOME.NOT_STARTED, "the voice entity is the answer");
  assert(conflict.conflict, "a disagreement must be surfaced, not hidden");
  assert.strictEqual(conflict.conflict.characterStatus, "APPROVED");
  assert.strictEqual(conflict.conflict.characterOutcome, VOICE_OUTCOME.READY);
  assert.strictEqual(conflict.conflict.voiceOutcome, VOICE_OUTCOME.NOT_STARTED);
  assert.strictEqual(characterById(project, "CHAR-CONFLICT").audio.status, "APPROVED",
    "the losing value is disclosed, not deleted — converting it is a migration's job");

  /* A dangling link stays dangling. It is not quietly downgraded to "no voice",
     for the same reason M017 keeps it as a disputed statement. */
  const dangling = resolve("CHAR-DANGLING");
  assert.strictEqual(dangling.outcome, VOICE_OUTCOME.UNRESOLVED);
  assert.strictEqual(dangling.voiceId, "VOICE-GONE", "the reference is retained as written");
  assert.strictEqual(dangling.voice, null);

  /* Case 3, structurally. The resolver's whole input is (project, character);
     there is no configuration argument to pass, so no provider setting can be
     read. Proven by behaviour rather than by reading the source: mutate every
     provider-shaped global in scope and the answer is byte-identical. */
  const before = JSON.stringify(resolve("CHAR-RHEA"));
  const savedConfig = global.CONFIG;
  try {
    global.CONFIG = { generation: { provider: "elevenlabs", audioModel: "eleven_v3", fal: { videoModel: "minimax-h3" } } };
    assert.strictEqual(JSON.stringify(resolve("CHAR-RHEA")), before,
      "the character-to-voice answer must not move when provider configuration moves");
  } finally {
    if (savedConfig === undefined) delete global.CONFIG; else global.CONFIG = savedConfig;
  }

  /* Case 4, at the data layer. The dialogue binding is a separate fact from the
     character's identity, and is reported separately so the two cannot merge. */
  const bindings = Voice.characterVoiceBindings(project, "CHAR-RHEA");
  assert.strictEqual(bindings.length, 1);
  assert.strictEqual(bindings[0].voiceId, "VOICE-RHEA-CLEAN");
  assert.strictEqual(bindings[0].shotId, "L1-09");

  /* The contract emits tokens; the browser renders words. Same line
     shared-continuity.js holds. */
  const displayWords = ["Not started", "In progress", "Needs review", "Approved", "Changes requested", "Complete"];
  for (const [name, token] of Object.entries(VOICE_OUTCOME)) {
    assert(/^[a-z][a-z-]*$/.test(token), `${name} must be a token, not display text: ${token}`);
    assert(!displayWords.includes(token), `${name} must not carry UI wording`);
  }
  return 24;
}

/* ================================================= 2. the two rendered surfaces */
async function surfaceCases(options = {}) {
  const project = voiceFixture();
  let checks = 0;
  /* Every render in this phase goes through these two, so a negative control can
     break exactly one line of one shipped script IN MEMORY and have the defect
     reach every surface the phase looks at. */
  const mutateSource = options.mutateSource || null;
  const rc = (id, extra = {}) => renderCharacter(project, id, { ...extra, mutateSource });
  const rr = (hash, extra = {}) => render(hash, project, { ...extra, mutateSource });

  /* The cross-check that makes "cannot contradict" structural rather than lucky:
     the shared resolver's workflow key must agree with app.js's entityWorkflowState
     for EVERY storage combination, so the restatement in shared-voice.js can never
     drift into a second opinion. */
  const probe = await rr("#/library");
  const { entityWorkflowState } = probe.context;
  assert.strictEqual(typeof entityWorkflowState, "function", "the entity workflow derivation must be reachable");
  for (const status of ["", "NOT STARTED", "IN PROGRESS", "CANDIDATE", "REVIEW", "APPROVED", "nonsense"])
    for (const workflowStatus of ["", "DRAFT", "IN PROGRESS", "READY FOR REVIEW", "CHANGES REQUESTED", "APPROVED", "nonsense"])
      for (const reviewStatus of ["", "CHANGES REQUESTED"]) {
        const record = { id: "V", status, workflowStatus, reviewStatus };
        assert.strictEqual(Voice.voiceWorkflowKey(record), entityWorkflowState(record).key,
          `shared-voice disagreed with the entity page for ${JSON.stringify(record)}`);
        checks += 1;
      }

  /* Case 1 — character surface and voice entity surface, same word. */
  const rheaPage = await rc("CHAR-RHEA");
  const rheaVoicePage = await rr("#/sound/VOICE-RHEA-CLEAN");
  const rheaWord = renderedVoiceWord(rheaPage.html);
  assert(rheaWord, "the character page must print a derived voice state");
  assert.strictEqual(rheaWord, renderedEntityWord(rheaVoicePage.html),
    "the character page and the voice entity page must print the same word");
  assert(rheaPage.html.includes("VOICE-RHEA-CLEAN.wav"), "the approved recording must be surfaced on the character");
  checks += 3;

  /* Case 2 — the character must not out-run its voice. */
  const vessPage = await rc("CHAR-VESS");
  const vessVoicePage = await rr("#/sound/VOICE-VESS-ROUGH");
  const vessWord = renderedVoiceWord(vessPage.html);
  assert.strictEqual(vessWord, renderedEntityWord(vessVoicePage.html));
  assert.notStrictEqual(vessWord, rheaWord, "an unfinished voice must not read like a ready one");
  checks += 2;

  /* The independently editable second lifecycle is gone from the surface. */
  for (const html of [rheaPage.html, vessPage.html]) {
    assert(!/setValNested\((?:'|")characters(?:'|"),[^)]*(?:'|")audio(?:'|"),\s*(?:'|")status(?:'|")/.test(html),
      "the character page must not be able to write a voice lifecycle of its own");
    checks += 1;
  }

  /* Case 7 — the disagreement is disclosed on the surface, and the voice entity
     still wins the state slot. */
  const conflictPage = await rc("CHAR-CONFLICT");
  const conflictVoicePage = await rr("#/sound/VOICE-CONFLICT");
  assert(conflictPage.html.includes("voice-authority-conflict"), "a conflict must be visible, not silent");
  assert.strictEqual(renderedVoiceWord(conflictPage.html), renderedEntityWord(conflictVoicePage.html),
    "even in conflict the two surfaces must print the same word");
  assert(conflictPage.html.includes("APPROVED"), "the older stored value must remain visible to the user");
  checks += 3;

  /* Case 5 — legacy-only. No crash, no invented voice, and the old value shown. */
  const legacyPage = await rc("CHAR-LEGACY");
  assert(legacyPage.html.includes("No voice linked"), "a character-side status is not a voice");
  assert(legacyPage.html.includes("voice-authority-conflict"), "an orphaned legacy status must be disclosed");
  assert(legacyPage.html.includes("Low, unhurried, mid-register."), "the design prompt must survive on the page");
  checks += 3;

  /* Case 6 — the unlinked narrator renders as an ordinary entity. */
  const narratorPage = await rr("#/sound/VOICE-NARRATOR");
  assert(narratorPage.html.includes("Narrator"), "an unlinked voice must still have a page");
  assert(!narratorPage.html.includes("no approved image yet"),
    "an audio entity has no image; the missing material is a recording");
  assert(narratorPage.html.includes("no approved recording yet"), "and it must say so in audio terms");
  checks += 3;

  /* The link is authorable. Without a writer the derived view would be permanently
     empty and this whole ownership model would be unreachable from the app. */
  assert(/setVal\('characters','CHAR-RHEA','voiceId'/.test(rheaPage.html),
    "the character page must be able to author the link to the voice entity");
  assert(rheaPage.html.includes("VOICE-NARRATOR"), "every voice in the project must be linkable");
  checks += 2;

  /* Case 3 — a provider/model configuration change must not move the relationship. */
  const providerConfig = async (generation) => {
    return rc("CHAR-RHEA", {
      fetch: (url, _options, response) => (url === "/api/config" ? response({ generation }) : null),
    });
  };
  const configA = await providerConfig({ provider: "fal", fal: { videoModel: "minimax-h3", estimatedCostPerImage: 0.01 } });
  const configB = await providerConfig({ provider: "elevenlabs", audioModel: "eleven_v3", fal: { videoModel: "seedance-2", estimatedCostPerImage: 9.99 } });
  assert.strictEqual(renderedVoiceWord(configA.html), renderedVoiceWord(configB.html),
    "the voice state must not move with provider configuration");
  assert.strictEqual(
    /<option value="([^"]*)" selected>/.exec(configA.html.slice(configA.html.indexOf("voiceId")))?.[1],
    /<option value="([^"]*)" selected>/.exec(configB.html.slice(configB.html.indexOf("voiceId")))?.[1],
    "the selected voice must not move with provider configuration",
  );
  assert.strictEqual(characterById(appProject(configB), "CHAR-RHEA").voiceId, "VOICE-RHEA-CLEAN",
    "rendering under a different provider must not rewrite the stored link");
  checks += 3;

  /* A dangling link stays visible as a dangling link on the surface too. */
  const danglingPage = await rc("CHAR-DANGLING");
  assert(danglingPage.html.includes("Voice reference not found"), "a dangling link must say so");
  assert(danglingPage.html.includes("VOICE-GONE"), "and must show what it points at");
  checks += 2;

  /* A page load is not a migration. Opening any of these characters must not add
     a lifecycle record to the document the page is holding. */
  for (const [id, page] of [["CHAR-RHEA", rheaPage], ["CHAR-VESS", vessPage], ["CHAR-DANGLING", danglingPage]]) {
    assert.strictEqual(characterById(appProject(page), id).audio?.status, undefined,
      `${id} gained a character-side voice lifecycle merely by being rendered`);
    checks += 1;
  }
  assert.strictEqual(characterById(appProject(conflictPage), "CHAR-CONFLICT").audio.status, "APPROVED",
    "rendering must neither rewrite nor erase a stored legacy value");
  checks += 1;

  /* Case 4 — the dialogue binding still points where it pointed.

     DISCLOSURE: the shot's voice selector lives in the guided motion panel, which
     is locked until required frames are approved (creation-studio.js:2515), so
     this is not asserted against that control's markup — fabricating approved
     motion state to reach it is the later dialogue-stage batch's business, not
     this one's. It is asserted instead against the resolver the shot Inputs stage
     and project readiness actually run, which is the path consolidation could
     have broken, plus the stored value after a real render. */
  const shots = require("../public/shared-entities");
  const shot = project.shots.find((row) => row.id === "L1-09");
  const bound = shots.shotDependencyRecords(project, shot)
    .filter((row) => row.type === "audio" && row.sources.includes("audio.voiceEntityId"));
  assert.deepStrictEqual(bound.map((row) => row.id), ["VOICE-RHEA-CLEAN"],
    "the shot must still resolve to the voice it was bound to");
  assert.strictEqual(bound[0].resolved, true, "the bound voice must resolve to a real entity");
  assert.deepStrictEqual(shots.unresolvedShotDependencies(project, shot).map((row) => row.id), [],
    "the bound voice must not become an unresolved dependency");
  const shotPage = await rr("#/shot/L1-09");
  assert(shotPage.html, "the bound dialogue shot must still render");
  const heldShot = appProject(shotPage).shots.find((row) => row.id === "L1-09");
  assert.strictEqual(heldShot.audio.voiceEntityId, "VOICE-RHEA-CLEAN", "rendering must not disturb the dialogue binding");
  assert.strictEqual(heldShot.audio.speakerId, "CHAR-RHEA", "rendering must not disturb the speaker");
  checks += 5;

  return checks;
}

/* ================================================ 3. save / reload, real server */
function freePort() {
  const net = require("net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
function waitFor(check, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = async () => {
      try { if (await check()) return resolve(true); } catch {}
      if (Date.now() > deadline) return reject(new Error("timed out waiting for the server"));
      setTimeout(tick, 120);
    };
    tick();
  });
}

async function saveReloadCase(options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-voice-"));
  const projectsRoot = path.join(temp, "projects");
  const projectDir = path.join(projectsRoot, "voice-fixture");
  fs.mkdirSync(projectDir, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"])
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });

  const project = voiceFixture();
  const file = path.join(projectDir, "project.json");
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  const onDiskBefore = fs.readFileSync(file, "utf8");

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CINEBRAID_CONFIG_PATH: path.join(temp, "config.json"),
      CINEBRAID_PROJECTS_ROOT: projectsRoot,
      CINEBRAID_AI_TEXT_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitFor(async () => {
      const response = await fetch(`${base}/api/me`).catch(() => null);
      return !!response && response.ok;
    });

    /* Opening a project must not rewrite it. This is the "no automatic project
       mutation" rule: a page load is not a migration. */
    const read = await fetch(`${base}/api/project`);
    assert.strictEqual(read.ok, true, `the project must open: ${read.status}\n${output}`);
    const revision = read.headers.get("etag") || read.headers.get("x-cinebraid-project-revision") || "*";
    const loaded = await read.json();
    assert.strictEqual(fs.readFileSync(file, "utf8"), onDiskBefore,
      "reading a project must not rewrite its voice data on disk");
    assert.strictEqual(loaded.characters.find((row) => row.id === "CHAR-LEGACY").audio.status, "APPROVED",
      "the legacy character-side value must survive a read");
    assert.strictEqual(loaded.characters.find((row) => row.id === "CHAR-RHEA").voiceId, "VOICE-RHEA-CLEAN",
      "the link must survive a read");

    /* Case 8 — save and reload, through what a user actually does: open the
       project, LOOK AT THE CHARACTER, save. Saving the untouched read would prove
       only that the server round-trips JSON; rendering first is what would catch
       a surface that writes a second record back into the document it displays. */
    const afterRhea = appProject(await renderCharacter(loaded, "CHAR-RHEA", { mutateSource: options.mutateSource }));
    const afterConflict = appProject(await renderCharacter(afterRhea, "CHAR-CONFLICT", { mutateSource: options.mutateSource }));
    /* What the browser would actually PUT: its own in-memory document, carried
       forward across both visits, not the untouched read. */
    const save = await fetch(`${base}/api/projects/voice-fixture/project`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": revision },
      body: JSON.stringify(afterConflict),
    });
    assert.strictEqual(save.ok, true, `saving must succeed: ${save.status} ${await save.text().catch(() => "")}`);

    const reread = await fetch(`${base}/api/project`);
    const reloaded = await reread.json();
    const rhea = reloaded.characters.find((row) => row.id === "CHAR-RHEA");
    assert.strictEqual(rhea.voiceId, "VOICE-RHEA-CLEAN", "the link must survive save/reload");
    assert.strictEqual(
      Voice.resolveCharacterVoice(reloaded, rhea).outcome, VOICE_OUTCOME.READY,
      "the derived state must survive save/reload",
    );
    assert.strictEqual(
      reloaded.audio.filter((row) => row.id === "VOICE-RHEA-CLEAN").length, 1,
      "save/reload must not duplicate the voice record",
    );
    assert.strictEqual(rhea.audio?.status, undefined,
      "save/reload must not manufacture a second lifecycle on the character");
    assert.strictEqual(
      reloaded.shots.find((row) => row.id === "L1-09").audio.voiceEntityId, "VOICE-RHEA-CLEAN",
      "the dialogue binding must survive save/reload",
    );
    assert.strictEqual(reloaded.characters.find((row) => row.id === "CHAR-LEGACY").audio.status, "APPROVED",
      "save/reload must not discard legacy voice information");
    assert.strictEqual(reloaded.characters.find((row) => row.id === "CHAR-DANGLING").voiceId, "VOICE-GONE",
      "save/reload must not silently repair a dangling reference");

    /* A genuine conflict must still be a conflict afterwards. A round trip is not
       permitted to quietly settle an ambiguity that only a migration or a human
       may settle. */
    const conflictAfter = Voice.resolveCharacterVoice(reloaded, reloaded.characters.find((row) => row.id === "CHAR-CONFLICT"));
    assert.strictEqual(conflictAfter.outcome, VOICE_OUTCOME.NOT_STARTED, "the voice entity is still the answer");
    assert(conflictAfter.conflict, "save/reload must not silently settle a conflict");
    assert.strictEqual(conflictAfter.conflict.characterStatus, "APPROVED",
      "the losing value must still be there to be disclosed");
    return 14;
  } finally {
    child.kill();
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  }
}

/* ============================================================ 4. wiring checks */
function wiringCases() {
  const version = require("../package.json").version;
  const index = readLF(path.join(ROOT, "public", "index.html"));
  assert(index.includes(`shared-voice.js?v=${version}`), "the shared voice resolver must load and be cache busted");
  assert(index.indexOf(`shared-voice.js?v=${version}`) < index.indexOf(`app.js?v=${version}`),
    "the shared voice resolver must load before the app");
  const harness = readLF(path.join(__dirname, "render-harness.js"));
  assert(harness.includes('"shared-voice.js"'), "the render harness must evaluate the shared voice resolver");
  const source = readLF(path.join(ROOT, "public", "shared-voice.js"));
  for (const forbidden of ["require(", "fetch(", "localStorage", "Date.now", "process."])
    assert(!source.includes(forbidden), `the voice contract must stay pure: found ${forbidden}`);
  const app = readLF(path.join(ROOT, "public", "app.js"));
  assert(!/'audio','status'/.test(app), "app.js must no longer write a character-side voice lifecycle");
  return 5;
}

async function main() {
  const a = resolverCases();
  const b = await surfaceCases();
  const c = await saveReloadCase();
  const d = wiringCases();
  console.log(`Voice runtime ownership passed: ${a} resolver assertions, ${b} rendered-surface assertions (including ${7 * 7 * 2} workflow-agreement combinations), ${c} save/reload assertions against a real server, ${d} wiring assertions. Provider calls made: 0.`);
}

module.exports = { voiceFixture, renderCharacter, appProject, renderedVoiceWord, renderedEntityWord, resolverCases, surfaceCases, saveReloadCase, wiringCases, main };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
