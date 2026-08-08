/* CineBraid four-layer capability resolution.
 *
 * What a request may ask for is the intersection of what the weights can do, what the
 * adapter implements, what THIS machine has installed, and what THIS validated graph
 * wires up. Each layer can only take capability away. A resolver that ever adds one
 * back is a resolver that offers a control and then refuses it after the user pressed
 * it — which is the entire failure this module exists to prevent.
 *
 * The properties at the end are the load-bearing part. Any future change to the
 * intersection maths has to keep them true, and they are stated as properties rather
 * than examples so a clever special case cannot slip past a fixture.
 *
 * The module is dual-target, so the same resolution is proven under Node and under a
 * browser-shaped global with no `module`.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const C = require("../public/shared-generation-capability");

/* ---- fixtures: four layers, each able to remove something ---- */
const MODEL = {
  modes: ["t2i", "edit", "multi-reference", "variation"],
  referenceRoles: ["identity", "location", "style", "base", "pose"],
  maxReferenceImages: 16,
  maxReferenceVideos: 0,
  maxReferenceAudio: 0,
  resolutions: ["1k", "2k", "4k"],
  aspectRatios: ["16:9", "2.39:1", "9:16"],
  durationSeconds: null,
  flags: { seed: true, candidateBatching: true, referenceWeights: true, controlNet: true, mask: true },
};
const BACKEND = {
  modes: ["t2i", "edit", "multi-reference"],
  maxReferenceImages: 8,
  resolutions: ["1k", "2k", "4k"],
  flags: { seed: true, candidateBatching: true, referenceWeights: true, controlNet: true, mask: true },
};
const NODE = {
  /* This machine has the checkpoint for t2i and edit but not the style LoRA, so
     multi-reference is gone at the node layer — same model, different machine. */
  modes: ["t2i", "edit"],
  maxReferenceImages: 4,
  resolutions: ["1k", "2k"],
  flags: { seed: true, candidateBatching: true, referenceWeights: true, controlNet: true, mask: true },
};
const RECIPE = {
  modes: ["t2i", "edit"],
  referenceRoles: ["identity", "base"],
  maxReferenceImages: 3,
  resolutions: ["1k", "2k"],
  aspectRatios: ["16:9", "2.39:1"],
  flags: { seed: true, candidateBatching: true, referenceWeights: false, controlNet: false, mask: false },
};

/* The two verified frame grids. H3 snaps to 17k+5 at 24fps, in-graph; LTX is
   duration x fps + 1. They are different KINDS of arithmetic, which is the reason a
   quantiser has to be data rather than a rounding rule in code. */
const H3_QUANTISER = { kind: "block", base: 17, offset: 5, fps: 24 };
const LTX_QUANTISER = { kind: "linear", plus: 1, fps: 24 };

const VIDEO_MODEL = {
  modes: ["t2v", "i2v", "flf", "r2v"],
  referenceRoles: ["first-frame", "last-frame", "identity", "motion-reference", "voice"],
  maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudio: 3,
  resolutions: ["768P", "2K"],
  durationSeconds: [5, 15],
  flags: { firstFrame: true, lastFrame: true, nativeAudio: true, seed: true },
};
const H3_RECIPE = {
  modes: ["flf"],
  referenceRoles: ["first-frame", "last-frame"],
  maxReferenceImages: 2, maxReferenceVideos: 0, maxReferenceAudio: 0,
  durationSeconds: [5, 15],
  quantisers: { frames: H3_QUANTISER },
  flags: { firstFrame: true, lastFrame: true, nativeAudio: true, seed: true },
};

/* =====================================================================
   1. Intersection across all four layers.
   ===================================================================== */
const all = C.resolveCapability({ model: MODEL, backend: BACKEND, node: NODE, recipe: RECIPE });
assert(all.ok, `four-layer resolution must succeed: ${JSON.stringify(all.blockedBy)}`);
assert.deepStrictEqual(all.modes, ["edit", "t2i"], "modes are the intersection, canonically ordered");
assert.deepStrictEqual(all.referenceRoles, ["base", "identity"], "roles are the intersection");
assert.strictEqual(all.maxReferenceImages, 3, "a numeric maximum takes the most restrictive layer");
assert.deepStrictEqual(all.resolutions, ["1k", "2k"]);
assert.deepStrictEqual(all.aspectRatios, ["16:9", "2.39:1"].sort());
assert.deepStrictEqual(all.layers, ["model", "backend", "node", "recipe"]);
assert.strictEqual(all.flags.referenceWeights, false, "a single layer declaring false vetoes a flag");
assert.strictEqual(all.flags.seed, true, "a flag every declaring layer allows survives");

/* ---- each layer, individually, must be able to remove a capability ---- */
const withoutRecipe = C.resolveCapability({ model: MODEL, backend: BACKEND, node: NODE });
assert(withoutRecipe.modes.includes("t2i") && withoutRecipe.modes.includes("edit"));
assert.strictEqual(withoutRecipe.maxReferenceImages, 4, "the node layer alone caps references at 4");
assert.strictEqual(withoutRecipe.flags.referenceWeights, true, "removing the recipe restores what only it vetoed");

const modelOnly = C.resolveCapability({ model: MODEL });
assert(modelOnly.modes.includes("variation"), "the model alone still offers variation");
const backendRemoved = C.resolveCapability({ model: MODEL, backend: BACKEND });
assert(!backendRemoved.modes.includes("variation"), "the backend layer removed variation");
const nodeRemoved = C.resolveCapability({ model: MODEL, backend: BACKEND, node: NODE });
assert(!nodeRemoved.modes.includes("multi-reference"), "the node layer removed multi-reference");
const recipeRemoved = C.resolveCapability({ model: MODEL, recipe: { modes: ["t2i"] } });
assert.deepStrictEqual(recipeRemoved.modes, ["t2i"], "the recipe layer removed everything but t2i");

/* ---- an empty intersection is blocked, and names the layer ---- */
const impossible = C.resolveCapability({ model: { modes: ["t2i"] }, recipe: { modes: ["t2v"] } });
assert(!impossible.ok, "a configuration with no shared mode is blocked");
const modeBlock = impossible.blockedBy.find((entry) => entry.field === "modes");
assert(modeBlock, "an empty mode intersection must be reported");
assert.strictEqual(modeBlock.layer, "recipe", "the blocking layer is named");
assert(modeBlock.reason && modeBlock.message, "a block carries a reason and a message");

/* ---- no layers at all is a typed block, not a crash ---- */
const nothing = C.resolveCapability({});
assert(!nothing.ok && nothing.blockedBy[0].reason === "no-layers");
assert(!C.resolveCapability(null).ok, "a null argument is handled");

/* =====================================================================
   2. Ranges.
   ===================================================================== */
const ranged = C.resolveCapability({
  model: { durationSeconds: [5, 15] },
  recipe: { durationSeconds: [8, 12] },
});
assert.deepStrictEqual(ranged.durationSeconds, [8, 12], "a range intersection is the tighter of both");
const wider = C.resolveCapability({
  model: { durationSeconds: [5, 15] },
  recipe: { durationSeconds: [1, 60] },
});
assert.deepStrictEqual(wider.durationSeconds, [5, 15], "a wider layer cannot widen the result");
const disjoint = C.resolveCapability({
  model: { durationSeconds: [5, 8] },
  recipe: { durationSeconds: [10, 15] },
});
assert(!disjoint.ok, "non-overlapping ranges are blocked");
assert.strictEqual(
  disjoint.blockedBy.find((entry) => entry.field === "durationSeconds").reason,
  "incompatible-range",
);

/* =====================================================================
   3. Quantisers — both verified grids.
   ===================================================================== */

/* H3: max(5, round(a*24)) + (5 - (max(5, round(a*24)) % 17)) % 17.
   240 frames is not legal; the next legal count up is 243. Note the grid only ever
   rounds UP from the floor, so 10s becomes 10.125s and never 9.9s. */
const h3 = C.quantiseDuration(H3_QUANTISER, 10);
assert.strictEqual(h3.frames, 243, "10s at 24fps snaps to 243 frames on the 17k+5 grid");
assert.strictEqual(h3.proposed, 243 / 24);
assert.strictEqual(h3.requested, 10, "the requested value is always preserved");
assert.strictEqual(h3.exact, false);
/* Legal frame counts land exactly. */
for (const frames of [5, 22, 39, 226, 243]) {
  const snapped = C.quantiseDuration(H3_QUANTISER, frames / 24);
  assert.strictEqual(snapped.frames, frames, `${frames} frames is already on the grid`);
  assert.strictEqual(snapped.exact, true);
}
/* The modulo must behave the way the graph's expression does. A naive JS % would
   produce a negative offset here and land on an illegal count. */
const nearMiss = C.quantiseDuration(H3_QUANTISER, 237 / 24);
assert.strictEqual(nearMiss.frames, 243, "237 frames snaps up to 243, not down");
assert.strictEqual((nearMiss.frames - 5) % 17, 0, "every snapped H3 value is on the grid");

/* LTX: frames = duration x fps + 1 — a different arithmetic entirely. */
const ltx = C.quantiseDuration(LTX_QUANTISER, 8);
assert.strictEqual(ltx.frames, 193, "8s at 24fps is 193 frames for LTX");
assert.strictEqual(ltx.proposed, 8);
assert.strictEqual(ltx.exact, true);
assert.notStrictEqual(
  C.quantiseDuration(H3_QUANTISER, 8).frames,
  C.quantiseDuration(LTX_QUANTISER, 8).frames,
  "the two grids must not collapse into one rounding rule",
);
assert.strictEqual(C.quantiseDuration({ kind: "nonsense", fps: 24 }, 8).ok, false, "an unknown grid is refused, not guessed");
assert.strictEqual(C.quantiseDuration(H3_QUANTISER, "ten").ok, false, "a non-numeric duration is refused");

/* Two different grids cannot be composed into a third. */
const clash = C.resolveCapability({
  model: { quantisers: { frames: H3_QUANTISER } },
  recipe: { quantisers: { frames: LTX_QUANTISER } },
});
assert(!clash.ok, "conflicting quantisers are blocked rather than merged");
assert.strictEqual(clash.blockedBy[0].reason, "conflicting-quantiser");

/* =====================================================================
   4. Checking a request against a resolved capability.
   ===================================================================== */
const videoCap = C.resolveCapability({ model: VIDEO_MODEL, recipe: H3_RECIPE });
assert(videoCap.ok, JSON.stringify(videoCap.blockedBy));
assert.deepStrictEqual(videoCap.modes, ["flf"]);
assert.strictEqual(videoCap.maxReferenceImages, 2);

const good = C.checkRequestAgainstCapability({
  mode: "flf",
  references: [
    { role: "first-frame", mediaType: "image" },
    { role: "last-frame", mediaType: "image" },
  ],
  durationSeconds: 243 / 24,
  resolutionPreset: "2K",
  seed: 88117,
}, videoCap);
assert(good.ok, `a conforming request must pass: ${JSON.stringify(good.blockedBy)}`);
assert.strictEqual(good.duration.exact, true);

/* A quantised duration is REPORTED, never applied. The request is untouched and both
   numbers survive, so a caller can show "10s becomes 10.125s" rather than silently
   rendering something the user did not ask for. */
const snapped = C.checkRequestAgainstCapability({ mode: "flf", durationSeconds: 10 }, videoCap);
assert(!snapped.ok, "an off-grid duration must be surfaced");
const quantBlock = snapped.blockedBy.find((entry) => entry.reason === "quantised");
assert(quantBlock, "the off-grid duration is reported as a block");
assert.strictEqual(snapped.duration.requested, 10, "the requested value survives");
assert.strictEqual(snapped.duration.proposed, 243 / 24, "the legal value is proposed alongside it");
assert(quantBlock.action.includes("10.125"), "the action offers the legal value");

/* Unsupported role, unsupported control, too many references, out-of-range duration. */
const roleBlocked = C.checkRequestAgainstCapability({
  mode: "flf", references: [{ role: "motion-reference", mediaType: "video" }],
}, videoCap);
assert(!roleBlocked.ok);
assert(roleBlocked.blockedBy.some((entry) => entry.reason === "role-unsupported"),
  "a role the recipe does not wire must be refused, not dropped");

const weightBlocked = C.checkRequestAgainstCapability({
  mode: "t2i", references: [{ role: "identity", mediaType: "image", controls: { weight: 0.7 } }],
}, C.resolveCapability({ model: MODEL, recipe: RECIPE }));
assert(!weightBlocked.ok);
const weightBlock = weightBlocked.blockedBy.find((entry) => entry.reason === "control-unsupported");
assert(weightBlock, "an unsupported control must be refused rather than silently dropped");
assert.strictEqual(weightBlock.field, "references[0].controls.weight");

const tooMany = C.checkRequestAgainstCapability({
  mode: "flf",
  references: [
    { role: "first-frame", mediaType: "image" },
    { role: "last-frame", mediaType: "image" },
    { role: "first-frame", mediaType: "image" },
  ],
}, videoCap);
assert(tooMany.blockedBy.some((entry) => entry.reason === "too-many-references"));

const outOfRange = C.checkRequestAgainstCapability({ mode: "flf", durationSeconds: 40 }, videoCap);
assert(outOfRange.blockedBy.some((entry) => entry.reason === "out-of-range"));

const badResolution = C.checkRequestAgainstCapability({ mode: "flf", resolutionPreset: "8K" }, videoCap);
assert(badResolution.blockedBy.some((entry) => entry.reason === "value-unsupported"));

const noSeed = C.checkRequestAgainstCapability({ mode: "t2i", seed: 1 },
  C.resolveCapability({ model: { modes: ["t2i"], flags: { seed: false } } }));
assert(noSeed.blockedBy.some((entry) => entry.reason === "seed-unsupported"));

/* =====================================================================
   5. Properties. These are the invariants, not the examples.
   ===================================================================== */
const LAYER_SETS = [
  { model: MODEL },
  { model: MODEL, backend: BACKEND },
  { model: MODEL, backend: BACKEND, node: NODE },
  { model: MODEL, backend: BACKEND, node: NODE, recipe: RECIPE },
  { model: VIDEO_MODEL, recipe: H3_RECIPE },
];

/* A. Intersection can never ADD a mode absent from a required layer.
   B. The same for reference roles. */
for (const layers of LAYER_SETS) {
  const resolved = C.resolveCapability(layers);
  for (const [field] of [["modes"], ["referenceRoles"]]) {
    const declaring = Object.values(layers).filter((layer) => Array.isArray(layer[field]));
    if (!declaring.length || !Array.isArray(resolved[field])) continue;
    for (const value of resolved[field])
      for (const layer of declaring)
        assert(layer[field].includes(value),
          `${field} "${value}" survived a layer that never declared it`);
  }
}

/* C. A numeric maximum can only stay the same or become more restrictive. */
for (const field of ["maxReferenceImages", "maxReferenceVideos", "maxReferenceAudio"]) {
  for (const layers of LAYER_SETS) {
    const resolved = C.resolveCapability(layers);
    if (!Number.isFinite(resolved[field])) continue;
    for (const layer of Object.values(layers))
      if (Number.isFinite(layer[field]))
        assert(resolved[field] <= layer[field], `${field} widened past a declaring layer`);
  }
}

/* D. A range intersection cannot widen either source range. */
for (const [a, b] of [[[5, 15], [8, 12]], [[1, 60], [5, 15]], [[5, 15], [5, 15]]]) {
  const resolved = C.resolveCapability({ model: { durationSeconds: a }, recipe: { durationSeconds: b } });
  assert(resolved.durationSeconds[0] >= Math.min(a[0], b[0]));
  assert(resolved.durationSeconds[0] >= a[0] && resolved.durationSeconds[0] >= b[0]);
  assert(resolved.durationSeconds[1] <= a[1] && resolved.durationSeconds[1] <= b[1]);
}

/* E. Incompatible ranges produce a typed blocked result — asserted above. */

/* F. Enum intersection is deterministic regardless of input ordering. */
const shuffled = {
  model: { ...MODEL, modes: [...MODEL.modes].reverse(), resolutions: [...MODEL.resolutions].reverse() },
  backend: { ...BACKEND, modes: [...BACKEND.modes].reverse() },
  node: { ...NODE, modes: [...NODE.modes].reverse() },
  recipe: { ...RECIPE, modes: [...RECIPE.modes].reverse() },
};
assert.deepStrictEqual(
  C.resolveCapability(shuffled).modes,
  all.modes,
  "reversing every layer's declaration order must not change the result",
);
assert.deepStrictEqual(C.resolveCapability(shuffled).resolutions, all.resolutions);

/* G. The resolver is deterministic for identical inputs. */
assert.deepStrictEqual(
  C.resolveCapability({ model: MODEL, backend: BACKEND, node: NODE, recipe: RECIPE }),
  C.resolveCapability({ model: MODEL, backend: BACKEND, node: NODE, recipe: RECIPE }),
);

/* H. The resolver does not mutate its inputs. */
const before = JSON.stringify({ MODEL, BACKEND, NODE, RECIPE, VIDEO_MODEL, H3_RECIPE });
C.resolveCapability({ model: MODEL, backend: BACKEND, node: NODE, recipe: RECIPE });
C.checkRequestAgainstCapability({ mode: "flf", durationSeconds: 10 }, videoCap);
C.quantiseDuration(H3_QUANTISER, 10);
assert.strictEqual(
  JSON.stringify({ MODEL, BACKEND, NODE, RECIPE, VIDEO_MODEL, H3_RECIPE }),
  before,
  "resolution must not edit the descriptors it was handed",
);

/* J. A quantiser never silently coerces: the requested value is always present. */
for (const seconds of [5, 7.3, 10, 12.5, 15]) {
  for (const quantiser of [H3_QUANTISER, LTX_QUANTISER]) {
    const result = C.quantiseDuration(quantiser, seconds);
    assert.strictEqual(result.requested, seconds, "the requested duration is never overwritten");
    assert(result.proposed !== null, "a legal alternative is always offered");
  }
}

/* =====================================================================
   6. I. Browser and Node agree.
   ===================================================================== */
const source = fs.readFileSync(path.join(__dirname, "..", "public", "shared-generation-capability.js"), "utf8");
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
/* No `module` in the sandbox, so only the browser branch can run. */
vm.runInContext(source, sandbox, { filename: "shared-generation-capability.js" });

assert.strictEqual(typeof sandbox.window.resolveCapability, "function", "the module must export into a browser global");
assert.strictEqual(typeof sandbox.window.quantiseDuration, "function");
assert.strictEqual(typeof sandbox.window.checkRequestAgainstCapability, "function");
/* Arrays built inside the vm realm have that realm's Array prototype, so they are
   compared by value rather than by identity. */
assert.deepStrictEqual(Array.from(sandbox.window.CINEBRAID_GENERATION_MODES), C.CINEBRAID_GENERATION_MODES);
assert.deepStrictEqual(Array.from(sandbox.window.CINEBRAID_REFERENCE_ROLES), C.CINEBRAID_REFERENCE_ROLES);

for (const layers of LAYER_SETS)
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(sandbox.window.resolveCapability(layers))),
    JSON.parse(JSON.stringify(C.resolveCapability(layers))),
    "the browser and the server must resolve identically",
  );
for (const seconds of [5, 10, 12.5])
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(sandbox.window.quantiseDuration(H3_QUANTISER, seconds))),
    JSON.parse(JSON.stringify(C.quantiseDuration(H3_QUANTISER, seconds))),
  );
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.window.checkRequestAgainstCapability({ mode: "flf", durationSeconds: 10 }, videoCap))),
  JSON.parse(JSON.stringify(C.checkRequestAgainstCapability({ mode: "flf", durationSeconds: 10 }, videoCap))),
);

/* ---- vocabulary sanity: adopted strings, no invented synonyms ---- */
for (const mode of ["t2i", "edit", "multi-reference", "style-reference", "moodboard", "blocking",
  "t2v", "i2v", "flf", "r2v", "video-edit", "audio-video", "retake"])
  assert(C.CINEBRAID_GENERATION_MODES.includes(mode), `${mode} is an existing CineBraid mode and must survive`);
for (const added of ["variation", "inpaint", "outpaint", "control-guided", "v2v", "upscale", "restore"])
  assert(C.CINEBRAID_GENERATION_MODES.includes(added), `${added} is an RFC v2 addition`);
for (const synonym of ["text_to_image", "image_to_video", "first_last_frame_to_video", "image_edit"])
  assert(!C.CINEBRAID_GENERATION_MODES.includes(synonym), `${synonym} is a parallel spelling and must not exist`);
for (const role of ["identity", "location", "prop", "style", "lighting", "pose", "composition",
  "reference", "motion-reference", "camera-reference", "performance-reference",
  "audio-timing", "sound-reference", "continuity-state"])
  assert(C.CINEBRAID_REFERENCE_ROLES.includes(role), `${role} is an existing semantic role and must survive`);
for (const added of ["first-frame", "last-frame", "depth", "edge", "mask", "voice", "colour-palette"])
  assert(C.CINEBRAID_REFERENCE_ROLES.includes(added), `${added} is an RFC v2 addition`);
for (const graphTerm of ["image1", "ref_image_0", "LoadImage", "KSampler"])
  assert(!C.CINEBRAID_REFERENCE_ROLES.includes(graphTerm), `${graphTerm} is a graph binding, not a semantic role`);

console.log(
  "Generation capability suite passed: four layers intersect and never widen, both verified frame grids "
  + "snap correctly and report requested alongside proposed, unsupported roles and controls are refused rather "
  + "than dropped, and the browser and server resolvers agree exactly.",
);
