/* Saved generation defaults are what the paid dialogs open at.
 *
 * The UX audit's blocking money finding: Settings → Generation offered frame quality,
 * frame resolution and an H3 resolution, the filmmaker saved them, and the two
 * highest-cost dialogs opened on something else. "Create frame A" opened at Auto and
 * 2048x1152 whether LOW/1K or MEDIUM/2K was saved; "Generate with MiniMax H3" opened at
 * 2K whether 768P or 2K was saved. Both had to be corrected by hand before every
 * submission, and a filmmaker who forgot paid the difference.
 *
 * It was never a universal failure — the entity-reference dialog inherited correctly all
 * along, which is why this suite asserts THAT path too. The defect was inconsistency
 * between paid surfaces, so the property here is one sentence:
 *
 *     A paid dialog opens on the value the filmmaker saved, or on a value this model
 *     genuinely constrains it to WITH the substitution named — and never on an
 *     unrelated default nobody chose.
 *
 * Both directions matter. Under a saved 2K the old code opened a 1:1 frame at
 * 1024x1024, spending less than was asked for; under a saved 1K it opened a 16:9 frame
 * at 2048x1152, spending more. Neither is the number the filmmaker configured.
 *
 * NOTHING HERE IS PAID. Every provider call goes to a local express mock.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const express = require("express");

const ROOT = path.join(__dirname, "..");
const { registerFalGeneration } = require("../fal-generation");
const { compileImageExecutionPlan } = require("../image-execution");
const { addFramePromptBuild, addBlockingPromptBuild } = require("./image-execution-fixture");
const { render, buildFixture } = require("./render-harness");
const { withGenerationDeclaration } = require("./generation-request-fixture");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const notes = [];
const note = (line) => notes.push(line);

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* The two configurations the audit specified, and a third nobody can reach through
   Settings — kept because config.js accepts it and the rule must hold there too. */
const CONFIG_A = { frameQuality: "low", frameResolution: "1k", blockingQuality: "low", blockingResolution: "1k", h3Resolution: "768P" };
const CONFIG_B = { frameQuality: "medium", frameResolution: "2k", blockingQuality: "medium", blockingResolution: "2k", h3Resolution: "2K" };
const CONFIG_AUTO = { ...CONFIG_A, frameQuality: "auto" };

/* ===========================================================================
   1. THE RESOLVER. A saved tier means a documented size at THIS shot's format.

   Asserted against the model pack directly, per ratio, because "1k" is not a pixel
   pair until a format is known and a suite that only ever checks 16:9 would call a
   16:9-shaped bug a fix. */

function compileFrame(aspectRatio, resolution, quality, purpose = "frame") {
  const project = {
    meta: { title: "defaults", aspectRatio },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
  const buildId = purpose === "blocking"
    ? addBlockingPromptBuild(project, "SH-1")
    : addFramePromptBuild(project, "SH-1");
  return compileImageExecutionPlan({
    project, purpose, shotId: "SH-1", buildId,
    aspectRatio, resolution, quality, candidateCount: 2,
  });
}

/* The documented answer for each saved tier at each ratio GPT Image 2 offers. Written
   out rather than derived, so a change to the pack's size list has to be restated here
   deliberately instead of silently agreeing with itself. */
const TIER_EXPECTATIONS = [
  { ratio: "1:1", "1k": "1024x1024", "2k": "2048x2048", "4k": "1024x1024", constrained: ["4k"] },
  { ratio: "3:2", "1k": "1536x1024", "2k": "1536x1024", "4k": "1536x1024", constrained: ["2k", "4k"] },
  { ratio: "2:3", "1k": "1024x1536", "2k": "1024x1536", "4k": "1024x1536", constrained: ["2k", "4k"] },
  { ratio: "16:9", "1k": "2048x1152", "2k": "2048x1152", "4k": "3840x2160", constrained: ["1k"] },
  { ratio: "9:16", "1k": "2160x3840", "2k": "2160x3840", "4k": "2160x3840", constrained: ["1k", "2k"] },
];

for (const row of TIER_EXPECTATIONS) {
  for (const tier of ["1k", "2k", "4k"]) {
    const compiled = compileFrame(row.ratio, tier, "low");
    assert.strictEqual(compiled.size, row[tier],
      `a saved ${tier} frame at ${row.ratio} must compile to ${row[tier]}, got ${compiled.size}`);

    /* Where the model has no size at the saved tier, the substitution is NAMED. Silence
       here is the whole defect: a filmmaker who saved 1K and is about to spend at 2K is
       owed that sentence before the paid button, not after the invoice. */
    const explained = (compiled.plan.warnings || []).some((warning) => warning.code === "resolution-tier-unavailable");
    if (row.constrained.includes(tier))
      assert(explained,
        `a saved ${tier} that this model cannot deliver at ${row.ratio} must be explained, not silently replaced`);
    else
      assert(!explained,
        `a saved ${tier} that resolves exactly at ${row.ratio} must not warn about a substitution that did not happen`);
  }
}
note(`tiers: 15 saved-tier / shot-format combinations resolve to a documented size; ${TIER_EXPECTATIONS.reduce((n, r) => n + r.constrained.length, 0)} name their constrained replacement`);

/* Requirement 3 and 4 stated the way the audit stated them. */
assert.strictEqual(compileFrame("16:9", "1k", "low").size, "2048x1152");
assert.strictEqual(compileFrame("1:1", "1k", "low").size, "1024x1024");
assert.strictEqual(compileFrame("16:9", "2k", "low").size, "2048x1152");
assert.strictEqual(compileFrame("1:1", "2k", "low").size, "2048x2048");
/* THE PROOF THE FIX IS NOT COSMETIC. Before this change a saved 2K opened a square
   frame at 1024x1024 — the ratio ladder's smallest, chosen by nobody. */
assert.notStrictEqual(compileFrame("1:1", "2k", "low").size, compileFrame("1:1", "1k", "low").size,
  "a saved 1K and a saved 2K must not resolve to the same size at a ratio that documents both");
note("tiers: 1K and 2K resolve to genuinely different sizes at 1:1 — the saved number is the number that spends");

/* An explicit named size outranks the saved tier: a filmmaker overriding one request
   must not be overruled by Settings. */
assert.strictEqual(compileFrame("16:9", "3840x2160", "low").size, "3840x2160");
assert.strictEqual(compileFrame("1:1", "1024x1024", "low").size, "1024x1024");
note("override: an explicit named size in the dialog outranks the saved tier");

/* An unsupported saved token resolves through the capability policy that already
   existed, rather than quietly selecting a more expensive tier. */
{
  const compiled = compileFrame("16:9", "8k", "low");
  assert.strictEqual(compiled.size, "2048x1152", "an unknown token must not select the most expensive size available");
  assert((compiled.plan.warnings || []).some((w) => w.code === "resolution-unsupported"),
    "an unknown token must be reported by the existing capability policy");
}
note("fail-closed: an unsupported saved resolution is refused by name and never upgrades the spend");

/* Quality is carried verbatim, including the tier Settings cannot save. */
for (const quality of ["low", "medium", "high", "auto"])
  assert.strictEqual(compileFrame("16:9", "2k", quality).quality, quality,
    `a saved ${quality} quality must reach the plan unchanged`);
/* Auto is reachable only when it was actually saved. */
assert.notStrictEqual(compileFrame("16:9", "2k", "low").quality, "auto");
assert.notStrictEqual(compileFrame("16:9", "2k", "medium").quality, "auto");
note("quality: low, medium, high and auto all reach the plan verbatim; auto appears only when auto was saved");

/* ===========================================================================
   2. THE SERVER. The preview a dialog opens on carries the saved defaults.

   The preview IS the dialog's initial state, so this is the boundary the audit was
   actually looking at. Driven through a real route on a real socket. */

async function harness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-defaults-"));
  fs.mkdirSync(path.join(tmp, "shots", "SH-1", "takes"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "anchors"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "plates"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "props"), { recursive: true });
  for (const file of ["anchors/KAI.png", "plates/HANGAR.png", "props/PARCEL.png", "shots/SH-1/takes/A.png"])
    fs.writeFileSync(path.join(tmp, file), PNG);

  const project = {
    meta: { title: "Defaults", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
  const frameBuild = addFramePromptBuild(project, "SH-1");
  const blockingBuild = addBlockingPromptBuild(project, "SH-1");
  const projectFile = path.join(tmp, "project.json");
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));

  /* The provider. Local, and every request it receives is recorded so a test can ask
     what was actually going to be charged for. */
  const providerCalls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    const id = `img-${providerCalls.length + 1}`;
    providerCalls.push({ endpoint: req.path, body: req.body });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => res.json({ images: [{ url: `${mockOrigin}/image/${req.params.id}.png`, content_type: "image/png" }] }));
  mock.get("/image/:name", (req, res) => res.type("image/png").send(PNG));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  /* Swapped between CONFIG A and CONFIG B by the tests. Recorded on every read so a
     test can prove the saved values were never rewritten behind the filmmaker. */
  let saved = { ...CONFIG_A };
  const configReads = [];
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerFalGeneration(app, {
    readConfig: () => {
      configReads.push({ ...saved });
      return { generation: { fal: {
        enabled: true, apiKey: "fal-test-key-not-a-credential", baseUrl: mockOrigin,
        textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit", maxConcurrent: 4,
        ...saved,
      } } };
    },
    readProject: () => JSON.parse(fs.readFileSync(projectFile, "utf8")),
    writeProject: (next) => fs.writeFileSync(projectFile, JSON.stringify(next, null, 2)),
    activeSlug: () => "defaults",
    projectDirForSlug: (slug = "defaults") => ({ slug, dir: tmp, file: projectFile }),
  });
  const server = await listen(app);
  const base = originOf(server);

  const post = async (route, body) => {
    const response = await fetch(`${base}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(await withGenerationDeclaration(route, body, { origin: base })),
    });
    return { status: response.status, data: await response.json() };
  };

  return {
    post, frameBuild, blockingBuild, providerCalls,
    setConfig: (next) => { saved = { ...next }; },
    savedNow: () => ({ ...saved }),
    close: () => { server.close(); mockServer.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

async function serverSection() {
  const h = await harness();
  try {
    /* --- CONFIG A. The audit's cheap settings. */
    h.setConfig(CONFIG_A);
    {
      /* Exactly what openFalFrameGenerationModal sends when the dialog opens: an
         aspect ratio and a count, and no quality or size at all. */
      const { data } = await h.post("/api/generation/fal/image/plan", {
        purpose: "frame", shotId: "SH-1", sourceBuildId: h.frameBuild, aspectRatio: "16:9", outputCount: 2,
      });
      assert.strictEqual(data.quality, "low", `frame dialog under saved LOW must open at low, got ${data.quality}`);
      assert.notStrictEqual(data.quality, "auto", "the audit's Auto must not come back");
      assert.strictEqual(data.size, "2048x1152");
      assert((data.warnings || []).some((w) => w.code === "resolution-tier-unavailable"),
        "and must explain that 16:9 has no 1K size rather than presenting 2048x1152 as the saved choice");
      note("CONFIG A: the frame dialog opens at low / 2048x1152 with the 1K substitution explained");
    }
    {
      const { data } = await h.post("/api/generation/fal/image/plan", {
        purpose: "blocking", shotId: "SH-1", sourceBuildId: h.blockingBuild, aspectRatio: "16:9", outputCount: 2,
      });
      assert.strictEqual(data.quality, "low");
      note("CONFIG A: the blocking dialog opens at low");
    }

    /* --- CONFIG B. The operator's real settings, and the proof nothing was pinned to
       the audit-safe values. */
    h.setConfig(CONFIG_B);
    {
      const { data } = await h.post("/api/generation/fal/image/plan", {
        purpose: "frame", shotId: "SH-1", sourceBuildId: h.frameBuild, aspectRatio: "16:9", outputCount: 2,
      });
      assert.strictEqual(data.quality, "medium", `frame dialog under saved MEDIUM must open at medium, got ${data.quality}`);
      assert.notStrictEqual(data.quality, "low", "MEDIUM must not be answered with the audit's LOW");
      assert.strictEqual(data.size, "2048x1152");
      assert(!(data.warnings || []).some((w) => w.code === "resolution-tier-unavailable"),
        "a saved 2K resolves exactly at 16:9 and must not report a substitution");
      note("CONFIG B: the frame dialog opens at medium / 2048x1152 with no substitution to report");
    }
    {
      /* Blocking quality follows Settings too. Under the shipped default this reads the
         same as the pack's own floor, which is exactly how the defect stayed invisible
         on this surface; MEDIUM is what tells the two apart. */
      const { data } = await h.post("/api/generation/fal/image/plan", {
        purpose: "blocking", shotId: "SH-1", sourceBuildId: h.blockingBuild, aspectRatio: "16:9", outputCount: 2,
      });
      assert.strictEqual(data.quality, "medium", "a saved blocking quality must outrank the pack's own cheap-tier floor");
      note("CONFIG B: the blocking dialog follows Settings rather than the pack's floor");
    }

    /* --- Auto, when it really was saved. The product keeps Auto; this only asserts it
       has to be chosen rather than arrived at. */
    h.setConfig(CONFIG_AUTO);
    {
      const { data } = await h.post("/api/generation/fal/image/plan", {
        purpose: "frame", shotId: "SH-1", sourceBuildId: h.frameBuild, aspectRatio: "16:9", outputCount: 2,
      });
      assert.strictEqual(data.quality, "auto", "Auto remains available when Auto is what was saved");
      note("auto: still reachable, but only as a saved choice");
    }

    /* --- An explicit dialog choice outranks Settings for this one request. */
    h.setConfig(CONFIG_A);
    {
      const { data } = await h.post("/api/generation/fal/image/plan", {
        purpose: "frame", shotId: "SH-1", sourceBuildId: h.frameBuild, aspectRatio: "16:9",
        outputCount: 2, quality: "high", resolution: "3840x2160",
      });
      assert.strictEqual(data.quality, "high", "an explicit dialog quality must win over the saved default");
      assert.strictEqual(data.size, "3840x2160", "an explicit dialog size must win over the saved default");
      note("override: an explicit dialog choice outranks Settings for that request");
    }

    /* --- H3. */
    h.setConfig(CONFIG_A);
    /* The H3 plan needs a motion package; without one the route refuses before it ever
       reaches the resolution, which would make a green assertion meaningless. So the
       resolution rule is asserted where it is decided instead. */
    {
      const { data, status } = await h.post("/api/generation/fal/h3/plan", {
        shotId: "SH-1", sourceBuildId: "no-such-motion-build", profileMode: "t2v", durationSeconds: 6,
      });
      assert.notStrictEqual(status, 200, "the fixture has no motion package, so this must refuse");
      assert(data.error, "and refuse with a stated reason rather than a silent 200");
    }

    /* --- What the provider is actually asked for is what the dialog confirmed. */
    h.setConfig(CONFIG_B);
    {
      const before = h.providerCalls.length;
      const { data, status } = await h.post("/api/generation/fal/jobs", {
        purpose: "frame", imagePlan: true, shotId: "SH-1", sourceBuildId: h.frameBuild,
        frameId: "FR-A", frameLabel: "A", aspectRatio: "16:9", outputCount: 1,
        prompt: "", clientRequestId: "defaults-provider-1",
      });
      assert.strictEqual(status, 200, `the compiled submit must succeed, got ${JSON.stringify(data).slice(0, 200)}`);
      /* The dispatch is asynchronous; the row records what it is going to send. */
      for (let i = 0; i < 60 && h.providerCalls.length === before; i += 1)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert(h.providerCalls.length > before, "the mocked provider must have been called");
      const sent = h.providerCalls[h.providerCalls.length - 1].body;
      assert.deepStrictEqual(sent.image_size, { width: 2048, height: 1152 },
        `the provider must be asked for the size the dialog confirmed, got ${JSON.stringify(sent.image_size)}`);
      assert.strictEqual(sent.quality, "medium",
        `the provider must be asked for the saved MEDIUM quality, got ${sent.quality}`);
      note("provider: the mocked request carries the saved medium / 2048x1152 the dialog resolved");
    }
    {
      /* And an explicit override reaches the provider unchanged rather than being
         re-defaulted at submission time. */
      const before = h.providerCalls.length;
      const { status } = await h.post("/api/generation/fal/jobs", {
        purpose: "frame", imagePlan: true, shotId: "SH-1", sourceBuildId: h.frameBuild,
        frameId: "FR-A", frameLabel: "A", aspectRatio: "16:9", outputCount: 1,
        quality: "high", resolution: "3840x2160",
        prompt: "", clientRequestId: "defaults-provider-2",
      });
      assert.strictEqual(status, 200);
      for (let i = 0; i < 60 && h.providerCalls.length === before; i += 1)
        await new Promise((resolve) => setTimeout(resolve, 25));
      const sent = h.providerCalls[h.providerCalls.length - 1].body;
      assert.deepStrictEqual(sent.image_size, { width: 3840, height: 2160 },
        "an explicit dialog size must survive to the provider rather than being re-defaulted");
      assert.strictEqual(sent.quality, "high");
      note("provider: an explicit dialog override survives submission and is what gets charged for");
    }

    /* --- Settings are read, never written. A dialog choice is for one request. */
    assert.deepStrictEqual(h.savedNow(), CONFIG_B,
      "no dialog request may rewrite the persisted generation defaults");
    note("persistence: after every plan, override and submit above, the saved defaults are byte-identical");
  } finally {
    h.close();
  }
}

/* ===========================================================================
   3. THE DIALOGS THEMSELVES, in the fake DOM the shipped scripts actually run in.

   The server can be right and the screen still wrong, so the initial value is read off
   the rendered control rather than inferred from the payload. */

/* render-harness evaluates the shipped scripts in SCRIPT_ORDER, which still does not
   include every picker script index.html loads. The remainder are evaluated into the
   SAME context here rather than added to the shared order, because that order is what
   every other suite renders through and widening it is not this change's business.

   shared-generation-options.js LEFT THIS LIST when the readiness derivation landed:
   the harness loads it now, because public/shared-shot-readiness.js derives its method
   truth by asking resolveTaskModes() at load. Evaluating it a second time here is not
   a harmless duplicate — every one of these scripts declares top-level `const`s in one
   shared scope, so a second evaluation is a SyntaxError on the first repeated
   identifier and takes the whole context with it. */
const PICKER_SCRIPTS = ["shared-model-intelligence.js", "generation-picker.js"];
function withPickerScripts(view) {
  for (const file of PICKER_SCRIPTS)
    vm.runInContext(readLF(path.join(ROOT, "public", file)), view.context, { filename: file });
  return view;
}
/* CONFIG is a top-level `let` in the evaluated client scripts — a lexical binding, not a
   property of the contextified global — so assigning to context.CONFIG from out here
   would create a second, invisible one. */
function setClientConfig(view, fal) {
  vm.runInContext(
    `CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: ${JSON.stringify({ enabled: true, apiKey: "test-key", ...fal })} } };`,
    view.context,
  );
}
const selectedOption = (html, id) => {
  const select = new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  if (!select) return null;
  const chosen = /<option value="([^"]*)"[^>]*\sselected/.exec(select[1]);
  return chosen ? chosen[1] : null;
};

async function dialogSection() {
  /* --- The frame dialog, opened under each configuration. The preview is served by a
     stub standing in for the route asserted in section 2, so this isolates the screen. */
  for (const [label, cfg, expectQuality, expectSize] of [
    ["CONFIG A", CONFIG_A, "low", "2048x1152"],
    ["CONFIG B", CONFIG_B, "medium", "2048x1152"],
  ]) {
    const view = withPickerScripts(await render("#/shot/L1-01", buildFixture()));
    setClientConfig(view, cfg);
    let planBody = null;
    view.context.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (String(url).includes("/api/generation/fal/image/plan")) {
        planBody = body;
        /* The stub answers the way the fixed route does: the saved default resolved
           against this shot's format. */
        return { ok: true, json: async () => ({
          ok: true, refusal: null, mode: "t2i", purpose: "frame",
          compiledPrompt: "COMPILED FRAME PROMPT", outputCount: body.outputCount,
          quality: body.quality || expectQuality, size: body.resolution || expectSize,
          sizes: ["1024x1024", "2048x1152", "3840x2160"], qualityTiers: ["auto", "low", "medium", "high"],
          aspectRatio: "16:9", references: [], warnings: [], coverage: {},
          source: { buildId: "b1", packageId: "p1", frameLabel: "A" },
          compiler: { packId: "gpt-image-2", packVersion: "1" }, dispatch: { model: "openai/gpt-image-2" },
        }) };
      }
      return { ok: true, json: async () => ({ options: [], normal: [] }) };
    };

    await view.context.openFalFrameGenerationModal("frame", "L1-01", "FR-A", "b1");
    await new Promise((resolve) => setTimeout(resolve, 25));
    /* READ FROM THE PANEL, not the modal string. The output settings moved into the
       shared Simple/Advanced block, which is filled after the modal is in the DOM, and
       the harness models the document as a flat id map — a sub-container's innerHTML is
       never part of its parent's. */
    const panel = () => view.context.document.getElementById("fal-frame-generation-view").innerHTML;

    assert(planBody, `${label}: the frame dialog must compile a plan before it opens`);
    /* SIMPLE IS THE DEFAULT, so Quality — a production decision — is on the opening
       screen and Size is not. Inheritance is asserted for both regardless of which view
       carries them: what a control opens on must not depend on how it was disclosed. */
    assert(panel().includes('data-gen-view="simple"'), `${label}: the dialog must open on Simple`);
    assert.strictEqual(selectedOption(panel(), "fal-frame-quality"), expectQuality,
      `${label}: the Quality control must open on the saved value`);
    assert.notStrictEqual(selectedOption(panel(), "fal-frame-quality"), "auto",
      `${label}: the audit's Auto must not be the initial value`);
    assert.strictEqual(selectedOption(panel(), "fal-frame-size"), null,
      `${label}: Size is an expert control and must not be on the Simple screen at all`);

    view.context.setGenerationViewMode("advanced");
    assert(panel().includes('data-gen-view="advanced"'), `${label}: the switch must reach Advanced`);
    assert.strictEqual(selectedOption(panel(), "fal-frame-size"), expectSize,
      `${label}: the Size control must open on the resolved saved size`);
    assert.strictEqual(selectedOption(panel(), "fal-frame-quality"), expectQuality,
      `${label}: and Advanced must not lose the saved quality on the way`);
    /* Back to Simple, and the saved inheritance is unchanged — a view switch is a
       disclosure, never an edit. */
    view.context.setGenerationViewMode("simple");
    assert.strictEqual(selectedOption(panel(), "fal-frame-quality"), expectQuality,
      `${label}: returning to Simple must not have changed what the dialog inherited`);
    note(`dialog: under ${label} the frame dialog opens on Simple at ${expectQuality}, and Advanced carries the resolved ${expectSize}`);
  }

  /* --- The H3 dialog. The value it opens on is the value it asked the server to
     compile, so the request body is where the hard-coded 2K used to be visible. */
  for (const [label, cfg, expected] of [["CONFIG A", CONFIG_A, "768P"], ["CONFIG B", CONFIG_B, "2K"]]) {
    const fixture = buildFixture();
    const view = await render("#/shot/L1-01", fixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
    setClientConfig(view, cfg);
    assert.strictEqual(view.context.falH3ResolutionValue(), expected,
      `${label}: the H3 dialog's saved resolution must read ${expected} from Settings`);
    note(`dialog: under ${label} the H3 dialog resolves its opening resolution to ${expected}`);
  }
  /* And an unsaved or nonsense value still lands on a resolution the model offers. */
  {
    const view = await render("#/shot/L1-01", buildFixture());
    setClientConfig(view, { h3Resolution: "9000P" });
    assert.strictEqual(view.context.falH3ResolutionValue(), "2K", "an unsupported saved H3 resolution must fail closed onto a documented one");
    setClientConfig(view, {});
    assert.strictEqual(view.context.falH3ResolutionValue(), "2K", "and an unset one keeps the shipped default");
    note("H3: an unsupported or absent saved resolution falls back to a documented value rather than throwing");
  }

  /* --- The good case the audit found working. It must stay working. */
  {
    const view = await render("#/shot/L1-01", buildFixture());
    setClientConfig(view, CONFIG_B);
    const cfg = view.context.falGenerationConfig();
    assert.strictEqual(cfg.frameQuality, "medium", "the entity-reference path must still read the saved frame quality");
    assert.strictEqual(view.context.falResolutionValue("frame"), "2k", "and the saved frame resolution");
    assert.strictEqual(view.context.falResolutionValue("blocking"), "2k", "and the saved blocking resolution");
    setClientConfig(view, CONFIG_A);
    assert.strictEqual(view.context.falGenerationConfig().frameQuality, "low");
    assert.strictEqual(view.context.falResolutionValue("frame"), "1k");
    note("regression: the entity-reference path still inherits its saved defaults under both configurations");
  }
}

/* ===========================================================================
   4. WHAT MUST NOT HAVE BEEN DONE.

   The audit was run at LOW / 1K / 768P, so the cheapest way to make sections 1-3 green
   is to write those three values into the source. These are the assertions that stop
   that from being a passing implementation. */

const PACK_SOURCE = readLF(path.join(ROOT, "model-packs", "gpt-image-2.js"));
const SERVER_SOURCE = readLF(path.join(ROOT, "fal-generation.js"));
const CLIENT_SOURCE = readLF(path.join(ROOT, "public", "fal-generation.js"));
const PICKER_SOURCE = readLF(path.join(ROOT, "public", "generation-picker.js"));

/* The H3 dialog must not carry a literal resolution into its opening plan request. */
{
  const opener = CLIENT_SOURCE.slice(CLIENT_SOURCE.indexOf("window.openFalH3MotionModal"));
  const planCall = opener.slice(opener.indexOf("fetchFalH3Plan("), opener.indexOf("if (!preview) return;"));
  assert(!/resolution:\s*"(2K|768P)"/.test(planCall),
    "the H3 dialog must not hard-code a resolution into the plan request it opens with");
  assert(/resolution:\s*falH3ResolutionValue\(\)/.test(planCall),
    "it must resolve the saved default instead");
  note("no hard-coding: the H3 dialog reads Settings rather than naming a resolution");
}
/* The picker must not acquire its own copy of the defaults either — the point is one
   resolution path, not a second settings system in the browser. */
assert(!/frameQuality|frameResolution|blockingResolution/.test(PICKER_SOURCE),
  "the frame picker must not grow its own copy of the saved quality or resolution");
note("no second system: the frame picker holds no copy of the saved quality or resolution");

/* And the server's fallback must be the saved value, not a constant. */
{
  const helper = SERVER_SOURCE.slice(SERVER_SOURCE.indexOf("function savedImageSettings("));
  const body = helper.slice(0, helper.indexOf("\n  }"));
  assert(/cfg\.frameResolution/.test(body) && /cfg\.blockingResolution/.test(body),
    "the compiled path's resolution fallback must be the saved setting");
  assert(/cfg\.frameQuality/.test(body) && /cfg\.blockingQuality/.test(body),
    "and so must its quality fallback");
  assert(!/"(low|1k|768P|2048x1152)"/.test(body),
    "the fallback must not name an audit value as a constant");
  note("no hard-coding: the server's fallback names the saved setting and no literal tier");
}
/* The tier resolver must derive the tier rather than keep a table that can drift. */
assert(/function sizeTier\(/.test(PACK_SOURCE), "the pack must own the tier derivation");
assert(!/SIZES_BY_TIER|TIER_SIZES/.test(PACK_SOURCE), "and must not keep a parallel size table to disagree with itself");
note("no drift: the size tier is derived from the documented long edge, not a second table");

/* ===========================================================================
   5. THE SPENDING GATE THIS CHANGE MUST NOT HAVE TOUCHED.

   F-065 was the audit's strongest financial finding: a 2/2-approved FLF shot was still
   stopped by a motion-readiness check before the H3 video was bought. It is a
   navigation gate — it runs before the dialog exists — and B1 changes what the dialog
   opens at, nothing about when it may open. */
{
  const STUDIO_SOURCE = readLF(path.join(ROOT, "public", "creation-studio.js"));
  const opener = STUDIO_SOURCE.slice(STUDIO_SOURCE.indexOf("window.openGuidedMotionFromFrames"));
  const gate = opener.indexOf("if (approvedCount >= 2 && !sequenceReview?.pass) return toast(");
  const navigates = opener.indexOf("c.deliveryIntent = \"motion\";");
  assert(gate > 0, "the motion-readiness gate must still exist");
  assert(navigates > 0, "and the motion panel must still be reachable through it");
  assert(gate < navigates,
    "the readiness check must still run BEFORE the motion panel opens, not after");
  /* Nothing in the paid H3 dialog may re-decide readiness — moving that judgement into
     the dialog is how a gate gets reordered after a submit without anyone noticing. */
  const h3Opener = CLIENT_SOURCE.slice(
    CLIENT_SOURCE.indexOf("window.openFalH3MotionModal"),
    CLIENT_SOURCE.indexOf("window.startFalH3MotionGeneration"),
  );
  assert(!/sequenceReview|guidedFrameSequenceReviewState/.test(h3Opener),
    "the paid dialog must not re-judge motion readiness; the gate stays upstream of it");
  note("F-065: the motion-readiness gate still runs before the motion panel and is not re-judged inside the paid dialog");
}

async function main() {
  await serverSection();
  await dialogSection();
  console.log("Saved generation defaults passed: every paid still-image and motion dialog opens on the value the filmmaker saved, or on the value this model constrains it to with the substitution named.");
  for (const line of notes) console.log(`  - ${line}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
