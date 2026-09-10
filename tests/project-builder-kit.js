/* The Project Builder Prompt Kit — PROJECT BUILDER CONTRACT 1.0.
 *
 * The kit is six files a filmmaker hands to an outside model. Three things had gone
 * wrong with it, and each one is a section below:
 *
 *   A  SIX SCHEMA FILENAMES, THREE SCHEMA CONTENTS. Five version-named copies sat
 *      beside the live schema — three byte-identical, two stale — and every one of
 *      them looked equally authoritative to anyone reading the directory. The ZIP
 *      shipped one of them by name, so the download and the directory could disagree
 *      and nothing said so.
 *
 *   B  THE PACKAGE WAS NUMBERED AFTER THE APPLICATION, and then after a schema the
 *      build no longer read. The kit now carries a contract number declared in
 *      project-builder-contract.js and nowhere else, and this suite fails when any
 *      resource states a different one.
 *
 *   C  THE CONTRACT AND THE IMPORTER DISAGREED ABOUT WHAT A DOCUMENT MAY SAY. The
 *      schema forbade `t2v` that the importer admitted; the importer invented `i2v`
 *      for a unit that named no method; and the review nagged every shot for a
 *      fallback whether or not it declared a risk to fall back from.
 *
 * The assertions are behavioural wherever a behaviour exists. The ZIP is downloaded
 * and its central directory read; the example is validated against the canonical
 * schema rather than eyeballed; the new planning fields are pushed through the real
 * import-preview route and read back out of the normalized project. Asserting that a
 * file contains a string proves an edit happened, not that the product changed.
 *
 * No provider is contacted. The server runs against a temporary projects root.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const KIT = path.join(ROOT, "resources", "project-builder");
const Contract = require("../src/project/project-builder-contract");
const contract = Contract.projectBuilderContract();
const APP_VERSION = require("../package.json").version;

const read = (name) => fs.readFileSync(path.join(KIT, name), "utf8");
const schema = JSON.parse(read(contract.schemaFile));
const example = JSON.parse(read("CINEBRAID_PROJECT_BUILDER_MINIMAL_EXAMPLE.json"));
const prompt = read("CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt");
const template = read("CINEBRAID_PROJECT_BUILDER_USER_TEMPLATE.txt");
const quick = read("QUICK_START.md");
const readme = read("README.md");

/* ===========================================================================
   A minimal JSON Schema (2020-12) validator, covering exactly the keywords the
   canonical schema uses.

   The repository has no schema library and takes one dependency in total, so the
   alternative to ~70 lines here is what this suite did before: assert the example's
   shape by hand, in prose that drifts away from the schema the model is actually
   given. A validator that reads the shipped file cannot drift from it. Every keyword
   the schema uses is implemented; an unimplemented one would silently pass, so
   `assertKeywordsCovered` below refuses to let one appear unnoticed. */
const SUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description",
  "type", "enum", "const", "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "minLength", "minimum", "maximum", "pattern",
  "allOf", "anyOf", "if", "then",
]);

function assertKeywordsCovered(node, where = "#", inMap = false) {
  if (Array.isArray(node)) return node.forEach((item, i) => assertKeywordsCovered(item, `${where}[${i}]`));
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (inMap) { assertKeywordsCovered(value, `${where}/${key}`); continue; }
    assert(SUPPORTED_KEYWORDS.has(key),
      `the canonical schema uses ${key} at ${where}, which this validator does not implement; implement it rather than letting it pass unchecked`);
    assertKeywordsCovered(value, `${where}/${key}`, key === "properties" || key === "$defs");
  }
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value === "number" ? "number" : typeof value;
}

function resolveRef(ref) {
  assert(ref.startsWith("#/"), `only local refs are supported: ${ref}`);
  return ref.slice(2).split("/").reduce((node, part) => {
    assert(node && Object.prototype.hasOwnProperty.call(node, part), `unresolvable $ref ${ref}`);
    return node[part];
  }, schema);
}

function validate(node, value, at, errors) {
  if (node === true) return;
  if (node === false) return void errors.push(`${at}: nothing is allowed here`);
  if (node.$ref) return validate(resolveRef(node.$ref), value, at, errors);

  const kind = typeOf(value);
  if (node.type) {
    const ok = node.type === kind
      || (node.type === "number" && kind === "integer")
      || (node.type === "object" && kind === "object")
      || (node.type === "array" && kind === "array");
    if (!ok) return void errors.push(`${at}: expected ${node.type}, got ${kind}`);
  }
  if (node.enum && !node.enum.some((option) => JSON.stringify(option) === JSON.stringify(value)))
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(node.enum)}`);
  if (Object.prototype.hasOwnProperty.call(node, "const") && JSON.stringify(node.const) !== JSON.stringify(value))
    errors.push(`${at}: must be ${JSON.stringify(node.const)}`);

  if (kind === "string") {
    if (node.minLength != null && value.length < node.minLength) errors.push(`${at}: shorter than ${node.minLength}`);
    if (node.pattern != null && !new RegExp(node.pattern).test(value)) errors.push(`${at}: ${JSON.stringify(value)} does not match ${node.pattern}`);
  }
  if (kind === "number" || kind === "integer") {
    if (node.minimum != null && value < node.minimum) errors.push(`${at}: below minimum ${node.minimum}`);
    if (node.maximum != null && value > node.maximum) errors.push(`${at}: above maximum ${node.maximum}`);
  }
  if (kind === "array") {
    if (node.minItems != null && value.length < node.minItems) errors.push(`${at}: needs at least ${node.minItems} items`);
    if (node.maxItems != null && value.length > node.maxItems) errors.push(`${at}: allows at most ${node.maxItems} items`);
    if (node.items) value.forEach((item, i) => validate(node.items, item, `${at}[${i}]`, errors));
  }
  if (kind === "object") {
    for (const key of node.required || [])
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${at}: missing required ${key}`);
    for (const [key, child] of Object.entries(value)) {
      const property = node.properties?.[key];
      if (property) validate(property, child, `${at}.${key}`, errors);
      else if (node.additionalProperties !== undefined && node.additionalProperties !== true)
        validate(node.additionalProperties, child, `${at}.${key}`, errors);
    }
  }

  for (const branch of node.allOf || []) validate(branch, value, at, errors);
  if (node.anyOf && !node.anyOf.some((branch) => { const local = []; validate(branch, value, at, local); return !local.length; }))
    errors.push(`${at}: matched none of the permitted forms`);
  if (node.if) {
    const local = [];
    validate(node.if, value, at, local);
    if (!local.length && node.then) validate(node.then, value, at, errors);
  }
}

function schemaErrors(document) {
  const errors = [];
  validate(schema, document, "", errors);
  return errors;
}

/* The validator must be able to fail. A validator that only ever returns [] would
   make every schema assertion below meaningless. */
assertKeywordsCovered(schema);
assert.deepStrictEqual(schemaErrors(example), [], "the shipped example must satisfy the shipped schema");
assert(schemaErrors({ ...example, meta: {} }).length, "the validator must reject a document missing meta.title");
assert(schemaErrors({ ...example, qcChecklist: "five" }).length, "the validator must reject a wrong type");

/* ===========================================================================
   A — ONE CANONICAL PACKAGE.

   The stale aliases are named individually rather than matched by pattern: this must
   fail if any one of them comes back, and it must say which. */
const STALE_SCHEMA_ALIASES = [
  "CINEBRAID_PROJECT_SCHEMA_v6.0.json",
  "CINEBRAID_PROJECT_SCHEMA_v6.1_AUDIO_AWARE.json",
  "CINEBRAID_PROJECT_SCHEMA_v6.2.2.json",
  "CINEBRAID_PROJECT_SCHEMA_v6.2.3.json",
  "CINEBRAID_PROJECT_SCHEMA_v6.3.0.json",
  "CINEBRAID_PROJECT_SCHEMA_v6.5.3.json",
];
{
  const onDisk = fs.readdirSync(KIT).sort();
  assert.deepStrictEqual(onDisk, [...contract.resources].sort(),
    "the kit directory must hold exactly the six contract resources and nothing else");

  const schemas = onDisk.filter((name) => /SCHEMA/i.test(name));
  assert.deepStrictEqual(schemas, [contract.schemaFile],
    `exactly one schema resource may exist; found ${schemas.join(", ")}`);

  for (const alias of STALE_SCHEMA_ALIASES)
    assert(!fs.existsSync(path.join(KIT, alias)),
      `${alias} is a stale schema alias and must not return; there is one schema`);

  /* And nothing in the repository points at one. A compatibility alias is only ever
     retained for a live consumer, and there is none. */
  const consumers = [
    ["server.js", fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8")],
    ["public/creation-studio.js", fs.readFileSync(path.join(ROOT, "public", "creation-studio.js"), "utf8")],
    ["project-builder-contract.js", fs.readFileSync(path.join(ROOT, "src/project/project-builder-contract.js"), "utf8")],
  ];
  for (const [file, source] of consumers)
    for (const alias of STALE_SCHEMA_ALIASES)
      assert(!source.includes(alias), `${file} still names the stale schema ${alias}`);
}

/* THE ROUTE READS THE CONTRACT rather than a list retyped beside it. A retyped list
   is exactly how the download came to name a file the directory had moved on from. */
{
  const server = fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8");
  assert(/require\("\.\.\/project\/project-builder-contract"\)/.test(server),
    "server.js must read the kit's file list from the contract module");
  const route = server.slice(server.indexOf('app.get("/api/project-builder/kit"'));
  const body = route.slice(0, route.indexOf("\napp."));
  assert(/projectBuilderContract\(\)/.test(body), "the kit route must resolve the contract");
  for (const name of contract.resources)
    assert(!body.includes(`"${name}"`), `the kit route must not retype ${name}; it must come from the contract`);
}

/* ===========================================================================
   B — ONE CONTRACT IDENTITY, STATED THE SAME WAY EVERYWHERE. */
{
  assert.strictEqual(contract.version, "1.0");
  assert.strictEqual(contract.name, "PROJECT BUILDER CONTRACT 1.0");
  assert.strictEqual(schema.$id, contract.schemaId, "the schema's $id is the contract's machine identity");
  assert(String(schema.description || "").startsWith(contract.name),
    "the schema must state the contract it belongs to in words, not only in its $id");

  for (const name of contract.proseResources)
    assert(read(name).includes(contract.name),
      `${name} must state ${contract.name}; a resource that does not is a resource that can drift`);

  /* THE PACKAGE IS NOT THE APPLICATION, and it is not a schema version either. */
  for (const name of contract.resources) {
    const text = read(name);
    assert(!text.includes(APP_VERSION),
      `${name} states the application version ${APP_VERSION}; the contract must never follow a CineBraid release`);
    const stale = text.match(/\bv6\.\d+(\.\d+)*\b/g);
    assert(!stale, `${name} still carries a package version identity (${stale && stale.join(", ")}); there is one contract number`);
  }

  /* The archive is named after the contract, and both halves come from one place. */
  assert.strictEqual(contract.archive, "CineBraid_Project_Builder_Prompt_Kit_Contract_1.0.zip");
  assert(contract.archive.includes(contract.version), "the archive name must be derived from the contract version");
}

/* ===========================================================================
   C — THE CLIP KIND CONTRACT, at the schema end.

   The importer's behaviour is proven in tests/shot-execution-tier0.js, which owns
   T0-2. What belongs here is the half that lives in the document the model is given:
   the enum it is allowed to write. The importer admitted `t2v` and the schema
   forbade it, so a valid text-to-video plan was an invalid document. */
{
  const kinds = schema.$defs.clip.properties.kind.enum;
  assert(kinds.includes("t2v"), "the schema must admit t2v; the importer already does");
  for (const kind of ["i2v", "flf", "r2v", "plan", "post", "reuse", "hold"])
    assert(kinds.includes(kind), `${kind} must remain a valid clip kind`);
  assert.strictEqual(new Set(kinds).size, kinds.length, "no kind may be listed twice");

  /* t2v must not be dragged into the start-frame requirement. The conditional
     branches name the kinds that need frames; t2v is not one of them. */
  const framed = schema.$defs.clip.allOf
    .filter((branch) => branch.then?.required?.includes("fromFrame"))
    .flatMap((branch) => {
      const constraint = branch.if.properties.kind;
      return constraint.enum || [constraint.const];
    });
  assert(!framed.includes("t2v"), "text-to-video begins from no frame and must never be required to name one");
  assert(framed.includes("i2v") && framed.includes("flf"), "the frame-driven kinds must still require their inputs");
}

/* ===========================================================================
   D — THE SCHEMA TEACHES THE THREE CURRENT RUNTIME CONCEPTS. */
{
  const shot = schema.$defs.shot.properties;
  assert.deepStrictEqual(shot.deliveryRoute.enum, ["t2v", "i2v", "flf", "r2v", "hybrid"],
    "the declared route vocabulary is the repository's own, in its own order");
  assert(!schema.$defs.shot.required.includes("deliveryRoute"),
    "a shot the source never routed must be able to say so by omission");

  assert.deepStrictEqual(shot.endpoints.properties.start.enum, ["free", "approximate", "exact"]);
  assert.deepStrictEqual(shot.endpoints.properties.end.enum, ["free", "approximate", "exact"]);
  assert(!schema.$defs.shot.required.includes("endpoints"), "endpoints are a requirement, not a formality");

  const block = schema.properties.meta.properties.styleBlocks.items;
  assert.deepStrictEqual(block.required, ["id", "name", "text"], "a style block needs an identity and a description");
  assert(block.properties.stage, "a style block must be able to name the regime it governs");
  assert(!block.required.includes("stage"), "a universal style block declares no stage");
  assert(schema.$defs.scene.properties.stage, "a scene must be able to declare which regime it is in");
  assert(!schema.$defs.scene.required.includes("stage"), "a film with one look declares no stages");
}

/* THE PROSE SAYS THE THREE THINGS THAT ARE EASIEST TO GET WRONG. These are not
   decoration: each one is a rule an external model will otherwise break, and the
   system prompt is the only place it is ever told. */
{
  assert(/only when `risks` is non-empty/i.test(prompt),
    "the system prompt must say a fallback is written only for a declared risk");
  assert(/endpoint requirement does NOT choose a generation method/i.test(prompt),
    "the system prompt must separate endpoint freedom from generation method");
  assert(/OMIT THE KEY ENTIRELY when the source does not decide/i.test(prompt),
    "the system prompt must say an undecided route is absent, not guessed");
  assert(/STATE A KIND ONLY WHEN THE SOURCE DECIDES IT/i.test(prompt),
    "the system prompt must say a clip kind is a decision, not a default");
  for (const rule of [
    /Do not invent framing size/i,
    /Do not infer camera movement from mood/i,
    /Do not infer lip sync from the presence of dialogue/i,
    /Do not set a continuity level that the source or the surrounding context has not established/i,
    /Do not silently split one supplied shot into several/i,
    /Do not name providers, models, native parameters/i,
    /leave it unknown/i,
  ])
    assert(rule.test(prompt), `the conservative inference rules must survive in the shipped prompt: ${rule}`);

  /* And the research vocabulary this slice deliberately did not ship must not have
     arrived with them. */
  for (const field of ["provenance[]", "freedom[]", "ModelAdapter", "authority receipt", "GUIDED/AUTO/ADVANCED"])
    assert(!prompt.includes(field), `${field} is out of scope for this contract and must not be taught`);

  assert(/your material/i.test(quick),
    "the quick start must describe the filmmaker's workflow, not schema machinery");
  /* The chain the filmmaker continues along after import, in order. The kit's job
     ends by handing them back to it, so the sequence has to be stated somewhere they
     will read before they import. */
  for (const stop of ["Project Bible", "references", "Blocking", "Frames", "review", "Finish"])
    assert(quick.includes(stop), `the quick start must hand the filmmaker back to ${stop}`);
  for (const stop of ["References", "Shots", "Generate", "Review"])
    assert(readme.includes(stop), `the README must name the ${stop} workflow the builder feeds`);
}

/* ===========================================================================
   E — THE EXAMPLE MODELS CONSERVATIVE OUTPUT.

   It is the only thing in the kit a model will imitate directly, so what it does
   NOT do matters as much as what it does. */
{
  assert.strictEqual(example.meta.title, "Signal Room");
  assert.strictEqual(example.qcChecklist.length, 5);
  for (const key of ["characters", "locations", "props", "vehicles", "audio", "scenes", "shots"])
    assert(Array.isArray(example[key]), `${key} must be an array`);

  const kinds = example.shots.flatMap((shot) => (shot.clips || []).map((clip) => clip.kind));
  assert(kinds.includes("t2v"), "the example must demonstrate an explicit text-to-video unit");
  assert(kinds.includes("i2v"), "and a frame-driven one, so the difference is visible");
  assert(kinds.includes("plan"), "and a planned unit whose method the source never decided");

  const stages = (example.meta.styleBlocks || []).map((block) => block.stage);
  assert(stages.length >= 2, "the example must demonstrate more than one visual regime");
  const sceneStages = example.scenes.map((scene) => scene.stage);
  for (const stage of sceneStages)
    assert(stages.includes(stage), `scene stage ${stage} must match a declared style block`);
  assert(sceneStages.length > new Set(sceneStages).size,
    "the example must demonstrate a regime the film returns to, which is the case this mechanism exists for");

  const routed = example.shots.filter((shot) => shot.deliveryRoute);
  assert.strictEqual(routed.length, 1, "exactly one example shot is routed, because exactly one source says so");
  assert.strictEqual(routed[0].deliveryRoute, "t2v");
  const withEndpoints = example.shots.filter((shot) => shot.endpoints);
  assert.strictEqual(withEndpoints.length, 1, "endpoints belong on the shot that requires them, not on every shot");
  assert.strictEqual(withEndpoints[0].endpoints.end, "exact");
  assert(!withEndpoints[0].deliveryRoute,
    "the shot with an exact ending must declare NO route — that is the whole point of the pair");

  const riskFree = example.shots.filter((shot) => !(shot.risks || []).length);
  assert(riskFree.length, "the example must contain a shot that carries no risk");
  for (const shot of riskFree)
    assert(!String(shot.safe || "").trim(),
      `${shot.id} declares no risk and must not carry an invented fallback`);
  const risky = example.shots.filter((shot) => (shot.risks || []).length);
  assert(risky.length, "and a shot that does carry risk");
  for (const shot of risky)
    assert(String(shot.safe || "").trim(), `${shot.id} declares risks and should show what a real fallback looks like`);
}

/* The referential integrity the kit has always required, kept because it is the
   thing an imported project fails on first. */
{
  const topIds = new Set();
  for (const [kind, list] of [
    ["character", example.characters], ["location", example.locations], ["prop", example.props],
    ["vehicle", example.vehicles], ["audio", example.audio], ["scene", example.scenes], ["shot", example.shots],
  ])
    for (const item of list) {
      assert.match(item.id, /^[A-Z0-9_-]+$/, `${kind} id ${item.id}`);
      assert(!topIds.has(item.id), `duplicate top-level id ${item.id}`);
      topIds.add(item.id);
    }

  const chars = new Set(example.characters.map((x) => x.id));
  const entities = new Map([...example.characters, ...example.locations, ...example.props, ...example.vehicles].map((x) => [x.id, x]));
  const audio = new Set(example.audio.map((x) => x.id));
  const scenes = new Set(example.scenes.map((x) => x.id));
  for (const entity of entities.values())
    assert.strictEqual(entity.continuityStates.filter((x) => x.isDefault === true).length, 1, `${entity.id} default state`);

  for (const shot of example.shots) {
    assert(scenes.has(shot.scene), `${shot.id} scene resolves`);
    shot.characters.forEach((id) => assert(chars.has(id), `${shot.id} character ${id}`));
    shot.codes.forEach((id) => assert(topIds.has(id), `${shot.id} code ${id}`));
    assert(shot.keyframes.length >= 1, `${shot.id} keyframe required`);
    const frames = new Set(shot.keyframes.map((x) => x.id));
    for (const [entityId, stateId] of Object.entries(shot.continuityStateSelections || {})) {
      assert(entities.has(entityId), `${shot.id} state entity ${entityId}`);
      assert(entities.get(entityId).continuityStates.some((x) => x.id === stateId), `${shot.id} state ${stateId}`);
    }
    if (shot.audio?.speakerId) assert(chars.has(shot.audio.speakerId));
    if (shot.audio?.voiceEntityId) assert(audio.has(shot.audio.voiceEntityId));
    for (const clip of shot.clips || []) {
      if (clip.fromFrame) assert(frames.has(clip.fromFrame), `${clip.id} fromFrame`);
      if (clip.toFrame) assert(frames.has(clip.toFrame), `${clip.id} toFrame`);
      if (["t2v", "plan", "post", "reuse"].includes(clip.kind))
        assert(!clip.fromFrame && !clip.toFrame, `${clip.id} begins from no frame and must not name one`);
      if (clip.kind === "flf") assert(clip.fromFrame && clip.toFrame, `${clip.id} FLF frames`);
      if (clip.kind === "r2v") assert(clip.dur >= 4 && clip.dur <= 15, `${clip.id} R2V duration`);
      if (clip.speakerId) assert(chars.has(clip.speakerId));
      if (clip.voiceEntityId) assert(audio.has(clip.voiceEntityId));
      if (clip.motionBrief?.dialogue?.line) {
        assert.strictEqual(clip.motionBrief.dialogue.line, clip.line, `${clip.id} motion dialogue matches the legacy line`);
        assert(chars.has(clip.motionBrief.dialogue.speakerId), `${clip.id} motion speaker resolves`);
        assert.strictEqual(clip.motionBrief.dialogue.locked, true, `${clip.id} dialogue locked`);
      }
    }
  }
}

/* NO RUNTIME OR AUTHORITY FABRICATION, anywhere in the example. */
{
  const forbidden = new Set([
    "mediaAssets", "finishJobs", "jobs", "decisions", "sessions", "agentRuns", "candidateFiles",
    "promptBuilds", "imagePromptPackages", "generationPackages", "approvedFile", "winner",
    "stageApprovals", "referenceInstructions", "referenceRoles", "referenceSelection",
    "creationBrief", "composition", "productionAuthority", "approvalIdentity", "receipts",
  ]);
  (function walk(value, at = "") {
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${at}[${i}]`));
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert(!forbidden.has(key), `runtime key ${at ? at + "." : ""}${key}`);
      walk(child, at ? `${at}.${key}` : key);
    }
  })(example);
}

/* ===========================================================================
   The live server. Everything above reads files; everything below drives the
   shipped routes, because a contract that is right on disk and wrong in the
   download is still wrong. */
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-kit-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
fs.mkdirSync(path.join(PROJECTS_ROOT, "kit-project"), { recursive: true });
fs.writeFileSync(
  path.join(PROJECTS_ROOT, "kit-project", "project.json"),
  JSON.stringify({
    meta: { title: "Kit Project", format: "Test" },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [],
    mediaAssets: [], scenes: [], shots: [],
  }),
);

let child = null, base = "", output = "";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base + "/api/me")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Server did not start. Output:\n${output}`);
}

/* ZIP entry names, read out of the central directory rather than guessed from the
   request. A download that claims six files and ships five is the failure this is
   looking for. */
function zipEntryNames(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert(end >= 0, "the kit download is not a ZIP archive");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.strictEqual(buffer.readUInt32LE(offset), 0x02014b50, "malformed ZIP central directory");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/* One import through the real route, and the normalized project it produced. */
async function preview(document) {
  const response = await fetch(base + "/api/projects/preview-import-json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: document }),
  });
  const body = await response.json();
  assert.strictEqual(response.status, 200, `import preview failed: ${JSON.stringify(body)}`);
  return body;
}

/* The example, with the one field a caller wants changed. Building each case from
   the shipped example rather than from a hand-written stub means a case cannot pass
   against a document the contract would reject. */
function documentWith(mutate) {
  const copy = JSON.parse(JSON.stringify(example));
  mutate(copy);
  return copy;
}

async function main() {
  const port = await getFreePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT, CINEBRAID_CONFIG_PATH: path.join(TEMP, "config.json") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  await waitForServer();

  /* --- the download is the package ------------------------------------- */
  {
    const response = await fetch(base + "/api/project-builder/kit");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get("content-disposition"),
      `attachment; filename="${contract.archive}"`,
      "the download must be named after the contract it contains",
    );
    const names = zipEntryNames(Buffer.from(await response.arrayBuffer()));
    assert.deepStrictEqual([...names].sort(), [...contract.resources].sort(),
      "the ZIP must ship exactly the canonical resources");
    for (const alias of STALE_SCHEMA_ALIASES)
      assert(!names.includes(alias), `the ZIP still ships the stale alias ${alias}`);

    const promptResponse = await fetch(base + "/api/project-builder/system-prompt");
    assert.strictEqual(promptResponse.status, 200);
    const served = await promptResponse.text();
    assert(served.includes(contract.name), "the served system prompt must state the contract");
    assert(!served.includes(APP_VERSION), "the served system prompt must not state the application version");
  }

  /* --- C: `safe` follows the risk it answers ---------------------------- */
  {
    const FALLBACK = /add a simpler fallback/i;

    /* A shot with no risk and no fallback is COMPLETE. This is the correction:
       the old rule raised an item on every such shot, and the only way to clear
       it was to invent a second creative plan for a problem nobody had found. */
    const clean = await preview(documentWith((doc) => {
      for (const shot of doc.shots) { shot.risks = []; delete shot.safe; }
    }));
    assert(!clean.review.review.some((row) => FALLBACK.test(row)),
      `a risk-free shot must not be asked for a fallback: ${JSON.stringify(clean.review.review)}`);

    /* A shot that names a risk and offers no way out still is. */
    const exposed = await preview(documentWith((doc) => {
      for (const shot of doc.shots) { shot.risks = ["Identity drift under strong directional light"]; delete shot.safe; }
    }));
    const raised = exposed.review.review.filter((row) => FALLBACK.test(row));
    assert.strictEqual(raised.length, example.shots.length,
      `every risky shot with no fallback must be named: ${JSON.stringify(exposed.review.review)}`);
    for (const shot of example.shots)
      assert(raised.some((row) => row.includes(shot.id)), `${shot.id} declares a risk and no fallback, and must be raised`);

    /* And a shot that names both is finished. */
    const answered = await preview(documentWith((doc) => {
      for (const shot of doc.shots) {
        shot.risks = ["Identity drift under strong directional light"];
        shot.safe = "Hold the frame and let the light change without performer movement.";
      }
    }));
    assert(!answered.review.review.some((row) => FALLBACK.test(row)),
      "a declared risk with a supported fallback needs no review item");

    /* SEVERITY IS UNCHANGED. A missing fallback was never blocking and still is not:
       it is a review note, and it must not have migrated into `missing`. */
    for (const outcome of [exposed, clean, answered])
      assert(!outcome.review.missing.some((row) => FALLBACK.test(row)),
        "the fallback prompt is a review item, not a readiness gate");
  }

  /* --- D: the three planning concepts survive the importer -------------- */
  {
    const imported = await preview(example);
    const project = imported.normalizedProject;

    assert.deepStrictEqual(
      project.meta.styleBlocks,
      example.meta.styleBlocks,
      "authored visual regimes must arrive exactly as written",
    );
    const stages = Object.fromEntries(project.scenes.map((scene) => [scene.id, scene.stage]));
    for (const scene of example.scenes)
      assert.strictEqual(stages[scene.id], scene.stage, `scene ${scene.id} must keep its declared regime`);

    const shots = Object.fromEntries(project.shots.map((shot) => [shot.id, shot]));
    for (const source of example.shots) {
      const arrived = shots[source.id];
      assert(arrived, `shot ${source.id} must survive import`);
      if (source.deliveryRoute)
        assert.strictEqual(arrived.deliveryRoute, source.deliveryRoute, `${source.id} declared route must survive`);
      else
        assert(!arrived.deliveryRoute, `${source.id} declared no route and must not acquire one`);
      assert.deepStrictEqual(arrived.endpoints, source.endpoints,
        `${source.id} endpoint requirements must survive unchanged`);
    }

    /* AND NOTHING WAS INVENTED ALONG THE WAY. The example's `plan` unit named no
       frame and must still name none, and the routed shot must not have been given
       endpoints it never declared. */
    const planned = shots["S01-01"].clips[0];
    assert.strictEqual(planned.kind, "plan", "an explicitly planned unit stays planned");
    assert.strictEqual(planned.fromFrame, "", "and is not handed a frame it does not use");
    assert.strictEqual(shots["S01-02"].clips[0].kind, "t2v", "an explicit t2v unit survives the real import path");
    assert.strictEqual(shots["S01-02"].clips[0].fromFrame, "", "and is not linked to a starting frame");

    /* An unrecognised route is discarded by name rather than rounded to a
       neighbour, and the shot arrives declaring nothing. */
    const bogus = await preview(documentWith((doc) => { doc.shots[0].deliveryRoute = "teleport"; }));
    const arrived = bogus.normalizedProject.shots.find((shot) => shot.id === "S01-01");
    assert(!arrived.deliveryRoute, "an unrecognised route must not become the nearest valid one");
    assert(bogus.review.review.some((row) => /teleport/.test(row)) || bogus.review.removed.some((row) => /teleport/.test(row)),
      `an unrecognised route must be reported by name: ${JSON.stringify(bogus.review.review)}`);
  }

  /* --- B: an omitted clip kind is never silently i2v, end to end -------- */
  {
    const omitted = await preview(documentWith((doc) => {
      const shot = doc.shots.find((row) => row.id === "S01-02");
      delete shot.clips[0].kind;
    }));
    const unit = omitted.normalizedProject.shots.find((shot) => shot.id === "S01-02").clips[0];
    assert.notStrictEqual(unit.kind, "i2v", "an omitted kind must never come back as image-to-video");
    assert.strictEqual(unit.kind, "plan", "it becomes planning-only, which generates nothing");
    assert.strictEqual(unit.fromFrame, "", "and is not handed a start frame on the way");
    assert(omitted.review.review.some((row) => /named no generation method/i.test(row)),
      `the filmmaker must be told: ${JSON.stringify(omitted.review.review)}`);
  }

  child.kill();
  console.log(`Project Builder Prompt Kit — ${contract.name} — validation passed.`);
}

main().catch((error) => {
  if (child) child.kill();
  console.error(error);
  process.exit(1);
});
