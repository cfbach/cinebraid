/* Batch 2 Slice 5a — the declared shot delivery route: schema, plumbing, and the
 * boundaries it has to survive.
 *
 * WHAT THIS SLICE ADDED, and therefore what this suite has to hold:
 *
 *   1. one durable representation of a shot's declared delivery route;
 *   2. one vocabulary, which is the repository's own and not a second copy of it;
 *   3. migration and import behaviour that carries a declaration and manufactures none;
 *   4. deterministic reconciliation of the dialects CineBraid already speaks;
 *   5. the route in the shot stage FACT RECORD, carried and read by no derivation;
 *   6. NOTHING A FILMMAKER CAN SEE.
 *
 * The sixth is the one worth stating twice. Slice 5a is schema and plumbing; the Shot
 * Intent surface, adaptive stage exposure and route-aware execution are Slice 5b's. So
 * the central behavioural assertion here is a NEGATIVE one — declaring any of the five
 * routes on a shot must leave every rendered surface byte-identical — and it is asserted
 * against the shipped renderers rather than against a claim about them.
 *
 * WHAT IS DELIBERATELY NOT PROVEN HERE, because it is not true yet: that a route narrows
 * anything, that a stage becomes not-applicable, that a picker filters, or that any
 * model is recommended. Section 11 proves the opposite of the dangerous half of that —
 * no route can widen resolveTaskModes() — which is the invariant Slice 5b inherits.
 *
 * No provider is contacted, no paid route is called, and nothing outside a temporary
 * directory is written. The repository's own project data is opened read-only.
 */

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
/* Line endings are normalised on read: this repository checks out with
   core.autocrlf=true, so a multi-line anchor written with \n would match nothing. */
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const Route = require("../public/shared-shot-route");
const Stage = require("../public/shared-stage-model");
const { resolveTaskModes } = require("../public/shared-generation-options");
const { CINEBRAID_GENERATION_MODES } = require("../public/shared-generation-capability");
const { previewLegacyMigration } = require("../ofp/ofp-migrate");
const { detectLegacyProject } = require("../ofp/ofp-migrate-detect");
const { parseJsonStrict } = require("../ofp/ofp-json");
const { render, buildFixture } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

const ROUTES = ["t2v", "i2v", "flf", "r2v", "hybrid"];
const VIDEO_ROUTES = ["t2v", "i2v", "flf", "r2v"];

/* ===========================================================================
   1 — THE VOCABULARY IS THE REPOSITORY'S OWN.

   The point of this section is that Slice 5a introduced no parallel taxonomy. Four of
   the five tokens are asserted against the SHIPPED generation-mode list and against what
   the SHIPPED resolver can actually return, so a future edit that renames a mode breaks
   this rather than leaving two vocabularies quietly disagreeing.
   =========================================================================== */

function checkVocabulary() {
  assert.deepStrictEqual([...Route.CINEBRAID_SHOT_ROUTES], ROUTES,
    "the canonical routes, in declaration order, are exactly the five the brief names");
  assert.strictEqual(new Set(Route.CINEBRAID_SHOT_ROUTES).size, 5, "no duplicates");
  assert.strictEqual(Route.CINEBRAID_SHOT_ROUTE_FIELD, "deliveryRoute",
    "the storage key is declared once and every reader spells it from here");

  /* The four video routes ARE generation modes CineBraid already declares. */
  for (const route of VIDEO_ROUTES)
    assert(CINEBRAID_GENERATION_MODES.includes(route),
      `${route} must already be a declared CineBraid generation mode, not a new spelling of one`);
  assert(!CINEBRAID_GENERATION_MODES.includes("hybrid"),
    "hybrid must NOT be a generation mode — it names no single method, which is the whole of what it says");

  /* And they are exactly the modes the shipped resolver can produce for an animated
     shot. Derived from resolveTaskModes() rather than restated, so this is the same
     table twice only for as long as the product keeps it so. */
  const image = (role) => ({ role, mediaType: "image" });
  const shapes = [
    [],
    [image("first-frame")],
    [image("first-frame"), image("last-frame")],
    [image("identity")],
    [image("identity"), image("style")],
    [image("last-frame")],
    [image("first-frame"), image("identity")],
  ];
  const produced = new Set();
  for (const references of shapes)
    for (const mode of resolveTaskModes("animate-shot", { references })) produced.add(mode);
  assert.deepStrictEqual([...produced].sort(), [...VIDEO_ROUTES].sort(),
    "the four video routes are exactly the modes resolveTaskModes() can return for animate-shot");

  /* The mode table says EXACT for four and ABSENT for hybrid, and says it explicitly
     rather than by omission. */
  assert.deepStrictEqual(Object.keys(Route.CINEBRAID_SHOT_ROUTE_MODES).sort(), [...ROUTES].sort(),
    "every route has a row in the mode table, including the one with no mode");
  for (const route of VIDEO_ROUTES)
    assert.strictEqual(Route.shotRouteGenerationMode(route), route, `${route} maps to itself`);
  assert.strictEqual(Route.shotRouteGenerationMode("hybrid"), "",
    "hybrid names no generation mode, so it can never be turned into permission for one");

  note(`1. vocabulary: ${ROUTES.join(", ")} — four are shipped generation modes, hybrid is deliberately none`);
}

/* ===========================================================================
   2 — THE STORAGE CONTRACT: absence, declaration, withdrawal, refusal.
   =========================================================================== */

function checkStorageContract() {
  const shot = { id: "S-01", title: "Dock walk" };

  /* Absence is a MISSING KEY, and reading it writes nothing. */
  const before = JSON.stringify(shot);
  const absent = Route.readShotRoute(shot);
  assert.strictEqual(absent.reading, "absent");
  assert.strictEqual(absent.route, "");
  assert.strictEqual(Route.declaredShotRoute(shot), "");
  assert.strictEqual(JSON.stringify(shot), before, "reading a route must not create the key");
  assert(!("deliveryRoute" in shot), "an undeclared route leaves no slot behind");

  /* Declaration stores the canonical token and nothing else. */
  for (const route of ROUTES) {
    const target = { id: "S-01" };
    const outcome = Route.declareShotRoute(target, route);
    assert.strictEqual(outcome.ok, true, `${route} must be declarable`);
    assert.strictEqual(outcome.route, route);
    assert.strictEqual(outcome.changed, true);
    assert.deepStrictEqual(Object.keys(target), ["id", "deliveryRoute"],
      `${route}: declaring a route must touch exactly one key`);
    assert.strictEqual(target.deliveryRoute, route, "stored in canonical form");
    assert.strictEqual(Route.readShotRoute(target).reading, "declared");
    /* Re-declaring the same route is honest about having changed nothing. */
    assert.strictEqual(Route.declareShotRoute(target, route).changed, false);
  }

  /* Withdrawal DELETES. A withdrawn route and a route that never existed serialise
     identically, so nothing downstream can read a decision out of an empty slot. */
  const withdrawn = { id: "S-01" };
  Route.declareShotRoute(withdrawn, "flf");
  const cleared = Route.clearShotRoute(withdrawn);
  assert.strictEqual(cleared.changed, true);
  assert(!("deliveryRoute" in withdrawn), "clearing deletes the key rather than storing an empty one");
  assert.strictEqual(JSON.stringify(withdrawn), JSON.stringify({ id: "S-01" }),
    "a withdrawn route and one that never existed are the same bytes");
  assert.strictEqual(Route.clearShotRoute(withdrawn).changed, false, "clearing nothing changes nothing");

  /* An explicitly stored null or "" reads as absent rather than as corruption: a record
     that once held a route and was emptied by an older writer is not broken. */
  for (const empty of [null, "", "   "]) {
    const reading = Route.readShotRoute({ id: "S", deliveryRoute: empty });
    assert.strictEqual(reading.reading, "absent", `${JSON.stringify(empty)} reads as no declaration`);
    assert.strictEqual(reading.route, "");
  }

  note("2. storage: absence is a missing key, declaration writes one canonical token, withdrawal deletes");
}

/* ===========================================================================
   3 — DIALECT RECONCILIATION.

   Each mapping below is asserted against the SHIPPED source that establishes it, so an
   equivalence this repository does not actually make cannot be asserted here.
   =========================================================================== */

function checkDialects() {
  /* (a) CASE. The research prose writes T2V/I2V/FLF/R2V; the product stores lowercase.
     One token, two cases — which is why this is folding and not translation. */
  for (const route of ROUTES) {
    assert.strictEqual(Route.canonicalShotRoute(route.toUpperCase()), route);
    /* Surrounding whitespace only. A token that arrived from a text field or from a JSON
       document with a trailing newline is the same token; nothing further is forgiven. */
    for (const padded of [`  ${route.toUpperCase()}  `, `${route}\n`, `\t${route}`, `\r\n${route.toUpperCase()}\r\n`])
      assert.strictEqual(Route.canonicalShotRoute(padded), route, `${JSON.stringify(padded)} is the same token`);
  }

  /* (b) GENERATION MODES, both directions, for the four the repository establishes. */
  for (const route of VIDEO_ROUTES) {
    assert.strictEqual(Route.shotRouteFromGenerationMode(route), route);
    assert.strictEqual(Route.shotRouteFromGenerationMode(route.toUpperCase()), route);
  }
  for (const mode of CINEBRAID_GENERATION_MODES.filter((name) => !VIDEO_ROUTES.includes(name)))
    assert.strictEqual(Route.shotRouteFromGenerationMode(mode), "",
      `${mode} is a generation mode and NOT a shot route; asserting an equivalence would invent one`);
  assert.strictEqual(Route.shotRouteFromGenerationMode("hybrid"), "",
    "hybrid is not a generation mode, so it cannot arrive as one");

  /* (c) CLIP KINDS, against server.js's own admitted set rather than a list retyped
     here. The three motion kinds that are route tokens map across; the frameless and
     non-generative ones do not. */
  const serverSource = readLF("server.js");
  const kindLine = serverSource.match(/allowedKinds = new Set\(\[([^\]]+)\]\)/);
  assert(kindLine, "server.js must still declare the import path's clip-kind vocabulary");
  const allowedKinds = kindLine[1].split(",").map((token) => token.trim().replace(/^"|"$/g, "")).filter(Boolean);
  assert(allowedKinds.length >= 8, `expected the shipped clip-kind set, got ${allowedKinds.join(",")}`);
  for (const kind of allowedKinds) {
    const expected = VIDEO_ROUTES.includes(kind) ? kind : "";
    assert.strictEqual(Route.shotRouteFromClipKind(kind), expected,
      `clip kind ${kind} must map to ${expected ? expected : "no route"}`);
  }
  assert.strictEqual(Route.shotRouteFromClipKind("hybrid"), "",
    "hybrid is a shot-level statement and never one unit's kind");

  /* (d) THE LEGACY `shot.route` FIELD. public/app.js already reads FLF and R2V out of
     it to choose a clip kind, and window.setOutputPlan writes the strings below. Both
     halves are lifted from the shipped source so this cannot drift into a claim the app
     does not make. */
  const appSource = readLF("public/app.js");
  assert(appSource.includes('(s.route || "").includes("FLF")'),
    "public/app.js must still read FLF out of the legacy output route");
  assert(appSource.includes('(s.route || "").includes("R2V")'),
    "public/app.js must still read R2V out of the legacy output route");
  const planWriter = appSource.slice(appSource.indexOf("  s.route = {"), appSource.indexOf("  s.route = {") + 400);
  const written = [...planWriter.matchAll(/:\s*"([A-Z][^"]*)"/g)].map((match) => match[1]);
  assert(written.length >= 5, `expected setOutputPlan's own route strings, got ${written.join(" | ")}`);
  for (const value of new Set(written)) {
    const expected = value.includes("FLF") ? "flf" : value.includes("R2V") ? "r2v" : "";
    assert.strictEqual(Route.shotRouteFromLegacyOutputRoute(value).route, expected,
      `legacy output route ${JSON.stringify(value)} must map to ${expected ? expected : "no route"}`);
  }
  /* "GENERATE" carries no route BECAUSE three different output plans write it. That is
     the reason, and it is asserted rather than assumed. */
  const generatePlans = written.filter((value) => value === "GENERATE").length;
  assert(generatePlans >= 3,
    "GENERATE must still be written by several plans — it is ambiguous by construction, which is why it maps to nothing");
  assert.strictEqual(Route.shotRouteFromLegacyOutputRoute("GENERATE").route, "");
  assert(Route.shotRouteFromLegacyOutputRoute("GENERATE").reason.includes("names no delivery route"));

  /* (e) A DIALECT VALUE IS NOT A ROUTE VALUE. The legacy field's spelling must not be
     accepted by the canonical reader, or the two fields would quietly merge. */
  for (const value of ["GENERATE (FLF)", "GENERATE (R2V)", "COMPOSITE", "REUSE"])
    assert.strictEqual(Route.canonicalShotRoute(value), "",
      `${value} belongs to shot.route and must not be readable as a declared delivery route`);

  note(`3. dialects: case-folded; ${VIDEO_ROUTES.length} modes both ways; ${allowedKinds.length} clip kinds checked; `
    + `legacy GENERATE(FLF)/GENERATE(R2V) only, and GENERATE deliberately carries none`);
}

/* ===========================================================================
   4 — MALFORMED, UNSUPPORTED AND DIALECT-CONFUSED VALUES.

   The requirement is not "these are rejected". It is that none of them silently becomes
   a DIFFERENT valid route, and that a refusal leaves the record exactly as it was.
   =========================================================================== */

const HOSTILE = [
  "T2 V", "t2 v", "i2v ,", "flf2", "2flf", "rv2", "r2 v", "hybrid-ish", "hybridise",
  "GENERATE (FLF)", "GENERATE", "COMPOSITE", "REUSE", "first-frame", "last-frame",
  "text-to-video", "image-to-video", "t2i", "v2v", "video-edit", "audio-video", "retake",
  "still", "motion", "video", "sequence", "plan", "post", "reuse", "hold",
  /* Two lookalikes that are NOT the token: a Turkish dotted capital I lowercases to
     i-plus-combining-dot, and the fullwidth forms are different code points. Either
     would be accepted by a comparison sloppier than an exact membership test. */
  "\u01302V", "\uFF492\uFF56", "i2v i2v", "['flf']", "{\"route\":\"flf\"}",
  "-1", "0", "1", "null", "undefined", "true",
];

function checkMalformed() {
  for (const value of HOSTILE) {
    const canonical = Route.canonicalShotRoute(value);
    assert.strictEqual(canonical, "",
      `${JSON.stringify(value)} must not read as ${canonical} — a malformed value must never become a valid route`);
  }
  const NON_STRINGS = [null, undefined, 0, 1, true, false, [], {}, ["flf"], { route: "flf" }, NaN,
    { toString: () => "flf" }, new String("flf")];
  for (const value of NON_STRINGS)
    assert.strictEqual(Route.canonicalShotRoute(value), "",
      `${JSON.stringify(value) || String(value)} is not a route token`);

  /* A refusal does not touch the record — not even to blank it. Run against every
     hostile value rather than a sample, because the one that gets through is never the
     one a sample would have picked. */
  for (const value of [...HOSTILE, ...NON_STRINGS]) {
    const untouched = { id: "S-01", deliveryRoute: "flf", title: "Dock" };
    const outcome = Route.declareShotRoute(untouched, value);
    assert.strictEqual(outcome.ok, false, `${JSON.stringify(value)} must be refused`);
    assert.strictEqual(outcome.reading, "unrecognised");
    assert.strictEqual(outcome.changed, false);
    assert(outcome.reason.includes("is not one of"), "a refusal says what the vocabulary is");
    assert(outcome.reason.includes(JSON.stringify(String(value == null ? "" : value).trim())),
      `a refusal names the value it refused: ${outcome.reason}`);
    assert.strictEqual(untouched.deliveryRoute, "flf",
      `${JSON.stringify(value)} must not have disturbed an existing declaration`);
    assert.deepStrictEqual(Object.keys(untouched), ["id", "deliveryRoute", "title"],
      `${JSON.stringify(value)} must not have added or removed a key`);
  }

  /* A STORED bad value reads as unrecognised — a third state, distinct from absence, so
     a reader can report a corrupted record rather than an undecided one — while every
     consumer that asks "what may I rely on" still gets nothing. */
  for (const value of ["GENERATE (FLF)", "flf2", "text-to-video"]) {
    const stored = { id: "S-01", deliveryRoute: value };
    const reading = Route.readShotRoute(stored);
    assert.strictEqual(reading.reading, "unrecognised", `${value} stored must read as unrecognised`);
    assert.strictEqual(reading.route, "", "and must yield no route");
    assert.strictEqual(reading.stored, value, "with the stored value kept for the reader to report");
    assert.strictEqual(Route.shotRouteFactValue(stored), "", "and no fact record may carry it");
  }

  note(`4. malformed: ${HOSTILE.length} hostile strings plus ${NON_STRINGS.length} non-strings; none became a route, `
    + "no refusal touched a record, and a stored bad token reads unrecognised rather than absent");
}

/* ===========================================================================
   5 — LIFECYCLE ROUND-TRIP, through the real boundaries.

   The shipped browser writes the shot record; the shipped server saves it, backs it up
   and reads it back. Every one of the five routes goes all the way round.
   =========================================================================== */

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function seedProject(over = {}) {
  return {
    meta: { title: "Route Lifecycle", format: "Test", version: "v1", hubVersion: "v5.5.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC-01", title: "Scene One" }],
    shots: ROUTES.map((route, index) => ({
      id: `S-${String(index + 1).padStart(2, "0")}`,
      scene: "SC-01",
      title: `Shot ${route}`,
      desc: "A fixed exterior camera watches a ship in darkness.",
      positioning: "Locked hull-camera composition.",
      dur: 5,
      workflowStatus: "DRAFT",
      deliveryRoute: route,
      keyframes: [{ id: "frame-a", label: "A", title: "Opening frame", generationPackages: [] }],
      clips: [],
    })).concat([{
      /* The legacy shot: no route, and it must still be routeless at the end. */
      id: "S-LEGACY", scene: "SC-01", title: "Legacy shot",
      desc: "An older shot written before routes existed at all.",
      positioning: "Locked.", dur: 5, workflowStatus: "DRAFT",
      keyframes: [{ id: "frame-a", label: "A", title: "Opening frame", generationPackages: [] }],
      clips: [],
    }]),
    jobs: [], agentRuns: [], decisions: [], sessions: [],
    ...over,
  };
}

async function withServer(seed, body) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-shot-route-"));
  const projectsRoot = path.join(temp, "projects");
  const dir = path.join(projectsRoot, "seed");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "project.json");
  fs.writeFileSync(file, JSON.stringify(seed, null, 2));
  fs.writeFileSync(path.join(temp, "config.json"), JSON.stringify({ activeProject: "seed", provider: "none" }));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: path.join(temp, "config.json"), CINEBRAID_PROJECTS_ROOT: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      try { if ((await fetch(`${base}/api/me`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    return await body({ base, file, dir, projectsRoot, temp, output: () => output });
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 120));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function checkServerRoundTrip() {
  await withServer(seedProject(), async ({ base, file, dir }) => {
    /* Load. */
    const loaded = await (await fetch(`${base}/api/project`)).json();
    for (const [index, route] of ROUTES.entries())
      assert.strictEqual(loaded.shots[index].deliveryRoute, route,
        `${route} must survive the load path unchanged`);
    const legacy = loaded.shots.find((shot) => shot.id === "S-LEGACY");
    assert(!("deliveryRoute" in legacy), "a legacy shot must not acquire the key on load");

    /* Save the document straight back, exactly as the browser would. */
    const saved = await fetch(`${base}/api/projects/seed/project`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(loaded),
    });
    assert.strictEqual(saved.status, 200, "the routed project must save");

    /* On disk, byte for byte. */
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [index, route] of ROUTES.entries())
      assert.strictEqual(onDisk.shots[index].deliveryRoute, route, `${route} must be on disk`);
    assert(!("deliveryRoute" in onDisk.shots.find((shot) => shot.id === "S-LEGACY")),
      "and a legacy shot must still carry no route key on disk");

    /* Reload and compare the whole shot collection, so a route cannot survive while
       something beside it is lost. */
    const reloaded = await (await fetch(`${base}/api/project`)).json();
    assert.deepStrictEqual(
      reloaded.shots.map((shot) => [shot.id, "deliveryRoute" in shot ? shot.deliveryRoute : null]),
      [...ROUTES.map((route, index) => [`S-${String(index + 1).padStart(2, "0")}`, route]), ["S-LEGACY", null]],
      "every route, and the one absence, must be identical after a full save/load cycle",
    );

    /* Backup and restore — the other durable boundary a project crosses. */
    const backup = await (await fetch(`${base}/api/projects/seed/backups`, { method: "POST" })).json();
    assert(backup.ok !== false, `a backup must be creatable: ${JSON.stringify(backup).slice(0, 200)}`);
    const backups = await (await fetch(`${base}/api/projects/seed/backups`)).json();
    const newest = (backups.backups || backups || [])[0];
    const backupName = typeof newest === "string" ? newest : newest && (newest.name || newest.file);
    assert(backupName, `expected a backup to list: ${JSON.stringify(backups).slice(0, 200)}`);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, "backups", backupName), "utf8"));
    assert.deepStrictEqual(
      stored.shots.map((shot) => ("deliveryRoute" in shot ? shot.deliveryRoute : null)),
      [...ROUTES, null],
      "a backup carries every declared route and invents none",
    );
    const restored = await (await fetch(`${base}/api/projects/seed/restore`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: backupName }),
    })).json();
    assert(restored.ok !== false, `restore must succeed: ${JSON.stringify(restored).slice(0, 200)}`);
    const afterRestore = await (await fetch(`${base}/api/project`)).json();
    assert.deepStrictEqual(
      afterRestore.shots.map((shot) => ("deliveryRoute" in shot ? shot.deliveryRoute : null)),
      [...ROUTES, null],
      "and restoring one brings every route back and no extra",
    );
  });
  note("5. server: all five routes survive load -> save -> disk -> reload -> backup -> restore; the legacy shot never gains one");
}

/* ===========================================================================
   6 — IMPORT, the boundary where a document arrives from elsewhere.
   =========================================================================== */

function builderProject(shots) {
  return {
    meta: { title: "Imported Routes", format: "Short film" },
    characters: [{ id: "CHAR-ADA", name: "Ada", description: "A dock engineer in a patched grey coat." }],
    locations: [{ id: "LOC-DOCK", name: "Dock", description: "A wet concrete dock under sodium light." }],
    props: [], vehicles: [],
    scenes: [{ id: "SC-01", title: "Arrival", whatHappens: "Ada walks the dock." }],
    shots,
  };
}

function builderShot(id, over = {}) {
  return {
    id, scene: "SC-01", title: `Shot ${id}`, desc: "Ada walks the length of the dock.",
    positioning: "Locked wide.", characters: ["CHAR-ADA"], codes: ["LOC-DOCK"], dur: 6,
    keyframes: [{ id: "frame-a", label: "A", title: "Opening", description: "Ada at the near bollard." }],
    ...over,
  };
}

async function checkImport() {
  await withServer(seedProject(), async ({ base, projectsRoot }) => {
    const source = builderProject([
      ...ROUTES.map((route, index) => builderShot(`I-${index + 1}`, { deliveryRoute: route.toUpperCase() })),
      builderShot("I-BAD", { deliveryRoute: "GENERATE (FLF)" }),
      builderShot("I-NONE"),
    ]);
    const preview = await (await fetch(`${base}/api/projects/preview-import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: source }),
    })).json();
    assert(preview.normalizedProject, `the preview must succeed: ${JSON.stringify(preview).slice(0, 300)}`);

    const byId = Object.fromEntries(preview.normalizedProject.shots.map((shot) => [shot.id, shot]));
    /* A DECLARATION SURVIVES IMPORT, canonicalised out of the uppercase dialect. Its
       being authored intent is exactly why import does not strip it the way it strips
       winners, packages and approval claims. */
    for (const [index, route] of ROUTES.entries())
      assert.strictEqual(byId[`I-${index + 1}`].deliveryRoute, route,
        `${route.toUpperCase()} must import as the canonical ${route}`);
    /* A VALUE FROM ANOTHER FIELD'S DIALECT IS DROPPED AND SAID OUT LOUD, exactly as an
       unknown clip kind already is — never quietly turned into flf. */
    assert(!("deliveryRoute" in byId["I-BAD"]),
      "an unrecognised declared route must be removed rather than repaired into a neighbour");
    /* The import review surface is where a filmmaker reads what CineBraid did to their
       document, and it is where the drop has to appear — named, with the value. */
    const reviewed = [].concat((preview.review && preview.review.review) || [], (preview.review && preview.review.removed) || []);
    const names = (line) => /I-BAD/.test(line) && /delivery route/i.test(line) && /GENERATE \(FLF\)/.test(line);
    assert(reviewed.some(names),
      `the drop must be named with its value on the review surface: ${JSON.stringify(reviewed).slice(0, 500)}`);
    /* And only for the shot that carried it: five good declarations and one absence
       must produce no warning at all. */
    assert.strictEqual(reviewed.filter((line) => /delivery route/i.test(line)).length, 1,
      "exactly one route warning, for the one unreadable declaration");
    /* AND ABSENCE STAYS ABSENCE. */
    assert(!("deliveryRoute" in byId["I-NONE"]),
      "a shot that declared nothing must import declaring nothing");

    /* Commit the import and read the file the server actually wrote. */
    const committed = await (await fetch(`${base}/api/projects/import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken: preview.previewToken, previewHash: preview.previewHash }),
    })).json();
    assert(committed.ok, `the import must commit: ${JSON.stringify(committed).slice(0, 300)}`);
    assert((committed.warnings || []).some(names),
      `the committed import must carry the same named drop: ${JSON.stringify(committed.warnings || []).slice(0, 500)}`);
    const written = JSON.parse(fs.readFileSync(path.join(projectsRoot, committed.slug, "project.json"), "utf8"));
    assert.deepStrictEqual(
      written.shots.map((shot) => [shot.id, "deliveryRoute" in shot ? shot.deliveryRoute : null]),
      [...ROUTES.map((route, index) => [`I-${index + 1}`, route]), ["I-BAD", null], ["I-NONE", null]],
      "the committed file carries five canonical routes, one dropped and one absent",
    );
  });
  note("6. import: uppercase dialect canonicalised, an alien dialect dropped with its value named, absence preserved");
}

/* ===========================================================================
   7 — OFP MIGRATION.

   1.0-draft.1 is frozen and models no delivery route, so the correct behaviour is an
   explicit, named preservation — not a new core field and not a silent sweep.
   =========================================================================== */

const OFP_FIXTURES = path.join(__dirname, "fixtures", "ofp-legacy");
const AT = "2026-08-10T00:00:00Z";

function checkMigration() {
  const fixtureNames = fs.readdirSync(OFP_FIXTURES).filter((name) => name.endsWith(".json")).sort();
  const migratable = fixtureNames.filter((name) => name !== "foreign-application.json");

  /* (a) NOTHING IS MANUFACTURED. Every accepted legacy fixture migrates without a route
     appearing anywhere in the candidate, the report or the serialized document. */
  for (const name of migratable) {
    const document = parseJsonStrict(fs.readFileSync(path.join(OFP_FIXTURES, name), "utf8"));
    const result = previewLegacyMigration(document, { at: AT });
    assert.strictEqual(JSON.stringify(document).includes("deliveryRoute"), false,
      `${name}: precondition — the fixture must not already declare a route`);
    for (const route of ROUTES)
      assert(!new RegExp(`"deliveryRoute"\\s*:\\s*"${route}"`).test(result.serialized || ""),
        `${name}: migration must not invent a ${route} route`);
    assert(!(result.serialized || "").includes("deliveryRoute"),
      `${name}: no route key may reach a migrated document that had none`);
  }

  /* (b) A DECLARATION IS CARRIED, by name, with its value and its source pointer. */
  const source = parseJsonStrict(fs.readFileSync(path.join(OFP_FIXTURES, "clean.json"), "utf8"));
  for (const route of ROUTES) {
    const document = JSON.parse(JSON.stringify(source));
    document.shots[0].deliveryRoute = route;
    const result = previewLegacyMigration(document, { at: AT });
    assert(result.ok !== false, `${route}: the migration must still succeed`);
    const claims = result.report.accounting.entries.filter((entry) => entry.pointer === "/shots/0/deliveryRoute");
    assert.strictEqual(claims.length, 1, `${route}: exactly one disposition, never a sixth category`);
    assert.strictEqual(claims[0].disposition, "preserved", `${route}: non-destructive`);
    assert.strictEqual(claims[0].rule, "M005",
      `${route}: claimed by the shot rule by name, not swept up anonymously by M070`);
    assert(claims[0].note.includes("deliveryRoute"), "the reason names the field");
    assert.deepStrictEqual(result.report.accounting.unaccounted, [], `${route}: no value goes unaccounted`);
    const preserved = result.candidate.extensions["com.cinebraid.legacy"].preserved
      .filter((row) => row.sourcePath === "/shots/0/deliveryRoute");
    assert.strictEqual(preserved.length, 1);
    assert.strictEqual(preserved[0].value, route, `${route}: preserved verbatim`);
    /* AND IT IS NOT MODELLED INTO CORE. The frozen contract gains no field. */
    assert(!Object.prototype.hasOwnProperty.call(result.candidate.shots[0], "deliveryRoute"),
      `${route}: the frozen OFP shot record must not have grown a route field`);
    assert.strictEqual(result.validation.ok !== false, true, `${route}: the migrated document must still validate`);
  }

  /* (c) THE SCHEMA CONTRACT IS UNCHANGED. Neither the OFP contract revision nor
     CineBraid's own project markers move for an optional field. */
  const schemaSource = readLF("ofp/ofp-schema.js");
  assert(!schemaSource.includes("deliveryRoute"),
    "the frozen OFP contract must not have been given a delivery-route field");
  const appSource = readLF("public/app.js");
  assert(appSource.includes('const PROJECT_SCHEMA_BASELINE_VERSION = "6.6";'),
    "the baseline project schema marker must not have moved");
  assert(appSource.includes('const PROJECT_SCHEMA_VERSION = "6.7";'),
    "and neither may the current one — an optional absent-means-absent field is what 6.7 already means");

  /* (d) DETECTION gains evidence and never an answer. A declared marker still wins; a
     document with no marker at all is recognised by shape, which is what that mechanism
     is for and why shot.continuityIntent is listed beside it. */
  const routed = JSON.parse(JSON.stringify(source));
  routed.shots[0].deliveryRoute = "flf";
  const declared = detectLegacyProject(routed);
  assert(declared.shapeMarkers.includes("shot.deliveryRoute"), "the route is reported as evidence");
  assert.strictEqual(declared.confidence, "declared", "and the document's own marker still decides");
  const unmarked = JSON.parse(JSON.stringify(routed));
  delete unmarked.meta.schemaVersion;
  const sniffed = detectLegacyProject(unmarked);
  assert.strictEqual(sniffed.confidence, "sniffed");
  assert.strictEqual(sniffed.generation, "6.7", "a routed project with no marker sniffs as the generation that writes routes");
  const routeless = JSON.parse(JSON.stringify(source));
  delete routeless.meta.schemaVersion;
  assert(!detectLegacyProject(routeless).shapeMarkers.includes("shot.deliveryRoute"),
    "and a project with no route reports no route evidence");
  for (const empty of ["", "   "]) {
    const blank = JSON.parse(JSON.stringify(source));
    blank.shots[0].deliveryRoute = empty;
    assert(!detectLegacyProject(blank).shapeMarkers.includes("shot.deliveryRoute"),
      "an empty slot is not a declaration and must not be reported as one");
  }

  note(`7. migration: ${migratable.length} legacy fixtures gained no route; all five preserved by M005 with value and pointer; `
    + "OFP core, the contract revision and both CineBraid schema markers unchanged");
}

/* ===========================================================================
   8 — LEGACY COMPATIBILITY, against real shipped data.
   =========================================================================== */

function checkLegacyData() {
  /* The shipped sample and every tracked legacy fixture predate this slice and must
     still contain nothing. If one ever does, it was put there rather than derived. */
  const sample = path.join(ROOT, "projects", "cinebraid-sample", "project.json");
  if (fs.existsSync(sample)) {
    const project = JSON.parse(fs.readFileSync(sample, "utf8"));
    for (const shot of project.shots || [])
      assert(!("deliveryRoute" in shot),
        `the shipped sample's shot ${shot.id} must carry no declared route`);
    note(`  the shipped sample: ${(project.shots || []).length} shots, none routed`);
  }

  /* The render harness fixture is the legacy shot every other suite renders. */
  const fixture = buildFixture();
  for (const shot of fixture.shots)
    assert(!("deliveryRoute" in shot), "the harness fixture must remain a pre-Slice-5 shot");

  /* The normaliser that repairs a record on load must not add one. Asserted against the
     shipped source rather than by inspection: normalizeShotV5 is the function that turns
     an old shot into a current one, and it must not know this field exists. */
  const appSource = readLF("public/app.js");
  const normaliser = appSource.slice(appSource.indexOf("function normalizeShotV5("));
  assert(normaliser.startsWith("function normalizeShotV5("), "normalizeShotV5 must still exist");
  assert(!normaliser.slice(0, normaliser.indexOf("\nfunction ")).includes("deliveryRoute"),
    "opening a legacy project must not write a route into it");

  note("8. legacy: no shipped project data carries a route, and the load-time normaliser cannot write one");
}

/* ===========================================================================
   9 — THE FACT RECORD.
   =========================================================================== */

const scanFor = (project, takes) => ({
  anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
  plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
  props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
  vehicles: (project.vehicles || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/vehicles/${x.approvedFile}` })),
  audio: [],
  media: (project.mediaAssets || []).map((asset) => ({ name: asset.file, url: `/assets/media/${asset.file}` })),
  shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: takes.map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })), locked: [] }])),
});

/* The SHIPPED assembler and the SHIPPED model, reached inside the harness realm. A suite
   that rebuilt either by hand would prove only that two copies of the test agree. */
async function factsFor(routeValue) {
  const project = buildFixture();
  if (routeValue !== undefined) project.shots[0].deliveryRoute = routeValue;
  const takes = [];
  const rendered = await render("#/shot/L1-01", project, { scan: scanFor(project, takes) });
  const payload = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const facts = shotStageModelFacts(shot, takesFor("L1-01"));
    const statuses = SHOT_STAGE_IDS.map((id) => [id, boundedShotTaskStatus(shot, takesFor("L1-01"), id, facts)]);
    return JSON.stringify({
      facts,
      progress: shotStageProgress(facts),
      statuses,
      stored: Object.prototype.hasOwnProperty.call(shot, "deliveryRoute") ? shot.deliveryRoute : null,
    });
  })()`, rendered.context);
  const slots = [...rendered.map.entries()].map(([id, element]) => `<<${id}>>${String(element.innerHTML || "")}`).join("\n");
  return { ...JSON.parse(payload), slots, rendered };
}

async function checkFactRecord() {
  assert(Stage.SHOT_STAGE_FACT_KEYS.includes("deliveryRoute"),
    "the declared stage fact record must name the route among its keys");
  assert.strictEqual(Stage.normaliseShotStageFacts({}).deliveryRoute, "",
    "a fact record built from nothing carries no route");
  assert.strictEqual(Stage.normaliseShotStageFacts({ deliveryRoute: "  flf  " }).deliveryRoute, "flf",
    "and it trims what it is handed rather than storing whitespace");

  const absent = await factsFor(undefined);
  assert.strictEqual(absent.stored, null, "precondition: the fixture shot declares nothing");
  assert.strictEqual(absent.facts.deliveryRoute, "", "absence reaches the fact record as absence");

  for (const route of ROUTES) {
    const declared = await factsFor(route);
    assert.strictEqual(declared.facts.deliveryRoute, route,
      `${route}: the fact record must carry the declared route truthfully`);
    /* THE BROWSER'S OWN LOAD BOUNDARY. normalizeProjectV5 runs over every shot when the
       page opens a project and repairs it into the current shape; the value read here is
       the PAGE'S OWN `P` after that ran, so a normaliser that dropped or rewrote the
       field would show up here rather than in a suite that only re-read its input. */
    assert.strictEqual(declared.stored, route,
      `${route}: the page's own project record must still carry the route after load-time normalisation`);
  }
  /* An unreadable stored token is not a route, and a fact record states what is true —
     but the record keeps it, because silently deleting a value on load is how a
     filmmaker loses something CineBraid merely failed to understand. */
  for (const value of ["GENERATE (FLF)", "flf2", ""]) {
    const broken = await factsFor(value);
    assert.strictEqual(broken.facts.deliveryRoute, "",
      `${JSON.stringify(value)} must not reach the fact record as a route`);
    assert.strictEqual(broken.stored, value,
      `${JSON.stringify(value)}: opening a project must not rewrite or delete a stored value it cannot read`);
  }

  /* NO HEURISTIC BACKFILL. The fixture shot has approved frames, linked references and
     two motion units of different kinds — every input a backfill would be tempted by —
     and still produces no route. */
  assert(absent.facts.frameTotal > 0 && absent.facts.referenceCount > 0,
    "precondition: the fixture must actually carry the material a heuristic would read");
  assert.strictEqual(absent.facts.deliveryRoute, "",
    "frames, references and motion units must not add up to a declared route");

  note(`9. fact record: declared routes carried verbatim, absence and unreadable tokens both "", `
    + `and a shot with ${absent.facts.frameTotal} frames / ${absent.facts.referenceCount} references still declares none`);
  return absent;
}

/* ===========================================================================
   10 — NO VISIBLE WORKFLOW CHANGE.

   The central Slice 5a assertion. Every rendered surface the harness owns, plus the
   stage model's own output and the strip's status projection, must be byte-identical
   with and without a declared route — for all five routes and for a malformed one.
   =========================================================================== */

async function checkNoVisibleChange(baseline) {
  for (const value of [...ROUTES, "GENERATE (FLF)", ""]) {
    const routed = await factsFor(value);
    assert.strictEqual(routed.slots, baseline.slots,
      `declaring ${JSON.stringify(value)} changed a rendered surface; Slice 5a may change nothing a filmmaker sees`);
    assert.strictEqual(JSON.stringify(routed.progress), JSON.stringify(baseline.progress),
      `declaring ${JSON.stringify(value)} changed the stage model's output`);
    assert.strictEqual(JSON.stringify(routed.statuses), JSON.stringify(baseline.statuses),
      `declaring ${JSON.stringify(value)} changed what the persistent stage bar would print`);
    /* Everything ELSE in the fact record is identical too, so the route is the only
       thing that moved. */
    const strip = (facts) => { const copy = { ...facts }; delete copy.deliveryRoute; return JSON.stringify(copy); };
    assert.strictEqual(strip(routed.facts), strip(baseline.facts),
      `declaring ${JSON.stringify(value)} disturbed another fact`);
  }

  /* And no Slice 5b vocabulary reached a rendered surface. The four route tokens are NOT
     probed for: `i2v` and `flf` are pre-existing motion-unit and profile vocabulary and
     have been rendered since long before this slice. The byte-identity above is what
     proves nothing new appeared; these probe the words the slice would leak. */
  for (const pattern of [/\bdelivery\s*route\b/i, /\bshot\s*intent\b/i, /adaptive\s*execution/i, /\broute\s*chooser\b/i])
    assert(!pattern.test(baseline.slots),
      `no rendered surface may carry Slice 5b vocabulary: ${pattern}`);

  /* The shipped page has no control that writes one, either. */
  const shipped = ["public/app.js", "public/creation-studio.js", "public/v607-composer.js",
    "public/motion-sound-composer.js", "public/generation-picker.js", "public/stage-surfaces.js",
    "public/creator-surfaces.js", "public/views.js", "public/planning.js", "public/mutations.js",
    "public/fal-generation.js", "public/automation.js"];
  for (const file of shipped) {
    const source = readLF(file);
    assert(!/declareShotRoute|clearShotRoute|\.deliveryRoute\s*=/.test(source),
      `${file} must not write a declared route: Slice 5a ships no writer and no chooser`);
  }

  note(`10. no visible change: ${ROUTES.length + 2} route values rendered byte-identically across `
    + "every harness slot, the stage model's output and the stage bar's status projection");
}

/* ===========================================================================
   11 — NO ROUTE WIDENS resolveTaskModes().
   =========================================================================== */

function checkNoWidening() {
  const optionsSource = readLF("public/shared-generation-options.js");
  assert(!/deliveryRoute|shared-shot-route|CINEBRAID_SHOT_ROUTE/.test(optionsSource),
    "the generation resolver must not have learned that routes exist");
  assert(optionsSource.includes("function resolveTaskModes(task, inputs = {})"),
    "resolveTaskModes must still take a task and its inputs, and nothing else");

  /* No generation-admissibility owner names the field. This is the structural half of
     the guarantee: a route that reaches none of them cannot widen any of them. */
  const owners = [
    "public/shared-generation-options.js", "public/shared-generation-capability.js",
    "public/shared-shot-readiness.js", "generation-options.js", "generation-compiler.js",
    "generation-contracts.js", "generation-binding.js", "fal-generation.js",
    "h3-execution.js", "image-execution.js", "prompt-engine.js",
    "model-packs/minimax-h3.js", "model-packs/gpt-image-2.js",
  ];
  for (const file of owners)
    assert(!/deliveryRoute|shared-shot-route/.test(readLF(file)),
      `${file} decides what may be generated and must not read a declared route in Slice 5a`);

  /* The behavioural half: the shipped resolver's answers for every reference shape are
     exactly the baseline's, and the modes it can EVER return for an animated shot are
     the four video ones — so `hybrid`, which is a route and not a mode, can never become
     an admissible method by any path. */
  const image = (role) => ({ role, mediaType: "image" });
  const table = [
    [[], ["t2v"]],
    [[image("first-frame")], ["i2v"]],
    [[image("first-frame"), image("last-frame")], ["flf"]],
    [[image("identity")], ["r2v"]],
    [[image("identity"), image("style")], ["r2v"]],
    [[image("last-frame")], ["r2v"]],
  ];
  for (const [references, expected] of table)
    assert.deepStrictEqual(resolveTaskModes("animate-shot", { references }), expected,
      `animate-shot with ${references.map((row) => row.role).join("+") || "nothing"} must still resolve to ${expected.join(",")}`);
  for (const [task, expected] of [
    ["blocking-frame", ["blocking", "t2i"]],
    ["create-frame", ["t2i"]],
    ["edit-frame", ["edit"]],
  ])
    assert.deepStrictEqual(resolveTaskModes(task, { references: [] }), expected,
      `${task} must be unchanged by this slice`);

  /* A route token cannot be smuggled in as an input either. */
  for (const route of ROUTES) {
    assert.deepStrictEqual(resolveTaskModes("animate-shot", { references: [], deliveryRoute: route }), ["t2v"],
      `a ${route} route passed as an input must not change what a shot may generate`);
    assert.deepStrictEqual(resolveTaskModes("animate-shot", { references: [image("first-frame")], route }), ["i2v"],
      `and neither may it under any other key`);
  }
  assert(!resolveTaskModes("animate-shot", { references: [] }).includes("hybrid"),
    "hybrid is not a generation mode and must never be returned as one");

  note("11. resolveTaskModes: unchanged signature, unchanged table, no admissibility owner reads a route, "
    + "and a route supplied as an input widens nothing");
}

/* =========================================================================== */

async function main() {
  checkVocabulary();
  checkStorageContract();
  checkDialects();
  checkMalformed();
  checkMigration();
  checkLegacyData();
  const baseline = await checkFactRecord();
  await checkNoVisibleChange(baseline);
  checkNoWidening();
  await checkServerRoundTrip();
  await checkImport();

  console.log("Shot route schema suite passed:");
  for (const line of notes) console.log(`  - ${line}`);
  console.log("  Paid calls: 0. Provider calls: 0. Off-site requests: 0.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
