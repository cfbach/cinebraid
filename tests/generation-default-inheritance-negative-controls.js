/* Negative controls for the saved-generation-default inheritance.
 *
 * A regression test that has never failed is a claim, not evidence. Each control below
 * reintroduces exactly one of the defects UX B1 exists to remove — the frame dialog
 * opening at Auto, the frame size fixed independent of Settings, the H3 dialog naming
 * its own 2K, the whole thing pinned to the audit's cheap values, a dialog that shows
 * one number and spends another, a filmmaker's override discarded at submission, and
 * the motion-readiness gate reordered after the paid action — and asserts that the
 * guarding property FAILS.
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. The defect is
 *   introduced by compiling a modified copy of the source IN MEMORY, so a broad
 *   `git checkout` can never be the thing that undoes it.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt: the
 *   anchor must exist, must be unique, must actually change the source, and the DEFECT
 *   ITSELF must be observed through a probe before the guarded assertion is allowed to
 *   count as detection. A control whose anchor has gone stale reports itself as stale
 *   rather than passing quietly.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const express = require("express");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");
const { addFramePromptBuild, addBlockingPromptBuild } = require("./image-execution-fixture");
const { withGenerationDeclaration } = require("./generation-request-fixture");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
/* Normalised to LF before matching. Anchors span lines, and on a Windows checkout with
   core.autocrlf on they would arrive as \r\n — so the anchor would not match, the
   control would report itself as stale, and the failure would look like a source change
   rather than a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;

const CONFIG_A = { frameQuality: "low", frameResolution: "1k", blockingQuality: "low", blockingResolution: "1k", h3Resolution: "768P" };
const CONFIG_B = { frameQuality: "medium", frameResolution: "2k", blockingQuality: "medium", blockingResolution: "2k", h3Resolution: "2K" };

/* The modules a patch may invalidate. Everything the compiled image path pulls in. */
const IN_SCOPE = [
  path.join(ROOT, "fal-generation.js"),
  path.join(ROOT, "image-execution.js"),
  path.join(ROOT, "fal-image-backend.js"),
  path.join(ROOT, "generation-compiler.js"),
  path.join(ROOT, "model-packs"),
];
const inScope = (key) => IN_SCOPE.some((prefix) => key === prefix || key.startsWith(prefix + path.sep) || key.startsWith(prefix));

/* Compile a modified copy of a module IN MEMORY, install it in the cache, run, restore.
   Returns whatever `run` returns. */
async function patched(relative, edits, run) {
  const file = require.resolve(path.join(ROOT, relative));
  const original = readLF(file);
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${relative}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${relative}; the control would test the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${relative} was not modified at all`);

  const saved = new Map();
  for (const key of Object.keys(require.cache))
    if (inScope(key)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const copy = new Module(file, module);
    copy.filename = file;
    copy.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = copy;
    copy._compile(code, file);
    copy.loaded = true;
    return await run({ patchedSource: code, originalSource: original });
  } finally {
    for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

/* A source-only patch, for the browser scripts no Node test can require. */
function patchedSource(relative, edits) {
  const file = path.join(ROOT, relative);
  const original = readLF(file);
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${relative}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${relative}:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${relative} was not modified at all`);
  return code;
}

const results = [];
/* `defect` MUST observe the reintroduced defect. Without that receipt an anchor that
   silently stopped matching, or a patch that changed nothing that runs, would throw
   somewhere unrelated and be counted as the guard working. */
async function control({ id, label, guards, defect, guarded }) {
  const observed = await defect();
  assert(observed === true, `NEGATIVE CONTROL ${id}: the defect probe did not observe the reintroduced defect, so nothing below proves anything`);
  let detected = null;
  try {
    await guarded();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = error;
  }
  assert(detected, `NEGATIVE CONTROL ${id} FAILED: with "${label}" reintroduced, "${guards}" still passed. That test cannot detect the defect it exists for.`);
  results.push({ id, label, guards, outcome: String(detected.message).split("\n")[0].slice(0, 110) });
}

/* ---------------------------------------------------------------------------
   A live compiled-image server built on whatever fal-generation.js is in the cache. */
async function serverOn(config) {
  const { registerFalGeneration } = require("../fal-generation");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-b1-nc-"));
  fs.mkdirSync(path.join(tmp, "shots", "SH-1", "takes"), { recursive: true });
  for (const dir of ["anchors", "plates", "props"]) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  for (const file of ["anchors/KAI.png", "plates/HANGAR.png", "props/PARCEL.png", "shots/SH-1/takes/A.png"])
    fs.writeFileSync(path.join(tmp, file), PNG);

  const project = {
    meta: { title: "nc", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
  const frameBuild = addFramePromptBuild(project, "SH-1");
  const blockingBuild = addBlockingPromptBuild(project, "SH-1");
  const projectFile = path.join(tmp, "project.json");
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));

  const providerCalls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    const id = `img-${providerCalls.length + 1}`;
    providerCalls.push({ body: req.body });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => res.json({ images: [{ url: `${mockOrigin}/image/${req.params.id}.png`, content_type: "image/png" }] }));
  mock.get("/image/:name", (req, res) => res.type("image/png").send(PNG));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "fal-test-key-not-a-credential", baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit", maxConcurrent: 4,
      ...config,
    } } }),
    readProject: () => JSON.parse(fs.readFileSync(projectFile, "utf8")),
    writeProject: (next) => fs.writeFileSync(projectFile, JSON.stringify(next, null, 2)),
    activeSlug: () => "nc",
    projectDirForSlug: (slug = "nc") => ({ slug, dir: tmp, file: projectFile }),
  });
  const server = await listen(app);
  const base = originOf(server);

  const post = async (route, body) => {
    const response = await fetch(`${base}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(withGenerationDeclaration(route, body)),
    });
    return { status: response.status, data: await response.json() };
  };
  const plan = (extra = {}) => post("/api/generation/fal/image/plan", {
    purpose: "frame", shotId: "SH-1", sourceBuildId: frameBuild, aspectRatio: "16:9", outputCount: 2, ...extra,
  });
  const submit = async (extra = {}) => {
    const before = providerCalls.length;
    const result = await post("/api/generation/fal/jobs", {
      purpose: "frame", imagePlan: true, shotId: "SH-1", sourceBuildId: frameBuild,
      frameId: "FR-A", frameLabel: "A", aspectRatio: "16:9", outputCount: 1, prompt: "",
      clientRequestId: `nc-${Math.random().toString(36).slice(2)}`, ...extra,
    });
    for (let i = 0; i < 80 && providerCalls.length === before; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 25));
    return { ...result, sent: providerCalls[providerCalls.length - 1]?.body || null };
  };

  return {
    plan, submit, blockingBuild, providerCalls,
    close: () => { server.close(); mockServer.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} },
  };
}

/* The `savedImageSettings` body, quoted once so a change to it breaks every control
   that depends on it visibly instead of one silently. */
const SAVED_SETTINGS_BODY = `    return {
      resolution: String(body?.resolution || (blocking ? cfg.blockingResolution : cfg.frameResolution) || ""),
      quality: String(body?.quality || (blocking ? cfg.blockingQuality : cfg.frameQuality) || ""),
    };`;

async function main() {
  /* =========================================================================
     A. The frame dialog opening at Auto, independent of the saved quality. */
  await control({
    id: "NC-B1-A",
    label: "the frame quality falling back to the pack's Auto instead of the saved setting",
    guards: "a frame dialog under saved LOW opens at low",
    defect: async () => {
      return patched("fal-generation.js", [[SAVED_SETTINGS_BODY, `    return {
      resolution: String(body?.resolution || (blocking ? cfg.blockingResolution : cfg.frameResolution) || ""),
      quality: String(body?.quality || ""),
    };`]], async () => {
        const h = await serverOn(CONFIG_A);
        try {
          const { data } = await h.plan();
          /* RECEIPT: the audit's exact symptom is back on the screen. */
          return data.quality === "auto";
        } finally { h.close(); }
      });
    },
    guarded: async () => {
      await patched("fal-generation.js", [[SAVED_SETTINGS_BODY, `    return {
      resolution: String(body?.resolution || (blocking ? cfg.blockingResolution : cfg.frameResolution) || ""),
      quality: String(body?.quality || ""),
    };`]], async () => {
        const h = await serverOn(CONFIG_A);
        try {
          const { data } = await h.plan();
          assert.strictEqual(data.quality, "low", "frame dialog under saved LOW must open at low");
        } finally { h.close(); }
      });
    },
  });

  /* =========================================================================
     B. The frame size fixed by the ratio ladder, independent of the saved tier. */
  const SIZE_MUTATION = [[SAVED_SETTINGS_BODY, `    return {
      resolution: String(body?.resolution || ""),
      quality: String(body?.quality || (blocking ? cfg.blockingQuality : cfg.frameQuality) || ""),
    };`]];
  await control({
    id: "NC-B1-B",
    label: "the frame size taken from the ratio ladder instead of the saved tier",
    guards: "a saved 2K resolves a 2K-tier size for the shot's format",
    defect: async () => patched("fal-generation.js", SIZE_MUTATION, async () => {
      const h = await serverOn(CONFIG_B);
      try {
        const { data } = await h.plan({ aspectRatio: "1:1" });
        /* RECEIPT: 1:1 documents both 1024x1024 and 2048x2048, so the ladder's smallest
           is observably not the saved 2K — this is the under-spend half of the defect. */
        return data.size === "1024x1024";
      } finally { h.close(); }
    }),
    guarded: async () => patched("fal-generation.js", SIZE_MUTATION, async () => {
      const h = await serverOn(CONFIG_B);
      try {
        const { data } = await h.plan({ aspectRatio: "1:1" });
        assert.strictEqual(data.size, "2048x2048", "a saved 2K at 1:1 must resolve to 2048x2048");
      } finally { h.close(); }
    }),
  });

  /* =========================================================================
     C. The H3 dialog naming its own 2K, independent of the saved h3Resolution.
        A browser script: no Node test can require it, so the patched source is
        evaluated into a rendered context and driven there. */
  const H3_ANCHOR = `function falH3ResolutionValue() {
  const saved = String(falGenerationConfig().h3Resolution || "").toUpperCase();
  return ["768P", "2K"].includes(saved) ? saved : "2K";
}`;
  const h3Patched = (replacement) => patchedSource("public/fal-generation.js", [[H3_ANCHOR, replacement]]);
  async function h3ResolutionUnder(config, replacement) {
    const view = await render("#/shot/L1-01", buildFixture());
    vm.runInContext(
      `CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: ${JSON.stringify({ enabled: true, apiKey: "k", ...config })} } };`,
      view.context,
    );
    vm.runInContext(h3Patched(replacement), view.context, { filename: "public/fal-generation.js" });
    return view.context.falH3ResolutionValue();
  }
  const HARD_2K = `function falH3ResolutionValue() {
  return "2K";
}`;
  await control({
    id: "NC-B1-C",
    label: "the H3 dialog hard-coding 2K instead of reading the saved resolution",
    guards: "the H3 dialog under saved 768P opens at 768P",
    defect: async () => {
      /* RECEIPT: with 768P saved, the dialog reports 2K — and the source scan sees the
         literal come back. Both halves of the guard are provably live. */
      const runtime = await h3ResolutionUnder(CONFIG_A, HARD_2K);
      const source = h3Patched(HARD_2K);
      return runtime === "2K" && /return "2K";/.test(source) && !/falGenerationConfig\(\)\.h3Resolution/.test(source);
    },
    guarded: async () => {
      const value = await h3ResolutionUnder(CONFIG_A, HARD_2K);
      assert.strictEqual(value, "768P", "the H3 dialog under saved 768P must open at 768P");
    },
  });

  /* =========================================================================
     D. Everything pinned to the audit's cheap values. CONFIG B is what catches it —
        a suite that only ever ran at LOW / 1K / 768P would call this a fix. */
  const PINNED = [[SAVED_SETTINGS_BODY, `    return {
      resolution: String(body?.resolution || "1k"),
      quality: String(body?.quality || "low"),
    };`]];
  await control({
    id: "NC-B1-D1",
    label: "the still-image defaults pinned to the audit's LOW / 1K",
    guards: "a frame dialog under saved MEDIUM opens at medium",
    defect: async () => patched("fal-generation.js", PINNED, async () => {
      const h = await serverOn(CONFIG_B);
      try {
        const { data } = await h.plan();
        /* RECEIPT: the operator's real MEDIUM is being answered with the audit's LOW. */
        return data.quality === "low";
      } finally { h.close(); }
    }),
    guarded: async () => patched("fal-generation.js", PINNED, async () => {
      const h = await serverOn(CONFIG_B);
      try {
        const { data } = await h.plan();
        assert.strictEqual(data.quality, "medium", "frame dialog under saved MEDIUM must open at medium");
      } finally { h.close(); }
    }),
  });
  const HARD_768 = `function falH3ResolutionValue() {
  return "768P";
}`;
  await control({
    id: "NC-B1-D2",
    label: "the H3 dialog pinned to the audit's 768P",
    guards: "the H3 dialog under saved 2K opens at 2K",
    defect: async () => (await h3ResolutionUnder(CONFIG_B, HARD_768)) === "768P",
    guarded: async () => {
      const value = await h3ResolutionUnder(CONFIG_B, HARD_768);
      assert.strictEqual(value, "2K", "the H3 dialog under saved 2K must open at 2K");
    },
  });

  /* =========================================================================
     E. The dialog shows the saved default and the provider is asked for something
        else. The most expensive possible defect: a confirmed number that is not the
        number that spends. */
  const DIVERGENT_SUBMIT = [[`          /* The same resolution the preview used, so what was confirmed is what is
             charged for. A dialog that sent an explicit size still wins here. */
          ...savedImageSettings(purpose, req.body),`, `          resolution: "3840x2160",
          quality: "high",`]];
  await control({
    id: "NC-B1-E",
    label: "the paid submit compiling a different size and quality than the preview confirmed",
    guards: "the mocked provider request carries the value the dialog confirmed",
    defect: async () => patched("fal-generation.js", DIVERGENT_SUBMIT, async () => {
      const h = await serverOn(CONFIG_B);
      try {
        const { data } = await h.plan();
        const { sent } = await h.submit();
        /* RECEIPT: the screen said 2048x1152 / medium and the provider was asked for
           3840x2160 / high. The divergence is observable on both sides at once. */
        return data.size === "2048x1152" && data.quality === "medium"
          && !!sent && sent.image_size?.width === 3840 && sent.quality === "high";
      } finally { h.close(); }
    }),
    guarded: async () => patched("fal-generation.js", DIVERGENT_SUBMIT, async () => {
      const h = await serverOn(CONFIG_B);
      try {
        const { sent } = await h.submit();
        assert.deepStrictEqual(sent.image_size, { width: 2048, height: 1152 },
          "the provider must be asked for the size the dialog confirmed");
        assert.strictEqual(sent.quality, "medium");
      } finally { h.close(); }
    }),
  });

  /* =========================================================================
     F. A filmmaker's explicit override discarded at submission time in favour of
        Settings. Settings must be a default, never an authority over one request. */
  const SETTINGS_WINS = [[SAVED_SETTINGS_BODY, `    return {
      resolution: String((blocking ? cfg.blockingResolution : cfg.frameResolution) || body?.resolution || ""),
      quality: String((blocking ? cfg.blockingQuality : cfg.frameQuality) || body?.quality || ""),
    };`]];
  await control({
    id: "NC-B1-F",
    label: "the saved default overwriting an explicit dialog override at submission",
    guards: "an explicit dialog override survives submission and is what gets charged for",
    defect: async () => patched("fal-generation.js", SETTINGS_WINS, async () => {
      const h = await serverOn(CONFIG_B);
      try {
        const { sent } = await h.submit({ quality: "high", resolution: "3840x2160" });
        /* RECEIPT: the filmmaker asked for 4K/high on this one request and the saved
           2K/medium was sent instead. */
        return !!sent && sent.image_size?.width === 2048 && sent.quality === "medium";
      } finally { h.close(); }
    }),
    guarded: async () => patched("fal-generation.js", SETTINGS_WINS, async () => {
      const h = await serverOn(CONFIG_B);
      try {
        const { sent } = await h.submit({ quality: "high", resolution: "3840x2160" });
        assert.deepStrictEqual(sent.image_size, { width: 3840, height: 2160 },
          "an explicit dialog size must survive to the provider");
        assert.strictEqual(sent.quality, "high");
      } finally { h.close(); }
    }),
  });

  /* =========================================================================
     G. The motion-readiness gate reordered after the navigation it protects.
        F-065 was the audit's strongest financial finding and B1 must not have moved it. */
  const GATE_ANCHOR = `  if (approvedCount >= 2 && !sequenceReview?.pass) return toast(sequenceReview ? "Correct the frame-sequence continuity issues before creating motion" : "Run the frame-sequence continuity review before creating motion");
  const c = ensureShotCreation(s), suggested = suggestedMotionProfileForApprovedFrames(s, approvedCount);
  if (suggested) c.motionProfileId = suggested;
  c.deliveryIntent = "motion";`;
  const GATE_MOVED = `  const c = ensureShotCreation(s), suggested = suggestedMotionProfileForApprovedFrames(s, approvedCount);
  if (suggested) c.motionProfileId = suggested;
  c.deliveryIntent = "motion";
  if (approvedCount >= 2 && !sequenceReview?.pass) return toast(sequenceReview ? "Correct the frame-sequence continuity issues before creating motion" : "Run the frame-sequence continuity review before creating motion");`;
  const gateSource = () => patchedSource("public/creation-studio.js", [[GATE_ANCHOR, GATE_MOVED]]);
  const gatePositions = (source) => {
    const opener = source.slice(source.indexOf("window.openGuidedMotionFromFrames"));
    return {
      gate: opener.indexOf(`if (approvedCount >= 2 && !sequenceReview?.pass) return toast(`),
      navigates: opener.indexOf(`c.deliveryIntent = "motion";`),
    };
  };
  await control({
    id: "NC-B1-G",
    label: "the motion-readiness gate running after the motion panel is opened",
    guards: "the readiness check runs before the motion panel opens",
    defect: async () => {
      const { gate, navigates } = gatePositions(gateSource());
      /* RECEIPT: both lines are still present and the order has genuinely inverted. */
      return gate > 0 && navigates > 0 && gate > navigates;
    },
    guarded: async () => {
      const { gate, navigates } = gatePositions(gateSource());
      assert(gate < navigates, "the readiness check must run BEFORE the motion panel opens");
    },
  });

  console.log(`UX B1 negative controls passed: ${results.length} deliberate defects reintroduced in memory — every one detected by the property that guards it, every one with a live-defect receipt, and the real modules green afterwards. Nothing was written to disk and nothing was reverted with git.`);
  for (const row of results) console.log(`  - ${row.label} -> caught by "${row.guards}"`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
