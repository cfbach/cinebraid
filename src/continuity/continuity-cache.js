/* CINEBRAID — declared-entity continuity: observation evidence cache.

   A model observation is expensive and perfectly reproducible: the same image,
   asked the same question by the same model, yields the same kind of answer.
   So an observation is cached by the identity of its inputs, and a comparison
   of two already-observed frames needs no model call at all.

   The cache is CONTENT-ADDRESSED. There is no freshness heuristic and no TTL:
   an entry simply stops being addressable when any input that produced it
   changes. That is why the key carries the image bytes, the manifest, the
   contract, the prompt revision and the provider identity.

   It is DERIVED evidence. Losing it costs a model call; trusting a stale or
   corrupt one costs a wrong continuity verdict. Every failure path here
   therefore degrades to "miss", never to "return it anyway".

   Server-side only, like automation-runs.js, and stored the same way: a
   project-scoped JSON file written through the repository's existing
   atomicWriteJson (temp + fsync + .bak + rename). */
const fs = require("fs");
const path = require("path");

const CACHE_VERSION = "continuity-observation-cache-v1";
const CACHE_FILE = "continuity-observations.json";
const MAX_ENTRIES = 5000;

function nowIso() {
  return new Date().toISOString();
}

/* ---------- image content identity ---------------------------------------

   The hash, its memo and both of the memo's bounds now live in media-hash.js so
   the MediaAsset ledger can share exactly this primitive rather than growing a
   second one that drifts. Nothing about the behaviour moved with it: same
   SHA-256 over the same bytes, same stat-keyed memo, same settle window, same
   refusal for a non-file — and therefore the same digests, so observations
   written before the extraction are still admissible.

   These names are re-exported below because continuity's route, its suite and
   this module all spell it hashImageFile. */
const {
  HASH_MEMO_LIMIT,
  HASH_MEMO_SETTLE_MS,
  clearImageHashMemo,
  hashImageFile,
  sha256Hex,
} = require("../media/media-hash");

/* ---------- execution endpoint identity -----------------------------------

   "custom" and "nemotron_3_nano_omni" are names, not an address. Two different
   OpenAI-compatible servers can both be called custom and both serve a model
   under the same name while holding different weights, and continuity may now
   be pointed at its own endpoint independently of the general provider. So the
   ADDRESS a request was actually executed against is part of what produced the
   answer, and belongs in the key.

   Only the fingerprint is carried. The address itself is a deployment detail
   with no business being written into a project directory, and a hash answers
   the only question the cache asks of it: is this the same connection.

   Normalization is exactly the dispatcher's own equivalence and no more:
   llm.js builds its request URL as `baseUrl.replace(/\/$/, "") + "/chat/..."`,
   so a trailing slash is provably the same wire address and nothing else is.
   Host casing, default ports and IPv6 spellings are deliberately NOT collapsed
   — that would risk declaring genuinely different endpoints identical, which
   is the failure this exists to prevent. */
function normalizeEndpoint(baseUrl) {
  return String(baseUrl == null ? "" : baseUrl).trim().replace(/\/$/, "");
}
function endpointFingerprint(baseUrl) {
  const normalized = normalizeEndpoint(baseUrl);
  return normalized ? sha256Hex(Buffer.from(normalized, "utf8")) : "";
}

/* ---------- cache identity -----------------------------------------------

   Every component answers a question that, if answered differently, would make
   the stored answer wrong:

     contractVersion  the schema/vocabulary the model was constrained by
     promptVersion    the wording of the question it was asked
     imageHash        the pixels it was asked about
     manifestHash     which entities were declared, and how (Phase 1 hashes
                      exactly the fields the prompt and schema consume)
     provider, model  who answered — a Qwen answer is not a Nemotron answer
     endpointHash     WHERE it answered, fingerprinted. Two servers sharing a
                      provider and a model name are not the same witness.

   Components are joined with NUL, which cannot occur in any of them. Joining
   provider and model with "@" instead would let provider "a" + model "b@c"
   collide with provider "a@b" + model "c" — unreachable with today's two
   provider names, but a delimiter that can appear in the data is a latent way
   to serve one model's evidence as another's. */
const KEY_SEPARATOR = "\u0000";
function observationKey({ contractVersion, promptVersion, imageHash, manifestHash, provider, model, endpointHash }) {
  const payload = [contractVersion, promptVersion, imageHash, manifestHash, provider, model, endpointHash]
    .map((part) => String(part == null ? "" : part))
    .join(KEY_SEPARATOR);
  return sha256Hex(Buffer.from(payload, "utf8"));
}

/* ---------- store ---------------------------------------------------------- */
function createContinuityCache({ projectDir, atomicWriteJson, log = () => {} }) {
  function file() {
    return path.join(projectDir(), CACHE_FILE);
  }
  function emptyCache() {
    return { version: CACHE_VERSION, updatedAt: "", entries: {} };
  }
  function parse(target) {
    const parsed = JSON.parse(String(fs.readFileSync(target, "utf8")).replace(/^﻿/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("cache root is not an object");
    if (parsed.version !== CACHE_VERSION) throw new Error(`cache version ${parsed.version} is not ${CACHE_VERSION}`);
    if (!parsed.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) throw new Error("cache entries is not an object");
    return { version: CACHE_VERSION, updatedAt: String(parsed.updatedAt || ""), entries: parsed.entries };
  }
  /* A full cache can hold thousands of observations, and every observe and
     compare reads it. Re-parsing megabytes of JSON on each request is the one
     hot path here worth avoiding, so the parsed value is held against the
     file's own size and mtime: any write — by this process or anything else —
     changes those and the memo is dropped. It is a read optimisation only and
     never decides whether an entry is valid. */
  let parsedMemo = null;
  function parseWithMemo(target) {
    const stat = fs.statSync(target);
    const stamp = `${stat.size}|${stat.mtimeMs}`;
    if (parsedMemo && parsedMemo.target === target && parsedMemo.stamp === stamp) return parsedMemo.value;
    const value = parse(target);
    parsedMemo = { target, stamp, value };
    return value;
  }
  /* Fail soft, always. A corrupt cache is derived evidence CineBraid can
     rebuild; it must never be the reason a project will not open. The bad file
     is quarantined rather than deleted so the failure can be diagnosed. */
  function read() {
    const target = file();
    try {
      return parseWithMemo(target);
    } catch (error) {
      parsedMemo = null;
      if (error?.code === "ENOENT") return emptyCache();
      try {
        const recovered = parse(`${target}.bak`);
        log(`continuity cache was unreadable (${error.message}); its backup copy was used.`);
        return recovered;
      } catch {
        try {
          if (fs.existsSync(target)) {
            const quarantine = `${target}.corrupt-${Date.now()}`;
            fs.renameSync(target, quarantine);
            log(`continuity cache was unreadable (${error.message}); it was quarantined as ${path.basename(quarantine)} and rebuilt empty.`);
          }
        } catch { /* quarantine is best-effort; an empty cache is still correct */ }
        return emptyCache();
      }
    }
  }

  /* Access times are tracked in memory and folded in only when the cache is
     being written anyway. Persisting them on every read would turn a cache HIT
     — the fast path whose whole purpose is doing no work — into a disk write. */
  const accessed = new Map();
  function touch(key) {
    accessed.set(key, nowIso());
  }
  function retentionTime(entry, key) {
    return accessed.get(key) || entry?.lastAccessedAt || entry?.observedAt || "";
  }
  /* Bounded growth. Oldest-accessed entries are evicted first, which is LRU
     over the access information actually available. Entries are never removed
     for any other reason: an addressable entry is live evidence. */
  function prune(entries) {
    const keys = Object.keys(entries);
    if (keys.length <= MAX_ENTRIES) return { entries, evicted: 0 };
    const ordered = keys.sort((a, b) => {
      const ta = retentionTime(entries[a], a);
      const tb = retentionTime(entries[b], b);
      return ta < tb ? -1 : ta > tb ? 1 : (a < b ? -1 : a > b ? 1 : 0);
    });
    const drop = ordered.slice(0, keys.length - MAX_ENTRIES);
    const kept = { ...entries };
    for (const key of drop) delete kept[key];
    return { entries: kept, evicted: drop.length };
  }

  /* Writes are serialized through one promise chain, and each write re-reads
     the file inside its own turn before merging. Two observations that finish
     at the same time therefore both survive: without this the second write
     would persist a snapshot taken before the first entry existed. */
  let writeChain = Promise.resolve();
  function serialize(work) {
    const next = writeChain.then(work, work);
    /* Keep the chain alive after a rejection so one failed write cannot wedge
       every later one. */
    writeChain = next.then(() => undefined, () => undefined);
    return next;
  }
  function commit(mutate) {
    return serialize(() => {
      const cache = read();
      /* Work on a copy: mutating the read result in place would edit the parse
         memo, and the memo is dropped either way so a write that throws can
         never leave the in-memory view ahead of the file on disk. */
      const working = { ...cache.entries };
      try {
        const result = mutate(working) || {};
        for (const [key, entry] of Object.entries(working))
          if (accessed.has(key)) working[key] = { ...entry, lastAccessedAt: accessed.get(key) };
        const { entries, evicted } = prune(working);
        atomicWriteJson(file(), { version: CACHE_VERSION, updatedAt: nowIso(), entries });
        accessed.clear();
        return { ...result, evicted, size: Object.keys(entries).length };
      } finally {
        parsedMemo = null;
      }
    });
  }

  /* A key match is necessary but not sufficient. The entry is re-checked
     against the identity it claims, and against the shape Phase 1 expects,
     before it is trusted. Anything else is a miss and is dropped. */
  function entryMatches(entry, expected) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    /* endpointHash is checked like every other identity component, which is
       also what makes an entry written before it existed untrusted: it carries
       no fingerprint, so it can never match a caller that resolved one. Such an
       entry is unaddressable under the new key anyway and simply waits for
       eviction or a purge. */
    for (const field of ["key", "imageHash", "manifestHash", "contractVersion", "promptVersion", "provider", "model", "endpointHash"])
      if (String(entry[field] || "") !== String(expected[field] || "")) return false;
    const observation = entry.observation;
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) return false;
    if (observation.coordinate_mode !== "permille") return false;
    if (!observation.entities || typeof observation.entities !== "object" || Array.isArray(observation.entities)) return false;
    const validation = entry.validation;
    if (!validation || typeof validation !== "object" || Array.isArray(validation)) return false;
    if (!validation.states || typeof validation.states !== "object" || Array.isArray(validation.states)) return false;
    if (!Array.isArray(validation.flags)) return false;
    /* The cached record set must still cover exactly the entities the caller
       is asking about. */
    const wanted = [...(expected.entityIds || [])].sort();
    const stored = Object.keys(observation.entities).sort();
    if (wanted.length !== stored.length) return false;
    for (let i = 0; i < wanted.length; i++) if (wanted[i] !== stored[i]) return false;
    return true;
  }

  return {
    CACHE_VERSION,
    CACHE_FILE,
    MAX_ENTRIES,
    file,
    observationKey,
    endpointFingerprint,
    hashImageFile,
    clearImageHashMemo,
    read,
    /* Synchronous read path: a HIT must not wait on the write chain. */
    lookup(key, expected) {
      const entry = read().entries[key];
      if (!entry) return null;
      if (!entryMatches(entry, expected)) {
        log(`continuity cache entry ${key.slice(0, 12)} did not match its declared identity; treating as a miss.`);
        commit((entries) => { delete entries[key]; }).catch(() => {});
        return null;
      }
      touch(key);
      return entry;
    },
    store(entry) {
      return commit((entries) => {
        entries[entry.key] = entry;
        accessed.set(entry.key, entry.observedAt || nowIso());
      });
    },
    /* Removes derived evidence only. Never touches media or project data. */
    purge(filter = {}) {
      const shotId = filter.shotId ? String(filter.shotId) : "";
      const frameId = filter.frameId ? String(filter.frameId) : "";
      return commit((entries) => {
        let removed = 0;
        for (const [key, entry] of Object.entries(entries)) {
          if (shotId && String(entry?.shotId || "") !== shotId) continue;
          if (frameId && String(entry?.frameId || "") !== frameId) continue;
          delete entries[key];
          removed += 1;
        }
        return { removed };
      });
    },
    stats() {
      const cache = read();
      return { version: cache.version, updatedAt: cache.updatedAt, size: Object.keys(cache.entries).length, max: MAX_ENTRIES };
    },
  };
}

module.exports = {
  CACHE_VERSION,
  CACHE_FILE,
  MAX_ENTRIES,
  createContinuityCache,
  observationKey,
  normalizeEndpoint,
  endpointFingerprint,
  hashImageFile,
  clearImageHashMemo,
  sha256Hex,
};
