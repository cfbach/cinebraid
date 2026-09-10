/* Negative controls for tests/shot-route-schema.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces ONE of the defects Slice 5a exists to prevent — IN MEMORY, through
 * an in-memory Module, a require-cache substitution, the render harness's mutateSource
 * hook or a vm-extracted copy of the shipped declaration, so nothing on disk is touched
 * and no control can be "restored" by a checkout that also discards real work — and then
 * proves the guard notices.
 *
 * Every control carries a PROBE RECEIPT: the mutation asserts the text it is replacing
 * was actually present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing.
 *
 * The controls are chosen to break DIFFERENT mechanisms, because the failure this slice
 * is most exposed to is not a crash. It is a route that quietly appears where nobody
 * declared one, or a visible behaviour that quietly starts depending on one.
 *
 * NO PROJECT DATA IS TOUCHED, NO PAID CALL AND NO PROVIDER CALL.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const ROUTE_FILE = path.join(PUBLIC, "shared-shot-route.js");
const RULES_FILE = path.join(ROOT, "ofp", "ofp-migrate-rules.js");

/* Line endings are normalised on read: this repository checks out with
   core.autocrlf=true, so a multi-line anchor written with \n would match nothing and
   take the control's meaning with it. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const ROUTE_SOURCE = readLF(ROUTE_FILE);
const SERVER_SOURCE = readLF(path.join(ROOT, "src/server/server.js"));

const Route = require("../public/shared-shot-route");
const { render, buildFixture } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

const ROUTES = ["t2v", "i2v", "flf", "r2v", "hybrid"];

/* A mutation that must find what it is replacing. */
function mutate(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

/* A harness mutateSource hook scoped to one file, with the same probe receipt. */
function replacing(file, needle, replacement, label, expected = 1) {
  return (name, contents) => {
    if (name !== file) return contents;
    return mutate(String(contents).replace(/\r\n/g, "\n"), needle, replacement, label, expected);
  };
}

/* Compile a mutated module in memory under its real filename, so its own require()s
   resolve normally. The file on disk is opened read-only and never written. */
function compileModule(file, source) {
  const compiled = new Module(file, null);
  compiled.filename = file;
  compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(source, file);
  return compiled.exports;
}

/* Runs the body and requires it to throw, mentioning `because`. */
async function mustFail(label, because, body) {
  let failure = null;
  try { await body(); }
  catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
  note(`  ${label} — failed as required`);
}

/* ===========================================================================
   THE MODULE'S OWN SEMANTICS.
   =========================================================================== */

async function moduleControls() {
  /* NC-1 — canonicalisation by substring. This is the single most likely bad repair:
     "GENERATE (FLF)" contains "flf", so a reader that searched instead of matching would
     turn the LEGACY OUTPUT-PLAN field's value into a declared delivery route. */
  await mustFail(
    "NC-1 canonicalisation matches a substring instead of the whole token",
    "must not read as flf",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        "  const token = value.trim().toLowerCase();\n  return CINEBRAID_SHOT_ROUTES.includes(token) ? token : \"\";",
        "  const token = value.trim().toLowerCase();\n  return CINEBRAID_SHOT_ROUTES.find((route) => token.includes(route)) || \"\";",
        "NC-1"));
      for (const value of ["GENERATE (FLF)", "flf2", "hybrid-ish"])
        assert.strictEqual(broken.canonicalShotRoute(value), "",
          `${JSON.stringify(value)} must not read as ${broken.canonicalShotRoute(value)} — a malformed value must never become a valid route`);
    },
  );

  /* NC-2 — coercion before the type check. `["flf"]` stringifies to "flf". */
  await mustFail(
    "NC-2 a non-string value is coerced before it is checked",
    "is not a route token",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        '  if (typeof value !== "string") return "";\n  const token = value.trim().toLowerCase();',
        "  const token = shotRouteText(value).toLowerCase();",
        "NC-2"));
      for (const value of [["flf"], { toString: () => "flf" }])
        assert.strictEqual(broken.canonicalShotRoute(value), "",
          `${JSON.stringify(value)} is not a route token`);
    },
  );

  /* NC-3 — the writer stores what it was handed rather than the canonical token, so an
     uppercase declaration produces a document two readers disagree about. */
  await mustFail(
    "NC-3 the writer stores the caller's spelling instead of the canonical one",
    "stored in canonical form",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        "  shot[CINEBRAID_SHOT_ROUTE_FIELD] = route;\n  return { ok: true, reading: \"declared\", route, changed, reason: \"\" };",
        "  shot[CINEBRAID_SHOT_ROUTE_FIELD] = shotRouteText(value);\n  return { ok: true, reading: \"declared\", route, changed, reason: \"\" };",
        "NC-3"));
      const shot = { id: "S-01" };
      broken.declareShotRoute(shot, "FLF");
      assert.strictEqual(shot.deliveryRoute, "flf", "stored in canonical form");
    },
  );

  /* NC-4 — a refusal that "tidies up" by blanking the field. A filmmaker's earlier
     decision would be destroyed by a later bad one. */
  await mustFail(
    "NC-4 a refused declaration wipes the existing one",
    "must not have disturbed an existing declaration",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        "  const route = canonicalShotRoute(value);\n  if (!route)\n    return {",
        "  const route = canonicalShotRoute(value);\n  if (!route)\n    return delete shot[CINEBRAID_SHOT_ROUTE_FIELD] && {",
        "NC-4"));
      const shot = { id: "S-01", deliveryRoute: "flf" };
      broken.declareShotRoute(shot, "GENERATE (FLF)");
      assert.strictEqual(shot.deliveryRoute, "flf",
        '"GENERATE (FLF)" must not have disturbed an existing declaration');
    },
  );

  /* NC-5 — withdrawal that stores "" instead of deleting. The record then carries a slot
     a later reader can mistake for a decision, and two projects that mean the same thing
     stop serialising the same. */
  await mustFail(
    "NC-5 withdrawing a route leaves an empty slot behind",
    "the same bytes",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        "  delete shot[CINEBRAID_SHOT_ROUTE_FIELD];\n  return { ok: true, changed: true, reason: \"\" };",
        "  shot[CINEBRAID_SHOT_ROUTE_FIELD] = \"\";\n  return { ok: true, changed: true, reason: \"\" };",
        "NC-5"));
      const shot = { id: "S-01" };
      broken.declareShotRoute(shot, "flf");
      broken.clearShotRoute(shot);
      assert.strictEqual(JSON.stringify(shot), JSON.stringify({ id: "S-01" }),
        "a withdrawn route and one that never existed are the same bytes");
    },
  );

  /* NC-6 — the import boundary "repairs" an unrecognised value into the nearest legacy
     reading instead of dropping it. This is the exact behaviour the clip-kind normaliser
     already refuses, and it would silently route a shot nobody routed. */
  await mustFail(
    "NC-6 import repairs an unreadable declaration instead of dropping it",
    "must be removed rather than repaired",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        '  if (reading.reading === "unrecognised") {\n    clearShotRoute(shot);',
        '  if (reading.reading === "unrecognised") {\n    const salvage = shotRouteFromLegacyOutputRoute(reading.stored).route;\n'
        + '    if (salvage) { shot[CINEBRAID_SHOT_ROUTE_FIELD] = salvage; return { route: salvage, changed: true, dropped: false, stored: reading.stored, reason: "" }; }\n'
        + "    clearShotRoute(shot);",
        "NC-6"));
      const shot = { id: "I-BAD", deliveryRoute: "GENERATE (FLF)" };
      broken.normaliseStoredShotRoute(shot);
      assert(!("deliveryRoute" in shot),
        "an unrecognised declared route must be removed rather than repaired into a neighbour");
    },
  );

  /* NC-7a — THE REPRODUCED REVIEW BLOCKER, put back. The legacy `shot.route` reader
     searches for a token instead of matching the whole value, so arbitrary text becomes a
     declared delivery route. This is the control for the exact defect independent review
     found, and it is checked against the REAL Overfit corpus as well as the named
     reproductions, because the corpus is where the consequence actually lands. */
  await mustFail(
    "NC-7a the legacy output-plan reader searches for a token instead of matching the value",
    "must name no route",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        "  const exact = stored.toUpperCase();\n"
        + "  if (Object.prototype.hasOwnProperty.call(CINEBRAID_SHOT_ROUTE_LEGACY_VALUES, exact))\n"
        + "    return { route: CINEBRAID_SHOT_ROUTE_LEGACY_VALUES[exact], reason: \"\" };",
        "  const exact = stored.toUpperCase();\n"
        + "  for (const [key, route] of Object.entries(CINEBRAID_SHOT_ROUTE_LEGACY_VALUES))\n"
        + "    if (exact.includes(key.slice(key.indexOf(\"(\") + 1, key.indexOf(\")\")))) return { route, reason: \"\" };",
        "NC-7a"));
      for (const value of ["WAFFLEFLFZ", "NOT-R2V-ROUTE", "FLF MAYBE",
        "GENERATE + STAGE-3 (FLF t.b.d. at build)"])
        assert.strictEqual(broken.shotRouteFromLegacyOutputRoute(value).route, "",
          `${JSON.stringify(value)} merely CONTAINS a route token and must name no route`);
    },
  );

  /* NC-7b — an alias nobody writes is added to the table. The narrowing is only as good
     as the rule that every key must be a string the shipped writer actually produces;
     without it a convenient "FLF" would walk straight back in through the front door. */
  await mustFail(
    "NC-7b the legacy table gains an alias no writer produces",
    "not an alias invented here",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        '  "GENERATE (FLF)": "flf",',
        '  "GENERATE (FLF)": "flf",\n  FLF: "flf",',
        "NC-7b"));
      const written = readLF(path.join(PUBLIC, "app.js"));
      const planWriter = written.slice(written.indexOf("  s.route = {"), written.indexOf("  s.route = {") + 400);
      const produced = [...planWriter.matchAll(/:\s*"([A-Z][^"]*)"/g)].map((match) => match[1]);
      for (const key of Object.keys(broken.CINEBRAID_SHOT_ROUTE_LEGACY_VALUES))
        assert(produced.includes(key),
          `${JSON.stringify(key)} must be a value window.setOutputPlan actually writes, not an alias invented here`);
    },
  );

  /* NC-7 — hybrid acquires a generation mode. It names no single method, and the moment
     it names one it becomes a claim about what a shot may generate. */
  await mustFail(
    "NC-7 hybrid is given a generation mode",
    "can never be turned into permission",
    () => {
      const broken = compileModule(ROUTE_FILE, mutate(ROUTE_SOURCE,
        "  hybrid: \"\",\n};",
        "  hybrid: \"r2v\",\n};",
        "NC-7"));
      assert.strictEqual(broken.shotRouteGenerationMode("hybrid"), "",
        "hybrid names no generation mode, so it can never be turned into permission for one");
    },
  );
}

/* ===========================================================================
   THE FACT RECORD AND THE RENDERED SURFACES.
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

async function factsFor(routeValue, options = {}) {
  const project = buildFixture();
  if (routeValue !== undefined) project.shots[0].deliveryRoute = routeValue;
  const rendered = await render("#/shot/L1-01", project, { scan: scanFor(project, []), ...options });
  const payload = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const facts = shotStageModelFacts(shot, takesFor("L1-01"));
    return JSON.stringify({ facts, progress: shotStageProgress(facts) });
  })()`, rendered.context);
  const parsed = JSON.parse(payload);
  const slots = [...rendered.map.entries()].map(([id, element]) => `<<${id}>>${String(element.innerHTML || "")}`).join("\n");
  return { ...parsed, slots };
}

async function surfaceControls() {
  const baseline = await factsFor(undefined);
  assert.strictEqual(baseline.facts.deliveryRoute, "", "precondition: the unrouted fixture declares nothing");

  /* NC-8 — the assembler backfills from the shot's own clips. Every heuristic the brief
     forbids is one of these: read the clips, read the frames, read the references, read
     the prior generations. This is the cheapest and therefore the likeliest. */
  await mustFail(
    "NC-8 the fact assembler derives a route from the shot's motion units",
    "must not add up to a declared route",
    async () => {
      const backfilled = await factsFor(undefined, {
        mutateSource: replacing("creation-studio.js",
          "    deliveryRoute: shotRouteFactValue(s),",
          "    deliveryRoute: shotRouteFactValue(s) || shotRouteFromClipKind((s.clips || [])[0] && (s.clips || [])[0].kind),",
          "NC-8"),
      });
      assert.strictEqual(backfilled.facts.deliveryRoute, "",
        "frames, references and motion units must not add up to a declared route");
    },
  );

  /* NC-9 — the assembler carries the RAW stored value, so an unreadable token reaches a
     fact record as though it were a route. */
  await mustFail(
    "NC-9 an unreadable stored token reaches the fact record verbatim",
    "must not reach the fact record as a route",
    async () => {
      const raw = await factsFor("GENERATE (FLF)", {
        mutateSource: replacing("creation-studio.js",
          "    deliveryRoute: shotRouteFactValue(s),",
          "    deliveryRoute: s.deliveryRoute,",
          "NC-9"),
      });
      assert.strictEqual(raw.facts.deliveryRoute, "",
        '"GENERATE (FLF)" must not reach the fact record as a route');
    },
  );

  /* NC-10 - the stage re-derives availability from frame approval and bypasses
     canonical readiness. This recreates the product defect: an r2v shot has no required
     frames, so requiredFramesApproved is true while an unapproved Canon reference still
     blocks the authoritative motion unit. */
  await mustFail(
    "NC-10 Motion bypasses canonical readiness",
    "Motion availability must project canonical readiness",
    async () => {
      const hook = replacing("shared-stage-model.js",
        '    const complete = facts.motionReadinessStatus === "COMPLETE";\n    const generationOpen = facts.motionReadinessStatus === "READY" || complete;\n    const returnedWork = facts.motionCandidateCount > 0;\n    const open = generationOpen || returnedWork;',
        '    const complete = facts.motionReadinessStatus === "COMPLETE";\n    const generationOpen = facts.requiredFramesApproved || complete;\n    const returnedWork = facts.motionCandidateCount > 0;\n    const open = generationOpen || returnedWork;',
        "NC-10");
      const routed = await factsFor("r2v", { mutateSource: hook });
      assert.strictEqual(routed.facts.requiredFramesApproved, true,
        "precondition: r2v has no required frame blocker");
      assert.strictEqual(routed.facts.motionReadinessStatus, "NEEDS_DECISION",
        "precondition: canonical reference authority still blocks Motion");
      const motion = routed.progress.find((state) => state.id === "motion");
      assert.strictEqual(motion.availability, "blocked",
        "Motion availability must project canonical readiness");
    },
  );
  /* NC-11 — AN UNROUTED SHOT'S SURFACE ACQUIRES AN INTENT BY INFERENCE.

     REWRITTEN FOR SLICE 5b, AND THE ORIGINAL IS RECORDED HERE BECAUSE ITS RETIREMENT IS
     THE POINT. This control used to declare a route and require every rendered surface
     to be byte-identical, which was 5a's central guarantee and is 5b's central change:
     the Shot Intent control and adaptive frame exposure are supposed to move. Left as it
     was, the control would have gone on "passing" against a difference the product now
     makes deliberately — a guard that reports success while proving nothing.

     What is still absolutely forbidden, in 5a and in 5b alike, is a route nobody
     declared. So the mutation makes the SHOT INTENT SURFACE ITSELF read a route off the
     shot's first motion unit when the record declares none — the cheapest and likeliest
     backfill, and the one that would put a filmmaker's name on a decision they never
     made — and the guard is that an unrouted shot renders exactly as the shipped build
     renders it. The fixture's first clip is `i2v`, so the inference has something to
     find. */
  await mustFail(
    "NC-11 the Shot Intent surface infers an intent from the shot's motion units",
    "must not add up to a declared intent",
    async () => {
      const inferred = await factsFor(undefined, {
        mutateSource: replacing("creation-studio.js",
          "  const intent = readShotIntent(s);",
          "  const intent = readShotIntent(Object.prototype.hasOwnProperty.call(s, \"deliveryRoute\") ? s : { ...s, deliveryRoute: shotRouteFromClipKind(((s.clips || [])[0] || {}).kind) });",
          "NC-11"),
      });
      assert.strictEqual(inferred.slots, baseline.slots,
        "frames, references and motion units must not add up to a declared intent on a rendered surface");
    },
  );
  note(`  surface controls ran against ${baseline.progress.length} declared stages`);
}

/* ===========================================================================
   MIGRATION.
   =========================================================================== */

function withMutatedRules(needle, replacement, label, body) {
  const resolved = require.resolve(RULES_FILE);
  const migrateResolved = require.resolve(path.join(ROOT, "ofp", "ofp-migrate.js"));
  const originalRules = require.cache[resolved];
  const originalMigrate = require.cache[migrateResolved];
  try {
    const mutated = compileModule(RULES_FILE, mutate(readLF(RULES_FILE), needle, replacement, label));
    delete require.cache[migrateResolved];
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: mutated, paths: [] };
    return body(require(migrateResolved));
  } finally {
    if (originalRules) require.cache[resolved] = originalRules; else delete require.cache[resolved];
    delete require.cache[migrateResolved];
    if (originalMigrate) require.cache[migrateResolved] = originalMigrate;
  }
}

const CLEAN = path.join(__dirname, "fixtures", "ofp-legacy", "clean.json");
const AT = "2026-08-10T00:00:00Z";

async function migrationControls() {
  /* NC-12 — the shot rule stops naming the field, so the route falls to M070's anonymous
     sweep. Nothing is lost, which is exactly why this is worth a control: the loss is of
     the REASON, and a report that cannot say why a value has no home is the difference
     P2 was built to end. */
  await mustFail(
    "NC-12 the shot rule stops naming the route and it falls to the anonymous sweep",
    "claimed by the shot rule by name",
    () => {
      withMutatedRules(
        '"positioning", "safe", "route", "deliveryRoute", "notes"',
        '"positioning", "safe", "route", "notes"',
        "NC-12",
        (Migrate) => {
          const document = JSON.parse(fs.readFileSync(CLEAN, "utf8"));
          document.shots[0].deliveryRoute = "flf";
          const result = Migrate.previewLegacyMigration(document, { at: AT });
          const claim = result.report.accounting.entries.find((entry) => entry.pointer === "/shots/0/deliveryRoute");
          assert.strictEqual(claim.rule, "M005",
            "flf: claimed by the shot rule by name, not swept up anonymously by M070");
        },
      );
    },
  );

  /* NC-13 — migration invents a route from the legacy output-plan field. The fixture's
     own `route` says "GENERATE (FLF)", so a rule that read it would produce a declared
     delivery route in a document whose author never declared one. */
  await mustFail(
    "NC-13 migration derives a delivery route from the legacy output-plan field",
    "must not invent a flf route",
    () => {
      withMutatedRules(
        "        target.push(record);\n        context.registerShot(id, record, from, shot, subject);",
        '        if (typeof shot.route === "string" && shot.route.includes("FLF")) record.deliveryRoute = "flf";\n'
        + "        target.push(record);\n        context.registerShot(id, record, from, shot, subject);",
        "NC-13",
        (Migrate) => {
          const document = JSON.parse(fs.readFileSync(CLEAN, "utf8"));
          document.shots[0].route = "GENERATE (FLF)";
          const result = Migrate.previewLegacyMigration(document, { at: AT });
          assert(!new RegExp('"deliveryRoute"\\s*:\\s*"flf"').test(result.serialized || ""),
            "clean.json: migration must not invent a flf route");
        },
      );
    },
  );
}

/* ===========================================================================
   THE IMPORT BOUNDARY.

   server.js exports nothing and starts listening on load, so its import normaliser is
   reached the way every other suite in this repository reaches one: the declarations are
   lifted out of the real file and evaluated in a sandbox. The file is opened read-only.
   This is deliberately NOT a re-implementation — a copy of the rule under test would
   pass while the shipped rule stayed broken.
   =========================================================================== */

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js no longer declares ${name}; this control must be updated, not deleted`);
  let parens = 0, bodyStart = -1;
  for (let index = source.indexOf("(", start); index < source.length; index++) {
    if (source[index] === "(") parens++;
    else if (source[index] === ")") {
      parens--;
      if (parens === 0) { bodyStart = source.indexOf("{", index); break; }
    }
  }
  assert(bodyStart > 0, `could not find the body of ${name} in server.js`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === "{") { depth++; continue; }
    if (source[index] === "}") { depth--; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`could not find the end of ${name} in server.js`);
}

const IMPORT_HELPERS = ["builderObject", "builderArray", "builderNumber", "builderDuration", "builderLabel",
  "recordPlanningInference", "normalizeBuilderMotionBrief", "normalizeBuilderKeyframes",
  "normalizeBuilderClips", "normalizeBuilderShot"];

function importNormaliser(mutateSource = (source) => source) {
  const { deriveLipSync, lipSyncRequiredFrom } = require("../public/shared-lip-sync");
  const context = vm.createContext({ deriveLipSync, lipSyncRequiredFrom, ShotRoute: Route });
  const declarations = IMPORT_HELPERS.map((name) => extractFunction(SERVER_SOURCE, name)).join("\n");
  vm.runInContext(`${mutateSource(declarations)}\nglobalThis.__shot = normalizeBuilderShot;`, context);
  return context.__shot;
}

function importedShot(normalise, over) {
  const warnings = [];
  const shot = normalise({
    id: "I-1", scene: "SC-01", title: "Dock walk", desc: "Ada walks the dock.",
    positioning: "Locked wide.", dur: 6,
    keyframes: [{ id: "frame-a", label: "A", title: "Opening", description: "Ada at the bollard." }],
    ...over,
  }, 0, warnings, []);
  return { shot, warnings };
}

async function importControls() {
  /* Precondition: the shipped normaliser does what the suite says it does. */
  const shipped = importNormaliser();
  assert.strictEqual(importedShot(shipped, { deliveryRoute: "FLF" }).shot.deliveryRoute, "flf",
    "precondition: the shipped import canonicalises a declared route");

  /* NC-14 — the import stops normalising at all, so a document's own spelling is stored
     verbatim and an unreadable one is kept. */
  await mustFail(
    "NC-14 the import boundary stops normalising a declared route",
    "must import as the canonical",
    () => {
      const broken = importNormaliser((source) => mutate(source,
        "  const routeOutcome = ShotRoute.normaliseStoredShotRoute(normalized);",
        "  const routeOutcome = { dropped: false, stored: null };",
        "NC-14"));
      const { shot } = importedShot(broken, { deliveryRoute: "FLF" });
      assert.strictEqual(shot.deliveryRoute, "flf", "FLF must import as the canonical flf");
    },
  );

  /* NC-15 — the drop stops being reported. The value disappears and the filmmaker is
     never told, which is the quiet loss the whole import review surface exists against. */
  await mustFail(
    "NC-15 an unreadable declaration is dropped silently",
    "the drop must be named",
    () => {
      const broken = importNormaliser((source) => mutate(source,
        "  if (routeOutcome.dropped)\n    warnings.push(",
        "  if (false)\n    warnings.push(",
        "NC-15"));
      const { warnings } = importedShot(broken, { id: "I-BAD", deliveryRoute: "GENERATE (FLF)" });
      assert(warnings.some((line) => /I-BAD/.test(line) && /delivery route/i.test(line)),
        "the drop must be named with its value");
    },
  );

  /* NC-16 — the import invents a route from the legacy output-plan field the same
     document carries. Nothing declared a delivery route; a plan label is not one. */
  await mustFail(
    "NC-16 the import derives a route from the legacy output-plan field",
    "must import declaring nothing",
    () => {
      const broken = importNormaliser((source) => mutate(source,
        "  const routeOutcome = ShotRoute.normaliseStoredShotRoute(normalized);",
        "  if (!normalized.deliveryRoute) normalized.deliveryRoute = ShotRoute.shotRouteFromLegacyOutputRoute(normalized.route).route || undefined;\n"
        + "  const routeOutcome = ShotRoute.normaliseStoredShotRoute(normalized);",
        "NC-16"));
      const { shot } = importedShot(broken, { id: "I-NONE", route: "GENERATE (FLF)" });
      assert(!("deliveryRoute" in shot),
        "a shot that declared nothing must import declaring nothing");
    },
  );
}

/* =========================================================================== */

async function main() {
  await moduleControls();
  await surfaceControls();
  await migrationControls();
  await importControls();

  console.log(`Shot route schema negative controls passed: ${notes.filter((line) => line.includes("failed as required")).length} controls fired.`);
  for (const line of notes) console.log(line);
  console.log("  Every mutation lived in memory; nothing on disk was written.");
  console.log("  Paid calls: 0. Provider calls: 0. Off-site requests: 0.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
