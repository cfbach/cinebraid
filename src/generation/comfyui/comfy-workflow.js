/* ComfyUI workflow inspection, mapping and change detection — pure.
 *
 * A ComfyUI workflow is not a CineBraid concept and never becomes one. What CineBraid
 * needs from a graph is small and stable:
 *
 *     is this file executable at all?
 *     which node input does "Positive Prompt" land on?
 *     did the file change under a mapping that was already confirmed?
 *
 * Everything else — node classes, link tables, widget ordering, the sampler's name —
 * stays here and in comfy-client.js. `generation-contracts.js`'s FORBIDDEN_INTENT_KEYS
 * already refuses `class_type`, `nodeid`, `workflow` and `bindings` inside production
 * intent, so this module's vocabulary is one the shot is structurally unable to learn.
 *
 * NO I/O. No filesystem, no network, no config. Callers hand in bytes or a parsed
 * document; this module reads them and answers. That is what lets format truth,
 * suggestion and invalidation be tested without a ComfyUI anywhere.
 *
 * ------------------------------------------------------------------------------
 * TWO FORMATS, AND ONLY ONE OF THEM RUNS.
 *
 * ComfyUI saves two different JSON documents and they are not interchangeable:
 *
 *   API format    { "<nodeId>": { class_type, inputs, _meta? }, ... }
 *                 This is what POST /prompt accepts. Every input is named.
 *
 *   UI format     { last_node_id, last_link_id, nodes: [...], links: [...], ... }
 *                 This is the editor's document. Node inputs are a POSITIONAL
 *                 `widgets_values` array whose meaning is only recoverable from the
 *                 running server's /object_info — and even then the order is shifted
 *                 by hidden control widgets. Converting it faithfully is a compiler
 *                 against a live server's node registry, not a transformation of the
 *                 file.
 *
 * V1 therefore executes API format and says so. A UI-format file is reported as
 * recognised-but-not-executable with the exact action that fixes it, because the
 * alternative — guessing widget positions — is how a mapping binds to the wrong input
 * and the filmmaker finds out from the picture.
 */

const crypto = require("crypto");

/* ---------------------------------------------------------------------------
   The semantic vocabulary.

   These are PRODUCTION inputs — things a filmmaker can name about a shot — not
   ComfyUI widgets. The test that keeps this list honest is whether a second backend
   could carry the same word: every entry below already exists in CineBraid's own
   reference-role vocabulary (public/shared-generation-capability.js) or in the
   generation job's own settings. Nothing here is "the CFG slider". */
const COMFY_SEMANTIC_INPUTS = [
  {
    key: "positivePrompt",
    label: "Positive Prompt",
    valueKind: "text",
    /* The one binding a graph cannot run without in V1: a text-to-image workflow with
       no prompt input is a fixed picture, not a shot. */
    required: true,
    referenceRole: null,
  },
  { key: "negativePrompt", label: "Negative Prompt", valueKind: "text", required: false, referenceRole: null },
  { key: "startImage", label: "Start Image", valueKind: "image", required: false, referenceRole: "first-frame" },
  { key: "endImage", label: "End Image", valueKind: "image", required: false, referenceRole: "last-frame" },
  /* Singular in V1, deliberately. A second and third reference slot is a real product
     need and a trivial addition to this list; what it is NOT is free — each slot has to
     be selectable, mappable, invalidatable and provable, and shipping one slot that
     works beats shipping four that are only tested empty. IMPLEMENTATION_NOTES records
     this as the deferred item it is. */
  { key: "referenceImage", label: "Reference Image", valueKind: "image", required: false, referenceRole: "reference" },
  { key: "seed", label: "Seed", valueKind: "number", required: false, referenceRole: null },
];
const COMFY_SEMANTIC_KEYS = COMFY_SEMANTIC_INPUTS.map((entry) => entry.key);
const COMFY_SEMANTIC_BY_KEY = new Map(COMFY_SEMANTIC_INPUTS.map((entry) => [entry.key, entry]));
const COMFY_IMAGE_SEMANTIC_KEYS = COMFY_SEMANTIC_INPUTS.filter((e) => e.valueKind === "image").map((e) => e.key);

const COMFY_MAPPING_VERSION = 1;

/* Node classes that write a retrievable artifact. Used for a WARNING, never for a
   refusal: ComfyUI's node registry is open and a custom pack can name its saver
   anything. A graph with no recognised output node is still allowed to run — and if it
   genuinely produces nothing, the run fails saying so, which is a true statement
   instead of a guess made before dispatch. */
const COMFY_KNOWN_OUTPUT_CLASSES = [
  "SaveImage", "PreviewImage", "SaveAnimatedWEBP", "SaveAnimatedPNG", "SaveImageWebsocket",
  "SaveVideo", "SaveWEBM", "VHS_VideoCombine", "SaveAudio", "SaveAudioMP3", "SaveAudioOpus",
];

/* Which node classes plausibly hold each semantic input, and under which input name.
   A SUGGESTION TABLE, never a binding table. Confirmation is the user's and this file
   cannot perform it — see mappingFromRequest(). */
const COMFY_SUGGESTION_RULES = [
  { key: "positivePrompt", classes: ["CLIPTextEncode", "CLIPTextEncodeSDXL", "CLIPTextEncodeFlux", "T5TextEncode", "TextEncodeQwenImageEdit"], inputs: ["text", "text_g", "prompt"] },
  { key: "negativePrompt", classes: ["CLIPTextEncode", "CLIPTextEncodeSDXL", "CLIPTextEncodeFlux", "T5TextEncode"], inputs: ["text", "text_g", "prompt"] },
  { key: "startImage", classes: ["LoadImage", "LoadImageOutput", "ETN_LoadImageBase64"], inputs: ["image"] },
  { key: "endImage", classes: ["LoadImage", "LoadImageOutput", "ETN_LoadImageBase64"], inputs: ["image"] },
  { key: "referenceImage", classes: ["LoadImage", "LoadImageOutput", "ETN_LoadImageBase64"], inputs: ["image"] },
  { key: "seed", classes: ["KSampler", "KSamplerAdvanced", "RandomNoise", "SamplerCustom", "SamplerCustomAdvanced"], inputs: ["seed", "noise_seed"] },
];

/* Words that, in a node's own title, say which of two identical CLIPTextEncode nodes is
   which. Titles are the only signal ComfyUI itself gives a human, so they are the only
   signal used to rank — and a rank is still a suggestion. */
const COMFY_TITLE_HINTS = {
  positivePrompt: [/\bpositive\b/i, /\bprompt\b/i, /\bsubject\b/i],
  negativePrompt: [/\bnegative\b/i, /\bneg\b/i, /\bexclude\b/i],
  startImage: [/\bstart\b/i, /\bfirst\b/i, /\binput\b/i, /\bsource\b/i],
  endImage: [/\bend\b/i, /\blast\b/i, /\bfinal\b/i],
  referenceImage: [/\breference\b/i, /\bref\b/i, /\bstyle\b/i, /\bguide\b/i],
  seed: [/\bseed\b/i],
};

/* Titles that RULE A NODE OUT for a semantic input.
 *
 * Without these the two CLIPTextEncode nodes of an ordinary text-to-image graph are
 * indistinguishable: "Negative Prompt" matches the positive hint /\bprompt\b/ and
 * scores exactly as high as "Positive Prompt", so the editor pre-fills a coin flip and
 * the filmmaker's negative prompt becomes their subject. A node the author has
 * explicitly named as the other thing is not a weaker candidate for this thing — it is
 * not a candidate — so it is dropped from the list rather than ranked below.
 *
 * Dropping it costs nothing: the mapping editor offers every literal input in the
 * graph, so an author with unusual names still picks whatever they meant. What is
 * removed is only CineBraid's PROPOSAL, which is the thing that must not be confidently
 * wrong. */
const COMFY_TITLE_ANTIHINTS = {
  positivePrompt: [/\bnegative\b/i, /\bneg\b/i],
  negativePrompt: [/\bpositive\b/i],
  startImage: [/\bend\b/i, /\blast\b/i, /\breference\b/i],
  endImage: [/\bstart\b/i, /\bfirst\b/i, /\breference\b/i],
  referenceImage: [/\bstart\b/i, /\bend\b/i, /\bfirst\b/i, /\blast\b/i],
  seed: [],
};

class ComfyWorkflowError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "ComfyWorkflowError";
    this.code = code;
    this.detail = detail;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/* ---------------------------------------------------------------------------
   Identity.

   SHA-256 over the RAW BYTES, not over a re-serialised parse. Two documents that
   differ only in key order or whitespace are different files, and a filmmaker who
   re-saved a workflow has changed it as far as this product is concerned — saying so
   and revalidating costs one screen, while silently treating it as unchanged is how a
   stale binding survives an edit. */
function workflowContentHash(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

/* ---------------------------------------------------------------------------
   Format truth.

   Returns one of:
     api          executable by the V1 path
     ui           a real ComfyUI workflow, but the editor's document
     unknown      parses as JSON and is neither
     unparseable  not JSON at all

   The API test is structural and total: EVERY top-level value must be a record with a
   non-empty string `class_type` and a record `inputs`. "Most of them look right" is not
   a format — a document that is half API and half something else is `unknown`, because
   dispatching the half that parses is exactly the behaviour that produces a picture
   nobody asked for. */
function detectWorkflowFormat(source) {
  let document = source;
  if (typeof source === "string" || Buffer.isBuffer(source)) {
    try {
      document = JSON.parse(Buffer.isBuffer(source) ? source.toString("utf8") : source);
    } catch (error) {
      return { format: "unparseable", nodeCount: 0, reason: `The file is not valid JSON (${error.message}).` };
    }
  }
  if (!isRecord(document))
    return { format: "unknown", nodeCount: 0, reason: "A ComfyUI workflow is a JSON object; this file holds something else." };

  /* UI/editor format is checked FIRST because it is unambiguous and because its
     diagnosis is the useful one: a filmmaker with a UI-format file needs a specific
     instruction, not "unrecognised". */
  if (Array.isArray(document.nodes))
    return {
      format: "ui",
      nodeCount: document.nodes.length,
      reason: "This is the ComfyUI editor's own workflow file. CineBraid runs the API version of a workflow.",
      action: "In ComfyUI, open this workflow and choose Workflow → Export (API). Save the exported file into your CineBraid workflow folder.",
    };

  const keys = Object.keys(document);
  if (!keys.length)
    return { format: "unknown", nodeCount: 0, reason: "The file holds an empty object — there are no nodes to run." };

  const nonNodes = keys.filter((key) => {
    const node = document[key];
    return !isRecord(node) || !text(node.class_type) || !isRecord(node.inputs);
  });
  if (!nonNodes.length) return { format: "api", nodeCount: keys.length, reason: "" };

  /* Named, and capped, so the reason stays a sentence a person reads rather than a
     dump of the document. */
  return {
    format: "unknown",
    nodeCount: 0,
    reason: nonNodes.length === keys.length
      ? "The file is JSON, but nothing in it looks like a ComfyUI node."
      : `${nonNodes.length} of ${keys.length} entries are not ComfyUI nodes (${nonNodes.slice(0, 3).join(", ")}${nonNodes.length > 3 ? ", …" : ""}).`,
  };
}

function parseApiWorkflow(source) {
  const detected = detectWorkflowFormat(source);
  if (detected.format !== "api")
    throw new ComfyWorkflowError(
      "COMFY_WORKFLOW_NOT_EXECUTABLE",
      detected.reason || "This workflow is not in the API format CineBraid can run.",
      { format: detected.format, action: detected.action || "" },
    );
  return typeof source === "string" || Buffer.isBuffer(source)
    ? JSON.parse(Buffer.isBuffer(source) ? source.toString("utf8") : source)
    : source;
}

/* ---------------------------------------------------------------------------
   Inspection.

   The one projection of a graph any other module is allowed to see. A ComfyUI input is
   either a LITERAL (a string, number or boolean a caller may set) or a LINK — the
   two-element `[originNodeId, originSlot]` array that wires one node's output into
   another's input. Only literals are bindable: writing a value over a link would
   silently disconnect the graph, and a mapping that can quietly rewire a workflow is
   worse than one that refuses. */
function inspectWorkflow(source) {
  const graph = parseApiWorkflow(source);
  const nodes = Object.keys(graph).map((nodeId) => {
    const node = graph[nodeId];
    const meta = isRecord(node._meta) ? node._meta : {};
    const inputs = Object.keys(node.inputs).map((name) => {
      const value = node.inputs[name];
      const linked = Array.isArray(value) && value.length === 2;
      return {
        name,
        linked,
        valueType: linked ? "link" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
        /* The current value is shown so a mapping editor can say "this is what the
           workflow does today" — truncated, because a prompt can be thousands of
           characters and this is a label, not the payload. */
        preview: linked ? "" : previewValue(value),
      };
    });
    return {
      nodeId: String(nodeId),
      classType: text(node.class_type),
      title: text(meta.title),
      inputs,
    };
  });
  nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId, "en", { numeric: true }));
  const outputNodes = nodes.filter((node) => COMFY_KNOWN_OUTPUT_CLASSES.includes(node.classType)).map((node) => node.nodeId);
  return { nodes, nodeCount: nodes.length, outputNodes };
}

function previewValue(value) {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}

/* ---------------------------------------------------------------------------
   Suggestion.

   CineBraid may PROPOSE a binding. It may never record one.

   The returned rows are scored and ranked so the likeliest lands first in a picker, and
   every row says which evidence produced it — class, title or input name — because
   "CineBraid thinks this is your negative prompt because the node is titled Negative"
   is a claim a filmmaker can check, and a bare pre-filled dropdown is not.

   NOTHING HERE WRITES. mappingFromRequest() is the only producer of a binding, and it
   requires an explicit confirmation stamp. A suggestion has no storage at all, which is
   what makes "a suggestion silently became a confirmation" structurally impossible
   rather than merely discouraged. */
function suggestMappings(inspection) {
  const nodes = Array.isArray(inspection?.nodes) ? inspection.nodes : inspectWorkflow(inspection).nodes;
  const suggestions = {};
  for (const rule of COMFY_SUGGESTION_RULES) {
    const semantic = COMFY_SEMANTIC_BY_KEY.get(rule.key);
    const hints = COMFY_TITLE_HINTS[rule.key] || [];
    const antihints = COMFY_TITLE_ANTIHINTS[rule.key] || [];
    const rows = [];
    for (const node of nodes) {
      if (node.title && antihints.some((pattern) => pattern.test(node.title))) continue;
      const classMatch = rule.classes.includes(node.classType);
      for (const input of node.inputs) {
        if (input.linked) continue;
        if (!rule.inputs.includes(input.name)) continue;
        if (!valueKindAccepts(semantic.valueKind, input.valueType)) continue;
        const titleHit = hints.some((pattern) => pattern.test(node.title));
        /* Only a title can distinguish two structurally identical nodes, so it
           outweighs a class match — but a title match alone, on a node of the wrong
           class, is still worth offering below the class matches. */
        const score = (classMatch ? 2 : 0) + (titleHit ? 3 : 0);
        if (!score) continue;
        rows.push({
          nodeId: node.nodeId,
          input: input.name,
          classType: node.classType,
          title: node.title,
          preview: input.preview,
          score,
          because: [classMatch ? `node type ${node.classType}` : "", titleHit ? `node title "${node.title}"` : ""].filter(Boolean).join(" and "),
        });
      }
    }
    rows.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId, "en", { numeric: true }));
    if (rows.length) suggestions[rule.key] = rows;
  }
  /* A negative prompt suggested on the SAME (node,input) as the positive prompt is not
     a suggestion, it is a collision — two different prompts cannot share one input.
     Dropped here rather than left for the user to notice. */
  const positive = suggestions.positivePrompt && suggestions.positivePrompt[0];
  if (positive && suggestions.negativePrompt)
    suggestions.negativePrompt = suggestions.negativePrompt.filter(
      (row) => !(row.nodeId === positive.nodeId && row.input === positive.input),
    );
  return suggestions;
}

function valueKindAccepts(valueKind, valueType) {
  if (valueKind === "text") return valueType === "string";
  if (valueKind === "number") return valueType === "number";
  /* An image lands on ComfyUI's LoadImage.image, which is a FILENAME string in the
     server's input folder — never bytes and never a path. comfy-client.js uploads the
     bytes and this binding carries the name the server gave back. */
  if (valueKind === "image") return valueType === "string";
  return false;
}

/* ---------------------------------------------------------------------------
   Confirmation.

   The single producer of a stored binding. Every binding it mints carries
   `confirmedAt`, and validateMapping() refuses one that does not — so a record written
   by any other route, or copied out of suggestMappings(), fails a real guard rather
   than being trusted because it arrived in the right shape. */
function mappingFromRequest(request, inspection, confirmedAt) {
  const stamp = text(confirmedAt);
  if (!stamp)
    throw new ComfyWorkflowError("COMFY_MAPPING_UNCONFIRMED", "A workflow mapping is only saved when someone confirms it.");
  const rows = isRecord(request) ? request : {};
  /* The graph the filmmaker is confirming against, indexed once. inspectWorkflow() is
     accepted here as either an inspection or a raw document, exactly as validateMapping()
     accepts it, so the writer and the validator read the same shape. */
  const inspected = Array.isArray(inspection?.nodes) ? inspection : inspectWorkflow(inspection);
  const nodes = new Map(inspected.nodes.map((node) => [node.nodeId, node]));
  const bindings = {};
  for (const key of COMFY_SEMANTIC_KEYS) {
    const row = rows[key];
    if (!isRecord(row)) continue;
    const nodeId = text(row.nodeId);
    const input = text(row.input);
    /* A cleared slot is an absent binding, not a binding to nothing. */
    if (!nodeId && !input) continue;
    if (!nodeId || !input)
      throw new ComfyWorkflowError(
        "COMFY_MAPPING_INCOMPLETE",
        `${COMFY_SEMANTIC_BY_KEY.get(key).label} needs both a node and an input, or neither.`,
        { key },
      );
    /* THE NODE CLASS IS PART OF WHAT WAS CONFIRMED, and it is read from the GRAPH rather
       than taken from the caller. A confirmation certifies two things — that this input
       carries this production value, and that the node carrying it is the kind of node
       the filmmaker was looking at. Persisting only the id and the input name makes the
       second half unprovable: a later graph can keep node 6 and turn it from a
       CLIPTextEncode into a PrimitiveString, and a validator with nothing to compare
       against has no way to notice.

       Derived here, never accepted from the request. A client that could name the class
       could certify a compatibility nobody checked, which is the same defect with an
       extra step. An unknown node id is left without one and validateMapping() refuses it
       on the next line as a missing node. */
    const node = nodes.get(nodeId);
    bindings[key] = { nodeId, input, classType: node ? node.classType : "", confirmedAt: stamp };
  }
  const mapping = { mappingVersion: COMFY_MAPPING_VERSION, bindings, confirmedAt: stamp };
  const validated = validateMapping(mapping, inspection);
  if (!validated.ok)
    throw new ComfyWorkflowError(
      "COMFY_MAPPING_INVALID",
      validated.problems[0]?.message || "This mapping does not fit the workflow.",
      { problems: validated.problems },
    );
  return mapping;
}

/* ---------------------------------------------------------------------------
   Validation and change detection — the same function.

   Revalidating a saved mapping against a CHANGED workflow is not a different question
   from validating a new one against the current workflow: both ask "does every
   confirmed binding still name a real, literal, type-compatible input?" Writing it once
   is what stops the two answers from drifting apart, which is the drift that lets a
   stale binding pass on one path and fail on the other.

   A binding is KEPT when its node still exists, still has the same class, still exposes
   that input, and that input is still a settable literal of a compatible type. Anything
   else is BROKEN and named. Nothing is ever silently re-pointed at a different node —
   a graph where the CLIPTextEncode moved from node 6 to node 9 is a graph where
   CineBraid genuinely does not know which text the director meant. */
function validateMapping(mapping, inspection) {
  const problems = [];
  const bindings = isRecord(mapping?.bindings) ? mapping.bindings : {};
  const nodes = Array.isArray(inspection?.nodes) ? inspection.nodes : inspectWorkflow(inspection).nodes;
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));

  if (Number(mapping?.mappingVersion) !== COMFY_MAPPING_VERSION)
    problems.push({ key: "", code: "mapping-version", message: `This mapping was written by a different version of CineBraid (${mapping?.mappingVersion ?? "none"}).`, action: "Open the workflow and confirm its inputs again." });

  const kept = {};
  const broken = [];
  for (const key of Object.keys(bindings)) {
    if (!COMFY_SEMANTIC_BY_KEY.has(key)) {
      problems.push({ key, code: "unknown-input", message: `"${key}" is not a CineBraid production input.`, action: "Remove it and confirm the mapping again." });
      continue;
    }
    const semantic = COMFY_SEMANTIC_BY_KEY.get(key);
    const binding = bindings[key];
    const fail = (code, message, action) => {
      problems.push({ key, code, message, action });
      broken.push({ key, code, label: semantic.label, nodeId: text(binding?.nodeId), input: text(binding?.input) });
    };
    if (!isRecord(binding) || !text(binding.nodeId) || !text(binding.input)) {
      fail("incomplete", `${semantic.label} does not name a node and an input.`, "Confirm this input again.");
      continue;
    }
    /* THE CONFIRMATION GATE. A binding with no confirmation stamp never runs, whatever
       else is true of it. This is the guard the "a suggestion became a confirmation"
       negative control has to defeat. */
    if (!text(binding.confirmedAt)) {
      fail("unconfirmed", `${semantic.label} was never confirmed by anyone.`, "Open the workflow's inputs and confirm this mapping.");
      continue;
    }
    const node = byId.get(text(binding.nodeId));
    if (!node) {
      fail("missing-node", `${semantic.label} pointed at node ${binding.nodeId}, which is no longer in this workflow.`, "Choose the node that carries this input now.");
      continue;
    }
    /* THE CLASS MUST BE PRESENT, AND IT MUST STILL MATCH.
     *
     * A confirmation with no recorded class cannot prove what was confirmed, so it is not
     * treated as confirmed. That is the safe direction and the only honest one: the
     * alternative — assuming the class is whatever the node is today — would certify a
     * compatibility nobody ever checked, and would do it silently at exactly the moment
     * the node had been replaced. Nothing here invents a historical class; it asks for
     * the mapping to be confirmed again against the graph as it now stands. */
    if (!text(binding.classType)) {
      fail(
        "class-unconfirmed",
        `${semantic.label} was confirmed before CineBraid recorded which kind of node it pointed at, so that agreement cannot be checked against this workflow.`,
        "Confirm this input again.",
      );
      continue;
    }
    if (text(binding.classType) !== node.classType) {
      fail("class-changed", `${semantic.label} pointed at a ${binding.classType} node; node ${node.nodeId} is now a ${node.classType}.`, "Confirm which node carries this input now.");
      continue;
    }
    const input = node.inputs.find((row) => row.name === text(binding.input));
    if (!input) {
      fail("missing-input", `Node ${node.nodeId} (${node.classType}) no longer has an input called "${binding.input}".`, "Choose the input that carries this now.");
      continue;
    }
    if (input.linked) {
      fail("input-is-linked", `Node ${node.nodeId}'s "${input.name}" is now driven by another node, so CineBraid cannot set it.`, "Disconnect it in ComfyUI, or map this to a different input.");
      continue;
    }
    if (!valueKindAccepts(semantic.valueKind, input.valueType)) {
      fail("type-changed", `${semantic.label} needs ${semantic.valueKind === "number" ? "a number" : "text"}; node ${node.nodeId}'s "${input.name}" now holds ${input.valueType === "null" ? "nothing" : `a ${input.valueType}`}.`, "Choose an input of the right kind.");
      continue;
    }
    kept[key] = { nodeId: node.nodeId, input: input.name, confirmedAt: text(binding.confirmedAt), classType: node.classType };
  }

  for (const semantic of COMFY_SEMANTIC_INPUTS)
    if (semantic.required && !kept[semantic.key] && !broken.some((row) => row.key === semantic.key))
      problems.push({ key: semantic.key, code: "required-missing", message: `${semantic.label} is not mapped, so CineBraid has nowhere to put the shot's prompt.`, action: `Map ${semantic.label} to the node that holds it.` });

  return { ok: problems.length === 0, problems, kept, broken, modes: modesFor(kept) };
}

/* What a mapped graph can be asked to do. Derived from the CONFIRMED bindings and from
   nothing else — not from the workflow's filename, not from the checkpoint it loads,
   and not from a model name. A graph with a start image can edit; one with only a
   prompt can only make a picture from text. */
function modesFor(kept) {
  const modes = [];
  const hasImage = COMFY_IMAGE_SEMANTIC_KEYS.some((key) => kept[key]);
  if (kept.positivePrompt && !hasImage) modes.push("t2i");
  if (kept.positivePrompt && kept.startImage) modes.push("edit");
  if (kept.positivePrompt && kept.referenceImage && !kept.startImage) modes.push("multi-reference");
  return modes;
}

/* ---------------------------------------------------------------------------
   The execution snapshot.

   Builds the exact graph that will be POSTed, from three inputs and nothing else: the
   registered workflow's bytes, the confirmed mapping, and CineBraid's own values.

   IT NEVER TOUCHES THE FILE ON DISK. The caller's document is deep-copied before a
   single value is set, so a dispatch cannot be the reason a filmmaker's workflow
   changed — the whole point of registering a file rather than owning it.

   IT REFUSES A BROKEN MAPPING. `validateMapping` runs against the graph being
   dispatched, not against whatever was true when the mapping was saved, so a workflow
   edited between confirmation and Generate is caught here even if nothing rescanned the
   folder in between. */
function buildDispatchGraph(source, mapping, values = {}) {
  const graph = parseApiWorkflow(source);
  const inspection = inspectWorkflow(graph);
  const validated = validateMapping(mapping, inspection);
  if (!validated.ok)
    throw new ComfyWorkflowError(
      "COMFY_MAPPING_BROKEN",
      validated.problems[0]?.message || "This workflow's inputs need to be confirmed again before it can run.",
      { problems: validated.problems, broken: validated.broken },
    );

  const snapshot = JSON.parse(JSON.stringify(graph));
  const applied = [];
  const skipped = [];
  for (const key of COMFY_SEMANTIC_KEYS) {
    const binding = validated.kept[key];
    if (!binding) continue;
    const semantic = COMFY_SEMANTIC_BY_KEY.get(key);
    const value = values[key];
    if (value === undefined || value === null || value === "") {
      /* An unsupplied optional input keeps whatever the workflow already had. Saying so
         is the point: a filmmaker who left Negative Prompt empty is running the
         author's negative prompt, not an empty one, and the provenance has to record
         which of those happened. */
      skipped.push({ key, nodeId: binding.nodeId, input: binding.input, keptWorkflowValue: true });
      continue;
    }
    const coerced = semantic.valueKind === "number" ? Number(value) : String(value);
    if (semantic.valueKind === "number" && !Number.isFinite(coerced))
      throw new ComfyWorkflowError("COMFY_INPUT_INVALID", `${semantic.label} must be a number.`, { key, value });
    snapshot[binding.nodeId].inputs[binding.input] = coerced;
    applied.push({ key, nodeId: binding.nodeId, input: binding.input, valueKind: semantic.valueKind });
  }
  return { graph: snapshot, applied, skipped, modes: validated.modes, outputNodes: inspection.outputNodes };
}

module.exports = {
  COMFY_SEMANTIC_INPUTS,
  COMFY_SEMANTIC_KEYS,
  COMFY_IMAGE_SEMANTIC_KEYS,
  COMFY_MAPPING_VERSION,
  COMFY_KNOWN_OUTPUT_CLASSES,
  COMFY_TITLE_ANTIHINTS,
  COMFY_TITLE_HINTS,
  ComfyWorkflowError,
  buildDispatchGraph,
  detectWorkflowFormat,
  inspectWorkflow,
  mappingFromRequest,
  suggestMappings,
  validateMapping,
  workflowContentHash,
};
