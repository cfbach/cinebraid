const assert = require("assert");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testProjectScopedSaveBeforeSwitch() {
  const projects = {
    "project-a": buildFixture(),
    "project-b": buildFixture(),
  };
  projects["project-a"].meta.title = "Project A";
  projects["project-b"].meta.title = "Project B";
  let active = "project-a";
  const events = [];
  const customFetch = async (url, options, response) => {
    if (url === "/api/project")
      return response(projects[active], 200, {
        "x-cinebraid-project-slug": active,
      });
    if (/^\/api\/projects\/[^/]+\/project$/.test(url) && options.method === "PUT") {
      const slug = decodeURIComponent(url.split("/")[3]);
      events.push(`save-start:${slug}`);
      await delay(35);
      projects[slug] = JSON.parse(options.body);
      events.push(`save-end:${slug}`);
      return response({ ok: true, slug });
    }
    if (url === "/api/projects/switch" && options.method === "POST") {
      const body = JSON.parse(options.body);
      events.push(`switch:${body.slug}`);
      active = body.slug;
      return response({ ok: true });
    }
    if (url === "/api/projects")
      return response({ active, projects: Object.keys(projects).map((slug) => ({ slug, title: projects[slug].meta.title })) });
    return null;
  };

  const rendered = await render("#/production", projects[active], { fetch: customFetch });
  vm.runInContext(`P.meta.title = "Project A changed"`, rendered.context);
  rendered.context.dirty();
  await rendered.context.switchProject("project-b");

  assert.deepStrictEqual(events.slice(0, 3), [
    "save-start:project-a",
    "save-end:project-a",
    "switch:project-b",
  ]);
  assert.strictEqual(projects["project-a"].meta.title, "Project A changed");
  assert.strictEqual(projects["project-b"].meta.title, "Project B");
  assert.strictEqual(vm.runInContext(`P.meta.title`, rendered.context), "Project B");
}

async function testPromptTimeoutAndRetryMarkup() {
  const fixture = buildFixture();
  const rendered = await render("#/shot/L1-01", fixture, {
    fetch: async (url, options) => {
      if (url !== "/hang") return null;
      return new Promise((resolve, reject) => {
        const abort = () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        options.signal?.addEventListener("abort", abort, { once: true });
      });
    },
  });
  let message = "";
  try {
    await rendered.context.guidedPromptRequest("/hang", {}, 15, "Prompt test");
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /timed out/i);
  const markup = rendered.context.guidedPromptErrorMarkup(message, "retryPrompt()");
  assert(markup.includes("Retry"));
  assert(markup.includes("retryPrompt()"));
}

async function testFrameReplacementReopensMotion() {
  const fixture = buildFixture();
  fixture.shots[0].winner = "FRAME_A.png";
  fixture.shots[0].clips[0].videoWinner = "approved-motion.mp4";
  const rendered = await render("#/shot/L1-01", fixture);
  rendered.context.selectGuidedFrameCandidate("L1-01", "frame-a", "FRAME_B.png");
  rendered.context.approveGuidedStill("L1-01", "FRAME_B.png");
  rendered.context.document.getElementById("approve-target").value = "shot";
  rendered.context.document.getElementById("approve-name").value = "FRAME_B.png";
  await rendered.gesture.act(() => rendered.context.confirmApproveTake());
  await delay(20);
  const state = vm.runInContext(
    `(() => { const s=P.shots[0]; return { shot:s.winner, frame:s.keyframes[0].winner, motion:s.clips[0].videoWinner||"" }; })()`,
    rendered.context,
  );
  assert.strictEqual(state.shot, "FRAME_B.png");
  assert.strictEqual(state.frame, "FRAME_B.png");
  assert.strictEqual(state.motion, "", "replacing Frame A must reopen dependent motion");
}

async function testExactImportPreviewCommit() {
  const current = buildFixture();
  const normalized = buildFixture();
  normalized.meta.title = "Normalized Import";
  normalized.scenes[0].whatHappens = "The exact normalized story beat.";
  let active = "current";
  let commitBody = null;
  const customFetch = async (url, options, response) => {
    if (url === "/api/project")
      return response(active === "current" ? current : normalized, 200, {
        "x-cinebraid-project-slug": active,
      });
    if (url === "/api/projects/preview-import-json" && options.method === "POST")
      return response({
        ok: true,
        title: normalized.meta.title,
        previewToken: "preview-token-1",
        previewHash: "a".repeat(64),
        normalizedProject: normalized,
        review: {
          counts: { characters: 1, locations: 1, props: 1, vehicles: 1, scenes: 1, shots: 1, keyframes: 2, motionUnits: 2 },
          sourceCounts: { characters: 1, locations: 1, props: 1, vehicles: 1, scenes: 1, shots: 1, keyframes: 0, motionUnits: 0 },
          inferred: [{ path: "shots[0].keyframes[0].description", value: "[INFERRED FOR PLANNING] Opening composition." }],
          conflicts: [],
          missing: [],
          removed: [],
          review: [],
          continuity: [],
          outline: [{
            id: "SC-01",
            title: "Maintenance Bay",
            tier: "A",
            whatHappens: "The exact normalized story beat.",
            howItFeels: "Quiet and procedural.",
            shots: [{
              id: "L1-01",
              title: "Hull check",
              duration: 9,
              route: "GENERATE",
              description: "Exact normalized visible action.",
              positioning: "Locked wide composition.",
              risks: [],
              keyframes: [{ id: "frame-a", label: "A", description: "Opening composition." }],
              motionUnits: [{ id: "motion-a", kind: "i2v", duration: 5, motionPrompt: "Worker checks the panel." }],
            }],
          }],
        },
      });
    if (url === "/api/projects/import-json" && options.method === "POST") {
      commitBody = JSON.parse(options.body);
      active = "normalized-import";
      return response({ ok: true, slug: active, counts: { scenes: 1, shots: 1, characters: 1, locations: 1, props: 1 } });
    }
    return null;
  };
  const rendered = await render("#/create", current, { fetch: customFetch });
  rendered.context.document.getElementById("project-builder-json").value = JSON.stringify({ meta: { title: "Raw" } });
  await rendered.context.importProjectBuilderJSON();
  const html = rendered.context.document.getElementById("project-builder-result").innerHTML;
  assert(html.includes("Exact normalized visible action."));
  assert(html.includes("a".repeat(64)));
  assert.strictEqual(rendered.context._projectBuilderCandidate.previewToken, "preview-token-1");
  await rendered.context.commitProjectBuilderImport();
  assert.deepStrictEqual(commitBody, {
    previewToken: "preview-token-1",
    previewHash: "a".repeat(64),
  });
  assert(!("project" in commitBody), "commit must not resend or renormalize the raw project");
}

async function main() {
  await testProjectScopedSaveBeforeSwitch();
  await testPromptTimeoutAndRetryMarkup();
  await testFrameReplacementReopensMotion();
  await testExactImportPreviewCommit();
  console.log("Browser workflow suite passed project-scoped save flushing, prompt timeout retry, frame replacement reopening, and exact import preview commit.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
