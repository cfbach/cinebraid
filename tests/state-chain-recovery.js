const assert = require("assert");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

function fixture() {
  const project = buildFixture();
  const mural = project.props[0];
  mural.id = "PROP-MURAL";
  mural.name = "The 1974 civic mural";
  mural.creationDescription = "A large hand-painted 1974 civic mural on weathered plaster, with fixed composition, lettering placement, figures, palette, brushwork, cracks, and architectural boundaries.";
  mural.approvedFile = "PROP-MURAL-DEFAULT.png";
  mural.continuityStates = [
    {
      id: "state-default",
      name: "Original 1974 state",
      isDefault: true,
      approvedFile: "PROP-MURAL-DEFAULT.png",
      notes: "The complete original mural, preserving its exact layout, palette, figures, lettering placement, brushwork, plaster cracks, and wall boundaries.",
    },
    {
      id: "state-drifted-worse",
      name: "Drifted further",
      isDefault: false,
      approvedFile: "",
      parentStateId: "state-default",
      generationMode: "derive",
      appliesTo: "Later restoration sequence",
      description: "The mural has drifted further from the original: paint is more faded and flaked, several figure outlines are partially lost, and water staining spreads downward. Preserve the exact composition, lettering placement, wall geometry, and every unaffected painted region.",
    },
    {
      id: "state-missing-delta",
      name: "Undescribed state",
      isDefault: false,
      approvedFile: "",
      parentStateId: "state-default",
      generationMode: "derive",
      appliesTo: "Scene 7",
      notes: "",
    },
  ];
  project.shots[0].codes = [mural.id];
  return project;
}

function scan() {
  return {
    anchors: [], plates: [], vehicles: [], audio: [], media: [],
    props: [{ name: "PROP-MURAL-DEFAULT.png", url: "/assets/props/PROP-MURAL-DEFAULT.png" }],
    shots: { "L1-01": { takes: [], locked: [] } },
  };
}

async function testMigrationPreflightAndManualBuild() {
  const project = fixture();
  let compileCalls = 0;
  const rendered = await render("#/prop/PROP-MURAL", project, {
    scan: scan(),
    fetch: async (url, options, respond) => {
      if (url === "/api/prompt/asset-compile") {
        compileCalls += 1;
        const body = JSON.parse(options.body || "{}");
        assert.strictEqual(body.profileId, "gpt-image-2/edit", "derived mural states must target the edit profile");
        return respond({
          compiledPrompt: "ATTACHED REFERENCES\n#image1 — BASE: Approved Original 1974 state reference\n\nEdit #image1. Keep everything identical and change ONLY this: the paint is more faded and flaked, figure outlines are partially lost, and water staining spreads downward.",
          profile: { id: body.profileId, name: "GPT Image 2 — Reference Edit", mode: "edit", profileVersion: "state-chain-recovery" },
          state: { id: body.stateId, generationMode: "derive", parentStateId: "state-default", parentStateName: "Original 1974 state" },
          references: [{ role: "base", label: "Approved Original 1974 state reference" }],
          warnings: [], confirmations: [], spec: {}, providerPayload: null, llmUsed: false,
        });
      }
      return null;
    },
  });

  const migrated = vm.runInContext(`(() => {
    const e = P.props.find(x => x.id === 'PROP-MURAL');
    const drifted = entityStateById(e, 'state-drifted-worse');
    const missing = entityStateById(e, 'state-missing-delta');
    const driftedPreflight = v627EntityPreflight('props', e, [drifted.id]);
    const missingPreflight = v627EntityPreflight('props', e, [missing.id]);
    return {
      notes: drifted.notes,
      driftedDeltaErrors: driftedPreflight.errors.filter(x => x.toLowerCase().includes('state change / delta')),
      missingDeltaErrors: missingPreflight.errors.filter(x => x.toLowerCase().includes('state change / delta')),
    };
  })()`, rendered.context);
  assert.match(migrated.notes, /paint is more faded and flaked/i, "legacy description fields must migrate into the state delta");
  assert.strictEqual(migrated.driftedDeltaErrors.length, 0, "a migrated real delta must pass the delta portion of preflight");
  assert.strictEqual(migrated.missingDeltaErrors.length, 1, "Applies to scenes / shots must not falsely satisfy the visual-delta requirement");

  const build = await rendered.context.buildEntityStatePrompt("props", "PROP-MURAL", "state-drifted-worse", false);
  assert(build?.prompt, "the mural state prompt must be returned to automation callers");
  assert.strictEqual(compileCalls, 1, "manual deterministic build should submit one prompt request");
  const saved = vm.runInContext(`P.props.find(x=>x.id==='PROP-MURAL').continuityStates.find(x=>x.id==='state-drifted-worse').assetPromptBuilds.at(-1)`, rendered.context);
  assert.match(saved.prompt, /Edit #image1/i, "the compiled parent edit prompt must persist on the mural state");
}

async function testAutomationFallsBackToDeterministicPrompt() {
  const project = fixture();
  let deterministicCalls = 0;
  let advisorCalls = 0;
  const rendered = await render("#/prop/PROP-MURAL", project, {
    scan: scan(),
    fetch: async (url, options, respond) => {
      if (url === "/api/prompt/asset-compile") {
        const body = JSON.parse(options.body || "{}");
        if (body.useLLM) {
          advisorCalls += 1;
          return respond({ error: "Local prompt advisor timed out" }, 500);
        }
        deterministicCalls += 1;
        return respond({
          compiledPrompt: "Edit #image1. Keep everything identical and change ONLY this: increase fading, flaking, missing figure outlines, and downward water staining while preserving the fixed mural composition.",
          profile: { id: body.profileId, name: "GPT Image 2 — Reference Edit", mode: "edit", profileVersion: "state-chain-recovery" },
          state: { id: body.stateId, generationMode: "derive", parentStateId: "state-default", parentStateName: "Original 1974 state" },
          references: [{ role: "base", label: "Approved Original 1974 state reference" }],
          warnings: [], confirmations: [], spec: {}, providerPayload: null, llmUsed: false,
        });
      }
      return null;
    },
  });

  rendered.context.v626SaveRun = async (run) => run;
  rendered.context.flushPendingProjectSave = async () => {};
  const run = rendered.context.v626NewRun("entity-chain", "props:PROP-MURAL", "state-chain", "Mural continuity references", "state-chain", { stateRounds: 3 });
  const build = await rendered.context.v626EntityBuild(run, "props", "PROP-MURAL", "state-drifted-worse", 1, "");
  assert(build?.prompt, "automation must retain the deterministic prompt when the advisor fails");
  assert.strictEqual(deterministicCalls, 1);
  assert.strictEqual(advisorCalls, 1);
  const step = run.steps["entity:state-drifted-worse:round-1:prompt"];
  assert.strictEqual(step.status, "completed", "advisor failure must not discard a valid deterministic prompt");
  assert.strictEqual(step.result.deterministicFallback, true, "the report must record deterministic fallback explicitly");
  assert(run.logs.some((row) => /Local prompt advisor timed out/i.test(row.message)), "the underlying advisor error must remain visible in run logs");
}

async function main() {
  await testMigrationPreflightAndManualBuild();
  await testAutomationFallsBackToDeterministicPrompt();
  console.log("State-chain recovery suite passed real-delta migration, strict preflight, returned state builds, reference-edit targeting, exact advisor-error logging, and deterministic prompt fallback.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
