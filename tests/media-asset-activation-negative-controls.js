/* CineBraid MediaAsset activation — negative controls.
 *
 * Twelve deliberately broken builds of the identity pipeline, each one the exact
 * mistake the real implementation is written to avoid. A control is only worth
 * anything if the broken behaviour RAN: an import error, a typo or a module that
 * fails to load proves nothing about the guard, so every control below records a
 * marker from inside the sabotaged branch and asserts the marker fired before it
 * asserts that the outcome is wrong.
 *
 *   NC-A  a same-byte rename mints a new identity
 *   NC-B  byte replacement mutates the old asset's content identity
 *   NC-C  two same-named files in different directories collapse into one asset
 *   NC-D  two live files merge because their digests match
 *   NC-E  an ambiguous rename is resolved by picking
 *   NC-F  a file that vanished is deleted from the ledger
 *   NC-G  one project's ledger is reused while another is active
 *   NC-H  an unreadable ledger reads as an empty one
 *   NC-I  indexing rewrites project.json
 *   NC-J  an indexed path escapes the configured project universe
 *   NC-K  a paid provider route is reached from activation
 *   NC-L  the FLF motion-readiness gate is moved
 *
 * Six more guard the lifecycle that makes those semantics true for media which
 * PRE-DATES activation, rather than only for media that arrived after it:
 *
 *   NC-1  first-index assets are left unverified for ever
 *   NC-2  a rename CineBraid itself performs forks an unverified asset's identity
 *   NC-3  scheduling a pass hashes the whole project before it returns
 *   NC-4  an out-of-band rename with no byte evidence is guessed from path similarity
 *   NC-5  the backlog tier merges two simultaneously-live same-byte files
 *   NC-6  verification writes project.json
 *
 * The sabotage is applied to COPIES of the real modules in a temp directory, so
 * each control exercises the genuine code path with one behaviour changed, and the
 * checkout is never modified.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-nc-"));
const PIPELINE = [
  "media-assets.js", "media-asset-store.js", "media-asset-indexer.js",
  "media-asset-verify.js", "media-asset-service.js", "media-hash.js",
];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const bytesOf = (tag) => Buffer.concat([PNG, Buffer.from(String(tag))]);
const results = [];

/* A build of the real pipeline with named surgery applied. The anchor must exist
   or the control is silently testing nothing, so a missing anchor is a hard
   failure rather than a skipped mutation. */
function sabotage(label, mutations) {
  const dir = path.join(TEMP, `build-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of PIPELINE) {
    /* core.autocrlf is on for this checkout, so the working tree is CRLF while the
       anchors below are written LF. Normalise, or every multi-line anchor silently
       fails to match and the control tests an unmodified module. */
    let source = fs.readFileSync(path.join(ROOT, "src/media", name), "utf8").replace(/\r\n/g, "\n");
    for (const [find, replace] of mutations[name] || []) {
      assert(source.includes(find),
        `NC-${label}: anchor missing from ${name}. A control that does not modify the real code proves nothing.`);
      source = source.split(find).join(replace);
    }
    fs.writeFileSync(path.join(dir, name), source);
  }
  global.__NC__ = [];
  return require(path.join(dir, "media-asset-service.js"));
}
const HIT = (tag) => `global.__NC__.push(${JSON.stringify(tag)});`;

let made = 0;
function makeProject(label, slug, { project = {}, files = {} } = {}) {
  const root = path.join(TEMP, `fs-${label}-${made += 1}`);
  const dir = path.join(root, slug);
  for (const sub of ["anchors", "plates", "props", "vehicles", "audio", "media"])
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
    meta: { title: slug },
    scenes: [], shots: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    ...project,
  }, null, 2));
  return { root, dir };
}
const rows = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "media-assets.json"), "utf8")).assets;
const rowAt = (dir, p) => rows(dir).find((a) => a.storage.path === p && a.storage.missing !== true);
const go = (S, root, slug, extra = {}) =>
  S.activateProject({ projectsRoot: root, slug, reason: "explicit", throttleMs: 0, ...extra });

function record(label, what, detail) {
  results.push(`NC-${label} · ${what} — ${detail}`);
}

async function main() {
  /* ================= NC-A — a same-byte rename mints a new identity ================= */
  {
    const S = sabotage("A", {
      "media-asset-verify.js": [[
        "    const from = origin.storage.path;",
        `    ${HIT("rename-not-reconciled")}\n    if (global.__NC__.length) continue;\n    const from = origin.storage.path;`,
      ]],
    });
    const { root, dir } = makeProject("A", "p", { files: { "media/SEED.png": bytesOf("seed") } });
    await go(S, root, "p");
    fs.writeFileSync(path.join(dir, "media", "ORIGINAL.png"), bytesOf("subject"));
    await go(S, root, "p");
    const before = rowAt(dir, "media/ORIGINAL.png");
    assert(before.contentHash, "the control needs an established digest to be able to lose it");
    fs.renameSync(path.join(dir, "media", "ORIGINAL.png"), path.join(dir, "media", "RENAMED.png"));
    await go(S, root, "p");
    assert(global.__NC__.includes("rename-not-reconciled"), "NC-A: the broken reconciliation must have executed");
    const after = rowAt(dir, "media/RENAMED.png");
    assert.notStrictEqual(after.assetId, before.assetId,
      "NC-A must actually mint a new identity for the moved bytes");
    /* The invariant the real build holds, failing here. */
    assert.throws(
      () => assert.strictEqual(after.assetId, before.assetId, "same bytes at a new path are the same MediaAsset"),
      /same MediaAsset/,
      "NC-A: the rename invariant must go RED against this build",
    );
    record("A", "rename mints new identity", `RED — ${before.assetId.slice(0, 14)}… became ${after.assetId.slice(0, 14)}… and history detached from the bytes`);
  }

  /* ================= NC-B — byte replacement mutates the old asset ================= */
  {
    const S = sabotage("B", {
      "media-asset-verify.js": [[
        "    const successor = recordReplacement(ledger, asset, digest, stat, now);",
        `    ${HIT("old-asset-mutated")}\n    asset.contentHash = digest;\n`
        + "    asset.storage = { ...asset.storage, bytes: stat.size, mtimeMs: stat.mtimeMs };\n"
        + "    asset.indexedAt = now();\n    const successor = asset;",
      ]],
    });
    const { root, dir } = makeProject("B", "p", { files: { "media/SEED.png": bytesOf("seed") } });
    await go(S, root, "p");
    fs.writeFileSync(path.join(dir, "anchors", "CHAR-RHEA.png"), bytesOf("rhea-v1"));
    await go(S, root, "p");
    const before = rowAt(dir, "anchors/CHAR-RHEA.png");
    const originalId = before.assetId;
    const originalHash = before.contentHash;
    assert(originalHash, "the control needs H1 on the record before it can overwrite it");

    await new Promise((resolve) => setTimeout(resolve, 15));
    fs.writeFileSync(path.join(dir, "anchors", "CHAR-RHEA.png"), bytesOf("rhea-v2"));
    await go(S, root, "p");
    assert(global.__NC__.includes("old-asset-mutated"), "NC-B: the in-place mutation must have executed");
    const after = rows(dir).find((a) => a.assetId === originalId);
    assert.notStrictEqual(after.contentHash, originalHash, "NC-B must actually overwrite the historical digest");
    assert.strictEqual(rows(dir).some((a) => a.replacedAssetId === originalId), false,
      "and must produce no successor");
    assert.throws(
      () => assert.strictEqual(after.contentHash, originalHash,
        "the previous content identity must remain distinguishable"),
      /distinguishable/,
      "NC-B: the replacement invariant must go RED against this build",
    );
    record("B", "byte replacement mutates the old asset", `RED — asset ${originalId.slice(0, 14)}… silently became H2, so "is this the file that was approved" is unanswerable`);
  }

  /* ================= NC-C — same basename in different directories collapses ================= */
  {
    const S = sabotage("C", {
      "media-asset-indexer.js": [
        ["    byPath.set(asset.storage.path, asset);",
          `    ${HIT("basename-keyed")}\n    byPath.set(asset.storage.path.split("/").pop(), asset);`],
        ["      const existing = byPath.get(relativePath);",
          `      ${HIT("basename-lookup")}\n      const existing = byPath.get(relativePath.split("/").pop());`],
      ],
    });
    const { root, dir } = makeProject("C", "p", { files: { "anchors/take.png": bytesOf("anchor-take") } });
    await go(S, root, "p");
    /* Two more files, same basename, different directories. Under a basename key
       the indexer finds the anchors row for both and "reuses" it, so neither ever
       acquires an identity of its own. */
    fs.mkdirSync(path.join(dir, "shots", "S-01", "takes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "shots", "S-02", "takes"), { recursive: true });
    fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", "take.png"), bytesOf("s01-take"));
    fs.writeFileSync(path.join(dir, "shots", "S-02", "takes", "take.png"), bytesOf("s02-take"));
    const collapsed = await go(S, root, "p");
    assert(global.__NC__.includes("basename-lookup"), "NC-C: the basename lookup must have executed");
    assert.strictEqual(collapsed.indexed.minted, 0, "NC-C must mint nothing for two genuinely new files");
    const takes = rows(dir).filter((a) => a.storage.path.endsWith("take.png"));
    assert.strictEqual(takes.length, 1, "NC-C must actually collapse three files into one row");
    assert.throws(
      () => assert.strictEqual(takes.length, 3, "one basename in three directories is three MediaAssets"),
      /three MediaAssets/,
      "NC-C: the distinct-identity invariant must go RED against this build",
    );
    record("C", "basename collapse", "RED — three files in three directories became one asset, so a character plate and a shot take share one identity");
  }

  /* ================= NC-D — two live files merged because the digests match ================= */
  {
    const S = sabotage("D", {
      "media-asset-verify.js": [[
        "    if (!gone.length || !here.length) continue;",
        `    if (here.length > 1) {\n      ${HIT("duplicate-content-merged")}\n`
        + "      const [, ...drop] = here;\n"
        + "      ledger.assets = ledger.assets.filter((row) => !drop.includes(row));\n"
        + "      continue;\n    }\n    if (!gone.length || !here.length) continue;",
      ]],
    });
    const { root, dir } = makeProject("D", "p", {
      files: { "media/twin-left.png": bytesOf("twin"), "media/twin-right.png": bytesOf("twin") },
    });
    await go(S, root, "p");
    await S.verifyNow({ projectsRoot: root, slug: "p" });
    assert(global.__NC__.includes("duplicate-content-merged"), "NC-D: the merge must have executed");
    const twins = rows(dir).filter((a) => a.storage.path.startsWith("media/twin"));
    assert.strictEqual(twins.length, 1, "NC-D must actually merge the two live files");
    assert.throws(
      () => assert.strictEqual(twins.length, 2,
        "two independent current files are two MediaAssets even when their digests match"),
      /two MediaAssets/,
      "NC-D: the duplicate-content invariant must go RED against this build",
    );
    record("D", "hash collapse", "RED — two live files with equal bytes became one asset, so the same still approved for two shots is unrepresentable");
  }

  /* ================= NC-E — an ambiguous rename resolved by picking ================= */
  {
    const S = sabotage("E", {
      "media-asset-verify.js": [[
        "      for (const row of here) row.renameAmbiguous = true;\n"
        + "      ambiguous.push({ contentHash: digest, missing: gone.length, present: here.length });\n"
        + "      continue;",
        `      ${HIT("ambiguity-guessed")}\n      gone.length = 1;\n      here.length = 1;`,
      ]],
    });
    const { root, dir } = makeProject("E", "p", {
      files: { "media/left.png": bytesOf("same"), "media/right.png": bytesOf("same") },
    });
    await go(S, root, "p");
    await S.verifyNow({ projectsRoot: root, slug: "p" });
    const originals = rows(dir).map((a) => a.assetId).sort();
    fs.unlinkSync(path.join(dir, "media", "left.png"));
    fs.unlinkSync(path.join(dir, "media", "right.png"));
    await go(S, root, "p");
    fs.writeFileSync(path.join(dir, "media", "one.png"), bytesOf("same"));
    fs.writeFileSync(path.join(dir, "media", "two.png"), bytesOf("same"));
    const guessed = await go(S, root, "p");
    assert(global.__NC__.includes("ambiguity-guessed"), "NC-E: the guess must have executed");
    assert.strictEqual(guessed.verified.renames.length, 1, "NC-E must actually invent a rename");
    assert.strictEqual(guessed.verified.ambiguous.length, 0, "and must report no ambiguity");
    const claimed = rowAt(dir, "media/one.png");
    assert(originals.includes(claimed.assetId),
      "NC-E: one of the two missing identities was transplanted onto whichever file happened to hold a copy of its bytes");
    assert.throws(
      () => assert.strictEqual(guessed.verified.renames.length, 0,
        "an ambiguous match must reconcile nothing"),
      /reconcile nothing/,
      "NC-E: the ambiguity invariant must go RED against this build",
    );
    record("E", "ambiguous rename guessed", "RED — one of two indistinguishable candidates was picked, silently transplanting one asset's history onto another's bytes");
  }

  /* ================= NC-F — a vanished file is deleted from the ledger ================= */
  {
    const S = sabotage("F", {
      "media-asset-indexer.js": [[
        "      if (!asset.storage.missing) {\n"
        + "        asset.storage = { ...asset.storage, missing: true };\n"
        + "        asset.indexedAt = now();\n"
        + "        stats.missing += 1;\n"
        + "        changed = true;\n"
        + "      }",
        `      ${HIT("missing-deleted")}\n`
        + "      ledger.assets = ledger.assets.filter((row) => row !== asset);\n"
        + "      stats.missing += 1;\n      changed = true;",
      ]],
    });
    const { root, dir } = makeProject("F", "p", {
      files: { "media/KEEP.png": bytesOf("keep"), "media/GONE.png": bytesOf("gone") },
    });
    await go(S, root, "p");
    const goneId = rowAt(dir, "media/GONE.png").assetId;
    fs.unlinkSync(path.join(dir, "media", "GONE.png"));
    await go(S, root, "p");
    assert(global.__NC__.includes("missing-deleted"), "NC-F: the deletion must have executed");
    assert.strictEqual(rows(dir).some((a) => a.assetId === goneId), false,
      "NC-F must actually remove the identity");
    assert.throws(
      () => assert(rows(dir).some((a) => a.assetId === goneId),
        "a vanished file keeps its durable identity, marked rather than deleted"),
      /durable identity/,
      "NC-F: the missing-file invariant must go RED against this build",
    );
    record("F", "missing file deleted", `RED — identity ${goneId.slice(0, 14)}… was destroyed by a file being temporarily absent, and every relationship built on it with it`);
  }

  /* ================= NC-G — one project's ledger reused while another is active ============ */
  {
    /* Project state held across a switch: the ledger the pass writes stays the
       first project's, while discovery correctly moves to the second. */
    const S = sabotage("G", {
      "media-asset-store.js": [[
        "function ledgerPath(projectDir) {\n  return path.join(projectDir, MEDIA_ASSETS_FILE);\n}",
        "function ledgerPath(projectDir) {\n"
        + `  ${HIT("ledger-path-pinned")}\n`
        + "  if (!global.__NC_DIR__) global.__NC_DIR__ = projectDir;\n"
        + "  return path.join(global.__NC_DIR__, MEDIA_ASSETS_FILE);\n}",
      ]],
    });
    global.__NC_DIR__ = null;
    const root = path.join(TEMP, "fs-G");
    for (const [slug, name] of [["alpha", "A.png"], ["beta", "B.png"]]) {
      const dir = path.join(root, slug);
      fs.mkdirSync(path.join(dir, "media"), { recursive: true });
      fs.writeFileSync(path.join(dir, "media", name), bytesOf(slug));
      fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
        meta: { title: slug }, scenes: [], shots: [], characters: [], locations: [],
        props: [], vehicles: [], audio: [], mediaAssets: [],
      }, null, 2));
    }
    await go(S, root, "alpha", { reason: "switch" });
    await go(S, root, "beta", { reason: "switch" });
    assert(global.__NC__.includes("ledger-path-pinned"), "NC-G: the reused ledger path must have executed");
    const alphaRows = rows(path.join(root, "alpha"));
    const alphaPaths = alphaRows.map((a) => a.storage.path).sort();
    assert(alphaPaths.includes("media/B.png"), "NC-G must actually write beta's media into alpha's ledger");
    assert.strictEqual(fs.existsSync(path.join(root, "beta", "media-assets.json")), false,
      "and beta must have no ledger of its own");
    assert.strictEqual(alphaRows.find((a) => a.storage.path === "media/A.png").storage.missing, true,
      "and alpha's own asset was declared missing on the evidence of another project's directory listing");
    assert.throws(
      () => assert.deepStrictEqual(alphaPaths, ["media/A.png"],
        "a project ledger contains only that project's media"),
      /Expected values to be strictly deep-equal|only that project/,
      "NC-G: the isolation invariant must go RED against this build",
    );
    global.__NC_DIR__ = null;
    record("G", "project contamination", "RED — beta's media was indexed into alpha's ledger, so identity crossed a project boundary");
  }

  /* ================= NC-H — an unreadable ledger reads as an empty one ================= */
  {
    const S = sabotage("H", {
      "media-asset-store.js": [[
        "      /* Both gone. Refuse — do not invent an empty ledger. */\n      throw new LedgerUnreadableError(",
        `      ${HIT("empty-on-corrupt")}\n`
        + "      return { ledger: emptyLedger(), exists: false, recovered: false, warning: \"\", "
        + "schemaVersion: MEDIA_ASSETS_SCHEMA_VERSION, readOnly: false };\n"
        + "      throw new LedgerUnreadableError(",
      ]],
    });
    const { root, dir } = makeProject("H", "p", {
      files: { "media/A.png": bytesOf("a"), "media/B.png": bytesOf("b") },
    });
    await go(S, root, "p");
    const before = rows(dir).map((a) => a.assetId).sort();
    fs.writeFileSync(path.join(dir, "media-assets.json"), "{ not json");
    fs.writeFileSync(path.join(dir, "media-assets.json.bak"), "{ nor this");
    await go(S, root, "p");
    assert(global.__NC__.includes("empty-on-corrupt"), "NC-H: the empty-ledger fallback must have executed");
    const after = rows(dir).map((a) => a.assetId).sort();
    assert.strictEqual(after.length, 2, "the pass re-indexed from an assumed empty ledger");
    assert.notDeepStrictEqual(after, before, "NC-H must actually re-mint every identity");
    assert.throws(
      () => assert.deepStrictEqual(after, before,
        "an unreadable ledger must never be treated as an empty one"),
      /Expected values to be strictly deep-equal|never be treated/,
      "NC-H: the corruption invariant must go RED against this build",
    );
    record("H", "unreadable ledger reads as empty", "RED — both identities were re-minted from corruption, discarding every relationship built on the old ones");
  }

  /* ================= NC-I — indexing rewrites project.json ================= */
  {
    const S = sabotage("I", {
      "media-asset-service.js": [[
        "  record.status = \"complete\";\n  record.finishedAt = nowIso();",
        `  ${HIT("project-rewritten")}\n`
        + "  fs.writeFileSync(path.join(projectDir, \"project.json\"), JSON.stringify(project));\n"
        + "  record.status = \"complete\";\n  record.finishedAt = nowIso();",
      ]],
    });
    const { root, dir } = makeProject("I", "p", {
      files: { "media/A.png": bytesOf("a") },
      project: { shots: [{ id: "S-01", winner: "A.png", keyframes: [], clips: [], candidateFiles: [] }] },
    });
    const before = fs.readFileSync(path.join(dir, "project.json"));
    await go(S, root, "p");
    assert(global.__NC__.includes("project-rewritten"), "NC-I: the project write must have executed");
    const after = fs.readFileSync(path.join(dir, "project.json"));
    assert.strictEqual(before.equals(after), false, "NC-I must actually rewrite project.json");
    assert.throws(
      () => assert(before.equals(after), "activation must leave project.json byte-identical"),
      /byte-identical/,
      "NC-I: the no-legacy-mutation invariant must go RED against this build",
    );
    record("I", "project.json rewritten on indexing", `RED — ${before.length} bytes became ${after.length}, so an identity pass silently renormalised legacy project semantics`);
  }

  /* ================= NC-J — an indexed path escapes the project universe ================= */
  {
    const S = sabotage("J", {
      "media-asset-service.js": [[
        "  if (rel === \"..\" || rel.startsWith(`..${path.sep}`) || rel.startsWith(\"../\")) return \"\";\n"
        + "  if (rel.split(/[\\\\/]/).length !== 1) return \"\";",
        `  ${HIT("containment-removed")}`,
      ]],
    });
    /* An outside directory that IS a project, so the escape has something to index
       and the control shows real media leaving the configured universe. */
    const outside = path.join(TEMP, "fs-J-outside");
    const projectsRoot = path.join(outside, "projects");
    fs.mkdirSync(path.join(outside, "media"), { recursive: true });
    fs.mkdirSync(projectsRoot, { recursive: true });
    fs.writeFileSync(path.join(outside, "media", "PRIVATE.png"), bytesOf("private"));
    fs.writeFileSync(path.join(outside, "project.json"), JSON.stringify({
      meta: { title: "outside" }, scenes: [], shots: [], characters: [], locations: [],
      props: [], vehicles: [], audio: [], mediaAssets: [],
    }, null, 2));

    assert.strictEqual(S.resolveProjectDir(projectsRoot, ".."), path.resolve(outside),
      "NC-J must actually resolve outside the projects root");
    await go(S, projectsRoot, "..");
    assert(global.__NC__.includes("containment-removed"), "NC-J: the removed containment check must have executed");
    assert(fs.existsSync(path.join(outside, "media-assets.json")),
      "NC-J must actually index media outside the configured universe");
    assert(rows(outside).some((a) => a.storage.path === "media/PRIVATE.png"),
      "and must have enumerated it");
    assert.throws(
      () => assert.strictEqual(S.resolveProjectDir(projectsRoot, ".."), "",
        "a slug must never resolve outside the projects root"),
      /never resolve outside/,
      "NC-J: the containment invariant must go RED against this build",
    );
    record("J", "filesystem escape", "RED — slug '..' resolved to the projects root's PARENT and indexed media outside the configured universe");
  }

  /* ================= NC-K — a paid provider route reached from activation ============== */
  {
    const S = sabotage("K", {
      "media-asset-service.js": [[
        "  record.status = \"complete\";\n  record.finishedAt = nowIso();",
        `  ${HIT("provider-called")}\n`
        + "  await fetch(\"https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/image-to-video\", { method: \"POST\" });\n"
        + "  record.status = \"complete\";\n  record.finishedAt = nowIso();",
      ]],
    });
    const attempts = [];
    const realFetch = global.fetch;
    global.fetch = (...args) => { attempts.push(String(args[0])); throw new Error("network is not reachable from activation"); };
    try {
      const { root } = makeProject("K", "p", { files: { "media/A.png": bytesOf("a") } });
      await go(S, root, "p");
    } finally {
      global.fetch = realFetch;
    }
    assert(global.__NC__.includes("provider-called"), "NC-K: the provider call must have executed");
    assert.strictEqual(attempts.length, 1, "NC-K must actually attempt one outbound request");
    assert(attempts[0].includes("queue.fal.run"), "and it must be the paid submit route");
    assert.throws(
      () => assert.deepStrictEqual(attempts, [],
        "activation makes no outbound request of any kind"),
      /Expected values to be strictly deep-equal|no outbound request/,
      "NC-K: the zero-paid-calls invariant must go RED against this build",
    );
    record("K", "paid provider reached", `RED — the armed guard caught ${attempts[0]}, so the $0 claim in the positive suite is not vacuous`);
  }

  /* ================= NC-L — the FLF motion-readiness gate moved ================= */
  {
    const real = fs.readFileSync(path.join(ROOT, "public", "creation-studio.js"), "utf8").replace(/\r\n/g, "\n");
    const GATE = 'if (approvedCount >= 2 && !sequenceReview?.pass) return toast(';
    const NAVIGATES = 'c.deliveryIntent = "motion";';
    /* Move the gate AFTER the navigation it protects: the panel opens, and only
       then is readiness consulted — the bypass, not a cosmetic reorder. Done inside
       the function's own slice, because both markers occur elsewhere in the file
       and a whole-file replace would edit the wrong one. */
    const openerStart = real.indexOf("window.openGuidedMotionFromFrames");
    assert(openerStart > 0, "NC-L: the motion opener must be locatable in the real source");
    const opener = real.slice(openerStart);
    const gateStart = opener.indexOf(GATE);
    const gateEnd = opener.indexOf("\n", gateStart) + 1;
    const gateLine = opener.slice(gateStart, gateEnd);
    assert(gateStart > 0 && gateLine.includes(GATE), "NC-L: the gate line must be locatable");
    assert(gateStart < opener.indexOf(NAVIGATES), "NC-L: and the real source must have it BEFORE the navigation");
    let mutatedOpener = opener.slice(0, gateStart) + opener.slice(gateEnd);
    const navEnd = mutatedOpener.indexOf("\n", mutatedOpener.indexOf(NAVIGATES)) + 1;
    mutatedOpener = mutatedOpener.slice(0, navEnd) + gateLine + mutatedOpener.slice(navEnd);
    const moved = real.slice(0, openerStart) + mutatedOpener;
    assert.notStrictEqual(moved, real, "NC-L must actually move the gate");
    assert(mutatedOpener.indexOf(GATE) > mutatedOpener.indexOf(NAVIGATES),
      "NC-L: the gate must now sit after the navigation it was protecting");
    global.__NC__ = ["gate-moved"];

    const check = (source) => {
      const scoped = source.slice(source.indexOf("window.openGuidedMotionFromFrames"));
      const gate = scoped.indexOf(GATE);
      const navigates = scoped.indexOf(NAVIGATES);
      assert(gate > 0 && navigates > 0, "the readiness gate and the navigation it protects must both still exist");
      assert(gate < navigates, "the readiness check must still run BEFORE the motion panel opens");
    };
    check(real);   /* the real source passes — the control is not testing a broken assertion */
    assert.throws(() => check(moved), /BEFORE the motion panel/,
      "NC-L: the motion-gate invariant must go RED when the gate is moved");
    record("L", "motion gate altered", "RED — moving the readiness check after the navigation it protects is caught, and the unmodified source still passes");
  }

  /* ==========================================================================
     C1 COMPLETION CONTROLS — the six ways the identity of media that PRE-DATES
     activation could still be lost. The twelve above guard the semantics; these
     guard the lifecycle that makes those semantics true for an existing project.
     ========================================================================== */

  /* ================= NC-1 — first-index assets stay unverified for ever ============ */
  {
    const S = sabotage("1", {
      "media-asset-service.js": [[
        "    if (known.has(relativePath)) backlog.push(relativePath);\n    else arrived.push(relativePath);",
        `    ${HIT("backlog-dropped")}\n    if (!known.has(relativePath)) arrived.push(relativePath);`,
      ]],
    });
    const { root, dir } = makeProject("1", "p", {
      files: { "media/A.png": bytesOf("a"), "media/B.png": bytesOf("b"), "media/C.png": bytesOf("c") },
    });
    await go(S, root, "p");
    for (let i = 0; i < 8; i += 1) await go(S, root, "p");
    assert(global.__NC__.includes("backlog-dropped"), "NC-1: the dropped backlog tier must have executed");
    const unverified = rows(dir).filter((a) => !a.contentHash).length;
    assert.strictEqual(unverified, 3, "NC-1 must actually leave every pre-existing asset unverified");
    assert.throws(
      () => assert.strictEqual(unverified, 0,
        "ordinary activity must anchor every pre-existing asset to its bytes"),
      /must anchor every pre-existing asset/,
      "NC-1: the convergence invariant must go RED against this build",
    );
    record("1", "first-index assets never verified", "RED — 3 assets stayed contentHash:null across 9 passes, so their identity could never survive a rename");
  }

  /* ================= NC-2 — in-app rename of an unverified asset forks identity ==== */
  {
    const S = sabotage("2", {
      "media-asset-service.js": [[
        "    const run = verifyAssets({ projectDir, paths: [relativePath], limit: 1, maxBytes: VERIFY_BYTE_LIMIT, now: options.now });",
        `    ${HIT("anchor-skipped")}\n    return { anchored: false, reason: "sabotaged" };\n`
        + "    const run = verifyAssets({ projectDir, paths: [relativePath], limit: 1, maxBytes: VERIFY_BYTE_LIMIT, now: options.now });",
      ]],
    });
    const { root, dir } = makeProject("2", "p", { files: { "anchors/CHAR-RHEA.png": bytesOf("rhea") } });
    await go(S, root, "p");
    const before = rows(dir)[0];
    assert.strictEqual(before.contentHash, null, "the control needs a genuinely unverified asset");
    const anchor = await S.anchorBeforeRename({ projectsRoot: root, slug: "p", path: "anchors/CHAR-RHEA.png" });
    assert(global.__NC__.includes("anchor-skipped"), "NC-2: the skipped anchor must have executed");
    assert.strictEqual(anchor.anchored, false, "NC-2 must actually decline to anchor");
    fs.renameSync(path.join(dir, "anchors", "CHAR-RHEA.png"), path.join(dir, "anchors", "CHAR-RHEA_APPROVED.png"));
    await go(S, root, "p");
    const after = rowAt(dir, "anchors/CHAR-RHEA_APPROVED.png");
    assert.notStrictEqual(after.assetId, before.assetId, "NC-2 must actually fork the identity");
    assert.throws(
      () => assert.strictEqual(after.assetId, before.assetId,
        "a rename CineBraid itself performs must preserve assetId"),
      /must preserve assetId/,
      "NC-2: the in-app rename invariant must go RED against this build",
    );
    record("2", "in-app rename of an unverified asset", `RED — the approval rename forked ${before.assetId.slice(0, 14)}… into a new identity, which is the exact case an approval must survive`);
  }

  /* ================= NC-3 — project open blocks on hashing the whole project ======= */
  {
    const S = sabotage("3", {
      "media-asset-service.js": [[
        "  const passOptions = { ...options, projectDir, slug, reason };",
        `  ${HIT("blocking-hash")}\n`
        + "  for (const ncName of fs.readdirSync(path.join(projectDir, \"media\")))\n"
        + "    require(\"crypto\").createHash(\"sha256\").update(fs.readFileSync(path.join(projectDir, \"media\", ncName))).digest(\"hex\");\n"
        + "  const passOptions = { ...options, projectDir, slug, reason };",
      ]],
    });
    const clean = require(path.join(ROOT, "src/media/media-asset-service.js"));
    const files = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`media/P${i}.png`, bytesOf(`p${i}`)]));
    const sab = makeProject("3", "p", { files });
    const ok = makeProject("3", "q", { files });

    /* Reads counted, not milliseconds: a timing threshold is a flake waiting to
       happen, and "how many media files were opened before the call returned" is
       the actual question. */
    function mediaReadsBeforeReturn(service, root, slug) {
      const real = fs.readFileSync;
      let returned = false;
      let reads = 0;
      fs.readFileSync = (target, ...rest) => {
        if (!returned && String(target).replace(/\\/g, "/").includes("/media/")) reads += 1;
        return real(target, ...rest);
      };
      let pending;
      try {
        pending = service.activateProject({ projectsRoot: root, slug, reason: "explicit", throttleMs: 0 });
      } finally {
        returned = true;
        fs.readFileSync = real;
      }
      return { reads, pending };
    }
    const sabotaged = mediaReadsBeforeReturn(S, sab.root, "p");
    await sabotaged.pending;
    const honest = mediaReadsBeforeReturn(clean, ok.root, "q");
    await honest.pending;

    assert(global.__NC__.includes("blocking-hash"), "NC-3: the synchronous hashing must have executed");
    assert.strictEqual(sabotaged.reads, 150, "NC-3 must actually read every media file before returning");
    assert.strictEqual(honest.reads, 0, "while the real build returns having read none");
    assert.throws(
      () => assert.strictEqual(sabotaged.reads, 0,
        "scheduling a pass must not read a media byte before it returns to the route"),
      /must not read a media byte/,
      "NC-3: the non-blocking invariant must go RED against this build",
    );
    record("3", "project open blocks on hashing", `RED — 150 media files were read before activateProject returned; the real build reads ${honest.reads}, so GET /api/project never waits on bytes`);
  }

  /* ================= NC-4 — an unprovable rename guessed from path similarity ====== */
  {
    const S = sabotage("4", {
      "media-asset-verify.js": [[
        "  const renames = [];\n  const ambiguous = [];",
        "  const renames = [];\n  const ambiguous = [];\n  {\n"
        + `    ${HIT("similarity-guessed")}\n`
        + "    const goneNC = ledger.assets.filter((a) => a && a.storage && a.storage.missing === true && !a.contentHash);\n"
        /* The present row is NOT required to be unhashed: by the time reconciliation
           runs, a new arrival has already been verified. The realistic bad heuristic
           is exactly this — "the old file vanished and a new one appeared in the
           same folder, so it must be the same thing" — and it needs no evidence
           about the vanished file at all. */
        + "    const hereNC = ledger.assets.filter((a) => a && a.storage && a.storage.missing !== true);\n"
        + "    const dirOf = (p) => p.split(\"/\").slice(0, -1).join(\"/\");\n"
        + "    for (const origin of goneNC) {\n"
        + "      const arrival = hereNC.find((a) => dirOf(a.storage.path) === dirOf(origin.storage.path));\n"
        + "      if (!arrival) continue;\n"
        + "      const from = origin.storage.path;\n"
        + "      origin.storage = { ...arrival.storage };\n"
        + "      delete origin.storage.missing;\n"
        + "      origin.renamedFrom = from;\n"
        + "      renames.push({ assetId: origin.assetId, from, to: origin.storage.path, absorbed: arrival.assetId });\n"
        + "      ledger.assets = ledger.assets.filter((a) => a !== arrival);\n"
        + "      hereNC.splice(hereNC.indexOf(arrival), 1);\n"
        + "    }\n  }",
      ]],
    });
    const { root, dir } = makeProject("4", "p", { files: { "media/BEFORE.png": bytesOf("external") } });
    await go(S, root, "p");
    const before = rows(dir)[0];
    assert.strictEqual(before.contentHash, null, "the control needs an asset with no byte evidence");
    fs.renameSync(path.join(dir, "media", "BEFORE.png"), path.join(dir, "media", "AFTER.png"));
    const guessed = await go(S, root, "p");
    assert(global.__NC__.includes("similarity-guessed"), "NC-4: the similarity matcher must have executed");
    assert.strictEqual(guessed.verified.renames.length, 1, "NC-4 must actually invent a rename");
    const claimed = rowAt(dir, "media/AFTER.png");
    assert.strictEqual(claimed.assetId, before.assetId, "and transplant the old identity onto the new path");
    assert.strictEqual(claimed.contentHash, null,
      "on the evidence of a shared DIRECTORY alone — no byte of either file was ever read");
    assert.throws(
      () => assert.notStrictEqual(claimed.assetId, before.assetId,
        "an out-of-band rename with no byte evidence must not be reconciled"),
      /must not be reconciled/,
      "NC-4: the no-guessing invariant must go RED against this build",
    );
    record("4", "unprovable rename guessed", "RED — an external rename CineBraid never had byte evidence for was linked from path similarity alone, asserting a history nothing proves");
  }

  /* ================= NC-5 — backlog verification merges two live twins ============= */
  {
    const S = sabotage("5", {
      "media-asset-verify.js": [[
        "    if (!gone.length || !here.length) continue;",
        `    if (here.length > 1) {\n      ${HIT("backlog-merged")}\n`
        + "      const [, ...drop] = here;\n"
        + "      ledger.assets = ledger.assets.filter((row) => !drop.includes(row));\n"
        + "      continue;\n    }\n    if (!gone.length || !here.length) continue;",
      ]],
    });
    const { root, dir } = makeProject("5", "p", {
      files: { "media/twin-left.png": bytesOf("twin"), "media/twin-right.png": bytesOf("twin") },
    });
    await go(S, root, "p");                    /* backfill: two rows, no digests */
    assert.strictEqual(rows(dir).length, 2, "both files start as two identities");
    await go(S, root, "p");                    /* the BACKLOG tier hashes them */
    assert(global.__NC__.includes("backlog-merged"), "NC-5: the merge must have executed during backlog verification");
    assert.strictEqual(rows(dir).length, 1, "NC-5 must actually merge the two live files");
    assert.throws(
      () => assert.strictEqual(rows(dir).length, 2,
        "two independent current files stay two MediaAssets however their digests were obtained"),
      /stay two MediaAssets/,
      "NC-5: the duplicate-content invariant must go RED on the backlog path too",
    );
    record("5", "backlog verification merges live twins", "RED — the tier that anchors pre-existing media collapsed two live same-byte files into one identity");
  }

  /* ================= NC-6 — verification writes project.json ======================= */
  {
    const S = sabotage("6", {
      "media-asset-service.js": [[
        "        record.unverifiedRemaining = countUnverified(readLedger(projectDir).ledger.assets);",
        `        ${HIT("project-written-by-verification")}\n`
        + "        fs.writeFileSync(path.join(projectDir, \"project.json\"), JSON.stringify(project));\n"
        + "        record.unverifiedRemaining = countUnverified(readLedger(projectDir).ledger.assets);",
      ]],
    });
    const { root, dir } = makeProject("6", "p", {
      files: { "media/A.png": bytesOf("a") },
      project: { shots: [{ id: "S-01", winner: "A.png", keyframes: [], clips: [], candidateFiles: [] }] },
    });
    /* Captured before ANY pass: the sabotaged write sits on the verification arm,
       which every pass reaches — so a baseline taken after the first pass would
       already be the rewritten file and the control would prove nothing. */
    const before = fs.readFileSync(path.join(dir, "project.json"));
    await go(S, root, "p");
    await go(S, root, "p");                    /* the pass that verifies the backlog */
    assert(global.__NC__.includes("project-written-by-verification"), "NC-6: the project write must have executed");
    const after = fs.readFileSync(path.join(dir, "project.json"));
    assert.strictEqual(before.equals(after), false, "NC-6 must actually rewrite project.json");
    assert.throws(
      () => assert(before.equals(after), "verification must leave project.json byte-identical"),
      /byte-identical/,
      "NC-6: the no-legacy-mutation invariant must go RED on the verification path too",
    );
    record("6", "verification writes project.json", `RED — anchoring bytes renormalised legacy project semantics, ${before.length} bytes to ${after.length}`);
  }

  console.log(`MediaAsset activation negative controls passed (${results.length}/18):`);
  for (const line of results) console.log(`  · ${line}`);
  console.log(
    "  Every control ran the sabotaged branch — proved by an in-branch marker — before the invariant was asserted, "
    + "so none of the eighteen is a module that merely failed to load.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch {}
  });
