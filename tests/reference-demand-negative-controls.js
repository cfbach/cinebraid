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
    editsByFile: {
      "shared-coverage.js": [[
        `    if (production.known === true && production.demanded !== true)
      return { state: "available", tier, basis: "no-current-production-demand", demanded: false };`,
        `    if (false)
      return { state: "available", tier, basis: "no-current-production-demand", demanded: false };`,
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
        `  return { known: true, demanded: shotIds.length > 0, shotIds, total: shots.length };`,
        `  return { known: true, demanded: true, shotIds, total: shots.length };`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await suite.referenceSurface(dormantLocation(),
        { list: "locations", id: "RD-LOC", mutateSource: mutate });
      const counts = suite.demandCounts(rendered.html);
      const headline = suite.demandHeadline(rendered.html);
      assert.ok(counts.now > 0, "NC-REF2 probe: the dormant location was expected to report current work");
      assert.strictEqual(counts.production, "demanded",
        "NC-REF2 probe: on a claim of usage no shot supports");
      return `dormant location reports "${headline}" (now=${counts.now}, production=demanded, shots=0)`;
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
        `  c.locationId = value;
  if (value && !s.codes.some((code) => shotEntityTokenMatches(code, value))) s.codes.push(value);`,
        `  c.locationId = value;
  if (!value && previous && P.productionAuthority && Array.isArray(P.productionAuthority.receipts)) {
    P.productionAuthority.receipts = P.productionAuthority.receipts.filter((row) => row && row.entityId !== previous);
  }
  if (value && !s.codes.some((code) => shotEntityTokenMatches(code, value))) s.codes.push(value);`,
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
        `    const uses = shotStateBearingEntityRecords(P, shot).some((row) =>`,
        `    const uses = shotDependencyRecords(P, shot).some((row) =>`,
      ]],
    },
    probe: async (mutate) => {
      const project = dormantCharacter();
      project.shots[0].continuityStateSelections = { "RD-CHAR": "state-default" };
      const rendered = await suite.referenceSurface(project, { mutateSource: mutate });
      const counts = suite.demandCounts(rendered.html);
      assert.strictEqual(counts.production, "demanded",
        "NC-REF6 probe: the declaration-only reference was expected to read as demanded");
      assert.ok(counts.now > 0, "NC-REF6 probe: and to owe current work");
      return `no shot relates to RD-CHAR, yet a leftover continuityStateSelections key produces "${suite.demandHeadline(rendered.html)}"`;
    },
    guard: (mutate) => freshSuite().demandMatrixSection({ mutateSource: mutate }),
  });
}

/* ==================================================================== NC-REF7
   Demand counted per demanding shot, so shared work is asked for twice. */
async function nc7() {
  await browserControl({
    id: "NC-REF7",
    defect: "one satisfied-once reference used by two shots is asked for once per shot",
    editsByFile: {
      "entities.js": [[
        `  return rows.map((row) => {
    const resolved = referenceDemandState({ tier: row.tier, requirement: row.requirement }, {`,
        `  const fanOut = Math.max(1, (production.shotIds || []).length);
  rows = [].concat(...Array.from({ length: fanOut }, (_, n) => rows.map((row) => n ? { ...row, id: row.id + "#" + n } : row)));
  return rows.map((row) => {
    const resolved = referenceDemandState({ tier: row.tier, requirement: row.requirement }, {`,
      ], [
        `  const truth = entityStateTruth(list, entity);
  const rows = [];`,
        `  const truth = entityStateTruth(list, entity);
  let rows = [];`,
      ]],
    },
    probe: async (mutate) => {
      const single = suite.demandFixture({ cast: true });
      const twice = suite.demandFixture({ cast: true });
      twice.shots.push({ ...JSON.parse(JSON.stringify(twice.shots[0])), id: "L1-02" });
      const one = suite.demandCounts((await suite.referenceSurface(single, { mutateSource: mutate })).html);
      const two = suite.demandCounts((await suite.referenceSurface(twice, { mutateSource: mutate })).html);
      assert.ok(two.now > one.now,
        `NC-REF7 probe: the second shot was expected to duplicate the work (${one.now} -> ${two.now})`);
      return `one shot asks for ${one.now} required references; two shots sharing the same reference ask for ${two.now}`;
    },
    guard: (mutate) => freshSuite().demandMatrixSection({ mutateSource: mutate }),
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
        `    const dormant = missing > 0 && demanded.known && !demanded.demanded;`,
        `    const dormant = false; void demanded;`,
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
    s.codes = s.codes.filter((code) => !shotEntityTokenMatches(code, previous));`,
        `  if (previous && previous !== value && !selectingAttachedLocation && value)
    s.codes = s.codes.filter((code) => !shotEntityTokenMatches(code, previous));`,
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
        `  return \`<button class="guided-asset-choice \${selected ? "on" : ""} \${ref?.url ? "approved" : "missing"}" onclick="\${list === "characters" ? \`toggleShotCreationCharacter('\${s.id}','\${x.id}')\` : \`toggleShotCreationProp('\${s.id}','\${x.id}')\`}"`,
        `  return \`<button class="guided-asset-choice \${selected ? "on" : ""} \${ref?.url ? "approved" : "missing"}" onclick="\${list === "characters" ? \`attachShotCreationCharacter('\${s.id}','\${x.id}')\` : \`toggleShotCreationProp('\${s.id}','\${x.id}')\`}"`,
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

  /* THE TREE IS CLEAN. Every file a control can reach, checked for the exact
     text that control introduces. */
  const restored = [
    ["public/entities.js", [/row\.demandState\s*=(?!=)/, /const dormant = false; void demanded;/]],
    ["public/shared-coverage.js", [/if \(false\)\s*\n\s*return \{ state: "available"/]],
    ["public/shared-entities.js", [/demanded: true, shotIds, total/]],
    /* Each pattern is the EXACT text one control introduces, and each was checked
       against pristine source so a clean tree cannot fail this. `frame.winner = ""`
       alone would: the shipped file already contains that line elsewhere, and a
       tree-clean probe that fires on untouched source is a probe nobody can act on. */
    ["public/creation-studio.js", [
      /if \(!String\(value \|\| ""\)\.trim\(\)\) return;/,
      /if \(!value\) for \(const frame of \(s\.keyframes \|\| \[\]\)\) frame\.winner = "";/,
      /P\.productionAuthority\.receipts\.filter\(\(row\) => row && row\.entityId !== previous\)/,
    ]],
    ["public/shared-shot-readiness.js", [/void namedMode;/]],
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
  assert.ok(readLF("public/shared-entities.js").includes(`return { known: true, demanded: shotIds.length > 0, shotIds, total: shots.length };`),
    "public/shared-entities.js lost the demand owner");
  assert.ok(readLF("public/creation-studio.js").includes(`function guidedLocationClearButton(s, c) {`),
    "public/creation-studio.js lost the location clear control");

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
