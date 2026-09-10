/* CineBraid local-only AI policy.

   A project set to local-only is asking for its material to stay on this machine.
   That used to be resolved to the literal provider name "ollama", which both refused
   a loopback custom server and would have accepted an Ollama URL on another computer.
   Locality is a property of the endpoint, and this suite pins both halves of it:
   loopback qualifies, everything else does not.

   The endpoints here are local mocks and one deliberately unresolvable name. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-local-only-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "policy-project");
const CONFIG_PATH = path.join(TEMP, "config.json");
const REMOTE_BASE = "http://remote-provider.example/v1";

/* THE THING THAT MUST NOT LEAVE, written into the project so it can only arrive at a
   provider by way of the compact record /api/project/ask builds. Distinctive enough
   that finding it in a request body is not a coincidence, and it is in the title AND a
   shot description so a partial record still carries it. */
const SENTINEL = "CINEBRAID-LOCAL-ONLY-SENTINEL-8f3ad2";

/* THE REMOTE-DESIGNATED SPY.
 *
 * A privacy proof needs a provider the POLICY calls remote and the TEST can watch.
 * `remote-provider.example` is neither: it is unreachable, so "the mock logged nothing"
 * is satisfied both by a policy that refused to send and by a policy that sent and got
 * DNS failure. Those are opposite outcomes and that mock cannot tell them apart.
 *
 * This one can. It listens on loopback — nothing leaves the machine — and llm.js's
 * CINEBRAID_TEST_REMOTE_ENDPOINTS seam makes the locality policy treat its origin as
 * somewhere else. It records every request it receives and whether the project
 * sentinel was in the body, so "nothing was disclosed" is a measurement rather than
 * the absence of one. */
const spy = { hits: [], sentinelHits: 0, base: "", origin: "" };

let child = null;
const servers = [];
const customChat = [];
const ollamaChat = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(handler) {
  const port = await freePort();
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  servers.push(server);
  return { server, port };
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? null : JSON.stringify(options.body);
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = text;
        try { data = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, text, data });
      });
    });
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`server exited early: ${child.output}`);
    try {
      const response = await request(port, "/api/projects");
      if (response.status === 200) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

async function stopServer() {
  if (child && child.exitCode == null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (child.exitCode == null) child.kill("SIGKILL");
  }
  for (const server of servers) server.close();
}

function writeProject(aiPolicy) {
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify({
    meta: { title: SENTINEL, format: "Test", version: "v1", hubVersion: "v5.5.0", aiPolicy },
    qcChecklist: [],
    characters: [],
    locations: [],
    props: [],
    vehicles: [],
    audio: [],
    mediaAssets: [],
    scenes: [{ id: "SC-01", title: "Scene One" }],
    shots: [{
      id: "S-01",
      scene: "SC-01",
      title: "Test shot",
      desc: `A fixed exterior camera watches a ship in darkness. ${SENTINEL}`,
      positioning: "Locked hull-camera composition.",
      dur: 10,
      workflowStatus: "DRAFT",
      characters: [],
      codes: [],
      keyframes: [],
      clips: [],
    }],
    jobs: [],
    agentRuns: [],
    decisions: [],
    sessions: [],
  }, null, 2));
}

function writeConfigFile(patch) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "policy-project",
    assistant: { provider: "custom", visionProvider: "ollama" },
    agents: { enabled: false },
    generation: { fal: { enabled: false, apiKey: "" } },
    customModel: "local-text-model",
    ollamaModel: "local-text-model",
    ollamaVisionModel: "local-vision-model",
    ollamaEmbedModel: "local-embed-model",
    ...patch,
  }, null, 2));
}

async function compile(port, useLLM) {
  return request(port, "/api/prompt/compile", {
    method: "POST",
    body: {
      shotId: "S-01",
      profileId: "gpt-image-2/t2i",
      purpose: "shot-still",
      references: [],
      useLLM,
    },
  });
}

/* THE BRAIDY RAIL'S QUESTION, which reaches /api/project/ask.

   That route resolved its provider from cfg.assistant.provider directly and never
   consulted the policy, so a local-only project's compact record would have been
   posted to a configured remote API. Nothing had ever called the route, so nothing had
   ever hit it; the Braidy rail calls it, which is what makes it worth pinning here
   beside the compile path it now matches. */
async function ask(port, question = "What is left to do on this shot?") {
  return request(port, "/api/project/ask", { method: "POST", body: { question } });
}

/* THE DETECTOR, named once so a control can require it to FAIL.
 *
 * "Nothing was disclosed" is asserted against what the spy received, not against what
 * the client got back. A non-200 is not evidence of a request never sent, and this
 * says so by never looking at the status here. */
function assertNoDisclosure(where) {
  assert.strictEqual(spy.hits.length, 0,
    `${where}: the remote-designated provider received ${spy.hits.length} request(s) (${spy.hits.join(", ")}). A local-only project's material must not reach an endpoint the policy calls remote.`);
  assert.strictEqual(spy.sentinelHits, 0,
    `${where}: the compact project record reached the remote-designated provider — the sentinel ${SENTINEL} was in ${spy.sentinelHits} request body/bodies.`);
}

/* PATCH server.js WITHOUT TOUCHING IT.
 *
 * A preload hooks Module.prototype._compile in the child and substitutes the mutated
 * source as server.js is loaded, so the file on disk is never written and no checkout
 * can be the thing that undoes a control. The child prints a receipt: the anchor must
 * be present exactly once, or it exits 66 and the control reports itself stale rather
 * than passing against an unmutated server. */
function writePreload(dir, find, replace) {
  const file = path.join(dir, "patch-server.js");
  fs.writeFileSync(file, [
    'const Module = require("module");',
    'const target = process.env.CINEBRAID_TEST_PATCH_TARGET;',
    'const find = process.env.CINEBRAID_TEST_PATCH_FIND;',
    'const replace = process.env.CINEBRAID_TEST_PATCH_REPLACE;',
    'const original = Module.prototype._compile;',
    'Module.prototype._compile = function (content, filename) {',
    '  if (filename === target) {',
    '    const hits = content.split(find).length - 1;',
    '    if (hits !== 1) { console.error("PATCH-RECEIPT-STALE hits=" + hits); process.exit(66); }',
    '    content = content.split(find).join(replace);',
    '    console.log("PATCH-RECEIPT-APPLIED");',
    '  }',
    '  return original.call(this, content, filename);',
    '};',
  ].join("\n"));
  return { file, find, replace };
}

async function main() {
  /* ---- 1. what counts as an endpoint on this machine ---- */
  const { isLocalProviderEndpoint } = require("../src/assistant/llm");
  for (const local of [
    "http://127.0.0.1:11436",
    "http://127.0.0.1:11436/v1",
    "https://127.0.0.1/v1",
    "http://127.5.4.3:8000/v1",
    "http://localhost:11436/v1",
    "http://LocalHost:11436/v1",
    "http://localhost./v1",
    "http://api.localhost:8000/v1",
    "http://[::1]:11436/v1",
    "http://[0:0:0:0:0:0:0:1]:11436/v1",
    "http://[::ffff:127.0.0.1]:11436/v1",
    "http://operator@127.0.0.1:11436/v1",
  ])
    assert.strictEqual(isLocalProviderEndpoint(local), true, `${local} is on this machine`);

  for (const remote of [
    "http://192.168.68.116:11436/v1",
    "http://10.0.0.4:8000/v1",
    "http://spark.local:11436/v1",
    "https://api.openai.com/v1",
    "http://127.0.0.1.evil.example/v1",
    // The loopback address is the user info here; the host is somebody else entirely.
    "http://127.0.0.1:11436@evil.example/v1",
    "http://notlocalhost/v1",
    "http://localhost.evil.example/v1",
    "http://[::2]:11436/v1",
    "http://0.0.0.0:11436/v1",
    "http://127.0.0.999:11436/v1",
    "127.0.0.1:11436",
    "not a url",
    "",
    null,
    undefined,
  ])
    assert.strictEqual(isLocalProviderEndpoint(remote), false, `${remote} must not satisfy local-only`);

  /* ---- 1b. the test-only designation, and the one direction it may point ----

     CINEBRAID_TEST_REMOTE_ENDPOINTS exists so a privacy proof can watch a provider the
     policy calls remote without a packet leaving the machine. A seam in production
     code earns that by being incapable of the dangerous direction: it can make an
     endpoint LESS local and nothing else, so the worst a wrong value can do is make
     CineBraid refuse to send something. */
  const { designatedRemoteEndpoint } = require("../src/assistant/llm");
  const declared = process.env.CINEBRAID_TEST_REMOTE_ENDPOINTS;
  try {
    delete process.env.CINEBRAID_TEST_REMOTE_ENDPOINTS;
    assert.strictEqual(designatedRemoteEndpoint("http://127.0.0.1:11436/v1"), false,
      "with nothing declared the seam must not be consulted at all");
    assert.strictEqual(isLocalProviderEndpoint("http://127.0.0.1:11436/v1"), true,
      "with nothing declared, locality must be exactly what it always was");

    process.env.CINEBRAID_TEST_REMOTE_ENDPOINTS = "http://127.0.0.1:11436";
    assert.strictEqual(isLocalProviderEndpoint("http://127.0.0.1:11436/v1"), false,
      "a declared origin must stop satisfying local-only");
    assert.strictEqual(isLocalProviderEndpoint("http://127.0.0.1:11437/v1"), true,
      "only the declared origin is affected; matching must be by origin, not by prefix");
    assert.strictEqual(isLocalProviderEndpoint("http://localhost:11436/v1"), true,
      "a different host on the same port is a different origin and must be untouched");

    /* THE DANGEROUS DIRECTION IS NOT AVAILABLE. Whatever is declared, nothing that was
       remote becomes local — the seam is only ever read to return false. */
    for (const declaration of ["https://api.openai.com", "http://192.168.68.116:11434", "http://127.0.0.1:11436", "not a url", ""]) {
      process.env.CINEBRAID_TEST_REMOTE_ENDPOINTS = declaration;
      for (const remote of ["https://api.openai.com/v1", "http://192.168.68.116:11434", "http://spark.local:11436/v1"])
        assert.strictEqual(isLocalProviderEndpoint(remote), false,
          `declaring "${declaration}" made ${remote} satisfy local-only; this seam must only ever subtract locality`);
    }
  } finally {
    if (declared === undefined) delete process.env.CINEBRAID_TEST_REMOTE_ENDPOINTS;
    else process.env.CINEBRAID_TEST_REMOTE_ENDPOINTS = declared;
  }

  /* ---- 2. the policy actually routes that way ---- */
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });

  const custom = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/chat/completions")) {
      customChat.push(req.url);
      return res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    }
    res.end(JSON.stringify({ object: "list", data: [{ id: "local-text-model" }] }));
  });
  const ollama = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags")
      return res.end(JSON.stringify({ models: [{ name: "local-text-model" }, { name: "local-vision-model" }, { name: "local-embed-model" }] }));
    ollamaChat.push(req.url);
    res.end(JSON.stringify({ message: { content: "{}" } }));
  });
  /* Answers like a normal OpenAI-compatible server, and records what it was given. */
  const spyServer = await startServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models" || req.url.endsWith("/models"))
        return res.end(JSON.stringify({ object: "list", data: [{ id: "local-text-model" }] }));
      spy.hits.push(req.url);
      if (body.includes(SENTINEL)) spy.sentinelHits += 1;
      res.end(JSON.stringify({ choices: [{ message: { content: "Nothing should have reached me." } }] }));
    });
  });
  spy.base = `http://127.0.0.1:${spyServer.port}/v1`;
  spy.origin = `http://127.0.0.1:${spyServer.port}`;

  const localBase = `http://127.0.0.1:${custom.port}/v1`;
  const ollamaUrl = `http://127.0.0.1:${ollama.port}`;

  writeProject("local-only");
  writeConfigFile({ customBaseUrl: localBase, ollamaUrl });

  const port = await freePort();
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
      CINEBRAID_CONFIG_PATH: CONFIG_PATH,
      /* Only this origin, and only ever to make it less local. */
      CINEBRAID_TEST_REMOTE_ENDPOINTS: spy.origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { child.output += chunk.toString(); });

  const reset = () => { customChat.length = 0; ollamaChat.length = 0; spy.hits.length = 0; spy.sentinelHits = 0; };

  try {
    await waitForServer(port);

    /* a loopback custom endpoint satisfies local-only */
    let response = await compile(port, true);
    assert.strictEqual(response.status, 200);
    assert(customChat.length > 0, "a loopback custom endpoint must be allowed to serve a local-only project");
    assert.strictEqual(ollamaChat.length, 0, "the custom provider must not be silently replaced by Ollama");

    /* the same provider pointed somewhere else does not */
    reset();
    writeConfigFile({ customBaseUrl: REMOTE_BASE, ollamaUrl });
    response = await compile(port, true);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(customChat.length, 0, "a remote custom endpoint must never serve a local-only project");
    assert(ollamaChat.length > 0, "local-only falls back to the local Ollama endpoint");

    /* neither does a remote Ollama: with nothing local, the request is refused */
    reset();
    writeConfigFile({ customBaseUrl: REMOTE_BASE, ollamaUrl: "http://192.168.68.116:11434" });
    response = await compile(port, true);
    assert.strictEqual(response.status, 200, "a refused assistant still compiles deterministically");
    assert.strictEqual(response.data.llmUsed, false);
    assert.strictEqual(customChat.length, 0);
    assert.strictEqual(ollamaChat.length, 0, "no provider may be contacted when none of them is local");
    assert(
      response.data.warnings.some((warning) => /local-only/i.test(warning)),
      "the compiled prompt must say why the assistant was not used",
    );

    /* THE SAME THREE ANSWERS FOR A PROJECT QUESTION.

       Asserted against the mocks rather than against the response, because what is
       being pinned is which host the material reached — a 200 that quietly went to a
       remote API is the failure, not a shape. */
    reset();
    writeProject("local-only");
    writeConfigFile({ customBaseUrl: localBase, ollamaUrl });
    response = await ask(port);
    assert.strictEqual(response.status, 200, "a loopback custom endpoint must be allowed to answer a local-only project's question");
    assert(customChat.length > 0, "the loopback custom endpoint must be the one that answered");

    reset();
    writeConfigFile({ customBaseUrl: REMOTE_BASE, ollamaUrl });
    response = await ask(port);
    /* THE POSITIVE CLAIM FIRST, because it is the one that can fail for the right
       reason. REMOTE_BASE is an unresolvable name rather than a mock, so
       `customChat.length === 0` is satisfied both by a policy that redirected the
       request and by one that sent it to the remote and got DNS failure. Only "Ollama
       answered" separates them. */
    assert(ollamaChat.length > 0,
      "a local-only project's question must be re-pointed at the local Ollama endpoint; the configured remote custom endpoint was used instead");
    assert.strictEqual(customChat.length, 0, "the loopback custom mock must not have served this case at all");

    reset();
    writeConfigFile({ customBaseUrl: REMOTE_BASE, ollamaUrl: "http://192.168.68.116:11434" });
    response = await ask(port);
    assert.strictEqual(customChat.length + ollamaChat.length, 0,
      "with no local provider a local-only project's question must be refused rather than sent");
    assert.notStrictEqual(response.status, 200, "the refusal must be reported rather than answered around");

    /* a project without the policy keeps its configured routing */
    reset();
    writeProject("project-default");
    writeConfigFile({ customBaseUrl: localBase, ollamaUrl });
    response = await compile(port, true);
    assert.strictEqual(response.status, 200);
    assert(customChat.length > 0, "an unrestricted project must still use its configured provider");

    /* ---- 3. THE BRAIDY RAIL'S QUESTION CANNOT DISCLOSE THE RECORD ----

       The route became reachable from the UI in this batch, so its privacy boundary is
       proved against a provider that is remote to the policy and watched by the test,
       rather than against an unreachable name that cannot distinguish a refusal from a
       failed connection. */

    /* THE SPY IS A REAL SPY. Proved first, because a spy that can never be hit would
       make every assertion after it vacuous: an unrestricted project routes to it and
       the record arrives, sentinel and all. */
    reset();
    writeProject("project-default");
    writeConfigFile({ customBaseUrl: spy.base, ollamaUrl });
    response = await ask(port);
    assert.strictEqual(response.status, 200, "an unrestricted project must still reach its configured provider");
    assert.ok(spy.hits.length > 0, "the spy is not receiving anything even when it should; every disclosure assertion after this would be vacuous");
    assert.ok(spy.sentinelHits > 0, "the compact record must actually carry the project sentinel, or its absence later proves nothing");

    /* LOCAL-ONLY, POINTED STRAIGHT AT IT. The record is re-pointed at the local Ollama
       endpoint and the remote-designated provider is never contacted. */
    reset();
    writeProject("local-only");
    writeConfigFile({ customBaseUrl: spy.base, ollamaUrl });
    response = await ask(port);
    assertNoDisclosure("local-only with the assistant pointed at a remote-designated provider");
    assert.ok(ollamaChat.length > 0, "the question must fall back to the local endpoint rather than simply failing");
    assert.strictEqual(response.status, 200, "the local fallback must answer");
    console.log(`  Local-only privacy · assistant pointed at the remote-designated spy: spy hits ${spy.hits.length}, sentinel bodies ${spy.sentinelHits}, local fallback ${ollamaChat.length} request(s)`);

    /* AND WITH NOTHING LOCAL LEFT, it refuses rather than sending. */
    reset();
    writeConfigFile({ customBaseUrl: spy.base, ollamaUrl: "http://192.168.68.116:11434" });
    response = await ask(port);
    assertNoDisclosure("local-only with no local provider configured");
    assert.strictEqual(ollamaChat.length, 0, "no provider may be contacted when none of them is local");
    assert.notStrictEqual(response.status, 200, "the refusal must be reported rather than answered around");
    console.log(`  Local-only privacy · no local provider left: spy hits ${spy.hits.length}, sentinel bodies ${spy.sentinelHits}, ollama ${ollamaChat.length}, HTTP ${response.status}`);

    /* A CALLER CANNOT ASK FOR THE REMOTE PROVIDER. The route takes no provider from the
       body, and supplying every spelling of one changes nothing. */
    for (const body of [{ provider: "custom" }, { task: "prompt", provider: "custom" }, { providerOverride: "custom" }, { model: "local-text-model", provider: "custom" }]) {
      reset();
      writeConfigFile({ customBaseUrl: spy.base, ollamaUrl });
      const forced = await request(port, "/api/project/ask", { method: "POST", body: { question: "What is left to do?", ...body } });
      assertNoDisclosure(`local-only with ${JSON.stringify(body)} supplied by the caller`);
      assert.ok(forced.status === 200 || forced.status >= 400, "the route must answer or refuse, not hang");
    }

    /* AND BRAIDY USES THIS ROUTE. Not a second one: the rail's only request is here. */
    const railSource = fs.readFileSync(path.join(ROOT, "public", "braidy-rail.js"), "utf8");
    const railRoutes = [...railSource.matchAll(/["'](\/api\/[^"']+)["']/g)].map((match) => match[1]);
    assert.deepStrictEqual(railRoutes, ["/api/project/ask"],
      `the rail reaches ${railRoutes.join(", ") || "no route"}; this privacy boundary only covers the route Braidy actually uses`);

    /* ---- 4. THE NEGATIVE CONTROL: the same request, with the policy bypassed ----

       aiProviderOverride() is what makes the route consult the project's policy. Put
       the direct config read back — the exact shape this route shipped with before it
       became reachable — and the disclosure is observable rather than argued: the
       remote-designated spy receives the request, the sentinel is in the body, and
       assertNoDisclosure fails naming that. */
    reset();
    writeProject("local-only");
    writeConfigFile({ customBaseUrl: spy.base, ollamaUrl });
    const bypassPort = await freePort();
    const preload = writePreload(TEMP,
      "    const provider = aiProviderOverride();",
      '    const provider = readConfig().assistant?.provider || "ollama";');
    const bypassed = spawn(process.execPath, ["--require", preload.file, "server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(bypassPort),
        CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
        CINEBRAID_CONFIG_PATH: CONFIG_PATH,
        CINEBRAID_TEST_REMOTE_ENDPOINTS: spy.origin,
        CINEBRAID_TEST_PATCH_TARGET: path.join(ROOT, "src/server/server.js"),
        CINEBRAID_TEST_PATCH_FIND: preload.find,
        CINEBRAID_TEST_PATCH_REPLACE: preload.replace,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bypassOutput = "";
    bypassed.stdout.on("data", (chunk) => { bypassOutput += chunk.toString(); });
    bypassed.stderr.on("data", (chunk) => { bypassOutput += chunk.toString(); });
    let detectorFailure = "";
    try {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (bypassed.exitCode != null) throw new Error(`the bypassed server exited early: ${bypassOutput}`);
        try { if ((await request(bypassPort, "/api/projects")).status === 200) break; } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      /* THE MUTATION LANDED. Not inferred from behaviour — the preload said so, and it
         would have exited 66 if the anchor had gone stale or become ambiguous. */
      assert.ok(bypassOutput.includes("PATCH-RECEIPT-APPLIED"),
        `the bypass was not applied to server.js, so nothing below is a receipt:\n${bypassOutput}`);
      assert.ok(!bypassOutput.includes("PATCH-RECEIPT-STALE"), "the bypass anchor is stale and the control must be rewritten");

      const leaked = await ask(bypassPort);
      assert.ok(spy.hits.length > 0,
        "the bypassed route did not reach the remote-designated provider, so the control proves nothing about the protection it removed");
      assert.ok(spy.sentinelHits > 0,
        "the bypassed route contacted the provider but the compact record did not carry the sentinel; the control must observe the disclosure itself");
      assert.strictEqual(leaked.status, 200, "the bypassed route answered from the remote-designated provider");

      try {
        assertNoDisclosure("the bypassed route");
        assert.fail("the detector accepted a run in which the project record demonstrably reached a remote-designated provider");
      } catch (error) {
        if (!(error instanceof assert.AssertionError)) throw error;
        detectorFailure = String(error.message).split("\n")[0];
        assert.ok(/received \d+ request/.test(detectorFailure) || /sentinel/.test(detectorFailure),
          `the detector failed for the wrong reason: ${detectorFailure}`);
      }
    } finally {
      if (bypassed.exitCode == null) {
        bypassed.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => bypassed.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
        if (bypassed.exitCode == null) bypassed.kill("SIGKILL");
      }
      fs.rmSync(preload.file, { force: true });
    }

    /* AND THE SHIPPED ROUTE, ONE MORE TIME, WITH THE SPY BACK AT ZERO. Nothing on disk
       was ever mutated, so "restored" is a statement about the child process that is
       gone rather than about bytes that had to be put back. */
    reset();
    response = await ask(port);
    assertNoDisclosure("the shipped route, after the bypass control");
    assert.ok(ollamaChat.length > 0, "the shipped route must still answer through the local provider");
    console.log(`  Bypass control: the detector caught it — ${detectorFailure}`);

    /* ---- 5. deterministic compilation stays deterministic ---- */
    reset();
    writeProject("local-only");
    const first = await compile(port, false);
    const second = await compile(port, false);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.data.llmUsed, false);
    assert(first.data.compiledPrompt.length > 0);
    assert.strictEqual(
      first.data.compiledPrompt,
      second.data.compiledPrompt,
      "useLLM:false must compile the same prompt every time",
    );
    assert.strictEqual(customChat.length + ollamaChat.length, 0, "useLLM:false must contact no provider at all");

    console.log("Local-only policy suite passed: loopback endpoints qualify, remote custom and remote Ollama endpoints do not, a project with no local provider refuses rather than sends on both the compile path and the Braidy rail's question path, a remote-designated loopback spy receives the record from an unrestricted project and zero requests from a local-only one whatever the caller supplies, the same route with aiProviderOverride() removed discloses it and is caught, and deterministic compilation is untouched.");
  } finally {
    await stopServer();
    fs.rmSync(TEMP, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  console.error(error.stack || error.message || error);
  await stopServer();
  fs.rmSync(TEMP, { recursive: true, force: true });
  process.exitCode = 1;
});
