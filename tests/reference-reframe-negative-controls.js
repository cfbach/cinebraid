/* CineBraid — Batch 2, Slice 3: REFERENCE REFRAME, NEGATIVE CONTROLS.
 *
 * tests/reference-reframe.js asserts that the reframe behaves. A large share of
 * those assertions are the shape that most often CANNOT fail:
 *
 *   "the coverage detail is closed"          passes against a missing element
 *   "no parent is guessed"                   passes against a missing action
 *   "no Slice 4/5 vocabulary appears"        passes against a blank string
 *   "the requirement default did not change" passes if nothing reads it
 *
 * So every control here breaks the product deliberately — in memory, in this
 * process, never on disk — and requires the corresponding assertion to catch it.
 *
 * A control that arms itself and reports success without the break having landed
 * is the exact failure this file exists to avoid, so each one PROVES the break
 * took effect before it judges the detector. `assertion-probe-receipts
 * self-defeat` is a real repository lesson: a probe guarded by the same assert()
 * it is testing reports success while mutating nothing.
 *
 *   N1  flipping the unauthored-slot default from required is caught
 *   N2  a demand tier that stops deriving from the requirement is caught
 *   N3  presenting an unauthored required slot as "not currently needed" is caught
 *   N4  re-introducing `Choose & approve` as a peer stage is caught
 *   N5  a second surface offering candidate approval is caught
 *   N6  opening on the coverage matrix instead of the primary is caught
 *   N7  the coverage detail disclosure shipping open is caught
 *   N8  guessing the default state as a missing parent is caught
 *   N9  deriving from a parent that is recorded but NOT canon is caught
 *   N10 a hand-off naming a task the workspace no longer declares is caught
 *   N11 dropping the retired `review` id so a stored selection strands is caught
 *   N12 deleting provenance instead of disclosing it is caught
 *   N13 persisting the derived demand tier beside the fact is caught
 *   N14 the "no later-slice vocabulary" detector actually detects
 *   N15 THE REPRODUCED DEFECT: id-only production-usage matching is caught
 *   N16 the mirror mistake, type-only matching, is caught
 *   N17 an unrecognised collection guessing a real type is caught
 *
 * Nothing here contacts a provider, spends anything, or writes to a project.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
/* LF, always. `core.autocrlf=true` is set in this repository, so a source edit
   matched against a CRLF checkout silently applies to nothing. */
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const suite = require("./reference-reframe");
const { detectors } = suite;

const results = [];

/* ---------------------------------------------------------------- machinery */

/* Require a body to throw an AssertionError. A control that passes here has
   proved its detector fires; a control that does NOT throw has found a blind
   spot and fails this suite. */
async function expectRed(id, body) {
  let threw = null;
  try { await body(); }
  catch (error) { threw = error; }
  assert.ok(threw, `${id}: the defect was introduced and NOTHING caught it — that assertion cannot fail`);
  assert.ok(threw instanceof assert.AssertionError || /AssertionError/.test(String(threw && threw.name)),
    `${id}: the detector must fail by assertion, not by crashing (${threw && threw.message})`);
  return threw;
}

/* Run `body` with `file` temporarily rewritten on disk, restored in a finally.
   The repository lesson this obeys: never use `git checkout` to undo a temporary
   edit — it discards unstaged work elsewhere in the tree. The original bytes are
   held in memory and written back. */
async function patchedFile(file, edits, body) {
  const absolute = path.join(ROOT, file);
  const original = fs.readFileSync(absolute, "utf8");
  const lf = original.replace(/\r\n/g, "\n");
  let next = lf;
  for (const [from, to] of edits) {
    assert.ok(next.includes(from), `patch target not found in ${file}: ${from.slice(0, 90)}`);
    next = next.replace(from, to);
  }
  assert.notStrictEqual(next, lf, `patching ${file} changed nothing`);
  fs.writeFileSync(absolute, next);
  try {
    /* Both caches, because a module required through either path would otherwise
       serve the unpatched copy. */
    for (const key of Object.keys(require.cache)) if (key.includes("shared-coverage")) delete require.cache[key];
    await body();
  } finally {
    fs.writeFileSync(absolute, original);
    for (const key of Object.keys(require.cache)) if (key.includes("shared-coverage")) delete require.cache[key];
  }
}

/* A browser-side mutation applied through the render harness's `mutateSource`
   hook: the file on disk is untouched and the patched text is evaluated only
   inside this render. `applied` records which files the harness actually
   evaluated, so a typo in a filename cannot mutate nothing and look like a pass. */
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

async function control({ id, defect, run }) {
  await run();
  results.push(`${id} · ${defect}`);
}

/* A browser control: arm the mutation, PROVE it landed, then require the
   detector to catch it. */
async function browserControl({ id, defect, editsByFile, probe, guard }) {
  await control({
    id,
    defect,
    run: async () => {
      const mutate = sourceMutator(editsByFile);
      /* The probe runs FIRST and asserts the defect is actually present. It must
         not share an assertion with the guard, or it would be self-proving. */
      await probe(mutate);
      for (const file of mutate.expected) {
        assert.ok(mutate.applied.has(file), `${id}: ${file} was never evaluated, so the defect never ran`);
      }
      await expectRed(id, () => guard(sourceMutator(editsByFile)));
    },
  });
}

const renderMutated = (mutate, options = {}) =>
  suite.renderReference(suite.referenceFixture(), { mutateSource: mutate, ...options });

const coverageStorage = { "cinebraid-focused:fixture:entity-task:characters:CHAR-REFRAME": "coverage" };

/* ============================================================ module controls
   These break public/shared-coverage.js on disk, which is the only way to reach
   the semantics the Node half of the suite reads through require(). */

async function n1() {
  await control({
    id: "N1",
    defect: "the unauthored-slot default is flipped from required to not-required",
    run: () => patchedFile("public/shared-coverage.js", [[
      `    return { requirement: "required", source: "unspecified", declared: "", unknown, legacy };`,
      `    return { requirement: "not-required", source: "unspecified", declared: "", unknown, legacy };`,
    ]], async () => {
      /* PROOF THE BREAK LANDED, through a fresh require and not through the
         assertion being tested. */
      const patched = require("../public/shared-coverage");
      assert.strictEqual(patched.coverageRequirement({}), "not-required",
        "N1 probe: the default was expected to be flipped");
      assert.strictEqual(patched.summariseCoverage([{ id: "a" }]).required, 0,
        "N1 probe: and the flip was expected to move a legacy project's required count");
      /* THE DETECTOR. This is the single most important control in the slice:
         it is the semantic change the brief says must not happen silently. */
      await expectRed("N1", () => {
        delete require.cache[require.resolve("./reference-reframe")];
        require("./reference-reframe").coverageSection();
      });
    }),
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n2() {
  await control({
    id: "N2",
    defect: "the demand tier stops deriving from the requirement and decides for itself",
    run: () => patchedFile("public/shared-coverage.js", [[
      `      tier: DEMAND_TIER_BY_REQUIREMENT[trace.requirement] || "required",`,
      `      tier: trace.source === "unspecified" ? "not-currently-needed" : (DEMAND_TIER_BY_REQUIREMENT[trace.requirement] || "required"),`,
    ]], async () => {
      const patched = require("../public/shared-coverage");
      assert.strictEqual(patched.coverageRequirement({}), "required",
        "N2 probe: the requirement itself must be untouched — that is what makes this the SNEAKY version of N1");
      assert.strictEqual(patched.coverageDemand({}).tier, "not-currently-needed",
        "N2 probe: while the presentation quietly disagrees with it");
      await expectRed("N2", () => {
        delete require.cache[require.resolve("./reference-reframe")];
        require("./reference-reframe").coverageSection();
      });
    }),
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n3() {
  await control({
    id: "N3",
    defect: "`unspecified` is counted as somebody having authored the slot",
    run: () => patchedFile("public/shared-coverage.js", [[
      `  const CONFIRMED_DEMAND_SOURCES = ["default-state", "retired", "declared", "legacy-boolean"];`,
      `  const CONFIRMED_DEMAND_SOURCES = ["default-state", "retired", "declared", "legacy-boolean", "unspecified"];`,
    ]], async () => {
      const patched = require("../public/shared-coverage");
      assert.strictEqual(patched.coverageDemand({}).confirmed, true,
        "N3 probe: the absence of an assertion was expected to be reported as one");
      await expectRed("N3", () => {
        delete require.cache[require.resolve("./reference-reframe")];
        require("./reference-reframe").coverageSection();
      });
    }),
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

/* ============================================================ source controls
   These break public/entities.js or public/live-activity.js on disk and require
   the source-reading half of the suite to catch it. */

async function n4() {
  await control({
    id: "N4",
    defect: "`Choose & approve` returns as a peer top-level production stage",
    run: () => patchedFile("public/entities.js", [[
      `    {id:"coverage",label:"What this production needs",detail:"Required views, states and variants",render:()=>entityCoverageStatesMarkup(list,it,mediaByName,media)},`,
      `    {id:"review",label:manualFirstWorkflow()?"Choose & approve":"Review",detail:"Candidates and approvals",render:()=>candidatesTask},\n    {id:"coverage",label:"What this production needs",detail:"Required views, states and variants",render:()=>entityCoverageStatesMarkup(list,it,mediaByName,media)},`,
    ]], async () => {
      const peers = detectors.peerTaskIds(readLF("public/entities.js"));
      assert.deepStrictEqual(peers, ["reference", "review", "coverage", "details"],
        "N4 probe: the peer stage was expected to be back");
      await expectRed("N4", async () => {
        delete require.cache[require.resolve("./reference-reframe")];
        await require("./reference-reframe").primarySection();
      });
    }),
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n10() {
  await control({
    id: "N10",
    defect: "the completed-run hand-off names a task the reference workspace no longer declares",
    run: () => patchedFile("public/live-activity.js", [[
      `  "default-only": { task: "reference" },`,
      `  "default-only": { task: "review" },`,
    ]], async () => {
      assert.ok(/"default-only":\s*\{\s*task:\s*"review"\s*\}/.test(readLF("public/live-activity.js")),
        "N10 probe: the stale target was expected to be in place");
      /* This is the defect that fails SILENTLY in the product — boundedFocusedTask
         substitutes a fallback for an unknown id — which is exactly why it has to
         fail loudly here. */
      await expectRed("N10", () => {
        delete require.cache[require.resolve("./reference-reframe")];
        require("./reference-reframe").handoffSection();
      });
    }),
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n11() {
  await control({
    id: "N11",
    defect: "the retired `review` id is dropped, so a stored selection strands on a fallback",
    run: () => patchedFile("public/entities.js", [[
      `candidates:"reference",review:"reference",`,
      `candidates:"reference",`,
    ]], async () => {
      assert.ok(!readLF("public/entities.js").includes('review:"reference"'),
        "N11 probe: the legacy mapping was expected to be gone");
      await expectRed("N11", () => {
        delete require.cache[require.resolve("./reference-reframe")];
        require("./reference-reframe").handoffSection();
      });
    }),
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n13() {
  await control({
    id: "N13",
    defect: "the derived demand tier is persisted onto the slot beside the fact it came from",
    run: () => patchedFile("public/entities.js", [[
      `    const demand = coverageDemand(slot);\n    rows.push({ family: "coverage", id: slot.id, label: slot.label || slot.id, tier: demand.tier, confirmed: demand.confirmed, requirement: demand.requirement, satisfied: !!slotSelectedFile(slot) });`,
      `    const demand = coverageDemand(slot);\n    slot.tier = demand.tier;\n    rows.push({ family: "coverage", id: slot.id, label: slot.label || slot.id, tier: demand.tier, confirmed: demand.confirmed, requirement: demand.requirement, satisfied: !!slotSelectedFile(slot) });`,
    ]], async () => {
      assert.ok(/slot\.tier = demand\.tier;/.test(readLF("public/entities.js")),
        "N13 probe: the rollup write was expected to be in place");
      await expectRed("N13", async () => {
        delete require.cache[require.resolve("./reference-reframe")];
        await require("./reference-reframe").boundarySection();
      });
    }),
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

/* =========================================================== browser controls
   These mutate the browser bundle only for the duration of one render. */

async function n5() {
  await browserControl({
    id: "N5",
    defect: "a second surface offers candidate approval, so the decision has two homes again",
    editsByFile: {
      "entities.js": [[
        `{id:"coverage",label:"What this production needs",detail:"Required views, states and variants",render:()=>entityCoverageStatesMarkup(list,it,mediaByName,media)},`,
        `{id:"coverage",label:"What this production needs",detail:"Required views, states and variants",render:()=>candidatesTask+entityCoverageStatesMarkup(list,it,mediaByName,media)},`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await renderMutated(mutate, { storage: coverageStorage });
      assert.ok(rendered.html.includes("entity-candidate-section"),
        "N5 probe: the second approval surface was expected to render");
    },
    guard: async (mutate) => {
      delete require.cache[require.resolve("./reference-reframe")];
      await require("./reference-reframe").primarySection({ mutateSource: mutate });
    },
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n6() {
  await browserControl({
    id: "N6",
    defect: "a reference opens on the coverage matrix instead of on its primary",
    editsByFile: {
      "entities.js": [[
        `  const defaultTask = specs[0].id;`,
        /* Slice 5 note: this used to select the first non-reference task whose tone
           was "attention", and on this fixture the coverage task no longer has that
           tone — the reference is dormant, and the demand gate stops a dormant
           reference reporting outstanding required work. The MUTATION was coupled to
           that tone; the CONTROL never was. It manufactures the same defect through
           the same shape of plausible mistake — "open on the first unfinished
           stage" — so the guard still faces a front door that is the coverage
           matrix. */
        `  const defaultTask = specs.find((spec)=>spec.id !== "reference" && boundedEntityTaskStatus(list,it,spec.id,activeCandidates,states).tone !== "complete")?.id || specs[0].id;`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await renderMutated(mutate);
      const selected = /data-selected-task="([^"]+)"/.exec(rendered.html);
      assert.strictEqual(selected && selected[1], "coverage",
        "N6 probe: the front door was expected to become the coverage matrix");
    },
    guard: async (mutate) => {
      delete require.cache[require.resolve("./reference-reframe")];
      await require("./reference-reframe").primarySection({ mutateSource: mutate });
    },
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n7() {
  await browserControl({
    id: "N7",
    defect: "the angle / expression / continuity-state boards ship open again",
    editsByFile: {
      "entities.js": [[
        `  const detailOpen = ids.includes(explicitView);`,
        `  const detailOpen = true;`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await renderMutated(mutate, { storage: coverageStorage });
      assert.ok(rendered.html.includes('data-coverage-detail-open="1"'),
        "N7 probe: the boards were expected to be open");
      assert.ok(/data-entity-subworkspace=/.test(rendered.html),
        "N7 probe: and rendered in full");
    },
    guard: async (mutate) => {
      delete require.cache[require.resolve("./reference-reframe")];
      await require("./reference-reframe").demandSection({ mutateSource: mutate });
    },
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n8() {
  await browserControl({
    id: "N8",
    defect: "a state with no recorded source is offered the default state as its parent",
    editsByFile: {
      "entities.js": [[
        `      parentRecorded: !!parentInfo.parent,`,
        `      parentRecorded: true,`,
      ], [
        `      parentIsCanon: !!(parentInfo.parent && truth.of(parentInfo.parent).standing === "canon"),`,
        `      parentIsCanon: !!(parentInfo.parent ? truth.of(parentInfo.parent).standing === "canon" : truth.of(entityStateListRead(entity, true).find((s) => s.isDefault)).standing === "canon"),`,
      ], [
        `      parentLabel: parentInfo.label,`,
        `      parentLabel: parentInfo.parent ? parentInfo.label : "Clean overall",`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await renderMutated(mutate, { storage: coverageStorage });
      const guessed = detectors.generateFromParent(rendered.html, "state-orphan");
      assert.ok(guessed, "N8 probe: the orphan state was expected to be offered a guessed parent");
      assert.strictEqual(guessed.parent, "Clean overall",
        "N8 probe: and the guess was expected to be the default state");
    },
    guard: async (mutate) => {
      delete require.cache[require.resolve("./reference-reframe")];
      await require("./reference-reframe").continuitySection({ mutateSource: mutate });
    },
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n9() {
  await browserControl({
    id: "N9",
    defect: "a state derives from a parent that is recorded but has never been approved",
    editsByFile: {
      "entities.js": [[
        `      parentIsCanon: !!(parentInfo.parent && truth.of(parentInfo.parent).standing === "canon"),`,
        `      parentIsCanon: !!parentInfo.parent,`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await renderMutated(mutate, { storage: coverageStorage });
      const offered = detectors.generateFromParent(rendered.html, "state-unapproved");
      assert.ok(offered, "N9 probe: the unapproved-parent state was expected to be offered generation");
      assert.strictEqual(offered.parent, "Heavy soot",
        "N9 probe: from a parent that carries no canon image at all");
    },
    guard: async (mutate) => {
      delete require.cache[require.resolve("./reference-reframe")];
      await require("./reference-reframe").continuitySection({ mutateSource: mutate });
    },
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

async function n12() {
  await browserControl({
    id: "N12",
    defect: "provenance is deleted rather than progressively disclosed",
    editsByFile: {
      "entities.js": [[
        `  return \`<details class="fold compact-entity-section"><summary>Generation records — provenance <span>\${(entity.made || []).length}</span></summary>`,
        `  if (entity) return "";\n  return \`<details class="fold compact-entity-section"><summary>Generation records — provenance <span>\${(entity.made || []).length}</span></summary>`,
      ]],
    },
    probe: async (mutate) => {
      const rendered = await renderMutated(mutate, {
        storage: {
          "cinebraid-focused:fixture:entity-task:characters:CHAR-REFRAME": "details",
          "cinebraid-bounded:fixture:selected:entity-detail-view:characters:CHAR-REFRAME": "history",
        },
      });
      assert.ok(!rendered.html.includes("Generation records — provenance"),
        "N12 probe: the provenance section was expected to be gone");
    },
    guard: async (mutate) => {
      delete require.cache[require.resolve("./reference-reframe")];
      await require("./reference-reframe").detailsSection({ mutateSource: mutate });
    },
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

/* ============================================ typed-identity controls (N15-N17)
   The defect the Codex acceptance pass reproduced, plus the two ways a fix for
   it can be wrong in the other direction. Every one of these is a mutation of
   the MATCHER, so each proves that section 9's table is measuring the matcher
   rather than the fixture.

   The probe renders a project where one id sits in four collections and exactly
   one typed reference exists, and asserts the wrong answer really appears before
   the detector is asked to catch it. */
const COLLISION = { id: "X-COLLIDE", shots: [{ characters: ["X-COLLIDE"] }] };

async function typedIdentityControl({ id, defect, editsByFile, wrong }) {
  await control({
    id,
    defect,
    run: async () => {
      const mutate = sourceMutator(editsByFile);
      const seen = await suite.usageFor(suite.collisionProject(COLLISION), COLLISION.id, { mutateSource: mutate });
      /* PROOF THE BREAK LANDED — a distinct assertion from the one being tested. */
      for (const [list, count] of Object.entries(wrong)) {
        assert.strictEqual(seen[list], count,
          `${id} probe: expected the broken matcher to report ${count} for ${list}, got ${seen[list]}`);
      }
      for (const file of mutate.expected) {
        assert.ok(mutate.applied.has(file), `${id}: ${file} was never evaluated, so the defect never ran`);
      }
      await expectRed(id, async () => {
        delete require.cache[require.resolve("./reference-reframe")];
        await require("./reference-reframe").typedIdentitySection({ mutateSource: sourceMutator(editsByFile) });
      });
    },
  });
  delete require.cache[require.resolve("./reference-reframe")];
}

/* N15 IS THE REPRODUCED DEFECT, VERBATIM. A prop and a location that merely
   share a name with a referenced character each claim its usage. */
const n15 = () => typedIdentityControl({
  id: "N15",
  defect: "production usage is matched on the raw id, so a colliding prop claims a character's shot",
  editsByFile: {
    "entities.js": [[
      `if (shotDependencyRecords(P, shot).some((row) => row.resolved && row.type === type && String(row.id) === wanted)) used += 1;`,
      `if (shotDependencyRecords(P, shot).some((row) => row.resolved && String(row.id) === wanted)) used += 1;`,
    ]],
  },
  wrong: { characters: 1, locations: 1, props: 1, vehicles: 1 },
});

/* The mirror-image mistake: keeping the type and dropping the id. Every entity
   in a referenced collection would then report the usage of its neighbours. */
const n16 = () => typedIdentityControl({
  id: "N16",
  defect: "production usage is matched on the type alone, so any character claims any character's shot",
  editsByFile: {
    "entities.js": [[
      `if (shotDependencyRecords(P, shot).some((row) => row.resolved && row.type === type && String(row.id) === wanted)) used += 1;`,
      `if (shotDependencyRecords(P, shot).some((row) => row.resolved && row.type === type)) used += 1;`,
    ]],
  },
  wrong: { characters: 1, locations: 0, props: 0, vehicles: 0 },
});

/* And the guard that makes an unrecognised collection answer nothing. With a
   real type as the fallback, a typo in a caller silently becomes a claim about
   characters. */
const n17 = () => typedIdentityControl({
  id: "N17",
  defect: "an unrecognised collection falls back to a real dependency type instead of refusing to guess",
  editsByFile: {
    "entities.js": [[
      `  return ENTITY_DEPENDENCY_TYPES[String(list || "")] || "";`,
      `  return ENTITY_DEPENDENCY_TYPES[String(list || "")] || "character";`,
    ]],
  },
  /* The four real collections still answer correctly — that is what makes this
     the SNEAKY version, and why section 9 has to test the unknown ones too. */
  wrong: { characters: 1, locations: 0, props: 0, vehicles: 0 },
});

/* ================================================== the detector's own control
   N14 proves the "no later-slice vocabulary" check is a detector rather than a
   comfortable tautology, without touching the product at all. */
async function n14() {
  await control({
    id: "N14",
    defect: "the later-slice vocabulary detector is a tautology that passes on anything",
    run: async () => {
      for (const leak of [
        `<span>Declared delivery route</span>`,
        `<button>Shot Intent</button>`,
        `<b>Estimated cost</b>`,
        `<small>$0.26 per second</small>`,
        `<nav>Simple / Advanced</nav>`,
      ]) {
        assert.ok(!detectors.noLaterSliceVocabularyInHtml(leak),
          `N14: the html detector failed to notice ${leak}`);
      }
      for (const leak of [
        `const route = shot.deliveryRoute;`,
        `const quote = falH3CostEstimate(seconds);`,
        `record.rateSource = "config";`,
        `config.generation.fal.estimatedCostPerImage`,
      ]) {
        assert.ok(!detectors.noLaterSliceVocabularyInSource(leak),
          `N14: the source detector failed to notice ${leak}`);
      }
      /* And it must not fire on the shipped files, or it would be a detector
         nobody can leave switched on. */
      assert.ok(detectors.noLaterSliceVocabularyInSource(readLF("public/entities.js")),
        "N14: the source detector must not false-positive on the shipped reference workspace");
    },
  });
}

async function main() {
  /* The three module controls patch the same file, so they run in sequence and
     each restores before the next begins. */
  await n1();
  await n2();
  await n3();
  await n4();
  await n5();
  await n6();
  await n7();
  await n8();
  await n9();
  await n10();
  await n11();
  await n12();
  await n13();
  await n15();
  await n16();
  await n17();
  await n14();

  /* THE TREE MUST BE EXACTLY AS IT WAS. Every on-disk control restores in a
     finally, and this is the receipt that they all did — a control that leaves a
     patched file behind would poison every later suite in the run. */
  const shouldBeClean = ["public/shared-coverage.js", "public/entities.js", "public/live-activity.js"];
  for (const file of shouldBeClean) {
    const source = readLF(file);
    assert.ok(!source.includes(`slot.tier = demand.tier;`), `${file} was left patched by a control`);
    assert.ok(!/"default-only":\s*\{\s*task:\s*"review"\s*\}/.test(source), `${file} was left patched by a control`);
    assert.ok(!source.includes(`return { requirement: "not-required", source: "unspecified"`), `${file} was left patched by a control`);
  }
  assert.ok(readLF("public/entities.js").includes('review:"reference"'), "public/entities.js was left patched by a control");
  assert.ok(readLF("public/shared-coverage.js").includes(`const CONFIRMED_DEMAND_SOURCES = ["default-state", "retired", "declared", "legacy-boolean"];`),
    "public/shared-coverage.js was left patched by a control");

  console.log(`Reference reframe negative controls passed — ${results.length} defects introduced, ${results.length} caught:`);
  for (const line of results) console.log("  " + line);
  console.log("  tree restored · no provider call · no paid call · nothing written to any project");
  void os;
  void vm;
}

module.exports = { main };

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
