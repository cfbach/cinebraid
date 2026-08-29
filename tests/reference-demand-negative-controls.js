/* CineBraid — Public Alpha UX, Slice 5: NEGATIVE CONTROLS.
 *
 * tests/reference-demand.js asserts that reference demand is demand-driven and
 * that authored structure is reversible. Most of those assertions are the shape
 * that most often CANNOT fail:
 *
 *   "a dormant reference creates zero work"     passes if nothing renders
 *   "the ledger is byte-identical"              passes if nothing runs
 *   "the strip does not say Incomplete"         passes against a missing strip
 *   "no route narrows entity demand"            passes if every set is empty
 *   "clearing a location clears the codes"      passes if the writer is a no-op
 *
 * So every control here breaks the product deliberately, in memory or in a
 * temporarily patched file, and requires the corresponding assertion to catch
 * it. Each control PROVES the break landed and prints the literal bad state
 * before it judges the detector — `assertion-probe receipts self-defeat` is a
 * real repository lesson: a probe guarded by the same assert() it is testing
 * reports success while mutating nothing.
 *
 *   NC-REF1   the demand gate is removed, so a dormant character owes a backlog
 *   NC-REF2   demand is asserted for every reference, so a dormant Location owes one
 *   NC-REF3   clearing a Location silently fails and the old plate stays selected
 *   NC-REF4   clearing a Location revokes the location's Canon
 *   NC-REF5   a route with no reference requirement inherits the generic ones
 *   NC-REF6   demand reads the wider dependency record, so a stale declaration
 *             keeps a removed relationship's reference work alive
 *   NC-REF7   demand is counted per demanding shot, so two shots double the work
 *   NC-REF8   the reference strip calls dormant capability Incomplete / missing
 *   NC-REF9   clearing a Location leaves its code token, so the requirement and
 *             its confirmation survive the clear
 *   NC-REF10  clearing a Location destroys the shot's approved frames
 *   NC-REF11  the state-declaration chooser disables its empty option again
 *   NC-REF12  the derived demand answer is persisted onto the slot
 *   NC-REF13  a relation that already shipped a way out becomes one-way, and the
 *             reversibility census must notice
 *   NC-REF14  an ambiguous CHAR / CHAR-A dependency becomes false-known dormant
 *   NC-REF15  a malformed dependency collection becomes known dormant
 *   NC-REF16  a vehicleIds-only vehicle renders unselected and cannot be cleared
 *   NC-REF17  a satisfied entity still claims its whole coverage template is due
 *   NC-REF18  a confirmation the queue holds is dropped from reference demand
 *   NC-REF19  a cleared primary Location is overwritten by a supporting one
 *   NC-REF20  a suffixed Vehicle code reads as picker-owned and Clear destroys it
 *   NC-REF21  a suffixed Prop code loses its suffix through picker Clear
 *   NC-REF22  an explicit selection over a suffixed code overwrites it
 *   NC-REF23  clearing the explicit layer takes the code-backed relation too
 *   NC-REF24  No location deletes LOC-HULL-A
 *   NC-REF25  the surviving suffixed Location is promoted back to primary
 *
 * Nothing here contacts a provider, spends anything, or writes to a project.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
/* LF, always. `core.autocrlf=true` is set in this repository, so a source edit
   matched against a CRLF checkout silently applies to nothing. */
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const suite = require("./reference-demand");
const { render, buildFixture } = require("./render-harness");

const results = [];
const literals = [];

/* ---------------------------------------------------------------- machinery */

/* Require a body to throw an AssertionError. A control that passes here has
   proved its detector fires; a control that does NOT throw has found a blind
   spot and fails this suite. */
async function expectRed(id, body) {
  let threw = null;
  try { await body(); } catch (error) { threw = error; }
  assert.ok(threw, `${id}: the defect was introduced and NOTHING caught it — that assertion cannot fail`);
  assert.ok(threw instanceof assert.AssertionError || /AssertionError/.test(String(threw && threw.name)),
    `${id}: the detector must fail by assertion, not by crashing (${threw && threw.message})`);
  return threw;
}

/* A browser-side mutation applied through the render harness's `mutateSource`
   hook: the file on disk is untouched and the patched text is evaluated only
   inside this render. `applied` records which files the harness actually
   evaluated, so a typo in a filename cannot mutate nothing and look like a pass.

   ANCHORS ARE NORMALISED TO LF BEFORE MATCHING. A `\n` in a source anchor
   matches zero times in a normal Windows checkout, which aborts the control and
   everything behind it. */
function sourceMutator(editsByFile) {
  const applied = new Set();
  const mutate = (file, original) => {
    const edits = editsByFile[file] || editsByFile[path.basename(file)];
    if (!edits) return original;
    let code = original.replace(/\r\n/g, "\n");
    for (const [from, to] of edits) {
      assert.ok(code.includes(from), `browser patch target not found in ${file}: ${from.slice(0, 90)}`);
      code = code.replace(from, to);
    }
    applied.add(path.basename(file));
    return code;
  };
  mutate.applied = applied;
  mutate.expected = Object.keys(editsByFile).map((f) => path.basename(f));
  return mutate;
}

/* Some modules are read through `require`, not through the render harness, so a
   control that has to reach one patches the file on disk and restores the
   ORIGINAL BYTES from memory in a finally. Never `git checkout` — the repository
   has already lost unstaged work that way. */
async function patchedFile(file, edits, body) {
  const absolute = path.join(ROOT, file);
  const original = fs.readFileSync(absolute, "utf8");
  let next = original.replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    assert.ok(next.includes(from), `patch target not found in ${file}: ${from.slice(0, 90)}`);
    next = next.replace(from, to);
  }
  const dropCaches = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.includes("shared-coverage") || key.includes("shared-entities") || key.includes("reference-demand")) {
        delete require.cache[key];
      }
    }
  };
  fs.writeFileSync(absolute, next);
  dropCaches();
  try { await body(); } finally {
    fs.writeFileSync(absolute, original);
    dropCaches();
  }
}

async function control({ id, defect, run }) {
  await run();
  results.push(`${id} · ${defect}`);
}

/* Arm the mutation, PROVE it landed AND print what it produced, then require the
   detector to catch it. The probe must not share an assertion with the guard, or
   it would be self-proving. */
async function browserControl({ id, defect, editsByFile, probe, guard }) {
  await control({
    id,
    defect,
    run: async () => {
      const mutate = sourceMutator(editsByFile);
      const literal = await probe(mutate);
      for (const file of mutate.expected) {
        assert.ok(mutate.applied.has(file), `${id}: ${file} was never evaluated, so the defect never ran`);
      }
      if (literal) literals.push(`${id} → ${literal}`);
      await expectRed(id, () => guard(sourceMutator(editsByFile)));
    },
  });
}

/* A FILE control. The render harness's `mutateSource` hook reaches only code the
   PAGE evaluates; a detector that asserts on a module through `require` — as the
   fail-closed section does on public/shared-entities.js — would judge the
   unpatched copy and report a caught defect that never ran. So the file is
   patched on disk for the duration, its original bytes restored in a finally, and
   both the probe and the guard see the same broken product. */
async function fileControl({ id, defect, file, edits, probe, guard }) {
  await control({
    id,
    defect,
    run: async () => {
      await patchedFile(file, edits, async () => {
        const literal = await probe();
        if (literal) literals.push(`${id} → ${literal}`);
        await expectRed(id, () => guard());
      });
    },
  });
}

/* Re-require the suite so it is bound to whatever the patched modules now say.
   Without this a file-level control judges a detector that closed over the
   unpatched copy. */
const freshSuite = () => {
  delete require.cache[require.resolve("./reference-demand")];
  return require("./reference-demand");
};

const dormantCharacter = () => suite.demandFixture({ cast: false });
const dormantLocation = () => suite.demandFixture({ cast: false, list: "locations", id: "RD-LOC" });

/* ==================================================================== NC-REF1
   THE HEADLINE DEFECT. Without the gate, existence is demand again. */
async function nc1() {
  await browserControl({
    id: "NC-REF1",
    defect: "the demand gate is removed, so a dormant character owes a mandatory backlog",
    /* BOTH GATES, because there are two now and either one alone holds the line.
       shared-coverage.js decides whether a reference nothing uses may be stood
       down; entities.js decides whether a coverage slot may be current work at
       all. The defect this control is named for — existence read as demand — takes
       both, and arming only one would report a caught defect that never ran. */
    editsByFile: {
      "shared-coverage.js": [[
        `    if (production.known === true && production.demanded !== true)
      return { state: "available", tier, basis: "no-current-production-demand", demanded: false };`,
        `    if (false)
      return { state: "available", tier, basis: "no-current-production-demand", demanded: false };`,
      ]],
      /* THE ANCHOR MOVED WITH THE SEAM. The obligation set is now built by
         obligationStateIds() — one derivation for the panel AND for the coverage
         board's slot chip — so disabling it here disables it for both, which is a
         strictly wider defect than the inline version this control used to arm. */
      "entities.js": [[
        `  return obligations && obligations.known === true
    ? new Set((obligations.rows || []).map((row) => String(row.stateId || "")))
    : null;`,
        `  void obligations; return null;`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await suite.referenceSurface(dormantCharacter(), { mutateSource: mutate });
      const counts = suite.demandCounts(rendered.html);
      const headline = suite.demandHeadline(rendered.html);
      assert.ok(counts.now > 0,
        "NC-REF1 probe: the dormant character was expected to report current required work");
      assert.ok(/required reference/.test(headline),
        `NC-REF1 probe: the backlog headline was expected, got "${headline}"`);
      assert.strictEqual(counts.production, "dormant",
        "NC-REF1 probe: and the surface must still KNOW nothing uses it — that is the contradiction");
      return `"${headline}" beside data-demand-production="dormant" (now=${counts.now})`;
    },
    guard: (mutate) => freshSuite().demandMatrixSection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF2
   The other half of the same defect, entered through the owner instead. */
async function nc2() {
  await browserControl({
    id: "NC-REF2",
    defect: "the demand owner claims every reference is used, so a dormant Location owes a backlog",
    editsByFile: {
      "shared-entities.js": [[
        `  if (shotIds.length) return { known: true, demanded: true, shotIds, uncertain, total: shots.length };`,
        `  if (true) return { known: true, demanded: true, shotIds, uncertain, total: shots.length };`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await suite.referenceSurface(dormantLocation(),
        { list: "locations", id: "RD-LOC", mutateSource: mutate });
      const counts = suite.demandCounts(rendered.html);
      const headline = suite.demandHeadline(rendered.html);
      /* The obligation gate keeps the COUNT honest even here — readiness owes
         nothing for a location no shot uses — so what this defect produces is a
         surface claiming usage the project does not support, in its own words. */
      assert.strictEqual(counts.production, "demanded",
        "NC-REF2 probe: the dormant location was expected to be reported as used");
      assert.ok(!/No shot uses this location yet/.test(headline),
        `NC-REF2 probe: and to stop saying nothing uses it, got "${headline}"`);
      assert.ok(/Used by 0 shots\./.test(rendered.html),
        "NC-REF2 probe: printing a usage sentence no shot supports");
      return `a location no shot uses reports production="demanded" and the sentence "Used by 0 shots." beside `
        + `the headline "${headline}"`;
    },
    guard: (mutate) => freshSuite().demandMatrixSection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF3
   Sticky structure, restored: the control renders and does nothing. */
async function nc3() {
  await browserControl({
    id: "NC-REF3",
    defect: "clearing a Location silently fails and the old plate stays selected",
    editsByFile: {
      "creation-studio.js": [[
        `  const s = shotById(id), c = ensureShotCreation(s), previous = c.locationId || "";
  s.codes = Array.isArray(s.codes) ? s.codes : [];`,
        `  const s = shotById(id), c = ensureShotCreation(s), previous = c.locationId || "";
  if (!String(value || "").trim()) return;
  s.codes = Array.isArray(s.codes) ? s.codes : [];`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: mutate,
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      });
      vm.runInContext("setShotCreationLocation('L1-01','')", rendered.context);
      const state = JSON.parse(vm.runInContext(`JSON.stringify({
        locationId: P.shots[0].creationBrief.locationId || "",
        codes: P.shots[0].codes,
      })`, rendered.context));
      assert.strictEqual(state.locationId, "LOC-HULL",
        "NC-REF3 probe: the location was expected to survive the clear");
      return `after clicking "No location": creationBrief.locationId="${state.locationId}", codes=${JSON.stringify(state.codes)}`;
    },
    guard: (mutate) => freshSuite().locationSection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF4
   Structure and authority collapsed: a relationship edit revokes Canon. */
async function nc4() {
  await browserControl({
    id: "NC-REF4",
    defect: "clearing a Location revokes the location's Canon receipt",
    editsByFile: {
      "creation-studio.js": [[
        `  c.locationId = value;`,
        `  c.locationId = value;
  if (!value && previous && P.productionAuthority && Array.isArray(P.productionAuthority.receipts)) {
    P.productionAuthority.receipts = P.productionAuthority.receipts.filter((row) => row && row.entityId !== previous);
  }`,
      ]],
    },
    probe: async (mutate) => {
      const project = require("./render-harness").withCanon(buildFixture(), [
        { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
      ]);
      const rendered = await render("#/shot/L1-01", project, {
        mutateSource: mutate,
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      });
      const before = Number(vm.runInContext("P.productionAuthority.receipts.length", rendered.context));
      vm.runInContext("setShotCreationLocation('L1-01','')", rendered.context);
      const after = Number(vm.runInContext("P.productionAuthority.receipts.length", rendered.context));
      const canon = vm.runInContext(`!!currentHumanAuthority(P, { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default" })`, rendered.context);
      assert.ok(after < before, "NC-REF4 probe: a receipt was expected to be destroyed by the structural edit");
      assert.strictEqual(canon, false, "NC-REF4 probe: and the location's Canon to be gone with it");
      return `receipts ${before} -> ${after}; currentHumanAuthority(LOC-HULL/state-default) = ${canon}`;
    },
    guard: (mutate) => freshSuite().authoritySection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF5
   Every route treated as the generic union, so a route that needs no frame
   inherits the mandatory inputs of the ones that do. */
async function nc5() {
  await browserControl({
    id: "NC-REF5",
    defect: "a route with no reference requirement inherits the generic mandatory inputs",
    editsByFile: {
      "shared-shot-readiness.js": [[
        `    const namedMode = shotRouteGenerationModeOwner(route);
    const modes = namedMode ? [namedMode] : [...ANIMATE_METHODS];`,
        `    const namedMode = shotRouteGenerationModeOwner(route);
    void namedMode;
    const modes = [...ANIMATE_METHODS];`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/production", buildFixture(), { mutateSource: mutate });
      vm.runInContext(`P.shots[0].deliveryRoute = "t2v";`, rendered.context);
      const required = JSON.parse(vm.runInContext(
        `JSON.stringify(evaluateShotReadiness(P, P.shots[0]).units.filter((u) => u.required).map((u) => u.id))`,
        rendered.context));
      assert.ok(required.some((id) => id.startsWith("frame:")),
        "NC-REF5 probe: t2v was expected to inherit a frame requirement it does not have");
      return `route=t2v now requires ${JSON.stringify(required.filter((id) => id.startsWith("frame:")))}`;
    },
    guard: (mutate) => freshSuite().routeSection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF6
   Demand widened to the whole dependency record, so a declaration left behind by
   a relationship that no longer exists keeps its reference work alive. */
async function nc6() {
  await browserControl({
    id: "NC-REF6",
    defect: "a stale declaration keeps a removed relationship's required reference work alive",
    editsByFile: {
      "shared-entities.js": [[
        `  const uses = shotStateBearingEntityRecords(project, shot).some((row) =>`,
        `  const uses = shotDependencyRecords(project, shot).some((row) =>`,
      ]],
    },
    probe: async (mutate) => {
      const project = dormantCharacter();
      project.shots[0].continuityStateSelections = { "RD-CHAR": "state-default" };
      const rendered = await suite.referenceSurface(project, { mutateSource: mutate });
      const counts = suite.demandCounts(rendered.html);
      /* The obligation gate keeps the COUNT honest — readiness raises nothing for
         a declaration-only entity — so what the wider record produces is a surface
         asserting a relationship the project does not have. */
      assert.strictEqual(counts.production, "demanded",
        "NC-REF6 probe: the declaration-only reference was expected to read as demanded");
      assert.ok(!/No shot uses this character yet/.test(suite.demandHeadline(rendered.html)),
        "NC-REF6 probe: and to stop reporting itself dormant");
      return `no shot relates to RD-CHAR, yet a leftover continuityStateSelections key makes the surface claim `
        + `it is used — headline "${suite.demandHeadline(rendered.html)}", production=demanded`;
    },
    guard: (mutate) => freshSuite().demandMatrixSection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF7
   Demand counted per demanding shot, so shared work is asked for twice. */
async function nc7() {
  await browserControl({
    id: "NC-REF7",
    defect: "one reference used by two shots is asked for once per shot",
    /* Grouped by shot instead of by authority target. Six shots naming one
       reference is one decision, and the Historic confirmation queue has grouped
       it that way since Slice 1; this makes the reference surface disagree. */
    editsByFile: {
      "app.js": [[
        `        const key = String(row.targetKey || target.key || "");`,
        `        const key = \`\${shot.id}:\${String(row.targetKey || target.key || "")}\`;`,
      ]],
    },
    probe: async (mutate) => {
      const shared = require("./render-harness").withCanon(buildFixture(), [
        { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
        { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
      ]);
      shared.characters[0].continuityStates = [
        { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
      ];
      const single = JSON.parse(JSON.stringify(shared));
      shared.shots.push({ ...JSON.parse(JSON.stringify(shared.shots[0])), id: "L1-02" });
      const one = suite.demandCounts((await suite.referenceSurface(single, { id: "KAI", mutateSource: mutate })).html);
      const two = suite.demandCounts((await suite.referenceSurface(shared, { id: "KAI", mutateSource: mutate })).html);
      assert.strictEqual(one.now, 1, "NC-REF7 probe: (precondition) one shot owes one decision");
      assert.ok(two.now > one.now,
        `NC-REF7 probe: the second shot was expected to duplicate the decision (${one.now} -> ${two.now})`);
      return `one unconfirmed reference owed by one shot reads ${one.now} decision; the SAME reference shared by `
        + `two shots reads ${two.now}`;
    },
    guard: (mutate) => freshSuite().agreementMatrixSection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF8
   The copy defect on its own: the strip calls dormant capability Incomplete. */
async function nc8() {
  await browserControl({
    id: "NC-REF8",
    defect: "the reference strip labels a dormant capability Incomplete and counts missing required views",
    editsByFile: {
      "entities.js": [[
        `    if (owed !== null) {`,
        `    if (false) {`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await suite.referenceSurface(dormantCharacter(), { mutateSource: mutate });
      const task = suite.coverageTaskButton(rendered.html);
      assert.ok(task, "NC-REF8 probe: the coverage task must render");
      assert.strictEqual(task.status, "Incomplete",
        `NC-REF8 probe: the strip was expected to say Incomplete, got "${task.status}"`);
      assert.ok(/\d+ required view/.test(task.note),
        `NC-REF8 probe: and to count required views, got "${task.note}"`);
      return `strip reads "${task.status} · ${task.note}" for a reference no shot uses`;
    },
    guard: (mutate) => freshSuite().agreementSection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF9
   Half a clear: the code token survives, so the requirement — and the human
   confirmation it asks for — outlive the structure that produced them. */
async function nc9() {
  await browserControl({
    id: "NC-REF9",
    defect: "clearing a Location leaves its code token, so its requirement survives the clear",
    editsByFile: {
      "creation-studio.js": [[
        `  if (previous && previous !== value && !selectingAttachedLocation)
    s.codes = guidedCodesWithoutExactToken(s, previous);`,
        `  if (previous && previous !== value && !selectingAttachedLocation && value)
    s.codes = guidedCodesWithoutExactToken(s, previous);`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: mutate,
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      });
      vm.runInContext("setShotCreationLocation('L1-01','')", rendered.context);
      const after = JSON.parse(vm.runInContext(`JSON.stringify({
        locationId: P.shots[0].creationBrief.locationId || "",
        codes: P.shots[0].codes,
        resolved: resolveShotEntities(P, P.shots[0]).locations.map((row) => row.id),
        requirements: evaluateShotReadiness(P, P.shots[0]).units.flatMap((u) => u.requirements)
          .filter((row) => String(row.id || "").includes("LOC-HULL")).map((row) => row.reason),
      })`, rendered.context));
      assert.ok(after.resolved.includes("LOC-HULL"),
        "NC-REF9 probe: the location was expected to survive as a code token");
      assert.ok(after.requirements.length,
        "NC-REF9 probe: and to keep asking the filmmaker to confirm its reference");
      return `locationId="" but codes=${JSON.stringify(after.codes)} still resolves ${JSON.stringify(after.resolved)}, `
        + `leaving ${after.requirements.length} outstanding ${JSON.stringify([...new Set(after.requirements)])} requirement(s)`;
    },
    guard: (mutate) => freshSuite().locationSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF10
   A destructive cascade: a structural edit reaching the shot's own media. */
async function nc10() {
  await browserControl({
    id: "NC-REF10",
    defect: "clearing a Location destroys the shot's approved frames",
    editsByFile: {
      "creation-studio.js": [[
        `  if (previous && typeof clearDetachedShotStateDeclaration === "function")
    clearDetachedShotStateDeclaration(P, { shotId: id, entityId: previous });`,
        `  if (!value) for (const frame of (s.keyframes || [])) frame.winner = "";
  if (previous && typeof clearDetachedShotStateDeclaration === "function")
    clearDetachedShotStateDeclaration(P, { shotId: id, entityId: previous });`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: mutate,
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      });
      const before = JSON.parse(vm.runInContext("JSON.stringify(P.shots[0].keyframes.map((f) => f.winner))", rendered.context));
      vm.runInContext("setShotCreationLocation('L1-01','')", rendered.context);
      const after = JSON.parse(vm.runInContext("JSON.stringify(P.shots[0].keyframes.map((f) => f.winner))", rendered.context));
      assert.notDeepStrictEqual(before, after, "NC-REF10 probe: the shot's approved frames were expected to be destroyed");
      return `keyframe winners ${JSON.stringify(before)} -> ${JSON.stringify(after)} on a relationship edit`;
    },
    guard: (mutate) => freshSuite().authoritySection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF11
   The second sticky structure, restored. */
async function nc11() {
  await browserControl({
    id: "NC-REF11",
    defect: "the shot continuity-state chooser disables its empty option, so a declaration is permanent again",
    editsByFile: {
      "creation-studio.js": [[
        `<option value="" \${selected ? "" : "selected"}>`,
        `<option value="" disabled \${selected ? "" : "selected"}>`,
      ]],
    },
    probe: async (mutate) => {
      const project = buildFixture();
      project.characters[0].continuityStates = [
        { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
        { id: "state-soot", name: "Sooty", isDefault: false, parentStateId: "state-default" },
      ];
      project.shots[0].continuityStateSelections = { KAI: "state-soot" };
      const rendered = await render("#/shot/L1-01", project, {
        mutateSource: mutate,
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      });
      const row = /<article data-shot-state-entity="KAI"[\s\S]*?<\/article>/.exec(rendered.html);
      assert.ok(row, "NC-REF11 probe: the declaration row must render");
      const empty = /<option value=""([^>]*)>([^<]*)<\/option>/.exec(row[0]);
      assert.ok(empty && /\bdisabled\b/.test(empty[1]),
        "NC-REF11 probe: the empty option was expected to be disabled again");
      return `the only option that clears a declaration renders as <option value=""${empty[1]}>${empty[2]}</option>`;
    },
    guard: (mutate) => freshSuite().stateDeclarationSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF12
   The persistence detector actually detects. A derived answer written beside the
   fact it came from is exactly the drift shared-coverage.js exists to prevent,
   and it goes stale the moment a shot changes. Patched on disk, because the
   invariant section reads the file rather than the render. */
async function nc12() {
  await control({
    id: "NC-REF12",
    defect: "the derived demand answer is persisted onto the slot beside the fact it came from",
    run: async () => {
      await patchedFile("public/entities.js", [[
        `    return { ...row, demandState: resolved.state, demandBasis: resolved.basis, productionDemanded: resolved.demanded };`,
        `    row.demandState = resolved.state;
    return { ...row, demandState: resolved.state, demandBasis: resolved.basis, productionDemanded: resolved.demanded };`,
      ]], async () => {
        const patched = readLF("public/entities.js");
        assert.ok(/row\.demandState\s*=(?!=)/.test(patched),
          "NC-REF12 probe: the persistence was expected to be present in the file the detector reads");
        literals.push("NC-REF12 → public/entities.js now contains `row.demandState = resolved.state;`, "
          + "a derived answer written onto the row it was derived from");
        await expectRed("NC-REF12", () => freshSuite().invariantSection());
      });
      /* And the file is back. A control that left this behind would poison every
         later suite in the run. */
      assert.ok(!/row\.demandState\s*=(?!=)/.test(readLF("public/entities.js")),
        "NC-REF12: public/entities.js was left patched");
    },
  });
}

/* =================================================================== NC-REF13
   The reversibility SURVEY actually surveys. Its claim is a census over seven
   relations, and a census whose detectors cannot fail is a list of names. This
   makes one relation that already shipped a way out one-way again, and requires
   the census to notice — proving the other six entries are measurements too. */
async function nc13() {
  await browserControl({
    id: "NC-REF13",
    defect: "casting a character becomes one-way, so a shot can gain a cast member and never lose one",
    editsByFile: {
      "mutations.js": [[
        `window.toggleShotChar = (id, cid) => {`,
        `window.toggleShotChar = (id, cid) => {
  { const only = shotById(id); if (only && !(only.characters || []).includes(cid)) { only.characters = [...(only.characters || []), cid]; dirty(); route(); } return; }`,
      ]],
      "creation-studio.js": [[
        `onclick="\${list === "characters" ? \`toggleShotCreationCharacter('\${s.id}','\${x.id}')\``,
        `onclick="\${list === "characters" ? \`attachShotCreationCharacter('\${s.id}','\${x.id}')\``,
      ]],
    },
    probe: async (mutate) => {
      const project = buildFixture();
      project.shots[0].characters = ["KAI"];
      const rendered = await render("#/shot/L1-01", project, {
        mutateSource: mutate,
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      });
      const onclick = /onclick="([a-zA-Z]+ShotCreationCharacter\('L1-01','KAI'\))"/.exec(rendered.html);
      assert.ok(onclick, "NC-REF13 probe: the cast control must still render");
      assert.ok(!/^toggle/.test(onclick[1]),
        `NC-REF13 probe: the cast control was expected to stop being a toggle, got ${onclick[1]}`);
      /* And it really is one-way now, exercised rather than read. */
      vm.runInContext("toggleShotChar('L1-01','KAI')", rendered.context);
      const still = JSON.parse(vm.runInContext("JSON.stringify(P.shots[0].characters)", rendered.context));
      assert.ok(still.includes("KAI"),
        "NC-REF13 probe: and asking to remove the character was expected to leave it attached");
      return `the cast control renders as ${onclick[1]}, and asking to remove KAI leaves characters=${JSON.stringify(still)}`;
    },
    guard: (mutate) => freshSuite().reversibilitySurvey({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF14
   FAIL-CLOSED, ENTERED THROUGH THE AMBIGUITY THE PROJECT ITSELF REPORTS.
   The reproduced defect: with CHAR and CHAR-A both present and a shot code of
   "CHAR-A", the resolver takes CHAR and the demand owner used to read that as a
   positive absence for CHAR-A. This restores exactly that reading. */
async function nc14() {
  await fileControl({
    id: "NC-REF14",
    defect: "an ambiguous CHAR / CHAR-A dependency becomes a false-known dormant answer",
    file: "public/shared-entities.js",
    edits: [[
      `    if (status === "unresolved" || namesThis) return { reading: "unknown", reason: \`lossy-code-token:\${status}\` };`,
      `    void namesThis; void status;`,
    ]],
    probe: async () => {
      const project = suite.demandFixture({ cast: false, id: "CHAR-A" });
      project.characters = [
        { id: "CHAR", name: "Char", continuityStates: [], coverageSlots: suite.slotSet(["front"]) },
        { id: "CHAR-A", name: "Char A", continuityStates: [], coverageSlots: suite.slotSet(["front"]) },
      ];
      project.shots[0].characters = [];
      project.shots[0].codes = ["CHAR-A"];
      const rendered = await freshSuite().referenceSurface(project, { id: "CHAR-A" });
      const counts = freshSuite().demandCounts(rendered.html);
      const headline = freshSuite().demandHeadline(rendered.html);
      assert.strictEqual(counts.production, "dormant",
        "NC-REF14 probe: CHAR-A was expected to be reported as positively unused");
      assert.ok(/No shot uses this character yet/.test(headline),
        `NC-REF14 probe: and told so in as many words, got "${headline}"`);
      return `the project's own classifier calls the token AMBIGUOUS between CHAR and CHAR-A, and the surface `
        + `answers "${headline}" (production=dormant)`;
    },
    guard: () => freshSuite().failClosedSection(),
  });
}

/* =================================================================== NC-REF15
   The other half: a collection the resolver silently skips read as a collection
   that named nothing. */
async function nc15() {
  await fileControl({
    id: "NC-REF15",
    defect: "a malformed dependency collection becomes a known dormant answer",
    file: "public/shared-entities.js",
    edits: [[
      `  if (!shotDependencyReadingIsWellFormed(shot)) return { reading: "unknown", reason: "malformed-dependency-collection" };`,
      `  void shotDependencyReadingIsWellFormed;`,
    ]],
    probe: async () => {
      const fresh = freshSuite();
      const project = fresh.demandFixture({ cast: true });
      /* The relationship is real and the collection holding it is damaged. */
      project.shots[0].characters = "RD-CHAR";
      const rendered = await fresh.referenceSurface(project);
      const counts = fresh.demandCounts(rendered.html);
      assert.strictEqual(counts.production, "dormant",
        "NC-REF15 probe: the damaged collection was expected to read as a positive absence");
      return `shot.characters is the string "RD-CHAR" rather than a list, the resolver skips it, and the surface `
        + `answers "${fresh.demandHeadline(rendered.html)}"`;
    },
    guard: () => freshSuite().failClosedSection(),
  });
}

/* =================================================================== NC-REF16
   The sticky vehicle, restored: the picker reads one dialect again. */
async function nc16() {
  await browserControl({
    id: "NC-REF16",
    defect: "a vehicleIds-only vehicle renders unselected and cannot be cleared",
    editsByFile: {
      /* BOTH HALVES, which is exactly the pre-repair state: the picker could not
         SEE the vehicleIds relationship and could not WRITE to it either, so the
         attachment was invisible and the control that looked like it removed the
         vehicle removed a different encoding. */
      "creation-studio.js": [[
        `  for (const id of Array.isArray(brief.vehicleIds) ? brief.vehicleIds : []) ids.add(String(id));`,
        `  void brief.vehicleIds;`,
      ], [
        `    if (vehicleIds.length) c.vehicleIds = vehicleIds.filter((x) => x !== propId);`,
        `    void vehicleIds;`,
      ]],
    },
    probe: async (mutate) => {
      const project = buildFixture();
      project.vehicles = [{ id: "VEH-CENSUS", name: "Census tug", continuityStates: [], coverageSlots: [] }];
      project.shots[0].codes = [];
      project.shots[0].characters = [];
      project.shots[0].creationBrief = { locationId: "", propIds: [], vehicleIds: ["VEH-CENSUS"] };
      const rendered = await render("#/shot/L1-01", project, {
        mutateSource: mutate,
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      });
      const cls = /class="guided-asset-choice ([^"]*)"[^>]*onclick="toggleShotCreationProp\('L1-01','VEH-CENSUS'\)"/.exec(rendered.html);
      assert.ok(cls, "NC-REF16 probe: the vehicle must still render");
      assert.ok(!/\bon\b/.test(cls[1]),
        `NC-REF16 probe: it was expected to render UNSELECTED, got class "${cls[1]}"`);
      vm.runInContext("toggleShotCreationProp('L1-01','VEH-CENSUS')", rendered.context);
      vm.runInContext("toggleShotCreationProp('L1-01','VEH-CENSUS')", rendered.context);
      const after = JSON.parse(vm.runInContext(`JSON.stringify({
        propIds: P.shots[0].creationBrief.propIds, vehicleIds: P.shots[0].creationBrief.vehicleIds,
        demanded: entityReferenceDemand(P, "vehicle", "VEH-CENSUS").demanded })`, rendered.context));
      assert.ok(after.vehicleIds.includes("VEH-CENSUS") && after.demanded,
        "NC-REF16 probe: and two clicks were expected to leave the real relationship untouched");
      return `renders class="${cls[1]}" (not selected); after two clicks vehicleIds=${JSON.stringify(after.vehicleIds)} `
        + `and the vehicle is still demanded`;
    },
    guard: (mutate) => freshSuite().vehicleDialectSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF17
   THE HEADLINE CONTRADICTION. The surface counts the entity's coverage template
   again while Production owes nothing. */
async function nc17() {
  await browserControl({
    id: "NC-REF17",
    defect: "an active entity whose readiness is satisfied still claims its whole coverage template is required now",
    editsByFile: {
      /* THE ANCHOR MOVED WITH THE SEAM. The obligation set is now built by
         obligationStateIds() — one derivation for the panel AND for the coverage
         board's slot chip — so disabling it here disables it for both, which is a
         strictly wider defect than the inline version this control used to arm. */
      "entities.js": [[
        `  return obligations && obligations.known === true
    ? new Set((obligations.rows || []).map((row) => String(row.stateId || "")))
    : null;`,
        `  void obligations; return null;`,
      ]],
    },
    probe: async (mutate) => {
      const project = require("./render-harness").withCanon(buildFixture(), [
        { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
        { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
        { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
      ]);
      project.characters[0].continuityStates = [
        { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
      ];
      const rendered = await suite.referenceSurface(project, { id: "KAI", mutateSource: mutate });
      const counts = suite.demandCounts(rendered.html);
      const headline = suite.demandHeadline(rendered.html);
      assert.ok(counts.now >= 8,
        `NC-REF17 probe: the whole template was expected to read as current work, got ${counts.now}`);
      const production = await render("#/production", project, { mutateSource: mutate });
      const next = vm.runInContext("(projectNextProductionAction() || {}).actionLabel || ''", production.context);
      const blockers = vm.runInContext("JSON.stringify(projectSharedBlockers(projectShotReadiness()).map((r) => r.key))", production.context);
      assert.strictEqual(blockers, "[]",
        "NC-REF17 probe: while Production must genuinely be blocked by nothing, or there is no contradiction");
      return `the reference surface says "${headline}" while Production says ${next} with blockers ${blockers}`;
    },
    guard: (mutate) => freshSuite().agreementMatrixSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF18
   The mirror: an obligation the confirmation queue holds is dropped from the
   reference surface, so the two disagree in the other direction. */
async function nc18() {
  await browserControl({
    id: "NC-REF18",
    defect: "a historic reference awaiting confirmation is omitted from current reference demand",
    editsByFile: {
      "entities.js": [[
        `  const covered = new Set(rows.filter((row) => row.family === "state").map((row) => String(row.id)));`,
        `  const covered = new Set((obligations.rows || []).map((row) => String(row.stateId || ""))); void rows;`,
      ]],
    },
    probe: async (mutate) => {
      const project = require("./render-harness").withCanon(buildFixture(), [
        { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
        { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
      ]);
      project.characters[0].continuityStates = [
        { id: "state-default", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
      ];
      const rendered = await suite.referenceSurface(project, { id: "KAI", mutateSource: mutate });
      const counts = suite.demandCounts(rendered.html);
      const production = await render("#/production", project, { mutateSource: mutate });
      const queue = JSON.parse(vm.runInContext(
        "JSON.stringify(((projectShotReadiness().historic || {}).items || []).map((r) => r.key))", production.context));
      assert.strictEqual(counts.now, 0,
        `NC-REF18 probe: the reference surface was expected to claim no current work, got ${counts.now}`);
      assert.ok(queue.some((key) => key.includes("characters:KAI")),
        "NC-REF18 probe: while the confirmation queue still holds the very same decision");
      return `reference surface says 0 current required references — "${suite.demandHeadline(rendered.html)}" — `
        + `while the confirmation queue holds ${JSON.stringify(queue)}`;
    },
    guard: (mutate) => freshSuite().agreementMatrixSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF19
   The cleared primary, promoted back by the next normalisation. */
async function nc19() {
  await browserControl({
    id: "NC-REF19",
    defect: "an explicitly cleared primary Location is overwritten by a supporting location on normalisation",
    editsByFile: {
      "app.js": [[
        `      && s.creationBrief[SHOT_NO_PRIMARY_LOCATION_KEY] !== true) {`,
        `      && true) {`,
      ]],
    },
    probe: async (mutate) => {
      const project = buildFixture();
      project.locations.push({
        id: "LOC-SUPPORT", name: "Support bay", status: "APPROVED", workflowStatus: "APPROVED",
        notes: "", approvedFile: "LOC-SUPPORT-PLATE.png", continuityStates: [],
      });
      project.shots[0].codes = ["LOC-HULL", "LOC-SUPPORT", "PR-TOOL"];
      project.shots[0].creationBrief = { locationId: "LOC-HULL", propIds: [], promptBuilds: [], mode: "auto" };
      const rendered = await render("#/shot/L1-01", project, {
        mutateSource: mutate,
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      });
      const read = () => vm.runInContext("P.shots[0].creationBrief.locationId || ''", rendered.context);
      const before = read();
      vm.runInContext("setShotCreationLocation('L1-01','')", rendered.context);
      const cleared = read();
      vm.runInContext("normalizeShotV5(P.shots[0])", rendered.context);
      const after = read();
      assert.strictEqual(cleared, "", "NC-REF19 probe: the clear must land before normalisation undoes it");
      assert.strictEqual(after, "LOC-SUPPORT",
        `NC-REF19 probe: the support was expected to be promoted into the cleared primary, got ${after || "(empty)"}`);
      return `primary "${before}" -> cleared to "" -> normalizeShotV5 promotes the SUPPORTING location to "${after}"`;
    },
    guard: (mutate) => freshSuite().locationDurabilitySection({ mutateSource: mutate }),
  });
}

/* ------------------------------------------- relationship-ownership fixtures */
const OWNERSHIP_CANON = [
  { kind: "entity-state", list: "props", entityId: "PROP-Y", stateId: "state-default", value: "PROP-Y.png" },
  { kind: "entity-state", list: "vehicles", entityId: "VEH-X", stateId: "state-default", value: "VEH-X.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
];
function ownershipProject({ codes = [], brief = {} } = {}) {
  const project = require("./render-harness").withCanon(buildFixture(), OWNERSHIP_CANON);
  project.props = [{ id: "PROP-Y", name: "Crate", approvedFile: "PROP-Y.png",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "PROP-Y.png" }], coverageSlots: [] }];
  project.vehicles = [{ id: "VEH-X", name: "Yard tug", approvedFile: "VEH-X.png",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "VEH-X.png" }], coverageSlots: [] }];
  project.locations.push({ id: "LOC-SUPPORT", name: "Support bay", approvedFile: "LOC-SUPPORT-PLATE.png", continuityStates: [] });
  project.shots[0].characters = [];
  project.shots[0].codes = codes;
  project.shots[0].creationBrief = { locationId: "", propIds: [], vehicleIds: [], promptBuilds: [], mode: "auto", ...brief };
  return project;
}
const INPUTS_STORAGE = { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" };
const ownershipCodes = (context) => JSON.parse(vm.runInContext("JSON.stringify(P.shots[0].codes)", context));

/* =================================================================== NC-REF20
   THE REPORTED DEFECT, RESTORED. The picker treats a bridged brief entry as its
   own selection again, and its Clear takes the suffixed token with it. */
async function nc20() {
  await browserControl({
    id: "NC-REF20",
    defect: "a suffixed Vehicle code is treated as ordinary picker-owned, and Clear deletes VEH-X-REAR",
    editsByFile: {
      "creation-studio.js": [[
        `  if (typeof shotEntityRelationIsLossyCodeBacked === "function" && shotEntityRelationIsLossyCodeBacked(P, s, id))
    return "code-backed";`,
        `  void shotEntityRelationIsLossyCodeBacked;`,
      ], [
        `    s.codes = guidedCodesWithoutExactToken(s, propId);`,
        `    s.codes = s.codes.filter((code) => !shotEntityTokenMatches(code, propId));`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", ownershipProject({ codes: ["VEH-X-REAR"] }),
        { mutateSource: mutate, storage: INPUTS_STORAGE });
      const cls = /class="guided-asset-choice ([^"]*)"[^>]*onclick="toggleShotCreationProp\('L1-01','VEH-X'\)/.exec(rendered.html);
      assert.ok(cls && /\bon\b/.test(cls[1]),
        `NC-REF20 probe: the vehicle was expected to render as an ordinary selection, got class "${cls && cls[1]}"`);
      const before = ownershipCodes(rendered.context);
      vm.runInContext("toggleShotCreationProp('L1-01','VEH-X')", rendered.context);
      const after = ownershipCodes(rendered.context);
      assert.ok(before.includes("VEH-X-REAR") && !after.includes("VEH-X-REAR"),
        "NC-REF20 probe: and the suffixed token was expected to be destroyed by the Clear");
      return `renders class="${cls[1]}" (ordinary selected); Clear takes codes ${JSON.stringify(before)} -> `
        + `${JSON.stringify(after)}, discarding the "-REAR" that ofp-migrate-rules calls unrecoverable`;
    },
    guard: (mutate) => freshSuite().ownershipSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF21
   The prop half, entered through the token filter alone. */
async function nc21() {
  await browserControl({
    id: "NC-REF21",
    defect: "a suffixed Prop code loses its suffix through picker Clear",
    editsByFile: {
      "creation-studio.js": [[
        `  return codes.filter((code) => String(code) !== id);`,
        `  return codes.filter((code) => !shotEntityTokenMatches(code, id));`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", ownershipProject({ codes: ["PROP-Y-LEFT"] }),
        { mutateSource: mutate, storage: INPUTS_STORAGE });
      /* Select first, so the Clear below is the one a filmmaker would reach. */
      vm.runInContext("toggleShotCreationProp('L1-01','PROP-Y')", rendered.context);
      const selected = ownershipCodes(rendered.context);
      vm.runInContext("toggleShotCreationProp('L1-01','PROP-Y')", rendered.context);
      const after = ownershipCodes(rendered.context);
      assert.ok(selected.includes("PROP-Y-LEFT") && !after.includes("PROP-Y-LEFT"),
        `NC-REF21 probe: the suffixed prop token was expected to be destroyed, got ${JSON.stringify(after)}`);
      return `after selecting then clearing: codes ${JSON.stringify(selected)} -> ${JSON.stringify(after)} — the `
        + `legacy "-LEFT" is gone with the layer the picker added`;
    },
    guard: (mutate) => freshSuite().ownershipSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF22
   The attach half: the explicit layer overwrites instead of layering. */
async function nc22() {
  await browserControl({
    id: "NC-REF22",
    defect: "an explicit picker selection over a suffixed code deletes the original suffixed code",
    editsByFile: {
      "creation-studio.js": [[
        `    if (!s.codes.some((code) => String(code) === String(propId))) s.codes.push(propId);`,
        `    s.codes = [...s.codes.filter((code) => !shotEntityTokenMatches(code, propId)), propId];`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", ownershipProject({ codes: ["VEH-X-REAR"] }),
        { mutateSource: mutate, storage: INPUTS_STORAGE });
      const before = ownershipCodes(rendered.context);
      vm.runInContext("toggleShotCreationProp('L1-01','VEH-X')", rendered.context);
      const after = ownershipCodes(rendered.context);
      assert.ok(before.includes("VEH-X-REAR") && !after.includes("VEH-X-REAR"),
        `NC-REF22 probe: choosing the vehicle was expected to overwrite the suffixed token, got ${JSON.stringify(after)}`);
      return `selecting VEH-X takes codes ${JSON.stringify(before)} -> ${JSON.stringify(after)} — an ADD destroyed `
        + `the relationship it was layering on`;
    },
    guard: (mutate) => freshSuite().ownershipSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF23
   The round trip: clearing the explicit layer takes the survivor with it. */
async function nc23() {
  await browserControl({
    id: "NC-REF23",
    defect: "clearing the explicit layer also deletes the surviving code-backed relation",
    editsByFile: {
      "creation-studio.js": [[
        `    s.codes = guidedCodesWithoutExactToken(s, propId);`,
        `    s.codes = s.codes.filter((code) => !shotEntityTokenMatches(code, propId));`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", ownershipProject({ codes: ["VEH-X-REAR"] }),
        { mutateSource: mutate, storage: INPUTS_STORAGE });
      vm.runInContext("toggleShotCreationProp('L1-01','VEH-X')", rendered.context);
      const layered = ownershipCodes(rendered.context);
      assert.ok(layered.includes("VEH-X-REAR") && layered.includes("VEH-X"),
        `NC-REF23 probe: (precondition) the layer must land beside the survivor, got ${JSON.stringify(layered)}`);
      vm.runInContext("toggleShotCreationProp('L1-01','VEH-X')", rendered.context);
      const after = ownershipCodes(rendered.context);
      assert.ok(!after.includes("VEH-X-REAR"),
        `NC-REF23 probe: taking back the layer was expected to take the survivor too, got ${JSON.stringify(after)}`);
      return `layered codes ${JSON.stringify(layered)}; clearing the picker's own layer leaves `
        + `${JSON.stringify(after)} — the code-backed relation went with it`;
    },
    guard: (mutate) => freshSuite().ownershipSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF24
   The 276-instance case: No location destroys LOC-HULL-A. */
async function nc24() {
  await browserControl({
    id: "NC-REF24",
    defect: "No location deletes the suffixed Location token LOC-HULL-A",
    editsByFile: {
      "creation-studio.js": [[
        `  if (previous && previous !== value && !selectingAttachedLocation)
    s.codes = guidedCodesWithoutExactToken(s, previous);`,
        `  if (previous && previous !== value && !selectingAttachedLocation)
    s.codes = s.codes.filter((code) => !shotEntityTokenMatches(code, previous));`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", ownershipProject({ codes: ["LOC-HULL-A", "PR-TOOL"] }),
        { mutateSource: mutate, storage: INPUTS_STORAGE });
      const before = ownershipCodes(rendered.context);
      const primary = vm.runInContext("P.shots[0].creationBrief.locationId || ''", rendered.context);
      vm.runInContext("setShotCreationLocation('L1-01','')", rendered.context);
      const after = ownershipCodes(rendered.context);
      assert.strictEqual(primary, "LOC-HULL", "NC-REF24 probe: (precondition) the suffixed token infers a primary");
      assert.ok(before.includes("LOC-HULL-A") && !after.includes("LOC-HULL-A"),
        `NC-REF24 probe: the suffixed location token was expected to be destroyed, got ${JSON.stringify(after)}`);
      return `primary inferred as "${primary}" from LOC-HULL-A; No location takes codes ${JSON.stringify(before)} `
        + `-> ${JSON.stringify(after)} — one of the 276 suffixed location tokens in this repository's corpus`;
    },
    guard: (mutate) => freshSuite().ownershipSection({ mutateSource: mutate }),
  });
}

/* =================================================================== NC-REF25
   The survivor is promoted straight back to primary. */
async function nc25() {
  await browserControl({
    id: "NC-REF25",
    defect: "a surviving suffixed Location is silently promoted back to primary after Clear",
    editsByFile: {
      "app.js": [[
        `      && s.creationBrief[SHOT_NO_PRIMARY_LOCATION_KEY] !== true) {`,
        `      && true) {`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await render("#/shot/L1-01", ownershipProject({ codes: ["LOC-HULL-A", "PR-TOOL"] }),
        { mutateSource: mutate, storage: INPUTS_STORAGE });
      vm.runInContext("setShotCreationLocation('L1-01','')", rendered.context);
      const cleared = vm.runInContext("P.shots[0].creationBrief.locationId || ''", rendered.context);
      vm.runInContext("normalizeShotV5(P.shots[0])", rendered.context);
      const after = vm.runInContext("P.shots[0].creationBrief.locationId || ''", rendered.context);
      assert.strictEqual(cleared, "", "NC-REF25 probe: the clear must land before normalisation undoes it");
      assert.strictEqual(after, "LOC-HULL",
        `NC-REF25 probe: the surviving suffixed token was expected to be promoted back, got ${after || "(empty)"}`);
      return `No location clears the primary to "", then normalizeShotV5 promotes the surviving LOC-HULL-A back to `
        + `primary "${after}" — the filmmaker's clear lasts one render`;
    },
    guard: (mutate) => freshSuite().ownershipSection({ mutateSource: mutate }),
  });
}

async function main() {
  await nc1();
  await nc2();
  await nc3();
  await nc4();
  await nc5();
  await nc6();
  await nc7();
  await nc8();
  await nc9();
  await nc10();
  await nc11();
  await nc12();
  await nc13();
  await nc14();
  await nc15();
  await nc16();
  await nc17();
  await nc18();
  await nc19();
  await nc20();
  await nc21();
  await nc22();
  await nc23();
  await nc24();
  await nc25();

  /* THE TREE IS CLEAN. Every file a control can reach, checked for the exact
     text that control introduces. */
  const restored = [
    ["public/entities.js", [/row\.demandState\s*=(?!=)/, /void obligations; return null;/, /if \(false\) \{/]],
    ["public/shared-coverage.js", [/if \(false\)\s*\n\s*return \{ state: "available"/]],
    ["public/shared-entities.js", [/if \(true\) return \{ known: true, demanded: true/, /void namesThis; void status;/, /void shotDependencyReadingIsWellFormed;/]],
    /* Each pattern is the EXACT text one control introduces, and each was checked
       against pristine source so a clean tree cannot fail this. `frame.winner = ""`
       alone would: the shipped file already contains that line elsewhere, and a
       tree-clean probe that fires on untouched source is a probe nobody can act on. */
    ["public/creation-studio.js", [
      /void shotEntityRelationIsLossyCodeBacked;/,
      /return codes\.filter\(\(code\) => !shotEntityTokenMatches\(code, id\)\);/,
      /s\.codes = \[\.\.\.s\.codes\.filter\(\(code\) => !shotEntityTokenMatches\(code, propId\)\), propId\]/,
      /if \(!String\(value \|\| ""\)\.trim\(\)\) return;/,
      /if \(!value\) for \(const frame of \(s\.keyframes \|\| \[\]\)\) frame\.winner = "";/,
      /P\.productionAuthority\.receipts\.filter\(\(row\) => row && row\.entityId !== previous\)/,
    ]],
    ["public/shared-shot-readiness.js", [/void namedMode;/]],
    ["public/app.js", [/&& true\) \{/, /const key = `\$\{shot\.id\}:/]],
  ];
  for (const [file, patterns] of restored) {
    const source = readLF(file);
    for (const pattern of patterns) {
      assert.ok(!pattern.test(source), `${file} was left patched by a control (${pattern})`);
    }
  }
  /* And the real thing is still there, so "clean" is not "emptied". */
  assert.ok(readLF("public/shared-coverage.js").includes(`if (production.known === true && production.demanded !== true)`),
    "public/shared-coverage.js lost the demand gate");
  assert.ok(readLF("public/shared-entities.js").includes(`if (shotIds.length) return { known: true, demanded: true, shotIds, uncertain, total: shots.length };`),
    "public/shared-entities.js lost the established-use branch of the demand owner");
  assert.ok(readLF("public/shared-entities.js").includes(`if (uncertain.length) return { known: false, demanded: false, shotIds: [], uncertain, total: shots.length };`),
    "public/shared-entities.js lost the fail-closed branch of the demand owner");
  assert.ok(readLF("public/creation-studio.js").includes(`function guidedLocationClearButton(s, c) {`),
    "public/creation-studio.js lost the location clear control");
  assert.ok(readLF("public/creation-studio.js").includes(`return codes.filter((code) => String(code) !== id);`),
    "public/creation-studio.js lost the exact-token-only filter");
  assert.ok(readLF("public/creation-studio.js").includes(`shotEntityRelationIsLossyCodeBacked(P, s, id))`),
    "public/creation-studio.js lost the code-backed ownership decision");
  assert.ok(readLF("public/shared-entities.js").includes(`function shotEntityRelationIsLossyCodeBacked(project, shot, entityId) {`),
    "public/shared-entities.js lost the lossy-code predicate");
  assert.ok(readLF("public/creation-studio.js").includes(`for (const id of Array.isArray(brief.vehicleIds) ? brief.vehicleIds : []) ids.add(String(id));`),
    "public/creation-studio.js lost the vehicleIds half of the picker's attached set");
  assert.ok(readLF("public/shared-entities.js").includes(`if (!shotDependencyReadingIsWellFormed(shot)) return { reading: "unknown", reason: "malformed-dependency-collection" };`),
    "public/shared-entities.js lost the malformed-collection guard");
  assert.ok(readLF("public/app.js").includes(`s.creationBrief[SHOT_NO_PRIMARY_LOCATION_KEY] !== true`),
    "public/app.js lost the explicit no-primary-location guard");
  assert.ok(readLF("public/entities.js").includes(`  return obligations && obligations.known === true`),
    "public/entities.js lost the current-obligation gate");

  console.log(`Reference demand negative controls passed — ${results.length} defects introduced, ${results.length} caught:`);
  for (const line of results) console.log("  " + line);
  console.log("  literal bad states produced:");
  for (const line of literals) console.log("    " + line);
  console.log("  tree restored · no provider call · no paid call · nothing written to any project");
}

module.exports = { main };

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
