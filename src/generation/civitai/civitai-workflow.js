/* One Civitai generation request, built once and named by its own bytes.
 *
 * WHAT THIS FILE EXISTS FOR, and it is one thing:
 *
 *     THE BODY THAT WAS PRICED AND THE BODY THAT IS SENT ARE THE SAME BYTES.
 *
 * Civitai prices a request by accepting the request. `?whatif=true` and the real
 * submission are the same endpoint with the same payload; the only difference is the
 * query string. That is what makes an honest paid confirmation possible at all — the
 * quote is not for "a request like this one", it is for THIS one — and it is only true if
 * CineBraid builds the payload exactly once and hashes what it actually sends.
 *
 * So this module returns a STRING, not an object. `canonicalBody` is the literal text
 * that is POSTed for the estimate and POSTed again for the submission, and `fingerprint`
 * is its SHA-256. civitai-client.js refuses anything that is not already a string,
 * precisely so no call site can re-serialise and let JSON.stringify choose a key order a
 * second time.
 *
 * WHY THE FINGERPRINT MATTERS MORE HERE THAN ANYWHERE ELSE IN CINEBRAID. On the fal path
 * the amount comes from a rate an operator configured, so the paid identity of a request
 * is the production purchase — which shot, which build, how many images. Civitai quotes a
 * number for one exact body, and the same purchase can carry a cheap body or an expensive
 * one. paid-dispatch-permit.js's scope therefore carries this digest, and the dispatch
 * boundary recomputes it from the body it is about to send. See that module's
 * requestFingerprint note.
 *
 * PURE. No network, no filesystem, no clock, no configuration reads, and it never edits
 * its arguments. Everything variable arrives as a parameter so a test can build the same
 * request the server builds and get the same digest.
 */

const crypto = require("crypto");

/* ---------------------------------------------------------------------------
   WHAT V1 CAN ACTUALLY BUILD.

   One ecosystem, because CineBraid ships an adapter for the recipe it has read, not for
   the forty-odd workflow step types the orchestrator accepts. `engine` and `operation`
   are the SDXL image recipe's own documented values; they are recorded here as data
   rather than inlined at the call site so that adding a second ecosystem later is a row
   in this table beside a real recipe, never a branch on a model name.

   An AIR whose ecosystem is not in this table is REFUSED, and the refusal says so. That
   is a real V1 limit and it is stated rather than hidden: silently sending an SD1
   checkpoint through the SDXL recipe's parameters would produce a paid request built from
   a recipe nobody verified. */
const CIVITAI_ECOSYSTEMS = {
  sdxl: {
    ecosystem: "sdxl",
    engine: "sdcpp",
    operation: "createImage",
    label: "SDXL",
    /* The recipe's own worked example. They are the defaults a frame renders at in V1 and
       they travel INTO the request body, so they are part of what was quoted and part of
       what the permit binds. */
    defaults: { width: 1024, height: 1024, steps: 25, cfgScale: 7 },
  },
};

/* The tag CineBraid stamps on every workflow it submits.
 *
 * Civitai's workflows carry client-set `tags` that QueryWorkflows can filter by. CineBraid
 * writes its ledger row before submitting, so the only window in which paid work can exist
 * with no local record is a crash between those two acts — and this tag is what closes it:
 * the job id is recoverable from Civitai's side by asking, rather than by hoping.

   The prefix is namespaced because these tags live in the user's own Civitai account
   beside whatever else they tag workflows with. */
const CIVITAI_JOB_TAG_PREFIX = "cinebraid-job-";

function jobTag(jobId) {
  return `${CIVITAI_JOB_TAG_PREFIX}${String(jobId || "").trim()}`;
}

/* ---------------------------------------------------------------------------
   AIR.

   `urn:air:<ecosystem>:<type>:<source>:<modelId>@<versionId>` — Civitai's canonical
   identifier for a resource, and the one string that is simultaneously the request
   parameter and the durable provenance. Parsed rather than pattern-matched loosely,
   because every part of it is used: the ecosystem chooses the recipe, the version id is
   what `canGenerate` is asked about, and both ids are what provenance records.

   A malformed AIR returns null. It never returns a partly-filled object — a caller that
   received one would go on to build a request around an identifier it could not read. */
const AIR_PATTERN = /^urn:air:([a-z0-9][a-z0-9._-]*):([a-z0-9][a-z0-9._-]*):([a-z0-9][a-z0-9._-]*):(\d+)@(\d+)$/i;

function parseAir(value) {
  const match = AIR_PATTERN.exec(String(value || "").trim());
  if (!match) return null;
  return {
    air: match[0],
    ecosystem: match[1].toLowerCase(),
    type: match[2].toLowerCase(),
    source: match[3].toLowerCase(),
    modelId: match[4],
    versionId: match[5],
  };
}

function ecosystemFor(air) {
  const parsed = parseAir(air);
  if (!parsed) return null;
  return CIVITAI_ECOSYSTEMS[parsed.ecosystem] || null;
}

/* ---------------------------------------------------------------------------
   CANONICAL SERIALISATION.

   Keys sorted at every level, recursively, so the same request always produces the same
   bytes no matter what order it was assembled in. That is the property the fingerprint
   rests on: without it, moving a line in the builder would change the digest of a request
   that had not changed at all, and a permit minted before the move would stop matching a
   body that was identical in every way that means anything.

   No whitespace, so the bytes hashed and the bytes sent are as short as they can be and
   there is nothing in them a formatter could quietly alter.

   `undefined` members are dropped, exactly as JSON.stringify drops them, so an optional
   parameter left unset produces the same text as one never mentioned. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalBytes(body) {
  return JSON.stringify(canonicalize(body));
}

function fingerprintOf(canonicalBody) {
  return crypto.createHash("sha256").update(String(canonicalBody), "utf8").digest("hex");
}

/* ---------------------------------------------------------------------------
   THE REQUEST.

   Every field here is either the recipe's or the shot's, and there are no others. What is
   deliberately NOT sent:

     seed        the documented minimal recipe does not carry one, and sending a parameter
                 CineBraid has not seen documented for this engine is how a paid request
                 gets refused after being quoted.
     callbacks   V1 polls. A webhook needs an address the provider can reach, which a
                 loopback application does not have.
     quantity    one image per request in V1, matching the ComfyUI foothold. Two images is
                 a different purchase and would need the paid quantity to travel through
                 the permit's outputCount as well as through the body.

   `tags` carries exactly one value and it is CineBraid's own job id. `metadata` is not
   used: the tag already makes the workflow findable, and a second copy of the same id
   inside an arbitrary-JSON field would be a second place to keep it in step. */
function buildImageRequest({ jobId, air, prompt, negativePrompt = "", width, height, steps, cfgScale } = {}) {
  const parsed = parseAir(air);
  if (!parsed)
    return { ok: false, code: "CIVITAI_RESOURCE_AIR_INVALID", error: "That is not a Civitai resource identifier. A model AIR looks like urn:air:sdxl:checkpoint:civitai:101055@128078." };
  const recipe = CIVITAI_ECOSYSTEMS[parsed.ecosystem];
  if (!recipe)
    return {
      ok: false,
      code: "CIVITAI_ECOSYSTEM_UNSUPPORTED",
      error: `CineBraid can build a Civitai image request for ${Object.values(CIVITAI_ECOSYSTEMS).map((row) => row.label).join(", ")} models. This resource is ${parsed.ecosystem}, and CineBraid has no recipe for it yet.`,
    };
  if (parsed.type !== "checkpoint")
    return {
      ok: false,
      code: "CIVITAI_RESOURCE_TYPE_UNSUPPORTED",
      error: `A Civitai frame is generated from a checkpoint. This resource is a ${parsed.type}.`,
    };
  const text = String(prompt || "").trim();
  if (!text)
    return { ok: false, code: "CIVITAI_PROMPT_EMPTY", error: "CineBraid will not send an empty prompt to a paid provider." };
  const id = String(jobId || "").trim();
  if (!id)
    return { ok: false, code: "CIVITAI_REQUEST_UNIDENTIFIED", error: "CineBraid will not build a paid request it cannot find again." };

  const size = {
    width: positiveInteger(width, recipe.defaults.width),
    height: positiveInteger(height, recipe.defaults.height),
    steps: positiveInteger(steps, recipe.defaults.steps),
    cfgScale: positiveNumber(cfgScale, recipe.defaults.cfgScale),
  };

  const body = {
    tags: [jobTag(id)],
    steps: [{
      $type: "imageGen",
      input: {
        engine: recipe.engine,
        ecosystem: recipe.ecosystem,
        operation: recipe.operation,
        model: parsed.air,
        prompt: text,
        /* An empty negative prompt is omitted rather than sent as "". The two are
           different requests to a provider, and only one of them is what a filmmaker who
           left the field alone asked for. */
        ...(String(negativePrompt || "").trim() ? { negativePrompt: String(negativePrompt).trim() } : {}),
        width: size.width,
        height: size.height,
        cfgScale: size.cfgScale,
        steps: size.steps,
      },
    }],
  };

  const canonicalBody = canonicalBytes(body);
  return {
    ok: true,
    body,
    canonicalBody,
    fingerprint: fingerprintOf(canonicalBody),
    resource: parsed,
    recipe: { ecosystem: recipe.ecosystem, engine: recipe.engine, operation: recipe.operation, label: recipe.label },
    parameters: size,
    tag: jobTag(id),
  };
}

/* Bounded so a configuration typo cannot become an expensive request. The ceilings are
   deliberately generous — this is a guard against a wrong order of magnitude, not a
   second opinion about what a filmmaker may render. */
function positiveInteger(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 && number <= 4096 ? number : fallback;
}
function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100 ? number : fallback;
}

module.exports = {
  AIR_PATTERN,
  CIVITAI_ECOSYSTEMS,
  CIVITAI_JOB_TAG_PREFIX,
  buildImageRequest,
  canonicalBytes,
  ecosystemFor,
  fingerprintOf,
  jobTag,
  parseAir,
};
