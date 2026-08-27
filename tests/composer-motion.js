const assert = require("assert");
const vm = require("vm");
const PromptEngine = require("../prompt-engine");
const { render, buildFixture, withCanon } = require("./render-harness");

function contextFixture() {
  return {
    project: {
      world: { setting: "Downtown street" },
      styleBlocks: [],
      aspectRatio: "16:9",
    },
    scene: {
      title: "Street",
      beat: "Kai reaches the waiting car.",
      feeling: "Controlled urgency",
    },
    shot: {
      id: "SC01-03",
      title: "Approach the car",
      description: "Kai crosses the sidewalk toward the parked car.",
      positioning: "Wide street view.",
      durationSeconds: 7,
      motionDirection: "Kai walks toward the car.",
      audio: { dialogue: "", sfx: "" },
      risks: [],
    },
    references: [
      { type: "character", name: "Kai" },
      { type: "location", name: "Downtown street" },
      { type: "prop", name: "Hero car" },
    ],
  };
}

function references() {
  return [
    {
      key: "street",
      label: "Downtown street plate",
      mediaType: "image",
      role: "location",
      sourceType: "location",
      instruction: "Use as the environmental base and street architecture.",
    },
    {
      key: "car",
      label: "Hero car — front three-quarter",
      mediaType: "image",
      role: "prop",
      sourceType: "prop",
      instruction: "Use for the vehicle identity, body design, paint, and scale.",
    },
    {
      key: "kai",
      label: "Kai identity",
      mediaType: "image",
      role: "identity",
      sourceType: "character",
      instruction: "Use for Kai's identity and wardrobe.",
    },
    {
      key: "dialogue",
      label: "Kai dialogue take",
      mediaType: "audio",
      role: "audio-timing",
      sourceType: "audio",
      instruction: "Dialogue audio for Kai.",
    },
  ];
}

function compositionFixture() {
  return {
    aspectRatio: "16:9",
    camera: {
      shotSize: "wide",
      height: "low",
      angle: "low-angle",
      lens: "wide",
      view: "three-quarter-left",
      layout: "rule-of-thirds",
      crop: "full-scene",
      reframe: "preserve-exact",
    },
    elements: [
      {
        id: "car-placement",
        referenceKey: "car",
        x: 0.76,
        y: 0.72,
        w: 0.34,
        h: 0.24,
        depth: "midground",
        facing: "screen-left",
        view: "front-three-quarter",
        notes: "Parked at the curb.",
      },
      {
        id: "kai-placement",
        referenceKey: "kai",
        x: 0.29,
        y: 0.63,
        w: 0.18,
        h: 0.48,
        depth: "midground",
        facing: "screen-right",
        view: "three-quarter",
        notes: "Standing beside the driver-side door.",
      },
    ],
    mustInclude: "street, car, Kai, and a clear path between Kai and the driver-side door",
    mustAvoid: "duplicate vehicles or a blocked face",
  };
}

function motionFixture() {
  return {
    camera: {
      move: "push-in",
      direction: "forward",
      intensity: "subtle",
      style: "smooth",
      framing: "preserve",
    },
    subjects: {
      KAI: {
        action: "walk",
        direction: "screen-right",
        intensity: "natural",
        look: "toward-car",
        notes: "Controlled pace.",
      },
    },
    props: {
      "PR-CAR": {
        action: "static",
        direction: "",
        notes: "The car remains parked.",
      },
    },
    environment: {
      action: "traffic",
      intensity: "subtle",
      notes: "Only distant background traffic moves.",
    },
    timing: {
      onset: "immediate",
      pacing: "natural",
      holdEnd: true,
      secondary: "Kai reaches the driver-side door and settles.",
    },
    audio: {
      mode: "lip-sync-reference",
      referenceKey: "dialogue",
      speakerId: "KAI",
      voiceEntityId: "VOICE-KAI-CLEAN",
      lipSync: true,
      direction: "restrained delivery",
    },
  };
}

async function testRenderedWorkspace() {
  const project = withCanon(buildFixture(), [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  project.meta.legacyVisualStaging = true;
  project.mediaAssets.push(
    {
      id: "media-kai-side",
      file: "KAI-SIDE.png",
      title: "Kai side view",
      originalName: "KAI-SIDE.png",
      links: [{ id: "link-kai-side", targetType: "character", targetId: "KAI", role: "alternate-view", angleTag: "left-profile", referenceKind: "single-angle", priority: "supporting", notes: "Use for side-view anatomy only.", agentContext: true, generationInput: true, order: 1 }],
    },
    {
      id: "media-tool-rear",
      file: "TOOL-REAR.png",
      title: "Panel tool rear view",
      originalName: "TOOL-REAR.png",
      links: [{ id: "link-tool-rear", targetType: "prop", targetId: "PR-TOOL", role: "alternate-view", angleTag: "rear", referenceKind: "detail", detailRegion: "rear housing", priority: "supporting", notes: "Use for the rear housing.", agentContext: true, generationInput: true, order: 1 }],
    },
  );
  project.shots[0].creationBrief = {
    locationId: "LOC-HULL",
    propIds: ["PR-TOOL"],
    composition: {
      ...compositionFixture(),
      baseFrame: { source: "ref:locations:LOC-HULL:state-default", zoom: 1.2, panX: 8, panY: -4, rotation: 2, fit: "cover" },
      guides: { grid: true, snap: true },
    },
    motionPlan: motionFixture(),
    activeMotionUnitId: "motion-b",
  };
  const composerRender = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "composer" } });
  const motionRender = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  const composerHtml = composerRender.html, motionHtml = motionRender.html;
  const motionState = vm.runInContext(`shotStageState("motion", shotStageModelFacts(P.shots[0], takesFor(P.shots[0].id)))`, motionRender.context);
  assert.strictEqual(motionState.availability, "available",
    "fixture precondition: canonical production inputs must make Motion available before testing its controls");
  assert(composerHtml.includes("FINAL REFERENCES · REVIEW"), "shot workspace should expose final reference review");
  for (const html of [composerHtml, motionHtml]) {
    assert(!html.includes("shot-composer-canvas"), "legacy visual staging canvas must not render");
    assert(!html.includes("LEGACY VISUAL STAGING"), "legacy staging authoring must remain retired even for old opt-in projects");
    assert(!html.includes("composer-base-controls"), "legacy base-frame authoring controls must not render");
    assert(!html.includes(">Undo<"), "legacy staging undo controls must not render");
  }
  assert(motionHtml.includes("Direct motion"), "motion workspace should expose structured motion controls");
  assert(motionHtml.includes("Dialogue & voice"), "motion workspace should expose dialogue and voice routing");
  assert(motionHtml.includes("MOTION & SOUND BRIEF"), "motion workspace should expose the canonical Motion & Sound Brief");
  assert(motionHtml.includes("Persistent voice authority") || motionHtml.includes("PERSISTENT VOICE AUTHORITY"), "motion workspace should show persistent voice authority");
  assert(motionHtml.includes("SFX, ambience & music"), "motion workspace should expose structured sound direction");
  assert(motionHtml.includes("Spoken line — exact words"), "audio controls should separate literal dialogue");
  assert(motionHtml.includes("Production note — never quoted"), "audio controls should distinguish production notes from speech");
  assert(motionHtml.includes("motion-map-wrap"), "motion workspace should render the simple direction map");
  assert(composerHtml.includes("Choose reference angles"), "final-reference setup should group multiple views of an entity");
  assert(composerHtml.includes("Kai side view"), "grouped reference variants should expose alternate angles");
  assert(composerHtml.includes("Left profile"), "reference sets should display normalized angle names");
  assert(composerHtml.includes("Name & tag") || composerHtml.includes(">TAG<"), "reference variants should expose naming and angle metadata controls");
  assert(motionHtml.includes("Motion unit"), "motion director should expose per-unit selection");
  assert(motionHtml.includes("Move away"), "the active second motion unit should be visible");
  assert(motionHtml.includes("Generation package") || motionHtml.includes("Motion unit B package"), "the workspace should preview the exact target package");
}

function testDirectMotionControlsDriveCompactPrompt() {
  const context = contextFixture();
  context.shot.description = "Kai waits at the curb.";
  context.shot.motionDirection = "";
  context.references = [{ type: "character", id: "KAI", name: "Kai", canon: "", drift: "" }];
  const plan = motionFixture();
  plan.audio = { mode: "none", lipSync: false, referenceKey: "", speakerId: "" };
  let spec = PromptEngine.defaultSpec(context, "motion", "i2v", [], null);
  spec = PromptEngine.applyStructuredDirection(spec, null, plan, []);
  const compiled = PromptEngine.compile(PromptEngine.getProfile("seedance-2/i2v"), spec, []);
  assert(compiled.prompt.includes("The character assigned to this shot walk toward screen right"), "direct subject controls should lead the compact motion prompt without an ungrounded story name");
  assert(compiled.prompt.includes("Camera push in forward"), "direct camera controls should reach the compact motion prompt");
  assert(!/\bKai\b/.test(compiled.prompt), "the compact prompt should not use a character's story name without a mapped visual reference");
  assert(!compiled.warnings.some((warning) => /neither canon text|selected approved visual reference/i.test(warning)), "approved-frame motion modes should not emit irrelevant entity-canon warnings");
}

async function testMotionPreviewUsesApprovedStillAndPersistentDisclosures() {
  const project = withCanon(buildFixture(), [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  project.shots[0].creationBrief = {
    locationId: "LOC-HULL",
    propIds: ["PR-TOOL"],
    composition: compositionFixture(),
    motionPlan: motionFixture(),
    activeMotionUnitId: "motion-a",
    openPanels: { motion: true, motionDirector: true, motionAudio: true },
  };
  const { context } = await render("#/shot/L1-01", project);
  const map = vm.runInContext(`motionDirectorMap(P.shots[0])`, context);
  assert(map.includes('class="motion-map-base"'), "Direct motion should use the approved opening frame as its visual base");
  assert(map.includes("/assets/shots/L1-01/takes/FRAME_A.png"), "Direct motion should display the actual approved Frame A input");
  assert(map.includes('class="motion-map-marker'), "Direct motion should overlay lightweight assignment markers");
  assert(!map.includes("PR-TOOL-PLATE.png"), "Direct motion must not paste source-reference thumbnails into the approved frame preview");
  assert(map.includes("source-reference thumbnails are never composited"), "the preview should explain the input-versus-assignment distinction");
  const panel = vm.runInContext(`guidedMotionPanel(P.shots[0], guidedCurrentShotStill(P.shots[0]), takesFor("L1-01"), true)`, context);
  assert(/<details class="motion-director" open/.test(panel), "Direct motion should remain open after a rerender");
  assert(/<details class="guided-audio-block" open/.test(panel), "Dialogue and voice should remain open after a rerender");
  assert(panel.includes('class="guided-video-target-control"'), "the video target should be a visible labelled selector rather than a nested disclosure");
  for (const family of ["Seedance 2", "Kling 3", "LTX 2.3", "Happy Horse 1.1"])
    assert(panel.includes(`optgroup label="${family}"`), `motion target selector should expose ${family}`);
}

function testImageCompositionCompile() {
  const refs = references().filter((ref) => ref.mediaType === "image");
  let spec = PromptEngine.defaultSpec(
    contextFixture(),
    "first-frame",
    "multi-reference",
    refs,
    null,
  );
  spec = PromptEngine.applyStructuredDirection(spec, compositionFixture(), null, refs);
  const compiled = PromptEngine.compile(
    PromptEngine.getProfile("gpt-image-2/multi-reference"),
    spec,
    refs,
  );
  const staging = (spec.stagingLines || []).join("\n");
  assert(staging.includes("camera-right"), "composition should encode horizontal placement");
  assert(staging.includes("34 percent of frame width"), "composition should encode relative size");
  assert(staging.includes("front three quarter"), "composition should encode selected reference angle");
  assert(compiled.prompt.includes("camera-right"), "image prompt should contain staged placement");
  assert(compiled.prompt.includes("low angle"), "image prompt should contain camera controls");
  assert(compiled.prompt.includes("MUST INCLUDE"), "image prompt should express required relationships positively");
  assert(!compiled.prompt.includes("required shot contents and relationships"), "must-include content must not be filed as preservation");
  assert(!compiled.prompt.includes("Kai walks toward"), "frame compilation should not apply motion controls");
}

function testMotionAndOmniAudioCompile() {
  const refs = references();
  let spec = PromptEngine.defaultSpec(
    contextFixture(),
    "motion",
    "r2v",
    refs,
    null,
  );
  spec = PromptEngine.applyStructuredDirection(
    spec,
    compositionFixture(),
    motionFixture(),
    refs,
  );
  const compiled = PromptEngine.compile(
    PromptEngine.getProfile("seedance-2/r2v"),
    spec,
    refs,
  );
  assert.strictEqual(spec.camera.movement, "push in forward", "motion plan should set the camera move");
  assert(spec.actions.some((item) => item.action.includes("KAI walk toward screen right")), "motion plan should add the selected character movement");
  /* AMENDED BY DOGFOOD SLICE 1'S HOLD CORRECTION, deliberately and in the same commit as
     the change that makes it necessary. This fixture's prop row carries the DEFAULT
     action `static` and a note the filmmaker typed. The word `static` was never chosen by
     anyone — it is what the normalizer writes into a control nobody opened — and
     publishing it beside a declared sibling is the sibling-promotion this correction
     exists to end. The property the line has always actually guarded is that a staged
     prop's own direction reaches the compiled beats, and that is what it asserts now: the
     filmmaker's sentence, in their words, instead of a manufactured one. A prop whose
     action IS chosen still compiles it — asserted in tests/shot-intent-compiler-integrity.js. */
  assert(spec.actions.some((item) => item.action.includes("PR-CAR The car remains parked.")), "motion plan should carry a staged prop's declared direction");
  assert(!spec.actions.some((item) => item.action.includes("PR-CAR static")), "an untouched prop action must not be published beside a declared note");
  assert.strictEqual(spec.audio.mode, "lip-sync-reference", "audio assignment should use explicit lip-sync mode");
  assert.strictEqual(spec.audio.referenceLabel, "Kai dialogue take", "audio assignment should preserve the selected recording label");
  assert.strictEqual(spec.audio.dialogue, "", "lip-sync mode must not request a second generated voice");
  assert(compiled.prompt.includes("@audio1"), "Seedance Omni package should assign the audio token");
  assert(compiled.prompt.includes("as dialogue audio"), "Seedance Omni prompt should use the file as dialogue audio");
  assert(compiled.prompt.includes("every other visible character remains silent"), "Seedance Omni prompt should constrain unassigned speakers");
  assert(compiled.prompt.includes("@image2 — PROP"), "Omni contract should retain the vehicle reference role");
  assert(compiled.prompt.includes("@image3 — IDENTITY"), "Omni contract should retain the character identity role");
}


function testPromptGroundingRegression() {
  const project = buildFixture();
  project.meta.aspectRatio = "16:9";
  project.meta.format = "Short film · 16:9";
  project.scenes[0].title = "Maintenance log";
  project.characters[0].block = "Maintenance worker with a salt-and-pepper beard pattern. Preserve the suit patch layout + name-tag side in every view.";
  project.shots[0].risks = ["beard drift", "patch drift", "held-object continuity"];
  project.shots[0].desc = "The maintenance worker holds the panel tool at the hull access point.";
  const context = PromptEngine.buildContext(project, "L1-01");
  let spec = PromptEngine.defaultSpec(context, "first-frame", "multi-reference", context.references, null);
  const compiled = PromptEngine.compile(
    PromptEngine.getProfile("gpt-image-2/multi-reference"),
    spec,
    context.references,
  );
  assert(compiled.prompt.includes("salt-and-pepper beard pattern"), "deterministic prompts should restate drift-prone character features");
  assert(compiled.prompt.includes("suit patch layout + name-tag side"), "deterministic prompts should retain canon drift instructions verbatim");
  assert(compiled.prompt.includes("IDENTITY CANON"), "deterministic prompts should include usable identity canon");
  assert(!compiled.prompt.includes("needs the held top-of-lift beat or absence doesn't read"), "production risks must not be sent as model negatives");
  assert(!compiled.prompt.includes("ENVIRONMENT\nLOG 0121"), "scene slate titles must not be used as environments");
  assert(compiled.prompt.includes("Output at 16:9"), "aspect ratio should be parsed from the project format");
  assert.strictEqual(spec.productionRisks.length, 3, "production risks should remain available to the UI");

  const zeroRefContext = contextFixture();
  zeroRefContext.references = [];
  const zeroSpec = PromptEngine.defaultSpec(zeroRefContext, "first-frame", "multi-reference", [], null);
  const zeroChecks = PromptEngine.checks(PromptEngine.getProfile("gpt-image-2/multi-reference"), zeroSpec, []);
  assert(!zeroChecks.confirmations.some((item) => /Every selected reference|Continuity invariants|Failure constraints/i.test(item)), "zero-reference prompts should not claim reference roles, continuity invariants, or failure constraints succeeded");
}

function testLocationBaseAndSingleStagingEncoding() {
  const refs = references().filter((ref) => ref.mediaType === "image");
  const composition = compositionFixture();
  composition.elements.push({
    id: "location-box", referenceKey: "street", x: .5, y: .5, w: .3, h: .3,
    depth: "background", facing: "camera", view: "reference-view", notes: "LOCATION MUST NOT BECOME A BOX",
  });
  let spec = PromptEngine.defaultSpec(contextFixture(), "first-frame", "multi-reference", refs, null);
  spec = PromptEngine.applyStructuredDirection(spec, composition, null, refs);
  const compiled = PromptEngine.compile(PromptEngine.getProfile("gpt-image-2/multi-reference"), spec, refs);
  assert(!compiled.prompt.includes("LOCATION MUST NOT BECOME A BOX"), "locations should act as environmental bases, not staged objects");
  const placementClause = "approximately 34 percent of frame width by 24 percent of frame height";
  assert.strictEqual(compiled.prompt.split(placementClause).length - 1, 1, "staged placement should be encoded once");
  assert(/STAGING[\s\S]*CAMERA/.test(compiled.prompt), "staging and camera should compile into separate blocks");
}

async function testInteractiveComposerAndMotionUnits() {
  const project = buildFixture();
  project.shots[0].creationBrief = {
    locationId: "LOC-HULL",
    propIds: ["PR-TOOL"],
    composition: compositionFixture(),
    motionPlan: motionFixture(),
    activeMotionUnitId: "motion-b",
  };
  const { context } = await render("#/shot/L1-01", project);
  context.selectMotionUnit("L1-01", "motion-b");
  context.setMotionSubject("L1-01", "KAI", "action", "run");
  context.setMotionSubject("L1-01", "KAI", "targetId", "PR-TOOL");
  context.setMotionSubject("L1-01", "KAI", "destination", "beside the panel tool");
  const state = require("vm").runInContext(`(() => { const s=P.shots[0], c=ensureShotCreation(s), u=s.clips.find(x=>x.id==='motion-b'); return { active:c.activeMotionUnitId, action:u.motionPlan.subjects.KAI.action, target:u.motionPlan.subjects.KAI.targetId, targetLabel:u.motionPlan.subjects.KAI.targetLabel, destination:u.motionPlan.subjects.KAI.destination, defaultAction:c.motionPlan.subjects.KAI?.action || '', motionOpen:c.openPanels.motion, directorOpen:c.openPanels.motionDirector, storedElements:c.composition.elements.length }; })()`, context);
  assert(state.storedElements > 0, "stored legacy composition elements must remain readable after authoring removal");
  assert.strictEqual(state.active, "motion-b", "the selected motion unit should persist");
  assert.strictEqual(state.action, "run", "motion edits should be stored on the active unit");
  assert.strictEqual(state.target, "PR-TOOL", "motion units should store direct interaction targets");
  assert.strictEqual(state.targetLabel, "Panel tool", "direct targets should retain a readable label for compilation");
  assert.strictEqual(state.destination, "beside the panel tool", "motion units should store an explicit end position");
  assert.strictEqual(state.defaultAction, "walk", "unit overrides should not overwrite shot defaults");
  assert.strictEqual(state.motionOpen, true, "editing direct motion should keep the motion workflow open");
  assert.strictEqual(state.directorOpen, true, "editing direct motion should keep the Direct motion disclosure open");
}


function testGuideAuthoritativeFinalFrameAndVisualGrounding() {
  const context = contextFixture();
  context.project.world.setting = "The Black Iron Gates";
  context.project.styleBlocks = [{ id: "mixed-style", text: "The orange truck is flat cel art. The skulls and hellscape are dense cross-hatched dark fantasy." }];
  context.scene.beat = "Establish the tonal collision between suburban moving truck and epic netherworld dread.";
  context.shot.id = "S01-08";
  context.shot.description = "Rear right wheel and fender of an unmarked bright orange rental moving truck crush skulls at the contact point.";
  context.shot.positioning = "Medium low on rear wheels.";
  context.references = [
    { type: "location", id: "LOC-GATES", name: "The Black Iron Gates", canon: "", drift: "" },
    { type: "prop", id: "PROP-TRUCK", name: "The Moving Truck", canon: "", drift: "" },
  ];
  const refs = [
    { key: "blocking:S01-08", entityId: "S01-08", label: "S01-08 blocking guide", role: "composition", mediaType: "image", approved: true, url: "/assets/shots/S01-08/blocking/guide.png", blocking: true, blockingAdherence: "strict" },
    { key: "locations:LOC-GATES:approved", entityId: "LOC-GATES", entityName: "The Black Iron Gates", label: "The Black Iron Gates", role: "location", sourceType: "location", mediaType: "image", approved: true, url: "/assets/locations/gates.png" },
    { key: "props:PROP-TRUCK:approved", entityId: "PROP-TRUCK", entityName: "The Moving Truck", label: "The Moving Truck", role: "prop", sourceType: "prop", mediaType: "image", approved: true, url: "/assets/props/truck.png" },
  ];
  const composition = {
    camera: { shotSize: "wide", height: "eye-level", angle: "level", lens: "normal", view: "front", layout: "rule-of-thirds", crop: "full-scene" },
    elements: [
      { referenceKey: "props:PROP-TRUCK:approved", x: .5, y: .48, w: .72, h: .76, depth: "foreground", facing: "camera", view: "rear-three-quarter", crop: "detail", notes: "Use only the rear wheel and fender region." },
    ],
    mustInclude: "Skulls directly under the rear wheel at the crushing contact point",
  };
  let spec = PromptEngine.defaultSpec(context, "edit", "edit", refs, null);
  spec.blockingGuideAdherence = "strict";
  spec.mustPreserve.push("Duration constrained to exactly two seconds of continuous reverse crush action");
  spec = PromptEngine.applyStructuredDirection(spec, composition, null, refs);
  const result = PromptEngine.compile(PromptEngine.getProfile("gpt-image-2/edit"), spec, refs);
  assert.strictEqual(result.references[0].role, "composition", "blocking guide must be reordered to #image1");
  assert.match(result.prompt, /EDIT THE BLOCKING GUIDE/);
  assert.match(result.prompt, /#image1 as an editable geometric scaffold/i);
  assert.match(result.prompt, /#image2 is the visual canon for The Black Iron Gates/i);
  assert.match(result.prompt, /#image3 is the visual canon for The Moving Truck/i);
  assert.match(result.prompt, /#image3 — The Moving Truck: Apply only to The Moving Truck region in the foreground/i);
  assert.match(result.prompt, /Do not copy this reference's full-object framing/i);
  assert.doesNotMatch(result.prompt, /Create the shot still|\nCAMERA\n|\nSTAGING\n|Keep the full scene in frame/i);
  assert.doesNotMatch(result.prompt, /Duration constrained|two seconds of continuous/i);
  assert.doesNotMatch((result.warnings || []).join(" "), /no canon text|neither canon text/i);
  assert((result.confirmations || []).some((line) => /#image2 supplies the visual canon for The Black Iron Gates/i.test(line)));
  assert((result.confirmations || []).some((line) => /#image3 supplies the visual canon for The Moving Truck/i.test(line)));

  const missingGateRefs = [refs[0], refs[2]];
  const missingSpec = PromptEngine.defaultSpec(context, "edit", "edit", missingGateRefs, null);
  const warningText = (missingSpec.promptWarnings || []).join(" ");
  assert.match(warningText, /Black Iron Gates has neither canon text nor a selected approved visual reference/i);
  assert.doesNotMatch(warningText, /Moving Truck has neither canon text/i);
}

function testMultiAngleReferenceContracts() {
  const { referenceViewScore, referenceViewLabel } = require("../public/shared-reference-views");
  assert(referenceViewScore("rear-three-quarter-right", "rear-three-quarter-right", { referenceKind: "single-angle" }) >
    referenceViewScore("rear-three-quarter-right", "front", { referenceKind: "single-angle" }),
    "exact shot-facing angles should outrank incompatible views");
  assert.strictEqual(referenceViewLabel("rear-three-quarter-right"), "Rear-right three-quarter");

  const context = contextFixture();
  context.shot.id = "S01-08";
  context.shot.description = "Rear truck wheel crushes skull fragments at the blocking guide contact point.";
  context.references = [{ type: "prop", id: "PROP-TRUCK", name: "The Moving Truck", canon: "", drift: "" }];
  const refs = [
    { key: "guide", label: "S01-08 — Rear wheel crush B01", role: "composition", mediaType: "image", approved: true, blocking: true, blockingAdherence: "strict", url: "/guide.png" },
    {
      key: "truck-sheet", entityId: "PROP-TRUCK", entityName: "The Moving Truck",
      label: "Moving Truck — turnaround", role: "prop", sourceType: "prop", mediaType: "image", approved: true, url: "/truck-sheet.png",
      referenceKind: "contact-sheet", angleTag: "rear-three-quarter-right",
      availableAngles: "front, side, rear, rear-right three-quarter", guideRegion: "rear wheel and fender",
    },
    {
      key: "truck-wheel", entityId: "PROP-TRUCK", entityName: "The Moving Truck",
      label: "Moving Truck — rear wheel detail", role: "detail", sourceType: "prop", mediaType: "image", approved: true, url: "/wheel.png",
      referenceKind: "detail", detailRegion: "rear wheel and fender", guideRegion: "rear wheel and fender",
    },
  ];
  let spec = PromptEngine.defaultSpec(context, "edit", "edit", refs, null);
  spec.blockingGuideAdherence = "strict";
  const result = PromptEngine.compile(PromptEngine.getProfile("gpt-image-2/edit"), spec, refs);
  assert.match(result.prompt, /#image2.*multi-angle contact sheet/i);
  assert.match(result.prompt, /Use only the rear three quarter right view|Use only the rear-three-quarter-right view|Use only the rear right three quarter view/i);
  assert.match(result.prompt, /Do not reproduce the sheet layout, panel borders, labels, or multiple angles/i);
  assert.match(result.prompt, /#image3.*rear wheel and fender/i);
  assert.match(result.prompt, /Apply only to the rear wheel and fender region defined by the composition guide/i);
}

function testBaseFrameHiddenElementsAndTargets() {
  const refs = references().filter((ref) => ref.mediaType === "image");
  const composition = compositionFixture();
  composition.baseFrame = { source: "ref:street", zoom: 1.25, panX: 10, panY: -5, rotation: 3, fit: "cover" };
  composition.elements.push({ id: "hidden", referenceKey: "street", x: .5, y: .5, w: 1, h: 1, depth: "background", facing: "camera", view: "front", hidden: true, order: 99, notes: "THIS MUST NOT COMPILE" });
  const motion = motionFixture();
  motion.subjects.KAI.targetId = "PR-CAR";
  motion.subjects.KAI.targetLabel = "Hero car";
  motion.subjects.KAI.destination = "at the driver-side door";
  let spec = PromptEngine.defaultSpec(contextFixture(), "motion", "r2v", refs, null);
  spec = PromptEngine.applyStructuredDirection(spec, composition, motion, refs);
  const staging = (spec.stagingLines || []).join("\n");
  assert(staging.includes("zoom in to 125 percent"), "base-frame zoom should reach the structured prompt spec");
  assert(staging.includes("rotate 3 degrees clockwise"), "base-frame rotation should reach the structured prompt spec");
  assert(!staging.includes("THIS MUST NOT COMPILE"), "hidden composer elements should not reach prompts");
  assert(spec.actions.some((item) => item.action.includes("Hero car") && item.action.includes("driver-side door")), "direct interaction targets and destinations should reach motion actions");
}

function testSharedEntityResolver() {
  const { resolveShotEntities, shotEntityTokenMatches } = require("../public/shared-entities");
  const project = buildFixture();
  project.shots[0].codes = ["LOC-HULL-A", "PR-TOOL-REAR"];
  assert(shotEntityTokenMatches("LOC-HULL-A", "LOC-HULL"));
  assert(!shotEntityTokenMatches("LOC-HULLWAY", "LOC-HULL"));
  const resolved = resolveShotEntities(project, project.shots[0]);
  assert(resolved.locations.some((item) => item.id === "LOC-HULL"), "suffixed location codes should resolve to the canonical location");
  assert(resolved.props.some((item) => item.id === "PR-TOOL"), "suffixed prop codes should resolve to the canonical prop");
}

async function testPickerAndLocalNudge() {
  const project = buildFixture();
  project.shots[0].codes = ["LOC-HULL-A", "PR-TOOL-REAR"];
  project.shots[0].creationBrief = { locationId: "", propIds: [], composition: compositionFixture(), motionPlan: motionFixture() };
  const { html, context } = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" } });
  assert(html.includes("Cast and assets attached to this shot"), "shot workspace should render attachment controls");
  assert(html.includes("setShotCreationLocation('L1-01','LOC-HULL')"), "location picker should be reachable");
  assert(html.includes("toggleShotCreationCharacter('L1-01','KAI')"), "character picker should be reachable");
  assert(html.includes("toggleShotCreationProp('L1-01','PR-TOOL')"), "prop picker should be reachable");
  require("vm").runInContext(`window.__routeCount=0; route=()=>{window.__routeCount++}; ensureShotCreation(P.shots[0]).propIds=[];`, context);
  context.toggleShotCreationProp("L1-01", "PR-TOOL");
  const codes = require("vm").runInContext(`P.shots[0].codes.slice()`, context);
  assert(codes.includes("PR-TOOL-REAR"), "attaching a prop should preserve its existing suffixed code");
  /* AND IT NOW WRITES ITS OWN EXACT TOKEN BESIDE IT.
   *
   * This line used to require the opposite — that no bare `PR-TOOL` be added —
   * and that expectation is superseded by the relationship-ownership fix. A
   * suffixed token says more than the picker can express, so the picker must not
   * be able to delete it; but then an explicit selection over one has to be
   * recorded somewhere the picker CAN take back, or clearing it later would be
   * indistinguishable from deleting the suffixed relationship itself. The exact
   * token is that record. Nothing is duplicated in meaning: `PR-TOOL-REAR` is the
   * shot's legacy code, `PR-TOOL` is the filmmaker's picker selection, and
   * clearing removes only the second. */
  assert(codes.includes("PR-TOOL"), "an explicit picker selection must record itself as an exact token it can take back");
  const routeCount = require("vm").runInContext(`window.__routeCount`, context);
  assert.strictEqual(routeCount, 1, "the attachment mutation should rerender once");
  /* The round trip, measured after the render-count claim above so a second
     deliberate mutation cannot be mistaken for a stray re-render. */
  require("vm").runInContext(`toggleShotCreationProp("L1-01","PR-TOOL")`, context);
  const afterClear = require("vm").runInContext(`P.shots[0].codes.slice()`, context);
  assert(afterClear.includes("PR-TOOL-REAR"), "and clearing that selection must leave the suffixed code alone");
  assert(!afterClear.includes("PR-TOOL"), "removing only the exact token it added");
  assert.strictEqual(typeof context.nudgeComposerElement, "undefined", "legacy staging nudge controls must be removed");
}


function testNaturalCameraPhrasingAndStagingPunctuation() {
  const refs = references().filter((ref) => ref.mediaType === "image");
  const composition = compositionFixture();
  composition.camera = {
    shotSize: "medium",
    height: "eye-level",
    angle: "level",
    lens: "normal",
    view: "three-quarter-left",
    layout: "negative-right",
    crop: "waist-up",
    reframe: "preserve-loosely",
  };
  let spec = PromptEngine.defaultSpec(contextFixture(), "first-frame", "multi-reference", refs, null);
  spec = PromptEngine.applyStructuredDirection(spec, composition, null, refs);
  const compiled = PromptEngine.compile(PromptEngine.getProfile("gpt-image-2/multi-reference"), spec, refs);
  const cameraBlock = (compiled.prompt.match(/CAMERA\n([\s\S]*?)(?:\n\n|$)/) || [])[1] || "";
  const stagingBlock = (compiled.prompt.match(/STAGING\n([\s\S]*?)(?:\n\n|$)/) || [])[1] || "";
  assert(cameraBlock.includes("Medium shot"), "camera phrasing should read as a shot description");
  assert(cameraBlock.includes("subject's eye line"), "eye-level camera height should use natural language");
  assert(cameraBlock.includes("Negative space at frame right") || cameraBlock.includes("negative space at frame right"), "layout should explain negative space in model-readable language");
  assert(cameraBlock.includes("waist-up"), "crop should compile as natural framing language");
  assert(!cameraBlock.includes("medium, eye level, level"), "camera block must not dump comma-separated dropdown labels");
  assert((cameraBlock.match(/\blevel\b/gi) || []).length <= 1, "camera phrasing must not repeat the word level");
  for (const line of stagingBlock.split("\n").map((item) => item.trim()).filter(Boolean))
    assert(/[.!?]$/.test(line), `staging line should end with punctuation: ${line}`);
}

async function testProductionRiskAndMultiLocationSurfaces() {
  const project = buildFixture();
  project.locations.push({
    id: "LOC-CORRIDOR",
    name: "Service corridor",
    status: "APPROVED",
    workflowStatus: "APPROVED",
    notes: "Supporting corridor geography.",
    approvedFile: "LOC-CORRIDOR-PLATE.png",
    continuityStates: [],
  });
  project.shots[0].codes = ["LOC-HULL-A", "LOC-CORRIDOR-B", "PR-TOOL"];
  project.shots[0].risks = ["LOCK this framing — the bookend shot derives from it.", "Keep the tool contact readable."];
  project.shots[0].creationBrief = {
    locationId: "LOC-HULL",
    propIds: ["PR-TOOL"],
    composition: compositionFixture(),
    motionPlan: motionFixture(),
  };
  const { html, context } = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" } });
  assert(html.includes("supporting location · select to make primary"), "additional resolved locations should be disclosed as supporting locations");
  assert(html.includes("2 locations are attached"), "the attachment panel should disclose multi-location shots");

  const riskBuild = {
    id: "risk-build",
    profileId: "gpt-image-2/multi-reference",
    profileName: "GPT Image 2",
    mode: "multi-reference",
    prompt: "Create a frame.",
    warnings: [],
    references: [],
    productionRisks: project.shots[0].risks,
  };
  context.__riskBuild = riskBuild;
  const frameResult = require("vm").runInContext(`guidedFramePromptResult(P.shots[0], guidedFrames(P.shots[0])[0], __riskBuild)`, context);
  const motionResult = require("vm").runInContext(`guidedMotionPromptResult(P.shots[0], __riskBuild)`, context);
  assert(frameResult.includes("guided-review-checks") && frameResult.includes("review checks"), "frame prompt results should keep production risks available in a compact review disclosure");
  assert(motionResult.includes("guided-review-checks") && motionResult.includes("review checks"), "motion prompt results should keep production risks available in a compact review disclosure");
  require("vm").runInContext(`ensureShotCreation(P.shots[0]).promptBuilds=[__riskBuild]; ensureShotCreation(P.shots[0]).motionPromptBuilds=[__riskBuild];`, context);
  const frameCandidates = require("vm").runInContext(`(() => { const s=P.shots[0], f=guidedFrames(s)[0], takes=takesFor(s.id), step=guidedFrameStepState(s,f,0,takes); return guidedFrameCandidatesPanel(s,f,0,takes,step); })()`, context);
  const motionCandidates = require("vm").runInContext(`guidedMotionCandidatePanel(P.shots[0], [], null)`, context);
  assert(!frameCandidates.includes("guided-production-risks"), "frame candidate review should not duplicate prompt risk notes");
  assert(!motionCandidates.includes("guided-production-risks"), "motion candidate review should not duplicate prompt risk notes");

  require("vm").runInContext(`route=()=>{};`, context);
  context.setShotCreationLocation("L1-01", "LOC-CORRIDOR");
  const locationState = require("vm").runInContext(`({ locationId:P.shots[0].creationBrief.locationId, codes:P.shots[0].codes.slice() })`, context);
  assert.strictEqual(locationState.locationId, "LOC-CORRIDOR", "a supporting location should be selectable as the primary plate");
  assert(locationState.codes.includes("LOC-HULL-A"), "changing the primary among attached locations must preserve the previous location code");
  assert(locationState.codes.includes("LOC-CORRIDOR-B"), "changing the primary must preserve the selected suffixed location code");
}


function testBlockingPromptAndCompositionFence() {
  const context = contextFixture();
  context.shot.description = "Kai, wearing a bulky white pressure suit with orange patches, sits beside the radio.";
  context.shot.positioning = "Kai is camera-left beside the radio; the galley surrounds them.";
  context.references = [
    { type: "character", id: "KAI", name: "Kai", canon: "A grizzled astronaut with a salt-and-pepper beard and white EVA suit.", drift: "Keep the beard and orange patches.", blockingNote: "a seated figure labelled \"KAI\"" },
    { type: "location", id: "LOC-GALLEY", name: "Galley interior", canon: "1970s industrial galley." },
    { type: "prop", id: "PROP-RADIO", name: "bench radio", canon: "A black bakelite radio." },
  ];
  const composition = {
    aspectRatio: "16:9",
    camera: { shotSize: "medium", height: "eye-level", angle: "level", lens: "normal", view: "three-quarter-left", layout: "negative-right", crop: "waist-up" },
    elements: [
      { id: "kai", referenceKey: "characters:KAI:default", label: "Kai", x: .3, y: .56, w: .35, h: .6, depth: "midground", facing: "camera-left", view: "three-quarter-left", notes: "seated" },
      { id: "radio", referenceKey: "props:PROP-RADIO:default", label: "Radio", x: .72, y: .62, w: .2, h: .18, depth: "background", facing: "camera", view: "reference-view", notes: "on the bench" },
      { id: "location", referenceKey: "locations:LOC-GALLEY:default", label: "Galley", x: .5, y: .5, w: 1, h: 1, depth: "background" },
    ],
  };
  const blockingProfile = PromptEngine.getProfile("gpt-image-2/blocking");
  let spec = PromptEngine.defaultSpec(context, "blocking", "blocking", [], null);
  spec = PromptEngine.applyStructuredDirection(spec, composition, null, []);
  spec = PromptEngine.applyBlockingPlan(spec, context, composition, { emphasis: "balanced", frameBrief: context.shot.description, direction: context.shot.positioning });
  const result = PromptEngine.compile(blockingProfile, spec, []);
  assert.match(result.prompt, /BLOCKING FRAME — shot SC01-03/);
  assert.match(result.prompt, /STYLE CONTRACT/);
  assert.match(result.prompt, /LABELS/);
  assert.match(result.prompt, /a seated figure labelled "KAI"/i);
  assert.match(result.prompt, /bench radio labelled "PROP-RADIO"/i);
  assert.match(result.prompt, /Galley interior as the surrounding environment/i);
  assert.doesNotMatch(result.prompt, /IDENTITY CANON|RESTATE \(drift-prone|APPROVED VISUAL STYLE/i);
  assert.doesNotMatch(result.prompt, /salt-and-pepper|orange patches|white EVA/i);
  assert.strictEqual(result.references.length, 0, "blocking profiles must send zero references");
  assert.doesNotMatch((result.warnings || []).join(" "), /No reference images are selected|continuity may be weaker/i);
  const layout = result.prompt.split("LAYOUT\n")[1].split("\n\nLABELS")[0];
  assert.strictEqual((layout.match(/Galley interior/g) || []).length, 1, "location should be the surrounding environment, not a staged box");

  const productionProfile = PromptEngine.getProfile("gpt-image-2/multi-reference");
  const productionContext = contextFixture();
  productionContext.references = context.references;
  let productionSpec = PromptEngine.defaultSpec(productionContext, "first-frame", "multi-reference", [], null);
  productionSpec.blockingGuideAdherence = "strict";
  const guide = [{ key: "blocking", label: "SC01-03 blocking guide", role: "composition", mediaType: "image", approved: true, url: "/assets/shots/SC01-03/blocking/SC01-03_BLOCKING.png", blocking: true }];
  const production = PromptEngine.compile(productionProfile, productionSpec, guide);
  assert.match(production.prompt, /COMPOSITION GUIDE/);
  assert.match(production.prompt, /Do not render any text, labels?, lettering/i);
  assert.match(production.prompt, /editable geometric scaffold/i);
  assert.match(production.prompt, /does not define finished architecture, fence or gate pattern/i);
  assert.match(production.prompt, /Rebuild the finished location from approved location references and location canon/i);
  assert.match(production.references[0].instruction, /Blocking\/?animatic geometry only/i);
  assert.match(production.references[0].instruction, /Do not use for.*architecture, fence or gate pattern/is);
  assert.doesNotMatch(production.references[0].instruction, /Do not render any text, label, or lettering.*Do not render any text, label, or lettering/is, "the detailed fence should have one authoritative prompt block");
}

function testActionInsertBlockingInference() {
  const context = contextFixture();
  context.project.world.setting = "The Black Iron Gates";
  context.shot.id = "S01-08";
  context.shot.description = "Tight on rear wheels reversing onto skulls. Skulls CRUNCH. Truck shows no damage.";
  context.shot.positioning = "Medium low on rear wheels.";
  context.scene.beat = "The truck crosses the gate threshold.";
  context.references = [{ type: "location", id: "LOC-GATES", name: "The Black Iron Gates", canon: "The Black Iron Gates" }];
  const composition = { camera: { shotSize: "wide", height: "eye-level", angle: "level", lens: "normal", view: "front", layout: "rule-of-thirds", crop: "full-scene" }, elements: [] };
  let spec = PromptEngine.defaultSpec(context, "blocking", "blocking", [], null);
  spec = PromptEngine.applyStructuredDirection(spec, composition, null, []);
  spec = PromptEngine.applyBlockingPlan(spec, context, composition, { emphasis: "auto", frameBrief: context.shot.description, direction: "Medium low on rear wheels" });
  const result = PromptEngine.compile(PromptEngine.getProfile("gpt-image-2/blocking"), spec, []);
  assert.strictEqual(spec.blockingPlan.emphasis, "action-insert");
  assert.match(result.prompt, /Close-up/);
  assert.match(result.prompt, /tight detail insert/i);
  assert.match(result.prompt, /rear wheels dominate the foreground/i);
  assert.match(result.prompt, /skulls are positioned directly at the physical contact point/i);
  assert.doesNotMatch(result.prompt, /Wide shot|Keep the full scene in frame|Black Iron Gates/i);
  assert((spec.blockingPlan.conflictsResolved || []).some((item) => /wide\/full-scene/i.test(item)));
}

async function testBlockingWorkspaceAndMotionExclusion() {
  const project = buildFixture();
  project.mediaAssets.push({
    id: "blocking-1",
    file: "L1-01_BLOCKING.png",
    storagePath: "shots/L1-01/blocking/L1-01_BLOCKING.png",
    title: "L1-01 Blocking",
    originalName: "L1-01_BLOCKING.png",
    links: [{ id: "blocking-link", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "active", blockingAdherence: "strict", generationInput: true, priority: "primary", order: 3 }],
  });
  project.shots[0].creationBrief = {
    activeBlockingAssetId: "blocking-1",
    blockingGuideAdherence: "strict",
    locationId: "LOC-HULL",
    propIds: ["PR-TOOL"],
  };
  const { html, context } = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "blocking" } });
  const composerView = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "composer" } });
  const composerHtml = composerView.html;
  assert(html.includes("<span>BLOCKING</span>"));
  assert(html.includes("Composition guide active"));
  assert(composerHtml.includes("FINAL REFERENCES"), "active blocking guides should expose the simplified final-reference workflow");
  assert(composerHtml.includes("Assign appearance references to the guide"), "guide-first workflow should prioritize angle and appearance assignment");
  assert(composerHtml.includes("Blocking is geometry only"), "guide-first workflow should state that blocking cannot define finished location design");
  assert(!composerHtml.includes("LEGACY VISUAL STAGING"), "the full-color staging canvas should stay retired from the normal workflow");
  assert(composerHtml.includes("Guide region"), "guide-first reference sets should accept named region assignments");
  assert(!composerHtml.includes("Save assignment"), "guide-first references should save immediately instead of showing redundant assignment buttons");
  assert(!composerHtml.includes(">BOUND<"), "guide-first cards should use one clear assignment status instead of overlapping BOUND labels");
  const composerMarkup = require("vm").runInContext(`guidedShotComposerPanel(P.shots[0], true)`, context);
  assert(!composerMarkup.includes("L1-01 Blocking</b>"), "the active blocking guide must not appear as an appearance-angle assignment card");
  assert(!composerMarkup.includes("Use as base"), "locations should be appearance assignments, not competing composition bases, when a guide is active");
  assert(html.includes("Action insert"), "blocking panel should expose emphasis control");
  assert(html.includes("Changes for the next blocking attempt"), "blocking panel should expose plain-language structural revision requests");
  assert(html.includes("Full-colour references and finished location design are intentionally excluded"), "blocking revisions should remain grayscale and structural");
  assert(html.includes("buildBlockingPrompt('L1-01',true)"), "blocking panel should expose prompt improvement");
  const revisedBlocking = require("vm").runInContext(`falBlockingRevisionPrompt(P.shots[0], {prompt:"BASE BLOCKING"}, "blocking-1", "Make the object twice as large and lower the camera")`, context);
  assert.match(revisedBlocking, /BLOCKING REVISION/);
  assert.match(revisedBlocking, /twice as large and lower the camera/);
  assert.match(revisedBlocking, /Do not introduce finished identity, colour, materials, lighting, location design/i);
  assert(!html.includes("requestComposerStaging"), "the normal guide workflow should use text blocking revisions instead of visual staging assistance");
  assert(html.includes("BLOCKING"));
  assert(html.includes("Remove guide"));
  assert(html.includes("Rename"), "blocking frames should expose readable naming controls");
  assert(!html.includes("APPROVE SHOT IMAGE</button></div></article>"), "blocking card must not expose production approval");
  const vm = require("vm");
  const frameMode = vm.runInContext(`guidedFrameMode(guidedFrameState(P.shots[0], guidedFrames(P.shots[0])[0], 0), shotCreationPromptReferences(P.shots[0]))`, context);
  assert.strictEqual(frameMode, "edit", "an active blocking guide should select an edit/base-image workflow");
  const videoProfile = vm.runInContext(`guidedVideoProfiles().find((item) => item.id === "seedance-2/r2v")`, context);
  context.__blockingVideoProfile = videoProfile;
  const motionRefs = vm.runInContext(`guidedMotionReferences(P.shots[0], { name: "FRAME_A.png", url: "/assets/shots/L1-01/takes/FRAME_A.png" }, __blockingVideoProfile)`, context);
  assert(!motionRefs.some((ref) => ref.blocking || /blocking/i.test(ref.sourceRole || "")), "blocking media must not enter motion reference packages");
  assert.strictEqual(typeof context.applyComposerAssistantProposal, "undefined", "legacy staging assistant application must be removed");
}

function cloneProject() {
  const project = buildFixture();
  project.characters[0].audio = { voiceDesignPrompt: "Calm mid-deep male voice with measured technical delivery." };
  project.audio = [
    { id: "VOICE-KAI-CLEAN", name: "Kai — clean voice master", role: "voice", cleanMaster: true, sameObjectAs: "", notes: "Calm mid-deep male voice with measured technical delivery." },
    { id: "VOICE-SYSTEM-OVERWRITE", name: "System overwrite voice", role: "voice", cleanMaster: false, sameObjectAs: "VOICE-KAI-CLEAN", notes: "Same source voice as Kai — clean voice master." },
  ];
  project.shots[0].audio = { vo: "Production note only.", line: "", speakerId: "", note: "", voiceEntityId: "", sfx: "" };
  project.shots[0].creationBrief = project.shots[0].creationBrief || {};
  delete project.shots[0].creationBrief.motionPlan;
  return JSON.parse(JSON.stringify(project));
}

function compileProjectMotion(project, profileId, segmentId = "", refs = []) {
  const context = PromptEngine.buildContext(project, "L1-01", segmentId);
  const profile = PromptEngine.getProfile(profileId);
  let spec = PromptEngine.defaultSpec(context, "motion", profile.mode, refs, null);
  spec = PromptEngine.applyStructuredDirection(spec, context.shot.composition, context.shot.motionPlan, refs);
  return { context, profile, spec, compiled: PromptEngine.compile(profile, spec, refs) };
}

function testProtectedCompilerHashes() {
  const fs = require("fs");
  const crypto = require("crypto");
  /* The hashes below pin the canonical source git stores, not the bytes one checkout
     happens to hold. `.gitattributes` sets `* text=auto`, so a Windows clone with
     core.autocrlf=true materialises this file with CRLF endings and every hash mismatches
     on line endings alone — a permanently red check that says nothing about the compiler
     and trains everyone to ignore it. Normalising to LF is what makes the assertion mean
     what it claims: the compiler text is unchanged, on every platform. It removes no
     strictness — a single altered character still moves the hash. */
  const source = fs.readFileSync(require.resolve("../prompt-engine"), "utf8").replace(/\r\n/g, "\n");
  const expected = {
    compileSeedanceI2VCompact: "fc610ec962969248aedb9cb6e1d7d182543c49cf7f8029df143e61f171d356af",
    compileKlingI2VCompact: "b4b2bd06b014ba3fad11dc01eba3c226fd11d8a83fc1fb041050bc1a904abd7c",
    compileLtxI2VFlowing: "50ba593f291d18aeba567b5936fdad3701ed493eac75eb803642df0f3083c0be",
    compileHappyHorseI2VCompact: "ffab0f2634b6eef7455068e67988bc9cf770e02c5d6ca28ccce8bff446e88170",
    compileWanI2VCompact: "c0dbe05ca759e1ec11fea57dfba6d70f1971585fb52e842518f12f73cdcf374d",
    compileGenericI2VCompact: "5ab758378cee54c80595bcd44b024c79a9483c512bf4035cc6ed50008466399c",
    compileCompactFLF: "2d1f91d30ce1fe435d669c44b8154a73a8b9b7a876b29a88caa6d57d7914329c",
    compileSeedanceOmni: "982e84b542d472a617861d863056a8490c2b69dec9b5c5d96e72ce38f8f799c5",
  };
  for (const [name, hash] of Object.entries(expected)) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} should exist`);
    const next = source.indexOf("\nfunction ", start + 10);
    const body = source.slice(start, next < 0 ? source.length : next).trimEnd();
    /* A slice that collapsed to a signature would hash "successfully" while protecting
       nothing, so the boundary is checked rather than assumed. */
    assert(body.split("\n").length > 2, `${name} body should span more than its signature`);
    const actual = crypto.createHash("sha256").update(body).digest("hex");
    assert.strictEqual(actual, hash, `${name} must match the reviewed v6.3.0 compiler contract`);
  }
  const covered = Object.keys(expected).sort();
  const routed = PROTECTED_COMPILER_ROUTES.map((route) => route.compiler).sort();
  assert.deepStrictEqual(routed, covered, "every protected compiler must also carry a compiled-output contract");
}

/* The compiled-output contract the hashes above exist to defend.
 *
 * A source hash can say that a compiler's text changed. It cannot say what the change did
 * to a motion package, and it cannot be read by anyone deciding whether that change was
 * intended. These assertions name the fields a package is actually judged on — prompt
 * body, chosen references and their order, model identifier, aspect ratio, resolution,
 * duration, and the first/last-frame and multi-keyframe contracts — so an edit that
 * legitimately moves a hash still has to declare, in its own diff, what it did to the
 * output. Everything here is a pure in-process compile: no server, no network, no
 * provider, no clock and no randomness. */
const PROTECTED_COMPILER_ROUTES = [
  { compiler: "compileSeedanceI2VCompact", profileId: "seedance-2/i2v", refCount: 1 },
  { compiler: "compileKlingI2VCompact", profileId: "kling-3/i2v", refCount: 1 },
  { compiler: "compileLtxI2VFlowing", profileId: "ltx-2.3/i2v", refCount: 1 },
  { compiler: "compileHappyHorseI2VCompact", profileId: "happy-horse-1.1/i2v", refCount: 1 },
  { compiler: "compileWanI2VCompact", profileId: "wan-2.7/i2v", refCount: 1 },
  /* No shipped profile reaches the generic branch — it is the fallback for an i2v family
     the library does not yet name — so it is exercised through the same public compile()
     entry with an unknown family rather than left hash-only and untested. */
  { compiler: "compileGenericI2VCompact", profileId: "seedance-2/i2v", refCount: 1, unknownFamily: "unknown-vendor" },
  { compiler: "compileCompactFLF", profileId: "seedance-2/flf", refCount: 2 },
  { compiler: "compileSeedanceOmni", profileId: "seedance-2/r2v", refCount: 4, role: "sequential-keyframe" },
];

const PROTECTED_ACTIONS = [
  { start: 0, end: 3, action: "The first teal strand moves through the dormant vines." },
  { start: 3, end: 7, action: "The remaining strands spread through the greenhouse in sequence." },
  { start: 7, end: 10, action: "One flower opens and the motion settles into a brief hold." },
];

function protectedCompilerContext(aspectRatio = "16:9") {
  return {
    project: { world: { setting: "Orbital greenhouse" }, styleBlocks: [], aspectRatio },
    scene: { title: "Signal Bloom", beat: "The dormant greenhouse wakes.", feeling: "Quiet wonder" },
    shot: {
      id: "S02-01",
      title: "Activation travels",
      description: "Three strands of teal light travel through dead vines and wake a single flower.",
      durationSeconds: 10,
      motionDirection: "The activation travels in a controlled sequence while the camera slowly pushes in.",
      audio: { dialogue: "Air scrubbers nominal.", speakerId: "KAI", sfx: "low electrical hum, glass resonance" },
      risks: ["identity drift", "greenhouse geometry drift"],
    },
    references: [],
  };
}

/* Endpoint roles for a two-frame package, sequential waypoints beyond that, so the
   first/last-frame and multi-keyframe contracts are driven by the same builder. */
function protectedCompilerRefs(count, role) {
  return Array.from({ length: count }, (_, index) => ({
    key: `kf-${index + 1}`,
    label: `Approved Frame ${String.fromCharCode(65 + index)}`,
    mediaType: "image",
    role: role || (index === 0 ? "first-frame" : index === count - 1 ? "last-frame" : "keyframe"),
    approved: true,
    url: `/assets/shots/S02-01/takes/FRAME_${String.fromCharCode(65 + index)}.png`,
    instruction: `Beat ${index + 1}`,
  }));
}

function compileProtected(route, { aspectRatio = "16:9", refs } = {}) {
  const context = protectedCompilerContext(aspectRatio);
  const base = PromptEngine.getProfile(route.profileId);
  assert(base, `${route.profileId} should exist`);
  const profile = route.unknownFamily
    ? { ...base, id: `${route.unknownFamily}/i2v`, family: route.unknownFamily, name: "Unnamed vendor image-to-video" }
    : base;
  const chosen = refs || protectedCompilerRefs(route.refCount, route.role);
  let spec = PromptEngine.defaultSpec(context, "motion", profile.mode, chosen, null);
  spec.durationSeconds = 10;
  spec.actions = PROTECTED_ACTIONS.map((action) => ({ ...action }));
  spec.camera = { ...(spec.camera || {}), movement: "slow push in", stability: "smooth" };
  spec.audio = { ...(spec.audio || {}), sfx: "low electrical hum, glass resonance", ambience: "quiet greenhouse room tone" };
  spec = PromptEngine.applyStructuredDirection(spec, context.shot.composition, context.shot.motionPlan, chosen);
  return { profile, refs: chosen, compiled: PromptEngine.compile(profile, spec, chosen) };
}

function testProtectedCompilerOutputContract() {
  for (const route of PROTECTED_COMPILER_ROUTES) {
    const { profile, refs, compiled } = compileProtected(route);
    const where = route.compiler;

    /* Deterministic serialization: the same inputs must compile to the same bytes. */
    const again = compileProtected(route).compiled;
    assert.strictEqual(compiled.prompt, again.prompt, `${where} must compile deterministically`);
    assert.deepStrictEqual(compiled.payload, again.payload, `${where} payload must serialize deterministically`);

    /* Prompt text: the directed action and the camera move both survive compaction. */
    assert(compiled.prompt.trim().length > 0, `${where} must produce a prompt`);
    /* Case-insensitive because some families lower the first word to splice the action
       into a lead-in clause; the directed wording itself must survive intact. */
    assert(/first teal strand moves through the dormant vines/i.test(compiled.prompt), `${where} must carry the directed action`);
    assert(/push in/i.test(compiled.prompt), `${where} must carry the camera move`);
    assert(!/undefined|\[object Object\]|NaN/.test(compiled.prompt), `${where} must not leak placeholder values into the prompt`);

    /* Model identifier and duration, as the dispatch layer will read them. */
    assert.strictEqual(compiled.payload.adapter, profile.id, `${where} must name its own adapter`);
    assert.strictEqual(compiled.payload.modelFamily, profile.family, `${where} must name its model family`);
    assert.strictEqual(compiled.payload.mode, profile.mode, `${where} must name its workflow mode`);
    assert.strictEqual(compiled.payload.mediaType, "video", `${where} is a video compiler`);
    assert(compiled.payload.profileVersion, `${where} must carry a profile version`);
    assert.strictEqual(compiled.payload.durationSeconds, 10, `${where} must carry the shot duration`);

    /* Selected references and Frame ordering: input order is output order, positionally. */
    assert.strictEqual(compiled.references.length, route.refCount, `${where} must select exactly the supplied references`);
    assert.deepStrictEqual(
      compiled.payload.references.map((ref) => ref.url),
      refs.map((ref) => ref.url),
      `${where} must preserve reference order`,
    );
    assert.deepStrictEqual(
      compiled.payload.references.map((ref) => ref.role),
      refs.map((ref) => ref.role),
      `${where} must preserve reference roles`,
    );
    compiled.payload.references.forEach((ref, index) => {
      assert(/^[@#]?image\d+$|^Image \d+$/i.test(String(ref.token || "")), `${where} reference ${index + 1} must carry a numbered token, got ${ref.token}`);
      assert(String(ref.token).includes(String(index + 1)), `${where} reference ${index + 1} must be numbered by position`);
    });

    /* Aspect ratio must not reach a video prompt body. Format is a dispatch field for the
       one family that carries it; a compiler that started writing the ratio into prose
       would silently make every reformat a prompt change. */
    for (const ratio of ["9:16", "1:1", "21:9", "2.39:1", "4:3", "3:4"]) {
      const reformatted = compileProtected(route, { aspectRatio: ratio }).compiled;
      assert.strictEqual(reformatted.prompt, compiled.prompt, `${where} must compile identically at ${ratio}`);
    }
  }
}

function testProtectedCompilerPerFamilyContract() {
  const promptFor = (compiler) => compileProtected(PROTECTED_COMPILER_ROUTES.find((route) => route.compiler === compiler)).compiled;

  /* I2V models already hold the complete visual state in the start image, so the compact
     compilers deliberately omit reference maps and canon blocks. */
  const seedance = promptFor("compileSeedanceI2VCompact");
  assert(!/@image\d/.test(seedance.prompt), "Seedance I2V must not emit a reference legend");
  assert(seedance.prompt.startsWith("The first teal strand"), "Seedance I2V leads with the action");
  assert(/Native audio:/.test(seedance.prompt), "Seedance I2V must declare native audio");

  const kling = promptFor("compileKlingI2VCompact");
  assert(/From the supplied starting image/i.test(kling.prompt), "Kling I2V must anchor to the supplied start image");
  assert(!/#image\d/.test(kling.prompt), "Kling I2V must not emit a reference legend");

  const ltx = promptFor("compileLtxI2VFlowing");
  assert(/The supplied first frame is the exact opening composition/i.test(ltx.prompt), "LTX I2V must lock the opening composition");
  assert(/Across the 10-second shot/.test(ltx.prompt), "LTX I2V must state the duration in the prompt body");

  const happy = promptFor("compileHappyHorseI2VCompact");
  assert(/^Visible motion only:/.test(happy.prompt), "Happy Horse I2V must restrict itself to visible motion");
  assert(/Camera instruction:/.test(happy.prompt), "Happy Horse I2V must label its camera instruction");

  const wan = promptFor("compileWanI2VCompact");
  assert(/^SUBJECT MOTION:/.test(wan.prompt), "Wan I2V must lead with subject motion");
  assert(/\nCAMERA:/.test(wan.prompt), "Wan I2V must carry a separate camera line");
  assert(wan.payload.negativePrompt, "Wan packages must carry a negative prompt field");

  const generic = promptFor("compileGenericI2VCompact");
  assert(/The first teal strand/.test(generic.prompt), "an unnamed i2v family must still receive the action");
  assert(/push in/i.test(generic.prompt), "an unnamed i2v family must still receive the camera move");

  /* First and last Frame: both endpoints, in order, and an explicit instruction to end on
     the supplied final frame rather than drift past it. */
  const flfRoute = PROTECTED_COMPILER_ROUTES.find((route) => route.compiler === "compileCompactFLF");
  const flf = compileProtected(flfRoute);
  assert(/From the first frame/i.test(flf.compiled.prompt), "FLF must anchor to the first frame");
  assert(/End exactly on the supplied final frame/i.test(flf.compiled.prompt), "FLF must end on the supplied final frame");
  assert.strictEqual(flf.compiled.payload.references[0].role, "first-frame");
  assert.strictEqual(flf.compiled.payload.references[1].role, "last-frame");
  assert.strictEqual(flf.compiled.payload.references[0].url, flf.refs[0].url);
  assert.strictEqual(flf.compiled.payload.references[1].url, flf.refs[1].url);

  /* Multi-keyframe: one contract line per waypoint, numbered by position, in the order
     the user assigned them — and a permuted assignment must permute the output, which is
     what proves the ordering is data-driven rather than incidentally sorted. */
  const omniRoute = PROTECTED_COMPILER_ROUTES.find((route) => route.compiler === "compileSeedanceOmni");
  const omni = compileProtected(omniRoute);
  assert(/OMNI REFERENCE CONTRACT/.test(omni.compiled.prompt), "Omni must declare its reference contract");
  const omniLines = omni.compiled.prompt.split("\n").filter((line) => /^@image\d/.test(line));
  assert.strictEqual(omniLines.length, 4, "Omni must map every supplied waypoint");
  assert.deepStrictEqual(
    omniLines.map((line) => line.split(" — ")[0]),
    ["@image1", "@image2", "@image3", "@image4"],
    "Omni waypoints must be numbered in assignment order",
  );
  assert.deepStrictEqual(
    omniLines.map((line) => line.split(": ")[1].split(";")[0]),
    omni.refs.map((ref) => ref.label),
    "Omni waypoint numbering must follow the assigned reference order",
  );
  const reversed = protectedCompilerRefs(4, "sequential-keyframe").reverse();
  const permuted = compileProtected(omniRoute, { refs: reversed }).compiled;
  assert.deepStrictEqual(
    permuted.payload.references.map((ref) => ref.url),
    reversed.map((ref) => ref.url),
    "reordering the assigned waypoints must reorder the compiled package",
  );
  assert.notStrictEqual(permuted.prompt, omni.compiled.prompt, "a different waypoint order must be a different package");
}

/* Aspect ratio, resolution and the refusal boundary, for the one family that carries a
   format field into its request. The gate itself is asserted end-to-end against a mock
   provider in tests/launch-blockers.js; what is checked here is that the compiler agrees
   with it — that it never advertises a format the gate will refuse without the refusal
   being reachable, and never quietly rewrites one. */
function testProtectedCompilerFormatAndResolution() {
  const { h3AspectSupport, CINEBRAID_H3_ASPECT_SUPPORT } = require("../public/shared-aspect");
  const carriers = { "minimax-h3/t2v": "16:9", "minimax-h3/multi-frame": "adaptive" };

  for (const [profileId, fallback] of Object.entries(carriers)) {
    const profile = PromptEngine.getProfile(profileId);
    const route = { compiler: profileId, profileId, refCount: profile.mode === "r2v" ? 4 : 0, role: "sequential-keyframe" };
    for (const ratio of CINEBRAID_H3_ASPECT_SUPPORT[profile.mode]) {
      if (ratio === "adaptive") continue;
      const { compiled } = compileProtected(route, { aspectRatio: ratio });
      const gate = h3AspectSupport(profile.mode, ratio);
      assert.strictEqual(gate.ok, true, `${profileId} must accept the supported format ${ratio}`);
      assert.strictEqual(compiled.payload.fal.input.aspect_ratio, ratio, `${profileId} must dispatch ${ratio} unchanged`);
      assert.strictEqual(compiled.payload.fal.input.resolution, profile.defaultResolution || "2K", `${profileId} must carry its default resolution`);
      assert.strictEqual(compiled.payload.fal.input.duration, 10, `${profileId} must carry the shot duration`);
      assert.strictEqual(compiled.payload.fal.endpoint, profile.falEndpoint, `${profileId} must dispatch to its own endpoint`);
    }
    assert.strictEqual(compileProtected(route, { aspectRatio: "" }).compiled.payload.fal.input.aspect_ratio, fallback, `${profileId} must fall back to ${fallback} when no format is set`);

    /* Unsupported formats are refused, not substituted, before any request is built. */
    for (const ratio of ["2.39:1", "3:2", "5:1"]) {
      const gate = h3AspectSupport(profile.mode, ratio);
      assert.strictEqual(gate.ok, false, `${profileId} must refuse ${ratio}`);
      assert(!gate.value, `${profileId} must not substitute a format for ${ratio}`);
      assert(gate.message.includes(ratio), `${profileId} refusal must name the requested format`);
    }
    /* The one approved correction: an equivalent ratio written differently is the same
       delivery and is normalised to its supported spelling rather than refused. */
    assert.strictEqual(h3AspectSupport(profile.mode, "1920:1080").value, "16:9", `${profileId} must treat 1920:1080 as 16:9`);
  }

  /* Image-to-video and first/last frame take their shape from the supplied frames, so
     they must send no format at all rather than an assumed one. */
  for (const profileId of ["minimax-h3/i2v", "minimax-h3/flf"]) {
    const profile = PromptEngine.getProfile(profileId);
    const route = { compiler: profileId, profileId, refCount: profile.mode === "flf" ? 2 : 1 };
    const { compiled } = compileProtected(route, { aspectRatio: "2.39:1" });
    assert(!("aspect_ratio" in compiled.payload.fal.input), `${profileId} must send no aspect_ratio`);
    assert.strictEqual(compiled.payload.fal.input.resolution, profile.defaultResolution || "2K", `${profileId} must carry its default resolution`);
    assert.strictEqual(h3AspectSupport(profile.mode, "2.39:1").carriesAspectRatio, false, `${profileId} carries no format field to refuse`);
  }
  const flf = compileProtected({ compiler: "minimax-h3/flf", profileId: "minimax-h3/flf", refCount: 2 });
  assert.strictEqual(flf.compiled.payload.fal.input.image_url, flf.refs[0].url, "H3 FLF must send the first frame as image_url");
  assert.strictEqual(flf.compiled.payload.fal.input.end_image_url, flf.refs[1].url, "H3 FLF must send the last frame as end_image_url");
}


function testCanonicalMotionSoundBrief() {
  const project = cloneProject();
  const context = PromptEngine.buildContext(project, "L1-01", "");
  const brief = {
    performance: {
      action: "KAI reaches to the panel and presses the amber switch.",
      emotion: "frightened but controlled",
      facial: "jaw tightens",
      gaze: "tracks the switch",
      bodyLanguage: "shoulders remain rigid",
      objectInteraction: "right index finger depresses the switch",
      secondaryMotion: "one status light goes dark",
      endingState: "hand remains on the switch",
      staticConstraints: "panel geometry and wardrobe remain unchanged",
      prohibitedMotion: "no extra gestures or morphing",
    },
    camera: { movement: "slow push-in", timing: "begin at 1.0s and settle by 4.0s", framing: "preserve medium framing", lensBehavior: "focus stays on KAI and the switch" },
    dialogue: {
      line: "Air scrubbers nominal.", speakerId: "KAI", speakerName: "KAI", language: "English", emotion: "controlled urgency", delivery: "quiet and breathless", pace: "measured", volume: "quiet", locked: true, lipSyncRequired: true,
      voiceDesign: "A calm mid-register adult voice with measured technical delivery.",
    },
    sound: {
      sfxEvents: [{ timing: "1.8s", event: "dry relay click", intensity: "restrained", distance: "near", diegetic: true }],
      ambience: "low ventilation hum", music: "one sparse synthetic note", silence: "brief near-silence after the click", priorities: "dialogue first",
    },
    output: { resolution: "720p", nativeAudio: true },
  };
  for (const profileId of ["seedance-2/i2v", "kling-3/i2v", "ltx-2.3/i2v", "happy-horse-1.1/i2v"]) {
    const profile = PromptEngine.getProfile(profileId);
    let spec = PromptEngine.defaultSpec(context, "motion", profile.mode, [], null);
    spec = PromptEngine.applyMotionAudioBrief(spec, brief);
    const compiled = PromptEngine.compile(profile, spec, []);
    assert(compiled.prompt.includes("Air scrubbers nominal."), `${profileId} should preserve exact dialogue`);
    assert(compiled.prompt.includes("dry relay click"), `${profileId} should include supplied SFX`);
    assert(/push/i.test(compiled.prompt), `${profileId} should include camera direction`);
    assert.strictEqual(spec.audio.dialogue, "Air scrubbers nominal.");
    assert.strictEqual(spec.audio.speakerId, "KAI");
    assert.strictEqual(spec.output.resolution, "720p");
  }
}

function testAudioVoiceRouting() {
  const legacy = cloneProject();
  const legacyResult = compileProjectMotion(legacy, "seedance-2/i2v");
  assert.doesNotMatch(legacyResult.compiled.prompt, /clean master|L1-01b/i, "legacy VO notes must never become spoken dialogue");
  assert.doesNotMatch(legacyResult.compiled.prompt, /Says,/i, "a note-only shot should produce no Says clause");

  const generated = cloneProject();
  const generatedShot = generated.shots.find((item) => item.id === "L1-01");
  generatedShot.audio = {
    ...(generatedShot.audio || {}),
    line: "Air scrubbers nominal.",
    speakerId: "KAI",
    note: "Clean master; erosion happens in post.",
    voiceEntityId: "VOICE-KAI-CLEAN",
  };
  generated.audio.find((item) => item.id === "VOICE-KAI-CLEAN").cleanMaster = true;
  const seedance = compileProjectMotion(generated, "seedance-2/i2v");
  assert(seedance.compiled.prompt.includes("“Air scrubbers nominal.”"), "generated voice should quote only the literal line");
  assert(seedance.compiled.prompt.includes("Voice:"), "audio-capable generated-voice prompts should carry compact voice design");
  assert(seedance.compiled.prompt.includes("mid-deep male voice"), "voice design should reach the motion prompt");
  assert.doesNotMatch(seedance.compiled.prompt, /erosion happens|clean master/i, "production notes must remain outside model prompts");
  assert(seedance.compiled.warnings.some((item) => /clean master/i.test(item)), "generate voice should warn when the selected voice is a clean master");

  const ltx = compileProjectMotion(generated, "ltx-2.3/audio-video");
  assert.strictEqual((ltx.compiled.prompt.match(/Air scrubbers nominal\./g) || []).length, 1, "audio-video should include the spoken line exactly once");
  assert(ltx.compiled.prompt.includes("Voice:"), "audio-video should include compact voice direction");
  const action = "Locked-off log cam. Kai at console, routine VO: air scrubbers nominal.";
  assert((ltx.compiled.prompt.match(/Locked-off log cam/g) || []).length <= 1, "audio-video must not duplicate the shot action");

  const kling = compileProjectMotion(generated, "kling-3/i2v");
  assert(kling.compiled.prompt.includes("Air scrubbers nominal."), "Kling 3 native-audio prompts should preserve the exact line");
  assert(kling.compiled.prompt.includes("Voice:"), "Kling 3 native-audio prompts should include the persistent voice design");

  const inherited = cloneProject();
  const inheritedShot = inherited.shots.find((item) => item.id === "L1-01");
  inheritedShot.audio = { ...(inheritedShot.audio || {}), line: "Shot-level line.", speakerId: "KAI" };
  const firstSegmentId = inheritedShot.clips[0].id;
  const inheritedContext = PromptEngine.buildContext(inherited, "L1-01", firstSegmentId);
  assert.strictEqual(inheritedContext.shot.audio.line, "Shot-level line.", "motion units without a line should inherit the shot line");
  inheritedShot.clips[0].line = "Clip-specific line.";
  assert.strictEqual(PromptEngine.buildContext(inherited, "L1-01", firstSegmentId).shot.audio.line, "Clip-specific line.", "a clip line should override the shot line");

  const audioRefs = [
    { key: "frame", label: "Approved frame", role: "first-frame", mediaType: "image", approved: true, url: "/frame.png" },
    { key: "dialogue", label: "Kai clean dialogue take", role: "audio-timing", mediaType: "audio", approved: true, url: "/kai.wav" },
  ];
  const lipSyncProject = cloneProject();
  const lipShot = lipSyncProject.shots.find((item) => item.id === "L1-01");
  lipShot.audio = { ...(lipShot.audio || {}), line: "Air scrubbers nominal.", speakerId: "KAI", voiceEntityId: "VOICE-KAI-CLEAN" };
  lipShot.creationBrief = lipShot.creationBrief || {};
  lipShot.creationBrief.motionPlan = lipShot.creationBrief.motionPlan || {};
  lipShot.creationBrief.motionPlan.audio = { mode: "lip-sync-reference", referenceKey: "dialogue", speakerId: "KAI", voiceEntityId: "VOICE-KAI-CLEAN", direction: "restrained delivery" };
  const lipSync = compileProjectMotion(lipSyncProject, "seedance-2/r2v", "", audioRefs);
  assert.strictEqual(lipSync.spec.audio.dialogue, "", "lip-sync mode must not generate a second voice");
  assert.strictEqual(lipSync.spec.audio.transcript, "Air scrubbers nominal.", "lip-sync mode should preserve the line only as timing transcript");
  assert(lipSync.compiled.prompt.includes("@audio1"), "lip-sync packages should assign the actual audio token");
  assert(lipSync.compiled.prompt.includes("Transcript for timing only"), "lip-sync prompts should label dialogue as timing-only transcript");
  assert.doesNotMatch(lipSync.compiled.prompt, /Says, with restrained delivery|says exactly/i, "lip-sync prompts must not request generated speech");

  const overwrite = cloneProject();
  const overwriteShot = overwrite.shots.find((item) => item.id === "L1-01");
  overwriteShot.audio = { ...(overwriteShot.audio || {}), line: "System overwrite.", speakerId: "KAI", voiceEntityId: "VOICE-SYSTEM-OVERWRITE" };
  const overwriteResult = compileProjectMotion(overwrite, "seedance-2/i2v");
  assert(overwriteResult.compiled.prompt.includes("same source voice as Kai — clean voice master"), "sameObjectAs voice reconciliation should reach generated-voice prompts");

  const fallback = seedance.spec;
  const altered = PromptEngine.validateSpec({ ...fallback, audio: { ...fallback.audio, dialogue: "Rewritten words", speakerId: "OTHER", mode: "none", referenceKey: "other" } }, fallback);
  assert.strictEqual(altered.audio.dialogue, fallback.audio.dialogue, "Improve must preserve the literal line byte-identically");
  assert.strictEqual(altered.audio.speakerId, fallback.audio.speakerId, "Improve must not change the speaker");
  assert.strictEqual(altered.audio.mode, fallback.audio.mode, "Improve must not change the audio mode");
  assert.strictEqual(altered.audio.referenceKey, fallback.audio.referenceKey, "Improve must not change the assigned audio reference");
}

async function testAudioVoiceWorkspace() {
  const project = withCanon(buildFixture(), [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  project.audio.push({ id: "VOICE-KAI-CLEAN", name: "Kai clean master", role: "voice", cleanMaster: true, sameObjectAs: "", notes: "One clean session." });
  project.shots[0].audio = { vo: "Production note. Line: 'Air scrubbers nominal.'", line: "", speakerId: "", note: "", voiceEntityId: "", sfx: "" };
  const shotRender = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  assert(shotRender.html.includes("Dialogue & voice"));
  assert(shotRender.html.includes("Spoken line — exact words"));
  assert(shotRender.html.includes("Production note — never quoted"));
  assert(shotRender.html.includes("COPY TO SPOKEN LINE"), "legacy quoted dialogue should be offered as a non-destructive suggestion");
  assert(shotRender.html.includes("Lip-sync to an audio reference"));
  const audioRender = await render("#/sound/VOICE-KAI-CLEAN", project, { storage: { "cinebraid-focused:fixture:entity-task:audio:VOICE-KAI-CLEAN": "notes" } });
  assert(audioRender.html.includes("Clean master — generate once"), "audio entities should expose the clean-master workflow flag");
}

async function testCandidateReviewAndCorrectionWorkspace() {
  const project = buildFixture();
  project.promptBuildsById = {
    "frame-build-review": {
      id: "frame-build-review",
      packageId: "L1-01-A-R01",
      profileId: "gpt-image-2/edit",
      profileName: "GPT Image 2 — Edit",
      prompt: "Use #image1 as the exact blocking composition and #image2 for Kai identity.",
      references: [
        { token: "#image1", key: "guide", label: "Blocking guide", role: "composition", mediaType: "image", instruction: "Exact structure only.", url: "/assets/shots/L1-01/blocking/guide.png", file: "guide.png" },
        { token: "#image2", key: "kai", label: "Kai identity", role: "identity", mediaType: "image", instruction: "Identity only; do not copy source composition.", url: "/assets/anchors/KAI.png", file: "KAI.png" },
        { token: "#image3", key: "location", label: "Approved hangar location", role: "location", sourceType: "location", mediaType: "image", instruction: "Finished hangar architecture, gate, surfaces, materials, colour, texture, and lighting authority.", url: "/assets/plates/HANGAR.png", file: "HANGAR.png" },
      ],
      productionRisks: ["Preserve the contact point."],
      date: "2026-07-26T00:00:00.000Z",
    },
  };
  project.promptSnapshotsById = {};
  project.mediaAssets = [{
    id: "blocking-guide-1", title: "L1-01 — Hull check B01", file: "guide.png", storagePath: "shots/L1-01/blocking/guide.png",
    links: [{ id: "link-guide", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "active", generationInput: true }],
  }];
  project.shots[0].creationBrief = { activeBlockingAssetId: "blocking-guide-1", frameWorkflows: { "frame-a": { promptBuilds: [{ buildId: "frame-build-review", kind: "guided-frame" }] } }, promptBuilds: [{ buildId: "frame-build-review", kind: "guided-frame" }], composition: { camera: {}, elements: [] } };
  project.shots[0].candidateFiles = [{ stored: "FRAME_B.png", original: "FRAME_B.png", frameId: "frame-a", decision: "unreviewed", notes: "", labels: [], sourcePackageId: "L1-01-A-R01", sourcePackageLabel: "L1-01-A-R01" }];
  const rendered = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "frames" } });
  assert(rendered.html.includes("Review candidate"), "returned frame candidates should expose the structured review workspace");
  rendered.context.openCandidateReview("L1-01", "frame-a", "FRAME_B.png");
  const modal = rendered.context.document.getElementById("modal").innerHTML;
  assert(modal.includes("STRUCTURED RUBRIC"));
  assert(modal.includes("Open only the categories that need notes"), "review rubric should be compact rather than exposing every note field at once");
  assert(modal.includes("candidate-review-readiness"), "review should expose a clear readiness state");
  assert(modal.includes("candidate-review-more"), "secondary provenance actions should be grouped away from the primary decision row");
  assert(modal.includes("Numbered-reference diagnosis"));
  assert(!modal.includes('candidate-reference-review-section" open'), "numbered-reference diagnosis should stay collapsed until requested");
  assert(modal.includes("Side by side"));
  assert(modal.includes("Overlay"));
  assert(modal.includes("#image2 · Kai identity"));
  assert(modal.includes("BUILD CORRECTION"));
  project.shots[0].winner = "FRAME_B.png";
  project.shots[0].keyframes[0].winner = "FRAME_B.png";
  const approvedRendered = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "frames" } });
  approvedRendered.context.openCandidateReview("L1-01", "frame-a", "FRAME_B.png");
  const approvedModal = approvedRendered.context.document.getElementById("modal").innerHTML;
  assert(approvedModal.includes("Frame A is approved"), "approved reviews should show an explicit completion banner");
  assert(approvedModal.includes("✓ APPROVED"), "approved reviews should make the completed decision visually unambiguous");
  const correction = vm.runInContext(`candidateCorrectionPackage(
    P.shots[0],
    P.shots[0].keyframes[0],
    { name: "FRAME_B.png", url: "/assets/shots/L1-01/takes/FRAME_B.png" },
    P.shots[0].candidateFiles[0],
    {
      categories: {
        composition: { severity: "blocking", note: "The crop widened and the subject moved away from the guide contact point." },
        references: { severity: "major", note: "The identity source donated its background composition." },
        requirements: { severity: "pass", note: "" },
        style: { severity: "pass", note: "" },
        cleanliness: { severity: "minor", note: "A guide label remains visible." }
      },
      references: [{ token: "#image2", label: "Kai identity", severity: "major", note: "Use identity only." }],
      summary: "Restore the guide crop and remove the label."
    }
  )`, rendered.context);
  assert(correction, "failed rubric items should create a correction build");
  assert.match(correction.prompt, /Edit #image1 rather than creating a new composition/);
  assert.match(correction.prompt, /Use #image2 only as the authoritative geometry scaffold/);
  assert.match(correction.prompt, /#image3 — Kai identity \(original #image2\)/);
  assert.match(correction.prompt, /#image4 — Approved hangar location \(original #image3\)/);
  assert.match(correction.prompt, /Location-design authority only/);
  assert.match(correction.prompt, /Do not widen, zoom out, reframe/);
  assert.match(correction.prompt, /Do not preserve an incorrect background/);
  assert.strictEqual(correction.parentBuildId, "frame-build-review");
  assert.strictEqual(correction.parentPackageId, "L1-01-A-R01");
  assert.strictEqual(correction.references[0].role, "base");
  assert.strictEqual(correction.references[1].role, "composition");
  assert.strictEqual(correction.references[3].role, "location");
  assert(!correction.correctionWarnings.some((warning) => /no usable approved location authority/i.test(warning)), "recovered location authority should satisfy environment correction requirements");

  vm.runInContext(`(() => {
    P.promptBuildsById[${JSON.stringify(correction.id)}] = ${JSON.stringify(correction)};
    P.shots[0].candidateFiles[0].currentCorrectionBuildId = ${JSON.stringify(correction.id)};
    P.shots[0].candidateFiles[0].correctionBuildIds = [${JSON.stringify(correction.id)}];
    CONFIG.generation = { fal: { enabled: true, apiKey: "(set)", frameOutputs: 2, frameQuality: "high" } };
  })()`, rendered.context);
  rendered.context.openCandidateCorrectionModal("L1-01", "frame-a", "FRAME_B.png", correction.id);
  const correctionModal = rendered.context.document.getElementById("modal").innerHTML;
  assert(correctionModal.includes("Correction instructions"), "correction prompt should be editable before generation");
  assert(correctionModal.includes("Ordered input package"), "correction modal should expose the recovered numbered input package");
  assert(correctionModal.includes("GENERATE CORRECTION WITH FAL"), "correction modal should execute through the existing FAL path");
  assert(correctionModal.includes("#image4 · Approved hangar location"), "location authority should remain visible in the correction package");

  const missingLocation = vm.runInContext(`(() => {
    const saved = P.promptBuildsById["frame-build-review"].references;
    P.promptBuildsById["frame-build-review"].references = saved.filter((ref) => ref.role !== "location");
    const result = candidateCorrectionPackage(
      P.shots[0], P.shots[0].keyframes[0],
      { name: "FRAME_B.png", url: "/assets/shots/L1-01/takes/FRAME_B.png" },
      P.shots[0].candidateFiles[0],
      {
        categories: { composition: { severity: "pass", note: "" }, references: { severity: "pass", note: "" }, requirements: { severity: "major", note: "Replace the incorrect background fence and architecture." }, style: { severity: "pass", note: "" }, cleanliness: { severity: "pass", note: "" } },
        references: [], summary: "Restore the approved environment."
      }
    );
    P.promptBuildsById["frame-build-review"].references = saved;
    return result;
  })()`, rendered.context);
  assert(missingLocation.correctionWarnings.some((warning) => /no usable approved location authority/i.test(warning)), "environment correction without a location reference should produce a clear warning");
}

function testReferenceAwareIdentityLanguage() {
  const context = contextFixture();
  context.references[0] = {
    type: "character",
    id: "KAI",
    name: "Kai",
    canon: "Kai is an adult technician with close-cropped dark hair, a charcoal work jacket, and restrained body language.",
  };
  const baseRef = { key: "shot-start", label: "Approved starting frame", mediaType: "image", role: "first-frame", url: "/frame.png", approved: true };
  let spec = PromptEngine.defaultSpec(context, "motion", "i2v", [baseRef], null);
  const ungrounded = PromptEngine.compile(PromptEngine.getProfile("kling-3/i2v"), spec, [baseRef]);
  assert(!/\bKai\b/.test(ungrounded.prompt), "video prompts must not use a character's story name without an assigned identity reference");
  assert(/supplied starting image/i.test(ungrounded.prompt), "ungrounded character language should point to the supplied starting image");
  assert(ungrounded.warnings.some((warning) => /reference-aware identity language/i.test(warning)), "the package should explain that an ungrounded name was replaced");

  const identityRef = { key: "character:KAI", entityId: "KAI", entityName: "Kai", label: "Kai approved identity", mediaType: "image", role: "identity", url: "/kai.png", approved: true };
  spec = PromptEngine.defaultSpec(context, "motion", "r2v", [baseRef, identityRef], null);
  const grounded = PromptEngine.compile(PromptEngine.getProfile("kling-3/r2v"), spec, [baseRef, identityRef]);
  assert(/Kai shown in #image2/i.test(grounded.prompt), "a story name may be used only when it is explicitly tied to its numbered identity reference");
  assert(!grounded.warnings.some((warning) => /replaced ungrounded character name/i.test(warning)), "grounded identity references should not emit the ungrounded-name warning");

  const imageSpec = PromptEngine.defaultSpec(context, "first-frame", "text-to-image", [], null);
  const imageResult = PromptEngine.compile(PromptEngine.getProfile("gpt-image-2/t2i"), imageSpec, []);
  assert(!/\bKai\b/.test(imageResult.prompt), "text-to-image prompts must use a visual descriptor rather than an unreferenced story name");
}

async function main() {
  await testRenderedWorkspace();
  await testInteractiveComposerAndMotionUnits();
  await testMotionPreviewUsesApprovedStillAndPersistentDisclosures();
  await testPickerAndLocalNudge();
  await testProductionRiskAndMultiLocationSurfaces();
  await testBlockingWorkspaceAndMotionExclusion();
  await testAudioVoiceWorkspace();
  await testCandidateReviewAndCorrectionWorkspace();
  testProtectedCompilerHashes();
  testProtectedCompilerOutputContract();
  testProtectedCompilerPerFamilyContract();
  testProtectedCompilerFormatAndResolution();
  testCanonicalMotionSoundBrief();
  testAudioVoiceRouting();
  testSharedEntityResolver();
  testPromptGroundingRegression();
  testLocationBaseAndSingleStagingEncoding();
  testImageCompositionCompile();
  testDirectMotionControlsDriveCompactPrompt();
  testReferenceAwareIdentityLanguage();
  testNaturalCameraPhrasingAndStagingPunctuation();
  testMotionAndOmniAudioCompile();
  testBlockingPromptAndCompositionFence();
  testActionInsertBlockingInference();
  testGuideAuthoritativeFinalFrameAndVisualGrounding();
  testMultiAngleReferenceContracts();
  testBaseFrameHiddenElementsAndTargets();
  console.log("Composer hardening checks passed: blocking inference, stored composition compatibility, grouped variants, simplified reference review, per-unit motion, direct targets, package previews, Omni audio, visible video target selection, reference-aware identity language, and the protected compiler contract — source hashes plus prompt text, reference selection and order, model identifier, aspect ratio, resolution, duration, first/last frame and multi-keyframe behaviour.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
