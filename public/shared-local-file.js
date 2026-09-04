/* CineBraid — LOCAL FILE AFFORDANCE, the shared truth about whether a piece of
   production media can be reached as a file on this computer.

   Shared by browser and Node the same way public/shared-media-disposition.js and
   public/shared-production-media.js are, and in their family: it is a DERIVATION.
   It reaches no filesystem, no network, no clock and no DOM, so the Node suites
   drive exactly the function the browser runs.

   ---------------------------------------------------------------------------
   THE INVARIANT THIS FILE EXISTS FOR, in one line:

       IF CINEBRAID SAYS A MEDIA ITEM EXISTS LOCALLY, THE FILMMAKER CAN REVEAL OR
       COPY THE EXACT AUTHORITATIVE FILE; IF IT DOES NOT EXIST LOCALLY, CINEBRAID
       SAYS SO.

   The failure this rules out is the plausible one: a `Show in Explorer` that opens
   the project folder, or a folder guessed from a label, and lets the filmmaker
   believe they are looking at the file they clicked. Opening the wrong directory
   confidently is worse than offering nothing, because the filmmaker then acts on
   it — deletes, renames, sends it to an editor.

   ---------------------------------------------------------------------------
   TWO ANSWERERS, ONE VOCABULARY.

   Only the filesystem knows whether a file is there, and only the server can touch
   a filesystem. So the question is split, and the split is the point:

     THIS MODULE answers ADDRESSABILITY — "does this media even name a local file?"
                That is decidable from the record alone, and two of its three
                answers are FINAL: `not-local` and `unresolvable` never need a
                round trip, so a provider result that was never downloaded can be
                told the truth without asking the disk about a file that does not
                exist.

     THE SERVER answers EXISTENCE — `available` or `missing` — by resolving the
                identity to an authoritative path inside the project it belongs to
                and looking. See local-file-affordance.js.

   `addressable` is deliberately not a member of LOCAL_FILE_STATES. It is the one
   answer that is not an answer, and naming it apart is what stops a surface from
   rendering "this file is on your computer" before anything has looked.

   ---------------------------------------------------------------------------
   THE KEY IS AN IDENTITY, NEVER A FILESYSTEM PATH.

   What crosses to the server is `asset:<durable id>` or `path:<project-relative
   media path>` — the SAME two-domain key public/shared-production-media.js already
   mints as `productionMediaKey()`, restated here so a caller holding only a scan
   row `{name, url, assetId}` can produce it without building a projection.

   The `path:` domain exists because it is the normal state, not as a loophole. A
   project whose MediaAsset pass has never run carries no durable ids at all
   (media-asset-service.js), and a feature that is dead on a fresh project is not a
   feature. It grants no reach the browser does not already have: the same string
   is what GET /assets/<path> already serves the bytes of, it must match the media
   directory shape below, and the server still resolves the project root itself and
   proves containment. The browser never names a drive, a folder or a machine.

   `asset:` WINS when both are present. A durable id survives the rename that an
   approval itself performs; a path does not. */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  /* ==========================================================================
     THE VOCABULARY. Four answers, and every one of them is something a surface
     can say out loud without inventing a fifth meaning. */
  const LOCAL_FILE_STATES = Object.freeze([
    /* the identity resolved, and a file is there right now */
    "available",
    /* the identity resolved to a recorded location, and nothing is there. The
       record is not wrong and is not repaired here — the file moved or went. */
    "missing",
    /* CineBraid knows this media and it has no local file at all: a provider
       result that was never collected, or a reference that is not materialised. */
    "not-local",
    /* nothing addressable was supplied, or it did not survive validation. */
    "unresolvable",
  ]);

  /* What this module can conclude on its own. `addressable` is the hand-off. */
  const LOCAL_FILE_ADDRESS_STATES = Object.freeze(["addressable", "not-local", "unresolvable"]);

  /* The two identity domains, exactly the two public/shared-production-media.js
     declares. Never merged, never cross-tried: a library id is never offered to
     the ledger and a ledger id is never offered to the project media library. */
  const LOCAL_FILE_KEY_DOMAINS = Object.freeze(["asset", "path"]);

  /* THE MEDIA DIRECTORY SHAPE, and it is a NARROWING FILTER rather than an
     authority.

     Identical to the allowlist GET /assets/* already applies before it serves a
     file's bytes, and to the directories media-asset-indexer.js indexes. Authority
     over which project, and over whether a resolved path really lies inside it,
     stays where it already is — the projects-root containment helpers on the
     server. This only refuses a shape early, so a malformed key is answered
     without touching a disk. */
  const LOCAL_FILE_FLAT_DIRS = Object.freeze(["anchors", "plates", "props", "vehicles", "audio", "media"]);
  const LOCAL_FILE_SHOT_DIRS = Object.freeze(["takes", "locked", "blocking"]);

  const ASSET_ID_PATTERN = /^asset-[0-9a-f]{32}$/;

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /* ==========================================================================
     PATH SHAPE.

     Every segment is checked rather than the string as a whole, because the
     dangerous values are segments: `..` climbs, `.` is a no-op that defeats a
     naive prefix test, and an empty segment is what a doubled separator leaves
     behind. A drive letter, a UNC prefix and a leading separator are refused
     outright — a project-relative path that names a volume is not project
     relative, whatever else it looks like. */
  function isProjectRelativeMediaPath(value) {
    const raw = text(value);
    if (!raw) return false;
    /* No backslashes: the browser is handed POSIX separators by the scan, so a
       backslash here is either a Windows path someone typed or an attempt to slip
       past a separator-aware check. Refuse rather than normalise. */
    if (raw.includes("\\")) return false;
    if (raw.startsWith("/")) return false;
    if (/^[a-zA-Z]:/.test(raw)) return false;
    if (raw.includes("\0")) return false;

    const segments = raw.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;

    if (segments.length === 2) return LOCAL_FILE_FLAT_DIRS.includes(segments[0]);
    if (segments.length === 4)
      return segments[0] === "shots"
        && /^[\w.-]+$/.test(segments[1])
        && LOCAL_FILE_SHOT_DIRS.includes(segments[2]);
    return false;
  }

  /* THE SHIPPED PREDICATE, PREFERRED, AND READ AT CALL TIME.

     public/shared-media-disposition.js already owns "is this a ledger asset id"
     and exports it globally as `isLedgerAssetId`. This module must not export that
     name — these are plain <script> tags sharing one global scope, and a second
     binding would silently replace the first for every other reader.

     Nor is it captured at load: that is the exact defect
     tests/current-behavior.js pins about shared-production-media.js binding the
     authority kernel before the kernel existed. The pattern below is the same
     shape media-assets.js mints and is the fallback for Node suites that load this
     module alone. */
  function ledgerAssetId(value) {
    const candidate = text(value);
    const owner = typeof globalThis !== "undefined" ? globalThis.isLedgerAssetId : null;
    if (typeof owner === "function" && owner !== ledgerAssetId) return owner(candidate) === true;
    return ASSET_ID_PATTERN.test(candidate);
  }

  /* The project-relative path a scan row names, decoded back out of the one path
     the browser is ever given. Deliberately decoded rather than reassembled from a
     directory the caller would have to remember — that reassembly is how a
     basename ends up inheriting another shot's record. Anything that is not an
     `/assets/` url is NOT a local file, which is precisely how a provider result
     reads. */
  function storagePathOfMedia(value) {
    const raw = text(isRecord(value) ? value.url : "");
    if (!raw.startsWith("/assets/")) return "";
    let rest = raw.slice("/assets/".length);
    try {
      rest = decodeURIComponent(rest);
    } catch {
      /* a raw name that is not valid percent-escaping stays as written */
    }
    return rest.replace(/^\/+/, "");
  }

  /* ==========================================================================
     THE KEY.

     Accepts either shape a caller actually holds:

       a production-media record   `{ identity: { ledger, path } }`
       a scan row                  `{ name, url, assetId }`

     and produces the same string for the same file from both, which is what lets a
     thumbnail hand off to the same server answer the Inspector gets. */
  function localFileKey(media) {
    if (!isRecord(media)) return "";

    /* A projection record first: its identity was already resolved by its owner,
       and re-deriving it here would be a second opinion. */
    const identity = isRecord(media.identity) ? media.identity : null;
    if (identity) {
      const ledger = isRecord(identity.ledger) && identity.ledger.state === "known"
        ? text(identity.ledger.value)
        : "";
      if (ledgerAssetId(ledger)) return `asset:${ledger}`;
      const stored = text(identity.path);
      return isProjectRelativeMediaPath(stored) ? `path:${stored}` : "";
    }

    const assetId = text(media.assetId);
    if (ledgerAssetId(assetId)) return `asset:${assetId}`;
    const stored = storagePathOfMedia(media);
    return isProjectRelativeMediaPath(stored) ? `path:${stored}` : "";
  }

  /* The server's half of the same grammar. Returns a domain and a value, or an
     empty domain — never a partially trusted string. */
  function parseLocalFileKey(key) {
    const raw = text(key);
    const cut = raw.indexOf(":");
    if (cut <= 0) return { domain: "", value: "" };
    const domain = raw.slice(0, cut);
    const value = raw.slice(cut + 1);
    if (domain === "asset") return ledgerAssetId(value) ? { domain, value } : { domain: "", value: "" };
    if (domain === "path")
      return isProjectRelativeMediaPath(value) ? { domain, value } : { domain: "", value: "" };
    return { domain: "", value: "" };
  }

  /* ==========================================================================
     ADDRESSABILITY — this module's whole answer.

     `not-local` and `unresolvable` are told apart on purpose, and the difference is
     what the filmmaker is owed:

       not-local     CineBraid HAS this media and it is not on this machine. The
                     honest sentence is "Not stored locally yet", and if the
                     product has a save/download action for it, that is where the
                     filmmaker should be sent.
       unresolvable  CineBraid cannot say what this is. Nothing is offered, and
                     nothing is claimed. */
  function localFileAddress(media) {
    if (!isRecord(media)) return Object.freeze({ state: "unresolvable", key: "", domain: "", reason: "no-media" });
    const key = localFileKey(media);
    if (key) {
      const parsed = parseLocalFileKey(key);
      return Object.freeze({ state: "addressable", key, domain: parsed.domain, reason: "" });
    }
    /* A record CineBraid holds that names no local file. That is a real and
       ordinary state — an uncollected provider result is exactly it — and it is
       reported as such rather than as a failure. */
    return Object.freeze({ state: "not-local", key: "", domain: "", reason: "no-local-storage" });
  }

  /* ==========================================================================
     WORDS.

     One place decides how each state reads, so the Inspector, a toast and a server
     refusal cannot describe the same fact three ways. Plain sentences, no jargon,
     and none of them claims an outcome CineBraid has not established. */
  const LOCAL_FILE_WORDS = Object.freeze({
    available: "Stored on this computer",
    /* Persistent and actionable, per the slice: it says what is true, and it does
       not offer to repair anything, because nothing here repairs. */
    missing: "File is no longer available at its recorded local path",
    "not-local": "Not stored locally yet",
    unresolvable: "CineBraid cannot locate this media on disk",
    addressable: "Checking this computer…",
  });

  function localFileWords(state) {
    return LOCAL_FILE_WORDS[text(state)] || LOCAL_FILE_WORDS.unresolvable;
  }

  /* Whether a surface may offer Show in Explorer / Copy file path at all. Only
     `available` earns them: `missing` has a recorded path and no file, and
     offering to reveal it would be the confident falsehood this module exists to
     prevent. */
  function localFileActionable(state) {
    return text(state) === "available";
  }

  return {
    LOCAL_FILE_ADDRESS_STATES,
    LOCAL_FILE_FLAT_DIRS,
    LOCAL_FILE_KEY_DOMAINS,
    LOCAL_FILE_SHOT_DIRS,
    LOCAL_FILE_STATES,
    LOCAL_FILE_WORDS,
    ledgerAssetId,
    isProjectRelativeMediaPath,
    localFileActionable,
    localFileAddress,
    localFileKey,
    localFileWords,
    parseLocalFileKey,
    storagePathOfMedia,
  };
});
